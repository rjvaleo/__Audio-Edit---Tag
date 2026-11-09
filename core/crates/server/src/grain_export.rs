//! A take's notes, AMP and LFOs, in the exported file (`grain-redesign/
//! BUILD-PLAN.md`, Phase 7e).
//!
//! RJ's decision (8 Nov 2026): export "renders as it plays, with the notes".
//! Neither of the export's own routes can do that: `edit::render` stretches the
//! whole file at once, and `offline::stretch_with_automation` has no keys. So a
//! document with a take in it, or an LFO on it, is rendered through the
//! callback itself: an [`engine::Core`] and its [`engine::Shared`], the same
//! code the speakers hear, off the clock and with no device. Notes arrive by
//! the same `GrainKeys` a hand would use, at the frames the take holds them,
//! and the LFOs run on the same [`Bank`], from the top of their cycles, so
//! a file is the same every time it is written.
//!
//! The file is at the document's own sample rate. It holds its effects' tails,
//! to whatever a take ends on, and no more silence than that.

use std::sync::Arc;

use engine::render::Source;
use engine::{Core, GrainKeys, Shared};
use fx::grain::StreamParams;

use crate::automation::{self, Automation, TakeNote};
use crate::grain_lfos::{self, Bank, Lanes};
use crate::rack::RackSpec;
use crate::state::App;

/// A block of the render. As short as the callback's usual, because it is how
/// finely a note lands.
pub const BLOCK: usize = 512;

/// A safety stop, in multiples of the document's own length.
const MAX_GROWTH: u64 = 128;

/// Spare voices kept ready on top of those the next block may want.
const SPARE: usize = 8;

fn stream_params(stretch: &fx::Stretch, in_frames: usize, sample_rate: u32) -> StreamParams {
    StreamParams {
        in_frames,
        sample_rate,
        ratio: stretch.ratio,
        semitones: stretch.semitones,
        window_ms: stretch.window_ms,
        grain: stretch.grain,
        algorithm: stretch.algorithm,
        wsola: stretch.wsola,
        vocoder: stretch.vocoder,
        pvsola: stretch.pvsola,
        hybrid: stretch.hybrid,
        cloud: stretch.cloud,
        cloud_mix: stretch.cloud_mix,
    }
}

/// Everything the callback needs that is not on the document itself: what the
/// keys were set to, and what the LFOs are doing, if anything.
pub struct Take<'a> {
    pub keys: &'a GrainKeys,
    pub lfos: Option<&'a Bank>,
}

/// The deck, off the clock, loaded with one document and nothing playing yet.
fn deck(base: &[f32], channels: usize, sample_rate: u32, stretch: &fx::Stretch, spec: &RackSpec, keys: &Arc<GrainKeys>) -> (Core, Shared) {
    let in_frames = base.len() / channels;
    let sp = stream_params(stretch, in_frames, sample_rate);
    let source = Arc::new(Source { samples: base.to_vec(), channels });
    let shared = Shared::new(sp, Arc::clone(&source));
    if stretch.algorithm == fx::stretch::Algorithm::Hybrid {
        shared.set_parts(Arc::new(fx::hstream::Parts::separate(base, channels, stretch.hybrid)));
    }
    if stretch.wsola.preserve_transients {
        let hop = sp.plan().hop.max(1);
        shared.set_map(fx::stream::WsolaStream::build_map(base, channels, sample_rate, stretch.ratio, hop, &stretch.wsola));
    }
    if stretch.grain.layers > 1 {
        shared.set_bank(engine::stretcher::LayerBank::build(stretch.algorithm, stretch.grain.layers, BLOCK, channels, sample_rate));
    }
    let rack = spec.build(sample_rate, channels);
    shared.set_rack(if rack.is_empty() { None } else { Some(rack) });
    shared.set_pitch_time(spec.pitch_time);
    shared.set_post_roll_frames((spec.post_roll_ms() as f64 * 0.001 * sample_rate as f64) as u64);
    shared.voices.set_offline(true);
    keys.set_played(true);
    let core = Core::new(BLOCK, channels, sp, source).with_keys(Arc::clone(keys));
    (core, shared)
}

/// How many note-ons a block will start, to have that many voices ready.
fn starts_in(notes: &[TakeNote], from: u64, to: u64) -> usize {
    notes.iter().filter(|n| n.on && n.frame >= from && n.frame < to).count()
}

/// Render a document the way the callback plays it, with its take's notes and
/// the LFOs. `base` is the document before its stretch.
pub fn render_take(
    base: &[f32],
    channels: usize,
    sample_rate: u32,
    stretch: &fx::Stretch,
    automation: &Automation,
    spec: &RackSpec,
    take: &Take<'_>,
    keep_going: &dyn Fn(u64) -> bool,
) -> Option<Vec<f32>> {
    let channels = channels.max(1);
    let in_frames = (base.len() / channels) as u64;
    if in_frames == 0 {
        return Some(Vec::new());
    }
    let keys = Arc::new(take.keys.settings());
    let (mut core, shared) = deck(base, channels, sample_rate, stretch, spec, &keys);
    let mut bank = take.lfos.map(Bank::rewound);
    let held = bank.as_ref().is_some_and(Bank::is_aimed);

    let ceiling = in_frames.saturating_mul(MAX_GROWTH).max(sample_rate as u64 * 30);
    let dt = BLOCK as f64 / sample_rate.max(1) as f64;
    let mut out: Vec<f32> = Vec::with_capacity(base.len());
    let mut block = vec![0f32; BLOCK * channels];
    let notes = &automation.notes;
    let mut next = 0usize;
    let mut writes = Vec::new();
    let mut played = false;
    let mut tail = 0u64;
    let mut heard = 0usize;
    let mut body = 0usize;
    shared.play();

    loop {
        let frame = shared.position();
        let upto = frame + BLOCK as u64;

        if shared.is_playing() {
            // A voice is built ahead of the note that needs it, as the feeder
            // does for a hand on the keys.
            engine::voices::stock(&shared, starts_in(notes, frame, upto) + SPARE, BLOCK, channels);
            while next < notes.len() && notes[next].frame < upto {
                let n = notes[next];
                if n.on {
                    keys.note_on(n.key, n.vel);
                } else {
                    keys.note_off(n.key);
                }
                next += 1;
            }
        }

        if held || !automation.is_silent() {
            automation::rack_controls(automation, spec, frame, sample_rate, &mut writes);
            let lanes = Lanes { automation, frame, sample_rate };
            let outs = match bank.as_mut() {
                Some(b) => {
                    b.advance(dt, keys.note_ons());
                    grain_lfos::compute(b, stretch, spec, Some(&lanes))
                }
                None => Vec::new(),
            };
            grain_lfos::merge_rack(&outs, spec, &mut writes);
            shared.set_automation(writes.clone());
            shared.update_params(|p| {
                automation::apply_stretch(automation, p, frame, sample_rate);
                grain_lfos::apply_stream(&outs, &[], p);
            });
            if automation.lanes.iter().any(|l| l.enabled && l.target.starts_with("ptc.")) {
                let mut pt = spec.pitch_time;
                automation::apply_pitch_time(automation, &mut pt, frame, sample_rate);
                shared.set_pitch_time(pt);
            }
        }

        core.fill(&mut block, channels, &shared);
        let loud = block.iter().fold(0f32, |m, s| m.max(s.abs())) >= fx::TAIL_SILENCE;
        out.extend_from_slice(&block);
        if loud {
            heard = out.len();
        }
        if !keep_going(BLOCK as u64) {
            return None;
        }

        if shared.is_playing() {
            played = true;
            if (out.len() / channels) as u64 >= ceiling {
                shared.pause();
            }
            continue;
        }
        if played {
            // The take has finished and whatever is still held is let go, as
            // it would be when the transport stops.
            keys.all_off();
            played = false;
            body = out.len();
        }
        if shared.voices.running() == 0 && !loud {
            tail += BLOCK as u64;
            if tail >= fx::tail_budget(sample_rate) {
                break;
            }
        } else {
            tail = 0;
        }
        if (out.len() / channels) as u64 >= ceiling + sample_rate as u64 * fx::TAIL_CAP_SECONDS {
            break;
        }
    }

    // The document's own length, and no more silence after it than the tail
    // ended on.
    out.truncate(heard.max(body));
    Some(out)
}

/// Whether this export has anything the callback alone can render.
pub fn wanted(app: &Arc<App>, rel: &str, automation: &Automation) -> bool {
    !automation.notes.is_empty() || app.grain_lfos.bank_for(rel).is_some()
}

/// `run_export`'s route for a document with notes or LFOs.
#[allow(clippy::too_many_arguments)]
pub fn write<S: audio_core::RandomAccessSource, W: std::io::Write>(
    app: &Arc<App>,
    rel: &str,
    reader: &mut audio_core::Reader<S>,
    list: &edit::EditList,
    automation: &Automation,
    spec: &RackSpec,
    out: &mut W,
    bits: u16,
    meta: &audio_core::aiff::Meta,
) -> std::io::Result<u64> {
    app.export.say(edit::render::phase::READING);
    let base = edit::render::render(list, reader, 0, list.base_frames())?;
    app.export.step(list.base_frames());
    app.export.say(edit::render::phase::STRETCHING);
    let bank = app.grain_lfos.bank_for(rel);
    let keys = app.grain_keys.settings();
    let take = Take { keys: &keys, lfos: bank.as_ref() };
    let progress = app.export.clone();
    let keep_going = move |n: u64| {
        progress.step(n);
        !progress.cancelled()
    };
    let Some(audio) = render_take(&base, list.channels as usize, list.sample_rate, &list.stretch, automation, spec, &take, &keep_going) else {
        return Err(std::io::Error::new(std::io::ErrorKind::Interrupted, "cancelled"));
    };
    app.export.say(edit::render::phase::WRITING);
    // The rack has been run by the deck: nothing is left for the writer to do.
    edit::render::write_aiff_controlled(audio, list.channels, list.sample_rate, &mut fx::Rack::new(), out, bits, meta, |_, _| {})
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::automation::Automation;
    use engine::KeyMode;

    const SR: u32 = 48_000;

    fn tone(frames: usize) -> Vec<f32> {
        (0..frames).map(|i| (i as f32 * 0.02).sin() * 0.5).collect()
    }

    fn poly_keys() -> Arc<GrainKeys> {
        let k = Arc::new(GrainKeys::new());
        k.set_run(false);
        k.set_mode(KeyMode::Poly);
        k.set_amp(0.005, 0.02, 0.8, 0.05);
        k
    }

    fn n(frame: u64, on: bool, key: u8) -> TakeNote {
        TakeNote { frame, on, key, vel: 0.8 }
    }

    fn take() -> Automation {
        Automation {
            notes: vec![n(4_096, true, 60), n(8_192, true, 67), n(20_480, false, 60), n(30_720, false, 67)],
            ..Default::default()
        }
    }

    fn play(base: &[f32], s: &fx::Stretch, a: &Automation, spec: &RackSpec, keys: &GrainKeys, lfos: Option<&Bank>) -> Vec<f32> {
        render_take(base, 1, SR, s, a, spec, &Take { keys, lfos }, &|_| true).unwrap()
    }

    /// The same take played through the deck by hand: notes at the same frames,
    /// the render here standing in for what the speakers got.
    fn played_live(base: &[f32], s: &fx::Stretch, a: &Automation, keys: &GrainKeys) -> Vec<f32> {
        let spec = RackSpec::empty();
        let k = Arc::new(keys.settings());
        let (mut core, shared) = deck(base, 1, SR, s, &spec, &k);
        engine::voices::stock(&shared, 16, BLOCK, 1);
        shared.play();
        let mut block = vec![0f32; BLOCK];
        let mut next = 0;
        let mut out = Vec::new();
        for _ in 0..(base.len() / BLOCK + 4) {
            let f = shared.position();
            while next < a.notes.len() && a.notes[next].frame < f + BLOCK as u64 {
                let e = a.notes[next];
                if e.on { k.note_on(e.key, e.vel); } else { k.note_off(e.key); }
                next += 1;
            }
            core.fill(&mut block, 1, &shared);
            out.extend_from_slice(&block);
        }
        out
    }

    #[test]
    fn an_export_of_a_take_is_what_playing_it_gives() {
        for alg in [
            fx::stretch::Algorithm::Granular,
            fx::stretch::Algorithm::Wsola,
            fx::stretch::Algorithm::Vocoder,
            fx::stretch::Algorithm::Pvsola,
            fx::stretch::Algorithm::Hybrid,
        ] {
            let base = tone(48_000);
            let s = fx::Stretch { ratio: 1.0, algorithm: alg, ..Default::default() };
            let a = take();
            let keys = poly_keys();
            let file = play(&base, &s, &a, &RackSpec::empty(), &keys, None);
            let live = played_live(&base, &s, &a, &keys);
            let n = (base.len() - BLOCK).min(file.len()).min(live.len());
            let worst = file[..n].iter().zip(&live[..n]).map(|(x, y)| (x - y).abs()).fold(0f32, f32::max);
            assert!(worst < 1e-5, "{alg:?}: the file differs from playing it by {worst}");
        }
    }

    #[test]
    fn the_notes_are_in_the_file() {
        let base = tone(48_000);
        let s = fx::Stretch::default();
        let keys = poly_keys();
        let with = play(&base, &s, &take(), &RackSpec::empty(), &keys, None);
        let without = play(&base, &s, &Automation::default(), &RackSpec::empty(), &keys, None);
        let n = with.len().min(without.len());
        let d: f32 = with[..n].iter().zip(&without[..n]).map(|(a, b)| (a - b).abs()).sum();
        assert!(d > 100.0, "the notes changed the file by only {d}");
    }

    #[test]
    fn the_tail_of_a_note_is_in_the_file_and_no_more() {
        // A note held to the end, let go there, with a slow release.
        let base = tone(24_000);
        let a = Automation { notes: vec![n(1_024, true, 60), n(40_000, false, 60)], ..Default::default() };
        let s = fx::Stretch::default();
        let keys = poly_keys();
        keys.set_amp(0.005, 0.02, 0.8, 1.0);
        let file = play(&base, &s, &a, &RackSpec::empty(), &keys, None);
        assert!(file.len() > 24_000, "the release was cut off at {} frames", file.len());
        assert!(file.len() < 24_000 + 144_000, "{} frames of nothing", file.len());
        let peak = file[24_000..24_000 + 2_000].iter().fold(0f32, |m, s| m.max(s.abs()));
        assert!(peak > 0.05, "the release is missing from the file: {peak}");
    }

    #[test]
    fn an_lfo_is_in_the_file() {
        let base = tone(48_000);
        let s = fx::Stretch::default();
        let keys = poly_keys();
        let spec = RackSpec::empty();
        let plain = play(&base, &s, &take(), &spec, &keys, None);
        let mut bank = Bank::default();
        let mut lfo = grain_lfos::Lfo::default();
        lfo.hz = 5.0;
        lfo.depth = 0.5;
        lfo.aims = vec![grain_lfos::Aim { target: "stretch.grain.positionJitterMs".into(), travel: None }];
        bank.configure(vec![lfo], 120.0, "x".into());
        let swung = play(&base, &s, &take(), &spec, &keys, Some(&bank));
        let n = plain.len().min(swung.len());
        let d: f32 = plain[..n].iter().zip(&swung[..n]).map(|(a, b)| (a - b).abs()).sum();
        assert!(d > 1.0, "the LFO changed the file by only {d}");
    }
}

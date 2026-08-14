//! Rendering a document whose *stretch* moves under automation.
//!
//! `edit::render` applies the stretch in one pass with one set of parameters,
//! which is right for a document whose ratio and pitch are fixed and wrong for
//! one with a lane on them. Rather than a second stretch implementation, this
//! drives the very engine the audio callback drives — `engine::stretcher` — and
//! feeds it the same automated parameters, block by block, off the clock.
//!
//! That is the point: what you hear is what you export, enforced by the two
//! paths being the same code rather than by two implementations agreeing.

use crate::automation::Automation;
use engine::render::Source;
use engine::stretcher::Stretcher;
use fx::grain::StreamParams;

/// The block the stretcher is asked for at a time.
///
/// Also the rate at which automation is resolved, so it is small enough to
/// follow a curve and large enough that the engine is not being restarted
/// around every one.
const BLOCK: usize = 1024;

/// A safety stop, in multiples of the document's own length.
///
/// A ratio lane can ask for a hundred times the material, and the honest
/// answer for "how long is this" is "however long the engine takes to run out".
/// This bounds a lane that has been drawn into something pathological rather
/// than trusting it.
const MAX_GROWTH: u64 = 128;

/// Render `base` — the document before its stretch — through the streaming
/// stretcher with `automation` moving the parameters, and return the result.
///
/// Held whole in memory, like `edit::render::render_all_stretched`: the output
/// length is not knowable in advance when the ratio is on a curve, and an AIFF
/// header has to state it before the samples are written.
pub fn stretch_with_automation(
    base: &[f32],
    channels: usize,
    sample_rate: u32,
    stretch: &fx::Stretch,
    automation: &Automation,
) -> Vec<f32> {
    let channels = channels.max(1);
    let in_frames = base.len() / channels;
    if in_frames == 0 {
        return Vec::new();
    }

    let source = Source { samples: base.to_vec(), channels };
    let mut engine = Stretcher::new(BLOCK, channels, sample_rate);
    let mut params = StreamParams {
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
    };
    // The extra engine instances the grain cloud's layers need. The live path
    // hands these over the same way; without them a granular document renders
    // nothing at all, silently.
    engine.set_bank(engine::stretcher::LayerBank::build(
        params.algorithm,
        params.grain.layers,
        BLOCK,
        channels,
        sample_rate,
    ));
    // Start where the transport starts, so the first block is the first block.
    engine.seek(0, &params);

    let ceiling = (in_frames as u64).saturating_mul(MAX_GROWTH);
    let mut out: Vec<f32> = Vec::with_capacity(base.len());
    let mut block = vec![0.0f32; BLOCK * channels];
    let mut events: Vec<fx::grain::GrainEvent> = Vec::new();
    let mut frame = 0u64;

    // How much of the source has been used up.
    //
    // The engine will not say when it is finished — `render` always fills the
    // block, and a grain stream is happy to run forever reading the clamped
    // last sample. The transport stops on a frame count worked out in advance
    // from a fixed ratio, which is exactly the thing a lane takes away. So the
    // length is integrated instead: a block of output at ratio *r* consumes
    // `BLOCK / r` of source, and the render is done when the source is.
    let mut consumed = 0.0f64;

    while consumed < in_frames as f64 && frame < ceiling {
        // Read at the frame this block starts on — the same frame the playhead
        // would report there, so the file follows the curve the screen drew.
        params.ratio = stretch.ratio;
        params.semitones = stretch.semitones;
        params.window_ms = stretch.window_ms;
        params.grain = stretch.grain;
        crate::automation::apply_stretch(automation, &mut params, frame, sample_rate);

        engine.render(&mut block, channels, &source, &params, &mut events);
        out.extend_from_slice(&block);
        frame += BLOCK as u64;
        consumed += BLOCK as f64 / params.ratio.max(1e-4) as f64;
    }
    out
}

/// Whether a document needs the streaming path rather than the one-pass one.
pub fn needs_streaming(automation: &Automation) -> bool {
    !automation.offline_unsupported().is_empty()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::automation::{Curve, Lane, Point};

    fn lane(target: &str, points: Vec<(u64, f32)>) -> Automation {
        Automation {
            lanes: vec![Lane {
                id: "a".into(),
                target: target.into(),
                label: "L".into(),
                enabled: true,
                trim: 0.0,
                loop_range: None,
                points: points
                    .into_iter()
                    .map(|(frame, value)| Point { frame, value, curve: Curve::Linear, tension: 0.0 })
                    .collect(),
                modulators: Vec::new(),
            }],
            ..Default::default()
        }
    }

    fn tone(frames: usize) -> Vec<f32> {
        (0..frames).map(|i| (i as f32 / 20.0).sin() * 0.5).collect()
    }

    #[test]
    fn a_ratio_lane_makes_the_render_longer() {
        let base = tone(20_000);
        let flat = Automation::default();
        let plain = stretch_with_automation(&base, 1, 48_000, &fx::Stretch::default(), &flat);

        // 0.75 of the log range from 0.01 to 100 is about 17.8x.
        let stretched = stretch_with_automation(
            &base,
            1,
            48_000,
            &fx::Stretch::default(),
            &lane("stretch.ratio", vec![(0, 0.75), (20_000, 0.75)]),
        );
        assert!(
            stretched.len() > plain.len() * 4,
            "a 17.8x ratio lane produced {} frames against {}",
            stretched.len(),
            plain.len()
        );
    }

    #[test]
    fn a_document_with_no_lanes_renders_the_same_length_it_asks_for() {
        let base = tone(20_000);
        let out = stretch_with_automation(&base, 1, 48_000, &fx::Stretch::default(), &Automation::default());
        // Within a block of the source: unity ratio, no lane.
        let diff = (out.len() as i64 - base.len() as i64).abs();
        assert!(diff <= BLOCK as i64, "unity render came out {diff} frames off");
    }

    #[test]
    fn a_pitch_lane_reaches_the_render() {
        let base = tone(20_000);
        let flat = stretch_with_automation(&base, 1, 48_000, &fx::Stretch::default(), &Automation::default());
        let shifted = stretch_with_automation(
            &base,
            1,
            48_000,
            &fx::Stretch::default(),
            &lane("stretch.semitones", vec![(0, 1.0), (20_000, 1.0)]),
        );
        // Two octaves up and then some: the waveform cannot match.
        let n = flat.len().min(shifted.len()).min(8_000);
        let worst = (0..n).map(|i| (flat[i] - shifted[i]).abs()).fold(0f32, f32::max);
        assert!(worst > 0.05, "the pitch lane changed nothing: worst {worst:.3e}");
    }

    #[test]
    fn a_lane_that_asks_for_the_impossible_still_terminates() {
        let base = tone(4_000);
        let out = stretch_with_automation(
            &base,
            1,
            48_000,
            &fx::Stretch::default(),
            &lane("stretch.ratio", vec![(0, 1.0)]),
        );
        assert!(out.len() / 1 <= 4_000 * MAX_GROWTH as usize + BLOCK);
    }
}

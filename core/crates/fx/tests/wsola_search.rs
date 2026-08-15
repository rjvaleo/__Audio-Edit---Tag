//! How far a WSOLA splice may be moved to find a better join.
//!
//! Reported as high Search values glitching. The read pointer was not drifting
//! — it is re-derived from the output position every hop — so this was not a
//! time-base fault. It was adjacent windows being allowed to disagree about
//! where they were: at 200 ms one window could splice from 180 ms before the
//! nominal position and the next from 180 ms after, overlap-adding material a
//! third of a second apart. Both joins correlate well. That is the problem.

use fx::grain::Grain;
use fx::stream::{StretchParams, Streamer};
use fx::stretch::WsolaParams;

const SR: u32 = 48_000;

/// Material where *where you are* is audible: a tone that climbs steadily, so
/// splicing from the wrong place shows up as a jump in pitch rather than
/// blending in the way steady material would.
fn sweep(frames: usize) -> Vec<f32> {
    let mut phase = 0.0f32;
    (0..frames)
        .map(|i| {
            let f = 200.0 + 1400.0 * (i as f32 / frames as f32);
            phase += std::f32::consts::TAU * f / SR as f32;
            phase.sin() * 0.5
        })
        .collect()
}

fn params(search_ms: f32) -> StretchParams {
    StretchParams {
        ratio: 2.0,
        window_ms: 40.0,
        sample_rate: SR,
        wsola: WsolaParams { search_ms, ..WsolaParams::default() },
        vocoder: Default::default(),
        grain: Grain::default(),
    }
}

/// Biggest sample-to-sample step. A splice from the wrong place lands
/// mid-waveform and shows up here as a discontinuity nothing else produces.
fn worst_step(v: &[f32]) -> f32 {
    v.windows(2).fold(0.0f32, |m, w| m.max((w[1] - w[0]).abs()))
}

fn render(search_ms: f32) -> Vec<f32> {
    let input = sweep(SR as usize);
    let sp = params(search_ms);
    let mut s = fx::stream::WsolaStream::new(2048, 1, SR);
    let mut out = vec![0.0; 2048];
    let mut all = Vec::new();
    for _ in 0..40 {
        out.iter_mut().for_each(|x| *x = 0.0);
        s.render(&mut out, 1, &input, &sp);
        all.extend_from_slice(&out);
    }
    all
}

/// The report, as a number. A wide search must not be worse than a sane one.
#[test]
fn a_wide_search_does_not_join_worse_than_a_narrow_one() {
    let narrow = worst_step(&render(10.0));
    let wide = worst_step(&render(200.0));
    assert!(
        wide <= narrow * 1.5 + 0.02,
        "200 ms of search joins worse than 10 ms: {wide:.4} against {narrow:.4}"
    );
}

/// And it must still be doing its job — a search of zero is plain overlap-add,
/// which is the thing WSOLA exists to beat.
#[test]
fn searching_at_all_still_beats_not_searching() {
    let none = worst_step(&render(0.0));
    let some = worst_step(&render(10.0));
    assert!(some <= none + 0.02, "searching made the joins worse: {some:.4} against {none:.4}");
}

/// The bound is the hop, so asking for more than the hop can hold is not an
/// error and not a different sound — it is the same sound as asking for the
/// hop. A control that silently did something wilder would be the fault again.
#[test]
fn beyond_the_bound_every_setting_renders_the_same() {
    let a = render(120.0);
    let b = render(200.0);
    assert_eq!(a.len(), b.len());
    let worst = a.iter().zip(&b).fold(0.0f32, |m, (x, y)| m.max((x - y).abs()));
    assert!(worst < 1e-6, "past the bound the setting still changed the audio by {worst}");
}

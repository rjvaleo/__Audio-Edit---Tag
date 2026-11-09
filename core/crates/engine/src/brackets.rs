//! The read stays in the brackets (Grain v12, Phase 4).
//!
//! The page's brackets are a stretch of the *source*, and the transport holds
//! them in output frames, as `source frame × Stretch` (`engineFromSrc`). That
//! assumes an output frame reads the source at `frame / Stretch`. Scan breaks
//! the assumption: the read is at `frame / Stretch × Scan`, measured from the
//! start of the file or, when Scan is negative, back from the end of it. Left
//! alone, the loop goes round the right output frames and the wrong sound, and
//! a Scan of 2 runs off the end of the file halfway round.
//!
//! So the loop is corrected on its way to the renderer, and only there: the
//! transport's own count, the document, and what the page stores are all still
//! in Stretch-only output frames. A Scan of exactly 1 changes nothing.
//!
//! - A held note goes round the corrected bounds whenever Run is off.
//! - The transport's loop, with Run on, is the same arithmetic and the same
//!   fault. It is corrected too, but only while the Grain page is in front
//!   ([`GrainKeys::front`](crate::GrainKeys::front)): off that page, today's
//!   screen keeps today's loop.
//!
//! The engines read Scan alike, with one difference: the vocoder's backward
//! sweep starts a window short of the end of the file, not at it. Hybrid is the
//! vocoder and WSOLA under a noise layer, and is treated as they are. Position
//! is not corrected for: it is a deliberate offset on top of the sweep, drawn
//! on the page as the head moved by Position.

use fx::grain::StreamParams;
use fx::stretch::{fft_size_for, Algorithm};

/// Below this Scan the read does not move at all, and no loop can steer it.
const FROZEN: f32 = 1e-3;

/// The Scan the read really follows, when it moves the read at all and is not
/// plain 1.
fn scan_of(p: &StreamParams) -> Option<f64> {
    let s = p.grain.scan.clamp(-4.0, 4.0);
    if s == 1.0 || s.abs() < FROZEN {
        return None;
    }
    Some(s as f64)
}

/// Where the backward sweep starts, in output frames: where the document ends,
/// except that the vocoder's own sweep starts one window before it.
fn back_home(p: &StreamParams) -> f64 {
    let end = p.plan().out_frames as f64;
    if p.algorithm == Algorithm::Vocoder {
        let n = fft_size_for(p.vocoder.window_ms, p.sample_rate) as f64;
        (end - n * p.ratio as f64).max(0.0)
    } else {
        end
    }
}

/// `frame` is a position in Stretch-only output frames: where the read has to
/// be at Scan 1. Answers the output frame that reads that same moment at the
/// Scan in force.
pub fn frame(frame: u64, p: &StreamParams) -> u64 {
    let Some(s) = scan_of(p) else { return frame };
    let f = frame as f64;
    let at = if s > 0.0 { f / s } else { (back_home(p) - f).max(0.0) / -s };
    at.round() as u64
}

/// Where in the source, in frames, output frame `frame` reads at the Scan and
/// Position in force: the same sweep as `frame`, the other way round.
pub fn read_at(frame: u64, p: &StreamParams) -> f32 {
    let s = p.grain.scan.clamp(-4.0, 4.0) as f64;
    let f = frame as f64;
    let ratio = (p.ratio as f64).max(1e-6);
    let along = if s < 0.0 { (back_home(p) + f * s) / ratio } else { f * s / ratio };
    (along + p.grain.position.clamp(-1.0, 1.0) as f64 * p.in_frames as f64) as f32
}

/// The same for a pair of loop bounds. Backward, the far bracket is the near
/// one, so the pair is put back in order; and however fast Scan runs, a loop
/// stays long enough to be a loop.
pub fn bounds((a, b): (u64, u64), p: &StreamParams) -> (u64, u64) {
    let (x, y) = (frame(a, p), frame(b, p));
    let (lo, hi) = (x.min(y), x.max(y));
    (lo, hi.max(lo + crate::transport::MIN_LOOP_FRAMES + 1))
}

#[cfg(test)]
mod tests {
    use super::*;
    use fx::grain::Grain;

    fn p(scan: f32) -> StreamParams {
        let mut sp = StreamParams::new(96_000, 48_000);
        sp.ratio = 2.0;
        sp.grain = Grain { scan, ..Grain::default() };
        sp
    }

    #[test]
    fn scan_one_is_exactly_what_was_set() {
        assert_eq!(bounds((48_000, 96_000), &p(1.0)), (48_000, 96_000));
        assert_eq!(frame(12_345, &p(1.0)), 12_345);
    }

    #[test]
    fn a_frozen_head_cannot_be_steered_and_is_left_alone() {
        assert_eq!(bounds((48_000, 96_000), &p(0.0)), (48_000, 96_000));
    }

    #[test]
    fn forward_scan_divides() {
        assert_eq!(bounds((48_000, 96_000), &p(2.0)), (24_000, 48_000));
        assert_eq!(bounds((48_000, 96_000), &p(0.5)), (96_000, 192_000));
    }

    #[test]
    fn backward_scan_measures_from_the_end_and_swaps_the_ends() {
        // A 192 000 frame document: the right bracket is reached first.
        assert_eq!(bounds((48_000, 96_000), &p(-1.0)), (96_000, 144_000));
        assert_eq!(bounds((48_000, 96_000), &p(-2.0)), (48_000, 72_000));
    }

    #[test]
    fn pvsola_reads_scan_like_the_rest() {
        let mut sp = p(2.0);
        sp.algorithm = Algorithm::Pvsola;
        assert_eq!(bounds((48_000, 96_000), &sp), (24_000, 48_000));
        assert_eq!(read_at(24_000, &sp), 24_000.0);
    }

    #[test]
    fn read_at_undoes_frame() {
        for scan in [1.0f32, 0.5, 2.0, -1.0, -2.0] {
            let sp = p(scan);
            let at = frame(48_000, &sp);
            assert!((read_at(at, &sp) - 24_000.0).abs() < 1.0, "Scan {scan}: {}", read_at(at, &sp));
        }
    }

    #[test]
    fn the_vocoder_backward_sweep_starts_a_window_early() {
        let mut sp = p(-1.0);
        sp.algorithm = Algorithm::Vocoder;
        let n = fft_size_for(sp.vocoder.window_ms, sp.sample_rate) as u64;
        // A 2× stretch of a 96 000 frame file, less the window at that stretch.
        assert_eq!(frame(96_000, &sp), 192_000 - 96_000 - n * 2);
    }

    #[test]
    fn a_very_fast_scan_still_leaves_a_loop() {
        let (lo, hi) = bounds((0, 100), &p(4.0));
        assert!(hi > lo + crate::transport::MIN_LOOP_FRAMES);
    }
}

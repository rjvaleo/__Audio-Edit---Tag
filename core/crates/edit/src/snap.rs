//! Where an edit actually lands.
//!
//! Every cut, fade and loop point in this program used to land wherever the
//! pointer happened to be. Joining two places in a waveform that are not at the
//! same amplitude puts a step into the signal, and a step is a click — which is
//! why Peak has Auto Snap on by default and why this is the first thing built
//! in the edit phase.
//!
//! Snapping moves the *request*, never the document. Nothing here reads or
//! rewrites a clip list: the caller asks where a position should be, and then
//! does whatever it was going to do at the answer. That is what keeps snap out
//! of the render path and out of every existing test.

/// What a position is snapped to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SnapUnit {
    /// Leave the position exactly where it was asked for.
    Off,
    /// The nearest point where the waveform crosses the centre line.
    ZeroCrossing,
    /// The nearest multiple of a fixed number of frames.
    ///
    /// This covers every one of Peak's fixed grids at once, because they differ
    /// only in the number: CD frames are 588, a PS2 loop boundary is 28, an
    /// Xbox one is 64, and "custom units" is whatever you type.
    Grid(u64),
}

impl SnapUnit {
    /// 1/75 second at 44.1 kHz. A region that does not start on one of these
    /// can put a gap between two CD tracks that were meant to run together.
    pub const CD_FRAME: u64 = 588;
    pub const PS2_LOOP: u64 = 28;
    pub const XBOX_LOOP: u64 = 64;

    /// Parse the name the interface sends. Anything unrecognised is `Off`
    /// rather than a guess — a snap that moves an edit somewhere the user did
    /// not ask for is worse than no snap.
    pub fn from_str(s: &str) -> SnapUnit {
        match s {
            "zero" => SnapUnit::ZeroCrossing,
            "cd" => SnapUnit::Grid(Self::CD_FRAME),
            "ps2" => SnapUnit::Grid(Self::PS2_LOOP),
            "xbox" => SnapUnit::Grid(Self::XBOX_LOOP),
            other => match other.strip_prefix("grid:").and_then(|n| n.parse::<u64>().ok()) {
                Some(n) if n > 0 => SnapUnit::Grid(n),
                _ => SnapUnit::Off,
            },
        }
    }

    pub fn as_str(&self) -> String {
        match self {
            SnapUnit::Off => "off".into(),
            SnapUnit::ZeroCrossing => "zero".into(),
            SnapUnit::Grid(Self::CD_FRAME) => "cd".into(),
            SnapUnit::Grid(Self::PS2_LOOP) => "ps2".into(),
            SnapUnit::Grid(Self::XBOX_LOOP) => "xbox".into(),
            SnapUnit::Grid(n) => format!("grid:{n}"),
        }
    }

    /// Does this unit need audio to resolve?
    ///
    /// The grids are arithmetic; only zero crossings require the caller to go
    /// and read samples, which is expensive enough to be worth asking about.
    pub fn needs_audio(&self) -> bool {
        matches!(self, SnapUnit::ZeroCrossing)
    }
}

/// Nearest multiple of `n` to `pos`, rounding a half up.
pub fn snap_grid(pos: u64, n: u64) -> u64 {
    if n <= 1 {
        return pos;
    }
    let down = pos - pos % n;
    let rem = pos - down;
    if rem * 2 >= n {
        down + n
    } else {
        down
    }
}

/// How far from `pos` a frame may be pulled, as a share of one sample rate.
///
/// Ten milliseconds. Far enough to reach the next crossing in anything down to
/// about 100 Hz, near enough that the snap never moves an edit somewhere the
/// user would notice it had gone.
pub const DEFAULT_RADIUS_MS: f32 = 10.0;

pub fn radius_frames(sample_rate: u32) -> u64 {
    ((sample_rate as f32) * DEFAULT_RADIUS_MS / 1000.0) as u64
}

/// The frame nearest `centre` at which the waveform crosses zero.
///
/// `buf` is interleaved, `channels` wide, and holds the frames beginning at
/// `base`. `centre` is an absolute frame number in the same space. Returns
/// `None` when there is no crossing in the window at all, which is the honest
/// answer for a run of silence or a signal sitting entirely on one side of the
/// line — the caller then leaves the position where it was.
///
/// A crossing is looked for **per channel** rather than in the mono mix. Two
/// channels in opposite phase sum to nothing at all, and a mix-based search
/// would call every frame of that file a crossing and every frame a click. Any
/// channel changing sign marks the boundary; the landing point is then whichever
/// of the two frames either side of it has the smaller peak across *all*
/// channels, because the click a cut makes is the largest step in any one of
/// them.
pub fn nearest_zero_crossing(
    buf: &[f32],
    channels: usize,
    base: u64,
    centre: u64,
    radius: u64,
) -> Option<u64> {
    let channels = channels.max(1);
    let frames = buf.len() / channels;
    if frames < 2 {
        return None;
    }

    // Peak across the channels at one frame: what a splice here would step by.
    let cost = |i: usize| -> f32 {
        (0..channels).fold(0.0f32, |m, ch| m.max(buf[i * channels + ch].abs()))
    };

    let mut best: Option<(u64, f32, u64)> = None; // (distance, cost, frame)
    for i in 1..frames {
        let crossed = (0..channels).any(|ch| {
            let a = buf[(i - 1) * channels + ch];
            let b = buf[i * channels + ch];
            (a <= 0.0 && b > 0.0) || (a >= 0.0 && b < 0.0)
        });
        if !crossed {
            continue;
        }
        // The crossing lies between the two frames; land on the quieter one.
        let land = if cost(i) <= cost(i - 1) { i } else { i - 1 };
        let frame = base + land as u64;
        let dist = frame.abs_diff(centre);
        if dist > radius {
            continue;
        }
        let c = cost(land);
        // Nearest wins. Two crossings the same distance away — one either side
        // — are settled by amplitude and then by taking the earlier, so the
        // answer never depends on which order the buffer happened to be walked.
        let better = match best {
            None => true,
            Some((bd, bc, bf)) => (dist, c, frame) < (bd, bc, bf),
        };
        if better {
            best = Some((dist, c, frame));
        }
    }
    best.map(|(_, _, f)| f)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// One cycle of a sine per `period` frames, so the crossings are known.
    fn sine(frames: usize, period: f32) -> Vec<f32> {
        (0..frames)
            .map(|i| (i as f32 / period * std::f32::consts::TAU).sin())
            .collect()
    }

    #[test]
    fn a_grid_snaps_to_the_nearest_multiple() {
        assert_eq!(snap_grid(0, 588), 0);
        assert_eq!(snap_grid(100, 588), 0);
        assert_eq!(snap_grid(294, 588), 588); // exactly half rounds up
        assert_eq!(snap_grid(500, 588), 588);
        assert_eq!(snap_grid(588, 588), 588);
    }

    #[test]
    fn a_grid_of_one_or_zero_leaves_the_position_alone() {
        assert_eq!(snap_grid(1234, 1), 1234);
        assert_eq!(snap_grid(1234, 0), 1234);
    }

    #[test]
    fn the_names_the_interface_sends_round_trip() {
        for s in ["off", "zero", "cd", "ps2", "xbox", "grid:441"] {
            assert_eq!(SnapUnit::from_str(s).as_str(), s, "{s}");
        }
        assert_eq!(SnapUnit::from_str("cd"), SnapUnit::Grid(588));
        // An unknown unit must not become a guess.
        assert_eq!(SnapUnit::from_str("bars"), SnapUnit::Off);
        assert_eq!(SnapUnit::from_str("grid:0"), SnapUnit::Off);
    }

    #[test]
    fn a_crossing_is_found_and_it_is_the_nearest_one() {
        // Period 100: crossings at 0, 50, 100, 150, ...
        let buf = sine(400, 100.0);
        assert_eq!(nearest_zero_crossing(&buf, 1, 0, 60, 40), Some(50));
        assert_eq!(nearest_zero_crossing(&buf, 1, 0, 90, 40), Some(100));
        // Dead between two crossings: whichever it picks must be one of them.
        let mid = nearest_zero_crossing(&buf, 1, 0, 75, 40).unwrap();
        assert!(mid == 50 || mid == 100, "got {mid}");
    }

    #[test]
    fn snapping_lands_where_the_signal_is_quieter_than_where_it_was_asked() {
        let buf = sine(400, 100.0);
        let asked = 75usize; // the peak of the cycle
        let got = nearest_zero_crossing(&buf, 1, 0, asked as u64, 40).unwrap();
        assert!(
            buf[got as usize].abs() < buf[asked].abs() * 0.1,
            "asked {} at {:.3}, landed {} at {:.3}",
            asked,
            buf[asked],
            got,
            buf[got as usize]
        );
    }

    #[test]
    fn a_cut_at_a_snapped_edge_steps_far_less_than_one_where_it_was_asked() {
        // This is the whole reason snap exists, so it is asserted directly:
        // the discontinuity a splice would make, snapped versus not.
        let buf = sine(400, 100.0);
        let (a, b) = (75usize, 225usize); // both at a peak, opposite signs
        let raw_step = (buf[b] - buf[a]).abs();

        let sa = nearest_zero_crossing(&buf, 1, 0, a as u64, 40).unwrap() as usize;
        let sb = nearest_zero_crossing(&buf, 1, 0, b as u64, 40).unwrap() as usize;
        let snapped_step = (buf[sb] - buf[sa]).abs();

        assert!(raw_step > 1.9, "the unsnapped splice should be a big step");
        assert!(
            snapped_step < raw_step / 20.0,
            "snapped step {snapped_step:.4} vs raw {raw_step:.4}"
        );
    }

    #[test]
    fn nothing_is_found_when_the_window_never_crosses() {
        // A signal sitting entirely above the line.
        let buf: Vec<f32> = (0..200).map(|i| 0.5 + i as f32 * 0.001).collect();
        assert_eq!(nearest_zero_crossing(&buf, 1, 0, 100, 40), None);
        // And silence, which has no crossing to find either.
        assert_eq!(nearest_zero_crossing(&vec![0.0; 200], 1, 0, 100, 40), None);
    }

    #[test]
    fn the_radius_is_respected() {
        let buf = sine(400, 100.0);
        // Crossings at 50 and 100; from 75 with a radius of 10 neither is
        // reachable, so the position must be left alone.
        assert_eq!(nearest_zero_crossing(&buf, 1, 0, 75, 10), None);
    }

    #[test]
    fn the_buffer_may_start_anywhere_in_the_file() {
        let buf = sine(400, 100.0);
        // Same audio, offered as if it began at frame 1000.
        let shifted = &buf[40..140]; // frames 1040..1140 in the caller's terms
        assert_eq!(nearest_zero_crossing(shifted, 1, 1040, 1060, 40), Some(1050));
    }

    #[test]
    fn two_channels_in_opposite_phase_still_snap_to_a_real_crossing() {
        // The reason crossings are looked for per channel: the mono mix of
        // this file is zero everywhere, so a mix-based search would either
        // find nothing or call every frame a crossing.
        let m = sine(400, 100.0);
        let mut buf = Vec::with_capacity(800);
        for v in &m {
            buf.push(*v);
            buf.push(-*v);
        }
        let got = nearest_zero_crossing(&buf, 2, 0, 60, 40).unwrap();
        assert_eq!(got, 50);
        assert!(buf[got as usize * 2].abs() < 0.01);
        assert!(buf[got as usize * 2 + 1].abs() < 0.01);
    }

    #[test]
    fn a_stereo_snap_is_judged_on_the_louder_channel() {
        // Left crosses at 50; right is a loud constant that never crosses.
        // Landing on left's crossing is still right, but the frame chosen must
        // be scored on the peak across both, not on the channel that crossed.
        let m = sine(200, 100.0);
        let mut buf = Vec::new();
        for v in &m {
            buf.push(*v);
            buf.push(0.8);
        }
        let got = nearest_zero_crossing(&buf, 2, 0, 60, 40).unwrap();
        assert_eq!(got, 50);
    }

    #[test]
    fn a_buffer_too_short_to_hold_a_crossing_is_not_a_panic() {
        assert_eq!(nearest_zero_crossing(&[], 1, 0, 0, 10), None);
        assert_eq!(nearest_zero_crossing(&[0.5], 1, 0, 0, 10), None);
        assert_eq!(nearest_zero_crossing(&[0.5, -0.5], 2, 0, 0, 10), None);
    }
}

//! Resolving lanes into rack writes, and the ranges of what they drive.

use super::*;

/// Resolve every lane into rack writes for one instant.
///
/// Slot indices are the spec's, which `RackSpec::build` keeps aligned with the
/// built rack even across bypassed slots. The master maximiser is the slot
/// after the last one, because that is where `build` puts it.
pub fn rack_controls(
    a: &Automation,
    spec: &crate::rack::RackSpec,
    frame: u64,
    sample_rate: u32,
    out: &mut Vec<Write>,
) {
    out.clear();
    if a.bypassed {
        return;
    }
    let seconds = frame as f64 / sample_rate.max(1) as f64;
    for lane in &a.lanes {
        let Some(unit) = lane.value_at(frame, seconds) else {
            continue;
        };
        if lane.target == "rack.master.amount" {
            if spec.master.is_active() {
                out.push((spec.slots.len(), "amount".to_string(), unit));
            }
            continue;
        }
        let Some(rest) = lane.target.strip_prefix("fx.") else {
            continue;
        };
        // `fx.<slot id>.<key>`. By name, not by position: dragging a module
        // along the rail must take its lanes with it, and a lane that followed
        // the position instead would silently land on whatever moved into it.
        let Some((id, key)) = rest.split_once('.') else {
            continue;
        };
        let Some(slot) = spec.slot_ids.iter().position(|x| x == id) else {
            continue;
        };
        let Some(spec_slot) = spec.slots.get(slot) else {
            continue;
        };
        if let Some(value) = resolve(spec_slot, key, unit) {
            out.push((slot, key.to_string(), value));
        }
    }
}

/// A unit value as the real value that slot's control takes.
///
/// Every range here is a constant owned by the effect, not a number written out
/// again. That is the whole point of storing lanes as units.
pub fn resolve(slot: &crate::rack::SlotSpec, key: &str, unit: f32) -> Option<f32> {
    use crate::rack::SlotSpec;
    let lerp = |a: f32, b: f32| a + (b - a) * unit;
    let log = |a: f32, b: f32| (a.ln() + (b.ln() - a.ln()) * unit.clamp(0.0, 1.0)).exp();
    Some(match slot {
        SlotSpec::Gain { .. } if key == "db" => lerp(fx::GAIN_DB_MIN, fx::GAIN_DB_MAX),
        SlotSpec::Eq { .. } => {
            use fx::eq::*;
            // `band.<n>.<field>`; the trailing field is what carries the range.
            match key.rsplit_once('.')?.1 {
                "freq" => log(EQ_FREQ_MIN, EQ_FREQ_MAX),
                "q" => log(EQ_Q_MIN, EQ_Q_MAX),
                "gainDb" => lerp(EQ_GAIN_MIN, EQ_GAIN_MAX),
                // A switch and a filter type are steps, not sweeps, but a lane
                // can still drive them — a band that comes in at a moment.
                "enabled" => lerp(0.0, 1.0),
                "mode" => lerp(0.0, 5.0),
                _ => return None,
            }
        }
        SlotSpec::Comp { .. } => {
            use fx::comp::*;
            match key {
                "thresholdDb" => lerp(COMP_THRESHOLD_MIN, 0.0),
                "ratio" => lerp(COMP_RATIO_MIN, COMP_RATIO_MAX),
                "attackMs" => log(COMP_ATTACK_MIN, COMP_ATTACK_MAX),
                "releaseMs" => log(COMP_RELEASE_MIN, COMP_RELEASE_MAX),
                "kneeDb" => lerp(0.0, COMP_KNEE_MAX),
                "makeupDb" => lerp(COMP_MAKEUP_MIN, COMP_MAKEUP_MAX),
                _ => return None,
            }
        }
        // The shapers describe themselves, so there is nothing to write down.
        SlotSpec::Shape { kind, .. } => kind.specs().iter().find(|p| p.key == key)?.from_unit(unit),
        // Through the crate's own clamp too, so a choice lands on a choice.
        SlotSpec::Prism { id, .. } => {
            let v = fx::prism::specs(id)?.iter().find(|p| p.key == key)?.from_unit(unit);
            fx::prism::clamp(id, key, v)?
        }
        _ => return None,
    })
}

/// How a stretch target's lane value becomes a number, and back.
///
/// Every range is written once, in the same table that names the target and
/// labels it for the menu. The version this replaced had three matches on the
/// same names — a value map, a field reader and a field writer — and a test to
/// catch them drifting. A table cannot drift, and a target is added by adding a
/// line to it and one arm to each of the two accessors below, which the same
/// test still insists on.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Range {
    /// A straight line from the first number to the second.
    Lin(f32, f32),
    /// A logarithmic sweep, for the controls whose slider is one.
    Log(f32, f32),
    /// Whole numbers from the first to the second, rounded.
    Int(f32, f32),
    /// Off below a half, on from a half. A lane can still drive it — a switch
    /// thrown at a moment is a performance too.
    Switch,
}

impl Range {
    /// The number a lane value stands for.
    pub fn value(self, u: f32) -> f32 {
        let u = u.clamp(0.0, 1.0);
        match self {
            Range::Lin(lo, hi) => lo + u * (hi - lo),
            Range::Log(lo, hi) => (lo.ln() + (hi.ln() - lo.ln()) * u).exp(),
            Range::Int(lo, hi) => (lo + u * (hi - lo)).round(),
            Range::Switch => {
                if u >= 0.5 {
                    1.0
                } else {
                    0.0
                }
            }
        }
    }

    /// The lane value that stands for a number — the exact inverse, so a
    /// recorded move lands where the control was.
    ///
    /// No search. `unit_for` bisects a forward map, which is right for the rack's
    /// smooth ranges and wrong for a step: a switch or a count has flat runs,
    /// and bisection on a flat run lands on the edge of it, where a rounding
    /// error decides which side the take plays back on.
    pub fn unit(self, v: f32) -> f32 {
        let u = match self {
            Range::Lin(lo, hi) | Range::Int(lo, hi) => {
                if hi == lo {
                    0.0
                } else {
                    (v - lo) / (hi - lo)
                }
            }
            Range::Log(lo, hi) => (v.max(lo).ln() - lo.ln()) / (hi.ln() - lo.ln()),
            Range::Switch => {
                if v >= 0.5 {
                    1.0
                } else {
                    0.0
                }
            }
        };
        u.clamp(0.0, 1.0)
    }
}

/// Every document control a lane can drive: its name, the label the menu
/// shows, and its range. The ranges are the document's own — what
/// `persist::stretch_from_json` clamps to; if one moves, both move.
///
/// **Only what the engine takes while it is running.** The runner writes these
/// straight into the audio thread's parameters a hundred and twenty times a
/// second, with no rebuild in between. So the ones that *are* a rebuild are not
/// here, on purpose:
///
/// - the engine and its quality — where you are, not a setting (`Reset all`
///   makes the same argument);
/// - the hybrid's FFT size, time span and frequency span, which separate the
///   whole file again (`live::separate_soon`);
/// - WSOLA's transient preservation, which runs an onset detector over the
///   whole file (`live::map_for`);
/// - the WSOLA splice and window choices, the vocoder's nothing, and the tuning
///   scale — choices rather than sweeps, with no order a line could run along;
/// - the seed, which is the document's, and `layer_read`, which has no control.
pub const STRETCH_TARGETS: &[(&str, &str, Range)] = &[
    // The document's own three, and the cloud's blend over the engine.
    ("stretch.ratio", "Time & Pitch — Stretch", Range::Log(RATIO_MIN, RATIO_MAX)),
    ("stretch.semitones", "Time & Pitch — Pitch", Range::Lin(SEMITONE_MIN, SEMITONE_MAX)),
    ("stretch.windowMs", "Time & Pitch — Window", Range::Log(WINDOW_MS_MIN, WINDOW_MS_MAX)),
    ("stretch.cloudMix", "Time & Pitch — Cloud over engine", Range::Lin(0.0, 1.0)),
    // Grain shape.
    ("stretch.grain.position", "Grains — Read position", Range::Lin(-1.0, 1.0)),
    ("stretch.grain.rateHz", "Grains — Rate", Range::Lin(0.0, 2000.0)),
    ("stretch.grain.densityHz", "Grains — Density", Range::Lin(0.0, DENSITY_MAX)),
    ("stretch.grain.layers", "Grains — Layers", Range::Int(1.0, fx::grain::MAX_LAYERS as f32)),
    ("stretch.grain.overlap", "Grains — Overlap", Range::Lin(1.0, 8.0)),
    ("stretch.grain.sizeJitter", "Grains — Size jitter", Range::Lin(0.0, 1.0)),
    ("stretch.grain.positionJitterMs", "Grains — Position jitter", Range::Lin(0.0, POS_JITTER_MAX)),
    // Pitch movement.
    ("stretch.grain.pitchJitterSemis", "Pitch movement — Pitch jitter", Range::Lin(0.0, PITCH_JITTER_MAX)),
    ("stretch.grain.pitchDriftSemis", "Pitch movement — Pitch drift", Range::Lin(0.0, 24.0)),
    ("stretch.grain.driftRateHz", "Pitch movement — Drift rate", Range::Log(0.01, 20.0)),
    ("stretch.grain.driftStep", "Pitch movement — Step the drift", Range::Switch),
    ("stretch.grain.linkJitter", "Pitch movement — Link jitter", Range::Switch),
    // Scan and shape.
    ("stretch.grain.scan", "Scan & shape — Scan", Range::Lin(-4.0, 4.0)),
    ("stretch.grain.reverse", "Scan & shape — Reverse grains", Range::Switch),
    ("stretch.grain.wrap", "Scan & shape — Wrap positions", Range::Switch),
    ("stretch.grain.envelope", "Scan & shape — Envelope", Range::Lin(0.0, 1.0)),
    ("stretch.grain.sizeRange", "Scan & shape — Size range", Range::Lin(1.0, 8.0)),
    ("stretch.grain.layerSpread", "Scan & shape — Layer spread", Range::Lin(0.0, 4.0)),
    ("stretch.grain.layerScatter", "Scan & shape — Layer scatter", Range::Lin(0.0, 1.0)),
    ("stretch.grain.layerScatterMs", "Scan & shape — Scatter range", Range::Lin(0.0, 5000.0)),
    ("stretch.grain.panSpread", "Scan & shape — Pan spread", Range::Lin(0.0, 1.0)),
    ("stretch.grain.fbAmount", "Feedback — Feedback", Range::Lin(0.0, 0.95)),
    ("stretch.grain.fbTimeMs", "Feedback — Time", Range::Lin(20.0, 2000.0)),
    ("stretch.grain.fbSmear", "Feedback — Smear", Range::Lin(0.0, 1.0)),
    ("stretch.grain.fbDamp", "Feedback — Damp", Range::Lin(0.0, 1.0)),
    ("stretch.grain.fbShift", "Feedback — Shift", Range::Lin(-12.0, 12.0)),
    ("stretch.grain.fbHold", "Feedback — Hold the loop", Range::Switch),
    // WSOLA.
    ("stretch.wsola.sensitivity", "WSOLA — Detector", Range::Lin(0.0, 1.0)),
    ("stretch.wsola.searchMs", "WSOLA — Search", Range::Lin(0.0, 200.0)),
    ("stretch.wsola.stride", "WSOLA — Stride", Range::Int(1.0, 256.0)),
    ("stretch.wsola.guardHops", "WSOLA — Guard", Range::Lin(1.0, 16.0)),
    ("stretch.wsola.floor", "WSOLA — Floor", Range::Lin(0.0, 2.0)),
    // Vocoder.
    ("stretch.vocoder.windowMs", "Vocoder — Analysis window", Range::Log(5.0, 500.0)),
    ("stretch.vocoder.phaseLock", "Vocoder — Phase lock", Range::Switch),
    ("stretch.vocoder.freqTrust", "Vocoder — Freq trust", Range::Lin(0.0, 4.0)),
    ("stretch.vocoder.phaseSpread", "Vocoder — Phase spread", Range::Lin(0.0, 4.0)),
    ("stretch.vocoder.peakWidth", "Vocoder — Peak width", Range::Int(1.0, 32.0)),
    ("stretch.vocoder.lockWidth", "Vocoder — Lock width", Range::Lin(0.0, 4.0)),
    ("stretch.vocoder.magFreeze", "Vocoder — Freeze", Range::Lin(0.0, 1.0)),
    ("stretch.vocoder.magBlur", "Vocoder — Blur", Range::Lin(0.0, 1.0)),
    ("stretch.vocoder.magGate", "Vocoder — Gate", Range::Lin(0.0, 1.0)),
    ("stretch.vocoder.stereoLink", "Vocoder — Link stereo", Range::Switch),
    // PVSOLA.
    ("stretch.pvsola.anchorFrames", "PVSOLA — Re-anchor", Range::Int(1.0, 64.0)),
    ("stretch.pvsola.searchMs", "PVSOLA — Search", Range::Lin(0.0, 200.0)),
    ("stretch.pvsola.blend", "PVSOLA — Blend", Range::Lin(0.0, 1.0)),
    // Hybrid — the levels and the margin, which the separation reads live.
    ("stretch.hybrid.margin", "Hybrid — Margin", Range::Lin(1.0, 8.0)),
    ("stretch.hybrid.morphNoise", "Hybrid — Remake noise", Range::Switch),
    ("stretch.hybrid.harmonicLevel", "Hybrid — Tone", Range::Lin(0.0, 4.0)),
    ("stretch.hybrid.percussiveLevel", "Hybrid — Hits", Range::Lin(0.0, 4.0)),
    ("stretch.hybrid.residualLevel", "Hybrid — Air", Range::Lin(0.0, 4.0)),
    // Hyperprism's Pitch Time Changer, a document setting like the stretch:
    // its window's two axes and four settings, linear, in percent.
    ("ptc.speed", "Pitch Time Changer — Speed", Range::Lin(1.0, 200.0)),
    ("ptc.pitch", "Pitch Time Changer — Pitch", Range::Lin(0.0, 200.0)),
    ("ptc.feedback", "Pitch Time Changer — Feedback", Range::Lin(0.0, 100.0)),
    ("ptc.grain", "Pitch Time Changer — Grain size", Range::Lin(1.0, 100.0)),
    ("ptc.xfade", "Pitch Time Changer — X-fade size", Range::Lin(0.0, 100.0)),
    ("ptc.smoothing", "Pitch Time Changer — Smoothing", Range::Lin(0.0, 100.0)),
];

/// A target's range, if it is one of the document's.
pub fn stretch_range(target: &str) -> Option<Range> {
    STRETCH_TARGETS.iter().find(|(t, _, _)| *t == target).map(|(_, _, r)| *r)
}

/// A stretch lane's unit value as the number the document's control takes.
pub fn stretch_value(target: &str, u: f32) -> Option<f32> {
    stretch_range(target).map(|r| r.value(u))
}

/// The lane value that stands for a control's number — what recording writes.
pub fn stretch_unit(target: &str, value: f32) -> Option<f32> {
    stretch_range(target).map(|r| r.unit(value))
}

/// Where a stretch target's value lives on the document.
///
/// The mirror of the match in [`apply_stretch`], for reading rather than
/// writing: recording has to notice that a control moved and by how much, and
/// the only thing that knows which field "stretch.ratio" means is a list of
/// names. Switches read as nought or one and counts as their number, which is
/// what [`Range::unit`] expects back. Pinned against the table by
/// `every_offered_target_actually_resolves`, so a line added to the table and
/// not here fails the suite rather than going quietly unrecordable.
pub fn stretch_field(s: &fx::Stretch, target: &str) -> Option<f32> {
    let b = |on: bool| if on { 1.0 } else { 0.0 };
    let g = &s.grain;
    Some(match target {
        "stretch.ratio" => s.ratio,
        "stretch.semitones" => s.semitones,
        "stretch.windowMs" => s.window_ms,
        "stretch.cloudMix" => s.cloud_mix,
        "stretch.grain.position" => g.position,
        "stretch.grain.rateHz" => g.rate_hz,
        "stretch.grain.densityHz" => g.density_hz,
        "stretch.grain.layers" => g.layers as f32,
        "stretch.grain.overlap" => g.overlap,
        "stretch.grain.sizeJitter" => g.size_jitter,
        "stretch.grain.positionJitterMs" => g.position_jitter_ms,
        "stretch.grain.pitchJitterSemis" => g.pitch_jitter_semis,
        "stretch.grain.pitchDriftSemis" => g.pitch_drift_semis,
        "stretch.grain.driftRateHz" => g.drift_rate_hz,
        "stretch.grain.driftStep" => b(g.drift_step),
        "stretch.grain.linkJitter" => b(g.link_jitter),
        "stretch.grain.scan" => g.scan,
        "stretch.grain.reverse" => b(g.reverse),
        "stretch.grain.wrap" => b(g.wrap),
        "stretch.grain.envelope" => g.envelope,
        "stretch.grain.sizeRange" => g.size_range,
        "stretch.grain.layerSpread" => g.layer_spread,
        "stretch.grain.layerScatter" => g.layer_scatter,
        "stretch.grain.layerScatterMs" => g.layer_scatter_ms,
        "stretch.grain.panSpread" => g.pan_spread,
        "stretch.grain.fbAmount" => g.fb_amount,
        "stretch.grain.fbTimeMs" => g.fb_time_ms,
        "stretch.grain.fbSmear" => g.fb_smear,
        "stretch.grain.fbDamp" => g.fb_damp,
        "stretch.grain.fbShift" => g.fb_shift,
        "stretch.grain.fbHold" => b(g.fb_hold),
        "stretch.wsola.sensitivity" => s.wsola.sensitivity,
        "stretch.wsola.searchMs" => s.wsola.search_ms,
        "stretch.wsola.stride" => s.wsola.stride as f32,
        "stretch.wsola.guardHops" => s.wsola.guard_hops,
        "stretch.wsola.floor" => s.wsola.floor,
        "stretch.vocoder.windowMs" => s.vocoder.window_ms,
        "stretch.vocoder.phaseLock" => b(s.vocoder.phase_lock),
        "stretch.vocoder.freqTrust" => s.vocoder.freq_trust,
        "stretch.vocoder.phaseSpread" => s.vocoder.phase_spread,
        "stretch.vocoder.peakWidth" => s.vocoder.peak_width as f32,
        "stretch.vocoder.lockWidth" => s.vocoder.lock_width,
        "stretch.vocoder.magFreeze" => s.vocoder.mag_freeze,
        "stretch.vocoder.magBlur" => s.vocoder.mag_blur,
        "stretch.vocoder.magGate" => s.vocoder.mag_gate,
        "stretch.vocoder.stereoLink" => b(s.vocoder.stereo_link),
        "stretch.pvsola.anchorFrames" => s.pvsola.anchor_frames as f32,
        "stretch.pvsola.searchMs" => s.pvsola.search_ms,
        "stretch.pvsola.blend" => s.pvsola.blend,
        "stretch.hybrid.margin" => s.hybrid.margin,
        "stretch.hybrid.morphNoise" => b(s.hybrid.morph_noise),
        "stretch.hybrid.harmonicLevel" => s.hybrid.harmonic_level,
        "stretch.hybrid.percussiveLevel" => s.hybrid.percussive_level,
        "stretch.hybrid.residualLevel" => s.hybrid.residual_level,
        _ => return None,
    })
}

/// A pad's take as one list: `(frame, x, y)` at every frame either lane has a
/// point at, each lane's value there from `curve_value`. Empty unless both
/// targets have a lane with points.
pub fn path(a: &Automation, x: &str, y: &str) -> Vec<(u64, f32, f32)> {
    let lane = |t: &str| a.lanes.iter().find(|l| l.target == t && !l.points.is_empty());
    let (Some(lx), Some(ly)) = (lane(x), lane(y)) else {
        return Vec::new();
    };
    let mut frames: Vec<u64> = lx.points.iter().chain(&ly.points).map(|p| p.frame).collect();
    frames.sort_unstable();
    frames.dedup();
    frames
        .into_iter()
        .filter_map(|f| Some((f, curve_value(&lx.points, f)?, curve_value(&ly.points, f)?)))
        .collect()
}

/// Loop the pad's two lanes over the span of the take, or stop looping them.
/// `false` if either has no lane with points.
pub fn loop_path(a: &mut Automation, x: &str, y: &str, on: bool) -> bool {
    let span = path(a, x, y);
    let (Some(first), Some(last)) = (span.first(), span.last()) else {
        return false;
    };
    let range = (on && last.0 > first.0).then_some((first.0, last.0));
    for l in a.lanes.iter_mut().filter(|l| l.target == x || l.target == y) {
        l.loop_range = range;
    }
    true
}

/// The lane value that would produce `value`, by searching the forward map.
///
/// For the rack's controls, whose ranges live in `resolve`. Every mapping there
/// is monotonic in the unit — a straight line or a logarithmic one — so
/// bisection finds the answer to more precision than a lane can hold, in a
/// fixed forty steps. The document's own controls do not come through here:
/// their table knows its inverse.
///
/// A rack control can be a step too — a prism effect's count or choice — and
/// on a step the search closes in on the edge between two values, where the
/// middle of the bracket may still read as the lower one. So the answer is
/// whichever of the middle and the two ends gives the value back closest, the
/// middle first: on a smooth control they all agree.
///
/// Returns `None` for a target the forward function does not know, which is
/// the same answer everything else here gives to a name it cannot resolve.
pub fn unit_for(forward: impl Fn(f32) -> Option<f32>, value: f32) -> Option<f32> {
    let (mut lo, mut hi) = (0.0f32, 1.0f32);
    let at_lo = forward(lo)?;
    let at_hi = forward(hi)?;
    // Ranges that run downwards are as valid as ones that run up.
    let rising = at_hi >= at_lo;
    for _ in 0..40 {
        let mid = 0.5 * (lo + hi);
        let here = forward(mid)?;
        if (here < value) == rising {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    let miss = |u: f32| forward(u).map_or(f32::INFINITY, |v| (v - value).abs());
    let best = [0.5 * (lo + hi), hi, lo]
        .into_iter()
        .fold((f32::INFINITY, 0.5 * (lo + hi)), |(m, b), u| if miss(u) < m { (miss(u), u) } else { (m, b) })
        .1;
    Some(best.clamp(0.0, 1.0))
}

/// Apply the stretch and grain lanes to a set of stream parameters.
///
/// Hyperprism's Pitch Time Changer under its lanes, at `frame`. Playback and
/// export both call it, as they do [`apply_stretch`].
pub fn apply_pitch_time(a: &Automation, p: &mut engine::transport::PitchTime, frame: u64, sample_rate: u32) {
    if a.bypassed {
        return;
    }
    let seconds = frame as f64 / sample_rate.max(1) as f64;
    for l in a.lanes.iter().filter(|l| l.enabled && l.target.starts_with("ptc.")) {
        let (Some(u), Some(field)) = (l.value_at(frame, seconds), l.target.strip_prefix("ptc.")) else {
            continue;
        };
        let Some(v) = stretch_value(&l.target, u) else { continue };
        match field {
            "speed" => p.speed = v,
            "pitch" => p.pitch = v,
            "feedback" => p.feedback = v,
            "grain" => p.grain = v,
            "xfade" => p.xfade = v,
            "smoothing" => p.smoothing = v,
            _ => {}
        }
    }
}

/// Kept apart from [`rack_controls`] because these are properties of the
/// document, not of a rack slot — and because both playback *and* export have
/// to call it. The export used not to, so a pitch or ratio lane was audible and
/// then absent from the file, which is the one thing this program does not do.
pub fn apply_stretch(a: &Automation, p: &mut fx::grain::StreamParams, frame: u64, sample_rate: u32) {
    if a.bypassed {
        return;
    }
    let seconds = frame as f64 / sample_rate.max(1) as f64;
    for l in &a.lanes {
        let Some(u) = l.value_at(frame, seconds) else {
            continue;
        };
        // The ranges live in the table; this only decides which field the
        // answer lands in.
        let Some(v) = stretch_value(&l.target, u) else {
            continue;
        };
        set_stream_field(p, &l.target, v);
    }
}

/// Put one number into the field of the stream parameters a target names.
/// `false` for a name that is not one of them. The running LFOs write through
/// this too (`grain_lfos`), so the two cannot disagree about which field is
/// which.
pub fn set_stream_field(p: &mut fx::grain::StreamParams, target: &str, v: f32) -> bool {
    let on = v >= 0.5;
    let n = v.round().max(0.0) as u32;
    let g = &mut p.grain;
    match target {
        "stretch.ratio" => p.ratio = v,
        "stretch.semitones" => p.semitones = v,
        "stretch.windowMs" => p.window_ms = v,
        "stretch.cloudMix" => p.cloud_mix = v,
        "stretch.grain.position" => g.position = v,
        "stretch.grain.rateHz" => g.rate_hz = v,
        "stretch.grain.densityHz" => g.density_hz = v,
        "stretch.grain.layers" => g.layers = n,
        "stretch.grain.overlap" => g.overlap = v,
        "stretch.grain.sizeJitter" => g.size_jitter = v,
        "stretch.grain.positionJitterMs" => g.position_jitter_ms = v,
        "stretch.grain.pitchJitterSemis" => g.pitch_jitter_semis = v,
        "stretch.grain.pitchDriftSemis" => g.pitch_drift_semis = v,
        "stretch.grain.driftRateHz" => g.drift_rate_hz = v,
        "stretch.grain.driftStep" => g.drift_step = on,
        "stretch.grain.linkJitter" => g.link_jitter = on,
        "stretch.grain.scan" => g.scan = v,
        "stretch.grain.reverse" => g.reverse = on,
        "stretch.grain.wrap" => g.wrap = on,
        "stretch.grain.envelope" => g.envelope = v,
        "stretch.grain.sizeRange" => g.size_range = v,
        "stretch.grain.layerSpread" => g.layer_spread = v,
        "stretch.grain.layerScatter" => g.layer_scatter = v,
        "stretch.grain.layerScatterMs" => g.layer_scatter_ms = v,
        "stretch.grain.panSpread" => g.pan_spread = v,
        "stretch.grain.fbAmount" => g.fb_amount = v,
        "stretch.grain.fbTimeMs" => g.fb_time_ms = v,
        "stretch.grain.fbSmear" => g.fb_smear = v,
        "stretch.grain.fbDamp" => g.fb_damp = v,
        "stretch.grain.fbShift" => g.fb_shift = v,
        "stretch.grain.fbHold" => g.fb_hold = on,
        "stretch.wsola.sensitivity" => p.wsola.sensitivity = v,
        "stretch.wsola.searchMs" => p.wsola.search_ms = v,
        "stretch.wsola.stride" => p.wsola.stride = n,
        "stretch.wsola.guardHops" => p.wsola.guard_hops = v,
        "stretch.wsola.floor" => p.wsola.floor = v,
        "stretch.vocoder.windowMs" => p.vocoder.window_ms = v,
        "stretch.vocoder.phaseLock" => p.vocoder.phase_lock = on,
        "stretch.vocoder.freqTrust" => p.vocoder.freq_trust = v,
        "stretch.vocoder.phaseSpread" => p.vocoder.phase_spread = v,
        "stretch.vocoder.peakWidth" => p.vocoder.peak_width = n,
        "stretch.vocoder.lockWidth" => p.vocoder.lock_width = v,
        "stretch.vocoder.magFreeze" => p.vocoder.mag_freeze = v,
        "stretch.vocoder.magBlur" => p.vocoder.mag_blur = v,
        "stretch.vocoder.magGate" => p.vocoder.mag_gate = v,
        "stretch.vocoder.stereoLink" => p.vocoder.stereo_link = on,
        "stretch.pvsola.anchorFrames" => p.pvsola.anchor_frames = n,
        "stretch.pvsola.searchMs" => p.pvsola.search_ms = v,
        "stretch.pvsola.blend" => p.pvsola.blend = v,
        "stretch.hybrid.margin" => p.hybrid.margin = v,
        "stretch.hybrid.morphNoise" => p.hybrid.morph_noise = on,
        "stretch.hybrid.harmonicLevel" => p.hybrid.harmonic_level = v,
        "stretch.hybrid.percussiveLevel" => p.hybrid.percussive_level = v,
        "stretch.hybrid.residualLevel" => p.hybrid.residual_level = v,
        _ => return false,
    }
    true
}

// The document's own ranges. These match what `persist::stretch_from_json`
// clamps to; if one moves, both move.
pub const RATIO_MIN: f32 = 0.01;
pub const RATIO_MAX: f32 = 100.0;
pub const SEMITONE_MIN: f32 = -48.0;
pub const SEMITONE_MAX: f32 = 48.0;
pub const WINDOW_MS_MIN: f32 = 5.0;
pub const WINDOW_MS_MAX: f32 = 2000.0;
pub const DENSITY_MAX: f32 = 500.0;
pub const POS_JITTER_MAX: f32 = 500.0;
pub const PITCH_JITTER_MAX: f32 = 24.0;

/// Every target this can address, with the label the interface shows.
///
/// One list, used to build the interface's menu *and* to tell a stale lane from
/// a live one, so the two cannot disagree about what exists.
pub fn targets(spec: &crate::rack::RackSpec) -> Vec<(String, String)> {
    let mut out: Vec<(String, String)> = STRETCH_TARGETS
        .iter()
        .map(|(a, b, _)| (a.to_string(), b.to_string()))
        .collect();

    for (i, slot) in spec.slots.iter().enumerate() {
        let name = slot.kind_label();
        let id = spec.slot_ids.get(i).cloned().unwrap_or_default();
        if id.is_empty() {
            continue;
        }
        let mut add = |key: &str, label: &str| {
            out.push((format!("fx.{id}.{key}"), format!("{name} — {label}")));
        };
        match slot {
            crate::rack::SlotSpec::Gain { .. } => add("db", "Level"),
            crate::rack::SlotSpec::Eq { settings, .. } => {
                // Named for what each node is rather than for its index: "Band
                // 3" means nothing on a menu, and the type can be changed.
                for (i, on) in settings.enabled.iter().enumerate() {
                    let what = crate::rack::eq_band_label(settings.modes[i], i);
                    let off = if *on { "" } else { " (off)" };
                    add(&format!("band.{i}.freq"), &format!("{what} frequency{off}"));
                    add(&format!("band.{i}.q"), &format!("{what} Q{off}"));
                    add(&format!("band.{i}.gainDb"), &format!("{what} gain{off}"));
                    add(&format!("band.{i}.enabled"), &format!("{what} on/off"));
                }
            }
            crate::rack::SlotSpec::Comp { .. } => {
                for (k, l) in [
                    ("thresholdDb", "Threshold"),
                    ("ratio", "Ratio"),
                    ("attackMs", "Attack"),
                    ("releaseMs", "Release"),
                    ("kneeDb", "Knee"),
                    ("makeupDb", "Makeup"),
                ] {
                    add(k, l);
                }
            }
            crate::rack::SlotSpec::Shape { kind, .. } => {
                for p in kind.specs() {
                    add(p.key, p.label);
                }
            }
            crate::rack::SlotSpec::Prism { id, .. } => {
                for p in fx::prism::specs(id).unwrap_or_default() {
                    add(p.key, p.label);
                }
            }
        }
    }
    if spec.master.is_active() {
        out.push((
            "rack.master.amount".into(),
            "Master — Maximiser amount".into(),
        ));
    }
    out
}

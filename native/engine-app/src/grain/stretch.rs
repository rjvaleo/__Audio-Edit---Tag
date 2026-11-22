//! The Grain page's settings: the document's stretch (`fx::Stretch`), as MGL
//! writes and reads it, and as MGL's `/api/edit` changes it.
//!
//! Ported line for line from MGL's server, in MGL's order and with MGL's
//! clamps: `persist::stretch_to_json`, `persist::stretch_from_json` and
//! `persist::soundhack_from` (`core/crates/server-core/src/persist.rs`), and
//! the `"stretch"` arm of `api_edit_apply`
//! (`core/crates/server-engine/src/routes/edit_view.rs`). MGL's own JSON
//! `Value` holds every number as an `f64`, as `serde_json` does here.

use mgl_fx::stretch::{Algorithm, Quality, Splice, WinShape};
use mgl_fx::{Grain, Stretch};
use serde_json::{json, Map, Value};

fn num(v: Option<&Value>, d: f64) -> f64 {
    match v.and_then(Value::as_f64) {
        Some(n) if n.is_finite() => n,
        _ => d,
    }
}

/// A number in an object, or `d` (MGL's `Some(Value::Num(n)) if n.is_finite()`).
fn field(o: Option<&Value>, k: &str, d: f32) -> f32 {
    match o.and_then(|x| x.get(k)).and_then(Value::as_f64) {
        Some(n) if n.is_finite() => n as f32,
        _ => d,
    }
}

fn is_true(v: Option<&Value>) -> bool {
    matches!(v, Some(Value::Bool(true)))
}

fn is_false(v: Option<&Value>) -> bool {
    matches!(v, Some(Value::Bool(false)))
}

/// `Some(Value::Bool(b)) => b, _ => keep`.
fn bool_or(v: Option<&Value>, keep: bool) -> bool {
    match v {
        Some(Value::Bool(b)) => *b,
        _ => keep,
    }
}

pub fn quality_name(q: Quality) -> &'static str {
    match q {
        Quality::Draft => "draft",
        Quality::Standard => "standard",
        Quality::Best => "best",
    }
}

fn quality_from(v: Option<&Value>) -> Quality {
    match v.and_then(Value::as_str) {
        Some("draft") => Quality::Draft,
        Some("best") => Quality::Best,
        _ => Quality::Standard,
    }
}

fn obj(pairs: Vec<(&str, Value)>) -> Value {
    let mut m = Map::new();
    for (k, v) in pairs {
        m.insert(k.to_string(), v);
    }
    Value::Object(m)
}

/// `persist::stretch_to_json`.
pub fn to_json(s: &Stretch) -> Value {
    let f = |x: f32| json!(x as f64);
    obj(vec![
        ("ratio", f(s.ratio)),
        ("semitones", f(s.semitones)),
        ("scale", json!(s.scale.map(|x| x.name).unwrap_or_default())),
        ("pitchStep", f(s.pitch_step)),
        ("windowMs", f(s.window_ms)),
        ("quality", json!(quality_name(s.quality))),
        ("algorithm", json!(s.algorithm.as_str())),
        ("cloud", json!(s.cloud)),
        ("cloudMix", f(s.cloud_mix)),
        (
            "vocoder",
            obj(vec![
                ("windowMs", f(s.vocoder.window_ms)),
                ("phaseLock", json!(s.vocoder.phase_lock)),
                ("freqTrust", f(s.vocoder.freq_trust)),
                ("phaseSpread", f(s.vocoder.phase_spread)),
                ("peakWidth", json!(s.vocoder.peak_width as f64)),
                ("lockWidth", f(s.vocoder.lock_width)),
                ("magFreeze", f(s.vocoder.mag_freeze)),
                ("magBlur", f(s.vocoder.mag_blur)),
                ("magGate", f(s.vocoder.mag_gate)),
                ("stereoLink", json!(s.vocoder.stereo_link)),
            ]),
        ),
        (
            "wsola",
            obj(vec![
                ("preserveTransients", json!(s.wsola.preserve_transients)),
                ("sensitivity", f(s.wsola.sensitivity)),
                ("searchMs", f(s.wsola.search_ms)),
                ("splice", json!(s.wsola.splice.as_str())),
                ("stride", json!(s.wsola.stride as f64)),
                ("shape", json!(s.wsola.shape.as_str())),
                ("guardHops", f(s.wsola.guard_hops)),
                ("floor", f(s.wsola.floor)),
            ]),
        ),
        (
            "pvsola",
            obj(vec![
                ("anchorFrames", json!(s.pvsola.anchor_frames as f64)),
                ("searchMs", f(s.pvsola.search_ms)),
                ("blend", f(s.pvsola.blend)),
            ]),
        ),
        (
            "hybrid",
            obj(vec![
                ("fftSize", json!(s.hybrid.fft_size as f64)),
                ("timeSpan", json!(s.hybrid.time_span as f64)),
                ("freqSpan", json!(s.hybrid.freq_span as f64)),
                ("margin", f(s.hybrid.margin)),
                ("morphNoise", json!(s.hybrid.morph_noise)),
                ("harmonicLevel", f(s.hybrid.harmonic_level)),
                ("percussiveLevel", f(s.hybrid.percussive_level)),
                ("residualLevel", f(s.hybrid.residual_level)),
            ]),
        ),
        ("soundhack", obj(vec![("version", json!(s.soundhack.version.as_str()))])),
        ("grain", grain_json(&s.grain)),
    ])
}

fn grain_json(g: &Grain) -> Value {
    let f = |x: f32| json!(x as f64);
    obj(vec![
        ("rateHz", f(g.rate_hz)),
        ("densityHz", f(g.density_hz)),
        ("overlap", f(g.overlap)),
        ("sizeJitter", f(g.size_jitter)),
        ("positionJitterMs", f(g.position_jitter_ms)),
        ("pitchJitterSemis", f(g.pitch_jitter_semis)),
        ("pitchDriftSemis", f(g.pitch_drift_semis)),
        ("driftRateHz", f(g.drift_rate_hz)),
        ("layers", json!(g.layers as f64)),
        ("seed", json!(g.seed as f64)),
        ("position", f(g.position)),
        ("scan", f(g.scan)),
        ("reverse", json!(g.reverse)),
        ("envelope", f(g.envelope)),
        ("sizeRange", f(g.size_range)),
        ("wrap", json!(g.wrap)),
        ("layerSpread", f(g.layer_spread)),
        ("layerScatter", f(g.layer_scatter)),
        ("layerScatterMs", f(g.layer_scatter_ms)),
        ("linkJitter", json!(g.link_jitter)),
        ("driftStep", json!(g.drift_step)),
        ("panSpread", f(g.pan_spread)),
        ("fbAmount", f(g.fb_amount)),
        ("fbTimeMs", f(g.fb_time_ms)),
        ("fbSmear", f(g.fb_smear)),
        ("fbDamp", f(g.fb_damp)),
        ("fbShift", f(g.fb_shift)),
        ("fbHold", json!(g.fb_hold)),
    ])
}

/// The document's stretch as MGL's `/api/edit` answers it (`docs::edit_json`):
/// the saved shape with `active` and `granular`.
pub fn answer_json(s: &Stretch, active: bool) -> Value {
    let mut v = to_json(s);
    if let Some(o) = v.as_object_mut() {
        o.insert("active".into(), json!(active));
        o.insert("granular".into(), json!(s.is_granular()));
    }
    v
}

/// `persist::soundhack_from`.
pub fn soundhack_from(v: Option<&Value>, fallback: mgl_fx::soundhack::SoundHackParams) -> mgl_fx::soundhack::SoundHackParams {
    mgl_fx::soundhack::SoundHackParams {
        version: v
            .and_then(|x| x.get("version"))
            .and_then(Value::as_str)
            .and_then(mgl_fx::soundhack::Version::from_str)
            .unwrap_or(fallback.version),
    }
}

/// `persist::stretch_from_json`: read back, clamping everything.
pub fn from_json(v: &Value) -> Stretch {
    let d = Stretch::default();
    let g = v.get("grain");
    let gf = |k: &str, dv: f32| field(g, k, dv);
    Stretch {
        ratio: (num(v.get("ratio"), 1.0) as f32).clamp(0.01, 100.0),
        semitones: (num(v.get("semitones"), 0.0) as f32).clamp(-48.0, 48.0),
        scale: v.get("scale").and_then(Value::as_str).and_then(mgl_fx::tuning::by_name),
        pitch_step: (num(v.get("pitchStep"), 0.0) as f32).clamp(0.0, 12.0),
        window_ms: (num(v.get("windowMs"), 40.0) as f32).clamp(5.0, 2000.0),
        cloud: is_true(v.get("cloud")),
        cloud_mix: (num(v.get("cloudMix"), d.cloud_mix as f64) as f32).clamp(0.0, 1.0),
        quality: quality_from(v.get("quality")),
        algorithm: v.get("algorithm").and_then(Value::as_str).and_then(Algorithm::from_str).unwrap_or(d.algorithm),
        wsola: {
            let d = mgl_fx::stretch::WsolaParams::default();
            let wv = v.get("wsola");
            let wf = |k: &str, dv: f32| field(wv, k, dv);
            mgl_fx::stretch::WsolaParams {
                preserve_transients: is_true(wv.and_then(|x| x.get("preserveTransients"))),
                sensitivity: wf("sensitivity", d.sensitivity).clamp(0.0, 1.0),
                search_ms: wf("searchMs", d.search_ms).clamp(0.0, 200.0),
                splice: wv.and_then(|x| x.get("splice")).and_then(Value::as_str).and_then(Splice::from_str).unwrap_or(d.splice),
                stride: wf("stride", d.stride as f32).clamp(1.0, 256.0) as u32,
                shape: wv.and_then(|x| x.get("shape")).and_then(Value::as_str).and_then(WinShape::from_str).unwrap_or(d.shape),
                guard_hops: wf("guardHops", d.guard_hops).clamp(1.0, 16.0),
                floor: wf("floor", d.floor).clamp(0.0, 2.0),
            }
        },
        vocoder: {
            let d = mgl_fx::stretch::VocoderParams::default();
            let vv = v.get("vocoder");
            let vf = |k: &str, dv: f32| field(vv, k, dv);
            mgl_fx::stretch::VocoderParams {
                window_ms: vf("windowMs", d.window_ms).clamp(5.0, 500.0),
                phase_lock: !is_false(vv.and_then(|x| x.get("phaseLock"))),
                freq_trust: vf("freqTrust", d.freq_trust).clamp(0.0, 4.0),
                phase_spread: vf("phaseSpread", d.phase_spread).clamp(0.0, 4.0),
                peak_width: vf("peakWidth", d.peak_width as f32).clamp(1.0, 32.0) as u32,
                lock_width: vf("lockWidth", d.lock_width).clamp(0.0, 4.0),
                mag_freeze: vf("magFreeze", d.mag_freeze).clamp(0.0, 1.0),
                mag_blur: vf("magBlur", d.mag_blur).clamp(0.0, 1.0),
                mag_gate: vf("magGate", d.mag_gate).clamp(0.0, 1.0),
                stereo_link: is_true(vv.and_then(|x| x.get("stereoLink"))),
            }
        },
        pvsola: {
            let d = mgl_fx::pvsola::PvsolaParams::default();
            let pv = v.get("pvsola");
            let pf = |k: &str, dv: f32| field(pv, k, dv);
            mgl_fx::pvsola::PvsolaParams {
                anchor_frames: pf("anchorFrames", d.anchor_frames as f32).clamp(1.0, 64.0) as u32,
                search_ms: pf("searchMs", d.search_ms).clamp(0.0, 200.0),
                blend: pf("blend", d.blend).clamp(0.0, 1.0),
            }
        },
        hybrid: {
            let d = mgl_fx::hybrid::HybridParams::default();
            let hv = v.get("hybrid");
            let hf = |k: &str, dv: f32| field(hv, k, dv);
            mgl_fx::hybrid::HybridParams {
                fft_size: hf("fftSize", d.fft_size as f32).clamp(256.0, 8192.0) as u32,
                time_span: hf("timeSpan", d.time_span as f32).clamp(3.0, 101.0) as u32,
                freq_span: hf("freqSpan", d.freq_span as f32).clamp(3.0, 101.0) as u32,
                margin: hf("margin", d.margin).clamp(1.0, 8.0),
                morph_noise: !is_false(hv.and_then(|x| x.get("morphNoise"))),
                harmonic_level: hf("harmonicLevel", d.harmonic_level).clamp(0.0, 4.0),
                percussive_level: hf("percussiveLevel", d.percussive_level).clamp(0.0, 4.0),
                residual_level: hf("residualLevel", d.residual_level).clamp(0.0, 4.0),
            }
        },
        soundhack: soundhack_from(v.get("soundhack"), d.soundhack),
        grain: Grain {
            rate_hz: gf("rateHz", d.grain.rate_hz).clamp(0.0, 2000.0),
            density_hz: gf("densityHz", d.grain.density_hz).clamp(0.0, 500.0),
            layers: gf("layers", d.grain.layers as f32).clamp(1.0, mgl_fx::grain::MAX_LAYERS as f32) as u32,
            overlap: gf("overlap", d.grain.overlap).clamp(1.0, 8.0),
            size_jitter: gf("sizeJitter", d.grain.size_jitter).clamp(0.0, 1.0),
            position_jitter_ms: gf("positionJitterMs", d.grain.position_jitter_ms).clamp(0.0, 2000.0),
            pitch_jitter_semis: gf("pitchJitterSemis", d.grain.pitch_jitter_semis).clamp(0.0, 24.0),
            pitch_drift_semis: gf("pitchDriftSemis", d.grain.pitch_drift_semis).clamp(0.0, 24.0),
            drift_rate_hz: gf("driftRateHz", d.grain.drift_rate_hz).clamp(0.01, 20.0),
            seed: gf("seed", d.grain.seed as f32).max(0.0) as u32,
            position: gf("position", d.grain.position).clamp(-1.0, 1.0),
            scan: gf("scan", d.grain.scan).clamp(-4.0, 4.0),
            reverse: is_true(g.and_then(|x| x.get("reverse"))),
            envelope: gf("envelope", d.grain.envelope).clamp(0.0, 1.0),
            size_range: gf("sizeRange", d.grain.size_range).clamp(1.0, 8.0),
            wrap: is_true(g.and_then(|x| x.get("wrap"))),
            layer_spread: gf("layerSpread", d.grain.layer_spread).clamp(0.0, 4.0),
            layer_scatter: gf("layerScatter", d.grain.layer_scatter).clamp(0.0, 1.0),
            layer_scatter_ms: gf("layerScatterMs", d.grain.layer_scatter_ms).clamp(0.0, 5000.0),
            layer_read: 0.0,
            link_jitter: is_true(g.and_then(|x| x.get("linkJitter"))),
            drift_step: is_true(g.and_then(|x| x.get("driftStep"))),
            pan_spread: gf("panSpread", d.grain.pan_spread).clamp(0.0, 1.0),
            fb_amount: gf("fbAmount", d.grain.fb_amount).clamp(0.0, 0.95),
            fb_time_ms: gf("fbTimeMs", d.grain.fb_time_ms).clamp(20.0, 2000.0),
            fb_smear: gf("fbSmear", d.grain.fb_smear).clamp(0.0, 1.0),
            fb_damp: gf("fbDamp", d.grain.fb_damp).clamp(0.0, 1.0),
            fb_shift: gf("fbShift", d.grain.fb_shift).clamp(-12.0, 12.0),
            fb_hold: is_true(g.and_then(|x| x.get("fbHold"))),
        },
    }
}

/// The `"stretch"` op of MGL's `/api/edit`: the document's stretch after
/// message `v`, from `cur`. Anything the message leaves out keeps its value.
pub fn apply(cur: &Stretch, v: &Value) -> Stretch {
    let float = |k: &str, d: f32| -> f32 {
        match v.get(k).and_then(Value::as_f64) {
            Some(n) => n as f32,
            None => d,
        }
    };
    let ratio = float("ratio", cur.ratio).clamp(0.01, 100.0);
    let semis = float("semitones", cur.semitones).clamp(-48.0, 48.0);
    let window = float("windowMs", cur.window_ms).clamp(5.0, 2000.0);
    let quality = match v.get("quality").and_then(Value::as_str) {
        Some("draft") => Quality::Draft,
        Some("best") => Quality::Best,
        Some("standard") => Quality::Standard,
        _ => cur.quality,
    };
    let algorithm = v.get("algorithm").and_then(Value::as_str).and_then(Algorithm::from_str).unwrap_or(cur.algorithm);

    let cv = cur.vocoder;
    let vv = v.get("vocoder");
    let vf = |k: &str, d: f32| field(vv, k, d);
    let vocoder = mgl_fx::stretch::VocoderParams {
        window_ms: vf("windowMs", cv.window_ms).clamp(5.0, 500.0),
        phase_lock: bool_or(vv.and_then(|x| x.get("phaseLock")), cv.phase_lock),
        freq_trust: vf("freqTrust", cv.freq_trust).clamp(0.0, 4.0),
        phase_spread: vf("phaseSpread", cv.phase_spread).clamp(0.0, 4.0),
        peak_width: vf("peakWidth", cv.peak_width as f32).clamp(1.0, 32.0) as u32,
        lock_width: vf("lockWidth", cv.lock_width).clamp(0.0, 4.0),
        mag_freeze: vf("magFreeze", cv.mag_freeze).clamp(0.0, 1.0),
        mag_blur: vf("magBlur", cv.mag_blur).clamp(0.0, 1.0),
        mag_gate: vf("magGate", cv.mag_gate).clamp(0.0, 1.0),
        stereo_link: bool_or(vv.and_then(|x| x.get("stereoLink")), cv.stereo_link),
    };

    let cg = cur.grain;
    let gv = v.get("grain");
    let gf = |k: &str, d: f32| field(gv, k, d);

    let cw = cur.wsola;
    let wv = v.get("wsola");
    let wf = |k: &str, d: f32| field(wv, k, d);
    let wsola = mgl_fx::stretch::WsolaParams {
        preserve_transients: bool_or(wv.and_then(|x| x.get("preserveTransients")), cw.preserve_transients),
        sensitivity: wf("sensitivity", cw.sensitivity).clamp(0.0, 1.0),
        search_ms: wf("searchMs", cw.search_ms).clamp(0.0, 200.0),
        splice: wv.and_then(|x| x.get("splice")).and_then(Value::as_str).and_then(Splice::from_str).unwrap_or(cw.splice),
        stride: wf("stride", cw.stride as f32).clamp(1.0, 256.0) as u32,
        shape: wv.and_then(|x| x.get("shape")).and_then(Value::as_str).and_then(WinShape::from_str).unwrap_or(cw.shape),
        guard_hops: wf("guardHops", cw.guard_hops).clamp(1.0, 16.0),
        floor: wf("floor", cw.floor).clamp(0.0, 2.0),
    };

    let cp = cur.pvsola;
    let pv = v.get("pvsola");
    let pf = |k: &str, d: f32| field(pv, k, d);
    let pvsola = mgl_fx::pvsola::PvsolaParams {
        anchor_frames: pf("anchorFrames", cp.anchor_frames as f32).clamp(1.0, 64.0) as u32,
        search_ms: pf("searchMs", cp.search_ms).clamp(0.0, 200.0),
        blend: pf("blend", cp.blend).clamp(0.0, 1.0),
    };

    let ch = cur.hybrid;
    let hv = v.get("hybrid");
    let hf = |k: &str, d: f32| field(hv, k, d);
    let hybrid = mgl_fx::hybrid::HybridParams {
        fft_size: hf("fftSize", ch.fft_size as f32).clamp(256.0, 8192.0) as u32,
        time_span: hf("timeSpan", ch.time_span as f32).clamp(3.0, 101.0) as u32,
        freq_span: hf("freqSpan", ch.freq_span as f32).clamp(3.0, 101.0) as u32,
        margin: hf("margin", ch.margin).clamp(1.0, 8.0),
        morph_noise: bool_or(hv.and_then(|x| x.get("morphNoise")), ch.morph_noise),
        harmonic_level: hf("harmonicLevel", ch.harmonic_level).clamp(0.0, 4.0),
        percussive_level: hf("percussiveLevel", ch.percussive_level).clamp(0.0, 4.0),
        residual_level: hf("residualLevel", ch.residual_level).clamp(0.0, 4.0),
    };

    let gb = |k: &str, keep: bool| bool_or(gv.and_then(|x| x.get(k)), keep);
    let mut grain = Grain {
        rate_hz: gf("rateHz", cg.rate_hz).clamp(0.0, 2000.0),
        density_hz: gf("densityHz", cg.density_hz).clamp(0.0, 500.0),
        layers: gf("layers", cg.layers as f32).clamp(1.0, mgl_fx::grain::MAX_LAYERS as f32) as u32,
        overlap: gf("overlap", cg.overlap).clamp(1.0, 8.0),
        size_jitter: gf("sizeJitter", cg.size_jitter).clamp(0.0, 1.0),
        position_jitter_ms: gf("positionJitterMs", cg.position_jitter_ms).clamp(0.0, 2000.0),
        pitch_jitter_semis: gf("pitchJitterSemis", cg.pitch_jitter_semis).clamp(0.0, 24.0),
        pitch_drift_semis: gf("pitchDriftSemis", cg.pitch_drift_semis).clamp(0.0, 24.0),
        drift_rate_hz: gf("driftRateHz", cg.drift_rate_hz).clamp(0.01, 20.0),
        seed: gf("seed", cg.seed as f32).max(0.0) as u32,
        position: gf("position", cg.position).clamp(-1.0, 1.0),
        scan: gf("scan", cg.scan).clamp(-4.0, 4.0),
        reverse: gb("reverse", cg.reverse),
        envelope: gf("envelope", cg.envelope).clamp(0.0, 1.0),
        size_range: gf("sizeRange", cg.size_range).clamp(1.0, 8.0),
        wrap: gb("wrap", cg.wrap),
        layer_spread: gf("layerSpread", cg.layer_spread).clamp(0.0, 4.0),
        layer_scatter: gf("layerScatter", cg.layer_scatter).clamp(0.0, 1.0),
        layer_scatter_ms: gf("layerScatterMs", cg.layer_scatter_ms).clamp(0.0, 5000.0),
        layer_read: 0.0,
        link_jitter: gb("linkJitter", cg.link_jitter),
        drift_step: gb("driftStep", cg.drift_step),
        pan_spread: gf("panSpread", cg.pan_spread).clamp(0.0, 1.0),
        fb_amount: gf("fbAmount", cg.fb_amount).clamp(0.0, 0.95),
        fb_time_ms: gf("fbTimeMs", cg.fb_time_ms).clamp(20.0, 2000.0),
        fb_smear: gf("fbSmear", cg.fb_smear).clamp(0.0, 1.0),
        fb_damp: gf("fbDamp", cg.fb_damp).clamp(0.0, 1.0),
        fb_shift: gf("fbShift", cg.fb_shift).clamp(-12.0, 12.0),
        fb_hold: gb("fbHold", cg.fb_hold),
    };
    let scale = match v.get("scale") {
        Some(Value::String(name)) => mgl_fx::tuning::by_name(name),
        _ => cur.scale,
    };
    let pitch_step = match v.get("pitchStep").and_then(Value::as_f64) {
        Some(n) if n.is_finite() => (n as f32).clamp(0.0, 12.0),
        _ => cur.pitch_step,
    };
    let semis = mgl_fx::tuning::quantise(semis, scale.map(|x| x.name), pitch_step);
    grain.fb_shift = mgl_fx::tuning::quantise(grain.fb_shift, scale.map(|x| x.name), pitch_step).clamp(-12.0, 12.0);
    let soundhack = soundhack_from(v.get("soundhack"), cur.soundhack);
    let cloud = bool_or(v.get("cloud"), cur.cloud);
    let cloud_mix = match v.get("cloudMix").and_then(Value::as_f64) {
        Some(n) if n.is_finite() => (n as f32).clamp(0.0, 1.0),
        _ => cur.cloud_mix,
    };
    Stretch { ratio, semitones: semis, window_ms: window, quality, algorithm, vocoder, wsola, pvsola, hybrid, soundhack, grain, scale, pitch_step, cloud, cloud_mix }
}

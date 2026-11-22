//! What MGL's own Grain routes answer, written down for the native app's
//! Grain module to be checked against (`native/engine-app/tests/grain.rs`).
//!
//! - A script of the Grain page's posts to `/api/edit` (`op: "stretch"`), each
//!   as the page sends it (the whole panel, the grain controls alone, one
//!   field, a scale, every engine's own, values past their ends), with undo
//!   and redo; after each, the document's stretch as `/api/edit` answers it.
//! - Presets: saved, the document moved on, applied back; their JSON.
//! - The rack: a rack posted to `/api/rack` with a slot of each kind, and
//!   what MGL answers.
//! - The four LFOs, run tick by tick (8 ms) against a document and its rack,
//!   with keys pressed now and then: every control's base and value at every
//!   tick, as `grain_lfos::compute` works them out.
//!
//! Nothing is written unless `MGL_GRAIN_REFS` names a folder:
//!
//!   MGL_GRAIN_REFS=<folder> cargo test -p server --test routes grain_references

use super::*;

/// The page's posts, in order.
const SCRIPT: &[&str] = &[
    // gsPostAll: the whole panel, one edit.
    r#"{"op":"stretch","ratio":2.5,"semitones":-3,"windowMs":80,"quality":"draft","algorithm":"granular","vocoder":{"windowMs":46,"phaseLock":true,"freqTrust":1,"phaseSpread":1,"peakWidth":2,"lockWidth":1,"magFreeze":0,"magBlur":0,"magGate":0,"stereoLink":false},"wsola":{"preserveTransients":false,"sensitivity":0.5,"searchMs":10,"splice":"best","stride":4,"shape":"hann","guardHops":3,"floor":1},"pvsola":{"anchorFrames":6,"searchMs":10,"blend":0.5},"hybrid":{"fftSize":2048,"timeSpan":17,"freqSpan":17,"margin":2,"morphNoise":true,"harmonicLevel":1,"percussiveLevel":1,"residualLevel":1},"soundhack":{"version":"0.896"},"cloud":false,"cloudMix":0.5,"grain":{"rateHz":40,"densityHz":0,"overlap":2,"sizeJitter":0.2,"positionJitterMs":30,"pitchJitterSemis":0.5,"pitchDriftSemis":0,"driftRateHz":0.5,"layers":3,"seed":1,"position":0.1,"scan":1,"reverse":false,"envelope":0.5,"sizeRange":1,"wrap":false,"layerSpread":1,"layerScatter":0,"layerScatterMs":120,"linkJitter":false,"driftStep":false,"panSpread":0,"fbAmount":0,"fbTimeMs":250,"fbSmear":0.3,"fbDamp":0.4,"fbShift":0,"fbHold":false}}"#,
    // The grain controls' own send (state.grainSend): the stretch's three, the
    // engine, and the grain object.
    r#"{"op":"stretch","ratio":2.5,"semitones":-3,"windowMs":80,"quality":"standard","algorithm":"granular","grain":{"rateHz":120,"layers":4,"panSpread":0.75,"fbAmount":0.4,"fbShift":3.3,"envelope":0.3}}"#,
    // One field: nothing else moves.
    r#"{"op":"stretch","grain":{"panSpread":0.5}}"#,
    r#"{"op":"stretch","cloud":true,"cloudMix":0.8,"algorithm":"wsola"}"#,
    // A scale: Pitch and Shift snap to it.
    r#"{"op":"stretch","semitones":3.3,"scale":"Maqam Rast","grain":{"fbShift":-5.4}}"#,
    r#"{"op":"stretch","pitchStep":1,"semitones":-7.6,"scale":""}"#,
    r#"{"op":"stretch","pitchStep":0,"semitones":2.25}"#,
    // Each engine's own.
    r#"{"op":"stretch","algorithm":"vocoder","vocoder":{"windowMs":120,"phaseLock":false,"freqTrust":2.5,"magFreeze":0.4,"magBlur":0.2,"magGate":0.1,"peakWidth":5,"lockWidth":0.5,"stereoLink":true}}"#,
    r#"{"op":"stretch","algorithm":"pvsola","pvsola":{"anchorFrames":12,"searchMs":25.5,"blend":0.7}}"#,
    r#"{"op":"stretch","algorithm":"hybrid","hybrid":{"fftSize":4096,"timeSpan":31,"freqSpan":9,"margin":3.5,"morphNoise":false,"harmonicLevel":1.5,"percussiveLevel":0.25,"residualLevel":0}}"#,
    r#"{"op":"stretch","algorithm":"wsola","wsola":{"preserveTransients":true,"sensitivity":0.8,"searchMs":40,"splice":"loud","stride":16,"shape":"tri","guardHops":5.5,"floor":0.4}}"#,
    r#"{"op":"stretch","algorithm":"soundhack","soundhack":{"version":"0.888"}}"#,
    // Past their ends: MGL's clamps.
    r#"{"op":"stretch","ratio":500,"semitones":-99,"windowMs":1,"grain":{"layers":999,"overlap":0,"fbAmount":2,"position":-3,"scan":9,"rateHz":5000,"layerScatterMs":9999,"fbTimeMs":1},"vocoder":{"peakWidth":99},"hybrid":{"fftSize":99999,"timeSpan":1}}"#,
    r#"{"op":"stretch","ratio":0.001,"windowMs":5000,"quality":"best"}"#,
    r#"{"op":"undo"}"#,
    r#"{"op":"undo"}"#,
    r#"{"op":"redo"}"#,
    r#"{"op":"stretch","quality":"standard","algorithm":"granular","grain":{"reverse":true,"wrap":true,"linkJitter":true,"driftStep":true,"fbHold":true,"seed":42}}"#,
];

/// A rack with a slot of each kind the page can add.
const RACK: &str = r#"{"slots":[{"kind":"eq","id":"factory-eq","bypassed":false,"bands":[{"type":"highpass","freq":60,"q":0.707,"gainDb":0,"enabled":true},{"type":"lowshelf","freq":120,"q":0.7,"gainDb":3,"enabled":true},{"type":"bell","freq":900,"q":1.2,"gainDb":-4,"enabled":true},{"type":"bell","freq":250,"q":1,"gainDb":0,"enabled":false},{"type":"notch","freq":500,"q":4,"gainDb":0,"enabled":true},{"type":"bell","freq":2000,"q":1,"gainDb":2,"enabled":true},{"type":"highshelf","freq":8000,"q":0.7,"gainDb":-2,"enabled":true},{"type":"lowpass","freq":18000,"q":0.707,"gainDb":0,"enabled":true}]},{"kind":"comp","id":"factory-comp","bypassed":false,"thresholdDb":-24,"ratio":3,"attackMs":5,"releaseMs":200,"kneeDb":6,"makeupDb":2,"wet":0.8,"level":-3},{"kind":"prism:echo","id":"echo-1","bypassed":true,"params":{}},{"kind":"gain","id":"gain-1","db":-6}],"master":{"on":true,"amount":0.6,"autoLevel":false,"autoComp":true,"ceilingDb":-1}}"#;

fn lfo(shape: server::grain_lfos::Shape, hz: f64, beats: Option<f64>, each_note: bool, depth: f32, aims: &[(&str, Option<server::grain_lfos::Travel>)]) -> server::grain_lfos::Lfo {
    let mut l = server::grain_lfos::Lfo::default();
    l.shape = shape;
    l.hz = hz;
    l.beats = beats;
    l.each_note = each_note;
    l.depth = depth;
    l.aims = aims.iter().map(|(t, travel)| server::grain_lfos::Aim { target: t.to_string(), travel: *travel }).collect();
    l
}

fn lfo_ticks() -> String {
    use server::grain_lfos::{compute, Bank, Shape, Travel};
    let mut bank = Bank::default();
    bank.bpm = 96.0;
    bank.lfos[0] = lfo(Shape::Sine, 0.25, None, false, 0.45, &[("stretch.grain.rateHz", Some(Travel::Pow(0.0, 500.0))), ("stretch.ratio", Some(Travel::Log(0.01, 100.0)))]);
    bank.lfos[1] = lfo(Shape::Smooth, 0.14, None, false, 0.4, &[("stretch.grain.position", Some(Travel::Lin(-1.0, 1.0))), ("fx.factory-eq.band.2.gainDb", None)]);
    bank.lfos[2] = lfo(Shape::Tri, 0.61, None, true, 0.5, &[("stretch.semitones", None), ("fx.factory-comp.slot.wet", None), ("stretch.grain.layers", None)]);
    bank.lfos[3] = lfo(Shape::Steps, 1.0, Some(0.5), true, 0.3, &[("stretch.grain.panSpread", Some(Travel::Lin(0.0, 1.0))), ("stretch.grain.rateHz", Some(Travel::Pow(0.0, 500.0)))]);
    let mut doc = fx::Stretch::default();
    doc.ratio = 2.0;
    doc.semitones = 3.0;
    doc.grain.rate_hz = 80.0;
    doc.grain.position = 0.25;
    doc.grain.layers = 4;
    doc.grain.pan_spread = 0.2;
    let spec = server::rack::RackSpec::default_chain();
    let mut ticks = Vec::new();
    let mut notes = 0u64;
    for i in 0..400 {
        if i % 97 == 50 {
            notes += 1;
        }
        bank.advance(0.008, notes);
        let outs = compute(&bank, &doc, &spec, None);
        let row: Vec<String> = outs.iter().map(|o| format!(r#"{{"t":"{}","base":{},"value":{}}}"#, o.target, o.base, o.value)).collect();
        ticks.push(format!("[{}]", row.join(",")));
    }
    format!("[{}]", ticks.join(",\n"))
}

#[test]
fn grain_references() {
    let Ok(dir) = std::env::var("MGL_GRAIN_REFS") else { return };
    let dir = PathBuf::from(dir);
    fs::create_dir_all(&dir).unwrap();
    let s = Scratch::new("grainrefs");
    s.sound("kit/grain.wav", 44_100);
    let app = s.app();
    let p = "kit/grain.wav";
    let body = |r: &Response| String::from_utf8_lossy(&r.body).to_string();
    let mut steps = Vec::new();
    for msg in SCRIPT {
        let mut v = msg.to_string();
        v.insert_str(1, &format!(r#""p":"{p}","#));
        let r = server::routes::route(&app, &post("/api/edit", &v));
        assert_eq!(status(&r), 200, "{msg}: {}", body(&r));
        steps.push(body(&r));
    }
    // Presets: saved, the document moved on, applied back.
    let saved = server::routes::route(&app, &post("/api/presets", &format!(r#"{{"name":"Ref one","note":"a note","p":"{p}"}}"#)));
    assert_eq!(status(&saved), 200, "{}", body(&saved));
    let moved = server::routes::route(&app, &post("/api/edit", &format!(r#"{{"p":"{p}","op":"stretch","ratio":7,"algorithm":"vocoder","grain":{{"layers":9}}}}"#)));
    assert_eq!(status(&moved), 200);
    let rack = server::routes::route(&app, &post("/api/rack", &RACK.replacen('{', &format!(r#"{{"p":"{p}","#), 1)));
    assert_eq!(status(&rack), 200, "{}", body(&rack));
    let applied = server::routes::route(&app, &post("/api/presets/apply", &format!(r#"{{"name":"Ref one","p":"{p}"}}"#)));
    assert_eq!(status(&applied), 200, "{}", body(&applied));
    let rack_after = server::routes::route(&app, &get("/api/rack", &[("p", p)]));
    let script: Vec<String> = SCRIPT.iter().map(|s| s.to_string()).collect();
    fs::write(
        dir.join("refs.json"),
        format!(
            r#"{{"script":[{}],"steps":[{}],"presetsSaved":{},"rackPosted":{},"rack":{},"presetApplied":{},"rackAfterPreset":{},"lfoTicks":{}}}"#,
            script.join(","),
            steps.join(",\n"),
            body(&saved),
            RACK,
            body(&rack),
            body(&applied),
            body(&rack_after),
            lfo_ticks()
        ),
    )
    .unwrap();
}

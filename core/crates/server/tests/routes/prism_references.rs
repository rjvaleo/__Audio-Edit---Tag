//! What MGL's own routes answer for the Prism page, written down for the
//! native app's Prism module to be checked against
//! (`native/engine-app/tests/prism.rs`). Nothing here opens the audio device;
//! what the deck plays is checked there against MGL's engine built by hand
//! as `live::load_prism` builds it.
//!
//! - `/api/fx`: every effect the page lists, with its controls and panel.
//! - The Prism document's rack (`prism:<path>`): posted with a slot of many
//!   kinds and pads good, clamped and refused; MGL's answer; `/api/pad` on it.
//! - `/api/pitchtime`: kept, clamped, live (heard only).
//! - `/api/rack/param` on a slot of it, kept and live.
//! - `/api/pad/presets`: every process's factory set; the user's saved,
//!   replaced, renamed and deleted.
//!
//! Nothing is written unless `MGL_PRISM_REFS` names a folder:
//!
//!   MGL_PRISM_REFS=<folder> cargo test -p server --test routes prism_references

use super::*;

const P: &str = "prism:kit/prism.wav";

/// A rack with a slot of many kinds the page can add, and pads: one good,
/// one past its control's ends (clamped), one with both axes the same
/// (refused), one for a slot that is not there (dropped), the PTC's.
const RACK: &str = r#"{"slots":[{"kind":"comp","id":"c1","bypassed":false,"thresholdDb":-20,"ratio":4,"attackMs":5,"releaseMs":200,"kneeDb":6,"makeupDb":0},{"kind":"eq","id":"e1","bypassed":false},{"kind":"gain","id":"g1","db":-3},{"kind":"prism:hp-echo","id":"echo-1","params":{}},{"kind":"prism:hp-low-pass","id":"lp-1","params":{}},{"kind":"prism:hp-chorus","id":"ch-1","params":{}},{"kind":"prism:hp-pitch-shifter","id":"ps-1","params":{}},{"kind":"prism:hp-more-stereo","id":"ms-1","params":{}},{"kind":"prism:hp-hall","id":"hall-1","params":{}},{"kind":"prism:hp-sonic-decimator","id":"sd-1","params":{}},{"kind":"ring","id":"r1","params":{}}],"pads":{"stretch":{"x":"ratio","xLo":4,"xHi":0.5,"y":"windowMs","yLo":10,"yHi":200},"echo-1":{"x":"delayMs","xLo":-50,"xHi":99999,"y":"feedback","yLo":0,"yHi":90},"lp-1":{"x":"freqHz","xLo":100,"xHi":5000,"y":"freqHz","yLo":0,"yHi":1},"gone-1":{"x":"a","xLo":0,"xHi":1,"y":"b","yLo":0,"yHi":1},"ptc":{"x":"pitch","xLo":50,"xHi":150,"y":"speed","yLo":1,"yHi":200}},"postRoll":{"echo-1":1500,"stretch":250},"master":{"on":true,"amount":0.5,"autoLevel":false,"autoComp":false,"ceilingDb":-1}}"#;

const PTC: &[&str] = &[
    r#"{"on":true,"speed":150,"pitch":80}"#,
    r#"{"feedback":250,"grain":0,"xfade":-5,"smoothing":101}"#,
    r#"{"live":true,"pitch":40}"#,
    r#"{"on":false}"#,
];

#[test]
fn prism_references() {
    let Ok(dir) = std::env::var("MGL_PRISM_REFS") else { return };
    let dir = PathBuf::from(dir);
    fs::create_dir_all(&dir).unwrap();
    let s = Scratch::new("prismrefs");
    s.sound("kit/prism.wav", 44_100);
    let app = s.app();
    let body = |r: &Response| String::from_utf8_lossy(&r.body).to_string();
    let fx = server::routes::route(&app, &get("/api/fx", &[]));
    assert_eq!(status(&fx), 200);
    // A new document's rack and pad, before anything is posted.
    let fresh_rack = server::routes::route(&app, &get("/api/rack", &[("p", P)]));
    let fresh_pad = server::routes::route(&app, &get("/api/pad", &[("p", P)]));
    let rack = server::routes::route(&app, &post("/api/rack", &RACK.replacen('{', &format!(r#"{{"p":"{P}","#), 1)));
    assert_eq!(status(&rack), 200, "{}", body(&rack));
    let pad = server::routes::route(&app, &get("/api/pad", &[("p", P)]));
    let mut ptc = Vec::new();
    for msg in PTC {
        let r = server::routes::route(&app, &post("/api/pitchtime", &msg.replacen('{', &format!(r#"{{"p":"{P}","#), 1)));
        assert_eq!(status(&r), 200, "{msg}: {}", body(&r));
        ptc.push(body(&r));
    }
    let mut params = Vec::new();
    for msg in [
        r#"{"id":"echo-1","key":"feedback","value":75}"#,
        r#"{"id":"echo-1","key":"delayMs","value":999999}"#,
        r#"{"id":"lp-1","key":"freqHz","value":440,"live":true}"#,
        r#"{"id":"c1","key":"ratio","value":8}"#,
        r#"{"id":"master","key":"amount","value":0.8}"#,
    ] {
        let r = server::routes::route(&app, &post("/api/rack/param", &msg.replacen('{', &format!(r#"{{"p":"{P}","#), 1)));
        params.push(format!(r#"{{"status":{},"body":{}}}"#, status(&r), if status(&r) == 200 { body(&r) } else { "null".into() }));
    }
    let rack_after = server::routes::route(&app, &get("/api/rack", &[("p", P)]));
    let kinds = ["stretch", "ptc", "hp-low-pass", "hp-high-pass", "hp-band-pass", "hp-band-reject", "hp-phaser", "hp-flanger", "hp-chorus", "hp-single-delay", "hp-multi-delay", "hp-echo", "hp-ring-modulator", "hp-tremolo", "hp-vibrato", "hp-stereo-dynamics", "hp-pan", "hp-more-stereo", "hp-quasi-stereo", "hp-ms-matrix", "hp-auto-pan", "hp-hall", "hp-medium-room", "hp-echotranz", "hp-compressor", "hp-noise-gate", "hp-sonic-decimator"];
    let factory: Vec<String> = kinds
        .iter()
        .map(|k| format!(r#""{k}":{}"#, body(&server::routes::route(&app, &get("/api/pad/presets", &[("kind", k)])))))
        .collect();
    let mut user = Vec::new();
    for (path, msg) in [
        ("/api/pad/presets", r#"{"kind":"hp-echo","name":"Mine","preset":{"x":"delayMs","xLo":10,"xHi":900,"y":"feedback","yLo":0,"yHi":80,"settings":{"mix":40},"postRollMs":500}}"#),
        ("/api/pad/presets", r#"{"kind":"hp-echo","name":"  Two  ","preset":{"x":"delayMs","xLo":1,"xHi":2,"y":"feedback","yLo":0,"yHi":1,"settings":{},"postRollMs":0}}"#),
        ("/api/pad/presets", r#"{"kind":"hp-echo","name":"Mine","preset":{"x":"feedback","xLo":0,"xHi":50,"y":"delayMs","yLo":5,"yHi":6,"settings":{},"postRollMs":0}}"#),
        ("/api/pad/presets/rename", r#"{"kind":"hp-echo","from":"Two","to":"Second"}"#),
        ("/api/pad/presets/delete", r#"{"kind":"hp-echo","name":"Mine"}"#),
        ("/api/pad/presets", r#"{"kind":"ptc","name":"Slow","preset":{"x":"speed","xLo":1,"xHi":50,"y":"pitch","yLo":0,"yHi":200,"settings":{"feedback":10,"grain":20,"xfade":90,"smoothing":30},"postRollMs":0}}"#),
    ] {
        let r = server::routes::route(&app, &post(path, msg));
        assert_eq!(status(&r), 200, "{msg}: {}", body(&r));
        let list = server::routes::route(&app, &get("/api/pad/presets", &[("kind", if msg.contains("\"ptc\"") { "ptc" } else { "hp-echo" })]));
        user.push(format!(r#"{{"path":"{path}","msg":{msg},"answer":{},"list":{}}}"#, body(&r), body(&list)));
    }
    fs::write(
        dir.join("refs.json"),
        format!(
            r#"{{"fx":{},"freshRack":{},"freshPad":{},"rackPosted":{},"rack":{},"pad":{},"ptcPosts":[{}],"ptc":[{}],"params":[{}],"rackAfter":{},"factory":{{{}}},"user":[{}]}}"#,
            body(&fx),
            body(&fresh_rack),
            body(&fresh_pad),
            RACK,
            body(&rack),
            body(&pad),
            PTC.join(","),
            ptc.join(",\n"),
            params.join(",\n"),
            body(&rack_after),
            factory.join(",\n"),
            user.join(",\n")
        ),
    )
    .unwrap();
}

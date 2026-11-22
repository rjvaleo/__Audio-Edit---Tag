//! What MGL's own edit routes answer, written down for the native app's Edit
//! module to be checked against (`native/engine-app/tests/edit.rs`).
//!
//! A script of the Edit page's commands, each posted to `/api/edit` exactly as
//! the page posts it; after each, the answer, the edited timeline's peaks
//! (`/api/peaks?clips=1`), its level, peak and worst click (`/api/measure`),
//! and the samples the page decodes (`/audio?dry=1`, as a check of their
//! bytes). Then the markers and regions through `/api/markers` and
//! `/api/annot`. Nothing is written unless `MGL_EDIT_REFS` names a folder:
//!
//!   MGL_EDIT_REFS=<folder> cargo test -p server --test routes edit_references

use super::*;

/// The sound: two seconds of stereo at 44.1 kHz, three tone bursts with
/// their own envelopes, a gap of silence, and a click.
fn source() -> Vec<u8> {
    let (rate, frames) = (44_100usize, 88_200usize);
    let mut pcm = Vec::with_capacity(frames * 4);
    for i in 0..frames {
        let t = i as f64 / rate as f64;
        let burst = |at: f64, len: f64, hz: f64, amp: f64| -> f64 {
            let u = (t - at) / len;
            if (0.0..1.0).contains(&u) { amp * (std::f64::consts::PI * u).sin() * (2.0 * std::f64::consts::PI * hz * t).sin() } else { 0.0 }
        };
        let mut l = burst(0.0, 0.45, 220.0, 0.6) + burst(0.9, 0.5, 1320.0, 0.4) + burst(1.5, 0.45, 70.0, 0.8);
        let mut r = burst(0.0, 0.45, 330.0, 0.5) + burst(0.9, 0.5, 990.0, 0.45) + burst(1.5, 0.45, 5000.0, 0.2);
        if i == 60_000 {
            l += 0.7;
            r -= 0.6;
        }
        l = l.clamp(-1.0, 1.0);
        r = r.clamp(-1.0, 1.0);
        pcm.extend_from_slice(&((l * 32767.0) as i16).to_le_bytes());
        pcm.extend_from_slice(&((r * 32767.0) as i16).to_le_bytes());
    }
    let mut out = audio_core::wav::header(pcm.len() as u64, 2, rate as u32, audio_core::Codec::PcmI16).to_vec();
    out.extend_from_slice(&pcm);
    out
}

/// The commands, as the Edit page posts them.
const SCRIPT: &[&str] = &[
    r#"{"op":"copy","start":1000,"end":5000}"#,
    r#"{"op":"paste","start":20000,"end":20000}"#,
    r#"{"op":"cut","start":30000,"end":40000,"snap":"zero"}"#,
    r#"{"op":"fadeIn","start":0,"end":8000,"frames":8000,"shape":"equalPower","snap":"zero"}"#,
    r#"{"op":"fadeOut","start":70000,"end":80000,"frames":6000,"shape":"linear"}"#,
    r#"{"op":"gain","db":-3.5,"start":10000,"end":20000}"#,
    r#"{"op":"reverse","start":50000,"end":56000,"snap":"zero"}"#,
    r#"{"op":"silence","start":61000,"end":62000}"#,
    r#"{"op":"insertSilence","start":1000,"end":1000,"ms":250,"snap":"zero"}"#,
    r#"{"op":"duplicate","start":0,"end":4410,"count":2,"snap":"zero"}"#,
    r#"{"op":"normalize","db":-1}"#,
    r#"{"op":"normalizeRms","db":-14,"ceilingDb":-0.5}"#,
    r#"{"op":"undo"}"#,
    r#"{"op":"undo"}"#,
    r#"{"op":"redo"}"#,
    r#"{"op":"stripSilence","start":0,"end":0,"thresholdDb":-40,"minMs":50,"padMs":5,"mode":"remove"}"#,
    r#"{"op":"repairClick","start":55000,"end":75000,"widthMs":1}"#,
    r#"{"op":"crop","start":2000,"end":90000,"snap":"cd"}"#,
    r#"{"op":"delete","start":100,"end":200,"snap":"off"}"#,
    r#"{"op":"gain","db":6,"start":0,"end":40000}"#,
    r#"{"op":"revert"}"#,
    r#"{"op":"stripSilence","start":0,"end":0,"thresholdDb":-50,"minMs":100,"padMs":10,"mode":"silence"}"#,
    r#"{"op":"split","pos":12345}"#,
    r#"{"op":"cut","start":0,"end":0}"#,
];

/// The markers and regions, as the page posts them.
const ANNOT: &[&str] = &[
    r#"{"op":"markersToRegions","start":0,"end":0,"each":false}"#,
    r#"{"op":"splitRegion","pos":30000}"#,
    r#"{"op":"nudge","start":0,"end":40000,"frames":-1500}"#,
    r#"{"op":"rename","start":0,"end":0,"to":"Hit #00","startAt":"7","markers":true,"regions":true}"#,
    r#"{"op":"deleteMarkers","start":25000,"end":45000}"#,
];

fn fnv(bytes: &[u8]) -> String {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in bytes {
        h ^= *b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    format!("{h:016x}")
}

#[test]
fn edit_references() {
    let Ok(dir) = std::env::var("MGL_EDIT_REFS") else { return };
    let dir = PathBuf::from(dir);
    fs::create_dir_all(&dir).unwrap();
    let s = Scratch::new("editrefs");
    let wav = source();
    fs::write(s.library.join("kit/edit.wav"), &wav).unwrap();
    fs::write(dir.join("source.wav"), &wav).unwrap();
    let app = s.app();
    let p = "kit/edit.wav";
    let read = |what: &str, q: &[(&str, &str)]| -> String { String::from_utf8_lossy(&server::routes::route(&app, &get(what, q)).body).to_string() };
    let look = |out: &mut Vec<String>, answer: String| {
        let peaks = read("/api/peaks", &[("p", p), ("cols", "257"), ("clips", "1")]);
        let zoom = read("/api/peaks", &[("p", p), ("cols", "300"), ("clips", "1"), ("from", "5000"), ("to", "5600")]);
        let whole = String::from_utf8_lossy(&server::routes::route(&app, &post("/api/measure", &format!(r#"{{"p":"{p}","start":0,"end":0}}"#))).body).to_string();
        let part = String::from_utf8_lossy(&server::routes::route(&app, &post("/api/measure", &format!(r#"{{"p":"{p}","start":3000,"end":45000}}"#))).body).to_string();
        let dry = server::routes::route(&app, &get("/audio", &[("p", p), ("dry", "1")])).body;
        out.push(format!(
            r#"{{"answer":{answer},"peaks":{peaks},"zoom":{zoom},"measure":{whole},"measurePart":{part},"dry":{{"bytes":{},"fnv":"{}"}}}}"#,
            dry.len(),
            fnv(&dry)
        ));
    };
    let mut steps = Vec::new();
    look(&mut steps, "null".into());
    for body in SCRIPT {
        let mut v = body.to_string();
        v.insert_str(1, &format!(r#""p":"{p}","#));
        let r = server::routes::route(&app, &post("/api/edit", &v));
        assert_eq!(status(&r), 200, "{body}: {}", String::from_utf8_lossy(&r.body));
        look(&mut steps, String::from_utf8_lossy(&r.body).to_string());
    }
    let mut annots = Vec::new();
    let set = server::routes::route(
        &app,
        &post(
            "/api/markers",
            &format!(
                r#"{{"p":"{p}","markers":[{{"frame":5000,"label":"a"}},{{"frame":20000,"label":"b"}},{{"frame":41000,"label":"c"}},{{"frame":60000,"label":"d"}}],"regions":[{{"start":70000,"end":65000,"label":"r1"}}]}}"#
            ),
        ),
    );
    annots.push(String::from_utf8_lossy(&set.body).to_string());
    for body in ANNOT {
        let mut v = body.to_string();
        v.insert_str(1, &format!(r#""p":"{p}","#));
        let r = server::routes::route(&app, &post("/api/annot", &v));
        assert_eq!(status(&r), 200, "{body}");
        annots.push(String::from_utf8_lossy(&r.body).to_string());
    }
    let script: Vec<String> = SCRIPT.iter().map(|s| s.to_string()).collect();
    let annot: Vec<String> = ANNOT.iter().map(|s| s.to_string()).collect();
    fs::write(
        dir.join("steps.json"),
        format!(
            r#"{{"script":[{}],"steps":[{}],"annotScript":[{}],"annot":[{}]}}"#,
            script.join(","),
            steps.join(",\n"),
            annot.join(","),
            annots.join(",\n")
        ),
    )
    .unwrap();
}

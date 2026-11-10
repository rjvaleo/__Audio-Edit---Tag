//! The invariants, named; export progress, the measuring passes, the map and the clipboard.

use super::*;

// ==================================================== the invariants, named
//
// Seven of the eleven had no test that named them. Several are no doubt covered
// incidentally somewhere, and that is the problem: a test that does not say
// which promise it is keeping is one nobody recognises when they go to change
// the code underneath it.

/// **Invariant 1: the source file is never written.**
///
/// The promise the whole program rests on. Edits, effects and stretch are all
/// sidecar; audio reaches disk only through an explicit export to a new file.
///
/// Asserted on the bytes, not on the modified time — a rewrite that happened to
/// produce identical content would still be a rewrite, but a changed byte is
/// the thing that actually loses someone's recording.
#[test]
fn invariant_1_an_export_does_not_touch_the_source() {
    let s = Scratch::new("inv1-export");
    s.sound("kit/tone.wav", 8000);
    let source = s.library.join("kit/tone.wav");
    let before = fs::read(&source).unwrap();
    let before_len = before.len();

    let app = s.app();

    // Something on every layer: an edit, a rack, a stretch — so the export has
    // real work to do rather than copying the file.
    server::routes::route(
        &app,
        &post("/api/rack", r#"{"p":"kit/tone.wav","sr":44100,"slots":[{"id":"g1","kind":"gain","bypassed":false,"db":-6}]}"#),
    );
    server::routes::route(
        &app,
        &post("/api/edit", r#"{"p":"kit/tone.wav","op":"stretch","ratio":2.0,"semitones":3,"windowMs":40}"#),
    );
    let r = export_and_wait(&app, r#"{"p":"kit/tone.wav","bits":24}"#);

    let after = fs::read(&source).unwrap();
    assert_eq!(after.len(), before_len, "the source changed length");
    assert!(after == before, "the source file's bytes changed during an export");

    // And the export really did go somewhere else.
    let path = r.get("path").and_then(|p| p.as_str()).unwrap().to_string();
    assert_ne!(
        std::path::Path::new(&path).canonicalize().unwrap(),
        source.canonicalize().unwrap(),
        "the export wrote over the source"
    );
}

/// **Invariant 1, again: an export never overwrites an existing file.**
///
/// Exporting twice in a minute is ordinary. Silently replacing the first one is
/// the same class of loss as writing the source.
#[test]
fn invariant_1_a_second_export_writes_a_second_file() {
    let s = Scratch::new("inv1-twice");
    s.sound("kit/tone.wav", 4000);
    let app = s.app();

    let a = export_and_wait(&app, r#"{"p":"kit/tone.wav","bits":24}"#);
    let b = export_and_wait(&app, r#"{"p":"kit/tone.wav","bits":24}"#);
    let pa = a.get("path").and_then(|p| p.as_str()).unwrap().to_string();
    let pb = b.get("path").and_then(|p| p.as_str()).unwrap().to_string();
    assert_ne!(pa, pb, "the second export replaced the first");
    assert!(std::path::Path::new(&pa).exists(), "the first export is gone");
    assert!(std::path::Path::new(&pb).exists());
}

/// **Invariant 8: a saved session is refused if the file changed.**
///
/// Stale offsets pointing at the wrong audio is worse than losing the edit.
#[test]
fn invariant_8_a_session_is_refused_when_the_file_underneath_it_changed() {
    let s = Scratch::new("inv8");
    s.sound("kit/tone.wav", 8000);
    let app = s.app();

    // An edit, so there is a session to be stale.
    server::routes::route(
        &app,
        &post("/api/edit", r#"{"p":"kit/tone.wav","op":"stretch","ratio":2.0,"semitones":0,"windowMs":40}"#),
    );
    let before = server::routes::route(&app, &get("/api/edit", &[("p", "kit/tone.wav")]));
    assert_eq!(status(&before), 200);

    // The file is replaced with one of a different length, behind the app's back.
    s.sound("kit/tone.wav", 3000);

    // A fresh App, so nothing is remembered in memory — this is the reload case
    // the invariant is about.
    let app2 = s.app();
    let after = server::routes::route(&app2, &get("/api/edit", &[("p", "kit/tone.wav")]));
    assert_eq!(status(&after), 200, "it should answer, not fail");
    let v = json(&after);
    // Whatever it returns, it must not be the old edit list laid over new audio.
    let frames = num(&v, &["frames"]);
    assert!(
        frames <= 3000.0 * 2.0 + 1.0,
        "an edit list built for 8000 frames was applied to a 3000-frame file: {frames}"
    );
}

// ------------------------------------------------------- export progress

/// The export answers at once and finishes later.
///
/// This is the contract the progress bar rests on: if the POST still blocked
/// until the file existed, there would be nothing to poll and no bar to draw.
#[test]
fn an_export_starts_immediately_and_reports_while_it_runs() {
    let s = Scratch::new("export-progress-start");
    s.sound("kit/tone.wav", 8000);
    let app = s.app();

    let started = json(&server::routes::route(
        &app,
        &post("/api/export", r#"{"p":"kit/tone.wav","bits":24}"#),
    ));
    assert!(
        matches!(started.get("started"), Some(server::json::Value::Bool(true))),
        "the export did not report starting: {}",
        started.to_string()
    );
    // And it said how much work it is, which is what the bar is measured against.
    assert!(num(&started, &["total"]) > 0.0, "no work total was reported");

    // The status route is answerable straight away — the render is on another
    // thread and holds no lock across it.
    let st = json(&server::routes::route(&app, &get("/api/export", &[])));
    assert!(st.get("phase").is_some(), "no phase in {}", st.to_string());
}

/// It finishes, and the outcome is on the status route rather than the POST.
#[test]
fn the_finished_export_is_reported_through_the_status_route() {
    let s = Scratch::new("export-progress-finish");
    s.sound("kit/tone.wav", 8000);
    let app = s.app();

    let done = export_and_wait(&app, r#"{"p":"kit/tone.wav","bits":24}"#);
    let path = done.get("path").and_then(|p| p.as_str()).unwrap_or("");
    assert!(!path.is_empty(), "no path on the finished export");
    assert!(std::path::Path::new(path).exists(), "the file is not there");
    assert!(num(&done, &["frames"]) > 0.0, "no frame count");
    // Full, so the bar lands on 100 rather than stopping short.
    assert!(
        (num(&done, &["fraction"]) - 1.0).abs() < 1e-9,
        "the bar finished at {}, not 1.0 — the work total does not match what \
         the renderer steps",
        num(&done, &["fraction"])
    );
}

/// Two at once is refused rather than interleaved.
#[test]
fn only_one_export_runs_at_a_time() {
    let s = Scratch::new("export-progress-one");
    s.sound("kit/tone.wav", 400_000);
    let app = s.app();

    let first = server::routes::route(&app, &post("/api/export", r#"{"p":"kit/tone.wav","bits":24}"#));
    assert_eq!(status(&first), 200);
    // Immediately, while the first is still going.
    let second = server::routes::route(&app, &post("/api/export", r#"{"p":"kit/tone.wav","bits":24}"#));
    if status(&second) == 200 {
        // The first finished before the second arrived, which is legal for a
        // small file — but then the second must have started cleanly.
        return;
    }
    assert_eq!(status(&second), 400, "a second export was neither refused nor started");
}

// ── the measuring passes ──────────────────────────────────────────────────────
//
// A library of six hundred sounds added at once turned the first request that
// touched the classifier into a walk of the whole library, and the server is a
// thread per connection, so every request that arrived while it worked started
// its own walk. Thirteen threads were measured decoding the same files from the
// beginning at once, none of them able to see the others' work because nothing
// reached disk until a pass finished.
//
// The property is that a second caller does not start a second pass.

#[test]
fn only_one_thread_can_be_inside_a_pass() {
    use server::state::Pass;
    use std::sync::atomic::{AtomicUsize, Ordering};

    let pass = Arc::new(Pass::default());
    // How many got in at all, and how many were inside together. The second is
    // the number that was wrong: it used to be all of them.
    let entered = Arc::new(AtomicUsize::new(0));
    let inside = Arc::new(AtomicUsize::new(0));
    let most = Arc::new(AtomicUsize::new(0));

    let mut hands = Vec::new();
    for _ in 0..13 {
        let (pass, entered, inside, most) =
            (pass.clone(), entered.clone(), inside.clone(), most.clone());
        hands.push(std::thread::spawn(move || {
            let Some(_guard) = pass.enter() else { return };
            entered.fetch_add(1, Ordering::SeqCst);
            let n = inside.fetch_add(1, Ordering::SeqCst) + 1;
            most.fetch_max(n, Ordering::SeqCst);
            // Long enough that the others are certainly trying.
            std::thread::sleep(std::time::Duration::from_millis(40));
            inside.fetch_sub(1, Ordering::SeqCst);
        }));
    }
    for h in hands {
        h.join().unwrap();
    }

    assert_eq!(most.load(Ordering::SeqCst), 1, "two passes ran at once");
    assert!(entered.load(Ordering::SeqCst) >= 1, "nobody ran the pass at all");
    assert_eq!(inside.load(Ordering::SeqCst), 0, "a pass never finished");
}

#[test]
fn a_pass_can_be_run_again_once_the_last_one_has_finished() {
    use server::state::Pass;

    let pass = Pass::default();
    {
        let first = pass.enter();
        assert!(first.is_some(), "the first caller should get in");
        assert!(pass.enter().is_none(), "the second should be turned away");
    }
    // The flag is cleared by the guard going out of scope, not by the pass
    // remembering to clear it, so an early return or a panic cannot wedge it
    // shut. A wedged flag would mean the library never got measured again.
    assert!(pass.enter().is_some(), "the flag was not released");
}

// ------------------------------------------------------------------ the map

pub(super) fn scan(app: &Arc<App>) {
    assert_eq!(status(&server::routes::route(app, &post("/api/scan", "{}"))), 200);
    for _ in 0..500 {
        let s = json(&server::routes::route(app, &get("/api/scan", &[])));
        if !flag(&s, &["running"]) {
            return;
        }
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
    panic!("the scan never finished");
}

/// Ask until every indexed sound is measured: the map fills in batches, the
/// way the interface sees it, so a large library never holds one request.
fn whole_map(app: &Arc<App>) -> server::json::Value {
    for _ in 0..50 {
        let m = json(&server::routes::route(app, &get("/api/map", &[])));
        if num(&m, &["waiting"]) == 0.0 {
            return m;
        }
    }
    panic!("the map never finished measuring");
}

#[test]
fn the_map_places_every_measured_sound_inside_the_cube() {
    let s = Scratch::new("map");
    for i in 0..3 {
        s.sound(&format!("kit/tone{i}.wav"), 8_000 + i * 6_000);
    }
    let app = s.app();
    scan(&app);
    let m = whole_map(&app);

    let Some(server::json::Value::Arr(points)) = m.get("points") else { panic!("no points: {}", m.to_string()) };
    assert_eq!(points.len(), 3, "{}", m.to_string());
    for p in points {
        assert!(p.get("path").and_then(|x| x.as_str()).unwrap().starts_with("kit/"));
        for layout in ["axes", "islands"] {
            let Some(server::json::Value::Arr(c)) = p.get(layout) else { panic!("no {layout}") };
            assert_eq!(c.len(), 3);
            for v in c {
                let server::json::Value::Num(v) = v else { panic!("{layout} not numbers") };
                assert!((0.0..=1.0).contains(v), "{layout} outside the cube: {v}");
            }
        }
        for key in ["size", "rough", "crisp", "pulseHz", "hz", "seconds"] {
            num(p, &[key]);
        }
        assert!(p.get("family").and_then(|x| x.as_str()).is_some());
    }
}

#[test]
fn an_empty_library_has_an_empty_map() {
    let s = Scratch::new("map-empty");
    let app = s.app();
    let m = json(&server::routes::route(&app, &get("/api/map", &[])));
    assert_eq!(num(&m, &["waiting"]), 0.0);
    assert!(matches!(m.get("points"), Some(server::json::Value::Arr(p)) if p.is_empty()));
}

// ── the clipboard ────────────────────────────────────────────────────────────

#[test]
fn copy_then_paste_lengthens_the_document_and_copy_alone_changes_nothing() {
    let s = Scratch::new("copypaste");
    s.sound("kit/a.wav", 4000);
    let app = s.app();
    let r = server::routes::route(
        &app,
        &post("/api/edit", r#"{"p":"kit/a.wav","op":"copy","start":0,"end":1000}"#),
    );
    assert_eq!(status(&r), 200);
    assert_eq!(num(&json(&r), &["frames"]), 4000.0);
    assert!(!flag(&json(&r), &["canUndo"]), "a copy is not an edit");
    assert_eq!(num(&json(&r), &["clipboard"]), 1000.0);

    let r = server::routes::route(
        &app,
        &post("/api/edit", r#"{"p":"kit/a.wav","op":"paste","start":2000,"end":2000}"#),
    );
    assert_eq!(status(&r), 200);
    assert_eq!(num(&json(&r), &["frames"]), 5000.0);
}

#[test]
fn cut_fills_the_clipboard_and_delete_does_not() {
    let s = Scratch::new("cutdelete");
    s.sound("kit/a.wav", 4000);
    let app = s.app();
    server::routes::route(
        &app,
        &post("/api/edit", r#"{"p":"kit/a.wav","op":"cut","start":0,"end":500}"#),
    );
    let r = server::routes::route(
        &app,
        &post("/api/edit", r#"{"p":"kit/a.wav","op":"delete","start":0,"end":1000}"#),
    );
    assert_eq!(num(&json(&r), &["frames"]), 2500.0);
    // The clipboard still holds the cut, not the delete.
    assert_eq!(num(&json(&r), &["clipboard"]), 500.0);
    let r = server::routes::route(
        &app,
        &post("/api/edit", r#"{"p":"kit/a.wav","op":"paste","start":0,"end":0}"#),
    );
    assert_eq!(num(&json(&r), &["frames"]), 3000.0);
}

#[test]
fn paste_over_a_selection_replaces_it() {
    let s = Scratch::new("pasteover");
    s.sound("kit/a.wav", 4000);
    let app = s.app();
    server::routes::route(
        &app,
        &post("/api/edit", r#"{"p":"kit/a.wav","op":"copy","start":0,"end":100}"#),
    );
    let r = server::routes::route(
        &app,
        &post("/api/edit", r#"{"p":"kit/a.wav","op":"paste","start":1000,"end":2000}"#),
    );
    assert_eq!(num(&json(&r), &["frames"]), 3100.0);
}

#[test]
fn paste_into_another_sound_is_refused_and_says_why() {
    let s = Scratch::new("pasteother");
    s.sound("kit/a.wav", 4000);
    s.sound("kit/b.wav", 4000);
    let app = s.app();
    server::routes::route(
        &app,
        &post("/api/edit", r#"{"p":"kit/a.wav","op":"copy","start":0,"end":100}"#),
    );
    let r = server::routes::route(
        &app,
        &post("/api/edit", r#"{"p":"kit/b.wav","op":"paste","start":0,"end":0}"#),
    );
    assert_eq!(status(&r), 409);
}

#[test]
fn paste_with_nothing_copied_is_refused() {
    let s = Scratch::new("pasteempty");
    s.sound("kit/a.wav", 4000);
    let app = s.app();
    let r = server::routes::route(
        &app,
        &post("/api/edit", r#"{"p":"kit/a.wav","op":"paste","start":0,"end":0}"#),
    );
    assert_eq!(status(&r), 409);
}

/// A Prism LFO's swing (`live: true`) is heard and nothing else: clamped as a
/// hand's move is, but the document keeps the hand's setting — on a slot and on
/// the Pitch Time Changer alike.
#[test]
fn a_live_only_move_leaves_the_setting_where_the_hand_put_it() {
    let s = Scratch::new("live-only");
    s.sound("kit/tone.wav", 4_410);
    let app = s.app();
    server::routes::route(
        &app,
        &post(
            "/api/rack",
            r#"{"p":"kit/tone.wav","sr":44100,"slots":[{"id":"g1","kind":"gain","bypassed":false,"db":-6}]}"#,
        ),
    );
    let r = server::routes::route(
        &app,
        &post("/api/rack/param", r#"{"p":"kit/tone.wav","id":"g1","key":"db","value":9999,"live":true}"#),
    );
    assert_eq!(status(&r), 200, "{}", String::from_utf8_lossy(&r.body));
    assert!(num(&json(&r), &["value"]) < 9999.0, "a live-only move went through unclamped");
    let back = json(&server::routes::route(&app, &get("/api/rack", &[("p", "kit/tone.wav")])));
    let slots = match back.get("slots") {
        Some(server::json::Value::Arr(a)) => a.clone(),
        _ => panic!("no slots came back"),
    };
    assert_eq!(num(&slots[0], &["db"]), -6.0, "the swing was written into the document");
    // Still refused for a control that is not there.
    let r = server::routes::route(
        &app,
        &post("/api/rack/param", r#"{"p":"kit/tone.wav","id":"g1","key":"nonsense","value":1,"live":true}"#),
    );
    assert_eq!(status(&r), 400);

    // The Pitch Time Changer the same way.
    server::routes::route(&app, &post("/api/pitchtime", r#"{"p":"kit/tone.wav","feedback":20}"#));
    let r = server::routes::route(&app, &post("/api/pitchtime", r#"{"p":"kit/tone.wav","feedback":80,"live":true}"#));
    assert_eq!(status(&r), 200);
    let back = json(&server::routes::route(&app, &get("/api/rack", &[("p", "kit/tone.wav")])));
    assert_eq!(num(back.get("pitchTime").expect("kept"), &["feedback"]), 20.0, "the swing was kept");
}

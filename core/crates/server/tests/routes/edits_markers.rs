//! The Peak edit commands, markers and regions live, and a sound opening as itself.

use super::*;

// ------------------------------------------------------ the Peak edit commands

#[test]
fn cropping_keeps_only_the_selection() {
    let s = Scratch::new("crop");
    s.sound("kit/a.wav", 4000);
    let app = s.app();
    let r = server::routes::route(
        &app,
        &post("/api/edit", r#"{"p":"kit/a.wav","op":"crop","start":1000,"end":1500}"#),
    );
    assert_eq!(status(&r), 200);
    assert_eq!(num(&json(&r), &["frames"]), 500.0);
}

#[test]
fn duplicating_lengthens_the_document_by_the_copies_asked_for() {
    let s = Scratch::new("dup");
    s.sound("kit/a.wav", 4000);
    let app = s.app();
    let r = server::routes::route(
        &app,
        &post(
            "/api/edit",
            r#"{"p":"kit/a.wav","op":"duplicate","start":0,"end":1000,"count":3}"#,
        ),
    );
    assert_eq!(num(&json(&r), &["frames"]), 7000.0);
}

#[test]
fn a_runaway_duplicate_count_is_bounded_rather_than_believed() {
    let s = Scratch::new("dupbig");
    s.sound("kit/a.wav", 4000);
    let app = s.app();
    let r = server::routes::route(
        &app,
        &post(
            "/api/edit",
            r#"{"p":"kit/a.wav","op":"duplicate","start":0,"end":4000,"count":999999}"#,
        ),
    );
    // 128 copies plus the original, and no more.
    assert_eq!(num(&json(&r), &["frames"]), 4000.0 * 129.0);
}

#[test]
fn silence_can_be_inserted_in_milliseconds() {
    let s = Scratch::new("ins");
    s.sound("kit/a.wav", 44_100);
    let app = s.app();
    let r = server::routes::route(
        &app,
        &post(
            "/api/edit",
            r#"{"p":"kit/a.wav","op":"insertSilence","start":1000,"ms":500}"#,
        ),
    );
    // Half a second at 44.1 kHz.
    assert_eq!(num(&json(&r), &["frames"]), 44_100.0 + 22_050.0);
}

#[test]
fn the_picture_follows_an_insert_but_not_the_stretch() {
    // `clips=1` draws the edited clips on the timeline the selection and the
    // playhead are counted on: an insert lengthens it, a stretch does not.
    let s = Scratch::new("clipspeaks");
    s.sound("kit/a.wav", 4000);
    let app = s.app();
    let peaks = |q: &[(&str, &str)]| num(&json(&server::routes::route(&app, &get("/api/peaks", q))), &["frames"]);
    let q = [("p", "kit/a.wav"), ("cols", "100"), ("clips", "1")];
    assert_eq!(peaks(&q), 4000.0, "unedited is the file");
    server::routes::route(
        &app,
        &post("/api/edit", r#"{"p":"kit/a.wav","op":"insertSilence","start":100,"frames":9000}"#),
    );
    assert_eq!(peaks(&q), 13_000.0, "the insert is in the picture");
    assert_eq!(peaks(&[("p", "kit/a.wav"), ("cols", "100")]), 4000.0, "without clips=1 it is still the file");
    server::routes::route(&app, &post("/api/edit", r#"{"p":"kit/a.wav","op":"stretch","ratio":2}"#));
    assert_eq!(peaks(&q), 13_000.0, "the stretch is not");
}

#[test]
fn inserted_silence_survives_being_written_out_and_read_back() {
    // The reader used to refuse any clip reaching past the end of the source,
    // which is every silent clip, so a saved pause came back missing.
    let s = Scratch::new("inspersist");
    s.sound("kit/a.wav", 4000);
    let app = s.app();
    server::routes::route(
        &app,
        &post("/api/edit", r#"{"p":"kit/a.wav","op":"insertSilence","start":100,"frames":9000}"#),
    );
    let list = app.edits.snapshot("kit/a.wav").unwrap();
    assert_eq!(list.frames(), 13_000);

    let back = server::persist::edit_from_json(
        &server::persist::edit_to_json(&list),
        &edit::EditList::identity(4000, 1, 44_100),
    )
    .expect("should read back");
    assert_eq!(back.frames(), 13_000, "the pause was dropped on reload");
}

#[test]
fn snapping_moves_the_edit_and_says_where_it_went() {
    let s = Scratch::new("snap");
    s.sound("kit/a.wav", 4000);
    let app = s.app();
    let r = server::routes::route(
        &app,
        &post(
            "/api/edit",
            r#"{"p":"kit/a.wav","op":"cut","start":1007,"end":2007,"snap":"zero"}"#,
        ),
    );
    let v = json(&r);
    let (a, b) = (num(&v, &["snapped", "start"]), num(&v, &["snapped", "end"]));
    // The fixture is sin(i/30), whose period is 30·2π ≈ 188 frames, so a
    // crossing is never more than about 95 frames away — and the ten
    // millisecond radius at 44.1 kHz is 441, which comfortably reaches one.
    assert!((a - 1007.0).abs() <= 95.0 && a != 1007.0, "start went to {a}");
    assert!((b - 2007.0).abs() <= 95.0 && b != 2007.0, "end went to {b}");
    assert_eq!(num(&v, &["frames"]), 4000.0 - (b - a));
}

#[test]
fn without_a_snap_the_edit_lands_exactly_where_it_was_asked() {
    // Every caller written before snap existed must be unaffected, and the
    // response must not grow a field that says otherwise.
    let s = Scratch::new("nosnap");
    s.sound("kit/a.wav", 4000);
    let app = s.app();
    let r = server::routes::route(
        &app,
        &post("/api/edit", r#"{"p":"kit/a.wav","op":"cut","start":1007,"end":2007}"#),
    );
    let v = json(&r);
    assert_eq!(num(&v, &["frames"]), 3000.0);
    assert!(v.get("snapped").is_none(), "an unsnapped edit reported a snap");
}

#[test]
fn a_grid_snap_lands_on_a_multiple_of_the_grid() {
    let s = Scratch::new("snapcd");
    s.sound("kit/a.wav", 4000);
    let app = s.app();
    let r = server::routes::route(
        &app,
        &post(
            "/api/edit",
            r#"{"p":"kit/a.wav","op":"cut","start":1000,"end":2000,"snap":"cd"}"#,
        ),
    );
    let v = json(&r);
    assert_eq!(num(&v, &["snapped", "start"]), 1176.0); // 2 × 588, nearest to 1000
    assert_eq!(num(&v, &["snapped", "end"]), 1764.0); // 3 × 588, nearest to 2000
}

#[test]
fn an_unknown_snap_unit_leaves_the_edit_where_it_was_rather_than_guessing() {
    let s = Scratch::new("snapbad");
    s.sound("kit/a.wav", 4000);
    let app = s.app();
    let r = server::routes::route(
        &app,
        &post(
            "/api/edit",
            r#"{"p":"kit/a.wav","op":"cut","start":1000,"end":2000,"snap":"bars"}"#,
        ),
    );
    assert_eq!(num(&json(&r), &["frames"]), 3000.0);
}

#[test]
fn measuring_reports_the_peak_and_where_it_is() {
    let s = Scratch::new("measure");
    s.sound("kit/a.wav", 4000);
    let app = s.app();
    let r = server::routes::route(&app, &post("/api/measure", r#"{"p":"kit/a.wav"}"#));
    assert_eq!(status(&r), 200);
    let v = json(&r);
    let peak = num(&v, &["peak"]);
    assert!(peak > 0.2 && peak <= 1.0, "peak {peak}");
    assert!(num(&v, &["rms"]) > 0.0);
    assert!(num(&v, &["peakFrame"]) < 4000.0);
    // A measurement must not become an edit.
    assert!(!app.edits.has_edits("kit/a.wav"));
}

#[test]
fn rms_normalising_changes_the_level_without_passing_the_ceiling() {
    let s = Scratch::new("rms");
    s.sound("kit/a.wav", 4000);
    let app = s.app();
    let before = json(&server::routes::route(
        &app,
        &post("/api/measure", r#"{"p":"kit/a.wav"}"#),
    ));
    server::routes::route(
        &app,
        &post(
            "/api/edit",
            r#"{"p":"kit/a.wav","op":"normalizeRms","db":-6,"ceilingDb":-0.3}"#,
        ),
    );
    let after = json(&server::routes::route(
        &app,
        &post("/api/measure", r#"{"p":"kit/a.wav"}"#),
    ));

    assert!(
        num(&after, &["rms"]) > num(&before, &["rms"]),
        "it should have got louder"
    );
    let ceiling = 10f64.powf(-0.3 / 20.0);
    assert!(
        num(&after, &["peak"]) <= ceiling + 1e-3,
        "the ceiling was breached: {}",
        num(&after, &["peak"])
    );
}

#[test]
fn stripping_silence_removes_the_quiet_and_shortens_the_file() {
    let s = Scratch::new("strip");
    // Loud, silent, loud.
    let path = s.library.join("kit/b.wav");
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    let frames = 44_100usize;
    let mut out =
        audio_core::wav::header((frames * 2) as u64, 1, 44_100, audio_core::Codec::PcmI16).to_vec();
    for i in 0..frames {
        let quiet = i >= 15_000 && i < 30_000;
        let v = if quiet { 0 } else { ((i as f32 / 30.0).sin() * 9000.0) as i16 };
        out.extend_from_slice(&v.to_le_bytes());
    }
    fs::write(&path, out).unwrap();

    let app = s.app();
    let r = server::routes::route(
        &app,
        &post(
            "/api/edit",
            r#"{"p":"kit/b.wav","op":"stripSilence","thresholdDb":-40,"minMs":100,"padMs":0,"mode":"remove"}"#,
        ),
    );
    let got = num(&json(&r), &["frames"]);
    assert!(
        (got - 29_100.0).abs() < 1000.0,
        "expected about 29100 frames left, got {got}"
    );
}

#[test]
fn repairing_a_click_takes_out_a_sliver_and_no_more() {
    let s = Scratch::new("click");
    let path = s.library.join("kit/c.wav");
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    let frames = 8000usize;
    let mut out =
        audio_core::wav::header((frames * 2) as u64, 1, 44_100, audio_core::Codec::PcmI16).to_vec();
    for i in 0..frames {
        let v = if i == 4000 { 32_000 } else { ((i as f32 / 60.0).sin() * 3000.0) as i16 };
        out.extend_from_slice(&v.to_le_bytes());
    }
    fs::write(&path, out).unwrap();

    let app = s.app();
    let before = json(&server::routes::route(
        &app,
        &post("/api/measure", r#"{"p":"kit/c.wav","start":3900,"end":4100}"#),
    ));
    assert!((num(&before, &["clickFrame"]) - 4000.0).abs() < 3.0);

    let r = server::routes::route(
        &app,
        &post(
            "/api/edit",
            r#"{"p":"kit/c.wav","op":"repairClick","start":3900,"end":4100,"widthMs":1}"#,
        ),
    );
    let left = num(&json(&r), &["frames"]);
    assert!(left < 8000.0, "nothing was removed");
    assert!(left > 7900.0, "far too much was removed: {left} of 8000");

    let after = json(&server::routes::route(
        &app,
        &post("/api/measure", r#"{"p":"kit/c.wav","start":3800,"end":4200}"#),
    ));
    assert!(
        num(&after, &["clickDeviation"]) < num(&before, &["clickDeviation"]) / 10.0,
        "the click survived: {} then {}",
        num(&before, &["clickDeviation"]),
        num(&after, &["clickDeviation"])
    );
}

#[test]
fn an_unknown_edit_operation_is_refused_rather_than_ignored() {
    let s = Scratch::new("badop");
    s.sound("kit/a.wav", 1000);
    let app = s.app();
    let r = server::routes::route(
        &app,
        &post("/api/edit", r#"{"p":"kit/a.wav","op":"obliterate"}"#),
    );
    assert_eq!(status(&r), 400);
}

// -------------------------------------------------- markers and regions, live

#[test]
fn markers_become_regions_over_the_wire() {
    let s = Scratch::new("m2r");
    s.sound("kit/a.wav", 4000);
    let app = s.app();
    server::routes::route(
        &app,
        &post(
            "/api/markers",
            r#"{"p":"kit/a.wav","markers":[{"frame":100,"label":"Foo 1"},{"frame":200,"label":"Foo 2"},{"frame":300,"label":"Foo 3"}]}"#,
        ),
    );
    let r = server::routes::route(
        &app,
        &post("/api/annot", r#"{"p":"kit/a.wav","op":"markersToRegions"}"#),
    );
    let v = json(&r);
    let regions = match v.get("regions") {
        Some(server::json::Value::Arr(a)) => a.clone(),
        _ => panic!("no regions"),
    };
    assert_eq!(regions.len(), 2);
    assert_eq!(regions[0].get("label").unwrap().as_str().unwrap(), "Foo 1");
}

#[test]
fn renaming_over_the_wire_numbers_them_in_order() {
    let s = Scratch::new("ren");
    s.sound("kit/a.wav", 4000);
    let app = s.app();
    server::routes::route(
        &app,
        &post(
            "/api/markers",
            r#"{"p":"kit/a.wav","markers":[{"frame":900,"label":"b"},{"frame":100,"label":"a"}]}"#,
        ),
    );
    let r = server::routes::route(
        &app,
        &post(
            "/api/annot",
            r#"{"p":"kit/a.wav","op":"rename","to":"Hit #00","startAt":"1","markers":true}"#,
        ),
    );
    let v = json(&r);
    let ms = match v.get("markers") {
        Some(server::json::Value::Arr(a)) => a.clone(),
        _ => panic!("no markers"),
    };
    assert_eq!(ms[0].get("label").unwrap().as_str().unwrap(), "Hit 01");
    assert_eq!(ms[1].get("label").unwrap().as_str().unwrap(), "Hit 02");
}

#[test]
fn an_annotation_change_is_written_to_disk_not_just_held() {
    let s = Scratch::new("annotsave");
    s.sound("kit/a.wav", 4000);
    let app = s.app();
    server::routes::route(
        &app,
        &post("/api/markers", r#"{"p":"kit/a.wav","markers":[{"frame":100,"label":"x"}]}"#),
    );
    server::routes::route(
        &app,
        &post("/api/annot", r#"{"p":"kit/a.wav","op":"nudge","frames":250}"#),
    );
    let raw = fs::read_to_string(app.markers_path()).unwrap();
    assert!(raw.contains("350"), "the nudge was not persisted: {raw}");
}

#[test]
fn an_unknown_annotation_operation_is_refused() {
    let s = Scratch::new("annotbad");
    s.sound("kit/a.wav", 1000);
    let app = s.app();
    let r = server::routes::route(
        &app,
        &post("/api/annot", r#"{"p":"kit/a.wav","op":"explode"}"#),
    );
    assert_eq!(status(&r), 400);
}

// ------------------------------------------- a sound opens as itself

#[test]
fn a_sound_opens_at_its_defaults_however_it_was_left() {
    // Settings that arrive without being asked for are indistinguishable from
    // a bug. A file could come up at thirty-six times its length because of
    // something done to it in a previous run of the program.
    let s = Scratch::new("defaults");
    s.sound("kit/a.wav", 4000);
    let app = s.app();

    // Leave a heavy stretch on it and let it reach disk.
    server::routes::route(
        &app,
        &post("/api/edit", r#"{"p":"kit/a.wav","op":"stretch","ratio":36.6,"semitones":-11,"algorithm":"granular"}"#),
    );
    app.save_sessions();
    let raw = fs::read_to_string(app.sessions_path()).unwrap();
    // Written as an f32, so it lands a little under the number that was asked
    // for. What matters is that the heavy stretch reached the file at all.
    assert!(raw.contains("\"ratio\":36.59"), "the session should have been written: {raw}");

    // A fresh process, same data directory.
    let app2 = s.app();
    let v = json(&server::routes::route(&app2, &get("/api/edit", &[("p", "kit/a.wav")])));
    assert_eq!(num(&v, &["stretch", "ratio"]), 1.0, "it came up stretched");
    assert_eq!(num(&v, &["stretch", "semitones"]), 0.0, "it came up pitched");
    assert!(!flag(&v, &["edited"]), "it came up already edited");
    assert_eq!(text(&v, &["stretch", "algorithm"]), "wsola");
}

#[test]
fn work_done_in_this_run_survives_switching_away_and_back() {
    // The other half of the rule: only *restoring from disk* stopped. A
    // document being worked on keeps everything until the program closes.
    let s = Scratch::new("keepwork");
    s.sound("kit/a.wav", 4000);
    s.sound("kit/b.wav", 4000);
    let app = s.app();

    server::routes::route(
        &app,
        &post("/api/edit", r#"{"p":"kit/a.wav","op":"cut","start":0,"end":1000}"#),
    );
    // Go and look at something else, then come back.
    server::routes::route(&app, &get("/api/edit", &[("p", "kit/b.wav")]));
    let v = json(&server::routes::route(&app, &get("/api/edit", &[("p", "kit/a.wav")])));
    assert_eq!(num(&v, &["frames"]), 3000.0, "the cut was lost");
    assert!(flag(&v, &["canUndo"]), "the history was lost");
}

#[test]
fn an_audition_is_the_sound_and_a_document_is_the_document() {
    // The rule the library depends on, as a function of its arguments — the
    // rest of `live::load` is a device and cannot be reached from a test.
    use server::live::{playback_list, Playing};
    let plain = edit::EditList::identity(4000, 1, 44_100);
    let mut worked = plain.clone();
    worked.cut(edit::Range::new(0, 1000));
    worked.stretch = fx::Stretch { ratio: 36.6, semitones: -11.0, ..fx::Stretch::default() };

    let audition = playback_list(Playing::Raw, Some(worked.clone()), plain.clone());
    assert!(audition.is_identity(), "an audition carried the document's work");
    assert_eq!(audition.frames(), 4000);

    let document = playback_list(Playing::Document, Some(worked.clone()), plain.clone());
    assert_eq!(document, worked, "the editor lost the document");

    // Nothing open yet: both fall back to the file itself.
    assert!(playback_list(Playing::Document, None, plain.clone()).is_identity());
}

#[test]
fn settings_for_a_sound_the_engine_is_not_holding_go_nowhere() {
    // What comes out of the speakers has to be what is on the screen. With no
    // engine running at all, `holding` is false for every path, and a stretch
    // change must still land on the *document* — it simply is not pushed at
    // the audio thread, which is holding something else or nothing.
    let s = Scratch::new("holding");
    s.sound("kit/a.wav", 4000);
    let app = s.app();

    assert!(!server::live::holding(&app, "kit/a.wav"), "nothing is loaded");

    let r = server::routes::route(
        &app,
        &post("/api/edit", r#"{"p":"kit/a.wav","op":"stretch","ratio":4}"#),
    );
    assert_eq!(status(&r), 200);
    // The document took it, which is what export and the next load will read.
    assert_eq!(num(&json(&r), &["stretch", "ratio"]), 4.0);
}

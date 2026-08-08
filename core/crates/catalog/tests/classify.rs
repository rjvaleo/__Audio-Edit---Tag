use catalog::{classify, Category, Confidence, FileFacts, Series};

/// Convenience builder so each test states only what it cares about.
fn facts(name: &str) -> FileFacts<'static> {
    FileFacts {
        stem: Box::leak(name.to_string().into_boxed_str()),
        ext: ".wav",
        folder_chain: &[],
        duration: 1.0,
        readable: true,
        series: None,
    }
}

fn in_folders(name: &'static str, chain: &'static [&'static str]) -> FileFacts<'static> {
    FileFacts {
        folder_chain: chain,
        ..facts(name)
    }
}

// ---------------------------------------------------------------- machines

#[test]
fn recognises_a_drum_machine_written_several_ways() {
    for name in ["TR-808 kick", "tr808 kick", "tr_808 kick", "808 kick"] {
        let r = classify(&FileFacts {
            duration: 0.4,
            ..facts(name)
        });
        assert_eq!(r.machine.as_deref(), Some("TR-808"), "for {name:?}");
    }
}

#[test]
fn does_not_see_a_machine_in_an_unrelated_number() {
    // "808" inside a longer number is not a machine reference.
    let r = classify(&facts("take 18089"));
    assert_eq!(r.machine, None);
}

#[test]
fn inherits_the_machine_from_the_folder_when_the_filename_is_bare() {
    let r = classify(&FileFacts {
        duration: 0.4,
        ..in_folders("kick 01", &["LinnDrum samples"])
    });
    assert_eq!(r.machine.as_deref(), Some("LinnDrum LM-1"));
    assert!(
        r.reasons.iter().any(|s| s.contains("from folder")),
        "provenance of an inherited machine must be recorded, got {:?}",
        r.reasons
    );
}

#[test]
fn a_machine_in_the_filename_beats_one_in_the_folder() {
    let r = classify(&FileFacts {
        duration: 0.4,
        ..in_folders("tr909 snare", &["LinnDrum samples"])
    });
    assert_eq!(r.machine.as_deref(), Some("TR-909"));
}

// ---------------------------------------------------------------- instruments

#[test]
fn recognises_instrument_abbreviations() {
    for (name, want) in [
        ("bd 01", "Kick"),
        ("kick soft", "Kick"),
        ("sd hard", "Snare"),
        ("snare 3", "Snare"),
        ("chh tight", "Hat Closed"),
        ("open hat", "Hat Open"),
        ("cp 02", "Clap"),
        ("cowbell", "Cowbell"),
    ] {
        let r = classify(&FileFacts {
            duration: 0.3,
            ..facts(name)
        });
        assert_eq!(r.instrument.as_deref(), Some(want), "for {name:?}");
    }
}

#[test]
fn closed_and_open_hats_are_not_collapsed_into_plain_hat() {
    let closed = classify(&FileFacts {
        duration: 0.2,
        ..facts("closed hat 1")
    });
    let open = classify(&FileFacts {
        duration: 0.2,
        ..facts("open hat 1")
    });
    assert_eq!(closed.instrument.as_deref(), Some("Hat Closed"));
    assert_eq!(open.instrument.as_deref(), Some("Hat Open"));
}

// ---------------------------------------------------------------- categories

#[test]
fn a_short_drum_hit_is_a_one_shot() {
    let r = classify(&FileFacts {
        duration: 0.35,
        ..facts("kick 01")
    });
    assert_eq!(r.category, Category::DrumOneshot);
}

#[test]
fn a_known_machine_raises_confidence_on_a_drum_hit() {
    let bare = classify(&FileFacts {
        duration: 0.35,
        ..facts("kick 01")
    });
    let with_machine = classify(&FileFacts {
        duration: 0.35,
        ..facts("tr808 kick 01")
    });
    assert_eq!(bare.confidence, Confidence::Medium);
    assert_eq!(with_machine.confidence, Confidence::High);
}

#[test]
fn a_long_file_with_a_master_keyword_is_a_song() {
    let r = classify(&FileFacts {
        duration: 210.0,
        ..facts("Nightfall master")
    });
    assert_eq!(r.category, Category::Song);
    assert_eq!(r.confidence, Confidence::High);
}

#[test]
fn a_short_file_with_a_master_keyword_is_doubted_not_trusted() {
    // A two-second file called "master" is far more likely a sample than a song.
    let r = classify(&FileFacts {
        duration: 2.0,
        ..facts("master stab")
    });
    assert_eq!(r.category, Category::SongUncertain);
    assert_eq!(r.confidence, Confidence::Low);
}

#[test]
fn a_long_file_in_a_masters_folder_is_a_song_without_a_keyword() {
    let r = classify(&FileFacts {
        duration: 180.0,
        ..in_folders("untitled 4", &["Album", "Masters"])
    });
    assert_eq!(r.category, Category::Song);
}

#[test]
fn anything_over_five_minutes_is_a_long_session() {
    let r = classify(&FileFacts {
        duration: 700.0,
        ..facts("untitled")
    });
    assert_eq!(r.category, Category::LongSession);
}

#[test]
fn a_numbered_series_without_a_drum_token_is_a_chop() {
    let r = classify(&FileFacts {
        duration: 1.4,
        series: Some(Series {
            root: "gtr slice".into(),
            index: 7,
            size: 12,
        }),
        ..facts("gtr slice 07")
    });
    assert_eq!(r.category, Category::Chop);
}

#[test]
fn a_vocal_token_outranks_series_numbering() {
    // Deliberate: a numbered run of vocal takes is filed as vocal, not as chops.
    let r = classify(&FileFacts {
        duration: 1.4,
        series: Some(Series {
            root: "vox slice".into(),
            index: 7,
            size: 12,
        }),
        ..facts("vox slice 07")
    });
    assert_eq!(r.category, Category::Vocal);
}

#[test]
fn a_drum_token_beats_series_numbering() {
    // Kits are numbered too. Without this rule every numbered kick becomes a chop.
    let r = classify(&FileFacts {
        duration: 0.4,
        series: Some(Series {
            root: "kick".into(),
            index: 3,
            size: 9,
        }),
        ..facts("kick 03")
    });
    assert_eq!(r.category, Category::DrumOneshot);
    assert!(r.reasons.iter().any(|s| s.contains("drum token wins")));
}

#[test]
fn a_bpm_in_the_name_marks_a_loop() {
    let r = classify(&FileFacts {
        duration: 4.0,
        ..facts("gtr riff 120bpm")
    });
    assert_eq!(r.category, Category::Loop);
    assert_eq!(r.bpm, Some(120));
}

#[test]
fn bpm_is_read_whichever_side_the_number_sits() {
    for name in ["groove 128 bpm", "bpm 128 groove", "groove128bpm"] {
        let r = classify(&FileFacts {
            duration: 4.0,
            ..facts(name)
        });
        assert_eq!(r.bpm, Some(128), "for {name:?}");
    }
}

#[test]
fn an_implausible_bpm_is_ignored() {
    let r = classify(&FileFacts {
        duration: 4.0,
        ..facts("take 1999bpm")
    });
    assert_eq!(r.bpm, None);
}

#[test]
fn fx_keywords_win_over_the_duration_fallback() {
    let r = classify(&FileFacts {
        duration: 3.0,
        ..facts("riser sweep 02")
    });
    assert_eq!(r.category, Category::Fx);
}

#[test]
fn a_sustained_pad_keyword_is_a_pad_but_a_brief_one_is_not() {
    let long = classify(&FileFacts {
        duration: 20.0,
        ..facts("warm pad")
    });
    assert_eq!(long.category, Category::PadBed);

    let brief = classify(&FileFacts {
        duration: 0.5,
        ..facts("warm pad")
    });
    assert_ne!(brief.category, Category::PadBed);
}

#[test]
fn vocals_are_detected() {
    let r = classify(&FileFacts {
        duration: 4.0,
        ..facts("vox take 2")
    });
    assert_eq!(r.category, Category::Vocal);
}

// ---------------------------------------------------------------- non-audio

#[test]
fn cache_and_document_extensions_are_set_aside() {
    let cache = classify(&FileFacts {
        ext: ".asd",
        ..facts("kick 01")
    });
    assert_eq!(cache.category, Category::Cache);

    let doc = classify(&FileFacts {
        ext: ".txt",
        ..facts("readme")
    });
    assert_eq!(doc.category, Category::Document);
}

#[test]
fn an_unreadable_file_is_marked_broken_not_guessed_at() {
    let r = classify(&FileFacts {
        readable: false,
        duration: 0.0,
        ..facts("kick 01")
    });
    assert_eq!(r.category, Category::Broken);
    assert_eq!(r.confidence, Confidence::High);
}

// ------------------------------------------------------- duration fallbacks

#[test]
fn untyped_files_fall_back_to_duration_bands() {
    let cases = [
        (0.5, Category::OneShot),
        (4.0, Category::SampleShort),
        (20.0, Category::Sample),
        (60.0, Category::SectionBed),
    ];
    for (dur, want) in cases {
        let r = classify(&FileFacts {
            duration: dur,
            ..facts("xyzzy")
        });
        assert_eq!(r.category, want, "at {dur}s");
        assert_eq!(r.confidence, Confidence::Low, "at {dur}s");
    }
}

#[test]
fn a_file_with_no_duration_and_no_signal_is_unknown() {
    let r = classify(&FileFacts {
        duration: 0.0,
        ..facts("xyzzy")
    });
    assert_eq!(r.category, Category::Unknown);
}

#[test]
fn every_result_explains_itself() {
    // The browser shows these to justify a grouping; an empty list is a bug.
    let r = classify(&FileFacts {
        duration: 0.4,
        ..facts("tr808 kick 01")
    });
    assert!(!r.reasons.is_empty());
}

//! `badBlocks` on `GET /api/engine/state` (AUDIO-PLAN §2.2 task 12).

use super::*;
use std::sync::atomic::Ordering;

#[test]
fn engine_state_reports_bad_blocks_zero_and_tracks_increases() {
    std::env::set_var("AUDIOLAB_MUTE_OUTPUT", "1");
    let s = Scratch::new("bad-blocks");
    let app = s.app();

    let r = server::routes::route(&app, &get("/api/engine/state", &[]));
    assert_eq!(status(&r), 200);
    let v = json(&r);
    assert_eq!(num(&v, &["badBlocks"]), 0.0, "fresh engine should report 0 badBlocks");
    assert_eq!(num(&v, &["prismBadBlocks"]), 0.0, "fresh engine should report 0 prismBadBlocks");

    // When this machine has an audio device and the route opened a handle,
    // bump both counters by hand and verify `/api/engine/state` reflects them.
    let bumped = server::live::peek(&app, |h| {
        h.shared.bad_blocks.fetch_add(3, Ordering::Relaxed);
        h.prism.bad_blocks.fetch_add(2, Ordering::Relaxed);
    })
    .is_some();

    if bumped {
        let r2 = server::routes::route(&app, &get("/api/engine/state", &[]));
        assert_eq!(status(&r2), 200);
        let v2 = json(&r2);
        assert_eq!(num(&v2, &["badBlocks"]), 3.0);
        assert_eq!(num(&v2, &["prismBadBlocks"]), 2.0);
    }

    if let Ok(mut slot) = app.audio.lock() {
        if let Some(h) = slot.take() {
            h.stop();
        }
    };
}

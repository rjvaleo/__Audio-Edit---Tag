//! A live session, with two threads and everything sent "now", equals an
//! offline render fed the same messages stamped with the frames they landed on.

mod common;
use common::*;
use engine_core::*;

#[test]
fn a_live_session_equals_its_offline_replay() {
    let live = live_session(|| 0);
    assert!(peak(&live.l) > 0.05);
    assert_eq!(live.ops.len(), 300);
    assert!(live.collected.plans >= 3, "each patch change returned an old plan");

    let (mut ctl, mut audio) = engine(RATE, Config::default());
    full_patch(&mut ctl);
    for (op, seq) in &live.ops {
        let frame = *live.landed.get(seq).unwrap_or_else(|| panic!("message {seq} never landed: {op:?}"));
        let replayed = apply(&mut ctl, op, Some(frame));
        assert_eq!(replayed, *seq, "the replay numbers its messages as the session did");
    }
    let (l, r) = render(&mut audio, live.l.len(), 97);
    assert_same("left", &live.l, &l);
    assert_same("right", &live.r, &r);

    let spread: std::collections::BTreeSet<u64> = live.landed.values().copied().collect();
    assert!(spread.len() > 20, "the messages landed across the session, not all at once ({})", spread.len());
}

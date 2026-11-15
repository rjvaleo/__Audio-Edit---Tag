//! Rack documents and the suite (SUITE-PLAN §3.3, P2): every kind opens,
//! renders, saves with its module and mode, and reopens to the same bits.

use super::*;
use crate::json;
use fx::shape::ShapeKind;

fn all_kinds() -> Vec<String> {
    let mut v: Vec<String> = ShapeKind::ALL.iter().map(|k| k.as_str().to_string()).collect();
    v.extend(["eq", "comp", "gain"].map(String::from));
    v.extend(fx::prism::catalogue().iter().map(|e| format!("prism:{}", e.descriptor.id)));
    v
}

fn doc(slot: &str) -> RackSpec {
    RackSpec::from_json(&json::parse(&format!(r#"{{"slots":[{slot}]}}"#)).unwrap())
}

fn source(frames: usize) -> Vec<f32> {
    let mut x = 0x2545_f491_u32;
    (0..frames * 2)
        .map(|i| {
            x ^= x << 13;
            x ^= x >> 17;
            x ^= x << 5;
            let t = (i / 2) as f32 / 48_000.0;
            0.4 * (t * 330.0 * std::f32::consts::TAU).sin() + 0.2 * ((x as f32 / u32::MAX as f32) - 0.5)
        })
        .collect()
}

fn render(spec: &RackSpec) -> Vec<u32> {
    let mut rack = spec.build(48_000, 2);
    let mut buf = source(6000);
    for chunk in buf.chunks_mut(512 * 2) {
        rack.process(chunk, 2, 48_000);
    }
    buf.iter().map(|x| x.to_bits()).collect()
}

#[test]
fn every_kind_saves_its_module_and_mode_and_reopens_to_the_same_bits() {
    for kind in all_kinds() {
        let opened = doc(&format!(r#"{{"kind":"{kind}","id":"s1"}}"#));
        assert_eq!(opened.slots.len(), 1, "{kind} did not open");
        let saved = opened.to_json();
        let slot = &saved.get("slots").and_then(|s| if let Value::Arr(a) = s { a.first().cloned() } else { None }).unwrap();
        let (s, m) = fx::suite::mode_of_kind(&kind).unwrap();
        assert_eq!(slot.get("kind").and_then(Value::as_str), Some(kind.as_str()), "the legacy kind is kept");
        assert_eq!(slot.get("suite").and_then(Value::as_str), Some(s.id), "{kind}");
        assert_eq!(slot.get("mode").and_then(Value::as_str), Some(m.id), "{kind}");
        assert_eq!(slot.get("rev"), Some(&Value::Num(1.0)), "{kind}: a slot with no rev is rev 1");
        let reopened = RackSpec::from_json(&saved);
        assert_eq!(reopened, opened, "{kind}");
        assert_eq!(render(&reopened), render(&opened), "{kind}");
    }
}

#[test]
fn a_slot_named_only_by_module_and_mode_opens_as_its_keeper_kind() {
    let by_kind = doc(r#"{"kind":"dattorro_plate","id":"s","params":{"decay":0.7}}"#);
    let by_mode = doc(r#"{"suite":"reverb","mode":"dattorro-plate","id":"s","params":{"decay":0.7}}"#);
    let by_suite_kind = doc(r#"{"kind":"suite:reverb","mode":"dattorro-plate","id":"s","params":{"decay":0.7}}"#);
    assert_eq!(by_mode, by_kind);
    assert_eq!(by_suite_kind, by_kind);
    assert_eq!(render(&by_mode), render(&by_kind));
    let echo = doc(r#"{"suite":"delay","mode":"hp-echo","id":"s"}"#);
    assert!(matches!(echo.slots[0], SlotSpec::Prism { id: "hp-echo", .. }));
}

#[test]
fn a_twin_kind_is_kept_as_written_when_its_mode_agrees() {
    // prism:dattorro-plate and dattorro_plate are one mode; the document's own
    // name is what it gets back
    let d = doc(r#"{"kind":"prism:dattorro-plate","suite":"reverb","mode":"dattorro-plate","id":"s"}"#);
    let saved = d.to_json().to_string();
    assert!(saved.contains(r#""kind":"prism:dattorro-plate""#), "{saved}");
}

#[test]
fn the_mode_wins_when_kind_and_mode_disagree() {
    // a mode switch saved by this build: the mode is what the slot now is
    let d = doc(r#"{"kind":"dattorro_plate","suite":"reverb","mode":"hp-hall","id":"s"}"#);
    assert!(matches!(d.slots[0], SlotSpec::Prism { id: "hp-hall", .. }));
}

#[test]
fn rev_and_memory_travel_with_the_slot() {
    let d = doc(r#"{"kind":"prism:echo","id":"s","rev":2,"memory":{"hp-echo":{"delayMs":250}}}"#);
    let saved = d.to_json();
    let reopened = RackSpec::from_json(&saved);
    assert_eq!(reopened, d);
    let s = saved.to_string();
    assert!(s.contains(r#""rev":2"#), "{s}");
    assert!(s.contains(r#""memory":{"hp-echo":{"delayMs":250}}"#), "{s}");
}

#[test]
fn an_unknown_module_or_mode_is_dropped_not_guessed() {
    assert!(doc(r#"{"suite":"reverb","mode":"no-such","id":"s"}"#).slots.is_empty());
    assert!(doc(r#"{"suite":"no-such","mode":"x","id":"s"}"#).slots.is_empty());
    assert!(doc(r#"{"kind":"suite:reverb","id":"s"}"#).slots.is_empty());
}

#[test]
fn a_slot_keeps_its_face_style_and_a_slot_without_one_opens_in_its_own_look() {
    // SUITE-PLAN §4.1, D6: a Hyperprism, SoundHack or Lexicon mode may be
    // drawn by the MGL face or in its original's look; the choice is the
    // slot's, and a document that never chose opens in the look it had.
    let chose = doc(r#"{"kind":"prism:hp-echo","id":"s","face":"mgl"}"#);
    let saved = chose.to_json();
    let slot = |v: &Value| v.get("slots").and_then(|s| if let Value::Arr(a) = s { a.first().cloned() } else { None }).unwrap();
    assert_eq!(slot(&saved).get("face").and_then(Value::as_str), Some("mgl"));
    assert_eq!(RackSpec::from_json(&saved), chose);
    let back = doc(r#"{"kind":"prism:hp-echo","id":"s","face":"original"}"#);
    assert_eq!(slot(&back.to_json()).get("face").and_then(Value::as_str), Some("original"));
    // never chosen: nothing written, so the look is the mode's own
    let none = doc(r#"{"kind":"prism:hp-echo","id":"s"}"#);
    assert!(slot(&none.to_json()).get("face").is_none());
    // only the two looks there are
    let odd = doc(r#"{"kind":"prism:hp-echo","id":"s","face":"wobbly"}"#);
    assert!(slot(&odd.to_json()).get("face").is_none());
    assert_eq!(odd, none);
    // and the face never touches the sound
    assert_eq!(render(&chose), render(&none));
}

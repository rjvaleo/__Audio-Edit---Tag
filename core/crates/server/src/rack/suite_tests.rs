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

fn rack_of(slots: &str) -> RackSpec {
    RackSpec::from_json(&json::parse(&format!(r#"{{"slots":[{slots}]}}"#)).unwrap())
}

#[test]
fn a_mode_switch_is_seen_as_one_slot_changing_and_nothing_else_is() {
    let had = rack_of(r#"{"kind":"prism:echo","id":"a"},{"kind":"dattorro_plate","id":"b","params":{"decay":0.7}}"#);
    // The plate switched to the Schroeder, remembering where it was.
    let now = rack_of(r#"{"kind":"prism:echo","id":"a"},{"suite":"reverb","mode":"schroeder-reverb","id":"b","memory":{"dattorro-plate":{"decay":0.7}}}"#);
    assert_eq!(now.switched_slot(&had), Some(1));
    // A control moved is not a switch.
    let moved = rack_of(r#"{"kind":"prism:echo","id":"a"},{"kind":"dattorro_plate","id":"b","params":{"decay":0.2}}"#);
    assert_eq!(moved.switched_slot(&had), None);
    // Two slots switched, a slot added, or the order changed: the chain is rebuilt.
    let two = rack_of(r#"{"kind":"prism:tremolo","id":"a"},{"kind":"schroeder_reverb","id":"b"}"#);
    assert_eq!(two.switched_slot(&had), None);
    let added = rack_of(r#"{"kind":"prism:echo","id":"a"},{"kind":"schroeder_reverb","id":"b"},{"kind":"gain","id":"c"}"#);
    assert_eq!(added.switched_slot(&had), None);
    let swapped = rack_of(r#"{"kind":"schroeder_reverb","id":"b"},{"kind":"prism:echo","id":"a"}"#);
    assert_eq!(swapped.switched_slot(&had), None);
    // A switch that also turns the slot off is two changes.
    let off = rack_of(r#"{"kind":"prism:echo","id":"a"},{"kind":"schroeder_reverb","id":"b","bypassed":true}"#);
    assert_eq!(off.switched_slot(&had), None);
}

#[test]
fn one_slot_built_alone_is_the_slot_the_whole_rack_builds() {
    let spec = rack_of(r#"{"kind":"prism:echo","id":"a","params":{"feedback":0.6}},{"kind":"dattorro_plate","id":"b","params":{"decay":0.7}},{"kind":"comp","id":"c"}"#);
    for i in 0..3 {
        let mut whole = spec.build(48_000, 2);
        let mut alone = fx::Rack::new();
        alone.push(spec.build_slot(i, 48_000, 2));
        let mut only = fx::Rack::new();
        only.push(std::mem::replace(&mut whole.slots[i].effect, Box::new(fx::Gain { db: 0.0 })));
        let (mut a, mut b) = (source(4000), source(4000));
        alone.process(&mut a, 2, 48_000);
        only.process(&mut b, 2, 48_000);
        assert_eq!(a.iter().map(|x| x.to_bits()).collect::<Vec<_>>(), b.iter().map(|x| x.to_bits()).collect::<Vec<_>>(), "slot {i}");
    }
}

#[test]
fn a_reverb_slot_carries_place_off_and_other_modules_none() {
    let spec = rack_of(r#"{"kind":"schroeder_reverb","id":"a"},{"kind":"prism:echo","id":"b"}"#);
    let mut rack = spec.build(48_000, 2);
    assert_eq!(rack.get_param(0, "place.on"), Some(0.0), "a reverb has Place, off");
    assert_eq!(rack.get_param(1, "place.on"), None, "an echo has none");
    assert!(rack.set_param(0, "place.on", 1.0));
}

#[test]
fn place_is_kept_with_the_slot_and_built_as_saved() {
    let mut spec = rack_of(r#"{"kind":"schroeder_reverb","id":"a"}"#);
    assert!(spec.set_param(0, "place.on", 1.0));
    assert!(spec.set_param(0, "place.dist", 70.0));
    assert!(spec.set_param(0, "place.shape", 2.0));
    assert_eq!(spec.get_param(0, "place.dist"), Some(70.0));
    let saved = spec.to_json();
    let text = saved.to_string();
    assert!(text.contains(r#""place""#), "{text}");
    let back = RackSpec::from_json(&saved);
    assert_eq!(back, spec);
    let rack = back.build(48_000, 2);
    assert_eq!(rack.get_param(0, "place.on"), Some(1.0));
    assert_eq!(rack.get_param(0, "place.dist"), Some(70.0));
    assert_eq!(rack.get_param(0, "place.shape"), Some(2.0));
    // not on an echo
    let mut echo = rack_of(r#"{"kind":"prism:echo","id":"b"}"#);
    assert!(!echo.set_param(0, "place.on", 1.0));
}

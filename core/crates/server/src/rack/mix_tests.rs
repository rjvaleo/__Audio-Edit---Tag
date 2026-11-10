use super::*;

fn footed() -> RackSpec {
    RackSpec::from_json(&crate::json::parse(
        r#"{"slots":[{"kind":"gain","id":"a","db":0,"wet":0.25,"level":-6},{"kind":"gain","id":"b","db":0}]}"#,
    ).unwrap())
}

#[test]
fn a_modules_wet_dry_and_level_survive_the_round_trip() {
    let spec = footed();
    let j = spec.to_json();
    let Some(Value::Arr(slots)) = j.get("slots") else { panic!() };
    assert_eq!(slots[0].get("wet"), Some(&Value::Num(0.25)));
    assert_eq!(slots[0].get("level"), Some(&Value::Num(-6.0)));
    assert_eq!(RackSpec::from_json(&j), spec);
}

#[test]
fn a_module_at_the_defaults_writes_nothing_new() {
    let j = footed().to_json();
    let Some(Value::Arr(slots)) = j.get("slots") else { panic!() };
    assert!(slots[1].get("wet").is_none() && slots[1].get("level").is_none());
}

#[test]
fn wet_dry_and_level_are_controls_like_any_other() {
    let mut spec = footed();
    assert!(spec.set_param(1, fx::SLOT_WET, 7.0));
    assert_eq!(spec.get_param(1, fx::SLOT_WET), Some(1.0), "clamped");
    assert!(spec.set_param(1, fx::SLOT_LEVEL, -99.0));
    assert_eq!(spec.get_param(1, fx::SLOT_LEVEL), Some(-24.0));
    assert_eq!(spec.get_param(0, fx::SLOT_WET), Some(0.25));
    assert!(!spec.set_param(9, fx::SLOT_WET, 0.5));
}

#[test]
fn the_built_rack_has_them_and_a_trim_counts_as_doing_something() {
    let spec = footed();
    let rack = spec.build(48_000, 2);
    assert_eq!(rack.get_param(0, fx::SLOT_WET), Some(0.25));
    assert_eq!(rack.get_param(0, fx::SLOT_LEVEL), Some(-6.0));
    assert_eq!(rack.get_param(1, fx::SLOT_WET), Some(1.0));
    assert!(spec.is_active(), "a level on an otherwise flat module changes the sound");
    let plain = RackSpec::from_json(&crate::json::parse(r#"{"slots":[{"kind":"gain","id":"a","db":0}]}"#).unwrap());
    assert!(!plain.is_active());
}

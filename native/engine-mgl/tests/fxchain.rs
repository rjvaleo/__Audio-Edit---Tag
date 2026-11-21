//! Atmosphere's FX line: every effect the insert menu offers is made here
//! as the page's own atfx.wasm (`core/crates/fx-wasm`) makes it, and a chain
//! is laid as its worklet lays one.

use engine_mgl::fxchain::{build, make, suites, FxSlot};

#[test]
fn every_kind_the_menu_offers_is_made_as_fx_wasm_makes_it() {
    let mut n = 0;
    for s in suites() {
        for f in s.families {
            for m in f.modes {
                let ours = make(&m.kind, 48_000).unwrap_or_else(|| panic!("{} is not made", m.kind));
                let page = fx_wasm::make(&m.kind, 48_000).unwrap();
                assert_eq!(ours.name(), page.name(), "{}", m.kind);
                assert_eq!(ours.parameter_keys(), page.parameter_keys(), "{}", m.kind);
                n += 1;
            }
        }
    }
    assert!(n > 10);
    for k in ["gain", "eq", "comp", "nothing"] {
        assert_eq!(make(k, 48_000).is_some(), fx_wasm::make(k, 48_000).is_some(), "{k}");
    }
}

#[test]
fn a_chain_is_laid_as_the_worklet_lays_it() {
    let slot = |kind: &str, on: bool| FxSlot { kind: kind.into(), on, params: vec![], wet: Some(50.0), level: Some(-3.0) };
    assert!(build(&[], 48_000).is_none(), "an empty line passes straight through");
    assert!(build(&[slot("nothing", true)], 48_000).is_none(), "an unknown kind is left out");
    let b = build(&[slot("comp", true), slot("nothing", true), slot("eq", false)], 48_000).unwrap();
    assert_eq!(b.from, vec![0, 2]);
    assert_eq!(b.rack.slots.len(), 2);
    assert!(b.rack.slots[1].bypassed);
    assert_eq!(b.rack.get_param(0, "slot.wet"), Some(0.5));
    assert_eq!(b.rack.get_param(0, "slot.level"), Some(-3.0));
    assert!(b.keys[0].iter().any(|k| k == "slot.wet"));
}

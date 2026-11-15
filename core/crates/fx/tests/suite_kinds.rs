//! Every kind a rack document can hold opens as a module and mode
//! (SUITE-PLAN §3.3), and every mode has one kind it is saved as.

use fx::shape::ShapeKind;
use fx::suite;
use prism_fx::suite::SUITES;

fn all_kinds() -> Vec<String> {
    let mut v: Vec<String> = ShapeKind::ALL.iter().map(|k| k.as_str().to_string()).collect();
    v.extend(["eq", "comp", "gain", "dattorro_echo"].map(String::from));
    v.extend(fx::prism::catalogue().iter().map(|e| format!("prism:{}", e.descriptor.id)));
    v
}

/// The kernel a kind builds, as the rack builds it today.
fn kernel_of(kind: &str) -> &'static str {
    match kind {
        "eq" => "eq",
        "comp" => "compressor",
        "gain" => "gain",
        k => ShapeKind::from_str(k).map(|s| s.prism_id()).or_else(|| fx::prism::id_for_kind(k)).unwrap(),
    }
}

#[test]
fn every_kind_opens_as_the_mode_of_its_own_kernel() {
    for kind in all_kinds() {
        let (s, m) = suite::mode_of_kind(&kind).unwrap_or_else(|| panic!("{kind} opens as no mode"));
        assert_eq!(m.kernel, kernel_of(&kind), "{kind} → {}/{}", s.id, m.id);
    }
    assert!(suite::mode_of_kind("no_such_kind").is_none());
}

#[test]
fn twins_open_the_same_mode() {
    // SUITE-PLAN §1.3: the bare kind and its prism: twin are one mode
    for k in ShapeKind::ALL {
        let a = suite::mode_of_kind(k.as_str()).unwrap();
        let b = suite::mode_of_kind(&format!("prism:{}", k.prism_id())).unwrap();
        assert_eq!((a.0.id, a.1.id), (b.0.id, b.1.id), "{}", k.as_str());
    }
    assert_eq!(suite::mode_of_kind("eq").unwrap().1.id, suite::mode_of_kind("prism:eq").unwrap().1.id);
    assert_eq!(suite::mode_of_kind("comp").unwrap().1.id, suite::mode_of_kind("prism:compressor").unwrap().1.id);
}

#[test]
fn each_mode_is_saved_as_its_keeper_kind_which_opens_it_again() {
    for s in SUITES {
        for m in s.modes() {
            let kind = suite::keeper_kind(m);
            let (s2, m2) = suite::mode_of_kind(&kind).unwrap();
            assert_eq!((s2.id, m2.id), (s.id, m.id), "{kind}");
        }
    }
    // the keepers are the names documents already use (§1.3)
    let k = |s: &str, m: &str| suite::keeper_kind(prism_fx::suite::find_mode(s, m).unwrap());
    assert_eq!(k("filter", "eq"), "eq");
    assert_eq!(k("dynamics", "compressor"), "comp");
    assert_eq!(k("reverb", "dattorro-plate"), "dattorro_plate");
    assert_eq!(k("delay", "hp-echo"), "prism:hp-echo");
}

#[test]
fn the_kinds_the_app_hid_come_back_as_modes_or_stay_unlisted() {
    // D8: dc, gate and fit back as listed modes; the stages and the stereo
    // tools that other effects contain stay unlisted
    for (kind, listed) in [("dc", true), ("gate", true), ("fit", true), ("invert", false), ("swap", false), ("width", false),
        ("dattorro_notch", false), ("dattorro_resonator", false), ("regalia_mitra", false), ("damping_filter", false)] {
        let (_, m) = suite::mode_of_kind(kind).unwrap_or_else(|| panic!("{kind}"));
        assert_eq!(m.listed, listed, "{kind}");
    }
}

//! v8b: choice keys as mod targets. Each steps by the rule (`choice.rs`), is
//! heard as the option it steps to, changes at a block boundary, and changes
//! without a click.

use std::sync::{Arc, OnceLock};

use wave::choice::{choice_id, option_name, step, CHOICE_KEYS};
use wave::*;

const SR: f32 = 48_000.0;
const BLOCK: usize = 32;

/// A sine, or a sine with a second harmonic: built once for every test here.
fn sine(harmonic2: f32) -> Arc<Wavetable> {
    static TABLES: OnceLock<[Arc<Wavetable>; 2]> = OnceLock::new();
    let t = TABLES.get_or_init(|| [make_sine(0.0), make_sine(0.6)]);
    Arc::clone(&t[usize::from(harmonic2 > 0.0)])
}

fn make_sine(harmonic2: f32) -> Arc<Wavetable> {
    let tau = std::f32::consts::TAU;
    let frame: Vec<f32> = (0..2048).map(|i| (tau * i as f32 / 2048.0).sin() + harmonic2 * (2.0 * tau * i as f32 / 2048.0).sin()).collect();
    Arc::new(Wavetable::from_frames(&[frame]))
}

fn builtin(name: &str) -> Arc<Wavetable> {
    static TABLES: OnceLock<Vec<Arc<Wavetable>>> = OnceLock::new();
    let t = TABLES.get_or_init(|| BUILTIN_NAMES.iter().map(|n| Arc::new(Wavetable::from_frames(&builtin_frames(n).unwrap()))).collect());
    Arc::clone(&t[BUILTIN_NAMES.iter().position(|n| *n == name).unwrap()])
}

/// One low oscillator into Filter 1, nothing else moving, the master chain
/// out: a click would stand far above the wave's own steps.
fn plain() -> Patch {
    let mut p = Patch::default();
    p.mods.clear();
    for n in 0..3 {
        let k = |f: &str| format!("osc{n}.{f}");
        p.set_num(&k("on"), if n == 0 { 1.0 } else { 0.0 });
        for j in 0..2 {
            p.set_str(&k(&format!("warp{j}.mode")), "off");
        }
        p.set_num(&k("warp0.amt"), 0.5);
        p.set_num(&k("warp1.amt"), 0.5);
        p.set_str(&k("fx.mode"), "off");
        p.set_num(&k("fx.a"), 0.45);
        p.set_num(&k("uni.n"), 1.0);
        p.set_num(&k("rand"), 0.0);
        p.set_num(&k("pitch"), 0.5);
        p.set_num(&k("level"), 0.8);
        p.set_str(&k("route"), "F1");
    }
    p.tables = ["Sine".into(), "Two".into(), "Glass Organ".into()];
    p.set_num("sub.on", 0.0);
    p.set_num("noise.on", 0.0);
    p.set_str("filt.route", "serial");
    for f in 0..2 {
        p.set_str(&format!("filt{f}.type"), "lp");
        p.set_num(&format!("filt{f}.res"), 0.0);
        p.set_num(&format!("filt{f}.drive"), 0.0);
        p.set_num(&format!("filt{f}.key"), 0.0);
    }
    p.set_num("filt0.cut", 0.75);
    p.set_num("filt1.cut", 1.0);
    for (k, v) in [("amp.a", 0.0), ("amp.d", 0.0), ("amp.s", 1.0), ("amp.r", 0.1), ("master", 1.0)] {
        p.set_num(k, v);
    }
    for i in 0..5 {
        p.set_num(&format!("fx{i}.on"), 0.0);
    }
    for l in 0..4 {
        p.set_str(&format!("lfo{l}.mode"), "free");
        p.set_str(&format!("lfo{l}.shape"), "sine");
        p.set_num(&format!("lfo{l}.smooth"), 0.0);
        p.set_num(&format!("lfo{l}.rise"), 0.0);
    }
    p
}

fn synth(p: &Patch) -> Synth {
    let mut s = Synth::new(SR, 512);
    s.adopt(PatchState::new(p));
    s.set_table(0, sine(0.0));
    s.set_table(1, sine(0.6));
    s.set_table(2, builtin("Glass Organ"));
    for (i, name) in BUILTIN_NAMES.iter().enumerate() {
        s.set_bank_table(i, builtin(name));
    }
    s
}

fn render(s: &mut Synth, frames: usize) -> Vec<f32> {
    let (mut l, mut r) = (vec![0.0f32; frames], vec![0.0f32; frames]);
    for (a, b) in l.chunks_mut(BLOCK * 3).zip(r.chunks_mut(BLOCK * 3)) {
        s.render(a, b);
    }
    l.iter().zip(&r).map(|(a, b)| a + b).collect()
}

fn max_step(x: &[f32]) -> f32 {
    x.windows(2).map(|w| (w[1] - w[0]).abs()).fold(0.0, f32::max)
}

/// The option count of a choice key, for the patch `p`.
fn options(p: &Patch, key: &str) -> u8 {
    PatchState::new(p).choices.len[choice_id(key).unwrap().index()]
}

#[test]
fn every_choice_key_steps_by_the_rule_under_a_sweep() {
    // Macro 1 → the key, at three amounts, the macro swept across its travel:
    // the option is the base's place moved by the row and stepped. Per voice
    // with a note held, and from the shared sources with none.
    for key in CHOICE_KEYS {
        let c = choice_id(key).unwrap().index();
        for amt in [1.0f32, -1.0, 0.4] {
            for held in [false, true] {
                for m in 0..=20 {
                    let at = m as f32 / 20.0;
                    let mut p = plain();
                    p.set_num("macro0", at);
                    p.mods.push(Mod::new("macro0", key, amt));
                    let st = PatchState::new(&p);
                    let mut s = synth(&p);
                    if held {
                        s.note_on(45, 1.0);
                    }
                    render(&mut s, BLOCK);
                    let mut t = Telemetry::default();
                    s.telemetry(&mut t);
                    let want = step(st.choices.base[c], st.choices.len[c], amt * at);
                    assert_eq!(t.choice[c], want, "{key} amt {amt} macro {at} held {held}");
                    assert_ne!(t.choice_touched & 1 << c, 0);
                }
            }
        }
    }
    assert_eq!(options(&plain(), "osc0.warp0.mode"), 9);
    assert_eq!(options(&plain(), "osc1.fx.mode"), 8);
    assert_eq!(options(&plain(), "filt0.type"), 6);
    assert_eq!(options(&plain(), "filt.route"), 3);
    assert_eq!(options(&plain(), "lfo2.shape"), 8);
    // Five built-ins, then Sine and Two; osc C's Glass Organ is a built-in.
    assert_eq!(options(&plain(), "osc2.table"), 7);
}

#[test]
fn a_stepped_choice_is_heard_as_the_option_it_steps_to() {
    // Each key moved one option on by a row sounds, to the bit, like the
    // patch with that option set and no row.
    let mut lfo_heard = plain();
    lfo_heard.mods.push(Mod::new("lfo1", "osc0.level", 0.3));
    let cases: [(&str, &str, Patch); 7] = [
        ("osc0.warp0.mode", "bend", plain()),
        ("osc0.fx.mode", "chorus", plain()),
        ("filt0.type", "bp", plain()),
        ("filt.route", "parallel", plain()),
        ("lfo1.shape", "tri", lfo_heard.clone()),
        ("osc0.warp1.mode", "bend", plain()),
        ("filt1.type", "bp", plain()),
    ];
    for (key, set, base) in cases {
        let mut moved = base.clone();
        moved.set_num("macro0", 1.0);
        moved.mods.push(Mod::new("macro0", key, 1.0 / (options(&base, key) - 1) as f32));
        let mut direct = base.clone();
        assert!(direct.set_str(key, set));
        let play = |p: &Patch| {
            let mut s = synth(p);
            s.note_on(45, 1.0);
            render(&mut s, 4800)
        };
        let (a, b) = (play(&moved), play(&direct));
        assert_eq!(a, b, "{key} stepped to {set}");
        assert_ne!(a, play(&base), "{key}: the option is heard");
    }
    // The table: osc A's Sine is the bank's sixth; one on is Two.
    let mut moved = plain();
    moved.set_num("macro0", 1.0);
    moved.mods.push(Mod::new("macro0", "osc0.table", 1.0 / 6.0));
    let mut s = synth(&moved);
    s.note_on(45, 1.0);
    let a = render(&mut s, 4800);
    let mut direct = synth(&plain());
    direct.set_table(0, sine(0.6));
    direct.note_on(45, 1.0);
    assert_eq!(a, render(&mut direct, 4800), "osc0.table stepped to Two");
    // Stepped to a built-in the bank holds.
    let mut moved = plain();
    moved.set_num("macro0", 1.0);
    moved.mods.push(Mod::new("macro0", "osc0.table", -1.0));
    let mut s = synth(&moved);
    s.note_on(45, 1.0);
    let a = render(&mut s, 4800);
    let mut direct = synth(&plain());
    direct.set_table(0, builtin("Formant Sweep"));
    direct.note_on(45, 1.0);
    assert_eq!(a, render(&mut direct, 4800), "osc0.table stepped to Formant Sweep");
}

#[test]
fn a_table_the_bank_does_not_hold_yet_leaves_the_oscillator_on_its_own() {
    let mut p = plain();
    p.set_num("macro0", 1.0);
    p.mods.push(Mod::new("macro0", "osc0.table", -1.0));
    let mut s = Synth::new(SR, 512);
    s.adopt(PatchState::new(&p));
    s.set_table(0, sine(0.0));
    s.note_on(45, 1.0);
    let a = render(&mut s, 4800);
    let mut plain_synth = Synth::new(SR, 512);
    plain_synth.adopt(PatchState::new(&plain()));
    plain_synth.set_table(0, sine(0.0));
    plain_synth.note_on(45, 1.0);
    assert_eq!(a, render(&mut plain_synth, 4800));
}

#[test]
fn a_choice_changes_at_a_block_boundary() {
    // A square LFO flips between +1 and −1 at a block boundary; a voice's
    // warp mode follows in that same block, and the shared routing a block
    // later (the shared sources are the LFOs as the last block left them).
    let mut p = plain();
    p.set_str("lfo0.shape", "square");
    p.set_num("lfo0.rate", 0.75);
    p.mods.push(Mod::new("lfo0", "osc0.warp0.mode", 0.125));
    p.mods.push(Mod::new("lfo0", "filt.route", 0.5));
    let (warp, route) = (choice_id("osc0.warp0.mode").unwrap().index(), choice_id("filt.route").unwrap().index());
    let mut s = synth(&p);
    s.note_on(45, 1.0);
    let mut t = Telemetry::default();
    let mut last_lfo = None;
    let mut flips = 0;
    for _ in 0..2000 {
        render(&mut s, BLOCK);
        s.telemetry(&mut t);
        let up = t.lfo[0] > 0.0;
        assert_eq!(t.choice[warp], if up { 1 } else { 0 }, "the warp mode follows the voice's LFO in its block");
        if let Some(was) = last_lfo {
            assert_eq!(t.choice[route], if was { 1 } else { 0 }, "the routing follows the shared LFO a block late");
            flips += usize::from(was != up);
        }
        last_lfo = Some(up);
    }
    assert!(flips >= 8, "the LFO flipped {flips} times");
}

#[test]
fn switching_a_choice_back_and_forth_does_not_click() {
    // A square LFO toggles each key between two options a dozen times in two
    // seconds. The worst step between samples must stay within what the two
    // options do held still, plus a block's share of the gap between them:
    // what a crossfade across one block can add, where a hard cut would add
    // the whole gap.
    let mut lfo_heard = plain();
    lfo_heard.mods.push(Mod::new("lfo1", "osc0.level", 0.3));
    lfo_heard.set_num("lfo1.rate", 0.5);
    let cases: [(&str, &str, &str, Patch); 9] = [
        ("osc0.warp0.mode", "off", "bend", plain()),
        ("osc0.fx.mode", "off", "chorus", plain()),
        ("osc0.fx.mode", "off", "ring", plain()),
        ("osc0.fx.mode", "off", "delay", plain()),
        ("osc0.fx.mode", "chorus", "phaser", plain()),
        ("filt0.type", "lp", "bp", plain()),
        ("filt.route", "serial", "parallel", plain()),
        ("lfo1.shape", "sine", "up", lfo_heard),
        ("osc0.table", "", "", plain()),
    ];
    for (key, a, b, base) in cases {
        let mut sweep = base.clone();
        sweep.set_str("lfo0.shape", "square");
        sweep.set_num("lfo0.rate", 0.67);
        let table = key == "osc0.table";
        if table {
            // Sine (the bank's sixth) and Two (its seventh); a step down
            // finds no Grit Saw in this bank and stays on Sine.
            sweep.mods.push(Mod::new("lfo0", key, 1.0 / 6.0));
        } else {
            sweep.set_str(key, a);
            let id = choice_id(key).unwrap();
            let at = |name: &str| (0..9).position(|i| option_name(id, i) == Some(name)).unwrap() as f32;
            sweep.mods.push(Mod::new("lfo0", key, (at(b) - at(a)) / (options(&base, key) - 1) as f32));
        }
        let play = |p: &Patch, two: bool, keep_bank: bool| {
            let mut s = synth(p);
            if !keep_bank {
                s = Synth::new(SR, 512);
                s.adopt(PatchState::new(p));
                s.set_table(0, if two { sine(0.6) } else { sine(0.0) });
                s.set_table(1, sine(0.6));
            }
            s.note_on(45, 1.0);
            render(&mut s, 4800);
            render(&mut s, 96_000)
        };
        let still = |opt: &str, two: bool| {
            let mut p = base.clone();
            if !table {
                p.set_str(key, opt);
            }
            play(&p, two, !table)
        };
        let (held_a, held_b) = (still(a, false), still(b, true));
        let steady = max_step(&held_a).max(max_step(&held_b));
        // A crossfade across one block can add at most a block's share of
        // the gap between the two options; the routing dips to nothing and
        // back, so its gap is the sound's peak.
        let gap = if key == "filt.route" {
            held_a.iter().chain(&held_b).fold(0.0f32, |m, v| m.max(v.abs()))
        } else {
            held_a.iter().zip(&held_b).fold(0.0f32, |m, (x, y)| m.max((x - y).abs()))
        };
        let bound = steady + 1.5 * gap / BLOCK as f32 + 1e-4;
        let moving = play(&sweep, false, !table);
        let worst = max_step(&moving);
        assert!(moving != held_a && moving != held_b, "{key}: the sweep switches");
        assert!(worst <= bound, "{key} {a} ↔ {b}: step {worst} against {steady} held, bound {bound}");
        eprintln!("{key} {a} ↔ {b}: worst step {worst:.4}, held {steady:.4}, bound {bound:.4}");
    }
}

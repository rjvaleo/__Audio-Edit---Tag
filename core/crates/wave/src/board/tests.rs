use super::*;
use crate::master_fx::MasterFx;
use crate::patch::{Patch, SRC_COUNT, SRC_MACRO};

const SR: f32 = 48_000.0;

/// A stereo test signal: a 220 Hz tone on the left, a 330 Hz one on the
/// right, and a burst of noise every quarter second.
fn signal(frames: usize) -> (Vec<f32>, Vec<f32>) {
    let mut rng = 0x1234_5678u32;
    let mut noise = || {
        rng ^= rng << 13;
        rng ^= rng >> 17;
        rng ^= rng << 5;
        (rng as i32) as f32 / 2_147_483_648.0
    };
    (0..frames)
        .map(|i| {
            let t = i as f32 / SR;
            let burst = if i % 12_000 < 600 { 0.4 * noise() } else { 0.0 };
            (0.3 * (std::f32::consts::TAU * 220.0 * t).sin() + burst, 0.3 * (std::f32::consts::TAU * 330.0 * t).sin() - burst)
        })
        .unzip()
}

fn run(plan: &mut BoardPlan, l: &[f32], r: &[f32]) -> (Vec<f32>, Vec<f32>) {
    let (mut l, mut r) = (l.to_vec(), r.to_vec());
    for (cl, cr) in l.chunks_mut(256).zip(r.chunks_mut(256)) {
        plan.process(cl, cr);
    }
    (l, r)
}

fn plan(board: &Board) -> BoardPlan {
    BoardPlan::compile(board, SR).unwrap_or_else(|e| panic!("{e}"))
}

fn max_diff(a: &[f32], b: &[f32]) -> f32 {
    a.iter().zip(b).fold(0.0f32, |m, (x, y)| m.max((x - y).abs()))
}

/// Voice → the given nodes in a row → Out.
fn chain(nodes: Vec<Node>) -> Board {
    let mut ids = vec!["v".to_string()];
    ids.extend(nodes.iter().map(|n| n.id.clone()));
    ids.push("out".into());
    let mut all = vec![Node::new("v", "in:voice", 0.0, 0.0)];
    all.extend(nodes);
    all.push(Node::new("out", "out", 0.0, 0.0));
    let cables = ids.windows(2).map(|w| Cable::new(&w[0], "o", &w[1], "i")).collect();
    Board { name: "test".into(), nodes: all, cables }
}

#[test]
fn stages_run_inputs_first_whatever_order_the_nodes_are_listed_in() {
    let b = Board {
        name: "backwards".into(),
        nodes: vec![
            Node::new("out", "out", 0.0, 0.0),
            Node::new("g2", "gain", 0.0, 0.0).with("db", -6.0),
            Node::new("g1", "gain", 0.0, 0.0).with("db", -6.0),
            Node::new("v", "in:voice", 0.0, 0.0),
        ],
        cables: vec![Cable::new("g2", "o", "out", "i"), Cable::new("g1", "o", "g2", "i"), Cable::new("v", "o", "g1", "i")],
    };
    let order: Vec<usize> = b.check().unwrap().order.iter().map(|o| o.0).collect();
    let at = |n: usize| order.iter().position(|o| *o == n).unwrap();
    assert!(at(3) < at(2) && at(2) < at(1) && at(1) < at(0), "{order:?}");
    let (l, r) = signal(4800);
    let (ol, _) = run(&mut plan(&b), &l, &r);
    let g = 10f32.powf(-12.0 / 20.0);
    assert!(l.iter().zip(&ol).all(|(x, y)| (x * g - y).abs() < 1e-6), "two −6 dB gains in order");
}

#[test]
fn cables_into_one_in_are_summed_and_one_out_feeds_many() {
    // The voice feeds two gains (fan-out), and both go into the out (fan-in).
    let b = Board {
        name: "sum".into(),
        nodes: vec![
            Node::new("v", "in:voice", 0.0, 0.0),
            Node::new("a", "gain", 0.0, 0.0),
            Node::new("b", "gain", 0.0, 0.0).with("db", -6.0),
            Node::new("out", "out", 0.0, 0.0),
        ],
        cables: vec![
            Cable::new("v", "o", "a", "i"),
            Cable::new("v", "o", "b", "i"),
            Cable::new("a", "o", "out", "i"),
            Cable::new("b", "o", "out", "i"),
        ],
    };
    let (l, r) = signal(4800);
    let (ol, or) = run(&mut plan(&b), &l, &r);
    let g = 1.0 + 10f32.powf(-6.0 / 20.0);
    assert!(l.iter().zip(&ol).chain(r.iter().zip(&or)).all(|(x, y)| (x * g - y).abs() < 1e-6));
}

#[test]
fn a_loop_is_refused_naming_the_cable_that_closes_it() {
    let mut b = chain(vec![Node::new("a", "gain", 0.0, 0.0), Node::new("b", "fx:echo", 0.0, 0.0)]);
    let ok = b.cables.len();
    b.cables.push(Cable::new("b", "o", "a", "i"));
    let e = BoardPlan::compile(&b, SR).err().expect("a loop compiles");
    assert_eq!(e.cable, Some(ok), "{e}");
    assert!(e.message.contains("loop"), "{e}");

    // A node into itself.
    let mut b = chain(vec![Node::new("a", "gain", 0.0, 0.0)]);
    b.cables.push(Cable::new("a", "o", "a", "i"));
    assert_eq!(b.check().err().unwrap().cable, Some(2));

    // A dry/wet's send back into its own return is a branch, not a loop; its
    // out back into its return is a loop.
    let mut b = chain(vec![Node::new("dw", "drywet", 0.0, 0.0)]);
    b.nodes.push(Node::new("e", "fx:echo", 0.0, 0.0));
    b.cables.push(Cable::new("dw", "send", "e", "i"));
    b.cables.push(Cable::new("e", "o", "dw", "ret"));
    assert!(b.check().is_ok());
    b.cables.push(Cable::new("dw", "o", "dw", "ret"));
    assert_eq!(b.check().err().unwrap().cable, Some(4));
}

#[test]
fn bad_kinds_ports_and_controls_are_refused() {
    let bad = |b: Board, want: &str| {
        let e = b.check().err().unwrap_or_else(|| panic!("accepted: {want}"));
        assert!(e.message.contains(want), "{} does not say {want:?}", e.message);
    };
    bad(chain(vec![Node::new("a", "fx:nothing", 0.0, 0.0)]), "unknown kind");
    bad(chain(vec![Node::new("a", "fx:tremolo", 0.0, 0.0)]), "unknown kind");
    bad(chain(vec![Node::new("a", "gain", 0.0, 0.0).with("dbx", 1.0)]), "no control");
    let mut b = chain(vec![Node::new("a", "split", 0.0, 0.0)]);
    b.cables.push(Cable::new("a", "o2", "out", "i"));
    bad(b, "no output");
    let mut b = chain(vec![Node::new("a", "mix", 0.0, 0.0)]);
    b.cables.push(Cable::new("v", "o", "a", "i3"));
    bad(b, "no input");
    let mut b = chain(vec![]);
    b.nodes.push(Node::new("out", "gain", 0.0, 0.0));
    bad(b, "two nodes");
    let mut b = chain(vec![]);
    b.nodes.push(Node::new("o2", "out", 0.0, 0.0));
    bad(b, "one out");
    let mut b = chain(vec![]);
    b.cables.push(b.cables[0].clone());
    bad(b, "repeats");
}

#[test]
fn a_node_switched_off_fades_out_then_is_its_input_to_the_bit_and_comes_back_clean() {
    let b = chain(vec![Node::new("e", "fx:echo", 0.0, 0.0).with("delayMs", 30.0).with("feedback", 0.8).with("wet", 1.0)]);
    let mut p = plan(&b);
    let (l, r) = signal(48_000);
    let (wet, _) = run(&mut p, &l[..24_000], &r[..24_000]);
    assert!(max_diff(&wet, &l[..24_000]) > 0.05, "the echo is heard");
    assert!(p.set_on(1, false));
    // 10 ms of fade, then the dry signal exactly.
    run(&mut p, &l[24_000..24_480], &r[24_000..24_480]);
    let (ol, or) = run(&mut p, &l[24_480..], &r[24_480..]);
    assert!(ol.iter().zip(&l[24_480..]).chain(or.iter().zip(&r[24_480..])).all(|(a, b)| a.to_bits() == b.to_bits()));
    // Back in, the echo starts from nothing: silence in is silence out.
    p.set_on(1, true);
    let quiet = vec![0.0f32; 4800];
    let (ql, qr) = run(&mut p, &quiet, &quiet);
    assert!(ql.iter().chain(&qr).all(|v| *v == 0.0), "the old tail came back");
}

#[test]
fn routing_nodes_follow_their_laws() {
    let (l, r) = signal(9600);
    let near = |a: &[f32], b: &[f32], what: &str| assert!(max_diff(a, b) < 1e-5, "{what}: {}", max_diff(a, b));
    let scaled = |x: &[f32], g: f32| x.iter().map(|v| v * g).collect::<Vec<f32>>();

    // Split: every out is the input.
    let mut b = chain(vec![]);
    b.nodes.push(Node::new("s", "split", 0.0, 0.0).with("outs", 3.0));
    b.cables = vec![Cable::new("v", "o", "s", "i"), Cable::new("s", "o0", "out", "i"), Cable::new("s", "o1", "out", "i"), Cable::new("s", "o2", "out", "i")];
    let (ol, or) = run(&mut plan(&b), &l, &r);
    near(&ol, &scaled(&l, 3.0), "split left");
    near(&or, &scaled(&r, 3.0), "split right");

    // Mix: each in at its level; −60 dB is silence.
    let mut b = chain(vec![]);
    b.nodes.push(Node::new("m", "mix", 0.0, 0.0).with("ins", 3.0).with("l0", -6.0).with("l1", 0.0).with("l2", -60.0));
    b.cables = vec![Cable::new("v", "o", "m", "i0"), Cable::new("v", "o", "m", "i1"), Cable::new("v", "o", "m", "i2"), Cable::new("m", "o", "out", "i")];
    let (ol, _) = run(&mut plan(&b), &l, &r);
    near(&ol, &scaled(&l, 1.0 + 10f32.powf(-6.0 / 20.0)), "mix");

    // Gain.
    let (ol, _) = run(&mut plan(&chain(vec![Node::new("g", "gain", 0.0, 0.0).with("db", 12.0)])), &l, &r);
    near(&ol, &scaled(&l, 10f32.powf(0.6)), "gain");

    // Pan: centre is unity; hard right leaves only the right; half right
    // keeps the right and takes the left down by cos(π/4).
    for (pan, gl, gr) in [(0.0, 1.0, 1.0), (100.0, 0.0, 1.0), (-100.0, 1.0, 0.0), (50.0, std::f32::consts::FRAC_1_SQRT_2, 1.0)] {
        let (ol, or) = run(&mut plan(&chain(vec![Node::new("p", "pan", 0.0, 0.0).with("pan", pan)])), &l, &r);
        near(&ol, &scaled(&l, gl), &format!("pan {pan} left"));
        near(&or, &scaled(&r, gr), &format!("pan {pan} right"));
    }

    // Dry/wet: send carries the input into the branch (a −6 dB gain), and the
    // out is (1 − w)·dry + w·return.
    let mut b = chain(vec![Node::new("dw", "drywet", 0.0, 0.0).with("wet", 25.0)]);
    b.nodes.push(Node::new("g", "gain", 0.0, 0.0).with("db", -6.0));
    b.cables.push(Cable::new("dw", "send", "g", "i"));
    b.cables.push(Cable::new("g", "o", "dw", "ret"));
    let (ol, _) = run(&mut plan(&b), &l, &r);
    near(&ol, &scaled(&l, 0.75 + 0.25 * 10f32.powf(-6.0 / 20.0)), "dry/wet");

    // An input's level is squared; switched off, it is silent.
    let mut b = chain(vec![]);
    b.nodes[0] = Node::new("v", "in:voice", 0.0, 0.0).with("level", 0.5);
    let (ol, _) = run(&mut plan(&b), &l, &r);
    near(&ol, &scaled(&l, 0.25), "input level");
    b.nodes[0].on = false;
    let (ol, _) = run(&mut plan(&b), &l, &r);
    assert!(ol.iter().all(|v| *v == 0.0), "an input switched off is silent");

    // No out: silence.
    let mut b = chain(vec![]);
    b.nodes.pop();
    b.cables.pop();
    let (ol, _) = run(&mut plan(&b), &l, &r);
    assert!(ol.iter().all(|v| *v == 0.0));
}

#[test]
fn a_gain_jump_is_a_ramp_not_a_step() {
    let mut p = plan(&chain(vec![Node::new("g", "gain", 0.0, 0.0)]));
    let ones = vec![1.0f32; 64];
    run(&mut p, &ones, &ones);
    assert!(p.set_param(1, 0, -24.0));
    let (ol, _) = run(&mut p, &ones, &ones);
    let g = 10f32.powf(-24.0 / 20.0);
    assert!(ol[0] < 1.0 && ol[0] > 0.9, "the first sample is one step down a ramp: {}", ol[0]);
    assert!((ol[31] - g).abs() < 1e-6, "the block ends on the new gain: {}", ol[31]);
    assert!((ol[63] - g).abs() < 1e-6);
}

#[test]
fn every_one_of_the_82_effects_builds_and_renders_finite_audio() {
    let (l, r) = signal(24_000);
    let mut n = 0;
    for e in fx_entries() {
        n += 1;
        let id = e.descriptor.id;
        let kind = format!("fx:{id}");
        assert!(Kind::parse(&kind).is_some(), "{kind}");
        let b = chain(vec![Node::new("x", &kind, 0.0, 0.0)]);
        let mut p = BoardPlan::compile(&b, SR).unwrap_or_else(|e| panic!("{id}: {e}"));
        let (ol, or) = run(&mut p, &l, &r);
        assert!(ol.iter().chain(&or).all(|v| v.is_finite()), "{id} is not finite");
        assert!(ol.iter().chain(&or).all(|v| v.abs() < 100.0), "{id} blows up");
    }
    assert_eq!(n, 82, "FX-LIST.md has 82 effects");
    for id in RETIRED {
        assert!(prism_fx::find(id).is_some(), "{id} is still in prism-fx for the rack");
    }
}

/// The patch values the parity tests use: the default chain, and one with
/// every unit in at a setting that is plainly heard.
fn chains() -> Vec<(&'static str, Patch)> {
    let mut loud = Patch::default();
    let k = [[0.6, 0.6, 1.0], [0.5, 0.8, 0.5], [0.1, 0.4, 0.6], [0.5, 0.4, 0.5], [0.9, 0.5, 0.2]];
    for (u, ks) in k.iter().enumerate() {
        loud.set_num(&format!("fx{u}.on"), 1.0);
        for (j, v) in ks.iter().enumerate() {
            loud.set_num(&format!("fx{u}.k{j}"), *v);
        }
    }
    let mut some = Patch::default();
    some.set_num("fx0.on", 1.0);
    some.set_num("fx2.on", 0.0);
    some.set_num("fx4.k2", 0.8);
    vec![("default", Patch::default()), ("every unit in", loud), ("drive in, delay out", some)]
}

#[test]
fn a_migrated_board_sounds_as_the_old_chain_did() {
    let (l, r) = signal(96_000);
    for (name, patch) in chains() {
        let v = patch.values;
        let mut old = MasterFx::new(SR, &v);
        // The old chain glides its kernels in from their defaults, which
        // leaves the chorus's sweep a hair behind; the board opens settled.
        // A reset lands the old chain's glides too, so the two start alike.
        old.reset();
        let mut new = plan(&Board::migrate(&v));
        let quiet = vec![0.0f32; 96_000];
        let (mut ql, mut qr) = (quiet.clone(), quiet.clone());
        old.process(&v, &mut ql, &mut qr);
        run(&mut new, &quiet, &quiet);
        let (mut ol, mut or) = (l.clone(), r.clone());
        for (cl, cr) in ol.chunks_mut(256).zip(or.chunks_mut(256)) {
            old.process(&v, cl, cr);
        }
        let (nl, nr) = run(&mut new, &l, &r);
        let d = max_diff(&ol, &nl).max(max_diff(&or, &nr));
        let peak = ol.iter().fold(0.0f32, |m, x| m.max(x.abs()));
        assert!(peak > 0.1, "{name}: the chain is silent");
        assert!(d < 1e-4, "{name}: the board is {d} from the old chain");
        assert!(max_diff(&ol, &l) > 1e-3, "{name}: the chain does something");
    }
}

#[test]
fn board_controls_move_in_their_own_normalised_range_and_return_when_unmapped() {
    let b = chain(vec![Node::new("g", "gain", 0.0, 0.0), Node::new("e", "fx:echo", 0.0, 0.0).with("delayMs", 100.0)]);
    let mut p = plan(&b);
    let mut src = [0.0f32; SRC_COUNT];
    src[SRC_MACRO] = 1.0;
    src[SRC_MACRO + 1] = 0.5;
    let macro0 = Source::parse("macro0").unwrap();
    let macro1 = Source::parse("macro1").unwrap();
    let row = |node, param, amt, src| BoardModRow { src, node, param, amt, curve: Curve::Lin, via: None };
    // Gain −24..24: 0 dB is half way; +0.25 from each of two rows is the top.
    let delay = Kind::parse("fx:echo").unwrap().params().iter().position(|p| p.key == "delayMs").unwrap() as u8;
    let rows = [row(1, 0, 0.25, macro0), row(1, 0, 0.5, macro1), row(2, delay, 0.5, macro1)];
    p.modulate(&rows, &src);
    assert_eq!(p.param(1, 0), Some(24.0));
    // delayMs is log, 1..4000 ms: 100 ms is at ln(100)/ln(4000), and a
    // quarter of the travel on is 4000^0.25 times as long.
    let spec = &Kind::parse("fx:echo").unwrap().params()[delay as usize];
    let want = spec.from_unit(spec.to_unit(100.0) + 0.25);
    assert!((p.param(2, delay as usize).unwrap() - want).abs() < 1e-3);
    assert!((want / 100.0 - 4000f32.powf(0.25)).abs() < 0.05, "{want}");
    // A live move sets where the rows start from.
    assert!(p.set_param(1, 0, -24.0));
    p.modulate(&rows, &src);
    assert_eq!(p.param(1, 0), Some(0.0));
    // With no rows, each returns to its own value.
    p.modulate(&[], &src);
    assert_eq!(p.param(1, 0), Some(-24.0));
    assert_eq!(p.param(2, delay as usize), Some(100.0));
}

#[test]
fn board_rows_compile_against_the_patchs_board() {
    let mut patch = Patch::default();
    patch.board = Some(chain(vec![Node::new("g", "gain", 0.0, 0.0), Node::new("s", "split", 0.0, 0.0)]));
    patch.mods = vec![
        Mod::new("macro0", "board:g:db", 0.5),
        Mod::new("lfo0", "osc0.pos", 0.5),
        Mod::new("macro0", "board:nobody:db", 0.5),
        Mod::new("macro0", "board:g:nothing", 0.5),
        Mod::new("macro0", "board:s:outs", 0.5),
    ];
    let state = crate::PatchState::new(&patch);
    assert_eq!(state.mod_count, 1, "the voice matrix keeps its own rows");
    assert_eq!(state.board_mods().len(), 1, "a missing node or control, and a port count, are skipped");
    assert_eq!((state.board_mods()[0].node, state.board_mods()[0].param), (1, 0));
    assert_eq!(state.board_sig, patch.board.as_ref().unwrap().sig());
    assert_eq!(parse_dst("board:eq:band.1.gainDb"), Some(("eq", "band.1.gainDb")));
    assert_eq!(parse_dst("board::x"), None);
}

#[test]
fn completing_a_board_lists_every_control_and_keeps_the_structure() {
    let mut b = chain(vec![]);
    b.nodes.push(Node::new("m", "mix", 0.0, 0.0).with("ins", 9.0));
    let c = b.complete().unwrap();
    let m = &c.nodes[2];
    assert_eq!(m.params.len(), 5);
    assert_eq!(m.param("ins"), Some(4.0), "clamped");
    assert!(b.same_structure(&c), "nine ins is four, as stored");
    let mut moved = c.clone();
    moved.nodes[2].params[1].1 = -12.0;
    moved.nodes[2].x = 300.0;
    moved.nodes[2].on = false;
    assert!(c.same_structure(&moved), "a control, a place and a switch are not structure");
    assert_eq!(c.sig(), moved.sig());
    let mut renamed = c.clone();
    renamed.nodes[2].kind = "gain".into();
    assert!(!c.same_structure(&renamed));
    assert_ne!(c.sig(), renamed.sig());
}

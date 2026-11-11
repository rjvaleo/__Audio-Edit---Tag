//! The synth with a board on its master bus: old patches sound as they did,
//! the sends carry each source before the filters, board controls take mod
//! rows, and a board is swapped in without a click.

use std::sync::Arc;

use wave::*;

const SR: f32 = 48_000.0;

fn table(name: &str) -> Arc<Wavetable> {
    Arc::new(Wavetable::from_frames(&builtin_frames(name).unwrap()))
}

fn synth(p: &Patch) -> Synth {
    let mut s = Synth::new(SR, 512);
    s.adopt(PatchState::new(p));
    for (i, t) in ["Formant Sweep", "Vowel Ah–Oo", "Glass Organ"].iter().enumerate() {
        s.set_table(i, table(t));
    }
    s
}

fn plan(b: &Board) -> Box<BoardPlan> {
    Box::new(BoardPlan::compile(b, SR).unwrap_or_else(|e| panic!("{e}")))
}

fn render(s: &mut Synth, frames: usize) -> (Vec<f32>, Vec<f32>) {
    let mut l = vec![0.0; frames];
    let mut r = vec![0.0; frames];
    for (cl, cr) in l.chunks_mut(256).zip(r.chunks_mut(256)) {
        s.render(cl, cr);
    }
    (l, r)
}

fn rms(x: &[f32]) -> f64 {
    (x.iter().map(|v| (*v as f64).powi(2)).sum::<f64>() / x.len() as f64).sqrt()
}

fn max_diff(a: &[f32], b: &[f32]) -> f32 {
    a.iter().zip(b).fold(0.0f32, |m, (x, y)| m.max((x - y).abs()))
}

fn max_step(x: &[f32]) -> f32 {
    x.windows(2).fold(0.0f32, |m, w| m.max((w[1] - w[0]).abs()))
}

/// The default patch, and one with every unit of the old chain in.
fn old_patches() -> Vec<(&'static str, Patch)> {
    let mut loud = Patch::default();
    for (u, ks) in [[0.6, 0.6, 1.0], [0.5, 0.8, 0.5], [0.1, 0.4, 0.6], [0.5, 0.4, 0.5], [0.9, 0.5, 0.2]].iter().enumerate() {
        loud.set_num(&format!("fx{u}.on"), 1.0);
        for (j, v) in ks.iter().enumerate() {
            loud.set_num(&format!("fx{u}.k{j}"), *v);
        }
    }
    vec![("default", Patch::default()), ("every unit in", loud)]
}

#[test]
fn an_old_patch_on_its_migrated_board_sounds_as_it_did() {
    for (name, p) in old_patches() {
        let mut old = synth(&p);
        let mut new = synth(&p);
        assert!(new.set_board(plan(&Board::migrate(&p.values))).is_none());
        // A panic clears both and lands the old chain's glides, so the two
        // start from the same place.
        for s in [&mut old, &mut new] {
            render(s, 4800);
            s.panic();
            for n in [45u8, 52, 57, 64] {
                s.note_on(n, 0.8);
            }
        }
        let (ol, or) = render(&mut old, 48_000);
        let (nl, nr) = render(&mut new, 48_000);
        for s in [&mut old, &mut new] {
            for n in [45u8, 52, 57, 64] {
                s.note_off(n);
            }
        }
        let (tl, _) = render(&mut old, 48_000);
        let (ul, _) = render(&mut new, 48_000);
        let d = max_diff(&ol, &nl).max(max_diff(&or, &nr)).max(max_diff(&tl, &ul));
        assert!(rms(&ol) > 0.01, "{name}: silent");
        assert!(d < 1e-5, "{name}: the board is {d} from the old chain");
    }
}

/// Voice and the given input both cabled, each through a gain, to the out.
fn board_from(input: &str) -> Board {
    let mut nodes = wave::board::input_nodes();
    nodes.push(Node::new("out", "out", 600.0, 16.0));
    Board { name: "t".into(), nodes, cables: vec![Cable::new(input, "o", "out", "i")] }
}

#[test]
fn a_send_carries_its_source_before_the_filters() {
    // Osc A alone, into a filter shut all the way: the voice is nearly
    // silent, and the send is the oscillator itself.
    let mut p = Patch::default();
    p.set_num("osc1.on", 0.0);
    p.set_num("osc2.on", 0.0);
    p.set_num("sub.on", 0.0);
    p.set_str("osc0.route", "F1");
    p.set_str("filt.route", "serial");
    p.set_str("filt0.type", "lp");
    p.set_num("filt0.cut", 0.0);
    p.set_num("filt0.res", 0.0);
    p.set_num("filt0.key", 0.0);
    let level = |p: &Patch, input: &str| {
        let mut s = synth(p);
        s.set_board(plan(&board_from(input)));
        s.note_on(69, 1.0);
        render(&mut s, 4800);
        rms(&render(&mut s, 24_000).0)
    };
    let voice = level(&p, "invoice");
    let send = level(&p, "inA");
    let other = level(&p, "inB");
    assert!(send > 0.05, "the send carries osc A: {send}");
    assert!(voice < send * 0.05, "the filtered voice is far quieter: {voice} against {send}");
    assert_eq!(other, 0.0, "osc B is off, so its send is silent");

    // The sub's send, and master scaling it.
    p.set_num("sub.on", 1.0);
    let sub = level(&p, "insub");
    p.set_num("master", 0.4);
    let quieter = level(&p, "insub");
    assert!(sub > 0.01, "{sub}");
    // 0.4² against the default 0.8².
    assert!((quieter / sub - 0.25).abs() < 0.01, "master² scales the send: {}", quieter / sub);
}

#[test]
fn a_board_control_takes_a_mod_row() {
    // Voice → Gain (−24 dB) → Out, Macro 1 → board:g:db +0.5: with the macro
    // up the gain is 0 dB, 24 dB louder.
    let mut b = board_from("invoice");
    b.nodes.push(Node::new("g", "gain", 300.0, 16.0).with("db", -24.0));
    b.cables = vec![Cable::new("invoice", "o", "g", "i"), Cable::new("g", "o", "out", "i")];
    let run = |macro_at: f32| {
        let mut p = Patch::default();
        p.set_num("macro0", macro_at);
        p.board = Some(b.clone());
        p.mods = vec![Mod::new("macro0", "board:g:db", 0.5)];
        let mut s = synth(&p);
        s.set_board(plan(&b));
        s.note_on(57, 1.0);
        render(&mut s, 9600);
        rms(&render(&mut s, 24_000).0)
    };
    let down = run(0.0);
    let up = run(1.0);
    let db = 20.0 * (up / down).log10();
    assert!((db - 24.0).abs() < 0.2, "the macro moved the gain {db:.2} dB");

    // A row compiled against another board is ignored.
    let mut p = Patch::default();
    p.set_num("macro0", 1.0);
    p.board = Some(Board::migrate(&p.values));
    p.mods = vec![Mod::new("macro0", "board:g:db", 0.5)];
    let mut s = synth(&p);
    s.set_board(plan(&b));
    s.note_on(57, 1.0);
    render(&mut s, 9600);
    let other = rms(&render(&mut s, 24_000).0);
    assert!((other / down - 1.0).abs() < 0.01, "a row for another board moved this one");
}

#[test]
fn a_board_swapped_in_while_playing_crossfades_and_the_old_one_comes_back() {
    let p = Patch::default();
    let mut s = synth(&p);
    assert!(s.set_board(plan(&Board::migrate(&p.values))).is_none());
    s.note_on(45, 1.0);
    s.note_on(57, 1.0);
    let (before, _) = render(&mut s, 24_000);
    // A plainly different board: a gain 12 dB down.
    let mut b = board_from("invoice");
    b.nodes.push(Node::new("g", "gain", 300.0, 16.0).with("db", -12.0));
    b.cables = vec![Cable::new("invoice", "o", "g", "i"), Cable::new("g", "o", "out", "i")];
    assert!(s.set_board(plan(&b)).is_none(), "nothing was fading");
    assert!(s.take_retired().is_none(), "the old one is still fading out");
    let (during, _) = render(&mut s, 2400);
    assert!(s.take_retired().is_some(), "faded, the old board comes back to be dropped");
    let (after, _) = render(&mut s, 24_000);
    let steady = max_step(&before).max(max_step(&after));
    assert!(max_step(&during) <= steady * 1.5 + 1e-3, "the swap clicks: {} against {steady}", max_step(&during));
    assert!(rms(&after) < rms(&before) * 0.5);

    // Swapped twice in a row: the one cut short comes straight back.
    s.set_board(plan(&Board::migrate(&p.values)));
    assert!(s.set_board(plan(&b)).is_some());

    // Built for another rate, it is refused.
    let wrong = Box::new(BoardPlan::compile(&b, 44_100.0).unwrap());
    assert!(s.set_board(wrong).is_some());
}

#[test]
fn board_writes_and_telemetry() {
    let mut b = board_from("invoice");
    b.nodes.push(Node::new("g", "gain", 300.0, 16.0));
    b.cables = vec![Cable::new("invoice", "o", "g", "i"), Cable::new("g", "o", "out", "i")];
    let mut s = synth(&Patch::default());
    s.set_board(plan(&b));
    s.note_on(57, 1.0);
    render(&mut s, 24_000);
    let (loud, _) = render(&mut s, 24_000);
    let g = b.node("g").unwrap().0;
    assert!(s.set_board_param(g, 0, -60.0), "clamped to the bottom, −24 dB");
    assert!(!s.set_board_param(g, 9, 0.0), "no such control");
    assert!(!s.set_board_param(99, 0, 0.0), "no such node");
    render(&mut s, 4800);
    let (quiet, _) = render(&mut s, 24_000);
    let db = 20.0 * (rms(&quiet) / rms(&loud)).log10();
    assert!((db + 24.0).abs() < 1.0, "{db:.2} dB");
    // Long enough for the meters' 300 ms fall to forget the loud part.
    render(&mut s, 48_000);
    let mut t = Telemetry::default();
    s.telemetry(&mut t);
    assert_eq!(t.board().len(), b.nodes.len());
    let out = b.node("out").unwrap().0;
    assert!(t.board()[0][0] > 0.01, "the voice input meters what it sends");
    assert!(t.board()[out][0] < t.board()[0][0] * 0.1, "the out meters the board's output, 24 dB down");
    assert!(s.set_board_on(g, false));
    render(&mut s, 4800);
    let (bypassed, _) = render(&mut s, 24_000);
    assert!((rms(&bypassed) / rms(&loud) - 1.0).abs() < 0.05, "a gain switched off passes its input");
}

//! The effects rack and Wave's board as modules of their own, after
//! Atmosphere: each the same, sample for sample, as the same rack or board run
//! alone over Atmosphere's sound.

mod common;
use common::*;
use engine_core::*;
use engine_mgl::{Atmos, Board, BoardThing, Rack, RackThing};
use wave::board::{input_nodes, Board as WaveBoard, Cable, Node};
use wave::BoardPlan;

const N: usize = 16_384;
const BLOCK: usize = 256;

fn notes() -> Vec<(u64, NoteEvent)> {
    vec![(100, NoteEvent::on(52, 0.8)), (3_000, NoteEvent::on(59, 0.7)), (9_000, NoteEvent::off(52)), (12_000, NoteEvent::off(59))]
}

fn atmos() -> Atmos {
    Atmos::new(RATE).set("a.model", 2.0).set("rel", 0.2)
}

/// Atmosphere alone, in the engine.
fn dry() -> (Vec<f32>, Vec<f32>) {
    let (mut ctl, mut audio) = engine(RATE, exact());
    ctl.add(1, Box::new(Script::new(notes()))).unwrap();
    ctl.add(2, Box::new(atmos())).unwrap();
    ctl.connect(port(1, 0), port(2, 0)).unwrap();
    ctl.connect_out(port(2, 0)).unwrap();
    ctl.commit().unwrap();
    render(&mut audio, N, BLOCK)
}

/// Atmosphere through module 3.
fn through(module: Box<dyn Module>, give: Option<Thing>, knob: Option<(u64, u32, f32)>) -> (Vec<f32>, Vec<f32>) {
    let (mut ctl, mut audio) = engine(RATE, exact());
    ctl.add(1, Box::new(Script::new(notes()))).unwrap();
    ctl.add(2, Box::new(atmos())).unwrap();
    ctl.add(3, module).unwrap();
    ctl.connect(port(1, 0), port(2, 0)).unwrap();
    ctl.connect(port(2, 0), port(3, 0)).unwrap();
    ctl.connect_out(port(3, 0)).unwrap();
    ctl.commit().unwrap();
    if let Some(thing) = give {
        ctl.give(3, 0, thing).unwrap();
    }
    if let Some((at, index, value)) = knob {
        ctl.send_at(at, 3, EventKind::Param { index, value }).unwrap();
    }
    render(&mut audio, N, BLOCK)
}

fn plate() -> mgl_fx::Rack {
    let mut rack = mgl_fx::Rack::new();
    rack.push(mgl_fx::prism::make("dattorro-plate", RATE as u32, 2, &[]).expect("the plate is in the catalogue"));
    rack.push(mgl_fx::prism::moved("gain", RATE as u32, &[]).expect("gain"));
    rack
}

#[test]
fn the_rack_is_the_rack_run_alone_knobs_and_all() {
    let (mut l, mut r) = dry();
    assert!(peak(&l) > 0.01, "Atmosphere is heard");
    let mut alone = plate();
    alone.reserve_mix(BLOCK * 2);
    let wet = RackThing::knob(&alone, 0, "wet").expect("the plate has a wet");
    let (slot, n) = ((wet >> 8) as usize, (wet & 0xff) as usize);
    let maps = alone.control_maps();
    let (_, index) = maps[slot].index(n).unwrap();
    for at in (0..N).step_by(BLOCK) {
        if at == 4_096 {
            alone.set_param_index(slot, index, 0.25);
        }
        alone.process_planar(&mut l[at..at + BLOCK], &mut r[at..at + BLOCK], RATE as u32);
    }
    let (ol, or) = through(Box::new(Rack::new(RATE)), Some(RackThing::new(Some(plate()), BLOCK)), Some((4_096, wet, 0.25)));
    assert_same("left", &l, &ol);
    assert_same("right", &r, &or);
}

#[test]
fn an_empty_rack_passes_the_sound() {
    let (l, r) = dry();
    let (ol, or) = through(Box::new(Rack::new(RATE)), None, None);
    assert_same("left", &l, &ol);
    assert_same("right", &r, &or);
}

fn quiet_board() -> Box<BoardPlan> {
    let mut nodes = input_nodes();
    nodes.push(Node::new("out", "out", 600.0, 16.0));
    nodes.push(Node::new("g", "gain", 300.0, 16.0).with("db", -12.0));
    let b = WaveBoard { name: "quiet".into(), nodes, cables: vec![Cable::new("invoice", "o", "g", "i"), Cable::new("g", "o", "out", "i")] };
    Box::new(BoardPlan::compile(&b, RATE).unwrap_or_else(|e| panic!("{e}")))
}

#[test]
fn the_board_is_the_board_run_alone() {
    let (mut l, mut r) = dry();
    let mut alone = quiet_board();
    for at in (0..N).step_by(BLOCK) {
        alone.process(&mut l[at..at + BLOCK], &mut r[at..at + BLOCK]);
    }
    let (ol, or) = through(Box::new(Board::new()), Some(Box::new(BoardThing(Some(quiet_board())))), None);
    assert!(peak(&ol) > 0.001 && peak(&ol) < peak(&dry().0), "the board is heard, quieter");
    assert_same("left", &l, &ol);
    assert_same("right", &r, &or);
}

#[test]
fn a_rack_handed_over_while_it_plays_allocates_nothing_and_the_old_comes_back() {
    assert_the_check_is_on();
    let (mut ctl, mut audio) = engine(RATE, exact());
    ctl.add(1, Box::new(Script::new(notes()))).unwrap();
    ctl.add(2, Box::new(atmos())).unwrap();
    ctl.add(3, Box::new(Rack::new(RATE))).unwrap();
    ctl.connect(port(1, 0), port(2, 0)).unwrap();
    ctl.connect(port(2, 0), port(3, 0)).unwrap();
    ctl.connect_out(port(3, 0)).unwrap();
    ctl.commit().unwrap();
    ctl.give(3, 0, RackThing::new(Some(plate()), BLOCK)).unwrap();
    render(&mut audio, 2_048, BLOCK);
    ctl.give(3, 0, RackThing::new(Some(plate()), BLOCK)).unwrap();
    let before = counted();
    let (l, _) = render(&mut audio, 8_192, BLOCK);
    assert_eq!(counted() - before, 0, "allocations or frees inside a render; the last sizes: {:?}", last_sizes());
    assert!(peak(&l) > 0.001);
    assert!(ctl.collect().things >= 2, "both boxes came back, one with the first rack");
}

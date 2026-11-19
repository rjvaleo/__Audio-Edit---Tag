//! Per-module event timing, scalar-port history, and independent work sizes.
mod common;
use common::*;
use engine_core::basics::{Clock, Keys, SoundSource};
use engine_core::*;
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc,
};

struct SplitNote {
    on: bool,
    calls: Arc<AtomicUsize>,
}
impl Module for SplitNote {
    fn inputs(&self) -> Vec<Kind> {
        vec![]
    }
    fn outputs(&self) -> Vec<Kind> {
        vec![Kind::Audio]
    }
    fn handle(&mut self, event: &EventKind) {
        if let EventKind::Note(note) = event {
            self.on = note.kind == NoteKind::On;
        }
    }
    fn process(&mut self, io: &mut Io) {
        self.calls.fetch_add(1, Ordering::Relaxed);
        let (l, r) = io.outs.audio(0);
        l.fill(self.on as u8 as f32);
        r.copy_from_slice(l);
    }
}
struct GridNote {
    on: bool,
    pending: Option<u64>,
    calls: Arc<AtomicUsize>,
}
impl Module for GridNote {
    fn inputs(&self) -> Vec<Kind> {
        vec![]
    }
    fn outputs(&self) -> Vec<Kind> {
        vec![Kind::Audio]
    }
    fn process(&mut self, _: &mut Io) {
        panic!("the grid module owns event dispatch");
    }
    fn process_events(&mut self, io: &mut Io) {
        self.calls.fetch_add(1, Ordering::Relaxed);
        for &(offset, event) in io.events {
            assert!(matches!(event, EventKind::Note(_)));
            self.pending = Some((io.frame + offset as u64).div_ceil(32) * 32);
        }
        let (l, r) = io.outs.audio(0);
        for i in 0..io.n {
            if self
                .pending
                .is_some_and(|frame| frame <= io.frame + i as u64)
            {
                self.on = true;
                self.pending = None;
            }
            l[i] = self.on as u8 as f32;
            r[i] = l[i];
        }
    }
}
#[test]
fn a_300_note_splits_only_its_recipient_and_a_grid_module_owns_its_grid() {
    for grid in [false, true] {
        let (mut ctl, mut audio) = engine(
            RATE,
            Config {
                max_block: 512,
                fade_frames: 0,
                ..Config::default()
            },
        );
        let calls = Arc::new(AtomicUsize::new(0));
        let unrelated = Arc::new(AtomicUsize::new(0));
        let module: Box<dyn Module> = if grid {
            Box::new(GridNote {
                on: false,
                pending: None,
                calls: calls.clone(),
            })
        } else {
            Box::new(SplitNote {
                on: false,
                calls: calls.clone(),
            })
        };
        if grid {
            let calls = calls.clone();
            ctl.add_with_factory(
                1,
                Box::new(move |_, _| {
                    Box::new(GridNote {
                        on: false,
                        pending: None,
                        calls: calls.clone(),
                    })
                }),
            )
            .unwrap();
        } else {
            ctl.add(1, module).unwrap();
        }
        ctl.add(
            2,
            Box::new(SplitNote {
                on: false,
                calls: unrelated.clone(),
            }),
        )
        .unwrap();
        ctl.connect_out(port(1, 0)).unwrap();
        ctl.commit().unwrap();
        ctl.send_at(300, 1, EventKind::Note(NoteEvent::on(60, 1.0)))
            .unwrap();
        let (l, _) = render(&mut audio, 512, 512);
        let start = if grid { 320 } else { 300 };
        assert!(l[..start].iter().all(|v| *v == 0.0));
        assert!(l[start..].iter().all(|v| *v == 1.0));
        assert_eq!(calls.load(Ordering::Relaxed), if grid { 1 } else { 2 });
        assert_eq!(unrelated.load(Ordering::Relaxed), 1);
        assert_eq!(audio.pieces(), 1);
    }
}

struct Probe {
    gain: f32,
}
impl Module for Probe {
    fn inputs(&self) -> Vec<Kind> {
        vec![Kind::Notes]
    }
    fn outputs(&self) -> Vec<Kind> {
        vec![Kind::Audio]
    }
    fn handle(&mut self, event: &EventKind) {
        if let EventKind::Param { value, .. } = event {
            self.gain = *value;
        }
    }
    fn process(&mut self, io: &mut Io) {
        let notes = io.ins.notes(0);
        let (l, r) = io.outs.audio(0);
        l.fill(0.0);
        r.fill(0.0);
        for note in notes {
            l[note.offset as usize] += self.gain;
            r[note.offset as usize] += self.gain;
        }
    }
}
#[test]
fn incoming_notes_are_rebased_once_across_a_recipients_own_controls() {
    let (mut ctl, mut audio) = engine(
        RATE,
        Config {
            max_block: 512,
            fade_frames: 0,
            ..Config::default()
        },
    );
    ctl.add(1, Box::new(Keys::new())).unwrap();
    ctl.add(2, Box::new(Probe { gain: 1.0 })).unwrap();
    ctl.connect(port(1, 0), port(2, 0)).unwrap();
    ctl.connect_out(port(2, 0)).unwrap();
    ctl.commit().unwrap();
    ctl.send_at(
        160,
        2,
        EventKind::Param {
            index: 0,
            value: 0.25,
        },
    )
    .unwrap();
    ctl.send_at(
        400,
        2,
        EventKind::Param {
            index: 0,
            value: 0.5,
        },
    )
    .unwrap();
    for frame in 0..512 {
        ctl.send_at(frame, 1, EventKind::Note(NoteEvent::on(60, 1.0)))
            .unwrap();
    }
    let (l, _) = render(&mut audio, 512, 512);
    assert!(l[..160].iter().all(|v| *v == 1.0));
    assert!(l[160..400].iter().all(|v| *v == 0.25));
    assert!(l[400..].iter().all(|v| *v == 0.5));
    assert_eq!(audio.pieces(), 1);
}

struct ScalarProbe;
impl Module for ScalarProbe {
    fn inputs(&self) -> Vec<Kind> {
        vec![Kind::Clock, Kind::Sound]
    }
    fn outputs(&self) -> Vec<Kind> {
        vec![Kind::Audio]
    }
    fn process(&mut self, io: &mut Io) {
        let mut clock = io.ins.clock(0);
        let sound = io.ins.sound(1);
        let step = clock.step(io.rate);
        let (l, r) = io.outs.audio(0);
        for i in 0..io.n {
            l[i] = clock.beat as f32 + sound.id as f32;
            r[i] = clock.bpm as f32 + clock.playing as u8 as f32;
            if clock.playing {
                clock.beat += step;
            }
        }
    }
}
fn scalars(block: usize) -> Vec<f32> {
    let (mut ctl, mut audio) = engine(
        RATE,
        Config {
            max_block: 512,
            fade_frames: 0,
            ..Config::default()
        },
    );
    ctl.add(1, Box::new(Clock::new(120.0, true))).unwrap();
    ctl.add(2, Box::new(SoundSource::new())).unwrap();
    ctl.add(3, Box::new(ScalarProbe)).unwrap();
    ctl.connect(port(1, 0), port(3, 0)).unwrap();
    ctl.connect(port(2, 0), port(3, 1)).unwrap();
    ctl.connect_out(port(3, 0)).unwrap();
    ctl.commit().unwrap();
    for (frame, bpm) in [(72, 133.0), (301, 77.0), (500, 231.0)] {
        ctl.send_at(
            frame,
            1,
            EventKind::Param {
                index: 0,
                value: bpm,
            },
        )
        .unwrap();
    }
    ctl.send_at(
        150,
        1,
        EventKind::Param {
            index: 1,
            value: 0.0,
        },
    )
    .unwrap();
    ctl.send_at(
        200,
        1,
        EventKind::Param {
            index: 1,
            value: 1.0,
        },
    )
    .unwrap();
    for (frame, id) in [(100, 2), (300, 3), (510, 1)] {
        ctl.send_at(
            frame,
            2,
            EventKind::Sound {
                slot: 0,
                sound: SoundRef { id, version: 1 },
            },
        )
        .unwrap();
    }
    let (l, r) = render(&mut audio, 1024, block);
    [l, r].concat()
}
#[test]
fn clock_transport_tempo_and_sound_selection_propagate_without_whole_graph_cuts() {
    let expected = scalars(1);
    for block in [7, 64, 128, 512] {
        assert_same("scalar histories", &expected, &scalars(block));
    }
}

struct LocalFault {
    state: u32,
    mode: u8,
}
impl Module for LocalFault {
    fn inputs(&self) -> Vec<Kind> {
        vec![]
    }
    fn outputs(&self) -> Vec<Kind> {
        vec![Kind::Audio]
    }
    fn handle(&mut self, event: &EventKind) {
        if let EventKind::Param { index, .. } = event {
            if self.mode == 2 && *index == 1 {
                panic!("local handle failure");
            }
            self.state = *index;
        }
    }
    fn process(&mut self, io: &mut Io) {
        if self.state == 1 && self.mode == 1 {
            panic!("local failure");
        }
        let (l, r) = io.outs.audio(0);
        l.fill(if self.state == 1 { f32::NAN } else { 1.0 });
        r.copy_from_slice(l);
    }
}
#[test]
fn a_fault_in_a_later_local_piece_keeps_the_valid_prefix_and_recovers_locally() {
    for mode in [0, 1, 2] {
        let (mut ctl, mut audio) = engine(
            RATE,
            Config {
                max_block: 512,
                fade_frames: 0,
                ..Config::default()
            },
        );
        ctl.add(1, Box::new(LocalFault { state: 0, mode })).unwrap();
        ctl.connect_out(port(1, 0)).unwrap();
        ctl.commit().unwrap();
        ctl.send_at(
            128,
            1,
            EventKind::Param {
                index: 1,
                value: 0.0,
            },
        )
        .unwrap();
        ctl.send_at(
            256,
            1,
            EventKind::Param {
                index: 2,
                value: 0.0,
            },
        )
        .unwrap();
        let (l, _) = render(&mut audio, 512, 512);
        assert!(l[..128].iter().all(|v| *v == 1.0));
        assert!(l[128..256].iter().all(|v| *v == 0.0));
        assert!(l[256..]
            .iter()
            .all(|v| *v == if mode > 0 { 0.0 } else { 1.0 }));
        assert_eq!(ctl.bad_blocks(), if mode > 0 { 0 } else { 1 });
        ctl.collect();
        assert_eq!(ctl.take_failures().len(), usize::from(mode > 0));
    }
}

struct RawOutput(f32);
impl Module for RawOutput {
    fn inputs(&self) -> Vec<Kind> {
        vec![]
    }
    fn outputs(&self) -> Vec<Kind> {
        vec![Kind::Audio]
    }
    fn handle(&mut self, event: &EventKind) {
        if let EventKind::Param { value, .. } = event {
            self.0 = *value;
        }
    }
    fn process(&mut self, io: &mut Io) {
        if let Buf::Audio { l, r, .. } = &mut io.outs.bufs[0] {
            l[..io.n].fill(self.0);
            r[..io.n].fill(self.0);
        }
    }
}
#[test]
fn raw_output_storage_still_starts_at_zero_in_every_local_callback() {
    let (mut ctl, mut audio) = engine(
        RATE,
        Config {
            max_block: 512,
            fade_frames: 0,
            ..Config::default()
        },
    );
    ctl.add(1, Box::new(RawOutput(1.0))).unwrap();
    ctl.connect_out(port(1, 0)).unwrap();
    ctl.commit().unwrap();
    ctl.send_at(
        300,
        1,
        EventKind::Param {
            index: 0,
            value: 0.25,
        },
    )
    .unwrap();
    let (l, _) = render(&mut audio, 512, 512);
    assert!(l[..300].iter().all(|v| *v == 1.0));
    assert!(l[300..].iter().all(|v| *v == 0.25));
}

struct Ordered {
    trace: Arc<Vec<AtomicUsize>>,
    count: usize,
    value: f32,
}
impl Module for Ordered {
    fn inputs(&self) -> Vec<Kind> {
        vec![]
    }
    fn outputs(&self) -> Vec<Kind> {
        vec![Kind::Audio]
    }
    fn handle(&mut self, event: &EventKind) {
        if let EventKind::Param { index, value } = *event {
            self.trace[self.count].store(index as usize, Ordering::Relaxed);
            self.count += 1;
            self.value = value;
        }
    }
    fn process(&mut self, io: &mut Io) {
        let (l, r) = io.outs.audio(0);
        l.fill(self.value);
        r.fill(self.value);
    }
}
#[test]
fn four_thousand_scrambled_messages_reach_handle_and_audio_in_stable_order() {
    let (mut ctl, mut audio) = engine(
        RATE,
        Config {
            max_block: 512,
            queue: 8192,
            fade_frames: 0,
            ..Config::default()
        },
    );
    let trace = Arc::new(
        (0..4096)
            .map(|_| AtomicUsize::new(usize::MAX))
            .collect::<Vec<_>>(),
    );
    ctl.add(
        1,
        Box::new(Ordered {
            trace: trace.clone(),
            count: 0,
            value: 0.0,
        }),
    )
    .unwrap();
    ctl.connect_out(port(1, 0)).unwrap();
    ctl.commit().unwrap();
    let mut reference = Vec::new();
    for index in 0..4096 {
        let frame = ((index * 2357) % 1024) * 4;
        ctl.send_at(
            frame as u64,
            1,
            EventKind::Param {
                index: index as u32,
                value: (index + 1) as f32,
            },
        )
        .unwrap();
        reference.push((frame, index));
    }
    reference.sort_by_key(|&(frame, index)| (frame, index));
    let (l, _) = render(&mut audio, 4096, 512);
    assert_eq!(
        trace
            .iter()
            .map(|v| v.load(Ordering::Relaxed))
            .collect::<Vec<_>>(),
        reference.iter().map(|&(_, i)| i).collect::<Vec<_>>()
    );
    let mut event = 0;
    let mut expected = 0.0;
    for frame in 0..4096 {
        while event < reference.len() && reference[event].0 == frame {
            expected = (reference[event].1 + 1) as f32;
            event += 1;
        }
        assert_eq!(l[frame], expected, "sample {frame}");
    }
    assert_eq!(audio.pieces(), 8);
}

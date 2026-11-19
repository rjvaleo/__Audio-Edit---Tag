use super::*;

/// All event views and returned objects have room before a plan is published.
pub(crate) struct EventScratch {
    notes: Vec<NoteBuf>,
    outputs: Vec<Buf>,
    pub(crate) retired: std::collections::VecDeque<Thing>,
    pub(crate) panic: Option<Thing>,
    pub(crate) tripped: u64,
}
impl EventScratch {
    pub(crate) fn new(inputs: &[Kind], outputs: &[Kind], max_block: usize) -> Self {
        Self {
            outputs: outputs
                .iter()
                .map(|kind| Buf::new(*kind, if *kind == Kind::Notes { 1 } else { max_block }))
                .collect(),
            notes: inputs
                .iter()
                .map(|kind| NoteBuf::with_frames(if *kind == Kind::Notes { max_block } else { 0 }))
                .collect(),
            retired: std::collections::VecDeque::with_capacity(max_block.max(16)),
            panic: None,
            tripped: 0,
        }
    }
}

pub(super) fn split_events<M: Module + ?Sized>(module: &mut M, io: &mut Io) {
    let mut at = 0;
    let mut event = 0;
    while at < io.n {
        while event < io.events.len() && io.events[event].0 as usize <= at {
            if let Err(payload) = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                module.handle(&io.events[event].1)
            })) {
                failed_piece(io, at, payload);
                return;
            }
            event += 1;
        }
        let mut end = io
            .events
            .get(event)
            .map_or(io.n, |event| event.0 as usize)
            .min(io.n);
        // Scalar ports need a history too: only their consumers subdivide
        // when tempo/transport/sound changes within an enclosing piece.
        for input in 0..io.ins.count() {
            match io.ins.buf(input) {
                Buf::ClockFrames(clocks) => {
                    for i in at + 1..end {
                        let old = clocks[i - 1];
                        let new = clocks[i];
                        let beat = if old.playing {
                            old.beat + old.step(io.rate)
                        } else {
                            old.beat
                        };
                        if old.playing != new.playing
                            || old.bpm != new.bpm
                            || beat.to_bits() != new.beat.to_bits()
                        {
                            end = i;
                            break;
                        }
                    }
                }
                Buf::SoundFrames(sounds) => {
                    for i in at + 1..end {
                        if sounds[i] != sounds[i - 1] {
                            end = i;
                            break;
                        }
                    }
                }
                _ => {}
            }
        }
        // A whole local piece can use the original storage directly. Legacy
        // raw Outputs::bufs access still starts at zero on every process call.
        if at == 0 && end == io.n {
            for out in io.outs.bufs.iter_mut() {
                if let Buf::Notes(notes) = out {
                    notes.legacy();
                }
            }
            let events = io.events;
            io.events = &[];
            module.process(io);
            io.events = events;
            for out in io.outs.bufs.iter_mut() {
                if let Buf::Notes(notes) = out {
                    notes.end();
                }
            }
            return;
        }
        for input in 0..io.ins.count() {
            let scratch = &mut io.scratch.notes[input];
            scratch.end();
            scratch.clear();
            if let Buf::Notes(notes) = io.ins.buf(input) {
                for note in notes.as_slice() {
                    if (note.offset as usize) >= at && (note.offset as usize) < end {
                        scratch.push(NoteEvent {
                            offset: note.offset - at as u32,
                            ..*note
                        });
                    }
                }
            }
        }
        for out in &mut io.scratch.outputs {
            if let Buf::Notes(notes) = out {
                notes.clear();
            }
        }
        let mut piece = Io {
            events: &[],
            n: end - at,
            rate: io.rate,
            frame: io.frame + at as u64,
            ins: Inputs {
                offset: at,
                notes: Some(&io.scratch.notes),
                reads: io.ins.reads,
                before: io.ins.before,
                after: io.ins.after,
                gap_start: io.ins.gap_start,
                gap_len: io.ins.gap_len,
                map: io.ins.map,
                n: end - at,
            },
            outs: Outputs {
                bufs: &mut io.scratch.outputs,
                rate: io.rate,
                n: end - at,
            },
            sounds: io.sounds,
            // process() itself does not dispatch events recursively.
            scratch: &mut EventScratch {
                outputs: Vec::new(),
                notes: Vec::new(),
                retired: std::collections::VecDeque::new(),
                panic: None,
                tripped: 0,
            },
        };
        let result =
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| module.process(&mut piece)));
        if let Err(payload) = result {
            failed_piece(io, at, payload);
            return;
        }
        let mut bad = false;
        for out in io.scratch.outputs.iter_mut() {
            match out {
                Buf::Audio { l, r, .. }
                    if !(crate::guard::all_finite(&l[..end - at])
                        && crate::guard::all_finite(&r[..end - at])) =>
                {
                    l[..end - at].fill(0.0);
                    r[..end - at].fill(0.0);
                    bad = true;
                }
                Buf::Control(values) if !crate::guard::all_finite(&values[..end - at]) => {
                    values[..end - at].fill(0.0);
                    bad = true;
                }
                _ => {}
            }
        }
        if bad {
            io.scratch.tripped += 1;
            if let Err(payload) =
                std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| module.recover()))
            {
                failed_piece(io, at, payload);
                return;
            }
        }
        for (from, out) in io.scratch.outputs.iter().zip(io.outs.bufs.iter_mut()) {
            match (from, out) {
                (
                    Buf::Audio { l, r, .. },
                    Buf::Audio {
                        l: to_l, r: to_r, ..
                    },
                ) => {
                    to_l[at..end].copy_from_slice(&l[..end - at]);
                    to_r[at..end].copy_from_slice(&r[..end - at]);
                }
                (Buf::Control(from), Buf::Control(to)) => {
                    to[at..end].copy_from_slice(&from[..end - at])
                }
                (Buf::Notes(from), Buf::Notes(to)) => {
                    for note in from.as_slice() {
                        to.push(NoteEvent {
                            offset: note.offset + at as u32,
                            ..*note
                        });
                    }
                }
                (Buf::ClockFrames(from), Buf::ClockFrames(to)) => {
                    to[at..end].copy_from_slice(&from[..end - at])
                }
                (Buf::SoundFrames(from), Buf::SoundFrames(to)) => {
                    to[at..end].copy_from_slice(&from[..end - at])
                }
                _ => unreachable!("prepared outputs keep their kind"),
            }
        }
        at = end;
        if at < io.n {
            while io.scratch.retired.len() < io.scratch.retired.capacity() {
                match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| module.finished())) {
                    Ok(Some(thing)) => io.scratch.retired.push_back(thing),
                    Ok(None) => break,
                    Err(payload) => {
                        failed_piece(io, at, payload);
                        return;
                    }
                }
            }
        }
    }
}

/// Local faults preserve already-rendered samples, as the former engine cuts
/// did. The payload remains owned until the controller collects it.
fn failed_piece(io: &mut Io, at: usize, payload: Thing) {
    io.scratch.panic = Some(payload);
    for out in io.outs.bufs.iter_mut() {
        match out {
            Buf::Audio { l, r, .. } => {
                l[at..io.n].fill(0.0);
                r[at..io.n].fill(0.0);
            }
            Buf::Control(values) => values[at..io.n].fill(0.0),
            Buf::Notes(notes) => {
                notes.end();
                notes.before(at as u32);
            }
            Buf::ClockFrames(clocks) => clocks[at..io.n].fill(ClockState::STOPPED),
            Buf::SoundFrames(sounds) => sounds[at..io.n].fill(SoundRef::default()),
            Buf::Clock(clock) => *clock = ClockState::STOPPED,
            Buf::Sound(sound) => *sound = SoundRef::default(),
        }
    }
}

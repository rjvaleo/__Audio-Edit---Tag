//! The third deck: the Wave page's wavetable synth (`docs/WAVE-SYNTH.md`).
//!
//! The grain deck and the Prism deck are each a [`Core`](crate::Core) with a
//! transport. This one has none. It renders every block whether anything is
//! playing or not, because a key pressed on a stopped transport still has to
//! sound — a synth that only spoke while a file played would be no synth.
//!
//! # Two halves, as the other decks have
//!
//! - [`SynthDeck`] lives on the audio thread and owns the [`wave::Synth`].
//! - [`WaveShared`] is what everyone else talks to: the HTTP threads and the
//!   MIDI thread. `Handle` holds it the way it holds the other decks' `Shared`.
//!
//! # How things cross, and why each is shaped the way it is
//!
//! The callback may not allocate, and may not wait. So:
//! - **Notes and controllers** go through [`EventQueue`], a fixed ring of
//!   atomics that any number of threads can push onto and the callback pops.
//!   A note is the one thing that must never be lost to a busy lock, so it is
//!   not behind one.
//! - **A live knob** is a number per key in an atomic, and a bit saying it
//!   moved. Twenty moves between two blocks are one write, which is what a
//!   knob means: the last place it was put.
//! - **A whole patch** is a [`PatchState`] — plain `Copy` data, no heap — in a
//!   mutex the callback only ever `try_lock`s, the engine's `pending_*` pattern.
//! - **A table** is an `Arc<Wavetable>` per oscillator, pending the same way.
//!   The one it replaces is passed back through a return slot rather than
//!   dropped in the callback: the last reference to five megabytes of mip
//!   levels is a free, and a free is what the audio thread may not do. The
//!   callback only swaps when the return slot is empty, so it never has to
//!   hold two.
//! - **Telemetry** is copied into a mutex every block, `try_lock`ed; a poll
//!   that holds it costs the page one stale frame and the audio nothing.
//!
//! [`WaveShared`] also keeps the **current** patch and tables, not just the
//! pending ones. A device that is closed and opened again (a new buffer size)
//! builds a new [`SynthDeck`], and it starts from what was last sent rather
//! than from silence.

use std::sync::atomic::{AtomicU32, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use wave::{ParamId, PatchState, Synth, Telemetry, Wavetable, NUM_PARAMS};

/// Events the queue holds. A burst of MIDI — a chord, a controller sweep — is
/// at most a few hundred between two blocks; this is room for many times that.
pub const EVENT_CAPACITY: usize = 1024;

/// Recent output samples the page draws as the live wave.
pub const WAVE_POINTS: usize = 256;

/// One thing a player did.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum WaveEvent {
    /// A key down. Velocity is 0..1.
    NoteOn { note: u8, vel: f32 },
    NoteOff { note: u8 },
    /// Pitch bend, −1..1.
    Bend(f32),
    /// The mod wheel, 0..1.
    ModWheel(f32),
    /// Channel aftertouch, 0..1.
    Aftertouch(f32),
    /// Release every held key (their tails ring out).
    AllNotesOff,
}

impl WaveEvent {
    /// Packed into one word, so a queue slot is a single atomic and needs no
    /// unsafe cell: kind in the top byte, note in the next, a float's bits in
    /// the low half.
    fn pack(self) -> u64 {
        let (kind, note, v) = match self {
            WaveEvent::NoteOn { note, vel } => (1u64, note, vel),
            WaveEvent::NoteOff { note } => (2, note, 0.0),
            WaveEvent::Bend(v) => (3, 0, v),
            WaveEvent::ModWheel(v) => (4, 0, v),
            WaveEvent::Aftertouch(v) => (5, 0, v),
            WaveEvent::AllNotesOff => (6, 0, 0.0),
        };
        (kind << 56) | ((note as u64) << 48) | v.to_bits() as u64
    }

    fn unpack(w: u64) -> Option<WaveEvent> {
        let note = (w >> 48) as u8;
        let v = f32::from_bits(w as u32);
        Some(match w >> 56 {
            1 => WaveEvent::NoteOn { note, vel: v },
            2 => WaveEvent::NoteOff { note },
            3 => WaveEvent::Bend(v),
            4 => WaveEvent::ModWheel(v),
            5 => WaveEvent::Aftertouch(v),
            6 => WaveEvent::AllNotesOff,
            _ => return None,
        })
    }
}

/// A bounded queue of events, any number of writers, lock-free.
///
/// Dmitry Vyukov's bounded MPMC ring: every slot carries a sequence number
/// that says whose turn it is, so a writer claims a slot with one
/// compare-and-swap and publishes it with one store, and the reader does the
/// same. The HTTP threads and the MIDI thread push; the callback pops. Nothing
/// here allocates after [`EventQueue::new`].
pub struct EventQueue {
    slots: Box<[(AtomicUsize, AtomicU64)]>,
    mask: usize,
    head: AtomicUsize,
    tail: AtomicUsize,
    /// Events refused because the ring was full. Reported, never hidden.
    pub dropped: AtomicU64,
}

impl EventQueue {
    /// A ring of at least `capacity` slots, rounded up to a power of two.
    pub fn new(capacity: usize) -> EventQueue {
        let n = capacity.max(2).next_power_of_two();
        EventQueue {
            slots: (0..n).map(|i| (AtomicUsize::new(i), AtomicU64::new(0))).collect(),
            mask: n - 1,
            head: AtomicUsize::new(0),
            tail: AtomicUsize::new(0),
            dropped: AtomicU64::new(0),
        }
    }

    /// Add an event. False, and counted, if the ring is full: a lost note is
    /// bad, but a writer that waited on the audio thread would be worse.
    pub fn push(&self, e: WaveEvent) -> bool {
        self.push_word(e.pack())
    }

    /// The same, for a word somebody else packed (`keys.rs`).
    pub fn push_word(&self, word: u64) -> bool {
        let mut pos = self.tail.load(Ordering::Relaxed);
        loop {
            let (seq, data) = &self.slots[pos & self.mask];
            let s = seq.load(Ordering::Acquire);
            let dif = s as isize - pos as isize;
            if dif == 0 {
                match self.tail.compare_exchange_weak(pos, pos + 1, Ordering::Relaxed, Ordering::Relaxed) {
                    Ok(_) => {
                        data.store(word, Ordering::Relaxed);
                        seq.store(pos + 1, Ordering::Release);
                        return true;
                    }
                    Err(now) => pos = now,
                }
            } else if dif < 0 {
                self.dropped.fetch_add(1, Ordering::Relaxed);
                return false;
            } else {
                pos = self.tail.load(Ordering::Relaxed);
            }
        }
    }

    /// Take the oldest event, if there is one.
    pub fn pop(&self) -> Option<WaveEvent> {
        loop {
            // A word nobody could have written is skipped, not trusted.
            if let Some(e) = WaveEvent::unpack(self.pop_word()?) {
                return Some(e);
            }
        }
    }

    /// The oldest word, as it was pushed.
    pub fn pop_word(&self) -> Option<u64> {
        let mut pos = self.head.load(Ordering::Relaxed);
        loop {
            let (seq, data) = &self.slots[pos & self.mask];
            let s = seq.load(Ordering::Acquire);
            let dif = s as isize - (pos + 1) as isize;
            if dif == 0 {
                match self.head.compare_exchange_weak(pos, pos + 1, Ordering::Relaxed, Ordering::Relaxed) {
                    Ok(_) => {
                        let w = data.load(Ordering::Relaxed);
                        seq.store(pos + self.mask + 1, Ordering::Release);
                        return Some(w);
                    }
                    Err(now) => pos = now,
                }
            } else if dif < 0 {
                return None;
            } else {
                pos = self.head.load(Ordering::Relaxed);
            }
        }
    }
}

/// Words in the "this knob moved" mask: one bit per numeric key.
const DIRTY_WORDS: usize = NUM_PARAMS.div_ceil(64);

/// Everything the rest of the program says to the synth deck.
pub struct WaveShared {
    pub events: EventQueue,
    /// The value each numeric key was last moved to live, as f32 bits.
    live: Box<[AtomicU32]>,
    /// Which of `live` moved since the callback last looked.
    dirty: [AtomicU64; DIRTY_WORDS],
    pending_patch: Mutex<Option<PatchState>>,
    pending_tables: [Mutex<Option<Arc<Wavetable>>>; 3],
    /// Tables the callback has let go of, waiting to be dropped on a thread
    /// that may free memory. See the module doc.
    returned: [Mutex<Option<Arc<Wavetable>>>; 3],
    /// What was last sent, so a new device starts where the old one was.
    current: Mutex<(PatchState, [Option<Arc<Wavetable>>; 3])>,
    /// The synth's telemetry and its last [`WAVE_POINTS`] output samples
    /// (the mean of left and right, oldest first).
    telemetry: Mutex<(Telemetry, [f32; WAVE_POINTS])>,
    /// Blocks rendered, so a reader can tell a running deck from a stale one.
    pub blocks: AtomicU64,
}

impl Default for WaveShared {
    fn default() -> Self {
        WaveShared::new()
    }
}

impl WaveShared {
    pub fn new() -> WaveShared {
        WaveShared {
            events: EventQueue::new(EVENT_CAPACITY),
            live: (0..NUM_PARAMS).map(|_| AtomicU32::new(0)).collect(),
            dirty: std::array::from_fn(|_| AtomicU64::new(0)),
            pending_patch: Mutex::new(None),
            pending_tables: std::array::from_fn(|_| Mutex::new(None)),
            returned: std::array::from_fn(|_| Mutex::new(None)),
            current: Mutex::new((PatchState::default(), [None, None, None])),
            telemetry: Mutex::new((Telemetry::default(), [0.0; WAVE_POINTS])),
            blocks: AtomicU64::new(0),
        }
    }

    /// Queue a note or a controller.
    pub fn push(&self, e: WaveEvent) -> bool {
        self.events.push(e)
    }

    /// Move one numeric key, heard from the next block. Not stored anywhere
    /// but here: the server decides what is kept.
    pub fn set_live(&self, id: ParamId, value: f32) {
        let i = id.index();
        if i >= NUM_PARAMS || !value.is_finite() {
            return;
        }
        self.live[i].store(value.to_bits(), Ordering::Relaxed);
        self.dirty[i / 64].fetch_or(1u64 << (i % 64), Ordering::Release);
    }

    /// Hand over a whole compiled patch.
    ///
    /// Live moves not yet heard are dropped first: they were made against the
    /// patch this one replaces, and applying them after it would put a stale
    /// knob back. A move made after this call lands on top, as it should.
    pub fn set_patch(&self, state: PatchState) {
        for d in &self.dirty {
            d.store(0, Ordering::Release);
        }
        if let Ok(mut g) = self.current.lock() {
            g.0 = state;
        }
        if let Ok(mut g) = self.pending_patch.lock() {
            *g = Some(state);
        }
    }

    /// Hand a table to an oscillator (0..2). Anything the callback has let go
    /// of is dropped here first, on this thread.
    pub fn set_table(&self, osc: usize, table: Arc<Wavetable>) {
        if osc >= 3 {
            return;
        }
        self.collect();
        if let Ok(mut g) = self.current.lock() {
            g.1[osc] = Some(Arc::clone(&table));
        }
        if let Ok(mut g) = self.pending_tables[osc].lock() {
            *g = Some(table);
        }
    }

    /// The table each oscillator was last given.
    pub fn current_tables(&self) -> [Option<Arc<Wavetable>>; 3] {
        self.current.lock().map(|g| g.1.clone()).unwrap_or_default()
    }

    /// Drop, here, every table the callback has given back. Cheap when there
    /// are none; the server calls it on its way through any wave route.
    pub fn collect(&self) {
        for slot in &self.returned {
            let old = slot.lock().ok().and_then(|mut g| g.take());
            drop(old);
        }
    }

    /// The latest telemetry the callback published, and the recent output.
    pub fn telemetry(&self) -> (Telemetry, [f32; WAVE_POINTS]) {
        self.telemetry.lock().map(|g| *g).unwrap_or((Telemetry::default(), [0.0; WAVE_POINTS]))
    }
}

/// The audio-thread half. Built off the audio thread, with every buffer it
/// will ever need.
pub struct SynthDeck {
    synth: Synth,
    shared: Arc<WaveShared>,
    left: Vec<f32>,
    right: Vec<f32>,
    /// The synth's block, laid out for the device, for the grain deck to add
    /// before its ceiling.
    block: Vec<f32>,
    tele: Telemetry,
    /// The last [`WAVE_POINTS`] samples out, oldest first.
    recent: [f32; WAVE_POINTS],
}

impl SynthDeck {
    /// A deck at the device's rate, starting from whatever `shared` was last
    /// sent.
    pub fn new(sample_rate: f32, max_block: usize, channels: usize, shared: Arc<WaveShared>) -> SynthDeck {
        let max_block = max_block.max(1);
        let mut synth = Synth::new(sample_rate, max_block);
        if let Ok(g) = shared.current.lock() {
            synth.adopt(g.0);
            for (osc, t) in g.1.iter().enumerate() {
                if let Some(t) = t {
                    synth.set_table(osc, Arc::clone(t));
                }
            }
        }
        // What is pending is already in `current`; taking it now stops the
        // first block adopting it a second time.
        if let Ok(mut g) = shared.pending_patch.lock() {
            g.take();
        }
        for p in &shared.pending_tables {
            if let Ok(mut g) = p.lock() {
                g.take();
            }
        }
        SynthDeck {
            synth,
            shared,
            left: vec![0.0; max_block],
            right: vec![0.0; max_block],
            block: vec![0.0; max_block * channels.max(1)],
            tele: Telemetry::default(),
            recent: [0.0; WAVE_POINTS],
        }
    }

    pub fn shared(&self) -> &Arc<WaveShared> {
        &self.shared
    }

    /// Take what has been sent: a patch, tables, live knobs, then the notes,
    /// so a note played with a patch change in the same block is heard with
    /// the new patch. No allocation, no waiting.
    fn take_changes(&mut self) {
        let sh = &*self.shared;
        if let Ok(mut g) = sh.pending_patch.try_lock() {
            if let Some(state) = g.take() {
                self.synth.adopt(state);
            }
        }
        for osc in 0..3 {
            let Ok(mut back) = sh.returned[osc].try_lock() else { continue };
            if back.is_some() {
                // The last one has not been collected yet. Swapping now would
                // leave two to hold and nowhere to put the second.
                continue;
            }
            if let Ok(mut g) = sh.pending_tables[osc].try_lock() {
                if let Some(t) = g.take() {
                    *back = self.synth.set_table(osc, t);
                }
            }
        }
        for (w, word) in sh.dirty.iter().enumerate() {
            let mut bits = word.swap(0, Ordering::AcqRel);
            while bits != 0 {
                let b = bits.trailing_zeros() as usize;
                bits &= bits - 1;
                let i = w * 64 + b;
                if i < NUM_PARAMS {
                    let v = f32::from_bits(sh.live[i].load(Ordering::Relaxed));
                    self.synth.set_param(ParamId(i as u16), v);
                }
            }
        }
        while let Some(e) = sh.events.pop() {
            match e {
                WaveEvent::NoteOn { note, vel } => self.synth.note_on(note, vel),
                WaveEvent::NoteOff { note } => self.synth.note_off(note),
                WaveEvent::Bend(v) => self.synth.bend(v),
                WaveEvent::ModWheel(v) => self.synth.mod_wheel(v),
                WaveEvent::Aftertouch(v) => self.synth.aftertouch(v),
                WaveEvent::AllNotesOff => self.synth.all_notes_off(),
            }
        }
    }

    /// Render one block of `frames` frames, laid out for `channels`, and
    /// return it. Stereo goes to the first two channels; a mono device gets
    /// the mean of the two, as the sequencer's sound does.
    pub fn render(&mut self, frames: usize, channels: usize) -> &[f32] {
        let ch = channels.max(1);
        let frames = frames.min(self.left.len()).min(self.block.len() / ch);
        self.take_changes();
        let (l, r) = (&mut self.left[..frames], &mut self.right[..frames]);
        self.synth.render(l, r);
        let out = &mut self.block[..frames * ch];
        for f in 0..frames {
            let (a, b) = (self.left[f], self.right[f]);
            let o = &mut out[f * ch..(f + 1) * ch];
            if ch == 1 {
                o[0] = 0.5 * (a + b);
            } else {
                o[0] = a;
                o[1] = b;
                o[2..].iter_mut().for_each(|s| *s = 0.0);
            }
        }
        // The live wave: the newest samples on the end, the rest moved up.
        let fresh = frames.min(WAVE_POINTS);
        self.recent.copy_within(fresh.., 0);
        for (i, f) in (frames - fresh..frames).enumerate() {
            self.recent[WAVE_POINTS - fresh + i] = 0.5 * (self.left[f] + self.right[f]);
        }
        self.synth.telemetry(&mut self.tele);
        if let Ok(mut g) = self.shared.telemetry.try_lock() {
            *g = (self.tele, self.recent);
        }
        self.shared.blocks.fetch_add(1, Ordering::Relaxed);
        &self.block[..frames * ch]
    }

    /// Voices sounding, tails included.
    pub fn active_voices(&self) -> usize {
        self.synth.active_voices()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn events_survive_the_round_trip_through_one_word() {
        for e in [
            WaveEvent::NoteOn { note: 60, vel: 0.75 },
            WaveEvent::NoteOff { note: 127 },
            WaveEvent::Bend(-1.0),
            WaveEvent::ModWheel(0.5),
            WaveEvent::Aftertouch(0.25),
            WaveEvent::AllNotesOff,
        ] {
            assert_eq!(WaveEvent::unpack(e.pack()), Some(e));
        }
    }

    #[test]
    fn the_queue_keeps_order_and_refuses_when_full() {
        let q = EventQueue::new(4);
        for n in 0..4 {
            assert!(q.push(WaveEvent::NoteOff { note: n }));
        }
        assert!(!q.push(WaveEvent::NoteOff { note: 9 }), "a full ring must refuse");
        assert_eq!(q.dropped.load(Ordering::Relaxed), 1);
        for n in 0..4 {
            assert_eq!(q.pop(), Some(WaveEvent::NoteOff { note: n }));
        }
        assert_eq!(q.pop(), None);
        // And round again, past the wrap.
        for n in 0..10u8 {
            assert!(q.push(WaveEvent::NoteOn { note: n, vel: 1.0 }));
            assert_eq!(q.pop(), Some(WaveEvent::NoteOn { note: n, vel: 1.0 }));
        }
    }

    #[test]
    fn many_writers_lose_nothing_that_fits() {
        let q = Arc::new(EventQueue::new(4096));
        let threads: Vec<_> = (0..4u8)
            .map(|t| {
                let q = Arc::clone(&q);
                std::thread::spawn(move || {
                    for n in 0..500u32 {
                        q.push(WaveEvent::NoteOn { note: t, vel: n as f32 });
                    }
                })
            })
            .collect();
        for t in threads {
            t.join().unwrap();
        }
        let mut seen = [0u32; 4];
        let mut last = [-1.0f32; 4];
        while let Some(WaveEvent::NoteOn { note, vel }) = q.pop() {
            // Each writer's own events stay in its order.
            assert!(vel > last[note as usize]);
            last[note as usize] = vel;
            seen[note as usize] += 1;
        }
        assert_eq!(seen, [500; 4]);
    }

    #[test]
    fn a_live_move_after_a_patch_lands_and_one_before_it_does_not() {
        let sh = WaveShared::new();
        let id = wave::param_id("master").unwrap();
        sh.set_live(id, 0.1);
        sh.set_patch(PatchState::default());
        assert!(sh.dirty.iter().all(|d| d.load(Ordering::Relaxed) == 0));
        sh.set_live(id, 0.3);
        assert_ne!(sh.dirty[id.index() / 64].load(Ordering::Relaxed), 0);
    }
}

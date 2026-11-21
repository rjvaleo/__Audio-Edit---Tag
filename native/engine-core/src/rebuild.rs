//! State remembered without borrowing an audio-owned module from the controller.
use crate::{EventKind, Io, Kind, Module, NoteEvent, NoteKind, Thing};

pub type ModuleFactory = Box<dyn Fn(f32, usize) -> Box<dyn Module> + Send>;

pub(crate) struct Remember {
    inner: Box<dyn Module>,
    kinds: Vec<Kind>,
    note_positions: Vec<usize>,
    events: Vec<EventKind>,
    notes: Vec<NoteEvent>,
    replay_notes: bool,
}
impl Remember {
    pub(crate) fn new(inner: Box<dyn Module>) -> Self {
        let replay_notes = !inner.outputs().contains(&Kind::Notes);
        Self {
            note_positions: vec![0; inner.inputs().len()],
            kinds: inner.inputs(),
            inner,
            events: Vec::with_capacity(4096),
            notes: Vec::with_capacity(2048),
            replay_notes,
        }
    }
    fn note(&mut self, note: NoteEvent) {
        if !self.replay_notes {
            return;
        }
        let at = self
            .notes
            .iter()
            .position(|old| old.channel == note.channel && old.note == note.note);
        match note.kind {
            NoteKind::AllOff => self.notes.clear(),
            NoteKind::On => {
                let note = NoteEvent { offset: 0, ..note };
                if let Some(at) = at {
                    self.notes[at] = note;
                } else {
                    assert!(
                        self.notes.len() < self.notes.capacity(),
                        "more than 2048 held notes"
                    );
                    self.notes.push(note);
                }
            }
            NoteKind::Off => {
                if let Some(at) = at {
                    self.notes.remove(at);
                }
            }
        }
    }

    fn remember(&mut self, event: &EventKind) {
        if let EventKind::Note(note) = event {
            self.note(*note);
            return;
        }
        let same = |old: &EventKind| match (old, event) {
            (EventKind::Param { index: a, .. }, EventKind::Param { index: b, .. }) => a == b,
            (EventKind::Sound { slot: a, .. }, EventKind::Sound { slot: b, .. }) => a == b,
            _ => false,
        };
        if let Some(old) = self.events.iter_mut().find(|old| same(old)) {
            *old = *event;
        } else {
            assert!(
                self.events.len() < self.events.capacity(),
                "module has more than 4096 controls"
            );
            self.events.push(*event);
        }
    }
}
impl Module for Remember {
    fn preset_type(&self) -> Option<std::any::TypeId> { self.inner.preset_type() }
    fn visit_preset(&self,thing:&Thing,visit:&mut dyn FnMut(EventKind)) {self.inner.visit_preset(thing,visit);}
    fn parallel_weight(&self) -> usize { self.inner.parallel_weight() }
    fn parallel_active(&self) -> bool { self.inner.parallel_active() }
    fn transfer(&mut self, from: &dyn Module, rate: f32) {
        if let Some(previous) = (from as &dyn std::any::Any).downcast_ref::<Remember>() {
            self.inner.transfer(previous.inner.as_ref(), rate);
        }
    }
    fn rate_change(&mut self, rate: f32, frame: u64) { self.inner.rate_change(rate, frame); }
    fn recording_report(&mut self) -> Option<crate::RecorderReport> { self.inner.recording_report() }
    fn inputs(&self) -> Vec<Kind> {
        self.inner.inputs()
    }
    fn outputs(&self) -> Vec<Kind> {
        self.inner.outputs()
    }
    fn latency(&self) -> usize {
        self.inner.latency()
    }
    fn tail(&self) -> usize {
        self.inner.tail()
    }
    fn can_sleep(&self) -> bool {
        self.inner.can_sleep()
    }
    fn feedback_delay(&self) -> usize {
        self.inner.feedback_delay()
    }
    fn prepare(&mut self, rate: f32, max: usize) {
        self.inner.prepare(rate, max);
    }
    fn handle(&mut self, event: &EventKind) {
        self.remember(event);
        self.inner.handle(event);
    }
    fn process(&mut self, io: &mut Io) {
        for port in 0..self.kinds.len() {
            if self.kinds[port] == Kind::Notes {
                for note in io.ins.notes(port) {
                    self.note(*note);
                }
            }
        }
        self.inner.process(io);
    }
    fn process_events(&mut self, io: &mut Io) {
        // The inner module owns its dispatch policy. Remember the requested
        // state in the same frame/cable order without intercepting that policy.
        self.note_positions.fill(0);
        let mut event = 0;
        loop {
            let next_note = (0..self.kinds.len()).filter(|port| self.kinds[*port] == Kind::Notes)
                .filter_map(|port| io.ins.notes(port).get(self.note_positions[port]).map(|note| (note.offset, port)))
                .min();
            if let Some(&(offset, kind)) = io.events.get(event) {
                if next_note.is_none_or(|(note, _)| offset <= note) {
                    self.remember(&kind); event += 1; continue;
                }
            }
            if let Some((_, port)) = next_note {
                let note = io.ins.notes(port)[self.note_positions[port]];
                self.note(note); self.note_positions[port] += 1;
            } else { break; }
        }
        self.inner.process_events(io);
    }
    fn take(&mut self, slot: u32, thing: Thing) -> Option<Thing> {
        if slot==crate::PRESET {
            let events=&mut self.events;
            self.inner.visit_preset(&thing,&mut |event| {
                let EventKind::Param {index,..}=event else {return;};
                if let Some(old)=events.iter_mut().find(|old|matches!(old,EventKind::Param {index:i,..} if *i==index)) {*old=event;}
                else {assert!(events.len()<events.capacity(),"preset exceeds remembered controls");events.push(event);}
            });
        }
        self.inner.take(slot, thing)
    }
    fn finished(&mut self) -> Option<Thing> {
        self.inner.finished()
    }
    fn recover(&mut self) {
        self.inner.recover();
    }
    fn emit(&mut self, io: &mut Io) {
        self.inner.emit(io);
    }
    fn absorb(&mut self, io: &mut Io) {
        self.inner.absorb(io);
    }
    fn rate_state(&self) -> [f64; 8] {
        self.inner.rate_state()
    }
    fn rehome(&mut self, state: [f64; 8], rate: f32) {
        self.inner.rehome(state, rate);
    }
    fn visit_events(&self, visit: &mut dyn FnMut(EventKind)) {
        for event in &self.events {
            visit(*event);
        }
        for note in &self.notes {
            visit(EventKind::Note(*note));
        }
    }
}

//! idMLab's Rust modules, run inside the native engine.
//!
//! An idMLab module makes one sample at a time and expects idMLab's engine to
//! do several things for it. [`Wrapped`] does them: it holds the knob values
//! (starting from the module's own defaults), applies modulation to them each
//! sample, hands the module its inputs and collects its outputs, and passes
//! on notes on their exact sample.
//!
//! One thing it does not do is idMLab's one-sample delay on every cable. In
//! the native engine a cable has no delay, so a chain arrives a sample per
//! cable sooner, and two paths of different lengths that meet again no longer
//! comb. The tests pin each of these against idMLab's own engine.
//!
//! idMLab's ports are single numbers: stereo is two ports side by side, and
//! which is which is written down only in idMLab's TypeScript. The table in
//! [`layout`] is that knowledge for the kinds carried so far.

use dsp_core::engine::{Frame, Module as LabModule, Ports, ProcessContext};
use dsp_core::modules::ModuleKind;
use dsp_core::samples::{Sample, SampleBank};
use engine_core::{EventKind, Io, Kind, Module, NoteEvent, NoteKind, SoundData, Thing};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum WrapError {
    /// A kind the adapter does not carry yet: the mixer and the DP/4 machine
    /// (no layout table yet), the Prism effects and the Grain Engine (the
    /// native app takes those from prism-fx and MultiGrainLive directly), and
    /// idMLab's own input and output.
    NotYet(ModuleKind),
}

/// The most audio inputs, or modulated knobs, one wrapped module may have.
const MAX_PORTS: usize = 16;

const NO_SOUND: &[f32] = &[];

/// How a kind's mono ports pair up into cables.
struct Layout {
    /// Each stereo audio input: its left and right port.
    ins: Vec<(usize, usize)>,
    /// Each stereo audio output.
    outs: Vec<(usize, usize)>,
    /// Outputs that are modulation, not sound.
    control_outs: Vec<usize>,
    /// It is played by notes.
    notes: bool,
    /// The knob idMLab uses to fade the module in. It starts at 0, so the
    /// module is silent until it is raised; the adapter raises it to full,
    /// since the native engine has fades of its own.
    level: Option<usize>,
}

fn layout(kind: ModuleKind) -> Option<Layout> {
    use ModuleKind::*;
    let effect = |level: Option<usize>| Layout {
        ins: vec![(0, 1)],
        outs: vec![(0, 1)],
        control_outs: vec![],
        notes: false,
        level,
    };
    Some(match kind {
        Gain => effect(Some(1)),
        Delay => effect(Some(3)),
        Bitcrusher => effect(Some(3)),
        Limiter => effect(Some(3)),
        Reverb => effect(Some(4)),
        Compressor => effect(Some(7)),
        Eq => effect(Some(8)),
        Blackhole => effect(Some(10)),
        Dp4NonLin => effect(Some(16)),
        Dp4Reverb => effect(Some(17)),
        // The widener calls its fade handle FADE, not LEVEL.
        Widener => effect(Some(2)),
        Synth => Layout { ins: vec![], outs: vec![(0, 1)], control_outs: vec![], notes: true, level: Some(0) },
        Lfo => Layout { ins: vec![], outs: vec![], control_outs: vec![0], notes: false, level: None },
        EnvelopeFollower => {
            Layout { ins: vec![(0, 1)], outs: vec![], control_outs: vec![0], notes: false, level: None }
        }
        GateAdsr => Layout { ins: vec![], outs: vec![], control_outs: vec![0], notes: true, level: None },
        // The samplers: played by notes, reading the sounds handed to them
        // ([`LabSound`]) from the bank the adapter lends them.
        Percussion => Layout { ins: vec![], outs: vec![(0, 1)], control_outs: vec![], notes: true, level: Some(3) },
        Looper | Granular => {
            Layout { ins: vec![], outs: vec![(0, 1)], control_outs: vec![], notes: true, level: Some(8) }
        }
        HostInput | AudioOutput | GrainEngine | Mixer | Dp4Machine | Prism => {
            return None
        }
    })
}

/// A sound for one of a sampler's slots, handed to the module with
/// `Controller::give(module, 0, thing)`. Built on the app's thread; the
/// module keeps the sound in its own bank under the slot's number, points the
/// slot at it, and sends this box back holding the sound it replaced (or the
/// new one, if the slot is past the bank's room), to be freed there. Slots
/// run from 0 to `dsp_core::sampler::SLOT_COUNT`; the kit and the looper play
/// the slot of a note's number, the grain cloud the slot it was last given.
pub struct LabSound {
    pub slot: u32,
    pub sample: Option<Sample>,
}

impl LabSound {
    pub fn new(slot: u32, sample: Sample) -> Box<LabSound> {
        Box::new(LabSound { slot, sample: Some(sample) })
    }

    /// One of the native engine's sounds, copied into idMLab's layout.
    pub fn from_sound(slot: u32, sound: &SoundData) -> Option<Box<LabSound>> {
        let frames = sound.frames();
        Sample::from_channels(sound.rate, &[&sound.l[..frames], &sound.r[..frames]]).map(|sample| Self::new(slot, sample))
    }
}

/// A kit pad's gain, pan and choke group (`set_slot_shape`), handed over as
/// [`LabSound`] is and sent straight back.
pub struct LabPad {
    pub slot: u32,
    pub gain: f32,
    pub pan: f32,
    pub choke: i32,
}

/// How many sounds a wrapped module's bank holds: one per sampler slot.
const SOUND_SLOTS: usize = dsp_core::sampler::SLOT_COUNT;

/// A control cable turning a knob: `knob + cable × scale`, held inside
/// `min..=max`. idMLab calls this a route.
#[derive(Clone)]
struct Route {
    param: usize,
    scale: f32,
    min: f32,
    max: f32,
}

/// One idMLab module as a module of the native engine.
///
/// Its inputs, in order: each stereo audio input; a note input if it is
/// played by notes; then one control input for each [`Wrapped::route`].
/// Its outputs: each stereo audio output, then each modulation output.
pub type WrappedState = engine_core::Preset<Wrapped>;

pub struct Wrapped {
    preset: Box<WrappedState>,
    kind: ModuleKind,
    variant: u32,
    module: Box<dyn LabModule>,
    layout: Layout,
    ins: Vec<Frame>,
    outs: Vec<Frame>,
    /// The knobs as set, and as modulated for the sample being made.
    params: Vec<f32>,
    modulated: Vec<f32>,
    routes: Vec<Route>,
    bank: SampleBank,
    rate: f32,
}

impl Wrapped {
    /// Build one. `variant` is idMLab's structural choice for the kinds that
    /// have one (the DP/4's algorithm), 0 otherwise.
    pub fn new(kind: ModuleKind, variant: u32, rate: f32) -> Result<Wrapped, WrapError> {
        let layout = layout(kind).ok_or(WrapError::NotYet(kind))?;
        let mut module = kind.build_variant_at(variant, rate);
        // As idMLab's engine does when a module is added. Then the tables a
        // note would otherwise compute in the callback, here instead.
        module.set_sample_rate(rate);
        module.build_tables();
        let (in_count, out_count) = (module.input_count(), module.output_count());
        let fits = layout.ins.len() <= MAX_PORTS
            && layout.ins.iter().all(|&(l, r)| l < in_count && r < in_count)
            && layout.outs.iter().all(|&(l, r)| l < out_count && r < out_count)
            && layout.control_outs.iter().all(|&c| c < out_count);
        if !fits {
            return Err(WrapError::NotYet(kind));
        }
        let mut params: Vec<f32> = (0..module.param_count()).map(|i| module.param_default(i)).collect();
        if let Some(level) = layout.level {
            if let Some(value) = params.get_mut(level) {
                *value = 1.0;
            }
        }
        Ok(Wrapped {
            preset: Box::new(WrappedState::new(&[])),
            kind, variant,
            module,
            layout,
            ins: vec![Frame::default(); in_count],
            outs: vec![Frame::default(); out_count],
            modulated: params.clone(),
            params,
            routes: Vec::new(),
            // Room for every slot now, so a sound handed over while it plays
            // never makes the bank grow.
            bank: SampleBank::with_slots(SOUND_SLOTS),
            rate,
        })
    }

    /// Set a knob before the module is added to a patch.
    pub fn set(mut self, param: usize, value: f32) -> Wrapped {
        if let Some(slot) = self.params.get_mut(param) {
            *slot = value;
        }
        self
    }

    /// Give a knob a control input. Call it once per modulated knob, before
    /// the module is added; the inputs come in the order of the calls.
    pub fn route(mut self, param: usize, scale: f32, min: f32, max: f32) -> Wrapped {
        if param < self.params.len() && self.routes.len() < MAX_PORTS {
            self.routes.push(Route { param, scale, min, max });
        }
        self
    }

    pub fn param_count(&self) -> usize {
        self.params.len()
    }

    fn note(&mut self, event: &NoteEvent) {
        match event.kind {
            NoteKind::On => self.module.note_on(event.note, event.velocity, event.detune_cents),
            NoteKind::Off => self.module.note_off(event.note),
            NoteKind::AllOff => self.module.all_notes_off(),
        }
    }
}

impl Module for Wrapped {
    fn preset_type(&self)->Option<std::any::TypeId> {Some(std::any::TypeId::of::<WrappedState>())}
    fn visit_preset(&self,thing:&engine_core::Thing,visit:&mut dyn FnMut(EventKind)) {WrappedState::visit(thing,visit);}

    fn transfer(&mut self,from:&dyn Module,_rate:f32) {
        if let Some(from)=(from as &dyn std::any::Any).downcast_ref::<Self>() {self.preset.inherit(&from.preset);}
    }
    fn factory(&self) -> Option<engine_core::ModuleFactory> {
        let (kind, variant) = (self.kind, self.variant);
        let params = self.params.clone(); let routes = self.routes.clone();
        Some(Box::new(move |rate, _| {
            let mut module = Wrapped::new(kind, variant, rate).unwrap();
            module.params.clone_from(&params); module.routes.clone_from(&routes);
            Box::new(module)
        }))
    }
    fn inputs(&self) -> Vec<Kind> {
        let mut kinds = vec![Kind::Audio; self.layout.ins.len()];
        if self.layout.notes {
            kinds.push(Kind::Notes);
        }
        kinds.extend(self.routes.iter().map(|_| Kind::Control));
        kinds
    }

    fn outputs(&self) -> Vec<Kind> {
        let mut kinds = vec![Kind::Audio; self.layout.outs.len()];
        kinds.extend(self.layout.control_outs.iter().map(|_| Kind::Control));
        kinds
    }

    fn prepare(&mut self, rate: f32, _max_block: usize) {
        if rate != self.rate {
            self.rate = rate;
            self.module.set_sample_rate(rate);
            self.module.build_tables();
        }
    }

    fn handle(&mut self, event: &EventKind) {
        if let EventKind::Param {index,value}=*event {self.preset.update(index,value);}
        match *event {
            EventKind::Param { index, value } => {
                if let Some(slot) = self.params.get_mut(index as usize) {
                    *slot = value;
                }
            }
            EventKind::Note(note) => self.note(&note),
            EventKind::Sound { .. } => {}
        }
    }

    fn take(&mut self,slot:u32,thing:engine_core::Thing)->Option<engine_core::Thing> {
        if slot==engine_core::PRESET {
            let incoming=match thing.downcast::<WrappedState>() {Ok(state)=>state,Err(other)=>return Some(other)};
            let (old,controls)=WrappedState::exchange(&mut self.preset,incoming);
            for &(index,value) in &controls {self.handle(&EventKind::Param {index,value});}
            self.preset.restore(controls);
            return Some(old as engine_core::Thing);
        }
        // Nothing here allocates or frees: the sound moves into the bank, and
        // the box goes back with whatever it replaced.
        let thing = match thing.downcast::<LabSound>() {
            Ok(mut sound) => {
                if let Some(sample) = sound.sample.take() {
                    match self.bank.put(sound.slot, sample) {
                        Ok(old) => {
                            self.module.set_sample_slot(sound.slot, sound.slot);
                            sound.sample = old;
                        }
                        Err(back) => sound.sample = Some(back),
                    }
                }
                return Some(sound as Thing);
            }
            Err(other) => other,
        };
        match thing.downcast::<LabPad>() {
            Ok(pad) => {
                self.module.set_slot_shape(pad.slot, pad.gain, pad.pan, pad.choke);
                Some(pad as Thing)
            }
            Err(other) => Some(other),
        }
    }
    fn process(&mut self, io: &mut Io) {
        let audio_ins = self.layout.ins.len();
        let mut sound = [(NO_SOUND, NO_SOUND); MAX_PORTS];
        for (k, pair) in sound.iter_mut().enumerate().take(audio_ins) {
            *pair = io.ins.audio(k);
        }
        let notes: &[NoteEvent] = if self.layout.notes { io.ins.notes(audio_ins) } else { &[] };
        let first_route = audio_ins + self.layout.notes as usize;
        let mut turn = [NO_SOUND; MAX_PORTS];
        for (k, values) in turn.iter_mut().enumerate().take(self.routes.len()) {
            *values = io.ins.control(first_route + k);
        }
        let sample_time = 1.0 / self.rate;
        let mut next_note = 0;

        for i in 0..io.n {
            while next_note < notes.len() && notes[next_note].offset as usize <= i {
                let note = notes[next_note];
                self.note(&note);
                next_note += 1;
            }
            for (k, &(l, r)) in self.layout.ins.iter().enumerate() {
                self.ins[l].values[0] = sound[k].0[i];
                self.ins[l].channels = 1;
                self.ins[r].values[0] = sound[k].1[i];
                self.ins[r].channels = 1;
            }
            // Modulation, with idMLab's own arithmetic: every cable is added
            // first, then each knob is held inside its limits.
            let params: &[f32] = if self.routes.is_empty() {
                &self.params
            } else {
                self.modulated.copy_from_slice(&self.params);
                for (k, route) in self.routes.iter().enumerate() {
                    self.modulated[route.param] += turn[k][i] * route.scale;
                }
                for route in &self.routes {
                    let value = self.modulated[route.param];
                    self.modulated[route.param] =
                        if value.is_finite() { dsp_core::clamp(value, route.min, route.max) } else { route.min };
                }
                &self.modulated
            };
            let ctx = ProcessContext {
                samples: &self.bank,
                sample_rate: self.rate,
                sample_time,
                frame: io.frame + i as u64,
            };
            self.module.process(&ctx, &mut Ports { inputs: &self.ins, outputs: &mut self.outs, params });

            for (k, &(l, r)) in self.layout.outs.iter().enumerate() {
                let (left, right) = io.outs.audio(k);
                left[i] = self.outs[l].sum();
                right[i] = self.outs[r].sum();
            }
            let first_control = self.layout.outs.len();
            for (k, &port) in self.layout.control_outs.iter().enumerate() {
                io.outs.control(first_control + k)[i] = self.outs[port].sum();
            }
        }
    }
}

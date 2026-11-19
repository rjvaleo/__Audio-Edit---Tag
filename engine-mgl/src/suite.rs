//! One of prism-fx's suites as a module: a reverb, say, with its modes.
//!
//! The module is prism-fx's own suite module (`suite::ModuleKernel`), which
//! runs one mode and crossfades to another over 20 ms. A mode's effect is
//! made by the app, on its thread, and handed over; the effect of the mode
//! it left goes back in the same box.

use engine_core::{EventKind, Io, Kind, Module, Thing};
use prism_fx::suite::{find_mode, Mode, ModuleKernel};
use prism_fx::DynKernel;

/// What a suite module is handed while it plays (`Controller::give`, slot 0).
pub enum SuiteThing {
    /// Switch to this mode, with the effect for it already made. The modes
    /// crossfade over 20 ms.
    Mode(&'static Mode, Box<dyn DynKernel>),
    /// On its way back: the effect of the mode it switched from.
    Old(Box<dyn DynKernel>),
    /// What a box holds once the module has taken its contents.
    Taken,
}

impl SuiteThing {
    /// A switch to `mode` of `suite`, its effect made here, on the app's
    /// thread, for `rate` (the engine's). None if there is no such mode.
    pub fn mode(suite: &str, mode: &str, rate: f32) -> Option<SuiteThing> {
        let mode = find_mode(suite, mode)?;
        let kernel = (prism_fx::find(mode.kernel)?.make)(rate);
        Some(SuiteThing::Mode(mode, kernel))
    }
}

/// A suite. Input 0 and output 0 are audio; knob numbers are those of the
/// mode that is running (the one coming in, during a switch).
pub struct Suite {
    module: ModuleKernel,
    rate: f32,
    /// A switch that could not start yet (the one before it is still
    /// fading), in its box, tried again before every piece of audio.
    waiting: Option<Box<SuiteThing>>,
    /// The box of the switch now fading, kept to carry the old mode's
    /// effect back once the fade is over.
    carrier: Option<Box<SuiteThing>>,
    /// A box finished with, on its way back.
    done: Option<Box<SuiteThing>>,
}

impl Suite {
    /// `suite` running `mode`, made for `rate`. None if there is no such
    /// suite or mode.
    pub fn new(suite: &str, mode: &str, rate: f32) -> Option<Suite> {
        let module = ModuleKernel::new(find_mode(suite, mode)?, rate)?;
        Some(Suite {
            module,
            rate,
            waiting: None,
            carrier: None,
            done: None,
        })
    }

    /// Start with a knob at this value.
    pub fn set(mut self, param: usize, value: f32) -> Suite {
        self.module.set_param(param, value);
        self
    }

    /// Start the switch in the box if the module will have it now. The box
    /// comes back if it is not wanted at all; otherwise it stays here, as
    /// the carrier of a switch that has begun or as one waiting its turn.
    fn begin(&mut self, mut boxed: Box<SuiteThing>) -> Option<Box<SuiteThing>> {
        let SuiteThing::Mode(mode, next) = std::mem::replace(&mut *boxed, SuiteThing::Taken) else {
            return Some(boxed);
        };
        // The module refuses a switch while one is fading or its old effect
        // has not been taken away; with no carrier free there is nothing to
        // take that one away in, either.
        if self.carrier.is_some() {
            *boxed = SuiteThing::Mode(mode, next);
            return self.waiting.replace(boxed);
        }
        match self.module.begin_switch(mode, next) {
            Ok(()) => {
                self.carrier = Some(boxed);
                None
            }
            Err(next) => {
                *boxed = SuiteThing::Mode(mode, next);
                self.waiting.replace(boxed)
            }
        }
    }
}

impl Module for Suite {
    fn inputs(&self) -> Vec<Kind> {
        vec![Kind::Audio]
    }
    fn outputs(&self) -> Vec<Kind> {
        vec![Kind::Audio]
    }
    fn latency(&self) -> usize {
        self.module.latency_frames() as usize
    }
    fn tail(&self) -> usize {
        let seconds = self.module.tail_seconds();
        if seconds.is_finite() && seconds >= 0.0 {
            (seconds as f64 * self.rate as f64)
                .ceil()
                .min(usize::MAX as f64) as usize
        } else {
            usize::MAX
        }
    }
    fn prepare(&mut self, _rate: f32, _max_block: usize) {
        self.module.reset();
    }
    fn handle(&mut self, event: &EventKind) {
        if let EventKind::Param { index, value } = *event {
            self.module.set_param(index as usize, value);
        }
    }
    fn process(&mut self, io: &mut Io) {
        if self.done.is_none() {
            if let Some(waiting) = self.waiting.take() {
                self.done = self.begin(waiting);
            }
        }
        let (in_l, in_r) = io.ins.audio(0);
        let (l, r) = io.outs.audio(0);
        l.copy_from_slice(in_l);
        r.copy_from_slice(in_r);
        self.module.process(l, r);
        // The fade over, the old mode's effect goes back in the box that
        // brought the new one.
        if self.done.is_none() && self.carrier.is_some() {
            if let Some(old) = self.module.take_retired() {
                let mut carrier = self.carrier.take().expect("checked just above");
                *carrier = SuiteThing::Old(old);
                self.done = Some(carrier);
            }
        }
    }
    fn take(&mut self, _slot: u32, thing: Thing) -> Option<Thing> {
        match thing.downcast::<SuiteThing>() {
            Ok(boxed) => self.begin(boxed).map(|boxed| boxed as Thing),
            Err(other) => Some(other),
        }
    }
    fn finished(&mut self) -> Option<Thing> {
        self.done.take().map(|boxed| boxed as Thing)
    }
}

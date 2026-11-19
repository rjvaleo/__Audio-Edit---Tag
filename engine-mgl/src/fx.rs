//! Any effect in prism-fx's catalogue as a module.

use engine_core::{EventKind, Io, Kind, Module};
use prism_fx::place::{Place, PlaceSettings};
use prism_fx::{Descriptor, DynKernel};

/// One effect from prism-fx's catalogue. Input 0 and output 0 are audio; knob
/// numbers are the effect's own parameter numbers.
///
/// The effect allocates everything when it is made and when it is handed a
/// sound, both before the module goes into the patch.
pub type FxState = engine_core::Preset<Fx>;

pub struct Fx {
    preset: Box<FxState>,
    kernel: Box<dyn DynKernel>,
    rate: f32,
    sound_recipe: Option<(std::sync::Arc<[f32]>, usize, f32)>,
    /// prism-fx's Place around the effect, if it was `placed`.
    place: Option<Place>,
}

impl Fx {
    /// Knob numbers past the effect's own, for an effect that is `placed`:
    /// on (1) or off (0); the shape, by its number in prism-fx's list; the
    /// place's size in metres; position, -100 (left) to 100; distance and
    /// height, 0 to 100; and the spread of the effect's output, 0 to 200%.
    pub const PLACE_ON: u32 = 1 << 16;
    pub const PLACE_SHAPE: u32 = Self::PLACE_ON + 1;
    pub const PLACE_SIZE: u32 = Self::PLACE_ON + 2;
    pub const PLACE_POSITION: u32 = Self::PLACE_ON + 3;
    pub const PLACE_DISTANCE: u32 = Self::PLACE_ON + 4;
    pub const PLACE_HEIGHT: u32 = Self::PLACE_ON + 5;
    pub const PLACE_SPREAD: u32 = Self::PLACE_ON + 6;

    /// The effect with that catalogue id, at its defaults, made for `rate`
    /// (the engine's). None when the catalogue has no such effect.
    pub fn new(id: &str, rate: f32) -> Option<Fx> {
        prism_fx::make(id, rate).map(|kernel| Fx {
            preset: Box::new(FxState::new(&[])),
            kernel,
            rate,
            sound_recipe: None,
            place: None,
        })
    }

    /// Start with a knob at this value, in the effect's own units.
    pub fn set(mut self, param: usize, value: f32) -> Fx {
        self.kernel.set_param(param, value);
        self
    }

    /// Hand the effect its sound (an impulse, a grain source), interleaved.
    /// Effects that take none ignore it.
    pub fn sound(mut self, samples: &[f32], channels: usize, rate: f32) -> Fx {
        self.sound_recipe = Some((samples.into(), channels, rate));
        self.kernel.set_sound(samples, channels, rate);
        self
    }

    /// Put the effect in a place: prism-fx's Place around it, as MGL's rack
    /// puts one around a reverb. Its controls are the `PLACE_` knobs; it
    /// starts switched off, and off it changes nothing at all.
    pub fn placed(mut self) -> Fx {
        // Place is made for the effect's own rate. It allocates its memory
        // here, before the module goes into the patch.
        let mut place = Place::new(self.rate);
        place.set(PlaceSettings {
            on: false,
            ..PlaceSettings::default()
        });
        self.place = Some(place);
        self
    }

    /// The effect's name, controls and ranges.
    pub fn descriptor(&self) -> &'static Descriptor {
        self.kernel.descriptor()
    }
}

impl Module for Fx {
    fn preset_type(&self)->Option<std::any::TypeId> {Some(std::any::TypeId::of::<FxState>())}
    fn visit_preset(&self,thing:&engine_core::Thing,visit:&mut dyn FnMut(EventKind)) {FxState::visit(thing,visit);}

    fn parallel_weight(&self) -> usize {
        // Measured eight-branch break-even on the native bench. Eight units
        // admit 128-frame levels; two defer until 512. Cheap reverbs stay
        // serial, as do unaudited kernels. These are scheduling hints only.
        match self.kernel.descriptor().id {
            "dattorro-plate" | "lxp-chamber" | "lxp-hall" | "lxp-plate" |
            "lxp-room" | "sm-cirrus-major" | "sm-lmc" => 8,
            "spectral-dynamics" | "convolution" | "ambient-fdn" | "freeverb" |
            "hp-hall" | "hp-medium-room" | "moorer-reverb" | "sm-andromeda" |
            "sm-capricorn" | "sm-centaurus" | "sm-cirrus-minor" | "sm-gemini" |
            "sm-great-annihilator" | "sm-hydra" | "sm-lyra" |
            "sm-sagittarius" | "sm-triangulum" => 2,
            _ => 0,
        }
    }
    fn transfer(&mut self,from:&dyn Module,_rate:f32) {
        if let Some(from)=(from as &dyn std::any::Any).downcast_ref::<Self>() {self.preset.inherit(&from.preset);}
    }
    fn factory(&self) -> Option<engine_core::ModuleFactory> {
        let id = self.kernel.descriptor().id;
        let params: Vec<_> = (0..self.kernel.descriptor().params.len()).map(|i| self.kernel.param(i)).collect();
        let placed = self.place.as_ref().map(|place| place.settings());
        let sound = self.sound_recipe.clone();
        Some(Box::new(move |rate, _| {
            let mut module = Fx::new(id, rate).unwrap();
            for (i, value) in params.iter().enumerate() { module.kernel.set_param(i, *value); }
            if let Some((samples, channels, rate)) = &sound { module = module.sound(samples, *channels, *rate); }
            if let Some(settings) = placed { module = module.placed(); module.place.as_mut().unwrap().set(settings); }
            Box::new(module)
        }))
    }
    fn inputs(&self) -> Vec<Kind> {
        vec![Kind::Audio]
    }
    fn outputs(&self) -> Vec<Kind> {
        vec![Kind::Audio]
    }
    fn latency(&self) -> usize {
        self.kernel.latency_frames() as usize
    }
    fn tail(&self) -> usize {
        let seconds = self.kernel.tail_seconds();
        if seconds.is_finite() && seconds >= 0.0 {
            (seconds as f64 * self.rate as f64)
                .ceil()
                .min(usize::MAX as f64) as usize
        } else {
            usize::MAX
        }
    }
    fn can_sleep(&self) -> bool {
        // Audited algebra only: no signal history, clock or parameter glide.
        // These mappings preserve positive-zero silence at every setting.
        self.place.is_none() && matches!(self.kernel.descriptor().id, "gain" | "swap" | "width" | "hp-ms-matrix")
    }
    /// Going into the patch: the knobs set so far are where the effect
    /// starts, with no glide up to them.
    fn prepare(&mut self, _rate: f32, _max_block: usize) {
        self.kernel.reset();
        if let Some(place) = self.place.as_mut() {
            place.reset();
        }
    }
    fn handle(&mut self, event: &EventKind) {
        if let EventKind::Param {index,value}=*event {self.preset.update(index,value);}
        let EventKind::Param { index, value } = *event else {
            return;
        };
        if index < Self::PLACE_ON {
            self.kernel.set_param(index as usize, value);
            return;
        }
        let Some(place) = self.place.as_mut() else {
            return;
        };
        let mut s = place.settings();
        match index {
            Self::PLACE_ON => s.on = value >= 0.5,
            Self::PLACE_SHAPE => s.shape = value.max(0.0) as u8,
            Self::PLACE_SIZE => s.size_m = value,
            Self::PLACE_POSITION => s.pos = value,
            Self::PLACE_DISTANCE => s.dist = value,
            Self::PLACE_HEIGHT => s.height = value,
            Self::PLACE_SPREAD => s.spread = value,
            _ => return,
        }
        place.set(s);
    }
    fn recover(&mut self) {
        self.kernel.reset();
    }
    fn take(&mut self,slot:u32,thing:engine_core::Thing)->Option<engine_core::Thing> {
        if slot==engine_core::PRESET {
            let incoming=match thing.downcast::<FxState>() {Ok(state)=>state,Err(other)=>return Some(other)};
            let (old,controls)=FxState::exchange(&mut self.preset,incoming);
            for &(index,value) in &controls {self.handle(&EventKind::Param {index,value});}
            self.preset.restore(controls);
            return Some(old as engine_core::Thing);
        }
        Some(thing)
    }
    fn process(&mut self, io: &mut Io) {
        let (in_l, in_r) = io.ins.audio(0);
        let (l, r) = io.outs.audio(0);
        l.copy_from_slice(in_l);
        r.copy_from_slice(in_r);
        match self.place.as_mut() {
            // As prism-fx says a host runs it: the place before the effect,
            // and the spread of the effect's output after.
            Some(place) => {
                place.before(l, r);
                self.kernel.process(l, r);
                place.after(l, r);
            }
            None => self.kernel.process(l, r),
        }
    }
}

//! Effects from `prism-fx`, the crate this program shares with idMLab.
//!
//! A prism effect is a stereo kernel that takes planar blocks and parameters
//! by index. This program's rack hands out interleaved blocks of any width and
//! names parameters by key, so [`PrismEffect`] sits between the two:
//!
//! - It splits each block into two preallocated planar buffers, runs the
//!   kernel, and interleaves the result back. A block longer than the buffers
//!   goes through in pieces, so nothing allocates while running.
//! - A mono file is fed to both sides and keeps the left. Channels past the
//!   second pass through untouched.
//! - Keys map to indices through the crate's descriptor, and the crate's table
//!   is served as this program's [`ParamSpec`]s, converted once and kept.
//!
//! In a rack document a prism effect's kind is `prism:<id>`. See SHARED-FX.md.

pub use prism_fx;

use crate::params::{ParamSpec, Params};
use crate::Effect;
use prism_fx::{Descriptor, DynKernel, Entry, SoundInput};
use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};

/// Frames per piece. A rack block is usually 512 or 1024.
const PIECE: usize = 1024;

/// What a document's kind is called for a prism effect, before its id.
const KIND_PREFIX: &str = "prism:";

/// Kinds this program used before an effect moved into `prism-fx`, and the
/// effect each one now is. Documents keep opening.
const MOVED: &[(&str, &str)] = &[("dattorro_echo", "echo")];

/// Every prism effect, in the crate's order.
pub fn catalogue() -> &'static [Entry] {
    prism_fx::CATALOG
}

pub fn descriptor(id: &str) -> Option<&'static Descriptor> {
    prism_fx::find(id).map(|e| e.descriptor)
}

/// A prism effect's parameters as this program describes parameters.
pub fn specs(id: &str) -> Option<&'static [ParamSpec]> {
    let i = catalogue().iter().position(|e| e.descriptor.id == id)?;
    Some(tables()[i].specs)
}

/// The kind a rack document stores for this effect: `prism:<id>`.
pub fn kind(id: &str) -> Option<&'static str> {
    let i = catalogue().iter().position(|e| e.descriptor.id == id)?;
    Some(tables()[i].kind)
}

/// The effect a stored kind names: `prism:<id>`, or the kind of an effect
/// that has since moved here.
pub fn id_for_kind(kind: &str) -> Option<&'static str> {
    let id = match kind.strip_prefix(KIND_PREFIX) {
        Some(id) => id,
        None => MOVED.iter().find(|(old, _)| *old == kind)?.1,
    };
    descriptor(id).map(|d| d.id)
}

/// A value this effect's control can hold: in range, and whole where the
/// control is a count or a choice. `None` for a control it does not have.
pub fn clamp(id: &str, key: &str, value: f32) -> Option<f32> {
    descriptor(id)?.spec(key).map(|s| s.clamp(value))
}

/// Build one with these values, the way `shape::make` builds a shaper.
pub fn make(id: &str, sample_rate: u32, channels: usize, params: &[(String, f32)]) -> Option<Box<dyn Effect>> {
    make_with_sound(id, sample_rate, channels, params, None)
}

/// The same, handing over the sound remembered under `sound` if the effect
/// takes one. A name nobody remembered leaves it without: a convolution then
/// passes its input through.
pub fn make_with_sound(
    id: &str,
    sample_rate: u32,
    _channels: usize,
    params: &[(String, f32)],
    sound_name: Option<&str>,
) -> Option<Box<dyn Effect>> {
    let mut e = PrismEffect::new(id, sample_rate)?;
    for (k, v) in params {
        e.set(k, *v);
    }
    if let Some(s) = sound_name.filter(|_| sound_input(id).is_some()).and_then(sound) {
        e.set_sound(&s);
    }
    Some(Box::new(e))
}

/// An effect this program used to build itself, now built here: as its
/// kernel was made, with only the controls given set (`PrismEffect::as_built`).
/// `tests/prism_parity.rs` holds each one to the render this program's own
/// made, bit for bit.
pub fn moved(id: &str, sample_rate: u32, params: &[(String, f32)]) -> Option<Box<dyn Effect>> {
    let mut e = PrismEffect::as_built(id, sample_rate)?;
    for (k, v) in params {
        e.set(k, *v);
    }
    Some(Box::new(e))
}

/// What sound, if any, this effect takes as well as its input.
pub fn sound_input(id: &str) -> Option<SoundInput> {
    descriptor(id)?.sound
}

/// A sound handed to an effect: interleaved, at its own rate.
#[derive(Clone)]
pub struct Sound {
    pub samples: Arc<Vec<f32>>,
    pub channels: usize,
    pub rate: f32,
}

/// The sounds effects have been given, by the name the host knows them by
/// (a library path). Filled when a rack is stored, read when one is built, so
/// nothing is decoded while the chain is being made for playback.
fn sounds() -> &'static Mutex<HashMap<String, Sound>> {
    static SOUNDS: OnceLock<Mutex<HashMap<String, Sound>>> = OnceLock::new();
    SOUNDS.get_or_init(|| Mutex::new(HashMap::new()))
}

pub fn remember_sound(name: &str, sound: Sound) {
    if let Ok(mut m) = sounds().lock() {
        m.insert(name.to_string(), sound);
    }
}

pub fn sound(name: &str) -> Option<Sound> {
    sounds().lock().ok()?.get(name).cloned()
}

struct Table {
    kind: &'static str,
    specs: &'static [ParamSpec],
}

/// Converted once, on first use, and kept for the life of the program: the
/// rack asks for `specs()` from the audio thread and it must not allocate.
fn tables() -> &'static [Table] {
    static TABLES: OnceLock<Vec<Table>> = OnceLock::new();
    TABLES.get_or_init(|| {
        catalogue()
            .iter()
            .map(|e| {
                let d = e.descriptor;
                let specs: Vec<ParamSpec> = d
                    .params
                    .iter()
                    .map(|p| ParamSpec {
                        key: p.key,
                        label: p.label,
                        min: p.min,
                        max: p.max,
                        default: p.default,
                        log: p.log,
                        unit: p.unit,
                    })
                    .collect();
                Table {
                    kind: Box::leak(format!("{KIND_PREFIX}{}", d.id).into_boxed_str()),
                    specs: Box::leak(specs.into_boxed_slice()),
                }
            })
            .collect()
    })
}

/// A prism kernel as an [`Effect`].
pub struct PrismEffect {
    kernel: Box<dyn DynKernel>,
    specs: &'static [ParamSpec],
    left: Vec<f32>,
    right: Vec<f32>,
}

impl PrismEffect {
    pub fn new(id: &str, sample_rate: u32) -> Option<Self> {
        let mut kernel = prism_fx::make(id, sample_rate as f32)?;
        // Every control at its declared default, as the rack sets them. A few
        // kernels start elsewhere, as their originals did (the Dattorro
        // flanger and vibrato at 0.55 Hz against a declared 0.3); only those
        // controls are told, as telling one is not always a no-op.
        for (i, spec) in kernel.descriptor().params.iter().enumerate() {
            if kernel.param(i) != spec.default {
                kernel.set_param(i, spec.default);
            }
        }
        Some(PrismEffect { kernel, specs: specs(id)?, left: vec![0.0; PIECE], right: vec![0.0; PIECE] })
    }

    /// One left as its kernel was made, without its controls told their
    /// declared defaults. For an effect that has moved here from this
    /// program's own: those built it and set only the controls a document
    /// stored, so a control nobody stored stayed where the effect started —
    /// the Dattorro flanger and vibrato at the chorus's 0.55 Hz, 0.12 feedback
    /// and linear reads, as the kernels reproduce.
    pub fn as_built(id: &str, sample_rate: u32) -> Option<Self> {
        let kernel = prism_fx::make(id, sample_rate as f32)?;
        Some(PrismEffect { kernel, specs: specs(id)?, left: vec![0.0; PIECE], right: vec![0.0; PIECE] })
    }

    pub fn id(&self) -> &'static str {
        self.kernel.descriptor().id
    }

    /// Hand over the effect's sound. May allocate: not on the audio thread.
    pub fn set_sound(&mut self, sound: &Sound) {
        self.kernel.set_sound(&sound.samples, sound.channels, sound.rate);
    }
}

impl Effect for PrismEffect {
    fn process(&mut self, buf: &mut [f32], channels: usize, _sample_rate: u32) {
        let width = channels.max(1);
        // One channel, where the effect does something of its own with it.
        if width == 1 && self.kernel.has_mono() {
            for sample in buf.iter_mut() {
                self.kernel.tick_mono(sample);
            }
            return;
        }
        for piece in buf.chunks_mut(PIECE * width) {
            let frames = piece.len() / width;
            for (i, frame) in piece.chunks_exact(width).enumerate() {
                self.left[i] = frame[0];
                self.right[i] = if width > 1 { frame[1] } else { frame[0] };
            }
            self.kernel.process(&mut self.left[..frames], &mut self.right[..frames]);
            for (i, frame) in piece.chunks_exact_mut(width).enumerate() {
                frame[0] = self.left[i];
                if width > 1 {
                    frame[1] = self.right[i];
                }
            }
        }
    }

    fn reset(&mut self) {
        self.kernel.reset();
    }

    fn name(&self) -> &'static str {
        self.kernel.descriptor().label
    }

    fn set_param(&mut self, key: &str, value: f32) -> bool {
        self.set(key, value)
    }

    fn get_param(&self, key: &str) -> Option<f32> {
        self.get(key)
    }

    fn telemetry(&self) -> f32 {
        self.kernel.telemetry()
    }
}

impl Params for PrismEffect {
    fn specs(&self) -> &'static [ParamSpec] {
        self.specs
    }

    fn get(&self, key: &str) -> Option<f32> {
        self.kernel.descriptor().index_of(key).map(|i| self.kernel.param(i))
    }

    fn set(&mut self, key: &str, value: f32) -> bool {
        match self.kernel.descriptor().index_of(key) {
            Some(i) => {
                self.kernel.set_param(i, value);
                true
            }
            None => false,
        }
    }
}

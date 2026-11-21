//! Control-thread name resolution and audio-thread numeric dispatch.
use super::*;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Control {
    Effect(usize),
    Wet,
    Level,
    Place(usize),
}

/// A resolved slot control, including the old mode's index during a fade.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ParamIndex {
    control: Control,
    leaving: Option<usize>,
    local: usize,
    stepped: bool,
}
impl ParamIndex {
    pub fn same_control(self, other: Self) -> bool {
        self.control == other.control
    }
    pub fn is_stepped(self) -> bool {
        self.stepped
    }
}

/// Built and replaced on the control thread, alongside a slot or mode.
#[derive(Clone)]
pub struct ControlMap {
    entries: Vec<(String, ParamIndex)>,
    place: bool,
}
impl ControlMap {
    fn new(effect: &dyn Effect, place: bool) -> Self {
        let mut entries: Vec<_> = effect
            .parameter_keys()
            .into_iter()
            .enumerate()
            .map(|(i, key)| {
                let stepped = matches!(
                    key.as_str(),
                    "mode" | "notches" | "layers" | "fftSize" | "interpolation"
                );
                (
                    key.clone(),
                    ParamIndex {
                        control: Control::Effect(intern(&key)),
                        leaving: None,
                        local: i,
                        stepped,
                    },
                )
            })
            .collect();
        entries.push((
            SLOT_WET.into(),
            ParamIndex {
                control: Control::Wet,
                leaving: None,
                local: usize::MAX,
                stepped: false,
            },
        ));
        entries.push((
            SLOT_LEVEL.into(),
            ParamIndex {
                control: Control::Level,
                leaving: None,
                local: usize::MAX,
                stepped: false,
            },
        ));
        if place {
            entries.extend(PLACE_KEYS.iter().enumerate().map(|(i, key)| {
                (
                    key.to_string(),
                    ParamIndex {
                        control: Control::Place(i),
                        leaving: None,
                        local: usize::MAX,
                        stepped: false,
                    },
                )
            }));
        }
        Self { entries, place }
    }
    /// How many controls the slot has: its effect's, then wet and level, then
    /// Place's.
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// The slot's `n`th control, in the order `len` counts them, with its key.
    pub fn index(&self, n: usize) -> Option<(&str, ParamIndex)> {
        self.entries.get(n).map(|(k, i)| (k.as_str(), *i))
    }

    pub fn resolve(&self, key: &str) -> Option<ParamIndex> {
        self.entries
            .iter()
            .find(|(k, _)| k == key)
            .map(|(_, index)| *index)
    }
    /// Resolve both modes before their boxes are handed to the callback.
    pub fn switching_to(&self, effect: &dyn Effect) -> Self {
        let mut next = Self::new(effect, self.place);
        for (key, index) in &mut next.entries {
            if let Control::Effect(_) = index.control {
                index.leaving = self.resolve(key).and_then(|old| match old.control {
                    Control::Effect(_) if old.local != usize::MAX => Some(old.local),
                    _ => None,
                });
            }
        }
        for (key, old) in &self.entries {
            if let Control::Effect(id) = old.control {
                if next.resolve(key).is_none() {
                    next.entries.push((
                        key.clone(),
                        ParamIndex {
                            control: Control::Effect(id),
                            leaving: if old.local != usize::MAX {
                                Some(old.local)
                            } else {
                                old.leaving
                            },
                            local: usize::MAX,
                            stepped: old.stepped,
                        },
                    ));
                }
            }
        }
        next
    }
}

impl Rack {
    pub fn control_maps(&self) -> Vec<ControlMap> {
        self.slots
            .iter()
            .map(|s| ControlMap::new(s.effect.as_ref(), s.place.is_some()))
            .collect()
    }
    /// Resolve on the caller's thread; never in a render callback.
    pub fn param_index(&self, slot: usize, key: &str) -> Option<ParamIndex> {
        let s = self.slots.get(slot)?;
        let map = ControlMap::new(s.effect.as_ref(), s.place.is_some());
        if let Some(next) = &s.incoming {
            map.switching_to(next.as_ref()).resolve(key)
        } else {
            map.resolve(key)
        }
    }
    pub fn set_param_index(&mut self, slot: usize, index: ParamIndex, value: f32) -> bool {
        let Some(s) = self.slots.get_mut(slot) else {
            return false;
        };
        match index.control {
            Control::Wet => {
                s.set_wet(value);
                true
            }
            Control::Level => {
                s.set_level(value);
                true
            }
            Control::Place(i) => {
                let Some(p) = s.place.as_mut() else {
                    return false;
                };
                let mut settings = p.settings();
                if !place_set_index(&mut settings, i, value) {
                    return false;
                }
                p.set(settings);
                true
            }
            Control::Effect(i) => {
                if let Some(next) = &mut s.incoming {
                    if let Some(old) =
                        bound(s.effect.as_ref(), i, index.leaving.unwrap_or(usize::MAX))
                    {
                        s.effect.set_param_index(old, value);
                    }
                    match bound(next.as_ref(), i, index.local) {
                        Some(local) => next.set_param_index(local, value),
                        None => false,
                    }
                } else {
                    match bound(s.effect.as_ref(), i, index.local) {
                        Some(local) => s.effect.set_param_index(local, value),
                        None => false,
                    }
                }
            }
        }
    }
    pub fn get_param_index(&self, slot: usize, index: ParamIndex) -> Option<f32> {
        let s = self.slots.get(slot)?;
        match index.control {
            Control::Wet => Some(s.wet),
            Control::Level => Some(s.level_db),
            Control::Place(i) => s
                .place
                .as_ref()
                .and_then(|p| place_get_index(&p.settings(), i)),
            Control::Effect(i) => {
                let effect = s.incoming.as_ref().unwrap_or(&s.effect);
                effect.get_param_index(bound(effect.as_ref(), i, index.local)?)
            }
        }
    }
}

fn place_get_index(s: &prism::prism_fx::place::PlaceSettings, index: usize) -> Option<f32> {
    Some(match index {
        0 => {
            if s.on {
                1.0
            } else {
                0.0
            }
        }
        1 => s.shape as f32,
        2 => s.size_m,
        3 => s.pos,
        4 => s.dist,
        5 => s.height,
        6 => s.spread,
        _ => return None,
    })
}

fn place_set_index(s: &mut prism::prism_fx::place::PlaceSettings, index: usize, v: f32) -> bool {
    if !v.is_finite() {
        return false;
    }
    match index {
        0 => s.on = v >= 0.5,
        1 => s.shape = v.round().clamp(0.0, 5.0) as u8,
        2 => s.size_m = v.clamp(3.0, 80.0),
        3 => s.pos = v.clamp(-100.0, 100.0),
        4 => s.dist = v.clamp(0.0, 100.0),
        5 => s.height = v.clamp(0.0, 100.0),
        6 => s.spread = v.clamp(0.0, 200.0),
        _ => return false,
    }
    true
}

// Names are interned only while slots are built, never while audio runs. The
// process-local ID lets two modes put the same key at different spec indices.
fn intern(key: &str) -> usize {
    static KEYS: std::sync::OnceLock<std::sync::Mutex<Vec<String>>> = std::sync::OnceLock::new();
    let mut keys = KEYS.get_or_init(Default::default).lock().unwrap();
    if let Some(index) = keys.iter().position(|k| k == key) {
        return index;
    }
    let index = keys.len();
    keys.push(key.to_string());
    index
}

struct PreparedEffect {
    effect: Box<dyn Effect>,
    ids: Vec<usize>,
}
/// Bind an effect's numeric controls off audio before handing over a mode.
pub fn prepare_effect(effect: Box<dyn Effect>) -> Box<dyn Effect> {
    if effect.controls_prepared() {
        return effect;
    }
    let ids = effect
        .parameter_keys()
        .iter()
        .map(|key| intern(key))
        .collect();
    Box::new(PreparedEffect { effect, ids })
}
impl Effect for PreparedEffect {
    fn process(&mut self, buf: &mut [f32], channels: usize, sr: u32) {
        self.effect.process(buf, channels, sr);
    }
    fn process_planar(&mut self, l: &mut [f32], r: &mut [f32], sr: u32, scratch: &mut [f32]) {
        self.effect.process_planar(l, r, sr, scratch);
    }
    fn reset(&mut self) {
        self.effect.reset();
    }
    fn name(&self) -> &'static str {
        self.effect.name()
    }
    fn telemetry(&self) -> f32 {
        self.effect.telemetry()
    }
    fn parameter_keys(&self) -> Vec<String> {
        self.effect.parameter_keys()
    }
    fn set_param(&mut self, key: &str, value: f32) -> bool {
        self.effect.set_param(key, value)
    }
    fn get_param(&self, key: &str) -> Option<f32> {
        self.effect.get_param(key)
    }
    fn set_param_index(&mut self, index: usize, value: f32) -> bool {
        self.effect.set_param_index(index, value)
    }
    fn get_param_index(&self, index: usize) -> Option<f32> {
        self.effect.get_param_index(index)
    }
    fn control_index(&self, id: usize) -> Option<usize> {
        self.ids.iter().position(|index| *index == id)
    }
    fn controls_prepared(&self) -> bool {
        true
    }
}

fn bound(effect: &dyn Effect, id: usize, fallback: usize) -> Option<usize> {
    if effect.controls_prepared() {
        effect.control_index(id)
    } else {
        (fallback != usize::MAX).then_some(fallback)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn compare(mut make: impl FnMut() -> Box<dyn Effect>) {
        let mut a = Rack::with_capacity(1024);
        let mut b = Rack::with_capacity(1024);
        a.push(make());
        b.push(make());
        let keys = a.slots[0].effect.parameter_keys();
        let indices: Vec<_> = keys
            .iter()
            .map(|key| b.param_index(0, key).unwrap())
            .collect();
        for turn in 0..12 {
            for (key, index) in keys.iter().zip(&indices) {
                let from = a.get_param(0, key).unwrap_or(0.0);
                let value = from + if turn % 2 == 0 { 0.137 } else { -0.081 };
                assert_eq!(
                    a.set_param(0, key, value),
                    b.set_param_index(0, *index, value),
                    "{key}"
                );
                assert_eq!(
                    a.get_param(0, key).map(f32::to_bits),
                    b.get_param_index(0, *index).map(f32::to_bits),
                    "{key}"
                );
            }
            let mut x: Vec<f32> = (0..256)
                .map(|i| ((i + turn * 256) as f32 * 0.017).sin() * 0.125)
                .collect();
            let mut y = x.clone();
            a.process(&mut x, 2, 48000);
            b.process(&mut y, 2, 48000);
            assert!(
                x.iter().zip(y).all(|(x, y)| x.to_bits() == y.to_bits()),
                "{} turn={turn}",
                a.slots[0].effect.name()
            );
        }
        assert!(b.param_index(0, "unknown-key").is_none());
    }
    #[test]
    fn all_catalogue_and_legacy_effect_controls_match_by_key_and_index() {
        for entry in prism::catalogue() {
            compare(|| Box::new(prism::PrismEffect::new(entry.descriptor.id, 48000).unwrap()));
        }
        for kind in shape::ShapeKind::ALL {
            compare(|| shape::make_own(kind, 48000, 2, &[]));
        }
        compare(|| Box::new(Gain { db: 0.0 }));
        compare(|| Box::new(Eq::new(Default::default())));
        compare(|| Box::new(Compressor::new(Default::default())));
    }
    #[test]
    fn a_mode_reorders_its_controls_without_changing_their_meaning() {
        let mut a = Rack::with_capacity(1024);
        let mut b = Rack::with_capacity(1024);
        a.push(Box::new(prism::PrismEffect::new("hp-echo", 48000).unwrap()));
        b.push(Box::new(prism::PrismEffect::new("hp-echo", 48000).unwrap()));
        let map = b.control_maps().remove(0);
        let next = prepare_effect(Box::new(
            prism::PrismEffect::new("sh-pitchdelay", 48000).unwrap(),
        ));
        let map = map.switching_to(next.as_ref());
        let i = map.resolve("delayMs").unwrap();
        a.swap_slot(
            0,
            prepare_effect(Box::new(
                prism::PrismEffect::new("sh-pitchdelay", 48000).unwrap(),
            )),
            960,
        )
        .unwrap_or_else(|_| panic!());
        b.swap_slot(0, next, 960).unwrap_or_else(|_| panic!());
        for turn in 0..16 {
            a.set_param(0, "delayMs", 60.0 + turn as f32);
            b.set_param_index(0, i, 60.0 + turn as f32);
            let mut x = [0.125; 128];
            let mut y = x;
            a.process(&mut x, 2, 48000);
            b.process(&mut y, 2, 48000);
            assert!(x.iter().zip(y).all(|(x, y)| x.to_bits() == y.to_bits()));
        }
    }
}

//! Sound shaping you can play.
//!
//! Peak's DSP menu is a list of things you apply to a selection and wait for.
//! Most of them have no reason to work that way — a ring modulator is an
//! oscillator and a multiply, and the only thing making it an offline command
//! was that Peak's architecture had nowhere else to put it. Here they are rack
//! effects, so they run under the fingers while the sound is playing.
//!
//! Two are genuinely better live than they ever were offline. **Reverse
//! boomerang** offline mixes a reversed copy of a selection with the original,
//! which needs to know where the selection ends; live it is a rolling buffer
//! played backwards, so the reversal chases the playhead and the length of the
//! throw becomes a control. **Amplitude fit** offline normalises grain by grain
//! across a whole file; live it is the same thing done to the last thirty
//! milliseconds, which is the same idea with the waiting removed.
//!
//! Everything here implements [`crate::params::Params`], so all of it is ready
//! to be driven by automation or a modulator rather than only by a hand. That
//! is the whole reason the trait exists.

use crate::params::{ParamSpec, Params};
use crate::Effect;


mod simple;
pub use simple::*;
mod dynamics;
pub use dynamics::*;
// ------------------------------------------------------------ making them

pub(crate) const UTILITY_SPECS: &[ParamSpec] = &[
    ParamSpec::new("gainDb", "Gain", -24.0, 24.0, 0.0).unit("dB"),
    ParamSpec::new("invert", "Invert", 0.0, 1.0, 0.0),
    ParamSpec::new("swap", "Swap", 0.0, 1.0, 0.0),
    ParamSpec::new("width", "Width", 0.0, 2.0, 1.0).unit("x"),
    ParamSpec::new("ampFit", "Amp fit", 0.0, 1.0, 0.0),
    ParamSpec::new("grainMs", "Fit grain", 5.0, 500.0, 30.0)
        .log()
        .unit("ms"),
    ParamSpec::new("amount", "Fit amount", 0.0, 1.0, 0.7),
    ParamSpec::new("floorDb", "Fit floor", -80.0, -20.0, -50.0).unit("dB"),
];

pub struct Utility {
    values: [f32; 5],
    fit: AmplitudeFit,
}

impl Default for Utility {
    fn default() -> Self {
        Self {
            values: [0.0, 0.0, 0.0, 1.0, 0.0],
            fit: AmplitudeFit::default(),
        }
    }
}

impl Effect for Utility {
    fn process(&mut self, buf: &mut [f32], channels: usize, sample_rate: u32) {
        let gain =
            10f32.powf(self.values[0] / 20.0) * if self.values[1] >= 0.5 { -1.0 } else { 1.0 };
        for sample in buf.iter_mut() {
            *sample *= gain;
        }
        if channels >= 2 {
            for frame in buf.chunks_mut(channels) {
                if self.values[2] >= 0.5 {
                    frame.swap(0, 1);
                }
                let mid = (frame[0] + frame[1]) * 0.5;
                let side = (frame[0] - frame[1]) * 0.5 * self.values[3];
                frame[0] = mid + side;
                frame[1] = mid - side;
            }
        }
        if self.values[4] >= 0.5 {
            self.fit.process(buf, channels, sample_rate);
        }
    }
    fn reset(&mut self) {
        self.fit.reset();
    }
    fn name(&self) -> &'static str {
        "Utility"
    }
}

impl Params for Utility {
    fn specs(&self) -> &'static [ParamSpec] {
        UTILITY_SPECS
    }
    fn get(&self, key: &str) -> Option<f32> {
        match key {
            "grainMs" | "amount" | "floorDb" => self.fit.get(key),
            _ => UTILITY_SPECS[..5]
                .iter()
                .position(|s| s.key == key)
                .map(|i| self.values[i]),
        }
    }
    fn set(&mut self, key: &str, value: f32) -> bool {
        if matches!(key, "grainMs" | "amount" | "floorDb") {
            return self.fit.set(key, value);
        }
        if let Some(i) = UTILITY_SPECS[..5].iter().position(|s| s.key == key) {
            self.values[i] = UTILITY_SPECS[i].clamp(value);
            true
        } else {
            false
        }
    }
}

/// Which shaper. One name, used by the rack, the JSON and the interface, so
/// there is no table mapping three spellings of the same thing.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ShapeKind {
    Invert,
    Swap,
    Width,
    Dc,
    Ring,
    Rappify,
    Boomerang,
    Fit,
    Gate,
    /// The channel maximiser, as a module you can place.
    Maximizer,
    DattorroNotch,
    DattorroResonator,
    Regalia,
    Chamberlin,
    WhiteChorus,
    Flanger,
    Vibrato,
    PnNoise,
    PnNoiseEq,
    DattorroPlate,
    AllpassDiffuser,
    DampingFilter,
    Leslie,
    SingleBitPn,
    Harmonizer,
    Detune,
    Doubler,
    Doppler,
    Utility,
    DattorroFilterBank,
    SchroederReverb,
    MoorerReverb,
    Phaser,
}

impl ShapeKind {
    pub const ALL: [ShapeKind; 33] = [
        ShapeKind::Invert,
        ShapeKind::Swap,
        ShapeKind::Width,
        ShapeKind::Dc,
        ShapeKind::Ring,
        ShapeKind::Rappify,
        ShapeKind::Boomerang,
        ShapeKind::Fit,
        ShapeKind::Gate,
        ShapeKind::Maximizer,
        ShapeKind::DattorroNotch,
        ShapeKind::DattorroResonator,
        ShapeKind::Regalia,
        ShapeKind::Chamberlin,
        ShapeKind::WhiteChorus,
        ShapeKind::Flanger,
        ShapeKind::Vibrato,
        ShapeKind::PnNoise,
        ShapeKind::PnNoiseEq,
        ShapeKind::DattorroPlate,
        ShapeKind::AllpassDiffuser,
        ShapeKind::DampingFilter,
        ShapeKind::Leslie,
        ShapeKind::SingleBitPn,
        ShapeKind::Harmonizer,
        ShapeKind::Detune,
        ShapeKind::Doubler,
        ShapeKind::Doppler,
        ShapeKind::Utility,
        ShapeKind::DattorroFilterBank,
        ShapeKind::SchroederReverb,
        ShapeKind::MoorerReverb,
        ShapeKind::Phaser,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            ShapeKind::Invert => "invert",
            ShapeKind::Swap => "swap",
            ShapeKind::Width => "width",
            ShapeKind::Dc => "dc",
            ShapeKind::Ring => "ring",
            ShapeKind::Rappify => "rappify",
            ShapeKind::Boomerang => "boomerang",
            ShapeKind::Fit => "fit",
            ShapeKind::Gate => "gate",
            ShapeKind::Maximizer => "maximizer",
            ShapeKind::DattorroNotch => "dattorro_notch",
            ShapeKind::DattorroResonator => "dattorro_resonator",
            ShapeKind::Regalia => "regalia_mitra",
            ShapeKind::Chamberlin => "chamberlin",
            ShapeKind::WhiteChorus => "white_chorus",
            ShapeKind::Flanger => "dattorro_flanger",
            ShapeKind::Vibrato => "dattorro_vibrato",
            ShapeKind::PnNoise => "pn_noise",
            ShapeKind::PnNoiseEq => "pn_noise_eq",
            ShapeKind::DattorroPlate => "dattorro_plate",
            ShapeKind::AllpassDiffuser => "allpass_diffuser",
            ShapeKind::DampingFilter => "damping_filter",
            ShapeKind::Leslie => "leslie",
            ShapeKind::SingleBitPn => "single_bit_pn",
            ShapeKind::Harmonizer => "harmonizer",
            ShapeKind::Detune => "detune",
            ShapeKind::Doubler => "doubler",
            ShapeKind::Doppler => "doppler",
            ShapeKind::Utility => "utility",
            ShapeKind::DattorroFilterBank => "dattorro_filter_bank",
            ShapeKind::SchroederReverb => "schroeder_reverb",
            ShapeKind::MoorerReverb => "moorer_reverb",
            ShapeKind::Phaser => "phaser",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        ShapeKind::ALL.into_iter().find(|k| k.as_str() == s)
    }

    /// The `prism-fx` effect this kind is, shared with idMLab: the same
    /// controls under the same keys, held there to golden renders of this
    /// program's own and here by `tests/prism_parity.rs`.
    pub fn prism_id(self) -> &'static str {
        match self {
            ShapeKind::Invert => "invert",
            ShapeKind::Swap => "swap",
            ShapeKind::Width => "width",
            ShapeKind::Dc => "dc",
            ShapeKind::Ring => "ring",
            ShapeKind::Rappify => "rappify",
            ShapeKind::Boomerang => "boomerang",
            ShapeKind::Fit => "fit",
            ShapeKind::Gate => "gate",
            ShapeKind::Maximizer => "maximizer",
            ShapeKind::DattorroNotch => "dattorro-notch",
            ShapeKind::DattorroResonator => "dattorro-resonator",
            ShapeKind::Regalia => "regalia",
            ShapeKind::Chamberlin => "chamberlin",
            ShapeKind::WhiteChorus => "white-chorus",
            ShapeKind::Flanger => "flanger",
            ShapeKind::Vibrato => "vibrato",
            ShapeKind::PnNoise => "pn-noise",
            ShapeKind::PnNoiseEq => "pn-noise-eq",
            ShapeKind::DattorroPlate => "dattorro-plate",
            ShapeKind::AllpassDiffuser => "allpass-diffuser",
            ShapeKind::DampingFilter => "damping-filter",
            ShapeKind::Leslie => "leslie",
            ShapeKind::SingleBitPn => "single-bit-pn",
            ShapeKind::Harmonizer => "harmonizer",
            ShapeKind::Detune => "detune",
            ShapeKind::Doubler => "doubler",
            ShapeKind::Doppler => "doppler",
            ShapeKind::Utility => "utility",
            ShapeKind::DattorroFilterBank => "dattorro-filter-bank",
            ShapeKind::SchroederReverb => "schroeder-reverb",
            ShapeKind::MoorerReverb => "moorer-reverb",
            ShapeKind::Phaser => "phaser",
        }
    }

    /// The Prism pad's default pair, where Hyperprism had this process: which
    /// control goes across and which up, over what part of each range.
    ///
    /// The ranges are Hyperprism's where it gave one and the control can reach
    /// it — a chorus's 100 samples of depth is too little for this one's
    /// default, so it gets the control's own useful span instead.
    pub fn pad(self) -> Option<prism_fx::PadPair> {
        let pair = |x, x_range, y, y_range| Some(prism_fx::PadPair { x, x_range, y, y_range });
        match self {
            // Low pass; its band and high siblings are the same module's other
            // filters, a different pair chosen on the pad.
            ShapeKind::Chamberlin => pair("lowFreq", (20.0, 18_000.0), "lowQ", (0.2, 10.0)),
            ShapeKind::DattorroNotch => pair("frequency", (20.0, 2_000.0), "bandwidth", (10.0, 2_000.0)),
            ShapeKind::Phaser => pair("rateHz", (0.0, 10.0), "depth", (0.0, 1.0)),
            ShapeKind::Flanger => pair("rateHz", (0.01, 10.0), "depthMs", (0.0, 2.0)),
            ShapeKind::WhiteChorus => pair("rateHz", (0.01, 10.0), "depthMs", (0.0, 20.0)),
            ShapeKind::Ring => pair("hz", (0.1, 4_000.0), "mix", (0.0, 1.0)),
            ShapeKind::Vibrato => pair("rateHz", (0.01, 20.0), "depthMs", (0.0, 10.0)),
            ShapeKind::SchroederReverb | ShapeKind::MoorerReverb => {
                pair("wet", (0.0, 1.0), "decay", (0.0, 0.9995))
            }
            ShapeKind::Gate => pair("attackMs", (0.1, 200.0), "thresholdDb", (-80.0, 0.0)),
            _ => None,
        }
    }

    /// What a person should see.
    pub fn label(self) -> &'static str {
        match self {
            ShapeKind::Invert => "Invert",
            ShapeKind::Swap => "Swap",
            ShapeKind::Width => "Width",
            ShapeKind::Dc => "DC",
            ShapeKind::Ring => "Ring mod",
            ShapeKind::Rappify => "Rappify",
            ShapeKind::Boomerang => "Boomerang",
            ShapeKind::Fit => "Amp fit",
            ShapeKind::Gate => "Gate",
            ShapeKind::Maximizer => "Maximizer",
            ShapeKind::DattorroNotch => "Dattorro notch",
            ShapeKind::DattorroResonator => "Dattorro resonator",
            ShapeKind::Regalia => "Regalia-Mitra EQ",
            ShapeKind::Chamberlin => "Chamberlin filter",
            ShapeKind::WhiteChorus => "White chorus",
            ShapeKind::Flanger => "Dattorro flanger",
            ShapeKind::Vibrato => "Dattorro vibrato",
            ShapeKind::PnNoise => "Multibit PN noise",
            ShapeKind::PnNoiseEq => "Equalized PN noise",
            ShapeKind::DattorroPlate => "Dattorro plate",
            ShapeKind::AllpassDiffuser => "All-pass diffuser",
            ShapeKind::DampingFilter => "Damping filter",
            ShapeKind::Leslie => "Leslie speaker",
            ShapeKind::SingleBitPn => "Single-bit PN noise",
            ShapeKind::Harmonizer => "Harmonizer",
            ShapeKind::Detune => "Detune",
            ShapeKind::Doubler => "Doubler",
            ShapeKind::Doppler => "Doppler",
            ShapeKind::Utility => "Utility",
            ShapeKind::DattorroFilterBank => "Dattorro filter bank",
            ShapeKind::SchroederReverb => "Schroeder reverb",
            ShapeKind::MoorerReverb => "Moorer reverb",
            ShapeKind::Phaser => "Phaser",
        }
    }

    pub fn category(self) -> &'static str {
        match self {
            ShapeKind::DattorroPlate
            | ShapeKind::AllpassDiffuser
            | ShapeKind::SchroederReverb
            | ShapeKind::MoorerReverb => "Reverb & diffusion",
            ShapeKind::DattorroNotch
            | ShapeKind::DattorroResonator
            | ShapeKind::Regalia
            | ShapeKind::Chamberlin
            | ShapeKind::DampingFilter
            | ShapeKind::Dc => "Filters",
            ShapeKind::DattorroFilterBank => "Filters",
            ShapeKind::WhiteChorus
            | ShapeKind::Flanger
            | ShapeKind::Vibrato
            | ShapeKind::Boomerang
            | ShapeKind::Leslie
            | ShapeKind::Harmonizer
            | ShapeKind::Detune
            | ShapeKind::Doubler
            | ShapeKind::Doppler
            | ShapeKind::Phaser => "Delay & modulation",
            ShapeKind::PnNoise
            | ShapeKind::PnNoiseEq
            | ShapeKind::SingleBitPn
            | ShapeKind::Ring
            | ShapeKind::Rappify => "Generators & shaping",
            ShapeKind::Invert
            | ShapeKind::Swap
            | ShapeKind::Width
            | ShapeKind::Fit
            | ShapeKind::Gate
            | ShapeKind::Maximizer
            | ShapeKind::Utility => "Utility & dynamics",
        }
    }

    /// The parameters this kind has, without building one.
    ///
    /// The interface needs this to lay out a module, and automation needs it to
    /// know what it may address — neither wants an instance to ask.
    pub fn specs(self) -> &'static [ParamSpec] {
        match self {
            ShapeKind::Invert | ShapeKind::Swap => &[],
            ShapeKind::Width => WIDTH_SPECS,
            ShapeKind::Dc => DC_SPECS,
            ShapeKind::Ring => RING_SPECS,
            ShapeKind::Rappify => RAP_SPECS,
            ShapeKind::Boomerang => REV_SPECS,
            ShapeKind::Fit => FIT_SPECS,
            ShapeKind::Gate => GATE_SPECS,
            ShapeKind::Maximizer => crate::master::MAXIMIZER_SPECS,
            ShapeKind::DattorroNotch | ShapeKind::DattorroResonator | ShapeKind::Regalia => {
                crate::dattorro::FILTER_SPECS
            }
            ShapeKind::Chamberlin => crate::dattorro::CHAMBERLIN_SPECS,
            ShapeKind::WhiteChorus => crate::dattorro::MOD_DELAY_SPECS,
            ShapeKind::Flanger => crate::dattorro::FLANGER_SPECS,
            ShapeKind::Vibrato => crate::dattorro::VIBRATO_SPECS,
            ShapeKind::PnNoise | ShapeKind::PnNoiseEq => crate::dattorro::PN_SPECS,
            ShapeKind::DattorroPlate => crate::dattorro::PLATE_SPECS,
            ShapeKind::AllpassDiffuser => crate::dattorro::DIFFUSER_SPECS,
            ShapeKind::DampingFilter => crate::dattorro::DAMPING_SPECS,
            ShapeKind::Leslie => crate::dattorro::LESLIE_SPECS,
            ShapeKind::SingleBitPn => crate::dattorro::SINGLE_PN_SPECS,
            ShapeKind::Harmonizer => crate::dattorro::PITCH_SPECS,
            ShapeKind::Detune => crate::dattorro::DETUNE_SPECS,
            ShapeKind::Doubler => crate::dattorro::DOUBLER_SPECS,
            ShapeKind::Doppler => crate::dattorro::DOPPLER_SPECS,
            ShapeKind::Utility => UTILITY_SPECS,
            ShapeKind::DattorroFilterBank => crate::dattorro::FILTER_BANK_SPECS,
            ShapeKind::SchroederReverb => crate::reverb::SCHROEDER_SPECS,
            ShapeKind::MoorerReverb => crate::reverb::MOORER_SPECS,
            ShapeKind::Phaser => crate::phaser::PHASER_SPECS,
        }
    }
}

/// Build one and set it up: the `prism-fx` effect this kind is, shared with
/// idMLab (`ShapeKind::prism_id`), as made and with only the controls given
/// set, as this program's own was. Automation reaches it by key through
/// `Effect::set_param`.
pub fn make(
    kind: ShapeKind,
    sample_rate: u32,
    channels: usize,
    params: &[(String, f32)],
) -> Box<dyn Effect> {
    crate::prism::moved(kind.prism_id(), sample_rate, params)
        // Every kind is in the catalogue (`tests/prism_parity.rs`); this
        // program's own is the fallback should a build of prism-fx lack one.
        .unwrap_or_else(|| make_own(kind, sample_rate, channels, params))
}

/// This program's own effect for a kind, as it built it before the kinds
/// moved into `prism-fx`. Kept as the reference `tests/prism_parity.rs` holds
/// each moved effect to, as `dattorro::Echo` was kept for Echo.
///
/// Wrapped in [`crate::Driven`] so automation can still reach it by key.
pub fn make_own(
    kind: ShapeKind,
    sample_rate: u32,
    channels: usize,
    params: &[(String, f32)],
) -> Box<dyn Effect> {
    fn apply<T: Effect + Params + 'static>(mut e: T, params: &[(String, f32)]) -> Box<dyn Effect> {
        for (k, v) in params {
            e.set(k, *v);
        }
        Box::new(crate::Driven(e))
    }
    match kind {
        ShapeKind::SchroederReverb => apply(
            crate::reverb::Schroeder::new(sample_rate, channels),
            params,
        ),
        ShapeKind::MoorerReverb => apply(crate::reverb::Moorer::new(sample_rate, channels), params),
        ShapeKind::Phaser => apply(crate::phaser::Phaser::new(), params),
        ShapeKind::Invert => apply(Invert, params),
        ShapeKind::Swap => apply(SwapChannels, params),
        ShapeKind::Width => apply(Width::default(), params),
        ShapeKind::Dc => apply(DcOffset::default(), params),
        ShapeKind::Ring => apply(RingMod::default(), params),
        ShapeKind::Rappify => apply(Rappify::default(), params),
        ShapeKind::Boomerang => apply(ReverseMix::new(sample_rate, channels), params),
        ShapeKind::Fit => apply(AmplitudeFit::default(), params),
        ShapeKind::Gate => apply(Gate::default(), params),
        // Built switched on: a module in the rack is on by definition, and
        // `MasterSettings::default` is off because it used to be a channel
        // strip that had to be opted into.
        ShapeKind::Maximizer => apply(
            crate::Maximizer::new(crate::MasterSettings { on: true, ..Default::default() }),
            params,
        ),
        ShapeKind::DattorroNotch => apply(
            crate::dattorro::MusicalFilter::new(crate::dattorro::MusicalFilterMode::Notch),
            params,
        ),
        ShapeKind::DattorroResonator => apply(
            crate::dattorro::MusicalFilter::new(crate::dattorro::MusicalFilterMode::Resonator),
            params,
        ),
        ShapeKind::Regalia => apply(
            crate::dattorro::MusicalFilter::new(crate::dattorro::MusicalFilterMode::Regalia),
            params,
        ),
        ShapeKind::Chamberlin => apply(crate::dattorro::Chamberlin::default(), params),
        ShapeKind::WhiteChorus => apply(
            crate::dattorro::ModDelay::new(
                crate::dattorro::ModDelayMode::Chorus,
                sample_rate,
                channels,
            ),
            params,
        ),
        ShapeKind::Flanger => apply(
            crate::dattorro::ModDelay::new(
                crate::dattorro::ModDelayMode::Flanger,
                sample_rate,
                channels,
            ),
            params,
        ),
        ShapeKind::Vibrato => apply(
            crate::dattorro::ModDelay::new(
                crate::dattorro::ModDelayMode::Vibrato,
                sample_rate,
                channels,
            ),
            params,
        ),
        ShapeKind::PnNoise => apply(crate::dattorro::PnNoise::new(false), params),
        ShapeKind::PnNoiseEq => apply(crate::dattorro::PnNoise::new(true), params),
        ShapeKind::DattorroPlate => apply(crate::dattorro::Plate::new(sample_rate), params),
        ShapeKind::AllpassDiffuser => apply(
            crate::dattorro::AllpassDiffuser::new(sample_rate, channels),
            params,
        ),
        ShapeKind::DampingFilter => apply(crate::dattorro::DampingFilter::default(), params),
        ShapeKind::Leslie => apply(crate::dattorro::Leslie::new(sample_rate, channels), params),
        ShapeKind::SingleBitPn => apply(crate::dattorro::SingleBitPn::default(), params),
        ShapeKind::Harmonizer => apply(
            crate::dattorro::PitchShifter::new(sample_rate, channels),
            params,
        ),
        ShapeKind::Detune => apply(crate::dattorro::Detune::new(sample_rate, channels), params),
        ShapeKind::Doubler => apply(crate::dattorro::Doubler::new(sample_rate, channels), params),
        ShapeKind::Doppler => apply(crate::dattorro::Doppler::new(sample_rate, channels), params),
        ShapeKind::Utility => apply(Utility::default(), params),
        ShapeKind::DattorroFilterBank => {
            apply(crate::dattorro::DattorroFilterBank::default(), params)
        }
    }
}

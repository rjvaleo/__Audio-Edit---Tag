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

// --------------------------------------------------------------- the simple ones

/// Polarity. Nothing on its own; everything against a copy of itself.
#[derive(Debug, Clone, Copy, Default)]
pub struct Invert;

impl Effect for Invert {
    fn process(&mut self, buf: &mut [f32], _channels: usize, _sample_rate: u32) {
        for s in buf.iter_mut() {
            *s = -*s;
        }
    }
    fn reset(&mut self) {}
    fn name(&self) -> &'static str {
        "Invert"
    }
}

impl Params for Invert {
    fn specs(&self) -> &'static [ParamSpec] {
        &[]
    }
    fn get(&self, _key: &str) -> Option<f32> {
        None
    }
    fn set(&mut self, _key: &str, _value: f32) -> bool {
        false
    }
}

/// Left becomes right. A mono signal notices nothing.
#[derive(Debug, Clone, Copy, Default)]
pub struct SwapChannels;

impl Effect for SwapChannels {
    fn process(&mut self, buf: &mut [f32], channels: usize, _sample_rate: u32) {
        if channels < 2 {
            return;
        }
        for f in buf.chunks_mut(channels) {
            f.swap(0, 1);
        }
    }
    fn reset(&mut self) {}
    fn name(&self) -> &'static str {
        "Swap"
    }
}

impl Params for SwapChannels {
    fn specs(&self) -> &'static [ParamSpec] {
        &[]
    }
    fn get(&self, _key: &str) -> Option<f32> {
        None
    }
    fn set(&mut self, _key: &str, _value: f32) -> bool {
        false
    }
}

/// Mono to stereo and past it, on the mid/side split.
///
/// Zero collapses to the middle, one leaves the sound alone, and beyond one the
/// sides are pushed past what was recorded — which widens an image and hollows
/// anything that was dead centre, because centre *is* the mid signal.
#[derive(Debug, Clone, Copy)]
pub struct Width {
    pub width: f32,
}

const WIDTH_SPECS: &[ParamSpec] = &[ParamSpec::new("width", "Width", 0.0, 2.0, 1.0).unit("x")];

impl Default for Width {
    fn default() -> Self {
        Width { width: 1.0 }
    }
}

impl Effect for Width {
    fn process(&mut self, buf: &mut [f32], channels: usize, _sample_rate: u32) {
        if channels < 2 {
            return;
        }
        let w = self.width.clamp(0.0, 2.0);
        for f in buf.chunks_mut(channels) {
            let (l, r) = (f[0], f[1]);
            let mid = (l + r) * 0.5;
            let side = (l - r) * 0.5 * w;
            f[0] = mid + side;
            f[1] = mid - side;
        }
    }
    fn reset(&mut self) {}
    fn name(&self) -> &'static str {
        "Width"
    }
}

impl Params for Width {
    fn specs(&self) -> &'static [ParamSpec] {
        WIDTH_SPECS
    }
    fn get(&self, key: &str) -> Option<f32> {
        (key == "width").then_some(self.width)
    }
    fn set(&mut self, key: &str, value: f32) -> bool {
        if key == "width" {
            self.width = WIDTH_SPECS[0].clamp(value);
            return true;
        }
        false
    }
}

/// Take the offset out.
///
/// A one-pole high pass at a few hertz rather than a subtracted mean: the mean
/// needs the whole file, and an offset that drifts — which is what a bad
/// converter actually produces — is not a constant to subtract.
#[derive(Debug, Clone, Copy)]
pub struct DcOffset {
    pub hz: f32,
    state: [f32; 8],
}

const DC_SPECS: &[ParamSpec] = &[ParamSpec::new("hz", "Below", 1.0, 60.0, 5.0)
    .log()
    .unit("Hz")];

impl Default for DcOffset {
    fn default() -> Self {
        DcOffset {
            hz: 5.0,
            state: [0.0; 8],
        }
    }
}

impl Effect for DcOffset {
    fn process(&mut self, buf: &mut [f32], channels: usize, sample_rate: u32) {
        let channels = channels.max(1).min(self.state.len());
        let sr = sample_rate.max(1) as f32;
        let k = (std::f32::consts::TAU * self.hz.clamp(1.0, 60.0) / sr).min(0.5);
        for f in buf.chunks_mut(channels.max(1)) {
            for ch in 0..channels.min(f.len()) {
                self.state[ch] += k * (f[ch] - self.state[ch]);
                f[ch] -= self.state[ch];
            }
        }
    }
    fn reset(&mut self) {
        self.state = [0.0; 8];
    }
    fn name(&self) -> &'static str {
        "DC"
    }
}

impl Params for DcOffset {
    fn specs(&self) -> &'static [ParamSpec] {
        DC_SPECS
    }
    fn get(&self, key: &str) -> Option<f32> {
        (key == "hz").then_some(self.hz)
    }
    fn set(&mut self, key: &str, value: f32) -> bool {
        if key == "hz" {
            self.hz = DC_SPECS[0].clamp(value);
            return true;
        }
        false
    }
}

// ------------------------------------------------------------------ ring mod

/// What the oscillator does.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Wave {
    Sine,
    Square,
    Saw,
    Triangle,
}

impl Wave {
    pub fn as_str(self) -> &'static str {
        match self {
            Wave::Sine => "sine",
            Wave::Square => "square",
            Wave::Saw => "saw",
            Wave::Triangle => "triangle",
        }
    }
    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "sine" => Some(Wave::Sine),
            "square" => Some(Wave::Square),
            "saw" => Some(Wave::Saw),
            "triangle" => Some(Wave::Triangle),
            _ => None,
        }
    }
    fn at(self, phase: f32) -> f32 {
        match self {
            Wave::Sine => (std::f32::consts::TAU * phase).sin(),
            Wave::Square => {
                if phase < 0.5 {
                    1.0
                } else {
                    -1.0
                }
            }
            Wave::Saw => 2.0 * phase - 1.0,
            Wave::Triangle => 4.0 * (phase - 0.5).abs() - 1.0,
        }
    }
}

/// Ring modulation: two signals multiplied.
///
/// The output holds the sum and difference of every pair of frequencies in the
/// two, and nothing of either original — which is why it sounds metallic and
/// why the result is unrelated to the key of what went in. Peak multiplies by
/// whatever is on the clipboard; here it is an oscillator, which is what its
/// own manual suggests trying first, and which can be swept.
#[derive(Debug, Clone, Copy)]
pub struct RingMod {
    pub hz: f32,
    pub mix: f32,
    /// Hertz the oscillator climbs or falls per second. A swept ring modulator
    /// is the sound of something being tuned through a signal.
    pub sweep: f32,
    pub wave: Wave,
    phase: f32,
    swept: f32,
}

const RING_SPECS: &[ParamSpec] = &[
    ParamSpec::new("hz", "Frequency", 0.1, 8000.0, 220.0)
        .log()
        .unit("Hz"),
    ParamSpec::new("mix", "Mix", 0.0, 1.0, 1.0),
    ParamSpec::new("sweep", "Sweep", -2000.0, 2000.0, 0.0).unit("Hz/s"),
];

impl Default for RingMod {
    fn default() -> Self {
        RingMod {
            hz: 220.0,
            mix: 1.0,
            sweep: 0.0,
            wave: Wave::Sine,
            phase: 0.0,
            swept: 0.0,
        }
    }
}

impl Effect for RingMod {
    fn process(&mut self, buf: &mut [f32], channels: usize, sample_rate: u32) {
        let channels = channels.max(1);
        let sr = sample_rate.max(1) as f32;
        let mix = self.mix.clamp(0.0, 1.0);
        for f in buf.chunks_mut(channels) {
            let hz = (self.hz + self.swept).clamp(0.01, sr * 0.45);
            let m = self.wave.at(self.phase);
            for s in f.iter_mut() {
                *s = *s * (1.0 - mix) + *s * m * mix;
            }
            self.phase = (self.phase + hz / sr).fract();
            self.swept += self.sweep / sr;
            // The sweep is allowed to run away, so it is folded rather than
            // clamped — a modulator that sticks at the top of its range is a
            // modulator that has stopped modulating.
            if (self.hz + self.swept) > sr * 0.45 || (self.hz + self.swept) < 0.01 {
                self.swept = 0.0;
            }
        }
    }
    fn reset(&mut self) {
        self.phase = 0.0;
        self.swept = 0.0;
    }
    fn name(&self) -> &'static str {
        "Ring"
    }
}

impl Params for RingMod {
    fn specs(&self) -> &'static [ParamSpec] {
        RING_SPECS
    }
    fn get(&self, key: &str) -> Option<f32> {
        match key {
            "hz" => Some(self.hz),
            "mix" => Some(self.mix),
            "sweep" => Some(self.sweep),
            _ => None,
        }
    }
    fn set(&mut self, key: &str, value: f32) -> bool {
        match key {
            "hz" => self.hz = RING_SPECS[0].clamp(value),
            "mix" => self.mix = RING_SPECS[1].clamp(value),
            "sweep" => self.sweep = RING_SPECS[2].clamp(value),
            _ => return false,
        }
        true
    }
}

// ------------------------------------------------------------------- rappify

/// Peak's Rappify: extreme dynamic filtering.
///
/// The manual describes it as reducing material to its rhythmic essentials —
/// "turn your hi-fi into lo-fi". It is a resonant band-pass whose frequency
/// follows the signal's own envelope, so loud moments open it and quiet ones
/// close it. What survives is the transients and whatever happened to sit in
/// the band, which on anything with a beat is the beat.
#[derive(Debug, Clone, Copy)]
pub struct Rappify {
    /// How far the filter swings, and how hard it resonates.
    pub amount: f32,
    /// Where the band sits when nothing is playing.
    pub hz: f32,
    /// How fast the follower reacts.
    pub speed: f32,
    env: [f32; 8],
    lp: [f32; 8],
    bp: [f32; 8],
}

const RAP_SPECS: &[ParamSpec] = &[
    ParamSpec::new("amount", "Amount", 0.0, 1.0, 0.6),
    ParamSpec::new("hz", "Centre", 60.0, 6000.0, 400.0)
        .log()
        .unit("Hz"),
    ParamSpec::new("speed", "Speed", 1.0, 200.0, 40.0)
        .log()
        .unit("Hz"),
];

impl Default for Rappify {
    fn default() -> Self {
        Rappify {
            amount: 0.6,
            hz: 400.0,
            speed: 40.0,
            env: [0.0; 8],
            lp: [0.0; 8],
            bp: [0.0; 8],
        }
    }
}

impl Effect for Rappify {
    fn process(&mut self, buf: &mut [f32], channels: usize, sample_rate: u32) {
        let channels = channels.max(1).min(self.env.len());
        let sr = sample_rate.max(1) as f32;
        let amount = self.amount.clamp(0.0, 1.0);
        if amount <= 1e-6 {
            return;
        }
        let follow = (std::f32::consts::TAU * self.speed.clamp(1.0, 200.0) / sr).min(0.5);
        // Resonance climbs with the amount. Past about 0.97 a state-variable
        // filter of this kind will ring for ever on a transient, which is a
        // squeal rather than an effect.
        // Resonance climbs steeply with the amount: the manual calls this
        // extreme dynamic filtering, and a gentle band leaves the material
        // recognisable, which is the opposite of the point.
        let q = 0.05 + (1.0 - amount) * 0.9;

        for f in buf.chunks_mut(channels.max(1)) {
            for ch in 0..channels.min(f.len()) {
                let x = f[ch];
                self.env[ch] += follow * (x.abs() - self.env[ch]);

                // The band follows the envelope over two octaves either way.
                let open = (self.env[ch] * 8.0).clamp(0.0, 1.0);
                let hz =
                    (self.hz * 2f32.powf((open * 2.0 - 1.0) * 2.0 * amount)).clamp(20.0, sr * 0.45);
                let g = (std::f32::consts::PI * hz / sr).tan().clamp(1e-4, 1.0);

                // A one-pole state-variable band pass. Cheap, stable, and it
                // sweeps without the coefficient recalculation a biquad needs.
                let hp = (x - self.lp[ch] - self.bp[ch] * q * 2.0) / (1.0 + g * q * 2.0 + g * g);
                self.bp[ch] += g * hp;
                self.lp[ch] += g * self.bp[ch];
                let band = self.bp[ch] * (1.0 + amount * 2.0);
                f[ch] = x * (1.0 - amount) + band * amount;
            }
        }
    }
    fn reset(&mut self) {
        self.env = [0.0; 8];
        self.lp = [0.0; 8];
        self.bp = [0.0; 8];
    }
    fn name(&self) -> &'static str {
        "Rappify"
    }
}

impl Params for Rappify {
    fn specs(&self) -> &'static [ParamSpec] {
        RAP_SPECS
    }
    fn get(&self, key: &str) -> Option<f32> {
        match key {
            "amount" => Some(self.amount),
            "hz" => Some(self.hz),
            "speed" => Some(self.speed),
            _ => None,
        }
    }
    fn set(&mut self, key: &str, value: f32) -> bool {
        match key {
            "amount" => self.amount = RAP_SPECS[0].clamp(value),
            "hz" => self.hz = RAP_SPECS[1].clamp(value),
            "speed" => self.speed = RAP_SPECS[2].clamp(value),
            _ => return false,
        }
        true
    }
}

// -------------------------------------------------------- reverse boomerang

/// The longest throw the control allows, in seconds. The buffer is sized from
/// this once, because a rack effect may not allocate while it is running.
const MAX_THROW_S: f32 = 2.0;

/// Reverse boomerang, made live.
///
/// Offline this mixes a reversed copy of a selection with the original, which
/// needs to know where the selection ends. Live there is no end, so it keeps a
/// rolling buffer and reads it backwards: what you hear is the last however-many
/// milliseconds, arriving in reverse, chasing the playhead. The throw length
/// becomes a control, which the offline version never had.
///
/// Reading a ring backwards crosses the write head once per pass, and that
/// crossing is a step. It is faded rather than left, because a click once a
/// throw is a rhythm you did not ask for.
pub struct ReverseMix {
    pub throw_ms: f32,
    pub mix: f32,
    buf: Vec<f32>,
    channels: usize,
    frames: usize,
    write: usize,
    read: f32,
}

const REV_SPECS: &[ParamSpec] = &[
    ParamSpec::new("throwMs", "Throw", 20.0, 2000.0, 400.0)
        .log()
        .unit("ms"),
    ParamSpec::new("mix", "Mix", 0.0, 1.0, 0.5),
];

impl ReverseMix {
    pub fn new(sample_rate: u32, channels: usize) -> Self {
        let channels = channels.max(1).min(8);
        let frames = ((MAX_THROW_S * sample_rate.max(1) as f32) as usize).max(64);
        ReverseMix {
            throw_ms: 400.0,
            mix: 0.5,
            buf: vec![0.0; frames * channels],
            channels,
            frames,
            write: 0,
            read: 0.0,
        }
    }
}

impl Effect for ReverseMix {
    fn process(&mut self, buf: &mut [f32], channels: usize, sample_rate: u32) {
        let channels = channels.max(1).min(self.channels);
        let sr = sample_rate.max(1) as f32;
        let mix = self.mix.clamp(0.0, 1.0);
        let throw =
            (((self.throw_ms.clamp(20.0, 2000.0) / 1000.0) * sr) as usize).clamp(64, self.frames);

        for f in buf.chunks_mut(channels.max(1)) {
            for ch in 0..channels.min(f.len()) {
                self.buf[self.write * self.channels + ch] = f[ch];
            }

            // How far behind the write head to read, counting *up* — so the
            // sample fetched marches backwards through the recent past while
            // the write head marches forwards.
            //
            // Measuring it from the write head is the whole thing. Sweeping an
            // absolute index instead reads the same stretch of buffer for ever
            // — the first `throw` frames of the file, over and over — which is
            // a loop of the beginning rather than a reversal of the present.
            let d = (self.read as usize).min(throw.saturating_sub(1));
            let at = (self.write + self.frames - d) % self.frames;

            // The read crosses the write head once per pass, and that crossing
            // puts two unrelated moments next to each other. Faded, because a
            // click once a throw is a rhythm nobody asked for.
            let edge = (throw / 16).max(32);
            let near = d.min(throw.saturating_sub(d));
            let fade = (near as f32 / edge as f32).clamp(0.0, 1.0);

            for ch in 0..channels.min(f.len()) {
                let v = self.buf[at * self.channels + ch] * fade;
                f[ch] = f[ch] * (1.0 - mix) + v * mix;
            }

            self.write = (self.write + 1) % self.frames;
            // Twice, not once. The distance is measured from a write head that
            // is itself moving forward, so a distance growing at one per sample
            // leaves the read pointer standing exactly still — which is a held
            // sample, not a reversal. Growing at two makes it recede at one,
            // which is the recent past played backwards at its own speed.
            self.read += 2.0;
            if self.read >= throw as f32 {
                self.read = 0.0;
            }
        }
    }
    fn reset(&mut self) {
        self.buf.fill(0.0);
        self.write = 0;
        self.read = 0.0;
    }
    fn name(&self) -> &'static str {
        "Boomerang"
    }
}

impl Params for ReverseMix {
    fn specs(&self) -> &'static [ParamSpec] {
        REV_SPECS
    }
    fn get(&self, key: &str) -> Option<f32> {
        match key {
            "throwMs" => Some(self.throw_ms),
            "mix" => Some(self.mix),
            _ => None,
        }
    }
    fn set(&mut self, key: &str, value: f32) -> bool {
        match key {
            "throwMs" => self.throw_ms = REV_SPECS[0].clamp(value),
            "mix" => self.mix = REV_SPECS[1].clamp(value),
            _ => return false,
        }
        true
    }
}

// ---------------------------------------------------------- amplitude fit

/// Peak's Amplitude Fit, made live.
///
/// Offline it normalises a file grain by grain — thirty milliseconds at a time,
/// each grain brought to full scale and crossfaded with the last, so quiet
/// passages come up to meet loud ones. Live it is the same idea applied to the
/// last grain's worth: a very fast automatic gain with a grain-length window.
///
/// This is not the channel maximiser and does not replace it. The maximiser
/// holds a ceiling and is meant to be inaudible; this one is meant to be heard,
/// because flattening every moment to the same level is the effect.
#[derive(Debug, Clone, Copy)]
pub struct AmplitudeFit {
    pub grain_ms: f32,
    /// How far toward flat. At one, everything is the same level.
    pub amount: f32,
    /// Below this the gain stops climbing, so silence stays silent instead of
    /// being lifted into a wall of noise floor.
    pub floor_db: f32,
    peak: f32,
    gain: f32,
}

const FIT_SPECS: &[ParamSpec] = &[
    ParamSpec::new("grainMs", "Grain", 5.0, 500.0, 30.0)
        .log()
        .unit("ms"),
    ParamSpec::new("amount", "Amount", 0.0, 1.0, 0.7),
    ParamSpec::new("floorDb", "Floor", -80.0, -20.0, -50.0).unit("dB"),
];

impl Default for AmplitudeFit {
    fn default() -> Self {
        AmplitudeFit {
            grain_ms: 30.0,
            amount: 0.7,
            floor_db: -50.0,
            peak: 0.0,
            gain: 1.0,
        }
    }
}

impl Effect for AmplitudeFit {
    fn process(&mut self, buf: &mut [f32], channels: usize, sample_rate: u32) {
        let channels = channels.max(1);
        let sr = sample_rate.max(1) as f32;
        let amount = self.amount.clamp(0.0, 1.0);
        if amount <= 1e-6 {
            return;
        }
        let grain = ((self.grain_ms.clamp(5.0, 500.0) / 1000.0) * sr).max(8.0);
        // Fast enough to catch a peak, slow enough to hold it for a grain.
        //
        // Following at the grain rate in *both* directions does not measure a
        // peak at all — it measures something nearer the average, so the gain
        // it asks for is far too much and the output overshoots. Measured with
        // both at the grain rate: a signal at 0.29 came out at 1.45.
        let up = (1.0 / (0.001 * sr)).min(0.5);
        let down = (1.0 / grain).min(0.5);
        let floor = 10f32.powf(self.floor_db.clamp(-80.0, -20.0) / 20.0);

        for f in buf.chunks_mut(channels) {
            let mut loud = 0f32;
            for s in f.iter() {
                loud = loud.max(s.abs());
            }
            let k = if loud > self.peak { up } else { down };
            self.peak += k * (loud - self.peak);

            let want = if self.peak > floor {
                0.9 / self.peak.max(1e-9)
            } else {
                1.0
            };
            // Toward the target at the grain's own rate, so the gain is smooth
            // across a grain rather than stepping at its edge — which is what
            // the offline version's crossfade between grains achieves.
            self.gain += up * (want.clamp(0.03, 32.0) - self.gain);
            let g = 1.0 + (self.gain - 1.0) * amount;
            for s in f.iter_mut() {
                *s *= g;
            }
        }
    }
    fn reset(&mut self) {
        self.peak = 0.0;
        self.gain = 1.0;
    }
    fn name(&self) -> &'static str {
        "Fit"
    }
}

impl Params for AmplitudeFit {
    fn specs(&self) -> &'static [ParamSpec] {
        FIT_SPECS
    }
    fn get(&self, key: &str) -> Option<f32> {
        match key {
            "grainMs" => Some(self.grain_ms),
            "amount" => Some(self.amount),
            "floorDb" => Some(self.floor_db),
            _ => None,
        }
    }
    fn set(&mut self, key: &str, value: f32) -> bool {
        match key {
            "grainMs" => self.grain_ms = FIT_SPECS[0].clamp(value),
            "amount" => self.amount = FIT_SPECS[1].clamp(value),
            "floorDb" => self.floor_db = FIT_SPECS[2].clamp(value),
            _ => return false,
        }
        true
    }
}

// ----------------------------------------------------------------- the gate

/// Strip Silence's noise gate, made live.
///
/// Offline the tool finds quiet stretches and removes or silences them. Live
/// there is nothing to remove — the timeline is fixed — so what is left is the
/// gate: below the threshold it closes, above it opens, and how fast it does
/// either is the difference between a noise gate and a stutter.
#[derive(Debug, Clone, Copy)]
pub struct Gate {
    pub threshold_db: f32,
    pub attack_ms: f32,
    pub release_ms: f32,
    /// How far down it closes. Not all the way, unless you want it to be.
    pub depth: f32,
    env: f32,
    open: f32,
}

const GATE_SPECS: &[ParamSpec] = &[
    ParamSpec::new("thresholdDb", "Threshold", -80.0, 0.0, -40.0).unit("dB"),
    ParamSpec::new("attackMs", "Attack", 0.1, 200.0, 3.0)
        .log()
        .unit("ms"),
    ParamSpec::new("releaseMs", "Release", 5.0, 2000.0, 120.0)
        .log()
        .unit("ms"),
    ParamSpec::new("depth", "Depth", 0.0, 1.0, 1.0),
];

impl Default for Gate {
    fn default() -> Self {
        Gate {
            threshold_db: -40.0,
            attack_ms: 3.0,
            release_ms: 120.0,
            depth: 1.0,
            env: 0.0,
            open: 0.0,
        }
    }
}

impl Effect for Gate {
    fn process(&mut self, buf: &mut [f32], channels: usize, sample_rate: u32) {
        let channels = channels.max(1);
        let sr = sample_rate.max(1) as f32;
        let thresh = 10f32.powf(self.threshold_db.clamp(-80.0, 0.0) / 20.0);
        let a = 1.0 - (-1.0 / ((self.attack_ms.clamp(0.1, 200.0) / 1000.0) * sr)).exp();
        let r = 1.0 - (-1.0 / ((self.release_ms.clamp(5.0, 2000.0) / 1000.0) * sr)).exp();
        let depth = self.depth.clamp(0.0, 1.0);

        for f in buf.chunks_mut(channels) {
            // The loudest channel decides, so a gate never leaves one side of a
            // stereo pair open and the other shut.
            let mut loud = 0f32;
            for s in f.iter() {
                loud = loud.max(s.abs());
            }
            // Fast up, and down at the release rate. The first version decayed
            // by a fixed factor per sample, which is a time constant of its own
            // that had nothing to do with the release control — so the gate
            // never closed inside the release it was asked for.
            let k = if loud > self.env { a } else { r };
            self.env += k * (loud - self.env);

            let want = if self.env >= thresh { 1.0 } else { 0.0 };
            let k = if want > self.open { a } else { r };
            self.open += k * (want - self.open);

            let g = 1.0 - depth * (1.0 - self.open);
            for s in f.iter_mut() {
                *s *= g;
            }
        }
    }
    fn reset(&mut self) {
        self.env = 0.0;
        self.open = 0.0;
    }
    fn name(&self) -> &'static str {
        "Gate"
    }
}

impl Params for Gate {
    fn specs(&self) -> &'static [ParamSpec] {
        GATE_SPECS
    }
    fn get(&self, key: &str) -> Option<f32> {
        match key {
            "thresholdDb" => Some(self.threshold_db),
            "attackMs" => Some(self.attack_ms),
            "releaseMs" => Some(self.release_ms),
            "depth" => Some(self.depth),
            _ => None,
        }
    }
    fn set(&mut self, key: &str, value: f32) -> bool {
        match key {
            "thresholdDb" => self.threshold_db = GATE_SPECS[0].clamp(value),
            "attackMs" => self.attack_ms = GATE_SPECS[1].clamp(value),
            "releaseMs" => self.release_ms = GATE_SPECS[2].clamp(value),
            "depth" => self.depth = GATE_SPECS[3].clamp(value),
            _ => return false,
        }
        true
    }
}

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
    Echo,
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
    pub const ALL: [ShapeKind; 34] = [
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
        ShapeKind::Echo,
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
            ShapeKind::Echo => "dattorro_echo",
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
            ShapeKind::Echo => "Echo",
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
            | ShapeKind::Echo
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
            ShapeKind::Echo => crate::dattorro::ECHO_SPECS,
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

/// Build one and set it up.
///
/// Returns a plain `Effect`, but wrapped in [`crate::Driven`] so automation can
/// still reach it by key. Editing a control in the interface rebuilds the rack
/// from the spec, which is where filter state may safely be discarded; a lane
/// moving the same control during playback cannot rebuild anything, so it needs
/// a way through the boxing to the live effect.
pub fn make(
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
        ShapeKind::Echo => apply(crate::dattorro::Echo::new(sample_rate, channels), params),
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

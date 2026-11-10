//! Rappify, reverse boomerang, amplitude fit and the gate.

use super::*;

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

pub(super) const RAP_SPECS: &[ParamSpec] = &[
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

pub(super) const REV_SPECS: &[ParamSpec] = &[
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

pub(super) const FIT_SPECS: &[ParamSpec] = &[
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

pub(super) const GATE_SPECS: &[ParamSpec] = &[
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

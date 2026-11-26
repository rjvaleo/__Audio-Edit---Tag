//! Seq, the sequencer page, as the page plays it: its Classic synth (the
//! oscillator and its ADSR, the shared filter with its envelope and key
//! follow, the three LFOs), the ping-pong tape delay, and the Band mixer's
//! melody channel they pass through (`ui/sequencer/app.js` `initAudio`,
//! `playClassic`, `noteFilterEnv`; `keys.js` `kyClassicOn`; `band.js`
//! `bandInit`), on a port of Chromium's own Web Audio
//! (`dsp_core::chromium`), so it plays what the page plays, sample for
//! sample.
//!
//! Space (`atRev`, [`space`]), fed from the melody channel, is built as the
//! page builds it: even at a wet level of 0 its wet gain multiplies at audio
//! rate (its glide to 0 never leaves the timeline), which sets the sign of
//! the destination's zeros. Atmosphere's own voice, the Band's other
//! channels and the scopes share the page's graph but are silent in Seq's
//! cases and are not built.

pub mod module;
pub mod space;
pub mod steps;

pub use space::SpaceSettings;

use dsp_core::chromium::graph::{params::*, FilterType, Graph, NodeId, WaveId};
use dsp_core::chromium::wave::Wave;
use dsp_core::chromium::{fdlibm, QUANTUM};

/// The built-in waves, as the graph registers them (Chromium's order).
const SINE: WaveId = WaveId(0);
const SQUARE: WaveId = WaveId(1);
const SAWTOOTH: WaveId = WaveId(2);
const TRIANGLE: WaveId = WaveId(3);

/// The most notes sounding at once.
pub const MAX_VOICES: usize = 32;
/// Pulse waves in use at once (each note of the pulse wave makes its own).
const PULSE_WAVES: usize = 8;
/// `buildPulseWave`'s coefficient count.
const PULSE_N: usize = 256;

/// `KEY_FOLLOW_REF_MIDI`.
const KEY_FOLLOW_REF_MIDI: f64 = 60.0;
/// `TAPE_ACCEL`, capstan acceleration in inches per second squared.
pub const TAPE_ACCEL: f64 = 12.0;
/// `TAPE_HEADGAP_S`: the head gap, sized so nominal speed gives 0.5 s.
pub const TAPE_HEADGAP_S: f64 = 0.5;
/// The longest tape glide curve (`Math.min(48000, …)`).
const TAPE_CURVE_MAX: usize = 48000;
/// `BPM_SLEW_DELAY_S`, `BPM_SLEW_TAU`, `BPM_SLEW_MAX_RATE`.
pub const BPM_SLEW_DELAY_S: f64 = 0.12;
const BPM_SLEW_TAU: f64 = 0.45;
const BPM_SLEW_MAX_RATE: f64 = 90.0;
/// The slew's ticker (`setInterval(…, 30)`), in seconds.
pub const BPM_SLEW_TICK: f64 = 0.03;

/// Classic's oscillator.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Shape {
    Sine,
    Triangle,
    Sawtooth,
    Square,
    Pulse,
}

impl Shape {
    /// The page's name for it (`waveType`).
    pub fn from_name(s: &str) -> Option<Self> {
        Some(match s {
            "sine" => Shape::Sine,
            "triangle" => Shape::Triangle,
            "sawtooth" => Shape::Sawtooth,
            "square" => Shape::Square,
            "pulse" => Shape::Pulse,
            _ => return None,
        })
    }

    fn builtin(self) -> Option<WaveId> {
        match self {
            Shape::Sine => Some(SINE),
            Shape::Triangle => Some(TRIANGLE),
            Shape::Sawtooth => Some(SAWTOOTH),
            Shape::Square => Some(SQUARE),
            Shape::Pulse => None,
        }
    }
}

/// An ADSR as the page holds it: milliseconds, and the sustain 0..1.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Adsr {
    pub a: f64,
    pub d: f64,
    pub s: f64,
    pub r: f64,
}

/// Where an LFO goes (`lfo.target`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Target {
    None,
    Filter,
    Resonance,
    Volume,
    DelayWet,
    /// The pulse width: moved by the scheduler per step, not by the graph.
    Pw,
}

impl Target {
    pub fn from_name(s: &str) -> Self {
        match s {
            "filter" => Target::Filter,
            "resonance" => Target::Resonance,
            "volume" => Target::Volume,
            "delay-wet" => Target::DelayWet,
            "pw" => Target::Pw,
            _ => Target::None,
        }
    }
}

/// One LFO (`lfos[i]`): Hz, depth 0..1, its wave.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Lfo {
    pub rate: f64,
    pub depth: f64,
    pub wave: Shape,
    pub target: Target,
}

/// The tape delay (`delaySubdiv` beats, `delayFeedback`, `delayWet`,
/// `delaySpread`, `delayHiCutFreq` Hz).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Delay {
    pub subdiv: f64,
    pub feedback: f64,
    pub wet: f64,
    pub spread: f64,
    pub hi_cut: f64,
}

/// Everything Classic and its delay read, by the page's own names.
#[derive(Clone, Debug, PartialEq)]
pub struct Settings {
    pub bpm: f64,
    pub step_beats: f64,
    pub wave: Shape,
    pub pulse_width: f64,
    pub adsr: Adsr,
    pub volume: f64,
    pub cutoff: f64,
    pub q: f64,
    pub filter_env: Adsr,
    pub amount: f64,
    pub key_follow: f64,
    pub lfos: [Lfo; 3],
    pub delay: Delay,
    pub tape_ips: f64,
    /// The Band mixer's melody channel: level (0..100, 80 is unity), pan
    /// (-100..100) and delay send (0..100).
    pub mel_level: f64,
    pub mel_pan: f64,
    pub mel_dly: f64,
    /// Its send into Space (0..100).
    pub mel_spc: f64,
    /// Space's knobs.
    pub space: SpaceSettings,
}

impl Default for Settings {
    /// The page's values as it opens (and the reference renders' defaults).
    fn default() -> Self {
        let lfo = Lfo { rate: 1.0, depth: 0.0, wave: Shape::Sine, target: Target::None };
        Settings {
            bpm: 120.0,
            step_beats: 0.5,
            wave: Shape::Sine,
            pulse_width: 0.5,
            adsr: Adsr { a: 10.0, d: 80.0, s: 0.6, r: 200.0 },
            volume: 0.7,
            cutoff: 2000.0,
            q: 2.0,
            filter_env: Adsr { a: 10.0, d: 150.0, s: 0.3, r: 300.0 },
            amount: 0.5,
            key_follow: 0.0,
            lfos: [lfo; 3],
            delay: Delay { subdiv: 0.5, feedback: 0.35, wet: 0.0, spread: 1.0, hi_cut: 6300.0 },
            tape_ips: 7.5,
            mel_level: 80.0,
            mel_pan: 0.0,
            mel_dly: 100.0,
            mel_spc: 100.0,
            space: SpaceSettings::default(),
        }
    }
}

impl Settings {
    /// What the page plays as it opens, before a control is touched: its
    /// literals (`filterCutoff = 2046`, `filterRes = 2.09`, `delayWet =
    /// 0.25`, the `lfos` array), not the reference renders' baseline.
    pub fn page() -> Self {
        let lfo = |rate, depth, target| Lfo { rate, depth, wave: Shape::Sine, target };
        Settings {
            cutoff: 2046.0,
            q: 2.09,
            lfos: [lfo(1.0, 0.2, Target::Filter), lfo(0.55, 0.25, Target::Pw), lfo(0.55, 0.0, Target::None)],
            delay: Delay { subdiv: 0.5, feedback: 0.35, wet: 0.25, spread: 1.0, hi_cut: 6300.0 },
            ..Settings::default()
        }
    }

    /// One step's length in seconds (`(60 / bpm) * stepBeats`).
    pub fn step_dur(&self) -> f64 {
        (60.0 / self.bpm) * self.step_beats
    }
}

/// `DenormalDisabler`: flush-to-zero while it lives, as Chromium renders
/// (FPCR's FZ bit on arm64, MXCSR's FTZ and DAZ on x86).
struct DenormalsOff {
    #[allow(dead_code)]
    old: u64,
}

impl DenormalsOff {
    #[inline]
    fn new() -> Self {
        #[cfg(target_arch = "aarch64")]
        unsafe {
            let old: u64;
            core::arch::asm!("mrs {0}, fpcr", out(reg) old);
            core::arch::asm!("msr fpcr, {0}", in(reg) old | (1 << 24));
            DenormalsOff { old }
        }
        #[cfg(target_arch = "x86_64")]
        unsafe {
            let mut old: u32 = 0;
            core::arch::asm!("stmxcsr [{0}]", in(reg) &mut old);
            let new = old | 0x8040;
            core::arch::asm!("ldmxcsr [{0}]", in(reg) &new);
            DenormalsOff { old: old as u64 }
        }
        #[cfg(not(any(target_arch = "aarch64", target_arch = "x86_64")))]
        DenormalsOff { old: 0 }
    }
}

impl Drop for DenormalsOff {
    #[inline]
    fn drop(&mut self) {
        #[cfg(target_arch = "aarch64")]
        unsafe {
            core::arch::asm!("msr fpcr, {0}", in(reg) self.old);
        }
        #[cfg(target_arch = "x86_64")]
        unsafe {
            let old = self.old as u32;
            core::arch::asm!("ldmxcsr [{0}]", in(reg) &old);
        }
    }
}

/// `bdGain`: a Band fader's level as a gain.
fn bd_gain(v: f64) -> f64 {
    fdlibm::pow(v.max(0.0) / 80.0, 2.0)
}

/// A note sounding: its oscillator and envelope.
#[derive(Clone, Copy)]
struct Voice {
    used: bool,
    osc: NodeId,
    env: NodeId,
    /// Its pulse wave, if it has one.
    pulse: Option<usize>,
    /// When it stops (after its release), in context seconds.
    end: f64,
    /// When it was made, so a held key can be found again.
    id: u64,
}

impl Voice {
    const EMPTY: Voice = Voice { used: false, osc: NodeId(0), env: NodeId(0), pulse: None, end: 0.0, id: 0 };
}

/// A held key (`kyClassicOn`'s voice), to let go with [`Classic::release`].
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Held(u64);

/// The tape glide in flight (`tapeGlide`).
#[derive(Clone, Copy, Debug)]
struct Glide {
    v0: f64,
    v1: f64,
    l: f64,
    start: f64,
    t: f64,
    d_end: f64,
}

/// Classic, its filter, its LFOs, the melody channel and the delay on their
/// own graph.
pub struct Classic {
    pub g: Graph,
    pub s: Settings,
    out: NodeId,
    seq_vol: NodeId,
    filter: NodeId,
    cutoff_base: NodeId,
    filter_env: NodeId,
    delay_dry: NodeId,
    delay_wet: NodeId,
    delay_l: NodeId,
    delay_r: NodeId,
    pan_l: NodeId,
    pan_r: NodeId,
    hi_lr: NodeId,
    hi_rl: NodeId,
    fb_lr: NodeId,
    fb_rl: NodeId,
    lfo_osc: [NodeId; 3],
    lfo_gain: [NodeId; 3],
    pulses: [WaveId; PULSE_WAVES],
    pulse_used: [bool; PULSE_WAVES],
    voices: [Voice; MAX_VOICES],
    next_id: u64,
    /// The pulse width the next note takes (`currentPW`).
    pub current_pw: f64,
    /// The tempo a glide is heading for (`bpmTarget`).
    pub bpm_target: f64,
    glide: Option<Glide>,
    /// The tape glide's curve, made here so a glide never allocates.
    curve: Vec<f32>,
    /// The tempo slew (`startBpmSlew`): running, and the hold after the
    /// last knob move, in context seconds.
    slewing: bool,
    slew_hold_until: f64,
    pub space: space::Space,
}

impl Classic {
    /// Built as `initAudio` and `bandInit` build it, with `s` in place.
    /// Allocates: make it off the audio thread.
    pub fn new(sample_rate: f32, s: Settings) -> Self {
        // The page's FFTs and convolutions are vDSP's on a Mac.
        crate::accelerate::install();
        let mut g = Graph::new(sample_rate, 1024, 2048);
        let room = "a fresh graph has room";
        // The destination.
        let out = g.explicit_gain(2).expect(room);
        let mut pulses = [WaveId(0); PULSE_WAVES];
        for p in pulses.iter_mut() {
            *p = g.add_wave(Wave::lazy(sample_rate, PULSE_N, 4));
        }
        // initAudio.
        let master = g.gain().expect(room);
        g.set(master, GAIN, 0.3);
        let seq_vol = g.gain().expect(room);
        g.set(seq_vol, GAIN, s.volume as f32);
        g.connect(seq_vol, master);
        let filter = g.biquad(FilterType::Lowpass).expect(room);
        g.set(filter, FREQUENCY, 0.0);
        g.set(filter, Q, s.q as f32);
        let cutoff_base = g.constant().expect(room);
        g.set(cutoff_base, OFFSET, s.cutoff as f32);
        g.connect_param(cutoff_base, filter, FREQUENCY);
        g.start(cutoff_base, 0.0);
        let filter_env = g.constant().expect(room);
        g.set(filter_env, OFFSET, 0.0);
        g.connect_param(filter_env, filter, FREQUENCY);
        g.start(filter_env, 0.0);
        g.connect(master, out);
        // The dry path: filter, the melody bus, the dry gain.
        let delay_dry = g.gain().expect(room);
        g.set(delay_dry, GAIN, (1.0 - s.delay.wet) as f32);
        let mel_bus = g.explicit_gain(2).expect(room);
        g.connect(filter, mel_bus);
        g.connect(delay_dry, seq_vol);
        // The ping-pong tape delay.
        let delay_l = g.delay(4.0).expect(room);
        let delay_r = g.delay(4.0).expect(room);
        let d_time = 4.0f64.min((60.0 / s.bpm) * s.delay.subdiv);
        g.set(delay_l, DELAY_TIME, d_time as f32);
        g.set(delay_r, DELAY_TIME, d_time as f32);
        let pan_l = g.panner().expect(room);
        let pan_r = g.panner().expect(room);
        g.set(pan_l, PAN, (-s.delay.spread) as f32);
        g.set(pan_r, PAN, s.delay.spread as f32);
        let delay_wet = g.gain().expect(room);
        g.set(delay_wet, GAIN, s.delay.wet as f32);
        g.connect(delay_wet, seq_vol);
        let hi_lr = g.biquad(FilterType::Lowpass).expect(room);
        g.set(hi_lr, Q, 0.5);
        g.set(hi_lr, FREQUENCY, s.delay.hi_cut as f32);
        let hi_rl = g.biquad(FilterType::Lowpass).expect(room);
        g.set(hi_rl, Q, 0.5);
        g.set(hi_rl, FREQUENCY, s.delay.hi_cut as f32);
        let fb_lr = g.gain().expect(room);
        g.set(fb_lr, GAIN, s.delay.feedback as f32);
        let fb_rl = g.gain().expect(room);
        g.set(fb_rl, GAIN, s.delay.feedback as f32);
        g.connect(delay_l, pan_l);
        g.connect(pan_l, delay_wet);
        g.connect(delay_l, hi_lr);
        g.connect(hi_lr, fb_lr);
        g.connect(fb_lr, delay_r);
        g.connect(delay_r, pan_r);
        g.connect(pan_r, delay_wet);
        g.connect(delay_r, hi_rl);
        g.connect(hi_rl, fb_rl);
        g.connect(fb_rl, delay_l);
        // The LFOs.
        let mut lfo_osc = [NodeId(0); 3];
        let mut lfo_gain = [NodeId(0); 3];
        for i in 0..3 {
            let l = s.lfos[i];
            let osc = g.oscillator(l.wave.builtin().unwrap_or(SINE)).expect(room);
            let gain = g.gain().expect(room);
            g.set(osc, FREQUENCY, l.rate as f32);
            g.set(gain, GAIN, 0.0);
            g.connect(osc, gain);
            g.start(osc, 0.0);
            lfo_osc[i] = osc;
            lfo_gain[i] = gain;
        }
        // atmosInit: Space, its settings applied as the init ends.
        let mut space = space::Space::build(&mut g, seq_vol);
        space.apply(&mut g, &s.space);
        // bandInit: the melody leaves the bus into its own channel (in,
        // fader, pan), whose dry goes to the delay's dry side and whose sends
        // feed the delay and Space.
        let ch_in = g.gain().expect(room);
        let fader = g.gain().expect(room);
        let pan = g.panner().expect(room);
        let dly = g.gain().expect(room);
        let spc = g.gain().expect(room);
        g.connect(ch_in, fader);
        g.connect(fader, pan);
        g.connect(pan, delay_dry);
        g.connect(pan, dly);
        g.connect(pan, spc);
        g.connect(dly, delay_l);
        g.connect(spc, space.gate);
        g.connect(mel_bus, ch_in);
        // bandApply(true).
        g.set(fader, GAIN, bd_gain(s.mel_level) as f32);
        g.set(pan, PAN, (s.mel_pan / 100.0) as f32);
        g.set(dly, GAIN, (s.mel_dly / 100.0) as f32);
        g.set(spc, GAIN, (s.mel_spc / 100.0) as f32);
        let bpm_target = s.bpm;
        let current_pw = s.pulse_width;
        let mut c = Classic {
            g,
            s,
            out,
            seq_vol,
            filter,
            cutoff_base,
            filter_env,
            delay_dry,
            delay_wet,
            delay_l,
            delay_r,
            pan_l,
            pan_r,
            hi_lr,
            hi_rl,
            fb_lr,
            fb_rl,
            lfo_osc,
            lfo_gain,
            pulses,
            pulse_used: [false; PULSE_WAVES],
            voices: [Voice::EMPTY; MAX_VOICES],
            next_id: 1,
            current_pw,
            bpm_target,
            glide: None,
            curve: Vec::with_capacity(TAPE_CURVE_MAX),
            slewing: false,
            slew_hold_until: 0.0,
            space,
        };
        for d in [delay_l, delay_r] {
            c.g.reserve_value_curves(d, DELAY_TIME, TAPE_CURVE_MAX);
        }
        for i in 0..3 {
            c.connect_lfo(i);
        }
        c
    }

    /// `getLFOGainValue`.
    fn lfo_gain_value(&self, i: usize) -> f64 {
        let l = &self.s.lfos[i];
        match l.target {
            Target::Filter => l.depth * self.s.cutoff,
            Target::Resonance => l.depth * 10.0,
            Target::Volume => l.depth * self.s.volume,
            Target::DelayWet => l.depth * self.s.delay.wet,
            Target::None | Target::Pw => 0.0,
        }
    }

    /// `connectLFO`.
    fn connect_lfo(&mut self, i: usize) {
        let gain = self.lfo_gain[i];
        for to in [self.filter, self.seq_vol, self.delay_wet] {
            for k in [FREQUENCY, Q, GAIN] {
                self.g.disconnect(gain, to, Some(k));
            }
        }
        let param = match self.s.lfos[i].target {
            Target::Filter => Some((self.filter, FREQUENCY)),
            Target::Resonance => Some((self.filter, Q)),
            Target::Volume => Some((self.seq_vol, GAIN)),
            Target::DelayWet => Some((self.delay_wet, GAIN)),
            Target::None | Target::Pw => None,
        };
        match param {
            Some((to, k)) => {
                let v = self.lfo_gain_value(i);
                self.g.set(gain, GAIN, v as f32);
                self.g.connect_param(gain, to, k);
            }
            None => self.g.set(gain, GAIN, 0.0),
        }
        let _ = self.lfo_osc[i];
    }

    fn free_voice(&mut self) -> Option<usize> {
        self.voices.iter().position(|v| !v.used)
    }

    /// The oscillator for a note: Classic's wave, or a pulse at `currentPW`
    /// (`buildPulseWave`).
    fn oscillator(&mut self) -> Option<(NodeId, Option<usize>)> {
        match self.s.wave.builtin() {
            Some(w) => Some((self.g.oscillator(w)?, None)),
            None => {
                let k = self.pulse_used.iter().position(|u| !u)?;
                let width = self.current_pw;
                let mut real = [0.0f32; PULSE_N];
                let imag = [0.0f32; PULSE_N];
                real[0] = (2.0 * width - 1.0) as f32;
                for (n, r) in real.iter_mut().enumerate().skip(1) {
                    let n = n as f64;
                    *r = ((2.0 / (n * core::f64::consts::PI)) * fdlibm::sin(n * core::f64::consts::PI * width)) as f32;
                }
                self.g.set_custom_wave(self.pulses[k], &real, &imag);
                let osc = self.g.oscillator(self.pulses[k])?;
                self.pulse_used[k] = true;
                Some((osc, Some(k)))
            }
        }
    }

    /// `playNote`: one step's note at `time`, held `hold` steps (Classic,
    /// then the filter's envelope). Returns `false` when there is no room.
    pub fn play_note(&mut self, freq: f64, time: f64, hold: f64) -> bool {
        let Some(dur) = self.play_classic(freq, time, hold) else { return false };
        self.note_filter_env(freq, time, dur);
        true
    }

    /// `playClassic`: the note, into the filter; its held length.
    fn play_classic(&mut self, freq: f64, time: f64, hold: f64) -> Option<f64> {
        let slot = self.free_voice()?;
        let (osc, pulse) = self.oscillator()?;
        let Some(env) = self.g.gain() else {
            self.g.free(osc);
            if let Some(k) = pulse {
                self.pulse_used[k] = false;
            }
            return None;
        };
        let g = &mut self.g;
        g.set(osc, FREQUENCY, freq as f32);
        g.connect(osc, env);
        g.connect(env, self.filter);
        let s = &self.s;
        let a = s.adsr.a / 1000.0;
        let d = s.adsr.d / 1000.0;
        let su = s.adsr.s;
        let r = s.adsr.r / 1000.0;
        let step_dur = (60.0 / s.bpm) * s.step_beats;
        let note_dur = step_dur * 0.85 * hold;
        g.set_value_at_time(env, GAIN, 0.0, time);
        g.linear_ramp_to_value_at_time(env, GAIN, 1.0, time + a);
        g.linear_ramp_to_value_at_time(env, GAIN, su as f32, time + a + d);
        g.set_value_at_time(env, GAIN, su as f32, time + note_dur);
        g.linear_ramp_to_value_at_time(env, GAIN, 0.0, time + note_dur + r);
        g.start(osc, time);
        let end = time + note_dur + r + 0.05;
        g.stop(osc, end);
        let id = self.next_id;
        self.next_id += 1;
        self.voices[slot] = Voice { used: true, osc, env, pulse, end, id };
        Some(note_dur)
    }

    /// `noteFilterEnv`: the filter's envelope and key follow for one note.
    pub fn note_filter_env(&mut self, freq: f64, time: f64, note_dur: f64) {
        let s = &self.s;
        let note_midi = 69.0 + 12.0 * (freq / 440.0).log2();
        let semi_offset = (note_midi - KEY_FOLLOW_REF_MIDI) * s.key_follow;
        let kf_mult = fdlibm::pow(2.0, semi_offset / 12.0);
        let base_cutoff = 20000f64.min(s.cutoff * kf_mult);
        let fa = s.filter_env.a / 1000.0;
        let fd = s.filter_env.d / 1000.0;
        let fs = s.filter_env.s;
        let fr = s.filter_env.r / 1000.0;
        let max_delta = base_cutoff * (fdlibm::pow(2.0, 4.0) - 1.0);
        let peak = 20000f64.min(20f64.max(base_cutoff + s.amount * max_delta));
        let sus = 20000f64.min(20f64.max(base_cutoff + s.amount * max_delta * fs));
        let base_delta = base_cutoff - s.cutoff;
        let peak_delta = peak - s.cutoff;
        let sus_delta = sus - s.cutoff;
        let n = self.filter_env;
        let g = &mut self.g;
        g.cancel_scheduled_values(n, OFFSET, time);
        g.set_value_at_time(n, OFFSET, base_delta as f32, time);
        g.linear_ramp_to_value_at_time(n, OFFSET, peak_delta as f32, time + fa);
        g.linear_ramp_to_value_at_time(n, OFFSET, sus_delta as f32, time + fa + fd);
        g.set_value_at_time(n, OFFSET, sus_delta as f32, time + note_dur);
        g.linear_ramp_to_value_at_time(n, OFFSET, base_delta as f32, time + note_dur + fr);
    }

    /// `kyClassicOn`: a key held from now at velocity `vel`, with the
    /// filter's envelope as `kyNoteOn` gives it (a step long).
    pub fn key_on(&mut self, freq: f64, vel: f64) -> Option<Held> {
        let t = self.g.current_time();
        let slot = self.free_voice()?;
        let (osc, pulse) = self.oscillator()?;
        let Some(env) = self.g.gain() else {
            self.g.free(osc);
            if let Some(k) = pulse {
                self.pulse_used[k] = false;
            }
            return None;
        };
        let g = &mut self.g;
        g.set(osc, FREQUENCY, freq as f32);
        g.connect(osc, env);
        g.connect(env, self.filter);
        let s = &self.s;
        let a = s.adsr.a / 1000.0;
        let d = s.adsr.d / 1000.0;
        let su = s.adsr.s;
        g.set_value_at_time(env, GAIN, 0.0, t);
        g.linear_ramp_to_value_at_time(env, GAIN, vel as f32, t + a);
        g.linear_ramp_to_value_at_time(env, GAIN, (su * vel) as f32, t + a + d);
        g.start(osc, t);
        let id = self.next_id;
        self.next_id += 1;
        self.voices[slot] = Voice { used: true, osc, env, pulse, end: f64::INFINITY, id };
        let dur = self.s.step_dur();
        self.note_filter_env(freq, t, dur);
        Some(Held(id))
    }

    /// The held key's `release(at)`.
    pub fn release(&mut self, held: Held, at: f64) {
        let Some(slot) = self.voices.iter().position(|v| v.used && v.id == held.0) else { return };
        let v = self.voices[slot];
        let r = self.s.adsr.r / 1000.0;
        let g = &mut self.g;
        g.cancel_scheduled_values(v.env, GAIN, at);
        g.cancel_and_hold_at_time(v.env, GAIN, at);
        g.linear_ramp_to_value_at_time(v.env, GAIN, 0.0, at + 0.005f64.max(r));
        let end = at + r + 0.05;
        g.stop(v.osc, end);
        self.voices[slot].end = end;
    }

    /// `tapeGlideValueAt`: the delay time the glide has reached at `now`.
    fn tape_glide_value_at(&mut self, now: f64) -> f64 {
        match self.glide {
            None => self.g.param(self.delay_l, DELAY_TIME).intrinsic() as f64,
            Some(g) => {
                if now >= g.start + g.t {
                    g.d_end
                } else if now <= g.start {
                    g.l / g.v0
                } else {
                    let f = (now - g.start) / g.t;
                    g.l / (g.v0 + (g.v1 - g.v0) * f)
                }
            }
        }
    }

    /// `tapeGlideDelayTime`: a new tempo (`bpm_target`) retimes the loop the
    /// tape way, gliding its speed from `start_delay` seconds on.
    pub fn tape_glide(&mut self, start_delay: f64) {
        let now = self.g.current_time();
        let d_target = 4f64.min(0.005f64.max((60.0 / self.bpm_target) * self.s.delay.subdiv));
        let d_now = self.tape_glide_value_at(now);
        if (d_target - d_now).abs() < 0.0005 {
            return;
        }
        let l = self.s.tape_ips * TAPE_HEADGAP_S;
        let v0 = l / d_now;
        let v1 = l / d_target;
        let mut t = 10f64.min(0.02f64.max((v1 - v0).abs() / TAPE_ACCEL));
        t = t.max((d_target - d_now).abs() / 0.85);
        let start = now + start_delay;
        let n = TAPE_CURVE_MAX.min(16usize.max((t * 2000.0).ceil() as usize));
        self.curve.clear();
        for i in 0..n {
            self.curve.push((l / (v0 + ((v1 - v0) * i as f64) / (n - 1) as f64)) as f32);
        }
        for d in [self.delay_l, self.delay_r] {
            self.g.cancel_and_hold_at_time(d, DELAY_TIME, now);
            self.g.set_value_at_time(d, DELAY_TIME, d_now as f32, now);
            self.g.set_value_curve_at_time(d, DELAY_TIME, &self.curve, start, t);
        }
        self.glide = Some(Glide { v0, v1, l, start, t, d_end: d_target });
    }

    // ── The page's controls, each as its update function does it ──────────

    /// `updateVol`: `seqVol.gain.value = volume`.
    pub fn set_volume(&mut self, volume: f64) {
        self.s.volume = volume;
        self.g.set(self.seq_vol, GAIN, volume as f32);
    }

    /// `updateFilter`: the base cutoff glides there (the note's envelope
    /// keeps running), Q is set, and the filter LFOs' depths follow.
    pub fn set_filter(&mut self, cutoff: f64, q: f64) {
        self.s.cutoff = cutoff;
        self.s.q = q;
        let now = self.g.current_time();
        self.g.cancel_and_hold_at_time(self.cutoff_base, OFFSET, now);
        self.g.set_target_at_time(self.cutoff_base, OFFSET, cutoff as f32, now, 0.015);
        self.g.set(self.filter, Q, q as f32);
        for i in 0..3 {
            if self.s.lfos[i].target == Target::Filter {
                let v = self.lfo_gain_value(i);
                self.g.set(self.lfo_gain[i], GAIN, v as f32);
            }
        }
    }

    /// `updateLFO(i)`: its wave, rate and depth.
    pub fn set_lfo(&mut self, i: usize, rate: f64, depth: f64, wave: Shape) {
        let l = &mut self.s.lfos[i];
        l.rate = rate;
        l.depth = depth;
        l.wave = wave;
        if let Some(w) = wave.builtin() {
            self.g.set_oscillator_wave(self.lfo_osc[i], w);
        }
        self.g.set(self.lfo_osc[i], FREQUENCY, rate as f32);
        let v = self.lfo_gain_value(i);
        self.g.set(self.lfo_gain[i], GAIN, v as f32);
    }

    /// `changeLFOTarget(i, target)`.
    pub fn set_lfo_target(&mut self, i: usize, target: Target) {
        self.s.lfos[i].target = target;
        self.connect_lfo(i);
    }

    /// `updateDelay`: a new subdivision glides the tape there, the rest is
    /// set at once.
    pub fn set_delay(&mut self, d: Delay) {
        let prev = self.s.delay.subdiv;
        self.s.delay = d;
        if d.subdiv != prev {
            self.tape_glide(0.0);
        }
        let g = &mut self.g;
        g.set(self.fb_lr, GAIN, d.feedback as f32);
        g.set(self.fb_rl, GAIN, d.feedback as f32);
        g.set(self.pan_l, PAN, (-d.spread) as f32);
        g.set(self.pan_r, PAN, d.spread as f32);
        g.set(self.hi_lr, FREQUENCY, d.hi_cut as f32);
        g.set(self.hi_rl, FREQUENCY, d.hi_cut as f32);
        g.set(self.delay_dry, GAIN, (1.0 - d.wet) as f32);
        g.set(self.delay_wet, GAIN, d.wet as f32);
    }

    /// `updateBPM`: the tempo heads for `bpm`; the delay's loop glides
    /// there after the hold, and the steps' tempo slews ([`Self::slew`]).
    pub fn set_bpm(&mut self, bpm: f64) {
        self.bpm_target = bpm;
        self.slew_hold_until = self.g.current_time() + BPM_SLEW_DELAY_S;
        self.tape_glide(BPM_SLEW_DELAY_S);
        self.slewing = true;
    }

    /// One tick of the tempo slew, `dt` seconds after the last
    /// (`startBpmSlew`'s interval).
    pub fn slew(&mut self, dt: f64) {
        if !self.slewing || self.g.current_time() < self.slew_hold_until {
            return;
        }
        let dt = dt.max(0.001);
        let mut step = (self.bpm_target - self.s.bpm) * (1.0 - fdlibm::exp(-dt / BPM_SLEW_TAU));
        let max_step = BPM_SLEW_MAX_RATE * dt;
        step = (-max_step).max(max_step.min(step));
        self.s.bpm += step;
        if (self.bpm_target - self.s.bpm).abs() < 0.05 {
            self.s.bpm = self.bpm_target;
        }
        if self.s.bpm == self.bpm_target {
            self.slewing = false;
        }
    }

    /// Every note let go now (the page's Stop leaves sounding notes to
    /// their release; this is for a module taken out of a patch).
    pub fn release_all(&mut self, at: f64) {
        for slot in 0..MAX_VOICES {
            let v = self.voices[slot];
            if v.used && v.end == f64::INFINITY {
                self.release(Held(v.id), at);
            }
        }
    }

    /// Freeze (`atFrozen = true; atmosFreezeApply()`): Space's gate closes
    /// and its tail goes round the loop, from now.
    pub fn freeze(&mut self, on: bool) {
        self.space.frozen = on;
        let s = self.s.space;
        self.space.apply(&mut self.g, &s);
    }

    /// Notes that are over, and silent for good, give their nodes back.
    fn collect(&mut self) {
        let now = self.g.current_time();
        for slot in 0..MAX_VOICES {
            let v = self.voices[slot];
            if !v.used || v.end > now {
                continue;
            }
            if self.g.finished(v.osc) && self.g.silent(v.env) {
                self.g.free_quiet(v.osc);
                self.g.free_quiet(v.env);
                if let Some(k) = v.pulse {
                    self.pulse_used[k] = false;
                }
                self.voices[slot] = Voice::EMPTY;
            }
        }
    }

    /// Notes sounding.
    pub fn sounding(&self) -> usize {
        self.voices.iter().filter(|v| v.used).count()
    }

    /// Render one quantum (128 frames) into `l` and `r`: what reaches the
    /// page's destination.
    pub fn render(&mut self, l: &mut [f32], r: &mut [f32]) {
        // Chromium renders with denormals flushed to zero (`DenormalDisabler`).
        let fz = DenormalsOff::new();
        self.g.render(&[self.out]);
        drop(fz);
        let b = self.g.bus(self.out);
        let n = l.len().min(r.len()).min(QUANTUM);
        l[..n].copy_from_slice(&b.data[0][..n]);
        r[..n].copy_from_slice(&b.data[1][..n]);
        self.collect();
        let _ = (self.cutoff_base, self.delay_dry);
    }
}

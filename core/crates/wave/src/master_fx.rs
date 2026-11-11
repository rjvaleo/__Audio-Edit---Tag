//! The master chain: the FX view's five units on the synth's output, after
//! `master` and before it leaves [`Synth::render`](crate::Synth::render), in
//! the page's order: Drive → Chorus → Delay → Reverb → EQ.
//!
//! Since v8 the board (`board.rs`) is the FX view, and a patch's chain
//! becomes a board by migration (`board/migrate.rs`). This runs only for a
//! synth that has never been given a board, and it stays as the reference
//! the migration is held to, bit for bit.
//!
//! Four of the units are the shared effects in `prism-fx`, the ones the rack
//! and idMLab run, each allocated once here and driven fully wet; the chain
//! does the mixing itself, so every unit's mix and bypass glide the same way:
//! - **Chorus** is the Dattorro white chorus (`MglWhiteChorus`): a 12 ms line
//!   swept by `k1 · 8` ms at `0.1 · 40^k0` Hz (0.1–4 Hz), the right side a
//!   quarter cycle on, no feedback. `k2` crossfades dry to wet.
//! - **Delay** is the rack's echo (`Echo`): `20 + k0 · 980` ms, feedback
//!   `0.15 + k1 · 0.8` (the page draws repeat *r* at that to the power *r*),
//!   damping 0.2, its tape glide on a moved time. The echoes are added to the
//!   dry signal at `k2`, as the oscillators' own delay does.
//! - **Reverb** is the Dattorro plate (`MglDattorroPlate`): Size sets the
//!   decay, `0.2 + k0 · 0.7`, and the predelay, `k0 · 30` ms; Damp sets the
//!   tank's damping, `k1 · 0.9`. `k2` is an equal-power mix.
//! - **EQ** is the rack's EQ (`Eq`): its low shelf at 100 Hz, a bell at 1 kHz
//!   (Q 0.7) and its high shelf at 8 kHz, each `(k − 0.5) · 30` dB, the page's
//!   ±15 dB. The rumble high-pass is switched off. All three at 0.5 is flat,
//!   and a flat `Eq` passes the sound untouched.
//!
//! **Drive** is the one written here, because no shared effect is this curve:
//! the page's `tanh(x · d) / tanh(d)`, `d = 1 + k0 · 12` (the same law the
//! oscillators' cycle drive uses, with the page's range), then a one-pole
//! low-pass for Tone at `1000 · 20^k1` Hz, then a dry/wet crossfade at `k2`.
//!
//! # Moving and bypassing without clicks
//!
//! The knob values come from the synth's own smoothed copy of the patch (the
//! 15 ms glide `set_param` and `adopt` already drive), read once per control
//! block. Mix and drive amounts are ramped across each block on top of that.
//! A unit's `fxI.on` crossfades it in or out over 10 ms. Once it is all the
//! way out it is skipped, so a bypassed unit is bit-exact; it is cleared when
//! it next comes in, so it never opens with the tail it had when it went out.
//!
//! # Real time
//!
//! Every line is allocated by [`MasterFx::new`]; the kernels never allocate
//! after `new` (the `prism-fx` contract tests hold them to that). Clearing a
//! unit is a fill, not an allocation. Nothing here locks or transforms.

use prism_fx::effects::{Echo, Eq, MglDattorroPlate, MglWhiteChorus};
use prism_fx::Kernel;

use crate::patch::{FX_BASE, FX_STRIDE, NUM_PARAMS};
use crate::voice::BLOCK;

/// Units in the chain, in the page's order.
pub const FX_UNITS: usize = 5;
const DRIVE: usize = 0;
const CHORUS: usize = 1;
const DELAY: usize = 2;
const REVERB: usize = 3;
const EQ: usize = 4;

/// The bypass crossfade.
const FADE_SECONDS: f32 = 0.010;

/// A kernel's parameter index by key, found once at construction.
fn index<K: Kernel>(key: &str) -> usize {
    K::descriptor().params.iter().position(|p| p.key == key).unwrap_or(usize::MAX)
}

/// The Drive unit, shared with the board's `wave:drive` node so a migrated
/// patch drives the same curve.
pub(crate) struct Drive {
    sr: f32,
    /// The curve's `d` at the end of the last block.
    d: f32,
    lp: [f32; 2],
}

impl Drive {
    /// A Drive at rest at `k0`, so its first block does not glide in.
    pub(crate) fn new(sample_rate: f32, k0: f32) -> Drive {
        Drive { sr: sample_rate, d: Drive::amount(k0), lp: [0.0; 2] }
    }

    fn amount(k0: f32) -> f32 {
        1.0 + k0.clamp(0.0, 1.0) * 12.0
    }

    pub(crate) fn reset(&mut self) {
        self.lp = [0.0; 2];
    }

    pub(crate) fn process(&mut self, k0: f32, k1: f32, l: &mut [f32], r: &mut [f32]) {
        let n = l.len();
        let d1 = Drive::amount(k0);
        let dd = (d1 - self.d) / n as f32;
        let fc = 1000.0 * 20f32.powf(k1.clamp(0.0, 1.0));
        let c = 1.0 - (-std::f32::consts::TAU * fc / self.sr).exp();
        let mut d = self.d;
        for i in 0..n {
            d += dd;
            let norm = 1.0 / d.tanh();
            for (ch, s) in [&mut l[i], &mut r[i]].into_iter().enumerate() {
                let y = (*s * d).tanh() * norm;
                self.lp[ch] += c * (y - self.lp[ch]);
                *s = self.lp[ch];
            }
        }
        self.d = d1;
    }
}

/// Parameter indices into the shared kernels.
struct Ids {
    ch_delay: usize,
    ch_depth: usize,
    ch_rate: usize,
    ch_fb: usize,
    ch_wet: usize,
    ch_dry: usize,
    ch_stereo: usize,
    dl_time: usize,
    dl_fb: usize,
    dl_damp: usize,
    dl_wet: usize,
    dl_dry: usize,
    rv_pre: usize,
    rv_decay: usize,
    rv_damp: usize,
    rv_wet: usize,
    rv_dry: usize,
    eq_hp_on: usize,
    eq_low: usize,
    eq_mid: usize,
    eq_mid_q: usize,
    eq_high: usize,
}

pub(crate) struct MasterFx {
    drive: Drive,
    chorus: MglWhiteChorus,
    delay: Echo,
    reverb: MglDattorroPlate,
    eq: Eq,
    ids: Ids,
    /// How far the bypass crossfade moves per sample.
    fade: f32,
    /// Each unit's crossfade, 0 (bypassed) to 1 (in).
    on: [f32; FX_UNITS],
    /// The unit holds state from before it was last bypassed.
    stale: [bool; FX_UNITS],
    /// The knob values each unit's kernel was last set from.
    sent: [[f32; 3]; FX_UNITS],
    /// Each unit's mix at the end of the last block.
    mix: [f32; FX_UNITS],
    wet: Box<[[f32; BLOCK]; 2]>,
}

impl MasterFx {
    /// The chain at the output rate, set from a patch's values.
    pub fn new(sample_rate: f32, vals: &[f32; NUM_PARAMS]) -> MasterFx {
        let ids = Ids {
            ch_delay: index::<MglWhiteChorus>("delayMs"),
            ch_depth: index::<MglWhiteChorus>("depthMs"),
            ch_rate: index::<MglWhiteChorus>("rateHz"),
            ch_fb: index::<MglWhiteChorus>("feedback"),
            ch_wet: index::<MglWhiteChorus>("wet"),
            ch_dry: index::<MglWhiteChorus>("dry"),
            ch_stereo: index::<MglWhiteChorus>("stereo"),
            dl_time: index::<Echo>("delayMs"),
            dl_fb: index::<Echo>("feedback"),
            dl_damp: index::<Echo>("damping"),
            dl_wet: index::<Echo>("wet"),
            dl_dry: index::<Echo>("dry"),
            rv_pre: index::<MglDattorroPlate>("predelayMs"),
            rv_decay: index::<MglDattorroPlate>("decay"),
            rv_damp: index::<MglDattorroPlate>("damping"),
            rv_wet: index::<MglDattorroPlate>("wet"),
            rv_dry: index::<MglDattorroPlate>("dry"),
            eq_hp_on: index::<Eq>("band.0.enabled"),
            eq_low: index::<Eq>("band.1.gainDb"),
            eq_mid: index::<Eq>("band.2.gainDb"),
            eq_mid_q: index::<Eq>("band.2.q"),
            eq_high: index::<Eq>("band.6.gainDb"),
        };
        let mut fx = MasterFx {
            drive: Drive::new(sample_rate, unit(vals, DRIVE).1[0]),
            chorus: MglWhiteChorus::new(sample_rate),
            delay: Echo::new(sample_rate),
            reverb: MglDattorroPlate::new(sample_rate),
            eq: Eq::new(sample_rate),
            ids,
            fade: 1.0 / (FADE_SECONDS * sample_rate).max(1.0),
            on: [0.0; FX_UNITS],
            stale: [false; FX_UNITS],
            sent: [[f32::NAN; 3]; FX_UNITS],
            mix: [0.0; FX_UNITS],
            wet: Box::new([[0.0; BLOCK]; 2]),
        };
        let id = &fx.ids;
        for (i, v) in [(id.ch_delay, 12.0), (id.ch_fb, 0.0), (id.ch_wet, 1.0), (id.ch_dry, 0.0), (id.ch_stereo, 0.5)] {
            fx.chorus.set_param(i, v);
        }
        for (i, v) in [(id.dl_damp, 0.2), (id.dl_wet, 1.0), (id.dl_dry, 0.0)] {
            fx.delay.set_param(i, v);
        }
        for (i, v) in [(id.rv_wet, 1.0), (id.rv_dry, 0.0)] {
            fx.reverb.set_param(i, v);
        }
        for (i, v) in [(id.eq_hp_on, 0.0), (id.eq_mid_q, 0.7)] {
            fx.eq.set_param(i, v);
        }
        for u in 0..FX_UNITS {
            let (on, k) = unit(vals, u);
            fx.configure(u, k);
            fx.on[u] = on;
            fx.mix[u] = mix_of(u, k);
        }
        fx
    }

    /// Set a unit's kernel from its knobs, if they moved.
    fn configure(&mut self, u: usize, k: [f32; 3]) {
        if self.sent[u] == k {
            return;
        }
        let was = self.sent[u];
        self.sent[u] = k;
        let moved = |j: usize| was[j] != k[j];
        let id = &self.ids;
        match u {
            CHORUS => {
                if moved(0) {
                    self.chorus.set_param(id.ch_rate, 0.1 * 40f32.powf(k[0]));
                }
                if moved(1) {
                    self.chorus.set_param(id.ch_depth, k[1] * 8.0);
                }
            }
            DELAY => {
                if moved(0) {
                    self.delay.set_param(id.dl_time, 20.0 + k[0] * 980.0);
                }
                if moved(1) {
                    self.delay.set_param(id.dl_fb, 0.15 + k[1] * 0.8);
                }
            }
            REVERB => {
                if moved(0) {
                    self.reverb.set_param(id.rv_decay, 0.2 + k[0] * 0.7);
                    self.reverb.set_param(id.rv_pre, k[0] * 30.0);
                }
                if moved(1) {
                    self.reverb.set_param(id.rv_damp, k[1] * 0.9);
                }
            }
            EQ => {
                for (j, i) in [id.eq_low, id.eq_mid, id.eq_high].into_iter().enumerate() {
                    if moved(j) {
                        self.eq.set_param(i, (k[j] - 0.5) * 30.0);
                    }
                }
            }
            _ => {}
        }
    }

    fn clear(&mut self, u: usize) {
        match u {
            DRIVE => self.drive.reset(),
            CHORUS => self.chorus.reset(),
            DELAY => self.delay.reset(),
            REVERB => self.reverb.reset(),
            _ => self.eq.reset(),
        }
    }

    /// Silence every tail now.
    pub fn reset(&mut self) {
        for u in 0..FX_UNITS {
            self.clear(u);
            self.stale[u] = false;
        }
    }

    /// Run the chain over `l` and `r` in place, with the knobs at `vals`.
    pub fn process(&mut self, vals: &[f32; NUM_PARAMS], l: &mut [f32], r: &mut [f32]) {
        let n = l.len().min(r.len());
        let mut done = 0;
        while done < n {
            let len = BLOCK.min(n - done);
            self.block(vals, &mut l[done..done + len], &mut r[done..done + len]);
            done += len;
        }
    }

    fn block(&mut self, vals: &[f32; NUM_PARAMS], l: &mut [f32], r: &mut [f32]) {
        let n = l.len();
        for u in 0..FX_UNITS {
            let (want, k) = unit(vals, u);
            if want == 0.0 && self.on[u] == 0.0 {
                continue;
            }
            if self.on[u] == 0.0 && self.stale[u] {
                self.clear(u);
                self.stale[u] = false;
            }
            self.configure(u, k);
            let m1 = mix_of(u, k);
            if self.on[u] == 0.0 {
                self.mix[u] = m1;
            }
            let [wl, wr] = &mut *self.wet;
            let (wl, wr) = (&mut wl[..n], &mut wr[..n]);
            wl.copy_from_slice(l);
            wr.copy_from_slice(r);
            match u {
                DRIVE => self.drive.process(k[0], k[1], wl, wr),
                CHORUS => self.chorus.process(wl, wr),
                DELAY => self.delay.process(wl, wr),
                REVERB => self.reverb.process(wl, wr),
                _ => self.eq.process(wl, wr),
            }
            let m0 = self.mix[u];
            let dm = (m1 - m0) / n as f32;
            let mut on = self.on[u];
            for i in 0..n {
                // Toward the switch, and still once there: a unit all the way
                // in must not step a fade's worth out every other sample.
                on = if want > on {
                    (on + self.fade).min(1.0)
                } else if want < on {
                    (on - self.fade).max(0.0)
                } else {
                    on
                };
                let (dry, wet) = law(u, m0 + dm * (i + 1) as f32);
                let dry = 1.0 - on * (1.0 - dry);
                let wet = on * wet;
                l[i] = l[i] * dry + wl[i] * wet;
                r[i] = r[i] * dry + wr[i] * wet;
            }
            self.on[u] = on;
            self.mix[u] = m1;
            if on == 0.0 {
                self.stale[u] = true;
            }
        }
    }
}

/// A unit's switch (0 or 1) and knobs from the patch values.
#[inline]
fn unit(vals: &[f32; NUM_PARAMS], u: usize) -> (f32, [f32; 3]) {
    let b = FX_BASE + u * FX_STRIDE;
    let on = if vals[b] >= 0.5 { 1.0 } else { 0.0 };
    (on, [vals[b + 1], vals[b + 2], vals[b + 3]])
}

/// The mix a unit's knobs ask for. The EQ has none: in is all of it.
#[inline]
fn mix_of(u: usize, k: [f32; 3]) -> f32 {
    if u == EQ {
        1.0
    } else {
        k[2].clamp(0.0, 1.0)
    }
}

/// Dry and wet gains for a unit at mix `m`.
#[inline]
fn law(u: usize, m: f32) -> (f32, f32) {
    match u {
        DELAY => (1.0, m),
        REVERB => {
            let (s, c) = (m * std::f32::consts::FRAC_PI_2).sin_cos();
            (c, s)
        }
        EQ => (0.0, 1.0),
        _ => (1.0 - m, m),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_kernel_control_the_chain_sets_exists() {
        let fx = MasterFx::new(48_000.0, &crate::PatchState::default().values);
        let i = &fx.ids;
        let chorus = [i.ch_delay, i.ch_depth, i.ch_rate, i.ch_fb, i.ch_wet, i.ch_dry, i.ch_stereo];
        let delay = [i.dl_time, i.dl_fb, i.dl_damp, i.dl_wet, i.dl_dry];
        let reverb = [i.rv_pre, i.rv_decay, i.rv_damp, i.rv_wet, i.rv_dry];
        let eq = [i.eq_hp_on, i.eq_low, i.eq_mid, i.eq_mid_q, i.eq_high];
        for (name, ids, n) in [
            ("chorus", &chorus[..], MglWhiteChorus::descriptor().params.len()),
            ("delay", &delay[..], Echo::descriptor().params.len()),
            ("reverb", &reverb[..], MglDattorroPlate::descriptor().params.len()),
            ("eq", &eq[..], Eq::descriptor().params.len()),
        ] {
            assert!(ids.iter().all(|&x| x < n), "{name}: a key is missing from its kernel");
        }
        // And they took: the kernels run fully wet, the chain mixes.
        assert_eq!(fx.chorus.param(i.ch_wet), 1.0);
        assert_eq!(fx.chorus.param(i.ch_dry), 0.0);
        assert_eq!(fx.delay.param(i.dl_dry), 0.0);
        assert_eq!(fx.reverb.param(i.rv_dry), 0.0);
        assert_eq!(fx.eq.param(i.eq_hp_on), 0.0);
    }
}

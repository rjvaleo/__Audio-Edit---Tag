//! Planar rack plumbing. Effect arithmetic remains in each effect.
use super::*;

impl Slot {
    fn run_planar(
        &mut self,
        l: &mut [f32],
        r: &mut [f32],
        sr: u32,
        x: &mut [f32],
        adapter: &mut [f32],
    ) {
        let Some(next) = self.incoming.as_mut() else {
            self.effect.process_planar(l, r, sr, adapter);
            return;
        };
        let n = l.len();
        let (xl, xr) = x.split_at_mut(n);
        let xr = if r.is_empty() {
            &mut xr[..0]
        } else {
            &mut xr[..n]
        };
        xl.copy_from_slice(l);
        xr.copy_from_slice(r);
        self.effect.process_planar(l, r, sr, adapter);
        next.process_planar(xl, xr, sr, adapter);
        for f in 0..n {
            let at = self.fade_at + f;
            if at >= self.fade_len {
                l[f] = xl[f];
                if !r.is_empty() {
                    r[f] = xr[f];
                }
                continue;
            }
            let t = at as f32 / self.fade_len as f32 * std::f32::consts::FRAC_PI_2;
            let (old, new) = (t.cos(), t.sin());
            l[f] = l[f] * old + xl[f] * new;
            if !r.is_empty() {
                r[f] = r[f] * old + xr[f] * new;
            }
        }
        self.fade_at += n;
        if self.fade_at >= self.fade_len {
            self.land();
        }
    }

    fn blend_planar(&mut self, l: &mut [f32], r: &mut [f32], dry: &[f32], sr: u32) {
        let n = l.len();
        let k = 1.0 - (-1.0 / (SLOT_MIX_TAU * sr.max(1) as f32)).exp();
        for f in 0..n {
            self.wet_now += (self.wet - self.wet_now) * k;
            self.gain_now += (self.gain - self.gain_now) * k;
            l[f] = (dry[f] + (l[f] - dry[f]) * self.wet_now) * self.gain_now;
            if !r.is_empty() {
                r[f] = (dry[n + f] + (r[f] - dry[n + f]) * self.wet_now) * self.gain_now;
            }
        }
        if (self.wet - self.wet_now).abs() < 1e-5 {
            self.wet_now = self.wet;
        }
        if (self.gain - self.gain_now).abs() < 1e-5 {
            self.gain_now = self.gain;
        }
    }
}

fn place(
    p: &mut prism::prism_fx::place::Place,
    l: &mut [f32],
    r: &mut [f32],
    mono: &mut [f32],
    before: bool,
) {
    if r.is_empty() {
        let r = &mut mono[..l.len()];
        r.copy_from_slice(l);
        if before {
            p.before(l, r);
        } else {
            p.after(l, r);
        }
        for (l, r) in l.iter_mut().zip(r) {
            *l = 0.5 * (*l + *r);
        }
    } else if before {
        p.before(l, r);
    } else {
        p.after(l, r);
    }
}

impl RackMeters {
    fn write_planar(&self, stage: usize, l: &[f32], r: &[f32]) {
        if stage >= MAX_RACK_STAGES {
            return;
        }
        let peak = |s: &[f32]| s.iter().fold(0.0f32, |p, v| p.max(v.abs()));
        let left = peak(l);
        let right = if r.is_empty() { left } else { peak(r) };
        self.left[stage].fetch_max(left.to_bits(), Ordering::Release);
        self.right[stage].fetch_max(right.to_bits(), Ordering::Release);
    }
}

impl Rack {
    /// Process planar stereo, or mono with an empty right slice.
    pub fn process_planar(&mut self, l: &mut [f32], r: &mut [f32], sample_rate: u32) {
        assert!(r.is_empty() || l.len() == r.len());
        if !all_finite(l) || !all_finite(r) {
            l.fill(0.0);
            r.fill(0.0);
            self.tripped = self.tripped.wrapping_add(1);
            if let Some(m) = &self.meters {
                m.clear();
            }
            return;
        }
        let n = l.len();
        let samples = n + r.len();
        self.reserve_stages(samples);
        if let Some(m) = &self.meters {
            m.write_planar(0, l, r);
        }
        for (i, s) in self.slots.iter_mut().enumerate() {
            if !s.bypassed {
                let placed = s.place.as_ref().is_some_and(|p| p.settings().on);
                if placed {
                    place(
                        s.place.as_deref_mut().unwrap(),
                        l,
                        r,
                        &mut self.place_r,
                        true,
                    );
                }
                let plain = s.plain();
                if !plain {
                    self.dry[..n].copy_from_slice(l);
                    self.dry[n..samples].copy_from_slice(r);
                }
                s.run_planar(
                    l,
                    r,
                    sample_rate,
                    &mut self.xfade[..samples],
                    &mut self.adapter[..samples],
                );
                if placed {
                    place(
                        s.place.as_deref_mut().unwrap(),
                        l,
                        r,
                        &mut self.place_r,
                        false,
                    );
                }
                if !plain {
                    s.blend_planar(l, r, &self.dry[..samples], sample_rate);
                }
                if !all_finite(l) || !all_finite(r) {
                    l.fill(0.0);
                    r.fill(0.0);
                    s.effect.reset();
                    if let Some(next) = &mut s.incoming {
                        next.reset();
                    }
                    if let Some(p) = &mut s.place {
                        p.reset();
                    }
                    self.tripped = self.tripped.wrapping_add(1);
                }
            }
            if let Some(m) = &self.meters {
                m.write_planar(i + 1, l, r);
                m.write_telemetry(i + 1, s.effect.telemetry());
            }
        }
    }

    /// Compatibility edge: convert once, then keep the chain planar.
    pub fn process(&mut self, buf: &mut [f32], channels: usize, sr: u32) {
        let ch = channels.max(1);
        if ch > 2 || buf.len() % ch != 0 {
            self.process_interleaved(buf, channels, sr);
            return;
        }
        self.reserve_mix(buf.len());
        let n = buf.len() / ch;
        let mut left = std::mem::take(&mut self.planar_l);
        let mut right = std::mem::take(&mut self.planar_r);
        for (i, frame) in buf.chunks_exact(ch).enumerate() {
            left[i] = frame[0];
            if ch == 2 {
                right[i] = frame[1];
            }
        }
        self.process_planar(
            &mut left[..n],
            &mut right[..if ch == 2 { n } else { 0 }],
            sr,
        );
        for (i, frame) in buf.chunks_exact_mut(ch).enumerate() {
            frame[0] = left[i];
            if ch == 2 {
                frame[1] = right[i];
            }
        }
        self.planar_l = left;
        self.planar_r = right;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn every_effect_planar_matches_the_original_rack() {
        for entry in prism::catalogue() {
            for channels in [1, 2] {
                for block in [1, 7, 64, 128, 512] {
                    let mut old = Rack::with_capacity(1024);
                    let mut new = Rack::with_capacity(1024);
                    old.push(Box::new(
                        prism::PrismEffect::new(entry.descriptor.id, 48000).unwrap(),
                    ));
                    new.push(Box::new(
                        prism::PrismEffect::new(entry.descriptor.id, 48000).unwrap(),
                    ));
                    let mut input = vec![0.0; block * channels];
                    for turn in 0..8 {
                        for (i, v) in input.iter_mut().enumerate() {
                            *v = ((turn * input_len(block, channels) + i) as f32 * 0.017).sin()
                                * 0.125;
                        }
                        let mut reference = input.clone();
                        let mut l: Vec<_> = input.chunks_exact(channels).map(|f| f[0]).collect();
                        let mut r: Vec<_> = if channels == 2 {
                            input.chunks_exact(2).map(|f| f[1]).collect()
                        } else {
                            Vec::new()
                        };
                        old.process_interleaved(&mut reference, channels, 48000);
                        new.process_planar(&mut l, &mut r, 48000);
                        for (i, f) in reference.chunks_exact(channels).enumerate() {
                            assert_eq!(
                                l[i].to_bits(),
                                f[0].to_bits(),
                                "{} ch={channels} block={block} turn={turn}",
                                entry.descriptor.id
                            );
                            if channels == 2 {
                                assert_eq!(
                                    r[i].to_bits(),
                                    f[1].to_bits(),
                                    "{}",
                                    entry.descriptor.id
                                );
                            }
                        }
                    }
                }
            }
        }
    }
    #[test]
    fn footers_place_and_mode_fades_match_the_original_rack() {
        use prism::prism_fx::place::{Place, PlaceSettings};
        for channels in [1, 2] {
            for block in [1, 7, 64, 128, 512] {
                let make = || {
                    let mut rack = Rack::with_capacity(1024);
                    rack.push(Box::new(Gain { db: -3.0 }));
                    let mut place = Box::new(Place::new(48000.0));
                    place.set(PlaceSettings {
                        on: true,
                        ..Default::default()
                    });
                    rack.set_slot_place(0, Some(place));
                    rack.set_param(0, SLOT_WET, 0.7);
                    rack.set_param(0, SLOT_LEVEL, -4.0);
                    rack.swap_slot(0, prepare_effect(Box::new(Gain { db: 2.0 })), 271)
                        .unwrap_or_else(|_| panic!());
                    rack
                };
                let mut old = make();
                let mut new = make();
                for turn in 0..16 {
                    let mut reference: Vec<f32> = (0..block * channels)
                        .map(|i| ((turn * block * channels + i) as f32 * 0.13).sin() * 0.1)
                        .collect();
                    let mut l: Vec<_> = reference.chunks_exact(channels).map(|f| f[0]).collect();
                    let mut r: Vec<_> = if channels == 2 {
                        reference.chunks_exact(2).map(|f| f[1]).collect()
                    } else {
                        Vec::new()
                    };
                    old.process_interleaved(&mut reference, channels, 48000);
                    new.process_planar(&mut l, &mut r, 48000);
                    for (i, f) in reference.chunks_exact(channels).enumerate() {
                        assert_eq!(
                            l[i].to_bits(),
                            f[0].to_bits(),
                            "ch={channels} block={block} turn={turn}"
                        );
                        if channels == 2 {
                            assert_eq!(r[i].to_bits(), f[1].to_bits());
                        }
                    }
                }
            }
        }
    }
    #[test]
    fn meters_hold_the_peak_until_the_reader_consumes_it() {
        let meters = Arc::new(RackMeters::new());
        let mut rack = Rack::with_capacity(16);
        rack.push(Box::new(Gain { db: 0.0 }));
        rack.set_meters(meters.clone());
        rack.process(&mut [0.8, -0.7, 0.1, 0.2], 2, 48000);
        rack.process(&mut [0.1, 0.2, 0.05, 0.05], 2, 48000);
        let levels = meters.snapshot();
        assert_eq!(levels[0], (0.8, 0.7));
        assert_eq!(levels[1], (0.8, 0.7));
        assert!(meters.snapshot().iter().all(|&v| v == (0.0, 0.0)));
        rack.process_planar(&mut [0.4, 0.1], &mut [], 48000);
        assert_eq!(meters.snapshot()[1], (0.4, 0.4));
    }
    fn input_len(block: usize, channels: usize) -> usize {
        block * channels
    }
}

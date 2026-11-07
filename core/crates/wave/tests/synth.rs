//! The synth as the engine uses it: notes in, samples out, telemetry back.

use std::sync::Arc;

use wave::*;

const SR: f32 = 48_000.0;

fn table(name: &str) -> Arc<Wavetable> {
    Arc::new(Wavetable::from_frames(&builtin_frames(name).unwrap()))
}

/// A naive saw: every harmonic a 2048-point frame holds, the hardest case for
/// band-limiting.
fn saw_table() -> Arc<Wavetable> {
    let frame: Vec<f32> = (0..2048).map(|i| 1.0 - 2.0 * i as f32 / 2048.0).collect();
    Arc::new(Wavetable::from_frames(&[frame]))
}

/// One plain oscillator straight to the output: no warps, effects, unison,
/// filters, sub, noise or modulation.
fn clean_patch() -> Patch {
    let mut p = Patch::default();
    p.mods.clear();
    for n in 0..3 {
        let k = |f: &str| format!("osc{n}.{f}");
        p.set_num(&k("on"), if n == 0 { 1.0 } else { 0.0 });
        p.set_num(&k("warp0.amt"), 0.0);
        p.set_num(&k("warp1.amt"), 0.0);
        p.set_str(&k("warp0.mode"), "off");
        p.set_str(&k("warp1.mode"), "off");
        p.set_str(&k("fx.mode"), "off");
        p.set_num(&k("uni.n"), 1.0);
        p.set_num(&k("rand"), 0.0);
        p.set_num(&k("pitch"), 0.5);
        p.set_num(&k("fine"), 0.5);
        p.set_num(&k("pan"), 0.5);
        p.set_num(&k("level"), 1.0);
        p.set_num(&k("pos"), 0.0);
        p.set_str(&k("route"), "direct");
    }
    p.set_num("sub.on", 0.0);
    p.set_num("noise.on", 0.0);
    for f in 0..2 {
        p.set_str(&format!("filt{f}.type"), "lp");
        p.set_num(&format!("filt{f}.cut"), 1.0);
        p.set_num(&format!("filt{f}.res"), 0.0);
        p.set_num(&format!("filt{f}.drive"), 0.0);
        p.set_num(&format!("filt{f}.key"), 0.0);
    }
    for (k, v) in [("amp.a", 0.0), ("amp.d", 0.0), ("amp.s", 1.0), ("amp.r", 0.1), ("master", 1.0)] {
        p.set_num(k, v);
    }
    for i in 0..5 {
        p.set_num(&format!("fx{i}.on"), 0.0);
    }
    p
}

fn synth_with(p: &Patch, tables: [Arc<Wavetable>; 3]) -> Synth {
    let mut s = Synth::new(SR, 512);
    s.adopt(PatchState::new(p));
    for (i, t) in tables.into_iter().enumerate() {
        s.set_table(i, t);
    }
    s
}

fn default_tables() -> [Arc<Wavetable>; 3] {
    [table("Formant Sweep"), table("Vowel Ah–Oo"), table("Glass Organ")]
}

fn render(s: &mut Synth, frames: usize) -> (Vec<f32>, Vec<f32>) {
    let mut l = vec![0.0; frames];
    let mut r = vec![0.0; frames];
    for (cl, cr) in l.chunks_mut(256).zip(r.chunks_mut(256)) {
        s.render(cl, cr);
    }
    (l, r)
}

/// Spectrum magnitude in dBFS (a full-scale sine reads 0), Blackman-Harris.
fn spectrum_dbfs(x: &[f32]) -> Vec<f32> {
    let n = x.len();
    let (a0, a1, a2, a3) = (0.35875f64, 0.48829, 0.14128, 0.01168);
    let mut re: Vec<f32> = x
        .iter()
        .enumerate()
        .map(|(i, v)| {
            let t = std::f64::consts::TAU * i as f64 / n as f64;
            (*v as f64 * (a0 - a1 * t.cos() + a2 * (2.0 * t).cos() - a3 * (3.0 * t).cos())) as f32
        })
        .collect();
    let mut im = vec![0.0f32; n];
    assert!(audio_core::fft::fft(&mut re, &mut im));
    let scale = 2.0 / (n as f64 * a0);
    (0..n / 2)
        .map(|k| {
            let m = ((re[k] as f64).powi(2) + (im[k] as f64).powi(2)).sqrt() * scale;
            (20.0 * m.max(1e-12).log10()) as f32
        })
        .collect()
}

/// Worst non-harmonic component of a steady tone at `hz`, in dBFS, up to
/// `top` Hz.
fn worst_alias(x: &[f32], hz: f64, top: f64) -> f32 {
    let n = x.len();
    let db = spectrum_dbfs(x);
    let bin = SR as f64 / n as f64;
    let mut worst = -300.0f32;
    for (k, d) in db.iter().enumerate() {
        let f = k as f64 * bin;
        if f < 30.0 || f > top {
            continue; // the DC blocker's own tail lives below 30 Hz
        }
        let h = (f / hz).round();
        if h >= 1.0 && (f - h * hz).abs() <= 6.0 * bin {
            continue;
        }
        worst = worst.max(*d);
    }
    worst
}

/// Set the patch so note + osc pitch + fine lands on `hz`; returns the note.
fn tune(p: &mut Patch, hz: f64) -> u8 {
    let total = 69.0 + 12.0 * (hz / 440.0).log2();
    let note = total.round().clamp(0.0, 127.0);
    let semis = (total - note).round().clamp(-24.0, 24.0);
    let cents = (total - note - semis) * 100.0;
    p.set_num("osc0.pitch", (0.5 + semis / 48.0) as f32);
    p.set_num("osc0.fine", (0.5 + cents / 200.0) as f32);
    note as u8
}

fn sweep_worst(oversample: bool) -> (f32, f64) {
    let mut worst = (-300.0f32, 0.0f64);
    let steps = 40;
    for i in 0..=steps {
        let hz = 20.0 * 1000f64.powf(i as f64 / steps as f64);
        let mut p = clean_patch();
        let note = tune(&mut p, hz);
        let mut s = Synth::with_oversampling(SR, 512, oversample);
        s.adopt(PatchState::new(&p));
        s.set_table(0, saw_table());
        s.note_on(note, 1.0);
        render(&mut s, 4096);
        let (l, _) = render(&mut s, 32768);
        // Oversampled, the half-band decimator's transition band folds 24–28 kHz
        // into 20–24 kHz, by design: count what can be heard. Without it the
        // whole band to Nyquist must be clean.
        let top = if oversample { 20_000.0 } else { SR as f64 / 2.0 };
        let w = worst_alias(&l, hz, top);
        if w > worst.0 {
            worst = (w, hz);
        }
    }
    worst
}

#[test]
fn a_sweep_from_20_hz_to_20_khz_keeps_aliasing_below_minus_80_dbfs() {
    let (db, hz) = sweep_worst(false);
    assert!(db < -80.0, "aliasing at {db:.1} dBFS for a {hz:.0} Hz saw");
}

#[test]
fn the_sweep_is_as_clean_oversampled() {
    let (db, hz) = sweep_worst(true);
    assert!(db < -80.0, "aliasing at {db:.1} dBFS for a {hz:.0} Hz saw, oversampled");
}

#[test]
fn unison_loudness_stays_within_1_5_db_across_voice_counts() {
    let power = |n: usize| {
        let mut p = clean_patch();
        p.set_num("osc0.pos", 0.5);
        p.set_num("osc0.uni.n", n as f32);
        p.set_num("osc0.uni.det", 0.5);
        p.set_num("osc0.uni.spr", 0.7);
        p.set_num("osc0.rand", 0.25);
        let mut s = synth_with(&p, default_tables());
        s.note_on(69, 1.0);
        render(&mut s, 4800);
        let (l, r) = render(&mut s, 3 * 48_000);
        l.iter().zip(r.iter()).map(|(a, b)| (*a as f64).powi(2) + (*b as f64).powi(2)).sum::<f64>()
    };
    let one = power(1);
    for n in [2usize, 3, 4, 5, 6, 8, 12, 16] {
        let db = 10.0 * (power(n) / one).log10();
        assert!(db.abs() < 1.5, "{n} voices: {db:+.2} dB against one");
    }
}

#[test]
fn the_voice_bank_steals_the_oldest_note() {
    let mut p = clean_patch();
    p.set_num("amp.r", 1.0);
    let mut s = synth_with(&p, default_tables());
    let notes: Vec<u8> = (40..40 + POLYPHONY as u8).collect();
    for n in &notes {
        s.note_on(*n, 0.8);
        render(&mut s, 64);
    }
    let mut t = Telemetry::default();
    s.telemetry(&mut t);
    assert_eq!(t.voices().len(), POLYPHONY);

    s.note_on(100, 0.8);
    render(&mut s, 960); // the stolen voice's 5 ms fade, and some
    s.telemetry(&mut t);
    let sounding: Vec<u8> = t.voices().iter().map(|v| v.note).collect();
    assert_eq!(sounding.len(), POLYPHONY);
    assert!(!sounding.contains(&40), "the oldest note was not the one stolen");
    assert!(sounding.contains(&100));
    for n in &notes[1..] {
        assert!(sounding.contains(n), "note {n} was stolen instead");
    }

    // Again: the next oldest goes next.
    s.note_on(101, 0.8);
    render(&mut s, 960);
    s.telemetry(&mut t);
    assert!(!t.voices().iter().any(|v| v.note == 41));
}

#[test]
fn a_released_tail_does_not_count_against_polyphony() {
    let mut p = clean_patch();
    p.set_num("amp.r", 1.0);
    let mut s = synth_with(&p, default_tables());
    s.note_on(30, 0.8);
    s.note_off(30);
    for n in 40..40 + POLYPHONY as u8 {
        s.note_on(n, 0.8);
    }
    render(&mut s, 960);
    assert_eq!(s.active_voices(), POLYPHONY + 1, "a held note was stolen for a tail's sake");
}

#[test]
fn a_notes_envelope_follows_the_documented_times_within_2_percent() {
    let mut p = clean_patch();
    // attack 0.5² · 4 = 1 s, decay 0.6² · 4 = 1.44 s, release 0.4² · 6 = 0.96 s.
    for (k, v) in [("amp.a", 0.5), ("amp.d", 0.6), ("amp.s", 0.5), ("amp.r", 0.4)] {
        p.set_num(k, v);
    }
    let mut s = synth_with(&p, default_tables());
    s.note_on(60, 1.0);
    let mut t = Telemetry::default();
    let block = 32;
    let mut frame = 0usize;
    let (mut attack_end, mut decay_end, mut half) = (None, None, None);
    while frame < 3 * 48_000 {
        render(&mut s, block);
        frame += block;
        s.telemetry(&mut t);
        let v = t.voices()[0];
        if half.is_none() && frame >= 24_000 {
            half = Some(v.env);
        }
        if attack_end.is_none() && v.stage != Stage::Attack {
            attack_end = Some(frame);
        }
        if decay_end.is_none() && v.stage == Stage::Sustain {
            decay_end = Some(frame);
            assert!((v.env - 0.5).abs() < 1e-6);
        }
    }
    let secs = |f: usize| f as f32 / SR;
    let a = secs(attack_end.unwrap());
    let d = secs(decay_end.unwrap() - attack_end.unwrap());
    assert!((a - 1.0).abs() < 0.02, "attack took {a} s");
    assert!((d - 1.44).abs() < 0.02 * 1.44, "decay took {d} s");
    assert!((half.unwrap() - 0.5).abs() < 0.02, "attack is not linear: {} at half time", half.unwrap());

    s.note_off(60);
    let mut n = 0usize;
    while s.active_voices() > 0 && n < 3 * 48_000 {
        render(&mut s, block);
        n += block;
    }
    let r = secs(n);
    assert!((r - 0.96).abs() < 0.02 * 0.96, "release took {r} s");
}

fn performance(seed: u32) -> (Vec<f32>, Vec<f32>) {
    let mut p = Patch::default();
    p.set_num("noise.on", 1.0);
    p.set_str("osc2.fx.mode", "phaser");
    p.set_num("osc2.on", 1.0);
    let mut s = synth_with(&p, default_tables());
    s.set_seed(seed);
    let mut l = Vec::new();
    let mut r = Vec::new();
    let mut take = |s: &mut Synth, n: usize| {
        let (a, b) = render(s, n);
        l.extend(a);
        r.extend(b);
    };
    for (i, note) in [48u8, 55, 60, 64, 67].iter().enumerate() {
        s.note_on(*note, 0.5 + i as f32 * 0.1);
        take(&mut s, 3000);
    }
    s.mod_wheel(0.7);
    s.bend(0.4);
    take(&mut s, 9000);
    s.note_off(55);
    s.note_off(48);
    take(&mut s, 9000);
    s.all_notes_off();
    take(&mut s, 30_000);
    (l, r)
}

#[test]
fn a_seeded_render_is_deterministic() {
    let (l1, r1) = performance(7);
    let (l2, r2) = performance(7);
    assert!(l1.iter().any(|v| v.abs() > 0.01), "silent");
    assert!(l1.iter().zip(&l2).all(|(a, b)| a.to_bits() == b.to_bits()));
    assert!(r1.iter().zip(&r2).all(|(a, b)| a.to_bits() == b.to_bits()));
    let (l3, _) = performance(8);
    assert!(l1.iter().zip(&l3).any(|(a, b)| a != b), "the seed changes nothing");
}

fn max_step(x: &[f32]) -> f32 {
    x.windows(2).map(|w| (w[1] - w[0]).abs()).fold(0.0, f32::max)
}

#[test]
fn set_param_while_rendering_does_not_click() {
    // A low sine, so a click would stand far above the wave's own steps. The
    // bound allows for a filter's own transient when its cutoff sweeps seven
    // octaves in 15 ms (1.3x); the same cutoff jump unsmoothed steps 18x.
    let mut p = clean_patch();
    p.set_str("osc0.route", "F1");
    p.set_num("filt0.cut", 0.6);
    let jumps: [(&str, f32, f32); 7] = [
        ("master", 1.0, 0.1),
        ("master", 0.1, 1.0),
        ("osc0.level", 1.0, 0.05),
        ("osc0.level", 0.05, 1.0),
        ("osc0.pan", 0.0, 1.0),
        ("filt0.cut", 0.3, 1.0),
        ("filt0.res", 0.0, 1.0),
    ];
    for (key, from, to) in jumps {
        let mut q = p.clone();
        q.set_num(key, from);
        let mut s = synth_with(&q, default_tables());
        s.note_on(45, 1.0);
        render(&mut s, 9600);
        let (before, _) = render(&mut s, 4800);
        let id = s.param_id(key).unwrap();
        assert!(s.set_param(id, to));
        let (during, _) = render(&mut s, 2400);
        render(&mut s, 9600);
        let (after, _) = render(&mut s, 4800);
        let steady = max_step(&before).max(max_step(&after));
        let worst = max_step(&during);
        assert!(worst <= steady * 1.5 + 1e-4, "{key} {from} → {to}: step {worst} against {steady}");
    }
}

#[test]
fn the_default_patch_plays_every_mode_without_blowing_up() {
    let tables = default_tables();
    let mut patches = Vec::new();
    for warp in WarpMode::ALL {
        for fx in FxMode::ALL {
            let mut p = Patch::default();
            p.warp_modes[0] = [warp, WarpMode::Fm];
            p.values[2] = 0.7;
            p.values[3] = 0.4;
            p.fx_modes[0] = *fx;
            patches.push(p);
        }
    }
    for typ in FilterType::ALL {
        for route in FilterRoute::ALL {
            let mut p = Patch::default();
            p.filter_types = [*typ, *typ];
            p.filter_route = *route;
            p.routes = [Route::Both, Route::F2, Route::Direct];
            p.set_num("osc2.on", 1.0);
            p.set_num("noise.on", 1.0);
            p.set_num("filt0.res", 1.0);
            p.set_num("filt0.drive", 1.0);
            patches.push(p);
        }
    }
    for p in &patches {
        let mut s = synth_with(p, tables.clone());
        for n in [36u8, 60, 96] {
            s.note_on(n, 1.0);
        }
        let (l, r) = render(&mut s, 9600);
        let peak = l.iter().chain(r.iter()).fold(0.0f32, |m, v| m.max(v.abs()));
        assert!(peak.is_finite() && peak < 20.0, "{:?} {:?} {:?}: peak {peak}", p.warp_modes[0], p.fx_modes[0], p.filter_types[0]);
        assert!(peak > 1e-4, "{:?} {:?} {:?}: silent", p.warp_modes[0], p.fx_modes[0], p.filter_types[0]);
    }
}

#[test]
fn mono_and_legato_use_one_voice_and_return_to_the_held_note() {
    for mode in ["mono", "legato"] {
        let mut p = clean_patch();
        p.set_str("voice.mode", mode);
        p.set_num("voice.glide", 0.0);
        let mut s = synth_with(&p, default_tables());
        let mut t = Telemetry::default();
        s.note_on(60, 1.0);
        render(&mut s, 480);
        s.note_on(64, 1.0);
        render(&mut s, 480);
        s.telemetry(&mut t);
        assert_eq!(t.voices().len(), 1, "{mode}");
        assert_eq!(t.voices()[0].note, 64);
        s.note_off(64);
        render(&mut s, 480);
        s.telemetry(&mut t);
        assert_eq!(t.voices()[0].note, 60, "{mode}: did not return to the held key");
        assert_ne!(t.voices()[0].stage, Stage::Release);
        s.note_off(60);
        render(&mut s, 480);
        s.telemetry(&mut t);
        assert_eq!(t.voices()[0].stage, Stage::Release);
    }
}

#[test]
fn legato_does_not_retrigger_and_mono_does() {
    for (mode, retrigger) in [("mono", true), ("legato", false)] {
        let mut p = clean_patch();
        p.set_str("voice.mode", mode);
        p.set_num("amp.a", 0.3); // 360 ms
        let mut s = synth_with(&p, default_tables());
        let mut t = Telemetry::default();
        s.note_on(60, 1.0);
        render(&mut s, 48_000);
        s.note_on(62, 1.0);
        render(&mut s, 32);
        s.telemetry(&mut t);
        assert_eq!(t.voices()[0].stage == Stage::Attack, retrigger, "{mode}");
    }
}

#[test]
fn glide_slides_between_notes_in_mono() {
    // Count zero crossings over a stretch: halfway through a one-octave glide
    // the pitch is in between.
    let mut p = clean_patch();
    p.set_str("voice.mode", "legato");
    p.set_num("voice.glide", 0.5); // 0.5 s
    let mut s = synth_with(&p, default_tables());
    s.note_on(57, 1.0);
    render(&mut s, 4800);
    s.note_on(69, 1.0);
    render(&mut s, 12_000 - 2400);
    let (mid, _) = render(&mut s, 4800);
    let crossings = mid.windows(2).filter(|w| w[0] <= 0.0 && w[1] > 0.0).count() as f32;
    let hz = crossings / 0.1;
    assert!(hz > 260.0 && hz < 360.0, "{hz} Hz halfway through a 220 → 440 glide");
}

#[test]
fn telemetry_reports_modulated_destinations_and_lfos() {
    let mut p = clean_patch();
    p.mods = vec![Mod::new("lfo0", "osc0.pos", 0.5), Mod::new("macro0", "filt0.cut", -0.4), Mod::new("vel", "osc0.pos", 0.1)];
    p.set_num("macro0", 1.0);
    p.set_num("osc0.pos", 0.5);
    let mut s = synth_with(&p, default_tables());
    let mut t = Telemetry::default();
    render(&mut s, 2400);
    s.telemetry(&mut t);
    assert_eq!(t.mods().len(), 2);
    let cut = t.mods().iter().find(|m| m.0.key() == "filt0.cut").unwrap().1;
    assert!((cut - 0.6).abs() < 1e-3, "{cut}");
    let lfo = t.lfo[0];
    assert!((t.pos[0] - (0.5 + 0.5 * lfo)).abs() < 0.01, "no voice: pos {} lfo {lfo}", t.pos[0]);

    s.note_on(60, 1.0);
    render(&mut s, 64);
    s.telemetry(&mut t);
    assert_eq!(t.voices().len(), 1);
    assert!((t.pos[0] - (0.5 + 0.5 * t.lfo[0] + 0.1)).clamp(-1.0, 1.0).abs() < 0.02);
    assert!(t.peak[0] > 0.0);
}

#[test]
fn set_table_hands_back_the_old_table() {
    let mut s = Synth::new(SR, 256);
    let a = table("Grit Saw");
    assert!(s.set_table(0, a.clone()).is_none());
    let old = s.set_table(0, table("Hollow Pulse")).unwrap();
    assert!(Arc::ptr_eq(&old, &a));
    let back = s.set_table(7, a.clone()).unwrap();
    assert!(Arc::ptr_eq(&back, &a));
}

#[test]
fn an_oscillator_without_a_table_is_silent_and_harmless() {
    let mut s = Synth::new(SR, 256);
    s.note_on(60, 1.0);
    let (l, _) = render(&mut s, 4800);
    // Only the sub sounds in the default patch.
    assert!(l.iter().all(|v| v.is_finite()));
    let mut p = clean_patch();
    p.set_num("sub.on", 0.0);
    s.panic();
    s.adopt(PatchState::new(&p));
    s.note_on(60, 1.0);
    let (l, _) = render(&mut s, 4800);
    assert!(l.iter().all(|v| *v == 0.0));
}

/// The page's LFO Rise and Smooth (added after the contract): Rise fades the
/// LFO in from the note's start; Smooth lags it.
#[test]
fn lfo_rise_fades_in_from_the_note_and_smooth_lags_it() {
    // A square LFO, so the lag has a step to round off.
    let mut p = clean_patch();
    p.set_points("lfo0.points", &[(0.0, 1.0), (0.5, 1.0), (0.5, 0.0), (1.0, 0.0)]);
    p.set_num("lfo0.rate", 1.0);
    p.mods = vec![Mod::new("lfo0", "osc0.pos", 0.5)];
    let run = |rise: f32, smooth: f32, seconds: f32| {
        let mut p = p.clone();
        p.set_num("lfo0.rise", rise);
        p.set_num("lfo0.smooth", smooth);
        let mut s = Synth::new(SR, 512);
        s.adopt(PatchState::new(&p));
        s.set_table(0, saw_table());
        s.note_on(60, 1.0);
        let (mut l, mut r) = (vec![0.0f32; 64], vec![0.0f32; 64]);
        let mut t = Telemetry::default();
        let mut seen = Vec::new();
        for _ in 0..(seconds * SR / 64.0) as usize {
            s.render(&mut l, &mut r);
            s.telemetry(&mut t);
            seen.push(t.lfo[0]);
        }
        (seen, t.lfo_phase[0])
    };
    let (plain, phase) = run(0.0, 0.0, 0.2);
    assert!(plain.iter().any(|v| v.abs() > 0.99), "a square LFO reaches its ends");
    assert!((0.0..1.0).contains(&phase), "the phase is reported, 0..1: {phase}");
    // Rise 1 is two seconds: a fifth of a second in, it is still a tenth up.
    let (rising, _) = run(1.0, 0.0, 0.2);
    assert!(rising.iter().all(|v| v.abs() < 0.11), "rise: {:?}", rising.iter().fold(0.0f32, |m, v| m.max(v.abs())));
    assert!(rising.last().unwrap().abs() > 0.05, "and it is rising");
    // Smoothed, the square's edge takes many control blocks, not one.
    let (smooth, _) = run(0.0, 1.0, 1.2);
    let biggest_step = smooth.windows(2).fold(0.0f32, |m, w| m.max((w[1] - w[0]).abs()));
    let plain_step = run(0.0, 0.0, 1.2).0.windows(2).fold(0.0f32, |m, w| m.max((w[1] - w[0]).abs()));
    assert!(plain_step > 1.5, "the plain square jumps end to end: {plain_step}");
    assert!(biggest_step < 0.2, "smooth: {biggest_step}");
}

// ───────────────────────────────────────────────────────── the master chain

const FX_NAMES: [&str; 5] = ["drive", "chorus", "delay", "reverb", "eq"];

/// One master unit on, with its knobs, over the clean patch.
fn with_unit(u: usize, k: [f32; 3]) -> Patch {
    let mut p = clean_patch();
    p.set_num(&format!("fx{u}.on"), 1.0);
    for (j, v) in k.iter().enumerate() {
        p.set_num(&format!("fx{u}.k{j}"), *v);
    }
    p
}

/// Knobs that make each unit plainly audible.
const LOUD: [[f32; 3]; 5] = [[0.6, 0.6, 1.0], [0.5, 0.8, 0.5], [0.1, 0.4, 0.6], [0.5, 0.4, 0.5], [0.9, 0.5, 0.2]];

fn max_diff(a: &[f32], b: &[f32]) -> f32 {
    a.iter().zip(b).fold(0.0f32, |m, (x, y)| m.max((x - y).abs()))
}

#[test]
fn each_master_unit_changes_the_sound_and_bypasses_exactly() {
    for u in 0..5 {
        let name = FX_NAMES[u];
        let mut dry = synth_with(&clean_patch(), default_tables());
        let mut wet = synth_with(&with_unit(u, LOUD[u]), default_tables());
        for s in [&mut dry, &mut wet] {
            s.note_on(45, 1.0);
        }
        let (dl, dr) = render(&mut dry, 24_000);
        let (wl, wr) = render(&mut wet, 24_000);
        let d = max_diff(&dl, &wl).max(max_diff(&dr, &wr));
        assert!(d > 0.02, "{name} on changes nothing: {d}");

        // Switched off live, it fades out over 10 ms without a click…
        let (before, _) = render(&mut wet, 4800);
        render(&mut dry, 4800);
        assert!(wet.set_param(param_id(&format!("fx{u}.on")).unwrap(), 0.0));
        let (during, _) = render(&mut wet, 1200);
        render(&mut dry, 1200);
        // …and from then on is the dry synth, to the bit.
        let (dl, dr) = render(&mut dry, 9600);
        let (wl, wr) = render(&mut wet, 9600);
        assert!(dl.iter().zip(&wl).chain(dr.iter().zip(&wr)).all(|(a, b)| a.to_bits() == b.to_bits()), "{name} off is not the dry signal: {}", max_diff(&dl, &wl));
        let steady = max_step(&before).max(max_step(&dl));
        let worst = max_step(&during);
        assert!(worst <= steady * 1.5 + 2e-3, "{name} off clicks: step {worst} against {steady}");

        // Back on, it starts clean (no tail from before) and is heard again.
        assert!(wet.set_param(param_id(&format!("fx{u}.on")).unwrap(), 1.0));
        render(&mut dry, 4800);
        let (wl, _) = render(&mut wet, 4800);
        let (dl, _) = render(&mut dry, 4800);
        let (wl2, _) = render(&mut wet, 4800);
        assert!(wl.iter().all(|v| v.is_finite()));
        assert!(max_diff(&dl, &wl2) > 0.01, "{name} back on is not heard");
    }
}

#[test]
fn master_knob_moves_do_not_click() {
    // Each mix (the EQ's low gain) jumps end to end while a note holds.
    for u in 0..5 {
        let j = if u == 4 { 0 } else { 2 };
        for (from, to) in [(0.0f32, 1.0f32), (1.0, 0.0)] {
            let mut k = LOUD[u];
            k[j] = from;
            let mut s = synth_with(&with_unit(u, k), default_tables());
            s.note_on(45, 1.0);
            render(&mut s, 24_000);
            let (before, _) = render(&mut s, 4800);
            assert!(s.set_param(param_id(&format!("fx{u}.k{j}")).unwrap(), to));
            let (during, _) = render(&mut s, 2400);
            render(&mut s, 24_000);
            let (after, _) = render(&mut s, 4800);
            let steady = max_step(&before).max(max_step(&after));
            let worst = max_step(&during);
            assert!(worst <= steady * 1.5 + 1e-3, "{} k{j} {from} → {to}: step {worst} against {steady}", FX_NAMES[u]);
        }
    }
}

/// A 10 ms burst of a note, then silence, through `p`.
fn burst(p: &Patch, frames: usize) -> Vec<f32> {
    let mut p = p.clone();
    p.set_num("amp.r", 0.02);
    let mut s = synth_with(&p, default_tables());
    s.note_on(57, 1.0);
    let (mut l, _) = render(&mut s, 480);
    s.note_off(57);
    l.extend(render(&mut s, frames - 480).0);
    l
}

#[test]
fn the_delay_echoes_at_its_time() {
    // k0 0.2: 20 + 0.2 · 980 = 216 ms, 10 368 samples.
    let x = burst(&with_unit(2, [0.2, 0.0, 1.0]), 48_000);
    let dry = burst(&clean_patch(), 48_000);
    let onset = |x: &[f32], from: usize| from + x[from..].iter().position(|v| v.abs() > 1e-3).unwrap();
    let t0 = onset(&dry, 0);
    assert!(dry[4800..].iter().all(|v| v.abs() < 1e-5), "the dry burst ends");
    let t1 = onset(&x, 4800);
    let t2 = onset(&x, t1 + 4800);
    assert!((t1 as i64 - t0 as i64 - 10_368).abs() <= 48, "first echo at {} samples, not 10 368", t1 - t0);
    assert!((t2 as i64 - t1 as i64 - 10_368).abs() <= 48, "second echo {} samples on", t2 - t1);
    // Feedback 0.15: the second is far quieter than the first.
    let pk = |a: usize| x[a..a + 960].iter().fold(0.0f32, |m, v| m.max(v.abs()));
    assert!(pk(t2) < pk(t1) * 0.3, "{} then {}", pk(t1), pk(t2));
}

#[test]
fn the_reverb_tail_rings_and_decays() {
    let x = burst(&with_unit(3, [0.5, 0.4, 1.0]), 3 * 48_000);
    let rms = |a: f32, b: f32| {
        let s = &x[(a * SR) as usize..(b * SR) as usize];
        (s.iter().map(|v| (*v as f64).powi(2)).sum::<f64>() / s.len() as f64).sqrt()
    };
    let early = rms(0.1, 0.3);
    let mid = rms(0.8, 1.0);
    let late = rms(2.0, 2.2);
    assert!(early > 1e-3, "no tail after the burst: {early}");
    assert!(mid < early * 0.5 && late < mid * 0.5, "the tail does not decay: {early} {mid} {late}");
    assert!(late < early * 0.01, "still {:.1} dB at two seconds", 20.0 * (late / early).log10());
}

/// Power at `hz` (a single-bin DFT over whole cycles), in dB.
fn tone_db(x: &[f32], hz: f64) -> f64 {
    let n = ((x.len() as f64 * hz / SR as f64).floor() * SR as f64 / hz) as usize;
    let (mut re, mut im) = (0.0f64, 0.0f64);
    for (i, v) in x[..n].iter().enumerate() {
        let t = std::f64::consts::TAU * hz * i as f64 / SR as f64;
        re += *v as f64 * t.cos();
        im -= *v as f64 * t.sin();
    }
    10.0 * ((re * re + im * im) / (n as f64 * n as f64)).max(1e-30).log10()
}

#[test]
fn the_eq_low_boost_raises_the_low_band() {
    // A 55 Hz saw: the fundamental sits under the low shelf, the 73rd
    // harmonic (4015 Hz) between the bell and the high shelf.
    let run = |p: &Patch| {
        let mut s = synth_with(p, [saw_table(), saw_table(), saw_table()]);
        s.note_on(33, 1.0);
        render(&mut s, 9600);
        render(&mut s, 48_000).0
    };
    let mut flat = with_unit(4, [0.5, 0.5, 0.5]);
    flat.set_num("master", 0.3);
    let mut boost = flat.clone();
    boost.set_num("fx4.k0", 1.0);
    let mut dry = clean_patch();
    dry.set_num("master", 0.3);
    let dry = run(&dry);
    let flat = run(&flat);
    let boost = run(&boost);
    assert!(max_diff(&dry, &flat) < 1e-6, "a flat EQ is not transparent: {}", max_diff(&dry, &flat));
    let low = tone_db(&boost, 55.0) - tone_db(&dry, 55.0);
    let high = tone_db(&boost, 55.0 * 73.0) - tone_db(&dry, 55.0 * 73.0);
    assert!(low > 10.0, "+15 dB low shelf raises 55 Hz by only {low:.1} dB");
    assert!(high.abs() < 1.0, "and moves 4 kHz by {high:.1} dB");
}

#[test]
fn the_default_chain_is_gentle() {
    // The default patch with and without its chain: no louder than 3 dB.
    let run = |chain: bool| {
        let mut p = Patch::default();
        if !chain {
            for i in 0..5 {
                p.set_num(&format!("fx{i}.on"), 0.0);
            }
        }
        let mut s = synth_with(&p, default_tables());
        for n in [48u8, 55, 60, 64] {
            s.note_on(n, 0.8);
        }
        let (l, r) = render(&mut s, 48_000);
        l.iter().chain(&r).map(|v| (*v as f64).powi(2)).sum::<f64>()
    };
    let db = 10.0 * (run(true) / run(false)).log10();
    assert!(db.abs() < 3.0, "the default chain moves the level {db:+.1} dB");
}

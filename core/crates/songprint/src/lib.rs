//! What makes a song that song, read from its stems.
//!
//! Given the mix and its four stems (drums, bass, vocals, other), this reads:
//! tempo and how it moves, the beat and bar grid (4/4 assumed), key and key
//! changes, tuning and the scale in cents, drum bars as 16-step grids with
//! velocities and swing, the bass line as notes, a chord per bar, which stems
//! play in each bar and how bright and loud, the sections and how fast things
//! change, and the texture (brightness, noise, hiss, smear, echoes).
//!
//! The output is JSON a generator can steer from, and a short summary.
//! Everything here is signal processing from published descriptions; no model.

pub mod features;
pub mod json;
pub mod midi;
pub mod pitch;
pub mod rhythm;
pub mod sound;

use features::{Features, COARSE_HOP, COARSE_N, DECIMATE, FINE_HOP, FINE_N};
use json::J;
use std::collections::HashMap;
use std::path::Path;

pub const STEMS: [&str; 4] = ["drums", "bass", "vocals", "other"];

pub struct Report {
    pub json: J,
    pub summary: String,
}

fn db(x: f64) -> f32 {
    (10.0 * (x.max(1e-20)).log10()) as f32
}

fn median(v: &mut [f32]) -> f32 {
    rhythm::percentile(v, 0.5)
}

pub fn analyse(title: &str, mix_path: &Path, stems_dir: &Path, log: &mut dyn FnMut(&str)) -> Result<Report, String> {
    log("reading the mix");
    let mix = features::read(mix_path, false, true)?;
    let mut st: Vec<Features> = Vec::new();
    for s in STEMS {
        log(&format!("reading {s}"));
        st.push(features::read(&stems_dir.join(format!("{s}.wav")), s == "bass", false)?);
    }
    let rate = mix.rate as f32;
    let fr = rate / FINE_HOP as f32;
    let dur = mix.frames as f32 / rate;
    let coarse_at = |t: f32| (((t * rate - COARSE_N as f32 / 2.0) / COARSE_HOP as f32).max(0.0)) as usize;
    let fine_t = |f: f32| (f * FINE_HOP as f32 + FINE_N as f32 / 2.0) / rate;

    // ---- energy shares
    let stem_e: Vec<f64> = st.iter().map(|f| f.coarse.iter().map(|c| c.energy as f64).sum()).collect();
    let total_e: f64 = stem_e.iter().sum::<f64>().max(1e-20);

    // ---- tempo
    log("tempo and beats");
    let use_drums = stem_e[0] > 0.03 * total_e;
    let src = if use_drums { &st[0] } else { &mix };
    let bands: Vec<[f32; 3]> = src.fine.iter().map(|f| [f.low, f.mid, f.high]).collect();
    let env = rhythm::envelope(&bands);
    let (bpm, tconf) = rhythm::tempo(&env, fr);
    if bpm <= 0.0 {
        return Err("too short to find a tempo".into());
    }
    let mut tempo_map = Vec::new();
    let (win, hop) = ((30.0 * fr) as usize, (15.0 * fr) as usize);
    let mut s0 = 0;
    while s0 + win <= env.len() {
        let (mut t, c) = rhythm::tempo(&env[s0..s0 + win], fr);
        if t > 0.0 {
            while t > bpm * 1.4 {
                t /= 2.0;
            }
            while t < bpm / 1.4 {
                t *= 2.0;
            }
            tempo_map.push((fine_t((s0 + win / 2) as f32), t, c));
        }
        s0 += hop;
    }
    let period = fr * 60.0 / bpm;
    let beats = rhythm::beats(&env, period, 300.0);
    if beats.len() < 9 {
        return Err("too few beats".into());
    }

    // Band strengths near each beat, for the downbeat.
    let near = |v: &dyn Fn(usize) -> f32, f: f32, w: usize| -> (f32, f32) {
        let c = f.round() as usize;
        let (a, z) = (c.saturating_sub(w), (c + w + 1).min(src.fine.len()));
        let mut best = (0.0f32, 0.0f32);
        for i in a..z {
            let x = v(i);
            if x > best.0 {
                best = (x, i as f32 - f);
            }
        }
        best
    };
    let mut scale = [1.0f32; 3];
    for b in 0..3 {
        let mut v: Vec<f32> = bands.iter().map(|x| x[b]).collect();
        scale[b] = rhythm::percentile(&mut v, 0.97).max(1e-6);
    }
    let (bref, sref) = (&bands, &scale);
    let band = |b: usize| move |i: usize| bref[i][b] / sref[b];
    let bass_flux: Vec<f32> = st[1].fine.iter().map(|f| f.all).collect();
    let bass_scale = rhythm::percentile(&mut bass_flux.clone(), 0.97).max(1e-6);
    let lows: Vec<f32> = beats.iter().map(|&b| near(&band(0), b, 2).0).collect();
    let mids: Vec<f32> = beats.iter().map(|&b| near(&band(1), b, 2).0).collect();
    let changes: Vec<f32> = beats
        .iter()
        .map(|&b| near(&|i: usize| bass_flux.get(i).copied().unwrap_or(0.0) / bass_scale, b, 2).0 * 0.5)
        .collect();
    let o = rhythm::downbeat(&lows, &mids, &changes);
    let nbars = (beats.len() - o - 1) / 4;

    // ---- the grid: 16 steps a bar
    log("drums");
    let step_pos = |bar: usize, s: usize| -> (f32, f32) {
        let i = o + 4 * bar + s / 4;
        let gap = beats[i + 1] - beats[i];
        (beats[i] + gap * (s % 4) as f32 / 4.0, gap / 4.0)
    };
    // velocities [bar][band][step] and timing offsets in steps
    let mut grid = vec![[[0.0f32; 16]; 3]; nbars];
    let mut offs = vec![[[0.0f32; 16]; 3]; nbars];
    for (bar, g) in grid.iter_mut().enumerate() {
        for s in 0..16 {
            let (p, sl) = step_pos(bar, s);
            let w = ((sl / 2.0).round() as usize).max(1);
            for b in 0..3 {
                let (v, off) = near(&band(b), p, w);
                g[b][s] = v.min(1.0);
                offs[bar][b][s] = off / sl;
            }
        }
    }
    // Velocities: each band against its own typical step (the median is "nothing
    // here", the 95th percentile is a full hit), then the kick's click taken
    // out of the snare and hat bands, where it leaks.
    for b in 0..3 {
        let mut all: Vec<f32> = grid.iter().flat_map(|g| g[b].iter().copied()).collect();
        let lo = rhythm::percentile(&mut all, 0.5);
        let hi = rhythm::percentile(&mut all, 0.95).max(lo + 1e-6);
        for g in grid.iter_mut() {
            for v in g[b].iter_mut() {
                *v = ((*v - lo) / (hi - lo)).clamp(0.0, 1.0);
            }
        }
    }
    for g in grid.iter_mut() {
        for s in 0..16 {
            let k = g[0][s];
            for b in 1..3 {
                g[b][s] = ((g[b][s] - 0.6 * k) / 0.6).clamp(0.0, 1.0);
            }
        }
    }
    // Swing: where the off-beat eighths and sixteenths land, from hats then snares.
    let mut sw8 = Vec::new();
    let mut sw16 = Vec::new();
    let mut feel = [Vec::new(), Vec::new(), Vec::new()];
    for bar in 0..nbars {
        for s in 0..16 {
            for b in 0..3 {
                if grid[bar][b][s] < 0.4 {
                    continue;
                }
                let off = offs[bar][b][s];
                if s % 4 == 0 {
                    feel[b].push(off * 60_000.0 / bpm / 4.0);
                }
                if b > 0 && s % 4 == 2 {
                    sw8.push(off);
                }
                if b > 0 && s % 2 == 1 {
                    sw16.push(off);
                }
            }
        }
    }
    let swing8 = if sw8.len() > 8 { 100.0 * (2.0 + median(&mut sw8)) / 4.0 } else { 50.0 };
    let swing16 = if sw16.len() > 8 { 100.0 * (1.0 + median(&mut sw16)) / 2.0 } else { 50.0 };
    let feel_ms: Vec<f32> = feel.iter_mut().map(|v| if v.len() > 4 { median(v) } else { 0.0 }).collect();

    let glyph = |v: f32| if v >= 0.7 { 'X' } else if v >= 0.4 { 'x' } else { '.' };
    let pat = |bar: usize, b: usize| -> String { grid[bar][b].iter().map(|v| glyph(*v)).collect() };
    // Families of bars: a bar joins the first family whose first bar it differs
    // from by at most three hits (on = 0.4 and up); empty bars are left out.
    let onoff = |bar: usize| -> Vec<bool> { (0..3).flat_map(|b| (0..16).map(move |s| (b, s))).map(|(b, s)| grid[bar][b][s] >= 0.4).collect() };
    let mut fams: Vec<(Vec<bool>, usize, usize, Vec<usize>)> = Vec::new(); // (pattern, count, first, members)
    for bar in 0..nbars {
        let p = onoff(bar);
        if p.iter().filter(|x| **x).count() < 2 {
            continue;
        }
        match fams.iter_mut().find(|f| f.0.iter().zip(&p).filter(|(a, b)| a != b).count() <= 3) {
            Some(f) => {
                f.1 += 1;
                f.3.push(bar);
            }
            None => fams.push((p, 1, bar, vec![bar])),
        }
    }
    fams.sort_by(|a, b| b.1.cmp(&a.1).then(a.2.cmp(&b.2)));
    // Each family shown as its members' mean velocities.
    let common: Vec<(String, usize, usize)> = fams
        .iter()
        .map(|f| {
            let mean = |b: usize, s: usize| f.3.iter().map(|&m| grid[m][b][s]).sum::<f32>() / f.3.len() as f32;
            let row = |b: usize| -> String { (0..16).map(|s| glyph(mean(b, s))).collect() };
            (format!("{}|{}|{}", row(0), row(1), row(2)), f.1, f.2)
        })
        .collect();
    let mut counts: HashMap<String, usize> = HashMap::new();
    for bar in 0..nbars {
        *counts.entry(format!("{}|{}|{}", pat(bar, 0), pat(bar, 1), pat(bar, 2))).or_insert(0) += 1;
    }
    let exact_distinct = counts.len();

    // ---- the bass line
    log("bass line");
    let lr = rate / DECIMATE as f32;
    let low = &st[1].low_rate;
    let mut step_pitch: Vec<Option<(f32, f32)>> = Vec::new(); // (midi, rms)
    let mut step_onset = Vec::new();
    let mut rms_all = Vec::new();
    for bar in 0..nbars {
        for s in 0..16 {
            let (p, sl) = step_pos(bar, s);
            let t = fine_t(p);
            let a = ((t + 0.1 * sl / fr) * lr) as usize;
            let n = ((sl / fr * lr) as usize).max(400);
            let seg = &low[a.min(low.len())..(a + n).min(low.len())];
            let rms = (seg.iter().map(|x| x * x).sum::<f32>() / seg.len().max(1) as f32).sqrt();
            rms_all.push(rms);
            let f0 = pitch::yin(seg, lr, 30.0, 400.0).filter(|(_, ap)| *ap < 0.45);
            step_pitch.push(f0.map(|(hz, _)| (pitch::midi(hz), rms)));
            let (fx, _) = near(&|i: usize| bass_flux.get(i).copied().unwrap_or(0.0) / bass_scale, p, ((sl / 3.0) as usize).max(1));
            step_onset.push(fx);
        }
    }
    let rms_max = rhythm::percentile(&mut rms_all.clone(), 0.98).max(1e-9);
    // Octave slips: a step more than nine semitones from the line around it
    // (the median of the pitched steps within two beats) is folded back.
    let raw: Vec<Option<f32>> = step_pitch.iter().map(|p| p.map(|(m, _)| m)).collect();
    for g in 0..step_pitch.len() {
        let Some((m, r)) = step_pitch[g] else { continue };
        let mut near: Vec<f32> = raw[g.saturating_sub(8)..(g + 9).min(raw.len())].iter().flatten().copied().collect();
        if near.len() < 3 {
            continue;
        }
        let med = median(&mut near);
        if (m - med).abs() > 9.0 {
            step_pitch[g] = Some((m - 12.0 * ((m - med) / 12.0).round(), r));
        }
    }
    struct Note {
        g: usize,
        len: usize,
        midi: f32,
        vel: f32,
    }
    let mut notes: Vec<Note> = Vec::new();
    let mut cur: Option<Note> = None;
    for (g, sp) in step_pitch.iter().enumerate() {
        let pitched = sp.filter(|(_, r)| *r > rms_max * 0.06);
        match (pitched, cur.as_mut()) {
            // The same note goes on unless it is struck again: an attack in the
            // bass stem and the level jumping up with it.
            (Some((m, r)), Some(n)) if (m - n.midi).abs() < 0.8 && !(step_onset[g] >= 0.6 && g > 0 && rms_all[g] > 1.4 * rms_all[g - 1]) => {
                n.len += 1;
                n.vel = n.vel.max(r / rms_max);
            }
            (Some((m, r)), _) => {
                if let Some(n) = cur.take() {
                    notes.push(n);
                }
                cur = Some(Note { g, len: 1, midi: m, vel: (r / rms_max).min(1.0) });
            }
            (None, _) => {
                if let Some(n) = cur.take() {
                    notes.push(n);
                }
            }
        }
    }
    if let Some(n) = cur.take() {
        notes.push(n);
    }
    let mut bass_pc = [0.0f32; 12];
    let mut bass_pc_bar = vec![[0.0f32; 12]; nbars];
    for n in &notes {
        let pc = (n.midi.round() as i32).rem_euclid(12) as usize;
        bass_pc[pc] += n.len as f32;
        bass_pc_bar[n.g / 16][pc] += n.len as f32;
    }

    // ---- bars in time
    let bar_t: Vec<(f32, f32)> = (0..nbars).map(|b| (fine_t(beats[o + 4 * b]), fine_t(beats[o + 4 * b + 4]))).collect();
    let frames_of = |f: &Features, b: usize| -> std::ops::Range<usize> {
        let (a, z) = bar_t[b];
        coarse_at(a).min(f.coarse.len())..coarse_at(z).min(f.coarse.len()).max(coarse_at(a).min(f.coarse.len()))
    };

    // ---- key, key changes, tuning
    log("key and tuning");
    let chroma_of = |range: std::ops::Range<usize>, f: &Features| -> [f32; 12] {
        let mut c = [0.0f32; 12];
        for fr in &f.coarse[range] {
            let s: f32 = fr.chroma.iter().sum();
            if s > 1e-9 {
                let w = fr.energy.sqrt();
                for i in 0..12 {
                    c[i] += fr.chroma[i] / s * w;
                }
            }
        }
        c
    };
    let norm12 = |c: &mut [f32; 12]| {
        let s: f32 = c.iter().sum();
        if s > 0.0 {
            c.iter_mut().for_each(|x| *x /= s);
        }
    };
    let key_chroma = |bars: std::ops::Range<usize>| -> [f32; 12] {
        let (a, z) = (bars.start, bars.end.min(nbars));
        if a >= z {
            return [0.0; 12];
        }
        let fr0 = frames_of(&st[3], a).start;
        let fr1 = frames_of(&st[3], z - 1).end;
        let mut c = chroma_of(fr0..fr1, &st[3]);
        let mut v = chroma_of(fr0.min(st[2].coarse.len())..fr1.min(st[2].coarse.len()), &st[2]);
        norm12(&mut c);
        norm12(&mut v);
        let mut b = [0.0f32; 12];
        for bb in &bass_pc_bar[a..z] {
            for i in 0..12 {
                b[i] += bb[i];
            }
        }
        norm12(&mut b);
        let mut out = [0.0f32; 12];
        for i in 0..12 {
            out[i] = c[i] + 0.3 * v[i] + b[i];
        }
        out
    };
    let whole = key_chroma(0..nbars);
    let (tonic, minor, kconf) = pitch::key(&whole);
    let mut key_regions: Vec<(usize, usize, bool, f32)> = Vec::new();
    let mut b0 = 0;
    while b0 + 16 <= nbars.max(16) && b0 < nbars {
        let (t, m, c) = pitch::key(&key_chroma(b0..b0 + 16));
        match key_regions.last() {
            Some(&(_, lt, lm, _)) if lt == t && lm == m => {}
            _ => key_regions.push((b0, t, m, c)),
        }
        b0 += 8;
    }

    let mut dev = [0.0f64; 100];
    let mut oct = [0.0f64; 120];
    for f in [&st[1], &st[2], &st[3]] {
        for i in 0..100 {
            dev[i] += f.dev_hist[i];
        }
        for i in 0..120 {
            oct[i] += f.oct_hist[i];
        }
    }
    let (mut cx, mut sy, mut tot) = (0.0f64, 0.0f64, 0.0f64);
    for (i, w) in dev.iter().enumerate() {
        let a = (i as f64 + 0.5 - 50.0) / 100.0 * std::f64::consts::TAU;
        cx += w * a.cos();
        sy += w * a.sin();
        tot += w;
    }
    let offset = (sy.atan2(cx) / std::f64::consts::TAU * 100.0) as f32;
    let near12: f64 = dev
        .iter()
        .enumerate()
        .filter(|(i, _)| {
            let d = *i as f32 + 0.5 - 50.0 - offset;
            let d = d - 100.0 * (d / 100.0).round();
            d.abs() <= 15.0
        })
        .map(|(_, w)| w)
        .sum();
    let twelve_share = if tot > 0.0 { (near12 / tot) as f32 } else { 0.0 };
    // Scale degrees in cents above the tonic.
    let tonic_cents = ((tonic as f32 - 9.0) * 100.0 + offset).rem_euclid(1200.0);
    let sm: Vec<f64> = (0..120).map(|i| (oct[(i + 119) % 120] + 2.0 * oct[i] + oct[(i + 1) % 120]) / 4.0).collect();
    let mx = sm.iter().cloned().fold(0.0, f64::max);
    let mut peaks: Vec<(f32, f64)> = Vec::new();
    for i in 0..120 {
        let (l, m, r) = (sm[(i + 119) % 120], sm[i], sm[(i + 1) % 120]);
        if m > l && m >= r && m > 0.2 * mx {
            let den = l - 2.0 * m + r;
            let d = if den.abs() > 1e-12 { 0.5 * (l - r) / den } else { 0.0 };
            let c = ((i as f64 + 0.5 + d) * 10.0) as f32;
            peaks.push(((c - tonic_cents).rem_euclid(1200.0), m));
        }
    }
    peaks.sort_by(|a, b| b.1.total_cmp(&a.1));
    peaks.truncate(12);
    let mut scale_cents: Vec<f32> = peaks.iter().map(|p| p.0).collect();
    scale_cents.sort_by(|a, b| a.total_cmp(b));

    // ---- chords and the arrangement, bar by bar
    log("chords and arrangement");
    let mut chords: Vec<Option<(String, f32)>> = Vec::new();
    let mut level = vec![[0.0f32; 4]; nbars];
    let mut bright = vec![[0.0f32; 4]; nbars];
    let mut mix_db = vec![0.0f32; nbars];
    let mut width = vec![(0.0f32, 0.0f32); nbars];
    let mut smear = vec![0.0f32; nbars];
    let mut bar_e = vec![[0.0f64; 4]; nbars];
    for b in 0..nbars {
        let mut c = chroma_of(frames_of(&st[3], b), &st[3]);
        norm12(&mut c);
        let mut bp = bass_pc_bar[b];
        norm12(&mut bp);
        for i in 0..12 {
            c[i] += 0.5 * bp[i];
        }
        chords.push(pitch::chord(&c));
        for (k, f) in st.iter().enumerate() {
            let r = frames_of(f, b);
            let n = r.len().max(1) as f64;
            let e: f64 = f.coarse[r.clone()].iter().map(|x| x.energy as f64).sum::<f64>() / n;
            let ce: f64 = f.coarse[r.clone()].iter().map(|x| (x.centroid * x.energy) as f64).sum::<f64>();
            let es: f64 = f.coarse[r].iter().map(|x| x.energy as f64).sum::<f64>();
            bar_e[b][k] = e;
            bright[b][k] = if es > 0.0 { (ce / es) as f32 } else { 0.0 };
        }
        let r = frames_of(&mix, b);
        let (mut ll, mut rr, mut lrs) = (0.0f64, 0.0f64, 0.0f64);
        for x in &mix.lr[r.start.min(mix.lr.len())..r.end.min(mix.lr.len())] {
            ll += x[0] as f64;
            rr += x[1] as f64;
            lrs += x[2] as f64;
        }
        let corr = if ll * rr > 0.0 { lrs / (ll * rr).sqrt() } else { 1.0 };
        let side = (ll + rr - 2.0 * lrs).max(0.0);
        let mid = (ll + rr + 2.0 * lrs).max(1e-20);
        width[b] = (corr as f32, (side / mid).sqrt() as f32);
        // Smear: how much of the other stem's level survives into the quietest
        // part of each beat (pads, reverb, long delays fill the gaps).
        let rr2 = frames_of(&st[3], b);
        let mut v: Vec<f32> = st[3].coarse[rr2].iter().map(|x| x.energy).collect();
        if v.len() > 4 {
            let lo = rhythm::percentile(&mut v.clone(), 0.2);
            let hi = rhythm::percentile(&mut v, 0.9);
            smear[b] = if hi > 0.0 { (lo / hi).sqrt() } else { 0.0 };
        }
    }
    let loudest: f64 = bar_e.iter().map(|e| e.iter().sum::<f64>()).fold(1e-20, f64::max);
    for b in 0..nbars {
        for k in 0..4 {
            level[b][k] = db(bar_e[b][k] / loudest);
        }
        mix_db[b] = db(bar_e[b].iter().sum::<f64>() / loudest);
    }
    let on = |b: usize, k: usize| level[b][k] > -36.0;

    // ---- sections
    log("sections");
    let hits = |b: usize, band: usize| grid[b][band].iter().filter(|v| **v >= 0.4).count() as f32 / 16.0;
    let feat: Vec<Vec<f32>> = (0..nbars)
        .map(|b| {
            let mut f = Vec::with_capacity(23);
            for k in 0..4 {
                f.push(((level[b][k] + 40.0) / 40.0).clamp(0.0, 1.0));
            }
            for k in 0..4 {
                f.push(if on(b, k) { 0.3 * (bright[b][k].max(50.0) / 1000.0).log2() } else { 0.0 });
            }
            let mut c = chroma_of(frames_of(&st[3], b), &st[3]);
            norm12(&mut c);
            f.extend(c.iter().map(|x| x * 1.5));
            for band in 0..3 {
                f.push(hits(b, band));
            }
            f
        })
        .collect();
    let dist = |a: &[f32], b: &[f32]| a.iter().zip(b).map(|(x, y)| (x - y).powi(2)).sum::<f32>().sqrt();
    let mean_of = |r: std::ops::Range<usize>| -> Vec<f32> {
        let n = r.len().max(1) as f32;
        let mut m = vec![0.0f32; feat.first().map_or(0, |f| f.len())];
        for b in r {
            for (i, x) in feat[b].iter().enumerate() {
                m[i] += x / n;
            }
        }
        m
    };
    let k = 4;
    let mut nov = vec![0.0f32; nbars];
    for b in k..nbars.saturating_sub(k) {
        nov[b] = dist(&mean_of(b - k..b), &mean_of(b..b + k));
    }
    let inner: Vec<f32> = nov[k.min(nbars)..nbars.saturating_sub(k).max(k.min(nbars))].to_vec();
    let nm = inner.iter().sum::<f32>() / inner.len().max(1) as f32;
    let nsd = (inner.iter().map(|x| (x - nm).powi(2)).sum::<f32>() / inner.len().max(1) as f32).sqrt();
    let mut bounds = vec![0usize];
    for b in k..nbars.saturating_sub(k) {
        let lo = b.saturating_sub(2);
        let hi = (b + 3).min(nbars);
        let is_peak = (lo..hi).all(|j| nov[j] <= nov[b]);
        if is_peak && nov[b] > nm + 0.5 * nsd && b - *bounds.last().unwrap() >= 4 {
            bounds.push(b);
        }
    }
    bounds.push(nbars);
    let secs: Vec<(usize, usize)> = bounds.windows(2).map(|w| (w[0], w[1])).filter(|(a, z)| z > a).collect();
    let means: Vec<Vec<f32>> = secs.iter().map(|&(a, z)| mean_of(a..z)).collect();
    let mut dd: Vec<f32> = means.windows(2).map(|w| dist(&w[0], &w[1])).collect();
    let thr = if dd.is_empty() { 1.0 } else { 0.6 * median(&mut dd) };
    let mut labels: Vec<usize> = Vec::new();
    let mut protos: Vec<Vec<f32>> = Vec::new();
    for m in &means {
        let best = protos.iter().enumerate().map(|(i, p)| (i, dist(m, p))).min_by(|a, b| a.1.total_cmp(&b.1));
        match best {
            Some((i, d)) if d < thr => labels.push(i),
            _ => {
                labels.push(protos.len());
                protos.push(m.clone());
            }
        }
    }
    let letter = |i: usize| ((b'A' + (i % 26) as u8) as char).to_string();

    // How often things change: a stem counts as entering or leaving when its
    // new state lasts at least two bars.
    let mut toggles = 0usize;
    let mut toggles_per = [0usize; 4];
    for k2 in 0..4 {
        let mut state = nbars > 0 && on(0, k2);
        let mut b = 1;
        while b + 1 < nbars {
            if on(b, k2) != state && on(b + 1, k2) != state {
                state = !state;
                toggles += 1;
                toggles_per[k2] += 1;
            }
            b += 1;
        }
    }
    let minutes = dur / 60.0;
    let sec_len: Vec<f32> = secs.iter().map(|(a, z)| (z - a) as f32).collect();
    let sec_med = median(&mut sec_len.clone());
    let sec_mean = sec_len.iter().sum::<f32>() / sec_len.len().max(1) as f32;

    // ---- texture
    log("texture");
    let texture: Vec<J> = st
        .iter()
        .enumerate()
        .map(|(k, f)| {
            let mx = f.coarse.iter().map(|c| c.energy).fold(0.0f32, f32::max);
            let act: Vec<_> = f.coarse.iter().filter(|c| c.energy > mx * 1e-3).collect();
            let e: f64 = act.iter().map(|c| c.energy as f64).sum::<f64>().max(1e-20);
            let wmean = |g: &dyn Fn(&features::Coarse) -> f32| act.iter().map(|c| (g(c) * c.energy) as f64).sum::<f64>() / e;
            J::obj()
                .set("stem", STEMS[k])
                .set("share_of_energy", J::r((stem_e[k] / total_e) as f32, 3))
                .set("brightness_hz", J::r(wmean(&|c| c.centroid) as f32, 0))
                .set("rolloff_hz", J::r(wmean(&|c| c.rolloff) as f32, 0))
                .set("noisiness", J::r(wmean(&|c| c.flatness) as f32, 3))
                .set("air_above_8k", J::r((act.iter().map(|c| c.hf as f64).sum::<f64>() / e) as f32, 4))
        })
        .collect();
    let mut quiet: Vec<&features::Coarse> = mix.coarse.iter().filter(|c| c.energy > 1e-9).collect();
    quiet.sort_by(|a, b| a.energy.total_cmp(&b.energy));
    let mix_peak = mix.coarse.iter().map(|c| c.energy).fold(1e-20f32, f32::max) as f64;
    let q10 = &quiet[..(quiet.len() / 10).max(1).min(quiet.len())];
    let mut hiss: Vec<f32> = q10.iter().map(|c| db(c.hf as f64 / mix_peak)).collect();
    let mut hiss_share: Vec<f32> = q10.iter().map(|c| c.hf / c.energy.max(1e-20)).collect();
    // Echoes: the other stem's onsets against themselves, at musical delays.
    let oth: Vec<f32> = rhythm::detrend(&st[3].fine.iter().map(|f| f.all).collect::<Vec<_>>(), 32);
    let ac = |lag: usize| -> f64 {
        if lag >= oth.len() {
            return 0.0;
        }
        oth.iter().zip(&oth[lag..]).map(|(a, b)| (*a as f64) * (*b as f64)).sum::<f64>() / (oth.len() - lag) as f64
    };
    let a0 = ac(0).max(1e-20);
    let echoes: Vec<J> = [(0.25, "1/16"), (0.5, "1/8"), (0.75, "dotted 1/8"), (1.0, "1/4"), (4.0 / 3.0, "1/4 triplet x2"), (1.5, "dotted 1/4"), (2.0, "1/2")]
        .iter()
        .map(|&(beats_, name)| {
            let lag = (beats_ * period).round() as usize;
            let v = (lag.saturating_sub(2)..=lag + 2).map(ac).fold(0.0, f64::max) / a0;
            J::obj().set("delay", name).set("beats", J::r(beats_ as f32, 3)).set("strength", J::r(v as f32, 3))
        })
        .collect();

    // ---- JSON
    log("writing");
    let name = |b: usize| -> J { chords[b].as_ref().map_or(J::Null, |c| J::Str(c.0.clone())) };
    let bars_j: Vec<J> = (0..nbars)
        .map(|b| {
            let bn: Vec<J> = notes
                .iter()
                .filter(|n| n.g / 16 == b)
                .map(|n| J::Arr(vec![J::Num((n.g % 16) as f64), J::Num(n.len as f64), J::r(n.midi, 2), J::r(n.vel, 2)]))
                .collect();
            J::obj()
                .set("bar", b)
                .set("t", J::r(bar_t[b].0, 3))
                .set("mix_db", J::r(mix_db[b], 1))
                .set("level_db", J::Arr(level[b].iter().map(|x| J::r(*x, 1)).collect()))
                .set("on", J::Arr((0..4).map(|k| J::Bool(on(b, k))).collect()))
                .set("brightness_hz", J::Arr(bright[b].iter().map(|x| J::r(*x, 0)).collect()))
                .set("width", J::r(width[b].1, 3))
                .set("smear", J::r(smear[b], 3))
                .set("chord", name(b))
                .set("kick", J::Arr(grid[b][0].iter().map(|x| J::r(*x, 2)).collect()))
                .set("snare", J::Arr(grid[b][1].iter().map(|x| J::r(*x, 2)).collect()))
                .set("hat", J::Arr(grid[b][2].iter().map(|x| J::r(*x, 2)).collect()))
                .set("bass", J::Arr(bn))
                .set("novelty", J::r(nov[b], 3))
        })
        .collect();
    let sections_j: Vec<J> = secs
        .iter()
        .zip(&labels)
        .map(|(&(a, z), &l)| {
            let stems_on: Vec<J> = (0..4).filter(|&k2| (a..z).filter(|&b| on(b, k2)).count() * 2 >= z - a).map(|k2| J::from(STEMS[k2])).collect();
            let lvl = mix_db[a..z].iter().sum::<f32>() / (z - a) as f32;
            J::obj()
                .set("label", letter(l))
                .set("start_bar", a)
                .set("bars", z - a)
                .set("start_s", J::r(bar_t[a].0, 2))
                .set("end_s", J::r(bar_t[z - 1].1, 2))
                .set("stems_on", J::Arr(stems_on))
                .set("mix_db", J::r(lvl, 1))
        })
        .collect();
    let common_j: Vec<J> = common
        .iter()
        .take(8)
        .map(|(k2, c, f)| {
            let p: Vec<&str> = k2.split('|').collect();
            J::obj().set("bars", *c).set("first_bar", *f).set("kick", p[0]).set("snare", p[1]).set("hat", p[2])
        })
        .collect();
    let notes_j: Vec<J> = notes
        .iter()
        .map(|n| J::Arr(vec![J::Num((n.g / 16) as f64), J::Num((n.g % 16) as f64), J::Num(n.len as f64), J::r(n.midi, 2), J::r(n.vel, 2)]))
        .collect();
    let mut changes_j = Vec::new();
    let mut last: Option<String> = None;
    for b in 0..nbars {
        let c = chords[b].as_ref().map(|c| c.0.clone());
        if c != last {
            changes_j.push(J::Arr(vec![J::Num(b as f64), c.clone().map_or(J::Null, J::Str)]));
            last = c;
        }
    }
    let lo_note = notes.iter().map(|n| n.midi).fold(f32::MAX, f32::min);
    let hi_note = notes.iter().map(|n| n.midi).fold(f32::MIN, f32::max);
    let note_name = |m: f32| -> String {
        let r = m.round() as i32;
        format!("{}{}", pitch::NAMES[r.rem_euclid(12) as usize], r / 12 - 1)
    };

    let json = J::obj()
        .set("format", "songprint/1")
        .set("title", title)
        .set("mix", mix_path.display().to_string())
        .set("stems", stems_dir.display().to_string())
        .set("duration_s", J::r(dur, 2))
        .set(
            "tempo",
            J::obj()
                .set("bpm", J::r(bpm, 2))
                .set("confidence", J::r(tconf, 2))
                .set("meter", "4/4 (assumed)")
                .set("from", if use_drums { "drums stem" } else { "the mix (drums too quiet)" })
                .set("map", J::Arr(tempo_map.iter().map(|(t, b, c)| J::Arr(vec![J::r(*t, 1), J::r(*b, 2), J::r(*c, 2)])).collect())),
        )
        .set("beats_s", J::Arr(beats.iter().map(|b| J::r(fine_t(*b), 3)).collect()))
        .set("downbeat_beat", o)
        .set("bar_count", nbars)
        .set(
            "key",
            J::obj()
                .set("name", pitch::key_name(tonic, minor))
                .set("tonic_pc", tonic)
                .set("minor", minor)
                .set("confidence", J::r(kconf, 2))
                .set(
                    "regions",
                    J::Arr(key_regions.iter().map(|(b, t, m, c)| J::Arr(vec![J::Num(*b as f64), J::Str(pitch::key_name(*t, *m)), J::r(*c, 2)])).collect()),
                ),
        )
        .set(
            "tuning",
            J::obj()
                .set("offset_cents_from_a440", J::r(offset, 1))
                .set("share_within_15c_of_12tet", J::r(twelve_share, 2))
                .set("scale_cents_above_tonic", J::Arr(scale_cents.iter().map(|c| J::r(*c, 0)).collect())),
        )
        .set(
            "drums",
            J::obj()
                .set("swing_8th_pct", J::r(swing8, 1))
                .set("swing_16th_pct", J::r(swing16, 1))
                .set("feel_ms_kick_snare_hat", J::Arr(feel_ms.iter().map(|x| J::r(*x, 1)).collect()))
                .set("distinct_bars_exact", exact_distinct)
                .set("bar_families", common.len())
                .set("common_bars", J::Arr(common_j)),
        )
        .set(
            "bass",
            J::obj()
                .set("note_columns", "bar, step, length in steps, midi (cents as decimals), velocity")
                .set("range", if notes.is_empty() { J::Null } else { J::Str(format!("{} to {}", note_name(lo_note), note_name(hi_note))) })
                .set("notes", J::Arr(notes_j)),
        )
        .set("chords", J::obj().set("changes", J::Arr(changes_j)))
        .set(
            "change",
            J::obj()
                .set("sections", secs.len())
                .set("section_bars_median", J::r(sec_med, 1))
                .set("section_bars_mean", J::r(sec_mean, 1))
                .set("stem_entries_exits", toggles)
                .set("per_stem_entries_exits", J::Arr(toggles_per.iter().map(|x| J::from(*x)).collect()))
                .set("entries_exits_per_minute", J::r(toggles as f32 / minutes.max(1e-3), 2))
                .set("novelty_mean", J::r(nm, 3)),
        )
        .set("sections", J::Arr(sections_j))
        .set(
            "texture",
            J::obj()
                .set("stems", J::Arr(texture))
                .set("hiss_floor_db", J::r(median(&mut hiss), 1))
                .set("hiss_share_in_quiet", J::r(median(&mut hiss_share), 3))
                .set("width_mean", J::r(width.iter().map(|w| w.1).sum::<f32>() / nbars.max(1) as f32, 3))
                .set("smear_mean", J::r(smear.iter().sum::<f32>() / nbars.max(1) as f32, 3))
                .set("echoes_other_stem", J::Arr(echoes)),
        )
        .set("bars", J::Arr(bars_j));

    // ---- summary
    let mut s = String::new();
    s.push_str(&format!("# {title}\n\n"));
    s.push_str(&format!(
        "- **Length** {}:{:02}, **{} bars** of 4/4 (assumed), **tempo {:.1} BPM** (confidence {:.2}, from the {}).\n",
        (dur / 60.0) as u32,
        (dur % 60.0) as u32,
        nbars,
        bpm,
        tconf,
        if use_drums { "drums stem" } else { "mix" }
    ));
    let (tmin, tmax) = tempo_map.iter().fold((f32::MAX, f32::MIN), |(a, b), x| (a.min(x.1), b.max(x.1)));
    if !tempo_map.is_empty() {
        s.push_str(&format!("- **Tempo over time:** {:.1} to {:.1} BPM across 30-second windows.\n", tmin, tmax));
    }
    s.push_str(&format!("- **Key** {} (confidence {:.2})", pitch::key_name(tonic, minor), kconf));
    if key_regions.len() > 1 {
        let r: Vec<String> = key_regions.iter().map(|(b, t, m, _)| format!("bar {b}: {}", pitch::key_name(*t, *m))).collect();
        s.push_str(&format!("; by 16-bar windows: {}", r.join(", ")));
    }
    s.push_str(".\n");
    s.push_str(&format!(
        "- **Tuning** {:+.0} cents from A440; {:.0} % of pitched energy within 15 cents of 12-TET. Scale degrees found (cents above the tonic): {}.\n",
        offset,
        twelve_share * 100.0,
        scale_cents.iter().map(|c| format!("{c:.0}")).collect::<Vec<_>>().join(", ")
    ));
    s.push_str(&format!(
        "- **Drums:** {} families of bars (bars within 3 hits of each other), {} exactly distinct; swing {:.0} % (8ths), {:.0} % (16ths); kick, snare, hat sit {:+.0}, {:+.0}, {:+.0} ms off the beat.\n",
        common.len(),
        exact_distinct,
        swing8,
        swing16,
        feel_ms[0],
        feel_ms[1],
        feel_ms[2]
    ));
    s.push_str("\n  Most-used bars (X loud, x soft, . rest; 16 steps):\n\n");
    for (k2, c, f) in common.iter().take(4) {
        let p: Vec<&str> = k2.split('|').collect();
        s.push_str(&format!("      {c:>3} bars, first at bar {f} (mean velocities)\n      kick  {}\n      snare {}\n      hat   {}\n\n", p[0], p[1], p[2]));
    }
    if !notes.is_empty() {
        s.push_str(&format!("- **Bass:** {} notes, {} to {}.", notes.len(), note_name(lo_note), note_name(hi_note)));
        let first: Vec<String> = notes.iter().take(12).map(|n| note_name(n.midi)).collect();
        s.push_str(&format!(" It opens: {}.\n", first.join(" ")));
    }
    let cl: Vec<String> = {
        let mut v = Vec::new();
        let mut last: Option<&str> = None;
        for c in chords.iter().flatten() {
            if last != Some(c.0.as_str()) {
                v.push(c.0.clone());
                last = Some(c.0.as_str());
            }
            if v.len() >= 16 {
                break;
            }
        }
        v
    };
    s.push_str(&format!("- **Chords** (one per bar, from the other stem and bass; rough): {}.\n", cl.join(" → ")));
    s.push_str(&format!(
        "- **Change:** {} sections, median {:.0} bars; stems enter or leave {} times ({:.1} a minute).\n",
        secs.len(),
        sec_med,
        toggles,
        toggles as f32 / minutes.max(1e-3)
    ));
    s.push_str("\n  Sections:\n\n");
    for (&(a, z), &l) in secs.iter().zip(&labels) {
        let stems_on: Vec<&str> = (0..4).filter(|&k2| (a..z).filter(|&b| on(b, k2)).count() * 2 >= z - a).map(|k2| STEMS[k2]).collect();
        s.push_str(&format!(
            "      {}  bars {:>3}–{:<3} {:>5.1}–{:<5.1} s  {}\n",
            letter(l),
            a,
            z,
            bar_t[a].0,
            bar_t[z - 1].1,
            stems_on.join(" + ")
        ));
    }
    s.push_str(&format!(
        "\n- **Texture:** hiss floor {:.0} dB below the loudest frame; stereo width (side/mid) {:.2}; smear (gaps filled by the other stem) {:.2}.\n",
        -median(&mut q10.iter().map(|c| db(c.hf as f64 / mix_peak)).collect::<Vec<_>>()),
        width.iter().map(|w| w.1).sum::<f32>() / nbars.max(1) as f32,
        smear.iter().sum::<f32>() / nbars.max(1) as f32
    ));
    Ok(Report { json, summary: s })
}

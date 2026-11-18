//! A melody from one stem (RJ, 18 Nov 2026: "Stems to MIDI", the vocals), and
//! notes given in seconds put onto the song's grid.
//!
//! The melody is read the way the bass line is: one note at a time, YIN on each
//! sixteenth of the grid, octave slips folded back, and steps on the same
//! semitone joined into a note. It suits a sung line; many notes at once need a
//! transcription model (see `on_the_grid`, which places what such a model finds).

use crate::midi::Note;
use crate::pitch;
use std::path::Path;

/// Where the bars are: every beat's time in seconds, and the beat bar 0 starts on.
pub struct Grid<'a> {
    pub beats_s: &'a [f32],
    pub downbeat_beat: usize,
}

impl Grid<'_> {
    /// How many whole bars the beats cover.
    pub fn bars(&self) -> usize {
        self.beats_s.len().saturating_sub(self.downbeat_beat + 1) / 4
    }

    /// A step's start in seconds and its length.
    pub fn step(&self, bar: usize, step: usize) -> Option<(f32, f32)> {
        let i = self.downbeat_beat + 4 * bar + step / 4;
        let (a, b) = (*self.beats_s.get(i)?, *self.beats_s.get(i + 1)?);
        Some((a + (b - a) * (step % 4) as f32 / 4.0, (b - a) / 4.0))
    }

    /// A time in seconds as sixteenths from the start of bar 0 (it may be
    /// negative, before bar 0, or fractional). Past the last beat the last
    /// beat's length goes on.
    pub fn steps_at(&self, t: f32) -> f32 {
        let b = self.beats_s;
        if b.len() < 2 {
            return 0.0;
        }
        let i = match b.iter().position(|&x| x > t) {
            Some(0) => 0,
            Some(i) => i - 1,
            None => b.len() - 2,
        };
        let beat = i as f32 + (t - b[i]) / (b[i + 1] - b[i]).max(1e-6);
        (beat - self.downbeat_beat as f32) * 4.0
    }
}

/// Notes found by their times, as (start s, end s, midi note, loudness 0..1),
/// onto the grid: each starts on its nearest sixteenth and lasts a whole number
/// of them, at least one. Notes before bar 0 or past `bars` are left out, and
/// the same note struck twice on one step is kept once (the louder).
pub fn on_the_grid(found: &[(f32, f32, u8, f32)], grid: &Grid, bars: usize) -> Vec<Note> {
    let peak = found.iter().map(|f| f.3).fold(0.0f32, f32::max).max(1e-9);
    let mut out: Vec<Note> = Vec::new();
    for &(start, end, note, amp) in found {
        let s = grid.steps_at(start).round();
        if s < 0.0 || s >= (bars * 16) as f32 {
            continue;
        }
        let len = (grid.steps_at(end).round() - s).max(1.0);
        let (bar, step) = ((s as u32) / 16, (s as u32 % 16) as f32);
        let vel = (amp / peak).clamp(0.0, 1.0);
        match out.iter_mut().find(|n| n.bar == bar && n.step == step && n.note == note) {
            Some(n) => {
                n.vel = n.vel.max(vel);
                n.steps = n.steps.max(len);
            }
            None => out.push(Note { bar, step, steps: len, note, vel }),
        }
    }
    out.sort_by(|a, b| (a.bar, a.step, a.note).partial_cmp(&(b.bar, b.step, b.note)).unwrap());
    out
}

/// Below this level (RMS, about -50 dB) a step holds no note, however clear its pitch.
const FLOOR: f32 = 0.003;

/// The melody in `x` (one channel at `rate`), between `lo_hz` and `hi_hz`.
pub fn read(x: &[f32], rate: f32, grid: &Grid, lo_hz: f32, hi_hz: f32) -> Vec<Note> {
    // A window long enough for two periods of the lowest note and a bit.
    let need = (2.2 * rate / lo_hz) as usize + 4;
    let mut steps: Vec<Option<(f32, f32)>> = Vec::new(); // (midi, rms)
    let mut rms_all = Vec::new();
    for bar in 0..grid.bars() {
        for s in 0..16 {
            let Some((t, len)) = grid.step(bar, s) else {
                steps.push(None);
                rms_all.push(0.0);
                continue;
            };
            let a = (((t + 0.1 * len) * rate) as usize).min(x.len());
            // The middle of the step, so a note that starts or stops on the grid line is not half heard.
            let n = ((0.8 * len * rate) as usize).max(need);
            let seg = &x[a..(a + n).min(x.len())];
            let rms = (seg.iter().map(|v| v * v).sum::<f32>() / seg.len().max(1) as f32).sqrt();
            rms_all.push(rms);
            let f0 = pitch::yin(seg, rate, lo_hz, hi_hz).filter(|(_, ap)| *ap < 0.3);
            steps.push(f0.map(|(hz, _)| (pitch::midi(hz), rms)));
        }
    }
    let mut sorted = rms_all.clone();
    let loud = crate::rhythm::percentile(&mut sorted, 0.98).max(1e-9);
    // Octave slips: a step more than nine semitones from the line around it is folded back.
    let raw: Vec<Option<f32>> = steps.iter().map(|p| p.map(|(m, _)| m)).collect();
    for g in 0..steps.len() {
        let Some((m, r)) = steps[g] else { continue };
        let mut near: Vec<f32> = raw[g.saturating_sub(8)..(g + 9).min(raw.len())].iter().flatten().copied().collect();
        if near.len() < 3 {
            continue;
        }
        let med = crate::rhythm::percentile(&mut near, 0.5);
        if (m - med).abs() > 9.0 {
            steps[g] = Some((m - 12.0 * ((m - med) / 12.0).round(), r));
        }
    }
    let mut out: Vec<Note> = Vec::new();
    let mut last: Option<usize> = None; // the step the note in hand ended on
    for (g, sp) in steps.iter().enumerate() {
        // Loud enough beside the stem's loudest, and loud enough at all: a stem with
        // no voice in it still has a whisper of the others, and that is not a melody
        // (18 Nov 2026: six stray notes from a silent vocals stem).
        let Some((m, r)) = sp.filter(|(_, r)| *r > loud * 0.08 && *r > FLOOR) else {
            last = None;
            continue;
        };
        let note = m.round().clamp(0.0, 127.0) as u8;
        let vel = (r / loud).min(1.0);
        match (last, out.last_mut()) {
            (Some(l), Some(n)) if l + 1 == g && n.note == note => {
                n.steps += 1.0;
                n.vel = n.vel.max(vel);
            }
            _ => out.push(Note { bar: (g / 16) as u32, step: (g % 16) as f32, steps: 1.0, note, vel }),
        }
        last = Some(g);
    }
    out
}

/// The melody of a stem file. The stem is brought down to about 11 kHz first:
/// a sung line is below 1 kHz, and the pitch search costs the square of the rate.
pub fn read_file(path: &Path, grid: &Grid) -> Result<Vec<Note>, String> {
    let mut rd = audio_core::open(path).map_err(|e| format!("{}: {e:?}", path.display()))?;
    let info = *rd.info();
    let (ch, rate, frames) = (info.channels.max(1) as usize, info.sample_rate as f32, info.frames());
    let k = ((rate / 11_025.0).round() as usize).max(1);
    // Four one-pole low-passes at 2 kHz, then every k-th sample.
    let a = (-2.0 * std::f32::consts::PI * 2000.0 / rate).exp();
    let (mut lp, mut phase, mut x) = ([0.0f32; 4], 0usize, Vec::with_capacity((frames as usize) / k + 1));
    let (block, mut pos) = (1u64 << 16, 0u64);
    while pos < frames {
        let raw = rd.read_frames(pos, block).map_err(|e| e.to_string())?;
        if raw.is_empty() {
            break;
        }
        for f in raw.chunks_exact(ch) {
            let mut v = f.iter().sum::<f32>() / ch as f32;
            for s in lp.iter_mut() {
                *s = a * *s + (1.0 - a) * v;
                v = *s;
            }
            if phase == 0 {
                x.push(v);
            }
            phase = (phase + 1) % k;
        }
        pos += (raw.len() / ch) as u64;
    }
    Ok(read(&x, rate / k as f32, grid, 80.0, 1000.0))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hz(midi: f32) -> f32 {
        440.0 * 2f32.powf((midi - 69.0) / 12.0)
    }

    #[test]
    fn a_sung_line_comes_out_as_its_notes_on_the_grid() {
        // 120 bpm, beats from 0.25 s; bar 0 on beat 0. A4 for a beat, a beat's
        // rest, C5 for two beats, then silence.
        let rate = 11_025.0;
        let beats: Vec<f32> = (0..9).map(|i| 0.25 + 0.5 * i as f32).collect();
        let grid = Grid { beats_s: &beats, downbeat_beat: 0 };
        assert_eq!(grid.bars(), 2);
        let tone = |t: f32| {
            let f = if (0.25..0.75).contains(&t) { hz(69.0) } else if (1.25..2.25).contains(&t) { hz(72.0) } else { return 0.0 };
            // A voice has harmonics; the reader must still find the fundamental.
            0.5 * (2.0 * std::f32::consts::PI * f * t).sin() + 0.25 * (4.0 * std::f32::consts::PI * f * t).sin()
        };
        let x: Vec<f32> = (0..(4.5 * rate) as usize).map(|i| tone(i as f32 / rate)).collect();
        let got: Vec<_> = read(&x, rate, &grid, 80.0, 1000.0).iter().map(|n| (n.bar, n.step, n.steps, n.note)).collect();
        assert_eq!(got, [(0, 0.0, 4.0, 69), (0, 8.0, 8.0, 72)]);
    }

    #[test]
    fn what_bleeds_into_an_empty_stem_is_no_melody() {
        // A clear note, but 60 dB down: what a split leaves in a stem with no voice.
        let rate = 11_025.0;
        let beats: Vec<f32> = (0..9).map(|i| 0.5 * i as f32).collect();
        let grid = Grid { beats_s: &beats, downbeat_beat: 0 };
        let x: Vec<f32> = (0..(4.5 * rate) as usize).map(|i| 0.001 * (2.0 * std::f32::consts::PI * 440.0 * i as f32 / rate).sin()).collect();
        assert!(read(&x, rate, &grid, 80.0, 1000.0).is_empty());
    }

    #[test]
    fn silence_and_noise_are_no_melody() {
        let beats: Vec<f32> = (0..9).map(|i| 0.5 * i as f32).collect();
        let grid = Grid { beats_s: &beats, downbeat_beat: 0 };
        assert!(read(&vec![0.0; 44_100], 11_025.0, &grid, 80.0, 1000.0).is_empty());
        let mut s = 1u32;
        let noise: Vec<f32> = (0..44_100).map(|_| { s = s.wrapping_mul(1_664_525).wrapping_add(1_013_904_223); (s >> 8) as f32 / 8_388_608.0 - 1.0 }).collect();
        assert!(read(&noise, 11_025.0, &grid, 80.0, 1000.0).len() <= 2, "noise has no pitch to speak of");
    }

    #[test]
    fn a_time_is_its_place_in_the_bars_even_when_the_tempo_moves() {
        // Bar 0 starts on beat 1. Beats 0.5 s apart, then 0.6 s apart.
        let beats = [0.2f32, 0.7, 1.2, 1.7, 2.2, 2.8, 3.4];
        let grid = Grid { beats_s: &beats, downbeat_beat: 1 };
        assert!((grid.steps_at(0.7) - 0.0).abs() < 1e-4);
        assert!((grid.steps_at(0.95) - 2.0).abs() < 1e-4);
        assert!((grid.steps_at(2.5) - 14.0).abs() < 1e-4, "half way through the slower beat");
        assert!((grid.steps_at(0.2) + 4.0).abs() < 1e-4, "the beat before bar 0");
        assert!((grid.steps_at(4.0) - 24.0).abs() < 1e-4, "past the last beat, at its length");
    }

    #[test]
    fn found_notes_go_to_their_nearest_sixteenth() {
        let beats: Vec<f32> = (0..9).map(|i| 0.5 * i as f32).collect();
        let grid = Grid { beats_s: &beats, downbeat_beat: 0 };
        let found = [
            (0.01, 0.26, 60, 0.5),   // step 0, two steps long
            (0.52, 0.55, 64, 1.0),   // step 4, too short to round to a step: one step
            (0.50, 0.75, 64, 0.2),   // the same note on the same step: kept once, the louder
            (1.99, 2.6, 67, 0.25),   // rounds onto bar 1, step 0
            (-0.4, 0.0, 50, 1.0),    // before bar 0: left out
            (3.99, 4.2, 72, 1.0),    // past the two bars: left out
        ];
        let got: Vec<_> = on_the_grid(&found, &grid, 2).iter().map(|n| (n.bar, n.step, n.steps, n.note, n.vel)).collect();
        assert_eq!(got, [(0, 0.0, 2.0, 60, 0.5), (0, 4.0, 2.0, 64, 1.0), (1, 0.0, 5.0, 67, 0.25)]);
    }
}

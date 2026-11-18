//! A song's notes as a Standard MIDI File (RJ, 18 Nov 2026: "Stems to MIDI").
//!
//! The file is type 1: a first track with the tempo, the time signature and the
//! sections as markers, then a track a part (drums, bass, chords), each on its
//! own channel. Notes sit on the song's grid: a bar and a sixteenth-step in it.
//!
//! Two timings:
//!   - `Grid`: one tempo; bar 0 starts at tick 0. For a sequencer.
//!   - `Played`: a tempo change on every beat, from the beat times the analysis
//!     found, so a note's time in the file is its time in the song and the file
//!     lines up with the stems in a DAW.

/// Ticks to a quarter note.
pub const PPQ: u32 = 480;
const STEP: u32 = PPQ / 4;

/// The General MIDI drum notes of the three rows the analysis reads.
pub const KICK: u8 = 36;
pub const SNARE: u8 = 38;
pub const HAT: u8 = 42;

#[derive(Clone, Debug, PartialEq)]
pub struct Note {
    pub bar: u32,
    /// Sixteenths from the start of the bar; may be fractional.
    pub step: f32,
    /// Length in sixteenths.
    pub steps: f32,
    pub note: u8,
    /// 0..1, relative to the song's loudest.
    pub vel: f32,
}

#[derive(Debug, PartialEq)]
pub struct Part {
    pub name: String,
    /// 1..=16, as musicians count them.
    pub channel: u8,
    pub notes: Vec<Note>,
}

pub enum Timing {
    Grid { bpm: f32 },
    /// Every beat's time in seconds, and which beat bar 0 starts on.
    Played { beats_s: Vec<f32>, downbeat_beat: usize },
}

pub struct Song {
    pub title: String,
    pub timing: Timing,
    /// (bar, label): the sections.
    pub markers: Vec<(u32, String)>,
    pub parts: Vec<Part>,
}

/// The notes of a chord name as the analysis writes them ("F#m7", "Bb", "C5"),
/// root in the octave below middle C. An unknown shape is played as major.
pub fn chord_notes(name: &str) -> Vec<u8> {
    let mut it = name.chars();
    let pc = match it.next() {
        Some('C') => 0,
        Some('D') => 2,
        Some('E') => 4,
        Some('F') => 5,
        Some('G') => 7,
        Some('A') => 9,
        Some('B') => 11,
        _ => return Vec::new(),
    };
    let rest = it.as_str();
    let (pc, shape) = match rest.chars().next() {
        Some('#') => ((pc + 1) % 12, &rest[1..]),
        Some('b') => ((pc + 11) % 12, &rest[1..]),
        _ => (pc, rest),
    };
    let steps: &[u8] = match shape {
        "m" => &[0, 3, 7],
        "5" => &[0, 7, 12],
        "7" => &[0, 4, 7, 10],
        "m7" => &[0, 3, 7, 10],
        "maj7" => &[0, 4, 7, 11],
        "sus4" => &[0, 5, 7],
        "sus2" => &[0, 2, 7],
        _ => &[0, 4, 7],
    };
    steps.iter().map(|s| 48 + pc + s).collect()
}

/// The chord track: each change held until the next (or the song's end), or
/// struck again at every bar.
pub fn chords(changes: &[(u32, String)], bar_count: u32, each_bar: bool) -> Vec<Note> {
    let mut out = Vec::new();
    for (i, (bar, name)) in changes.iter().enumerate() {
        let end = changes.get(i + 1).map(|c| c.0).unwrap_or(bar_count).max(*bar);
        let notes = chord_notes(name);
        if each_bar {
            for b in *bar..end {
                out.extend(notes.iter().map(|&n| Note { bar: b, step: 0.0, steps: 16.0, note: n, vel: 0.7 }));
            }
        } else if end > *bar {
            out.extend(notes.iter().map(|&n| Note { bar: *bar, step: 0.0, steps: (end - bar) as f32 * 16.0, note: n, vel: 0.7 }));
        }
    }
    out
}

/// The drum track from each bar's three 16-step rows (kick, snare, hat) of
/// velocities; 0 is no hit.
pub fn drums(bars: &[[Vec<f32>; 3]]) -> Vec<Note> {
    let mut out = Vec::new();
    for (bar, rows) in bars.iter().enumerate() {
        for (row, note) in rows.iter().zip([KICK, SNARE, HAT]) {
            for (step, &v) in row.iter().enumerate().take(16) {
                if v > 0.0 {
                    out.push(Note { bar: bar as u32, step: step as f32, steps: 0.5, note, vel: v });
                }
            }
        }
    }
    out
}

fn vlq(mut n: u32, out: &mut Vec<u8>) {
    let mut b = vec![(n & 127) as u8];
    n >>= 7;
    while n > 0 {
        b.push((n & 127) as u8 | 128);
        n >>= 7;
    }
    b.reverse();
    out.extend(b);
}

fn meta(kind: u8, data: &[u8]) -> Vec<u8> {
    let mut e = vec![0xFF, kind];
    vlq(data.len() as u32, &mut e);
    e.extend_from_slice(data);
    e
}

fn tempo(us_per_quarter: f64) -> Vec<u8> {
    // Three bytes of microseconds: 1 to 16 777 215 (3.6 bpm at the slowest).
    let us = us_per_quarter.round().clamp(1.0, 16_777_215.0) as u32;
    meta(0x51, &[(us >> 16) as u8, (us >> 8) as u8, us as u8])
}

/// Events as (tick, order within the tick, bytes), into a track chunk.
fn track(mut events: Vec<(u32, u8, Vec<u8>)>, out: &mut Vec<u8>) {
    events.sort_by_key(|e| (e.0, e.1));
    let mut data = Vec::new();
    let mut at = 0;
    for (tick, _, bytes) in events {
        vlq(tick - at, &mut data);
        data.extend(bytes);
        at = tick;
    }
    data.extend([0, 0xFF, 0x2F, 0]);
    out.extend(b"MTrk");
    out.extend((data.len() as u32).to_be_bytes());
    out.extend(data);
}

/// The file's bytes.
pub fn write(song: &Song) -> Vec<u8> {
    // Bar 0's first tick. Played: tick 0 is the song's first sample, beat i is at
    // tick (i + 1) * PPQ, and bar 0 starts on beat `downbeat_beat`.
    let lead = match &song.timing {
        Timing::Grid { .. } => 0,
        Timing::Played { downbeat_beat, .. } => (*downbeat_beat as u32 + 1) * PPQ,
    };
    let at = |bar: u32, step: f32| lead + ((bar as f64 * 16.0 + step.max(0.0) as f64) * STEP as f64).round() as u32;

    let mut first = vec![(0, 0, meta(0x03, song.title.as_bytes())), (0, 0, meta(0x58, &[4, 2, 24, 8]))];
    match &song.timing {
        Timing::Grid { bpm } => first.push((0, 1, tempo(6e7 / bpm.max(1.0) as f64))),
        Timing::Played { beats_s, .. } => {
            // The lead-in up to the first beat is one "quarter" as long as that takes.
            first.push((0, 1, tempo(beats_s.first().copied().unwrap_or(0.5) as f64 * 1e6)));
            for (i, pair) in beats_s.windows(2).enumerate() {
                first.push(((i as u32 + 1) * PPQ, 1, tempo((pair[1] - pair[0]) as f64 * 1e6)));
            }
        }
    }
    for (bar, label) in &song.markers {
        first.push((at(*bar, 0.0), 2, meta(0x06, label.as_bytes())));
    }

    let mut out = Vec::new();
    out.extend(b"MThd");
    out.extend(6u32.to_be_bytes());
    out.extend(1u16.to_be_bytes());
    out.extend((song.parts.len() as u16 + 1).to_be_bytes());
    out.extend((PPQ as u16).to_be_bytes());
    track(first, &mut out);
    for part in &song.parts {
        let ch = part.channel.clamp(1, 16) - 1;
        let mut ev = vec![(0, 0, meta(0x03, part.name.as_bytes()))];
        for n in &part.notes {
            let on = at(n.bar, n.step);
            let off = at(n.bar, n.step + n.steps).max(on + 1);
            let vel = (30.0 + n.vel.clamp(0.0, 1.0) * 97.0).round() as u8;
            // A note's end sorts before another's start on the same tick, so a repeated note is struck again.
            ev.push((on, 2, vec![0x90 | ch, n.note.min(127), vel.clamp(1, 127)]));
            ev.push((off, 1, vec![0x80 | ch, n.note.min(127), 0]));
        }
        track(ev, &mut out);
    }
    out
}

/// What a MIDI file holds, read back: for the Band to play (RJ, 18 Nov 2026:
/// "A, note for note"). Notes only: controllers, bends and program changes are
/// passed over. One tempo, the file's first; 4/4, so a bar is four quarters
/// from tick 0.
#[derive(Debug, PartialEq)]
pub struct Read {
    /// The first track's name, if it has one.
    pub title: String,
    /// The first tempo in the file; 120 when it has none, as the standard says.
    pub bpm: f32,
    /// How many bars the notes span.
    pub bars: u32,
    pub markers: Vec<(u32, String)>,
    /// A part for every channel of every track that has notes, in the file's order.
    pub parts: Vec<Part>,
}

struct Cursor<'a> {
    b: &'a [u8],
    at: usize,
}

impl Cursor<'_> {
    fn byte(&mut self) -> Result<u8, String> {
        let v = *self.b.get(self.at).ok_or("the file ends in the middle of a track")?;
        self.at += 1;
        Ok(v)
    }
    fn take(&mut self, n: usize) -> Result<&[u8], String> {
        let end = self.at.checked_add(n).filter(|&e| e <= self.b.len()).ok_or("the file ends in the middle of a track")?;
        let s = &self.b[self.at..end];
        self.at = end;
        Ok(s)
    }
    fn var(&mut self) -> Result<u32, String> {
        let mut v = 0u32;
        for _ in 0..4 {
            let c = self.byte()?;
            v = v << 7 | (c & 127) as u32;
            if c & 128 == 0 {
                return Ok(v);
            }
        }
        Err("a length in the file is too long".into())
    }
}

/// Read a Standard MIDI File (type 0 or 1, ticks to the quarter). A file that
/// is cut short or is not MIDI is an error, never a panic.
pub fn read(bytes: &[u8]) -> Result<Read, String> {
    if bytes.len() < 14 || &bytes[0..4] != b"MThd" {
        return Err("not a MIDI file".into());
    }
    let head = u32::from_be_bytes([bytes[4], bytes[5], bytes[6], bytes[7]]) as usize;
    let division = u16::from_be_bytes([bytes[12], bytes[13]]);
    if head < 6 || division == 0 || division & 0x8000 != 0 {
        return Err("a MIDI file timed in film frames, not beats, cannot be read".into());
    }
    let step = division as f64 / 4.0;
    let mut out = Read { title: String::new(), bpm: 120.0, bars: 0, markers: Vec::new(), parts: Vec::new() };
    let (mut at, mut track_no, mut tempo_at, mut last_step) = (8 + head, 0usize, u32::MAX, 0.0f64);
    while at + 8 <= bytes.len() {
        let len = u32::from_be_bytes([bytes[at + 4], bytes[at + 5], bytes[at + 6], bytes[at + 7]]) as usize;
        let end = (at + 8).checked_add(len).filter(|&e| e <= bytes.len()).ok_or("a track is longer than the file")?;
        if &bytes[at..at + 4] != b"MTrk" {
            at = end; // a chunk of some other kind: passed over, as the standard says
            continue;
        }
        let mut c = Cursor { b: &bytes[at + 8..end], at: 0 };
        let (mut tick, mut status, mut name) = (0u32, 0u8, String::new());
        // Per channel: the notes, and the notes sounding as (note, start tick, velocity).
        let mut notes: Vec<Vec<Note>> = vec![Vec::new(); 16];
        let mut held: Vec<Vec<(u8, u32, u8)>> = vec![Vec::new(); 16];
        let mut close = |ch: usize, note: u8, tick: u32, held: &mut Vec<Vec<(u8, u32, u8)>>, notes: &mut Vec<Vec<Note>>| {
            if let Some(i) = held[ch].iter().position(|h| h.0 == note) {
                let (_, on, vel) = held[ch].remove(i);
                let (a, z) = (on as f64 / step, tick as f64 / step);
                let bar = (a / 16.0).floor();
                notes[ch].push(Note { bar: bar as u32, step: ((a - bar * 16.0) * 1000.0).round() as f32 / 1000.0, steps: (((z - a) * 1000.0).round() as f32 / 1000.0).max(0.001), note, vel: ((vel as f32 - 30.0) / 97.0).clamp(0.05, 1.0) });
                last_step = last_step.max(z);
            }
        };
        while c.at < c.b.len() {
            tick = tick.checked_add(c.var()?).ok_or("the file is too long")?;
            let first = c.byte()?;
            if first == 0xFF {
                let kind = c.byte()?;
                let n = c.var()? as usize;
                let d = c.take(n)?;
                match kind {
                    0x03 if name.is_empty() => name = String::from_utf8_lossy(d).trim().to_string(),
                    0x06 => out.markers.push(((tick as f64 / step / 16.0).floor() as u32, String::from_utf8_lossy(d).trim().to_string())),
                    0x51 if d.len() == 3 && tick < tempo_at => {
                        let us = (d[0] as u32) << 16 | (d[1] as u32) << 8 | d[2] as u32;
                        if us > 0 {
                            out.bpm = (6e7 / us as f64) as f32;
                            tempo_at = tick;
                        }
                    }
                    0x2F => break,
                    _ => {}
                }
                continue;
            }
            if first == 0xF0 || first == 0xF7 {
                let n = c.var()? as usize;
                c.take(n)?;
                continue;
            }
            // A data byte first means the status before it goes on ("running status").
            let d1 = if first & 0x80 != 0 {
                status = first;
                c.byte()?
            } else {
                first
            };
            if status & 0x80 == 0 {
                return Err("a track starts with data and no message".into());
            }
            let ch = (status & 15) as usize;
            match status & 0xF0 {
                0x90 | 0x80 => {
                    let vel = c.byte()?;
                    close(ch, d1 & 127, tick, &mut held, &mut notes);
                    if status & 0xF0 == 0x90 && vel > 0 {
                        held[ch].push((d1 & 127, tick, vel & 127));
                    }
                }
                0xA0 | 0xB0 | 0xE0 => {
                    c.byte()?;
                }
                0xC0 | 0xD0 => {}
                _ => return Err("a message in the file is not one a track may hold".into()),
            }
        }
        // A note never let go ends where its track does.
        for ch in 0..16 {
            for (note, _, _) in held[ch].clone() {
                close(ch, note, tick.max(1), &mut held, &mut notes);
            }
        }
        if track_no == 0 {
            out.title = name.clone();
        }
        let chans = notes.iter().filter(|n| !n.is_empty()).count();
        for (ch, mut n) in notes.into_iter().enumerate() {
            if n.is_empty() {
                continue;
            }
            n.sort_by(|a, b| (a.bar, a.step, a.note).partial_cmp(&(b.bar, b.step, b.note)).unwrap());
            let named = if name.is_empty() { format!("Track {}", track_no + 1) } else { name.clone() };
            out.parts.push(Part { name: if chans > 1 { format!("{named} · channel {}", ch + 1) } else { named }, channel: ch as u8 + 1, notes: n });
        }
        track_no += 1;
        at = end;
    }
    if out.parts.is_empty() {
        return Err("the file has no notes in it".into());
    }
    out.bars = (last_step / 16.0).ceil().max(1.0) as u32;
    out.markers.sort();
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// What a reader finds in a file: per track, its name, and every event as
    /// (tick, status, data 1, data 2); tempos as (tick, microseconds a quarter).
    struct Read {
        format: u16,
        ppq: u16,
        names: Vec<String>,
        notes: Vec<Vec<(u32, u8, u8, u8)>>,
        tempos: Vec<(u32, u32)>,
        markers: Vec<(u32, String)>,
    }

    fn read(b: &[u8]) -> Read {
        assert_eq!(&b[0..4], b"MThd");
        let n = u16::from_be_bytes([b[10], b[11]]) as usize;
        let mut r = Read { format: u16::from_be_bytes([b[8], b[9]]), ppq: u16::from_be_bytes([b[12], b[13]]), names: vec![], notes: vec![], tempos: vec![], markers: vec![] };
        let mut o = 14;
        while o < b.len() {
            assert_eq!(&b[o..o + 4], b"MTrk");
            let len = u32::from_be_bytes([b[o + 4], b[o + 5], b[o + 6], b[o + 7]]) as usize;
            let t = &b[o + 8..o + 8 + len];
            assert_eq!(&t[len - 3..], &[0xFF, 0x2F, 0], "a track ends with end-of-track");
            let (mut i, mut tick, mut name, mut notes) = (0, 0u32, String::new(), vec![]);
            let var = |i: &mut usize| {
                let mut v = 0u32;
                loop {
                    let c = t[*i];
                    *i += 1;
                    v = v << 7 | (c & 127) as u32;
                    if c & 128 == 0 {
                        return v;
                    }
                }
            };
            while i < len {
                tick += var(&mut i);
                let status = t[i];
                i += 1;
                if status == 0xFF {
                    let kind = t[i];
                    i += 1;
                    let l = var(&mut i) as usize;
                    let d = &t[i..i + l];
                    i += l;
                    match kind {
                        0x03 => name = String::from_utf8_lossy(d).into(),
                        0x06 => r.markers.push((tick, String::from_utf8_lossy(d).into())),
                        0x51 => r.tempos.push((tick, (d[0] as u32) << 16 | (d[1] as u32) << 8 | d[2] as u32)),
                        _ => {}
                    }
                } else {
                    notes.push((tick, status, t[i], t[i + 1]));
                    i += 2;
                }
            }
            r.names.push(name);
            r.notes.push(notes);
            o += 8 + len;
        }
        assert_eq!(o, b.len(), "the track lengths add up to the file");
        assert_eq!(r.names.len(), n, "as many tracks as the header says");
        r
    }

    fn song(timing: Timing) -> Song {
        Song {
            title: "a song".into(),
            timing,
            markers: vec![(0, "A".into()), (2, "B".into())],
            parts: vec![
                Part { name: "Drums".into(), channel: 10, notes: drums(&[[vec![1.0, 0.0, 0.0, 0.0, 0.5], vec![], vec![0.0, 0.0, 1.0]]]) },
                Part { name: "Bass".into(), channel: 5, notes: vec![Note { bar: 1, step: 6.0, steps: 2.0, note: 30, vel: 1.0 }] },
            ],
        }
    }

    #[test]
    fn on_the_grid_a_note_is_at_its_bar_and_step_on_its_own_channel() {
        let r = read(&write(&song(Timing::Grid { bpm: 120.0 })));
        assert_eq!((r.format, r.ppq), (1, 480));
        assert_eq!(r.names, ["a song", "Drums", "Bass"]);
        assert_eq!(r.tempos, [(0, 500_000)]);
        assert_eq!(r.markers, [(0, "A".to_string()), (3840, "B".to_string())]);
        // Bar 1, step 6: 1920 + 6 * 120; two steps long; channel 5 is status nibble 4.
        assert_eq!(r.notes[2], [(2640, 0x94, 30, 127), (2880, 0x84, 30, 0)]);
        // Drums on channel 10: kick on steps 0 and 4, hat on step 2, each half a step long.
        let ons: Vec<_> = r.notes[1].iter().filter(|e| e.1 == 0x99).map(|e| (e.0, e.2, e.3)).collect();
        assert_eq!(ons, [(0, KICK, 127), (240, HAT, 127), (480, KICK, 79)]);
        assert!(r.notes[1].iter().filter(|e| e.1 == 0x89).all(|e| e.0 % 120 == 60));
    }

    #[test]
    fn as_played_every_beat_falls_at_its_own_time_in_the_song() {
        // Beats that drift: 0.30 s in, then 0.50, 0.52, 0.48 s apart. Bar 0 starts on beat 1.
        let beats = vec![0.30f32, 0.80, 1.32, 1.80, 2.30];
        let r = read(&write(&song(Timing::Played { beats_s: beats.clone(), downbeat_beat: 1 })));
        // Walk the tempo map: the time of tick (i + 1) * 480 is beat i's time.
        let time_of = |tick: u32| {
            let (mut t, mut at, mut us) = (0.0f64, 0u32, 500_000u32);
            for &(k, u) in &r.tempos {
                if k >= tick {
                    break;
                }
                t += (k - at) as f64 * us as f64 / 480.0 / 1e6;
                at = k;
                us = u;
            }
            t + (tick - at) as f64 * us as f64 / 480.0 / 1e6
        };
        for (i, b) in beats.iter().enumerate() {
            assert!((time_of((i as u32 + 1) * 480) - *b as f64).abs() < 1e-4, "beat {i}");
        }
        // Bar 0 is beat 1, so the first kick sounds at 0.80 s, and marker A is there too.
        let kick = r.notes[1].iter().find(|e| e.1 == 0x99).unwrap().0;
        assert!((time_of(kick) - 0.80).abs() < 1e-4);
        assert_eq!(r.markers[0].0, kick);
    }

    #[test]
    fn a_file_written_here_reads_back_as_what_went_in() {
        let song = song(Timing::Grid { bpm: 113.5 });
        let r = super::read(&write(&song)).unwrap();
        assert_eq!(r.title, "a song");
        assert!((r.bpm - 113.5).abs() < 0.01);
        assert_eq!(r.markers, [(0, "A".to_string()), (2, "B".to_string())]);
        let got: Vec<_> = r.parts.iter().map(|p| (p.name.as_str(), p.channel, p.notes.len())).collect();
        assert_eq!(got, [("Drums", 10, 3), ("Bass", 5, 1)]);
        // The bass note: bar 1, step 6, two steps long, at full velocity.
        assert_eq!(r.parts[1].notes[0], Note { bar: 1, step: 6.0, steps: 2.0, note: 30, vel: 1.0 });
        // The quieter kick comes back about as quiet as it went in (0.5).
        let quiet = r.parts[0].notes.iter().find(|n| n.step == 4.0).unwrap();
        assert!((quiet.vel - 0.5).abs() < 0.02 && quiet.steps == 0.5);
        assert_eq!(r.bars, 2);
    }

    #[test]
    fn another_program_s_file_is_read_too() {
        // Type 0, 96 ticks to the quarter: every channel in one track, a note-on
        // with velocity 0 for a note-off, running status, a sysex and a controller
        // to pass over, and a note never let go.
        let mut t: Vec<u8> = Vec::new();
        t.extend([0, 0xFF, 0x51, 3, 0x09, 0x27, 0xC0]); // 600 000 us a quarter: 100 bpm
        t.extend([0, 0xF0, 2, 1, 0xF7]); // sysex
        t.extend([0, 0xB0, 7, 100]); // volume on channel 1
        t.extend([0, 0x90, 60, 100]); // C on channel 1 at tick 0
        t.extend([48, 64, 0]); // running status: E on with velocity 0 (nothing was sounding: passed over)
        t.extend([48, 60, 0]); // running status: C off at tick 96
        t.extend([0, 0x99, 36, 127]); // a kick on channel 10 at tick 96
        t.extend([24, 0x89, 36, 0]);
        t.extend([0x81, 0x00, 0x91, 67, 80]); // tick 248: G on channel 2, never let go
        t.extend([0x82, 0x00, 0xFF, 0x2F, 0]); // the track ends at tick 504
        let mut f: Vec<u8> = b"MThd".to_vec();
        f.extend([0, 0, 0, 6, 0, 0, 0, 1, 0, 96]);
        f.extend(b"MTrk");
        f.extend((t.len() as u32).to_be_bytes());
        f.extend(t);
        let r = super::read(&f).unwrap();
        assert!((r.bpm - 100.0).abs() < 0.01);
        let got: Vec<_> = r.parts.iter().map(|p| (p.name.as_str(), p.notes[0].bar, p.notes[0].step, p.notes[0].steps, p.notes[0].note)).collect();
        assert_eq!(
            got,
            [
                ("Track 1 · channel 1", 0, 0.0, 4.0, 60),
                ("Track 1 · channel 2", 0, 10.333, 10.667, 67),
                ("Track 1 · channel 10", 0, 4.0, 1.0, 36),
            ]
        );
        assert_eq!(r.bars, 2);
    }

    #[test]
    fn what_is_not_a_midi_file_is_refused_not_crashed_on() {
        assert_eq!(super::read(b"RIFF....WAVE").err().unwrap(), "not a MIDI file");
        let whole = write(&song(Timing::Grid { bpm: 120.0 }));
        // Cut anywhere, it is an error or a shorter song: never a panic.
        for cut in 0..whole.len() {
            let _ = super::read(&whole[..cut]);
        }
        // Rubbish after a good header.
        let mut junk = whole[..22].to_vec();
        junk.extend((0..200u32).map(|i| (i * 37 % 251) as u8));
        let _ = super::read(&junk);
        // A header that claims a track far longer than the file.
        let mut long = whole.clone();
        long[18] = 0x7F;
        assert_eq!(super::read(&long).err().unwrap(), "a track is longer than the file");
    }

    #[test]
    fn a_chord_name_becomes_its_notes() {
        assert_eq!(chord_notes("C"), [48, 52, 55]);
        assert_eq!(chord_notes("F#m7"), [54, 57, 61, 64]);
        assert_eq!(chord_notes("Bbmaj7"), [58, 62, 65, 69]);
        assert_eq!(chord_notes("D5"), [50, 57, 62]);
        assert_eq!(chord_notes("Asus4"), [57, 62, 64]);
        assert_eq!(chord_notes("Esus2"), [52, 54, 59]);
        assert_eq!(chord_notes("G7"), [55, 59, 62, 65]);
        assert!(chord_notes("").is_empty());
    }

    #[test]
    fn chords_are_held_to_the_next_change_or_struck_each_bar() {
        let changes = vec![(0, "C".to_string()), (2, "Am".to_string())];
        let held = chords(&changes, 5, false);
        assert_eq!(held.len(), 6);
        assert_eq!((held[0].bar, held[0].steps), (0, 32.0));
        assert_eq!((held[3].bar, held[3].steps), (2, 48.0));
        let struck = chords(&changes, 5, true);
        assert_eq!(struck.len(), 15);
        assert!(struck.iter().all(|n| n.steps == 16.0));
    }

    #[test]
    fn the_same_note_twice_in_a_row_is_struck_twice() {
        let part = Part { name: "Bass".into(), channel: 5, notes: vec![Note { bar: 0, step: 0.0, steps: 4.0, note: 40, vel: 1.0 }, Note { bar: 0, step: 4.0, steps: 4.0, note: 40, vel: 1.0 }] };
        let r = read(&write(&Song { title: String::new(), timing: Timing::Grid { bpm: 100.0 }, markers: vec![], parts: vec![part] }));
        let kinds: Vec<_> = r.notes[1].iter().map(|e| (e.0, e.1 & 0xF0)).collect();
        assert_eq!(kinds, [(0, 0x90), (480, 0x80), (480, 0x90), (960, 0x80)]);
    }
}

//! What Write slices writes (`ui/app/401-chop-sound.js`): each slice as a
//! WAV (`chopSliceWav`, its three paths, through Recycle Reborn's encoders
//! `chopEncodeWAV` and `chopEncodeWAVFromInterleaved`, byte for byte), the
//! MIDI file (`chopMidi`), the SFZ (`chopSfz`), and the names
//! (`chopName`).

use super::{js, ping_pong_tail, tail_params, Page, TailParams};

/// `chopEncodeWAVFromInterleaved`: a 16-bit PCM WAV. Each sample clamped to
/// ±1 and scaled by 32768 below zero, 32767 above, cut towards zero as
/// `DataView.setInt16` does.
pub fn encode_wav_interleaved(inter: &[f32], frames: usize, ch: usize, sr: u32) -> Vec<u8> {
    let block = (ch * 2) as u32;
    let data = (frames as u32).wrapping_mul(block);
    let mut out = Vec::with_capacity(44 + data as usize);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36u32.wrapping_add(data)).to_le_bytes());
    out.extend_from_slice(b"WAVE");
    out.extend_from_slice(b"fmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&(ch as u16).to_le_bytes());
    out.extend_from_slice(&sr.to_le_bytes());
    out.extend_from_slice(&sr.wrapping_mul(block).to_le_bytes());
    out.extend_from_slice(&(block as u16).to_le_bytes());
    out.extend_from_slice(&16u16.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&data.to_le_bytes());
    for &v in inter {
        let s = js::max(-1.0, js::min(1.0, v as f64));
        let x = if s < 0.0 { s * 32768.0 } else { s * 32767.0 };
        // ToInt16: NaN is 0, anything else cut towards zero.
        let i = if x.is_nan() { 0 } else { x.trunc() as i64 as i16 };
        out.extend_from_slice(&i.to_le_bytes());
    }
    out
}

/// `chopEncodeWAV`: frames `s` to `e` of every channel, as they are.
pub fn encode_wav(channels: &[Vec<f32>], s: i64, e: i64, sr: u32) -> Vec<u8> {
    let ch = channels.len();
    let frames = (e - s).max(0) as usize;
    let mut inter = vec![0.0f32; frames * ch];
    for f in 0..frames {
        for (c, data) in channels.iter().enumerate() {
            inter[f * ch + c] = data[s as usize + f];
        }
    }
    encode_wav_interleaved(&inter, frames, ch, sr)
}

/// `chopName(i)`: `<stem>_0001.wav`, numbered from 1.
pub fn slice_name(stem: &str, i: usize) -> String {
    format!("{stem}_{:04}.wav", i + 1)
}

impl Page {
    /// `chopSliceWav(i)`: with nothing on, Recycle Reborn's own bytes; with
    /// only the tail on, its tail; anything else, the slice as it sounds.
    pub fn slice_wav(&self, i: usize) -> Vec<u8> {
        let x = self.slices[i];
        let cp = &self.settings;
        let sr = self.rate as u32;
        if !cp.has_sound() && !x.rev {
            return encode_wav(&self.channels, x.s, x.e, sr);
        }
        let truthy = |v: f64| v != 0.0 && !v.is_nan();
        if cp.tail && !x.rev && !truthy(cp.pitch) && !cp.env_on && !cp.tr_on && !cp.eq_on && !cp.flt_on && !truthy(cp.smooth) && cp.gate == 100.0 {
            if let TailParams::No { .. } = tail_params(x.s, x.e, cp.tail_ms, self.rate) {
                return encode_wav(&self.channels, x.s, x.e, sr);
            }
            let (inter, p) = ping_pong_tail(&self.channels, x.s, x.e, cp.tail_ms, self.rate).expect("viable");
            return encode_wav_interleaved(&inter, p.total_frames as usize, self.channels.len(), sr);
        }
        let chs = self.slice_audio(i, 0);
        let (n, ch) = (chs[0].len(), chs.len());
        let mut inter = vec![0.0f32; n * ch];
        for f in 0..n {
            for c in 0..ch {
                inter[f * ch + c] = chs[c][f];
            }
        }
        encode_wav_interleaved(&inter, n, ch, sr)
    }

    /// `chopMidi(written)`: a type-0 MIDI file, a note a written slice from
    /// C1 (36), where each falls at the sound's tempo, held until the next.
    /// `written` is the slices' numbers, in the order written.
    pub fn midi(&self, written: &[usize]) -> Vec<u8> {
        const PPQ: i64 = 480;
        let bpm = self.bpm();
        let s0 = self.region.0;
        let tick = |f: i64| js::round(((f - s0) as f64 / self.rate) * (bpm / 60.0) * PPQ as f64) as i64;
        let mut ev: Vec<[i64; 4]> = Vec::new();
        for (n, &i) in written.iter().enumerate() {
            let x = self.slices[i];
            let end = if n + 1 < written.len() { self.slices[written[n + 1]].s } else { x.e };
            let key = 36 + n as i64;
            ev.push([tick(x.s), 0x90, key, 100]);
            ev.push([(tick(x.s) + 1).max(tick(end)), 0x80, key, 0]);
        }
        ev.sort_by(|a, b| a[0].cmp(&b[0]).then(a[1].cmp(&b[1])));
        // The page's `vlq`: `v >>= 7` on a 32-bit integer.
        let vlq = |v: i64| {
            let mut v = v as i32;
            let mut b = vec![(v & 0x7f) as u8];
            loop {
                v >>= 7;
                if v == 0 {
                    break;
                }
                b.insert(0, ((v & 0x7f) | 0x80) as u8);
            }
            b
        };
        let us = js::round(60_000_000.0 / bpm) as i64 as i32;
        let sig = self.settings.sig.trunc() as i64 as u8; // ToUint8
        let mut track: Vec<u8> = vec![0, 0xff, 0x51, 3, ((us >> 16) & 255) as u8, ((us >> 8) & 255) as u8, (us & 255) as u8, 0, 0xff, 0x58, 4, sig, 2, 24, 8];
        let mut last = 0i64;
        for [t, st, note, vel] in ev {
            track.extend(vlq(t - last));
            track.extend([st as u8, note.min(127) as u8, vel as u8]);
            last = t;
        }
        track.extend([0, 0xff, 0x2f, 0]);
        let tl = track.len() as u32;
        let mut out = vec![0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, (PPQ >> 8) as u8, (PPQ & 255) as u8];
        out.extend([0x4d, 0x54, 0x72, 0x6b]);
        out.extend(tl.to_be_bytes());
        out.extend(track);
        out
    }

    /// `chopSfz(written)`: each written file on a key from C1, one shot.
    pub fn sfz(&self, stem: &str, names: &[String]) -> String {
        let mut lines = vec![
            format!("// {stem}: {} slices from MultiGrainLive's Chop, {} BPM", names.len(), js::fixed(self.bpm(), 2)),
            "<control>".to_string(),
            "<group> loop_mode=one_shot".to_string(),
        ];
        for (n, name) in names.iter().enumerate() {
            lines.push(format!("<region> sample={name} key={}", 36 + n));
        }
        lines.join("\n") + "\n"
    }
}

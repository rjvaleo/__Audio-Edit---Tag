//! Writes a short phrase on each model to WAV files, to hear them away from
//! the app: `OUT=dir cargo test -p atmos --release --test demo -- --ignored`.
use atmos::{models::MODELS, Synth};

#[test]
#[ignore]
fn write_each_model() {
    let dir = std::env::var("OUT").unwrap_or_else(|_| ".".into());
    let sr = 48_000.0;
    for (m, d) in MODELS.iter().enumerate() {
        let mut s = Synth::new(sr);
        s.set("a.model", m as f32);
        s.set("b.model", m as f32);
        for (k, v) in d.3.iter().enumerate() {
            s.set(&format!("a.p{k}"), *v);
            s.set(&format!("b.p{k}"), *v);
        }
        s.set("b.oct", 1.0);
        s.set("blend", 0.3);
        s.set("atk", 0.01);
        s.set("rel", 1.5);
        // C major, up and a chord: true pitch from A 220.
        let notes = [261.63, 329.63, 392.0, 523.25];
        let mut out = Vec::new();
        let (mut l, mut r) = (vec![0.0f32; 256], vec![0.0f32; 256]);
        let step = (0.45 * sr) as usize;
        let total = (5.5 * sr) as usize;
        let mut t = 0;
        while t < total {
            for (k, hz) in notes.iter().enumerate() {
                if t <= k * step && k * step < t + 256 {
                    s.note_on(k as i32, *hz, 0.85, (k * step - t) as u32);
                }
                let off = k * step + (0.35 * sr) as usize;
                if t <= off && off < t + 256 {
                    s.note_off(k as i32, (off - t) as u32);
                }
                let chord = (2.0 * sr) as usize;
                if t <= chord && chord < t + 256 {
                    s.note_on(10 + k as i32, *hz, 0.7, (chord - t) as u32);
                }
                let chord_off = (4.0 * sr) as usize;
                if t <= chord_off && chord_off < t + 256 {
                    s.note_off(10 + k as i32, (chord_off - t) as u32);
                }
            }
            s.render(&mut l, &mut r);
            for i in 0..256 {
                out.push(l[i]);
                out.push(r[i]);
            }
            t += 256;
        }
        let peak = out.iter().fold(0.0f32, |a, v| a.max(v.abs())).max(1e-6);
        let g = 0.7 / peak;
        let mut wav = Vec::new();
        let n = out.len() as u32;
        wav.extend_from_slice(b"RIFF");
        wav.extend_from_slice(&(36 + n * 2).to_le_bytes());
        wav.extend_from_slice(b"WAVEfmt ");
        wav.extend_from_slice(&16u32.to_le_bytes());
        wav.extend_from_slice(&1u16.to_le_bytes());
        wav.extend_from_slice(&2u16.to_le_bytes());
        wav.extend_from_slice(&48_000u32.to_le_bytes());
        wav.extend_from_slice(&(48_000u32 * 4).to_le_bytes());
        wav.extend_from_slice(&4u16.to_le_bytes());
        wav.extend_from_slice(&16u16.to_le_bytes());
        wav.extend_from_slice(b"data");
        wav.extend_from_slice(&(n * 2).to_le_bytes());
        for v in out {
            wav.extend_from_slice(&(((v * g).clamp(-1.0, 1.0) * 32767.0) as i16).to_le_bytes());
        }
        std::fs::write(format!("{dir}/{:02}-{}.wav", m + 1, d.0), wav).unwrap();
    }
}

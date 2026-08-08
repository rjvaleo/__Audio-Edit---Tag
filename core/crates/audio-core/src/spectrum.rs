//! Spectrogram tiles.
//!
//! A short-time Fourier transform over a frame range, reduced to one byte per
//! cell. The UI draws thousands of cells per view, so sending dB floats would
//! be roughly four times the payload for detail no screen can show.

use crate::fft::{fft, hann, magnitudes};
use crate::probe::AudioInfo;
use crate::reader::Reader;
use crate::source::RandomAccessSource;
use std::io;

/// A time-by-frequency image. `data` is row-major by time column: all the
/// frequency bins for column 0, then column 1, and so on.
#[derive(Debug, Clone)]
pub struct Spectrogram {
    pub columns: usize,
    pub bins: usize,
    pub sample_rate: u32,
    /// Nyquist, i.e. the frequency the top bin represents.
    pub max_hz: f32,
    /// Magnitude in dB, mapped so 0 = `floor_db` and 255 = 0 dBFS.
    pub data: Vec<u8>,
    pub floor_db: f32,
}

impl Spectrogram {
    pub fn column(&self, i: usize) -> &[u8] {
        &self.data[i * self.bins..(i + 1) * self.bins]
    }
}

/// Anything quieter than this is floor. 90 dB covers the usable range of
/// 16-bit material without wasting resolution on dither noise.
const FLOOR_DB: f32 = -90.0;

impl<S: RandomAccessSource> Reader<S> {
    /// Compute a spectrogram over `[start, start+count)` frames.
    ///
    /// `fft_size` is rounded up to a power of two. Channels are summed to mono
    /// first — a per-channel spectrogram would double the work to show two
    /// near-identical images.
    pub fn spectrogram(
        &mut self,
        start: u64,
        count: u64,
        columns: usize,
        fft_size: usize,
    ) -> io::Result<Spectrogram> {
        let info: AudioInfo = *self.info();
        let total = info.frames();
        let start = start.min(total);
        let count = count.min(total - start);
        let channels = info.channels.max(1) as usize;

        let n = fft_size.max(64).next_power_of_two().min(8192);
        let bins = n / 2 + 1;
        let columns = columns.max(1).min(4096);

        let window = hann(n);
        let mut data = vec![0u8; columns * bins];

        // Guard against a zero-length or absurdly short range: every column
        // still gets written, just with floor values.
        if count == 0 {
            return Ok(Spectrogram {
                columns,
                bins,
                sample_rate: info.sample_rate,
                max_hz: info.sample_rate as f32 / 2.0,
                data,
                floor_db: FLOOR_DB,
            });
        }

        let mut re = vec![0f32; n];
        let mut im = vec![0f32; n];

        for col in 0..columns {
            // Centre each window on its column so the image lines up with the
            // waveform above it rather than lagging by half a window.
            let centre = start as f64 + (col as f64 + 0.5) * count as f64 / columns as f64;
            let win_start = (centre - n as f64 / 2.0).round().max(0.0) as u64;
            let frames = self.read_frames(win_start, n as u64)?;

            re.iter_mut().for_each(|v| *v = 0.0);
            im.iter_mut().for_each(|v| *v = 0.0);

            let available = frames.len() / channels;
            for i in 0..available.min(n) {
                let mut sum = 0f32;
                for ch in 0..channels {
                    sum += frames[i * channels + ch];
                }
                re[i] = (sum / channels as f32) * window[i];
            }

            if !fft(&mut re, &mut im) {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    "fft size must be a power of two",
                ));
            }

            let mags = magnitudes(&re, &im);
            // Normalise by the window's coherent gain so a full-scale tone
            // reads as 0 dBFS rather than an arbitrary number.
            let norm = 2.0 / (n as f32 * 0.5);
            for (b, m) in mags.iter().enumerate().take(bins) {
                let v = m * norm;
                let db = if v > 0.0 { 20.0 * v.log10() } else { FLOOR_DB };
                let clamped = db.clamp(FLOOR_DB, 0.0);
                let byte = ((clamped - FLOOR_DB) / -FLOOR_DB * 255.0).round() as u8;
                data[col * bins + b] = byte;
            }
        }

        Ok(Spectrogram {
            columns,
            bins,
            sample_rate: info.sample_rate,
            max_hz: info.sample_rate as f32 / 2.0,
            data,
            floor_db: FLOOR_DB,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::probe::{Codec, Container, Endian};
    use crate::source::SliceSource;

    /// Wrap float samples in a minimal in-memory source.
    fn reader(samples: &[f32], channels: u16, rate: u32) -> Reader<SliceSource<Vec<u8>>> {
        let mut bytes = Vec::new();
        for s in samples {
            bytes.extend_from_slice(&s.to_le_bytes());
        }
        let len = bytes.len() as u64;
        let info = AudioInfo {
            container: Container::Raw,
            codec: Codec::PcmF32,
            endian: Endian::Little,
            sample_rate: rate,
            channels,
            bits: 32,
            data_offset: 0,
            data_len: len,
        };
        Reader::new(SliceSource::new(bytes), info)
    }

    fn tone(freq: f32, rate: u32, frames: usize) -> Vec<f32> {
        (0..frames)
            .map(|i| (2.0 * std::f32::consts::PI * freq * i as f32 / rate as f32).sin())
            .collect()
    }

    /// Which bin holds the most energy in a given column.
    fn peak_bin(s: &Spectrogram, col: usize) -> usize {
        let c = s.column(col);
        c.iter().enumerate().max_by_key(|(_, &v)| v).unwrap().0
    }

    #[test]
    fn dimensions_match_the_request() {
        let mut r = reader(&tone(1000.0, 44100, 44100), 1, 44100);
        let s = r.spectrogram(0, 44100, 50, 1024).unwrap();
        assert_eq!(s.columns, 50);
        assert_eq!(s.bins, 513);
        assert_eq!(s.data.len(), 50 * 513);
    }

    #[test]
    fn a_steady_tone_lands_in_the_right_frequency_bin() {
        let rate = 44100;
        let n = 1024;
        let freq = 1000.0;
        let mut r = reader(&tone(freq, rate, rate as usize), 1, rate);
        let s = r.spectrogram(0, rate as u64, 20, n).unwrap();

        // bin index = freq / (rate / fft_size)
        let expected = (freq / (rate as f32 / n as f32)).round() as usize;
        let got = peak_bin(&s, 10);
        assert!(
            (got as i32 - expected as i32).abs() <= 2,
            "expected bin near {expected}, got {got}"
        );
    }

    #[test]
    fn a_higher_tone_lands_in_a_higher_bin() {
        let rate = 44100;
        let mut low = reader(&tone(500.0, rate, 44100), 1, rate);
        let mut high = reader(&tone(5000.0, rate, 44100), 1, rate);
        let a = low.spectrogram(0, 44100, 10, 1024).unwrap();
        let b = high.spectrogram(0, 44100, 10, 1024).unwrap();
        assert!(peak_bin(&b, 5) > peak_bin(&a, 5));
    }

    #[test]
    fn silence_sits_on_the_floor() {
        let mut r = reader(&vec![0.0f32; 44100], 1, 44100);
        let s = r.spectrogram(0, 44100, 10, 512).unwrap();
        assert!(s.data.iter().all(|&v| v == 0), "silence must be all floor");
    }

    #[test]
    fn a_full_scale_tone_reaches_near_the_top_of_the_range() {
        // If the normalisation is wrong this is either saturated or barely
        // visible, and the spectrogram looks blank or blown out.
        let mut r = reader(&tone(1000.0, 44100, 44100), 1, 44100);
        let s = r.spectrogram(0, 44100, 10, 1024).unwrap();
        let peak = s.column(5)[peak_bin(&s, 5)];
        assert!(peak > 220, "full-scale tone should be near the top, got {peak}");
    }

    #[test]
    fn a_quieter_tone_reads_lower_than_a_loud_one() {
        let rate = 44100;
        let loud: Vec<f32> = tone(1000.0, rate, 44100);
        let quiet: Vec<f32> = loud.iter().map(|v| v * 0.01).collect();
        let mut a = reader(&loud, 1, rate);
        let mut b = reader(&quiet, 1, rate);
        let sa = a.spectrogram(0, 44100, 10, 1024).unwrap();
        let sb = b.spectrogram(0, 44100, 10, 1024).unwrap();
        assert!(sa.column(5)[peak_bin(&sa, 5)] > sb.column(5)[peak_bin(&sb, 5)]);
    }

    #[test]
    fn a_tone_that_starts_halfway_shows_up_only_in_later_columns() {
        // This is what catches an off-by-one in the column-to-frame mapping.
        let rate = 44100;
        let mut sig = vec![0.0f32; 22050];
        sig.extend(tone(2000.0, rate, 22050));
        let mut r = reader(&sig, 1, rate);
        let s = r.spectrogram(0, 44100, 20, 512).unwrap();

        let energy = |col: usize| s.column(col).iter().map(|&v| v as u32).sum::<u32>();
        assert!(energy(2) < energy(17), "second half should be louder");
        assert_eq!(energy(1), 0, "first columns should still be silent");
    }

    #[test]
    fn stereo_is_summed_to_mono_rather_than_misread_as_twice_the_length() {
        let rate = 44100;
        let mono = tone(1000.0, rate, 22050);
        let mut inter = Vec::new();
        for v in &mono {
            inter.push(*v);
            inter.push(*v);
        }
        let mut r = reader(&inter, 2, rate);
        let s = r.spectrogram(0, 22050, 10, 1024).unwrap();
        let expected = (1000.0 / (rate as f32 / 1024.0)).round() as usize;
        assert!((peak_bin(&s, 5) as i32 - expected as i32).abs() <= 2);
    }

    #[test]
    fn an_fft_size_that_is_not_a_power_of_two_is_rounded_up() {
        let mut r = reader(&tone(1000.0, 44100, 44100), 1, 44100);
        let s = r.spectrogram(0, 44100, 10, 1000).unwrap();
        assert_eq!(s.bins, 1024 / 2 + 1);
    }

    #[test]
    fn an_empty_range_still_returns_a_well_formed_tile() {
        let mut r = reader(&tone(1000.0, 44100, 1000), 1, 44100);
        let s = r.spectrogram(0, 0, 8, 256).unwrap();
        assert_eq!(s.columns, 8);
        assert_eq!(s.data.len(), 8 * (256 / 2 + 1));
    }

    #[test]
    fn nyquist_is_reported_for_the_top_bin() {
        let mut r = reader(&tone(1000.0, 48000, 4800), 1, 48000);
        let s = r.spectrogram(0, 4800, 4, 256).unwrap();
        assert_eq!(s.max_hz, 24000.0);
    }
}

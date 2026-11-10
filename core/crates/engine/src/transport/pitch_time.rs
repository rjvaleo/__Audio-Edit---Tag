//! Hyperprism's Pitch Time Changer: speed and pitch as one ratio, live and offline.

/// The fastest Playback Speed: Hyperprism's slider tops out at 255/128.
pub const MAX_SPEED: f32 = 2.0;

/// Hyperprism's Pitch Time Changer: the engine's output read at `speed` %
/// (varispeed), then Hyperprism's own two-tap shifter at `pitch / speed`, all
/// wet — so time goes as 1/speed and pitch as pitch. The other four are the
/// window's additional settings, passed to the shifter as they are.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PitchTime {
    pub on: bool,
    /// 1 – 200 %.
    pub speed: f32,
    /// 0 – 200 %.
    pub pitch: f32,
    pub feedback: f32,
    pub grain: f32,
    pub xfade: f32,
    pub smoothing: f32,
}

impl Default for PitchTime {
    /// The window's own starting values.
    fn default() -> Self {
        PitchTime { on: false, speed: 100.0, pitch: 100.0, feedback: 0.0, grain: 15.0, xfade: 100.0, smoothing: 50.0 }
    }
}

/// The Pitch Time Changer's Speed and Pitch for one block, smoothed as the
/// original smoothed them: each on its own, every 512 samples, by the window's
/// Smoothing. The first block of a run takes them as they are. Speed is held at
/// 1 % or more, as `EPitchShift::SetParameter` holds it.
pub fn ptc_glided(glide: &mut crate::glide::Glide<2>, pt: &PitchTime, running: bool, frames: usize, sample_rate: u32) -> (f32, f32) {
    let target = [pt.speed.clamp(1.0, 200.0), pt.pitch];
    if !running {
        glide.snap(target);
        return (target[0], target[1]);
    }
    let [s, p] = glide.advance(target, frames, sample_rate, pt.smoothing);
    (s.max(1.0), p)
}

/// The shifter's ratio for a Speed and a Pitch, in percent: the correction
/// that puts the varispeed's pitch back where Pitch says. No limit, as in the
/// original: Pitch 200 % at Speed 1 % is 20 000 %.
pub fn ptc_ratio(speed: f32, pitch: f32) -> f32 {
    (100.0 * pitch / speed.max(1.0)).max(0.0)
}

/// Sets the shifter to a ratio past its Pitch control's 0–200 %: Pitch at
/// 100 % and the ratio as its Pitch scale.
pub(super) fn ptc_set_ratio(shifter: &mut dyn fx::Effect, ratio: f32) {
    shifter.set_param("pitch", 100.0);
    shifter.set_param("pitchScale", 0.01 * ratio);
}

/// Hyperprism's Pitch Time Changer over a whole piece of audio, for an export:
/// the same varispeed read and the same shifter the audio thread runs, block
/// by block, with `at` giving the settings at each output frame (the
/// document's, under its lanes). The result is as long as reading `audio` at
/// the speed makes it.
pub fn pitch_time_offline(
    audio: &[f32],
    channels: usize,
    sample_rate: u32,
    block: usize,
    at: impl Fn(u64) -> PitchTime,
) -> Vec<f32> {
    let ch = channels.max(1);
    let frames = audio.len() / ch;
    let block = block.max(1);
    let mut out = Vec::with_capacity(audio.len());
    let Some(mut shifter) = fx::prism::make("hp-pitch-shifter", sample_rate, ch, &[]) else {
        return audio.to_vec();
    };
    let mut now: Option<PitchTime> = None;
    let mut glide = crate::glide::Glide::<2>::default();
    let mut pos = 0.0f64;
    let mut buf = vec![0.0f32; block * ch];
    'blocks: loop {
        let pt = at((out.len() / ch) as u64);
        let (g_speed, g_pitch) = ptc_glided(&mut glide, &pt, now.is_some(), block, sample_rate);
        let speed = g_speed as f64 / 100.0;
        let mut n = 0;
        while n < block {
            let x = pos + n as f64 * speed;
            let i = x.floor() as usize;
            let t = (x - x.floor()) as f32;
            if i >= frames || (t > 0.0 && i + 1 >= frames) {
                break;
            }
            for c in 0..ch {
                let a = audio[i * ch + c];
                buf[n * ch + c] = if t == 0.0 { a } else { a + (audio[(i + 1) * ch + c] - a) * t };
            }
            n += 1;
        }
        if n == 0 {
            break 'blocks;
        }
        ptc_set_ratio(shifter.as_mut(), ptc_ratio(g_speed, g_pitch));
        if now != Some(pt) {
            shifter.set_param("mix", 100.0);
            shifter.set_param("feedback", pt.feedback);
            shifter.set_param("grain", pt.grain);
            shifter.set_param("xfade", pt.xfade);
            shifter.set_param("smoothing", 0.0);
            now = Some(pt);
        }
        shifter.process(&mut buf[..n * ch], ch, sample_rate);
        out.extend_from_slice(&buf[..n * ch]);
        pos += n as f64 * speed;
        if n < block {
            break;
        }
    }
    out
}

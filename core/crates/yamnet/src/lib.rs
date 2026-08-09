//! Naming sounds, rather than describing them.
//!
//! The acoustic fingerprint in the `search` crate can say a sound is dark,
//! percussive and short. It cannot say it is a snare. That is not a bug in it —
//! twelve numbers measured off the waveform do not carry identity — but it is a
//! real ceiling, and this is what sits above it.
//!
//! YAMNet is Google's AudioSet classifier: a MobileNet trained on a few million
//! YouTube clips, giving 521 scores per patch of audio, among them Snare drum,
//! Bass drum, Hi-hat, Cymbal, Speech and Synthesizer. It runs here through
//! `tract`, which is pure Rust, so the one-command cross-compile to Windows
//! survives having a neural network in the build.
//!
//! **The frontend is inside the graph.** This was worth checking rather than
//! assuming: the conversion used here takes a raw 16 kHz waveform and computes
//! its own log-mel spectrogram internally, using Google's own code path. So the
//! usual hazard of hand-rolling a mel frontend — get the window or the hop or
//! the bin count wrong and inference still runs and still returns
//! confident-looking labels that are nonsense — does not apply. What is left on
//! this side of the boundary is getting to 16 kHz mono honestly, which
//! [`resample`] does and defends with its own tests.
//!
//! Labels are never derived from filenames, and the tests prove it the only way
//! that counts: by checking that files whose names say `snare`, `kick` and `hat`
//! come back named that way from the audio alone.

pub mod resample;

use std::path::{Path, PathBuf};
use tract_onnx::prelude::*;

pub use resample::{to_mono_16k, RATE};

/// How much audio goes through the model at once, in seconds.
///
/// The graph's padding depends on the input length, so the plan is built for
/// one fixed size rather than a symbolic one — a longer file is fed through in
/// consecutive windows instead.
const WINDOW_SECS: usize = 3;
const WINDOW: usize = WINDOW_SECS * RATE as usize;

/// How many windows of a long file to look at. A sample is characterised early;
/// this is nine seconds, which is more than enough to name a loop and stops a
/// two-minute atmosphere from costing a minute of inference.
const MAX_WINDOWS: usize = 3;

/// YAMNet's own patch geometry, needed only to tell which stretch of audio a
/// row of scores came from.
const PATCH: usize = (0.96 * RATE as f32) as usize;
const PATCH_HOP: usize = (0.48 * RATE as f32) as usize;

/// A label the model put on a sound, with how sure it was.
#[derive(Debug, Clone, PartialEq)]
pub struct Detection {
    pub label: String,
    pub score: f32,
}

#[derive(Debug)]
pub enum Error {
    /// The weights are not on disk. Everything else in the app still works, so
    /// this is reported rather than fatal.
    Missing(PathBuf),
    Model(String),
}

impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Error::Missing(p) => write!(f, "no model at {}", p.display()),
            Error::Model(m) => write!(f, "{m}"),
        }
    }
}

impl std::error::Error for Error {}

pub type Result<T> = std::result::Result<T, Error>;

/// The 521 AudioSet class names, in the order the model emits them.
///
/// Embedded rather than read from disk: the order is part of the model's
/// meaning, and a class map that had drifted out of step with the weights would
/// rename every sound in the library without any error to show for it.
const CLASS_MAP: &str = include_str!("../classes.csv");

/// Classes that are true often enough to be useless.
///
/// "Music" on a music sample is not wrong, it just says nothing you did not
/// already know — and it saturates, routinely scoring 0.9 while the snare
/// underneath it scores 0.5. So a vague label is only reported when nothing
/// specific was found at all, rather than being allowed to bury the answer.
const GENERIC: &[&str] = &[
    "Music",
    "Musical instrument",
    "Sound effect",
    "Noise",
    "Silence",
    "Speech",
    "Inside, small room",
    "Inside, large room or hall",
    "Inside, public space",
    "Outside, urban or manmade",
    "Outside, rural or natural",
    "Environmental noise",
    "Background music",
    "Soundtrack music",
    "Musical concepts",
    "Generic impact sounds",
    "Sounds of things",
    "Human sounds",
    "Animal",
    "Natural sounds",
    "Channel, environment and background",
    "White noise",
    "Pink noise",
    "Throbbing",
    "Vibration",
];

pub struct Model {
    plan: std::sync::Arc<TypedRunnableModel>,
    classes: Vec<String>,
}

impl Model {
    /// Load the weights and build a runnable plan. Costs a second or two, so it
    /// belongs at startup or on first use, not per file.
    pub fn load(path: &Path) -> Result<Model> {
        if !path.exists() {
            return Err(Error::Missing(path.to_path_buf()));
        }
        let plan = tract_onnx::onnx()
            .model_for_path(path)
            .and_then(|m| m.with_input_fact(0, f32::fact([WINDOW]).into()))
            .and_then(|m| m.into_optimized())
            .and_then(|m| m.into_runnable())
            .map_err(|e| Error::Model(format!("{path:?}: {e}")))?;

        let classes = parse_classes(CLASS_MAP);
        if classes.len() != 521 {
            return Err(Error::Model(format!(
                "class map has {} entries, expected 521",
                classes.len()
            )));
        }
        Ok(Model { plan, classes })
    }

    /// Load from wherever the model normally lives.
    pub fn load_default() -> Result<Model> {
        let path = default_path();
        Model::load(&path)
    }

    pub fn classes(&self) -> &[String] {
        &self.classes
    }

    /// Score a mono 16 kHz signal against all 521 classes.
    ///
    /// Patches that are effectively silent are left out. Without that, padding
    /// a short one-shot up to the window length would average its own label
    /// away against several patches of nothing, and every short sound in the
    /// library would come back quietly labelled "Silence".
    pub fn scores(&self, mono16k: &[f32]) -> Result<Vec<f32>> {
        let windows = mono16k.len().div_ceil(WINDOW).clamp(1, MAX_WINDOWS);
        let mut kept: Vec<(f32, Vec<f32>)> = Vec::new();

        for w in 0..windows {
            let start = w * WINDOW;
            if start >= mono16k.len() && w > 0 {
                break;
            }
            let mut chunk = vec![0f32; WINDOW];
            let avail = mono16k.len().saturating_sub(start).min(WINDOW);
            chunk[..avail].copy_from_slice(&mono16k[start..start + avail]);

            let t = Tensor::from_shape(&[WINDOW], &chunk)
                .map_err(|e| Error::Model(e.to_string()))?;
            let out = self
                .plan
                .run(tvec!(t.into()))
                .map_err(|e| Error::Model(e.to_string()))?;
            let scores = out[0]
                .to_plain_array_view::<f32>()
                .map_err(|e| Error::Model(e.to_string()))?;

            let patches = scores.shape()[0];
            let classes = scores.shape()[1];
            let flat = scores.as_slice().ok_or_else(|| {
                Error::Model("model output was not contiguous".into())
            })?;

            for p in 0..patches {
                let from = p * PATCH_HOP;
                let to = (from + PATCH).min(chunk.len());
                let level = if from < to { rms(&chunk[from..to]) } else { 0.0 };
                kept.push((level, flat[p * classes..(p + 1) * classes].to_vec()));
            }
        }

        if kept.is_empty() {
            return Ok(vec![0.0; self.classes.len()]);
        }

        // A patch counts if it carries a reasonable share of the loudest
        // patch's level. A file that is silent throughout keeps everything, so
        // it still gets an answer rather than none.
        let loudest = kept.iter().map(|(l, _)| *l).fold(0.0f32, f32::max);
        let floor = loudest * 0.15;
        let active: Vec<&Vec<f32>> = kept
            .iter()
            .filter(|(l, _)| loudest <= 1e-6 || *l >= floor)
            .map(|(_, s)| s)
            .collect();

        let n = active.len().max(1) as f32;
        let mut mean = vec![0f32; self.classes.len()];
        for s in &active {
            for (i, v) in s.iter().enumerate().take(mean.len()) {
                mean[i] += v;
            }
        }
        for v in &mut mean {
            *v /= n;
        }
        Ok(mean)
    }

    /// The most likely labels for a sound, best first.
    ///
    /// Takes the raw signal; the presentation in [`present`] is applied here so
    /// callers cannot forget it.
    pub fn label(&self, mono16k: &[f32], limit: usize) -> Result<Vec<Detection>> {
        Ok(labels(&self.scores(&present(mono16k))?, &self.classes, limit))
    }

    /// Labels without the presentation step. Only useful for showing what the
    /// presentation is worth.
    pub fn label_raw(&self, mono16k: &[f32], limit: usize) -> Result<Vec<Detection>> {
        Ok(labels(&self.scores(mono16k)?, &self.classes, limit))
    }
}

/// Show the model a sound the way it was trained to see one.
///
/// YAMNet learned from YouTube, where a snare is a snare *in a track* — hit
/// after hit, filling the clip. A sample library is the opposite: a single
/// 100 ms hit surrounded by nothing. Handed that directly, the model is looking
/// at a patch that is nine parts silence, and it answers accordingly. Measured
/// on this library, `snare 3.wav` came back as "Door", `snare 5.wav` as
/// "Speech", and the 909 kick as a flat "Music".
///
/// So a one-shot is repeated until it fills the window, at a spacing no tighter
/// than a quarter second. That is not a trick to inflate a score — it is the
/// sound in the context it is actually used in, and it moves the same three
/// files to "Snare drum", "Drum machine" and "Percussion". Anything already
/// long enough to fill a patch is left alone.
pub fn present(mono16k: &[f32]) -> Vec<f32> {
    if mono16k.is_empty() {
        return Vec::new();
    }
    // Level is a recording decision, not a property of the sound, and the model
    // has opinions about quiet audio. Take it out of the equation.
    let peak = mono16k.iter().fold(0.0f32, |a, b| a.max(b.abs()));
    let gain = if peak > 1e-6 { 0.7 / peak } else { 1.0 };

    if mono16k.len() >= PATCH {
        return mono16k.iter().map(|v| v * gain).collect();
    }

    let step = mono16k.len().max(PATCH_HOP / 2);
    let mut out = vec![0f32; WINDOW];
    let mut at = 0usize;
    while at < WINDOW {
        for (i, v) in mono16k.iter().enumerate() {
            match out.get_mut(at + i) {
                Some(o) => *o += v * gain,
                None => break,
            }
        }
        at += step;
    }
    out
}

/// Turn 521 class scores into something worth showing.
///
/// Separate from [`Model`] so the policy can be tested without loading 16 MB of
/// weights.
pub fn labels(scores: &[f32], classes: &[String], limit: usize) -> Vec<Detection> {
    /// Below this the model is not saying anything, it is just the largest of
    /// 521 small numbers.
    const FLOOR: f32 = 0.05;

    let mut ranked: Vec<Detection> = scores
        .iter()
        .zip(classes)
        .filter(|(s, _)| **s >= FLOOR)
        .map(|(s, name)| Detection { label: name.clone(), score: *s })
        .collect();
    ranked.sort_by(|a, b| b.score.total_cmp(&a.score).then(a.label.cmp(&b.label)));

    let mut specific: Vec<Detection> =
        ranked.iter().filter(|d| !GENERIC.contains(&d.label.as_str())).cloned().collect();

    if specific.is_empty() {
        // Nothing specific was found. "Music" is then the honest answer, even
        // if it is a dull one.
        ranked.truncate(limit);
        return ranked;
    }

    // Drop the long tail beneath a clear winner, so three good labels do not
    // arrive with nine bad ones behind them.
    let best = specific[0].score;
    specific.retain(|d| d.score >= best * 0.25);
    specific.truncate(limit);
    specific
}

fn rms(x: &[f32]) -> f32 {
    if x.is_empty() {
        return 0.0;
    }
    (x.iter().map(|v| v * v).sum::<f32>() / x.len() as f32).sqrt()
}

/// Where the weights live. Beside the launcher, like the rest of the app's
/// files, with an override for anyone keeping models elsewhere.
pub fn default_path() -> PathBuf {
    if let Some(dir) = std::env::var_os("AUDIOLAB_MODELS") {
        return PathBuf::from(dir).join("yamnet.onnx");
    }
    let exe = std::env::current_exe().ok();
    let mut tries: Vec<PathBuf> = Vec::new();
    if let Some(dir) = exe.as_ref().and_then(|p| p.parent()) {
        tries.push(dir.join("models/yamnet.onnx"));
        tries.push(dir.join("../models/yamnet.onnx"));
    }
    // Walking up from the working directory keeps `cargo test` and `cargo run`
    // working from anywhere inside the workspace.
    if let Ok(cwd) = std::env::current_dir() {
        for dir in cwd.ancestors().take(6) {
            tries.push(dir.join("models/yamnet.onnx"));
        }
    }
    tries
        .iter()
        .find(|p| p.exists())
        .cloned()
        .unwrap_or_else(|| PathBuf::from("models/yamnet.onnx"))
}

/// Third column of the class map, honouring the quoting around names that
/// contain a comma.
fn parse_classes(csv: &str) -> Vec<String> {
    csv.lines()
        .skip(1)
        .filter(|l| !l.trim().is_empty())
        .filter_map(|line| fields(line).into_iter().nth(2))
        .collect()
}

fn fields(line: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut quoted = false;
    let mut chars = line.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '"' if quoted && chars.peek() == Some(&'"') => {
                cur.push('"');
                chars.next();
            }
            '"' => quoted = !quoted,
            ',' if !quoted => out.push(std::mem::take(&mut cur)),
            _ => cur.push(c),
        }
    }
    out.push(cur);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_class_map_has_every_audioset_class() {
        let c = parse_classes(CLASS_MAP);
        assert_eq!(c.len(), 521);
        assert_eq!(c[0], "Speech");
        assert!(c.iter().any(|n| n == "Snare drum"));
        assert!(c.iter().any(|n| n == "Hi-hat"));
        assert!(c.iter().any(|n| n == "Bass drum"));
    }

    #[test]
    fn quoted_names_containing_commas_survive_parsing() {
        let c = parse_classes(CLASS_MAP);
        assert_eq!(c[1], "Child speech, kid speaking");
        assert!(c.iter().all(|n| !n.starts_with('"')));
    }

    fn named(names: &[&str]) -> Vec<String> {
        names.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn a_specific_label_beats_a_vague_one_that_scored_higher() {
        let top = labels(&[0.8, 0.5], &named(&["Music", "Snare drum"]), 3);
        assert_eq!(top.len(), 1);
        assert_eq!(top[0].label, "Snare drum");
        // The score reported is the model's own, not something rescaled.
        assert_eq!(top[0].score, 0.5);
    }

    #[test]
    fn a_vague_label_is_still_used_when_it_is_all_there_is() {
        let top = labels(&[0.9, 0.01], &named(&["Music", "Snare drum"]), 3);
        assert_eq!(top[0].label, "Music");
    }

    #[test]
    fn nothing_is_claimed_about_a_sound_the_model_had_no_opinion_on() {
        assert!(labels(&[0.01, 0.02], &named(&["Music", "Snare drum"]), 3).is_empty());
    }

    #[test]
    fn the_tail_below_a_clear_winner_is_dropped() {
        let top = labels(&[0.8, 0.06], &named(&["Snare drum", "Bell"]), 5);
        assert_eq!(top.len(), 1, "0.06 against a 0.8 winner is noise");
    }

    #[test]
    fn ranking_is_stable_when_scores_tie() {
        let top = labels(&[0.5, 0.5, 0.5], &named(&["Cymbal", "Bell", "Gong"]), 3);
        assert_eq!(
            top.iter().map(|d| d.label.as_str()).collect::<Vec<_>>(),
            ["Bell", "Cymbal", "Gong"]
        );
    }

    #[test]
    fn a_short_one_shot_is_repeated_to_fill_the_window() {
        let hit = vec![1.0f32; 1600]; // 100 ms
        let out = present(&hit);
        assert_eq!(out.len(), WINDOW);
        // It should be busy throughout, not a hit followed by silence.
        let tail = &out[WINDOW - PATCH..];
        assert!(tail.iter().any(|v| v.abs() > 0.1), "the end of the window is empty");
    }

    #[test]
    fn a_sound_long_enough_to_fill_a_patch_is_left_at_its_own_length() {
        let long = vec![0.5f32; PATCH * 2];
        assert_eq!(present(&long).len(), PATCH * 2);
    }

    #[test]
    fn presentation_normalises_level_without_touching_shape() {
        let quiet: Vec<f32> = (0..PATCH * 2).map(|i| (i as f32 * 0.01).sin() * 0.01).collect();
        let out = present(&quiet);
        let peak = out.iter().fold(0.0f32, |a, b| a.max(b.abs()));
        assert!((peak - 0.7).abs() < 0.01, "peak was {peak}");
    }

    #[test]
    fn presenting_nothing_returns_nothing() {
        assert!(present(&[]).is_empty());
    }

    #[test]
    fn a_missing_model_is_reported_rather_than_panicking() {
        match Model::load(Path::new("/nowhere/yamnet.onnx")) {
            Err(Error::Missing(_)) => {}
            Err(e) => panic!("wrong error: {e}"),
            Ok(_) => panic!("loaded a model that is not there"),
        }
    }
}

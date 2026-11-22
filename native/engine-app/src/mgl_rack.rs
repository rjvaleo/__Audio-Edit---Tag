//! The rack MGL measures a document through before an edit that reads the
//! audio (snap, normalise, strip silence, repair a click, Find peak): the
//! document's own rack, which for a sound nothing has been put in is MGL's
//! factory chain (`core/crates/server-core/src/rack.rs`,
//! `RackSpec::default_chain` built by `RackSpec::build`): a flat EQ and a
//! compressor at a ratio of 1, both prism-fx's, and no maximiser (it is off).
//! Neither changes the level, but neither is exact to the last bit either,
//! so the measures here go through the same two, built as MGL builds them.

use mgl_fx::comp::CompSettings;
use mgl_fx::eq::{EqMode, EqSettings};
use mgl_fx::{Compressor, Eq, Rack};

/// `live::MAX_BLOCK`, the room MGL's rack is built with.
const MAX_BLOCK: usize = 8192;

fn keyed(id: &str, get: impl Fn(&str) -> Option<f32>) -> Vec<(String, f32)> {
    mgl_fx::prism::specs(id).unwrap_or(&[]).iter().filter_map(|spec| get(spec.key).map(|v| (spec.key.to_string(), v))).collect()
}

fn eq_mode_index(m: EqMode) -> f32 {
    match m {
        EqMode::HighPass => 0.0,
        EqMode::LowShelf => 1.0,
        EqMode::Bell => 2.0,
        EqMode::Notch => 3.0,
        EqMode::HighShelf => 4.0,
        EqMode::LowPass => 5.0,
    }
}

fn get_eq_param(s: &EqSettings, key: &str) -> Option<f32> {
    let rest = key.strip_prefix("band.")?;
    let (i, field) = rest.split_once('.')?;
    let i = i.parse::<usize>().ok().filter(|i| *i < 8)?;
    let b = s.bands()[i];
    Some(match field {
        "freq" => b.freq,
        "q" => b.q,
        "gainDb" => b.gain_db,
        "enabled" => s.enabled[i] as u8 as f32,
        "mode" => eq_mode_index(s.modes[i]),
        _ => return None,
    })
}

fn get_comp_param(s: &CompSettings, key: &str) -> Option<f32> {
    Some(match key {
        "thresholdDb" => s.threshold_db,
        "ratio" => s.ratio,
        "attackMs" => s.attack_ms,
        "releaseMs" => s.release_ms,
        "kneeDb" => s.knee_db,
        "makeupDb" => s.makeup_db,
        _ => return None,
    })
}

/// A prism-fx effect built as MGL builds one: its own, unless the prism one
/// did not take every setting exactly (`rack.rs` `moved`).
fn moved(id: &str, sample_rate: u32, params: &[(String, f32)], own: impl FnOnce() -> Box<dyn mgl_fx::Effect>) -> Box<dyn mgl_fx::Effect> {
    match mgl_fx::prism::moved(id, sample_rate, params) {
        Some(e) if params.iter().all(|(k, v)| e.get_param(k).map(f32::to_bits) == Some(v.to_bits())) => e,
        _ => own(),
    }
}

/// MGL's factory rack for a document of `channels` at `sample_rate`.
pub fn factory(sample_rate: u32, channels: usize) -> Rack {
    let mut rack = Rack::with_capacity(MAX_BLOCK * channels.max(1));
    let eq = EqSettings::default();
    let eq_params = keyed("eq", |k| get_eq_param(&eq, k));
    let e = moved("eq", sample_rate, &eq_params, || Box::new(Eq::with_channels(eq, channels)));
    rack.push_slot(e, false);
    let comp = CompSettings { ratio: 1.0, ..CompSettings::default() };
    let comp_params = keyed("compressor", |k| get_comp_param(&comp, k));
    let c = moved("compressor", sample_rate, &comp_params, || Box::new(Compressor::new(comp)));
    rack.push_slot(c, false);
    rack
}

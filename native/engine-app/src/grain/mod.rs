//! The Grain module: MGL's Grain page, playing the sound cabled into it.
//!
//! The deck is MGL's own (`engine_mgl::Grain`, all of MGL's recorded hashes
//! to the bit). This is MGL's server's side of it, ported, and kept off the
//! audio thread: what `live.rs` does when a sound is opened (`load`) and when
//! a control moves (`push_params`, with its rules for what has to be rebuilt:
//! the transient map, the hybrid's separation, the layer bank), the rack
//! (`rack.rs`), `/api/engine/transport`, `/api/engine/voice`, the four LFOs
//! (`lfos.rs`, ticked every 8 ms as MGL's automation thread ticks them), the
//! presets (`presets.rs`) and the read-backs the page draws from
//! (`/api/engine/grains`, `/api/engine/master`).
//!
//! **The settings are the document's.** In MGL the Grain page's controls are
//! the document's stretch, on its edit list, posted to `/api/edit` like any
//! edit, so Edit's undo steps back through them. Here they are the stretch
//! of the Sound module cabled into Grain's Sound socket, so the same holds:
//! Edit and Grain on one Sound share one document. With nothing cabled,
//! Grain plays its own start sound, MGL's (a pulse wave, 25 % wide, at C3,
//! `api_start_sound`), so its keys play at once, as MGL's page does.
//!
//! The rack, the LFOs and the keys are the module's own. (MGL keeps them per
//! sound: the rack in `RACKS`, the LFOs and keys in the page; a Grain module
//! on the canvas is one sound's page.)

mod link;
pub mod lfos;
pub mod presets;
pub mod rack;
pub mod stretch;

use crate::sound_part::SoundPart;
use engine_mgl::grain::{Grain, Handle};
use lfos::{Bank, Out};
use mgl_engine::stretcher::LayerBank;
use mgl_engine::{KeyMode, Source};
use mgl_fx::grain::StreamParams;
use mgl_fx::stretch::{Algorithm, Quality};
use mgl_fx::Stretch;
use rack::RackSpec;
use serde_json::{json, Map, Value};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

/// The page's fixed size (`GS_W`, `GS_H`).
pub const GRAIN_W: u32 = 1388;
pub const GRAIN_H: u32 = 990;
/// The deck's own block: MGL's default buffer (`state.rs`, 1024 frames), so
/// the deck renders as MGL's does at its default.
pub const GRID: usize = 1024;
/// `live::MAX_BLOCK`.
pub const MAX_BLOCK: usize = 8192;
/// Poly's voices, made before the deck plays (MGL makes them as keys ask).
pub const VOICES: usize = 16;

/// What has to be rebuilt for a change to be heard (`live::Rebuilds`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Rebuilds {
    pub map: bool,
    pub parts: bool,
    pub bank: bool,
}

impl Rebuilds {
    pub fn decide(now: &StreamParams, want: &Stretch) -> Rebuilds {
        let settled = want.quality != Quality::Draft;
        Rebuilds {
            map: settled
                && (now.wsola.preserve_transients != want.wsola.preserve_transients
                    || now.wsola.sensitivity != want.wsola.sensitivity
                    || now.wsola.floor != want.wsola.floor
                    || now.wsola.guard_hops != want.wsola.guard_hops
                    || now.ratio != want.ratio
                    || now.window_ms != want.window_ms
                    || now.grain.overlap != want.grain.overlap
                    || now.grain.density_hz != want.grain.density_hz),
            parts: want.algorithm == Algorithm::Hybrid && (now.hybrid.split() != want.hybrid.split() || now.algorithm != Algorithm::Hybrid),
            bank: now.algorithm != want.algorithm || (settled && now.grain.layers != want.grain.layers),
        }
    }
}

/// `live::merge_stretch`: the document's stretch into the deck's settings,
/// field by field (the sound's own length and rate stay the deck's).
pub fn merge_stretch(p: &mut StreamParams, s: &Stretch) {
    p.ratio = s.ratio;
    p.semitones = s.semitones;
    p.window_ms = s.window_ms;
    p.grain = s.grain;
    p.algorithm = s.algorithm;
    p.wsola = s.wsola;
    p.vocoder = s.vocoder;
    p.pvsola = s.pvsola;
    p.hybrid = s.hybrid;
    p.soundhack = s.soundhack;
    p.cloud = s.cloud;
    p.cloud_mix = s.cloud_mix;
}

/// `live::idle_params`: what the deck holds before any sound.
fn idle_params(rate: u32) -> StreamParams {
    StreamParams::new(0, rate)
}

/// `live::map_for`: the map WSOLA needs, or none for a straight line.
fn map_for(source: &Source, stretch: &Stretch, sample_rate: u32) -> Option<mgl_fx::transient::TimeMap> {
    if !stretch.wsola.preserve_transients {
        return None;
    }
    let hop = mgl_fx::grain::plan(source.frames(), sample_rate, stretch.ratio, stretch.window_ms, &stretch.grain).hop.max(1);
    mgl_fx::stream::WsolaStream::build_map(&source.samples, source.channels, sample_rate, stretch.ratio, hop, &stretch.wsola)
}

/// MGL's start sound (`start_sound_samples`), as the file MGL writes it
/// (`capture::write_wav`: 24-bit, one channel, 48 kHz).
pub fn start_sound_wav() -> Vec<u8> {
    let sr = 48_000.0f64;
    let f0 = 130.812_782_650_299_3f64;
    let duty = 0.25f64;
    let n = sr as usize;
    let kmax = (20_000.0 / f0) as usize;
    let mut out = vec![0f32; n];
    for (i, s) in out.iter_mut().enumerate() {
        let t = i as f64 / sr;
        let mut v = 0.0;
        for k in 1..=kmax {
            let kf = k as f64;
            v += (2.0 / (kf * std::f64::consts::PI)) * (std::f64::consts::PI * kf * duty).sin() * (2.0 * std::f64::consts::PI * kf * f0 * t).cos();
        }
        *s = (v * 0.7) as f32;
    }
    let mut wav = audio_core::wav::header(out.len() as u64 * 3, 1, 48_000, audio_core::Codec::PcmI24).to_vec();
    for v in out {
        let q = (v.clamp(-1.0, 1.0) * 8_388_607.0) as i32;
        wav.extend_from_slice(&q.to_le_bytes()[..3]);
    }
    wav
}

/// MGL's `post_voice` on a deck's keys: how they play, any part of it.
pub fn apply_voice(k: &mgl_engine::GrainKeys, v: &Value) {
    let num = |x: Option<&Value>| x.and_then(Value::as_f64).filter(|n| n.is_finite()).map(|n| n as f32);
    if let Some(Value::Bool(on)) = v.get("front") {
        k.set_front(*on);
    }
    if let Some(m) = v.get("mode").and_then(Value::as_str) {
        if let Some(m) = KeyMode::from_name(m) {
            k.set_mode(m);
        }
    }
    if let Some(g) = num(v.get("glide")) {
        k.set_glide(g);
    }
    if let Some(b) = num(v.get("bend")) {
        k.set_bend(b);
    }
    let (a, d, s, r) = k.amp();
    let amp = (num(v.get("attack")), num(v.get("decay")), num(v.get("sustain")), num(v.get("release")));
    if amp != (None, None, None, None) {
        k.set_amp(amp.0.unwrap_or(a), amp.1.unwrap_or(d), amp.2.unwrap_or(s), amp.3.unwrap_or(r));
    }
    if let Some(Value::Bool(on)) = v.get("run") {
        k.set_run(*on);
    }
    if let Some(Value::Bool(on)) = v.get("replay") {
        k.set_replay(*on);
    }
    if let Some(f) = num(v.get("start")) {
        k.set_start(f);
    }
    if let Some(table) = v.get("keys").and_then(Value::as_array) {
        if table.len() == 128 {
            for (i, s) in table.iter().enumerate() {
                if let Some(s) = num(Some(s)) {
                    k.set_key(i, s);
                }
            }
        }
    }
    if matches!(v.get("allOff"), Some(Value::Bool(true))) {
        k.all_off();
    }
    if matches!(v.get("reset"), Some(Value::Bool(true))) {
        k.reset();
    }
}

/// What MGL's page sends on the way in (`gsVoiceSend`), with its own starting values.
pub fn page_voice() -> Value {
    json!({ "mode": "mono", "run": false, "glide": 0.3 * 0.3 * 2.0, "bend": 0.0, "bendRange": 2, "attack": 0.16f64.powi(2) * 4.0, "decay": 0.4f64.powi(2) * 4.0, "sustain": 0.78, "release": 0.5f64.powi(2) * 6.0, "start": 0, "replay": true })
}

pub struct GrainPart {
    pub handle: Handle,
    rate: u32,
    /// Grain's own sound, when no Sound module is cabled in.
    pub own: SoundPart,
    pub rack: RackSpec,
    pub bank: Bank,
    heard: Vec<Out>,
    driven: Vec<Out>,
    /// What MGL's page last sent to `/api/engine/voice`, merged, for the patch.
    pub voice: Map<String, Value>,
    /// What it last sent to `/api/engine/transport` (gain, mute, speed, the
    /// sides, the loop), for the patch.
    pub transport: Map<String, Value>,
    /// What the face keeps of its own (A/B, the LFO panel, the zoom, the
    /// octave, the MIDI channel ...), as it hands it over.
    pub ui: Value,
    /// The sound the deck holds: which module it came from (0: its own),
    /// that module's serial then, and the sound.
    fed: Option<(u32, u64)>,
    source: Option<Arc<Source>>,
    /// Bumped for every new sound, so a separation finished late for an old
    /// one is thrown away (as `separate_soon` checks the sound still open).
    sound_serial: Arc<AtomicU64>,
    /// The document's stretch serial when last handed over (module, serial).
    pub seen_stretch: Option<(u32, u64)>,
    /// Where its presets are.
    pub places: presets::Places,
}

impl GrainPart {
    /// A Grain module for an engine at `rate`, and its deck. `saved` is what
    /// a patch kept (`state`).
    pub fn new(rate: f32, saved: Option<&Value>) -> (GrainPart, Grain) {
        let rate_u = rate as u32;
        let deck = Grain::new(rate_u, GRID, idle_params(rate_u), Arc::new(Source { samples: Vec::new(), channels: 2 })).poly(VOICES);
        let mut own = SoundPart::empty();
        let _ = own.open(Arc::from(start_sound_wav().into_boxed_slice()), json!({ "kind": "start", "name": "Pulse 25%" }), rate_u);
        let mut part = GrainPart {
            handle: deck.handle(),
            rate: rate_u,
            own,
            rack: RackSpec::default_chain(),
            bank: Bank::default(),
            heard: Vec::new(),
            driven: Vec::new(),
            voice: Map::new(),
            transport: Map::new(),
            ui: Value::Null,
            fed: None,
            source: None,
            sound_serial: Arc::new(AtomicU64::new(0)),
            seen_stretch: None,
            places: presets::Places::default(),
        };
        // MGL's page sends its voice on the way in (`gsVoiceSend`): its own
        // starting values, until a patch says otherwise.
        part.keys(&page_voice());
        if let Some(s) = saved {
            part.restore(s);
        }
        (part, deck)
    }

    /// The patch's record of it. The own sound's edits (its stretch) come too.
    pub fn state(&self) -> Value {
        json!({
            "own": self.own.state(),
            "rack": self.rack.to_json(),
            "lfos": lfos::bank_json(&self.bank),
            "voice": Value::Object(self.voice.clone()),
            "transport": Value::Object(self.transport.clone()),
            "ui": self.ui,
        })
    }

    fn restore(&mut self, s: &Value) {
        if let Some(ops) = s.get("own").and_then(|o| o.get("ops")).and_then(Value::as_array) {
            self.own.replay(ops);
        }
        if let Some(r) = s.get("rack") {
            self.rack = RackSpec::from_json(r);
        }
        if let Some(l) = s.get("lfos") {
            let _ = lfos::post(&mut self.bank, l);
        }
        if let Some(v) = s.get("voice") {
            self.keys(v);
        }
        if let Some(t) = s.get("transport") {
            let mut t = t.clone();
            if let Some(o) = t.as_object_mut() {
                o.remove("play");
                o.remove("seek");
            }
            self.transport_msg(&t);
        }
        self.ui = s.get("ui").cloned().unwrap_or(Value::Null);
    }

    pub fn rate(&self) -> u32 {
        self.rate
    }

    /// Which sound the deck holds now (0: its own), and that module's serial.
    pub fn fed(&self) -> Option<(u32, u64)> {
        self.fed
    }

    pub fn source(&self) -> Option<&Arc<Source>> {
        self.source.as_ref()
    }

    /// A new sound into the deck: MGL's `live::load`, for a document whose
    /// stretch is `stretch`. `from` is the module it came from (0: its own).
    pub fn load(&mut self, from: u32, serial: u64, source: Arc<Source>, stretch: &Stretch) {
        let sh = Arc::clone(self.handle.shared());
        let rate = self.rate;
        let channels = source.channels.max(1);
        let params = StreamParams {
            in_frames: source.frames(),
            sample_rate: rate,
            ratio: stretch.ratio,
            semitones: stretch.semitones,
            window_ms: stretch.window_ms,
            grain: stretch.grain,
            algorithm: stretch.algorithm,
            wsola: stretch.wsola,
            vocoder: stretch.vocoder,
            pvsola: stretch.pvsola,
            hybrid: stretch.hybrid,
            soundhack: stretch.soundhack,
            cloud: stretch.cloud,
            cloud_mix: stretch.cloud_mix,
        };
        sh.set_source(Arc::clone(&source));
        let mut p = params;
        self.reapply(&mut p);
        sh.set_params(p);
        sh.set_map(map_for(&source, stretch, rate));
        sh.set_parts(Arc::new(mgl_fx::hstream::Parts::default()));
        sh.request_seek(0);
        sh.reset_governor();
        sh.reset_load();
        sh.set_rack(self.built_rack(channels));
        sh.set_pitch_time(self.rack.pitch_time);
        sh.set_post_roll_frames((self.rack.post_roll_ms() as f64 * 0.001 * rate as f64) as u64);
        self.sound_serial.fetch_add(1, Ordering::AcqRel);
        if stretch.algorithm == Algorithm::Hybrid {
            self.separate(Arc::clone(&source), stretch.hybrid);
        }
        sh.set_bank(LayerBank::build(stretch.algorithm, stretch.grain.layers, MAX_BLOCK, channels, rate));
        self.handle.stock_voices(VOICES);
        self.fed = Some((from, serial));
        self.source = Some(source);
        // What the page does after a load: the loop, and the head to the cue.
        if let Some(l) = self.transport.get("loop").cloned() {
            self.transport_msg(&json!({ "loop": l }));
        }
    }

    /// The live rack for this module's settings, or none when nothing is in
    /// it (`live::rack_for`).
    fn built_rack(&self, channels: usize) -> Option<mgl_fx::Rack> {
        let rack = self.rack.build(self.rate, channels);
        if rack.is_empty() {
            None
        } else {
            Some(rack)
        }
    }

    /// `live::separate_soon`: the hybrid's separation, on a thread of its
    /// own, thrown away if the sound has changed by the time it is ready.
    fn separate(&self, source: Arc<Source>, hybrid: mgl_fx::hybrid::HybridParams) {
        let shared = Arc::clone(self.handle.shared());
        let serial = Arc::clone(&self.sound_serial);
        let was = serial.load(Ordering::Acquire);
        let _ = std::thread::Builder::new().name("separate".into()).spawn(move || {
            let parts = mgl_fx::hstream::Parts::separate(&source.samples, source.channels, hybrid);
            if serial.load(Ordering::Acquire) == was {
                shared.set_parts(Arc::new(parts));
            }
        });
    }

    /// The document's stretch changed: MGL's `live::push_params`.
    pub fn push(&mut self, stretch: &Stretch) {
        let sh = Arc::clone(self.handle.shared());
        let Some(src) = self.source.clone() else { return };
        let r = match sh.params() {
            Some(mut p) => {
                let r = Rebuilds::decide(&self.unswung(&p), stretch);
                merge_stretch(&mut p, stretch);
                self.reapply(&mut p);
                sh.set_params(p);
                r
            }
            None => Rebuilds::default(),
        };
        let (want_map, want_parts, mut want_bank) = (r.map, r.parts, r.bank);
        let settled = stretch.quality != Quality::Draft;
        if settled && sh.bank_layers() != stretch.grain.layers.max(1) {
            want_bank = true;
        }
        if want_parts {
            self.separate(Arc::clone(&src), stretch.hybrid);
        }
        if want_map && stretch.wsola.preserve_transients {
            sh.set_map(map_for(&src, stretch, self.rate));
        } else if want_map {
            sh.set_map(None);
        }
        if want_bank {
            sh.set_bank(LayerBank::build(stretch.algorithm, stretch.grain.layers, MAX_BLOCK, src.channels.max(1), self.rate));
            self.handle.stock_voices(VOICES);
        }
    }

    /// The settings with every LFO's swing taken back out (`GrainLfos::unswung`).
    fn unswung(&self, p: &StreamParams) -> StreamParams {
        let mut was = *p;
        for o in &self.driven {
            lfos::set_stream_field(&mut was, &o.target, o.base);
        }
        was
    }

    /// The swing back on top (`GrainLfos::reapply`).
    fn reapply(&self, p: &mut StreamParams) {
        for o in &self.driven {
            lfos::set_stream_field(p, &o.target, o.value);
        }
    }

    // ──────────────────────────────────────────────────────────── the keys

    /// `POST /api/engine/voice`: how the keys play, any part of it. MGL's answer.
    pub fn keys(&mut self, v: &Value) -> Value {
        let k = Arc::clone(self.handle.keys());
        apply_voice(&k, v);
        if let Some(o) = v.as_object() {
            for (key, val) in o {
                if !matches!(key.as_str(), "allOff" | "reset") {
                    self.voice.insert(key.clone(), val.clone());
                }
            }
        }
        let (a, d, s, r) = k.amp();
        json!({
            "ok": true, "mode": k.mode().name(), "run": k.run(), "replay": k.replay(), "glide": k.glide() as f64,
            "bend": k.bend() as f64, "attack": a as f64, "decay": d as f64, "sustain": s as f64, "release": r as f64,
            "start": k.start() as f64,
        })
    }

    // ───────────────────────────────────────────────────────── the transport

    /// `POST /api/engine/transport`: seek, gain, mute, speed, the sides, the
    /// loop, play. Where the deck is (its output frames).
    pub fn transport_msg(&mut self, v: &Value) -> Value {
        let num = |k: &str| v.get(k).and_then(Value::as_f64).filter(|n| n.is_finite());
        let sh = Arc::clone(self.handle.shared());
        if let Some(f) = num("seek") {
            sh.request_seek(f.max(0.0) as u64);
        }
        if let Some(g) = num("gain") {
            sh.set_gain(g as f32);
        }
        if let Some(Value::Bool(m)) = v.get("mute") {
            sh.set_mute(*m);
        }
        if let Some(r) = num("speed") {
            sh.set_speed(r as f32);
        }
        if num("gainL").is_some() || num("gainR").is_some() {
            let (l, r) = sh.side_gains();
            sh.set_side_gains(num("gainL").map_or(l, |g| g as f32), num("gainR").map_or(r, |g| g as f32));
        }
        if let Some(l) = v.get("loop") {
            let on = matches!(l.get("on"), Some(Value::Bool(true)));
            let a = l.get("a").and_then(Value::as_f64).unwrap_or(0.0) as u64;
            let b = l.get("b").and_then(Value::as_f64).unwrap_or(0.0) as u64;
            sh.set_loop(on, a, b);
        }
        match v.get("play") {
            Some(Value::Bool(true)) => {
                self.handle.keys().set_played(true);
                sh.play()
            }
            Some(Value::Bool(false)) => {
                self.handle.keys().set_played(false);
                sh.pause()
            }
            _ => {}
        }
        if let Some(o) = v.as_object() {
            for (key, val) in o {
                if matches!(key.as_str(), "gain" | "mute" | "speed" | "gainL" | "gainR" | "loop") {
                    self.transport.insert(key.clone(), val.clone());
                }
            }
        }
        json!({ "position": sh.position() as f64 })
    }

    // ──────────────────────────────────────────────────────────── the rack

    /// The rack as MGL's `/api/rack` answers it.
    pub fn rack_json(&self) -> Value {
        self.rack.to_json()
    }

    /// `POST /api/rack`: the whole rack, as the page sends it. Its structure
    /// changed: built and handed over (one slot swapped when only that one
    /// changed kind, as MGL's `switched_slot`), unless `keepLive`.
    pub fn rack_set(&mut self, v: &Value) -> Value {
        let mut spec = RackSpec::from_json(v);
        let had = self.rack.clone();
        if v.get("pitchTime").is_none() {
            spec.pitch_time = had.pitch_time;
        }
        if v.get("postRoll").is_none() {
            spec.post_roll = had.post_roll.clone().into_iter().filter(|(id, _)| id == rack::PAD_STRETCH || id == rack::PAD_PITCH_TIME || spec.slot_ids.contains(id)).collect();
        }
        self.rack = spec;
        if !matches!(v.get("keepLive"), Some(Value::Bool(true))) {
            self.hand_rack(Some(&had));
        }
        let sh = self.handle.shared();
        sh.set_pitch_time(self.rack.pitch_time);
        sh.set_post_roll_frames((self.rack.post_roll_ms() as f64 * 0.001 * self.rate as f64) as u64);
        self.rack.to_json()
    }

    /// The rack built again and handed to the deck.
    pub fn hand_rack(&mut self, had: Option<&RackSpec>) {
        let channels = self.source.as_ref().map_or(2, |s| s.channels.max(1));
        let sh = Arc::clone(self.handle.shared());
        match had.and_then(|h| switched_slot(&self.rack, h)) {
            Some(i) => sh.swap_slot(i, self.rack.build_slot(i, self.rate, channels)),
            None => sh.set_rack(self.built_rack(channels)),
        }
    }

    /// `POST /api/rack/param`: one control of one slot (by its id, or
    /// "master" for the maximiser's amount), heard at once with its tails.
    pub fn rack_param(&mut self, id: &str, key: &str, value: f32, live_only: bool) -> Result<Value, String> {
        let sh = Arc::clone(self.handle.shared());
        if id == "master" {
            if key != "amount" {
                return Err("only amount is live on the master".into());
            }
            let applied = value.clamp(0.0, 1.0);
            self.rack.master.amount = applied;
            let at = self.rack.slots.len();
            sh.set_manual_param(at, key, applied);
            return Ok(json!({ "id": id, "key": key, "value": applied as f64 }));
        }
        let slot = self.rack.slot_ids.iter().position(|x| x == id).ok_or("no such module in the rack")?;
        if live_only {
            let mut probe = self.rack.clone();
            if !probe.set_param(slot, key, value) {
                return Err("no such control on that module".into());
            }
            let applied = probe.get_param(slot, key).unwrap_or(value);
            sh.set_manual_param(slot, key, applied);
            return Ok(json!({ "id": id, "key": key, "value": applied as f64, "live": true }));
        }
        if !self.rack.set_param(slot, key, value) {
            return Err("no such control on that module".into());
        }
        let applied = self.rack.get_param(slot, key).unwrap_or(value);
        sh.set_manual_param(slot, key, applied);
        Ok(json!({ "id": id, "key": key, "value": applied as f64 }))
    }

    // ──────────────────────────────────────────────────────────── the LFOs

    pub fn lfos_post(&mut self, v: &Value) -> Result<Value, String> {
        lfos::post(&mut self.bank, v)
    }

    pub fn lfos_get(&self) -> Value {
        lfos::get(&self.bank, &self.heard)
    }

    /// One tick of MGL's automation runner, for the LFOs: the phases run on
    /// by `dt` seconds; with the deck holding a sound and anything aimed,
    /// this tick's values go into its settings and its rack, and a control
    /// let go is put back where the document has it.
    pub fn tick(&mut self, dt: f64, doc: &Stretch) {
        let note_ons = self.handle.keys().note_ons();
        self.bank.advance(dt, note_ons);
        let holding = self.source.is_some() && (self.bank.is_aimed() || !self.driven.is_empty());
        if !holding {
            if !self.bank.is_aimed() {
                self.heard.clear();
                self.driven.clear();
            } else {
                self.heard = lfos::compute(&self.bank, doc, &self.rack);
                self.driven.clear();
            }
            return;
        }
        let outs = lfos::compute(&self.bank, doc, &self.rack);
        let mut released = Vec::new();
        for o in &self.driven {
            if !outs.iter().any(|n| n.target == o.target) {
                if let Some(base) = lfos::base_now(doc, &self.rack, &o.target) {
                    released.push(Out { target: o.target.clone(), base, value: base });
                }
            }
        }
        self.heard = outs.clone();
        self.driven = outs.clone();
        let sh = Arc::clone(self.handle.shared());
        let writes = lfos::rack_writes(&outs, &self.rack);
        for o in &released {
            if let Some((i, key)) = lfos::rack_slot(&self.rack, &o.target) {
                sh.set_manual_param(i, key, o.base);
            }
        }
        sh.set_automation(writes);
        sh.update_params(|p| lfos::apply_stream(&outs, &released, p));
    }

    // ─────────────────────────────────────────────────────── the read-backs

    /// `GET /api/engine/grains`, as the page reads it: the grains started
    /// since last asked, the keys, Poly's heads, where the deck is, the
    /// output's spectrum and wave, the load.
    pub fn grains(&self) -> Value {
        let sh = self.handle.shared();
        let k = self.handle.keys();
        let sr = self.rate.max(1) as f64;
        let events: Vec<Value> = sh
            .drain_events()
            .iter()
            .map(|e| json!({ "voice": e.voice as f64, "t": e.out_frame as f64 / sr, "src": e.src_frame as f64 / sr, "size": e.size as f64 / sr, "rate": e.rate as f64, "semis": e.pitch_semis as f64 }))
            .collect();
        let heads: Vec<Value> = sh.voices.heads().iter().map(|h| json!({ "key": h.key as f64, "voice": h.voice as f64, "src": h.src as f64 / sr, "env": h.env as f64 })).collect();
        let (now, mean, worst) = sh.load();
        json!({
            "keys": { "head": k.head() as f64, "sounding": k.sounding(), "noteOns": k.note_ons() as f64, "pitch": k.pitch() as f64 },
            "heads": heads,
            "position": sh.position() as f64,
            "ratio": sh.params().map(|p| p.ratio as f64).unwrap_or(1.0),
            "sampleRate": sr,
            "playing": sh.is_playing(),
            "sounding": sh.sounding(),
            "latency": sh.latency_frames() as f64,
            "grains": events,
            "spectrum": sh.spectrum(),
            "waveform": sh.waveform(),
            "load": { "now": now as f64, "mean": mean as f64, "worst": worst as f64, "layerCap": sh.layer_cap() as f64, "shedding": sh.sheds_layers(), "layersRunning": sh.layers_running.load(Ordering::Relaxed) as f64 },
            "loop": sh.heard_loop().map(|(a, b)| json!([a, b])),
            "voices": self.handle.voices_running(),
            "outFrames": sh.params().map(|p| p.plan().out_frames as f64).unwrap_or(0.0),
            "inFrames": self.source.as_ref().map_or(0.0, |s| s.frames() as f64),
        })
    }
}

/// `RackSpec::switched_slot`: the one slot whose kind alone changed.
fn switched_slot(now: &RackSpec, had: &RackSpec) -> Option<usize> {
    if now.slots.len() != had.slots.len() || now.slot_ids != had.slot_ids {
        return None;
    }
    let i = (0..now.slots.len()).find(|&i| now.slots[i].kind() != had.slots[i].kind())?;
    if now.slots[i].bypassed() != had.slots[i].bypassed() {
        return None;
    }
    let mut probe = now.clone();
    probe.slots[i] = had.slots[i].clone();
    let id = &now.slot_ids[i];
    match had.modules.get(id) {
        Some(m) => probe.modules.insert(id.clone(), m.clone()),
        None => probe.modules.remove(id),
    };
    (probe == *had).then_some(i)
}

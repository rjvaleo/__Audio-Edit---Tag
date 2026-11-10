//! Lanes on disk, the runner, and the store.

use super::*;

// ------------------------------------------------------------------ storage

pub(super) fn number(v: Option<&Value>, d: f32) -> f32 {
    match v {
        Some(Value::Num(n)) if n.is_finite() => *n as f32,
        _ => d,
    }
}
fn text(v: Option<&Value>, d: &str) -> String {
    v.and_then(Value::as_str).unwrap_or(d).to_string()
}

pub(super) fn lane_json(l: &Lane) -> Value {
    Value::obj()
        .set("id", l.id.clone())
        .set("target", l.target.clone())
        .set("label", l.label.clone())
        .set("enabled", l.enabled)
        .set("trim", l.trim as f64)
        .set(
            "loop",
            match l.loop_range {
                Some((a, b)) => Value::Arr(vec![Value::Num(a as f64), Value::Num(b as f64)]),
                None => Value::Null,
            },
        )
        .set(
            "points",
            Value::Arr(
                l.points
                    .iter()
                    .map(|p| {
                        Value::obj()
                            .set("frame", p.frame)
                            .set("value", p.value as f64)
                            .set("curve", p.curve.name())
                            .set("tension", p.tension as f64)
                    })
                    .collect(),
            ),
        )
        .set(
            "modulators",
            Value::Arr(l.modulators.iter().map(mod_json).collect()),
        )
}

pub(super) fn lane_from(v: &Value) -> Option<Lane> {
    let id = text(v.get("id"), "");
    let target = text(v.get("target"), "");
    if id.is_empty() || target.is_empty() {
        return None;
    }
    let mut points = match v.get("points") {
        Some(Value::Arr(a)) => a
            .iter()
            .map(|p| Point {
                frame: number(p.get("frame"), 0.0).max(0.0) as u64,
                value: number(p.get("value"), 0.0).clamp(0.0, 1.0),
                curve: Curve::from(p.get("curve").and_then(Value::as_str).unwrap_or("linear")),
                tension: number(p.get("tension"), 0.0).clamp(-2.0, 2.0),
            })
            .collect::<Vec<_>>(),
        _ => Vec::new(),
    };
    points.sort_by_key(|p| p.frame);
    points.dedup_by_key(|p| p.frame);
    Some(Lane {
        id,
        target,
        label: text(v.get("label"), "Automation"),
        enabled: !matches!(v.get("enabled"), Some(Value::Bool(false))),
        trim: number(v.get("trim"), 0.0).clamp(-1.0, 1.0),
        loop_range: match v.get("loop") {
            Some(Value::Arr(a)) if a.len() == 2 => {
                let x = number(a.first(), 0.0) as u64;
                let y = number(a.get(1), 0.0) as u64;
                (y > x).then_some((x, y))
            }
            _ => None,
        },
        points,
        modulators: match v.get("modulators") {
            Some(Value::Arr(a)) => a.iter().filter_map(mod_from).collect(),
            _ => Vec::new(),
        },
    })
}

fn mod_json(m: &Modulator) -> Value {
    let base = Value::obj().set("kind", m.kind());
    match m {
        Modulator::Lfo {
            shape,
            rate,
            depth,
            offset,
            phase,
        } => base
            .set("shape", shape.clone())
            .set("rate", *rate as f64)
            .set("depth", *depth as f64)
            .set("offset", *offset as f64)
            .set("phase", *phase as f64),
        Modulator::Steps { rate, values } => base.set("rate", *rate as f64).set(
            "values",
            Value::Arr(values.iter().map(|v| Value::Num(*v as f64)).collect()),
        ),
        Modulator::SampleHold { rate, depth, seed } => base
            .set("rate", *rate as f64)
            .set("depth", *depth as f64)
            .set("seed", *seed),
    }
}

fn mod_from(v: &Value) -> Option<Modulator> {
    Some(match v.get("kind")?.as_str()? {
        "lfo" => Modulator::Lfo {
            shape: text(v.get("shape"), "sine"),
            rate: number(v.get("rate"), 1.0).clamp(0.001, 100.0),
            depth: number(v.get("depth"), 0.5).clamp(-1.0, 1.0),
            offset: number(v.get("offset"), 0.0).clamp(-1.0, 1.0),
            phase: number(v.get("phase"), 0.0).rem_euclid(1.0),
        },
        "steps" => Modulator::Steps {
            rate: number(v.get("rate"), 2.0).clamp(0.01, 100.0),
            values: match v.get("values") {
                Some(Value::Arr(a)) => a
                    .iter()
                    .map(|x| number(Some(x), 0.0).clamp(-1.0, 1.0))
                    .take(64)
                    .collect(),
                _ => vec![0.0],
            },
        },
        "sampleHold" => Modulator::SampleHold {
            rate: number(v.get("rate"), 2.0).clamp(0.01, 100.0),
            depth: number(v.get("depth"), 0.5).clamp(-1.0, 1.0),
            seed: number(v.get("seed"), 1.0).max(0.0) as u64,
        },
        // An unknown kind is dropped rather than guessed at, so a lane written
        // by a newer build loses the modulator and keeps the curve.
        _ => return None,
    })
}

/// How often the control thread resolves the lanes, in milliseconds.
///
/// Automation is control-rate, not audio-rate. Eight milliseconds is finer than
/// any hand and coarse enough that resolving every lane costs nothing; the
/// audio callback re-applies the last values on every block in between, so
/// nothing lapses between ticks.
pub const TICK_MS: u64 = 8;

/// Where the engine's clock and the document's meet.
///
/// The engine counts output frames at the *device's* rate. Lanes are drawn
/// against document frames at the *file's* rate. They are the same instant
/// expressed two ways, and everything downstream assumes document frames.
pub fn engine_to_document(position: u64, device_rate: u32, file_rate: u32) -> u64 {
    if device_rate == 0 || file_rate == 0 || device_rate == file_rate {
        return position;
    }
    (position as u128 * file_rate as u128 / device_rate as u128) as u64
}

/// Start the thread that resolves lanes into engine writes while a document plays.
///
/// It owns every allocation involved: the write vector is built here, handed to
/// the transport, and dropped here when it is replaced. Nothing on the audio
/// thread allocates or frees — see `engine::transport::Shared::automation`.
pub fn start_runner(app: std::sync::Arc<crate::state::App>) {
    std::thread::Builder::new()
        .name("automation".into())
        .spawn(move || {
            let mut writes: Vec<Write> = Vec::new();
            // Whether the last tick left anything written into the rack, so the
            // clear on stop happens once rather than every 8 ms.
            let mut wrote = false;
            let mut notes = crate::grain_notes::Cursor::default();
            let mut lfos = crate::grain_lfos::Runner::default();
            loop {
                std::thread::sleep(std::time::Duration::from_millis(TICK_MS));
                lfos.advance(&app);
                let playing = app.playing.read().ok().and_then(|g| g.clone());
                let Some(now) = playing else {
                    lfos.idle(&app);
                    continue;
                };

                // Latch keeps laying the held value down until the transport
                // stops. Touch does not — it ends when the hand comes off,
                // which is the message that stopped arriving.
                let latching = app.automation.record_mode() == Record::Latch;
                let held = if latching { app.automation.held() } else { Vec::new() };
                if !held.is_empty() {
                    let playing =
                        crate::live::with(&app, |h| h.shared.is_playing()).unwrap_or(false);
                    if playing {
                        if let Some(frame) = playhead(&app) {
                            for (target, unit) in &held {
                                app.automation.record_point(
                                    &now.rel,
                                    target,
                                    target,
                                    *unit,
                                    frame,
                                    now.doc_rate,
                                );
                            }
                        }
                    } else {
                        // Stopped: the pass is over and nothing is held.
                        app.automation.release_all();
                        let _ = app.automation.save(&app.automation_path());
                    }
                }

                let automation = if now.document {
                    app.automation
                        .get_for(&now.rel, now.doc_frames, now.doc_channels, now.doc_rate)
                } else {
                    // A library audition is the bare sound, on purpose. Lanes
                    // belong to the document and do not run over it.
                    Automation::default()
                };

                crate::grain_notes::tick(&app, &now, &automation, &mut notes);

                // The LFOs run with no lanes at all, so nothing here may stop
                // for want of a lane while one is holding the sound.
                let held = lfos.holding(&app, &now);
                if !held {
                    lfos.idle(&app);
                }

                if automation.is_silent() && !held {
                    if wrote {
                        let _ = crate::live::with(&app, |h| {
                            h.shared.clear_automation();
                        });
                        wrote = false;
                    }
                    continue;
                }

                let spec = app.racks.get(&now.rel);
                let _ = crate::live::with(&app, |h| {
                    let frame =
                        engine_to_document(h.shared.position(), now.device_rate, now.doc_rate);
                    let file_rate = now.doc_rate;

                    rack_controls(&automation, &spec, frame, file_rate, &mut writes);
                    let swing = held.then(|| {
                        let lanes = crate::grain_lfos::Lanes { automation: &automation, frame, sample_rate: file_rate };
                        lfos.plan(&app, &spec, &lanes)
                    });
                    if let Some((outs, released)) = &swing {
                        crate::grain_lfos::merge_rack(outs, &spec, &mut writes);
                        crate::grain_lfos::release_rack(released, &spec, &h.shared);
                    }
                    h.shared.set_automation(writes.clone());

                    h.shared.update_params(|p| {
                        apply_stretch(&automation, p, frame, file_rate);
                        if let Some((outs, released)) = &swing {
                            crate::grain_lfos::apply_stream(outs, released, p);
                        }
                    });
                    if automation.lanes.iter().any(|l| l.enabled && l.target.starts_with("ptc.")) {
                        let mut pt = spec.pitch_time;
                        apply_pitch_time(&automation, &mut pt, frame, file_rate);
                        h.shared.set_pitch_time(pt);
                    }
                });
                wrote = true;
            }
        })
        .ok();
}

/// Where the playhead is, on the document's own timeline.
///
/// The engine counts in device frames at the device's rate; a lane counts in
/// document frames at the file's. `engine_to_document` is the one conversion,
/// and recording has to use it or a take drawn at 48 kHz would play back
/// somewhere else on a 44.1 kHz file.
pub fn playhead(app: &std::sync::Arc<crate::state::App>) -> Option<u64> {
    let now = app.playing.read().ok().and_then(|g| g.clone())?;
    crate::live::with(app, |h| {
        engine_to_document(h.shared.position(), now.device_rate, now.doc_rate)
    })
    .ok()
}

/// How a control moved while playing is written into its lane.
///
/// Drawing a curve with a pointer is exact and slow. Recording a move is
/// neither, and it is how anyone actually arrives at a filter sweep that fits
/// the sound — you listen, you move it, you keep the take.
///
/// `Write` is deliberately absent. It overwrites lanes you have not touched,
/// from the moment playback starts, which needs per-lane arming and a rule for
/// what a control reads back while its own lane is driving it. Half of that is
/// a way to lose work quietly, so it is not here rather than here and
/// approximate.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Record {
    #[default]
    Off,
    /// While the hand is on it, and not a moment longer.
    Touch,
    /// From the first move until the transport stops.
    Latch,
}

impl Record {
    pub fn as_str(self) -> &'static str {
        match self {
            Record::Off => "off",
            Record::Touch => "touch",
            Record::Latch => "latch",
        }
    }

    pub fn from_str(s: &str) -> Option<Record> {
        Some(match s {
            "off" => Record::Off,
            "touch" => Record::Touch,
            "latch" => Record::Latch,
            _ => return None,
        })
    }
}

/// How close two recorded points may be, in milliseconds of the document.
///
/// A drag arrives sixty times a second and latch writes on every runner tick,
/// which would be a hundred and twenty points a second — more than a lane can
/// usefully hold and more than anyone could edit afterwards. A new point takes
/// out anything already within this of it, which thins the take and makes a
/// second pass overwrite the first in the same move.
const RECORD_THIN_MS: u64 = 50;

/// The lanes for every file, keyed by library-relative path.
pub struct AutomationStore {
    pub(super) by_path: Mutex<BTreeMap<String, Automation>>,
    pub(super) record: Mutex<Record>,
    /// Targets latched on, with the last unit value each was left at.
    pub(super) held: Mutex<BTreeMap<String, f32>>,
    /// Where each lane was last written, keyed by path and target. What makes
    /// a take a take rather than sixty unrelated points.
    pub(super) last_at: Mutex<BTreeMap<(String, String), u64>>,
}

impl AutomationStore {
    pub fn load(path: &Path) -> Self {
        let map = std::fs::read_to_string(path)
            .ok()
            .and_then(|s| json::parse(&s))
            .and_then(|v| match v {
                Value::Obj(m) => Some(m),
                _ => None,
            })
            .unwrap_or_default();
        Self {
            by_path: Mutex::new(
                map.into_iter()
                    .map(|(k, v)| (k, Automation::from_json(&v)))
                    .collect(),
            ),
            // Never restored from disk. Coming back to a session already armed
            // and then pressing play would overwrite the take you saved.
            record: Mutex::new(Record::Off),
            held: Mutex::new(BTreeMap::new()),
            last_at: Mutex::new(BTreeMap::new()),
        }
    }

    pub fn record_mode(&self) -> Record {
        *self.record.lock().unwrap()
    }

    pub fn set_record_mode(&self, mode: Record) {
        *self.record.lock().unwrap() = mode;
        self.last_at.lock().unwrap().clear();
        if mode == Record::Off {
            self.held.lock().unwrap().clear();
        }
    }

    /// Keep writing this target until the transport stops. Latch only.
    pub fn hold(&self, target: &str, unit: f32) {
        self.held.lock().unwrap().insert(target.to_string(), unit);
    }

    /// What is still latched on, for the runner to keep laying down.
    pub fn held(&self) -> Vec<(String, f32)> {
        self.held
            .lock()
            .unwrap()
            .iter()
            .map(|(k, v)| (k.clone(), *v))
            .collect()
    }

    pub fn release_all(&self) {
        self.held.lock().unwrap().clear();
        // The next pass is a new take, and must not think it is continuing
        // this one — otherwise a rewind and a second go would leave the span
        // between them wiped.
        self.last_at.lock().unwrap().clear();
    }

    /// Write one control's value into its lane at one moment.
    ///
    /// Creates the lane if the target has none, so recording a control that
    /// was never drawn works without setting anything up first — which is the
    /// point of recording.
    ///
    /// Returns whether anything changed, so a caller can avoid saving the file
    /// on a tick that did nothing.
    pub fn record_point(
        &self,
        key: &str,
        target: &str,
        label: &str,
        unit: f32,
        frame: u64,
        sample_rate: u32,
    ) -> bool {
        let thin = (sample_rate.max(1) as u64 * RECORD_THIN_MS) / 1000;

        // Where this lane was last written in this pass, if it is still going.
        // Deciding thinning and overwriting from *this* rather than from the
        // points already in the lane is the whole difference between a take
        // and a single sliding point: a rule that deleted everything within
        // the window of each new point deleted its own predecessor every time,
        // and sixty writes came out as one.
        let mut marks = self.last_at.lock().unwrap();
        let mark = (key.to_string(), target.to_string());
        let last = marks.get(&mark).copied();
        if let Some(prev) = last {
            // Too soon to be a new point. The take is denser than a lane can
            // use, and the value that matters is the one at the end of the
            // window, which the next write past it will carry.
            if frame >= prev && frame - prev < thin {
                return false;
            }
        }
        marks.insert(mark, frame);
        drop(marks);

        let mut map = self.by_path.lock().unwrap();
        let a = map.entry(key.to_string()).or_default();
        let lane = match a.lanes.iter_mut().position(|l| l.target == target) {
            Some(i) => &mut a.lanes[i],
            None => {
                a.lanes.push(Lane {
                    id: format!("rec-{target}"),
                    target: target.to_string(),
                    label: label.to_string(),
                    enabled: true,
                    trim: 0.0,
                    loop_range: None,
                    points: Vec::new(),
                    modulators: Vec::new(),
                });
                a.lanes.last_mut().expect("just pushed")
            }
        };
        // Clear what the pass has just travelled over, so a second run at a
        // section replaces the first rather than laying a curve on top of it.
        // With nothing behind us — the first point of a take, or one written
        // after a rewind — only this moment is cleared.
        match last.filter(|prev| *prev < frame) {
            Some(prev) => lane.points.retain(|p| p.frame <= prev || p.frame > frame),
            None => lane.points.retain(|p| p.frame.abs_diff(frame) > thin),
        }
        let at = lane.points.partition_point(|p| p.frame < frame);
        lane.points.insert(
            at,
            Point {
                frame,
                value: unit.clamp(0.0, 1.0),
                curve: Curve::Linear,
                tension: 0.0,
            },
        );
        true
    }

    pub fn get(&self, key: &str) -> Automation {
        self.by_path
            .lock()
            .unwrap()
            .get(key)
            .cloned()
            .unwrap_or_default()
    }

    /// The lanes for a file, but only if they were drawn against this file.
    pub fn get_for(&self, key: &str, frames: u64, channels: u16, sample_rate: u32) -> Automation {
        let a = self.get(key);
        if a.matches(frames, channels, sample_rate) {
            a
        } else {
            Automation::default()
        }
    }

    pub fn set(&self, key: &str, a: Automation) {
        self.by_path.lock().unwrap().insert(key.to_string(), a);
    }

    /// Change a file's automation in place, with nothing else writing to it.
    pub fn update(&self, key: &str, f: impl FnOnce(&mut Automation)) {
        f(self.by_path.lock().unwrap().entry(key.to_string()).or_default());
    }

    pub fn save(&self, path: &Path) -> std::io::Result<()> {
        let root = Value::Obj(
            self.by_path
                .lock()
                .unwrap()
                .iter()
                .map(|(k, v)| (k.clone(), v.to_json()))
                .collect(),
        );
        crate::persist::write_atomic(path, &root.to_string())
    }
}

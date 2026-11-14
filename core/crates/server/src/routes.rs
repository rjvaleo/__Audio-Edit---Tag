//! Request routing.

use crate::http::{parse_range, Request, Response};
use crate::json::{self, Value};
use crate::safety::{resolve_for_write, resolve_within};
use crate::state::{App, Index};
use audio_core::{probe, wav, FileSource, RandomAccessSource};
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::Arc;

mod assets;
pub use assets::*;
mod library;
use library::*;
mod audio_view;
use audio_view::*;
mod compose;
use compose::*;
mod fx_rack;
use fx_rack::*;
mod pad_automation;
use pad_automation::*;
mod grains;
use grains::*;
mod presets;
use presets::*;
mod edit_view;
use edit_view::*;
mod export;
pub use export::*;
mod video;
use video::*;
mod engine_api;
use engine_api::*;
mod record;
use record::*;
mod listen_tags;
use listen_tags::*;
mod map;
use map::*;
mod analytics;
use analytics::*;
mod prism;
use prism::*;

/// How many files one measuring pass takes on before answering.
///
/// The number is a compromise between a request that returns and a queue that
/// drains. Thirty-two files is a second or two of work on a normal library, and
/// ordinary use of the interface produces requests often enough that a few
/// hundred unmeasured files are worked through in the background of a session
/// rather than in front of one stalled click.
const PASS_BATCH: usize = 32;

/// How often the classifier's answers reach disk within a pass.
const LABEL_FLUSH: usize = 8;

pub fn route(app: &Arc<App>, req: &Request) -> Response {
    match (req.method.as_str(), req.path.as_str()) {
        // The interface is compiled into the binary, so a new build is a new
        // page — but the browser was never told that. With no Cache-Control and
        // no validator, it applies its own heuristics and happily serves a
        // stale app.js through restarts and reloads alike, which means a rebuilt
        // interface silently does not appear. Nothing here is worth caching:
        // it is served from local memory over the loopback.
        ("GET" | "HEAD", "/") | ("GET" | "HEAD", "/index.html") => {
            Response::ok("text/html; charset=utf-8", UI_HTML.as_bytes().to_vec())
                .with("Cache-Control", "no-store, must-revalidate")
        }
        ("GET" | "HEAD", "/grains3d") => {
            Response::ok("text/html; charset=utf-8", GRAINS_3D.as_bytes().to_vec())
                .with("Cache-Control", "no-store, must-revalidate")
        }
        // The one asset worth caching: a megabyte of library that only changes
        // when the binary does.
        ("GET" | "HEAD", "/p5.min.js") => {
            Response::ok("text/javascript; charset=utf-8", P5_JS.as_bytes().to_vec())
                .with("Cache-Control", "public, max-age=31536000, immutable")
        }
        ("GET" | "HEAD", "/fonts.css") => {
            Response::ok("text/css; charset=utf-8", FONTS_CSS.as_bytes().to_vec())
                .with("Cache-Control", "public, max-age=31536000, immutable")
        }
        ("GET" | "HEAD", "/app.css") => {
            Response::ok("text/css; charset=utf-8", UI_CSS.as_bytes().to_vec())
                .with("Cache-Control", "no-store, must-revalidate")
        }
        ("GET" | "HEAD", "/shapes-4d.js") => {
            Response::ok("text/javascript; charset=utf-8", SHAPES_4D_JS.as_bytes().to_vec())
                .with("Cache-Control", "no-store, must-revalidate")
        }
        ("GET" | "HEAD", "/panel-4d.js") => {
            Response::ok("text/javascript; charset=utf-8", PANEL_4D_JS.as_bytes().to_vec())
                .with("Cache-Control", "no-store, must-revalidate")
        }
        ("GET" | "HEAD", "/control-pictures.js") => {
            Response::ok("text/javascript; charset=utf-8", CONTROL_PICTURES_JS.as_bytes().to_vec())
                .with("Cache-Control", "no-store, must-revalidate")
        }
        ("GET" | "HEAD", "/rail.js") => {
            Response::ok("text/javascript; charset=utf-8", RAIL_JS.as_bytes().to_vec())
                .with("Cache-Control", "no-store, must-revalidate")
        }
        ("GET" | "HEAD", "/sound-map.js") => {
            Response::ok("text/javascript; charset=utf-8", SOUND_MAP_JS.as_bytes().to_vec())
                .with("Cache-Control", "no-store, must-revalidate")
        }
        ("GET" | "HEAD", "/sound-map.css") => {
            Response::ok("text/css; charset=utf-8", SOUND_MAP_CSS.as_bytes().to_vec())
                .with("Cache-Control", "no-store, must-revalidate")
        }
        ("GET" | "HEAD", "/library-graph.js") => {
            Response::ok("text/javascript; charset=utf-8", LIBRARY_GRAPH_JS.as_bytes().to_vec())
                .with("Cache-Control", "no-store, must-revalidate")
        }
        ("GET" | "HEAD", "/library-graph.css") => {
            Response::ok("text/css; charset=utf-8", LIBRARY_GRAPH_CSS.as_bytes().to_vec())
                .with("Cache-Control", "no-store, must-revalidate")
        }
        ("GET" | "HEAD", "/chop.js") => {
            Response::ok("text/javascript; charset=utf-8", CHOP_JS.as_bytes().to_vec())
                .with("Cache-Control", "no-store, must-revalidate")
        }
        ("GET" | "HEAD", "/chop.css") => {
            Response::ok("text/css; charset=utf-8", CHOP_CSS.as_bytes().to_vec())
                .with("Cache-Control", "no-store, must-revalidate")
        }
        ("GET" | "HEAD", "/rail.css") => {
            Response::ok("text/css; charset=utf-8", RAIL_CSS.as_bytes().to_vec())
                .with("Cache-Control", "no-store, must-revalidate")
        }
        ("GET" | "HEAD", "/wave.css") => {
            Response::ok("text/css; charset=utf-8", WAVE_CSS.as_bytes().to_vec())
                .with("Cache-Control", "no-store, must-revalidate")
        }
        ("GET" | "HEAD", "/edit.css") => {
            Response::ok("text/css; charset=utf-8", EDIT_CSS.as_bytes().to_vec())
                .with("Cache-Control", "no-store, must-revalidate")
        }
        ("GET" | "HEAD", "/grain.css") => {
            Response::ok("text/css; charset=utf-8", GRAIN_CSS.as_bytes().to_vec())
                .with("Cache-Control", "no-store, must-revalidate")
        }
        ("GET" | "HEAD", "/settings.js") => {
            Response::ok("text/javascript; charset=utf-8", SETTINGS_JS.as_bytes().to_vec())
                .with("Cache-Control", "no-store, must-revalidate")
        }
        ("GET" | "HEAD", "/section-presets.js") => {
            Response::ok("text/javascript; charset=utf-8", SECTION_PRESETS_JS.as_bytes().to_vec())
                .with("Cache-Control", "no-store, must-revalidate")
        }
        ("GET" | "HEAD", "/visual-lanes.js") => {
            Response::ok("text/javascript; charset=utf-8", VISUAL_LANES_JS.as_bytes().to_vec())
        }
        ("GET" | "HEAD", "/compose.js") => {
            Response::ok("text/javascript; charset=utf-8", COMPOSE_JS.as_bytes().to_vec())
        }
        ("GET" | "HEAD", "/prism-pad.js") => {
            Response::ok("text/javascript; charset=utf-8", PRISM_PAD_JS.as_bytes().to_vec())
        }
        ("GET" | "HEAD", "/perf-panel.js") => {
            Response::ok("text/javascript; charset=utf-8", PERF_PANEL_JS.as_bytes().to_vec())
                .with("Cache-Control", "no-store, must-revalidate")
        }
        ("GET" | "HEAD", "/sequencer" | "/sequencer/" | "/sequencer/index.html") => {
            Response::ok("text/html; charset=utf-8", SEQ_HTML.as_bytes().to_vec())
                .with("Cache-Control", "no-store, must-revalidate")
        }
        ("GET" | "HEAD", "/sequencer/app.js") => {
            Response::ok("text/javascript; charset=utf-8", SEQ_APP_JS.as_bytes().to_vec())
                .with("Cache-Control", "no-store, must-revalidate")
        }
        ("GET" | "HEAD", "/sequencer/performance.js") => {
            Response::ok("text/javascript; charset=utf-8", SEQ_PERF_JS.as_bytes().to_vec())
                .with("Cache-Control", "no-store, must-revalidate")
        }
        ("GET" | "HEAD", "/sequencer/bridge.js") => {
            Response::ok("text/javascript; charset=utf-8", SEQ_BRIDGE_JS.as_bytes().to_vec())
                .with("Cache-Control", "no-store, must-revalidate")
        }
        ("GET" | "HEAD", "/sequencer/atmos.js") => {
            Response::ok("text/javascript; charset=utf-8", SEQ_ATMOS_JS.as_bytes().to_vec())
                .with("Cache-Control", "no-store, must-revalidate")
        }
        ("GET" | "HEAD", "/sequencer/look.js") => {
            Response::ok("text/javascript; charset=utf-8", SEQ_LOOK_JS.as_bytes().to_vec())
                .with("Cache-Control", "no-store, must-revalidate")
        }
        ("GET" | "HEAD", "/sequencer/journey.js") => {
            Response::ok("text/javascript; charset=utf-8", SEQ_JOURNEY_JS.as_bytes().to_vec())
                .with("Cache-Control", "no-store, must-revalidate")
        }
        ("GET" | "HEAD", "/sequencer/accompany.js") => {
            Response::ok("text/javascript; charset=utf-8", SEQ_ACCOMPANY_JS.as_bytes().to_vec())
                .with("Cache-Control", "no-store, must-revalidate")
        }
        ("GET" | "HEAD", "/sequencer/scopes.js") => {
            Response::ok("text/javascript; charset=utf-8", SEQ_SCOPES_JS.as_bytes().to_vec())
                .with("Cache-Control", "no-store, must-revalidate")
        }
        ("GET" | "HEAD", "/sequencer/style.css") => {
            Response::ok("text/css; charset=utf-8", SEQ_CSS.as_bytes().to_vec())
                .with("Cache-Control", "no-store, must-revalidate")
        }
        ("GET" | "HEAD", "/sequencer/presets.json") => {
            Response::ok("application/json; charset=utf-8", SEQ_PRESETS.as_bytes().to_vec())
                .with("Cache-Control", "no-store, must-revalidate")
        }
        ("GET" | "HEAD", "/theme-palettes.js") => {
            Response::ok("text/javascript; charset=utf-8", THEME_PALETTES_JS.as_bytes().to_vec())
                .with("Cache-Control", "no-store, must-revalidate")
        }
        ("GET" | "HEAD", "/mp4.js") => {
            Response::ok("text/javascript; charset=utf-8", MP4_JS.as_bytes().to_vec())
                .with("Cache-Control", "no-store, must-revalidate")
        }
        ("GET" | "HEAD", "/video-export.js") => {
            Response::ok("text/javascript; charset=utf-8", VIDEO_EXPORT_JS.as_bytes().to_vec())
                .with("Cache-Control", "no-store, must-revalidate")
        }
        ("GET" | "HEAD", "/grain-shapes.js") => {
            Response::ok("text/javascript; charset=utf-8", GRAIN_SHAPES_JS.as_bytes().to_vec())
                .with("Cache-Control", "no-store, must-revalidate")
        }
        ("GET" | "HEAD", "/grain-glyphs.js") => {
            Response::ok("text/javascript; charset=utf-8", GRAIN_GLYPHS_JS.as_bytes().to_vec())
                .with("Cache-Control", "no-store, must-revalidate")
        }
        ("GET" | "HEAD", "/room-paint.js") => {
            Response::ok("text/javascript; charset=utf-8", ROOM_PAINT_JS.as_bytes().to_vec())
                .with("Cache-Control", "no-store, must-revalidate")
        }
        ("GET" | "HEAD", "/room-text.js") => {
            Response::ok("text/javascript; charset=utf-8", ROOM_TEXT_JS.as_bytes().to_vec())
                .with("Cache-Control", "no-store, must-revalidate")
        }
        // The engine. Cached hard and for ever: it is a pinned version of a
        // third-party build and it does not change between runs, unlike every
        // other file here, which is why it does not get `no-store`.
        ("GET" | "HEAD", "/vendor/babylon.js") => Response::ok(
            "text/javascript; charset=utf-8",
            BABYLON_JS.to_vec(),
        )
        .with("Cache-Control", "public, max-age=31536000, immutable"),
        ("GET" | "HEAD", "/vis-registry.js") => {
            Response::ok("text/javascript; charset=utf-8", VIS_REGISTRY_JS.as_bytes().to_vec())
                .with("Cache-Control", "no-store, must-revalidate")
        }
        ("GET" | "HEAD", "/stage.js") => {
            Response::ok("text/javascript; charset=utf-8", STAGE_JS.as_bytes().to_vec())
                .with("Cache-Control", "no-store, must-revalidate")
        }
        ("GET" | "HEAD", "/room3d.js") => {
            Response::ok("text/javascript; charset=utf-8", ROOM3D_JS.as_bytes().to_vec())
                .with("Cache-Control", "no-store, must-revalidate")
        }
        ("GET" | "HEAD", "/ridge.js") => {
            Response::ok("text/javascript; charset=utf-8", RIDGE_JS.as_bytes().to_vec())
                .with("Cache-Control", "no-store, must-revalidate")
        }
        ("GET" | "HEAD", "/ridge-data.js") => {
            Response::ok("text/javascript; charset=utf-8", RIDGE_DATA_JS.as_bytes().to_vec())
                .with("Cache-Control", "no-store, must-revalidate")
        }
        ("GET" | "HEAD", "/vis-gl.js") => {
            Response::ok("text/javascript; charset=utf-8", VIS_GL_JS.as_bytes().to_vec())
                .with("Cache-Control", "no-store, must-revalidate")
        }
        ("GET" | "HEAD", "/theme-derive.js") => {
            Response::ok("text/javascript; charset=utf-8", THEME_JS.as_bytes().to_vec())
                .with("Cache-Control", "no-store, must-revalidate")
        }
        ("GET" | "HEAD", "/app.js") => {
            Response::ok("text/javascript; charset=utf-8", UI_JS.as_bytes().to_vec())
                .with("Cache-Control", "no-store, must-revalidate")
        }

        ("GET", "/api/state") => api_state(app),
        ("GET", "/api/browse") => api_browse(req),
        ("POST", "/api/library") => api_set_library(app, req),
        ("GET", "/api/folders") => api_folders(app),
        ("GET", "/api/order") => api_order_get(app),
        ("POST", "/api/order") => api_order_set(app, req),
        ("GET", "/api/files") => api_files(app, req),
        ("GET", "/api/peaks") => api_peaks(app, req),
        ("POST", "/api/thumbs") => api_thumbs(app, req),
        ("GET", "/api/spectrogram") => api_spectrogram(app, req),
        ("GET", "/api/stats") => api_stats(app, req),
        ("GET", "/api/markers") => api_markers_get(app, req),
        ("POST", "/api/markers") => api_markers_set(app, req),
        ("GET", "/api/visual-automation") => api_visual_lanes_get(app, req),
        ("POST", "/api/visual-automation") => api_visual_lanes_set(app, req),
        ("GET", "/api/compositions") => api_compositions_list(app),
        ("GET", "/api/compositions/get") => api_composition_get(app, req),
        ("POST", "/api/compositions") => api_composition_save(app, req),
        ("POST", "/api/compositions/delete") => api_composition_delete(app, req),
        ("POST", "/api/export/film") => api_export_film(app, req),
        ("POST", "/api/annot") => api_annot(app, req),
        ("GET", "/api/fx") => api_fx_catalogue(),
        ("GET", "/api/scales") => api_scales(),
        ("GET", "/api/rack") => api_rack_get(app, req),
        ("POST", "/api/rack") => api_rack_set(app, req),
        ("POST", "/api/rack/param") => api_rack_param(app, req),
        ("POST", "/api/pitchtime") => api_pitch_time(app, req),
        ("GET", "/api/pad/presets") => api_pad_presets(app, req),
        ("POST", "/api/pad/presets") => api_pad_preset_save(app, req),
        ("POST", "/api/pad/presets/rename") => api_pad_preset_rename(app, req),
        ("POST", "/api/pad/presets/delete") => api_pad_preset_delete(app, req),
        ("GET", "/api/automation") => api_automation_get(app, req),
        ("POST", "/api/automation") => api_automation_set(app, req),
        ("GET" | "POST", "/api/automation/record") => api_automation_record(app, req),
        ("GET", "/api/automation/path") => api_automation_path(app, req),
        ("POST", "/api/automation/loop") => api_automation_loop(app, req),
        ("GET", "/api/pad") => api_pad(app, req),
        ("GET" | "POST", "/api/audio/buffer") => api_audio_buffer(app, req),
        ("GET" | "POST", "/api/grains/cap") => api_grain_cap(app, req),
        // How the app is used, on this machine only. See `analytics.rs`.
        ("POST", "/api/analytics") => api_analytics_append(app, req),
        ("GET", "/api/analytics") => api_analytics_read(app, req),
        ("POST", "/api/analytics/catalogue") => api_analytics_catalogue(app, req),
        ("POST", "/api/analytics/clear") => api_analytics_clear(app),
        ("GET", "/api/analytics/perf") => api_analytics_perf(app, req),
        // A performance row now, outside the sampler's schedule.
        ("POST", "/api/analytics/perf/sample") => {
            crate::perf::sample_now(app);
            Response::json(Value::obj().set("ok", true).to_string())
        }
        ("GET", "/api/analytics/storage") => Response::json(crate::retention::storage(&app.data_dir).to_string()),
        ("POST", "/api/analytics/retention") => api_analytics_retention(app, req),
        ("POST", "/api/analytics/purge") => Response::json(crate::retention::purge(&app.data_dir, now_epoch_ms()).to_string()),
        ("GET", "/api/presets") => api_presets_list(app),
        ("POST", "/api/presets") => api_preset_save(app, req),
        ("POST", "/api/presets/apply") => api_preset_apply(app, req),
        ("POST", "/api/presets/update") => api_preset_update(app, req),
        ("POST", "/api/presets/duplicate") => api_preset_duplicate(app, req),
        ("POST", "/api/presets/delete") => api_preset_delete(app, req),
        ("GET", "/api/grains") => api_grains(app, req),
        ("GET", "/api/edit") => api_edit_get(app, req),
        ("POST", "/api/edit") => api_edit_apply(app, req),
        ("POST", "/api/measure") => api_measure(app, req),
        ("POST", "/api/export") => api_export(app, req),
        ("GET", "/api/export") => api_export_status(app),
        ("POST", "/api/export/stem") => api_export_stem(app, req),
        ("POST", "/api/export/stop") => api_export_stop(app),
        // The picture for a video export. See `docs/VIDEO-EXPORT.md`.
        ("POST", "/api/video") => api_video(app, req),
        ("GET", "/api/video") => api_video_status(app),
        ("GET", "/api/video/frames") => api_video_frames(req),
        ("GET", "/api/video/audio") => api_video_audio(),
        ("POST", "/api/video/stop") => api_video_stop(),
        ("GET", "/api/similar") => api_similar(app, req),
        ("GET", "/api/labels") => api_labels(app, req),
        ("GET", "/api/space") => api_space(app),
        ("GET", "/api/map") => api_map(app),
        ("GET", "/api/soundmap") => api_soundmap(app),
        ("GET", "/api/soundmap/near") => api_soundmap_near(app, req),
        ("GET", "/api/sounds") => api_sounds(app),
        ("POST", "/api/usertags") => api_user_tags_set(app, req),
        ("GET", "/api/usertag") => api_user_tag_members(app, req),
        ("POST", "/api/engine/load") => api_engine_load(app, req),
        ("GET", "/api/engine/state") => api_engine_state(app),
        ("POST", "/api/engine/transport") => api_engine_transport(app, req),
        ("POST", "/api/engine/seq") => api_engine_seq(app, req),
        ("GET", "/api/engine/grains") => api_engine_grains(app),
        ("GET", "/api/engine/master") => api_engine_master(app, req),
        // Forget the worst block. It is only meaningful next to a change you
        // just made — a peak from ten minutes ago says nothing about the
        // settings in front of you.
        ("POST", "/api/engine/shed") => api_engine_shed(app, req),
        // HyperStretch: Hyperprism's smoothing, and the pad's two controls
        // straight to the engine. See `docs/HYPERSTRETCH.md`.
        ("POST", "/api/engine/glide") => api_engine_glide(app, req),
        // The Grain page's keys (`grain_notes.rs`).
        ("POST", "/api/engine/note") => crate::grain_notes::post_note(app, req),
        ("POST", "/api/engine/voice") => crate::grain_notes::post_voice(app, req),
        ("GET", "/api/engine/midi") => crate::grain_notes::get_midi(app),
        ("POST", "/api/engine/midi") => crate::grain_notes::post_midi(app, req),
        ("GET", "/api/engine/lfos") => crate::grain_lfos::get(app),
        ("POST", "/api/engine/lfos") => crate::grain_lfos::post(app, req),
        ("POST", "/api/engine/pad") => api_engine_pad(app, req),
        ("POST", "/api/prism/load") => api_prism_load(app, req),
        ("GET", "/api/prism/state") => api_prism_state(app),
        ("POST", "/api/prism/stretch") => api_prism_stretch(app, req),
        ("POST", "/api/engine/load/reset") => {
            match crate::live::with(app, |h| h.shared.reset_load()) {
                Ok(()) => Response::json(Value::obj().set("ok", true).to_string()),
                Err(e) => Response::error(503, &e),
            }
        }
        ("POST", "/api/capture") => api_capture(app, req),
        ("POST", "/api/chop/save") => api_chop_save(app, req),
        ("GET", "/api/record") => api_record_state(app),
        ("POST", "/api/record") => api_record(app, req),
        ("GET" | "HEAD", "/audio") => api_audio(app, req),
        ("GET", "/api/scan") => api_scan_status(app),
        ("POST", "/api/scan") => api_scan_start(app),
        ("POST", "/api/scan/stop") => {
            app.scan.cancel.store(true, Ordering::Relaxed);
            Response::json(Value::obj().set("ok", true).to_string())
        }
        ("POST", "/api/save") => api_save(app, req),

        // The Wave page's synth, every route in one place (`wave_synth.rs`).
        (_, p) if p.starts_with("/api/wave/") => crate::wave_synth::route(app, req),

        ("OPTIONS", _) => Response::text(200, ""),
        _ => Response::error(404, "no such endpoint"),
    }
}

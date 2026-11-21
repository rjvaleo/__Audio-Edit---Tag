//! Everything the server embeds, and the build id made from it.
//!
//! **With the `ui-from-disk` feature nothing under `ui/` is embedded**: every
//! constant below that comes from `ui/` is empty, and `ui_from_disk` serves the
//! files from this source tree's `ui/` folder (or `AUDIOLAB_UI_DIR`) instead. The
//! test runs build that way, so an interface change rebuilds no Rust; the live
//! build embeds everything, as before. The visualiser's files, outside `ui/`,
//! are always embedded.

use server_core::http;

/// A text file under `ui/`: embedded, or empty with `ui-from-disk`.
#[cfg(not(feature = "ui-from-disk"))]
macro_rules! ui_text { ($p:expr) => { include_str!($p) }; }
#[cfg(feature = "ui-from-disk")]
macro_rules! ui_text { ($p:expr) => { "" }; }
/// A binary file under `ui/`: embedded, or empty with `ui-from-disk`.
#[cfg(not(feature = "ui-from-disk"))]
macro_rules! ui_bytes { ($p:expr) => { include_bytes!($p) }; }
#[cfg(feature = "ui-from-disk")]
macro_rules! ui_bytes { ($p:expr) => { b"" }; }

/// The 3D grain visualiser.
///
/// Served from here rather than opened as a file so it is same-origin with the
/// API and can therefore watch the engine. Opened directly off disk it still
/// works — it falls back to its own schedule and simply has no player to follow.
pub const GRAINS_3D: &str = include_str!("../../../../visualiser/grain-views.html");
/// p5.js, vendored rather than fetched.
///
/// It was the one thing the app went to the internet for, which made the grain
/// views the only page that did not work offline — against a front page that
/// promises nothing else needs installing. A megabyte on the binary is a fair
/// price for the claim being true.
pub const P5_JS: &str = include_str!("../../../../visualiser/p5.min.js");
/// Poppins and Lora, latin subsets, inlined as data URIs. Same reason as p5:
/// the page was reaching for Google Fonts, which is a network round trip and,
/// on a machine with no network, a different typeface than the one it was
/// designed in.
pub const FONTS_CSS: &str = include_str!("../../../../visualiser/fonts.css");

/// What build of the interface this binary carries.
///
/// **A number the page can read, because "restart the server" does not reload a
/// window that is already open.** A native window fetches `app.js` once and
/// keeps it; rebuilding and restarting changes what the *next* load would get
/// and nothing at all about the one on screen. A whole day went on that — the
/// server serving the corrected file the entire time, the window running the
/// old one, and every report from either side true about a different copy of
/// the program.
///
/// So it is derived from the bytes of the interface itself rather than from a
/// clock: it changes when, and only when, the UI changes. The page records the
/// value it loaded with and compares it against the live one, and a window that
/// has fallen behind can say so instead of being argued with.
pub fn ui_build_id() -> u64 {
    let mut h: u64 = 0xcbf29ce484222325;
    for part in [UI_HTML, UI_CSS, UI_JS, RAIL_JS, RAIL_CSS, WAVE_CSS, GRAIN_CSS, EDIT_CSS, SOUND_MAP_JS, SOUND_MAP_CSS, CHOP_JS, CHOP_CSS,
                 SETTINGS_JS, SECTION_PRESETS_JS,
                 SEQ_HTML, SEQ_APP_JS, SEQ_PERF_JS, SEQ_CSS, SEQ_PRESETS, SEQ_BRIDGE_JS, SEQ_ATMOS_JS, SEQ_KEYS_JS, SEQ_LOOK_JS, SEQ_JOURNEY_JS, SEQ_SCOPES_JS, SEQ_ACCOMPANY_JS, SEQ_DRUMS_JS, SEQ_BAND_JS, SEQ_DRAW_JS, SEQ_CLONE_JS, SEQ_ATFX_JS, SEQ_ATFX_WORKLET_JS, SEQ_ATPHYS_JS, SEQ_ATMOS_WORKLET_JS,
                 PERF_PANEL_JS, PRISM_PAD_JS, COMPOSE_JS, VISUAL_LANES_JS,
                 SHAPES_4D_JS, PANEL_4D_JS, CONTROL_PICTURES_JS,
                 STAGE_JS, VIS_REGISTRY_JS, ROOM_TEXT_JS,
                 VIS_GL_JS, RIDGE_JS, ROOM3D_JS, ROOM_PAINT_JS, VIDEO_EXPORT_JS] {
        for b in part.as_bytes() {
            h ^= *b as u64;
            h = h.wrapping_mul(0x100000001b3);
        }
    }
    h
}

/// **Every interface file is served `no-store`, not just `app.js`.**
///
/// Only `app.js` was, so a rebuilt `index.html`, `app.css` or any of the other
/// scripts sat in the browser's cache and a plain reload kept serving the old
/// one. What that looks like is a control you have just added being absent from
/// the window with no error anywhere — which cost real time here, twice, and
/// once to the owner rather than to me. The interface is embedded in the binary
/// and changes with it; there is nothing here worth caching.
pub const UI_HTML: &str = ui_text!("../../../../ui/index.html");
pub const UI_CSS: &str = ui_text!(concat!(env!("OUT_DIR"), "/app.css"));
/// `ui/app/*.js`, joined in name order by `build.rs`.
pub const UI_JS: &str = ui_text!(concat!(env!("OUT_DIR"), "/app.js"));
/// The palette-to-theme engine and the palettes it works on.
///
/// Separate files rather than more of `app.js` because the engine is a port and
/// is worth keeping recognisable as one — its arithmetic came from elsewhere and
/// should stay diffable against where it came from.
pub const THEME_JS: &str = ui_text!("../../../../ui/theme-derive.js");
/// The unified visualiser's renderer. See `docs/VISUALISER.md`.
pub const VIS_GL_JS: &str = ui_text!(concat!(env!("OUT_DIR"), "/vis-gl.js"));
/// The solids the grain cloud draws its grains as. See `docs/GRAIN-SHAPES.md`.
pub const GRAIN_SHAPES_JS: &str = ui_text!("../../../../ui/grain-shapes.js");
/// The grain controls' glyphs (`ui/grain-glyphs.js`).
pub const GRAIN_GLYPHS_JS: &str = ui_text!("../../../../ui/grain-glyphs.js");
/// The room's palette: what each drawn thing is coloured with, and what that
/// colour is read against. See `docs/ROOM-PAINT.md`.
pub const ROOM_PAINT_JS: &str = ui_text!(concat!(env!("OUT_DIR"), "/room-paint.js"));
/// The ridgeline visualiser and the CP 1919 pulses it is measured against.
/// See `docs/RIDGELINE.md`.
pub const RIDGE_JS: &str = ui_text!("../../../../ui/ridge.js");
pub const RIDGE_DATA_JS: &str = ui_text!("../../../../ui/ridge-data.js");
/// **Babylon, vendored whole.** Everything this program serves is embedded, so
/// the engine is too — eight megabytes of it. `include_bytes` rather than
/// `include_str` because nothing here needs it as text and validating eight
/// megabytes as UTF-8 at compile time buys nothing.
pub const BABYLON_JS: &[u8] = ui_bytes!("../../../../ui/vendor/babylon.js");
/// 3d-force-graph 1.73.4 (MIT, Vasco Asturiano), three.js inside: the sound
/// map's 3D views. See `docs/THIRD-PARTY.md`.
pub const FORCE_GRAPH_JS: &[u8] = ui_bytes!("../../../../ui/vendor/3d-force-graph.min.js");
pub const ROOM3D_JS: &str = ui_text!("../../../../ui/room3d.js");
pub const STAGE_JS: &str = ui_text!(concat!(env!("OUT_DIR"), "/stage.js"));
pub const VIS_REGISTRY_JS: &str = ui_text!("../../../../ui/vis-registry.js");
pub const ROOM_TEXT_JS: &str = ui_text!("../../../../ui/room-text.js");
/// The MP4 muxer and the thing that drives it. See `docs/VIDEO-EXPORT.md`.
pub const MP4_JS: &str = ui_text!("../../../../ui/mp4.js");
pub const VIDEO_EXPORT_JS: &str = ui_text!("../../../../ui/video-export.js");
pub const THEME_PALETTES_JS: &str = ui_text!("../../../../ui/theme-palettes.js");
/// Every preference the interface keeps, and the table that says what each one
/// is. Served before anything that reads a preference; see `ui/settings.js`.
pub const SETTINGS_JS: &str = ui_text!("../../../../ui/settings.js");
/// Presets for one section at a time — a look, or a cloud — kept apart from the
/// document's preset. Pure, like the store above; see `docs/SECTION-PRESETS.md`.
pub const SECTION_PRESETS_JS: &str = ui_text!("../../../../ui/section-presets.js");
/// The scale sequencer, vendored whole from `rjvaleo/scale-sequencer` at commit
/// `e0b8189` and served under `/sequencer/`, plus the one file that is ours:
/// the bridge that ties its transport to the engine's and hands its sound to
/// the room. See `docs/SEQUENCER.md`.
pub const SEQ_HTML: &str = ui_text!("../../../../ui/sequencer/index.html");
pub const SEQ_APP_JS: &str = ui_text!("../../../../ui/sequencer/app.js");
pub const SEQ_PERF_JS: &str = ui_text!("../../../../ui/sequencer/performance.js");
pub const SEQ_CSS: &str = ui_text!("../../../../ui/sequencer/style.css");
pub const SEQ_PRESETS: &str = ui_text!("../../../../ui/sequencer/presets.json");
pub const SEQ_BRIDGE_JS: &str = ui_text!("../../../../ui/sequencer/bridge.js");
/// Ours too: the sequencer's second synth, Atmosphere (13 Nov 2026).
pub const SEQ_ATMOS_JS: &str = ui_text!("../../../../ui/sequencer/atmos.js");
/// Ours: the synths' keys and their MIDI channels (14 Nov 2026).
pub const SEQ_KEYS_JS: &str = ui_text!("../../../../ui/sequencer/keys.js");
/// Ours: the sequencer in the app's look, its knobs' pictures and the theme (14 Nov 2026).
pub const SEQ_LOOK_JS: &str = ui_text!("../../../../ui/sequencer/look.js");
/// Ours: the Journey, the pattern's trip (14 Nov 2026).
pub const SEQ_JOURNEY_JS: &str = ui_text!("../../../../ui/sequencer/journey.js");
/// Ours: the oscillators' and the output's scopes (14 Nov 2026).
pub const SEQ_SCOPES_JS: &str = ui_text!("../../../../ui/sequencer/scopes.js");
/// Ours: Accompany, the bass, chords, arp and drone from the scale's own degrees (14 Nov 2026).
pub const SEQ_ACCOMPANY_JS: &str = ui_text!("../../../../ui/sequencer/accompany.js");
/// Ours: the Band's drums, the 808 synth, the kits and the grid (14 Nov 2026).
pub const SEQ_DRUMS_JS: &str = ui_text!("../../../../ui/sequencer/drums.js");
/// Ours: the Band, its instruments, mixer and styles (14 Nov 2026).
pub const SEQ_BAND_JS: &str = ui_text!("../../../../ui/sequencer/band.js");
/// Ours: Draw, the drawing sequencer — a canvas whose marks play (14 Nov 2026).
pub const SEQ_DRAW_JS: &str = ui_text!("../../../../ui/sequencer/draw.js");
/// Ours: the Band's MIDI file player — plays a .mid note for note through the Band (18 Nov 2026).
pub const SEQ_MIDIFILE_JS: &str = ui_text!("../../../../ui/sequencer/midifile.js");
/// Ours: Clone a song, the host's Clone page, which writes the Band (14 Nov 2026).
pub const SEQ_CLONE_JS: &str = ui_text!("../../../../ui/sequencer/clone.js");
/// Atmosphere's own effects: the page's side, the audio thread's, and the effect
/// rack built for the browser (`tools/build-fx-wasm.sh`).
pub const SEQ_ATFX_JS: &str = ui_text!("../../../../ui/sequencer/atfx.js");
pub const SEQ_ATFX_WORKLET_JS: &str = ui_text!("../../../../ui/sequencer/atfx-worklet.js");
pub const SEQ_ATFX_WASM: &[u8] = ui_bytes!("../../../../ui/sequencer/atfx.wasm");
/// Atmosphere's physically modelled voice: the page's side, the audio thread's,
/// and the engine built for the browser (`tools/build-fx-wasm.sh`).
pub const SEQ_ATPHYS_JS: &str = ui_text!("../../../../ui/sequencer/atphys.js");
pub const SEQ_ATMOS_WORKLET_JS: &str = ui_text!("../../../../ui/sequencer/atmos-worklet.js");
pub const SEQ_ATMOS_WASM: &[u8] = ui_bytes!("../../../../ui/sequencer/atmos.wasm");
/// The sequencer's performance panel, carried over to the grain page's
/// Automation tab. See `docs/AUTOMATION-CAPTURE.md`.
pub const PERF_PANEL_JS: &str = ui_text!("../../../../ui/perf-panel.js");
pub const PRISM_PAD_JS: &str = ui_text!("../../../../ui/prism-pad.js");
/// The Compose workspace and its compact panels. See `docs/COMPOSE.md`.
pub const COMPOSE_JS: &str = ui_text!("../../../../ui/compose.js");
/// The picture's automation lanes. See `docs/COMPOSE.md`, phase three.
pub const VISUAL_LANES_JS: &str = ui_text!("../../../../ui/visual-lanes.js");
/// The left rail, and its own stylesheet. Ported from the edge build; it emits
/// its own markup and depends on no rule in `app.css`. See `docs/RAIL.md`.
pub const RAIL_JS: &str = ui_text!("../../../../ui/rail.js");
pub const RAIL_CSS: &str = ui_text!("../../../../ui/rail.css");
/// The Wave page's stylesheet. See `docs/WAVE-SYNTH.md`.
pub const WAVE_CSS: &str = ui_text!("../../../../ui/wave.css");
/// The Grain page's own stylesheet (`ui/grain.css`), behind `prefs.grainUi`.
pub const GRAIN_CSS: &str = ui_text!("../../../../ui/grain.css");
/// The Now Playing bar and the Edit page (`ui/edit.css`). See `docs/EDIT-PAGE.md`.
pub const EDIT_CSS: &str = ui_text!("../../../../ui/edit.css");
/// The 3D sound map. See `docs/SOUND-MAP.md`.
pub const SOUND_MAP_JS: &str = ui_text!("../../../../ui/sound-map.js");
pub const SOUND_MAP_CSS: &str = ui_text!("../../../../ui/sound-map.css");
pub const LIBRARY_GRAPH_JS: &str = ui_text!("../../../../ui/library-graph.js");
pub const LIBRARY_GRAPH_CSS: &str = ui_text!("../../../../ui/library-graph.css");
pub const CHOP_JS: &str = ui_text!("../../../../ui/chop.js");
pub const CHOP_CSS: &str = ui_text!("../../../../ui/chop.css");
/// The regular 4-polytopes and the projection that brings them into three
/// dimensions. Pure geometry — see `docs/SHAPES-4D.md`.
pub const SHAPES_4D_JS: &str = ui_text!("../../../../ui/shapes-4d.js");
/// The modelling-package panel that drives them: object manager, attribute
/// manager, and six planes of rotation.
pub const PANEL_4D_JS: &str = ui_text!("../../../../ui/panel-4d.js");
/// The Visual column's controls drawn as what they do: a picture over every
/// knob, where each colour lands, the palette each generator makes.
pub const CONTROL_PICTURES_JS: &str = ui_text!("../../../../ui/control-pictures.js");

/// **The interface from disk, for working on it.** With `AUDIOLAB_UI_DIR` set
/// to a `ui/` folder, every interface file is read from that folder on every
/// request, so an edit is one reload away instead of a rebuild and a restart.
/// The folders `build.rs` joins (`ui/app/*.js` into `app.js`, …) are joined
/// here the same way, in name order. A path with no file in the folder (the
/// visualiser's files, the vendored libraries, the `.wasm` builds when absent)
/// falls through to the copy compiled in. Unset, nothing changes: the live app
/// serves what it was built with. `uiBuild` stays the compiled one's.
pub fn ui_from_disk(method: &str, path: &str) -> Option<crate::http::Response> {
    use std::sync::OnceLock;
    static DIR: OnceLock<Option<std::path::PathBuf>> = OnceLock::new();
    let dir = DIR.get_or_init(|| {
        std::env::var_os("AUDIOLAB_UI_DIR").filter(|v| !v.is_empty()).map(std::path::PathBuf::from)
            // Built with nothing embedded, the interface is this source tree's.
            .or_else(|| cfg!(feature = "ui-from-disk").then(|| std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../ui")))
    }).as_ref()?;
    ui_file(dir, method, path)
}

/// One interface file from `dir`, as `ui_from_disk` serves it.
fn ui_file(dir: &std::path::Path, method: &str, path: &str) -> Option<crate::http::Response> {
    if !(method == "GET" || method == "HEAD") || path.starts_with("/api/") {
        return None;
    }
    let rel = match path {
        "/" | "/index.html" => "index.html",
        "/sequencer" | "/sequencer/" => "sequencer/index.html",
        p => p.strip_prefix('/')?,
    };
    if rel.split('/').any(|c| c.is_empty() || c == "." || c == "..") {
        return None;
    }
    let ext = rel.rsplit('.').next().unwrap_or("");
    let kind = match ext {
        "js" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "html" => "text/html; charset=utf-8",
        "json" => "application/json",
        "wasm" => "application/wasm",
        _ => return None,
    };
    // As `build.rs` JOINED: the folder, the parts' extension, the file served.
    const JOINED: &[(&str, &str, &str)] = &[
        ("app", "js", "app.js"),
        ("app-css", "css", "app.css"),
        ("room-paint", "js", "room-paint.js"),
        ("vis-gl", "js", "vis-gl.js"),
        ("stage", "js", "stage.js"),
    ];
    let body = if let Some((folder, part_ext, _)) = JOINED.iter().find(|(_, _, out)| *out == rel) {
        let mut names: Vec<_> = std::fs::read_dir(dir.join(folder)).ok()?
            .filter_map(|e| e.ok())
            .map(|e| e.path())
            .filter(|p| p.extension().is_some_and(|x| x == *part_ext))
            .collect();
        names.sort();
        let mut joined = Vec::new();
        for p in &names {
            joined.extend(std::fs::read(p).ok()?);
        }
        joined
    } else {
        std::fs::read(dir.join(rel)).ok()?
    };
    Some(crate::http::Response::ok(kind, body).with("Cache-Control", "no-store, must-revalidate"))
}

#[cfg(all(test, not(feature = "ui-from-disk")))]
mod from_disk {
    use super::ui_file;

    fn dir() -> std::path::PathBuf {
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../ui")
    }

    #[test]
    fn a_joined_file_is_the_same_bytes_the_build_joined() {
        let r = ui_file(&dir(), "GET", "/app.js").expect("app.js from disk");
        assert_eq!(r.body, super::UI_JS.as_bytes());
        let r = ui_file(&dir(), "GET", "/app.css").expect("app.css from disk");
        assert_eq!(r.body, super::UI_CSS.as_bytes());
    }

    #[test]
    fn a_plain_file_and_the_pages_come_from_the_folder() {
        assert_eq!(ui_file(&dir(), "GET", "/rail.js").unwrap().body, super::RAIL_JS.as_bytes());
        assert_eq!(ui_file(&dir(), "GET", "/").unwrap().body, super::UI_HTML.as_bytes());
        assert_eq!(ui_file(&dir(), "GET", "/sequencer/").unwrap().body, super::SEQ_HTML.as_bytes());
        assert_eq!(ui_file(&dir(), "GET", "/sequencer/keys.js").unwrap().body, super::SEQ_KEYS_JS.as_bytes());
    }

    #[test]
    fn the_api_climbing_out_and_missing_files_fall_through() {
        assert!(ui_file(&dir(), "GET", "/api/state").is_none());
        assert!(ui_file(&dir(), "POST", "/app.js").is_none());
        assert!(ui_file(&dir(), "GET", "/../core/Cargo.toml").is_none());
        assert!(ui_file(&dir(), "GET", "/sequencer/../../README.md").is_none());
        assert!(ui_file(&dir(), "GET", "/no-such-file.js").is_none());
        assert!(ui_file(&dir(), "GET", "/p5.min.js").is_none());
    }
}

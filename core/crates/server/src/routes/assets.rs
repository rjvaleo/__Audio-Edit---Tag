//! Everything the server embeds, and the build id made from it.

/// The 3D grain visualiser.
///
/// Served from here rather than opened as a file so it is same-origin with the
/// API and can therefore watch the engine. Opened directly off disk it still
/// works — it falls back to its own schedule and simply has no player to follow.
pub const GRAINS_3D: &str = include_str!("../../../../../visualiser/grain-views.html");
/// p5.js, vendored rather than fetched.
///
/// It was the one thing the app went to the internet for, which made the grain
/// views the only page that did not work offline — against a front page that
/// promises nothing else needs installing. A megabyte on the binary is a fair
/// price for the claim being true.
pub const P5_JS: &str = include_str!("../../../../../visualiser/p5.min.js");
/// Poppins and Lora, latin subsets, inlined as data URIs. Same reason as p5:
/// the page was reaching for Google Fonts, which is a network round trip and,
/// on a machine with no network, a different typeface than the one it was
/// designed in.
pub const FONTS_CSS: &str = include_str!("../../../../../visualiser/fonts.css");

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
                 SEQ_HTML, SEQ_APP_JS, SEQ_PERF_JS, SEQ_CSS, SEQ_PRESETS, SEQ_BRIDGE_JS,
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
pub const UI_HTML: &str = include_str!("../../../../../ui/index.html");
pub const UI_CSS: &str = include_str!(concat!(env!("OUT_DIR"), "/app.css"));
/// `ui/app/*.js`, joined in name order by `build.rs`.
pub const UI_JS: &str = include_str!(concat!(env!("OUT_DIR"), "/app.js"));
/// The palette-to-theme engine and the palettes it works on.
///
/// Separate files rather than more of `app.js` because the engine is a port and
/// is worth keeping recognisable as one — its arithmetic came from elsewhere and
/// should stay diffable against where it came from.
pub const THEME_JS: &str = include_str!("../../../../../ui/theme-derive.js");
/// The unified visualiser's renderer. See `docs/VISUALISER.md`.
pub const VIS_GL_JS: &str = include_str!(concat!(env!("OUT_DIR"), "/vis-gl.js"));
/// The solids the grain cloud draws its grains as. See `docs/GRAIN-SHAPES.md`.
pub const GRAIN_SHAPES_JS: &str = include_str!("../../../../../ui/grain-shapes.js");
/// The grain controls' glyphs (`ui/grain-glyphs.js`).
pub const GRAIN_GLYPHS_JS: &str = include_str!("../../../../../ui/grain-glyphs.js");
/// The room's palette: what each drawn thing is coloured with, and what that
/// colour is read against. See `docs/ROOM-PAINT.md`.
pub const ROOM_PAINT_JS: &str = include_str!(concat!(env!("OUT_DIR"), "/room-paint.js"));
/// The ridgeline visualiser and the CP 1919 pulses it is measured against.
/// See `docs/RIDGELINE.md`.
pub const RIDGE_JS: &str = include_str!("../../../../../ui/ridge.js");
pub const RIDGE_DATA_JS: &str = include_str!("../../../../../ui/ridge-data.js");
/// **Babylon, vendored whole.** Everything this program serves is embedded, so
/// the engine is too — eight megabytes of it. `include_bytes` rather than
/// `include_str` because nothing here needs it as text and validating eight
/// megabytes as UTF-8 at compile time buys nothing.
pub const BABYLON_JS: &[u8] = include_bytes!("../../../../../ui/vendor/babylon.js");
pub const ROOM3D_JS: &str = include_str!("../../../../../ui/room3d.js");
pub const STAGE_JS: &str = include_str!(concat!(env!("OUT_DIR"), "/stage.js"));
pub const VIS_REGISTRY_JS: &str = include_str!("../../../../../ui/vis-registry.js");
pub const ROOM_TEXT_JS: &str = include_str!("../../../../../ui/room-text.js");
/// The MP4 muxer and the thing that drives it. See `docs/VIDEO-EXPORT.md`.
pub const MP4_JS: &str = include_str!("../../../../../ui/mp4.js");
pub const VIDEO_EXPORT_JS: &str = include_str!("../../../../../ui/video-export.js");
pub const THEME_PALETTES_JS: &str = include_str!("../../../../../ui/theme-palettes.js");
/// Every preference the interface keeps, and the table that says what each one
/// is. Served before anything that reads a preference; see `ui/settings.js`.
pub const SETTINGS_JS: &str = include_str!("../../../../../ui/settings.js");
/// Presets for one section at a time — a look, or a cloud — kept apart from the
/// document's preset. Pure, like the store above; see `docs/SECTION-PRESETS.md`.
pub const SECTION_PRESETS_JS: &str = include_str!("../../../../../ui/section-presets.js");
/// The scale sequencer, vendored whole from `rjvaleo/scale-sequencer` at commit
/// `e0b8189` and served under `/sequencer/`, plus the one file that is ours:
/// the bridge that ties its transport to the engine's and hands its sound to
/// the room. See `docs/SEQUENCER.md`.
pub const SEQ_HTML: &str = include_str!("../../../../../ui/sequencer/index.html");
pub const SEQ_APP_JS: &str = include_str!("../../../../../ui/sequencer/app.js");
pub const SEQ_PERF_JS: &str = include_str!("../../../../../ui/sequencer/performance.js");
pub const SEQ_CSS: &str = include_str!("../../../../../ui/sequencer/style.css");
pub const SEQ_PRESETS: &str = include_str!("../../../../../ui/sequencer/presets.json");
pub const SEQ_BRIDGE_JS: &str = include_str!("../../../../../ui/sequencer/bridge.js");
/// The sequencer's performance panel, carried over to the grain page's
/// Automation tab. See `docs/AUTOMATION-CAPTURE.md`.
pub const PERF_PANEL_JS: &str = include_str!("../../../../../ui/perf-panel.js");
pub const PRISM_PAD_JS: &str = include_str!("../../../../../ui/prism-pad.js");
/// The Compose workspace and its compact panels. See `docs/COMPOSE.md`.
pub const COMPOSE_JS: &str = include_str!("../../../../../ui/compose.js");
/// The picture's automation lanes. See `docs/COMPOSE.md`, phase three.
pub const VISUAL_LANES_JS: &str = include_str!("../../../../../ui/visual-lanes.js");
/// The left rail, and its own stylesheet. Ported from the edge build; it emits
/// its own markup and depends on no rule in `app.css`. See `docs/RAIL.md`.
pub const RAIL_JS: &str = include_str!("../../../../../ui/rail.js");
pub const RAIL_CSS: &str = include_str!("../../../../../ui/rail.css");
/// The Wave page's stylesheet. See `docs/WAVE-SYNTH.md`.
pub const WAVE_CSS: &str = include_str!("../../../../../ui/wave.css");
/// The Grain page's own stylesheet (`ui/grain.css`), behind `prefs.grainUi`.
pub const GRAIN_CSS: &str = include_str!("../../../../../ui/grain.css");
/// The Now Playing bar and the Edit page (`ui/edit.css`). See `docs/EDIT-PAGE.md`.
pub const EDIT_CSS: &str = include_str!("../../../../../ui/edit.css");
/// The 3D sound map. See `docs/SOUND-MAP.md`.
pub const SOUND_MAP_JS: &str = include_str!("../../../../../ui/sound-map.js");
pub const SOUND_MAP_CSS: &str = include_str!("../../../../../ui/sound-map.css");
pub const LIBRARY_GRAPH_JS: &str = include_str!("../../../../../ui/library-graph.js");
pub const LIBRARY_GRAPH_CSS: &str = include_str!("../../../../../ui/library-graph.css");
pub const CHOP_JS: &str = include_str!("../../../../../ui/chop.js");
pub const CHOP_CSS: &str = include_str!("../../../../../ui/chop.css");
/// The regular 4-polytopes and the projection that brings them into three
/// dimensions. Pure geometry — see `docs/SHAPES-4D.md`.
pub const SHAPES_4D_JS: &str = include_str!("../../../../../ui/shapes-4d.js");
/// The modelling-package panel that drives them: object manager, attribute
/// manager, and six planes of rotation.
pub const PANEL_4D_JS: &str = include_str!("../../../../../ui/panel-4d.js");
/// The Visual column's controls drawn as what they do: a picture over every
/// knob, where each colour lands, the palette each generator makes.
pub const CONTROL_PICTURES_JS: &str = include_str!("../../../../../ui/control-pictures.js");

// The Reverb window's drawings: MGL's ui/app/077-fx-reverb-window.js, its
// pure drawing and geometry, line for line (the names are the page's).
//
// Everything draws through the app's canvas port (`c2d::Context`) as the page
// draws through CanvasRenderingContext2D; colours are the page's CSS strings.
// `native/tools/face-capture/rv-test.cpp` runs these against call logs recorded
// from the page's own functions (`rv-refs.mjs`), call for call.
//
// Plain C++17 and the standard library in this header; the .cpp includes
// Canvas2D.h (and so JUCE) unless RVD_CONTEXT_STANDIN is defined, which the
// test does to put a recording stand-in in its place.
//
// ── What the window does each frame (rvBuild / rvRender / rvFrame) ──────────
//
// The window: 1280 x 640, background --surface-2, a 2px top border in
// rgb(--rv-rgb), padding 6 (top) 8 (sides) 8 (bottom). A grid of three rows,
// gap 6: the bar (auto, ~24 tall), the views (at least 300, takes the rest),
// the band (auto). The views row: 640px | the rest | the meters, gap 6. So in
// x: the network canvas 8..648, the room canvas 654..1249 (595 wide), the two
// meters 1255..1272 (7px each, gap 3). In y the views start at about 38; their
// height is what the band leaves (read the .rv-views rect from the capture).
// Both canvases sit on --well; their captions (.rv-cap, --fs-xs mono,
// --text-dimmer) at left 8 / top 5, right 8 / top 5 and (room) left 8 / bottom 5.
//
// - The bar: "Reverb" (650 weight, --fs-l), the Family dropdown (170 x 24) and
//   the Mode dropdown (260 x 24), each choice with its network's thumbnail
//   (rvDrawThumb: 40 x 15 in the closed box, 72 x 27 in the open menu), the
//   class badge, the original's name (mono, --text-dimmer, ellipsis), the
//   power LED (14 x 14, --on when on: flips bypass) and x (closes; Escape too).
//   Dragging the bar moves the window.
// - The band: one section per role (rvRoleOf, in RV_ROLES' order, 'engine' left
//   out) with the mode's controls (knobs; RV_FADERS keys as 42px faders), flex
//   weight = count (a fader 0.8); then Place ("ours": its LED is `on`, then
//   RV_PLACE's other six, dimmed to .4 while off); then Engine (sliders), if any.
// - Each frame (rvFrame):
//   1. levels: rvLevels::step(peak in, peak out, t) gives e (the glow) and
//      `since` = t - pingAt (a 3 dB rise on the input re-fires the room).
//   2. the network canvas: rvDrawNet(w, h, rvNet(mode, v), rvFrameOptions(v,
//      glow, t, moving)), then rvOverlay(w, h, v, glow). If the mode has a pad
//      (rvPadOf): rvDrawPadMark at the pad's two values (unit 0..1, log where
//      the param is), captions "<x label> <value> →" left and "↑ <y label>
//      <value>" right; else the mode's label left, nothing right.
//   3. the room canvas: rvDrawRoom(w, h, rvRoomValues(place, v.freeze), glow,
//      since, t, cam); its readout goes in the bottom caption. Top captions:
//      "the room" and "drag the sound · drag to turn · double-click to reset".
//   4. the meters: each bar's height min(100, peak * 100)% (in, out), filled
//      rgb(--rv-rgb), from the bottom.
// - The network, where the mode has a pad: press and drag sets pad.x from the
//   x fraction across the canvas and pad.y from 1 - the y fraction (clamped,
//   log where the param is); release saves.
// - The room: press within the sound's dot (rvRoomOnSound) and drag moves the
//   sound across the floor plane at its height (rvRoomDragSound: Place's pos
//   and dist), with Shift moves it up and down (rvRoomDragHeight); press
//   anywhere else and drag turns the room (rvRoomTurn: the camera). Release
//   saves (not after a turn). Double-click resets the camera (Cam{}).
#pragma once

#include <array>
#include <map>
#include <optional>
#include <string>
#include <vector>

namespace c2d
{
class Context;
}

namespace rvd
{
/// A slot's controls by key, and Place's (placeOn, roomShape, ...). A key the
/// slot does not have is simply absent (JS's undefined).
using Values = std::map<std::string, double>;

/// The window's colours (rvReadColours, plus the two rvDrawRoom reads itself).
/// The *Rgb ones are "r,g,b" triples, as the CSS variables hold them.
struct Colours
{
    std::string accent = "47,212,194";   // --rv-rgb
    std::string ice = "207,234,255";     // --rv-ice-rgb
    std::string onRgb = "255,181,71";    // --rv-on-rgb
    std::string off = "150,160,175";     // --rv-off-rgb
    std::string well;                    // --well (a colour: give it as rgb()/hex; c2d reads no oklch)
    std::string white = "255,255,255";   // --white-rgb
    std::string text;                    // --text-dim
    std::string on = "#ffb547";          // --on
    std::string textFull;                // --text (the listener, in rvDrawRoom)
    std::string dim() const { return "rgba(" + white + ",0.16)"; }
    std::string dimmer() const { return "rgba(" + white + ",0.09)"; }
};

extern const std::vector<std::string> RV_SHAPES; // Room, Hall, Cathedral, Dome, Chamber, Plate

double rvR01 (double v, double lo, double hi);
std::vector<double> rvSeries (int n, double r, double base);
std::vector<double> rvSmLens (const Values& v, int n, double pow);

// ── a mode's network (rvNet) ────────────────────────────────────────────────
struct Column
{
    std::string t;                 // in out delay mix ap filter sum split taps ir
    int n = 0;                     // lanes
    std::vector<std::string> map;  // in/out: "L"/"R" per lane (shorter: the rest unmapped)
    std::vector<double> len;       // delay: each line's length, 0..1
    std::optional<double> w;       // its width weight, where the spec gives one
    bool comb = false, pairs = false;
    std::string kind;              // mix: butterfly rot hadamard householder perm
    int stages = 0;                // mix butterfly
    int k = 0;                     // ap: allpasses in series (0: unset, read as 1)
};
struct Feedback
{
    int from = 0, to = 0;
    std::string label;
    bool crossed = false;
};
struct Spec
{
    std::vector<Column> cols;
    std::vector<Feedback> fb;
    double dens = 0;
    std::string note;
};
Spec rvNet (const std::string& modeId, const Values& v);

std::vector<double> rvLanesY (int n, double top, double bot);

struct NetOptions
{
    double e = 0.35, t = 0;
    bool ice = false;
    double mod = 0, rate = 0.5;
    bool small = false, freezeHold = false;
};
/// Draw `spec` into a w x h context. `e` is the glow (0..1), `t` the time.
void rvDrawNet (c2d::Context&, double w, double h, const Spec&, const NetOptions&, const Colours&);
/// rvFrame's options for rvDrawNet (077 line 710).
NetOptions rvFrameOptions (const Values& v, double e, double t, bool moving);
/// rvPicUrl's picture: the mode's network at its defaults, small, 64 x 24
/// scaled by `scale` (3 for the page's 192 x 72 canvas).
void rvDrawThumb (c2d::Context&, const std::string& modeId, const Values& defaults, const Colours&, double scale = 3);
/// The mode's other controls over its network: tone curve, width arc, dry path.
void rvOverlay (c2d::Context&, double w, double h, const Values& v, double e, const Colours&);
/// rvFrame's pad marker: dashed cross-hair and dot at the pad's two values (0..1).
void rvDrawPadMark (c2d::Context&, double w, double h, double xUnit, double yUnit, const Colours&);

// ── the room ────────────────────────────────────────────────────────────────
using V2 = std::array<double, 2>;
using V3 = std::array<double, 3>;
struct Plan
{
    std::vector<V2> pts;
    double ceil = 0;
    bool plate = false;
};
Plan rvPlan (int shape);
V2 rvMirror (V2 p, V2 a, V2 b);
std::optional<V2> rvCross (V2 p, V2 q, V2 a, V2 b);
namespace RV3
{
V3 add (V3 a, V3 b);
V3 sub (V3 a, V3 b);
V3 mul (V3 a, double k);
double dot (V3 a, V3 b);
V3 rvCross (V3 a, V3 b);
V3 norm (V3 a);
} // namespace RV3
/// RV_CAM: the view's turn, which the room's drag changes.
struct Cam
{
    double yaw = -0.38, pitch = 0.5;
};
bool rvInside (const std::vector<V2>& poly, double x, double y);
/// Where everything is, in room units: x across, y away from you, z up.
struct World
{
    Plan P;
    double depth = 0, wide = 0, H = 0;
    V3 listen {}, src {};
};
World rvRoomWorld (const Values& v);
struct Camera
{
    V3 pos {}, f {}, r {}, u {};
    double F = 1, cx = 0, cy = 0;
};
Camera rvCamera (double w, double h, const World& W, const Cam& cam = {});
std::optional<V3> rvProj (const Camera& C, V3 p);
/// What rvDrawRoom leaves (RV_ROOM) and returns (the readout).
struct Room
{
    World W;
    Camera C;
    std::optional<V3> Sq; // the sound on screen: x, y, its radius
    std::string readout;
};
Room rvDrawRoom (c2d::Context&, double w, double h, const Values& v, double e, double since, double t, const Colours&, const Cam& cam = {});
/// The readout under the room: "Room · 24 m · the sound 8 m away, 35% up", or
/// "Place off: the mode exactly as measured".
std::string rvReadout (const Values& v);

// the room's gestures (rvBuild's handlers), in the room canvas's own pixels
bool rvRoomOnSound (const Room&, double x, double y);
void rvRoomTurn (Cam&, double dx, double dy);
double rvRoomDragHeight (double height, double dy);
/// The sound dragged to (sx, sy): Place's new pos and dist; false where the
/// ray misses the sound's plane (nothing changes).
bool rvRoomDragSound (const Room&, double sx, double sy, double& pos, double& dist);

// ── the window's state as numbers ──────────────────────────────────────────
/// rvFrame's levels: the glow and the input's hits.
struct Levels
{
    double e = 0.05, pingAt = -99, inPeak = 0;
    void step (double peakIn, double peakOut, double t);
    double glow() const;  // max(0.06, e)
    bool moving() const;  // e > 0.03
};

// ── Place and the band ─────────────────────────────────────────────────────
struct PlaceSpec
{
    std::string key, label;
    double min = 0, max = 1, def = 0;
    double step = 0;                 // 0: none
    std::string unit;
    bool log = false, toggle = false;
    std::vector<std::string> choices;
};
const std::vector<PlaceSpec>& RV_PLACE();
/// rvPlace's defaults: on 0, shape 1, sizeM 24, pos -25, dist 40, height 35, spread 100.
Values rvPlaceDefaults();
/// rvFrame's `pv`: Place's keys as rvDrawRoom reads them, and the slot's freeze.
Values rvRoomValues (const Values& place, std::optional<double> freeze);

struct Pad
{
    std::string x, y;
};
const std::map<std::string, Pad>& RV_NEW_PADS();
/// rvPad: the shaper's own pad, else RV_NEW_PADS', if both its keys are params.
std::optional<Pad> rvPadOf (const std::string& modeId, const std::optional<Pad>& shaperPad, const std::vector<std::string>& paramKeys);
bool rvIsFader (const std::string& key); // RV_FADERS
const std::vector<std::string>& RV_ROLES();
/// rvRoleOf: the param's own role ('stereo' read as 'space'), else by its key.
std::string rvRoleOf (const std::string& role, const std::string& key);
} // namespace rvd

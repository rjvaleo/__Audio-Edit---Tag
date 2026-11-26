// MGL's effect cards' pictures and displays, ported string for string:
//
// - ui/app/075-fx-faces.js: the `FXP` closure (the drawing kit, every `PIC`
//   picture and `picFor`, every `HERO` display and `heroFor`, `noText`,
//   `display`, `padMark`, `rbjDb`) and the helpers after it (`fxModel`'s
//   specs and values, `fxIsSwitch`, `fxIsLog`, `fxUnit`, `fxFromUnit`,
//   `fxClamp`, `fxFormat`, `fxShort`, `fxFamilyColour`, `fxTwin`, `fxPanelOf`,
//   and the markup `fxKnob`, `fxFader`, `fxSlider`, `fxTile` and `fxAdvanced`
//   put in the page);
// - 071-rack-controls.js: `fxValueFormat`, `automationUnit`, `unitValue`,
//   `defaultEqBands`; 072-rack-knob.js: `fitLabel`, `digits`;
// - 075b-fx-face-kinds.js: `fxRoleGroups`, the dynamics face's transfer curve
//   and meters, the maximizer's display and meters, the EQ's bands, curve,
//   type buttons, readouts and the selected band's knobs, `fxDecorateRow`'s
//   picture, and the generic face's display with its pad mark;
// - 076-fx-suites.js: `FX_SH_HUE`, `fxShDial`'s and `fxShSwitch`'s pictures,
//   `fxLexKnob`'s ring, reading and picture, `fxLexImpulse`;
// - 073a-ui-knob.js: the shared knob's ring (`uiRingGeo`, `uiArc`,
//   `uiKnobHtml`, what `uiKnobPaint` sets) and `uiPic`;
// - 404-grain-rack.js: `gsMixGlyph`, `gsLevelGlyph`, `GS_GICON`,
//   `gsRackIcon`, `gsFkIcon`.
//
// Each returns the markup the page writes (UTF-8), with the page's classes,
// for `ppic::draw` to render; numbers are written as JS writes them
// (`gg::toFixed`, `gg::jsString`). Checked against the JS by
// native/tools/face-capture/fxp-refs.mjs and fxp-test.cpp.
//
// JS's `undefined` is an absent key (`Values`) or an empty `std::optional`;
// a missing number read as a number is NaN, as in JS.
#pragma once

#include <juce_core/juce_core.h>

#include <map>
#include <optional>
#include <set>
#include <string>
#include <vector>

namespace fxp
{
// ── a control and the values ───────────────────────────────────────────────

/// An effect's control: one of `/api/fx`'s shaper `params`.
struct Spec
{
    std::string key, label, unit, role;
    double min = 0, max = 1;
    std::optional<double> step, def; // `p.step`, `p.default`
    bool log = false, toggle = false;
    bool hasChoices = false;
    std::vector<std::string> choices;
    static Spec fromVar (const juce::var&);
};

/// `m.values()`: the controls' values by key; a key that is not there is JS's
/// `undefined` (so `v.x ?? d` is `d`).
using Values = std::map<std::string, double>;
/// `v[key] ?? d`.
double val (const Values&, const std::string& key, double d);

/// `fxModel(slot)`: the specs and values a face reads. `shaper` is
/// `state.shapers[slot.kind]` (for `comp`, `state.shapers['prism:compressor']`;
/// void for its built-in list). Missing values take the spec's default, as
/// fxModel writes them into the slot.
struct Model
{
    std::string kind;
    std::vector<Spec> specs;
    Values values;
    const Spec* byKey (const std::string& key) const;
    /// `m.get(key)`: NaN where JS has undefined.
    double get (const std::string& key) const;
};
Model fxModel (const juce::var& slot, const juce::var& shaper);

/// A shaper in `/api/fx`'s answer (`{shapers: [...]}`, an array of them, or an
/// object by kind); void when there is none.
juce::var findShaper (const juce::var& api, const std::string& kind);

// ── FXP ────────────────────────────────────────────────────────────────────

/// FXP's `N`: rounded to 2 places, as JS's toString writes it.
std::string N (double v);
/// `Math.log` and `Math.log10` as V8 computes them (fdlibm), so that values
/// written out in full match the page's to the last digit.
double jsLog (double x);
double jsLog10 (double x);

/// `PIC[name](n, v, p)`; empty for a name with no picture. `p` may be null.
std::string pic (const std::string& name, double n, double v, const Spec* p);
/// Every key of `PIC`, in the page's order.
const std::vector<std::string>& picNames();
/// `picFor(p)`: which picture a control gets. (std::regex: cache the answer.)
std::string picFor (const Spec& p);
/// `svg(inner, cls)`: a picture in its 64 x 48 <svg>.
std::string svg (const std::string& inner, const std::string& cls = "pic");
/// `noText(s)`: without its <text> elements.
std::string noText (const std::string& s);

constexpr double HW = 400, HH = 70;
/// `HERO[key](v)`; empty for a key with none (`hasHero` tells them apart from
/// the gate's empty display).
std::string hero (const std::string& key, const Values& v);
bool hasHero (const std::string& key);
const std::vector<std::string>& heroKeys();
/// `heroFor(kind)`: which display an effect draws.
std::string heroFor (const std::string& kind);
/// `display(inner, fill)`: the 400 x 70 <svg>.
std::string display (const std::string& inner, bool fill = false);
/// `padMark(u, w, xl, yl)`.
std::string padMark (double u, double w, const std::string& xl, const std::string& yl);
/// `rbjDb(type, f0, q, g, f, fs)`.
double rbjDb (int type, double f0, double q, double g, double f, double fs = 48000);

// ── 075's helpers ──────────────────────────────────────────────────────────

/// A knob's range (`fxRange`): the Advanced page's, or the effect's.
struct Range
{
    double min = 0, max = 1;
    bool log = false;
};
bool fxIsSwitch (const Spec&);
bool fxIsLog (const Spec&);
/// `fxRange(m, p)`: `ranges` is `state.rack.ranges` (void for none).
Range fxRange (const juce::var& ranges, const std::string& slotId, const Spec&);
double fxUnit (const Range&, double v);
double fxFromUnit (const Range&, double u);
double fxClamp (const Spec&, double v);
std::string fxFormat (const Spec&, double v);
std::string fxShort (const std::string& label, const std::string& group);
std::string fxTwin (const std::string& kind);
/// `fxFamilyColour(kind)`: "#rrggbb". `api` as for `findShaper`.
std::string fxFamilyColour (const std::string& kind, const juce::var& api);
/// `fxPanelOf(kind, keys)`: `own` and `twin` are the shapers of the kind and
/// of its twin; void for none.
juce::var fxPanelOf (const juce::var& own, const juce::var& twin, const std::set<std::string>& keys);

/// The knob's picture (`fxKnob`'s `pic(u)`), on its range.
std::string fxKnobPic (const Spec&, double v, const Range&);
/// `fxSlider`'s picture: the same, in its <svg>.
std::string fxSliderPic (const Spec&, double v, const Range&);
/// `fxTile`'s button (and `fxShSwitch`'s): the picture lit or not, and on/off.
std::string fxTileHtml (const Spec&, double v);
bool fxTileOn (const Spec&, double v);
/// `fxFader`'s track for a value `u` (0 to 1) along its range.
std::string fxFaderTrack (double u);
/// The Advanced page's picture for a control.
std::string fxAdvancedPic (const Spec&);
/// `fxDecorateRow`'s picture (the Hyperprism, SoundHack and Lexicon rows).
std::string fxDecoratePic (const Spec&, double v);
/// Hyperprism's linked Dry / Wet as one control: its spec and value.
Spec fxHpMixSpec();
double fxHpMixValue (double wet, double dry);

// 071 / 072
std::string fxValueFormat (const Spec&, double v);
double automationUnit (double value, double min, double max, bool log = false);
double unitValue (double unit, double min, double max, bool log = false);
std::string fitLabel (const std::string& text);
std::string digits (const std::string& t);

// ── 075b ───────────────────────────────────────────────────────────────────

struct Group
{
    std::string label;
    std::vector<std::string> keys;
};
std::vector<Group> fxRoleGroups (const std::vector<Spec>&);

/// The generic face's display (`fxDeckFace`'s `hero()`): `display(HERO(v))`
/// with the pad's mark where `panel` has a pad; empty where the kind has no
/// display (the face hides it). `panel` is `fxPanelOf`'s.
std::string fxDeckDisplay (const Model&, const juce::var& panel);

/// A meter's paint: `--h` (e.g. "37.5%") and its reading.
struct Meter
{
    std::string h, text;
};
/// `fxDynamicsFace`'s paint: the transfer curve's <svg>, the three meters and
/// the threshold caret's `top`. `level` is the input's peak in dB (none: the
/// meters' floor).
struct DynPaint
{
    std::string curve;
    Meter in, gr, out;
    std::string caretTop;
};
DynPaint fxDynamicsPaint (const Model&, std::optional<double> level, bool gate);

/// `fxMaximizerFace`'s paint: the display, the meters, the ceiling's caret.
struct MaxPaint
{
    std::string curve;
    Meter in, gr, out;
    std::string caretTop;
};
MaxPaint fxMaximizerPaint (const Values&, std::optional<double> level);

/// An EQ band as `fxEqBands` reads it.
struct EqBand
{
    std::string type; // FX_EQ_TYPES[...]; may be "" (JS undefined)
    bool enabled = false;
    double freq = 0, q = 0.71, gainDb = 0;
};
extern const char* const FX_EQ_TYPES[6];
extern const char* const FX_EQ_SHORT[6];
extern const char* const FX_EQ_ICON[6];
extern const char* const FX_EQ_COLOURS[8];
std::vector<EqBand> defaultEqBands();
/// `fxEqBands(slot).bands()`: `shaper` is `state.shapers[slot.kind]` (void
/// for the original `eq`).
std::vector<EqBand> fxEqBands (const juce::var& slot, const juce::var& shaper);
/// `fxEqFace`'s `paintCurve`: the display's <svg>. `spectrum`: the live
/// analyser's bins (0 to 255), empty for none.
std::string fxEqCurve (const std::vector<EqBand>&, int sel, double fs = 48000, const std::vector<double>& spectrum = {});
/// `paintStrips`: a band's type button (its class, markup and title) and its
/// readout's markup.
struct EqButton
{
    std::string cls, html, title;
};
EqButton fxEqTypeButton (const EqBand&, int i, int sel);
std::string fxEqReadout (const EqBand&);
/// `paintSel`'s knobs for the selected band.
std::vector<Spec> fxEqSelSpecs (const EqBand&, int sel);

// ── 076 ────────────────────────────────────────────────────────────────────

/// `FX_SH_HUE[kind without prism:] || '#6fae3f'`.
std::string fxShHue (const std::string& kind);
/// `fxShDial`: its position (0 to 1) and its picture.
double fxShDialUnit (const Spec&, double v);
std::string fxShDialPic (const Spec&, double v);
/// A SoundHack choice's segment picture (`sh-choice`), for its value.
std::string fxShChoicePic (const Spec&, double segValue);
/// `fxLexKnob`: its ring's markup, its LCD reading and its picture.
double fxLexUnit (const Spec&, double v);
std::string fxLexRing (double u);
std::string fxLexReading (const Spec&, double v);
std::string fxLexPic (const Spec&, double v);
/// `fxLexImpulse(v)`, and the picture `paintImpulse` writes (`rt` is
/// `byKey.reverbTimeS`, null for none).
std::string fxLexImpulse (const Values&);
std::string fxLexImpulsePicture (const Values&, const Spec* rt);

// ── 073a: the shared knob ──────────────────────────────────────────────────

struct RingGeo
{
    double c, r, mr, w;
};
RingGeo uiRingGeo (double size);
std::string uiArc (double c, double r, double u0, double u1);
std::string uiKnobHtml (int size = 44, std::optional<bool> face = {}, const std::string& inner = {}, const std::string& cls = {});
std::string uiPic (const std::string& inner, const std::string& vb = "0 0 64 48", const std::string& cls = {});
/// What `uiKnobPaint` sets for a state.
struct RingState
{
    double u = 0;
    bool bip = false, pointer = false;
    bool mod = false; // st.mod given
    double modRng = 0;
    std::optional<double> modLive;
    std::string modCol;
    std::optional<double> def;
};
struct RingPaint
{
    std::string arD, capV, mdD, mc; // mc: --mc, empty when removed
    bool modClass = false;
    bool liveShown = false;
    std::string liveCx, liveCy;
    bool ptrShown = false;
    std::string ptrX1, ptrY1, ptrX2, ptrY2;
    bool dnSet = false;
    std::string dnX1, dnY1, dnX2, dnY2;
};
RingPaint uiKnobPaint (double size, const RingState&);
/// The painted ring's elements as one SVG body (the tags `uiKnobHtml` makes,
/// with what `uiKnobPaint` set, in the DOM's attribute order; hidden ones left
/// out), for `ppic::draw`.
std::string uiRingBody (double size, const RingState&);

// ── 404 ────────────────────────────────────────────────────────────────────

std::string gsMixGlyph (double v);
std::string gsLevelGlyph (double v);
/// `GS_GICON[group]`, empty for none.
std::string gsGroupIcon (const std::string& group);
/// `gsRackIcon(kind)`: `group` is `gsFxGroup(kind)` (the add menu's family).
std::string gsRackIcon (const std::string& kind, const std::string& group);
/// `gsFkIcon(label)`, empty for none.
std::string gsFkIcon (const std::string& label);
} // namespace fxp

// One effect card of MGL's rack, drawn natively: every card the FX page's
// rack can hold (075-fx-faces.js, 075b-fx-face-kinds.js, 076-fx-suites.js,
// 404-grain-rack.js), shared by the FX page, every effect module on its own,
// Grain's FX view and Wave's inspector.
//
// The card's frame is its own capture (tools/face-capture/capture-fx.mjs:
// each kind alone in the rack at its defaults, with every switch flipped, in
// Advanced, and a Hyperprism, SoundHack or Lexicon mode in MGL's own look),
// in the theme worn. Over it the card draws what its values move, with the
// page's own markup ported string for string (FxPictures): each knob's ring,
// picture and reading, the Lexicon knobs, the footer's Wet / dry and Level,
// the display (the effect's picture of what it does, with its pad), the
// dynamics' curve, meters and caret, the EQ's curve, switches lit or not,
// the power. Every control does what the page's does, sent as MGL's rack
// messages (`send`): a knob or a footer bar dragged (Shift fine), turned
// with the wheel, double-clicked home; a switch or a choice clicked; the
// display dragged as the pad; power, ×, the Mode menu, the face's look,
// Advanced, Open (the Reverb window).
#pragma once

#include "Face.h"
#include "FxPictures.h"
#include "PrismPictures.h"

#include <functional>
#include <map>
#include <memory>
#include <optional>
#include <set>

class FxCard
{
public:
    // `api` is MGL's /api/fx (the catalogue).
    explicit FxCard (const juce::var& api);

    // What it draws: one of the rack's slots (MGL's slot JSON), the rack's
    // ranges (Advanced's), whether it is the card in front.
    void set (const juce::var& slot, const juce::var& ranges = {});
    // Draw another captured tree's controls for the slot instead of its card
    // (the Reverb window's band: its own controls, then Place's).
    void useTree (const juce::var& walk);
    const juce::var& slot() const { return slotV; }
    juce::String kind() const { return slotV["kind"].toString(); }
    juce::String id() const { return slotV["id"].toString(); }
    bool captured() const { return cap != nullptr; }
    float width() const { return size.x; }
    float height() const { return size.y; }
    bool front = false;
    bool advanced = false;

    // The level going into the slot (dB, for the dynamics' meters) and its
    // telemetry (a compressor's reduction).
    void setLive (std::optional<double> inDb, double telemetry);

    // Draw it with its top-left at `at`.
    void paint (juce::Graphics&, juce::Point<float> at);

    // What a message to the module's rack is (na_fx_call "rack" bodies):
    // {op: param, id, key, value}, {op: bypass, on}, {op: remove}, {op: mode,
    // suite, mode}, {op: face, face}; and {op: open} for the Reverb window,
    // {op: advanced}. The owner fills in the slot's place (`at`).
    std::function<void (const juce::var&)> send;

    // The hand, in the card's own pixels (0, 0 its top-left). True when the
    // card took it (it asks to be drawn again by `send` or `changed`).
    bool mouseDown (juce::Point<float>, const juce::ModifierKeys&);
    void mouseDrag (juce::Point<float>, const juce::ModifierKeys&);
    void mouseUp();
    bool doubleClick (juce::Point<float>);
    bool wheel (juce::Point<float>, float dy, bool shift);
    std::function<void()> changed;
    // The header (to drag the card along the rack).
    bool onHeader (juce::Point<float>) const;
    // Where a control is, in the card's pixels ("knob:<key>", "foot:wet",
    // "foot:level", "power", "remove", "mode", "display", "tile:<key>",
    // "seg:<key>:<i>", "open", "adv", "face:<original|mgl>").
    juce::Rectangle<float> where (const juce::String& part) const;
    // Every control's value now, by key (the bench).
    double value (const juce::String& key) const;

private:
    juce::var api;   // shared, not copied (a var holds its object by reference)
    juce::var customTree;
    juce::var slotV, ranges, shaper;
    fxp::Model model;
    juce::var panel;
    const juce::var* cap = nullptr;     // cards[kind] in the worn theme's capture
    juce::String variant;               // "tree", "mgl" or "adv"
    juce::Point<float> origin, size;    // the card's place in its capture, its size
    std::optional<double> inDb;
    double telemetry = 0;
    int stamp = -1;

    struct Ctl
    {
        juce::String type;              // knob, lex, foot, tile, seg, display, pad
        juce::String key;
        fxp::Spec spec;
        juce::Rectangle<float> r;       // the whole control (card pixels)
        juce::var node, ring, pic, val, fill, line, dot;
        std::vector<juce::var> segs;    // a choice's buttons
        bool controls = true;           // inside the faded body when off
    };
    std::vector<Ctl> ctls;
    int placeDepth = 0;
    // The EQ's own: the band picked (`eqBandSelections`, 3 to begin with), its
    // band tabs, readouts, On and type buttons, and a band's node dragged.
    int eqSel = 2, eqDrag = -1;
    std::vector<juce::var> eqTabs, eqReads, eqTypes;
    juce::var eqOn;
    bool isEq() const { return kind() == "eq" || kind() == "prism:eq"; }
    juce::String bandKey (const juce::String& key) const;
    void eqSet (int band, const juce::String& field, const juce::var& value);
    juce::Point<float> eqNode (int band) const;
    juce::var handle, power, remove, mode, adv, open, faceOrig, faceMgl, dynCurve, dynCaret, eqCurve;
    std::vector<std::pair<juce::var, juce::var>> dynMeters;   // (well, fill)
    juce::Rectangle<float> header, body;
    std::map<juce::String, std::unique_ptr<face::Chrome>> chromes;   // by variant (and "lit", "off")
    std::map<juce::String, juce::Image> cache;
    juce::String cacheSig;
    std::map<juce::String, ppic::Style> styles;                     // by the captured svg's own class

    face::Chrome& chrome (const juce::String& v);
    const juce::var* tree (const juce::String& v) const;
    void layout();
    void collect (const juce::var& n, bool inControls);
    juce::Rectangle<float> local (const juce::var& node) const;
    void svgAt (juce::Graphics&, const juce::var& node, const std::string& markup, juce::Point<float> at, float vbW = 64, float vbH = 48);
    void textAt (juce::Graphics&, const juce::var& node, const juce::String& text, juce::Point<float> at, juce::Justification = juce::Justification::centred);
    double get (const Ctl&) const;
    void put (const Ctl&, double v);
    fxp::Range range (const Ctl&) const;

    // The hand's drag.
    int dragging = -1;
    juce::Point<float> downAt;
    double downU = 0;
    const Ctl* at (juce::Point<float>) const;
};

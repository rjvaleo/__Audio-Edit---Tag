// Chop's face: MGL's Chop page, drawn natively at its own size (1432 x 1000).
// ui/app/400-406-chop*, 405b-chop-presets.js, chop.css, #dockChop.
//
// The frame is the page's own, captured (tools/face-capture/capture-chop.mjs,
// one capture per theme): the page with a sound open, the page with none, and
// the page with every switch lit. The face shows the capture and draws over it,
// in layers drawn again only for what they show, everything that moves: the
// waveform coloured by the measures, the overview, the slices on the lane (the
// washes, numbers, edges, the ruler with its bars, cuts, S and E, the grid, the
// threshold, the playhead), the picked slice, the pass, the slice list, every
// knob (its ring, its picture, its reading, dimmed as the page dims it), the
// processing modules' pictures and curves, the readings. Switches are lit from
// the page's own lit captures. Every control does what the page's does,
// through the app's Chop calls (na_chop_call), which are the page's functions
// moved to the app (engine-app chop_part.rs).
#pragma once

#include "Face.h"
#include "na.h"

#include <functional>
#include <map>
#include <memory>
#include <set>
#include <vector>

class ChopFace final : public juce::Component, private juce::Timer
{
public:
    using Call = std::function<int64_t (const std::function<int64_t (NaApp*)>&)>;
    ChopFace (Call, uint32_t id);
    ~ChopFace() override;

    std::function<void (const juce::String&)> onMessage;
    std::function<bool (const juce::MouseEvent&)> blocked;
    // ＋ on the file tabs with no sound cabled: a Sound module beside it.
    std::function<void()> wantSound;

    // Read the module's state again (after a load, a cable).
    void reload();
    // One step of the clock (the snapshots and the bench).
    void poll() { timerCallback(); }
    // One of the module's calls (na_chop_call), its answer.
    juce::var chopCall (const char* what, const juce::var& body);
    const juce::var& st() const { return state; }
    // Where a part of the page is (an id, "knob:<key>", "bar:<key>", "lane").
    juce::Rectangle<float> where (const juce::String& part) const;
    // Every layer drawn once, timed (the bench).
    std::vector<std::pair<juce::String, double>> profile (float scale);

    bool keyPressed (const juce::KeyPress&) override;
    void mouseDown (const juce::MouseEvent&) override;
    void mouseDrag (const juce::MouseEvent&) override;
    void mouseUp (const juce::MouseEvent&) override;
    void mouseDoubleClick (const juce::MouseEvent&) override;
    void mouseWheelMove (const juce::MouseEvent&, const juce::MouseWheelDetails&) override;

    struct Layer final : public juce::Component
    {
        std::function<void (juce::Graphics&)> draw;
        juce::String name;
        void paint (juce::Graphics& g) override { draw (g); }
    };

    // A knob of the page (CHOP_KNOBS, CHOP_FX).
    struct Knob
    {
        juce::String key, label, facet, group, fxLook, title;
        double min = 0, max = 1, step = 1, def = 0;
        bool log = false, fx = false;
        juce::String when;   // the mode it cuts in ("" always)
    };

    struct Node
    {
        int i = -1;
        juce::Rectangle<float> r;
        juce::var n;
    };

private:
    Call call;
    const uint32_t id;
    const juce::var& captured;
    juce::var data;
    std::unique_ptr<face::Chrome> page, empty;
    face::Chrome* shown = nullptr;
    std::map<juce::String, Node> ids, litIds, emptyIds;
    std::vector<std::unique_ptr<Layer>> layers;
    std::map<juce::String, Layer*> named;
    Layer* addLayer (const juce::String& name, juce::Rectangle<float> r, std::function<void (juce::Graphics&)> draw);
    void repaintLayer (const juce::String& name);
    void buildLayers();
    void index (const juce::var& n, std::map<juce::String, Node>& into, const juce::String& prefix);
    const juce::var* child (const juce::var& n, const juce::String& cls) const;
    juce::Colour cl (const juce::String& token) const;
    juce::String cs (const juce::String& token) const;

    std::map<juce::String, Knob> knobs;
    std::vector<juce::String> knobOrder;
    std::map<juce::String, Node> knobNodes;   // the knob's (or the fx bar's) node in the page

    // ── the module's state (na_chop_call "state") ──
    juce::var state;
    int64_t serial = -1, soundSerial = -1;
    bool hasSound() const { return state["sound"].isObject(); }
    double num (const juce::String& k) const;
    juce::String str (const juce::String& k) const;
    bool flag (const juce::String& k) const;
    struct Slice
    {
        int64_t s = 0, e = 0;
        bool locked = false, moved = false, muted = false, rev = false;
        juce::String kind;
    };
    std::vector<Slice> slices;
    std::set<int> sel;
    int current = -1;
    int64_t len = 0, regionS = 0, regionE = 0;
    double rate = 48000;
    juce::String playing;
    double playAt = -1;
    void take (const juce::var& answer);
    void readState (const juce::var& s);

    // ── the sound, and what was measured ──
    std::vector<float> mono;
    std::vector<std::vector<float>> an;   // low mid high cent flat zcr rms rise hz clar
    int anF = 0;
    bool anReady = false;
    float peak = 0.001f;
    void loadSound();
    void loadAnalysis();

    // ── the face's own (chopView, chopColour, chopSoft, chop.tool) ──
    juce::String tool = "pointer", colour = "spectrum", followMode = "scroll";
    double viewA = 0, viewB = 1;
    bool follow = true, softOn = false;
    double softAlpha = 0.3;
    float listScroll = 0;
    juce::String said;          // the foot's said line ("" the hint)
    juce::String readout;       // the drag readout on the lane
    double readoutAt = 0;
    int going = -1;             // a cut dragged off the ruler
    bool uiRead = false;
    void keepUi();
    void restoreUi (const juce::var& ui);
    void laneChanged();

    // ── the looks: switches lit from the captures ──
    void restyle();
public:
    double restyleMs = 0;
private:
    bool knobDim (const juce::String& key) const;
    juce::var rowOn, rowCurrent, rowPicked, rowPlain, rowMuted, badgeOk, badgeClamped, badgeSkip, kindLabel;

    // ── the drawings (ChopDraw.cpp) ──
    juce::Image laneWave;
    juce::String laneWaveKey;
    double xOf (double f) const { return (f - viewA) / juce::jmax (1.0, viewB - viewA); }
    double frameOf (double u) const { return viewA + u * (viewB - viewA); }
    void peaks (int w, double a0, double b0, std::vector<float>& mx) const;
    juce::Colour kindColour (const Slice&) const;
    void frameColour (int f, float out[3]) const;
    void drawColumns (juce::Graphics&, const std::vector<float>& mx, int w, float mid, float A, double a0, double b0, float alpha);
    void drawPlain (juce::Graphics&, const std::vector<float>& mx, int w, float mid, float A, float alpha);
    void drawWave (juce::Graphics&, float w, float h);
    void drawOverlay (juce::Graphics&, float w, float h);
    void drawPlayhead (juce::Graphics&, float w, float h);
    void drawOverview (juce::Graphics&, float w, float h);
    void drawOut (juce::Graphics&, float w, float h);
    void drawLegend (juce::Graphics&);
    void drawSlicePic (juce::Graphics&, float w, float h);
    void drawPass (juce::Graphics&, float w, float h);
    void drawCurve (juce::Graphics&, float w, float h, const std::function<float (float, float)>& fn,
                    const std::function<void (juce::Graphics&, float, float)>& under, const juce::String& label);
    void drawEnv (juce::Graphics&, float w, float h);
    void drawTransient (juce::Graphics&, float w, float h);
    void drawEq (juce::Graphics&, float w, float h);
    void drawFilter (juce::Graphics&, float w, float h);
    void drawList (juce::Graphics&);
    void drawKnob (juce::Graphics&, const juce::String& key);
    void drawTexts (juce::Graphics&);
    juce::String only;                // which reading a text layer writes
    std::vector<int> drawnSlices, drawnCuts;   // what the overlay drew, for the hits
    int passPlayed = 0, passFires = 0;
    void writeText (juce::Graphics&, const juce::String& nodeId, const juce::String& text, juce::Colour* tint = nullptr);
    juce::var sliceInfo;        // "slice" for the picked one
    juce::var tails;            // "tails"
    std::vector<float> rendered;   // the picked slice as it comes out
    int renderedFor = -2;
    int64_t renderedSerial = -1;

    // ── readings the page writes (ported) ──
    double bpm() const { return num ("bpm"); }
    juce::String fmtKnob (const Knob&, double v) const;
    juce::String stat (const juce::String& k) const;

    // ── gestures ──
    enum class Grab { none, knob, edge, region, overview, list };
    Grab grab = Grab::none;
    juce::String grabKey, grabSide;
    int grabI = -1;
    bool grabRuler = false, grabMoved = false, grabAway = false;
    double grabU = 0, grabY = 0, grabStart = 0, grabR0s = 0, grabR0e = 0;
    juce::Point<float> down;
    juce::String knobAt (juce::Point<float>) const;
    double toU (const Knob&, double v) const;
    double fromU (const Knob&, double u) const;
    double laneFrame (float x) const;
    void setKnob (const juce::String& key, double v, bool live);
    void set (const juce::String& key, const juce::var& v);
    void zoom (double factor, double at);
    void fit();
    void followHead (double at);
    void pick (int i, bool add);
    void playSlice (int i, bool pickIt);
    void say (const juce::String&);
    void presetMenu (juce::Rectangle<float> near);
    void morePresets (juce::Rectangle<float> near);
    void presetStep (int by);
    juce::Rectangle<float> laneRect() const;
    int rowAt (juce::Point<float>) const;

    void timerCallback() override;
};

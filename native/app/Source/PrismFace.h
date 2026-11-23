// Prism's face: MGL's Prism page (HyperStretch and the rack pad merged),
// drawn natively at the size RJ uses it: the page 1500 x 1052 and the Now
// Playing bar (Prism's transport on its page) under it, 1500 x 1100.
// ui/app/385-hyperstretch.js, 386-388b, ui/prism-pad.js, 410-now-bar.js,
// 080-fx-faces-visual.css.
//
// The frame is the page's own, captured (tools/face-capture/capture-prism.mjs,
// one capture per theme): the page with a sound open and Time & Pitch on the
// pad, the page with every switch lit, with Hyperprism Echo on the pad, with
// the Pitch Time Changer, and the Process menu. The face draws over it, in
// layers drawn again only for what they show, everything that moves: SOURCE
// and the mini overview with the playhead, the Process button and menu, the
// axes, the transport and chip, the presets, the chain, the pad (its grid,
// take, ring, ball and readout, the limits and axis names), the engine, every
// control of the process as the shared knob with its picture (the two on the
// pad first, then the effect's groups), the four LFOs, the takes, the faders
// and the Now Playing bar. Every control does what the page's does, through
// the module's calls (na_prism_call): MGL's routes and the page's own
// actions, its takes, LFOs and arithmetic run by the engine.
#pragma once

#include "Face.h"
#include "PrismPictures.h"
#include "na.h"

#include <functional>
#include <map>
#include <memory>
#include <set>
#include <vector>

class PrismFace final : public juce::Component, private juce::Timer
{
public:
    using Call = std::function<int64_t (const std::function<int64_t (NaApp*)>&)>;
    PrismFace (Call, uint32_t id);
    ~PrismFace() override;

    std::function<void (const juce::String&)> onMessage;
    std::function<bool (const juce::MouseEvent&)> blocked;

    // Read the module's state again (after a load).
    void reload();
    // One frame of the page (the snapshots and the bench), at the face's clock.
    void poll() { timerCallback(); }
    // The clock the frames run on, ms; `fixedClock` > 0 holds it (snapshots).
    double fixedClock = 0;
    // One of the module's calls; the view it answers with is kept.
    juce::var prism (const char* what, const juce::var& body = {});
    const juce::var& viewNow() const { return view; }
    // Where a part is, in the face's pixels (the bench): "pad", "knob:<key>",
    // "seg:<engine>", "slot:<i>", "fader:<l|lr|r>", "pick", "pickItem:<kind>",
    // "limit:<xLo|...>", "pbar:next", "rec", "play", "stop", "lfoShape:<s>",
    // "lfoMap", "nowPlay", "bar:<key>".
    juce::Rectangle<float> where (const juce::String& part) const;
    // What the last changes marked to be drawn again (layer, area), taken;
    // and drawing just that at `scale`, timed, as the window would (the bench).
    double paintDirty (float scale);
    // Each layer's drawing time at `scale` (the bench).
    std::vector<std::pair<juce::String, double>> profile (float scale);
    bool pickOpen() const;
    // A press on the Process menu at `p` (the face's pixels), as a hand would (the bench).
    void pickAt (juce::Point<float> p);
    // Type a limit as the corner's field would (the bench).
    void typeLimit (const juce::String& field, const juce::String& text);

    bool keyPressed (const juce::KeyPress&) override;
    void mouseDown (const juce::MouseEvent&) override;
    void mouseDrag (const juce::MouseEvent&) override;
    void mouseUp (const juce::MouseEvent&) override;
    void mouseMove (const juce::MouseEvent&) override;
    void mouseExit (const juce::MouseEvent&) override;
    void mouseDoubleClick (const juce::MouseEvent&) override;
    void mouseWheelMove (const juce::MouseEvent&, const juce::MouseWheelDetails&) override;

    struct Layer final : public juce::Component
    {
        std::function<void (juce::Graphics&)> draw;
        juce::String name;
        void paint (juce::Graphics& g) override { draw (g); }
    };
    struct N
    {
        int i = -1;
        juce::Rectangle<float> r;
        juce::var n;
        bool ok() const { return i >= 0; }
    };
    using Ids = std::map<juce::String, N>;

    // A control of the process on the pad, as the Controls panel builds it.
    struct Spec
    {
        juce::String key, label, unit;
        double min = 0, max = 1, step = 0, def = 0;
        bool log = false, hasDef = false;
        juce::StringArray choices;
    };
    // One cell of a knob grid, laid out.
    struct Cell
    {
        Spec s;
        juce::Rectangle<float> r;           // the param row (74 wide)
        juce::Rectangle<float> knob, pic;   // the ring's box, the picture's
        juce::StringArray name, value;      // lines
        float labelY = 0;
        juce::String ax, src;
        bool lfo = false;                   // an LFO's own knob (Rate, Depth, Width)
        juce::String field;                 // its field (rate, depth, pw)
    };

private:
    Call call;
    const uint32_t id;
    const juce::var& captured;
    std::unique_ptr<face::Chrome> frame, nowFrame;
    // The other captures, for their parts' looks (each keeps its own SVGs).
    std::unique_ptr<face::Chrome> litC, echoC, nowLitC;
    juce::var view, fx, presetList;
    juce::String viewText;
    std::vector<char> answerBuf;
    std::vector<std::unique_ptr<Layer>> layers;
    std::map<juce::String, Layer*> named;
    std::map<juce::String, juce::String> sigs, cellSigs;
    juce::Image padBoxImage[2];
    std::map<juce::String, std::pair<juce::String, juce::Image>> boxCache;
    // A captured box (its shadows, fills and border) drawn once at the
    // screen's sharpness for this place, and kept.
    void cachedBox (juce::Graphics&, const juce::String& key, const juce::var& look, juce::Rectangle<float> r);
    float padBoxScale = 0;
    std::vector<std::pair<Layer*, juce::Rectangle<int>>> dirty;
    void drawPadBox (juce::Graphics&);
    Layer* addLayer (const juce::String& name, juce::Rectangle<float> r, std::function<void (juce::Graphics&)> draw);
    void repaintLayer (const juce::String& name);
    void buildLayers();
    void refresh (bool all);

    // ── the captures' parts ──
    Ids pageIds, litIds, echoIds, ptcIds, nowIds, nowLitIds;
    std::map<juce::String, juce::var> look;  // templates by name
    void index (const juce::var& tree, Ids& into, juce::Point<float> by);
    const juce::var* findIn (const juce::var& tree, const std::function<bool (const juce::var&)>&) const;
    juce::Colour cl (const juce::String& token, const juce::String& fallback = "#888") const;
    ppic::Style sideStyle, barStyle, menuStyle, menuItemStyle;
    std::map<juce::String, juce::String> padInk;   // the pad's strokes, from its captured <svg>
    std::map<juce::String, juce::String> padInkRec;

    // ── the view, read ──
    juce::String source, soundName, soundPath;
    double frames = 0, rate = 48000, inFrames = 0, position = 0;
    bool playing = false, looping = true;
    juce::var setup, values, pad, lfos, deck;
    juce::Array<juce::var> sources;
    const juce::var* currentSource() const;
    const juce::var* control (const juce::String& key) const;
    juce::String metaLine;
    void readView (const juce::var&);
    void readMeta();
    juce::String metaFor;

    // ── the Controls and LFOs panels, laid out from what they hold ──
    std::vector<Cell> cells, lfoCells;
    std::vector<std::pair<juce::String, juce::Rectangle<float>>> groupLabels;
    juce::Rectangle<float> ctlPanel, lfoPanel;
    float lfoDy = 0;
    juce::String layoutFor;
    void layoutControls();
    std::vector<Spec> specsNow (juce::StringArray* groupsOut, std::vector<juce::StringArray>* groupKeys) const;
    double valueOf (const juce::String& key) const;
    juce::String fmtKnob (const Spec&, double v) const;
    double toU (const Spec&, double v) const;
    double fromU (const Spec&, double u) const;

    // ── drawing (PrismDraw.cpp) ──
    std::vector<float> peaks;
    float peakTop = 0.001f;
    juce::String peaksFor;
    void loadPeaks();
    void drawSource (juce::Graphics&);
    void drawHead (juce::Graphics&);
    void drawDeck (juce::Graphics&);
    void drawPadPanel (juce::Graphics&);
    void drawPad (juce::Graphics&);
    void drawControls (juce::Graphics&);
    void drawLfos (juce::Graphics&);
    void drawTakes (juce::Graphics&);
    void drawOutput (juce::Graphics&);
    void drawNow (juce::Graphics&);
    void drawWave (juce::Graphics&, juce::Rectangle<float> r, int head);
    void drawKnob (juce::Graphics&, const Cell&, double v, const juce::var* mark, juce::Colour col);
    void drawBar (juce::Graphics&, const juce::String& key);
    void drawSeg (juce::Graphics&, const N& button, bool on);
    void tree (juce::Graphics&, const juce::var& node, juce::Point<float> by = {}, const juce::String& text = {}, float opacity = 1.0f);
    void write (juce::Graphics&, const juce::var& node, juce::Rectangle<float> r, const juce::String& text, juce::Justification = juce::Justification::centredLeft, bool ellipsis = true);
    juce::Rectangle<float> chainBox;
    std::vector<std::pair<juce::String, juce::Rectangle<float>>> chainX;   // each slot's ×
    juce::Rectangle<float> miniBox;

    // ── the page's own, kept in the patch (`ui`) ──
    juce::String folderShown;

    // ── gestures ──
    enum class Grab { none, pad, knob, bar, fader, seek };
    Grab grab = Grab::none;
    juce::String grabKey;
    int grabCell = -1;
    bool grabLfo = false;
    double grabU = 0, grabLast = 0;
    float grabY = 0, grabX = 0;
    double grabV = 0;
    bool padHasFocus = false;
    double now() const;
    juce::var obj() const;
    juce::Point<float> padFrac (juce::Point<float>) const;
    juce::Rectangle<float> padBox() const;
    void padSize();
    bool padSized = false;
    int cellAt (juce::Point<float>, bool lfo) const;
    void setKnob (const Cell&, double v, bool commit);
    juce::String barAt (juce::Point<float>) const;
    void setBar (const juce::String& key, double v, bool commit);
    void say (const juce::String&);

    // ── menus and the corners' fields ──
    struct Pick;
    std::unique_ptr<Pick> pick;
    void openPick();
    void chosen (const juce::String& kind, const juce::String& sid);
    void axisMenu (const juce::String& axis);
    void chainMenu();
    void soundMenu (bool folder);
    void presetMenu();
    void presetStep (int by);
    void presetSave (bool asNew);
    void loadPresets();
    std::unique_ptr<juce::TextEditor> limitEdit;
    juce::String limitField;
    void editLimit (const juce::String& field);
    juce::Rectangle<float> limitBox (const juce::String& field, juce::Rectangle<float>* unit = nullptr) const;
    juce::String limitText (const juce::String& field) const;

    void timerCallback() override;
};

// The Process menu: every process Prism can play, with its picture, in
// Hyperprism's groups and the page's columns (prismPickerRender).
struct PrismFace::Pick final : public juce::Component
{
    struct Item
    {
        juce::String kind, sid, label;
        juce::Rectangle<float> r;
        bool on = false;
    };
    PrismFace& f;
    std::vector<Item> items;
    std::vector<std::pair<juce::String, juce::Rectangle<float>>> heads;
    int hover = -1;
    explicit Pick (PrismFace& face) : f (face) { setWantsKeyboardFocus (true); }
    void paint (juce::Graphics& g) override;
    void mouseMove (const juce::MouseEvent& e) override
    {
        int h = -1;
        for (int i = 0; i < (int) items.size(); ++i)
            if (items[(size_t) i].r.contains (e.position))
                h = i;
        if (h != hover)
        {
            hover = h;
            repaint();
        }
    }
    void mouseExit (const juce::MouseEvent&) override
    {
        hover = -1;
        repaint();
    }
    void mouseDown (const juce::MouseEvent& e) override
    {
        for (const auto& it : items)
            if (it.r.contains (e.position))
            {
                const auto kind = it.kind, sid = it.sid;
                setVisible (false);
                f.chosen (kind, sid);
                return;
            }
    }
    bool keyPressed (const juce::KeyPress& k) override
    {
        if (k == juce::KeyPress::escapeKey)
        {
            setVisible (false);
            f.grabKeyboardFocus();
            return true;
        }
        return false;
    }
};

// Seq's face: MGL's Seq page, drawn natively at its own size (1500 x 1058):
// the scale sequencer as it was built (ui/sequencer/app.js, look.js,
// scopes.js, keys.js): the transport and presets, the scale library, the
// synth and its filter, three LFOs and the delay, the tuning, the steps, the
// performance's bar and the 88 keys.
//
// The frame is the page's own, captured (tools/face-capture/capture-seq.mjs,
// one capture per theme), with the parts the page makes as it plays staged
// and captured beside it (a picked step, a resting one, the playing one, Play
// lit, the whole scale list, a two-row scale). Over it the face draws what
// moves, with code ported from the page: every knob from its value, every
// reading as the page writes it, the envelopes, the LFOs, the ping-pong, the
// oscillator's scope, the steps, the scale's degrees and ruler, the 88 keys,
// the status line. Every control sets the page's own key through the app
// layer (na_seq_set), as the page's controls set them.
#pragma once

#include "Face.h"

#include <functional>
#include <map>
#include <set>
#include <memory>
#include <vector>

class SeqFace final : public juce::Component, private juce::Timer
{
public:
    // `send(key, json)` sets one of the page's keys; `state()` is every key's
    // value now (a JSON object); `now(step, hz, degree)` the step heard: 1
    // playing and heard, 0 playing and none yet, -1 stopped.
    using Send = std::function<void (const juce::String& key, const juce::String& json)>;
    using State = std::function<juce::String()>;
    using Now = std::function<int (int& step, float& hz, int& degree)>;
    SeqFace (Send, State, Now);
    ~SeqFace() override;

    // The presets: the page's recall menu lists these names; choosing one
    // loads it; Save names the module's state and keeps it; ✕ deletes one.
    std::function<juce::StringArray()> presetNames;
    // The preset last picked here, as the page's display keeps it.
    juce::String shownPreset;
    std::function<void (const juce::String&)> loadPreset, deletePreset;
    std::function<void()> savePreset;
    // True for a press that belongs to the canvas (Space held, the middle button).
    std::function<bool (const juce::MouseEvent&)> blocked;

    void reload();
    void setKey (const juce::String& key, const juce::var& value) { set (key, value); }
    juce::String valueOf (const juce::String& key) const { return str (key); }
    void poll() { timerCallback(); }
    void pick (int step) { picked = step; repaintNamed ("steps"); }
    int scrollOf() const { return (int) listScroll; }
    std::vector<std::pair<juce::String, double>> profile (float scale);

    bool keyPressed (const juce::KeyPress&) override;
    void mouseDown (const juce::MouseEvent&) override;
    void mouseDrag (const juce::MouseEvent&) override;
    void mouseUp (const juce::MouseEvent&) override;
    void mouseDoubleClick (const juce::MouseEvent&) override;
    void mouseWheelMove (const juce::MouseEvent&, const juce::MouseWheelDetails&) override;

private:
    struct Layer final : public juce::Component
    {
        std::function<void (juce::Graphics&)> draw;
        juce::String name;
        juce::StringArray deps;
        void paint (juce::Graphics& g) override { draw (g); }
    };
    std::vector<std::unique_ptr<Layer>> layers;
    std::map<juce::String, Layer*> named;
    Layer* textLayer = nullptr;
    Layer* addLayer (const juce::String& name, juce::Rectangle<float> r, juce::StringArray deps, std::function<void (juce::Graphics&)> draw);
    void addCanvas (const juce::String& id, juce::Rectangle<float> r, juce::StringArray deps, std::function<void (juce::Graphics&, float w, float h)> draw);
    void buildLayers();
    void repaintFor (const juce::String& key);
    void repaintNamed (const juce::String& name)
    {
        if (auto it = named.find (name); it != named.end())
            it->second->repaint();
    }

    Send send;
    State readState;
    Now readNow;
    const juce::var& captured;
    face::Chrome page;
    // The staged parts, each drawn from its own capture where the page has it.
    struct Part
    {
        std::unique_ptr<face::Chrome> chrome;
        juce::var tree;
        juce::Point<float> at;
    };
    Part grid, keys88, play, list, chips;
    juce::var data;   // the page's lists (seq-page.json)
    juce::var vars;   // the page's colour tokens

    std::map<juce::String, juce::var> v;
    float num (const juce::String& key, float fallback = 0.0f) const;
    juce::String str (const juce::String& key, const juce::String& fallback = {}) const;

    struct Node
    {
        int i = -1;
        juce::Rectangle<float> r;
        juce::var n;
    };
    std::map<juce::String, Node> byId;
    struct Knob
    {
        juce::String key;
        float min = 0, max = 100, step = 1;
        juce::Colour kc, track, marker;
        juce::Rectangle<float> r;
        juce::var before;
    };
    std::vector<Knob> knobs;
    std::vector<Node> selects;      // the page's menus (data-k)
    struct Seg
    {
        juce::String key, value;
        Node n;
    };
    std::vector<Seg> segs;          // the segmented switches' buttons
    std::vector<Node> stepNodes;    // the 64 steps, as the page lays them
    std::vector<Node> keyNodes;     // the 88 keys
    std::vector<Node> statusDivs;   // the status line's items, laid out as they grow
    void drawStatus (juce::Graphics&);
    // Each step's look, drawn once at a scale and kept: (look, scale) -> picture.
    std::map<std::pair<int, int>, juce::Image> stepLooks;
    juce::Rectangle<float> stepLookBounds (const juce::var& tmpl) const;
    // Each staged step's words' nodes, found once: (look, kind) -> node.
    struct StepWords
    {
        const juce::var *tmpl = nullptr, *note = nullptr, *oct = nullptr, *hz = nullptr, *num = nullptr, *rest = nullptr;
        juce::Rectangle<float> bounds;
        std::set<int> words;
    };
    std::map<int, StepWords> stepWords;
    const StepWords* wordsOf (int look);
    // Fonts made once, by the captured run they are for.
    std::map<const void*, juce::Font> fonts;
    const juce::Font& fontOf (const juce::var& f);
    // The scale's degrees now, in cents.
    std::vector<double> centsNow;
    // How opaque the words drawText writes are (a dimmed step's).
    float textAlpha = 1.0f;
    std::map<int, juce::String> texts;
    juce::Rectangle<float> listR, degreesR, rulerR, perfR;
    std::vector<std::pair<juce::Rectangle<float>, juce::String>> buttons;  // the page's buttons, by what they do

    // The steps: which is picked, which is heard.
    int picked = -1;
    int heard = -1;
    float heardHz = 0;
    int heardDeg = 0;
    bool playing = false;
    // The ping-pong's and LFOs' animation (requestAnimationFrame there).
    double animPhase[3] {};
    double startMs = 0;

    // The scale list's scroll, in pixels.
    float listScroll = 0;
    float listHeight = 0;
    struct ListRow
    {
        int scale = -1;   // -1: a category
        juce::Rectangle<float> r;   // in the list part's own frame
    };
    std::vector<ListRow> listRows;

    // A knob being turned.
    int turning = -1;
    float turnFrom = 0, turnY = 0;

    void index (const juce::var& n);
    void set (const juce::String& key, const juce::var& value);
    void readBack();
    void sync();
    void timerCallback() override;
    void menu (const juce::String& key, juce::Rectangle<float> near);
    juce::StringArray optionValues (const juce::String& key, juce::StringArray* labels = nullptr) const;
    juce::String format (const juce::String& key, float value) const;
    juce::Colour ink (const juce::String& name, float alpha = 1.0f) const;
    juce::Colour token (const juce::String& t, const juce::String& fallback) const;

    // The page's sums.
    const juce::var& scale() const;
    juce::Array<juce::var> cents() const;
    double rootHz() const;
    double degreeHz (int degree) const;
    struct Key88
    {
        int midi;
        bool inScale, isRoot;
        int degree;
        double hz;
    };
    std::vector<Key88> notes88() const;
    int playingKey() const;

    void drawKnob (juce::Graphics&, const Knob&, juce::Point<float> origin);
    void drawSteps (juce::Graphics&);
    void drawStep (juce::Graphics&, int i);
    void drawKeys (juce::Graphics&);
    void drawList (juce::Graphics&);
    void drawDegrees (juce::Graphics&);
    void drawRuler (juce::Graphics&);
    void drawAdsr (juce::Graphics&, float w, float h, bool filter);
    void drawLfo (juce::Graphics&, float w, float h, int i);
    void drawPingPong (juce::Graphics&, float w, float h);
    void drawScope (juce::Graphics&, float w, float h);
    void drawText (juce::Graphics&, const juce::var& node, const juce::String& text, bool centre);

    // What a step or a key does.
    void stepEdit (int i, const juce::String& what);
    void preview (double hz);
    int stepAt (juce::Point<float>) const;
    juce::String stepButtonAt (int i, juce::Point<float>) const;
    std::vector<std::pair<juce::Rectangle<float>, juce::String>> stepButtons (int i) const;
    juce::Rectangle<float> degreeChip (int d, int n) const;
};

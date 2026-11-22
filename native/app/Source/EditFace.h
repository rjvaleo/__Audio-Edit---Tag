// Edit's face: MGL's Edit page, drawn natively at the size RJ uses it
// (1500 x 1100: the centre of a 1668 x 1100 window with the rail 168 wide,
// and the Now Playing bar under it). ui/app/310-edit-page.js, 411-416,
// 040-waveform.js, 060-editing.js, 300-peak-commands.js, 410-now-bar.js,
// 240-box-fullscreen.js (the spectrogram), edit.css.
//
// The frame (panels, the bar's sections and icons, the counters' boxes, the
// Now bar) is the page's own, captured (tools/face-capture/capture-edit.mjs,
// one capture per theme): with no sound, and with one open. Over it the face
// draws what moves, with code ported from the page: the wave (min/max and
// RMS, the samples close in, Rainbow's colours), the spectrogram, the time
// and level rulers, the hits and loud spots, the selection, the cursor and
// the playhead, the handles on a selection (fades, level, edges, the loupe,
// the preview while held), the counters and meters, the overview strip with
// its loop, Start, markers and regions, and the Now bar's clock, strip and
// meter. Every command runs as the page runs it, through the app layer's
// Edit calls (na_edit_*), which are MGL's /api/edit.
#pragma once

#include "Face.h"
#include "na.h"

#include <functional>
#include <map>
#include <memory>
#include <set>
#include <vector>

class EditFace final : public juce::Component, private juce::Timer
{
public:
    // `call(f)` runs f with the app, under its lock; `id` is the module.
    using Call = std::function<int64_t (const std::function<int64_t (NaApp*)>&)>;
    EditFace (Call, uint32_t id);
    ~EditFace() override;

    // A message for the canvas's status line (the page's toasts).
    std::function<void (const juce::String&)> onMessage;
    // True for a press that belongs to the canvas (Space held, the middle button).
    std::function<bool (const juce::MouseEvent&)> blocked;
    // Asked to open a sound (no Sound module is cabled in): the canvas adds one.
    std::function<void()> wantSound;

    // Read the sound and the face's kept state again (after a load).
    void reload();
    // Run one of the bar's commands by its id, as a click on it does.
    void run (const juce::String& id);
    // Test hooks: the state as the face holds it (JSON), and a step of the clock.
    juce::String stateJson() const;
    void restoreForBench (const juce::var& ui);
    void poll() { timerCallback(); }
    // How long each layer takes to draw at `scale`, slowest first (the bench).
    std::vector<std::pair<juce::String, double>> profile (float scale);
    // Where a part of the page is (bench and tests): "lane", "bar", the
    // overview, a command's button ("cmd:cut"), a counter ...
    juce::Rectangle<float> where (const juce::String& part) const;

    bool keyPressed (const juce::KeyPress&) override;
    void mouseDown (const juce::MouseEvent&) override;
    void mouseDrag (const juce::MouseEvent&) override;
    void mouseUp (const juce::MouseEvent&) override;
    void mouseMove (const juce::MouseEvent&) override;
    void mouseDoubleClick (const juce::MouseEvent&) override;
    void mouseWheelMove (const juce::MouseEvent&, const juce::MouseWheelDetails&) override;

    struct Layer final : public juce::Component
    {
        std::function<void (juce::Graphics&)> draw;
        juce::String name;
        void paint (juce::Graphics& g) override { draw (g); }
    };

private:
    Call call;
    juce::String infoText;   // what the last call read back
    const uint32_t id;
    const juce::var& captured;
    juce::var data;       // the page's lists (edit-page.json)
    juce::var vars;       // the page's colour tokens
    face::Chrome emptyPage, openPage, nowbar, nowbarOpen;
    std::unique_ptr<face::Chrome> barEmpty, barOpen, barCustom;
    std::unique_ptr<juce::Component> barClip;
    std::vector<std::unique_ptr<Layer>> layers;
    std::map<juce::String, Layer*> named;
    Layer* addLayer (const juce::String& name, juce::Rectangle<float> r, std::function<void (juce::Graphics&)> draw);
    void repaintLayer (const juce::String& name);
    void buildLayers();

    // ── the page's parts, by id (from the open capture) ──
    struct Node
    {
        int i = -1;
        juce::Rectangle<float> r;
        juce::var n;
    };
    std::map<juce::String, Node> openIds, emptyIds, nowIds, litIds, barIds;
    std::map<juce::String, Node> barCmds;      // the bar's buttons, by command
    std::map<juce::String, Node> barMore;      // their ▾
    std::map<juce::String, Node> emptyCmds;    // as they are with nothing open
    void index (const juce::var& tree, std::map<juce::String, Node>& ids, float dy = 0);
    juce::Rectangle<float> laneR, waveR, specR, timeR, levelR, poR, stripR, counterR, sideR, barR;
    juce::Colour ink (const juce::String& token, const juce::String& fallback) const;

    // ── the document, as the Sound module has it ──
    bool open = false;
    juce::String name, meta;
    double frames = 0, sr = 44100, baseFrames = 0;
    bool canUndo = false, canRedo = false, edited = false;
    double clipboard = 0;
    double ratio = 1;
    int64_t serial = -1;
    juce::var annotations;   // {markers, regions}
    juce::var measures;      // the page's own measures (411), or void
    bool measured = false;
    void readSound();

    // ── the page's state (state.* and its kept settings) ──
    double viewFrom = 0, viewTo = 0;
    bool hasSel = false;
    double selA = 0, selB = 0;
    double cue = 0;
    bool loopOn = false;
    juce::String snap = "zero", fadeShape = "equalPower";
    std::map<juce::String, bool> prefs;
    std::map<juce::String, double> params;
    int exportBits = 24;
    double split = 64;       // the spectrogram's share of the lane, as a %
    bool customizing = false;
    double barScroll = 0;
    double poA = 0, poB = 0; // the overview's own zoom, in seconds (equal: the whole)
    void keep();             // hand the state to the module, for the patch
    void restore (const juce::var& ui);

    // ── the transport ──
    double head = 0;
    bool playing = false;
    float meterL = -120, meterR = -120;
    void transport (const juce::var& msg);
    void applyLoop();
    void seek (double frame);
    void play();
    void stop();
    void timerCallback() override;

    // ── what is drawn from the sound ──
    std::vector<float> peaks;      // [ch][min,max,rms][col]
    int peakCols = 0, peakCh = 0;
    double peaksFrom = 0, peaksTo = 0;
    std::vector<float> colours;    // r,g,b a column, or empty
    juce::Image spec;
    std::vector<float> overview;   // the whole sound, 1400 columns (loadOverview)
    int ovCols = 0;
    std::vector<float> ovColours;
    juce::Image waveShot;
    juce::String waveKey;
    void loadPeaks();
    void loadSpectrogram();
    void loadOverview();
    void refit();                  // the whole sound in view

    // ── the drawings ──
    void drawWave (juce::Graphics&);
    void drawSpec (juce::Graphics&);
    void drawTime (juce::Graphics&);
    void drawLevel (juce::Graphics&);
    void drawMarks (juce::Graphics&);
    void drawOverlay (juce::Graphics&);   // selection, cue, playhead, handles, loupe
    void drawCounters (juce::Graphics&);
    void drawMeters (juce::Graphics&);
    void drawOverview (juce::Graphics&);
    void drawNow (juce::Graphics&);
    void drawTabs (juce::Graphics&);
    void writeText (juce::Graphics&, const Node&, const juce::String&, juce::Justification = juce::Justification::centredLeft);

    // ── the bar ──
    bool enabled (const juce::String& cmd) const;
    bool lit (const juce::String& cmd) const;
    juce::String commandAt (juce::Point<float> p, bool* more = nullptr) const;
    void syncBar();
    juce::String titleFor (const juce::String& cmd) const;
    std::unique_ptr<juce::Component> pop;  // the ▾ settings, the pie, ⌘K
    void openKnobs (const juce::String& cmd);
    void openPie (juce::Point<float> at);
    void openCommands();
    juce::String popCmd;

    // ── the commands (310, 300, 412) ──
    juce::var edit (juce::var body, bool snapIt);        // editCmd / editOp
    void afterEdit (const juce::var& body, const juce::var& answer);
    void annot (const juce::var& body);
    void say (const juce::String& s);
    bool needSel();
    std::pair<double, double> selOrCue() const;
    void zoom (double factor);
    void centreOn (double frame);
    void fitSelection();
    void zoomToSample (bool end);
    void setSnap (const juce::String& unit);
    void toggle (const juce::String& pref);
    void exportWav();
    void addMarker();
    void addRegion();
    void setSelectionDialog();
    void goTo();
    void regionsFromHits();
    void findPeak();
    juce::String fmtTime (double sec) const;

    // ── the hands (414) ──
    juce::String live;          // a handle held: "fi", "fo", "g"
    double liveV = 0;
    double loupeAt = -1;
    std::vector<float> loupeSamples, previewMono;
    bool selOn() const { return hasSel && selB - selA >= 64; }
    double fx (double frame) const;  // a frame's x in the lane
    double frameAt (float x) const;

    // ── a gesture under way ──
    enum class Grab { none, lane, edge, scrub, hand, overview, strip, split, barScroll };
    Grab grab = Grab::none;
    juce::Point<float> down;
    double anchor = 0, grabFrom = 0, grabTo = 0, s0 = 0;
    juce::String poGrab;   // the overview: "a", "b", "cue", "pan", "sel", "scrub"
    float moved = 0;
    double handPk = 1, handYPk = 0, handLenMs = 0, handMsPerPx = 0;
};

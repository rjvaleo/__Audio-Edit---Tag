// Grain's face: MGL's Grain page, drawn natively at its own size (1388 x 990).
// ui/app/400-409-grain*, 021, 081, grain-glyphs.js, grain.css.
//
// The frame is the page's own, captured (tools/face-capture/capture-grain.mjs,
// one capture per theme): the page with each of its six engines chosen (each
// has its own panel), the effects view, and every switch lit. The face shows
// the capture of the engine chosen and draws over it, in layers drawn again
// only for what they show, everything that moves: every bar (its fill, its
// reading, its glyph, dimmed when the page dims it, the LFOs' reach on it),
// every switch and choice lit or not, SOURCE (the sound, the read head, the
// grains, the engine's marks, the loop, Start, the regions and markers, the
// voices), AMP, the four LFOs and their scopes, the meters, the dock (the
// wheel, the octave, the keys, Glide, Bend, Mono / Legato / Poly, Run), the
// effects strip, the engine's pictures (407). Every control does what the
// page's does, through the app's Grain calls (na_grain_call), which are MGL's
// routes: /api/edit's stretch, /api/engine/voice, /transport, /lfos, the rack,
// the presets.
#pragma once

#include "Face.h"
#include "FxCard.h"
#include "GrainPictures.h"
#include "na.h"

#include <array>
#include <functional>
#include <map>
#include <memory>
#include <set>
#include <vector>

class GrainFace final : public juce::Component, private juce::Timer
{
public:
    using Call = std::function<int64_t (const std::function<int64_t (NaApp*)>&)>;
    GrainFace (Call, uint32_t id);
    ~GrainFace() override;

    std::function<void (const juce::String&)> onMessage;
    std::function<bool (const juce::MouseEvent&)> blocked;
    // A note from the face's keys (on screen or the computer's).
    std::function<void (int note, float velocity, bool on)> onNote;

    // Read the document and the module's state again (after a load).
    void reload();
    // One step of the clock (for the snapshots and the bench).
    void poll() { timerCallback(); }
    // Set a control as a hand does, and send it (bench and snapshots).
    void setControl (const juce::String& key, double value, bool commit = true);
    double control (const juce::String& key) const { return read (key); }
    juce::String engineName() const { return engine; }
    void chooseEngine (const juce::String& alg);
    void openFx (bool on) { fxView = on; showPage(); }
    juce::Rectangle<float> where (const juce::String& part) const;
    std::vector<std::pair<juce::String, double>> profile (float scale);
    juce::String stateJson() const;
    // Show the page as MGL's capture saw it, with no server behind it: no
    // samples read, no grain schedule (the snapshots against its pictures).
    bool asCaptured = false;
    // Draw the next page's picture (and its layers) once: what the first
    // look at an engine costs (the bench).
    void warm();
    size_t warmed = 0;

    bool keyPressed (const juce::KeyPress&) override;
    bool keyStateChanged (bool isKeyDown) override;
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

    // A control of the page (GS_C).
    struct Ctl
    {
        juce::String k, label, at, key, facet, full;
        double min = 0, max = 1, d = 0;
        bool log = false, bip = false, sw = false, odd = false, moves = false, scaleStep = false;
        double step = 0, detent = -1e9;
        juce::StringArray seg, vals;
    };

private:
    Call call;
    const uint32_t id;
    const juce::var& captured;
    juce::var data, vars;
    std::map<juce::String, std::unique_ptr<face::Chrome>> pages;   // per engine, and "fx"
    std::unique_ptr<face::Chrome> lit;
    face::Chrome* shown = nullptr;
    std::vector<std::unique_ptr<Layer>> layers;
    std::map<juce::String, Layer*> named;
    Layer* addLayer (const juce::String& name, juce::Rectangle<float> r, std::function<void (juce::Graphics&)> draw);
    void repaintLayer (const juce::String& name);
    void buildLayers();
    void showPage();

    struct Node
    {
        int i = -1;
        juce::Rectangle<float> r;
        juce::var n;
    };
    // Each page's nodes by id, its bars by key, its tabs by engine.
    struct Page
    {
        std::map<juce::String, Node> ids;
        std::map<juce::String, Node> bars;
        std::map<juce::String, Node> tabs;
        std::vector<Node> lfoKnobs;
    };
    std::map<juce::String, Page> pageNodes;
    Page litNodes;
    Page& cur();
    const Page& cur() const;
    void index (const juce::var& n, Page& p);
    const juce::var* child (const juce::var& n, const juce::String& cls) const;
    // Looks taken from the captures: a switch on and off, a choice's part on
    // and off, a chip lit, a tile.
    juce::var tgOn, tgOff, segOn, segOff, mapOn, ledOn, ledOff;
    juce::Colour ink (const juce::String& token, const juce::String& fallback) const;

    std::map<juce::String, Ctl> ctls;
    std::vector<juce::String> ctlOrder;

    // ── the document's stretch, as the page's drafts ──
    juce::var draft;          // stretchDraft with its grain object
    juce::var doc;            // the last answer (frames, rate, annotations ...)
    juce::String engine = "wsola";
    double fileFrames = 0, fileRate = 48000, deviceRate = 48000;
    juce::String soundName, fileMeta;
    juce::var annotations;
    int64_t docSerial = -1;
    juce::String docStretch;
    double read (const juce::String& k) const;
    juce::var home (const Ctl& c) const;
    void write (const juce::String& k, double v);
    void setV (const juce::String& k, double v);
    void setN (const juce::String& k, double n);
    void user (const juce::String& k, double v);
    double toN (const Ctl& c, double v) const;
    double fromN (const Ctl& c, double n) const;
    juce::String fmt (const Ctl& c, double v) const;
    bool dimmed (const juce::String& k) const;
    bool cloudActive() const;

    // ── sending: the tray's preview (90 ms) and commit ──
    bool previewDue = false, commitDue = false;
    double lastPreview = 0, commitAt = 0;
    void send (bool live);
    void sendSoon (bool live);
    void postAll (const juce::var& extra = {});
    juce::var grainCall (const char* what, const juce::var& body);
    void readDoc (const juce::var& answer);

    // ── the page's own state ──
    juce::String ab = "A";
    juce::var abs[2];
    juce::var rndPrev;
    bool fxView = false;
    double czA = 0, czB = 0;
    bool loopOn = false, hasSel = false, follow = true;
    juce::String followMode = "scroll";
    double selA = 0, selB = 0, cue = 0;     // frames of the file
    struct Amp { double a = 0.16, d = 0.4, s = 0.78, r = 0.5; } amp;
    struct Lfo
    {
        juce::String shape = "sine", mode = "free";
        double rate = 0.33, depth = 0.45;
        bool sync = false;
        juce::StringArray targets;
    };
    std::array<Lfo, 4> lfo;
    int mapI = -1;
    struct Voice { juce::String mode = "mono"; bool run = false; double glide = 0.3; int bendR = 2; } voice;
    int oct = 0, midiChannel = 2;
    double bend = 0;
    std::map<int, float> held;
    std::map<juce::juce_wchar, int> kbd;
    juce::String velText;
    juce::String presetName, cloudPreset;
    juce::var presets, scales;
    juce::String scaleName;
    double pitchStep = 0;
    void keep();
    void restore (const juce::var& ui);
    juce::var snapshot (bool withRack);
    void restoreSnapshot (const juce::var&);

    // ── the engine, live ──
    juce::var live;            // /api/engine/grains
    juce::var lfoState;        // /api/engine/lfos
    juce::var rack;            // the rack
    juce::var schedule;        // /api/grains: the grain schedule near the head
    double scheduleAt = 0;
    std::vector<float> outL, outR;
    double vuDb = -96, loadWorst = 0;
    bool playing = false;
    double position = 0;       // the deck's, output frames
    double volume = 0.85;
    double lfoAt = 0;
    void timerCallback() override;
    void readLive();
    double head() const;       // seconds of the file
    double fileLen() const { return fileRate > 0 ? fileFrames / fileRate : 1; }
    std::pair<double, double> loopSecs() const;
    std::pair<double, double> cloudView() const;
    double engineFromSrc (double frame) const;
    double srcFromEngine (double pos) const;
    void applyLoop();
    void seekSource (double frame);
    void transport (const juce::var& msg);
    void play();
    void stop();

    // ── the drawings (GrainDraw.cpp) ──
    std::vector<float> peaks;     // min, max, rms of channel 0 over the view
    int peakCols = 0;
    double peaksA = -1, peaksB = -1;
    std::vector<float> ridge;
    juce::Image cloudStatic;
    juce::String cloudKey;
    std::vector<float> mono;      // the document's samples, for the pictures
    gpic::State picState;
    std::vector<gpic::LiveGrain> sounded;
    gpic::Inputs picInputs();
    void loadMono();
    int64_t monoSerial = -2;
    void loadPeaks();
    void drawBar (juce::Graphics&, const juce::String& k);
    void drawGlyph (juce::Graphics&, const juce::String& k, juce::Rectangle<float> r, const juce::String& colour, double v);
    void drawCloud (juce::Graphics&, float w, float h);
    void drawCloudStatic (juce::Graphics&, float w, float h);
    void drawMarks (juce::Graphics&, float w, float h);
    void drawLoop (juce::Graphics&, float w, float h);
    void drawMini (juce::Graphics&, float w, float h);
    void drawAmp (juce::Graphics&, float w, float h);
    void drawLfo (juce::Graphics&, int i, float w, float h);
    void drawLfoRow (juce::Graphics&, int i);
    void drawKnob (juce::Graphics&, const Node&, double u, juce::Colour col, const juce::String& text);
    void drawOutWave (juce::Graphics&, float w, float h);
    void drawMaster (juce::Graphics&, float w, float h);
    void drawLoad (juce::Graphics&, float w, float h);
    void drawWheel (juce::Graphics&, float w, float h);
    void drawGlide (juce::Graphics&, float w, float h);
    void drawKeys (juce::Graphics&, float w, float h);
    void drawHeadPic (juce::Graphics&, float w, float h);
    void drawMapPic (juce::Graphics&, float w, float h);
    void drawLens (juce::Graphics&, float w, float h);
    void drawTexts (juce::Graphics&);
    void drawFxView (juce::Graphics&);
    // The effects view's cards: the FX page's (FxCard), one per rack slot,
    // along the rail where the page has it, scrolled sideways.
    std::vector<std::unique_ptr<FxCard>> fxCards;
    juce::var fxApi;
    int fxDrag = -1;
    float fxScroll = 0;
    juce::String fxCardsFor;
    void syncFxCards();
    juce::Point<float> fxCardAt (int i) const;
    bool fxCardMouse (const juce::MouseEvent&, int kind);
    double sideL = 0.8, sideR = 0.8;      // GS.out: the side faders, unity at 0.8
    double peakL = -120, peakR = -120, vuL = -120, vuR = -120, corr = 0;
    // Which part a layer draws (one of the page's ids); empty: all of them.
    juce::String only;
    juce::Rectangle<float> unionOf (const juce::String& id, bool bar) const;
    void drawSegs (juce::Graphics&);
    void drawStrip (juce::Graphics&);
    void writeText (juce::Graphics&, const Node&, const juce::String&, juce::Justification = juce::Justification::centredLeft);
    void writeChip (juce::Graphics&, const Node&, const juce::String&, juce::Rectangle<float>* outBox = nullptr);
    juce::String fmtS (double s) const;

    // ── the glyphs: each one's SVG, parsed once a value ──
    std::map<juce::String, std::unique_ptr<juce::Drawable>> glyphCache;

    // ── gestures ──
    enum class Grab { none, bar, amp, glide, bend, keys, cloud, loop, knob, paint, master };
    Grab grab = Grab::none;
    juce::String grabKey, loopGrab;
    int grabI = -1, keyDown = -1;
    juce::Point<float> down, last;
    double grabN = 0, grabU = 0, grabS0 = 0, moved = 0;
    std::pair<double, double> grabEnds;
    std::set<juce::String> painted;
    juce::String barAt (juce::Point<float>, bool wellOnly) const;
    juce::String loopGrabAt (float x, float y) const;
    int keyAt (juce::Point<float>) const;
    void note (int n, float vel, bool on);
    void setOct (int o);
    void voicePost (const juce::var& part);
    void voiceSend();
    void lfoSend();
    void lfoChanged();
    juce::var lfoPayload() const;
    juce::String lfoId (const juce::String& k) const;
    juce::String lfoRate (const Lfo&) const;
    void menu (const juce::String& which, juce::Rectangle<float> near);
    void tuneMenu (juce::Rectangle<float> near);
    void presetMenu (juce::Rectangle<float> near);
    void presetStep (int by);
    void savePreset (bool asNew);
    void randomize (bool nudge);
    void switchAB (const juce::String& k);
    void say (const juce::String& s);
};

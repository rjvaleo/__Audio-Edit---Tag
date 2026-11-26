// The FX modules' faces: MGL's FX page (ui/app/425-fx-page.js, the Grain
// page's effects view on its own, 404-grain-rack.js, 057-fx.css) and every
// effect on its own (one card of the rack, FxCard).
//
// The page is drawn at the size it has in RJ's window: MGL's page, 1388 x 990,
// centred over the 1500 wide middle of the window as MGL centres it, and the
// Now Playing bar (its transport) under it: 1500 x 1038. Its frame is the
// page's own capture (tools/face-capture/capture-fx.mjs, every theme): THE
// SOUND, THE PC'S LIBRARY, EFFECTS, the rack, OUT, SPECTRUM, OUTPUT, METERS.
// Over it, live: the strip of slots (FX, each slot's tile with its light and
// picture, ＋), the sound's name and length, the PC's library (read from MGL's
// server, read only), the rack's cards (FxCard, along the rail, scrolled
// sideways) and the ADD card, OUT and SPECTRUM, the faders, the meters, the
// preset bar (Grain's presets' racks, A/B), the Add menu (every module and
// mode), the Now bar's play, stop, loop and clock. Every control is the
// page's, through the module's calls (na_fx_call).
#pragma once

#include "Face.h"
#include "FxCard.h"
#include "na.h"

#include <functional>
#include <map>
#include <memory>
#include <vector>

class FxReverb;

class FxFace final : public juce::Component, private juce::Timer
{
public:
    using Call = std::function<int64_t (const std::function<int64_t (NaApp*)>&)>;
    // `page`: the FX page; otherwise the effect module (one card).
    FxFace (Call, uint32_t id, bool page);
    ~FxFace() override;

    std::function<void (const juce::String&)> onMessage;
    std::function<bool (const juce::MouseEvent&)> blocked;
    // A sound wanted on the Sound socket (a Sound module beside it, cabled),
    // and a library sound to open in it (MGL's library path).
    std::function<void (const juce::String& libraryPath)> wantSound;

    void reload();
    // The PC's library as read (snapshots set it, as capture-fx.mjs does).
    void setPcList (const juce::var& v) { pcList = v; repaint(); }
    void poll() { timerCallback(); }
    juce::var fx (const char* what, const juce::var& body = {});
    // The bench: where a part is ("card:<i>", "card:<i>/<card part>",
    // "tile:<i>", "plus", "add", "addItem:<suite>/<mode>", "fader:<l|lr|r>",
    // "play", "stop", "loop", "pc:<i>", "from:<f>", "ab:<a|b>", "preset");
    // what the last changes marked to be drawn, drawn at `scale`, timed.
    juce::Rectangle<float> where (const juce::String& part) const;
    double paintDirty (float scale);
    const juce::var& info() const { return infoV; }
    FxCard* card (int i) { return i >= 0 && i < (int) cards.size() ? cards[(size_t) i].get() : nullptr; }
    bool pickerOpen() const { return picker.isNotEmpty(); }
    FxReverb* reverbWindow() const { return reverb.get(); }

    void paint (juce::Graphics&) override;
    void mouseDown (const juce::MouseEvent&) override;
    void mouseDrag (const juce::MouseEvent&) override;
    void mouseUp (const juce::MouseEvent&) override;
    void mouseDoubleClick (const juce::MouseEvent&) override;
    void mouseWheelMove (const juce::MouseEvent&, const juce::MouseWheelDetails&) override;

    static constexpr float pageX = 56;   // the page's place in the 1500 wide middle
    static constexpr float nowY = 927;   // the Now bar's top: over the page's foot, as in MGL's window

private:
    Call call;
    const uint32_t id;
    const bool isPage;
    juce::var infoV, api, soundInfo, pcList, presets;
    std::vector<char> buf;
    std::vector<std::unique_ptr<FxCard>> cards;
    std::unique_ptr<face::Chrome> frame, frameOpen, nowFrame;
    juce::Image frameImage;
    juce::String frameSig;
    int stampSeen = -1;
    std::unique_ptr<FxReverb> reverb;

    // ── the page's parts, from its capture ──
    struct N
    {
        juce::Rectangle<float> r;
        juce::var n;
        bool ok() const { return n.isObject(); }
    };
    std::map<juce::String, N> ids;
    std::map<juce::String, juce::var> look;
    void indexPage();
    juce::Rectangle<float> railBox, viewport;
    float scroll = 0;   // the rail scrolled sideways
    int front = 0;

    // ── live ──
    std::vector<float> outL, outR;
    std::vector<float> stagePeaks;
    double peakL = -120, peakR = -120, vuL = -120, vuR = -120, corr = 0;
    double volume = 0.85, sideL = 0.8, sideR = 0.8, position = 0;
    bool playing = false, looping = false;
    juce::String picker;          // the Add menu open: "top" or a suite's label
    juce::String fromFilter = "all", query;
    int pcShown = 40;
    int ticks = 0;
    std::unique_ptr<juce::TextEditor> search;

    void readInfo (const juce::var&);
    void layoutCards();
    float cardX (int i) const;
    void timerCallback() override;
    void say (const juce::String&);
    void send (int slot, const juce::var& msg);
    void loadPc();
    juce::Array<juce::var> pcHits() const;

    // ── drawing ──
    void drawFrame (juce::Graphics&);
    void drawStrip (juce::Graphics&);
    void drawSources (juce::Graphics&);
    void drawRail (juce::Graphics&);
    void drawBottom (juce::Graphics&);
    void drawNow (juce::Graphics&);
    void drawPicker (juce::Graphics&);
    void drawPresetBar (juce::Graphics&);
    void text (juce::Graphics&, const juce::String& id, const juce::String& t, juce::Justification = juce::Justification::centredLeft);
    juce::Point<float> toPage (juce::Point<float> p) const { return { p.x - (isPage ? pageX : 0), p.y }; }

    // ── the hand ──
    int dragCard = -1, dragFrom = -1;
    juce::String dragFader;
    juce::Point<float> downAt;
    double downValue = 0;
    std::vector<std::pair<juce::Rectangle<float>, std::function<void()>>> pickHits;
    std::vector<juce::Rectangle<int>> dirty;
    void mark (juce::Rectangle<float> pageArea);
    void openPicker (const juce::String& which);
    void presetMenu();
};

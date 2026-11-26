// The Reverb window (ui/app/077-fx-reverb-window.js, SUITE-PLAN P4, Network
// Face 3): one fixed 1280 x 640 window of its own, opened from a Reverb
// card's Open. Its frame is the page's own capture (the window on Mesh 16,
// and each mode's band of controls, in the theme worn); over it, live: the
// bar's Family and Mode (each with its network's picture), the class badge,
// the original, On and ×; the mode's network and its overlay (the tone, the
// width, the mix, the glow of the module's output, the pad's mark and its
// captions); the room in 3D with the sound placed in it and its readout;
// the meters; the band's knobs (FxCard on the band's capture) and Place.
// The network is the mode's pad; in the room, drag the sound, Shift-drag it
// up and down, drag elsewhere to turn, double-click to reset. Drawing is
// FxReverbDraw's, ported call for call.
#pragma once

#include "FxCard.h"
#include "FxReverbDraw.h"

#include <juce_gui_basics/juce_gui_basics.h>

class FxFace;

class FxReverb final : private juce::Timer
{
public:
    explicit FxReverb (FxFace&);
    ~FxReverb() override;

    // Open on the rack's slot `slot`, or follow it after the rack changed.
    void open (int slot);
    void changed();
    void close();
    bool isOpen() const;
    juce::Component* view() const;
    int slot() const { return at; }

private:
    class View;
    class Window;
    FxFace& owner;
    int at = -1;
    std::unique_ptr<Window> window;
    void timerCallback() override;
};

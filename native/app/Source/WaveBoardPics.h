// The board's node pictures and knobs (see WaveBoardPics.cpp).
#pragma once

#include "Canvas2D.h"
#include "WaveBoardKit.h"

namespace board
{
// What a frame of pictures shares: the board, the patch, the time, and the
// waves and spectra worked out once a frame (WV_NWAVE).
struct Pics
{
    const juce::var* board = nullptr;
    wave::Model* model = nullptr;
    const wave::Cl* cl = nullptr;
    float t = 0;
    Memo memo;
    std::map<juce::String, wave::Frame> waves;
    std::map<juce::String, std::vector<float>> specs;
    wave::Frame noise {};
    float noiseAt = -1;
    // A node's output peak from the engine (`board` in /api/wave/state).
    float peak (const juce::String& id) const;
    void frame (float now)
    {
        t = now;
        memo.m.clear();
        waves.clear();
        specs.clear();
    }
};

juce::String fxFamily (const juce::var& n);
wave::Frame inputWave (Pics&, const juce::String& kind);
void drawFxPic (c2d::Context&, float w, float h, Pics&, const juce::var& n);
void drawRoutingPic (c2d::Context&, float w, float h, Pics&, const juce::var& n);
void drawIOPic (c2d::Context&, float w, float h, Pics&, const juce::var& n);
void drawNodePic (c2d::Context&, float w, float h, Pics&, const juce::var& n);
// A board knob on a canvas `s` across: its value in its own law, and the rows that move it.
void drawBoardKnob (c2d::Context&, float s, Pics&, const juce::var& n, const juce::var& p);
} // namespace board

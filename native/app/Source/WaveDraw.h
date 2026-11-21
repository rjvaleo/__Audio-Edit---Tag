// The Wave page's drawings, ported from its JavaScript line for line
// (ui/app/390-wave-kit.js, 391b-wave-draw.js, 391c-wave-tiles.js), drawing
// through c2d::Context as the page draws through its canvases.
//
// Each function keeps the page's name without the `wv` prefix and draws on a
// canvas `w` by `h`, the size the page gives that canvas. The model is the
// patch as the page holds it (`WV.p`): every key by its name, numbers 0 to 1
// as the patch stores them.
#pragma once

#include "Canvas2D.h"

#include <array>
#include <functional>
#include <map>
#include <vector>

namespace wave
{
constexpr int NP = 256;
using Frame = std::array<float, NP>;
using Table = std::vector<Frame>;

// The page's colours (`wvCl`), from its tokens.
struct Cl
{
    juce::Colour wave, acc, mod, arc, track, t, t2, t3;
    float br = 205, bg = 225, bb = 255; // the bloom, as the page's "r,g,b"
    float glow = 1.1f;
    juce::Colour bloom (float a) const { return juce::Colour ((juce::uint8) br, (juce::uint8) bg, (juce::uint8) bb, juce::jlimit (0.0f, 1.0f, a)); }
};
Cl colours (const juce::var& vars);
// A source's own colour set (`wvSrcCl`): its colour as the wave and the bloom.
Cl sourceCl (const Cl&, const juce::String& src);
juce::String sourceColour (const juce::String& src);

// The patch as the page holds it, and the tables it draws from.
struct Model
{
    std::map<juce::String, juce::var> p;
    std::function<Table (const juce::String&)> loadTable;
    float tilt[3] = { 0.5f, 0.5f, 0.5f };
    char face[3] = { 'w', 'w', 'w' };

    float g (const juce::String& k, float fallback = 0.0f) const;
    juce::String s (const juce::String& k) const;
    const juce::var& v (const juce::String& k) const;
    const Table& table (const juce::String& name);

private:
    std::map<juce::String, Table> tables;
};

// The kit.
float clamp (float v, float a = 0.0f, float b = 1.0f);
float rd (const Frame& a, float x);
Frame frameAt (const Table&, float p);
Frame warp (const Frame& a, const juce::String& mode, float w, const Frame* mod = nullptr);
Frame ofxShape (const Frame& f, const juce::String& m, float a, float b);
std::vector<float> mags (const Frame& a, int K = 48);
float lfoVal (const Model&, int L, float u, int cyc = 0);
juce::String lfoShape (const Model&, int L);
juce::String lfoRateTxt (const Model&, int L);
juce::String fmtHz (float f);
juce::String fmtMs (float s);
juce::String fmtC (float s);
juce::Colour fxCol (const juce::String& k, float l = 68, float a = 1);
juce::String ofxName (const juce::String& k);

c2d::Path path (const std::function<juce::Point<float> (float)>& fn, int n);
void trace (c2d::Context&, const c2d::Path&, const Cl&, float lw = 1.6f, float g = 1.0f);
void under (c2d::Context&, const c2d::Path&, float x0, float x1, float base, float top, const Cl&, float a = 0.2f);
void dot (c2d::Context&, float x, float y, float r, juce::Colour);

// The shared knob's ring (`uiKnobPaint`), on a canvas `size` across.
void ring (c2d::Context&, float size, float u, const Cl&, bool bip = false, bool pointer = false);

// The drawings.
Frame waveFor (Model&, int i, bool dry);
void draw3D (c2d::Context&, float w, float h, const Cl&, const Table&, float p, const juce::String& warpMode, float warpAmt, float rise, float depth, bool floor);
void drawSpec3D (c2d::Context&, float w, float h, const Cl&, const Table&, float p, const juce::String& warpMode, float warpAmt, float rise, float depth);
void drawStrip (c2d::Context&, float w, float h, const Cl&, const Table&, float p);
void drawFace (c2d::Context&, float w, float h, const Cl&, float v, const Frame& wave, const Frame* ghost, bool empty);
void drawControlPic (c2d::Context&, float w, float h, const Cl&, float u, const juce::String& key);
void drawKnob (c2d::Context&, float w, float h, const Cl&, float v, const juce::String& key, bool bip);
void drawUniFace (c2d::Context&, float w, float h, const Cl&, const Frame& cur, int n, float det, float spr);
void drawHBar (c2d::Context&, float w, float h, const Cl&, float v);
void drawRuler (c2d::Context&, float w, float h, const Cl&, int semi, int cents);
void drawPhase (c2d::Context&, float w, float h, const Cl&, float ph, const Frame& cur);
void drawPick (c2d::Context&, float w, float h, const Cl&, const Table&);
void drawLens (c2d::Context&, float w, float h, const Cl&, const Model&, const Frame& cur, int i);
juce::String drawOfx (c2d::Context&, float w, float h, const Cl&, Model&, int i, float t);

struct EnvPts
{
    juce::Point<float> o, a, d, s, r;
};
EnvPts envPts (float w, float h, float A, float D, float S, float R);
void drawEnv (c2d::Context&, float w, float h, const Cl&, float A, float D, float S, float R);
void drawLfo (c2d::Context&, float w, float h, const Cl&, const Model&, int L);
} // namespace wave

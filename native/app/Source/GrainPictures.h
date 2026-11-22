// The Grain page's engine pictures, ported from its JavaScript line for line
// (ui/app/407-grain-pictures.js, with the helpers it draws with from
// 390-wave-kit.js, 400-grain-kit.js, 401-grain-views.js, 405-grain-keys.js and
// 020-audio.js), drawing through c2d::Context as the page draws through its
// canvases.
//
// What the page reads from its globals (`state`, `GS`, `GS_N`, `engine`, the
// poll's answers in `GS_PIC`) comes in as `Inputs`; what the page keeps in
// `GS_PIC` between frames (the analysis of the samples, the bands under the
// head, Freeze's held frame, Hybrid's separation) is kept in `State`.
//
// Each function draws on a canvas `w` by `h`, the size the page gives that
// canvas (`gsHeadPic`, `gsMapPic`, `gsLens`, and the FX pane's two).
#pragma once

#include "Canvas2D.h"

#include <cstddef>
#include <cstdint>
#include <functional>
#include <optional>
#include <string>
#include <vector>

namespace gpic
{
constexpr int NFFT = 1024;     // GS_NFFT
constexpr int NB = 128;        // GS_NB
constexpr int PCM_COLS = 812;  // GS_PCM_COLS
constexpr double PCM_MAX_S = 600; // GS_PCM_MAX_S

// The page's colours (`gsCl`), as its tokens give them: CSS strings, the bloom
// as "r,g,b" (it goes into `rgba(${bloom},a)`), the glow a number.
struct Cl
{
    juce::String wave = "#fff", bloom = "205,225,255", acc = "#7cf0d0", on = "#ffb547", track = "#2a2e34";
    juce::String t = "#e8eaee", t2 = "#b9bec6", t3 = "#858b94";
    double glow = 1.1;
    juce::String mono = "monospace", sans = "sans-serif";
};

// One Poly voice's head, as the poll's `heads` say (`gsPolyHeads`).
struct VoiceHead
{
    int key = 60;    // the MIDI key
    double src = 0;  // where it reads, seconds of the sound
    double env = 1;  // its envelope, 0 to 1
};

// A grain that has sounded (`GS_PIC.ev`): stamped on the same clock as `now`.
struct LiveGrain
{
    double at = 0;    // when it sounded, seconds on the `now` clock
    double src = 0;   // where it read, seconds of the sound
    double size = 0;  // its length, seconds
    double semis = 0; // its pitch, semitones
    int voice = 0;
};

// A row of the engine's plan (`state.grains.grains`), in frames at `sampleRate`.
struct PlannedGrain
{
    double outFrame = 0, srcFrame = 0, size = 0, semis = 0, level = 0, brightness = 0, pan = 0, index = 0;
};

struct Inputs
{
    // The document's mono samples at the file's rate (`/audio?dry=1` decoded and
    // mixed down, as gsPcmLoad makes them). May be empty: the pictures then
    // draw `note`, as the page does with no PCM.
    const float* samples = nullptr;
    size_t count = 0;
    double rate = 0;
    // Bump to have the analysis made again when the samples change in place
    // (a new pointer, count or rate does it on its own).
    uint64_t serial = 0;
    // GS_PIC.note: what is said while there are no samples: "Reading the
    // sound…", "Could not read the sound". Empty says "Open a sound". A
    // sound over PCM_MAX_S says "Over 10 minutes: not analysed" on its own.
    juce::String note;

    // The open sound (`gsFile()`): whether there is one, its length in seconds
    // and its rate.
    bool hasFile = false;
    double fileLen = 0;
    double fileRate = 0;

    // GS.engine: "wsola", "vocoder", "pvsola", "hybrid", "granular", "soundhack".
    std::string engine = "wsola";
    // gsRead: any control by its GS_C key, as the bar shows it (a number, 0 or
    // 1 for a switch, an index for a choice).
    std::function<double (const std::string&)> read;

    // gsHead(): where the pictures read, seconds of the sound.
    double head = 0;
    // gsHeadLive(): the transport is playing, a note is held, or Poly has heads.
    bool headLive = false;
    // gsNoteHead() != null: a held Mono or Legato note is reading.
    bool noteHead = false;
    // gsPolyHeads(): Poly's heads, oldest first.
    std::vector<VoiceHead> heads;
    // GS_PIC.key: the newest key down, if any has been.
    std::optional<int> lastKey;
    // GS_PIC.keys?.pitch: the last poll's keys and the note's pitch in
    // semitones; absent when the poll said no keys.
    std::optional<double> keysPitch;
    // GS_N.bend (-1 to 1) and GS.voice.bendR (semitones).
    double bend = 0;
    double bendRange = 2;
    // GS.voice.run and state.loopOn.
    bool run = false;
    bool loopOn = false;

    // gsCue() and gsLoop(), seconds of the sound.
    double cue = 0;
    double loopA = 0, loopB = 1;

    // The clock, seconds: now (performance.now() / 1000) and when the key went
    // down or the transport started (GS_PIC.t0 / 1000).
    double now = 0;
    double keyDownAt = 0;

    // The page's colours.
    Cl cl;

    // What has sounded (GS_PIC.ev), oldest first, and the engine's plan
    // (state.grains: its rows, its sampleRate, 0 for none, and its total).
    std::vector<LiveGrain> sounded;
    std::vector<PlannedGrain> plan;
    double planRate = 0;
    double planTotal = 0;

    // For engineFromSrc: timeRatio(), state.view.sampleRate (0 for none) and
    // engine.deviceRate (0 for none).
    double timeRatio = 1;
    double viewRate = 0;
    double deviceRate = 0;
};

// The FX pane's meters (`m`): before the chain (`m.pre`) and after it; an
// empty one is absent. lissajous is x,y pairs; spectrum is dB per band.
struct FxMeters
{
    std::vector<float> preLissajous, lissajous;
    std::vector<float> preSpectrum, spectrum;
};

// What gsAnalyse works out from the samples (GS_PIC.pcm).
struct Pcm
{
    const float* data = nullptr;
    size_t n = 0;
    double sr = 0, len = 0;
    std::vector<int> k0, k1;
    double peak = 0.001, top = 1e-12;
    struct Onset
    {
        double t, s, l;
    };
    std::vector<Onset> on;
    double med = 0.01;
    double at (long long i) const; // d[i] || 0
};

// Hybrid's split (GS_PIC.sep).
struct Sep
{
    int gen = -1;
    std::vector<double> key;
    double head = 0, start = 0, hop = 0;
    int C = 0;
    std::vector<float> lanes[3];
    double top = 0, span = 0;
};

// The caches GS_PIC keeps.
struct State
{
    // the samples the analysis is of
    const float* src = nullptr;
    size_t srcN = 0;
    double srcRate = 0;
    uint64_t srcSerial = 0;
    bool analysed = false;
    int gen = 0; // bumped at each analysis: GS_PIC.pcm's identity
    Pcm pcm;

    // a frame's bands while the head stays on the same sample
    std::vector<float> bands = std::vector<float> (NB, 0.0f);
    long long bandsAt = -1;
    int bandsGen = -1;
    // Freeze's held frame
    std::optional<std::vector<float>> held;
    std::optional<Sep> sep;

    // the transform's scratch
    std::vector<double> re = std::vector<double> (NFFT, 0.0), im = std::vector<double> (NFFT, 0.0);

    // GS_PIC.drawn
    int drawnHead = 0, drawnMap = 0, drawnLens = 0;
};

// The analysis for these inputs, made once per sound (gsPcmLoad + gsPicTake);
// null when there are no samples, or the sound is over PCM_MAX_S.
const Pcm* pcmFor (const Inputs&, State&);
// What is said with no samples (GS_PIC.note).
juce::String noteFor (const Inputs&);

// The pictures.
void headPic (c2d::Context&, float w, float h, const Inputs&, State&);  // gsDrawHeadPic
void mapPic (c2d::Context&, float w, float h, const Inputs&, State&);   // gsDrawMapPic
void lens (c2d::Context&, float w, float h, const Inputs&, State&);     // gsDrawLens
void fxWave (c2d::Context&, float w, float h, const Inputs&, State&, const FxMeters&);     // gsDrawFxWave
void fxSpectrum (c2d::Context&, float w, float h, const Inputs&, State&, const FxMeters&); // gsDrawFxSpectrum

// The heads on the overview and the detail.
// gsDrawVoiceHeads: one per Poly note; X maps seconds to x; within, if given,
// says which to draw.
void drawVoiceHeads (c2d::Context&, const std::function<float (double)>& X, float top, float bot, float labelY, float step,
                     const Inputs&, const std::function<bool (double)>& within = {});
// gsDrawNoteHead: a held note's line and its key.
void drawNoteHead (c2d::Context&, float x, float top, float bot, float labelY, const Inputs&);

// The labels and names.
struct HeadLabel
{
    float x;
    juce::String t, col;
};
void headLabels (c2d::Context&, std::vector<HeadLabel> heads, float y0, float step);                  // gsHeadLabels
void picLabel (c2d::Context&, float w, const Cl&, const juce::String& left, const juce::String& right = {}); // gsPicLabel
void picNote (c2d::Context&, float h, const Cl&, const juce::String& note);                          // gsPicNote
void lbl (c2d::Context&, const juce::String& tx, float x, float y, const juce::String& col,
          const juce::String& bg = "rgba(5,6,9,.78)", const juce::String& al = "left"); // gsLbl
juce::String keyName (int n);     // gsKeyName
juce::String noteName (double f); // gsNoteName
juce::String lensLabel (const Inputs&); // gsLensLabel
juce::String voiceCol (int key, double a = 1); // gsVoiceCol

// The analysis (exposed for checks).
Pcm analyse (const float* data, size_t n, double sr, State&);                     // gsAnalyse
void power (const Pcm&, long long at, float* out, State&);                       // gsPower
void bandsInto (const Pcm&, long long at, float* out, State&);                   // gsBandsInto
const std::vector<float>& headBands (const Pcm&, double head, State&);           // gsHeadBands
const Sep& separate (const Pcm&, double head, const Inputs&, State&);            // gsSeparate

// The page's number formats, as JavaScript writes them.
juce::String toFixed (double v, int digits); // Number.prototype.toFixed
double jsRound (double v);                   // Math.round
juce::String fmtS (double s);                // gsFmtS
} // namespace gpic

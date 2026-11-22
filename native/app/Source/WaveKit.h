// What every one of Wave's views knows about modulation, ported from the
// page's kit (ui/app/390-wave-kit.js, 393-wave-matrix.js, 391-wave-play.js):
// the sources, the targets in their groups, how a row's amount reads, what
// the engine says a target and a source are doing now.
#pragma once

#include "WaveDraw.h"

namespace wave
{
struct Source
{
    juce::String key, label, kind;   // kind: env lfo perf macro
    bool g0 = false;                 // starts a group (a line above it)
};
// WV_SOURCES: ENV 2-4, LFO 1-4, the playing hand, the macros.
const std::vector<Source>& sources();
const Source* sourceOf (const juce::String& key);
// `ENV 2`, `M3`; `AMP` for the amp envelope.
juce::String srcLab (const juce::String& src);
// `Mod wheel`, a macro's own name.
juce::String srcName (const Model&, const juce::String& src);
// A source drawn small (`wvSrcGlyph`): an SVG path in a w x h box.
juce::String srcGlyph (const Model&, const juce::String& src, float w = 14, float h = 9);

struct TargetGroup
{
    juce::String g, c;
    struct Key
    {
        juce::String key, shortName, full;
    };
    std::vector<Key> ks;
};
// wvTargetGroups: every target, in the groups the pins' bands show.
std::vector<TargetGroup> targetGroups (const Model&);
juce::String targetName (const Model&, const juce::String& t);
juce::String boardDstName (const Model&, const juce::String& d, bool shortName = false);
// A board control's label, by its node and key (set by the FX view from the effects list).
std::function<juce::String (const juce::var& node, const juce::String& key)>& boardParamLabel();
// A board node's name as the page writes it (the rack's, the effect's, a routing node's).
std::function<juce::String (const juce::var& node)>& boardNodeName();

// A choice key's options in order, as the engine steps through them (empty
// for a number key), and one option's share of an amount.
juce::StringArray choiceOpts (const Model&, const juce::String& k);
float choiceStep (const Model&, const juce::String& k);
juce::String amtTxt (float a);
juce::String rowAmtTxt (const Model&, const Model::Mod&);
float snapAmt (const Model&, const juce::String& k, float a);
float curveAt (const juce::String& k, float x);
const juce::StringArray& curves();

// wvModOf: how far the rows can move a target either way, the engine's value
// for it now (when it sends one), the first source's colour.
ModOf modOf (const Model&, const juce::String& dst);
// A choice key's option now: the engine's, stepped by its rows, or the stored one.
juce::String choiceNow (const Model&, const juce::String& k);
// A source's signal now (-1..1 for an LFO, 0..1 else), from the telemetry.
float srcVal (const Model&, const juce::String& src);
// The engine's voices: note, velocity, envelope level, stage letter.
struct Voice
{
    int note = 60;
    float vel = 0, env = 0;
    char stage = 's';
};
std::vector<Voice> voices (const Model&);
// An LFO's phase now, or -1.
float lfoPhase (const Model&, int L);

// The page's glyphs: a warp's (WV_WARPS g) and an oscillator effect's (WV_OFX g), as SVG paths.
juce::String warpGlyph (const juce::String& mode);
juce::String ofxGlyphPath (const juce::String& fx);

// The rows as the engine takes them, and back.
juce::var modsOut (const Model&);
void modsIn (Model&, const juce::var& rows);
} // namespace wave

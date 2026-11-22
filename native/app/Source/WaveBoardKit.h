// The FX board's model, ported from the page (ui/app/395-wave-board.js,
// 397b-wave-chain.js): what a node is called, its controls and their laws,
// its ports, what the cables carry, the main path, the edits. The board is
// held as the engine stores it ({name, nodes: [{id, kind, x, y, on, params}],
// cables: [{from: [id, port], to: [id, port]}]}), as a juce::var.
#pragma once

#include "WaveKit.h"

#include <set>

namespace board
{
// The page's own tables (capture-wave.mjs, wave-board-data.json.gz), the
// board's effects (`/api/wave/fx`) and the rack's suites (na_fx_kinds).
struct Kit
{
    juce::var data;          // { face, routing, kindParams, inputs, abbr, catHue, catOrder, grid }
    juce::var fx;            // [{kind, label, category, suite, params, sound?}]
    juce::var rack;          // { suites: [{id, label, families: [{label, modes: [{kind, label, id}]}]}] }
    std::map<juce::String, juce::var> byKind;
    std::map<juce::String, juce::String> rackLabel;   // kernel -> the rack's name for it
    static Kit& get();
    void setFx (const juce::var& list);
};

const juce::var* node (const juce::var& b, const juce::String& id);
bool isIO (const juce::var& n);
bool isFx (const juce::var& n);
juce::String cat (const juce::var& n);
juce::String name (const juce::var& n);
juce::String maker (const juce::var& n);
juce::String catName (const juce::String& c);
juce::Colour catCol (const juce::String& c, float l = 62, float a = 1);
juce::String catRGB (const juce::String& c, float l = 74);
juce::Colour nodeCol (const juce::var& n, const wave::Cl&);
// The rack family's colour for a mode's kind (fxFamilyColour, by its name).
juce::Colour familyColour (const juce::String& kind);

// Every control a node has, as the engine describes it.
juce::Array<juce::var> spec (const juce::var& n);
const juce::var* paramOf (const juce::var& n, const juce::String& key, juce::Array<juce::var>* keep = nullptr);
juce::Array<juce::var> facePr (const juce::var& n);
float pn (const juce::var& p, float v);
float pv (const juce::var& p, float u);
bool pbip (const juce::var& p);
float pval (const juce::var& n, const juce::var& p);
juce::String fmtP (const juce::var& p, float v, bool compact = false);
juce::String fitLab (const juce::String& l, float wd, const juce::Font&);

int portCount (const juce::var& n);
juce::StringArray inPorts (const juce::var& n);
juce::StringArray outPorts (const juce::var& n);
juce::StringArray deps (const juce::var& n, const juce::String& op);
juce::String mainIn (const juce::var& n);
juce::String mainOut (const juce::var& n);
juce::String portName (const juce::var& n, const juce::String& p);
float nodeW (const juce::var& n);
float nodeH (const juce::var& n);
float pinY (const juce::var& n, const juce::String& port);
juce::Point<float> pinXY (const juce::var& n, const juce::String& port, bool out);

// What reaches an out: the set of input kinds behind it.
using Origins = std::set<juce::String>;
struct Memo
{
    std::map<juce::String, Origins> m;
};
Origins origins (const juce::var& b, const wave::Model&, const juce::String& nid, const juce::String& op, Memo&);
Origins inOrigins (const juce::var& b, const wave::Model&, const juce::var& n, Memo&);
juce::Colour originCol (const Origins&, bool& any);
juce::Colour inputColour (const juce::String& kind);
juce::String inputName (const juce::String& kind);
juce::String inputAbout (const juce::String& kind);
bool inputLive (const wave::Model&, const juce::String& kind);
bool reaches (const juce::var& b, const juce::String& nid, const juce::String& ip, const juce::String& tid, const juce::String& top, std::set<juce::String>& seen);

// The main path, Voice to Out.
struct Step
{
    juce::String id, inP, outP;
};
std::vector<Step> mainPath (const juce::var& b, bool& ok);

// The effect chain as the right dock and Play's row show it (wvChainLayout): only effects, in order.
juce::StringArray chainIds (const juce::var& b);

juce::String cabPath (float x1, float y1, float x2, float y2, juce::Path& out);
} // namespace board

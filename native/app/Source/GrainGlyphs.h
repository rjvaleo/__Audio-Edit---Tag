// The Grain page's glyphs: MGL's `ui/grain-glyphs.js`, line for line.
//
// A small picture beside each grain control, drawn from the control's value
// (and, for the five that move, the time in seconds): the inner SVG markup of a
// 64 x 48 viewBox, character for character what the page's `GG_DRAW[key](v, t)`
// returns. Numbers are written as JS writes them (`toFixed` and
// `Number.prototype.toString`), so the strings match the page's exactly;
// `native/tools/face-capture/glyph-test.cpp` checks them against references
// recorded from the JS (`glyph-refs.mjs`).
//
// Plain C++17 and the standard library only. Nothing keeps state.

#pragma once

#include <string>
#include <utility>
#include <vector>

namespace gg
{
/// The glyph's markup: `GG_DRAW[key](v, t)`; empty for a key without one.
/// `t` is only read by the keys that move (`moves`); pass 0 for the still
/// picture.
std::string draw (const std::string& key, double v, double t = 0.0);

/// An engine tab's picture: `GG_ENGINE[alg]()`; empty for an unknown engine.
std::string engine (const std::string& alg);

/// Whether `key` has a glyph (`ggHas`).
bool has (const std::string& key);

/// Whether the glyph moves with time (`GG_MOVES`).
bool moves (const std::string& key);

/// What the control does to the sound (`GG_FACET`): time, pitch, tone,
/// attack, space or level; "time" for a key it does not name.
std::string facet (const std::string& key);

/// The colour group the glyph is drawn in (`GG_GROUP`): time, shape, pitch or
/// scan; empty for a key it does not name.
std::string group (const std::string& key);

/// Every key of `GG_DRAW`, in the page's order.
const std::vector<std::string>& keys();

/// Every engine of `GG_ENGINE`, in the page's order.
const std::vector<std::string>& engines();

/// The keys that move (`GG_MOVES`), in the page's order.
const std::vector<std::string>& movingKeys();

/// The facets and their names (`GG_FACETS`), in the page's order.
const std::vector<std::pair<std::string, std::string>>& facets();

/// The splice's choices, by the number their glyph is drawn from
/// (`GG_PICK`, `GG_SHAPE`).
const std::vector<std::string>& pick();
const std::vector<std::string>& shape();

/// JS's number formatting, as the glyphs use it: `x.toFixed(digits)` and
/// `String(x)`.
std::string toFixed (double x, int digits);
std::string jsString (double x);
} // namespace gg

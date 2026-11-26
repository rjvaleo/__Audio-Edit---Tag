// The effect cards' check: every picture, display, ring and reading the native
// port (`native/app/Source/FxPictures.cpp`) draws, against the string MGL's JS
// drew for the same inputs, recorded by `fxp-refs.mjs`.
//
//   OUT=<scratch>; J=<JUCE>; S=native/app/Source
//   node native/tools/face-capture/fxp-refs.mjs $OUT/fxp-refs.json
//   D="-DJUCE_GLOBAL_MODULE_SETTINGS_INCLUDED=1 -DJUCE_STANDALONE_APPLICATION=1 -DNDEBUG=1"
//   clang++ -std=c++17 -O1 -x objective-c++ $D -I$J/modules -c $J/modules/juce_core/juce_core.mm -o $OUT/juce_core.o
//   clang++ -std=c++17 -O1 $D -I$J/modules -c $J/modules/juce_core/juce_core_CompilationTime.cpp -o $OUT/juce_ct.o
//   clang++ -std=c++17 -O1 $D -I$J/modules -I$S native/tools/face-capture/fxp-test.cpp $S/FxPictures.cpp $S/GrainGlyphs.cpp \
//       $OUT/juce_core.o $OUT/juce_ct.o -lz -framework Foundation -framework Cocoa -framework IOKit -framework Security -o $OUT/fxp-test
//   $OUT/fxp-test $OUT/fxp-refs.json
//
// Prints the count of exact matches in each part and the first few cases that
// differ; exits 1 on any difference. Against juce_core only (juce::var, JSON).
//
// Last run (25 Nov 2026, node 24.18, macOS arm64): 108013 / 108013 exact.
// Math.log and Math.log10 are V8's fdlibm in the port (the C library's
// differed in the last bit, which showed where a value is written in full:
// the DC display's line, the maximizer's meter, fxUnit); Math.sin, cos, exp,
// pow, tanh, atan, atan2 and asin are the C library's and matched V8 on every
// case here, but could differ in a last bit on others.
//
// The references write every number below 1 in exponent form: juce::JSON
// counts the zeros after a decimal point among the 18 digits it keeps, and
// cut the ends off small numbers written out in full. It reads no subnormal
// either, so Math.log's subnormal path is checked only down to 1e-300.

#include "FxPictures.h"
#include "GrainGlyphs.h"

#include <cmath>
#include <cstdio>
#include <optional>
#include <set>
#include <map>
#include <string>
#include <vector>

namespace
{
using juce::var;
using S = std::string;

struct Part
{
    int ok = 0, all = 0;
    std::vector<S> bad;
};
std::map<S, Part> parts;

S str (const var& v) { return v.isVoid() || v.isUndefined() ? S() : v.toString().toStdString(); }
var at (const var& o, const char* k) { return o.getProperty (k, var()); }
double num (const var& v) { return (double) v; }
bool isNull (const var& v) { return v.isVoid() || v.isUndefined(); }

void check (const S& part, const S& got, const S& want, const S& what)
{
    auto& p = parts[part];
    ++p.all;
    if (got == want)
    {
        ++p.ok;
        return;
    }
    if (p.bad.size() < 3)
    {
        size_t i = 0;
        while (i < got.size() && i < want.size() && got[i] == want[i]) ++i;
        const size_t from = i > 40 ? i - 40 : 0;
        p.bad.push_back (what + "\n      at " + std::to_string (i) + "\n      got:  ..." + got.substr (from, 120) + "\n      want: ..." + want.substr (from, 120));
    }
}
S n2s (double v) { return gg::jsString (v); }
void checkNum (const S& part, double got, double want, const S& what)
{
    const bool same = (std::isnan (got) && std::isnan (want)) || got == want;
    check (part, same ? S ("=") : n2s (got), same ? S ("=") : n2s (want), what);
}

fxp::Values values (const var& o)
{
    fxp::Values v;
    if (auto* d = o.getDynamicObject())
        for (const auto& p : d->getProperties())
            if (p.value.isInt() || p.value.isInt64() || p.value.isDouble() || p.value.isBool()) v[p.name.toString().toStdString()] = (double) p.value;
    return v;
}
fxp::Spec spec (const var& p) { return fxp::Spec::fromVar (p); }
std::optional<double> optNum (const var& v)
{
    if (isNull (v)) return std::nullopt;
    return (double) v;
}
S meterStr (const fxp::Meter& m) { return m.h + "|" + m.text; }
S meterWant (const var& m) { return str (at (m, "h")) + "|" + str (at (m, "text")); }
} // namespace

int main (int argc, char** argv)
{
    if (argc < 2)
    {
        std::fprintf (stderr, "usage: fxp-test refs.json\n");
        return 2;
    }
    const var refs = juce::JSON::parse (juce::File (juce::String (argv[1])));
    const var api = at (refs, "api");
    auto* cases = at (refs, "cases").getArray();
    if (cases == nullptr)
    {
        std::fprintf (stderr, "no cases\n");
        return 2;
    }
    // The lists.
    {
        S want, got;
        for (const auto& k : *at (refs, "picNames").getArray()) want += str (k) + ",";
        for (const auto& k : fxp::picNames()) got += k + ",";
        check ("lists", got, want, "picNames");
        want.clear(), got.clear();
        for (const auto& k : *at (refs, "heroKeys").getArray()) want += str (k) + ",";
        for (const auto& k : fxp::heroKeys()) got += k + ",";
        check ("lists", got, want, "heroKeys");
    }
    for (const auto& c : *cases)
    {
        const S cat = str (at (c, "cat"));
        const var p = at (c, "p");
        if (cat == "picFor")
            check (cat, fxp::picFor (spec (p)), str (at (c, "out")), str (at (p, "key")) + " / " + str (at (p, "label")));
        else if (cat == "pic")
        {
            const auto sp = spec (p);
            check (cat, fxp::pic (str (at (c, "name")), num (at (c, "n")), num (at (c, "v")), isNull (p) ? nullptr : &sp), str (at (c, "out")),
                   str (at (c, "name")) + " n=" + n2s (num (at (c, "n"))) + " v=" + n2s (num (at (c, "v"))) + " p=" + str (at (p, "key")));
        }
        else if (cat == "log")
        {
            const double v = num (at (c, "v"));
            checkNum ("Math.log", fxp::jsLog (v), num (at (c, "log")), n2s (v));
            checkNum ("Math.log10", fxp::jsLog10 (v), num (at (c, "log10")), n2s (v));
        }
        else if (cat == "N")
            check (cat, fxp::N (num (at (c, "v"))), str (at (c, "out")), n2s (num (at (c, "v"))));
        else if (cat == "noText")
            check (cat, fxp::noText (str (at (c, "s"))), str (at (c, "out")), str (at (c, "s")).substr (0, 30));
        else if (cat == "svg")
            check (cat, fxp::svg (str (at (c, "inner")), str (at (c, "cls"))), str (at (c, "out")), "svg");
        else if (cat == "heroFor")
            check (cat, fxp::heroFor (str (at (c, "kind"))), str (at (c, "out")), str (at (c, "kind")));
        else if (cat == "hero")
            check (cat, fxp::hero (str (at (c, "key")), values (at (c, "v"))), str (at (c, "out")), str (at (c, "key")) + " " + juce::JSON::toString (at (c, "v"), true).toStdString().substr (0, 200));
        else if (cat == "model")
        {
            const auto m = fxp::fxModel (at (c, "slot"), at (c, "shaper"));
            S keys;
            for (const auto& s : m.specs) keys += s.key + ",";
            S want;
            for (const auto& k : *at (c, "keys").getArray()) want += str (k) + ",";
            check (cat, keys, want, str (at (at (c, "slot"), "kind")) + " keys");
            const auto wv = values (at (c, "values"));
            S a, b;
            for (const auto& [k, v] : m.values) a += k + "=" + n2s (v) + ",";
            for (const auto& [k, v] : wv) b += k + "=" + n2s (v) + ",";
            check (cat, a, b, str (at (at (c, "slot"), "kind")) + " values");
        }
        else if (cat == "deck")
        {
            const auto m = fxp::fxModel (at (c, "slot"), at (c, "shaper"));
            std::set<S> keys;
            for (const auto& s : m.specs) keys.insert (s.key);
            const auto panel = fxp::fxPanelOf (at (c, "shaper"), at (c, "twin"), keys);
            check (cat, fxp::fxDeckDisplay (m, panel), str (at (c, "out")), str (at (at (c, "slot"), "kind")) + " " + juce::JSON::toString (at (at (c, "slot"), "params"), true).toStdString().substr (0, 200));
        }
        else if (cat == "padMark")
            check (cat, fxp::padMark (num (at (c, "u")), num (at (c, "w")), str (at (c, "xl")), str (at (c, "yl"))), str (at (c, "out")), "padMark");
        else if (cat == "display")
            check (cat, fxp::display (str (at (c, "inner")), (bool) at (c, "fill")), str (at (c, "out")), "display");
        else if (cat == "rbj")
            checkNum (cat, fxp::rbjDb ((int) at (c, "type"), num (at (c, "f0")), num (at (c, "q")), num (at (c, "g")), num (at (c, "f"))), num (at (c, "out")),
                      "type " + str (at (c, "type")) + " f " + n2s (num (at (c, "f"))) + " f0 " + n2s (num (at (c, "f0"))));
        else if (cat == "spec")
        {
            const auto s = spec (p);
            check (cat, S (fxp::fxIsSwitch (s) ? "1" : "0") + (fxp::fxIsLog (s) ? "1" : "0"), S ((bool) at (c, "isSwitch") ? "1" : "0") + ((bool) at (c, "isLog") ? "1" : "0"), s.key);
        }
        else if (cat == "format")
        {
            const auto s = spec (p);
            const double v = num (at (c, "v"));
            const S what = s.key + " v=" + n2s (v);
            check ("fxFormat", fxp::fxFormat (s, v), str (at (c, "fxFormat")), what);
            check ("fxValueFormat", fxp::fxValueFormat (s, v), str (at (c, "fxValueFormat")), what);
            checkNum ("fxClamp", fxp::fxClamp (s, v), num (at (c, "clamp")), what);
        }
        else if (cat == "unit")
        {
            const auto s = spec (p);
            const double v = num (at (c, "v"));
            const auto r = fxp::fxRange ({}, "x", s);
            const S what = s.key + " v=" + n2s (v);
            checkNum ("fxUnit", fxp::fxUnit (r, v), num (at (c, "unit")), what);
            checkNum ("fxFromUnit", fxp::fxFromUnit (r, fxp::fxUnit (r, v)), num (at (c, "from")), what);
            checkNum ("automationUnit", fxp::automationUnit (v, s.min, s.max, fxp::fxIsLog (s)), num (at (c, "auto")), what);
            checkNum ("unitValue", fxp::unitValue (0.42, s.min, s.max, fxp::fxIsLog (s)), num (at (c, "uv")), what);
        }
        else if (cat == "fitLabel")
            check (cat, fxp::fitLabel (str (at (c, "s"))), str (at (c, "out")), str (at (c, "s")));
        else if (cat == "short")
            check (cat, fxp::fxShort (str (at (c, "label")), str (at (c, "group"))), str (at (c, "out")), str (at (c, "label")) + " / " + str (at (c, "group")));
        else if (cat == "roles")
        {
            std::vector<fxp::Spec> ss;
            for (const auto& q : *at (c, "specs").getArray()) ss.push_back (spec (q));
            S got, want;
            for (const auto& g : fxp::fxRoleGroups (ss))
            {
                got += g.label + ":";
                for (const auto& k : g.keys) got += k + ",";
                got += ";";
            }
            for (const auto& g : *at (c, "out").getArray())
            {
                want += str (at (g, "label")) + ":";
                for (const auto& k : *at (g, "keys").getArray()) want += str (k) + ",";
                want += ";";
            }
            check (cat, got, want, "roles");
        }
        else if (cat == "colour")
            check (cat, fxp::fxFamilyColour (str (at (c, "kind")), api), str (at (c, "out")), str (at (c, "kind")));
        else if (cat == "twin")
            check (cat, fxp::fxTwin (str (at (c, "kind"))), str (at (c, "out")), str (at (c, "kind")));
        else if (cat == "knobPic" || cat == "sliderPic")
        {
            const auto s = spec (p);
            const double v = num (at (c, "v"));
            const auto r = fxp::fxRange ({}, "s1", s);
            check (cat, cat == "knobPic" ? fxp::fxKnobPic (s, v, r) : fxp::fxSliderPic (s, v, r), str (at (c, "out")), s.key + " v=" + n2s (v));
        }
        else if (cat == "fader")
            check (cat, fxp::fxFaderTrack (num (at (c, "u"))), str (at (c, "out")), "u=" + n2s (num (at (c, "u"))));
        else if (cat == "tile" || cat == "shSwitch")
            check (cat, fxp::fxTileHtml (spec (p), num (at (c, "v"))), str (at (c, "out")), str (at (p, "key")));
        else if (cat == "advancedPic")
            check (cat, fxp::fxAdvancedPic (spec (p)), str (at (c, "out")), str (at (p, "key")));
        else if (cat == "dyn")
        {
            const auto m = fxp::fxModel (at (c, "slot"), at (c, "shaper"));
            const auto d = fxp::fxDynamicsPaint (m, optNum (at (c, "level")), (bool) at (c, "gate"));
            const S what = str (at (at (c, "slot"), "kind")) + " level " + str (at (c, "level"));
            check ("dyn curve", d.curve, str (at (c, "curve")), what);
            check ("dyn meters", meterStr (d.in) + meterStr (d.gr) + meterStr (d.out) + d.caretTop, meterWant (at (c, "in")) + meterWant (at (c, "gr")) + meterWant (at (c, "out")) + str (at (c, "caret")), what);
        }
        else if (cat == "max")
        {
            const auto d = fxp::fxMaximizerPaint (values (at (c, "v")), optNum (at (c, "level")));
            const S what = "level " + str (at (c, "level"));
            check ("max curve", d.curve, str (at (c, "curve")), what);
            check ("max meters", meterStr (d.in) + meterStr (d.gr) + meterStr (d.out) + d.caretTop, meterWant (at (c, "in")) + meterWant (at (c, "gr")) + meterWant (at (c, "out")) + str (at (c, "caret")), what);
        }
        else if (cat == "eq")
        {
            const auto bands = fxp::fxEqBands (at (c, "slot"), at (c, "shaper"));
            const int sel = (int) at (c, "sel");
            const S what = str (at (at (c, "slot"), "kind")) + " sel " + std::to_string (sel);
            S got, want;
            for (const auto& b : bands) got += b.type + "," + (b.enabled ? "1" : "0") + "," + n2s (b.freq) + "," + n2s (b.q) + "," + n2s (b.gainDb) + ";";
            for (const auto& b : *at (c, "bands").getArray())
                want += str (at (b, "type")) + "," + ((bool) at (b, "enabled") ? "1" : "0") + "," + n2s (num (at (b, "freq"))) + "," + n2s (num (at (b, "q"))) + "," + n2s (num (at (b, "gainDb"))) + ";";
            check ("eq bands", got, want, what);
            std::vector<double> spec;
            for (const auto& x : *at (c, "spectrum").getArray()) spec.push_back ((double) x);
            check ("eq curve", fxp::fxEqCurve (bands, sel, num (at (c, "fs")), spec), str (at (c, "curve")), what + " spectrum " + std::to_string (spec.size()));
            auto* types = at (c, "types").getArray();
            auto* reads = at (c, "reads").getArray();
            for (int i = 0; i < (int) bands.size(); ++i)
            {
                const auto b = fxp::fxEqTypeButton (bands[(size_t) i], i, sel);
                const var t = (*types)[i];
                check ("eq types", b.cls + "|" + b.html + "|" + b.title, str (at (t, "cls")) + "|" + str (at (t, "html")) + "|" + str (at (t, "title")), what);
                check ("eq reads", fxp::fxEqReadout (bands[(size_t) i]), str ((*reads)[i]), what);
            }
            S gs, ws;
            for (const auto& s : fxp::fxEqSelSpecs (bands[(size_t) sel], sel))
                gs += s.key + "," + s.label + "," + n2s (s.min) + "," + n2s (s.max) + "," + n2s (s.def.value_or (-999)) + "," + s.unit + "," + (s.log ? "1" : "0") + ";";
            for (const auto& q : *at (c, "selSpecs").getArray())
                ws += str (at (q, "key")) + "," + str (at (q, "label")) + "," + n2s (num (at (q, "min"))) + "," + n2s (num (at (q, "max"))) + "," + n2s (num (at (q, "default"))) + "," + str (at (q, "unit")) + ","
                    + ((bool) at (q, "log") ? "1" : "0") + ";";
            check ("eq sel specs", gs, ws, what);
        }
        else if (cat == "shHue")
            check (cat, fxp::fxShHue (str (at (c, "kind"))), str (at (c, "out")), str (at (c, "kind")));
        else if (cat == "shDial")
            check (cat, fxp::fxShDialPic (spec (p), num (at (c, "v"))), str (at (c, "out")), str (at (p, "key")) + " v=" + n2s (num (at (c, "v"))));
        else if (cat == "shChoice")
            check (cat, fxp::fxShChoicePic (spec (p), num (at (c, "v"))), str (at (c, "out")), str (at (p, "key")));
        else if (cat == "lex")
        {
            const auto s = spec (p);
            const double v = num (at (c, "v"));
            const S what = s.key + " v=" + n2s (v);
            check ("lex ring", fxp::fxLexRing (fxp::fxLexUnit (s, v)), str (at (c, "ring")), what);
            check ("lex reading", fxp::fxLexReading (s, v), str (at (c, "reading")), what);
            check ("lex pic", fxp::fxLexPic (s, v), str (at (c, "pic")), what);
        }
        else if (cat == "lexImpulse")
            check (cat, fxp::fxLexImpulse (values (at (c, "v"))), str (at (c, "out")), juce::JSON::toString (at (c, "v"), true).toStdString().substr (0, 120));
        else if (cat == "lexPicture")
        {
            const auto rt = spec (at (c, "rt"));
            check (cat, fxp::fxLexImpulsePicture (values (at (c, "v")), isNull (at (c, "rt")) ? nullptr : &rt), str (at (c, "out")), "picture");
        }
        else if (cat == "decorate")
            check (cat, fxp::fxDecoratePic (spec (p), num (at (c, "v"))), str (at (c, "out")), str (at (p, "key")) + " v=" + n2s (num (at (c, "v"))));
        else if (cat == "hpMix")
            check (cat, fxp::fxDecoratePic (fxp::fxHpMixSpec(), fxp::fxHpMixValue (num (at (c, "wet")), num (at (c, "dry")))), str (at (c, "out")), "mix");
        else if (cat == "uiArc")
            check (cat, fxp::uiArc (num (at (c, "c")), num (at (c, "r")), num (at (c, "u0")), num (at (c, "u1"))), str (at (c, "out")), "arc");
        else if (cat == "uiKnobHtml")
        {
            const var f = at (c, "face");
            check (cat, fxp::uiKnobHtml ((int) at (c, "size"), isNull (f) ? std::optional<bool>() : std::optional<bool> ((bool) f), str (at (c, "inner")), str (at (c, "cls"))), str (at (c, "out")),
                   "size " + str (at (c, "size")));
        }
        else if (cat == "uiPic")
            check (cat, fxp::uiPic (str (at (c, "inner")), str (at (c, "vb")), str (at (c, "cls"))), str (at (c, "out")), "uiPic");
        else if (cat == "uiPaint")
        {
            const var st = at (c, "st");
            fxp::RingState rs;
            rs.u = num (at (st, "u"));
            rs.bip = (bool) at (st, "bip");
            rs.pointer = (bool) at (st, "pointer");
            if (at (st, "def").isDouble() || at (st, "def").isInt()) rs.def = num (at (st, "def"));
            const var mod = at (st, "mod");
            if (mod.isObject())
            {
                rs.mod = true;
                rs.modRng = num (at (mod, "rng"));
                if (! isNull (at (mod, "live"))) rs.modLive = num (at (mod, "live"));
                rs.modCol = str (at (mod, "col"));
            }
            const double size = num (at (c, "size"));
            const auto pt = fxp::uiKnobPaint (size, rs);
            S got = pt.arD + "|" + pt.capV + "|" + pt.mdD + "|" + pt.mc + "|" + (pt.modClass ? "mod" : "");
            S want = str (at (c, "ar")) + "|" + str (at (c, "capV")) + "|" + str (at (c, "md")) + "|" + str (at (c, "mc")) + "|" + ((bool) at (c, "modClass") ? "mod" : "");
            const var live = at (c, "live"), ptr = at (c, "ptr"), dn = at (c, "dn");
            got += pt.liveShown ? "|live " + pt.liveCx + " " + pt.liveCy : "|-";
            want += isNull (live) ? "|-" : "|live " + str (at (live, "cx")) + " " + str (at (live, "cy"));
            got += pt.ptrShown ? "|ptr " + pt.ptrX1 + " " + pt.ptrY1 + " " + pt.ptrX2 + " " + pt.ptrY2 : "|-";
            want += isNull (ptr) ? "|-" : "|ptr " + str (at (ptr, "x1")) + " " + str (at (ptr, "y1")) + " " + str (at (ptr, "x2")) + " " + str (at (ptr, "y2"));
            got += pt.dnSet ? "|dn " + pt.dnX1 + " " + pt.dnY1 + " " + pt.dnX2 + " " + pt.dnY2 : "|-";
            want += isNull (at (dn, "x1")) ? "|-" : "|dn " + str (at (dn, "x1")) + " " + str (at (dn, "y1")) + " " + str (at (dn, "x2")) + " " + str (at (dn, "y2"));
            const S what = "size " + n2s (size) + " " + juce::JSON::toString (st, true).toStdString();
            check ("uiPaint", got, want, what);
            check ("uiRingBody", fxp::uiRingBody (size, rs), str (at (c, "body")), what);
        }
        else if (cat == "gsMix")
            check (cat, fxp::gsMixGlyph (num (at (c, "v"))), str (at (c, "out")), n2s (num (at (c, "v"))));
        else if (cat == "gsLevel")
            check (cat, fxp::gsLevelGlyph (num (at (c, "v"))), str (at (c, "out")), n2s (num (at (c, "v"))));
        else if (cat == "gsRack")
            check (cat, fxp::gsRackIcon (str (at (c, "kind")), str (at (c, "group"))), str (at (c, "out")), str (at (c, "kind")));
        else if (cat == "gsGroup")
            check (cat, fxp::gsGroupIcon (str (at (c, "group"))), str (at (c, "out")), str (at (c, "group")));
        else if (cat == "gsFk")
            check (cat, fxp::gsFkIcon (str (at (c, "label"))), str (at (c, "out")), str (at (c, "label")));
        else
            check ("unknown part", cat, "", cat);
    }
    int ok = 0, all = 0;
    for (const auto& [name, p] : parts)
    {
        std::printf ("%-16s %6d / %6d%s\n", name.c_str(), p.ok, p.all, p.ok == p.all ? "" : "   <-- differs");
        for (const auto& b : p.bad) std::printf ("    %s\n", b.c_str());
        ok += p.ok, all += p.all;
    }
    std::printf ("total            %6d / %6d exact\n", ok, all);
    return ok == all ? 0 : 1;
}

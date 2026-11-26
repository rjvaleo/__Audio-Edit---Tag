// The Reverb window's check: the native port of 077-fx-reverb-window.js's
// drawings (`native/app/Source/FxReverbDraw.cpp`) against the page's own
// functions, recorded call for call by `rv-refs.mjs`.
//
//   node native/tools/face-capture/rv-refs.mjs OUT/rv-refs.json
//   clang++ -std=c++17 -O1 -ffp-contract=off -I native/app/Source native/tools/face-capture/rv-test.cpp \
//       native/app/Source/GrainGlyphs.cpp -o OUT/rv-test
//   OUT/rv-test OUT/rv-refs.json
//
// The port draws into a recording stand-in for `c2d::Context` defined here
// (RVD_CONTEXT_STANDIN; doubles, so nothing is rounded to float on the way),
// so c2d itself is untouched and no JUCE is needed. Each call is compared by
// name, then each argument: strings exactly, except the numbers inside them
// (rgba alphas), which, like the numeric arguments, are compared to within
// 1e-9 (relative, or absolute below 1). -ffp-contract=off keeps clang from
// fusing a*b+c, which JS never does, so most numbers match to the bit; the
// count of exact matches is printed beside the count within tolerance.
//
// Also checked: every rvNet spec, RV_ROOM (the world, the camera, the sound on
// screen), the readouts, the room's drag, rvRoleOf for every param of every
// shaper, RV_PLACE and RV_NEW_PADS. Exits 1 on any difference.

#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <map>
#include <sstream>
#include <string>
#include <vector>

// ── the recording stand-in for c2d::Context ─────────────────────────────────
namespace c2d
{
struct Arg
{
    bool str = false;
    double n = 0;
    std::string s;
};
struct Call
{
    std::string name;
    std::vector<Arg> args;
};
using Log = std::vector<Call>;

struct Rec
{
    Log& log;
    Rec& operator() (const std::string& name) { log.push_back ({ name, {} }); return *this; }
    Rec& n (double x) { log.back().args.push_back ({ false, x, {} }); return *this; }
    Rec& s (const std::string& x) { log.back().args.push_back ({ true, 0, x }); return *this; }
};
struct NumProp
{
    Rec r;
    const char* name;
    NumProp& operator= (double v) { r ("set").s (name).n (v); return *this; }
};
struct StrProp
{
    Rec r;
    const char* name;
    StrProp& operator= (const std::string& v) { r ("set").s (name).s (v); return *this; }
};

class Context
{
public:
    explicit Context (Log& l) : r { l }, lineWidth { { l }, "lineWidth" }, lineCap { { l }, "lineCap" }, font { { l }, "font" } {}
    Rec r;
    NumProp lineWidth;
    StrProp lineCap, font;

    void setFill (const std::string& c) { r ("set").s ("fillStyle").s (c); }
    void setStroke (const std::string& c) { r ("set").s ("strokeStyle").s (c); }
    void setLineDash (std::vector<float> d)
    {
        r ("setLineDash");
        for (float x : d) r.n (x);
    }
    void save() { r ("save"); }
    void restore() { r ("restore"); }
    void scale (double x, double y) { r ("scale").n (x).n (y); }
    void beginPath() { r ("beginPath"); }
    void closePath() { r ("closePath"); }
    void moveTo (double x, double y) { r ("moveTo").n (x).n (y); }
    void lineTo (double x, double y) { r ("lineTo").n (x).n (y); }
    void bezierCurveTo (double a, double b, double c, double d, double x, double y) { r ("bezierCurveTo").n (a).n (b).n (c).n (d).n (x).n (y); }
    void quadraticCurveTo (double a, double b, double x, double y) { r ("quadraticCurveTo").n (a).n (b).n (x).n (y); }
    void arc (double x, double y, double rad, double a0, double a1) { r ("arc").n (x).n (y).n (rad).n (a0).n (a1); }
    void ellipse (double x, double y, double rx, double ry, double rot, double a0, double a1) { r ("ellipse").n (x).n (y).n (rx).n (ry).n (rot).n (a0).n (a1); }
    void fill() { r ("fill"); }
    void stroke() { r ("stroke"); }
    void clip() { r ("clip"); }
    void fillRect (double x, double y, double w, double h) { r ("fillRect").n (x).n (y).n (w).n (h); }
    void clearRect (double x, double y, double w, double h) { r ("clearRect").n (x).n (y).n (w).n (h); }
    void fillText (const std::string& s, double x, double y) { r ("fillText").s (s).n (x).n (y); }
    // as rv-refs.mjs's: 5.4 px a UTF-16 unit
    double measureText (const std::string& s)
    {
        r ("measureText").s (s);
        double units = 0;
        for (unsigned char ch : s)
            units += (ch & 0xC0) == 0x80 ? 0 : (ch >= 0xF0 ? 2 : 1);
        return units * 5.4;
    }
};
} // namespace c2d

#define RVD_CONTEXT_STANDIN 1
#define RVD_NUM double
#include "FxReverbDraw.cpp"

namespace
{
// ── a small JSON reader, enough for the references ───────────────────────────

struct J
{
    enum Kind { Null, Bool, Num, Str, Arr, Obj } kind = Null;
    double num = 0;
    bool b = false;
    std::string str;
    std::vector<J> arr;
    std::vector<std::pair<std::string, J>> obj;

    const J& operator[] (const std::string& k) const
    {
        static const J none;
        for (const auto& [key, v] : obj)
            if (key == k) return v;
        return none;
    }
};

struct Reader
{
    const std::string& s;
    size_t i = 0;

    [[noreturn]] void fail (const char* why)
    {
        std::fprintf (stderr, "bad JSON at %zu: %s\n", i, why);
        std::exit (2);
    }
    void ws()
    {
        while (i < s.size() && (s[i] == ' ' || s[i] == '\n' || s[i] == '\r' || s[i] == '\t')) ++i;
    }
    static void utf8 (std::string& out, unsigned c)
    {
        if (c < 0x80) out += (char) c;
        else if (c < 0x800) { out += (char) (0xC0 | (c >> 6)); out += (char) (0x80 | (c & 0x3F)); }
        else if (c < 0x10000) { out += (char) (0xE0 | (c >> 12)); out += (char) (0x80 | ((c >> 6) & 0x3F)); out += (char) (0x80 | (c & 0x3F)); }
        else { out += (char) (0xF0 | (c >> 18)); out += (char) (0x80 | ((c >> 12) & 0x3F)); out += (char) (0x80 | ((c >> 6) & 0x3F)); out += (char) (0x80 | (c & 0x3F)); }
    }
    unsigned hex4()
    {
        if (i + 4 > s.size()) fail ("short \\u");
        unsigned c = (unsigned) std::strtoul (s.substr (i, 4).c_str(), nullptr, 16);
        i += 4;
        return c;
    }
    std::string string()
    {
        if (s[i] != '"') fail ("string expected");
        ++i;
        std::string out;
        while (true)
        {
            if (i >= s.size()) fail ("unterminated string");
            const char c = s[i++];
            if (c == '"') break;
            if (c != '\\') { out += c; continue; }
            const char e = s[i++];
            switch (e)
            {
                case '"': out += '"'; break;
                case '\\': out += '\\'; break;
                case '/': out += '/'; break;
                case 'b': out += '\b'; break;
                case 'f': out += '\f'; break;
                case 'n': out += '\n'; break;
                case 'r': out += '\r'; break;
                case 't': out += '\t'; break;
                case 'u':
                {
                    unsigned c1 = hex4();
                    if (c1 >= 0xD800 && c1 < 0xDC00 && s.compare (i, 2, "\\u") == 0)
                    {
                        i += 2;
                        const unsigned c2 = hex4();
                        c1 = 0x10000 + ((c1 - 0xD800) << 10) + (c2 - 0xDC00);
                    }
                    utf8 (out, c1);
                    break;
                }
                default: fail ("bad escape");
            }
        }
        return out;
    }
    J value()
    {
        ws();
        J v;
        if (i >= s.size()) fail ("value expected");
        const char c = s[i];
        if (c == '{')
        {
            v.kind = J::Obj;
            ++i;
            ws();
            if (s[i] == '}') { ++i; return v; }
            while (true)
            {
                ws();
                std::string k = string();
                ws();
                if (s[i++] != ':') fail ("':' expected");
                v.obj.emplace_back (std::move (k), value());
                ws();
                if (s[i] == ',') { ++i; continue; }
                if (s[i] == '}') { ++i; break; }
                fail ("',' or '}' expected");
            }
        }
        else if (c == '[')
        {
            v.kind = J::Arr;
            ++i;
            ws();
            if (s[i] == ']') { ++i; return v; }
            while (true)
            {
                v.arr.push_back (value());
                ws();
                if (s[i] == ',') { ++i; continue; }
                if (s[i] == ']') { ++i; break; }
                fail ("',' or ']' expected");
            }
        }
        else if (c == '"') { v.kind = J::Str; v.str = string(); }
        else if (s.compare (i, 4, "true") == 0) { v.kind = J::Bool; v.b = true; i += 4; }
        else if (s.compare (i, 5, "false") == 0) { v.kind = J::Bool; i += 5; }
        else if (s.compare (i, 4, "null") == 0) { i += 4; }
        else
        {
            char* end = nullptr;
            v.kind = J::Num;
            v.num = std::strtod (s.c_str() + i, &end);
            if (end == s.c_str() + i) fail ("number expected");
            i = (size_t) (end - s.c_str());
        }
        return v;
    }
};

// ── comparing ───────────────────────────────────────────────────────────────

struct Tally
{
    long calls = 0, callsExact = 0, callsBad = 0;
    long checks = 0, bad = 0;
    double worst = 0;
    int shown = 0;
};
Tally T;

bool near (double a, double b)
{
    if (std::isnan (a) && std::isnan (b)) return true;
    if (a == b) return true;
    const double d = std::abs (a - b), tol = 1e-9 * std::max (1.0, std::max (std::abs (a), std::abs (b)));
    if (d > T.worst && d <= tol) T.worst = d;
    return d <= tol;
}
double numOf (const J& j)
{
    if (j.kind == J::Num) return j.num;
    if (j.kind == J::Bool) return j.b ? 1 : 0;
    if (j.kind == J::Str) return j.str == "NaN" ? NAN : j.str == "Infinity" ? INFINITY : j.str == "-Infinity" ? -INFINITY : std::strtod (j.str.c_str(), nullptr);
    return NAN;
}
// Strings alike but for the numbers in them, which need only be near.
bool sameText (const std::string& a, const std::string& b)
{
    if (a == b) return true;
    size_t i = 0, k = 0;
    auto isNumStart = [] (const std::string& s, size_t at) { return std::isdigit ((unsigned char) s[at]) || (s[at] == '.' && at + 1 < s.size() && std::isdigit ((unsigned char) s[at + 1])); };
    while (i < a.size() && k < b.size())
    {
        if (isNumStart (a, i) && isNumStart (b, k))
        {
            char *ea = nullptr, *eb = nullptr;
            const double x = std::strtod (a.c_str() + i, &ea), y = std::strtod (b.c_str() + k, &eb);
            if (!near (x, y)) return false;
            i = (size_t) (ea - a.c_str());
            k = (size_t) (eb - b.c_str());
            continue;
        }
        if (a[i] != b[k]) return false;
        ++i, ++k;
    }
    return i == a.size() && k == b.size();
}
std::string show (const c2d::Call& c)
{
    std::string s = c.name + "(";
    for (size_t i = 0; i < c.args.size(); i++) s += (i ? ", " : "") + (c.args[i].str ? "\"" + c.args[i].s + "\"" : gg::jsString (c.args[i].n));
    return s + ")";
}
std::string show (const J& c)
{
    std::string s = c.arr.empty() ? "?" : c.arr[0].str + "(";
    for (size_t i = 1; i < c.arr.size(); i++) s += (i > 1 ? ", " : "") + (c.arr[i].kind == J::Str ? "\"" + c.arr[i].str + "\"" : gg::jsString (numOf (c.arr[i])));
    return s + ")";
}
void fail (const std::string& what, const std::string& got, const std::string& want)
{
    ++T.bad;
    if (T.shown++ < 20) std::printf ("DIFF %s\n  js : %s\n  c++: %s\n", what.c_str(), want.c_str(), got.c_str());
}
void check (const std::string& what, bool ok, const std::string& got, const std::string& want)
{
    ++T.checks;
    if (!ok) fail (what, got, want);
}
void checkNum (const std::string& what, double got, double want) { check (what, near (got, want), gg::jsString (got), gg::jsString (want)); }
void checkStr (const std::string& what, const std::string& got, const std::string& want) { check (what, got == want, got, want); }

void compareLog (const std::string& what, const c2d::Log& got, const J& want)
{
    const size_t n = std::max (got.size(), want.arr.size());
    bool caseBad = false;
    for (size_t i = 0; i < n; i++)
    {
        ++T.calls;
        if (i >= got.size() || i >= want.arr.size())
        {
            ++T.callsBad;
            fail (what + " call " + std::to_string (i) + (i >= got.size() ? ": c++ stops" : ": c++ goes on"),
                  i < got.size() ? show (got[i]) : "-", i < want.arr.size() ? show (want.arr[i]) : "-");
            return;
        }
        const auto& g = got[i];
        const auto& w = want.arr[i];
        bool ok = w.arr.size() == g.args.size() + 1 && w.arr[0].str == g.name, exact = ok;
        for (size_t a = 0; ok && a < g.args.size(); a++)
        {
            const J& wa = w.arr[a + 1];
            const auto& ga = g.args[a];
            if (ga.str)
            {
                ok = wa.kind == J::Str && sameText (ga.s, wa.str);
                exact = exact && ok && ga.s == wa.str;
            }
            else
            {
                const double x = numOf (wa);
                ok = wa.kind != J::Str || wa.str == "NaN" || wa.str == "Infinity" || wa.str == "-Infinity";
                ok = ok && near (ga.n, x);
                exact = exact && ok && (ga.n == x || (std::isnan (ga.n) && std::isnan (x)));
            }
        }
        if (exact) ++T.callsExact;
        if (!ok)
        {
            ++T.callsBad;
            if (!caseBad) fail (what + " call " + std::to_string (i), show (g), show (w));
            else ++T.bad;
            caseBad = true;
        }
    }
}

rvd::Values valuesOf (const J& o)
{
    rvd::Values v;
    for (const auto& [k, x] : o.obj) v[k] = numOf (x);
    return v;
}
void checkV3 (const std::string& what, const rvd::V3& got, const J& want)
{
    for (size_t i = 0; i < 3; i++) checkNum (what + "[" + std::to_string (i) + "]", got[i], numOf (want.arr[i]));
}

void compareSpec (const std::string& what, const rvd::Spec& s, const J& w)
{
    checkNum (what + " cols", (double) s.cols.size(), (double) w["cols"].arr.size());
    for (size_t i = 0; i < std::min (s.cols.size(), w["cols"].arr.size()); i++)
    {
        const auto& c = s.cols[i];
        const J& wc = w["cols"].arr[i];
        const std::string at = what + " col " + std::to_string (i);
        checkStr (at + " t", c.t, wc["t"].str);
        checkNum (at + " n", c.n, wc["n"].num);
        std::string gm, wm;
        for (const auto& m : c.map) gm += m + ",";
        for (const auto& m : wc["map"].arr) wm += m.str + ",";
        checkStr (at + " map", gm, wm);
        checkNum (at + " len count", (double) c.len.size(), (double) wc["len"].arr.size());
        for (size_t k = 0; k < std::min (c.len.size(), wc["len"].arr.size()); k++) checkNum (at + " len " + std::to_string (k), c.len[k], numOf (wc["len"].arr[k]));
        check (at + " w", c.w.has_value() == (wc["w"].kind == J::Num) && (!c.w || near (*c.w, wc["w"].num)), c.w ? gg::jsString (*c.w) : "-", wc["w"].kind == J::Num ? gg::jsString (wc["w"].num) : "-");
        checkStr (at + " comb", c.comb ? "1" : "0", wc["comb"].b ? "1" : "0");
        checkStr (at + " pairs", c.pairs ? "1" : "0", wc["pairs"].b ? "1" : "0");
        checkStr (at + " kind", c.kind, wc["kind"].str);
        checkNum (at + " stages", c.stages, wc["stages"].kind == J::Num ? wc["stages"].num : 0);
        checkNum (at + " k", c.k, wc["k"].kind == J::Num ? wc["k"].num : 0);
    }
    checkNum (what + " fb", (double) s.fb.size(), (double) w["fb"].arr.size());
    for (size_t i = 0; i < std::min (s.fb.size(), w["fb"].arr.size()); i++)
    {
        const auto& f = s.fb[i];
        const J& wf = w["fb"].arr[i];
        checkStr (what + " fb " + std::to_string (i), std::to_string (f.from) + "," + std::to_string (f.to) + "," + f.label + "," + (f.crossed ? "1" : "0"),
                  gg::jsString (wf.arr[0].num) + "," + gg::jsString (wf.arr[1].num) + "," + wf.arr[2].str + "," + (wf.arr.size() > 3 && wf.arr[3].b ? "1" : "0"));
    }
    checkNum (what + " dens", s.dens, numOf (w["dens"]));
    checkStr (what + " note", s.note, w["note"].str);
}
} // namespace

int main (int argc, char** argv)
{
    if (argc < 2) { std::fprintf (stderr, "usage: rv-test rv-refs.json\n"); return 2; }
    std::ifstream f (argv[1], std::ios::binary);
    if (!f) { std::fprintf (stderr, "cannot read %s\n", argv[1]); return 2; }
    std::stringstream ss;
    ss << f.rdbuf();
    const std::string text = ss.str();
    Reader rd { text };
    const J refs = rd.value();

    const J& css = refs["colours"];
    rvd::Colours col;
    col.accent = css["--rv-rgb"].str;
    col.ice = css["--rv-ice-rgb"].str;
    col.onRgb = css["--rv-on-rgb"].str;
    col.off = css["--rv-off-rgb"].str;
    col.well = css["--well"].str;
    col.white = css["--white-rgb"].str;
    col.text = css["--text-dim"].str;
    col.on = css["--on"].str;
    col.textFull = css["--text"].str;

    int nets = 0, thumbs = 0, rooms = 0;
    for (const auto& c : refs["cases"].arr)
    {
        const std::string& kind = c["kind"].str;
        const rvd::Values v = valuesOf (c["v"]);
        c2d::Log log;
        c2d::Context ctx (log);
        if (kind == "net")
        {
            const std::string what = "net " + c["mode"].str + " " + c["set"].str;
            const auto spec = rvd::rvNet (c["mode"].str, v);
            compareSpec (what, spec, c["spec"]);
            const double w = c["w"].num, h = c["h"].num, e = c["e"].num;
            rvd::rvDrawNet (ctx, w, h, spec, rvd::rvFrameOptions (v, e, c["t"].num, c["moving"].b), col);
            rvd::rvOverlay (ctx, w, h, v, e, col);
            compareLog (what, log, c["log"]);
            ++nets;
        }
        else if (kind == "thumb")
        {
            rvd::rvDrawThumb (ctx, c["mode"].str, v, col);
            compareLog ("thumb " + c["mode"].str, log, c["log"]);
            ++thumbs;
        }
        else if (kind == "room")
        {
            const std::string what = "room " + std::to_string (rooms);
            rvd::Cam cam { numOf (c["cam"].arr[0]), numOf (c["cam"].arr[1]) };
            const auto room = rvd::rvDrawRoom (ctx, c["w"].num, c["h"].num, v, c["e"].num, c["since"].num, c["t"].num, col, cam);
            compareLog (what, log, c["log"]);
            checkStr (what + " readout", room.readout, c["readout"].str);
            const J& W = c["W"];
            checkNum (what + " pts", (double) room.W.P.pts.size(), (double) W["P"]["pts"].arr.size());
            for (size_t i = 0; i < std::min (room.W.P.pts.size(), W["P"]["pts"].arr.size()); i++)
                for (size_t k = 0; k < 2; k++) checkNum (what + " pt", room.W.P.pts[i][k], numOf (W["P"]["pts"].arr[i].arr[k]));
            checkNum (what + " ceil", room.W.P.ceil, numOf (W["P"]["ceil"]));
            checkStr (what + " plate", room.W.P.plate ? "1" : "0", W["P"]["plate"].b ? "1" : "0");
            checkNum (what + " depth", room.W.depth, numOf (W["depth"]));
            checkNum (what + " wide", room.W.wide, numOf (W["wide"]));
            checkNum (what + " H", room.W.H, numOf (W["H"]));
            checkV3 (what + " listen", room.W.listen, W["listen"]);
            checkV3 (what + " src", room.W.src, W["src"]);
            const J& C = c["C"];
            checkV3 (what + " pos", room.C.pos, C["pos"]);
            checkV3 (what + " f", room.C.f, C["f"]);
            checkV3 (what + " r", room.C.r, C["r"]);
            checkV3 (what + " u", room.C.u, C["u"]);
            checkNum (what + " F", room.C.F, numOf (C["F"]));
            checkNum (what + " cx", room.C.cx, numOf (C["cx"]));
            checkNum (what + " cy", room.C.cy, numOf (C["cy"]));
            check (what + " Sq", room.Sq.has_value() == (c["Sq"].kind == J::Arr), room.Sq ? "set" : "none", c["Sq"].kind == J::Arr ? "set" : "none");
            if (room.Sq && c["Sq"].kind == J::Arr) checkV3 (what + " Sq", *room.Sq, c["Sq"]);
            for (const auto& d : c["drags"].arr)
            {
                double pos = 0, dist = 0;
                const bool ok = rvd::rvRoomDragSound (room, d["sx"].num, d["sy"].num, pos, dist);
                checkStr (what + " drag ok", ok ? "1" : "0", d["ok"].b ? "1" : "0");
                if (ok && d["ok"].b) { checkNum (what + " drag pos", pos, numOf (d["pos"])); checkNum (what + " drag dist", dist, numOf (d["dist"])); }
            }
            ++rooms;
        }
    }
    int roles = 0;
    for (const auto& r : refs["roles"].arr)
    {
        checkStr ("role " + r["key"].str, rvd::rvRoleOf (r["role"].str, r["key"].str), r["out"].str);
        checkStr ("fader " + r["key"].str, rvd::rvIsFader (r["key"].str) ? "1" : "0", r["fader"].b ? "1" : "0");
        ++roles;
    }
    {
        const auto& P = rvd::RV_PLACE();
        checkNum ("place count", (double) P.size(), (double) refs["place"].arr.size());
        for (size_t i = 0; i < std::min (P.size(), refs["place"].arr.size()); i++)
        {
            const auto& p = P[i];
            const J& w = refs["place"].arr[i];
            std::string gc, wc;
            for (const auto& s : p.choices) gc += s + ",";
            for (const auto& s : w["choices"].arr) wc += s.str + ",";
            checkStr ("place " + p.key,
                      p.key + "|" + p.label + "|" + gg::jsString (p.min) + "|" + gg::jsString (p.max) + "|" + gg::jsString (p.def) + "|" + gg::jsString (p.step) + "|" + p.unit + "|" + (p.log ? "1" : "0") + (p.toggle ? "1" : "0") + "|" + gc,
                      w["key"].str + "|" + w["label"].str + "|" + gg::jsString (w["min"].num) + "|" + gg::jsString (w["max"].num) + "|" + gg::jsString (w["default"].num) + "|" + gg::jsString (w["step"].kind == J::Num ? w["step"].num : 0) + "|" + w["unit"].str + "|" + (w["log"].b ? "1" : "0") + (w["toggle"].b ? "1" : "0") + "|" + wc);
        }
        std::string gp, wp;
        for (const auto& [k, p] : rvd::RV_NEW_PADS()) gp += k + "=" + p.x + "/" + p.y + ",";
        std::map<std::string, std::string> sorted;
        for (const auto& [k, p] : refs["pads"].obj) sorted[k] = p["x"].str + "/" + p["y"].str;
        for (const auto& [k, p] : sorted) wp += k + "=" + p + ",";
        checkStr ("pads", gp, wp);
    }

    std::printf ("calls: %ld of %ld match (%ld to the bit, %ld within 1e-9; worst %.3g) in %d networks, %d thumbnails, %d rooms\n",
                 T.calls - T.callsBad, T.calls, T.callsExact, T.calls - T.callsBad - T.callsExact, T.worst, nets, thumbs, rooms);
    std::printf ("geometry, specs, readouts, drags, %d roles, Place, pads: %ld of %ld match\n", roles, T.checks - (T.bad - T.callsBad), T.checks);
    return T.bad ? 1 : 0;
}

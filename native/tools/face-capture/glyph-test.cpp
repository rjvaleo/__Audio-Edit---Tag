// The Grain glyphs' check: every glyph the native port draws
// (`native/app/Source/GrainGlyphs.cpp`) against the string MGL's JS drew for
// the same value and time, recorded by `glyph-refs.mjs`.
//
//   node native/tools/face-capture/glyph-refs.mjs OUT/glyph-refs.json
//   clang++ -std=c++17 -O1 -I native/app/Source native/tools/face-capture/glyph-test.cpp \
//       native/app/Source/GrainGlyphs.cpp -o OUT/glyph-test
//   OUT/glyph-test OUT/glyph-refs.json
//
// Prints each case that differs (the first few in full) and the count; exits 1
// on any difference. No JUCE.

#include "GrainGlyphs.h"

#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <map>
#include <memory>
#include <sstream>
#include <string>
#include <vector>

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

std::vector<std::string> strings (const J& a)
{
    std::vector<std::string> v;
    for (const auto& e : a.arr) v.push_back (e.str);
    return v;
}

/// Where two strings first differ, with a little context either side.
std::string around (const std::string& a, size_t at)
{
    const size_t from = at > 60 ? at - 60 : 0;
    return a.substr (from, 140);
}
} // namespace

int main (int argc, char** argv)
{
    if (argc < 2) { std::fprintf (stderr, "usage: glyph-test glyph-refs.json\n"); return 2; }
    std::ifstream f (argv[1], std::ios::binary);
    if (! f) { std::fprintf (stderr, "cannot read %s\n", argv[1]); return 2; }
    std::stringstream ss;
    ss << f.rdbuf();
    const std::string text = ss.str();
    Reader r { text };
    const J refs = r.value();

    int bad = 0, total = 0, shown = 0;
    auto check = [&] (const std::string& what, const std::string& got, const std::string& want) {
        ++total;
        if (got == want) return;
        ++bad;
        size_t at = 0;
        while (at < got.size() && at < want.size() && got[at] == want[at]) ++at;
        std::printf ("DIFF %s (at char %zu)\n", what.c_str(), at);
        if (shown++ < 12)
            std::printf ("  js : ...%s...\n  c++: ...%s...\n", around (want, at).c_str(), around (got, at).c_str());
    };

    // The tables.
    auto list = [&] (const char* name, const std::vector<std::string>& got, const J& want) {
        std::string g, w;
        for (const auto& k : got) g += k + ",";
        for (const auto& k : strings (want)) w += k + ",";
        check (name, g, w);
    };
    list ("keys", gg::keys(), refs["keys"]);
    list ("engines", gg::engines(), refs["engines"]);
    list ("moves", gg::movingKeys(), refs["moves"]);
    list ("pick", gg::pick(), refs["pick"]);
    list ("shape", gg::shape(), refs["shape"]);
    {
        std::string g, w;
        for (const auto& [k, n] : gg::facets()) g += k + "=" + n + ",";
        for (const auto& p : refs["facets"].arr) w += p.arr[0].str + "=" + p.arr[1].str + ",";
        check ("facets", g, w);
    }
    for (const auto& [k, v] : refs["facet"].obj) check ("facet " + k, gg::facet (k), v.str);
    for (const auto& [k, v] : refs["group"].obj) check ("group " + k, gg::group (k), v.str);
    for (const auto& k : strings (refs["keys"]))
    {
        bool js = false;
        for (const auto& m : strings (refs["moves"])) js = js || m == k;
        check ("moves " + k, gg::moves (k) ? "1" : "0", js ? "1" : "0");
        check ("has " + k, gg::has (k) ? "1" : "0", "1");
    }
    check ("unknown key", gg::draw ("nothing", 1, 0), "");
    check ("unknown engine", gg::engine ("nothing"), "");

    // The pictures.
    int glyphs = 0;
    for (const auto& c : refs["cases"].arr)
    {
        const std::string& key = c["key"].str;
        const double v = std::strtod (c["v"].str.c_str(), nullptr), t = std::strtod (c["t"].str.c_str(), nullptr);
        check (key + " v=" + c["v"].str + " t=" + c["t"].str, gg::draw (key, v, t), c["svg"].str);
        ++glyphs;
    }
    for (const auto& e : refs["engine"].arr) check ("engine " + e["alg"].str, gg::engine (e["alg"].str), e["svg"].str);

    std::printf ("%d of %d match (%d glyphs, %zu engines, the rest the tables); %d differ\n", total - bad, total, glyphs,
                 refs["engine"].arr.size(), bad);
    return bad ? 1 : 0;
}

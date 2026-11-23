// Chop's snapshot and bench, run from Main without a window:
//
//   idMLab --snapshot chop-face out.png scale [theme|-] [sound.wav|-] [calls|-]
//   idMLab --bench chop sound.wav
//
// A real Sound and Chop are behind the face, with no sound card. `calls` is
// a list of the module's calls, `what=json;what=json` (`pick={"i":2}`); with
// none, slice 3 is picked, as MGL's capture has it. A sound of "-" is none.
#include "ChopBench.h"
#include "ChopFace.h"
#include "Host.h"

#include <cstdio>

namespace
{
void wearLabel (const juce::String& arg)
{
    if (arg.isEmpty() || arg == "-")
        return;
    const auto label = arg.unquoted().replace ("_", " ");
    const auto& list = face::themeChoices();
    for (int i = 0; i < (int) list.size(); ++i)
        if (list[(size_t) i].label == label || list[(size_t) i].mgl == arg.unquoted())
            return face::wear (i, "thinRing");
}

juce::var call (NaApp* a, uint32_t id, const char* what, const juce::String& json)
{
    std::vector<char> buf (1 << 22);
    const int n = na_chop_call (a, id, what, json.toRawUTF8(), buf.data(), (uint32_t) buf.size());
    return n > 0 ? juce::JSON::parse (juce::String::fromUTF8 (buf.data(), juce::jmin (n, (int) buf.size() - 1))) : juce::var();
}

struct Rig
{
    NaApp* a = nullptr;
    uint32_t sound = 0, chop = 0;
    ChopFace::Call fn;
    explicit Rig (const juce::String& wav)
    {
        a = na_new (48000.0f, 4096);
        sound = (uint32_t) na_add (a, "sound", 0, 0);
        chop = (uint32_t) na_add (a, "chop", 400, 0);
        na_connect (a, sound, 0, chop, 0);
        fn = [this] (const std::function<int64_t (NaApp*)>& f) { return f (a); };
        if (wav.isNotEmpty() && wav != "-")
        {
            const juce::File f (wav.unquoted());
            const auto origin = "{\"kind\":\"file\",\"name\":\"" + f.getFileName() + "\"}";
            std::vector<char> buf (1 << 16);
            na_sound_open (a, sound, f.getFullPathName().toRawUTF8(), origin.toRawUTF8(), 0, buf.data(), (uint32_t) buf.size());
        }
        // Until the sound is in and measured.
        for (int i = 0; i < 400; ++i)
        {
            na_collect (a);
            const auto st = call (a, chop, "state", "{}");
            if (!st["sound"].isObject() || st["an"].isObject())
                if (i > 2)
                    break;
            juce::Thread::sleep (10);
        }
        na_collect (a);
    }
    ~Rig() { na_free (a); }
};
} // namespace

juce::Image chopSnapshot (const juce::StringArray& args, float scale)
{
    if (args.size() > 4)
        wearLabel (args[4]);
    Rig rig (args.size() > 5 ? args[5] : juce::String());
    const auto calls = args.size() > 6 && args[6] != "-" ? args[6].unquoted() : juce::String ("pick={\"i\":2}");
    for (const auto& c : juce::StringArray::fromTokens (calls, ";", ""))
        call (rig.a, rig.chop, c.upToFirstOccurrenceOf ("=", false, false).trim().toRawUTF8(), c.fromFirstOccurrenceOf ("=", false, false));
    ChopFace f (rig.fn, rig.chop);
    f.poll();
    return f.createComponentSnapshot (f.getLocalBounds(), true, scale);
}

int chopBench (const juce::StringArray& args)
{
    Rig rig (args.size() > 2 ? args[2] : juce::String());
    ChopFace f (rig.fn, rig.chop);
    juce::Image frame (juce::Image::ARGB, f.getWidth() * 2, f.getHeight() * 2, true);
    auto draw = [&] {
        juce::Graphics g (frame);
        g.addTransform (juce::AffineTransform::scale (2.0f));
        f.paintEntireComponent (g, true);
    };
    // A part drawn again as JUCE draws it: only where it changed.
    auto drawIn = [&] (juce::Rectangle<float> r) {
        juce::Graphics g (frame);
        g.addTransform (juce::AffineTransform::scale (2.0f));
        g.reduceClipRegion (r.expanded (8).toNearestInt());
        f.paintEntireComponent (g, true);
    };
    auto ms = [] (auto&& fn) {
        const auto t0 = juce::Time::getMillisecondCounterHiRes();
        fn();
        return juce::Time::getMillisecondCounterHiRes() - t0;
    };
    auto press = [&] (juce::Point<float> at, juce::Point<float> to, juce::ModifierKeys mods = juce::ModifierKeys (juce::ModifierKeys::leftButtonModifier), int clicks = 1) {
        auto src = juce::Desktop::getInstance().getMainMouseSource();
        const auto now = juce::Time::getCurrentTime();
        auto ev = [&] (juce::Point<float> p, bool dragged) { return juce::MouseEvent (src, p, mods, 1.0f, 0, 0, 0, 0, &f, &f, now, at, now, clicks, dragged); };
        f.mouseDown (ev (at, false));
        if (to != at)
        {
            f.mouseDrag (ev ((at + to) / 2, true));
            f.mouseDrag (ev (to, true));
        }
        f.mouseUp (ev (to, to != at));
        if (clicks == 2)
            f.mouseDoubleClick (ev (to, false));
    };
    auto state = [&] { return call (rig.a, rig.chop, "state", "{}"); };
    auto cp = [&] (const char* k) { return juce::JSON::toString (state()["cp"][k], true); };
    auto report = [] (const char* name, double t, const juce::String& what) { std::printf ("{\"%s_ms\":%.1f,%s}\n", name, t, what.toRawUTF8()); };
    const double whole = ms (draw), again = ms (draw);
    std::printf ("{\"whole_ms\":%.1f,\"again_ms\":%.1f,\"slices\":%d}\n", whole, again, state()["slices"].size());

    // A knob: Sens dragged up (a cut setting: the sound is cut again).
    {
        const auto r = f.where ("knob:sens");
        double move = 0;
        for (int i = 0; i < 10; ++i)
            move += ms ([&] { press (r.getCentre(), r.getCentre() + juce::Point<float> (0, -3)); drawIn (r); });
        report ("knob_move", move / 10, "\"sens\":" + cp ("sens") + ",\"slices\":" + juce::String (state()["slices"].size()));
        press (r.getCentre(), r.getCentre(), juce::ModifierKeys (juce::ModifierKeys::leftButtonModifier), 2);
        std::printf ("{\"knob_reset_sens\":%s}\n", cp ("sens").toRawUTF8());
        // A sound setting: Pitch.
        const auto p = f.where ("knob:pitch");
        const double pm = ms ([&] { press (p.getCentre(), p.getCentre() + juce::Point<float> (0, -16)); drawIn (p); });
        report ("pitch_move", pm, "\"pitch\":" + cp ("pitch"));
        // A processing bar's knob: the filter's frequency.
        const auto b = f.where ("knob:fltFreq");
        const double bm = ms ([&] { press (b.getCentre(), b.getCentre() + juce::Point<float> (0, 20)); drawIn (b); });
        report ("bar_move", bm, "\"fltFreq\":" + cp ("fltFreq"));
    }
    // The rows of choices: the mode, the grid, a click tool.
    {
        const auto m = f.where ("chopMode");
        const double t = ms ([&] { press ({ m.getRight() - 40, m.getCentreY() }, { m.getRight() - 40, m.getCentreY() }); drawIn (m); });
        report ("mode_click", t, "\"mode\":" + cp ("mode") + ",\"slices\":" + juce::String (state()["slices"].size()));
        const auto d = f.where ("chopDiv");
        const double t2 = ms ([&] { press ({ d.getRight() - 30, d.getCentreY() }, { d.getRight() - 30, d.getCentreY() }); drawIn (d); });
        report ("div_click", t2, "\"div\":" + cp ("div") + ",\"slices\":" + juce::String (state()["slices"].size()));
        press ({ m.getX() + 40, m.getCentreY() }, { m.getX() + 40, m.getCentreY() });
    }
    // A switch: the Filter module on.
    {
        const auto r = f.where ("pwr:filter");
        const double t = ms ([&] { press (r.getCentre(), r.getCentre()); drawIn (r); });
        report ("switch_click", t, "\"fltOn\":" + cp ("fltOn"));
        press (r.getCentre(), r.getCentre());
    }
    // The lane: a click on slice 2 picks and plays it; a cut dragged.
    {
        const auto lane = f.where ("lane");
        const auto st = state();
        const auto len = (double) st["sound"]["len"];
        auto xOf = [&] (double fr) { return lane.getX() + (float) (fr / len) * lane.getWidth(); };
        const double s1 = (double) st["slices"][1][0], e1 = (double) st["slices"][1][1];
        const double t = ms ([&] { press ({ xOf ((s1 + e1) / 2), lane.getCentreY() }, { xOf ((s1 + e1) / 2), lane.getCentreY() }); f.poll(); draw(); });
        const auto p = call (rig.a, rig.chop, "playing", "{}");
        report ("slice_click", t, "\"current\":" + juce::String ((int) state()["current"]) + ",\"playing\":\"" + p["kind"].toString() + "\"");
        // Drag the cut at slice 2's start on the ruler, 20 px right.
        const double tc = ms ([&] { press ({ xOf (s1), lane.getY() + 12 }, { xOf (s1) + 20, lane.getY() + 12 }); draw(); });
        const auto after = state();
        report ("cut_drag", tc, "\"from\":" + juce::String (s1) + ",\"to\":" + juce::JSON::toString (after["slices"][1][0], true) + ",\"flags\":" + juce::JSON::toString (after["slices"][1][2], true));
        // Lock it with the lock tool, then Re-detect: it stays.
        const auto tools = f.where ("chopTools");
        press ({ tools.getX() + tools.getWidth() * 0.62f, tools.getCentreY() }, { tools.getX() + tools.getWidth() * 0.62f, tools.getCentreY() });
        press ({ xOf ((double) after["slices"][1][0]), lane.getY() + 12 }, { xOf ((double) after["slices"][1][0]), lane.getY() + 12 });
        const auto re = f.where ("chopRedetect");
        press (re.getCentre(), re.getCentre());
        const auto locked = state();
        std::printf ("{\"locked_flags\":%s,\"kept_at\":%s}\n", juce::JSON::toString (locked["slices"][1][2], true).toRawUTF8(), juce::JSON::toString (locked["slices"][1][0], true).toRawUTF8());
        press ({ tools.getX() + 10, tools.getCentreY() }, { tools.getX() + 10, tools.getCentreY() });
    }
    // Preview, then Ratchet, then stop.
    {
        const auto r = f.where ("chopPreview");
        const double t = ms ([&] { press (r.getCentre(), r.getCentre()); f.poll(); drawIn (r); });
        juce::Thread::sleep (50);
        report ("preview_click", t, "\"playing\":\"" + call (rig.a, rig.chop, "playing", "{}")["kind"].toString() + "\"");
        const auto q = f.where ("chopRatchet");
        press (q.getCentre(), q.getCentre());
        std::printf ("{\"ratchet\":\"%s\"}\n", call (rig.a, rig.chop, "playing", "{}")["kind"].toString().toRawUTF8());
        press (q.getCentre(), q.getCentre());
    }
    // A row of the list, and the colour.
    {
        const auto r = f.where ("row:3");
        const double t = ms ([&] { press (r.getCentre(), r.getCentre()); drawIn (r); });
        report ("row_click", t, "\"current\":" + juce::String ((int) state()["current"]));
        const auto c = f.where ("chopColour");
        const double tc = ms ([&] { press ({ c.getX() + c.getWidth() * 0.8f, c.getCentreY() }, { c.getX() + c.getWidth() * 0.8f, c.getCentreY() }); draw(); });
        report ("colour_click", tc, "\"ok\":true");
    }
    // Zoom and Fit.
    {
        const auto z = f.where ("chopZoomIn");
        const double t = ms ([&] { press (z.getCentre(), z.getCentre()); draw(); });
        report ("zoom_click", t, "\"ui\":" + juce::JSON::toString (state()["ui"]["view"], true));
        const auto fit = f.where ("chopZoomFit");
        press (fit.getCentre(), fit.getCentre());
    }
    for (auto& [name, t] : f.profile (2.0f))
        if (t > 1.0)
            std::printf ("  %-24s %.1f ms\n", name.toRawUTF8(), t);
    return 0;
}

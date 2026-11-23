// Prism's snapshot and bench, run from Main without a window:
//
//   idMLab --snapshot prism-face out.png scale [theme|-] [sound.wav|-] [calls|-]
//   idMLab --bench prism sound.wav
//
// A real Sound and Prism are behind the face, with no sound card. `calls` is
// a list of the module's calls, `what=json;what=json`; with none, the page as
// MGL's capture has it (the sound open, Time & Pitch on the pad).
#include "PrismBench.h"
#include "PrismFace.h"
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
    const int n = na_prism_call (a, id, what, json.toRawUTF8(), buf.data(), (uint32_t) buf.size());
    return n > 0 ? juce::JSON::parse (juce::String::fromUTF8 (buf.data(), juce::jmin (n, (int) buf.size() - 1))) : juce::var();
}

struct Rig
{
    NaApp* a = nullptr;
    uint32_t sound = 0, prism = 0;
    PrismFace::Call fn;
    explicit Rig (const juce::String& wav)
    {
        a = na_new (48000.0f, 4096);
        sound = (uint32_t) na_add (a, "sound", 0, 0);
        prism = (uint32_t) na_add (a, "prism", 400, 0);
        na_connect (a, sound, 0, prism, 0);
        fn = [this] (const std::function<int64_t (NaApp*)>& f) { return f (a); };
        if (wav.isNotEmpty() && wav != "-")
        {
            const juce::File f (wav.unquoted());
            const auto origin = "{\"kind\":\"library\",\"path\":\"kit/" + f.getFileName() + "\",\"name\":\"" + f.getFileName() + "\"}";
            std::vector<char> buf (1 << 16);
            na_sound_open (a, sound, f.getFullPathName().toRawUTF8(), origin.toRawUTF8(), 0, buf.data(), (uint32_t) buf.size());
        }
        na_collect (a);
    }
    ~Rig() { na_free (a); }
};

double ms (const std::function<void()>& f)
{
    const auto t0 = juce::Time::getMillisecondCounterHiRes();
    f();
    return juce::Time::getMillisecondCounterHiRes() - t0;
}

void mouse (PrismFace& f, juce::Point<float> p, int kind, bool shift = false)
{
    auto src = juce::Desktop::getInstance().getMainMouseSource();
    const auto t = juce::Time::getCurrentTime();
    const auto mods = juce::ModifierKeys ((kind == 3 ? 0 : juce::ModifierKeys::leftButtonModifier) | (shift ? juce::ModifierKeys::shiftModifier : 0));
    juce::MouseEvent e (src, p, mods, 0, 0, 0, 0, 0, &f, &f, t, p, t, kind == 4 ? 2 : 1, false);
    if (kind == 0) f.mouseDown (e);
    else if (kind == 1) f.mouseDrag (e);
    else if (kind == 2) f.mouseUp (e);
    else if (kind == 3) f.mouseMove (e);
    else f.mouseDoubleClick (e);
}

// Draw what a change asked to be drawn, as the window would (at 2x), and time it.
double redraw (PrismFace& f)
{
    return f.paintDirty (2.0f);
}
} // namespace

juce::Image prismSnapshot (const juce::StringArray& args, float scale)
{
    if (args.size() > 4)
        wearLabel (args[4]);
    Rig rig (args.size() > 5 ? args[5] : juce::String());
    if (args.size() > 6 && args[6] != "-")
        for (const auto& c : juce::StringArray::fromTokens (args[6].unquoted(), ";", ""))
            call (rig.a, rig.prism, c.upToFirstOccurrenceOf ("=", false, false).trim().toRawUTF8(), c.fromFirstOccurrenceOf ("=", false, false));
    PrismFace f (rig.fn, rig.prism);
    f.fixedClock = 1000;
    f.poll();
    return f.createComponentSnapshot (f.getLocalBounds(), true, scale);
}

int prismBench (const juce::StringArray& args)
{
    Rig rig (args.size() > 2 ? args[2] : juce::String());
    PrismFace f (rig.fn, rig.prism);
    f.onMessage = [] (const juce::String& m) { std::printf ("  [face says] %s\n", m.toRawUTF8()); };
    double clock = 1000;
    f.fixedClock = clock;
    f.poll();
    redraw (f);
    int bad = 0;
    std::setvbuf (stdout, nullptr, _IONBF, 0);
    auto check = [&] (const char* what, bool ok, double t, double limit) {
        std::printf ("%-44s %s  %6.1f ms%s\n", what, ok ? "ok  " : "FAIL", t, t > limit ? "  (slow)" : "");
        if (!ok || t > limit)
            ++bad;
    };
    auto view = [&] { return f.viewNow(); };
    auto at = [&] (const juce::String& part) { return f.where (part).getCentre(); };
    auto tick = [&] { clock += 17; f.fixedClock = clock; f.poll(); };

    // The pad: grab, drag, let go. A take is recorded and both controls move.
    {
        const auto r = f.where ("pad");
        double t = ms ([&] { mouse (f, { r.getX() + r.getWidth() * 0.25f, r.getY() + r.getHeight() * 0.25f }, 0); }) + redraw (f);
        for (int i = 1; i <= 10; ++i)
        {
            tick();
            t = juce::jmax (t, ms ([&] { mouse (f, { r.getX() + r.getWidth() * (0.25f + 0.05f * (float) i), r.getY() + r.getHeight() * 0.25f }, 1); }) + redraw (f));
        }
        tick();
        mouse (f, { r.getX() + r.getWidth() * 0.75f, r.getY() + r.getHeight() * 0.25f }, 2);
        const auto v = view();
        const double ratio = (double) v["stretch"]["ratio"];
        check ("pad: drag moves Stretch and Pitch", std::abs ((double) v["pad"]["hand"][0] - 0.75) < 0.01 && ratio < 1.0 && (double) v["stretch"]["semitones"] > 20, t, 20);
        f.poll();
        check ("pad: a take was recorded", view()["pad"]["mode"].toString() == "rec" && (int) view()["pad"]["recN"] > 3, 0, 20);
    }
    // ▶ plays the take; ■ stops it.
    {
        double t = ms ([&] { mouse (f, at ("play"), 0); mouse (f, at ("play"), 2); }) + redraw (f);
        for (int i = 0; i < 5; ++i)
            tick();
        check ("transport: play the take", view()["pad"]["mode"].toString() == "play" && view()["pad"]["slots"][0].isObject(), t, 40);
        t = ms ([&] { mouse (f, at ("stop"), 0); mouse (f, at ("stop"), 2); }) + redraw (f);
        check ("transport: stop", view()["pad"]["mode"].toString() == "ready", t, 40);
    }
    // A knob: dragged up, then double-clicked home.
    {
        const auto p = at ("knob:windowMs");
        const double before = (double) view()["values"]["windowMs"];
        mouse (f, p, 0);
        double t = 0;
        for (int i = 1; i <= 8; ++i)
            t = juce::jmax (t, ms ([&] { mouse (f, p - juce::Point<float> (0, 4.0f * (float) i), 1); }) + redraw (f));
        mouse (f, p - juce::Point<float> (0, 32), 2);
        const double after = (double) view()["values"]["windowMs"];
        check ("knob: Window dragged up", after > before, t, 20);
        t = ms ([&] { mouse (f, p, 4); }) + redraw (f);
        check ("knob: double-click resets Window to 46 ms", std::abs ((double) view()["values"]["windowMs"] - 46) < 1e-6, t, 40);
    }
    // The engine switch.
    {
        const double t = ms ([&] { mouse (f, at ("seg:wsola"), 0); mouse (f, at ("seg:wsola"), 2); }) + redraw (f);
        check ("engine: WSOLA", view()["stretch"]["algorithm"].toString() == "wsola", t, 40);
    }
    // A slot, the rate, a shape.
    {
        double t = ms ([&] { mouse (f, at ("slot:2"), 0); mouse (f, at ("slot:2"), 2); }) + redraw (f);
        check ("takes: slot C", (int) view()["pad"]["slot"] == 2, t, 40);
        t = ms ([&] { mouse (f, at ("rate:2"), 0); }) + redraw (f);
        check ("takes: rate x2", juce::exactlyEqual ((double) view()["pad"]["rate"], 2.0), t, 40);
        t = ms ([&] { mouse (f, at ("shape:circle"), 0); }) + redraw (f);
        check ("takes: a circle drawn in, playing", view()["pad"]["slots"][2]["shape"].toString() == "circle" && view()["pad"]["mode"].toString() == "play", t, 40);
        mouse (f, at ("stop"), 0);
    }
    // A bar: Playback speed, clicked at three quarters.
    {
        const auto r = f.where ("bar:pbSpeed");
        const double t = ms ([&] { mouse (f, { r.getX() + 34 + (r.getWidth() - 34) * 0.75f, r.getCentreY() }, 0); mouse (f, { r.getX() + 34 + (r.getWidth() - 34) * 0.75f, r.getCentreY() }, 2); }) + redraw (f);
        check ("bar: Playback speed set", (double) view()["hp"]["speed"] > 160, t, 20);
    }
    // A fader: L dragged up, its name puts it back.
    {
        const auto r = f.where ("fader:l");
        double t = ms ([&] { mouse (f, { r.getCentreX(), r.getY() + r.getHeight() * 0.2f }, 0); mouse (f, { r.getCentreX(), r.getY() + r.getHeight() * 0.2f }, 2); }) + redraw (f);
        check ("fader: L up", (double) view()["hp"]["l"] > 190, t, 20);
        t = ms ([&] { mouse (f, { r.getCentreX(), r.getY() + 5 }, 4); }) + redraw (f);
        check ("fader: double-click to the middle", juce::exactlyEqual ((double) view()["hp"]["l"], 128.0), t, 40);
    }
    // A limit typed into its corner.
    {
        const double t = ms ([&] { f.typeLimit ("yHi", "24"); }) + redraw (f);
        check ("limit: Y high typed 24", juce::exactlyEqual ((double) view()["setup"]["yHi"], 24.0), t, 40);
    }
    // The LFOs: a shape, Map, then a click on a control maps it.
    {
        double t = ms ([&] { mouse (f, at ("lfoShape:square"), 0); }) + redraw (f);
        check ("LFO: square", view()["lfos"]["lfos"][0]["shape"].toString() == "square", t, 40);
        mouse (f, at ("lfoMap"), 0);
        t = ms ([&] { mouse (f, at ("knob:cloudMix"), 0); mouse (f, at ("knob:cloudMix"), 2); }) + redraw (f);
        check ("LFO: Map, then Cloud over engine mapped", view()["lfos"]["lfos"][0]["targets"].size() == 1 && !(bool) view()["lfos"]["mapping"], t, 40);
        for (int i = 0; i < 6; ++i)
            tick();
        check ("LFO: its reach is on the knob", view()["lfoMarks"].size() == 1, 0, 40);
    }
    // The Process menu: Hyperprism's Echo chosen, added to the chain, on the pad.
    {
        mouse (f, at ("pick"), 0);
        const bool open = f.pickOpen();
        const auto p = at ("pickItem:prism:hp-echo");
        const double t = ms ([&] { f.pickAt (p); }) + redraw (f);
        const auto& ch = view()["chain"];
        check ("Process menu: Echo added and on the pad", open && ch.size() == 3 && ch[2]["kind"].toString() == "prism:hp-echo" && view()["source"] == ch[2]["id"], t, 400);
        check ("  its pair on the axes", view()["setup"]["x"].toString().isNotEmpty() && view()["setup"]["x"].toString() != "ratio", 0, 40);
    }
    // The preset bar: the next factory preset.
    {
        const double t = ms ([&] { mouse (f, at ("pbar:next"), 0); }) + redraw (f);
        check ("preset bar: the first factory preset", f.prism ("presets", juce::JSON::parse ("{\"op\":\"list\"}"))["at"].toString() == "f0", t, 40);
    }
    // The Now Playing bar: play or pause, then back.
    {
        const bool was = (bool) view()["deck"]["playing"];
        double t = ms ([&] { mouse (f, at ("nowPlay"), 0); }) + redraw (f);
        check (was ? "Now bar: pause" : "Now bar: play", (bool) view()["deck"]["playing"] != was, t, 40);
        t = ms ([&] { mouse (f, at ("nowPlay"), 0); }) + redraw (f);
        check (was ? "Now bar: play again" : "Now bar: pause again", (bool) view()["deck"]["playing"] == was, t, 40);
        t = ms ([&] { mouse (f, at ("nowLoop"), 0); }) + redraw (f);
        check ("Now bar: loop off", !(bool) view()["deck"]["looping"], t, 40);
    }
    // Every layer drawn whole, at 2x.
    for (const auto& [name, t] : f.profile (2.0f))
        std::printf ("  layer %-8s %6.1f ms\n", name.toRawUTF8(), t);
    std::printf ("%s\n", bad == 0 ? "all ok" : "some failed or slow");
    return bad == 0 ? 0 : 1;
}

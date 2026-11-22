// Grain's snapshot and bench, run from Main without a window:
//
//   idMLab --snapshot grain-face out.png scale [theme|-] [sound.wav|-] [engine|-] [key=value;...|-]
//   idMLab --bench grain [sound.wav]
//
// A real Sound and Grain are behind the face, with no sound card. With no
// sound given, the sound MGL's capture shows: two seconds at 48 kHz, two
// channels, steady (its envelope is flat, as the capture's peaks are).
#include "GrainBench.h"
#include "GrainFace.h"
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

juce::File steadySound()
{
    auto f = juce::File::getSpecialLocation (juce::File::tempDirectory).getChildFile ("grain-bench-sound.wav");
    if (f.existsAsFile())
        return f;
    // A 24-bit stereo WAV, written by hand (the app links no audio formats).
    const int frames = 96000;
    juce::MemoryOutputStream o;
    auto u32 = [&] (uint32_t v) { o.writeInt ((int) v); };
    auto u16 = [&] (uint16_t v) { o.writeShort ((short) v); };
    o.write ("RIFF", 4);
    u32 (36 + (uint32_t) frames * 6);
    o.write ("WAVEfmt ", 8);
    u32 (16);
    u16 (1);
    u16 (2);
    u32 (48000);
    u32 (48000 * 6);
    u16 (6);
    u16 (24);
    o.write ("data", 4);
    u32 ((uint32_t) frames * 6);
    for (int i = 0; i < frames; ++i)
    {
        // A square wave: its peaks and its level the same in every column.
        const int q = (int) ((i / 54) % 2 ? -0.4f * 8388607.0f : 0.4f * 8388607.0f);
        for (int ch = 0; ch < 2; ++ch)
        {
            o.writeByte ((char) (q & 0xff));
            o.writeByte ((char) ((q >> 8) & 0xff));
            o.writeByte ((char) ((q >> 16) & 0xff));
        }
    }
    f.replaceWithData (o.getData(), o.getDataSize());
    return f;
}

struct Rig
{
    NaApp* a = nullptr;
    uint32_t sound = 0, grain = 0;
    GrainFace::Call call;
    explicit Rig (juce::String wav)
    {
        a = na_new (48000.0f, 4096);
        sound = (uint32_t) na_add (a, "sound", 0, 0);
        grain = (uint32_t) na_add (a, "grain", 400, 0);
        na_connect (a, sound, 0, grain, 0);
        call = [this] (const std::function<int64_t (NaApp*)>& f) { return f (a); };
        const auto f = wav.isEmpty() || wav == "-" ? steadySound() : juce::File (wav.unquoted());
        const juce::String name = wav.isEmpty() || wav == "-" ? juce::String ("sound.wav") : f.getFileName();
        const auto origin = "{\"kind\":\"file\",\"name\":\"" + name + "\"}";
        std::vector<char> buf (1 << 16);
        na_sound_open (a, sound, f.getFullPathName().toRawUTF8(), origin.toRawUTF8(), 0, buf.data(), (uint32_t) buf.size());
        for (int i = 0; i < 50; ++i)
        {
            na_collect (a);
            juce::Thread::sleep (5);
        }
    }
    ~Rig() { na_free (a); }
};
} // namespace

juce::Image grainSnapshot (const juce::StringArray& args, float scale)
{
    if (args.size() > 4)
        wearLabel (args[4]);
    Rig rig (args.size() > 5 ? args[5] : juce::String());
    GrainFace f (rig.call, rig.grain);
    f.asCaptured = juce::SystemStats::getEnvironmentVariable ("GRAIN_AS_CAPTURED", "") == "1";
    if (args.size() > 6 && args[6] == "fx")
        f.openFx (true);
    else if (args.size() > 6 && args[6] != "-")
        f.chooseEngine (args[6].unquoted());
    if (args.size() > 7 && args[7] != "-")
        for (const auto& c : juce::StringArray::fromTokens (args[7].unquoted(), ";", ""))
            f.setControl (c.upToFirstOccurrenceOf ("=", false, false).trim(), c.fromFirstOccurrenceOf ("=", false, false).getDoubleValue());
    f.poll();
    return f.createComponentSnapshot (f.getLocalBounds(), true, scale);
}

int grainBench (const juce::StringArray& args)
{
    Rig rig (args.size() > 2 ? args[2] : juce::String());
    GrainFace f (rig.call, rig.grain);
    juce::Image frame (juce::Image::ARGB, f.getWidth() * 2, f.getHeight() * 2, true);
    auto draw = [&] {
        juce::Graphics g (frame);
        g.addTransform (juce::AffineTransform::scale (2.0f));
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
    auto deck = [&] (const char* what) {
        auto j = juce::JSON::parse (juce::String (naText ([&] (char* b, uint32_t c) { return (uint32_t) juce::jmax (0, na_grain_call (rig.a, rig.grain, what, nullptr, b, c)); })));
        return j;
    };
    auto doc = [&] { return deck ("info")["doc"]["stretch"]; };
    auto state = [&] { return juce::JSON::parse (f.stateJson()); };
    const double whole = ms (draw), again = ms (draw);
    // Every page's picture drawn once (as the first look at each engine does).
    const double warmT = ms ([&] { for (int i = 0; i < 9; ++i) f.warm(); });
    std::printf ("{\"first_look_all_pages_ms\":%.1f}\n", warmT);
    // A part drawn again as JUCE draws it: only where it changed.
    auto drawIn = [&] (juce::Rectangle<float> r) {
        juce::Graphics g (frame);
        g.addTransform (juce::AffineTransform::scale (2.0f));
        g.reduceClipRegion (r.expanded (8).toNearestInt());
        f.paintEntireComponent (g, true);
    };
    std::printf ("{\"whole_ms\":%.1f,\"again_ms\":%.1f}\n", whole, again);
    auto report = [] (const char* name, double t, const juce::String& what) { std::printf ("{\"%s_ms\":%.1f,%s}\n", name, t, what.toRawUTF8()); };

    // A bar: a click in Stretch's well, then a drag along it; the document's
    // ratio read back from the engine.
    {
        const auto r = f.where ("bar:ratio");
        const double click = ms ([&] { press ({ r.getX() + r.getWidth() * 0.75f, r.getCentreY() }, { r.getX() + r.getWidth() * 0.75f, r.getCentreY() }); f.poll(); draw(); });
        juce::Thread::sleep (120);
        f.poll();
        report ("bar_click", click, "\"ratio\":" + juce::String ((double) doc()["ratio"]));
        double drag = 0;
        for (int i = 0; i < 5; ++i)
            drag += ms ([&] { press ({ r.getX() + 30, r.getCentreY() }, { r.getX() + 60.0f + i * 10, r.getCentreY() }); draw(); });
        juce::Thread::sleep (120);
        f.poll();
        report ("bar_drag", drag / 5, "\"ratio\":" + juce::String ((double) doc()["ratio"]));
        // Double-click: back to its default.
        press (r.getCentre(), r.getCentre(), juce::ModifierKeys (juce::ModifierKeys::leftButtonModifier), 2);
        juce::Thread::sleep (120);
        f.poll();
        std::printf ("{\"bar_reset_ratio\":%g}\n", (double) doc()["ratio"]);
    }
    // What a step of the clock costs, and an edit alone.
    {
        const double poll = ms ([&] { f.poll(); });
        const double edit = ms ([&] { f.setControl ("fbAmount", 0.3, true); });
        std::printf ("{\"poll_ms\":%.1f,\"edit_ms\":%.1f}\n", poll, edit);
    }
    // A switch: reverse grains.
    {
        const auto r = f.where ("bar:reverse");
        const double t1 = ms ([&] { press (r.getCentre(), r.getCentre()); });
        juce::Thread::sleep (100);
        const double t2 = ms ([&] { f.poll(); });
        const double t3 = ms ([&] { draw(); });
        const double t4 = ms ([&] { draw(); });
        for (auto& [name, t] : f.profile (2.0f))
            if (t > 20.0)
                std::printf ("  slow layer %s %.1f ms\n", name.toRawUTF8(), t);
        std::printf ("{\"switch_draw_again_ms\":%.1f}\n", t4);
        std::printf ("{\"switch_press_ms\":%.1f,\"switch_poll_ms\":%.1f,\"switch_draw_ms\":%.1f}\n", t1, t2, t3);
        const double click = t1 + t2 + t3;
        report ("switch_click", click, "\"reverse\":" + juce::String ((bool) doc()["grain"]["reverse"] ? "true" : "false"));
    }
    // An engine tab, then a choice in its panel (WSOLA's Pick).
    {
        const auto r = f.where ("tab:granular");
        const double click = ms ([&] { press (r.getCentre(), r.getCentre()); f.poll(); draw(); });
        report ("tab_click", click, "\"algorithm\":\"" + doc()["algorithm"].toString() + "\"");
        const auto w = f.where ("tab:wsola");
        press (w.getCentre(), w.getCentre());
        const auto p = f.where ("bar:splicePick");
        const double seg = ms ([&] { press ({ p.getRight() - 10, p.getCentreY() }, { p.getRight() - 10, p.getCentreY() }); juce::Thread::sleep (100); f.poll(); draw(); });
        report ("choice_click", seg, "\"splice\":\"" + doc()["wsola"]["splice"].toString() + "\"");
    }
    // AMP: drag the release point right.
    {
        const auto r = f.where ("gsAmp");
        const double t = ms ([&] { press ({ r.getRight() - 150, r.getCentreY() }, { r.getRight() - 110, r.getCentreY() }); draw(); });
        report ("amp_drag", t, "\"amp\":" + juce::JSON::toString (state()["amp"], true));
    }
    // An LFO: its shape, its rate knob, Map onto Position jitter.
    {
        const auto s = f.where ("gsLshp0");
        const double shape = ms ([&] { press ({ s.getX() + s.getWidth() * (4.5f / 7), s.getCentreY() }, { s.getX() + s.getWidth() * (4.5f / 7), s.getCentreY() }); draw(); });
        const auto k = f.where ("gsLkr0");
        const double knob = ms ([&] { press ({ k.getX() + 13, k.getCentreY() }, { k.getX() + 13, k.getCentreY() - 30 }); draw(); });
        const auto m = f.where ("gsLmap0");
        press (m.getCentre(), m.getCentre());
        const auto b = f.where ("bar:positionJitterMs");
        press (b.getCentre(), b.getCentre());
        const auto lfos = juce::JSON::parse (juce::JSON::toString (state()["lfo"][0]));
        report ("lfo_shape", shape, "\"lfo\":" + juce::JSON::toString (lfos, true));
        report ("lfo_knob", knob, "\"heard\":" + juce::JSON::toString (deck ("lfos-state")["heard"], true));
    }
    // The dock: Poly, Run, a key held.
    {
        const auto v = f.where ("gsVmode");
        press ({ v.getRight() - 10, v.getCentreY() }, { v.getRight() - 10, v.getCentreY() });
        const auto k = f.where ("gsKeys");
        const double key = ms ([&] { press ({ k.getX() + 14 + 28 * 7, k.getBottom() - 10 }, { k.getX() + 14 + 28 * 7, k.getBottom() - 10 }); draw(); });
        report ("key_click", key, "\"voice\":\"" + state()["voice"].toString() + "\"");
    }
    // SOURCE: a drag across makes a loop; the loop chip turns it on.
    {
        const auto c = f.where ("gsCloud");
        const double t = ms ([&] { press ({ c.getX() + 300, c.getCentreY() }, { c.getX() + 700, c.getCentreY() }); draw(); });
        const auto l = f.where ("gsLoopChip");
        press (l.getCentre(), l.getCentre());
        report ("loop_drag", t, "\"sel\":" + juce::JSON::toString (state()["sel"], true) + ",\"loop\":" + (state()["loop"] ? "true" : "false"));
    }
    // A knob's move and a click, as the playbook times them.
    {
        const auto r = f.where ("bar:windowMs");
        double move = 0;
        for (int i = 0; i < 10; ++i)
            move += ms ([&] { press ({ r.getX() + 40.0f + i * 3, r.getCentreY() }, { r.getX() + 41.0f + i * 3, r.getCentreY() }); drawIn (r); });
        std::printf ("{\"knob_move_ms\":%.1f}\n", move / 10);
        // A click, drawn where it changes: a switch, an engine, an LFO shape.
        const auto sw = f.where ("bar:wrap");
        const double swc = ms ([&] { press (sw.getCentre(), sw.getCentre()); drawIn (sw); });
        const auto tb = f.where ("tab:vocoder");
        const double tbc = ms ([&] { press (tb.getCentre(), tb.getCentre()); draw(); });
        const auto sh = f.where ("gsLshp1");
        const double shc = ms ([&] { press ({ sh.getX() + 5, sh.getCentreY() }, { sh.getX() + 5, sh.getCentreY() }); drawIn (sh); });
        std::printf ("{\"switch_click_ms\":%.1f,\"engine_click_ms\":%.1f,\"lfo_click_ms\":%.1f}\n", swc, tbc, shc);
    }
    for (auto& [name, t] : f.profile (2.0f))
        if (t > 1.0)
            std::printf ("  %-24s %.1f ms\n", name.toRawUTF8(), t);
    return 0;
}

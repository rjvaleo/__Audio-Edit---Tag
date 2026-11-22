// Edit's and Sound's snapshot and bench, run from Main without a window:
//
//   idMLab --snapshot edit-face out.png scale [theme_label|-] [sound.wav|-] [commands|-]
//   idMLab --snapshot sound-face out.png scale [theme_label|-] [sound.wav|-]
//   idMLab --bench edit sound.wav
//
// The commands are the bar's ids, run in order, a range given as "sel=a,b"
// and the view as "view=a,b" (frames). A real Sound and Edit are behind the
// face, with no sound card.
#include "EditBench.h"
#include "EditFace.h"
#include "SoundFace.h"

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

struct Rig
{
    NaApp* a = nullptr;
    uint32_t sound = 0, edit = 0;
    EditFace::Call call;
    explicit Rig (const juce::String& wav)
    {
        a = na_new (48000.0f, 4096);
        sound = (uint32_t) na_add (a, "sound", 0, 0);
        edit = (uint32_t) na_add (a, "edit", 400, 0);
        na_connect (a, sound, 0, edit, 0);
        call = [this] (const std::function<int64_t (NaApp*)>& f) { return f (a); };
        if (wav.isNotEmpty() && wav != "-")
        {
            const auto f = juce::File (wav.unquoted());
            const auto origin = "{\"kind\":\"file\",\"name\":\"" + f.getFileName() + "\"}";
            std::vector<char> buf (1 << 16);
            na_sound_open (a, sound, f.getFullPathName().toRawUTF8(), origin.toRawUTF8(), 0, buf.data(), (uint32_t) buf.size());
            settle();
        }
    }
    // The page's measures are made on a helper thread: wait for them.
    void settle()
    {
        for (int i = 0; i < 400; ++i)
        {
            na_collect (a);
            std::vector<char> buf (1 << 16);
            const int n = na_sound_info (a, sound, buf.data(), (uint32_t) buf.size());
            if (n > 0 && n < (int) buf.size() && (bool) juce::JSON::parse (juce::String::fromUTF8 (buf.data(), n))["measured"])
                return;
            juce::Thread::sleep (10);
        }
    }
    ~Rig() { na_free (a); }
};

void command (EditFace& f, const juce::String& c)
{
    if (c.startsWith ("sel=") || c.startsWith ("view="))
    {
        const auto v = juce::StringArray::fromTokens (c.fromFirstOccurrenceOf ("=", false, false), ",", "");
        auto state = juce::JSON::parse (f.stateJson());
        auto* o = state.getDynamicObject();
        auto* r = new juce::DynamicObject();
        r->setProperty (c.startsWith ("sel") ? "start" : "from", v[0].getDoubleValue());
        r->setProperty (c.startsWith ("sel") ? "end" : "to", v[1].getDoubleValue());
        o->setProperty (c.startsWith ("sel") ? "sel" : "view", juce::var (r));
        if (c.startsWith ("sel"))
            o->setProperty ("cue", v[0].getDoubleValue());
        f.restoreForBench (state);
        return;
    }
    f.run (c);
}
} // namespace

juce::Image editSnapshot (const juce::StringArray& args, float scale)
{
    if (args.size() > 4)
        wearLabel (args[4]);
    Rig rig (args.size() > 5 ? args[5] : juce::String());
    if (args[1] == "sound-face")
    {
        SoundFace s (rig.call, rig.sound);
        return s.createComponentSnapshot (s.getLocalBounds(), true, scale);
    }
    EditFace f (rig.call, rig.edit);
    if (args.size() > 6 && args[6] != "-")
        for (const auto& c : juce::StringArray::fromTokens (args[6].unquoted(), ";", ""))
            command (f, c.trim());
    rig.settle();
    f.poll();
    f.reload();
    return f.createComponentSnapshot (f.getLocalBounds(), true, scale);
}

int editBench (const juce::StringArray& args)
{
    Rig rig (args.size() > 2 ? args[2] : juce::String());
    EditFace f (rig.call, rig.edit);
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
    const double whole = ms (draw), again = ms (draw);
    // The controls by hand: synthetic presses where the page has them.
    auto press = [&] (juce::Point<float> at, juce::Point<float> to, juce::ModifierKeys mods = juce::ModifierKeys (juce::ModifierKeys::leftButtonModifier)) {
        auto src = juce::Desktop::getInstance().getMainMouseSource();
        const auto now = juce::Time::getCurrentTime();
        auto ev = [&] (juce::Point<float> p, bool dragged) {
            return juce::MouseEvent (src, p, mods, 1.0f, 0, 0, 0, 0, &f, &f, now, at, now, 1, dragged);
        };
        f.mouseDown (ev (at, false));
        if (to != at)
        {
            f.mouseDrag (ev ((at + to) / 2, true));
            f.mouseDrag (ev (to, true));
        }
        f.mouseUp (ev (to, to != at));
    };
    auto state = [&] { return juce::JSON::parse (f.stateJson()); };
    auto info = [&] {
        std::vector<char> buf (1 << 16);
        const int n = na_sound_info (rig.a, rig.sound, buf.data(), (uint32_t) buf.size());
        return juce::JSON::parse (juce::String::fromUTF8 (buf.data(), std::max (0, n)));
    };
    const auto lane = f.where ("wave");
    std::printf ("{\"whole_ms\":%.1f,\"again_ms\":%.1f}\n", whole, again);
    // A drag across the wave: a selection.
    const double drag = ms ([&] { press ({ lane.getX() + 300, lane.getCentreY() }, { lane.getX() + 700, lane.getCentreY() }); draw(); });
    auto s = state();
    std::printf ("{\"select_drag_ms\":%.1f,\"sel\":[%.0f,%.0f]}\n", drag, (double) s["sel"]["start"], (double) s["sel"]["end"]);
    // A click on the bar: Reverse; then Undo.
    const auto frames0 = (double) info()["frames"];
    const double click = ms ([&] { const auto r = f.where ("cmd:reverse"); press (r.getCentre(), r.getCentre()); draw(); });
    std::printf ("{\"reverse_click_ms\":%.1f,\"canUndo\":%s,\"clips\":%d}\n", click, (bool) info()["canUndo"] ? "true" : "false", info()["clips"].getArray()->size());
    { const auto r = f.where ("cmd:undo"); press (r.getCentre(), r.getCentre()); }
    std::printf ("{\"undone\":%s}\n", (bool) info()["canRedo"] ? "true" : "false");
    // Zoom in and the Fit button.
    const double zoomIn = ms ([&] { const auto r = f.where ("cmd:zoomIn"); press (r.getCentre(), r.getCentre()); draw(); });
    s = state();
    std::printf ("{\"zoom_click_ms\":%.1f,\"view\":[%.0f,%.0f]}\n", zoomIn, (double) s["view"]["from"], (double) s["view"]["to"]);
    { const auto r = f.where ("cmd:fit"); press (r.getCentre(), r.getCentre()); }
    // A toggle: Rainbow off and on.
    const double toggle = ms ([&] { const auto r = f.where ("cmd:edRainbow"); press (r.getCentre(), r.getCentre()); draw(); });
    std::printf ("{\"rainbow_click_ms\":%.1f,\"rainbow\":%s}\n", toggle, (bool) state()["prefs"]["rainbow"] ? "true" : "false");
    { const auto r = f.where ("cmd:edRainbow"); press (r.getCentre(), r.getCentre()); }
    // Select again, and drag the left fade handle in by 60 px.
    press ({ lane.getX() + 300, lane.getCentreY() }, { lane.getX() + 700, lane.getCentreY() });
    s = state();
    const double fadeDrag = ms ([&] {
        const float x = lane.getX() + 300 + 1;
        press ({ x, lane.getY() + 12 }, { x + 60, lane.getY() + 12 });
        draw();
    });
    std::printf ("{\"fade_drag_ms\":%.1f,\"fadeIn\":%s}\n", fadeDrag, juce::JSON::toString (info()["clips"], true).toRawUTF8());
    // A ▾ and its knob: Gain's, turned up 40 px, then the command.
    { const auto r = f.where ("more:gain"); press (r.getCentre(), r.getCentre()); }
    const auto popR = f.where ("pop");
    double knob = 0;
    if (!popR.isEmpty())
        for (int i = 0; i < 10; ++i)
            knob += ms ([&] { auto* p = f.getChildComponent (f.getNumChildComponents() - 1); if (p != nullptr) { auto src = juce::Desktop::getInstance().getMainMouseSource(); const auto now = juce::Time::getCurrentTime(); juce::Point<float> a0 (40, 30), a1 (40, 26);
                                                       p->mouseDown (juce::MouseEvent (src, a0, juce::ModifierKeys (juce::ModifierKeys::leftButtonModifier), 1, 0, 0, 0, 0, p, p, now, a0, now, 1, false));
                                                       p->mouseDrag (juce::MouseEvent (src, a1, juce::ModifierKeys (juce::ModifierKeys::leftButtonModifier), 1, 0, 0, 0, 0, p, p, now, a0, now, 1, true));
                                                       p->mouseUp (juce::MouseEvent (src, a1, juce::ModifierKeys (juce::ModifierKeys::leftButtonModifier), 1, 0, 0, 0, 0, p, p, now, a0, now, 1, true)); }
                                                draw(); });
    std::printf ("{\"knob_move_ms\":%.1f,\"gainDb\":%.1f}\n", knob / 10, (double) state()["params"]["gainDb"]);
    // What an edit costs on its own, and a click that changes no sound.
    press ({ lane.getX() + 300, lane.getCentreY() }, { lane.getX() + 700, lane.getCentreY() });
    const double editOnly = ms ([&] { f.run ("reverse"); });
    const double cueClick = ms ([&] { press ({ lane.getX() + 900, lane.getCentreY() }, { lane.getX() + 900, lane.getCentreY() }); draw(); });
    std::printf ("{\"reverse_edit_ms\":%.1f,\"cue_click_ms\":%.1f}\n", editOnly, cueClick);
    // The transport: play, a block of sound, the head moved; the loop.
    const double playClick = ms ([&] { const auto r = f.where ("play"); press (r.getCentre(), r.getCentre()); draw(); });
    std::vector<float> l (4800), r (4800);
    for (int i = 0; i < 5; ++i)
        na_render (rig.a, l.data(), r.data(), 4800);
    f.poll();
    s = state();
    std::printf ("{\"play_click_ms\":%.1f,\"playing\":%s,\"head\":%.0f}\n", playClick, (bool) s["playing"] ? "true" : "false", (double) s["head"]);
    { const auto q = f.where ("loop"); press (q.getCentre(), q.getCentre()); }
    { const auto q = f.where ("stop"); press (q.getCentre(), q.getCentre()); }
    std::printf ("{\"loop\":%s}\n", (bool) state()["loop"] ? "true" : "false");
    // The overview: drag the loop's right bracket left 100 px.
    command (f, "sel=22050,66150");
    {
        const auto o = f.where ("overview");
        s = state();
        const double len = (double) info()["frames"];
        const float W = o.getWidth() - 12;
        const float bx = o.getX() + 6 + (float) ((double) s["sel"]["end"] / len) * W;
        press ({ bx, o.getY() + 20 }, { bx - 100, o.getY() + 20 });
        s = state();
        std::printf ("{\"bracket_sel\":[%.0f,%.0f]}\n", (double) s["sel"]["start"], (double) s["sel"]["end"]);
    }
    juce::ignoreUnused (frames0);
    for (auto& [name, t] : f.profile (2.0f))
        if (t > 1.0)
            std::printf ("  %-10s %.1f ms\n", name.toRawUTF8(), t);
    return 0;
}

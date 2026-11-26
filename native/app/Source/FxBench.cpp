// The FX modules' snapshots and bench, run from Main without a window:
//
//   idMLab --snapshot fx-face out.png scale [theme|-] [sound.wav|-]
//       the FX page (the page itself, 1388 x 990, cut from the module, to
//       hold against MGL's capture)
//   idMLab --snapshot fx-card out.png scale [theme|-] <kind>
//       one effect module (its card)
//   idMLab --snapshot fx-cards <folder> scale [theme|-]
//       every effect module, fx-card-<kind>.png each, as capture-fx.mjs names them
//   idMLab --snapshot fx-reverb out.png scale [theme|-] [mode]
//       the Reverb window on a Reverb module of that mode
//   idMLab --bench fx sound.wav
//
// A real Sound and FX module are behind the face, with no sound card.
#include "FxBench.h"
#include "FxFace.h"
#include "FxReverb.h"
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

struct Rig
{
    NaApp* a = nullptr;
    uint32_t sound = 0, fx = 0;
    FxFace::Call fn;
    Rig (const juce::String& kind, const juce::String& wav)
    {
        a = na_new (48000.0f, 4096);
        sound = (uint32_t) na_add (a, "sound", 0, 0);
        fx = (uint32_t) na_add (a, kind.toRawUTF8(), 400, 0);
        if (kind == "fx")
            na_connect (a, sound, 0, fx, 0);
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

void mouse (juce::Component& c, juce::Point<float> p, int kind, bool shift = false)
{
    auto src = juce::Desktop::getInstance().getMainMouseSource();
    const auto t = juce::Time::getCurrentTime();
    const auto mods = juce::ModifierKeys (juce::ModifierKeys::leftButtonModifier | (shift ? juce::ModifierKeys::shiftModifier : 0));
    juce::MouseEvent e (src, p, mods, 0, 0, 0, 0, 0, &c, &c, t, p, t, kind == 4 ? 2 : 1, false);
    if (kind == 0) c.mouseDown (e);
    else if (kind == 1) c.mouseDrag (e);
    else if (kind == 2) c.mouseUp (e);
    else c.mouseDoubleClick (e);
}

juce::var slotOf (FxFace& f, int i)
{
    f.reload();
    return f.info()["rack"]["slots"][i];
}
} // namespace

juce::Image fxSnapshot (const juce::StringArray& args, float scale)
{
    // args: --snapshot <page> <out> <scale> [theme] [sound|kind|mode]
    const auto page = args[1];
    if (args.size() > 4)
        wearLabel (args[4]);
    const auto extra = args.size() > 5 ? args[5] : juce::String();
    if (page == "fx-card")
    {
        Rig rig ("fx:" + extra, "-");
        FxFace f (rig.fn, rig.fx, false);
        return f.createComponentSnapshot (f.getLocalBounds(), true, scale);
    }
    if (page == "fx-reverb")
    {
        Rig rig ("fx:prism:" + (extra.isEmpty() || extra == "-" ? juce::String ("sm-gemini") : extra), "-");
        FxFace f (rig.fn, rig.fx, false);
        auto o = juce::var (new juce::DynamicObject());
        o.getDynamicObject()->setProperty ("op", "open");
        if (auto* c = f.card (0); c != nullptr && c->send)
            c->send (o);
        if (auto* rv = f.reverbWindow(); rv != nullptr && rv->view() != nullptr)
            return rv->view()->createComponentSnapshot (rv->view()->getLocalBounds(), true, scale);
        return {};
    }
    Rig rig ("fx", extra);
    FxFace f (rig.fn, rig.fx, true);
    f.setPcList (juce::var (juce::Array<juce::var>()));
    // The rack MGL's capture shows (capture-fx.mjs's FACTORY_RACK: the first
    // preset saved in MGL's own Grain route test).
    {
        const auto refs = juce::JSON::parse (juce::File (__FILE__).getParentDirectory().getChildFile ("../../engine-app/tests/reference/grain/refs.json").loadFileAsString());
        auto rack = refs["presetsSaved"]["presets"][0]["rack"];
        if (rack.isObject())
        {
            rack.getDynamicObject()->setProperty ("op", "set");
            f.fx ("rack", rack);
            f.reload();
        }
    }
    f.poll();
    // The page itself, as MGL's capture has it.
    return f.createComponentSnapshot ({ (int) FxFace::pageX, 0, 1388, (int) FxFace::nowY }, true, scale);
}

int fxCards (const juce::StringArray& args)
{
    // --snapshot fx-cards <folder> <scale> [theme]
    const juce::File out (args[2].unquoted());
    out.createDirectory();
    const float scale = args.size() > 3 ? args[3].getFloatValue() : 1.0f;
    if (args.size() > 4)
        wearLabel (args[4]);
    const auto kinds = juce::JSON::parse (juce::String (naText ([] (char* b, uint32_t cap) { return na_kinds (b, cap); })));
    int n = 0;
    if (auto* list = kinds.getArray())
        for (const auto& k : *list)
        {
            const auto id = k["id"].toString();
            if (! id.startsWith ("fx:"))
                continue;
            Rig rig (id, "-");
            FxFace f (rig.fn, rig.fx, false);
            auto im = f.createComponentSnapshot (f.getLocalBounds(), true, scale);
            juce::PNGImageFormat png;
            // capture-fx.mjs's names: anything but letters, digits and - as _.
            juce::String name;
            for (auto ch : id.substring (3))
                name += juce::CharacterFunctions::isLetterOrDigit (ch) || ch == '-' ? juce::String::charToString (ch) : juce::String ("_");
            auto file = out.getChildFile ("fx-card-" + name + ".png");
            file.deleteFile();
            if (auto s = file.createOutputStream())
                png.writeImageToStream (im, *s);
            ++n;
        }
    std::printf ("%d cards into %s\n", n, out.getFullPathName().toRawUTF8());
    return 0;
}

int fxBench (const juce::StringArray& args)
{
    Rig rig ("fx", args.size() > 2 ? args[2] : juce::String());
    FxFace f (rig.fn, rig.fx, true);
    f.onMessage = [] (const juce::String& m) { std::printf ("  [face says] %s\n", m.toRawUTF8()); };
    f.poll();
    f.paintDirty (2.0f);
    int bad = 0;
    std::setvbuf (stdout, nullptr, _IONBF, 0);
    auto check = [&] (const char* what, bool ok, double t, double limit) {
        std::printf ("%-52s %s  %6.1f ms%s\n", what, ok ? "ok  " : "FAIL", t, t > limit ? "  (slow)" : "");
        if (! ok || t > limit)
            ++bad;
    };
    auto at = [&] (const juce::String& part) { return f.where (part).getCentre(); };
    auto redraw = [&] { return f.paintDirty (2.0f); };
    auto num = [] (const juce::var& v) { return v.isVoid() ? -1.0e9 : (double) v; };

    // The compressor's Ratio: dragged up, then double-clicked home.
    {
        const auto p = at ("card:1/knob:ratio");
        const double before = num (slotOf (f, 1)["ratio"]);
        double t = ms ([&] { mouse (f, p, 0); mouse (f, p - juce::Point<float> (0, 40), 1); mouse (f, p - juce::Point<float> (0, 40), 2); }) + redraw();
        const double after = num (slotOf (f, 1)["ratio"]);
        check ("a knob dragged (Comp Ratio up)", after > before, t, 20);
        t = ms ([&] { mouse (f, p, 4); }) + redraw();
        check ("a knob double-clicked home (Ratio 4)", std::abs (num (slotOf (f, 1)["ratio"]) - 4) < 1e-9, t, 40);
    }
    // The EQ's band gain (the band picked, 3).
    {
        const auto p = at ("card:0/knob:band.sel.gainDb");
        double t = ms ([&] { mouse (f, p, 0); mouse (f, p - juce::Point<float> (0, 30), 1); mouse (f, p - juce::Point<float> (0, 30), 2); }) + redraw();
        check ("the EQ's band 3 gain dragged up", num (slotOf (f, 0)["bands"][2]["gainDb"]) > 0, t, 20);
    }
    // The EQ: band 5 picked, switched on, made a high shelf.
    {
        const auto tabs = f.where ("card:0");
        juce::ignoreUnused (tabs);
        double t = ms ([&] {
            if (auto* c = f.card (0))
            {
                const auto at = f.where ("card:0").getPosition();
                const auto tab = c->where ("eqTab:4");
                mouse (f, at + tab.getCentre(), 0);
                mouse (f, at + tab.getCentre(), 2);
                mouse (f, at + c->where ("eqOn").getCentre(), 0);
                mouse (f, at + c->where ("eqOn").getCentre(), 2);
                mouse (f, at + c->where ("eqType:4").getCentre(), 0);
                mouse (f, at + c->where ("eqType:4").getCentre(), 2);
            }
        }) + redraw();
        const auto b = slotOf (f, 0)["bands"][4];
        check ("the EQ: band 5 picked, on, a high shelf", (bool) b["enabled"] && b["type"].toString() == "highshelf", t, 120);
    }
    // The footer: Wet / dry dragged to the middle.
    {
        const auto r = f.where ("card:1/foot:wet");
        double t = ms ([&] { mouse (f, r.getCentre(), 0); mouse (f, r.getCentre(), 2); }) + redraw();
        const double w = num (slotOf (f, 1)["wet"]);
        check ("the footer's Wet / dry set to the middle", w > 0.3 && w < 0.7, t, 20);
    }
    // Power off and on.
    {
        double t = ms ([&] { mouse (f, at ("card:1/power"), 0); mouse (f, at ("card:1/power"), 2); }) + redraw();
        check ("a card switched off (power)", (bool) slotOf (f, 1)["bypassed"], t, 40);
        mouse (f, at ("card:1/power"), 0);
        mouse (f, at ("card:1/power"), 2);
        check ("and on again", ! (bool) slotOf (f, 1)["bypassed"], 0, 40);
    }
    // The Add menu: ＋ Add effect, Reverb, Mesh 16 (Gemini).
    {
        double t = ms ([&] { mouse (f, at ("addChip"), 0); mouse (f, at ("addChip"), 2); }) + redraw();
        check ("the Add menu opened", f.pickerOpen(), t, 120);
        t = ms ([&] { mouse (f, at ("addCat:Reverb"), 0); mouse (f, at ("addCat:Reverb"), 2); }) + redraw();
        check ("its Reverb module opened", f.pickerOpen(), t, 400);
        t = ms ([&] { mouse (f, at ("addItem:reverb/sm-gemini"), 0); mouse (f, at ("addItem:reverb/sm-gemini"), 2); }) + redraw();
        const auto s = slotOf (f, 2);
        check ("Gemini added to the rack", s["mode"].toString() == "sm-gemini" && ! f.pickerOpen(), t, 200);
    }
    // A Reverb card's Open: the Reverb window.
    {
        double t = ms ([&] { mouse (f, at ("card:2/open"), 0); mouse (f, at ("card:2/open"), 2); });
        check ("a Reverb card's Open: the Reverb window", f.reverbWindow() != nullptr && f.reverbWindow()->isOpen(), t, 400);
        if (auto* rv = f.reverbWindow())
            rv->close();
    }
    // The faders: LR down.
    {
        const auto r = f.where ("fader:lr");
        double t = ms ([&] { mouse (f, { r.getCentreX(), r.getY() + r.getHeight() * 0.75f }, 0); mouse (f, { r.getCentreX(), r.getY() + r.getHeight() * 0.75f }, 2); }) + redraw();
        f.reload();
        const double v = num (f.info()["transport"]["volume"]);
        check ("the LR fader dragged down", v < 0.5, t, 20);
    }
    // The card's header dragged along the rail: Comp before the EQ.
    {
        const auto from = f.where ("card:1");
        const auto to = f.where ("card:0");
        double t = ms ([&] {
            mouse (f, { from.getX() + 120, from.getY() + 20 }, 0);
            mouse (f, { to.getX() + 60, to.getY() + 20 }, 1);
            mouse (f, { to.getX() + 60, to.getY() + 20 }, 2);
        }) + redraw();
        check ("a card dragged by its title to the front", slotOf (f, 0)["kind"].toString() == "comp", t, 200);
    }
    // Play, on the Now bar.
    {
        double t = ms ([&] { mouse (f, at ("play"), 0); mouse (f, at ("play"), 2); }) + redraw();
        f.reload();
        check ("play on the Now bar", (bool) f.info()["transport"]["playing"], t, 40);
    }
    // An effect module on its own: Echo's feedback dragged, a tile, the pad.
    {
        Rig one ("fx:prism:echo", "-");
        FxFace e (one.fn, one.fx, false);
        e.paintDirty (2.0f);
        const auto p = e.where ("card:0/knob:feedback").getCentre();
        const double before = num (e.info()["rack"]["slots"][0]["params"]["feedback"]);
        double t = ms ([&] { mouse (e, p, 0); mouse (e, p - juce::Point<float> (0, 30), 1); mouse (e, p - juce::Point<float> (0, 30), 2); }) + e.paintDirty (2.0f);
        e.reload();
        check ("an effect module's knob (Echo Feedback up)", num (e.info()["rack"]["slots"][0]["params"]["feedback"]) > before, t, 20);
        const auto d = e.where ("card:0/display");
        t = ms ([&] { mouse (e, { d.getX() + d.getWidth() * 0.8f, d.getY() + d.getHeight() * 0.2f }, 0); mouse (e, { d.getX() + d.getWidth() * 0.8f, d.getY() + d.getHeight() * 0.2f }, 2); }) + e.paintDirty (2.0f);
        e.reload();
        check ("its display dragged as the pad", ! juce::exactlyEqual (num (e.info()["rack"]["slots"][0]["params"]["feedback"]), before), t, 40);
    }
    {
        Rig one ("fx:schroeder_reverb", "-");
        FxFace e (one.fn, one.fx, false);
        e.reload();
        juce::String key;
        if (auto* sh = e.info()["rack"]["slots"][0]["params"].getDynamicObject())
            for (const auto& p : sh->getProperties())
                if (! e.where ("card:0/tile:" + p.name.toString()).isEmpty())
                    key = p.name.toString();
        const double before = num (e.info()["rack"]["slots"][0]["params"][juce::Identifier (key.isEmpty() ? "x" : key)]);
        double t = ms ([&] { mouse (e, e.where ("card:0/tile:" + key).getCentre(), 0); mouse (e, e.where ("card:0/tile:" + key).getCentre(), 2); }) + e.paintDirty (2.0f);
        e.reload();
        check ("a switch tile clicked (Schroeder)", key.isNotEmpty() && ! juce::exactlyEqual (num (e.info()["rack"]["slots"][0]["params"][juce::Identifier (key)]), before), t, 40);
    }
    std::printf ("%s\n", bad == 0 ? "all passed" : "some failed or were slow");
    return bad == 0 ? 0 : 1;
}

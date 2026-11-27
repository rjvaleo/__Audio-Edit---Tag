// Browse's and Library's snapshots and bench, run from Main without a window:
//
//   idMLab --snapshot browse-face out.png scale [theme|-]
//   idMLab --snapshot library-face out.png scale [theme|-]
//   idMLab --bench browse
//
// A real module is behind the face, with no sound card, and MGL's library in
// the app (MGL_LIBRARY_HOME, or the app's own copy) answering at once. The
// Browse snapshot shows what MGL's capture does: the first folder open, its
// first sound picked, Drums the type.
#include "BrowseBench.h"
#include "BrowseFace.h"

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
    uint32_t id = 0, sound = 0, out = 0;
    browse::Base::Call fn;
    explicit Rig (const char* kind)
    {
        a = na_new (48000.0f, 4096);
        id = (uint32_t) na_add (a, kind, 0, 0);
        sound = (uint32_t) na_add (a, "sound", 1600, 0);
        out = (uint32_t) na_add (a, "output", 1600, 300);
        na_connect (a, id, 0, sound, 0);
        na_connect (a, id, 1, out, 0);
        fn = [this] (const std::function<int64_t (NaApp*)>& f) { return f (a); };
    }
    ~Rig() { na_free (a); }
    juce::var call (const char* what, const juce::var& v = {})
    {
        std::vector<char> buf (1 << 20);
        const auto json = v.isVoid() ? juce::String() : juce::JSON::toString (v, true);
        const int n = na_browse_call (a, id, what, json.isEmpty() ? nullptr : json.toRawUTF8(), buf.data(), (uint32_t) buf.size());
        return n > 0 ? juce::JSON::parse (juce::String::fromUTF8 (buf.data())) : juce::var();
    }
};

// The capture's state: the first folder open, its first listed sound picked, Drums.
juce::var captureUi()
{
    const auto folders = mgllib::call ("GET", "/api/folders").json();
    const auto orderAnswer = mgllib::call ("GET", "/api/order").json();
    const auto order = orderAnswer.isArray() ? orderAnswer : orderAnswer["order"];
    juce::String first;
    if (auto* o = order.getArray())
        for (const auto& n : *o)
            if (auto* fs = folders.getArray())
                for (const auto& f : *fs)
                    if (first.isEmpty() && f["name"].toString() == n.toString())
                        first = n.toString();
    if (first.isEmpty() && folders.size() > 0)
        first = folders[0]["name"].toString();
    juce::String picked;
    const auto listed = mgllib::call ("GET", "/api/files?folder=" + mgllib::esc (first)).json();
    if (auto* fs = listed.getArray())
        for (const auto& f : *fs)
        {
            const auto fmt = f["format"].toString();
            if (picked.isEmpty() && (fmt.startsWith ("WAV") || fmt.startsWith ("AIFF") || fmt.startsWith ("AIFC")))
                picked = f["path"].toString();
        }
    juce::DynamicObject::Ptr o = new juce::DynamicObject();
    o->setProperty ("pane", "browse");
    o->setProperty ("open", juce::Array<juce::var> { first });
    o->setProperty ("picked", picked);
    o->setProperty ("type", "Drums");
    return juce::var (o.get());
}

void mouse (juce::Component& f, juce::Point<float> p, int kind)
{
    auto src = juce::Desktop::getInstance().getMainMouseSource();
    const auto t = juce::Time::getCurrentTime();
    juce::MouseEvent e (src, p, juce::ModifierKeys (juce::ModifierKeys::leftButtonModifier), 0, 0, 0, 0, 0, &f, &f, t, p, t, kind == 4 ? 2 : 1, false);
    if (kind == 0)
        f.mouseDown (e);
    else if (kind == 2)
        f.mouseUp (e);
    else
        f.mouseDoubleClick (e);
}

double ms (const std::function<void()>& f)
{
    const auto t0 = juce::Time::getMillisecondCounterHiRes();
    f();
    return juce::Time::getMillisecondCounterHiRes() - t0;
}
} // namespace

juce::Image browseSnapshot (const juce::StringArray& args, float scale, bool library)
{
    if (args.size() > 4)
        wearLabel (args[4]);
    mgllib::askInline = true;
    Rig rig (library ? "library" : "browse");
    if (!library)
    {
        rig.call ("ui", captureUi());
        BrowseFace f (rig.fn, rig.id);
        f.poll();
        return f.createComponentSnapshot (f.getLocalBounds(), true, scale);
    }
    LibraryFace f (rig.fn, rig.id);
    f.poll();
    return f.createComponentSnapshot (f.getLocalBounds(), true, scale);
}

int browseBench (const juce::StringArray&)
{
    std::setvbuf (stdout, nullptr, _IONBF, 0);
    mgllib::askInline = true;
    int bad = 0;
    auto check = [&] (const char* what, bool ok, double t, double limit) {
        std::printf ("%-46s %s  %6.1f ms%s\n", what, ok ? "ok  " : "FAIL", t, t > limit ? "  (slow)" : "");
        if (!ok || t > limit)
            ++bad;
    };
    {
        Rig rig ("browse");
        rig.call ("ui", captureUi());
        const auto ui = rig.call ("info")["ui"];
        const auto first = ui["open"][0].toString();
        BrowseFace f (rig.fn, rig.id);
        f.onMessage = [] (const juce::String& m) { std::printf ("  [face says] %s\n", m.toRawUTF8()); };
        f.poll();
        f.paintTimed (2.0f);
        const double first0 = f.paintTimed (2.0f);
        check ("the page drawn whole (2x)", true, first0, 120);
        auto press = [&] (juce::Point<float> p) { return ms ([&] { mouse (f, p, 0); }) + f.paintTimed (2.0f); };
        // A folder row: closed, then open again (its files listed).
        const auto tree = f.where ("tree");
        double t = press ({ tree.getX() + 120, tree.getY() + 14 });
        check ("a folder row closes it", !f.openFolders.contains (first), t, 40);
        t = press ({ tree.getX() + 120, tree.getY() + 14 });
        check ("and opens it again", f.openFolders.contains (first), t, 40);
        // The page's rows: the folder's is 31 px, each file's 33 (its play button in its middle).
        auto rowY = [&] (int n) { return tree.getY() + 31.0f + 33.0f * (float) n + 16.0f; };
        // A file row: picked, its stats asked.
        t = press ({ tree.getX() + 200, rowY (3) });
        check ("a file row picks the sound", f.picked.isNotEmpty() && f.picked != ui["picked"].toString(), t, 40);
        // Its play button: heard.
        t = press ({ tree.getX() + 34, rowY (3) });
        const auto i = rig.call ("info");
        check ("its play button plays it", (bool) i["playing"] && i["heard"]["path"].toString() == f.picked, t, 40);
        if (!((bool) i["playing"] && i["heard"]["path"].toString() == f.picked))
            std::printf ("  picked %s\n  info %s\n", f.picked.toRawUTF8(), juce::JSON::toString (i, true).substring (0, 600).toRawUTF8());
        t = press ({ tree.getX() + 34, rowY (3) });
        check ("and again pauses it", !(bool) rig.call ("info")["playing"], t, 40);
        // A type.
        const auto types = f.where ("types");
        t = press ({ types.getCentreX(), types.getY() + 110 });
        check ("a type is picked", f.typeName.isNotEmpty() && f.typeName != "Drums", t, 40);
        // The sort.
        t = press (f.where ("sortLength").getCentre());
        check ("Length sorts by length", f.sort == "length", t, 40);
        // A row of the type's files: heard at once.
        const auto bt = f.where ("btFiles");
        t = press ({ bt.getX() + 200, bt.getY() + 30 });
        check ("a type's file plays", (bool) rig.call ("info")["playing"], t, 40);
        // Play all files.
        t = press (f.where ("playAll").getCentre());
        check ("Play all files", f.playAll, t, 40);
        // Double-click: opened in the Sound module cabled from it.
        mouse (f, { tree.getX() + 200, rowY (1) }, 0);
        juce::String chosen;
        f.choose = [&] (const juce::String& file, const juce::String&, const juce::String&, const juce::String&) { chosen = file; };
        t = ms ([&] { mouse (f, { tree.getX() + 200, rowY (1) }, 4); });
        check ("a double-click chooses it", chosen.isNotEmpty(), t, 40);
        // The panes.
        f.showPane ("search");
        f.similar();
        t = f.paintTimed (2.0f);
        check ("Sounds like the selected file", f.pane == "search", t, 40);
        f.showPane ("browse");
        // The saved state.
        const auto saved = rig.call ("info")["ui"];
        check ("the page's state is the module's", saved["sort"].toString() == "length" && (bool) saved["playAll"], 0, 1);
    }
    {
        Rig rig ("library");
        LibraryFace f (rig.fn, rig.id);
        f.onMessage = [] (const juce::String& m) { std::printf ("  [face says] %s\n", m.toRawUTF8()); };
        f.poll();
        f.paintTimed (2.0f);
        auto press = [&] (juce::Point<float> p) { return ms ([&] { mouse (f, p, 0); }) + f.paintTimed (2.0f); };
        double t = press (f.where ("kind:1").getCentre());
        check ("Library: Hits", f.kind == "hit", t, 40);
        t = press (f.where ("kind:0").getCentre());
        check ("Library: All", f.kind.isEmpty(), t, 40);
        const auto g = f.where ("groups");
        t = press ({ g.getCentreX(), g.getY() + 60 });
        check ("Library: a prompt is picked", f.group.isNotEmpty(), t, 40);
        t = press (f.where ("loop:1").getCentre());
        check ("Library: Loop", f.loop, t, 40);
        t = press (f.where ("play").getCentre());
        check ("Library: the sound plays", (bool) rig.call ("info")["playing"] || f.group.isEmpty(), t, 40);
    }
    std::printf ("%s\n", bad == 0 ? "all ok" : "some failed");
    return bad == 0 ? 0 : 1;
}

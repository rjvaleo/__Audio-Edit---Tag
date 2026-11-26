#include "SoundFace.h"

#include "Canvas2D.h"
#include "MglLibrary.h"
#include "Places.h"

namespace
{
// The Edit page's parts this face is dressed in, in the theme being worn.
const juce::var& editPart (const char* id)
{
    static juce::var none;
    const auto& page = face::page ("edit");
    std::function<const juce::var* (const juce::var&)> find = [&] (const juce::var& n) -> const juce::var* {
        if (n["id"].toString() == id)
            return &n;
        if (auto* kids = n["kids"].getArray())
            for (const auto& k : *kids)
                if (auto* f = find (k))
                    return f;
        return nullptr;
    };
    if (auto* f = find (page["open"]["tree"]))
        return *f;
    if (auto* f = find (page["nowbarOpen"]["tree"]))
        return *f;
    return none;
}

juce::Colour token (const char* name, const char* fallback)
{
    const auto s = face::page ("edit")["open"]["vars"][name].toString();
    return c2d::css (s.isEmpty() ? juce::String (fallback) : s);
}

uint64_t fnv (const juce::String& s)
{
    uint64_t h = 0xcbf29ce484222325ull;
    for (auto c : s.toStdString())
    {
        h ^= (uint8_t) c;
        h *= 0x100000001b3ull;
    }
    return h;
}

// MGL's library: its folders and their files, read once, searched here.
struct Library final : public juce::Component, private juce::Thread, private juce::AsyncUpdater, private juce::TextEditor::Listener
{
    struct Row
    {
        juce::String path, name, folder, category;
        double duration = 0;
    };
    std::vector<Row> all, shown;
    juce::TextEditor search;
    juce::String status = juce::String::fromUTF8 ("Reading the library\xe2\x80\xa6");
    float scroll = 0;
    int hover = -1;
    std::function<void (const Row&)> pick;
    std::function<void()> close;

    Library() : juce::Thread ("library")
    {
        setSize (460, 520);
        search.setBounds (12, 12, 436, 28);
        search.setTextToShowWhenEmpty ("Search the library: a name, a folder, a type", juce::Colours::grey);
        search.setColour (juce::TextEditor::backgroundColourId, token ("--look-well", "#06070a"));
        search.setColour (juce::TextEditor::textColourId, token ("--look-text", "#e8eaee"));
        search.setColour (juce::TextEditor::outlineColourId, token ("--look-line", "#2c3036"));
        search.addListener (this);
        addAndMakeVisible (search);
        startThread();
    }
    ~Library() override { stopThread (4000); }

    void run() override
    {
        // MGL's library in the app (MglLibrary): its own routes, answered here.
        auto get = [] (const juce::String& route) {
            const auto a = mgllib::call ("GET", route);
            return a.ok() ? a.json() : juce::var();
        };
        const auto folders = get ("/api/folders");
        std::vector<Row> rows;
        if (auto* list = folders.getArray())
            for (const auto& f : *list)
            {
                if (threadShouldExit())
                    return;
                const auto name = f["name"].toString();
                const auto files = get ("/api/files?folder=" + mgllib::esc (name));
                if (auto* fs = files.getArray())
                    for (const auto& x : *fs)
                        rows.push_back ({ x["path"].toString(), x["name"].toString(), name, x["category"].toString(), (double) x["duration"] });
            }
        else
        {
            status = "MGL's library couldn't be read";
            triggerAsyncUpdate();
            return;
        }
        all = std::move (rows);
        status = {};
        triggerAsyncUpdate();
    }
    void handleAsyncUpdate() override { filter(); }
    void textEditorTextChanged (juce::TextEditor&) override { filter(); }
    void textEditorEscapeKeyPressed (juce::TextEditor&) override { if (close) close(); }
    void textEditorReturnKeyPressed (juce::TextEditor&) override
    {
        if (!shown.empty() && pick)
            pick (shown.front());
    }
    void filter()
    {
        const auto words = juce::StringArray::fromTokens (search.getText().toLowerCase(), " ", "");
        shown.clear();
        for (const auto& r : all)
        {
            const auto hay = (r.name + " " + r.path + " " + r.category).toLowerCase();
            bool ok = true;
            for (const auto& w : words)
                ok = ok && hay.contains (w);
            if (ok)
                shown.push_back (r);
            if (shown.size() >= 2000)
                break;
        }
        scroll = 0;
        repaint();
    }
    juce::Rectangle<float> listR() const { return { 12, 48, 436, 460 }; }
    void paint (juce::Graphics& g) override
    {
        g.setColour (token ("--look-panel", "#1b1d21"));
        g.fillRoundedRectangle (getLocalBounds().toFloat(), 8);
        g.setColour (token ("--look-line", "#2c3036"));
        g.drawRoundedRectangle (getLocalBounds().toFloat().reduced (0.5f), 8, 1);
        const auto r = listR();
        g.setColour (token ("--look-well", "#06070a"));
        g.fillRoundedRectangle (r, 6);
        juce::Graphics::ScopedSaveState s (g);
        g.reduceClipRegion (r.toNearestInt());
        if (status.isNotEmpty())
        {
            g.setFont (face::sans (12));
            g.setColour (token ("--look-text-3", "#858b94"));
            g.drawText (status, r.reduced (12), juce::Justification::topLeft);
            return;
        }
        for (size_t i = 0; i < shown.size(); ++i)
        {
            const float y = r.getY() + 4 + (float) i * 34 - scroll;
            if (y > r.getBottom() || y + 34 < r.getY())
                continue;
            const juce::Rectangle<float> row (r.getX() + 4, y, r.getWidth() - 8, 32);
            if ((int) i == hover)
            {
                g.setColour (token ("--look-panel-hi", "#2a2e34"));
                g.fillRoundedRectangle (row, 4);
            }
            g.setFont (face::sans (12, 500));
            g.setColour (token ("--look-text", "#e8eaee"));
            g.drawText (shown[i].name, row.reduced (8, 0).withHeight (18), juce::Justification::centredLeft, true);
            g.setFont (face::mono (9));
            g.setColour (token ("--look-text-3", "#858b94"));
            g.drawText (shown[i].folder + juce::String::fromUTF8 (" \xc2\xb7 ") + juce::String (shown[i].duration, 2) + " s" + (shown[i].category.isNotEmpty() ? juce::String::fromUTF8 (" \xc2\xb7 ") + shown[i].category : juce::String()),
                        row.reduced (8, 0).withTrimmedTop (17), juce::Justification::centredLeft, true);
        }
    }
    int rowAt (juce::Point<float> p) const
    {
        const auto r = listR();
        if (!r.contains (p))
            return -1;
        const int i = (int) std::floor ((p.y - r.getY() - 4 + scroll) / 34);
        return i >= 0 && i < (int) shown.size() ? i : -1;
    }
    void mouseMove (const juce::MouseEvent& e) override
    {
        hover = rowAt (e.position);
        repaint();
    }
    void mouseDown (const juce::MouseEvent& e) override
    {
        if (const int i = rowAt (e.position); i >= 0 && pick)
            pick (shown[(size_t) i]);
    }
    void mouseWheelMove (const juce::MouseEvent&, const juce::MouseWheelDetails& w) override
    {
        scroll = juce::jlimit (0.0f, std::max (0.0f, (float) shown.size() * 34 - listR().getHeight() + 8), scroll - w.deltaY * 300);
        repaint();
    }
};

// One sound fetched from the library into the cache, off the app's thread.
struct Fetch final : public juce::Thread
{
    juce::String path;
    juce::File to;
    std::function<void (bool)> done;
    Fetch (juce::String p, juce::File f, std::function<void (bool)> d) : juce::Thread ("fetch"), path (std::move (p)), to (std::move (f)), done (std::move (d)) {}
    void run() override
    {
        // `/audio?p=` with nothing else: the file as it is, as a WAV.
        juce::URL url (SoundFace::server() + "/audio?p=" + juce::URL::addEscapeChars (path, true));
        auto in = url.createInputStream (juce::URL::InputStreamOptions (juce::URL::ParameterHandling::inAddress).withConnectionTimeoutMs (8000));
        bool ok = false;
        if (in != nullptr)
        {
            const auto part = to.getSiblingFile (to.getFileName() + ".part");
            part.deleteFile();
            {
                juce::FileOutputStream out (part);
                ok = out.openedOk() && out.writeFromInputStream (*in, -1) > 44;
            }
            ok = ok && part.moveFileTo (to);
        }
        juce::MessageManager::callAsync ([d = done, ok] { d (ok); });
    }
};
std::vector<std::unique_ptr<Fetch>> fetches;
} // namespace

juce::String SoundFace::server()
{
    const auto s = juce::SystemStats::getEnvironmentVariable ("MGL_SERVER", {});
    return s.isNotEmpty() ? s : juce::String ("http://127.0.0.1:8737");
}

juce::File SoundFace::cacheFor (const juce::String& path)
{
    auto d = places::home().getChildFile ("sound-cache");
    d.createDirectory();
    return d.getChildFile (juce::String::toHexString ((juce::int64) fnv (path)) + ".wav");
}

SoundFace::SoundFace (Call c, uint32_t i) : call (std::move (c)), id (i)
{
    setSize (320, 132);
    openR = { 12, 96, 140, 26 };
    libR = { 160, 96, 148, 26 };
    findR = { 12, 96, 296, 26 };
    stripR = { 12, 52, 296, 36 };
    reload();
    startTimerHz (4);
}

SoundFace::~SoundFace()
{
    stopTimer();
    library.reset();
}

void SoundFace::reload()
{
    const auto text = juce::String (call ([this] (NaApp* a) -> int64_t {
        std::vector<char> buf (1 << 16);
        int32_t n = na_sound_info (a, id, buf.data(), (uint32_t) buf.size());
        if (n >= (int32_t) buf.size())
        {
            buf.resize ((size_t) n + 1);
            n = na_sound_info (a, id, buf.data(), (uint32_t) buf.size());
        }
        info = n > 0 ? juce::JSON::parse (juce::String::fromUTF8 (buf.data(), n)) : juce::var();
        return n;
    }));
    juce::ignoreUnused (text);
    const auto s = (int64_t) (double) info["serial"];
    if (s != serial)
    {
        serial = s;
        // The whole of it as a strip, from its peaks (the Now bar's nbDrawStrip).
        strip.assign (2 * 296, 0.0f);
        const int c = (int) call ([this] (NaApp* a) -> int64_t { return na_sound_peaks (a, id, 296, strip.data()); });
        strip.resize (c > 0 ? (size_t) (2 * c) : 0);
        repaint();
    }
}

void SoundFace::timerCallback()
{
    reload();
}

bool SoundFace::openFile (const juce::File& f)
{
    auto* o = new juce::DynamicObject();
    o->setProperty ("kind", "file");
    o->setProperty ("path", f.getFullPathName());
    o->setProperty ("name", f.getFileName());
    const auto origin = juce::JSON::toString (juce::var (o), true);
    const auto path = f.getFullPathName();
    juce::String err;
    const auto n = call ([&] (NaApp* a) -> int64_t {
        std::vector<char> buf (1 << 16);
        const int32_t r = na_sound_open (a, id, path.toRawUTF8(), origin.toRawUTF8(), 0, buf.data(), (uint32_t) buf.size());
        if (r < 0)
        {
            char e[512] {};
            na_error (a, e, sizeof e);
            err = juce::String::fromUTF8 (e);
        }
        return r;
    });
    reload();
    say (n >= 0 ? "Opened " + f.getFileName() : "Opening " + f.getFileName() + " didn't work: " + err);
    return n >= 0;
}

void SoundFace::openLibrary (const juce::String& path, const juce::String& name, bool keep)
{
    // The library's own file, where the library is: opened as it is.
    const auto own = mgllib::fileOf (path);
    const auto file = own.existsAsFile() ? own : cacheFor (path);
    auto open = [safe = juce::Component::SafePointer<SoundFace> (this), path, name, file, keep] (bool ok) {
        if (safe == nullptr)
            return;
        if (!ok)
            return safe->say ("Fetching " + name + " from MGL's library didn't work");
        auto* o = new juce::DynamicObject();
        o->setProperty ("kind", "library");
        o->setProperty ("path", path);
        o->setProperty ("name", name);
        const auto origin = juce::JSON::toString (juce::var (o), true);
        const auto local = file.getFullPathName();
        const auto r = safe->call ([&] (NaApp* a) -> int64_t {
            std::vector<char> buf (1 << 16);
            return na_sound_open (a, safe->id, local.toRawUTF8(), origin.toRawUTF8(), keep ? 1u : 0u, buf.data(), (uint32_t) buf.size());
        });
        safe->reload();
        safe->say (r >= 0 ? "Opened " + name + " from the library" : "Opening " + name + " didn't work");
    };
    if (file.existsAsFile())
        return open (true);
    say (juce::String::fromUTF8 ("Fetching ") + name + juce::String::fromUTF8 (" from MGL's library\xe2\x80\xa6"));
    fetches.push_back (std::make_unique<Fetch> (path, file, open));
    fetches.back()->startThread();
}

void SoundFace::chooseFile (bool keep)
{
    chooser = std::make_unique<juce::FileChooser> ("Open a sound", juce::File::getSpecialLocation (juce::File::userMusicDirectory), "*.wav;*.wave;*.aif;*.aiff;*.aifc");
    chooser->launchAsync (juce::FileBrowserComponent::openMode | juce::FileBrowserComponent::canSelectFiles, [this, keep] (const juce::FileChooser& fc) {
        const auto f = fc.getResult();
        if (f == juce::File())
            return;
        if (!keep)
            return (void) openFile (f);
        // Found again: the same file in a new place, its edits kept.
        auto* o = new juce::DynamicObject();
        o->setProperty ("kind", "file");
        o->setProperty ("path", f.getFullPathName());
        o->setProperty ("name", f.getFileName());
        const auto origin = juce::JSON::toString (juce::var (o), true);
        const auto path = f.getFullPathName();
        call ([&] (NaApp* a) -> int64_t {
            std::vector<char> buf (1 << 16);
            return na_sound_open (a, id, path.toRawUTF8(), origin.toRawUTF8(), 1, buf.data(), (uint32_t) buf.size());
        });
        reload();
    });
}

void SoundFace::showLibrary()
{
    auto lib = std::make_unique<Library>();
    lib->pick = [this] (const Library::Row& r) {
        juce::MessageManager::callAsync ([safe = juce::Component::SafePointer<SoundFace> (this), r] {
            if (safe == nullptr)
                return;
            safe->library.reset();
            safe->openLibrary (r.path, r.name);
        });
    };
    lib->close = [this] { juce::MessageManager::callAsync ([safe = juce::Component::SafePointer<SoundFace> (this)] { if (safe != nullptr) safe->library.reset(); }); };
    // Over the canvas, beside the module: the module is too small to hold it.
    if (auto* top = getTopLevelComponent())
    {
        top->addAndMakeVisible (*lib);
        const auto at = top->getLocalPoint (this, juce::Point<int> (getWidth() + 12, 0));
        lib->setTopLeftPosition (juce::jlimit (8, std::max (8, top->getWidth() - lib->getWidth() - 8), at.x), juce::jlimit (8, std::max (8, top->getHeight() - lib->getHeight() - 8), at.y));
    }
    lib->search.grabKeyboardFocus();
    library = std::move (lib);
}

void SoundFace::paint (juce::Graphics& g)
{
    g.fillAll (token ("--look-panel", "#1b1d21"));
    const bool open = (bool) info["open"];
    const auto origin = info["origin"];
    const auto name = origin["name"].toString();
    g.setFont (face::sans (13, 600));
    g.setColour (token ("--look-text", "#e8eaee"));
    g.drawText (name.isNotEmpty() ? name : juce::String ("No sound"), juce::Rectangle<float> (12, 10, 296, 18), juce::Justification::centredLeft, true);
    g.setFont (face::mono (10));
    g.setColour (token ("--look-text-3", "#858b94"));
    juce::String meta;
    if (open)
    {
        const double frames = (double) info["frames"], sr = (double) info["sampleRate"];
        const int ch = (int) info["channels"];
        meta << juce::String (frames / sr, 2) << " s" << juce::String::fromUTF8 (" \xc2\xb7 ") << juce::String (sr / 1000.0, sr == 44100.0 ? 1 : 0) << " kHz"
             << juce::String::fromUTF8 (" \xc2\xb7 ") << (ch == 1 ? "mono" : ch == 2 ? "stereo" : juce::String (ch) + " channels")
             << (origin["kind"].toString() == "library" ? juce::String::fromUTF8 (" \xc2\xb7 library") : juce::String())
             << ((bool) info["edited"] ? juce::String::fromUTF8 (" \xc2\xb7 edited") : juce::String());
    }
    else if (info["missing"].isString())
        meta = info["missing"].toString();
    else
        meta = "Open a file, or one from MGL's library";
    g.drawText (meta, juce::Rectangle<float> (12, 28, 296, 16), juce::Justification::centredLeft, true);
    // The well the strip sits in (the Now bar's strip, nb-strip).
    const auto& well = editPart ("nbBpm");
    if (well.isObject())
        face::paintBox (g, well, stripR);
    else
    {
        g.setColour (token ("--look-well", "#06070a"));
        g.fillRoundedRectangle (stripR, 5);
    }
    if (open && !strip.empty())
    {
        // nbDrawStrip: min to max a column, at 92% of half the height.
        const int n = (int) strip.size() / 2;
        const float mid = stripR.getCentreY(), half = stripR.getHeight() / 2;
        g.setColour (c2d::css ("#9aa6d6").interpolatedWith (token ("--look-wave", "#ffffff"), 0.3f));
        for (int x = 0; x < (int) stripR.getWidth(); ++x)
        {
            const int i = std::min (n - 1, (int) std::floor ((float) x / stripR.getWidth() * (float) n));
            const float a = mid - strip[(size_t) (n + i)] * half * 0.92f, b = mid - strip[(size_t) i] * half * 0.92f;
            g.fillRect (stripR.getX() + (float) x, a, 1.0f, std::max (1.0f, b - a));
        }
    }
    if (open)
    {
        const auto clips = info["clips"];
        g.setFont (face::mono (9));
        g.setColour (token ("--look-text-3", "#858b94"));
        const int n = clips.isArray() ? clips.getArray()->size() : 0;
        g.drawText (juce::String (n) + (n == 1 ? " clip" : " clips"), stripR.reduced (6, 2), juce::Justification::topRight, true);
    }
    // The buttons, in the Edit page's own (its ⌘K button's look).
    const auto& btn = editPart ("edCmdK");
    auto button = [&] (juce::Rectangle<float> r, const juce::String& text) {
        if (btn.isObject())
            face::paintBox (g, btn, r);
        g.setFont (face::sans (12, 500));
        g.setColour (token ("--look-text", "#e8eaee"));
        g.drawText (text, r, juce::Justification::centred);
    };
    if (!open && info["missing"].isString())
        button (findR, origin["kind"].toString() == "library" ? juce::String::fromUTF8 ("Fetch it again from the library") : juce::String::fromUTF8 ("Find the file\xe2\x80\xa6"));
    else
    {
        button (openR, juce::String::fromUTF8 ("Open file\xe2\x80\xa6"));
        button (libR, juce::String::fromUTF8 ("Library\xe2\x80\xa6"));
    }
}

void SoundFace::mouseDown (const juce::MouseEvent& e)
{
    if (blocked && blocked (e))
        return;
    const bool open = (bool) info["open"];
    if (!open && info["missing"].isString())
    {
        if (findR.contains (e.position))
        {
            const auto origin = info["origin"];
            if (origin["kind"].toString() == "library")
                openLibrary (origin["path"].toString(), origin["name"].toString(), true);
            else
                chooseFile (true);
        }
        return;
    }
    if (openR.contains (e.position))
        chooseFile (false);
    else if (libR.contains (e.position))
        library != nullptr ? library.reset() : showLibrary();
}

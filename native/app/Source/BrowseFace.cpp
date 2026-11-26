// Browse's face (BrowseFace.h): MGL's Browse page.
#include "BrowseFace.h"

#include "Canvas2D.h"

namespace
{
using browse::N;
constexpr float RAIL = 168; // MGL's rail, left of the page: not the module's

juce::Rectangle<float> rectOf (const juce::var& r)
{
    if (!r.isArray() || r.size() < 4)
        return {};
    return { (float) (double) r[0], (float) (double) r[1], (float) (double) r[2], (float) (double) r[3] };
}

juce::String commas (double n)
{
    // toLocaleString(): 25,225
    auto s = juce::String ((juce::int64) std::llround (n));
    const bool neg = s.startsWithChar ('-');
    if (neg)
        s = s.substring (1);
    juce::String out;
    for (int i = 0; i < s.length(); ++i)
    {
        if (i > 0 && (s.length() - i) % 3 == 0)
            out << ",";
        out << s[i];
    }
    return (neg ? "-" : "") + out;
}

// fmtDur (000-core.js).
juce::String fmtDur (double s)
{
    if (!(s >= 0) || !std::isfinite (s))
        return juce::String::fromUTF8 ("\xe2\x80\x94");
    if (s < 60)
        return juce::String (s, 2) + "s";
    const int m = (int) std::floor (s / 60);
    const int sec = (int) std::round (s - m * 60);
    return juce::String (m) + ":" + juce::String (sec).paddedLeft ('0', 2);
}

juce::String fmtDb (const juce::var& v)
{
    if (v.isVoid() || v.isUndefined() || !std::isfinite ((double) v))
        return juce::String::fromUTF8 ("\xe2\x80\x94\xe2\x88\x9e dB").replace (juce::String::fromUTF8 ("\xe2\x80\x94"), "-");
    return juce::String ((double) v, 1) + " dBFS";
}

juce::String fmtBytes (double b)
{
    if (b < 1024)
        return juce::String ((int) b) + " B";
    if (b < 1024 * 1024)
        return juce::String (b / 1024, 1) + " KB";
    if (b < 1024.0 * 1024 * 1024)
        return juce::String (b / 1024 / 1024, 1) + " MB";
    return juce::String (b / 1024 / 1024 / 1024, 2) + " GB";
}

juce::Colour css (const juce::var& cl, const char* key, const char* fallback)
{
    const auto s = cl[key].toString();
    return c2d::css (s.isEmpty() ? juce::String (fallback) : s);
}

struct Hit
{
    juce::Rectangle<float> r;
    std::function<void()> click, dbl;
    std::function<void (const juce::MouseEvent&)> drag;
};

// BROWSE_TYPES (251-browse-types.js).
struct TypeDef
{
    const char* name;
    std::vector<const char*> cats;
    bool last = false;
};
const std::vector<TypeDef>& typeDefs()
{
    static const std::vector<TypeDef> t {
        { "Drums", { "DRUM-ONESHOT", "DRUM-HIT-LONG" } },
        { "Chops", { "CHOP" } },
        { "One-shots", { "ONE-SHOT", "TONAL-HIT" } },
        { "Samples", { "SAMPLE", "SAMPLE-SHORT" } },
        { "Synth", { "SYNTH-STAB", "PAD-BED" } },
        { "Loops", { "LOOP" } },
        { "Stems", { "STEM" } },
        { "Vocals", { "VOCAL" } },
        { "FX", { "FX" } },
        { "Songs", { "SONG", "SONG?" } },
        { "Sessions", { "LONG-SESSION", "SESSION-TAKE", "SECTION-BED" } },
        { "Unsorted", { "UNKNOWN" } },
        { "Not audio", { "CACHE", "DOCUMENT", "BROKEN" }, true },
    };
    return t;
}
} // namespace

struct BrowseFace::Impl
{
    BrowseFace& f;
    const juce::var& cap;
    std::unique_ptr<face::Chrome> frame;
    std::map<juce::String, std::unique_ptr<face::Chrome>> panes;
    struct Over final : public juce::Component
    {
        std::function<void (juce::Graphics&)> draw;
        void paint (juce::Graphics& g) override { if (draw) draw (g); }
    } over;

    // ── the page's parts, by name (module pixels) ──
    N tree, treeFilter, playAll, laneW, laneEmpty, statsGrid, whyBox, tagSource, dirty, yourTags, learned, heardTags, sonicTags,
        btTotal, btTypeName, btCount, btTypeList, btChips, btFind, btFileList, btSortName, btSortLen, leftTitle, rescan,
        lvl1, lvl2, tags, notes, addTag, avOpen, discard, commit, nowPlay, nowStop, nowName;
    // ── templates ──
    N folderRow, folderRowClosed, fileRow, fileRowSel, loading, btType, btTypeOn, btChip, btChipOn, btFileRow, statCard, statCardWide,
        sonicTag, heardTag, userTag, learnedTag;
    float filePitch = 47, folderPitch = 47, typePitch = 74, btFilePitch = 47;

    // ── what the library said ──
    juce::Array<juce::var> folders;
    juce::StringArray order;
    std::map<juce::String, juce::Array<juce::var>> files;
    std::map<juce::String, juce::var> heard;
    std::map<juce::String, juce::MemoryBlock> thumbs;
    std::set<juce::String> thumbAsked;
    juce::var typesAnswer, stats, sim, searchHits, scanState, libState;
    juce::var pickedFile;
    juce::String similarSay;
    juce::Array<juce::var> similarHits;
    struct BtType
    {
        juce::String name;
        juce::StringArray cats;
        double files = 0;
        bool last = false;
        std::vector<std::pair<juce::String, double>> instruments;
    };
    std::vector<BtType> types;
    double total = 0;
    juce::Array<juce::var> btFiles;
    double btTotalCount = 0;
    int btSerial = 0;
    juce::String selectedFolder;
    std::map<juce::String, std::map<juce::String, juce::String>> tagEdits;
    juce::String sourceSay = "Suggested";
    std::vector<float> peaks; // min, max, rms per column per channel
    int peakCols = 0, peakCh = 0;
    double peakFrom = 0, peakTo = 0;

    float treeScroll = 0, btScroll = 0, resultScroll = 0;
    std::vector<Hit> hits;

    explicit Impl (BrowseFace& face) : f (face), cap (face::page ("browse"))
    {
        frame = std::make_unique<face::Chrome> (cap["page"]);
        frame->setBounds (-(int) RAIL, 0, 1500 + (int) RAIL, 1100);
        frame->setInterceptsMouseClicks (false, false);
        f.addAndMakeVisible (*frame);
        for (auto key : { "pane_search", "pane_similar", "pane_scan", "pane_import" })
            if (cap[key].isObject())
            {
                auto c = std::make_unique<face::Chrome> (cap[key]);
                const auto at = cap[key]["at"];
                c->setBounds ((int) (double) at[0], (int) (double) at[1], (int) rectOf (cap[key]["tree"]["rect"]).getWidth(), (int) rectOf (cap[key]["tree"]["rect"]).getHeight());
                c->setInterceptsMouseClicks (false, false);
                c->setVisible (false);
                f.addChildComponent (*c);
                panes[key] = std::move (c);
            }
        over.setInterceptsMouseClicks (false, false);
        over.draw = [this] (juce::Graphics& g) { draw (g); };
        f.addAndMakeVisible (over);
        over.setBounds (0, 0, 1500, 1100);

        const auto& page = cap["page"]["tree"];
        auto at = [&] (const juce::String& cls, int nth = 0) {
            auto n = browse::Base::find (page, cls, nth);
            n.r = n.r.translated (-RAIL, 0);
            return n;
        };
        tree = at ("#tree");
        treeFilter = at ("#treeFilter");
        playAll = at (".tree-opt");
        laneW = at ("#waveCanvas");
        laneEmpty = at ("#laneEmpty");
        statsGrid = at ("#statsGrid");
        whyBox = at ("#whyBox");
        tagSource = at ("#tagSource");
        dirty = at ("#dirtyLabel");
        yourTags = at ("#yourTags");
        learned = at ("#learnedTags");
        heardTags = at ("#heardTags");
        sonicTags = at ("#sonicTags");
        btTotal = at ("#btTotal");
        btTypeName = at ("#btTypeName");
        btCount = at ("#btCount");
        btTypeList = at ("#btTypeList");
        btChips = at ("#btChips");
        btFind = at ("#btFind");
        btFileList = at ("#btFileList");
        btSortName = at ("#btSort", 0);
        leftTitle = at ("#leftPanelTitle");
        rescan = at ("#rescanBtn");
        lvl1 = at ("#editLevel1");
        lvl2 = at ("#editLevel2");
        tags = at ("#editTags");
        notes = at ("#editNotes");
        addTag = at ("#addUserTag");
        avOpen = at ("#avOpen");
        discard = at ("#discardBtn");
        commit = at ("#commitBtn");
        nowPlay = at ("#playBtn");
        nowStop = at ("#stopBtn");
        nowName = at ("#nowName");
        {
            std::vector<N> sorts;
            browse::Base::findAll (page, "#btSort", sorts);
            if (!sorts.empty())
                if (auto* kids = sorts[0].n["kids"].getArray(); kids != nullptr && kids->size() >= 2)
                {
                    btSortName = { (*kids)[0], rectOf ((*kids)[0]["rect"]).translated (-RAIL, 0) };
                    btSortLen = { (*kids)[1], rectOf ((*kids)[1]["rect"]).translated (-RAIL, 0) };
                }
        }
        folderRow = at (".folder-row", 0);
        folderRowClosed = at (".folder-row", 1);
        {
            std::vector<N> rows;
            browse::Base::findAll (tree.n, ".file-row", rows);
            if (!rows.empty())
                fileRowSel = rows[0];
            if (rows.size() > 1)
                fileRow = rows[1];
            if (rows.size() > 2)
                filePitch = rectOf (rows[2].n["rect"]).getY() - rectOf (rows[1].n["rect"]).getY();
            for (auto& r : rows)
                r.r = r.r.translated (-RAIL, 0);
            if (rows.size() > 1)
            {
                fileRowSel = rows[0];
                fileRow = rows[1];
            }
        }
        if (folderRow.ok() && fileRowSel.ok())
            folderPitch = fileRowSel.r.getY() - folderRow.r.getY();
        loading = at (".loading");
        btType = at (".bt-type", 1);
        btTypeOn = at (".bt-type.on");
        if (btType.ok() && btTypeOn.ok())
            typePitch = std::abs (btType.r.getY() - btTypeOn.r.getY());
        btChip = at (".bt-chip", 1);
        btChipOn = at (".bt-chip.on");
        {
            std::vector<N> rows;
            browse::Base::findAll (btFileList.n, ".file-row", rows);
            if (!rows.empty())
                btFileRow = { rows[0].n, rows[0].r.translated (-RAIL, 0) };
            if (rows.size() > 1)
                btFilePitch = rows[1].r.getY() - rows[0].r.getY();
        }
        statCard = at (".stat-card");
        statCardWide = at (".stat-card.wide");
        sonicTag = at (".sonic-tag");
        heardTag = at (".heard-tag");
        userTag = at (".user-tag");
        learnedTag = at (".learned");

        // What the face writes itself, live, is left out of the frame.
        auto skipKids = [&] (const N& n) {
            if (auto* kids = n.n["kids"].getArray())
                for (const auto& k : *kids)
                    frame->skip.insert ((int) k["i"]);
        };
        for (const N* n : { &tree, &statsGrid, &yourTags, &learned, &heardTags, &sonicTags, &btTypeList, &btChips, &btFileList })
            skipKids (*n);
        for (const N* n : { &whyBox, &tagSource, &dirty, &btTotal, &btTypeName, &btCount, &treeFilter, &btFind, &lvl1, &lvl2, &tags, &notes, &addTag, &nowName })
            if (n->ok())
            {
                frame->skipText.insert ((int) n->n["i"]);
                for (const auto& t : browse::Base::texts (n->n))
                    frame->skipText.insert ((int) t["i"]);
            }
        if (auto rail = browse::Base::find (page, "#leftRail"); rail.ok())
            frame->skip.insert ((int) rail.n["i"]);
    }

    // ── loading ──
    juce::String folderNameOf (const juce::var& file) const
    {
        const auto p = file["path"].toString();
        return p.containsChar ('/') ? p.upToFirstOccurrenceOf ("/", false, false) : selectedFolder;
    }
    static bool hasHeader (const juce::var& file)
    {
        const auto fmt = file["format"].toString();
        return fmt.startsWith ("WAV") || fmt.startsWith ("AIFF") || fmt.startsWith ("AIFC");
    }
    bool listed (const juce::var& file) const { return f.playAll || hasHeader (file); }
    double folderCount (const juce::var& fo) const
    {
        auto pick = [&] (const char* a, const char* b) { return fo.hasProperty (a) ? (double) fo[a] : (double) fo[b]; };
        return f.playAll ? pick ("files", "audioFiles") : pick ("headerFiles", "audioFiles");
    }
    juce::Array<juce::var> ordered() const
    {
        juce::Array<juce::var> out;
        std::set<juce::String> seen;
        for (const auto& name : order)
            for (const auto& fo : folders)
                if (fo["name"].toString() == name && seen.insert (name).second)
                    out.add (fo);
        for (const auto& fo : folders)
            if (seen.insert (fo["name"].toString()).second)
                out.add (fo);
        return out;
    }
    bool matches (const juce::var& file) const
    {
        if (f.filter.isEmpty())
            return true;
        const auto hay = (file["name"].toString() + " " + file["category"].toString() + " " + file["machine"].toString() + " " + file["instrument"].toString()).toLowerCase();
        for (const auto& t : juce::StringArray::fromTokens (f.filter, " ", ""))
            if (t.isNotEmpty() && !hay.contains (t))
                return false;
        return true;
    }

    void ask (const juce::String& method, const juce::String& target, const juce::String& body, std::function<void (const mgllib::Answer&)> done)
    {
        ++f.pending;
        juce::Component::SafePointer<BrowseFace> self (&f);
        mgllib::ask (method, target, body, [self, done] (const mgllib::Answer& a) {
            if (self == nullptr)
                return;
            --self->pending;
            done (a);
            self->d->over.repaint();
        });
    }

    void loadFolders()
    {
        ask ("GET", "/api/state", {}, [this] (const mgllib::Answer& a) { libState = a.json(); });
        ask ("GET", "/api/order", {}, [this] (const mgllib::Answer& a) {
            order.clear();
            if (auto* o = a.json()["order"].getArray())
                for (const auto& n : *o)
                    order.add (n.toString());
        });
        ask ("GET", "/api/folders", {}, [this] (const mgllib::Answer& a) {
            folders.clear();
            if (auto* fs = a.json().getArray())
                folders.addArray (*fs);
            for (const auto& name : f.openFolders)
                loadFiles (name);
            loadTypes();
        });
    }

    void loadFiles (const juce::String& name)
    {
        ask ("GET", "/api/files?folder=" + mgllib::esc (name), {}, [this, name] (const mgllib::Answer& a) {
            juce::Array<juce::var> list;
            if (auto* fs = a.json().getArray())
                list.addArray (*fs);
            files[name] = list;
            wantThumbs();
            ask ("GET", "/api/labels?folder=" + mgllib::esc (name), {}, [this] (const mgllib::Answer& l) {
                if (auto* o = l.json()["files"].getDynamicObject())
                    for (const auto& p : o->getProperties())
                        heard[p.name.toString()] = p.value;
            });
        });
    }

    // requestThumbs (010): every row shown without its picture, 300 at most, at once.
    void wantThumbs()
    {
        juce::Array<juce::var> paths;
        auto want = [&] (const juce::var& file) {
            const auto p = file["path"].toString();
            if (p.isNotEmpty() && thumbAsked.insert (p).second && paths.size() < 300)
                paths.add (p);
        };
        for (const auto& fo : ordered())
            if (f.openFolders.contains (fo["name"].toString()))
                if (auto it = files.find (fo["name"].toString()); it != files.end())
                    for (const auto& file : it->second)
                        if (matches (file) && listed (file))
                            want (file);
        for (const auto& file : btFiles)
            want (file);
        if (paths.isEmpty())
            return;
        juce::DynamicObject::Ptr o = new juce::DynamicObject();
        o->setProperty ("paths", paths);
        o->setProperty ("cols", 54);
        ask ("POST", "/api/thumbs", juce::JSON::toString (juce::var (o.get()), true), [this] (const mgllib::Answer& a) {
            if (auto* m = a.json().getDynamicObject())
                for (const auto& p : m->getProperties())
                {
                    juce::MemoryOutputStream out;
                    if (juce::Base64::convertFromBase64 (out, p.value.toString()))
                        thumbs[p.name.toString()] = out.getMemoryBlock();
                }
        });
    }

    void loadTypes()
    {
        ask ("GET", juce::String ("/api/types") + (f.playAll ? "?all=1" : ""), {}, [this] (const mgllib::Answer& a) {
            typesAnswer = a.json();
            std::map<juce::String, juce::var> byCat;
            if (auto* cs = typesAnswer["categories"].getArray())
                for (const auto& c : *cs)
                    byCat[c["category"].toString()] = c;
            std::set<juce::String> placed;
            std::vector<BtType> all;
            for (const auto& t : typeDefs())
            {
                BtType b;
                b.name = t.name;
                b.last = t.last;
                for (auto c : t.cats)
                    b.cats.add (c), placed.insert (c);
                all.push_back (b);
            }
            for (const auto& [c, v] : byCat)
                if (placed.count (c) == 0)
                {
                    BtType b;
                    b.name = c.substring (0, 1) + c.substring (1).toLowerCase();
                    b.cats.add (c);
                    all.push_back (b);
                }
            types.clear();
            for (auto& t : all)
            {
                juce::StringArray cats;
                std::vector<std::pair<juce::String, double>> ins;
                for (const auto& c : t.cats)
                    if (auto it = byCat.find (c); it != byCat.end())
                    {
                        cats.add (c);
                        t.files += (double) it->second["files"];
                        if (auto* is = it->second["instruments"].getArray())
                            for (const auto& i : *is)
                            {
                                const auto nm = i["name"].toString();
                                auto at = std::find_if (ins.begin(), ins.end(), [&] (auto& x) { return x.first == nm; });
                                if (at == ins.end())
                                    ins.push_back ({ nm, (double) i["files"] });
                                else
                                    at->second += (double) i["files"];
                            }
                    }
                t.cats = cats;
                t.instruments = ins;
                if (t.files > 0)
                    types.push_back (t);
            }
            std::stable_sort (types.begin(), types.end(), [] (const BtType& a, const BtType& b) {
                if (a.last != b.last)
                    return !a.last;
                return a.files > b.files;
            });
            total = (double) typesAnswer["total"];
            if (std::none_of (types.begin(), types.end(), [&] (auto& t) { return t.name == f.typeName; }))
                f.typeName = types.empty() ? juce::String() : types[0].name;
            loadTypeFiles();
        });
    }

    const BtType* type() const
    {
        for (const auto& t : types)
            if (t.name == f.typeName)
                return &t;
        return nullptr;
    }

    juce::String typeQuery (int offset) const
    {
        const auto* t = type();
        juce::String q = "/api/type-files?cats=" + mgllib::esc (t->cats.joinIntoString (",")) + "&sort=" + f.sort + "&offset=" + juce::String (offset) + "&limit=200";
        if (f.instrument.isNotEmpty())
            q << "&instrument=" << mgllib::esc (f.instrument);
        if (f.find.isNotEmpty())
            q << "&q=" << mgllib::esc (f.find);
        if (f.playAll)
            q << "&all=1";
        return q;
    }

    void loadTypeFiles (bool more = false)
    {
        if (type() == nullptr)
        {
            btFiles.clear();
            return;
        }
        if (more && btFiles.size() >= (int) btTotalCount)
            return;
        const int serial = more ? btSerial : ++btSerial;
        ask ("GET", typeQuery (more ? btFiles.size() : 0), {}, [this, serial, more] (const mgllib::Answer& a) {
            if (serial != btSerial)
                return;
            const auto v = a.json();
            if (!more)
            {
                btFiles.clear();
                btScroll = 0;
            }
            if (auto* fs = v["files"].getArray())
                btFiles.addArray (*fs);
            btTotalCount = (double) v["total"];
            wantThumbs();
        });
    }

    void loadPicked()
    {
        const auto file = pickedFile;
        const auto p = file["path"].toString();
        stats = juce::var();
        sim = juce::var();
        peaks.clear();
        peakCols = 0;
        ask ("GET", "/api/stats?p=" + mgllib::esc (p), {}, [this, p] (const mgllib::Answer& a) { if (p == f.picked) stats = a.ok() ? a.json() : juce::var(); });
        if (!p.startsWith (".mgl/"))
            ask ("GET", "/api/similar?p=" + mgllib::esc (p) + "&limit=1", {}, [this, p] (const mgllib::Answer& a) {
                if (p != f.picked)
                    return;
                sim = a.ok() ? a.json() : juce::var();
                if (sim.isObject())
                    heard[p] = sim["heard"];
                fillTags();
            });
        const int cols = juce::jmax (1, (int) laneW.r.getWidth());
        ask ("GET", "/api/peaks?p=" + mgllib::esc (p) + "&cols=" + juce::String (cols) + "&clips=1", {}, [this, p] (const mgllib::Answer& a) {
            if (p != f.picked || !a.ok())
                return;
            const auto v = a.json();
            auto* chans = v["channels"].getArray();
            if (chans == nullptr)
                return;
            peakCols = (int) v["columns"];
            peakCh = chans->size();
            peakFrom = (double) v["from"];
            peakTo = v.hasProperty ("to") ? (double) v["to"] : (double) v["frames"];
            peaks.assign ((size_t) (peakCols * peakCh * 3), 0.0f);
            for (int c = 0; c < peakCh; ++c)
                for (int w = 0; w < 3; ++w)
                    if (auto* arr = (*chans)[c][w == 0 ? "min" : w == 1 ? "max" : "rms"].getArray())
                        for (int i = 0; i < juce::jmin (peakCols, arr->size()); ++i)
                            peaks[(size_t) ((c * 3 + w) * peakCols + i)] = (float) (double) (*arr)[i];
        });
    }

    // fillFileTags (250): edited, then saved, then suggested.
    void fillTags()
    {
        const auto p = f.picked;
        auto& e = tagEdits[p];
        auto pick = [&] (const char* k) -> juce::String {
            if (auto it = e.find (k); it != e.end())
                return it->second;
            if (sim["saved"].isObject() && sim["saved"].hasProperty (k))
                return sim["saved"][k].toString();
            return sim["suggest"][k].toString();
        };
        f.field ("level1", lvl1, "snare, sine wave, voice\xe2\x80\xa6").setText (pick ("level1"), false);
        f.field ("level2", lvl2, "bright, repetitive, gritty\xe2\x80\xa6").setText (pick ("level2"), false);
        f.field ("tags", tags, "words you'd search for\xe2\x80\xa6").setText (pick ("tags"), false);
        f.field ("notes", notes, "where it came from, what it's for\xe2\x80\xa6", true).setText (pick ("notes"), false);
        sourceSay = !e.empty() ? "Edited" : sim["saved"].isObject() ? "Saved" : "Suggested";
    }

    // ── drawing ──
    void thumb (juce::Graphics& g, juce::Rectangle<float> r, const juce::String& path, bool selected)
    {
        auto it = thumbs.find (path);
        if (it == thumbs.end())
            return;
        // drawThumb (010), on the canvas's 54 x 24.
        const auto* b = (const uint8_t*) it->second.getData();
        const int n = (int) it->second.getSize();
        if (n <= 0)
            return;
        juce::Graphics::ScopedSaveState keep (g);
        g.addTransform (juce::AffineTransform::scale (r.getWidth() / 54.0f, r.getHeight() / 24.0f).translated (r.getX(), r.getY()));
        g.setColour (css (cap["cl"], "--wave", "#46d18c").withMultipliedAlpha (selected ? 0.95f : 0.55f));
        const float w = 54.0f / (float) n, mid = 12;
        for (int i = 0; i < n; ++i)
        {
            const float amp = (float) b[i] / 255.0f;
            const float h = juce::jmax (1.0f, amp * 22.0f);
            g.fillRect ((float) i * w, mid - h / 2, juce::jmax (w - 0.4f, 0.6f), h);
        }
    }

    juce::String heardWord (const juce::String& path) const
    {
        auto it = heard.find (path);
        if (it == heard.end() || !it->second.isArray() || it->second.size() == 0)
            return {};
        return it->second[0]["label"].toString();
    }

    void fileRowAt (juce::Graphics& g, const N& tpl, const N& tplSel, float y, const juce::var& file, bool typesList, juce::Rectangle<float> clip)
    {
        const bool sel = f.picked == file["path"].toString();
        const auto& t = sel && tplSel.ok() ? tplSel : tpl;
        if (!t.ok())
            return;
        const juce::Point<float> by (0, y - t.r.getY());
        const bool playing = (bool) f.info["playing"] && f.info["heard"]["path"].toString() == file["path"].toString();
        if (playing)
        {
            g.setColour (css (cap["cl"], "--accent", "#46d18c").withAlpha (0.10f));
            g.fillRect (t.r.translated (0, by.y).getIntersection (clip));
        }
        f.drawRow (g, *frame, t.n, by.translated (RAIL * 0, 0) + juce::Point<float> (-RAIL, 0), [&] (const juce::var& tn, const juce::String& captured) -> juce::String {
            const auto cls = tn["cls"].toString();
            if (cls.contains ("fname"))
                return file["name"].toString();
            if (cls.contains ("cat"))
            {
                const auto w = heardWord (file["path"].toString());
                return typesList ? (file["instrument"].toString().isNotEmpty() ? file["instrument"].toString() : file["category"].toString()) : (w.isNotEmpty() ? w : file["category"].toString());
            }
            if (cls.contains ("bt-where"))
            {
                const auto path = file["path"].toString().upToFirstOccurrenceOf ("/", false, false) + (file["subdir"].toString().isNotEmpty() ? "/" + file["subdir"].toString() : juce::String());
                auto dirs = juce::StringArray::fromTokens (path, "/", "");
                juce::String out = dirs.size() > 2 ? juce::String::fromUTF8 ("\xe2\x80\xa6/") : juce::String();
                out << dirs.joinIntoString ("/", juce::jmax (0, dirs.size() - 2));
                return out;
            }
            if (captured.endsWithChar ('s') && captured.containsChar ('.') && !cls.contains ("pb"))
                return fmtDur ((double) file["duration"]);
            if (captured.contains (":") && captured.length() <= 6)
                return fmtDur ((double) file["duration"]);
            return captured;
        });
        // The confidence dot, in the file's own colour.
        if (auto dot = browse::Base::find (t.n, ".dot"); dot.ok())
        {
            const auto conf = file["confidence"].toString();
            const auto col = css (cap["cl"], conf == "high" ? "--good" : conf == "medium" ? "--warn" : "--bad", "#e05a4a");
            g.setColour (col);
            g.fillRoundedRectangle (dot.r.translated (-RAIL, by.y), 2);
        }
        if (auto th = browse::Base::find (t.n, ".thumb"); th.ok())
            thumb (g, th.r.translated (-RAIL, by.y), file["path"].toString(), sel);
        const auto rowR = t.r.translated (0, by.y);
        const auto pb = browse::Base::find (t.n, ".pb");
        Hit h;
        h.r = rowR.getIntersection (clip);
        auto fv = file;
        if (pb.ok())
        {
            Hit p;
            p.r = pb.r.translated (-RAIL, by.y).getIntersection (clip);
            p.click = [this, fv] { f.playFile (fv); };
            hits.push_back (p);
        }
        if (typesList)
            h.click = [this, fv] { f.playFile (fv); };
        else
            h.click = [this, fv] { f.selectFile (fv); };
        h.dbl = [this, fv] { f.openFile (fv); };
        hits.push_back (h);
    }

    void drawTree (juce::Graphics& g)
    {
        if (!tree.ok())
            return;
        const auto clip = tree.r;
        juce::Graphics::ScopedSaveState keep (g);
        g.reduceClipRegion (clip.toNearestInt());
        float y = clip.getY() + (folderRow.ok() ? folderRow.r.getY() - tree.r.getY() : 0) - treeScroll;
        for (const auto& fo : ordered())
        {
            const auto name = fo["name"].toString();
            const bool open = f.openFolders.contains (name);
            const auto& t = open ? folderRow : (folderRowClosed.ok() ? folderRowClosed : folderRow);
            if (!t.ok())
                return;
            if (y > clip.getBottom())
                break;
            if (y + folderPitch >= clip.getY())
            {
                const juce::Point<float> by (-RAIL, y - t.r.getY());
                f.drawRow (g, *frame, t.n, by, [&] (const juce::var& tn, const juce::String& captured) -> juce::String {
                    const auto cls = tn["cls"].toString();
                    if (cls.contains ("label"))
                        return name;
                    if (cls.contains ("count"))
                        return juce::String ((juce::int64) folderCount (fo));
                    return captured;
                });
                if (auto dot = browse::Base::find (t.n, ".dot"); dot.ok())
                {
                    const auto conf = fo["confidence"].toString();
                    g.setColour (css (cap["cl"], conf == "high" ? "--good" : conf == "medium" ? "--warn" : "--bad", "#e05a4a"));
                    g.fillRoundedRectangle (dot.r.translated (by.x, by.y), 2);
                }
                Hit h;
                h.r = t.r.translated (0, by.y).getIntersection (clip);
                h.click = [this, name] { f.toggleFolder (name); };
                hits.push_back (h);
            }
            y += folderRowClosed.ok() && !open ? folderPitch : folderPitch;
            if (!open)
                continue;
            auto it = files.find (name);
            auto note = [&] (const juce::String& text) {
                if (loading.ok())
                {
                    f.drawRow (g, *frame, loading.n, { -RAIL, y - loading.r.getY() }, [&] (const juce::var&, const juce::String&) { return text; });
                    y += loading.r.getHeight() + 4;
                }
            };
            if (it == files.end())
            {
                note (juce::String::fromUTF8 ("loading\xe2\x80\xa6"));
                continue;
            }
            int hidden = 0, shown = 0;
            for (const auto& file : it->second)
            {
                if (!matches (file))
                    continue;
                if (!listed (file))
                {
                    ++hidden;
                    continue;
                }
                ++shown;
                if (y <= clip.getBottom() && y + filePitch >= clip.getY())
                    fileRowAt (g, fileRow.ok() ? fileRow : fileRowSel, fileRowSel, y, file, false, clip);
                y += filePitch;
            }
            if (shown == 0)
                note (hidden > 0 ? juce::String (hidden) + " without an audio header \xe2\x80\x94 turn on Play all files" : juce::String ("no matches"));
            else if (hidden > 0)
                note (juce::String (hidden) + " more without an audio header");
        }
        treeHeight = y + treeScroll - clip.getY();
    }
    float treeHeight = 0, btHeight = 0;

    void drawWave (juce::Graphics& gr)
    {
        if (f.picked.isEmpty() || peaks.empty() || peakCols <= 0 || peakCh <= 0 || !laneW.ok())
            return;
        // drawWave (040), Browse's: the wave's own green, no Rainbow.
        const auto area = laneW.r;
        const float w = area.getWidth(), h = area.getHeight();
        juce::Graphics::ScopedSaveState keepIt (gr);
        gr.reduceClipRegion (area.toNearestInt());
        gr.addTransform (juce::AffineTransform::translation (area.getX(), area.getY()));
        c2d::Context ctx (gr, w, h);
        const float laneH = h / (float) peakCh;
        const auto accent = css (cap["cl"], "--wave", "#46d18c");
        const double span = peakTo - peakFrom;
        const bool sampleMode = span > 0 && peakCols >= span;
        auto at = [this] (int ch, int which, int i) { return peaks[(size_t) ((ch * 3 + which) * peakCols + i)]; };
        for (int ch = 0; ch < peakCh; ++ch)
        {
            const float top = (float) ch * laneH, mid = top + laneH / 2, half = (laneH / 2) * 0.92f, colW = w / (float) peakCols;
            ctx.setStroke ("rgba(255,255,255,0.07)");
            ctx.beginPath();
            ctx.moveTo (0, mid);
            ctx.lineTo (w, mid);
            ctx.stroke();
            if (sampleMode)
            {
                const int n = (int) std::min ((double) peakCols, span);
                auto xAt = [&] (int i) { return (float) (i / span * w); };
                auto yAt = [&] (int i) { return mid - at (ch, 1, i) * half; };
                ctx.strokeStyle = accent;
                ctx.globalAlpha = 0.55f;
                ctx.lineWidth = 1;
                ctx.beginPath();
                for (int i = 0; i < n; ++i)
                    i == 0 ? ctx.moveTo (xAt (i), yAt (i)) : ctx.lineTo (xAt (i), yAt (i));
                ctx.stroke();
                ctx.globalAlpha = 1;
            }
            else
            {
                ctx.fillStyle = accent;
                ctx.globalAlpha = 0.34f;
                for (int i = 0; i < peakCols; ++i)
                {
                    const float y1 = mid - at (ch, 1, i) * half, y2 = mid - at (ch, 0, i) * half;
                    ctx.fillRect ((float) i * colW, y1, std::max (colW - 0.3f, 0.6f), std::max (y2 - y1, 1.0f));
                }
                ctx.globalAlpha = 1;
                for (int i = 0; i < peakCols; ++i)
                {
                    const float r = at (ch, 2, i) * half;
                    ctx.fillRect ((float) i * colW, mid - r, std::max (colW - 0.3f, 0.6f), std::max (r * 2, 1.0f));
                }
            }
            if (ch > 0)
            {
                ctx.setStroke ("rgba(255,255,255,0.06)");
                ctx.beginPath();
                ctx.moveTo (0, top);
                ctx.lineTo (w, top);
                ctx.stroke();
            }
        }
        // The head, while the picked sound is heard.
        if (f.info["heard"]["path"].toString() == f.picked && (double) f.info["frames"] > 0)
        {
            const float x = (float) ((double) f.info["at"] / (double) f.info["frames"] * w);
            ctx.globalAlpha = 1;
            ctx.fillStyle = css (cap["cl"], "--look-accent", "#ffb547");
            ctx.fillRect (x, 0, 1.5f, h);
        }
    }

    // renderStats (050): the cards in their order, then format and category wide.
    void drawStats (juce::Graphics& g)
    {
        if (!statsGrid.ok() || !statCard.ok() || !pickedFile.isObject() || !stats.isObject())
            return;
        std::vector<std::pair<juce::String, juce::String>> cards {
            { fmtDur ((double) pickedFile["duration"]), "duration" },
            { fmtDb (stats["peakDbfs"]), "peak" },
            { fmtDb (stats["rmsDbfs"]), "rms" },
            { juce::String ((double) stats["sampleRate"] / 1000.0, 1) + " kHz", "sample rate" },
            { juce::String ((int) stats["bits"]) + "-bit", "bit depth" },
            { (int) stats["channels"] == 1 ? juce::String ("mono") : (int) stats["channels"] == 2 ? juce::String ("stereo") : juce::String ((int) stats["channels"]) + " ch", "channels" },
            { fmtBytes ((double) pickedFile["bytes"]), "size" },
            { commas ((double) stats["frames"]), "frames" },
        };
        if (!stats["correlation"].isVoid() && !stats["correlation"].isUndefined())
            cards.push_back ({ juce::String ((double) stats["correlation"], 3), "correlation" });
        if ((bool) stats["dualMono"])
            cards.push_back ({ "yes", "dual mono" });
        if ((double) stats["clipped"] > 0)
            cards.push_back ({ commas ((double) stats["clipped"]), "clipped" });
        // The grid's own places: as the capture laid its cards out.
        std::vector<N> placed;
        browse::Base::findAll (statsGrid.n, ".stat-card", placed);
        std::vector<N> wide;
        browse::Base::findAll (statsGrid.n, ".stat-card.wide", wide);
        size_t k = 0;
        auto put = [&] (const N& slot, const N& tpl, const juce::String& v, const juce::String& l) {
            f.drawRow (g, *frame, tpl.n, { slot.r.getX() - tpl.r.getX() - RAIL, slot.r.getY() - tpl.r.getY() }, [&] (const juce::var& tn, const juce::String& captured) -> juce::String {
                const auto cls = tn["cls"].toString();
                if (cls == "v")
                    return v;
                if (cls == "l")
                    return l;
                return captured;
            });
        };
        std::vector<N> narrow;
        for (auto& p : placed)
            if (!p.n["cls"].toString().contains ("wide"))
                narrow.push_back (p);
        for (auto& [v, l] : cards)
            if (k < narrow.size())
                put (narrow[k++], narrow[0], v, l);
        if (wide.size() >= 2)
        {
            put (wide[0], wide[0], pickedFile["format"].toString(), "format");
            put (wide[1], wide[0], pickedFile["category"].toString(), "category");
        }
        // whyBox.
        if (whyBox.ok())
        {
            const auto ts = browse::Base::texts (whyBox.n);
            if (!ts.empty())
            {
                const auto& run = ts[0]["text"][0];
                const auto why = pickedFile["why"].toString();
                const auto say = why.isNotEmpty() ? juce::String::fromUTF8 ("Why \xe2\x80\x9c") + pickedFile["category"].toString() + juce::String::fromUTF8 ("\xe2\x80\x9d: ") + why + ". Confidence is " + pickedFile["confidence"].toString() + "."
                                                  : pickedFile["category"].toString() + juce::String::fromUTF8 (" \xe2\x80\x94 no reason recorded.");
                browse::Base::write (g, run, { -RAIL, 0 }, say, whyBox.r.getWidth());
            }
        }
    }

    void chips (juce::Graphics& g, const N& box, const N& tpl, const juce::StringArray& words, float x0)
    {
        if (!box.ok() || !tpl.ok())
            return;
        float x = box.r.getX() + x0, y = box.r.getY();
        for (const auto& w : words)
        {
            const auto runs = browse::Base::texts (tpl.n);
            const auto f0 = runs.empty() ? face::sans (11) : face::font (runs[0]["text"][0]["font"]);
            const float cw = juce::GlyphArrangement::getStringWidth (f0, w) + (tpl.r.getWidth() - (runs.empty() ? 0 : rectOf (runs[0]["text"][0]["rect"]).getWidth()));
            if (x + cw > box.r.getRight() && x > box.r.getX())
            {
                x = box.r.getX();
                y += tpl.r.getHeight() + 4;
            }
            juce::Graphics::ScopedSaveState keep (g);
            const juce::Point<float> by (x - tpl.r.getX(), y - tpl.r.getY());
            face::paintBox (g, tpl.n, { x, y, cw, tpl.r.getHeight() });
            if (!runs.empty())
            {
                const auto& run = runs[0]["text"][0];
                const auto rr = rectOf (run["rect"]).translated (-RAIL, 0);
                browse::Base::write (g, run, { x - (tpl.r.getX()) + (rr.getX() - tpl.r.getX()) - (rr.getX() - tpl.r.getX()) + 0 - RAIL + (float) 0, y - tpl.r.getY() }, w, 0);
            }
            x += cw + 4;
        }
    }

    void drawTags (juce::Graphics& g)
    {
        if (tagSource.ok())
            if (auto ts = browse::Base::texts (tagSource.n); !ts.empty())
                browse::Base::write (g, ts[0]["text"][0], { -RAIL, 0 }, sourceSay, 0);
        if (dirty.ok() && !tagEdits.empty())
        {
            int n = 0;
            for (auto& [k, v] : tagEdits)
                n += v.empty() ? 0 : 1;
            if (n > 0)
                if (auto ts = browse::Base::texts (dirty.n); !ts.empty())
                    browse::Base::write (g, ts[0]["text"][0], { -RAIL, 0 }, juce::String (n) + " unsaved change" + (n == 1 ? "" : "s"), 0);
        }
        if (!sim.isObject())
            return;
        juce::StringArray sonic, heardW, mine;
        if (auto* a = sim["tags"].getArray())
            for (const auto& t : *a)
                sonic.add (t.toString());
        if (auto* a = sim["heard"].getArray())
            for (int i = 0; i < juce::jmin (4, a->size()); ++i)
                heardW.add ((*a)[i]["label"].toString());
        if (auto* a = sim["yourTags"]["mine"].getArray())
            for (const auto& t : *a)
                mine.add (t.toString());
        chips (g, sonicTags, sonicTag, sonic, 0);
        chips (g, heardTags, heardTag.ok() ? heardTag : sonicTag, heardW, 0);
        chips (g, yourTags, userTag.ok() ? userTag : sonicTag, mine, 0);
    }

    void drawTypes (juce::Graphics& g)
    {
        if (btTotal.ok())
            if (auto ts = browse::Base::texts (btTotal.n); !ts.empty())
                browse::Base::write (g, ts[0]["text"][0], { -RAIL, 0 }, commas (total) + " files", 0);
        if (btTypeList.ok() && btTypeOn.ok())
        {
            juce::Graphics::ScopedSaveState keep (g);
            g.reduceClipRegion (btTypeList.r.toNearestInt());
            double most = 1;
            for (auto& t : types)
                most = juce::jmax (most, t.files);
            float y = btTypeOn.r.getY();
            for (auto& t : types)
            {
                const bool on = t.name == f.typeName;
                const auto& tpl = on ? btTypeOn : (btType.ok() ? btType : btTypeOn);
                const juce::Point<float> by (-RAIL, y - tpl.r.getY());
                f.drawRow (g, *frame, tpl.n, by, [&] (const juce::var& tn, const juce::String& captured) -> juce::String {
                    const auto cls = tn["cls"].toString();
                    if (cls.contains ("bt-name"))
                        return t.name;
                    if (cls.contains ("bt-n"))
                        return commas (t.files);
                    if (cls.contains ("bt-cats"))
                        return t.cats.joinIntoString (juce::String::fromUTF8 (" \xc2\xb7 "));
                    return captured;
                }, t.last ? 0.55f : 1.0f);
                // The fill: its width the square root of its share (251).
                if (auto fill = browse::Base::find (tpl.n, ".bt-fill"); fill.ok())
                    if (auto* kids = fill.n["kids"].getArray(); kids != nullptr && !kids->isEmpty())
                    {
                        const auto r = fill.r.translated (by.x, by.y);
                        g.setColour (face::colour ((*kids)[0]["bg"].isArray() && (*kids)[0]["bg"].size() > 0 ? (*kids)[0]["bg"][0]["colour"] : juce::var()));
                        const auto c = face::colour ((*kids)[0]["bg"][0]["colour"]);
                        g.setColour (c.isTransparent() ? css (cap["cl"], "--look-accent", "#ffb547") : c);
                        g.fillRect (r.withWidth (r.getWidth() * (float) juce::jmax (2.0, std::sqrt (t.files / most) * 100) / 100.0f));
                    }
                Hit h;
                h.r = tpl.r.translated (0, by.y).getIntersection (btTypeList.r);
                const auto name = t.name;
                h.click = [this, name] { f.pickType (name); };
                hits.push_back (h);
                y += typePitch;
            }
        }
        const auto* t = type();
        if (btTypeName.ok())
            if (auto ts = browse::Base::texts (btTypeName.n); !ts.empty())
                browse::Base::write (g, ts[0]["text"][0], { -RAIL, 0 }, t != nullptr ? t->name : juce::String ("Pick a type"), 0);
        if (btCount.ok() && t != nullptr)
            if (auto ts = browse::Base::texts (btCount.n); !ts.empty())
            {
                const auto ins = f.instrument == "-" ? juce::String ("not named") : f.instrument;
                const auto say = f.instrument.isNotEmpty() || f.find.isNotEmpty()
                                     ? commas (btTotalCount) + " of " + commas (t->files) + (ins.isNotEmpty() ? juce::String::fromUTF8 (" \xc2\xb7 ") + ins : juce::String())
                                     : commas (btTotalCount) + " files";
                browse::Base::write (g, ts[0]["text"][0], { -RAIL, 0 }, say, 0);
            }
        // The instrument chips, in the capture's own places, flowing.
        if (t != nullptr && btChips.ok() && btChipOn.ok())
        {
            std::vector<std::pair<juce::String, std::pair<juce::String, double>>> cs;
            std::vector<std::pair<juce::String, double>> named;
            double none = -1;
            for (auto& [n, c] : t->instruments)
                if (n.isNotEmpty())
                    named.push_back ({ n, c });
                else
                    none = c;
            std::stable_sort (named.begin(), named.end(), [] (auto& a, auto& b) { return a.second > b.second; });
            if (!named.empty())
            {
                cs.push_back ({ "", { "All", t->files } });
                for (auto& [n, c] : named)
                    cs.push_back ({ n, { n, c } });
                if (none >= 0)
                    cs.push_back ({ "-", { "Not named", none } });
            }
            float x = btChips.r.getX(), y = btChips.r.getY();
            for (auto& [key, lc] : cs)
            {
                const bool on = key == f.instrument;
                const auto& tpl = on ? btChipOn : (btChip.ok() ? btChip : btChipOn);
                const auto ts = browse::Base::texts (tpl.n);
                if (ts.size() < 1)
                    break;
                const auto lf = face::font (ts[0]["text"][0]["font"]);
                const auto nf = ts.size() > 1 ? face::font (ts[1]["text"][0]["font"]) : lf;
                const auto count = commas (lc.second);
                const float pad = rectOf (ts[0]["text"][0]["rect"]).getX() - (tpl.r.getX() + RAIL);
                const float gap = ts.size() > 1 ? rectOf (ts[1]["text"][0]["rect"]).getX() - rectOf (ts[0]["text"][0]["rect"]).getRight() : 4;
                const float w = pad * 2 + juce::GlyphArrangement::getStringWidth (lf, lc.first) + gap + juce::GlyphArrangement::getStringWidth (nf, count);
                if (x + w > btChips.r.getRight() && x > btChips.r.getX())
                {
                    x = btChips.r.getX();
                    y += tpl.r.getHeight() + 6;
                }
                const juce::Rectangle<float> r (x, y, w, tpl.r.getHeight());
                face::paintBox (g, tpl.n, r);
                const float lx = x + pad;
                {
                    const auto& run = ts[0]["text"][0];
                    const auto rr = rectOf (run["rect"]);
                    browse::Base::write (g, run, { lx - rr.getX(), y - (tpl.r.getY()) }, lc.first, 0);
                    if (ts.size() > 1)
                    {
                        const auto& run2 = ts[1]["text"][0];
                        const auto r2 = rectOf (run2["rect"]);
                        browse::Base::write (g, run2, { lx + juce::GlyphArrangement::getStringWidth (lf, lc.first) + gap - r2.getX(), y - tpl.r.getY() }, count, 0);
                    }
                }
                Hit h;
                h.r = r;
                const auto k = key;
                h.click = [this, k] {
                    f.instrument = k;
                    loadTypeFiles();
                    f.saveUi();
                };
                hits.push_back (h);
                x += w + 6;
            }
        }
        // The sort.
        for (auto* s : { &btSortName, &btSortLen })
            if (s->ok())
            {
                Hit h;
                h.r = s->r;
                const auto key = s == &btSortName ? juce::String ("name") : juce::String ("length");
                h.click = [this, key] {
                    if (f.sort == key)
                        return;
                    f.sort = key;
                    loadTypeFiles();
                    f.saveUi();
                };
                hits.push_back (h);
            }
        // Its files.
        if (btFileList.ok() && btFileRow.ok())
        {
            juce::Graphics::ScopedSaveState keep (g);
            g.reduceClipRegion (btFileList.r.toNearestInt());
            float y = btFileRow.r.getY() - btScroll;
            for (const auto& file : btFiles)
            {
                if (y > btFileList.r.getBottom())
                    break;
                if (y + btFilePitch >= btFileList.r.getY())
                    fileRowAt (g, btFileRow, btFileRow, y, file, true, btFileList.r);
                y += btFilePitch;
            }
            btHeight = (float) btFiles.size() * btFilePitch;
        }
    }

    void drawNow (juce::Graphics& g)
    {
        if (!nowName.ok())
            return;
        if (auto ts = browse::Base::texts (nowName.n); !ts.empty())
        {
            const auto heardName = f.info["heard"]["name"].toString();
            browse::Base::write (g, ts[0]["text"][0], { -RAIL, 0 }, heardName.isNotEmpty() ? heardName : juce::String ("no sound"), nowName.r.getWidth());
        }
    }

    void draw (juce::Graphics& g)
    {
        hits.clear();
        if (f.pane == "browse")
            drawTree (g);
        else
            drawPane (g);
        if (f.picked.isNotEmpty())
        {
            // The lane's "Select a sound" is not shown with a sound picked.
            if (laneEmpty.ok())
            {
                g.setColour (css (cap["cl"], "--look-well", "#06070a"));
                g.fillRect (laneEmpty.r.reduced (2));
            }
            drawWave (g);
        }
        drawStats (g);
        drawTags (g);
        drawTypes (g);
        drawNow (g);
        // The chrome's own buttons.
        auto button = [&] (const N& n, std::function<void()> go) {
            if (n.ok())
            {
                Hit h;
                h.r = n.r;
                h.click = std::move (go);
                hits.push_back (h);
            }
        };
        button (playAll, [this] {
            f.playAll = !f.playAll;
            loadTypes();
            wantThumbs();
            f.saveUi();
        });
        button (rescan, [this] { f.refresh(); });
        button (discard, [this] {
            tagEdits.clear();
            fillTags();
            f.say ("Tag edits discarded");
        });
        button (commit, [this] { commitTags(); });
        button (nowPlay, [this] {
            if (pickedFile.isObject())
                f.playFile (pickedFile);
        });
        button (nowStop, [this] { f.module ("stop"); });
        button (leftTitle, [this] { paneMenu(); });
        button (avOpen, [this] { f.say ("Advanced view: every tag field is in the panel; edit them there and Commit"); });
    }

    void drawPane (juce::Graphics& g)
    {
        // The pane's own capture is shown (a child Chrome); its results are written here.
        if (f.pane == "search" && similarHits.size() > 0)
        {
            auto& c = panes["pane_similar"];
            const auto box = browse::Base::find (cap["pane_similar"]["tree"], "#searchResults");
            const auto row = browse::Base::find (cap["pane_similar"]["tree"], ".result");
            const auto head = browse::Base::find (box.n, ".dim");
            if (c == nullptr || !box.ok() || !row.ok())
                return;
            const juce::Point<float> at ((float) (double) cap["pane_similar"]["at"][0], (float) (double) cap["pane_similar"]["at"][1]);
            juce::Graphics::ScopedSaveState keep (g);
            const auto clip = box.r + at;
            g.setColour (css (cap["cl"], "--look-panel", "#1b1d21"));
            g.reduceClipRegion (clip.toNearestInt());
            float y = row.r.getY() - resultScroll;
            const float pitch = row.r.getHeight() + 2;
            if (head.ok())
                f.drawRow (g, *c, head.n, at, [&] (const juce::var&, const juce::String&) { return similarSay; });
            for (const auto& hit : similarHits)
            {
                f.drawRow (g, *c, row.n, { at.x, at.y + y - row.r.getY() }, [&] (const juce::var& tn, const juce::String& captured) -> juce::String {
                    const auto cls = tn["cls"].toString();
                    if (cls.contains ("mono"))
                        return juce::String ((int) std::round ((double) hit["score"] * 100)) + "%";
                    if (cls.contains ("dim"))
                        return hit["category"].toString() + juce::String::fromUTF8 (" \xc2\xb7 ") + juce::String ((double) hit["seconds"], 2) + juce::String::fromUTF8 ("s \xc2\xb7 unlike in ") + hit["differs"].toString();
                    if (captured.isNotEmpty() && !cls.contains ("mono"))
                        return hit["name"].toString();
                    return captured;
                });
                Hit h;
                h.r = juce::Rectangle<float> (clip.getX(), at.y + y, clip.getWidth(), row.r.getHeight()).getIntersection (clip);
                auto file = hit;
                h.click = [this, file] { f.selectFile (file); };
                hits.push_back (h);
                y += pitch;
            }
        }
        if (f.pane == "scan" && scanState.isObject())
        {
            auto& c = panes["pane_scan"];
            const auto cur = browse::Base::find (cap["pane_scan"]["tree"], "#scanCurrent");
            const auto cnt = browse::Base::find (cap["pane_scan"]["tree"], "#scanCount");
            const auto fill = browse::Base::find (cap["pane_scan"]["tree"], ".progress");
            const juce::Point<float> at ((float) (double) cap["pane_scan"]["at"][0], (float) (double) cap["pane_scan"]["at"][1]);
            if (c != nullptr && fill.ok())
            {
                const double tot = (double) scanState["total"], done = (double) scanState["done"];
                g.setColour (css (cap["cl"], "--accent", "#46d18c"));
                g.fillRoundedRectangle ((fill.r + at).withWidth (fill.r.getWidth() * (float) (tot > 0 ? done / tot : 0)), 2);
                if (cur.ok())
                    if (auto ts = browse::Base::texts (cur.n); !ts.empty())
                        browse::Base::write (g, ts[0]["text"][0], at, scanState["current"].toString().isNotEmpty() ? scanState["current"].toString() : (bool) scanState["running"] ? juce::String::fromUTF8 ("scanning\xe2\x80\xa6") : juce::String ("done"), fill.r.getWidth() - 60);
                if (cnt.ok())
                    if (auto ts = browse::Base::texts (cnt.n); !ts.empty())
                        browse::Base::write (g, ts[0]["text"][0], at, juce::String ((int) done) + "/" + juce::String ((int) tot), 0);
            }
            if (auto start = browse::Base::find (cap["pane_scan"]["tree"], "#startScan"); start.ok())
            {
                Hit h;
                h.r = start.r + at;
                h.click = [this] { f.startScan(); };
                hits.push_back (h);
            }
        }
        if (f.pane == "import")
        {
            const juce::Point<float> at ((float) (double) cap["pane_import"]["at"][0], (float) (double) cap["pane_import"]["at"][1]);
            if (auto p = browse::Base::find (cap["pane_import"]["tree"], "#libraryPath"); p.ok())
                if (auto ts = browse::Base::texts (p.n); !ts.empty())
                {
                    g.setColour (css (cap["cl"], "--look-panel", "#1b1d21"));
                    browse::Base::write (g, ts[0]["text"][0], at, libState["library"].toString().isNotEmpty() ? libState["library"].toString() : juce::String ("none chosen"), p.r.getWidth());
                }
            if (auto pick = browse::Base::find (cap["pane_import"]["tree"], "#pickLibrary"); pick.ok())
            {
                Hit h;
                h.r = pick.r + at;
                h.click = [this] { chooseFolder(); };
                hits.push_back (h);
            }
            if (auto re = browse::Base::find (cap["pane_import"]["tree"], "#rescanLibrary"); re.ok())
            {
                Hit h;
                h.r = re.r + at;
                h.click = [this] {
                    f.showPane ("scan");
                    f.startScan();
                };
                hits.push_back (h);
            }
        }
        if (f.pane == "search")
        {
            const auto key = similarHits.isEmpty() ? "pane_search" : "pane_similar";
            const juce::Point<float> at ((float) (double) cap[key]["at"][0], (float) (double) cap[key]["at"][1]);
            if (auto b = browse::Base::find (cap[key]["tree"], "#similarBtn"); b.ok())
            {
                Hit h;
                h.r = b.r + at;
                h.click = [this] { f.similar(); };
                hits.push_back (h);
            }
        }
    }

    void paneMenu()
    {
        juce::PopupMenu m;
        // The rail's Library items, as MGL lists them under Browse.
        m.addItem (1, juce::String::fromUTF8 ("\xe2\x89\xa1  All sounds"), true, f.pane == "browse");
        m.addItem (2, juce::String::fromUTF8 ("\xe2\x8c\x95  Search"), true, f.pane == "search");
        m.addItem (3, juce::String::fromUTF8 ("\xe2\x97\xb4  Scan"), true, f.pane == "scan");
        m.addItem (4, juce::String::fromUTF8 ("\xe2\x8c\x82  Folder"), true, f.pane == "import");
        m.addItem (5, juce::String::fromUTF8 ("\xe2\x97\x8d  Map (the 3D views: not in the app yet)"), false);
        juce::Component::SafePointer<BrowseFace> self (&f);
        m.showMenuAsync (juce::PopupMenu::Options().withTargetScreenArea (f.localAreaToGlobal (leftTitle.r.toNearestInt())), [self] (int r) {
            if (self == nullptr || r <= 0)
                return;
            self->showPane (r == 1 ? "browse" : r == 2 ? "search" : r == 3 ? "scan" : "import");
        });
    }

    std::unique_ptr<juce::FileChooser> chooser;
    void chooseFolder()
    {
        // The page's folder picker (`/api/browse`) chooses a folder; here the
        // Mac's own chooser does, and MGL's `/api/library` sets it.
        chooser = std::make_unique<juce::FileChooser> ("Choose the audio library folder", juce::File (libState["library"].toString()));
        juce::Component::SafePointer<BrowseFace> self (&f);
        chooser->launchAsync (juce::FileBrowserComponent::openMode | juce::FileBrowserComponent::canSelectDirectories, [self] (const juce::FileChooser& fc) {
            if (self == nullptr || fc.getResult() == juce::File())
                return;
            juce::DynamicObject::Ptr o = new juce::DynamicObject();
            o->setProperty ("path", fc.getResult().getFullPathName());
            self->d->ask ("POST", "/api/library", juce::JSON::toString (juce::var (o.get()), true), [self] (const mgllib::Answer& a) {
                if (self == nullptr)
                    return;
                if (!a.ok())
                    return self->say (a.json()["error"].toString());
                self->say (juce::String::fromUTF8 ("Library set \xe2\x80\x94 run a scan to index it"));
                self->d->files.clear();
                self->d->thumbs.clear();
                self->d->thumbAsked.clear();
                self->openFolders.clear();
                self->refresh();
                self->showPane ("scan");
            });
        });
    }

    void commitTags()
    {
        if (tagEdits.empty())
            return f.say ("Nothing to commit");
        juce::DynamicObject::Ptr folders = new juce::DynamicObject(), filesO = new juce::DynamicObject();
        for (auto& [k, v] : tagEdits)
        {
            if (v.empty())
                continue;
            juce::DynamicObject::Ptr e = new juce::DynamicObject();
            for (auto& [kk, vv] : v)
                e->setProperty (kk, vv);
            (k.containsChar ('/') ? filesO : folders)->setProperty (k, juce::var (e.get()));
        }
        juce::DynamicObject::Ptr o = new juce::DynamicObject();
        o->setProperty ("folders", juce::var (folders.get()));
        o->setProperty ("files", juce::var (filesO.get()));
        ask ("POST", "/api/save", juce::JSON::toString (juce::var (o.get()), true), [this] (const mgllib::Answer& a) {
            if (!a.ok())
                return f.say ("Commit failed: " + a.json()["error"].toString());
            f.say (juce::String::fromUTF8 ("Committed \xe2\x80\x94 ") + a.json()["foldersWritten"].toString() + " _TAGS.txt written");
            tagEdits.clear();
        });
    }
};

BrowseFace::BrowseFace (Call c, uint32_t i) : browse::Base (std::move (c), i)
{
    setSize (1500, 1100);
    d = std::make_unique<Impl> (*this);
    // The page's own state, as the patch kept it.
    module ("info");
    const auto ui = info["ui"];
    if (ui.isObject())
    {
        pane = ui["pane"].toString().isNotEmpty() ? ui["pane"].toString() : pane;
        picked = ui["picked"].toString();
        typeName = ui["type"].toString();
        if (ui["sort"].toString() == "length")
            sort = "length";
        instrument = ui["instrument"].toString();
        filter = ui["filter"].toString();
        playAll = (bool) ui["playAll"];
        if (auto* o = ui["open"].getArray())
            for (const auto& n : *o)
                openFolders.add (n.toString());
    }
    auto& tf = field ("filter", d->treeFilter, juce::String::fromUTF8 ("filter\xe2\x80\xa6"));
    tf.setText (filter, false);
    tf.onTextChange = [this, &tf] {
        filter = tf.getText().toLowerCase().trim();
        d->wantThumbs();
        d->over.repaint();
        saveUi();
    };
    auto& ff = field ("find", d->btFind, juce::String::fromUTF8 ("find\xe2\x80\xa6"));
    ff.onTextChange = [this, &ff] {
        find = ff.getText().trim();
        d->loadTypeFiles();
    };
    for (auto [key, n] : { std::pair<const char*, browse::N*> { "level1", &d->lvl1 }, { "level2", &d->lvl2 }, { "tags", &d->tags }, { "notes", &d->notes } })
    {
        auto& e = field (key, *n, {}, juce::String (key) == "notes");
        const auto k = juce::String (key);
        e.onTextChange = [this, k, &e] {
            const auto name = picked.isNotEmpty() ? picked : d->selectedFolder;
            if (name.isEmpty())
                return;
            d->tagEdits[name][k] = e.getText().trim();
            if (picked.isNotEmpty())
                d->sourceSay = "Edited";
            d->over.repaint();
        };
    }
    auto& at = field ("addTag", d->addTag, juce::String::fromUTF8 ("add a tag of your own\xe2\x80\xa6"));
    at.onReturnKey = [this, &at] {
        const auto tag = at.getText().trim();
        if (picked.isEmpty() || tag.isEmpty())
            return;
        at.clear();
        juce::Array<juce::var> list;
        if (auto* m = d->sim["yourTags"]["mine"].getArray())
            list.addArray (*m);
        list.add (tag);
        juce::DynamicObject::Ptr o = new juce::DynamicObject();
        o->setProperty ("path", picked);
        o->setProperty ("tags", list);
        d->ask ("POST", "/api/usertags", juce::JSON::toString (juce::var (o.get()), true), [this] (const mgllib::Answer& a) {
            if (!a.ok())
                return say ("Could not save tag: " + a.json()["error"].toString());
            if (auto* s = d->sim.getDynamicObject())
                s->setProperty ("yourTags", a.json());
        });
    };
    for (auto& [k, e] : fields)
        e->setColour (juce::TextEditor::textColourId, css (d->cap["cl"], "--look-text", "#e8eaee"));
    showPane (pane);
    refresh();
    startTimerHz (30);
}

BrowseFace::~BrowseFace()
{
    stopTimer();
    for (auto& [k, e] : fields)
        e->onTextChange = nullptr;
    d.reset();
}

void BrowseFace::saveUi()
{
    juce::DynamicObject::Ptr o = new juce::DynamicObject();
    o->setProperty ("pane", pane);
    o->setProperty ("picked", picked);
    o->setProperty ("type", typeName);
    o->setProperty ("sort", sort);
    o->setProperty ("instrument", instrument);
    o->setProperty ("filter", filter);
    o->setProperty ("playAll", playAll);
    juce::Array<juce::var> open;
    for (const auto& n : openFolders)
        open.add (n);
    o->setProperty ("open", open);
    module ("ui", juce::var (o.get()));
}

void BrowseFace::refresh()
{
    d->loadFolders();
    if (picked.isNotEmpty())
    {
        // The sound picked, as the library lists it.
        const auto folder = picked.upToFirstOccurrenceOf ("/", false, false);
        d->ask ("GET", "/api/files?folder=" + mgllib::esc (folder), {}, [this] (const mgllib::Answer& a) {
            if (auto* fs = a.json().getArray())
                for (const auto& file : *fs)
                    if (file["path"].toString() == picked)
                    {
                        d->pickedFile = file;
                        d->loadPicked();
                    }
        });
    }
}

void BrowseFace::toggleFolder (const juce::String& name)
{
    const bool was = openFolders.contains (name);
    if (was)
        openFolders.removeString (name);
    else
        openFolders.add (name);
    d->selectedFolder = name;
    if (!was && d->files.find (name) == d->files.end())
        d->loadFiles (name);
    d->over.repaint();
    saveUi();
}

void BrowseFace::selectFile (const juce::var& file)
{
    picked = file["path"].toString();
    d->pickedFile = file;
    d->selectedFolder = d->folderNameOf (file);
    d->loadPicked();
    d->over.repaint();
    saveUi();
}

void BrowseFace::playFile (const juce::var& file)
{
    if (picked != file["path"].toString())
        selectFile (file);
    const auto f = mgllib::fileOf (file["path"].toString());
    juce::DynamicObject::Ptr o = new juce::DynamicObject();
    o->setProperty ("file", f.getFullPathName());
    o->setProperty ("path", file["path"]);
    o->setProperty ("name", file["name"]);
    const auto r = module ("play", juce::var (o.get()));
    if (r.hasProperty ("error"))
        say ("Could not play " + file["name"].toString() + ": " + r["error"].toString());
    d->over.repaint();
}

void BrowseFace::openFile (const juce::var& file)
{
    if (choose)
        choose (mgllib::fileOf (file["path"].toString()).getFullPathName(), file["path"].toString(), file["name"].toString(), {});
}

void BrowseFace::pickType (const juce::String& name)
{
    if (typeName == name)
        return;
    typeName = name;
    instrument = {};
    find = {};
    if (auto it = fields.find ("find"); it != fields.end())
        it->second->setText ({}, false);
    d->loadTypeFiles();
    d->over.repaint();
    saveUi();
}

void BrowseFace::showPane (const juce::String& p)
{
    pane = p;
    for (auto& [k, c] : d->panes)
        c->setVisible ((p == "search" && k == (d->similarHits.isEmpty() ? "pane_search" : "pane_similar")) || (p == "scan" && k == "pane_scan") || (p == "import" && k == "pane_import"));
    if (auto it = fields.find ("filter"); it != fields.end())
        it->second->setVisible (p == "browse");
    if (p == "scan")
        d->ask ("GET", "/api/scan", {}, [this] (const mgllib::Answer& a) { d->scanState = a.json(); });
    d->over.toFront (false);
    for (auto& [k, e] : fields)
        e->toFront (false);
    d->over.repaint();
}

void BrowseFace::similar()
{
    if (picked.isEmpty())
    {
        d->similarSay = "Select a sound first.";
        return;
    }
    d->similarSay = juce::String::fromUTF8 ("Listening to the library\xe2\x80\xa6");
    const auto name = d->pickedFile["name"].toString();
    d->ask ("GET", "/api/similar?p=" + mgllib::esc (picked) + "&limit=40", {}, [this, name] (const mgllib::Answer& a) {
        const auto v = a.json();
        d->similarHits.clear();
        if (auto* r = v["results"].getArray())
            d->similarHits.addArray (*r);
        d->similarSay = d->similarHits.isEmpty() ? juce::String ("Nothing to compare against.") : "Like " + name + juce::String::fromUTF8 (" \xc2\xb7 ") + v["indexed"].toString() + " sounds measured";
        showPane ("search");
    });
}

void BrowseFace::startScan()
{
    d->ask ("POST", "/api/scan", {}, [this] (const mgllib::Answer& a) {
        if (!a.ok())
            return say (a.json()["error"].toString());
        scanning = true;
    });
}

void BrowseFace::tick()
{
    // The head, while something is heard.
    const bool was = (bool) info["playing"];
    module ("info");
    if (was || (bool) info["playing"])
        d->over.repaint (d->laneW.r.toNearestInt().expanded (2));
    if (was != (bool) info["playing"])
        d->over.repaint();
    if (scanning && ++scanTicks % 12 == 0)
        d->ask ("GET", "/api/scan", {}, [this] (const mgllib::Answer& a) {
            d->scanState = a.json();
            if (!(bool) d->scanState["running"] && scanning)
            {
                scanning = false;
                d->files.clear();
                d->thumbs.clear();
                d->thumbAsked.clear();
                openFolders.clear();
                refresh();
                say ("Scan complete");
            }
        });
}

juce::Rectangle<float> BrowseFace::where (const juce::String& part) const
{
    if (part == "tree")
        return d->tree.r;
    if (part == "playAll")
        return d->playAll.r;
    if (part == "types")
        return d->btTypeList.r;
    if (part == "btFiles")
        return d->btFileList.r;
    if (part == "title")
        return d->leftTitle.r;
    if (part == "commit")
        return d->commit.r;
    if (part == "lane")
        return d->laneW.r;
    if (part == "sortLength")
        return d->btSortLen.r;
    // A row by what it says: "folder:<name>", "file:<path>", "type:<name>", "play:<path>", "chip:<name>".
    for (const auto& h : d->hits)
        juce::ignoreUnused (h);
    return {};
}

void BrowseFace::paint (juce::Graphics&) {}

namespace
{
const Hit* hitAt (const std::vector<Hit>& hits, juce::Point<float> p)
{
    // The last drawn is on top (a row's play button over its row).
    const Hit* best = nullptr;
    for (const auto& h : hits)
        if (h.r.contains (p))
        {
            if (best == nullptr || h.r.getWidth() * h.r.getHeight() < best->r.getWidth() * best->r.getHeight())
                best = &h;
        }
    return best;
}
} // namespace

void BrowseFace::mouseDown (const juce::MouseEvent& e)
{
    if (blocked && blocked (e))
        return;
    grabKeyboardFocus();
    if (const auto* h = hitAt (d->hits, e.position); h != nullptr && h->click)
        h->click();
}

void BrowseFace::mouseDrag (const juce::MouseEvent&) {}
void BrowseFace::mouseUp (const juce::MouseEvent&) {}

void BrowseFace::mouseDoubleClick (const juce::MouseEvent& e)
{
    if (const auto* h = hitAt (d->hits, e.position); h != nullptr && h->dbl)
        h->dbl();
}

void BrowseFace::mouseWheelMove (const juce::MouseEvent& e, const juce::MouseWheelDetails& w)
{
    auto scroll = [&] (float& s, float content, float view) {
        s = juce::jlimit (0.0f, juce::jmax (0.0f, content - view + 8), s - w.deltaY * 300);
        d->over.repaint();
    };
    if (d->tree.r.contains (e.position) && pane == "browse")
        scroll (d->treeScroll, d->treeHeight, d->tree.r.getHeight());
    else if (d->btFileList.r.contains (e.position))
    {
        scroll (d->btScroll, d->btHeight, d->btFileList.r.getHeight());
        if (d->btScroll + d->btFileList.r.getHeight() > d->btHeight - 600)
            d->loadTypeFiles (true);
        d->wantThumbs();
    }
    else if (pane == "search")
        scroll (d->resultScroll, (float) d->similarHits.size() * 30, 600);
}

bool BrowseFace::keyPressed (const juce::KeyPress& k)
{
    // ↑ ↓ step through the type's files and play each (251).
    if (k == juce::KeyPress::downKey || k == juce::KeyPress::upKey)
    {
        const auto& list = d->btFiles;
        if (list.isEmpty())
            return true;
        int at = -1;
        for (int i = 0; i < list.size(); ++i)
            if (list[i]["path"].toString() == picked)
                at = i;
        const int next = juce::jlimit (0, list.size() - 1, at < 0 ? 0 : at + (k == juce::KeyPress::downKey ? 1 : -1));
        playFile (list[next]);
        return true;
    }
    return false;
}

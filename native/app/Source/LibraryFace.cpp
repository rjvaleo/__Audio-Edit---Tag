// Library's face (BrowseFace.h): MGL's Library page, the PC's own sounds
// (ui/app/430-library-page.js, 058-library.css).
#include "BrowseFace.h"

#include "Canvas2D.h"
#include "Places.h"

#include <juce_audio_formats/juce_audio_formats.h>

namespace
{
using browse::N;

juce::Rectangle<float> rectOf (const juce::var& r)
{
    if (!r.isArray() || r.size() < 4)
        return {};
    return { (float) (double) r[0], (float) (double) r[1], (float) (double) r[2], (float) (double) r[3] };
}

const std::map<juce::String, juce::String>& models()
{
    static const std::map<juce::String, juce::String> m { { "stable-audio-open-small", "Stable Audio Open Small" }, { "tangoflux", "TangoFlux" }, { "ace-step-1.5", "ACE-Step 1.5" } };
    return m;
}

struct Hit
{
    juce::Rectangle<float> r;
    std::function<void()> click;
};
} // namespace

struct LibraryFace::Impl
{
    LibraryFace& f;
    const juce::var& cap;
    std::unique_ptr<face::Chrome> frame;
    struct Over final : public juce::Component
    {
        std::function<void (juce::Graphics&)> draw;
        void paint (juce::Graphics& g) override { if (draw) draw (g); }
    } over;
    juce::Point<float> at;

    N sync, count, pcount, q, groups, gname, gmeta, tiles, detail, dwave, dplay, dlen, dprompt, dseed, dmodel, dtime, dfile, dpill, dnote, acts, refresh;
    N grp, grpOn, tile, tileOn, pillHit, pillLoop;
    std::vector<N> segKind, segOrder, segLoop, actButtons;
    float grpPitch = 30, tileStepX = 230, tileStepY = 120;
    int tilesPerRow = 3;

    juce::Array<juce::var> list;
    juce::String err;
    bool busy = false;
    std::map<juce::String, std::vector<float>> peaks; // file -> 376 peaks, or empty while waiting
    std::set<juce::String> asked;
    juce::String acting;
    float groupScroll = 0;
    std::vector<Hit> hits;

    explicit Impl (LibraryFace& face) : f (face), cap (face::page ("library"))
    {
        frame = std::make_unique<face::Chrome> (cap["page"]);
        at = { (float) (double) cap["page"]["at"][0], (float) (double) cap["page"]["at"][1] };
        const auto root = rectOf (cap["page"]["tree"]["rect"]);
        frame->setBounds ((int) at.x, (int) at.y, (int) root.getWidth(), (int) root.getHeight());
        frame->setInterceptsMouseClicks (false, false);
        f.addAndMakeVisible (*frame);
        over.setInterceptsMouseClicks (false, false);
        over.draw = [this] (juce::Graphics& g) { draw (g); };
        f.addAndMakeVisible (over);
        over.setBounds (0, 0, 1500, 780);
        const auto& t = cap["page"]["tree"];
        auto find = [&] (const juce::String& cls, int nth = 0) {
            auto n = browse::Base::find (t, cls, nth);
            n.r = n.r + at;
            return n;
        };
        sync = find ("#lbSync");
        count = find ("#lbCount");
        pcount = find ("#lbPCount");
        q = find ("#lbQ");
        groups = find ("#lbGroups");
        gname = find ("#lbGName");
        gmeta = find ("#lbGMeta");
        tiles = find ("#lbTiles");
        detail = find ("#lbDetail");
        dwave = find ("#lbDWave");
        dplay = find ("#lbDPlay");
        dlen = find ("#lbDLen");
        dprompt = find ("#lbDPrompt");
        dseed = find ("#lbDSeed");
        dmodel = find ("#lbDModel");
        dtime = find ("#lbDTime");
        dfile = find ("#lbDFile");
        dpill = find ("#lbDPill");
        dnote = find ("#lbDNote");
        acts = find ("#lbActs");
        refresh = find ("#lbRefresh");
        grpOn = find (".lb-grp.on");
        grp = find (".lb-grp", 1);
        if (grp.ok() && grpOn.ok())
            grpPitch = grp.r.getY() - grpOn.r.getY();
        tileOn = find (".lb-tile.on");
        tile = find (".lb-tile", 1);
        if (tile.ok() && tileOn.ok())
            tileStepX = tile.r.getX() - tileOn.r.getX();
        if (auto t3 = find (".lb-tile", 3); t3.ok() && tileOn.ok())
            tileStepY = t3.r.getY() - tileOn.r.getY();
        if (tileStepX > 0)
            tilesPerRow = juce::jmax (1, (int) std::floor ((tiles.r.getWidth() + 4) / tileStepX));
        pillLoop = find (".lb-pill.loop");
        auto segs = [&] (const juce::String& id, std::vector<N>& out) {
            const auto box = find (id);
            std::vector<N> b;
            browse::Base::findAll (box.n, "button", b);
            if (b.empty())
                browse::Base::findAll (box.n, ".ui-seg-b", b);
            for (auto& x : b)
                out.push_back ({ x.n, x.r + at });
        };
        segs ("#lbKind", segKind);
        segs ("#lbOrder", segOrder);
        segs ("#lbLoop", segLoop);
        {
            std::vector<N> b;
            browse::Base::findAll (acts.n, ".st-btn", b);
            for (auto& x : b)
                actButtons.push_back ({ x.n, x.r + at });
        }
        auto skipKids = [&] (const N& n) {
            if (auto* kids = n.n["kids"].getArray())
                for (const auto& k : *kids)
                    frame->skip.insert ((int) k["i"]);
        };
        skipKids (groups);
        skipKids (tiles);
        skipKids (dpill);
        for (const N* n : { &sync, &count, &pcount, &gname, &gmeta, &dlen, &dprompt, &dseed, &dmodel, &dtime, &dfile, &dnote, &q })
            if (n->ok())
            {
                frame->skipText.insert ((int) n->n["i"]);
                for (const auto& x : browse::Base::texts (n->n))
                    frame->skipText.insert ((int) x["i"]);
            }
        if (sync.ok())
            frame->skip.insert ((int) sync.n["i"]);
    }

    void ask (const juce::String& m, const juce::String& t, const juce::String& b, std::function<void (const mgllib::Answer&)> done)
    {
        ++f.pending;
        juce::Component::SafePointer<LibraryFace> self (&f);
        mgllib::ask (m, t, b, [self, done] (const mgllib::Answer& a) {
            if (self == nullptr)
                return;
            --self->pending;
            done (a);
            self->d->over.repaint();
        });
    }

    juce::Array<juce::var> sounds() const
    {
        juce::Array<juce::var> out;
        for (const auto& x : list)
            if (f.kind.isEmpty() || x["type"].toString() == f.kind)
                out.add (x);
        return out;
    }
    static juce::String words (const juce::var& x)
    {
        if (x["prompt"].toString().isNotEmpty())
            return x["prompt"].toString();
        if (x["label"].toString().isNotEmpty())
            return x["label"].toString();
        return x["file"].toString().fromLastOccurrenceOf ("/", false, false);
    }
    struct Group
    {
        juce::String p, t;
        juce::Array<juce::var> xs;
    };
    // lbGroups (430).
    std::vector<Group> groupsNow() const
    {
        std::vector<Group> g;
        for (const auto& x : sounds())
        {
            const auto p = words (x);
            if (f.q.isNotEmpty() && !p.toLowerCase().contains (f.q))
                continue;
            auto it = std::find_if (g.begin(), g.end(), [&] (const Group& y) { return y.p == p; });
            if (it == g.end())
            {
                g.push_back ({ p, {}, {} });
                it = g.end() - 1;
            }
            it->xs.add (x);
            if (x["time"].toString() > it->t)
                it->t = x["time"].toString();
        }
        if (f.order == "new")
            std::stable_sort (g.begin(), g.end(), [] (const Group& a, const Group& b) { return b.t < a.t; });
        else
            std::stable_sort (g.begin(), g.end(), [] (const Group& a, const Group& b) { return a.p.compareIgnoreCase (b.p) < 0; });
        return g;
    }
    juce::Array<juce::var> shown() const
    {
        for (auto& g : groupsNow())
            if (g.p == f.group)
                return g.xs;
        return {};
    }

    static juce::String secs (const juce::var& x)
    {
        const auto v = x["seconds"];
        if (v.isVoid() || !std::isfinite ((double) v))
            return {};
        return juce::String ((double) v, 1) + " s";
    }

    // lbPeaks (430): the PC's copy, its first channel, the largest of each of 376 runs.
    void want (const juce::var& x)
    {
        const auto file = x["file"].toString();
        if (!asked.insert (file).second)
            return;
        juce::Component::SafePointer<LibraryFace> self (&f);
        ask ("GET", "/api/pc/audio?file=" + mgllib::esc (file), {}, [self, file] (const mgllib::Answer& a) {
            if (self == nullptr || !a.ok())
                return;
            auto cached = self->d->cacheFile (file);
            cached.replaceWithData (a.body.getData(), a.body.getSize());
            juce::AudioFormatManager fm;
            fm.registerBasicFormats();
            std::unique_ptr<juce::AudioFormatReader> r (fm.createReaderFor (cached));
            if (r == nullptr)
                return;
            juce::AudioBuffer<float> b (1, (int) r->lengthInSamples);
            r->read (&b, 0, (int) r->lengthInSamples, 0, true, false);
            const int n = 376, len = b.getNumSamples(), step = juce::jmax (1, len / n);
            std::vector<float> out ((size_t) n, 0.0f);
            const float* ch = b.getReadPointer (0);
            for (int i = 0; i < n; ++i)
            {
                float m = 0;
                for (int j = i * step, e = juce::jmin (len, j + step); j < e; ++j)
                    m = juce::jmax (m, std::abs (ch[j]));
                out[(size_t) i] = m;
            }
            self->d->peaks[file] = out;
        });
    }
    juce::File cacheFile (const juce::String& file) const
    {
        auto dir = places::home().getChildFile ("pc-cache");
        dir.createDirectory();
        return dir.getChildFile (file.replaceCharacters ("/", "_"));
    }

    // lbWaveInto (430).
    void wave (juce::Graphics& g, juce::Rectangle<float> r, const juce::var& x, float W, float H)
    {
        juce::Graphics::ScopedSaveState keep (g);
        g.addTransform (juce::AffineTransform::scale (r.getWidth() / W, r.getHeight() / H).translated (r.getX(), r.getY()));
        const auto col = c2dColour (x["type"].toString() == "hit" ? "--f-attack" : "--f-tone");
        g.setColour (col);
        auto it = peaks.find (x["file"].toString());
        if (it == peaks.end() || it->second.empty())
        {
            g.setColour (col.withMultipliedAlpha (0.35f));
            g.fillRect (0.0f, H / 2, W, 1.0f);
            return;
        }
        const auto& p = it->second;
        float pk = 0;
        for (auto v : p)
            pk = juce::jmax (pk, v);
        const float k = pk > 0 ? 1 / pk : 0;
        for (int i = 0; i < (int) W; i += 2)
        {
            const float a = juce::jmax (0.5f, p[(size_t) juce::jmin ((int) p.size() - 1, (int) std::floor ((float) i / W * (float) p.size()))] * k * H * 0.46f);
            g.fillRect ((float) i, H / 2 - a, 1.4f, a * 2);
        }
        if (f.info["heard"]["file"].toString().isNotEmpty() && (bool) f.info["playing"] && f.info["heard"]["pc"].toString() == x["file"].toString() && (double) f.info["frames"] > 0)
        {
            g.setColour (c2dColour ("--look-accent"));
            g.fillRect (juce::jmin (W - 2, (float) ((double) f.info["at"] / (double) f.info["frames"]) * W), 0.0f, 2.0f, H);
        }
    }
    juce::Colour c2dColour (const char* key) const
    {
        const auto s = cap["cl"][key].toString();
        return s.isEmpty() ? juce::Colour (0xff77ddcc) : c2d::css (s);
    }

    void write (juce::Graphics& g, const N& n, const juce::String& text, float room = 0)
    {
        if (!n.ok())
            return;
        const auto ts = browse::Base::texts (n.n);
        if (ts.empty())
            return;
        browse::Base::write (g, ts[0]["text"][0], at, text, room);
    }

    void draw (juce::Graphics& g)
    {
        hits.clear();
        const auto gs = groupsNow();
        if (f.group.isEmpty() || std::none_of (gs.begin(), gs.end(), [&] (auto& x) { return x.p == f.group; }))
            f.group = gs.empty() ? juce::String() : gs[0].p;
        // The head: lbStatus, the count.
        if (sync.ok())
        {
            const auto say = busy ? juce::String::fromUTF8 ("READING THE PC\xe2\x80\xa6") : err.isNotEmpty() ? juce::String::fromUTF8 ("\xe2\x97\x8f THE PC DID NOT ANSWER") : juce::String::fromUTF8 ("\xe2\x97\x8f THE PC \xc2\xb7 CONNECTED");
            juce::Colour tint = err.isNotEmpty() ? c2dColour ("--bad") : busy ? c2dColour ("--look-text-3") : face::colour (browse::Base::texts (sync.n).empty() ? juce::var() : browse::Base::texts (sync.n)[0]["text"][0]["font"]["colour"]);
            if (auto ts = browse::Base::texts (sync.n); !ts.empty())
                browse::Base::write (g, ts[0]["text"][0], at, say, 0, &tint);
        }
        write (g, count, list.isEmpty() && busy ? juce::String() : juce::String (sounds().size()) + " SOUNDS");
        write (g, pcount, juce::String ((int) gs.size()));
        // The prompts.
        if (groups.ok() && grpOn.ok())
        {
            juce::Graphics::ScopedSaveState keep (g);
            g.reduceClipRegion (groups.r.toNearestInt());
            float y = grpOn.r.getY() - groupScroll;
            for (auto& gr : gs)
            {
                const bool on = gr.p == f.group;
                const auto& tpl = on ? grpOn : (grp.ok() ? grp : grpOn);
                if (y > groups.r.getBottom())
                    break;
                const juce::Point<float> by (at.x, at.y + y - (tpl.r.getY()));
                f.drawRow (g, *frame, tpl.n, by, [&] (const juce::var& tn, const juce::String& captured) -> juce::String {
                    if (tn["tag"].toString() == "i" && !tn["cls"].toString().contains ("lb-k"))
                        return juce::String (gr.xs.size());
                    if (tn["tag"].toString() == "span" || captured.length() > 3)
                        return gr.p;
                    return captured;
                });
                // The kind's dot: hits, loops or both.
                if (auto k = browse::Base::find (tpl.n, ".lb-k"); k.ok())
                {
                    bool hit = true, loop = true;
                    for (auto& x : gr.xs)
                    {
                        hit = hit && x["type"].toString() == "hit";
                        loop = loop && x["type"].toString() == "loop";
                    }
                    g.setColour (c2dColour (hit ? "--f-attack" : loop ? "--f-tone" : "--look-text-3"));
                    g.fillEllipse (k.r + by);
                }
                Hit h;
                h.r = (tpl.r + juce::Point<float> (at.x, by.y)).getIntersection (groups.r);
                const auto p = gr.p;
                h.click = [this, p] {
                    f.group = p;
                    f.pick = -1;
                    over.repaint();
                };
                hits.push_back (h);
                y += grpPitch;
            }
            if (gs.empty())
                write (g, grpOn, busy ? juce::String::fromUTF8 ("Reading the PC\xe2\x80\x99s library\xe2\x80\xa6") : err.isNotEmpty() ? juce::String::fromUTF8 ("The PC\xe2\x80\x99s library could not be read: ") + err : list.isEmpty() ? juce::String::fromUTF8 ("Nothing in the PC\xe2\x80\x99s library yet.") : juce::String ("Nothing matches."));
        }
        // The sounds of the prompt picked.
        const auto xs = shown();
        if (f.pick < 0 || f.pick >= xs.size())
            f.pick = xs.isEmpty() ? -1 : 0;
        write (g, gname, f.group.isNotEmpty() ? f.group.toUpperCase() : juce::String ("SOUNDS"), gmeta.ok() ? gmeta.r.getX() - gname.r.getX() - 10 : 0);
        write (g, gmeta, xs.isEmpty() ? juce::String() : juce::String (xs.size()) + " sound" + (xs.size() > 1 ? "s" : ""));
        if (tiles.ok() && tileOn.ok())
            for (int i = 0; i < xs.size(); ++i)
            {
                const auto& x = xs[i];
                const bool on = i == f.pick;
                const auto& tpl = on ? tileOn : (tile.ok() ? tile : tileOn);
                const float tx = tileOn.r.getX() + (float) (i % tilesPerRow) * tileStepX, ty = tileOn.r.getY() + (float) (i / tilesPerRow) * tileStepY;
                if (ty > tiles.r.getBottom())
                    break;
                const juce::Point<float> by (tx - tpl.r.getX(), ty - tpl.r.getY());
                f.drawRow (g, *frame, tpl.n, by + at, [&] (const juce::var& tn, const juce::String& captured) -> juce::String {
                    if (tn["tag"].toString() == "b")
                        return "seed " + (x["seed"].isVoid() ? juce::String::fromUTF8 ("\xe2\x80\x94") : x["seed"].toString());
                    if (tn["cls"].toString().contains ("lb-pill"))
                        return x["type"].toString().toUpperCase();
                    if (captured.endsWith (" s"))
                        return secs (x);
                    return captured;
                });
                want (x);
                std::vector<N> cv;
                browse::Base::findAll (tpl.n, "canvas", cv);
                if (!cv.empty())
                    wave (g, cv[0].r + by + at, x, 212, 54);
                const auto tr = tpl.r + by;
                Hit h;
                h.r = tr;
                h.click = [this, i] {
                    f.pick = i;
                    over.repaint();
                };
                hits.push_back (h);
                if (auto pb = browse::Base::find (tpl.n, ".lb-play"); pb.ok())
                {
                    Hit p;
                    p.r = pb.r + by + at;
                    p.click = [this, i] {
                        f.pick = i;
                        f.play (i);
                    };
                    hits.push_back (p);
                }
            }
        // The sound.
        if (f.pick >= 0 && f.pick < xs.size())
        {
            const auto& x = xs[f.pick];
            write (g, dprompt, words (x), dprompt.r.getWidth());
            write (g, dseed, x["seed"].isVoid() ? juce::String::fromUTF8 ("\xe2\x80\x94") : x["seed"].toString());
            const auto m = x["model"].toString();
            write (g, dmodel, models().count (m) ? models().at (m) : m.isNotEmpty() ? m : juce::String::fromUTF8 ("\xe2\x80\x94"), dmodel.r.getWidth());
            juce::String made = juce::String::fromUTF8 ("\xe2\x80\x94");
            if (x["time"].toString().isNotEmpty())
            {
                const auto t = juce::Time::fromISO8601 (x["time"].toString());
                made = juce::String (t.getDayOfMonth()) + " " + t.getMonthName (true) + ", " + juce::String (t.getHours()).paddedLeft ('0', 2) + ":" + juce::String (t.getMinutes()).paddedLeft ('0', 2);
            }
            write (g, dtime, made);
            write (g, dfile, x["file"].toString().fromLastOccurrenceOf ("/", false, false), dfile.r.getWidth());
            write (g, dlen, secs (x));
            write (g, dnote, acting.isNotEmpty() ? juce::String::fromUTF8 ("copying it from the PC\xe2\x80\xa6") : juce::String::fromUTF8 ("from the PC \xc2\xb7 nothing is copied until you ask"));
            if (dwave.ok())
                wave (g, dwave.r, x, 376, 150);
            if (dplay.ok())
                hits.push_back ({ dplay.r, [this] { f.play (f.pick); } });
            static const char* names[] = { "grain", "chop", "edit", "copy" };
            for (size_t k = 0; k < actButtons.size() && k < 4; ++k)
            {
                const juce::String act = names[k];
                hits.push_back ({ actButtons[k].r, [this, act] { f.use (act); } });
            }
        }
        // The segs and Refresh.
        auto seg = [&] (std::vector<N>& bs, const juce::StringArray& keys, std::function<void (const juce::String&)> go) {
            for (size_t k = 0; k < bs.size() && k < (size_t) keys.size(); ++k)
            {
                const auto key = keys[(int) k];
                hits.push_back ({ bs[k].r, [go, key] { go (key); } });
            }
        };
        seg (segKind, { "", "hit", "loop" }, [this] (const juce::String& k) { f.kind = k; litSegs(); over.repaint(); });
        seg (segOrder, { "prompt", "new" }, [this] (const juce::String& k) { f.order = k; litSegs(); over.repaint(); });
        seg (segLoop, { "once", "loop" }, [this] (const juce::String& k) {
            f.loop = k == "loop";
            juce::DynamicObject::Ptr o = new juce::DynamicObject();
            o->setProperty ("on", f.loop);
            f.module ("loop", juce::var (o.get()));
            litSegs();
        });
        if (refresh.ok())
            hits.push_back ({ refresh.r, [this] { f.load(); } });
    }

    // Each seg drawn lit as the page's lit one, or not.
    void litSegs()
    {
        auto lit = [&] (std::vector<N>& bs, int on) {
            if (bs.size() < 2)
                return;
            // The capture's first is lit (All, By prompt, Once): its look and
            // the second's are the two looks.
            const int litI = (int) bs[0].n["i"], offI = (int) bs[1].n["i"];
            for (int k = 0; k < (int) bs.size(); ++k)
                frame->styleFrom[(int) bs[(size_t) k].n["i"]] = k == on ? litI : offI;
            for (auto& b : bs)
                frame->redraw (b.r - at);
        };
        lit (segKind, f.kind == "hit" ? 1 : f.kind == "loop" ? 2 : 0);
        lit (segOrder, f.order == "new" ? 1 : 0);
        lit (segLoop, f.loop ? 1 : 0);
    }
};

LibraryFace::LibraryFace (Call c, uint32_t i) : browse::Base (std::move (c), i)
{
    setSize (1500, 780);
    d = std::make_unique<Impl> (*this);
    module ("info");
    const auto ui = info["ui"];
    if (ui.isObject())
    {
        kind = ui["kind"].toString();
        if (ui["order"].toString() == "new")
            order = "new";
        group = ui["group"].toString();
        loop = (bool) ui["loop"];
    }
    auto& qf = field ("q", d->q, "Search the words");
    qf.setColour (juce::TextEditor::textColourId, d->c2dColour ("--look-text"));
    qf.onTextChange = [this, &qf] {
        q = qf.getText().trim().toLowerCase();
        d->over.repaint();
    };
    d->litSegs();
    load();
    startTimerHz (30);
}

LibraryFace::~LibraryFace()
{
    stopTimer();
    for (auto& [k, e] : fields)
        e->onTextChange = nullptr;
    d.reset();
}

void LibraryFace::load()
{
    d->busy = true;
    d->err = {};
    d->ask ("GET", "/api/pc/library", {}, [this] (const mgllib::Answer& a) {
        d->busy = false;
        const auto v = a.json();
        if (!a.ok() || !v.isArray())
        {
            d->err = a.json()["error"].toString().isNotEmpty() ? a.json()["error"].toString() : a.text();
            return;
        }
        d->list.clear();
        for (const auto& x : *v.getArray())
            if (x["file"].isString())
                d->list.add (x);
    });
}

void LibraryFace::play (int i)
{
    const auto xs = d->shown();
    if (i < 0 || i >= xs.size())
        return;
    const auto x = xs[i];
    const auto file = x["file"].toString();
    // The same one again stops it (lbPlay).
    if ((bool) info["playing"] && info["heard"]["pc"].toString() == file)
    {
        module ("stop");
        d->over.repaint();
        return;
    }
    auto go = [this, x, file] {
        const auto cached = d->cacheFile (file);
        juce::DynamicObject::Ptr o = new juce::DynamicObject();
        o->setProperty ("file", cached.getFullPathName());
        o->setProperty ("pc", file);
        o->setProperty ("name", file.fromLastOccurrenceOf ("/", false, false));
        juce::DynamicObject::Ptr l = new juce::DynamicObject();
        l->setProperty ("on", loop);
        module ("loop", juce::var (l.get()));
        const auto r = module ("play", juce::var (o.get()));
        if (r.hasProperty ("error"))
            say ("Could not get that sound from the PC");
        d->over.repaint();
    };
    if (d->cacheFile (file).existsAsFile())
        return go();
    d->ask ("GET", "/api/pc/audio?file=" + mgllib::esc (file), {}, [this, file, go] (const mgllib::Answer& a) {
        if (!a.ok())
            return say ("Could not get that sound from the PC");
        d->cacheFile (file).replaceWithData (a.body.getData(), a.body.getSize());
        go();
    });
}

void LibraryFace::use (const juce::String& act)
{
    const auto xs = d->shown();
    if (pick < 0 || pick >= xs.size() || d->acting.isNotEmpty())
        return;
    const auto x = xs[pick];
    d->acting = x["file"].toString();
    juce::DynamicObject::Ptr o = new juce::DynamicObject();
    o->setProperty ("file", x["file"]);
    d->ask ("POST", "/api/pc/fetch", juce::JSON::toString (juce::var (o.get()), true), [this, act] (const mgllib::Answer& a) {
        d->acting = {};
        if (!a.ok())
            return say ("Could not bring it over: " + a.json()["error"].toString());
        const auto p = a.json()["p"].toString();
        if (act == "copy")
            return say ("Copied into your library: " + p);
        if (choose)
            choose (mgllib::fileOf (p).getFullPathName(), p, p.fromLastOccurrenceOf ("/", false, false), act);
    });
}

void LibraryFace::tick()
{
    const bool was = (bool) info["playing"];
    module ("info");
    if (was || (bool) info["playing"])
        d->over.repaint();
}

juce::Rectangle<float> LibraryFace::where (const juce::String& part) const
{
    if (part == "groups")
        return d->groups.r;
    if (part == "tiles")
        return d->tiles.r;
    if (part == "play")
        return d->dplay.r;
    if (part == "refresh")
        return d->refresh.r;
    if (part.startsWith ("kind:") && d->segKind.size() >= 3)
        return d->segKind[(size_t) part.getTrailingIntValue()].r;
    if (part.startsWith ("loop:") && d->segLoop.size() >= 2)
        return d->segLoop[(size_t) part.getTrailingIntValue()].r;
    if (part.startsWith ("act:") && d->actButtons.size() >= 4)
        return d->actButtons[(size_t) part.getTrailingIntValue()].r;
    return {};
}

void LibraryFace::paint (juce::Graphics&) {}

void LibraryFace::mouseDown (const juce::MouseEvent& e)
{
    if (blocked && blocked (e))
        return;
    const Hit* best = nullptr;
    for (const auto& h : d->hits)
        if (h.r.contains (e.position) && (best == nullptr || h.r.getWidth() * h.r.getHeight() < best->r.getWidth() * best->r.getHeight()))
            best = &h;
    if (best != nullptr && best->click)
        best->click();
}

void LibraryFace::mouseWheelMove (const juce::MouseEvent& e, const juce::MouseWheelDetails& w)
{
    if (d->groups.r.contains (e.position))
    {
        d->groupScroll = juce::jmax (0.0f, d->groupScroll - w.deltaY * 300);
        d->over.repaint();
    }
}

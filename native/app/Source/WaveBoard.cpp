// Wave's FX view: the synth's master bus as a patchable board
// (ui/app/395-wave-board.js, 396-wave-board-canvas.js,
// 397-wave-board-inspector.js), line for line. The bar with its count and
// notes; the main path above the canvas (reorder by dragging); the sources
// strip (drag one onto any control); the canvas, a grid you pan and zoom,
// with the board's nodes and cables, patched from an out to an in, moved,
// spliced onto a cable, lifted out, menus on a right-click, Delete; the
// inspector at the right. The board goes to the engine whole on every change
// of structure (`POST /api/wave/board`) and a control moved goes live
// (`/api/wave/board/param`), as the page sends them.
//
// The nodes, the pins and the inspector's parts are the page's own, captured
// with a node of every kind (capture-wave.mjs, parts "world", "worldSel",
// "chain", "insp*", "cmenu*", "note*"), each stamped where the board puts
// it, in its own category's colour.

#include "Host.h"
#include "WaveBoardPics.h"
#include "WaveView.h"

namespace
{
using namespace board;
float num (const juce::var& v, float f = 0) { return v.isVoid() || v.isUndefined() ? f : (float) (double) v; }
float clampf (float v, float a = 0, float b = 1) { return juce::jlimit (a, b, v); }
const juce::String dot = juce::String::fromUTF8 (" \xc2\xb7 "), arrow = juce::String::fromUTF8 ("\xe2\x86\x92");

juce::var arr (std::initializer_list<juce::var> xs)
{
    juce::Array<juce::var> a;
    for (auto& x : xs)
        a.add (x);
    return a;
}

juce::var colourVar (juce::Colour c) { return arr ({ (int) c.getRed(), (int) c.getGreen(), (int) c.getBlue(), (double) c.getFloatAlpha() }); }

// A copy of a node with its first shadow in another colour.
juce::var withShadow (const juce::var& n, int which, juce::Colour c)
{
    auto v = n.clone();
    if (auto* sh = v["shadows"].getArray(); sh != nullptr && which < sh->size())
        if (auto* o = sh->getReference (which).getDynamicObject())
            o->setProperty ("colour", colourVar (c));
    return v;
}

class WaveBoard final : public WaveView, private juce::Timer
{
public:
    WaveBoard (WaveCtx& c, const juce::var& captured) : WaveView (c, captured)
    {
        parts = face::page ("wave-views")["parts"];
        world = parts["world"]["tree"];
        if (auto* w = node ("#wvFwell"))
        {
            well = face::rectOf (*w);
            chrome.skip.insert ((int) (*w)["i"]);
            if (auto* st = face::findNode (*w, "wv-fstat"))
                fstat = *st;
            if (auto* z = face::findNode (*w, "wv-fzoom"))
                fzoom = *z;
            // The well's own fill, under its grid.
            wellNode = w->clone();
            if (auto* o = wellNode.getDynamicObject())
            {
                o->removeProperty ("kids");
                if (auto* ls = o->getProperty ("layers").getArray(); ls != nullptr && !ls->isEmpty())
                    o->setProperty ("layers", arr ({ ls->getLast() }));
            }
        }
        if (auto* f = node ("#wvFchain"))
            chainBox = face::rectOf (*f), chrome.skip.insert ((int) (*f)["i"]);
        if (auto* i = node ("#wvFinsp"))
            inspBox = face::rectOf (*i), chrome.skip.insert ((int) (*i)["i"]);
        for (auto* gx : nodes ("wv-gxc"))
            if (auto* a = face::findNode (*gx, "act"))
                chrome.skip.insert ((int) (*a)["i"]);
        index();
        pics.model = ctx.model;
        pics.cl = ctx.cl;
        boardParamLabelHooks();
        build();
    }

    void shown() override
    {
        ensureKit();
        const auto before = juce::JSON::toString (board, true);
        readBoard();
        if (juce::JSON::toString (board, true) != before || !shownOnce)
            repaintAll();
        shownOnce = true;
    }
    bool shownOnce = false;

    void changed (const juce::String& key) override
    {
        if (key.startsWith ("osc") || key.startsWith ("sub.") || key.startsWith ("noise.") || key.startsWith ("filt0."))
            repaintAll();
    }

    void tick (float t) override
    {
        // While there is sound, the pictures and cables at fifteen a second; else at a few.
        pics.frame (t);
        bool sound = !wave::voices (model()).empty();
        if (auto* b = model().tele["board"].getDynamicObject())
            for (auto& p : b->getProperties())
                sound = sound || (p.value.isArray() && ((float) (double) p.value[0] > 0.001f || (float) (double) p.value[1] > 0.001f));
        ++ticks;
        if ((sound && ticks % 2 == 0) || ticks % 8 == 0)
        {
            again ("live");
            if (sound)
            {
                ++inspFrame;
                again ("insp");
            }
        }
        again ("strip");
    }
    int ticks = 0, inspFrame = 0;
    Cached inspCache;

    std::vector<std::pair<juce::String, double>> profile (float s) override { return timeLayers (s); }

    bool key (const juce::KeyPress& k) override
    {
        if (k == juce::KeyPress::deleteKey || k == juce::KeyPress::backspaceKey)
        {
            removeSelected();
            return true;
        }
        return false;
    }

    bool down (const juce::MouseEvent& e) override;
    void dragged (const juce::MouseEvent& e) override
    {
        if (drag)
            drag (e);
        last = e.position;
    }
    void up (const juce::MouseEvent& e) override
    {
        if (dragEnd)
            dragEnd (e);
        drag = nullptr;
        dragEnd = nullptr;
    }
    bool doubleClick (const juce::MouseEvent& e) override;
    bool wheel (const juce::MouseEvent& e, const juce::MouseWheelDetails& w) override
    {
        if (!well.contains (e.position))
            return false;
        zoomAt (V.z * std::exp (w.deltaY * 1.36f), e.position - well.getPosition());
        return true;
    }
    bool rightClick (const juce::MouseEvent& e) override;

    std::function<void (const juce::String& src, const juce::MouseEvent&)> startMapping;

    // Every knob on the board's nodes, where it is on the page now.
    std::vector<Target> targets() override
    {
        std::vector<Target> out;
        if (auto* ns = board["nodes"].getArray())
            for (auto& n : *ns)
            {
                const auto* t = tplFor (n);
                if (t == nullptr)
                    continue;
                const auto off = nodeRect (n).getPosition() - face::rectOf (*t).getPosition();
                const auto sp = isFx (n) ? facePr (n) : spec (n);
                int k = 0;
                for (auto* cv : face::findAll (*t, "data-fxk"))
                {
                    const auto key = isFx (n) && k < sp.size() ? sp[k]["key"].toString() : (*cv)["data"]["fxk"].toString().fromFirstOccurrenceOf ("|", false, false);
                    ++k;
                    auto r = (face::rectOf (*cv) + off).transformedBy (toPage());
                    if (well.contains (r.getCentre()))
                        out.push_back ({ r, "board:" + n["id"].toString() + ":" + key, true });
                }
            }
        return out;
    }

private:
    juce::var parts, world, wellNode, fstat, fzoom;
    juce::Rectangle<float> well, chainBox, inspBox;
    std::map<juce::String, const juce::var*> tpl;       // node templates by name (their captured ids)
    const juce::var* selTpl = nullptr;                  // a selected node's look
    const juce::var* pinTpl = nullptr;
    juce::var board;                                    // as the engine stores it
    juce::var good;                                     // the last the engine took
    struct ViewState
    {
        float x = 0, y = 0, z = 1;
    } V;
    struct Sel
    {
        juce::String t;    // "node" or "cab"
        juce::String id;
        int i = -1;
    } sel;
    Pics pics;
    juce::String noteText;
    bool noteBad = false;
    double noteAt = 0;
    int insCable = -1;
    juce::Path tmpCable;
    juce::String okPins;   // while dragging a cable: the ins lit
    std::function<void (const juce::MouseEvent&)> drag;
    std::function<void (const juce::MouseEvent&)> dragEnd;
    juce::Point<float> last;
    // The menu at the pointer (wvOpenCmenu): columns of items.
    struct Item
    {
        juce::String l;
        juce::Colour cc;
        bool hasCc = false, dis = false, sep = false;
        juce::String right;
        std::function<std::vector<Item>()> sub;
        std::function<void()> act;
    };
    struct Col
    {
        juce::String title;
        std::vector<Item> items;
        juce::Rectangle<float> r;
        int hover = -1;
    };
    std::vector<Col> menu;

    wave::Model& model() { return *ctx.model; }
    const wave::Cl& cl() const { return *ctx.cl; }

    void index()
    {
        auto byNode = [&] (const juce::var& w, const juce::String& id) -> const juce::var* {
            if (auto* kids = w["kids"].getArray())
                for (auto& k : *kids)
                    if (k["data"]["node"].toString() == id)
                        return &k;
            return nullptr;
        };
        for (auto* id : { "invoice", "inA", "inC", "out", "n1", "n2", "n3", "n4", "n5", "n6", "n7", "n8", "n9", "n10", "n11", "n12", "n13" })
            tpl[id] = byNode (world, id);
        selTpl = byNode (parts["worldSel"]["tree"], "n1");
        if (tpl["inA"] != nullptr)
            pinTpl = face::findNode (*tpl["inA"], "wv-pin");
    }

    void ensureKit()
    {
        auto& k = Kit::get();
        if (k.fx.isArray() || !ctx.api)
            return;
        int st = 0;
        const auto fx = ctx.api ("GET", "/api/wave/fx", {}, st);
        if (st == 200)
            k.setFx (fx);
    }

    void boardParamLabelHooks()
    {
        wave::boardNodeName() = [] (const juce::var& n) { return board::name (n); };
        wave::boardParamLabel() = [] (const juce::var& n, const juce::String& key) {
            juce::Array<juce::var> keep;
            auto* p = paramOf (n, key, &keep);
            return p != nullptr ? (*p)["label"].toString() : key;
        };
    }

    void readBoard()
    {
        if (ctx.api)
        {
            int st = 0;
            const auto b = ctx.api ("GET", "/api/wave/board", {}, st);
            if (st == 200 && b["nodes"].isArray())
                adopt (b);
        }
        else if (model().board.isObject())
            adopt (model().board);
    }

    void adopt (const juce::var& b)
    {
        board = b.clone();
        good = b.clone();
        model().board = board;
        pics.board = &board;
        if (sel.t == "node" && board::node (board, sel.id) == nullptr)
            sel = {};
    }

    // A new structure: the whole board to the engine. Refused, the last good
    // board comes back and the note says why (wvBoardPost).
    bool post (const juce::String& msg = {})
    {
        repaintAll();
        int st = 0;
        const auto r = ctx.api ? ctx.api ("POST", "/api/wave/board", board, st) : juce::var();
        if (!ctx.api || st == 200)
        {
            if (r["nodes"].isArray())
            {
                const auto keep = sel;
                adopt (r);
                sel = keep.t != "node" || board::node (board, keep.id) != nullptr ? keep : Sel {};
            }
            else
                good = board.clone();
            model().board = board;
            if (msg.isNotEmpty())
                note (msg);
            if (ctx.modsChanged)
                ctx.modsChanged();
            repaintAll();
            return true;
        }
        const auto why = r["error"].isString() ? r["error"].toString() : juce::String ("the engine did not answer");
        board = good.clone();
        pics.board = &board;
        sel = {};
        repaintAll();
        note ("Refused: " + why, true);
        return false;
    }

    void param (const juce::String& nid, const juce::String& key, const juce::var& value, bool live)
    {
        auto* n = const_cast<juce::var*> (board::node (board, nid));
        if (n == nullptr)
            return;
        if (key == "on")
            n->getDynamicObject()->setProperty ("on", (bool) value);
        else if (auto* ps = (*n)["params"].getDynamicObject())
            ps->setProperty (key, value);
        auto* body = new juce::DynamicObject();
        body->setProperty ("node", nid);
        body->setProperty ("key", key);
        body->setProperty ("value", key == "on" ? juce::var ((bool) value ? 1 : 0) : value);
        if (live)
            body->setProperty ("live", true);
        int st = 0;
        if (ctx.api)
            ctx.api ("POST", "/api/wave/board/param", juce::var (body), st);
        if (!live && st == 200)
            if (auto* g = const_cast<juce::var*> (board::node (good, nid)))
            {
                if (key == "on")
                    g->getDynamicObject()->setProperty ("on", (bool) value);
                else if (auto* ps = (*g)["params"].getDynamicObject())
                    ps->setProperty (key, value);
            }
        model().board = board;
        // A control moved: only what shows it is drawn again (its node's look stays).
        if (key == "on")
            repaintAll();
        else
        {
            again ("live");
            again ("insp");
        }
    }

    void note (const juce::String& s, bool bad = false)
    {
        noteText = s;
        noteBad = bad;
        noteAt = juce::Time::getMillisecondCounterHiRes();
        startTimer (2900);
        again ("bar");
    }
    void timerCallback() override
    {
        stopTimer();
        noteText.clear();
        again ("bar");
    }

    void repaintAll()
    {
        for (auto& l : layers)
            l->repaint();
        count();
    }

    void count()
    {
        int nodes = 0, mapped = 0;
        if (auto* ns = board["nodes"].getArray())
            for (auto& n : *ns)
                nodes += isIO (n) ? 0 : 1;
        for (auto& r : model().mods)
            mapped += r.dst.startsWith ("board:") ? 1 : 0;
        const int cables = board["cables"].isArray() ? board["cables"].size() : 0;
        say ("wvBcount", juce::String (nodes) + " nodes" + dot + juce::String (cables) + " cables" + dot + juce::String (mapped) + " mapped");
        say ("wvZro", juce::String (juce::roundToInt (V.z * 100)) + " %");
    }

    // ── geometry ─────────────────────────────────────────────────────────

    juce::AffineTransform toPage() const { return juce::AffineTransform::scale (V.z).translated (well.getX() + V.x, well.getY() + V.y); }
    juce::Point<float> toWorld (juce::Point<float> p) const { return { (p.x - well.getX() - V.x) / V.z, (p.y - well.getY() - V.y) / V.z }; }

    void zoomAt (float z, juce::Point<float> c)
    {
        z = clampf (z, 0.4f, 1.6f);
        const float wx = (c.x - V.x) / V.z, wy = (c.y - V.y) / V.z;
        V.z = z;
        V.x = c.x - wx * z;
        V.y = c.y - wy * z;
        repaintAll();
    }

    void fit()
    {
        float x0 = 1e9f, y0 = 1e9f, x1 = -1e9f, y1 = -1e9f;
        if (auto* ns = board["nodes"].getArray())
            for (auto& n : *ns)
            {
                x0 = juce::jmin (x0, num (n["x"]));
                y0 = juce::jmin (y0, num (n["y"]));
                x1 = juce::jmax (x1, num (n["x"]) + nodeW (n));
                y1 = juce::jmax (y1, num (n["y"]) + nodeH (n));
            }
        x0 -= 10;
        x1 += 10;
        const float H0 = well.getHeight() - 30;
        const float z = clampf (juce::jmin ((well.getWidth() - 24) / (x1 - x0), (H0 - 20) / (y1 - y0)), 0.4f, 1.25f);
        V.z = z;
        V.x = (well.getWidth() - (x1 - x0) * z) / 2 - x0 * z;
        V.y = (H0 - (y1 - y0) * z) / 2 - y0 * z;
        repaintAll();
    }

    // A node's template: the captured node of the same kind and shape.
    const juce::var* tplFor (const juce::var& n)
    {
        const auto kind = n["kind"].toString();
        if (kind == "in:voice")
            return tpl["invoice"];
        if (kind.startsWith ("in:"))
            return (n["on"].isBool() && !(bool) n["on"]) || !inputLive (model(), kind) ? tpl["inC"] : tpl["inA"];
        if (kind == "out")
            return tpl["out"];
        if (isFx (n))
        {
            auto& k = Kit::get();
            if (auto it = k.byKind.find (kind); it != k.byKind.end() && it->second["sound"].isObject())
                return tpl["n7"];
            const int fk = facePr (n).size();
            return fk == 0 ? tpl["n13"] : fk == 2 ? tpl["n8"] : fk >= 4 ? tpl["n9"] : tpl["n1"];
        }
        if (kind == "split")
            return portCount (n) >= 3 ? tpl["n10"] : tpl["n2"];
        if (kind == "mix")
            return portCount (n) >= 4 ? tpl["n12"] : portCount (n) == 3 ? tpl["n11"] : tpl["n3"];
        if (kind == "drywet")
            return tpl["n4"];
        if (kind == "pan")
            return tpl["n6"];
        return tpl["n5"];
    }

    juce::Rectangle<float> nodeRect (const juce::var& n) const { return { num (n["x"]), num (n["y"]), nodeW (n), nodeH (n) }; }

    // ── drawing ──────────────────────────────────────────────────────────

    void build()
    {
        addLayer ("world", well, [this] (juce::Graphics& g) {
            g.addTransform (juce::AffineTransform::translation (-well.getX(), -well.getY()));
            drawWell (g, false);
        });
        addLayer ("live", well, [this] (juce::Graphics& g) {
            g.addTransform (juce::AffineTransform::translation (-well.getX(), -well.getY()));
            drawWell (g, true);
        });
        addLayer ("chain", chainBox.expanded (2), [this] (juce::Graphics& g) {
            g.addTransform (juce::AffineTransform::translation (-(chainBox.getX() - 2), -(chainBox.getY() - 2)));
            drawChain (g);
        });
        juce::Rectangle<float> strip;
        for (auto* gx : nodes ("wv-gxc"))
            strip = strip.isEmpty() ? face::rectOf (*gx) : strip.getUnion (face::rectOf (*gx));
        addLayer ("strip", strip.expanded (8), [this, strip] (juce::Graphics& g) {
            g.addTransform (juce::AffineTransform::translation (-(strip.getX() - 8), -(strip.getY() - 8)));
            drawStrip (g);
        });
        addLayer ("insp", inspBox.expanded (4), [this] (juce::Graphics& g) {
            g.addTransform (juce::AffineTransform::translation (-(inspBox.getX() - 4), -(inspBox.getY() - 4)));
            // Kept until what it shows changes; with sound, its picture moves, a few a second.
            const auto* n = sel.t == "node" ? board::node (board, sel.id) : nullptr;
            const auto key = sel.t + sel.id + juce::String (sel.i) + (n != nullptr ? juce::JSON::toString (*n, true) : juce::JSON::toString (board["cables"], true))
                             + juce::JSON::toString (wave::modsOut (model()), true) + juce::String (inspFrame);
            auto savedHots = hots;
            drawCached (g, inspCache, key, inspBox.expanded (4), [this] (juce::Graphics& gg) { drawInspector (gg); });
            if (hots.empty())
                hots = savedHots;
        });
        addTextLayer();
        addLayer ("bar", well, [this] (juce::Graphics& g) {
            g.addTransform (juce::AffineTransform::translation (-well.getX(), -well.getY()));
            drawStat (g);
        });
        addLayer ("menu", getLocalBounds().toFloat(), [this] (juce::Graphics& g) { drawMenu (g); });
        for (auto& l : layers)
            if (l->name == "menu")
                l->setBufferedToImage (false);
    }

    void drawWell (juce::Graphics& g, bool live)
    {
        juce::Graphics::ScopedSaveState keep (g);
        g.reduceClipRegion (face::box (well, wellNode["radius"]).getBounds().getSmallestIntegerContainer());
        if (live)
        {
            g.addTransform (toPage());
            if (auto* ns = board["nodes"].getArray())
                for (auto& n : *ns)
                    drawNode (g, n, true);
            drawCables (g);
            return;
        }
        // Its fill and the grid: lines every 16 board pixels, stronger every 64, moving with the view.
        face::paintBox (g, wellNode, well);
        auto lines = [&] (float step, float a) {
            g.setColour (juce::Colours::white.withAlpha (a));
            const float s = step * V.z;
            float x0 = std::fmod (V.x, s);
            if (x0 < 0)
                x0 += s;
            for (float x = well.getX() + x0; x < well.getRight(); x += s)
                g.fillRect (x, well.getY(), 1.0f, well.getHeight());
            float y0 = std::fmod (V.y, s);
            if (y0 < 0)
                y0 += s;
            for (float y = well.getY() + y0; y < well.getBottom(); y += s)
                g.fillRect (well.getX(), y, well.getWidth(), 1.0f);
        };
        lines (16, 0.03f);
        lines (64, 0.055f);
        g.addTransform (toPage());
        // The SENDS caption.
        if (auto* kids = world["kids"].getArray())
            for (auto& k : *kids)
                if (face::matches (k, "wv-wcap"))
                    face::Stamp().draw (g, k);
        // The nodes, each kept as a picture until it changes (what moves on
        // them and the cables come over them, live).
        if (auto* ns = board["nodes"].getArray())
            for (auto& n : *ns)
            {
                const auto id = n["id"].toString();
                const auto key = juce::JSON::toString (n, true) + (sel.t == "node" && sel.id == id ? "|sel" : "") + (inputLive (model(), n["kind"].toString()) ? "|live" : "")
                                 + juce::String ((int) Kit::get().byKind.size());
                drawCached (g, nodeCache[id], key, nodeRect (n).expanded (28), [this, &n] (juce::Graphics& gg) { drawNode (gg, n, false); });
            }
    }
    std::map<juce::String, Cached> nodeCache;

    void drawStat (juce::Graphics& g)
    {
        if (fzoom.isObject())
        {
            face::Stamp s;
            s.text = [this] (const juce::var& n, juce::String& out) {
                if (n["id"].toString() != "wvZro")
                    return false;
                out = juce::String (juce::roundToInt (V.z * 100)) + " %";
                return true;
            };
            s.draw (g, fzoom);
        }
        if (!fstat.isObject())
            return;
        if (noteText.isEmpty())
        {
            face::Stamp().draw (g, fstat);
            return;
        }
        // A note in place of the hint, for a moment.
        const auto& part = parts[noteBad ? "noteBad" : "note"];
        face::Stamp s;
        s.text = [this] (const juce::var& n, juce::String& out) {
            if (n["id"].toString() != "wvFnote")
                return false;
            out = noteText;
            return true;
        };
        const juce::Point<float> at ((float) (double) part["root"][0], (float) (double) part["root"][1]);
        s.draw (g, part["tree"], at);
    }

    void drawNode (juce::Graphics& g, const juce::var& n, bool live)
    {
        const auto* t = tplFor (n);
        if (t == nullptr)
            return;
        const auto tr = face::rectOf (*t), r = nodeRect (n);
        const auto off = r.getPosition() - tr.getPosition();
        const bool fx = isFx (n), off_ = n["on"].isBool() && !(bool) n["on"];
        const bool tplOff = t == tpl["n8"];
        const auto cc = nodeCol (n, cl());
        const auto sp = facePr (n);
        const float cw = 136.0f / (float) juce::jmax (1, sp.size()) - 5;
        const bool isSel = sel.t == "node" && sel.id == n["id"].toString();
        int knob = 0, val = 0, lab = 0;
        face::Stamp s;
        s.shallowLook = true;
        // Its power lit or not as it is: the look of a captured node's that is so.
        const auto* pwHere = face::findNode (*t, "wv-pw");
        const auto* pwWant = tpl["n8"] != nullptr && tpl["n1"] != nullptr ? face::findNode (*(off_ ? tpl["n8"] : tpl["n1"]), "wv-pw") : nullptr;
        s.look = [&] (const juce::var& k) -> const juce::var* {
            if (isSel && &k == t && selTpl != nullptr)
                return selTpl;
            if (pwHere != nullptr && pwWant != nullptr && fx)
            {
                if (&k == pwHere)
                    return pwWant;
                if (auto* a = face::findNode (*pwHere, "svg"); a == &k)
                    return face::findNode (*pwWant, "svg");
            }
            return nullptr;
        };
        s.fill = [&] (const juce::var& k, juce::Colour& c) {
            // ::before and the input's dot: the node's own colour.
            if (k["data"]["pseudo"].toString() == "::before" || (k["tag"].toString() == "i" && !face::matches (k, "wv-pin") && n["kind"].toString().startsWith ("in:") && !face::matches (k, "act")))
            {
                c = k["data"]["pseudo"].isString() ? cc : (tpl["inC"] == t ? face::colour (k["bg"]) : cc);
                return true;
            }
            return false;
        };
        s.ink = [&] (const juce::var& k, juce::Colour& c) {
            if (face::matches (k, "fhn") || (k["tag"].toString() == "span" && fx && face::rectOf (k).getHeight() < 12.5f && face::rectOf (k).getY() - face::rectOf (*t).getY() < 30 && !face::matches (k, "wv-fsnd")))
            {
                // The maker line: the category's colour three quarters in.
                c = cc.interpolatedWith (cl().t3, 0.25f);
                return true;
            }
            if (k["tag"].toString() == "b" && fx && face::rectOf (k).getY() - face::rectOf (*t).getY() < 20)
            {
                c = off_ ? cl().t3 : cl().t;
                return true;
            }
            return false;
        };
        s.alpha = [&] (const juce::var& k) {
            // .wv-fn.off > :not(.wv-pin):not(.fh) at .4 (a captured off node is already).
            if (!fx || face::matches (k, "wv-pin") || face::matches (k, "fh") || &k == t)
                return 1.0f;
            const bool direct = [&] { if (auto* kids = (*t)["kids"].getArray()) for (auto& x : *kids) if (&x == &k) return true; return false; }();
            if (!direct)
                return 1.0f;
            if (tplOff && !off_)
                return 2.5f;
            if (!tplOff && off_)
                return 0.4f;
            return 1.0f;
        };
        s.skip = [&] (const juce::var& k) { return face::matches (k, "wv-pin"); };
        s.text = [&] (const juce::var& k, juce::String& out) {
            const auto tag = k["tag"].toString();
            if (n["kind"].toString().startsWith ("in:") || n["kind"].toString() == "out")
            {
                if (tag == "b")
                    return (out = name (n)), true;
                if (face::matches (k, "wv-ro"))
                {
                    const bool main = n["kind"].toString() == "in:voice";
                    out = n["kind"].toString() == "out" ? juce::String ("master") : main ? juce::String ("main") : (!off_ && inputLive (model(), n["kind"].toString())) ? juce::String ("send") : juce::String ("off");
                    return true;
                }
                return false;
            }
            if (tag == "b" && face::rectOf (k).getY() - face::rectOf (*t).getY() < 20)
                return (out = name (n)), true;
            if (tag == "span" && face::rectOf (k).getY() - face::rectOf (*t).getY() < 30 && face::rectOf (k).getHeight() < 12.5f && !face::matches (k, "wv-fsnd") && !face::matches (k, "wv-pw"))
                return (out = fx ? catName (cat (n)) + dot + maker (n) : juce::String ("ROUTING")), true;
            if (face::matches (k, "kl") && lab < sp.size())
                return (out = fitLab (sp[lab++]["label"].toString(), cw, face::font (k["text"][0]["font"]))), true;
            if (tag == "b" && k["data"]["nv"].isString())
            {
                if (fx && val < sp.size())
                {
                    const auto& p = sp[val++];
                    return (out = fmtP (p, pval (n, p), true)), true;
                }
                // A routing node's reading: its control's.
                juce::Array<juce::var> keep;
                if (auto* p = paramOf (n, k["data"]["nv"].toString(), &keep))
                    return (out = fmtP (*p, pval (n, *p), true)), true;
            }
            if (face::matches (k, "wv-fsnd"))
                return (out = soundLabel (n)), true;
            return false;
        };
        auto canvas = [&] (juce::Graphics& gg, const juce::var& k, juce::Rectangle<float> cr) {
            if (k["tag"].toString() != "canvas")
                return;
            juce::Graphics::ScopedSaveState keep (gg);
            gg.addTransform (juce::AffineTransform::translation (cr.getX(), cr.getY()));
            gg.reduceClipRegion (juce::Rectangle<float> (cr.getWidth(), cr.getHeight()).getSmallestIntegerContainer());
            c2d::Context c (gg, cr.getWidth(), cr.getHeight());
            if (k["data"]["np"].isString())
                drawNodePic (c, cr.getWidth(), cr.getHeight(), pics, n);
            else if (k["data"]["fxk"].isString())
            {
                const auto pkey = k["data"]["fxk"].toString().fromFirstOccurrenceOf ("|", false, false);
                const juce::var* p = nullptr;
                juce::Array<juce::var> keep2;
                if (fx && knob < sp.size())
                    p = &sp.getReference (knob++);
                else
                    p = paramOf (n, pkey, &keep2);
                if (p != nullptr)
                    drawBoardKnob (c, cr.getWidth(), pics, n, *p);
            }
        };
        if (!live)
        {
            // The node itself, kept: its frame, words and switches.
            s.draw (g, *t, off);
            return;
        }
        // What moves: its picture and its knobs (faint with the rest of a bypassed node), its ports.
        {
            juce::Graphics::ScopedSaveState keep (g);
            const bool faint = fx && off_;
            if (faint)
                g.beginTransparencyLayer (0.4f);
            for (auto* cv : face::findAll (*t, "canvas"))
                canvas (g, *cv, face::rectOf (*cv) + off);
            if (faint)
                g.endTransparencyLayer();
        }
        for (const auto& p : inPorts (n))
            drawPin (g, n, p, false);
        for (const auto& p : outPorts (n))
            drawPin (g, n, p, true);
    }

    juce::String soundLabel (const juce::var& n)
    {
        auto& k = Kit::get();
        auto it = k.byKind.find (n["kind"].toString());
        const auto snd = it != k.byKind.end() ? it->second["sound"] : juce::var();
        const auto label = snd["label"].toString().toLowerCase();
        const auto path = n["sound"].toString();
        if (path.isNotEmpty())
            return n["soundState"].toString() == "unreadable" ? juce::String ("Unreadable") : path.fromLastOccurrenceOf ("/", false, false);
        return "No " + label;
    }

    void drawPin (juce::Graphics& g, const juce::var& n, const juce::String& port, bool out)
    {
        if (pinTpl == nullptr)
            return;
        const auto at = pinXY (n, port, out);
        const auto r = juce::Rectangle<float> (14, 10).withCentre ({ out ? at.x + 1 : at.x - 1, at.y });
        Origins s;
        int k = 0;
        if (out)
            s = origins (board, model(), n["id"].toString(), port, pics.memo);
        else if (auto* cs = board["cables"].getArray())
            for (auto& c : *cs)
                if (c["to"][0].toString() == n["id"].toString() && c["to"][1].toString() == port)
                {
                    ++k;
                    for (auto& x : origins (board, model(), c["from"][0].toString(), c["from"][1].toString(), pics.memo))
                        s.insert (x);
                }
        bool any = false;
        auto pc = originCol (s, any);
        if (!any)
            pc = out || k > 0 ? cl().t3 : c2d::css ("#4a4f57");
        auto box = pinTpl->clone();
        if (auto* o = box.getDynamicObject())
            o->removeProperty ("layers");
        face::paintBox (g, box, r);
        if (okPins.isNotEmpty() && !out)
        {
            g.setColour (cl().acc);
            g.drawRoundedRectangle (r.expanded (0.75f), 5.75f, 1.5f);
        }
        else if (k > 1)
        {
            g.setColour (pc.withAlpha (0.25f));
            g.drawRoundedRectangle (r.expanded (2), 7, 2);
            g.setColour (pc);
            g.drawRoundedRectangle (r.expanded (0.5f), 5.5f, 1);
        }
        g.setColour (pc);
        g.fillEllipse (r.getX() + r.getWidth() * 0.32f - 1.6f, r.getCentreY() - 1.6f, 3.2f, 3.2f);
        g.fillEllipse (r.getX() + r.getWidth() * 0.68f - 1.6f, r.getCentreY() - 1.6f, 3.2f, 3.2f);
    }

    void drawCables (juce::Graphics& g)
    {
        auto* cs = board["cables"].getArray();
        if (cs == nullptr)
            return;
        const bool live = !wave::voices (model()).empty();
        const float off = -std::fmod (pics.t * 46, 44.0f);
        for (int i = 0; i < cs->size(); ++i)
        {
            const auto& c = cs->getReference (i);
            const auto* A = board::node (board, c["from"][0].toString());
            const auto* B = board::node (board, c["to"][0].toString());
            if (A == nullptr || B == nullptr)
                continue;
            const auto p1 = pinXY (*A, c["from"][1].toString(), true), p2 = pinXY (*B, c["to"][1].toString(), false);
            juce::Path path;
            cabPath (p1.x, p1.y, p2.x, p2.y, path);
            bool any = false;
            const auto col = originCol (origins (board, model(), c["from"][0].toString(), c["from"][1].toString(), pics.memo), any);
            const float pk = pics.peak (c["from"][0].toString());
            const bool isSel = sel.t == "cab" && sel.i == i;
            if (isSel)
            {
                g.setColour (cl().t.withAlpha (0.22f));
                g.strokePath (path, juce::PathStrokeType (6, juce::PathStrokeType::curved, juce::PathStrokeType::rounded));
            }
            if (insCable == i)
            {
                g.setColour (cl().acc);
                g.strokePath (path, juce::PathStrokeType (4, juce::PathStrokeType::curved, juce::PathStrokeType::rounded));
                continue;
            }
            const float bw = isSel ? 3.4f : 2.2f;
            if (any)
            {
                g.setColour (col.withAlpha (0.45f + 0.4f * clampf (pk * 2)));
                g.strokePath (path, juce::PathStrokeType (bw, juce::PathStrokeType::curved, juce::PathStrokeType::rounded));
                // The glint running along it.
                juce::Path dashed;
                const float dash[] = { 3, 41 };
                juce::PathStrokeType (2.6f, juce::PathStrokeType::curved, juce::PathStrokeType::rounded).createDashedStroke (dashed, shifted (path, -off), dash, 2);
                g.setColour (col.withAlpha (pk > 0.001f || live ? 1.0f : 0.4f));
                g.fillPath (dashed);
            }
            else
            {
                juce::Path dashed;
                const float dash[] = { 3, 4 };
                juce::PathStrokeType (bw, juce::PathStrokeType::curved, juce::PathStrokeType::rounded).createDashedStroke (dashed, path, dash, 2);
                g.setColour (cl().t3.withAlpha (0.5f * 0.45f / 0.5f));
                g.fillPath (dashed);
            }
        }
        if (!tmpCable.isEmpty())
        {
            juce::Path dashed;
            const float dash[] = { 5, 4 };
            juce::PathStrokeType (2).createDashedStroke (dashed, tmpCable, dash, 2);
            g.setColour (cl().acc);
            g.fillPath (dashed);
        }
    }

    // A path started `d` along itself (the dash offset), by trimming its start.
    static juce::Path shifted (const juce::Path& p, float d)
    {
        if (d <= 0.01f)
            return p;
        juce::Path out;
        juce::PathFlatteningIterator it (p);
        float run = 0;
        bool started = false;
        while (it.next())
        {
            const juce::Point<float> a (it.x1, it.y1), b (it.x2, it.y2);
            const float seg = a.getDistanceFrom (b);
            if (!started)
            {
                if (run + seg >= d)
                {
                    const auto s = a + (b - a) * ((d - run) / juce::jmax (1e-4f, seg));
                    out.startNewSubPath (s);
                    out.lineTo (b);
                    started = true;
                }
                run += seg;
                continue;
            }
            out.lineTo (b);
        }
        return out;
    }

    void drawStrip (juce::Graphics& g)
    {
        for (auto* gx : nodes ("wv-gxc"))
        {
            const auto src = (*gx)["data"]["src"].toString();
            if (auto* cv = face::findNode (*gx, "canvas"))
            {
                const auto cr = face::rectOf (*cv);
                juce::Graphics::ScopedSaveState keep (g);
                g.addTransform (juce::AffineTransform::translation (cr.getX(), cr.getY()));
                c2d::Context c (g, cr.getWidth(), cr.getHeight());
                wave::drawTilePic (c, cr.getWidth(), cr.getHeight(), cl(), model(), src);
            }
            bool used = false;
            for (auto& m : model().mods)
                used = used || (m.src == src && m.dst.startsWith ("board:") && !m.off);
            if (used)
                if (auto* a = face::findNode (*gx, "act"))
                {
                    const float o = 0.25f + 0.75f * std::abs (wave::srcVal (model(), src));
                    const auto col = c2d::css (wave::sourceColour (src));
                    juce::Path p;
                    p.addEllipse (face::rectOf (*a));
                    g.beginTransparencyLayer (o);
                    juce::DropShadow (col, 6, {}).drawForPath (g, p);
                    g.setColour (col);
                    g.fillPath (p);
                    g.endTransparencyLayer();
                }
        }
    }

    // ── the main path ────────────────────────────────────────────────────

    struct Chip
    {
        juce::String id;
        juce::Rectangle<float> r;
    };
    std::vector<Chip> chips;
    int dragChip = -1, dropAt = -1;
    float dragX = 0;

    void layoutChain()
    {
        chips.clear();
        const auto& tree = parts["chain"]["tree"];
        const juce::Point<float> at ((float) (double) parts["chain"]["root"][0], (float) (double) parts["chain"]["root"][1]);
        const auto* chi = face::findNode (tree, "chi");
        if (chi == nullptr)
            return;
        bool ok = false;
        const auto st = mainPath (board, ok);
        const auto f = face::font ((*chi)["text"][0]["font"]);
        // Where the captured strip had its first chip: after Voice and its arrow.
        float x = face::rectOf (*chi).getX() + at.x;
        const auto* cha = face::findNode (tree, "cha");
        const float arrowW = cha != nullptr ? face::rectOf (*cha).getWidth() : 8;
        for (size_t i = 1; i + (ok ? 1 : 0) < st.size(); ++i)
        {
            const auto* n = board::node (board, st[i].id);
            if (n == nullptr)
                continue;
            const float w = juce::GlyphArrangement::getStringWidth (f, name (*n)) + 16;
            chips.push_back ({ st[i].id, { x, face::rectOf (*chi).getY() + at.y, w, face::rectOf (*chi).getHeight() } });
            x += w + 4 + arrowW + 4;
        }
    }

    void drawChain (juce::Graphics& g)
    {
        layoutChain();
        const auto& tree = parts["chain"]["tree"];
        const juce::Point<float> at ((float) (double) parts["chain"]["root"][0], (float) (double) parts["chain"]["root"][1]);
        const auto* chi = face::findNode (tree, "chi");
        const auto* cha = face::findNode (tree, "cha");
        const auto ch0s = face::findAll (tree, "ch0");
        bool ok = false;
        mainPath (board, ok);
        // MAIN PATH, Voice and its arrow where the page has them.
        if (auto* sl = face::findNode (tree, "sl"))
            face::Stamp().draw (g, *sl, at);
        if (!ch0s.isEmpty())
            face::Stamp().draw (g, *ch0s[0], at);
        auto arrowAt = [&] (float ax) {
            if (cha != nullptr)
                face::Stamp().draw (g, *cha, juce::Point<float> (ax - face::rectOf (*cha).getX(), at.y));
        };
        const float gap = 4, arrowW = cha != nullptr ? face::rectOf (*cha).getWidth() : 8;
        float x = !ch0s.isEmpty() ? face::rectOf (*ch0s[0]).getRight() + at.x + gap : at.x + 90;
        arrowAt (x);
        x += arrowW + gap;
        for (size_t i = 0; i < chips.size(); ++i)
        {
            const auto* n = board::node (board, chips[i].id);
            if (n == nullptr || chi == nullptr)
                continue;
            auto r = chips[i].r.withX (x);
            chips[i].r = r;
            const bool lifted = (int) i == dragChip;
            juce::Graphics::ScopedSaveState keep (g);
            if (lifted)
                g.beginTransparencyLayer (0.35f);
            face::paintBox (g, withShadow (*chi, 0, nodeCol (*n, cl()).withMultipliedAlpha (0.75f)), r);
            const bool isSel = sel.t == "node" && sel.id == chips[i].id;
            auto f = face::font ((*chi)["text"][0]["font"]);
            g.setFont (f);
            g.setColour (isSel ? cl().t : face::colour ((*chi)["text"][0]["font"]["colour"]));
            juce::GlyphArrangement ga;
            ga.addLineOfText (f, name (*n), r.getX() + 8, r.getCentreY() + (f.getAscent() - f.getDescent()) / 2);
            ga.draw (g);
            if (lifted)
                g.endTransparencyLayer();
            if ((int) i == dropAt)
            {
                g.setColour (cl().acc);
                g.fillRect (r.getX() - 4, r.getY(), 2.0f, r.getHeight());
            }
            x = r.getRight() + gap;
            arrowAt (x);
            x += arrowW + gap;
        }
        if (dropAt == (int) chips.size() && !chips.empty())
        {
            g.setColour (cl().acc);
            g.fillRect (chips.back().r.getRight() + 2, chips.back().r.getY(), 2.0f, chips.back().r.getHeight());
        }
        // Out, or "not reaching Out yet".
        if (ok && ch0s.size() > 1)
            face::Stamp().draw (g, *ch0s[1], juce::Point<float> (x - face::rectOf (*ch0s[1]).getX(), at.y));
        else if (!ok)
        {
            g.setColour (cl().t3);
            g.setFont (face::sans (10));
            g.drawText ("not reaching Out yet", juce::Rectangle<float> (x, chainBox.getY(), 200, chainBox.getHeight()), juce::Justification::centredLeft);
        }
        if (auto* hint = face::findNode (tree, "#wvChint"))
            face::Stamp().draw (g, *hint, at);
    }

    // ── the inspector ────────────────────────────────────────────────────

    struct Hot
    {
        juce::Rectangle<float> r;
        std::function<void (const juce::MouseEvent&)> down;
    };
    std::vector<Hot> hots;    // the inspector's live controls, laid out as drawn

    static bool parentIsSub (const juce::var& tree, const juce::var& k)
    {
        if (auto* sub = face::findNode (tree, "sub"))
            if (auto* kids = (*sub)["kids"].getArray())
                for (auto& x : *kids)
                    if (&x == &k)
                        return true;
        return false;
    }

    const juce::var& inspPart()
    {
        const auto* n = sel.t == "node" ? board::node (board, sel.id) : nullptr;
        if (sel.t == "cab")
            return parts["inspCable"];
        if (n == nullptr)
            return parts["inspBoard"];
        const auto kind = (*n)["kind"].toString();
        if (kind == "in:voice")
            return parts["inspIn"];
        if (kind.startsWith ("in:"))
            return parts["inspSend"];
        if (kind == "out")
            return parts["inspOut"];
        if (kind == "split")
            return parts["inspSplit"];
        if (kind == "mix")
            return parts["inspMix"];
        if (kind == "drywet")
            return parts["inspDrywet"];
        if (kind == "gain" || kind == "pan")
            return parts["inspGain"];
        return (*n)["on"].isBool() && !(bool) (*n)["on"] ? parts["inspFxOff"] : parts["inspFx"];
    }

    void drawInspector (juce::Graphics& g)
    {
        hots.clear();
        const auto& part = inspPart();
        const auto& tree = part["tree"];
        const juce::Point<float> at ((float) (double) part["root"][0], (float) (double) part["root"][1]);
        const auto* n = sel.t == "node" ? board::node (board, sel.id) : nullptr;
        const juce::var* cab = sel.t == "cab" && board["cables"].isArray() && sel.i < board["cables"].size() ? &board["cables"].getArray()->getReference (sel.i) : nullptr;
        const auto cc = n != nullptr ? nodeCol (*n, cl()) : cl().acc;
        const bool fx = n != nullptr && isFx (*n);
        // The frame of it, its header and foot, as captured; what changes is written over.
        face::Stamp s;
        s.skip = [&] (const juce::var& k) { return face::matches (k, "iscroll"); };
        s.fill = [&] (const juce::var& k, juce::Colour& c) { if (!face::matches (k, "ce")) return false; c = cc; return true; };
        s.text = [&] (const juce::var& k, juce::String& out) {
            if (face::matches (k, "wv-nm"))
            {
                out = n != nullptr ? (n->operator[] ("kind").toString() == "out" ? juce::String ("OUT") : name (*n).toUpperCase()) : cab != nullptr ? juce::String ("CABLE") : juce::String ("MASTER BUS");
                return true;
            }
            if (face::matches (k, "sub"))
            {
                if (n != nullptr)
                    out = fx ? cat (*n).toUpperCase() + dot + maker (*n) : (*n)["kind"].toString().startsWith ("in:") ? juce::String ("INPUT") : (*n)["kind"].toString() == "out" ? juce::String ("OUTPUT") : juce::String ("ROUTING");
                else if (cab != nullptr)
                    out = "PATCH";
                else
                    out = board["name"].toString().toUpperCase();
                return true;
            }
            if (face::matches (k, "wv-hint") && parentIsSub (tree, k))
            {
                // wvInspHead's right: what it is, in a word.
                if (n == nullptr && cab == nullptr)
                {
                    int ns = 0;
                    if (auto* a = board["nodes"].getArray())
                        for (auto& x : *a)
                            ns += isIO (x) ? 0 : 1;
                    out = juce::String (ns) + " nodes" + dot + juce::String (board["cables"].size()) + " cables";
                }
                else if (cab != nullptr)
                    out = origins (board, model(), (*cab)["from"][0].toString(), (*cab)["from"][1].toString(), pics.memo).empty() ? "silent" : "carries sound";
                else if ((*n)["kind"].toString() == "out")
                    out = "to the master";
                else if ((*n)["kind"].toString().startsWith ("in:"))
                    out = !((*n)["on"].isBool() && !(bool) (*n)["on"]) && inputLive (model(), (*n)["kind"].toString()) ? "stereo" : "off";
                else if (fx)
                {
                    const int c = spec (*n).size();
                    out = juce::String (c) + " control" + (c == 1 ? "" : "s");
                }
                else
                {
                    const auto tip = Kit::get().data["routing"][juce::Identifier ((*n)["kind"].toString())]["tip"].toString();
                    out = tip.fromFirstOccurrenceOf (": ", false, false).upToFirstOccurrenceOf (".", false, false);
                }
                return true;
            }
            return false;
        };
        s.ink = [&] (const juce::var& k, juce::Colour& c) { if (!face::matches (k, "sub")) return false; c = cc.interpolatedWith (cl().t3, 0.25f); return true; };
        s.after = [&] (juce::Graphics& gg, const juce::var& k, juce::Rectangle<float> cr) {
            if (k["tag"].toString() != "canvas" || n == nullptr)
                return;
            juce::Graphics::ScopedSaveState keep (gg);
            gg.addTransform (juce::AffineTransform::translation (cr.getX(), cr.getY()));
            gg.reduceClipRegion (juce::Rectangle<float> (cr.getWidth(), cr.getHeight()).getSmallestIntegerContainer());
            c2d::Context c (gg, cr.getWidth(), cr.getHeight());
            drawNodePic (c, cr.getWidth(), cr.getHeight(), pics, *n);
        };
        s.draw (g, tree, at);
        // Its power and foot.
        if (n != nullptr)
            if (auto* pw = face::findNode (tree, "data-ipw"))
                hots.push_back ({ face::rectOf (*pw) + at, [this, id = (*n)["id"].toString()] (const juce::MouseEvent&) {
                    const auto* nn = board::node (board, id);
                    param (id, "on", nn != nullptr && (*nn)["on"].isBool() && !(bool) (*nn)["on"], false);
                } });
        if (auto* del = face::findNode (tree, "data-idel"))
            hots.push_back ({ face::rectOf (*del) + at, [this] (const juce::MouseEvent&) { removeSelected(); } });
        if (auto* del = face::findNode (tree, "data-cdel"))
            hots.push_back ({ face::rectOf (*del) + at, [this] (const juce::MouseEvent&) { removeSelected(); } });
        if (n != nullptr)
            if (auto* rst = face::findNode (tree, "data-irst"))
                hots.push_back ({ face::rectOf (*rst) + at, [this, id = (*n)["id"].toString()] (const juce::MouseEvent&) {
                    auto* nn = const_cast<juce::var*> (board::node (board, id));
                    if (nn == nullptr)
                        return;
                    for (auto& p : spec (*nn))
                        (*nn)["params"].getDynamicObject()->setProperty (p["key"].toString(), p["default"]);
                    post (name (*nn) + ": every control back to its default");
                } });
        // What scrolls: drawn from the page's markup for this selection.
        const auto* sc = face::findNode (tree, "iscroll");
        if (sc == nullptr)
            return;
        const auto box = face::rectOf (*sc) + at;
        juce::Graphics::ScopedSaveState keep (g);
        g.reduceClipRegion (box.getSmallestIntegerContainer());
        float y = box.getY();
        const auto* igh = face::findNode (*sc, "igh");
        const auto* hint = face::findNode (*sc, "wv-hint");
        auto heading = [&] (const juce::String& text) {
            if (igh == nullptr)
                return;
            face::Stamp hs;
            hs.text = [&] (const juce::var& k, juce::String& out) { if (&k != igh) return false; out = text; return true; };
            // ::after's line runs to the end, after the words.
            const auto f = face::font ((*igh)["text"][0]["font"]);
            hs.skip = [&] (const juce::var& k) { return k["data"]["pseudo"].isString(); };
            hs.draw (g, *igh, juce::Point<float> (box.getX(), y) - face::rectOf (*igh).getPosition());
            const float tw = juce::GlyphArrangement::getStringWidth (f, text) + 6;
            g.setColour (cl().track);
            g.fillRect (box.getX() + tw, y + 6.5f, box.getWidth() - 6 - tw, 1.0f);
            y += 17;
        };
        auto hintLine = [&] (const juce::String& text) {
            g.setColour (cl().t3);
            g.setFont (face::sans (10));
            juce::AttributedString as;
            as.append (text, face::sans (10), cl().t3);
            as.setWordWrap (juce::AttributedString::byWord);
            juce::TextLayout tl;
            tl.createLayout (as, box.getWidth() - 6);
            tl.draw (g, { box.getX(), y, box.getWidth() - 6, tl.getHeight() });
            y += tl.getHeight() + 6;
            juce::ignoreUnused (hint);
        };
        auto row = [&] (const juce::var& rn, const juce::String& right) {
            const float h = 20;
            g.setColour (nodeCol (rn, cl()));
            g.fillRoundedRectangle (box.getX() + 4, y + 4, 3, 12, 1.5f);
            g.setColour (cl().t2);
            g.setFont (face::sans (11, 500));
            g.drawText (name (rn), juce::Rectangle<float> (box.getX() + 13, y, box.getWidth() - 80, h), juce::Justification::centredLeft);
            g.setColour (cl().t3);
            g.drawText (right, juce::Rectangle<float> (box.getRight() - 120, y, 112, h), juce::Justification::centredRight);
            hots.push_back ({ { box.getX(), y, box.getWidth(), h }, [this, id = rn["id"].toString()] (const juce::MouseEvent&) { select ({ "node", id, -1 }); } });
            y += h + 2;
        };
        auto mods = [&] (const std::function<bool (const wave::Model::Mod&)>& pick, bool showNode) {
            heading ("MAPPED SOURCES");
            int count = 0;
            for (int i = 0; i < (int) model().mods.size(); ++i)
            {
                const auto& m = model().mods[(size_t) i];
                if (!pick (m))
                    continue;
                ++count;
                const auto col = c2d::css (wave::sourceColour (m.src));
                // The badge, the control, the amount and its bar, ×.
                juce::Rectangle<float> r (box.getX(), y, box.getWidth() - 6, 22);
                g.setColour (col.withAlpha (0.14f));
                g.fillRoundedRectangle (r.withWidth (58).reduced (0, 2), 9);
                g.setColour (col);
                g.setFont (face::mono (9, 600));
                g.drawText (wave::srcLab (m.src), r.withWidth (58).withTrimmedLeft (6), juce::Justification::centredLeft);
                g.setColour (cl().t2);
                g.setFont (face::sans (11, 500));
                g.drawText (showNode ? wave::boardDstName (model(), m.dst) : wave::boardDstName (model(), m.dst, true), r.withTrimmedLeft (63).withTrimmedRight (showNode ? 52 : 100), juce::Justification::centredLeft);
                if (!showNode)
                {
                    const auto ma = juce::Rectangle<float> (r.getRight() - 100, r.getY() + 5, 46, 12);
                    g.setColour (juce::Colours::black.withAlpha (0.4f));
                    g.fillRoundedRectangle (ma, 3);
                    const float a = m.amt;
                    const auto bar = juce::Rectangle<float> (ma.getCentreX() + juce::jmin (0.0f, a) * ma.getWidth() / 2, ma.getY() + 3, std::abs (a) * ma.getWidth() / 2, 6);
                    g.setColour (col);
                    g.fillRoundedRectangle (bar, 2);
                    g.setColour (juce::Colours::white.withAlpha (0.18f));
                    g.fillRect (ma.getCentreX(), ma.getY() + 2, 1.0f, ma.getHeight() - 4);
                    hots.push_back ({ ma, [this, i] (const juce::MouseEvent&) {
                        drag = [this, i] (const juce::MouseEvent& ev) {
                            const auto d = ev.position - last;
                            auto& mm = model().mods[(size_t) i];
                            mm.amt = clampf (mm.amt + (d.x - d.y) / 150, -1, 1);
                            again ("insp");
                        };
                        dragEnd = [this] (const juce::MouseEvent&) { if (ctx.modsChanged) ctx.modsChanged(); };
                    } });
                }
                g.setColour (col);
                g.setFont (face::mono (10));
                g.drawText (wave::amtTxt (m.amt), juce::Rectangle<float> (r.getRight() - 50, r.getY(), 30, 22), juce::Justification::centredRight);
                const auto x = juce::Rectangle<float> (r.getRight() - 14, r.getY() + 4, 14, 14);
                g.setColour (cl().t3);
                g.drawLine (x.getX() + 3, x.getY() + 3, x.getRight() - 3, x.getBottom() - 3, 1.2f);
                g.drawLine (x.getRight() - 3, x.getY() + 3, x.getX() + 3, x.getBottom() - 3, 1.2f);
                hots.push_back ({ x, [this, i] (const juce::MouseEvent&) {
                    model().mods.erase (model().mods.begin() + i);
                    if (ctx.modsChanged)
                        ctx.modsChanged();
                    repaintAll();
                } });
                y += 24;
            }
            if (count == 0)
                hintLine (showNode ? "None yet" : "None yet: drag a source from the strip onto any control, here or on the node");
        };
        // A control: a knob with its name and value, a switch, or a choice.
        const auto* icKnob = [&] () -> const juce::var* {
            for (auto* ic : face::findAll (parts["inspFx"]["tree"], "ic"))
                if (face::findNode (*ic, "ui-kn") != nullptr)
                    return ic;
            return nullptr;
        }();
        auto controls = [&] (const juce::var& nn, const juce::Array<juce::var>& ps) {
            const float colW = (box.getWidth() - 6 - 6) / 2;
            int col = 0;
            for (auto& p : ps)
            {
                const bool choice = p["choices"].isArray() && !(p["choices"].size() == 2 && p["choices"][0].toString() == "Off");
                const bool toggle = (bool) p["toggle"] || (p["choices"].isArray() && !choice);
                if (choice && col == 1)
                    col = 0, y += 35;
                const float x = box.getX() + (float) col * (colW + 6);
                const float w = choice ? box.getWidth() - 6 : colW;
                const auto cell = juce::Rectangle<float> (x, y, w, 32);
                const float v = pval (nn, p);
                if (choice)
                {
                    // Its name over its options, the one it has lit.
                    g.setColour (cl().t2);
                    g.setFont (face::sans (11, 500));
                    g.drawText (p["label"].toString(), cell.withHeight (12), juce::Justification::centredLeft);
                    float sx = x;
                    const int cur = juce::roundToInt (v - num (p["min"]));
                    auto* chs = p["choices"].getArray();
                    for (int ci = 0; ci < chs->size(); ++ci)
                    {
                        const auto t = chs->getReference (ci).toString();
                        const float tw = juce::GlyphArrangement::getStringWidth (face::sans (11, 500), t) + 14;
                        const auto r = juce::Rectangle<float> (sx, y + 13, tw, 18);
                        if (ci == cur)
                        {
                            g.setColour (cl().t.withAlpha (0.1f));
                            g.fillRoundedRectangle (r, 3);
                        }
                        g.setColour (ci == cur ? cl().t : cl().t3);
                        g.drawText (t, r, juce::Justification::centred);
                        hots.push_back ({ r, [this, id = nn["id"].toString(), key = p["key"].toString(), mn = num (p["min"]), ci] (const juce::MouseEvent&) { param (id, key, mn + (float) ci, false); } });
                        sx += tw + 2;
                    }
                    y += 35;
                    continue;
                }
                if (toggle)
                {
                    const auto t = juce::Rectangle<float> (x, y + 5, 26, 22);
                    g.setColour (juce::Colours::black.withAlpha (0.35f));
                    g.fillRoundedRectangle (t, 4);
                    const bool on = v >= num (p["min"]) + 0.5f;
                    g.setColour (on ? cl().acc : cl().track);
                    g.fillEllipse (t.getCentreX() - 4, t.getCentreY() - 4, 8, 8);
                    hots.push_back ({ t, [this, id = nn["id"].toString(), key = p["key"].toString(), mn = num (p["min"]), on] (const juce::MouseEvent&) { param (id, key, on ? mn : mn + 1, false); } });
                }
                else if (icKnob != nullptr)
                {
                    // The captured knob's cap and track, its ring and picture drawn now.
                    const auto* kn = face::findNode (*icKnob, "ui-kn");
                    const auto kr = face::rectOf (*kn);
                    const auto to = juce::Point<float> (x, y + (32 - kr.getHeight()) / 2);
                    face::Stamp ks;
                    ks.skip = [] (const juce::var& k) { return k["tag"].toString() == "canvas"; };
                    ks.draw (g, *kn, to - kr.getPosition());
                    {
                        juce::Graphics::ScopedSaveState k2 (g);
                        g.addTransform (juce::AffineTransform::translation (to.x, to.y));
                        c2d::Context c (g, kr.getWidth(), kr.getHeight());
                        drawBoardKnob (c, kr.getWidth(), pics, nn, p);
                    }
                    const auto kbox = juce::Rectangle<float> (to.x, to.y, kr.getWidth(), kr.getHeight());
                    hots.push_back ({ kbox, [this, id = nn["id"].toString(), key = p["key"].toString()] (const juce::MouseEvent&) { knobDrag (id, key); } });
                }
                const float tx = x + 32;
                g.setColour (cl().t2);
                g.setFont (face::sans (11, 500));
                g.drawText (p["label"].toString(), juce::Rectangle<float> (tx, y + 3, w - 32, 13), juce::Justification::centredLeft);
                g.setColour (cl().t);
                g.setFont (face::mono (11));
                g.drawText (fmtP (p, v), juce::Rectangle<float> (tx, y + 16, w - 32, 13), juce::Justification::centredLeft);
                col = 1 - col;
                if (col == 0)
                    y += 35;
            }
            if (col == 1)
                y += 35;
        };
        if (n == nullptr && cab == nullptr)
        {
            // The board itself: what it is, how it patches (as captured), what moves it, its nodes.
            bool ok = false;
            const auto st = mainPath (board, ok);
            hintLine ("The synth's master bus. The main path runs Voice " + arrow + " " + (ok ? juce::String ((int) st.size() - 2) + " nodes" : juce::String::fromUTF8 ("\xe2\x80\xa6")) + " " + arrow
                      + " Out; the oscillators, sub and noise come in as sends before the filters.");
            if (auto* how = face::findNode (*sc, "ihow"))
            {
                heading ("HOW IT PATCHES");
                const auto hr = face::rectOf (*how);
                face::Stamp().draw (g, *how, juce::Point<float> (box.getX(), y) - hr.getPosition() + juce::Point<float> (at.x - at.x, 0));
                y += hr.getHeight() + 6;
            }
            mods ([] (const wave::Model::Mod& m) { return m.dst.startsWith ("board:"); }, true);
            heading ("NODES");
            if (auto* ns = board["nodes"].getArray())
                for (auto& nn : *ns)
                    if (!isIO (nn))
                        row (nn, isFx (nn) ? catName (cat (nn)) : juce::String ("Routing"));
            return;
        }
        if (cab != nullptr)
        {
            const auto* A = board::node (board, (*cab)["from"][0].toString());
            const auto* B = board::node (board, (*cab)["to"][0].toString());
            if (A != nullptr)
                row (*A, portName (*A, (*cab)["from"][1].toString()));
            if (B != nullptr)
                row (*B, portName (*B, (*cab)["to"][1].toString()));
            heading ("CARRIES");
            const auto o = origins (board, model(), (*cab)["from"][0].toString(), (*cab)["from"][1].toString(), pics.memo);
            if (o.empty())
                hintLine ("Nothing: no live input reaches it");
            for (auto& k : o)
            {
                g.setColour (inputColour (k));
                g.fillRoundedRectangle (box.getX() + 4, y + 4, 3, 12, 1.5f);
                g.setColour (cl().t2);
                g.setFont (face::sans (11, 500));
                g.drawText (inputName (k), juce::Rectangle<float> (box.getX() + 13, y, 200, 20), juce::Justification::centredLeft);
                y += 22;
            }
            return;
        }
        const auto kind = (*n)["kind"].toString();
        if (isIO (*n))
        {
            const bool out = kind == "out", on = !((*n)["on"].isBool() && !(bool) (*n)["on"]);
            hintLine (out ? juce::String ("Everything patched in here is summed and goes on to the synth's master.")
                          : inputAbout (kind) + "." + (!inputLive (model(), kind) ? " It is off on Play, so nothing comes out." : !on ? " Its send is off." : ""));
            if (!out)
            {
                heading ("SEND");
                controls (*n, spec (*n));
            }
            heading (out ? "FED BY" : "FEEDS");
            int k = 0;
            if (auto* cs = board["cables"].getArray())
                for (auto& c : *cs)
                {
                    const auto other = out ? (c["to"][0].toString() == (*n)["id"].toString() ? c["from"][0].toString() : juce::String())
                                           : (c["from"][0].toString() == (*n)["id"].toString() ? c["to"][0].toString() : juce::String());
                    if (other.isNotEmpty())
                        if (auto* on2 = board::node (board, other))
                            row (*on2, {}), ++k;
                }
            if (k == 0)
                hintLine (out ? "Nothing: the board is silent" : "Nothing yet: drag from its out");
            return;
        }
        if (!fx)
        {
            heading ("CONTROLS");
            if (kind == "split" || kind == "mix")
            {
                // How many outs or ins.
                const int k = portCount (*n);
                g.setColour (cl().t2);
                g.setFont (face::sans (11, 500));
                g.drawText (kind == "split" ? "Outs" : "Inputs", juce::Rectangle<float> (box.getX(), y, 100, 12), juce::Justification::centredLeft);
                float sx = box.getX();
                for (int c = 2; c <= (kind == "split" ? 3 : 4); ++c)
                {
                    const auto t = juce::String (c) + (kind == "split" ? " outs" : " ins");
                    const float tw = juce::GlyphArrangement::getStringWidth (face::sans (11, 500), t) + 14;
                    const auto r = juce::Rectangle<float> (sx, y + 13, tw, 18);
                    if (c == k)
                    {
                        g.setColour (cl().t.withAlpha (0.1f));
                        g.fillRoundedRectangle (r, 3);
                    }
                    g.setColour (c == k ? cl().t : cl().t3);
                    g.drawText (t, r, juce::Justification::centred);
                    hots.push_back ({ r, [this, id = (*n)["id"].toString(), c] (const juce::MouseEvent&) { setPorts (id, c); } });
                    sx += tw + 2;
                }
                y += 35;
            }
            controls (*n, spec (*n));
            if (kind == "drywet")
                hintLine ("Send feeds the branch; patch the branch's end into Return. Wet sets how much of it you hear over the dry sound.");
            heading ("FEEDS");
            int k = 0;
            if (auto* cs = board["cables"].getArray())
                for (auto& c : *cs)
                    if (c["from"][0].toString() == (*n)["id"].toString())
                        if (auto* on2 = board::node (board, c["to"][0].toString()))
                            row (*on2, {}), ++k;
            if (k == 0)
                hintLine ("Nothing yet: drag from an out");
            if (!spec (*n).isEmpty())
                mods ([id = (*n)["id"].toString()] (const wave::Model::Mod& m) { return m.dst.startsWith ("board:" + id + ":"); }, false);
            return;
        }
        // An effect: its sound, then its controls in the page's groups, then what moves them.
        auto& kit = Kit::get();
        const auto sp = spec (*n);
        if (auto it = kit.byKind.find (kind); it != kit.byKind.end() && it->second["sound"].isObject())
        {
            heading (it->second["sound"]["label"].toString().toUpperCase());
            g.setColour (cl().t);
            g.setFont (face::sans (11, 500));
            g.drawText (soundLabel (*n), juce::Rectangle<float> (box.getX(), y, box.getWidth() - 70, 20), juce::Justification::centredLeft);
            y += 24;
        }
        std::vector<std::pair<juce::String, juce::Array<juce::var>>> groups;
        juce::StringArray seen;
        const auto& faceOf = kit.data["face"][juce::Identifier (kind)];
        if (auto* gs = faceOf.isArray() && faceOf.size() > 1 ? faceOf[1].getArray() : nullptr)
            for (auto& gr : *gs)
            {
                juce::Array<juce::var> ps;
                if (auto* ks = gr[1].getArray())
                    for (auto& k : *ks)
                        for (auto& p : sp)
                            if (p["key"].toString() == k.toString())
                                ps.add (p), seen.add (k.toString());
                if (!ps.isEmpty())
                    groups.push_back ({ gr[0].toString(), ps });
            }
        if (groups.empty() && !sp.isEmpty())
        {
            groups.push_back ({ "Settings", sp });
            for (auto& p : sp)
                seen.add (p["key"].toString());
        }
        juce::Array<juce::var> rest;
        for (auto& p : sp)
            if (!seen.contains (p["key"].toString()))
                rest.add (p);
        if (!rest.isEmpty())
            groups.push_back ({ "More", rest });
        for (auto& [label, ps] : groups)
        {
            heading (label.toUpperCase());
            controls (*n, ps);
        }
        if (sp.isEmpty())
            hintLine (name (*n) + " has no settings: " + (kind == "fx:invert" ? "it flips the wave upside down." : "it swaps left and right."));
        mods ([id = (*n)["id"].toString()] (const wave::Model::Mod& m) { return m.dst.startsWith ("board:" + id + ":"); }, false);
    }

    // ── edits ────────────────────────────────────────────────────────────

    void select (const Sel& s)
    {
        const bool same = s.t == sel.t && s.id == sel.id && s.i == sel.i;
        sel = s;
        if (!same)
            repaintAll();
    }

    juce::var* nodeVar (const juce::String& id) { return const_cast<juce::var*> (board::node (board, id)); }

    void knobDrag (const juce::String& id, const juce::String& key)
    {
        const auto* n = board::node (board, id);
        if (n == nullptr)
            return;
        juce::Array<juce::var> keep;
        const auto* p = paramOf (*n, key, &keep);
        if (p == nullptr)
            return;
        auto u = std::make_shared<float> (pn (*p, pval (*n, *p)));
        const auto pp = *p;
        drag = [this, id, key, u, pp] (const juce::MouseEvent& ev) {
            const float dy = ev.position.y - last.y;
            *u = clampf (*u - dy / (ev.mods.isShiftDown() ? 750.0f : 150.0f));
            param (id, key, pv (pp, *u), true);
        };
        dragEnd = [this, id, key] (const juce::MouseEvent&) {
            if (const auto* nn = board::node (board, id))
                param (id, key, (*nn)["params"][juce::Identifier (key)], false);
        };
    }

    void setPorts (const juce::String& id, int k)
    {
        auto* n = nodeVar (id);
        if (n == nullptr)
            return;
        const bool split = (*n)["kind"].toString() == "split";
        k = juce::jlimit (2, split ? 3 : 4, k);
        if (portCount (*n) == k)
            return;
        (*n)["params"].getDynamicObject()->setProperty (split ? "outs" : "ins", k);
        if (auto* cs = board["cables"].getArray())
            for (int i = cs->size(); --i >= 0;)
            {
                const auto& c = cs->getReference (i);
                if (split && c["from"][0].toString() == id && c["from"][1].toString().substring (1).getIntValue() >= k && c["from"][1].toString().startsWith ("o"))
                    cs->remove (i);
                else if (!split && c["to"][0].toString() == id && c["to"][1].toString().substring (1).getIntValue() >= k)
                    cs->remove (i);
            }
        if (!split)
        {
            auto& mods = model().mods;
            mods.erase (std::remove_if (mods.begin(), mods.end(), [&] (const wave::Model::Mod& m) {
                if (!m.dst.startsWith ("board:" + id + ":"))
                    return false;
                const auto key = m.dst.fromLastOccurrenceOf (":", false, false);
                return key.startsWith ("l") && key.substring (1).getIntValue() >= k;
            }), mods.end());
        }
        post (name (*n) + ": " + juce::String (k) + (split ? " outs" : " ins"));
    }

    juce::String newId()
    {
        for (int k = 1;; ++k)
            if (board::node (board, "n" + juce::String (k)) == nullptr)
                return "n" + juce::String (k);
    }

    bool overlap (const juce::var& a, const juce::var& b)
    {
        return &a != &b && num (a["x"]) < num (b["x"]) + nodeW (b) + 8 && num (b["x"]) < num (a["x"]) + nodeW (a) + 8 && num (a["y"]) < num (b["y"]) + nodeH (b) + 8
               && num (b["y"]) < num (a["y"]) + nodeH (a) + 8;
    }

    // The nearest free place on the grid (wvFreeSpot).
    void freeSpot (juce::var& n)
    {
        auto clash = [&] { if (auto* ns = board["nodes"].getArray()) for (auto& o : *ns) if (o["id"] != n["id"] && overlap (o, n)) return true; return false; };
        if (!clash())
            return;
        const float x0 = num (n["x"]), y0 = num (n["y"]), G = 16;
        float bd = 1e9f, bx = x0, by = y0;
        for (int dy = -30; dy <= 40; ++dy)
            for (int dx = -30; dx <= 30; ++dx)
            {
                const float x = x0 + (float) dx * G, y = y0 + (float) dy * G, d = (float) (dx * dx) + (float) (dy * dy) * 1.4f;
                if (x < 0 || y < 0 || d >= bd)
                    continue;
                n.getDynamicObject()->setProperty ("x", x);
                n.getDynamicObject()->setProperty ("y", y);
                if (!clash())
                    bd = d, bx = x, by = y;
            }
        n.getDynamicObject()->setProperty ("x", bx);
        n.getDynamicObject()->setProperty ("y", by);
    }

    juce::var* addNode (const juce::String& kind, juce::Point<float> pos, bool quiet = false)
    {
        auto* o = new juce::DynamicObject();
        o->setProperty ("id", newId());
        o->setProperty ("kind", kind);
        o->setProperty ("on", true);
        auto* ps = new juce::DynamicObject();
        o->setProperty ("params", juce::var (ps));
        juce::var n (o);
        for (auto& p : spec (n))
            ps->setProperty (p["key"].toString(), p["default"]);
        if (kind == "split")
            ps->setProperty ("outs", 2);
        if (kind == "mix")
        {
            ps->setProperty ("ins", 2);
            if (auto* mixp = Kit::get().data["kindParams"]["mix"].getArray())
                for (auto& p : *mixp)
                    ps->setProperty (p["key"].toString(), p["default"]);
        }
        o->setProperty ("x", juce::jmax (0.0f, std::round ((pos.x - nodeW (n) / 2) / 16) * 16));
        o->setProperty ("y", juce::jmax (0.0f, std::round ((pos.y - 14) / 16) * 16));
        freeSpot (n);
        board["nodes"].getArray()->add (n);
        sel = { "node", n["id"].toString(), -1 };
        if (!quiet)
            post ("Added " + name (n) + ": patch it from its ports, or drop it on a cable");
        return const_cast<juce::var*> (board::node (board, n["id"].toString()));
    }

    void addCable (const juce::String& a, const juce::String& ap, const juce::String& b, const juce::String& bp, bool moved)
    {
        auto* cs = board["cables"].getArray();
        for (auto& c : *cs)
            if (c["from"][0].toString() == a && c["from"][1].toString() == ap && c["to"][0].toString() == b && c["to"][1].toString() == bp)
            {
                note ("Those two are already patched", true);
                if (moved)
                    post ("Removed the cable");
                return;
            }
        std::set<juce::String> seen;
        if (reaches (board, b, bp, a, ap, seen))
        {
            note ("Refused: that would loop " + name (*board::node (board, a)) + " back into itself", true);
            if (moved)
                post ("Removed the cable");
            return;
        }
        auto* o = new juce::DynamicObject();
        o->setProperty ("from", arr ({ a, ap }));
        o->setProperty ("to", arr ({ b, bp }));
        cs->add (juce::var (o));
        int into = 0;
        for (auto& c : *cs)
            into += c["to"][0].toString() == b && c["to"][1].toString() == bp ? 1 : 0;
        post ("Patched " + name (*board::node (board, a)) + " " + arrow + " " + name (*board::node (board, b)) + (into > 1 ? " (summed with what is already there)" : ""));
    }

    void removeSelected()
    {
        if (sel.t == "cab")
        {
            auto* cs = board["cables"].getArray();
            if (cs == nullptr || sel.i < 0 || sel.i >= cs->size())
                return;
            const auto c = cs->getReference (sel.i);
            cs->remove (sel.i);
            sel = {};
            post ("Removed the cable " + name (*board::node (board, c["from"][0].toString())) + " " + arrow + " " + name (*board::node (board, c["to"][0].toString())));
            return;
        }
        if (sel.t != "node")
            return;
        const auto* n = board::node (board, sel.id);
        if (n == nullptr)
            return;
        if (isIO (*n))
            return note ("The inputs and Out are on every board", true);
        const auto id = sel.id, nm = name (*n);
        auto* ns = board["nodes"].getArray();
        for (int i = ns->size(); --i >= 0;)
            if (ns->getReference (i)["id"].toString() == id)
                ns->remove (i);
        auto* cs = board["cables"].getArray();
        for (int i = cs->size(); --i >= 0;)
            if (cs->getReference (i)["from"][0].toString() == id || cs->getReference (i)["to"][0].toString() == id)
                cs->remove (i);
        auto& mods = model().mods;
        const auto before = mods.size();
        mods.erase (std::remove_if (mods.begin(), mods.end(), [&] (const wave::Model::Mod& m) { return m.dst.startsWith ("board:" + id + ":"); }), mods.end());
        if (mods.size() != before && ctx.modsChanged)
            ctx.modsChanged();
        sel = {};
        post ("Removed " + nm);
    }

    // Drop a node on a cable: it goes in between (wvSplice).
    void splice (const juce::String& id, int i)
    {
        auto* cs = board["cables"].getArray();
        const auto* n = board::node (board, id);
        if (cs == nullptr || n == nullptr || i < 0 || i >= cs->size())
            return;
        const auto c = cs->getReference (i);
        cs->remove (i);
        auto add = [&] (const juce::var& from, const juce::var& to) {
            auto* o = new juce::DynamicObject();
            o->setProperty ("from", from.clone());
            o->setProperty ("to", to.clone());
            cs->add (juce::var (o));
        };
        add (c["from"], arr ({ id, mainIn (*n) }));
        add (arr ({ id, mainOut (*n) }), c["to"]);
        post ("Spliced " + name (*n) + " in between " + name (*board::node (board, c["from"][0].toString())) + " and " + name (*board::node (board, c["to"][0].toString())));
    }

    // Lift a node out: its cables go, and what fed it now feeds what it fed.
    bool liftOut (const juce::String& id)
    {
        auto* cs = board["cables"].getArray();
        const auto* n = board::node (board, id);
        if (cs == nullptr || n == nullptr)
            return false;
        juce::Array<juce::var> up, dn, keep;
        for (auto& c : *cs)
        {
            const bool mine = c["from"][0].toString() == id || c["to"][0].toString() == id;
            if (!mine)
                keep.add (c);
            if (c["to"][0].toString() == id && ((*n)["kind"].toString() != "drywet" || c["to"][1].toString() == "i"))
                up.add (c);
            if (c["from"][0].toString() == id && c["from"][1].toString() == mainOut (*n))
                dn.add (c);
        }
        if (keep.size() == cs->size())
            return false;
        *cs = keep;
        for (auto& u : up)
            for (auto& d : dn)
            {
                std::set<juce::String> seen;
                bool dup = false;
                for (auto& c : *cs)
                    dup = dup || (c["from"] == u["from"] && c["to"] == d["to"]);
                if (!dup && !reaches (board, d["to"][0].toString(), d["to"][1].toString(), u["from"][0].toString(), u["from"][1].toString(), seen))
                {
                    auto* o = new juce::DynamicObject();
                    o->setProperty ("from", u["from"].clone());
                    o->setProperty ("to", d["to"].clone());
                    cs->add (juce::var (o));
                }
            }
        return true;
    }

    // The cable nearest a node's in, within 30 board pixels (wvCableNear).
    int cableNear (const juce::var& n)
    {
        const juce::Point<float> c (num (n["x"]) + nodeW (n) / 2, num (n["y"]) + 1 + pinY (n, mainIn (n)));
        int best = -1;
        float bd = 30;
        if (auto* cs = board["cables"].getArray())
            for (int i = 0; i < cs->size(); ++i)
            {
                const auto& cb = cs->getReference (i);
                const auto* A = board::node (board, cb["from"][0].toString());
                const auto* B = board::node (board, cb["to"][0].toString());
                if (A == nullptr || B == nullptr)
                    continue;
                const auto p1 = pinXY (*A, cb["from"][1].toString(), true), p2 = pinXY (*B, cb["to"][1].toString(), false);
                juce::Path p;
                cabPath (p1.x, p1.y, p2.x, p2.y, p);
                const float L = p.getLength();
                for (int k = 0; k <= 32; ++k)
                {
                    const float d = p.getPointAlongPath (L * (float) k / 32).getDistanceFrom (c);
                    if (d < bd)
                        bd = d, best = i;
                }
            }
        return best;
    }

    int cableAt (juce::Point<float> w)
    {
        if (auto* cs = board["cables"].getArray())
            for (int i = 0; i < cs->size(); ++i)
            {
                const auto& cb = cs->getReference (i);
                const auto* A = board::node (board, cb["from"][0].toString());
                const auto* B = board::node (board, cb["to"][0].toString());
                if (A == nullptr || B == nullptr)
                    continue;
                const auto p1 = pinXY (*A, cb["from"][1].toString(), true), p2 = pinXY (*B, cb["to"][1].toString(), false);
                juce::Path p;
                cabPath (p1.x, p1.y, p2.x, p2.y, p);
                juce::Point<float> near;
                p.getNearestPoint (w, near);
                if (near.getDistanceFrom (w) <= 6)
                    return i;
            }
        return -1;
    }

    // A pin under the pointer (world coordinates): its node, port, and whether it is an out.
    struct PinHit
    {
        juce::String id, port;
        bool out = false;
    };
    std::optional<PinHit> pinAt (juce::Point<float> w)
    {
        if (auto* ns = board["nodes"].getArray())
            for (auto& n : *ns)
            {
                for (const auto& p : outPorts (n))
                    if (juce::Rectangle<float> (14, 10).withCentre (pinXY (n, p, true) + juce::Point<float> (1, 0)).expanded (2).contains (w))
                        return PinHit { n["id"].toString(), p, true };
                for (const auto& p : inPorts (n))
                    if (juce::Rectangle<float> (14, 10).withCentre (pinXY (n, p, false) - juce::Point<float> (1, 0)).expanded (2).contains (w))
                        return PinHit { n["id"].toString(), p, false };
            }
        return std::nullopt;
    }

    const juce::var* nodeAt (juce::Point<float> w)
    {
        const juce::var* hit = nullptr;
        if (auto* ns = board["nodes"].getArray())
            for (auto& n : *ns)
                if (nodeRect (n).contains (w))
                    hit = &n;
        return hit;
    }

    // ── the menu at the pointer ──────────────────────────────────────────

    std::vector<Item> addItems (std::function<void (const juce::String&)> pick)
    {
        std::vector<Item> out;
        Item routing;
        routing.l = "Routing";
        routing.cc = cl().t2;
        routing.hasCc = true;
        routing.right = "5";
        routing.sub = [this, pick] {
            std::vector<Item> r;
            for (auto* k : { "split", "mix", "gain", "pan", "drywet" })
            {
                Item it;
                it.l = Kit::get().data["routing"][k]["n"].toString();
                it.cc = cl().t2;
                it.hasCc = true;
                it.act = [pick, k] { pick (k); };
                r.push_back (it);
            }
            return r;
        };
        out.push_back (routing);
        Item sep;
        sep.sep = true;
        out.push_back (sep);
        auto& kit = Kit::get();
        if (auto* ss = kit.rack["suites"].getArray())
            for (auto& s : *ss)
            {
                // The rack's suites, families and modes, as Prism's FX tab lists them, where the board runs them.
                std::vector<std::pair<juce::String, juce::Array<juce::var>>> fams;
                int total = 0;
                if (auto* fs = s["families"].getArray())
                    for (auto& f : *fs)
                    {
                        juce::Array<juce::var> modes;
                        if (auto* ms = f["modes"].getArray())
                            for (auto& m : *ms)
                                if (kit.byKind.count ("fx:" + m["id"].toString()) > 0)
                                    modes.add (m);
                        if (!modes.isEmpty())
                            fams.push_back ({ f["label"].toString(), modes }), total += modes.size();
                    }
                if (fams.empty())
                    continue;
                Item it;
                it.l = s["label"].toString();
                it.cc = familyColour (fams[0].second[0]["kind"].toString());
                it.hasCc = true;
                it.right = juce::String (total);
                it.sub = [fams, pick] {
                    std::vector<Item> r;
                    for (auto& fam : fams)
                    {
                        const auto& fl = fam.first;
                        const auto modes = fam.second;
                        Item f;
                        f.l = fl;
                        f.cc = familyColour (modes[0]["kind"].toString());
                        f.hasCc = true;
                        f.right = juce::String (modes.size());
                        f.sub = [modes, pick] {
                            std::vector<Item> ms;
                            for (auto& m : modes)
                            {
                                Item mi;
                                mi.l = m["label"].toString();
                                mi.cc = familyColour (m["kind"].toString());
                                mi.hasCc = true;
                                const auto k = "fx:" + m["id"].toString();
                                mi.act = [pick, k] { pick (k); };
                                ms.push_back (mi);
                            }
                            return ms;
                        };
                        r.push_back (f);
                    }
                    return r;
                };
                out.push_back (it);
            }
        return out;
    }

    void openMenu (juce::Point<float> at, const juce::String& title, std::vector<Item> items)
    {
        menu.clear();
        menuCol (0, std::move (items), title, at);
    }

    void menuCol (int level, std::vector<Item> items, const juce::String& title, juce::Point<float> at = {})
    {
        menu.resize ((size_t) level);
        Col c;
        c.title = title;
        c.items = std::move (items);
        const bool leaf = std::all_of (c.items.begin(), c.items.end(), [] (const Item& i) { return !i.sub; });
        const float w = leaf && level > 0 ? 214.0f : 176.0f;
        float h = 8 + (title.isNotEmpty() ? 18.0f : 0.0f);
        for (auto& it : c.items)
            h += it.sep ? 7.0f : 23.0f;
        h = juce::jmin (h, 460.0f);
        float x = level == 0 ? at.x : menu[(size_t) level - 1].r.getRight() + 3;
        float y = level == 0 ? at.y : menu[(size_t) level - 1].r.getY() + (menu[(size_t) level - 1].hover >= 0 ? itemY (menu[(size_t) level - 1], menu[(size_t) level - 1].hover) - 4 : 0);
        // Inside the page.
        if (x + w > (float) getWidth() - 6)
        {
            if (level == 0)
                x = (float) getWidth() - 6 - w;
            else
                for (auto& m : menu)
                    m.r.translate (-((x + w) - ((float) getWidth() - 6)), 0), x = (float) getWidth() - 6 - w;
        }
        if (y + h > (float) getHeight() - 6)
            y = juce::jmax (6.0f, (float) getHeight() - 6 - h);
        c.r = { x, y, w, h };
        menu.push_back (c);
        again ("menu");
    }

    float itemY (const Col& c, int i) const
    {
        float y = c.r.getY() + 4 + (c.title.isNotEmpty() ? 18.0f : 0.0f);
        for (int k = 0; k < i; ++k)
            y += c.items[(size_t) k].sep ? 7.0f : 23.0f;
        return y;
    }

    void drawMenu (juce::Graphics& g)
    {
        const auto* col0 = face::findNode (parts["cmenu"]["tree"], "wv-cmcol");
        const auto* h0 = face::findNode (parts["cmenu"]["tree"], "cm-h");
        for (auto& c : menu)
        {
            if (col0 != nullptr)
                face::paintBox (g, *col0, c.r);
            if (c.title.isNotEmpty() && h0 != nullptr)
                face::paintText (g, *h0, { c.r.getX() + 12, c.r.getY() + 4, c.r.getWidth() - 16, 18 }, c.title);
            for (int i = 0; i < (int) c.items.size(); ++i)
            {
                const auto& it = c.items[(size_t) i];
                const float y = itemY (c, i);
                if (it.sep)
                {
                    g.setColour (cl().track);
                    g.fillRect (c.r.getX() + 8, y + 3, c.r.getWidth() - 16, 1.0f);
                    continue;
                }
                const auto r = juce::Rectangle<float> (c.r.getX() + 4, y, c.r.getWidth() - 8, 22);
                juce::Graphics::ScopedSaveState keep (g);
                if (it.dis)
                    g.beginTransparencyLayer (0.35f);
                if (i == c.hover && !it.dis)
                {
                    g.setColour ((it.hasCc ? it.cc : cl().t3).withAlpha (0.16f));
                    g.fillRoundedRectangle (r, 4);
                }
                if (it.hasCc)
                {
                    g.setColour (it.cc);
                    g.fillRoundedRectangle (r.getX() + 8, r.getCentreY() - 6, 3, 12, 1.5f);
                }
                g.setFont (face::sans (11, 500));
                g.setColour (i == c.hover ? cl().t : cl().t2);
                g.drawText (it.l, r.withTrimmedLeft (it.hasCc ? 18.0f : 8.0f).withTrimmedRight (30), juce::Justification::centredLeft);
                if (it.right.isNotEmpty())
                {
                    g.setFont (face::mono (9));
                    g.setColour (cl().t3);
                    g.drawText (it.right, r.withTrimmedRight (it.sub ? 20.0f : 8.0f), juce::Justification::centredRight);
                }
                if (it.sub)
                {
                    g.setColour (cl().t3);
                    juce::Path chev;
                    const float cx = r.getRight() - 12, cy = r.getCentreY();
                    chev.startNewSubPath (cx - 1.5f, cy - 3);
                    chev.lineTo (cx + 1.5f, cy);
                    chev.lineTo (cx - 1.5f, cy + 3);
                    g.strokePath (chev, juce::PathStrokeType (1.5f));
                }
                if (it.dis)
                    g.endTransparencyLayer();
            }
        }
    }

    bool menuDown (juce::Point<float> at)
    {
        if (menu.empty())
            return false;
        for (int level = (int) menu.size(); --level >= 0;)
        {
            auto& c = menu[(size_t) level];
            if (!c.r.contains (at))
                continue;
            for (int i = 0; i < (int) c.items.size(); ++i)
            {
                const float y = itemY (c, i);
                if (at.y < y || at.y >= y + (c.items[(size_t) i].sep ? 7.0f : 23.0f))
                    continue;
                auto it = c.items[(size_t) i];
                if (it.dis || it.sep)
                    return true;
                if (it.sub)
                {
                    c.hover = i;
                    menuCol (level + 1, it.sub(), {});
                    return true;
                }
                menu.clear();
                again ("menu");
                if (it.act)
                    it.act();
                return true;
            }
            return true;
        }
        menu.clear();
        again ("menu");
        return true;
    }

public:
    void pointerMoved (const juce::MouseEvent& e)
    {
        // Hovering an item opens its column, as the page's do.
        for (int level = 0; level < (int) menu.size(); ++level)
        {
            auto& c = menu[(size_t) level];
            if (!c.r.contains (e.position))
                continue;
            for (int i = 0; i < (int) c.items.size(); ++i)
            {
                const float y = itemY (c, i);
                if (e.position.y < y || e.position.y >= y + 23 || c.items[(size_t) i].sep)
                    continue;
                if (c.hover != i)
                {
                    c.hover = i;
                    if (c.items[(size_t) i].sub && !c.items[(size_t) i].dis)
                        menuCol (level + 1, c.items[(size_t) i].sub(), {});
                    else
                        menu.resize ((size_t) level + 1);
                    again ("menu");
                }
                return;
            }
        }
    }

private:
    void reorder (const juce::StringArray& ids)
    {
        bool ok = false;
        const auto st = mainPath (board, ok);
        if (!ok)
            return note ("The main path has to reach Out before it can be reordered", true);
        juce::StringArray mids;
        for (size_t i = 1; i + 1 < st.size(); ++i)
            mids.add (st[i].id);
        if (ids == mids)
            return;
        const auto old = board["cables"].clone();
        auto* cs = board["cables"].getArray();
        for (size_t i = 0; i + 1 < st.size(); ++i)
            for (int j = cs->size(); --j >= 0;)
            {
                const auto& c = cs->getReference (j);
                if (c["from"][0].toString() == st[i].id && c["from"][1].toString() == st[i].outP && c["to"][0].toString() == st[i + 1].id && c["to"][1].toString() == st[i + 1].inP)
                {
                    cs->remove (j);
                    break;
                }
            }
        std::vector<Step> seq { st.front() };
        for (auto& id : ids)
            for (size_t i = 1; i + 1 < st.size(); ++i)
                if (st[i].id == id)
                    seq.push_back (st[i]);
        seq.push_back (st.back());
        for (size_t i = 0; i + 1 < seq.size(); ++i)
        {
            auto* o = new juce::DynamicObject();
            o->setProperty ("from", arr ({ seq[i].id, seq[i].outP }));
            o->setProperty ("to", arr ({ seq[i + 1].id, seq[i + 1].inP }));
            cs->add (juce::var (o));
        }
        for (auto& c : *cs)
        {
            std::set<juce::String> seen;
            if (reaches (board, c["to"][0].toString(), c["to"][1].toString(), c["from"][0].toString(), c["from"][1].toString(), seen))
            {
                board.getDynamicObject()->setProperty ("cables", old);
                repaintAll();
                return note ("Refused: in that order a branch would loop back into itself", true);
            }
        }
        juce::StringArray names;
        for (auto& id : ids)
            names.add (name (*board::node (board, id)));
        post ("Main path: Voice " + arrow + " " + names.joinIntoString (" " + arrow + " ") + " " + arrow + " Out");
    }

    friend struct BoardMouse;
};

bool WaveBoard::down (const juce::MouseEvent& e)
{
    const auto at = e.position;
    drag = nullptr;
    dragEnd = nullptr;
    last = at;
    if (menuDown (at))
        return true;
    // The inspector's controls.
    for (auto& h : hots)
        if (h.r.contains (at))
        {
            h.down (e);
            return true;
        }
    // The zoom.
    for (auto* id : { "#wvZout", "#wvZin", "#wvZfit", "#wvZ100" })
        if (auto* n = face::findNode (fzoom, id); n != nullptr && face::rectOf (*n).contains (at))
        {
            const auto c = well.getCentre() - well.getPosition();
            const juce::String w (id);
            if (w == "#wvZin")
                zoomAt (V.z * 1.15f, c);
            else if (w == "#wvZout")
                zoomAt (V.z / 1.15f, c);
            else if (w == "#wvZfit")
                fit();
            else
                V = {}, repaintAll();
            return true;
        }
    // The sources strip: drag one onto a control.
    for (auto* gx : nodes ("wv-gxc"))
        if (face::rectOf (*gx).contains (at))
        {
            if (startMapping)
                startMapping ((*gx)["data"]["src"].toString(), e);
            return true;
        }
    // The main path's chips: select, drag to reorder.
    layoutChain();
    for (int i = 0; i < (int) chips.size(); ++i)
        if (chips[(size_t) i].r.contains (at))
        {
            const auto id = chips[(size_t) i].id;
            auto movedFar = std::make_shared<bool> (false);
            const float sx = at.x;
            drag = [this, i, sx, movedFar] (const juce::MouseEvent& ev) {
                if (!*movedFar && std::abs (ev.position.x - sx) > 5)
                    *movedFar = true, dragChip = i;
                if (!*movedFar)
                    return;
                dropAt = (int) chips.size();
                for (int k = 0; k < (int) chips.size(); ++k)
                    if (k != i && ev.position.x < chips[(size_t) k].r.getCentreX())
                    {
                        dropAt = k;
                        break;
                    }
                again ("chain");
            };
            dragEnd = [this, i, id, movedFar] (const juce::MouseEvent&) {
                if (!*movedFar)
                    select ({ "node", id, -1 });
                else
                {
                    juce::StringArray ids;
                    for (int k = 0; k < (int) chips.size(); ++k)
                        if (k != i)
                            ids.add (chips[(size_t) k].id);
                    int to = dropAt;
                    if (to > i)
                        --to;
                    ids.insert (juce::jlimit (0, ids.size(), to), id);
                    dragChip = dropAt = -1;
                    reorder (ids);
                }
                dragChip = dropAt = -1;
                again ("chain");
            };
            return true;
        }
    if (!well.contains (at))
        return false;
    const auto w = toWorld (at);
    // A pin: drag from an out to an in; from an in, its cable comes away.
    if (auto pin = pinAt (w))
    {
        juce::String nid = pin->id, port = pin->port;
        bool moved = false;
        if (!pin->out)
        {
            auto* cs = board["cables"].getArray();
            int found = -1;
            for (int j = 0; j < cs->size(); ++j)
                if (cs->getReference (j)["to"][0].toString() == nid && cs->getReference (j)["to"][1].toString() == port)
                    found = j;
            if (found < 0)
            {
                note ("Drag from an out (on the right of a node) to an in", true);
                return true;
            }
            const auto c = cs->getReference (found);
            cs->remove (found);
            nid = c["from"][0].toString();
            port = c["from"][1].toString();
            if (sel.t == "cab")
                sel = {};
            moved = true;
        }
        const auto* n = board::node (board, nid);
        const auto p1 = pinXY (*n, port, true);
        okPins = "1";
        drag = [this, p1] (const juce::MouseEvent& ev) {
            const auto p2 = toWorld (ev.position);
            cabPath (p1.x, p1.y, p2.x, p2.y, tmpCable);
            again ("live");
        };
        drag (e);
        dragEnd = [this, nid, port, moved] (const juce::MouseEvent& ev) {
            tmpCable.clear();
            okPins.clear();
            auto t = pinAt (toWorld (ev.position));
            if (!t || t->out)
            {
                if (t)
                    note ("An out goes to an in", true);
                if (moved)
                    post ("Removed the cable");
                repaintAll();
                return;
            }
            addCable (nid, port, t->id, t->port, moved);
        };
        return true;
    }
    // A node: select it; its header moves it; its switches and knobs work.
    if (const auto* n = nodeAt (w))
    {
        const auto id = (*n)["id"].toString();
        select ({ "node", id, -1 });
        const auto* t = tplFor (*n);
        const auto off = nodeRect (*n).getPosition() - face::rectOf (*t).getPosition();
        auto hitIn = [&] (const juce::String& what) -> const juce::var* {
            for (auto* k : face::findAll (*t, what))
                if ((face::rectOf (*k) + off).contains (w))
                    return k;
            return nullptr;
        };
        if (hitIn ("data-pw") != nullptr)
        {
            param (id, "on", (*n)["on"].isBool() && !(bool) (*n)["on"], false);
            return true;
        }
        if (auto* sn = hitIn ("data-sn"))
        {
            if (auto* kids = (*sn)["kids"].getArray())
                for (auto& k : *kids)
                    if ((face::rectOf (k) + off).contains (w))
                        setPorts (id, k["data"]["k"].toString().getIntValue());
            return true;
        }
        if (auto* mn = hitIn ("data-mn"))
        {
            setPorts (id, portCount (*n) + (*mn)["data"]["mn"].toString().getIntValue());
            return true;
        }
        if (hitIn ("data-snd") != nullptr)
        {
            // Its sound, from disk (the page picks it from the library).
            auto chooser = std::make_shared<juce::FileChooser> ("Choose a sound for " + name (*n), juce::File(), "*.wav;*.aif;*.aiff;*.flac");
            chooser->launchAsync (juce::FileBrowserComponent::openMode | juce::FileBrowserComponent::canSelectFiles, [this, id, chooser] (const juce::FileChooser& fc) {
                const auto f = fc.getResult();
                if (!f.existsAsFile())
                    return;
                auto* body = new juce::DynamicObject();
                body->setProperty ("node", id);
                body->setProperty ("key", "sound");
                body->setProperty ("value", f.getFullPathName());
                int st = 0;
                const auto r = ctx.api ? ctx.api ("POST", "/api/wave/board/param", juce::var (body), st) : juce::var();
                if (st != 200)
                    return note ("Refused: " + r["error"].toString(), true);
                if (auto* nn = nodeVar (id))
                {
                    nn->getDynamicObject()->setProperty ("sound", f.getFullPathName());
                    nn->getDynamicObject()->setProperty ("soundState", r["soundState"].isString() ? r["soundState"] : juce::var ("loaded"));
                }
                repaintAll();
                note (name (*board::node (board, id)) + ": " + f.getFileName());
            });
            return true;
        }
        // A knob on the node.
        int ki = 0;
        const auto sp = isFx (*n) ? facePr (*n) : spec (*n);
        for (auto* cv : face::findAll (*t, "data-fxk"))
        {
            if ((face::rectOf (*cv) + off).contains (w))
            {
                const auto key = isFx (*n) && ki < sp.size() ? sp[ki]["key"].toString() : (*cv)["data"]["fxk"].toString().fromFirstOccurrenceOf ("|", false, false);
                knobDrag (id, key);
                return true;
            }
            ++ki;
        }
        // The header (or an io's): move it on the grid; ⌥ lifts it out first.
        if (hitIn ("data-drag") != nullptr)
        {
            const float x0 = num ((*n)["x"]), y0 = num ((*n)["y"]);
            const auto sp0 = at;
            bool lifted = false;
            if (e.mods.isAltDown() && !isIO (*n) && liftOut (id))
            {
                lifted = true;
                note ("Lifted " + name (*n) + " out; its neighbours are joined. Drop it on a cable to put it back in");
                repaintAll();
            }
            const bool io = isIO (*n);
            drag = [this, id, x0, y0, sp0, io] (const juce::MouseEvent& ev) {
                auto* nn = nodeVar (id);
                if (nn == nullptr)
                    return;
                nn->getDynamicObject()->setProperty ("x", juce::jmax (0.0f, std::round ((x0 + (ev.position.x - sp0.x) / V.z) / 16) * 16));
                nn->getDynamicObject()->setProperty ("y", juce::jmax (0.0f, std::round ((y0 + (ev.position.y - sp0.y) / V.z) / 16) * 16));
                bool wired = false;
                if (auto* cs = board["cables"].getArray())
                    for (auto& c : *cs)
                        wired = wired || c["from"][0].toString() == id || c["to"][0].toString() == id;
                insCable = !io && !wired ? cableNear (*nn) : -1;
                again ("world");
                again ("live");
            };
            dragEnd = [this, id, x0, y0, lifted] (const juce::MouseEvent&) {
                const auto* nn = board::node (board, id);
                const int cand = insCable;
                insCable = -1;
                if (cand >= 0)
                    splice (id, cand);
                else if (lifted)
                    post ("Lifted " + name (*nn) + " out; its neighbours are joined");
                else if (nn != nullptr && (std::abs (num ((*nn)["x"]) - x0) > 0.01f || std::abs (num ((*nn)["y"]) - y0) > 0.01f))
                    post();
                else
                    repaintAll();
            };
        }
        return true;
    }
    // A cable: select it.
    if (const int ci = cableAt (w); ci >= 0)
    {
        select ({ "cab", {}, ci });
        return true;
    }
    // The grid: deselect, and pan.
    select ({});
    const auto v0 = V;
    const auto s0 = at;
    drag = [this, v0, s0] (const juce::MouseEvent& ev) {
        V.x = v0.x + ev.position.x - s0.x;
        V.y = v0.y + ev.position.y - s0.y;
        repaintAll();
    };
    return true;
}

bool WaveBoard::doubleClick (const juce::MouseEvent& e)
{
    if (!well.contains (e.position))
        return false;
    const auto w = toWorld (e.position);
    if (const auto* n = nodeAt (w))
    {
        // A knob goes back to its default.
        const auto* t = tplFor (*n);
        const auto off = nodeRect (*n).getPosition() - face::rectOf (*t).getPosition();
        int ki = 0;
        const auto sp = isFx (*n) ? facePr (*n) : spec (*n);
        for (auto* cv : face::findAll (*t, "data-fxk"))
        {
            if ((face::rectOf (*cv) + off).contains (w))
            {
                const auto key = isFx (*n) && ki < sp.size() ? sp[ki]["key"].toString() : (*cv)["data"]["fxk"].toString().fromFirstOccurrenceOf ("|", false, false);
                juce::Array<juce::var> keep;
                if (auto* p = paramOf (*n, key, &keep))
                    param ((*n)["id"].toString(), key, (*p)["default"], false);
                return true;
            }
            ++ki;
        }
        return true;
    }
    return false;
}

bool WaveBoard::rightClick (const juce::MouseEvent& e)
{
    if (!well.contains (e.position))
        return false;
    const auto w = toWorld (e.position);
    if (const auto* n = nodeAt (w))
    {
        const auto id = (*n)["id"].toString();
        const bool io = isIO (*n), fx = isFx (*n), on = !((*n)["on"].isBool() && !(bool) (*n)["on"]);
        bool wired = false;
        if (auto* cs = board["cables"].getArray())
            for (auto& c : *cs)
                wired = wired || c["from"][0].toString() == id || c["to"][0].toString() == id;
        select ({ "node", id, -1 });
        std::vector<Item> items;
        Item a;
        a.l = on ? "Bypass" : "Turn back on";
        a.dis = !fx;
        a.act = [this, id, on] {
            param (id, "on", !on, false);
            note (name (*board::node (board, id)) + (on ? " is bypassed: the sound passes through untouched" : " is back on"));
        };
        items.push_back (a);
        Item d;
        d.l = "Duplicate";
        d.dis = io;
        d.act = [this, id] {
            auto copy = board::node (board, id)->clone();
            const auto nid = newId();
            copy.getDynamicObject()->setProperty ("id", nid);
            copy.getDynamicObject()->setProperty ("x", num (copy["x"]) + 32);
            copy.getDynamicObject()->setProperty ("y", num (copy["y"]) + 32);
            freeSpot (copy);
            board["nodes"].getArray()->add (copy);
            std::vector<wave::Model::Mod> rows;
            for (auto& m : model().mods)
                if (m.dst.startsWith ("board:" + id + ":"))
                {
                    auto r = m;
                    r.dst = m.dst.replace ("board:" + id + ":", "board:" + nid + ":");
                    rows.push_back (r);
                }
            if (!rows.empty() && model().mods.size() + rows.size() <= 64)
            {
                model().mods.insert (model().mods.end(), rows.begin(), rows.end());
                if (ctx.modsChanged)
                    ctx.modsChanged();
            }
            sel = { "node", nid, -1 };
            post ("Duplicated " + name (copy) + ", settings and mapped sources too: patch it in");
        };
        items.push_back (d);
        Item r;
        r.l = "Replace with";
        r.dis = io;
        r.sub = [this, id] {
            return addItems ([this, id] (const juce::String& kind) {
                auto* nn = nodeVar (id);
                if (nn == nullptr)
                    return;
                const auto old = name (*nn), was = (*nn)["kind"].toString();
                const auto counts = (*nn)["params"].clone();
                auto* o = nn->getDynamicObject();
                o->setProperty ("kind", kind);
                o->setProperty ("on", true);
                o->removeProperty ("sound");
                o->removeProperty ("soundState");
                auto* ps = new juce::DynamicObject();
                o->setProperty ("params", juce::var (ps));
                for (auto& p : spec (*nn))
                    ps->setProperty (p["key"].toString(), p["default"]);
                if (kind == "split")
                    ps->setProperty ("outs", was == "split" ? counts["outs"] : juce::var (2));
                if (kind == "mix")
                    ps->setProperty ("ins", was == "mix" ? counts["ins"] : juce::var (2));
                // Its cables stay where its ports allow.
                const auto ins = inPorts (*nn), outs = outPorts (*nn);
                auto* cs = board["cables"].getArray();
                juce::Array<juce::var> mine, rest;
                for (auto& c : *cs)
                    (c["from"][0].toString() == id || c["to"][0].toString() == id ? mine : rest).add (c);
                *cs = rest;
                for (auto& c : mine)
                {
                    auto d2 = c.clone();
                    if (c["to"][0].toString() == id)
                    {
                        if (ins.isEmpty())
                            continue;
                        if (!ins.contains (c["to"][1].toString()))
                            d2["to"].getArray()->set (1, ins[0]);
                    }
                    if (c["from"][0].toString() == id)
                    {
                        if (outs.isEmpty())
                            continue;
                        if (!outs.contains (c["from"][1].toString()))
                            d2["from"].getArray()->set (1, outs[0]);
                    }
                    std::set<juce::String> seen;
                    if (!reaches (board, d2["to"][0].toString(), d2["to"][1].toString(), d2["from"][0].toString(), d2["from"][1].toString(), seen))
                        cs->add (d2);
                }
                post ("Replaced " + old + " with " + name (*nn) + "; its cables stay");
            });
        };
        items.push_back (r);
        Item l;
        l.l = "Lift out, join its neighbours";
        l.dis = io || !wired;
        l.act = [this, id] {
            if (liftOut (id))
                post ("Lifted " + name (*board::node (board, id)) + " out; its neighbours are joined");
        };
        items.push_back (l);
        Item sep;
        sep.sep = true;
        items.push_back (sep);
        Item rm;
        rm.l = "Remove";
        rm.dis = io;
        rm.act = [this, id] {
            sel = { "node", id, -1 };
            removeSelected();
        };
        items.push_back (rm);
        openMenu (e.position, name (*n).toUpperCase(), items);
        return true;
    }
    if (const int ci = cableAt (w); ci >= 0)
    {
        select ({ "cab", {}, ci });
        std::vector<Item> items;
        Item ins;
        ins.l = "Insert effect here";
        ins.sub = [this, ci, w] {
            return addItems ([this, ci, w] (const juce::String& kind) {
                auto* n = addNode (kind, w, true);
                if (n != nullptr)
                    splice ((*n)["id"].toString(), ci);
            });
        };
        items.push_back (ins);
        Item sep;
        sep.sep = true;
        items.push_back (sep);
        Item rm;
        rm.l = "Remove";
        rm.act = [this] { removeSelected(); };
        items.push_back (rm);
        openMenu (e.position, "CABLE", items);
        return true;
    }
    openMenu (e.position, "ADD HERE", addItems ([this, w] (const juce::String& kind) { addNode (kind, w); }));
    return true;
}
} // namespace

std::unique_ptr<WaveView> makeWaveFx (WaveCtx& c, const juce::var& captured)
{
    return std::make_unique<WaveBoard> (c, captured);
}

void setBoardMapping (WaveView& v, std::function<void (const juce::String&, const juce::MouseEvent&)> f)
{
    if (auto* b = dynamic_cast<WaveBoard*> (&v))
        b->startMapping = std::move (f);
}

void boardMoved (WaveView& v, const juce::MouseEvent& e)
{
    if (auto* b = dynamic_cast<WaveBoard*> (&v))
        b->pointerMoved (e);
}

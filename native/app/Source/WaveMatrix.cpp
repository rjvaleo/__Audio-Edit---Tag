// Wave's Matrix view (ui/app/393-wave-matrix.js), line for line: the eight
// small tiles (WaveTiles, `m`), and under them the patch matrix, the only list
// of connections: as pins (every source a row, every target a column under
// its group's band, a pin in a hole for each connection, dragged up and down
// for its amount; the columns page a group at a time) or as rows (on, source,
// amount, target, × source, curve), with the pickers.
//
// The pins and rows are drawn from the page's own, captured with a row in
// for every source, on and off (capture-wave.mjs, parts "pins" and "rows"),
// so each is stamped in its own source's colour where the patch puts it.

#include "WaveTiles.h"
#include "WaveView.h"

namespace
{
const juce::String minus = juce::String::fromUTF8 ("\xe2\x88\x92");
float clampf (float v, float a = 0, float b = 1) { return juce::jlimit (a, b, v); }

void walk (const juce::var& n, const std::function<void (const juce::var&)>& f)
{
    f (n);
    if (auto* kids = n["kids"].getArray())
        for (const auto& k : *kids)
            walk (k, f);
}

class WaveMatrix final : public WaveView
{
public:
    WaveMatrix (WaveCtx& c, const juce::var& captured) : WaveView (c, captured)
    {
        const auto& parts = face::page ("wave-views")["parts"];
        pinsPart = parts["pins"];
        rowsPart = parts["rows"];
        headPart = parts["mxhead"];
        pickSrcPart = parts["pickSrc"];
        pickTgtPart = parts["pickTgt"];
        index();
        build();
    }

    void shown() override
    {
        tiles->sync();
        render();
    }

    void changed (const juce::String& key) override
    {
        tiles->changed (key);
        if (key.startsWith ("macro"))
            again ("grid");
    }

    void tick (float) override
    {
        tiles->live();
        again ("live");
    }

    bool key (const juce::KeyPress& k) override
    {
        if (k == juce::KeyPress::escapeKey && picker.isNotEmpty())
        {
            closePicker();
            return true;
        }
        return false;
    }

    void closeMenus() override
    {
        if (picker.isNotEmpty())
            closePicker();
    }

    std::vector<std::pair<juce::String, double>> profile (float s) override { return timeLayers (s); }

    bool down (const juce::MouseEvent& e) override
    {
        const auto at = e.position;
        drag = nullptr;
        dragEnd = nullptr;
        last = at;
        if (picker.isNotEmpty())
        {
            const bool inside = pickerR.contains (at);
            if (!inside)
            {
                closePicker();
                if (pickerFrom.contains (at))
                    return true;
            }
            else
            {
                pickAt (at);
                return true;
            }
        }
        if (auto src = tiles->sourceAt (at); src.isNotEmpty())
        {
            if (startMapping)
                startMapping (src, e);
            return true;
        }
        if (tiles->down (e))
        {
            drag = [this] (const juce::MouseEvent& ev) { tiles->dragged (ev); };
            dragEnd = [this] { tiles->up(); };
            return true;
        }
        // Pins or Rows, and paging.
        for (auto* n : nodes ("data-m"))
            if (face::rectOf (*n).contains (at))
            {
                rows = (*n)["data"]["m"].toString() == "rows";
                render();
                return true;
            }
        if (!rows)
            for (auto* n : nodes ("data-pg"))
                if (face::rectOf (*n).contains (at))
                {
                    page ((*n)["data"]["pg"].toString().getIntValue());
                    return true;
                }
        return rows ? rowsDown (e) : pinsDown (e);
    }

    void dragged (const juce::MouseEvent& e) override
    {
        if (drag)
            drag (e);
        last = e.position;
    }

    void up (const juce::MouseEvent& e) override
    {
        if (dragEnd)
            dragEnd();
        drag = nullptr;
        dragEnd = nullptr;
        juce::ignoreUnused (e);
    }

    bool doubleClick (const juce::MouseEvent& e) override
    {
        const auto at = e.position;
        if (!rows)
        {
            if (auto h = holeAt (at))
            {
                // Double-click pulls the pin.
                if (auto i = modAt (h->src, h->dst); i >= 0)
                {
                    model().mods.erase (model().mods.begin() + i);
                    changedRows();
                }
                return true;
            }
            return false;
        }
        for (int r = 0; r < (int) model().mods.size(); ++r)
            if (rowCell (r, "amount").contains (at))
            {
                model().mods[(size_t) r].amt = 0;
                changedRows();
                return true;
            }
        return false;
    }

    bool wheel (const juce::MouseEvent& e, const juce::MouseWheelDetails& w) override
    {
        if (!rows && pinsBox.contains (e.position))
        {
            const float d = (std::abs (w.deltaX) > std::abs (w.deltaY) ? -w.deltaX : -w.deltaY) * 400;
            scrollTo (scroll + d);
            return true;
        }
        if (rows && rowsBox.contains (e.position))
        {
            rowScroll = juce::jlimit (0.0f, juce::jmax (0.0f, rowsHeight() - rowsBox.getHeight()), rowScroll - w.deltaY * 400);
            again ("grid");
            again ("live");
            return true;
        }
        return false;
    }

    // A source dragged from here (a row head) onto a control.
    std::function<void (const juce::String& src, const juce::MouseEvent&)> startMapping;

private:
    juce::var pinsPart, rowsPart, headPart, pickSrcPart, pickTgtPart;
    std::unique_ptr<WaveTiles> tiles;
    bool rows = false;
    float scroll = 0, rowScroll = 0;
    juce::String gridSig;
    Cached gridCache;
    juce::Rectangle<float> pinsBox, rowsBox, headBox;
    juce::Point<float> pinsAt, rowsAt;

    // The pins' grid as captured: its cells, its pins in each source's colour.
    struct Cell
    {
        const juce::var* n;
        bool sticky;
    };
    std::vector<Cell> cells;
    std::map<juce::String, const juce::var*> pinOn, pinOff;      // by source
    std::map<juce::String, juce::Rectangle<float>> rowY;          // by source: its row (y, height)
    std::map<juce::String, juce::Rectangle<float>> colX;          // by target: its column (x, width)
    const juce::var *boardBand = nullptr, *boardLab = nullptr;
    std::map<juce::String, const juce::var*> boardHole;           // by source: its hole in the FX BOARD column
    float boardX = 0, gridW = 0;
    std::map<juce::String, float> bandX;                          // by group name

    // The rows as captured: a row in every source's colour, on and off.
    std::map<juce::String, const juce::var*> rowOn, rowOff;
    const juce::var *addRow = nullptr, *emptyRow = nullptr, *rowsHead = nullptr;
    float rowsTop = 0;

    std::function<void (const juce::MouseEvent&)> drag;
    std::function<void()> dragEnd;
    juce::Point<float> last;

    wave::Model& model() { return *ctx.model; }
    const wave::Cl& cl() const { return *ctx.cl; }

    void index()
    {
        // Where the pins and rows sit on the page.
        pinsAt = { (float) (double) pinsPart["root"][0], (float) (double) pinsPart["root"][1] };
        pinsBox = { pinsAt.x, pinsAt.y, (float) (double) pinsPart["root"][2], (float) (double) pinsPart["root"][3] };
        rowsAt = { (float) (double) rowsPart["root"][0], (float) (double) rowsPart["root"][1] };
        headBox = { (float) (double) headPart["root"][0], (float) (double) headPart["root"][1], (float) (double) headPart["root"][2], (float) (double) headPart["root"][3] };
        const auto* grid = face::findNode (pinsPart["tree"], "wv-pgrid");
        if (grid == nullptr)
            return;
        if (auto* kids = (*grid)["kids"].getArray())
            for (const auto& k : *kids)
            {
                const auto r = face::rectOf (k);
                gridW = juce::jmax (gridW, r.getRight());
                if (face::matches (k, "wv-pband"))
                {
                    const auto name = k["text"][0]["text"].toString();
                    bandX[name] = r.getX();
                    if (name == "FX BOARD")
                    {
                        boardBand = &k, boardX = r.getX();
                        continue;
                    }
                }
                if (face::matches (k, "wv-plab"))
                {
                    const auto col = k["data"]["col"].toString();
                    if (col.startsWith ("board:"))
                    {
                        boardLab = &k;
                        continue;
                    }
                    colX[col] = r;
                }
                if (face::matches (k, "wv-rh"))
                    rowY[k["data"]["src"].toString()] = r;
                if (face::matches (k, "wv-hole"))
                {
                    const auto s = k["data"]["s"].toString(), t = k["data"]["t"].toString();
                    if (face::matches (k, "pin"))
                        (face::matches (k, "off") ? pinOff : pinOn)[s] = &k;
                    if (t.startsWith ("board:"))
                    {
                        boardHole[s] = &k;
                        continue;
                    }
                }
                cells.push_back ({ &k, face::matches (k, "wv-pc0") || face::matches (k, "wv-rh") });
            }
        if (boardBand != nullptr)
            gridW = boardX;
        // The rows.
        if (auto* list = face::findNode (rowsPart["tree"], "#wvMxRows"))
        {
            rowsBox = face::rectOf (*list) + rowsAt;
            rowsTop = face::rectOf (*list).getY();
            if (auto* kids = (*list)["kids"].getArray())
                for (const auto& k : *kids)
                {
                    if (face::matches (k, "add"))
                        addRow = &k;
                    else if (face::matches (k, "empty"))
                        emptyRow = emptyRow == nullptr ? &k : emptyRow;
                    else if (auto* s = face::findNode (k, "data-pk=s"))
                        if (auto* b = face::findNode (*s, "b"))
                        {
                            const auto label = (*b)["text"][0]["text"].toString();
                            for (const auto& src : wave::sources())
                                if (src.label == label)
                                    (face::matches (k, "off") ? rowOff : rowOn)[src.key] = &k;
                        }
                }
        }
        rowsHead = face::findNode (rowsPart["tree"], "wv-mxh");
    }

    void build()
    {
        WaveTiles::Host th;
        th.chrome = &chrome;
        th.tree = cap["tree"];
        th.model = ctx.model;
        th.cl = ctx.cl;
        th.set = [this] (const juce::String& k, const juce::var& v) { ctx.set (k, v); };
        th.lfoMenu = [this] (juce::Rectangle<float> near, int L) { if (ctx.lfoMenu) ctx.lfoMenu (near, L); };
        th.addLayer = [this] (const juce::String& name, juce::Rectangle<float> r, std::function<void (juce::Graphics&)> draw) -> juce::Component* {
            const auto box = r.getSmallestIntegerContainer().toFloat();
            const auto off = r.getPosition() - box.getPosition();
            return addLayer (name, r, [draw, off] (juce::Graphics& g) {
                g.addTransform (juce::AffineTransform::translation (off.x, off.y));
                draw (g);
            });
        };
        tiles = std::make_unique<WaveTiles> (th, "m");
        // The captured grid is drawn here, scrolled; the frame leaves it out.
        if (auto* p = node ("#wvMxPins"))
            if (auto* kids = (*p)["kids"].getArray())
                for (auto& k : *kids)
                    chrome.skip.insert ((int) k["i"]);
        const auto gridBox = pinsBox.getUnion (rowsBox).getUnion ({ rowsAt.x, rowsAt.y, rowsBox.getWidth(), 20 }).expanded (4);
        // The grid or the rows, kept; over them what moves (the pins' glow, the sources' pictures).
        addLayer ("grid", gridBox, [this, gridBox] (juce::Graphics& g) {
            g.addTransform (juce::AffineTransform::translation (-gridBox.getX(), -gridBox.getY()));
            juce::String key = gridSig;
            if (rows)
                key << juce::JSON::toString (wave::modsOut (model()), true) << draftSrc << draftDst << draftVia;
            drawCached (g, gridCache, key, gridBox, [this] (juce::Graphics& gg) {
                if (rows)
                    drawRows (gg, false);
                else
                    drawPins (gg, false);
            });
        });
        addLayer ("live", gridBox, [this, gridBox] (juce::Graphics& g) {
            g.addTransform (juce::AffineTransform::translation (-gridBox.getX(), -gridBox.getY()));
            if (rows)
                drawRows (g, true);
            else
                drawPins (g, true);
        });
        addLayer ("head", headBox.expanded (2), [this] (juce::Graphics& g) {
            if (!rows)
                return;
            g.addTransform (juce::AffineTransform::translation (-(headBox.getX() - 2), -(headBox.getY() - 2)));
            face::Stamp s;
            s.text = [this] (const juce::var& n, juce::String& out) {
                if (n["id"].toString() != "wvMxCount")
                    return false;
                out = juce::String ((int) model().mods.size()) + " of 64";
                return true;
            };
            s.draw (g, headPart["tree"], headBox.getPosition());
        });
        addTextLayer();
        addLayer ("picker", getLocalBounds().toFloat(), [this] (juce::Graphics& g) { drawPicker (g); });
        render();
    }

    void render()
    {
        // In Rows, the header is the page's Rows header, drawn over.
        if (auto* mh = node ("#wvMxCount"))
        {
            juce::ignoreUnused (mh);
            for (auto* n : nodes ("wv-mh"))
                if (face::findNode (*n, "#wvMxCount") != nullptr)
                {
                    const int i = (int) (*n)["i"];
                    const bool was = chrome.skip.count (i) > 0;
                    if (rows != was)
                    {
                        if (rows)
                            chrome.skip.insert (i);
                        else
                            chrome.skip.erase (i);
                        chrome.redraw (face::rectOf (*n).expanded (2));
                    }
                }
        }
        say ("wvMxCount", juce::String ((int) model().mods.size()) + " of 64");
        // The kept grid changes only with its columns (the FX board's) and the view.
        const auto sig = juce::String (rows ? "r" : "p") + juce::String (scroll) + juce::String ((int) boardKeys().size()) + (rows ? juce::String ((int) model().mods.size()) : juce::String())
                         + (rows ? juce::String (rowScroll) : juce::String());
        if (sig != gridSig || rows)
        {
            gridSig = sig;
            again ("grid");
        }
        juce::ignoreUnused (gridCache);
        again ("live");
        again ("head");
    }

    // ── the pins ─────────────────────────────────────────────────────────

    std::vector<juce::String> boardKeys()
    {
        std::vector<juce::String> out;
        for (const auto& r : model().mods)
            if (r.dst.startsWith ("board:") && std::find (out.begin(), out.end(), r.dst) == out.end())
                out.push_back (r.dst);
        return out;
    }

    float boardColW (int n) const { return juce::jmax (24.0f, std::ceil ((8 * 6.2f + 12) / (float) juce::jmax (1, n))); }

    float contentW()
    {
        const auto bk = boardKeys();
        return bk.empty() ? gridW : boardX + boardColW ((int) bk.size()) * (float) bk.size();
    }

    // A column's place: a captured target's, or one of the FX BOARD group's.
    juce::Rectangle<float> column (const juce::String& dst)
    {
        if (auto it = colX.find (dst); it != colX.end())
            return it->second;
        const auto bk = boardKeys();
        for (size_t i = 0; i < bk.size(); ++i)
            if (bk[i] == dst && boardLab != nullptr)
            {
                const float w = boardColW ((int) bk.size());
                const auto r = face::rectOf (*boardLab);
                return { boardX + w * (float) i, r.getY(), w, r.getHeight() };
            }
        return {};
    }

    struct Hole
    {
        juce::String src, dst;
        juce::Rectangle<float> r;   // on the page, scrolled
    };
    std::optional<Hole> holeAt (juce::Point<float> at)
    {
        if (!pinsBox.contains (at))
            return std::nullopt;
        const auto p = at - pinsAt + juce::Point<float> (scroll, 0);
        if (p.x - scroll < 92)
            return std::nullopt;
        for (const auto& entry : rowY)
        {
            const auto& src = entry.first;
            const auto& ry = entry.second;
            if (p.y < ry.getY() || p.y >= ry.getBottom())
                continue;
            auto find = [&] (const juce::String& dst, juce::Rectangle<float> col) -> std::optional<Hole> {
                if (p.x >= col.getX() && p.x < col.getRight())
                    return Hole { src, dst, juce::Rectangle<float> (col.getX() - scroll, ry.getY(), col.getWidth(), ry.getHeight()) + pinsAt };
                return std::nullopt;
            };
            for (const auto& [dst, col] : colX)
                if (auto h = find (dst, col))
                    return h;
            for (const auto& dst : boardKeys())
                if (auto h = find (dst, column (dst)))
                    return h;
        }
        return std::nullopt;
    }

    int modAt (const juce::String& src, const juce::String& dst)
    {
        for (int i = 0; i < (int) model().mods.size(); ++i)
            if (model().mods[(size_t) i].src == src && model().mods[(size_t) i].dst == dst)
                return i;
        return -1;
    }

    void scrollTo (float x)
    {
        scroll = juce::jlimit (0.0f, juce::jmax (0.0f, contentW() - pinsBox.getWidth()), x);
        again ("grid");
        again ("live");
    }

    // wvPagePins: on to the first group not wholly in view, or back by as
    // many as fill the width.
    void page (int dir)
    {
        std::vector<float> gx;
        for (const auto& G : wave::targetGroups (model()))
            if (auto it = bandX.find (G.g); it != bandX.end())
                gx.push_back (it->second - 92);
        if (gx.empty())
            return;
        std::sort (gx.begin(), gx.end());
        const int n = (int) gx.size();
        int gi = 0;
        for (int g = 0; g < n; ++g)
            if (gx[(size_t) g] <= scroll + 2)
                gi = g;
        const float cw = pinsBox.getWidth();
        if (dir > 0)
        {
            const float right = scroll + cw - 92;
            int g = gi;
            while (g < n - 1 && gx[(size_t) g + 1] < right - 24)
                ++g;
            gi = juce::jmax (gi + 1, g);
        }
        else
        {
            int g = gi;
            while (g > 0 && scroll - gx[(size_t) g - 1] < cw - 92)
                --g;
            gi = juce::jmin (gi - 1, g);
        }
        scrollTo (gx[(size_t) juce::jlimit (0, n - 1, gi)]);
    }

    bool pinsDown (const juce::MouseEvent& e)
    {
        const auto at = e.position;
        // A band brings its group to the front.
        if (pinsBox.contains (at) && at.y - pinsAt.y < 16)
        {
            const float x = at.x - pinsAt.x + scroll;
            float best = -1;
            for (const auto& [name, bx] : bandX)
                if (bx <= x && bx > best)
                    best = bx;
            if (best >= 0)
                scrollTo (best - 92);
            return true;
        }
        // A row head is a source to drag onto a control.
        for (const auto& [src, ry] : rowY)
            if (juce::Rectangle<float> (pinsAt.x, pinsAt.y + ry.getY(), 92, ry.getHeight()).contains (at))
            {
                if (startMapping)
                    startMapping (src, e);
                return true;
            }
        auto h = holeAt (at);
        if (!h)
            return false;
        const auto src = h->src, dst = h->dst;
        auto moved = std::make_shared<bool> (false);
        auto raw = std::make_shared<float> (modAt (src, dst) >= 0 ? model().mods[(size_t) modAt (src, dst)].amt : 0.0f);
        drag = [this, src, dst, moved, raw] (const juce::MouseEvent& ev) {
            const float dy = ev.position.y - last.y;
            if (dy == 0.0f)
                return;
            *moved = true;
            int i = modAt (src, dst);
            if (i < 0)
            {
                if (model().mods.size() >= 64)
                    return;
                model().mods.push_back ({ src, dst, 0, "lin", {}, false });
                i = (int) model().mods.size() - 1;
            }
            *raw = clampf (*raw - dy / (ev.mods.isShiftDown() ? 400.0f : 80.0f), -1, 1);
            model().mods[(size_t) i].amt = wave::snapAmt (model(), dst, *raw);
            again ("live");
        };
        dragEnd = [this, src, dst, moved] {
            if (!*moved && modAt (src, dst) < 0 && model().mods.size() < 64)
            {
                const float st = wave::choiceStep (model(), dst);
                model().mods.push_back ({ src, dst, st > 0 ? st : 0.25f, "lin", {}, false });
            }
            changedRows();
        };
        return true;
    }

    void changedRows()
    {
        if (ctx.modsChanged)
            ctx.modsChanged();
        tiles->sync();
        render();
    }

    void drawPins (juce::Graphics& g, bool live)
    {
        juce::Graphics::ScopedSaveState keep (g);
        g.reduceClipRegion (pinsBox.getSmallestIntegerContainer());
        if (live)
            return drawPinsLive (g);
        const auto bk = boardKeys();
        auto stampAt = [&] (const juce::var& n, juce::Point<float> to, const std::function<bool (const juce::var&, juce::String&)>& text = nullptr) {
            face::Stamp s;
            s.text = text;
            s.skip = [] (const juce::var& k) { return face::matches (k, "pin") && false; };
            s.draw (g, n, to - face::rectOf (n).getPosition());
        };
        // What scrolls: the bands, the labels, the holes.
        for (const auto& c : cells)
        {
            if (c.sticky)
                continue;
            const auto r = face::rectOf (*c.n);
            if (r.getRight() - scroll < 92 - 30 || r.getX() - scroll > pinsBox.getWidth() + 30)
                continue;
            if (face::matches (*c.n, "wv-hole") && face::matches (*c.n, "pin"))
            {
                // A captured pin: here an empty hole, unless the patch has one.
                drawHole (g, *c.n, r.getPosition() - juce::Point<float> (scroll, 0) + pinsAt);
                continue;
            }
            stampAt (*c.n, r.getPosition() - juce::Point<float> (scroll, 0) + pinsAt);
        }
        // The FX board's group: its band, a column for every board control a row moves.
        if (!bk.empty() && boardBand != nullptr && boardLab != nullptr)
        {
            const float w = boardColW ((int) bk.size());
            const auto band = face::rectOf (*boardBand);
            const auto bandR = juce::Rectangle<float> (boardX - scroll, band.getY(), w * (float) bk.size(), band.getHeight()) + pinsAt;
            face::paintBox (g, *boardBand, bandR);
            face::paintText (g, *boardBand, bandR.withTrimmedLeft (5), "FX BOARD");
            for (size_t i = 0; i < bk.size(); ++i)
            {
                const auto lr = face::rectOf (*boardLab);
                const auto to = juce::Point<float> (boardX + w * (float) i - scroll, lr.getY()) + pinsAt;
                // The label: the control's own short name, turned.
                face::Stamp s;
                const auto name = wave::boardDstName (model(), bk[i], true);
                s.text = [name] (const juce::var& n, juce::String& out) { if (n["tag"].toString() != "span") return false; out = name; return true; };
                juce::Graphics::ScopedSaveState k2 (g);
                g.addTransform (juce::AffineTransform::scale (w / lr.getWidth(), 1.0f, to.x, to.y));
                s.draw (g, *boardLab, to - lr.getPosition());
                for (const auto& [src, ry] : rowY)
                    if (auto it = boardHole.find (src); it != boardHole.end())
                        drawHole (g, *it->second, juce::Point<float> (to.x, ry.getY() + pinsAt.y), true);
            }
        }
        // What stays: the corner and the sources' heads.
        for (const auto& c : cells)
            if (c.sticky)
                stampAt (*c.n, face::rectOf (*c.n).getPosition() + pinsAt);
    }

    void drawPinsLive (juce::Graphics& g)
    {
        const auto sig = [this] (const wave::Model::Mod& r) { return wave::srcVal (model(), r.src) * (r.via.isNotEmpty() ? wave::srcVal (model(), r.via) : 1.0f); };
        {
        juce::Graphics::ScopedSaveState clip (g);
        g.reduceClipRegion (juce::Rectangle<float> (pinsAt.x + 92, pinsBox.getY(), pinsBox.getWidth() - 92, pinsBox.getHeight()).getSmallestIntegerContainer());
        // The pins the patch has.
        for (const auto& r : model().mods)
        {
            auto ry = rowY.find (r.src);
            const auto col = column (r.dst);
            if (ry == rowY.end() || col.isEmpty())
                continue;
            const auto cell = juce::Rectangle<float> (col.getX() - scroll, ry->second.getY(), col.getWidth(), ry->second.getHeight()) + pinsAt;
            if (cell.getRight() < pinsAt.x + 92)
                continue;
            const auto* tpl = (r.off ? pinOff : pinOn)[r.src];
            if (tpl == nullptr)
                continue;
            const auto* b = face::findNode (*tpl, "b");
            if (b == nullptr)
                continue;
            const float o = r.off ? 0.0f : 0.25f + 0.75f * clampf (std::abs (sig (r)));
            drawPin (g, *b, cell, wave::rowAmtTxt (model(), r), o, r.off, r.src);
        }
        }
        // The sources' heads' pictures and lights.
        for (const auto& c : cells)
            if (c.sticky)
            {
                if (face::matches (*c.n, "wv-rh"))
                {
                    const auto src = (*c.n)["data"]["src"].toString();
                    if (auto* cv = face::findNode (*c.n, "canvas"))
                    {
                        const auto cr = face::rectOf (*cv) + pinsAt;
                        juce::Graphics::ScopedSaveState k3 (g);
                        g.addTransform (juce::AffineTransform::translation (cr.getX(), cr.getY()));
                        c2d::Context cc (g, cr.getWidth(), cr.getHeight());
                        wave::drawTilePic (cc, cr.getWidth(), cr.getHeight(), cl(), model(), src);
                    }
                    // Whether it moves anything now (.act).
                    bool used = false;
                    for (const auto& m : model().mods)
                        used = used || (m.src == src && !m.off);
                    if (used)
                        if (auto* a = face::findNode (*c.n, "act"))
                        {
                            const float o = 0.3f + 0.7f * std::abs (wave::srcVal (model(), src));
                            const auto col = c2d::css (wave::sourceColour (src));
                            juce::Path dot;
                            dot.addEllipse (face::rectOf (*a) + pinsAt);
                            g.beginTransparencyLayer (o);
                            juce::DropShadow (col, 5, {}).drawForPath (g, dot);
                            g.setColour (col);
                            g.fillPath (dot);
                            g.endTransparencyLayer();
                        }
                }
            }
    }

    // An empty hole (its socket), from a captured one, wherever it goes.
    void drawHole (juce::Graphics& g, const juce::var& hole, juce::Point<float> to, bool boardColumn = false)
    {
        // A captured empty hole of the same row's look: the socket is the
        // made-real ::before; a captured pin has none, so its row's empty
        // neighbour is used.
        const juce::var* empty = nullptr;
        const auto src = hole["data"]["s"].toString();
        for (const auto& c : cells)
            if (face::matches (*c.n, "wv-hole") && !face::matches (*c.n, "pin") && (*c.n)["data"]["s"].toString() == src
                && face::matches (*c.n, "g0") == face::matches (hole, "g0"))
            {
                empty = c.n;
                break;
            }
        if (empty == nullptr)
            return;
        face::Stamp s;
        const auto er = face::rectOf (*empty), hr = face::rectOf (hole);
        juce::ignoreUnused (boardColumn);
        juce::Graphics::ScopedSaveState keep (g);
        if (std::abs (er.getWidth() - hr.getWidth()) > 0.5f)
            g.addTransform (juce::AffineTransform::scale (hr.getWidth() / er.getWidth(), 1.0f, to.x, to.y));
        s.draw (g, *empty, to - er.getPosition());
    }

    // A pin (.wv-hole.pin b): the amount in a pill in its source's colour,
    // brighter and glowing as far as the source moves it now (--o).
    void drawPin (juce::Graphics& g, const juce::var& b, juce::Rectangle<float> cell, const juce::String& text, float o, bool off, const juce::String& src)
    {
        const auto& run = b["text"][0];
        const auto f = face::font (run["font"]);
        const float w = juce::GlyphArrangement::getStringWidth (f, text) + 2 + 2;
        const float h = face::rectOf (b).getHeight();
        const auto r = juce::Rectangle<float> (w, h).withCentre (cell.getCentre());
        const auto c = c2d::css (wave::sourceColour (src));
        // Its fill, from the captured one: the source's colour over the lit socket.
        const auto cap0 = face::colour (b["bg"]);
        const float at = 0.12f + 0.25f * 0.22f;
        auto socket = [&] (int ch, int cc) { return juce::jlimit (0, 255, juce::roundToInt (((float) ch - at * (float) cc) / (1 - at))); };
        const auto lit = juce::Colour ((juce::uint8) socket (cap0.getRed(), c.getRed()), (juce::uint8) socket (cap0.getGreen(), c.getGreen()), (juce::uint8) socket (cap0.getBlue(), c.getBlue()));
        const auto fill = lit.interpolatedWith (c, 0.12f + o * 0.22f);
        juce::Graphics::ScopedSaveState keep (g);
        if (off)
            g.beginTransparencyLayer (0.4f);
        juce::Path pill;
        pill.addRoundedRectangle (r, h / 2);
        if (!off && o > 0)
            juce::DropShadow (c, juce::roundToInt (o * 8), {}).drawForPath (g, pill);
        g.setColour (fill);
        g.fillPath (pill);
        g.setColour (c);
        g.strokePath (pill, juce::PathStrokeType (1));
        g.setFont (f);
        juce::GlyphArrangement ga;
        ga.addLineOfText (f, text, r.getX() + 2, r.getCentreY() + (f.getAscent() - f.getDescent()) / 2);
        ga.draw (g);
        if (off)
            g.endTransparencyLayer();
    }

    // ── the rows ─────────────────────────────────────────────────────────

    float rowsHeight() const { return (float) juce::jmin ((int) ctx.model->mods.size(), 64) * 30 + (ctx.model->mods.size() < 64 ? 30 : 0) + (float) juce::jmax (0, 63 - (int) ctx.model->mods.size()) * 22; }

    float rowTop (int r) const { return rowsBox.getY() + (float) r * 30 - rowScroll; }

    juce::Rectangle<float> rowCell (int r, const juce::String& which)
    {
        const auto* tpl = rowOn.empty() ? nullptr : rowOn.begin()->second;
        if (tpl == nullptr)
            return {};
        const juce::var* n = nullptr;
        if (which == "power")
            n = face::findNode (*tpl, "wv-pwr");
        else if (which == "s" || which == "t" || which == "v")
            n = face::findNode (*tpl, "data-pk=" + which);
        else if (which == "amount")
            n = face::findNode (*tpl, "wv-well");
        else if (which == "curve")
        {
            auto wells = face::findAll (*tpl, "wv-well");
            n = wells.size() > 1 ? wells[1] : nullptr;
        }
        else if (which == "remove")
            n = face::findNode (*tpl, "data-rm");
        if (n == nullptr)
            return {};
        const auto tr = face::rectOf (*tpl), nr = face::rectOf (*n);
        return nr.withPosition (rowsAt.x + nr.getX(), rowTop (r) + (nr.getY() - tr.getY()));
    }

    bool rowsDown (const juce::MouseEvent& e)
    {
        const auto at = e.position;
        if (!rowsBox.contains (at))
            return false;
        auto& mods = model().mods;
        for (int r = 0; r < (int) mods.size(); ++r)
        {
            if (rowCell (r, "power").contains (at))
            {
                mods[(size_t) r].off = !mods[(size_t) r].off;
                changedRows();
                return true;
            }
            if (rowCell (r, "remove").contains (at))
            {
                mods.erase (mods.begin() + r);
                changedRows();
                return true;
            }
            if (rowCell (r, "curve").contains (at))
            {
                auto& c = mods[(size_t) r].curve;
                const auto& ks = wave::curves();
                c = ks[(ks.indexOf (c) + 1) % ks.size()];
                changedRows();
                return true;
            }
            if (rowCell (r, "amount").contains (at))
            {
                auto raw = std::make_shared<float> (mods[(size_t) r].amt);
                drag = [this, r, raw] (const juce::MouseEvent& ev) {
                    const float dx = ev.position.x - last.x;
                    auto& m = model().mods[(size_t) r];
                    *raw = clampf (*raw + dx / (ev.mods.isShiftDown() ? 600.0f : 120.0f), -1, 1);
                    m.amt = wave::snapAmt (model(), m.dst, *raw);
                    again ("live");
                };
                dragEnd = [this] { changedRows(); };
                return true;
            }
            for (const juce::String k : { "s", "t", "v" })
                if (rowCell (r, k).contains (at))
                {
                    openPicker (k, r, rowCell (r, k));
                    return true;
                }
        }
        // The add row's pickers.
        if (mods.size() < 64 && addRow != nullptr)
            for (const juce::String k : { "s", "t", "v" })
                if (auto* n = face::findNode (*addRow, "data-pk=" + k))
                {
                    const auto nr = face::rectOf (*n), tr = face::rectOf (*addRow);
                    const auto cellR = nr.withPosition (rowsAt.x + nr.getX(), rowTop ((int) mods.size()) + (nr.getY() - tr.getY()));
                    if (cellR.contains (at))
                    {
                        openPicker (k, -1, cellR);
                        return true;
                    }
                }
        return false;
    }

    // The row under construction in the add row's slot (WV_DRAFT).
    juce::String draftSrc, draftDst, draftVia;

    void drawRows (juce::Graphics& g, bool live)
    {
        if (live)
            return drawRowsLive (g);
        if (rowsHead != nullptr)
            face::Stamp().draw (g, *rowsHead, rowsAt);
        juce::Graphics::ScopedSaveState keep (g);
        g.reduceClipRegion (rowsBox.getSmallestIntegerContainer());
        const auto& mods = model().mods;
        const auto groups = wave::targetGroups (model());
        auto groupOf = [&] (const juce::String& t) {
            for (const auto& G : groups)
                for (const auto& k : G.ks)
                    if (k.key == t)
                        return G.g;
            return juce::String();
        };
        for (int r = 0; r < (int) mods.size() && r < 64; ++r)
        {
            const auto& m = mods[(size_t) r];
            const auto* tpl = (m.off ? rowOff : rowOn)[m.src];
            if (tpl == nullptr)
                continue;
            const float y = rowTop (r);
            if (y > rowsBox.getBottom() || y + 30 < rowsBox.getY())
                continue;
            const auto tr = face::rectOf (*tpl);
            const auto off = juce::Point<float> (rowsAt.x, y) - tr.getPosition();
            // The × source: the via's own pill, from that source's row.
            const juce::var* viaTpl = m.via.isNotEmpty() && rowOn.count (m.via) > 0 ? face::findNode (*rowOn[m.via], "data-pk=v") : nullptr;
            const juce::var* noVia = nullptr;
            for (auto& [k, row] : rowOff)
                if (noVia == nullptr)
                    noVia = face::findNode (*row, "data-pk=v");
            face::Stamp s;
            s.text = [&] (const juce::var& n, juce::String& out) {
                if (face::matches (n, "wv-ro"))
                {
                    out = juce::String (r + 1);
                    return true;
                }
                return false;
            };
            s.skip = [&] (const juce::var& n) { return face::matches (n, "data-pk=v") || face::matches (n, "data-pk=t"); };
            s.draw (g, *tpl, off);
            // The target: its name, and its group's.
            if (auto* t = face::findNode (*tpl, "data-pk=t"))
            {
                face::Stamp ts;
                const auto name = wave::targetName (model(), m.dst), gname = groupOf (m.dst);
                ts.text = [&] (const juce::var& n, juce::String& out) {
                    if (face::matches (n, "gname"))
                        return (out = gname), true;
                    if (n["tag"].toString() == "span" && !face::matches (n, "wv-pk"))
                        return (out = name), true;
                    return false;
                };
                ts.draw (g, *t, off);
            }
            const auto* vt = viaTpl != nullptr ? viaTpl : noVia;
            if (vt != nullptr)
            {
                const auto vr = face::rectOf (*vt), want = face::rectOf (*face::findNode (*tpl, "data-pk=v"));
                face::Stamp vs;
                vs.draw (g, *vt, juce::Point<float> (rowsAt.x + want.getX(), y + (want.getY() - tr.getY())) - vr.getPosition());
            }
        }
        // The next free slot, then the empty ones.
        int r = (int) mods.size();
        if (r < 64 && addRow != nullptr)
        {
            const auto tr = face::rectOf (*addRow);
            const float y = rowTop (r);
            face::Stamp s;
            s.text = [&] (const juce::var& n, juce::String& out) {
                if (face::matches (n, "wv-ro"))
                    return (out = juce::String (r + 1)), true;
                if (face::matches (n, "wv-hint") && n["text"][0]["text"].toString().startsWith ("pick a source"))
                    return (out = draftSrc.isNotEmpty() || draftDst.isNotEmpty() ? juce::String ("pick the other one") : n["text"][0]["text"].toString()), true;
                // What has been picked so far is named on its button.
                const auto was = n["text"][0]["text"].toString();
                if (face::matches (n, "wv-hint") && was.startsWith ("Source") && draftSrc.isNotEmpty())
                    return (out = wave::srcName (model(), draftSrc)), true;
                if (face::matches (n, "wv-hint") && was.startsWith ("Target") && draftDst.isNotEmpty())
                    return (out = wave::targetName (model(), draftDst)), true;
                if (face::matches (n, "wv-hint") && was.startsWith (juce::String::fromUTF8 ("\xc3\x97")) && draftVia.isNotEmpty())
                    return (out = juce::String::fromUTF8 ("\xc3\x97 ") + wave::srcName (model(), draftVia)), true;
                return false;
            };
            s.draw (g, *addRow, juce::Point<float> (rowsAt.x, y) - tr.getPosition());
            ++r;
        }
        if (emptyRow != nullptr)
        {
            const auto tr = face::rectOf (*emptyRow);
            float y = rowTop ((int) mods.size()) + (mods.size() < 64 ? 30.0f : 0.0f);
            for (; r < 64; ++r, y += 22)
            {
                if (y > rowsBox.getBottom())
                    break;
                face::Stamp s;
                s.text = [r] (const juce::var& n, juce::String& out) { if (!face::matches (n, "wv-ro")) return false; out = juce::String (r + 1); return true; };
                s.draw (g, *emptyRow, juce::Point<float> (rowsAt.x, y) - tr.getPosition());
            }
        }
    }

    // What moves in the rows: each source's picture, its amount and its curve with the engine's dots.
    void drawRowsLive (juce::Graphics& g)
    {
        juce::Graphics::ScopedSaveState keep (g);
        g.reduceClipRegion (rowsBox.getSmallestIntegerContainer());
        const auto& mods = model().mods;
        for (int r = 0; r < (int) mods.size() && r < 64; ++r)
        {
            const auto& m = mods[(size_t) r];
            const auto* tpl = (m.off ? rowOff : rowOn)[m.src];
            if (tpl == nullptr)
                continue;
            const float y = rowTop (r);
            if (y > rowsBox.getBottom() || y + 30 < rowsBox.getY())
                continue;
            const auto off = juce::Point<float> (rowsAt.x, y) - face::rectOf (*tpl).getPosition();
            if (auto* sp = face::findNode (*tpl, "data-pk=s"))
                if (auto* cv = face::findNode (*sp, "canvas"))
                {
                    const auto cr = face::rectOf (*cv) + off;
                    juce::Graphics::ScopedSaveState k2 (g);
                    g.addTransform (juce::AffineTransform::translation (cr.getX(), cr.getY()));
                    c2d::Context c (g, cr.getWidth(), cr.getHeight());
                    wave::drawTilePic (c, cr.getWidth(), cr.getHeight(), cl(), model(), m.src);
                }
            drawAmount (g, rowCell (r, "amount"), m);
            drawCurve (g, rowCell (r, "curve"), m);
        }
    }

    void drawAmount (juce::Graphics& g, juce::Rectangle<float> a, const wave::Model::Mod& m)
    {
        if (a.isEmpty())
            return;
        juce::Graphics::ScopedSaveState keep (g);
        g.addTransform (juce::AffineTransform::translation (a.getX(), a.getY()));
        c2d::Context ac (g, a.getWidth(), a.getHeight());
        const float W = a.getWidth(), H = a.getHeight(), mid = W / 2;
        const auto col = c2d::css (wave::sourceColour (m.src));
        ac.setFill ("rgba(255,255,255,.06)");
        ac.fillRect (8, H / 2 - 0.5f, W - 16, 1);
        ac.setFill ("rgba(255,255,255,.22)");
        ac.fillRect (mid - 0.5f, 4, 1, H - 8);
        ac.globalAlpha = m.off ? 0.35f : 1.0f;
        ac.fillStyle = col;
        ac.shadowBlur = 6;
        ac.shadowColor = col;
        const float x2 = mid + m.amt * (W / 2 - 40);
        ac.fillRect (juce::jmin (mid, x2), H / 2 - 3, std::abs (x2 - mid), 6);
        ac.shadowBlur = 0;
        if (!m.off && ctx.model->tele.isObject())
        {
            const float sig = wave::srcVal (model(), m.src) * (m.via.isNotEmpty() ? wave::srcVal (model(), m.via) : 1.0f);
            wave::dot (ac, mid + clampf (m.amt * sig, -1, 1) * (W / 2 - 40), H / 2, 2.6f, juce::Colours::white);
        }
        ac.fillStyle = col;
        ac.font = "10px mono";
        ac.textAlign = m.amt < 0 ? "left" : "right";
        ac.fillText (wave::rowAmtTxt (model(), m), m.amt < 0 ? 6 : W - 6, H / 2 + 3.5f);
        ac.textAlign = "left";
        ac.globalAlpha = 1;
    }

    void drawCurve (juce::Graphics& g, juce::Rectangle<float> a, const wave::Model::Mod& m)
    {
        if (a.isEmpty())
            return;
        juce::Graphics::ScopedSaveState keep (g);
        g.addTransform (juce::AffineTransform::translation (a.getX(), a.getY()));
        const float w = a.getWidth(), h = a.getHeight();
        c2d::Context c (g, w, h);
        wave::trace (c, wave::path ([&] (float u) { return juce::Point<float> (4 + u * (w - 8), h - 4 - wave::curveAt (m.curve, u) * (h - 8)); }, 40), cl(), 1.2f, 0.4f);
        if (ctx.model->tele.isObject())
        {
            const float raw = wave::srcVal (model(), m.src), sv = clampf (m.src.startsWith ("lfo") ? (raw + 1) / 2 : raw);
            wave::dot (c, 4 + sv * (w - 8), h - 4 - wave::curveAt (m.curve, sv) * (h - 8), 2.4f, cl().acc);
        }
    }

    // ── the pickers ──────────────────────────────────────────────────────

    juce::String picker;          // "s" "t" "v", or empty
    int pickerRow = -1;
    juce::Rectangle<float> pickerR, pickerFrom;

    void openPicker (const juce::String& kind, int row, juce::Rectangle<float> from)
    {
        if (picker == kind && pickerRow == row)
            return closePicker();
        picker = kind;
        pickerRow = row;
        pickerFrom = from;
        const auto& part = kind == "t" ? pickTgtPart : pickSrcPart;
        const float w = (float) (double) part["root"][2], h = (float) (double) part["root"][3];
        // wvPlaceMenu: under it, inside the page; above it if it would run off.
        const float left = juce::jmax (8.0f, juce::jmin ((float) getWidth() - w - 8, from.getX()));
        float top = from.getBottom() + 6;
        if (top + h > (float) getHeight() - 8)
            top = juce::jmax (8.0f, from.getY() - h - 6);
        pickerR = { left, top, w, h };
        again ("picker");
    }

    void closePicker()
    {
        picker.clear();
        pickerRow = -1;
        again ("picker");
    }

    void drawPicker (juce::Graphics& g)
    {
        if (picker.isEmpty())
            return;
        const auto& part = picker == "t" ? pickTgtPart : pickSrcPart;
        const auto& tree = part["tree"];
        const auto off = pickerR.getPosition();
        if (picker != "t")
        {
            face::Stamp s;
            // The source picker has "× none" only for a × source.
            s.skip = [this] (const juce::var& n) { return picker == "s" && face::matches (n, "none"); };
            s.draw (g, tree, off);
            return;
        }
        juce::String cur = pickerRow >= 0 ? model().mods[(size_t) pickerRow].dst : draftDst;
        const bool board = !boardKeys().empty();
        face::Stamp s;
        s.skip = [board] (const juce::var& n) { return !board && face::matches (n, "wv-pmg") && n["kids"][0]["text"][0]["text"].toString() == "FX BOARD"; };
        s.draw (g, tree, off);
        // The one it has now, outlined in its group's colour.
        for (auto* grp : face::findAll (tree, "wv-pmg"))
            if (auto* kids = (*grp)["kids"].getArray())
                for (auto& k : *kids)
                    if (k["data"]["v"].toString() == cur && cur.isNotEmpty())
                    {
                        const auto col = face::colour ((*kids)[0]["text"][0]["font"]["colour"]);
                        g.setColour (col);
                        g.drawRoundedRectangle (face::rectOf (k).translated (off.x, off.y).reduced (0.5f), 3, 1);
                    }
    }

    void pickAt (juce::Point<float> at)
    {
        const auto& part = picker == "t" ? pickTgtPart : pickSrcPart;
        const auto p = at - pickerR.getPosition();
        juce::String chosen;
        bool hit = false;
        walk (part["tree"], [&] (const juce::var& n) {
            if (!hit && n["data"]["v"].isString() && face::rectOf (n).contains (p))
                chosen = n["data"]["v"].toString(), hit = true;
        });
        if (!hit || (picker == "s" && chosen.isEmpty()))
            return;
        const auto kind = picker;
        const int row = pickerRow;
        closePicker();
        auto& mods = model().mods;
        if (row >= 0 && row < (int) mods.size())
        {
            auto& m = mods[(size_t) row];
            if (kind == "s")
                m.src = chosen;
            else if (kind == "t")
            {
                m.dst = chosen;
                const float st = wave::choiceStep (model(), chosen);
                if (st > 0)
                {
                    const float snapped = wave::snapAmt (model(), chosen, m.amt);
                    m.amt = snapped != 0.0f ? snapped : st;
                }
            }
            else
                m.via = chosen;
        }
        else
        {
            (kind == "s" ? draftSrc : kind == "t" ? draftDst : draftVia) = chosen;
            if (draftSrc.isNotEmpty() && draftDst.isNotEmpty())
            {
                const float st = wave::choiceStep (model(), draftDst);
                const float amt = st > 0 ? st : 0.3f;
                if (auto i = modAt (draftSrc, draftDst); i >= 0)
                    mods[(size_t) i].amt = amt;
                else
                    mods.push_back ({ draftSrc, draftDst, amt, "lin", draftVia, false });
                draftSrc.clear();
                draftDst.clear();
                draftVia.clear();
            }
        }
        changedRows();
    }
};
} // namespace

std::unique_ptr<WaveView> makeWaveMatrix (WaveCtx& c, const juce::var& captured)
{
    return std::make_unique<WaveMatrix> (c, captured);
}

void setMatrixMapping (WaveView& v, std::function<void (const juce::String&, const juce::MouseEvent&)> f)
{
    if (auto* m = dynamic_cast<WaveMatrix*> (&v))
        m->startMapping = std::move (f);
}

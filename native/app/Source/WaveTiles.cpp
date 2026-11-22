#include "WaveTiles.h"

namespace
{
float clampf (float v, float a = 0, float b = 1) { return juce::jlimit (a, b, v); }

const std::map<juce::String, juce::String>& shapeGlyphs()
{
    static const std::map<juce::String, juce::String> g {
        { "sine", "M1 7 C3 0,6 0,8 7 S13 14,15 7" }, { "tri", "M1 7 L4.5 1 L11.5 13 L15 7" }, { "up", "M1 13 L14 1 V13" },
        { "down", "M1 1 L14 13 V1" }, { "square", "M1 2 H8 V12 H15" }, { "steps", "M1 9 H4 V3 H7 V11 H10 V5 H13 V8 H15" },
        { "smooth", "M1 9 C3 9,3 3,5 3 S7 11,9 11 S12 5,15 6" }, { "drawn", "M1 10 L4 4 L8 8 L11 2 L15 9" },
    };
    return g;
}

juce::String fmtC (float s)
{
    return s < 1 ? juce::String (juce::roundToInt (s * 1000)) + "ms" : juce::String (s, 2) + "s";
}

juce::var bare (const juce::var& n)
{
    auto b = n.clone();
    if (auto* o = b.getDynamicObject())
        for (auto k : { "bg", "layers", "border", "shadows", "kids", "svg" })
            o->removeProperty (k);
    return b;
}
} // namespace

WaveTiles::WaveTiles (Host host, const juce::String& prefix) : h (std::move (host)), P (prefix)
{
    build();
}

void WaveTiles::build()
{
    for (auto* t : face::findAll (h.tree, "wv-tile"))
    {
        if ((*t)["data"]["p"].toString() != P)
            continue;
        Tile tile;
        tile.src = (*t)["data"]["tile"].toString();
        tile.node = *t;
        if (auto* n = face::findNode (*t, "wv-tgts"))
            tile.tgts = *n;
        if (auto* n = face::findNode (*t, "wv-grab"))
            tile.grab = *n;
        if (auto* th = face::findNode (*t, "wv-th"))
            if (auto* n = face::findNode (*th, "act"))
                tile.act = *n, h.chrome->skip.insert ((int) (*n)["i"]);
        if (auto* n = face::findNode (*t, "data-lshape"))
        {
            tile.lshape = *n;
            if (auto* s = face::findNode (*n, "svg"))
                tile.lshapeSvg = *s, h.chrome->skip.insert ((int) (*s)["i"]);
        }
        if (auto* seg = face::findNode (*t, "data-lmode"))
            if (auto* kids = (*seg)["kids"].getArray())
                for (auto& k : *kids)
                    tile.modes.add (&k);
        if (auto* seg = face::findNode (*t, "data-lsync"))
            if (auto* kids = (*seg)["kids"].getArray())
                for (auto& k : *kids)
                    tile.syncs.add (&k);
        if (tile.src == "amp" && tile.tgts.isObject())
            if (auto* k = face::findNode (tile.tgts, "wv-tg"))
                tgTemplate = k;
        for (auto* rd : face::findAll (*t, "wv-rd"))
        {
            Reading r;
            r.key = (*rd)["data"]["tgt"].toString();
            const bool env = (*rd)["data"]["env"].isString();
            r.kind = env ? (*rd)["data"]["k"].toString() : (*rd)["data"]["lk"].toString();
            r.src = tile.src;
            r.r = face::rectOf (*rd);
            r.node = *rd;
            if (auto* b = face::findNode (*rd, "b"))
                r.b = (int) (*b)["i"], h.chrome->skipText.insert (r.b);
            if (auto* bar = face::findNode (*rd, "bar"))
                r.bar = face::rectOf (*bar), h.chrome->skip.insert ((int) (*bar)["i"]);
            readings.push_back (r);
        }
        for (const auto& id : juce::StringArray { "wv" + P + "ev" + tile.src, "wv" + P + "lv" + tile.src })
            if (auto it = h.chrome->canvases.find (id); it != h.chrome->canvases.end())
                tile.pic = face::rectOf (it->second);
        tiles.push_back (tile);
    }

    // The pictures.
    for (const juce::String s : { "amp", "env1", "env2", "env3" })
    {
        const auto id = "wv" + P + "ev" + s;
        auto it = h.chrome->canvases.find (id);
        if (it == h.chrome->canvases.end())
            continue;
        const auto r = face::rectOf (it->second);
        pics[s] = h.addLayer (id, r, [this, s, r] (juce::Graphics& g) {
            c2d::Context c (g, r.getWidth(), r.getHeight());
            const auto C = s == "amp" ? cl() : wave::sourceCl (cl(), s);
            std::vector<std::pair<char, float>> vs;
            if (s == "amp")
                for (const auto& v : wave::voices (m()))
                    vs.push_back ({ v.stage, v.env });
            wave::drawEnv (c, r.getWidth(), r.getHeight(), C, m().g (s + ".a"), m().g (s + ".d"), m().g (s + ".s"), m().g (s + ".r"), &vs);
        });
    }
    for (int L = 0; L < 4; ++L)
    {
        const auto s = "lfo" + juce::String (L);
        const auto id = "wv" + P + "lv" + s;
        auto it = h.chrome->canvases.find (id);
        if (it == h.chrome->canvases.end())
            continue;
        const auto r = face::rectOf (it->second);
        pics[s] = h.addLayer (id, r, [this, s, r, L] (juce::Graphics& g) {
            const float w = r.getWidth(), hh = r.getHeight();
            c2d::Context c (g, w, hh);
            const auto C = wave::sourceCl (cl(), s);
            wave::drawLfo (c, w, hh, C, m(), L);
            const float rise = m().g (s + ".rise");
            if (rise > 0.005f)
            {
                const float x1 = 8 + rise * (w - 16) * 0.5f;
                auto gr = c.createLinearGradient (8, 0, x1, 0);
                gr.addColorStop (0, "rgba(0,0,0,.55)");
                gr.addColorStop (1, "rgba(0,0,0,0)");
                c.fillStyle = gr;
                c.fillRect (8, 6, x1 - 8, hh - 12);
                c.strokeStyle = C.bloom (0.6f);
                c.setLineDash ({ 3, 3 });
                c.beginPath();
                c.moveTo (8, hh - 8);
                c.lineTo (x1, 8);
                c.stroke();
                c.setLineDash ({});
            }
        });
    }
    // Everything else that moves, over the tiles: the readings, their bars and
    // reach, what each tile moves, its light, the LFOs' shape glyphs.
    juce::Rectangle<float> all;
    for (const auto& t : tiles)
        all = all.isEmpty() ? face::rectOf (t.node) : all.getUnion (face::rectOf (t.node));
    overlay = h.addLayer ("tiles-" + P, all.expanded (12), [this, all] (juce::Graphics& g) {
        g.addTransform (juce::AffineTransform::translation (-(all.getX() - 12), -(all.getY() - 12)));
        drawOverlay (g);
    });
    light();
    sync();
}

void WaveTiles::light()
{
    for (const auto& t : tiles)
    {
        const auto L = t.src;
        auto group = [&] (const juce::Array<const juce::var*>& g, const std::function<bool (const juce::var&)>& on) {
            const juce::var *lit = nullptr, *unlit = nullptr;
            for (auto* n : g)
            {
                if (face::matches (*n, "on"))
                    lit = lit == nullptr ? n : lit;
                else if (unlit == nullptr)
                    unlit = n;
            }
            for (auto* n : g)
            {
                const auto* want = on (*n) ? lit : unlit;
                if (want == nullptr)
                    continue;
                const int i = (int) (*n)["i"];
                auto it = h.chrome->styleFrom.find (i);
                if (it != h.chrome->styleFrom.end() && it->second == (int) (*want)["i"])
                    continue;
                h.chrome->styleFrom[i] = (int) (*want)["i"];
                h.chrome->redraw (face::rectOf (*n));
            }
        };
        if (!L.startsWith ("lfo"))
            continue;
        const auto mode = m().s (L + ".mode").isEmpty() ? juce::String ("free") : m().s (L + ".mode");
        group (t.modes, [&] (const juce::var& n) { return n["data"]["k"].toString() == mode; });
        const int sync = m().g (L + ".sync") >= 0.5f ? 1 : 0;
        group (t.syncs, [&] (const juce::var& n) { return n["data"]["k"].toString().getIntValue() == sync; });
    }
}

// Where a tile moves something, the captured hint ("drag to map") gives way
// to what it moves: the hint, or over a picture its whole pill, is left out.
void WaveTiles::targets()
{
    for (const auto& t : tiles)
    {
        if (!t.tgts.isObject() || t.src == "amp")
            continue;
        bool any = false;
        for (const auto& r : m().mods)
            any = any || (r.src == t.src && !r.off);
        juce::Array<int> ids;
        if (face::matches (t.tgts, "ov"))
            ids.add ((int) t.tgts["i"]);
        else if (auto* kids = t.tgts["kids"].getArray())
            for (auto& k : *kids)
                ids.add ((int) k["i"]);
        bool changed = false;
        for (int i : ids)
            changed = (any ? h.chrome->skip.insert (i).second : h.chrome->skip.erase (i) > 0) || changed;
        if (changed)
            h.chrome->redraw (face::rectOf (t.tgts).expanded (2));
    }
}

void WaveTiles::sync()
{
    targets();
    for (auto& r : readings)
    {
        const float v = m().g (r.key);
        juce::String t;
        if (r.kind == "a" || r.kind == "d")
            t = fmtC (v * v * 4);
        else if (r.kind == "s")
            t = juce::String (juce::roundToInt (v * 100)) + "%";
        else if (r.kind == "r")
            t = fmtC (v * v * 6);
        else if (r.kind == "rate")
            t = wave::lfoRateTxt (m(), r.src.getTrailingIntValue()).replace (" Hz", "Hz");
        else if (r.kind == "smooth")
            t = juce::String (juce::roundToInt (v * 100)) + "%";
        else if (r.kind == "rise")
            t = fmtC (v * v * 4);
        texts[r.b] = t;
    }
    light();
    if (overlay != nullptr)
        overlay->repaint();
}

void WaveTiles::changed (const juce::String& key)
{
    bool mine = key == "tempo" || key.startsWith ("macro");
    for (auto& [src, layer] : pics)
        if (key.startsWith (src + ".") || (src.startsWith ("lfo") && key == "tempo"))
            layer->repaint(), mine = true;
    // Only a key a tile shows (or a macro, which a row may aim at a reading) writes its readings again.
    if (mine)
        sync();
}

void WaveTiles::live()
{
    if (auto it = pics.find ("amp"); it != pics.end())
        it->second->repaint();
    for (int L = 0; L < 4; ++L)
        if (auto it = pics.find ("lfo" + juce::String (L)); it != pics.end())
            it->second->repaint();
    if (overlay != nullptr)
        overlay->repaint();
}

void WaveTiles::drawOverlay (juce::Graphics& g)
{
    // Each reading: its value, its bar as long as the value, and what the rows
    // reach either side of it with a dot where the engine has it (wvRdMod).
    for (const auto& r : readings)
    {
        const float v = clampf (m().g (r.key));
        const auto col = c2d::css (wave::sourceColour (r.src));
        if (!r.bar.isEmpty() || r.bar.getHeight() > 0)
        {
            const float inner = r.r.getWidth() - 2;
            const auto b = juce::Rectangle<float> (r.bar.getX(), r.bar.getY(), inner * v, r.bar.getHeight());
            if (b.getWidth() > 0.01f)
            {
                juce::DropShadow (col, 6, {}).drawForRectangle (g, b.toNearestInt());
                g.setColour (col.withAlpha (0.85f));
                g.fillRect (b);
            }
        }
        const auto mo = wave::modOf (m(), r.key);
        if (mo.rng > 0)
        {
            const auto mc = mo.col.isNotEmpty() ? c2d::css (mo.col) : cl().mod;
            const float x0 = r.r.getX() + 1, w = r.r.getWidth() - 2;
            const float a = clampf (v - mo.rng), b = clampf (v + mo.rng), at = mo.live ? clampf (mo.at) : v;
            const auto band = juce::Rectangle<float> (x0 + a * w, r.r.getY() + 1, (b - a) * w, 2);
            juce::DropShadow (mc, 5, {}).drawForRectangle (g, band.toNearestInt());
            g.setColour (mc);
            g.fillRect (band);
            g.setColour (juce::Colours::white);
            g.fillEllipse (x0 + at * w - 2, r.r.getY() + 1, 4, 4);
            // .wv-rd.mod: its border in the source's colour.
            g.setColour (mc.withMultipliedAlpha (0.55f));
            g.drawRoundedRectangle (r.r.reduced (0.5f), 3, 1);
        }
        if (auto it = h.chrome->nodes.find (r.b); it != h.chrome->nodes.end())
        {
            face::Stamp s;
            const auto t = texts[r.b];
            s.text = [&] (const juce::var&, juce::String& out) { out = t; return true; };
            s.draw (g, bare (it->second));
        }
    }
    for (const auto& t : tiles)
    {
        // Whether it is moving anything now (.act): its light, as bright as it moves.
        if (t.act.isObject())
        {
            bool used = t.src == "amp";
            for (const auto& r : m().mods)
                used = used || (r.src == t.src && !r.off);
            const float o = used ? 0.3f + 0.7f * std::abs (wave::srcVal (m(), t.src == "amp" ? juce::String ("env1") : t.src)) : 0.0f;
            if (o > 0.001f)
            {
                const auto ar = face::rectOf (t.act);
                const auto col = c2d::css (wave::sourceColour (t.src));
                juce::Path dotP;
                dotP.addEllipse (ar);
                juce::Graphics::ScopedSaveState keep (g);
                g.beginTransparencyLayer (o);
                juce::DropShadow (col, 6, {}).drawForPath (g, dotP);
                g.setColour (col);
                g.fillPath (dotP);
                g.endTransparencyLayer();
            }
        }
        // An LFO's shape glyph: the shape it plays (a row may step it).
        if (t.lshapeSvg.isObject())
        {
            auto shape = wave::choiceNow (m(), t.src + ".shape");
            if (shape.isEmpty())
                shape = "drawn";
            auto it = shapeGlyphs().find (shape);
            face::drawIcon (g, t.lshapeSvg, it != shapeGlyphs().end() ? it->second : shapeGlyphs().at ("drawn"));
        }
        drawTargets (g, t);
    }
}

// What a tile moves (wvRenderTileTargets): "→ F1 Cutoff" for each row, or the
// first and "+N" where they don't fit, or "→ N controls"; "drag to map" when none.
void WaveTiles::drawTargets (juce::Graphics& g, const Tile& t)
{
    if (!t.tgts.isObject() || t.src == "amp" || tgTemplate == nullptr)
        return;
    std::vector<juce::String> names;
    for (const auto& r : m().mods)
        if (r.src == t.src && !r.off)
            names.push_back (wave::targetName (m(), r.dst));
    if (names.empty())
        return;
    const auto& tpl = *tgTemplate;
    const auto* arrowRun = tpl["text"].getArray();
    const auto* iNode = face::findNode (tpl, "i");
    if (arrowRun == nullptr || arrowRun->isEmpty() || iNode == nullptr)
        return;
    const auto arrowFont = face::font (arrowRun->getReference (0)["font"]);
    const auto nameFont = face::font ((*iNode)["text"][0]["font"]);
    const float gapArrow = face::rectOf (*iNode).getX() - face::rectOf (tpl).getX() - juce::GlyphArrangement::getStringWidth (arrowFont, juce::String::fromUTF8 ("\xe2\x86\x92"));
    auto width = [&] (const juce::String& n, bool arrow) {
        return (arrow ? juce::GlyphArrangement::getStringWidth (arrowFont, juce::String::fromUTF8 ("\xe2\x86\x92")) + gapArrow : 0.0f) + juce::GlyphArrangement::getStringWidth (nameFont, n);
    };
    const float gap = 6;
    const auto box = face::rectOf (t.tgts);
    const bool ov = face::matches (t.tgts, "ov");
    // The room: a header's fill, or over the picture up to its own most.
    // .wv-tgts.ov: at most 150 wide; on Play, the picture's width less 10.
    const float room = ov ? (P == "p" && !t.pic.isEmpty() ? t.pic.getWidth() - 10 : 150.0f) : box.getWidth();
    struct Item
    {
        juce::String name;
        bool arrow;
    };
    std::vector<Item> items;
    auto total = [&] (const std::vector<Item>& is) {
        float w = 0;
        for (size_t i = 0; i < is.size(); ++i)
            w += width (is[i].name, is[i].arrow) + (i > 0 ? gap : 0);
        return w;
    };
    for (auto& n : names)
        items.push_back ({ n, true });
    if (names.size() > 1 && total (items) > room - (ov ? 14 : 0) + 1)
        items = { { names[0], true }, { "+" + juce::String ((int) names.size() - 1), false } };
    if (total (items) > room - (ov ? 14 : 0) + 1)
        items = { { juce::String ((int) names.size()) + " control" + (names.size() > 1 ? "s" : ""), true } };
    const float content = total (items);
    juce::Rectangle<float> pill = box;
    if (ov)
    {
        // Over the picture, at its top right, as wide as what it says.
        const float w = juce::jmin (room, content + 14);
        pill = { box.getRight() - w, box.getY(), w, box.getHeight() };
        face::paintBox (g, t.tgts, pill);
    }
    juce::Graphics::ScopedSaveState keep (g);
    g.reduceClipRegion (pill.getSmallestIntegerContainer());
    float x = pill.getX() + (ov ? 7.0f : 0.0f);
    const auto colArrow = face::colour (arrowRun->getReference (0)["font"]["colour"]);
    const auto colName = face::colour ((*iNode)["text"][0]["font"]["colour"]);
    const float base = pill.getCentreY() + (arrowFont.getAscent() - arrowFont.getDescent()) / 2;
    for (auto& it : items)
    {
        juce::GlyphArrangement ga;
        if (it.arrow)
        {
            g.setColour (c2d::css (wave::sourceColour (t.src)));
            g.setFont (arrowFont);
            ga.addLineOfText (arrowFont, juce::String::fromUTF8 ("\xe2\x86\x92"), x, base);
            ga.draw (g);
            x += juce::GlyphArrangement::getStringWidth (arrowFont, juce::String::fromUTF8 ("\xe2\x86\x92")) + gapArrow;
            juce::GlyphArrangement gb;
            g.setColour (colName);
            gb.addLineOfText (nameFont, it.name, x, base);
            gb.draw (g);
            x += juce::GlyphArrangement::getStringWidth (nameFont, it.name) + gap;
        }
        else
        {
            g.setColour (c2d::css (wave::sourceColour (t.src)));
            ga.addLineOfText (arrowFont, it.name, x, base);
            ga.draw (g);
            x += juce::GlyphArrangement::getStringWidth (arrowFont, it.name) + gap;
        }
    }
    juce::ignoreUnused (colArrow);
}

juce::String WaveTiles::sourceAt (juce::Point<float> at) const
{
    for (const auto& t : tiles)
        if (t.grab.isObject() && t.src != "amp" && face::rectOf (t.grab).contains (at))
            return t.src;
    return {};
}

bool WaveTiles::down (const juce::MouseEvent& e)
{
    const auto at = e.position;
    drag = nullptr;
    dragEnd = nullptr;
    last = at;
    for (const auto& t : tiles)
    {
        if (!face::rectOf (t.node).contains (at))
            continue;
        if (t.lshape.isObject() && face::rectOf (t.lshape).contains (at))
        {
            if (h.lfoMenu)
                h.lfoMenu (face::rectOf (t.lshape), t.src.getTrailingIntValue());
            return true;
        }
        for (auto* n : t.modes)
            if (face::rectOf (*n).contains (at))
            {
                h.set (t.src + ".mode", (*n)["data"]["k"].toString());
                return true;
            }
        for (auto* n : t.syncs)
            if (face::rectOf (*n).contains (at))
            {
                h.set (t.src + ".sync", (*n)["data"]["k"].toString().getIntValue());
                return true;
            }
    }
    // The readings: up and down, Shift for fine.
    for (const auto& r : readings)
        if (r.r.contains (at))
        {
            const bool env = r.kind.length() == 1;
            const float lo = r.kind == "a" ? 0.005f : (r.kind == "d" || r.kind == "r") ? 0.01f : 0.0f;
            const auto key = r.key;
            drag = [this, key, env, lo] (const juce::MouseEvent& ev) {
                const float dy = ev.position.y - last.y;
                const float sens = env ? (ev.mods.isShiftDown() ? 600.0f : 120.0f) : (ev.mods.isShiftDown() ? 750.0f : 150.0f);
                h.set (key, juce::jmax (lo, clampf (m().g (key) - dy / sens)));
            };
            return true;
        }
    // An envelope: the nearest corner is the one dragged.
    for (const juce::String s : { "amp", "env1", "env2", "env3" })
    {
        auto it = h.chrome->canvases.find ("wv" + P + "ev" + s);
        if (it == h.chrome->canvases.end() || !face::rectOf (it->second).contains (at))
            continue;
        const auto r = face::rectOf (it->second);
        const auto pts = wave::envPts (r.getWidth(), r.getHeight(), m().g (s + ".a"), m().g (s + ".d"), m().g (s + ".s"), m().g (s + ".r"));
        const float x = at.x - r.getX();
        const float da = std::abs (pts.a.x - x), dd = std::abs (pts.d.x - x), dr = std::abs (pts.r.x - x);
        const char eh = da <= dd && da <= dr ? 'a' : dd <= dr ? 'd' : 'r';
        drag = [this, s, eh] (const juce::MouseEvent& ev) {
            const auto d = ev.position - last;
            if (eh == 'a')
                h.set (s + ".a", clampf (m().g (s + ".a") + d.x / 70, 0.005f, 1));
            else if (eh == 'd')
            {
                h.set (s + ".d", clampf (m().g (s + ".d") + d.x / 70, 0.01f, 1));
                h.set (s + ".s", clampf (m().g (s + ".s") - d.y / 50));
            }
            else
                h.set (s + ".r", clampf (m().g (s + ".r") + d.x / 70, 0.01f, 1));
        };
        return true;
    }
    // An LFO's picture: drag a point. A standard shape has none to drag, so
    // the first drag on one makes it Drawn, from what is on screen.
    for (int L = 0; L < 4; ++L)
    {
        auto it = h.chrome->canvases.find ("wv" + P + "lvlfo" + juce::String (L));
        if (it == h.chrome->canvases.end() || !face::rectOf (it->second).contains (at))
            continue;
        const auto r = face::rectOf (it->second);
        const auto key = "lfo" + juce::String (L) + ".points";
        auto px = [r] (const juce::var& q) { return 8 + (float) (double) q[0] * (r.getWidth() - 16); };
        auto py = [r] (const juce::var& q) { return 8 + (1 - (float) (double) q[1]) * (r.getHeight() - 16); };
        auto nearest = [px, py] (const juce::var& pts, float x, float y) {
            int b = 0;
            if (auto* a = pts.getArray())
                for (int i = 0; i < a->size(); ++i)
                    if (std::hypot (px (a->getReference (i)) - x, py (a->getReference (i)) - y) < std::hypot (px (a->getReference (b)) - x, py (a->getReference (b)) - y))
                        b = i;
            return b;
        };
        auto toDrawn = [this, L] {
            if (wave::lfoShape (m(), L) == "drawn")
                return;
            juce::Array<juce::var> pts;
            if (wave::lfoShape (m(), L) == "square")
                for (auto q : { std::pair { 0.0, 1.0 }, { 0.49, 1.0 }, { 0.5, 0.0 }, { 0.99, 0.0 }, { 1.0, 1.0 } })
                    pts.add (juce::Array<juce::var> { q.first, q.second });
            else
                for (int i = 0; i < 9; ++i)
                    pts.add (juce::Array<juce::var> { i / 8.0, std::round (wave::lfoVal (m(), L, (float) i / 8, 0) * 1e4) / 1e4 });
            h.set ("lfo" + juce::String (L) + ".points", pts);
            h.set ("lfo" + juce::String (L) + ".shape", "drawn");
        };
        const float x = at.x - r.getX(), y = at.y - r.getY();
        auto pi = std::make_shared<int> (-1);
        if (wave::lfoShape (m(), L) != "drawn" && e.getNumberOfClicks() != 2)
            *pi = -2;   // not yet: a plain click on a standard shape leaves it
        else
        {
            toDrawn();
            const auto pts = m().v (key);
            *pi = nearest (pts, x, y);
            if (pts.size() > *pi && std::hypot (px (pts[*pi]) - x, py (pts[*pi]) - y) > 14)
            {
                if (e.getNumberOfClicks() != 2)
                    *pi = -1;
                else
                {
                    // A double-click away from a point adds one there.
                    const float nx = clampf ((x - 8) / (r.getWidth() - 16));
                    juce::Array<juce::var> next;
                    int idx = -1;
                    for (int i = 0; i < pts.size(); ++i)
                        if (idx < 0 && (float) (double) pts[i][0] > nx)
                            idx = i;
                    idx = juce::jmax (1, idx < 0 ? pts.size() : idx);
                    for (int i = 0; i < pts.size(); ++i)
                    {
                        if (i == idx)
                            next.add (juce::Array<juce::var> { nx, clampf (1 - (y - 8) / (r.getHeight() - 16)) });
                        next.add (pts[i]);
                    }
                    if (idx >= pts.size())
                        next.add (juce::Array<juce::var> { nx, clampf (1 - (y - 8) / (r.getHeight() - 16)) });
                    h.set (key, next);
                    *pi = idx;
                }
            }
        }
        const auto at0 = juce::Point<float> (x, y);
        drag = [this, r, key, pi, at0, nearest, toDrawn] (const juce::MouseEvent& ev) {
            const float xx = ev.position.x - r.getX(), yy = ev.position.y - r.getY();
            if (*pi == -2)
            {
                toDrawn();
                *pi = nearest (m().v (key), at0.x, at0.y);
            }
            if (*pi < 0)
                return;
            const auto src = m().v (key);
            auto* a = src.getArray();
            if (a == nullptr || *pi >= a->size())
                return;
            juce::Array<juce::var> pts;
            for (auto& q : *a)
                pts.add (juce::Array<juce::var> { q[0], q[1] });
            auto p = pts[*pi];
            float px0 = (float) (double) p[0];
            if (*pi > 0 && *pi < pts.size() - 1)
                px0 = clampf ((xx - 8) / (r.getWidth() - 16), (float) (double) pts[*pi - 1][0] + 0.01f, (float) (double) pts[*pi + 1][0] - 0.01f);
            pts.set (*pi, juce::Array<juce::var> { px0, clampf (1 - (yy - 8) / (r.getHeight() - 16)) });
            h.set (key, pts);
        };
        return true;
    }
    return false;
}

void WaveTiles::dragged (const juce::MouseEvent& e)
{
    if (drag)
        drag (e);
    last = e.position;
}

void WaveTiles::up()
{
    if (dragEnd)
        dragEnd();
    drag = nullptr;
    dragEnd = nullptr;
}

bool WaveTiles::doubleClick (const juce::MouseEvent&)
{
    return false;
}

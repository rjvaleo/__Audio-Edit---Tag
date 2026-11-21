// idMLab, the native app: one window, idMLab's own canvas (its bar, its
// board, its status line), MultiGrainLive's and idMLab's modules on it,
// played by the native engine (APP-PLAN.md).

#include "BinaryData.h"
#include "Canvas.h"
#include "Face.h"
#include "AtmosFace.h"
#include "WaveFace.h"
#include "Host.h"
#include "Places.h"

#include <juce_audio_utils/juce_audio_utils.h>
#include <juce_gui_basics/juce_gui_basics.h>

namespace
{
float num (const juce::var& v, float fallback = 0.0f)
{
    return v.isVoid() || v.isUndefined() ? fallback : (float) (double) v;
}

juce::Rectangle<float> rectOf (const juce::var& r)
{
    return { num (r[0]), num (r[1]), num (r[2]), num (r[3]) };
}

// idMLab's project bar (`.mm-project-bar`), captured at 1600 wide: its name
// and file on the left, its menus between, and on the right Audio, Zoom, the
// theme button (its swatch and name) and the Kit picker, laid out from the
// window's right edge with idMLab's gaps, the theme button as wide as its name.
class Bar final : public juce::Component
{
public:
    explicit Bar (Canvas& c) : canvas (c) {}
    std::function<void()> onAudio;
    std::function<void (juce::Rectangle<int>)> onTheme;
    std::function<void (const juce::String&)> onKit;

    void paint (juce::Graphics& g) override
    {
        const auto& tree = face::part ("idmlab-bar")["tree"];
        const auto L = layout();
        face::paintBox (g, tree, getLocalBounds().toFloat());
        if (auto* title = face::find (tree, "strong"))
            face::paintText (g, *title, rectOf ((*title)["rect"]), "idMLab");
        if (auto* file = find (tree, "span", 0))
            face::paintText (g, *file, rectOf ((*file)["rect"]).withWidth (400), canvas.fileName());
        // The menus, centred between the two ends, as idMLab's flex row puts them.
        for (int i = 0; i < 4; ++i)
            if (auto* b = menuButton (i))
            {
                const auto r = rectOf ((*b)["rect"]).translated (L.menus, 0);
                face::paintBox (g, *b, r);
                face::paintText (g, *b, r, menuTitles[i], juce::Justification::centred);
            }
        if (auto* audio = audioButton())
        {
            const auto r = rectOf ((*audio)["rect"]).translated (L.audio, 0);
            face::paintBox (g, *audio, r);
            face::paintText (g, *audio, r, "Audio", juce::Justification::centred);
        }
        if (auto* zoom = zoomLabel())
        {
            const auto r = rectOf ((*zoom)["rect"]).translated (L.zoom, 0);
            face::paintBox (g, *zoom, r);
            face::paintText (g, *zoom, r.withTrimmedLeft (10).withWidth (40), "Zoom");
            // The slider, on a log scale: 100% in its middle.
            const auto track = sliderRect();
            const float u = std::log (canvas.zoom() / camera::minZoom) / std::log (camera::maxZoom / camera::minZoom);
            const auto ink = face::colour ((*zoom)["text"][0]["font"]["colour"]);
            g.setColour (ink.withAlpha (0.25f));
            g.fillRoundedRectangle (track.withSizeKeepingCentre (track.getWidth(), 4), 2);
            g.setColour (ink.withAlpha (0.8f));
            g.fillRoundedRectangle (juce::Rectangle<float> (track.getX(), track.getCentreY() - 2, track.getWidth() * u, 4), 2);
            g.setColour (ink);
            g.fillEllipse (juce::Rectangle<float> (14, 14).withCentre ({ track.getX() + track.getWidth() * u, track.getCentreY() }));
            if (auto* out = face::find (*zoom, "output"))
                face::paintText (g, *out, rectOf ((*out)["rect"]).translated (L.zoom, 0).withWidth (48), juce::String (juce::roundToInt (canvas.zoom() * 100)) + " %");
        }
        // The theme button: the worn theme's swatch and its name.
        if (auto* theme = face::find (tree, "mm-theme"))
            if (auto* button = face::find (*theme, "button"))
            {
                const auto& choice = worn();
                const auto r = themeRect();
                face::paintBox (g, *button, r);
                auto sw = juce::Rectangle<float> (r.getX() + 10, r.getY() + 6, 2.0f + 9.0f * (float) juce::jmax (1, choice.swatch.size()), 16);
                if (auto* swatch = face::find (*button, "mm-theme-swatch"))
                    face::paintBox (g, *swatch, sw);
                for (int k = 0; k < choice.swatch.size(); ++k)
                {
                    g.setColour (choice.swatch[k]);
                    g.fillRect (juce::Rectangle<float> (sw.getX() + 1 + 9.0f * (float) k, sw.getY() + 1, 9, 14));
                }
                if (auto* label = find (*button, "span", 1))
                    face::paintText (g, *label, { sw.getRight() + 8, r.getY(), 400, r.getHeight() }, choice.label);
            }
        // The Kit picker: its label and its select, showing the worn kit.
        if (auto* picker = face::find (tree, "mm-kit-picker"))
        {
            const auto r = kitRect();
            face::paintBox (g, *picker, r);
            face::paintText (g, *picker, r.withTrimmedLeft (9).withWidth (24), "Kit");
            if (auto* select = face::find (*picker, "select"))
            {
                const auto sr = rectOf ((*select)["rect"]).translated (r.getX() - rectOf ((*picker)["rect"]).getX(), 0);
                face::paintBox (g, *select, sr);
                juce::String label;
                for (const auto& [id, name] : face::kits())
                    if (id == face::wornKit())
                        label = name;
                g.setFont (face::font ((*select)["font"]));
                g.setColour (face::colour ((*select)["font"]["colour"]));
                g.drawText (label, sr.reduced (5, 0), juce::Justification::centredLeft, false);
                juce::Path chevron;
                chevron.addTriangle (sr.getRight() - 13, sr.getCentreY() - 2, sr.getRight() - 5, sr.getCentreY() - 2, sr.getRight() - 9, sr.getCentreY() + 3);
                g.fillPath (chevron);
            }
        }
    }

    void mouseDown (const juce::MouseEvent& e) override
    {
        const auto L = layout();
        for (int i = 0; i < 4; ++i)
            if (auto* b = menuButton (i))
                if (rectOf ((*b)["rect"]).translated (L.menus, 0).contains (e.position))
                    return showMenu (i, rectOf ((*b)["rect"]).translated (L.menus, 0));
        if (auto* audio = audioButton())
            if (rectOf ((*audio)["rect"]).translated (L.audio, 0).contains (e.position))
            {
                if (onAudio)
                    onAudio();
                return;
            }
        if (themeRect().contains (e.position))
        {
            if (onTheme)
                onTheme (themeRect().toNearestInt());
            return;
        }
        if (kitRect().contains (e.position))
        {
            juce::PopupMenu m;
            for (const auto& [id, name] : face::kits())
                m.addItem (name, true, id == face::wornKit(), [this, kitId = id] { if (onKit) onKit (kitId); });
            m.showMenuAsync (juce::PopupMenu::Options().withTargetScreenArea (localAreaToGlobal (kitRect()).toNearestInt()));
            return;
        }
        if (sliderRect().expanded (4, 8).contains (e.position))
        {
            sliding = true;
            slide (e.position.x);
        }
    }

    void mouseDrag (const juce::MouseEvent& e) override
    {
        if (sliding)
            slide (e.position.x);
    }

    void mouseUp (const juce::MouseEvent&) override { sliding = false; }

private:
    Canvas& canvas;
    bool sliding = false;
    const char* menuTitles[4] = { "File", "Edit", "Patch", "View" };

    static const face::ThemeChoice& worn()
    {
        const auto& list = face::themeChoices();
        return list[(size_t) juce::jlimit (0, (int) list.size() - 1, face::worn())];
    }

    static const juce::var* find (const juce::var& tree, const juce::String& tag, int nth)
    {
        int seen = 0;
        std::function<const juce::var* (const juce::var&)> walk = [&] (const juce::var& n) -> const juce::var* {
            if (n["tag"].toString() == tag && seen++ == nth)
                return &n;
            if (auto* kids = n["kids"].getArray())
                for (const auto& k : *kids)
                    if (auto* hit = walk (k))
                        return hit;
            return nullptr;
        };
        return walk (tree);
    }
    const juce::var& tree() const { return face::part ("idmlab-bar")["tree"]; }
    const juce::var* menuButton (int i) const { return find (tree(), "button", i); }
    const juce::var* audioButton() const { return find (tree(), "button", 4); }
    const juce::var* zoomLabel() const { return find (tree(), "label", 0); }

    // Where each group sits: how far it moves from where idMLab drew it.
    struct Layout
    {
        float menus = 0, audio = 0, zoom = 0;
    };
    juce::Rectangle<float> kitRect() const
    {
        auto* picker = face::find (tree(), "mm-kit-picker");
        const auto r = picker != nullptr ? rectOf ((*picker)["rect"]) : juce::Rectangle<float> (1435.8f, 9, 150.2f, 31);
        return r.withX ((float) getWidth() - 14 - r.getWidth());
    }
    juce::Rectangle<float> themeRect() const
    {
        const auto& choice = worn();
        juce::Font f (juce::FontOptions (13.0f));
        if (auto* theme = face::find (tree(), "mm-theme"))
            if (auto* label = find (*theme, "span", 1))
                f = face::font ((*label)["text"][0]["font"]);
        const float w = 10 + 2 + 9.0f * (float) juce::jmax (1, choice.swatch.size()) + 8 + juce::GlyphArrangement::getStringWidth (f, choice.label) + 10;
        return { kitRect().getX() - 8 - w, 10.5f, w, 28 };
    }
    Layout layout() const
    {
        Layout L;
        auto* zoom = zoomLabel();
        auto* audio = audioButton();
        if (zoom == nullptr || audio == nullptr)
            return L;
        const auto zr = rectOf ((*zoom)["rect"]), ar = rectOf ((*audio)["rect"]);
        L.zoom = themeRect().getX() - 8 - zr.getRight();
        L.audio = zr.getX() + L.zoom - 8 - ar.getRight();
        auto* first = menuButton (0);
        auto* last = menuButton (3);
        if (first != nullptr && last != nullptr)
        {
            const float left = 180, right = ar.getX() + L.audio;
            const float width = rectOf ((*last)["rect"]).getRight() - rectOf ((*first)["rect"]).getX();
            L.menus = (left + right) / 2 - width / 2 - rectOf ((*first)["rect"]).getX();
        }
        return L;
    }
    juce::Rectangle<float> sliderRect() const
    {
        auto* zoom = zoomLabel();
        auto* input = zoom != nullptr ? face::find (*zoom, "input") : nullptr;
        return input != nullptr ? rectOf ((*input)["rect"]).translated (layout().zoom, 0) : juce::Rectangle<float>();
    }
    void slide (float x)
    {
        const auto r = sliderRect();
        const float u = juce::jlimit (0.0f, 1.0f, (x - r.getX()) / juce::jmax (1.0f, r.getWidth()));
        canvas.setZoom (camera::minZoom * std::pow (camera::maxZoom / camera::minZoom, u));
    }

    // idMLab's menus (appMenus.ts), each command as the native app has it.
    void showMenu (int i, juce::Rectangle<float> near)
    {
        juce::PopupMenu m;
        auto* c = &canvas;
        if (i == 0)
        {
            m.addItem ("New", [c] { c->newCanvas(); });
            m.addSeparator();
            m.addItem (juce::String::fromUTF8 ("Open\xe2\x80\xa6"), [c] { c->openPatch(); });
            m.addItem ("Save", [c] { c->savePatch (false); });
            m.addItem (juce::String::fromUTF8 ("Save As\xe2\x80\xa6"), [c] { c->savePatch (true); });
        }
        else if (i == 1)
        {
            m.addItem ("Undo", [c] { c->undo(); });
            m.addItem ("Redo", [c] { c->redo(); });
            m.addSeparator();
            m.addItem ("Duplicate", [c] { c->duplicateSelection(); });
            m.addItem ("Delete", [c] { c->deleteSelection(); });
        }
        else if (i == 2)
        {
            m.addItem (juce::String::fromUTF8 ("Add Module\xe2\x80\xa6"), [c] { c->addModuleAtCentre(); });
            m.addSeparator();
            m.addItem ("Center Patch", [c] { c->centrePatch(); });
        }
        else
        {
            m.addItem ("Zoom In", [c] { c->setZoom (c->zoom() * camera::notch); });
            m.addItem ("Zoom Out", [c] { c->setZoom (c->zoom() / camera::notch); });
            m.addItem ("Actual Size", [c] { c->setZoom (1.0f); });
            m.addItem ("Fit", [c] { c->fit(); });
        }
        m.showMenuAsync (juce::PopupMenu::Options().withTargetScreenArea (localAreaToGlobal (near).toNearestInt()));
    }
};

// idMLab's theme menu: a search, then the themes grouped (built in, MGL's
// own looks, the palettes), each row its swatch, its name and a line on it.
class ThemeMenu final : public juce::Component, private juce::TextEditor::Listener
{
public:
    std::function<void (int)> onPick;
    std::function<void()> onClose;

    ThemeMenu()
    {
        const auto& tree = menuTree();
        if (auto* input = face::find (tree, "input"))
        {
            search.setFont (face::font ((*input)["font"]));
            search.setColour (juce::TextEditor::backgroundColourId, (*input)["bg"].isArray() ? face::colour ((*input)["bg"]) : juce::Colour (0xff2f2f31));
            search.setColour (juce::TextEditor::textColourId, face::colour ((*input)["font"]["colour"]));
            search.setColour (juce::TextEditor::outlineColourId, juce::Colour (0xff3a3a3f));
        }
        search.setTextToShowWhenEmpty ("Search " + juce::String ((int) face::themeChoices().size()) + " themes", juce::Colour (0xff8b8b92));
        search.addListener (this);
        addAndMakeVisible (search);
        list.setViewedComponent (&rows, false);
        list.setScrollBarsShown (true, false);
        addAndMakeVisible (list);
        rows.menu = this;
        filter();
    }

    static const juce::var& menuTree()
    {
        static const juce::var tree = [] {
            for (int i = 0; i < BinaryData::namedResourceListSize; ++i)
                if (juce::String (BinaryData::originalFilenames[i]) == "idmlab-theme-menu.json.gz")
                {
                    int size = 0;
                    const char* data = BinaryData::getNamedResource (BinaryData::namedResourceList[i], size);
                    juce::MemoryInputStream raw (data, (size_t) size, false);
                    juce::GZIPDecompressorInputStream unzip (&raw, false, juce::GZIPDecompressorInputStream::gzipFormat);
                    return juce::JSON::parse (unzip.readEntireStreamAsString())["tree"];
                }
            return juce::var();
        }();
        return tree;
    }

    void paint (juce::Graphics& g) override { face::paintBox (g, menuTree(), getLocalBounds().toFloat()); }

    void resized() override
    {
        search.setBounds (9, 9, getWidth() - 18, 28);
        list.setBounds (9, 43, getWidth() - 18, getHeight() - 52);
        rows.setSize (list.getWidth() - (list.getVerticalScrollBar().isVisible() ? 8 : 0), rows.getHeight());
    }

    void inputAttemptWhenModal() override { if (onClose) onClose(); }

private:
    struct Rows final : public juce::Component
    {
        ThemeMenu* menu = nullptr;
        struct Row
        {
            int choice = -1;
            juce::String group;
            juce::Rectangle<float> r;
        };
        std::vector<Row> items;
        int hover = -1;

        void paint (juce::Graphics& g) override
        {
            const auto& tree = menuTree();
            const auto* listNode = face::find (tree, "mm-theme-menu__list");
            const juce::var* groupLabel = listNode != nullptr ? face::find (*listNode, "b") : nullptr;
            const juce::var* active = listNode != nullptr ? face::find (*listNode, "is-active") : nullptr;
            const juce::var* plain = listNode != nullptr ? face::find (*listNode, "button") : nullptr;
            const juce::var* swatch = plain != nullptr ? face::find (*plain, "mm-theme-swatch") : nullptr;
            const juce::var* name = plain != nullptr ? find (*plain, "span", 1) : nullptr;
            const juce::var* small = plain != nullptr ? face::find (*plain, "small") : nullptr;
            const auto& choices = face::themeChoices();
            for (size_t i = 0; i < items.size(); ++i)
            {
                const auto& it = items[i];
                if (it.choice < 0)
                {
                    if (groupLabel != nullptr)
                        face::paintText (g, *groupLabel, it.r, it.group.toUpperCase());
                    continue;
                }
                const auto& c = choices[(size_t) it.choice];
                const bool on = it.choice == face::worn();
                if (on && active != nullptr)
                    face::paintBox (g, *active, it.r);
                else if ((int) i == hover)
                {
                    g.setColour (juce::Colours::white.withAlpha (0.06f));
                    g.fillRoundedRectangle (it.r, 6);
                }
                auto sw = juce::Rectangle<float> (it.r.getX() + 7, it.r.getY() + 13, 2.0f + 9.0f * (float) juce::jmax (1, c.swatch.size()), 16);
                if (swatch != nullptr)
                    face::paintBox (g, *swatch, sw);
                for (int k = 0; k < c.swatch.size(); ++k)
                {
                    g.setColour (c.swatch[k]);
                    g.fillRect (juce::Rectangle<float> (sw.getX() + 1 + 9.0f * (float) k, sw.getY() + 1, 9, 14));
                }
                const float x = sw.getRight() + 9;
                if (name != nullptr)
                    face::paintText (g, *name, { x, it.r.getY() + 7, it.r.getRight() - x - 4, 15 }, c.label);
                if (small != nullptr)
                    face::paintText (g, *small, { x, it.r.getY() + 23, it.r.getRight() - x - 4, 12 }, c.blurb);
            }
        }

        static const juce::var* find (const juce::var& tree, const juce::String& tag, int nth)
        {
            int seen = 0;
            std::function<const juce::var* (const juce::var&)> walk = [&] (const juce::var& n) -> const juce::var* {
                if (n["tag"].toString() == tag && seen++ == nth)
                    return &n;
                if (auto* kids = n["kids"].getArray())
                    for (const auto& k : *kids)
                        if (auto* hit = walk (k))
                            return hit;
                return nullptr;
            };
            return walk (tree);
        }

        void mouseMove (const juce::MouseEvent& e) override
        {
            int h = -1;
            for (size_t i = 0; i < items.size(); ++i)
                if (items[i].choice >= 0 && items[i].r.contains (e.position))
                    h = (int) i;
            if (h != hover)
            {
                hover = h;
                repaint();
            }
        }
        void mouseExit (const juce::MouseEvent&) override
        {
            hover = -1;
            repaint();
        }
        void mouseUp (const juce::MouseEvent& e) override
        {
            for (const auto& it : items)
                if (it.choice >= 0 && it.r.contains (e.position) && menu->onPick)
                {
                    const int c = it.choice;
                    auto pick = menu->onPick;
                    juce::MessageManager::callAsync ([pick, c] { pick (c); });
                    return;
                }
        }
    };

    juce::TextEditor search;
    juce::Viewport list;
    Rows rows;

    void filter()
    {
        rows.items.clear();
        const auto q = search.getText().trim().toLowerCase();
        const auto& choices = face::themeChoices();
        float y = 0;
        juce::String group;
        for (int i = 0; i < (int) choices.size(); ++i)
        {
            const auto& c = choices[(size_t) i];
            if (q.isNotEmpty() && !c.label.toLowerCase().contains (q))
                continue;
            if (c.group != group)
            {
                if (group.isNotEmpty())
                    y += 4;
                group = c.group;
                rows.items.push_back ({ -1, group, { 0, y, 290, 23 } });
                y += 23;
            }
            rows.items.push_back ({ i, group, { 0, y, 290, 42 } });
            y += 42;
        }
        rows.setSize (302, juce::jmax (1, (int) y + 4));
        rows.repaint();
        resized();
    }
    void textEditorTextChanged (juce::TextEditor&) override { filter(); }
    void textEditorEscapeKeyPressed (juce::TextEditor&) override { if (onClose) onClose(); }
};

// idMLab's status line: what the last command did, and how many modules and cables.
class StatusLine final : public juce::Component
{
public:
    explicit StatusLine (Canvas& c) : canvas (c) {}
    juce::String message;
    void paint (juce::Graphics& g) override
    {
        const auto& tree = face::part ("idmlab-status")["tree"];
        face::paintBox (g, tree, getLocalBounds().toFloat());
        auto* kids = tree["kids"].getArray();
        if (kids == nullptr || kids->size() < 2)
            return;
        const auto& left = kids->getReference (0);
        const auto& right = kids->getReference (1);
        const auto lr = rectOf (left["rect"]);
        face::paintText (g, left, lr.withWidth ((float) getWidth() / 2), message);
        const int n = (int) canvas.nodes.size(), w = (int) canvas.wires.size();
        const auto rr = rectOf (right["rect"]);
        face::paintText (g, right, juce::Rectangle<float> ((float) getWidth() / 2, rr.getY(), (float) getWidth() / 2 - (1600 - rr.getRight()), rr.getHeight()),
                         juce::String (n) + (n == 1 ? " node" : " nodes") + juce::String::fromUTF8 (" \xc2\xb7 ") + juce::String (w) + (w == 1 ? " cable" : " cables"),
                         juce::Justification::centredRight);
    }

private:
    Canvas& canvas;
};

// The theme and kit last worn, kept between runs (places::home()/settings.json).
juce::var readSettings()
{
    return juce::JSON::parse (places::home().getChildFile ("settings.json").loadFileAsString());
}

void writeSettings (const juce::String& theme, const juce::String& kit)
{
    juce::DynamicObject::Ptr o = new juce::DynamicObject();
    o->setProperty ("theme", theme);
    o->setProperty ("kit", kit);
    places::home().createDirectory();
    places::home().getChildFile ("settings.json").replaceWithText (juce::JSON::toString (juce::var (o.get())));
}

// What to wear before anything is drawn: what was worn last, or idMLab's Dark.
int wearSaved()
{
    const auto saved = readSettings();
    const auto& list = face::themeChoices();
    int choice = 0;
    for (int i = 0; i < (int) list.size(); ++i)
        if (list[(size_t) i].label == (saved["theme"].isString() ? saved["theme"].toString() : juce::String ("Dark")))
        {
            choice = i;
            break;
        }
    face::wear (choice, saved["kit"].isString() ? saved["kit"].toString() : juce::String ("thinRing"));
    return choice;
}

class MainComponent final : public juce::Component, private juce::Timer
{
public:
    MainComponent()
    {
        addAndMakeVisible (canvas);
        addAndMakeVisible (bar);
        addAndMakeVisible (statusLine);
        canvas.status = [this] (const juce::String& s) {
            statusLine.message = s;
            statusLine.repaint();
        };
        canvas.changed = [this] {
            bar.repaint();
            statusLine.repaint();
        };
        bar.onAudio = [this] { soundSettings(); };
        bar.onTheme = [this] (juce::Rectangle<int> near) { openThemes (near); };
        bar.onKit = [this] (const juce::String& kit) { wearTheme (face::worn(), kit); };
        setSize (1600, 1000);
        canvas.starter();
        startTimerHz (1);
    }

    void paint (juce::Graphics& g) override { g.fillAll (juce::Colour (28, 28, 29)); }

    void resized() override
    {
        auto r = getLocalBounds();
        const auto& st = face::part ("idmlab-style");
        bar.setBounds (r.removeFromTop ((int) num (st["header"], 50)));
        statusLine.setBounds (r.removeFromBottom ((int) num (st["status"], 28)));
        canvas.setBounds (r);
    }

    Canvas& canvasForBench() { return canvas; }

private:
    int savedTheme = wearSaved();
    Host host;
    Canvas canvas { host };
    Bar bar { canvas };
    StatusLine statusLine { canvas };
    juce::TooltipWindow tooltips { this, 600 };
    std::unique_ptr<ThemeMenu> themes;

    void openThemes (juce::Rectangle<int> near)
    {
        if (themes != nullptr)
        {
            themes.reset();
            return;
        }
        themes = std::make_unique<ThemeMenu>();
        themes->onPick = [this] (int c) {
            themes.reset();
            wearTheme (c, face::wornKit());
        };
        themes->onClose = [this] { juce::MessageManager::callAsync ([this] { themes.reset(); }); };
        const int h = juce::jmin (652, getHeight() - near.getBottom() - 40);
        themes->setBounds (juce::jlimit (8, getWidth() - 328, near.getRight() - 320), near.getBottom() + 6, 320, h);
        addAndMakeVisible (*themes);
    }

public:
    // Wear a theme by its name, not kept (for snapshots).
    void wearForSnapshot (const juce::String& label, const juce::String& kit)
    {
        const auto& list = face::themeChoices();
        for (int i = 0; i < (int) list.size(); ++i)
            if (list[(size_t) i].label == label)
                return wearTheme (i, kit, false);
    }

private:
    // Put a theme and kit on: everything drawn again in them, and kept.
    void wearTheme (int choice, const juce::String& kit, bool keep = true)
    {
        face::wear (choice, kit);
        canvas.retheme();
        bar.repaint();
        statusLine.repaint();
        if (keep)
            writeSettings (face::themeChoices()[(size_t) choice].label, kit);
        juce::String kitName;
        for (const auto& [id, name] : face::kits())
            if (id == kit)
                kitName = name;
        statusLine.message = "Theme " + face::themeChoices()[(size_t) choice].label + juce::String::fromUTF8 (" \xc2\xb7 kit ") + kitName;
        statusLine.repaint();
    }

    void mouseDown (const juce::MouseEvent&) override { themes.reset(); }

    // The sound card's state belongs in the status line now and then.
    void timerCallback() override
    {
        const auto bad = host.with ([] (NaApp* a) { return na_bad_blocks (a); });
        if (bad > 0)
        {
            statusLine.message = juce::String ((juce::int64) bad) + " bad blocks";
            statusLine.repaint();
        }
    }

    void soundSettings()
    {
        auto* selector = new juce::AudioDeviceSelectorComponent (host.devices, 0, 0, 2, 2, true, false, true, false);
        selector->setSize (520, 460);
        juce::DialogWindow::LaunchOptions o;
        o.content.setOwned (selector);
        o.dialogTitle = "Audio (the buffer is never below 64)";
        o.dialogBackgroundColour = juce::Colour (0xff262a31);
        o.escapeKeyTriggersCloseButton = true;
        o.useNativeTitleBar = true;
        o.resizable = false;
        o.launchAsync();
        if (auto* d = host.devices.getCurrentAudioDevice())
            canvas.status (d->getName() + "  " + juce::String (juce::roundToInt (d->getCurrentSampleRate())) + " Hz  " + juce::String (d->getCurrentBufferSizeSamples()) + " frames");
    }
};

class MainWindow final : public juce::DocumentWindow
{
public:
    explicit MainWindow (const juce::String& name)
        : DocumentWindow (name, juce::Colour (0xff1d2025), DocumentWindow::allButtons)
    {
        setUsingNativeTitleBar (true);
        setContentOwned (new MainComponent(), true);
        setResizable (true, true);
        centreWithSize (getWidth(), getHeight());
        setVisible (true);
    }

    void closeButtonPressed() override
    {
        juce::JUCEApplication::getInstance()->systemRequestedQuit();
    }
};

class App final : public juce::JUCEApplication
{
public:
    const juce::String getApplicationName() override { return "idMLab"; }
    const juce::String getApplicationVersion() override { return "0.1.0"; }
    bool moreThanOneInstanceAllowed() override { return true; }

    void initialise (const juce::String& commandLine) override
    {
        // --snapshot <page> <file.png> [scale]: draw a page's face to a picture
        // and quit, for comparing with MGL's own page (tools/face-capture).
        auto args = juce::StringArray::fromTokens (commandLine, true);
        args.trim();
        args.removeEmptyStrings();
        // --bench: how long the Wave face takes to draw whole, and to draw
        // again after one knob moves, as a drag does on every step.
        if (args.size() >= 2 && args[0] == "--bench" && args[1] == "canvas")
        {
            // The whole window: drawn once, then after a pan step and a zoom step.
            MainComponent main;
            juce::Image frame (juce::Image::ARGB, main.getWidth() * 2, main.getHeight() * 2, true);
            auto draw = [&] {
                juce::Graphics g (frame);
                g.addTransform (juce::AffineTransform::scale (2.0f));
                main.paintEntireComponent (g, true);
            };
            auto ms = [] (auto&& f) {
                const auto t0 = juce::Time::getMillisecondCounterHiRes();
                f();
                return juce::Time::getMillisecondCounterHiRes() - t0;
            };
            const double whole = ms (draw);
            double panStep = 0, zoomStep = 0;
            for (int i = 0; i < 10; ++i)
                panStep += ms ([&] { main.canvasForBench().pan (6, 3); draw(); });
            // A wheel's steps, as a gesture: the picture moves; then the rest.
            for (int i = 0; i < 10; ++i)
                zoomStep += ms ([&] { main.canvasForBench().setZoom (main.canvasForBench().zoom() * 1.1f); draw(); });
            const double rest = ms ([&] { main.canvasForBench().settleZoom(); draw(); });
            std::printf ("{\"zoom_rest_ms\":%.1f}\n", rest);
            std::printf ("{\"window_ms\":%.1f,\"pan_step_ms\":%.1f,\"zoom_step_ms\":%.1f}\n", whole, panStep / 10, zoomStep / 10);
            return quit();
        }
        if (args.size() >= 2 && args[0] == "--bench" && args[1] == "atmos")
        {
            // Atmosphere's face: drawn whole, again, and after a knob, a model and the big knob.
            NaApp* a = na_new (48000.0f, 4096);
            const auto id = (uint32_t) na_add (a, "atmos", 0, 0);
            AtmosFace f (
                [a, id] (const juce::String& key, const juce::String& value) { na_atmos_set (a, id, key.toRawUTF8(), value.toRawUTF8()); },
                [a, id] { return juce::String (naText ([&] (char* b, uint32_t c) { return na_atmos_state (a, id, b, c); })); },
                [a, id] (int which, float* o) { return (int) na_atmos_view (a, id, (uint32_t) which, o); },
                [a, id] (float* o, int n) { return (int) na_atmos_scope (a, id, o, (uint32_t) n); },
                [] { return juce::String (naText ([] (char* b, uint32_t c) { return na_fx_kinds (b, c); })); });
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
            double knob = 0, model = 0, macro = 0;
            for (int i = 0; i < 10; ++i)
                knob += ms ([&] { f.setKey ("atFltCut", 40 + i); draw(); });
            for (int i = 0; i < 10; ++i)
                model += ms ([&] { f.setKey ("modelA", i % 2 ? "bow" : "pluck"); draw(); });
            for (int i = 0; i < 10; ++i)
                macro += ms ([&] { f.setKey ("atMacro", 40 + i); draw(); });
            // The controls by hand: synthetic presses where the page has them.
            auto press = [&] (juce::Point<float> at, juce::Point<float> to) {
                auto src = juce::Desktop::getInstance().getMainMouseSource();
                const auto now = juce::Time::getCurrentTime();
                auto ev = [&] (juce::Point<float> p, bool dragged) {
                    return juce::MouseEvent (src, p, juce::ModifierKeys (juce::ModifierKeys::leftButtonModifier), 1.0f, 0, 0, 0, 0, &f, &f, now, at, now, 1, dragged);
                };
                f.mouseDown (ev (at, false));
                if (to != at)
                    f.mouseDrag (ev (to, true));
                f.mouseUp (ev (to, to != at));
            };
            press ({ 94, 84 }, { 94, 84 });                  // OSC A: Bowed string
            press ({ 346, 160 }, { 346, 110 });              // its first knob, up 50 px
            press ({ 1140, 196 }, { 1140, 236 });            // Cutoff, down 40 px
            press ({ 956, 328 }, { 956, 328 });              // LFO tab 2
            press ({ 963, 362 }, { 963, 312 });              // its Depth, up 50 px
            std::printf ("{\"modelA\":\"%s\",\"atMA1\":%s,\"atFltCut\":%s,\"atL2Depth\":%s,\"atL1Depth\":%s}\n",
                         f.valueOf ("modelA").toRawUTF8(), f.valueOf ("atMA1").toRawUTF8(), f.valueOf ("atFltCut").toRawUTF8(),
                         f.valueOf ("atL2Depth").toRawUTF8(), f.valueOf ("atL1Depth").toRawUTF8());
            const auto held = juce::String (naText ([&] (char* b, uint32_t c) { return na_atmos_state (a, id, b, c); }));
            std::printf ("engine: %s\n", held.fromFirstOccurrenceOf ("\"atL2Depth\"", true, false).upToFirstOccurrenceOf (",", false, false).toRawUTF8());
            for (auto& [name, t] : f.profile (2.0f))
                if (t > 1.0)
                    std::printf ("  %-16s %.1f ms\n", name.toRawUTF8(), t);
            std::printf ("{\"whole_ms\":%.1f,\"again_ms\":%.1f,\"knob_move_ms\":%.1f,\"model_click_ms\":%.1f,\"macro_move_ms\":%.1f}\n", whole, again, knob / 10, model / 10, macro / 10);
            na_free (a);
            return quit();
        }
        if (args.size() >= 1 && args[0] == "--bench")
        {
            NaApp* a = na_new (48000.0f, 4096);
            const auto id = (uint32_t) na_add (a, "wave", 0, 0);
            WaveFace w (
                [a, id] (const juce::String& key, const juce::String& value) { na_wave_set (a, id, key.toRawUTF8(), value.toRawUTF8()); },
                [a, id] { return juce::String (naText ([&] (char* b, uint32_t c) { return na_wave_patch (a, id, b, c); })); },
                [] (const juce::String& name) {
                    wave::Table t (na_table_frames (name.toRawUTF8(), nullptr, 0));
                    if (!t.empty())
                        na_table_frames (name.toRawUTF8(), t.front().data(), (uint32_t) t.size());
                    return t;
                });
            juce::Image frame (juce::Image::ARGB, w.getWidth() * 2, w.getHeight() * 2, true);
            auto draw = [&] {
                juce::Graphics g (frame);
                g.addTransform (juce::AffineTransform::scale (2.0f));
                w.paintEntireComponent (g, true);
            };
            auto ms = [] (auto&& f) {
                const auto t0 = juce::Time::getMillisecondCounterHiRes();
                f();
                return juce::Time::getMillisecondCounterHiRes() - t0;
            };
            const double whole = ms (draw);
            const double again = ms (draw);
            double move = 0;
            const int moves = 10;
            for (int i = 0; i < moves; ++i)
                move += ms ([&] { w.setKey ("osc0.pos", 0.3 + 0.02 * i); draw(); });
            double lens = 0;
            for (int i = 0; i < moves; ++i)
                lens += ms ([&] { w.setKey ("filt0.cut", 0.4 + 0.02 * i); draw(); });
            double click = 0;
            for (int i = 0; i < moves; ++i)
                click += ms ([&] { w.setKey ("filt0.type", i % 2 ? "hp" : "lp"); draw(); });
            // A zoom step on the canvas: everything drawn at a new size.
            juce::Image half (juce::Image::ARGB, w.getWidth(), w.getHeight(), true);
            const double zoom = ms ([&] {
                juce::Graphics g (half);
                g.addTransform (juce::AffineTransform::scale (0.5f));
                w.paintEntireComponent (g, true);
            });
            std::printf ("{\"switch_click_ms\":%.1f,\"zoom_step_ms\":%.1f}\n", click / moves, zoom);
            for (auto& [name, t] : w.profile (2.0f))
                if (t > 1.0)
                    std::printf ("  %-12s %.1f ms\n", name.toRawUTF8(), t);
            std::printf ("{\"whole_ms\":%.1f,\"again_ms\":%.1f,\"knob_move_ms\":%.1f,\"filter_move_ms\":%.1f}\n", whole, again, move / moves, lens / moves);
            na_free (a);
            return quit();
        }
        if (args.size() >= 3 && args[0] == "--snapshot")
        {
            const auto page = args[1].unquoted();
            const float scale = args.size() > 3 ? args[3].getFloatValue() : 1.0f;
            juce::Image image;
            if (page == "theme-menu")
            {
                wearSaved();
                ThemeMenu m;
                m.setSize (320, 652);
                image = m.createComponentSnapshot (m.getLocalBounds(), true, scale);
            }
            else if (page == "canvas")
            {
                MainComponent main;
                if (args.size() > 4)
                    main.wearForSnapshot (args[4].unquoted().replace ("_", " "), args.size() > 5 ? args[5] : juce::String ("thinRing"));
                // ATMOS_CANVAS: an Atmosphere added below the starter patch, and all of it fitted.
                if (juce::SystemStats::getEnvironmentVariable ("ATMOS_CANVAS", {}).isNotEmpty())
                {
                    main.canvasForBench().addModule ("atmos", { 0.0f, 1200.0f });
                    // ATMOS_PRESET=<file>: the first preset in it given to the new Atmosphere.
                    if (auto file = juce::SystemStats::getEnvironmentVariable ("ATMOS_PRESET", {}); file.isNotEmpty())
                    {
                        const auto parsed = juce::JSON::parse (juce::File (file).loadFileAsString());
                        const auto preset = parsed.isArray() ? parsed[0] : parsed;
                        main.canvasForBench().loadAtmosPreset (main.canvasForBench().selectedNode, preset);
                        std::printf ("presets listed: %d\n", main.canvasForBench().atmosPresetList (main.canvasForBench().selectedNode).getNumItems());
                    }
                    main.canvasForBench().fit();
                }
                image = main.createComponentSnapshot (main.getLocalBounds(), true, scale);
            }
            else if (page == "wave-face")
            {
                // The live face, a real Wave behind it (no sound card).
                NaApp* a = na_new (48000.0f, 4096);
                juce::String dirs;
                for (const auto& d : places::tableDirs())
                    dirs << d.getFullPathName() << "\n";
                na_table_dirs (a, dirs.toRawUTF8());
                const auto id = (uint32_t) na_add (a, "wave", 0, 0);
                WaveFace w (
                    [a, id] (const juce::String& key, const juce::String& value) { na_wave_set (a, id, key.toRawUTF8(), value.toRawUTF8()); },
                    [a, id] { return juce::String (naText ([&] (char* b, uint32_t c) { return na_wave_patch (a, id, b, c); })); },
                    [] (const juce::String& name) {
                        wave::Table t (na_table_frames (name.toRawUTF8(), nullptr, 0));
                        if (!t.empty())
                            na_table_frames (name.toRawUTF8(), t.front().data(), (uint32_t) t.size());
                        return t;
                    });
                image = w.createComponentSnapshot (w.getLocalBounds(), true, scale);
                na_free (a);
            }
            else if (page == "atmos-face")
            {
                // The live face, a real Atmosphere behind it (no sound card):
                // --snapshot atmos-face out.png scale [theme_label] [key=json;key=json | @file of key=json lines] [note]
                if (args.size() > 4 && args[4] != "-")
                {
                    const auto label = args[4].unquoted().replace ("_", " ");
                    const auto& list = face::themeChoices();
                    for (int i = 0; i < (int) list.size(); ++i)
                        if (list[(size_t) i].label == label)
                            face::wear (i, "thinRing");
                }
                NaApp* a = na_new (48000.0f, 4096);
                const auto id = (uint32_t) na_add (a, "atmos", 0, 0);
                const auto out = (uint32_t) na_add (a, "output", 0, 0);
                na_connect (a, id, 0, out, 0);
                AtmosFace f (
                    [a, id] (const juce::String& key, const juce::String& value) { na_atmos_set (a, id, key.toRawUTF8(), value.toRawUTF8()); },
                    [a, id] { return juce::String (naText ([&] (char* b, uint32_t c) { return na_atmos_state (a, id, b, c); })); },
                    [a, id] (int which, float* o) { return (int) na_atmos_view (a, id, (uint32_t) which, o); },
                    [a, id] (float* o, int n) { return (int) na_atmos_scope (a, id, o, (uint32_t) n); },
                    [] { return juce::String (naText ([] (char* b, uint32_t c) { return na_fx_kinds (b, c); })); });
                f.meter = [a, id] (float* peak, float* peaks, float* work, int n) { return (int) na_atmos_fx_meter (a, id, peak, peaks, work, (uint32_t) n); };
                if (args.size() > 5 && args[5] != "-")
                    for (const auto& kv : juce::StringArray::fromTokens (args[5].unquoted().startsWith ("@") ? juce::File (args[5].unquoted().substring (1)).loadFileAsString().trim() : args[5].unquoted(), ";\n", ""))
                                            {
                        // A value as JSON, or else as words (the command line keeps no quotes).
                        const auto text = kv.fromFirstOccurrenceOf ("=", false, false);
                        auto value = juce::JSON::fromString (text);
                        f.setKey (kv.upToFirstOccurrenceOf ("=", false, false), value.isVoid() ? juce::var (text) : value);
                    }
                f.reload();
                // ATMOS_STATE: print what the module holds, and the effects it offers.
                if (juce::SystemStats::getEnvironmentVariable ("ATMOS_STATE", {}).isNotEmpty())
                    std::printf ("%s\n%s\n", naText ([&] (char* b, uint32_t c) { return na_atmos_state (a, id, b, c); }).c_str(),
                                 naText ([] (char* b, uint32_t c) { return na_fx_kinds (b, c); }).c_str());
                if (args.size() > 6)
                {
                    // A note held a moment, so the pictures and the scope have something.
                    const int n = args[6].getIntValue();
                    na_note (a, id, 1, (uint32_t) n, 0.8f);
                    std::vector<float> l (512), r (512);
                    for (int k = 0; k < 60; ++k)
                    {
                        na_settle (a);
                        na_render (a, l.data(), r.data(), 512);
                        na_collect (a);
                    }
                    f.notePlayed (n);
                    f.poll();
                }
                // ATMOS_SAVE=<file>: save what it holds as a preset (a list of one), named after the file.
                if (auto save = juce::SystemStats::getEnvironmentVariable ("ATMOS_SAVE", {}); save.isNotEmpty())
                {
                    const auto name = juce::File (save).getFileNameWithoutExtension().toStdString();
                    juce::File (save).replaceWithText ("[" + juce::String (naText ([&] (char* b, uint32_t c) { return na_atmos_preset (a, id, name.c_str(), b, c); })) + "]");
                }
                if (auto w = juce::SystemStats::getEnvironmentVariable ("ATMOS_WINDOW", {}); w.isNotEmpty())
                    f.openFx (w.getIntValue());
                image = f.createComponentSnapshot (f.getLocalBounds(), true, scale);
                na_free (a);
            }
            else
            {
                const auto& captured = face::page (page);
                if (!captured.isObject())
                {
                    setApplicationReturnValue (2);
                    return quit();
                }
                face::Chrome chrome (captured);
                image = chrome.createComponentSnapshot (chrome.getLocalBounds(), true, scale);
            }
            juce::File out (args[2].unquoted());
            out.deleteFile();
            juce::FileOutputStream stream (out);
            juce::PNGImageFormat png;
            setApplicationReturnValue (stream.openedOk() && png.writeImageToStream (image, stream) ? 0 : 1);
            return quit();
        }
        window = std::make_unique<MainWindow> (getApplicationName());
    }
    void shutdown() override { window = nullptr; }
    void systemRequestedQuit() override { quit(); }

private:
    std::unique_ptr<MainWindow> window;
};
} // namespace

START_JUCE_APPLICATION (App)

// Wave's views past Play (Create, Matrix, FX), and what they share with it.
//
// The page shows one view at a time between its header and its dock (ui/app
// 394-wave-page.js `wvShowView`); each is captured whole, in every theme
// (tools/face-capture/capture-wave.mjs), and drawn by its own face::Chrome.
// Over it the view draws what moves, ported from the page's JS, and takes the
// pointer in its own part of the page; the header and the dock stay
// WaveFace's, the same in every view.
#pragma once

#include "Face.h"
#include "Stamp.h"
#include "WaveDraw.h"

#include <functional>

// What every view works with: the patch as the page holds it, its colours,
// how to set a key, how to ask the engine what the page asks MGL's server
// (`/api/wave/*`, na_wave_api), and the engine's last telemetry.
struct WaveCtx
{
    wave::Model* model = nullptr;
    wave::Cl* cl = nullptr;
    // Set a key, heard and kept (the page's wvLive and wvCommit).
    std::function<void (const juce::String& key, const juce::var& value)> set;
    // `method` and `path` as the page fetches them; the reply, and its status.
    std::function<juce::var (const juce::String& method, const juce::String& path, const juce::var& body, int& status)> api;
    // The rows changed here: every view that shows them draws them again.
    std::function<void()> modsChanged;
    // A whole patch arrived (a table, a board): read it again.
    std::function<void()> reload;
    // The page's own menu, as wvMenu: placed under `near` (page pixels), inside the page.
    std::function<void (juce::Component* menu, juce::Rectangle<float> near, float dx)> showMenu;
    std::function<void()> closeMenus;
    // `/api/wave/state` as last read (null when there is none).
    juce::var tele;
    // The page's view, `play` `create` `matrix` `fx`.
    juce::String view = "play";
    float lastT = 0;
};

class WaveView : public juce::Component
{
public:
    WaveView (WaveCtx& c, const juce::var& captured) : ctx (c), chrome (captured), cap (captured)
    {
        setInterceptsMouseClicks (false, false);
        addAndMakeVisible (chrome);
        setSize (chrome.getWidth(), chrome.getHeight());
    }

    // The pointer, in the view's own part of the page. False: not mine.
    virtual bool down (const juce::MouseEvent&) { return false; }
    virtual void dragged (const juce::MouseEvent&) {}
    virtual void up (const juce::MouseEvent&) {}
    virtual bool doubleClick (const juce::MouseEvent&) { return false; }
    virtual bool wheel (const juce::MouseEvent&, const juce::MouseWheelDetails&) { return false; }
    virtual bool rightClick (const juce::MouseEvent&) { return false; }
    virtual bool key (const juce::KeyPress&) { return false; }
    // The view is shown (`wvShowView`): read what it shows again.
    virtual void shown() {}
    // A key changed (anywhere): draw again what shows it.
    virtual void changed (const juce::String& /*key*/) {}
    // The frame, about thirty a second while the view is shown (`wvFrame`).
    virtual void tick (float /*t*/) {}
    // What a source can be dropped on here (`[data-tgt]`): where, which key,
    // and whether it is a knob (round).
    struct Target
    {
        juce::Rectangle<float> r;
        juce::String key;
        bool round = false;
    };
    virtual std::vector<Target> targets()
    {
        std::vector<Target> out;
        collectTargets (cap["tree"], out, false);
        return out;
    }
    static void collectTargets (const juce::var& n, std::vector<Target>& out, bool inKnob)
    {
        const bool knob = inKnob || face::matches (n, "wv-knob");
        if (n["data"]["tgt"].isString())
            out.push_back ({ face::rectOf (n), n["data"]["tgt"].toString(), knob });
        if (auto* kids = n["kids"].getArray())
            for (auto& k : *kids)
                collectTargets (k, out, knob);
    }
    // How long each of its layers takes to draw (the bench).
    virtual std::vector<std::pair<juce::String, double>> profile (float) { return {}; }

    face::Chrome& page() { return chrome; }

protected:
    // One of the view's drawings, drawn into its own cache and again only
    // when asked (the same as WaveFace's layers).
    struct Layer final : public juce::Component
    {
        std::function<void (juce::Graphics&)> draw;
        juce::String name;
        void paint (juce::Graphics& g) override { draw (g); }
    };
    WaveCtx& ctx;
    face::Chrome chrome;
    juce::var cap;

    // The page's nodes that match (an id, a class, a data attribute).
    const juce::var* node (const juce::String& what) const { return face::findNode (cap["tree"], what); }
    juce::Array<const juce::var*> nodes (const juce::String& what) const { return face::findAll (cap["tree"], what); }

    // Light a group of the page's switches as the page would (`.on`): each
    // drawn with the look of the group's captured lit node, or an unlit one.
    void light (const juce::Array<const juce::var*>& group, const std::function<bool (const juce::var&)>& on, const juce::var* unlitLook = nullptr)
    {
        const juce::var *lit = nullptr, *unlit = unlitLook;
        for (auto* n : group)
            if (face::matches (*n, "on"))
                lit = lit == nullptr ? n : lit;
            else if (unlit == nullptr)
                unlit = n;
        for (auto* n : group)
        {
            const int i = (int) (*n)["i"];
            const auto* want = on (*n) ? lit : unlit;
            if (want == nullptr)
                continue;
            auto it = chrome.styleFrom.find (i);
            if (it != chrome.styleFrom.end() && it->second == (int) (*want)["i"])
                continue;
            chrome.styleFrom[i] = (int) (*want)["i"];
            chrome.redraw (face::rectOf (*n));
        }
    }
    // A node's words written now, over the page (the readings).
    std::map<int, juce::String> texts;
    Layer* textLayer = nullptr;
    void say (const juce::String& id, const juce::String& t)
    {
        if (auto* n = node ("#" + id))
        {
            chrome.skipText.insert ((int) (*n)["i"]);
            if (texts[(int) (*n)["i"]] != t)
            {
                texts[(int) (*n)["i"]] = t;
                if (textLayer != nullptr)
                    textLayer->repaint();
            }
        }
    }
    void addTextLayer()
    {
        textLayer = addLayer ("texts", getLocalBounds().toFloat(), [this] (juce::Graphics& g) {
            for (const auto& entry : texts)
                if (auto it = chrome.nodes.find (entry.first); it != chrome.nodes.end())
                {
                    const int i = entry.first;
                    const auto& t = entry.second;
                    face::Stamp s;
                    s.text = [&] (const juce::var&, juce::String& out) { out = t; return true; };
                    s.skip = [&] (const juce::var& n) { return (int) n["i"] != i && n["text"].isVoid(); };
                    // Only the node's own words, over the frame that has the rest.
                    auto bare = it->second.clone();
                    if (auto* o = bare.getDynamicObject())
                        for (auto k : { "bg", "layers", "border", "shadows", "kids", "svg" })
                            o->removeProperty (k);
                    s.draw (g, bare);
                }
        });
    }

    std::vector<std::unique_ptr<Layer>> layers;
    std::map<juce::String, Layer*> named;

    Layer* addLayer (const juce::String& name, juce::Rectangle<float> r, std::function<void (juce::Graphics&)> draw)
    {
        auto l = std::make_unique<Layer>();
        l->draw = std::move (draw);
        l->name = name;
        l->setBounds (r.getSmallestIntegerContainer());
        l->setInterceptsMouseClicks (false, false);
        l->setBufferedToImage (true);
        addAndMakeVisible (*l);
        layers.push_back (std::move (l));
        named[name] = layers.back().get();
        return layers.back().get();
    }
    // A canvas of the page's, by id: drawn by `draw` on its own w x h, as the page draws it.
    Layer* addCanvas (const juce::String& id, std::function<void (c2d::Context&, float w, float h)> draw)
    {
        auto it = chrome.canvases.find (id);
        if (it == chrome.canvases.end())
            return nullptr;
        const auto r = face::rectOf (it->second);
        const auto box = r.getSmallestIntegerContainer();
        const juce::Point<float> off (r.getX() - (float) box.getX(), r.getY() - (float) box.getY());
        return addLayer (id, r, [draw, r, off] (juce::Graphics& g) {
            g.addTransform (juce::AffineTransform::translation (off.x, off.y));
            g.reduceClipRegion (juce::Rectangle<float> (r.getWidth(), r.getHeight()).getSmallestIntegerContainer());
            c2d::Context c (g, r.getWidth(), r.getHeight());
            draw (c, r.getWidth(), r.getHeight());
        });
    }
    void again (const juce::String& name)
    {
        if (auto it = named.find (name); it != named.end())
            it->second->repaint();
    }
    juce::Rectangle<float> canvasRect (const juce::String& id) const
    {
        auto it = chrome.canvases.find (id);
        return it == chrome.canvases.end() ? juce::Rectangle<float>() : face::rectOf (it->second);
    }
    std::vector<std::pair<juce::String, double>> timeLayers (float scale)
    {
        std::vector<std::pair<juce::String, double>> out;
        for (auto& l : layers)
        {
            juce::Image img (juce::Image::ARGB, juce::jmax (1, (int) ((float) l->getWidth() * scale)), juce::jmax (1, (int) ((float) l->getHeight() * scale)), true);
            juce::Graphics g (img);
            g.addTransform (juce::AffineTransform::scale (scale));
            const auto t0 = juce::Time::getMillisecondCounterHiRes();
            l->draw (g);
            out.push_back ({ l->name, juce::Time::getMillisecondCounterHiRes() - t0 });
        }
        return out;
    }
};

// The three views, each in its own file.
std::unique_ptr<WaveView> makeWaveCreate (WaveCtx&, const juce::var& captured);
std::unique_ptr<WaveView> makeWaveMatrix (WaveCtx&, const juce::var& captured);
std::unique_ptr<WaveView> makeWaveFx (WaveCtx&, const juce::var& captured);

// Give Create the face's table menu (the page's own, `wvTableMenu`).
void setCreateTableMenu (WaveView&, std::function<void (juce::Rectangle<float> near, int osc)>);
// Let the Matrix's row heads start a source's drag onto a control.
void setMatrixMapping (WaveView&, std::function<void (const juce::String& src, const juce::MouseEvent&)>);
// The FX view's sources strip starts a source's drag onto a control; its menus follow the pointer.
void setBoardMapping (WaveView&, std::function<void (const juce::String& src, const juce::MouseEvent&)>);
void boardMoved (WaveView&, const juce::MouseEvent&);

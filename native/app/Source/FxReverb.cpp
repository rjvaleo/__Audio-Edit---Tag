#include "FxReverb.h"

#include "Canvas2D.h"
#include "FxFace.h"

#include <cmath>

namespace
{
double dnum (const juce::var& v, double fallback = 0.0)
{
    if (v.isString())
        return v.toString().getDoubleValue();
    if (v.isBool())
        return (bool) v ? 1.0 : 0.0;
    return v.isVoid() || v.isUndefined() ? fallback : (double) v;
}
juce::Rectangle<float> rectOf (const juce::var& r)
{
    return { (float) dnum (r[0]), (float) dnum (r[1]), (float) dnum (r[2]), (float) dnum (r[3]) };
}
bool hasClass (const juce::var& n, const char* c)
{
    return juce::StringArray::fromTokens (n["cls"].toString(), " ", "").contains (c);
}
const juce::var* findIn (const juce::var& n, const std::function<bool (const juce::var&)>& want)
{
    if (want (n))
        return &n;
    if (auto* kids = n["kids"].getArray())
        for (const auto& k : *kids)
            if (auto* f = findIn (k, want))
                return f;
    return nullptr;
}
juce::String S (const std::string& s) { return juce::String::fromUTF8 (s.c_str()); }
} // namespace

class FxReverb::View final : public juce::Component
{
public:
    explicit View (FxReverb& r) : rv (r), band (r.owner.fx ("catalogue"))
    {
        setSize (1280, 640);
        setOpaque (true);
    }

    FxReverb& rv;
    juce::var api;
    FxCard band;
    juce::var slotV, mode, suite;
    rvd::Levels levels;
    rvd::Cam cam;
    rvd::Room room;
    std::unique_ptr<face::Chrome> frame;
    int seen = -1;
    double t0 = juce::Time::getMillisecondCounterHiRes() / 1000.0;
    double peakIn = 0, peakOut = 0;
    juce::String dragging;
    juce::Point<float> last;

    const juce::var& cap() const { return face::page ("fx")["reverb"]; }
    juce::Rectangle<float> part (const char* cls) const
    {
        if (auto* n = findIn (cap()["tree"], [cls] (const juce::var& x) { return hasClass (x, cls); }))
            return rectOf ((*n)["rect"]);
        return {};
    }

    void load()
    {
        const auto info = rv.owner.fx ("info");
        slotV = info["rack"]["slots"][rv.at];
        if (! slotV.isObject())
            return;
        api = rv.owner.fx ("catalogue");
        mode = suite = juce::var();
        if (auto* ss = api["suites"].getArray())
            for (const auto& s : *ss)
                if (auto* fs = s["families"].getArray())
                    for (const auto& f : *fs)
                        if (auto* ms = f["modes"].getArray())
                            for (const auto& m : *ms)
                                if ((slotV["mode"].isVoid() ? m["kind"] == slotV["kind"] : m["id"] == slotV["mode"]) && s["id"].toString() == "reverb")
                                {
                                    mode = m;
                                    suite = s;
                                }
        if (seen != face::stamp())
        {
            frame = std::make_unique<face::Chrome> (cap());
            // The bar's words, the views and the band are drawn live.
            std::function<void (const juce::var&)> skip = [&] (const juce::var& n) {
                if (hasClass (n, "rv-band") || hasClass (n, "rv-views"))
                    frame->skip.insert ((int) n["i"]);
                if (hasClass (n, "rv-src") || hasClass (n, "ui-dt"))
                    frame->skipText.insert ((int) n["i"]);
                if (auto* kids = n["kids"].getArray())
                    for (const auto& k : *kids)
                        skip (k);
            };
            skip (cap()["tree"]);
            seen = face::stamp();
        }
        const auto& bandTree = face::page ("fx")["reverbModes"][juce::Identifier (mode["id"].toString())]["band"];
        band.set (juce::JSON::parse (juce::JSON::toString (slotV)), info["rack"]["ranges"]);
        if (bandTree.isObject())
            band.useTree (bandTree);
        band.send = [this] (const juce::var& m) {
            auto o = juce::JSON::parse (juce::JSON::toString (m));
            o.getDynamicObject()->setProperty ("at", rv.at);
            rv.owner.fx ("rack", o);
            slotV = band.slot();
            repaint();
        };
        band.changed = [this] { repaint(); };
        repaint();
    }

    rvd::Values values() const
    {
        rvd::Values v;
        if (auto* o = slotV["params"].getDynamicObject())
            for (const auto& p : o->getProperties())
                v[p.name.toString().toStdString()] = dnum (p.value);
        return v;
    }
    rvd::Values place() const
    {
        auto v = rvd::rvPlaceDefaults();
        if (auto* o = slotV["place"].getDynamicObject())
            for (const auto& p : o->getProperties())
                v[p.name.toString().toStdString()] = dnum (p.value);
        return v;
    }
    rvd::Colours colours() const
    {
        rvd::Colours c;
        const auto& cl = face::page ("fx")["cl"];
        c.well = "rgb(6,7,10)";
        c.text = cl["t3"].toString().toStdString();
        c.textFull = cl["t"].toString().toStdString();
        return c;
    }

    juce::Rectangle<float> netBox() const { return part ("rv-net"); }
    juce::Point<float> bandAt() const { return part ("rv-band").getPosition(); }
    juce::Rectangle<float> roomBox() const { return part ("rv-room"); }

    void paint (juce::Graphics& g) override
    {
        if (frame == nullptr)
            return;
        frame->paintLook (g);
        const double t = juce::Time::getMillisecondCounterHiRes() / 1000.0 - t0;
        const auto v = values();
        const auto cl = colours();
        const auto modeId = mode["id"].toString().toStdString();
        // The bar.
        if (auto* src = findIn (cap()["tree"], [] (const juce::var& x) { return hasClass (x, "rv-src"); }))
            face::paintText (g, *src, rectOf ((*src)["rect"]), mode["source"].toString());
        int k = 0;
        std::function<void (const juce::var&)> dts = [&] (const juce::var& n) {
            if (hasClass (n, "ui-dt"))
            {
                juce::String fam;
                if (auto* fs = suite["families"].getArray())
                    for (const auto& f : *fs)
                        if (auto* ms = f["modes"].getArray())
                            for (const auto& m : *ms)
                                if (m["id"] == mode["id"])
                                    fam = f["label"].toString();
                face::paintText (g, n, rectOf (n["rect"]), k++ == 0 ? fam : mode["label"].toString());
            }
            if (auto* kids = n["kids"].getArray())
                for (const auto& c : *kids)
                    dts (c);
        };
        dts (cap()["tree"]);
        // The network, its overlay and the pad's mark.
        auto canvas = [&] (juce::Rectangle<float> r, const std::function<void (c2d::Context&, float, float)>& draw) {
            juce::Graphics::ScopedSaveState keep (g);
            g.reduceClipRegion (r.toNearestInt());
            g.setColour (c2d::css (S (cl.well)));
            g.fillRoundedRectangle (r, 6);
            g.setOrigin (r.getPosition().toInt());
            c2d::Context c (g, r.getWidth(), r.getHeight());
            draw (c, r.getWidth(), r.getHeight());
        };
        canvas (netBox(), [&] (c2d::Context& c, float w, float h) {
            rvd::rvDrawNet (c, w, h, rvd::rvNet (modeId, v), rvd::rvFrameOptions (v, levels.glow(), t, levels.moving()), cl);
            rvd::rvOverlay (c, w, h, v, levels.glow(), cl);
        });
        // The room.
        const auto pl = place();
        auto pv = rvd::rvRoomValues (pl, v.count ("freeze") ? std::optional<double> (v.at ("freeze")) : std::nullopt);
        canvas (roomBox(), [&] (c2d::Context& c, float w, float h) {
            room = rvd::rvDrawRoom (c, w, h, pv, levels.glow(), t - levels.pingAt, t, cl, cam);
        });
        if (auto* cb = findIn (cap()["tree"], [] (const juce::var& x) { return hasClass (x, "rv-cap") && hasClass (x, "b"); }))
            face::paintText (g, *cb, rectOf ((*cb)["rect"]), S (room.readout));
        // The meters.
        int m = 0;
        std::function<void (const juce::var&)> vus = [&] (const juce::var& n) {
            if (hasClass (n, "rv-vu"))
            {
                const auto r = rectOf (n["rect"]);
                const double pk = m++ == 0 ? peakIn : peakOut;
                const float h = (float) juce::jmin (1.0, pk) * r.getHeight();
                g.setColour (c2d::css ("rgb(" + S (cl.accent) + ")"));
                g.fillRect (r.withTop (r.getBottom() - h));
            }
            if (auto* kids = n["kids"].getArray())
                for (const auto& c : *kids)
                    vus (c);
        };
        vus (cap()["tree"]);
        // The band: the mode's controls, then Place (its tree is walked from the band).
        band.paint (g, bandAt());
    }

    void tick (double pin, double pout)
    {
        peakIn = pin;
        peakOut = pout;
        levels.step (pin, pout, juce::Time::getMillisecondCounterHiRes() / 1000.0 - t0);
        repaint();
    }

    void mouseDown (const juce::MouseEvent& e) override
    {
        const auto p = e.position;
        last = p;
        dragging.clear();
        if (part ("rv-x").contains (p))
            return rv.close();
        if (part ("rv-pwr").contains (p))
        {
            auto o = juce::var (new juce::DynamicObject());
            o.getDynamicObject()->setProperty ("op", "bypass");
            o.getDynamicObject()->setProperty ("at", rv.at);
            o.getDynamicObject()->setProperty ("on", (bool) slotV["bypassed"]);
            rv.owner.fx ("rack", o);
            rv.owner.reload();
            load();
            return;
        }
        if (part ("rv-modes").contains (p))
        {
            // Family and Mode: the module's listed modes, this one ticked.
            juce::PopupMenu menu;
            juce::StringArray ids;
            if (auto* fs = suite["families"].getArray())
                for (const auto& f : *fs)
                {
                    menu.addSectionHeader (f["label"].toString());
                    if (auto* ms = f["modes"].getArray())
                        for (const auto& m : *ms)
                            if ((bool) m["listed"] || m["id"] == mode["id"])
                            {
                                ids.add (m["id"].toString());
                                menu.addItem (ids.size(), m["label"].toString(), true, m["id"] == mode["id"]);
                            }
                }
            menu.showMenuAsync (juce::PopupMenu::Options(), [this, ids] (int r) {
                if (r <= 0)
                    return;
                auto o = juce::var (new juce::DynamicObject());
                o.getDynamicObject()->setProperty ("op", "mode");
                o.getDynamicObject()->setProperty ("at", rv.at);
                o.getDynamicObject()->setProperty ("suite", "reverb");
                o.getDynamicObject()->setProperty ("mode", ids[r - 1]);
                rv.owner.fx ("rack", o);
                rv.owner.reload();
                load();
            });
            return;
        }
        if (netBox().contains (p))
        {
            dragging = "net";
            return mouseDrag (e);
        }
        if (roomBox().contains (p))
        {
            const auto rp = p - roomBox().getPosition();
            dragging = rvd::rvRoomOnSound (room, rp.x, rp.y) ? (e.mods.isShiftDown() ? "height" : "sound") : "turn";
            return;
        }
        if (band.mouseDown (p - bandAt(), e.mods))
            dragging = "band";
    }

    void setParam (const juce::String& key, double v)
    {
        auto o = juce::var (new juce::DynamicObject());
        o.getDynamicObject()->setProperty ("op", "param");
        o.getDynamicObject()->setProperty ("at", rv.at);
        o.getDynamicObject()->setProperty ("id", slotV["id"]);
        o.getDynamicObject()->setProperty ("key", key);
        o.getDynamicObject()->setProperty ("value", v);
        rv.owner.fx ("rack", o);
        const auto info = rv.owner.fx ("info");
        slotV = info["rack"]["slots"][rv.at];
        band.set (juce::JSON::parse (juce::JSON::toString (slotV)), info["rack"]["ranges"]);
    }

    void mouseDrag (const juce::MouseEvent& e) override
    {
        const auto p = e.position;
        if (dragging == "band")
            band.mouseDrag (p - bandAt(), e.mods);
        else if (dragging == "net")
        {
            std::vector<std::string> keys;
            if (auto* o = slotV["params"].getDynamicObject())
                for (const auto& pr : o->getProperties())
                    keys.push_back (pr.name.toString().toStdString());
            const auto& sh = fxp::findShaper (api, slotV["kind"].toString().toStdString());
            std::optional<rvd::Pad> own;
            if (sh["panel"]["pad"].isObject())
                own = rvd::Pad { sh["panel"]["pad"]["x"].toString().toStdString(), sh["panel"]["pad"]["y"].toString().toStdString() };
            const auto pad = rvd::rvPadOf (mode["id"].toString().toStdString(), own, keys);
            if (pad)
            {
                const auto r = netBox();
                const auto m = fxp::fxModel (slotV, sh);
                if (auto* px = m.byKey (pad->x))
                    setParam (S (pad->x), fxp::fxClamp (*px, fxp::unitValue (juce::jlimit (0.0, 1.0, (double) (p.x - r.getX()) / r.getWidth()), px->min, px->max, fxp::fxIsLog (*px))));
                if (auto* py = m.byKey (pad->y))
                    setParam (S (pad->y), fxp::fxClamp (*py, fxp::unitValue (juce::jlimit (0.0, 1.0, 1 - (double) (p.y - r.getY()) / r.getHeight()), py->min, py->max, fxp::fxIsLog (*py))));
            }
        }
        else if (dragging == "turn")
            rvd::rvRoomTurn (cam, p.x - last.x, p.y - last.y);
        else if (dragging == "height")
            setParam ("place.height", rvd::rvRoomDragHeight (place()["height"], p.y - last.y));
        else if (dragging == "sound")
        {
            double pos = 0, dist = 0;
            const auto rp = p - roomBox().getPosition();
            if (rvd::rvRoomDragSound (room, rp.x, rp.y, pos, dist))
            {
                setParam ("place.pos", pos);
                setParam ("place.dist", dist);
            }
        }
        last = p;
        repaint();
    }

    void mouseUp (const juce::MouseEvent&) override
    {
        if (dragging == "band")
            band.mouseUp();
        dragging.clear();
    }

    void mouseDoubleClick (const juce::MouseEvent& e) override
    {
        if (roomBox().contains (e.position))
            cam = {};
        else
            band.doubleClick (e.position - bandAt());
        repaint();
    }

    void mouseWheelMove (const juce::MouseEvent& e, const juce::MouseWheelDetails& w) override
    {
        if (band.wheel (e.position - bandAt(), w.deltaY, e.mods.isShiftDown()))
            repaint();
    }

    bool keyPressed (const juce::KeyPress& k) override
    {
        if (k == juce::KeyPress::escapeKey)
        {
            rv.close();
            return true;
        }
        return false;
    }
};

class FxReverb::Window final : public juce::DocumentWindow
{
public:
    explicit Window (FxReverb& r) : juce::DocumentWindow ("Reverb", juce::Colours::black, juce::DocumentWindow::closeButton), rv (r)
    {
        setUsingNativeTitleBar (true);
        view = new View (r);
        setContentOwned (view, true);
        setResizable (false, false);
        centreWithSize (1280, 640);
    }
    void closeButtonPressed() override { rv.close(); }
    FxReverb& rv;
    View* view = nullptr;
};

FxReverb::FxReverb (FxFace& o) : owner (o) {}

FxReverb::~FxReverb()
{
    stopTimer();
}

void FxReverb::open (int slot)
{
    at = slot;
    if (window == nullptr)
        window = std::make_unique<Window> (*this);
    window->view->load();
    window->setVisible (true);
    window->toFront (true);
    startTimerHz (30);
}

void FxReverb::changed()
{
    if (window != nullptr && window->isVisible())
        window->view->load();
}

void FxReverb::close()
{
    stopTimer();
    if (window != nullptr)
        window->setVisible (false);
}

bool FxReverb::isOpen() const { return window != nullptr && window->isVisible(); }

juce::Component* FxReverb::view() const { return window != nullptr ? window->view : nullptr; }

void FxReverb::timerCallback()
{
    if (window == nullptr)
        return;
    const auto lv = owner.fx ("levels");
    const auto in = lv["stages"][at], out = lv["stages"][at + 1];
    window->view->tick (juce::jmax (dnum (in[0]), dnum (in[1])), juce::jmax (dnum (out[0]), dnum (out[1])));
}

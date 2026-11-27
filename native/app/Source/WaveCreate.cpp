// Wave's Create view: the table maker (ui/app/392-wave-create.js), line for
// line. Draw a frame, paint its harmonics, process one frame or all of them,
// fill between keyframes, or slice a sound into the table. Every edit is the
// oscillator's own table, sent whole (`POST /api/wave/table`) when the stroke
// ends or the button is pressed; the engine stores it and rebuilds it.

#include "WaveView.h"

#include <juce_audio_formats/juce_audio_formats.h>

#include <optional>
#include <set>

namespace
{
constexpr float TAU = juce::MathConstants<float>::twoPi;
constexpr float PI = juce::MathConstants<float>::pi;
constexpr int NP = wave::NP;
using wave::Frame;

float clamp (float v, float a = 0, float b = 1) { return juce::jlimit (a, b, v); }

const std::vector<std::pair<juce::String, juce::String>> tools {
    { "pen", "Draw" }, { "line", "Line" }, { "curve", "Curve" }, { "pts", "Points" }, { "erase", "Smooth" },
    { "sine", "Stamp sine" }, { "saw", "Stamp saw" }, { "sq", "Stamp square" },
};

Frame specMap (const Frame& f, const std::function<void (wave::Spec&)>& fn)
{
    auto s = wave::spectrumOf (f, 48);
    fn (s);
    return wave::normalised (wave::fromSpec (s.re, s.im));
}

// The twelve processes (`WV_OPS`).
Frame op (const juce::String& k, const Frame& f)
{
    Frame o = f;
    if (k == "norm")
        return wave::normalised (f);
    if (k == "dc")
    {
        float m = 0;
        for (float v : f)
            m += v;
        m /= NP;
        for (auto& v : o)
            v -= m;
        return o;
    }
    if (k == "flip")
    {
        for (auto& v : o)
            v = -v;
        return o;
    }
    if (k == "rev")
    {
        std::reverse (o.begin(), o.end());
        return o;
    }
    if (k == "smooth")
    {
        for (int i = 0; i < NP; ++i)
            o[(size_t) i] = (f[(size_t) ((i - 2 + NP) % NP)] + f[(size_t) ((i - 1 + NP) % NP)] + f[(size_t) i] + f[(size_t) ((i + 1) % NP)] + f[(size_t) ((i + 2) % NP)]) / 5;
        return o;
    }
    if (k == "fold")
    {
        for (auto& v : o)
        {
            float y = v * 1.8f;
            while (std::abs (y) > 1)
                y = y > 1 ? 2 - y : -2 - y;
            v = y;
        }
        return o;
    }
    if (k == "redux")
    {
        for (int i = 0; i < NP; ++i)
            o[(size_t) i] = f[(size_t) (i - i % 8)];
        return o;
    }
    if (k == "nofund")
        return specMap (f, [] (wave::Spec& s) { s.re[0] = 0; s.im[0] = 0; });
    if (k == "odd")
        return specMap (f, [] (wave::Spec& s) { for (int q = 1; q < 48; q += 2) s.re[(size_t) q] = s.im[(size_t) q] = 0; });
    if (k == "bright")
        return specMap (f, [] (wave::Spec& s) { for (int q = 0; q < 48; ++q) { s.re[(size_t) q] *= 1 + (float) q * 0.06f; s.im[(size_t) q] *= 1 + (float) q * 0.06f; } });
    if (k == "dark")
        return specMap (f, [] (wave::Spec& s) { for (int q = 0; q < 48; ++q) { s.re[(size_t) q] /= 1 + (float) q * 0.15f; s.im[(size_t) q] /= 1 + (float) q * 0.15f; } });
    if (k == "align")
        return specMap (f, [] (wave::Spec& s) {
            for (int q = 0; q < 48; ++q)
            {
                const float m = std::hypot (s.re[(size_t) q], s.im[(size_t) q]);
                s.re[(size_t) q] = 0;
                s.im[(size_t) q] = m;
            }
        });
    return o;
}

class WaveCreate final : public WaveView, private juce::Timer
{
public:
    WaveCreate (WaveCtx& c, const juce::var& captured) : WaveView (c, captured)
    {
        build();
    }

    void shown() override
    {
        // The oscillator last worked on in Play is the one edited here, on the
        // frame it is playing: what is drawn is what is heard.
        osc = juce::jlimit (0, 2, ctx.editOsc);
        followPos();
        sync();
        for (auto& l : layers)
            l->repaint();
    }

    void changed (const juce::String& key) override
    {
        if (key.startsWith ("osc" + juce::String (osc) + "."))
        {
            sync();
            redrawAll();
        }
    }

    std::vector<std::pair<juce::String, double>> profile (float s) override { return timeLayers (s); }

    bool key (const juce::KeyPress& k) override
    {
        // ⌘Z undoes the last edit, in Create.
        if ((k.getModifiers().isCommandDown() || k.getModifiers().isCtrlDown()) && !k.getModifiers().isShiftDown() && k.getKeyCode() == 'Z')
        {
            undo();
            return true;
        }
        return false;
    }

    bool down (const juce::MouseEvent& e) override
    {
        const auto at = e.position;
        drag = nullptr;
        dragEnd = nullptr;
        for (auto* n : nodes ("data-tool"))
            if (face::rectOf (*n).contains (at))
            {
                const auto k = (*n)["data"]["tool"].toString();
                if (k == "sine" || k == "saw" || k == "sq")
                {
                    stamp (k);
                    return true;
                }
                tool = k;
                syncLit();
                sync();
                return true;
            }
        if (auto* n = node ("#wvCTable"); n != nullptr && face::rectOf (*n).contains (at))
        {
            if (tableMenu)
                tableMenu (face::rectOf (*n), osc);
            return true;
        }
        // The caption names the oscillator being edited; a press takes the next.
        if (auto* n = caption(); n != nullptr && face::rectOf (*n).contains (at))
        {
            osc = (osc + 1) % 3;
            ctx.editOsc = osc;
            undos.clear();
            followPos();
            sync();
            redrawAll();
            return true;
        }
        auto seg = [&] (const juce::String& id, const std::function<void (const juce::String&)>& pick) {
            for (auto* n : nodes ("#" + id))
                if (auto* kids = (*n)["kids"].getArray())
                    for (const auto& k : *kids)
                        if (face::rectOf (k).contains (at) && k["data"]["k"].isString())
                        {
                            pick (k["data"]["k"].toString());
                            syncLit();
                            return true;
                        }
            return false;
        };
        if (seg ("wvScope", [this] (const juce::String& k) { scopeAll = k == "all"; }))
            return true;
        if (seg ("wvSnap", [this] (const juce::String& k) { snap = k.getIntValue(); }))
            return true;
        if (seg ("wvImportMode", [this] (const juce::String& k) { importMode = k; }))
            return true;
        for (auto* n : nodes ("data-op"))
            if (face::rectOf (*n).contains (at))
            {
                pushUndo();
                auto& T = frames();
                const auto k = (*n)["data"]["op"].toString();
                if (scopeAll)
                    for (auto& f : T)
                        f = op (k, f);
                else
                    T[(size_t) frame] = op (k, T[(size_t) frame]);
                flash (face::rectOf (*n), (*n)["radius"]);
                save();
                return true;
            }
        for (auto* n : nodes ("data-morph"))
            if (face::rectOf (*n).contains (at))
            {
                pushUndo();
                morphFill ((*n)["data"]["morph"].toString());
                flash (face::rectOf (*n), (*n)["radius"]);
                save();
                return true;
            }
        if (auto* n = node ("#wvThroughGrain"); n != nullptr && face::rectOf (*n).contains (at))
        {
            grain = !grain;
            syncLit();
            return true;
        }
        if (auto* n = node ("#wvLibChoose"); n != nullptr && face::rectOf (*n).contains (at))
        {
            chooseSound();
            return true;
        }

        // Drawing. Line and Curve redraw from where the stroke began, so the
        // shape follows the pointer until it is let go.
        const auto wr = canvasRect ("wvCWave");
        if (wr.contains (at))
        {
            pushUndo();
            last.reset();
            start = point (e.position - wr.getPosition(), wr);
            before = frames()[(size_t) frame];
            paintAt (e.position - wr.getPosition(), wr);
            drag = [this, wr] (const juce::MouseEvent& ev) { paintAt (ev.position - wr.getPosition(), wr); };
            dragEnd = [this] { last.reset(); save(); };
            return true;
        }
        const auto hr = canvasRect ("wvCHarm");
        if (hr.contains (at))
        {
            pushUndo();
            hk = (int) std::floor ((at.x - hr.getX() - 6) / ((hr.getWidth() - 12) / 48));
            setH (e.position - hr.getPosition(), hr, e.mods.isShiftDown());
            drag = [this, hr] (const juce::MouseEvent& ev) { setH (ev.position - hr.getPosition(), hr, ev.mods.isShiftDown()); };
            dragEnd = [this] { save(); };
            return true;
        }
        const auto sr = canvasRect ("wvCStrip");
        if (sr.contains (at))
        {
            const int i = stripFrame (at.x - sr.getX(), sr);
            if (e.mods.isAltDown())
                toggleKey (i);
            else
            {
                frame = i;
                ctx.set ("osc" + juce::String (osc) + ".pos", (double) i / (double) juce::jmax (1, (int) frames().size() - 1));
                sync();
                redrawAll();
            }
            return true;
        }
        return false;
    }

    void dragged (const juce::MouseEvent& e) override
    {
        if (drag)
            drag (e);
    }

    void up (const juce::MouseEvent&) override
    {
        if (dragEnd)
            dragEnd();
        drag = nullptr;
        dragEnd = nullptr;
    }

    bool doubleClick (const juce::MouseEvent& e) override
    {
        const auto sr = canvasRect ("wvCStrip");
        if (!sr.contains (e.position))
            return false;
        toggleKey (stripFrame (e.position.x - sr.getX(), sr));
        return true;
    }

    // Opening the table menu belongs to the face (it is the page's menu).
    std::function<void (juce::Rectangle<float> near, int osc)> tableMenu;

private:
    int osc = 0, frame = 44;
    std::set<int> keys { 0, 63 };
    juce::String tool = "pen", importMode = "count";
    bool scopeAll = false, grain = true;
    int snap = 16, hk = -1;
    struct Undo
    {
        juce::String name;
        wave::Table frames;
    };
    std::vector<Undo> undos;
    std::optional<std::pair<int, float>> last;
    std::pair<int, float> start;
    Frame before {};
    juce::String libName = "No sound chosen", libInfo = "Select one in the library, then Choose";
    std::function<void (const juce::MouseEvent&)> drag;
    std::function<void()> dragEnd;
    std::unique_ptr<juce::FileChooser> chooser;
    juce::Rectangle<float> flashR;
    juce::var flashRadius;
    double flashAt = 0;
    Layer* flashLayer = nullptr;

    wave::Model& model() { return *ctx.model; }
    const wave::Cl& cl() const { return *ctx.cl; }
    // The frame the oscillator is on (its position along the table).
    void followPos()
    {
        if (tableName().isEmpty())
            return;
        const int n = (int) model().editable (tableName()).size();
        frame = juce::jlimit (0, juce::jmax (0, n - 1), juce::roundToInt (clamp (model().g ("osc" + juce::String (osc) + ".pos")) * (float) (n - 1)));
    }
    const juce::var* caption() const
    {
        for (auto* n : nodes ("wv-nm"))
            if ((*n)["text"]["text"].toString().startsWith ("OSC A"))
                return n;
        return nullptr;
    }
    juce::String tableName() { return model().s ("osc" + juce::String (osc) + ".table"); }

    // The table being edited, as frames the page owns (`wvEditFrames`).
    wave::Table& frames()
    {
        // Not read yet (the patch comes after the face is built): nothing to edit.
        static wave::Table none (2, Frame {});
        if (tableName().isEmpty())
            return none;
        auto& T = model().editable (tableName());
        frame = juce::jlimit (0, juce::jmax (0, (int) T.size() - 1), frame);
        return T;
    }

    void pushUndo()
    {
        undos.push_back ({ tableName(), frames() });
        if (undos.size() > 40)
            undos.erase (undos.begin());
    }

    void undo()
    {
        if (undos.empty())
            return;
        auto u = undos.back();
        undos.pop_back();
        model().putTable (u.name, u.frames);
        save();
    }

    // Send the edited table. The engine answers with the name it stored it
    // under, which the oscillator then uses.
    void save()
    {
        const auto name = tableName();
        juce::Array<juce::var> list;
        for (const auto& f : frames())
        {
            juce::Array<juce::var> one;
            for (float v : f)
                one.add (std::round ((double) v * 1e5) / 1e5);
            list.add (one);
        }
        auto* body = new juce::DynamicObject();
        body->setProperty ("name", name);
        body->setProperty ("frames", list);
        int status = 0;
        const auto j = ctx.api ? ctx.api ("POST", "/api/wave/table", juce::var (body), status) : juce::var();
        if (status == 200 && j["name"].isString() && j["name"].toString().isNotEmpty() && j["name"].toString() != name)
        {
            model().putTable (j["name"].toString(), frames());
            ctx.set ("osc" + juce::String (osc) + ".table", j["name"]);
        }
        sync();
        redrawAll();
    }

    std::pair<int, float> point (juce::Point<float> p, juce::Rectangle<float> r) const
    {
        const float u = clamp ((p.x - 10) / (r.getWidth() - 20)), v = clamp (1 - (p.y - 10) / (r.getHeight() - 20)) * 2 - 1;
        const float q = (float) snap;
        return { juce::roundToInt (u * (NP - 1)), snap != 0 ? std::round (v * q / 2) / (q / 2) : v };
    }

    void paintAt (juce::Point<float> p, juce::Rectangle<float> r)
    {
        auto& f = frames()[(size_t) frame];
        const auto [i, vv] = point (p, r);
        if (tool == "erase")
        {
            for (int k = -6; k <= 6; ++k)
            {
                const int j = (i + k + NP) % NP;
                f[(size_t) j] = (f[(size_t) ((j - 1 + NP) % NP)] + f[(size_t) j] * 2 + f[(size_t) ((j + 1) % NP)]) / 4;
            }
        }
        else if (tool == "line" || tool == "curve")
        {
            f = before;
            const auto [a, b] = start;
            for (int j = juce::jmin (a, i); j <= juce::jmax (a, i); ++j)
            {
                float u = (float) (j - a) / (float) (i - a != 0 ? i - a : 1);
                if (tool == "curve")
                    u = 0.5f - 0.5f * std::cos (PI * u);
                f[(size_t) j] = b + (vv - b) * u;
            }
        }
        else if (last && tool == "pen")
        {
            const auto [a, b] = *last;
            for (int j = juce::jmin (a, i); j <= juce::jmax (a, i); ++j)
                f[(size_t) j] = b + (vv - b) * ((float) (j - a) / (float) (i - a != 0 ? i - a : 1));
            last = std::pair { i, vv };
        }
        else
        {
            f[(size_t) i] = vv;
            last = std::pair { i, vv };
        }
        sync(); redrawAll();
    }

    void setH (juce::Point<float> p, juce::Rectangle<float> r, bool shift)
    {
        if (hk < 0 || hk >= 48)
            return;
        auto& f = frames()[(size_t) frame];
        auto sp = wave::spectrumOf (f, 48);
        float nm = std::hypot (sp.re[(size_t) hk], sp.im[(size_t) hk]), nph = std::atan2 (sp.im[(size_t) hk], sp.re[(size_t) hk]);
        if (shift)
            nph = (1 - clamp (p.y / r.getHeight())) * TAU - PI;
        else
            nm = std::pow (clamp (1 - (p.y - 6) / (r.getHeight() - 12)), 2.0f);
        sp.re[(size_t) hk] = nm * std::cos (nph);
        sp.im[(size_t) hk] = nm * std::sin (nph);
        f = wave::normalised (wave::fromSpec (sp.re, sp.im));
        sync(); redrawAll();
    }

    int stripFrame (float x, juce::Rectangle<float> r)
    {
        const int n = (int) frames().size();
        return juce::jlimit (0, n - 1, juce::roundToInt ((x - 6) / ((r.getWidth() - 12) / (float) n) - 0.5f));
    }

    void toggleKey (int i)
    {
        if (!keys.erase (i))
            keys.insert (i);
        again ("wvCStrip");
    }

    void stamp (const juce::String& k)
    {
        pushUndo();
        auto& f = frames()[(size_t) frame];
        for (int n = 0; n < NP; ++n)
        {
            const float x = (float) n / NP;
            f[(size_t) n] = k == "sine" ? std::sin (TAU * x) : k == "saw" ? 1 - 2 * x : x < 0.5f ? 1.0f : -1.0f;
        }
        save();
    }

    void morphFill (const juce::String& kind)
    {
        auto& T = frames();
        std::vector<int> ks;
        for (int k : keys)
            if (k < (int) T.size())
                ks.push_back (k);
        for (size_t q = 1; q < ks.size(); ++q)
        {
            const int a = ks[q - 1], b = ks[q];
            const Frame A = T[(size_t) a], B = T[(size_t) b];
            const auto sa = wave::spectrumOf (A, 48), sb = wave::spectrumOf (B, 48);
            for (int i = a + 1; i < b; ++i)
            {
                const float u = (float) (i - a) / (float) (b - a);
                if (kind == "xf")
                {
                    for (int n = 0; n < NP; ++n)
                        T[(size_t) i][(size_t) n] = A[(size_t) n] * (1 - u) + B[(size_t) n] * u;
                    continue;
                }
                std::vector<float> re (48), im (48);
                for (size_t k = 0; k < 48; ++k)
                {
                    const float m = std::hypot (sa.re[k], sa.im[k]) * (1 - u) + std::hypot (sb.re[k], sb.im[k]) * u;
                    const float ph = kind == "zero" ? PI / 2 : std::atan2 (sa.im[k], sa.re[k]) * (1 - u) + std::atan2 (sb.im[k], sb.re[k]) * u;
                    re[k] = m * std::cos (ph);
                    im[k] = m * std::sin (ph);
                }
                T[(size_t) i] = wave::normalised (wave::fromSpec (re, im));
            }
        }
    }

    // Slice a sound into the table, and give it to osc A. The page slices the
    // library's selected sound; here the sound is chosen from disk.
    void chooseSound()
    {
        chooser = std::make_unique<juce::FileChooser> ("Choose a sound to slice into the table", juce::File(), "*.wav;*.aif;*.aiff;*.flac;*.mp3;*.ogg;*.m4a");
        chooser->launchAsync (juce::FileBrowserComponent::openMode | juce::FileBrowserComponent::canSelectFiles, [this] (const juce::FileChooser& fc) {
            const auto f = fc.getResult();
            if (!f.existsAsFile())
                return;
            importSound (f);
        });
    }

public:
    void importSound (const juce::File& f)
    {
        libName = f.getFileName();
        libInfo = "From the library";
        juce::AudioFormatManager fm;
        fm.registerBasicFormats();
        if (std::unique_ptr<juce::AudioFormatReader> r (fm.createReaderFor (f)); r != nullptr && r->sampleRate > 0)
            libInfo = juce::String ((double) r->lengthInSamples / r->sampleRate, 1) + juce::String::fromUTF8 (" s \xc2\xb7 ") + juce::String (r->sampleRate / 1000, 1) + " kHz";
        const auto name = f.getFileNameWithoutExtension();
        auto* body = new juce::DynamicObject();
        body->setProperty ("sound", f.getFullPathName());
        body->setProperty ("name", name);
        body->setProperty ("mode", importMode);
        body->setProperty ("frames", 64);
        body->setProperty ("grain", grain);
        int status = 0;
        const auto j = ctx.api ? ctx.api ("POST", "/api/wave/table/import", juce::var (body), status) : juce::var();
        if (status != 200 || !j["frames"].isArray())
        {
            libInfo = ctx.api ? "The engine could not slice that sound" : "The synth engine is not connected";
            sync();
            return;
        }
        const auto stored = j["name"].toString().isNotEmpty() ? j["name"].toString() : name;
        wave::Table T;
        for (const auto& fr : *j["frames"].getArray())
        {
            Frame one {};
            auto* a = fr.getArray();
            const int len = a != nullptr ? a->size() : 0;
            for (int n = 0; n < NP && len > 0; ++n)
            {
                // `wvResample`, for a frame not at 256 points.
                const double p = len == NP ? n : (double) n / NP * len;
                const int i = (int) std::floor (p);
                const float u = (float) (p - i), x0 = (float) (double) a->getReference (i % len), x1 = (float) (double) a->getReference ((i + 1) % len);
                one[(size_t) n] = x0 * (1 - u) + x1 * u;
            }
            T.push_back (one);
        }
        model().putTable (stored, T);
        frame = 0;
        ctx.set ("osc" + juce::String (osc) + ".table", stored);
        sync();
        redrawAll();
    }

private:
    void flash (juce::Rectangle<float> r, const juce::var& radius)
    {
        flashR = r;
        flashRadius = radius;
        flashAt = juce::Time::getMillisecondCounterHiRes();
        if (flashLayer != nullptr)
            flashLayer->repaint();
        startTimerHz (60);
    }

    void timerCallback() override
    {
        if (flashLayer != nullptr)
            flashLayer->repaint();
        if (juce::Time::getMillisecondCounterHiRes() - flashAt > 360)
            stopTimer();
    }

    void redrawAll()
    {
        for (auto* id : { "wvCWave", "wvCHarm", "wvCStrip", "wvC3d" })
            again (id);
    }

    void syncLit()
    {
        light (nodes ("data-tool"), [this] (const juce::var& n) { return n["data"]["tool"].toString() == tool; });
        auto group = [&] (const juce::String& id, const std::function<bool (const juce::String&)>& on) {
            juce::Array<const juce::var*> g;
            if (auto* p = node ("#" + id))
                if (auto* kids = (*p)["kids"].getArray())
                    for (auto& k : *kids)
                        g.add (&k);
            light (g, [&] (const juce::var& n) { return on (n["data"]["k"].toString()); });
        };
        group ("wvScope", [this] (const juce::String& k) { return (k == "all") == scopeAll; });
        group ("wvSnap", [this] (const juce::String& k) { return k.getIntValue() == snap; });
        group ("wvImportMode", [this] (const juce::String& k) { return k == importMode; });
        if (auto* g = node ("#wvThroughGrain"))
            light ({ g }, [this] (const juce::var&) { return grain; }, node ("#wvLibChoose"));
    }

    void sync()
    {
        auto& T = frames();
        const int n = (int) T.size();
        say ("wvCTableName", tableName());
        if (auto* n = caption())
            sayNode (*n, "OSC " + juce::String::charToString ((juce::juce_wchar) ('A' + osc)) + juce::String::fromUTF8 (" \xc2\xb7 FRAME"));
        for (const auto& [k, name] : tools)
            if (k == tool)
                say ("wvCTool", name);
        say ("wvCFrameRo", "Frame " + juce::String (frame + 1).paddedLeft ('0', 2) + " / " + juce::String (n));
        const auto m = wave::magsOf (wave::spectrumOf (T[(size_t) frame], 48));
        say ("wvCHarmRo", "brightest: harmonic " + juce::String (1 + (int) (std::max_element (m.begin(), m.end()) - m.begin())));
        say ("wvCTableRo", juce::String (n) + juce::String::fromUTF8 (" frames \xc2\xb7 2048"));
        say ("wvLibName", libName);
        say ("wvLibInfo", libInfo);
    }

    void build()
    {
        addCanvas ("wvCWave", [this] (c2d::Context& c, float w, float h) { drawWave (c, w, h); });
        addCanvas ("wvCHarm", [this] (c2d::Context& c, float w, float h) { drawHarm (c, w, h); });
        addCanvas ("wvCStrip", [this] (c2d::Context& c, float w, float h) { drawStrip (c, w, h); });
        addCanvas ("wvC3d", [this] (c2d::Context& c, float w, float h) {
            auto& T = frames();
            wave::draw3D (c, w, h, cl(), T, (float) frame / (float) juce::jmax (1, (int) T.size() - 1), "off", 0, 0.55f, 0.3f, false, 40);
        });
        addCanvas ("wvLibWave", [this] (c2d::Context& c, float w, float h) {
            // A made-up sound: a stand-in until one is chosen (`wvDrawLibWave`).
            int s = 3;
            c.fillStyle = cl().bloom (0.55f);
            for (float x = 0; x < w; x += 2)
            {
                s = (int) (((long long) s * 16807) % 2147483647);
                const float env = std::exp (-x / 60) * 0.8f + 0.2f * std::pow (std::sin (x / 9), 2.0f);
                const float a = env * (0.4f + 0.6f * ((float) s / 2147483647.0f)) * h * 0.45f;
                c.fillRect (x, h / 2 - a, 1.4f, a * 2);
            }
            c.fillStyle = cl().acc;
            c.fillRect (w * 0.55f, 2, w * 0.03f, h - 4);
        });
        flashLayer = addLayer ("flash", getLocalBounds().toFloat(), [this] (juce::Graphics& g) {
            const double age = juce::Time::getMillisecondCounterHiRes() - flashAt;
            if (age > 350 || flashR.isEmpty())
                return;
            g.setColour (juce::Colours::white.withAlpha ((float) (0.22 * (1 - age / 350))));
            g.fillPath (face::box (flashR, flashRadius));
        });
        flashLayer->setBufferedToImage (false);
        addTextLayer();
        syncLit();
    }

    void drawWave (c2d::Context& c, float w, float h)
    {
        auto& T = frames();
        const auto& f = T[(size_t) frame];
        c.strokeStyle = c2d::css ("rgba(255,255,255,.045)");
        c.lineWidth = 1;
        for (int i = 0; i <= 16; ++i)
        {
            const float x = 10 + (float) i * (w - 20) / 16;
            c.beginPath();
            c.moveTo (x, 6);
            c.lineTo (x, h - 6);
            c.stroke();
        }
        for (int i = 0; i <= 8; ++i)
        {
            const float y = 10 + (float) i * (h - 20) / 8;
            c.beginPath();
            c.moveTo (6, y);
            c.lineTo (w - 6, y);
            c.stroke();
        }
        c.strokeStyle = c2d::css ("rgba(255,255,255,.12)");
        c.beginPath();
        c.moveTo (6, h / 2);
        c.lineTo (w - 6, h / 2);
        c.stroke();
        auto yv = [h] (float v) { return 10 + (1 - (v + 1) / 2) * (h - 20); };
        for (int nb : { frame - 1, frame + 1 })
        {
            if (nb < 0 || nb >= (int) T.size())
                continue;
            c.strokeStyle = cl().bloom (0.14f);
            const auto& g = T[(size_t) nb];
            c.stroke (wave::path ([&] (float u) { return juce::Point<float> (10 + u * (w - 20), yv (wave::rd (g, u))); }, 200));
        }
        const auto p = wave::path ([&] (float u) { return juce::Point<float> (10 + u * (w - 20), yv (wave::rd (f, u))); }, 400);
        wave::under (c, p, 10, w - 10, h / 2, 10, cl(), 0.16f);
        wave::trace (c, p, cl(), 2);
    }

    void drawHarm (c2d::Context& c, float w, float h)
    {
        const auto& f = frames()[(size_t) frame];
        const auto sp = wave::spectrumOf (f, 48);
        const auto m = wave::magsOf (sp);
        const float bw = (w - 12) / 48;
        for (int k = 0; k < 48; ++k)
        {
            const float x = 6 + (float) k * bw, hh = std::sqrt (clamp (m[(size_t) k])) * (h - 14), ph = std::atan2 (sp.im[(size_t) k], sp.re[(size_t) k]);
            c.fillStyle = cl().bloom (0.25f + 0.6f * clamp (m[(size_t) k] * 2));
            c.fillRect (x + 1, h - 6 - hh, bw - 2, hh);
            c.fillStyle = cl().mod;
            c.fillRect (x + 1, 4 + (1 - (ph + PI) / TAU) * 6, bw - 2, 1.5f);
        }
    }

    void drawStrip (c2d::Context& c, float w, float h)
    {
        auto& T = frames();
        const int n = (int) T.size();
        const float cw = (w - 12) / (float) n;
        for (int i = 0; i < n; ++i)
        {
            const float x = 6 + (float) i * cw;
            const bool on = i == frame;
            c.strokeStyle = on ? juce::Colour (cl().wave) : cl().bloom (0.32f);
            c.lineWidth = on ? 1.4f : 1.0f;
            const auto& g = T[(size_t) i];
            c.stroke (wave::path ([&] (float u) { return juce::Point<float> (x + 1 + u * (cw - 2), h / 2 + 4 - wave::rd (g, u) * (h * 0.28f)); }, 14));
            if (keys.count (i) > 0)
            {
                c.fillStyle = cl().acc;
                c.beginPath();
                c.moveTo (x + cw / 2, 2);
                c.lineTo (x + cw / 2 + 4, 6);
                c.lineTo (x + cw / 2, 10);
                c.lineTo (x + cw / 2 - 4, 6);
                c.fill();
            }
        }
        c.strokeStyle = cl().acc;
        c.lineWidth = 1.5f;
        c.strokeRect (6 + (float) frame * cw + 0.5f, 12, cw - 1, h - 16);
    }
};
} // namespace

std::unique_ptr<WaveView> makeWaveCreate (WaveCtx& c, const juce::var& captured)
{
    return std::make_unique<WaveCreate> (c, captured);
}

// The table menu's hook, for the face to give it.
void setCreateTableMenu (WaveView& v, std::function<void (juce::Rectangle<float>, int)> f)
{
    if (auto* c = dynamic_cast<WaveCreate*> (&v))
        c->tableMenu = std::move (f);
}

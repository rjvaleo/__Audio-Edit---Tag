// idMLab, the native app: one window, idMLab's own canvas (its bar, its
// board, its status line), MultiGrainLive's and idMLab's modules on it,
// played by the native engine (APP-PLAN.md).

#include "Canvas.h"
#include "Face.h"
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
// and file on the left, its menus between, Audio and Zoom on the right. The
// Dark switch and the Kit picker are idMLab's themes, which the native app
// doesn't have yet, so they are left off rather than shown doing nothing.
class Bar final : public juce::Component
{
public:
    explicit Bar (Canvas& c) : canvas (c) {}
    std::function<void()> onAudio;

    void paint (juce::Graphics& g) override
    {
        const auto& tree = face::part ("idmlab-bar")["tree"];
        const float W = (float) getWidth(), shift = rightShift();
        face::paintBox (g, tree, getLocalBounds().toFloat());
        if (auto* title = face::find (tree, "strong"))
            face::paintText (g, *title, rectOf ((*title)["rect"]), "idMLab");
        if (auto* file = find (tree, "span", 0))
            face::paintText (g, *file, rectOf ((*file)["rect"]).withWidth (400), canvas.fileName());
        // The menus, centred between the two ends, as idMLab's flex row puts them.
        const float mid = middleShift();
        for (int i = 0; i < 4; ++i)
            if (auto* b = menuButton (i))
            {
                const auto r = rectOf ((*b)["rect"]).translated (mid, 0);
                face::paintBox (g, *b, r);
                face::paintText (g, *b, r, menuTitles[i], juce::Justification::centred);
            }
        if (auto* audio = audioButton())
        {
            const auto r = rectOf ((*audio)["rect"]).translated (shift, 0);
            face::paintBox (g, *audio, r);
            face::paintText (g, *audio, r, "Audio", juce::Justification::centred);
        }
        if (auto* zoom = zoomLabel())
        {
            const auto r = rectOf ((*zoom)["rect"]).translated (shift, 0);
            face::paintBox (g, *zoom, r);
            face::paintText (g, *zoom, r.withTrimmedLeft (10).withWidth (40), "Zoom");
            // The slider, on a log scale: 100% in its middle.
            const auto track = sliderRect();
            const float u = std::log (canvas.zoom() / camera::minZoom) / std::log (camera::maxZoom / camera::minZoom);
            g.setColour (juce::Colour (0xff5a5a60));
            g.fillRoundedRectangle (track.withSizeKeepingCentre (track.getWidth(), 4), 2);
            g.setColour (juce::Colour (0xffd8d8dc));
            g.fillRoundedRectangle (track.withWidth (track.getWidth() * u).withSizeKeepingCentre (track.getWidth() * u, 4).withX (track.getX()), 2);
            g.setColour (juce::Colours::white);
            g.fillEllipse (juce::Rectangle<float> (14, 14).withCentre ({ track.getX() + track.getWidth() * u, track.getCentreY() }));
            if (auto* out = face::find (*zoom, "output"))
                face::paintText (g, *out, rectOf ((*out)["rect"]).translated (shift, 0).withWidth (48), juce::String (juce::roundToInt (canvas.zoom() * 100)) + " %");
        }
        (void) W;
    }

    void mouseDown (const juce::MouseEvent& e) override
    {
        const float mid = middleShift(), shift = rightShift();
        for (int i = 0; i < 4; ++i)
            if (auto* b = menuButton (i))
                if (rectOf ((*b)["rect"]).translated (mid, 0).contains (e.position))
                    return showMenu (i, rectOf ((*b)["rect"]).translated (mid, 0));
        if (auto* audio = audioButton())
            if (rectOf ((*audio)["rect"]).translated (shift, 0).contains (e.position))
            {
                if (onAudio)
                    onAudio();
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
    const juce::var* menuButton (int i) const { return find (face::part ("idmlab-bar")["tree"], "button", i); }
    const juce::var* audioButton() const { return find (face::part ("idmlab-bar")["tree"], "button", 4); }
    const juce::var* zoomLabel() const { return find (face::part ("idmlab-bar")["tree"], "label", 0); }

    // The right-hand group keeps its distance from the window's right edge,
    // where idMLab's Kit picker ended.
    float rightShift() const
    {
        auto* zoom = zoomLabel();
        const float right = zoom != nullptr ? rectOf ((*zoom)["rect"]).getRight() : 1336;
        return (float) getWidth() - 14 - right;
    }
    float middleShift() const
    {
        auto* first = menuButton (0);
        auto* last = menuButton (3);
        auto* audio = audioButton();
        if (first == nullptr || last == nullptr || audio == nullptr)
            return 0;
        const float left = 180, right = rectOf ((*audio)["rect"]).getX() + rightShift();
        const float width = rectOf ((*last)["rect"]).getRight() - rectOf ((*first)["rect"]).getX();
        return (left + right) / 2 - width / 2 - rectOf ((*first)["rect"]).getX();
    }
    juce::Rectangle<float> sliderRect() const
    {
        auto* zoom = zoomLabel();
        auto* input = zoom != nullptr ? face::find (*zoom, "input") : nullptr;
        return input != nullptr ? rectOf ((*input)["rect"]).translated (rightShift(), 0) : juce::Rectangle<float>();
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
    Host host;
    Canvas canvas { host };
    Bar bar { canvas };
    StatusLine statusLine { canvas };
    juce::TooltipWindow tooltips { this, 600 };

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
            if (page == "canvas")
            {
                MainComponent main;
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

// idMLab, the native app: one window, one canvas, MultiGrainLive's and
// idMLab's modules on it, played by the native engine (APP-PLAN.md).
//
// Step 1: the window, the canvas, Wave, MIDI in and Output, with stock JUCE
// controls; save and load.

#include "Canvas.h"
#include "Face.h"
#include "WaveFace.h"
#include "Host.h"
#include "Places.h"

#include <juce_audio_utils/juce_audio_utils.h>
#include <juce_gui_basics/juce_gui_basics.h>

namespace
{
class MainComponent final : public juce::Component, private juce::Timer
{
public:
    MainComponent()
    {
        for (auto* b : { &newButton, &openButton, &saveButton, &saveAsButton, &addButton, &fitButton, &actualButton, &outButton,
                         &inButton, &soundButton })
            addAndMakeVisible (*b);
        newButton.onClick = [this] { canvas.newCanvas(); };
        openButton.onClick = [this] { canvas.openPatch(); };
        saveButton.onClick = [this] { canvas.savePatch (false); };
        saveAsButton.onClick = [this] { canvas.savePatch (true); };
        addButton.onClick = [this] { addMenu(); };
        fitButton.onClick = [this] { canvas.fit(); };
        actualButton.onClick = [this] { canvas.actualSize(); };
        outButton.onClick = [this] { canvas.zoomBy (1.0f / 1.25f, canvas.getLocalBounds().getCentre().toFloat()); };
        inButton.onClick = [this] { canvas.zoomBy (1.25f, canvas.getLocalBounds().getCentre().toFloat()); };
        soundButton.onClick = [this] { soundSettings(); };
        newButton.setTooltip ("A new canvas: MIDI in into Wave into Output");
        openButton.setTooltip ("Open a saved canvas");
        saveButton.setTooltip ("Save the canvas");
        addButton.setTooltip ("Put a module on the canvas (or right-click the canvas)");
        fitButton.setTooltip ("Show every module");
        actualButton.setTooltip ("Zoom to 100%");
        soundButton.setTooltip ("The sound card, its buffer, and the MIDI inputs");

        addAndMakeVisible (canvas);
        addAndMakeVisible (statusLine);
        statusLine.setFont (juce::Font (juce::FontOptions (11.0f)));
        statusLine.setColour (juce::Label::textColourId, juce::Colour (0xffb8bec6));
        canvas.status = [this] (const juce::String& s) {
            message = s;
            showStatus();
        };
        setSize (1400, 900);
        canvas.starter();
        startTimerHz (2);
    }

    void paint (juce::Graphics& g) override
    {
        g.fillAll (juce::Colour (0xff1d2025));
    }

    void resized() override
    {
        auto r = getLocalBounds();
        auto bar = r.removeFromTop (36).reduced (6, 5);
        for (auto* b : { &newButton, &openButton, &saveButton, &saveAsButton })
            b->setBounds (bar.removeFromLeft (b == &saveAsButton ? 80 : 60)), bar.removeFromLeft (4);
        bar.removeFromLeft (12);
        addButton.setBounds (bar.removeFromLeft (70));
        bar.removeFromLeft (12);
        for (auto* b : { &fitButton, &actualButton, &outButton, &inButton })
            b->setBounds (bar.removeFromLeft (b == &fitButton || b == &actualButton ? 50 : 30)), bar.removeFromLeft (4);
        soundButton.setBounds (bar.removeFromRight (110));
        statusLine.setBounds (r.removeFromBottom (22).reduced (8, 2));
        canvas.setBounds (r);
    }

private:
    Host host;
    Canvas canvas { host };
    juce::TextButton newButton { "New" }, openButton { "Open" }, saveButton { "Save" }, saveAsButton { "Save as" },
        addButton { "Add" }, fitButton { "Fit" }, actualButton { "100%" }, outButton { "-" }, inButton { "+" },
        soundButton { "Sound card" };
    juce::Label statusLine;
    juce::String message;
    juce::TooltipWindow tooltips { this, 600 };

    void showStatus()
    {
        juce::String s;
        if (auto* device = host.devices.getCurrentAudioDevice())
            s << device->getName() << "  " << juce::roundToInt (host.rate()) << " Hz  " << host.block() << " frames";
        else
            s << "no sound card";
        const auto bad = host.with ([] (NaApp* a) { return na_bad_blocks (a); });
        if (bad > 0)
            s << "  " << (juce::int64) bad << " bad blocks";
        if (message.isNotEmpty())
            s << "   |   " << message;
        statusLine.setText (s, juce::dontSendNotification);
    }

    void timerCallback() override { showStatus(); }

    void addMenu()
    {
        juce::PopupMenu m;
        const auto at = canvas.boardPoint (canvas.getLocalBounds().getCentre().toFloat());
        for (const auto& k : canvas.kinds)
            m.addItem (k.title, [this, id = k.id, at] { canvas.addModule (id, at); });
        m.showMenuAsync (juce::PopupMenu::Options().withTargetComponent (&addButton));
    }

    void soundSettings()
    {
        auto* selector = new juce::AudioDeviceSelectorComponent (host.devices, 0, 0, 2, 2, true, false, true, false);
        selector->setSize (520, 460);
        juce::DialogWindow::LaunchOptions o;
        o.content.setOwned (selector);
        o.dialogTitle = "Sound card (the buffer is never below 64)";
        o.dialogBackgroundColour = juce::Colour (0xff262a31);
        o.escapeKeyTriggersCloseButton = true;
        o.useNativeTitleBar = true;
        o.resizable = false;
        o.launchAsync();
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
        if (args.size() >= 3 && args[0] == "--snapshot")
        {
            const auto page = args[1].unquoted();
            const float scale = args.size() > 3 ? args[3].getFloatValue() : 1.0f;
            juce::Image image;
            if (page == "wave-face")
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

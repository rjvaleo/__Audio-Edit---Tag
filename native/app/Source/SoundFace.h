// The Sound module's face: the sound it holds (its name, length, rate and
// channels, whether it is edited, the whole of it as a strip), and the two
// ways to open one: a file from disk, or MGL's library, read from MGL's
// server (8737 on this machine: the list, a search over it, and the file,
// fetched once into the app's own cache; nothing it plays is touched).
//
// MGL has no page of its own for this: its Edit page's file tabs and Browse's
// list do it. The face is drawn in MGL's look, from the Edit page's captured
// parts (its buttons, its wells, its type) in the theme being worn.
#pragma once

#include "Face.h"
#include "na.h"

#include <functional>

class SoundFace final : public juce::Component, private juce::Timer
{
public:
    using Call = std::function<int64_t (const std::function<int64_t (NaApp*)>&)>;
    SoundFace (Call, uint32_t id);
    ~SoundFace() override;

    std::function<void (const juce::String&)> onMessage;
    std::function<bool (const juce::MouseEvent&)> blocked;

    // Open a file (as Open file does, without asking where).
    bool openFile (const juce::File&);
    // Open one of the library's sounds by its path there (as picking it does).
    void openLibrary (const juce::String& path, const juce::String& name, bool keep = false);
    void reload();

    void paint (juce::Graphics&) override;
    void mouseDown (const juce::MouseEvent&) override;

    // Where MGL's server is (MGL_SERVER, or this machine's 8737).
    static juce::String server();
    // The app's own copy of a library sound.
    static juce::File cacheFor (const juce::String& path);

private:
    Call call;
    const uint32_t id;
    juce::var info;
    std::vector<float> strip;
    int64_t serial = -1;
    juce::Rectangle<float> openR, libR, findR, stripR;
    std::unique_ptr<juce::FileChooser> chooser;
    std::unique_ptr<juce::Component> library;
    void timerCallback() override;
    void say (const juce::String& s)
    {
        if (onMessage)
            onMessage (s);
    }
    void chooseFile (bool keep);
    void showLibrary();
};

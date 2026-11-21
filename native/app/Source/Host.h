// The engine in the app: the sound card, MIDI in, and the one lock that
// keeps the app's calls into the engine one at a time.
//
// The audio thread never takes the lock: it renders through `live`, which
// only changes while the device is stopped (a new sample rate builds a new
// engine, the canvas carried over through a save and a load).
#pragma once

#include "na.h"

#include <juce_audio_devices/juce_audio_devices.h>
#include <juce_events/juce_events.h>

#include <atomic>
#include <functional>
#include <mutex>
#include <string>
#include <vector>

// A string back from one of the na_* calls that fill a buffer.
template <typename Fill>
std::string naText (Fill fill)
{
    std::vector<char> buf (4096);
    for (;;)
    {
        const auto need = (size_t) fill (buf.data(), (uint32_t) buf.size());
        if (need < buf.size())
            return std::string (buf.data(), need);
        buf.resize (need + 1);
    }
}

class Host final : private juce::AudioIODeviceCallback,
                   private juce::MidiInputCallback,
                   private juce::ChangeListener,
                   private juce::Timer
{
public:
    // The smallest block the app plays (RJ: never below 64).
    static constexpr int smallestBlock = 64;
    // The longest piece the engine makes in one go; a longer block is made in pieces.
    static constexpr uint32_t maxBlock = 8192;

    juce::AudioDeviceManager devices;
    // Called on the message thread after the engine was built again (a new rate).
    std::function<void()> onRebuilt;

    Host();
    ~Host() override;

    // Run `f` with the engine, the lock held. Never from the audio thread.
    template <typename F>
    auto with (F&& f)
    {
        std::lock_guard<std::mutex> hold (lock);
        return f (app);
    }

    // The MIDI in modules on the canvas, which every MIDI message is given to.
    void setMidiIns (std::vector<uint32_t> ids);

    double rate() const { return currentRate; }
    int block() const { return currentBlock.load(); }
    std::string lastError();

private:
    std::mutex lock;
    NaApp* app = nullptr;
    std::atomic<NaApp*> live { nullptr };
    std::vector<uint32_t> midiIns;
    double currentRate = 0.0;
    std::atomic<int> currentBlock { 0 };
    std::vector<float> scratchL, scratchR;

    void tableDirs();
    void keepBlockAtLeast64();
    void rebuild (double newRate);

    void audioDeviceIOCallbackWithContext (const float* const*, int, float* const* out, int numOut, int numSamples,
                                           const juce::AudioIODeviceCallbackContext&) override;
    void audioDeviceAboutToStart (juce::AudioIODevice*) override;
    void audioDeviceStopped() override {}
    void handleIncomingMidiMessage (juce::MidiInput*, const juce::MidiMessage&) override;
    void changeListenerCallback (juce::ChangeBroadcaster*) override;
    void timerCallback() override;
};

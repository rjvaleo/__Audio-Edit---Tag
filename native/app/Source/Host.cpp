#include "Host.h"

#include "Places.h"

Host::Host()
{
    app = na_new (48000.0f, maxBlock);
    live.store (app);
    currentRate = 48000.0;
    tableDirs();

    devices.initialiseWithDefaultDevices (0, 2);
    // The plan's block: 128 frames (2.7 ms at 48 kHz), not the card's default.
    // The card's nearest size at or above 128 if it has no 128.
    if (auto* device = devices.getCurrentAudioDevice())
    {
        auto sizes = device->getAvailableBufferSizes();
        int pick = 0;
        for (int b : sizes)
            if (b >= 128 && (pick == 0 || b < pick))
                pick = b;
        auto setup = devices.getAudioDeviceSetup();
        if (pick > 0 && setup.bufferSize != pick)
        {
            setup.bufferSize = pick;
            devices.setAudioDeviceSetup (setup, true);
        }
    }
    keepBlockAtLeast64();
    devices.addChangeListener (this);
    devices.addAudioCallback (this);

    // Every MIDI input, on: the MIDI in modules choose by channel.
    for (const auto& input : juce::MidiInput::getAvailableDevices())
        devices.setMidiInputDeviceEnabled (input.identifier, true);
    devices.addMidiInputDeviceCallback ({}, this);

    startTimerHz (30);
    lfoTicker = std::thread ([this] {
        auto last = std::chrono::steady_clock::now();
        while (ticking.load())
        {
            std::this_thread::sleep_for (std::chrono::milliseconds (8));
            const auto now = std::chrono::steady_clock::now();
            const double dt = std::chrono::duration<double> (now - last).count();
            last = now;
            std::lock_guard<std::mutex> hold (lock);
            if (app != nullptr)
                na_grain_tick (app, dt);
        }
    });
}

Host::~Host()
{
    ticking.store (false);
    if (lfoTicker.joinable())
        lfoTicker.join();
    stopTimer();
    devices.removeMidiInputDeviceCallback ({}, this);
    devices.removeAudioCallback (this);
    devices.removeChangeListener (this);
    devices.closeAudioDevice();
    std::lock_guard<std::mutex> hold (lock);
    live.store (nullptr);
    na_free (app);
    app = nullptr;
}

void Host::tableDirs()
{
    juce::String dirs;
    for (const auto& d : places::tableDirs())
        dirs << d.getFullPathName() << "\n";
    na_table_dirs (app, dirs.toRawUTF8());
    // Wave's presets and board presets: the app's own folder, then MGL's, read only.
    na_set_wave_home (app, places::home().getFullPathName().toRawUTF8(), places::mgl().getChildFile ("wave").getFullPathName().toRawUTF8());
}

void Host::setMidiIns (std::vector<uint32_t> ids)
{
    std::lock_guard<std::mutex> hold (lock);
    midiIns = std::move (ids);
}

std::string Host::lastError()
{
    std::lock_guard<std::mutex> hold (lock);
    return naText ([this] (char* b, uint32_t c) { return na_error (app, b, c); });
}

// RJ's rule: never a block below 64 frames. A smaller one is raised to 64.
void Host::keepBlockAtLeast64()
{
    auto setup = devices.getAudioDeviceSetup();
    if (setup.bufferSize > 0 && setup.bufferSize < smallestBlock)
    {
        setup.bufferSize = smallestBlock;
        devices.setAudioDeviceSetup (setup, true);
    }
}

void Host::changeListenerCallback (juce::ChangeBroadcaster*)
{
    keepBlockAtLeast64();
}

// A new rate is a new engine: the canvas is saved, and loaded into one built
// for the new rate. The device is stopped while this runs.
void Host::rebuild (double newRate)
{
    std::lock_guard<std::mutex> hold (lock);
    const auto saved = naText ([this] (char* b, uint32_t c) { return na_save (app, b, c); });
    NaApp* fresh = na_new ((float) newRate, maxBlock);
    if (fresh == nullptr)
        return;
    std::swap (app, fresh);
    tableDirs();
    na_load (app, saved.c_str());
    live.store (app);
    na_free (fresh);
    currentRate = newRate;
    juce::MessageManager::callAsync ([this] { if (onRebuilt) onRebuilt(); });
}

void Host::audioDeviceAboutToStart (juce::AudioIODevice* device)
{
    const auto size = (size_t) juce::jmax (device->getCurrentBufferSizeSamples(), 1);
    scratchL.assign (juce::jmax (size, (size_t) maxBlock), 0.0f);
    scratchR.assign (juce::jmax (size, (size_t) maxBlock), 0.0f);
    currentBlock.store (device->getCurrentBufferSizeSamples());
    const double r = device->getCurrentSampleRate();
    if (r > 0.0 && std::abs (r - currentRate) > 0.5)
        rebuild (r);
}

void Host::audioDeviceIOCallbackWithContext (const float* const*, int, float* const* out, int numOut, int numSamples,
                                             const juce::AudioIODeviceCallbackContext&)
{
    NaApp* a = live.load (std::memory_order_acquire);
    const auto n = (size_t) numSamples;
    if (a == nullptr || n > scratchL.size())
    {
        for (int c = 0; c < numOut; ++c)
            juce::FloatVectorOperations::clear (out[c], numSamples);
        return;
    }
    na_render (a, scratchL.data(), scratchR.data(), (uint32_t) n);
    for (int c = 0; c < numOut; ++c)
    {
        if (c == 0)
            juce::FloatVectorOperations::copy (out[c], scratchL.data(), numSamples);
        else if (c == 1)
            juce::FloatVectorOperations::copy (out[c], scratchR.data(), numSamples);
        else
            juce::FloatVectorOperations::clear (out[c], numSamples);
    }
}

void Host::handleIncomingMidiMessage (juce::MidiInput*, const juce::MidiMessage& message)
{
    std::lock_guard<std::mutex> hold (lock);
    for (auto id : midiIns)
        na_midi (app, id, message.getRawData(), (uint32_t) message.getRawDataSize());
}

void Host::timerCallback()
{
    std::lock_guard<std::mutex> hold (lock);
    na_collect (app);
}

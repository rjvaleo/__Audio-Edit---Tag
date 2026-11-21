// Phase 1 probe: the engine core on the real sound card.
//
//   probe --buffer 128 --seconds 8 [--monitor 0.2] [--skew 1] [--patch real [--engine 0..3]]
//
// --buffer below 64 is raised to 64: the app never runs smaller blocks.
//
// Plays a patch with every kind of cable through JUCE while this thread sends
// it knob moves, notes and patch changes "now", as an app would. What the
// engine made is kept. Then a second engine is given the same messages,
// stamped with the frames they landed on live, and renders offline in blocks
// of another size. The two must be the same to the last bit.
//
// --skew N moves every replayed message N frames late, which must make the
// two differ: it is the check that the comparison can fail.
//
// Silent unless --monitor is given: the sound card is sent the engine's
// output times that number.

#include "engine.h"

#include <juce_audio_devices/juce_audio_devices.h>
#include <juce_events/juce_events.h>

#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <numeric>
#include <unordered_map>
#include <vector>

namespace
{
struct Live final : juce::AudioIODeviceCallback
{
    NeEngine* engine = nullptr;
    float monitor = 0.0f;
    std::vector<float> keptL, keptR, workL, workR;
    std::atomic<size_t> kept { 0 };
    std::atomic<int> tooBig { 0 };
    std::atomic<int> renderFailures { 0 };
    std::vector<double> starts, durations;
    std::atomic<int> count { 0 };

    void prepare (size_t frames, int callbacks)
    {
        keptL.assign (frames, 0.0f);
        keptR.assign (frames, 0.0f);
        workL.assign (16384, 0.0f);
        workR.assign (16384, 0.0f);
        starts.assign ((size_t) callbacks, 0.0);
        durations.assign ((size_t) callbacks, 0.0);
    }

    void audioDeviceIOCallbackWithContext (const float* const*, int, float* const* out, int numOut,
                                           int numSamples, const juce::AudioIODeviceCallbackContext&) override
    {
        const auto t0 = juce::Time::getHighResolutionTicks();
        const auto n = (size_t) numSamples;

        if (n <= workL.size())
        {
            if (ne_render (engine, workL.data(), workR.data(), (uint32_t) n) != 0)
                renderFailures.fetch_add (1, std::memory_order_relaxed);
            const size_t at = kept.load (std::memory_order_relaxed);
            const size_t take = std::min (n, keptL.size() - at);
            std::memcpy (keptL.data() + at, workL.data(), take * sizeof (float));
            std::memcpy (keptR.data() + at, workR.data(), take * sizeof (float));
            kept.store (at + take, std::memory_order_release);
            for (int c = 0; c < numOut; ++c)
            {
                if (c < 2)
                    juce::FloatVectorOperations::copyWithMultiply (out[c], c == 0 ? workL.data() : workR.data(), monitor, numSamples);
                else
                    juce::FloatVectorOperations::clear (out[c], numSamples);
            }
        }
        else
        {
            tooBig.fetch_add (1);
            for (int c = 0; c < numOut; ++c)
                juce::FloatVectorOperations::clear (out[c], numSamples);
        }

        const auto t1 = juce::Time::getHighResolutionTicks();
        const int i = count.load (std::memory_order_relaxed);
        if (i < (int) starts.size())
        {
            starts[(size_t) i] = juce::Time::highResolutionTicksToSeconds (t0);
            durations[(size_t) i] = juce::Time::highResolutionTicksToSeconds (t1 - t0);
            count.store (i + 1, std::memory_order_release);
        }
    }

    void audioDeviceAboutToStart (juce::AudioIODevice*) override {}
    void audioDeviceStopped() override {}
};

double percentile (std::vector<double> v, double p)
{
    if (v.empty())
        return 0.0;
    std::sort (v.begin(), v.end());
    const auto i = (size_t) std::min ((double) (v.size() - 1), std::floor (p * (double) v.size()));
    return v[i];
}

juce::String argValue (const juce::StringArray& args, const juce::String& name, const juce::String& fallback)
{
    const int i = args.indexOf (name);
    return (i >= 0 && i + 1 < args.size()) ? args[i + 1] : fallback;
}

int mistakes = 0;
void ok (int64_t result)
{
    if (result < 0)
        ++mistakes;
}

// One of every kind of cable, two cables meeting at one input, and a loop:
//   1 sine > 2 gain > out         3 lfo > 2 gain's control input
//   4 clock > 5 pulse > 6 voice > out      7 keys > 6 voice
//   6 voice > 8 delay > out       8 delay > 9 gain > 8 delay
//   10 sound source > 11 player > out
void buildPatch (NeEngine* e, float rate)
{
    ok (ne_add (e, 1, NE_SINE, 220.0f, 0.5f));
    ok (ne_add (e, 2, NE_GAIN, 0.8f, 0.0f));
    ok (ne_add (e, 3, NE_LFO, 3.0f, 0.2f));
    ok (ne_connect (e, 1, 0, 2, 0));
    ok (ne_connect (e, 3, 0, 2, 1));
    ok (ne_connect_out (e, 2, 0));
    ok (ne_add (e, 4, NE_CLOCK, 140.0f, 1.0f));
    ok (ne_add (e, 5, NE_PULSE, 57.0f, 0.0f));
    ok (ne_add (e, 6, NE_VOICE, 0.0f, 0.0f));
    ok (ne_add (e, 7, NE_KEYS, 0.0f, 0.0f));
    ok (ne_connect (e, 4, 0, 5, 0));
    ok (ne_connect (e, 5, 0, 6, 0));
    ok (ne_connect (e, 7, 0, 6, 0));
    ok (ne_connect_out (e, 6, 0));
    ok (ne_add (e, 8, NE_DELAY, 64.0f, 0.0f));
    ok (ne_add (e, 9, NE_GAIN, 0.5f, 0.0f));
    ok (ne_connect (e, 6, 0, 8, 0));
    ok (ne_connect (e, 8, 0, 9, 0));
    ok (ne_connect (e, 9, 0, 8, 0));
    ok (ne_connect_out (e, 8, 0));
    ok (ne_add (e, 10, NE_SOUND_SOURCE, 0.0f, 0.0f));
    ok (ne_add (e, 11, NE_PLAYER, 0.3f, 0.0f));
    ok (ne_connect (e, 10, 0, 11, 0));
    ok (ne_connect_out (e, 11, 0));
    ok (ne_commit (e, 0));

    std::vector<float> l (480), r (480);
    for (size_t i = 0; i < l.size(); ++i)
    {
        l[i] = (float) i / 480.0f * 2.0f - 1.0f;
        r[i] = -l[i];
    }
    ok (ne_load_sound (e, 0, 1, l.data(), r.data(), 480, rate));
    ok (ne_point_sound (e, 0, 10, 0, 1, 1));
}

// The real instruments (--patch real): MultiGrainLive's own code.
//   1 Wave synth > 2 chorus > 3 plate reverb > 6 mixer
//   4 grain deck (a test sound, at half speed) > 5 multi-delay > 6 mixer
//   6 mixer > 7 MGL's ceiling > out
// `engine` is the deck's: 0 Granular, 1 WSOLA, 2 Vocoder, 3 PVSOLA.
void buildRealPatch (NeEngine* e, float engine)
{
    ok (ne_add (e, 1, NE_WAVE, 0.0f, 0.0f));
    ok (ne_add_fx (e, 2, "hp-chorus"));
    ok (ne_add_fx (e, 3, "dattorro-plate"));
    ok (ne_add (e, 4, NE_GRAIN, engine, 0.0f));
    ok (ne_add_fx (e, 5, "multi-delay"));
    ok (ne_add (e, 6, NE_MIX, 2.0f, 0.0f));
    ok (ne_add (e, 7, NE_CEILING, 0.0f, 0.0f));
    ok (ne_connect (e, 1, 0, 2, 0));
    ok (ne_connect (e, 2, 0, 3, 0));
    ok (ne_connect (e, 4, 0, 5, 0));
    ok (ne_connect (e, 3, 0, 6, 0));
    ok (ne_connect (e, 5, 0, 6, 1));
    ok (ne_connect (e, 6, 0, 7, 0));
    ok (ne_connect_out (e, 7, 0));
    ok (ne_commit (e, 0));
    // The deck: Run on, loop the whole sound, play (its knobs 2 and 0).
    ok (ne_param (e, 0, 4, 2, 1.0f));
    ok (ne_param (e, 0, 4, 0, 1.0f));
}

// One thing the app's thread does.
struct Op
{
    enum Kind { param, note, addSine, removeModule } kind;
    uint32_t module, a;
    float value;
};

// Do it now (frame 0) or on a frame. Returns the last message's number.
int64_t apply (NeEngine* e, const Op& op, uint64_t frame)
{
    switch (op.kind)
    {
        case Op::param: return ne_param (e, frame, op.module, op.a, op.value);
        case Op::note: return ne_note (e, frame, op.module, op.a, 48 + (uint32_t) (op.value * 24.0f), 0.2f + 0.8f * op.value);
        case Op::addSine:
            ok (ne_add (e, op.module, NE_SINE, op.value, 0.1f));
            ok (ne_connect_out (e, op.module, 0));
            return ne_commit (e, frame);
        case Op::removeModule:
            ok (ne_remove (e, op.module));
            return ne_commit (e, frame);
    }
    return -1;
}

uint32_t roll (uint32_t& seed)
{
    seed = seed * 1664525u + 1013904223u;
    return seed >> 8;
}

Op nextOp (int i, uint32_t& seed)
{
    const uint32_t r = roll (seed) % 100;
    const float v = (float) (roll (seed) % 1000) / 1000.0f;
    if (i == 100) return { Op::addSine, 20, 0, 550.0f };
    if (i == 400) return { Op::removeModule, 20, 0, 0.0f };
    if (i == 700) return { Op::addSine, 21, 0, 660.0f };
    if (r < 35) return { Op::param, 1, 0, 110.0f + 600.0f * v };
    if (r < 60) return { Op::param, 2, 0, v };
    if (r < 75) return { Op::note, 7, 1, v };
    if (r < 85) return { Op::note, 7, 2, v };
    if (r < 93) return { Op::param, 9, 0, 0.9f * v };
    return { Op::param, 4, 0, 60.0f + 120.0f * v };
}

// The same for the real patch: notes on the synth, knobs on the effects and
// the deck, and the same three patch changes.
Op nextRealOp (int i, uint32_t& seed)
{
    const uint32_t r = roll (seed) % 100;
    const float v = (float) (roll (seed) % 1000) / 1000.0f;
    if (i == 100) return { Op::addSine, 20, 0, 550.0f };
    if (i == 400) return { Op::removeModule, 20, 0, 0.0f };
    if (i == 700) return { Op::addSine, 21, 0, 660.0f };
    if (r < 30) return { Op::note, 1, 1, v };
    if (r < 40) return { Op::note, 1, 2, v };
    if (r < 55) return { Op::param, 3, 0, v };
    if (r < 70) return { Op::param, 2, 0, v };
    if (r < 80) return { Op::param, 5, 0, v };
    if (r < 88) return { Op::param, 4, 11, 0.5f + 0.5f * v };   // the deck's gain
    if (r < 94) return { Op::param, 4, 13, 0.5f + v };          // its varispeed
    return { Op::param, 6, 0, 0.5f + 0.5f * v };                // the synth's level in the mix
}

void readLanded (NeEngine* e, std::unordered_map<uint64_t, uint64_t>& landed)
{
    uint64_t seqs[256], frames[256];
    for (;;)
    {
        const uint32_t n = ne_applied (e, seqs, frames, 256);
        for (uint32_t i = 0; i < n; ++i)
            landed[seqs[i]] = frames[i];
        if (n < 256)
            break;
    }
}
} // namespace

int main (int argc, char* argv[])
{
    juce::ScopedJuceInitialiser_GUI juce;
    juce::StringArray args (argv + 1, argc - 1);
    const int wantBuffer = argValue (args, "--buffer", "128").getIntValue();
    const double seconds = argValue (args, "--seconds", "8").getDoubleValue();
    const double wantRate = argValue (args, "--rate", "48000").getDoubleValue();
    const float monitor = argValue (args, "--monitor", "0").getFloatValue();
    const auto wantType = argValue (args, "--type", "");
    const auto skew = (uint64_t) argValue (args, "--skew", "0").getIntValue();
    const bool real = argValue (args, "--patch", "plain") == "real";
    const float deckEngine = argValue (args, "--engine", "0").getFloatValue();

    juce::AudioDeviceManager manager;
    if (wantType.isNotEmpty())
        manager.setCurrentAudioDeviceType (wantType, true);
    const auto opened = manager.initialise (0, 2, nullptr, true);
    if (opened.isNotEmpty())
    {
        std::printf ("{\"error\":\"%s\"}\n", opened.replace ("\"", "'").toRawUTF8());
        return 1;
    }
    // Never ask the sound card for fewer than 64 frames (RJ, 21 Nov 2026).
    // Grain works out its sound 128 frames at a time, so at 32 one callback
    // in four carries four callbacks' work: Hybrid and PVSOLA with eight
    // voices then need 143% and 123% of the time they have, and the card
    // runs dry. At 64 the worst callback takes 74%. 64 frames is 1.3 ms at
    // 48 kHz; Grain's sound stays bit for bit what it is.
    constexpr int smallestBuffer = 64;
    auto setup = manager.getAudioDeviceSetup();
    setup.bufferSize = juce::jmax (smallestBuffer, wantBuffer);
    setup.sampleRate = wantRate;
    const auto err = manager.setAudioDeviceSetup (setup, true);
    auto* device = manager.getCurrentAudioDevice();
    if (err.isNotEmpty() || device == nullptr)
    {
        std::printf ("{\"error\":\"%s\"}\n", err.replace ("\"", "'").toRawUTF8());
        return 1;
    }
    const double rate = device->getCurrentSampleRate();
    const int block = device->getCurrentBufferSizeSamples();
    const double slot = (double) block / rate;

    // Live.
    NeEngine* live = ne_new ((float) rate, 1024, 1, (uint32_t) (rate / 100.0));
    if (real) buildRealPatch (live, deckEngine); else buildPatch (live, (float) rate);
    Live callback;
    callback.engine = live;
    callback.monitor = monitor;
    callback.prepare ((size_t) ((seconds + 2.0) * rate), (int) ((seconds + 2.0) / slot) + 4096);

    std::vector<Op> ops;
    std::vector<int64_t> seqs;
    std::unordered_map<uint64_t, uint64_t> landed;
    uint32_t seed = 7;
    manager.addAudioCallback (&callback);
    const double until = juce::Time::getMillisecondCounterHiRes() + seconds * 1000.0;
    for (int i = 0; juce::Time::getMillisecondCounterHiRes() < until; ++i)
    {
        const Op op = real ? nextRealOp (i, seed) : nextOp (i, seed);
        const int64_t seq = apply (live, op, 0);
        ok (seq);
        ops.push_back (op);
        seqs.push_back (seq);
        if (i % 16 == 0)
            readLanded (live, landed);
        juce::Thread::sleep (3);
    }
    juce::Thread::sleep (200);
    manager.removeAudioCallback (&callback);
    readLanded (live, landed);
    const size_t frames = callback.kept.load();
    const int liveMistakes = mistakes;

    // Offline: the same messages, stamped with where they landed.
    NeEngine* offline = ne_new ((float) rate, 1024, 0, (uint32_t) (rate / 100.0));
    if (real) buildRealPatch (offline, deckEngine); else buildPatch (offline, (float) rate);
    size_t replayed = 0, patchChanges = 0;
    std::vector<uint64_t> where;
    for (size_t i = 0; i < ops.size(); ++i)
    {
        const auto found = seqs[i] > 0 ? landed.find ((uint64_t) seqs[i]) : landed.end();
        if (found == landed.end())
            continue;
        ok (apply (offline, ops[i], found->second + skew));
        where.push_back (found->second);
        ++replayed;
        if (ops[i].kind != Op::param && ops[i].kind != Op::note)
            ++patchChanges;
    }
    std::vector<float> offL (frames, 0.0f), offR (frames, 0.0f);
    for (size_t pos = 0; pos < frames;)
    {
        const size_t n = std::min<size_t> (97, frames - pos);
        ok (ne_render (offline, offL.data() + pos, offR.data() + pos, (uint32_t) n));
        pos += n;
    }

    long long firstDifference = -1;
    double maxDifference = 0.0, peak = 0.0;
    for (size_t i = 0; i < frames; ++i)
    {
        peak = std::max (peak, (double) std::abs (callback.keptL[i]));
        const bool same = std::memcmp (&callback.keptL[i], &offL[i], sizeof (float)) == 0
                       && std::memcmp (&callback.keptR[i], &offR[i], sizeof (float)) == 0;
        if (! same)
        {
            if (firstDifference < 0)
                firstDifference = (long long) i;
            maxDifference = std::max ({ maxDifference, (double) std::abs (callback.keptL[i] - offL[i]),
                                        (double) std::abs (callback.keptR[i] - offR[i]) });
        }
    }
    std::sort (where.begin(), where.end());
    const size_t distinct = (size_t) (std::unique (where.begin(), where.end()) - where.begin());

    // How the callback behaved.
    const int n = callback.count.load();
    std::vector<double> durs (callback.durations.begin(), callback.durations.begin() + n);
    std::vector<double> gaps;
    for (int i = 1; i < n; ++i)
        gaps.push_back (callback.starts[(size_t) i] - callback.starts[(size_t) i - 1]);
    const size_t skip = std::min<size_t> (gaps.size(), 50);
    std::vector<double> steady (gaps.begin() + (long) skip, gaps.end());
    int late = 0;
    for (double g : steady)
        if (g > 1.5 * slot)
            ++late;

    const bool identical = firstDifference < 0 && frames > 0 && mistakes == 0 && callback.tooBig.load() == 0;
    std::printf ("{\"device\":\"%s\",\"type\":\"%s\",\"rate\":%.0f,\"buffer\":%d,\"seconds\":%.1f,\"patch\":\"%s\",\"deck_engine\":%d,"
                 "\"frames_compared\":%zu,\"offline_block\":97,\"skew\":%d,\"messages_sent\":%zu,\"messages_replayed\":%zu,"
                 "\"distinct_landing_frames\":%zu,\"patch_changes\":%zu,\"mistakes_live\":%d,\"mistakes_all\":%d,"
                 "\"identical\":%s,\"first_difference\":%lld,\"max_difference\":%g,\"peak\":%.4f,"
                 "\"callbacks\":%d,\"work_mean_ms\":%.4f,\"work_p99_ms\":%.4f,\"work_max_ms\":%.4f,"
                 "\"load_p99_pct\":%.1f,\"load_max_pct\":%.1f,\"gap_max_ms\":%.3f,\"late_callbacks\":%d}\n",
                 device->getName().replace ("\"", "'").toRawUTF8(), device->getTypeName().toRawUTF8(), rate, block, seconds,
                 real ? "real" : "plain", (int) deckEngine,
                 frames, (int) skew, ops.size(), replayed, distinct, patchChanges, liveMistakes, mistakes,
                 identical ? "true" : "false", firstDifference, maxDifference, peak,
                 n, n > 0 ? 1000.0 * std::accumulate (durs.begin(), durs.end(), 0.0) / n : 0.0,
                 1000.0 * percentile (durs, 0.99), 1000.0 * percentile (durs, 1.0),
                 100.0 * percentile (durs, 0.99) / slot, 100.0 * percentile (durs, 1.0) / slot,
                 1000.0 * percentile (steady, 1.0), late);

    ne_free (live);
    ne_free (offline);
    manager.closeAudioDevice();
    return identical ? 0 : 2;
}

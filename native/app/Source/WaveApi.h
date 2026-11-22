// Asking a Wave module what the page asks MGL's server (na_wave_api).
#pragma once

#include "na.h"

#include <juce_core/juce_core.h>

#include <vector>

inline juce::var waveApi (NaApp* a, uint32_t id, const juce::String& method, const juce::String& path, const juce::var& body, int& status)
{
    std::vector<char> buf (1 << 16);
    int32_t st = 0;
    const auto text = body.isVoid() ? juce::String() : juce::JSON::toString (body, true);
    auto need = (size_t) na_wave_api (a, id, method.toRawUTF8(), path.toRawUTF8(), body.isVoid() ? nullptr : text.toRawUTF8(), buf.data(), (uint32_t) buf.size(), &st);
    if (need >= buf.size())
    {
        // Too long for the buffer: the whole reply, kept (a POST runs once).
        buf.resize (need + 1);
        need = (size_t) na_wave_reply (a, buf.data(), (uint32_t) buf.size());
    }
    status = st;
    return juce::JSON::parse (juce::String::fromUTF8 (buf.data(), (int) juce::jmin (need, buf.size())));
}

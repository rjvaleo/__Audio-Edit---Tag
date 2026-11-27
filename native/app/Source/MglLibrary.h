// MGL's library in the app: the routes MGL's Browse and Library pages ask of
// MGL's server, answered in-process by MGL's own code (engine-library, the
// na_lib_* calls). One for the whole app, opened the first time it is asked
// for: the app's own copy of MGL's library files in the app's home (made from
// MGL's data folder the first time), MGL's listening model where MGL keeps it.
//
// A call can take a while (a folder's thumbnails, sounds like this one, the
// first pass of the listening model, a scan), so the faces ask off the
// message thread (`ask`) and are answered on it. Snapshots and the benches
// set `inline` so every answer is there before the picture is taken.
#pragma once

#include <juce_core/juce_core.h>
#include <juce_events/juce_events.h>

#include <functional>

namespace mgllib
{
struct Answer
{
    int status = 0;
    juce::String type;
    juce::MemoryBlock body;
    juce::String text() const { return body.toString(); }
    juce::var json() const { return juce::JSON::parse (body.toString()); }
    bool ok() const { return status >= 200 && status < 300; }
};

// The page's escaping of a query value (`encodeURIComponent`).
juce::String esc (const juce::String&);

// One route, answered here and now (any thread but the audio thread).
Answer call (const juce::String& method, const juce::String& target, const juce::String& body = {});

// One route, asked on a helper thread; `done` on the message thread.
void ask (const juce::String& method, const juce::String& target, const juce::String& body, std::function<void (const Answer&)> done);

// The library's folder (where its sounds are), or empty.
juce::String folder();
// A sound of the library's (its path as the routes give it) as a file.
juce::File fileOf (const juce::String& rel);

// Answer every `ask` at once, on the calling thread (snapshots, benches).
extern bool askInline;
} // namespace mgllib

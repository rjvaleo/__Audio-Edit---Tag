# A machine with no audio output

Written 17 Aug 2026, after CI found this on its first two runs.

## The rule

**Browsing, editing, tagging and exporting do not need an audio device. Only
playback does.**

A box with no sound card should be able to open the library, edit a document,
tag it, render it and write the file — and should say, once, that it cannot play
it. It should not fail at every turn, and it should not look live while doing
nothing.

## What was wrong

The server opens the device lazily: `live::with` calls `live::ensure`, which
calls `engine::spawn`. On a machine with no output that fails, so **every**
engine route answered 503 — including `/api/engine/state`, which the interface
polls constantly.

Two consequences, both invisible on any development machine:

1. Every poll of the engine's state failed, on a box otherwise perfectly able to
   do everything else.
2. The interface kept asking. Switching engines fired a transport request each
   time; five switches and a play press put seven failed requests in the console.

## Why no test caught it

There was a test. It had been written correctly, with a comment that says
exactly this:

> **Nothing here opens the audio device.** A test that made sound would fight
> whatever the machine is already playing, and would fail on any box without an
> output.

It asserted `/api/engine/state` answers 200. It passed for months. **Every
machine it had ever run on had a sound card**, so the assertion had never been
exercised against the case it was written for.

That is the general shape worth remembering: a test that can only fail in an
environment you do not have is not a test yet. CI is the environment.

## The fix, in two halves

**The server.** `/api/engine/state` no longer requires a device. Status has a
truthful answer when nothing can play, and it is "nothing" — so it returns the
idle shape with `device: false` and the reason.

The other engine routes still refuse. `transport` and `grains` genuinely cannot
do their job without a device and saying so is honest. Only *status* has to
answer either way, because the interface polls it.

**The interface.** It asks once, through the one route that answers, and then
stops asking. `enginePost`, `engineLoad`, the grain poll and the load reset are
all gated on `engine.device`. Measured with the device simulated off: five engine
switches and a play press, **zero engine requests**.

And it says so. A "no audio device" note appears beside the transport and the
four transport buttons go out of service, because a transport that looks live
and silently does nothing is worse than one that says why. Nothing else is
disabled.

## The tests

`tests/ui/no-audio.spec.mjs`. The device is *simulated* off rather than removed,
because the machine running the tests almost certainly has one — which is the
whole point.

Four tests: the state route answers with a `device` flag either way; nothing
asks the engine when there is no device; the transport says why; and editing,
drawing and exporting still work without one.

One of them got this wrong on its first run, in the same way: it asserted "the
warning is hidden" as the *before* state, which is only true on a machine that
has audio. It passed on the developer's Mac and failed on CI, where the warning
was correctly showing. It now reads the real state first. The mistake this file
exists to document, made one level up, inside the file documenting it.

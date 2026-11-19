# Wave fills the window: the design (A6)

*18 November 2026. Agreed with RJ over six clickable mock-ups; he said "Yes,
build A5", then asked to keep A4's row of effects as well. The mock-ups are in
`page-mockups/wave-window-a*.html` on this branch (`wave-layout`); A6 (A5 with
that row) is the one to build. His words are quoted as he
said them.*

## Why

On RJ's iMac the Wave page sat at its fixed 1460 × 862 in the top-left of a
window about 2080 × 1100, leaving about 30% empty, and the FX tab's effect
panel cut off the right-hand side of a SoundHack face. RJ: "most audio plugins
don't scale in size. It's like they open up and the whole thing is right
there, like an audio interface … It should be pretty big." The FX board is the
part he likes most: "this is really cool … we want that to be able to be the
whole page so that we can add different modules."

## What it is

**One frame, the same on every tab.**

- **The rail** on the left, as it is today (62 px).
- **The dock** on the right, always there, one width (440 px): "if we're going
  to have a right doc, we should always have the right doc."
- **The keyboard and the transport** along the bottom, always there.
- **Only the middle grows and shrinks** with the window. Everything in it
  (panels, knobs, fonts) is one size, as today.

**Below the page's smallest size** (the laptop), the whole page scales down
to fit the window, keeping its proportions. RJ: "for the laptop … we can scale
at that breakpoint so that it'll fit on the screen." At or above that size,
nothing scales. (This replaces scrolling for small windows. The 17 Nov rule,
one size and never scaled to the window, still holds above the breakpoint.)

**The FX tab.**

- The board takes the whole middle. Its boxes are one size; you drag the grid
  to move around, as now.
- The dock shows the effect picked on the board, with its whole face, never
  cut off. RJ: "I like the effects tab. That totally makes sense."

**The Play tab.**

- The synth's panels at the sizes they have today, with **every envelope and
  every LFO shown at once**: Amp and Env 2–4, LFO 1–4, no tabs. RJ: "I think we
  can … show them both there. You can show all the LFOs there." (He said "two
  envelopes"; there are four, and all four are shown.) Both filters, as now.
- **The dock holds every effect, in the order the sound goes, each with its
  whole face**, and the mouse wheel scrolls through them. RJ: "all of the
  effects show up in order on the right best they can … it might be like a
  network or whatever. So you'll have to visually depict that."
  - A line down the dock's left side runs from Voice through each effect to
    Out.
  - Where the chain splits, its paths sit one under the other in a dashed box,
    each labelled ("path 1 · 3 effects"), until they meet again.
  - Each effect has its power button and "⋀ FX ›", which opens it on the board.
- **A row of every effect under the synth stays as well** (A4's row, under
  More Sources): one card per effect in order, each with its power button and
  four main controls with their pictures. A click on a card takes the dock to
  that effect and marks it there. RJ, pointing at the row and at the dock:
  "this should remain - and this should be also".
- Any height left under that, when the window has it, is left for modules
  added later. Nothing grows into it.

**Every control has its picture.** RJ: "make sure everything always has the
little icons on it. I'm seeing some modules and some controls that don't have
all those, the iconography that we've established." That is the one knob's
picture of what the value does (`ui/app/073a-ui-knob.js`): inside a dark well
at 44 px, beside the cap at 26 px.

**The SoundHack faces in the app's own look.** RJ: "I want to redo all of the
sound hack plugins … they should now look like the rest of the app." All nine
`sh-*` effects and the SoundHack spectral suite's faces lose the copied white,
Arial Black SoundHack look and take the app's: its dark sections, its knobs
with their pictures, its segmented buttons. A5's Spectral Dynamics is the
pattern. What each face controls, and how, is unchanged.

## Goals, non-goals and failures

- **Goal:** on RJ's iMac the Wave page fills the window with nothing cut off
  and no empty margin beside or below the frame; on the laptop it fits,
  scaled.
- **Not in this:** the other pages (Grain, Atmosphere and the rest) taking the
  same frame. The frame is built so they can, but each is its own change. Also
  out: any change to sound, to the effects' controls or what they do, or to
  the rail's contents.
- **It fails, even if it works, if:** anything shrinks, grows or reflows into
  more or fewer columns above the breakpoint; a face is cut off; a control has
  no picture; the dock moves or changes width between tabs.

## Constraints

- Fixed sizes above the breakpoint (RJ, 17 Nov, and memory
  `fixed-size-never-fluid`).
- The rebuilt effects stay exact: a face's look changes, but its controls,
  ranges and defaults don't, and no recorded hash moves.
- Tests only on the MacBook and the PC, browser tests with
  `tools/pc/test-on-mbp.sh`.
- Nothing is put live until it's merged by the coordinator, and RJ looks at it.

## Approaches considered

- **A (chosen): fixed panels, with the spare space going to what can use it.**
  This is how DAWs such as Bitwig and Ableton do it.
- **B: one design scaled to the window,** the way Serum or Vital zoom.
  Rejected above the breakpoint: knobs and text change size (RJ turned this
  down on 17 Nov). It is kept below the breakpoint, at RJ's word.
- **C: a bigger fixed page sized for the iMac.** Rejected: any other screen
  gets empty space or a lot of scrolling.

## Left to the builder

- The breakpoint's exact size: the frame's smallest size on each tab, worked
  out from the panels. A6 needs about 2002 × 1080 on Play.
- How the dock's chain is read from the FX board's graph (`395-wave-board.js`)
  and kept in step with it, including sends and more than one split.
- Which of today's Wave controls lack a picture (the audit), and the pictures
  for them, in the language of `docs/CONTROL-PICTURES.md`.
- The tests that prove each point above, written before the code.

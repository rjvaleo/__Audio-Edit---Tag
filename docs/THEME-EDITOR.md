# The theme editor

Written 17 Aug 2026, when it was built.

A miniature of the interface in the theme panel, three colour pickers, and every
change on screen as you make it.

## Why a miniature and not the page

The page is already right there, so previewing on it would seem simpler. It is
not: judging a theme means moving a colour back and forth, and a control that
repaints the whole interface on every pointer move makes the thing you are
judging jump under your hand. The miniature holds still, shows the parts a theme
actually changes — rail, panel, buttons, sliders, the four text steps, a lane —
and the real page only changes when you say so.

It is **real DOM using the app's own classes**, not a picture. A screenshot goes
stale the moment anything is restyled; a miniature built from `.cpanel`,
`.ghost`, `.seg-btn` and the rest is repainted by the same stylesheet as the
thing it stands for, so it cannot drift.

## The tokens go on a container, not on `:root`

`Theme.apply` sets the variables on `document.documentElement`, which is what
makes a theme global. The preview needs the same variables scoped to one
element, so `Theme.applyTo(el, tokens)` does the work and `apply` is now a call
to it with the root. Everything in the interface reads its colours through
`var(--x)`, so scoping the variables to a container themes everything inside it
and nothing outside.

## Ported, not invented

This is Emovis' `lib/theme-studio`, which was written to be lifted: it depends
on React and nothing else there, and on nothing at all here. Its derivation
engine came across long ago as `theme-derive.js`; the editor is what never did.

Two attempts were made at writing one from scratch first — three colour pickers,
then five sliders — and both were worse than the thing that already existed. The
port took less time than either.

## What it is

A palette is a name and a handful of brand colours. The engine turns those into
this application's tokens, and the preview is painted entirely from them, which
is what makes it an editor rather than a form.

**Every colour you put on a card is used** — since 27 Aug 2026. Before that the
engine read four numbers out of the card however many colours it held, and the
rest were inert; the swatch row was offering choices that did nothing, and which
two mattered was decided by a sort you could not see. The card is now sorted
dark to light and spread along the lightness axis, so its dark colours become
the surfaces and its light ones become the text. Lightness itself is still the
engine's, which is what keeps contrast legible whatever the card holds. See
[STATE.md](STATE.md) §7.

- A filterable **list**, with the shipped palettes marked *built in* and the one
  in use marked *applied*.
- **Name**, and **N colours** — each a colour well *and* a hex field. Both,
  deliberately: the well is how a colour is chosen, the hex is how one arrives
  from a style guide. Add and remove them freely.
- **Apply**, **Duplicate**, **Delete**. A built-in can be previewed and
  duplicated but never edited or deleted, so a palette someone has built on can
  never be pulled out from under them.
- **Copy JSON** and **Import JSON**, so a palette can leave and come back.
- A **token inspector** — every derived value with its chip. Sixty rows is a
  reference rather than a control, but when a theme looks wrong this is where
  the reason is.

**Clicking a palette wears it.** The studio this came from is an admin screen
with the application somewhere else, so there a click opened a palette without
applying it. Here the panel sits inside the thing being themed and looking at
the app in a theme is the entire reason to click one. It opens in the editor at
the same time.

## The waveform belongs to the palette

It used to sit above the studio as one standing choice, on the argument that a
theme has no business colouring the sound. That argument was about *derivation*
and it still holds — the waveform is not worked out from the surfaces, because
which colour reads best against a sound is a matter of the sound. But a theme
can still **carry** one, and being asked for it is what makes a theme a whole
look rather than the chrome half of one.

Each palette holds its own; wearing a palette brings its waveform with it.
Without one, the standing choice stands.

## What a theme still may not touch## What a theme still may not touch

`--good`, `--warn` and `--bad` carry meaning rather than style. `--wave` and
`--wave-2` belong to the sound, not the chrome. Lines and shadows are
translucent black and white, which sit correctly on any ground without being
told what colour it is. None of them are offered, for the same reasons they are
absent from `THEME_TOKEN_MAP`.

## A colour well cannot be rebuilt while it is being used

The swatches were re-rendered from scratch on every change: `tsRenderSwatches`
did `innerHTML = ''` and built the row again. Moving a colour well fires `input`
for **every step of the drag**, so the very `<input type="color">` the system's
colour panel was attached to was destroyed under it, over and over. The panel
stays open, pointing at an element no longer in the document, and nothing done
in it reaches the palette. The hex field lost its caret to the same thing on
every keystroke.

`tsRender` already knew this about the name field — it will not write into it
while it has focus. The swatches never learned it.

They update in place now, and rebuild only when the *shape* changes: a different
number of colours, or read-only flipping. Nothing is written into an element that
has focus.

### The value was never the broken part

It arrived correctly the whole time. `tsSetColor` had already run by the moment
the DOM was thrown away, so the palette held exactly the right colour — a test
that asserted on the palette would have passed on the fault, cheerfully, forever.

What has to survive is the *element*. The test drives a run of `input` events at
one well and asserts it is still in the document and still the same node
afterwards. Put the `innerHTML = ''` back and it fails on the first step:
`alive: false`.


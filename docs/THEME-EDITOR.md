# The theme editor

Written 17 Aug 2026, when it was built. A page of its own since 13 Nov 2026.

## The Theme page

Theme is a page, opened from the left rail like Edit, Grain, Chop, Wave,
Visual and Seq (mode `theme`, `body.themepage`, `#themeView`). It was a pane in
the library's column, 330 px wide, with a small miniature and paragraphs of
explanation; the mock-up RJ approved on 13 Nov 2026
(`page-mockups/theme.html`) made it a page:

- **Left: the palettes**, as cards — the swatch row large enough to judge, sorted
  dark to light as the engine reads it, the name, and one tag: *wearing*,
  *editing*, *built in* or *yours*. A filter and **+ New** above; under them the
  quick way in, a row of pasted colours and **Add**.
- **Middle: the preview**, built from today's parts (below). A switch picks
  which page it shows: Grain, Chop or Wave.
- **Right: the editor** — the palette's name, **Wear it**, **Duplicate** and
  **Delete**; its colours dark to light; the waveform's colour; and the Look.
  The derived tokens are folded away at the foot.
- **Across the top**: what is worn and what is open, a switch for how it is
  worn (*Palettes*, *Plain surfaces*, *No theme*), and **Import JSON** and
  **Copy JSON**.

The explanations that used to sit between the controls are tooltips now, and
this document. The behaviour is the same as the pane's except for one thing,
below: a click on a card no longer wears it.

The page lives in three files: `330-theme.js` (the cards, wearing, the
waveform colour), `355-theme-page.js` (the preview and the Look) and
`360-theme-editor.js` (the editor). Its stylesheet is the Theme page's section
of `ui/app-css/050-theme-room.css`.

**`355` comes before `360` on purpose.** `tsWire`, at the end of the editor,
paints the preview while the page loads; a `const` declared in a later file is
still in its dead zone then, and reading it throws and takes the rest of
`app.js` with it.

## The preview, and why not the page

The page is already right there, so previewing on it would seem simpler. It is
not: judging a theme means moving a colour back and forth, and a control that
repaints the whole interface on every pointer move makes the thing you are
judging jump under your hand. The preview holds still, and the real page only
changes when you say so.

It is **real DOM using the app's own parts**, not a picture: the shared bar
(`uiBar`), knob (`uiKnob`), switch (`uiSeg`) and preset bar (`pbarMake`), the
panels and wells, a Now Playing strip, a waveform in the palette's own colour,
and the four text steps. A screenshot goes stale the moment anything is
restyled; these are repainted by the same stylesheet as the pages, so the
preview cannot drift from them. They move, too — the preview keeps its own
values, so turning a knob shows how it looks moving without touching a sound.

It replaced a miniature of the shell's Cut/Crop/Export bar, which showed parts
the pages no longer use.

It shows **Grain, Chop and Wave**, not Edit and Seq as the mock-up's switch
did: those three are the pages a theme reaches through the look (`--look-*`).
The Edit page and the Now Playing bar take their colours from the Look alone
(`--m-*` on `:root[data-mgl-look]`), and Seq has its own palette, so a preview
of either in a palette would show something wearing it does not do.

The same is true, strictly, of the preview's **Now Playing strip**: it is
painted in the palette, as the mock-up drew it, while the real bar follows only
the Look.

**The preview starts from the stylesheet, not from what is worn.** A palette
that states only some tokens — a Look states only the look — is laid over the
interface's own values (`themeDefaults`, read once before any theme is put on),
so the preview shows what the palette will look like when worn, not that
palette mixed with the one you happen to be wearing.

## A click previews; Wear it wears

From 17 Aug to 13 Nov 2026 a click on a palette wore it, on the argument that
the pane sat inside the thing being themed and looking at the app in a theme
was the whole reason to click one. The page has a preview large enough to
judge by, and the approved mock-up says it plainly — *nothing changes until
Wear*. So a click opens the palette in the editor and paints the preview, and
**Wear it** puts it on. A double-click on a card does both.

## The Look

Grain's five Looks — Graphite + Acrylic, Graphite, Glass, Ceramic, Acrylic —
became themes on 11 Nov 2026 (`LOOK_THEMES` in `theme-palettes.js`). They are
in the editor as five tiles, each in its own surfaces and material, and
choosing one is the Now Playing bar's own choice (`nbSetLook`, then
`themeWearLook`), so the bar, `mglLook`, `data-mgl-look` and the theme never
disagree. A Look is still a theme, as before: choosing one wears it and opens
it in the editor.

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

- The **cards**, filterable, with the shipped palettes marked *built in*.
- **Name**, and **N colours** — each a colour well *and* a hex field, and what
  the engine makes of it: *surfaces*, *text* or *accent*. Both a well and a hex,
  deliberately: the well is how a colour is chosen, the hex is how one arrives
  from a style guide. Add and remove them freely. The rows are sorted dark to
  light when they are built and again when a colour is committed, never while
  one is being dragged (see below).
- **Wear it**, **Duplicate**, **Delete**. A built-in can be previewed and
  duplicated but never edited or deleted, so a palette someone has built on can
  never be pulled out from under them.
- **Copy JSON** and **Import JSON**, so a palette can leave and come back.
- A **token inspector** — every derived value with its chip, folded away. Sixty
  rows is a reference rather than a control, but when a theme looks wrong this
  is where the reason is.

## The waveform belongs to the palette

It used to sit above the studio as one standing choice, on the argument that a
theme has no business colouring the sound. That argument was about *derivation*
and it still holds — the waveform is not worked out from the surfaces, because
which colour reads best against a sound is a matter of the sound. But a theme
can still **carry** one, and being asked for it is what makes a theme a whole
look rather than the chrome half of one.

Each palette holds its own; wearing a palette brings its waveform with it.
Without one, the standing choice stands.

## What a theme still may not touch

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
palette, a different number of colours, or read-only flipping — and, since the
rows are sorted dark to light, when a colour is committed (`change`, which
fires once the system's panel has closed). Each row remembers which colour it
holds (`data-i`), so a drag never reorders the rows under the pointer. Nothing
is written into an element that has focus.

### The value was never the broken part

It arrived correctly the whole time. `tsSetColor` had already run by the moment
the DOM was thrown away, so the palette held exactly the right colour — a test
that asserted on the palette would have passed on the fault, cheerfully, forever.

What has to survive is the *element*. The test drives a run of `input` events at
one well and asserts it is still in the document and still the same node
afterwards. Put the `innerHTML = ''` back and it fails on the first step:
`alive: false`.


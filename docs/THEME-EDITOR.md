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
- **Middle: the parts**, a sheet of today's controls in the palette open in
  the editor (below).
- **Right: the editor** — the palette's name, **Wear it**, **Duplicate** and
  **Delete**; its colours dark to light; the waveform's colour; and the Look.
  The derived tokens are folded away at the foot.
- **Across the top**: what is worn and what is open, a switch for how it is
  worn (*Palettes*, *Plain surfaces*, *No theme*), and **Import JSON** and
  **Copy JSON**. Under it, **See it on**: a button for every page of the app —
  Edit, Grain, Prism, Chop, Wave, Visual, Seq and Browse — which shows that
  page itself in the palette being edited (below).

The explanations that used to sit between the controls are tooltips now, and
this document. The behaviour is the same as the pane's except for one thing,
below: a click on a card no longer wears it.

The page lives in three files: `330-theme.js` (the cards, wearing, the
waveform colour), `355-theme-page.js` (the parts, the pages and the Look) and
`360-theme-editor.js` (the editor). Its stylesheet is the Theme page's section
of `ui/app-css/050-theme-room.css`.

**`355` comes before `360` on purpose.** `tsWire`, at the end of the editor,
paints the preview while the page loads; a `const` declared in a later file is
still in its dead zone then, and reading it throws and takes the rest of
`app.js` with it.

## Every page, itself

*14 Nov 2026.* RJ, of the preview's switch: *"I've got grain, chop, and wave,
and they're all exactly the same. It's all useless."* They were: three sets of
names — titles, three bars, four knobs, the tabs — on one skeleton in
`#themeMini`. The pages' own stylesheets are scoped to the pages
(`#grainView`, `#waveView`, `body.choppage`, `#dockHyper`, `body.wavepage`)
and never reached the miniature, so the three looked alike and like none of
the pages, and the page you most wanted to judge a theme on was never one of
them.

So the row across the top has a button for every page the rail lists (read
from the rail's own buttons, so a page added there turns up here), and a
button shows **the page itself** in the palette open in the editor:

- The palette's tokens go on the root with `Theme.apply`, the call Wear it
  makes, with its Look (`data-mgl-look`) and its waveform. `themeState.chosen`
  is not touched and nothing is saved.
- The page is reached by pressing its rail button, so it arrives exactly as
  it does from the rail — the sound it shows, the tray, the drawer. Edit,
  Grain, Prism and Chop need a sound open, as the rail says.
- The editor goes with it: its section is *moved* (not copied — one of each
  id, the same handlers) into `#tpDock`, a column at the right of the window,
  with the row of pages again, the next and previous palette, **← Theme** and
  **Stop**. Moving between pages, by the dock or by the rail, keeps the
  preview; every edit repaints the page, a frame at a time.
- **← Theme** (or the rail's Theme) ends it, puts the worn theme back and the
  Edit page there was (`setEditPage` remembers the last one). **Stop** ends it
  and stays on the page, in what you wear. **Wear it** in the dock wears it.

**Why the real page, not a better miniature.** A miniature looks like a page
only if the page's stylesheet reaches it. Doing that means giving it the
page's ids, which then exist twice in the document, or the page's body
classes, which change the real page underneath. Seq is an iframe and cannot
be copied at all; it reads the theme off the root (`ui/sequencer/look.js`).
And the tokens the stylesheet derives on `:root` itself (a `color-mix` of
`--accent`, say) are worked out there and inherited as values, so a theme
scoped to a container is never quite the theme. On the root it is the theme
exactly as it will be worn.

**The editor holds still.** The reason this page once gave for not previewing
on the page was that a control which repaints the whole interface jumps under
your hand. The dock is therefore given the *worn* theme's tokens on its own
element (`Theme.applyTo`, over `themeDefaults`), so only the page behind it
changes. The exception is editing the palette you are wearing, which repaints
the dock as it always repainted the Theme page.

## The parts

The middle of the Theme page is a sheet of **real DOM using the app's own
parts**, not a picture: the shared bar (`uiBar`), knob (`uiKnob`), switch
(`uiSeg`) and preset bar (`pbarMake`), the panels and wells, a Now Playing
strip, a waveform in the palette's own colour, and the four text steps. It is
painted with `Theme.applyTo(#themeMini, tokens)`, so it changes as you click
through the cards without anything on the root changing. It is the quick look;
the pages above are the real one. They move, too — the sheet keeps its own
values, so turning a knob shows how it looks moving without touching a sound.

It replaced a miniature of the shell's Cut/Crop/Export bar, which showed parts
the pages no longer use.

The sheet's **Now Playing strip** is painted in the palette, as the mock-up
drew it, while the real bar follows only the Look (`--m-*` on
`:root[data-mgl-look]`); so does the Edit page. A page shown from the row
shows that as it is.

**The parts start from the stylesheet, not from what is worn.** A palette
that states only some tokens — a Look states only the look — is laid over the
interface's own values (`themeDefaults`, read once before any theme is put on),
so the sheet shows what the palette will look like when worn, not that
palette mixed with the one you happen to be wearing. A page shown from the row
needs none of this: `Theme.apply` clears the root before it writes.

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
choosing one calls `nbSetLook`, then `themeWearLook`, so `mglLook`,
`data-mgl-look` and the theme never disagree. The Now Playing bar had its own
five buttons until 14 Nov 2026; the Theme page is the one place now. A Look is still a theme, as before: choosing one wears it and opens
it in the editor.

## The tokens go on a container, not on `:root`

`Theme.apply` sets the variables on `document.documentElement`, which is what
makes a theme global. The parts sheet needs the same variables scoped to one
element, so `Theme.applyTo(el, tokens)` does the work and `apply` is now a call
to it with the root. Everything in the interface reads its colours through
`var(--x)`, so scoping the variables to a container themes everything inside it
and nothing outside — nearly: a token the stylesheet works out on `:root` from
another is inherited as a value, so it stays the root's. That is one reason the
pages are shown themselves rather than as copies (*Every page, itself*).

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


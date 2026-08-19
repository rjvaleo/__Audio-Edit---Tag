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

## No colour codes

The first version put three `<input type="color">` in the panel. That is a
developer's idea of a colour tool: nobody chooses a theme by typing `#0e1116`.

What the panel offers instead is five things you can feel, each drawn as a strip
you drag, painted with what it does across its whole length so the choice is
visible before it is made:

| control | what it moves |
|---|---|
| **Hue** | the whole theme turns |
| **Accent** | its own hue, so the interval against the theme can be chosen |
| **Colour** | how saturated the surfaces are, grey through to vivid |
| **Contrast** | how far apart the rungs sit — flat and moody, or every panel separated |
| **Light** | where the ladder sits, deep black through to a light interface |

Six **variations** sit under them — as is, warmer, cooler, complement, triad,
mono — because turning one hue at a time only ever finds the theme next door,
and the interesting ones are usually a third of the way round the wheel.

Beside them, the **contrast figures**: text, dim and dimmer against the surface
they sit on, in WCAG ratios, marked when they fall under 4.5 and coloured when
they fall under 3. A theme that cannot be read is not a theme, and that is not
obvious by eye on a colour you have been staring at for a minute.

**Light and dark are one control, not a switch.** Push *Light* past the middle
and the text ladder turns over: the default is light text on dark ground with
its dim steps *below* the brightest, and on a light theme the text must be dark
with its dim steps *above* — otherwise "dim" would mean brighter than the thing
it is dimming.

## The ladder, not the colours

The earlier plan was to name eight surface steps, four text steps and one accent
directly, because deriving sixty tokens from five produces arbitrary results.
That plan was wrong — not because derivation is fine, but because hand-naming
thirteen colours is work, and asking someone to do work is not a design.

**The palette that ships is already a good theme.** So the ladder is not
invented: it is *measured* from the stylesheet's own `:root` and reproduced.

- Read every default surface and text token, resolved to RGB.
- Record each one's lightness and saturation relative to the base of its group.
- Given a picked colour, keep those relationships and move the hue, the
  saturation and the whole ladder's lightness to match it.

The contrast structure the panels were designed against is preserved by
construction, because it is copied from the panels' own design rather than
guessed at. What the pickers choose is where the ladder sits and what colour it
is — not how far apart its rungs are.

Three pickers: **surface**, **text**, **accent**.

## What a theme still may not touch

`--good`, `--warn` and `--bad` carry meaning rather than style. `--wave` and
`--wave-2` belong to the sound, not the chrome. Lines and shadows are
translucent black and white, which sit correctly on any ground without being
told what colour it is. None of them are offered, for the same reasons they are
absent from `THEME_TOKEN_MAP`.

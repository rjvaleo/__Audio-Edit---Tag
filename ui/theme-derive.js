// The palette-to-theme engine, ported from Emovis' Theme Studio.
//
// Transpiled from its TypeScript rather than retyped, so the arithmetic is the
// original's exactly — this is the half of that component worth having, and a
// transcription error in it would be invisible until a theme looked wrong.
//
// What was *not* ported is its React interface. This program has no React and
// no build step; `ui/*.js` are plain scripts embedded in the binary, which is
// what makes it one file to ship. The manager and editor are rebuilt in this
// app's own idiom instead, in `app.js`.
//
// Loaded before `app.js` and reachable through the `Theme` object at the
// bottom. Nothing here touches the DOM or the network: give it hex, get tokens.

/**
 * Turning a five-colour palette card into a working theme.
 *
 * A palette gives brand colours, not a UI. What the application needs is a
 * ladder: six surface steps, seven text steps, five borders, an accent family
 * and the status tints — around sixty values. Hand-authoring that for every
 * palette would be sixty chances to drift; deriving it means a card only has to
 * supply hue and mood, and every generated theme is internally consistent by
 * construction.
 *
 * Two decisions carry the whole file:
 *
 * 1. **Direction is read from the palette, not imposed.** A card whose colours
 *    average light (Sorbet, Pearl) becomes a light theme; one that averages
 *    dark (Fireside, Ink wash) becomes a dark one. Forcing every palette into
 *    dark surfaces would misrepresent half the deck.
 *
 * 2. **Hue is borrowed, lightness is not.** Surfaces take the palette's hue and
 *    a damped share of its saturation, but their lightness comes from a fixed
 *    ladder. That is what keeps contrast legible no matter what the card holds:
 *    a palette of five near-identical mid-tones still yields a usable interface,
 *    because the steps are ours and only the colour is theirs.
 *
 * Status hues (green done, amber risk, red blocked, violet proposed) are never
 * taken from the palette — they carry meaning, and a theme is not allowed to
 * repaint them. Only their pitch moves, to sit on that theme's surfaces.
 */
function hexToRgb(hex) {
    const v = hex.replace('#', '');
    const n = parseInt(v.length === 3
        ? v
            .split('')
            .map((c) => c + c)
            .join('')
        : v, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbToHsl([r, g, b]) {
    const rn = r / 255;
    const gn = g / 255;
    const bn = b / 255;
    const max = Math.max(rn, gn, bn);
    const min = Math.min(rn, gn, bn);
    const l = (max + min) / 2;
    if (max === min)
        return { h: 0, s: 0, l };
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h;
    if (max === rn)
        h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
    else if (max === gn)
        h = ((bn - rn) / d + 2) / 6;
    else
        h = ((rn - gn) / d + 4) / 6;
    return { h: h * 360, s, l };
}
/** h in degrees, s and l in 0..1. */
function hsl(h, s, l) {
    const hn = (((h % 360) + 360) % 360) / 360;
    const sn = clamp(s, 0, 1);
    const ln = clamp(l, 0, 1);
    if (sn === 0)
        return toHex(ln, ln, ln);
    const q = ln < 0.5 ? ln * (1 + sn) : ln + sn - ln * sn;
    const p = 2 * ln - q;
    return toHex(hue(p, q, hn + 1 / 3), hue(p, q, hn), hue(p, q, hn - 1 / 3));
}
function hue(p, q, t) {
    let tn = t;
    if (tn < 0)
        tn += 1;
    if (tn > 1)
        tn -= 1;
    if (tn < 1 / 6)
        return p + (q - p) * 6 * tn;
    if (tn < 1 / 2)
        return q;
    if (tn < 2 / 3)
        return p + (q - p) * (2 / 3 - tn) * 6;
    return p;
}
function toHex(r, g, b) {
    const c = (v) => Math.round(clamp(v, 0, 1) * 255)
        .toString(16)
        .padStart(2, '0');
    return `#${c(r)}${c(g)}${c(b)}`;
}
/** "R G B" — the form the alpha-carrying tokens interpolate into rgb(). */
function triplet(hexValue) {
    return hexToRgb(hexValue).join(' ');
}
function rgba(hexValue, alpha) {
    return `rgba(${hexToRgb(hexValue).join(', ')}, ${alpha})`;
}
function clamp(v, lo, hi) {
    return Math.min(hi, Math.max(lo, v));
}
/** Perceived lightness, for deciding a palette's direction. */
function luminance([r, g, b]) {
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}
// ---- the status hues, which no palette may repaint --------------------------
const STATUS_HUE = { done: 145, progress: 212, risk: 42, blocked: 355, external: 275 };
const FAMILY_HUE = { emerald: 152, amber: 42, red: 355, indigo: 235, violet: 275 };
// ---- derivation ------------------------------------------------------------
/**
 * Where a palette sits in the picker: neighbours share a hue, and within a hue
 * the list runs light to dark.
 *
 * Hue is averaged as a vector, not as a number — the mean of 350° and 10° is
 * 0°, not 180°, and a plain average would file a red palette under cyan.
 * Saturation weights that vector, so a palette's near-greys do not drag its
 * hue toward whatever they happen to round to. Palettes with no meaningful hue
 * at all sort first as a neutrals block rather than being scattered through the
 * colours by whatever noise their greys carry.
 */
function paletteOrder(colors) {
    const parsed = colors.map((hex) => ({ ...rgbToHsl(hexToRgb(hex)), lum: luminance(hexToRgb(hex)) }));
    let x = 0;
    let y = 0;
    for (const c of parsed) {
        x += Math.cos((c.h * Math.PI) / 180) * c.s;
        y += Math.sin((c.h * Math.PI) / 180) * c.s;
    }
    const chroma = Math.hypot(x, y) / parsed.length;
    const hue = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
    const light = parsed.reduce((a, c) => a + c.lum, 0) / parsed.length;
    return { chroma, hue, light };
}
/** Surfaces with the tint taken out; hue survives only in borders and text. */
function withWhiteSurfaces(tokens) {
    return {
        ...tokens,
        '--s-body': '255 255 255',
        '--s-page': '250 250 250',
        '--s-card': '#ffffff',
        '--s-raised': '243 243 244',
        '--s-200': '#e9e9ea',
    };
}
function deriveTheme(colors) {
    const parsed = colors.map((hex) => ({ hex, ...rgbToHsl(hexToRgb(hex)), lum: luminance(hexToRgb(hex)) }));
    const meanLum = parsed.reduce((a, c) => a + c.lum, 0) / parsed.length;
    const mode = meanLum > 0.58 ? 'light' : 'dark';
    // The accent is the palette's most chromatic colour — the one a person would
    // point at and call "the colour of this palette". Ties break toward mid
    // lightness, since a near-black or near-white accent reads as neither.
    const accent = [...parsed].sort((a, b) => b.s * (1 - Math.abs(b.l - 0.5)) - a.s * (1 - Math.abs(a.l - 0.5)))[0];
    // Surfaces follow the palette's darkest colour in a dark theme and its
    // lightest in a light one, so the theme's ground is a colour the card
    // actually contains rather than an invention.
    //
    // Except when that colour has no colour in it. Half these palettes include a
    // white or near-white, and taking the ground from it produced light themes
    // that were simply white — the palette survived only in the accents. So a
    // washed-out ground borrows its hue from the palette's most chromatic colour
    // instead: the surfaces are still that palette's, just at tint strength.
    const groundByLuminance = [...parsed].sort((a, b) => (mode === 'dark' ? a.lum - b.lum : b.lum - a.lum))[0];
    const mostChromatic = [...parsed].sort((a, b) => b.s - a.s)[0];
    const ground = groundByLuminance.s < 0.12 ? mostChromatic : groundByLuminance;
    const gh = ground.s < 0.04 ? 0 : ground.h;
    const gs = ground.s < 0.04 ? 0 : clamp(ground.s * 0.85, 0.05, 0.5);
    const ah = accent.s < 0.04 ? gh : accent.h;
    const as = accent.s < 0.04 ? Math.max(gs, 0.05) : clamp(accent.s, 0.3, 0.85);
    if (mode === 'dark')
        return { mode, ...darkTokens(gh, gs, ah, as) };
    const light = lightTokens(gh, gs, ah, as);
    return { mode, ...light, plainTokens: withWhiteSurfaces(light.tokens) };
}
function darkTokens(gh, gs, ah, as) {
    const g = (l, sat = gs) => hsl(gh, sat, l);
    const a = (l, sat = as) => hsl(ah, sat, l);
    const txSat = Math.min(gs, 0.14);
    const status = (h) => ({ bg: hsl(h, 0.42, 0.22), text: hsl(h, 0.75, 0.74) });
    const done = status(STATUS_HUE.done);
    const progress = status(STATUS_HUE.progress);
    const risk = status(STATUS_HUE.risk);
    const blocked = status(STATUS_HUE.blocked);
    const external = status(STATUS_HUE.external);
    const tokens = {
        '--color-navy': a(0.84, Math.min(as, 0.55)),
        '--color-brand': a(0.74, Math.min(as, 0.5)),
        '--color-ink': g(0.95, txSat),
        '--color-mute': g(0.66, txSat),
        '--chart-track': g(0.31),
        '--chart-track-strong': g(0.44),
        '--metric-warn': blocked.text,
        '--status-done-text': done.text,
        '--status-done-bg': done.bg,
        '--status-progress-text': progress.text,
        '--status-progress-bg': progress.bg,
        '--status-risk-text': risk.text,
        '--status-risk-bg': risk.bg,
        '--status-blocked-text': blocked.text,
        '--status-blocked-bg': blocked.bg,
        '--status-todo-text': g(0.85, txSat),
        '--status-todo-bg': g(0.28),
        '--status-external-text': external.text,
        '--status-external-bg': external.bg,
        '--lane-active-bar': '#ffffff',
        '--lane-active-track': 'rgba(255, 255, 255, .2)',
        // Dark themes select by lifting: the chosen lane is lighter than the rail
        // around it, and the content sits between the two.
        '--sel': a(0.82, Math.max(as, 0.35)),
        '--sel-ink': a(0.95, Math.min(as, 0.2)),
        '--sel-fill': a(0.34, Math.max(as, 0.28)),
        '--sel-fill-2': a(0.25, Math.max(as, 0.25)),
        '--sel-edge': rgba(a(0.82, Math.max(as, 0.35)), 0.55),
        '--sel-soft': rgba(a(0.82, Math.max(as, 0.35)), 0.22),
        '--s-body': triplet(g(0.11)),
        '--s-page': triplet(g(0.13)),
        '--s-card': g(0.17),
        '--s-raised': triplet(g(0.23)),
        '--s-200': g(0.29),
        '--s-300': g(0.38),
        '--s-900': g(0.07),
        '--s-nav': g(0.14),
        '--s-brand': g(0.34),
        '--tx-max': '#ffffff',
        '--tx-800': g(0.95, txSat),
        '--tx-700': g(0.88, txSat),
        '--tx-600': g(0.78, txSat),
        '--tx-500': g(0.67, txSat),
        '--tx-400': g(0.56, txSat),
        '--tx-300': g(0.46, txSat),
        '--bd-50': g(0.2),
        '--bd-100': g(0.25),
        '--bd-200': g(0.31),
        '--bd-300': g(0.41),
        '--bd-400': g(0.51),
        '--bd-hairline': `rgba(${triplet(g(0.7, txSat)).split(' ').join(', ')}, .22)`,
        '--ac-50': triplet(a(0.22, as * 0.7)),
        '--ac-100': triplet(a(0.27, as * 0.7)),
        '--ac-200': triplet(a(0.33, as * 0.75)),
        '--ac-400': triplet(a(0.48)),
        '--ac-tx-900': a(0.88, Math.min(as, 0.5)),
        '--ac-tx-700': a(0.78, Math.min(as, 0.55)),
        '--ac-tx-600': a(0.68, Math.min(as, 0.6)),
        '--ac-bd-300': a(0.42),
        '--ac-bd-500': a(0.55),
        '--ac-on': a(0.58),
        '--hv-50': g(0.23),
        '--hv-100': g(0.29),
        '--hv-200': g(0.36),
        '--hv-ac-50': a(0.31, as * 0.7),
        '--hv-ac-100': a(0.37, as * 0.75),
        '--em-50': triplet(hsl(FAMILY_HUE.emerald, 0.45, 0.22)),
        '--em-100': hsl(FAMILY_HUE.emerald, 0.45, 0.27),
        '--em-bd-200': hsl(FAMILY_HUE.emerald, 0.45, 0.34),
        '--hv-em': hsl(FAMILY_HUE.emerald, 0.45, 0.3),
        '--am-50': triplet(hsl(FAMILY_HUE.amber, 0.45, 0.21)),
        '--am-100': triplet(hsl(FAMILY_HUE.amber, 0.45, 0.26)),
        '--am-bd-200': hsl(FAMILY_HUE.amber, 0.45, 0.32),
        '--am-bd-300': hsl(FAMILY_HUE.amber, 0.6, 0.45),
        '--hv-am': hsl(FAMILY_HUE.amber, 0.45, 0.29),
        '--rd-50': hsl(FAMILY_HUE.red, 0.35, 0.24),
        '--rd-100': hsl(FAMILY_HUE.red, 0.35, 0.29),
        '--rd-bd-200': hsl(FAMILY_HUE.red, 0.35, 0.37),
        '--rd-bd-300': hsl(FAMILY_HUE.red, 0.5, 0.56),
        '--ig-50': triplet(hsl(FAMILY_HUE.indigo, 0.3, 0.28)),
        '--ig-100': hsl(FAMILY_HUE.indigo, 0.3, 0.35),
        '--ig-bd': hsl(FAMILY_HUE.indigo, 0.3, 0.52),
        '--vi-50': hsl(FAMILY_HUE.violet, 0.3, 0.27),
        '--vi-bd': hsl(FAMILY_HUE.violet, 0.3, 0.46),
        '--scroll': g(0.4),
        '--scroll-hover': g(0.52),
        '--placeholder': g(0.56, txSat),
        '--caret': a(0.78, Math.min(as, 0.55)),
    };
    return {
        tokens,
        swatch: { surface: g(0.17), accent: a(0.68, Math.min(as, 0.6)), ink: g(0.95, txSat) },
    };
}
function lightTokens(gh, gs, ah, as) {
    // A light theme's surfaces are tints, not whites. The floor matters as much
    // as the ceiling: below roughly 0.18 the tint disappears at these lightnesses
    // and every palette converges on the same white page, which is the one thing
    // a palette theme must not do. The `whitePageSurfaces` setting exists for
    // anyone who does want plain white.
    const sSat = clamp(gs, 0.24, 0.6);
    const g = (l, sat = sSat) => hsl(gh, sat, l);
    const a = (l, sat = as) => hsl(ah, sat, l);
    const status = (h) => ({ bg: hsl(h, 0.55, 0.91), text: hsl(h, 0.7, 0.31) });
    const done = status(STATUS_HUE.done);
    const progress = status(STATUS_HUE.progress);
    const risk = status(STATUS_HUE.risk);
    const blocked = status(STATUS_HUE.blocked);
    const external = status(STATUS_HUE.external);
    const tokens = {
        '--color-navy': a(0.28, Math.max(as, 0.35)),
        '--color-brand': a(0.38, Math.max(as, 0.3)),
        '--color-ink': g(0.14, Math.min(sSat, 0.2)),
        '--color-mute': g(0.45, Math.min(sSat, 0.14)),
        '--chart-track': g(0.86, sSat * 0.75),
        '--chart-track-strong': g(0.76, sSat * 0.75),
        '--metric-warn': blocked.text,
        '--status-done-text': done.text,
        '--status-done-bg': done.bg,
        '--status-progress-text': progress.text,
        '--status-progress-bg': progress.bg,
        '--status-risk-text': risk.text,
        '--status-risk-bg': risk.bg,
        '--status-blocked-text': blocked.text,
        '--status-blocked-bg': blocked.bg,
        '--status-todo-text': g(0.38, Math.min(sSat, 0.12)),
        '--status-todo-bg': g(0.9, sSat * 0.7),
        '--status-external-text': external.text,
        '--status-external-bg': external.bg,
        '--lane-active-bar': '#ffffff',
        '--lane-active-track': 'rgba(255, 255, 255, .2)',
        '--sel': a(0.38),
        '--sel-ink': a(0.2, Math.min(as, 0.55)),
        '--sel-fill': a(0.87, Math.max(as * 0.7, 0.3)),
        '--sel-fill-2': a(0.945, Math.max(as * 0.55, 0.25)),
        '--sel-edge': rgba(a(0.38), 0.45),
        '--sel-soft': rgba(a(0.38), 0.18),
        // Card sits above page, page above body — a tint ladder rather than three
        // shades of white, so the card still reads as a card.
        '--s-body': triplet(g(0.915, sSat * 0.85)),
        '--s-page': triplet(g(0.9, sSat * 0.9)),
        '--s-card': g(0.955, sSat * 0.7),
        '--s-raised': triplet(g(0.86, sSat * 0.95)),
        '--s-200': g(0.8, sSat),
        '--s-300': g(0.7, sSat),
        // The header paints white text on --s-nav in every theme, so it stays dark
        // whichever direction the palette pulls.
        '--s-900': hsl(gh, Math.min(gs, 0.4), 0.16),
        '--s-nav': hsl(ah, Math.min(as, 0.55), 0.22),
        '--s-brand': hsl(ah, Math.min(as, 0.55), 0.34),
        '--tx-max': g(0.08, Math.min(sSat, 0.25)),
        '--tx-800': g(0.14, Math.min(sSat, 0.2)),
        '--tx-700': g(0.24, Math.min(sSat, 0.16)),
        '--tx-600': g(0.34, Math.min(sSat, 0.14)),
        '--tx-500': g(0.45, Math.min(sSat, 0.12)),
        '--tx-400': g(0.56, Math.min(sSat, 0.1)),
        '--tx-300': g(0.67, Math.min(sSat, 0.1)),
        '--bd-50': g(0.92, sSat * 0.65),
        '--bd-100': g(0.88, sSat * 0.7),
        '--bd-200': g(0.83, sSat * 0.75),
        '--bd-300': g(0.73, sSat * 0.75),
        '--bd-400': g(0.62, sSat * 0.75),
        '--bd-hairline': 'rgba(15, 23, 42, .10)',
        '--ac-50': triplet(a(0.94, as * 0.6)),
        '--ac-100': triplet(a(0.89, as * 0.6)),
        '--ac-200': triplet(a(0.82, as * 0.65)),
        '--ac-400': triplet(a(0.62)),
        '--ac-tx-900': a(0.26),
        '--ac-tx-700': a(0.34),
        '--ac-tx-600': a(0.42),
        '--ac-bd-300': a(0.7, as * 0.7),
        '--ac-bd-500': a(0.55),
        '--ac-on': a(0.45),
        '--hv-50': g(0.915, sSat * 0.7),
        '--hv-100': g(0.87, sSat * 0.75),
        '--hv-200': g(0.81, sSat * 0.75),
        '--hv-ac-50': a(0.9, as * 0.6),
        '--hv-ac-100': a(0.84, as * 0.65),
        '--em-50': triplet(hsl(FAMILY_HUE.emerald, 0.5, 0.92)),
        '--em-100': hsl(FAMILY_HUE.emerald, 0.5, 0.87),
        '--em-bd-200': hsl(FAMILY_HUE.emerald, 0.45, 0.75),
        '--hv-em': hsl(FAMILY_HUE.emerald, 0.5, 0.85),
        '--am-50': triplet(hsl(FAMILY_HUE.amber, 0.85, 0.92)),
        '--am-100': triplet(hsl(FAMILY_HUE.amber, 0.85, 0.86)),
        '--am-bd-200': hsl(FAMILY_HUE.amber, 0.7, 0.75),
        '--am-bd-300': hsl(FAMILY_HUE.amber, 0.7, 0.62),
        '--hv-am': hsl(FAMILY_HUE.amber, 0.85, 0.84),
        '--rd-50': hsl(FAMILY_HUE.red, 0.7, 0.94),
        '--rd-100': hsl(FAMILY_HUE.red, 0.7, 0.89),
        '--rd-bd-200': hsl(FAMILY_HUE.red, 0.6, 0.8),
        '--rd-bd-300': hsl(FAMILY_HUE.red, 0.6, 0.68),
        '--ig-50': triplet(hsl(FAMILY_HUE.indigo, 0.6, 0.94)),
        '--ig-100': hsl(FAMILY_HUE.indigo, 0.6, 0.89),
        '--ig-bd': hsl(FAMILY_HUE.indigo, 0.5, 0.78),
        '--vi-50': hsl(FAMILY_HUE.violet, 0.6, 0.94),
        '--vi-bd': hsl(FAMILY_HUE.violet, 0.5, 0.8),
        '--scroll': g(0.74, sSat * 0.75),
        '--scroll-hover': g(0.62, sSat * 0.75),
        '--placeholder': g(0.62, Math.min(sSat, 0.1)),
        '--caret': a(0.42),
    };
    return {
        tokens,
        swatch: { surface: g(0.9, sSat * 0.9), accent: a(0.42), ink: g(0.14, Math.min(sSat, 0.2)) },
    };
}

// The engine's public surface. Everything else above is its own working.
const Theme = {
  deriveTheme,
  paletteOrder,
  hexToRgb,
  rgbToHsl,
  hsl,
};

// ------------------------------------------------- onto this app's own tokens
//
// The engine derives 86 tokens for the interface it was written for. This one
// uses 22, and the two sets share **not a single name** — so a derived theme
// applied directly would set 86 variables nothing reads and change nothing on
// screen. The map is the part that did not exist in either program.
//
// Only the fifteen that carry colour are mapped. `--mono` and `--sans` are
// fonts and `--rail` and the `--param-*` group are measurements; a palette has
// no opinion about any of them and should not be allowed one.
//
// Some derived tokens are hex and some are "R G B" triplets, because that side
// interpolated them into `rgb()` with an alpha. Here they always become a
// colour, since that is what this app's CSS expects.

/// "17 17 24" -> "rgb(17 17 24)"; a hex or anything else passes through.
function themeColor(value) {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  return /^\d+\s+\d+\s+\d+$/.test(v) ? `rgb(${v})` : v;
}

/// Which derived token stands in for each of this app's.
///
/// Chosen so the ladder survives: the app's four text steps take four of the
/// engine's seven in order, and its three surfaces take three of the engine's
/// six. Collapsing them onto fewer would flatten exactly the contrast the
/// derivation exists to guarantee.
const THEME_TOKEN_MAP = {
  '--bg': '--s-body',
  '--surface': '--s-card',
  '--surface-2': '--s-raised',
  '--surface-3': '--s-200',
  '--well': '--s-page',

  '--text': '--tx-800',
  '--text-2': '--tx-700',
  '--text-dim': '--tx-500',
  '--text-dimmer': '--tx-400',

  '--line': '--bd-50',
  '--line-2': '--bd-200',

  // The accent is what the palette is *for*, so it comes from the accent family
  // rather than from a surface.
  '--accent': '--ac-on',

  // Status colours are deliberately not the palette's. They carry meaning —
  // good, warning, bad — and a theme that repainted them would make a palette
  // able to say a level was safe when it was clipping. The engine already holds
  // their hues fixed and only moves their pitch to sit on the theme's surfaces,
  // which is exactly what is wanted here.
  '--good': '--status-done-text',
  '--warn': '--status-risk-text',
  '--bad': '--status-blocked-text',
};

/// A palette's colours as this app's tokens, ready to write onto the document.
///
/// `plain` picks the white-surfaced variant of a light theme, which the engine
/// offers because whether a palette's tint suits its surfaces is a matter of
/// taste rather than a rule.
Theme.appTokens = function appTokens(colors, { plain = false } = {}) {
  const derived = Theme.deriveTheme(colors);
  const from = plain && derived.plainTokens ? derived.plainTokens : derived.tokens;
  const out = {};
  for (const [ours, theirs] of Object.entries(THEME_TOKEN_MAP)) {
    const c = themeColor(from[theirs]);
    if (c) out[ours] = c;
  }
  return { tokens: out, mode: derived.mode, swatch: derived.swatch };
};

/// Write them onto the document, or take them all off again.
///
/// Set as inline custom properties on `:root`, which beats the stylesheet's
/// `:root` block without touching it — so "no theme" is removing them rather
/// than restoring a copy of the defaults that could drift from the real ones.
Theme.apply = function apply(tokens) {
  const root = document.documentElement;
  for (const key of Object.keys(THEME_TOKEN_MAP)) root.style.removeProperty(key);
  for (const [k, v] of Object.entries(tokens || {})) root.style.setProperty(k, v);
};

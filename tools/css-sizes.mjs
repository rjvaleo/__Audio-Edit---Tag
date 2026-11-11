// Every size in a stylesheet that is off the app's steps.
//
// For the checks in `ui-check.mjs`: text on the type scale, corners on the
// three radii, buttons and fields on the three control heights, and type in the
// app's two fonts. The steps are tokens in `ui/app-css/010-shell.css`
// (`--fs-*`, `--h-*`, `--r-*`); a rule may name the token or write its value.
//
// The declarations come from `css-rules.mjs`, so this is not a parser either.

import { declarations } from './css-rules.mjs';

/// 9, 10, 11, 13 and 16 px.
const SCALE = /^(var\(--fs-(xs|s|m|l|xl)\b[^)]*\)|(9|10|11|13|16)px|0|inherit|initial|100%|1em)$/;
/// 0, 4, 6 and 8 px, and round: `50%`, or `999px` for a pill.
const RADIUS = /^(0|0px|4px|6px|8px|50%|999px|var\(--r-(s|m|l)\)|inherit)$/;
/// 20, 24 and 28 px; or not a height at all.
const HEIGHT = /^(20px|24px|28px|var\(--h-(s|m|l)\)|auto|100%|0|inherit|fit-content)$/;
/// Inter and JetBrains Mono, by their tokens or by name.
const FAMILY = /^(var\(--(sans|mono|ui|monof|look-ui)\b|inherit$|Inter\b|'JetBrains Mono'|"JetBrains Mono")/;

/// A control, by the last compound of a selector: a button, a select, a text
/// field, or a class named for one (`…-btn`, `…-tab`, `…-chip`, `…-field` …).
/// A container (`.tabbar`, `.chips`), a slider or knob input, a check box and
/// a pseudo-element are not.
function controlSelector(sel) {
  return sel.split(',').some((part) => {
    const steps = part.trim().split(/\s*[\s>+~]\s*/);
    const last = steps.pop();
    if (/::/.test(last)) return false;
    const own = last.replace(/:(is|where|not|has)\([^)]*\)/g, '');
    if (/^(button|select)\b/.test(own)) return true;
    if (/^input\b/.test(own)) {
      return !/type=["']?(range|checkbox|radio|color)/.test(own) && !/slider|knob/.test(last)
        && !/check|tog/.test(steps.pop() || '');
    }
    return (own.match(/\.[\w-]+/g) || []).some((c) => /(^\.|-)(btn|button|tab|chip|field|select|seg-btn)$/.test(c)
      || /^\.(tbtn|ghost|mini|tiny)$/.test(c));
  });
}

/// The size and the family in a `font` shorthand: `600 10px/1.3 var(--ui)`.
function shorthand(value) {
  const v = value.trim();
  if (/^(inherit|initial|unset)$/.test(v)) return {};
  const m = /(?:^|\s)((?:var\(--fs-[\w-]+[^)]*\)|[\d.]+(?:px|em|rem|%)))(?:\/\S+)?\s+(.+)$/.exec(v);
  return m ? { size: m[1], family: m[2].trim() } : { size: v };
}

/// `[{ kind, text, prop, selector, line }]`: `kind` is `size`, `radius`,
/// `height` or `family`.
export function sizeFindings(css) {
  const out = [];
  for (const d of declarations(css)) {
    const v = d.raw.trim().replace(/\s*!important$/, '');
    const add = (kind, text) => out.push({ kind, text, prop: d.prop, selector: d.selector, line: d.line });
    if (d.prop === 'font-size' && !SCALE.test(v)) add('size', v);
    if (d.prop === 'font') {
      const f = shorthand(v);
      if (f.size && !SCALE.test(f.size)) add('size', f.size);
      if (f.family && !FAMILY.test(f.family)) add('family', f.family);
    }
    if (d.prop === 'font-family' && !FAMILY.test(v)) add('family', v);
    if (/^border(-[a-z]+)*-radius$/.test(d.prop)) {
      const bad = v.split(/[\s/]+/).filter((x) => x && !RADIUS.test(x));
      if (bad.length) add('radius', v);
    }
    if ((d.prop === 'height' || d.prop === 'min-height') && controlSelector(d.selector) && !HEIGHT.test(v)) add('height', v);
  }
  return out;
}

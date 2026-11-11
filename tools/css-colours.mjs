// Every colour literal in a stylesheet, and the rule it sits in.
//
// For the colour check in `ui-check.mjs`: a colour is written once, in the token
// layer, and every other stylesheet names it. So this finds what is written
// rather than named — a `#hex`, or an `rgb()`, `hsl()` or `oklch()` whose
// channels are numbers. One that takes its channels from a token,
// `rgba(var(--white-rgb), .08)`, is named: only its alpha is written, and an
// alpha is a weight, not a colour.
//
// The declarations come from `css-rules.mjs`.

import { declarations } from './css-rules.mjs';

const FUNCTIONS = /\b(rgba?|hsla?|oklch|oklab|lch|lab|hwb)\(/gi;
const HEX = /(^|[^\w#&-])(#[0-9a-fA-F]{3,8})(?![\w-])/g;

/// The literals in one declaration's value, as offsets into the value.
function literalsIn(value) {
  const found = [];
  for (const m of value.matchAll(FUNCTIONS)) {
    const open = m.index + m[0].length - 1;
    let depth = 0;
    let j = open;
    for (; j < value.length; j++) {
      if (value[j] === '(') depth++;
      else if (value[j] === ')' && --depth === 0) break;
    }
    const text = value.slice(m.index, j + 1);
    if (!/var\(/.test(text)) found.push({ at: m.index, text });
  }
  for (const m of value.matchAll(HEX)) {
    const at = m.index + m[1].length;
    if (!found.some((f) => at >= f.at && at < f.at + f.text.length)) found.push({ at, text: m[2] });
  }
  return found.sort((a, b) => a.at - b.at);
}

/// `[{ at, text, prop, selector, line }]` for every colour literal in `css`.
/// `at` is the offset in `css`; `selector` is the rule's own, inside any
/// `@media` around it.
export function colourLiterals(css) {
  const out = [];
  for (const d of declarations(css)) {
    for (const l of literalsIn(d.value)) {
      const at = d.start + l.at;
      out.push({ at, text: css.slice(at, at + l.text.length), prop: d.prop, selector: d.selector, line: css.slice(0, at).split('\n').length });
    }
  }
  return out;
}

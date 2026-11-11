// Every colour literal in a stylesheet, and the rule it sits in.
//
// For the colour check in `ui-check.mjs`: a colour is written once, in the token
// layer, and every other stylesheet names it. So this finds what is written
// rather than named — a `#hex`, or an `rgb()`, `hsl()` or `oklch()` whose
// channels are numbers. One that takes its channels from a token,
// `rgba(var(--white-rgb), .08)`, is named: only its alpha is written, and an
// alpha is a weight, not a colour.
//
// Like `ui-check.mjs`, not a parser: comments and strings are blanked, then the
// text is cut at `{`, `;` and `}`. What comes before a `{` is a selector or an
// at-rule; what comes before a `;` or a `}` is a declaration. That is enough for
// the stylesheets here, none of which nests rules inside rules.

const FUNCTIONS = /\b(rgba?|hsla?|oklch|oklab|lch|lab|hwb)\(/gi;
const HEX = /(^|[^\w#&-])(#[0-9a-fA-F]{3,8})(?![\w-])/g;

/// The text with comments and strings blanked, every character kept in place.
function blank(css) {
  let out = '';
  let i = 0;
  while (i < css.length) {
    if (css.startsWith('/*', i)) {
      const j = css.indexOf('*/', i + 2);
      const end = j === -1 ? css.length : j + 2;
      out += css.slice(i, end).replace(/[^\n]/g, ' ');
      i = end;
    } else if (css[i] === '"' || css[i] === "'") {
      const q = css[i];
      let j = i + 1;
      while (j < css.length && css[j] !== q) j += css[j] === '\\' ? 2 : 1;
      const end = Math.min(j + 1, css.length);
      out += q + css.slice(i + 1, end - 1).replace(/[^\n]/g, ' ') + (end - 1 > i ? q : '');
      i = end;
    } else {
      out += css[i];
      i++;
    }
  }
  return out;
}

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
  const src = blank(css);
  const out = [];
  const stack = [];
  let start = 0;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c !== '{' && c !== '}' && c !== ';') continue;
    const seg = src.slice(start, i);
    if (c === '{') stack.push(seg.trim());
    else {
      const colon = seg.indexOf(':');
      if (stack.length && colon > 0 && /^\s*-{0,2}[\w-]+\s*$/.test(seg.slice(0, colon))) {
        const prop = seg.slice(0, colon).trim();
        const vStart = start + colon + 1;
        const selector = [...stack].reverse().find((s) => !s.startsWith('@')) || stack[stack.length - 1];
        for (const l of literalsIn(src.slice(vStart, i))) {
          const at = vStart + l.at;
          out.push({ at, text: css.slice(at, at + l.text.length), prop, selector, line: css.slice(0, at).split('\n').length });
        }
      }
      if (c === '}') stack.pop();
    }
    start = i + 1;
  }
  return out;
}

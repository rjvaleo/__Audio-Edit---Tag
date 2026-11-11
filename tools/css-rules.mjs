// Every declaration in a stylesheet, and the rule it sits in.
//
// For the checks in `ui-check.mjs` that read stylesheets: colours
// (`css-colours.mjs`), and the type scale, radii, control heights and fonts
// (`css-sizes.mjs`).
//
// Like `ui-check.mjs`, not a parser: comments and strings are blanked, then the
// text is cut at `{`, `;` and `}`. What comes before a `{` is a selector or an
// at-rule; what comes before a `;` or a `}` is a declaration. That is enough for
// the stylesheets here, none of which nests rules inside rules.

/// The text with comments and strings blanked, every character kept in place.
export function blank(css) {
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

/// `[{ prop, value, raw, start, selector, line }]` for every declaration in
/// `css`. `value` is blanked (strings are spaces), `raw` is as written, and
/// `start` is the value's offset in `css`. `selector` is the rule's own, inside
/// any `@media` around it.
export function declarations(css) {
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
        const vStart = start + colon + 1;
        out.push({
          prop: seg.slice(0, colon).trim(),
          value: src.slice(vStart, i),
          raw: css.slice(vStart, i),
          start: vStart,
          selector: [...stack].reverse().find((s) => !s.startsWith('@')) || stack[stack.length - 1],
          line: css.slice(0, vStart).split('\n').length,
        });
      }
      if (c === '}') stack.pop();
    }
    start = i + 1;
  }
  return out;
}

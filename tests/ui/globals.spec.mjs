// The interface's scripts share one global scope. Nothing may be declared twice.
//
// `ui/theme-derive.js` and `ui/app.js` are plain classic scripts — no modules,
// no build step, which is what makes the interface one `include_str!` to ship.
// The cost is that every top-level `function` and `const` in either of them is a
// property of the same global object, and the file that loads second wins.
//
// This is not hypothetical. A `function toHex(colour)` added to `app.js` for the
// waveform colour picker replaced the theme engine's `toHex(r, g, b)`. Nothing
// errored. Every `hsl()` in the engine began handing three numbers to a
// one-argument function, which returned black — 69 of a derived theme's 86
// tokens came out `#000000`, and each one built a canvas to do it, so applying a
// theme went from instant to 2.7 seconds. It was found by someone noticing the
// themes looked wrong.
//
// A collision cannot be caught by testing behaviour, because the behaviour that
// breaks is in whichever file lost — somewhere else entirely. So it is caught
// here, by name.

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/// Top-level declarations only — the ones that land on the global object.
///
/// Indentation is the test: a `function` or `const` at column zero is global, and
/// anything nested is somebody's local. Crude, and exactly right for two files
/// that are written this way throughout.
function topLevelNames(file) {
  const src = readFileSync(join(ROOT, file), 'utf8');
  const names = new Map();
  const patterns = [
    /^function\s+([A-Za-z_$][\w$]*)/,
    /^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/,
    /^class\s+([A-Za-z_$][\w$]*)/,
  ];
  src.split('\n').forEach((line, i) => {
    for (const p of patterns) {
      const m = line.match(p);
      if (m && !names.has(m[1])) names.set(m[1], i + 1);
    }
  });
  return names;
}

test('the interface scripts do not declare the same global twice', () => {
  const derive = topLevelNames('ui/theme-derive.js');
  const app = topLevelNames('ui/app.js');
  const palettes = topLevelNames('ui/theme-palettes.js');

  expect(derive.size, 'no declarations found in theme-derive.js — the parse is wrong')
    .toBeGreaterThan(5);
  expect(app.size, 'no declarations found in app.js — the parse is wrong')
    .toBeGreaterThan(50);

  const clashes = [];
  const pairs = [
    ['ui/theme-derive.js', derive, 'ui/app.js', app],
    ['ui/theme-palettes.js', palettes, 'ui/app.js', app],
    ['ui/theme-palettes.js', palettes, 'ui/theme-derive.js', derive],
  ];
  for (const [aName, a, bName, b] of pairs) {
    for (const [name, line] of a) {
      if (b.has(name)) {
        clashes.push(`"${name}" — ${aName}:${line} and ${bName}:${b.get(name)}`);
      }
    }
  }

  expect(
    clashes,
    `these names are declared in two scripts that share one global scope. The one\n`
    + `that loads last silently replaces the other:\n  ${clashes.join('\n  ')}`,
  ).toEqual([]);
});

/// And the consequence, measured on the running thing.
///
/// The name check above is static and would miss a collision arriving some other
/// way — an assignment rather than a declaration, a name built at runtime. This
/// asks the engine for a colour and checks it is one.
test('the theme engine derives real colours, not black', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => typeof Theme !== 'undefined' && !!Theme.deriveTheme,
    { timeout: 20_000 });

  const out = await page.evaluate(() => {
    const swatches = {
      blue: Theme.hsl(210, 0.6, 0.5),
      red: Theme.hsl(0, 0.8, 0.5),
      green: Theme.hsl(120, 0.7, 0.4),
    };
    const derived = THEME_PALETTES.find((p) => !p.direct);
    const tokens = Theme.deriveTheme(derived.colors).tokens;
    const values = Object.values(tokens);
    return {
      swatches,
      name: derived.name,
      total: values.length,
      black: values.filter((v) => v === '#000000').length,
    };
  });

  // A palette's derived tokens are not all one colour, and that colour is not
  // black. Some black is legitimate — `--lane-active-bar` and friends are
  // literals — so this is a proportion, not a zero.
  expect(out.black / out.total,
    `${out.black} of ${out.total} tokens derived from "${out.name}" are #000000`)
    .toBeLessThan(0.2);

  for (const [name, hex] of Object.entries(out.swatches)) {
    expect(hex, `Theme.hsl produced ${hex} for ${name}`).not.toBe('#000000');
    expect(hex, `Theme.hsl produced ${hex} for ${name}`).toMatch(/^#[0-9a-f]{6}$/);
  }
  // The blue really is blue, so this cannot pass on some other wrong colour.
  const [, r, g, b] = out.swatches.blue.match(/^#(..)(..)(..)$/).map((h, i) => i ? parseInt(h, 16) : h);
  expect(b, `"${out.swatches.blue}" is not a blue`).toBeGreaterThan(r);
  expect(b, `"${out.swatches.blue}" is not a blue`).toBeGreaterThan(g);
});

/// Applying a theme is instant.
///
/// The collision made it 2.7 seconds, because `allPalettes()` runs the full
/// derivation for every shipped palette on every call — 47 of them — purely to
/// ask whether each is dark. That was survivable at microseconds each and was
/// not survivable at 54ms each. The derivation is cached now; this is the
/// tripwire for both halves.
test('switching theme does not block the interface', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => typeof allPalettes === 'function', { timeout: 20_000 });

  const ms = await page.evaluate(() => {
    allPalettes();                       // warm whatever is cached
    const t0 = performance.now();
    for (let i = 0; i < 5; i++) allPalettes();
    return (performance.now() - t0) / 5;
  });
  expect(ms, `allPalettes() takes ${ms.toFixed(1)}ms a call`).toBeLessThan(20);
});

// The interface script, as the browser gets it.
//
// `ui/app.js` is written as parts in `ui/app/`, one per area of the interface,
// and the server's build (`core/crates/server/build.rs`) joins them in name
// order into the one classic script it serves. One script, not many: the parts
// call functions declared further down, which only hoisting within a single
// script allows. Anything that reads the interface's source reads it through
// here, so it reads exactly what the browser runs.

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const APP_DIR = join(root, 'ui/app');

/// The parts in the order they are joined: their name, their text, and the
/// line of the joined script each one starts on.
export function appParts() {
  let line = 1;
  return readdirSync(APP_DIR)
    .filter((f) => f.endsWith('.js'))
    .sort()
    .map((name) => {
      const text = readFileSync(join(APP_DIR, name), 'utf8');
      const part = { name, file: `ui/app/${name}`, text, line };
      line += text.split('\n').length - 1;
      return part;
    });
}

/// The joined script.
export function appSource() {
  return appParts().map((p) => p.text).join('');
}

/// Where a line of the joined script is written: `ui/app/<part>.js:<line>`.
export function whereIs(line, parts = appParts()) {
  let at = parts[0];
  for (const p of parts) if (p.line <= line) at = p;
  return `${at.file}:${line - at.line + 1}`;
}

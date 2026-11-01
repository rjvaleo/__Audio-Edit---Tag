// Run only the tests a change can reach.
//
//   npm run test:changed            run them
//   npm run test:changed -- --list  say which, and why, and run nothing
//
// What changed is everything that differs from the commit the test map was made
// at (`tests/ui/test-map.json`, from `npm run test:map`), committed or not.
//
// Browser specs:
//   - an interface script (`ui/app/*.js`, `ui/*.js`): the specs that ran a
//     function containing a changed line. A changed line inside no function
//     runs while the page loads, so every spec. Blank and comment lines run
//     nothing.
//   - a spec: that spec. A spec the map has never seen: always.
//   - the page, the stylesheets, the server, the test harness: every spec.
// Rust: `cargo test -p` for each crate changed, and the crates that use it.
//
// One worker and low priority, always: the machine has to stay usable.

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const LIST = process.argv.includes('--list');
const git = (...a) => spawnSync('git', a, { cwd: root, encoding: 'utf8', maxBuffer: 1 << 26 }).stdout;

const mapFile = join(root, 'tests/ui/test-map.json');
const map = existsSync(mapFile) ? JSON.parse(readFileSync(mapFile, 'utf8')) : null;
const allSpecs = readdirSync(join(root, 'tests/ui')).filter((f) => f.endsWith('.spec.mjs')).sort();
const base = map?.commit || 'HEAD';

const changed = [...new Set([
  ...git('diff', '--name-only', base).split('\n'),
  ...git('ls-files', '--others', '--exclude-standard').split('\n'),
].filter(Boolean))];

const specs = new Map(); // spec → why
const crates = new Set();
const every = (why) => { for (const s of allSpecs) if (!specs.has(s)) specs.set(s, why); };
const add = (s, why) => { if (!specs.has(s)) specs.set(s, why); };

if (!map) every('no test map yet — npm run test:map');
for (const s of allSpecs) if (map && !map.specs[s] && !specs.has(s)) add(s, 'not in the map');

/// The old-side lines a diff of `file` touches, and whether any of them is code.
function touched(file) {
  const out = [];
  let code = false;
  const d = git('diff', '-U0', base, '--', file);
  for (const line of d.split('\n')) {
    const h = line.match(/^@@ -(\d+)(?:,(\d+))? \+\d+(?:,\d+)? @@/);
    if (h) {
      const start = +h[1], n = h[2] === undefined ? 1 : +h[2];
      // A pure insertion touches the line it went after.
      if (n === 0) out.push(Math.max(1, start));
      for (let i = 0; i < n; i++) out.push(start + i);
      continue;
    }
    if (/^[-+](?![-+]{2} )/.test(line)) {
      const t = line.slice(1).trim();
      if (t && !/^(\/\/|\/\*|\*)/.test(t)) code = true;
    }
  }
  return { lines: out, code };
}

/// Add the specs that ran a function containing one of `lines` of the script at
/// `url`. Returns the lines no spec's function contains.
function reach(url, lines, why) {
  const loose = [];
  for (const line of lines) {
    let hit = false;
    for (const [spec, per] of Object.entries(map.specs)) {
      if ((per[url] || []).some(([a, b]) => a <= line && line <= b)) { add(spec, why); hit = true; }
    }
    if (!hit) loose.push(line);
  }
  return loose;
}

for (const f of changed) {
  if (f.startsWith('docs/') || f.endsWith('.md')) continue;
  if (f.startsWith('tests/ui/') && f.endsWith('.spec.mjs')) { if (existsSync(join(root, f))) add(basename(f), 'the spec changed'); continue; }
  if (f === 'tests/ui/test-map.json') continue;
  const crate = f.match(/^core\/crates\/([^/]+)\//);
  if (crate) {
    crates.add(crate[1]);
    if (crate[1] === 'server' || crate[1] === 'audiolab') every(`${f} serves the interface`);
    continue;
  }
  const part = f.match(/^ui\/app\/(.+\.js)$/);
  const script = !part && f.match(/^ui\/(.+\.js)$/);
  if (map && (part || script)) {
    const t = touched(f);
    if (!t.code) continue;
    if (part && !(part[1] in map.parts)) { every(`${f} is a new part`); continue; }
    const url = part ? '/app.js' : `/${script[1]}`;
    const lines = part ? t.lines.map((l) => map.parts[part[1]] + l - 1) : t.lines;
    const loose = reach(url, lines, `${f} — a function it ran changed`);
    if (loose.length) every(`${f}:${loose[0] - (part ? map.parts[part[1]] - 1 : 0)} runs as the page loads`);
    continue;
  }
  if (f.startsWith('core/')) continue;
  every(`${f} changed`);
}

// The crates that use a changed crate run too.
if (crates.size) {
  const meta = JSON.parse(spawnSync('cargo', ['metadata', '--format-version', '1', '--no-deps',
    '--manifest-path', join(root, 'core/Cargo.toml')], { encoding: 'utf8', maxBuffer: 1 << 26 }).stdout);
  let grew = true;
  while (grew) {
    grew = false;
    for (const p of meta.packages) {
      if (!crates.has(p.name) && p.dependencies.some((d) => crates.has(d.name))) { crates.add(p.name); grew = true; }
    }
  }
}

const list = [...specs.keys()].sort();
console.log(`changed since ${base.slice(0, 7)}: ${changed.length} file(s)`);
console.log(`browser specs: ${list.length} of ${allSpecs.length}`);
for (const s of list) console.log(`  ${s}  — ${specs.get(s)}`);
console.log(`rust crates: ${crates.size ? [...crates].sort().join(', ') : 'none'}`);
if (LIST) process.exit(0);

let failed = false;
if (crates.size) {
  const r = spawnSync('nice', ['-n', '10', 'cargo', 'test', '--release', '--manifest-path', join(root, 'core/Cargo.toml'),
    ...[...crates].flatMap((c) => ['-p', c])], { cwd: root, stdio: 'inherit' });
  failed ||= r.status !== 0;
}
if (list.length) {
  const r = spawnSync('nice', ['-n', '10', 'npx', 'playwright', 'test', '--reporter=line',
    ...list.map((s) => `tests/ui/${s}`)], { cwd: root, stdio: 'inherit' });
  failed ||= r.status !== 0;
}
process.exit(failed ? 1 : 0);

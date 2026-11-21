// Run only the tests a change can reach.
//
//   npm run test:changed            run them
//   npm run test:changed -- --list  say which, and why, and run nothing
//
// What changed is everything that differs from the commit the test map was made
// at (`tests/ui/test-map.json`, from `npm run test:map`), committed or not.
//
// Browser specs:
//   - an interface script (`ui/*.js`, `ui/sequencer/*.js`, …) or a part of a
//     joined one (`ui/app/`, `ui/stage/`, `ui/vis-gl/`, `ui/room-paint/`): the
//     specs that ran a function containing a changed line. A changed line
//     inside no function runs while the page loads, so every spec. Blank and comment lines run
//     nothing.
//   - a spec: that spec. A spec the map has never seen: always.
//   - the page, the stylesheets (`ui/app-css/` too), the server outside its
//     route handlers, the test harness: every spec.
// Rust: `cargo test -p` for each crate changed, and the crates that use it, on
// the PC; nothing else.
//
// Run on the MacBook and the PC, never on this Mac (see the end).

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
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

/// The routes whose handlers a change to the server file `f` touches, or null
/// when it touches anything else (or there is no route record in the map).
///
/// The table is `core/crates/server/src/routes.rs`: `("GET", "/api/x") => handler(…)`
/// or `=> crate::module::handler(…)`. The handlers live in the server's crates
/// (`core/crates/server-*/src/routes/*.rs`, `docs/SERVER-CRATES.md`; the core's
/// own handlers in `server-core/src/`). A changed line belongs to the top-level
/// `fn` it falls in, in the file as it was at the map's commit; every one must
/// be a handler the table names.
function serverRoutes(f) {
  if (!map?.routes || !f.endsWith('.rs') || !existsSync(join(root, f))) return null;
  const rel = f.replace(/^core\/crates\//, '');
  // The table, the interface, the plumbing every route goes through, and each
  // crate's own root and route kit.
  if (['server/src/routes.rs', 'server/src/serve.rs', 'server-ui/src/lib.rs', 'server-core/src/http.rs',
    'server-core/src/state.rs', 'server-core/src/json.rs'].includes(rel) || /^server[-\w]*\/src\/(lib|routes)\.rs$/.test(rel)) return null;
  const table = readFileSync(join(root, 'core/crates/server/src/routes.rs'), 'utf8');
  const handlers = new Map(); // handler name → its paths
  for (const m of table.matchAll(/\("[A-Z|" ]+",\s*"(\/[^"]*)"\)\s*=>\s*(?:crate::(?:\w+::)*)?(\w+)\(/g)) {
    if (!handlers.has(m[2])) handlers.set(m[2], new Set());
    handlers.get(m[2]).add(m[1]);
  }
  const old = spawnSync('git', ['show', `${base}:${f}`], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 26 });
  if (old.status !== 0) return null; // a new file
  const fns = []; // [line, name] of each top-level fn
  old.stdout.split('\n').forEach((l, i) => {
    const m = l.match(/^(?:pub(?:\([\w:]+\))? )?fn (\w+)/);
    if (m) fns.push([i + 1, m[1]]);
  });
  const t = touched(f);
  if (!t.code) return new Set();
  const paths = new Set();
  for (const line of t.lines) {
    let name = null;
    for (const [at, n] of fns) if (at <= line) name = n;
    if (!name || !handlers.has(name)) return null;
    for (const p of handlers.get(name)) paths.add(p);
  }
  return paths;
}

for (const f of changed) {
  if (f.startsWith('docs/') || f.endsWith('.md')) continue;
  if (f.startsWith('tests/ui/') && f.endsWith('.spec.mjs')) { if (existsSync(join(root, f))) add(basename(f), 'the spec changed'); continue; }
  // The map and the two tools that make and read it test nothing themselves.
  if (['tests/ui/test-map.json', 'tools/test-map.mjs', 'tools/test-changed.mjs'].includes(f)) continue;
  const crate = f.match(/^core\/crates\/([^/]+)\//);
  if (crate) {
    crates.add(crate[1]);
    if (/^server(-|$)/.test(crate[1])) {
      // A change inside route handlers reruns the specs that call those routes;
      // anything else in the server (its core, a helper, the table) reruns them all.
      const paths = serverRoutes(f);
      if (!paths) every(`${f} is server code every route can reach`);
      else for (const [spec, rs] of Object.entries(map.routes)) {
        if (rs.some((r) => paths.has(r))) add(spec, `${f} — a route it calls changed`);
      }
    } else if (crate[1] === 'audiolab') every(`${f} starts the server`);
    continue;
  }
  // A part of a joined script: its lines are found where the part starts in it.
  const part = f.match(/^ui\/(app|room-paint|stage|vis-gl)\/([^/]+\.js)$/);
  const script = !part && f.match(/^ui\/(.+\.js)$/);
  if (map && (part || script)) {
    const t = touched(f);
    if (!t.code) continue;
    const key = part && `${part[1]}/${part[2]}`;
    if (part && !(key in (map.parts || {}))) { every(`${f} is a new part`); continue; }
    const at = part ? map.parts[key] - 1 : 0;
    const url = part ? `/${part[1]}.js` : `/${script[1]}`;
    const loose = reach(url, t.lines.map((l) => at + l), `${f} — a function it ran changed`);
    if (loose.length) every(`${f}:${loose[0] - at} runs as the page loads`);
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

// **On the other machines, never here** (RJ, 18 Nov 2026: "Code locally, test
// externally"): the browser specs on the MacBook, the Rust tests on the PC, both
// at once. Each script sends the working tree as it is. The Rust side tests only
// the crates above (`tools/pc/run-tests.cmd rust <crate>…`), not the PC's whole
// Rust set. The reference renders run only when the map picks their spec
// (`REFERENCE_RENDERS`, see that spec).
const run = (script, args, env = {}) => new Promise((done) => {
  const p = spawn('sh', [join(root, script), ...args], { cwd: root, stdio: 'inherit', env: { ...process.env, ...env } });
  p.on('close', (code) => done(code === 0));
});
const jobs = [];
if (crates.size) jobs.push(run('tools/pc/test-on-pc.sh', ['rust', ...[...crates].sort()]));
if (list.length) {
  jobs.push(run('tools/pc/test-on-mbp.sh', list.map((s) => `tests/ui/${s}`),
    list.includes('reference-renders.spec.mjs') ? { REFERENCE_RENDERS: '1' } : {}));
}
const ok = (await Promise.all(jobs)).every(Boolean);
process.exit(ok ? 0 : 1);

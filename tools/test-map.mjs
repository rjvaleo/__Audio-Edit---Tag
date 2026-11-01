// Make the test map: which lines of the interface each browser spec runs.
//
//   npm run test:map
//
// Runs the whole suite once with `TEST_MAP_OUT` set, so `tests/ui/test.mjs`
// records the functions each test ran after the page was ready, then turns the
// offsets into line ranges of the files they are written in and saves
// `tests/ui/test-map.json`. `tools/test-changed.mjs` reads it.
//
// The map is of the code as committed: it names the commit, and the runner
// diffs against that commit, so the line numbers mean the same thing to both.
// Make it from a clean tree.

import { readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { appParts } from './app-source.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const raw = join(root, 'test-results/test-map.jsonl');
const out = join(root, 'tests/ui/test-map.json');
const git = (...a) => spawnSync('git', a, { cwd: root, encoding: 'utf8' }).stdout.trim();

if (git('status', '--porcelain', '--', 'ui', 'tests/ui')) {
  console.error('ui/ or tests/ui/ has uncommitted changes — commit first, so the map matches a commit');
  process.exit(1);
}

if (!process.argv.includes('--from-raw')) {
  rmSync(raw, { force: true });
  // One worker, low priority, as every full run is.
  const r = spawnSync('nice', ['-n', '10', 'npx', 'playwright', 'test', '--reporter=line'], {
    cwd: root, stdio: 'inherit', env: { ...process.env, TEST_MAP_OUT: raw },
  });
  if (r.status !== 0) console.error('some tests failed; the map is still made from what ran');
}
if (!existsSync(raw)) { console.error(`nothing recorded at ${raw}`); process.exit(1); }

// The text each served script is made from, by the URL it is served at.
const parts = appParts();
const sources = { '/app.js': parts.map((p) => p.text).join('') };
const textOf = (url) => {
  if (!(url in sources)) {
    const f = join(root, 'ui', url);
    sources[url] = existsSync(f) ? readFileSync(f, 'utf8') : null;
  }
  return sources[url];
};
// Offset → line, by the starts of every line.
const starts = {};
const lineAt = (url, off) => {
  const s = starts[url] ??= [0, ...[...textOf(url).matchAll(/\n/g)].map((m) => m.index + 1)];
  let lo = 0, hi = s.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (s[mid] <= off) lo = mid; else hi = mid - 1; }
  return lo + 1;
};

const specs = {};
for (const line of readFileSync(raw, 'utf8').split('\n')) {
  if (!line) continue;
  const { spec, ran } = JSON.parse(line);
  const per = specs[spec] ??= {};
  for (const [url, fns] of Object.entries(ran)) {
    if (!textOf(url)) continue;
    const set = per[url] ??= new Set();
    for (const [a, b] of fns) set.add(`${lineAt(url, a)}-${lineAt(url, b)}`);
  }
}
const map = {
  commit: git('rev-parse', 'HEAD'),
  made: new Date().toISOString(),
  // Where each part starts in the joined `/app.js`, so a part's line can be
  // found in it.
  parts: Object.fromEntries(parts.map((p) => [p.name, p.line])),
  specs: Object.fromEntries(Object.entries(specs).sort().map(([spec, per]) => [spec,
    Object.fromEntries(Object.entries(per).map(([url, set]) => [url,
      [...set].map((r) => r.split('-').map(Number)).sort((x, y) => x[0] - y[0] || x[1] - y[1])]))])),
};
writeFileSync(out, JSON.stringify(map));
console.log(`map of ${Object.keys(map.specs).length} specs at ${map.commit.slice(0, 7)} → tests/ui/test-map.json`);

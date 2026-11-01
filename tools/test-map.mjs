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
// So the suite runs in a clean copy of the commit (a temporary git worktree,
// `../.mgl-test-map`, built into `core/target/map/`), never in this folder: what is on disk here
// may have uncommitted changes, or another session's edits arriving while the
// suite runs, and the map must not see either.

import { readFileSync, writeFileSync, rmSync, existsSync, symlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// Outside `test-results/`, which Playwright empties at the start of every run.
const raw = join(tmpdir(), 'mgl-test-map.jsonl');
const out = join(root, 'tests/ui/test-map.json');
const git = (...a) => spawnSync('git', a, { cwd: root, encoding: 'utf8' }).stdout.trim();

if (git('status', '--porcelain', '--', 'ui', 'tests/ui')) {
  console.error('note: ui/ or tests/ui/ has uncommitted changes; the map is of the last commit, without them');
}
// Every source below is read from the commit, never from the disk.
const commit = git('rev-parse', 'HEAD');
const atCommit = (path) => {
  const r = spawnSync('git', ['show', `${commit}:${path}`], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28 });
  return r.status === 0 ? r.stdout : null;
};

if (!process.argv.includes('--from-raw')) {
  rmSync(raw, { force: true });
  // Beside this folder, not in /tmp: the crates reach `prism-fx` by a relative
  // path (`../../../../GitHub/prism-fx`), which holds only at the same depth.
  const copy = join(dirname(root), '.mgl-test-map');
  rmSync(copy, { recursive: true, force: true });
  git('worktree', 'prune');
  git('worktree', 'add', '--detach', copy, commit);
  try {
    symlinkSync(join(root, 'node_modules'), join(copy, 'node_modules'));
    const env = { ...process.env, TEST_MAP_OUT: raw, CARGO_TARGET_DIR: join(root, 'core/target/map') };
    // Built here first, with no time limit: from nothing it takes minutes, and
    // the suite gives its server thirty seconds to answer.
    const b = spawnSync('nice', ['-n', '10', 'cargo', 'build', '--release', '--manifest-path', join(copy, 'core/Cargo.toml')],
      { cwd: copy, stdio: 'inherit', env });
    if (b.status !== 0) throw new Error('the clean copy did not build');
    // One worker, low priority, as every full run is.
    const r = spawnSync('nice', ['-n', '10', 'npx', 'playwright', 'test', '--reporter=line'], {
      cwd: copy, stdio: 'inherit', env,
    });
    if (r.status !== 0) console.error('some tests failed; the map is still made from what ran');
  } finally {
    git('worktree', 'remove', '--force', copy);
  }
}
if (!existsSync(raw)) { console.error(`nothing recorded at ${raw}`); process.exit(1); }

// The text each served script is made from, by the URL it is served at, as
// committed. `/app.js` is the parts joined in name order, as `build.rs` does.
const parts = [];
{
  let line = 1;
  for (const name of git('ls-tree', '--name-only', commit, 'ui/app/').split('\n').filter((f) => f.endsWith('.js')).sort()) {
    const text = atCommit(name);
    parts.push({ name: name.replace('ui/app/', ''), text, line });
    line += text.split('\n').length - 1;
  }
}
const sources = { '/app.js': parts.map((p) => p.text).join('') };
const textOf = (url) => {
  if (!(url in sources)) sources[url] = atCommit(`ui${url}`);
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
  commit,
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

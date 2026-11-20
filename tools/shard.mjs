// Which browser test files job K of N runs, dealt out by how long they take.
//
//   node tools/shard.mjs 8 3            the files for job 3 of 8, one per line
//   node tools/shard.mjs 8 1 --head 180 job 1 starts 180 s behind (it also runs the Rust tests)
//   node tools/shard.mjs 8 --show       every job's files and expected time
//
// Playwright's own `--shard` cuts the list into N runs of equal *count*, in
// file order. The files are far from equal: on 19 Nov 2026 CI's four jobs took
// 10.7, 31.1, 12.2 and 17.9 minutes, because job 2 drew the two slowest files,
// and a run lasts as long as its slowest job. So the files are dealt longest
// first, each to whichever job has the least so far. The times are in
// `tests/ui/durations.json`, measured on CI. A file not in it (a new one) counts
// as `NEW` seconds. Refresh the times when the jobs drift apart.

import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'tests/ui');
const NEW = 40;

const args = process.argv.slice(2);
const n = Number(args[0]);
const show = args.includes('--show');
const k = show ? 0 : Number(args[1]);
const hi = args.indexOf('--head');
const head = hi >= 0 ? Number(args[hi + 1]) : 0;
if (!(n >= 1) || (!show && !(k >= 1 && k <= n))) {
  console.error('usage: node tools/shard.mjs N K [--head SECONDS] | node tools/shard.mjs N --show');
  process.exit(2);
}

const seconds = JSON.parse(readFileSync(join(dir, 'durations.json'), 'utf8')).seconds;
const files = readdirSync(dir).filter((f) => f.endsWith('.spec.mjs')).sort();
// The reference renders are skipped unless asked for (`REFERENCE_RENDERS`), and
// a skipped file costs next to nothing.
const cost = (f) => (f === 'reference-renders.spec.mjs' && !process.env.REFERENCE_RENDERS ? 1 : seconds[f] ?? NEW);
// Longest first; ties by name, so every job works out the same deal.
const order = [...files].sort((a, b) => cost(b) - cost(a) || (a < b ? -1 : 1));
const jobs = Array.from({ length: n }, (_, i) => ({ load: i === 0 ? head : 0, files: [] }));
for (const f of order) {
  let best = 0;
  for (let i = 1; i < n; i++) if (jobs[i].load < jobs[best].load) best = i;
  jobs[best].load += cost(f);
  jobs[best].files.push(f);
}

if (show) {
  jobs.forEach((j, i) => console.log(`job ${i + 1}: ${(j.load / 60).toFixed(1)} min, ${j.files.length} files`));
} else {
  for (const f of jobs[k - 1].files.sort()) console.log(`tests/ui/${f}`);
}

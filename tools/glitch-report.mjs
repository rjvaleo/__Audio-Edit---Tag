// What the sweep found, and which parameter is to blame.
//
// A list of failing trials is not a finding. What turns it into one is asking,
// for each fault and each control, whether the trials that failed sat somewhere
// different on that control from the trials that passed — and by how much.
//
// The measure is a rank-biserial correlation, done by hand: sort every trial by
// the control's value, average the ranks of the failures, and compare with what
// that average would be if failure were unrelated to the control. It lands in
// -1..1, needs no assumption about the distribution, and is not fooled by the
// log sweeps half these controls have. -0.9 on `ratio` means the failures are
// almost all at the bottom of the ratio range; +0.9 means the top.
//
//     node tools/glitch-report.mjs [path/to/trials.jsonl]

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const path = process.argv[2]
  || resolve(new URL('../docs/glitch-sweep/trials.jsonl', import.meta.url).pathname);

const trials = readFileSync(path, 'utf8')
  .split('\n').filter(Boolean).map((l) => JSON.parse(l));

if (!trials.length) {
  console.error('no trials');
  process.exit(1);
}

// ─────────────────────────────────────────────────────────── flattening ──

/// Every numeric control a trial rolled, as one flat map.
///
/// The engine-specific groups are prefixed, so `wsola.searchMs` and
/// `pvsola.searchMs` stay distinct — they are different controls that happen to
/// share a name, and merging them would average away whichever one matters.
function controls(t) {
  const out = {};
  const take = (obj, prefix) => {
    for (const [k, v] of Object.entries(obj || {})) {
      if (typeof v === 'number' && Number.isFinite(v)) out[prefix + k] = v;
      else if (typeof v === 'boolean') out[prefix + k] = v ? 1 : 0;
    }
  };
  const p = t.params || {};
  take({ ratio: p.ratio, semitones: p.semitones, windowMs: p.windowMs }, '');
  take(p.vocoder, 'vocoder.');
  take(p.wsola, 'wsola.');
  take(p.pvsola, 'pvsola.');
  take(p.hybrid, 'hybrid.');
  take(t.grain, 'grain.');
  return out;
}

const FAULTS = ['click', 'clipping', 'dropout', 'silence', 'non-finite',
  'dc-offset', 'at-ceiling', 'wrong-length', 'too-slow',
  'render-timeout', 'render-failed'];

// ────────────────────────────────────────────────────────────── the sums ──

const byEngine = {};
for (const t of trials) {
  const e = (byEngine[t.engine] ||= { n: 0, faults: {}, clean: 0 });
  e.n++;
  const bad = t.bad || [];
  if (!bad.length) e.clean++;
  for (const b of bad) e.faults[b] = (e.faults[b] || 0) + 1;
}

console.log('═══ per engine ═══\n');
console.log('engine    trials  clean   ' + FAULTS.map((f) => f.slice(0, 9).padStart(10)).join(''));
for (const [name, e] of Object.entries(byEngine)) {
  const row = FAULTS.map((f) => String(e.faults[f] || 0).padStart(10)).join('');
  console.log(`${name.padEnd(9)} ${String(e.n).padStart(6)} ${String(e.clean).padStart(6)}   ${row}`);
}

const byKind = {};
for (const t of trials) {
  const k = (byKind[t.kind] ||= { n: 0, bad: 0 });
  k.n++;
  if ((t.bad || []).length) k.bad++;
}
console.log('\nby material:', Object.entries(byKind)
  .map(([k, v]) => `${k} ${v.bad}/${v.n} (${((v.bad / v.n) * 100).toFixed(0)}%)`).join('   '));

// ───────────────────────────────────────────────────── what predicts what ──

/// Rank-biserial: where the failures sit in the sorted order of a control.
function correlate(rows, isBad, key) {
  const vals = rows.filter((r) => key in r.c).map((r) => ({ v: r.c[key], bad: isBad(r.t) }));
  const nBad = vals.filter((x) => x.bad).length;
  const nGood = vals.length - nBad;
  if (nBad < 3 || nGood < 3) return null;
  // Ties share the average rank, or a control with only two settings would
  // report a correlation that is an artefact of the sort order.
  vals.sort((a, b) => a.v - b.v);
  const ranks = new Array(vals.length);
  for (let i = 0; i < vals.length;) {
    let j = i;
    while (j + 1 < vals.length && vals[j + 1].v === vals[i].v) j++;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[k] = r;
    i = j + 1;
  }
  let sumBad = 0;
  for (let i = 0; i < vals.length; i++) if (vals[i].bad) sumBad += ranks[i];
  const meanBad = sumBad / nBad;
  const meanAll = (vals.length + 1) / 2;
  // Normalised so it lands in -1..1 regardless of how lopsided the split is.
  return (meanBad - meanAll) / (vals.length / 2);
}

console.log('\n\n═══ what predicts each fault ═══');
console.log('(rank-biserial: +1 = fails at the top of the control, -1 = at the bottom)');

const findings = [];
for (const fault of FAULTS) {
  const hits = trials.filter((t) => (t.bad || []).includes(fault));
  if (hits.length < 4) continue;

  // Scoped per engine as well as overall: a control that only exists on one
  // engine looks weak across the whole sweep and decisive within its own.
  const scopes = [['all', trials]];
  for (const e of Object.keys(byEngine)) {
    scopes.push([e, trials.filter((t) => t.engine === e)]);
  }

  const lines = [];
  for (const [scope, rows0] of scopes) {
    const rows = rows0.map((t) => ({ t, c: controls(t) }));
    const n = rows.filter((r) => (r.t.bad || []).includes(fault)).length;
    if (n < 4) continue;
    const keys = new Set();
    for (const r of rows) for (const k of Object.keys(r.c)) keys.add(k);
    const scored = [];
    for (const k of keys) {
      const c = correlate(rows, (t) => (t.bad || []).includes(fault), k);
      if (c !== null && Math.abs(c) >= 0.35) scored.push([k, c]);
    }
    scored.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
    if (!scored.length) continue;
    lines.push({ scope, n, of: rows.length, top: scored.slice(0, 4) });
    for (const [k, c] of scored.slice(0, 3)) {
      findings.push({ fault, scope, control: k, r: c, n, of: rows.length });
    }
  }

  if (!lines.length) continue;
  console.log(`\n── ${fault} (${hits.length}/${trials.length} trials) ──`);
  for (const l of lines) {
    const top = l.top.map(([k, c]) => `${k} ${c >= 0 ? '+' : ''}${c.toFixed(2)}`).join('   ');
    console.log(`  ${l.scope.padEnd(9)} ${String(l.n).padStart(3)}/${String(l.of).padEnd(4)} ${top}`);
  }
}

// ────────────────────────────────────────────────────────── worst offenders ──

console.log('\n\n═══ the worst single trials ═══\n');
const worst = trials
  .filter((t) => (t.bad || []).length)
  .sort((a, b) => (b.bad.length - a.bad.length)
    || ((b.metrics?.stepRatio || 0) - (a.metrics?.stepRatio || 0)))
  .slice(0, 12);
for (const t of worst) {
  const m = t.metrics || {};
  console.log(`  seed ${t.seed} ${t.engine.padEnd(8)} ${t.kind.padEnd(9)} ${t.bad.join(',')}`);
  console.log(`     ratio ${(t.ratio ?? 0).toFixed(2)}  window ${(t.windowMs ?? 0).toFixed(0)}ms  `
    + `layers ${t.grain?.layers ?? '?'}  density ${(t.grain?.densityHz ?? 0).toFixed(0)}Hz  `
    + `peak ${(m.peak || 0).toFixed(2)}  step× ${(m.stepRatio || 0).toFixed(1)}  `
    + `renderRatio ${(t.renderRatio ?? 0).toFixed(2)}`);
}

// ───────────────────────────────────────────────────────────── the ranking ──

/// Rank the findings by how much fixing one would buy.
///
/// Weight is how many trials the fault touched, times how strongly a control
/// predicts it. A fault nothing predicts is still real but is not actionable
/// yet, so it is listed separately rather than scored.
console.log('\n\n═══ ranked by trials affected × strength of the signal ═══\n');
const merged = {};
for (const f of findings) {
  const key = `${f.fault}|${f.scope}|${f.control}`;
  if (!merged[key] || Math.abs(f.r) > Math.abs(merged[key].r)) merged[key] = f;
}
const ranked = Object.values(merged)
  .map((f) => ({ ...f, score: f.n * Math.abs(f.r) }))
  .sort((a, b) => b.score - a.score);

let i = 0;
const seen = new Set();
for (const f of ranked) {
  // One line per fault+control; the "all" scope and a single engine's scope
  // often say the same thing twice.
  const k = `${f.fault}|${f.control}`;
  if (seen.has(k)) continue;
  seen.add(k);
  i++;
  if (i > 15) break;
  const dir = f.r >= 0 ? 'high' : 'low';
  console.log(`${String(i).padStart(2)}. ${f.fault.padEnd(14)} ${f.scope.padEnd(9)} `
    + `${f.control.padEnd(26)} at ${dir.padEnd(4)} values  r=${f.r >= 0 ? '+' : ''}${f.r.toFixed(2)}  `
    + `${f.n}/${f.of} trials  score ${f.score.toFixed(1)}`);
}

const unexplained = FAULTS.filter((f) => {
  const n = trials.filter((t) => (t.bad || []).includes(f)).length;
  return n >= 4 && !findings.some((x) => x.fault === f);
});
if (unexplained.length) {
  console.log(`\nreal but nothing predicts them yet: ${unexplained.join(', ')}`);
}

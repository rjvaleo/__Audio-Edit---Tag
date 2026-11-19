#!/usr/bin/env node
// Compare two worst-block benchmark JSON files produced by
// `engine/tests/worst_block.rs` or `prism-fx/tests/cost.rs`.
//
// Usage: node tools/bench-compare.mjs old.json new.json
//
// Prints each row's worst_pct and p99_pct side by side. Exits 1 if any row's
// worst_pct or p99_pct in new.json exceeds old.json by more than 10% plus a
// 0.5 percentage-point floor (new > old * 1.10 + 0.5).

import fs from 'node:fs';

function usage() {
  console.error('usage: node tools/bench-compare.mjs <old.json> <new.json>');
  process.exit(2);
}

const [, , oldPath, newPath] = process.argv;
if (!oldPath || !newPath) usage();

const oldData = JSON.parse(fs.readFileSync(oldPath, 'utf8'));
const newData = JSON.parse(fs.readFileSync(newPath, 'utf8'));

const keyOf = (r) => `${r.case}\0${r.block}`;
const oldMap = new Map();
for (const r of oldData.rows ?? []) oldMap.set(keyOf(r), r);
const newMap = new Map();
for (const r of newData.rows ?? []) newMap.set(keyOf(r), r);

const keys = [...new Set([...oldMap.keys(), ...newMap.keys()])];

const fmt = (v) => (typeof v === 'number' ? `${v.toFixed(2)}%` : '   -  ');
const pad = (s, w, right = false) =>
  right ? String(s).padStart(w) : String(s).padEnd(w);

console.log(
  `old: ${oldPath} (${oldData.machine ?? '?'} / ${oldData.commit ?? '?'}${oldData.clock ? ` / ${oldData.clock}` : ''})`,
);
console.log(
  `new: ${newPath} (${newData.machine ?? '?'} / ${newData.commit ?? '?'}${newData.clock ? ` / ${newData.clock}` : ''})`,
);
console.log(
  `${pad('case', 34)} ${pad('blk', 4, true)}  ${pad('old p99', 9, true)} ${pad('new p99', 9, true)} ${pad('dp99', 8, true)}  ${pad('old wst', 9, true)} ${pad('new wst', 9, true)} ${pad('dwst', 8, true)}  status`,
);

let compared = 0;
let missingOld = 0;
let missingNew = 0;
let regressions = 0;
let worstReg = null;
let maxAbsDiff = null;

for (const k of keys) {
  const o = oldMap.get(k);
  const n = newMap.get(k);
  if (!o) {
    missingOld++;
    console.log(
      `${pad(n.case, 34)} ${pad(n.block, 4, true)}  ${pad('-', 9, true)} ${pad(fmt(n.p99_pct), 9, true)} ${pad('', 8, true)}  ${pad('-', 9, true)} ${pad(fmt(n.worst_pct), 9, true)} ${pad('', 8, true)}  NEW`,
    );
    continue;
  }
  if (!n) {
    missingNew++;
    console.log(
      `${pad(o.case, 34)} ${pad(o.block, 4, true)}  ${pad(fmt(o.p99_pct), 9, true)} ${pad('-', 9, true)} ${pad('', 8, true)}  ${pad(fmt(o.worst_pct), 9, true)} ${pad('-', 9, true)} ${pad('', 8, true)}  MISSING`,
    );
    continue;
  }

  compared++;
  const dp99 = n.p99_pct - o.p99_pct;
  const dwst = n.worst_pct - o.worst_pct;
  const p99Limit = o.p99_pct * 1.1 + 0.5;
  const wstLimit = o.worst_pct * 1.1 + 0.5;
  const badP99 = n.p99_pct > p99Limit;
  const badWst = n.worst_pct > wstLimit;
  const bad = badP99 || badWst;
  if (bad) {
    regressions++;
    const excess = Math.max(
      badP99 ? n.p99_pct - p99Limit : -Infinity,
      badWst ? n.worst_pct - wstLimit : -Infinity,
    );
    if (!worstReg || excess > worstReg.excess) {
      worstReg = { case: n.case, block: n.block, o, n, dp99, dwst, excess };
    }
  }

  for (const [metric, ov, nv] of [
    ['p99', o.p99_pct, n.p99_pct],
    ['worst', o.worst_pct, n.worst_pct],
  ]) {
    const abs = Math.abs(nv - ov);
    if (!maxAbsDiff || abs > maxAbsDiff.abs) {
      maxAbsDiff = { case: n.case, block: n.block, metric, ov, nv, abs };
    }
  }

  const dp99Str = `${dp99 >= 0 ? '+' : ''}${dp99.toFixed(2)}`;
  const dwstStr = `${dwst >= 0 ? '+' : ''}${dwst.toFixed(2)}`;
  const flag = bad
    ? `FAIL(${[badP99 ? 'p99' : '', badWst ? 'worst' : ''].filter(Boolean).join(',')})`
    : 'ok';

  console.log(
    `${pad(n.case, 34)} ${pad(n.block, 4, true)}  ${pad(fmt(o.p99_pct), 9, true)} ${pad(fmt(n.p99_pct), 9, true)} ${pad(dp99Str, 8, true)}  ${pad(fmt(o.worst_pct), 9, true)} ${pad(fmt(n.worst_pct), 9, true)} ${pad(dwstStr, 8, true)}  ${flag}`,
  );
}

console.log('');
console.log(
  `summary: ${compared} rows compared, ${regressions} over limit (> 10% + 0.5 pp)${missingOld ? `, ${missingOld} new-only` : ''}${missingNew ? `, ${missingNew} old-only` : ''}`,
);
if (maxAbsDiff) {
  console.log(
    `largest diff: ${maxAbsDiff.case} @ ${maxAbsDiff.block} (${maxAbsDiff.metric}): ${maxAbsDiff.ov.toFixed(2)}% -> ${maxAbsDiff.nv.toFixed(2)}% (${maxAbsDiff.nv >= maxAbsDiff.ov ? '+' : '-'}${maxAbsDiff.abs.toFixed(2)} pp)`,
  );
}
if (worstReg) {
  console.log(
    `largest over-limit: ${worstReg.case} @ ${worstReg.block}: p99 ${worstReg.o.p99_pct.toFixed(2)}% -> ${worstReg.n.p99_pct.toFixed(2)}%, worst ${worstReg.o.worst_pct.toFixed(2)}% -> ${worstReg.n.worst_pct.toFixed(2)}%`,
  );
}

process.exit(regressions > 0 ? 1 : 0);

// Where in the output is the click, and does it come back?
//
// The sweep says *that* a render clicks and which controls correlate with it.
// That is not a mechanism, and treating it as one cost a day: the envelope's
// edge slope was a real defect with a clean gradient behind it, fixing it moved
// the click count by two, and the worst case did not move at all.
//
// So this asks the question that names a cause instead. For a given trial it
// re-renders and reports *where* the big steps are:
//
//   - **One step, at the very start or end** → a boundary, not a process.
//   - **Steps at a regular spacing** → whatever has that period. The grain hop,
//     the layer offset and the WSOLA splice all have known periods and are
//     printed alongside, so the match is read off rather than guessed.
//   - **Steps scattered with no period** → the material, or a jitter that is
//     doing what it was asked to.
//
//     node tools/glitch-locate.mjs <seed> [<seed> ...]
//     node tools/glitch-locate.mjs --worst 8
//
// Seeds come from docs/glitch-sweep/trials.jsonl, which carries the engine, the
// source and every control value, so a run here is the same render the sweep
// measured rather than an approximation of it.

import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, copyFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';

const PORT = Number(process.env.LOCATE_PORT || 8796);
const ROOT = resolve(new URL('..', import.meta.url).pathname);
const LIBRARY = join(ROOT, 'Audio Library');
const BIN = join(ROOT, 'core/target/release/audiolab');
const TRIALS = join(ROOT, 'docs/glitch-sweep/trials.jsonl');

const rows = readFileSync(TRIALS, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const bySeed = new Map(rows.map((r) => [r.seed, r]));

let wanted = [];
const argv = process.argv.slice(2);
if (argv[0] === '--worst') {
  const n = Number(argv[1] || 8);
  wanted = rows
    .filter((r) => (r.bad || []).includes('click') && r.metrics)
    .sort((a, b) => b.metrics.stepRatio - a.metrics.stepRatio)
    .slice(0, n)
    .map((r) => r.seed);
} else {
  wanted = argv.map(Number).filter((n) => Number.isFinite(n));
}
if (!wanted.length) {
  console.error('usage: glitch-locate.mjs <seed>... | --worst <n>');
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────── the server ──

const data = mkdtempSync(join(tmpdir(), 'audiolab-locate-'));
const library = join(data, 'library');
mkdirSync(join(library, 'kit'), { recursive: true });
for (const [from, to] of [
  ['Even More Da Heat/b 1.wav', 'kit/b 1.wav'],
  ['Even More Da Heat/snare 3.wav', 'kit/snare 3.wav'],
]) copyFileSync(join(LIBRARY, from), join(library, to));
writeFileSync(join(data, 'config.json'), JSON.stringify({ library }));

const server = spawn(BIN, [], {
  env: { ...process.env, AUDIOLAB_DATA: data, AUDIOLAB_PORT: String(PORT) },
  stdio: ['ignore', 'ignore', 'pipe'],
});
const cleanup = () => {
  try { server.kill('SIGTERM'); } catch { /* gone */ }
  try { rmSync(data, { recursive: true, force: true }); } catch { /* gone */ }
};
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(130); });

for (let i = 0; i < 120; i++) {
  try { if ((await fetch(`http://127.0.0.1:${PORT}/api/state`)).ok) break; } catch { /* wait */ }
  await new Promise((r) => setTimeout(r, 250));
}
await fetch(`http://127.0.0.1:${PORT}/api/scan`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
});
for (let i = 0; i < 400; i++) {
  const st = await (await fetch(`http://127.0.0.1:${PORT}/api/state`)).json().catch(() => ({}));
  if ((st.files || 0) > 0 && !st.scan?.running) break;
  await new Promise((r) => setTimeout(r, 250));
}

// ─────────────────────────────────────────────────────────────────── decode ──

function decodeWav(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let p = 12; let fmt = null; let data = null;
  while (p + 8 <= dv.byteLength) {
    const id = dv.getUint32(p, false);
    const size = dv.getUint32(p + 4, true);
    const body = p + 8;
    if (id === 0x666d7420) {
      fmt = { channels: dv.getUint16(body + 2, true), rate: dv.getUint32(body + 4, true) };
    } else if (id === 0x64617461) {
      data = { at: body, size: Math.min(size, dv.byteLength - body) };
    }
    p = body + size + (size & 1);
  }
  const n = Math.floor(data.size / 2);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = dv.getInt16(data.at + i * 2, true) / 32768;
  return { x, ...fmt, frames: Math.floor(n / fmt.channels) };
}

/// The big steps, where they are, and whether they repeat.
function locate(sig) {
  const { x, channels, rate } = sig;
  const steps = [];
  for (let i = channels; i < x.length; i++) steps.push(Math.abs(x[i] - x[i - channels]));
  const sorted = [...steps].sort((a, b) => a - b);
  const p999 = sorted[Math.floor(sorted.length * 0.999)] || 1e-9;

  // Anything well clear of the signal's own behaviour.
  const bar = Math.max(p999 * 6, 1e-4);
  const hits = [];
  for (let i = 0; i < steps.length; i++) {
    if (steps[i] > bar) hits.push({ frame: Math.floor(i / channels), size: steps[i] });
  }
  // Adjacent samples of one discontinuity are one event, not several.
  const events = [];
  for (const h of hits) {
    const last = events[events.length - 1];
    if (last && h.frame - last.frame < 8) {
      if (h.size > last.size) { last.size = h.size; last.frame = h.frame; }
    } else events.push({ ...h });
  }
  const gaps = [];
  for (let i = 1; i < events.length; i++) gaps.push(events[i].frame - events[i - 1].frame);
  return { p999, bar, events, gaps, frames: sig.frames, rate };
}

/// Is a set of gaps clustered around one value? That is what periodic means, and
/// a period is what points at a mechanism.
function period(gaps) {
  if (gaps.length < 3) return null;
  const s = [...gaps].sort((a, b) => a - b);
  const med = s[Math.floor(s.length / 2)];
  if (med <= 0) return null;
  const near = gaps.filter((g) => Math.abs(g - med) <= Math.max(2, med * 0.15)).length;
  return { median: med, agree: near / gaps.length };
}

// ──────────────────────────────────────────────────────────────────── drive ──

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
await page.goto(`http://127.0.0.1:${PORT}/`);
await page.waitForFunction(
  () => typeof state !== 'undefined' && (state.folders || []).length > 0, { timeout: 30000 },
);

let loaded = null;
for (const seed of wanted) {
  const t = bySeed.get(seed);
  if (!t) { console.log(`seed ${seed}: not in trials.jsonl`); continue; }

  if (loaded !== t.source) {
    await page.evaluate(async (p) => {
      const want = p.split('/').pop();
      for (const folder of state.folders) {
        const files = await api(`/api/files?folder=${encodeURIComponent(folder.name)}`);
        const f = files.find((x) => x.path.endsWith(want));
        if (f) { await selectFile(f); return; }
      }
      throw new Error(`no such file: ${want}`);
    }, t.source);
    await page.waitForFunction(
      () => Object.keys(state.grainRows || {}).length > 0, { timeout: 20000 },
    );
    loaded = t.source;
  }
  await page.evaluate((alg) => {
    document.querySelector(`#stretchEngine .seg-btn[data-alg="${alg}"]`).click();
  }, t.engine);
  await page.waitForTimeout(200);
  await page.evaluate((s) => randomizeStretch({ seed: s }), seed);
  await page.waitForTimeout(150);

  const resolved = await page.evaluate(() => state.selectedFile.path);
  const url = `http://127.0.0.1:${PORT}/audio?p=${encodeURIComponent(resolved)}&edited=1`;
  const res = await fetch(url);
  const sig = decodeWav(Buffer.from(await res.arrayBuffer()));
  const L = locate(sig);

  const g = t.grain || {};
  const sr = sig.rate;
  // The periods a mechanism would have, in output frames.
  const hopIn = g.densityHz > 0 ? sr / g.densityHz : (t.windowMs / 1000) * sr / (g.overlap || 1);
  const hopOut = hopIn * (t.ratio || 1);
  const winOut = ((t.windowMs || 0) / 1000) * sr * (t.ratio || 1);

  console.log(`\n═══ seed ${seed} — ${t.engine} / ${t.kind} — ${t.bad.join(',')} ═══`);
  console.log(`    ratio ${(t.ratio || 0).toFixed(2)}  window ${(t.windowMs || 0).toFixed(0)}ms  `
    + `density ${(g.densityHz || 0).toFixed(0)}Hz  layers ${g.layers}  overlap ${(g.overlap || 0).toFixed(1)}  `
    + `envelope ${(g.envelope ?? 0).toFixed(2)}`);
  console.log(`    output ${(L.frames / sr).toFixed(2)}s   step p99.9 ${L.p999.toFixed(5)}   `
    + `bar ${L.bar.toFixed(5)}   events ${L.events.length}`);

  if (!L.events.length) { console.log('    no step stands out — the click is not a discontinuity'); continue; }

  const first = L.events[0];
  const last = L.events[L.events.length - 1];
  const atStart = first.frame < sr * 0.02;
  const atEnd = last.frame > L.frames - sr * 0.02;
  console.log(`    first at ${(first.frame / sr).toFixed(4)}s (${(100 * first.frame / L.frames).toFixed(1)}%) size ${first.size.toFixed(4)}`);
  console.log(`    last  at ${(last.frame / sr).toFixed(4)}s (${(100 * last.frame / L.frames).toFixed(1)}%) size ${last.size.toFixed(4)}`);

  const p = period(L.gaps);
  if (L.events.length === 1) {
    console.log(`    ONE event — ${atStart ? 'at the START' : atEnd ? 'at the END' : 'mid-file'}: a boundary, not a process`);
  } else if (p && p.agree > 0.6) {
    console.log(`    PERIODIC every ${p.median} frames (${(p.median / sr * 1000).toFixed(1)}ms), ${(p.agree * 100).toFixed(0)}% agree`);
    const cand = [
      ['grain hop out', hopOut], ['grain window out', winOut],
      ['hop in', hopIn], ['layer offset', hopOut / Math.max(1, g.layers || 1)],
    ];
    for (const [name, v] of cand) {
      if (v > 0 && Math.abs(p.median - v) / v < 0.2) {
        console.log(`      ↳ matches ${name} = ${v.toFixed(0)} frames`);
      }
    }
  } else {
    console.log(`    ${L.events.length} events, no clear period `
      + `(gaps median ${p ? p.median : '—'}, agreement ${p ? (p.agree * 100).toFixed(0) + '%' : '—'})`);
  }
  if (atStart && L.events.length > 1) console.log('    (and one of them is at the very start)');
  if (atEnd && L.events.length > 1) console.log('    (and one of them is at the very end)');
}

await browser.close();
process.exit(0);

// Throw the controls at random and listen for the wheels coming off.
//
// A grain cloud has more interacting parameters than anyone can hold at once,
// and the combinations that break it are exactly the ones nobody would think to
// try by hand. So: roll every control, render, measure, and keep the numbers.
//
// WHAT THIS MEASURES, AND WHY IT IS THE OFFLINE RENDER
//
// Invariant 11 — what you hear is what you export — is not a slogan here: the
// offline renderers are loops over the same streaming engines the audio callback
// drives, one implementation rather than two kept in step, asserted to 1e-6. So
// a discontinuity in the rendered file is a discontinuity you would have heard.
// Rendering is also deterministic, needs no sound card, and can be replayed from
// a seed — none of which is true of listening.
//
// What it therefore does NOT catch, and what the live probe is for: a block that
// takes longer to make than to play. That fault is invisible in a rendered file
// and is the one that empties the speakers. `renderRatio` below is the proxy —
// render time against output duration — and anything near or above 1.0 is an
// engine that cannot keep up.
//
// ISOLATION
//
// Its own port and its own data directory, pointed at the repo's real Audio
// Library. Real material matters — a synthetic sine cannot smear, and the
// hybrid's whole job is material that has tone, hits and air in it. The source
// files are never written (invariant 1) and every edit lands in the throwaway
// data directory, so a sweep cannot disturb a working session.

import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, appendFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';

const PORT = Number(process.env.SWEEP_PORT || 8795);
const ROOT = resolve(new URL('..', import.meta.url).pathname);
const LIBRARY = join(ROOT, 'Audio Library');
const BIN = join(ROOT, 'core/target/release/audiolab');

const TRIALS = Number(process.env.SWEEP_TRIALS || 30);
const ENGINES = (process.env.SWEEP_ENGINES || 'wsola,vocoder,pvsola,hybrid,granular').split(',');

// Two sources, chosen for what they stress rather than for being handy.
// `b 1` is a tonal chop — the vocoder and PVSOLA live or die on this. `snare 3`
// is a bare transient, which is what WSOLA is for and what smears first.
// Declared beside the library that holds them, above.

// A render is bounded so one absurd combination cannot stall the sweep. Hitting
// this is itself a finding, and is recorded rather than swallowed.
const RENDER_TIMEOUT_MS = Number(process.env.SWEEP_RENDER_TIMEOUT || 20000);

const OUT = join(ROOT, 'docs/glitch-sweep');
mkdirSync(OUT, { recursive: true });
const JSONL = join(OUT, 'trials.jsonl');
writeFileSync(JSONL, '');

// ─────────────────────────────────────────────────────────────── the server ──

const data = mkdtempSync(join(tmpdir(), 'audiolab-sweep-'));

// A library of exactly the sources the sweep uses. Scanning the real one costs
// minutes and indexes thousands of files the sweep never opens; copying two of
// them in is instant and makes the run repeatable. They are still real audio —
// a synthetic sine cannot smear, and the hybrid's whole job is material with
// tone, hits and air in it.
const library = join(data, 'library');
mkdirSync(join(library, 'kit'), { recursive: true });
const SOURCES = [
  { from: join(LIBRARY, 'Even More Da Heat/b 1.wav'), path: 'kit/b 1.wav', kind: 'tonal' },
  { from: join(LIBRARY, 'Even More Da Heat/snare 3.wav'), path: 'kit/snare 3.wav', kind: 'transient' },
];
for (const s of SOURCES) copyFileSync(s.from, join(library, s.path));
writeFileSync(join(data, 'config.json'), JSON.stringify({ library }));

const server = spawn(BIN, [], {
  env: { ...process.env, AUDIOLAB_DATA: data, AUDIOLAB_PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (b) => { serverLog += b; });
server.stderr.on('data', (b) => { serverLog += b; });

function cleanup() {
  try { server.kill('SIGTERM'); } catch { /* already gone */ }
  try { rmSync(data, { recursive: true, force: true }); } catch { /* nothing to remove */ }
}
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(130); });

async function waitForServer() {
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/api/state`);
      if (r.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`server did not start on ${PORT}\n${serverLog}`);
}

// ─────────────────────────────────────────────────────────────── the metrics ──

/// 16-bit PCM WAV to Float32, per channel interleaved into one plane.
///
/// The route serves 16-bit, so anything the engine produced above full scale
/// arrives already saturated. That is not a loss: consecutive samples pinned at
/// full scale is exactly what clipping sounds like, and it is what `clipRun`
/// counts.
function decodeWav(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (dv.getUint32(0, false) !== 0x52494646) throw new Error('not RIFF');
  let p = 12;
  let fmt = null;
  let data = null;
  while (p + 8 <= dv.byteLength) {
    const id = dv.getUint32(p, false);
    const size = dv.getUint32(p + 4, true);
    const body = p + 8;
    if (id === 0x666d7420) {
      fmt = {
        channels: dv.getUint16(body + 2, true),
        rate: dv.getUint32(body + 4, true),
        bits: dv.getUint16(body + 14, true),
      };
    } else if (id === 0x64617461) {
      data = { at: body, size: Math.min(size, dv.byteLength - body) };
    }
    p = body + size + (size & 1);
  }
  if (!fmt || !data) throw new Error('no fmt/data chunk');
  if (fmt.bits !== 16) throw new Error(`unexpected bit depth ${fmt.bits}`);
  const n = Math.floor(data.size / 2);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = dv.getInt16(data.at + i * 2, true) / 32768;
  return { x, ...fmt, frames: Math.floor(n / fmt.channels) };
}

/// What a glitch looks like in numbers.
///
/// The hard part is that a big sample-to-sample step is not by itself a fault:
/// bright material genuinely moves fast. What marks a click is a step far larger
/// than the *rest of this signal's* steps — so the measure is the worst step
/// against the 99.9th percentile of all of them. A clean render sits near 1;
/// a click stands out by a multiple.
function measure(sig) {
  const { x, channels, rate } = sig;
  const n = x.length;
  const m = {
    frames: sig.frames, rate, channels,
    nonFinite: 0, peak: 0, rms: 0, dc: 0,
    clipRun: 0, maxStep: 0, stepP999: 0, stepRatio: 0,
    silentRun: 0, silentFrac: 0, zeroOutput: false,
  };
  if (!n) { m.zeroOutput = true; return m; }

  const steps = new Float32Array(Math.max(0, n - channels));
  let sum = 0;
  let sumSq = 0;
  let run = 0;
  let quiet = 0;
  let quietRun = 0;
  let clip = 0;

  for (let i = 0; i < n; i++) {
    const v = x[i];
    if (!Number.isFinite(v)) { m.nonFinite++; continue; }
    const a = Math.abs(v);
    if (a > m.peak) m.peak = a;
    sum += v;
    sumSq += v * v;

    // Full scale in 16-bit. One sample there is a peak; a run of them is clipping.
    if (a >= 32767 / 32768) { run++; if (run > m.clipRun) m.clipRun = run; } else run = 0;
    if (a < 1e-4) { quiet++; quietRun++; if (quietRun > m.silentRun) m.silentRun = quietRun; }
    else quietRun = 0;

    // Step within a channel, so a stereo interleave is not read as a jump.
    if (i >= channels) steps[i - channels] = Math.abs(v - x[i - channels]);
  }
  if (m.clipRun > 0) clip = m.clipRun;

  m.rms = Math.sqrt(sumSq / n);
  m.dc = sum / n;
  m.silentFrac = quiet / n;
  m.zeroOutput = m.peak < 1e-4;

  if (steps.length) {
    const sorted = Float32Array.from(steps).sort();
    m.maxStep = sorted[sorted.length - 1];
    m.stepP999 = sorted[Math.floor(sorted.length * 0.999)] || 0;
    // Guarded: a signal whose steps are all tiny would divide by nearly nothing
    // and report a spectacular ratio for an inaudible wobble.
    m.stepRatio = m.stepP999 > 1e-5 ? m.maxStep / m.stepP999 : 0;
  }
  m.silentRunMs = (m.silentRun / channels / rate) * 1000;
  void clip;
  return m;
}

/// The verdicts. Thresholds are stated once here so a change of mind is one edit
/// and so the report can say which bar a trial failed.
/// `predicted` is the engine's OWN `outFrames`, not arithmetic of mine.
///
/// That makes the length check invariant 5 — `output_frames()` must equal what
/// `process()` actually produces — rather than a test of whether I multiplied
/// a rounded duration by a ratio correctly. The first version did the latter and
/// called a 17× stretch of a 0.22 s file "wrong-length" purely because 0.22 was
/// rounded.
function verdicts(m, predicted) {
  const bad = [];
  if (m.nonFinite > 0) bad.push('non-finite');
  if (m.zeroOutput) bad.push('silence');
  if (m.clipRun >= 8) bad.push('clipping');
  if (m.stepRatio >= 8) bad.push('click');
  if (m.silentRunMs >= 50 && !m.zeroOutput) bad.push('dropout');
  if (Math.abs(m.dc) > 0.05) bad.push('dc-offset');
  if (m.peak > 0.999 && m.clipRun < 8) bad.push('at-ceiling');
  if (predicted > 0) {
    const err = Math.abs(m.frames - predicted) / predicted;
    if (err > 0.01) bad.push('wrong-length');
  }
  return bad;
}

// ──────────────────────────────────────────────────────────────── the sweep ──

await waitForServer();

// Pointing at a library is not the same as having one. The index is built by a
// scan, and without it every route that lists sounds answers with nothing —
// which looks exactly like a broken app rather than an unscanned one. Cost half
// an hour the first time.
await fetch(`http://127.0.0.1:${PORT}/api/scan`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
});
{
  let scanned = false;
  for (let i = 0; i < 600; i++) {
    const st = await (await fetch(`http://127.0.0.1:${PORT}/api/state`)).json().catch(() => ({}));
    if ((st.files || 0) > 0 && !st.scan?.running) { scanned = true; break; }
    await new Promise((r) => setTimeout(r, 250));
  }
  if (!scanned) throw new Error('the library never finished scanning');
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const consoleErrors = [];
page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
page.on('pageerror', (e) => consoleErrors.push(`uncaught: ${e.message}`));

await page.goto(`http://127.0.0.1:${PORT}/`);
await page.waitForFunction(
  () => typeof state !== 'undefined' && (state.folders || []).length > 0,
  { timeout: 30000 },
);

let n = 0;
const total = ENGINES.length * SOURCES.length * TRIALS;

for (const src of SOURCES) {
  // Found by basename across every folder rather than by an assumed path: how
  // the scan names a folder is its business, and guessing cost a run.
  const chosen = await page.evaluate(async (p) => {
    const want = p.split('/').pop();
    for (const folder of state.folders) {
      const files = await api(`/api/files?folder=${encodeURIComponent(folder.name)}`);
      const f = files.find((x) => x.path.endsWith(want));
      if (f) { await selectFile(f); return f.path; }
    }
    throw new Error(`no such file: ${want} in ${state.folders.map((f) => f.name).join(', ')}`);
  }, src.path);
  src.resolved = chosen;
  await page.waitForFunction(() => Object.keys(state.grainRows || {}).length > 0, { timeout: 20000 });

  for (const engine of ENGINES) {
    await page.evaluate((alg) => {
      document.querySelector(`#stretchEngine .seg-btn[data-alg="${alg}"]`).click();
    }, engine);
    await page.waitForTimeout(200);

    for (let t = 0; t < TRIALS; t++) {
      n++;
      const seed = 0x51EED000 + n;
      consoleErrors.length = 0;

      const rolled = await page.evaluate((s) => {
        const r = randomizeStretch({ seed: s });
        return r;
      }, seed);
      // The commit is posted per box; give the server a moment to have taken it.
      await page.waitForTimeout(120);

      // The engine's own prediction of how long this will be, read back after
      // the commit. Comparing the render against this is invariant 5.
      const predicted = await page.evaluate(() => state.edit?.outFrames || 0);

      const url = `http://127.0.0.1:${PORT}/audio?p=${encodeURIComponent(src.resolved)}&edited=1`;
      const t0 = Date.now();
      let rec = {
        n, seed, engine, source: src.path, kind: src.kind,
        ratio: rolled.stretch?.ratio, semitones: rolled.stretch?.semitones,
        windowMs: rolled.stretch?.windowMs,
        grain: rolled.grain, params: rolled.stretch,
      };

      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), RENDER_TIMEOUT_MS);
        const res = await fetch(url, { signal: ctrl.signal });
        clearTimeout(timer);
        const buf = Buffer.from(await res.arrayBuffer());
        const ms = Date.now() - t0;
        if (!res.ok) {
          rec.error = `HTTP ${res.status}`;
          rec.bad = ['render-failed'];
        } else {
          const sig = decodeWav(buf);
          const m = measure(sig);
          rec.metrics = m;
          rec.renderMs = ms;
          rec.predictedFrames = predicted;
          rec.outSeconds = m.frames / m.rate;
          // The one thing a rendered file cannot show: whether the engine could
          // have made this in time. Below 1.0 it can, near 1.0 it is on the edge.
          rec.renderRatio = rec.outSeconds > 0 ? (ms / 1000) / rec.outSeconds : null;
          rec.bad = verdicts(m, predicted);
          // Only meaningful once there is enough output for the per-request
          // fixed cost to stop dominating. A 20 ms render of a 20 ms result is
          // not a slow engine, it is an HTTP round trip.
          if (rec.outSeconds >= 0.5 && rec.renderRatio >= 1.0) rec.bad.push('too-slow');
        }
      } catch (e) {
        rec.error = String(e.message || e);
        rec.bad = [e.name === 'AbortError' ? 'render-timeout' : 'render-failed'];
        rec.renderMs = Date.now() - t0;
      }

      if (consoleErrors.length) rec.consoleErrors = [...consoleErrors];
      appendFileSync(JSONL, `${JSON.stringify(rec)}\n`);

      const tag = rec.bad?.length ? rec.bad.join(',') : 'ok';
      process.stdout.write(
        `\r[${n}/${total}] ${engine.padEnd(8)} ${src.kind.padEnd(9)} ${tag.padEnd(38)}`,
      );
    }
  }
}

process.stdout.write('\n');
await browser.close();
console.log(`wrote ${JSONL}`);
// The server is a child and keeps the loop alive; `cleanup` runs on exit.
process.exit(0);

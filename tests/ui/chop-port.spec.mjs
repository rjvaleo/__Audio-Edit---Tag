// What Chop's own arithmetic gives on a fixed sound, for its Rust port
// (`native/engine-mgl/src/chop.rs`) to match to the bit.
//
// Chop's sound is plain JavaScript, no Web Audio: doubles, stored to floats.
// This spec runs it in the page on the reference break (`reference-renders/`
// manifest's `break`) and writes every answer into one folder:
//
// - `chop-port.json`: the cases, each with its settings and what came back;
//   an array of floats is `{ "f32": "<file>" }`, of doubles `{ "f64": "<file>" }`;
// - `<file>.f32` / `<file>.f64`: those arrays, little-endian.
//
// The functions on their own (`chopResample`, `chopBiquad`, `chopRunBiquad`,
// `chopBuildPingPongTail`, …) and what the page makes of them (`sliceAudio`,
// `renderPreview`, `renderRatchet`, `findTempo`, the cuts, `chopAnalyseCore`).
// Each case starts from the starting settings. The whole run is done twice, in
// two pages, and must come out the same.
//
// Only when asked: `CHOP_PORT_OUT=<folder>`, or `REFERENCE_RENDERS` naming chop.
// The folder is `CHOP_PORT_OUT`, or `mgl-chop-port` in the system's temporary
// folder. `native/engine-mgl/tests/reference/chop/` is a copy.

import { test, expect } from './test.mjs';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const M = JSON.parse(readFileSync(join(HERE, 'reference-renders', 'manifest.json'), 'utf8'));
const ASKED = (process.env.REFERENCE_RENDERS || '').trim();
const WANTED = !!process.env.CHOP_PORT_OUT || /^(1|all|yes|true)$/i.test(ASKED) || ASKED.split(',').map((x) => x.trim()).includes('chop');
const OUT = process.env.CHOP_PORT_OUT || join(tmpdir(), 'mgl-chop-port');
test.skip(!WANTED, 'Chop port references run only when asked: CHOP_PORT_OUT=<folder>, or REFERENCE_RENDERS=chop');

/// The manifest's signal, as `reference-renders.spec.mjs` makes it.
function makeSignal(def) {
  const { rate, frames, channels } = def;
  const acc = Array.from({ length: channels }, () => new Float64Array(frames));
  for (const p of def.parts) {
    const at = Math.round(p.at * rate);
    if (p.type === 'click') {
      if (at < frames) for (let c = 0; c < channels; c++) acc[c][at] += p.amp[c];
      continue;
    }
    const n = Math.round(p.len * rate);
    let s = (p.seed || 0) >>> 0;
    for (let i = 0; i < n && at + i < frames; i++) {
      let v;
      if (p.type === 'tone') v = Math.sin((2 * Math.PI * p.hz * i) / rate);
      else if (p.type === 'noise') { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; v = s / 2147483648 - 1; }
      else throw new Error(`no such signal part: ${p.type}`);
      const env = p.tau ? Math.exp(-i / (p.tau * rate)) : 1;
      for (let c = 0; c < channels; c++) acc[c][at + i] += p.amp[c] * env * v;
    }
  }
  return acc.map((a) => Float32Array.from(a));
}

const GRID4 = { mode: 'grid', div: '4', feel: 'straight', bars: 1 };

/// Every case: `set` over the starting settings, `flags` on slices, then `what`.
const CASES = [
  { id: 'mono', what: 'mono' },
  { id: 'rms', what: 'rms' },
  { id: 'segs-40', what: 'segs', topDb: 40, minDur: 40, pad: 12 },
  { id: 'segs-25', what: 'segs', topDb: 25, minDur: 40, pad: 12 },
  { id: 'segs-60', what: 'segs', topDb: 60, minDur: 100, pad: 30 },
  { id: 'segs-10', what: 'segs', topDb: 10, minDur: 5, pad: 0 },
  { id: 'tails-80', what: 'tails', topDb: 40, minDur: 40, pad: 12, tailMs: 80 },
  { id: 'tails-many', what: 'tailsAt', spans: [[0, 24000], [24000, 48000], [10, 600], [0, 1680], [0, 1679], [5000, 96000], [0, 96000], [100, 4300]], tails: [5, 10, 33.3, 80, 250, 1000] },
  { id: 'onsets-30', what: 'onsets', set: { mode: 'transient', sens: 30, minDur: 40 } },
  { id: 'onsets-60', what: 'onsets', set: { mode: 'transient', sens: 60, minDur: 40 } },
  { id: 'onsets-90', what: 'onsets', set: { mode: 'transient', sens: 90, minDur: 20 } },
  { id: 'onsets-100', what: 'onsets', set: { mode: 'transient', sens: 100, minDur: 5 } },
  { id: 'cuts-transient', what: 'cuts', set: { mode: 'transient', sens: 60, minDur: 40 } },
  { id: 'cuts-silence', what: 'cuts', set: { mode: 'silence', topDb: 40, minDur: 40, pad: 12 } },
  { id: 'cuts-grid-8', what: 'cuts', set: { mode: 'grid', div: '8', feel: 'straight', bars: 1 } },
  { id: 'cuts-grid-8-swing', what: 'cuts', set: { mode: 'grid', div: '8', feel: 'straight', bars: 1, shuffle: 62, nudge: 10 } },
  { id: 'cuts-grid-16-trip', what: 'cuts', set: { mode: 'grid', div: '16', feel: 'trip', bars: 1 } },
  { id: 'cuts-grid-bar-dot', what: 'cuts', set: { mode: 'grid', div: 'bar', feel: 'dot', bars: 2, sig: 3, beats: 1, nudge: -20 } },
  { id: 'cuts-grid-32', what: 'cuts', set: { mode: 'grid', div: '32', feel: 'straight', bars: 1, shuffle: 66 } },
  { id: 'tempo', what: 'tempo', set: { sig: 4 } },
  { id: 'tempo-3', what: 'tempo', set: { sig: 3, bars: 3, beats: 2 } },
  { id: 'analyse', what: 'analyse' },
  // The functions on their own, on the third quarter's first channel.
  { id: 'resample', what: 'resample', span: [48000, 72000], ratios: [2 ** (5 / 12), 2 ** (-7 / 12), 2, 0.5, 2 ** (1 / 12), 2 ** (-24 / 12), 2 ** (24 / 12)] },
  { id: 'biquad', what: 'biquad', span: [48000, 72000], filters: [
    ['lp', 1000, 0.7, 0], ['hp', 80, 0.707, 0], ['bp', 1200, 2, 0], ['peak', 120, 1, 5], ['peak', 3000, 1.2, -4],
    ['lp', 9000, 0.707, 0], ['lp', 30000, 0.707, 0], ['hp', 20, 0.5, 0], ['bp', 60, 12, 0], ['peak', 8000, 0.3, 18], ['hp', 15000, 9, 0]] },
  { id: 'pingpong', what: 'pingpong', tails: [[0, 24000, 80], [24000, 48000, 30], [0, 24000, 300], [48000, 96000, 1000], [72000, 76000, 11]] },
  // What a slice sounds like.
  { id: 'slice-plain', what: 'slice', index: 1, set: GRID4 },
  { id: 'slice-tail', what: 'slice', index: 0, set: { ...GRID4, tail: true, tailMs: 80 } },
  { id: 'slice-shape', what: 'slice', index: 1, flags: { rev: [1] }, set: { ...GRID4, gate: 80, pitch: 5, smooth: 3, envOn: true, attack: 4, decay: 180, trOn: true, trThresh: -30, trAmount: 60, trAttack: 20, trRelease: 100, trGain: -2 } },
  { id: 'slice-tone', what: 'slice', index: 2, set: { ...GRID4, eqOn: true, loCut: 80, lowF: 120, lowG: 5, lowQ: 1, highF: 3000, highG: -4, highQ: 1.2, hiCut: 9000, fltOn: true, fltType: 'bp', fltFreq: 1200, fltQ: 2, drive: 40, gain: -3, mix: 70 } },
  { id: 'slice-lp', what: 'slice', index: 3, set: { ...GRID4, fltOn: true, fltType: 'lp', fltFreq: 700, fltQ: 4 } },
  { id: 'slice-hp-drive', what: 'slice', index: 0, set: { ...GRID4, fltOn: true, fltType: 'hp', fltFreq: 300, fltQ: 0.9, drive: 80, gain: 6, mix: 50 } },
  { id: 'slice-tail-rev-down', what: 'slice', index: 2, flags: { rev: [2] }, set: { ...GRID4, tail: true, tailMs: 120, pitch: -12, smooth: 1.5 } },
  { id: 'slice-env', what: 'slice', index: 0, set: { ...GRID4, envOn: true, attack: 0, decay: 60, gate: 50 } },
  { id: 'slice-env-attack', what: 'slice', index: 1, set: { ...GRID4, envOn: true, attack: 30, decay: 5000 } },
  { id: 'slice-transient-up', what: 'slice', index: 0, set: { ...GRID4, trOn: true, trThresh: -50, trAmount: 100, trAttack: 1, trRelease: 300, trGain: 3 } },
  { id: 'slice-transient-down', what: 'slice', index: 2, set: { ...GRID4, trOn: true, trThresh: -20, trAmount: -100, trAttack: 50, trRelease: 20, trGain: 0 } },
  { id: 'slice-eq-cuts', what: 'slice', index: 3, set: { ...GRID4, eqOn: true, loCut: 200, hiCut: 2000 } },
  { id: 'slice-silence-tail', what: 'slice', index: 4, set: { mode: 'silence', topDb: 40, minDur: 40, pad: 12, tail: true, tailMs: 80, pitch: 3 } },
  { id: 'slice-transient', what: 'slice', index: 5, set: { mode: 'transient', sens: 60, minDur: 40, gate: 70, smooth: 5 } },
  // Preview and Ratchet.
  { id: 'preview', what: 'preview', flags: { muted: [2] }, set: { mode: 'transient', sens: 60, minDur: 40, bars: 1, tempo: 100, stretch: 60, gate: 90, smooth: 2 } },
  { id: 'preview-fast', what: 'preview', set: { ...GRID4, div: '8', tempo: 150, pitch: 7 } },
  { id: 'preview-slow-full', what: 'preview', flags: { rev: [1, 3] }, set: { ...GRID4, div: '8', tempo: 70, stretch: 100, tail: true, tailMs: 40 } },
  { id: 'preview-silence', what: 'preview', set: { mode: 'silence', topDb: 40, minDur: 40, pad: 12, tempo: 90, stretch: 30, fltOn: true, fltType: 'lp', fltFreq: 2000 } },
  { id: 'preview-own', what: 'preview', set: { ...GRID4, div: '16', feel: 'trip', stretch: 80 } },
  { id: 'ratchet', what: 'ratchet', set: { mode: 'grid', div: '16', feel: 'straight', bars: 1, shuffle: 58, gate: 60, smooth: 2 } },
  { id: 'ratchet-dot', what: 'ratchet', set: { mode: 'grid', div: '8', feel: 'dot', bars: 2, gate: 100, smooth: 0, pitch: -5, tempo: 132, nudge: -15 } },
  { id: 'ratchet-trip-fx', what: 'ratchet', set: { mode: 'grid', div: '8', feel: 'trip', bars: 1, sig: 3, beats: 1, gate: 35, smooth: 6, tempo: 95, eqOn: true, lowG: 6, trOn: true, trAmount: 40 } },
];

function helpers() {
  'use strict';
  const R = (window.__port = {});
  R.f32 = (b64) => { const s = atob(b64), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return new Float32Array(u.buffer); };
  R.b64 = (f) => { const u = new Uint8Array(f.buffer, f.byteOffset, f.byteLength); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
  // Arrays go back as base64: a typed array as itself, a plain one of numbers as doubles.
  const f32 = (a) => ({ f32: R.b64(a instanceof Float32Array ? a : Float32Array.from(a)) });
  const f64 = (a) => ({ f64: R.b64(Float64Array.from(a)) });
  const chans = (chs) => chs.map(f32);
  R.run = async (cases, sig) => {
    window.Chop.init();
    window.Chop.loadSamples(sig.channels.map(R.f32), sig.rate, 'reference');
    await window.Chop.analysed();
    if (chop.rate !== sig.rate || chop.len !== sig.frames) throw new Error('Chop did not take the signal');
    const out = [];
    for (const C of cases) {
      window.Chop.init();
      window.Chop.set(C.set || {});
      for (const [flag, list] of Object.entries(C.flags || {})) {
        for (const i of list) { if (!chop.slices[i]) throw new Error(`${C.id}: no slice ${i} to mark ${flag}`); chop.slices[i][flag] = true; }
      }
      const slices = chop.slices.map((x) => [x.s, x.e]);
      const segs = (m) => window.Chop.detectSegs(window.Chop.buildRms(chop.mono), m.topDb, m.minDur, m.pad, chop.rate, chop.len);
      const sub = (c, [s, e]) => chop.channels[c].slice(s, e);
      let v;
      switch (C.what) {
        case 'mono': v = f32(chop.mono); break;
        case 'rms': v = f64(window.Chop.buildRms(chop.mono)); break;
        case 'segs': v = segs(C); break;
        case 'tails': v = segs(C).map(([s, e]) => window.Chop.getTailParams(s, e, C.tailMs, chop.rate)); break;
        case 'tailsAt': v = C.spans.map(([s, e]) => C.tails.map((t) => window.Chop.getTailParams(s, e, t, chop.rate))); break;
        case 'onsets': v = chopOnsets(); break;
        case 'cuts': v = slices; break;
        case 'tempo': v = { bpm: window.Chop.bpm(), found: window.Chop.findTempo() }; break;
        case 'analyse': {
          const an = chopAnalyseCore(chop.mono, chop.rate);
          v = {};
          for (const [k, x] of Object.entries(an)) v[k] = ArrayBuffer.isView(x) ? f32(x) : x;
          break;
        }
        case 'resample': v = C.ratios.map((r) => f32(chopResample(sub(0, C.span), r))); break;
        case 'biquad': v = C.filters.map(([t, f, q, g]) => {
          const k = chopBiquad(t, f, q, g, chop.rate);
          const c = sub(0, C.span);
          chopRunBiquad(c, k);
          return { k: f64(k), out: f32(c) };
        }); break;
        case 'pingpong': v = C.tails.map(([s, e, ms]) => {
          const t = window.Chop.buildPingPongTail(chop.channels, s, e, ms, chop.rate);
          return { interleaved: f32(t.interleaved), totalFrames: t.totalFrames, ch: t.ch, params: t.params };
        }); break;
        case 'slice': v = chans(window.Chop.sliceAudio(C.index)); break;
        case 'preview': { const p = window.Chop.renderPreview(); v = { chs: chans(p.chs), map: p.map }; break; }
        case 'ratchet': { const p = window.Chop.renderRatchet(); v = { chs: chans(p.chs), map: p.map }; break; }
        default: throw new Error(`no such case: ${C.what}`);
      }
      out.push({ ...C, slices, bpm: window.Chop.bpm(), playBpm: window.Chop.playBpm(), value: v });
    }
    return JSON.stringify(out);
  };
}

async function openChop(page) {
  await page.goto('/');
  await page.waitForFunction(() => typeof state !== 'undefined' && (state.folders || []).length > 0 && !!window.Chop, null, { timeout: 20_000 });
  await page.evaluate(async () => {
    const files = await api(`/api/files?folder=${encodeURIComponent(state.folders[0].name)}`);
    await selectFile(files[0]);
    setEditPage('chop');
    setMode('edit');
  });
  await page.waitForFunction(() => window.Chop.state.slices > 0, null, { timeout: 20_000 });
  await page.evaluate(helpers);
}

const b64 = (f) => Buffer.from(f.buffer, f.byteOffset, f.byteLength).toString('base64');

test('Chop: its arithmetic on the break, twice, the same', async ({ page, browser }, info) => {
  test.setTimeout(300_000);
  const def = M.signals.break;
  const chs = makeSignal(def);
  const sig = { rate: def.rate, frames: def.frames, channels: chs.map(b64) };
  await openChop(page);
  const first = await page.evaluate(([c, s]) => window.__port.run(c, s), [CASES, sig]);
  const context = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: info.project.use.viewport });
  let second;
  try {
    const again = await context.newPage();
    await openChop(again);
    second = await again.evaluate(([c, s]) => window.__port.run(c, s), [CASES, sig]);
  } finally { await context.close(); }
  expect(second === first, 'two runs of Chop differ').toBe(true);

  // The arrays out into files of their own, named for where they sit.
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const files = [];
  const lift = (v, name) => {
    if (Array.isArray(v)) return v.map((x, i) => lift(x, `${name}.${i}`));
    if (v && typeof v === 'object') {
      const kind = v.f32 !== undefined ? 'f32' : v.f64 !== undefined ? 'f64' : null;
      if (kind && Object.keys(v).length === 1) {
        const file = `${name}.${kind}`;
        writeFileSync(join(OUT, file), Buffer.from(v[kind], 'base64'));
        files.push(file);
        return { [kind]: file };
      }
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, lift(x, `${name}.${k}`)]));
    }
    return v;
  };
  const cases = JSON.parse(first).map((c) => ({ ...c, value: lift(c.value, c.id) }));
  const inter = Buffer.alloc(def.frames * chs.length * 4);
  for (let i = 0; i < def.frames; i++) for (let c = 0; c < chs.length; c++) inter.writeFloatLE(chs[c][i], (i * chs.length + c) * 4);
  writeFileSync(join(OUT, 'break.f32'), inter);
  const doc = {
    format: 'mgl-chop-port/1',
    made: new Date().toISOString(),
    chromium: browser.version(),
    input: { file: 'break.f32', rate: def.rate, channels: chs.length, frames: def.frames, interleaved: true, sha256: createHash('sha256').update(inter).digest('hex') },
    cases,
  };
  writeFileSync(join(OUT, 'chop-port.json'), JSON.stringify(doc, null, 1) + '\n');
  console.log(`chop port references: ${cases.length} cases, ${files.length} arrays, in ${OUT}`);
});

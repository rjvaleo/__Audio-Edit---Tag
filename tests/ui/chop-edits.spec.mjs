// What the Chop page does with its hands on the cuts, for the native port
// (`native/engine-mgl/src/chop/`: edit.rs, measure.rs, write.rs, said.rs) to
// match to the bit. A companion of `chop-port.spec.mjs`, on the same
// reference break, recorded the same way.
//
// Each case starts from nothing (no slices, S and E the whole sound, both
// slots at the starting settings, nothing said) and runs its `ops` in order,
// as the page's own functions:
//
// - `['set', {...}]`: `chopSetting` for each key, in order (a cut key cuts
//   again); written out as `['set', [[key, value], ...]]`, keeping the order;
// - `['region', s, e]`: `Chop.setRegion` (S and E, then `chopRecut`);
// - `['lock', i]`: the lock tool on slice i (`chopDragEdge` with the lock tool);
// - `['move', i, side, to, snap]`: `chopMoveEdge(i, side, snap ? chopSnap(to) : to)`, then `chopChanged`;
// - `['delete', i]`, `['add', at]`: `chopDeleteCut`, `chopAddCut` (the pencil);
// - `['pick', i, add]`, `['toggle', flag]`: `chopPick`, `chopToggle`;
// - `['recut']`, `['detect']`, `['scale', f]`, `['ab', 'A'|'B']`;
// - `['flag', name, [i...]]`: set by hand, as `chop-port`'s cases do.
//
// After every op: the slices with their flags, the picks, S and E, the words
// Detect left, both slots' Bars and Beats, the BPM. Then the case's `what`:
// `measures` (every slice's `chopMeasure`, `chopAttackMs`, `chopNote`),
// `tails` (`chopTailUI`'s badges and `#chopCycles`, read off the page),
// `wav` (`chopSliceWav` of every slice, bytes), `write` (the MIDI file and
// the SFZ `chopWriteAll` would make).
//
// Only when asked: `CHOP_EDITS_OUT=<folder>`, or `REFERENCE_RENDERS` naming
// chop. Bytes go out as `<file>.u8`, floats as `.f32`.

import { test, expect } from './test.mjs';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const M = JSON.parse(readFileSync(join(HERE, 'reference-renders', 'manifest.json'), 'utf8'));
const ASKED = (process.env.REFERENCE_RENDERS || '').trim();
const WANTED = !!process.env.CHOP_EDITS_OUT || /^(1|all|yes|true)$/i.test(ASKED) || ASKED.split(',').map((x) => x.trim()).includes('chop');
const OUT = process.env.CHOP_EDITS_OUT || join(tmpdir(), 'mgl-chop-edits');
test.skip(!WANTED, 'Chop edit references run only when asked: CHOP_EDITS_OUT=<folder>, or REFERENCE_RENDERS=chop');

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

const T = { mode: 'transient', sens: 60, minDur: 40 };
const S = { mode: 'silence', topDb: 40, minDur: 40, pad: 12 };
const G8 = { mode: 'grid', div: '8', feel: 'straight', bars: 1 };
const ALL = { gate: 80, pitch: 5, smooth: 3, envOn: true, attack: 4, decay: 180, trOn: true, trAmount: 60, eqOn: true, lowG: 5, hiCut: 9000, fltOn: true, fltType: 'bp', fltFreq: 1200, fltQ: 2, drive: 40, mix: 70, tail: true, tailMs: 60 };

const CASES = [
  // Cutting again keeps the locked and the moved cuts, in each mode.
  { id: 'keep-transient', ops: [['set', T], ['lock', 2], ['move', 4, 's', 49000, false], ['flag', 'muted', [5]], ['set', { sens: 30 }], ['set', { sens: 95, minDur: 20 }], ['recut']] },
  { id: 'keep-grid', ops: [['set', G8], ['lock', 3], ['move', 1, 'e', 26500, true], ['set', { div: '16' }], ['set', { div: '4', shuffle: 60 }], ['set', { mode: 'transient' }], ['set', { mode: 'grid', div: '32' }]] },
  { id: 'keep-silence', ops: [['set', S], ['lock', 1], ['move', 3, 's', 46000, false], ['move', 3, 'e', 60500, true], ['set', { topDb: 25 }], ['set', { topDb: 60, pad: 30 }], ['set', { mode: 'grid', div: '8' }], ['set', { mode: 'silence' }]] },
  { id: 'keep-region', ops: [['set', T], ['lock', 1], ['move', 6, 's', 70000, false], ['region', 5000, 80000], ['region', 20000, 96000], ['region', 0, 96000], ['lock', 0], ['lock', 0], ['recut']] },
  // Edits, between slices that touch and between silences.
  { id: 'edit-contig', ops: [['set', G8], ['move', 2, 's', 20000, true], ['move', 2, 's', 1000, false], ['move', 3, 'e', 50000, false], ['move', 3, 'e', 95990, false], ['delete', 4], ['delete', 0], ['add', 30123], ['add', 30200], ['add', 500], ['add', 95999], ['pick', 2, false], ['pick', 4, true], ['toggle', 'rev'], ['toggle', 'rev'], ['pick', 1, true], ['toggle', 'muted'], ['pick', 4, true], ['add', 41000], ['delete', 3], ['toggle', 'muted']] },
  { id: 'edit-transient', ops: [['set', T], ['move', 1, 'e', 15000, true], ['move', 5, 's', 61000, true], ['delete', 7], ['add', 5000], ['add', 90000], ['pick', -1, false], ['toggle', 'muted'], ['pick', 3, false], ['toggle', 'muted'], ['recut'], ['set', { sens: 80 }]] },
  { id: 'edit-silence', ops: [['set', S], ['move', 0, 'e', 20000, false], ['move', 0, 'e', 30000, false], ['move', 2, 's', 30000, true], ['move', 1, 's', 10, false], ['add', 18000], ['add', 26000], ['add', 94000], ['delete', 2], ['delete', 0], ['pick', 1, false], ['toggle', 'rev'], ['recut'], ['set', { topDb: 30 }]] },
  { id: 'edit-empty', ops: [['set', S], ['region', 92000, 96000], ['add', 94000], ['add', 93000], ['set', { mode: 'grid', div: '4' }], ['region', 0, 96000], ['set', { mode: 'silence', topDb: 15 }], ['add', 40000]] },
  // What each slice is.
  { id: 'measure-transient', ops: [['set', T]], what: 'measures' },
  { id: 'measure-grid16', ops: [['set', { mode: 'grid', div: '16' }]], what: 'measures' },
  { id: 'measure-silence', ops: [['set', S]], what: 'measures' },
  { id: 'measure-edited', ops: [['set', T], ['add', 30000], ['move', 0, 'e', 5000, false], ['region', 1000, 90000]], what: 'measures' },
  { id: 'measure-grid32', ops: [['set', { mode: 'grid', div: '32', feel: 'trip' }]], what: 'measures' },
  // The tail's badges.
  { id: 'tails-off', ops: [['set', T]], what: 'tails' },
  { id: 'tails-off-45', ops: [['set', { ...T, tailMs: 45 }]], what: 'tails' },
  { id: 'tails-80', ops: [['set', { ...T, tail: true, tailMs: 80 }]], what: 'tails' },
  { id: 'tails-200-gate', ops: [['set', { mode: 'grid', div: '16', tail: true, tailMs: 200, gate: 40 }]], what: 'tails' },
  { id: 'tails-silence', ops: [['set', { ...S, tail: true, tailMs: 25 }], ['add', 36000], ['add', 37000]], what: 'tails' },
  { id: 'tails-short', ops: [['set', { mode: 'grid', div: '32', tail: true, tailMs: 82.5 }], ['region', 0, 30000]], what: 'tails' },
  // The WAVs Write makes.
  { id: 'wav-plain', ops: [['set', G8]], what: 'wav' },
  { id: 'wav-plain-silence', ops: [['set', S]], what: 'wav' },
  { id: 'wav-tail', ops: [['set', { ...S, tail: true, tailMs: 80 }]], what: 'wav' },
  { id: 'wav-tail-short', ops: [['set', { mode: 'grid', div: '32', tail: true, tailMs: 80 }], ['region', 0, 9000]], what: 'wav' },
  { id: 'wav-rev', ops: [['set', G8], ['flag', 'rev', [1, 2]]], what: 'wav' },
  { id: 'wav-tail-rev', ops: [['set', { ...G8, tail: true, tailMs: 50 }], ['flag', 'rev', [0]]], what: 'wav' },
  { id: 'wav-all', ops: [['set', { ...G8, ...ALL }], ['flag', 'rev', [3]]], what: 'wav' },
  { id: 'wav-gate', ops: [['set', { ...T, gate: 55 }]], what: 'wav' },
  // The MIDI file and the SFZ.
  { id: 'write-grid', ops: [['set', G8], ['flag', 'muted', [2]]], what: 'write' },
  { id: 'write-transient', ops: [['set', { ...T, bars: 2, sig: 3, beats: 1 }], ['add', 30000], ['move', 2, 'e', 40000, false]], what: 'write' },
  { id: 'write-silence', ops: [['set', { ...S, bars: 3 }], ['region', 2000, 90000]], what: 'write' },
  { id: 'write-fast', ops: [['set', { mode: 'grid', div: '32', bars: 7, sig: 5 }], ['flag', 'muted', [0, 31]]], what: 'write' },
  // Detect, ½× and 2×, and A / B.
  { id: 'detect-whole', ops: [['detect'], ['scale', 0.5], ['scale', 2], ['scale', 2], ['scale', 0.5], ['scale', 0.5], ['scale', 0.5]] },
  { id: 'detect-regions', ops: [['region', 0, 70000], ['detect'], ['region', 10000, 60000], ['detect'], ['region', 0, 20000], ['detect'], ['region', 0, 7000], ['detect'], ['region', 3000, 96000], ['detect'], ['region', 0, 52000], ['detect']] },
  { id: 'detect-sig3', ops: [['set', { sig: 3 }], ['detect'], ['scale', 2], ['set', { beats: 2 }], ['scale', 0.5], ['scale', 0.5], ['scale', 2]] },
  { id: 'scale-ab', ops: [['set', { bars: 3, beats: 1 }], ['ab', 'B'], ['scale', 2], ['set', { mode: 'grid', div: '16' }], ['ab', 'A'], ['scale', 0.5], ['detect'], ['ab', 'B']] },
];

function helpers() {
  'use strict';
  const R = (window.__edits = {});
  R.f32 = (b64) => { const s = atob(b64), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return new Float32Array(u.buffer); };
  const b64 = (u) => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
  const u8 = (buf) => ({ u8: b64(buf instanceof Uint8Array ? buf : new Uint8Array(buf)) });
  const FLAGS = (x) => (x.locked ? 1 : 0) | (x.moved ? 2 : 0) | (x.muted ? 4 : 0) | (x.rev ? 8 : 0);
  const snap = () => ({
    slices: chop.slices.map((x) => [x.s, x.e, FLAGS(x)]),
    sel: [...chop.sel],
    current: chop.current,
    region: [chop.region.s, chop.region.e],
    said: chopTempoSaid.text,
    which: chopSlots.which,
    a: [chopSlots.a.bars, chopSlots.a.beats],
    b: [chopSlots.b.bars, chopSlots.b.beats],
    bpm: chopBpm(),
  });
  const run = (op) => {
    const [k, ...a] = op;
    switch (k) {
      case 'set': window.Chop.set(a[0]); break;
      case 'region': window.Chop.setRegion(a[0], a[1]); break;
      case 'lock': chop.slices[a[0]].locked = !chop.slices[a[0]].locked; chopChanged(); break;
      case 'move': chopMoveEdge(a[0], a[1], a[3] ? chopSnap(a[2]) : a[2]); chopChanged(); break;
      case 'delete': chopDeleteCut(a[0]); break;
      case 'add': chopAddCut(a[0]); break;
      case 'pick': chopPick(a[0], { add: a[1] }); break;
      case 'toggle': chopToggle(a[0]); break;
      case 'recut': chopRecut(); break;
      case 'detect': chopDetect(); break;
      case 'scale': chopScaleBars(a[0]); break;
      case 'ab': chopSwitchAB(a[0]); break;
      case 'flag': for (const i of a[1]) { if (!chop.slices[i]) throw new Error(`no slice ${i} to mark ${a[0]}`); chop.slices[i][a[0]] = true; } chopChanged(); break;
      default: throw new Error(`no such op: ${k}`);
    }
  };
  R.run = async (cases, sig) => {
    window.Chop.init();
    window.Chop.loadSamples(sig.channels.map(R.f32), sig.rate, 'reference');
    await window.Chop.analysed();
    if (chop.rate !== sig.rate || chop.len !== sig.frames || !chop.an) throw new Error('Chop did not take and measure the signal');
    const out = [];
    for (const C of cases) {
      chopStop();
      chop.slices = [];
      chop.sel = new Set();
      chop.current = -1;
      chop.region = { s: 0, e: chop.len };
      chopSlots.a = { ...CHOP_DEF };
      chopSlots.b = { ...CHOP_DEF };
      chopSlots.which = 'a';
      cp = chopSlots.a;
      chopTempoSaid.text = '';
      window.Chop.init();
      const steps = [snap()];
      for (const op of C.ops) { run(op); steps.push(snap()); }
      let v = null;
      switch (C.what || '') {
        case '': break;
        case 'measures': v = chop.slices.map((x) => ({ ...x.m, attackMs: chopAttackMs(x), note: x.m.hz ? chopNote(x.m.hz) : '' })); break;
        case 'tails': v = {
          badges: [...document.querySelectorAll('#chopList .chop-row')].map((r) => { const b = r.querySelector('.tail-badge'); return { cls: b.className.replace(/^tail-badge ?/, ''), text: b.textContent, title: b.title }; }),
          cycles: $('chopCycles').textContent,
        }; break;
        case 'wav': v = chop.slices.map((_, i) => u8(chopSliceWav(i))); break;
        case 'write': {
          const written = chop.slices.map((x, i) => ({ x, i })).filter(({ x }) => !x.muted).map(({ i }) => ({ i, name: chopName(i) }));
          v = { written: written.map((w) => w.i), names: written.map((w) => w.name), midi: u8(chopMidi(written)), sfz: chopSfz(written) };
          break;
        }
        default: throw new Error(`no such case: ${C.what}`);
      }
      // A `set`'s keys as [key, value] pairs, in the order the page set them.
      const ops = C.ops.map((op) => (op[0] === 'set' ? ['set', Object.entries(op[1])] : op));
      out.push({ ...C, ops, steps, value: v });
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

test('Chop: its edits, measures and writing on the break, twice, the same', async ({ page, browser }, info) => {
  test.setTimeout(300_000);
  const def = M.signals.break;
  const chs = makeSignal(def);
  const sig = { rate: def.rate, frames: def.frames, channels: chs.map(b64) };
  await openChop(page);
  const first = await page.evaluate(([c, s]) => window.__edits.run(c, s), [CASES, sig]);
  const context = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: info.project.use.viewport });
  let second;
  try {
    const again = await context.newPage();
    await openChop(again);
    second = await again.evaluate(([c, s]) => window.__edits.run(c, s), [CASES, sig]);
  } finally { await context.close(); }
  expect(second === first, 'two runs of Chop differ').toBe(true);

  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const files = [];
  const lift = (v, name) => {
    if (Array.isArray(v)) return v.map((x, i) => lift(x, `${name}.${i}`));
    if (v && typeof v === 'object') {
      const kind = ['u8', 'f32', 'f64'].find((k) => v[k] !== undefined);
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
    format: 'mgl-chop-edits/1',
    made: new Date().toISOString(),
    chromium: browser.version(),
    input: { file: 'break.f32', rate: def.rate, channels: chs.length, frames: def.frames, interleaved: true, sha256: createHash('sha256').update(inter).digest('hex') },
    cases,
  };
  writeFileSync(join(OUT, 'chop-edits.json'), JSON.stringify(doc, null, 1) + '\n');
  console.log(`chop edit references: ${cases.length} cases, ${files.length} files, in ${OUT}`);
});

// A throwaway instance, on a port of its own, with a library of its own.
//
// For looking at the real interface without going near a working session. The
// hazard this is built to avoid has happened: a throwaway server once took the
// next port up, opened the same audio device, and played over a real session —
// costing an hour of debugging a fault that was not there.
//
// So: its own port, its own data directory, its own library, and it is killed
// on the way out. It never asks for playback. If you add something here that
// can make sound, you have rebuilt the trap.
//
//   node tools/scratch-server.mjs            # start, print the URL, wait
//   node tools/scratch-server.mjs --check    # start, run the checks, exit
//
// The checks are the ones that do not need a browser. What needs a browser is
// in the same place a person would look: open the URL it prints.

import { spawnSync, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.SCRATCH_PORT || 8791);
const binary = join(root, 'core/target/release/audiolab');

// ------------------------------------------------------------- a library

const base = mkdtempSync(join(tmpdir(), 'audiolab-scratch-'));
const data = join(base, 'data');
const library = join(base, 'library');
mkdirSync(data, { recursive: true });
mkdirSync(join(library, 'kit'), { recursive: true });

/// A real WAV, because the routes that open files need one.
function wav(path, frames, rate = 44100) {
  const bytes = frames * 2;
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + bytes, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);          // PCM
  h.writeUInt16LE(1, 22);          // mono
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(bytes, 40);
  const pcm = Buffer.alloc(bytes);
  for (let i = 0; i < frames; i++) pcm.writeInt16LE(Math.round(Math.sin(i / 30) * 9000), i * 2);
  writeFileSync(path, Buffer.concat([h, pcm]));
}

wav(join(library, 'kit/tone.wav'), 44100);
wav(join(library, 'kit/short.wav'), 4410);
writeFileSync(join(data, 'config.json'), JSON.stringify({ library }));

// --------------------------------------------------------------- the server

if (!spawnSync('test', ['-x', binary]).status === 0) {
  console.error(`no binary at ${binary} — cargo build --release --manifest-path core/Cargo.toml`);
  process.exit(1);
}

const child = spawn(binary, [], {
  env: { ...process.env, AUDIOLAB_DATA: data, AUDIOLAB_PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let bye = false;
const stop = (code) => {
  if (bye) return;
  bye = true;
  try { child.kill('SIGTERM'); } catch {}
  try { rmSync(base, { recursive: true, force: true }); } catch {}
  process.exit(code);
};
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));

const url = `http://127.0.0.1:${PORT}`;

async function waitUp(ms = 8000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      const r = await fetch(`${url}/api/state`);
      if (r.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

// ---------------------------------------------------------------- the checks

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'ok   ' : 'FAIL '} ${name}${detail && !ok ? ` — ${detail}` : ''}`);
};

async function json(path, init) {
  const r = await fetch(`${url}${path}`, init);
  return { status: r.status, body: await r.json().catch(() => null) };
}
const postJSON = (path, obj) =>
  json(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) });

async function runChecks() {
  const st = await json('/api/state');
  check('the library was scanned', (st.body?.files || 0) > 0, `${st.body?.files} files`);

  // The interface is served whole. A missing asset is a blank page, and it has
  // happened — a rebuild forgotten after an edit serves the previous file.
  for (const asset of ['/', '/app.js', '/app.css', '/grains3d', '/p5.min.js', '/fonts.css']) {
    const r = await fetch(`${url}${asset}`);
    check(`serves ${asset}`, r.ok && (await r.text()).length > 0, `status ${r.status}`);
  }

  // The picker is built entirely from this list.
  const fx = await json('/api/fx');
  const kinds = (fx.body?.shapers || []).map((s) => s.kind);
  check('offers modules', kinds.length > 0, `${kinds.length}`);
  check('offers the maximiser', kinds.includes('maximizer'));
  check(
    'every module has a label and controls it declares',
    (fx.body?.shapers || []).every((s) => s.label && Array.isArray(s.params)),
  );

  // Every module the picker offers must survive being added and read back —
  // the round trip the interface makes every time one is dropped on the rail.
  let added = 0;
  for (const kind of kinds) {
    const spec = (fx.body.shapers || []).find((s) => s.kind === kind);
    const params = Object.fromEntries((spec.params || []).map((p) => [p.key, p.default]));
    const put = await postJSON('/api/rack', {
      p: 'kit/tone.wav',
      sr: 44100,
      slots: [{ id: `s-${kind}`, kind, bypassed: false, params }],
    });
    if (put.status !== 200) { check(`rack accepts ${kind}`, false, `status ${put.status}`); continue; }
    const back = await json('/api/rack?p=kit/tone.wav');
    const got = (back.body?.slots || [])[0];
    if (got?.kind !== kind) { check(`rack keeps ${kind}`, false, `got ${got?.kind}`); continue; }
    added++;
  }
  check(`every module survives being added and read back`, added === kinds.length, `${added}/${kinds.length}`);

  // The waveform is the material: the rack must not change it.
  await postJSON('/api/rack', { p: 'kit/tone.wav', sr: 44100, slots: [] });
  const dry = await json('/api/peaks?p=kit/tone.wav&cols=64');
  await postJSON('/api/rack', {
    p: 'kit/tone.wav', sr: 44100,
    slots: [{ id: 'g', kind: 'gain', bypassed: false, db: -24 }],
  });
  const wet = await json('/api/peaks?p=kit/tone.wav&cols=64');
  check(
    'the waveform ignores the rack',
    JSON.stringify(dry.body?.channels) === JSON.stringify(wet.body?.channels),
  );

  // Nothing here should ever have started the engine.
  const engine = await json('/api/engine/state');
  check('nothing was played', engine.body?.playing !== true, JSON.stringify(engine.body?.playing));
}

// ------------------------------------------------------------------- go

if (!(await waitUp())) {
  console.error('the scratch server did not come up');
  stop(1);
}

// Pointing at a library is not the same as having one. The index is built by a
// scan, and without it every route that lists sounds answers with nothing —
// which looks exactly like a broken app rather than an unscanned one.
await fetch(`${url}/api/scan`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
for (let i = 0; i < 100; i++) {
  const st = await (await fetch(`${url}/api/state`)).json().catch(() => ({}));
  if (st.files > 0 && !st.scan?.running) break;
  await new Promise((r) => setTimeout(r, 100));
}

if (process.argv.includes('--check')) {
  await runChecks();
  const bad = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - bad}/${results.length} passed`);
  stop(bad ? 1 : 0);
} else {
  console.log(`scratch server on ${url}`);
  console.log(`  data    : ${data}`);
  console.log(`  library : ${library} (kit/tone.wav, kit/short.wav)`);
  console.log('  ctrl-c to stop and clean up');
}

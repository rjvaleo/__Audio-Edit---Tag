// The Reverb window's references: MGL's own drawing functions from
// ui/app/077-fx-reverb-window.js, run in node (no browser) against a canvas
// that records every call and property set, for rv-test.cpp to check the
// native port (native/app/Source/FxReverbDraw.cpp) against, call for call.
//
//   node native/tools/face-capture/rv-refs.mjs OUT/rv-refs.json
//
// Cases: every reverb mode (given/fx.json's reverb suite) at its shaper's
// defaults and at a second set of values (each param 30% of the way from min
// to max): rvNet's spec, rvDrawNet big (as rvFrame calls it) and small (the
// picker's thumbnail, rvPicUrl), rvOverlay; rvDrawRoom for every shape and a
// spread of Place settings, glows, times and camera turns, with what it leaves
// in RV_ROOM and the readout; the room's drag; rvRoleOf for every param of
// every shaper; RV_PLACE and RV_NEW_PADS.

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const out = process.argv[2];
if (!out) { console.error('usage: node rv-refs.mjs OUT.json'); process.exit(2); }

// The colours the test hands the port too (rv-test.cpp's COLOURS).
const CSS = {
  '--rv-rgb': '47,212,194', '--rv-ice-rgb': '207,234,255', '--rv-on-rgb': '255,181,71', '--rv-off-rgb': '150,160,175',
  '--well': 'rgb(12,14,18)', '--white-rgb': '255,255,255', '--text-dim': 'rgb(160,165,175)', '--on': '#ffb547', '--text': 'rgb(240,242,245)',
};

const src = fs.readFileSync(path.join(root, 'ui/app/077-fx-reverb-window.js'), 'utf8');
const sandbox = {
  performance: { now: () => 0 },
  getComputedStyle: () => ({ getPropertyValue: (n) => CSS[n] ?? '' }),
  document: { documentElement: {} },
  console,
};
vm.createContext(sandbox);
const RV = vm.runInContext(`${src}
;({ RV_SHAPES, rvNet, rvDrawNet, rvOverlay, rvDrawRoom, rvReadColours, RV_CAM, RV3, rvRoleOf, RV_PLACE, RV_NEW_PADS, RV_FADERS,
    room: () => RV_ROOM })`, sandbox, { filename: '077-fx-reverb-window.js' });
RV.rvReadColours();

// A canvas that writes down everything done to it. measureText's width is a
// fixed 5.4 px a character (the stand-in's too).
function recorder() {
  const log = [];
  const flat = (a) => (Array.isArray(a) ? a.slice() : a);
  const target = {};
  const ctx = new Proxy(target, {
    get(_, k) {
      if (k === 'measureText') return (s) => { log.push(['measureText', s]); return { width: s.length * 5.4 }; };
      if (k in target) return target[k];
      return (...a) => { log.push([k, ...a.flatMap((x) => (Array.isArray(x) ? (x.length ? x : []) : [flat(x)]))]); };
    },
    set(_, k, v) { target[k] = v; log.push(['set', k, v]); return true; },
  });
  return { ctx, log };
}

const fx = JSON.parse(fs.readFileSync(path.join(here, 'given/fx.json'), 'utf8'));
const shapers = {};
for (const s of fx.shapers) shapers[s.kind] = s;
const reverb = fx.suites.find((s) => s.id === 'reverb');
const modes = reverb.families.flatMap((f) => f.modes);

const NW = 640, NH = 330, RW = 595, RH = 330;
const cases = [];

// rvFrame's options for the network (077 line 710), as the test's port has them.
const frameOpts = (v, e, t, moving) => ({ e, t: moving ? t : 0, ice: v.freeze >= 0.5, mod: moving ? (v.modDepth !== undefined ? Math.sqrt(v.modDepth / 100) : v.spinHz !== undefined ? 0.4 : 0.15) : 0, rate: v.modRateHz ?? v.spinHz ?? 0.5 });

for (const m of modes) {
  const params = shapers[m.kind]?.params || [];
  const sets = [
    ['defaults', Object.fromEntries(params.map((p) => [p.key, p.default])), 0.35, 1.3, true],
    ['second', Object.fromEntries(params.map((p) => [p.key, p.min + 0.3 * (p.max - p.min)])), 0.8, 2.7, true],
    ['still', Object.fromEntries(params.map((p) => [p.key, p.default])), 0.06, 4.1, false],
  ];
  for (const [name, v, e, t, moving] of sets) {
    const spec = RV.rvNet(m, v);
    const opts = frameOpts(v, e, t, moving);
    const big = recorder();
    RV.rvDrawNet(big.ctx, NW, NH, spec, opts);
    RV.rvOverlay(big.ctx, NW, NH, v, e);
    cases.push({ kind: 'net', mode: m.id, set: name, v, w: NW, h: NH, e, t, moving, spec, log: big.log });
  }
  // the picker's thumbnail (rvPicUrl)
  const v = Object.fromEntries(params.map((p) => [p.key, p.default]));
  const small = recorder();
  small.ctx.scale(3, 3);
  RV.rvDrawNet(small.ctx, 64, 24, RV.rvNet(m, v), { e: 0.6, t: 0.6, small: true });
  cases.push({ kind: 'thumb', mode: m.id, v, log: small.log });
}

// the room
const place = (o) => ({ placeOn: 1, roomShape: 1, roomSizeM: 24, placePos: -25, placeDist: 40, placeHeight: 35, placeSpread: 100, freeze: 0, ...o });
const rooms = [];
for (let s = 0; s < 6; s++) {
  rooms.push([place({ roomShape: s }), 0.35, 0.4, 3.2, null]);
  rooms.push([place({ roomShape: s, placePos: 80, placeDist: 90, placeHeight: 100, placeSpread: 200, roomSizeM: 60 }), 0.9, 1.1, 7.5, [0.4, 1.2]]);
}
rooms.push([place({ placeOn: 0 }), 0.2, 0.05, 1, null]);
rooms.push([place({ freeze: 1, roomShape: 2 }), 0.7, 0.25, 2, [-1.5, 0.08]]);
rooms.push([place({ roomShape: 3, placePos: -100, placeDist: 0, placeHeight: 0, placeSpread: 0, roomSizeM: 3 }), 0.06, 12, 0.5, [2.6, 1.35]]);
rooms.push([place({ roomShape: 4, placePos: 30, placeDist: 70, placeHeight: 60 }), 0.5, 0.8, 9, [-0.38, 0.9]]);
rooms.push([place({ roomShape: 5, placePos: 100, roomSizeM: 80 }), 0.5, 0.3, 11, [0.9, 0.3]]);
rooms.push([place({ roomShape: 0, roomSizeM: 7.3, placeDist: 12.5, placeHeight: 49.6 }), 1, 0.01, 0.3, null]);
for (const [v, e, since, t, cam] of rooms) {
  RV.RV_CAM.yaw = cam ? cam[0] : -0.38; RV.RV_CAM.pitch = cam ? cam[1] : 0.5;
  const r = recorder();
  const readout = RV.rvDrawRoom(r.ctx, RW, RH, v, e, since, t);
  const { W, C, Sq } = RV.room();
  // the room's drag (rvBuild): the sound moved to a few points of the view
  const drags = [[RW * 0.3, RH * 0.6], [RW * 0.7, RH * 0.4], [RW / 2, RH / 2], [10, 10]].map(([sx, sy]) => {
    const d = RV.RV3.add(RV.RV3.add(C.f, RV.RV3.mul(C.r, (sx - C.cx) / C.F)), RV.RV3.mul(C.u, -(sy - C.cy) / C.F));
    if (Math.abs(d[2]) < 1e-4) return { sx, sy, ok: false };
    const tt = (W.src[2] - C.pos[2]) / d[2]; if (tt <= 0) return { sx, sy, ok: false };
    const p = RV.RV3.add(C.pos, RV.RV3.mul(d, tt));
    const clamp = (a, lo, hi) => Math.max(lo, Math.min(hi, a));
    return { sx, sy, ok: true, pos: clamp(p[0] / (W.wide * 0.36) * 100, -100, 100), dist: clamp(((p[1] - W.listen[1]) / ((W.depth - W.listen[1]) * 0.92) - 0.12) / 0.78 * 100, 0, 100) };
  });
  cases.push({ kind: 'room', v, w: RW, h: RH, e, since, t, cam: [RV.RV_CAM.yaw, RV.RV_CAM.pitch], readout, W, C, Sq: Sq ?? null, drags, log: r.log });
}

// rvRoleOf for every param of every shaper
const roles = [];
for (const s of fx.shapers) for (const p of s.params || []) roles.push({ role: p.role ?? '', key: p.key, out: RV.rvRoleOf(p), fader: RV.RV_FADERS.test(p.key) });

const NUM = (k, x) => (typeof x === 'number' && !Number.isFinite(x) ? String(x) : x);
fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ colours: CSS, cases, roles, place: RV.RV_PLACE, pads: RV.RV_NEW_PADS }, NUM));
const calls = cases.reduce((a, c) => a + c.log.length, 0);
console.log(`${cases.length} cases (${cases.filter((c) => c.kind === 'net').length} networks, ${cases.filter((c) => c.kind === 'thumb').length} thumbnails, ${cases.filter((c) => c.kind === 'room').length} rooms), ${calls} calls, ${roles.length} roles -> ${out}`);

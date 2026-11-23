// The Prism page's pad and takes, run in node from the page's own code
// (ui/app/385-hyperstretch.js), for engine-app/tests/prism.rs to hold the
// module's takes to. Its handlers are the page's, fed synthetic pointer
// events on a stand-in pad at a fixed size and a clock set step by step.
//
//   node native/engine-app/tests/reference/prism/takes-refs.mjs > native/engine-app/tests/reference/prism/takes.json
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const mgl = path.resolve(here, '../../../../..');
const code = fs.readFileSync(path.join(mgl, 'ui/app/385-hyperstretch.js'), 'utf8');

function run(c) {
  let T = 0;
  const els = {};
  const fake = (id) => {
    const handlers = {};
    const el = {
      id, handlers, dataset: {}, style: { setProperty() {} }, value: '', textContent: '', checked: false, disabled: false,
      classList: { toggle() {}, add() {}, remove() {}, contains: () => false },
      addEventListener(t, f) { (handlers[t] = handlers[t] || []).push(f); },
      getBoundingClientRect: () => ({ left: 0, top: 0, width: c.w, height: c.h }),
      setPointerCapture() {}, focus() {}, setAttribute() {}, getAttribute: () => '1',
      querySelector: () => fake('q'), querySelectorAll: () => [], closest: () => fake('c'),
    };
    return el;
  };
  const $ = (id) => (els[id] = els[id] || fake(id));
  const prismDeck = { path: 'kit/prism.wav', playing: false, stretch: {} };
  const ctx = {
    $, console, Math, JSON, Number, Promise, Set, Object, Array, String, isFinite, Infinity,
    performance: { now: () => T },
    requestAnimationFrame: () => 1, localStorage: { getItem: () => null, setItem() {} },
    window: {}, document: { getElementById: () => null, querySelectorAll: () => [] },
    fetch: () => Promise.resolve(), postJSON: () => Promise.resolve(), api: () => Promise.resolve({}),
    prismDeck, prismPad: { path: [], sources: [], source: 'stretch' }, state: {}, engine: { playing: false },
    prismControl: (k) => ({ ratio: { key: 'ratio', log: true, min: 0.01, max: 100 }, semitones: { key: 'semitones', min: -48, max: 48 } })[k],
    prismCurrent: () => ({ id: 'stretch' }), prismFormat: (cc, v) => String(v), prismStretchSend() {}, prismRelease() {},
    prismDeckPlay() { prismDeck.playing = true; }, prismDeckPause() { prismDeck.playing = false; }, prismDeckPoll() {},
    prismPresetBar() {}, prismDrops() {}, prismDeckSeekWire() {}, prismTargets: () => null, prismEngineName: () => 'Granular',
    prismWrite() {}, prismLoadPath: () => Promise.resolve(), prismSetup: () => null,
    PRISM_ENGINES: [['granular', 'Granular']], PRISM_STRETCH: 'stretch', PRISM_PTC: 'ptc',
  };
  vm.createContext(ctx);
  vm.runInContext(code + '\n;this.hs = hs; this.hsWire = hsWire; this.hsFrame = hsFrame; this.hsValueX = hsValueX; this.hsValueY = hsValueY;', ctx);
  const hs = ctx.hs;
  hs.built = true; hs.shown = true; hs.w = c.w; hs.h = c.h;
  hs.axes = { x: 'ratio', y: 'semitones' };
  hs.glide = c.glide; hs.throwOn = c.throw; hs.loopOnRelease = c.loopOnRelease;
  ctx.hsWire();
  const pad = $('hsPad');
  const fire = (t, e) => { for (const f of pad.handlers[t] || []) f(e); };
  const ev = (x, y, shift) => ({ clientX: x * c.w, clientY: y * c.h, shiftKey: !!shift, button: 0, pointerId: 1, preventDefault() {}, stopPropagation() {} });
  const steps = [], after = [];
  for (const s of c.steps) {
    T = s.t;
    const st = { ...s };
    if ('x' in s) { st.x = Math.max(0, Math.min(1, (s.x * c.w) / c.w)); st.y = Math.max(0, Math.min(1, (s.y * c.h) / c.h)); }
    if (s.op === 'down') fire('pointerdown', ev(s.x, s.y));
    else if (s.op === 'move') fire('pointermove', ev(s.x, s.y, s.shift));
    else if (s.op === 'up') fire('pointerup', ev(0, 0));
    else if (s.op === 'play') $('hsPlay').onclick();
    else if (s.op === 'stop') $('hsStop').onclick();
    else if (s.op === 'rate') hs.rate = s.v;
    else if (s.op === 'dir') hs.dir = s.v;
    else if (s.op === 'shape') ctx.hsShape(s.v);
    else if (s.op === 'frame') ctx.hsFrame(s.t);
    steps.push(st);
    const g = hs.ghost || hs.hand;
    after.push({ hand: [hs.hand.x, hs.hand.y], ghost: [g.x, g.y], mode: hs.mode, values: [ctx.hsValueX(hs.hand.x), ctx.hsValueY(hs.hand.y)] });
  }
  const take = hs.slots[0] ? { dur: hs.slots[0].dur, pts: hs.slots[0].pts } : null;
  return { name: c.name, w: c.w, h: c.h, glide: c.glide, throw: c.throw, loopOnRelease: c.loopOnRelease, steps, after, take };
}

const frames = (from, to, step) => { const out = []; for (let t = from; t <= to; t += step) out.push({ op: 'frame', t }); return out; };
const cases = [
  { name: 'a drag, Shift locked, played at every rate and direction', w: 612, h: 498, glide: 50, throw: false, loopOnRelease: false, steps: [
    { op: 'down', x: 0.2, y: 0.3, t: 1000 }, { op: 'move', x: 0.25, y: 0.31, t: 1005 }, { op: 'move', x: 0.3, y: 0.35, t: 1020 },
    { op: 'move', x: 0.41, y: 0.33, t: 1040.5 }, { op: 'move', x: 0.5, y: 0.45, t: 1060, shift: true }, { op: 'move', x: 0.62, y: 0.47, t: 1080, shift: true },
    { op: 'move', x: 0.9, y: 0.8, t: 1100, shift: true }, { op: 'move', x: 0.95, y: 0.1, t: 1133 }, { op: 'up', t: 1150 },
    { op: 'play', t: 1200 }, ...frames(1210, 1900, 37), { op: 'rate', v: 2, t: 1900 }, ...frames(1917, 2400, 29),
    { op: 'dir', v: 'rev', t: 2400 }, ...frames(2411, 2900, 41), { op: 'dir', v: 'pp', t: 2900 }, { op: 'rate', v: 0.5, t: 2900 }, ...frames(2913, 3600, 53),
    { op: 'stop', t: 3600 }, ...frames(3617, 3800, 17)] },
  { name: 'a diagonal lock', w: 400, h: 400, glide: 10, throw: false, loopOnRelease: false, steps: [
    { op: 'down', x: 0.5, y: 0.5, t: 100 }, { op: 'move', x: 0.52, y: 0.52, t: 130, shift: true }, { op: 'move', x: 0.7, y: 0.6, t: 160, shift: true },
    { op: 'move', x: 0.1, y: 0.9, t: 190 }, { op: 'move', x: 0.2, y: 0.8, t: 220, shift: true }, { op: 'move', x: 0.3, y: 0.95, t: 250, shift: true }, { op: 'up', t: 260 }] },
  { name: 'thrown', w: 500, h: 300, glide: 0, throw: true, loopOnRelease: false, steps: [
    { op: 'down', x: 0.5, y: 0.5, t: 500 }, { op: 'move', x: 0.6, y: 0.45, t: 516 }, { op: 'move', x: 0.75, y: 0.4, t: 532 }, { op: 'up', t: 540 },
    ...frames(550, 2500, 16.7)] },
  { name: 'loop on release', w: 640, h: 480, glide: 90, throw: false, loopOnRelease: true, steps: [
    { op: 'down', x: 0.1, y: 0.9, t: 2000 }, { op: 'move', x: 0.5, y: 0.5, t: 2100 }, { op: 'move', x: 0.9, y: 0.1, t: 2200 }, { op: 'up', t: 2300 },
    ...frames(2310, 3000, 23)] },
  { name: 'a circle drawn in', w: 612, h: 498, glide: 100, throw: false, loopOnRelease: false, steps: [
    { op: 'shape', v: 'circle', t: 0 }, ...frames(5, 4500, 61), { op: 'dir', v: 'pp', t: 4500 }, ...frames(4520, 9000, 97)] },
];
process.stdout.write(JSON.stringify(cases.map(run)));

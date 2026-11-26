// The effect cards' references: what MGL's JS draws for every picture,
// display, ring and reading the native port (`native/app/Source/FxPictures.cpp`)
// draws, over a dense set of inputs, for `fxp-test.cpp` to check string for
// string.
//
//   node native/tools/face-capture/fxp-refs.mjs OUT/fxp-refs.json
//
// No browser: the page's own files (grain-glyphs.js, 071, 072, 073a, 075,
// 075b, 076, 404) run in a `vm` context with a stub DOM that only records what
// is written into it (innerHTML, attributes, styles, text), so the face
// functions run as the page runs them and their markup is read back from the
// stubs. The catalogue is `given/fx.json` (MGL's `/api/fx`).

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const out = process.argv[2] || path.join(here, 'fxp-refs.json');
const api = JSON.parse(fs.readFileSync(path.join(here, 'given/fx.json'), 'utf8'));

// ── a stub DOM: records, never lays out ──────────────────────────────────────
const created = [];
class Style {
  constructor() { this.props = {}; }
  setProperty(k, v) { this.props[k] = String(v); }
  removeProperty(k) { delete this.props[k]; }
  getPropertyValue(k) { return this.props[k] ?? ''; }
}
class ClassList {
  constructor() { this.s = new Set(); }
  add(...c) { c.forEach((x) => this.s.add(x)); }
  remove(...c) { c.forEach((x) => this.s.delete(x)); }
  toggle(c, on) { const want = on === undefined ? !this.s.has(c) : !!on; if (want) this.s.add(c); else this.s.delete(c); return want; }
  contains(c) { return this.s.has(c); }
}
class El {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase(); this._html = ''; this.children = []; this._q = new Map(); this.attrs = [];
    this.style = new Style(); this.classList = new ClassList(); this.dataset = {}; this.textContent = ''; this.title = '';
    this.viewBox = { baseVal: { width: 44 } }; this.isConnected = true;
    created.push(this);
  }
  // As the DOM keeps it: the string set, verbatim.
  get className() { return this._raw ?? [...this.classList.s].join(' '); }
  set className(v) { this._raw = String(v); this.classList.s = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get innerHTML() { return this._html; }
  set innerHTML(v) { this._html = String(v); this.children = []; this._q = new Map(); }
  querySelector(sel) {
    if (sel === ':scope > .fx-pic') return null;
    if (!this._q.has(sel)) this._q.set(sel, new El('q'));
    return this._q.get(sel);
  }
  querySelectorAll(sel) {
    if (sel.startsWith(':scope')) return [];
    if (!this._q.has('*' + sel)) this._q.set('*' + sel, [new El('q'), new El('q')]);
    return this._q.get('*' + sel);
  }
  appendChild(c) { this.children.push(c); return c; }
  append(...c) { this.children.push(...c); }
  prepend(...c) { this.children.unshift(...c); }
  insertAdjacentHTML() {}
  remove() {}
  setAttribute(k, v) { const a = this.attrs.find((x) => x[0] === k); if (a) a[1] = String(v); else this.attrs.push([k, String(v)]); }
  getAttribute(k) { return this.attrs.find((x) => x[0] === k)?.[1] ?? null; }
  removeAttribute(k) { this.attrs = this.attrs.filter((x) => x[0] !== k); }
  addEventListener() {}
  setPointerCapture() {}
  hasPointerCapture() { return false; }
  releasePointerCapture() {}
  closest() { return null; }
  focus() {}
  get lastElementChild() { return this.children.at(-1); }
}
const shapers = Object.fromEntries(api.shapers.map((s) => [s.kind, s]));
// The add menu's families, for gsFxGroup: the kinds dealt round the families.
const FAMS = ['EQ & Compression', 'Reverb & Delay', 'Chorus & Phasing', 'Pitch & Motion', 'Noise & Generators', 'Spectral', 'Delay', 'Cassette', 'Stereo', 'Saturation'];
const ctx = vm.createContext({
  console, Math, JSON, Map, Set, Number, String, Array, Object, RegExp,
  state: { shapers, rack: {} },
  document: { createElement: (t) => new El(t) },
  engine: { deviceRate: 48000, spectrum: [] },
  liveParam: () => {}, commitRack: () => {}, pushRack: () => {}, uiBarOver: () => {}, requestAnimationFrame: () => {},
  GS: {},
  SLOT_META: {},
  fxPickerKinds: () => FAMS.map((group, g) => ({ group, items: api.shapers.filter((_, i) => i % (FAMS.length + 1) === g).map((s) => ({ kind: s.kind })) })),
});
const run = (f) => vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
for (const f of ['ui/grain-glyphs.js', 'ui/app/071-rack-controls.js', 'ui/app/072-rack-knob.js', 'ui/app/073a-ui-knob.js', 'ui/app/075-fx-faces.js',
  'ui/app/075b-fx-face-kinds.js', 'ui/app/076-fx-suites.js', 'ui/app/404-grain-rack.js']) run(f);
// eqBorn, from 070 (that file's top level needs the whole app).
const src070 = fs.readFileSync(path.join(root, 'ui/app/070-rack.js'), 'utf8');
vm.runInContext(src070.slice(src070.indexOf('function eqBorn('), src070.indexOf('}', src070.indexOf('function eqBorn(')) + 1), ctx);
// paintSel's specs, from 075b's text, as a function of the band and the selection.
const src075b = fs.readFileSync(path.join(root, 'ui/app/075b-fx-face-kinds.js'), 'utf8');
const specsAt = src075b.indexOf('const specs = [', src075b.indexOf('const paintSel'));
const specsText = src075b.slice(specsAt + 'const specs = '.length, src075b.indexOf('];', specsAt) + 1);
vm.runInContext(`var __eqSelSpecs = (b, sel) => { const passOrNotch = (b) => ['highpass', 'lowpass', 'notch'].includes(b.type); return ${specsText}; };`, ctx);

const J = vm.runInContext(`({ FXP, fxModel, fxIsSwitch, fxIsLog, fxUnit, fxFromUnit, fxClamp, fxFormat, fxShort, fxFamilyColour, fxTwin, fxPanelOf, fxRange,
  fxValueFormat, automationUnit, unitValue, fitLabel, digits, fxRoleGroups, fxDynamicsFace, fxMaximizerFace, fxEqFace, fxEqBands, fxDeckFace, fxInputDb,
  fxKnob, fxFader, fxSlider, fxTile, fxShDial, fxShSwitch, fxLexKnob, fxLexImpulse, fxLexiconFace, fxDecorateRow, fxAdvanced, FX_SH_HUE,
  uiArc, uiRingGeo, uiKnobHtml, uiKnobPaint, uiPic, gsMixGlyph, gsLevelGlyph, GS_GICON, gsRackIcon, gsFkIcon, gsFxGroup, defaultEqBands,
  eqSelSpecs: __eqSelSpecs, engine })`, ctx);
const { FXP } = J;

const cases = [];
const add = (cat, o) => cases.push({ cat, ...o });
const clone = (x) => JSON.parse(JSON.stringify(x));
const NS = [0, 0.13, 0.5, 0.77, 1];
const specs = api.shapers.flatMap((s) => s.params.map((p) => ({ kind: s.kind, p })));

// ── the kit's numbers and every picture ──────────────────────────────────────
// Pictures, for every control that gets each one and a bare one.
const byPic = new Map();
for (const { p } of specs) {
  const k = J.FXP.picFor(p);
  add('picFor', { p, out: k });
  if (!byPic.has(k)) byPic.set(k, []);
  const seen = byPic.get(k);
  if (!seen.some((q) => q.key === p.key && q.label === p.label && q.unit === p.unit && q.max === p.max)) seen.push(p);
}
const extraP = [{ key: 'mix', label: 'Dry / Wet', min: 0, max: 1 }, { key: 'x', label: 'X (right)', min: -1, max: 1, unit: '' }, { key: 'cp3', label: 'CP3', min: 0, max: 1, unit: '' },
  { key: 'k', label: 'M3', min: 0, max: 1, unit: '' }, { key: 'k', label: 'Octave', min: 0, max: 1, unit: '' }, { key: 'k', label: 'Tap 2 att.', min: 0, max: 1, unit: '' },
  { key: 'detune', label: 'Detune', min: -100, max: 100, unit: 'ct' }, { key: 'pitch', label: 'Pitch', min: -24, max: 24, unit: 'st' }];
for (const name of Object.keys(FXP.PIC)) {
  const ps = [null, ...(byPic.get(name) || []).slice(0, 6), ...extraP.filter((p) => FXP.picFor(p) === name || name === 'pitch' || name === 'interval' || name === 'harmonic' || name === 'taplevel' || name === 'xy')];
  for (const p of ps) {
    for (const n of NS) {
      const vs = p ? [J.unitValue(n, p.min, p.max, J.fxIsLog(p)), p.min, p.max, p.default ?? p.min] : [0, 1, 3.7, -5, 12, 997.5];
      for (const v of [...new Set(vs)]) {
        if (!Number.isFinite(v)) continue;
        let svg;
        try { svg = FXP.PIC[name](n, v, p); } catch { continue; }
        add('pic', { name, n, v, p, out: svg });
      }
    }
  }
}
for (const n of [0, 0.25, 0.5, 0.75, 1, 1.1, -0.1]) add('pic', { name: 'lfoShape', n, v: 0, p: null, out: (() => { try { return FXP.PIC.lfoShape(n); } catch { return ''; } })() });
for (const v of [0.1234, 1.005, 2.675, -3.14159, 1e-7, 123.456, 0.995, -0.004, 1e21 / 1e19]) add('N', { v, out: (Math.round(v * 100) / 100).toString() });
// Math.log and Math.log10 themselves (V8's fdlibm, which the port copies).
{
  let x = 0.7;
  const xs = [1, 2, 3, 10, 1000, 0.5, 1e-300, 1e300, 20, 3.0000000000000004, 0.1];
  for (let i = 0; i < 4000; i++) { x = (x * 9301 + 49297) % 233280; xs.push(x / 233280 * Math.pow(10, (i % 13) - 6), 1 + i / 4000, 20 * Math.pow(1000, i / 4000)); }
  for (const v of xs) add('log', { v, log: Math.log(v), log10: Math.log10(v) });
}
for (const s of [FXP.PIC.mix(0.3), FXP.PIC.level(0.5) + 'x<text a>b</text>y', 'no text', '<text>open']) add('noText', { s, out: FXP.noText(s) });
for (const [inner, cls] of [['<g/>', 'pic'], ['', 'x']]) add('svg', { inner, cls, out: FXP.svg(inner, cls) });

// ── every display, with every shaper that uses one ───────────────────────────
const valuesAt = (s, where) => Object.fromEntries(s.params.map((p, i) => [p.key, where === 'def' ? p.default : where === 'min' ? p.min : where === 'max' ? p.max
  : J.unitValue([0.13, 0.5, 0.77][i % 3], p.min, p.max, J.fxIsLog(p))]));
for (const s of api.shapers) {
  const key = FXP.heroFor(s.kind);
  add('heroFor', { kind: s.kind, out: key });
  if (!FXP.HERO[key]) continue;
  for (const where of ['def', 'min', 'max', 'mid']) {
    const slot = { kind: s.kind, id: 's1', params: valuesAt(s, where) };
    const m = J.fxModel(clone(slot));
    const v = m.values();
    add('hero', { key, v, out: FXP.HERO[key](v) });
    add('model', { slot, shaper: s, values: v, keys: m.specs.map((p) => p.key) });
    // The generic face's display (`fxDeckFace`'s hero, with its pad's mark).
    const twin = shapers[J.fxTwin(s.kind)];
    const panel = J.fxPanelOf(s.kind, new Set(m.specs.map((p) => p.key)));
    const box = new El(), el = new El();
    try {
      J.fxDeckFace(box, J.fxModel(clone(slot)), el);
      const hw = box.children.find((c) => c.classList.contains('fx-face-display'));
      add('deck', { slot, shaper: s, twin: twin ?? null, out: hw.hidden ? '' : hw.innerHTML, panelPad: panel?.pad ?? null });
    } catch (e) { console.error('deck', s.kind, e.message); }
  }
}
for (const key of Object.keys(FXP.HERO)) {
  add('hero', { key, v: {}, out: FXP.HERO[key]({}) });
  add('hero', { key, v: { feedback: -0.7, mix: 0.3, hz: 1000, sweep: 5, freeze: 1, size: 0.1, decay: 0.95, notches: 7, depth: 0.4, gainDb: -6, swap: 1, invert: 1, width: 1.6, semitones: -5, cents: 33, delayMs: 3, wet: 0.9 },
    out: FXP.HERO[key]({ feedback: -0.7, mix: 0.3, hz: 1000, sweep: 5, freeze: 1, size: 0.1, decay: 0.95, notches: 7, depth: 0.4, gainDb: -6, swap: 1, invert: 1, width: 1.6, semitones: -5, cents: 33, delayMs: 3, wet: 0.9 }) });
}
for (const kind of ['prism:echo', 'echo', 'prism:all-pass-diffuser', 'flanger', 'prism:dattorro-notch', 'nothing']) add('heroFor', { kind, out: FXP.heroFor(kind) });
for (const [u, w] of [[0, 0], [0.5, 0.5], [1, 1], [0.123, 0.987], [0.3333, 0.6667]]) add('padMark', { u, w, xl: 'Rate', yl: 'Depth', out: FXP.padMark(u, w, 'Rate', 'Depth') });
for (const [inner, fill] of [['<g/>', false], ['x', true]]) add('display', { inner, fill, out: FXP.display(inner, fill) });
for (let t = 0; t < 6; t++) for (const f of [20, 31.5, 100, 999, 1000, 4567.8, 20000]) for (const [f0, q, g] of [[1000, 0.71, 6], [80, 3, -12], [12000, 0.3, 18], [30000, 0.01, 0]]) {
  add('rbj', { type: t, f0, q, g, f, out: FXP.rbjDb(t, f0, q, g, f, 48000) });
}

// ── 075's helpers, on every control ──────────────────────────────────────────
const fmtVals = (p) => [...new Set([p.min, p.max, p.default ?? p.min, J.unitValue(0.37, p.min, p.max, J.fxIsLog(p)), J.unitValue(0.81, p.min, p.max, J.fxIsLog(p)), 999.5, 1000, 9.995, 0.5])];
for (const { kind, p } of specs) {
  add('spec', { p, isSwitch: J.fxIsSwitch(p), isLog: J.fxIsLog(p) });
  for (const v of fmtVals(p)) {
    add('format', { p, v, fxFormat: J.fxFormat(p, v), fxValueFormat: J.fxValueFormat(p, v), clamp: J.fxClamp(p, v) });
    const r = J.fxRange({ slot: { id: 'x' } }, p);
    add('unit', { p, v, unit: J.fxUnit(r, v), from: J.fxFromUnit(r, J.fxUnit(r, v)), auto: J.automationUnit(v, p.min, p.max, J.fxIsLog(p)), uv: J.unitValue(0.42, p.min, p.max, J.fxIsLog(p)) });
  }
  add('fitLabel', { s: p.label, out: J.fitLabel(p.label) });
  void kind;
}
for (const s of ['First tap (left)', 'Twelve-string — bright', 'Sixteenth note', 'Feedback one two', 'Abcdefghijkl', 'Reverberation time', 'Short']) add('fitLabel', { s, out: J.fitLabel(s) });
for (const s of api.shapers) {
  for (const g of s.panel?.groups || []) for (const k of g.keys) { const p = s.params.find((q) => q.key === k); if (p) add('short', { label: p.label, group: g.label || '', out: J.fxShort(p.label, g.label) }); }
  add('roles', { specs: s.params, out: J.fxRoleGroups(s.params) });
  add('colour', { kind: s.kind, out: J.fxFamilyColour(s.kind) });
  add('twin', { kind: s.kind, out: J.fxTwin(s.kind) });
}
for (const [l, g] of [['Low frequency', 'Low'], ['Stereo spread', ''], ['amplitude', 'Bands'], ['Air absorption', 'Air-x']]) add('short', { label: l, group: g, out: J.fxShort(l, g) });
for (const kind of ['eq', 'comp', 'gain', 'prism:gain', 'pn_noise', 'single-bit-pn', 'my_reverb', 'gate', 'unknown']) add('colour', { kind, out: J.fxFamilyColour(kind) });

// ── the controls' own markup ─────────────────────────────────────────────────
const modelOf = (s, where = 'def') => J.fxModel({ kind: s.kind, id: 's1', params: valuesAt(s, where) });
for (const s of api.shapers.filter((x) => !x.kind.startsWith('prism:sh-') && !x.kind.startsWith('prism:lxp-'))) {
  for (const where of ['def', 'min', 'max', 'mid']) {
    const m = modelOf(s, where);
    for (const p of m.specs) {
      const v = m.get(p.key);
      if (J.fxIsSwitch(p)) {
        const el = J.fxTile(m, p);
        add('tile', { p, v, out: el.querySelector('button').innerHTML });
      } else {
        const k = J.fxKnob(m, p);
        add('knobPic', { p, v, out: k.querySelector('.ui-pic').innerHTML });
        const sl = J.fxSlider(m, p);
        add('sliderPic', { p, v, out: sl.querySelector('.fxs-pic').innerHTML });
        const f = J.fxFader(m, p);
        add('fader', { u: J.fxUnit(J.fxRange(m, p), v), out: f.querySelector('.fxf-track').innerHTML });
      }
    }
    if (where === 'def') {
      const box = new El();
      J.fxAdvanced(box, m);
      for (const p of m.specs.filter((q) => !J.fxIsSwitch(q) && !q.choices)) {
        const row = box.children.find((r) => r.querySelector('.k').textContent.startsWith(p.label));
        if (row) add('advancedPic', { p, out: row.querySelector('.fxs-pic').innerHTML });
      }
    }
  }
}

// ── dynamics, maximizer ──────────────────────────────────────────────────────
const LEVELS = [null, -80, -72, -40.5, -18, -3, 0];
for (const kind of ['comp', 'prism:compressor', 'gate', 'prism:gate']) {
  const sh = kind === 'comp' ? shapers['prism:compressor'] : shapers[kind];
  if (!sh) continue;
  const gate = /^(prism:)?gate$/.test(kind);
  for (const where of ['def', 'min', 'max', 'mid']) {
    const vals = valuesAt(sh, where);
    const slot = kind === 'comp' ? { kind, id: 'c', ...vals } : { kind, id: 'c', params: vals };
    for (const level of LEVELS) {
      const box = new El(), el = new El();
      if (level === null) J.fxInputDb.delete(7); else J.fxInputDb.set(7, level);
      J.fxDynamicsFace(box, J.fxModel(clone(slot)), el, 7, gate);
      const mtr = (sel) => ({ h: box.querySelector(sel).querySelector('i').style.props['--h'], text: box.querySelector(sel).querySelector('em').textContent });
      add('dyn', { slot, shaper: sh, gate, level, curve: box.querySelector('.fx-dyn-curve').innerHTML, in: mtr('.in'), gr: mtr('.gr'), out: mtr('.out'),
        caret: box.querySelector('.fx-mtr.in i .fx-caret').style.top });
    }
  }
}
for (const kind of ['maximizer', 'prism:maximizer']) {
  const sh = shapers[kind];
  for (const where of ['def', 'min', 'max', 'mid']) {
    const slot = { kind, id: 'm', params: valuesAt(sh, where) };
    for (const level of LEVELS) {
      const box = new El(), el = new El();
      if (level === null) J.fxInputDb.delete(7); else J.fxInputDb.set(7, level);
      const m = J.fxModel(clone(slot));
      J.fxMaximizerFace(box, m, el, 7);
      const mtr = (sel) => ({ h: box.querySelector(sel).querySelector('i').style.props['--h'], text: box.querySelector(sel).querySelector('em').textContent });
      add('max', { v: m.values(), level, curve: box.querySelector('.fx-dyn-curve').innerHTML, in: mtr('.in'), gr: mtr('.gr'), out: mtr('.out'),
        caret: box.querySelector('.fx-mtr.out i').children[0].style.top });
    }
  }
}

// ── EQ ───────────────────────────────────────────────────────────────────────
const spec = [...Array(1025)].map((_, i) => Math.round(255 * Math.abs(Math.sin(i * 0.37)) * Math.exp(-i / 700)));
const eqSlots = [
  { kind: 'eq', id: 'e' },
  { kind: 'eq', id: 'e', bands: J.defaultEqBands().map((b, i) => ({ ...b, enabled: true, gainDb: (i - 3.5) * 2.7, q: 0.3 + i * 0.9, freq: b.freq * 1.13 })) },
  { kind: 'prism:eq', id: 'p', params: {} },
  { kind: 'prism:eq', id: 'p', params: Object.fromEntries([...Array(8)].flatMap((_, i) => [[`band.${i}.mode`, i % 6], [`band.${i}.enabled`, i % 3 ? 1 : 0], [`band.${i}.gainDb`, 12 - i * 3.3], [`band.${i}.q`, 0.5 + i], [`band.${i}.freq`, 25 * Math.pow(2.6, i)]])) },
];
for (const slot of eqSlots) {
  for (const sel of [0, 2, 5, 7]) for (const sp of [[], spec]) {
    J.engine.spectrum = sp;
    J.engine.deviceRate = sp.length ? 44100 : 48000;
    const box = new El(), el = new El();
    vm.runInContext('eqBandSelections', ctx).set(3, sel);
    const s2 = clone(slot);
    J.fxEqFace(box, s2, el, 3);
    const bands = J.fxEqBands(clone(slot)).bands();
    add('eq', { slot, shaper: shapers[slot.kind] ?? null, sel, fs: J.engine.deviceRate, spectrum: sp, bands, curve: box.querySelector('.fx-eq-disp').innerHTML,
      types: box.querySelector('.fx-eq-types').children.map((b) => ({ cls: b.className, html: b.innerHTML, title: b.title })),
      reads: box.querySelector('.fx-eq-read').children.map((r) => r.innerHTML),
      selSpecs: J.eqSelSpecs(bands[sel], sel) });
  }
}
J.engine.spectrum = [];
J.engine.deviceRate = 48000;

// ── SoundHack, Lexicon, Hyperprism ───────────────────────────────────────────
for (const s of api.shapers) {
  const isSh = s.kind.startsWith('prism:sh-') || s.kind === 'prism:spectral-dynamics' || s.kind === 'prism:convolution';
  const isLex = s.kind.startsWith('prism:lxp-');
  const isHp = s.kind.startsWith('prism:hp-');
  add('shHue', { kind: s.kind, out: J.FX_SH_HUE[s.kind.replace(/^prism:/, '')] || '#6fae3f' });
  for (const where of ['def', 'min', 'max', 'mid']) {
    const slot = { kind: s.kind, id: 'x', params: valuesAt(s, where) };
    for (const p of s.params) {
      const v = slot.params[p.key];
      if (isSh) {
        if (p.toggle) add('shSwitch', { p, v, out: J.fxShSwitch(clone(slot), p, () => {}).querySelector('button').innerHTML });
        else {
          const el = J.fxShDial(clone(slot), p, '#fff', () => {});
          add('shDial', { p, v, out: el.querySelector('.ui-pic').innerHTML });
          if (p.choices) for (let c = 0; c < p.choices.length; c++) {
            const val = p.min + c, pk = FXP.picFor(p);
            // 076's sh-choice line, as written there.
            add('shChoice', { p, v: val, out: FXP.svg(FXP.noText(FXP.PIC[pk](J.automationUnit(val, p.min, p.max), val, p))) });
          }
        }
      }
      if (isLex && !(p.toggle || (p.choices && p.choices.length <= 3))) {
        const el = J.fxLexKnob(clone(slot), p, () => {});
        add('lex', { p, v, ring: el.querySelector('.lex-ring').innerHTML, reading: el.querySelector('.v').textContent, pic: el.querySelector('.lex-pic').innerHTML });
      }
      if (isHp) {
        const row = new El();
        J.fxDecorateRow(row, p, () => v);
        add('decorate', { p, v, out: row.children[0].innerHTML });
      }
    }
    if (isHp) for (const [wet, dry] of [[1, 1], [1, 0.4], [0.3, 1], [0, 1]]) {
      const row = new El(), mp = { key: 'mix', label: 'Dry / Wet', min: 0, max: 1 };
      J.fxDecorateRow(row, mp, () => (wet >= 0.999 ? 1 - dry / 2 : wet / 2));
      add('hpMix', { wet, dry, out: row.children[0].innerHTML });
    }
    if (isLex) {
      add('lexImpulse', { v: slot.params, out: J.fxLexImpulse(slot.params) });
      const box = new El();
      box.closest = () => new El();
      created.length = 0;
      J.fxLexiconFace(box, clone(slot), s, Object.fromEntries(s.params.map((p) => [p.key, p])), s.panel.groups, null, {}, () => {});
      const pic = created.find((e) => e.classList.contains('lex-impulse'));
      add('lexPicture', { v: slot.params, rt: s.params.find((p) => p.key === 'reverbTimeS') ?? null, out: pic.innerHTML });
    }
  }
}
for (const v of [{}, { reverbTimeS: 0.05, sizeM: 100, tapSlope: -10, predelayMs: 600 }, { reverbTimeS: 19, sizeM: 2, tapSlope: 10 }]) {
  add('lexImpulse', { v, out: J.fxLexImpulse(v) });
}

// ── the shared knob ──────────────────────────────────────────────────────────
for (const s of [26, 44, 64]) for (const [u0, u1] of [[0, 1], [0, 0.0004], [0.1, 0.9], [0.5, 0.5003], [0.25, 0.75], [0, 0.6667], [0.3333, 1]]) {
  for (const r of [uiRG(s).r, uiRG(s).mr]) add('uiArc', { c: s / 2, r, u0, u1, out: J.uiArc(s / 2, r, u0, u1) });
}
function uiRG(s) { return J.uiRingGeo(s); }
for (const size of [26, 44, 64]) for (const face of [undefined, true, false]) for (const [inner, cls] of [['', ''], ['<b/>', 'fxk']]) {
  add('uiKnobHtml', { size, face: face ?? null, inner, cls, out: J.uiKnobHtml({ size, face, inner, cls }) });
}
for (const [inner, vb, cls] of [['<g/>', '0 0 64 48', ''], ['', '0 0 40 20', 'side']]) add('uiPic', { inner, vb, cls, out: J.uiPic(inner, vb, cls) });
/// The ring as the DOM holds it after `uiKnobPaint`: the tags `uiKnobHtml`
/// wrote, each attribute in the order it was set, hidden ones left out.
function ringBody(size, st) {
  const html = J.uiKnobHtml({ size });
  const inner = html.slice(html.indexOf('aria-hidden="true">', html.indexOf('ui-ring')) + 19, html.indexOf('</svg>'));
  const els = [...inner.matchAll(/<(\w+)([^>]*?)\/>/g)].map(([, tag, a]) => {
    const e = new El(tag);
    for (const [, k, v] of a.matchAll(/([\w-]+)="([^"]*)"/g)) e.setAttribute(k, v);
    e.cls = e.getAttribute('class');
    return e;
  });
  const svgEl = new El('svg');
  svgEl.viewBox = { baseVal: { width: size } };
  svgEl.querySelector = (sel) => els.find((e) => '.' + e.cls === sel) || null;
  const kn = new El();
  kn.querySelector = (sel) => (sel === ':scope > .ui-ring' ? svgEl : sel === ':scope > .ui-cap' ? new El() : null);
  J.uiKnobPaint(kn, st);
  return els.filter((e) => e.style.display !== 'none').map((e) => `<${e.tagName.toLowerCase()} ${e.attrs.map(([k, v]) => `${k}="${v}"`).join(' ')}/>`).join('');
}
const RS = [];
for (const size of [26, 44, 64]) for (const u of [0, 0.0003, 0.25, 0.5, 0.731, 1, 1.2]) for (const bip of [false, true]) for (const pointer of [false, true]) {
  RS.push({ size, st: { u, bip, pointer } });
  RS.push({ size, st: { u, bip, pointer, def: 0.5 } });
}
for (const size of [26, 44]) for (const u of [0.1, 0.5, 0.95]) for (const mod of [{ rng: 0.2, live: 0.3, col: '#f0f' }, { rng: 0.05 }, { rng: 0 }, { rng: 0.5, live: 1.3, col: '' }]) RS.push({ size, st: { u, mod, def: 0.2 } });
for (const { size, st } of RS) {
  const kn = new El();
  const els = {};
  const svgEl = new El('svg');
  svgEl.viewBox = { baseVal: { width: size } };
  svgEl.querySelector = (sel) => (els[sel] ||= new El());
  kn.querySelector = (sel) => (sel === ':scope > .ui-ring' ? svgEl : sel === ':scope > .ui-cap' ? (els.cap ||= new El()) : null);
  J.uiKnobPaint(kn, st);
  const at = (k) => Object.fromEntries((els[k]?.attrs || []).map(([a, b]) => [a, b]));
  add('uiPaint', { size, st, ar: at('.ui-ar').d, capV: els.cap.style.props['--v'], md: at('.ui-md').d, mc: kn.style.props['--mc'] ?? '', modClass: kn.classList.contains('mod'),
    live: els['.ui-live'].style.display === 'none' ? null : at('.ui-live'), ptr: els['.ui-ptr'].style.display === 'none' ? null : at('.ui-ptr'), dn: els['.ui-dn'] ? at('.ui-dn') : null,
    body: ringBody(size, st) });
}

// ── Grain's rack ─────────────────────────────────────────────────────────────
for (let i = 0; i <= 20; i++) { const v = i / 20; add('gsMix', { v, out: J.gsMixGlyph(v) }); }
for (const v of [-24, -20.5, -12, -6, 0, 0.3, 6, 12, 13]) add('gsLevel', { v, out: J.gsLevelGlyph(v) });
for (const s of api.shapers) add('gsRack', { kind: s.kind, group: J.gsFxGroup(s.kind), out: J.gsRackIcon(s.kind) });
for (const g of [...Object.keys(J.GS_GICON), 'Nothing']) add('gsGroup', { group: g, out: J.GS_GICON[g] ?? '' });
for (const { p } of specs) add('gsFk', { label: p.label, out: J.gsFkIcon(p.label) ?? '' });

/// JSON, but each number below 1 in its exponent form: juce::JSON counts the
/// zeros after a decimal point among the 18 digits it keeps, so it would cut
/// the last digits off a small number written out in full.
function ser(x) {
  if (x === null || x === undefined) return 'null';
  if (typeof x === 'number') return !Number.isFinite(x) ? 'null' : x !== 0 && Math.abs(x) < 1 ? x.toExponential() : String(x);
  if (typeof x !== 'object') return JSON.stringify(x);
  if (Array.isArray(x)) return `[${x.map(ser).join(',')}]`;
  return `{${Object.entries(x).filter(([, v]) => v !== undefined && typeof v !== 'function').map(([k, v]) => `${JSON.stringify(k)}:${ser(v)}`).join(',')}}`;
}
fs.writeFileSync(out, ser({ node: process.version, api, picNames: Object.keys(FXP.PIC), heroKeys: Object.keys(FXP.HERO), cases }));
const counts = {};
for (const c of cases) counts[c.cat] = (counts[c.cat] || 0) + 1;
console.log(`${cases.length} cases -> ${out}`);
console.log(counts);

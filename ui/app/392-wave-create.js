// ================================================================ Wave: Create
//
// The table maker. Draw a frame, paint its harmonics, process one frame or all
// of them, fill between keyframes, or slice a sound from the library. Every
// edit is the oscillator's own table, sent whole to `POST /api/wave/table`
// when the stroke ends or the button is pressed, and the engine rebuilds its
// band-limited copy off the audio thread.

const WV_ED = { osc: 0, frame: 44, keys: new Set([0, 63]), tool: 'pen', scopeAll: false, snap: 16, importMode: 'count', grain: true };
const WV_UNDO = [];

const WV_TOOLS = [
  ['pen', 'M3 15 L13 5 L15 7 L5 17 Z M3 15 L2 18 L5 17', 'Draw'], ['line', 'M3 15 L15 3', 'Line'],
  ['curve', 'M3 15 C3 5,15 13,15 3', 'Curve'], ['pts', 'M3 14 L8 6 L12 11 L16 4', 'Points'],
  ['erase', 'M4 12 L10 6 L15 11 L11 15 H6 Z', 'Smooth'], ['sine', 'M2 9 C5 1,7 1,9 9 S13 17,16 9', 'Stamp sine'],
  ['saw', 'M2 15 L16 3 V15', 'Stamp saw'], ['sq', 'M2 4 H9 V14 H16', 'Stamp square'],
];
const WV_OP_NAMES = [['norm', 'Normalise'], ['dc', 'Remove DC'], ['flip', 'Flip'], ['rev', 'Reverse'], ['smooth', 'Smooth'], ['fold', 'Fold'],
  ['redux', 'Redux'], ['nofund', 'No fundamental'], ['odd', 'Odd only'], ['bright', 'Brighter'], ['dark', 'Darker'], ['align', 'Align phase']];

const wvSpecMap = (f, fn) => { const s = wvSpectrum(f, 48); fn(s); return wvNorm(wvFromSpectrum(s.re, s.im)); };
const WV_OPS = {
  norm: (f) => wvNorm(f.slice()),
  dc: (f) => { const m = f.reduce((a, b) => a + b, 0) / WV_NP; return f.map((v) => v - m); },
  flip: (f) => f.map((v) => -v),
  rev: (f) => f.slice().reverse(),
  smooth: (f) => f.map((v, i) => (f[(i - 2 + WV_NP) % WV_NP] + f[(i - 1 + WV_NP) % WV_NP] + v + f[(i + 1) % WV_NP] + f[(i + 2) % WV_NP]) / 5),
  fold: (f) => f.map((v) => { let y = v * 1.8; while (Math.abs(y) > 1) y = y > 1 ? 2 - y : -2 - y; return y; }),
  redux: (f) => f.map((v, i) => f[i - i % 8]),
  nofund: (f) => wvSpecMap(f, (s) => { s.re[0] = 0; s.im[0] = 0; }),
  odd: (f) => wvSpecMap(f, (s) => { for (let k = 1; k < 48; k += 2) { s.re[k] = 0; s.im[k] = 0; } }),
  bright: (f) => wvSpecMap(f, (s) => { for (let k = 0; k < 48; k++) { s.re[k] *= 1 + k * 0.06; s.im[k] *= 1 + k * 0.06; } }),
  dark: (f) => wvSpecMap(f, (s) => { for (let k = 0; k < 48; k++) { s.re[k] /= 1 + k * 0.15; s.im[k] /= 1 + k * 0.15; } }),
  align: (f) => wvSpecMap(f, (s) => { for (let k = 0; k < 48; k++) { const m = Math.hypot(s.re[k], s.im[k]); s.re[k] = 0; s.im[k] = m; } }),
};

function wvBuildCreate(view) {
  view.appendChild(wvH(`<div class="wv-panel wv-tools" id="wvTools">${WV_TOOLS.map(([k, d, t], i) =>
    `<div class="wv-tool wv-btn ${i === 0 ? 'on' : ''}" title="${t}" data-tool="${k}"><svg viewBox="0 0 18 18"><path d="${d}"/></svg></div>`).join('')}</div>`));
  view.appendChild(wvH(`<div class="wv-ccol"><div class="wv-mod wv-panel">
   <div class="wv-mh"><span class="wv-nm">OSC A · FRAME</span><span class="wv-pick wv-btn" id="wvCTable" style="width:190px" title="Choose the table to edit"><span id="wvCTableName"></span></span>
    <span class="wv-ro" id="wvCTool" style="color:var(--wv-acc)">Draw</span><span class="wv-sp"></span>
    <div class="wv-seg" id="wvSnap"><span data-k="0" title="Free">${wvIc('M1 8 C4 1,9 9,13 2')}Free</span><span data-k="16" title="Snap to 16 steps">${wvIc('M1 8 H4 V5 H8 V2 H13')}Snap 16</span><span data-k="32" title="Snap to 32 steps">${wvIc('M1 8 H3 V6 H5 V4 H7 V3 H9 V2 H13')}Snap 32</span></div>
    <span class="wv-ro" id="wvCFrameRo"></span></div>
   <div class="wv-well"><canvas id="wvCWave" data-w="852" data-h="380" title="Draw the frame"></canvas></div>
   <div class="wv-lab"><span>Harmonics: drag a bar for its level, Shift-drag for its phase</span><b id="wvCHarmRo"></b></div>
   <div class="wv-well"><canvas id="wvCHarm" data-w="852" data-h="112"></canvas></div>
   <div class="wv-lab"><span>Frames: click to edit, ◆ marks a keyframe (double-click or Alt-click)</span><b>Morph between keyframes ↓</b></div>
   <div class="wv-well"><canvas id="wvCStrip" data-w="852" data-h="82"></canvas></div></div></div>`));
  view.appendChild(wvH(`<div class="wv-rcol">
   <div class="wv-mod wv-panel"><div class="wv-mh"><span class="wv-nm">TABLE</span><span class="wv-sp"></span><span class="wv-ro" id="wvCTableRo"></span></div><div class="wv-well"><canvas id="wvC3d" data-w="468" data-h="130"></canvas></div></div>
   <div class="wv-mod wv-panel"><div class="wv-mh"><span class="wv-nm">PROCESS</span><div class="wv-seg" id="wvScope"><span class="on" data-k="one" title="This frame only">${wvIc('M5 1 H9 V9 H5 Z')}This frame</span><span data-k="all" title="Every frame">${wvIc('M1 1 H4 V9 H1 Z M5.5 1 H8.5 V9 H5.5 Z M10 1 H13 V9 H10 Z')}All frames</span></div></div>
    <div class="wv-ops" id="wvOps">${WV_OP_NAMES.map(([k, n]) => `<div class="wv-op wv-btn" data-op="${k}" title="${n}"><svg viewBox="0 0 30 18" id="wvOpg-${k}"></svg>${n}</div>`).join('')}</div></div>
   <div class="wv-mod wv-panel"><div class="wv-mh"><span class="wv-nm">MORPH FILL</span><span class="wv-sp"></span><span class="wv-hint">Fill between ◆</span></div>
    <div class="wv-ops three" id="wvMorphs">${[['xf', 'Crossfade'], ['spec', 'Spectral'], ['zero', 'Zero phase']].map(([k, n]) => `<div class="wv-op wv-btn" data-morph="${k}" title="${n}"><svg viewBox="0 0 30 18" id="wvMog-${k}"></svg>${n}</div>`).join('')}</div></div>
   <div class="wv-mod wv-panel">
    <div class="wv-mh"><span class="wv-nm">FROM THE LIBRARY</span></div>
    <div class="wv-lib wv-well"><canvas id="wvLibWave" data-w="140" data-h="34"></canvas><div style="flex:1;min-width:0"><div class="nm2" id="wvLibName">No sound chosen</div><div class="wv-hint" id="wvLibInfo">Select one in the library, then Choose</div></div>
     <span class="wv-chip wv-btn" id="wvLibChoose" title="Slice the library's selected sound into this table">${wvIc('M7 1 V9 M3 5 L7 9 L11 5')}Choose…</span></div>
    <div class="wv-frow"><div class="wv-seg" id="wvImportMode"><span data-k="count" title="A fixed number of frames">${wvIc('M1 2 V8 M5 2 V8 M9 2 V8 M13 2 V8')}By count</span><span data-k="note" title="A frame per note">${wvIc('M4 8 A2 2 0 1 1 4 7.9 M6 8 V1 L11 2')}By note</span><span data-k="pitch" title="Frames follow the pitch">${wvIc('M1 8 C4 8,5 2,8 2 S12 6,13 4')}Follow pitch</span><span data-k="spectral" title="Spectral slices">${wvIc('M2 9V3M5 9V1M8 9V4M11 9V6')}Spectral</span></div>
     <span class="wv-chip wv-btn on" id="wvThroughGrain" title="Bake the loop through the grain engine first">${wvIc('M3 7 A1 1 0 1 1 3 6.9 M7 4 A1 1 0 1 1 7 3.9 M11 7 A1 1 0 1 1 11 6.9')}Through Grain</span></div>
    <div class="wv-formula wv-well"><span>f(x) =</span>sin(x·2π)·(1−y) + saw(x)·y<span class="wv-sp"></span><span>y = frame</span></div></div></div>`));
}

/// The table being edited, as frames the page owns.
function wvEditFrames() {
  const name = wvG(`osc${WV_ED.osc}.table`);
  if (!WV.tables[name]) WV.tables[name] = wvBuiltinTable(name).map((f) => f.slice());
  // A table from the engine may have fewer frames than the one before it.
  WV_ED.frame = Math.max(0, Math.min(WV_ED.frame, WV.tables[name].length - 1));
  return WV.tables[name];
}

function wvPushUndo() {
  WV_UNDO.push({ name: wvG(`osc${WV_ED.osc}.table`), frames: wvEditFrames().map((f) => f.slice()) });
  if (WV_UNDO.length > 40) WV_UNDO.shift();
}

function wvUndo() {
  const u = WV_UNDO.pop();
  if (!u) return;
  WV.tables[u.name] = u.frames;
  wvSpecCache.clear();
  wvSaveTable();
}

/// Send the edited table. The engine answers with the name it stored it under,
/// which the oscillator then uses.
async function wvSaveTable() {
  wvSpecCache.clear();
  const name = wvG(`osc${WV_ED.osc}.table`);
  const frames = wvEditFrames().map((f) => Array.from(f, (v) => Math.round(v * 1e5) / 1e5));
  const j = await wvPost('/api/wave/table', { name, frames });
  if (j && typeof j.name === 'string' && j.name && j.name !== name) {
    WV.tables[j.name] = WV.tables[name];
    wvCommit(`osc${WV_ED.osc}.table`, j.name);
  }
}

function wvWireCreate() {
  document.querySelectorAll('#wvTools [data-tool]').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.tool;
    if (['sine', 'saw', 'sq'].includes(k)) { wvStamp(k); return; }
    WV_ED.tool = k;
    wvTxt('wvCTool', b.title);
    document.querySelectorAll('#wvTools [data-tool]').forEach((x) => x.classList.toggle('on', x === b));
  }));
  $('wvCTable').addEventListener('click', (e) => wvTableMenu(e.currentTarget, WV_ED.osc));

  // Drawing. Line and Curve redraw from where the stroke began, so the shape
  // follows the pointer until it is let go.
  const ce = WVW.wvCWave;
  let last = null, start = null, before = null;
  const at = (e) => {
    const [x, y] = wvLocal(ce.el, e), u = wvClamp((x - 10) / (ce.w - 20)), v = wvClamp(1 - (y - 10) / (ce.h - 20)) * 2 - 1;
    const q = WV_ED.snap;
    return [Math.round(u * (WV_NP - 1)), q ? Math.round(v * q / 2) / (q / 2) : v];
  };
  const paint = (e) => {
    const f = wvEditFrames()[WV_ED.frame], [i, vv] = at(e);
    if (WV_ED.tool === 'erase') {
      for (let k = -6; k <= 6; k++) { const j = (i + k + WV_NP) % WV_NP; f[j] = (f[(j - 1 + WV_NP) % WV_NP] + f[j] * 2 + f[(j + 1) % WV_NP]) / 4; }
    } else if (WV_ED.tool === 'line' || WV_ED.tool === 'curve') {
      f.set(before);
      const [a, b] = start, s = Math.min(a, i), e2 = Math.max(a, i);
      for (let j = s; j <= e2; j++) {
        let u = (j - a) / ((i - a) || 1);
        if (WV_ED.tool === 'curve') u = 0.5 - 0.5 * Math.cos(Math.PI * u);
        f[j] = b + (vv - b) * u;
      }
    } else if (last && WV_ED.tool === 'pen') {
      const [a, b] = last, s = Math.min(a, i), e2 = Math.max(a, i);
      for (let j = s; j <= e2; j++) f[j] = b + (vv - b) * ((j - a) / ((i - a) || 1));
      last = [i, vv];
    } else { f[i] = vv; last = [i, vv]; }
  };
  wvDrag(ce.el, (dx, dy, e) => paint(e), (e) => {
    wvPushUndo();
    last = null;
    start = at(e);
    before = wvEditFrames()[WV_ED.frame].slice();
    paint(e);
  }, () => { last = null; wvSaveTable(); });

  const hc = WVW.wvCHarm;
  let hk = -1;
  const setH = (e) => {
    if (hk < 0 || hk >= 48) return;
    const f = wvEditFrames()[WV_ED.frame], sp = wvSpectrum(f, 48), [, y] = wvLocal(hc.el, e);
    let nm = Math.hypot(sp.re[hk], sp.im[hk]), nph = Math.atan2(sp.im[hk], sp.re[hk]);
    if (e.shiftKey) nph = (1 - wvClamp(y / hc.h)) * WV_TAU - Math.PI;
    else nm = wvClamp(1 - (y - 6) / (hc.h - 12)) ** 2;
    sp.re[hk] = nm * Math.cos(nph);
    sp.im[hk] = nm * Math.sin(nph);
    f.set(wvNorm(wvFromSpectrum(sp.re, sp.im)));
  };
  wvDrag(hc.el, (dx, dy, e) => setH(e), (e) => {
    wvPushUndo();
    hk = Math.floor((wvLocal(hc.el, e)[0] - 6) / ((hc.w - 12) / 48));
    setH(e);
  }, () => wvSaveTable());

  const sc = WVW.wvCStrip;
  const frameAt = (e) => { const n = wvEditFrames().length; return wvClamp(Math.round((wvLocal(sc.el, e)[0] - 6) / ((sc.w - 12) / n) - 0.5), 0, n - 1); };
  const toggleKey = (i) => { if (WV_ED.keys.has(i)) WV_ED.keys.delete(i); else WV_ED.keys.add(i); };
  wvDrag(sc.el, null, (e) => {
    const i = frameAt(e);
    if (e.altKey) { toggleKey(i); return; }
    WV_ED.frame = i;
    wvLive(`osc${WV_ED.osc}.pos`, i / (wvEditFrames().length - 1));
  });
  sc.el.addEventListener('dblclick', (e) => toggleKey(frameAt(e)));

  document.querySelectorAll('#wvScope span').forEach((s) => s.addEventListener('click', () => {
    document.querySelectorAll('#wvScope span').forEach((x) => x.classList.toggle('on', x === s));
    WV_ED.scopeAll = s.dataset.k === 'all';
  }));
  document.querySelectorAll('#wvSnap span').forEach((s) => s.addEventListener('click', () => {
    WV_ED.snap = +s.dataset.k;
    document.querySelectorAll('#wvSnap span').forEach((x) => x.classList.toggle('on', x === s));
  }));
  document.querySelectorAll('#wvOps [data-op]').forEach((b) => b.addEventListener('click', () => {
    wvPushUndo();
    const T = wvEditFrames();
    (WV_ED.scopeAll ? T : [T[WV_ED.frame]]).forEach((f) => f.set(WV_OPS[b.dataset.op](f)));
    wvFlash(b);
    wvSaveTable();
  }));
  document.querySelectorAll('#wvMorphs [data-morph]').forEach((b) => b.addEventListener('click', () => {
    wvPushUndo();
    wvMorphFill(b.dataset.morph);
    wvFlash(b);
    wvSaveTable();
  }));
  document.querySelectorAll('#wvImportMode span').forEach((s) => s.addEventListener('click', () => {
    WV_ED.importMode = s.dataset.k;
    document.querySelectorAll('#wvImportMode span').forEach((x) => x.classList.toggle('on', x === s));
  }));
  $('wvThroughGrain').addEventListener('click', (e) => {
    WV_ED.grain = !WV_ED.grain;
    e.currentTarget.classList.toggle('on', WV_ED.grain);
  });
  $('wvLibChoose').addEventListener('click', wvImportFromLibrary);
  document.querySelector(`#wvSnap [data-k="${WV_ED.snap}"]`).classList.add('on');
  document.querySelector(`#wvImportMode [data-k="${WV_ED.importMode}"]`).classList.add('on');
  wvOpGlyphs();
}

/// Slice the library's selected sound into a table, and give it to osc A.
async function wvImportFromLibrary() {
  const f = state.selectedFile;
  if (!f) {
    toast('Select a sound in the library first');
    openDrawer();
    return;
  }
  const name = f.name.replace(/\.[^.]+$/, '');
  const j = await wvPost('/api/wave/table/import', { sound: f.path, name, mode: WV_ED.importMode, frames: 64, grain: WV_ED.grain });
  if (!j || !Array.isArray(j.frames)) { toast(WV.connected ? 'The engine could not slice that sound' : 'The synth engine is not connected'); return; }
  const stored = j.name || name;
  WV.tables[stored] = j.frames.map((fr) => (fr.length === WV_NP ? Float32Array.from(fr) : wvResample(fr)));
  wvCommit(`osc${WV_ED.osc}.table`, stored);
  WV_ED.frame = 0;
}

function wvFlash(b) {
  b.animate([{ filter: 'brightness(1.8)' }, { filter: 'none' }], { duration: 350 });
}

function wvStamp(k) {
  wvPushUndo();
  const f = wvEditFrames()[WV_ED.frame];
  for (let n = 0; n < WV_NP; n++) {
    const x = n / WV_NP;
    f[n] = k === 'sine' ? Math.sin(WV_TAU * x) : k === 'saw' ? 1 - 2 * x : x < 0.5 ? 1 : -1;
  }
  wvSaveTable();
}

function wvMorphFill(kind) {
  const T = wvEditFrames(), ks = [...WV_ED.keys].filter((k) => k < T.length).sort((a, b) => a - b);
  for (let q = 1; q < ks.length; q++) {
    const a = ks[q - 1], b = ks[q], A = T[a], B = T[b], sa = wvSpectrum(A, 48), sb = wvSpectrum(B, 48);
    for (let i = a + 1; i < b; i++) {
      const u = (i - a) / (b - a);
      if (kind === 'xf') { for (let n = 0; n < WV_NP; n++) T[i][n] = A[n] * (1 - u) + B[n] * u; continue; }
      const re = new Float32Array(48), im = new Float32Array(48);
      for (let k = 0; k < 48; k++) {
        const m = Math.hypot(sa.re[k], sa.im[k]) * (1 - u) + Math.hypot(sb.re[k], sb.im[k]) * u;
        const ph = kind === 'zero' ? Math.PI / 2 : Math.atan2(sa.im[k], sa.re[k]) * (1 - u) + Math.atan2(sb.im[k], sb.re[k]) * u;
        re[k] = m * Math.cos(ph);
        im[k] = m * Math.sin(ph);
      }
      T[i].set(wvNorm(wvFromSpectrum(re, im)));
    }
  }
}

/// Each process drawn as what it does: a wave before, faint, and after.
function wvOpGlyphs() {
  const base = wvNorm(new Float32Array(WV_NP).map((_, n) => Math.sin(WV_TAU * n / WV_NP) + 0.5 * Math.sin(WV_TAU * 2 * n / WV_NP + 0.6)
    + 0.33 * Math.sin(WV_TAU * 3 * n / WV_NP) + 0.25 * Math.sin(WV_TAU * 5 * n / WV_NP + 1) + 0.2));
  const toD = (a) => { let d = ''; for (let i = 0; i <= 40; i++) d += (i ? 'L' : 'M') + (2 + i / 40 * 26).toFixed(1) + ' ' + (9 - wvRd(a, i / 40) * 6.5).toFixed(1); return d; };
  for (const k in WV_OPS) {
    const s = document.getElementById('wvOpg-' + k);
    if (s) s.innerHTML = `<path class="gh" d="${toD(base)}"/><path d="${toD(WV_OPS[k](base))}"/>`;
  }
  const A = new Float32Array(WV_NP).map((_, n) => Math.sin(WV_TAU * n / WV_NP)), B = new Float32Array(WV_NP).map((_, n) => 1 - 2 * n / WV_NP);
  for (const k of ['xf', 'spec', 'zero']) {
    let d = '';
    for (let r = 0; r < 4; r++) {
      const u = r / 3;
      let f;
      if (k === 'xf') f = A.map((v, n) => v * (1 - u) + B[n] * u);
      else {
        const sa = wvSpectrum(A, 24), sb = wvSpectrum(B, 24), re = new Float32Array(24), im = new Float32Array(24);
        for (let q = 0; q < 24; q++) {
          const m = Math.hypot(sa.re[q], sa.im[q]) * (1 - u) + Math.hypot(sb.re[q], sb.im[q]) * u;
          const ph = k === 'zero' ? Math.PI / 2 : Math.atan2(sa.im[q], sa.re[q]) * (1 - u) + Math.atan2(sb.im[q], sb.re[q]) * u;
          re[q] = m * Math.cos(ph);
          im[q] = m * Math.sin(ph);
        }
        f = wvNorm(wvFromSpectrum(re, im));
      }
      for (let i = 0; i <= 20; i++) d += (i ? 'L' : 'M') + (2 + r * 1.5 + i / 20 * 20).toFixed(1) + ' ' + (13 - r * 2.6 - wvRd(f, i / 20) * 3).toFixed(1);
    }
    const s = document.getElementById('wvMog-' + k);
    if (s) s.innerHTML = `<path d="${d}"/>`;
  }
}

function wvDrawLibWave() {
  const g = WVW.wvLibWave, cl = wvCl(), c = g.c;
  c.clearRect(0, 0, g.w, g.h);
  let s = 3;
  c.fillStyle = `rgba(${cl.bloom},.55)`;
  for (let x = 0; x < g.w; x += 2) {
    s = (s * 16807) % 2147483647;
    const env = Math.exp(-x / 60) * 0.8 + 0.2 * Math.sin(x / 9) ** 2, a = env * (0.4 + 0.6 * (s / 2147483647)) * g.h * 0.45;
    c.fillRect(x, g.h / 2 - a, 1.4, a * 2);
  }
  c.fillStyle = cl.acc;
  c.fillRect(g.w * 0.55, 2, g.w * 0.03, g.h - 4);
}

function wvSyncCreate() {
  wvTxt('wvCTableName', wvG(`osc${WV_ED.osc}.table`));
  const f = typeof state !== 'undefined' ? state.selectedFile : null;
  wvTxt('wvLibName', f ? f.name : 'No sound chosen');
  wvTxt('wvLibInfo', f ? (f.duration ? `${f.duration.toFixed(1)} s · ${(f.sampleRate / 1000 || 0).toFixed(1)} kHz` : 'From the library') : 'Select one in the library, then Choose');
}

function wvDrawCreate(t) {
  const T = wvEditFrames(), n = T.length;
  WV_ED.frame = Math.min(WV_ED.frame, n - 1);
  const f = T[WV_ED.frame], g = WVW.wvCWave, { c, w, h } = g, cl = wvCl();
  c.clearRect(0, 0, w, h);
  c.strokeStyle = 'rgba(255,255,255,.045)';
  c.lineWidth = 1;
  for (let i = 0; i <= 16; i++) { const x = 10 + i * (w - 20) / 16; c.beginPath(); c.moveTo(x, 6); c.lineTo(x, h - 6); c.stroke(); }
  for (let i = 0; i <= 8; i++) { const y = 10 + i * (h - 20) / 8; c.beginPath(); c.moveTo(6, y); c.lineTo(w - 6, y); c.stroke(); }
  c.strokeStyle = 'rgba(255,255,255,.12)';
  c.beginPath(); c.moveTo(6, h / 2); c.lineTo(w - 6, h / 2); c.stroke();
  const yv = (v) => 10 + (1 - (v + 1) / 2) * (h - 20);
  for (const nb of [WV_ED.frame - 1, WV_ED.frame + 1]) {
    if (!T[nb]) continue;
    c.strokeStyle = `rgba(${cl.bloom},.14)`;
    c.stroke(wvPath((u) => [10 + u * (w - 20), yv(wvRd(T[nb], u))], 200));
  }
  const p = wvPath((u) => [10 + u * (w - 20), yv(wvRd(f, u))], 400);
  wvUnder(c, p, 10, w - 10, h / 2, 10, cl, 0.16);
  wvTrace(c, p, cl, 2);

  const hg = WVW.wvCHarm, sp = wvSpectrum(f, 48), m = wvMags(sp), bw = (hg.w - 12) / 48;
  hg.c.clearRect(0, 0, hg.w, hg.h);
  for (let k = 0; k < 48; k++) {
    const x = 6 + k * bw, hh = Math.sqrt(wvClamp(m[k])) * (hg.h - 14), ph = Math.atan2(sp.im[k], sp.re[k]);
    hg.c.fillStyle = `rgba(${cl.bloom},${0.25 + 0.6 * wvClamp(m[k] * 2)})`;
    hg.c.fillRect(x + 1, hg.h - 6 - hh, bw - 2, hh);
    hg.c.fillStyle = cl.mod;
    hg.c.fillRect(x + 1, 4 + (1 - (ph + Math.PI) / WV_TAU) * 6, bw - 2, 1.5);
  }
  wvTxt('wvCHarmRo', `brightest: harmonic ${1 + m.indexOf(Math.max(...m))}`);

  const sg = WVW.wvCStrip, cw = (sg.w - 12) / n;
  sg.c.clearRect(0, 0, sg.w, sg.h);
  for (let i = 0; i < n; i++) {
    const x = 6 + i * cw, on = i === WV_ED.frame;
    sg.c.strokeStyle = on ? cl.wave : `rgba(${cl.bloom},.32)`;
    sg.c.lineWidth = on ? 1.4 : 1;
    sg.c.stroke(wvPath((u) => [x + 1 + u * (cw - 2), sg.h / 2 + 4 - wvRd(T[i], u) * (sg.h * 0.28)], 14));
    if (WV_ED.keys.has(i)) {
      sg.c.fillStyle = cl.acc;
      sg.c.beginPath();
      sg.c.moveTo(x + cw / 2, 2); sg.c.lineTo(x + cw / 2 + 4, 6); sg.c.lineTo(x + cw / 2, 10); sg.c.lineTo(x + cw / 2 - 4, 6);
      sg.c.fill();
    }
  }
  sg.c.strokeStyle = cl.acc;
  sg.c.lineWidth = 1.5;
  sg.c.strokeRect(6 + WV_ED.frame * cw + 0.5, 12, cw - 1, sg.h - 16);
  wvTxt('wvCFrameRo', `Frame ${String(WV_ED.frame + 1).padStart(2, '0')} / ${n}`);
  wvTxt('wvCTableRo', `${n} frames · 2048`);
  wvDraw3D(WVW.wvC3d, T, WV_ED.frame / Math.max(1, n - 1), ['off', 0], t, { n: 40, depth: 0.3, rise: 0.55 });
}

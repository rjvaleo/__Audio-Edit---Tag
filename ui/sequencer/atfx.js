// Atmosphere's own effects (ours, 16 Nov 2026). RJ: "right click, insert
// effects … all the effects … a little module and then expand to have like a
// pop up … add all the effects like I can on the grain page." Approved mock-up:
// `WORK DIR/page-mockups/atmos-fx.html`.
//
// **The sound.** Every effect the Grain page has (the app's suites, `/api/fx`)
// runs here on Atmosphere alone: its voice, character and sympathy go through
// this chain, then on to the delay and Space. The effects are the engine's own
// — the `fx` crate's rack built for the browser (`atfx.wasm`) and run in an
// AudioWorklet (`atfx-worklet.js`) — so a mode sounds here as it does there,
// and the keys stay as quick as they were: nothing goes to the engine and back.
//
// **The line.** One panel, FX: a small module for each effect in order, its
// light to switch it, a picture that moves with what it is doing. Right-click
// the line (or ＋) to insert any effect; right-click a module to open, switch,
// insert before or after, replace or remove it; drag a module to move it.
// Click a module for its window: every control the effect has, its Mix and
// its Level.
//
// **Kept.** The chain is one hidden field (`#atFxChain`, JSON) among
// Atmosphere's switches, so presets, morphs and the Performance recorder carry
// it as they carry the oscillators' kinds; and in this browser, so a reload
// keeps it.

const ATFX = {
  suites: [], // the app's, from /api/fx
  shapers: {}, // kind → { label, params }
  chain: [], // [{ kind, on, params: { key: value } }]
  bytes: null, // the module, once fetched
  nodes: [], // a worklet per audio context it was attached in
  open: -1, // the slot whose window is up
  lvl: 0,
  tel: [],
};
const ATFX_KEY = "atmos.fx";
const ATFX_FAM = {
  reverb: "space", delay: "time", modulation: "pitch", pitch: "pitch", dynamics: "level", saturation: "attack",
  filter: "tone", stereo: "tone", utility: "level", spectral: "on",
};

// ─── THE SOUND ───────────────────────────────────────────────────────────────

/// Fetch the module once.
function atfxBytes() {
  if (!ATFX.bytesP) {
    ATFX.bytesP = fetch("atfx.wasm").then((r) => (r.ok ? r.arrayBuffer() : null)).then((b) => (ATFX.bytes = b)).catch(() => null);
  }
  return ATFX.bytesP;
}

/// Put the chain between `inp` and `out` in this context: straight through
/// until the worklet is up, then through it. An offline context (a film's
/// render) is left straight through.
function atfxAttach(c, inp, out) {
  if (!c.audioWorklet || typeof AudioWorkletNode === "undefined" || c instanceof OfflineAudioContext) return;
  const up = c.__atfx || (c.__atfx = c.audioWorklet.addModule("atfx-worklet.js"));
  Promise.all([up, atfxBytes()]).then(([, bytes]) => {
    if (!bytes) return;
    const node = new AudioWorkletNode(c, "atfx", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
    node.port.onmessage = (e) => {
      const m = e.data;
      if (m.t === "lvl") { ATFX.lvl = m.peak; ATFX.tel = m.tel; }
      else if (m.t === "error") console.warn("atfx:", m.text);
    };
    node.port.postMessage({ t: "wasm", bytes: bytes.slice(0) });
    node.port.postMessage({ t: "chain", slots: ATFX.chain });
    try { inp.disconnect(out); } catch (e) { /* not joined */ }
    inp.connect(node);
    node.connect(out);
    ATFX.nodes = ATFX.nodes.filter((n) => n.context.state !== "closed");
    ATFX.nodes.push(node);
  }).catch((e) => console.warn("atfx:", e));
}

function atfxSend(m) {
  for (const n of ATFX.nodes) n.port.postMessage(m);
}

/// The chain changed in shape: lay it again everywhere, keep it, draw it.
function atfxLaid(record = true) {
  atfxSend({ t: "chain", slots: ATFX.chain });
  if (record) atfxKeep();
  atfxRender();
}

function atfxKeep() {
  const json = JSON.stringify(ATFX.chain);
  try { localStorage.setItem(ATFX_KEY, json); } catch (e) { /* private window */ }
  const f = document.getElementById("atFxChain");
  if (f && f.value !== json) {
    f.value = json;
    f.dispatchEvent(new Event("change", { bubbles: true }));
  }
}

/// A preset, a morph or the recorder set the field: take the chain from it.
function atfxFromField() {
  const f = document.getElementById("atFxChain");
  if (!f) return;
  let c = [];
  try { c = JSON.parse(f.value || "[]"); } catch (e) { return; }
  if (!Array.isArray(c) || JSON.stringify(c) === JSON.stringify(ATFX.chain)) return;
  ATFX.chain = c.filter((s) => s && typeof s.kind === "string");
  atfxClose();
  atfxSend({ t: "chain", slots: ATFX.chain });
  try { localStorage.setItem(ATFX_KEY, JSON.stringify(ATFX.chain)); } catch (e) { /* private window */ }
  atfxRender();
}

// ─── WHAT THERE IS ───────────────────────────────────────────────────────────

async function atfxCatalogue() {
  try {
    const r = await (await fetch("/api/fx")).json();
    for (const s of r.shapers || []) ATFX.shapers[s.kind] = s;
    ATFX.suites = (r.suites || []).filter((s) => s.offered !== false).map((s) => ({
      ...s, families: s.families.map((f) => ({ ...f, modes: f.modes.filter((m) => m.listed !== false) })).filter((f) => f.modes.length),
    })).filter((s) => s.families.length);
  } catch (e) { /* the page on its own: no list, nothing to insert */ }
  atfxRender();
}

function atfxMode(kind) {
  for (const s of ATFX.suites) for (const f of s.families) for (const m of f.modes) if (m.kind === kind) return { s, f, m };
  return null;
}
const atfxName = (kind) => atfxMode(kind)?.m.label || ATFX.shapers[kind]?.label || kind;
const atfxParams = (kind) => (ATFX.shapers[kind]?.params || []);
const atfxFam = (kind) => ATFX_FAM[(atfxMode(kind)?.s.id || "").split("-")[0]] || "level";

// ─── THE LINE ────────────────────────────────────────────────────────────────

function atfxBuild() {
  const body = document.getElementById("atBody");
  if (!body || document.getElementById("atFxLine")) return;
  const field = document.createElement("input");
  field.type = "hidden";
  field.id = "atFxChain";
  field.value = "[]";
  field.addEventListener("change", atfxFromField);
  document.getElementById("atGroup").append(field);
  const sec = document.createElement("section");
  sec.className = "panel at-fx at-only";
  sec.id = "atFxLine";
  sec.innerHTML = `<div class="atfx-lab"><b class="nm">FX</b><span class="meta">Atmosphere only</span><span class="meta">right-click to insert</span></div>`
    + `<span class="atfx-end">VOICE ›</span><div class="atfx-chain" id="atFxChainRow"></div><span class="atfx-end">› DELAY · SPACE</span>`;
  body.append(sec);
  sec.addEventListener("contextmenu", atfxContext);
  const row = document.getElementById("atFxChainRow");
  row.addEventListener("click", (e) => {
    const led = e.target.closest("[data-led]");
    if (led) { e.stopPropagation(); atfxToggle(+led.dataset.led); return; }
    const plus = e.target.closest(".atfx-plus");
    if (plus) { const r = plus.getBoundingClientRect(); atfxMenu([{ hd: "Insert effect" }, ...atfxInsertItems(ATFX.chain.length)], r.left, r.bottom + 4); return; }
    const t = e.target.closest(".atfx-tile");
    if (t) atfxOpen(+t.dataset.i);
  });
  // Drag a module to move it.
  let from = -1;
  row.addEventListener("dragstart", (e) => { const t = e.target.closest(".atfx-tile"); if (t) { from = +t.dataset.i; e.dataTransfer.effectAllowed = "move"; } });
  row.addEventListener("dragover", (e) => e.preventDefault());
  row.addEventListener("drop", (e) => {
    e.preventDefault();
    const t = e.target.closest(".atfx-tile");
    if (from < 0 || !t) return;
    const to = +t.dataset.i;
    if (to !== from) { const [m] = ATFX.chain.splice(from, 1); ATFX.chain.splice(to, 0, m); atfxClose(); atfxLaid(); }
    from = -1;
  });
  document.addEventListener("mousedown", (e) => { if (!e.target.closest(".atfx-menu")) atfxMenuClose(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") { atfxMenuClose(); atfxClose(); } });
  try { ATFX.chain = JSON.parse(localStorage.getItem(ATFX_KEY) || "[]"); } catch (e) { ATFX.chain = []; }
  if (!Array.isArray(ATFX.chain)) ATFX.chain = [];
  field.value = JSON.stringify(ATFX.chain);
  atfxRender();
  atfxCatalogue();
  requestAnimationFrame(atfxPaint);
}

function atfxRender() {
  const row = document.getElementById("atFxChainRow");
  if (!row) return;
  row.innerHTML = ATFX.chain.map((s, i) => {
    const m = atfxMode(s.kind);
    return `${i ? '<span class="atfx-ar">›</span>' : ""}<div class="atfx-tile${s.on ? "" : " off"}${i === ATFX.open ? " open" : ""}" data-i="${i}" draggable="true" style="--sc: var(--f-${atfxFam(s.kind)})" title="${atfxName(s.kind)}: click for its window · right-click for more · drag to move">`
      + `<span class="atfx-led" data-led="${i}" title="On or off"></span><span class="atfx-tx"><b>${atfxName(s.kind)}</b><span>${m ? m.s.label + " · " + m.f.label : ""}</span></span><canvas class="atfx-mini" width="40" height="22"></canvas></div>`;
  }).join("") + `${ATFX.chain.length ? '<span class="atfx-ar">›</span>' : ""}<button type="button" class="atfx-plus" title="Insert an effect at the end">＋</button>`;
}

/// The modules' pictures: what leaves the chain, and how hard each is working.
function atfxPaint() {
  const tiles = document.querySelectorAll(".atfx-tile");
  ATFX.hist = ATFX.hist || [];
  ATFX.hist.push(ATFX.lvl);
  if (ATFX.hist.length > 10) ATFX.hist.shift();
  tiles.forEach((t, i) => {
    const cv = t.querySelector("canvas");
    const g = cv.getContext("2d");
    g.clearRect(0, 0, cv.width, cv.height);
    g.fillStyle = getComputedStyle(t).getPropertyValue("--sc").trim() || "#c4c8d0";
    const on = ATFX.chain[i]?.on;
    const work = Math.min(1, Math.abs(ATFX.tel[i] || 0) / 12);
    ATFX.hist.forEach((v, k) => {
      const h = on ? Math.max(2, Math.min(1, v * 1.4 + work * 0.5) * (cv.height - 2)) : 2;
      g.globalAlpha = 0.35 + 0.65 * (k / ATFX.hist.length);
      g.fillRect(k * 4, cv.height - h, 3, h);
    });
  });
  requestAnimationFrame(atfxPaint);
}

function atfxToggle(i) {
  const s = ATFX.chain[i];
  if (!s) return;
  s.on = !s.on;
  atfxSend({ t: "on", i, on: s.on });
  atfxKeep();
  atfxRender();
  atfxPaintWindow();
}

function atfxInsert(kind, at) {
  const params = {};
  for (const p of atfxParams(kind)) params[p.key] = p.default;
  ATFX.chain.splice(at, 0, { kind, on: true, params, wet: 100, level: 0 });
  atfxLaid();
  atfxOpen(at);
}

function atfxRemove(i) {
  ATFX.chain.splice(i, 1);
  atfxClose();
  atfxLaid();
}

function atfxReplace(i, kind) {
  const params = {};
  for (const p of atfxParams(kind)) params[p.key] = p.default;
  ATFX.chain[i] = { ...ATFX.chain[i], kind, params };
  atfxLaid();
  atfxOpen(i);
}

// ─── THE MENU ────────────────────────────────────────────────────────────────
const ATFX_MENUS = [];

function atfxMenuClose(from = 0) {
  for (const m of ATFX_MENUS.splice(from)) m.remove();
}

function atfxMenu(items, x, y, depth = 0, back = null) {
  atfxMenuClose(depth);
  const el = document.createElement("div");
  el.className = "atfx-menu";
  el.innerHTML = items.map((it, k) => (it.sep ? '<div class="atfx-sep"></div>' : it.hd ? `<div class="atfx-hd">${it.hd}</div>`
    : `<div class="atfx-mi" data-k="${k}">${it.l}${it.sub ? '<span class="atfx-k">›</span>' : ""}</div>`)).join("");
  document.body.append(el);
  ATFX_MENUS.push(el);
  const r = el.getBoundingClientRect();
  el.style.left = (x + r.width > innerWidth - 6 ? (back != null ? back - r.width - 2 : innerWidth - r.width - 6) : x) + "px";
  el.style.top = Math.max(6, Math.min(y, innerHeight - r.height - 6)) + "px";
  el.addEventListener("mouseover", (e) => {
    const mi = e.target.closest(".atfx-mi");
    if (!mi) return;
    const it = items[+mi.dataset.k];
    el.querySelectorAll(".atfx-mi").forEach((m) => m.classList.toggle("hot", m === mi));
    if (it.sub) { const rr = mi.getBoundingClientRect(); atfxMenu(it.sub(), rr.right + 2, rr.top - 4, depth + 1, el.getBoundingClientRect().left); }
    else atfxMenuClose(depth + 1);
  });
  el.addEventListener("click", (e) => {
    const mi = e.target.closest(".atfx-mi");
    if (!mi) return;
    const it = items[+mi.dataset.k];
    if (it.act) { atfxMenuClose(); it.act(); }
  });
}

/// Every suite, its families, their modes: choosing one does `act(kind)`.
function atfxSuiteItems(act) {
  if (!ATFX.suites.length) return [{ hd: "No effects: the app is not reachable" }];
  return ATFX.suites.map((s) => ({
    l: s.label,
    sub: () => (s.families.length > 1
      ? s.families.map((f) => ({ l: f.label, sub: () => f.modes.map((m) => ({ l: m.label, act: () => act(m.kind) })) }))
      : s.families[0].modes.map((m) => ({ l: m.label, act: () => act(m.kind) }))),
  }));
}
const atfxInsertItems = (at) => atfxSuiteItems((kind) => atfxInsert(kind, at));

function atfxContext(e) {
  e.preventDefault();
  const t = e.target.closest(".atfx-tile");
  if (t) {
    const i = +t.dataset.i, s = ATFX.chain[i];
    atfxMenu([{ hd: atfxName(s.kind) }, { l: "Open", act: () => atfxOpen(i) }, { l: s.on ? "Turn off" : "Turn on", act: () => atfxToggle(i) },
      { sep: 1 }, { l: "Insert effect before", sub: () => atfxInsertItems(i) }, { l: "Insert effect after", sub: () => atfxInsertItems(i + 1) },
      { l: "Replace with", sub: () => atfxSuiteItems((k) => atfxReplace(i, k)) }, { sep: 1 }, { l: "Remove", act: () => atfxRemove(i) }], e.clientX, e.clientY);
  } else {
    atfxMenu([{ hd: "Insert effect" }, ...atfxInsertItems(ATFX.chain.length)], e.clientX, e.clientY);
  }
}

// ─── THE WINDOW ──────────────────────────────────────────────────────────────

/// One control's knob: its range input runs 0–1000 over the control's range
/// (along a log curve where the control is one), and shows the value in its unit.
function atfxToKnob(p, v) {
  const lo = p.min, hi = p.max;
  const u = p.log && lo > 0 ? Math.log(v / lo) / Math.log(hi / lo) : (v - lo) / (hi - lo || 1);
  return Math.round(Math.max(0, Math.min(1, u)) * 1000);
}
function atfxFromKnob(p, k) {
  const u = k / 1000, lo = p.min, hi = p.max;
  return p.log && lo > 0 ? lo * Math.pow(hi / lo, u) : lo + (hi - lo) * u;
}
function atfxText(p, v) {
  const u = p.unit || "";
  const n = Math.abs(v) >= 1000 && /hz/i.test(u) ? (v / 1000).toFixed(1) + "k" : Math.abs(v) >= 100 ? Math.round(v) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2);
  return `${n}${u === "%" ? "%" : u ? " " + u.replace(/^k(hz)$/i, "kHz") : ""}`;
}

const ATFX_SLOT = [
  { key: "slot.wet", label: "Mix", min: 0, max: 100, default: 100, unit: "%", scale: 0.01, field: "wet" },
  { key: "slot.level", label: "Level", min: -24, max: 12, default: 0, unit: "dB", field: "level" },
];

function atfxOpen(i) {
  const s = ATFX.chain[i];
  if (!s) return;
  atfxClose();
  ATFX.open = i;
  atfxRender();
  const m = atfxMode(s.kind);
  const params = atfxParams(s.kind);
  const win = document.createElement("div");
  win.className = "atfx-win";
  win.id = "atFxWin";
  win.style.setProperty("--sc", `var(--f-${atfxFam(s.kind)})`);
  const knob = (id, label) => `<div class="knob-group atfx-kg"><span class="knob-label">${label}</span><div class="knob" onmousedown="knobDown(event, '${id}')" ontouchstart="knobTouchStart(event,'${id}')"></div>`
    + `<input type="range" class="knob-hidden" min="0" max="1000" step="1" id="${id}" /><span class="knob-val" id="${id}Val"></span></div>`;
  win.innerHTML = `<div class="atfx-bar"><span class="atfx-led" id="atFxWinLed" title="On or off"></span><b>${atfxName(s.kind)}</b><span class="meta">${m ? m.s.label + " · " + m.f.label : ""}</span><span class="grow"></span>`
    + `<button type="button" class="btn" id="atFxWinRemove" title="Take it out of the chain">Remove</button><button type="button" class="atfx-x" title="Close (Esc)">✕</button></div>`
    + `<div class="well atfx-vis"><canvas id="atFxWinVis" width="560" height="90"></canvas></div>`
    + `<div class="knobs atfx-knobs">${params.map((p, k) => knob(`afxP${k}`, p.label)).join("")}`
    + `<span class="atfx-vsep"></span>${ATFX_SLOT.map((p, k) => knob(`afxS${k}`, p.label)).join("")}</div>`
    + (params.length ? "" : `<div class="meta atfx-none">This effect has no controls of its own: Mix and Level.</div>`);
  document.body.append(win);
  const wire = (id, p, get, set) => {
    const inp = document.getElementById(id);
    inp.value = atfxToKnob(p, get());
    const show = () => { document.getElementById(id + "Val").textContent = atfxText(p, get()); };
    show();
    inp.addEventListener("input", () => { set(atfxFromKnob(p, +inp.value)); show(); });
  };
  params.forEach((p, k) => wire(`afxP${k}`, p, () => s.params?.[p.key] ?? p.default, (v) => {
    s.params = s.params || {};
    s.params[p.key] = v;
    atfxSend({ t: "set", i, k: p.key, v });
    atfxKeepSoon();
  }));
  ATFX_SLOT.forEach((p, k) => wire(`afxS${k}`, p, () => s[p.field] ?? p.default, (v) => {
    s[p.field] = v;
    atfxSend({ t: "set", i, k: p.key, v: v * (p.scale || 1) });
    atfxKeepSoon();
  }));
  if (typeof lookKnobs === "function") lookKnobs();
  for (const g of win.querySelectorAll(".knob-group")) g.style.setProperty("--kc", "var(--sc)");
  for (const id of [...params.map((_, k) => `afxP${k}`), ...ATFX_SLOT.map((_, k) => `afxS${k}`)]) if (window.updateKnobVisual) window.updateKnobVisual(id);
  document.getElementById("atFxWinLed").onclick = () => atfxToggle(i);
  document.getElementById("atFxWinRemove").onclick = () => atfxRemove(i);
  win.querySelector(".atfx-x").onclick = atfxClose;
  // Above its module, and moved by its bar.
  const t = document.querySelector(`.atfx-tile[data-i="${i}"]`)?.getBoundingClientRect();
  const r = win.getBoundingClientRect();
  win.style.left = Math.max(8, Math.min((t ? t.left : 40), innerWidth - r.width - 8)) + "px";
  win.style.top = Math.max(8, (t ? t.top : 200) - r.height - 10) + "px";
  let drag = null;
  win.querySelector(".atfx-bar").addEventListener("pointerdown", (e) => {
    if (e.target.closest("button, .atfx-led")) return;
    drag = [e.clientX - win.offsetLeft, e.clientY - win.offsetTop];
    win.setPointerCapture(e.pointerId);
  });
  win.addEventListener("pointermove", (e) => { if (drag) { win.style.left = e.clientX - drag[0] + "px"; win.style.top = e.clientY - drag[1] + "px"; } });
  win.addEventListener("pointerup", () => { drag = null; });
  atfxPaintWindow();
  ATFX.visRaf = requestAnimationFrame(atfxPaintVis);
}

function atfxPaintWindow() {
  const led = document.getElementById("atFxWinLed");
  if (led) led.classList.toggle("off", !ATFX.chain[ATFX.open]?.on);
}

/// The window's picture: what leaves the chain, as it moves.
function atfxPaintVis() {
  const cv = document.getElementById("atFxWinVis");
  if (!cv) return;
  const g = cv.getContext("2d"), w = cv.width, h = cv.height;
  ATFX.vis = ATFX.vis || [];
  ATFX.vis.push(ATFX.lvl);
  if (ATFX.vis.length > w / 3) ATFX.vis.shift();
  g.clearRect(0, 0, w, h);
  g.fillStyle = getComputedStyle(cv.closest(".atfx-win")).getPropertyValue("--sc").trim() || "#79bfc3";
  ATFX.vis.forEach((v, k) => {
    const a = Math.min(1, v * 1.6) * (h / 2 - 2);
    g.globalAlpha = 0.8;
    g.fillRect(k * 3, h / 2 - a, 2, a * 2 || 1);
  });
  ATFX.visRaf = requestAnimationFrame(atfxPaintVis);
}

let atfxKeepT = 0;
function atfxKeepSoon() {
  clearTimeout(atfxKeepT);
  atfxKeepT = setTimeout(atfxKeep, 300);
}

function atfxClose() {
  cancelAnimationFrame(ATFX.visRaf);
  document.getElementById("atFxWin")?.remove();
  if (ATFX.open !== -1) { ATFX.open = -1; atfxRender(); }
}

atfxBuild();

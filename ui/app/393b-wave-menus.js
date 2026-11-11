// ======================================================= Wave: the menus
//
// Every warp drawn on this oscillator's wave, every effect on it, the tables,
// the LFO shapes, and the preset shelf; then A and B. Drawn inside the page,
// so they scale with it. (v8 moved them out of the Matrix and FX part, which
// the board replaced.)

// ─────────────────────────────────────────────────────────────────── menus
//
// Placed under the control that opened them and kept inside the page. One
// open at a time.

const WV_MENU = { owner: null };

function wvMenuEl() { return $('wvMenu'); }

function wvCloseMenus() {
  const m = $('wvMenu'), s = $('wvShelf'), p = $('wvPmenu'), c = $('wvCmenu');
  const open = [m, s, p, c].some((x) => x && !x.hidden);
  for (const x of [m, s, p, c]) if (x) x.hidden = true;
  WV_MENU.owner = null;
  return open;
}

/// Put a menu under its anchor, in page pixels, inside the page.
function wvPlaceMenu(m, anchor, dx) {
  const app = document.querySelector('#waveView .wv-app'), ar = app.getBoundingClientRect(), r = anchor.getBoundingClientRect();
  const s = ar.width / app.offsetWidth || 1;
  m.hidden = false;
  const left = Math.max(8, Math.min(app.offsetWidth - m.offsetWidth - 8, (r.left - ar.left) / s + dx));
  let top = (r.bottom - ar.top) / s + 6;
  if (top + m.offsetHeight > app.offsetHeight - 8) top = Math.max(8, (r.top - ar.top) / s - m.offsetHeight - 6);
  m.style.left = left + 'px';
  m.style.top = top + 'px';
}

/// Toggle: the same control opening its own menu again shuts it.
function wvMenuFor(owner) {
  const m = wvMenuEl();
  if (WV_MENU.owner === owner && !m.hidden) { wvCloseMenus(); return null; }
  wvCloseMenus();
  WV_MENU.owner = owner;
  m.innerHTML = '';
  m.className = 'wv-menu';
  return m;
}

function wvMenuTile(m, label, on, color) {
  const t = wvH(`<div class="wv-wt ${on ? 'on' : ''}"${color ? ` style="color:${color}"` : ''}><canvas data-w="88" data-h="38"></canvas><span></span></div>`);
  t.lastElementChild.textContent = label;
  m.appendChild(t);
  return { t, g: wvCv(t.firstElementChild) };
}

function wvWarpMenu(anchor, i, j, set) {
  const m = wvMenuFor(`warp${i}${j}`);
  if (!m) return;
  const k = `osc${i}.`, f = wvFrameAt(wvTable(wvG(k + 'table')), wvPosNow(i));
  const o = i === 1 ? 0 : 1, B = wvFrameAt(wvTable(wvG(`osc${o}.table`)), wvPosNow(o)), cl = wvCl();
  for (const key of Object.keys(WV_WARPS)) {
    const { t, g } = wvMenuTile(m, key === 'off' ? 'None' : WV_WARPS[key].name, wvG(`${k}warp${j}.mode`) === key);
    if (key !== 'off') {
      g.c.strokeStyle = `rgba(${cl.bloom},.18)`;
      g.c.lineWidth = 1;
      g.c.stroke(wvPath((u) => [4 + u * 80, 19 - wvRd(f, u) * 14], 80));
    }
    wvTrace(g.c, wvPath((u) => [4 + u * 80, 19 - wvRd(key === 'off' ? f : wvWarp(f, key, 0.55, B), u) * 14], 120), cl, 1.3, 0.6);
    t.addEventListener('click', () => { set(key); wvCloseMenus(); });
  }
  wvPlaceMenu(m, anchor, -120);
}

function wvFxMenu(anchor, i) {
  const m = wvMenuFor(`fx${i}`);
  if (!m) return;
  const k = `osc${i}.`, dry = wvWaveFor(i, true), cl = wvCl();
  for (const key of Object.keys(WV_OFX)) {
    const { t, g } = wvMenuTile(m, WV_OFX[key].name, wvG(k + 'fx.mode') === key, wvFxCol(key, 78));
    t.dataset.fx = key;
    const c = g.c, bg = c.createLinearGradient(0, 0, 88, 0);
    bg.addColorStop(0, wvFxCol(key, 45, 0.25));
    bg.addColorStop(1, wvFxCol(key, 45, 0));
    c.fillStyle = bg;
    c.fillRect(0, 0, 88, 38);
    wvFxIcon(c, key, 2, 10, 1.05, wvFxCol(key, 76));
    c.strokeStyle = `rgba(${cl.bloom},.18)`;
    c.lineWidth = 1;
    c.stroke(wvPath((u) => [24 + u * 60, 19 - wvRd(dry, u * 2) * 13], 80));
    if (key === 'chorus') {
      for (let v = 0; v < 3; v++) {
        c.globalAlpha = v ? 0.5 : 1;
        wvFxTrace(c, wvPath((u) => [24 + u * 60, 19 + (v - 1) * 4 - wvRd(dry, u * 2 + v * 0.03) * 12], 80), key, 1.1);
      }
      c.globalAlpha = 1;
    } else if (key === 'delay') {
      for (let r = 0; r < 4; r++) {
        const A = Math.pow(0.6, r);
        c.globalAlpha = A;
        wvFxTrace(c, wvPath((u) => [24 + r * 16 + u * 13, 19 - wvRd(dry, u * 2) * 12 * A], 30), key, 1.1);
      }
      c.globalAlpha = 1;
    } else if (key === 'phaser') {
      wvFxTrace(c, wvPath((u) => [24 + u * 60, 19 - (wvRd(dry, u * 2) * 0.5 + wvRd(dry, u * 2 + 0.1) * 0.5) * 13], 100), key, 1.2);
    } else {
      wvFxTrace(c, wvPath((u) => [24 + u * 60, 19 - wvRd(wvOfxShape(dry, key, 0.75, 0.5), u * 2) * 13], key === 'crush' ? 300 : 120), key, 1.2);
    }
    t.addEventListener('click', () => { wvCommit(k + 'fx.mode', key); wvCloseMenus(); });
  }
  wvPlaceMenu(m, anchor, -60);
}

/// The tables: the engine's list when it has one, the built-ins otherwise,
/// each drawn as its middle frame.
async function wvTableMenu(anchor, i) {
  const m = wvMenuFor(`table${i}`);
  if (!m) return;
  let names = WV_TABLE_NAMES.slice();
  if (WV.connected) {
    try {
      const r = await fetch('/api/wave/tables');
      if (r.ok) {
        const list = await r.json();
        if (Array.isArray(list) && list.length) names = list.map((x) => (typeof x === 'string' ? x : x.name)).filter(Boolean);
      }
    } catch { /* the built-ins */ }
  }
  if (WV_MENU.owner !== `table${i}`) return;
  const cl = wvCl(), k = `osc${i}.table`;
  for (const name of names) {
    const { t, g } = wvMenuTile(m, name, wvG(k) === name);
    const f = wvFrameAt(wvTable(name), 0.5);
    wvTrace(g.c, wvPath((u) => [4 + u * 80, 19 - wvRd(f, u) * 14], 100), cl, 1.3, 0.6);
    t.addEventListener('click', async () => {
      wvCloseMenus();
      wvCommit(k, name);
      await wvFetchTable(name);
    });
  }
  wvPlaceMenu(m, anchor, 0);
}

/// The presets the mock-up offered, for when the engine has none to list.
const WV_PRESETS_OFFLINE = [
  ['Night Glass Pad', 'Pad · Warm', 'Formant Sweep'], ['Hollow Choir', 'Pad · Vocal', 'Vowel Ah–Oo'], ['Organ Bloom', 'Keys · Bright', 'Glass Organ'],
  ['Pulse Runner', 'Bass · Hard', 'Hollow Pulse'], ['Grit Engine', 'Lead · Dirty', 'Grit Saw'], ['Vowel Pluck', 'Pluck · Vocal', 'Vowel Ah–Oo'],
  ['Formant Bass', 'Bass · Warm', 'Formant Sweep'], ['Glass Bell', 'Keys · Glassy', 'Glass Organ'],
].map(([name, tags, table]) => ({ name, tags, patch: { params: { 'osc0.table': table } } }));

async function wvLoadPresets() {
  if (WV.connected) {
    try {
      const r = await fetch('/api/wave/presets');
      if (r.ok) {
        const list = await r.json();
        if (Array.isArray(list) && list.length) { WV.presets = list; return list; }
      }
    } catch { /* offline list */ }
  }
  WV.presets = WV_PRESETS_OFFLINE;
  return WV.presets;
}

const wvPresetTags = (p) => (Array.isArray(p.tags) ? p.tags.join(' · ') : String(p.tags || ''));

/// Load a preset: over the current patch, sent whole to the engine.
async function wvApplyPreset(p) {
  const patch = p.patch || {};
  wvAdopt({ ...patch, name: p.name, tags: wvPresetTags(p) });
  WV.name = p.name;
  WV.tags = wvPresetTags(p);
  await wvPost('/api/wave/patch', wvPatchBody());
  await Promise.all([0, 1, 2].map((i) => wvFetchTable(wvG(`osc${i}.table`))));
  wvSyncAll();
}

async function wvStepPreset(by) {
  const list = WV.presets || await wvLoadPresets();
  const at = list.findIndex((p) => p.name === WV.name);
  await wvApplyPreset(list[((at < 0 ? 0 : at + by) % list.length + list.length) % list.length]);
}

async function wvOpenShelf() {
  const s = $('wvShelf');
  if (!s.hidden) { s.hidden = true; return; }
  wvCloseMenus();
  const list = await wvLoadPresets();
  s.innerHTML = '';
  for (const p of list) {
    const el = wvH(`<div class="wv-pc ${p.name === WV.name ? 'on' : ''}"><div class="wv-well"><canvas data-w="146" data-h="64"></canvas></div><b></b><span></span></div>`);
    el.querySelector('b').textContent = p.name;
    el.querySelector('span').textContent = wvPresetTags(p);
    s.appendChild(el);
    const table = (p.patch && p.patch.params && p.patch.params['osc0.table']) || p.table || WV_TABLE_NAMES[0];
    wvDraw3D(wvCv(el.querySelector('canvas')), wvTable(table), 0.4, ['off', 0], 0, { n: 18, rise: 0.55, depth: 0.3 });
    el.addEventListener('click', () => { s.hidden = true; wvApplyPreset(p); });
  }
  wvPlaceMenu(s, $('wvPresetBtn'), 0);
}

/// A and B: two patches to compare. Switching keeps the one you leave.
async function wvSwitchAB(to) {
  if (to === WV.ab) return;
  WV.abSlots[WV.ab] = JSON.parse(JSON.stringify(wvPatchBody()));
  const next = WV.abSlots[to] || JSON.parse(JSON.stringify(WV.abSlots[WV.ab]));
  WV.ab = to;
  wvAdopt(next);
  await wvPost('/api/wave/patch', wvPatchBody());
  wvSyncAll();
}

window.addEventListener('pointerdown', (e) => {
  if (!WV.showing) return;
  const m = $('wvMenu'), s = $('wvShelf');
  if (m && !m.hidden && !e.target.closest('#wvMenu, [data-cycle], [data-ofx], [data-pick], [data-lshape], [data-snd], #wvCTable, canvas[id^="wvWp"]')) { m.hidden = true; WV_MENU.owner = null; }
  if (s && !s.hidden && !e.target.closest('#wvShelf, #wvPresetBtn')) s.hidden = true;
  const p = $('wvPmenu'), c = $('wvCmenu');
  if (p && !p.hidden && !e.target.closest('#wvPmenu, [data-pk]')) p.hidden = true;
  if (c && !c.hidden && !e.target.closest('#wvCmenu')) c.hidden = true;
});

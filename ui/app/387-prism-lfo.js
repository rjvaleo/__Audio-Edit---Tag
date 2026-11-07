// ============================================================ Prism LFOs

/* Four LFOs under the Prism page's controls (RJ, 6 Nov 2026: "four different
   selectable LFOs that have a bunch of different waveforms in them that I can
   map to the different controls and have that doing their thing while I am
   playing with the XY").

   Each has a rate, a depth and a shape (sine, triangle, square, saw, random,
   pulse, with a width for the pulse), and all four always run and loop.
   Mapping is the idMLab way (memory: modulator map UX): press Map, then click
   a control; that control gets a ring in the LFO's own colour and its marker
   moves with it. Clicking a control already mapped to that LFO unmaps it.

   **What an LFO moves is the sound, not the setting.** The setting a control
   holds is its base, and stays what the hand, the pad, a preset or an undo set
   it to; the LFO swings the value the deck hears around that base, by Depth's
   share of the control's whole range, sending it the way the pad's own moves
   go (`prismLiveParam`, `/api/prism/stretch`, `/api/pitchtime`). Unmapped or
   with no depth, the base is sent back, so nothing is left where the swing
   happened to stop.

   Mappings are kept per sound in this browser (`prism.lfos:<path>`): the Prism
   document has nowhere for them yet. */

/// Text for markup: a control's or a process's name.
const prismEsc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').split('"').join('&quot;');

const PRISM_LFO_SHAPES = ['sine', 'triangle', 'square', 'saw', 'random', 'pulse'];
/// How often the deck hears a swing, in ms: the pad's own pace.
const PRISM_LFO_SEND_MS = 33;

const prismLfo = {
  lfos: [1, 2, 3, 4].map((i) => ({
    i, shape: ['sine', 'triangle', 'saw', 'random'][i - 1], rate: [0.5, 1.3, 0.25, 4][i - 1],
    depth: 25, pw: 25, phase: 0, held: 0.5, targets: [],
  })),
  sel: 0,
  mapping: false,
  raf: 0, last: 0, sent: 0,
  /// The bars on screen (`prismBar`), by source and key, for the marker to move.
  rows: new Map(),
};

/// One LFO's value, −1…1, at phase `ph` (in cycles).
function prismLfoAt(l, ph) {
  const u = ((ph % 1) + 1) % 1;
  switch (l.shape) {
    case 'sine': return Math.sin(u * 2 * Math.PI);
    case 'triangle': return 1 - 4 * Math.abs(u - 0.5);
    case 'square': return u < 0.5 ? 1 : -1;
    case 'saw': return 2 * u - 1;
    case 'pulse': return u < l.pw / 100 ? 1 : -1;
    default: return l.held * 2 - 1;
  }
}

function prismLfoWaveIcon(shape) {
  let d = '';
  if (shape === 'random') {
    [0.6, -0.4, 0.9, -0.8, 0.2].forEach((y, k) => {
      d += `${k ? 'L' : 'M'}${(2 + k * 7.2).toFixed(1)} ${10 - 7 * y}L${(2 + (k + 1) * 7.2).toFixed(1)} ${10 - 7 * y}`;
    });
  } else {
    for (let i = 0; i <= 40; i++) {
      const u = i / 40;
      d += `${i ? 'L' : 'M'}${(2 + u * 36).toFixed(1)} ${(10 - 7 * prismLfoAt({ shape, pw: 25 }, u)).toFixed(1)}`;
    }
  }
  return `<svg viewBox="0 0 40 20" aria-hidden="true"><path d="${d}"/></svg>`;
}

// ───────────────────────────────────────────── kept per sound

function prismLfoKey() { return `prism.lfos:${typeof prismDeck === 'object' ? prismDeck.path || '' : ''}`; }

function prismLfoKeep() {
  try {
    localStorage.setItem(prismLfoKey(), JSON.stringify(prismLfo.lfos.map(({ shape, rate, depth, pw, targets }) => ({ shape, rate, depth, pw, targets }))));
  } catch { /* private mode */ }
}

function prismLfoLoad() {
  let kept = null;
  try { kept = JSON.parse(localStorage.getItem(prismLfoKey()) || 'null'); } catch { /* none */ }
  prismLfo.lfos.forEach((l, k) => {
    const g = kept?.[k];
    l.targets = Array.isArray(g?.targets) ? g.targets.filter((t) => t && t.src && t.key) : [];
    if (g) for (const f of ['shape', 'rate', 'depth', 'pw']) if (g[f] != null) l[f] = g[f];
  });
}

// ───────────────────────────────────────────── where a control lives

/// The control a target names: its range and its base value now.
function prismLfoControl(t) {
  const src = (prismPad.sources || []).find((s) => s.id === t.src);
  const c = src?.controls?.find((x) => x.key === t.key);
  if (!c) return null;
  let base;
  if (t.src === PRISM_STRETCH) base = prismDeck.stretch?.[t.key];
  else if (t.src === PRISM_PTC) base = prismPtc()[t.key];
  else {
    const slot = prismDeck.rack?.slots?.find((s) => s.id === t.src);
    base = slot?.params?.[t.key] ?? slot?.[t.key];
  }
  return Number.isFinite(base) ? { c, base } : null;
}

/// The value the deck hears for a target with these LFOs on it.
function prismLfoValue(t, c, base) {
  let v = base;
  for (const l of prismLfo.lfos) {
    if (!l.targets.some((x) => x.src === t.src && x.key === t.key)) continue;
    v += prismLfoAt(l, l.phase) * (l.depth / 100) * (c.max - c.min) / 2;
  }
  v = Math.max(c.min, Math.min(c.max, v));
  return c.step === 1 || c.choices ? Math.round(v) : v;
}

/// Send one value to the deck without keeping it as the setting.
const prismLfoStretchOut = {};
function prismLfoSend(t, v) {
  if (t.src === PRISM_STRETCH) {
    prismLfoStretchOut[t.key] = v;
    return;
  }
  if (t.src === PRISM_PTC) {
    if (prismDeck.path) postJSON('/api/pitchtime', { p: prismKey(), [t.key]: v }).catch(() => {});
    return;
  }
  prismLiveParam(t.src, t.key, v);
}
function prismLfoFlushStretch() {
  const keys = Object.keys(prismLfoStretchOut);
  if (!keys.length || !prismDeck.path) return;
  postJSON('/api/prism/stretch', { ...prismDeck.stretch, ...prismLfoStretchOut }).catch(() => {});
  for (const k of keys) delete prismLfoStretchOut[k];
}

/// Every target any LFO has, once each.
function prismLfoTargets() {
  const seen = new Map();
  for (const l of prismLfo.lfos) for (const t of l.targets) seen.set(`${t.src}\u0000${t.key}`, t);
  return [...seen.values()];
}

// ───────────────────────────────────────────── running

function prismLfoRunning() {
  return !!prismLfo.raf;
}

function prismLfoStart() {
  if (prismLfo.raf) return;
  prismLfo.last = performance.now();
  const tick = (now) => {
    prismLfo.raf = requestAnimationFrame(tick);
    const dt = Math.min(0.1, (now - prismLfo.last) / 1000);
    prismLfo.last = now;
    for (const l of prismLfo.lfos) {
      const before = Math.floor(l.phase);
      l.phase += l.rate * dt;
      if (Math.floor(l.phase) !== before) l.held = Math.random();
    }
    // Only while the Prism page is out: off it there is nothing to see, and
    // nothing of the deck's is being played with.
    if (!document.body.classList.contains('prismpage')) return;
    prismSettingsFollow();
    prismLfoPaint();
    if (now - prismLfo.sent < PRISM_LFO_SEND_MS) return;
    prismLfo.sent = now;
    for (const t of prismLfoTargets()) {
      const got = prismLfoControl(t);
      if (got) prismLfoSend(t, prismLfoValue(t, got.c, got.base));
    }
    prismLfoFlushStretch();
  };
  prismLfo.raf = requestAnimationFrame(tick);
}

function prismLfoStop() {
  if (prismLfo.raf) cancelAnimationFrame(prismLfo.raf);
  prismLfo.raf = 0;
}

/// A target no LFO drives any more goes back to its setting.
function prismLfoRestore(t) {
  const got = prismLfoControl(t);
  if (!got) return;
  prismLfoSend(t, got.base);
  prismLfoFlushStretch();
}

// ───────────────────────────────────────────── on screen

/// The LFO strip under the controls: the tabs, the shapes, the scope, Map with
/// the controls it drives, and the selected LFO's Rate, Depth and Width.
function prismLfoRender() {
  const box = $('prismLfos');
  if (!box) return;
  const l = prismLfo.lfos[prismLfo.sel];
  box.style.setProperty('--lc', `var(--plfo${l.i})`);
  document.body.style.setProperty('--plfo-map', `var(--plfo${l.i})`);
  document.body.classList.toggle('prism-mapping', prismLfo.mapping);
  const tabs = prismLfo.lfos.map((x, k) => `<button type="button" class="plfo-tab${k === prismLfo.sel ? ' on' : ''}" style="--lc:var(--plfo${x.i})" data-k="${k}" aria-pressed="${k === prismLfo.sel}" title="LFO ${x.i}">${x.i}<i data-dot="${k}"></i></button>`).join('');
  const shapes = PRISM_LFO_SHAPES.map((s) => `<button type="button" class="plfo-shape${s === l.shape ? ' on' : ''}" data-shape="${s}" title="${s[0].toUpperCase()}${s.slice(1)}" aria-pressed="${s === l.shape}">${prismLfoWaveIcon(s)}</button>`).join('');
  const label = (t) => {
    const src = (prismPad.sources || []).find((s) => s.id === t.src);
    const c = src?.controls?.find((x) => x.key === t.key);
    return c ? `${c.label}${t.src === prismPad.source ? '' : ` · ${src.label}`}` : null;
  };
  const chips = l.targets.map((t, k) => [label(t), k]).filter(([n]) => n)
    .map(([n, k]) => `<span class="plfo-chip">${prismEsc(n)}<button type="button" data-unmap="${k}" title="Unmap" aria-label="Unmap ${prismEsc(n)}">×</button></span>`).join('');
  box.innerHTML = `
    <div class="plfo-head"><span class="hs-h">LFOS</span><div class="plfo-tabs" role="group" aria-label="LFOs">${tabs}</div>
      <div class="plfo-shapes" role="group" aria-label="Shape">${shapes}</div></div>
    <div class="plfo-grid">
      <div class="plfo-col"><svg class="plfo-scope" id="prismLfoScope" viewBox="0 0 188 40" preserveAspectRatio="none" aria-hidden="true"></svg>
        <div class="plfo-map"><button type="button" class="hs-btn plfo-mapbtn${prismLfo.mapping ? ' on' : ''}" id="prismLfoMap" aria-pressed="${prismLfo.mapping}">Map</button>
          <span class="hs-dim">${prismLfo.mapping ? 'click a control · Esc stops' : 'then click a control'}</span></div>
        <div class="plfo-chips">${chips || '<span class="hs-dim">nothing mapped yet</span>'}</div></div>
      <div class="plfo-col prism-bars" id="prismLfoBars"></div>
    </div>`;
  const bars = $('prismLfoBars');
  const p = (key, label, min, max, unit, log) => ({ key, label, min, max, unit, log, default: { lfoRate: 1, lfoDepth: 25, lfoPw: 25 }[key] });
  const rows = [[p('lfoRate', 'Rate', 0.02, 20, 'Hz', true), 'rate'], [p('lfoDepth', 'Depth', 0, 100, '%'), 'depth']];
  if (l.shape === 'pulse') rows.push([p('lfoPw', 'Width', 5, 95, '%'), 'pw']);
  for (const [spec, field] of rows) {
    const row = prismBar(spec, l[field], {
      facet: 'time', colour: `var(--plfo${l.i})`,
      onInput: (v) => { l[field] = v; },
      onCommit: () => prismLfoKeep(),
    });
    bars.appendChild(row);
  }
  box.querySelectorAll('[data-k]').forEach((b) => { b.onclick = () => { prismLfo.sel = +b.dataset.k; prismLfo.mapping = false; prismLfoRender(); }; });
  box.querySelectorAll('[data-shape]').forEach((b) => { b.onclick = () => { l.shape = b.dataset.shape; prismLfoKeep(); prismLfoRender(); }; });
  box.querySelectorAll('[data-unmap]').forEach((b) => { b.onclick = () => prismLfoToggle(l.targets[+b.dataset.unmap]); });
  $('prismLfoMap').onclick = () => { prismLfo.mapping = !prismLfo.mapping; prismLfoRender(); };
  prismLfoMark();
}

/// Map or unmap a control on the selected LFO; the mapping ends either way.
function prismLfoToggle(t) {
  if (!t) return;
  const l = prismLfo.lfos[prismLfo.sel];
  const k = l.targets.findIndex((x) => x.src === t.src && x.key === t.key);
  if (k >= 0) l.targets.splice(k, 1);
  else l.targets.push({ src: t.src, key: t.key });
  prismLfo.mapping = false;
  prismLfoKeep();
  if (!prismLfoTargets().some((x) => x.src === t.src && x.key === t.key)) prismLfoRestore(t);
  prismLfoRender();
}

/// Put the rings on the controls the LFOs drive.
function prismLfoMark() {
  for (const [id, row] of prismLfo.rows) {
    const [src, key] = id.split('\u0000');
    const by = prismLfo.lfos.find((l) => l.targets.some((t) => t.src === src && t.key === key));
    row.classList.toggle('plfo-on', !!by);
    if (by) row.style.setProperty('--lc', `var(--plfo${by.i})`);
    else row.rest?.();
  }
}

/// Each frame: the dots on the tabs, the scope, and every driven control's
/// marker, reading and picture.
function prismLfoPaint() {
  prismLfo.lfos.forEach((l, k) => {
    const d = document.querySelector(`#prismLfos [data-dot="${k}"]`);
    if (d) d.style.opacity = (0.25 + 0.75 * (prismLfoAt(l, l.phase) + 1) / 2).toFixed(2);
  });
  const sc = $('prismLfoScope');
  if (sc) {
    const l = prismLfo.lfos[prismLfo.sel], A = 16 * l.depth / 100;
    let d = '';
    if (l.shape === 'random') {
      [0.6, -0.4, 0.9, -0.8, 0.2, -0.1].forEach((y, k) => { d += `${k ? 'L' : 'M'}${(k * 188 / 6).toFixed(1)} ${(20 - y * A).toFixed(1)}L${((k + 1) * 188 / 6).toFixed(1)} ${(20 - y * A).toFixed(1)}`; });
    } else {
      for (let i = 0; i <= 94; i++) { const u = i / 94; d += `${i ? 'L' : 'M'}${(u * 188).toFixed(1)} ${(20 - prismLfoAt(l, u) * A).toFixed(1)}`; }
    }
    const ph = ((l.phase % 1) + 1) % 1, y = 20 - prismLfoAt(l, l.phase) * A;
    sc.innerHTML = `<line x1="0" y1="20" x2="188" y2="20" class="plfo-axis"/><path d="${d}" class="plfo-trace"/>`
      + `<line x1="${(ph * 188).toFixed(1)}" y1="0" x2="${(ph * 188).toFixed(1)}" y2="40" class="plfo-head-line"/><circle cx="${(ph * 188).toFixed(1)}" cy="${y.toFixed(1)}" r="3.2" class="plfo-dot"/>`;
  }
  for (const [id, row] of prismLfo.rows) {
    const [src, key] = id.split('\u0000');
    const t = { src, key };
    if (!prismLfo.lfos.some((l) => l.targets.some((x) => x.src === src && x.key === key))) continue;
    const got = prismLfoControl(t);
    if (!got) continue;
    const v = prismLfoValue(t, got.c, got.base);
    row.show(v);
  }
}

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && prismLfo.mapping) { prismLfo.mapping = false; prismLfoRender(); }
});

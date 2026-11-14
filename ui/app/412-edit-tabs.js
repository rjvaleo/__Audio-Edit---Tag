// ═══════════════════════════════════ the Edit page: its bar and settings ══
//
// One bar of the ribbon's sections (`wtLayout`, 310), no tabs: RJ, 13 Nov
// 2026, "The tabs is too much". It runs down the right of the page, each
// section under its title. The icons carry no words; the tooltip has the
// name, the key and the settings the command will run with.
//
// The dialogs are knobs. Gain, Normalize, Strip silence, Insert silence,
// Repair click and Duplicate keep their settings behind a ▾ beside the
// command, and the command runs as it always did with the dialog answered in
// advance (`askAnswer`, 300): the same checks, the same edit op, the same
// message. The menus still open the dialog. See `docs/EDIT-PAGE.md`.

/// A command's tooltip: its name, its key, and what its knobs are set to.
function edTitleFor(id) {
  const it = WT_CMDS[id];
  if (!it) return '';
  const set = (ED_KNOBS[id] || []).map(([key, label, , , , fmt]) => `${label} ${fmt(edParams[key])}`).join(', ');
  return [it.name, it.key, set && `(${set})`].filter(Boolean).join('  ');
}

/// The ▾ beside a command with settings: it opens them, it does not run.
function edMoreButton(id) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'wt-more';
  b.dataset.more = id;
  b.title = `${WT_CMDS[id].name.replace(/…$/, '')}: its settings`;
  b.setAttribute('aria-label', b.title);
  b.setAttribute('aria-haspopup', 'dialog');
  b.setAttribute('aria-expanded', 'false');
  b.innerHTML = '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M2 3.5 5 6.5 8 3.5"/></svg>';
  b.onclick = (e) => { e.stopPropagation(); if ($('edKnobs')?.dataset.cmd === id) edKnobsClose(); else edKnobsOpen(id, b); };
  return b;
}

/// The settings of one command, beside its ▾: its knobs and the command itself.
function edKnobsOpen(id, from) {
  edKnobsClose();
  let pop = $('edKnobs');
  if (!pop) {
    pop = document.createElement('div');
    pop.id = 'edKnobs';
    pop.className = 'ed-kpop';
    pop.setAttribute('role', 'dialog');
    pop.hidden = true;
    document.body.appendChild(pop);
    window.addEventListener('mousedown', (e) => { if (!pop.hidden && !pop.contains(e.target) && !e.target.closest('.wt-more')) edKnobsClose(); });
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !pop.hidden) { edKnobsClose(); e.stopPropagation(); } }, true);
  }
  const it = WT_CMDS[id];
  pop.dataset.cmd = id;
  pop.setAttribute('aria-label', `${it.name} settings`);
  const run = document.createElement('button');
  run.type = 'button';
  run.className = 'ed-krun';
  run.dataset.run = id;
  run.innerHTML = wtIcon(id) + `<span>${WT_WORDS[id] || it.name}</span>`;
  run.onclick = () => { edKnobsClose(); edRun(id); };
  const ks = edKnobsFor(id);
  pop.replaceChildren(...ks, run);
  const btn = document.querySelector(`#waveTools .wt-btn[data-cmd="${id}"]`);
  run.disabled = !!btn?.disabled;
  pop.hidden = false;
  const at = from || btn, r = at.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight;
  const side = at.closest('.ed-side')?.getBoundingClientRect();
  if (side) {
    // Out to the left of the bar, level with the command: under it, it would
    // cover the commands below.
    pop.style.left = `${Math.round(Math.max(8, side.left - w - 8))}px`;
    pop.style.top = `${Math.round(Math.max(8, Math.min(innerHeight - h - 8, r.top + r.height / 2 - h / 2)))}px`;
  } else {
    pop.style.left = `${Math.round(Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2)))}px`;
    pop.style.top = `${Math.round(r.bottom + 6)}px`;
  }
  from?.setAttribute('aria-expanded', 'true');
}

function edKnobsClose() {
  const pop = $('edKnobs');
  if (!pop || pop.hidden) return;
  pop.hidden = true;
  delete pop.dataset.cmd;
  for (const b of document.querySelectorAll('.wt-more[aria-expanded="true"]')) b.setAttribute('aria-expanded', 'false');
  wtSync();
}

// ─────────────────────────────────────────────────────── the settings

/// What each dialog asked for, kept between sessions.
const ED_PARAM_DEF = { gainDb: 0, normDb: -0.3, rmsDb: -12, ceilDb: -0.3, thr: -40, minMs: 100, padMs: 10, insMs: 500, widthMs: 1, dupCount: 3 };
const edParams = Object.assign({ ...ED_PARAM_DEF }, (() => { try { return JSON.parse(localStorage.getItem('editParams') || '{}'); } catch { return {}; } })());
function edSaveParams() { try { localStorage.setItem('editParams', JSON.stringify(edParams)); } catch { /* private mode */ } }

const edFmt = {
  db: (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`,
  dbn: (v) => `${v.toFixed(1)} dB`,
  ms: (v) => (v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${v < 10 ? v.toFixed(2) : Math.round(v)} ms`),
  x: (v) => `×${Math.round(v)}`,
};
/// Each knob: [param, label, min, max, step, format, log, title].
const ED_KNOBS = {
  gain: [['gainDb', 'Gain', -24, 24, 0.1, edFmt.db, false, 'How much Gain adds or takes away, over the selection or the whole sound']],
  normalize: [['normDb', 'Peak', -24, 0, 0.1, edFmt.dbn, false, 'Where Normalize puts the loudest sample']],
  normalizeRms: [['rmsDb', 'Average', -36, 0, 0.1, edFmt.dbn, false, 'Where Normalize (RMS) puts the average'], ['ceilDb', 'Ceiling', -12, 0, 0.1, edFmt.dbn, false, 'The peak it may not pass']],
  stripSilence: [['thr', 'Below', -90, -6, 1, edFmt.dbn, false, 'Quieter than this counts as silence'], ['minMs', 'For', 5, 5000, 1, edFmt.ms, true, 'And for at least this long'], ['padMs', 'Leave', 0, 500, 1, edFmt.ms, false, 'Kept either side of each gap']],
  insertSilence: [['insMs', 'Length', 1, 10000, 1, edFmt.ms, true, 'How much silence Insert silence puts in at the cursor']],
  repairClick: [['widthMs', 'Width', 0.05, 50, 0.05, edFmt.ms, true, 'How much Repair click takes out at the worst click']],
  duplicate: [['dupCount', 'Copies', 1, 32, 1, edFmt.x, false, 'How many copies Duplicate adds after the selection']],
};
/// The answers each command's dialog would have been given.
const ED_ANSWERS = {
  gain: () => ({ db: edParams.gainDb }),
  normalize: () => ({ db: edParams.normDb }),
  normalizeRms: () => ({ db: edParams.rmsDb, ceilingDb: edParams.ceilDb }),
  stripSilence: () => ({ thresholdDb: edParams.thr, minMs: edParams.minMs, padMs: edParams.padMs, mode: 'remove' }),
  insertSilence: () => ({ ms: edParams.insMs }),
  repairClick: () => ({ widthMs: edParams.widthMs }),
  duplicate: () => ({ count: edParams.dupCount }),
};

/// Run a command from the page: with its knobs' values where it has any.
function edRun(id) {
  const it = WT_CMDS[id];
  if (!it) return;
  if (ED_ANSWERS[id]) askAnswer = ED_ANSWERS[id]();
  try { return it.run(); } finally { askAnswer = null; }
}

// The pictures on the knobs: what the setting does, drawn from its value.
const edA = (d) => `<path class="a" d="${d}"/>`, edF = (d) => `<path class="f" d="${d}"/>`, edR = (x) => x.toFixed(1);
const ED_GLYPH = {
  gainDb: (n) => { const k = 0.2 + n * 1.6; let d = ''; for (let i = 0; i <= 20; i++) d += `${i ? 'L' : 'M'}${1 + i} ${edR(8 - Math.sin(i / 20 * Math.PI * 4) * Math.min(7, 3.5 * k))}`; return edF('M1 1H21M1 15H21') + edA(d); },
  normDb: (n) => { const y = 8 - n * 7; return edF(`M1 ${edR(y)}H21M1 ${edR(16 - y)}H21`) + edA(`M1 8L4 ${edR(y)}L6 ${edR(16 - y)}L9 5L11 11L14 ${edR(y)}L16 ${edR(16 - y)}L21 8`); },
  rmsDb: (n) => { const h = 1 + n * 6; return edF('M1 1H21M1 15H21') + edA(`M2 ${edR(8 - h)}H20V${edR(8 + h)}H2Z`); },
  ceilDb: (n) => { const y = 7.5 - n * 6.5; return edA(`M1 ${edR(y)}H21`) + edF('M1 8L4 3L6 13L9 5L11 11L14 4L16 12L21 8'); },
  thr: (n) => { const y = 8 - n * 6; return edF(`M1 ${edR(y)}H21`) + edA('M1 8L3 2L5 14L7 8H14L16 4L18 12L21 8'); },
  minMs: (n) => { const w = 2 + n * 12; return edA(`M1 8L3 3L5 13L6 8H${edR(6 + w)}L${edR(8 + w)} 3L${edR(10 + w)} 13L21 8`) + edF(`M6 15H${edR(6 + w)}`); },
  padMs: (n) => { const w = 1 + n * 5; return edF('M8 8H14') + edA(`M${edR(8 - w)} 3V13M${edR(14 + w)} 3V13`); },
  insMs: (n) => { const w = 2 + n * 14; return edA(`M1 8H${edR(11 - w / 2)}M${edR(11 + w / 2)} 8H21`) + edF(`M${edR(11 - w / 2)} 3V13M${edR(11 + w / 2)} 3V13`); },
  widthMs: (n) => edA(`M1 9C4 6 6 12 9 9L10 ${edR(9 - (1 - n) * 7)}L11 ${edR(9 + (1 - n) * 5)}L12 9C15 6 17 12 21 9`),
  dupCount: (n) => { const k = 1 + Math.round(n * 4); let d = ''; for (let i = 0; i < k; i++) d += `M${edR(2 + i * (18 / k))} 4h${edR(18 / k - 1.5)}v8h-${edR(18 / k - 1.5)}Z`; return edA(d); },
};

/// The knobs that sit after a command, if it has any.
function edKnobsFor(id) {
  return (ED_KNOBS[id] || []).map(([key, label, min, max, step, fmt, log, title]) => {
    const norm = (v) => Math.min(1, Math.max(0, log ? Math.log(v / min) / Math.log(max / min) : (v - min) / (max - min)));
    let paint = () => {};
    const el = knob(label, edParams[key], min, max, step, fmt,
      (v) => { edParams[key] = v; paint(v); },
      (v) => { edParams[key] = v; edSaveParams(); paint(v); wtSync(); },
      log, ED_PARAM_DEF[key]);
    el.dataset.k = key;
    el.classList.add('ed-knob');
    el.title = `${title} — double-click to reset to ${fmt(ED_PARAM_DEF[key])}`;
    el.insertAdjacentHTML('afterbegin', '<svg class="gl" viewBox="0 0 22 16" aria-hidden="true"></svg>');
    const glyph = el.firstElementChild;
    paint = (v) => { glyph.innerHTML = ED_GLYPH[key](norm(v), v); };
    const sync = el.sync;
    el.sync = (v) => { sync(v); paint(v); };
    paint(edParams[key]);
    return el;
  });
}

// ───────────────────────────────────────────────────── what is shown

function edSavePrefs() { try { localStorage.setItem('editShow', JSON.stringify(edPrefs)); } catch { /* private mode */ } }

/// Flip one of the View tab's switches and redraw what it changes.
function edToggle(k) {
  edPrefs[k] = !edPrefs[k];
  edSavePrefs();
  if (k === 'spec') edApplySpec();
  if (k === 'level') document.body.classList.toggle('ed-level-off', !edPrefs.level);
  drawWave();
  edPaintMarks();
  wtSync();
}

/// The spectrogram is a choice on this page: the lane splits only while it is on.
function edApplySpec() {
  if (!document.body.classList.contains('wavepage')) return;
  state.showSpec = edPrefs.spec;
  $('specOn').checked = edPrefs.spec;
  $('lane').classList.toggle('split', edPrefs.spec);
  if (edPrefs.spec) loadSpectrogram();
  redrawLane();
}

/// A region between every pair of hits, within the selection when there is one.
function edRegionsFromHits() {
  const hits = edSound.hits || [];
  if (hits.length < 2 || !state.annotations) return;
  const total = state.edit?.frames || state.view.frames || 0;
  const [a, b] = state.sel ? [state.sel.start, state.sel.end] : [0, total];
  const pts = [...hits.filter((h) => h >= a && h < b), b];
  if (pts.length < 2) { toast('No hits in the selection'); return; }
  const start = state.annotations.regions.length;
  for (let i = 0; i + 1 < pts.length; i++) state.annotations.regions.push({ start: pts[i], end: pts[i + 1], label: `hit ${start + i + 1}` });
  saveAnnotations();
  toast(`${pts.length - 1} region${pts.length === 2 ? '' : 's'}, one per hit`);
}

wtBuild();
document.body.classList.toggle('ed-level-off', !edPrefs.level);

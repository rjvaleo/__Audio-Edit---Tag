// ══════════════════════════════════════════════════════ Now Playing ══
//
// The transport's home, on every page: the bar across the top of the centre.
// The buttons in it are the app's own (`#playBtn` and the rest, wired in
// 020-audio.js); this file adds what the bar shows around them: the sound as
// a strip you can click, its tempo, the meter, and the Look for the whole app.
// See `docs/EDIT-PAGE.md`.
//
// Before this the transport sat somewhere different on six pages and was
// missing on two (RJ, 10 Nov 2026: "we need to move the transport someplace
// that it stays all the time").

/// The transport's icons, drawn on a 24-unit square like the rail's. A
/// function rather than a table: `reflectTransport` can run before this file.
function nbIcon(k) {
  const d = {
    play: '<path d="M7 5 L19 12 L7 19Z" fill="currentColor" stroke="none"/>',
    pause: '<rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none"/><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none"/>',
    stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="1.5" fill="currentColor" stroke="none"/>',
    loop: '<path d="M5 9.5V8a2 2 0 0 1 2-2h11l-3-3M19 14.5V16a2 2 0 0 1-2 2H6l3 3"/>',
    rec: '<circle cx="12" cy="12" r="5.5" fill="currentColor" stroke="none"/>',
  }[k];
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
}

/// Is what the bar plays playing? The main sound, or on the Prism page the
/// Prism deck (`prismOwnsBar`, `ui/prism-pad.js`).
function nbPlaying() {
  return prismOwnsBar() ? prismDeck.playing : engine.playing;
}

/// Paint the play button from the engine's state. Called by `reflectTransport`.
function nbPaintPlay() {
  const b = $('playBtn');
  if (!b) return;
  b.innerHTML = nbIcon(nbPlaying() ? 'pause' : 'play');
  b.setAttribute('aria-label', nbPlaying() ? 'Pause' : 'Play');
}

/// The Prism page came or went: the whole bar, from whichever it now plays.
function nbHandOver() {
  $('playBtn').classList.toggle('on', nbPlaying());
  nbPaintPlay();
  paintLoop();
  nbSetFile(state.selectedFile);
  nbDrawStrip();
  if (prismOwnsBar()) prismBarShow(); else paintTime();
}

// ─────────────────────────────────────────────────── the sound, as a strip

/// The whole sound, from the overview's own peaks: the same map, smaller.
function nbDrawStrip() {
  const cv = $('nbStripCanvas');
  if (!cv) return;
  const w = cv.clientWidth, h = cv.clientHeight, dpr = window.devicePixelRatio || 1;
  if (!w || !h) return;
  cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const p = prismOwnsBar() ? prismDeck.wave : state.overview;
  if (!p || !p.channels?.length) return;
  const { min, max } = p.channels[0], n = p.columns || max.length, mid = h / 2;
  g.fillStyle = getComputedStyle(cv).getPropertyValue('--nb-wave').trim() || '#9aa6d6';
  for (let x = 0; x < w; x++) {
    const i = Math.min(n - 1, Math.floor(x / w * n));
    const a = mid - max[i] * mid * 0.92, b = mid - min[i] * mid * 0.92;
    g.fillRect(x, a, 1, Math.max(1, b - a));
  }
  nbTick();
}

/// The head and the selection on the strip, the clock's tempo, and the meter.
function nbTick() {
  const head = $('nbHead');
  if (!head) return;
  if (prismOwnsBar()) { head.style.left = `${prismDeckAt() * 100}%`; $('nbSel').hidden = true; return; }
  const total = state.view?.frames || state.overview?.frames || 0, sr = state.view?.sampleRate || 44100;
  const at = engine.playing ? playbackTime() * sr : (state.cue || 0);
  head.style.left = total ? `${Math.min(100, at / total * 100)}%` : '0';
  const sel = $('nbSel');
  if (state.sel && total) { sel.hidden = false; sel.style.left = `${state.sel.start / total * 100}%`; sel.style.width = `${(state.sel.end - state.sel.start) / total * 100}%`; } else sel.hidden = true;
}

(function wireStrip() {
  const strip = $('nbStrip');
  if (!strip) return;
  let down = false;
  const go = (e) => {
    if (prismOwnsBar()) {
      const r = strip.getBoundingClientRect();
      if (r.width) prismDeckSeek((e.clientX - r.left) / r.width);
      return;
    }
    const p = state.overview, f = state.selectedFile;
    if (!p || !f) return;
    const total = state.view?.frames || p.frames || 0, r = strip.getBoundingClientRect();
    if (!total || !r.width) return;
    const frame = Math.round(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * total);
    setCue(frame);
    if (engine.path === f.path) seekSource(frame);
    // On the edit pages, bring the view to where you went.
    if (state.mode === 'edit' && typeof centreOn === 'function') centreOn(frame);
    nbTick();
  };
  strip.addEventListener('mousedown', (e) => { down = true; go(e); });
  window.addEventListener('mousemove', (e) => { if (down) go(e); });
  window.addEventListener('mouseup', () => { down = false; });
  if (window.ResizeObserver) new ResizeObserver(nbDrawStrip).observe(strip);
})();

/// The sound's name and what is known about it. Called from `renderMetaStrip`.
function nbSetFile(f) {
  if (!$('nbName')) return;
  if (prismOwnsBar()) { prismBarName(); return; }
  $('nbName').textContent = f ? (f.name || f.path.split('/').pop()) : 'no sound';
  const bits = f ? [fmtDur(f.duration), f.category].filter(Boolean) : [];
  $('nbMeta').textContent = bits.join(' · ');
  nbSetTempo(f);
}

/// Chop's count when it has counted this sound; the library's figure
/// otherwise; a dash when neither knows.
function nbSetTempo(f = state.selectedFile) {
  const v = $('nbBpmV'), s = $('nbBpmS');
  if (!v) return;
  let bpm = 0, say = 'BPM';
  try {
    if (window.Chop && f && Chop.state.path === f.path && Chop.state.slices) {
      bpm = Chop.bpm();
      const bars = Chop.settings.bars;
      if (bars) say = `BPM · ${bars} bar${bars === 1 ? '' : 's'}`;
    }
  } catch { /* Chop not built yet */ }
  if (!bpm && f?.bpm) bpm = +f.bpm;
  v.textContent = bpm ? Number(bpm).toFixed(1) : '—';
  s.textContent = say;
}

// ───────────────────────────────────────────────────────────── the meter

/// The master's level, asked for only while something plays: a meter on every
/// page must not poll the engine forever while nothing is sounding.
let nbMeterTimer = null;
const nbLevel = { l: -120, r: -120 };
function nbMeterRun() {
  if (nbMeterTimer || !engine.playing || noAudio()) return;
  nbMeterTimer = setInterval(async () => {
    if (!engine.playing) { clearInterval(nbMeterTimer); nbMeterTimer = null; nbPaintMeter(-120, -120); return; }
    try {
      const d = await api('/api/engine/master?fft=512&bands=16');
      nbPaintMeter(d.left?.vuDb ?? -120, d.right?.vuDb ?? d.left?.vuDb ?? -120);
    } catch { nbPaintMeter(-120, -120); }
  }, 90);
}
function nbPaintMeter(l, r) {
  // Falls back gently, rises at once, as a VU does.
  nbLevel.l = l > nbLevel.l ? l : Math.max(l, nbLevel.l - 3);
  nbLevel.r = r > nbLevel.r ? r : Math.max(r, nbLevel.r - 3);
  const pc = (db) => `${Math.max(0, Math.min(1, (db + 60) / 60)) * 100}%`;
  if ($('nbMeterL')) { $('nbMeterL').style.width = pc(nbLevel.l); $('nbMeterR').style.width = pc(nbLevel.r); }
  const top = Math.max(nbLevel.l, nbLevel.r);
  if ($('nbDb')) $('nbDb').textContent = top > -90 ? `${top.toFixed(1)} dB` : '−∞';
}

// ───────────────────────────────────────────────────────────── the Look

/// Grain's five Looks, for the whole app at once. One key, `mglLook`, which
/// Chop and Grain already read; the bar is where it is set from now on.
const NB_LOOKS = [['AD', 'Graphite + Acrylic', 'linear-gradient(135deg,#262a30 50%,#d7e2ff 50%)'], ['A', 'Graphite', '#3a3f47'],
  ['B', 'Glass', 'linear-gradient(135deg,#3c8caa,#825aaa)'], ['C', 'Ceramic', '#e8dcc8'], ['D', 'Acrylic', 'conic-gradient(#3b4060,#2c5d5f,#5e4c3d,#4a3b5e,#3b4060)']];
function nbLook() {
  try { return localStorage.getItem('mglLook') || 'AD'; } catch { return 'AD'; }
}
function nbSetLook(k) {
  try { localStorage.setItem('mglLook', k); } catch { /* private mode */ }
  document.documentElement.dataset.mglLook = k;
  document.querySelectorAll('#nbLook button').forEach((b) => b.classList.toggle('on', b.dataset.s === k));
  if (typeof chopSetLook === 'function' && document.querySelector('.chop-app')) chopSetLook(k);
  if (typeof edSetLook === 'function') edSetLook(k);
}

/// The bar starts where the rail ends, which moves as the rail opens and shuts.
function nbPlace() {
  const rail = $('leftRail'), shell = rail?.parentElement;
  if (!rail || !shell) return;
  shell.style.setProperty('--nb-left', `${Math.round(rail.getBoundingClientRect().right - shell.getBoundingClientRect().left)}px`);
}

(function wireNowBar() {
  const rail = $('leftRail');
  nbPlace();
  if (window.ResizeObserver) new ResizeObserver(nbPlace).observe(rail);
  $('nbLook').innerHTML = NB_LOOKS.map(([k, n, bg]) => `<button type="button" data-s="${k}" title="Look: ${n}" aria-label="Look: ${n}"><i style="background:${bg}"></i></button>`).join('');
  $('nbLook').addEventListener('click', (e) => { const b = e.target.closest('button[data-s]'); if (b) nbSetLook(b.dataset.s); });
  document.documentElement.dataset.mglLook = nbLook();
  document.querySelectorAll('#nbLook button').forEach((b) => b.classList.toggle('on', b.dataset.s === nbLook()));
  for (const k of ['stop', 'loop', 'rec']) { const b = $(`${k}Btn`); if (b) b.innerHTML = nbIcon(k); }
  nbPaintPlay();
  nbSetFile(state.selectedFile);
})();

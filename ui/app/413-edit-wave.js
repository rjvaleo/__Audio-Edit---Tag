// ══════════════════════════════════════════ the Edit page: the wave ══
//
// What D adds around the app's own lane (040): a time ruler under the
// overview, a level ruler down the lane's left edge, Rainbow colour on the
// waveform (`edColumnColours`, read by `drawWave`), the hits and the loudest
// spots, the counters under the wave, and the meters that slide out from the
// right edge while you look at them. See `docs/EDIT-PAGE.md`.

const edOn = () => document.body.classList.contains('wavepage');

/// One colour per column of the peaks, or null when Rainbow is off, the page is
/// another one, or the sound has not been measured yet.
function edColumnColours(p) {
  if (!edOn() || !edPrefs.rainbow || !edSound.an || edSound.path !== state.selectedFile?.path) return null;
  const span = (p.to - p.from) || 1, out = new Array(p.columns);
  for (let i = 0; i < p.columns; i++) {
    const c = edColourAt(p.from + (i + 0.5) * span / p.columns);
    out[i] = c ? `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})` : null;
  }
  return out;
}

function edCanvas(cv) {
  const w = cv.clientWidth, h = cv.clientHeight, dpr = window.devicePixelRatio || 1;
  if (!w || !h) return null;
  cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  return { g, w, h };
}
const edInk = (name, fallback) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

/// Seconds along the top of the wave, at a spacing that leaves room to read.
function edPaintTime() {
  const cv = $('edTimeCanvas');
  if (!cv || !edOn()) return;
  const c = edCanvas(cv);
  if (!c) return;
  const { g, w, h } = c, sr = state.view.sampleRate || 44100, { from, to } = state.view;
  if (!(to > from)) return;
  const span = (to - from) / sr, steps = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 30, 60];
  const st = steps.find((x) => x / span * w > 70) || 60, x = (t) => (t * sr - from) / (to - from) * w;
  g.font = `9px ${edInk('--mgl-mono', 'monospace')}`; g.textBaseline = 'top';
  g.fillStyle = edInk('--m-t3', '#858b94');
  for (let t = Math.floor(from / sr / st) * st; t <= to / sr + st; t += st) {
    const px = x(t);
    g.globalAlpha = 0.8; g.fillRect(px, 0, 1, h);
    g.globalAlpha = 0.4; for (let j = 1; j < 5; j++) g.fillRect(x(t + st * j / 5), h * 0.6, 1, h);
    g.globalAlpha = 1;
    g.fillText(st < 0.1 ? t.toFixed(3) : st < 1 ? `${t.toFixed(1)} s` : `${t.toFixed(0)} s`, px + 3, 2);
  }
}

/// Decibels down the lane's left edge, one scale per channel, against the same
/// half-height `drawWave` uses.
function edPaintLevel() {
  const cv = $('edLevelCanvas'), wave = $('waveCanvas');
  if (!cv || !edOn() || !edPrefs.level) return;
  cv.style.height = `${wave.clientHeight}px`;
  const c = edCanvas(cv);
  if (!c) return;
  const { g, w, h } = c, nch = state.peaks?.channels?.length || 1, laneH = h / nch;
  g.font = `9px ${edInk('--mgl-mono', 'monospace')}`; g.textAlign = 'right'; g.textBaseline = 'middle';
  g.fillStyle = edInk('--m-t3', '#858b94');
  for (let ch = 0; ch < nch; ch++) {
    const mid = ch * laneH + laneH / 2, half = (laneH / 2) * 0.92;
    for (const db of [0, -3, -6, -12, -24]) {
      const a = Math.pow(10, db / 20);
      for (const s of [1, -1]) {
        const y = mid - s * a * half;
        g.globalAlpha = 0.7; g.fillRect(w - 5, y, 5, 1); g.globalAlpha = 1;
        if (s > 0 && laneH > 90) g.fillText(db === 0 ? '0' : `${db}`, w - 7, y + (db === 0 ? 5 : 0));
      }
    }
    g.globalAlpha = 0.5; g.fillRect(w - 8, mid, 8, 1); g.globalAlpha = 1;
  }
}

/// The hits along the top of the wave and the loudest spots along its foot.
function edPaintMarks() {
  const cv = $('edMarksCanvas'), wave = $('waveCanvas');
  if (!cv || !edOn()) return;
  cv.style.height = `${wave.clientHeight}px`;
  const c = edCanvas(cv);
  if (!c) return;
  const { g, w, h } = c, { from, to } = state.view;
  if (!(to > from)) return;
  const x = (f) => (f - from) / (to - from) * w;
  if (edPrefs.hits) {
    g.fillStyle = 'rgba(255,255,255,.6)';
    for (const f of edSound.hits) { const px = x(f); if (px < 0 || px > w) continue; g.fillRect(px, 0, 1, 9); g.beginPath(); g.moveTo(px - 2.5, 9); g.lineTo(px + 3.5, 9); g.lineTo(px + 0.5, 13); g.fill(); }
  }
  if (edPrefs.loud) {
    g.fillStyle = '#ff6a3d'; g.shadowColor = '#ff6a3d'; g.shadowBlur = 4;
    for (const s of edSound.loud) { const px = x(s.at); if (px < 0 || px > w) continue; g.beginPath(); g.moveTo(px, h - 11); g.lineTo(px + 5, h - 2); g.lineTo(px - 5, h - 2); g.fill(); }
    g.shadowBlur = 0;
  }
}

/// Cursor, start, end, length, peak, RMS and how much is shown: the numbers an
/// editor keeps in view, where the metadata strip used to be.
function edPaintCounters() {
  const box = $('edCounters');
  if (!box || !edOn()) return;
  const sr = state.view.sampleRate || 44100, total = state.edit?.frames || state.view.frames || 0;
  const sel = state.sel && state.sel.end > state.sel.start;
  const [a, b] = sel ? [state.sel.start, state.sel.end] : [0, total];
  const lv = edLevels(a, b);
  const t = (f) => fmtTime(f / sr), all = sel ? '' : ' · all';
  const cells = [
    ['cursor', 'Cursor', t(engine.playing ? playbackTime() * sr : state.cue || 0), 'acc'],
    ['start', `Start${all}`, t(a)], ['end', `End${all}`, t(b)], ['length', `Length${all}`, `${((b - a) / sr).toFixed(3)} s`],
    ['peak', `Peak${all}`, lv ? `${lv.peak.toFixed(1)} dB` : '—'], ['rms', `RMS${all}`, lv ? `${lv.rms.toFixed(1)} dB` : '—'],
    ['view', 'View', `${((state.view.to - state.view.from) / sr).toFixed(3)} s`],
  ];
  if (!box.childElementCount) box.innerHTML = cells.map(([k]) => `<div class="ed-c" data-c="${k}"><span></span><b></b></div>`).join('') + '<span class="ed-grow"></span><span class="ed-say" id="edSay">Drag the orange squares to fade · the pill to change level · an edge to move it · right-click for the pie · ⌘K for every command</span>';
  for (const [k, label, v, cls] of cells) {
    const el = box.querySelector(`[data-c="${k}"]`);
    el.classList.toggle('acc', cls === 'acc');
    el.firstElementChild.textContent = label;
    el.lastElementChild.textContent = v;
  }
  edPaintMeters(lv);
}

/// The meters that slide out over the wave from its right edge.
function edPaintMeters(lv) {
  const box = $('edMeters');
  if (!box) return;
  const pc = (db) => `${Math.max(0, Math.min(1, (db + 60) / 60)) * 100}%`;
  $('edmPeak').style.height = lv ? pc(lv.peak) : '0';
  $('edmRms').style.height = lv ? pc(lv.rms) : '0';
  $('edmPeakV').textContent = lv ? lv.peak.toFixed(1) : '—';
  $('edmRmsV').textContent = lv ? lv.rms.toFixed(1) : '—';
  const an = edSound.an, sel = state.sel && state.sel.end > state.sel.start;
  let lo = 0, mi = 0, hi = 0;
  if (an) {
    const f0 = sel ? Math.floor(state.sel.start / an.HOP) : 0, f1 = sel ? Math.ceil(state.sel.end / an.HOP) : an.F;
    for (let f = f0; f < Math.min(f1, an.F); f++) { lo += an.low[f]; mi += an.mid[f]; hi += an.high[f]; }
  }
  const t = lo + mi + hi || 1;
  $('edmBands').innerHTML = [[lo, CHOP_LOW], [mi, CHOP_MID], [hi, CHOP_HIGH]].map(([v, c]) => `<i style="width:${v / t * 100}%;background:rgb(${c})"></i>`).join('');
  $('edmHits').textContent = edSound.hits.length;
  $('edmLoud').textContent = edSound.loud.length;
}

/// Everything on the wave that follows the view: called after every draw.
function edAfterDraw() {
  if (!edOn()) return;
  edPaintTime();
  edPaintLevel();
  edPaintMarks();
  edPaintCounters();
  if (typeof edPaintHands === 'function') edPaintHands();
}

/// The sound has been read or measured: colour, marks and numbers catch up.
function edSoundReady() {
  if (GS.showing) GS_KEYS.ov = '';
  if (!edOn()) return;
  drawWave();
  drawOverview();
  edAfterDraw();
  wtSync();
}

/// Called by `setMode` for every mode change: on the Edit page or off it.
function edPageSync(on) {
  if (!on) return;
  edApplySpec();
  edLoadSound();
  requestAnimationFrame(() => { redrawLane(); edAfterDraw(); });
}

/// The Look changed (the Now Playing bar): the canvases repaint in its colours.
function edSetLook() {
  if (!edOn()) return;
  drawWave();
  edAfterDraw();
}

/// While playing: only the cursor's number moves, sixty times a second.
function edTickCursor() {
  const el = document.querySelector('#edCounters [data-c="cursor"] b');
  if (el && edOn()) el.textContent = fmtTime(playbackTime());
}

// ============================================================ the Library page
//
// `mode: 'pclib'` (`'library'` is an old name for Browse), a page of its own after Clone (RJ, 16 Nov 2026: "after
// clone, let's do library … bring in the library that's running on the PC
// controller server"). The PC's own sound library (`pc-sounds`: every sound
// its models made), by the words that made them. Mock-up:
// WORK DIR/page-mockups/library.html.
//
// - The list is the PC's index (`GET /api/pc/library`).
// - A sound is heard and drawn from `GET /api/pc/audio`, which keeps a copy in
//   the data folder, not in the library: nothing is copied until it is asked.
// - Open on Grain / Chop / Edit and Copy bring it into `Made/PC/`
//   (`POST /api/pc/fetch`).
//
// One fixed size (three columns, 360 · 720 · 400); the lists scroll inside.

const LB = {
  built: false, list: null, err: '', busy: false,
  kind: '', order: 'prompt', q: '', group: null, pick: null,
  playing: null, loop: false, audio: null, raf: 0,
  peaks: new Map(),   // file -> Float32Array of peaks, or 'wait' / 'bad'
  queue: [], running: 0, acting: '',
};
const LB_MODELS = { 'stable-audio-open-small': 'Stable Audio Open Small', tangoflux: 'TangoFlux', 'ace-step-1.5': 'ACE-Step 1.5' };
// (The app's own escape: a quote inside a regex here would blind tools/ui-check.mjs.)
const lbEsc = (s) => uiEsc(s);
const lbUrl = (x) => `/api/pc/audio?file=${encodeURIComponent(x.file)}`;
const LB_PLAY = '<svg viewBox="0 0 10 10"><path d="M2 1 9 5 2 9Z"/></svg>';
const LB_STOP = '<svg viewBox="0 0 10 10"><rect x="2" y="2" width="6" height="6"/></svg>';

function lbBuild() {
  if (LB.built) return;
  LB.built = true;
  $('libraryView').innerHTML = `<div class="lb-page">
    <section class="st-panel lb-head">
      <span class="lb-title">LIBRARY <span>/ THE PC'S SOUNDS</span></span>
      <span class="lb-tag" id="lbSync"></span>
      <span class="lb-tag" id="lbCount"></span>
      <span class="lb-grow"></span>
      <span id="lbKind"></span>
      <span id="lbOrder"></span>
      <button class="st-btn" id="lbRefresh" title="Read the PC's library again">Refresh</button>
    </section>
    <div class="lb-body">
      <section class="st-panel lb-col">
        <div class="lb-ph"><b>PROMPTS</b><span class="lb-meta" id="lbPCount"></span></div>
        <input class="lb-q" id="lbQ" type="search" placeholder="Search the words" autocomplete="off">
        <div class="lb-list" id="lbGroups"></div>
      </section>
      <section class="st-panel lb-col">
        <div class="lb-ph"><b id="lbGName">SOUNDS</b><span class="lb-meta" id="lbGMeta"></span></div>
        <div class="lb-tiles" id="lbTiles"></div>
      </section>
      <section class="st-panel lb-col" id="lbDetail">
        <div class="lb-ph"><b>THE SOUND</b><span class="lb-grow"></span><span id="lbDPill"></span></div>
        <div class="lb-well lb-big"><canvas id="lbDWave" width="376" height="150"></canvas></div>
        <div class="lb-row"><button class="lb-play" id="lbDPlay" title="Hear it, from the PC">${LB_PLAY}</button><span class="lb-meta" id="lbDLen"></span><span class="lb-grow"></span><span id="lbLoop"></span></div>
        <div class="lb-prompt" id="lbDPrompt"></div>
        <div class="lb-facts">
          <div class="lb-fact"><b id="lbDSeed"></b><span>seed</span></div>
          <div class="lb-fact"><b id="lbDModel"></b><span>model</span></div>
          <div class="lb-fact"><b id="lbDTime"></b><span>made</span></div>
          <div class="lb-fact"><b id="lbDFile"></b><span>file, in pc-sounds</span></div>
        </div>
        <span class="lb-cap">Use it</span>
        <div class="lb-acts" id="lbActs">
          <button class="st-btn" data-act="grain" title="Copy it into Made/PC and open it on Grain">Open on Grain</button>
          <button class="st-btn" data-act="chop" title="Copy it into Made/PC and open it on Chop">Open on Chop</button>
          <button class="st-btn" data-act="wave" title="Copy it into Made/PC and open it on Edit">Open on Edit</button>
          <button class="st-btn" data-act="copy" title="Copy it into your library, under Made/PC">Copy into my library</button>
        </div>
        <span class="lb-grow"></span>
        <span class="lb-meta" id="lbDNote">from the PC · nothing is copied until you ask</span>
      </section>
    </div>
  </div>`;
  $('lbKind').append(uiSeg({ h: 24, value: LB.kind, items: [{ k: '', label: 'All' }, { k: 'hit', label: 'Hits' }, { k: 'loop', label: 'Loops' }], onPick: (k) => { LB.kind = k; lbGroupsDraw(); } }));
  $('lbOrder').append(uiSeg({ h: 24, value: LB.order, items: [{ k: 'prompt', label: 'By prompt' }, { k: 'new', label: 'Newest' }], onPick: (k) => { LB.order = k; lbGroupsDraw(); } }));
  $('lbLoop').append(uiSeg({ h: 20, value: 'once', items: [{ k: 'once', label: 'Once' }, { k: 'loop', label: 'Loop' }], onPick: (k) => { LB.loop = k === 'loop'; if (LB.audio) LB.audio.loop = LB.loop; } }));
  $('lbRefresh').onclick = () => lbLoad();
  $('lbQ').oninput = () => { LB.q = $('lbQ').value.trim().toLowerCase(); lbGroupsDraw(); };
  $('lbGroups').onclick = (e) => {
    const g = e.target.closest('.lb-grp');
    if (!g) return;
    LB.group = g.dataset.p;
    LB.pick = null;
    lbGroupsDraw();
  };
  $('lbTiles').onclick = (e) => {
    const t = e.target.closest('.lb-tile');
    if (!t) return;
    const x = lbShown()[+t.dataset.i];
    if (!x) return;
    LB.pick = x;
    if (e.target.closest('.lb-play')) lbPlay(x);
    else lbTilesDraw();
  };
  $('lbDPlay').onclick = () => LB.pick && lbPlay(LB.pick);
  $('lbActs').onclick = (e) => { const b = e.target.closest('[data-act]'); if (b && LB.pick) lbUse(b.dataset.act, LB.pick); };
}

function lbEnter() {
  lbBuild();
  if (!LB.list && !LB.busy) lbLoad();
  else lbGroupsDraw();
}

function lbLeave() {
  lbStop();
}

async function lbLoad() {
  LB.busy = true;
  LB.err = '';
  lbStatus();
  try {
    const rows = await api('/api/pc/library');
    LB.list = (Array.isArray(rows) ? rows : []).filter((x) => x && typeof x.file === 'string');
  } catch (e) {
    LB.list = LB.list || [];
    LB.err = e.message || String(e);
  }
  LB.busy = false;
  lbGroupsDraw();
}

function lbStatus() {
  const s = $('lbSync');
  if (!s) return;
  s.className = `lb-tag${LB.busy ? '' : LB.err ? ' bad' : ' ok'}`;
  s.textContent = LB.busy ? 'READING THE PC…' : LB.err ? '● THE PC DID NOT ANSWER' : '● THE PC · CONNECTED';
  s.title = LB.err || '';
}

const lbSounds = () => (LB.list || []).filter((x) => !LB.kind || x.type === LB.kind);
const lbWords = (x) => x.prompt || x.label || x.file.split('/').pop();

function lbGroups() {
  const m = new Map();
  for (const x of lbSounds()) {
    const p = lbWords(x);
    if (LB.q && !p.toLowerCase().includes(LB.q)) continue;
    if (!m.has(p)) m.set(p, []);
    m.get(p).push(x);
  }
  const g = [...m.entries()].map(([p, xs]) => ({ p, xs, t: xs.reduce((a, x) => ((x.time || '') > a ? x.time : a), '') }));
  return LB.order === 'new' ? g.sort((a, b) => b.t.localeCompare(a.t)) : g.sort((a, b) => a.p.localeCompare(b.p, undefined, { sensitivity: 'base' }));
}

const lbShown = () => lbGroups().find((g) => g.p === LB.group)?.xs || [];

function lbGroupsDraw() {
  if (!LB.built) return;
  lbStatus();
  const gs = lbGroups();
  if (!LB.group || !gs.some((g) => g.p === LB.group)) LB.group = gs[0]?.p ?? null;
  $('lbCount').textContent = LB.list ? `${lbSounds().length} SOUNDS` : '';
  $('lbPCount').textContent = `${gs.length}`;
  $('lbGroups').innerHTML = gs.map((g) => {
    const k = g.xs.every((x) => x.type === 'hit') ? 'var(--f-attack)' : g.xs.every((x) => x.type === 'loop') ? 'var(--f-tone)' : 'var(--look-text-3)';
    return `<div class="lb-grp${g.p === LB.group ? ' on' : ''}" data-p="${lbEsc(g.p)}" title="${lbEsc(g.p)}"><span><i class="lb-k" style="background:${k}"></i>${lbEsc(g.p)}</span><i>${g.xs.length}</i></div>`;
  }).join('') || `<div class="lb-empty">${LB.busy ? 'Reading the PC’s library…' : LB.err ? `The PC’s library could not be read: ${lbEsc(LB.err)}` : (LB.list || []).length ? 'Nothing matches.' : 'Nothing in the PC’s library yet.'}</div>`;
  lbTilesDraw();
}

function lbTilesDraw() {
  const xs = lbShown();
  $('lbGName').textContent = LB.group ? LB.group.toUpperCase() : 'SOUNDS';
  $('lbGName').title = LB.group || '';
  $('lbGMeta').textContent = xs.length ? `${xs.length} sound${xs.length > 1 ? 's' : ''}` : '';
  if (!LB.pick || !xs.includes(LB.pick)) LB.pick = xs[0] || null;
  $('lbTiles').innerHTML = xs.map((x, i) => `<div class="lb-tile${x === LB.pick ? ' on' : ''}" data-i="${i}">
    <div class="lb-well lb-wv"><canvas width="212" height="54"></canvas></div>
    <div class="lb-r"><button class="lb-play${LB.playing === x ? ' on' : ''}" title="Hear it, from the PC">${LB.playing === x ? LB_STOP : LB_PLAY}</button><b>seed ${lbEsc(x.seed ?? '—')}</b><span class="lb-grow"></span>${lbPill(x)}<span>${lbSecs(x)}</span></div>
  </div>`).join('');
  xs.forEach((x) => lbWant(x));
  lbWavesDraw();
  lbDetailDraw();
}

const lbPill = (x) => (x.type ? `<span class="lb-pill ${x.type === 'hit' ? 'hit' : 'loop'}">${lbEsc(String(x.type).toUpperCase())}</span>` : '');
const lbSecs = (x) => (Number.isFinite(+x.seconds) ? `${(+x.seconds).toFixed(1)} s` : '');

function lbDetailDraw() {
  const x = LB.pick;
  $('lbDetail').classList.toggle('none', !x);
  for (const b of $('lbActs').querySelectorAll('button')) b.disabled = !x || !!LB.acting;
  if (!x) return;
  $('lbDPill').innerHTML = lbPill(x);
  $('lbDPrompt').textContent = lbWords(x);
  $('lbDSeed').textContent = x.seed ?? '—';
  $('lbDModel').textContent = LB_MODELS[x.model] || x.model || '—';
  $('lbDTime').textContent = x.time ? new Date(x.time).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
  $('lbDFile').textContent = x.file.split('/').pop();
  $('lbDFile').title = x.file;
  $('lbDLen').textContent = lbSecs(x);
  $('lbDPlay').classList.toggle('on', LB.playing === x);
  $('lbDPlay').innerHTML = LB.playing === x ? LB_STOP : LB_PLAY;
  $('lbDNote').textContent = LB.acting ? 'copying it from the PC…' : 'from the PC · nothing is copied until you ask';
}

// ─── the pictures ────────────────────────────────────────────────────────────
// A sound's shape is read from the sound itself, two at a time, once each.

function lbWant(x) {
  if (LB.peaks.has(x.file)) return;
  LB.peaks.set(x.file, 'wait');
  LB.queue.push(x);
  lbPump();
}

function lbPump() {
  while (LB.running < 2 && LB.queue.length) {
    const x = LB.queue.shift();
    LB.running++;
    lbPeaks(x).then((p) => LB.peaks.set(x.file, p), () => LB.peaks.set(x.file, 'bad')).finally(() => {
      LB.running--;
      if (state.mode === 'pclib') lbWavesDraw();
      lbPump();
    });
  }
}

async function lbPeaks(x) {
  const r = await fetch(lbUrl(x));
  if (!r.ok) throw new Error(`${r.status}`);
  const C = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const buf = await new C(1, 1, 44100).decodeAudioData(await r.arrayBuffer());
  const n = 376, out = new Float32Array(n), ch = buf.getChannelData(0), step = Math.max(1, Math.floor(ch.length / n));
  for (let i = 0; i < n; i++) {
    let m = 0;
    for (let j = i * step, e = Math.min(ch.length, j + step); j < e; j++) { const a = Math.abs(ch[j]); if (a > m) m = a; }
    out[i] = m;
  }
  return out;
}

function lbWaveInto(cv, x) {
  const g = cv.getContext('2d'), W = cv.width, H = cv.height;
  g.clearRect(0, 0, W, H);
  const p = LB.peaks.get(x.file), cs = getComputedStyle(cv);
  const col = cs.getPropertyValue(x.type === 'hit' ? '--f-attack' : '--f-tone').trim() || '#7fd';
  g.fillStyle = col;
  if (!(p instanceof Float32Array)) {
    g.globalAlpha = 0.35;
    g.fillRect(0, H / 2, W, 1);
    g.globalAlpha = 1;
    return;
  }
  let pk = 0;
  for (const v of p) if (v > pk) pk = v;
  const k = pk > 0 ? 1 / pk : 0;
  for (let i = 0; i < W; i += 2) {
    const a = Math.max(0.5, p[Math.min(p.length - 1, Math.floor((i / W) * p.length))] * k * H * 0.46);
    g.fillRect(i, H / 2 - a, 1.4, a * 2);
  }
  if (LB.playing === x && LB.audio && LB.audio.duration) {
    g.fillStyle = cs.getPropertyValue('--look-accent').trim() || '#ffb547';
    g.fillRect(Math.min(W - 2, (LB.audio.currentTime / LB.audio.duration) * W), 0, 2, H);
  }
}

function lbWavesDraw() {
  if (!LB.built) return;
  const xs = lbShown();
  [...$('lbTiles').querySelectorAll('canvas')].forEach((cv, i) => xs[i] && lbWaveInto(cv, xs[i]));
  if (LB.pick) lbWaveInto($('lbDWave'), LB.pick);
}

// ─── hearing one ─────────────────────────────────────────────────────────────

function lbStop() {
  cancelAnimationFrame(LB.raf);
  if (LB.audio) { LB.audio.pause(); LB.audio.src = ''; LB.audio = null; }
  const was = LB.playing;
  LB.playing = null;
  if (was && LB.built && state.mode === 'pclib') lbTilesDraw();
}

function lbPlay(x) {
  const same = LB.playing === x;
  lbStop();
  if (same) return;
  // One thing sounds at a time: the open sound stops for it.
  if (typeof engine !== 'undefined' && engine.playing && typeof pausePlayback === 'function') pausePlayback();
  const a = new Audio(lbUrl(x));
  a.loop = LB.loop;
  // At the app's own volume (the bar's fader).
  a.volume = Math.max(0, Math.min(1, +($('volume')?.value ?? 1) || 0));
  a.onended = () => { if (LB.audio === a) lbStop(); };
  a.onerror = () => { if (LB.audio === a) { lbStop(); toast('Could not get that sound from the PC'); } };
  LB.audio = a;
  LB.playing = x;
  a.play().catch(() => { if (LB.audio === a) lbStop(); });
  const tick = () => { if (LB.audio !== a) return; lbWavesDraw(); LB.raf = requestAnimationFrame(tick); };
  LB.raf = requestAnimationFrame(tick);
  lbTilesDraw();
}

// ─── using one ───────────────────────────────────────────────────────────────

/// Bring it into `Made/PC/`, and open it on a page if one was asked for.
async function lbUse(act, x) {
  if (LB.acting) return;
  LB.acting = x.file;
  lbDetailDraw();
  try {
    const r = await postJSON('/api/pc/fetch', { file: x.file });
    if (act === 'copy') {
      toast(`Copied into your library: ${r.p}`);
      if (typeof refreshLibrary === 'function') refreshLibrary();
    } else {
      const f = await resolveFile(r.p);
      if (!f) throw new Error('it came over, but the library has not listed it yet: try again in a moment');
      lbStop();
      setEditPage(act, false);
      await openInEditor(f);
      toast(`Opened on ${{ grain: 'Grain', chop: 'Chop', wave: 'Edit' }[act]}: ${r.p}`);
    }
  } catch (e) {
    toast(`Could not bring it over: ${e.message || e}`);
  } finally {
    LB.acting = '';
    if (LB.built) lbDetailDraw();
  }
}

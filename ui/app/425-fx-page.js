// ═══════════════════════════════════════════════════════════════ the FX page ══
//
// A sound from the library, or from the PC's own library, through the effects
// suite: reverbs, delays, chorus, EQ and the rest, and nothing granular (RJ,
// 14 Nov 2026: "allows you to connect to the library and then run it through
// … effects. Because that'd be fun, but not like the granular stuff").
//
// It is the Grain page's effects view (`404-grain-rack.js`) on its own: the
// real rack, borrowed, with its picker, Out, Spectrum, faders and meters. The
// Grain page's engine, tray and GRAIN/SEQ switches are put away
// (`057-fx.css`), and a Sources panel goes on top. The open sound is the same
// document as Edit, Grain and Prism. Plan: page-mockups/FX-PAGE-PLAN.md.

const FX = { on: false, list: null, err: '', q: '', from: 'all', busy: '', shown: 40 };
const FX_FROM = [['all', 'All'], ['stable-audio-open-small', 'Stable Audio'], ['tangoflux', 'TangoFlux'], ['ace-step-1.5', 'ACE-Step'], ['mgl', 'Made for MGL']];

function fxEnter() {
  FX.on = true;
  gsFxSetView('fx');
  fxBuild();
  fxShowOpen();
  if (!FX.list) fxLoadPc();
}

function fxExit() {
  if (!FX.on) return;
  FX.on = false;
  $('fxSources')?.remove();
  if (GS_FX.view === 'fx') gsFxSetView('eng');
}

function fxBuild() {
  if ($('fxSources')) return;
  const view = $('gsFxView');
  if (!view) return;
  view.insertBefore(wvH(`<div class="gs-panel fx-src" id="fxSources">
    <div class="fx-open">
      <div class="gs-mh"><span class="gs-nm">THE SOUND</span><span class="gs-sp"></span><span class="gs-ro" id="fxOpenLen"></span></div>
      <b class="fx-name" id="fxOpenName">Nothing open</b>
      <span class="gs-hint" id="fxOpenNote">Pick a sound from the PC's library, or double-click one in your library (the drawer).</span>
      <div class="fx-acts">
        <button class="gs-chip gs-btn" id="fxDrawer" title="Your library: double-click a sound to open it here">My library</button>
        <button class="gs-chip gs-btn" id="fxStraight" hidden title="This sound plays through a grain engine (set on Grain). Play it straight: the plain engine, at its own speed and pitch">Play it straight</button>
        <button class="gs-chip gs-btn fx-save" id="fxSave" title="Render it through the effects, as you hear it, into an FX folder beside the sound">Save with effects</button>
      </div>
    </div>
    <div class="fx-pc">
      <div class="gs-mh"><span class="gs-nm">THE PC'S LIBRARY</span><span class="gs-hint">every sound made on the PC · click one to open it here</span><span class="gs-sp"></span><span class="gs-ro" id="fxPcCount"></span><button class="gs-chip gs-btn" id="fxPcReload" title="Read the PC's library again">↻</button></div>
      <div class="fx-filt"><span id="fxFrom" class="fx-from"></span><input class="fx-q" id="fxQ" type="search" placeholder="search the words"></div>
      <div class="fx-list" id="fxPcList"></div>
    </div>
  </div>`), view.firstChild);
  $('fxDrawer').onclick = () => { if (typeof openDrawer === 'function') openDrawer(); };
  $('fxStraight').onclick = fxStraight;
  $('fxSave').onclick = fxSave;
  $('fxPcReload').onclick = () => { FX.list = null; fxLoadPc(); };
  $('fxQ').value = FX.q;
  $('fxQ').oninput = () => { FX.q = $('fxQ').value.trim().toLowerCase(); FX.shown = 40; fxDrawPc(); };
  $('fxFrom').onclick = (e) => { const b = e.target.closest('[data-f]'); if (!b) return; FX.from = b.dataset.f; FX.shown = 40; fxDrawPc(); };
  $('fxPcList').onclick = (e) => {
    if (e.target.closest('#fxMore')) { FX.shown += 40; fxDrawPc(); return; }
    const row = e.target.closest('[data-file]');
    if (row) fxOpenPc(row.dataset.file, row.dataset.play === '1' || !!e.target.closest('.fx-play'));
  };
  fxDrawPc();
}

async function fxLoadPc() {
  FX.err = '';
  FX.busy = 'reading';
  fxDrawPc();
  try {
    FX.list = await api('/api/pc/library');
  } catch (e) {
    FX.list = [];
    FX.err = e.message;
  }
  FX.busy = '';
  fxDrawPc();
}

const fxFromOk = (x) => FX.from === 'all' || (FX.from === 'mgl' ? x.source === 'MGL' : x.model === FX.from);
const fxModelShort = (m) => ({ 'stable-audio-open-small': 'Small', tangoflux: 'TangoFlux', 'ace-step-1.5': 'ACE-Step' }[m] || m || '');

function fxDrawPc() {
  const box = $('fxPcList');
  if (!box) return;
  const list = FX.list || [];
  $('fxFrom').innerHTML = FX_FROM.map(([k, l]) => {
    const n = list.filter((x) => k === 'all' || (k === 'mgl' ? x.source === 'MGL' : x.model === k)).length;
    return `<button class="gs-chip gs-btn${k === FX.from ? ' on' : ''}" data-f="${k}">${l} · ${n}</button>`;
  }).join('');
  const hits = list.filter((x) => fxFromOk(x) && (!FX.q || `${x.prompt || ''} ${x.label || ''}`.toLowerCase().includes(FX.q)));
  $('fxPcCount').textContent = FX.list ? `${hits.length} of ${list.length}` : '';
  if (FX.busy === 'reading') { box.innerHTML = '<div class="gs-hint fx-empty">reading the PC’s library…</div>'; return; }
  if (FX.err) { box.innerHTML = `<div class="gs-hint fx-empty">The PC’s library could not be read: ${gsAttr(FX.err)}</div>`; return; }
  const when = (t) => (t ? new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
  box.innerHTML = hits.slice(0, FX.shown).map((x) => `<div class="fx-row${FX.busy === x.file ? ' busy' : ''}" data-file="${gsAttr(x.file)}" title="${gsAttr(x.prompt || '')}">
      <span class="gs-btn fx-play" title="Open it here and play">▶</span>
      <span class="fx-w">${gsAttr(x.label ? `${x.label} · ` : '')}${gsAttr(x.prompt || x.file.split('/').pop())}</span>
      <span class="gs-ro">${gsAttr(fxModelShort(x.model))}${x.source === 'MGL' ? ' · MGL' : ''} · ${Number(x.seconds || 0).toFixed(1)} s · ${when(x.time)}</span>
    </div>`).join('')
    + (hits.length > FX.shown ? `<button class="gs-chip gs-btn" id="fxMore">${hits.length - FX.shown} more</button>` : '')
    || `<div class="gs-hint fx-empty">${list.length ? 'Nothing matches.' : 'Nothing in the PC’s library yet.'}</div>`;
}

/// Bring a PC sound here (`Made/PC/`) and open it on this page.
async function fxOpenPc(file, play) {
  if (FX.busy) return;
  FX.busy = file;
  fxDrawPc();
  try {
    const r = await postJSON('/api/pc/fetch', { file });
    const f = await resolveFile(r.p);
    if (!f) throw new Error('it came over, but the library has not listed it yet: try again in a moment');
    await openInEditor(f);
    if (play && !engine.playing) { seekSource(0); startPlayback(); }
  } catch (e) {
    toast(`Could not open it: ${e.message}`);
  } finally {
    FX.busy = '';
    fxDrawPc();
    fxShowOpen();
  }
}

/// The open sound: its name and length, and whether a grain engine is on it.
function fxShowOpen() {
  if (!$('fxSources')) return;
  const f = state.selectedFile;
  $('fxOpenName').textContent = f ? f.name || f.path.split('/').pop() : 'Nothing open';
  const secs = state.view?.frames && state.view?.sampleRate ? state.view.frames / state.view.sampleRate : f?.duration;
  $('fxOpenLen').textContent = Number.isFinite(secs) ? `${secs.toFixed(2)} s` : '';
  const grainy = !!f && gsCloudActive();
  $('fxStraight').hidden = !grainy;
  $('fxOpenNote').textContent = !f ? "Pick a sound from the PC's library, or double-click one in your library (the drawer)."
    : grainy ? 'A grain engine is on for this sound (set on Grain). Play it straight to hear only the effects.'
    : 'Played straight, through the effects below. Add one with + Add effect.';
  $('fxSave').disabled = !f;
}

/// Back to the plain engine at the sound's own speed and pitch: one edit, one undo.
async function fxStraight() {
  const d = state.stretchDraft;
  if (!d) return;
  Object.assign(d, { algorithm: 'wsola', cloud: false, ratio: 1, semitones: 0 });
  await gsPostAll();
  gsApplyEngine();
  fxShowOpen();
}

/// The sound through the chain as it plays, into `FX/` beside it.
function fxSave() {
  if (!state.selectedFile) return;
  runExport(null, 1, true, { folder: 'FX' });
}

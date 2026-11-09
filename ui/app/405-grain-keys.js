// ================================================================ Grain: the dock
//
// The strip along the bottom: the bend wheel, octave, Mono / Legato / Poly, Run,
// Glide, Bend, and 61 keys, played with the mouse and the computer keyboard.
//
// **A key is not an edit.** Notes go to `/api/engine/note` and the way they play
// to `/api/engine/voice`; neither touches the drafts or the undo stack, and the
// engine adds the pitch to the block and forgets it (`engine::keys`). The pitch
// each key plays is this page's tuning, sent as a table of 128 semitones, so the
// engine never has to know what a scale is.
//
// AMP and the voice settings are kept per sound, the way Prism keeps its LFOs
// (`387-prism-lfo.js`). Leaving the page puts the engine back as it was found.

const GS_KB = { lo: 36, n: 61 };
const gsIsBlack = (n) => [1, 3, 6, 8, 10].includes(((n % 12) + 12) % 12);

/// How the keys play. Kept per sound.
const GS_VOICE_DEF = { mode: 'mono', run: false, glide: 0.3, bendR: 2 };
const GS_AMP_DEF = { a: 0.16, d: 0.4, s: 0.78, r: 0.5 };
/// As the page first drew them: nothing mapped.
const GS_LFO_DEF = JSON.parse(JSON.stringify(GS.lfo));
GS.voice = { ...GS_VOICE_DEF };

const GS_N = {
  held: new Map(), kbd: new Map(), oct: 0, bend: 0, vel: null,
  // Posts go one at a time and in order, so a release never overtakes its press.
  q: Promise.resolve(), pending: null,
  sent: { start: null, scale: null, drawn: '' },
  // What the MIDI keyboard is holding, as `/api/engine/midi` last said.
  midi: new Set(), midiBend: 0, midiBusy: false, midiPoll: 0, midiLoading: false,
};

// ──────────────────────────────────────────────────────── talking to the engine

/// Load what the page is showing, if the deck is not holding it yet. A key on a
/// sound that has never been played has to be heard all the same.
async function gsDeckReady() {
  const f = state.selectedFile;
  if (!f) return false;
  const raw = !playsDocument();
  if (engine.path === f.path && engine.raw === raw) return true;
  if (!(await engineLoad(f, { raw }))) return false;
  applyLoop();
  seekSource(state.cue || 0);
  return true;
}

function gsNotePost(on, key, vel) {
  if (noAudio()) return;
  GS_N.q = GS_N.q.then(async () => {
    if (on && !(await gsDeckReady())) return;
    await postJSON('/api/engine/note', on ? { on: true, key, velocity: vel } : { on: false, key });
  }).catch(() => {});
}

/// Twenty moves of a drag between two sends are one send: the last of them.
function gsVoicePost(part) {
  if (noAudio()) return;
  if (GS_N.pending) { Object.assign(GS_N.pending, part); return; }
  GS_N.pending = { ...part };
  GS_N.q = GS_N.q.then(async () => {
    const body = GS_N.pending;
    GS_N.pending = null;
    await postJSON('/api/engine/voice', body);
  }).catch(() => {});
}

/// Where the keys are told a note starts: a fraction of the sound.
function gsStartFrac() {
  const f = gsFile();
  return f && f.frames > 0 ? wvClamp((state.cue || 0) / f.frames) : 0;
}

const gsAmpSecs = (E) => ({ attack: E.a ** 2 * 4, decay: E.d ** 2 * 4, sustain: E.s, release: E.r ** 2 * 6 });
const gsGlideSecs = (u) => u * u * 2;

/// The tuning this page plays. Only a chosen scale maps the keys to its degrees;
/// Free and the grids leave them a semitone apart.
function gsScale() {
  const name = currentScale();
  if (!name) return null;
  for (const g of state.scales || []) for (const s of g.scales) if (s.name === name) return s;
  return null;
}

function gsKeySemis(n, s = gsScale()) {
  if (!s) return n - 60;
  const i = n - 60, d = s.cents.length, o = Math.floor(i / d);
  return (o * (s.span || 1200) + s.cents[((i % d) + d) % d]) / 100;
}

function gsKeyTable() {
  const s = gsScale();
  return Array.from({ length: 128 }, (_, n) => +gsKeySemis(n, s).toFixed(4));
}

/// Everything, as the page has it. On the way in, and for a new sound.
function gsVoiceSend() {
  const v = GS.voice;
  gsMidiSend();
  GS_N.sent.start = gsStartFrac();
  // A scale named before the list of them has arrived is sent again when it has.
  GS_N.sent.scale = !currentScale() || gsScale() ? currentScale() : undefined;
  gsVoicePost({ front: true, bendRange: v.bendR, mode: v.mode, run: v.run, glide: gsGlideSecs(v.glide), bend: GS_N.bend * v.bendR, ...gsAmpSecs(GS.amp), start: GS_N.sent.start, keys: gsKeyTable(), replay: true });
}

const gsVoiceKey = () => `grain.voice:${state.selectedFile?.path || ''}`;

function gsVoiceKeep() {
  try { localStorage.setItem(gsVoiceKey(), JSON.stringify({ ...GS.voice, amp: { ...GS.amp }, lfo: gsClone(GS.lfo) })); } catch { /* private mode */ }
}

/// This sound's AMP and voice mode, or the page's own starting values.
function gsVoiceLoad() {
  let kept = null;
  try { kept = JSON.parse(localStorage.getItem(gsVoiceKey()) || 'null'); } catch { /* none */ }
  GS.voice = { ...GS_VOICE_DEF };
  Object.assign(GS.amp, GS_AMP_DEF);
  GS.lfo = gsClone(GS_LFO_DEF);
  if (kept) {
    for (const f of Object.keys(GS_VOICE_DEF)) if (kept[f] != null) GS.voice[f] = kept[f];
    if (kept.amp) Object.assign(GS.amp, kept.amp);
    if (Array.isArray(kept.lfo)) kept.lfo.forEach((L, i) => { if (GS.lfo[i] && L) GS.lfo[i] = { ...GS.lfo[i], ...L, targets: Array.isArray(L.targets) ? L.targets : [] }; });
  }
  if (!GS.built) return;
  gsMarkVoice();
  gsDrawGlide();
  gsBuildModulate();
}

/// A new sound in front: its own settings, and the engine told.
function gsVoiceForSound() {
  gsVoiceLoad();
  gsVoiceSend();
  gsLfoSend();
}

// ─────────────────────────────────────────────────────────────────── the notes

function gsNoteOn(n, vel) {
  if (n < 0 || n > 127 || GS_N.held.has(n)) return;
  GS_N.held.set(n, vel);
  GS_N.vel = vel;
  gsTxt('gsVelRo', 'vel ' + Math.round(vel * 127));
  gsNotePost(true, n, vel);
}

function gsNoteOff(n) {
  if (!GS_N.held.delete(n)) return;
  gsNotePost(false, n);
}

function gsReleaseAll() {
  GS_N.kbd.clear();
  for (const n of [...GS_N.held.keys()]) gsNoteOff(n);
}

window.addEventListener('blur', () => { if (GS.showing) gsReleaseAll(); });
window.addEventListener('pagehide', () => {
  if (GS.showing && !noAudio()) navigator.sendBeacon('/api/engine/voice', JSON.stringify({ reset: true }));
});

function gsSetOct(o) {
  GS_N.oct = wvClamp(o, -2, 2);
  gsTxt('gsOctRo', 'C' + (2 + GS_N.oct));
  gsDrawKeys();
}

/// A MIDI keyboard played while this page is in front. The notes are already
/// sounding by the time this hears of them (`midi.rs`): this is only to draw
/// them, and to load the sound if a note reached a deck that had none.
async function gsPollMidi() {
  if (!GS.showing || GS_N.midiBusy || document.hidden) return;
  GS_N.midiBusy = true;
  try {
    const m = await api('/api/engine/midi');
    GS_N.midi = new Set(m.notes);
    GS_N.midiBend = m.bend || 0;
    if (m.notes.length) {
      gsTxt('gsVelRo', 'vel ' + Math.round(m.vel * 127));
      if (!GS_N.midiLoading && !noAudio()) {
        GS_N.midiLoading = true;
        gsDeckReady().catch(() => {}).finally(() => { GS_N.midiLoading = false; });
      }
    }
  } catch { /* the next poll will do */ }
  GS_N.midiBusy = false;
}

/// The computer keyboard, ahead of the old note keys, and only while the page
/// shows. A W S … are the degrees from the tonic. An octave is the scale's own,
/// so the row plays the same degrees wherever it is put.
function gsKeyDown(e) {
  if (!GS.showing || e.metaKey || e.ctrlKey || e.altKey) return false;
  const k = e.key.toLowerCase();
  if (k === 'z' || k === 'x') { e.preventDefault(); if (!e.repeat) gsSetOct(GS_N.oct + (k === 'z' ? -1 : 1)); return true; }
  const i = NOTE_KEYS.findIndex(([x]) => x === k);
  if (i < 0) return false;
  e.preventDefault();
  if (e.repeat || GS_N.kbd.has(k)) return true;
  const n = 60 + (gsScale()?.cents.length || 12) * GS_N.oct + i;
  GS_N.kbd.set(k, n);
  gsNoteOn(n, 0.8);
  return true;
}

function gsKeyUp(e) {
  const k = e.key.toLowerCase(), n = GS_N.kbd.get(k);
  if (n == null) return;
  GS_N.kbd.delete(k);
  gsNoteOff(n);
}

// ────────────────────────────────────────────────────────────────── the drawing

/// Where each drawn key is, for this octave.
function gsKeyLayout(g) {
  const lo = GS_KB.lo + 12 * GS_N.oct, whites = [], pos = {};
  for (let n = lo; n < lo + GS_KB.n; n++) if (!gsIsBlack(n)) whites.push(n);
  const ww = g.w / whites.length;
  whites.forEach((n, i) => { pos[n] = [i * ww, ww, false]; });
  for (let n = lo; n < lo + GS_KB.n; n++) if (gsIsBlack(n)) pos[n] = [pos[n - 1][0] + ww * 0.68, ww * 0.64, true];
  return pos;
}

function gsKeyAt(g, x, y) {
  const L = gsKeyLayout(g);
  for (const n in L) { const [k, w, b] = L[n]; if (b && x >= k && x < k + w && y < g.h * 0.6) return +n; }
  for (const n in L) { const [k, w, b] = L[n]; if (!b && x >= k && x < k + w) return +n; }
  return null;
}

const gsKeyLit = (n) => GS_N.held.has(n) || GS_N.midi.has(n);

function gsDrawKeys() {
  const g = GS_CV.gsKeys;
  if (!g) return;
  const { c, w, h } = g, cl = gsCl(), pos = gsKeyLayout(g), hue = 165;
  c.clearRect(0, 0, w, h);
  for (const n in pos) {
    const [x, kw, b] = pos[n], on = gsKeyLit(+n);
    if (b) continue;
    const gr = c.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, on ? `hsl(${hue},35%,30%)` : '#2b2e34'); gr.addColorStop(1, on ? `hsl(${hue},45%,22%)` : '#1d1f23');
    c.fillStyle = gr;
    c.beginPath(); c.roundRect(x + 1, 0, kw - 2, h - 1, [0, 0, 4, 4]); c.fill();
    c.fillStyle = 'rgba(255,255,255,.07)'; c.fillRect(x + 1, 0, kw - 2, 1);
    c.fillStyle = 'rgba(0,0,0,.45)'; c.fillRect(x + kw - 2, 0, 1, h - 1);
    if (on) { c.fillStyle = `hsl(${hue},70%,62%)`; c.shadowBlur = 10; c.shadowColor = c.fillStyle; c.fillRect(x + 3, h - 9, kw - 6, 4); c.shadowBlur = 0; }
    if (((+n % 12) + 12) % 12 === 0) {
      c.fillStyle = cl.t3;
      c.font = `9px ${cl.sans}`;
      c.fillText('C' + (Math.floor(+n / 12) - 1), x + 4, h - 12);
    }
  }
  for (const n in pos) {
    const [x, kw, b] = pos[n], on = gsKeyLit(+n);
    if (!b) continue;
    const gr = c.createLinearGradient(0, 0, 0, h * 0.6);
    gr.addColorStop(0, on ? '#2c3038' : '#131417'); gr.addColorStop(1, on ? '#1d2026' : '#060708');
    c.fillStyle = gr;
    c.shadowBlur = 4; c.shadowColor = 'rgba(0,0,0,.7)';
    c.beginPath(); c.roundRect(x, 0, kw, h * 0.6, [0, 0, 3, 3]); c.fill();
    c.shadowBlur = 0;
    if (on) { c.fillStyle = `hsl(${hue},70%,62%)`; c.fillRect(x + 2, h * 0.6 - 7, kw - 4, 3); }
  }
}

function gsDrawWheel() {
  const g = GS_CV.gsBend;
  if (!g) return;
  const { c, w, h } = g, cl = gsCl(), rest = h / 2, y = rest - (GS_N.bend || GS_N.midiBend) * (h / 2 - 8);
  c.clearRect(0, 0, w, h);
  for (let yy = 6; yy < h - 4; yy += 4) { c.fillStyle = 'rgba(255,255,255,.05)'; c.fillRect(6, yy, w - 12, 1); }
  c.fillStyle = `rgba(${cl.bloom},.25)`;
  c.fillRect(5, Math.min(rest, y), w - 10, Math.abs(rest - y));
  c.fillStyle = cl.t;
  c.shadowBlur = 8; c.shadowColor = cl.acc;
  c.beginPath(); c.roundRect(4, y - 2, w - 8, 4, 2); c.fill();
  c.shadowBlur = 0;
  c.fillStyle = cl.t3;
  c.font = `9px ${cl.mono}`;
  c.textAlign = 'center';
  c.fillText('PB', w / 2, 10);
  c.textAlign = 'left';
}

function gsDrawGlide() {
  const g = GS_CV.gsGlide;
  if (!g) return;
  const { c, w, h } = g, cl = gsCl(), v = GS.voice.glide, x = 6 + (w - 12) * v;
  c.clearRect(0, 0, w, h);
  c.save();
  c.beginPath(); c.rect(6, 3, x - 6, h - 6); c.clip();
  wvTrace(c, wvPath((u) => [6 + u * (w - 12), h - 5 - (h - 10) * (1 - Math.exp(-u * 5 / (v * 3 + 0.05)))], 60), cl, 1.1, 0.6);
  c.restore();
  c.strokeStyle = cl.track;
  c.beginPath(); c.moveTo(x, 3); c.lineTo(w - 6, 3); c.stroke();
  c.fillStyle = cl.t;
  c.beginPath(); c.roundRect(x - 2, 2, 4, h - 4, 2); c.fill();
  c.font = `10px ${cl.mono}`;
  c.fillStyle = cl.t2; c.textAlign = 'right';
  c.fillText(Math.round(v * v * 2000) + ' ms', w - 6, h / 2 + 3.5);
  c.textAlign = 'left';
  c.fillStyle = cl.t3;
  c.fillText('Glide', 8, h / 2 + 3.5);
}

function gsDockHtml() {
  return `<div class="gs-dock">
   <div class="gs-wheels"><canvas class="gs-well gs-wheel" id="gsBend" data-w="30" data-h="100" title="Pitch bend: springs back"></canvas></div>
   <div class="gs-kb5">
    <div class="gs-kbr"><div class="gs-seg" id="gsOctSeg"><span data-o="-1" title="Octave down (Z)">−</span><span class="on gs-mono" id="gsOctRo">C2</span><span data-o="1" title="Octave up (X)">+</span></div><span class="gs-kbtune gs-btn" id="gsKbScale"></span><select class="gs-midi" id="gsMidiCh" title="MIDI channel: this instrument plays only what arrives on this channel. Wave has its own, on its page"></select></div>
    <div class="gs-kbr"><div class="gs-seg" id="gsVmode"><span data-m="mono" title="Mono: a key starts the sound at the Start point, glided to its pitch, and gates it with AMP">Mono</span><span data-m="legato" title="Legato: glides between held keys without starting again">Legato</span><span data-m="poly" title="Poly: each held key its own read head, coming. For now it plays as Mono">Poly</span></div><span class="gs-btn gs-chip gs-runb" id="gsRunBtn" title="Run: keep the sound going while the transport plays, with no key held. Keys then only re-pitch it">${GS_PWR}Run</span></div>
    <div class="gs-kbr"><div class="gs-well" title="Glide: how long a new note takes to arrive at its pitch. Drag across"><canvas id="gsGlide" data-w="150" data-h="22"></canvas></div><span class="gs-lab gs-btnlab" id="gsBendLab" style="width:auto;gap:6px" title="Bend range: click to change"><span>Bend</span><b>±2</b></span></div>
    <div class="gs-kbr"><span class="gs-ro" id="gsVelRo">vel —</span><span class="gs-hint" title="Keys: A W S E D F T G Y H U J K O L P ; ' play from the tonic; with a scale chosen, each key is the next degree. Drag across the keys to glide; hold Shift while you drag and every key you cross keeps sounding">A–' play · Z X octave · ⇧ drag holds</span></div>
   </div>
   <div class="gs-keys"><canvas id="gsKeys" data-w="1000" data-h="100"></canvas></div>
  </div>`;
}

function gsMarkVoice() {
  const v = GS.voice;
  document.querySelectorAll('#gsVmode span').forEach((s) => s.classList.toggle('on', s.dataset.m === v.mode));
  $('gsRunBtn')?.classList.toggle('on', v.run);
  const b = document.querySelector('#gsBendLab b');
  if (b) b.textContent = '±' + v.bendR;
}

function gsWireDock() {
  const set = (part) => { Object.assign(GS.voice, part); gsMarkVoice(); gsVoiceKeep(); };
  document.querySelectorAll('#gsVmode span').forEach((s) => { s.onclick = () => { set({ mode: s.dataset.m }); gsVoicePost({ mode: s.dataset.m }); }; });
  document.querySelectorAll('#gsOctSeg [data-o]').forEach((s) => { s.onclick = () => gsSetOct(GS_N.oct + +s.dataset.o); });
  $('gsRunBtn').onclick = () => {
    const run = !GS.voice.run;
    set({ run });
    gsVoicePost({ run });
    if (run && !engine.playing) $('playBtn').click();
  };
  $('gsBendLab').onclick = () => {
    const R = [1, 2, 7, 12];
    set({ bendR: R[(R.indexOf(GS.voice.bendR) + 1) % R.length] });
    gsVoicePost({ bendRange: GS.voice.bendR });
  };
  const gl = GS_CV.gsGlide;
  gsDrag(gl.el, (dx) => {
    GS.voice.glide = wvClamp(GS.voice.glide + dx / 150);
    gsDrawGlide();
    gsVoicePost({ glide: gsGlideSecs(GS.voice.glide) });
  }, null, gsVoiceKeep);
  const bend = GS_CV.gsBend;
  gsDrag(bend.el, (dx, dy) => {
    GS_N.bend = wvClamp(GS_N.bend - dy / 50, -1, 1);
    gsDrawWheel();
    gsVoicePost({ bend: GS_N.bend * GS.voice.bendR });
  }, null, () => {
    GS_N.bend = 0;
    gsDrawWheel();
    gsVoicePost({ bend: 0 });
  });
  const g = GS_CV.gsKeys;
  g.el.addEventListener('pointerdown', (e) => {
    if (e.button) return;
    e.preventDefault();
    g.el.setPointerCapture(e.pointerId);
    const held = new Set();
    let cur = null;
    // Across the keys glides; with Shift, every key crossed keeps sounding.
    const go = (ev) => {
      const [x, y] = wvLocal(g.el, ev), k = gsKeyAt(g, x, y);
      if (k == null || k === cur) return;
      if (cur != null && !ev.shiftKey) { gsNoteOff(cur); held.delete(cur); }
      gsNoteOn(k, 0.4 + 0.6 * wvClamp(y / g.h));
      held.add(k);
      cur = k;
    };
    const up = () => {
      g.el.removeEventListener('pointermove', go);
      g.el.removeEventListener('pointerup', up);
      g.el.removeEventListener('pointercancel', up);
      held.forEach(gsNoteOff);
    };
    go(e);
    g.el.addEventListener('pointermove', go);
    g.el.addEventListener('pointerup', up);
    g.el.addEventListener('pointercancel', up);
  });
}

function gsDrawDock() {
  gsMarkVoice();
  gsDrawWheel();
  gsDrawGlide();
  gsDrawKeys();
}

/// Every frame: anything the engine has to be told that was changed elsewhere,
/// and the keys, when they have changed.
function gsKeysTick() {
  const start = gsStartFrac(), scale = currentScale();
  if (GS_N.sent.start !== start) { GS_N.sent.start = start; gsVoicePost({ start }); }
  if (GS_N.sent.scale !== scale && (!scale || gsScale())) { GS_N.sent.scale = scale; gsVoicePost({ keys: gsKeyTable() }); }
  const drawn = `${GS_N.oct}|${[...GS_N.held.keys()].join()}|${[...GS_N.midi].join()}`;
  if (drawn !== GS_N.sent.drawn) { GS_N.sent.drawn = drawn; gsDrawKeys(); }
  if (GS_N.midiBend !== GS_N.sent.wheel) { GS_N.sent.wheel = GS_N.midiBend; gsDrawWheel(); }
}

function gsKeysEnter() {
  gsVoiceForSound();
  gsFxSendSides();
  if (!GS_N.midiPoll) GS_N.midiPoll = setInterval(gsPollMidi, 60);
}

/// Off the page, the engine is as it was found: Run on, no pitch of ours.
function gsKeysLeave() {
  gsReleaseAll();
  GS_N.bend = 0;
  clearInterval(GS_N.midiPoll);
  GS_N.midiPoll = 0;
  GS_N.midi.clear();
  GS_N.midiBend = 0;
  gsVoicePost({ reset: true });
  if (!gsOn()) gsFxResetSides();
}

// ── MIDI channels ── one per instrument, kept here, set on each page. Grain and
// Wave share the code because they share the question; the channels live in
// this browser and are told to the engine whenever a page opens.
const GS_MIDI_DEFAULT = { wave: 1, grain: 2 };

function gsMidiChannel(who) {
  try {
    const v = +localStorage.getItem(`midiChannel.${who}`);
    if (v >= 1 && v <= 16) return v;
  } catch {}
  return GS_MIDI_DEFAULT[who];
}

function gsMidiSend() {
  postJSON('/api/engine/midi', { wave: gsMidiChannel('wave'), grain: gsMidiChannel('grain') }).catch(() => {});
}

/// Make `el` the channel menu for one instrument.
function gsWireMidiChannel(el, who) {
  if (!el) return;
  el.innerHTML = Array.from({ length: 16 }, (_, i) => `<option value="${i + 1}">MIDI ${i + 1}</option>`).join('');
  el.value = String(gsMidiChannel(who));
  el.onchange = () => {
    try { localStorage.setItem(`midiChannel.${who}`, el.value); } catch {}
    gsMidiSend();
    el.blur();
  };
}


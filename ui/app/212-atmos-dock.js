// ================================================================ Atmosphere: the dock
//
// The one keyboard (389-one-keyboard.js) along the bottom of the Atmosphere
// page, in the app rather than in the sequencer's frame. RJ, 17 Nov 2026: "I'm
// trying to use the keyboard to play the notes. It's not playing anything."
// The frame never heard the computer's keys: they go to the app, which handed
// them only to Wave and Grain (320-keyboard.js). Now the app plays Atmosphere
// as it plays them, and sends each note into the frame (`seq:note`, bridge.js),
// where Atmosphere's own voice (`kyNoteOn('atmos', …)`, keys.js) plays it in
// its own tuning. The frame's own strip stands down while it is in the app.
//
// The octave, the MIDI channel and the velocity are here; the channel is the
// frame's (`midiChannel.atmos`, the same browser storage) and is sent to the
// server as Wave's and Grain's are.

const AD = { built: false, lo: 36, held: new Map(), kbd: new Map(), vel: 0.8, cv: null };

const adShowing = () => document.body.classList.contains('atmospage');

function adChannel() {
  try { const v = +localStorage.getItem('midiChannel.atmos'); if (v >= 1 && v <= 16) return v; } catch { /* private mode */ }
  return 3;
}

function adBuild() {
  const host = $('seqView');
  if (!host || AD.built) return;
  host.insertAdjacentHTML('beforeend', `<div class="ad-dock" id="atmosDock">
    <div class="ad-info">
      <div class="ad-seg" id="adOct"><span data-o="-1" title="An octave down (Z)">−</span><b class="on" id="adOctRo"></b><span data-o="1" title="An octave up (X)">+</span></div>
      <select class="ad-midi" id="adMidi" title="MIDI channel: Atmosphere plays what arrives on this channel">${Array.from({ length: 16 }, (_, i) => `<option value="${i + 1}">MIDI ${i + 1}</option>`).join('')}</select>
      <span class="ad-hint">Keys A–; · Z X octave<br>drag to glide</span>
      <span class="ad-ro" id="adVel">vel —</span>
    </div>
    <div class="ad-keys"><canvas id="adKeys" width="${KB1.w * 2}" height="${KB1.h * 2}" style="width:${KB1.w}px;height:${KB1.h}px" title="Atmosphere's keys: click to play, lower on a key is louder; drag across to glide"></canvas></div>
  </div>`);
  AD.cv = $('adKeys');
  AD.built = true;
  const midi = $('adMidi');
  midi.value = String(adChannel());
  midi.onchange = () => {
    try { localStorage.setItem('midiChannel.atmos', midi.value); } catch { /* private mode */ }
    postJSON('/api/engine/midi', { atmos: +midi.value }).catch(() => {});
    midi.blur();
  };
  document.querySelectorAll('#adOct [data-o]').forEach((s) => { s.onclick = () => adSetOct(+s.dataset.o); });
  adWireKeys();
  adDraw();
}

function adSetOct(by) {
  AD.lo = Math.max(12, Math.min(72, AD.lo + 12 * by));
  adDraw();
}

function adDraw() {
  if (!AD.cv) return;
  const c = AD.cv.getContext('2d');
  c.setTransform(2, 0, 0, 2, 0, 0);
  const s = getComputedStyle(document.body);
  kb1Draw(c, AD.lo, (n) => AD.held.has(n), 270, { t3: s.getPropertyValue('--look-text-3').trim() || '#858b94', sans: s.getPropertyValue('--sans').trim() || 'sans-serif' });
  const ro = $('adOctRo');
  if (ro) ro.textContent = 'C' + (AD.lo / 12 - 1);
}

function adOn(n, vel) {
  if (AD.held.has(n)) return;
  AD.held.set(n, true);
  seqEnsureFrame();
  seqPost({ type: 'seq:note', part: 'atmos', on: true, key: n, vel });
  const v = $('adVel');
  if (v) v.textContent = 'vel ' + Math.round(vel * 127);
  adDraw();
}

function adOff(n) {
  if (!AD.held.delete(n)) return;
  seqPost({ type: 'seq:note', part: 'atmos', on: false, key: n });
  adDraw();
}

function adWireKeys() {
  let down = null;
  const at = (e) => {
    const r = AD.cv.getBoundingClientRect();
    const x = (e.clientX - r.left) * (KB1.w / r.width), y = (e.clientY - r.top) * (KB1.h / r.height);
    return { n: kb1At(AD.lo, x, y), vel: Math.max(0.2, Math.min(1, 0.35 + 0.65 * (y / KB1.h))) };
  };
  AD.cv.addEventListener('pointerdown', (e) => {
    const k = at(e);
    if (k.n == null) return;
    e.preventDefault();
    AD.cv.setPointerCapture(e.pointerId);
    down = k.n;
    adOn(k.n, k.vel);
  });
  AD.cv.addEventListener('pointermove', (e) => {
    if (down == null) return;
    const k = at(e);
    if (k.n == null || k.n === down) return;
    adOff(down);
    down = k.n;
    adOn(k.n, k.vel);
  });
  const up = () => { if (down != null) adOff(down); down = null; };
  AD.cv.addEventListener('pointerup', up);
  AD.cv.addEventListener('pointercancel', up);
  window.addEventListener('blur', adAllOff);
}

function adAllOff() {
  for (const n of [...AD.held.keys()]) adOff(n);
  AD.kbd.clear();
}

/// The computer's keys while the Atmosphere page shows: A W S E D F T G Y H U J
/// K O L P ; from the C an octave above the keyboard's lowest, Z and X for the
/// octave. Called by the dispatcher (320-keyboard.js) after Wave's and Grain's.
function adKeyDown(e) {
  if (!adShowing() || e.metaKey || e.ctrlKey || e.altKey) return false;
  const k = e.key.toLowerCase();
  if (k === 'z' || k === 'x') { e.preventDefault(); if (!e.repeat) adSetOct(k === 'z' ? -1 : 1); return true; }
  const i = 'awsedftgyhujkolp;'.indexOf(k);
  if (i < 0) return false;
  e.preventDefault();
  if (e.repeat || AD.kbd.has(k)) return true;
  const n = AD.lo + 12 + i;
  AD.kbd.set(k, n);
  adOn(n, AD.vel);
  return true;
}

function adKeyUp(e) {
  const k = e.key.toLowerCase(), n = AD.kbd.get(k);
  if (n == null) return;
  AD.kbd.delete(k);
  adOff(n);
}

/// From `setMode`: built the first time the page shows; every key let go when it is left.
function adSync() {
  if (adShowing()) { adBuild(); adDraw(); } else if (AD.held.size) adAllOff();
}

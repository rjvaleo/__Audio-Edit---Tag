// ================================================================ Grain: the dock
//
// The strip along the bottom: the bend wheel, octave, Mono / Legato / Poly, Run,
// Glide, Bend, and 61 keys. **Only its Tuning selector works yet.** Notes arrive
// in Phase 3 (`/api/engine/note`), so the rest is the design's, drawn and quiet,
// and the computer keys do what they did before.

const GS_KB = { lo: 36, n: 61 };
const gsIsBlack = (n) => [1, 3, 6, 8, 10].includes(((n % 12) + 12) % 12);

function gsDrawKeys() {
  const g = GS_CV.gsKeys;
  if (!g) return;
  const { c, w, h } = g, cl = gsCl(), whites = [], pos = {};
  for (let n = GS_KB.lo; n < GS_KB.lo + GS_KB.n; n++) if (!gsIsBlack(n)) whites.push(n);
  const ww = w / whites.length;
  whites.forEach((n, i) => { pos[n] = [i * ww, ww, false]; });
  for (let n = GS_KB.lo; n < GS_KB.lo + GS_KB.n; n++) if (gsIsBlack(n)) pos[n] = [pos[n - 1][0] + ww * 0.68, ww * 0.64, true];
  c.clearRect(0, 0, w, h);
  for (const n in pos) {
    const [x, kw, b] = pos[n];
    if (b) continue;
    const gr = c.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, '#2b2e34'); gr.addColorStop(1, '#1d1f23');
    c.fillStyle = gr;
    c.beginPath(); c.roundRect(x + 1, 0, kw - 2, h - 1, [0, 0, 4, 4]); c.fill();
    c.fillStyle = 'rgba(255,255,255,.07)'; c.fillRect(x + 1, 0, kw - 2, 1);
    c.fillStyle = 'rgba(0,0,0,.45)'; c.fillRect(x + kw - 2, 0, 1, h - 1);
    if (((+n % 12) + 12) % 12 === 0) {
      c.fillStyle = cl.t3;
      c.font = `9px ${cl.sans}`;
      c.fillText('C' + (Math.floor(+n / 12) - 1), x + 4, h - 12);
    }
  }
  for (const n in pos) {
    const [x, kw, b] = pos[n];
    if (!b) continue;
    const gr = c.createLinearGradient(0, 0, 0, h * 0.6);
    gr.addColorStop(0, '#131417'); gr.addColorStop(1, '#060708');
    c.fillStyle = gr;
    c.shadowBlur = 4; c.shadowColor = 'rgba(0,0,0,.7)';
    c.beginPath(); c.roundRect(x, 0, kw, h * 0.6, [0, 0, 3, 3]); c.fill();
    c.shadowBlur = 0;
  }
}

function gsDrawWheel() {
  const g = GS_CV.gsBend;
  if (!g) return;
  const { c, w, h } = g, cl = gsCl(), y = h / 2;
  c.clearRect(0, 0, w, h);
  for (let yy = 6; yy < h - 4; yy += 4) { c.fillStyle = 'rgba(255,255,255,.05)'; c.fillRect(6, yy, w - 12, 1); }
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
  const { c, w, h } = g, cl = gsCl(), v = 0.3, x = 6 + (w - 12) * v;
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
  const soon = 'Not connected yet: keys and voices arrive with note input';
  return `<div class="gs-dock">
   <div class="gs-wheels gs-inert" title="${soon}"><canvas class="gs-well gs-wheel" id="gsBend" data-w="30" data-h="100"></canvas></div>
   <div class="gs-kb5">
    <div class="gs-kbr"><div class="gs-seg gs-inert" title="${soon}"><span>−</span><span class="on gs-mono">C2</span><span>+</span></div><span class="gs-kbtune gs-btn" id="gsKbScale"></span></div>
    <div class="gs-kbr"><div class="gs-seg gs-inert" title="${soon}"><span class="on">Mono</span><span>Legato</span><span>Poly</span></div><span class="gs-btn gs-chip gs-runb gs-inert" title="${soon}">${GS_PWR}Run</span></div>
    <div class="gs-kbr gs-inert" title="${soon}"><div class="gs-well"><canvas id="gsGlide" data-w="150" data-h="22"></canvas></div><span class="gs-lab" style="width:auto;gap:6px"><span>Bend</span><b>±2</b></span></div>
    <div class="gs-kbr gs-inert" title="${soon}"><span class="gs-ro">vel —</span><span class="gs-hint">A–' play · Z X octave · ⇧ drag holds</span></div>
   </div>
   <div class="gs-keys gs-inert" title="${soon}"><canvas id="gsKeys" data-w="1000" data-h="100"></canvas></div>
  </div>`;
}

function gsDrawDock() {
  gsDrawWheel();
  gsDrawGlide();
  gsDrawKeys();
}

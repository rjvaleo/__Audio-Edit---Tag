// ================================================================ Grain: MODULATE
//
// AMP and LFO 1–4, all open, one row each, between the trace and the engine's
// own controls. **Drawn and not connected.** The envelope arrives with notes
// (Phase 3) and the LFOs with their own running phase (Phase 6), so for now the
// rows are the design's and answer nothing; the header says so. Their values are
// kept in `GS.amp` and `GS.lfo`, and travel with A and B already.

const GS_LCOL = ['#5cc8e6', '#a48cf2', '#ee72a8', '#9bd36c'];
const GS_SHAPES = [
  ['sine', 'Sine', 'M1 7 C3 0,6 0,8 7 S13 14,15 7'],
  ['tri', 'Triangle', 'M1 7 L4.5 1 L11.5 13 L15 7'],
  ['up', 'Saw up', 'M1 13 L14 1 V13'],
  ['down', 'Saw down', 'M1 1 L14 13 V1'],
  ['square', 'Square', 'M1 2 H8 V12 H15'],
  ['steps', 'Random steps', 'M1 9 H4 V3 H7 V11 H10 V5 H13 V8 H15'],
  ['smooth', 'Smooth random', 'M1 9 C3 9,3 3,5 3 S7 11,9 11 S12 5,15 6'],
];
const GS_DIVS = ['8 bars', '4 bars', '2 bars', '1 bar', '1/2', '1/4', '1/8', '1/16', '1/32'];

const gsRnd = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

function gsLfoVal(s, u, cyc = 0) {
  if (u !== 1) u = ((u % 1) + 1) % 1;
  switch (s.shape) {
    case 'sine': return 0.5 + 0.5 * Math.sin(u * WV_TAU);
    case 'tri': return u < 0.25 ? 0.5 + 2 * u : u < 0.75 ? 1.5 - 2 * u : 2 * u - 1.5;
    case 'up': return u;
    case 'down': return 1 - u;
    case 'square': return u < 0.5 ? 1 : 0;
    case 'steps': return gsRnd(cyc * 8 + Math.floor(u * 8));
    default: {
      const k = u * 4, i = Math.floor(k), f = k - i, a = gsRnd(cyc * 4 + i), b = gsRnd(cyc * 4 + i + 1);
      return a + (b - a) * (0.5 - 0.5 * Math.cos(Math.PI * f));
    }
  }
}

function gsLfoRate(L) {
  if (L.sync) return GS_DIVS[Math.round(L.rate * (GS_DIVS.length - 1))];
  const h = 0.02 * Math.pow(2000, L.rate);
  return h < 1 ? h.toFixed(2) + ' Hz' : h < 10 ? h.toFixed(1) + ' Hz' : Math.round(h) + ' Hz';
}

/// A small knob, as SVG on a 32-unit square.
function gsKnobSvg(n, col) {
  const a0 = Math.PI * 0.75, sw = Math.PI * 1.5, cx = 16, cy = 16, r = 11.5;
  const P = (a, rr = r) => [cx + Math.cos(a) * rr, cy + Math.sin(a) * rr];
  const arc = (u0, u1) => {
    u1 = Math.max(u0 + 0.0005, u1);
    const [x0, y0] = P(a0 + sw * u0), [x1, y1] = P(a0 + sw * u1);
    return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 ${sw * (u1 - u0) > Math.PI ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
  };
  const [px, py] = P(a0 + sw * n, 7.5);
  return `<circle cx="16" cy="16" r="9" fill="rgba(255,255,255,.07)" stroke="rgba(0,0,0,.55)"/>`
    + `<path d="${arc(0, 1)}" stroke="rgba(255,255,255,.1)" stroke-width="2.2" fill="none" stroke-linecap="round"/>`
    + `<path d="${arc(0, n)}" stroke="${col}" stroke-width="2.2" fill="none" stroke-linecap="round"/>`
    + `<line x1="16" y1="16" x2="${px.toFixed(2)}" y2="${py.toFixed(2)}" stroke="var(--gs-t)" stroke-width="1.6" stroke-linecap="round"/>`;
}

function gsBuildModulate() {
  $('gsRMod').innerHTML = GS.lfo.map((L, i) => `<div class="gs-lfr" style="--c:${GS_LCOL[i]}">
   <div class="gs-well"><canvas id="gsLsc${i}" data-w="92" data-h="28"></canvas></div>
   <div class="gs-lcol">
    <div class="gs-lr1"><span class="gs-lnm">LFO ${i + 1}</span><div class="gs-seg gs-lshp">${GS_SHAPES.map(([k, d, p]) => `<span class="${L.shape === k ? 'on' : ''}" title="${d}"><svg viewBox="0 0 16 14"><path d="${p}"/></svg></span>`).join('')}</div></div>
    <div class="gs-lr2"><div class="gs-seg"><span class="${L.mode === 'free' ? 'on' : ''}">Free</span><span class="${L.mode === 'trig' ? 'on' : ''}">Each note</span></div><div class="gs-seg"><span class="${L.sync ? '' : 'on'}">Hz</span><span class="${L.sync ? 'on' : ''}">Tempo</span></div></div>
   </div>
   <div class="gs-sk"><svg viewBox="0 0 32 32">${gsKnobSvg(L.rate, GS_LCOL[i])}</svg><b>${gsLfoRate(L)}</b><span>Rate</span></div>
   <div class="gs-sk"><svg viewBox="0 0 32 32">${gsKnobSvg(L.depth, GS_LCOL[i])}</svg><b>${Math.round(L.depth * 100)} %</b><span>Depth</span></div>
   <div class="gs-lmap"><span class="gs-mapb">MAP</span><div class="gs-ltg"><span class="gs-hint">Moves nothing yet</span></div></div>
  </div>`).join('');
  gsCvs($('gsPMod'));
  gsDrawModulate();
}

function gsDrawModulate() {
  const cl = gsCl(), E = GS.amp;
  const g = GS_CV.gsAmp;
  if (g) {
    const { c, w, h } = g, x0 = 8, W = w - 16;
    const ta = Math.sqrt(E.a) * 0.22 * W, td = Math.sqrt(E.d) * 0.26 * W, hold = 0.16 * W, tr = Math.sqrt(E.r) * 0.36 * W, top = 8, bot = h - 8, sy = bot - (bot - top) * E.s;
    const P = { o: [x0, bot], a: [x0 + ta, top], d: [x0 + ta + td, sy], s: [x0 + ta + td + hold, sy], r: [x0 + ta + td + hold + tr, bot] };
    c.clearRect(0, 0, w, h);
    const p = new Path2D();
    p.moveTo(...P.o);
    p.quadraticCurveTo(P.o[0] + (P.a[0] - P.o[0]) * 0.35, P.a[1] + (P.o[1] - P.a[1]) * 0.25, ...P.a);
    p.quadraticCurveTo(P.a[0] + (P.d[0] - P.a[0]) * 0.15, P.d[1], ...P.d);
    p.lineTo(...P.s);
    p.quadraticCurveTo(P.s[0] + (P.r[0] - P.s[0]) * 0.15, P.r[1], ...P.r);
    wvUnder(c, p, P.o[0], P.r[0], h, 0, cl, 0.18);
    wvTrace(c, p, cl, 1.5);
    for (const k of ['a', 'd', 'r']) { c.fillStyle = cl.t; c.beginPath(); c.arc(...P[k], 3, 0, WV_TAU); c.fill(); }
    const ta2 = E.a ** 2 * 4 + 0.004, td2 = E.d ** 2 * 4, tr2 = E.r ** 2 * 6;
    gsTxt('gsAmpRo', `${gsFmtS(ta2)} · ${gsFmtS(td2)} · ${Math.round(E.s * 100)} % · ${gsFmtS(tr2)}`);
  }
  GS.lfo.forEach((L, i) => {
    const s = GS_CV['gsLsc' + i];
    if (!s) return;
    const { c, w, h } = s;
    c.clearRect(0, 0, w, h);
    c.fillStyle = 'rgba(255,255,255,.05)';
    c.fillRect(4, h / 2, w - 8, 1);
    c.strokeStyle = GS_LCOL[i];
    c.globalAlpha = 0.45;
    c.lineWidth = 1.4;
    c.stroke(wvPath((u) => [4 + u * (w - 8), h - 5 - gsLfoVal(L, u, 0) * (h - 10)], 100));
    c.globalAlpha = 1;
  });
}

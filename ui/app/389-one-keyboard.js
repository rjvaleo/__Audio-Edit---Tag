// ================================================================ The one keyboard
//
// RJ, 17 Nov 2026: "All the keyboards should be the same size. They shouldn't be
// different… the same keyboard, the same size keys" and "we want that keyboard
// to be persistent in the same size". Grain, Wave and Atmosphere draw their keys
// here: 49 keys, four octaves from a C, every white key 28 px wide and 100 px
// tall, every black key 18 × 60 px. The width never follows the window.
//
// Until then Grain drew 61 keys across 1000 px, Wave 37 across 604 px, and
// Atmosphere 61 stretched across whatever room its frame had (48 px a key in
// a 2000 px window). Grain's and Wave's drawing were two copies of one routine;
// this is that routine, once. Each page keeps what it does with a key (its
// engine, its voices, its MIDI channel); only the keys themselves are shared.

const KB1 = { n: 49, ww: 28, bw: 18, bh: 60, h: 100 };
KB1.w = 29 * KB1.ww; // 49 keys from a C are 29 white keys: 812 px

const kb1Black = (n) => [1, 3, 6, 8, 10].includes(((n % 12) + 12) % 12);

/// Where each key is, from the lowest one `lo` (a C): `{ note: [x, w, black] }`.
function kb1Layout(lo) {
  const pos = {};
  let i = 0;
  for (let n = lo; n < lo + KB1.n; n++) if (!kb1Black(n)) pos[n] = [i++ * KB1.ww, KB1.ww, false];
  for (let n = lo; n < lo + KB1.n; n++) if (kb1Black(n)) pos[n] = [pos[n - 1][0] + KB1.ww - KB1.bw / 2, KB1.bw, true];
  return pos;
}

/// The key under a point in the canvas (its own pixels, not the screen's).
function kb1At(lo, x, y) {
  const L = kb1Layout(lo);
  for (const n in L) { const [k, w, b] = L[n]; if (b && x >= k && x < k + w && y < KB1.bh) return +n; }
  for (const n in L) { const [k, w, b] = L[n]; if (!b && x >= k && x < k + w) return +n; }
  return null;
}

/// Draw the keys into a canvas context `c` (already scaled to CSS pixels).
/// `lit(n)` says whether a key is sounding; `hue` colours what is lit; `cl`
/// carries the page's text colours and fonts (`t3`, `sans`).
function kb1Draw(c, lo, lit, hue, cl) {
  const L = kb1Layout(lo), h = KB1.h;
  c.clearRect(0, 0, KB1.w, h);
  for (const n in L) {
    const [x, kw, b] = L[n], on = lit(+n);
    if (b) continue;
    const gr = c.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, on ? `hsl(${hue},35%,30%)` : '#2b2e34');
    gr.addColorStop(1, on ? `hsl(${hue},45%,22%)` : '#1d1f23');
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
  for (const n in L) {
    const [x, kw, b] = L[n], on = lit(+n);
    if (!b) continue;
    const gr = c.createLinearGradient(0, 0, 0, KB1.bh);
    gr.addColorStop(0, on ? '#2c3038' : '#131417'); gr.addColorStop(1, on ? '#1d2026' : '#060708');
    c.fillStyle = gr;
    c.shadowBlur = 4; c.shadowColor = 'rgba(0,0,0,.7)';
    c.beginPath(); c.roundRect(x, 0, kw, KB1.bh, [0, 0, 3, 3]); c.fill();
    c.shadowBlur = 0;
    if (on) { c.fillStyle = `hsl(${hue},70%,62%)`; c.fillRect(x + 2, KB1.bh - 7, kw - 4, 3); }
  }
}

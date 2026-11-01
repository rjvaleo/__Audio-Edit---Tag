// The Visual column's controls, drawn as what they do.
//
// Every knob in the column was a word and a number: "Swell 0.60", "Window
// 7.20", "Key side −0.35". Now each one has a small drawing above it of the
// part of the room it moves, drawn from its value, so a turn shows what it did
// before the room is looked at. The palette's slots and the room's layers say
// where in the room each one is; the generators show the palette they make; the
// 4D tab draws each solid and each plane's angle.
//
// **One language**, the grain glyphs' (`grain-glyphs.js`): what the control
// moves is drawn in colour and the context around it in the dim text colour.
// The colour is the one the palette gives that part of the room — the ring's
// knobs are drawn in the ring's colour — so the Colour tab is visible from the
// Room tab, and a palette change repaints every picture.
//
// **Knobs that shape one thing draw it together.** The ring's four, the lamp's
// three, the room box's four, the stacked lines' nine: each draws the whole
// object from every one of its group's values, and puts its own part of it in
// colour. Turning Drive changes the ring above Size too.
//
// **Decoration, for a screen reader.** Every picture is `aria-hidden`; the knob
// keeps its name and its reading.
//
// Every drawing is a pure function of the values, on a 64 × 48 grid, returning
// SVG. Nothing here keeps state but the list of live pictures, so a reset, a
// recalled look or an undo redraws exactly as a drag does.

const CP_W = 64, CP_H = 48, CP_FLOOR = 42;

const cpLerp = (a, b, t) => a + (b - a) * t;
const cpClamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const cpN = (v) => (Math.round(v * 100) / 100).toString();
/// A stable scatter: the same dots in the same places on every redraw, so a
/// turn changes how many or how far, never which.
const cpRnd = (i, s = 7) => { const x = Math.sin(i * 127.1 + s * 311.7) * 43758.5453; return x - Math.floor(x); };

const cpL = (x1, y1, x2, y2, cls = 'f', extra = '') =>
  `<line x1="${cpN(x1)}" y1="${cpN(y1)}" x2="${cpN(x2)}" y2="${cpN(y2)}" class="${cls}" ${extra}/>`;
const cpP = (d, cls = 'a', extra = '') => `<path d="${d}" class="${cls}" ${extra}/>`;
const cpC = (x, y, r, cls = 'a', extra = '') => `<circle cx="${cpN(x)}" cy="${cpN(y)}" r="${cpN(Math.max(0.1, r))}" class="${cls}" ${extra}/>`;
const cpPts = (pts) => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${cpN(x)} ${cpN(y)}`).join('');
const cpArrow = (x1, y1, x2, y2, cls = 'a') => {
  const a = Math.atan2(y2 - y1, x2 - x1), s = 3.5;
  return cpL(x1, y1, x2, y2, cls)
    + cpP(`M${cpN(x2 - s * Math.cos(a - 0.5))} ${cpN(y2 - s * Math.sin(a - 0.5))}L${cpN(x2)} ${cpN(y2)}L${cpN(x2 - s * Math.cos(a + 0.5))} ${cpN(y2 - s * Math.sin(a + 0.5))}`, cls);
};
const cpGround = () => cpL(4, CP_FLOOR, 60, CP_FLOOR);

// ─────────────────────────────────────────────────────────────── the ring ──

/// The Lissajous hoop: `size` its radius, `drive` how far the sound pushes it
/// out of round, `fine` how many points it is drawn with (faceted when few),
/// `stroke` the dark border under its line, `high` how high it hangs, `rows`
/// how many hoops trail behind it. `own` says which of those is this knob's.
function cpRing(v, own) {
  const size = v.size ?? 0.5, drive = v.drive ?? 0.2, fine = v.fine ?? 0.5;
  const stroke = v.stroke ?? 0.2, high = v.high ?? 0.5, rows = v.rows ?? 0;
  const r = 7 + 12 * size, cy = cpLerp(28, 18, high), cx = 32;
  const n = Math.round(5 + 43 * fine);
  const hoop = (rr, x0, y0) => {
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      const push = 1 + drive * 0.45 * (0.6 * Math.sin(3 * a + 0.4) + 0.4 * Math.sin(5 * a + 1.3));
      pts.push([x0 + rr * push * Math.cos(a), y0 + rr * push * Math.sin(a) * 0.92]);
    }
    return pts;
  };
  let s = cpGround();
  // The trail: earlier hoops, further back and smaller.
  const behind = Math.round(rows * 4);
  for (let k = behind; k >= 1; k--) {
    const f = 1 - k * 0.13;
    s += cpP(cpPts(hoop(r * f, cx + k * 2.2, cy - k * 1.2)), own === 'rows' ? 'a thin' : 'f');
  }
  const pts = hoop(r, cx, cy);
  if (stroke > 0.01) s += cpP(cpPts(pts), 'h', `stroke-width="${cpN(1 + stroke * 9)}"`);
  s += cpP(cpPts(pts), 'a');
  if (own === 'size') s += cpL(cx, cy, cx + r, cy, 'a thin', 'stroke-dasharray="2 2"');
  if (own === 'fine') for (const [x, y] of pts.slice(0, n)) s += cpC(x, y, 0.9, 'af');
  if (own === 'high') s += cpArrow(8, CP_FLOOR, 8, cy, 'a thin');
  return s;
}

// ────────────────────────────────────────────────────────────── the solid ──

/// The tesseract as it hangs in the room: a cube inside a cube. `eye` close in
/// shrinks the inner one (perspective down w); `turn` twists it; `swell` bows
/// the edges out as the sound pushes the vertices; `size` scales the whole.
function cpSolid(v, own) {
  const size = v.size ?? 0.4, eye = v.eye ?? 0.4, turn = v.turn ?? 0.2, swell = v.swell ?? 0.3;
  const R = 11 + 11 * size, cx = 32, cy = 23;
  const inner = R * (0.3 + 0.55 * eye), tw = turn * 0.7;
  const sq = (r, a) => [0, 1, 2, 3].map((i) => {
    const t = a + Math.PI / 4 + i * Math.PI / 2;
    return [cx + r * Math.SQRT2 * Math.cos(t) * 0.75, cy + r * Math.SQRT2 * Math.sin(t) * 0.75];
  });
  const o = sq(R, 0), n = sq(inner, tw);
  const bow = swell * 5;
  const edge = (p, q, cls) => {
    const mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2;
    const dx = mx - cx, dy = my - cy, d = Math.hypot(dx, dy) || 1;
    return cpP(`M${cpN(p[0])} ${cpN(p[1])}Q${cpN(mx + dx / d * bow)} ${cpN(my + dy / d * bow)} ${cpN(q[0])} ${cpN(q[1])}`, cls);
  };
  let s = '';
  for (let i = 0; i < 4; i++) s += edge(o[i], n[i], own === 'turn' || own === 'eye' ? 'a thin' : 'f');
  for (let i = 0; i < 4; i++) s += edge(o[i], o[(i + 1) % 4], 'a');
  for (let i = 0; i < 4; i++) s += edge(n[i], n[(i + 1) % 4], own === 'eye' || own === 'turn' ? 'a' : 'f');
  return s;
}

/// The 4D panel's Rate: how fast the plane turns, as a sweep.
function cpRate(t) {
  const a1 = -Math.PI / 2 + Math.PI * 2 * (0.06 + 0.86 * t), r = 14, cx = 32, cy = 24;
  const pts = [];
  for (let i = 0; i <= 32; i++) {
    const a = cpLerp(-Math.PI / 2, a1, i / 32);
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  const [x, y] = pts[pts.length - 1], [px, py] = pts[pts.length - 2];
  return cpC(cx, cy, r, 'f') + cpP(cpPts(pts), 'a') + cpArrow(px, py, x, y);
}

// ───────────────────────────────────────────────────────────── the grains ──

/// The cloud of grains: `cloud` how many are drawn, `size` each one's, `drift`
/// how far each wanders on its way, `glow` how brightly each burns, `cap` the
/// most there can ever be (a dashed ceiling: the engine holds it there).
function cpGrains(v, own) {
  const cloud = v.cloud ?? 0.6, size = v.size ?? 0.3, drift = v.drift ?? 0.2;
  const glow = v.glow ?? 0.5, cap = v.cap ?? 1;
  const most = Math.round(3 + 26 * cap);
  const n = Math.min(most, Math.round(2 + 30 * cloud));
  const r = 0.8 + 3.2 * size;
  let s = '';
  for (let i = 0; i < n; i++) {
    const x = 8 + cpRnd(i, 2) * 48, y = 8 + cpRnd(i, 5) * 28;
    if (glow > 0.02) s += cpC(x, y, r + 1 + glow * 4, 'hf', `opacity="${cpN(0.12 + glow * 0.35)}"`);
    if (drift > 0.02) {
      const dx = -drift * 9, dy = (cpRnd(i, 9) - 0.5) * drift * 8;
      s += cpP(`M${cpN(x)} ${cpN(y)}Q${cpN(x + dx / 2)} ${cpN(y - dy)} ${cpN(x + dx)} ${cpN(y + dy)}`, own === 'drift' ? 'a thin' : 'f');
    }
    s += cpP(`M${cpN(x)} ${cpN(y - r)}L${cpN(x + r)} ${cpN(y)}L${cpN(x)} ${cpN(y + r)}L${cpN(x - r)} ${cpN(y)}Z`, 'af');
  }
  if (own === 'cap') s += cpL(4, 5, 60, 5, 'a thin', 'stroke-dasharray="2 3"') + cpL(4, 5 + 36 * (1 - cap), 60, 5 + 36 * (1 - cap), 'f');
  return s;
}

/// The room's own Cloud and Burn: the streaks that each grain is drawn as.
function cpStreaks(v, own) {
  const cloud = v.cloud ?? 0.8, burn = v.burn ?? 0.3;
  const n = Math.round(2 + 22 * cloud);
  let s = cpGround();
  for (let i = 0; i < n; i++) {
    const x = 6 + cpRnd(i, 3) * 46, y = 8 + cpRnd(i, 4) * 28, len = 4 + cpRnd(i, 6) * 8;
    if (burn > 0.02) s += cpL(x, y, x + len, y, 'h', `stroke-width="${cpN(2 + burn * 5)}" opacity="${cpN(0.15 + burn * 0.4)}"`);
    s += cpL(x, y, x + len, y, own === 'burn' ? 'a' : 'a thin');
  }
  return s;
}

/// The data block: the schedule printed on the back wall, at its opacity.
function cpBlock(t) {
  let s = cpP('M14 6H50V40H14Z', 'f');
  for (let i = 0; i < 7; i++) {
    const w = 10 + cpRnd(i, 8) * 20;
    s += cpL(18, 10 + i * 4.4, 18 + w, 10 + i * 4.4, 'a', `opacity="${cpN(0.1 + 0.9 * t)}"`);
  }
  return s;
}

// ──────────────────────────────────────────────────────── stacked lines ──

/// The stacked lines: the ridgeline's sleeve, the surfaces on the room's
/// walls, the stage's terrain. Every knob of the stack draws the whole stack
/// from all its values and puts its own aspect in colour.
///
/// `rows` how many lines, `points` how finely each is drawn, `height` how far a
/// peak stands, `gain` how hard the sound drives it, `span` how much of the
/// width carries sound, `window` how hard it is pulled to the middle, `silence`
/// below what it is drawn flat, `smooth` how much it is softened, `weight` the
/// line's thickness, `depth` how far the stack runs back. `persp` draws it
/// receding into a room rather than flat on a sleeve.
function cpStack(v, own, persp) {
  const rows = Math.round(3 + 7 * (v.rows ?? 0.4));
  const points = Math.round(6 + 52 * (v.points ?? 0.5));
  const height = 0.2 + 0.8 * (v.height ?? 0.5), gain = 0.3 + 0.9 * (v.gain ?? 0.4);
  const span = 0.3 + 0.7 * (v.span ?? 0.8), win = v.window ?? 0.5;
  const silence = v.silence ?? 0.1, smooth = v.smooth ?? 0.25;
  const weight = v.weight ?? 0.2, depth = v.depth ?? 0.5;
  const amp = Math.min(16, 3 + 13 * height * gain);
  const lineAt = (k) => {
    // Front line last: it is the one drawn in colour.
    const f = k / Math.max(1, rows - 1);
    if (!persp) return { y: 12 + f * 28, x0: 6, x1: 58 };
    const back = 0.35 + 0.4 * (1 - depth);
    const sc = cpLerp(back, 1, f);
    return { y: cpLerp(14, 42, f ** 1.3), x0: 32 - 26 * sc, x1: 32 + 26 * sc };
  };
  const shape = (k, x0, x1) => {
    const pts = [];
    const lo = 0.5 - span / 2, hi = 0.5 + span / 2;
    for (let i = 0; i <= points; i++) {
      const u = i / points;
      let h = 0;
      if (u >= lo && u <= hi) {
        // A noisy spectrum, softened by `smooth`, pulled to the middle by `window`.
        const raw = 0.5 + 0.5 * Math.sin(u * 37 + k * 2.1) * Math.cos(u * 13 + k);
        const rough = cpRnd(i + k * 61, 11);
        h = cpLerp(rough, raw, cpClamp(smooth * 1.2));
        const pull = Math.exp(-(((u - 0.5) / (0.08 + 0.42 * (1 - win))) ** 2));
        h *= cpLerp(1, pull, cpClamp(win * 1.3));
        if (h < silence * 0.7) h = 0;
      }
      pts.push([cpLerp(x0, x1, u), h]);
    }
    return pts;
  };
  let s = '';
  for (let k = 0; k < rows; k++) {
    const { y, x0, x1 } = lineAt(k);
    const sc = (x1 - x0) / 52;
    const pts = shape(k, x0, x1).map(([x, h]) => [x, y - h * amp * sc]);
    const front = k === rows - 1;
    // The fill under each line hides the ones behind it: that is what makes a
    // stack read as depth rather than as a hairball.
    s += cpP(`${cpPts(pts)}L${cpN(x1)} ${cpN(y + 1)}L${cpN(x0)} ${cpN(y + 1)}Z`, 'bg');
    const lit = own === 'rows' || own === 'depth' || front;
    const w = own === 'weight' || own === undefined ? 0.8 + weight * 3.2 : null;
    s += cpP(cpPts(pts), lit ? 'a' : 'f', w ? `stroke-width="${cpN(front ? w : w * 0.6)}"` : '');
    if (front) {
      if (own === 'points') for (const [x, yy] of pts) s += cpC(x, yy, 0.8, 'af');
      if (own === 'span') {
        const a = cpLerp(x0, x1, 0.5 - span / 2), b = cpLerp(x0, x1, 0.5 + span / 2);
        s += cpL(a, y + 4, b, y + 4, 'a thin') + cpL(a, y + 2, a, y + 6, 'a thin') + cpL(b, y + 2, b, y + 6, 'a thin');
      }
      if (own === 'height' || own === 'gain') s += cpArrow(x1 - 3, y, x1 - 3, y - amp * sc, 'a thin');
      if (own === 'silence') s += cpL(x0, y - silence * 0.7 * amp * sc, x1, y - silence * 0.7 * amp * sc, 'a thin', 'stroke-dasharray="2 2"');
      if (own === 'window') {
        const env = [];
        for (let i = 0; i <= 24; i++) {
          const u = i / 24, pull = Math.exp(-(((u - 0.5) / (0.08 + 0.42 * (1 - win))) ** 2));
          env.push([cpLerp(x0, x1, u), y - amp * sc * cpLerp(1, pull, cpClamp(win * 1.3))]);
        }
        s += cpP(cpPts(env), 'a thin', 'stroke-dasharray="2 2"');
      }
    }
  }
  return s;
}

// ──────────────────────────────────────────────────────────── the camera ──

/// Where the camera stands, from the side: `dist` from what it looks at,
/// `lift` above the floor, `aim` how far down the room it looks, `lens` how
/// wide. The room is dim; the camera and what it sees are in colour.
function cpCamera(v, own) {
  const dist = v.dist ?? 0.4, lift = v.lift ?? 0.6, aim = v.aim ?? 0.4, lens = v.lens ?? 0.5;
  const tx = 40 + aim * 18, ty = CP_FLOOR - 4;
  const cx = cpLerp(36, 4, dist), cy = cpLerp(CP_FLOOR - 2, 6, lift);
  const half = 0.12 + lens * 0.55;
  const a = Math.atan2(ty - cy, tx - cx), reach = 70;
  let s = cpGround() + cpP(`M44 ${CP_FLOOR}V${CP_FLOOR - 8}H52V${CP_FLOOR}`, 'f');
  s += cpP(`M${cpN(cx)} ${cpN(cy)}L${cpN(cx + reach * Math.cos(a - half))} ${cpN(cy + reach * Math.sin(a - half))}L${cpN(cx + reach * Math.cos(a + half))} ${cpN(cy + reach * Math.sin(a + half))}Z`,
    'hf', `opacity="${own === 'lens' ? 0.32 : 0.16}"`);
  s += cpL(cx, cy, tx, ty, own === 'aim' ? 'a' : 'a thin', 'stroke-dasharray="2 2"');
  s += cpC(cx, cy, 2.6, 'af');
  if (own === 'dist') s += cpL(cx, CP_FLOOR + 3, tx, CP_FLOOR + 3, 'a thin');
  if (own === 'lift') s += cpArrow(cx, CP_FLOOR, cx, cy + 3, 'a thin');
  return s;
}

/// Round the subject, from above: `orbit` where on the circle the camera is,
/// `tilt` above or below it (drawn as the camera's height on the side), `dist`
/// the circle's size, `lens` the cone.
function cpOrbit(v, own) {
  const orbit = v.orbit ?? 0.5, tilt = v.tilt ?? 0.5, dist = v.dist ?? 0.3, lens = v.lens ?? 0.5;
  if (own === 'tilt') return cpCamera({ dist: 0.5, lift: tilt, aim: 0.1, lens }, 'lift');
  const cx = 32, cy = 24, r = 6 + 14 * dist;
  const a = (orbit - 0.5) * Math.PI * 2 + Math.PI / 2;
  const x = cx + r * Math.cos(a), y = cy + r * Math.sin(a);
  const toward = Math.atan2(cy - y, cx - x), half = 0.12 + lens * 0.55, reach = r + 10;
  let s = cpC(cx, cy, r, own === 'orbit' || own === 'dist' ? 'a thin' : 'f') + cpP(`M29 21H35V27H29Z`, 'f');
  s += cpP(`M${cpN(x)} ${cpN(y)}L${cpN(x + reach * Math.cos(toward - half))} ${cpN(y + reach * Math.sin(toward - half))}L${cpN(x + reach * Math.cos(toward + half))} ${cpN(y + reach * Math.sin(toward + half))}Z`,
    'hf', `opacity="${own === 'lens' ? 0.32 : 0.16}"`);
  s += cpC(x, y, 2.6, 'af');
  if (own === 'dist') s += cpL(cx, cy, x, y, 'a thin', 'stroke-dasharray="2 2"');
  return s;
}

// ─────────────────────────────────────────────────────── the room's shape ──

/// The box the room is: `width`, `height`, `depth`, and `taper`, how far the
/// back draws in. `grid` rules the walls, `fade` how strongly.
function cpBox(v, own) {
  const w = 14 + 26 * (v.width ?? 0.6), h = 10 + 20 * (v.height ?? 0.5);
  const depth = v.depth ?? 0.6, taper = v.taper ?? 0.7;
  const grid = v.grid ?? 0.3, fade = v.fade ?? 0.3;
  const cx = 32, base = 44;
  const back = (1 - 0.6 * depth) * cpLerp(0.4, 1, taper);
  const fx0 = cx - w, fx1 = cx + w, fy0 = base - h * 1.3, fy1 = base;
  const bw = w * back, bh = h * 1.3 * back, by1 = base - (1 - back) * 16;
  const bx0 = cx - bw, bx1 = cx + bw, by0 = by1 - bh;
  const front = cpP(`M${cpN(fx0)} ${cpN(fy0)}H${cpN(fx1)}V${cpN(fy1)}H${cpN(fx0)}Z`, 'f');
  let s = front;
  const lit = (k) => (own === k ? 'a' : 'f');
  s += cpP(`M${cpN(bx0)} ${cpN(by0)}H${cpN(bx1)}V${cpN(by1)}H${cpN(bx0)}Z`, own === 'taper' || own === 'depth' ? 'a' : 'a thin');
  for (const [a, b] of [[[fx0, fy0], [bx0, by0]], [[fx1, fy0], [bx1, by0]], [[fx1, fy1], [bx1, by1]], [[fx0, fy1], [bx0, by1]]]) {
    s += cpL(a[0], a[1], b[0], b[1], lit('depth'));
  }
  const lines = Math.round(1 + grid * 9);
  for (let i = 1; i <= lines; i++) {
    const x = cpLerp(bx0, bx1, i / (lines + 1));
    s += cpL(x, by0, x, by1, own === 'grid' || own === 'fade' ? 'a thin' : 'f', `opacity="${cpN(0.15 + 0.85 * fade)}"`);
  }
  if (own === 'width') s += cpArrow(cx, base + 3, fx1, base + 3, 'a thin') + cpArrow(cx, base + 3, fx0, base + 3, 'a thin');
  if (own === 'height') s += cpArrow(fx0 - 3, base, fx0 - 3, fy0, 'a thin');
  return s;
}

/// The room's floor from above-front: `width` across and `reach` back.
function cpPlan(v, own) {
  const w = 6 + 24 * (v.width ?? 0.3), reach = 6 + 30 * (v.reach ?? 0.3);
  const near = 44, far = near - reach, cx = 32, fw = w * 0.55;
  let s = cpP(`M${cpN(cx - w)} ${near}L${cpN(cx - fw)} ${cpN(far)}L${cpN(cx + fw)} ${cpN(far)}L${cpN(cx + w)} ${near}Z`, 'a');
  for (let i = 1; i < 4; i++) {
    const y = cpLerp(near, far, i / 4), half = cpLerp(w, fw, i / 4);
    s += cpL(cx - half, y, cx + half, y, 'f');
  }
  if (own === 'width') s += cpArrow(cx, near + 2, cx + w, near + 2, 'a thin');
  if (own === 'reach') s += cpArrow(cx + w + 3, near, cx + fw + 3, far, 'a thin');
  return s;
}

/// The floor's bands: the spectrum across the floor, `t` how many.
function cpBands(t) {
  const n = Math.round(4 + 28 * t);
  let s = cpGround();
  for (let i = 0; i < n; i++) {
    const x = 6 + (i + 0.5) * 52 / n, h = 4 + 26 * (0.4 + 0.6 * Math.sin(i / n * Math.PI)) * (0.5 + 0.5 * cpRnd(i, 4));
    s += cpL(x, CP_FLOOR, x, CP_FLOOR - h, 'a', `stroke-width="${cpN(Math.max(0.6, 36 / n))}"`);
  }
  return s;
}

/// The trail: frames of the floor receding, `t` how many.
function cpTrail(t) {
  const n = Math.round(2 + 9 * t);
  let s = '';
  for (let k = n - 1; k >= 0; k--) {
    const f = k / Math.max(1, n - 1), sc = cpLerp(1, 0.35, f), y = cpLerp(42, 12, f);
    const pts = [];
    for (let i = 0; i <= 20; i++) {
      const u = i / 20;
      pts.push([32 + (u - 0.5) * 52 * sc, y - Math.sin(u * Math.PI) * (0.5 + 0.5 * cpRnd(i + k * 7, 3)) * 7 * sc]);
    }
    s += cpP(cpPts(pts), k === 0 ? 'a' : 'a thin', `opacity="${cpN(1 - 0.75 * f)}"`);
  }
  return s;
}

/// The ridge's height: one line of terrain, `t` how tall it stands.
function cpRidge(t) {
  const pts = [];
  for (let i = 0; i <= 32; i++) {
    const u = i / 32;
    pts.push([6 + u * 52, CP_FLOOR - (0.25 + 0.75 * Math.abs(Math.sin(u * 9.3) * Math.cos(u * 3.1))) * (2 + 30 * t)]);
  }
  return cpGround() + cpP(cpPts(pts), 'a');
}

/// Span: how many seconds the floor holds. Longer is more of the sound
/// squeezed into the same floor.
function cpSpan(t) {
  const pts = [];
  const cycles = 1.5 + 14 * t;
  for (let i = 0; i <= 96; i++) {
    const u = i / 96;
    pts.push([6 + u * 52, 22 - Math.sin(u * cycles * Math.PI * 2) * (5 + 4 * cpRnd(Math.floor(u * cycles), 5))]);
  }
  let s = cpP(cpPts(pts), 'a');
  for (let i = 0; i <= 4; i++) s += cpL(6 + i * 13, 36, 6 + i * 13, 40, 'f');
  return s + cpL(6, 38, 58, 38, 'f');
}

/// A grain, as the glyphs everywhere draw one: a bell. `t` its width.
function cpBell(t) {
  const w = 6 + 48 * t, cx = 32, h = 28, n = 24;
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    pts.push([cx - w / 2 + w * u, CP_FLOOR - h * 0.5 * (1 - Math.cos(2 * Math.PI * u))]);
  }
  return cpGround() + cpP(cpPts(pts), 'a');
}

// ───────────────────────────────────────────────────────────── the air ──

/// The air: `fog` how thick, `mist` how many particles, `size` each one's,
/// `drift` how fast they move (their streaks).
function cpAir(v, own) {
  const fog = v.fog ?? 0.2, mist = v.mist ?? 0.4, size = v.size ?? 0.3, drift = v.drift ?? 0.2;
  let s = '';
  // Fog: the far wall disappearing.
  for (let i = 0; i < 4; i++) {
    const x0 = 6 + i * 4, y0 = 6 + i * 3;
    s += cpP(`M${x0} ${y0}H${64 - x0}V${48 - y0}H${x0}Z`, own === 'fog' ? 'a thin' : 'f', `opacity="${cpN(Math.max(0.08, 1 - fog * (i + 1) * 0.45))}"`);
  }
  s += cpP('M18 15H46V33H18Z', 'hf', `opacity="${cpN(fog * 0.6)}"`);
  const n = Math.round(4 + 30 * mist), r = 0.5 + 2.2 * size;
  for (let i = 0; i < n; i++) {
    const x = 6 + cpRnd(i, 12) * 52, y = 6 + cpRnd(i, 13) * 36;
    if (drift > 0.02) s += cpL(x, y, x - drift * 9, y - drift * 3, own === 'drift' ? 'a thin' : 'f');
    s += cpC(x, y, r, own === 'fog' ? 'ff' : 'af');
  }
  return s;
}

/// The sleeve on the stage's walls: `span` how much of each wall the lines run
/// across, `stand` how far they stand off it.
function cpSleeve(v, own) {
  const span = 0.3 + 0.7 * (v.span ?? 0.8), stand = v.stand ?? 0.3;
  let s = cpP('M4 4L22 16V32L4 44', 'f') + cpP('M60 4L42 16V32L60 44', 'f') + cpP('M22 16H42V32H22Z', 'f');
  for (let k = 0; k < 4; k++) {
    for (const side of [-1, 1]) {
      const pts = [];
      for (let i = 0; i <= 14; i++) {
        const u = i / 14;
        const x = side < 0 ? cpLerp(6, 20, u) : cpLerp(58, 44, u);
        const y = cpLerp(14 + k * 7, 18 + k * 4, u);
        const inSpan = Math.abs(u - 0.5) < span / 2;
        const off = inSpan ? Math.sin(u * 23 + k) * (1 + stand * 5) * (1 - u * 0.5) : 0;
        pts.push([x - side * Math.abs(off), y]);
      }
      s += cpP(cpPts(pts), 'a');
    }
  }
  return s;
}

// ──────────────────────────────────────────────────────────── the lamps ──

/// The lamps, seen from the front of the room: the key where `side`, `high`
/// and `at` (further back is smaller) put it, its rays as bright as `key`, a
/// fill opposite, a rim behind, the ambient as a wash, the shadow under the
/// subject as soft as `shadow`, and `drive` shaking the key with the sound.
function cpLamps(v, own) {
  const key = v.key ?? 0.3, side = v.side ?? 0.3, high = v.high ?? 0.8, at = v.at ?? 0.6;
  const fill = v.fill ?? 0.1, rim = v.rim ?? 0.1, amb = v.ambient ?? 0.1;
  const drive = v.drive ?? 0.2, shadow = v.shadow ?? 0.5;
  const ox = 32, oy = 33;
  let s = cpGround() + cpP('M4 4H60V44H4Z', 'f', `opacity="0.5"`);
  if (amb > 0.01) s += cpP('M5 5H59V43H5Z', 'hf', `opacity="${cpN(amb * (own === 'ambient' ? 0.6 : 0.3))}"`);
  // The shadow: a hard edge at nought, a blur as it softens.
  const sx = ox - (side - 0.5) * 18;
  for (let i = 0; i < 4; i++) s += cpP(`M${cpN(sx - 7 - shadow * i * 2)} ${CP_FLOOR}h${cpN(14 + shadow * i * 4)}`, own === 'shadow' ? 'a' : 'f', `opacity="${cpN(i ? shadow * 0.25 : 0.7)}" stroke-width="2"`);
  s += cpP(`M${ox - 5} ${CP_FLOOR}V${oy - 3}H${ox + 5}V${CP_FLOOR}`, 'f');
  s += cpC(ox, oy - 7, 4, 'f');
  const lamp = (x, y, r, power, lit, wob) => {
    let out = '';
    const rays = 3 + Math.round(power * 4);
    for (let i = 0; i < rays; i++) {
      const tx = ox + (i - (rays - 1) / 2) * 3, ty = oy - 6;
      const pts = [];
      for (let j = 0; j <= 8; j++) {
        const u = j / 8;
        pts.push([cpLerp(x, tx, u) + Math.sin(u * 12 + i) * wob, cpLerp(y, ty, u)]);
      }
      out += cpP(cpPts(pts), lit ? 'a thin' : 'f', `opacity="${cpN(0.15 + power * 0.75)}"`);
    }
    return out + cpC(x, y, r, lit ? 'af' : 'ff');
  };
  const kx = cpLerp(8, 56, side), ky = cpLerp(40, 6, high), kr = cpLerp(3.6, 1.8, at);
  if (own === 'fill' || fill > 0.05) s += lamp(cpLerp(56, 8, side), 18, 2, fill, own === 'fill', 0);
  if (own === 'rim' || rim > 0.05) s += lamp(ox + 2, 8, 1.6, rim, own === 'rim', 0);
  const keyLit = ['key', 'side', 'high', 'at', 'drive'].includes(own);
  s += lamp(kx, ky, kr, key, keyLit, drive * 1.6);
  return s;
}

// ───────────────────────────────────────────────────────────── the look ──

/// The tone curve: `exposure` lifts it, `contrast` bends it into an S.
function cpTone(v, own) {
  const ex = v.exposure ?? 0.3, co = v.contrast ?? 0.5;
  const pts = [];
  for (let i = 0; i <= 32; i++) {
    const u = i / 32;
    const lifted = 1 - Math.exp(-u * (0.4 + 4 * ex)) / 1;
    const norm = lifted / (1 - Math.exp(-(0.4 + 4 * ex)));
    const k = 1 + 9 * co;
    const sCurve = 1 / (1 + Math.exp(-k * (norm - 0.5)));
    const lo = 1 / (1 + Math.exp(k * 0.5)), hi = 1 / (1 + Math.exp(-k * 0.5));
    pts.push([8 + u * 48, 42 - ((sCurve - lo) / (hi - lo)) * 36]);
  }
  return cpP('M8 6V42H56', 'f') + cpL(8, 42, 56, 6, 'f', 'stroke-dasharray="2 3"') + cpP(cpPts(pts), 'a');
}

/// Glow: the line giving off light of its own, `t` how much.
function cpGlow(t) {
  const pts = [];
  for (let i = 0; i <= 32; i++) { const u = i / 32; pts.push([6 + u * 52, 30 - Math.sin(u * 6) * 8]); }
  const d = cpPts(pts);
  return cpP(d, 'h', `stroke-width="${cpN(2 + t * 12)}" opacity="${cpN(0.1 + 0.4 * t)}"`) + cpP(d, 'a');
}

/// Bloom: bright things spilling. `spill` how far, `at` how bright a thing has
/// to be first — the dim bars under the line do not spill.
function cpBloom(v, own) {
  const spill = v.spill ?? 0.5, at = v.at ?? 0.3;
  const cut = 40 - at * 30;
  let s = '';
  for (let i = 0; i < 7; i++) {
    const x = 9 + i * 7.6, top = 40 - (8 + 26 * cpRnd(i, 21));
    const over = top < cut;
    if (over && spill > 0.02) s += cpL(x, 40, x, top, 'h', `stroke-width="${cpN(3 + spill * 7)}" opacity="${cpN(0.15 + spill * 0.35)}"`);
    s += cpL(x, 40, x, top, over ? 'a' : 'f', 'stroke-width="2.4"');
  }
  return s + cpL(4, cut, 60, cut, own === 'at' ? 'a thin' : 'f', 'stroke-dasharray="2 2"');
}

/// The vignette: the corners of the frame falling off.
function cpVignette(t) {
  let s = cpP('M6 8H58V40H6Z', 'a thin');
  for (let i = 1; i <= 4; i++) {
    const rx = 30 - i * 3 * t * 1.5, ry = 18 - i * 2 * t * 1.5;
    s += `<ellipse cx="32" cy="24" rx="${cpN(Math.max(4, rx))}" ry="${cpN(Math.max(3, ry))}" class="f" opacity="${cpN(0.2 + 0.2 * i * t)}"/>`;
  }
  return s;
}

/// Detail: how much of the full mesh the preview draws.
function cpDetail(t) {
  const n = Math.round(2 + 10 * t);
  let s = '';
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    s += cpL(6 + u * 52, 8, 6 + u * 52, 40, 'a thin') + cpL(6, 8 + u * 32, 58, 8 + u * 32, 'a thin');
  }
  return s;
}

/// The wire: the bright line along the terrain's ridges over its lit surface.
function cpWire(t) {
  const pts = [];
  for (let i = 0; i <= 32; i++) { const u = i / 32; pts.push([6 + u * 52, 30 - Math.abs(Math.sin(u * 7.3)) * 14]); }
  const d = cpPts(pts);
  return cpP(`${d}L58 42L6 42Z`, 'ff') + cpP(d, 'a', `opacity="${cpN(0.15 + 0.85 * t)}" stroke-width="${cpN(1 + 2 * t)}"`);
}

// ──────────────────────────────────────────────────────── which is which ──

/// Every knob with a picture: the drawing, the palette slot it is coloured
/// by, the group it shares an object with, and its own part of the object.
/// Room knobs are found by id; the panels' rows have none, so by the panel and
/// the word under the knob.
const cpOf = (draw, slot, group, own) => ({ draw, slot, group, own });
const cpOne = (draw, slot) => ({ draw: (v, own, t) => draw(t), slot, group: null, own: 'value' });

const CP_RING = (slot, g = 'ring') => (own) => cpOf(cpRing, slot, g, own);
const CP_STACK = (panel, slot, persp) => (own) => cpOf((v, o) => cpStack(v, o, persp), slot, `${panel}.stack`, own);
const CP_CAM = (panel, slot) => (own) => cpOf(cpCamera, slot, `${panel}.cam`, own);

const cpRidgeStack = CP_STACK('ridge', 'ridgeLine', false);
const cpSurfaces = CP_STACK('room3d', 'ridgeLine', true);
const cpSurfCam = CP_CAM('room3d', 'ridgeLine');
const cpStageTerrain = CP_STACK('stage', 'stageTerrain', true);
const cpStageOrbit = (own) => cpOf(cpOrbit, 'stageWalls', 'stage.orbit', own);

const CP_SPECS = {
  // The room.
  reRing: CP_RING('ring')('size'),
  reRingDrive: CP_RING('ring')('drive'),
  reRingPoints: CP_RING('ring')('fine'),
  reRingEdge: CP_RING('ring')('stroke'),
  reSolidSpin: cpOf(cpSolid, 'polytope', 'solid', 'turn'),
  reSolidSwell: cpOf(cpSolid, 'polytope', 'solid', 'swell'),
  reSolidEye: cpOf(cpSolid, 'polytope', 'solid', 'eye'),
  reSolidSize: cpOf(cpSolid, 'polytope', 'solid', 'size'),
  reGrainDensity: cpOf(cpStreaks, 'grainWire', 'streaks', 'cloud'),
  reGrainBright: cpOf(cpStreaks, 'grainCore', 'streaks', 'burn'),
  reOpacity: cpOne(cpBlock, 'data'),

  // The room's own shape (the Shape tab).
  'roomGeomBody:FLOOR': cpOne(cpBands, 'terrainMesh'),
  'roomGeomBody:TRAIL': cpOne(cpTrail, 'terrainRidge'),
  'roomGeomBody:RIDGE': cpOne(cpRidge, 'terrainRidge'),
  'roomGeomBody:SPAN': cpOne(cpSpan, 'lead'),
  'roomGeomBody:GRAIN': cpOne(cpBell, 'grainWire'),
  'roomGeomBody:WIDTH': cpOf(cpPlan, 'grid', 'plan', 'width'),
  'roomGeomBody:REACH': cpOf(cpPlan, 'grid', 'plan', 'reach'),

  // Ridgeline: the sleeve, flat.
  'ridgeEdit:ROWS': cpRidgeStack('rows'),
  'ridgeEdit:POINTS': cpRidgeStack('points'),
  'ridgeEdit:HEIGHT': cpRidgeStack('height'),
  'ridgeEdit:SPAN': cpRidgeStack('span'),
  'ridgeEdit:WEIGHT': cpRidgeStack('weight'),
  'ridgeEdit:WINDOW': cpRidgeStack('window'),
  'ridgeEdit:SILENCE': cpRidgeStack('silence'),
  'ridgeEdit:SMOOTH': cpRidgeStack('smooth'),
  'ridgeEdit:GAIN': cpRidgeStack('gain'),

  // Surfaces: the sleeve on the room's walls, and the camera looking at it.
  'room3dEdit:DEPTH': cpSurfaces('depth'),
  'room3dEdit:ROWS': cpSurfaces('rows'),
  'room3dEdit:POINTS': cpSurfaces('points'),
  'room3dEdit:RELIEF': cpSurfaces('height'),
  'room3dEdit:SPAN': cpSurfaces('span'),
  'room3dEdit:WINDOW': cpSurfaces('window'),
  'room3dEdit:SMOOTH': cpSurfaces('smooth'),
  'room3dEdit:GAIN': cpSurfaces('gain'),
  'room3dEdit:SILENCE': cpSurfaces('silence'),
  'room3dEdit:EYE': cpSurfCam('dist'),
  'room3dEdit:LIFT': cpSurfCam('lift'),
  'room3dEdit:AIM': cpSurfCam('aim'),
  'room3dEdit:LENS': cpSurfCam('lens'),

  // The stage.
  'stageEdit:ORBIT': cpStageOrbit('orbit'),
  'stageEdit:TILT': cpStageOrbit('tilt'),
  'stageEdit:DISTANCE': cpStageOrbit('dist'),
  'stageEdit:LENS': cpStageOrbit('lens'),
  'stageEdit:RELIEF': cpStageTerrain('height'),
  'stageEdit:GAIN': cpStageTerrain('gain'),
  'stageEdit:SPAN': cpStageTerrain('span'),
  'stageEdit:WINDOW': cpStageTerrain('window'),
  'stageEdit:SMOOTH': cpStageTerrain('smooth'),
  'stageEdit:SILENCE': cpStageTerrain('silence'),
  'stageEdit:ROWS': cpStageTerrain('rows'),
  'stageEdit:POINTS': cpStageTerrain('points'),
  'stageEdit:CLOUD': cpOf(cpGrains, 'stageGrains', 'stage.grains', 'cloud'),
  'stageEdit:GRAIN SIZE': cpOf(cpGrains, 'stageGrains', 'stage.grains', 'size'),
  'stageEdit:GRAIN DRIFT': cpOf(cpGrains, 'stageGrains', 'stage.grains', 'drift'),
  'stageEdit:GRAIN GLOW': cpOf(cpGrains, 'stageGrains', 'stage.grains', 'glow'),
  'stageEdit:GRAIN CAP': cpOf(cpGrains, 'stageGrains', 'stage.grains', 'cap'),
  'stageEdit:RING': CP_RING('stageRing', 'stage.ring')('size'),
  'stageEdit:RING DRIVE': CP_RING('stageRing', 'stage.ring')('drive'),
  'stageEdit:RING HIGH': CP_RING('stageRing', 'stage.ring')('high'),
  'stageEdit:RING ROWS': CP_RING('stageRing', 'stage.ring')('rows'),
  'stageEdit:RING FINE': CP_RING('stageRing', 'stage.ring')('fine'),
  'stageEdit:SLEEVE SPAN': cpOf(cpSleeve, 'stageSleeve', 'stage.sleeve', 'span'),
  'stageEdit:SLEEVE': cpOf(cpSleeve, 'stageSleeve', 'stage.sleeve', 'stand'),
  'stageEdit:FOG': cpOf(cpAir, 'stageMist', 'stage.air', 'fog'),
  'stageEdit:MIST': cpOf(cpAir, 'stageMist', 'stage.air', 'mist'),
  'stageEdit:MIST SIZE': cpOf(cpAir, 'stageMist', 'stage.air', 'size'),
  'stageEdit:DRIFT': cpOf(cpAir, 'stageMist', 'stage.air', 'drift'),
  'stageEdit:KEY': cpOf(cpLamps, 'stageWalls', 'stage.lamps', 'key'),
  'stageEdit:KEY SIDE': cpOf(cpLamps, 'stageWalls', 'stage.lamps', 'side'),
  'stageEdit:KEY HIGH': cpOf(cpLamps, 'stageWalls', 'stage.lamps', 'high'),
  'stageEdit:KEY AT': cpOf(cpLamps, 'stageWalls', 'stage.lamps', 'at'),
  'stageEdit:FILL': cpOf(cpLamps, 'stageWalls', 'stage.lamps', 'fill'),
  'stageEdit:RIM': cpOf(cpLamps, 'stageWalls', 'stage.lamps', 'rim'),
  'stageEdit:AMBIENT': cpOf(cpLamps, 'stageWalls', 'stage.lamps', 'ambient'),
  'stageEdit:DRIVE': cpOf(cpLamps, 'stageWalls', 'stage.lamps', 'drive'),
  'stageEdit:SHADOW': cpOf(cpLamps, 'stageWalls', 'stage.lamps', 'shadow'),
  'stageEdit:WIDTH': cpOf(cpBox, 'stageWalls', 'stage.box', 'width'),
  'stageEdit:HEIGHT': cpOf(cpBox, 'stageWalls', 'stage.box', 'height'),
  'stageEdit:DEPTH': cpOf(cpBox, 'stageWalls', 'stage.box', 'depth'),
  'stageEdit:TAPER': cpOf(cpBox, 'stageWalls', 'stage.box', 'taper'),
  'stageEdit:GRID': cpOf(cpBox, 'stageWalls', 'stage.box', 'grid'),
  'stageEdit:GRID FADE': cpOf(cpBox, 'stageWalls', 'stage.box', 'fade'),
  'stageEdit:LINE GLOW': cpOne(cpGlow, 'stageTerrain'),
  'stageEdit:BLOOM': cpOf(cpBloom, 'stageTerrain', 'stage.bloom', 'spill'),
  'stageEdit:BLOOM AT': cpOf(cpBloom, 'stageTerrain', 'stage.bloom', 'at'),
  'stageEdit:EXPOSURE': cpOf(cpTone, 'stageTerrain', 'stage.tone', 'exposure'),
  'stageEdit:CONTRAST': cpOf(cpTone, 'stageTerrain', 'stage.tone', 'contrast'),
  'stageEdit:VIGNETTE': cpOne(cpVignette, 'stageWalls'),
  'stageEdit:WIRE': cpOne(cpWire, 'stageTerrain'),
  'stageEdit:DETAIL': cpOne(cpDetail, 'stageTerrain'),

  // The 4D tab's two knobs.
  'p4Panel:EYE': cpOf((v) => cpSolid({ size: 0.7, eye: v.eye, turn: 0.15, swell: 0 }, 'eye'), 'polytope', 'p4', 'eye'),
  'p4Panel:RATE': cpOne(cpRate, 'polytope'),
};

/// The panels whose rows are found by their word.
const CP_PANELS = ['roomGeomBody', 'ridgeEdit', 'room3dEdit', 'stageEdit', 'p4Panel'];

function cpKeyOf(input, label) {
  if (input.dataset.cp) return input.dataset.cp;
  if (input.id && CP_SPECS[input.id]) return input.id;
  const panel = input.closest(CP_PANELS.map((p) => `#${p}`).join(','));
  return panel ? `${panel.id}:${String(label).trim().toUpperCase()}` : null;
}

// ───────────────────────────────────────────────────────────── colouring ──

/// The colour the palette paints a slot: its flat colour, the brightest stop
/// of its ramp, or what the theme would draw it with.
function cpInk(slot) {
  if (typeof rpSlot !== 'function') return '';
  const s = rpSlot(slot);
  if (s.mode === 'flat' && s.colour) return s.colour;
  if (s.mode === 'ramp' && s.stops && s.stops.length) return s.stops[s.stops.length - 1].c;
  const pair = typeof rpInheritedPair === 'function' ? rpInheritedPair(slot) : null;
  return (pair && pair[1]) || '';
}

function cpSvg(cls, w = CP_W, h = CP_H) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('class', cls);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  return svg;
}

// ────────────────────────────────────────────────────────── live pictures ──

/// The pictures on screen: `{ input, spec, svg, key }`.
const cpLive = [];

/// The knobs whose range spans decades. Drawn by their linear position, the
/// room's width sits at four hundredths of its knob and its picture is a speck;
/// by the ratio, each doubling is the same step, which is how they are heard and
/// seen.
const CP_LOG = new Set([
  'reRingPoints', 'roomGeomBody:FLOOR', 'roomGeomBody:TRAIL', 'roomGeomBody:SPAN', 'roomGeomBody:GRAIN',
  'roomGeomBody:WIDTH', 'roomGeomBody:REACH', 'roomGeomBody:RIDGE',
  'ridgeEdit:ROWS', 'ridgeEdit:POINTS', 'ridgeEdit:HEIGHT', 'ridgeEdit:GAIN',
  'room3dEdit:ROWS', 'room3dEdit:POINTS', 'room3dEdit:GAIN', 'room3dEdit:RELIEF',
  'stageEdit:DISTANCE', 'stageEdit:GRAIN CAP', 'stageEdit:GRAIN SIZE', 'stageEdit:RING ROWS', 'stageEdit:RING FINE',
  'stageEdit:ROWS', 'stageEdit:POINTS', 'stageEdit:GAIN', 'stageEdit:RELIEF', 'stageEdit:RING', 'stageEdit:MIST SIZE',
]);

/// A knob's position, nought to one.
function cpPos(input, key) {
  const get = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').get;
  const min = +input.min, max = +input.max, v = +get.call(input);
  if (!(max > min)) return 0;
  if (CP_LOG.has(key) && min > 0) return cpClamp(Math.log(Math.max(v, min) / min) / Math.log(max / min));
  return cpClamp((v - min) / (max - min));
}

function cpDraw(entry) {
  const { spec, svg, input } = entry;
  const vals = {};
  if (spec.group) {
    for (const e of cpLive) if (e.spec.group === spec.group && e.input.isConnected) vals[e.spec.own] = cpPos(e.input, e.key);
  }
  const t = cpPos(input, entry.key);
  vals[spec.own] = t;
  svg.innerHTML = spec.draw(vals, spec.own, t);
  const ink = cpInk(spec.slot);
  if (ink) svg.style.setProperty('--cp', ink);
  else svg.style.removeProperty('--cp');
}

/// The picture above a knob, if it has one. Called from `rkKnob` once the
/// knob is built; returns the function its face calls on every value.
function cpKnob(input, label, wrap) {
  const key = cpKeyOf(input, label);
  const spec = key && CP_SPECS[key];
  if (!spec) return null;
  const svg = cpSvg('pic');
  wrap.prepend(svg);
  const entry = { input, spec, svg, key };
  // A panel rebuilt drops its old inputs; their entries go with them.
  for (let i = cpLive.length - 1; i >= 0; i--) if (!cpLive[i].input.isConnected) cpLive.splice(i, 1);
  cpLive.push(entry);
  return () => {
    cpDraw(entry);
    // Its neighbours draw the same object.
    if (spec.group) for (const e of cpLive) if (e !== entry && e.spec.group === spec.group) cpDraw(e);
  };
}

/// Every picture again: the palette changed, so the colours did.
function cpRepaint() {
  for (const e of cpLive) cpDraw(e);
  for (const svg of document.querySelectorAll('svg.pic-where[data-slot]')) {
    const ink = cpInk(svg.dataset.slot);
    if (ink) svg.style.setProperty('--cp', ink);
  }
}

// ──────────────────────────────────────────────── where in the room it is ──

/// A small room with one part of it lit: where a colour slot lands, or what a
/// layer is. Every part the palette or the layer list names is in the scene;
/// the one asked for is drawn in its colour and the rest stay dim.
function cpWhereSvg(part) {
  const lit = (p) => (p === part ? 'lit' : 'dim');
  // The flat stack and the stage are pictures of their own.
  if (part.startsWith('ridge')) {
    let s = part === 'ridgeBackground' ? '<rect x="1" y="1" width="62" height="38" class="lit fill"/>' : '<rect x="1" y="1" width="62" height="38" class="dim"/>';
    for (let k = 0; k < 4; k++) {
      const y = 12 + k * 7, pts = [];
      for (let i = 0; i <= 16; i++) { const u = i / 16; pts.push([8 + u * 48, y - Math.exp(-(((u - 0.5) / 0.18) ** 2)) * (4 + 4 * cpRnd(i + k * 5, 2))]); }
      s += cpP(`${cpPts(pts)}L56 ${y + 1}L8 ${y + 1}Z`, part === 'ridgeFill' ? 'lit fill' : 'bg');
      s += cpP(cpPts(pts), part === 'ridgeLine' ? 'lit' : 'dim');
    }
    return s;
  }
  let s = '';
  s += `<rect x="1" y="1" width="62" height="38" class="${part === 'background' || part === 'stageGround' ? 'lit fill' : 'dim'}"/>`;
  // The walls: the back wall and the room's edges running to it.
  const walls = part === 'stageWalls' ? 'lit' : 'dim';
  s += cpP('M22 8H42V22H22Z', walls) + cpP('M2 2L22 8M62 2L42 8', walls);
  // The ground: a grid running to the back wall.
  const g = lit('grid');
  s += cpP('M2 38L22 22M62 38L42 22M14 38L27 22M50 38L37 22M32 38V22', g);
  s += cpP('M12 30H52M5 35.5H59', g);
  // The terrain over it, and the edge band at the front.
  const ter = [];
  for (let i = 0; i <= 16; i++) { const u = i / 16; ter.push([6 + u * 52, 31 - Math.abs(Math.sin(u * 7)) * 5]); }
  s += cpP(`${cpPts(ter)}L58 36L6 36Z`, part === 'terrainMesh' || part === 'stageTerrain' ? 'lit fill' : 'none');
  s += cpP(cpPts(ter), lit('terrainRidge') === 'lit' || part === 'stageTerrain' ? 'lit' : 'dim');
  s += cpP('M4 37.5C16 34 22 39 32 36S50 34 60 37.5', part === 'lead' ? 'lit thick' : 'dim');
  // The sleeve on the side walls, the stage's.
  s += cpP('M6 12L18 14M6 17L18 18M6 22L18 22M58 12L46 14M58 17L46 18M58 22L46 22', part === 'stageSleeve' ? 'lit' : 'none');
  // The ring in the sky, its skin, and the solid inside it.
  s += `<ellipse cx="32" cy="12" rx="7" ry="5" class="${part === 'skin' ? 'lit fill' : 'none'}"/>`;
  s += `<ellipse cx="32" cy="12" rx="7" ry="5" class="${part === 'ring' || part === 'stageRing' ? 'lit' : 'dim'}"/>`;
  s += cpP('M29.5 9.5H34.5V14.5H29.5ZM31 11H33V13H31ZM29.5 9.5L31 11M34.5 9.5L33 11M34.5 14.5L33 13M29.5 14.5L31 13', part === 'polytope' ? 'lit' : 'none');
  // The grains, with their bloom, wires, cores and fill; the mist off them.
  const grains = [[13, 20], [48, 18], [20, 26], [44, 27]];
  for (const [x, y] of grains) {
    if (part === 'grainBloom') s += cpC(x, y, 3.6, 'lit fill', 'opacity="0.45"');
    if (part === 'mist' || part === 'stageMist') s += cpP(`M${x} ${y + 3}v1.5M${x - 1} ${y + 6}v1.2M${x + 1} ${y + 8.5}v1`, 'lit');
    const wire = part === 'grainWire' || part === 'stageGrains' ? 'lit' : 'dim';
    s += cpP(`M${x} ${y - 2}L${x + 2} ${y}L${x} ${y + 2}L${x - 2} ${y}Z`, part === 'grainFill' ? 'lit fill' : wire);
    if (part === 'grainCore') s += cpC(x, y, 0.9, 'lit fill');
  }
  // The fog, at the back of the room.
  if (part === 'fog') s += '<rect x="18" y="6" width="28" height="18" class="lit fill" opacity="0.35"/>';
  // The data block and the stage's type, on the back wall.
  s += cpP('M24 11H33M24 14H38M24 17H30', part === 'data' || part === 'stageType' ? 'lit' : 'none');
  return s;
}

function cpWhere(part, slot = part) {
  const svg = cpSvg('pic-where', 64, 40);
  svg.dataset.part = part;
  svg.dataset.slot = slot;
  svg.innerHTML = cpWhereSvg(part);
  const ink = cpInk(slot);
  if (ink) svg.style.setProperty('--cp', ink);
  return svg;
}

/// The room's layers, by the slot each is painted with. The ring layer is
/// `sky` in the room's own words.
const CP_LAYER_PART = {
  grid: 'grid', floor: 'terrainRidge', lead: 'lead', sky: 'ring', skin: 'skin',
  grains: 'grainWire', solid: 'polytope', data: 'data',
};

function cpLayer(button, key) {
  const part = CP_LAYER_PART[key];
  if (!part || button.querySelector('svg.pic-where')) return;
  button.prepend(cpWhere(part));
}

// ─────────────────────────────────────────────────── the palette's makers ──

/// The palette a generator makes, as a strip: what it would paint the room
/// with, at one hue so the strip is the same each time the panel is drawn.
function cpGenStrip(kind) {
  const strip = document.createElement('span');
  strip.className = 'pic-strip';
  strip.setAttribute('aria-hidden', 'true');
  if (typeof rpGenerate !== 'function') return strip;
  const scheme = rpGenerate(kind, 205);
  const slots = scheme.slots || {};
  const top = (s) => (s.mode === 'flat' ? s.colour : s.stops ? s.stops[s.stops.length - 1].c : null);
  const here = (typeof rpSlots === 'function' ? rpSlots() : []).map((s) => s.key);
  // The ground first, then what stands on it, then the cloud — six marks.
  const keys = ['background', ...here.filter((k) => k !== 'background' && k !== 'stageGround' && slots[k])];
  const picked = keys.length > 6 ? [keys[0], ...[1, 2, 3, 4, 5].map((i) => keys[Math.round(i * (keys.length - 1) / 5)])] : keys;
  for (const k of picked) {
    const c = slots[k] ? top(slots[k]) : null;
    if (!c) continue;
    const sw = document.createElement('i');
    sw.className = 'pic-swatch';
    sw.style.background = c;
    strip.appendChild(sw);
  }
  return strip;
}

// ──────────────────────────────────────────────────────────────── 4D tab ──

/// A solid as a thumbnail: every edge, projected at a slight turn so a cube
/// inside a cube reads as one.
function cpSolidThumb(key) {
  const svg = cpSvg('pic pic-solid', 40, 30);
  if (typeof Shapes4D === 'undefined') return svg;
  const shape = Shapes4D.shape(key);
  if (!shape) return svg;
  const angles = { xy: 0.3, xz: 0.5, yz: 0.25, xw: 0.4, yw: 0.2, zw: 0.35 };
  const flat = Shapes4D.project(Shapes4D.rotate(shape.verts, angles), { eye: 3, mode: 'perspective' });
  let r = 0;
  for (const v of flat) r = Math.max(r, Math.hypot(v[0], v[1]));
  const k = 13 / (r || 1);
  let s = '';
  for (const [i, j] of shape.edges) s += cpL(20 + flat[i][0] * k, 15 - flat[i][1] * k, 20 + flat[j][0] * k, 15 - flat[j][1] * k, 'a');
  svg.innerHTML = s;
  const ink = cpInk('polytope');
  if (ink) svg.style.setProperty('--cp', ink);
  return svg;
}

/// One plane's angle as a dial: the plane's two axes, and an arc round from
/// the first to where it has been turned. A plane that reaches into w has its
/// second axis dashed — it is not one you can point at.
function cpDialSvg(angle, intoW) {
  const a = ((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  const cx = 12, cy = 12, r = 9;
  let s = cpL(cx, cy, cx + r + 1, cy, 'f') + cpL(cx, cy, cx, cy - r - 1, 'f', intoW ? 'stroke-dasharray="1.5 1.5"' : '');
  if (a > 0.01) {
    const x = cx + r * Math.cos(-a), y = cy + r * Math.sin(-a);
    s += cpP(`M${cx + r} ${cy}A${r} ${r} 0 ${a > Math.PI ? 1 : 0} 0 ${cpN(x)} ${cpN(y)}`, 'a');
  }
  s += cpL(cx, cy, cx + r * Math.cos(-a), cy + r * Math.sin(-a), 'a');
  return s;
}

function cpDial(field, angle, intoW) {
  let svg = field.querySelector(':scope > svg.pic-dial');
  if (!svg) {
    svg = cpSvg('pic-dial', 24, 24);
    field.prepend(svg);
  }
  svg.innerHTML = cpDialSvg(angle, intoW);
}

/// Perspective and parallel, drawn: a cube inside a smaller cube, or two the
/// same size side by side.
function cpProjection(mode) {
  const svg = cpSvg('pic pic-proj', 40, 24);
  svg.innerHTML = mode === 'perspective'
    ? cpP('M8 3H32V21H8Z', 'a') + cpP('M15 8H25V16H15Z', 'a') + cpP('M8 3L15 8M32 3L25 8M32 21L25 16M8 21L15 16', 'f')
    : cpP('M5 6H23V20H5Z', 'a') + cpP('M17 3H35V17H17Z', 'a') + cpP('M5 6L17 3M23 6L35 3M23 20L35 17M5 20L17 17', 'f');
  return svg;
}

/// The 4D panel, after it is built: a thumbnail on every solid, a dial on
/// every plane, a picture on each projection.
function cpPaint4d() {
  const host = document.getElementById('p4Panel');
  if (!host || typeof Shapes4D === 'undefined') return;
  const rows = host.querySelectorAll('.p4-obj');
  Shapes4D.CATALOGUE.forEach((e, i) => {
    const row = rows[i];
    if (row && !row.querySelector('svg.pic-solid')) row.prepend(cpSolidThumb(e.key));
  });
  cpDials4d();
  const proj = host.querySelectorAll('[data-p4seg="projection"] .re-btn');
  ['perspective', 'orthographic'].forEach((m, i) => {
    if (proj[i] && !proj[i].querySelector('svg.pic')) proj[i].prepend(cpProjection(m));
  });
}

function cpDials4d() {
  const host = document.getElementById('p4Panel');
  if (!host || typeof Shapes4D === 'undefined' || typeof p4 === 'undefined') return;
  for (const p of Shapes4D.PLANES) {
    const field = host.querySelector(`.p4-num-in[data-p4="${p.label}"]`)?.closest('.p4-num');
    if (field) cpDial(field, p4.angles[p.key], !p.familiar);
  }
}

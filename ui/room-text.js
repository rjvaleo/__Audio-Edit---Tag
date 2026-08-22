// A card of type, in front of everything.
//
// See `docs/ROOM-TEXT.md`. A box filled with the background colour, with
// extruded letters standing on it. Because the box is the *background* rather
// than a panel over it, it does not sit on top of the picture so much as take a
// bite out of it — the lines behind simply stop, the way the type on the sleeve
// does. Anything else and it reads as a caption stuck to the glass.
//
// **One routine draws it, and both the room and the film call that routine.**
// The data block next door is drawn twice, as DOM on screen and on canvas in the
// export, and keeping those two agreeing has cost this program real money. This
// one is drawn on a canvas either way, so what is on screen is what is filmed by
// construction rather than by vigilance.

/// Everything about the card, and its starting state.
///
/// The box is in **fractions of the frame** and the type in fractions of the
/// frame's height, so a card placed in a window is in the same place, at the
/// same size, when it is filmed at 4K. Pixels here would mean a card that
/// wanders and shrinks the moment the shape changes, which is exactly what the
/// room's own geometry had to be rescued from.
const RT_DEFAULTS = {
  on: false,
  text: 'UNKNOWN\nPLEASURES',
  /// The centre of the card, and its size. Fractions of the frame.
  x: 0.5,
  y: 0.5,
  w: 0.5,
  h: 0.26,
  /// Cap height as a share of the frame's height.
  size: 0.085,
  /// How far the letters stand off the card, as a share of their own size. At
  /// nought they are flat, which is a legitimate thing to want.
  depth: 0.32,
  /// Which way they lean, in degrees, measured the way a screen measures them:
  /// nought is to the right, ninety is down.
  angle: 135,
  /// Between the lines, as a share of the size.
  lead: 1.15,
  /// Between the letters, as a share of the size.
  track: 0.04,
  /// Inside the card's edge, as a share of the size.
  pad: 0.55,
  align: 'center',
  weight: 700,
  /// `solid` or `wire`. Solid letters are filled and their sides are a solid
  /// mass; wireframe ones are drawn as outlines all the way through, so the
  /// picture behind shows between the rungs and the letters read as built
  /// rather than as printed.
  style: 'solid',
  /// How many outlines are drawn between the face and the back, in wireframe.
  /// These are the rungs of the extrusion — the depth contours — and how far
  /// apart they are is the whole look of it.
  rungs: 9,
  /// The stroke, as a fraction of the frame's height, so it is the same weight
  /// filmed at 1080 and at 4K. Floored at a device pixel where it is drawn: a
  /// canvas cannot draw a line thinner than that, only fainter, which reads as
  /// brightness rather than as weight and shimmers. See `docs/RIDGELINE.md`,
  /// which learned this the expensive way.
  wire: 0.0016,
  /// Nought turns the card off and leaves the letters standing on the picture.
  card: 1,
};

/// The face of the letters, their sides, and the card. Two are colours; the
/// third is normally the background, which is the whole point of it.
const RT_SLOTS = [
  { key: 'textFace', label: 'Type', row: -1, own: null, css: true, flat: true,
    hint: 'The front of the letters.' },
  { key: 'textSide', label: 'Type edge', row: -1, own: null, css: true, flat: true,
    hint: 'The sides of the letters, where they stand off the card. It fades into the card with depth, so this is the near edge rather than a flat colour.' },
  { key: 'textCard', label: 'Card', row: -1, own: null, css: true, flat: true,
    hint: 'The card the letters stand on. Normally the background: that is what makes the picture stop at its edge instead of running behind it.' },
];

/// The controls, in the order they are shown.
const RT_UI = [
  { key: 'size', tag: 'SIZE', min: 0.02, max: 0.3, step: 0.005,
    hint: 'Cap height, as a share of the frame height — so it is the same size filmed at 1080 and at 4K.' },
  { key: 'depth', tag: 'DEPTH', min: 0, max: 1.5, step: 0.01,
    hint: 'How far the letters stand off the card, as a share of their own size. Nought is flat type.' },
  { key: 'angle', tag: 'LEAN', min: 0, max: 360, step: 1, round: true,
    hint: 'Which way they stand off, in degrees. Nought is to the right and ninety is down, the way a screen measures.' },
  { key: 'lead', tag: 'LEAD', min: 0.7, max: 2, step: 0.01,
    hint: 'Between the lines, as a share of the size.' },
  { key: 'track', tag: 'TRACK', min: -0.05, max: 0.4, step: 0.005,
    hint: 'Between the letters, as a share of the size.' },
  { key: 'pad', tag: 'PAD', min: 0, max: 2, step: 0.05,
    hint: 'Inside the card’s edge, as a share of the size.' },
  { key: 'rungs', tag: 'RUNGS', min: 2, max: 48, step: 1, round: true, wire: true,
    hint: 'How many outlines are drawn between the face of the letters and their back. These are the depth contours; two is a front and a back with nothing between them, and a lot of them closes back up into something near solid. Wireframe only.' },
  { key: 'wire', tag: 'STROKE', min: 0.0006, max: 0.006, step: 0.0001, wire: true,
    hint: 'How thick the outlines are, as a share of the frame height — so they look the same filmed at 1080 and at 4K. It will not go below one pixel: under that a canvas draws a fainter line rather than a thinner one. Wireframe only.' },
  { key: 'card', tag: 'CARD', min: 0, max: 1, step: 0.01,
    hint: 'How solid the card is. At nought there is no card and the letters stand on the picture itself.' },
];

/// Merge what is stored over the defaults, and keep the card inside the frame.
///
/// Anything absent is a default, so a card saved before a control existed still
/// opens with that control at its default rather than at `undefined`.
///
/// **And the box is clamped here, on the way out, not on the way in.** A card
/// dragged bigger than the frame is filled with the background colour across the
/// whole of it — which does not look like an oversized card, it looks like an
/// empty window, because the ground is exactly what an empty window is. There is
/// nothing on screen to tell you what happened and nothing to grab to undo it,
/// and it is written to storage, so it survives a reload and the room is simply
/// black for ever.
///
/// Clamping on read rather than on write is what makes that recoverable: a card
/// already saved in that state comes back inside the frame the next time it is
/// looked at, without anyone having to find and clear the storage.
function rtSettings(stored) {
  const st = { ...RT_DEFAULTS, ...(stored || {}) };
  const num = (v, lo, hi, dflt) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dflt;
  };
  // Never so small it cannot be grabbed again, and never quite the whole frame.
  //
  // **The ceiling is short of one on purpose.** Clamped to exactly the frame the
  // card still fills the window edge to edge with the ground, which is the same
  // black rectangle and just as unreadable — the clamp stops the runaway but
  // leaves the symptom. A margin means there is always some picture round the
  // outside, so a card that has been dragged too far still looks like a card
  // that has been dragged too far.
  st.w = num(st.w, 0.03, 0.95, RT_DEFAULTS.w);
  st.h = num(st.h, 0.03, 0.95, RT_DEFAULTS.h);
  // The centre stays inside the frame, so some of the card is always on screen
  // with its grips reachable however far it was flung.
  st.x = num(st.x, 0, 1, RT_DEFAULTS.x);
  st.y = num(st.y, 0, 1, RT_DEFAULTS.y);
  return st;
}

/// The card's box in pixels, from its fractions.
function rtBox(st, W, H) {
  const w = Math.max(8, st.w * W);
  const h = Math.max(8, st.h * H);
  return { x: st.x * W - w / 2, y: st.y * H - h / 2, w, h };
}

/// `#rrggbb` to three numbers. Anything it cannot read comes back black, which
/// is visible and wrong rather than invisible and wrong.
function rtRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return [0, 0, 0];
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/// Between two colours, for the sides of the letters.
function rtMix(a, b, t) {
  const x = rtRgb(a), y = rtRgb(b);
  const k = Math.max(0, Math.min(1, t));
  return `rgb(${Math.round(x[0] + (y[0] - x[0]) * k)},${
    Math.round(x[1] + (y[1] - x[1]) * k)},${
    Math.round(x[2] + (y[2] - x[2]) * k)})`;
}

/// The stack, which has to be one a machine actually has. A card that falls back
/// to a different face in the film than on screen is the same fault as drawing
/// it twice, arrived at from the other direction.
const RT_FONT = `"Helvetica Neue", Helvetica, Arial, "Liberation Sans", sans-serif`;

/// Draw the card.
///
/// `paint` is `{ face, side, card }`, already resolved — this does not go
/// looking at the palette, because the film has no page to read a palette from.
function rtDraw(ctx, W, H, state, paint) {
  const st = rtSettings(state);
  if (!st.on) return;
  const box = rtBox(st, W, H);
  const size = Math.max(4, st.size * H);
  const face = (paint && paint.face) || '#ffffff';
  const side = (paint && paint.side) || '#808080';
  const card = (paint && paint.card) || '#000000';

  ctx.save();

  // ── the bite out of the picture ──
  if (st.card > 0) {
    ctx.globalAlpha = st.card;
    ctx.fillStyle = card;
    ctx.fillRect(box.x, box.y, box.w, box.h);
    ctx.globalAlpha = 1;
  }

  // Type stays inside its card. Without this a size wound past what the box
  // holds spills over the picture and the card stops meaning anything.
  ctx.beginPath();
  ctx.rect(box.x, box.y, box.w, box.h);
  ctx.clip();

  const lines = String(st.text ?? '').split('\n');
  ctx.font = `${st.weight} ${size}px ${RT_FONT}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = st.align;
  // Not everywhere, and not worth a polyfill: without it the letters are merely
  // set solid, which is a normal way for letters to be.
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${st.track * size}px`;

  const pad = st.pad * size;
  const step = st.lead * size;
  const anchorX = st.align === 'left' ? box.x + pad
    : st.align === 'right' ? box.x + box.w - pad
      : box.x + box.w / 2;
  // Centred as a block, so adding a line grows it about the middle rather than
  // pushing it downwards off the card.
  const first = box.y + box.h / 2 - (lines.length - 1) * step / 2;

  // ── standing off the card ──
  //
  // **Back to front, one copy a pixel.** The letters are drawn repeatedly along
  // the lean and then the face is drawn on top, so the gaps between the copies
  // close into a solid side. Stepping by anything coarser than a pixel leaves it
  // striped, which at a distance reads as a bad screen rather than as depth.
  //
  // Each copy is mixed further towards the card as it recedes, so the sides fall
  // away into it instead of ending on a hard edge in mid-air.
  const rad = st.angle * Math.PI / 180;
  const dep = st.depth * size;
  const dx = Math.cos(rad), dy = Math.sin(rad);
  const wire = st.style === 'wire';

  if (wire) {
    // ── the letters as a frame ──
    //
    // **Outlines all the way through, not a filled mass.** The rungs are the
    // depth contours: the same glyph drawn at intervals between the face and the
    // back, so what stands off the card is a cage with the picture showing
    // between its bars. Filled sides would hide it, which is the one thing this
    // mode exists not to do.
    //
    // Back to front so the face's outline is the one drawn last and unbroken.
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    // A device pixel is the floor. Under it a canvas cannot draw a thinner line
    // and draws a fainter one instead, so the control would read as brightness.
    ctx.lineWidth = Math.max(1, st.wire * H);
    const rungs = Math.max(2, Math.min(64, Math.round(st.rungs)));
    if (dep >= 0.5) {
      for (let i = rungs - 1; i >= 1; i--) {
        const t = i / (rungs - 1);
        ctx.strokeStyle = rtMix(side, card, t * 0.7);
        const ox = dx * dep * t, oy = dy * dep * t;
        for (let l = 0; l < lines.length; l++) {
          ctx.strokeText(lines[l], anchorX + ox, first + l * step + oy);
        }
      }
    }
    ctx.strokeStyle = face;
    for (let l = 0; l < lines.length; l++) {
      ctx.strokeText(lines[l], anchorX, first + l * step);
    }
    ctx.restore();
    return;
  }

  if (dep >= 0.5) {
    const steps = Math.max(1, Math.min(400, Math.round(dep)));
    for (let i = steps; i >= 1; i--) {
      const t = i / steps;
      ctx.fillStyle = rtMix(side, card, t * 0.85);
      const ox = dx * dep * t, oy = dy * dep * t;
      for (let l = 0; l < lines.length; l++) {
        ctx.fillText(lines[l], anchorX + ox, first + l * step + oy);
      }
    }
  }

  ctx.fillStyle = face;
  for (let l = 0; l < lines.length; l++) {
    ctx.fillText(lines[l], anchorX, first + l * step);
  }

  ctx.restore();
}

/// The eight grips and the body, for hit testing and for drawing.
const RT_GRIPS = [
  ['nw', 0, 0], ['n', 0.5, 0], ['ne', 1, 0],
  ['w', 0, 0.5], ['e', 1, 0.5],
  ['sw', 0, 1], ['s', 0.5, 1], ['se', 1, 1],
];

function rtGrips(st, W, H) {
  const b = rtBox(st, W, H);
  return RT_GRIPS.map(([key, fx, fy]) => ({
    key, x: b.x + b.w * fx, y: b.y + b.h * fy,
  }));
}

/// What is under the pointer: a grip, the body, or nothing.
function rtHit(st, W, H, px, py, reach = 10) {
  if (!st || !st.on) return null;
  for (const g of rtGrips(st, W, H)) {
    if (Math.abs(px - g.x) <= reach && Math.abs(py - g.y) <= reach) return g.key;
  }
  const b = rtBox(st, W, H);
  if (px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h) return 'move';
  return null;
}

/// The cursor for each grip, so the edge says what it does before it is dragged.
const RT_CURSOR = {
  nw: 'nwse-resize', se: 'nwse-resize',
  ne: 'nesw-resize', sw: 'nesw-resize',
  n: 'ns-resize', s: 'ns-resize',
  w: 'ew-resize', e: 'ew-resize',
  move: 'move',
};

/// Move or resize, and hand back the new fractions.
///
/// **The opposite edge stays put.** Dragging the west edge moves the west edge;
/// the card does not slide sideways while it grows, which is what happens if the
/// centre is held instead — the room's own geometry had this fault and it made
/// the handles feel greasy.
function rtDrag(st, W, H, grip, dxPx, dyPx) {
  const b = rtBox(st, W, H);
  let { x, y, w, h } = b;
  const dx = dxPx, dy = dyPx;
  // **Matched, not searched.** These were `grip.includes('e')` and friends,
  // which reads well and is wrong: `'move'` contains an `e`, so dragging the
  // card by its middle also stretched it eastwards. A grip is one of nine known
  // things and is compared as one.
  if (grip === 'move') {
    x += dx;
    y += dy;
  } else {
    const west = grip === 'w' || grip === 'nw' || grip === 'sw';
    const east = grip === 'e' || grip === 'ne' || grip === 'se';
    const north = grip === 'n' || grip === 'nw' || grip === 'ne';
    const south = grip === 's' || grip === 'sw' || grip === 'se';
    if (west) { x += dx; w -= dx; }
    if (east) { w += dx; }
    if (north) { y += dy; h -= dy; }
    if (south) { h += dy; }
  }
  // Never inside out, and never smaller than something that can be grabbed
  // again once it is let go of.
  const min = 24;
  if (w < min) { if (grip === 'w' || grip === 'nw' || grip === 'sw') x = b.x + b.w - min; w = min; }
  if (h < min) { if (grip === 'n' || grip === 'nw' || grip === 'ne') y = b.y + b.h - min; h = min; }
  return {
    x: (x + w / 2) / W,
    y: (y + h / 2) / H,
    w: w / W,
    h: h / H,
  };
}

/// The grips themselves, drawn only while the card is being edited.
function rtPaintGrips(ctx, st, W, H, hot) {
  const b = rtBox(st, W, H);
  ctx.save();
  ctx.setLineDash([4, 4]);
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(127,208,255,0.9)';
  ctx.strokeRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1);
  ctx.setLineDash([]);
  for (const g of rtGrips(st, W, H)) {
    ctx.fillStyle = g.key === hot ? '#7fd0ff' : '#0b0e12';
    ctx.strokeStyle = '#7fd0ff';
    ctx.beginPath();
    ctx.rect(g.x - 4, g.y - 4, 8, 8);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

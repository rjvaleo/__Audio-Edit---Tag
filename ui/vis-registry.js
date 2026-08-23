// Every visualiser, in one list.
//
// See `docs/PORT-PLAN.md`. Fourteen of them across three engines and two
// documents, and until this file there was no single place that knew they all
// existed — the three on the master bus were a list in `app.js`, the ten grain
// views were a list inside an iframe, and the eleventh was a branch in a
// function. Which meant "show me everything I can look at" was a question the
// program could not answer.
//
// **This is a description, not a renderer.** Nothing here draws. Each entry says
// what a visual is, where it lives, what engine it needs, whether it can be
// filmed, and where its controls come from — and the Room's admin column is
// built from that rather than from a panel written by hand for each one. Adding
// a visual should be adding an entry.
//
// The `engine` field is the honest state of the port, not an aspiration: it says
// what actually draws that visual today. When a phase of `docs/PORT-PLAN.md`
// lands, the entry changes with it, and the count of what is still on the old
// engines is `visPortRemaining()`.

/// The two families, which differ in what they are looking at.
///
/// The bus visuals watch the master output — one stream of spectrum and
/// lissajous, whatever is playing. The grain visuals watch the *schedule*: every
/// grain the engine is about to sound, with its position, pitch and length. They
/// are fed differently and always have been, which is why they grew up in two
/// places.
const VIS_FAMILIES = [
  { key: 'bus', label: 'Master bus', host: 'masterBus',
    hint: 'What left the speakers. One stream of sound, drawn as a room, a stack, or a set of walls.' },
  { key: 'grain', label: 'Grains', host: 'grainVis',
    hint: 'The schedule itself — every grain about to sound, with where it reads from, how long it lasts, and what pitch it is at.' },
];

/// Every visual there is.
///
/// `engine` is one of `babylon`, `webgl1`, `canvas2d`, `p5`. `films` says whether
/// the export can render it — today only the bus visuals can, which is one of the
/// things the port is for.
const VIS_ALL = [
  // ── the master bus ──
  {
    key: 'room', family: 'bus', label: 'Room', engine: 'webgl1',
    canvas: 'visGl', panel: 'roomEdit', films: true,
    hint: 'The master bus as a room in perspective. Depth is time.',
  },
  {
    key: 'ridge', family: 'bus', label: 'Ridgeline', engine: 'canvas2d',
    canvas: 'visRidge', panel: 'ridgeEdit', films: true,
    hint: 'Stacked lines, each hiding what is behind it. The waveform of the moment, pulled to the middle.',
  },
  {
    key: 'room3d', family: 'bus', label: 'Surfaces', engine: 'babylon',
    canvas: 'visRoom3d', panel: 'room3dEdit', films: true,
    hint: 'The stacked lines on all five surfaces of a room — floor, ceiling, both walls, and the sleeve itself on the back wall.',
  },

  {
    key: 'stage', family: 'bus', label: 'Stage', engine: 'babylon',
    canvas: 'visStage', panel: 'stageEdit', films: true,
    hint: 'One room with real light, real air and real particles — the room everything else is being rebuilt into.',
  },

  // ── the grains ──
  //
  // The first is drawn in the page; the other ten are in `grain-views.html`,
  // which is why they carry a suite and a view number instead of a canvas. That
  // is exactly what Phase 1 of the port removes.
  {
    key: 'swarm2d', family: 'grain', label: 'Swarm 2D', engine: 'canvas2d',
    canvas: 'grainCanvas', view: 0, films: false,
    hint: 'The original swarm, drawn flat.',
  },
  ...[
    ['shear', 'Shear', 'Output time against source time — the stretch as a slope.'],
    ['braid', 'Braid', 'Time wound into a helix — strands are the overlap.'],
    ['swarm3d', 'Swarm 3D', 'The free cloud in three dimensions.'],
    ['shells', 'Shells', 'An octave to a shell — drift becomes rotation.'],
    ['lattice', 'Lattice', 'The hop grid as a crystal, melted by the jitters.'],
  ].map(([key, label, hint], i) => ({
    key: `v1-${key}`, family: 'grain', label, engine: 'p5',
    frame: 'grainFrame', suite: 1, view: i + 1, films: false, hint,
  })),
  ...[
    ['tunnel', 'Tunnel', 'Grains arrive out of the dark and pass you. Depth is how far a grain is from now.'],
    ['mandala', 'Mandala', 'Now is the centre. Distance from the middle is distance from this instant.'],
    ['rorschach', 'Rorschach', 'Reflected in both axes, so which way time runs cannot be said.'],
    ['vortex', 'Vortex', 'Grains spiral in from the future, cross the present, and unwind into the past.'],
    ['ripple', 'Ripple', 'A standing wave with its own reflection under it.'],
  ].map(([key, label, hint], i) => ({
    key: `v2-${key}`, family: 'grain', label, engine: 'p5',
    frame: 'grainFrame', suite: 2, view: i + 1, films: false, hint,
  })),
];

/// One visual by key, or null.
function visEntry(key) {
  return VIS_ALL.find((v) => v.key === key) || null;
}

/// Everything in one family, in the order it is shown.
function visFamily(key) {
  return VIS_ALL.filter((v) => v.family === key);
}

/// What is still on an old engine, for the port's own bookkeeping.
///
/// **A count, not a list of names.** The point is to be able to say how far
/// through `docs/PORT-PLAN.md` the program actually is without reading it and
/// guessing — and to have a test that fails when a phase is claimed complete and
/// is not.
function visPortRemaining() {
  const out = { babylon: 0, webgl1: 0, canvas2d: 0, p5: 0 };
  for (const v of VIS_ALL) out[v.engine] = (out[v.engine] || 0) + 1;
  return out;
}

/// Whether a visual is drawn in this page or in the iframe.
///
/// The distinction is temporary — Phase 1 ends it — but while it lasts it
/// decides almost everything about how a visual is shown and controlled, so it
/// is asked here rather than by testing `engine === 'p5'` in six places.
function visInFrame(v) {
  return !!(v && v.frame);
}

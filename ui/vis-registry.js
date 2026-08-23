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
// what actually draws that visual today. Nothing in here is a claim that one
// entry supersedes another — where two entries draw the same shape, both are
// listed and the label says which is which. When a phase of `docs/PORT-PLAN.md`
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
  // **The arrangements are their own family, and the originals keep theirs.**
  //
  // The stage can lay its cloud out ten ways, and those ten are the same shapes
  // the grain views draw. They are not replacements: they are drawn by a
  // different engine, in a different scene, from a different set of decisions,
  // and they look different. Filing them over the top of the originals would
  // have quietly retired ten pieces of work by giving their names to something
  // else — which is what listing them under the same family did, and why they
  // now sit apart with the originals untouched beside them.
  { key: 'arrangement', label: 'Stage arrangements', host: 'masterBus',
    hint: 'The ten grain views, in this engine: the same projections, drawn as additive strokes with the same folds, palettes and trails. Each carries its own look and its own editor, and unlike the originals they film.' },
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

  // ── the grains, as they have always been ──
  //
  // The flat swarm in the page, and ten views in `visualiser/grain-views.html`
  // on p5 — which is why they carry a suite and a view number instead of a
  // canvas. They are untouched and they stay.
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

  // ── the ten views, on this engine ──
  //
  // **A port now, not an arrangement.** The claim behind the first version was
  // that the only thing separating the grain views was where a grain goes, so
  // ten short functions would do. Side by side that was plainly false: the p5
  // Mandala is a dense radial weave and the arrangement was a scatter of lit
  // dots in the same positions. The picture was never only the placement — it
  // was the stroke, the accumulation and the density.
  //
  // All ten have those now. Every projection is transcribed from
  // `visualiser/grain-views.html` in the units it was written in, drawn as
  // billboarded strokes, additive on black, with the original's own folds,
  // energy tiers, colour ramps, trails and per-view looks. See `ST_LAYOUTS`.
  //
  // They keep `· stage` on the end because both are still here and a picker
  // offering two things called "Mandala" is an offer to pick one of them by
  // mistake. What this side has that the originals do not: the palette, the
  // lighting, the rest of the scene to stand in — and the export.
  ...[
    ['swarm', 'Swarm'], ['shear', 'Shear'], ['braid', 'Braid'],
    ['shells', 'Shells'], ['lattice', 'Lattice'],
    ['tunnel', 'Tunnel'], ['mandala', 'Mandala'], ['rorschach', 'Rorschach'],
    ['vortex', 'Vortex'], ['ripple', 'Ripple'],
  ].map(([layout, label]) => ({
    key: `g-${layout}`, family: 'arrangement', label: `${label} · stage`,
    engine: 'babylon',
    canvas: 'visStage', panel: 'stageEdit', films: true,
    // The stage, arranged this way. See `ST_LAYOUTS` in `ui/stage.js`.
    stage: true, layout,
    // Whether this one is the port or still the sketch of it. Read off the
    // layout itself, so the list cannot claim a view is done when it is not.
    ported: typeof ST_LAYOUTS !== 'undefined'
      && !!(ST_LAYOUTS.find((l) => l.key === layout) || {}).ported,
    hint: (typeof ST_LAYOUTS !== 'undefined'
      ? (ST_LAYOUTS.find((l) => l.key === layout) || {}).hint
      : '') || label,
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

/// Whether a visual is the stage wearing a particular arrangement.
function visIsStage(v) {
  return !!(v && (v.key === 'stage' || v.stage));
}

/// Whether a visual is drawn in this page or in the iframe.
///
/// The distinction is temporary — Phase 1 ends it — but while it lasts it
/// decides almost everything about how a visual is shown and controlled, so it
/// is asked here rather than by testing `engine === 'p5'` in six places.
function visInFrame(v) {
  return !!(v && v.frame);
}

// The stage: one room, one scene, everything in it.
//
// See `docs/PORT-PLAN.md`. This is the rebuild — not another visualiser beside
// the others but the room they are all going to end up living in, with real
// light in it, real air, and objects that can see one another.
//
// **Built beside what works, not on top of it.** Nothing in here touches
// `vis-gl.js`, `ridge.js` or `room3d.js`; it is another entry in the registry
// until it is better than they are. That is not caution for its own sake — it is
// the only way a rebuild of this size does not spend its first week with the app
// broken.
//
// ── what is different from everything before it ──
//
// Every visualiser this program has had draws **lines that emit their own
// light**: additive blending over black, no lamps, no surfaces, no air. It is a
// good look and it is the only look those renderers can do. The room is a
// wireframe because a wireframe is what you get when nothing is lit.
//
// This has lights. Which means it also has to have **materials that answer
// them**, **surfaces for light to land on**, and **air for it to travel
// through** — the three things the old room fakes. Its fog is a distance-shade
// applied per vertex; here it is the scene's own fog, so a thing far away is
// actually further away. Its mist is a sprite trick; here it is particles with
// positions and lifetimes. Its walls are four lines; here they are surfaces that
// catch the key light and fall off into the dark.

/// The room, the camera, the light, the air.
const ST_DEFAULTS = {
  // ── the room ──
  width: 4.2,
  height: 3,
  depth: 9,
  /// How far the back of the room draws in from the front. At one it is a box;
  /// under one it is a funnel, which is what gives the old room its perspective
  /// even before the camera has one.
  taper: 0.72,
  /// **Off.** It is not a room — the box was only ever a way of getting depth
  /// into a flat picture, and with real perspective and real fog the depth is
  /// already there. What is wanted is infinite space: the sound, and nothing
  /// else in the frame at all.
  ///
  /// Left on, the walls are the largest thing in shot and the eye reads them
  /// first, which is exactly backwards. They stay available because a bounded
  /// space is a different and sometimes useful picture.
  shell: false,
  /// How matte the walls are. Nothing in here is glossy on purpose — a specular
  /// highlight on a wall reads as a mistake at this scale.
  rough: 0.55,

  // ── the camera ──
  //
  // **Close, wide, and low.** With the box gone there is no mouth to frame and
  // nothing to stand back from — the picture is the sound in open space, so the
  // camera belongs *in* it rather than looking at it from outside. Standing back
  // left the stack in the middle third of the frame with black all round, which
  // is a photograph of a visualiser rather than the visualiser.
  eye: 1.15,
  /// Sideways. There is no orbit here on purpose — a scene with no walls has no
  /// centre to orbit about, and swinging the camera across the space is what you
  /// actually want when you drag sideways in open space.
  swing: 0,
  lift: 0.12,
  aim: 0.3,
  fov: 1.12,

  // ── the light ──
  //
  // Three: a key that makes the form, a fill that stops the dark going black,
  // and a rim from behind that finds the edges. It is the ordinary way to light
  // anything and it is ordinary because it works.
  ambient: 0.12,
  keyOn: true,
  key: 1.1,
  keyAt: 0.22,
  keySide: -0.35,
  keyHigh: 0.75,
  fillOn: true,
  fill: 0.22,
  rimOn: true,
  rim: 0.5,
  /// The key light answering the sound rather than sitting still. Nought is a
  /// lamp; up is the room breathing with what it is playing.
  drive: 0.55,

  // ── the air ──
  fogOn: true,
  /// Exponential-squared: thick close to, and hiding the back of the room
  /// entirely rather than shading it a bit. Linear is the honest surveyor's fog
  /// and looks like a fade; this looks like air.
  fogDensity: 0.055,

  // ── the mist ──
  //
  // Particles, with positions and lifetimes, drifting in the light. The old
  // room's mist is shed by grains and lives as long as the shape does; this is
  // the air itself having something in it.
  mistOn: true,
  /// Soloed, the mist read nothing at all: a thousand particles at four
  /// hundredths of a unit across, in a space nine units deep, is a few dozen
  /// pixels spread over the whole frame. More of them, larger, and brighter —
  /// air you can see is the point of having any.
  mist: 2600,
  mistSize: 0.11,
  mistDrift: 0.05,
  mistLife: 6,

  // ── the sound ──
  terrainOn: true,
  /// **Fine.** A stack of sixty rows at a hundred and forty samples is a sketch;
  /// the line quality is most of what this looks like, and a render at 4K will
  /// show every place it was not enough. The preview carries the same numbers —
  /// it is one scene, and a preview that is not the picture is not a preview.
  rows: 120,
  points: 320,
  relief: 0.42,
  span: 1,
  window: 0.6,
  smooth: 2,
  gain: 1,
  floorLevel: 0.004,

  // ── the cloud ──
  //
  // Every grain the engine is about to sound, as a small solid in the room.
  // This is the thing that makes this program what it is, and on the old
  // renderer it is a wireframe shape lit by nothing. Here it is a solid the key
  // light lands on, standing in fog, with the ones nearby bright and the ones at
  // the back nearly gone.
  cloudOn: true,
  cloudCap: 2200,
  cloudSize: 0.05,
  cloudDrift: 0.1,
  /// How many of the schedule's grains are drawn, as a share. A cloud you can
  /// see through is worth more than one you cannot.
  cloudDensity: 0.55,
  /// Which of the ten arrangements the cloud is in. See `ST_LAYOUTS`.
  cloudLayout: 'swarm',
  /// **Their own light, because the lamps are dim now.** The grains are solids
  /// and were lit by the key; once the lamps came down to modelling strength
  /// they went with them — soloed, the brightest grain in the room read 63 of
  /// 255, which is a shape you can just about find rather than a thing you can
  /// see.
  cloudGlow: 0.62,
  cloudColour: '#ffd9a0',

  // ── the ring ──
  //
  // The Lissajous, hung in the room with depth as time — every frame's figure
  // kept and the run of them joined into a tube. On the old renderer it is a
  // stack of wire hoops; here it is a surface, so the light runs along it and
  // the shape of the sound is something you read off the highlight rather than
  // off a tangle of lines.
  ringOn: true,
  /// **Not too many.** Concentric hoops converging on a vanishing point is the
  /// portal, and past about a hundred of them the ones near the centre are
  /// closer together than a pixel and beat against each other — a moiré rosette
  /// where the far end should be.
  ringRows: 96,
  ringPoints: 256,
  /// **Narrow, and hung high.** The tube runs away from the camera, so seen down
  /// its own axis a wide one is a disc filling the room rather than a tube going
  /// anywhere. Small enough to read as a bore, and lifted clear of the terrain
  /// so both can be seen at once.
  ringSize: 0.62,
  ringAt: 0.42,
  ringHigh: 0.34,
  /// How hard the sound pushes it out of round.
  ringDrive: 1,

  // ── the sleeve ──
  //
  // The stacked lines on the room's own surfaces — the Unknown Pleasures
  // arrangement, in the same scene as everything else rather than in a module of
  // its own. Lit, which is the difference: `room3d.js` draws them as ribbons that
  // emit their own colour, and here a ridge has a bright side and a shadow side
  // and the ones at the back go into the fog.
  //
  // The floor is left to the terrain by default. Both on the same surface is two
  // pictures of the same sound fighting for the same plane.
  /// **Minimal to start with.** All five faces at this resolution is a tunnel of
  /// lines dense enough to moiré, and the eye has nowhere to rest. The back wall
  /// alone is the sleeve itself; the terrain has the floor; and the other three
  /// are there for when a picture wants them rather than by default.
  sleeveOn: true,
  sleeveFloor: false,
  sleeveCeiling: false,
  sleeveLeft: false,
  sleeveRight: false,
  sleeveBack: true,
  sleeveRelief: 0.3,
  sleeveSpan: 0.86,
  sleeveColour: '#dfe9f2',

  // ── the type ──
  //
  // Words standing in the space, as geometry. The card next door is a flat
  // canvas laid over the picture: it takes no perspective, nothing passes in
  // front of it, and it keeps whatever was last drawn on it when a module that
  // does not repaint it takes the stage. All three are the same fault and all
  // three stop existing once the letters are things in the scene.
  //
  // No card behind them. Flat, the card is the whole idea — filled with the
  // ground it takes a bite out of the picture and the lines stop at its edge.
  // Standing in open space it is a wall hung in front of everything, and in the
  // background colour that is indistinguishable from the picture going out.
  typeOn: false,
  typeSize: 0.5,
  typeDepth: 0.35,
  typeLean: 135,
  typeAt: 0.32,
  typeHigh: 0,
  typeSwing: 0,
  typeColour: '#ffffff',

  /// **One thing at a time.** With nine objects in the scene, judging any one of
  /// them means judging it through the other eight — and every balance decision
  /// made that way is really a decision about the pile. Soloed, an object is
  /// tuned on its own and then let back in.
  ///
  /// The key of the switch to isolate, or null for all of them. It is not saved
  /// as a picture: solo is a way of working, not a look, and a session that
  /// opened soloed would look broken.
  solo: null,

  // ── what it is made of ──
  //
  // **The sound is the light source.** That is the whole look of this program and
  // the first pass here threw it away: lamps were pointed *at* the sound, which
  // turns the signal into a lit grey object in a lit grey room, and then the
  // walls — the biggest thing in frame — are the most prominent thing in the
  // picture. Correct, and rudimentary.
  //
  // The old renderers glow because they are additive lines on true black: there
  // is nothing in the frame that is not signal. So here the signal is *emissive*
  // and the room is nearly nothing — walls dark enough to read as structure and
  // no more, and the lamps kept for modelling the grains rather than for lighting
  // the scene.
  wallColour: '#0d1620',
  floorColour: '#0d1620',
  terrainColour: '#dff0ff',
  mistColour: '#9fc4e0',
  /// The ring had no colour of its own and borrowed the mist's, which meant the
  /// palette could not paint it separately from the air.
  ringColour: '#bcd8ec',
  groundColour: '#000000',
  /// How much of its own light each signal object gives off. This is what makes
  /// a ridge a glowing line rather than a grey surface with a lamp on it.
  glow: 1,

  // ── detail, and the difference between watching and filming ──
  //
  // **The preview is not the render.** A video editor cuts at a lower resolution
  // than it delivers at, and this is the same: the film goes out at 4K where
  // every row and every sample shows, and the thing on screen is a window a
  // fraction of that size where most of them land on the same pixel.
  //
  // So the row and sample counts above are the *full* numbers — what the film
  // gets — and this scales them down for the preview. The picture is the same
  // picture, drawn with fewer of the same lines, which is what a proxy is. The
  // export sets it to one.
  //
  // It does not touch anything you can see the shape of: the camera, the light,
  // the glow and the geometry are identical either way, or the preview would be
  // lying about the framing rather than merely being coarser.
  detail: 0.55,

  // ── how well it is drawn ──
  //
  // The first pass had lights and nothing for them to find: flat diffuse on flat
  // planes reads as coloured cardboard however well it is lit. Definition comes
  // from detail at three scales — a grain in the surface, a line on the form,
  // and a falloff at the edges — and none of those are lighting.
  /// The ruling on the walls. Nothing to rule when there are none, so it
  /// follows them off.
  grid: false,
  gridSize: 24,
  gridFade: 0.22,
  wire: true,
  wireWidth: 1.4,
  shadows: true,
  shadowSoft: 32,
  bloom: true,
  bloomAmount: 1.05,
  bloomThreshold: 0.32,
  vignette: 0.45,
  contrast: 1.7,
  exposure: 1.05,
  fxaa: true,
};

/// The rate rows arrive at, which is the room's poll rate.
const ST_PUSH_HZ = 20;

/// The stage's colours, as palette slots.
///
/// **Because there is a colour manager and this was ignoring it.** Every other
/// visual takes its colours from the palette; the stage was carrying its own
/// defaults, which meant a scheme applied to the room did nothing here and the
/// two could not be made to match.
///
/// Flat colours rather than ramps: these are what a thing *is*, not a value read
/// against a range. The room's fourteen include ramps because a floor coloured
/// by frequency is a floor whose colour means something; a wall is just a wall.
const ST_SLOTS = [
  { key: 'stageTerrain', label: 'Terrain', row: -1, own: null, css: true, flat: true,
    hint: 'The stacked lines along the floor. The brightest thing in the scene by default, because it is the sound.' },
  { key: 'stageSleeve', label: 'Sleeve', row: -1, own: null, css: true, flat: true,
    hint: 'The stacked lines on the surfaces.' },
  { key: 'stageRing', label: 'Ring', row: -1, own: null, css: true, flat: true,
    hint: 'The hoops of the portal.' },
  { key: 'stageGrains', label: 'Grains', row: -1, own: null, css: true, flat: true,
    hint: 'Every grain about to sound.' },
  { key: 'stageMist', label: 'Mist', row: -1, own: null, css: true, flat: true,
    hint: 'What is floating in the air.' },
  { key: 'stageType', label: 'Type', row: -1, own: null, css: true, flat: true,
    hint: 'The words standing in the space.' },
  { key: 'stageWalls', label: 'Walls', row: -1, own: null, css: true, flat: true,
    hint: 'The room, when it is switched on at all.' },
  { key: 'stageGround', label: 'Ground', row: -1, own: null, css: true, flat: true,
    hint: 'What everything is drawn on, and what the fog is made of. Black is the look; anything else is a mood.' },
];

/// The ten arrangements of the cloud.
///
/// **A named visualiser is an arrangement, not a renderer.** The grain views were
/// ten separate drawings in a separate document on a separate engine, and the
/// only thing that actually differed between them was *where a grain goes*. Every
/// one of them reads the same schedule, ages it the same way, and draws the same
/// solid — so what they are is a function from a grain to a place.
///
/// Written as that function, all ten fit here. `g` carries the grain's stable
/// hashes and its pan and pitch; `t` is how far through its life it is. The
/// return is a place in the space, in room units.
///
/// This is Phase 1 of `docs/PORT-PLAN.md` arriving as ten functions rather than
/// as a port of two and a half thousand lines, and it is why the plan was
/// reframed around one scene: in ten scenes these would have been ten programs.
const ST_LAYOUTS = [
  {
    key: 'swarm', label: 'Swarm', suite: 1,
    hint: 'The free cloud — the form most people mean by granular. It travels away from you as it ages.',
    at: (g, t, w, h, d) => [
      (g.fx + g.dx * t) * w, (g.fy + g.dy * t) * h, t * d,
    ],
  },
  {
    key: 'shear', label: 'Shear', suite: 1,
    hint: 'Output time across, source time into the screen, pitch up. The stretch is not a number here — it is the slope.',
    at: (g, t, w, h, d) => [
      (t * 2 - 1) * w, g.pitch * h, (g.src * 0.8 + t * 0.2) * d,
    ],
  },
  {
    key: 'braid', label: 'Braid', suite: 1,
    hint: 'Time wound into a helix, so overlap resolves into countable strands.',
    at: (g, t, w, h, d) => {
      const a = t * Math.PI * 6 + g.seed * Math.PI * 2;
      return [Math.cos(a) * w * 0.45, Math.sin(a) * h * 0.45, t * d];
    },
  },
  {
    key: 'shells', label: 'Shells', suite: 1,
    hint: 'Sorted onto concentric shells by pitch, an octave to a shell. Drift stops being a number and becomes a rotation you can watch.',
    at: (g, t, w, h, d) => {
      const shell = 0.25 + Math.abs(g.pitch) * 0.7;
      const a = g.seed * Math.PI * 2 + t * 2;
      return [Math.cos(a) * w * shell, Math.sin(a) * h * shell, t * d];
    },
  },
  {
    key: 'lattice', label: 'Lattice', suite: 1,
    hint: 'The bare hop grid as a crystal. With every jitter at nought it is perfect; raise them and it melts.',
    at: (g, t, w, h, d) => {
      const n = 7;
      const q = (v) => (Math.round(v * n) / n);
      return [q(g.fx) * w, q(g.fy) * h, q(t) * d];
    },
  },
  {
    key: 'tunnel', label: 'Tunnel', suite: 2,
    hint: 'Grains arrive out of the dark and pass you. Depth is how far a grain is from now; the bore breathes with the source.',
    at: (g, t, w, h, d) => {
      const a = g.seed * Math.PI * 2;
      const r = 0.55 + g.src * 0.35;
      return [Math.cos(a) * w * r, Math.sin(a) * h * r, t * d];
    },
  },
  {
    key: 'mandala', label: 'Mandala', suite: 2,
    hint: 'Now is the centre. A grain’s distance from the middle is its distance from this instant, so the present blooms outward both ways at once.',
    // **Ported, not approximated.** The first version of this placed a grain by
    // its own age and a hash, which is a different quantity entirely: age runs
    // one way and only forwards, so the cloud could only ever bloom outward in
    // one direction and half the picture was missing. This is the projection out
    // of `visualiser/grain-views.html` — `projectV2` case 1 — with the same
    // numbers, and `ported` is what says the tick renderer draws it rather than
    // the solid cloud.
    //
    //   angle   one wedge of the fold, turning slowly. Anything wider than the
    //           wedge lands on top of its own reflection.
    //   radius  how far this grain is from *now*, in either direction.
    //   depth   what it is reading, lifted, less how far out of tune it is.
    ported: true,
    project: (g, k) => {
      const th = g.c * k.wedge + k.spin * 0.35;
      const rad = k.R * (0.06 + 0.94 * Math.abs(g.w));
      return [
        Math.cos(th) * rad,
        Math.sin(th) * rad,
        g.amp * k.H * 0.85 * 0.55 - g.pn * k.H * 0.3,
      ];
    },
    at: (g, t, w, h, d) => {
      const a = g.seed * Math.PI * 2 + g.pitch * 3;
      const r = Math.abs(t - 0.5) * 2;
      return [Math.cos(a) * w * r, Math.sin(a) * h * r, d * 0.35];
    },
  },
  {
    key: 'rorschach', label: 'Rorschach', suite: 2,
    hint: 'Reflected in both axes, so which way time runs cannot be said — which is the point, from inside a moment.',
    at: (g, t, w, h, d) => {
      const side = g.seed > 0.5 ? 1 : -1;
      const up = ((g.seed * 7) % 1) > 0.5 ? 1 : -1;
      return [Math.abs(g.fx + g.dx * t) * w * side, Math.abs(g.fy) * h * up, t * d];
    },
  },
  {
    key: 'vortex', label: 'Vortex', suite: 2,
    hint: 'Grains spiral in from the future, cross the present, and unwind into the past.',
    at: (g, t, w, h, d) => {
      const a = t * Math.PI * 4 + g.seed * Math.PI * 2;
      const r = Math.abs(t - 0.5) * 1.6;
      return [Math.cos(a) * w * r, Math.sin(a) * h * r, t * d];
    },
  },
  {
    key: 'ripple', label: 'Ripple', suite: 2,
    hint: 'A standing wave with its own reflection under it. The surface is the source; the grains ride it as it passes.',
    at: (g, t, w, h, d) => {
      const x = (g.fx + g.dx * t);
      const wave = Math.sin(x * 5 + t * 6) * 0.35 + g.pitch * 0.25;
      return [x * w, wave * h, t * d];
    },
  },
];

function stLayout(key) {
  return ST_LAYOUTS.find((l) => l.key === key) || ST_LAYOUTS[0];
}

/// How many colours a cloud is spread across.
const ST_CBINS = 14;

// ── what a view looks like, not just where its grains go ──
//
// **The placement was never the picture.** Ten short `at` functions were written
// on the theory that the only thing separating the grain views was where a grain
// goes; put the two Mandalas side by side and that is plainly false. The p5 one
// is a dense radial weave and the arrangement was a scatter of lit dots in the
// same positions. What placement leaves out is the stroke, the accumulation and
// the density, and between them they are most of what you are looking at.
//
// So a ported view carries its look as well: the three colours its palette is
// built from, how many times the cloud is folded, and how much light it gives
// off. These are the numbers out of `visualiser/grain-views.html` — the `LOOKS`
// table there — and they are not defaults to be improved on. They are the view.
const ST_LOOKS = {
  mandala: { palette: ['#b388eb', '#8093f1', '#f7aef8'], mirror: 12, glow: 1.6, trail: 0.65 },
};

/// Fourteen colours across the three the view is built from.
///
/// The middle colour is the midpoint rather than a third of the way along, so
/// the ramp reads as two joined gradients — which is what makes a palette of
/// three sit in a picture as a range instead of as three stripes.
function stRamp(hexes, n) {
  const at = (h) => stRgb(h, [1, 1, 1]);
  const a = at(hexes[0]), b = at(hexes[1]), d = at(hexes[2]);
  const mix = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t];
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    out.push(t < 0.5 ? mix(a, b, t * 2) : mix(b, d, (t - 0.5) * 2));
  }
  return out;
}

/// How long a grain's stroke is, from how long it sounds for.
///
/// Absolute and log-scaled rather than relative to the window asked for. Measured
/// against its own window every grain draws the same tick and the size slider
/// does nothing at all; measured against the engine's whole range a five
/// millisecond grain is a speck and a two second one is a streak.
function stTickScale(seconds) {
  const lo = Math.log(0.004), hi = Math.log(2.2);
  const s = Math.max(0.004, Math.min(2.2, seconds));
  return 0.22 + ((Math.log(s) - lo) / (hi - lo)) * 2.9;
}

/// A grain's own amplitude envelope, at this instant, plus its afterimage.
///
/// The Hann window the renderer actually applies to that grain — so what glows
/// is a readout of the audio and the picture cannot disagree with the sound. The
/// tail is the one honest embellishment: the grain has finished and is making no
/// sound, and the decay is there so the eye can see where the playhead has been.
function stEnergy(dt, dur, trail) {
  const d = Math.max(dur, 1e-9);
  const phase = dt / d;
  if (phase < 0) return 0;
  if (phase <= 1) return 0.5 - 0.5 * Math.cos(Math.PI * 2 * phase);
  if (trail <= 0) return 0;
  const tail = Math.max(d * 5 * trail, 0.05);
  const k = (dt - d) / tail;
  return k >= 1 ? 0 : (1 - k) * (1 - k) * 0.55 * trail;
}

/// Whether an object draws, given what is soloed.
///
/// **Solo does not change the switches.** Turning the other eight off to look at
/// one would mean turning eight back on afterwards and hoping you remembered
/// which — so this is a filter over the answer rather than an edit to the state.
/// Let go of solo and the scene is exactly as it was.
function stShows(cfg, key) {
  if (!cfg[key]) return false;
  if (!cfg.solo) return true;
  if (cfg.solo === key) return true;
  // A soloed sleeve keeps its faces, or soloing it shows nothing at all.
  if (cfg.solo === 'sleeveOn' && key.startsWith('sleeve')) return true;
  return false;
}

/// How many of a thing to actually build, after the preview's scaling.
///
/// **One place decides it.** Scaled at each use site instead, the terrain and
/// the sleeve would drift apart the first time one of them was edited, and a
/// preview whose objects disagree about how detailed they are is worse than one
/// that is simply coarse.
function stDetail(cfg, n, lo, hi) {
  const d = Math.max(0.05, Math.min(1, cfg.detail === undefined ? 1 : cfg.detail));
  return Math.max(lo, Math.min(hi, Math.round(n * d)));
}

/// Everything that can be switched on or off, in the order the panel shows it.
///
/// **The admin is built from this.** The room's controls were written out by
/// hand, one row per thing, which is why adding a layer meant editing a panel —
/// and why the panel and the renderer could disagree about what existed.
const ST_OBJECTS = [
  // ── things in the room ──
  { key: 'shell', group: 'Things', label: 'Walls', hint: 'The room itself: five surfaces for the light to land on.' },
  { key: 'terrainOn', group: 'Things', label: 'Terrain', hint: 'The sound along the floor, receding as it ages.' },
  { key: 'cloudOn', group: 'Things', label: 'Grains', hint: 'Every grain about to sound, as a lit solid travelling down the room.' },
  { key: 'typeOn', group: 'Things', label: 'Type', hint: 'Words standing in the space as geometry — the sound passes in front of them and behind them.' },
  { key: 'ringOn', group: 'Things', label: 'Ring', hint: 'The Lissajous hung in the room, every frame of it joined into a tube with depth as time.' },
  { key: 'sleeveOn', group: 'Things', label: 'Sleeve', hint: 'The stacked lines on the room’s own surfaces — the sleeve, lit.' },

  // ── which surfaces the sleeve is on ──
  { key: 'sleeveFloor', group: 'Sleeve faces', label: 'Floor', hint: 'Off by default: the terrain already has the floor, and two pictures of the same sound on one plane fight.' },
  { key: 'sleeveCeiling', group: 'Sleeve faces', label: 'Ceiling', hint: 'Stacked lines overhead, hanging down.' },
  { key: 'sleeveLeft', group: 'Sleeve faces', label: 'Left', hint: 'Up the left wall, running away into the room.' },
  { key: 'sleeveRight', group: 'Sleeve faces', label: 'Right', hint: 'Up the right wall.' },
  { key: 'sleeveBack', group: 'Sleeve faces', label: 'Back', hint: 'The sleeve itself, at the end of the room: rows born at the bottom and climbing.' },

  // ── the air ──
  { key: 'mistOn', group: 'Air', label: 'Mist', hint: 'Particles in the air, drifting through the light.' },
  { key: 'fogOn', group: 'Air', label: 'Fog', hint: 'The air itself. Thick enough and the back of the room is gone rather than dim.' },

  // ── the lamps ──
  { key: 'keyOn', group: 'Lamps', label: 'Key', hint: 'The lamp that makes the form.' },
  { key: 'fillOn', group: 'Lamps', label: 'Fill', hint: 'Stops the shadow side going to black.' },
  { key: 'rimOn', group: 'Lamps', label: 'Rim', hint: 'From behind, to find the edges.' },

  // ── how it is drawn ──
  //
  // These had no switch at all, which meant the only way to see what any of them
  // was doing was to drag its slider to nothing and back — and `fxaa` has no
  // slider, so there was no way at all.
  { key: 'grid', group: 'Look', label: 'Grid', hint: 'The ruling on the walls. It is what gives the room a size — a plain surface in perspective could be a metre away or a mile.' },
  { key: 'wire', group: 'Look', label: 'Wire', hint: 'The bright line along the terrain’s ridges, over the lit surface.' },
  { key: 'shadows', group: 'Look', label: 'Shadows', hint: 'The key light casting. A thing with no shadow is a thing not standing anywhere.' },
  { key: 'bloom', group: 'Look', label: 'Bloom', hint: 'Bright things spilling. The old renderer got this free from additive blending; a lit one has to ask.' },
  { key: 'fxaa', group: 'Look', label: 'Smooth', hint: 'Anti-aliasing. Off, every edge in here is a staircase, and a room is nothing but edges.' },
];

/// The controls, in groups, with the pairs that are really one gesture given a
/// pad instead of two sliders.
///
/// **A slider is the wrong shape for most of this.** Where the camera stands is
/// one decision with two numbers in it, and split across two sliders you make it
/// by alternating between them and watching a third thing — the picture — to see
/// whether you have arrived. On a pad it is one movement, and the thing you are
/// steering is under your hand rather than beside it.
///
/// So: pads for the pairs, sliders only for what is genuinely one number, and
/// the whole lot in groups small enough to hold in your head. Forty-four sliders
/// in a column is a list, and a list is not an instrument.
const ST_GROUPS = [
  {
    key: 'room', label: 'Room',
    pads: [
      { x: 'width', y: 'height', label: 'SIZE',
        hint: 'How wide and how tall, together. Drag.' },
      { x: 'depth', y: 'taper', label: 'THROAT',
        hint: 'How far it runs back, against how far the far end draws in. Down and right is a long funnel; up and left is a shallow box.' },
    ],
    sliders: [],
  },
  {
    key: 'camera', label: 'Camera',
    pads: [
      { x: 'swing', y: 'lift', label: 'STANDPOINT',
        hint: 'Where the camera stands, across and up. The same thing dragging the picture does.' },
      { x: 'aim', y: 'lift', label: 'VIEW',
        hint: 'Where the camera stands and what it looks at — one gesture, not two numbers.' },
      { x: 'eye', y: 'fov', label: 'LENS',
        hint: 'How far back, against how wide. Close and wide is the inside of the thing; far and narrow is a diagram of it.' },
    ],
    sliders: [],
  },
  {
    key: 'light', label: 'Light',
    pads: [
      { x: 'keySide', y: 'keyHigh', label: 'KEY',
        hint: 'Where the main lamp hangs. Drag it around the room.' },
      { x: 'key', y: 'ambient', label: 'BALANCE',
        hint: 'The key against the light that comes from nowhere. Right and down is dramatic; left and up is flat.' },
    ],
    sliders: ['keyAt', 'fill', 'rim', 'drive'],
  },
  {
    key: 'air', label: 'Air',
    pads: [
      { x: 'fogDensity', y: 'mist', label: 'ATMOSPHERE',
        hint: 'How thick the air is, against how much is floating in it.' },
    ],
    sliders: ['mistSize', 'mistDrift'],
  },
  {
    key: 'sound', label: 'Sound',
    pads: [
      { x: 'relief', y: 'gain', label: 'TERRAIN',
        hint: 'How high the floor stands, against how hard the sound drives it.' },
      { x: 'span', y: 'window', label: 'SHAPE',
        hint: 'How wide it runs, against how hard it is pulled to the middle.' },
    ],
    sliders: ['rows', 'points', 'smooth', 'floorLevel'],
  },
  {
    key: 'grains', label: 'Grains',
    pads: [
      { x: 'cloudDensity', y: 'cloudSize', label: 'CLOUD',
        hint: 'How much of the schedule is drawn, against how big each grain is.' },
    ],
    sliders: ['cloudDrift', 'cloudGlow', 'cloudCap'],
  },
  {
    key: 'ring', label: 'Ring',
    pads: [
      { x: 'ringSize', y: 'ringDrive', label: 'BORE',
        hint: 'How wide the tube is, against how hard the sound pushes it out of round.' },
    ],
    sliders: ['ringHigh', 'ringRows', 'ringPoints'],
  },
  {
    key: 'type', label: 'Type',
    pads: [],
    sliders: ['typeSize', 'typeDepth', 'typeLean', 'typeSwing'],
  },
  {
    key: 'sleeve', label: 'Sleeve',
    pads: [
      { x: 'typeAt', y: 'typeHigh', label: 'TYPE',
        hint: 'How far into the space the words stand, and how high. Deep enough and the sound passes in front of them.' },
      { x: 'sleeveSpan', y: 'sleeveRelief', label: 'STACK',
        hint: 'How far the lines run across each surface, against how far they stand off it.' },
    ],
    sliders: [],
  },
  {
    key: 'look', label: 'Look',
    pads: [
      { x: 'glow', y: 'bloomAmount', label: 'GLOW',
        hint: 'How much light the sound gives off, against how far it spills. This pair is the look — everything else is the room it happens in.' },
      { x: 'exposure', y: 'contrast', label: 'FILM',
        hint: 'How much light reaches it, against how far apart the lit and unlit are.' },
      { x: 'bloomAmount', y: 'bloomThreshold', label: 'BLOOM',
        hint: 'How much the bright parts spill, against how bright a thing has to be before it does.' },
    ],
    sliders: ['vignette', 'gridSize', 'gridFade', 'wireWidth', 'shadowSoft'],
  },
];

/// The sliders.
const ST_UI = [
  { key: 'depth', tag: 'DEPTH', min: 2, max: 14, step: 0.1, hint: 'How far the room runs back.' },
  { key: 'width', tag: 'WIDTH', min: 1, max: 6, step: 0.05, hint: 'How wide it is.' },
  { key: 'height', tag: 'HEIGHT', min: 1, max: 6, step: 0.05, hint: 'How tall it is.' },
  { key: 'taper', tag: 'TAPER', min: 0.2, max: 1, step: 0.01,
    hint: 'How far the back draws in. At one it is a box; under one it is a funnel, which is perspective before the camera has any.' },
  { key: 'eye', tag: 'EYE', min: 0.2, max: 8, step: 0.05, hint: 'How far back the camera stands.' },
  { key: 'lift', tag: 'LIFT', min: -1.5, max: 1.5, step: 0.01, hint: 'How high it stands.' },
  { key: 'swing', tag: 'SWING', min: -3, max: 3, step: 0.01, hint: 'How far across the space it stands. Drag the picture sideways.' },
  { key: 'aim', tag: 'AIM', min: 0, max: 1, step: 0.01, hint: 'How far down the room it looks.' },
  { key: 'fov', tag: 'LENS', min: 0.3, max: 1.6, step: 0.01, hint: 'The field of view.' },
  { key: 'ambient', tag: 'AMBIENT', min: 0, max: 1, step: 0.01, hint: 'The light that comes from nowhere. Too much and nothing has form.' },
  { key: 'key', tag: 'KEY', min: 0, max: 4, step: 0.02, hint: 'The main lamp.' },
  { key: 'keySide', tag: 'KEY SIDE', min: -1, max: 1, step: 0.01, hint: 'Which side it stands.' },
  { key: 'keyHigh', tag: 'KEY HIGH', min: -1, max: 1, step: 0.01, hint: 'How high it hangs.' },
  { key: 'keyAt', tag: 'KEY AT', min: 0, max: 1, step: 0.01, hint: 'How far down the room it hangs.' },
  { key: 'fill', tag: 'FILL', min: 0, max: 2, step: 0.02, hint: 'The soft one opposite the key.' },
  { key: 'rim', tag: 'RIM', min: 0, max: 4, step: 0.02, hint: 'The one behind.' },
  { key: 'drive', tag: 'DRIVE', min: 0, max: 3, step: 0.02, hint: 'How hard the sound moves the key light.' },
  { key: 'fogDensity', tag: 'FOG', min: 0, max: 0.6, step: 0.005, hint: 'How thick the air is.' },
  { key: 'mist', tag: 'MIST', min: 0, max: 6000, step: 50, round: true, hint: 'How many particles are in it.' },
  { key: 'mistSize', tag: 'MIST SIZE', min: 0.005, max: 0.3, step: 0.005, hint: 'How big each one is.' },
  { key: 'mistDrift', tag: 'DRIFT', min: 0, max: 0.5, step: 0.005, hint: 'How fast they move.' },
  { key: 'relief', tag: 'RELIEF', min: 0.02, max: 2, step: 0.01, hint: 'How high the terrain stands.' },
  { key: 'rows', tag: 'ROWS', min: 8, max: 320, step: 1, round: true, hint: 'How many rows of it. The line quality is most of what this looks like.' },
  { key: 'points', tag: 'POINTS', min: 32, max: 1024, step: 8, round: true, hint: 'Samples along a row. Below about sixty the peaks go faceted; a 4K render will show it.' },
  { key: 'span', tag: 'SPAN', min: 0.3, max: 1, step: 0.01, hint: 'How much of the floor it crosses.' },
  { key: 'window', tag: 'WINDOW', min: 0, max: 1, step: 0.01, hint: 'How hard the sound is pulled to the middle.' },
  { key: 'smooth', tag: 'SMOOTH', min: 0, max: 8, step: 1, round: true, hint: 'Across the samples of a row.' },
  { key: 'gain', tag: 'GAIN', min: 0.1, max: 4, step: 0.05, hint: 'How hard the sound drives it.' },
  { key: 'floorLevel', tag: 'SILENCE', min: 0, max: 0.05, step: 0.001, hint: 'Below this is drawn flat.' },
  { key: 'cloudDensity', tag: 'CLOUD', min: 0, max: 1, step: 0.01,
    hint: 'How much of the schedule is drawn. A cloud you can see through is worth more than one you cannot.' },
  { key: 'cloudSize', tag: 'GRAIN SIZE', min: 0.005, max: 0.3, step: 0.005, hint: 'How big each grain is.' },
  { key: 'cloudDrift', tag: 'GRAIN DRIFT', min: 0, max: 1, step: 0.01, hint: 'How far a grain wanders as it travels.' },
  { key: 'cloudGlow', tag: 'GRAIN GLOW', min: 0, max: 1.5, step: 0.01, hint: 'How much light a grain gives off of its own, before the lamps touch it.' },
  { key: 'cloudCap', tag: 'GRAIN CAP', min: 100, max: 6000, step: 100, round: true, hint: 'The most that will ever be in the room at once.' },
  { key: 'ringSize', tag: 'RING', min: 0.05, max: 1.5, step: 0.01, hint: 'How wide the tube is.' },
  { key: 'ringDrive', tag: 'RING DRIVE', min: 0, max: 4, step: 0.02, hint: 'How hard the sound pushes it out of round.' },
  { key: 'ringHigh', tag: 'RING HIGH', min: -1, max: 1, step: 0.01, hint: 'How high it hangs.' },
  { key: 'ringRows', tag: 'RING ROWS', min: 8, max: 400, step: 1, round: true, hint: 'How far back it goes, in frames of sound.' },
  { key: 'ringPoints', tag: 'RING FINE', min: 16, max: 512, step: 8, round: true, hint: 'How finely each hoop is drawn.' },
  { key: 'sleeveRelief', tag: 'SLEEVE', min: 0.02, max: 1, step: 0.01,
    hint: 'How far the stacked lines stand off the walls. The surfaces face each other, so past about a third they meet in the middle.' },
  { key: 'sleeveSpan', tag: 'SLEEVE SPAN', min: 0.3, max: 1, step: 0.01, hint: 'How much of each surface they run across.' },
  { key: 'gridSize', tag: 'GRID', min: 2, max: 80, step: 1, round: true,
    hint: 'How fine the ruling on the walls is. It is what gives the room a size — a plain surface in perspective could be a metre away or a mile.' },
  { key: 'gridFade', tag: 'GRID FADE', min: 0, max: 1, step: 0.01, hint: 'How strongly the ruling shows.' },
  { key: 'wireWidth', tag: 'WIRE', min: 0.2, max: 4, step: 0.1,
    hint: 'The bright line along the terrain’s ridges, over the lit surface. The old room was only ever this line; here it is the highlight on a solid.' },
  { key: 'shadowSoft', tag: 'SHADOW', min: 0, max: 64, step: 1, round: true, hint: 'How soft the key light’s shadows are. At nought they are hard.' },
  { key: 'bloomAmount', tag: 'BLOOM', min: 0, max: 2, step: 0.02, hint: 'How much the bright parts spill.' },
  { key: 'bloomThreshold', tag: 'BLOOM AT', min: 0, max: 1, step: 0.01, hint: 'How bright a thing has to be before it spills.' },
  { key: 'contrast', tag: 'CONTRAST', min: 0.5, max: 3, step: 0.01, hint: 'How far apart the lit and the unlit are.' },
  { key: 'exposure', tag: 'EXPOSURE', min: 0.2, max: 3, step: 0.01, hint: 'How much light reaches the film.' },
  { key: 'vignette', tag: 'VIGNETTE', min: 0, max: 1.5, step: 0.01, hint: 'How far the corners fall off.' },
  { key: 'typeSize', tag: 'TYPE', min: 0.05, max: 3, step: 0.01, hint: 'How big the letters are, in room units.' },
  { key: 'typeDepth', tag: 'TYPE DEPTH', min: 0, max: 2, step: 0.01, hint: 'How far they stand off themselves. Nought is flat lettering facing you.' },
  { key: 'typeLean', tag: 'TYPE LEAN', min: 0, max: 360, step: 1, round: true, hint: 'Which way they stand off, in degrees.' },
  { key: 'typeAt', tag: 'TYPE AT', min: 0, max: 1, step: 0.01, hint: 'How far into the space they stand. Deep enough and the sound passes in front of them.' },
  { key: 'typeHigh', tag: 'TYPE HIGH', min: -2, max: 2, step: 0.01, hint: 'How high they hang.' },
  { key: 'typeSwing', tag: 'TYPE ACROSS', min: -3, max: 3, step: 0.01, hint: 'How far across.' },
  { key: 'detail', tag: 'DETAIL', min: 0.15, max: 1, step: 0.05,
    hint: 'How much of the full row and sample count the preview draws. The film always draws all of it — this is the proxy you watch while you work, and it changes nothing you can see the shape of.' },
  { key: 'glow', tag: 'GLOW', min: 0, max: 3, step: 0.02,
    hint: 'How much light the sound gives off of its own. This is the look: at nought the signal is a grey surface with a lamp on it, and up it is a glowing line the way the old renderers draw it.' },
];

function stRgb(hex, fallback) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return fallback;
  const v = parseInt(m[1], 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

function stColor(hex, fallback) {
  const c = stRgb(hex, fallback);
  return new BABYLON.Color3(c[0], c[1], c[2]);
}

/// Attach to a canvas. The same four methods every visual module answers.
function stAttach(canvas) {
  if (typeof BABYLON === 'undefined') return null;
  let engine;
  try {
    engine = new BABYLON.Engine(canvas, true, {
      // The film reads the canvas back after drawing it.
      preserveDrawingBuffer: true,
      stencil: false,
      antialias: true,
    }, false);
  } catch (e) {
    return null;
  }
  if (!engine) return null;

  const scene = new BABYLON.Scene(engine);
  scene.clearColor = new BABYLON.Color4(0, 0, 0, 1);
  scene.skipPointerMovePicking = true;

  const camera = new BABYLON.FreeCamera('stcam', new BABYLON.Vector3(0, 0, -3), scene);
  camera.minZ = 0.01;
  camera.maxZ = 200;

  // ── how it is drawn ──
  //
  // **Four samples, then a pipeline.** Without multisampling every edge in here
  // is a staircase, and a room is nothing but edges. Without tone mapping the
  // lit parts clip to flat white and the unlit parts crush to flat black, which
  // is most of why the first pass read as cardboard: there was no middle.
  //
  // The bloom is not decoration. The look this program has always had is light
  // that spills, and on the old renderer that came free from additive blending;
  // on a lit renderer it has to be asked for, or the bright ridges are merely
  // pale rather than glowing.
  let pipe = null;
  try {
    pipe = new BABYLON.DefaultRenderingPipeline('stpipe', true, scene, [camera]);
    pipe.samples = 4;
  } catch (e) { pipe = null; }

  // ── the lamps ──
  //
  // Real lights, which is the whole point. `HemisphericLight` is the ambient —
  // sky above, ground below — and the two directional ones are the key and the
  // rim. Their intensities are set every frame from the settings, so moving a
  // slider moves the light rather than rebuilding anything.
  const amb = new BABYLON.HemisphericLight('stamb', new BABYLON.Vector3(0, 1, 0), scene);
  // A spot rather than a bare point, because a point light cannot cast a
  // shadow cheaply and shadows are most of what "definition" means: a thing
  // with no shadow is a thing that is not standing anywhere.
  const key = new BABYLON.SpotLight('stkey', new BABYLON.Vector3(-1, 1, 1),
    new BABYLON.Vector3(0.3, -0.4, 1), Math.PI * 0.9, 2, scene);
  let shadowGen = null;
  try {
    shadowGen = new BABYLON.ShadowGenerator(1024, key);
    shadowGen.useBlurExponentialShadowMap = true;
    shadowGen.blurKernel = 32;
  } catch (e) { shadowGen = null; }
  // Opposite the key and low, so the wall the key misses is *modelled* rather
  // than merely lifted off black. A single ambient makes the dark side flat; a
  // second lamp makes it a surface facing away from the light, which is a
  // different and much better-looking thing.
  const fill = new BABYLON.HemisphericLight('stfill', new BABYLON.Vector3(1, 0.4, -0.3), scene);
  const rim = new BABYLON.DirectionalLight('strim', new BABYLON.Vector3(0, -0.2, -1), scene);

  let cfg = { ...ST_DEFAULTS };
  let paint = { line: '#eceff2', fill: '#12202c', background: '#05080c' };

  let rows = [];
  let hoops = [];
  let ceiling = 1e-4;
  let clockNow = 0;
  let lastPushAt = 0;
  let everPushed = false;
  let level = 0;

  // ── a ruling for the walls ──
  //
  // **A plain surface in perspective has no size.** It could be a metre away or
  // a mile; there is nothing in it to measure against. A ruling gives the room a
  // scale, and it is the single biggest thing between "coloured cardboard" and
  // "a room" — more than the lights, which had nothing to land on that showed
  // they had landed.
  //
  // Drawn, not fetched: nothing here loads a file.
  let gridTex = null;
  function buildGrid() {
    const n = Math.max(2, Math.min(80, cfg.gridSize | 0));
    const k = `${n}|${cfg.gridFade}|${cfg.wallColour}`;
    if (gridTex && gridTex.__k === k) return gridTex;
    if (gridTex) gridTex.dispose();
    const S = 512;
    const t = new BABYLON.DynamicTexture('stgrid', { width: S, height: S }, scene, true);
    const g = t.getContext();
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, S, S);
    const step = S / n;
    g.strokeStyle = `rgba(0,0,0,${0.55 * cfg.gridFade})`;
    g.lineWidth = 1;
    for (let i = 0; i <= n; i++) {
      const at = Math.round(i * step) + 0.5;
      g.beginPath(); g.moveTo(at, 0); g.lineTo(at, S); g.stroke();
      g.beginPath(); g.moveTo(0, at); g.lineTo(S, at); g.stroke();
    }
    // Every fifth heavier, so the eye can count without being told to.
    g.strokeStyle = `rgba(0,0,0,${0.9 * cfg.gridFade})`;
    g.lineWidth = 2;
    for (let i = 0; i <= n; i += 5) {
      const at = Math.round(i * step) + 0.5;
      g.beginPath(); g.moveTo(at, 0); g.lineTo(at, S); g.stroke();
      g.beginPath(); g.moveTo(0, at); g.lineTo(S, at); g.stroke();
    }
    t.update();
    t.__k = k;
    t.wrapU = BABYLON.Texture.WRAP_ADDRESSMODE;
    t.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE;
    gridTex = t;
    return t;
  }

  // ── the shell ──
  const shellMat = new BABYLON.StandardMaterial('stshell', scene);
  shellMat.specularColor = new BABYLON.Color3(0.02, 0.02, 0.02);
  shellMat.backFaceCulling = false;
  let shell = null;
  let shellKey = '';

  function buildShell() {
    const k = `${cfg.width}|${cfg.height}|${cfg.depth}|${cfg.taper}`;
    if (k === shellKey && shell) return;
    shellKey = k;
    if (shell) shell.dispose();
    const hw = cfg.width / 2, hh = cfg.height / 2, d = cfg.depth, t = cfg.taper;
    // A funnel, not a box: the far rectangle is the near one drawn in by the
    // taper, so the room converges before the lens does anything.
    const near = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]];
    const far = near.map(([x, y]) => [x * t, y * t]);
    const pos = [], idx = [], nrm = [], uvs = [];
    const quad = (a, b, c, e, us, vs) => {
      const base = pos.length / 3;
      for (const p of [a, b, c, e]) pos.push(p[0], p[1], p[2]);
      // Measured in room units rather than nought-to-one, so the ruling is the
      // same size on a long wall as on a short one — stretched to fit, a grid
      // says the opposite of what a grid is for.
      uvs.push(0, 0, us, 0, us, vs, 0, vs);
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    };
    for (let i = 0; i < 4; i++) {
      const [nx0, ny0] = near[i], [nx1, ny1] = near[(i + 1) % 4];
      const [fx0, fy0] = far[i], [fx1, fy1] = far[(i + 1) % 4];
      const across = Math.hypot(nx1 - nx0, ny1 - ny0);
      quad([nx0, ny0, 0], [nx1, ny1, 0], [fx1, fy1, d], [fx0, fy0, d], across, d);
    }
    // And the back.
    quad([far[0][0], far[0][1], d], [far[1][0], far[1][1], d],
      [far[2][0], far[2][1], d], [far[3][0], far[3][1], d],
      cfg.width * t, cfg.height * t);
    shell = new BABYLON.Mesh('stshellmesh', scene);
    const vd = new BABYLON.VertexData();
    vd.positions = pos;
    vd.indices = idx;
    vd.uvs = uvs;
    BABYLON.VertexData.ComputeNormals(pos, idx, nrm);
    vd.normals = nrm;
    vd.applyToMesh(shell, true);
    shell.material = shellMat;
    shell.isPickable = false;
    shell.receiveShadows = true;
  }

  // ── the terrain ──
  const terrMat = new BABYLON.StandardMaterial('stterr', scene);
  terrMat.specularColor = new BABYLON.Color3(0.05, 0.05, 0.05);
  terrMat.backFaceCulling = false;
  let terr = null;
  let terrKey = '';
  let wire = null;
  const wireMat = new BABYLON.StandardMaterial('stwiremat', scene);
  wireMat.wireframe = true;
  wireMat.disableLighting = true;
  wireMat.backFaceCulling = false;

  function buildTerrain() {
    const R = stDetail(cfg, cfg.rows | 0, 2, 200);
    const P = stDetail(cfg, cfg.points | 0, 8, 1024);
    const k = `${R}|${P}`;
    if (k === terrKey && terr) return;
    terrKey = k;
    if (terr) terr.dispose();
    const pos = new Float32Array(R * P * 3);
    const idx = [];
    for (let r = 0; r < R - 1; r++) {
      for (let i = 0; i < P - 1; i++) {
        const a = r * P + i, b = a + 1, c = a + P, e = c + 1;
        idx.push(a, c, b, b, c, e);
      }
    }
    terr = new BABYLON.Mesh('stterrmesh', scene);
    const vd = new BABYLON.VertexData();
    vd.positions = pos;
    vd.indices = idx;
    vd.normals = new Float32Array(R * P * 3);
    vd.applyToMesh(terr, true);
    terr.material = terrMat;
    terr.isPickable = false;
    if (shadowGen) shadowGen.addShadowCaster(terr);

    // **The line follows the rows, not every edge of every triangle.**
    //
    // Babylon's `wireframe` draws the mesh's own triangulation, which on a grid
    // this fine is two diagonals per square and reads as moiré — noise, at any
    // distance, and worse the further away it is. The look this program has
    // always had is one line per row of sound, and that is also the only version
    // of it that survives perspective.
    if (wire) wire.dispose();
    const lines = [];
    for (let r = 0; r < R; r++) {
      const one = [];
      for (let i = 0; i < P; i++) one.push(new BABYLON.Vector3(0, 0, 0));
      lines.push(one);
    }
    wire = BABYLON.MeshBuilder.CreateLineSystem('stwire', { lines, updatable: true }, scene);
    wire.isPickable = false;
    wire.__R = R; wire.__P = P;
  }

  function placeTerrain() {
    if (!terr) return;
    const R = stDetail(cfg, cfg.rows | 0, 2, 200);
    const P = stDetail(cfg, cfg.points | 0, 8, 1024);
    const hw = cfg.width / 2, hh = cfg.height / 2, d = cfg.depth;
    const span = Math.max(0.05, Math.min(1, cfg.span));
    const margin = (1 - span) / 2;
    const pos = terr.getVerticesData(BABYLON.VertexBuffer.PositionKind);
    for (let r = 0; r < R; r++) {
      const t = r / (R - 1);
      // The floor narrows with the walls, so the terrain sits on it rather than
      // through it.
      const tap = 1 + (cfg.taper - 1) * t;
      const row = rows[r];
      for (let i = 0; i < P; i++) {
        const f = margin + (i / (P - 1)) * span;
        const h = row ? row[Math.min(row.length - 1, Math.round((i / (P - 1)) * (row.length - 1)))] : 0;
        const j = (r * P + i) * 3;
        pos[j] = (f * 2 - 1) * hw * tap;
        // **Just off the floor.** Sat exactly on it, the terrain's flat parts and
        // the floor are the same plane and the depth buffer cannot say which is
        // in front — the two flicker against each other pixel by pixel and the
        // floor comes out speckled. A hair of clearance costs nothing and is
        // what stops it.
        pos[j + 1] = -hh * tap + 0.004 + h * cfg.relief;
        pos[j + 2] = t * d;
      }
    }
    terr.updateVerticesData(BABYLON.VertexBuffer.PositionKind, pos);
    // Normals, or the light has nothing to answer. This is the whole difference
    // between a lit surface and a coloured one.
    const idx = terr.getIndices();
    const nrm = new Float32Array(pos.length);
    BABYLON.VertexData.ComputeNormals(pos, idx, nrm);
    terr.updateVerticesData(BABYLON.VertexBuffer.NormalKind, nrm);
    if (wire) {
      // The line sits a shade above the surface it belongs to, or the two argue
      // for the depth buffer and the ridge comes out dashed.
      const lp = new Float32Array(R * P * 3);
      for (let i = 0; i < R * P; i++) {
        lp[i * 3] = pos[i * 3];
        lp[i * 3 + 1] = pos[i * 3 + 1] + 0.006;
        lp[i * 3 + 2] = pos[i * 3 + 2];
      }
      wire.updateVerticesData(BABYLON.VertexBuffer.PositionKind, lp);
    }
  }

  // ── the type ──
  //
  // Glyphs drawn once into a texture and stood on planes in the space. Repeating
  // the plane along the lean gives real relief: the same extrusion the flat card
  // fakes, except here the depth buffer means the sound passes in front of it
  // and behind it, and the camera moving past it actually moves past it.
  //
  // Rebuilt only when the words or their shape change. A texture redrawn every
  // frame is how an engine is made slower than the canvas it replaced.
  let typePlanes = [];
  let typeTex = null;
  let typeMats = [];
  let typeKey = '';

  function disposeType() {
    for (const m of typePlanes) m.dispose();
    for (const m of typeMats) m.dispose();
    if (typeTex) typeTex.dispose();
    typePlanes = []; typeMats = []; typeTex = null; typeKey = '';
  }

  function placeType() {
    const words = typeof roomTextSettings === 'function' ? roomTextSettings() : null;
    const text = words ? String(words.text || '') : '';
    const on = stShows(cfg, 'typeOn') && !!text.trim();
    if (!on) {
      for (const m of typePlanes) m.setEnabled(false);
      return;
    }
    const steps = cfg.typeDepth > 0 ? Math.max(2, Math.min(48, Math.round(6 + cfg.typeDepth * 20))) : 1;
    const key = [text, words.align, words.weight, words.track, words.lead, steps, cfg.typeColour].join('|');
    if (key !== typeKey) {
      disposeType();
      typeKey = key;

      // Big enough that the camera can come close without it going soft.
      const W = 2048;
      const lines = text.split('\n');
      const H = 1024;
      typeTex = new BABYLON.DynamicTexture('sttype', { width: W, height: H }, scene, true);
      typeTex.hasAlpha = true;
      const g = typeTex.getContext();
      g.clearRect(0, 0, W, H);
      const px = Math.max(24, (H / Math.max(1, lines.length)) * 0.62);
      g.font = `${words.weight} ${px}px ${typeof RT_FONT !== 'undefined' ? RT_FONT : 'sans-serif'}`;
      g.textBaseline = 'middle';
      g.textAlign = 'center';
      if ('letterSpacing' in g) g.letterSpacing = `${words.track * px}px`;
      const step = words.lead * px;
      const first = H / 2 - (lines.length - 1) * step / 2;
      g.fillStyle = '#ffffff';
      for (let l = 0; l < lines.length; l++) g.fillText(lines[l], W / 2, first + l * step);
      typeTex.update();

      for (let i = 0; i < steps; i++) {
        const m = new BABYLON.StandardMaterial(`sttypem${i}`, scene);
        m.disableLighting = true;
        m.diffuseColor = new BABYLON.Color3(0, 0, 0);
        m.specularColor = new BABYLON.Color3(0, 0, 0);
        // **The texture masks; the colour lights.**
        //
        // An `emissiveTexture` *is* the emission — a white glyph sheet emits
        // white and `emissiveColor` does not scale it. Three different
        // multipliers gave an identical measured mean, which is the signature of
        // a number nothing reads.
        //
        // So the shape comes from the alpha and the brightness from the colour:
        // a plane of one colour, cut out in the shape of the letters.
        m.opacityTexture = typeTex;
        m.backFaceCulling = false;
        typeMats.push(m);
        const pl = BABYLON.MeshBuilder.CreatePlane(`sttype${i}`,
          { width: 1, height: 1, sideOrientation: BABYLON.Mesh.DOUBLESIDE }, scene);
        pl.material = m;
        pl.isPickable = false;
        typePlanes.push(pl);
      }
    }

    const rad = cfg.typeLean * Math.PI / 180;
    const dep = cfg.typeDepth * cfg.typeSize;
    const n = typePlanes.length;
    const c = stRgb(cfg.typeColour, [1, 1, 1]);
    const glow = Math.max(0, cfg.glow);
    for (let i = 0; i < n; i++) {
      // Back to front, so the face is drawn last and unbroken, and each copy
      // dimmer as it recedes — the sides falling away rather than ending on a
      // hard edge in mid-air.
      const t = n === 1 ? 0 : i / (n - 1);
      const pl = typePlanes[n - 1 - i];
      const m = typeMats[n - 1 - i];
      pl.setEnabled(true);
      pl.scaling.set(cfg.typeSize * 4, cfg.typeSize * 2, 1);
      pl.position.set(
        (cfg.typeSwing || 0) + Math.cos(rad) * dep * t,
        (cfg.typeHigh || 0) - Math.sin(rad) * dep * t,
        cfg.typeAt * cfg.depth + dep * t * 0.5,
      );
      // **Divided among the copies, not repeated on each.** A dozen emissive
      // planes stacked along a lean is a dozen lots of the same light through
      // the bloom, and the letters come out as a white blot with the words
      // barely legible inside it. The face keeps most of it and the sides get
      // what is left, which is what an extrusion looks like anyway.
      // **Saturation, not brightness, is what made the words loud.** Trimming
      // the multiplier from 0.42 to 0.3 changed the measured mean by nothing at
      // all: the face was already past white and the bloom was spreading the
      // clipped part. Below one it comes back down the curve and the letters are
      // type in a room rather than a lamp shaped like type.
      const fade = i === 0 ? 0.85 : (1 - t) * 0.85 / Math.max(1, n * 0.4);
      m.emissiveColor = new BABYLON.Color3(c[0] * glow * fade, c[1] * glow * fade, c[2] * glow * fade);
    }
  }

  // ── the sleeve ──
  //
  // One builder for all five faces, because a surface is only four vectors: a
  // corner, the way the lines run across it, the way the rows travel, and the way
  // a peak stands off. The back wall is the odd one and is the point — on the
  // other four the rows run away into the room, and on the back there is no depth
  // left to run into, so they climb. That is the sleeve, in place.
  const ST_FACES = ['floor', 'ceiling', 'left', 'right', 'back'];

  function stFaceBasis(k) {
    const hw = cfg.width / 2, hh = cfg.height / 2, d = cfg.depth;
    return {
      floor: { o: [-hw, -hh, 0], u: [hw * 2, 0, 0], v: [0, 0, d], n: [0, 1, 0] },
      ceiling: { o: [-hw, hh, 0], u: [hw * 2, 0, 0], v: [0, 0, d], n: [0, -1, 0] },
      left: { o: [-hw, -hh, 0], u: [0, hh * 2, 0], v: [0, 0, d], n: [1, 0, 0] },
      right: { o: [hw, -hh, 0], u: [0, hh * 2, 0], v: [0, 0, d], n: [-1, 0, 0] },
      back: { o: [-hw, -hh, d], u: [hw * 2, 0, 0], v: [0, hh * 2, 0], n: [0, 0, -1] },
    }[k];
  }

  const sleeveMat = new BABYLON.StandardMaterial('stsleevemat', scene);
  sleeveMat.specularColor = new BABYLON.Color3(0.08, 0.08, 0.08);
  sleeveMat.backFaceCulling = false;
  const sleeves = {};
  const sleeveWires = {};
  let sleeveKey = '';

  function buildSleeve() {
    const R = stDetail(cfg, cfg.rows | 0, 2, 200);
    const P = stDetail(cfg, cfg.points | 0, 8, 1024);
    const k = `${R}|${P}`;
    if (k === sleeveKey) return;
    sleeveKey = k;
    for (const f of ST_FACES) { if (sleeves[f]) { sleeves[f].dispose(); delete sleeves[f]; } }
    const idx = [];
    for (let r = 0; r < R - 1; r++) {
      for (let i = 0; i < P - 1; i++) {
        const a = r * P + i, b = a + 1, c = a + P, e = c + 1;
        idx.push(a, c, b, b, c, e);
      }
    }
    for (const f of ST_FACES) {
      const m = new BABYLON.Mesh(`stsleeve_${f}`, scene);
      const vd = new BABYLON.VertexData();
      vd.positions = new Float32Array(R * P * 3);
      vd.indices = idx.slice();
      vd.normals = new Float32Array(R * P * 3);
      vd.applyToMesh(m, true);
      m.material = sleeveMat;
      m.isPickable = false;
      sleeves[f] = m;

      // The line, one per row, over a fill that hides what is behind it.
      if (sleeveWires[f]) sleeveWires[f].dispose();
      const lines = [];
      for (let r = 0; r < R; r++) {
        const one = [];
        for (let i = 0; i < P; i++) one.push(new BABYLON.Vector3(0, 0, 0));
        lines.push(one);
      }
      sleeveWires[f] = BABYLON.MeshBuilder.CreateLineSystem(`stsleevewire_${f}`,
        { lines, updatable: true }, scene);
      sleeveWires[f].isPickable = false;
    }
  }

  function placeSleeve() {
    const R = stDetail(cfg, cfg.rows | 0, 2, 200);
    const P = stDetail(cfg, cfg.points | 0, 8, 1024);
    const span = Math.max(0.05, Math.min(1, cfg.sleeveSpan));
    const margin = (1 - span) / 2;
    for (const f of ST_FACES) {
      const m = sleeves[f];
      if (!m) continue;
      const want = stShows(cfg, 'sleeveOn') && !!cfg[`sleeve${f[0].toUpperCase()}${f.slice(1)}`];
      m.setEnabled(want);
      if (sleeveWires[f]) sleeveWires[f].setEnabled(want && !!cfg.wire);
      if (!want) continue;
      const b = stFaceBasis(f);
      const pos = m.getVerticesData(BABYLON.VertexBuffer.PositionKind);
      for (let r = 0; r < R; r++) {
        const t = r / (R - 1);
        const row = rows[r];
        for (let i = 0; i < P; i++) {
          const fx = margin + (i / (P - 1)) * span;
          const h = row ? row[Math.min(row.length - 1, Math.round((i / (P - 1)) * (row.length - 1)))] : 0;
          const dd = h * cfg.sleeveRelief;
          const j = (r * P + i) * 3;
          pos[j] = b.o[0] + b.u[0] * fx + b.v[0] * t + b.n[0] * dd;
          pos[j + 1] = b.o[1] + b.u[1] * fx + b.v[1] * t + b.n[1] * dd;
          pos[j + 2] = b.o[2] + b.u[2] * fx + b.v[2] * t + b.n[2] * dd;
        }
      }
      m.updateVerticesData(BABYLON.VertexBuffer.PositionKind, pos);
      const nrm = new Float32Array(pos.length);
      BABYLON.VertexData.ComputeNormals(pos, m.getIndices(), nrm);
      m.updateVerticesData(BABYLON.VertexBuffer.NormalKind, nrm);

      const w = sleeveWires[f];
      if (w) {
        // A hair off the surface, or the two argue for the depth buffer and the
        // ridge comes out dashed.
        const lp = new Float32Array(R * P * 3);
        for (let i = 0; i < R * P; i++) {
          lp[i * 3] = pos[i * 3] + b.n[0] * 0.004;
          lp[i * 3 + 1] = pos[i * 3 + 1] + b.n[1] * 0.004;
          lp[i * 3 + 2] = pos[i * 3 + 2] + b.n[2] * 0.004;
        }
        w.updateVerticesData(BABYLON.VertexBuffer.PositionKind, lp);
        const c = stRgb(cfg.sleeveColour, [1, 1, 1]);
        w.color = new BABYLON.Color3(c[0] * cfg.glow, c[1] * cfg.glow, c[2] * cfg.glow);
      }
    }
  }

  // ── the ring ──
  //
  // A tube: one hoop per frame of sound, the run of them joined into a surface.
  // Built once at a size and then only its positions rewritten, like everything
  // else here — rebuilding a mesh every frame is how an engine is made slower
  // than the hand-written thing it replaced.
  const ringMat = new BABYLON.StandardMaterial('stringmat', scene);
  ringMat.specularColor = new BABYLON.Color3(0.15, 0.15, 0.15);
  ringMat.backFaceCulling = false;
  let ring = null;
  let ringWire = null;
  let ringKey = '';

  function buildRing() {
    const R = stDetail(cfg, cfg.ringRows | 0, 2, 400);
    const P = stDetail(cfg, cfg.ringPoints | 0, 16, 512);
    const k = `${R}|${P}`;
    if (k === ringKey && ring) return;
    ringKey = k;
    if (ring) ring.dispose();
    const idx = [];
    for (let r = 0; r < R - 1; r++) {
      for (let i = 0; i < P; i++) {
        // Wrapped, because a hoop closes: the last point joins the first, and
        // without that the tube has a seam running down its length.
        const j = (i + 1) % P;
        const a = r * P + i, b = r * P + j, c = (r + 1) * P + i, d = (r + 1) * P + j;
        idx.push(a, c, b, b, c, d);
      }
    }
    ring = new BABYLON.Mesh('stringmesh', scene);
    const vd = new BABYLON.VertexData();
    vd.positions = new Float32Array(R * P * 3);
    vd.indices = idx;
    vd.normals = new Float32Array(R * P * 3);
    vd.applyToMesh(ring, true);
    ring.material = ringMat;
    ring.isPickable = false;

    // **Hoops of light over a dark tube.** A solid tube made emissive is the
    // white-slab fault again — and in open space, with the camera inside the
    // run of it, a bright solid is a cone aimed at the lens. The surface is
    // there only to stop you seeing the hoops behind; the hoops are the picture.
    if (ringWire) ringWire.dispose();
    const loops = [];
    for (let r = 0; r < R; r++) {
      const one = [];
      // Closed: the last point is the first, or every hoop has a gap in it.
      for (let i = 0; i <= P; i++) one.push(new BABYLON.Vector3(0, 0, 0));
      loops.push(one);
    }
    ringWire = BABYLON.MeshBuilder.CreateLineSystem('stringwire',
      { lines: loops, updatable: true }, scene);
    ringWire.isPickable = false;
  }

  function placeRing() {
    if (!ring) return;
    const R = stDetail(cfg, cfg.ringRows | 0, 2, 400);
    const P = stDetail(cfg, cfg.ringPoints | 0, 16, 512);
    const pos = ring.getVerticesData(BABYLON.VertexBuffer.PositionKind);
    const hh = cfg.height / 2;
    const cy = cfg.ringHigh * hh;
    const lp = ringWire ? new Float32Array(R * (P + 1) * 3) : null;
    for (let r = 0; r < R; r++) {
      const t = r / (R - 1);
      const h = hoops[r];
      // **No taper.** The taper is the room's, and it belongs to things lying on
      // the room's surfaces. Applied to the ring it shrinks the far hoops and
      // swells the near ones, and with the camera inside the run of it that
      // reads as a funnel aimed at the lens rather than a tube going away.
      for (let i = 0; i < P; i++) {
        const a = (i / P) * Math.PI * 2;
        // The hoop is a circle pushed out of round by what the two channels were
        // doing: the figure is the deviation, not the shape itself, so silence is
        // a clean bore rather than nothing at all.
        const L = h ? h[i * 2] : 0;
        const Rr = h ? h[i * 2 + 1] : 0;
        const push = (L + Rr) * 0.5 * cfg.ringDrive;
        const rad = cfg.ringSize * (1 + push);
        const x = Math.cos(a) * rad;
        const y = cy + Math.sin(a) * rad;
        // Behind the camera's own position and running away, so the near hoops
        // are the sound of a moment ago rather than something in the lens.
        const z = cfg.ringAt * cfg.depth * 0.1 + t * cfg.depth;
        const j = (r * P + i) * 3;
        pos[j] = x; pos[j + 1] = y; pos[j + 2] = z;
        if (lp) {
          const q = (r * (P + 1) + i) * 3;
          lp[q] = x; lp[q + 1] = y; lp[q + 2] = z;
        }
      }
      // The closing point of each loop.
      if (lp) {
        const first = (r * (P + 1)) * 3;
        const last = (r * (P + 1) + P) * 3;
        lp[last] = lp[first]; lp[last + 1] = lp[first + 1]; lp[last + 2] = lp[first + 2];
      }
    }
    ring.updateVerticesData(BABYLON.VertexBuffer.PositionKind, pos);
    const nrm = new Float32Array(pos.length);
    BABYLON.VertexData.ComputeNormals(pos, ring.getIndices(), nrm);
    ring.updateVerticesData(BABYLON.VertexBuffer.NormalKind, nrm);
    if (ringWire && lp) {
      ringWire.updateVerticesData(BABYLON.VertexBuffer.PositionKind, lp);
      const c = stRgb(cfg.ringColour, [0.62, 0.77, 0.88]);
      const g = Math.max(0, cfg.glow);
      ringWire.color = new BABYLON.Color3(c[0] * g, c[1] * g, c[2] * g);
    }
  }

  // ── the cloud ──
  //
  // **Thin instances, not a mesh each.** Two thousand separate meshes is two
  // thousand draw calls and a scene graph that spends longer being walked than
  // drawn; thin instances are one mesh, one call, and a matrix apiece. It is the
  // difference between a cloud that can be large and one that can be seen.
  const cloudMat = new BABYLON.StandardMaterial('stcloudmat', scene);
  cloudMat.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1);
  // **No per-instance colour.** A colour buffer on a thin instance needs the
  // material to read vertex colours, and a standard material asked to do that
  // wants a colour attribute on the base mesh as well. Set up wrong the whole
  // mesh silently stops drawing — measured, the picture was identical to two
  // decimal places with the cloud switched on and off, which is the shape of a
  // thing that is not being drawn rather than one that is too dim.
  //
  // Every grain the same colour, then, and the fade done with size. What the
  // cloud needed colour for was depth, and the fog already does that.
  let cloud = null;
  let cloudMx = null;
  let live = [];
  let seen = null;
  let cloudBorn = 0;
  let cloudDied = 0;
  let cloudNow = -1;

  function buildCloud() {
    const cap = stDetail(cfg, cfg.cloudCap | 0, 100, 6000);
    if (cloud && cloud.__cap === cap) return;
    if (cloud) cloud.dispose();
    // An icosahedron: enough faces to catch the light from several directions,
    // few enough to draw thousands of.
    cloud = BABYLON.MeshBuilder.CreatePolyhedron('stcloud', { type: 3, size: 1 }, scene);
    cloud.material = cloudMat;
    cloud.isPickable = false;
    cloud.alwaysSelectAsActiveMesh = true;
    cloud.__cap = cap;
    cloudMx = new Float32Array(cap * 16);
    cloud.thinInstanceSetBuffer('matrix', cloudMx, 16, false);
    // Nothing to draw until the first grain sounds. Left visible with no
    // instances, the base shape draws itself at the origin at full size — which
    // is one enormous grain filling the room, and exactly what it did.
    cloud.thinInstanceCount = 0;
    cloud.isVisible = false;
    cloud.alwaysSelectAsActiveMesh = true;
  }

  /// Bring in every grain the playhead has crossed, and move the ones already
  /// flying.
  function stepCloud(f) {
    if (!cloud) return;
    const cap = cloud.__cap;
    const sr = (f && f.grainRate) || 44100;
    const now = ((f && f.position) || 0) / ((f && f.positionRate) || sr);
    const list = (f && f.grains) || null;

    // A seek, a restart, or the first frame: do not pour the whole file into the
    // room to catch up, because those grains were never heard.
    cloudNow = now;
    if (seen === null || now < seen || now - seen > 1) seen = now;

    if (list && list.length && now > seen) {
      for (let i = 0; i < list.length && live.length < cap; i++) {
        const e = list[i];
        const t0 = e[0] / sr;
        if (t0 <= seen || t0 > now) continue;
        // **Its own coin, flipped once.** Thinning by taking every n-th grain
        // samples a periodic schedule at a fixed interval, and two regular rates
        // beat — the cloud comes out banded rather than thinner. A hash of the
        // grain's own index has no period to beat against, and because it is the
        // grain's own number the picture thins in place instead of rearranging.
        const key = (e[7] | 0) * 2654435761 >>> 0;
        if ((key & 0xffff) / 0x10000 > cfg.cloudDensity) continue;
        const hx = ((key & 0xffff) / 0x8000) - 1;
        const hy = (((key >>> 16) & 0xffff) / 0x8000) - 1;
        const k2 = (((e[7] | 0) ^ 0x9e3779b9) * 2246822519) >>> 0;
        cloudBorn++;
        const k3 = (((e[7] | 0) ^ 0x85ebca6b) * 0xc2b2ae35) >>> 0;
        live.push({
          // What every arrangement reads: two stable scatters, where in the
          // source it reads from, what pitch it is at, and a seed of its own.
          seed: (key >>> 8 & 0xffff) / 0x10000,
          src: (k3 & 0xffff) / 0x10000,
          pitch: Math.max(-1, Math.min(1, hy)),
          // **When it was born, on the playhead's own clock.**
          //
          // Age was accumulated per frame before this, which ties how long a
          // grain lives to how fast the machine draws — and worse, the step was
          // clamped, so a frame longer than the clamp aged a grain past its whole
          // life at once. Every grain died on the frame it was born: measured,
          // four thousand three hundred and ninety-five born and the same number
          // dead, with never one alive to draw.
          //
          // Held as a birth time instead, age is a subtraction. There is no
          // accumulator to drift, nothing to clamp, and the film — which draws as
          // fast as it can — gets the same cloud as the room.
          born: t0,
          // Across is pan, up is pitch, and both are scattered a little so a
          // busy schedule is a cloud rather than a line.
          fx: hx * 0.7 + (e[6] || 0) * 0.3,
          fy: Math.max(-0.9, Math.min(0.9, hy * 0.6)),
          dx: (((k2 & 0xffff) / 0x8000) - 1) * cfg.cloudDrift,
          dy: ((((k2 >>> 16) & 0xffff) / 0x8000) - 1) * cfg.cloudDrift * 0.7,
          age: 0,
          // How long it sounds for decides how far it gets.
          // How long it takes to cross the room. Its own length decides it, but
          // floored well above a grain's actual duration — a twentieth of a
          // second is a real grain and an invisible streak.
          life: Math.max(0.6, Math.min(4, (e[2] / sr) * 4)),
          spin: ((k2 & 0xff) / 255) * 6.283,
          size: 0.5 + ((key >>> 8 & 0xff) / 255) * 0.8,
        });
      }
    }
    seen = now;

    // Move them, and let the old ones go. Age is a subtraction from the
    // playhead, so nothing here depends on how often this is called.
    const hw = cfg.width / 2, hh = cfg.height / 2;
    const lay = stLayout(cfg.cloudLayout);
    let n = 0;
    for (let i = 0; i < live.length; i++) {
      const g = live[i];
      g.age = (now - g.born) / Math.max(0.05, g.life);
      if (g.age >= 1 || g.age < 0) { cloudDied++; continue; }
      // **No break here.** This loop is the one that keeps the survivors, and
      // breaking out of it at the cap threw away every grain after the cut —
      // which is why a full cloud went from seventeen hundred to none in one
      // frame rather than thinning. The cap belongs on births, where it is.
      if (n >= cap) { n = cap; break; }
      const t = g.age;
      // Where a grain goes is the whole of what the ten grain views were. See
      // `ST_LAYOUTS`.
      const at = lay.at(g, t, hw, hh, cfg.depth);
      const x = at[0], y = at[1], z = at[2];
      // **Fading by size, not by alpha.**
      //
      // A vertex alpha is ignored by a standard material unless transparency is
      // switched on for the whole mesh, and switching it on brings sorting with
      // it — two thousand transparent solids in a lit room have to be drawn back
      // to front or they eat each other's depth. Grown in and shrunk out, a
      // grain arrives and leaves just as smoothly and stays opaque the whole
      // time, which is one less thing for the depth buffer to argue about.
      const a = Math.min(1, Math.sin(t * Math.PI) * 1.6);
      const sc = cfg.cloudSize * g.size * a;
      const ang = g.spin + t * 3;
      const cs = Math.cos(ang) * sc, sn = Math.sin(ang) * sc;
      const m = n * 16;
      // A rotation about Y, scaled — written straight into the buffer rather
      // than built as a Matrix and copied, which at this count matters.
      cloudMx[m] = cs; cloudMx[m + 1] = 0; cloudMx[m + 2] = -sn; cloudMx[m + 3] = 0;
      cloudMx[m + 4] = 0; cloudMx[m + 5] = sc; cloudMx[m + 6] = 0; cloudMx[m + 7] = 0;
      cloudMx[m + 8] = sn; cloudMx[m + 9] = 0; cloudMx[m + 10] = cs; cloudMx[m + 11] = 0;
      cloudMx[m + 12] = x; cloudMx[m + 13] = y; cloudMx[m + 14] = z; cloudMx[m + 15] = 1;
      n++;
      live[n - 1] = g;
    }
    live.length = n;
    cloud.thinInstanceCount = n;
    cloud.thinInstanceBufferUpdated('matrix');
    // **And tell it where they all are.**
    //
    // Without this the mesh's bounds are whatever the base shape was and go to
    // nothing once instance data is written — `min` and `max` both read `null` —
    // and a mesh that cannot say where it is gets culled and drawn wrong: what
    // came out was the base shape sitting at the origin at full size, one
    // enormous grain instead of two hundred small ones.
    //
    // It is a walk over the matrices, so it is done once here rather than per
    // instance.
    cloud.thinInstanceRefreshBoundingInfo(false);
    cloud.isVisible = n > 0;
  }


  // ── the cloud, as strokes ──
  //
  // **A grain is a tick, not a dot.** This is the single largest difference
  // between the arrangements and the views they were named after, and it is why
  // the first attempt read as a scatter: a dot carries a position and nothing
  // else, while a stroke carries how long the grain lasts in its length and what
  // rate it reads at in its tilt. Two more facts about the sound, in the mark
  // itself, at no cost in clutter.
  //
  // Billboarded, so both read from any angle — the length is the length whatever
  // the camera is doing, rather than foreshortening away the moment the view
  // turns.
  //
  // **Additive, on black.** The density is the accumulation. Every renderer this
  // program has had glows because overlapping strokes sum, and where the cloud
  // piles up the picture goes white without anything being told to be brighter.
  // Drawn as lit solids the same grains cannot pile up — a solid in front of a
  // solid is one solid — so the cloud came out as countable objects, which is
  // exactly what it is not.
  //
  // A shader rather than a standard material, because what is wanted here is
  // *no* lighting, a per-instance colour, and a soft edge, and a lit material
  // asked for all three is a material fighting its own defaults. See the note on
  // per-instance colour buffers in `docs/STAGE.md`.
  const ST_TICK_VERT = `
    precision highp float;
    attribute vec3 position;
    attribute vec2 uv;
    attribute vec4 gcol;
    #include<instancesDeclaration>
    uniform mat4 viewProjection;
    varying vec2 vUV;
    varying vec4 vCol;
    void main(void) {
      #include<instancesVertex>
      vUV = uv;
      vCol = gcol;
      gl_Position = viewProjection * finalWorld * vec4(position, 1.0);
    }`;
  const ST_TICK_FRAG = `
    precision highp float;
    varying vec2 vUV;
    varying vec4 vCol;
    void main(void) {
      // Across the stroke, a falloff rather than an edge — a hard-edged
      // rectangle reads as a rectangle at any size, and what is wanted is a
      // stroke. Along it, eased at the two ends so a tick has ends rather
      // than corners.
      float across = 1.0 - abs(vUV.y * 2.0 - 1.0);
      float along = 1.0 - pow(abs(vUV.x * 2.0 - 1.0), 4.0);
      float a = pow(max(across, 0.0), 0.9) * max(along, 0.0);
      if (a <= 0.003) discard;
      gl_FragColor = vec4(vCol.rgb, vCol.a * a);
    }`;
  BABYLON.Effect.ShadersStore.stgraintickVertexShader = ST_TICK_VERT;
  BABYLON.Effect.ShadersStore.stgraintickFragmentShader = ST_TICK_FRAG;

  const tickMat = new BABYLON.ShaderMaterial('sttickmat', scene, 'stgraintick', {
    // **The instance attributes are not listed here.** Babylon appends
    // `world0`..`world3` itself when a mesh has thin instances; listing them as
    // well puts each name in the effect twice, and the duplicate takes the
    // attribute location the first one was bound to. What comes out is a mesh
    // that compiles, reports ready, is walked, is submitted and draws nothing —
    // every check green and no picture.
    attributes: ['position', 'uv', 'gcol'],
    uniforms: ['world', 'viewProjection'],
    needAlphaBlending: true,
  });
  tickMat.backFaceCulling = false;
  tickMat.alphaMode = BABYLON.Constants.ALPHA_ADD;
  // **Additive and depth-blind, both.** Ticks that write depth occlude each
  // other, and a cloud whose strokes hide one another is the countable-objects
  // picture again by another route. Nothing here is solid; it is light.
  tickMat.disableDepthWrite = true;
  tickMat.needAlphaBlending = () => true;

  let ticks = null;
  let tickMx = null;
  let tickCol = null;
  let tickCap = 0;
  /// How many times the last frame folded the cloud, so a count of strokes can
  /// be turned back into a count of grains.
  let tickFolds = 1;
  /// The grain handed to a projection, reused every time round the loop.
  const gs = { c: 0.5, w: 0, amp: 0, pn: 0 };

  function buildTicks(cap) {
    if (ticks && tickCap === cap) return;
    if (ticks) ticks.dispose();
    ticks = BABYLON.MeshBuilder.CreatePlane('sttick', { size: 1 }, scene);
    ticks.material = tickMat;
    ticks.isPickable = false;
    ticks.alwaysSelectAsActiveMesh = true;
    // Nothing behind it and nothing in front: it is drawn last, over the lit
    // scene, the way additive ink goes on last.
    ticks.renderingGroupId = 1;
    tickCap = cap;
    tickMx = new Float32Array(cap * 16);
    tickCol = new Float32Array(cap * 4);
    ticks.thinInstanceSetBuffer('matrix', tickMx, 16, false);
    ticks.thinInstanceSetBuffer('gcol', tickCol, 4, false);
    // The base shape draws itself at the origin at full size when there are no
    // instances — one enormous grain filling the room. See `docs/STAGE.md`.
    ticks.thinInstanceCount = 0;
    ticks.isVisible = false;
  }

  /// What the whole schedule looks like, measured once rather than assumed.
  ///
  /// The colour coordinate is a grain's pitch stretched across the range *this
  /// cloud* actually uses. Against the engine's theoretical ±48 semitones a
  /// couple of semitones of jitter — which is a lot to listen to — spans a
  /// fiftieth of the palette and the cloud comes out monochrome.
  let schedStats = null;
  let schedFor = null;

  function statsFor(list) {
    if (schedFor === list && schedStats) return schedStats;
    schedFor = list;
    let lo = Infinity, hi = -Infinity, amp = 1e-6, size = 0, n = 0;
    for (let i = 0; i < list.length; i++) {
      const p = list[i][3] || 0;
      if (p < lo) lo = p;
      if (p > hi) hi = p;
      if ((list[i][4] || 0) > amp) amp = list[i][4];
      size += list[i][2] || 0;
      n++;
    }
    if (!n) { lo = 0; hi = 0; }
    schedStats = { lo, span: hi - lo, amp, size: n ? size / n : 0 };
    return schedStats;
  }

  /// The moment, drawn.
  ///
  /// **Every position is a function of `tOut - now`**, so the present is the
  /// origin by construction and the cloud is always centred. That is what makes
  /// this a picture of an instant rather than of a file: it draws the grains
  /// that are *about* to sound as well as the ones that have, which is the whole
  /// of "blooming outward in both directions at once" and the half the
  /// birth-and-age cloud can never show — it has no future in it.
  function stepTicks(f, lay) {
    const list = (f && f.grains) || null;
    const sr = (f && f.grainRate) || 44100;
    const now = ((f && f.position) || 0) / ((f && f.positionRate) || sr);
    const look = ST_LOOKS[lay.key] || {};
    const k = Math.max(1, Math.round(look.mirror || 6));
    tickFolds = k;
    const cap = stDetail(cfg, cfg.cloudCap | 0, 100, 6000) * k;
    buildTicks(cap);
    if (!list || !list.length) { ticks.isVisible = false; return; }

    const st = statsFor(list);
    // How far ahead or behind a grain still counts as part of this moment.
    // Outside it nothing is drawn: from inside a moment you cannot see the whole
    // piece, and pretending otherwise is a different picture.
    const H = Math.max((st.size / sr) * 14, 1.6);
    const ramp = stRamp(look.palette || ['#b388eb', '#8093f1', '#f7aef8'], ST_CBINS);
    const glow = Math.max(0, cfg.cloudGlow) * (look.glow || 1);
    const trail = look.trail == null ? 0.5 : look.trail;
    // **How big the disc is, against the frame it has to fit in.**
    //
    // The original sets this to a fifth of its camera distance and frames the
    // view at three and a half times the radius, so the disc fills most of the
    // height. Carried over as a fraction of the *room* it came out at nearly
    // twice the camera's distance from the origin — a mandala the frame was
    // standing inside, with the middle of it behind the eye.
    const R = Math.min(cfg.width, cfg.height) * 0.28;
    const HH = cfg.height * 0.55;

    // Screen-space basis, so a stroke is legible whatever the camera is doing.
    const fwd = camera.getForwardRay ? camera.getForwardRay().direction : new BABYLON.Vector3(0, 0, 1);
    const upW = new BABYLON.Vector3(0, 1, 0);
    let rgt = BABYLON.Vector3.Cross(upW, fwd);
    if (rgt.lengthSquared() < 1e-6) rgt = new BABYLON.Vector3(1, 0, 0);
    rgt.normalize();
    const up = BABYLON.Vector3.Cross(fwd, rgt).normalize();
    const nrm = fwd;
    // **A stroke is a width on the screen, not a size in the room.**
    //
    // The original sets these with `strokeWeight`, which is pixels — a couple of
    // pixels for a grain merely present and five for one sounding. Written as
    // world units instead they came out at two millimetres in a four-metre room,
    // which is under a pixel: every tick was there, every tick was drawn, and
    // nothing was visible. So the conversion is explicit — how much of the world
    // one pixel covers at this distance through this lens — and every number
    // below is the original's, in the original's units.
    //
    // Against the canvas's *CSS* height, not its buffer height. On a retina
    // display the buffer is twice the size, so measured against that every
    // stroke comes out half the width the original draws, which on a two pixel
    // line is the difference between a stroke and nothing at all.
    const dist = BABYLON.Vector3.Distance(camera.position, BABYLON.Vector3.Zero());
    const dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
    const cssH = Math.max(1, engine.getRenderHeight() / dpr);
    const wpp = (2 * dist * Math.tan(cfg.fov / 2)) / cssH;
    const wedge = (Math.PI * 2) / k;
    const spin = now * 0.55;
    const ctx = { R, H: HH, wedge, spin, now };

    let n = 0;
    for (let i = 0; i < list.length && n + k <= cap; i++) {
      const e = list[i];
      const dt = e[0] / sr - now;
      if (dt > H || dt < -H) continue;
      // Thinned by the grain's own number, not by taking every n-th: a periodic
      // schedule sampled at a fixed interval beats against itself and comes out
      // banded rather than thinner. See the same note on the solid cloud.
      const key = (e[7] | 0) * 2654435761 >>> 0;
      if ((key & 0xffff) / 0x10000 > cfg.cloudDensity) continue;

      const dur = (e[2] || 0) / sr;
      // **A grain that has not sounded yet is still drawn.** It is dark — the
      // dimmest of the three tiers — but it is there, and it is half of what
      // this view is: the present blooming outward in both directions at once.
      // Culled on energy, only the past survived and the picture was a half
      // moon of ink with nothing coming.
      const en = stEnergy(-dt, dur, trail);

      // What every ported projection reads, in one object that is filled and
      // refilled rather than built per grain — this loop runs over the whole
      // schedule on every frame, and a fresh pair of objects a grain is a few
      // thousand allocations a frame for nothing.
      //
      //   c    where this grain sits in the palette, by pitch
      //   w    how far it is from now, signed: −1 gone, 0 now, +1 coming
      //   amp  how loud the stretch of source it reads is
      //   pn   how far out of tune it is
      gs.c = st.span > 1e-9 ? ((e[3] || 0) - st.lo) / st.span : 0.5;
      gs.w = Math.max(-1, Math.min(1, dt / H));
      gs.amp = Math.min(1, (e[4] || 0) / st.amp);
      gs.pn = Math.max(-1, Math.min(1, (e[3] || 0) / 48));
      const at = lay.project(gs, ctx);

      // The mark itself: length is how long the grain lasts, tilt is what rate
      // it reads at, and both are facts about the sound rather than decoration.
      // Length in pixels, the way the original sets it: a five millisecond grain
      // is a speck and a two second one is a streak, and the run between them is
      // logarithmic so the window slider moves it visibly at every setting.
      const L = 14 * stTickScale(dur) * wpp;
      const semis = e[3] || 0;
      const tilt = Math.max(-2.2, Math.min(2.2, semis / 12)) * 0.62;
      const ca = Math.cos(tilt), sa = Math.sin(tilt);
      const dxv = rgt.x * ca + up.x * sa, dyv = rgt.y * ca + up.y * sa, dzv = rgt.z * ca + up.z * sa;
      const pxv = -rgt.x * sa + up.x * ca, pyv = -rgt.y * sa + up.y * ca, pzv = -rgt.z * sa + up.z * ca;

      // Three tiers, dimmest first — the sounding grains sit on top of the ones
      // merely present, which is what makes overlap legible as brightness.
      const ei = en > 0.55 ? 2 : (en > 0.08 ? 1 : 0);
      // Never thinner than a pixel and a bit. A stroke narrower than the screen
      // can draw is not a faint stroke, it is an absent one — and the whole
      // cloud went missing that way while every tick was present and correct.
      const wgt = Math.max(1.6, (ei === 0 ? 3.8 : (ei === 1 ? 5.6 : 9.5)) * 0.9) * wpp;
      const alpha = Math.min(1, (ei === 0 ? 0.35 : (ei === 1 ? 0.65 : 0.92)) * glow);
      const ci = Math.max(0, Math.min(ST_CBINS - 1, Math.floor(gs.c * ST_CBINS)));
      const col = ramp[ci];

      // The kaleidoscope. The cloud is placed once and written k times under a
      // rotation and an alternating flip — the symmetry is a property of the
      // looking rather than of the sound, which is exactly what it should be,
      // and it is where the density comes from. Twelve folds is twelve times the
      // ink for one pass over the schedule.
      for (let s = 0; s < k; s++) {
        const a = (s * Math.PI * 2) / k + now * 0.12;
        const cr = Math.cos(a), sr2 = Math.sin(a);
        // **Flipped, then turned** — the order the original applies them in, and
        // not a detail: turning first and flipping the result reflects every
        // other wedge about the wrong axis, so the folds land on top of one
        // another and twelve of them read as six.
        const fl = (s & 1) ? -1 : 1;
        const rot = (x, y) => { const yy = y * fl; return [x * cr - yy * sr2, x * sr2 + yy * cr]; };
        const p = rot(at[0], at[1]);
        const d2 = rot(dxv, dyv);
        const q2 = rot(pxv, pyv);
        const nn2 = rot(nrm.x, nrm.y);
        const m = n * 16;
        tickMx[m] = d2[0] * L; tickMx[m + 1] = d2[1] * L; tickMx[m + 2] = dzv * L; tickMx[m + 3] = 0;
        tickMx[m + 4] = q2[0] * wgt; tickMx[m + 5] = q2[1] * wgt; tickMx[m + 6] = pzv * wgt; tickMx[m + 7] = 0;
        tickMx[m + 8] = nn2[0]; tickMx[m + 9] = nn2[1]; tickMx[m + 10] = nrm.z; tickMx[m + 11] = 0;
        tickMx[m + 12] = p[0]; tickMx[m + 13] = p[1]; tickMx[m + 14] = at[2]; tickMx[m + 15] = 1;
        const c4 = n * 4;
        tickCol[c4] = col[0]; tickCol[c4 + 1] = col[1]; tickCol[c4 + 2] = col[2]; tickCol[c4 + 3] = alpha;
        n++;
      }
    }

    ticks.thinInstanceCount = n;
    ticks.thinInstanceBufferUpdated('matrix');
    ticks.thinInstanceBufferUpdated('gcol');
    // **No bounding refresh.** The solid cloud needs one because a mesh that
    // cannot say where it is gets culled and drawn wrong. This one is never
    // culled — `alwaysSelectAsActiveMesh` — and refreshing it is a walk over
    // every matrix in the buffer, every frame, twelve of them per grain. That
    // walk on its own was enough to push the stage's tests past their timeout.
    // The one thing the refresh was really guarding against is below: a visible
    // mesh with no instances draws its base shape at the origin at full size.
    ticks.isVisible = n > 0;
  }

  // ── the mist ──
  //
  // A particle system: positions, velocities and lifetimes, drifting through the
  // room. The old room's mist is sprites shed by grains and gone when the grain
  // is; this is the air having something in it whether anything is sounding or
  // not.
  let mist = null;
  let mistTex = null;

  function buildMist() {
    if (mist) return;
    // One soft dot, drawn rather than loaded — nothing here fetches a file.
    const dt = new BABYLON.DynamicTexture('stmisttex', { width: 64, height: 64 }, scene, true);
    const g = dt.getContext();
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.4, 'rgba(255,255,255,0.35)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    dt.hasAlpha = true;
    dt.update();
    mistTex = dt;

    mist = new BABYLON.ParticleSystem('stmist', 8000, scene);
    mist.particleTexture = mistTex;
    mist.blendMode = BABYLON.ParticleSystem.BLENDMODE_ADD;
    mist.emitter = new BABYLON.Vector3(0, 0, 0);
    mist.minEmitBox = new BABYLON.Vector3(-1, -1, 0);
    mist.maxEmitBox = new BABYLON.Vector3(1, 1, 1);
    mist.minLifeTime = 2;
    mist.maxLifeTime = 8;
    mist.emitRate = 400;
    mist.gravity = new BABYLON.Vector3(0, 0.01, 0);
    mist.start();
  }

  return {
    configure(next) {
      if (!next) return;
      cfg = { ...ST_DEFAULTS, ...next };
    },

    clear() {
      rows = [];
      hoops = [];
      ceiling = 1e-4;
      clockNow = 0;
      lastPushAt = 0;
      everPushed = false;
      level = 0;
      live = [];
      seen = null;
      const n = stDetail(cfg, cfg.points | 0, 8, 1024);
      const want = stDetail(cfg, cfg.rows | 0, 2, 200) + 1;
      for (let i = 0; i <= want; i++) rows.push(new Float32Array(n));
    },

    push(bands, pairs) {
      const n = stDetail(cfg, cfg.points | 0, 8, 1024);
      let v = typeof rdgWaveRow === 'function'
        ? rdgWaveRow(n, pairs, cfg.window, cfg.smooth)
        : new Float32Array(n);
      let peak = 0;
      for (let i = 0; i < n; i++) if (v[i] > peak) peak = v[i];
      const fl = Math.max(0, cfg.floorLevel || 0);
      const gate = fl <= 0 ? 1 : Math.max(0, Math.min(1, (peak - fl) / fl));
      ceiling = Math.max(peak, ceiling * 0.995, fl);
      const k = (1.2 * cfg.gain) / Math.max(1e-4, ceiling);
      for (let i = 0; i < n; i++) v[i] *= k * gate;
      // What the light answers, smoothed so a lamp does not stutter.
      level = level * 0.8 + Math.min(1, peak / Math.max(1e-4, ceiling)) * 0.2;

      // The figure of this instant, resampled to the tube's own fineness. Kept
      // beside the row rather than derived later: a Lissajous is what the two
      // channels were doing *then*, and there is no way back to it afterwards.
      const rp = stDetail(cfg, cfg.ringPoints | 0, 16, 512);
      const hoop = new Float32Array(rp * 2);
      if (pairs && pairs.length >= 4) {
        const m = pairs.length / 2;
        for (let i = 0; i < rp; i++) {
          const k = Math.min(m - 1, Math.round((i / rp) * m));
          hoop[i * 2] = pairs[k * 2];
          hoop[i * 2 + 1] = pairs[k * 2 + 1];
        }
      }
      hoops.unshift(hoop);
      const wantH = stDetail(cfg, cfg.ringRows | 0, 2, 400) + 1;
      while (hoops.length > wantH) hoops.pop();

      rows.unshift(v);
      lastPushAt = clockNow;
      everPushed = true;
      const want = stDetail(cfg, cfg.rows | 0, 2, 200) + 2;
      while (rows.length > want) rows.pop();
      while (rows.length < want) rows.push(new Float32Array(n));
    },

    /// What the room is actually doing, for anyone asking from outside.
    ///
    /// Not debugging scaffolding: a cloud that is empty and a cloud that is not
    /// being drawn look identical from the far side of a canvas, and telling
    /// them apart by reading pixels is guesswork. This says which.
    stats() {
      // **How many grains are in the room, whichever renderer put them there.**
      // A ported view draws strokes and never touches the solid cloud, so
      // reading `live` alone reports nought for exactly the views that work.
      // The tick count is per fold, so it is divided back down to grains.
      const folds = Math.max(1, tickFolds);
      const inked = ticks && ticks.isEnabled() ? Math.round(ticks.thinInstanceCount / folds) : 0;
      return { rows: rows.length, live: live.length + inked, solids: live.length, inked,
        born: cloudBorn, died: cloudDied,
        seen, now: cloudNow, cap: cloud ? cloud.__cap : 0 };
    },

    frame(f) {
      if (f && f.stage) this.configure(f.stage);
      paint = (f && f.stagePaint) || (f && f.ridgePaint) || paint;
      clockNow = (f && typeof f.clock === 'number') ? f.clock * 1000 : performance.now();
      if (!everPushed) lastPushAt = clockNow;

      const w = canvas.width, h = canvas.height;
      if (!w || !h) return;
      if (engine.getRenderWidth() !== w || engine.getRenderHeight() !== h) engine.resize();
      if (!rows.length) this.clear();

      const ground = stRgb(cfg.groundColour, [0.02, 0.03, 0.05]);
      scene.clearColor = new BABYLON.Color4(ground[0], ground[1], ground[2], 1);

      buildShell();
      buildTerrain();
      buildMist();
      buildCloud();
      buildRing();
      buildSleeve();
      placeTerrain();
      placeRing();
      placeSleeve();
      placeType();
      ring.setEnabled(stShows(cfg, 'ringOn'));
      if (ringWire) ringWire.setEnabled(stShows(cfg, 'ringOn') && !!cfg.wire);
      ringMat.diffuseColor = stColor(cfg.ringColour, [0.62, 0.77, 0.88]);
      // **One arrangement or the other, never both.** A ported view is drawn as
      // strokes and the rest as solids, and a view that is halfway through the
      // port draws twice — the same grains as ink and as objects, in the same
      // places, which reads as neither.
      const lay = stLayout(cfg.cloudLayout);
      const inked = !!lay.ported;
      const showCloud = stShows(cfg, 'cloudOn');
      // Nothing is built for a cloud that is switched off. The strokes are a
      // pass over the whole schedule and a write of one matrix per fold, which
      // is real work to do for something nobody is going to see.
      if (inked) { if (showCloud) stepTicks(f, lay); } else stepCloud(f);
      if (ticks) ticks.setEnabled(inked && showCloud);
      cloud.setEnabled(!inked && showCloud);
      cloudMat.diffuseColor = stColor(cfg.cloudColour, [1, 0.85, 0.63]);

      shell.setEnabled(stShows(cfg, 'shell'));
      terr.setEnabled(stShows(cfg, 'terrainOn'));
      if (wire) {
        wire.setEnabled(stShows(cfg, 'terrainOn') && !!cfg.wire);
        const wc = stRgb(cfg.terrainColour, [1, 1, 1]);
        const gg = Math.max(0, cfg.glow);
        wire.color = new BABYLON.Color3(wc[0] * gg, wc[1] * gg, wc[2] * gg);
        wire.alpha = Math.max(0.05, Math.min(1, cfg.wireWidth / 2));
      }
      // The ruling, and the shadows it helps you read.
      shellMat.diffuseTexture = cfg.grid ? buildGrid() : null;
      if (shellMat.diffuseTexture) {
        shellMat.diffuseTexture.uScale = 1;
        shellMat.diffuseTexture.vScale = 1;
      }
      if (shadowGen) {
        shadowGen.blurKernel = Math.max(1, cfg.shadowSoft);
        shadowGen.getShadowMap().renderList = cfg.shadows && cfg.terrainOn ? [terr] : [];
      }
      // ── the line glows; the surface hides ──
      //
      // **A filled surface made emissive is a white slab.** That is what the
      // first attempt at this produced: the terrain lit from inside came out as
      // a featureless ramp, brighter than the room but with no form in it at all.
      //
      // The old renderers are not surfaces. They are *lines*, with a fill behind
      // them whose only job is to stop you seeing the lines further back — the
      // fill is the background colour and is meant to be invisible. That is the
      // whole trick, and inverting it is exactly how a picture goes from a
      // stack of ridges to a sheet of white.
      //
      // So here: the surface takes the ground's own colour and emits nothing,
      // and the line over it carries all the glow. The difference from the flat
      // version is that this fill is a real solid in a depth buffer, so it hides
      // what is behind it from any angle rather than only from one.
      const g = Math.max(0, cfg.glow);
      const ground2 = stColor(cfg.groundColour, [0, 0, 0]);
      terrMat.emissiveColor = ground2.scale(1);
      terrMat.diffuseColor = ground2.scale(1);
      sleeveMat.emissiveColor = ground2.scale(1);
      sleeveMat.diffuseColor = ground2.scale(1);
      ringMat.emissiveColor = ground2.scale(1);
      ringMat.diffuseColor = ground2.scale(1);
      cloudMat.emissiveColor = stColor(cfg.cloudColour, [1, 0.85, 0.63]).scale(cfg.cloudGlow * g);

      shellMat.diffuseColor = stColor(cfg.wallColour, [0.14, 0.21, 0.27]);
      // A little of its own, or the walls are a hole behind the terrain: a lamp
      // inside a room only lights what it reaches, and the corners it does not
      // reach have nothing to say they are corners.
      shellMat.emissiveColor = stColor(cfg.wallColour, [0.14, 0.21, 0.27]).scale(0.5);

      // ── the air ──
      if (stShows(cfg, 'fogOn') && cfg.fogDensity > 0) {
        scene.fogMode = BABYLON.Scene.FOGMODE_EXP2;
        scene.fogDensity = cfg.fogDensity;
        scene.fogColor = new BABYLON.Color3(ground[0], ground[1], ground[2]);
      } else {
        scene.fogMode = BABYLON.Scene.FOGMODE_NONE;
      }

      // ── the lamps ──
      //
      // The key answers the sound; the others hold still. A room where every
      // lamp pumps is a disco, and a room where none of them do is a diagram.
      amb.intensity = cfg.ambient;
      amb.diffuse = stColor(cfg.wallColour, [0.2, 0.3, 0.4]);
      key.setEnabled(stShows(cfg, 'keyOn'));
      fill.setEnabled(stShows(cfg, 'fillOn'));
      rim.setEnabled(stShows(cfg, 'rimOn'));
      key.intensity = cfg.key * (1 + level * cfg.drive);
      key.diffuse = stColor(cfg.terrainColour, [1, 1, 1]);
      key.position.set(
        cfg.keySide * cfg.width,
        cfg.keyHigh * cfg.height,
        cfg.keyAt * cfg.depth,
      );
      key.range = cfg.depth * 3;
      // Aimed at the middle of the room from wherever it hangs, so moving it
      // swings the light across the walls rather than merely relocating a glow.
      const aimAt = new BABYLON.Vector3(0, -cfg.height * 0.2, cfg.depth * 0.5);
      key.direction = aimAt.subtract(key.position).normalize();
      key.angle = Math.PI * 0.85;
      key.exponent = 1.5;
      fill.intensity = cfg.fill;
      fill.diffuse = stColor(cfg.floorColour, [0.2, 0.3, 0.4]);
      rim.intensity = cfg.rim;
      rim.diffuse = stColor(cfg.mistColour, [1, 1, 1]);
      rim.direction = new BABYLON.Vector3(0, -0.25, -1);

      // ── the mist ──
      if (mist) {
        const want = Math.max(0, Math.min(6000, cfg.mist | 0));
        mist.emitRate = stShows(cfg, 'mistOn') ? want / 4 : 0;
        mist.minSize = cfg.mistSize * 0.5;
        mist.maxSize = cfg.mistSize;
        mist.minEmitBox = new BABYLON.Vector3(-cfg.width / 2, -cfg.height / 2, 0);
        mist.maxEmitBox = new BABYLON.Vector3(cfg.width / 2, cfg.height / 2, cfg.depth);
        mist.minLifeTime = cfg.mistLife * 0.4;
        mist.maxLifeTime = cfg.mistLife;
        mist.direction1 = new BABYLON.Vector3(-cfg.mistDrift, cfg.mistDrift, -cfg.mistDrift);
        mist.direction2 = new BABYLON.Vector3(cfg.mistDrift, cfg.mistDrift * 2, cfg.mistDrift);
        const c = stRgb(cfg.mistColour, [1, 1, 1]);
        const mg = Math.max(0, cfg.glow);
        mist.color1 = new BABYLON.Color4(c[0], c[1], c[2], 0.5 * mg);
        mist.color2 = new BABYLON.Color4(c[0], c[1], c[2], 0.16 * mg);
        mist.colorDead = new BABYLON.Color4(c[0], c[1], c[2], 0);
      }

      // ── the film ──
      //
      // Tone mapping first, because without it the lit parts clip to white and
      // the unlit crush to black, and everything between — which is where form
      // lives — is thrown away.
      if (pipe) {
        pipe.fxaaEnabled = !!cfg.fxaa;
        pipe.bloomEnabled = !!cfg.bloom;
        pipe.bloomWeight = cfg.bloomAmount;
        pipe.bloomThreshold = cfg.bloomThreshold;
        pipe.bloomKernel = 48;
        pipe.imageProcessingEnabled = true;
        const ip = pipe.imageProcessing;
        if (ip) {
          ip.toneMappingEnabled = true;
          ip.toneMappingType = BABYLON.ImageProcessingConfiguration.TONEMAPPING_ACES;
          ip.exposure = cfg.exposure;
          ip.contrast = cfg.contrast;
          ip.vignetteEnabled = cfg.vignette > 0;
          ip.vignetteWeight = cfg.vignette * 4;
          ip.vignetteStretch = 0.4;
          ip.vignetteColor = new BABYLON.Color4(ground[0], ground[1], ground[2], 0);
          ip.vignetteBlendMode = BABYLON.ImageProcessingConfiguration.VIGNETTEMODE_MULTIPLY;
        }
      }

      // ── the camera ──
      camera.position.set(cfg.swing || 0, cfg.lift, -cfg.eye);
      camera.setTarget(new BABYLON.Vector3((cfg.swing || 0) * 0.25, 0, cfg.depth * cfg.aim));
      camera.fov = cfg.fov;

      scene.render();
    },
  };
}

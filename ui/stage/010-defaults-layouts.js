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
  // ── where the camera stands ──
  //
  // **Two angles, a distance and a point to look at**, which is what every 3D
  // application means by a camera. Turn it with the picture: drag orbits,
  // shift-drag slides the point, the wheel pulls in.
  /// Round the target, in radians. Nought looks down the room.
  orbit: 0,
  /// Above or below it. Level at nought; the ten views open a little above.
  ///
  /// **These three are the old rig's opening shot, re-expressed.** It stood at
  /// `(0, 0.12, −1.15)` and looked at `(0, 0, 2.7)`, so the distance between
  /// those two is 3.85 and the angle above is `asin(0.12 / 3.85)`. Carried over
  /// as `dist: 1.6` — the old `eye` measured from the *origin* rather than from
  /// the target — the camera opened two and a third units further down the room
  /// than it ever had, and the ring, the sleeve and the type were all off the
  /// front of the frame. Every one of their tests said "drew nothing", which is
  /// what a thing behind the camera looks like.
  tilt: 0.031,
  /// How far back from the point it is looking at.
  dist: 3.85,
  /// The point it turns around, and what it looks at. Slid by shift-drag.
  ///
  /// **Down the room, not at the origin.** The stage's own cloud travels away
  /// from you as it ages — it runs the length of `depth` — so a camera turning
  /// around the origin is turning around one end of it and most of the cloud is
  /// out of frame. The old rig aimed at `depth × aim`, which is this number; the
  /// ten ported views set it to nought when they are chosen, because they are
  /// built around the present and the present is the origin.
  panX: 0, panY: 0, panZ: 2.7,

  // **The old rig, kept and unlisted.** `eye`, `swing`, `lift` and `aim` slid
  // the camera on a plane and aimed it down the room's axis. Nothing reads them
  // any more — see the camera block — and nothing offers them, but they are here
  // because a saved scene may still carry them and because deleting a rig is not
  // the same as replacing it.
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
  /// Which solid a grain is drawn as.
  ///
  /// **`auto` is the catalogue.** Every grain gets one of the thirty-seven in
  /// `ui/grain-shapes.js` from its own hash, at a tier set by how loud it is — a
  /// grain eight pixels across cannot show the difference between a dodecahedron
  /// and an icosahedron, so the intricate ones only turn up on grains with the
  /// pixels to hold them. Naming one instead draws the whole cloud as that.
  cloudShape: 'auto',
  /// Whether the cloud is drawn as strokes or as lit solids.
  ///
  /// **Both, and neither replaces the other.** An arrangement is the grain view
  /// it is named after — additive strokes on black, which is the whole of why
  /// those pictures glow. The stage's own cloud is a lit solid standing in fog,
  /// which is a different and equally deliberate thing. Choosing an arrangement
  /// turns this on; the stage itself leaves it off.
  cloudInk: false,
  /// What each view looks like, where it has been edited away from its default.
  /// Keyed by layout, so a look belongs to the view it was set on — see
  /// `ST_LOOKS`.
  looks: {},
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
  // **Off.** The words are not wanted on the stage, and this is the only type it
  // has — the flat card is not painted over this scene any more, see
  // `visGlTick`. Nothing about the object is gone: the geometry, its controls
  // and its tests are all still here, and this switch turns it back on.
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
/// The space the grain views are drawn in, in the units they were written in.
///
/// **Transcribed rather than translated.** Every projection below is the one out
/// of `visualiser/grain-views.html`, number for number, so the two can be read
/// side by side and any difference is a mistake rather than a decision. What
/// converts to room units is a single scale applied afterwards — see `stFit` —
/// because ten projections each carrying their own conversion is ten chances to
/// get it subtly wrong, and the first attempt at these got exactly that wrong in
/// every one of them.
const ST_P5 = { SPAN: 520, HEIGHT: 260, R: 300 };
/// How far the source waveform lifts a grain off its bare position.
const ST_RIDE = ST_P5.HEIGHT * 0.85;

/// A stable angle for a grain, from its own number.
///
/// The original takes this from the seeded generator on salt 21 — the display's
/// own scatter, which means nothing about the sound and is deliberately small.
/// Here it is a hash of the grain's index, which has the same property that
/// matters: the same grain gets the same angle every frame and every replay.
function stSpin(i) {
  const h = ((i | 0) ^ 0x9e3779b9) * 2246822519 >>> 0;
  return ((h & 0xffff) / 0x10000) * Math.PI * 2;
}

/// **A named visualiser is an arrangement of the one cloud.**
///
/// Every entry says where a grain goes, in the original's space. `g` carries
/// everything a projection can ask about a grain:
///
///   tOut tSrc dur   when it sounds, where it reads, how long it lasts
///   dt w            how far from now, raw and over the horizon (−1 gone, +1 coming)
///   u v             how far through the output and the source
///   semis rate pn   pitch, as a shift, a ratio and folded to −1..1
///   a               how loud the source is where it reads (the lift)
///   dev             how far its read strayed from where it was due
///   c               where it sits in the palette — see `ST_COLOUR_BY`
///   pan i n         across the field, its own number, and its place in the draw
///
/// `k` carries the frame: `R`, `SPAN`, `HEIGHT`, `wedge`, `spin`, `now`, and the
/// measured `overlap`, `cell` and `devScale` the object views need.
///
/// `suite` 1 is *the object* — the whole schedule laid out, no fold. `suite` 2 is
/// *the moment* — a window either side of the playhead, folded. `sym` is how it
/// folds. `moment` says which grains are drawn at all.
///
/// `open` is where the camera stands when the view is chosen, and where
/// double-clicking the picture puts it back. Ten shapes want looking at from ten
/// places: a tunnel is looked *down*, a lattice is looked *across* from above,
/// and a fold is only a fold seen square on. One opening camera for all of them
/// showed most of them edge-on, which reads as a broken projection rather than
/// as a good picture badly framed.
const ST_LAYOUTS = [
  {
    key: 'swarm', label: 'Swarm', suite: 1, ported: true, moment: true, fit: 1.05, open: { orbit: 0.2, tilt: 0.5, dist: 1.9 },
    hint: 'The cloud at the playhead, one grain for one grain. Distance from the middle is distance from now; the angle carries pitch and where it sits across the field.',
    project: (g, k) => {
      const lift = -g.a * ST_RIDE;
      const th = Math.acos(Math.max(-1, Math.min(1, -g.pn)));
      // A little of the display's own scatter, so a mono cloud is a sphere
      // rather than a single meridian. Deliberately small.
      const ph = g.pan * Math.PI + stSpin(g.i) * 0.18;
      const rr = k.R * (0.10 + 0.80 * Math.min(1, Math.abs(g.dt) / k.H))
               + g.e * k.R * 0.22;
      return [rr * Math.sin(th) * Math.cos(ph),
              rr * Math.cos(th) * 0.55 + lift * 0.5,
              rr * Math.sin(th) * Math.sin(ph)];
    },
    at: (g, t, w, h, d) => [(g.fx + g.dx * t) * w, (g.fy + g.dy * t) * h, t * d],
  },
  {
    key: 'shear', label: 'Shear', suite: 1, ported: true, fit: 0.95, open: { orbit: -0.5, tilt: 0.35, dist: 2.1 },
    hint: 'Output time across, source time into the screen, pitch up. The stretch is not a number here — it is the slope. Push it high and the diagonal flattens into a sheet.',
    project: (g, k) => {
      const lift = -g.a * ST_RIDE;
      const scale = k.SPAN / Math.max(k.outSec, k.srcSec, 1e-6);
      return [(g.tOut - k.outSec / 2) * scale,
              -g.pn * k.HEIGHT + lift,
              (g.tSrc - k.srcSec / 2) * scale];
    },
    at: (g, t, w, h, d) => [(t * 2 - 1) * w, g.pitch * h, (g.src * 0.8 + t * 0.2) * d],
  },
  {
    key: 'braid', label: 'Braid', suite: 1, ported: true, fit: 0.85, open: { orbit: 0.3, tilt: 0.75, dist: 2.2 },
    hint: 'Time wound onto a ring so that overlap resolves into countable strands. Raise overlap and new strands appear; raise density and the winding tightens.',
    project: (g, k) => {
      const lift = -g.a * ST_RIDE;
      // A whole number of turns per lap, or the two ends meet at an angle and
      // the seam is back in a subtler form.
      const TWISTS = 3;
      const major = g.u * Math.PI * 2;
      const minor = (g.i * Math.PI * 2) / k.overlap + major * TWISTS;
      // Pitch pushes a grain out of the tube's wall.
      const rMin = k.R * (0.10 + 0.20 * (Math.log2(Math.max(g.rate, 0.002)) + 4) / 8);
      const ring = k.R * 0.58 + rMin * Math.cos(minor);
      return [Math.cos(major) * ring,
              rMin * Math.sin(minor) + lift * 0.4,
              Math.sin(major) * ring];
    },
    at: (g, t, w, h, d) => {
      const a = t * Math.PI * 6 + g.seed * Math.PI * 2;
      return [Math.cos(a) * w * 0.45, Math.sin(a) * h * 0.45, t * d];
    },
  },
  {
    key: 'shells', label: 'Shells', suite: 1, ported: true, fit: 1.05, open: { orbit: 0.4, tilt: 0.5, dist: 2.2 },
    hint: 'Sorted onto concentric shells by pitch, an octave to a shell. Height is a circle, so the pass ends where it began.',
    project: (g, k) => {
      const lift = -g.a * ST_RIDE;
      const rr = k.R * (0.22 + 0.78 * (g.pn + 1) / 2);
      const th = g.u * Math.PI * 2 * 3;
      return [Math.cos(th) * rr,
              -Math.cos(g.v * Math.PI * 2) * k.HEIGHT * 0.8 + lift,
              Math.sin(th) * rr];
    },
    at: (g, t, w, h, d) => {
      const shell = 0.25 + Math.abs(g.pitch) * 0.7;
      const a = g.seed * Math.PI * 2 + t * 2;
      return [Math.cos(a) * w * shell, Math.sin(a) * h * shell, t * d];
    },
  },
  {
    key: 'lattice', label: 'Lattice', suite: 1, ported: true, fit: 1.55, open: { orbit: 0.25, tilt: 0.55, dist: 2.4 },
    hint: 'The bare hop grid, drawn as a crystal. With every jitter at nought it is perfect; raise them and it melts — order to chaos as one continuous gesture.',
    project: (g, k) => {
      const lift = -g.a * ST_RIDE;
      const gx = g.n % k.side, gz = Math.floor(g.n / k.side);
      // The grid is where a grain *would* be if nothing varied. Every axis is
      // then pushed by a real deviation, so what you see is a cloud that still
      // remembers the lattice it came from rather than a flat sheet with a
      // ripple in it.
      const rateDev = Math.log2(Math.max(g.rate, 1e-6));
      const cl = (v, m) => Math.max(-m, Math.min(m, v));
      return [(gx - k.side / 2) * k.cell + cl(g.dev * k.devScale, k.cell * 3),
              -g.pn * k.HEIGHT * 1.1 + (g.dur / Math.max(k.baseDur, 1e-6) - 1) * 90 + lift,
              (gz - k.side / 2) * k.cell + cl(rateDev * k.HEIGHT * 0.5, k.cell * 4)];
    },
    at: (g, t, w, h, d) => {
      const n = 7, q = (v) => (Math.round(v * n) / n);
      return [q(g.fx) * w, q(g.fy) * h, q(t) * d];
    },
  },
  {
    key: 'tunnel', label: 'Tunnel', suite: 2, sym: 'rot', ported: true, moment: true, fit: 0.9, open: { orbit: 0, tilt: 0.05, dist: 1.5 },
    hint: 'Grains arrive out of the dark and pass you. Depth is how far off a grain is from now, so the future is the far wall and the past is behind your head. The bore breathes with the source.',
    project: (g, k) => {
      const th = g.c * k.wedge + k.spin;
      const r = k.R * (0.30 + 0.55 * g.a) + (1 - Math.abs(g.w)) * k.R * 0.18;
      // The past is compressed hard: everything already sounded goes behind the
      // eye, where it is not so much gone as invisible — and a tunnel you cannot
      // see out of is just a wall.
      return [Math.cos(th) * r, Math.sin(th) * r,
              -(g.w > 0 ? g.w : g.w * 0.28) * k.R * 4.5];
    },
    at: (g, t, w, h, d) => {
      const a = g.seed * Math.PI * 2, r = 0.55 + g.src * 0.35;
      return [Math.cos(a) * w * r, Math.sin(a) * h * r, t * d];
    },
  },
  {
    key: 'mandala', label: 'Mandala', suite: 2, sym: 'rot', ported: true, moment: true, fit: 1, open: { orbit: 0, tilt: 0.02, dist: 1.7 },
    hint: 'Now is the centre. A grain’s distance from the middle is its distance from this instant, so the present blooms outward in both directions at once — what is coming and what has gone, indistinguishable.',
    project: (g, k) => {
      const th = g.c * k.wedge + k.spin * 0.35;
      const rad = k.R * (0.06 + 0.94 * Math.abs(g.w));
      return [Math.cos(th) * rad, Math.sin(th) * rad,
              g.a * ST_RIDE * 0.55 - g.pn * k.HEIGHT * 0.3];
    },
    at: (g, t, w, h, d) => {
      const a = g.seed * Math.PI * 2 + g.pitch * 3, r = Math.abs(t - 0.5) * 2;
      return [Math.cos(a) * w * r, Math.sin(a) * h * r, d * 0.35];
    },
  },
  {
    key: 'rorschach', label: 'Rorschach', suite: 2, sym: 'mirror', ported: true, moment: true, fit: 1.15, open: { orbit: 0, tilt: 0.18, dist: 1.9 },
    hint: 'Reflected in both axes. Time runs across, and the fold makes it impossible to say which way — which is the point, from inside a moment.',
    project: (g, k) => [
      g.w * k.SPAN * 0.62,
      -(g.a * ST_RIDE * 0.55) - g.pn * k.HEIGHT * 0.45 - 40,
      (g.c - 0.5) * k.SPAN * 0.5,
    ],
    at: (g, t, w, h, d) => {
      const side = g.seed > 0.5 ? 1 : -1;
      const up = ((g.seed * 7) % 1) > 0.5 ? 1 : -1;
      return [Math.abs(g.fx + g.dx * t) * w * side, Math.abs(g.fy) * h * up, t * d];
    },
  },
  {
    key: 'vortex', label: 'Vortex', suite: 2, sym: 'rot', ported: true, moment: true, fit: 1, open: { orbit: 0, tilt: 0.02, dist: 1.7 },
    hint: 'Grains spiral in from the future, cross the present, and unwind into the past. Drift and jitter twist the arms.',
    project: (g, k) => {
      const th = g.dt * 2.1 + g.c * k.wedge + k.spin;
      const rad = k.R * (0.10 + 0.90 * Math.abs(g.w));
      return [Math.cos(th) * rad, Math.sin(th) * rad,
              g.a * ST_RIDE * 0.55 * 1.6 - g.pn * k.HEIGHT * 0.25];
    },
    at: (g, t, w, h, d) => {
      const a = t * Math.PI * 4 + g.seed * Math.PI * 2, r = Math.abs(t - 0.5) * 1.6;
      return [Math.cos(a) * w * r, Math.sin(a) * h * r, t * d];
    },
  },
  {
    key: 'ripple', label: 'Ripple', suite: 2, sym: 'mirror', ported: true, moment: true, fit: 1.3, open: { orbit: 0, tilt: 0.1, dist: 1.9 },
    hint: 'A standing wave with its own reflection under it. The surface is the source; the grains are what is riding it as it passes.',
    project: (g, k) => [
      g.w * k.SPAN * 0.72,
      -(g.a * ST_RIDE * 0.55) * 1.3
        + Math.sin(g.dt * 5.5 + g.c * 7 + k.now * 1.6) * k.HEIGHT * 0.22 - 30,
      (g.c - 0.5) * k.SPAN * 0.55,
    ],
    at: (g, t, w, h, d) => {
      const x = (g.fx + g.dx * t);
      const wv = Math.sin(x * 5 + t * 6) * 0.35 + g.pitch * 0.25;
      return [x * w, wv * h, t * d];
    },
  },
];



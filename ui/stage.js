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
  mist: 1400,
  mistSize: 0.055,
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
  cloudGlow: 0.4,
  cloudColour: '#ffd9a0',

  // ── the ring ──
  //
  // The Lissajous, hung in the room with depth as time — every frame's figure
  // kept and the run of them joined into a tube. On the old renderer it is a
  // stack of wire hoops; here it is a surface, so the light runs along it and
  // the shape of the sound is something you read off the highlight rather than
  // off a tangle of lines.
  ringOn: true,
  ringRows: 160,
  ringPoints: 256,
  /// **Narrow, and hung high.** The tube runs away from the camera, so seen down
  /// its own axis a wide one is a disc filling the room rather than a tube going
  /// anywhere. Small enough to read as a bore, and lifted clear of the terrain
  /// so both can be seen at once.
  ringSize: 0.16,
  ringAt: 0.42,
  ringHigh: 0.52,
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
  groundColour: '#000000',
  /// How much of its own light each signal object gives off. This is what makes
  /// a ridge a glowing line rather than a grey surface with a lamp on it.
  glow: 1,

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
    key: 'sleeve', label: 'Sleeve',
    pads: [
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
    const R = Math.max(2, Math.min(200, cfg.rows | 0));
    const P = Math.max(8, Math.min(1024, cfg.points | 0));
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
    const R = Math.max(2, Math.min(200, cfg.rows | 0));
    const P = Math.max(8, Math.min(1024, cfg.points | 0));
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
    const R = Math.max(2, Math.min(200, cfg.rows | 0));
    const P = Math.max(8, Math.min(1024, cfg.points | 0));
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
    const R = Math.max(2, Math.min(200, cfg.rows | 0));
    const P = Math.max(8, Math.min(1024, cfg.points | 0));
    const span = Math.max(0.05, Math.min(1, cfg.sleeveSpan));
    const margin = (1 - span) / 2;
    for (const f of ST_FACES) {
      const m = sleeves[f];
      if (!m) continue;
      const want = !!cfg.sleeveOn && !!cfg[`sleeve${f[0].toUpperCase()}${f.slice(1)}`];
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
  let ringKey = '';

  function buildRing() {
    const R = Math.max(2, Math.min(400, cfg.ringRows | 0));
    const P = Math.max(16, Math.min(512, cfg.ringPoints | 0));
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
  }

  function placeRing() {
    if (!ring) return;
    const R = Math.max(2, Math.min(400, cfg.ringRows | 0));
    const P = Math.max(16, Math.min(512, cfg.ringPoints | 0));
    const pos = ring.getVerticesData(BABYLON.VertexBuffer.PositionKind);
    const hh = cfg.height / 2;
    const cy = cfg.ringHigh * hh;
    for (let r = 0; r < R; r++) {
      const t = r / (R - 1);
      const tap = 1 + (cfg.taper - 1) * t;
      const h = hoops[r];
      for (let i = 0; i < P; i++) {
        const a = (i / P) * Math.PI * 2;
        // The hoop is a circle pushed out of round by what the two channels
        // were doing: the figure is the deviation, not the shape itself, so a
        // silent room is a clean tube rather than nothing at all.
        const L = h ? h[i * 2] : 0;
        const Rr = h ? h[i * 2 + 1] : 0;
        const push = (L + Rr) * 0.5 * cfg.ringDrive;
        const rad = cfg.ringSize * tap * (1 + push);
        const j = (r * P + i) * 3;
        pos[j] = Math.cos(a) * rad;
        pos[j + 1] = cy * tap + Math.sin(a) * rad;
        // Starting a little way in: a hoop at the very mouth of the room is
        // inches from the lens and swallows the frame.
        pos[j + 2] = cfg.ringAt * cfg.depth * 0.35 + t * cfg.depth * 0.8;
      }
    }
    ring.updateVerticesData(BABYLON.VertexBuffer.PositionKind, pos);
    const nrm = new Float32Array(pos.length);
    BABYLON.VertexData.ComputeNormals(pos, ring.getIndices(), nrm);
    ring.updateVerticesData(BABYLON.VertexBuffer.NormalKind, nrm);
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
    const cap = Math.max(100, Math.min(6000, cfg.cloudCap | 0));
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
        live.push({
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
      const tap = 1 + (cfg.taper - 1) * t;
      const x = (g.fx + g.dx * t) * hw * tap;
      const y = (g.fy + g.dy * t) * hh * tap;
      const z = t * cfg.depth;
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
      const n = Math.max(8, Math.min(1024, cfg.points | 0));
      const want = Math.max(2, Math.min(200, cfg.rows | 0)) + 1;
      for (let i = 0; i <= want; i++) rows.push(new Float32Array(n));
    },

    push(bands, pairs) {
      const n = Math.max(8, Math.min(1024, cfg.points | 0));
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
      const rp = Math.max(16, Math.min(512, cfg.ringPoints | 0));
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
      const wantH = Math.max(2, Math.min(400, cfg.ringRows | 0)) + 1;
      while (hoops.length > wantH) hoops.pop();

      rows.unshift(v);
      lastPushAt = clockNow;
      everPushed = true;
      const want = Math.max(2, Math.min(200, cfg.rows | 0)) + 2;
      while (rows.length > want) rows.pop();
      while (rows.length < want) rows.push(new Float32Array(n));
    },

    /// What the room is actually doing, for anyone asking from outside.
    ///
    /// Not debugging scaffolding: a cloud that is empty and a cloud that is not
    /// being drawn look identical from the far side of a canvas, and telling
    /// them apart by reading pixels is guesswork. This says which.
    stats() {
      return { rows: rows.length, live: live.length, born: cloudBorn, died: cloudDied,
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
      ring.setEnabled(!!cfg.ringOn);
      ringMat.diffuseColor = stColor(cfg.ringColour || cfg.mistColour, [0.62, 0.77, 0.88]);
      stepCloud(f);
      cloud.setEnabled(!!cfg.cloudOn);
      cloudMat.diffuseColor = stColor(cfg.cloudColour, [1, 0.85, 0.63]);

      shell.setEnabled(!!cfg.shell);
      terr.setEnabled(!!cfg.terrainOn);
      if (wire) {
        wire.setEnabled(!!cfg.terrainOn && !!cfg.wire);
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
      ringMat.emissiveColor = stColor(cfg.ringColour || cfg.mistColour, [0.62, 0.77, 0.88]).scale(0.45 * g);
      cloudMat.emissiveColor = stColor(cfg.cloudColour, [1, 0.85, 0.63]).scale(cfg.cloudGlow * g);

      shellMat.diffuseColor = stColor(cfg.wallColour, [0.14, 0.21, 0.27]);
      // A little of its own, or the walls are a hole behind the terrain: a lamp
      // inside a room only lights what it reaches, and the corners it does not
      // reach have nothing to say they are corners.
      shellMat.emissiveColor = stColor(cfg.wallColour, [0.14, 0.21, 0.27]).scale(0.5);

      // ── the air ──
      if (cfg.fogOn && cfg.fogDensity > 0) {
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
      key.setEnabled(!!cfg.keyOn);
      fill.setEnabled(!!cfg.fillOn);
      rim.setEnabled(!!cfg.rimOn);
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
        mist.emitRate = cfg.mistOn ? want / 4 : 0;
        mist.minSize = cfg.mistSize * 0.5;
        mist.maxSize = cfg.mistSize;
        mist.minEmitBox = new BABYLON.Vector3(-cfg.width / 2, -cfg.height / 2, 0);
        mist.maxEmitBox = new BABYLON.Vector3(cfg.width / 2, cfg.height / 2, cfg.depth);
        mist.minLifeTime = cfg.mistLife * 0.4;
        mist.maxLifeTime = cfg.mistLife;
        mist.direction1 = new BABYLON.Vector3(-cfg.mistDrift, cfg.mistDrift, -cfg.mistDrift);
        mist.direction2 = new BABYLON.Vector3(cfg.mistDrift, cfg.mistDrift * 2, cfg.mistDrift);
        const c = stRgb(cfg.mistColour, [1, 1, 1]);
        mist.color1 = new BABYLON.Color4(c[0], c[1], c[2], 0.22);
        mist.color2 = new BABYLON.Color4(c[0], c[1], c[2], 0.06);
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
      camera.position.set(0, cfg.lift, -cfg.eye);
      camera.setTarget(new BABYLON.Vector3(0, 0, cfg.depth * cfg.aim));
      camera.fov = cfg.fov;

      scene.render();
    },
  };
}

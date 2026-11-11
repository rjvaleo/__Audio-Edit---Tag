// ================================================================ Wave: the board
//
// v8 (mock-up G): the FX view is the synth's master bus as a patchable board.
// This part is its model and its conversation with the engine; the canvas is
// `396-wave-board-canvas.js` and the inspector and pictures are
// `397-wave-board-inspector.js`. `docs/WAVE-SYNTH.md` ("v8: The board") is the
// contract.
//
// The board is held exactly as the engine stores it, `{name, nodes: [{id,
// kind, x, y, on, params}], cables: [{from: [id, port], to: [id, port]}]}`,
// and every stored board lists every control, so the page needs no defaults.
// A change of structure (a node, a cable, a place, a port count) posts the
// whole board; the engine refuses a loop or a stranded port with a 400, and
// the page puts back the last board it accepted and says why. A control moved
// goes to `/api/wave/board/param`, live while it is dragged and once more to
// keep. A source mapped onto a board control is an ordinary mod row whose
// `dst` is `board:<node>:<key>`.

/// The 82 effects, from the engine: `[{kind, label, category, suite, params}]`.
const WV_FXCAT = { list: [], by: {} };
/// The board presets, the factory four first; where the current one sits.
const WV_BOARDS = { list: [], at: -1, dirty: false, fresh: false };
/// The board as last accepted, put back when the engine refuses a change.
let wvBoardGood = null;
let wvBoardSeq = 0;

/// One muted colour per category, as a thin edge on each node.
const WV_CAT_HUE = { filter: 205, dynamics: 40, delay: 172, reverb: 238, modulation: 304, pitch: 18, distortion: 352, stereo: 140, spectral: 270, granular: 75, utility: -1 };
const WV_CAT_ORDER = ['filter', 'dynamics', 'delay', 'reverb', 'modulation', 'pitch', 'distortion', 'stereo', 'spectral', 'granular', 'utility'];
const wvCatHS = (c) => (WV_CAT_HUE[c] == null || WV_CAT_HUE[c] < 0 ? [220, 8] : [WV_CAT_HUE[c], c === 'granular' ? 38 : 42]);
const wvCatCol = (c, l = 62, a = 1) => { const [h, s] = wvCatHS(c); return `hsla(${h},${s}%,${l}%,${a})`; };
function wvCatRGB(c, l = 74) {
  const [h, s0] = wvCatHS(c), s = Math.min(100, s0 + 16) / 100, L = l / 100;
  const k = (n) => (n + h / 30) % 12, a = s * Math.min(L, 1 - L), f = (n) => L - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0), f(8), f(4)].map((v) => Math.round(v * 255)).join(',');
}
const wvCatName = (c) => (c ? c[0].toUpperCase() + c.slice(1) : '');

/// The routing nodes, the only nodes that are not effects.
const WV_ROUTING = {
  split: { n: 'Split', tip: 'Split: one in, two or three outs, each the same sound', g: 'M2 7 H7 M7 7 L15 2 M7 7 L15 12' },
  mix: { n: 'Mix', tip: 'Mix: two to four ins, a level each, one out', g: 'M2 2 L9 7 L2 12 M9 7 H15' },
  gain: { n: 'Gain', tip: 'Gain: one level, in dB', g: 'M2 11 L15 3 V11 Z' },
  pan: { n: 'Pan', tip: 'Pan: left to right', g: 'M2 7 H15 M8.5 3 V11' },
  drywet: { n: 'Dry/Wet', tip: 'Dry/Wet: wraps a branch. Send feeds the branch, Return brings it back, Wet sets how much of it you hear', g: 'M2 9 H15 M4 9 C6 2,11 2,13 9' },
};
/// The controls the engine gives the nodes that are not effects.
const WV_KIND_PARAMS = {
  gain: [{ key: 'db', label: 'Gain', min: -24, max: 24, default: 0, unit: 'dB' }],
  pan: [{ key: 'pan', label: 'Pan', min: -100, max: 100, default: 0, unit: '' }],
  drywet: [{ key: 'wet', label: 'Wet', min: 0, max: 100, default: 35, unit: '%' }],
  mix: [0, 1, 2, 3].map((i) => ({ key: `l${i}`, label: `In ${i + 1}`, min: -60, max: 6, default: 0, unit: 'dB' })),
  'wave:drive': [{ key: 'drive', label: 'Drive', min: 0, max: 1, default: 0.45, unit: '' }, { key: 'tone', label: 'Tone', min: 0, max: 1, default: 0.3, unit: '' }, { key: 'mix', label: 'Mix', min: 0, max: 1, default: 0.7, unit: '' }],
  input: [{ key: 'level', label: 'Level', min: 0, max: 1, default: 1, unit: '' }],
};
/// The inputs down the left edge, in the board's order, each in its colour.
const WV_INPUTS = [['in:voice', 'Voice', '#ffcf9e', 'The whole voice after the filters and the amp envelope: what you hear without the board'],
  ['in:osc0', 'Osc A', '#7cf0d0', 'Osc A after its own effect (set on Play), before the filters'],
  ['in:osc1', 'Osc B', '#86aef5', 'Osc B after its own effect (set on Play), before the filters'],
  ['in:osc2', 'Osc C', '#c79cf0', 'Osc C after its own effect (set on Play), before the filters'],
  ['in:sub', 'Sub', '#e9c46a', 'The sub oscillator, before the filters'],
  ['in:noise', 'Noise', '#c9cfdc', 'The noise source, before the filters']];
const WV_IN = Object.fromEntries(WV_INPUTS.map(([k, n, c, d]) => [k, { n, c, d }]));
const WV_MIXED = '#e8eaee';
/// Effects that take no sound on the board yet (`docs/WAVE-SYNTH.md`).
const WV_FX_SILENT = new Set(['fx:convolution', 'fx:spectral-dynamics']);
const WV_GRID = 16;

// ─────────────────────────────────────────────────────────────── nodes

const wvIsIO = (n) => n.kind.startsWith('in:') || n.kind === 'out';
const wvIsFx = (n) => n.kind.startsWith('fx:') || n.kind === 'wave:drive';
const wvNode = (id) => (WV.board ? WV.board.nodes.find((n) => n.id === id) : null);
const wvFxOf = (n) => WV_FXCAT.by[n.kind] || null;
const wvNodeCat = (n) => (n.kind === 'wave:drive' ? 'distortion' : (wvFxOf(n) || {}).category || 'utility');
const wvNodeCol = (n) => (wvIsFx(n) ? wvCatCol(wvNodeCat(n), 64) : n.kind.startsWith('in:') ? WV_IN[n.kind].c : n.kind === 'out' ? 'var(--wv-acc)' : 'var(--wv-t2)');

/// A node's name: an effect's own (Hyperprism's without the brand), a
/// routing node's, an input's.
function wvNodeName(n) {
  if (!n) return '';
  if (n.kind.startsWith('in:')) return WV_IN[n.kind].n;
  if (n.kind === 'out') return 'Out';
  if (n.kind === 'wave:drive') return 'Drive';
  if (WV_ROUTING[n.kind]) return WV_ROUTING[n.kind].n;
  const f = wvFxOf(n);
  return (f ? f.label : n.kind.slice(3)).replace(/^Hyperprism /, '');
}
const wvNodeMaker = (n) => (n.kind === 'wave:drive' ? 'MGL' : (wvFxOf(n) || {}).suite || 'MGL');

/// Every control a node has, as the engine describes it. An effect the
/// catalogue has not arrived for is described from its stored values.
function wvNodeSpec(n) {
  if (n.kind.startsWith('in:')) return WV_KIND_PARAMS.input;
  if (n.kind === 'mix') return WV_KIND_PARAMS.mix.slice(0, wvPortCount(n));
  if (WV_KIND_PARAMS[n.kind]) return WV_KIND_PARAMS[n.kind];
  if (n.kind === 'split' || n.kind === 'out') return [];
  const f = wvFxOf(n);
  if (f) return f.params;
  return Object.entries(n.params || {}).map(([key, v]) => ({ key, label: key, min: Math.min(0, v), max: Math.max(1, Math.abs(v) * 2), default: v, unit: '' }));
}
const wvParamOf = (n, key) => wvNodeSpec(n).find((p) => p.key === key);

/// The two to four controls an effect node shows as knobs.
function wvFacePr(n) {
  const sp = wvNodeSpec(n), face = WV_FX_FACE[n.kind];
  const keys = face ? face[0] : sp.slice(0, 3).map((p) => p.key);
  return keys.map((k) => sp.find((p) => p.key === k)).filter((p) => p && !p.choices && !p.toggle);
}

// A control's value as the engine has it, and as a knob's 0..1, with the
// descriptor's law: log where it says log.
const wvPLog = (p) => p.log && p.min > 0;
const wvPN = (p, v) => wvClamp(wvPLog(p) ? Math.log(v / p.min) / Math.log(p.max / p.min) : (v - p.min) / ((p.max - p.min) || 1));
function wvPV(p, u) {
  u = wvClamp(u);
  const v = wvPLog(p) ? p.min * Math.pow(p.max / p.min, u) : p.min + (p.max - p.min) * u;
  return p.step || p.choices || p.toggle ? Math.round(v) : v;
}
const wvPBip = (p) => p.min < 0 && Math.abs(p.min + p.max) < 1e-6;
const wvPVal = (n, p) => (n.params && typeof n.params[p.key] === 'number' ? n.params[p.key] : p.default);

/// A control's value as a person reads it, `c`ompact on a node's knob.
function wvFmtP(p, v, c) {
  if (p.choices) return p.choices[wvClamp(Math.round(v - p.min), 0, p.choices.length - 1)];
  if (p.toggle) return v >= 0.5 ? 'On' : 'Off';
  const u = p.unit || '', sp = c ? '' : ' ', sg = v < -1e-9 ? '−' : '', a = Math.abs(v);
  const nm = (x) => (x >= 100 || (c && x >= 10) ? Math.round(x) + '' : x >= 10 ? x.toFixed(1) : x.toFixed(2));
  if (p.key === 'pan') return Math.round(v) === 0 ? 'C' : (v < 0 ? 'L' : 'R') + Math.abs(Math.round(v));
  switch (u) {
    case 'ms': return a >= 1000 ? sg + (a / 1000).toFixed(2) + sp + 's' : sg + (a >= 10 ? Math.round(a) : a.toFixed(1)) + sp + 'ms';
    case 'Hz': return a >= 1000 ? (a / 1000).toFixed(a >= 10000 ? 1 : 2) + (c ? 'k' : ' kHz') : (a >= 100 ? Math.round(a) : a >= 10 ? a.toFixed(1) : a.toFixed(2)) + sp + 'Hz';
    case 'dB': return v <= -79.5 ? 'off' : (v > 0.05 ? '+' : sg) + (a >= 10 ? Math.round(a) : a.toFixed(1)) + sp + 'dB';
    case '%': return Math.round(v) + '%';
    case 's': return v.toFixed(2) + sp + 's';
    case ':1': return v.toFixed(1) + ':1';
    case 'x': case '×': return v.toFixed(2) + '×';
    case '°': return Math.round(v) + '°';
    case 'st': return (v > 0.05 ? '+' : sg) + a.toFixed(1) + sp + 'st';
    case 'ct': return Math.round(v) + sp + 'ct';
    case 'oct': return v.toFixed(1) + sp + 'oct';
    case 'm/s': return sg + Math.round(a) + sp + 'm/s';
    case 'Hz/s': return sg + Math.round(a) + (c ? '' : ' Hz/s');
    case 'bits': return (a >= 10 ? Math.round(a) : a.toFixed(1)) + (c ? 'b' : ' bits');
    case 'samples': case 'smp': return (c ? Math.round(a) : nm(a)) + sp + 'smp';
    case '': if (p.step) return Math.round(v) + ''; if (p.max <= 1.0001 && p.min >= -1.0001) return (v < -0.005 ? '−' : '') + Math.round(a * 100) + '%'; return sg + nm(a);
    default: return sg + nm(a) + sp + u;
  }
}

/// A short label that fits: the label, or its usual short form.
const WV_ABBR = { Threshold: 'Thresh', Feedback: 'Fdbk', Frequency: 'Freq', frequency: 'freq', Resonance: 'Res', Diffusion: 'Diff', 'Reverb Time': 'Time', Predelay: 'Pre', Compression: 'Comp', Release: 'Rel', Attack: 'Atk', Bandwidth: 'Width', Volume: 'Vol', Smoothing: 'Smooth', Velocity: 'Speed', Distance: 'Dist', Variation: 'Vary', Semitones: 'Semi', Density: 'Dens', 'Grain size': 'Grain', 'LFO speed': 'Rate', 'LFO depth': 'Depth', Position: 'Pos', Coefficient: 'Coef', Ceiling: 'Ceil', Amplitude: 'Amp', Averaging: 'Avg', Direction: 'Dir', 'Bit Depth': 'Bits', 'Sample Rate': 'Rate', 'Length used': 'Length', Amount: 'Amt', Damping: 'Damp', Spread: 'Sprd' };
let wvMeasureCx = null;
const wvTextW = (s, f) => { wvMeasureCx = wvMeasureCx || document.createElement('canvas').getContext('2d'); wvMeasureCx.font = f; return wvMeasureCx.measureText(s).width; };
function wvFitLab(l, wd, f) {
  f = f || `500 9px ${wvCl().sans}`;
  if (wvTextW(l, f) <= wd) return l;
  if (WV_ABBR[l] && wvTextW(WV_ABBR[l], f) <= wd) return WV_ABBR[l];
  const s = l.split(' ').map((x) => WV_ABBR[x] || x), r = s.join(' ');
  return wvTextW(r, f) <= wd ? r : s[0];
}

/// A board target's name: `Echo · Delay`, or just `Delay` when `short`.
function wvBoardDstName(d, short) {
  const [, id, key] = d.split(':'), n = wvNode(id), p = n && wvParamOf(n, key), lab = p ? p.label : key;
  return short ? lab : `${n ? wvNodeName(n) : id} · ${lab}`;
}

// ─────────────────────────────────────────────────────────────── ports

/// How many outs a split has, or ins a mix.
const wvPortCount = (n) => Math.round((n.params && (n.kind === 'split' ? n.params.outs : n.params.ins)) || 2);
function wvInPorts(n) {
  if (n.kind.startsWith('in:')) return [];
  if (n.kind === 'mix') return [...Array(wvPortCount(n)).keys()].map((i) => 'i' + i);
  if (n.kind === 'drywet') return ['i', 'ret'];
  return ['i'];
}
function wvOutPorts(n) {
  if (n.kind === 'out') return [];
  if (n.kind === 'split') return [...Array(wvPortCount(n)).keys()].map((i) => 'o' + i);
  if (n.kind === 'drywet') return ['send', 'o'];
  return ['o'];
}
/// Which ins an out depends on: Dry/Wet is two stages, so its send hears
/// only its in.
const wvDeps = (n, op) => (n.kind === 'drywet' ? (op === 'send' ? ['i'] : ['i', 'ret']) : wvInPorts(n));
const wvMainIn = (n) => (n.kind === 'mix' ? 'i0' : 'i');
const wvMainOut = (n) => (n.kind === 'split' ? 'o0' : 'o');
const wvPortName = (n, p) => (n.kind === 'mix' ? 'In ' + (+p.slice(1) + 1) : n.kind === 'split' ? 'Out ' + 'ABC'[+p.slice(1)] : p === 'send' ? 'Send' : p === 'ret' ? 'Return' : p === 'o' ? 'Out' : 'In');

// Sizes in board pixels, and where each port sits down a node's side.
const WV_NW = 152, WV_IOW = 104;
const wvNodeW = (n) => (wvIsIO(n) ? WV_IOW : WV_NW);
function wvNodeH(n) {
  if (wvIsIO(n)) return 58;
  if (wvIsFx(n)) return 136;
  if (n.kind === 'split') return 38 + wvPortCount(n) * 14 + 8;
  if (n.kind === 'mix') return 38 + wvPortCount(n) * 26 + 8;
  return n.kind === 'drywet' ? 94 : 80;
}
function wvPinY(n, port) {
  if (wvIsIO(n)) return 38;
  if (wvIsFx(n)) return 58;
  const k = wvPortCount(n);
  if (n.kind === 'split') return port === 'i' ? 38 + k * 7 : 45 + 14 * +port.slice(1);
  if (n.kind === 'mix') return port === 'o' ? 38 + k * 13 : 51 + 26 * +port.slice(1);
  if (n.kind === 'drywet') return port === 'i' || port === 'send' ? 50 : 74;
  return 55;
}
const wvPinXY = (n, port, out) => [n.x + (out ? wvNodeW(n) : 0), n.y + 1 + wvPinY(n, port)];

// ─────────────────────────────────────────────────────────────── the graph

/// Which inputs reach an out: the sound a cable carries, as the set of input
/// kinds behind it. An input switched off sends nothing.
function wvOrigins(nid, op, memo) {
  const k = nid + '.' + op;
  if (memo.has(k)) return memo.get(k);
  const s = new Set();
  memo.set(k, s);
  const n = wvNode(nid);
  if (!n) return s;
  if (n.kind.startsWith('in:')) { if (n.on !== false && wvInputLive(n.kind)) s.add(n.kind); return s; }
  for (const ip of wvDeps(n, op)) for (const c of WV.board.cables) if (c.to[0] === nid && c.to[1] === ip) wvOrigins(c.from[0], c.from[1], memo).forEach((x) => s.add(x));
  return s;
}
function wvInOrigins(n, memo) {
  const s = new Set();
  for (const c of WV.board.cables) if (c.to[0] === n.id) wvOrigins(c.from[0], c.from[1], memo).forEach((x) => s.add(x));
  return s;
}
const wvOriginCol = (s) => (s.size === 1 ? WV_IN[[...s][0]].c : s.size ? WV_MIXED : null);
/// An input is live when its source is on on Play; the voice always is.
function wvInputLive(kind) {
  const k = { 'in:osc0': 'osc0.on', 'in:osc1': 'osc1.on', 'in:osc2': 'osc2.on', 'in:sub': 'sub.on', 'in:noise': 'noise.on' }[kind];
  return !k || !!wvG(k);
}

/// Would a cable from (`tid`, `top`) into (`nid`, `ip`) feed back into itself?
function wvReaches(nid, ip, tid, top, seen) {
  const n = wvNode(nid);
  if (!n) return false;
  for (const op of wvOutPorts(n)) {
    if (!wvDeps(n, op).includes(ip)) continue;
    if (nid === tid && op === top) return true;
    const k = nid + '.' + op;
    if (seen.has(k)) continue;
    seen.add(k);
    for (const c of WV.board.cables) if (c.from[0] === nid && c.from[1] === op && wvReaches(c.to[0], c.to[1], tid, top, seen)) return true;
  }
  return false;
}
const wvSameCable = (a, b) => a.from[0] === b.from[0] && a.from[1] === b.from[1] && a.to[0] === b.to[0] && a.to[1] === b.to[1];
const wvHasCable = (c) => WV.board.cables.some((x) => wvSameCable(x, c));
const wvClone = (o) => JSON.parse(JSON.stringify(o));

/// A fresh id no node has.
function wvNewId(base = 'n') {
  let id;
  do id = base + (++wvBoardSeq); while (wvNode(id));
  return id;
}

/// The board with the inputs on the left and Out on the right, Voice straight
/// to Out: Init, and the page's own when there is no engine.
function wvInitBoard(name = 'Init board') {
  const nodes = WV_INPUTS.map(([kind], i) => ({ id: ['invoice', 'inA', 'inB', 'inC', 'insub', 'innoise'][i], kind, x: 16, y: [16, 112, 176, 240, 304, 368][i], on: true, params: { level: 1 } }));
  nodes.push({ id: 'out', kind: 'out', x: 672, y: 344, on: true, params: {} });
  return { name, nodes, cables: [{ from: ['invoice', 'o'], to: ['out', 'i'] }] };
}

/// The board as the engine takes it.
const wvBoardOut = () => ({ name: WV.board.name, nodes: WV.board.nodes.map(({ id, kind, x, y, on, params }) => ({ id, kind, x, y, on, params })), cables: WV.board.cables.map((c) => ({ from: c.from.slice(), to: c.to.slice() })) });

/// Take a board the engine sent, as the one in hand and the one to go back to.
function wvBoardAdopt(b) {
  WV.board = wvClone({ name: b.name || 'Board', nodes: b.nodes || [], cables: b.cables || [] });
  wvBoardGood = wvClone(WV.board);
  if (WV_BOARD_VIEW.sel && WV_BOARD_VIEW.sel.t === 'node' && !wvNode(WV_BOARD_VIEW.sel.id)) WV_BOARD_VIEW.sel = null;
}

// ─────────────────────────────────────────────────────────────── the engine

/// A request that keeps the engine's refusal: `{ok, status, json}`.
async function wvBoardFetch(path, method = 'GET', body) {
  if (!WV.connected) return { ok: true, status: 0, json: null, offline: true };
  try {
    const r = await fetch(path, method === 'GET' ? {} : { method, headers: { 'Content-Type': 'application/json' }, body: body == null ? undefined : JSON.stringify(body) });
    return { ok: r.ok, status: r.status, json: await r.json().catch(() => null) };
  } catch { return { ok: false, status: 0, json: null }; }
}

/// On every visit: the catalogue, the presets, and the board if the patch
/// came without one.
async function wvBoardConnect() {
  const [fx, boards] = await Promise.all([wvBoardFetch('/api/wave/fx'), wvBoardFetch('/api/wave/boards')]);
  if (fx.ok && Array.isArray(fx.json)) {
    WV_FXCAT.list = fx.json.filter((f) => f && f.kind);
    WV_FXCAT.by = Object.fromEntries(WV_FXCAT.list.map((f) => [f.kind, f]));
  }
  if (boards.ok && Array.isArray(boards.json)) WV_BOARDS.list = boards.json.filter((b) => b && Array.isArray(b.nodes));
  if (!WV.board) {
    const b = await wvBoardFetch('/api/wave/board');
    if (b.ok && b.json && Array.isArray(b.json.nodes)) wvBoardAdopt(b.json);
  }
  wvBoardEnsure();
  WV_BOARDS.at = WV_BOARDS.list.findIndex((b) => b.name === WV.board.name);
  if (WV.built) { wvBuildLibrary(); wvRenderBoard(); }
}

function wvBoardEnsure() {
  if (!WV.board) wvBoardAdopt(wvInitBoard());
}

/// A new structure: the whole board to the engine. Refused, the last good
/// board comes back and the note says what was wrong.
async function wvBoardPost(msg) {
  wvBoardDirty();
  wvRenderBoard();
  const r = await wvBoardFetch('/api/wave/board', 'POST', wvBoardOut());
  if (r.ok) {
    if (r.json && Array.isArray(r.json.nodes)) {
      const sel = WV_BOARD_VIEW.sel;
      wvBoardAdopt(r.json);
      WV_BOARD_VIEW.sel = sel && (sel.t !== 'node' || wvNode(sel.id)) ? sel : null;
      wvRenderBoard();
    } else wvBoardGood = wvClone(WV.board);
    if (msg) wvBoardNote(msg);
    return true;
  }
  const why = (r.json && r.json.error) || 'the engine did not answer';
  WV.board = wvClone(wvBoardGood);
  WV_BOARD_VIEW.sel = null;
  wvRenderBoard();
  wvBoardNote(`Refused: ${why}`, true);
  return false;
}

/// A control: heard now and throttled while it moves, kept when let go.
const wvBoardLive = { timers: new Map(), last: new Map(), touched: new Set() };
function wvBoardParam(nid, key, value, live) {
  const n = wvNode(nid);
  if (!n) return;
  if (key === 'on') n.on = !!value; else n.params[key] = value;
  wvBoardDirty();
  const k = nid + '|' + key, send = () => wvBoardFetch('/api/wave/board/param', 'POST', { node: nid, key, value: key === 'on' ? (n.on ? 1 : 0) : n.params[key], ...(live ? { live: true } : {}) });
  if (!live) {
    clearTimeout(wvBoardLive.timers.get(k));
    wvBoardLive.timers.delete(k);
    wvBoardLive.touched.delete(k);
    send().then((r) => { if (r.ok) { const g = wvBoardGood && wvBoardGood.nodes.find((x) => x.id === nid); if (g) { if (key === 'on') g.on = n.on; else g.params[key] = n.params[key]; } } });
    return;
  }
  wvBoardLive.touched.add(k);
  const since = performance.now() - (wvBoardLive.last.get(k) || 0);
  if (since >= 16 && !wvBoardLive.timers.has(k)) { wvBoardLive.last.set(k, performance.now()); send(); return; }
  if (wvBoardLive.timers.has(k)) return;
  wvBoardLive.timers.set(k, setTimeout(() => { wvBoardLive.timers.delete(k); wvBoardLive.last.set(k, performance.now()); send(); }, Math.max(0, 16 - since)));
}
/// The end of a drag on board controls: each one touched, kept.
function wvBoardCommitTouched() {
  for (const k of [...wvBoardLive.touched]) {
    const [nid, key] = k.split('|'), n = wvNode(nid);
    if (n) wvBoardParam(nid, key, key === 'on' ? n.on : n.params[key], false);
    wvBoardLive.touched.delete(k);
  }
}

// ─────────────────────────────────────────────────────────────── edits

function wvAddCable(a, ap, b, bp) {
  const c = { from: [a, ap], to: [b, bp] };
  if (wvHasCable(c)) return wvBoardNote('Those two are already patched', true);
  // Checked here first, so a loop is refused at once; the engine checks again.
  if (wvReaches(b, bp, a, ap, new Set())) return wvBoardNote(`Refused: that would loop ${wvNodeName(wvNode(a))} back into itself`, true);
  WV.board.cables.push(c);
  const sum = WV.board.cables.filter((x) => x.to[0] === b && x.to[1] === bp).length > 1;
  wvBoardPost(`Patched ${wvNodeName(wvNode(a))} → ${wvNodeName(wvNode(b))}${sum ? ' (summed with what is already there)' : ''}`);
  return true;
}

/// A new node, from the library or a menu: `kind` is `fx:<id>` or a routing
/// kind. It never lands on another node.
function wvAddNode(kind, pos, quiet) {
  const n = { id: wvNewId(), kind, x: 0, y: 0, on: true, params: {} };
  for (const p of wvNodeSpec(n)) n.params[p.key] = p.default;
  if (kind === 'split') n.params.outs = 2;
  if (kind === 'mix') { n.params.ins = 2; for (const p of WV_KIND_PARAMS.mix) n.params[p.key] = p.default; }
  if (!pos) pos = wvBoardCentre();
  n.x = Math.max(0, Math.round((pos[0] - wvNodeW(n) / 2) / WV_GRID) * WV_GRID);
  n.y = Math.max(0, Math.round((pos[1] - 14) / WV_GRID) * WV_GRID);
  wvFreeSpot(n);
  WV.board.nodes.push(n);
  WV_BOARD_VIEW.sel = { t: 'node', id: n.id };
  if (!quiet) wvBoardPost(`Added ${wvNodeName(n)}: patch it from its ports, or drop it on a cable`);
  return n;
}

const wvOverlap = (a, b) => a !== b && a.x < b.x + wvNodeW(b) + 8 && b.x < a.x + wvNodeW(a) + 8 && a.y < b.y + wvNodeH(b) + 8 && b.y < a.y + wvNodeH(a) + 8;
/// The nearest free place on the grid.
function wvFreeSpot(n) {
  if (!WV.board.nodes.some((o) => wvOverlap(o, n))) return;
  const x0 = n.x, y0 = n.y;
  let best = null, bd = 1e9;
  for (let dy = -30; dy <= 40; dy++) {
    for (let dx = -30; dx <= 30; dx++) {
      const x = x0 + dx * WV_GRID, y = y0 + dy * WV_GRID, d = dx * dx + dy * dy * 1.4;
      if (x < 0 || y < 0 || d >= bd) continue;
      n.x = x; n.y = y;
      if (!WV.board.nodes.some((o) => wvOverlap(o, n))) { bd = d; best = [x, y]; }
    }
  }
  [n.x, n.y] = best || [x0, y0];
}

/// The rows aimed at a node's controls, which go with it.
const wvNodeMods = (id) => WV.mods.filter((m) => m.dst.startsWith(`board:${id}:`));
function wvDropNodeMods(id, keep = () => false) {
  const before = WV.mods.length;
  WV.mods = WV.mods.filter((m) => !m.dst.startsWith(`board:${id}:`) || keep(m.dst.split(':')[2]));
  if (WV.mods.length !== before) wvSendMods();
}

function wvBoardDelete() {
  const s = WV_BOARD_VIEW.sel;
  if (!s) return;
  if (s.t === 'cab') {
    const c = WV.board.cables[s.i];
    if (!c) return;
    WV.board.cables.splice(s.i, 1);
    WV_BOARD_VIEW.sel = null;
    wvBoardPost(`Removed the cable ${wvNodeName(wvNode(c.from[0]))} → ${wvNodeName(wvNode(c.to[0]))}`);
    return;
  }
  const n = wvNode(s.id);
  if (!n) return;
  if (wvIsIO(n)) { wvBoardNote('The inputs and Out are on every board', true); return; }
  WV.board.nodes = WV.board.nodes.filter((x) => x !== n);
  WV.board.cables = WV.board.cables.filter((c) => c.from[0] !== n.id && c.to[0] !== n.id);
  WV_BOARD_VIEW.sel = null;
  wvDropNodeMods(n.id);
  wvBoardPost(`Removed ${wvNodeName(n)}`);
}

/// A split's outs or a mix's ins: a cable on a port that goes would be
/// stranded, which the engine refuses, so it goes first, with any row on a
/// level that goes.
function wvSetPorts(n, k) {
  const split = n.kind === 'split';
  k = Math.max(2, Math.min(split ? 3 : 4, k));
  if (wvPortCount(n) === k) return;
  n.params[split ? 'outs' : 'ins'] = k;
  if (split) WV.board.cables = WV.board.cables.filter((c) => !(c.from[0] === n.id && /^o\d$/.test(c.from[1]) && +c.from[1].slice(1) >= k));
  else {
    WV.board.cables = WV.board.cables.filter((c) => !(c.to[0] === n.id && +c.to[1].slice(1) >= k));
    wvDropNodeMods(n.id, (key) => !/^l\d$/.test(key) || +key.slice(1) < k);
  }
  wvBoardPost(`${wvNodeName(n)}: ${k} ${split ? 'outs' : 'ins'}`);
}

/// Drop a node on a cable: it goes in between.
function wvSplice(n, i) {
  const c = WV.board.cables[i];
  if (!c) return;
  WV.board.cables.splice(i, 1);
  WV.board.cables.push({ from: c.from.slice(), to: [n.id, wvMainIn(n)] }, { from: [n.id, wvMainOut(n)], to: c.to.slice() });
  wvBoardPost(`Spliced ${wvNodeName(n)} in between ${wvNodeName(wvNode(c.from[0]))} and ${wvNodeName(wvNode(c.to[0]))}`);
}

/// Lift a node out: its cables go, and what fed it now feeds what it fed.
function wvLiftOut(n) {
  const cs = WV.board.cables;
  if (!cs.some((c) => c.from[0] === n.id || c.to[0] === n.id)) return false;
  const up = cs.filter((c) => c.to[0] === n.id && (n.kind !== 'drywet' || c.to[1] === 'i'));
  const down = cs.filter((c) => c.from[0] === n.id && c.from[1] === wvMainOut(n));
  WV.board.cables = cs.filter((c) => c.from[0] !== n.id && c.to[0] !== n.id);
  for (const u of up) {
    for (const d of down) {
      const j = { from: u.from.slice(), to: d.to.slice() };
      if (!wvHasCable(j) && !wvReaches(j.to[0], j.to[1], j.from[0], j.from[1], new Set())) WV.board.cables.push(j);
    }
  }
  return true;
}

function wvDupNode(n) {
  const d = wvClone(n);
  d.id = wvNewId();
  d.x += 32; d.y += 32;
  wvFreeSpot(d);
  WV.board.nodes.push(d);
  const rows = wvNodeMods(n.id).map((m) => ({ ...m, dst: m.dst.replace(`board:${n.id}:`, `board:${d.id}:`) }));
  if (rows.length && WV.mods.length + rows.length <= 64) { WV.mods.push(...rows); wvSendMods(); }
  WV_BOARD_VIEW.sel = { t: 'node', id: d.id };
  wvBoardPost(`Duplicated ${wvNodeName(n)}, settings and mapped sources too: patch it in`);
}

/// Another kind in a node's place: its cables stay where its ports allow.
function wvReplaceNode(n, kind) {
  const old = wvNodeName(n), was = n.kind;
  n.kind = kind;
  n.on = true;
  const counts = { outs: n.params.outs, ins: n.params.ins };
  n.params = {};
  for (const p of wvNodeSpec(n)) n.params[p.key] = p.default;
  if (kind === 'split') n.params.outs = was === 'split' ? counts.outs : 2;
  if (kind === 'mix') { n.params.ins = was === 'mix' ? counts.ins : 2; for (const p of WV_KIND_PARAMS.mix) n.params[p.key] = p.default; }
  const ins = wvInPorts(n), outs = wvOutPorts(n), cs = WV.board.cables.filter((c) => c.from[0] === n.id || c.to[0] === n.id);
  WV.board.cables = WV.board.cables.filter((c) => !cs.includes(c));
  for (const c of cs) {
    const d = wvClone(c);
    if (c.to[0] === n.id) { if (!ins.length) continue; if (!ins.includes(c.to[1])) d.to[1] = ins[0]; }
    if (c.from[0] === n.id) { if (!outs.length) continue; if (!outs.includes(c.from[1])) d.from[1] = outs[0]; }
    if (wvHasCable(d) || wvReaches(d.to[0], d.to[1], d.from[0], d.from[1], new Set())) continue;
    WV.board.cables.push(d);
  }
  const keys = new Set(wvNodeSpec(n).map((p) => p.key));
  wvDropNodeMods(n.id, (key) => keys.has(key));
  wvBoardPost(`Replaced ${old} with ${wvNodeName(n)}; its cables stay`);
}

/// The main path, Voice to Out along each node's main out.
function wvMainPath() {
  const st = [], seen = new Set();
  let n = WV.board.nodes.find((x) => x.kind === 'in:voice'), inP = null;
  while (n && !seen.has(n.id)) {
    seen.add(n.id);
    const op = n.kind === 'out' ? null : wvMainOut(n);
    st.push({ n, inP, outP: op });
    if (!op) break;
    const c = WV.board.cables.find((x) => x.from[0] === n.id && x.from[1] === op && !seen.has(x.to[0]));
    if (!c) break;
    n = wvNode(c.to[0]);
    inP = c.to[1];
  }
  return { st, ok: st.length > 0 && st[st.length - 1].n.kind === 'out' };
}

/// The main path in a new order: its own cables are re-laid; a loop that
/// order would make is refused.
function wvReorder(ids) {
  const P = wvMainPath();
  if (!P.ok) return wvBoardNote('The main path has to reach Out before it can be reordered', true);
  const st = P.st, mids = st.slice(1, -1);
  if (ids.join() === mids.map((s) => s.n.id).join()) return wvRenderChain();
  const old = wvClone(WV.board.cables);
  for (let i = 0; i < st.length - 1; i++) {
    const a = st[i], b = st[i + 1];
    const j = WV.board.cables.findIndex((c) => c.from[0] === a.n.id && c.from[1] === a.outP && c.to[0] === b.n.id && c.to[1] === b.inP);
    if (j >= 0) WV.board.cables.splice(j, 1);
  }
  const seq = [st[0], ...ids.map((id) => mids.find((s) => s.n.id === id)), st[st.length - 1]];
  for (let i = 0; i < seq.length - 1; i++) {
    const c = { from: [seq[i].n.id, seq[i].outP], to: [seq[i + 1].n.id, seq[i + 1].inP] };
    if (!wvHasCable(c)) WV.board.cables.push(c);
  }
  if (WV.board.cables.some((c) => wvReaches(c.to[0], c.to[1], c.from[0], c.from[1], new Set()))) {
    WV.board.cables = old;
    wvRenderChain();
    return wvBoardNote('Refused: in that order a branch would loop back into itself', true);
  }
  wvBoardPost('Main path: Voice → ' + ids.map((id) => wvNodeName(wvNode(id))).join(' → ') + ' → Out');
}

// ─────────────────────────────────────────────────────────────── presets

function wvBoardDirty() {
  if (!WV_BOARDS.dirty) { WV_BOARDS.dirty = true; wvRenderBar(); } else wvBoardCount();
}

/// A preset onto the board: its board in place of this one, and its rows in
/// place of this board's rows, laid into the matrix.
async function wvLoadBoard(i) {
  const L = WV_BOARDS.list;
  if (!L.length) return;
  i = ((i % L.length) + L.length) % L.length;
  const pre = L[i];
  WV.board = wvClone({ name: pre.name, nodes: pre.nodes, cables: pre.cables });
  WV_BOARD_VIEW.sel = null;
  const ok = await wvBoardPost();
  if (!ok) return;
  WV_BOARDS.at = i;
  WV_BOARDS.dirty = false;
  WV_BOARDS.fresh = false;
  const rows = (Array.isArray(pre.mods) ? pre.mods : []).map(wvModIn);
  WV.mods = WV.mods.filter((m) => !m.dst.startsWith('board:')).concat(rows).slice(0, 64);
  wvSendMods();
  wvRenderTargets();
  wvBoardFit();
  wvRenderBar();
  wvBoardNote(`Loaded “${pre.name}”`);
}

const wvBoardRows = () => wvModsOut().filter((m) => m.dst.startsWith('board:'));
function wvUniqBoard(base) {
  let k = 2, n = base;
  while (WV_BOARDS.list.some((b) => b.name === n)) n = `${base} ${k++}`;
  return n;
}

/// Save under `name` (this board's own when left out): kept on the engine
/// with the rows that move it, and the list read again.
async function wvSaveBoard(name) {
  name = (name || WV.board.name || 'Board').trim();
  WV.board.name = name;
  const r = await wvBoardFetch('/api/wave/boards', 'POST', { name, board: wvBoardOut(), mods: wvBoardRows() });
  if (!r.ok) { wvBoardNote(`Not saved: ${(r.json && r.json.error) || 'the engine did not answer'}`, true); return; }
  await wvBoardFetch('/api/wave/board', 'POST', wvBoardOut());
  const l = await wvBoardFetch('/api/wave/boards');
  if (l.ok && Array.isArray(l.json)) WV_BOARDS.list = l.json;
  else {
    const e = { ...wvBoardOut(), mods: wvBoardRows() }, i = WV_BOARDS.list.findIndex((b) => b.name === name);
    if (i >= 0) WV_BOARDS.list[i] = e; else WV_BOARDS.list.push(e);
  }
  WV_BOARDS.at = WV_BOARDS.list.findIndex((b) => b.name === name);
  WV_BOARDS.dirty = false;
  WV_BOARDS.fresh = false;
  wvRenderBar();
  wvBoardNote(`Saved “${name}”`);
}

function wvInitBoardNow() {
  WV.board = wvInitBoard();
  WV_BOARD_VIEW.sel = null;
  wvBoardPost('An empty board: the voice straight to Out').then((ok) => {
    if (!ok) return;
    WV_BOARDS.fresh = true;
    WV_BOARDS.dirty = false;
    WV_BOARDS.at = -1;
    WV.mods = WV.mods.filter((m) => !m.dst.startsWith('board:'));
    wvSendMods();
    wvRenderTargets();
    wvRenderBar();
  });
}

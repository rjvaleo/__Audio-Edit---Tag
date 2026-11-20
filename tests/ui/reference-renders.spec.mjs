// Reference renders of the browser instruments, for their Rust ports to match
// (`WORK DIR/idmlab-move/PLAN.md`, phase 0; the recipe is `REFERENCE-RENDERS.md`
// beside it).
//
// `reference-renders/manifest.json` defines every case in full: the instrument,
// its settings, the notes with their times and velocities, the length, and the
// seed where `Math.random` is drawn. This spec plays each case into an offline
// render of the page's own graph, as `renderFilm` does (`ui/sequencer/bridge.js`),
// and writes one file a case into a folder outside the tree:
//
// - sound: a 32-bit float WAV, the samples as the render gave them;
// - note plans and Chop's measures: JSON.
//
// **Every case is rendered twice, each time in a page of its own, and the two
// must be the same to the last bit.** `index.json` holds each file's SHA-256,
// its peak and its RMS, and the Chromium that made it: a render is only a
// reference for that build, on that kind of machine.
//
// **Chromium does not render one graph one way.** It sums the inputs of a
// node, and takes its first step into a feedback loop, in the order of a hash
// of their addresses, which changes from page to page: three notes into one
// filter differ in the last bit, and the ping-pong delay puts the one render
// quantum a loop costs before the left tap or before the right. So the renders
// here go through `R.ordered`, which fixes both without touching the page's
// code: a junction's inputs are summed in the order they were connected, and
// each loop is opened at one named node. Every file is still a render Chromium
// could have made on its own.
//
// Nothing here checks what an instrument sounds like; the specs beside this one
// do that. The folder is `REFERENCE_RENDERS_OUT`, or `mgl-reference-renders` in
// the system's temporary folder; the last test says where.
//
// **Only when asked, and only for what changed** (RJ, 20 Nov 2026: "run the exact
// sound only on things that have changed, some things should change and get
// better with time"). Skipped unless `REFERENCE_RENDERS` is set: `1` or `all`
// renders every case, a list (`classic,drums`) only those instruments' cases.
// CI sets it when the instruments' code changed (`.github/workflows/ci.yml`),
// and `npm run test:changed` when the map says a change reaches this spec. It
// is about seven minutes of the suite's seventy-two.

import { test, expect } from './test.mjs';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { arch, cpus, platform, release, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const MANIFEST = join(HERE, 'reference-renders', 'manifest.json');
const M = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const OUT = process.env.REFERENCE_RENDERS_OUT || join(tmpdir(), 'mgl-reference-renders');
const ASKED = (process.env.REFERENCE_RENDERS || '').trim();
const ONLY = ASKED && !/^(1|all|yes|true)$/i.test(ASKED) ? new Set(ASKED.split(',').map((x) => x.trim()).filter(Boolean)) : null;
const CASES = M.cases.filter((c) => !ONLY || ONLY.has(c.instrument));
test.skip(!ASKED, 'reference renders run only when asked: REFERENCE_RENDERS=1, or a list of instruments');

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/// `set` laid over `base`: objects key by key, anything else replaced.
function over(base, set) {
  if (set === undefined) return base;
  if (!isObject(base) || !isObject(set)) return set;
  const out = { ...base };
  for (const k of Object.keys(set)) out[k] = over(base[k], set[k]);
  return out;
}

/// A signal from the manifest (`signalLaw` there): a Float32Array a channel.
function makeSignal(def) {
  const { rate, frames, channels } = def;
  const acc = Array.from({ length: channels }, () => new Float64Array(frames));
  for (const p of def.parts) {
    const at = Math.round(p.at * rate);
    if (p.type === 'click') {
      if (at < frames) for (let c = 0; c < channels; c++) acc[c][at] += p.amp[c];
      continue;
    }
    const n = Math.round(p.len * rate);
    let s = (p.seed || 0) >>> 0;
    for (let i = 0; i < n && at + i < frames; i++) {
      let v;
      if (p.type === 'tone') v = Math.sin((2 * Math.PI * p.hz * i) / rate);
      else if (p.type === 'noise') { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; v = s / 2147483648 - 1; }
      else throw new Error(`no such signal part: ${p.type}`);
      const env = p.tau ? Math.exp(-i / (p.tau * rate)) : 1;
      for (let c = 0; c < channels; c++) acc[c][at + i] += p.amp[c] * env * v;
    }
  }
  return acc.map((a) => Float32Array.from(a));
}

const SIGNALS = Object.fromEntries(Object.entries(M.signals).map(([name, def]) => [name, makeSignal(def)]));

/// The samples of a signal as bytes, interleaved, the way a WAV holds them.
function interleaved(chs) {
  const n = chs[0].length, data = Buffer.alloc(n * chs.length * 4);
  for (let i = 0; i < n; i++) for (let c = 0; c < chs.length; c++) data.writeFloatLE(chs[c][i], (i * chs.length + c) * 4);
  return data;
}

/// A 32-bit float WAV around interleaved samples.
function wavFile(data, channels, rate) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(3, 20);          // IEEE float
  h.writeUInt16LE(channels, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * channels * 4, 28);
  h.writeUInt16LE(channels * 4, 32);
  h.writeUInt16LE(32, 34);
  h.write('data', 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

const floats = (data) => {
  const f = new Float32Array(data.length / 4);
  Buffer.from(f.buffer).set(data);
  return f;
};

function levels(data) {
  const f = floats(data);
  let peak = 0, sum = 0, notFinite = 0;
  for (const v of f) {
    if (!Number.isFinite(v)) { notFinite++; continue; }
    if (Math.abs(v) > peak) peak = Math.abs(v);
    sum += v * v;
  }
  return { peak, rms: Math.sqrt(sum / Math.max(1, f.length)), notFinite };
}

/// How two renders that should be one differ.
function differ(a, b) {
  if (a.length !== b.length) return { lengths: [a.length / 4, b.length / 4] };
  const x = floats(a), y = floats(b);
  let samples = 0, most = 0, first = -1;
  for (let i = 0; i < x.length; i++) {
    if (x[i] === y[i]) continue;
    if (first < 0) first = i;
    samples++;
    most = Math.max(most, Math.abs(x[i] - y[i]));
  }
  return { samples, most, first };
}

/// The signals a case names, as the page takes them: base64 a channel.
function signalsFor(c) {
  const names = new Set();
  if (c.input) names.add(c.input);
  for (const e of c.events || []) if (e.signal) names.add(e.signal);
  for (const name of Object.values(c.samples || {})) names.add(name);
  for (const n of (c.bassKit && c.bassKit.notes) || []) names.add(n.signal);
  const out = {};
  for (const name of names) {
    const chs = SIGNALS[name];
    if (!chs) throw new Error(`${c.id} names a signal the manifest does not have: ${name}`);
    out[name] = { rate: M.signals[name].rate, frames: chs[0].length, channels: chs.map((ch) => Buffer.from(ch.buffer, ch.byteOffset, ch.byteLength).toString('base64')) };
  }
  return out;
}

// ------------------------------------------------------------- in the page
//
// These two run in the page (`page.evaluate`), so they stand alone: nothing
// from this file is in reach of them.

/// The sequencer's page: the manifest's state into its controls, a case's
/// events onto an offline render of its graph, a case's call for its plan.
function seqHelpers() {
  'use strict';
  const R = (window.__ref = {});
  R.f32 = (b64) => { const s = atob(b64), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return new Float32Array(u.buffer); };
  R.b64 = (f) => { const u = new Uint8Array(f.buffer, f.byteOffset, f.byteLength); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
  /// A signal as a buffer, with silence after it up to `least` frames.
  R.buffer = (sig, least = 0) => { const b = new AudioBuffer({ length: Math.max(sig.frames, least), sampleRate: sig.rate, numberOfChannels: sig.channels.length }); sig.channels.forEach((c, i) => b.copyToChannel(R.f32(c), i)); return b; };
  /// mulberry32, the manifest's generator.
  R.rng = (seed) => {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  /// `fn`, with Math.random counted, and drawn from the case's seed when it names one.
  R.counted = (C, fn) => {
    const real = Math.random, gen = C.random ? R.rng(C.random.seed) : null;
    let draws = 0;
    Math.random = () => { draws++; return gen ? gen() : real(); };
    try { const value = fn(); return { value, draws }; } finally { Math.random = real; }
  };

  /// One order for `off`'s graph, whatever the addresses of its nodes (see the top of the file).
  ///
  /// - **Sums.** A node's input with more than two sources, or a parameter with more
  ///   than one, gets them through a chain of plain gains, two at a time, in the
  ///   order they were connected: ((a + b) + c) + d. Two inputs add the same either
  ///   way round; a parameter adds its own value first, so it is left one.
  /// - **Loops.** Chromium cuts a feedback loop at whichever of its nodes it reaches
  ///   first: that node's last quantum is what the loop reads. Each loop is reached
  ///   first here at its earliest-connected node that sends sound out of the loop,
  ///   through a merger the destination pulls ahead of everything else.
  ///
  /// `flush()` once the graph is laid, and again after any change while it renders.
  R.ordered = (off) => {
    const nconnect = AudioNode.prototype.connect, ndisconnect = AudioNode.prototype.disconnect;
    const PARAMS = ['frequency', 'detune', 'Q', 'gain', 'delayTime', 'pan', 'offset', 'playbackRate', 'threshold', 'knee', 'ratio', 'attack', 'release'];
    const order = new Map();     // node -> when it was first connected
    const owner = new Map();     // parameter -> its node
    const junctions = [];        // every input and parameter that has had a source
    const byDest = new Map();    // node or parameter -> input -> junction
    const seen = (node) => {
      if (order.has(node)) return;
      order.set(node, order.size);
      for (const k of PARAMS) { const p = node[k]; if (p instanceof AudioParam) owner.set(p, node); }
    };
    // The way out: everything bound for the destination, as stereo, behind the
    // loops' first nodes. A merger pulls its inputs in their order, and hands
    // the left and right on untouched.
    const out = off.createGain(), halves = off.createChannelSplitter(2), first = off.createChannelMerger(3), apart = off.createChannelSplitter(3), last = off.createChannelMerger(2);
    out.channelCount = 2;
    out.channelCountMode = 'explicit';
    nconnect.call(out, halves);
    nconnect.call(halves, first, 0, 1);
    nconnect.call(halves, first, 1, 2);
    nconnect.call(first, apart);
    nconnect.call(apart, last, 1, 0);
    nconnect.call(apart, last, 2, 1);
    nconnect.call(last, off.destination);

    const junction = (dest, input) => {
      if (dest === off.destination) dest = out;
      let m = byDest.get(dest);
      if (!m) byDest.set(dest, (m = new Map()));
      let J = m.get(input);
      if (!J) { J = { dest, input, param: dest instanceof AudioParam, srcs: [], links: [] }; m.set(input, J); junctions.push(J); }
      return J;
    };
    const link = (J, src, output, to, input) => {
      if (to instanceof AudioParam) nconnect.call(src, to, output); else nconnect.call(src, to, output, input);
      J.links.push([src, output, to, input]);
    };
    /// A junction's sources, connected again from nothing, in their order.
    const rebuild = (J) => {
      for (const [src, output, to, input] of J.links) { if (to instanceof AudioParam) ndisconnect.call(src, to, output); else ndisconnect.call(src, to, output, input); }
      J.links = [];
      const s = J.srcs;
      if (s.length <= (J.param ? 1 : 2)) { for (const x of s) link(J, x.node, x.output, J.dest, J.input); return; }
      let acc = off.createGain();
      link(J, s[0].node, s[0].output, acc, 0);
      link(J, s[1].node, s[1].output, acc, 0);
      const folded = J.param ? s.length : s.length - 1;
      for (let i = 2; i < folded; i++) {
        const g = off.createGain();
        link(J, acc, 0, g, 0);
        link(J, s[i].node, s[i].output, g, 0);
        acc = g;
      }
      link(J, acc, 0, J.dest, J.input);
      if (!J.param) link(J, s[s.length - 1].node, s[s.length - 1].output, J.dest, J.input);
    };
    AudioNode.prototype.connect = function (dest, output, input) {
      if (this.context !== off) return nconnect.apply(this, arguments);
      const o = output | 0, J = junction(dest, dest instanceof AudioParam ? 0 : input | 0);
      seen(this);
      if (!J.param) seen(J.dest);
      if (!J.srcs.some((s) => s.node === this && s.output === o)) { J.srcs.push({ node: this, output: o }); rebuild(J); }
      return J.param ? undefined : dest;
    };
    AudioNode.prototype.disconnect = function (a, b, c) {
      if (this.context !== off) return ndisconnect.apply(this, arguments);
      let dest = null, output = null, input = null;
      if (typeof a === 'number') output = a;
      else if (a != null) { dest = a === off.destination ? out : a; if (b != null) output = b; if (c != null) input = c; }
      for (const J of junctions) {
        if ((dest && J.dest !== dest) || (input != null && J.input !== input)) continue;
        const kept = J.srcs.filter((s) => !(s.node === this && (output == null || s.output === output)));
        if (kept.length !== J.srcs.length) { J.srcs = kept; rebuild(J); }
      }
    };

    let entries = [], primer = null;
    const flush = () => {
      // The graph as the page connected it: an edge from each source to the node it feeds.
      const adj = new Map([...order.keys()].map((n) => [n, []]));
      for (const J of junctions) {
        const to = J.param ? owner.get(J.dest) : J.dest;
        if (to && adj.has(to)) for (const s of J.srcs) adj.get(s.node).push(to);
      }
      // Its loops (Tarjan), upstream first.
      const at = new Map(), low = new Map(), on = new Set(), stack = [], loops = [];
      const visit = (v) => {
        at.set(v, at.size); low.set(v, at.get(v)); stack.push(v); on.add(v);
        for (const w of adj.get(v)) {
          if (!at.has(w)) { visit(w); low.set(v, Math.min(low.get(v), low.get(w))); }
          else if (on.has(w)) low.set(v, Math.min(low.get(v), at.get(w)));
        }
        if (low.get(v) !== at.get(v)) return;
        const loop = [];
        let w;
        do { w = stack.pop(); on.delete(w); loop.push(w); } while (w !== v);
        if (loop.length > 1 || adj.get(v).includes(v)) loops.push(loop);
      };
      for (const v of adj.keys()) if (!at.has(v)) visit(v);
      loops.reverse();
      /// Whether a loop's nodes, without `p`, no longer go round.
      const opens = (S, p) => {
        const deg = new Map();
        for (const v of S) if (v !== p) deg.set(v, 0);
        for (const v of deg.keys()) for (const w of adj.get(v)) if (deg.has(w)) deg.set(w, deg.get(w) + 1);
        const free = [...deg.keys()].filter((v) => deg.get(v) === 0);
        let gone = 0;
        while (free.length) { const v = free.pop(); gone++; for (const w of adj.get(v)) if (deg.has(w)) { deg.set(w, deg.get(w) - 1); if (!deg.get(w)) free.push(w); } }
        return gone === deg.size;
      };
      const now = loops.map((loop) => {
        const S = new Set(loop);
        const entry = loop.filter((v) => adj.get(v).some((w) => !S.has(w))).sort((x, y) => order.get(x) - order.get(y)).find((p) => opens(S, p));
        if (!entry) throw new Error(`a feedback loop of ${loop.length} nodes that no one node opens: the order Chromium takes it in cannot be fixed`);
        return entry;
      });
      if (now.length === entries.length && now.every((e, i) => e === entries[i])) return;
      if (now.length > 32) throw new Error('more feedback loops than a merger has inputs');
      if (primer) { ndisconnect.call(primer); for (const e of entries) ndisconnect.call(e, primer); }
      entries = now;
      primer = entries.length ? off.createChannelMerger(entries.length) : null;
      entries.forEach((e, i) => nconnect.call(e, primer, 0, i));
      if (primer) nconnect.call(primer, first, 0, 0);
    };
    const restore = () => { AudioNode.prototype.connect = nconnect; AudioNode.prototype.disconnect = ndisconnect; };
    return { flush, restore, loops: () => entries.slice() };
  };

  const el = (id) => { const e = document.getElementById(id); if (!e) throw new Error(`no control ${id}`); return e; };
  /// A control set, and seen to have taken the value (a slider keeps to its range and step).
  const put = (id, v) => { const e = el(id); e.value = v; if (String(e.value) !== String(v)) throw new Error(`${id} did not take ${JSON.stringify(v)}: it reads ${JSON.stringify(e.value)}`); };
  const onOff = (b) => (b ? 'on' : 'off');
  /// Everything `want` says is what the page's own state says.
  const same = (want, got, path) => {
    if (want !== null && typeof want === 'object') {
      if (Array.isArray(want) && (!got || got.length !== want.length)) throw new Error(`${path} is ${JSON.stringify(got)} on the page; the manifest says ${JSON.stringify(want)}`);
      for (const k of Object.keys(want)) same(want[k], got == null ? undefined : got[k], `${path}.${k}`);
      return;
    }
    if (want !== got) throw new Error(`${path} is ${JSON.stringify(got)} on the page; the manifest says ${JSON.stringify(want)}`);
  };

  /// The case's whole state, into the page and read back from it.
  R.apply = (S, C, signals) => {
    const q = S.seq, c = S.classic, a = S.atmos, b = S.band, d = S.drums, ac = S.accompany, j = S.journey;
    // Seq, and the scale.
    bpm = q.bpm; bpmTarget = q.bpm; stepBeats = q.stepBeats; numSteps = q.numSteps; direction = q.direction;
    if (selectedScaleIdx !== q.scale) selectScale(q.scale);
    same({ name: q.scaleName, cents: q.scaleCents }, SCALES[selectedScaleIdx], 'seq.scale');
    same({ rootHz: q.rootHz }, { rootHz }, 'seq');
    q.steps.forEach((s, i) => { steps[i] = { degree: s.degree, rest: !!s.rest }; });
    // Classic: the values its controls would have set.
    waveType = c.wave; pulseWidth = c.pulseWidth; currentPW = c.pulseWidth;
    adsr = { ...c.adsr }; volume = c.volume;
    filterCutoff = c.filter.cutoff; filterRes = c.filter.q; filterADSR = { ...c.filter.env }; filterADSRamt = c.filter.amount; keyFollow = c.filter.keyFollow;
    c.lfos.forEach((l, i) => Object.assign(lfos[i], { rate: l.rate, depth: l.depth, wave: l.wave, target: l.target, phase: 0 }));
    delaySubdiv = c.delay.subdiv; delayFeedback = c.delay.feedback; delayWet = c.delay.wet; delaySpread = c.delay.spread; delayHiCutFreq = c.delay.hiCut;
    tapeIps = c.tapeIps; tapeGlide = null;
    // Atmosphere and Space.
    const atSelect = { mode: 'atModeSelect', kindA: 'atKindASelect', kindB: 'atKindBSelect', symTune: 'atSymTuneSelect' };
    for (const [k, v] of Object.entries(a)) put(atSelect[k] || `${k}Slider`, v);
    for (const id of ['atTuneScaleSelect', 'atTuneRootSelect', 'atTuneOctSelect']) put(id, 'seq');
    for (const n of [1, 2, 3]) put(`atL${n}TargetSelect`, '');
    atFrozen = false;
    // The Band: its mixer, its instruments, their patches.
    put('bdSwingSlider', b.swing); put('bdArrangeSelect', b.arrangeMode); put('bdPlanText', b.plan ? JSON.stringify(b.plan) : '');
    for (const [ch, v] of Object.entries(b.ch)) {
      put(`mx${ch}LevelSlider`, v.lv); put(`mx${ch}PanSlider`, v.pan); put(`mx${ch}DlySlider`, v.dly); put(`mx${ch}SpcSlider`, v.spc);
      put(`mx${ch}MuteSelect`, onOff(v.mute)); put(`mx${ch}SoloSelect`, onOff(v.solo));
    }
    for (const part of ['bass', 'chord', 'arp', 'drone']) for (const [id] of BD_KNOBS[part]) put(`${id}Slider`, b[part][id]);
    put('apWaveSelect', b.arp.wave); put('chFltSelect', b.chord.flt); put('drFltSelect', b.drone.flt);
    const lines = b.bass.lines;
    put('bsLineText', Object.keys(lines).length === 1 && lines.A != null ? lines.A : JSON.stringify(lines));
    bdBassCur = 'A';
    for (const part of ['chord', 'drone']) {
      for (const k of BD_PATCH_KEYS) put(bdPatchId(part, k), b.patch[part][k]);
      put(bdKindId(part, 'A'), b.patch[part].kindA); put(bdKindId(part, 'B'), b.patch[part].kindB);
    }
    // A signal standing in for a song's own bass notes.
    if (C.bassKit) {
      const notes = C.bassKit.notes.map((n) => ({ p: `reference/bass note ${n.midi}.wav`, midi: n.midi, signal: n.signal }));
      for (const n of notes) DM_BUF.set(n.p, R.buffer(signals[n.signal]));
      DM_MACHINES[C.bassKit.id] = { name: 'Reference', dir: 'reference/', files: {}, own: true, bass: notes.map(({ p, midi }) => ({ p, midi })) };
    }
    put('bsKitText', C.bassKit ? C.bassKit.id : '');
    // The drums. A signal standing in for a kit's sample is there before the kit is asked for.
    for (const [slot, name] of Object.entries(C.samples || {})) { const kit = DM_KITS[d.kit]; DM_BUF.set(kit.dir + kit.files[slot], R.buffer(signals[name])); }
    put('dmKitSelect', d.kit); put('dmRateSelect', d.rate); put('dmSeedSlider', d.seed);
    for (const s of DM_SLOTS) {
      const P = d.slots[s.k];
      for (const [what, v] of [['TuneSlider', P.tune], ['DecSlider', P.dec], ['ToneSlider', P.tone], ['LevelSlider', P.lv], ['PanSlider', P.pan], ['DlySlider', P.dly], ['SpcSlider', P.spc]]) put(dmId(s, what), v);
    }
    DM.cur = 'A';
    put('dmGridText', JSON.stringify({ v: 2, pats: d.pats }));
    // What the parts play, and the Journey.
    put('acFollowSelect', ac.follow);
    for (const p of AC_PARTS) { put(acId(p, 'OnSelect'), onOff(ac.parts[p.k].on)); if (p.pat.length) put(acId(p, 'PatSelect'), ac.parts[p.k].pat); }
    put('jOnSelect', onOff(j.on)); put('jLenSelect', j.bars); put('jWanderSlider', j.wander); put('jEachSlider', j.each); put('jSeedSlider', j.seed);
    j.curve.forEach((v, i) => put(`jC${i + 1}Slider`, v));
    for (const [k] of J_KINDS) put(`jK${k}Select`, onOff(j.kinds[k]));
    // The page reads its controls; what it then holds is what the manifest says.
    atmosRead(); accompanyRead(); bandRead(); drumsRead(); journeyRead();
    same(a, AT, 'atmos');
    const { plan, ...band } = b;
    same(band, BAND, 'band');
    if (!!plan !== !!BAND.plan) throw new Error('the section plan did not reach the Band');
    same({ kit: d.kit, rate: d.rate, seed: d.seed, slots: d.slots }, DM, 'drums');
    same(Object.keys(d.pats).sort(), Object.keys(DM.pats).sort(), 'drums.pats');
    same(ac, AC, 'accompany');
    same(j, J, 'journey');
    // The drawing.
    drawSetState({ v: 1, ...S.draw }, { keep: true });
    same({ bars: S.draw.bars, grain: S.draw.grain, marks: { length: S.draw.marks.length } }, DRAW, 'draw');
  };

  /// A sound case: its events on an offline render of the page's graph.
  R.audio = async (S, C, signals, rate) => {
    R.apply(S, C, signals);
    const off = new OfflineAudioContext(2, Math.round(C.seconds * rate), rate);
    off.createMediaStreamDestination = () => off.createGain();
    const ordered = R.ordered(off);
    try { return await R.render(off, ordered, C, signals, rate); } finally { ordered.restore(); }
  };
  R.render = async (off, ordered, C, signals, rate) => {
    const Real = window.AudioContext;
    window.AudioContext = function () { return off; };
    audioCtx = null;
    try { initAudio(); } finally { window.AudioContext = Real; }
    if (audioCtx !== off) throw new Error('the sequencer did not take the offline context');
    dmOpenHats = [];
    const d = (60 / bpm) * stepBeats;
    let direct = null;
    // What must happen while the render runs waits for it to stop there.
    const later = new Map();
    const at = (t, fn) => { if (t === 0) fn(); else later.set(t, [...(later.get(t) || []), fn]); };
    const lay = (e) => {
      switch (e.type) {
        case 'note':
          if (e.pulseWidth != null) currentPW = e.pulseWidth;
          playNote(e.hz, e.t, e.hold);
          break;
        case 'key':
          at(e.t, () => { const v = kyClassicOn(e.hz, e.vel); noteFilterEnv(e.hz, audioCtx.currentTime, d); v.release(e.release); });
          break;
        case 'tapeGlide':
          bpmTarget = e.bpm;
          tapeGlideDelayTime(e.t);
          break;
        case 'freeze':
          at(e.t, () => { atFrozen = true; atmosFreezeApply(); });
          break;
        case 'buffer': {
          atmosRetuneSympathy();
          const src = off.createBufferSource();
          // The signal, then silence to the end of the render, as one buffer.
          // A source that ends lets Chromium switch off what it fed: 0.21 s
          // after this one ended the whole chain went dead, mid-ring, and
          // when it did depended on how busy the page's main thread was.
          src.buffer = R.buffer(signals[e.signal], Math.ceil((C.seconds - e.t) * signals[e.signal].rate) + 256);
          src.connect(atIn);
          src.start(e.t);
          break;
        }
        case 'atmos': {
          let o = null;
          if (e.into === 'direct') {
            if (!direct) { direct = off.createGain(); direct.connect(off.destination); }
            o = { into: direct };
          }
          if (!atmosPlay(e.hz, e.t, e.dur, o)) throw new Error('Atmosphere played nothing');
          break;
        }
        case 'band':
          bandVoice({ part: e.part, hz: e.hz, dur: e.dur, n: e.n, first: e.first, cut: e.cut }, e.t);
          break;
        case 'drum':
          drumHit(e.slot, e.t, e.vel, bdNodes.slots[e.slot].g);
          break;
        case 'accompany':
          for (let k = e.from; k < e.from + e.count; k++) accompanyAt(k, (k - e.from) * d);
          break;
        case 'draw':
          drawStop();
          for (let k = e.from; k < e.from + e.count; k++) drawAt(k, (k - e.from) * d);
          break;
        default:
          throw new Error(`no such event: ${e.type}`);
      }
    };
    const { draws } = R.counted(C, () => { for (const e of C.events) lay(e); });
    ordered.flush();
    // Which node each loop was opened at, by the page's name for it where it has one.
    const named = new Map([[delayL, 'delayL'], [delayR, 'delayR'], [atRev.frzLp, 'atRev.frzLp'], [atRev.frzD, 'atRev.frzD']]);
    const loops = ordered.loops().map((n) => named.get(n) || n.constructor.name);
    let failed = null;
    for (const [t, fns] of later) {
      off.suspend(t).then(() => {
        try {
          if (off.currentTime !== t) throw new Error(`the render stopped at ${off.currentTime}, not ${t}`);
          for (const fn of fns) fn();
          ordered.flush();
        } catch (err) { failed = failed || err; }
        off.resume();
      });
    }
    const done = off.startRendering();
    // The second render of a case holds the page's main thread while the
    // render runs. Chromium does some of its housekeeping from that thread
    // (switching off nodes whose sources have ended), so a render that
    // leans on when it happens comes out different here, on any machine,
    // and not only on a loaded one.
    if (window.__refBusyMs) { const t0 = performance.now(); while (performance.now() - t0 < window.__refBusyMs) { /* held */ } }
    const buf = await done;
    audioCtx = null;
    if (failed) throw failed;
    const left = buf.getChannelData(0), right = buf.getChannelData(1), x = new Float32Array(left.length * 2);
    for (let i = 0; i < left.length; i++) { x[2 * i] = left[i]; x[2 * i + 1] = right[i]; }
    return { data: R.b64(x), channels: 2, rate, frames: left.length, draws, info: { loopsOpenedAt: loops } };
  };

  /// A note-plan case: its call, as JSON.
  R.json = (S, C) => {
    R.apply(S, C, {});
    const call = C.call, ks = Array.from({ length: call.count || 0 }, (_, i) => call.from + i);
    const { value, draws } = R.counted(C, () => {
      switch (call.type) {
        case 'bandPlan': return ks.map((k) => ({ k, plan: bandPlan(k, k === call.from) }));
        case 'drumPlan': return ks.map((k) => ({ k, hits: drumPlan(k) }));
        case 'drawPlan': drawStop(); return ks.map((k) => ({ k, plan: drawPlan(k, k === call.from) }));
        case 'journey': {
          const moves = {};
          const trip = ks.map((k) => { const w = journeyWhere(k), i = k % numSteps; moves[w.trip] = w.moves; return { k, i, trip: w.trip, a: w.a, step: journeyStep(k, i) }; });
          return { steps: trip, moves };
        }
        case 'clone': {
          for (const k of Object.keys(CL.info)) delete CL.info[k];
          Object.assign(CL.info, C.songs);
          CL.songs = Object.keys(C.songs).map((p) => ({ p, name: p.split('/').pop(), analysed: true }));
          CL.sel = call.sel.slice(); CL.mode = call.mode; CL.seed = call.seed;
          for (const [k, f] of Object.entries(call.facets)) CL.facets[k] = { from: f.from, v: f.v };
          const made = cloneMake(), pats = {};
          for (const l of Object.keys(made.pats)) pats[l] = dmRowsOut(made.pats[l]);
          return { made: { ...made, pats }, plan: CL.plan };
        }
        case 'performance': {
          localStorage.setItem(PERF_KEY, JSON.stringify(call.takes));
          for (const [id, v] of Object.entries(call.controls)) put(id, v);
          perfVariation = call.variation;
          perfGenerate();
          if (!perfLoaded || !perfLoaded.generated) throw new Error('the Performance brain made nothing');
          return { duration: perfLoaded.duration, gestures: perfLoaded.gestures };
        }
        default:
          throw new Error(`no such call: ${call.type}`);
      }
    });
    return { json: JSON.stringify(value), draws };
  };
}

/// The app's page: Chop, with the manifest's signal as the selected sound.
function chopHelpers() {
  'use strict';
  const R = (window.__ref = {});
  R.f32 = (b64) => { const s = atob(b64), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return new Float32Array(u.buffer); };
  R.b64 = (f) => { const u = new Uint8Array(f.buffer, f.byteOffset, f.byteLength); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
  R.chop = async (C, sig) => {
    /// The starting settings, then these.
    const start = (set) => { window.Chop.init(); window.Chop.set(set || {}); };
    const cuts = () => window.Chop.slices.map((x) => [x.s, x.e]);
    start(C.settings);
    window.Chop.loadSamples(sig.channels.map(R.f32), sig.rate, 'reference');
    await window.Chop.analysed();
    if (chop.rate !== sig.rate || chop.len !== sig.frames) throw new Error('Chop did not take the signal');
    for (const [flag, list] of Object.entries(C.flags || {})) {
      for (const i of list) { if (!chop.slices[i]) throw new Error(`no slice ${i} to mark ${flag}`); chop.slices[i][flag] = true; }
    }
    const real = Math.random;
    let draws = 0;
    Math.random = () => { draws++; return real(); };
    try {
      if (C.measure) {
        const plain = (v) => (ArrayBuffer.isView(v) ? Array.from(v) : v);
        const segs = (m) => window.Chop.detectSegs(window.Chop.buildRms(chop.mono), m.topDb, m.minDur, m.pad, chop.rate, chop.len);
        const out = C.measure.map((m) => {
          start(m.set);
          let value;
          if (m.what === 'rms') value = plain(window.Chop.buildRms(chop.mono));
          else if (m.what === 'detectSegs') value = segs(m);
          else if (m.what === 'tailParams') value = segs(m).map(([s, e]) => window.Chop.getTailParams(s, e, m.tailMs, chop.rate));
          else if (m.what === 'onsets') value = chopOnsets();
          else if (m.what === 'cuts') value = cuts();
          else if (m.what === 'tempo') value = { bpm: window.Chop.bpm(), found: window.Chop.findTempo() };
          else if (m.what === 'analyse') { const an = chopAnalyseCore(chop.mono, chop.rate); value = {}; for (const [k, v] of Object.entries(an)) value[k] = plain(v); }
          else throw new Error(`no such measure: ${m.what}`);
          return { ...m, value };
        });
        return { json: JSON.stringify(out), draws };
      }
      const r = C.render, info = { slices: cuts() };
      let out;
      if (r.what === 'slice') out = window.Chop.sliceAudio(r.index);
      else if (r.what === 'preview') { const p = window.Chop.renderPreview(); out = p.chs; info.map = p.map; }
      else if (r.what === 'ratchet') { const p = window.Chop.renderRatchet(); out = p.chs; info.map = p.map; }
      else throw new Error(`no such render: ${r.what}`);
      const n = out[0].length, x = new Float32Array(n * out.length);
      for (let i = 0; i < n; i++) for (let c = 0; c < out.length; c++) x[i * out.length + c] = out[c][i];
      return { data: R.b64(x), channels: out.length, rate: chop.rate, frames: n, info, draws };
    } finally { Math.random = real; }
  };
}

// ------------------------------------------------------------- the renders

async function openSeq(page) {
  await page.goto('/sequencer/');
  await page.waitForFunction(() => document.readyState === 'complete'
    && typeof bandVoice === 'function' && typeof drawAt === 'function' && typeof cloneMake === 'function' && typeof perfGenerate === 'function' && typeof kyClassicOn === 'function'
    && !!document.getElementById('dmKitSelect') && !!document.getElementById('atModeSelect') && !!document.getElementById('jOnSelect') && !!document.getElementById('bdSwingSlider'));
  await page.evaluate(seqHelpers);
}

/// The Chop page, open on the scratch library's first sound, as `chop.spec.mjs` opens it.
async function openChop(page) {
  await page.goto('/');
  await page.waitForFunction(() => typeof state !== 'undefined' && (state.folders || []).length > 0 && !!window.Chop, null, { timeout: 20_000 });
  await page.evaluate(async () => {
    const files = await api(`/api/files?folder=${encodeURIComponent(state.folders[0].name)}`);
    await selectFile(files[0]);
    setEditPage('chop');
    setMode('edit');
  });
  await page.waitForFunction(() => window.Chop.state.slices > 0, null, { timeout: 20_000 });
  await page.evaluate(chopHelpers);
}

/// One render of a case, in `page`, which is new.
async function render(page, c) {
  const signals = signalsFor(c);
  if (c.page === 'chop') {
    await openChop(page);
    return page.evaluate(([c, sig]) => window.__ref.chop(c, sig), [c, signals[c.input]]);
  }
  await openSeq(page);
  const S = over(M.defaults, c.set || {});
  if (c.kind === 'audio') return page.evaluate(([S, c, signals, rate]) => window.__ref.audio(S, c, signals, rate), [S, c, signals, M.rate]);
  return page.evaluate(([S, c]) => window.__ref.json(S, c), [S, c]);
}

const entryPath = (id) => join(OUT, '.entries', `${id}.json`);

test.beforeAll(() => {
  mkdirSync(join(OUT, '.entries'), { recursive: true });
  mkdirSync(join(OUT, 'inputs'), { recursive: true });
  for (const [name, chs] of Object.entries(SIGNALS)) writeFileSync(join(OUT, 'inputs', `${name}.wav`), wavFile(interleaved(chs), chs.length, M.signals[name].rate));
});

for (const c of CASES) {
  test(`${c.instrument}: ${c.id}`, async ({ page, browser }, info) => {
    test.setTimeout(180_000);
    rmSync(entryPath(c.id), { force: true });
    const first = await render(page, c);
    // Again, in a page that has never rendered anything, with its main thread held.
    const context = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: info.project.use.viewport });
    let second;
    try {
      const again = await context.newPage();
      await again.addInitScript(() => { window.__refBusyMs = 600; });
      second = await render(again, c);
    } finally { await context.close(); }

    const entry = { id: c.id, instrument: c.instrument, kind: c.kind, exercises: c.exercises };
    let a, b;
    if (c.kind === 'audio') {
      const x = Buffer.from(first.data, 'base64'), y = Buffer.from(second.data, 'base64');
      a = wavFile(x, first.channels, first.rate);
      b = wavFile(y, second.channels, second.rate);
      Object.assign(entry, { file: `${c.id}.wav`, rate: first.rate, channels: first.channels, frames: first.frames, seconds: first.frames / first.rate }, levels(x));
      if (!x.equals(y)) entry.differs = differ(x, y);
      if (first.info) entry.info = first.info;
    } else {
      a = Buffer.from(first.json, 'utf8');
      b = Buffer.from(second.json, 'utf8');
      entry.file = `${c.id}.json`;
    }
    Object.assign(entry, { bytes: a.length, sha256: sha(a), identical: a.equals(b), randomDraws: first.draws, seed: c.random ? c.random.seed : null });
    writeFileSync(join(OUT, entry.file), a);
    const other = join(OUT, entry.file.replace(/\.(wav|json)$/, '.second.$1'));
    if (entry.identical) rmSync(other, { force: true }); else writeFileSync(other, b);
    writeFileSync(entryPath(c.id), JSON.stringify(entry));

    expect(entry.identical, `two renders of ${c.id} differ: ${JSON.stringify(entry.differs || 'the JSON')}`).toBe(true);
    expect(second.draws, 'the two renders drew Math.random a different number of times').toBe(first.draws);
    if (!c.random) expect(first.draws, `${c.id} drew Math.random and the manifest names no generator for it`).toBe(0);
    if (c.kind === 'audio') {
      expect(entry.notFinite, 'samples that are not numbers').toBe(0);
      expect(entry.peak, `${c.id} is silent`).toBeGreaterThan(1e-5);
    } else {
      expect(first.json.length, `${c.id} wrote nothing`).toBeGreaterThan(2);
    }
  });
}

test('the index: every case rendered twice, the same both times', async ({ browser }) => {
  const missing = CASES.filter((c) => !existsSync(entryPath(c.id))).map((c) => c.id);
  expect(missing, 'cases that were not rendered in this run').toEqual([]);
  const cases = CASES.map((c) => JSON.parse(readFileSync(entryPath(c.id), 'utf8')));
  const inputs = Object.entries(SIGNALS).map(([name, chs]) => {
    const file = `inputs/${name}.wav`;
    return { name, file, rate: M.signals[name].rate, channels: chs.length, frames: chs[0].length, sha256: sha(readFileSync(join(OUT, file))) };
  });
  const playwright = JSON.parse(readFileSync(join(HERE, '..', '..', 'node_modules', '@playwright', 'test', 'package.json'), 'utf8')).version;
  const index = {
    format: 'mgl-reference-renders-index/1',
    made: new Date().toISOString(),
    chromium: browser.version(),
    playwright,
    node: process.version,
    cpu: (cpus()[0] || {}).model || '',
    cores: cpus().length,
    arch: arch(),
    os: `${platform()} ${release()}`,
    manifestSha256: sha(readFileSync(MANIFEST)),
    inputs,
    cases,
  };
  writeFileSync(join(OUT, 'index.json'), JSON.stringify(index, null, 1) + '\n');
  writeFileSync(join(OUT, 'manifest.json'), readFileSync(MANIFEST));
  // Only this run's files stay: a case since renamed or dropped leaves nothing behind.
  const keep = new Set(['index.json', 'manifest.json', 'inputs', '.entries', 'README.md', ...cases.map((e) => e.file)]);
  for (const name of readdirSync(OUT)) if (!keep.has(name) && !/\.second\.(wav|json)$/.test(name)) rmSync(join(OUT, name), { recursive: true, force: true });
  expect(cases.filter((e) => !e.identical).map((e) => e.id), 'cases whose two renders differ').toEqual([]);
  console.log(`reference renders: ${cases.length} cases in ${OUT}`);
});

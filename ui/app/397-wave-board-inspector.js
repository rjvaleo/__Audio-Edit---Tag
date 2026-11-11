// ======================================================= Wave: the board's inspector
//
// v8 (mock-up G). The panel at the right of the FX view: every control of the
// selected node, grouped, with its picture and the sources mapped onto it; or
// a cable's two ends and what it carries; or, with nothing selected, the board
// itself. Then the pictures every node draws of what it does to the sound
// coming in, and the frame that draws them, the cables' signal and the
// inputs' waves from the engine's peaks (`board` in `/api/wave/state`).

const wvBoardPeak = (id) => { const p = WV.tele && WV.tele.board && WV.tele.board[id]; return Array.isArray(p) ? Math.max(0, +p[0] || 0, +p[1] || 0) : 0; };
const WV_X8 = '<svg viewBox="0 0 8 8"><path d="M1.5 1.5 L6.5 6.5 M6.5 1.5 L1.5 6.5"/></svg>';

/// One control in the inspector: a switch, a choice, or a knob.
function wvInspCtl(n, p) {
  const id = `${wvEsc(n.id)}|${p.key}`, tgt = `board:${wvEsc(n.id)}:${p.key}`;
  if (p.toggle || (p.choices && p.choices.length === 2 && p.choices[0] === 'Off')) return `<div class="ic"><span class="wv-ftg wv-btn" data-tg="${id}" data-tgt="${tgt}" title="${wvEsc(p.label)}: click to switch"><i></i></span><div class="it"><span>${wvEsc(p.label)}</span><b data-iv="${p.key}"></b></div></div>`;
  if (p.choices) return `<div class="ic wide"><div class="it"><span>${wvEsc(p.label)}</span></div><div class="wv-seg" data-ch="${id}" data-tgt="${tgt}">${p.choices.map((o, i) => `<span data-ci="${i}">${wvEsc(o)}</span>`).join('')}</div></div>`;
  return `<div class="ic">${wvBoardKnob(n, p, 26)}<div class="it"><span>${wvEsc(p.label)}</span><b data-iv="${p.key}"></b></div></div>`;
}

/// A row for a source mapped onto a board control.
function wvInspModRow(m, lab, board) {
  const i = WV.mods.indexOf(m);
  return `<div class="wv-mr ${board ? 'b' : ''}" style="--c:${wvSrcColour(m.src)}"><span class="wv-badge" style="--c:${wvSrcColour(m.src)}" data-msrc="${m.src}">${wvSrcGlyph(m.src)}${wvSrcLab(m.src)}</span><span class="mt" ${board ? `data-mnode="${wvEsc(m.dst.split(':')[1])}"` : ''}>${wvEsc(lab)}</span>${board ? '' : `<div class="wv-well ma" data-ma="${i}" title="Amount: drag up and down"><i></i></div>`}<b data-mv="${i}" title="Amount: drag up and down, double-click to flip" style="cursor:ns-resize"></b><span class="wv-ib x" data-mx="${i}" title="Remove this mapping">${WV_X8}</span></div>`;
}

function wvInspMods(n) {
  const ms = wvNodeMods(n.id), lab = (m) => { const p = wvParamOf(n, m.dst.split(':')[2]); return wvFitLab(p ? p.label : m.dst.split(':')[2], 70, `500 10px ${wvCl().sans}`); };
  return `<div class="ig"><div class="igh">MAPPED SOURCES</div>${ms.length ? ms.map((m) => wvInspModRow(m, lab(m))).join('') : '<div class="wv-hint">None yet: drag a source from the strip onto any control, here or on the node</div>'}</div>`;
}

const wvInspHead = (cc, name, sub, right = '', extra = '') => `<div class="wv-mh" style="--cc:${cc}"><i class="ce"></i><span class="wv-nm">${wvEsc(name)}</span><span class="wv-sp"></span>${extra}</div><div class="sub" style="--cc:${cc}">${wvEsc(sub)}<span class="wv-hint">${wvEsc(right)}</span></div>`;
const wvInspRow = (n, right = '') => `<div class="irow" data-sel="${wvEsc(n.id)}" style="--cc:${wvNodeCol(n)}"><i></i>${wvEsc(wvNodeName(n))}<span class="wv-ro">${wvEsc(right)}</span></div>`;
const wvInspPic = '<div class="wv-well"><canvas data-ip="1" data-w="240" data-h="84"></canvas></div>';

function wvInspFx(n) {
  const sp = wvNodeSpec(n), face = WV_FX_FACE[n.kind], F = wvFxOf(n), snd = F && F.sound;
  let gs = (face ? face[1] : []).map(([l, ks]) => [l, ks.map((k) => sp.find((p) => p.key === k)).filter(Boolean)]).filter((g) => g[1].length);
  if (!gs.length && sp.length) gs = [['Settings', sp]];
  const seen = new Set(gs.flatMap((g) => g[1].map((p) => p.key))), rest = sp.filter((p) => !seen.has(p.key));
  if (rest.length) gs.push(['More', rest]);
  return wvInspHead(wvCatCol(wvNodeCat(n), 64), wvNodeName(n).toUpperCase(), `${wvNodeCat(n).toUpperCase()} · ${wvNodeMaker(n)}`, `${sp.length} control${sp.length === 1 ? '' : 's'}`, `<span class="wv-pw wv-btn ${n.on ? 'on' : ''}" data-ipw title="Power: off passes the sound through untouched">${WV_PWR}</span>`)
    + wvInspPic + `<div class="iscroll wv-scroll">${snd ? `<div class="ig"><div class="igh">${wvEsc(snd.label.toUpperCase())}</div><div class="isnd ${wvSoundState(n)}"><span class="nm" title="${wvEsc(n.sound || '')}">${wvEsc(wvSoundText(n))}</span><span class="wv-bt wv-btn" data-snd="${wvEsc(n.id)}" title="${wvEsc(snd.label)}: pick a sound from the library">Pick…</span></div></div>` : ''}`
    + gs.map(([l, ps]) => `<div class="ig"><div class="igh">${wvEsc(l.toUpperCase())}</div><div class="igrid">${ps.map((p) => wvInspCtl(n, p)).join('')}</div></div>`).join('')
    + (sp.length ? '' : `<div class="wv-hint">${wvEsc(wvNodeName(n))} has no settings: ${n.kind === 'fx:invert' ? 'it flips the wave upside down' : 'it swaps left and right'}.</div>`)
    + wvInspMods(n) + '</div><div class="ifoot"><span class="wv-bt wv-btn" data-idel title="Remove this node and its cables">Remove</span><span class="wv-bt wv-btn" data-irst title="Every control back to its default">Defaults</span><span class="wv-sp"></span><span class="wv-hint">Delete removes it too</span></div>';
}

function wvInspRouting(n) {
  const sp = wvNodeSpec(n), feeds = WV.board.cables.filter((c) => c.from[0] === n.id).map((c) => wvNode(c.to[0])).filter(Boolean), k = wvPortCount(n);
  const ctl = n.kind === 'split' ? `<div class="ic wide"><div class="it"><span>Outs</span></div><div class="wv-seg" data-isn>${[2, 3].map((x) => `<span class="${k === x ? 'on' : ''}" data-k="${x}">${x} outs</span>`).join('')}</div></div>`
    : n.kind === 'mix' ? `<div class="ic wide"><div class="it"><span>Inputs</span></div><div class="wv-seg" data-imn>${[2, 3, 4].map((x) => `<span class="${k === x ? 'on' : ''}" data-k="${x}">${x} ins</span>`).join('')}</div></div>` : '';
  const R = WV_ROUTING[n.kind] || { n: n.kind, tip: ': ' }, about = R.tip.split(': ')[1].split('.')[0];
  return wvInspHead('var(--wv-t2)', wvNodeName(n).toUpperCase(), n.kind === 'wave:drive' ? 'THE OLD CHAIN\'S DRIVE' : 'ROUTING', about) + wvInspPic
    + `<div class="iscroll wv-scroll"><div class="ig"><div class="igh">CONTROLS</div><div class="igrid">${ctl}${sp.map((p) => wvInspCtl(n, p)).join('')}</div></div>`
    + (n.kind === 'drywet' ? '<div class="wv-hint">Send feeds the branch; patch the branch\'s end into Return. Wet sets how much of it you hear over the dry sound.</div>' : '')
    + `<div class="ig"><div class="igh">FEEDS</div><div class="ilist">${feeds.length ? feeds.map((x) => wvInspRow(x)).join('') : '<div class="wv-hint">Nothing yet: drag from an out</div>'}</div></div>${sp.length ? wvInspMods(n) : ''}</div>`
    + '<div class="ifoot"><span class="wv-bt wv-btn" data-idel>Remove</span><span class="wv-sp"></span><span class="wv-hint">Delete removes it too</span></div>';
}

function wvInspIO(n) {
  const out = n.kind === 'out', I = WV_IN[n.kind], on = n.on !== false, live = out || (on && wvInputLive(n.kind));
  const list = out ? WV.board.cables.filter((c) => c.to[0] === n.id).map((c) => wvNode(c.from[0])) : WV.board.cables.filter((c) => c.from[0] === n.id).map((c) => wvNode(c.to[0]));
  const why = out ? 'Everything patched in here is summed and goes on to the synth\'s master.' : `${I.d}.${!wvInputLive(n.kind) ? ' It is off on Play, so nothing comes out.' : !on ? ' Its send is off.' : ''}`;
  return wvInspHead(out ? 'var(--wv-acc)' : I.c, out ? 'OUT' : I.n.toUpperCase(), out ? 'OUTPUT' : 'INPUT', out ? 'to the master' : live ? 'stereo' : 'off', out ? '' : `<span class="wv-pw wv-btn ${on ? 'on' : ''}" data-ipw title="${I.n}: on or off">${WV_PWR}</span>`) + wvInspPic
    + `<div class="iscroll wv-scroll"><div class="wv-hint">${wvEsc(why)}</div>${out ? '' : `<div class="ig"><div class="igh">SEND</div><div class="igrid">${wvNodeSpec(n).map((p) => wvInspCtl(n, p)).join('')}</div></div>`}`
    + `<div class="ig"><div class="igh">${out ? 'FED BY' : 'FEEDS'}</div><div class="ilist">${list.filter(Boolean).length ? list.filter(Boolean).map((x) => wvInspRow(x)).join('') : `<div class="wv-hint">${out ? 'Nothing: the board is silent' : 'Nothing yet: drag from its out'}</div>`}</div></div></div>`;
}

function wvInspCable(c) {
  const A = wvNode(c.from[0]), B = wvNode(c.to[0]), o = [...wvOrigins(c.from[0], c.from[1], new Map())];
  return wvInspHead(wvOriginCol(new Set(o)) || 'var(--wv-t3)', 'CABLE', 'PATCH', o.length ? 'carries sound' : 'silent')
    + `<div class="iscroll wv-scroll"><div class="ilist">${wvInspRow(A, wvPortName(A, c.from[1]))}${wvInspRow(B, wvPortName(B, c.to[1]))}</div><div class="ig"><div class="igh">CARRIES</div><div class="ilist">${o.length ? o.map((s) => `<div class="irow" style="--cc:${WV_IN[s].c}"><i></i>${WV_IN[s].n}</div>`).join('') : '<div class="wv-hint">Nothing: no live input reaches it</div>'}</div></div></div>`
    + '<div class="ifoot"><span class="wv-bt wv-btn" data-cdel>Remove</span><span class="wv-sp"></span><span class="wv-hint">Delete removes it too</span></div>';
}

function wvInspBoard() {
  const ns = WV.board.nodes.filter((n) => !wvIsIO(n)), P = wvMainPath(), rows = WV.mods.filter((m) => m.dst.startsWith('board:'));
  const lab = (m) => { const full = wvBoardDstName(m.dst); return wvTextW(full, `500 10px ${wvCl().sans}`) <= 118 ? full : wvFitLab(full, 118, `500 10px ${wvCl().sans}`); };
  return wvInspHead('var(--wv-acc)', 'MASTER BUS', WV.board.name.toUpperCase(), `${ns.length} nodes · ${WV.board.cables.length} cables`)
    + `<div class="iscroll wv-scroll"><div class="wv-hint">The synth's master bus. The main path runs Voice → ${P.ok ? P.st.slice(1, -1).length + ' nodes' : '…'} → Out; the oscillators, sub and noise come in as sends before the filters.</div>`
    + '<div class="ig"><div class="igh">HOW IT PATCHES</div><div class="ihow"><b>Add</b><span>right-click the grid, drag from the list, or double-click</span><b>Patch</b><span>drag from an out (right) to an in (left)</span><b>Sum</b><span>one out feeds many ins; cables into one in add up</span><b>Reorder</b><span>drag in Main path, or drop a node on a cable; ⌥-drag lifts it out</span><b>Remove</b><span>right-click, or select and press Delete</span><b>Modulate</b><span>drag a source from the strip onto any control</span><b>Boards</b><span>a board is the whole patch; Save keeps it</span></div></div>'
    + `<div class="ig"><div class="igh">MAPPED SOURCES</div>${rows.length ? rows.map((m) => wvInspModRow(m, lab(m), true)).join('') : '<div class="wv-hint">None yet</div>'}</div>`
    + `<div class="ig"><div class="igh">NODES</div><div class="ilist">${ns.map((n) => wvInspRow(n, wvIsFx(n) ? wvCatName(wvNodeCat(n)) : 'Routing')).join('')}</div></div></div>`;
}

function wvRenderInspector() {
  const el = $('wvFinsp');
  if (!el || !WV.board) return;
  const s = WV_BOARD_VIEW.sel, n = s && s.t === 'node' ? wvNode(s.id) : null;
  if (s && s.t === 'node' && !n) WV_BOARD_VIEW.sel = null;
  const c = s && s.t === 'cab' ? WV.board.cables[s.i] : null;
  el.innerHTML = n ? (wvIsIO(n) ? wvInspIO(n) : wvIsFx(n) ? wvInspFx(n) : wvInspRouting(n)) : c ? wvInspCable(c) : wvInspBoard();
  WV_BOARD_CV.insp = { pic: null, knobs: [] };
  el.querySelectorAll('canvas[data-w]').forEach((cv) => { const g = wvCv(cv); if (cv.dataset.ip) WV_BOARD_CV.insp.pic = g; else WV_BOARD_CV.insp.knobs.push(g); });
  wvWireBoardKnobs(el);
  el.querySelectorAll('.ic .it span').forEach((sp) => { if (sp.scrollWidth > sp.clientWidth + 0.5) sp.closest('.ic').classList.add('wide'); });
  el.querySelector('[data-ipw]')?.addEventListener('click', () => { wvBoardParam(n.id, 'on', n.on === false, false); wvRenderBoard(); });
  el.querySelector('[data-idel]')?.addEventListener('click', wvBoardDelete);
  el.querySelectorAll('[data-snd]').forEach((b) => b.addEventListener('click', () => wvSoundMenu(b, b.dataset.snd)));
  el.querySelector('[data-cdel]')?.addEventListener('click', wvBoardDelete);
  el.querySelector('[data-irst]')?.addEventListener('click', () => {
    for (const p of wvNodeSpec(n)) n.params[p.key] = p.default;
    wvBoardPost(`${wvNodeName(n)}: every control back to its default`);
  });
  el.querySelectorAll('[data-isn] span, [data-imn] span').forEach((b) => b.addEventListener('click', () => wvSetPorts(n, +b.dataset.k)));
  el.querySelectorAll('[data-tg]').forEach((b) => b.addEventListener('click', () => {
    const [nid, key] = b.dataset.tg.split('|'), x = wvNode(nid), p = wvParamOf(x, key);
    wvBoardParam(nid, key, wvPVal(x, p) >= p.min + 0.5 ? p.min : p.min + 1, false);
  }));
  el.querySelectorAll('[data-ch] span').forEach((b) => b.addEventListener('click', () => {
    const [nid, key] = b.parentElement.dataset.ch.split('|'), p = wvParamOf(wvNode(nid), key);
    wvBoardParam(nid, key, p.min + +b.dataset.ci, false);
  }));
  el.querySelectorAll('[data-ma], [data-mv]').forEach((b) => {
    const m = WV.mods[+(b.dataset.ma ?? b.dataset.mv)];
    wvDrag(b, (dx, dy) => { m.amt = wvClamp(m.amt + (dx - dy) / 150, -1, 1); WV.modsDirty = true; });
    b.addEventListener('dblclick', () => { m.amt = -m.amt; wvSendMods(); });
  });
  el.querySelectorAll('[data-mx]').forEach((b) => b.addEventListener('click', () => { WV.mods.splice(+b.dataset.mx, 1); wvSendMods(); wvRenderTargets(); wvBoardCount(); }));
  el.querySelectorAll('[data-msrc]').forEach((b) => {
    b.addEventListener('mouseenter', () => wvHlBoardSrc(b.dataset.msrc, true));
    b.addEventListener('mouseleave', () => wvHlBoardSrc(b.dataset.msrc, false));
  });
  el.querySelectorAll('[data-sel]').forEach((r) => r.addEventListener('click', () => wvBoardSelect({ t: 'node', id: r.dataset.sel })));
  el.querySelectorAll('[data-mnode]').forEach((r) => { r.style.cursor = 'pointer'; r.addEventListener('click', () => wvBoardSelect({ t: 'node', id: r.dataset.mnode })); });
}

/// v8b: the sound picker of a Convolution or Spectral Dynamics node: the
/// library's folders and each one's files, as the rack's picker offers them,
/// and None.
async function wvSoundMenu(anchor, nid) {
  const n = wvNode(nid), F = n && wvFxOf(n);
  if (!F || !F.sound) return;
  const m = wvMenuFor('snd' + nid);
  if (!m) return;
  m.className = 'wv-menu wv-sndm';
  const cur = n.sound || '', folders = (state.folders || []).map((f) => f.name);
  m.innerHTML = `<div class="sh"><b>${wvEsc(F.sound.label.toUpperCase())}</b><select aria-label="Folder">${folders.map((f) => `<option ${cur.startsWith(f + '/') ? 'selected' : ''}>${wvEsc(f)}</option>`).join('')}</select></div>`
    + `<div class="sl wv-scroll"></div><div class="sn ${cur ? '' : 'on'}" data-sv="">None: ${wvEsc(wvSoundAlone(n))}</div>`;
  const sel = m.querySelector('select'), list = m.querySelector('.sl');
  const wire = (x) => x.addEventListener('click', () => { wvCloseMenus(); wvBoardSound(nid, x.dataset.sv || null); });
  const fill = async () => {
    list.innerHTML = '<span class="wv-hint">Reading the folder…</span>';
    const r = sel.value ? await wvBoardFetch(`/api/files?folder=${encodeURIComponent(sel.value)}`) : { ok: false };
    const fs = r.ok && Array.isArray(r.json) ? r.json.filter((f) => f && f.path) : [];
    list.innerHTML = fs.length ? fs.map((f) => `<div class="${f.path === cur ? 'on' : ''}" data-sv="${wvEsc(f.path)}" title="${wvEsc(f.path)}">${wvEsc(f.filename || f.path.split('/').pop())}</div>`).join('') : '<span class="wv-hint">No sounds here</span>';
    list.querySelectorAll('[data-sv]').forEach(wire);
  };
  wire(m.querySelector('.sn'));
  sel.addEventListener('change', fill);
  wvPlaceMenu(m, anchor, 0);
  await fill();
  if (WV_MENU.owner === 'snd' + nid) wvPlaceMenu(m, anchor, 0);
}

// ─────────────────────────────────────────────────────────────── pictures

const WV_SINE = new Float32Array(WV_NP).map((_, n) => Math.sin(WV_TAU * n / WV_NP));
const WV_NWAVE = { waves: new Map(), specs: new Map(), noise: null, nt: 0 };

/// The wave an input sends, drawn as one cycle.
function wvInputWave(kind, t) {
  const W = WV_NWAVE;
  if (W.waves.has(kind)) return W.waves.get(kind);
  let f;
  const osc = { 'in:osc0': 0, 'in:osc1': 1, 'in:osc2': 2 }[kind];
  if (osc != null) f = wvWaveFor(osc);
  else if (kind === 'in:sub') f = WV_SINE.map((_, n) => { const x = n / WV_NP; return wvG('sub.shape') === 1 ? (x < 0.25 ? 4 * x : x < 0.75 ? 2 - 4 * x : 4 * x - 4) : wvG('sub.shape') === 2 ? (x < 0.5 ? 0.8 : -0.8) : Math.sin(WV_TAU * x); });
  else if (kind === 'in:noise') { if (!W.noise || t - W.nt > 0.12) { W.noise = new Float32Array(WV_NP).map(() => Math.random() * 2 - 1); W.nt = t; } f = W.noise; }
  else {
    // The voice: A and B, through Filter 1 as a running average.
    const a = wvWaveFor(0), b = wvWaveFor(1), k = Math.round(2 + (1 - wvClamp(wvG('filt0.cut'))) * 16);
    f = new Float32Array(WV_NP);
    for (let n = 0; n < WV_NP; n++) { let v = 0; for (let j = 0; j < k; j++) { const q = (n - j + WV_NP) % WV_NP; v += a[q] * 0.6 + b[q] * 0.4; } f[n] = v / k; }
    wvNorm(f);
  }
  W.waves.set(kind, f);
  return f;
}
function wvWaveSpec(wv) {
  if (WV_NWAVE.specs.has(wv)) return WV_NWAVE.specs.get(wv);
  const m = wvMags(wvSpectrum(wv, 32));
  WV_NWAVE.specs.set(wv, m);
  return m;
}

/// An effect's family: how its picture is drawn.
function wvFxFamily(n) {
  if (n.kind === 'wave:drive') return 'drive';
  const f = wvFxOf(n), l = f ? f.label : n.kind, c = wvNodeCat(n);
  if (/Low Pass|Damping|Chamberlin/.test(l)) return 'lp';
  if (/High Pass|^DC$/.test(l)) return 'hp';
  if (/Regalia/.test(l)) return 'bell';
  if (/Band Pass|resonator|Rappify/.test(l)) return 'bp';
  if (/Band Reject|notch/.test(l)) return 'notch';
  if (/Comb Filter/.test(l)) return 'comb';
  if (l === 'EQ') return 'eq';
  if (/filter bank/.test(l)) return 'bank';
  if (/Gate/.test(l)) return 'gate';
  if (c === 'dynamics') return 'comp';
  if (l === 'Hyperprism Doppler') return 'room';
  if (l === 'Swap') return 'swap';
  if (c === 'stereo') return 'field';
  if (c === 'delay') return 'taps';
  if (l === 'Convolution') return 'conv';
  if (c === 'reverb') return 'tail';
  if (/Chorus|chorus/.test(l)) return 'chorus';
  if (/Flanger|flanger|Phaser|phasor/.test(l)) return 'phaser';
  if (/Tremolo/.test(l)) return 'trem';
  if (/Ring/.test(l)) return 'ring';
  if (c === 'modulation') return 'vib';
  if (c === 'pitch') return 'pitch';
  if (/chebyshev/.test(l)) return 'cheby';
  if (c === 'distortion') return 'crush';
  if (c === 'spectral') return 'spec';
  if (c === 'granular') return 'grains';
  if (/PN noise/.test(l)) return 'noise';
  if (l === 'Invert') return 'invert';
  return 'gain';
}

/// An effect's picture: what it does to the sound coming in, from its own
/// controls, in its category's colour.
function wvDrawFxPic(g, n, t, memo) {
  const { c, w, h } = g, cat = wvNodeCat(n), cl = wvCl(), C = { ...cl, wave: `rgb(${wvCatRGB(cat, 82)})`, bloom: wvCatRGB(cat) };
  const o = wvInOrigins(n, memo), wv = o.size ? wvInputWave([...o][0], t) : WV_SINE, sp = wvNodeSpec(n), big = w > 200;
  c.clearRect(0, 0, w, h);
  const bg = c.createRadialGradient(w * 0.3, 0, 4, w * 0.5, h * 0.6, w * 0.8);
  bg.addColorStop(0, wvCatCol(cat, 40, 0.22));
  bg.addColorStop(1, wvCatCol(cat, 30, 0));
  c.fillStyle = bg;
  c.fillRect(0, 0, w, h);
  const F = (...rs) => { for (const re of rs) { const p = sp.find((q) => (typeof re === 'string' ? q.key === re : re.test(q.key))); if (p) { const v = wvPVal(n, p); return { v, u: wvPN(p, v), p }; } } return null; };
  const X = (u) => 4 + u * (w - 8), mid = h / 2, A = h * 0.36, inn = (u) => wvRd(wv, u * 2), T = (p, lw = 1.3, gl = 0.7) => wvTrace(c, p, C, lw, gl);
  const Uf = (p, base, top = 4, a = 0.16) => wvUnder(c, p, X(0), X(1), base, top, C, a);
  const ghost = (fn) => { c.strokeStyle = `rgba(${C.bloom},.24)`; c.lineWidth = 1; c.stroke(wvPath((u) => [X(u), mid - fn(u) * A], big ? 200 : 110)); };
  const wave = (fn, lw) => { const p = wvPath((u) => [X(u), mid - fn(u) * A], big ? 240 : 130); Uf(p, mid, 4, 0.1); T(p, lw); };
  const live = wvVoices().length > 0 || wvBoardPeak(n.id) > 0.001, fu = (hz) => wvClamp(Math.log(Math.max(20, hz) / 20) / Math.log(1000));
  const resp = (fn, lo = -36, hi = 18) => {
    const dbY = (d) => wvClamp(4 + (hi - d) / (hi - lo) * (h - 8), 2, h - 2), m = wvWaveSpec(wv);
    for (let k = 0; k < 32; k++) {
      const u = fu(110 * (k + 1));
      if (u >= 1) break;
      const a = m[k];
      if (a < 0.004) continue;
      const hh = wvClamp((20 * Math.log10(a) + fn(u) + 48) / 48) * (h - 8) * 0.8;
      c.fillStyle = `rgba(${C.bloom},.42)`;
      c.fillRect(X(u) - 1, h - 4 - hh, big ? 2 : 1.5, hh);
    }
    c.strokeStyle = 'rgba(255,255,255,.07)';
    c.beginPath(); c.moveTo(X(0), dbY(0)); c.lineTo(X(1), dbY(0)); c.stroke();
    const p = wvPath((u) => [X(u), dbY(fn(u))], big ? 160 : 90);
    Uf(p, h, 4, 0.14);
    T(p, 1.4);
  };
  const fam = wvFxFamily(n);
  switch (fam) {
    case 'lp': case 'hp': case 'bp': case 'notch': case 'bell': {
      const fr = F(/freq|hz$|cutoff|frequency/i), q = F(/^q$|lowQ|resonance/i), bw = F(/bandwidth/i), gn = F(/gainDb/), f0 = fu(fr ? fr.v : 1000);
      const Q = q ? 0.6 + q.u * 9 : bw ? 0.6 + (1 - bw.u) * 8 : 1.4;
      resp((u) => {
        const r = Math.pow(1000, u - f0), peak = q ? q.u * 14 * Math.exp(-(((u - f0) / 0.035) ** 2)) : 0;
        if (fam === 'lp') return -10 * Math.log10(1 + r ** 4) + peak;
        if (fam === 'hp') return -10 * Math.log10(1 + r ** -4) + peak;
        if (fam === 'bell') return (gn ? gn.v : 9) * Math.exp(-(((u - f0) * Q * 3) ** 2));
        const b = -10 * Math.log10(1 + ((r - 1 / r) * Q) ** 2);
        return fam === 'bp' ? b : Math.max(-36, -10 * Math.log10(1 + 1 / (((r - 1 / r) * Q) ** 2 + 1e-4)));
      });
      break;
    }
    case 'eq': {
      const B6 = [1, 2, 3, 4, 5, 6].map((i) => [F(`band.${i}.freq`), F(`band.${i}.gainDb`), F(`band.${i}.q`)]), hp = F('band.0.freq');
      resp((u) => {
        let d = 0;
        B6.forEach(([f, g, q], i) => {
          if (!f || !g) return;
          const x = u - fu(f.v);
          d += i === 0 ? g.v / (1 + Math.exp(x * 30)) : i === 5 ? g.v / (1 + Math.exp(-x * 30)) : g.v * Math.exp(-((x * (1 + (q ? q.v : 0.7)) * 3) ** 2));
        });
        return hp && F('band.0.enabled')?.v ? d - 10 * Math.log10(1 + Math.pow(1000, u - fu(hp.v)) ** -4) : d;
      }, -24, 24);
      break;
    }
    case 'bank': {
      const nt = F('notchHz'), rs = F('resonatorHz'), rg = F('regaliaHz'), dm = F('dampingHz');
      resp((u) => { const a = u - fu(nt ? nt.v : 500), b = u - fu(rs ? rs.v : 2000), r = Math.pow(1000, u - fu(dm ? dm.v : 8000)); return -24 * Math.exp(-((a / 0.03) ** 2)) + 12 * Math.exp(-((b / 0.04) ** 2)) + (rg ? 6 * Math.exp(-(((u - fu(rg.v)) / 0.06) ** 2)) : 0) - 10 * Math.log10(1 + r ** 2); });
      break;
    }
    case 'comb': {
      const d = F(/delay/), dp = F(/depth/), fb = F(/feedback/), k = 2 + (d ? d.u : 0.5) * 14, a = dp ? dp.u : 0.6;
      const p = wvPath((u) => [X(u), mid + 4 - (0.5 + 0.5 * Math.cos(WV_TAU * u * k)) * a * A * 2 + A * (a - 0.5)], big ? 240 : 140);
      Uf(p, h, 4, 0.15);
      T(p, 1.4);
      if (fb && fb.u > 0.05) { c.strokeStyle = `rgba(${C.bloom},.25)`; c.stroke(wvPath((u) => [X(u), mid + 4 - Math.pow(0.5 + 0.5 * Math.cos(WV_TAU * u * k), 1 + fb.u * 6) * A * 2 + A * 0.4], 140)); }
      break;
    }
    case 'comp': case 'gate': {
      const th = F(/thresh/i), ra = F(/^ratio/), am = F(/^amount/), ce = F(/ceiling/), cp = F(/compressionDb/), dp = F(/^depth/);
      let Tt = th ? th.v : -18, R = ra ? ra.v : 4, gain = 0;
      const ceil = ce ? ce.v : 0;
      if (cp) { Tt = cp.v * 0.5; R = 1 + Math.abs(cp.v) / 12; }
      if (am && !ra) { R = 1 + am.u * 10; Tt = -6 - am.u * 24; gain = am.u * 8; }
      const tf = (x) => (fam === 'gate' ? (x < Tt ? Tt + (x - Tt) * (1 + (dp ? dp.u : 1) * 3) : x) : Math.min(ceil, (x < Tt ? x : Tt + (x - Tt) / R) + gain));
      const Xd = (d) => X(wvClamp((d + 60) / 60)), Yd = (d) => h - 4 - wvClamp((d + 60) / 60) * (h - 8);
      c.strokeStyle = 'rgba(255,255,255,.08)';
      c.setLineDash([2, 3]);
      c.beginPath(); c.moveTo(Xd(-60), Yd(-60)); c.lineTo(Xd(0), Yd(0)); c.stroke();
      c.setLineDash([]);
      const p = wvPath((u) => { const x = -60 + u * 60; return [Xd(x), Yd(tf(x))]; }, 80);
      Uf(p, h, 4, 0.14);
      T(p, 1.5);
      c.fillStyle = `rgba(${C.bloom},.5)`;
      c.fillRect(Xd(Tt) - 0.5, 4, 1, h - 8);
      const lv = -36 + 28 * (0.5 + 0.5 * Math.sin(t * 2.6)) * (live ? 1 : 0.6);
      wvDot(c, Xd(lv), Yd(tf(lv)), big ? 3.5 : 2.5, C.wave);
      break;
    }
    case 'taps': {
      const d = F(/delay|throw|distance|^time/i), fl = F(/flipS/), fb = F(/feedback/), mx = F(/^mix$|^wet$/), d2 = F('delay2Ms');
      const lab = (wvFxOf(n) || {}).label || '', dms = fl ? fl.v * 1000 : d ? d.v : 300, span = Math.max(dms * 4.2, lab === 'Doubler' ? 120 : 900), rev = /Boomerang|flipper/.test(lab);
      const fa = fb ? Math.min(0.95, Math.abs(fb.v) / (fb.p.max > 1.5 ? 100 : 1)) : 0.4, ma = mx ? mx.u : 0.6;
      c.fillStyle = 'rgba(255,255,255,.16)';
      c.fillRect(X(0), 8, 1.5, h - 12);
      c.fillStyle = `rgba(${C.bloom},.12)`;
      c.fillRect(X((t * 1000 % span) / span), 3, 1, h - 6);
      const train = (dt, a0, col) => {
        for (let k = 1; k < 12; k++) {
          const x = k * dt / span;
          if (x > 1) break;
          const hh = a0 * Math.pow(fa, k - 1) * (h - 10);
          if (hh < 1) break;
          if (rev) { const p = new Path2D(); p.moveTo(X(x) - Math.min(18, dt / span * (w - 8) * 0.8), h - 4); p.lineTo(X(x), h - 4 - hh); p.lineTo(X(x), h - 4); p.closePath(); c.fillStyle = col.replace('rgb(', 'rgba(').replace(')', ',.35)'); c.fill(p); }
          c.strokeStyle = col;
          c.lineWidth = big ? 2 : 1.6;
          c.shadowBlur = 8;
          c.shadowColor = col;
          c.beginPath(); c.moveTo(X(x), h - 4); c.lineTo(X(x), h - 4 - hh); c.stroke();
          c.shadowBlur = 0;
        }
      };
      train(dms, 0.4 + 0.6 * ma, `rgb(${wvCatRGB(cat, 80)})`);
      if (d2) train(d2.v, 0.3 + 0.5 * ma, `rgb(${wvCatRGB(cat, 64)})`);
      break;
    }
    case 'tail': case 'conv': {
      const pre = F(/predelay/i), len = F('reverbTimeS', 'decay', 'lengthMs', 'feedback', 'size', 'delayMs'), df = F(/diffusion/i), wt = F(/^mix$|^wet$/), dm = F(/damp|rolloff|brightness|HiCut/i);
      const p0 = pre ? pre.u * 0.22 : 0.02, tau = 0.05 + (len ? len.u : 0.5) * 0.42, den = df ? 0.4 + 0.6 * df.u : 0.8, a0 = wt ? 0.35 + 0.65 * wt.u : 0.8, N = big ? 120 : 64, fr = Math.floor(t * 9);
      c.fillStyle = 'rgba(255,255,255,.22)';
      c.fillRect(X(0), 6, 1.5, h - 10);
      for (let k = 0; k < N; k++) {
        const x = k / N;
        if (x < p0) continue;
        const e = Math.exp(-(x - p0) / tau) * a0, r = fam === 'conv' ? 0.55 + 0.45 * Math.cos(k * 0.9) : (1 - den) + den * wvRnd(k * 7.3 + fr * 0.37), hh = e * r * (h - 8);
        if (hh < 0.6) continue;
        const br = dm ? 1 - dm.u * 0.5 * x : 1;
        c.fillStyle = `rgba(${C.bloom},${(0.25 + 0.55 * e * br).toFixed(3)})`;
        c.fillRect(X(x), h - 4 - hh, big ? 1.4 : 1.2, hh);
      }
      T(wvPath((u) => [X(u), u < p0 ? h - 4 : h - 4 - Math.exp(-(u - p0) / tau) * a0 * (h - 8)], 80), 1.1, 0.5);
      break;
    }
    case 'chorus': {
      const rt = F(/rate/i), dp = F(/depth/i), a = dp ? dp.u : 0.4;
      ghost(inn);
      for (let j = 0; j < 3; j++) { const off = a * 0.05 * Math.sin(t * WV_TAU * (rt ? 0.2 + rt.v * 0.3 : 0.5) + j * 2.1); c.globalAlpha = j ? 0.55 : 1; wave((u) => wvRd(wv, u * 2 + off + j * a * 0.012), j ? 1 : 1.3); }
      c.globalAlpha = 1;
      break;
    }
    case 'phaser': {
      const rt = F(/rate/i), dp = F(/depth/i), fb = F(/feedback|resonance/i), a = dp ? dp.u : 0.5, lf = Math.sin(t * WV_TAU * (rt ? Math.min(2, rt.v) : 0.4)), flg = /lang/.test((wvFxOf(n) || {}).label || '');
      resp((u) => {
        if (flg) { const k = 3 + (1 + lf * a) * 5; return -18 * (1 - (0.5 + 0.5 * Math.cos(WV_TAU * u * k))) ** (1 + (fb ? fb.u * 2 : 0)); }
        let d = 0;
        for (let i = 0; i < 4; i++) { const c0 = 0.25 + i * 0.16 + lf * a * 0.08; d -= 22 * a * Math.exp(-(((u - c0) / (0.02 + (1 - (fb ? fb.u : 0.3)) * 0.02)) ** 2)); }
        return d;
      });
      break;
    }
    case 'trem': {
      const rt = F(/rate/i), dp = F(/depth/i), a = dp ? dp.u : 0.6, ph = t * WV_TAU * (rt ? Math.min(3, rt.v) * 0.5 : 0.6), env = (u) => 1 - a * (0.5 + 0.5 * Math.sin(WV_TAU * u * 3 - ph));
      ghost(inn);
      wave((u) => inn(u) * env(u));
      c.setLineDash([2, 3]);
      c.strokeStyle = `rgba(${C.bloom},.45)`;
      c.stroke(wvPath((u) => [X(u), mid - env(u) * A], 60));
      c.setLineDash([]);
      break;
    }
    case 'vib': {
      const rt = F(/rate/i), dp = F(/depth|amDepth/i), a = dp ? dp.u : 0.5, ph = t * WV_TAU * (rt ? Math.min(3, rt.v) * 0.4 : 0.6);
      ghost(inn);
      wave((u) => wvRd(wv, u * 2 + a * 0.07 * Math.sin(WV_TAU * u * 2.5 - ph)));
      break;
    }
    case 'ring': {
      const hz = F(/hz$/i), dp = F(/depth|^mix$/), k = 2 + (hz ? hz.u : 0.5) * 9, a = dp ? 0.3 + 0.7 * dp.u : 1;
      ghost(inn);
      c.strokeStyle = `rgba(${C.bloom},.18)`;
      c.stroke(wvPath((u) => [X(u), mid - Math.sin(WV_TAU * u * k + t * 3) * A * 0.5], 100));
      wave((u) => inn(u) * (1 - a + a * Math.sin(WV_TAU * u * k + t * 3)));
      break;
    }
    case 'pitch': {
      const st = F('semitones'), ce = F('cents'), pc = F('pitch'), lab = (wvFxOf(n) || {}).label || '';
      const r = pc ? Math.max(0.25, pc.v / 100) : Math.pow(2, ((st ? st.v : 0) + (ce ? ce.v / 100 : 0) + (lab === 'Detune' ? 0.6 : 0)) / 12);
      ghost(inn);
      wave((u) => wvRd(wv, u * 2 * r + t * 0.15 * (r - 1)));
      if (lab === 'Harmonizer') { c.globalAlpha = 0.5; wave((u) => wvRd(wv, u * 2 * r * 1.26), 1); c.globalAlpha = 1; }
      break;
    }
    case 'drive': {
      const dr = F('drive'), d = 1 + (dr ? dr.v : 0.45) * 12;
      ghost(inn);
      wave((u) => Math.tanh(inn(u) * d) / Math.tanh(d));
      break;
    }
    case 'crush': {
      const bt = F(/bits|^depth$/), rt = F(/^rate$|averaging/), bits = bt ? (bt.p.max > 2 ? bt.v : 2 + bt.u * 14) : 6, q = Math.pow(2, Math.max(1, bits) - 1);
      const hold = rt ? (rt.p.key === 'averaging' ? 1 + rt.u * 0.12 * WV_NP : 1 + (1 - rt.u) * 20) : 6, N = big ? 200 : 120, p = new Path2D();
      ghost(inn);
      for (let i = 0; i <= N; i++) { const u = i / N, uh = Math.floor(u * WV_NP * 2 / hold) * hold / (WV_NP * 2), y = Math.round(wvRd(wv, uh * 2) * q) / q; if (i) p.lineTo(X(u), mid - y * A); else p.moveTo(X(u), mid - y * A); }
      Uf(p, mid, 4, 0.12);
      T(p, 1.2);
      break;
    }
    case 'cheby': {
      const tk = [1, 2, 3, 4, 5, 7], lv = tk.map((k) => { const q = F(`t${k}Db`); return q && q.v > -59 ? Math.pow(10, q.v / 20) : 0; });
      ghost(inn);
      wave((u) => { const x = inn(u); let y = 0; tk.forEach((k, i) => { y += lv[i] * Math.cos(k * Math.acos(wvClamp(x, -1, 1))); }); return wvClamp(y / Math.max(1, lv.reduce((a, b) => a + b, 0)) * 1.2, -1.2, 1.2); });
      tk.forEach((k, i) => { const hh = lv[i] * (h * 0.34); c.fillStyle = `rgba(${C.bloom},.55)`; c.fillRect(w - 6 - (6 - i) * (big ? 7 : 5), h - 3 - hh, big ? 5 : 3, hh); });
      break;
    }
    case 'field': case 'swap': {
      const wd = F(/width|side|^level$|^depth$/i), pn = F(/balance|position|^pan$|direction|rotate/i), ap = /Auto-Pan/.test((wvFxOf(n) || {}).label || ''), rt = F(/rate/i);
      let ang = pn ? (pn.u - 0.5) * Math.PI * 0.5 : 0;
      if (ap) ang = (wd ? wd.u : 0.7) * Math.sin(t * WV_TAU * (rt ? rt.v * 0.5 : 0.4)) * Math.PI * 0.25;
      const sw = ap ? 0.15 : wd ? 0.1 + wd.u * 0.9 : 0.6, cx = w / 2, cy = h / 2, r = h * 0.42;
      c.strokeStyle = 'rgba(255,255,255,.07)';
      c.beginPath(); c.moveTo(cx - r, cy - r); c.lineTo(cx + r, cy + r); c.moveTo(cx + r, cy - r); c.lineTo(cx - r, cy + r); c.moveTo(cx, cy - r); c.lineTo(cx, cy + r); c.stroke();
      c.font = `600 9px ${cl.mono}`;
      c.fillStyle = cl.t3;
      c.fillText(fam === 'swap' ? 'R' : 'L', cx - r - 9, cy - r + 6);
      c.fillText(fam === 'swap' ? 'L' : 'R', cx + r + 3, cy - r + 6);
      T(wvPath((u) => { const m = wvRd(wv, u * 3), s = wvRd(wv, u * 3 + 0.17) * sw, x = s * Math.cos(ang) - m * Math.sin(ang), y = s * Math.sin(ang) + m * Math.cos(ang); return [cx + x * r * (fam === 'swap' ? -1 : 1), cy - y * r]; }, big ? 260 : 160), 1, 0.6);
      break;
    }
    case 'room': {
      const x = F('xM'), y = F('yM'), cx = w / 2, ly = h - 6, sx = cx + (x ? x.v / 20 : 0) * (w / 2 - 10), sy = ly - wvClamp(((y ? y.v : 10) + 20) / 40) * (h - 12);
      c.strokeStyle = 'rgba(255,255,255,.08)';
      c.strokeRect(6, 3, w - 12, h - 6);
      for (let k = 0; k < 4; k++) { const rr = (t * 30 + k * 14) % 56; c.strokeStyle = `rgba(${C.bloom},${(0.4 * (1 - rr / 56)).toFixed(3)})`; c.beginPath(); c.arc(sx, sy, rr, 0, WV_TAU); c.stroke(); }
      wvDot(c, sx, sy, 3, C.wave);
      c.fillStyle = cl.t2;
      c.beginPath(); c.moveTo(cx, ly - 6); c.lineTo(cx - 4, ly); c.lineTo(cx + 4, ly); c.fill();
      break;
    }
    case 'spec': {
      const th = F('thresholdDb'), ra = F('ratio'), md = F('mode'), m = wvWaveSpec(wv), ty = th ? wvClamp(1 - (th.v + 120) / 144) : 0.5, N = 32, bw = (w - 8) / N;
      for (let k = 0; k < N; k++) {
        const a = wvClamp((20 * Math.log10(m[k] + 1e-6) + 60) / 60), hh = a * (h - 8), tt = ty * (h - 8);
        let h2 = hh;
        if (md && md.v === 2 && hh > tt) h2 = tt + (hh - tt) / (ra ? ra.v : 2);
        if (md && md.v === 0 && hh < tt) h2 = hh * 0.25;
        c.fillStyle = `rgba(${C.bloom},.18)`;
        c.fillRect(4 + k * bw, h - 4 - hh, bw - 1, hh);
        c.fillStyle = `rgba(${C.bloom},.7)`;
        c.fillRect(4 + k * bw, h - 4 - h2, bw - 1, h2);
      }
      c.strokeStyle = C.wave;
      c.setLineDash([3, 3]);
      c.beginPath(); c.moveTo(4, h - 4 - ty * (h - 8)); c.lineTo(w - 4, h - 4 - ty * (h - 8)); c.stroke();
      c.setLineDash([]);
      break;
    }
    case 'grains': {
      const dn = F('density'), gs = F('grainSize'), N = Math.round(4 + (dn ? dn.u : 0.5) * (big ? 30 : 18)), gw = 6 + (gs ? gs.u : 0.4) * (big ? 40 : 22);
      ghost(inn);
      for (let i = 0; i < N; i++) {
        const x = (wvRnd(i * 3.1) + t * 0.08 * (1 + i % 3)) % 1, y = mid + (wvRnd(i * 7.7) - 0.5) * h * 0.5, a = 0.35 + 0.6 * wvRnd(i * 1.3);
        const gr = c.createRadialGradient(X(x), y, 0, X(x), y, gw / 2);
        gr.addColorStop(0, `rgba(${C.bloom},${(0.6 * a).toFixed(3)})`);
        gr.addColorStop(1, `rgba(${C.bloom},0)`);
        c.fillStyle = gr;
        c.fillRect(X(x) - gw / 2, y - gw / 2, gw, gw);
      }
      break;
    }
    case 'noise': {
      const ck = F('clockHz'), lv = F('level'), st = Math.round(6 + (ck ? ck.u : 0.5) * (big ? 90 : 50)), a = lv ? 0.25 + 0.75 * lv.u : 0.7, fr = Math.floor(t * 12), lab = (wvFxOf(n) || {}).label || '';
      const sb = /Single/.test(lab), eq = /Equalized/.test(lab), p = new Path2D();
      ghost(inn);
      let py = 0;
      for (let k = 0; k < st; k++) {
        let y = sb ? (wvRnd(k + fr * 31) > 0.5 ? 1 : -1) : wvRnd(k * 1.7 + fr * 31) * 2 - 1;
        if (eq) y = (y + py) / 2;
        py = y;
        const x0 = X(k / st), x1 = X((k + 1) / st);
        if (k) p.lineTo(x0, mid - y * A * a); else p.moveTo(x0, mid - y * A * a);
        p.lineTo(x1, mid - y * A * a);
      }
      T(p, 1.1);
      break;
    }
    case 'invert': ghost(inn); wave((u) => -inn(u)); break;
    default: {
      const gd = F(/gainDb|^db$/), wdt = F('width'), g0 = gd ? Math.pow(10, gd.v / 20) : 1;
      ghost(inn);
      wave((u) => wvClamp(inn(u) * g0, -1.25, 1.25));
      if (wdt) { c.font = `600 9px ${cl.mono}`; c.fillStyle = cl.t3; c.fillText('width ' + wdt.v.toFixed(2) + '×', 6, 10); }
    }
  }
  if (!o.size) { c.font = `500 9px ${cl.sans}`; c.fillStyle = cl.t3; c.textAlign = 'right'; c.fillText('nothing in yet', w - 6, 11); c.textAlign = 'left'; }
  if (!n.on) {
    c.fillStyle = 'rgba(0,0,0,.4)';
    c.fillRect(0, 0, w, h);
    c.font = `600 9px ${cl.mono}`;
    c.fillStyle = cl.t2;
    c.textAlign = 'center';
    c.fillText('BYPASSED', w / 2, h / 2 + 3);
    c.textAlign = 'left';
  }
}

/// A routing node's picture, in the colour of what comes in.
function wvDrawRoutingPic(g, n, t, memo) {
  const { c, w, h } = g, cl = wvCl(), o = wvInOrigins(n, memo), col = wvOriginCol(o), C = { ...cl }, wv = o.size ? wvInputWave([...o][0], t) : WV_SINE;
  c.clearRect(0, 0, w, h);
  if (col) { const v = parseInt(col.slice(1), 16); C.wave = col; C.bloom = `${v >> 16},${(v >> 8) & 255},${v & 255}`; }
  const X = (u) => 4 + u * (w - 8), mid = h / 2, A = h * 0.36, big = w > 200, val = (p) => wvPN(p, wvPVal(n, p));
  if (n.kind === 'split') {
    const rows = wvPortCount(n), ys = [...Array(rows).keys()].map((i) => h / rows * (i + 0.5)), y0 = h / 2;
    for (const y of ys) {
      const p = new Path2D();
      p.moveTo(2, y0);
      p.bezierCurveTo(w * 0.45, y0, w * 0.45, y, w - 2, y);
      wvTrace(c, p, C, 1.3, col ? 0.7 : 0);
      if (col) { const u = (t * 0.8) % 1; wvDot(c, 2 + (w - 4) * u, y0 + (y - y0) * (u * u * (3 - 2 * u)), 1.8, C.wave); }
    }
    if (big) { c.font = `600 9px ${cl.mono}`; c.fillStyle = cl.t3; ys.forEach((y, i) => c.fillText('ABC'[i], w - 12, y - 4)); }
    return;
  }
  if (n.kind === 'mix') {
    const sp = wvNodeSpec(n), bw = (w - 16) / sp.length;
    sp.forEach((p, i) => {
      const s = new Set();
      for (const cb of WV.board.cables) if (cb.to[0] === n.id && cb.to[1] === 'i' + i) wvOrigins(cb.from[0], cb.from[1], memo).forEach((x) => s.add(x));
      const hh = val(p) * (h - 16);
      c.fillStyle = wvOriginCol(s) || 'rgba(255,255,255,.15)';
      c.globalAlpha = s.size ? 0.75 : 0.4;
      c.fillRect(8 + i * bw + bw * 0.2, h - 6 - hh, bw * 0.6, hh);
      c.globalAlpha = 1;
      c.font = `600 9px ${cl.mono}`;
      c.fillStyle = cl.t3;
      c.fillText('IN ' + (i + 1), 8 + i * bw + bw * 0.2, 12);
    });
    return;
  }
  const p0 = wvNodeSpec(n)[0];
  if (n.kind === 'gain') {
    const g0 = Math.pow(10, wvPVal(n, p0) / 20);
    c.strokeStyle = 'rgba(255,255,255,.12)';
    c.stroke(wvPath((u) => [X(u), mid - wvRd(wv, u * 2) * A], 80));
    wvTrace(c, wvPath((u) => [X(u), mid - wvClamp(wvRd(wv, u * 2) * g0, -1.3, 1.3) * A], big ? 200 : 80), C, 1.2, col ? 0.7 : 0);
    return;
  }
  if (n.kind === 'pan') {
    const pv = wvPVal(n, p0) / 100, L = Math.cos(Math.max(pv, 0) * Math.PI / 2), R = Math.cos(Math.max(-pv, 0) * Math.PI / 2);
    [L, R].forEach((v, i) => {
      c.fillStyle = col || 'rgba(255,255,255,.2)';
      c.globalAlpha = 0.25 + 0.6 * v;
      const y = i ? mid + 2 : 4, hh = mid - 6;
      c.fillRect(14, y, (w - 20) * v, hh);
      c.globalAlpha = 1;
      c.font = `600 9px ${cl.mono}`;
      c.fillStyle = cl.t3;
      c.fillText(i ? 'R' : 'L', 3, y + hh - 2);
    });
    return;
  }
  if (n.kind === 'drywet') {
    const m = val(p0);
    c.strokeStyle = `rgba(${C.bloom},${(0.2 + 0.5 * (1 - m)).toFixed(2)})`;
    c.lineWidth = 1;
    c.stroke(wvPath((u) => [X(u), mid - wvRd(wv, u * 2) * A], big ? 160 : 40));
    c.globalAlpha = 0.3 + 0.7 * m;
    wvTrace(c, wvPath((u) => [X(u), mid - wvRd(wv, u * 2 + 0.04 * Math.sin(u * 9 + t)) * A * 0.8], big ? 160 : 40), C, 1.2, 0.6);
    c.globalAlpha = 1;
  }
}

/// An input's wave, as loud as the engine says it is; Out's meter.
function wvDrawIOPic(g, n, t, memo) {
  const { c, w, h } = g, cl = wvCl(), big = w > 200, pk = wvBoardPeak(n.id);
  c.clearRect(0, 0, w, h);
  if (n.kind === 'out') {
    const o = wvInOrigins(n, memo), T = WV.tele, top = T && Array.isArray(T.peak) ? Math.max(0, ...T.peak.map((x) => +x || 0)) : 0;
    const lv = o.size ? wvClamp(Math.max(pk, top)) : 0, N = big ? 40 : 18, bw = (w - 8) / N;
    for (let r = 0; r < 2; r++) {
      for (let i = 0; i < N; i++) {
        const on = i / N < lv * (r ? 0.94 : 1);
        c.fillStyle = on ? (i > N * 0.85 ? cl.acc : `rgba(${cl.bloom},.85)`) : 'rgba(255,255,255,.06)';
        c.fillRect(4 + i * bw, r ? h / 2 + 2 : 4, bw - 1.5, h / 2 - 6);
      }
    }
    return;
  }
  const I = WV_IN[n.kind], live = n.on !== false && wvInputLive(n.kind), v = parseInt(I.c.slice(1), 16);
  const C = { ...cl, wave: I.c, bloom: `${v >> 16},${(v >> 8) & 255},${v & 255}` };
  if (!live) { c.strokeStyle = 'rgba(255,255,255,.15)'; c.beginPath(); c.moveTo(4, h / 2); c.lineTo(w - 4, h / 2); c.stroke(); return; }
  // Its shape always; its size from the engine's peak while it sounds.
  const wv = wvInputWave(n.kind, t), a = pk > 0.001 ? 0.35 + 0.65 * wvClamp(pk * 2) : 0.35;
  c.globalAlpha = pk > 0.001 ? 1 : 0.55;
  const p = wvPath((u) => [4 + u * (w - 8), h / 2 - wvRd(wv, u * (big ? 3 : 2)) * h * 0.36 * a], big ? 240 : 90);
  wvUnder(c, p, 4, w - 4, h / 2, 2, C, 0.12);
  wvTrace(c, p, C, big ? 1.4 : 1.1, 0.7);
  c.globalAlpha = 1;
}

function wvDrawNodePic(g, n, t, memo) {
  if (wvIsIO(n)) wvDrawIOPic(g, n, t, memo);
  else if (wvIsFx(n)) wvDrawFxPic(g, n, t, memo);
  else wvDrawRoutingPic(g, n, t, memo);
}

/// A board knob: its value in its own law, and the rows that move it.
function wvDrawBoardKnob(g, n, p) {
  const m = wvModOf(`board:${n.id}:${p.key}`), v = wvPN(p, wvPVal(n, p));
  g.c.clearRect(0, 0, g.w, g.h);
  g.el.previousElementSibling?.style.setProperty('--v', (wvPBip(p) ? Math.abs(v - 0.5) * 2 : v).toFixed(3));
  wvRing(g, v, { cl: wvClFor(m), bip: wvPBip(p), pointer: 1, mod: m.rng, live: m.live, inset: 4 });
}

// ─────────────────────────────────────────────────────────────── the frame

function wvDrawFx(t) {
  if (!WV.board || !$('wvWorld')) return;
  const memo = new Map(), live = wvVoices().length > 0;
  WV_NWAVE.waves.clear();
  WV_NWAVE.specs.clear();
  wvHistTick(t);
  for (const s of WV_SOURCES) {
    const g = WV_BOARD_CV['fs' + s.key];
    if (!g) continue;
    wvTilePic(g, s.key, t);
    const used = WV.mods.some((m) => m.src === s.key && m.dst.startsWith('board:') && !m.off);
    g.el.parentElement.querySelector('.act').style.setProperty('--o', used ? (0.25 + 0.75 * Math.abs(wvSrcVal(s.key))).toFixed(2) : 0);
  }
  // Cables: in the colour of what they carry, a glint running along them
  // while the engine says sound is going through.
  const off = -((t * 46) % 44);
  document.querySelectorAll('#wvCables g[data-cab]').forEach((gr) => {
    const c = WV.board.cables[+gr.dataset.cab];
    if (!c) return;
    const col = wvOriginCol(wvOrigins(c.from[0], c.from[1], memo)), pk = wvBoardPeak(c.from[0]), [, cb, cg] = gr.children;
    gr.classList.toggle('dead', !col);
    cb.style.stroke = col || 'var(--wv-t3)';
    cb.style.opacity = col ? 0.45 + 0.4 * wvClamp(pk * 2) : 0.5;
    cg.style.stroke = col || 'transparent';
    cg.style.opacity = col ? (pk > 0.001 || live ? 1 : 0.4) : 0;
    cg.style.strokeDashoffset = off;
  });
  document.querySelectorAll('#wvWorld .wv-pin').forEach((p) => {
    const [nid, port, dir] = p.dataset.pin.split('|');
    let s, k = 0;
    if (dir === 'out') s = wvOrigins(nid, port, memo);
    else { s = new Set(); for (const c of WV.board.cables) if (c.to[0] === nid && c.to[1] === port) { k++; wvOrigins(c.from[0], c.from[1], memo).forEach((x) => s.add(x)); } }
    p.classList.toggle('sum', k > 1);
    p.style.setProperty('--pc', wvOriginCol(s) || (dir === 'out' || k ? 'var(--wv-t3)' : '#4a4f57'));
  });
  for (const n of WV.board.nodes) {
    const e = WV_BOARD_CV.nodes[n.id];
    if (!e) continue;
    if (e.pic) wvDrawNodePic(e.pic, n, t, memo);
    for (const g of e.knobs) { const p = wvParamOf(n, g.el.dataset.fxk.split('|')[1]); if (p) wvDrawBoardKnob(g, n, p); }
    const el = document.querySelector(`#wvWorld .wv-fn[data-node="${CSS.escape(n.id)}"]`);
    if (el) el.querySelectorAll('[data-nv]').forEach((b) => { const p = wvParamOf(n, b.dataset.nv); if (p) wvTxtEl(b, wvFmtP(p, wvPVal(n, p), 1)); });
    e.bars.forEach((g, i) => {
      const { c, w, h } = g, s = new Set(), p = wvNodeSpec(n)[i];
      for (const cb of WV.board.cables) if (cb.to[0] === n.id && cb.to[1] === 'i' + i) wvOrigins(cb.from[0], cb.from[1], memo).forEach((x) => s.add(x));
      const lv = s.size && p ? wvPN(p, wvPVal(n, p)) * (live ? 0.75 + 0.25 * Math.abs(Math.sin(t * 6 + i)) : 0.45) : 0;
      c.clearRect(0, 0, w, h);
      c.fillStyle = 'rgba(255,255,255,.06)';
      c.fillRect(0, 2, w, 4);
      c.fillStyle = wvOriginCol(s) || '#555';
      c.fillRect(0, 2, w * lv, 4);
    });
  }
  // The inspector: its picture, its knobs, its values, its lit choices.
  const el = $('wvFinsp'), S = WV_BOARD_VIEW.sel, sn = S && S.t === 'node' && wvNode(S.id), I = WV_BOARD_CV.insp;
  if (sn && I && I.pic) wvDrawNodePic(I.pic, sn, t, memo);
  if (sn && I) {
    for (const g of I.knobs) { const p = wvParamOf(sn, g.el.dataset.fxk.split('|')[1]); if (p) wvDrawBoardKnob(g, sn, p); }
    for (const p of wvNodeSpec(sn)) {
      const b = el.querySelector(`[data-iv="${CSS.escape(p.key)}"]`);
      if (b) wvTxtEl(b, wvFmtP(p, wvPVal(sn, p)));
      const cur = Math.round(wvPVal(sn, p) - p.min), m = wvModOf(`board:${sn.id}:${p.key}`);
      el.querySelectorAll('[data-ch]').forEach((sg) => {
        if (sg.dataset.ch.split('|')[1] !== p.key) return;
        sg.querySelectorAll('span').forEach((x, i) => x.classList.toggle('on', i === cur));
        sg.classList.toggle('md', !!m.col);
        if (m.col) sg.style.setProperty('--mc', m.col);
      });
      el.querySelectorAll('[data-tg]').forEach((tg) => { if (tg.dataset.tg.split('|')[1] === p.key) tg.classList.toggle('on', cur >= 1); });
    }
  }
  el.querySelectorAll('[data-ma]').forEach((b) => {
    const m = WV.mods[+b.dataset.ma];
    if (!m) return;
    const i = b.firstElementChild;
    i.style.left = `calc(50% + ${Math.min(0, m.amt) * 50}%)`;
    i.style.width = `${Math.abs(m.amt) * 50}%`;
  });
  el.querySelectorAll('[data-mv]').forEach((b) => { const m = WV.mods[+b.dataset.mv]; if (m) wvTxtEl(b, wvAmtTxt(m.amt)); });
}

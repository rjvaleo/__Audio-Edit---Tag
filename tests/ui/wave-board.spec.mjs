// The Wave page's FX board (v8, mock-up G). See `docs/WAVE-SYNTH.md`, "v8".
//
// These drive the real board routes on the scratch server, which runs with
// its output muted (`AUDIOLAB_MUTE_OUTPUT`), and play no notes. Each test
// starts from a board it posts itself, with no mod rows, so they do not lean
// on one another.
//
// What this pins:
//   - the four factory boards come first, each loads, and its mod rows are
//     laid into the matrix; the effects with no sound on the board say so;
//   - adding from the library, and patching an out to an in;
//   - a loop refused, by the page at once and by the engine with its message;
//   - splicing a node onto a cable, and lifting it out with ⌥;
//   - reordering the main path;
//   - right-click Add, Replace and Insert;
//   - a split's outs lowered, its stranded cable taken away first;
//   - saving a board and recalling it;
//   - a source dragged onto a board control is a `board:` mod row;
//   - cables brighten with the engine's peaks.

import { test, expect } from './test.mjs';

const INPUTS = [['invoice', 'in:voice', 16], ['inA', 'in:osc0', 112], ['inB', 'in:osc1', 176], ['inC', 'in:osc2', 240], ['insub', 'in:sub', 304], ['innoise', 'in:noise', 368]];
/// A board: the six inputs and Out, plus `nodes`, with `cables` as `a.port>b.port`.
function board(name, nodes = [], cables = ['invoice>out']) {
  const all = INPUTS.map(([id, kind, y]) => ({ id, kind, x: 16, y, on: true, params: {} }))
    .concat([{ id: 'out', kind: 'out', x: 672, y: 344, on: true, params: {} }], nodes.map((n) => ({ on: true, params: {}, ...n })));
  return {
    name, nodes: all,
    cables: cables.map((s) => { const [a, b] = s.split('>'), [an, ap = 'o'] = a.split('.'), [bn, bp = 'i'] = b.split('.'); return { from: [an, ap], to: [bn, bp] }; }),
  };
}

async function reset(page, b) {
  expect((await page.request.post('/api/wave/mods', { data: { mods: [] } })).ok()).toBe(true);
  const r = await page.request.post('/api/wave/board', { data: b });
  expect(r.ok(), await r.text()).toBe(true);
}

/// Open Wave on its FX view, from the board given.
async function openFx(page, b = board('Spec start')) {
  await reset(page, b);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/400 \(Bad Request\)/.test(m.text())) errors.push(m.text()); });
  await page.goto('/');
  await page.waitForFunction(() => typeof state !== 'undefined' && (state.folders || []).length > 0, null, { timeout: 20_000 });
  await page.locator('#leftRail .rl-item[data-mode="synth"]').click();
  await page.waitForFunction(() => WV.connected && WV.board && WV_FXCAT.list.length > 0, null, { timeout: 8_000 });
  await page.locator('#wvViews [data-v="fx"]').click();
  await page.waitForTimeout(200);
  return errors;
}

const serverBoard = async (page) => (await page.request.get('/api/wave/board')).json();
const cablesOf = (b) => b.cables.map((c) => `${c.from[0]}.${c.from[1]}>${c.to[0]}.${c.to[1]}`).sort();
const settle = (page) => page.waitForFunction(() => !document.querySelector('#wvFnote.on') || true).then(() => page.waitForTimeout(300));

/// Drag from one point to another in steps, with the button down.
async function dragTo(page, from, to, mods = []) {
  for (const m of mods) await page.keyboard.down(m);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
  for (const m of mods) await page.keyboard.up(m);
}
const centre = async (loc) => { const b = await loc.boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
const pin = (page, id, port, dir) => page.locator(`#wvWorld .wv-pin[data-pin="${id}|${port}|${dir}"]`);

test('the four factory boards come first, each loads, and lays its rows into the matrix', async ({ page }) => {
  // Four whole boards, each compiled and swapped in: more than one test's worth.
  test.setTimeout(60_000);
  const errors = await openFx(page);
  await expect(page.locator('#wvBex span')).toHaveText(['Glass Split', 'Dub Room', 'Grit Bus', 'Bubble Garden']);
  const listed = await (await page.request.get('/api/wave/boards')).json();
  for (const [i, name] of ['Glass Split', 'Dub Room', 'Grit Bus', 'Bubble Garden'].entries()) {
    await page.locator(`#wvBex span[data-bx="${i}"]`).click();
    await expect(page.locator('#wvBname')).toHaveText(name);
    await expect(page.locator(`#wvBex span[data-bx="${i}"]`)).toHaveClass(/\bon\b/);
    await settle(page);
    const b = await serverBoard(page);
    expect(b.name).toBe(name);
    expect(b.nodes.length).toBe(listed[i].nodes.length);
    expect(cablesOf(b)).toEqual(cablesOf(listed[i]));
    await expect(page.locator('#wvWorld .wv-fn')).toHaveCount(listed[i].nodes.length);
    // Its rows, in the matrix and on the engine; no other board's.
    const want = listed[i].mods.map((m) => `${m.src}>${m.dst}`).sort();
    expect(await page.evaluate(() => WV.mods.filter((m) => m.dst.startsWith('board:')).map((m) => `${m.src}>${m.dst}`).sort())).toEqual(want);
    const patch = await (await page.request.get('/api/wave/patch')).json();
    expect(patch.mods.map((m) => `${m.src}>${m.dst}`).sort()).toEqual(want);
  }
  // Bubble Garden has Spectral Dynamics, which takes no sound on the board yet.
  await expect(page.locator('#wvWorld .wv-fn[data-node="sy"] .wv-silent')).toHaveText('No sound on the board yet');
  await page.locator('#wvWorld .wv-fn[data-node="sy"] .fh').click();
  await expect(page.locator('#wvFinsp .wv-silent-note')).toContainText('No sound on the board yet');
  // The arrows step through them.
  await page.locator('#wvBnext').click();
  await expect(page.locator('#wvBname')).not.toHaveText('Bubble Garden');
  expect(errors).toEqual([]);
});

test('the library adds a node, an out patches to an in, and a loop is refused with its message', async ({ page }) => {
  const errors = await openFx(page);
  await page.locator('.wv-fit[data-add="gain"]').dblclick();
  await page.locator('.wv-fit[data-add="pan"]').dblclick();
  await settle(page);
  const ids = await page.evaluate(() => WV.board.nodes.filter((n) => n.kind === 'gain' || n.kind === 'pan').map((n) => [n.kind, n.id]));
  const gain = ids.find((x) => x[0] === 'gain')[1], pan = ids.find((x) => x[0] === 'pan')[1];
  expect((await serverBoard(page)).nodes.map((n) => n.kind)).toEqual(expect.arrayContaining(['gain', 'pan']));

  await dragTo(page, await centre(pin(page, gain, 'o', 'out')), await centre(pin(page, pan, 'i', 'in')));
  await expect(page.locator('#wvFnote')).toContainText('Patched Gain → Pan');
  await settle(page);
  expect(cablesOf(await serverBoard(page))).toContain(`${gain}.o>${pan}.i`);

  // Back from Pan into Gain would loop: refused by the page, and nothing sent.
  await dragTo(page, await centre(pin(page, pan, 'o', 'out')), await centre(pin(page, gain, 'i', 'in')));
  await expect(page.locator('#wvFnote')).toContainText('Refused: that would loop Pan back into itself');
  await expect(page.locator('#wvFnote')).toHaveClass(/\bbad\b/);
  expect(cablesOf(await serverBoard(page))).not.toContain(`${pan}.o>${gain}.i`);

  // And the engine refuses one the page lets through: its message is shown and
  // the last board it took comes back.
  await page.evaluate(([g, p]) => { WV.board.cables.push({ from: [p, 'o'], to: [g, 'i'] }); return wvBoardPost('x'); }, [gain, pan]);
  await expect(page.locator('#wvFnote')).toContainText('Refused:');
  await expect(page.locator('#wvFnote')).toContainText(/loop/i);
  expect(await page.evaluate(([g, p]) => WV.board.cables.some((c) => c.from[0] === p && c.to[0] === g), [gain, pan])).toBe(false);
  expect(cablesOf(await serverBoard(page))).not.toContain(`${pan}.o>${gain}.i`);
  expect(errors).toEqual([]);
});

/// Drag node `id` by its header so its in lands on cable `i`'s middle.
async function dropOnCable(page, id, i, mods = []) {
  const at = await page.evaluate(([nid, ci]) => {
    const p = document.querySelectorAll('#wvCables g[data-cab]')[ci].querySelector('.cb'), q = p.getPointAtLength(p.getTotalLength() / 2);
    const n = wvNode(nid), s = wvWellScale() * WV_BOARD_VIEW.z;
    return { dx: (q.x - wvNodeW(n) / 2 - n.x) * s, dy: (q.y - 1 - wvPinY(n, wvMainIn(n)) - n.y) * s };
  }, [id, i]);
  const h = await centre(page.locator(`#wvWorld .wv-fn[data-node="${id}"] .fh`));
  await dragTo(page, h, { x: h.x + at.dx, y: h.y + at.dy }, mods);
}

test('a node dropped on a cable is spliced in, and ⌥-drag lifts it out again', async ({ page }) => {
  const errors = await openFx(page, board('Spec splice', [{ id: 'g', kind: 'gain', x: 320, y: 480 }]));
  await dropOnCable(page, 'g', 0);
  await expect(page.locator('#wvFnote')).toContainText('Spliced Gain in between Voice and Out');
  await settle(page);
  expect(cablesOf(await serverBoard(page))).toEqual(['g.o>out.i', 'invoice.o>g.i']);
  await expect(page.locator('#wvFchain .chi')).toHaveText(['Gain']);

  // ⌥-drag: out it comes, and Voice goes straight to Out again.
  const h = await centre(page.locator('#wvWorld .wv-fn[data-node="g"] .fh'));
  await dragTo(page, h, { x: h.x + 10, y: h.y + 140 }, ['Alt']);
  await settle(page);
  expect(cablesOf(await serverBoard(page))).toEqual(['invoice.o>out.i']);
  await expect(page.locator('#wvFchain .chi')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('the main path reorders by dragging its chips', async ({ page }) => {
  const errors = await openFx(page, board('Spec order', [{ id: 'a', kind: 'gain', x: 160, y: 16 }, { id: 'b', kind: 'pan', x: 336, y: 16 }], ['invoice>a', 'a>b', 'b>out']));
  await expect(page.locator('#wvFchain .chi')).toHaveText(['Gain', 'Pan']);
  const g = await centre(page.locator('#wvFchain .chi[data-chn="a"]')), p = await page.locator('#wvFchain .chi[data-chn="b"]').boundingBox();
  await dragTo(page, g, { x: p.x + p.width + 12, y: g.y });
  await expect(page.locator('#wvFchain .chi')).toHaveText(['Pan', 'Gain']);
  await settle(page);
  expect(cablesOf(await serverBoard(page))).toEqual(['a.o>out.i', 'b.o>a.i', 'invoice.o>b.i']);
  expect(errors).toEqual([]);
});

/// A right-click menu: the item under `path`, hovered down to the last, clicked.
async function menuPick(page, path) {
  for (const [i, label] of path.entries()) {
    const it = page.locator(`#wvCmenu .wv-cmcol:nth-child(${i + 1}) .cm-it`, { hasText: new RegExp(`^${label}`) }).first();
    if (i < path.length - 1) await it.hover(); else await it.click();
  }
}

test('right-click adds, replaces, and inserts an effect on a cable', async ({ page }) => {
  const errors = await openFx(page);
  const W = await page.locator('#wvFwell').boundingBox();
  await page.mouse.click(W.x + 420, W.y + 330, { button: 'right' });
  await expect(page.locator('#wvCmenu .cm-h')).toHaveText('ADD HERE');
  await menuPick(page, ['Routing', 'Gain']);
  await settle(page);
  const added = await page.evaluate(() => WV.board.nodes.find((n) => n.kind === 'gain')?.id);
  expect(added).toBeTruthy();

  // Replace it: its kind changes, its id stays.
  await page.locator(`#wvWorld .wv-fn[data-node="${added}"] .fh`).click({ button: 'right' });
  await menuPick(page, ['Replace with', 'Delay', 'Echo']);
  await settle(page);
  expect((await serverBoard(page)).nodes.find((n) => n.id === added).kind).toBe('fx:echo');

  // Insert on the cable from Voice to Out.
  const mid = await page.evaluate(() => {
    const p = document.querySelector('#wvCables g[data-cab="0"] .cb'), q = p.getPointAtLength(p.getTotalLength() / 2), m = p.getScreenCTM();
    return new DOMPoint(q.x, q.y).matrixTransform(m);
  });
  await page.mouse.click(mid.x, mid.y, { button: 'right' });
  await expect(page.locator('#wvCmenu .cm-h')).toHaveText('CABLE');
  await menuPick(page, ['Insert effect here', 'Routing', 'Pan']);
  await settle(page);
  const pan = await page.evaluate(() => WV.board.nodes.find((n) => n.kind === 'pan')?.id);
  expect(cablesOf(await serverBoard(page))).toEqual([`${pan}.o>out.i`, `invoice.o>${pan}.i`].sort());
  expect(errors).toEqual([]);
});

test('a split lowered to two outs takes its third out\'s cable away first', async ({ page }) => {
  const errors = await openFx(page, board('Spec split', [{ id: 'sp', kind: 'split', x: 160, y: 16, params: { outs: 3 } }, { id: 'mx', kind: 'mix', x: 400, y: 16, params: { ins: 3 } }],
    ['invoice>sp', 'sp.o0>mx.i0', 'sp.o1>mx.i1', 'sp.o2>mx.i2', 'mx>out']));
  await page.locator('#wvWorld .wv-fn[data-node="sp"] [data-sn] span[data-k="2"]').click();
  await settle(page);
  await expect(page.locator('#wvFnote')).not.toHaveClass(/\bbad\b/);
  const b = await serverBoard(page);
  expect(b.nodes.find((n) => n.id === 'sp').params.outs).toBe(2);
  expect(cablesOf(b)).not.toContain('sp.o2>mx.i2');
  // And a mix lowered the same way.
  await page.locator('#wvWorld .wv-fn[data-node="mx"] [data-mn="-1"]').click();
  await settle(page);
  expect((await serverBoard(page)).nodes.find((n) => n.id === 'mx').params.ins).toBe(2);
  expect(errors).toEqual([]);
});

test('a board saved under a new name comes back with its nodes and its rows', async ({ page }) => {
  const errors = await openFx(page, board('Spec save', [{ id: 'g', kind: 'gain', x: 160, y: 16, params: { db: -6 } }], ['invoice>g', 'g>out']));
  await page.request.delete('/api/wave/boards?name=Spec%20Saved');
  // A row on the board, so the saved board carries it.
  await page.evaluate(() => { WV.mods.push({ src: 'lfo1', dst: 'board:g:db', amt: 0.4, curve: 'lin', via: null }); wvSendMods(); });
  await page.locator('#wvBsaveas').click();
  await page.keyboard.press('Meta+A');
  await page.keyboard.type('Spec Saved');
  await page.keyboard.press('Enter');
  await expect(page.locator('#wvFnote')).toContainText('Saved “Spec Saved”');
  const saved = (await (await page.request.get('/api/wave/boards')).json()).find((b) => b.name === 'Spec Saved');
  expect(saved.nodes.find((n) => n.id === 'g').params.db).toBe(-6);
  expect(saved.mods).toEqual([expect.objectContaining({ src: 'lfo1', dst: 'board:g:db' })]);

  // Another board, then back to it by the arrows.
  await page.locator('#wvBex span[data-bx="0"]').click();
  await expect(page.locator('#wvBname')).toHaveText('Glass Split');
  expect(await page.evaluate(() => WV.mods.some((m) => m.dst === 'board:g:db'))).toBe(false);
  for (let i = 0; i < 12 && (await page.locator('#wvBname').textContent()) !== 'Spec Saved'; i++) {
    await page.locator('#wvBnext').click();
    await page.waitForTimeout(150);
  }
  await expect(page.locator('#wvBname')).toHaveText('Spec Saved');
  await settle(page);
  const b = await serverBoard(page);
  expect(b.name).toBe('Spec Saved');
  expect(cablesOf(b)).toEqual(['g.o>out.i', 'invoice.o>g.i']);
  expect(await page.evaluate(() => WV.mods.filter((m) => m.dst.startsWith('board:')).map((m) => [m.src, m.dst]))).toEqual([['lfo1', 'board:g:db']]);
  await page.request.delete('/api/wave/boards?name=Spec%20Saved');
  expect(errors).toEqual([]);
});

test('a source dragged onto a board control becomes a board row, ringed on the knob', async ({ page }) => {
  const errors = await openFx(page, board('Spec map', [{ id: 'g', kind: 'gain', x: 160, y: 16 }], ['invoice>g', 'g>out']));
  const knob = page.locator('#wvWorld canvas[data-tgt="board:g:db"]');
  await dragTo(page, await centre(page.locator('#wvFstrip [data-src="lfo2"]')), await centre(knob));
  await expect(page.locator('#wvFnote')).toContainText('LFO 3 now moves Gain · Gain');
  await expect.poll(async () => (await (await page.request.get('/api/wave/patch')).json()).mods)
    .toEqual([expect.objectContaining({ src: 'lfo2', dst: 'board:g:db', amt: 0.3 })]);
  // The knob draws the range in LFO 3's colour, and the inspector lists it.
  const ink = await knob.evaluate((c) => {
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 100 && d[i] > 200 && d[i + 1] < 150 && d[i + 2] > 130) n++;
    return n;
  });
  expect(ink, 'no LFO 3 arc on the knob').toBeGreaterThan(5);
  await page.locator('#wvWorld .wv-fn[data-node="g"] .fh').click();
  await expect(page.locator('#wvFinsp .wv-mr')).toHaveCount(1);
  await expect(page.locator('#wvFinsp .wv-mr .wv-badge')).toContainText('LFO 3');
  // The Matrix has it too, under the board's own band.
  await page.locator('#wvViews [data-v="matrix"]').click();
  await expect(page.locator('#wvMxPins .wv-pband', { hasText: 'FX BOARD' })).toHaveCount(1);
  await expect(page.locator('#wvMxPins .wv-hole.pin[data-s="lfo2"][data-t="board:g:db"]')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('cables brighten and run with the engine\'s peaks', async ({ page }) => {
  let peak = 0;
  await page.route('**/api/wave/state', (route) => route.fulfill({ json: { voices: [], pos: [0.3, 0.2, 0.6], lfo: [0, 0, 0, 0], mod: {}, peak: [peak, peak], board: { invoice: [peak, peak], out: [peak, peak] } } }));
  await openFx(page);
  const look = () => page.evaluate(() => { const g = document.querySelector('#wvCables g[data-cab="0"]'); return [+g.children[1].style.opacity, +g.children[2].style.opacity]; });
  await page.waitForTimeout(300);
  const quiet = await look();
  peak = 0.6;
  await page.waitForTimeout(300);
  const loud = await look();
  expect(loud[0]).toBeGreaterThan(quiet[0]);
  expect(loud[1]).toBeGreaterThan(quiet[1]);
});

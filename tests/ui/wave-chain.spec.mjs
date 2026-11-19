// Pure graph layout: no engine writes, independent of the open Wave patch.
import { test, expect } from './test.mjs';
const node = (id) => ({ t: 'node', id });
function board(nodes, edges) {
  return { nodes: [['voice', 'in:voice'], ['sendB', 'in:osc1'], ['out', 'out'], ...nodes.map((n) => Array.isArray(n) ? n : [n, `fx:${n}`])].map(([id, kind]) => ({ id, kind })),
    cables: edges.map((edge) => { const [from, to] = edge.split('>'); return { from: [from, 'o'], to: [to, 'i'] }; }) };
}
async function layout(page, b) {
  await page.goto('/');
  await page.waitForFunction(() => typeof wvIsFx === 'function');
  return page.evaluate((b) => {
    const before = JSON.stringify(b);
    const result = wvChainLayout(b);
    if (JSON.stringify(b) !== before) throw Error('layout changed its board');
    return result;
  }, b);
}
test('a straight chain follows the sound from Voice', async ({ page }) => {
  expect(await layout(page, board(['drive', 'echo'], ['voice>drive', 'drive>echo', 'echo>out'])))
    .toEqual({ items: [node('drive'), node('echo')], unconnected: [] });
});
test('A6 keeps the two effect paths between Drive and EQ', async ({ page }) => {
  expect(await layout(page, board(['drive', 'chorus', 'echo', 'spec', 'mesh', 'plate', 'eq'],
    ['voice>drive', 'drive>chorus', 'chorus>echo', 'echo>spec', 'spec>eq', 'drive>mesh', 'mesh>plate', 'plate>eq', 'eq>out'])))
    .toEqual({ items: [node('drive'), { t: 'split', from: 'drive', to: 'eq', paths: [[node('chorus'), node('echo'), node('spec')], [node('mesh'), node('plate')]] }, node('eq')], unconnected: [] });
});
test('an oscillator send appears before the effect it meets', async ({ page }) => {
  expect(await layout(page, board(['drive', 'mesh', 'eq'], ['voice>drive', 'drive>eq', 'eq>out', 'sendB>mesh', 'mesh>eq'])))
    .toEqual({ items: [node('drive'), { t: 'send', from: 'in:osc1', to: 'eq', path: [node('mesh')] }, node('eq')], unconnected: [] });
});
test('a stranded path keeps its effects and lists only unreached nodes last', async ({ page }) => {
  expect(await layout(page, board(['drive', 'echo', 'unused'], ['voice>drive', 'drive>echo'])))
    .toEqual({ items: [node('drive'), node('echo')], unconnected: ['unused'] });
});
test('effects with no cables stay unconnected in board order', async ({ page }) => {
  expect(await layout(page, board(['z', 'a'], []))).toEqual({ items: [], unconnected: ['z', 'a'] });
});
test('routing nodes become nested split structure without appearing as effects', async ({ page }) => {
  const b = board(['drive', ['s', 'split'], 'a', ['t', 'split'], 'b', 'c', ['m', 'mix'], 'd', 'e', ['j', 'mix'], 'eq'],
    ['voice>drive', 'drive>s', 's>a', 'a>t', 't>b', 't>c', 'b>m', 'c>m', 'm>d', 'd>j', 's>e', 'e>j', 'j>eq', 'eq>out']);
  expect(await layout(page, b)).toEqual({ items: [node('drive'), { t: 'split', from: 'drive', to: 'eq', paths: [
    [node('a'), { t: 'split', from: 'a', to: 'd', paths: [[node('b')], [node('c')]] }, node('d')], [node('e')],
  ] }, node('eq')], unconnected: [] });
});
test('a branch stopping short does not hide its other path or duplicate shared effects', async ({ page }) => {
  expect(await layout(page, board(['drive', 'dead', 'echo'], ['voice>drive', 'drive>dead', 'drive>echo', 'echo>out'])))
    .toEqual({ items: [node('drive'), { t: 'split', from: 'drive', to: 'out', paths: [[node('dead')], [node('echo')]] }], unconnected: [] });
});

const a6 = () => board([['drive', 'wave:drive'], ['chorus', 'fx:hp-chorus'], 'echo', ['spec', 'fx:spectral-dynamics'], ['mesh', 'fx:ambient-fdn'], ['plate', 'fx:dattorro-plate'], 'eq'],
  ['voice>drive', 'drive>chorus', 'chorus>echo', 'echo>spec', 'spec>eq', 'drive>mesh', 'mesh>plate', 'plate>eq', 'eq>out']);
async function openChain(page) {
  const b = a6();
  b.name = 'A6 dock';
  b.nodes = b.nodes.map((n, i) => ({ ...n, on: true, params: {}, x: 100 + i * 150, y: 100 }));
  expect((await page.request.post('/api/wave/mods', { data: { mods: [] } })).ok()).toBe(true);
  const r = await page.request.post('/api/wave/board', { data: b });
  expect(r.ok(), await r.text()).toBe(true);
  await page.setViewportSize({ width: 2080, height: 1100 });
  await page.goto('/');
  await page.locator('#leftRail .rl-item[data-mode="synth"]').click();
  await page.waitForFunction(() => WV.connected && WV.board?.name === 'A6 dock' && state.suites?.length);
}
const cards = (page) => page.locator('#wvChainDock [data-card]');
test('Play dock lists the full A6 chain with labelled paths', async ({ page }) => {
  await openChain(page);
  await expect(cards(page)).toHaveCount(7);
  expect(await cards(page).evaluateAll((es) => es.map((e) => e.dataset.card)))
    .toEqual(['drive', 'chorus', 'echo', 'spec', 'mesh', 'plate', 'eq']);
  await expect(page.locator('#wvChainDock .wv-chain-split-label')).toContainText('SPLITS AFTER DRIVE, INTO EQ');
  await expect(page.locator('#wvChainDock .wv-chain-path-label')).toHaveText(['PATH 1 · 3 EFFECTS', 'PATH 2 · 2 EFFECTS']);
});
test('the FX link opens that card’s effect on the board', async ({ page }) => {
  await openChain(page);
  await page.locator('#wvChainDock [data-card="echo"] [data-openfx]').click();
  await expect(page.locator('#wvViewFx')).toBeVisible();
  expect(await page.evaluate(() => WV_BOARD_VIEW.sel)).toEqual({ t: 'node', id: 'echo' });
});
test('a dock card power button bypasses its board node', async ({ page }) => {
  await openChain(page);
  await page.locator('#wvChainDock [data-card="drive"] [data-card-power]').click();
  await expect.poll(() => page.evaluate(() => wvNode('drive').on)).toBe(false);
  await expect.poll(async () => (await (await page.request.get('/api/wave/board')).json()).nodes.find((n) => n.id === 'drive').on).toBe(false);
});
test('the dock keeps Plate at the top by node after Mesh is removed', async ({ page }) => {
  await openChain(page);
  await expect(cards(page)).toHaveCount(7);
  await page.evaluate(() => wvDockScrollTo('plate'));
  const offset = () => page.evaluate(() => {
    const host = $('wvChainDock').getBoundingClientRect(), card = document.querySelector('#wvChainDock [data-card="plate"]').getBoundingClientRect();
    return (card.top - host.top) / WV.scale;
  });
  await expect.poll(offset).toBeLessThanOrEqual(2);
  await page.locator('#wvViews [data-v="fx"]').click();
  await page.evaluate(() => { wvBoardSelect({ t: 'node', id: 'mesh' }); wvBoardDelete(); });
  await expect.poll(async () => (await (await page.request.get('/api/wave/board')).json()).nodes.some((n) => n.id === 'mesh')).toBe(false);
  await page.locator('#wvViews [data-v="play"]').click();
  await expect(page.locator('#wvChainDock [data-card="mesh"]')).toHaveCount(0);
  await expect.poll(offset).toBeLessThanOrEqual(2);
  expect(await offset()).toBeGreaterThanOrEqual(-2);
});
test('Create and Matrix keep the same chain dock', async ({ page }) => {
  await openChain(page);
  await expect(cards(page)).toHaveCount(7);
  const order = await cards(page).evaluateAll((es) => es.map((e) => e.dataset.card));
  for (const v of ['create', 'matrix']) {
    await page.locator(`#wvViews [data-v="${v}"]`).click();
    await expect(page.locator('#wvChainDock')).toBeVisible();
    expect(await cards(page).evaluateAll((es) => es.map((e) => e.dataset.card))).toEqual(order);
  }
});
test('all catalogue faces fit their full chain cards', async ({ page }) => {
  test.setTimeout(120_000);
  await openChain(page);
  await expect(cards(page)).toHaveCount(7);
  const errors = await page.evaluate(() => {
    const errors = [];
    for (const f of WV_FXCAT.list) {
      wvBoardAdopt({ name: 'Card fit', nodes: [
        { id: 'voice', kind: 'in:voice', on: true, params: {} },
        { id: 'face', kind: f.kind, on: true, params: {} },
        { id: 'out', kind: 'out', on: true, params: {} },
      ], cables: [{ from: ['voice', 'o'], to: ['face', 'i'] }, { from: ['face', 'o'], to: ['out', 'i'] }] });
      wvRenderChainDock();
      const face = document.querySelector('#wvChainDock [data-card="face"] .wv-rackface');
      if (!face) { errors.push(`${f.kind}: no full face`); continue; }
      const bounds = face.getBoundingClientRect();
      for (const el of [face, ...face.querySelectorAll('*')]) {
        const handle = el.matches('.prism-pad') || el.querySelector(':scope > .fx-caret');
        if (el instanceof HTMLElement && !handle && el.clientWidth && el.scrollWidth > el.clientWidth + 1)
          errors.push(`${f.kind}: ${el.className} ${el.scrollWidth}>${el.clientWidth}`);
        if (el instanceof HTMLElement && el.getClientRects().length) {
          const r = el.getBoundingClientRect();
          if (r.width && (r.left < bounds.left - 1 || r.right > bounds.right + 1)) errors.push(`${f.kind}: outside face`);
        }
      }
    }
    return errors;
  });
  expect(errors).toEqual([]);
});

test('Play effects row has every effect in order and up to four real controls with pictures', async ({ page }) => {
  await openChain(page);
  const row = page.locator('#wvFxRow [data-fxcard]');
  await expect(row).toHaveCount(7);
  expect(await row.evaluateAll((es) => es.map((e) => e.dataset.fxcard))).toEqual(['drive', 'chorus', 'echo', 'spec', 'mesh', 'plate', 'eq']);
  const expected = await page.evaluate(() => WV.board.nodes.filter(wvIsFx).map((n) => ({ id: n.id,
    count: Math.min(4, wvNodeSpec(n).filter((p) => !p.choices && !p.toggle).length) })));
  for (const { id, count } of expected) {
    const card = page.locator(`#wvFxRow [data-fxcard="${id}"]`);
    await expect(card.locator('canvas[data-fxk]')).toHaveCount(count);
    await expect(card.locator('.ui-pic path, .ui-pic line, .ui-pic polyline, .ui-pic circle').first()).toBeAttached();
  }
  const layout = await row.evaluateAll((es) => es.flatMap((e) => [...e.querySelectorAll('.wv-fxrow-control')].map((c) => {
    const ring = c.querySelector('.ui-kr').getBoundingClientRect(), label = c.querySelector('.ui-lab').getBoundingClientRect();
    return { below: label.top >= ring.bottom, width: label.width };
  })));
  expect(layout.every((c) => c.below && c.width > 40), 'labels beneath pictured knobs').toBe(true);
  const size = await row.evaluateAll((es) => es.map((e) => e.offsetWidth));
  expect(new Set(size).size).toBe(1);
  expect(await page.locator('#wvFxRow').evaluate((e) => e.scrollWidth > e.clientWidth)).toBe(true);
});
test('clicking an effects-row card scrolls and selects its dock card', async ({ page }) => {
  await openChain(page);
  await page.locator('#wvFxRow [data-fxcard="plate"] .wv-fxcard-name').click();
  const card = page.locator('#wvChainDock [data-card="plate"]');
  await expect(card).toHaveClass(/sel/);
  const r = await card.boundingBox(), host = await page.locator('#wvChainDock').boundingBox();
  expect(r.y).toBeGreaterThanOrEqual(host.y - 1);
  expect(r.y).toBeLessThan(host.y + host.height);
});
test('an effects-row knob moves its board parameter without selecting the card', async ({ page }) => {
  await openChain(page);
  const before = await page.evaluate(() => wvPVal(wvNode('drive'), wvParamOf(wvNode('drive'), 'drive')));
  const b = await page.locator('#wvFxRow canvas[data-tgt="board:drive:drive"]').boundingBox();
  expect(b).not.toBeNull();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2 - 20, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await (await page.request.get('/api/wave/board')).json()).nodes.find((n) => n.id === 'drive').params.drive).toBeGreaterThan(before);
  await expect(page.locator('#wvChainDock [data-card="drive"]')).not.toHaveClass(/sel/);
});
test('a More Sources pill dropped on a row knob creates a board mapping', async ({ page }) => {
  await openChain(page);
  await expect(page.locator('#wvFxRow canvas[data-tgt="board:drive:drive"]')).toBeVisible();
  const from = await page.locator('#wvSrcStrip [data-src="macro0"]').boundingBox();
  const to = await page.locator('#wvFxRow canvas[data-tgt="board:drive:drive"]').boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect.poll(async () => (await (await page.request.get('/api/wave/patch')).json()).mods)
    .toEqual([expect.objectContaining({ src: 'macro0', dst: 'board:drive:drive', amt: 0.3 })]);
});

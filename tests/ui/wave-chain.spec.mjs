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

// The shared controls (phase 5): one knob, one bar, one dropdown and one
// segmented switch (`ui/app/073a`–`073d`). Each is built here on its own, in the
// running interface, and driven as a person would: drag, Shift-drag,
// double-click, the keys. The pages that use them are tested in their own specs.

import { test, expect } from './test.mjs';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => typeof uiKnob === 'function' && typeof state !== 'undefined');
  await page.evaluate(() => {
    const box = document.createElement('div');
    box.id = 'uiTest';
    box.style.cssText = 'position:fixed;left:40px;top:40px;z-index:99999;padding:20px;display:flex;gap:20px;align-items:flex-start;background:var(--look-panel)';
    document.body.appendChild(box);
    window.uiLog = [];
  });
});

test('the knob: a drag turns it, Shift is finer, a double-click resets it, the keys nudge it', async ({ page }) => {
  await page.evaluate(() => {
    let v = 0.5;
    const k = uiKnobParam('Drive', 0.5, 0, 1, 0, (x) => `${Math.round(x * 100)} %`,
      (x) => { v = x; uiLog.push(['move', x]); }, (x) => uiLog.push(['commit', x]), false, 0.2,
      { size: 44, pic: (u) => `<path class="a" d="M4 40 L60 ${40 - u * 30}"/>` });
    k.id = 'k1';
    document.getElementById('uiTest').appendChild(k);
    window.kv = () => v;
  });
  const k = page.locator('#k1');
  await expect(k).toHaveClass(/ui-knob/);
  await expect(k.locator('.ui-kval')).toHaveText('50 %');
  await expect(k.locator('.ui-kname')).toHaveText('Drive');
  // The picture is inside a face at 44.
  await expect(k.locator('.ui-kn .ui-pic.in path')).toHaveCount(1);
  await expect(k.locator('.ui-cap.face')).toHaveCount(1);

  const box = await k.locator('.ui-kn').boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx, cy - 40, { steps: 4 });
  await page.mouse.up();
  const coarse = await page.evaluate(() => kv());
  expect(coarse).toBeCloseTo(0.75, 2);
  expect(await page.evaluate(() => uiLog.at(-1)[0])).toBe('commit');

  await page.keyboard.down('Shift');
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx, cy - 40, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  expect(await page.evaluate(() => kv())).toBeCloseTo(coarse + 0.05, 2);

  await k.locator('.ui-kn').dblclick();
  expect(await page.evaluate(() => kv())).toBeCloseTo(0.2, 5);
  await expect(k.locator('.ui-kval')).toHaveText('20 %');

  await k.locator('.ui-ring').focus();
  await page.keyboard.press('ArrowUp');
  expect(await page.evaluate(() => kv())).toBeCloseTo(0.21, 5);
  await expect(k.locator('.ui-ring')).toHaveAttribute('role', 'slider');
  await expect(k.locator('.ui-ring')).toHaveAttribute('aria-valuetext', '21 %');
});

test('the knob shows a source: its reach in the source colour and the live value as a dot', async ({ page }) => {
  await page.evaluate(() => {
    const k = uiKnob({ label: 'Cutoff', size: 26, layout: 'beside', get: () => 0.5, set: () => {}, pic: () => '<path class="a" d="M2 8H20"/>', pv: '0 0 22 16' });
    k.id = 'k2';
    document.getElementById('uiTest').appendChild(k);
    k.setMod({ rng: 0.2, live: 0.6, col: 'rgb(92, 200, 230)' });
  });
  const k = page.locator('#k2');
  // At 26 the cap is brushed, with its pointer, and the picture beside.
  await expect(k.locator('.ui-cap:not(.face)')).toHaveCount(1);
  await expect(k.locator('.ui-pic.side')).toHaveCount(1);
  expect(await k.locator('.ui-ptr').evaluate((e) => getComputedStyle(e).display)).not.toBe('none');
  expect(await k.locator('.ui-md').getAttribute('d')).toMatch(/^M/);
  expect(await k.locator('.ui-md').evaluate((e) => getComputedStyle(e).stroke)).toBe('rgb(92, 200, 230)');
  await expect(k.locator('.ui-live')).toBeVisible();
  await page.evaluate(() => document.getElementById('k2').setMod(null));
  expect(await k.locator('.ui-md').getAttribute('d')).toBe('');
  await expect(k.locator('.ui-live')).toBeHidden();
});

test('the bar: a click sets it, a drag follows, Shift is ten times finer, a double-click resets it', async ({ page }) => {
  await page.evaluate(() => {
    let v = 1;
    const b = uiBarParam('Stretch', 1, 0, 4, 0, (x) => `${x.toFixed(2)}×`,
      (x) => { v = x; }, (x) => uiLog.push(['commit', x]), false, 1,
      { w: 240, pic: (u) => `<path class="a" d="M2 11H${2 + u * 26}"/>`, col: 'var(--look-f-time)' });
    b.id = 'b1';
    document.getElementById('uiTest').appendChild(b);
    window.bv = () => v;
  });
  const b = page.locator('#b1'), w = b.locator('.ui-bw');
  await expect(b).toHaveClass(/ui-bar h24/);
  await expect(b.locator('.ui-bn')).toHaveText('Stretch');
  await expect(b.locator('.ui-bv')).toHaveText('1.00×');
  const r = await w.boundingBox();
  await page.mouse.click(r.x + 4 + (r.width - 8) * 0.5, r.y + r.height / 2);
  expect(await page.evaluate(() => bv())).toBeCloseTo(2, 1);
  await expect(b.locator('.ui-bv')).toHaveText(/^2\.0\d×$/);

  const x0 = r.x + 4 + (r.width - 8) * 0.5;
  await page.keyboard.down('Shift');
  await page.mouse.move(x0, r.y + r.height / 2);
  await page.mouse.down();
  await page.mouse.move(x0 + (r.width - 8) * 0.5, r.y + r.height / 2, { steps: 5 });
  await expect(b).toHaveClass(/fineon/);
  await page.mouse.up();
  await page.keyboard.up('Shift');
  // Half the bar's width, ten times finer: a twentieth of the range.
  expect(await page.evaluate(() => bv())).toBeCloseTo(2 + 0.2, 1);

  await w.dblclick();
  expect(await page.evaluate(() => bv())).toBe(1);
  await w.focus();
  await page.keyboard.press('ArrowRight');
  expect(await page.evaluate(() => bv())).toBeCloseTo(1.04, 5);
  expect(await page.evaluate(() => uiLog.at(-1)[0])).toBe('commit');
});

test('the bar fills from the centre when bipolar, and shows a source', async ({ page }) => {
  await page.evaluate(() => {
    const b = uiBarParam('Pitch', 3, -12, 12, 0.01, (x) => `${x.toFixed(2)} st`, () => {}, null, false, 0, { w: 240, h: 20 });
    b.id = 'b2';
    document.getElementById('uiTest').appendChild(b);
    b.setMod({ rng: 0.1, live: 0.6, col: 'rgb(164, 140, 242)' });
  });
  const b = page.locator('#b2');
  await expect(b).toHaveClass(/h20/);
  await expect(b.locator('.ui-bz')).toBeVisible();
  const fill = await b.locator('.ui-bf').boundingBox(), well = await b.locator('.ui-bw').boundingBox();
  expect(fill.x).toBeGreaterThan(well.x + well.width * 0.45);
  await expect(b).toHaveClass(/mapped/);
  await expect(b.locator('.ui-bd')).toBeVisible();
  expect(await b.locator('.ui-bw').evaluate((e) => getComputedStyle(e).boxShadow)).toContain('rgb(164, 140, 242)');
});

test('the dropdown: the select stays and keeps its value, the menu has groups, a tick, keys and find', async ({ page }) => {
  await page.evaluate(() => {
    const s = document.createElement('select');
    s.id = 's1';
    const names = ['Formant Sweep', 'Vowel Ah-Oo', 'Formant Choir', 'Sine', 'Saw', 'Glass Organ', 'Square', 'Pulse', 'Noise', 'Bell', 'Pad', 'Organ', 'Choir', 'Brass'];
    s.innerHTML = `<optgroup label="Vocal">${names.slice(0, 3).map((n) => `<option>${n}</option>`).join('')}</optgroup>`
      + `<optgroup label="Classic">${names.slice(3).map((n) => `<option>${n}</option>`).join('')}</optgroup>`;
    document.getElementById('uiTest').appendChild(s);
    s.addEventListener('change', () => uiLog.push(['change', s.value]));
    uiDrop(s, { h: 28, w: 200 });
  });
  const trig = page.locator('button.ui-dd[data-for="s1"]');
  await expect(trig).toHaveClass(/h28/);
  await expect(trig.locator('.ui-dt')).toHaveText('Formant Sweep');
  // Code that sets the value moves the trigger with it.
  await page.evaluate(() => { document.getElementById('s1').value = 'Saw'; });
  await expect(trig.locator('.ui-dt')).toHaveText('Saw');
  // So does a test that picks an option on the select.
  await page.locator('#s1').selectOption('Bell');
  await expect(trig.locator('.ui-dt')).toHaveText('Bell');

  await trig.click();
  const menu = page.locator('.ui-menu');
  await expect(menu).toBeVisible();
  await expect(trig).toHaveClass(/open/);
  await expect(menu.locator('.ui-mg')).toHaveText(['Vocal', 'Classic']);
  await expect(menu.locator('.ui-mi.on .ui-mt')).toHaveText('Bell');
  await expect(menu.locator('.ui-mi.on .ui-ck')).toHaveText('✓');
  await page.keyboard.press('ArrowDown');
  await expect(menu.locator('.ui-mi.kf .ui-mt')).toHaveText('Pad');
  // Over twelve items, letters narrow the list.
  await page.keyboard.type('for');
  await expect(menu.locator('.ui-mi .ui-mt')).toHaveText(['Formant Sweep', 'Formant Choir']);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(menu).toHaveCount(0);
  await expect(page.locator('#s1')).toHaveValue('Formant Choir');
  expect(await page.evaluate(() => uiLog.at(-1))).toEqual(['change', 'Formant Choir']);

  await trig.click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.ui-menu')).toHaveCount(0);
  await expect(trig).not.toHaveClass(/open/);
});

test('the segmented switch: one choice on, underlined in --on, the arrows move it', async ({ page }) => {
  await page.evaluate(() => {
    const s = uiSeg({ items: [{ k: 'hann', label: 'hann' }, { k: 'tri', label: 'tri' }, { k: 'rect', label: 'rect', icon: 'M1 9V1H13V9' }], value: 'tri', h: 24, onPick: (k) => uiLog.push(['pick', k]) });
    s.id = 'g1';
    document.getElementById('uiTest').appendChild(s);
  });
  const g = page.locator('#g1');
  await expect(g.locator('.on')).toHaveText('tri');
  const on = await g.locator('.on').evaluate((e) => getComputedStyle(e).boxShadow);
  const accent = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--on').trim());
  expect(accent).toBeTruthy();
  expect(on).toContain('inset');
  await g.locator('span', { hasText: 'rect' }).click();
  await expect(g.locator('.on')).toHaveText('rect');
  expect(await page.evaluate(() => uiLog.at(-1))).toEqual(['pick', 'rect']);
  await page.keyboard.press('ArrowLeft');
  await expect(g.locator('.on')).toHaveText('tri');
  for (const h of [20, 24, 28]) {
    const height = await page.evaluate((h) => {
      const s = uiSeg({ items: [{ k: 1, label: 'A' }, { k: 2, label: 'B' }], value: 1, h });
      document.getElementById('uiTest').appendChild(s);
      return s.getBoundingClientRect().height;
    }, h);
    expect(height).toBe(h);
  }
});

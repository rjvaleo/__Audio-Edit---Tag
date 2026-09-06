// Presets for one section at a time: a look, and a cloud.
//
// The store is pure, so most of this drives it against a plain map. What that
// cannot check is the two things that matter in the interface: that a look put
// back actually reaches the room and its controls, and that a cloud put back
// actually reaches the document — and neither touches the other.

import { test, expect } from '@playwright/test';

const FAKE = `(() => {
  const map = new Map();
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    get length() { return map.size; },
    key: (i) => [...map.keys()][i] ?? null,
  };
})()`;

async function ready(page) {
  await page.goto('/');
  await page.waitForFunction(
    () => typeof state !== 'undefined' && (state.folders || []).length > 0,
    { timeout: 20_000 });
}

test('the store is served, and keeps what it is given by name', async ({ page }) => {
  await ready(page);
  const got = await page.evaluate((fake) => {
    const st = eval(fake);
    const S = SectionPresets;
    const before = S.list(st, 'visual');
    const name = S.save(st, 'visual', '  Night  ', { a: 1, deep: { b: [1, 2] } });
    const back = S.get(st, 'visual', 'Night');
    back.deep.b.push(3);
    const again = S.get(st, 'visual', 'Night');
    return {
      loaded: typeof S === 'object' && typeof S.save === 'function',
      before, name,
      listed: S.list(st, 'visual').map((p) => p.name),
      back, again,
      blank: S.save(st, 'visual', '   ', { a: 1 }),
      wrongKind: S.save(st, 'nothing', 'x', { a: 1 }),
      notObject: S.save(st, 'visual', 'x', 'a string'),
      removed: S.remove(st, 'visual', 'Night'),
      removedTwice: S.remove(st, 'visual', 'Night'),
      after: S.list(st, 'visual'),
    };
  }, FAKE);
  expect(got.loaded, 'section-presets.js did not load').toBe(true);
  expect(got.before).toEqual([]);
  expect(got.name, 'the name is stored trimmed').toBe('Night');
  expect(got.listed).toEqual(['Night']);
  expect(got.back).toEqual({ a: 1, deep: { b: [1, 2, 3] } });
  expect(got.again, 'what comes back is a copy').toEqual({ a: 1, deep: { b: [1, 2] } });
  expect(got.blank, 'a blank name is refused').toBeNull();
  expect(got.wrongKind, 'an unknown section is refused').toBeNull();
  expect(got.notObject, 'a non-object is refused').toBeNull();
  expect(got.removed).toBe(true);
  expect(got.removedTwice).toBe(false);
  expect(got.after).toEqual([]);
});

test('unreadable storage is an empty list, never a throw', async ({ page }) => {
  await ready(page);
  const got = await page.evaluate((fake) => {
    const st = eval(fake);
    const S = SectionPresets;
    st.setItem(S.keyFor('grain'), 'not json {');
    const a = S.list(st, 'grain');
    st.setItem(S.keyFor('grain'), JSON.stringify({
      ok: { value: { rateHz: 5 } },
      noValue: { saved: 1 },
      valueIsString: { value: 'x' },
      notAnEntry: 7,
    }));
    return { a, b: S.list(st, 'grain').map((p) => p.name), ok: S.get(st, 'grain', 'ok') };
  }, FAKE);
  expect(got.a).toEqual([]);
  expect(got.b, 'only entries with an object value survive').toEqual(['ok']);
  expect(got.ok).toEqual({ rateHz: 5 });
});

test('a look put back reaches the room, its storage and its sliders', async ({ page }) => {
  await ready(page);
  await page.evaluate(() => setMode('room'));
  await page.waitForSelector('#roomStageRoom #visGl', { state: 'visible', timeout: 20_000 });

  const got = await page.evaluate(() => {
    const key = SectionPresets.keyFor('visual');
    const kept = localStorage.getItem(key);
    const was = visualSnapshot();
    try {
      // A look that differs from whatever is on screen in five different kinds
      // of thing: a slider, a layer switch, the hierarchy, the palette and the
      // solid's path.
      roomEdit.opacity = 0.33;
      roomEdit.layers.solid = true;
      roomEdit.layers.sky = false;
      roomEdit.order = [...roomOrder()].reverse();
      roomEdit.solidPath = [{ x: -0.5, y: 0.2, z: 0.1 }, { x: 0.5, y: 0.8, z: 0.9 }];
      roomPaint.scheme = rpGenerate('rgb');
      rpTouch();
      const look = visualSnapshot();
      const name = SectionPresets.save(localStorage, 'visual', 'spec look', look);

      // Then somewhere else entirely.
      roomEdit.opacity = 0.8;
      roomEdit.layers.solid = false;
      roomEdit.layers.sky = true;
      roomEdit.order = roomOrder().slice().sort();
      roomEdit.solidPath = [{ x: 0, y: 0.42, z: 0.08 }, { x: 0, y: 0.42, z: 1 }];
      roomPaint.scheme = rpDefaultScheme();
      rpTouch();
      saveRoomData(); saveRoomLayers(); saveRoomHierarchy();
      syncRoomSliders();
      const moved = { opacity: roomEdit.opacity, slider: $('reOpacity').value };

      // Through the picker, the way a hand would.
      paintVisualPresets(name);
      $('vpPick').dispatchEvent(new Event('change', { bubbles: true }));

      const stored = JSON.parse(localStorage.getItem('roomData'));
      const layers = JSON.parse(localStorage.getItem('roomLayers'));
      return {
        name, moved,
        opacity: roomEdit.opacity,
        slider: $('reOpacity').value,
        solidOn: roomLayerOn('solid'),
        skyOn: roomLayerOn('sky'),
        order: roomOrder(),
        wantOrder: look.order,
        path: roomEdit.solidPath,
        paint: roomPaint.scheme.name,
        storedOpacity: stored.opacity,
        storedSolid: layers.solid,
        // The layer stack was rebuilt in the recalled order.
        stack: [...document.querySelectorAll('#reLayers .re-layer')].map((r) => r.dataset.layer),
        picker: $('vpPick').value,
      };
    } finally {
      applyVisual(was);
      if (kept === null) localStorage.removeItem(key); else localStorage.setItem(key, kept);
      paintVisualPresets('');
    }
  });

  expect(got.name).toBe('spec look');
  expect(got.moved.opacity).toBe(0.8);
  expect(got.moved.slider).toBe('80');
  expect(got.opacity, 'the slider value came back').toBe(0.33);
  expect(got.slider, 'the slider element followed it').toBe('33');
  expect(got.solidOn, 'the layer switch came back').toBe(true);
  expect(got.skyOn).toBe(false);
  expect(got.order, 'the hierarchy came back').toEqual(got.wantOrder);
  expect(got.stack.slice(0, got.wantOrder.length), 'the stack was rebuilt in that order')
    .toEqual(got.wantOrder);
  expect(got.path).toEqual([{ x: -0.5, y: 0.2, z: 0.1 }, { x: 0.5, y: 0.8, z: 0.9 }]);
  expect(got.paint, 'the palette came back').toBe('RGB');
  expect(got.storedOpacity, 'storage was written, so a reload keeps it').toBe(0.33);
  expect(got.storedSolid).toBe(true);
  expect(got.picker).toBe('spec look');
});

test('a cloud put back reaches the document and leaves the seed alone', async ({ page }) => {
  await ready(page);
  await page.evaluate(async () => {
    const folder = state.folders[0].name;
    const files = await api(`/api/files?folder=${encodeURIComponent(folder)}`);
    await selectFile(files[0]);
    setMode('edit');
    showPane('right', 'stretch');
  });
  await page.waitForFunction(() => !!state.edit?.stretch?.grain && !!state.grainRows, { timeout: 20_000 });

  const got = await page.evaluate(async () => {
    const key = SectionPresets.keyFor('grain');
    const kept = localStorage.getItem(key);
    const was = grainSnapshot();
    const seed = state.edit.stretch.grain.seed;
    const ratio = state.edit.stretch.ratio;
    try {
      const name = SectionPresets.save(localStorage, 'grain', 'spec cloud', {
        rateHz: 123, layers: 3, reverse: true, seed: 999999,
        // The wrong kind of value for a number: left at its default, not sent.
        overlap: 'lots',
      });
      paintGrainPresets(name);
      $('gpPick').dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 900));
      const g = state.edit.stretch.grain;
      const snap = grainSnapshot();
      return {
        name,
        rate: g.rateHz, layers: g.layers, reverse: g.reverse, overlap: g.overlap,
        seed: g.seed, wantSeed: seed,
        ratio: state.edit.stretch.ratio, wantRatio: ratio,
        slider: state.grainRows.rateHz ? state.grainDraft.rateHz : null,
        snapHasSeed: 'seed' in snap,
      };
    } finally {
      await applyGrain(was);
      if (kept === null) localStorage.removeItem(key); else localStorage.setItem(key, kept);
      paintGrainPresets('');
    }
  });

  expect(got.name).toBe('spec cloud');
  expect(got.rate).toBe(123);
  expect(got.layers).toBe(3);
  expect(got.reverse).toBe(true);
  expect(got.overlap, 'a value of the wrong kind is not sent').toBe(2);
  expect(got.seed, 'the seed is the document\'s, not the preset\'s').toBe(got.wantSeed);
  expect(got.ratio, 'the rest of the engine is untouched').toBe(got.wantRatio);
  expect(got.slider).toBe(123);
  expect(got.snapHasSeed, 'a snapshot never carries the seed').toBe(false);
});

// Compose, phase five: the compact panels.
//
// Three panels built for the cells of the Compose workspace rather than the
// full panels squeezed into them. Each is tested here on its own, mounted into
// a host the size a cell will be, so what is checked is the panel and not yet
// the view that places it.

import { test, expect } from '@playwright/test';

async function ready(page) {
  await page.goto('/');
  await page.waitForFunction(
    () => typeof state !== 'undefined' && (state.folders || []).length > 0,
    { timeout: 20_000 },
  );
}

async function openFile(page) {
  await ready(page);
  await page.evaluate(async () => {
    const folder = state.folders[0].name;
    const files = await api(`/api/files?folder=${encodeURIComponent(folder)}`);
    await selectFile(files[0]);
    setMode('edit');
  });
  await page.waitForFunction(
    () => !!(state.stretchDraft && state.grainDraft && state.stretchRows && state.grainRows),
    { timeout: 20_000 },
  );
}

/// A cell-sized host, fixed over the page, with one panel mounted in it.
async function mount(page, fn) {
  await page.evaluate((fn) => {
    document.getElementById('testHost')?.remove();
    const host = document.createElement('div');
    host.id = 'testHost';
    host.style.cssText = 'position:fixed;left:30px;top:60px;width:400px;height:380px;'
      + 'z-index:45;background:#0b0d10;display:flex;flex-direction:column;';
    document.body.appendChild(host);
    window[fn](host);
  }, fn);
}

const knobV = (key) => document.querySelector(`#cgKnobs .knob[data-macro="${key}"] .v`).textContent;

test('the compact grain panel has the engine, the pad and eight knobs', async ({ page }) => {
  await openFile(page);
  await mount(page, 'composeGrainMount');
  const got = await page.evaluate(() => ({
    knobs: [...document.querySelectorAll('#cgKnobs .knob .k')].map((k) => k.textContent),
    engines: [...document.querySelectorAll('#cgEngine .seg-btn')].map((b) => b.dataset.alg),
    active: document.querySelector('#cgEngine .seg-btn.active')?.dataset.alg,
    alg: state.stretchDraft.algorithm,
    pad: !!document.querySelector('#cgPad.cloud-pad'),
    out: $('cgOut').textContent,
    stretchOut: $('stretchOut').textContent,
    empty: $('cgEmpty').classList.contains('hidden'),
  }));
  expect(got.knobs).toEqual(['Stretch', 'Pitch', 'Window', 'Position', 'Rate', 'Scatter', 'Jitter', 'Drift']);
  expect(got.engines).toEqual(['wsola', 'vocoder', 'pvsola', 'hybrid', 'granular']);
  expect(got.active, 'the compact panel shows a different engine').toBe(got.alg);
  expect(got.pad).toBe(true);
  expect(got.out).toBe(got.stretchOut);
  expect(got.empty, 'the empty note shows with a sound open').toBe(true);
});

test('a compact knob drives the draft the full panel drives, and each follows the other', async ({ page }) => {
  await openFile(page);
  await mount(page, 'composeGrainMount');
  const turn = async (key, dy) => {
    const box = await page.locator(`#cgKnobs .knob[data-macro="${key}"] svg`).boundingBox();
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y - dy, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(300);
  };
  const before = await page.evaluate(() => ({ ratio: state.stretchDraft.ratio, rate: state.grainDraft.rateHz }));
  await turn('ratio', 30);
  await turn('rateHz', 40);
  const got = await page.evaluate((knobVSrc) => {
    const knobV = new Function('key', `return (${knobVSrc})(key)`);
    return {
      ratio: state.stretchDraft.ratio,
      rate: state.grainDraft.rateHz,
      ratioCompact: knobV('ratio'),
      ratioFull: state.stretchRows.ratio.querySelector('.v').textContent,
      rateCompact: knobV('rateHz'),
      rateFull: state.grainRows.rateHz.querySelector('.v').textContent,
    };
  }, knobV.toString());
  expect(got.ratio, 'the Stretch knob did not move the stretch').toBeGreaterThan(before.ratio);
  expect(got.rate, 'the Rate knob did not move the rate').toBeGreaterThan(before.rate);
  expect(got.ratioFull, 'the full panel did not follow Stretch').toBe(got.ratioCompact);
  expect(got.rateFull, 'the full panel did not follow Rate').toBe(got.rateCompact);

  // The other way: a change arriving through the full panel reaches the knob.
  const back = await page.evaluate(() => {
    state.edit.stretch.semitones = 7;
    syncStretchSliders();
    return {
      compact: document.querySelector('#cgKnobs .knob[data-macro="semitones"] .v').textContent,
      full: state.stretchRows.semitones.querySelector('.v').textContent,
    };
  });
  expect(back.compact).not.toBe('');
  expect(back.compact, 'the compact knob did not follow the full panel').toBe(back.full);
});

test('an engine picked in the compact panel is picked in the full panel', async ({ page }) => {
  await openFile(page);
  await mount(page, 'composeGrainMount');
  const want = await page.evaluate(() => (state.stretchDraft.algorithm === 'granular' ? 'wsola' : 'granular'));
  await page.click(`#cgEngine .seg-btn[data-alg="${want}"]`);
  await page.waitForFunction(
    (w) => document.querySelector('#cgEngine .seg-btn.active')?.dataset.alg === w, want, { timeout: 5_000 });
  const got = await page.evaluate(() => ({
    draft: state.stretchDraft.algorithm,
    full: document.querySelector('#stretchEngine .seg-btn.active')?.dataset.alg,
  }));
  expect(got.draft).toBe(want);
  expect(got.full, 'the full panel shows a different engine').toBe(want);
});

test('the compact pad draws, and dragging its head moves the read position in both panels', async ({ page }) => {
  await openFile(page);
  await mount(page, 'composeGrainMount');
  await page.waitForTimeout(200);
  const at = await page.evaluate(() => {
    // Off the left edge, so the head is somewhere a pointer can land on it.
    state.grainDraft.position = 0.3;
    const c = $('cgPad');
    drawCloudPad(c);
    const geo = cloudPadGeometry(c);
    const r = c.getBoundingClientRect();
    return geo && {
      x: r.left + geo.x(geo.head), y: r.top + geo.h / 2, w: r.width,
      backing: c.width, position: state.grainDraft.position,
    };
  });
  expect(at, 'the pad has nothing to draw against').not.toBeNull();
  expect(at.backing, 'the pad was never drawn').toBeGreaterThan(0);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x + at.w * 0.25, at.y, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const got = await page.evaluate(() => ({
    position: state.grainDraft.position,
    compact: document.querySelector('#cgKnobs .knob[data-macro="position"] .v').textContent,
    full: state.grainRows.position.querySelector('.v').textContent,
  }));
  expect(got.position, 'the pad did not move the read position').toBeGreaterThan(at.position);
  expect(got.compact, 'the Position knob did not follow the pad').toBe(got.full);
});

async function enterSeq(page) {
  await ready(page);
  await page.locator('#leftRail [data-mode="seq"]').click();
  await page.waitForFunction(() => seq.ready === true, { timeout: 20_000 });
  return page.frames().find((f) => f.url().includes('/sequencer/'));
}

test('the sequencer lays itself out compact inside its own page, and again after a reload', async ({ page }) => {
  const frame = await enterSeq(page);
  const full = await frame.evaluate(() => ({
    compact: document.body.classList.contains('compact'),
    header: getComputedStyle(document.querySelector('.header')).display,
    menu: getComputedStyle(document.getElementById('compactScale').closest('.knob-group')).display,
  }));
  expect(full.compact).toBe(false);
  expect(full.header).not.toBe('none');
  expect(full.menu, 'the compact scale menu shows in the full page').toBe('none');

  await page.evaluate(() => seqCompact(true));
  await frame.waitForFunction(() => document.body.classList.contains('compact'));
  const compact = await frame.evaluate(() => {
    const hidden = (sel) => getComputedStyle(document.querySelector(sel)).display === 'none';
    const menu = document.getElementById('compactScale');
    return {
      stillShowing: ['.header', '.scale-panel', '.preset-group', '.capture-group', '.synth-lfo',
        '.synth-row-scroll', '.perf-panel', '.keyboard-panel', '.status-bar', '#playBtn'].filter((s) => !hidden(s)),
      gone: ['.transport', '.synth-voice', '.seq-panel', '#stepGrid'].filter((s) => hidden(s)),
      columns: getComputedStyle(document.getElementById('stepGrid')).gridTemplateColumns.split(' ').length,
      menu: getComputedStyle(menu.closest('.knob-group')).display,
      options: menu.options.length,
      scales: SCALES.length,
      value: menu.value,
      selected: selectedScaleIdx,
    };
  });
  expect(compact.stillShowing, 'still showing in the compact layout').toEqual([]);
  expect(compact.gone, 'hidden in the compact layout').toEqual([]);
  expect(compact.columns).toBe(8);
  expect(compact.menu).not.toBe('none');
  expect(compact.options).toBe(compact.scales);
  expect(compact.value).toBe(String(compact.selected));

  // The menu chooses the scale, and the library's choice shows in the menu.
  const pick = await frame.evaluate(() => {
    const menu = document.getElementById('compactScale');
    const idx = (selectedScaleIdx + 3) % SCALES.length;
    menu.value = String(idx);
    menu.dispatchEvent(new Event('change', { bubbles: true }));
    const out = {
      idx, selected: selectedScaleIdx,
      name: document.getElementById('activeScaleName').textContent,
      want: SCALES[idx].name.toUpperCase(),
    };
    selectScale(1);
    out.menuFollows = menu.value;
    return out;
  });
  expect(pick.selected).toBe(pick.idx);
  expect(pick.name).toBe(pick.want);
  expect(pick.menuFollows).toBe('1');

  // A reload brings the frame back in its full layout; the host says compact again.
  await page.evaluate(() => { seq.ready = false; seqFrame().src = `/sequencer/?reload=${Date.now()}`; });
  await page.waitForFunction(() => seq.ready === true, { timeout: 20_000 });
  const again = page.frames().find((f) => f.url().includes('/sequencer/'));
  await again.waitForFunction(() => document.body.classList.contains('compact'), null, { timeout: 5_000 });

  await page.evaluate(() => seqCompact(false));
  await again.waitForFunction(() => !document.body.classList.contains('compact'), null, { timeout: 5_000 });
});

test('the picture bar picks the view and the look, and sets the camera', async ({ page }) => {
  await openFile(page);
  await mount(page, 'composePictureMount');
  const got = await page.evaluate(() => {
    buildVisModulePicker();
    const opts = (id) => [...$(id).options].map((o) => o.value);
    const out = {
      same: JSON.stringify(opts('cpVisual')) === JSON.stringify(opts('rgVisual')),
      count: opts('cpVisual').length,
    };
    const sel = $('cpVisual');
    sel.value = 'ridge';
    sel.dispatchEvent(new Event('change'));
    out.visual = roomEdit.visual;
    out.module = visModuleKey();
    out.stageBar = $('rgVisual').value;
    sel.value = 'room';
    sel.dispatchEvent(new Event('change'));
    SectionPresets.save(localStorage, 'visual', 'Compose test look', visualSnapshot());
    paintVisualPresets('');
    out.look = [...$('cpLook').options].some((o) => o.value === 'Compose test look');
    SectionPresets.remove(localStorage, 'visual', 'Compose test look');
    paintVisualPresets('');
    return out;
  });
  expect(got.same, 'the bar lists different visuals from the stage bar').toBe(true);
  expect(got.count).toBeGreaterThan(3);
  expect(got.visual).toBe('ridge');
  expect(got.module).toBe('ridge');
  expect(got.stageBar, 'the stage bar did not follow').toBe('ridge');
  expect(got.look, 'a saved look is not in the bar').toBe(true);

  await page.click('#testHost [data-cam="top"]');
  const top = await page.evaluate(() => {
    const p = roomWorldNow().pitch;
    delete roomEdit.cams[roomEdit.frame];
    saveRoomCameras();
    return p;
  });
  expect(top, 'Top did not look straight down').toBeCloseTo(-89, 6);

  await page.click('#cpFull');
  expect(await page.evaluate(() => state.mode)).toBe('room');
});

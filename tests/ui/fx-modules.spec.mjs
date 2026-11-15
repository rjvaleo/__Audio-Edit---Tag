// The module shell (SUITE-PLAN §4.1, P3): every slot that is a mode of a
// module carries a mode bar under its head — the module's families as tabs, the
// mode as a dropdown, the class badge with the original in its tooltip — and,
// for a Hyperprism, SoundHack or Lexicon mode, the switch between the MGL face
// and the original's look.
//
// What is checked: every listed mode's face draws with its bar and with no row
// that ends half empty; switching the mode keeps the slot, remembers the mode
// left and restores it on the way back; a lane on a control the new mode does
// not have is kept and dimmed, never deleted; the face style is the slot's and
// is saved; and controls that declare a role are filed by it.

import { test, expect } from './test.mjs';

async function openRack(page) {
  await page.goto('/');
  await page.waitForFunction(
    () => typeof state !== 'undefined' && (state.folders || []).length > 0, { timeout: 20_000 });
  await page.evaluate(async () => {
    const folder = state.folders[0].name;
    const files = await api(`/api/files?folder=${encodeURIComponent(folder)}`);
    await postJSON('/api/rack', { p: files[0].path, sr: 44100, slots: [] });
    await postJSON('/api/automation', { p: files[0].path, lanes: [], bypassed: false }).catch(() => {});
    await selectFile(files[0]);
    setMode('edit');
  });
  await page.locator('.dock-tab[data-dock="effects"]').click();
  await page.waitForFunction(() => state.rack && (state.suites || []).length > 0);
}

/// Add a mode as the picker does, and wait until the server has it.
async function addMode(page, suite, mode) {
  await page.evaluate(([s, m]) => {
    const mo = state.suites.find((x) => x.id === s).families.flatMap((f) => f.modes).find((x) => x.id === m);
    addFxModule(mo.kind, { ...mo, suite: s });
  }, [suite, mode]);
  await page.waitForFunction(async () => {
    const id = state.rack.slots.at(-1)?.id;
    const r = await api(`/api/rack?p=${encodeURIComponent(state.selectedFile.path)}`);
    return (r.slots || []).some((s) => s.id === id);
  });
  return page.locator('.fx-module').last();
}

/// The slot as the server stores it.
async function stored(page, index = -1) {
  await page.waitForTimeout(300);
  return page.evaluate(async (i) => {
    const r = await api(`/api/rack?p=${encodeURIComponent(state.selectedFile.path)}`);
    return r.slots.at(i);
  }, index);
}

/// Pick a mode in a module's bar, through its dropdown's menu (every mode of
/// the module, filed by family).
async function pickMode(module, label) {
  await module.locator('.fx-modebar .ui-dd').click();
  await module.page().locator('.ui-menu .ui-mi .ui-mt').getByText(label, { exact: true }).first().click();
}

test('every listed mode draws its face with a mode bar, one width, and no row ends half empty', async ({ page }) => {
  await openRack(page);
  const modes = await page.evaluate(() => state.suites.filter((s) => s.offered)
    .flatMap((s) => s.families.flatMap((f) => f.modes.filter((m) => m.listed).map((m) => [s.id, m.id]))));
  expect(modes.length).toBeGreaterThan(60);
  const bad = [];
  // The original's look is checked by its own tests; the MGL face of every
  // Hyperprism, SoundHack and Lexicon mode is checked here as well.
  const all = [];
  for (const [suite, mode] of modes) {
    all.push([suite, mode, null]);
    if (await page.evaluate(([s, id]) => {
      const mo = state.suites.find((x) => x.id === s).families.flatMap((f) => f.modes).find((x) => x.id === id);
      return !!fxSuiteOf(state.shapers[mo.kind]);
    }, [suite, mode])) all.push([suite, mode, 'mgl']);
  }
  for (const [suite, mode, face] of all) {
    const result = await page.evaluate(([s, id, look]) => {
      const su = state.suites.find((x) => x.id === s);
      const mo = su.families.flatMap((f) => f.modes).find((x) => x.id === id);
      state.rack.slots = [];
      addFxModule(mo.kind, { ...mo, suite: s });
      if (look) { state.rack.slots[0].face = look; renderRack(); }
      const m = document.querySelector('.fx-module');
      const bar = m?.querySelector(':scope > .fx-modebar');
      if (!bar) return 'no mode bar';
      if (bar.dataset.suite !== s || bar.dataset.mode !== id) return `bar says ${bar.dataset.suite}/${bar.dataset.mode}`;
      if (!bar.querySelector('.fx-class-badge')?.title) return 'no badge with its source';
      if (bar.querySelector('.ui-dd .ui-dt')?.textContent !== mo.label) return `dropdown reads ${bar.querySelector('.ui-dd .ui-dt')?.textContent}`;
      const fams = su.families.filter((f) => f.modes.some((x) => x.listed));
      const tabs = bar.querySelectorAll('.fx-mode-families [role="radio"]').length;
      if (tabs !== (fams.length > 1 ? fams.length : 0)) return `${tabs} family tabs for ${fams.length} families`;
      if (Math.round(m.getBoundingClientRect().width) !== FX_FACE_W) return `width ${m.getBoundingClientRect().width}`;
      if (bar.scrollWidth > bar.clientWidth + 1) return 'the bar overflows';
      // Groups run the module's full width: every row's sections fill it.
      for (const row of m.querySelectorAll('.fx-row')) {
        const w = row.getBoundingClientRect().width;
        const gap = parseFloat(getComputedStyle(row).columnGap) || 0;
        const used = [...row.children].reduce((a, c) => a + c.getBoundingClientRect().width, 0) + gap * (row.children.length - 1);
        if (used < w - 4) return `a row ends ${Math.round(w - used)} px short`;
      }
      if ([...m.querySelectorAll('.fx-sect')].some((x) => !x.querySelector(':scope > div')?.children.length)) return 'an empty group';
      // Nothing runs past the module's edge.
      const edge = m.querySelector('.fx-module-controls').getBoundingClientRect().right + 0.5;
      const over = [...m.querySelectorAll('.fx-row .fxk, .fx-row .fxf, .fx-row .fxt')].find((c) => c.getBoundingClientRect().right > edge);
      if (over) return `${over.textContent.trim().slice(0, 24)} runs ${Math.round(over.getBoundingClientRect().right - edge)} px past the edge`;
      // And every knob keeps its whole ring.
      const cut = [...m.querySelectorAll('.fx-row .fxk')].find((k) => {
        const ring = k.querySelector('.ui-kr')?.getBoundingClientRect(), b = k.getBoundingClientRect();
        return ring && (ring.left < b.left - 0.5 || ring.right > b.right + 0.5);
      });
      if (cut) return `${cut.textContent.trim().slice(0, 24)}: its ring is cut`;
      return '';
    }, [suite, mode, face]);
    if (result) bad.push(`${suite}/${mode}${face ? ' (MGL face)' : ''}: ${result}`);
  }
  expect(bad).toEqual([]);
});

test('switching the mode keeps the slot, remembers the mode left, and a lane it cannot reach is kept and dimmed', async ({ page }) => {
  await openRack(page);
  const module = await addMode(page, 'reverb', 'schroeder-reverb');
  const before = await stored(page);
  // A control only the Schroeder has, moved off its default.
  const [key, moved] = await page.evaluate(() => {
    const slot = state.rack.slots[0];
    const own = state.shapers[slot.kind].params;
    const other = state.suites.find((s) => s.id === 'reverb').families.flatMap((f) => f.modes).find((m) => m.id === 'dattorro-plate');
    const theirs = new Set(state.shapers[other.kind].params.map((p) => p.key));
    const p = own.find((x) => !theirs.has(x.key) && x.max > x.min);
    const v = p.min + (p.max - p.min) * 0.37;
    slot.params[p.key] = v;
    return [p.key, v];
  });
  await page.evaluate(() => pushRack({ immediate: true }));
  // A lane on it.
  await page.evaluate(async ([k]) => {
    const slot = state.rack.slots[0];
    state.automation.lanes = [{ id: 'lane-a', target: `fx.${slot.id}.${k}`, label: k, enabled: true, trim: 0, loop: null,
      points: [{ frame: 0, value: 0.2 }, { frame: 20000, value: 0.8 }] }];
    state.automationSel = 'lane-a';
    await saveAutomation();
    await refreshAutomationTargets();
  }, [key]);

  await pickMode(page.locator('.fx-module').first(), await page.evaluate(() =>
    state.suites.find((s) => s.id === 'reverb').families.flatMap((f) => f.modes).find((m) => m.id === 'dattorro-plate').label));
  await page.waitForFunction(() => state.rack.slots[0]?.mode === 'dattorro-plate');
  const after = await stored(page);
  expect(after.id).toBe(before.id);
  expect(after.mode).toBe('dattorro-plate');
  expect(after.suite).toBe('reverb');
  expect(after.memory?.['schroeder-reverb']?.[key]).toBeCloseTo(moved, 4);
  // An exact mode opens at its original's defaults.
  const plateDefaults = await page.evaluate(() => {
    const slot = state.rack.slots[0];
    return state.shapers[slot.kind].params.every((p) => Math.abs(slot.params[p.key] - p.default) < 1e-6);
  });
  expect(plateDefaults).toBe(true);
  // The lane is still there, says it is missing, and is drawn dim.
  await page.evaluate(() => refreshAutomationTargets());
  const lane = await page.evaluate(() => ({
    kept: state.automation.lanes.some((l) => l.id === 'lane-a'),
    missing: document.querySelector('.automation-lane[data-lane="lane-a"]')?.classList.contains('missing'),
  }));
  expect(lane).toEqual({ kept: true, missing: true });

  // And back: the Schroeder's own value returns, and the lane reaches it again.
  await pickMode(page.locator('.fx-module').first(), await page.evaluate(() =>
    state.suites.find((s) => s.id === 'reverb').families.flatMap((f) => f.modes).find((m) => m.id === 'schroeder-reverb').label));
  await page.waitForFunction(() => state.rack.slots[0]?.mode === 'schroeder-reverb');
  const back = await stored(page);
  expect(back.params[key]).toBeCloseTo(moved, 4);
  await page.evaluate(() => refreshAutomationTargets());
  expect(await page.evaluate(() => document.querySelector('.automation-lane[data-lane="lane-a"]')?.classList.contains('missing'))).toBe(false);
  void module;
});

test('a family tab opens that family on its first mode', async ({ page }) => {
  await openRack(page);
  const [suite, fam] = await page.evaluate(() => {
    const s = state.suites.find((x) => x.offered && x.families.filter((f) => f.modes.some((m) => m.listed)).length > 1);
    return [s.id, s.families.filter((f) => f.modes.some((m) => m.listed)).map((f) => ({ label: f.label, first: f.modes.find((m) => m.listed).id }))];
  });
  const module = await addMode(page, suite, fam[0].first);
  await module.locator('.fx-mode-families [role="radio"]', { hasText: fam[1].label }).click();
  await page.waitForFunction((id) => state.rack.slots[0]?.mode === id, fam[1].first);
  expect((await stored(page)).mode).toBe(fam[1].first);
  await expect(page.locator('.fx-module').first().locator('.fx-mode-families [role="radio"].on')).toHaveText(fam[1].label);
});

test('a Hyperprism, SoundHack or Lexicon mode switches between its original look and the MGL face, and keeps it', async ({ page }) => {
  await openRack(page);
  for (const [suite, mode, look] of [['delay', 'hp-echo', '.hp-face'], ['delay', 'sh-delay', '.sh-face'], ['reverb', 'lxp-hall', '.lex-face']]) {
    await page.evaluate(() => { state.rack.slots = []; renderRack(); });
    let module = await addMode(page, suite, mode);
    await expect(module.locator(look)).toHaveCount(1);
    const toggle = module.locator('.fx-face-style');
    await expect(toggle.locator('[role="radio"].on')).toHaveText('Original');
    await toggle.locator('[role="radio"]', { hasText: 'MGL' }).click();
    module = page.locator('.fx-module').last();
    await expect(module.locator(look)).toHaveCount(0);
    await expect(module).toHaveClass(/fx-face/);
    expect(Math.round((await module.boundingBox()).width)).toBe(348);
    expect((await stored(page)).face).toBe('mgl');
    // Reopened, it is still the MGL face.
    await page.evaluate(() => loadRack());
    module = page.locator('.fx-module').last();
    await expect(module.locator(look)).toHaveCount(0);
    await expect(module.locator('.fx-face-style [role="radio"].on')).toHaveText('MGL');
    await module.locator('.fx-face-style [role="radio"]', { hasText: 'Original' }).click();
    await expect(page.locator('.fx-module').last().locator(look)).toHaveCount(1);
    expect((await stored(page)).face).toBe('original');
  }
  // A mode of the program's own has no second look to offer.
  await page.evaluate(() => { state.rack.slots = []; renderRack(); });
  const own = await addMode(page, 'utility', 'gain');
  await expect(own.locator('.fx-face-style')).toHaveCount(0);
});

test('controls that declare a role are filed by it, in the roles\' order', async ({ page }) => {
  await openRack(page);
  const labels = await page.evaluate(() => {
    state.shapers['prism:role-check'] = { kind: 'prism:role-check', label: 'Role check', source: 'MultiGrainLive', category: 'delay',
      panel: { groups: [], displays: [] },
      params: [
        { key: 'mix', label: 'Mix', min: 0, max: 1, default: 0.5, role: 'output' },
        { key: 'time', label: 'Time', min: 1, max: 1000, default: 300, unit: 'ms', role: 'time' },
        { key: 'tone', label: 'Tone', min: 0, max: 1, default: 0.5, role: 'tone' },
        { key: 'fb', label: 'Feedback', min: 0, max: 1, default: 0.4, role: 'time' },
      ] };
    const el = fxPreviewModule('prism:role-check');
    document.body.appendChild(el);
    const out = [...el.querySelectorAll('.fx-sect > b span')].map((s) => s.textContent);
    el.remove();
    delete state.shapers['prism:role-check'];
    return out;
  });
  expect(labels).toEqual(['Time', 'Tone', 'Output']);
});

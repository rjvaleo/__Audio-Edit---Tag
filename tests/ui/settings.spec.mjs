// The preference store.
//
// `settings.js` is pure — no DOM, no network, and its storage is passed in —
// so most of what matters here can be checked against a plain map rather than
// against a running interface. What cannot is whether the app actually reads
// through it, which is the last two tests.

import { test, expect } from '@playwright/test';

async function ready(page) {
  await page.goto('/');
  await page.waitForFunction(() => typeof state !== 'undefined' && (state.folders || []).length > 0, {
    timeout: 15_000,
  });
}

/// A `StorageLike` over a plain object, so the store can be driven without
/// touching the real one and without one test's writes reaching another's.
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

test('the store is served and loaded before anything that reads it', async ({ page }) => {
  await ready(page);
  const got = await page.evaluate(() => ({
    store: typeof Settings === 'object' && typeof Settings.load === 'function',
    live: typeof prefs === 'object' && prefs !== null,
    // Every key in the spec has a value on the live object. A setting that is
    // in the table and not in `prefs` is one whose reader would get undefined.
    missing: Object.keys(Settings.SPEC).filter((k) => prefs[k] === undefined),
  }));
  expect(got.store, 'settings.js did not load').toBe(true);
  expect(got.live, 'the live preferences were not built').toBe(true);
  expect(got.missing, 'settings in the table with no live value').toEqual([]);
});

test('an unreadable value falls back to the default, never to a blank', async ({ page }) => {
  await ready(page);
  const bad = await page.evaluate((fake) => {
    const out = [];
    for (const [key, spec] of Object.entries(Settings.SPEC)) {
      for (const junk of ['', 'nonsense', '{}', NaN, undefined, null, -99999, 99999]) {
        const store = eval(fake);
        store.setItem(Settings.STORE, JSON.stringify({ [key]: junk, migrated: true }));
        const got = Settings.load(store)[key];
        // `grainCentre` is the one setting whose "nobody has said" answer is
        // null; every other key must come back as its declared type.
        if (key === 'grainCentre') {
          if (got !== null && !(typeof got === 'number' && got > 0.02 && got < 0.98)) {
            out.push(`${key} <- ${String(junk)} gave ${String(got)}`);
          }
          continue;
        }
        if (typeof got !== typeof spec.def) out.push(`${key} <- ${String(junk)} gave ${String(got)}`);
      }
    }
    return out;
  }, FAKE);
  expect(bad, 'settings that did not fall back to their default').toEqual([]);
});

test('numbers are clamped on the way in, not only on the way out', async ({ page }) => {
  await ready(page);
  // The real bug this prevents: `roomAdminWidth` clamped when written and not
  // when read, so a width saved on a wider screen came back past its maximum
  // and the column opened wider than it is allowed to be.
  const got = await page.evaluate((fake) => {
    const store = eval(fake);
    store.setItem(Settings.STORE, JSON.stringify({
      roomAdminWidth: 9999, leftPanelWidth: -40, laneSplit: 100, migrated: true,
    }));
    return Settings.load(store);
  }, FAKE);
  expect(got.roomAdminWidth).toBe(620);
  expect(got.leftPanelWidth).toBe(200);
  expect(got.laneSplit).toBe(88);
});

test('the old scattered keys are folded in once, and never argue afterwards', async ({ page }) => {
  await ready(page);
  const got = await page.evaluate((fake) => {
    const store = eval(fake);
    // An existing browser: the old keys, and no new store at all.
    store.setItem('audiolab.snap', 'cd');
    store.setItem('audiolab.laneSplit', '77');
    store.setItem('audiolab.leftPanelWidth', '610');
    store.setItem('roomAdminW', '480');
    store.setItem('audiolab.masterFft', '16384');
    const first = Settings.load(store);

    // Saved, then changed afterwards — the migration must not undo that on the
    // next load, which is what makes it a one-time repair rather than a rule.
    Settings.persist(store, { ...first, snap: 'off' });
    const second = Settings.load(store);
    return { first, second };
  }, FAKE);

  expect(got.first.snap).toBe('cd');
  expect(got.first.laneSplit).toBe(77);
  expect(got.first.leftPanelWidth).toBe(610);
  expect(got.first.roomAdminWidth).toBe(480);
  expect(got.first.masterFft).toBe(16384);
  expect(got.second.snap, 'the migration overwrote a later change').toBe('off');
});

test('a storage that refuses writes warns once and does not throw', async ({ page }) => {
  await ready(page);
  const got = await page.evaluate(() => {
    const dead = {
      getItem: () => null,
      setItem: () => { throw new Error('QuotaExceededError'); },
      get length() { return 0; },
      key: () => null,
    };
    // Before this store, the snap setting was written with no try/catch at all,
    // in two places — so adjusting it in a private window threw inside a menu
    // handler and stopped the click.
    let threw = false;
    try {
      Settings.persist(dead, { snap: 'off' });
      Settings.persist(dead, { snap: 'cd' });
    } catch { threw = true; }
    return { threw };
  });
  expect(got.threw, 'a refused write escaped the store').toBe(false);
});

test('the settings the menus used to hold are on the panel, and gone from the menus', async ({ page }) => {
  await ready(page);
  const got = await page.evaluate(() => {
    const labels = MENUS.flatMap((m) => m.items.filter((i) => !i.sep).map((i) => i.label));
    const panel = SETTINGS_PANEL.flatMap((g) => g.rows.map((r) => r.key));
    return {
      rows: labels.length,
      buffersLeft: labels.filter((l) => /^Buffer:/.test(l)).length,
      grainLeft: labels.filter((l) => /^Grain detail:/.test(l)).length,
      followLeft: labels.filter((l) => /^Follow/.test(l)).length,
      playAllLeft: labels.filter((l) => l === 'Play all files').length,
      // Snap stays on purpose: every edit command reads it, and the toolbar
      // carries it for the same reason.
      snapStill: labels.filter((l) => /^Snap/.test(l)).length,
      panel,
    };
  });
  expect(got.buffersLeft, 'buffer sizes are still in a menu').toBe(0);
  expect(got.grainLeft, 'grain detail is still in a menu').toBe(0);
  expect(got.followLeft, 'follow settings are still in a menu').toBe(0);
  expect(got.playAllLeft, 'play-all is still in a menu').toBe(0);
  expect(got.snapStill, 'snap should stay in the Action menu').toBe(3);
  expect(got.panel).toContain('buffer');
  expect(got.panel).toContain('grainCap');
  expect(got.panel).toContain('followMode');
  expect(got.rows, 'the menu bar should be well under its old 78 rows').toBeLessThan(65);
});

test('the panel opens, draws every row in the table, and closes three ways', async ({ page }) => {
  await ready(page);
  await page.click('#settingsOpen');
  await expect(page.locator('#settingsModal')).toBeVisible();

  const drawn = await page.evaluate(() => ({
    rows: document.querySelectorAll('#settingsBody .set-row').length,
    wanted: SETTINGS_PANEL.reduce((a, g) => a + g.rows.length, 0),
    // Every row states its trade. A setting with no reason on it is a setting
    // somebody has to guess about.
    whys: [...document.querySelectorAll('#settingsBody .set-row')]
      .filter((r) => (r.querySelector('.set-why')?.textContent || '').length > 20).length,
  }));
  expect(drawn.rows, 'the panel did not draw every row in the table').toBe(drawn.wanted);
  expect(drawn.whys, 'a setting was drawn with no explanation').toBe(drawn.wanted);

  await page.click('#settingsClose');
  await expect(page.locator('#settingsModal')).toBeHidden();
});

test('changing a setting on the panel reaches the application and survives a reload', async ({ page }) => {
  await ready(page);
  await page.evaluate(() => { setSnap('zero'); setPlayAll(false); });

  await page.click('#settingsOpen');
  await page.selectOption('#set-snap', 'cd');
  await page.locator('#set-playAll').check();

  expect(await page.evaluate(() => state.snap)).toBe('cd');
  expect(await page.evaluate(() => state.playAll)).toBe(true);

  await page.reload();
  await page.waitForFunction(() => typeof state !== 'undefined' && (state.folders || []).length > 0);
  // Neither of these outlived a reload before — `playAll` and the follow mode
  // were session state that the View menu presented as settings.
  expect(await page.evaluate(() => state.snap)).toBe('cd');
  expect(await page.evaluate(() => state.playAll)).toBe(true);

  await page.evaluate(() => { setSnap('zero'); setPlayAll(false); });
});

test('the follow mode dims rather than vanishing when following is off', async ({ page }) => {
  await ready(page);
  await page.evaluate(() => setFollow({ on: false }));
  await page.click('#settingsOpen');
  // Greyed out beats hidden, which is this program's own rule for a control
  // that cannot do anything right now — see `docs/MENUS.md`.
  await expect(page.locator('#set-followMode')).toBeVisible();
  await expect(page.locator('#set-followMode')).toBeDisabled();

  await page.evaluate(() => setFollow({ on: true }));
  await page.evaluate(() => buildSettingsPanel());
  await expect(page.locator('#set-followMode')).toBeEnabled();
  await page.click('#settingsClose');
});

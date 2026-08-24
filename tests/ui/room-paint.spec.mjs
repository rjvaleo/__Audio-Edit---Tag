// The room's palette: a ramp per drawn thing, and what that ramp is read
// against.
//
// The two things worth pinning here are opposites of each other:
//
//   - a palette with nothing set has to leave the room **exactly** as it was,
//     and
//   - a palette with something set has to actually reach the pixels.
//
// The first is easy to get almost right and almost right is worthless: a
// reconstruction of the old two-colour behaviour that is a shade off would look
// fine and be wrong in every screenshot ever taken afterwards.

import { test, expect } from '@playwright/test';

async function openRoom(page) {
  await page.goto('/');
  await page.waitForFunction(
    () => typeof setMode === 'function' && typeof rpForRenderer === 'function',
    { timeout: 20_000 },
  );
  await page.evaluate(() => {
    localStorage.removeItem('roomPaintCurrent');
    localStorage.removeItem('roomPaintSchemes');
    roomPaint.scheme = rpDefaultScheme();
    rpTouch();
    setMode('room');
  });
  await page.waitForSelector('#roomStageRoom #visGl', { state: 'visible', timeout: 20_000 });
}

/// Draw the floor and nothing else, at a flat level, and read the colour at
/// three places across it.
///
/// **Flat on purpose.** Every band is pushed at the same level, so `Level` — the
/// quantity the room has always coloured by — is constant across the whole
/// floor. Any colour that varies left to right can then only have come from the
/// drive being asked for. With a shaped spectrum the test would pass on a
/// renderer that ignored the drive entirely.
///
/// Quiet on purpose too. The floor is fifty-six rows blended additively, and at
/// a normal level they sum past 255 — every channel clips and the whole floor
/// reads white, which hides exactly the thing being measured.
const FLOOR_PROBE = `(async (opts) => {
  const el = document.getElementById('visGl');
  const settle = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  roomEdit.frame = 'dock'; applyRoomFrame();
  roomEdit.layers = { ...roomEdit.layers,
    floor: true, lead: false, grains: false, sky: false, skin: false, room: false, data: false };
  if (visGl.clear) visGl.clear();
  for (let p = 0; p < 60; p++) {
    const b = new Float32Array(128);
    for (let i = 0; i < 128; i++) b[i] = opts.db;
    visGl.push(b, new Float32Array(2048));
  }
  await settle(); await settle(); await settle();
  const c = document.createElement('canvas');
  c.width = 200; c.height = 150;
  const cx = c.getContext('2d');
  cx.drawImage(el, 0, 0, 200, 150);
  const d = cx.getImageData(0, 0, 200, 150).data;
  const band = (x0, x1) => {
    let r = 0, g = 0, b = 0, n = 0;
    for (let y = 0; y < 150; y++) for (let x = x0; x < x1; x++) {
      const i = (y * 200 + x) * 4;
      if (d[i] + d[i+1] + d[i+2] > 18) { r += d[i]; g += d[i+1]; b += d[i+2]; n++; }
    }
    return n ? { r: Math.round(r/n), g: Math.round(g/n), b: Math.round(b/n), n } : { n: 0 };
  };
  return { L: band(6, 50), M: band(80, 120), R: band(150, 194) };
})`;

test('a palette with nothing set is sent to the renderer as nothing', async ({ page }) => {
  await openRoom(page);
  const fresh = await page.evaluate(() => rpForRenderer().slots);
  // Not "an empty object" and not "every slot at its theme colour" — nothing at
  // all, so the shader takes the two-colour branch it always took. This is what
  // makes the default identical rather than merely close.
  expect(fresh).toBeNull();

  // One slot set, and only that slot travels.
  const one = await page.evaluate(() => {
    rpSetSlot('ring', { mode: 'flat', colour: '#ff0000' });
    return Object.keys(rpForRenderer().slots || {});
  });
  expect(one).toEqual(['ring']);
});

test('the panel lists every paintable thing, and says what each is set to', async ({ page }) => {
  await openRoom(page);
  await page.click('#roomAdmin .rv-tab[data-rvtab="paint"]');
  const rows = await page.evaluate(() =>
    [...document.querySelectorAll('#roomPaintBody .rp-slot')].map((el) => ({
      name: el.querySelector('.rp-slot-name').textContent,
      mode: el.querySelector('.rp-slot-mode').textContent,
      hasStrip: !!el.querySelector('.rp-strip').style.background,
    })));
  // **Fourteen for the room, and no longer three for the card of type.** The
  // card's panel is not in the admin — see `ROOM_TEXT_IN_ADMIN` — and colours for
  // something nothing offers to draw are three rows that paint nothing. Nothing
  // is deleted: `RT_SLOTS` is still described, and putting the panel back puts
  // the rows back with it.
  expect(rows.length).toBe(14);
  expect(rows.map((r) => r.name), 'the card of type is still offering colours')
    .not.toContain('Type edge');
  expect(rows.every((r) => r.mode === 'theme')).toBe(true);
  expect(rows.every((r) => r.hasStrip)).toBe(true);
  // The three the analysis found painted with a gradient between a colour and
  // itself. If the shipped theme ever gives `--accent` and `--wave-2` different
  // values this stops being true, which is worth being told about.
  const flatOnes = await page.evaluate(() =>
    ['grainBloom', 'grainWire', 'mist'].map((k) => {
      const [a, b] = rpInheritedPair(k);
      return a === b;
    }));
  expect(flatOnes).toEqual([true, true, true]);
});

test('a ramp read against frequency colours the floor across its width', async ({ page }) => {
  await openRoom(page);
  const got = await page.evaluate(`${FLOOR_PROBE}({ db: -46 })`, null);
  // Before: the floor inherits, so it is one hue however wide it is.
  const flatBefore = Math.abs(got.L.r - got.R.r) < 12 && Math.abs(got.L.b - got.R.b) < 12;
  expect(flatBefore, 'the floor starts out one colour across').toBe(true);

  const rainbow = await page.evaluate(`(async () => {
    const ramp = (drive) => ({ mode: 'ramp', drive, lo: 0, hi: 1, curve: 1,
      stops: [{ at: 0, c: '#ff0000' }, { at: 0.5, c: '#00ff00' }, { at: 1, c: '#0000ff' }] });
    // Both halves of the floor. The surface is most of the lit area and the
    // ridges are drawn over it, so setting only one leaves the other's
    // inherited colour sitting on top of the answer.
    roomPaint.scheme = { name: 'probe', slots: { terrainMesh: ramp(5), terrainRidge: ramp(5) } };
    rpTouch(); rpApply();
    return await ${FLOOR_PROBE}({ db: -46 });
  })()`);

  expect(rainbow.L.n, 'the floor is drawn at all').toBeGreaterThan(200);
  expect(rainbow.L.r, 'low frequencies take the first stop').toBeGreaterThan(rainbow.R.r + 60);
  expect(rainbow.R.b, 'high frequencies take the last').toBeGreaterThan(rainbow.L.b + 60);
  expect(rainbow.M.g, 'and the middle takes the middle')
    .toBeGreaterThanOrEqual(Math.max(rainbow.L.g, rainbow.R.g));
});

test('the same ramp read against level does not vary across the floor', async ({ page }) => {
  await openRoom(page);
  // The control for the test above: same three colours, same floor, same flat
  // signal — only the drive differs. Level is constant everywhere here, so a
  // renderer that quietly ignored the drive and always read level would fail
  // the frequency test; one that ignored it the other way fails this one.
  const got = await page.evaluate(`(async () => {
    const ramp = (drive) => ({ mode: 'ramp', drive, lo: 0, hi: 1, curve: 1,
      stops: [{ at: 0, c: '#ff0000' }, { at: 0.5, c: '#00ff00' }, { at: 1, c: '#0000ff' }] });
    roomPaint.scheme = { name: 'probe', slots: { terrainMesh: ramp(0), terrainRidge: ramp(0) } };
    rpTouch(); rpApply();
    return await ${FLOOR_PROBE}({ db: -46 });
  })()`);
  expect(got.L.n).toBeGreaterThan(200);
  expect(Math.abs(got.L.r - got.R.r), 'level is flat, so the colour is flat').toBeLessThan(40);
});

test('the strip in the panel is the ramp the room is drawn with', async ({ page }) => {
  await openRoom(page);
  const same = await page.evaluate(() => {
    rpSetSlot('ring', { mode: 'ramp', drive: 0, lo: 0, hi: 1, curve: 1,
      stops: [{ at: 0, c: '#112233' }, { at: 1, c: '#ddeeff' }] });
    const css = rpGradientCss('ring');
    // The atlas row the shader actually samples, at both ends.
    const { atlas } = rpForRenderer();
    const row = RP_SLOTS.find((s) => s.key === 'ring').row;
    const at = (x) => {
      const o = (row * 256 + x) * 4;
      return [atlas[o], atlas[o + 1], atlas[o + 2]];
    };
    return { css, first: at(0), last: at(255) };
  });
  expect(same.css).toContain('#112233');
  expect(same.first).toEqual([0x11, 0x22, 0x33]);
  expect(same.last).toEqual([0xdd, 0xee, 0xff]);
});

test('a generator paints every object at once', async ({ page }) => {
  await openRoom(page);
  const got = await page.evaluate(() => {
    const out = {};
    for (const g of RP_GENERATORS) {
      roomPaint.scheme = rpGenerate(g.key, 200);
      rpTouch();
      const slots = roomPaint.scheme.slots;
      out[g.key] = {
        covered: RP_SLOTS.every((s) => !!slots[s.key]),
        // The ground has to be one colour: the room adds light to it.
        groundFlat: slots.background.mode === 'flat',
        sent: Object.keys(rpForRenderer().slots || {}).length,
      };
    }
    return out;
  });
  for (const [kind, r] of Object.entries(got)) {
    expect(r.covered, `${kind} leaves nothing unpainted`).toBe(true);
    expect(r.groundFlat, `${kind} gives the room a flat ground`).toBe(true);
    // Twelve things are drawn in the scene; the other two are CSS.
    expect(r.sent, `${kind} reaches the renderer`).toBe(12);
  }
});

test('a scheme can be saved, loaded back and deleted', async ({ page }) => {
  await openRoom(page);
  const got = await page.evaluate(() => {
    rpSetSlot('ring', { mode: 'flat', colour: '#abcdef' });
    rpSave('probe scheme');
    // Wander off, then come back.
    roomPaint.scheme = rpGenerate('bw', 0);
    rpTouch();
    const wandered = rpSlot('ring').colour;
    rpLoad('probe scheme');
    const back = rpSlot('ring');
    const listed = Object.keys(rpSaved());
    rpDelete('probe scheme');
    return { wandered, backMode: back.mode, backColour: back.colour,
      listed, afterDelete: Object.keys(rpSaved()) };
  });
  expect(got.wandered).not.toBe('#abcdef');
  expect(got.backMode).toBe('flat');
  expect(got.backColour).toBe('#abcdef');
  expect(got.listed).toContain('probe scheme');
  expect(got.afterDelete).not.toContain('probe scheme');
});

test('the palette survives a reload', async ({ page }) => {
  await openRoom(page);
  await page.evaluate(() => {
    rpSetSlot('grainCore', { mode: 'flat', colour: '#ff8800' });
    rpApply();
  });
  await page.reload();
  await page.waitForFunction(() => typeof rpForRenderer === 'function');
  const kept = await page.evaluate(() => rpSlot('grainCore'));
  expect(kept.mode).toBe('flat');
  expect(kept.colour).toBe('#ff8800');
});

test('a layer is only offered a drive it actually carries', async ({ page }) => {
  await openRoom(page);
  await page.click('#roomAdmin .rv-tab[data-rvtab="paint"]');
  const got = await page.evaluate(() => {
    const open = (name) => {
      const row = [...document.querySelectorAll('#roomPaintBody .rp-slot')]
        .find((el) => el.querySelector('.rp-slot-name').textContent === name);
      row.querySelector('.rp-slot-head').click();
      const again = [...document.querySelectorAll('#roomPaintBody .rp-slot')]
        .find((el) => el.querySelector('.rp-slot-name').textContent === name);
      [...again.querySelectorAll('.rp-edit .re-btn')].find((b) => b.textContent === 'Ramp')?.click();
      const now = [...document.querySelectorAll('#roomPaintBody .rp-slot')]
        .find((el) => el.querySelector('.rp-slot-name').textContent === name);
      return [...now.querySelectorAll('.rp-edit select.field option')].map((o) => o.text);
    };
    return { terrain: open('Terrain ridges'), ring: open('Ring'), grains: open('Grain wires'), fog: open('Fog') };
  });
  expect(got.terrain).toContain('Frequency');
  expect(got.ring).toContain('Stereo width');
  expect(got.grains).toContain('Pan');
  // The air has nothing of its own, and an option whose attribute is always
  // nought would collapse the ramp to its first colour and read as broken.
  expect(got.fog).not.toContain('Frequency');
  expect(got.fog).not.toContain('Pan');
  expect(got.fog).not.toContain('Stereo width');
});

test('the palette controls can be clicked, not just dispatched at', async ({ page }) => {
  await openRoom(page);
  await page.click('#roomAdmin .rv-tab[data-rvtab="paint"]');
  // With an editor open, so the stops, the drive menu and the range sliders are
  // all in the panel rather than only the fourteen closed rows.
  await page.evaluate(() => {
    rpSetSlot('ring', { mode: 'ramp', drive: 0, lo: 0, hi: 1, curve: 1,
      stops: [{ at: 0, c: '#112233' }, { at: 0.5, c: '#445566' }, { at: 1, c: '#ddeeff' }] });
    rpOpen = 'ring';
    rpPanel();
  });
  const bad = await page.evaluate(() => {
    const body = document.getElementById('roomPaintBody');
    const out = [];
    let checked = 0;
    for (const el of body.querySelectorAll('input, select, button')) {
      el.scrollIntoView({ block: 'center' });
      const b = el.getBoundingClientRect();
      if (!b.width || !b.height) { out.push({ el: el.className, why: 'zero size' }); continue; }
      checked++;
      const hit = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
      if (!hit) { out.push({ el: el.className, why: 'off screen' }); continue; }
      if (hit !== el && !el.contains(hit) && !hit.contains(el)) {
        out.push({ el: el.className, why: `covered by ${hit.id || hit.className || hit.tagName}` });
      }
      const p = body.getBoundingClientRect();
      if (b.right > p.right + 1 || b.left < p.left - 1) {
        out.push({ el: el.className, why: 'drawn outside the panel' });
      }
    }
    return { checked, out };
  });
  expect(bad.out).toEqual([]);
  expect(bad.checked).toBeGreaterThan(15);
});

test('a colour well is not rebuilt while it is being used', async ({ page }) => {
  await openRoom(page);
  await page.click('#roomAdmin .rv-tab[data-rvtab="paint"]');
  // The fault `docs/THEME-EDITOR.md` records: the swatches were rebuilt on every
  // `input`, so the very element the system's colour panel was attached to was
  // destroyed under it, over and over. **The value arrived correctly the whole
  // time**, so asserting on the palette would have passed on the fault forever.
  // What has to survive is the element.
  const alive = await page.evaluate(() => {
    rpSetSlot('background', { mode: 'flat', colour: '#101010' });
    rpOpen = 'background';
    rpPanel();
    const well = document.querySelector('#roomPaintBody .rp-edit input[type="color"]');
    if (!well) return { found: false };
    well.focus();
    for (let i = 0; i < 8; i++) {
      well.value = `#1${i}1${i}1${i}`;
      well.dispatchEvent(new Event('input', { bubbles: true }));
    }
    const still = document.querySelector('#roomPaintBody .rp-edit input[type="color"]');
    return { found: true, sameNode: still === well, inDocument: document.contains(well),
      landed: rpSlot('background').colour };
  });
  expect(alive.found).toBe(true);
  expect(alive.inDocument, 'the well is still in the document').toBe(true);
  expect(alive.sameNode, 'and is still the same element').toBe(true);
  expect(alive.landed).toBe('#171717');
});

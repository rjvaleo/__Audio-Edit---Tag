// The Grain v12 page's dock: keys, voice, AMP, and the two leftovers from the
// effects page.
//
// The engine is stood in for: `/api/engine/note`, `voice` and `transport` are
// answered here and every request kept, because a test must not open a sound
// card. What the engine does with them is `core/crates/engine/tests/grain_keys.rs`.

import { test, expect } from './test.mjs';

test.use({ viewport: { width: 1440, height: 900 } });

async function mockEngine(page) {
  const sent = [];
  await page.route(/\/api\/engine\/(note|voice|transport)$/, async (route) => {
    const req = route.request();
    let body = null;
    try { body = req.postData() ? JSON.parse(req.postData()) : null; } catch { body = null; }
    sent.push({ path: new URL(req.url()).pathname, body });
    return route.fulfill({ json: { ok: true, voice: sent.length } });
  });
  return sent;
}

async function openPage(page, { flag = true } = {}) {
  const sent = await mockEngine(page);
  await page.goto('/');
  await page.waitForFunction(() => typeof setMode === 'function' && (state.folders || []).length > 0, null, { timeout: 20_000 });
  await page.evaluate(async (on) => {
    localStorage.clear();
    if (on) setGrainUi('synth');
    const f = await api(`/api/files?folder=${encodeURIComponent(state.folders[0].name)}`);
    await selectFile(f.find((x) => /tone/.test(x.path)) || f[0]);
    setMode('edit');
    // The deck is holding it: no load, which is the one thing that would open a device.
    engine.path = state.selectedFile.path;
    engine.raw = !playsDocument();
  }, flag);
  if (flag) await page.waitForFunction(() => document.querySelector('#gsEngTabs .gs-tab.on') && state.overview, null, { timeout: 20_000 });
  else await page.waitForFunction(() => Object.keys(state.grainRows || {}).length > 0, null, { timeout: 20_000 });
  await page.waitForFunction(() => !!state.stretchDraft);
  await page.waitForTimeout(200);
  return sent;
}

const posted = (sent, path) => sent.filter((s) => s.path === path).map((s) => s.body);
const notes = (sent) => posted(sent, '/api/engine/note');

/// Where a key is, on the page.
async function keyPoint(page, n, frac = 0.8) {
  const box = await page.locator('#gsKeys').boundingBox();
  return page.evaluate(([n, frac, box]) => {
    const g = GS_CV.gsKeys, L = gsKeyLayout(g), [x, w, b] = L[n], h = b ? g.h * 0.3 : g.h * frac;
    return [box.x + (x + w / 2) / g.w * box.width, box.y + h / g.h * box.height];
  }, [n, frac, box]);
}

test('nothing on the dock says it is not connected any more', async ({ page }) => {
  await openPage(page);
  expect(await page.locator('.gs-dock .gs-inert').count()).toBe(0);
  await expect(page.locator('#gsVmode span.on')).toHaveText('Mono');
  await expect(page.locator('#gsVelRo')).toHaveText('vel —');
});

test('coming in sends the voice, with the tuning as 128 semitones', async ({ page }) => {
  const sent = await openPage(page);
  const v = posted(sent, '/api/engine/voice').find((b) => b.keys);
  expect(v).toMatchObject({ mode: 'mono', run: false, replay: true });
  expect(v.keys).toHaveLength(128);
  expect(v.keys[60]).toBe(0);
  expect(v.keys[72]).toBe(12);
});

test('a computer key plays a note and letting go releases it, and neither is an edit', async ({ page }) => {
  const sent = await openPage(page);
  const before = await page.evaluate(() => JSON.stringify([state.stretchDraft, state.edit]));
  const requests = [];
  page.on('request', (r) => { if (r.method() === 'POST') requests.push(new URL(r.url()).pathname); });
  await page.keyboard.down('a');
  await page.waitForTimeout(80);
  await expect(page.locator('#gsVoicesRo')).toContainText('1 voice');
  await page.keyboard.up('a');
  await page.waitForTimeout(150);
  const n = notes(sent);
  expect(n).toHaveLength(2);
  expect(n[0]).toEqual({ on: true, key: 60, velocity: 0.8 });
  expect(n[1]).toEqual({ on: false, key: 60 });
  await expect(page.locator('#gsVelRo')).toHaveText('vel 102');
  expect(requests.filter((p) => !p.startsWith('/api/engine/'))).toEqual([]);
  expect(await page.evaluate(() => JSON.stringify([state.stretchDraft, state.edit]))).toBe(before);
});

test('W is the black key, and Z and X move the row by an octave', async ({ page }) => {
  const sent = await openPage(page);
  await page.keyboard.press('w');
  await page.keyboard.press('x');
  await expect(page.locator('#gsOctRo')).toHaveText('C3');
  await page.keyboard.press('a');
  await page.keyboard.press('z');
  await page.keyboard.press('z');
  await expect(page.locator('#gsOctRo')).toHaveText('C1');
  await page.keyboard.press('a');
  await page.waitForTimeout(150);
  expect(notes(sent).filter((b) => b.on).map((b) => b.key)).toEqual([61, 72, 48]);
});

test('with a scale chosen the keys are its degrees, and an octave is its own', async ({ page }) => {
  const sent = await openPage(page);
  await page.waitForFunction(() => (state.scales || []).length > 0);
  const scale = await page.evaluate(() => {
    const s = state.scales.flatMap((g) => g.scales).find((x) => x.cents.length === 7);
    state.edit.stretch.scale = s.name;
    return { name: s.name, cents: s.cents, span: s.span || 1200 };
  });
  await page.waitForFunction(() => GS_N.sent.scale === currentScale());
  await page.waitForTimeout(200);
  const table = posted(sent, '/api/engine/voice').filter((b) => b.keys).pop().keys;
  expect(table[60]).toBeCloseTo(scale.cents[0] / 100, 3);
  expect(table[61]).toBeCloseTo(scale.cents[1] / 100, 3);
  expect(table[67]).toBeCloseTo(scale.span / 100, 3);
  await page.keyboard.press('x');
  await page.keyboard.press('s');
  await page.waitForTimeout(150);
  // A degree count higher up, so the same degree an octave up.
  expect(notes(sent).find((b) => b.on).key).toBe(60 + 7 + 2);
});

test('the mouse plays the keys, a drag glides, Shift-drag holds', async ({ page }) => {
  const sent = await openPage(page);
  const [x0, y0] = await keyPoint(page, 60);
  const [x1] = await keyPoint(page, 62);
  const [x2] = await keyPoint(page, 64);
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.waitForTimeout(40);
  await page.mouse.move(x1, y0);
  await page.waitForTimeout(40);
  await page.mouse.up();
  await page.waitForTimeout(120);
  expect(notes(sent).map((b) => [b.key, b.on])).toEqual([[60, true], [60, false], [62, true], [62, false]]);
  expect(notes(sent)[0].velocity).toBeGreaterThan(0.4);

  sent.length = 0;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.keyboard.down('Shift');
  await page.mouse.move(x1, y0);
  await page.mouse.move(x2, y0);
  await page.waitForTimeout(40);
  expect(await page.evaluate(() => [...GS_N.held.keys()])).toEqual([60, 62, 64]);
  await page.keyboard.up('Shift');
  await page.mouse.up();
  await page.waitForTimeout(120);
  expect(await page.evaluate(() => GS_N.held.size)).toBe(0);
});

test('window blur lets everything go', async ({ page }) => {
  const sent = await openPage(page);
  await page.keyboard.down('a');
  await page.keyboard.down('d');
  await page.waitForTimeout(40);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.waitForTimeout(120);
  expect(await page.evaluate(() => [GS_N.held.size, GS_N.kbd.size])).toEqual([0, 0]);
  expect(notes(sent).filter((b) => !b.on).map((b) => b.key).sort()).toEqual([60, 64]);
  await page.keyboard.up('a');
  await page.keyboard.up('d');
});

test('Mono, Legato, Poly and Run reach the engine', async ({ page }) => {
  const sent = await openPage(page);
  await page.click('#gsVmode span[data-m="legato"]');
  await expect(page.locator('#gsVmode span.on')).toHaveText('Legato');
  await page.click('#gsVmode span[data-m="poly"]');
  await page.evaluate(() => { $('playBtn').click = () => { window.__played = true; }; });
  await page.click('#gsRunBtn');
  await expect(page.locator('#gsRunBtn')).toHaveClass(/on/);
  await page.waitForTimeout(120);
  const v = posted(sent, '/api/engine/voice');
  expect(v.map((b) => b.mode).filter(Boolean).slice(-2)).toEqual(['legato', 'poly']);
  expect(v.some((b) => b.run === true)).toBe(true);
  expect(await page.evaluate(() => window.__played)).toBe(true);
});

test('Glide and the bend wheel move, and the wheel springs back', async ({ page }) => {
  const sent = await openPage(page);
  const glide = await page.locator('#gsGlide').boundingBox();
  await page.mouse.move(glide.x + 40, glide.y + 10);
  await page.mouse.down();
  await page.mouse.move(glide.x + 80, glide.y + 10);
  await page.mouse.up();
  await page.waitForTimeout(100);
  const gl = posted(sent, '/api/engine/voice').filter((b) => b.glide != null).pop();
  expect(gl.glide).toBeGreaterThan(0.18);

  const w = await page.locator('#gsBend').boundingBox();
  await page.mouse.move(w.x + 10, w.y + 50);
  await page.mouse.down();
  await page.mouse.move(w.x + 10, w.y + 25);
  await page.waitForTimeout(40);
  expect(posted(sent, '/api/engine/voice').filter((b) => b.bend != null).pop().bend).toBeGreaterThan(0.1);
  await page.mouse.up();
  await page.waitForTimeout(100);
  expect(posted(sent, '/api/engine/voice').pop().bend).toBe(0);
  await page.click('#gsBendLab');
  await expect(page.locator('#gsBendLab b')).toHaveText('±7');
});

test('AMP drags, its readout follows, and it is kept with the sound', async ({ page }) => {
  const sent = await openPage(page);
  const before = await page.locator('#gsAmpRo').textContent();
  const box = await page.locator('#gsAmp').boundingBox();
  const r = await page.evaluate(() => gsAmpPts(GS_CV.gsAmp, GS.amp).r);
  const k = box.width / 404;
  await page.mouse.move(box.x + r[0] * k, box.y + 20 * k);
  await page.mouse.down();
  await page.mouse.move(box.x + (r[0] - 50) * k, box.y + 20 * k);
  await page.mouse.up();
  await page.waitForTimeout(120);
  expect(await page.locator('#gsAmpRo').textContent()).not.toBe(before);
  const release = posted(sent, '/api/engine/voice').filter((b) => b.release != null).pop().release;
  const want = await page.evaluate(() => GS.amp.r ** 2 * 6);
  expect(release).toBeCloseTo(want, 4);
  expect(want).toBeLessThan(0.5 * 0.5 * 6);
  await page.click('#gsVmode span[data-m="legato"]');

  // Another sound starts from the defaults; coming back brings these back.
  const kept = await page.evaluate(async (want) => {
    const files = await api(`/api/files?folder=${encodeURIComponent(state.folders[0].name)}`);
    const here = state.selectedFile;
    const other = files.find((f) => f.path !== here.path);
    await selectFile(other);
    await new Promise((d) => setTimeout(d, 200));
    const there = [GS.amp.r, GS.voice.mode];
    await selectFile(here);
    await new Promise((d) => setTimeout(d, 200));
    return { there, back: [GS.amp.r, GS.voice.mode], want };
  }, want);
  expect(kept.there).toEqual([0.5, 'mono']);
  expect(kept.back[1]).toBe('legato');
  expect(kept.back[0] ** 2 * 6).toBeCloseTo(want, 4);
});

test('the LFO rows are live now, and AMP as it was', async ({ page }) => {
  await openPage(page);
  expect(await page.locator('#gsRMod.gs-inert').count()).toBe(0);
  expect(await page.locator('#gsPMod.gs-inert').count()).toBe(0);
});

test('leaving the page lets go and puts the engine back', async ({ page }) => {
  const sent = await openPage(page);
  await page.keyboard.down('a');
  await page.waitForTimeout(40);
  await page.evaluate(() => setMode('wave' in window ? 'synth' : 'library'));
  await page.waitForTimeout(150);
  expect(notes(sent).pop()).toEqual({ on: false, key: 60 });
  expect(posted(sent, '/api/engine/voice').pop()).toMatchObject({ reset: true });
  await page.keyboard.up('a');
});

test('with the switch off the keys are the old keys, and nothing is sent', async ({ page }) => {
  const sent = await openPage(page, { flag: false });
  const was = await page.evaluate(() => state.stretchDraft.semitones);
  await page.keyboard.press('w');
  await page.waitForTimeout(250);
  expect(await page.evaluate(() => state.stretchDraft.semitones)).toBe(was + 1);
  expect(notes(sent)).toEqual([]);
  expect(posted(sent, '/api/engine/voice')).toEqual([]);
  // The old key commits, so it is put back for whatever runs next on this sound.
  await page.evaluate((v) => { state.stretchDraft.semitones = v; state.stretchRows?.semitones?.sync?.(v); commitStretch(); }, was);
  await page.waitForTimeout(150);
});

test('with no device the keys draw and nothing asks the engine', async ({ page }) => {
  const sent = await openPage(page);
  await page.evaluate(() => { engine.device = false; engine.deviceError = 'no audio device'; reflectAudioDevice(); });
  await page.waitForTimeout(100);
  sent.length = 0;
  await page.keyboard.down('a');
  await page.waitForTimeout(80);
  expect(await page.evaluate(() => GS_N.held.size)).toBe(1);
  await page.keyboard.up('a');
  await page.waitForTimeout(80);
  expect(sent).toEqual([]);
});

// ──────────────────────────────────────────────────── the effects page's leftovers

async function openEffects(page) {
  const sent = await openPage(page);
  await page.evaluate(() => gsFxSetView('fx'));
  await page.waitForFunction(() => document.querySelector('#fxModuleRail > .fx-module .gs-fxfoot'));
  await page.waitForTimeout(150);
  return sent;
}

test('the L and R faders are the engine\'s own two gains', async ({ page }) => {
  const sent = await openEffects(page);
  expect(await page.locator('#gsFxView .gs-fd.gs-inert').count()).toBe(0);
  const box = await page.locator('#gsFdL').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.4);
  await page.waitForTimeout(100);
  const b = posted(sent, '/api/engine/transport').filter((x) => x.gainL != null).pop();
  expect(b.gainL).toBeGreaterThan(0.5);
  expect(b.gainL).toBeLessThan(1);
  expect(b.gainR).toBeUndefined();
  await expect(page.locator('#gsFdLRo')).not.toHaveText('');
  const box2 = await page.locator('#gsFdR').boundingBox();
  await page.mouse.dblclick(box2.x + box2.width / 2, box2.y + box2.height * 0.2);
  await page.waitForTimeout(100);
  expect(posted(sent, '/api/engine/transport').filter((x) => x.gainR != null).pop().gainR).toBeCloseTo(1, 3);
});

test('every module has the footer, and it does not change the module\'s size', async ({ page }) => {
  await openEffects(page);
  const first = page.locator('#fxModuleRail > .fx-module').first();
  await expect(first.locator('.gs-fxfoot .gs-bn').first()).toHaveText('Wet / dry');
  await expect(first.locator('.gs-fxfoot [data-f="level"] .gs-bv')).toHaveText('+0.0 dB');
  const sized = await page.evaluate(() => [...document.querySelectorAll('#fxModuleRail > .fx-module')].map((m) => {
    const with_ = [m.offsetWidth, m.offsetHeight];
    const foot = m.querySelector('.gs-fxfoot');
    const f = foot.getBoundingClientRect(), r = m.getBoundingClientRect();
    foot.style.display = 'none';
    const without = [m.offsetWidth, m.offsetHeight];
    foot.style.display = '';
    return { with_, without, inside: f.bottom <= r.bottom + 0.5 && f.right <= r.right + 0.5 };
  }));
  expect(sized.length).toBeGreaterThan(0);
  for (const s of sized) { expect(s.with_).toEqual(s.without); expect(s.inside).toBe(true); }
});

test('Wet/dry and Level go live and persist in the rack', async ({ page }) => {
  await openEffects(page);
  const params = [];
  page.on('request', (r) => { if (new URL(r.url()).pathname === '/api/rack/param') params.push(JSON.parse(r.postData())); });
  const first = page.locator('#fxModuleRail > .fx-module').first();
  const wet = await first.locator('[data-f="wet"] .gs-bw').boundingBox();
  await page.mouse.move(wet.x + wet.width / 2, wet.y + 8);
  await page.mouse.down();
  await page.mouse.move(wet.x + wet.width * 0.25, wet.y + 8, { steps: 3 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  const level = await first.locator('[data-f="level"] .gs-bw').boundingBox();
  await page.mouse.click(level.x + level.width * 0.2, level.y + 8);
  await page.waitForTimeout(300);
  expect(params.some((p) => p.key === 'slot.wet')).toBe(true);
  expect(params.some((p) => p.key === 'slot.level')).toBe(true);
  const back = await page.evaluate(async () => {
    const r = await api(`/api/rack?p=${encodeURIComponent(state.selectedFile.path)}`);
    return [r.slots[0].wet, r.slots[0].level, state.rack.slots[0].wet];
  });
  expect(back[0]).toBeLessThan(0.5);
  expect(back[1]).toBeLessThan(-10);
  expect(back[2]).toBe(back[0]);
});

test('the page says it is in front, and sends the bend range', async ({ page }) => {
  const sent = await openPage(page);
  const v = posted(sent, '/api/engine/voice').find((b) => b.front);
  expect(v).toMatchObject({ front: true, bendRange: 2 });
  await page.locator('#gsBendLab').click();
  await page.waitForTimeout(150);
  expect(posted(sent, '/api/engine/voice').some((b) => b.bendRange === 7)).toBe(true);
  await page.evaluate(() => setMode('overview'));
  await page.waitForTimeout(200);
  expect(posted(sent, '/api/engine/voice').some((b) => b.reset)).toBe(true);
});

test('a MIDI keyboard lights the keys and moves the wheel, without posting a note', async ({ page }) => {
  const sent = await openPage(page);
  await page.route(/\/api\/engine\/midi$/, (route) => route.fulfill({ json: { notes: [60, 67], bend: 0.5, vel: 1 } }));
  await page.waitForFunction(() => gsKeyLit(60) && gsKeyLit(67) && GS_N.midiBend === 0.5);
  await expect(page.locator('#gsVelRo')).toHaveText('vel 127');
  await page.waitForFunction(() => GS_N.sent.drawn.endsWith('|60,67'));
  // It is only being drawn: the sound went straight to the engine.
  expect(notes(sent)).toHaveLength(0);
  await page.route(/\/api\/engine\/midi$/, (route) => route.fulfill({ json: { notes: [], bend: 0, vel: 1 } }));
  await page.waitForFunction(() => !gsKeyLit(60) && GS_N.midiBend === 0);
});

test('with the page off nothing asks about MIDI', async ({ page }) => {
  await openPage(page, { flag: false });
  const seen = await page.evaluate(() => typeof GS_N === 'undefined' || !GS_N.midiPoll);
  expect(seen).toBe(true);
});

test('each instrument has its own MIDI channel, on its own page', async ({ page }) => {
  await openPage(page);
  const channels = () => page.evaluate(() => api('/api/engine/midi').then((m) => [m.wave, m.grain]));
  await expect(page.locator('#gsMidiCh')).toHaveValue('2');
  await expect.poll(channels).toEqual([1, 2]);
  await page.selectOption('#gsMidiCh', '5');
  await expect.poll(channels).toEqual([1, 5]);
  expect(await page.evaluate(() => localStorage.getItem('midiChannel.grain'))).toBe('5');
  // The dock's row still holds it.
  const fits = await page.evaluate(() => {
    const row = document.querySelector('#gsMidiCh').parentElement;
    return row.scrollWidth <= row.clientWidth + 1;
  });
  expect(fits, 'the channel menu pushed the row over').toBe(true);
  // Wave has its own, and setting Grain's did not touch it.
  await page.evaluate(() => setMode('synth'));
  await expect(page.locator('#wvMidiCh')).toHaveValue('1');
  await page.selectOption('#wvMidiCh', '7');
  await expect.poll(channels).toEqual([7, 5]);
  // The server lives as long as the run: back as it was found.
  await page.evaluate(() => { localStorage.clear(); return postJSON('/api/engine/midi', { wave: 1, grain: 2 }); });
});

test('a take that recorded notes says so', async ({ page }) => {
  await openPage(page);
  await page.route(/\/api\/automation\/record/, (route) => route.fulfill({ json: { mode: 'off' } }));
  await page.route(/\/api\/automation\?/, (route) => route.fulfill({ json: { lanes: [], bypassed: false, targets: [], notes: [{ frame: 1, on: true, key: 60, vel: 1 }, { frame: 9, on: false, key: 60, vel: 0 }] } }));
  await page.evaluate(() => endCapture());
  await expect(page.locator('#perfStatus')).toContainText('1 NOTES');
});

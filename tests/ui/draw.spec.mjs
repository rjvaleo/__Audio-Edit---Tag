// Draw (`ui/sequencer/draw.js`): a canvas the sequencer plays, on a page of
// its own — the Seq frame showing only the canvas.
//
// - the page is on the rail, after Atmosphere, and entering it shows the
//   canvas alone (`body.only-draw`); Pen, Dots, Shape and Cloud drawn with the
//   mouse each make a mark;
// - true pitch: a dot on a just scale's degree plays exactly the frequency
//   `getFreqForDegree` gives that degree, and an offline render of it sounds there;
// - worked out, not played by ear: the same boundaries plan the same notes
//   twice, a seek lands on what playing got to, and a film plays the drawing;
// - a triangle is three hits a bar and a pentagon five;
// - Retrograde plays a line backwards and Invert mirrors its degrees about the root;
// - presets and a reload keep the drawing.

import { test, expect } from './test.mjs';

/// The frame's page on its own, for what does not need the app around it.
async function openSeq(page) {
  await page.goto('/sequencer/');
  await page.waitForFunction(() => typeof drawPlan === 'function' && !!document.getElementById('drawCanvas') && typeof bdNodes !== 'undefined');
  await page.evaluate(() => {
    initAudio();
    // A line on degrees `ds` (from the root, a beat each), as Pen points.
    window.__stairs = (ds, x0 = 0) => {
      const n = SCALES[selectedScaleIdx].cents.length, pts = [];
      ds.forEach((d, i) => { const h = (2 * n + d) / n; pts.push([x0 + i, h, 0.7], [x0 + i + 1, h, 0.7]); });
      return pts;
    };
    window.__mark = (o) => ({ id: 1, brush: 'pen', ink: 'classic', snap: 'degrees', level: 0.8, thick: 0.6, smudge: 0, oct: 0, seed: 5, kal: 1, pts: [], ...o });
  });
}

/// The app, on the Draw page; returns the sequencer's frame.
async function openDraw(page) {
  await page.goto('/');
  await page.waitForFunction(() => typeof state !== 'undefined' && (state.folders || []).length > 0, { timeout: 20_000 });
  await page.locator('#leftRail [data-mode="draw"]').click();
  await page.waitForFunction(() => seq.ready === true, { timeout: 20_000 });
  const frame = page.frames().find((f) => f.url().includes('/sequencer/'));
  await frame.waitForFunction(() => document.body.classList.contains('only-draw') && document.getElementById('drawCanvas').clientWidth > 100);
  return frame;
}

test('Draw is on the rail after Atmosphere, shows the canvas alone, and the mouse draws Pen, Dots, Shape and Cloud', async ({ page }) => {
  const frame = await openDraw(page);
  const rail = await page.evaluate(() => [...document.querySelectorAll('#leftRail [data-mode]')].map((b) => b.dataset.mode));
  expect(rail.indexOf('draw'), 'Draw is not right after Atmosphere').toBe(rail.indexOf('atmos') + 1);
  expect(await page.evaluate(() => [state.mode, seq.only, document.querySelector('#leftRail [data-mode="draw"]').classList.contains('active')])).toEqual(['draw', 'draw', true]);
  // Only the canvas: Seq's own panels are hidden, the overview strip stays.
  const shown = await frame.evaluate(() => ({
    steps: document.querySelector('.seq-panel').offsetParent !== null, band: document.querySelector('.accompany').offsetParent !== null,
    draw: document.getElementById('drawPage').offsetParent !== null, marks: DRAW.marks.length,
  }));
  expect(shown).toEqual({ steps: false, band: false, draw: true, marks: 0 });
  expect(await page.evaluate(() => !document.getElementById('pageOv').classList.contains('hidden') && document.getElementById('pageOv').offsetParent !== null), 'the shared overview is not on the page').toBe(true);

  const box = await frame.locator('#drawCanvas').boundingBox();
  const at = (fx, fy) => [box.x + box.width * fx, box.y + box.height * fy];
  const tool = (b) => frame.locator(`.dr-brush button[data-brush="${b}"]`).click();
  // Pen: a line across a bar.
  await tool('pen');
  await page.mouse.move(...at(0.08, 0.5));
  await page.mouse.down();
  await page.mouse.move(...at(0.2, 0.35), { steps: 12 });
  await page.mouse.move(...at(0.3, 0.45), { steps: 12 });
  await page.mouse.up();
  // Dots: two taps, one held.
  await frame.locator('#drInks [data-ink="arp"]').click();
  await tool('dots');
  await page.mouse.click(...at(0.4, 0.4));
  await page.mouse.move(...at(0.45, 0.3));
  await page.mouse.down();
  await page.waitForTimeout(400);
  await page.mouse.up();
  // Shape: a triangle, in Drums ink.
  await frame.locator('#drInks [data-ink="drums"]').click();
  await tool('shape');
  const tri = [at(0.6, 0.7), at(0.66, 0.85), at(0.54, 0.85), at(0.6, 0.7)];
  await page.mouse.move(...tri[0]);
  await page.mouse.down();
  for (const p of tri.slice(1)) await page.mouse.move(...p, { steps: 10 });
  await page.mouse.up();
  // Cloud: a spray, held and moved, in Grain ink.
  await frame.locator('#drInks [data-ink="grain"]').click();
  await tool('cloud');
  await page.mouse.move(...at(0.8, 0.2));
  await page.mouse.down();
  await page.mouse.move(...at(0.86, 0.25), { steps: 8 });
  await page.waitForTimeout(250);
  await page.mouse.up();

  const marks = await frame.evaluate(() => DRAW.marks.map((m) => ({ brush: m.brush, ink: m.ink, n: m.pts.length })));
  expect(marks.map((m) => [m.brush, m.ink])).toEqual([['pen', 'classic'], ['dots', 'arp'], ['dots', 'arp'], ['shape', 'drums'], ['cloud', 'grain']]);
  expect(marks[0].n, 'the pen kept too few points').toBeGreaterThan(8);
  expect(marks[3].n, 'the triangle is not three corners').toBe(3);
  expect(marks[4].n, 'the spray left too few specks').toBeGreaterThan(10);
  // A held dot is bigger than a tap: a longer note.
  const sizes = await frame.evaluate(() => DRAW.marks.filter((m) => m.brush === 'dots').map((m) => m.pts[0][2]));
  expect(sizes[1]).toBeGreaterThan(sizes[0]);
  // The last mark drawn is the one THE MARK shows.
  await expect(frame.locator('#drMarkMeta')).toContainText('Cloud · Grain');
  // Every mark plays: one pass of the loop plans notes from each of them.
  const heard = await frame.evaluate(() => {
    const seen = new Set();
    const per = Math.round((DRAW.bars * 4) / stepBeats);
    for (let k = 0; k < per; k++) for (const e of drawPlan(k)) seen.add(e.mark);
    return DRAW.marks.every((m) => seen.has(m.id));
  });
  expect(heard).toBe(true);
});

test('true pitch: a dot on degree 3 of Pythagorean tuning plays exactly getFreqForDegree, and sounds there', async ({ page }) => {
  await openSeq(page);
  const got = await page.evaluate(() => {
    selectScale(SCALES.findIndex((s) => s.name === 'Pythagorean Tuning'));
    const n = SCALES[selectedScaleIdx].cents.length;
    bpm = 120; stepBeats = 0.5;
    // Degree 3 (index 2) in the root's octave, a beat in.
    drawSetState({ bars: 1, marks: [__mark({ brush: 'dots', pts: [[1, (2 * n + 2) / n, 0.5]] }), __mark({ id: 2, brush: 'dots', ink: 'atmos', pts: [[2, (2 * n + 2) / n, 0.5]] })] });
    const heard = [];
    const pc = window.playClassic, ap = window.atmosPlay;
    window.playClassic = (f, t, h, o) => { heard.push(['classic', f]); return pc(f, t, h, o); };
    window.atmosPlay = (f, t, d, o) => { heard.push(['atmos', f]); return ap(f, t, d, o); };
    drawStop();
    for (let k = 0; k < 8; k++) drawAt(k, audioCtx.currentTime + 0.1 + k * 0.25);
    window.playClassic = pc; window.atmosPlay = ap;
    return { heard, want: getFreqForDegree(2), tet: 440 * Math.pow(2, 2 / 12) };
  });
  expect(got.heard).toEqual([['classic', got.want], ['atmos', got.want]]);
  expect(Math.abs(got.want - got.tet), 'Pythagorean degree 3 is 12-TET here: the test proves nothing').toBeGreaterThan(0.5);

  // And in sound: rendered offline, a Classic sine, counted by its zero crossings.
  const hz = await page.evaluate(async () => {
    const rate = 48000, Real = window.AudioContext, off = new OfflineAudioContext(2, rate * 2, rate);
    off.createMediaStreamDestination = () => off.createGain();
    window.AudioContext = function () { return off; };
    audioCtx = null;
    try { initAudio(); } finally { window.AudioContext = Real; }
    setWaveType('sine');
    for (const id of ['delayWetSlider', 'atRevWetSlider']) { const el = document.getElementById(id); if (el) { el.value = 0; el.dispatchEvent(new Event('input')); } }
    const n = SCALES[selectedScaleIdx].cents.length;
    bpm = 60;
    drawSetState({ bars: 1, marks: [__mark({ brush: 'dots', pts: [[0, (2 * n + 2) / n, 1]] })] });
    drawStop();
    for (let k = 0; k < 4; k++) drawAt(k, k * 0.5);
    const buf = (await off.startRendering()).getChannelData(0);
    // Upward zero crossings between 0.4 s and 1.4 s, to the fraction of a sample.
    const xs = [];
    for (let i = Math.round(0.4 * rate); i < 1.4 * rate; i++) if (buf[i - 1] < 0 && buf[i] >= 0) xs.push(i - 1 + buf[i - 1] / (buf[i - 1] - buf[i]));
    audioCtx = null;
    return ((xs.length - 1) * rate) / (xs[xs.length - 1] - xs[0]);
  });
  expect(Math.abs(hz - got.want), `sounded at ${hz} Hz, not ${got.want}`).toBeLessThan(0.05);
});

test('worked out, not played by ear: the same notes twice, a seek lands where playing got to, a smudge is the same smudge', async ({ page }) => {
  await openSeq(page);
  const got = await page.evaluate(() => {
    bpm = 120; stepBeats = 0.5;
    drawSetState({ bars: 2, marks: [
      __mark({ id: 1, pts: __stairs([0, 2, 4, 1, 3, 5]), smudge: 0.4, seed: 77 }),
      __mark({ id: 2, brush: 'dots', ink: 'arp', pts: [[0.5, 2.3, 0.2], [3.25, 2.6, 0.4], [6.75, 1.9, 0.9]], kal: 2 }),
      __mark({ id: 3, brush: 'shape', ink: 'drums', pts: [[5, 1, 1], [5.6, 0.6, 1], [4.4, 0.6, 1]] }),
      __mark({ id: 4, brush: 'cloud', ink: 'grain', pts: Array.from({ length: 40 }, (_, i) => [i * 0.37 % 8, 3 + (i % 5) * 0.1, (i % 7) / 7]) }),
      __mark({ id: 5, brush: 'pen', ink: 'bass', snap: 'glide', pts: [[2, 0.5, 0.5], [2.5, 0.7, 0.9], [3.5, 0.9, 0.3]] }),
    ] });
    const say = (e) => `${e.mark}:${e.at.toFixed(4)}:${e.hz ? e.hz.toFixed(3) : e.slot}:${e.dur.toFixed(3)}:${e.vel.toFixed(3)}`;
    const run = (k0, n) => Array.from({ length: n }, (_, j) => drawPlan(k0 + j).map(say).join(',')).join(' | ');
    const a = run(0, 64);
    drawChanged(); // forget what was worked out
    const b = run(0, 64);
    // Through the voices: everything `drawAt` plays from boundary 0 on, and
    // then a seek straight to boundary 21.
    const heard = [];
    const real = window.drawVoice;
    window.drawVoice = (e, t) => heard.push(`${e.mark}:${e.hz ? e.hz.toFixed(3) : e.slot}:${(t - 1).toFixed(4)}`);
    drawStop();
    for (let k = 0; k < 32; k++) drawAt(k, 1 + k * 0.25);
    const played = heard.splice(0);
    drawStop();
    drawAt(21, 1 + 21 * 0.25);
    const seek = heard.splice(0);
    window.drawVoice = real;
    // A held note under way at 21: started there, in the continuous run before it.
    const at21 = played.filter((s) => { const t = +s.split(':')[2]; return t >= 21 * 0.25 - 1e-6 && t < 22 * 0.25 - 1e-6; });
    // The smudge is the mark's seed, not chance: another seed, other notes.
    const smudged = drawPlan(3).map(say).join(',');
    DRAW.marks[0].seed = 78; drawChanged();
    const other = run(0, 16);
    DRAW.marks[0].seed = 77; drawChanged();
    return { a, b, at21, seek, smudged, again: drawPlan(3).map(say).join(','), other, first16: run(0, 16), count: played.length };
  });
  expect(got.count, 'the drawing played nothing').toBeGreaterThan(40);
  expect(got.b, 'the same drawing planned other notes').toBe(got.a);
  // The seek plays what starts at 21 as playing did, plus what was still held.
  for (const s of got.at21) expect(got.seek, `the seek lost ${s}`).toContain(s);
  expect(got.again).toBe(got.smudged);
  expect(got.other, 'another seed smudged it the same').not.toBe(got.first16);
});

test('a film renders the drawing: its notes, the same twice', async ({ page }) => {
  test.setTimeout(90_000);
  const frame = await openDraw(page);
  await frame.evaluate(() => {
    const n = SCALES[selectedScaleIdx].cents.length, mk = (o) => ({ level: 0.8, thick: 0.5, smudge: 0, oct: 0, seed: 3, kal: 1, snap: 'degrees', ...o });
    drawSetState({ bars: 1, steps: false, marks: [
      mk({ id: 1, brush: 'dots', ink: 'classic', pts: [[0.25, (2 * n + 4) / n, 0.3], [1.5, (2 * n + 2) / n, 0.3]] }),
      mk({ id: 2, brush: 'dots', ink: 'bass', pts: [[0, 1, 0.5]] }),
      mk({ id: 3, brush: 'shape', ink: 'drums', pts: [[2, 0.2, 1], [2.6, 0.05, 1], [1.4, 0.05, 1]] }),
    ] });
    window.__notes = [];
    const pc = window.playClassic, bv = window.bandVoice;
    window.playClassic = (f, t, h, o) => { if (o && o.into) __notes.push(`c${f.toFixed(2)}`); return pc(f, t, h, o); };
    window.bandVoice = (e, t) => { if (e.into) __notes.push(e.part === 'drum' ? e.slot : `${e.part}${e.hz.toFixed(2)}`); return bv(e, t); };
    window.__want = [getFreqForDegree(4), getFreqForDegree(2), getFreqForDegree(0) / 2];
  });
  const render = async () => {
    await frame.evaluate(() => { __notes = []; });
    await page.evaluate(() => seqRenderForFilm({ at0: 0, seconds: 2, rate: 24000, fps: 10, bands: 16, lo: 20, hi: 20000, liss: 32 }));
    return frame.evaluate(() => __notes.join(' '));
  };
  const one = await render();
  const two = await render();
  const want = await frame.evaluate(() => __want.map((f) => f.toFixed(2)));
  expect(one, 'the film did not play the drawing').toContain(`c${want[0]}`);
  expect(one).toContain(`c${want[1]}`);
  expect(one).toContain(`bass${want[2]}`);
  expect(one.split(' ').filter((s) => s === 'kick').length, 'the wheel did not turn in the film').toBeGreaterThanOrEqual(3);
  expect(two, 'the same drawing rendered other notes').toBe(one);
});

test('a triangle drawn as a Shape is three hits a bar, a pentagon five', async ({ page }) => {
  const frame = await openDraw(page);
  const box = await frame.locator('#drawCanvas').boundingBox();
  await frame.locator('.dr-brush button[data-brush="shape"]').click();
  await frame.locator('#drInks [data-ink="drums"]').click();
  const poly = async (cx, cy, r, n) => {
    const pts = Array.from({ length: n + 1 }, (_, i) => {
      const a = (i / n) * Math.PI * 2;
      return [box.x + box.width * cx + r * Math.sin(a), box.y + box.height * cy - r * Math.cos(a)];
    });
    await page.mouse.move(...pts[0]);
    await page.mouse.down();
    for (const p of pts.slice(1)) await page.mouse.move(...p, { steps: 8 });
    await page.mouse.up();
  };
  // Inside one bar each: the third bar of four.
  await poly(0.58, 0.7, 45, 3);
  await poly(0.66, 0.4, 45, 5);
  const got = await frame.evaluate(() => {
    const per = 4 / stepBeats, hits = {};
    for (const m of DRAW.marks) hits[m.pts.length] = [];
    for (let k = 0; k < per * DRAW.bars; k++) for (const e of drawPlan(k)) hits[drawMarkById(e.mark).pts.length].push(Math.floor((k * stepBeats) / 4));
    return { corners: DRAW.marks.map((m) => m.pts.length), hits: Object.fromEntries(Object.entries(hits).map(([c, bars]) => [c, bars.length / new Set(bars).size])) };
  });
  expect(got.corners).toEqual([3, 5]);
  expect(got.hits).toEqual({ 3: 3, 5: 5 });
});

test('Retrograde plays a Pen line backwards; Invert mirrors its degrees about the root', async ({ page }) => {
  const frame = await openDraw(page);
  const degrees = () => frame.evaluate(() => { const n = drawN(); return drawMarkNotes(DRAW.marks[0]).map((e) => e.r - 2 * n); });
  await frame.evaluate(() => {
    const n = SCALES[selectedScaleIdx].cents.length, pts = [];
    [1, 3, 2, 5].forEach((d, i) => { const h = (2 * n + d) / n; pts.push([i, h, 0.7], [i + 1, h, 0.7]); });
    drawSetState({ bars: 4, marks: [{ id: 1, brush: 'pen', ink: 'classic', snap: 'degrees', level: 0.8, thick: 0.6, smudge: 0, oct: 0, seed: 1, kal: 1, pts }] });
  });
  expect(await degrees()).toEqual([1, 3, 2, 5]);
  // Picked with Select, mirrored with THE MARK's buttons.
  await frame.locator('.dr-brush button[data-brush="select"]').click();
  const box = await frame.locator('#drawCanvas').boundingBox();
  const p = await frame.evaluate(() => { const G = drawGeom(); return [G.X(0.5), G.Y(DRAW.marks[0].pts[0][1])]; });
  await page.mouse.click(box.x + p[0], box.y + p[1]);
  expect(await frame.evaluate(() => drawUi.sel)).toBe(1);
  await frame.locator('[data-mirror="retro"]').click();
  expect(await degrees()).toEqual([5, 2, 3, 1]);
  // Its notes, in time: the last first, each as long as it was.
  expect(await frame.evaluate(() => drawMarkNotes(DRAW.marks[0]).map((e) => [e.b, e.len]))).toEqual([[0, 1], [1, 1], [2, 1], [3, 1]]);
  await frame.locator('[data-mirror="invert"]').click();
  expect(await degrees()).toEqual([-5, -2, -3, -1]);
  await frame.locator('[data-mirror="invert"]').click();
  await frame.locator('[data-mirror="retro"]').click();
  expect(await degrees()).toEqual([1, 3, 2, 5]);
  // The kaleidoscope repeats it round the loop; ⌘Z undoes.
  await frame.locator('[data-mirror="kal"]').click();
  await expect(frame.locator('#drKalBtn')).toHaveText('✺ Kaleidoscope ×2');
  const notes = await frame.evaluate(() => drawEvents().filter((e) => e.mark === 1).map((e) => e.b));
  expect(notes).toEqual([0, 1, 2, 3, 8, 9, 10, 11]);
  await frame.locator('#drawUndoBtn').click();
  expect(await frame.evaluate(() => DRAW.marks[0].kal)).toBe(1);
});

test('a preset keeps the drawing as data, and so does a reload', async ({ page }) => {
  await openSeq(page);
  const got = await page.evaluate(() => {
    drawSetState({ bars: 8, snap: 'glide', steps: false, grain: 50, marks: [
      __mark({ id: 1, pts: __stairs([0, 4, 2]) }),
      __mark({ id: 2, brush: 'shape', ink: 'drums', pts: [[5, 1, 1], [5.6, 0.6, 1], [4.4, 0.6, 1]], kal: 3, smudge: 0.2 }),
    ] });
    const before = JSON.stringify(drawGetState());
    const preset = JSON.parse(JSON.stringify(getPresetState()));
    drawSetState({ bars: 4, marks: [] });
    const cleared = DRAW.marks.length;
    applyPresetState(preset);
    // A preset from before Draw leaves the drawing as it is.
    const old = JSON.parse(JSON.stringify(preset));
    delete old.draw;
    applyPresetState(old);
    return { inPreset: !!preset.draw && !('drawLevelSlider' in preset.sliders), cleared, before, after: JSON.stringify(drawGetState()), plan: drawPlan(0).length };
  });
  expect(got.inPreset, 'the drawing is not in the preset as data').toBe(true);
  expect(got.cleared).toBe(0);
  expect(got.after).toBe(got.before);
  await page.waitForTimeout(400);
  await page.reload();
  await page.waitForFunction(() => typeof drawGetState === 'function' && !!document.getElementById('drawCanvas'));
  expect(await page.evaluate(() => JSON.stringify(drawGetState()))).toBe(got.before);
});

test("Seq's steps switch leaves the steps out of what plays, and the Parts move the Band's own faders", async ({ page }) => {
  test.setTimeout(90_000);
  const frame = await openDraw(page);
  await frame.evaluate(() => {
    drawSetState({ bars: 1, steps: true, marks: [] });
    for (const s of steps) s.rest = false;
    window.__steps = 0;
    const real = window.seqPlayAt;
    window.seqPlayAt = (s, t, d) => { __steps++; return real(s, t, d); };
  });
  const render = async () => {
    await frame.evaluate(() => { __steps = 0; });
    await page.evaluate(() => seqRenderForFilm({ at0: 0, seconds: 1, rate: 24000, fps: 10, bands: 16, lo: 20, hi: 20000, liss: 32 }));
    return frame.evaluate(() => __steps);
  };
  expect(await render(), 'the steps did not play').toBeGreaterThan(0);
  await frame.locator('#drawStepsBtn').click();
  expect(await frame.evaluate(() => [drawGetState().steps, document.getElementById('drawStepsBtn').classList.contains('on')])).toEqual([false, false]);
  expect(await render(), 'the steps played with the switch off').toBe(0);
  // The Parts: the Band's own Bass fader, not a copy of it.
  const f = frame.locator('.dr-part[data-ink="bass"] .f');
  const b = await f.boundingBox();
  await page.mouse.click(b.x + b.width * 0.25, b.y + b.height / 2);
  expect(await frame.evaluate(() => [+document.getElementById('mxBasLevelSlider').value, BAND.ch.Bas.lv])).toEqual([25, 25]);
  await f.dblclick();
  expect(await frame.evaluate(() => +document.getElementById('mxBasLevelSlider').value)).toBe(80);
});

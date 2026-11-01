// Capturing a performance.
//
// The recorder itself is the server's and is tested there: a move while the
// transport runs lands in a lane of its own. What is checked here is what the
// interface adds — that every engine control is on offer, that Capture arms
// the recorder and rolls, and that the take is drawn as a stacked timeline.

import { test, expect } from './test.mjs';

async function open(page) {
  await page.goto('/');
  await page.waitForFunction(
    () => typeof state !== 'undefined' && (state.folders || []).length > 0,
    { timeout: 20_000 });
  await page.evaluate(async () => {
    const folder = state.folders[0].name;
    const files = await api(`/api/files?folder=${encodeURIComponent(folder)}`);
    await selectFile(files[0]);
    setMode('edit');
    document.querySelector('.dock-tab[data-dock="automation"]').click();
  });
  await page.waitForFunction(() => (state.automation.targets || []).length > 0, { timeout: 20_000 });
}

test('every engine control is a target, and the ones that rebuild the file are not', async ({ page }) => {
  await open(page);
  const targets = await page.evaluate(() => state.automation.targets.map(([t]) => t));
  for (const want of [
    'stretch.grain.rateHz', 'stretch.grain.layers', 'stretch.grain.scan', 'stretch.grain.reverse',
    'stretch.grain.panSpread', 'stretch.grain.driftRateHz',
    'stretch.wsola.searchMs', 'stretch.vocoder.magFreeze', 'stretch.pvsola.blend',
    'stretch.hybrid.harmonicLevel', 'stretch.cloudMix',
  ]) {
    expect(targets, `${want} is not offered`).toContain(want);
  }
  for (const not of ['stretch.hybrid.fftSize', 'stretch.wsola.preserveTransients', 'stretch.algorithm', 'stretch.grain.seed']) {
    expect(targets, `${not} would rebuild the file and must not be a lane`).not.toContain(not);
  }
  expect(targets.filter((t) => t.startsWith('stretch.')).length).toBeGreaterThanOrEqual(48);
});

// REC PERF arms; the take starts when Play does, and ends when the transport
// stops. It used to start playback itself the instant the button was pressed.
test('REC PERF arms, Play starts the take, and a stop ends and disarms it', async ({ page }) => {
  await open(page);
  expect(await page.evaluate(() => state.automationRecord || 'off')).toBe('off');
  // Arm, with the transport stopped: nothing starts.
  let played = 0;
  await page.evaluate(() => { window.__played = 0; startPlayback = () => { window.__played++; engine.playing = true; }; });
  await page.evaluate(() => startCapture());
  const armed = await page.evaluate(async () => ({
    mode: state.automationRecord,
    server: (await api('/api/automation/record')).mode,
    armed: state.captureArmed,
    button: $('automationCapture').textContent.trim(),
    cls: $('automationCapture').className,
    label: $('recLabel').textContent,
    status: $('perfStatus').textContent,
    played: window.__played,
  }));
  expect(armed.mode).toBe('latch');
  expect(armed.server, 'the server was not armed').toBe('latch');
  expect(armed.armed).toBe(true);
  expect(armed.button).toBe('⏺ ARMED');
  expect(armed.cls).toContain('armed');
  expect(armed.cls).not.toContain('recording');
  expect(armed.label).toBe('PERF ARMED');
  expect(armed.status).toMatch(/PRESS PLAY/);
  expect(armed.played, 'arming started playback by itself').toBe(0);

  // Play: the take begins.
  await page.evaluate(() => { engine.playing = true; captureTransport(true); });
  const taking = await page.evaluate(() => ({
    button: $('automationCapture').textContent.trim(), cls: $('automationCapture').className,
    label: $('recLabel').textContent, armed: state.captureArmed,
  }));
  expect(taking.button).toBe('⏺ CAPTURING');
  expect(taking.cls).toContain('recording');
  expect(taking.label).toBe('PERF ● REC');
  expect(taking.armed).toBe(true);

  // Stop: the take ends, and the recorder is off.
  await page.evaluate(async () => { engine.playing = false; captureTransport(false); await new Promise((r) => setTimeout(r, 300)); });
  const after = await page.evaluate(async () => ({
    mode: state.automationRecord,
    server: (await api('/api/automation/record')).mode,
    armed: state.captureArmed,
    button: $('automationCapture').textContent.trim(),
    label: $('recLabel').textContent,
  }));
  expect(after.mode).toBe('off');
  expect(after.server).toBe('off');
  expect(after.armed).toBe(false);
  expect(after.button).toBe('⏺ REC PERF');
  expect(after.label).toBe('');
});

test('the take is drawn as the sequencer draws one, and a click on a lane opens it', async ({ page }) => {
  await open(page);
  const got = await page.evaluate(() => {
    const kept = JSON.stringify(state.automation.lanes);
    state.automation.lanes = [
      { id: 'a', target: 'stretch.grain.rateHz', label: 'Grains — Rate', enabled: true, points: [{ frame: 0, value: 0.2 }, { frame: laneFrames(), value: 0.9 }] },
      { id: 'b', target: 'stretch.vocoder.magFreeze', label: 'Vocoder — Freeze', enabled: true, points: [{ frame: 0, value: 0.5 }] },
      { id: 'c', target: 'fx.g.db', label: 'Gain — Level', enabled: true, points: [] },
    ];
    state.automationSel = null;
    renderAutomation();
    const tl = $('perfCanvas');
    const rows = () => [...document.querySelectorAll('.automation-lane')].map((r) => r.dataset.lane);
    const first = rows();
    // The panel is the sequencer's: its header, its transport row, its
    // timeline, its status row, its resize grip.
    const panel = {
      header: $('perfHeader')?.textContent.replace(/\s+/g, ' ').trim(),
      info: $('perfHeaderInfo')?.textContent,
      rec: $('automationCapture')?.textContent.trim(),
      play: $('perfPlayBtn')?.textContent.trim(),
      status: !!$('perfStatus'), pos: $('perfPos')?.textContent, grip: !!$('perfResize'),
      lanesMenu: [...$('perfLaneSelect').options].map((o) => o.textContent),
      font: getComputedStyle($('automationCapture')).fontFamily,
    };
    // Click the second lane, by the rects the draw left.
    const hit = perfLaneHits.find((h) => h.id === 'b');
    const r = tl.getBoundingClientRect();
    tl.dispatchEvent(new MouseEvent('click', {
      clientX: r.left + r.width / 2, clientY: r.top + (hit.y0 + hit.y1) / 2, bubbles: true,
    }));
    const second = rows();
    const colours = ['stretch.grain.rateHz', 'stretch.vocoder.magFreeze', 'fx.g.db', 'stretch.ratio'].map(perfLaneColor);
    const height = tl.offsetHeight;
    state.automation.lanes = JSON.parse(kept);
    state.automationSel = null;
    renderAutomation();
    return { first, second, colours, panel, height, hits: perfLaneHits.length };
  });
  expect(got.panel.header).toMatch(/^▾ PERFORMANCE — /);
  expect(got.panel.info).toMatch(/3 LANES/);
  expect(got.panel.rec).toBe('⏺ REC PERF');
  expect(got.panel.play).toBe('▶ PLAY PERF');
  expect(got.panel.status).toBe(true);
  expect(got.panel.pos).toBe('— · —');
  expect(got.panel.grip).toBe(true);
  expect(got.panel.lanesMenu).toEqual(['— lanes —', 'RATE', 'FREEZE', 'LEVEL']);
  expect(got.panel.font).toMatch(/Share Tech Mono/);
  // Ruler, three lanes and the struct lane, at the sequencer's own heights.
  expect(got.height).toBe(18 + 3 * 34 + 22 + 6);
  expect(got.first, 'one editor, for the first lane').toEqual(['a']);
  expect(got.second, 'the click did not open the second lane').toEqual(['b']);
  expect(new Set(got.colours).size).toBe(4);
});

// The record mode lives in the server's memory, so a reload does not clear it.
// The page used to come up saying Off whatever the server was doing: arm,
// reload, and every control moved on every file from then on was written
// into a lane until the server was restarted. The page now asks, says so,
// and lets go of the recorder when it leaves.
test('a recorder left armed is shown on reload, and leaving the page disarms it', async ({ page }) => {
  await open(page);
  await page.evaluate(() => postJSON('/api/automation/record', { mode: 'latch' }));
  await page.reload();
  await open(page);
  await page.waitForFunction(() => state.automationRecord === 'latch', { timeout: 10_000 });
  const shown = await page.evaluate(() => ({
    control: $('automationRecord').value,
    status: $('perfStatus')?.textContent || '',
  }));
  expect(shown.control, 'the control still says Off').toBe('latch');
  expect(shown.status, 'nothing said the recorder was armed').toMatch(/LEFT ARMED/);

  // Leave. The beacon goes out as the page unloads.
  await page.goto('about:blank');
  await expect.poll(async () => (await (await page.request.get('/api/automation/record')).json()).mode,
    { timeout: 5_000, message: 'the server is still armed after the page left' }).toBe('off');
});

// Take the README's screenshots, from the real program.
//
// Not mockups and not crops of a screen recording: this drives the actual
// binary in a real browser and writes PNGs. So when the interface changes, the
// pictures are one command away from being right again rather than quietly
// three versions stale — which is the usual fate of screenshots in a readme.
//
//     node tools/screenshots.mjs                  # against a running instance
//     node tools/screenshots.mjs --port 8791      # against the scratch server
//
// It expects an instance already running with a library in it. The scratch
// server's library is two synthetic tones, which is honest but looks like
// nothing; the pictures are worth more taken against real sounds.

import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'docs', 'screenshots');

const argPort = process.argv.indexOf('--port');
const PORT = argPort > -1 ? process.argv[argPort + 1] : '8737';
const BASE = `http://127.0.0.1:${PORT}`;

mkdirSync(OUT, { recursive: true });

/// Big enough that the panels are laid out as they are meant to be, and at 2×
/// so the text is not mush on a retina screen.
const VIEWPORT = { width: 1600, height: 1000 };

const shots = [];
async function shot(page, name, target) {
  const file = join(OUT, `${name}.png`);
  const el = typeof target === 'string' ? await page.locator(target).first() : null;
  if (el) await el.screenshot({ path: file });
  else await page.screenshot({ path: file });
  shots.push(name);
  console.log(`  ${name}.png`);
}

const settle = (page, ms = 700) => page.waitForTimeout(ms);

async function openASound(page) {
  await page.evaluate(async () => {
    const folder = state.folders[0].name;
    const files = await api(`/api/files?folder=${encodeURIComponent(folder)}`);
    // The longest of the first handful — a picture of four minutes of audio
    // says more about the program than a picture of a one-shot.
    const pick = files.slice(0, 12).sort((a, b) => (b.frames || 0) - (a.frames || 0))[0];
    await selectFile(pick);
    setMode('edit');
  });
  await page.waitForFunction(() => Object.keys(state.grainRows || {}).length > 0,
    { timeout: 30_000 });
  await settle(page, 2500);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 2 });

console.log(`taking screenshots against ${BASE}`);
await page.goto(BASE);
await page.waitForFunction(
  () => typeof state !== 'undefined' && (state.folders || []).length > 0,
  { timeout: 30_000 });

// The theme the program ships looking like.
await page.evaluate(() => {
  themeState.chosen = 'conifer';
  saveTheme(); applyChosenTheme(); renderThemeList();
});
await settle(page, 1500);

// ---------------------------------------------------------------- the library
//
// With a sound chosen, so the tag panel has something in it and the middle is
// not a paragraph telling you to pick one.
await page.evaluate(async () => {
  setMode('browse');
  const folder = state.folders[0].name;
  const files = await api(`/api/files?folder=${encodeURIComponent(folder)}`);
  await selectFile(files[1] || files[0]);
});
await settle(page, 3000);          // thumbnails are fetched and drawn
await shot(page, '01-library');

// ----------------------------------------------------------------- the editor
await openASound(page);
await shot(page, '02-editor');

// ------------------------------------------------------- stretching, per engine
await page.evaluate(() => showPane('right', 'stretch'));
await settle(page);
for (const [i, alg] of ['granular', 'pvsola'].entries()) {
  await page.evaluate((a) => {
    document.querySelector(`#stretchEngine .seg-btn[data-alg="${a}"]`).click();
  }, alg);
  await settle(page, 900);
  await shot(page, `0${3 + i}-stretch-${alg}`, '.dock');
}

// ------------------------------------------------------------ the grain cloud
await page.evaluate(async () => {
  document.querySelector('#stretchEngine .seg-btn[data-alg="granular"]').click();
  await new Promise((r) => setTimeout(r, 400));
  state.stretchDraft.ratio = 4.0;
  state.grainDraft.densityHz = 140;
  state.grainDraft.layers = 4;
  state.grainDraft.positionJitterMs = 220;
  state.grainDraft.pitchJitterSemis = 5;
  await editOp({ op: 'stretch', ...state.stretchDraft, grain: state.grainDraft });
});
await settle(page, 3500);

// Zoomed in, or there is nothing to see.
//
// Half a million grain marks across four minutes is a solid smear at one pixel
// per two hundred frames — the first version of this shot was indistinguishable
// from the plain editor. A couple of seconds across the lane is where the
// individual marks, the read band and the sparks are actually legible.
await page.evaluate(async () => {
  const sr = state.view.sampleRate;
  state.sel = { start: Math.round(sr * 20), end: Math.round(sr * 22.5) };
  fitSelection();
  await new Promise((r) => setTimeout(r, 1500));
  await loadGrains();
});
await settle(page, 3000);
await shot(page, '05-grains-on-the-waveform');

// -------------------------------------------------------- the views, in a window
//
// A 3D view rather than the 2D swarm. The swarm is a picture of *now* and needs
// the transport running to be anything at all — and playing a sound through
// somebody's speakers to take a photograph of it is not on. The object views
// draw the whole stretch standing still, which is the better picture anyway.
await page.evaluate(() => openVisWindow());
await settle(page, 1200);
for (const [name, vis] of [['braid', '2'], ['lattice', '5']]) {
  await page.evaluate((v) => {
    document.querySelector(`#grainVis [data-vis="${v}"]`)?.click();
  }, vis);
  // The frame loads p5 and builds the geometry; it is not instant.
  await settle(page, 6000);
  await shot(page, `06-grain-views-${name}`, '#visWindow');
}
await page.evaluate(() => closeVisWindow());

// ----------------------------------------------------------------- the effects
await page.evaluate(() => {
  document.querySelector('.dock-tab[data-dock="effects"]')?.click();
});
await settle(page, 1200);
await shot(page, '07-effects', '.dock');

// ------------------------------------------------------------------- the keys
// The panel itself. In a full-window shot it is a postage stamp in the corner.
await page.evaluate(() => openKeyboard());
await settle(page, 1200);
await shot(page, '08-keyboard', '#keyboardModal .kb-card, #keyboardModal');
await page.evaluate(() => closeKeyboard());

// ----------------------------------------------------------------- the themes
await page.evaluate(() => {
  const rail = [...document.querySelectorAll('.rail *')]
    .find((e) => e.textContent.trim() === 'Theme');
  rail?.click();
});
await settle(page, 1200);
await shot(page, '09-themes', '#paneTheme');

// ------------------------------------------------------------- exporting a loop
await page.evaluate(() => {
  const sr = state.view.sampleRate;
  state.sel = { start: Math.round(sr * 1.0), end: Math.round(sr * 3.5) };
  state.loopOn = true;
  drawSelection();
  $('exportBtn').click();
});
await settle(page, 900);
await shot(page, '10-export-loop', '.export-card');

console.log(`\n${shots.length} screenshots in docs/screenshots/`);
await browser.close();

// Driving the real interface, in a real browser, against a real server.
//
// `tools/ui-check.mjs` reads the source and finds references that do not
// resolve. It cannot see a control wired to the wrong value, a panel that
// throws while it builds, or a double-click that does nothing — and those are
// what has actually reached the screen.
//
// The server is a scratch instance on a port of its own with a library of its
// own, so none of this can touch a working session. See `tools/scratch-server.mjs`.

import { defineConfig, devices } from '@playwright/test';

// The scratch server by default. `AUDIOLAB_TEST_PORT` points the suite at an
// instance that is already running instead — the real one, with a real library,
// which is the only way to exercise anything that needs sounds longer than the
// scratch server's two one-second tones.
const EXTERNAL = !!process.env.AUDIOLAB_TEST_PORT;

// **Several tests at once, each with a server of its own.** One server holds one
// engine and one document, so two tests on one server fight over both. With
// `MGL_WORKERS=N`, N scratch servers start, on 8791, 8792, …, and worker k
// (Playwright's `TEST_PARALLEL_INDEX`, 0 to N−1, set in each worker before it
// reads this file) drives the one on 8791 + k. A test file still runs from top to
// bottom in one worker, on one server. One by default, and always one against an
// external instance. Not used by default anywhere yet: the MacBook stays at one
// (RJ, 20 Nov 2026: four at once "is a bad idea on the mac book, it is OK on the
// PC"), and on the PC four at once took 48 minutes with 70 failures, most of them
// timeouts (20 Nov), against about 30 minutes one at a time on the MacBook.
const WORKERS = EXTERNAL ? 1 : Math.max(1, Number(process.env.MGL_WORKERS) || 1);
const FIRST = 8791;
const PORT = Number(process.env.AUDIOLAB_TEST_PORT) || FIRST + (Number(process.env.TEST_PARALLEL_INDEX) || 0);

export default defineConfig({
  testDir: './tests/ui',
  // The interface holds one document at a time and the server holds one engine,
  // so each worker has a server of its own (see `WORKERS` above).
  workers: WORKERS,
  fullyParallel: false,
  // A failing interface test is nearly always a real fault rather than a flake,
  // and retrying hides the difference.
  retries: 0,
  reporter: [['list']],
  timeout: 30_000,
  use: {
    // **Headless, and stated rather than assumed.** These runs are frequent and
    // a browser window taking focus in the middle of somebody's work is not a
    // cost worth paying for a test that nobody is watching. `PWHEAD=1` opens it
    // when you do want to watch.
    headless: !process.env.PWHEAD,
    baseURL: `http://127.0.0.1:${PORT}`,
    ...devices['Desktop Chrome'],
    // The panels are laid out for a real window; at a phone's width the docks
    // collapse and the tests would be measuring the wrong thing.
    viewport: { width: 1600, height: 1000 },
    // **On the GPU.** Playwright's default headless browser is the headless
    // shell, which draws WebGL with SwiftShader — on the CPU. Every room, film
    // and Stage test then burnt five cores and ran into its timeout (measured
    // 27 Oct 2026: "SwiftShader Device" against "ANGLE Metal Renderer: Apple
    // M3"). The full Chromium build, headless, draws on the Metal GPU. On a
    // Linux CI runner with no GPU it falls back to software as before.
    channel: 'chromium',
    // **Silent.** A test page that plays (the sequencer, a preview) must not
    // sound on a machine somebody is working at; the engine's own output is
    // muted by the scratch server (`AUDIOLAB_MUTE_OUTPUT`).
    launchOptions: { args: ['--mute-audio'] },
    trace: 'retain-on-failure',
    // A picture of the page when a test fails: the PC Controller's Tests page
    // shows it beside the failure (tools/pc/progress-reporter.mjs keeps it).
    screenshot: 'only-on-failure',
  },
  // Not started when pointed at an instance that is already up — killing the
  // user's own session to run a test would be a poor trade.
  webServer: EXTERNAL ? undefined : Array.from({ length: WORKERS }, (_, k) => ({
    command: 'node tools/scratch-server.mjs',
    url: `http://127.0.0.1:${FIRST + k}/api/state`,
    env: { SCRATCH_PORT: String(FIRST + k) },
    reuseExistingServer: false,
    // Each one runs a no-op `cargo build` first, and cargo lets one at a time
    // into the build folder, so the last of several waits on the others.
    timeout: 30_000 + 15_000 * k,
    stdout: 'ignore',
    stderr: 'pipe',
  })),
});

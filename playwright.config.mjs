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

const PORT = 8791;

export default defineConfig({
  testDir: './tests/ui',
  // The interface holds one document at a time and the server holds one engine.
  // Running these in parallel would have them fighting over both.
  workers: 1,
  fullyParallel: false,
  // A failing interface test is nearly always a real fault rather than a flake,
  // and retrying hides the difference.
  retries: 0,
  reporter: [['list']],
  timeout: 30_000,
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    ...devices['Desktop Chrome'],
    // The panels are laid out for a real window; at a phone's width the docks
    // collapse and the tests would be measuring the wrong thing.
    viewport: { width: 1600, height: 1000 },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node tools/scratch-server.mjs',
    url: `http://127.0.0.1:${PORT}/api/state`,
    reuseExistingServer: false,
    timeout: 30_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});

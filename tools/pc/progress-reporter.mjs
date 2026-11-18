// A Playwright reporter for the PC Controller's Tests page (RJ, 18 Nov 2026):
// a line for every finished test in <run>\progress.jsonl, so the page can show
// a run while it is going, and each failure's picture and trace kept in
// <run>\art\ (Playwright's own test-results folder is emptied by the next run).
// Does nothing unless run-tests.cmd has set MGL_RUN_DIR.
import fs from 'node:fs';
import path from 'node:path';

const ANSI = /\x1b\[[0-9;]*m/g;
const STATUS = { passed: 'p', skipped: 's' }; // anything else failed

export default class Progress {
  constructor() { this.dir = process.env.MGL_RUN_DIR || ''; this.n = 0; }
  printsToStdio() { return false; }
  onBegin(config, suite) {
    if (!this.dir) return;
    this.root = config.rootDir;
    fs.mkdirSync(path.join(this.dir, 'art'), { recursive: true });
    this.out = path.join(this.dir, 'progress.jsonl');
    fs.writeFileSync(this.out, JSON.stringify({ total: suite.allTests().length }) + '\n');
  }
  onTestEnd(test, result) {
    if (!this.dir) return;
    const n = this.n++;
    const row = {
      f: path.relative(this.root, test.location.file).replace(/\\/g, '/'), l: test.location.line,
      t: test.titlePath().slice(3).join(' › '), s: STATUS[result.status] || 'f', ms: Math.round(result.duration),
    };
    if (row.s === 'f') {
      const e = result.errors?.[0] || result.error;
      row.e = String(e?.message || e?.value || result.status).replace(ANSI, '').slice(0, 4000);
      for (const a of result.attachments || []) {
        const kind = a.name === 'screenshot' ? 'shot' : a.name === 'trace' ? 'trace' : '';
        if (!kind || !a.path || row[kind]) continue;
        const name = `${n}-${kind}${path.extname(a.path)}`;
        try { fs.copyFileSync(a.path, path.join(this.dir, 'art', name)); row[kind] = name; } catch { /* the file is not there */ }
      }
    }
    fs.appendFileSync(this.out, JSON.stringify(row) + '\n');
  }
}

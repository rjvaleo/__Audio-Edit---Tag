// The record of a test run on the PC, for the PC Controller's Tests page
// (RJ, 18 Nov 2026). Called by run-tests.cmd:
//
//   node tools/pc/run-log.mjs start rust            a run begins (building)
//   node tools/pc/run-log.mjs start tests/ui/x.spec.mjs ...
//   node tools/pc/run-log.mjs phase tests           the build is done
//   node tools/pc/run-log.mjs end 0                 the run is over, with its exit code
//   node tools/pc/run-log.mjs busy                  exits 1, and says so, while a run is going
//
// Each run is a folder, <root>\results\runs\<time>\, holding `run.json`, and
// for a browser run `progress.jsonl` (a line a test, written by
// progress-reporter.mjs) with the failures' pictures and traces in `art\`; for
// a Rust run, `rust.log`. `results\current.txt` names the run in hand. The last
// 20 runs are kept.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.env.MGL_TEST_ROOT || process.env.ROOT || 'D:\\mgl-test';
const RES = path.join(ROOT, 'results');
const RUNS = path.join(RES, 'runs');
const CUR = path.join(RES, 'current.txt');
const KEEP = 20;

const read = (p, or = null) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return or; } };
const write = (p, o) => { fs.writeFileSync(p + '.tmp', JSON.stringify(o)); fs.renameSync(p + '.tmp', p); };
const current = () => { try { return fs.readFileSync(CUR, 'utf8').trim(); } catch { return ''; } };

const alive = pid => { if (!pid) return false; try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
// The run in hand, if it is still going: one run at a time on the PC. Two at once
// share the code, the build and the scratch server's port (18 Nov 2026: a second
// Rust run could not open the log the first was writing, ran nothing and said 0).
const going = () => { const r = read(path.join(current(), 'run.json')); return r && r.phase !== 'done' && alive(r.pid) ? r : null; };

const [what, ...args] = process.argv.slice(2);
if (what === 'busy' || what === 'start') {
  const r = going();
  if (r) { console.log(`busy: the PC is running the ${r.kind} tests, started ${r.started} (run ${r.id})`); process.exit(what === 'busy' ? 1 : 3); }
  if (what === 'busy') process.exit(0);
}
if (what === 'start') {
  const d = new Date(), z = n => String(n).padStart(2, '0');
  const id = `${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}`;
  const dir = path.join(RUNS, id);
  fs.mkdirSync(dir, { recursive: true });
  const sent = read(path.join(RES, 'sent.json'), {});
  const rust = args[0] === 'rust';
  write(path.join(dir, 'run.json'), {
    id, kind: rust ? 'rust' : 'browser', args: rust ? [] : args, started: d.toISOString(), phase: 'build',
    // The batch file's own cmd.exe: alive for as long as the run is, and the root of everything it starts.
    pid: process.ppid, commit: sent.commit || '', branch: sent.branch || '', dirty: !!sent.dirty, sent: sent.when || '',
  });
  fs.writeFileSync(CUR, dir);
  const old = fs.readdirSync(RUNS).filter(n => /^\d{8}-\d{6}$/.test(n)).sort().slice(0, -KEEP);
  for (const n of old) fs.rmSync(path.join(RUNS, n), { recursive: true, force: true });
} else if (what === 'phase' || what === 'end') {
  const dir = current(), p = path.join(dir, 'run.json'), run = dir && read(p);
  if (run) {
    if (what === 'phase') { run.phase = args[0]; run[`${args[0]}At`] = new Date().toISOString(); }
    else {
      run.code = Number(args[0]) || 0; run.ended = new Date().toISOString();
      if (run.phase === 'build') run.buildFailed = true;
      run.phase = 'done';
      if (run.buildFailed) { try { fs.copyFileSync(path.join(RES, 'build.log'), path.join(dir, 'build.log')); } catch { /* no log to keep */ } }
    }
    write(p, run);
  }
} else {
  console.error('run-log.mjs: start | phase <name> | end <code> | busy'); process.exit(2);
}

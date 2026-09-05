// Static checks over the shipped interface.
//
// `node --check` proves the file parses. It has never once caught the bugs that
// actually reach the screen here, all of which are the same shape: something is
// *referenced* that is not there. A function deleted while a call to it stayed.
// An element id renamed. A control handed a default that does not exist. Each
// of those is a ReferenceError or a silent no-op at run time, and each has
// shipped — twice blanking an entire panel.
//
// So this looks for references that do not resolve, and for the one behaviour
// that is easy to add and easy to forget: a control you can double-click to put
// back where it started.
//
// Deliberately dependency-free and deliberately not a parser. It reads the
// files the binary serves, with a small hand-written scanner that understands
// strings, comments and nesting well enough to find call arguments. What it
// cannot see is written down under KNOWN LIMITS at the bottom, because a check
// that overstates its reach is worse than no check.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const app = readFileSync(join(root, 'ui/app.js'), 'utf8');
const html = readFileSync(join(root, 'ui/index.html'), 'utf8');

const failures = [];
const notes = [];
const fail = (m) => failures.push(m);
const lineOf = (i) => app.slice(0, i).split('\n').length;

// ---------------------------------------------------------------- scanning

/// Blank out strings, template literals, regexes and comments.
///
/// Everything below wants to look at *code*. Without this, a word in a tooltip
/// counts as an identifier and a brace in a string breaks the nesting.
function code(src) {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const two = src.slice(i, i + 2);
    if (two === '//') {
      const j = src.indexOf('\n', i);
      const end = j === -1 ? src.length : j;
      out += ' '.repeat(end - i);
      i = end;
    } else if (two === '/*') {
      const j = src.indexOf('*/', i + 2);
      const end = j === -1 ? src.length : j + 2;
      out += src.slice(i, end).replace(/[^\n]/g, ' ');
      i = end;
    } else if (c === '"' || c === "'" || c === '`') {
      const q = c;
      let j = i + 1;
      let depth = 0;
      while (j < src.length) {
        if (src[j] === '\\') { j += 2; continue; }
        if (q === '`' && src.slice(j, j + 2) === '${') { depth++; j += 2; continue; }
        if (q === '`' && depth > 0 && src[j] === '}') { depth--; j++; continue; }
        if (src[j] === q && depth === 0) break;
        j++;
      }
      const end = Math.min(j + 1, src.length);
      out += src.slice(i, end).replace(/[^\n]/g, ' ');
      i = end;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

const bare = code(app);

/// The top-level arguments of a call whose opening paren is at `open`.
///
/// Nesting-aware, so a callback containing commas is one argument. Reads from
/// the original source, since arguments are wanted verbatim.
function argsAt(open) {
  const args = [''];
  let depth = 0;
  for (let j = open; j < bare.length; j++) {
    const c = bare[j];
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) {
      if (depth === 0) break;
      depth--;
    }
    if (c === ',' && depth === 0) { args.push(''); continue; }
    args[args.length - 1] += app[j];
  }
  return args.map((a) => a.trim());
}

function callsTo(name) {
  const out = [];
  const re = new RegExp(`\\b${name}\\(`, 'g');
  let m;
  while ((m = re.exec(bare))) {
    const open = m.index + m[0].length;
    out.push({ at: m.index, line: lineOf(m.index), args: argsAt(open) });
  }
  return out;
}

// ------------------------------------------- 1. double-click puts it back
//
// `param` and `knob` only attach the reset when they are given a default, and
// they say nothing when they are not — which is how one fader sat unreachable
// among eight that worked, for as long as the panel existed.

const controls = [...callsTo('param'), ...callsTo('knob')];
const noDefault = controls.filter((c) => c.args.length < 10 || !c.args[9]);
for (const c of noDefault) {
  fail(`app.js:${c.line}  control ${c.args[0] || '(unnamed)'} has no default — double-click will not reset it`);
}
notes.push(`${controls.length} controls, ${controls.length - noDefault.length} with a reset`);

// --------------------------------------- 2. those defaults have to be real
//
// `GRAIN_DEFAULTS.postion` is not a syntax error. It is `undefined`, which the
// guard above treats exactly like no default at all — silently.

const tables = {};
for (const m of app.matchAll(/const (\w+_DEFAULTS)\s*=\s*\{/g)) {
  const open = bare.indexOf('{', m.index);
  let depth = 0, j = open;
  for (; j < bare.length; j++) {
    if (bare[j] === '{') depth++;
    else if (bare[j] === '}' && --depth === 0) break;
  }
  tables[m[1]] = new Set([...app.slice(open, j).matchAll(/(\w+)\s*:/g)].map((x) => x[1]));
}
for (const c of controls) {
  const def = c.args[9];
  if (!def) continue;
  const m = /^(\w+_DEFAULTS)\.(\w+)$/.exec(def);
  if (!m) continue;
  if (!tables[m[1]]) fail(`app.js:${c.line}  no such defaults table ${m[1]}`);
  else if (!tables[m[1]].has(m[2])) {
    fail(`app.js:${c.line}  ${m[1]} has no key "${m[2]}" — the reset will silently do nothing`);
  }
}
notes.push(`${Object.keys(tables).length} defaults tables`);

// ----------------------------------------------- 3. every $('id') is real
//
// `$('gone').classList` throws, and it throws inside whatever was drawing at
// the time — which is how a renamed id takes a whole panel down with it.

const ids = new Set([...html.matchAll(/id="([\w-]+)"/g)].map((m) => m[1]));
const dynamic = new Set(); // ids the script creates itself
for (const m of app.matchAll(/\bid\s*=\s*['"]([\w-]+)['"]/g)) dynamic.add(m[1]);
for (const m of app.matchAll(/\.id\s*=\s*['"]([\w-]+)['"]/g)) dynamic.add(m[1]);
let idRefs = 0;
for (const m of app.matchAll(/\$\(\s*['"]([\w-]+)['"]\s*\)/g)) {
  idRefs++;
  if (!ids.has(m[1]) && !dynamic.has(m[1])) {
    fail(`app.js:${lineOf(m.index)}  $('${m[1]}') — no such id in index.html`);
  }
}
notes.push(`${idRefs} element lookups against ${ids.size} ids`);

// -------------------------------------------- 4. every call has a callee
//
// The one that has actually blanked panels: a function deleted, or renamed,
// while a call to it stayed behind.

const declared = new Set();
for (const m of bare.matchAll(/\bfunction\s+(\w+)\s*\(/g)) declared.add(m[1]);
// Any binding at all, however it is initialised. Narrowing this to things that
// *look* like functions missed `const preview = throttled(...)` and
// `const dismiss = topOverlay()` — both perfectly good callees — and a check
// that cries wolf gets ignored, which is worse than one that misses a little.
for (const m of bare.matchAll(/\b(?:const|let|var)\s+(\w+)\s*=/g)) declared.add(m[1]);
// Comma-separated declarators: `const r=…, xf=hz=>…, yf=db=>…` declares three
// things, and only the first was being seen.
for (const m of bare.matchAll(/\b(?:const|let|var)\s+([^;\n]+)/g)) {
  let depth = 0, name = '';
  for (const ch of m[1]) {
    if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) depth--;
    else if (depth === 0 && ch === ',') { name = ''; continue; }
    else if (depth === 0 && ch === '=') {
      const n = name.trim();
      if (/^\w+$/.test(n)) declared.add(n);
      name = '';
      continue;
    }
    if (depth === 0) name += ch;
  }
}
// Destructured bindings, which are how several helpers arrive.
for (const m of bare.matchAll(/\b(?:const|let|var)\s*[{[]([^}\]]*)[}\]]\s*=/g)) {
  for (const part of m[1].split(',')) {
    const n = part.split(':').pop().trim().split(/[\s=]/)[0];
    if (/^\w+$/.test(n)) declared.add(n);
  }
}
// `async (…) =>` is a keyword, not a call.
declared.add('async');
// Locally-scoped helpers are declared the same way inside functions, so the
// scan above already has them. Parameters are not, hence the allowance below.
for (const m of bare.matchAll(/\bfunction\s*\w*\s*\(([^)]*)\)/g)) {
  for (const p of m[1].split(',')) {
    const n = p.trim().split(/[\s=]/)[0].replace(/^\.\.\./, '');
    if (/^\w+$/.test(n)) declared.add(n);
  }
}
for (const m of bare.matchAll(/\(([^()]*)\)\s*=>/g)) {
  for (const p of m[1].split(',')) {
    const n = p.trim().split(/[\s=]/)[0].replace(/^\.\.\./, '');
    if (/^\w+$/.test(n)) declared.add(n);
  }
}
for (const m of bare.matchAll(/\b(\w+)\s*=>/g)) declared.add(m[1]);

const globals = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'function', 'await',
  'new', 'delete', 'void', 'do', 'else', 'in', 'of', 'yield', 'super', 'this',
  'Math', 'JSON', 'Object', 'Array', 'String', 'Number', 'Boolean', 'Date', 'Set',
  'Map', 'Promise', 'Error', 'RegExp', 'Symbol', 'BigInt', 'Infinity', 'NaN',
  // The weak collections, which were missing while `Set` and `Map` were here.
  // `new WeakSet()` in `visUnhide` failed this check — and therefore `cargo
  // test`, through `server/tests/interface.rs` — for as long as it has existed.
  // A checker that reports a language builtin as a dangling reference trains
  // people to ignore it, which is worse than not having it.
  'WeakSet', 'WeakMap', 'WeakRef',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURIComponent', 'decodeURIComponent',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame',
  'cancelAnimationFrame', 'fetch', 'alert', 'confirm', 'prompt', 'console', 'document',
  'window', 'navigator', 'location', 'localStorage', 'performance', 'ResizeObserver',
  'IntersectionObserver', 'MutationObserver', 'AbortController', 'URL', 'URLSearchParams',
  'Blob', 'FileReader', 'Image', 'Audio', 'AudioContext', 'structuredClone', 'queueMicrotask',
  'Intl', 'WebSocket', 'EventSource', 'DOMParser', 'getComputedStyle', 'matchMedia',
  // The typed arrays, completed. `Uint16Array` was the only one missing, which
  // is the same gap in a different family — it is used for every edge list in
  // `grain-shapes.js` and `shapes-4d.js`, and would have failed this check the
  // day either of them moved into `app.js`.
  'Int8Array', 'Uint8Array', 'Uint8ClampedArray', 'Int16Array', 'Uint16Array',
  'Int32Array', 'Uint32Array', 'Float32Array', 'Float64Array',
  'ArrayBuffer', 'DataView', 'TextDecoder',
  'TextEncoder', 'atob', 'btoa', 'CustomEvent', 'Event', 'Node', 'HTMLElement',
]);

// The other scripts on the page.
//
// `index.html` loads several classic scripts into one shared global scope, so a
// function declared in any of them is callable from `app.js`. Reading their
// declarations rather than listing the names by hand means adding a script is a
// script tag and nothing else — the first version of this check made
// `vgAttach` and `vgSmooth` look undeclared the moment `vis-gl.js` existed.
for (const src of [...html.matchAll(/<script src="\/([\w.-]+)"><\/script>/g)]) {
  const name = src[1];
  if (name === 'app.js') continue;
  let text;
  try { text = readFileSync(join(root, 'ui', name), 'utf8'); } catch { continue; }
  const flat = code(text);
  for (const m of flat.matchAll(/\bfunction\s+(\w+)\s*\(/g)) declared.add(m[1]);
  for (const m of flat.matchAll(/^(?:const|let|var)\s+(\w+)/gm)) declared.add(m[1]);
  notes.push(`${name} shares the global scope`);
}

let calls = 0;
const missing = new Map();
for (const m of bare.matchAll(/(^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) {
  const name = m[2];
  calls++;
  if (declared.has(name) || globals.has(name) || name === '$') continue;
  if (!missing.has(name)) missing.set(name, lineOf(m.index));
}
for (const [name, line] of missing) {
  fail(`app.js:${line}  ${name}() is called but never declared`);
}
notes.push(`${calls} calls checked against ${declared.size} declarations`);

// --------------------------------- 5. every engine button is a real engine
//
// The picker and the list the rest of the app switches on have drifted apart
// before — a button that selects an engine nothing else knows about.

const liveList = /const LIVE_ENGINES\s*=\s*\[([^\]]*)\]/.exec(app);
if (!liveList) fail('app.js  LIVE_ENGINES has gone');
else {
  const known = new Set([...liveList[1].matchAll(/'([\w]+)'/g)].map((m) => m[1]));
  for (const m of app.matchAll(/data-alg="(\w+)"/g)) {
    if (!known.has(m[1])) fail(`app.js:${lineOf(m.index)}  engine button "${m[1]}" is not in LIVE_ENGINES`);
  }
  notes.push(`${known.size} engines in the picker`);
}

// ------------------------------------------------- the markup actually nests
//
// Added after an edit to `index.html` left two orphan `</div>` behind and the
// whole page fell apart: the extra tags closed `.grain-split` and the dock
// early, so the browser list, the tag panel and the rail all landed on top of
// one another. Nothing caught it — the interface check passed, every Rust test
// passed, and the browser tests passed too, because Playwright's queries find
// elements perfectly well in a tree that is nested wrongly.
//
// A tag counter would have caught it in a second, so here is one.
{
  const lineIn = (i) => html.slice(0, i).split('\n').length;
  // Void elements never close; everything else is expected to.
  const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
    'link', 'meta', 'param', 'source', 'track', 'wbr']);
  const stack = [];
  const tag = /<(\/?)([a-zA-Z][\w-]*)([^>]*)>/g;
  let m;
  while ((m = tag.exec(html))) {
    const [, slash, name, rest] = m;
    const lower = name.toLowerCase();
    if (VOID.has(lower) || rest.trimEnd().endsWith('/')) continue;
    if (!slash) { stack.push({ name: lower, at: m.index }); continue; }
    const open = stack.pop();
    if (!open) {
      fail(`index.html:${lineIn(m.index)}  </${lower}> closes nothing — `
        + 'there is an orphan closing tag, and everything after it nests wrongly');
      continue;
    }
    if (open.name !== lower) {
      fail(`index.html:${lineIn(m.index)}  </${lower}> closes a <${open.name}> `
        + `opened at line ${lineIn(open.at)}`);
    }
  }
  for (const left of stack) {
    fail(`index.html:${lineIn(left.at)}  <${left.name}> is never closed`);
  }
  notes.push(`${(html.match(/<div\b/g) || []).length} divs, balanced`);
}

// ------------------------------------------------------------------ report

for (const n of notes) console.log(`  ${n}`);
console.log();
if (failures.length) {
  for (const f of failures) console.log(`FAIL  ${f}`);
  console.log(`\n${failures.length} problem${failures.length === 1 ? '' : 's'}`);
  process.exit(1);
}
console.log('interface checks passed');

// ------------------------------------------------------------ KNOWN LIMITS
//
// This is not a type checker and does not pretend to be one.
//
// - **Undeclared *variables* are not caught**, only undeclared *calls*. The
//   `eqBorn(i, …)` bug — where the index in scope was `selected`, not `i` —
//   would pass this. Catching it needs real scope analysis.
// - **Declarations are collected globally**, so a helper declared inside one
//   function counts as declared everywhere. That trades false alarms for
//   missed ones, which is the right way round for a check meant to be run
//   often.
// - **Nothing here runs the interface.** A control wired to the wrong value
//   still passes. That is what the route tests are for.

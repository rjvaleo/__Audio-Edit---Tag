// ================================================================ metastrip

function renderMetaStrip(f) {
  // Provenance: measured from the file's own header, versus inferred by the
  // classifier from its name. An inferred value is never shown as if it were read.
  const items = [
    ['format', f.format, 'measured'],
    ['rate', f.sampleRate ? f.sampleRate + ' Hz' : '—', 'measured'],
    ['depth', f.bits ? f.bits + '-bit' : '—', 'measured'],
    ['ch', f.channels || '—', 'measured'],
    ['duration', fmtDur(f.duration), f.format === 'RAW-PCM' ? 'guessed' : 'measured'],
    ['category', f.category, f.confidence === 'high' ? 'inferred' : 'guessed'],
  ];
  if (f.machine) items.push(['machine', f.machine, 'inferred']);
  if (f.instrument) items.push(['instrument', f.instrument, 'inferred']);
  if (f.bpm) items.push(['bpm', f.bpm, 'inferred']);

  const strip = $('metaStrip');
  strip.innerHTML = '';
  for (const [k, v, prov] of items) {
    const el = document.createElement('div');
    el.className = 'meta-item';
    el.innerHTML = `<div class="prov ${prov}"></div><span class="k"></span><span class="v"></span>`;
    el.querySelector('.k').textContent = k;
    el.querySelector('.v').textContent = v;
    el.title = {
      measured: 'read from the file header',
      inferred: 'inferred from the filename',
      guessed: 'assumed — treat as a suggestion',
    }[prov];
    strip.appendChild(el);
  }

  // The selection sits with the rest of the file's facts rather than off in the
  // toolbar: it is a measurement of this sound, and it belongs next to the
  // others. Appended last, so it reads as "…category sample, and you have this
  // much of it selected".
  const sel = document.createElement('div');
  sel.className = 'meta-item sel';
  sel.innerHTML = `<div class="prov measured"></div><span class="k">selection</span><span class="v" id="selLabel"></span>`;
  sel.title = 'the range currently selected';
  strip.appendChild(sel);
  updateSelLabel();
  // Fuller than its box: fade its end rather than let the volume cut a word
  // in half (C6, `docs/DESIGN-CRITIQUE.md`). Watched, because the box changes
  // with the window and with the workspace the bar is moved into.
  const fits = () => strip.classList.toggle('overflowing', strip.scrollWidth > strip.clientWidth + 1);
  if (!strip.dataset.watched && window.ResizeObserver) {
    strip.dataset.watched = '1';
    new ResizeObserver(fits).observe(strip);
  }
  fits();
}

// ======================================================= overview: the stats

async function loadStats() {
  const f = state.selectedFile;
  if (!f) return;
  let s;
  try { s = await api(`/api/stats?p=${encodeURIComponent(f.path)}`); }
  catch { return; }
  state.stats = s;
  renderStats(f, s);
  renderMeters(s);
}

function renderStats(f, s) {
  const cards = [
    [fmtDur(f.duration), 'duration'],
    [fmtDb(s.peakDbfs), 'peak'],
    [fmtDb(s.rmsDbfs), 'rms'],
    [(s.sampleRate / 1000).toFixed(1) + ' kHz', 'sample rate'],
    [s.bits + '-bit', 'bit depth'],
    [s.channels === 1 ? 'mono' : s.channels === 2 ? 'stereo' : s.channels + ' ch', 'channels'],
    [fmtBytes(f.bytes), 'size'],
    [s.frames.toLocaleString(), 'frames'],
  ];
  if (s.correlation !== null && s.correlation !== undefined) {
    cards.push([s.correlation.toFixed(3), 'correlation']);
  }
  if (s.dualMono) cards.push(['yes', 'dual mono']);
  if (s.clipped > 0) cards.push([s.clipped.toLocaleString(), 'clipped']);

  const grid = $('statsGrid');
  grid.innerHTML = '';
  const card = (v, l, wide) => {
    const el = document.createElement('div');
    el.className = 'stat-card' + (wide ? ' wide' : '');
    el.innerHTML = `<div class="v"></div><div class="l"></div>`;
    el.querySelector('.v').textContent = v;
    el.querySelector('.l').textContent = l;
    grid.appendChild(el);
  };
  for (const [v, l] of cards) card(v, l, false);
  card(f.format, 'format', true);
  card(f.category, 'category', true);

  // Say why it was classified that way, rather than presenting it as fact.
  $('whyBox').innerHTML = f.why
    ? `<b>Why “${f.category}”:</b> ${f.why}. Confidence is <b>${f.confidence}</b>.`
    : `<b>${f.category}</b> — no reason recorded.`;
}

function renderMeters(s) {
  // dBFS mapped onto a 60 dB window, which is where useful detail lives.
  const pct = (db) =>
    (db === null || !isFinite(db) ? 0 : Math.max(0, Math.min(100, (db + 60) / 60 * 100)));
  $('meters').innerHTML = '';
  for (const [k, v] of [['Peak', s.peakDbfs], ['RMS', s.rmsDbfs]]) {
    const el = document.createElement('div');
    el.className = 'meter-row';
    el.innerHTML = `<span class="k">${k}</span>
      <div class="bar"><div class="fill" style="width:${pct(v)}%"></div></div>
      <span class="v">${fmtDb(v)}</span>`;
    $('meters').appendChild(el);
  }

  const c = s.correlation;
  $('stereo').innerHTML = (c === null || c === undefined)
    ? `<div class="stat-row"><span class="k">Mono</span><span class="v">single channel</span></div>`
    : `<div class="stat-row"><span class="k">Correlation</span><span class="v">${c.toFixed(3)}</span></div>
       <div class="stat-row"><span class="k">Dual mono</span><span class="v">${s.dualMono ? 'yes' : 'no'}</span></div>`;
  if (s.clipped > 0) {
    $('stereo').innerHTML +=
      `<div class="stat-row"><span class="k">Clipped</span><span class="v">${s.clipped} samples</span></div>`;
  }
}


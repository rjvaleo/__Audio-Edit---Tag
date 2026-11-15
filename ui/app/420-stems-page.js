// ============================================================== the Stems page
//
// `mode: 'stems'`, a page of its own (14 Nov 2026, from the mock-up RJ
// approved). Two tabs:
//
// - **Split a song.** Pick a sound in the library, split it into drums, bass,
//   vocals and other with HT-Demucs (a helper program the server starts, see
//   `core/crates/server/src/stems.rs`), hear the stems alone or together, open
//   one on another page, and read what is in it: tempo, key, the drum bars, the
//   bass, the sections. **Teach the Band** hands the song to the Seq page.
// - **Make a sound.** Drum hits and bass notes cut from a song's stems, then a
//   chain: clean, upsample with air, saved to `Made/` in the library, from
//   where Grain and Prism put their effects on it.
//
// See `docs/STEMS.md`.

const ST = {
  built: false,
  tab: 'split',
  model: 'htdemucs',
  song: null,        // the open song: /api/stems/info
  list: [],
  status: null,
  poll: 0,
  watch: 0,
  serial: -1,
  lanes: {},         // stem -> { level, solo, mute }
  kind: 'drums',
  tries: [],
  pick: null,        // the chosen try
  src: null,         // a song opened from the computer: { p, name }, until one is picked in the library
  srcFrom: null,     // what the library had picked when it was opened
  made: null,        // the last saved sound
  chain: { up: true, rate: 96000, air: 0.35, above: 11000, clean: true, trim: -60, fade: 20, peak: -1 },
};

const ST_STEMS = ['drums', 'bass', 'vocals', 'other'];
ST.start = 'sounds';
ST.picks = [];
ST.vary = { nearFar: 0.5, n: 6, of: 0 };
ST.algo = 'vary';
ST.blend = { n: 7, wander: 0 };
ST.kit = { parts: new Set(['hat', 'ohat', 'shaker', 'rim', 'tomlo', 'tommid', 'conga', 'bass']) };
/// Made here, with MGL's own engines: no model, no GPU machine.
ST.loop = { bpm: 0, bars: 2, busy: 0.5, fills: 0.3, from: 'all' };
ST.texture = { seconds: 8, stretch: 20, density: 0.4, space: 0.5, shape: 'pad', n: 6 };
ST.mutate = { far: 0.5, n: 8, peak: -1, through: 'both' };
const ST_LOCAL = ['loop', 'texture', 'mutate'];
const ST_KIT = [['hat', 'closed hat'], ['ohat', 'open hat'], ['shaker', 'shaker'], ['rim', 'rim'], ['clap', 'clap'], ['tomlo', 'low tom'], ['tommid', 'mid tom'], ['conga', 'conga'], ['bass', 'bass note']];
/// The models (only Small is installed; the rest each need RJ's OK: MAKE-PLAN.md).
/// The models. Installed ones can be chosen; a guide sound (My sounds) needs
/// Stable Audio Open Small. Licences: page-mockups/MODELS.md.
const ST_MODELS = [
  { id: 'sao', name: 'Stable Audio Open Small', a: 'up to 11 s · under a second a sound · takes a guide', st: 'on the PC', cls: 'ok', min: 0.5, max: 11, guide: true, title: 'On the PC. Stability AI Community Licence: personal use.' },
  { id: 'tangoflux', name: 'TangoFlux', a: 'up to 30 s · ~15 s a sound · effects, textures', st: 'on the PC · personal use', cls: 'nc', min: 1, max: 30, title: 'On the PC. Non-commercial research licence: for your own music only.' },
  { id: 'acestep', name: 'ACE-Step 1.5', a: '10 s to 10 min · music, loops, whole pieces', st: 'on the PC · first use ~10 GB', cls: 'ask', min: 10, max: 600, title: 'On the PC. MIT licence. Its weights (about 10 GB) download the first time it is used.' },
  { id: 'open1', name: 'Stable Audio Open 1.0', a: 'up to 47 s · fuller · takes a guide', st: 'needs your OK', cls: 'ask', off: true, title: 'Not installed: needs its own Hugging Face gate accepted, and a download.' },
  { id: 'mgl', name: "MGL's own synths", a: '808 kit, sine bass, pads', st: 'next', cls: 'ask', off: true, title: 'The Seq page synths, rendered here: next.' },
];
ST.model = 'sao';
const ST_ALGOS = [
  { k: 'vary', name: 'VARIATIONS', d: 'new takes of a pick, from close to far' },
  { k: 'blend', name: 'BLEND TWO', d: 'a row of sounds part way from A to B' },
  { k: 'kit', name: 'KIT AROUND', d: 'hats, percussion, toms, a bass note that belong with them' },
  { k: 'loop', name: 'LOOP AROUND', d: 'the picks in a bar pattern learnt from your songs' },
  { k: 'texture', name: 'TEXTURE FROM', d: 'pads, drones, risers made from the picks by Grain' },
  { k: 'mutate', name: 'MUTATE', d: "versions through MGL's own effects" },
];
const ST_COL = {
  mix: 'var(--look-f-level)', drums: 'var(--look-f-attack)', bass: 'var(--look-f-tone)',
  vocals: 'var(--look-f-pitch)', other: 'var(--look-f-space)', guitar: 'var(--look-f-time)', piano: 'var(--look-f-time)',
};
const ST_SEC = ['var(--look-text-3)', 'var(--look-f-attack)', 'var(--look-f-space)', 'var(--look-f-tone)', 'var(--look-f-pitch)', 'var(--look-f-time)', 'var(--look-f-level)'];

function stEsc(s) {
  return String(s ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}
function stTime(s) {
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}
/// A CSS colour, resolved, for a canvas.
function stInk(v) {
  const m = /^var\((--[\w-]+)\)$/.exec(v);
  return m ? getComputedStyle(document.body).getPropertyValue(m[1]).trim() || '#ccc' : v;
}

/// The page's furniture, built once.
function stBuild() {
  const v = $('stemsView');
  if (!v || ST.built) return;
  ST.built = true;
  v.innerHTML = `
    <section class="st-panel st-top">
      <span class="st-title">STEMS <span>/ SPLIT · LEARN · MAKE</span></span>
      <span class="st-meta" id="stHelper"></span>
      <span class="st-grow"></span>
      <span id="stTabs"></span>
    </section>

    <div class="st-view" id="stSplit">
      <section class="st-panel st-src">
        <div class="st-file"><b id="stSrcName">Pick a song</b><span class="st-meta" id="stSrcMeta">from the library, or any file on the computer, then Split</span></div>
        <button class="st-btn" id="stChoose" title="Open the library drawer and click a song">From the library</button>
        <button class="st-btn" id="stOpenFile" title="Choose any sound file on the computer: it is copied into the library's Imports folder, then split">Open a file…</button>
        <input type="file" id="stFile" accept=".wav,.wave,.aif,.aiff,.aifc,.flac,.mp3,.m4a,.ogg,audio/*" hidden />
        <span class="st-vsep"></span>
        <div class="st-col"><span class="st-cap">Model</span><span id="stModel"></span></div>
        <span class="st-grow"></span>
        <div class="st-prog"><div class="st-bar"><i id="stBar"></i></div><span class="st-meta" id="stPhase"></span></div>
        <button class="st-btn st-primary" id="stGo">Split</button>
        <button class="st-btn hidden" id="stStop">Stop</button>
      </section>
      <div class="st-body">
        <div class="st-left">
          <section class="st-panel">
            <div class="st-ph"><b class="st-nm" id="stSongName">THE SONG</b><span class="st-meta" id="stSongMeta"></span><span class="st-grow"></span>
              <button class="st-btn st-sm" id="stPlayOrig" title="Play the original">▶ Original</button>
              <button class="st-btn st-sm" id="stPlayMix" title="Play the stems together, with the solos, mutes and levels below">▶ Stems</button>
              <button class="st-btn st-sm" id="stPause" title="Stop playing">■</button></div>
            <div class="st-well st-mix"><canvas id="stMixWave"></canvas><span class="st-empty" id="stMixEmpty">Pick a song: from the library, or Open a file…</span></div>
          </section>
          <section class="st-panel" style="flex:1">
            <div class="st-ph"><b class="st-nm">STEMS</b><span class="st-meta">solo, mute, level · ▶ hears one alone · open one on another page</span></div>
            <div class="st-lanes" id="stLanes"></div>
          </section>
        </div>
        <div class="st-right">
          <section class="st-panel hidden" id="stWhat">
            <div class="st-ph"><b class="st-nm">WHAT'S IN IT</b><span class="st-meta">read from the stems</span><span class="st-grow"></span><button class="st-btn st-sm" id="stReread" title="Read the stems again, without splitting again">Read again</button></div>
            <div class="st-facts" id="stFacts"></div>
            <span class="st-cap" id="stFamCap">The drums</span>
            <div class="st-g16" id="stFam"></div>
            <span class="st-cap" id="stBassCap">The bass</span>
            <div class="st-well st-roll"><canvas id="stRoll"></canvas></div>
            <span class="st-cap">Sections · where the stems come and go</span>
            <div class="st-secs" id="stSecs"></div>
            <div class="st-teach">
              <div class="st-row"><b class="st-nm">TEACH THE BAND</b><span class="st-grow"></span><span class="st-meta" id="stLearnt"></span></div>
              <p>Gives the Seq page's Band this song to learn from: its drum bars, bass lines, chords, tempo and sections. It learns your habits, never your audio.</p>
              <div class="st-row"><button class="st-btn st-primary" id="stLearn">Add this song</button><span class="st-grow"></span><button class="st-btn" id="stSummary" title="The analysis as text">Summary</button></div>
            </div>
          </section>
          <section class="st-panel" style="flex:1;min-height:90px">
            <div class="st-ph"><b class="st-nm">SPLIT SO FAR</b><span class="st-meta">Stems/ in the library</span></div>
            <div class="st-list" id="stList"></div>
          </section>
        </div>
      </div>
    </div>

    <div class="st-view hidden" id="stMake">
      <section class="st-panel">
        <div class="st-mktop">
          <div class="st-col"><span class="st-cap">Start from</span><span id="stStart"></span></div>
          <div class="st-col" style="flex:1;min-width:0"><span class="st-cap">Model</span><div class="st-models" id="stModels"></div></div>
        </div>
        <div class="st-row st-start st-start-stems"><span id="stKind"></span>
          <span class="st-cap">From</span><select class="st-field" id="stFrom" style="min-width:260px"></select>
          <span class="st-note">hits and notes cut from a split song's own stems</span></div>
        <div class="st-row st-start st-start-words">
          <input class="st-field st-prompt" id="stPrompt" placeholder="say the sound: deep round dub techno kick, short tail" />
          <span class="st-wbars" id="stWordsBars"></span></div>
        <div class="st-start st-start-sounds"><div class="st-picks" id="stPicks"></div></div>
        <div class="st-row"><span class="st-note" id="stModelNote"></span><span class="st-grow"></span><button class="st-btn st-primary" id="stMakeGo">Find them</button></div>
      </section>
      <section class="st-panel st-start st-start-sounds">
        <div class="st-ph"><b class="st-nm">MAKE AROUND THEM</b><span class="st-meta">pick a way · each makes a page of tries</span></div>
        <div class="st-algos" id="stAlgos"></div>
        <div class="st-row st-algoctl" id="stBlendCtl">
          <span class="st-meta" id="stBlendAB"></span>
          <span id="stBlendBars" class="st-wbars"></span>
          <input class="st-field" id="stBlendWords" style="flex:1;min-width:180px" placeholder="words for the wander (optional): drum hit, metallic…" />
        </div>
        <div class="st-row st-algoctl" id="stKitCtl">
          <span class="st-cap">Parts</span><span id="stKitParts" class="st-kitparts"></span>
          <input class="st-field" id="stKitStyle" style="flex:1;min-width:160px" placeholder="style (optional): dub techno, 808…" />
          <span class="st-meta" id="stKitHeard"></span>
        </div>
        <div class="st-row st-algoctl" id="stLoopCtl">
          <span id="stLoopBars" class="st-wbars"></span>
          <span class="st-cap">Learnt from</span><select class="st-field" id="stLoopFrom" style="min-width:200px"></select>
          <span class="st-meta">made here · kick, snare and hat from the picks</span>
        </div>
        <div class="st-row st-algoctl" id="stTextureCtl">
          <span id="stTexShape"></span>
          <span id="stTexBars" class="st-wbars"></span>
          <span class="st-meta">made here by Grain · the picks in turn</span>
        </div>
        <div class="st-row st-algoctl" id="stMutateCtl">
          <span class="st-cap">Of</span><span id="stMutOf"></span>
          <span id="stMutThrough"></span>
          <span id="stMutBars" class="st-wbars"></span>
          <span class="st-meta">made here · each label says its effects</span>
        </div>
        <div class="st-row st-algoctl" id="stVaryCtl">
          <span class="st-cap">Of</span><span id="stVaryOf"></span>
          <span id="stVaryBars" class="st-wbars"></span>
          <input class="st-field" id="stVaryWords" style="flex:1;min-width:200px" placeholder="what it is, to steer it (optional): 808 kick, dub rim…" />
        </div>
      </section>
      <section class="st-panel">
        <div class="st-ph"><b class="st-nm">TRIES</b><span class="st-meta" id="stTriesMeta">click one to hear it and choose it</span></div>
        <div class="st-tries" id="stTries"></div>
      </section>
      <section class="st-panel" style="flex:1">
        <div class="st-ph"><b class="st-nm">MAKE IT SOUND GOOD</b><span class="st-meta">the chosen try, in this order · then Grain and Prism for effects</span></div>
        <div class="st-chain">
          <div class="st-stage" id="stStClean" style="--sc:var(--look-text)"><span class="st-nm"><button class="st-power on" data-st="clean" title="On or off"></button>CLEAN</span><span class="st-note">trim the tail, fade, take out DC, set the peak</span><div id="stCleanBars" class="st-col" style="gap:4px"></div></div>
          <div class="st-stage" id="stStUp" style="--sc:var(--look-accent)"><span class="st-nm"><button class="st-power on" data-st="up" title="On or off"></button>UPSAMPLE</span><span class="st-note">resample, then air: harmonics above the cut-off, from the sound's own top</span><span id="stRate"></span><div id="stUpBars" class="st-col" style="gap:4px"></div></div>
          <div class="st-stage" style="--sc:var(--look-f-pitch)"><span class="st-nm">EFFECTS</span><span class="st-note">Saved sounds open in Grain or Prism with their engines, Hyperprism effects and the rack; Export there keeps what you hear.</span>
            <div class="st-row"><button class="st-btn" id="stOpenGrain" disabled>Open in Grain</button><button class="st-btn" id="stOpenPrism" disabled>Open in Prism</button><button class="st-btn" id="stOpenEdit" disabled>Edit</button></div></div>
        </div>
        <div class="st-ab">
          <div><span class="st-cap">As cut</span><div class="st-well"><canvas id="stAWave"></canvas></div></div>
          <div><span class="st-cap" id="stBCap">Saved</span><div class="st-well"><canvas id="stBWave"></canvas></div></div>
          <div style="justify-content:flex-end;gap:6px">
            <span class="st-cap">Name</span><input class="st-field" id="stName" placeholder="name" />
            <button class="st-btn" id="stHearA">▶ As cut</button>
            <button class="st-btn" id="stHearB" disabled>▶ Saved</button>
            <button class="st-btn st-primary" id="stKeep" disabled>Save to the library</button>
            <span class="st-meta" id="stSaved"></span>
          </div>
        </div>
      </section>
    </div>`;

  $('stTabs').append(uiSeg({ h: 28, value: ST.tab, items: [{ k: 'split', label: 'Split a song' }, { k: 'make', label: 'Make a sound' }], onPick: (k) => stTab(k) }));
  ST.modelSeg = uiSeg({
    h: 24, value: ST.model, onPick: (k) => { ST.model = k; },
    items: [
      { k: 'htdemucs', label: '4 stems', title: 'Drums, bass, vocals, other · 84 MB · the quickest' },
      { k: 'htdemucs_6s', label: '6 stems', title: 'Adds guitar and piano · 84 MB' },
      { k: 'htdemucs_ft', label: 'Best', title: 'The fine-tuned model · 333 MB · about four times slower' },
    ],
  });
  $('stModel').append(ST.modelSeg);
  if (ST.kind === 'words') ST.kind = 'drums';
  $('stKind').append(uiSeg({ h: 28, value: ST.kind, items: [{ k: 'drums', label: 'Drum hits' }, { k: 'bass', label: 'Bass notes' }], onPick: (k) => { ST.kind = k; } }));
  $('stStart').append(uiSeg({ h: 28, value: ST.start, items: [{ k: 'words', label: 'Words' }, { k: 'sounds', label: 'My sounds' }, { k: 'stems', label: 'My stems' }], onPick: (k) => { ST.start = k; stKindShow(); } }));
  $('stModels').innerHTML = ST_MODELS.map((m) => `<div class="st-model" data-m="${m.id}" title="${stEsc(m.title)}"><b>${m.name}</b><span>${m.a}</span><span class="st-mst ${m.cls}">${m.st}</span></div>`).join('');
  for (const el of $('stModels').querySelectorAll('.st-model')) el.onclick = () => {
    const m = ST_MODELS.find((x) => x.id === el.dataset.m);
    if (m.off || (ST.start === 'sounds' && !m.guide)) return;
    ST.model = m.id;
    ST.words.seconds = Math.min(m.max, Math.max(m.min, ST.words.seconds));
    stKindShow();
  };
  const built = ['vary', 'blend', 'kit', 'loop', 'texture', 'mutate'];
  $('stAlgos').innerHTML = ST_ALGOS.map((a) => `<div class="st-algo${built.includes(a.k) ? '' : ' off'}" data-k="${a.k}" title="${stEsc(built.includes(a.k) ? a.d : 'next: ' + a.d)}"><b>${a.name}</b><span>${built.includes(a.k) ? a.d : 'next'}</span></div>`).join('');
  for (const el of document.querySelectorAll('#stAlgos .st-algo')) el.onclick = () => { if (built.includes(el.dataset.k)) { ST.algo = el.dataset.k; stKindShow(); } };
  const B = ST.blend;
  $('stBlendBars').append(
    uiBar({ label: 'Steps', h: 24, w: 120, get: () => (B.n - 3) / 9, set: (u) => { B.n = Math.round(3 + u * 9); }, commit: () => {}, text: () => `${B.n}`, def: 4 / 9, col: 'var(--look-f-level)' }),
    uiBar({ label: 'Wander', h: 24, w: 150, get: () => B.wander, set: (u) => { B.wander = Math.round(u * 100) / 100; }, commit: () => {}, text: () => (B.wander ? `${Math.round(B.wander * 100)} %` : 'off'), def: 0, col: 'var(--look-f-level)' }));
  $('stKitParts').innerHTML = ST_KIT.map(([k, l]) => `<button class="st-btn st-sm${ST.kit.parts.has(k) ? ' on' : ''}" data-k="${k}">${l}</button>`).join('');
  for (const b of $('stKitParts').querySelectorAll('button')) b.onclick = () => { ST.kit.parts.has(b.dataset.k) ? ST.kit.parts.delete(b.dataset.k) : ST.kit.parts.add(b.dataset.k); b.classList.toggle('on', ST.kit.parts.has(b.dataset.k)); stKindShow(); };
  const L = ST.loop, T = ST.texture, M = ST.mutate;
  $('stLoopBars').append(
    uiBar({ label: 'Tempo', h: 24, w: 130, get: () => (L.bpm ? (L.bpm - 60) / 120 : 0), set: (u) => { L.bpm = u < 0.01 ? 0 : Math.round(60 + u * 120); }, commit: () => {}, text: () => (L.bpm ? `${L.bpm} BPM` : 'the song’s'), def: 0, col: 'var(--look-f-time)' }),
    uiBar({ label: 'Bars', h: 24, w: 100, get: () => [1, 2, 4].indexOf(L.bars) / 2, set: (u) => { L.bars = [1, 2, 4][Math.round(u * 2)]; }, commit: () => {}, text: () => `${L.bars}`, def: 0.5, col: 'var(--look-f-time)' }),
    uiBar({ label: 'Busy', h: 24, w: 120, get: () => L.busy, set: (u) => { L.busy = Math.round(u * 100) / 100; }, commit: () => {}, text: () => `${Math.round(L.busy * 100)} %`, def: 0.5, col: 'var(--look-f-attack)' }),
    uiBar({ label: 'Fills', h: 24, w: 120, get: () => L.fills, set: (u) => { L.fills = Math.round(u * 100) / 100; }, commit: () => {}, text: () => `${Math.round(L.fills * 100)} %`, def: 0.3, col: 'var(--look-f-attack)' }));
  $('stTexShape').append(uiSeg({ h: 24, value: T.shape, items: [{ k: 'pad', label: 'pad' }, { k: 'drone', label: 'drone' }, { k: 'riser', label: 'riser' }, { k: 'all', label: 'all' }], onPick: (k) => { T.shape = k; } }));
  $('stTexBars').append(
    uiBar({ label: 'Length', h: 24, w: 120, get: () => (T.seconds - 2) / 28, set: (u) => { T.seconds = Math.round(2 + u * 28); }, commit: () => {}, text: () => `${T.seconds} s`, def: 6 / 28, col: 'var(--look-f-time)' }),
    uiBar({ label: 'Stretch', h: 24, w: 120, get: () => Math.log(T.stretch / 2) / Math.log(50), set: (u) => { T.stretch = Math.round(2 * Math.pow(50, u)); }, commit: () => {}, text: () => `${T.stretch}×`, def: Math.log(10) / Math.log(50), col: 'var(--look-f-time)' }),
    uiBar({ label: 'Density', h: 24, w: 120, get: () => T.density, set: (u) => { T.density = Math.round(u * 100) / 100; }, commit: () => {}, text: () => `${Math.round(T.density * 100)} %`, def: 0.4, col: 'var(--look-f-level)' }),
    uiBar({ label: 'Space', h: 24, w: 120, get: () => T.space, set: (u) => { T.space = Math.round(u * 100) / 100; }, commit: () => {}, text: () => `${Math.round(T.space * 100)} %`, def: 0.5, col: 'var(--look-f-space)' }),
    uiBar({ label: 'How many', h: 24, w: 110, get: () => (T.n - 1) / 11, set: (u) => { T.n = Math.round(1 + u * 11); }, commit: () => {}, text: () => `${T.n}`, def: 5 / 11, col: 'var(--look-f-level)' }));
  $('stMutThrough').append(uiSeg({ h: 24, value: M.through, items: [{ k: 'hp', label: 'Hyperprism' }, { k: 'rack', label: 'the rack' }, { k: 'both', label: 'both' }], onPick: (k) => { M.through = k; } }));
  $('stMutBars').append(
    uiBar({ label: 'How far', h: 24, w: 130, get: () => M.far, set: (u) => { M.far = Math.round(u * 100) / 100; }, commit: () => {}, text: () => `${Math.round(M.far * 100)} %`, def: 0.5, col: 'var(--look-f-level)' }),
    uiBar({ label: 'How many', h: 24, w: 120, get: () => (M.n - 2) / 14, set: (u) => { M.n = Math.round(2 + u * 14); stKindShow(); }, commit: () => {}, text: () => `${M.n}`, def: 6 / 14, col: 'var(--look-f-level)' }),
    uiBar({ label: 'Keep level', h: 24, w: 130, get: () => (M.peak + 12) / 12, set: (u) => { M.peak = Math.round((-12 + u * 12) * 2) / 2; }, commit: () => {}, text: () => `${M.peak} dB`, def: 11 / 12, col: 'var(--look-f-level)' }));
  const V = ST.vary;
  $('stVaryBars').append(
    uiBar({ label: 'Near ↔ far', h: 24, w: 170, get: () => V.nearFar, set: (u) => { V.nearFar = Math.round(u * 100) / 100; }, commit: () => {}, text: () => V.nearFar.toFixed(2), def: 0.5, col: 'var(--look-f-level)' }),
    uiBar({ label: 'How many', h: 24, w: 130, get: () => (V.n - 2) / 10, set: (u) => { V.n = Math.round(2 + u * 10); }, commit: () => {}, text: () => `${V.n}`, def: 0.4, col: 'var(--look-f-level)' }));
  const W = ST.words = { seconds: 1.5, n: 4 };
  $('stWordsBars').append(
    uiBar({ label: 'Length', h: 24, w: 150, get: () => { const m = stModel(); return (W.seconds - m.min) / (m.max - m.min); }, set: (u) => { const m = stModel(); W.seconds = Math.round((m.min + u * (m.max - m.min)) * 10) / 10; }, commit: () => {}, text: () => (W.seconds >= 60 ? `${Math.floor(W.seconds / 60)}:${String(Math.round(W.seconds % 60)).padStart(2, '0')}` : `${W.seconds.toFixed(1)} s`), def: 0.1, col: 'var(--look-f-time)' }),
    uiBar({ label: 'Tries', h: 24, w: 120, get: () => (W.n - 1) / 7, set: (u) => { W.n = Math.round(1 + u * 7); }, commit: () => {}, text: () => `${W.n}`, def: 3 / 7, col: 'var(--look-f-level)' }));
  $('stPrompt').addEventListener('keydown', (e) => { if (e.key === 'Enter') stFindTries(); });
  $('stRate').append(uiSeg({ h: 24, value: ST.chain.rate, items: [{ k: 48000, label: '48 kHz' }, { k: 96000, label: '96 kHz' }], onPick: (k) => { ST.chain.rate = +k; } }));

  const bar = (box, label, get, set, text, def, col) => box.append(uiBar({ label, get, set: (u) => set(u), commit: () => {}, text, def, col, h: 24 }));
  const c = ST.chain;
  bar($('stCleanBars'), 'Trim below', () => (c.trim + 90) / 60, (u) => { c.trim = Math.round(-90 + u * 60); }, () => `${c.trim} dB`, 0.5, 'var(--look-f-level)');
  bar($('stCleanBars'), 'Fade out', () => c.fade / 200, (u) => { c.fade = Math.round(u * 200); }, () => `${c.fade} ms`, 0.1, 'var(--look-f-time)');
  bar($('stCleanBars'), 'Peak', () => (c.peak + 12) / 12, (u) => { c.peak = Math.round((-12 + u * 12) * 10) / 10; }, () => `${c.peak} dB`, 11 / 12, 'var(--look-f-level)');
  bar($('stUpBars'), 'Air', () => c.air, (u) => { c.air = Math.round(u * 100) / 100; }, () => `${Math.round(c.air * 100)} %`, 0.35, 'var(--look-f-tone)');
  bar($('stUpBars'), 'Above', () => (c.above - 4000) / 14000, (u) => { c.above = Math.round(4000 + u * 14000); }, () => `${(c.above / 1000).toFixed(1)} kHz`, 0.5, 'var(--look-f-tone)');

  for (const b of v.querySelectorAll('.st-power')) {
    b.onclick = () => {
      const k = b.dataset.st;
      c[k] = !c[k];
      b.classList.toggle('on', c[k]);
      b.closest('.st-stage').classList.toggle('off', !c[k]);
    };
  }
  $('stChoose').onclick = () => { if (typeof openDrawer === 'function') openDrawer(); };
  // Or any file on the computer, through the browser's own Open dialog.
  $('stOpenFile').onclick = () => $('stFile').click();
  $('stFile').onchange = () => { const f = $('stFile').files[0]; $('stFile').value = ''; if (f) stUpload(f); };
  $('stGo').onclick = stSplit;
  $('stStop').onclick = () => postJSON('/api/stems/stop', {}).catch(() => {});
  $('stPlayOrig').onclick = () => { const p = ST.song?.meta?.source; if (p) stPlay(p); };
  $('stPlayMix').onclick = stPlayMix;
  $('stPause').onclick = () => { if (engine.playing) pausePlayback(); };
  $('stLearn').onclick = stLearn;
  $('stSummary').onclick = stShowSummary;
  $('stReread').onclick = async () => {
    if (!ST.song) return;
    $('stReread').disabled = true;
    try { await postJSON('/api/stems/analyse', { p: ST.song.p }); await stOpenSong(ST.song.p); stRefreshList(); } catch (e) { toast(e.message); }
    $('stReread').disabled = false;
  };
  $('stMakeGo').onclick = stFindTries;
  $('stHearA').onclick = () => { if (ST.pick) stPlay(ST.pick.p); };
  $('stHearB').onclick = () => { if (ST.made) stPlay(ST.made.p); };
  $('stKeep').onclick = stKeep;
  const open = async (page) => {
    if (!ST.made) return;
    const file = await resolveFile(ST.made.p);
    if (page && typeof setEditPage === 'function') setEditPage(page, false);
    await openInEditor(file);
  };
  $('stOpenGrain').onclick = () => open('grain');
  $('stOpenPrism').onclick = () => open('prism');
  $('stOpenEdit').onclick = () => open('wave');
}

function stTab(k) {
  ST.tab = k;
  $('stSplit').classList.toggle('hidden', k !== 'split');
  $('stMake').classList.toggle('hidden', k !== 'make');
  if (k === 'make') stFillFrom();
  afterLayout(stDrawAll);
}

/// Arriving on the page.
function stEnter() {
  stBuild();
  stTab(ST.tab);
  stRefreshList();
  stPollStatus();
  // No watching the library's selection: the song changes only when one is
  // picked here (the drawer, Open a file…, Split so far), and the last pick wins.
  stShowSource();
}

function stLeave() {
  clearInterval(ST.watch);
  clearTimeout(ST.poll);
}

function stShowSource() {
  const name = $('stSrcName'), meta = $('stSrcMeta');
  if (!name) return;
  const src = ST.pending || (ST.song ? { p: ST.song.meta?.source || ST.song.p, name: ST.song.name } : null);
  if (!src) { name.textContent = 'Pick a song'; meta.textContent = 'From the library, or Open a file…'; return; }
  name.textContent = src.name;
  meta.textContent = [src.p.split('/').slice(0, -1).join('/'), src.duration ? stTime(src.duration) : ''].filter(Boolean).join(' · ');
}

// ------------------------------------------------------------------ split

/// A song picked in the library drawer while on this page: it becomes the
/// song here, and a double-click also shuts the drawer.
function stPick(file, close) {
  // On Make with My sounds, the drawer adds a sound to make around.
  if (ST.tab === 'make' && ST.start === 'sounds') {
    stAddPick(file.path, (file.name || file.path.split('/').pop()).replace(/\.[^.]+$/, ''));
    if (close && typeof closeDrawer === 'function') closeDrawer();
    return;
  }
  selectFile(file);
  stStage({ p: file.path, name: file.name || file.path.split('/').pop(), duration: file.duration });
  if (close && typeof closeDrawer === 'function') closeDrawer();
}

/// A song just picked takes over the page: if it was split before, its stems;
/// if not, its waveform in the overview and empty lanes that fill in when the
/// split is done.
function stStage(src) {
  ST.gen = (ST.gen || 0) + 1;
  ST.shown = src.p;
  const done = ST.list.find((x) => x.meta?.source === src.p);
  if (done) { stOpenSong(done.p); return; }
  ST.song = null;
  ST.pending = src;
  for (const it of document.querySelectorAll('#stList .st-it')) it.classList.remove('on');
  $('stSongName').textContent = src.name.toUpperCase();
  $('stSongMeta').textContent = [src.p.split('/').slice(0, -1).join('/'), src.duration ? stTime(src.duration) : '', 'not split yet · press Split'].filter(Boolean).join(' · ');
  stShowSource();
  $('stMixEmpty').classList.add('hidden');
  $('stWhat').classList.add('hidden');
  $('stLanes').innerHTML = ST_STEMS.map((k) => `<div class="st-lane st-wait" data-stem="${k}" style="--sc:${ST_COL[k]}"><div class="st-who"><b class="st-nm">${k.toUpperCase()}</b><span class="st-meta">waiting for the split</span></div><div class="st-well"><span class="st-empty">fills in when it is split</span></div><div class="st-act"></div></div>`).join('');
  stPollStatus();
  afterLayout(stDrawAll);
}

/// A song from the computer: its bytes go to the library's Imports folder, and
/// it becomes the song to split.
async function stUpload(file) {
  const name = $('stSrcName'), meta = $('stSrcMeta');
  name.textContent = file.name;
  meta.textContent = `copying into the library… ${(file.size / 1048576).toFixed(1)} MB`;
  try {
    const r = await fetch(`/api/stems/upload?name=${encodeURIComponent(file.name)}`, { method: 'POST', body: file });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `could not bring in ${file.name}`);
    stStage({ p: j.p, name: j.name });
  } catch (e) {
    toast(e.message);
    stShowSource();
  }
}

async function stSplit() {
  // The song on the page: the one just picked, or the one open (to split again).
  const f = ST.pending || (ST.song?.meta?.source ? { p: ST.song.meta.source } : null);
  if (!f) { toast('Pick a song: from the library, or Open a file…'); if (typeof openDrawer === 'function') openDrawer(); return; }
  try {
    await postJSON('/api/stems/split', { p: f.p || f.path, model: ST.model });
    stPollStatus();
  } catch (e) {
    toast(e.message);
  }
}

async function stPollStatus() {
  clearTimeout(ST.poll);
  let s;
  try { s = await api('/api/stems'); } catch { return; }
  ST.status = s;
  const helper = $('stHelper');
  helper.textContent = s.gpu ? `HT-DEMUCS AND STABLE AUDIO ON THE ${s.gpu.toUpperCase()}'S GPU · YOUR OWN MACHINES` : s.helper ? 'HT-DEMUCS ON THIS MACHINE · NOTHING LEAVES IT' : 'THE STEM SPLITTER IS NOT INSTALLED';
  ST.gpu = s.gpu || null;
  stKindShow();
  helper.classList.toggle('st-err', !s.helper);
  helper.title = s.helper ? s.helperPath : 'Put the demucs program in the models folder, or set AUDIOLAB_DEMUCS. See docs/STEMS.md.';
  $('stGo').disabled = !s.helper || s.running;
  $('stGo').textContent = ST.song && !ST.pending ? 'Split again' : 'Split';
  $('stStop').classList.toggle('hidden', !s.running);
  $('stBar').style.width = `${Math.round((s.running || s.phase === 'done' ? s.progress : 0) * 100)}%`;
  const ph = $('stPhase');
  ph.classList.toggle('st-err', !!s.error);
  if (s.running) ph.textContent = `${s.phase || 'working'} · ${stTime(s.elapsed)}`;
  else if (s.error) ph.textContent = s.phase === 'stopped' ? 'Stopped' : `Failed: ${s.error}`;
  else if (s.phase === 'done') ph.textContent = `Done in ${stTime(s.tookMs / 1000)} · ${s.song}`;
  else ph.textContent = '';
  stFillArriving(s);
  if (ST.serial !== -1 && s.serial !== ST.serial && !s.running) {
    // A run just ended: the list, the library and, if it worked, the song.
    await stRefreshList();
    if (typeof refreshLibrary === 'function') refreshLibrary();
    // Its stems come in only if it is still the song on the page (or nothing is).
    const here = ST.pending?.p || ST.song?.meta?.source || null;
    if (s.phase === 'done' && s.song && (!here || here === s.source)) stOpenSong(s.song);
  }
  ST.serial = s.serial;
  if (s.running && state.mode === 'stems') ST.poll = setTimeout(stPollStatus, 500);
}

/// While the song on the page comes back from the GPU machine, each waiting
/// lane shows how much of its stem is here, then its waveform the moment it
/// lands (RJ: "filling in as it comes in").
function stFillArriving(s) {
  if (!ST.pending || s.source !== ST.pending.p || !s.song) return;
  const arrived = new Set(s.arrived || []);
  const inc = s.incoming || {};
  for (const lane of document.querySelectorAll('#stLanes .st-lane.st-wait')) {
    const k = lane.dataset.stem;
    const meta = lane.querySelector('.st-who .st-meta'), well = lane.querySelector('.st-well');
    if (arrived.has(k) && !lane.dataset.in) {
      lane.dataset.in = '1';
      lane.classList.add('st-in');
      meta.textContent = 'here · reading the rest';
      well.innerHTML = `<canvas data-p="${stEsc(`${s.song}/${k}.wav`)}" data-stem="${k}"></canvas>`;
      stWave(well.querySelector('canvas'), `${s.song}/${k}.wav`, ST_COL[k]);
    } else if (!arrived.has(k) && inc[k] != null) {
      const pc = Math.round(inc[k] * 100);
      meta.textContent = `coming back · ${pc} %`;
      const empty = well.querySelector('.st-empty');
      if (empty) empty.textContent = `coming back from the ${ST.gpu || 'GPU machine'}`;
      if (!well.querySelector('.st-come')) well.insertAdjacentHTML('beforeend', '<i class="st-come"></i>');
      well.querySelector('.st-come').style.width = `${pc}%`;
    } else if (!arrived.has(k) && s.running && !lane.dataset.in) {
      meta.textContent = s.phase || 'waiting for the split';
    }
  }
}

async function stRefreshList() {
  try { ST.list = await api('/api/stems/list'); } catch { ST.list = []; }
  const box = $('stList');
  if (!box) return;
  box.innerHTML = ST.list.length
    ? ST.list.map((s) => `<div class="st-it${ST.song?.p === s.p ? ' on' : ''}" data-p="${stEsc(s.p)}"><span>${stEsc(s.name)}</span><i>${[s.card?.bpm ? `${s.card.bpm.toFixed(0)} BPM` : '', s.card?.key || '', s.card?.seconds ? stTime(s.card.seconds) : '', s.learnt ? 'learnt' : ''].filter(Boolean).join(' · ')}</i></div>`).join('')
    : '<p class="st-note">Nothing split yet. Pick a song in the library and press Split.</p>';
  for (const it of box.querySelectorAll('.st-it')) it.onclick = () => stOpenSong(it.dataset.p);
  stFillFrom();
}

async function stOpenSong(p) {
  const gen = ST.gen = (ST.gen || 0) + 1;
  let song;
  try { song = await api(`/api/stems/info?p=${encodeURIComponent(p)}`); } catch (e) { toast(e.message); return; }
  // A later pick came in while this one loaded: it wins.
  if (gen !== ST.gen) return;
  ST.song = song;
  for (const it of document.querySelectorAll('#stList .st-it')) it.classList.toggle('on', it.dataset.p === p);
  const s = ST.song, a = s.analysis;
  ST.pending = null;
  ST.shown = s.meta?.source || s.p;
  stShowSource();
  $('stSongName').textContent = s.name.toUpperCase();
  $('stSongMeta').textContent = [s.meta?.source || '', a ? stTime(a.duration_s) : '', s.meta?.splitSeconds ? `split in ${stTime(s.meta.splitSeconds)}` : ''].filter(Boolean).join(' · ');
  $('stMixEmpty').classList.add('hidden');
  ST.lanes = {};
  for (const f of s.files) ST.lanes[f.stem] = { level: 1, solo: false, mute: false };
  stBuildLanes();
  stFillWhat();
  stDrawAll();
  stPollStatus();
}

function stBuildLanes() {
  const box = $('stLanes');
  const s = ST.song;
  box.innerHTML = '';
  const tex = Object.fromEntries((s.analysis?.texture?.stems || []).map((t) => [t.stem, t]));
  for (const f of s.files) {
    const L = ST.lanes[f.stem];
    const row = document.createElement('div');
    row.className = 'st-lane';
    row.dataset.stem = f.stem;
    row.style.setProperty('--sc', ST_COL[f.stem] || 'var(--look-text)');
    const share = tex[f.stem] ? `${Math.round(tex[f.stem].share_of_energy * 100)} % of the energy` : '';
    row.innerHTML = `
      <div class="st-who"><b class="st-nm">${f.stem.toUpperCase()}</b><span class="st-meta">${share}</span>
        <div class="st-sm"><button class="st-btn st-sm solo" title="Solo: only the soloed stems play">S</button><button class="st-btn st-sm mute" title="Mute">M</button></div></div>
      <div class="st-well"><canvas data-p="${stEsc(f.p)}" data-stem="${f.stem}"></canvas></div>
      <div class="st-act">
        <div class="st-row"><button class="st-btn st-sm play" title="Hear this stem alone">▶ Alone</button>${f.stem === 'drums' ? '<button class="st-btn st-sm kit" title="Cut drum hits from this stem">Hits → Make</button>' : ''}${f.stem === 'bass' ? '<button class="st-btn st-sm notes" title="Cut bass notes from this stem">Notes → Make</button>' : ''}</div>
        <div class="st-row"><select class="st-field" title="Open this stem on another page"><option value="grain">Open in Grain</option><option value="chop">Open in Chop</option><option value="prism">Open in Prism</option><option value="wave">Open in Edit</option></select><button class="st-btn st-sm go">Go</button></div>
      </div>`;
    const sm = row.querySelector('.st-sm');
    sm.append(uiBar({ label: 'Level', h: 20, get: () => L.level / 1.5, set: (u) => { L.level = Math.round(u * 150) / 100; }, commit: () => {}, text: () => `${Math.round(L.level * 100)} %`, def: 1 / 1.5, col: ST_COL[f.stem] }));
    const solo = row.querySelector('.solo'), mute = row.querySelector('.mute');
    const paint = () => {
      const anySolo = Object.values(ST.lanes).some((x) => x.solo);
      for (const r of box.querySelectorAll('.st-lane')) {
        const l = ST.lanes[r.dataset.stem];
        r.classList.toggle('off', l.mute || (anySolo && !l.solo));
        r.querySelector('.solo').classList.toggle('on', l.solo);
        r.querySelector('.mute').classList.toggle('on', l.mute);
      }
    };
    solo.onclick = () => { L.solo = !L.solo; paint(); };
    mute.onclick = () => { L.mute = !L.mute; paint(); };
    row.querySelector('.play').onclick = () => stPlay(f.p);
    row.querySelector('.go').onclick = async () => {
      const page = row.querySelector('select').value;
      const file = await resolveFile(f.p);
      if (typeof setEditPage === 'function') setEditPage(page, false);
      await openInEditor(file);
    };
    const toMake = (kind) => { ST.kind = kind; stTab('make'); $('stFrom').value = s.p; stFindTries(); };
    row.querySelector('.kit')?.addEventListener('click', () => toMake('drums'));
    row.querySelector('.notes')?.addEventListener('click', () => toMake('bass'));
    box.append(row);
  }
}

/// Play a library-relative file as it is (not the document).
async function stPlay(p) {
  if (engine.playing) pausePlayback();
  if (!(await engineLoad({ path: p }, { raw: true }))) return;
  seekSource(0);
  startPlayback();
}

async function stPlayMix() {
  if (!ST.song) return;
  const anySolo = Object.values(ST.lanes).some((x) => x.solo);
  const gains = ST_STEMS.map((k) => {
    const l = ST.lanes[k];
    if (!l || l.mute || (anySolo && !l.solo)) return 0;
    return l.level;
  });
  $('stPlayMix').disabled = true;
  try {
    const r = await postJSON('/api/stems/mix', { p: ST.song.p, gains });
    // A new mix is a new file at the same path: forget the loaded one.
    engine.path = null;
    await stPlay(r.p);
  } catch (e) {
    toast(e.message);
  } finally {
    $('stPlayMix').disabled = false;
  }
}

// ------------------------------------------------------------ what's in it

function stFillWhat() {
  const a = ST.song?.analysis;
  const what = $('stWhat');
  what.classList.toggle('hidden', !a);
  if (!a) return;
  const tmap = a.tempo.map || [];
  const lo = tmap.length ? Math.min(...tmap.map((m) => m[1])) : a.tempo.bpm, hi = tmap.length ? Math.max(...tmap.map((m) => m[1])) : a.tempo.bpm;
  const fact = (k, v, sub) => `<div class="st-fact"><span>${k}</span><b>${stEsc(v)}</b><span>${stEsc(sub)}</span></div>`;
  $('stFacts').innerHTML =
    fact('TEMPO', a.tempo.bpm.toFixed(1), hi - lo < 1.5 ? 'steady' : `${lo.toFixed(0)}–${hi.toFixed(0)} over time`)
    + fact('KEY (ROUGH)', a.key.name.replace(' minor', ' min').replace(' major', ' maj'), `${a.key.regions.length} region${a.key.regions.length === 1 ? '' : 's'}`)
    + fact('SWING', `${Math.round(a.drums.swing_8th_pct)} %`, a.drums.swing_8th_pct > 53 ? 'swung' : 'straight')
    + fact('BARS · SECTIONS', `${a.bar_count} · ${a.sections.length}`, `median ${a.change.section_bars_median} bars`)
    + fact('DRUM BARS', a.drums.bar_families, 'families of bars')
    + fact('ENTER / LEAVE', a.change.entries_exits_per_minute, 'changes a minute');
  const fam = a.drums.common_bars?.[0];
  $('stFamCap').textContent = fam ? `The drums · the bar it plays most (${fam.bars} bars, from bar ${fam.first_bar})` : 'The drums';
  const row = (n, p) => `<span class="rl">${n}</span>` + [...(p || '................')].map((c) => `<i class="${c === '.' ? '' : c}"></i>`).join('');
  $('stFam').innerHTML = fam ? row('KICK', fam.kick) + row('SNARE', fam.snare) + row('HAT', fam.hat) : '';
  // The bass: the four bars with the most bass in them.
  const notes = a.bass.notes || [];
  const per = new Array(a.bar_count + 4).fill(0);
  for (const n of notes) per[n[0]] += n[2];
  let from = 0, best = -1;
  for (let b = 0; b < a.bar_count; b++) {
    const s = per[b] + per[b + 1] + per[b + 2] + per[b + 3];
    if (s > best) { best = s; from = b; }
  }
  ST.roll = notes.filter((n) => n[0] >= from && n[0] < from + 4);
  ST.rollFrom = from;
  $('stBassCap').textContent = `The bass · bars ${from + 1}–${from + 4}${a.bass.range ? ` · range ${a.bass.range}` : ''}`;
  const dur = a.duration_s;
  $('stSecs').innerHTML = a.sections.map((s) => {
    const k = s.label.charCodeAt(0) - 65;
    const w = (s.end_s - s.start_s) / dur * 100;
    return `<b style="left:${s.start_s / dur * 100}%;width:${w}%;background:${ST_SEC[k % ST_SEC.length]}" title="${s.label}: bars ${s.start_bar + 1}–${s.start_bar + s.bars}, ${stTime(s.start_s)}–${stTime(s.end_s)} · ${s.stems_on.join(' + ') || 'nothing'}">${w > 4 ? `${s.label} · ${s.bars}` : ''}</b>`;
  }).join('');
  stShowLearnt();
}

function stShowLearnt() {
  const learnt = !!ST.song?.learnt;
  $('stLearn').textContent = learnt ? 'Learnt · take it back' : 'Add this song';
  $('stLearn').classList.toggle('st-primary', !learnt);
  const n = ST.list.filter((s) => s.learnt).length;
  $('stLearnt').textContent = `${n} song${n === 1 ? '' : 's'} learnt`;
}

async function stLearn() {
  if (!ST.song) return;
  try {
    const r = await postJSON('/api/stems/learn', { p: ST.song.p, forget: !!ST.song.learnt });
    ST.song.learnt = r.learnt;
    const row = ST.list.find((s) => s.p === ST.song.p);
    if (row) row.learnt = r.learnt;
    stShowLearnt();
    toast(r.learnt ? `The Band can learn from ${ST.song.name} (${r.songs} song${r.songs === 1 ? '' : 's'})` : `Taken back: ${ST.song.name}`);
    stRefreshList();
  } catch (e) {
    toast(e.message);
  }
}

function stShowSummary() {
  const a = ST.song?.analysis;
  if (!a) return;
  const lines = [
    `${ST.song.name}: ${a.tempo.bpm.toFixed(1)} BPM, ${a.key.name}, ${a.bar_count} bars, ${a.sections.length} sections.`,
    `Key by 16-bar windows: ${a.key.regions.map((r) => `bar ${r[0] + 1} ${r[1]}`).join(', ')}.`,
    `Chords (rough): ${(a.chords.changes || []).slice(0, 16).map((c) => c[1] || '-').join(' → ')}.`,
    `Texture: hiss ${a.texture.hiss_floor_db} dB, width ${a.texture.width_mean}, smear ${a.texture.smear_mean}.`,
  ];
  toast(lines.join('\n'), 9000);
}

// ---------------------------------------------------------------- drawing

async function stPeaks(p, cols) {
  ST.peakCache = ST.peakCache || new Map();
  const key = `${p}|${cols}`;
  if (ST.peakCache.has(key)) return ST.peakCache.get(key);
  const r = await api(`/api/peaks?p=${encodeURIComponent(p)}&cols=${cols}`);
  const ch = r.channels || [];
  const n = r.columns || (ch[0]?.max.length ?? 0);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let m = 0;
    for (const c of ch) m = Math.max(m, Math.abs(c.max[i]), Math.abs(c.min[i]));
    out[i] = m;
  }
  ST.peakCache.set(key, out);
  return out;
}

async function stWave(canvas, p, col) {
  if (!canvas || !canvas.clientWidth) return;
  const r = devicePixelRatio || 1, w = canvas.clientWidth, h = canvas.clientHeight;
  let pk;
  try { pk = await stPeaks(p, Math.min(2000, Math.max(200, Math.round(w)))); } catch { return; }
  canvas.width = w * r; canvas.height = h * r;
  const g = canvas.getContext('2d');
  g.scale(r, r);
  g.fillStyle = stInk(col);
  const mid = h / 2;
  for (let x = 0; x < w; x++) {
    const v = pk[Math.floor(x / w * pk.length)] * (h / 2 - 2);
    g.fillRect(x, mid - v, 1, Math.max(1, v * 2));
  }
  const a = ST.song?.analysis;
  if (a && canvas.dataset.stem !== undefined || canvas.id === 'stMixWave') {
    g.fillStyle = 'rgba(255,255,255,.12)';
    for (const s of a?.sections || []) g.fillRect(s.start_s / a.duration_s * w, 0, 1, h);
  }
}

function stDrawRoll() {
  const c = $('stRoll');
  if (!c || !c.clientWidth || !ST.roll) return;
  const r = devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
  c.width = w * r; c.height = h * r;
  const g = c.getContext('2d');
  g.scale(r, r);
  const notes = ST.roll;
  if (!notes.length) return;
  const lo = Math.min(...notes.map((n) => n[3])) - 1, hi = Math.max(...notes.map((n) => n[3])) + 1;
  g.fillStyle = 'rgba(255,255,255,.06)';
  for (let b = 1; b < 4; b++) g.fillRect(b / 4 * w, 0, 1, h);
  g.fillStyle = stInk('var(--look-f-tone)');
  for (const n of notes) {
    const x = ((n[0] - ST.rollFrom) * 16 + n[1]) / 64 * w, len = n[2] / 64 * w;
    const y = h - 6 - (n[3] - lo) / Math.max(1, hi - lo) * (h - 12);
    g.globalAlpha = 0.4 + 0.6 * n[4];
    g.fillRect(x, y - 2, Math.max(2, len - 1), 4);
  }
  g.globalAlpha = 1;
}

function stDrawAll() {
  if (state.mode !== 'stems') return;
  if (ST.tab === 'split') {
    const src = ST.song?.meta?.source || ST.pending?.p;
    if (src) stWave($('stMixWave'), src, ST_COL.mix);
    for (const c of document.querySelectorAll('#stLanes canvas')) stWave(c, c.dataset.p, ST_COL[c.dataset.stem]);
    stDrawRoll();
  } else {
    for (const c of document.querySelectorAll('#stTries canvas')) stWave(c, c.dataset.p, c.dataset.col);
    if (ST.pick) stWave($('stAWave'), ST.pick.p, 'var(--look-text-3)');
    if (ST.made) stWave($('stBWave'), ST.made.p, ST.kind === 'bass' ? ST_COL.bass : ST_COL.drums);
  }
}

// ------------------------------------------------------------------ make

function stFillFrom() {
  const sel = $('stFrom');
  if (!sel) return;
  const keep = sel.value || ST.song?.p;
  sel.innerHTML = ST.list.map((s) => `<option value="${stEsc(s.p)}">${stEsc(s.name)}</option>`).join('') || '<option value="">Split a song first</option>';
  if (keep && ST.list.some((s) => s.p === keep)) sel.value = keep;
}

function stModel() {
  return ST_MODELS.find((x) => x.id === ST.model) || ST_MODELS[0];
}

/// Make's controls for where it starts: words, your sounds, or a song's stems.
function stKindShow() {
  if (!$('stMake')) return;
  // A guide sound needs Stable Audio Open Small.
  if (ST.start === 'sounds' && !stModel().guide) ST.model = 'sao';
  for (const el of $('stModels').querySelectorAll('.st-model')) {
    const m = ST_MODELS.find((x) => x.id === el.dataset.m);
    el.classList.toggle('on', m.id === ST.model);
    el.classList.toggle('off', !!m.off || (ST.start === 'sounds' && !m.guide));
  }
  for (const b of document.querySelectorAll('#stWordsBars .ui-bar')) b.sync?.();
  for (const el of document.querySelectorAll('#stMake .st-start')) el.classList.toggle('hidden', !el.classList.contains(`st-start-${ST.start}`));
  const model = ST.start !== 'stems';
  for (const a of document.querySelectorAll('#stAlgos .st-algo')) a.classList.toggle('on', a.dataset.k === ST.algo);
  for (const id of ['vary', 'blend', 'kit', 'loop', 'texture', 'mutate']) $(`st${id[0].toUpperCase()}${id.slice(1)}Ctl`).classList.toggle('hidden', ST.algo !== id);
  const local = ST.start === 'sounds' && ST_LOCAL.includes(ST.algo);
  $('stModels').classList.toggle('st-dim', !model || local);
  stFillLoopFrom();
  const need = ST.algo === 'blend' ? 2 : 1;
  $('stMakeGo').textContent = { words: 'Make them', sounds: { vary: `Make ${ST.vary.n}`, blend: `Blend in ${ST.blend.n}`, kit: `Make the kit · ${ST.kit.parts.size}`, loop: 'Make 4 loops', texture: `Make ${ST.texture.n}`, mutate: `Make ${ST.mutate.n}` }[ST.algo], stems: 'Find them' }[ST.start];
  $('stMakeGo').disabled = (model && !local && !ST.gpu) || (ST.start === 'sounds' && (ST.picks.length < need || (ST.algo === 'kit' && !ST.kit.parts.size)));
  if ($('stBlendAB')) $('stBlendAB').textContent = ST.picks.length >= 2 ? `A · ${ST.picks[0].name}  →  B · ${ST.picks[1].name}` : 'Blend needs two picks: A and B';
  $('stModelNote').textContent = !model ? 'No model: cut from your own stems.'
    : local && !ST.picks.length ? 'Pick a sound first: + pick a sound, from the library, or Pick it on a try below.'
    : local ? "No model: made here with MGL's own engines, in a second or two."
    : !ST.gpu ? 'The model runs on the GPU machine: set AUDIOLAB_GPU_HOST (see docs/STEMS.md).'
    : ST.start === 'sounds' && ST.picks.length < need ? (need === 2 ? 'Blend needs two picks.' : 'Pick a sound first: + pick a sound, from the library, or Pick it on a try below.')
    : `${stModel().name} on the ${ST.gpu}'s GPU · ${ST.model === 'sao' ? 'the first time it loads the model, up to a minute; then about a second a sound' : ST.model === 'tangoflux' ? 'about 15 s a sound, after loading' : 'its first use downloads about 10 GB; then about a minute a piece'}`;
  stRenderPicks();
}

/// The sounds picked to make around, A, B, C…
function stRenderPicks() {
  const box = $('stPicks');
  if (!box) return;
  box.innerHTML = ST.picks.map((p, i) => `<div class="st-pickc${i === ST.vary.of ? ' on' : ''}" data-i="${i}"><div class="st-row"><b class="st-nm">${String.fromCharCode(65 + i)} · ${stEsc(p.name)}</b><span class="st-grow"></span><button class="st-btn st-sm" data-play="${i}" title="Hear it">▶</button><button class="st-btn st-sm" data-x="${i}" title="Take it off">×</button></div><div class="st-well"><canvas data-p="${stEsc(p.p)}"></canvas></div></div>`).join('')
    + (ST.picks.length < 4 ? '<div class="st-pickc st-add" id="stAddPick">+ pick a sound<span>from the library, or Pick it on a try</span></div>' : '');
  for (const c of box.querySelectorAll('.st-pickc[data-i]')) c.onclick = (e) => {
    const i = +c.dataset.i;
    if (e.target.closest('[data-x]')) { ST.picks.splice(i, 1); ST.vary.of = Math.min(ST.vary.of, Math.max(0, ST.picks.length - 1)); stKindShow(); return; }
    if (e.target.closest('[data-play]')) { stPlay(ST.picks[i].p); return; }
    ST.vary.of = i; stRenderPicks();
  };
  $('stAddPick')?.addEventListener('click', () => { if (typeof openDrawer === 'function') openDrawer(); });
  $('stVaryOf').textContent = ST.picks.length ? String.fromCharCode(65 + ST.vary.of) : '–';
  $('stMutOf').textContent = $('stVaryOf').textContent;
  for (const c of box.querySelectorAll('canvas')) stWave(c, c.dataset.p, 'var(--look-f-pitch)');
}

function stAddPick(p, name) {
  if (ST.picks.some((x) => x.p === p)) return;
  ST.picks.push({ p, name });
  if (ST.picks.length > 4) ST.picks.shift();
  ST.vary.of = ST.picks.length - 1;
  stKindShow();
}

/// Run one of the ways on the GPU machine and show what came back.
async function stMakeOn(what, url, body, done) {
  $('stMakeGo').disabled = true;
  $('stTriesMeta').textContent = `${what} on the ${ST.gpu}…`;
  const t0 = performance.now();
  try {
    const r = await postJSON(url, body);
    ST.tries = Array.isArray(r) ? r : r.tries;
    $('stTriesMeta').textContent = `${done(r)} in ${((performance.now() - t0) / 1000).toFixed(1)} s · click to hear · Pick it to make around it`;
  } catch (e) {
    toast(e.message);
    ST.tries = [];
    $('stTriesMeta').textContent = 'none made';
  } finally {
    stKindShow();
  }
  ST.pick = null;
  ST.made = null;
  ST.peakCache?.clear();
  stShowTries(true);
}

function stMakeBlend() {
  const [a, b] = ST.picks;
  return stMakeOn(`blending ${a.name} into ${b.name}`, '/api/stems/blend', { a: a.p, b: b.p, n: ST.blend.n, wander: ST.blend.wander, prompt: $('stBlendWords').value.trim() }, (r) => `${r.length} steps from ${a.name} to ${b.name}`);
}

function stMakeKit() {
  return stMakeOn(`making a kit around ${ST.picks.map((x) => x.name).join(' and ')}`, '/api/stems/kit', { picks: ST.picks.map((x) => x.p), parts: [...ST.kit.parts], style: $('stKitStyle').value.trim() }, (r) => {
    $('stKitHeard').textContent = `heard: key ${r.key} · ${r.words}`;
    return `${r.tries.length} parts in ${r.key}`;
  });
}

/// The ways made here (no GPU machine): Loop around, Texture from, Mutate.
async function stMakeHere(what, url, body, done) {
  $('stMakeGo').disabled = true;
  $('stTriesMeta').textContent = `${what}…`;
  const t0 = performance.now();
  try {
    ST.tries = await postJSON(url, body);
    $('stTriesMeta').textContent = `${done(ST.tries)} in ${((performance.now() - t0) / 1000).toFixed(1)} s · click to hear · Pick it to make around it`;
  } catch (e) {
    toast(e.message);
    ST.tries = [];
    $('stTriesMeta').textContent = 'none made';
  } finally {
    stKindShow();
  }
  ST.pick = null;
  ST.made = null;
  ST.peakCache?.clear();
  stShowTries(true);
}

function stFillLoopFrom() {
  const sel = $('stLoopFrom');
  if (!sel) return;
  const keep = sel.value || ST.loop.from;
  const learnt = ST.list.filter((s) => s.analysed !== false);
  sel.innerHTML = '<option value="all">all your songs</option>' + learnt.map((s) => `<option value="${stEsc(s.p)}">${stEsc(s.name)}</option>`).join('') + '<option value="">stock bars</option>';
  sel.value = [...sel.options].some((o) => o.value === keep) ? keep : 'all';
  sel.onchange = () => { ST.loop.from = sel.value; };
}

function stMakeLoop() {
  const L = ST.loop;
  return stMakeHere(`making loops of ${ST.picks.map((x) => x.name).join(', ')}`, '/api/stems/loop', { picks: ST.picks.map((x) => x.p), from: $('stLoopFrom').value, bpm: L.bpm || undefined, bars: L.bars, busy: L.busy, fills: L.fills, n: 4 }, (r) => `${r.length} loops${r[0] ? ` at ${Math.round(r[0].bpm)} BPM` : ''}`);
}

function stMakeTexture() {
  const T = ST.texture;
  return stMakeHere(`making ${T.n} textures with Grain`, '/api/stems/texture', { picks: ST.picks.map((x) => x.p), shape: T.shape, n: T.n, seconds: T.seconds, stretch: T.stretch, density: T.density, space: T.space }, (r) => `${r.length} textures`);
}

function stMakeMutate() {
  const pick = ST.picks[ST.vary.of];
  if (!pick) return;
  const M = ST.mutate;
  return stMakeHere(`mutating ${pick.name}`, '/api/stems/mutate', { p: pick.p, n: M.n, far: M.far, through: M.through, peakDb: M.peak }, (r) => `${r.length} mutations of ${pick.name}`);
}

async function stMakeVary() {
  const pick = ST.picks[ST.vary.of];
  if (!pick) return;
  $('stMakeGo').disabled = true;
  $('stTriesMeta').textContent = `making ${ST.vary.n} variations of ${pick.name} on the ${ST.gpu}…`;
  const t0 = performance.now();
  try {
    ST.tries = await postJSON('/api/stems/vary', { p: pick.p, n: ST.vary.n, nearFar: ST.vary.nearFar, prompt: $('stVaryWords').value.trim() });
    $('stTriesMeta').textContent = `${ST.tries.length} variations of ${pick.name} in ${((performance.now() - t0) / 1000).toFixed(1)} s · close to far · click to hear, Pick it to make around it`;
  } catch (e) {
    toast(e.message);
    ST.tries = [];
    $('stTriesMeta').textContent = 'none made';
  } finally {
    stKindShow();
  }
  ST.pick = null;
  ST.made = null;
  ST.peakCache?.clear();
  stShowTries(true);
}

async function stFindTries() {
  if (ST.start === 'words') return stMakeWords();
  if (ST.start === 'sounds') return ({ blend: stMakeBlend, kit: stMakeKit, loop: stMakeLoop, texture: stMakeTexture, mutate: stMakeMutate }[ST.algo] || stMakeVary)();
  const p = $('stFrom').value;
  if (!p) { toast('Split a song first'); return; }
  $('stMakeGo').disabled = true;
  $('stTriesMeta').textContent = 'cutting…';
  try {
    ST.tries = await postJSON('/api/stems/tries', { p, kind: ST.kind, per: 4 });
  } catch (e) {
    toast(e.message);
    ST.tries = [];
  } finally {
    $('stMakeGo').disabled = false;
  }
  ST.pick = null;
  ST.made = null;
  ST.peakCache?.clear();
  stShowTries();
}

async function stMakeWords() {
  const prompt = $('stPrompt').value.trim();
  if (!prompt) { toast('Say what to make'); $('stPrompt').focus(); return; }
  $('stMakeGo').disabled = true;
  $('stTriesMeta').textContent = `making on the ${ST.gpu}…`;
  const t0 = performance.now();
  try {
    ST.tries = await postJSON('/api/stems/words', { prompt, seconds: ST.words.seconds, n: ST.words.n, model: ST.model });
    $('stTriesMeta').textContent = `${ST.tries.length} made in ${((performance.now() - t0) / 1000).toFixed(1)} s · click one to hear it and choose it`;
  } catch (e) {
    toast(e.message);
    ST.tries = [];
    $('stTriesMeta').textContent = 'none made';
  } finally {
    $('stMakeGo').disabled = false;
  }
  ST.pick = null;
  ST.made = null;
  ST.peakCache?.clear();
  stShowTries(true);
}

function stShowTries(keepMeta) {
  const col = (t) => (t.group === 'loop' ? ST_COL.drums : t.group === 'texture' ? 'var(--look-f-space)' : t.group === 'mutate' ? 'var(--look-f-level)' : t.group === 'kit' ? (t.note != null ? 'var(--look-f-tone)' : 'var(--look-f-time)') : t.group === 'blend' ? 'var(--look-f-space)' : t.group === 'words' || t.group === 'vary' ? 'var(--look-f-pitch)' : t.group === 'kick' || t.group === 'snare' || t.group === 'hat' ? ST_COL.drums : ST_COL.bass);
  if (!keepMeta) $('stTriesMeta').textContent = ST.tries.length ? `${ST.tries.length} found · click one to hear it and choose it` : 'none found';
  $('stTries').innerHTML = ST.tries.map((t, i) => `<div class="st-try" data-i="${i}"><div class="st-row"><b class="st-nm" style="font-size:var(--fs-s)">${stEsc(t.label)}</b><span class="st-grow"></span><span class="st-meta">${t.seconds.toFixed(2)} s</span><button class="st-btn st-sm st-pickit" title="Add it to the sounds to make around">Pick it</button></div><div class="st-well"><canvas data-p="${stEsc(t.p)}" data-col="${col(t)}"></canvas></div></div>`).join('');
  for (const el of document.querySelectorAll('#stTries .st-try')) {
    el.onclick = (e) => {
      if (e.target.closest('.st-pickit')) {
        const t = ST.tries[+el.dataset.i];
        ST.start = 'sounds';
        $('stStart').querySelectorAll('[role="radio"]').forEach((r) => r.classList.toggle('on', r.dataset.k === 'sounds'));
        stAddPick(t.p, t.label.split(' · ')[0] + (t.group === 'vary' ? ` ${t.nearFar.toFixed(2)}` : ''));
        return;
      }
      const t = ST.tries[+el.dataset.i];
      ST.pick = t;
      ST.made = null;
      for (const o of document.querySelectorAll('#stTries .st-try')) o.classList.toggle('sel', o === el);
      $('stName').value = ST_LOCAL.includes(t.group) ? t.label.split(' · ').slice(0, 2).join(' ').slice(0, 48) : t.group === 'vary' ? t.label.replace(' · ', ' ').slice(0, 48) : t.group === 'words' ? $('stPrompt').value.trim().split(/[,.]/)[0].slice(0, 48) : `${ST.song?.name || 'sound'} ${t.group}`.trim();
      $('stKeep').disabled = false;
      $('stHearB').disabled = true;
      $('stSaved').textContent = '';
      $('stBCap').textContent = 'Saved';
      for (const b of ['stOpenGrain', 'stOpenPrism', 'stOpenEdit']) $(b).disabled = true;
      const bw = $('stBWave');
      bw.getContext('2d').clearRect(0, 0, bw.width, bw.height);
      stPlay(t.p);
      stDrawAll();
    };
  }
  afterLayout(stDrawAll);
}

async function stKeep() {
  if (!ST.pick) return;
  const c = ST.chain;
  const body = {
    p: ST.pick.p,
    folder: ST.pick.group === 'loop' ? 'Loops' : ST.pick.group === 'texture' ? 'Textures' : ST.pick.group === 'mutate' ? 'Mutations' : ST.pick.group === 'words' ? 'Words' : ST.pick.group === 'vary' ? 'Variations' : ST.pick.group === 'blend' ? 'Blends' : ST.pick.group === 'kit' ? 'Kits' : ST.kind === 'bass' ? 'Bass' : 'Drums',
    name: $('stName').value || ST.pick.group,
    rate: c.up ? c.rate : 0,
    air: c.up ? c.air : 0,
    above: c.above,
    // A loop keeps its length exactly, so it still loops.
    trimDb: c.clean && ST.pick.group !== 'loop' ? c.trim : -120,
    fadeOutMs: c.clean && ST.pick.group !== 'loop' ? c.fade : 0,
    peakDb: c.peak,
    whole: ST.pick.group === 'loop',
  };
  $('stKeep').disabled = true;
  try {
    ST.made = await postJSON('/api/stems/keep', body);
    $('stSaved').textContent = `Saved: ${ST.made.p}`;
    $('stBCap').textContent = `Saved · ${(ST.made.rate / 1000).toFixed(1)} kHz · ${ST.made.seconds.toFixed(2)} s`;
    $('stHearB').disabled = false;
    for (const b of ['stOpenGrain', 'stOpenPrism', 'stOpenEdit']) $(b).disabled = false;
    if (typeof refreshLibrary === 'function') refreshLibrary();
    stDrawAll();
    stPlay(ST.made.p);
  } catch (e) {
    toast(e.message);
  } finally {
    $('stKeep').disabled = false;
  }
}

window.addEventListener('resize', () => { if (state.mode === 'stems') afterLayout(stDrawAll); });

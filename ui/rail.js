// The left rail. See `docs/RAIL.md`.
//
// ─────────────────────────────────────────────────────────────────────────────
// PORTED FROM THE EDGE BUILD, 5 Sep 2026. Source: `audiolab-edge/ui/port/rail.js`.
//
// Its own header gave four steps and said none of them touch `app.js`. That
// held — `app.js` is untouched — but four steps was three short for this build:
//
//   5. `core/crates/server/src/routes.rs` needs an `include_str!` constant AND
//      a route for each new file, or the binary serves a 404 and the rail
//      silently never appears. The interface is embedded, not read from disk.
//   6. both files go in `ui_build_id()`, or an already-open window has no way
//      to know it is stale.
//   7. `EDGE_HAS_DISK` becomes true, and Record becomes a pane rather than a
//      modal — see both notes below.
// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
//
// **This file does not modify `app.js`.** It reaches into the rail in exactly
// three ways, and this file emits markup that answers all three — which is what
// lets the rail be replaced without touching the interface that drives it.
// (`app.js` itself has since been edited for other reasons, 206 lines of rail
// wiring and tag removal; the point here is that *this* file needs none of it.)
//
//   `#leftRail .mode-btn` + `dataset.mode`    `setMode` toggles `.active`
//   `#leftRail .rail-btn` + `dataset.panel`   `showPane` toggles `.active`,
//                                             and `app.js` attaches the onclick
//   `#leftRail [data-panel="…"]`              hidden while editing
//
// So every button below carries the class and the data attribute the app
// already looks for, *as well as* the rail's own. The old markup's behaviour is
// unchanged; only its arrangement and its clothes are new.

/// **Compose is unlisted** (15 Sep 2026), at the owner's direction: its compact
/// panels left too few controls in reach to perform with. Taken out of the rail,
/// and its Composition button out of the export dialog — not deleted. `ui/compose.js`,
/// its server routes, its tests and its docs are kept exactly as they were, and
/// `true` here puts both back. Read by `compose.js` too, which loads after this.
const COMPOSE_LISTED = false;

(() => {
  /// Open or closed, remembered. A rail you have to re-open every time is one
  /// you leave open, and then it is not a collapsible rail.
  const STORE = 'audiolab.rail.open';

  /// The four destinations.
  ///
  /// **One kind of thing.** The rail used to answer two questions at once —
  /// which workspace am I in, and which panel of the library is open — with
  /// three kinds of button at two sizes. These four are all the same question:
  /// where am I.
  ///
  /// `mode` and `panel` are what `app.js` already understands. Grain, Visual
  /// and Browse are workspaces; Theme opens a panel, which is why it carries a
  /// `panel` instead — the difference is real and it is the app's, not the
  /// rail's.
  const ITEMS = [
    // Edit and Grain are two pages of one mode, `edit`: the same open sound,
    // with the edit toolbar or with the granular dock. `page` says which.
    {
      icon: 'edit', label: 'Edit', mode: 'edit', page: 'wave',
      title: 'Editing only — cut, copy, paste, fades and every edit command as icons',
    },
    {
      icon: 'grain', label: 'Grain', mode: 'edit', page: 'grain',
      title: 'The granular engine — the sound you are working on',
    },
    {
      icon: 'chop', label: 'Chop', mode: 'edit', page: 'chop',
      title: 'Chop — cut the sound at its silences into slices, after Recycle Reborn',
    },
    {
      icon: 'visual', label: 'Visual', mode: 'room',
      title: 'The room, full size, and everything that draws it',
    },
    {
      icon: 'compose', label: 'Compose', mode: 'compose',
      title: 'The whole piece at once — grain, sequencer and picture over one timeline',
    },
    {
      icon: 'seq', label: 'Seq', mode: 'seq',
      title: 'The scale sequencer — a second voice, run from the same transport',
    },
    {
      icon: 'theme', label: 'Theme', panel: 'theme',
      title: 'Palette and colours',
    },
    {
      icon: 'browse', label: 'Browse', mode: 'overview', children: 'library',
      title: 'Every sound, and everything to do with the library',
    },
  ];

  /// What lives under Browse.
  ///
  /// These are the library's own parts and they were never workspaces: you do
  /// not *go* to Scan, you scan the library. Indented under the thing they
  /// belong to, and only visible when you are there.
  ///
  /// `scan` and `import` need a disk. They are listed here because this is the
  /// rail's shape; whether a build shows them is decided by `HAS_DISK` below.
  const LIBRARY = [
    { icon: '≡', label: 'All sounds', panel: 'browse' },
    { icon: '⌕', label: 'Search', panel: 'search' },
    { icon: '◴', label: 'Scan', panel: 'scan', disk: true },
    { icon: '⌂', label: 'Folder', panel: 'import', disk: true },
    // Not a pane: the map takes the whole window, so it is opened rather
    // than shown in the left panel. See `ui/sound-map.js`.
    { icon: '◍', label: 'Map', action: () => window.SoundMap && window.SoundMap.open() },
  ];

  /// **There is no disk in a browser.** Scanning a library, choosing its folder
  /// and recording into it all need one. The edge build sets this false and
  /// gets two; this is the desktop, so it gets all four.
  ///
  /// The flag was left in rather than deleted precisely so this port was a
  /// one-line change, which it was.
  const HAS_DISK = true;

  /// **The rail owns `--rail`.**
  ///
  /// `app.css` positions three other things off that variable — the drawer at
  /// `left: var(--rail)`, its closed transform, and the docked left panel — so
  /// a rail that changes width without telling anyone leaves the panel sitting
  /// underneath it. Setting the variable is how the rail says how wide it is,
  /// and everything anchored to it follows without a single one of those rules
  /// having to know this file exists.
  const width = (open) => {
    const px = getComputedStyle(document.documentElement)
      .getPropertyValue(open ? '--rail-open' : '--rail-icon').trim();
    document.documentElement.style.setProperty('--rail', px);
  };

  const el = (tag, cls, ...kids) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    for (const k of kids) n.append(k);
    return n;
  };

  /// The four destinations, drawn rather than spelled.
  ///
  /// They were abstract glyphs — ◉ ◈ ◑ ▤ — which say nothing about where they
  /// go. These say it: a cloud of grains, the Ridgeline pulse in its frame, a
  /// painter's palette, a folder.
  ///
  /// Inline SVG rather than a font or a sprite, because it is four shapes and
  /// they inherit `currentColor` — the accent when a destination is lit, the
  /// dim text when it is not, without a second rule anywhere. The library's own
  /// sub-items keep their glyphs; they are smaller and they are not
  /// destinations.
  const SVGS = {
    // A record button is a filled circle. Nothing else, because anything else
    // is not a record button.
    record:
      '<circle cx="12" cy="12" r="6.5" fill="currentColor" stroke="none"/>',
    // A waveform and the edit cursor through it.
    edit:
      '<path d="M3 12h1.8l1.6-5.5 2.2 11 2-7.5 1.6 4.5H14"/><path d="M17.5 4v16M15.5 4h4M15.5 20h4"/>',
    // Scissors, the Chop tab's own ✂, drawn.
    chop:
      '<circle cx="6.5" cy="6.5" r="2.6"/><circle cx="6.5" cy="17.5" r="2.6"/><path d="M8.6 8.1 20 17.2M8.6 15.9 20 6.8"/>',
    grain:
      '<path d="M7.6 18.5h9.2a3.4 3.4 0 0 0 .35-6.78 5.35 5.35 0 0 0-10.03-2.3 4.1 4.1 0 0 0 .48 9.08z"/><circle cx="9.6" cy="13.4" r=".85" fill="currentColor" stroke="none"/><circle cx="13" cy="11.9" r=".85" fill="currentColor" stroke="none"/><circle cx="15.4" cy="14.6" r=".85" fill="currentColor" stroke="none"/><circle cx="11.7" cy="15.6" r=".85" fill="currentColor" stroke="none"/>',
    visual:
      '<rect x="3.5" y="3.5" width="17" height="17" rx="1.6"/><path d="M5.5 7.2 Q12 5.4 18.5 7.2"/><path d="M5.5 9.4 Q12 5.8 18.5 9.4"/><path d="M5.5 11.6 Q12 6.2 18.5 11.6"/><path d="M5.5 13.8 Q12 8.4 18.5 13.8"/><path d="M5.5 16.0 Q12 12.4 18.5 16.0"/><path d="M5.5 18.2 Q12 16.4 18.5 18.2"/>',
    // Four steps of a sequence, at four heights.
    seq:
      '<rect x="3.5" y="12.5" width="3.4" height="8"/><rect x="8.7" y="7.5" width="3.4" height="13"/><rect x="13.9" y="10" width="3.4" height="10.5"/><rect x="19.1" y="4" width="3.4" height="16.5"/>',
    compose:
      '<rect x="3.5" y="4" width="4.6" height="7" rx=".8"/><rect x="9.7" y="4" width="4.6" height="7" rx=".8"/><rect x="15.9" y="4" width="4.6" height="7" rx=".8"/><path d="M3.5 14.5h17"/><path d="M3.5 17.5h11"/><path d="M3.5 20.5h14"/>',
    theme:
      '<path d="M12 3.6c-4.8 0-8.6 3.5-8.6 7.8s3.8 7.8 8.6 7.8c1 0 1.75-.8 1.75-1.75 0-.45-.18-.86-.46-1.16-.28-.3-.46-.7-.46-1.15 0-.96.78-1.74 1.74-1.74h2.05 c2.85 0 5.16-2.3 5.16-5.15 0-2.9-4.2-4.65-9.82-4.65z"/><circle cx="7.6" cy="10.6" r="1.15" fill="currentColor" stroke="none"/><circle cx="10.4" cy="7.3" r="1.15" fill="currentColor" stroke="none"/><circle cx="14.6" cy="7.1" r="1.15" fill="currentColor" stroke="none"/><circle cx="17.6" cy="9.6" r="1.15" fill="currentColor" stroke="none"/>',
    browse:
      '<path d="M3.4 7.3A1.6 1.6 0 0 1 5 5.7h3.9a1.6 1.6 0 0 1 1.28.64l1.06 1.42 h7.76A1.6 1.6 0 0 1 20.6 9.36v8.34A1.6 1.6 0 0 1 19 19.3H5 a1.6 1.6 0 0 1-1.6-1.6z"/>'
  };

  const icon = (glyph) => {
    const s = el('span', 'rl-ic');
    if (SVGS[glyph]) {
      s.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
        'stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" ' +
        'aria-hidden="true">' + SVGS[glyph] + '</svg>';
    } else {
      s.textContent = glyph;
    }
    return s;
  };

  const label = (text) => {
    const s = el('span', 'rl-lb');
    s.textContent = text;
    return s;
  };

  function build() {
    const rail = document.getElementById('leftRail');
    if (!rail) return;
    rail.className = 'rail rl';
    rail.replaceChildren();

    // **Open on a fresh profile, not closed.** The library's own parts — Search,
    // Scan, Folder — are only drawn when the rail is open, so a rail that starts
    // collapsed starts with four of its ten controls invisible and no hint that
    // they exist. Once somebody collapses it that is remembered; the default is
    // the only thing being decided here.
    let open = true;
    try {
      const saved = localStorage.getItem(STORE);
      if (saved !== null) open = saved === '1';
    } catch { /* blocked */ }
    rail.classList.toggle('open', open);
    width(open);

    for (const item of ITEMS) {
      if (item.mode === 'compose' && !COMPOSE_LISTED) continue;
      // The classes and data attributes `app.js` looks for. A workspace is a
      // `.mode-btn`; a panel is a `.rail-btn`. Both also carry `.rl-item`,
      // which is what this file's stylesheet dresses.
      const b = el('button', item.mode ? 'rl-item mode-btn' : 'rl-item rail-btn');
      if (item.mode) b.dataset.mode = item.mode;
      if (item.page) b.dataset.page = item.page;
      if (item.panel) b.dataset.panel = item.panel;
      b.title = item.title;
      b.append(icon(item.icon), label(item.label));
      rail.append(b);

      if (item.children !== 'library') continue;

      // Browse's own parts, indented beneath it.
      const sub = el('div', 'rl-sub');
      sub.dataset.for = item.mode;
      for (const child of LIBRARY) {
        if (child.disk && !HAS_DISK) continue;
        // `.rail-btn` again, because these are the same panel buttons the app
        // has always had — moved, not rewritten. `app.js` attaches their
        // click handlers itself.
        if (child.action) {
          const a = el('button', 'rl-child');
          a.type = 'button';
          a.title = child.label;
          a.onclick = child.action;
          a.append(icon(child.icon), label(child.label));
          sub.append(a);
          continue;
        }
        const c = el('button', 'rl-child rail-btn');
        c.dataset.panel = child.panel;
        c.title = child.label;
        c.append(icon(child.icon), label(child.label));
        sub.append(c);
      }
      rail.append(sub);
    }

    // ── record ──────────────────────────────────────────────────────────
    //
    // **Not one of the four, and not hidden under Browse.**
    //
    // It was a child of Browse, which meant it only existed while Browse was
    // lit — invisible from Grain, which is where you land and where you would
    // want it. And the only record-looking control on screen was the
    // transport's `#recBtn`, which captures *what is playing* rather than the
    // microphone, in the same grey as everything else. Two record buttons,
    // neither findable, and nothing red.
    //
    // So it sits on its own, under a rule, below the four destinations. It is
    // an action rather than a place — it opens a window and gives it back —
    // and the separation says so. Red, because a record button is red.
    //
    // **A pane here, not a modal.** The edge build opens a record window; this
    // build has always had `#paneRecord` in the left panel, and it must stay
    // that way for a reason that is not cosmetic: `showPane` calls
    // `recordPanelShown(name === 'record')`, which is what opens the input
    // device and starts polling it for levels — and, more to the point, what
    // *stops* polling when you leave. Opening the pane by hand and skipping
    // `showPane` would leave a microphone open that nothing ever closes.
    //
    // So it carries `data-panel="record"` like every other pane button, and
    // goes through the same `go()` path as the rest. It keeps its own row and
    // its own red because it is still an action rather than a destination.
    const recRow = el('div', 'rl-actions');
    const recBtn = el('button', 'rl-item rl-rec rail-btn');
    recBtn.type = 'button';
    recBtn.id = 'railRecord';
    recBtn.dataset.panel = 'record';
    recBtn.title = 'Record from the microphone';
    recBtn.append(icon('record'), label('Record'));
    recRow.append(recBtn);
    rail.append(recRow);

    rail.append(el('div', 'rl-spacer'));

    // The handle. At the bottom and under a rule, because it is the one control
    // here that changes the rail rather than the app.
    const toggle = el('button', 'rl-toggle');
    toggle.type = 'button';
    toggle.title = 'Show or hide the labels';
    toggle.setAttribute('aria-expanded', String(open));
    toggle.append(icon('›'), label('Collapse'));
    toggle.onclick = () => {
      const now = rail.classList.toggle('open');
      width(now);
      toggle.setAttribute('aria-expanded', String(now));
      try { localStorage.setItem(STORE, now ? '1' : '0'); } catch { /* blocked */ }
    };
    rail.append(toggle);

    // ── which one is lit, and what a second click does ──────────────────────
    //
    // **`.active` cannot be the highlight, and this is why.** `app.js` toggles
    // it on `.mode-btn` from `setMode`, and on `.rail-btn` from `showPane` —
    // two independent sets. Theme is a panel and Browse is a mode, so opening
    // Theme lit Theme *and left Browse lit*, which is the rail saying you are
    // in two places at once.
    //
    // So the rail keeps its own mark, `.rl-on`, and there is exactly one. The
    // app's `.active` is left alone; it is still true, it just is not the
    // question this column is answering.
    // The four destinations. Record carries `.rl-item` for its shape and its
    // spacing, but it is an action — it never lights, and `current()` must
    // never land on it.
    const items = () => [...rail.querySelectorAll('.rl-item:not(.rl-rec)')];

    /// **Where you are, worked out — not remembered.**
    ///
    /// The first version lit whatever was last clicked and lit `overview` at
    /// startup. `first-sound.js` then moved the app to Grain without clicking
    /// anything, so the rail said Browse while the app was in Grain — and the
    /// second-click check trusted that, decided Browse was already current, and
    /// swallowed the click.
    ///
    /// Theme is checked first because it is a pane rather than a mode. That is
    /// only safe because leaving Theme now genuinely closes it — see `go()`.
    /// While it did not, the light stuck on Theme for ever: you could click
    /// Browse, land in `overview`, and the rail still said Theme because the
    /// pane was still open behind it.
    const current = () => {
      const theme = document.getElementById('paneTheme');
      const panel = document.getElementById('leftPanel');
      const themeShown = theme && !theme.classList.contains('hidden') &&
        panel && !panel.classList.contains('collapsed') &&
        !panel.classList.contains('drawer-closed');
      if (themeShown) return rail.querySelector('.rl-item[data-panel="theme"]');
      // Record is an action and never lights — but a second click on it still
      // has to shut the pane it opened, so `whereFor` answers for it even
      // though `current()`, which drives the light, does not.
      const mode = (typeof state !== 'undefined' && state.mode) || 'overview';
      if (mode === 'edit') {
        const page = document.body.classList.contains('wavepage') ? 'wave'
          : document.body.classList.contains('choppage') ? 'chop' : 'grain';
        return rail.querySelector(`.rl-item[data-mode="edit"][data-page="${page}"]`);
      }
      return rail.querySelector(`.rl-item[data-mode="${mode}"]`);
    };

    const sync = () => {
      const now = current();
      items().forEach((b) => b.classList.toggle('rl-on', b === now));
    };

    // ── the tray each destination owns ──────────────────────────────────────
    //
    // **All four behave the same.** Every destination has its own controls and
    // they are already in the page — they were simply never wired to the rail:
    //
    //   Grain   `#dock`        the stretch, splice, scan and shape controls
    //   Visual  `.room-edit`   the room editor — layers, streams, colour
    //   Theme   `#leftPanel`   showing `paneTheme`
    //   Browse  `#leftPanel`   showing `paneBrowse`, and the only place sound
    //                          files appear
    //
    // The left panel opens and shuts by class; the dock and the room editor by
    // `.hidden`. Two mechanisms, so this says which one a destination uses
    // rather than assuming.
    const tray = (item) => {
      if (item.dataset.panel || item.dataset.mode === 'overview') {
        return document.getElementById('leftPanel');
      }
      if (item.dataset.mode === 'edit') return document.getElementById('dock');
      // Whichever editor the current visual owns — Room, Ridgeline and the rest
      // each have their own, and `setMode` decides which.
      return document.querySelector('.room-edit:not(.hidden)') ||
             document.getElementById('roomEdit');
    };

    const trayOpen = (item) => {
      const t = tray(item);
      if (!t) return false;
      if (t.id === 'leftPanel') {
        return !(t.classList.contains('collapsed') || t.classList.contains('drawer-closed'));
      }
      return !t.classList.contains('hidden');
    };

    /// **The rail shuts the left panel and nothing else.**
    ///
    /// It used to hide whatever a destination's tray resolved to, which meant
    /// reaching into `#dock` and `.room-edit`. Neither is this file's to touch:
    /// `setMode` is the only place `#dock` is ever un-hidden, and the
    /// `.room-edit` nodes are moved into the room's admin column by `roomAdopt`
    /// with `setVisModule` deciding which one shows. Hiding either left it
    /// hidden with nothing to put it back.
    ///
    /// A workspace's furniture belongs to `setMode`, which the rail calls and
    /// then leaves alone. Only the drawer is the rail's.
    const shutTray = (item) => {
      const t = tray(item);
      if (!t || t.id !== 'leftPanel') return;
      closeDrawer();
    };

    /// The mirror of `shutTray`: the drawer is opened here, and a workspace's
    /// own furniture is left to `setMode`, which has already run by this point.
    const openTray = (item) => {
      const t = tray(item);
      if (!t || t.id !== 'leftPanel') return;
      openDrawer();
    };

    // ── going somewhere ─────────────────────────────────────────────────────
    //
    // **The button you press is the space you get, and nothing else comes with
    // it.** This file used to do half the job — let `app.js` change the mode,
    // then force the drawer open on top of wherever you landed. Two faults
    // followed and both were reported as "the nav doesn't work":
    //
    //   * Visual put you in the Room and opened the *file list* over it in a
    //     330px drawer, because the drawer still held whatever pane was last
    //     shown. The room is the entire point of that button.
    //   * Grain and Browse never closed the Theme editor, because `setMode`
    //     has no opinion about panes. You left Theme and Theme stayed.
    //
    // So the rail does the whole transition: which mode, which pane, and which
    // tray is on screen. Every other destination's tray is shut by the same
    // act, so there is nowhere for the previous space to survive.
    const go = (item) => {
      const mode = item.dataset.mode;
      const pane = item.dataset.panel;

      // `app.js`'s own guard, kept: Grain with nothing open has nothing to
      // show, and it says so rather than arriving empty.
      if (mode === 'edit' && !state.selectedFile && !state.tabs.length) {
        toast('Open a sound first — double-click one in the library');
        return false;
      }

      // **Only a workspace shuts the other workspaces' trays.**
      //
      // This used to run for every destination, and Theme is a pane rather than
      // a mode — so opening the palette while in Grain added `.hidden` to
      // `#dock` and took the whole granular rack off screen. Nothing put it
      // back either, because `#dock` is un-hidden in exactly one place,
      // `setMode`, which a pane destination never calls.
      //
      // The same act was reaching into `.room-edit`, which is not this file's
      // to touch: those nodes are moved into the room's admin column by
      // `roomAdopt` and `setVisModule` decides which of them is showing.
      //
      // A pane lives in the left panel, and `showPane` already swaps whatever
      // was in there. It has no business closing the workspace behind it.
      if (mode) items().forEach((b) => { if (b !== item) shutTray(b); });

      if (pane === 'theme' || pane === 'record') {
        // A pane rather than a workspace. Record additionally needs the library
        // to be the workspace it lives in — arriving from the room and opening
        // a 330px drawer over it is the fault this rail exists to stop.
        if (pane === 'record' && state.mode !== 'overview') setMode('overview');
        showPane('left', pane);
      } else {
        if (item.dataset.page) setEditPage(item.dataset.page, false);
        setMode(mode);
        // **Reset the pane on every mode, not only on Browse.**
        //
        // The edge build reset it for `overview` alone, so that the panel could
        // not come back holding Theme and so sound files stayed in Browse. That
        // is not sufficient here, because this build's Record is a pane rather
        // than a modal: leaving it for the Room never called `showPane`, so
        // `recordPanelShown(false)` never ran and the input device stayed open
        // and polling behind a shut drawer. Measured, not reasoned about.
        //
        // Safe for the shut modes: `showPane` clears `collapsed` and never
        // `drawer-closed`, so the drawer Edit and Visual arrive with stays shut.
        showPane('left', 'browse');
      }
      openTray(item);
      return true;
    };

    // Capture, and stop there. `app.js` binds its own `onclick` to these same
    // buttons — `setMode` on `.mode-btn`, `showPane` on `.rail-btn` — and each
    // knows about half the transition. Letting them also run is what produced a
    // Room with the file list over it.
    rail.addEventListener('click', (e) => {
      const item = e.target.closest('.rl-item');
      if (!item || !rail.contains(item)) return;
      e.stopPropagation();
      e.preventDefault();

      // **Once to open, once to close.** Clicking the space you are already in
      // shuts its tray. Clicking a different one goes there, and the previous
      // tray is gone in the same act — which is why a swap looks instant while
      // opening from nothing slides.
      // Once to open, once to close. Record is included by asking whether *its*
      // pane is the one showing, rather than by asking `current()` — which
      // deliberately never returns it, because it never lights.
      const recPane = document.getElementById('paneRecord');
      const isOpenRecord = item.classList.contains('rl-rec')
        && recPane && !recPane.classList.contains('hidden') && trayOpen(item);
      if (isOpenRecord || (item === current() && trayOpen(item))) {
        shutTray(item);
        sync();
        return;
      }
      if (go(item)) sync();
    }, true);

    // Browse's children follow Browse.
    const follow = () => {
      const browse = rail.querySelector('.rl-item[data-mode="overview"]');
      const sub = rail.querySelector('.rl-sub');
      if (browse && sub) sub.classList.toggle('shown', browse.classList.contains('rl-on'));
    };
    new MutationObserver(follow).observe(rail, {
      subtree: true, attributes: true, attributeFilter: ['class'],
    });

    // The app moves without the rail being touched — `first-sound.js` opens in
    // Grain, a double-click in Browse goes there too. `setMode` writes these
    // two classes on `<body>`, so watching them is how the rail hears about it.
    new MutationObserver(() => { sync(); follow(); })
      .observe(document.body, { attributes: true, attributeFilter: ['class'] });

    sync();
    follow();
  }

  // Immediately: `app.js` reads the rail at parse time and this script is
  // loaded before it, so the DOM has to be there now rather than on ready.
  build();
})();

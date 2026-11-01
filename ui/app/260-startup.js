// =================================================================== startup

/// The interface this window loaded, against the one the server has now.
///
/// **A window does not reload because the server did.** A native window fetches
/// `app.js` once and keeps it, so rebuilding the binary and restarting changes
/// what the *next* load would get and nothing at all about the one on screen.
/// This cost a day: the server serving the corrected file the whole time, the
/// window running the old one, and every report from either side true about a
/// different copy of the program. `curl` proves what a new load would receive;
/// it proves nothing about what is in front of anybody.
///
/// So the window remembers the build it started with and says so when it falls
/// behind. It does not reload itself — reloading out from under someone
/// mid-edit is worse than being out of date — it just stops the question
/// "which build am I running" from taking an hour to answer.
let uiBuildLoaded = null;

function noteBuild(id) {
  if (!id) return;
  if (uiBuildLoaded === null) { uiBuildLoaded = id; return; }
  if (id === uiBuildLoaded) return;
  toast('The interface has been rebuilt — reload this window (Cmd-R) to pick it up.');
}

/// What build this window is actually running, for anyone who asks.
function uiBuild() {
  return { loaded: uiBuildLoaded };
}

async function refresh() {
  const s = await api('/api/state');
  noteBuild(s.uiBuild);
  state.library = s.library;
  $('libraryLabel').textContent = s.library || '';
  $('libraryPath').textContent = s.library || 'none chosen';

  const totals = `
    <div class="stat-row"><span class="k">Files indexed</span><span class="v">${s.files.toLocaleString()}</span></div>
    <div class="stat-row"><span class="k">Folders</span><span class="v">${s.folders.toLocaleString()}</span></div>`;
  $('scanTotals').innerHTML = totals;
  $('libraryStats').innerHTML = totals;

  if (s.indexed) {
    state.folders = await api('/api/folders');
    try { state.order = await api('/api/order'); } catch { state.order = []; }
    // Open the first folder so the panel is never an empty box on arrival.
    if (!Object.keys(state.openFolders).length && state.folders.length) {
      await toggleFolder(orderedFolders()[0].name);
    } else {
      buildTree();
    }
  }
  return s;
}

(async function init() {
  setMode('overview');
  updateModeAvailability();
  try {
    loadPresets();
    const s = await refresh();
    if (!s.library) {
      showPane('left', 'import');
      toast('Choose your audio library folder to begin');
    } else if (!s.indexed) {
      showPane('left', 'scan');
    }
  } catch (e) {
    toast('Cannot reach the server: ' + e.message);
  }
})();


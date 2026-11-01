// ───────────────────────────────────────────────────── the grain views window
//
// The views were half the stretch tray, drawing every frame beside the controls
// you were trying to read. They are a window now, opened from Window ▸ Grains.
//
// `#grainVis` is moved into the window rather than rebuilt: the picker, the 2D
// canvas, the 3D iframe and the legend are the same nodes `drawGrains` and
// `visSetup` already hold references to, so nothing needed rewiring and the 2D
// swarm keeps working exactly as it did.

const visWindowOpen = () => !$('visWindow').classList.contains('hidden');

function openVisWindow() {
  const win = $('visWindow');
  const body = $('visWindowBody');
  const vis = $('grainVis');
  if (!win || !body || !vis) return;
  if (vis.parentElement !== body) body.appendChild(vis);
  vis.classList.remove('hidden');
  win.classList.remove('hidden');
  // The canvas measures zero inside a hidden panel, and one sized from that
  // stays a sliver however big the window gets. Draw after it is visible.
  requestAnimationFrame(() => drawGrains());
}

function closeVisWindow() {
  const win = $('visWindow');
  if (!win) return;
  win.classList.add('hidden');
  $('grainVis')?.classList.add('hidden');
}

function toggleVisWindow() {
  (visWindowOpen() ? closeVisWindow : openVisWindow)();
}

function openVisPop() {
  if (!pop.el) buildVisPop();
  // Visible *before* the document loads. An iframe created inside a
  // display:none panel measures zero, and a canvas sized from that stays a
  // sliver in the corner no matter how big the panel gets afterwards.
  pop.el.classList.remove('hidden');
  // embed=1, not the standalone page. The standalone one carries a 320px
  // sidebar and caps the canvas, so the visual stays the same size however big
  // the panel is dragged — which is the opposite of the point of a resizable
  // panel. Embedded, the view *is* the box.
  if (!pop.frame.src) {
    pop.frame.src = `/grains3d?embed=1&view=${Math.max(0, grainView - 1)}`;
    pop.frame.onload = () => pushGrainParams();
  }
}

function closeVisPop() {
  pop.el?.classList.add('hidden');
}

function buildVisPop() {
  const el = document.createElement('div');
  el.className = 'vis-pop hidden';
  // The sidebar lives in the app, so the panel only needs the view names.
  const names = ['Shear', 'Braid', 'Swarm', 'Shells', 'Lattice'];
  el.innerHTML = `
    <div class="vis-pop-head">
      <span class="vis-pop-title">Grains</span>
      ${names.map((n, i) => `<button class="vis-pop-tab" data-view="${i}">${n}</button>`).join('')}
      <span class="vis-pop-hint">drag to move · corner to resize</span>
      <button class="vis-pop-btn" data-act="max" title="Fill the window">&#9723;</button>
      <button class="vis-pop-btn" data-act="close" title="Close">&times;</button>
    </div>
    <iframe title="Grain views"></iframe>
    <div class="vis-pop-grip" title="Resize"></div>`;
  document.body.appendChild(el);

  for (const b of el.querySelectorAll('.vis-pop-tab')) {
    b.onclick = () => {
      for (const o of el.querySelectorAll('.vis-pop-tab')) o.classList.remove('active');
      b.classList.add('active');
      pop.frame.contentWindow?.postMessage(
        { type: 'grainView', view: +b.dataset.view }, location.origin);
    };
  }

  pop.el = el;
  pop.frame = el.querySelector('iframe');
  pop.x = Math.max(20, (window.innerWidth - pop.w) / 2);
  pop.y = Math.max(20, (window.innerHeight - pop.h) / 2);
  place();

  el.querySelector('[data-act="close"]').onclick = closeVisPop;
  el.querySelector('[data-act="max"]').onclick = () => {
    pop.x = 20; pop.y = 20;
    pop.w = window.innerWidth - 40; pop.h = window.innerHeight - 40;
    place();
  };

  // Dragging and resizing both run on the document, not the panel, so the
  // pointer can outrun the element without the gesture being dropped. The
  // iframe stops taking events mid-gesture for the same reason: it would
  // otherwise swallow every move that crossed it.
  el.querySelector('.vis-pop-head').addEventListener('mousedown', (e) => {
    if (e.target.closest('.vis-pop-btn')) return;
    pop.mode = 'move'; pop.ox = e.clientX - pop.x; pop.oy = e.clientY - pop.y;
    pop.frame.style.pointerEvents = 'none';
    e.preventDefault();
  });
  el.querySelector('.vis-pop-grip').addEventListener('mousedown', (e) => {
    pop.mode = 'size'; pop.ox = e.clientX - pop.w; pop.oy = e.clientY - pop.h;
    pop.frame.style.pointerEvents = 'none';
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!pop.mode) return;
    if (pop.mode === 'move') {
      pop.x = fence(e.clientX - pop.ox, -pop.w + 120, window.innerWidth - 120);
      pop.y = fence(e.clientY - pop.oy, 0, window.innerHeight - 40);
    } else {
      pop.w = fence(e.clientX - pop.ox, 420, window.innerWidth);
      pop.h = fence(e.clientY - pop.oy, 300, window.innerHeight);
    }
    place();
  });

  document.addEventListener('mouseup', () => {
    if (!pop.mode) return;
    pop.mode = null;
    pop.frame.style.pointerEvents = '';
  });
}

function place() {
  const s = pop.el.style;
  s.left = pop.x + 'px'; s.top = pop.y + 'px';
  s.width = pop.w + 'px'; s.height = pop.h + 'px';
}

const visOpen = $('visOpen');
if (visOpen) visOpen.onclick = openVisPop;

const rescanBtn = $('rescanBtn');
if (rescanBtn) rescanBtn.onclick = async () => {
  rescanBtn.disabled = true;
  try {
    await postJSON('/api/scan', {});
    // The scan runs on its own thread; wait for it to finish before reading.
    for (let i = 0; i < 600; i++) {
      const s = await api('/api/scan');
      if (!s.running) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    await refreshLibrary();
    toast('Library re-read');
  } catch (e) {
    toast('Re-scan failed: ' + e.message);
  } finally {
    rescanBtn.disabled = false;
  }
};


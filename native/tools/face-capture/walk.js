// Runs inside the page: walks one page's element tree and returns its look
// as data the native app draws from (app/Source/Face.cpp).
//
// Every box: its place (relative to the page's root), its fill (a colour and
// any gradients, parsed), its border per side, its corners, its shadows
// (outer and inset), its opacity, whether it clips what is inside it. Every
// run of text: its words as shown (upper-cased where the CSS says), its place,
// its font, size, weight, colour and letter spacing. Every SVG icon: its
// markup with every colour and stroke resolved. Every canvas: its id and
// place (the native app draws each one with ported code). Pseudo-elements are
// made real first so they are measured like the rest.
//
// Colours come back as [r, g, b, a] (0 to 255, a 0 to 1), whatever the CSS
// wrote them as (color-mix and variables are already resolved by the page).
(function walk(rootSelector, skip) {
  const root = document.querySelector(rootSelector);
  if (!root) return { error: `no ${rootSelector}` };
  const R = root.getBoundingClientRect();

  // ── colours ────────────────────────────────────────────────────────────
  // Any CSS colour, read back from a painted pixel, so every form the page
  // writes (color-mix, color(srgb ...), oklab, variables) comes out the same.
  const px1 = document.createElement('canvas');
  px1.width = px1.height = 1;
  const pctx = px1.getContext('2d', { willReadFrequently: true });
  const known = new Map();
  const colour = (s) => {
    if (!s || s === 'none' || s === 'transparent') return null;
    if (known.has(s)) return known.get(s);
    const probe = document.createElement('i');
    probe.style.color = '';
    probe.style.color = s;
    if (!probe.style.color) { known.set(s, null); return null; }
    pctx.clearRect(0, 0, 1, 1);
    pctx.fillStyle = s;
    pctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = pctx.getImageData(0, 0, 1, 1).data;
    const out = a === 0 ? null : [Math.round(r), Math.round(g), Math.round(b), +(a / 255).toFixed(4)];
    known.set(s, out);
    return out;
  };

  // Split at top-level commas (not inside brackets).
  const split = (s, sep = ',') => {
    const out = [];
    let depth = 0, cur = '';
    for (const ch of s) {
      if (ch === '(') depth++;
      if (ch === ')') depth--;
      if (ch === sep && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  };
  // Split at top-level spaces.
  const words = (s) => split(s, ' ').filter(Boolean);

  const colourStart = /^(#|rgb|hsl|hwb|lab|lch|oklab|oklch|color\(|[a-z]+$)/i;
  const takeColour = (s) => {
    // a stop is "<colour> [<pos> [<pos>]]" or "<pos>" (a hint, dropped)
    const t = words(s);
    const c = colour(t[0]);
    return c ? { colour: c, at: t.slice(1).map((x) => x) } : null;
  };

  const gradient = (g) => {
    const m = g.match(/^(repeating-)?(linear|radial|conic)-gradient\((.*)\)$/s);
    if (!m) return g.startsWith('url(') ? { type: 'image' } : null;
    const parts = split(m[3]);
    const out = { type: m[2], repeating: !!m[1], stops: [] };
    let first = parts[0];
    if (!colourStart.test(first) || !takeColour(first)) {
      parts.shift();
      if (m[2] === 'linear') {
        const d = first.trim();
        const dirs = { 'to top': 0, 'to right': 90, 'to bottom': 180, 'to left': 270, 'to top right': 45, 'to bottom right': 135, 'to bottom left': 225, 'to top left': 315 };
        out.angle = d in dirs ? dirs[d] : d.endsWith('turn') ? parseFloat(d) * 360 : d.endsWith('rad') ? parseFloat(d) * 180 / Math.PI : parseFloat(d);
      } else if (m[2] === 'radial') {
        const [size, at] = first.split(/\s+at\s+/);
        out.shape = /circle/.test(size || '') ? 'circle' : 'ellipse';
        out.size = (size || '').replace(/circle|ellipse/g, '').trim().split(/\s+/).filter(Boolean);
        out.at = (at || 'center').trim().split(/\s+/);
      } else {
        out.conic = first;
      }
    } else if (m[2] === 'linear') out.angle = 180;
    else if (m[2] === 'radial') { out.shape = 'ellipse'; out.size = ['farthest-corner']; out.at = ['center']; }
    for (const p of parts) {
      const s = takeColour(p);
      if (!s) continue;
      if (s.at.length === 2) { out.stops.push({ colour: s.colour, at: s.at[0] }); out.stops.push({ colour: s.colour, at: s.at[1] }); } else out.stops.push({ colour: s.colour, at: s.at[0] ?? null });
    }
    return out;
  };

  const shadows = (s) => {
    if (!s || s === 'none') return [];
    return split(s).map((one) => {
      const inset = /\binset\b/.test(one);
      const t = words(one.replace(/\binset\b/, ''));
      let c = null; const n = [];
      for (const w of t) { if (/^-?[\d.]+px$/.test(w) || w === '0') n.push(parseFloat(w)); else c = colour(w); }
      return c ? { colour: c, x: n[0] || 0, y: n[1] || 0, blur: n[2] || 0, spread: n[3] || 0, inset } : null;
    }).filter(Boolean);
  };

  const px = (v) => parseFloat(v) || 0;
  const rect = (r) => [+(r.x - R.x).toFixed(2), +(r.y - R.y).toFixed(2), +r.width.toFixed(2), +r.height.toFixed(2)];
  const fontOf = (cs) => ({
    family: /mono|menlo|courier/i.test(cs.fontFamily) ? 'mono' : 'sans',
    size: px(cs.fontSize), weight: parseInt(cs.fontWeight) || 400, italic: cs.fontStyle === 'italic',
    spacing: cs.letterSpacing === 'normal' ? 0 : px(cs.letterSpacing),
    colour: colour(cs.color), tabular: /tabular/.test(cs.fontVariantNumeric), align: cs.textAlign,
    ...(cs.textOverflow === 'ellipsis' ? { ellipsis: true } : {}),
  });

  // ── pseudo-elements made real ──────────────────────────────────────────
  const made = [];
  for (const el of root.querySelectorAll('*')) {
    for (const which of ['::before', '::after']) {
      const cs = getComputedStyle(el, which);
      if (!cs || cs.content === 'none' || cs.content === 'normal' || cs.display === 'none') continue;
      const span = document.createElement('span');
      for (const p of cs) span.style.setProperty(p, cs.getPropertyValue(p));
      const text = cs.content.replace(/^["']|["']$/g, '');
      span.textContent = /^(url|counter|attr)\(/.test(cs.content) ? '' : text;
      span.dataset.pseudo = which;
      if (which === '::before') el.prepend(span); else el.append(span);
      made.push(span);
      // the real span takes the pseudo's place; hide the pseudo itself
      el.dataset.capturePseudo = (el.dataset.capturePseudo || '') + which;
    }
  }
  const hide = document.createElement('style');
  hide.textContent = '[data-capture-pseudo]::before,[data-capture-pseudo]::after{content:none!important}';
  document.head.append(hide);

  // ── the tree ───────────────────────────────────────────────────────────
  let count = 0;
  const svgMarkup = (svg) => {
    const clone = svg.cloneNode(true);
    const src = [svg, ...svg.querySelectorAll('*')], dst = [clone, ...clone.querySelectorAll('*')];
    src.forEach((e, i) => {
      const cs = getComputedStyle(e), d = dst[i];
      if (e.tagName === 'svg') return;
      for (const p of ['fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'opacity', 'fill-opacity', 'stroke-opacity', 'stroke-dasharray']) {
        let v = cs.getPropertyValue(p);
        if (p === 'fill' || p === 'stroke') { const c = colour(v); v = c ? `rgba(${c[0]},${c[1]},${c[2]},${c[3]})` : 'none'; }
        if (v) d.setAttribute(p, v);
      }
      if (cs.display === 'none') d.setAttribute('display', 'none');
    });
    const r = svg.getBoundingClientRect();
    clone.setAttribute('width', r.width);
    clone.setAttribute('height', r.height);
    if (!clone.getAttribute('viewBox')) clone.setAttribute('viewBox', `0 0 ${r.width} ${r.height}`);
    clone.removeAttribute('class');
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    return clone.outerHTML;
  };

  const textRuns = (el, cs) => {
    const runs = [];
    // Vertical writing: one run, turned. vertical-rl reads down; turned half
    // round (as the page's side labels are), it reads up.
    if (cs.writingMode.startsWith('vertical')) {
      const text = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').replace(/\s+/g, ' ').trim();
      if (!text) return runs;
      const range = document.createRange();
      range.selectNodeContents(el);
      const r = range.getBoundingClientRect();
      const half = /matrix\(-1, 0, 0, -1/.test(cs.transform) || /matrix\(-1, ?[0-9.e-]+, ?[0-9.e-]+, ?-1/.test(cs.transform);
      runs.push({ text: cs.textTransform === 'uppercase' ? text.toUpperCase() : text, rect: rect(r), font: fontOf(cs), turn: half ? -90 : 90 });
      return runs;
    }
    for (const n of el.childNodes) {
      if (n.nodeType !== 3 || !n.textContent.trim()) continue;
      const range = document.createRange();
      // group characters by line
      const lines = [];
      const s = n.textContent;
      for (let i = 0; i < s.length; i++) {
        range.setStart(n, i); range.setEnd(n, i + 1);
        const rs = range.getClientRects();
        if (!rs.length) continue;
        const r = rs[0];
        let line = lines.find((l) => Math.abs(l.top - r.top) < 2);
        if (!line) { line = { top: r.top, text: '', l: r.left, r: r.right, t: r.top, b: r.bottom }; lines.push(line); }
        line.text += s[i];
        line.l = Math.min(line.l, r.left); line.r = Math.max(line.r, r.right);
        line.t = Math.min(line.t, r.top); line.b = Math.max(line.b, r.bottom);
      }
      for (const l of lines) {
        let text = l.text.replace(/\s+/g, ' ');
        if (!text.trim()) continue;
        if (cs.textTransform === 'uppercase') text = text.toUpperCase();
        if (cs.textTransform === 'lowercase') text = text.toLowerCase();
        runs.push({ text: text.trim(), rect: rect({ x: l.l, y: l.t, width: l.r - l.l, height: l.b - l.t }), font: fontOf(cs) });
      }
    }
    return runs;
  };

  const node = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return null;
    if (skip.some((sel) => el.matches(sel))) return null;
    const r = el.getBoundingClientRect();
    const out = { i: count++, tag: el.tagName.toLowerCase(), rect: rect(r) };
    if (el.id) out.id = el.id;
    const cls = el.getAttribute && el.getAttribute('class');
    if (cls) out.cls = cls;
    const ds = { ...el.dataset };
    delete ds.capturePseudo;
    if (Object.keys(ds).length) out.data = ds;
    if (el.title) out.title = el.title;
    const op = parseFloat(cs.opacity);
    if (op < 1) out.opacity = op;
    if (cs.transform && cs.transform !== 'none') out.transform = cs.transform;
    const bg = colour(cs.backgroundColor);
    if (bg) out.bg = bg;
    if (cs.backgroundImage && cs.backgroundImage !== 'none') {
      const layers = split(cs.backgroundImage).map(gradient).filter(Boolean);
      if (layers.length) out.layers = layers;
    }
    const sides = ['top', 'right', 'bottom', 'left'].map((s) => {
      const w = cs.getPropertyValue(`border-${s}-style`) === 'none' ? 0 : px(cs.getPropertyValue(`border-${s}-width`));
      return w ? { w, colour: colour(cs.getPropertyValue(`border-${s}-color`)) } : null;
    });
    if (sides.some((s) => s && s.colour)) out.border = sides;
    const radii = ['top-left', 'top-right', 'bottom-right', 'bottom-left'].map((c) => {
      const v = cs.getPropertyValue(`border-${c}-radius`);
      return v.endsWith('%') ? Math.min(r.width, r.height) * parseFloat(v) / 100 : px(v);
    });
    if (radii.some(Boolean)) out.radius = radii;
    const sh = shadows(cs.boxShadow);
    if (sh.length) out.shadows = sh;
    if (cs.overflow !== 'visible' || cs.overflowX !== 'visible') out.clip = true;
    if (cs.filter && cs.filter !== 'none') out.filter = cs.filter;
    if (cs.cursor && cs.cursor !== 'auto' && cs.cursor !== 'default') out.cursor = cs.cursor;
    if (el.tagName === 'CANVAS') { out.canvas = el.id || null; return out; }
    if (el.tagName === 'svg' || el.tagName === 'SVG' || el instanceof SVGSVGElement) { out.svg = svgMarkup(el); return out; }
    if (el.tagName === 'SELECT') {
      out.select = { options: [...el.options].map((o) => o.textContent), value: el.selectedIndex };
      out.font = fontOf(cs);
      return out;
    }
    if (el.tagName === 'INPUT') { out.input = { type: el.type, value: el.value }; out.font = fontOf(cs); }
    const t = textRuns(el, cs);
    if (t.length) out.text = t;
    const kids = [...el.children].map(node).filter(Boolean);
    if (kids.length) out.kids = kids;
    return out;
  };

  const tree = node(root);

  // undo the pseudo-elements
  made.forEach((s) => s.remove());
  hide.remove();
  root.querySelectorAll('[data-capture-pseudo]').forEach((e) => delete e.dataset.capturePseudo);

  // The page's own background, from the frame the root sits in.
  const host = root.parentElement, hcs = getComputedStyle(host);
  const backdrop = {
    bg: colour(hcs.backgroundColor),
    layers: hcs.backgroundImage && hcs.backgroundImage !== 'none' ? split(hcs.backgroundImage).map(gradient).filter(Boolean) : [],
    rect: rect(host.getBoundingClientRect()),
  };
  // The page's colour tokens, which its canvases draw with.
  const vcs = getComputedStyle(host);
  const vars = {};
  for (const sheet of document.styleSheets) {
    let rules;
    try { rules = sheet.cssRules; } catch { continue; }
    for (const rule of rules || []) {
      if (!rule.style) continue;
      for (const p of rule.style) if (p.startsWith('--')) vars[p] = vcs.getPropertyValue(p).trim();
    }
  }
  return { size: [R.width, R.height], backdrop, tree, nodes: count, vars };
})

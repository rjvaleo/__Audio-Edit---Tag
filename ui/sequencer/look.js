// The sequencer in the app's look (ours, not the sequencer repository's; 14 Nov
// 2026, after the approved mock-up `seq.html`).
//
// Three things the stylesheet cannot do alone:
// - **The theme.** In the app this page is an iframe on the same origin, so it
//   reads the app's look tokens from the parent and writes them onto its own
//   root, and again whenever the parent's theme changes. On its own it keeps
//   Graphite, which `style.css` states. The canvases' colours (`SEQ_INK`,
//   app.js) follow too.
// - **The knobs' pictures.** Each knob gets a small drawing of what it does,
//   and the colour of its family: time, pitch, tone, attack, space, level.
// - **Segmented switches** for the selects marked `data-seg` (Direction, Step
//   len). The select stays, hidden, and is what everything else reads; presets
//   that set it are followed.

// ─── THE THEME ───────────────────────────────────────────────────────────────
const LOOK_TOKENS = [
  "--look-chassis", "--look-panel", "--look-panel-hi", "--look-well", "--look-line", "--look-text", "--look-text-2", "--look-text-3",
  "--look-arc", "--look-track", "--look-grain", "--look-ui", "--on", "--on-rgb",
  "--look-f-time", "--look-f-pitch", "--look-f-tone", "--look-f-attack", "--look-f-space", "--look-f-level",
];
// Which token each canvas colour is.
const LOOK_INKS = { well: "--look-well", line: "--look-line", text: "--look-text", dim: "--look-text-3", attack: "--look-f-attack", tone: "--look-f-tone", space: "--look-f-space", pitch: "--look-f-pitch", time: "--look-f-time", on: "--on" };

/// A CSS colour as #rrggbb, for the canvases' alphas (a canvas normalises what it is given).
const lookHexCtx = document.createElement("canvas").getContext("2d");
function lookHex(css) {
  lookHexCtx.fillStyle = "#000";
  lookHexCtx.fillStyle = css;
  return lookHexCtx.fillStyle;
}

function lookFromHost() {
  let host = null;
  try {
    if (window.parent !== window && window.parent.document) host = window.parent.document.documentElement;
  } catch (e) {
    host = null; // another origin: keep Graphite
  }
  const root = document.documentElement;
  if (host) {
    const cs = window.parent.getComputedStyle(host);
    for (const t of LOOK_TOKENS) {
      const v = cs.getPropertyValue(t).trim();
      if (v) root.style.setProperty(t, v);
      else root.style.removeProperty(t);
    }
  }
  const mine = getComputedStyle(root);
  if (typeof SEQ_INK !== "undefined") {
    for (const [k, t] of Object.entries(LOOK_INKS)) {
      const v = mine.getPropertyValue(t).trim();
      if (v) SEQ_INK[k] = lookHex(v);
    }
  }
  // Redraw what is drawn once.
  for (const f of ["drawADSRCanvas", "drawFilterADSRCanvas", "atmosDrawAmp", "journeyDraw", "accompanyDraw"]) if (typeof window[f] === "function") window[f]();
}

function lookWatchHost() {
  let host = null;
  try {
    host = window.parent !== window ? window.parent.document.documentElement : null;
  } catch (e) {
    host = null;
  }
  if (!host) return;
  // A theme is written onto the parent's root as inline variables, and a Look
  // as a class or attribute; any of them means read again.
  new MutationObserver(() => lookFromHost()).observe(host, { attributes: true, attributeFilter: ["style", "class", "data-look", "data-theme"] });
}

// ─── THE KNOBS' PICTURES ─────────────────────────────────────────────────────
// After the mock-ups' glyphs: what a knob does, in a 22 × 16 box.
const LOOK_GLYPH = {
  rise: "M2 14 7 4 20 4", fall: "M2 3C5 3 7 13 20 13", sus: "M2 12 6 4 10 8H20", wave: "M1 8C4 1 7 1 10 8S16 15 21 8",
  cut: "M1 5H11C15 5 16 13 21 14", res: "M1 10H9C12 10 12 2 14 2S16 10 21 10", key: "M2 14 20 2", hz: "M1 8C3 3 5 3 7 8S11 13 13 8 17 3 21 8",
  vol: "M2 14 20 2V14Z", dots: "M3 8H4M9 8H10M15 8H16", delay: "M2 12V4M8 12V7M14 12V9M20 12V11", mix: "M2 8H20M11 2V14",
  spread: "M11 8 3 3M11 8 19 3M11 8 3 13M11 8 19 13", tilt: "M1 12 21 4", steps: "M2 12H6V8H10V4H14V8H18V12H21",
  pw: "M1 12V4H5V12H21V4", unison: "M1 6C5 2 9 2 13 6M1 10C5 6 9 6 13 10M9 8C13 4 17 4 21 8", drift: "M1 9C4 6 6 11 9 8S14 5 17 9 20 8 21 7",
  sub: "M1 4C6 4 6 13 11 13S16 4 21 4", air: "M2 8H3M5 5H6M8 10H9M11 6H12M14 9H15M17 4H18M19 11H20", hold: "M1 12H4L6 4H16L18 12H21",
  glide: "M1 13C8 13 12 3 21 3", blend: "M2 13 20 3M2 3 20 13", oct: "M3 14V2M3 2 0 5M3 2 6 5M14 8H20",
  ens: "M1 8C4 3 7 3 10 8S16 13 21 8M1 10C4 5 7 5 10 10S16 15 21 10", wow: "M1 8C6 5 8 11 11 8S17 5 21 8", warm: "M1 12C7 12 9 4 21 4",
  ring: "M2 8C4 2 6 14 8 8S12 3 14 8 17 11 21 8", size: "M3 3H19V13H3Z", pre: "M2 12V4M2 8H8M12 4V12M17 6V12", damp: "M1 4H9C13 4 15 13 21 13",
  shim: "M1 13 6 8 9 11 14 5 17 8 21 2", lowcut: "M1 13C7 13 7 4 12 4H21", big: "M11 2V14M4 8H18M6 4 16 12M16 4 6 12",
};
/// Each knob's picture and colour family, by its input's id.
const LOOK_KNOB = {
  bpmSlider: ["dots", "time"], stepsSlider: ["steps", "time"], morphTimeSlider: ["glide", "time"], perfVarSlider: ["drift", "time"],
  atkSlider: ["rise", "attack"], decSlider: ["fall", "attack"], susSlider: ["sus", "level"], relSlider: ["fall", "attack"], volSlider: ["vol", "level"], pwSlider: ["pw", "pitch"],
  cutoffSlider: ["cut", "tone"], resSlider: ["res", "tone"], keyFollowSlider: ["key", "tone"],
  fatkSlider: ["rise", "tone"], fdecSlider: ["fall", "tone"], fsusSlider: ["sus", "tone"], frelSlider: ["fall", "tone"], famtSlider: ["tilt", "tone"],
  lfo1RateSlider: ["hz", "attack"], lfo1DepthSlider: ["wave", "attack"], lfo2RateSlider: ["hz", "tone"], lfo2DepthSlider: ["wave", "tone"],
  lfo3RateSlider: ["hz", "space"], lfo3DepthSlider: ["wave", "space"],
  jWanderSlider: ["drift", "time"], jEachSlider: ["steps", "time"],
  acBassLevelSlider: ["vol", "attack"], acBassOctSlider: ["oct", "attack"], acChordLevelSlider: ["vol", "tone"], acChordSpreadSlider: ["spread", "tone"],
  acArpLevelSlider: ["vol", "space"], acArpRangeSlider: ["wave", "space"], acDroneLevelSlider: ["vol", "pitch"], acDroneSwellSlider: ["rise", "pitch"],
  delayFbSlider: ["delay", "space"], delayWetSlider: ["mix", "space"], delaySpreadSlider: ["spread", "space"], delayHiCutSlider: ["cut", "tone"],
  atA1Slider: ["wave", "pitch"], atA2Slider: ["wave", "pitch"], atA3Slider: ["wave", "pitch"], atAOctSlider: ["oct", "pitch"],
  atB1Slider: ["wave", "tone"], atB2Slider: ["wave", "tone"], atB3Slider: ["wave", "tone"], atBOctSlider: ["oct", "tone"],
  atBlendSlider: ["blend", "pitch"], atUnisonSlider: ["unison", "pitch"], atDetuneSlider: ["hz", "pitch"], atWidthSlider: ["spread", "space"],
  atDriftSlider: ["drift", "pitch"], atSubSlider: ["sub", "level"], atAirSlider: ["air", "level"], atHoldSlider: ["hold", "time"], atGlideSlider: ["glide", "time"],
  atAtkSlider: ["rise", "attack"], atDecSlider: ["fall", "attack"], atSusSlider: ["sus", "level"], atRelSlider: ["fall", "attack"], atVolSlider: ["vol", "level"],
  atEnsSlider: ["ens", "space"], atEnsRateSlider: ["hz", "space"], atWowSlider: ["wow", "time"], atWarmSlider: ["warm", "attack"],
  atSymSlider: ["mix", "pitch"], atSymRingSlider: ["ring", "pitch"], atSymMatSlider: ["res", "pitch"],
  atRevWetSlider: ["mix", "space"], atRevSizeSlider: ["size", "space"], atRevPreSlider: ["pre", "space"], atRevDampSlider: ["damp", "tone"],
  atRevShimSlider: ["shim", "space"], atRevSpreadSlider: ["spread", "space"], atLowCutSlider: ["lowcut", "tone"], atMacroSlider: ["big", "on"],
};

function lookKnobs() {
  for (const g of document.querySelectorAll(".knob-group, .lfo-knob")) {
    const inp = g.querySelector("input[type=range]");
    const knob = g.querySelector(".knob");
    if (!inp || !knob || g.querySelector(".kn-gl")) continue;
    const [glyph, fam] = LOOK_KNOB[inp.id] || ["wave", "level"];
    g.style.setProperty("--kc", fam === "on" ? "var(--on)" : `var(--f-${fam})`);
    const top = document.createElement("span");
    top.className = "kn-top";
    top.innerHTML = `<svg class="kn-gl" viewBox="0 0 22 16" aria-hidden="true"><path d="${LOOK_GLYPH[glyph] || LOOK_GLYPH.wave}"/></svg>`;
    knob.before(top);
    top.append(knob);
    if (typeof updateKnobVisual === "function") updateKnobVisual(inp.id);
  }
}

// ─── SEGMENTED SWITCHES ──────────────────────────────────────────────────────
function lookSegs() {
  for (const sel of document.querySelectorAll("select[data-seg]")) {
    if (sel.nextElementSibling && sel.nextElementSibling.classList.contains("seg")) continue;
    const seg = document.createElement("div");
    seg.className = "seg";
    for (const o of sel.options) {
      const b = document.createElement("button");
      b.type = "button";
      b.dataset.v = o.value;
      b.textContent = o.textContent;
      b.addEventListener("click", () => {
        if (sel.value === o.value) return;
        sel.value = o.value;
        sel.dispatchEvent(new Event("change", { bubbles: true }));
        lookSegsPaint();
      });
      seg.append(b);
    }
    sel.classList.add("seg-src");
    sel.after(seg);
  }
  lookSegsPaint();
}
function lookSegsPaint() {
  for (const sel of document.querySelectorAll("select[data-seg]")) {
    const seg = sel.nextElementSibling;
    if (!seg || !seg.classList.contains("seg")) continue;
    for (const b of seg.children) b.classList.toggle("on", b.dataset.v === sel.value);
  }
  // Space's room buttons light the one its knobs match, as atmos.js decides.
}

// ─── START ───────────────────────────────────────────────────────────────────
lookFromHost();
lookWatchHost();
lookKnobs();
lookSegs();
// Presets, morphs and the recorder set the selects without a click; follow them.
setInterval(lookSegsPaint, 300);
// Canvases sized by the layout redraw at their real width once it has settled.
requestAnimationFrame(() => lookFromHost());

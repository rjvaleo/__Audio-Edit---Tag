// The grain shapes.
//
// A catalogue of small solids for the room's grain cloud to draw its grains as.
// Read off the sheets in `Gran Shapes/`: the school poster of fifteen, the
// Platonic five, the uniform polyhedra page, and the simplex projections.
//
// **Built, not stored.** Every model here is constructed from its definition
// when the page loads rather than kept as a table of numbers, for the same
// reason the jitters are pure functions rather than a recorded stream: a
// definition can be read and checked, and a table of six hundred floats can
// only be trusted. It costs a few milliseconds once.
//
// **Wireframe, because the room is.** The shader has one light and it is the
// signal — there is no lamp in this scene and no depth buffer, and everything
// in the box is drawn as edges over black with additive blending. A solid face
// under that is a flat bright patch with no form in it, and twenty of them
// stacked is a white blob. Edges keep the shape legible at eight pixels and
// stacked forty deep, which is the size and the density these are actually
// used at.
//
// A model is unit-radius and centred, so the room decides how big a grain is
// and this file never does.

/// Vertices that sit closer together than this are the same vertex.
const GS_WELD = 1e-6;

/// How much longer than the shortest edge a pair may be and still count as an
/// edge of the solid.
///
/// The uniform polyhedra are all equal-edged, so in principle this is exact.
/// It is a band rather than a test for equality because the truncations are
/// solved numerically and land a rounding error away from equal, and because a
/// band that is too tight silently drops half a wireframe — which looks like a
/// modelling mistake rather than a tolerance one.
const GS_EDGE_BAND = 1.12;

// ── the small print of building one ─────────────────────────────────────────

const gsSub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const gsLen = (v) => Math.hypot(v[0], v[1], v[2]);
const gsDist = (a, b) => gsLen(gsSub(a, b));

/// Move a model's centroid to the origin and scale its furthest vertex to one.
///
/// Everything downstream assumes this. A grain is placed and sized by the room,
/// so a model that arrived twice the size of its neighbour would be a grain
/// twice as loud without anything having been said about the sound.
function gsUnit(verts) {
  const c = [0, 0, 0];
  for (const v of verts) { c[0] += v[0]; c[1] += v[1]; c[2] += v[2]; }
  c[0] /= verts.length; c[1] /= verts.length; c[2] /= verts.length;
  let r = 0;
  for (const v of verts) r = Math.max(r, gsDist(v, c));
  const k = r > 0 ? 1 / r : 1;
  return verts.map((v) => [(v[0] - c[0]) * k, (v[1] - c[1]) * k, (v[2] - c[2]) * k]);
}

/// Fold vertices that landed on top of each other into one, and carry the
/// indices with them.
///
/// Rectification is truncation taken to the halfway point, where the two new
/// points on an edge meet — so a cuboctahedron arrives as a cube's worth of
/// duplicate pairs unless they are welded. Nothing else in here produces
/// duplicates, which is why this is a step rather than a habit.
function gsWeld(verts) {
  const out = [], map = [];
  for (const v of verts) {
    let hit = -1;
    for (let i = 0; i < out.length; i++) {
      if (gsDist(out[i], v) < GS_WELD) { hit = i; break; }
    }
    if (hit < 0) { hit = out.length; out.push(v); }
    map.push(hit);
  }
  return { verts: out, map };
}

/// The edges of an equal-edged solid, found by how far apart its vertices are.
///
/// Every uniform polyhedron is vertex-transitive with one edge length, and that
/// length is the *shortest* distance between any two of its vertices — so the
/// wireframe can be recovered from the vertices alone, with no face list to get
/// wrong. This is why the Platonic and Archimedean solids below are given as
/// coordinates and nothing else: there is no connectivity to mistype.
///
/// It does not hold for a prism, a pyramid or anything swept round an axis,
/// where the sides and the ends are different lengths. Those state their edges.
function gsNearEdges(verts) {
  let min = Infinity;
  for (let i = 0; i < verts.length; i++) {
    for (let j = i + 1; j < verts.length; j++) {
      const d = gsDist(verts[i], verts[j]);
      if (d > GS_WELD && d < min) min = d;
    }
  }
  const lim = min * GS_EDGE_BAND, edges = [];
  for (let i = 0; i < verts.length; i++) {
    for (let j = i + 1; j < verts.length; j++) {
      if (gsDist(verts[i], verts[j]) <= lim) edges.push([i, j]);
    }
  }
  return edges;
}

/// A finished model, in the form the renderer wants it.
///
/// The vertices are a flat `Float32Array` and the edges are index pairs, so
/// drawing one is a walk down two typed arrays with no object in the loop —
/// this runs once per grain per frame and there may be thousands of them.
function gsModel(name, rawVerts, rawEdges, rawFaces) {
  const verts = gsUnit(rawVerts);
  const edges = rawEdges || gsNearEdges(verts);
  const pos = new Float32Array(verts.length * 3);
  for (let i = 0; i < verts.length; i++) {
    pos[i * 3] = verts[i][0]; pos[i * 3 + 1] = verts[i][1]; pos[i * 3 + 2] = verts[i][2];
  }
  const idx = new Uint16Array(edges.length * 2);
  for (let i = 0; i < edges.length; i++) {
    idx[i * 2] = edges[i][0]; idx[i * 2 + 1] = edges[i][1];
  }
  // The skin, for filling. Convex solids can work theirs out from their own
  // vertices; the ones that cannot say so — see `gsFaceTris`.
  const tris = gsFaceTris(verts, rawFaces === undefined ? gsHullFaces(verts) : rawFaces);
  const tri = new Uint16Array(tris.length * 3);
  for (let i = 0; i < tris.length; i++) {
    tri[i * 3] = tris[i][0]; tri[i * 3 + 1] = tris[i][1]; tri[i * 3 + 2] = tris[i][2];
  }
  return { name, pos, idx, tri, verts: verts.length, lines: edges.length, skin: tris.length };
}

/// A model's skin, as triangles.
///
/// A face arrives as an unordered set of coplanar vertices, so it is put in
/// order around its own centroid before being fanned. Fanning an unordered ring
/// gives a bow tie — the triangles cross, the winding alternates, and the
/// "solid" has holes in it that move as it turns.
function gsFaceTris(verts, faces) {
  const tris = [];
  for (const ring of faces) {
    if (ring.length < 3) continue;
    const ordered = gsRingOrder(verts, ring);
    for (let i = 1; i + 1 < ordered.length; i++) {
      tris.push([ordered[0], ordered[i], ordered[i + 1]]);
    }
  }
  return tris;
}

/// Put a face's vertices in order around it.
function gsRingOrder(verts, ring) {
  const c = [0, 0, 0];
  for (const i of ring) { c[0] += verts[i][0]; c[1] += verts[i][1]; c[2] += verts[i][2]; }
  c[0] /= ring.length; c[1] /= ring.length; c[2] /= ring.length;
  const cross = (u, v) => [
    u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0],
  ];
  const u = gsSub(verts[ring[0]], c);
  const ul = gsLen(u) || 1;
  u[0] /= ul; u[1] /= ul; u[2] /= ul;
  // The widest cross product, so a nearly-collinear pair does not decide the
  // plane's normal.
  let nrm = [0, 0, 0];
  for (let i = 1; i < ring.length; i++) {
    const x = cross(u, gsSub(verts[ring[i]], c));
    if (gsLen(x) > gsLen(nrm)) nrm = x;
  }
  const nl = gsLen(nrm) || 1;
  nrm[0] /= nl; nrm[1] /= nl; nrm[2] /= nl;
  const w = cross(nrm, u);
  const ang = (i) => {
    const v = gsSub(verts[i], c);
    return Math.atan2(v[0] * w[0] + v[1] * w[1] + v[2] * w[2],
      v[0] * u[0] + v[1] * u[1] + v[2] * u[2]);
  };
  return ring.slice().sort((a, b) => ang(a) - ang(b));
}

// ── the Platonic five ───────────────────────────────────────────────────────
//
// Coordinates only. Their edges are the shortest distances between their
// vertices, which `gsNearEdges` finds without being told anything.

const GS_PHI = (1 + Math.sqrt(5)) / 2;

/// Alternate corners of a cube.
const gsTetraVerts = () => [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]];

const gsCubeVerts = () => {
  const v = [];
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) v.push([x, y, z]);
  return v;
};

const gsOctaVerts = () => [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
];

/// The three golden rectangles, one in each plane.
const gsIcosaVerts = () => {
  const v = [];
  for (const a of [-1, 1]) for (const b of [-GS_PHI, GS_PHI]) {
    v.push([0, a, b], [a, b, 0], [b, 0, a]);
  }
  return v;
};

/// A cube with a golden rectangle standing in each face.
const gsDodecaVerts = () => {
  const v = gsCubeVerts(), p = GS_PHI, q = 1 / GS_PHI;
  for (const a of [-q, q]) for (const b of [-p, p]) {
    v.push([0, a, b], [a, b, 0], [b, 0, a]);
  }
  return v;
};

// ── cutting the corners off ─────────────────────────────────────────────────

/// Cut every vertex off `verts`, a fraction `t` of the way along each edge.
///
/// At `t` below a half each edge yields two new points and the solid keeps a
/// stub of it; at exactly a half the two meet and the original edges vanish,
/// which is rectification — a cuboctahedron out of a cube, an icosidodecahedron
/// out of a dodecahedron. Both come out of the same function because they are
/// the same operation stopped at different points.
///
/// The edges are handed back rather than recovered afterwards. A truncated
/// solid has two kinds of edge and they are only the same length at the one
/// depth that makes it Archimedean — so at every other depth the
/// shortest-distance rule sees one kind, calls it the wireframe, and throws the
/// other away. Which is exactly what it did: a truncated dodecahedron came out
/// with sixty vertices and thirty edges, three quarters of it missing, and the
/// search that was meant to find the right depth was reading a solid it had
/// already flattened and reporting it perfect.
function gsTruncateAt(verts, t) {
  const base = gsNearEdges(verts);
  const nb = verts.map(() => []);
  for (const [i, j] of base) { nb[i].push(j); nb[j].push(i); }

  // One new point per (vertex, neighbour): the cut on that edge, near that end.
  const pts = [], at = new Map();
  const key = (v, u) => `${v}>${u}`;
  for (const [i, j] of base) {
    for (const [v, u] of [[i, j], [j, i]]) {
      const a = verts[v], b = verts[u];
      at.set(key(v, u), pts.length);
      pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
    }
  }

  // What is left of each original edge, between its two cuts.
  const stubs = base.map(([i, j]) => [at.get(key(i, j)), at.get(key(j, i))]);

  // The polygon left where each vertex used to be. Its corners are the cuts on
  // that vertex's own edges, and the ones that are joined are the ones nearest
  // each other — a local question with a local answer, unlike the global rule
  // that cannot tell the two classes apart.
  const rings = [];
  for (let v = 0; v < verts.length; v++) {
    const ring = nb[v].map((u) => at.get(key(v, u)));
    let min = Infinity;
    for (let a = 0; a < ring.length; a++) {
      for (let b = a + 1; b < ring.length; b++) {
        min = Math.min(min, gsDist(pts[ring[a]], pts[ring[b]]));
      }
    }
    for (let a = 0; a < ring.length; a++) {
      for (let b = a + 1; b < ring.length; b++) {
        if (gsDist(pts[ring[a]], pts[ring[b]]) <= min * 1.2) rings.push([ring[a], ring[b]]);
      }
    }
  }

  // At a half the two cuts on an edge are the same point, so the stubs go and
  // the duplicates fold together.
  const { verts: welded, map } = gsWeld(pts);
  const seen = new Set(), edges = [];
  for (const [a, b] of [...stubs, ...rings]) {
    const i = map[a], j = map[b];
    if (i === j) continue;
    const k = i < j ? `${i}:${j}` : `${j}:${i}`;
    if (seen.has(k)) continue;
    seen.add(k);
    edges.push([i, j]);
  }
  return { verts: welded, edges };
}

/// How unequal the edges are at a given depth of cut.
///
/// A truncated solid has two kinds of edge — the polygon left where a vertex
/// used to be, and the stub of the original edge between two cuts — and it is
/// Archimedean at the one depth where they are the same length. This is the
/// number that has to reach one.
function gsTruncSkew(verts, t) {
  const { verts: v, edges } = gsTruncateAt(verts, t);
  let min = Infinity, max = 0;
  for (const [i, j] of edges) {
    const d = gsDist(v[i], v[j]);
    if (d < min) min = d;
    if (d > max) max = d;
  }
  return min > 0 ? max / min : Infinity;
}

/// Truncate, at whatever depth makes the edges equal.
///
/// The depth is different for every solid — a third for the octahedron, a shade
/// under three tenths for the cube — and it is a short search rather than a
/// table because a table of five constants is five chances to write the wrong
/// one, and the search says out loud what makes the answer right.
function gsTruncate(name, verts) {
  let lo = 0.05, hi = 0.495;
  for (let i = 0; i < 60; i++) {
    const a = lo + (hi - lo) / 3, b = hi - (hi - lo) / 3;
    if (gsTruncSkew(verts, a) < gsTruncSkew(verts, b)) hi = b; else lo = a;
  }
  const t = (lo + hi) / 2;
  const built = gsTruncateAt(verts, t);
  return gsModel(name, built.verts, built.edges);
}

/// Cut all the way to the middle of each edge.
const gsRectify = (name, verts) => {
  const built = gsTruncateAt(verts, 0.5);
  return gsModel(name, built.verts, built.edges);
};

// ── swept round an axis ─────────────────────────────────────────────────────
//
// These state their own edges. Their sides and their ends are different
// lengths, so the shortest-distance rule that recovers a Platonic wireframe
// would keep the short ones and throw the rest of the shape away.

/// A ring of `n` points at height `y` and radius `r`, and the edges round it.
function gsRing(verts, edges, n, y, r, close = true) {
  const first = verts.length;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    verts.push([Math.cos(a) * r, y, Math.sin(a) * r]);
  }
  if (close) {
    for (let i = 0; i < n; i++) edges.push([first + i, first + ((i + 1) % n)]);
  }
  return first;
}

/// An `n`-sided prism. Three is the triangular one, four the cuboid, and so on
/// up the poster.
function gsPrism(name, n, h = 1.15) {
  const verts = [], edges = [];
  const lo = gsRing(verts, edges, n, -h / 2, 1);
  const hi = gsRing(verts, edges, n, h / 2, 1);
  for (let i = 0; i < n; i++) edges.push([lo + i, hi + i]);
  return gsModel(name, verts, edges);
}

/// An `n`-sided pyramid: a base and an apex over the middle of it.
function gsPyramid(name, n, h = 1.5) {
  const verts = [], edges = [];
  const base = gsRing(verts, edges, n, -h / 2, 1);
  const apex = verts.length;
  verts.push([0, h / 2, 0]);
  for (let i = 0; i < n; i++) edges.push([base + i, apex]);
  return gsModel(name, verts, edges);
}

/// A box with three different sides. The poster's cuboid, which is a cube that
/// has been told which way up it is.
function gsCuboid(name, a, b, c) {
  const verts = [], edges = [];
  for (const x of [-a, a]) for (const y of [-b, b]) for (const z of [-c, c]) verts.push([x, y, z]);
  for (let i = 0; i < 8; i++) {
    for (let j = i + 1; j < 8; j++) {
      // Corners of a box are joined when they differ in exactly one coordinate.
      let differ = 0;
      for (let k = 0; k < 3; k++) if (Math.abs(verts[i][k] - verts[j][k]) > GS_WELD) differ++;
      if (differ === 1) edges.push([i, j]);
    }
  }
  return gsModel(name, verts, edges);
}

/// A cylinder, a cone and everything between them.
///
/// One function because they *are* one shape: a cone is the frustum whose top
/// has closed to a point and a cylinder is the one whose top never narrowed.
/// The poster draws all three separately and they differ by a single number.
function gsFrustum(name, n, topR, h = 1.3) {
  const verts = [], edges = [];
  const lo = gsRing(verts, edges, n, -h / 2, 1);
  if (topR <= GS_WELD) {
    const apex = verts.length;
    verts.push([0, h / 2, 0]);
    for (let i = 0; i < n; i++) edges.push([lo + i, apex]);
  } else {
    const hi = gsRing(verts, edges, n, h / 2, topR);
    for (let i = 0; i < n; i++) edges.push([lo + i, hi + i]);
  }
  return gsModel(name, verts, edges);
}

/// A globe of latitudes and longitudes, squashed by `sy` and cut at `arc`.
///
/// The sphere, the ellipsoid and the hemisphere in one: an ellipsoid is a
/// sphere with a scale on one axis, and a hemisphere is one that stops at the
/// equator. Drawn as a cage rather than a shaded ball because a shaded ball in
/// this room is a dot — the only thing that says "round" here is the way the
/// lines run.
function gsGlobe(name, rings, seg, sy = 1, arc = 1) {
  const verts = [], edges = [];
  const rows = [];
  for (let r = 0; r <= rings; r++) {
    const phi = (r / rings) * Math.PI * arc;
    const y = Math.cos(phi) * sy, rad = Math.sin(phi);
    if (rad < GS_WELD) {
      const p = verts.length;
      verts.push([0, y, 0]);
      rows.push({ first: p, n: 1 });
    } else {
      rows.push({ first: gsRing(verts, edges, seg, y, rad), n: seg });
    }
  }
  for (let r = 0; r < rings; r++) {
    const a = rows[r], b = rows[r + 1];
    const n = Math.max(a.n, b.n);
    for (let i = 0; i < n; i++) {
      edges.push([a.first + (a.n === 1 ? 0 : i % a.n), b.first + (b.n === 1 ? 0 : i % b.n)]);
    }
  }
  // A hemisphere is a bowl, and a bowl has a rim. Without this the cut edge is
  // the last latitude, which is the same line the cage already drew.
  if (arc < 1) {
    const last = rows[rows.length - 1];
    for (let i = 0; i < last.n; i++) {
      edges.push([last.first + i, last.first + ((i + 1) % last.n)]);
    }
  }
  return gsModel(name, verts, edges);
}

/// A ring of rings.
function gsTorus(name, major, minor, seg, ringSeg) {
  const verts = [], edges = [];
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    for (let j = 0; j < ringSeg; j++) {
      const b = (j / ringSeg) * Math.PI * 2;
      const r = major + Math.cos(b) * minor;
      verts.push([Math.cos(a) * r, Math.sin(b) * minor, Math.sin(a) * r]);
    }
  }
  const at = (i, j) => ((i % seg) + seg) % seg * ringSeg + ((j % ringSeg) + ringSeg) % ringSeg;
  const faces = [];
  for (let i = 0; i < seg; i++) {
    for (let j = 0; j < ringSeg; j++) {
      edges.push([at(i, j), at(i, j + 1)]);
      edges.push([at(i, j), at(i + 1, j)]);
      // A ring of rings has a hole in it, and a hull does not. Its own quads,
      // or the fill would be a disc.
      faces.push([at(i, j), at(i, j + 1), at(i + 1, j + 1), at(i + 1, j)]);
    }
  }
  return gsModel(name, verts, edges, faces);
}

// ── the spiked ones ─────────────────────────────────────────────────────────

/// Raise a spike over the middle of every face.
///
/// The uniform polyhedra sheet is mostly star forms — Quith, Quit Sissid, Quit
/// Gissid, Tiggy, Tigid — and what a star form *is*, at the size a grain is
/// drawn, is a solid with a spike standing on each of its faces. These are
/// built that way and named for that rather than borrowed from the sheet's
/// acronyms: an honest spiked dodecahedron is a better thing to have in the
/// catalogue than something claiming to be a great stellated dodecahedron and
/// missing its face planes by a few degrees.
///
/// Faces are found from the wireframe: a face is a shortest cycle of edges, and
/// for these solids the cycles that matter are the ones every edge sits in
/// twice. Rather than hunt them, the spike is raised over each *edge loop*
/// found by walking the neighbours of a vertex — which for a convex equal-edged
/// solid is the same set of faces.
function gsSpiked(name, verts, height) {
  const edges = gsNearEdges(verts);
  const faces = gsHullFaces(verts);
  const out = verts.map((v) => v.slice());
  const outEdges = edges.map(([i, j]) => [i, j]);
  // Spiking makes a solid that is no longer convex, so its skin cannot be
  // recovered from its vertices — the hull would shrink-wrap the spikes and
  // give back the shape it started from. Each spike states its own triangles.
  const outFaces = [];
  for (const ring of faces) {
    const c = [0, 0, 0];
    for (const i of ring) { c[0] += verts[i][0]; c[1] += verts[i][1]; c[2] += verts[i][2]; }
    c[0] /= ring.length; c[1] /= ring.length; c[2] /= ring.length;
    const k = 1 + height;
    const apex = out.length;
    out.push([c[0] * k, c[1] * k, c[2] * k]);
    for (const i of ring) outEdges.push([i, apex]);
    const ord = gsRingOrder(verts, ring);
    for (let i = 0; i < ord.length; i++) {
      outFaces.push([apex, ord[i], ord[(i + 1) % ord.length]]);
    }
  }
  return gsModel(name, out, outEdges, outFaces);
}

/// The faces of a convex solid, as sets of vertices.
///
/// A face is a plane the whole solid sits on one side of. That is the whole
/// definition and it is worth using directly: the first version of this walked
/// a vertex's neighbours looking for rings, and on the octahedron it found
/// twenty-nine "faces" for a solid with eight — every flat quadrilateral cut
/// through the middle of it counts as a ring, and none of them is a face. The
/// support-plane test cannot make that mistake, because a plane through the
/// middle has vertices on both sides of it.
///
/// Cubic in the vertex count, and only ever called on the Platonic five, where
/// that is twenty cubed and runs in under a millisecond.
function gsHullFaces(verts) {
  const n = verts.length, seen = new Set(), faces = [];
  const cross = (u, v) => [
    u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0],
  ];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      for (let k = j + 1; k < n; k++) {
        const nrm = cross(gsSub(verts[j], verts[i]), gsSub(verts[k], verts[i]));
        const len = gsLen(nrm);
        if (len < GS_WELD) continue;
        nrm[0] /= len; nrm[1] /= len; nrm[2] /= len;
        const d = nrm[0] * verts[i][0] + nrm[1] * verts[i][1] + nrm[2] * verts[i][2];
        let above = 0, below = 0;
        const on = [];
        for (let m = 0; m < n; m++) {
          const s = nrm[0] * verts[m][0] + nrm[1] * verts[m][1] + nrm[2] * verts[m][2] - d;
          if (s > 1e-9) above++;
          else if (s < -1e-9) below++;
          else on.push(m);
        }
        if (above && below) continue;
        const key = on.join(',');
        if (seen.has(key)) continue;
        seen.add(key);
        faces.push(on);
      }
    }
  }
  return faces;
}

// ── the simplexes ───────────────────────────────────────────────────────────

/// `n` points on a sphere with every pair joined — the wireframe on the sheet
/// of simplex projections.
///
/// A right-angle simplex in `n` dimensions has `n+1` mutually joined vertices,
/// and what those sheets show is that graph projected into three. The vertices
/// are spread by the golden spiral rather than by a projection of the real
/// thing, because what carries here is the *chording* — a dense knot of lines
/// through a spherical shell, unlike anything else in the catalogue.
function gsSimplex(name, n) {
  const verts = [], edges = [];
  const step = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const a = step * i;
    verts.push([Math.cos(a) * r, y, Math.sin(a) * r]);
  }
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) edges.push([i, j]);
  // No skin. A simplex is a graph rather than a surface — every pair of its
  // vertices is joined and none of that is a face — so a filled one would be a
  // ball with a lattice drawn on it, which is not what these are.
  return gsModel(name, verts, edges, []);
}

// ── the catalogue ───────────────────────────────────────────────────────────

/// Every shape off the sheets, built once.
///
/// Ordered by how much wire is in them, which is the order the room wants: a
/// grain drawn at four pixels gets something from the top of this list and one
/// drawn at forty can afford something from the bottom. See `GRAIN_SHAPE_TIERS`.
const GRAIN_SHAPES = (() => {
  const tetra = gsTetraVerts(), cube = gsCubeVerts(), octa = gsOctaVerts();
  const icosa = gsIcosaVerts(), dodeca = gsDodecaVerts();
  const list = [
    // The Platonic five.
    gsModel('tetrahedron', tetra),
    gsModel('cube', cube),
    gsModel('octahedron', octa),
    gsModel('dodecahedron', dodeca),
    gsModel('icosahedron', icosa),

    // The prisms and the pyramids, as the poster lists them.
    gsPyramid('square pyramid', 4),
    gsPyramid('pentagonal pyramid', 5),
    gsPyramid('hexagonal pyramid', 6),
    gsPrism('triangular prism', 3),
    gsPrism('pentagonal prism', 5),
    gsPrism('hexagonal prism', 6),
    gsCuboid('cuboid', 1.35, 0.8, 0.62),

    // Swept round an axis.
    gsFrustum('cone', 12, 0),
    gsFrustum('cylinder', 12, 1),
    gsFrustum('frustum', 12, 0.52),
    gsGlobe('sphere', 4, 8),
    gsGlobe('ellipsoid', 4, 8, 1.45),
    gsGlobe('hemisphere', 3, 8, 1, 0.5),
    gsTorus('torus', 0.72, 0.3, 8, 5),

    // Corners cut off — the Archimedean half of the uniform polyhedra sheet.
    gsTruncate('truncated tetrahedron', tetra),
    gsTruncate('truncated cube', cube),
    gsTruncate('truncated octahedron', octa),
    gsTruncate('truncated dodecahedron', dodeca),
    gsTruncate('truncated icosahedron', icosa),
    gsRectify('cuboctahedron', cube),
    gsRectify('icosidodecahedron', dodeca),

    // Spiked — the star half of that sheet.
    gsSpiked('spiked tetrahedron', tetra, 0.85),
    gsSpiked('spiked cube', cube, 0.7),
    gsSpiked('spiked octahedron', octa, 0.9),
    gsSpiked('spiked dodecahedron', dodeca, 0.75),
    gsSpiked('spiked icosahedron', icosa, 0.8),

    // The simplex projections.
    gsSimplex('simplex 5', 5),
    gsSimplex('simplex 7', 7),
    gsSimplex('simplex 9', 9),
  ];
  list.sort((a, b) => a.lines - b.lines);
  return list;
})();

/// Where the catalogue is cut, by how much wire a grain can afford.
///
/// A grain eight pixels across cannot show the difference between a
/// dodecahedron and an icosahedron, and drawing thirty edges to prove it costs
/// the same as thirty edges that could be seen. So the shape a grain gets is
/// drawn from the part of the catalogue its size can carry: the simple solids
/// are always in play, the intricate ones only turn up on grains with the
/// pixels to hold them.
///
/// It also bounds the cost. A room full of loud near grains is a room with few
/// of them in it; a room with thousands is a room of small ones, and small
/// means cheap.
const GRAIN_SHAPE_TIERS = (() => {
  const cut = (max) => {
    const n = GRAIN_SHAPES.filter((s) => s.lines <= max).length;
    return Math.max(3, n);
  };
  return [cut(12), cut(24), cut(48), GRAIN_SHAPES.length];
})();

/// Which tier a grain belongs in, from its level.
///
/// **From its level, which is fixed when it is born — and from nothing else.**
/// That restriction is the whole point of this function existing, so read the
/// note on `grainShapeFor` before widening it.
function grainDetailFor(level) {
  return Math.max(0, Math.min(3, Math.floor(level * 3.99)));
}

/// The shape for a grain, given its own hash and its tier.
///
/// Deterministic, like every other choice made about a grain in this program:
/// the picture, the playback and the exported file are three separate
/// evaluations of the same schedule, and a running generator would give each of
/// them a different answer. Same grain, same solid, every time.
///
/// **The tier must be a property of the grain's birth, never of its age.** The
/// tier is the *modulus* here, not a ceiling — so two tiers do not name the same
/// solid with more or less detail, they name different solids entirely. The
/// first version worked that out afresh every frame from how bright and how near
/// the grain was, and both of those fall as it travels: a grain left the front of
/// the room a pentagonal pyramid, became a truncated cube, a pentagonal prism,
/// and reached the back wall an octahedron. Nineteen hundred and ninety-one
/// hashes in two thousand name a different solid at a different tier, so this was
/// not an edge case — it was nearly every grain in the room, changing shape in
/// mid-air.
///
/// Call it once, when the grain is born, and keep what it hands back.
function grainShapeFor(hash, tier) {
  const cut = GRAIN_SHAPE_TIERS[Math.max(0, Math.min(3, tier | 0))];
  return GRAIN_SHAPES[hash % cut];
}

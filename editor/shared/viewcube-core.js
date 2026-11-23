// Shared by 3D Model Viewer and STEP Viewer 3D (canonical copy: plugins/_shared; do not edit the copies in editor/shared).
// The orientation cube (UX v3, E4): the geometry, free of the page. The cube has its OWN camera: a copy of the main camera's orientation (the three axes it looks along),
// it is drawn with a plain orthographic projection on a canvas of its own, and a click on a face names the view (the same six names as the View menu), so the cube never
// touches the main renderer, the selection or the measuring. It is drawn from a slightly tilted copy of the camera (CUBE_TILT) so that it never degenerates into one flat square;
// faces, edges and corners can be clicked (an edge or a corner looks from between two or three faces). View space: +Y is up, the front looks along -Z (a viewer puts the model's own "up" axis on +Y).

/** The six faces: name (= the view preset), outward normal, corners. */
export const FACES = [
  { name: 'top', n: [0, 1, 0], pts: [[-1, 1, -1], [1, 1, -1], [1, 1, 1], [-1, 1, 1]] },
  { name: 'bottom', n: [0, -1, 0], pts: [[-1, -1, 1], [1, -1, 1], [1, -1, -1], [-1, -1, -1]] },
  { name: 'front', n: [0, 0, 1], pts: [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]] },
  { name: 'back', n: [0, 0, -1], pts: [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]] },
  { name: 'right', n: [1, 0, 0], pts: [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]] },
  { name: 'left', n: [-1, 0, 0], pts: [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]] }
]
export const FACE_NAMES = FACES.map((f) => f.name)

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

/** A camera orientation from its world matrix elements (column-major, as three.js keeps them): right, up and back (from the target towards the camera). */
export function basisFromMatrix(e) {
  return { r: [e[0], e[1], e[2]], u: [e[4], e[5], e[6]], b: [e[8], e[9], e[10]] }
}

const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const rot = (v, k, a) => { // Rodrigues: v turned about the unit axis k by a
  const c = Math.cos(a)
  const s = Math.sin(a)
  const kv = cross(k, v)
  const d = dot(k, v) * (1 - c)
  return [v[0] * c + kv[0] * s + k[0] * d, v[1] * c + kv[1] * s + k[1] * d, v[2] * c + kv[2] * s + k[2] * d]
}

/** The cube is never seen exactly along an axis: its own camera is the main camera's orientation turned a little (to the right and from above), so that three faces, three edges and the
 *  corner between them are always there to point at, also in the plain front view (a straight-on cube would be one flat square). */
export const CUBE_TILT = { yaw: 0.6, pitch: -0.4 }
/** How much of the tilt the cube needs: all of it when the camera looks along an axis (one face, a flat square), none when it already sees three faces well (the smallest of the three
 *  components of the viewing direction is 0.35 or more), and smoothly in between, so that the cube does not jump and shows the real direction wherever it can. */
export function tiltWeight(basis, enough = 0.35) {
  const m = Math.min(...basis.b.map(Math.abs))
  const x = Math.max(0, Math.min(1, 1 - m / enough))
  return x * x * (3 - 2 * x) // smoothstep
}
export function tiltBasis(basis, { yaw, pitch } = CUBE_TILT, weight = 1) {
  yaw *= weight
  pitch *= weight
  const r1 = rot(basis.r, basis.u, yaw)
  const b1 = rot(basis.b, basis.u, yaw)
  return { r: r1, u: rot(basis.u, r1, pitch), b: rot(b1, r1, pitch) }
}

const VERTS = [-1, 1].flatMap((x) => [-1, 1].flatMap((y) => [-1, 1].map((z) => [x, y, z])))
const EDGES = [] // pairs of corners that differ in one coordinate
for (let i = 0; i < 8; i++) for (let j = i + 1; j < 8; j++) if (VERTS[i].filter((c, k) => c !== VERTS[j][k]).length === 1) EDGES.push([i, j])
const normalize = (v) => { const l = Math.hypot(...v); return v.map((c) => c / l) }
const nameFor = (v) => {
  const parts = []
  if (v[1]) parts.push(v[1] > 0 ? 'top' : 'bottom')
  if (v[2]) parts.push(v[2] > 0 ? 'front' : 'back')
  if (v[0]) parts.push(v[0] > 0 ? 'right' : 'left')
  return parts.join('-')
}

/**
 * What the cube shows and what can be pointed at, for the camera's orientation, on a square canvas of `size` pixels (drawn with the tilt of CUBE_TILT):
 *   faces    the faces turned towards the cube's camera, far to near: [{ name, pts: [[x, y] x4], facing (1 = straight on), center: [x, y] }]
 *   edges    the edges of those faces: [{ name ('top-front'), dir (unit vector towards the eye), a: [x, y], b: [x, y] }]
 *   corners  the corners of those faces: [{ name ('top-front-right'), dir, p: [x, y] }]
 * `scale` = half the edge of the cube in pixels (default 0.27 of the canvas: the tilted corners stay inside it).
 */
export function projectAll(basis, size, scale = size * 0.27) {
  const bs = tiltBasis(basis, CUBE_TILT, tiltWeight(basis))
  const c = size / 2
  const p2 = (p) => [c + dot(p, bs.r) * scale, c - dot(p, bs.u) * scale]
  const faces = FACES.map((f) => ({ name: f.name, facing: dot(f.n, bs.b), pts: f.pts.map(p2), center: p2(f.n) }))
    .filter((f) => f.facing > 0.02)
    .sort((a, b) => a.facing - b.facing)
  const seen = new Set(faces.map((f) => f.name))
  const vis = (v) => FACES.some((f) => seen.has(f.name) && dot(f.n, v) > 0) // a corner or an edge belongs to a face that is seen
  const edges = EDGES.filter(([i, j]) => vis(VERTS[i]) && vis(VERTS[j]) && FACES.some((f) => seen.has(f.name) && dot(f.n, VERTS[i]) > 0 && dot(f.n, VERTS[j]) > 0)).map(([i, j]) => {
    const dir = normalize(VERTS[i].map((x, k) => (x === VERTS[j][k] ? x : 0)))
    return { name: nameFor(dir), dir, a: p2(VERTS[i]), b: p2(VERTS[j]) }
  })
  const corners = VERTS.filter(vis).map((v) => ({ name: nameFor(v), dir: normalize(v), p: p2(v) }))
  return { faces, edges, corners }
}

/** The faces only (see projectAll). */
export const projectCube = (basis, size, scale) => projectAll(basis, size, scale).faces

const distToSegment = (x, y, a, b) => {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const l2 = dx * dx + dy * dy
  const t = l2 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l2)) : 0
  return Math.hypot(x - (a[0] + t * dx), y - (a[1] + t * dy))
}

/**
 * What is at the point (x, y): a corner (within `cornerPx`), else an edge (within `edgePx`), else a face (the nearest one if faces overlap), else null.
 * Returns { kind: 'corner' | 'edge' | 'face', name, dir (unit vector from the model towards where the camera goes) }.
 */
export function hitTarget(all, x, y, { cornerPx = 6, edgePx = 4 } = {}) {
  let best = null
  for (const c of all.corners) {
    const d = Math.hypot(x - c.p[0], y - c.p[1])
    if (d <= cornerPx && (!best || d < best.d)) best = { d, kind: 'corner', name: c.name, dir: c.dir }
  }
  if (best) return { kind: best.kind, name: best.name, dir: best.dir }
  for (const e of all.edges) {
    const d = distToSegment(x, y, e.a, e.b)
    if (d <= edgePx && (!best || d < best.d)) best = { d, kind: 'edge', name: e.name, dir: e.dir }
  }
  if (best) return { kind: best.kind, name: best.name, dir: best.dir }
  const f = hitFace(all.faces, x, y)
  return f ? { kind: 'face', name: f, dir: FACES.find((o) => o.name === f).n } : null
}

/** The name of the face at the point (x, y) (the nearest one if faces overlap), or null. `faces` = projectCube(...). */
export function hitFace(faces, x, y) {
  for (let i = faces.length - 1; i >= 0; i--) if (inPolygon(faces[i].pts, x, y)) return faces[i].name
  return null
}

function inPolygon(pts, x, y) {
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i]
    const [xj, yj] = pts[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Whether two orientations differ (so that the cube is drawn again only when the camera turned). */
export function basisChanged(a, b, eps = 1e-6) {
  if (!a || !b) return true
  for (const k of ['r', 'u', 'b']) for (let i = 0; i < 3; i++) if (Math.abs(a[k][i] - b[k][i]) > eps) return true
  return false
}

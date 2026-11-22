// Shared by 3D Model Viewer and STEP Viewer 3D (canonical copy: plugins/_shared; do not edit the copies in editor/shared).
// The numbers of the part card, as pure functions (no DOM, no three.js): boxes in the model's space, the pieces of a matrix, sums over
// several parts, the distance between two parts. Matrices are column-major arrays of 16 numbers (three.js `Matrix4.elements`).

/** The axis-parallel box of a local box { min: [x, y, z], max: [x, y, z] } after the matrix (all eight corners). */
export function transformBox(box, m) {
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < 8; i++) {
    const x = i & 1 ? box.max[0] : box.min[0]
    const y = i & 2 ? box.max[1] : box.min[1]
    const z = i & 4 ? box.max[2] : box.min[2]
    const w = m[3] * x + m[7] * y + m[11] * z + m[15] || 1
    const p = [(m[0] * x + m[4] * y + m[8] * z + m[12]) / w, (m[1] * x + m[5] * y + m[9] * z + m[13]) / w, (m[2] * x + m[6] * y + m[10] * z + m[14]) / w]
    for (let k = 0; k < 3; k++) {
      if (p[k] < min[k]) min[k] = p[k]
      if (p[k] > max[k]) max[k] = p[k]
    }
  }
  return { min, max }
}

/** Whether the matrix only turns by multiples of 90 degrees and scales/moves (every column has one non-zero component): then the box of the corners is exact. */
export function isAxisAligned(m, eps = 1e-9) {
  for (const c of [0, 4, 8]) {
    const nz = [m[c], m[c + 1], m[c + 2]].filter((v) => Math.abs(v) > eps * (Math.abs(m[c]) + Math.abs(m[c + 1]) + Math.abs(m[c + 2]) || 1)).length
    if (nz !== 1) return false
  }
  return true
}

/** The exact axis-parallel box of the vertices (positions: x y z, three numbers each) after the matrix. */
export function transformedVertexBox(positions, m) {
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i + 2 < positions.length; i += 3) {
    const x = positions[i]
    const y = positions[i + 1]
    const z = positions[i + 2]
    const w = m[3] * x + m[7] * y + m[11] * z + m[15] || 1
    const p0 = (m[0] * x + m[4] * y + m[8] * z + m[12]) / w
    const p1 = (m[1] * x + m[5] * y + m[9] * z + m[13]) / w
    const p2 = (m[2] * x + m[6] * y + m[10] * z + m[14]) / w
    if (p0 < min[0]) min[0] = p0
    if (p0 > max[0]) max[0] = p0
    if (p1 < min[1]) min[1] = p1
    if (p1 > max[1]) max[1] = p1
    if (p2 < min[2]) min[2] = p2
    if (p2 > max[2]) max[2] = p2
  }
  return { min, max }
}

export function unionBox(boxes) {
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (const b of boxes) {
    for (let k = 0; k < 3; k++) {
      if (b.min[k] < min[k]) min[k] = b.min[k]
      if (b.max[k] > max[k]) max[k] = b.max[k]
    }
  }
  return { min, max }
}
export const boxSize = (b) => [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]]
export const boxCenter = (b) => [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2]
export const vecDistance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

/**
 * The pieces of a matrix: { position, scale, rotation (degrees, XYZ order), mirrored, shear }. `shear` is true when the three axes are not at
 * right angles (then the rotation is not meaningful and the card says so instead of showing numbers).
 */
export function decompose(m) {
  const cx = [m[0], m[1], m[2]]
  const cy = [m[4], m[5], m[6]]
  const cz = [m[8], m[9], m[10]]
  const sx = Math.hypot(...cx)
  const sy = Math.hypot(...cy)
  const sz = Math.hypot(...cz)
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
  const tol = 1e-4 * Math.max(sx * sy, sx * sz, sy * sz, 1e-30)
  const shear = Math.abs(dot(cx, cy)) > tol || Math.abs(dot(cx, cz)) > tol || Math.abs(dot(cy, cz)) > tol
  const det = cx[0] * (cy[1] * cz[2] - cy[2] * cz[1]) - cy[0] * (cx[1] * cz[2] - cx[2] * cz[1]) + cz[0] * (cx[1] * cy[2] - cx[2] * cy[1])
  const mirrored = det < 0
  const kx = mirrored ? -1 : 1 // a mirror is put on the x scale, as three.js does
  const r = [
    [m[0] / (sx * kx || 1), m[4] / (sy || 1), m[8] / (sz || 1)],
    [m[1] / (sx * kx || 1), m[5] / (sy || 1), m[9] / (sz || 1)],
    [m[2] / (sx * kx || 1), m[6] / (sy || 1), m[10] / (sz || 1)]
  ]
  // Euler XYZ (three.js setFromRotationMatrix)
  const y = Math.asin(Math.max(-1, Math.min(1, r[0][2])))
  let x
  let z
  if (Math.abs(r[0][2]) < 0.9999999) {
    x = Math.atan2(-r[1][2], r[2][2])
    z = Math.atan2(-r[0][1], r[0][0])
  } else {
    x = Math.atan2(r[2][1], r[1][1])
    z = 0
  }
  const deg = (v) => Math.round(((v * 180) / Math.PI) * 1e6) / 1e6 + 0
  return { position: [m[12], m[13], m[14]], scale: [sx * kx, sy, sz], rotation: [deg(x), deg(y), deg(z)], mirrored, shear }
}

/** Whether a matrix is the identity (a part without a transform of its own: the card then leaves the position, rotation and scale rows out). */
export function isIdentity(m, eps = 1e-9) {
  for (let i = 0; i < 16; i++) if (Math.abs(m[i] - (i % 5 === 0 ? 1 : 0)) > eps) return false
  return true
}

/**
 * The always-cheap numbers of one or several parts. parts: [{ tris, verts, kind, box (model space) }], totalTris: triangles of the whole model.
 * Returns { count, dims, center, box, tris, share (0..1 of the triangles), kinds }.
 */
export function basicInfo(parts, totalTris) {
  const box = unionBox(parts.map((p) => p.box))
  const tris = parts.reduce((a, p) => a + (p.tris || 0), 0)
  return { count: parts.length, box, dims: boxSize(box), center: boxCenter(box), tris, share: totalTris > 0 ? tris / totalTris : 0, kinds: [...new Set(parts.map((p) => p.kind))] }
}

/**
 * Sums of the mesh check over several parts (results of analyzeMesh, in model units): area (sum), volume (sum, only when every part is closed),
 * watertight (all), boundary and non-manifold edges (sum).
 */
export function sumChecks(results) {
  let area = 0
  let volume = 0
  let allClosed = results.length > 0
  let watertight = results.length > 0
  let boundaryEdges = 0
  let nonManifoldEdges = 0
  let vertices = 0
  for (const r of results) {
    area += r.area || 0
    vertices += r.vertices || 0
    boundaryEdges += r.boundaryEdges || 0
    nonManifoldEdges += r.nonManifoldEdges || 0
    if (r.volume == null) allClosed = false
    else volume += r.volume
    if (!r.watertight) watertight = false
  }
  return { area, volume: allClosed ? volume : null, watertight, boundaryEdges, nonManifoldEdges, vertices }
}

// ---------- the distance between two parts ----------

/** Distance from point p to the triangle a b c (all [x, y, z]); the closest point lies on the face, an edge or a corner. */
export function pointTriangleDistance(p, a, b, c) {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
  const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
  const ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]]
  const d1 = ab[0] * ap[0] + ab[1] * ap[1] + ab[2] * ap[2]
  const d2 = ac[0] * ap[0] + ac[1] * ap[1] + ac[2] * ap[2]
  if (d1 <= 0 && d2 <= 0) return Math.hypot(ap[0], ap[1], ap[2])
  const bp = [p[0] - b[0], p[1] - b[1], p[2] - b[2]]
  const d3 = ab[0] * bp[0] + ab[1] * bp[1] + ab[2] * bp[2]
  const d4 = ac[0] * bp[0] + ac[1] * bp[1] + ac[2] * bp[2]
  if (d3 >= 0 && d4 <= d3) return Math.hypot(bp[0], bp[1], bp[2])
  const vc = d1 * d4 - d3 * d2
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3 || 1)
    return Math.hypot(p[0] - (a[0] + v * ab[0]), p[1] - (a[1] + v * ab[1]), p[2] - (a[2] + v * ab[2]))
  }
  const cp = [p[0] - c[0], p[1] - c[1], p[2] - c[2]]
  const d5 = ab[0] * cp[0] + ab[1] * cp[1] + ab[2] * cp[2]
  const d6 = ac[0] * cp[0] + ac[1] * cp[1] + ac[2] * cp[2]
  if (d6 >= 0 && d5 <= d6) return Math.hypot(cp[0], cp[1], cp[2])
  const vb = d5 * d2 - d1 * d6
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6 || 1)
    return Math.hypot(p[0] - (a[0] + w * ac[0]), p[1] - (a[1] + w * ac[1]), p[2] - (a[2] + w * ac[2]))
  }
  const va = d3 * d6 - d5 * d4
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6) || 1)
    return Math.hypot(p[0] - (b[0] + w * (c[0] - b[0])), p[1] - (b[1] + w * (c[1] - b[1])), p[2] - (b[2] + w * (c[2] - b[2])))
  }
  const denom = 1 / (va + vb + vc || 1)
  const v = vb * denom
  const w = vc * denom
  return Math.hypot(p[0] - (a[0] + ab[0] * v + ac[0] * w), p[1] - (a[1] + ab[1] * v + ac[1] * w), p[2] - (a[2] + ab[2] * v + ac[2] * w))
}

export const EXACT_PAIR_LIMIT = 4e7 // vertices x triangles: up to here every vertex is tried against every triangle of the other part

/**
 * The smallest distance between the surfaces of two meshes ({ positions: Float32Array, indices?: Uint32Array }, in the same space), from the
 * vertices of each against the triangles of the other (so an edge that crosses another edge is not found: the number is an upper bound, and 0
 * says "they touch or cross", it cannot tell the two apart). Above `exactLimit` pairs only a sample of the vertices is tried and
 * `approximate` is true. `progress(fraction)` and `isCancelled()` are optional.
 * Returns { distance, approximate }.
 */
export function minDistance(A, B, { exactLimit = EXACT_PAIR_LIMIT, progress, isCancelled } = {}) {
  const va = A.positions.length / 3
  const vb = B.positions.length / 3
  const ta = A.indices ? A.indices.length / 3 : Math.floor(va / 3)
  const tb = B.indices ? B.indices.length / 3 : Math.floor(vb / 3)
  if (!ta || !tb || !va || !vb) return { distance: null, approximate: false }
  const pairs = va * tb + vb * ta
  const exact = pairs <= exactLimit
  // a sample keeps the work near the limit: every k-th vertex
  const stepA = exact ? 1 : Math.max(1, Math.ceil(va / Math.max(1, Math.floor(exactLimit / 2 / tb))))
  const stepB = exact ? 1 : Math.max(1, Math.ceil(vb / Math.max(1, Math.floor(exactLimit / 2 / ta))))
  const tri = (M, t) => {
    const i = M.indices ? M.indices[3 * t] : 3 * t
    const j = M.indices ? M.indices[3 * t + 1] : 3 * t + 1
    const k = M.indices ? M.indices[3 * t + 2] : 3 * t + 2
    const P = M.positions
    return [[P[3 * i], P[3 * i + 1], P[3 * i + 2]], [P[3 * j], P[3 * j + 1], P[3 * j + 2]], [P[3 * k], P[3 * k + 1], P[3 * k + 2]]]
  }
  // the triangles of the other part are made once
  const trisOf = (M, n) => Array.from({ length: n }, (_, t) => tri(M, t))
  const TA = trisOf(A, ta)
  const TB = trisOf(B, tb)
  let best = Infinity
  const run = (V, step, T, offset, total) => {
    const n = V.positions.length / 3
    let counter = 0
    for (let i = 0; i < n; i += step) {
      if (isCancelled && (counter++ & 255) === 0 && isCancelled()) throw new Error('cancelled')
      const p = [V.positions[3 * i], V.positions[3 * i + 1], V.positions[3 * i + 2]]
      for (let t = 0; t < T.length; t++) {
        const d = pointTriangleDistance(p, T[t][0], T[t][1], T[t][2])
        if (d < best) {
          best = d
          if (best === 0) return
        }
      }
      if (progress && (counter & 63) === 0) progress(offset + (i / n) * total)
    }
  }
  run(A, stepA, TB, 0, 0.5)
  if (best > 0) run(B, stepB, TA, 0.5, 0.5)
  return { distance: best, approximate: !exact }
}

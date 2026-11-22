// The edges of a CAD part, from the triangles the converter made (no browser needed). A STEP part is a set of B-rep faces, and the converter
// says which triangles belong to which face (`faces: [{ first, last }]`, triangle numbers). The CAD edges are where two faces meet: an edge
// that two triangles of different faces share, or that only one triangle has (an open border). An edge between two triangles of the same face
// is only the triangulation and is left out; so a smooth fillet shows the lines where it joins its neighbours, which an angle threshold
// would miss, and a flat face shows no lines across it.
//
// The converter gives every face its own vertices (so that normals can differ), so triangles of neighbouring faces share no vertex indices:
// vertices are welded by position first (a grid of 1e-6 of the part's size), in a hash table of typed arrays.

/** Edges of one part as line segments: a Float32Array of x0 y0 z0 x1 y1 z1 per edge.
 *  `position` x y z per vertex, `index` three vertices per triangle, `faces` the triangle ranges of the B-rep faces (may be empty:
 *  then every triangle is its own face and the result is the whole wireframe, so callers should not ask without faces). */
export function brepEdges(position, index, faces) {
  const nv = position.length / 3
  const nt = Math.floor(index.length / 3)
  if (!nv || !nt) return new Float32Array(0)
  // ---- weld the vertices
  let lo = [Infinity, Infinity, Infinity]
  let hi = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < nv; i++) {
    for (let k = 0; k < 3; k++) {
      const v = position[i * 3 + k]
      if (v < lo[k]) lo[k] = v
      if (v > hi[k]) hi[k] = v
    }
  }
  const diag = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) || 1
  const cell = diag * 1e-6
  const q = new Int32Array(nv * 3)
  for (let i = 0; i < nv; i++) for (let k = 0; k < 3; k++) q[i * 3 + k] = Math.round((position[i * 3 + k] - lo[k]) / cell)
  const size = pow2(nv * 2)
  const table = new Int32Array(size).fill(-1) // slot -> first vertex with this position
  const mask = size - 1
  const weld = new Int32Array(nv)
  for (let i = 0; i < nv; i++) {
    let h = hash3(q[i * 3], q[i * 3 + 1], q[i * 3 + 2]) & mask
    for (;;) {
      const j = table[h]
      if (j < 0) {
        table[h] = i
        weld[i] = i
        break
      }
      if (q[j * 3] === q[i * 3] && q[j * 3 + 1] === q[i * 3 + 1] && q[j * 3 + 2] === q[i * 3 + 2]) {
        weld[i] = j
        break
      }
      h = (h + 1) & mask
    }
  }
  // ---- which face each triangle is in (-1: none named: all such triangles count as one face)
  const faceOf = new Int32Array(nt).fill(-1)
  ;(faces || []).forEach((f, id) => {
    for (let t = Math.max(0, f.first); t <= f.last && t < nt; t++) faceOf[t] = id
  })
  // ---- the edges: a hash table of (welded a, welded b) -> first face, first triangle corner, state
  const esize = pow2(nt * 3) // about 1.5 distinct edges per triangle in a closed surface: the table is at most half full
  const emask = esize - 1
  const ea = new Int32Array(esize).fill(-1)
  const eb = new Int32Array(esize)
  const eface = new Int32Array(esize)
  const ecorner = new Int32Array(esize) // triangle * 3 + corner of the first one that had the edge
  const estate = new Uint8Array(esize) // 0 seen once (a border), 1 seen again inside one face (the triangulation), 2 two different faces meet here (an edge)
  for (let t = 0; t < nt; t++) {
    const f = faceOf[t]
    for (let c = 0; c < 3; c++) {
      const a = weld[index[t * 3 + c]]
      const b = weld[index[t * 3 + ((c + 1) % 3)]]
      if (a === b) continue // a degenerate triangle
      const x = a < b ? a : b
      const y = a < b ? b : a
      let h = (Math.imul(x, 0x9e3779b1) ^ Math.imul(y, 0x85ebca6b)) & emask
      for (;;) {
        if (ea[h] < 0) {
          ea[h] = x
          eb[h] = y
          eface[h] = f
          ecorner[h] = t * 3 + c
          estate[h] = 0
          break
        }
        if (ea[h] === x && eb[h] === y) {
          if (f !== eface[h]) estate[h] = 2
          else if (estate[h] !== 2) estate[h] = 1
          break
        }
        h = (h + 1) & emask
      }
    }
  }
  // ---- the lines: edges between two faces and borders that only one triangle has
  let count = 0
  for (let h = 0; h < esize; h++) if (ea[h] >= 0 && (estate[h] === 0 || estate[h] === 2)) count++
  const out = new Float32Array(count * 6)
  let o = 0
  for (let h = 0; h < esize; h++) {
    if (ea[h] < 0 || (estate[h] !== 0 && estate[h] !== 2)) continue
    const tc = ecorner[h]
    const t = (tc / 3) | 0
    const c = tc - t * 3
    const v0 = index[t * 3 + c]
    const v1 = index[t * 3 + ((c + 1) % 3)]
    out[o++] = position[v0 * 3]
    out[o++] = position[v0 * 3 + 1]
    out[o++] = position[v0 * 3 + 2]
    out[o++] = position[v1 * 3]
    out[o++] = position[v1 * 3 + 1]
    out[o++] = position[v1 * 3 + 2]
  }
  return out
}

function pow2(n) {
  let s = 16
  while (s < n) s *= 2
  return s
}

function hash3(x, y, z) {
  let h = Math.imul(x, 0x9e3779b1) ^ Math.imul(y, 0x85ebca6b) ^ Math.imul(z, 0xc2b2ae35)
  h ^= h >>> 15
  h = Math.imul(h, 0x2c1b3c6d)
  return h ^ (h >>> 12)
}

// Shared by 3D Model Viewer and STEP Viewer 3D (canonical copy: plugins/_shared; do not edit the copies in editor/shared).
// Pure mesh algorithms of the Tools area: checking a mesh (holes, non-manifold edges), merging meshes, decimating a mesh.
// No DOM, no three.js; the simplifier (meshoptimizer) is passed in, so Node tests can run all of it.
import { weldExact } from './export.js'
import { weldVertices } from './glb-compress.js'

/**
 * Looks at a triangle mesh without changing it. Vertices with the same position count as one. Returns
 * { triangles, vertices, edges, boundaryEdges, nonManifoldEdges, flippedEdges, degenerate, holes, components, watertight, area, volume, inverted }:
 * boundaryEdges belong to one triangle only (holes), nonManifoldEdges to more than two, flippedEdges are shared by two triangles that
 * traverse them the same way (inconsistent orientation), holes are the loops the boundary edges form, volume is the enclosed volume
 * (only for a watertight mesh with consistent orientation, else null).
 */
export function analyzeMesh(positions, indices) {
  const n = Math.floor(positions.length / 3)
  // -0 and +0 are the same place (STL files write both): add 0 to turn -0 into 0
  const w = weldExact(Float32Array.from(positions.length === n * 3 ? positions : positions.subarray(0, n * 3), (v) => v + 0))
  const map = w.indices // vertex -> welded vertex
  const tri = indices ? indices.length / 3 | 0 : Math.floor(n / 3)
  const at = (t, k) => map[indices ? indices[3 * t + k] : 3 * t + k]
  const pos = w.positions
  let size = 16
  while (size < tri * 6) size *= 2
  const mask = size - 1
  const ku = new Uint32Array(size)
  const kv = new Uint32Array(size)
  const cnt = new Uint8Array(size)
  const fwd = new Uint8Array(size)
  let edges = 0
  let degenerate = 0
  let volume = 0
  let area = 0
  const parent = new Int32Array(w.positions.length / 3 + 1).map((_, i) => i)
  const find = (x) => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]]
      x = parent[x]
    }
    return x
  }
  const union = (a, b) => {
    a = find(a)
    b = find(b)
    if (a !== b) parent[a] = b
  }
  const used = new Uint8Array(w.positions.length / 3)
  const volAt = new Float64Array(used.length) // signed volume and area of each triangle, kept on its first vertex (summed per component later)
  const areaAt = new Float64Array(used.length)
  for (let t = 0; t < tri; t++) {
    const a = at(t, 0)
    const b = at(t, 1)
    const c = at(t, 2)
    if (!(a < used.length && b < used.length && c < used.length)) {
      degenerate++
      continue
    }
    const ax = pos[3 * a], ay = pos[3 * a + 1], az = pos[3 * a + 2]
    const bx = pos[3 * b], by = pos[3 * b + 1], bz = pos[3 * b + 2]
    const cx = pos[3 * c], cy = pos[3 * c + 1], cz = pos[3 * c + 2]
    const ux = bx - ax, uy = by - ay, uz = bz - az
    const vx = cx - ax, vy = cy - ay, vz = cz - az
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
    if (a === b || b === c || a === c || nx * nx + ny * ny + nz * nz === 0) {
      degenerate++
      continue
    }
    const ta = Math.sqrt(nx * nx + ny * ny + nz * nz) / 2
    const tv = (ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx)) / 6
    area += ta
    volume += tv
    areaAt[a] += ta
    volAt[a] += tv
    used[a] = used[b] = used[c] = 1
    union(a, b)
    union(b, c)
    for (let k = 0; k < 3; k++) {
      const p = k === 0 ? a : k === 1 ? b : c
      const q = k === 0 ? b : k === 1 ? c : a
      const u = p < q ? p : q
      const v = p < q ? q : p
      let h = (Math.imul(u, 0x9e3779b1) ^ Math.imul(v, 0x85ebca6b)) >>> 0
      h = (h ^ (h >>> 15)) & mask
      for (;;) {
        if (cnt[h] === 0) {
          ku[h] = u
          kv[h] = v
          edges++
        }
        if (cnt[h] === 0 || (ku[h] === u && kv[h] === v)) {
          if (cnt[h] < 255) cnt[h]++
          if (p < q) fwd[h]++
          break
        }
        h = (h + 1) & mask
      }
    }
  }
  let boundary = 0
  let nonManifold = 0
  let flipped = 0
  const loopParent = new Map()
  const lfind = (x) => {
    while (loopParent.get(x) !== x) {
      loopParent.set(x, loopParent.get(loopParent.get(x)))
      x = loopParent.get(x)
    }
    return x
  }
  for (let h = 0; h < size; h++) {
    if (cnt[h] === 0) continue
    if (cnt[h] === 1) {
      boundary++
      for (const v of [ku[h], kv[h]]) if (!loopParent.has(v)) loopParent.set(v, v)
      const a = lfind(ku[h])
      const b = lfind(kv[h])
      if (a !== b) loopParent.set(a, b)
    } else if (cnt[h] > 2) nonManifold++
    else if (fwd[h] !== 1) flipped++
  }
  const loops = new Set()
  for (const v of loopParent.keys()) loops.add(lfind(v))
  const roots = new Set()
  for (let v = 0; v < used.length; v++) if (used[v]) roots.add(find(v))
  const watertight = boundary === 0 && nonManifold === 0
  return {
    triangles: tri,
    vertices: used.reduce((a, b) => a + b, 0),
    edges,
    boundaryEdges: boundary,
    nonManifoldEdges: nonManifold,
    flippedEdges: flipped,
    degenerate,
    holes: loops.size,
    components: roots.size,
    watertight,
    area,
    volume: watertight && flipped === 0 ? Math.abs(volume) : null,
    // a closed, consistently oriented mesh whose normals point inward (turned inside out); a cavity inside another shell points inward on purpose
    inverted: watertight && flipped === 0 && hasInvertedShell(w.positions, at, tri, find, used, volAt, areaAt)
  }
}

/** True when a shell has negative volume and is not a cavity of a positive shell (the point of one of its vertices lies in none of the positive shells). */
function hasInvertedShell(pos, at, tri, find, used, volAt, areaAt) {
  const vol = new Map()
  const area = new Map()
  for (let v = 0; v < used.length; v++) {
    if (!used[v]) continue
    const r = find(v)
    vol.set(r, (vol.get(r) || 0) + volAt[v])
    area.set(r, (area.get(r) || 0) + areaAt[v])
  }
  const negative = []
  const positive = new Set()
  for (const [r, v] of vol) {
    if (v < -1e-9 * Math.pow(area.get(r), 1.5)) negative.push(r)
    else positive.add(r)
  }
  if (!negative.length) return false
  if (!positive.size) return true
  // one probe vertex per negative shell, and the triangles of the positive shells for a ray along +x
  const probe = new Map(negative.map((r) => [r, -1]))
  for (let v = 0; v < used.length; v++) if (used[v]) {
    const r = find(v)
    if (probe.get(r) === -1) probe.set(r, v)
  }
  const tris = []
  for (let t = 0; t < tri; t++) {
    const a = at(t, 0)
    if (a < used.length && used[a] && positive.has(find(a))) tris.push(t)
  }
  // a ray in an arbitrary direction (so it does not run along a diagonal or an edge of an axis-aligned model), Moeller-Trumbore.
  // Everything that depends on the triangle only (corner, two edges, h = D x e2, 1/det) is worked out once, not once per probe.
  const D = [0.5773, 0.3719, 0.7262]
  let ext = 0
  for (let i = 0; i < pos.length; i++) ext = Math.max(ext, Math.abs(pos[i]))
  const eps = 1e-12 * Math.max(ext, 1e-30) ** 2 // relative to the model's size, so a model in metres with millimetre details still works
  const epsT = 1e-9 * Math.max(ext, 1e-30)
  const pre = new Float64Array(tris.length * 13) // a(3) e1(3) e2(3) h(3) 1/det
  let nPre = 0
  for (const t of tris) {
    const a = 3 * at(t, 0), b = 3 * at(t, 1), c = 3 * at(t, 2)
    const o = nPre * 13
    for (let k = 0; k < 3; k++) {
      pre[o + k] = pos[a + k]
      pre[o + 3 + k] = pos[b + k] - pos[a + k]
      pre[o + 6 + k] = pos[c + k] - pos[a + k]
    }
    pre[o + 9] = D[1] * pre[o + 8] - D[2] * pre[o + 7]
    pre[o + 10] = D[2] * pre[o + 6] - D[0] * pre[o + 8]
    pre[o + 11] = D[0] * pre[o + 7] - D[1] * pre[o + 6]
    const det = pre[o + 3] * pre[o + 9] + pre[o + 4] * pre[o + 10] + pre[o + 5] * pre[o + 11]
    if (Math.abs(det) < eps) continue
    pre[o + 12] = 1 / det
    nPre++
  }
  const inside = (px, py, pz) => {
    let crossings = 0
    for (let n = 0; n < nPre; n++) {
      const o = n * 13
      const sx = px - pre[o], sy = py - pre[o + 1], sz = pz - pre[o + 2]
      const inv = pre[o + 12]
      const u = (sx * pre[o + 9] + sy * pre[o + 10] + sz * pre[o + 11]) * inv
      if (u < 0 || u > 1) continue
      const qx = sy * pre[o + 5] - sz * pre[o + 4], qy = sz * pre[o + 3] - sx * pre[o + 5], qz = sx * pre[o + 4] - sy * pre[o + 3]
      const v = (D[0] * qx + D[1] * qy + D[2] * qz) * inv
      if (v < 0 || u + v > 1) continue
      if ((pre[o + 6] * qx + pre[o + 7] * qy + pre[o + 8] * qz) * inv > epsT) crossings++
    }
    return crossings % 2 === 1
  }
  let budget = Math.max(1, Math.floor(2e8 / Math.max(1, nPre))) // probes affordable; the rest are assumed to be cavities
  for (const [, v] of probe) {
    if (v < 0) continue
    if (budget-- <= 0) break
    if (!inside(pos[3 * v], pos[3 * v + 1], pos[3 * v + 2])) return true
  }
  return false
}

/**
 * Joins meshes into one. Each mesh: { positions, normals?, colors? (float rgb 0..1, 3 per vertex), indices? } in the same frame.
 * Normals and colors are kept only when every mesh has them (a missing color becomes `fill`).
 */
export function mergeMeshes(list, fill = [0.8, 0.8, 0.8]) {
  const nv = list.reduce((a, m) => a + m.positions.length / 3, 0)
  const ni = list.reduce((a, m) => a + (m.indices ? m.indices.length : m.positions.length / 3), 0)
  const hasN = list.every((m) => m.normals)
  const anyC = list.some((m) => m.colors)
  const positions = new Float32Array(nv * 3)
  const normals = hasN ? new Float32Array(nv * 3) : null
  const colors = anyC ? new Float32Array(nv * 3) : null
  const indices = new Uint32Array(ni)
  let vo = 0
  let io = 0
  for (const m of list) {
    const n = m.positions.length / 3
    positions.set(m.positions, vo * 3)
    if (normals) normals.set(m.normals, vo * 3)
    if (colors) {
      if (m.colors) colors.set(m.colors, vo * 3)
      else for (let i = 0; i < n; i++) colors.set(fill, (vo + i) * 3)
    }
    if (m.indices) for (let i = 0; i < m.indices.length; i++) indices[io + i] = m.indices[i] + vo
    else for (let i = 0; i < n; i++) indices[io + i] = vo + i
    vo += n
    io += m.indices ? m.indices.length : n
  }
  return { positions, normals, colors, indices }
}

const bytesOf = (a) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength)

/**
 * Simplifies a mesh to about `ratio` of its triangles. mesh: { attributes: { name: { array, itemSize } }, indices | null } with a
 * 'position' attribute. Vertices that are identical in every attribute are merged first (a soup could not be simplified), the
 * simplifier removes triangles up to `error` (relative, 0.01 = 1 % of the model's size; 1 = no limit) and then the unused vertices are dropped.
 * Returns { attributes, indices, stats: { trianglesIn, trianglesOut, verticesIn, verticesOut, error } }.
 */
/** Smooth vertex normals (area-weighted) for indexed triangles. */
export function vertexNormals(position, index) {
  const n = new Float32Array(position.length)
  for (let t = 0; t < index.length; t += 3) {
    const a = index[t] * 3
    const b = index[t + 1] * 3
    const c = index[t + 2] * 3
    const ux = position[b] - position[a]
    const uy = position[b + 1] - position[a + 1]
    const uz = position[b + 2] - position[a + 2]
    const vx = position[c] - position[a]
    const vy = position[c + 1] - position[a + 1]
    const vz = position[c + 2] - position[a + 2]
    const x = uy * vz - uz * vy // the cross product's length is twice the triangle's area: bigger triangles weigh more
    const y = uz * vx - ux * vz
    const z = ux * vy - uy * vx
    for (const o of [a, b, c]) {
      n[o] += x
      n[o + 1] += y
      n[o + 2] += z
    }
  }
  for (let i = 0; i < n.length; i += 3) {
    const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1
    n[i] /= l
    n[i + 1] /= l
    n[i + 2] /= l
  }
  return n
}

/** Face normals for a triangle soup (three vertices per triangle), written on all three corners. */
export function faceNormals(position) {
  const n = new Float32Array(position.length)
  for (let t = 0; t + 8 < position.length; t += 9) {
    const ux = position[t + 3] - position[t]
    const uy = position[t + 4] - position[t + 1]
    const uz = position[t + 5] - position[t + 2]
    const vx = position[t + 6] - position[t]
    const vy = position[t + 7] - position[t + 1]
    const vz = position[t + 8] - position[t + 2]
    let x = uy * vz - uz * vy
    let y = uz * vx - ux * vz
    let z = ux * vy - uy * vx
    const l = Math.hypot(x, y, z) || 1
    x /= l
    y /= l
    z /= l
    for (let k = 0; k < 9; k += 3) {
      n[t + k] = x
      n[t + k + 1] = y
      n[t + k + 2] = z
    }
  }
  return n
}

export function decimateMesh(mesh, { ratio = 0.5, error = 0.05, lockBorder = false }, simplifier) {
  const pos = mesh.attributes.position
  const count = pos.array.length / 3
  const idxIn = mesh.indices ? Uint32Array.from(mesh.indices) : Uint32Array.from({ length: count }, (_, i) => i)
  const names = Object.keys(mesh.attributes)
  const streams = names.map((name) => ({ name, bytes: bytesOf(mesh.attributes[name].array), stride: mesh.attributes[name].itemSize * mesh.attributes[name].array.BYTES_PER_ELEMENT }))
  let w = weldVertices(streams, count, idxIn)
  // An STL or OBJ is a triangle soup with a normal per triangle corner, so no two corners are equal in every attribute and the "mesh" stays a soup
  // (3 vertices per triangle; a closed surface has about 0.5). Then the corners are welded by everything but the normals, and the result is a soup
  // again with a normal per triangle: the file was flat shaded and stays so. A mesh that is indexed (a hard-edged cube with split normals among them)
  // keeps its vertices and normals as they are.
  let soup = false
  if (!mesh.indices && names.includes('normal') && w.keep.length > 1.2 * (idxIn.length / 3)) {
    w = weldVertices(streams.filter((s) => s.name !== 'normal'), count, idxIn)
    soup = true
  }
  const gather = (s, keep) => {
    const out = new Uint8Array(keep.length * s.stride)
    for (let i = 0; i < keep.length; i++) out.set(s.bytes.subarray(keep[i] * s.stride, keep[i] * s.stride + s.stride), i * s.stride)
    return out
  }
  const welded = Object.fromEntries(streams.map((s) => [s.name, gather(s, w.keep)]))
  const wpos = new Float32Array(welded.position.buffer, 0, w.keep.length * 3)
  const target = Math.max(3, Math.floor((w.indices.length * ratio) / 3) * 3)
  const [out, err] = simplifier.simplify(w.indices, wpos, 3, target, error, lockBorder ? ['LockBorder'] : [])
  const idx = Uint32Array.from(out)
  const [remap, unique] = simplifier.compactMesh(idx) // idx is renumbered in place; remap[old] = new
  const attributes = {}
  for (const s of streams) {
    const a = mesh.attributes[s.name]
    const src = welded[s.name]
    const dst = new Uint8Array(unique * s.stride)
    for (let i = 0; i < remap.length; i++) if (remap[i] !== 0xffffffff) dst.set(src.subarray(i * s.stride, i * s.stride + s.stride), remap[i] * s.stride)
    attributes[s.name] = { array: new a.array.constructor(dst.buffer), itemSize: a.itemSize, normalized: a.normalized }
  }
  if (soup) {
    // back to a soup: three own vertices per triangle, the face normal on each (the file was flat shaded)
    const n = idx.length
    const outAttrs = {}
    for (const st of streams) {
      const a = attributes[st.name]
      const src = new Uint8Array(a.array.buffer, a.array.byteOffset, a.array.byteLength)
      const dst = new Uint8Array(n * st.stride)
      for (let i = 0; i < n; i++) dst.set(src.subarray(idx[i] * st.stride, idx[i] * st.stride + st.stride), i * st.stride)
      outAttrs[st.name] = { array: new a.array.constructor(dst.buffer), itemSize: a.itemSize, normalized: a.normalized }
    }
    if (outAttrs.normal) outAttrs.normal.array = faceNormals(outAttrs.position.array)
    const seq = Uint32Array.from({ length: n }, (_, i) => i)
    return { attributes: outAttrs, indices: seq, stats: { trianglesIn: idxIn.length / 3, trianglesOut: n / 3, verticesIn: count, verticesOut: n, error: err, soup: true } }
  }
  return { attributes, indices: idx, stats: { trianglesIn: idxIn.length / 3, trianglesOut: idx.length / 3, verticesIn: count, verticesOut: unique, error: err, soup: false } }
}

// Tests for the mesh checks, merge and decimation (editor/shared/mesh-tools.js). Same file in both plugins.
import test from 'node:test'
import assert from 'node:assert/strict'
import { analyzeMesh, decimateMesh, mergeMeshes } from '../editor/shared/mesh-tools.js'
import { MeshoptSimplifier } from '../editor/vendor/meshopt/meshopt_simplifier.js'

await MeshoptSimplifier.ready

const cubePos = [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1]
const cubeIdx = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 2, 3, 7, 2, 7, 6, 1, 2, 6, 1, 6, 5, 3, 0, 4, 3, 4, 7]
const sphere = (nu, nv) => {
  const pos = []
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
    const t = (Math.PI * j) / nv
    const p = (2 * Math.PI * i) / nu
    pos.push(Math.sin(t) * Math.cos(p), Math.cos(t), Math.sin(t) * Math.sin(p))
  }
  const idx = []
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const a = j * (nu + 1) + i
    const b = a + nu + 1
    idx.push(a, a + 1, b, a + 1, b + 1, b)
  }
  return { positions: Float32Array.from(pos), indices: Uint32Array.from(idx) }
}

test('a closed cube is watertight with volume 1; unshared vertices (soup) give the same answer', () => {
  const a = analyzeMesh(Float32Array.from(cubePos), Uint32Array.from(cubeIdx))
  assert.deepEqual([a.triangles, a.vertices, a.edges, a.boundaryEdges, a.nonManifoldEdges, a.holes, a.components, a.watertight], [12, 8, 18, 0, 0, 0, 1, true])
  assert.ok(Math.abs(a.volume - 1) < 1e-9)
  const soup = new Float32Array(36 * 3)
  cubeIdx.forEach((v, i) => soup.set(cubePos.slice(3 * v, 3 * v + 3), 3 * i))
  const b = analyzeMesh(soup, null)
  assert.deepEqual([b.triangles, b.vertices, b.edges, b.watertight], [12, 8, 18, true])
})

test('a missing triangle is one hole with three boundary edges', () => {
  const a = analyzeMesh(Float32Array.from(cubePos), Uint32Array.from(cubeIdx.slice(3)))
  assert.deepEqual([a.boundaryEdges, a.holes, a.watertight, a.volume], [3, 1, false, null])
})

test('three triangles on one edge are non-manifold; a flipped triangle is inconsistent; slivers are counted', () => {
  const pos = Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1])
  const nm = analyzeMesh(pos, Uint32Array.from([0, 1, 2, 1, 0, 3, 0, 1, 4]))
  assert.equal(nm.nonManifoldEdges, 1)
  const flipped = analyzeMesh(pos, Uint32Array.from([0, 1, 2, 0, 1, 3])) // both triangles run along 0->1
  assert.equal(flipped.flippedEdges, 1)
  const sliver = analyzeMesh(pos, Uint32Array.from([0, 1, 2, 0, 0, 1, 2, 2, 2]))
  assert.equal(sliver.degenerate, 2)
})

test('two separate boxes are two components and two holes are counted separately', () => {
  const pos = [...cubePos, ...cubePos.map((v, i) => (i % 3 === 0 ? v + 5 : v))]
  const idx = [...cubeIdx, ...cubeIdx.map((v) => v + 8)]
  assert.equal(analyzeMesh(Float32Array.from(pos), Uint32Array.from(idx)).components, 2)
  const open = [...cubeIdx.slice(3), ...cubeIdx.slice(0, 33).map((v) => v + 8)]
  const r = analyzeMesh(Float32Array.from(pos), Uint32Array.from(open))
  assert.equal(r.holes, 2)
})

test('merge: indices are shifted, colors are kept only where given (filled otherwise), normals only when all have them', () => {
  const a = { positions: Float32Array.from(cubePos), indices: Uint32Array.from(cubeIdx), colors: new Float32Array(24).fill(1) }
  const b = { positions: Float32Array.from(cubePos), indices: Uint32Array.from(cubeIdx) }
  const m = mergeMeshes([a, b], [0.5, 0.5, 0.5])
  assert.equal(m.positions.length, 48)
  assert.equal(m.indices.length, 72)
  assert.equal(m.indices[36], 8)
  assert.equal(m.colors[24], 0.5)
  assert.equal(m.normals, null)
  assert.equal(mergeMeshes([{ positions: Float32Array.from(cubePos), normals: Float32Array.from(cubePos) }]).indices.length, 8)
})

test('decimate: about the wanted share of triangles, a smaller vertex set, attributes follow their vertices', () => {
  const s = sphere(64, 32)
  const n = s.positions.length / 3
  const colors = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) colors.set([s.positions[3 * i] * 0.5 + 0.5, s.positions[3 * i + 1] * 0.5 + 0.5, 0.2], 3 * i)
  const r = decimateMesh({ attributes: { position: { array: s.positions, itemSize: 3 }, color: { array: colors, itemSize: 3 } }, indices: s.indices }, { ratio: 0.25, error: 1 }, MeshoptSimplifier)
  const tris = r.stats.trianglesOut
  assert.ok(tris <= (s.indices.length / 3) * 0.3 && tris >= (s.indices.length / 3) * 0.15, `${r.stats.trianglesIn} -> ${tris}`)
  assert.ok(r.stats.verticesOut < n / 2)
  assert.equal(r.attributes.position.array.length, r.stats.verticesOut * 3)
  assert.equal(r.attributes.color.array.length, r.stats.verticesOut * 3)
  // a vertex still has its own color: color_x = x * 0.5 + 0.5
  for (let i = 0; i < r.stats.verticesOut; i += 7) assert.ok(Math.abs(r.attributes.color.array[3 * i] - (r.attributes.position.array[3 * i] * 0.5 + 0.5)) < 1e-6)
  for (const v of r.indices) assert.ok(v < r.stats.verticesOut)
  // the sphere stays a sphere: all vertices are still on the unit sphere
  for (let i = 0; i < r.stats.verticesOut; i++) assert.ok(Math.abs(Math.hypot(r.attributes.position.array[3 * i], r.attributes.position.array[3 * i + 1], r.attributes.position.array[3 * i + 2]) - 1) < 1e-4)
})

test('decimate: a triangle soup is welded first; an error limit can stop early; the border can be locked', () => {
  const s = sphere(40, 20)
  const soup = new Float32Array(s.indices.length * 3)
  s.indices.forEach((v, i) => soup.set(s.positions.subarray(3 * v, 3 * v + 3), 3 * i))
  const full = decimateMesh({ attributes: { position: { array: soup, itemSize: 3 } }, indices: null }, { ratio: 0.5, error: 1 }, MeshoptSimplifier)
  assert.ok(full.stats.verticesIn === soup.length / 3)
  assert.ok(full.stats.trianglesOut < s.indices.length / 3 * 0.6)
  const careful = decimateMesh({ attributes: { position: { array: s.positions, itemSize: 3 } }, indices: s.indices }, { ratio: 0.05, error: 0.0001 }, MeshoptSimplifier)
  assert.ok(careful.stats.trianglesOut > s.indices.length / 3 * 0.05 * 1.5, 'a tiny error limit keeps more than asked')
  const open = Uint32Array.from(s.indices.slice(0, s.indices.length / 2)) // a half sphere has a border
  const locked = decimateMesh({ attributes: { position: { array: s.positions, itemSize: 3 } }, indices: open }, { ratio: 0.3, error: 1, lockBorder: true }, MeshoptSimplifier)
  assert.ok(locked.stats.trianglesOut >= 3)
})

test('surface area: a unit cube has 6, a sphere is close to 4 pi r^2', () => {
  const a = analyzeMesh(Float32Array.from(cubePos), Uint32Array.from(cubeIdx))
  assert.ok(Math.abs(a.area - 6) < 1e-9)
  const s = sphere(96, 48)
  const b = analyzeMesh(s.positions, s.indices)
  assert.ok(Math.abs(b.area - 4 * Math.PI) / (4 * Math.PI) < 0.01, `${b.area}`)
})

test('decimate: an STL-style soup with a normal per corner (nothing equal in every attribute) is reduced like an indexed mesh and stays flat shaded', () => {
  const s = sphere(64, 32)
  const tris = s.indices.length / 3
  const pos = new Float32Array(s.indices.length * 3)
  const nor = new Float32Array(s.indices.length * 3)
  for (let t = 0; t < tris; t++) {
    const a = [0, 1, 2].map((k) => s.positions.subarray(3 * s.indices[3 * t + k], 3 * s.indices[3 * t + k] + 3))
    const u = a[1].map((v, i) => v - a[0][i])
    const w = a[2].map((v, i) => v - a[0][i])
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]]
    const l = Math.hypot(...n) || 1
    for (let k = 0; k < 3; k++) {
      pos.set(a[k], 9 * t + 3 * k)
      nor.set(n.map((v) => v / l), 9 * t + 3 * k) // the face normal on all three corners, as an STL file has it
    }
  }
  const r = decimateMesh({ attributes: { position: { array: pos, itemSize: 3 }, normal: { array: nor, itemSize: 3 } }, indices: null }, { ratio: 0.5, error: 1 }, MeshoptSimplifier)
  assert.ok(r.stats.trianglesOut <= tris * 0.55, `${r.stats.trianglesIn} -> ${r.stats.trianglesOut}`)
  assert.ok(r.stats.soup)
  assert.equal(r.attributes.position.array.length, r.stats.trianglesOut * 9)
  assert.equal(r.attributes.normal.array.length, r.stats.trianglesOut * 9)
  // the normal of a corner is the normal of its triangle (flat shading, as the file had it)
  for (let t = 0; t < r.stats.trianglesOut; t += 11) {
    const P = r.attributes.position.array
    const u = [0, 1, 2].map((i) => P[9 * t + 3 + i] - P[9 * t + i])
    const w = [0, 1, 2].map((i) => P[9 * t + 6 + i] - P[9 * t + i])
    const c = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]]
    const l = Math.hypot(...c) || 1
    for (let k = 0; k < 3; k++) for (let i = 0; i < 3; i++) assert.ok(Math.abs(r.attributes.normal.array[9 * t + 3 * k + i] - c[i] / l) < 1e-4)
  }
  assert.deepEqual([...r.indices.slice(0, 6)], [0, 1, 2, 3, 4, 5])
})

test('decimate: an indexed mesh with split normals (a hard-edged cube) keeps its vertices and its normals when nothing is reduced', () => {
  const P = []
  const N = []
  const I = []
  const faces = [[[0, 0, 1], [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]]], [[0, 0, -1], [[0, 1, 0], [1, 1, 0], [1, 0, 0], [0, 0, 0]]], [[1, 0, 0], [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]]], [[-1, 0, 0], [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]]], [[0, 1, 0], [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]]], [[0, -1, 0], [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]]]]
  for (const [n, q] of faces) {
    const v0 = P.length / 3
    for (const p of q) {
      P.push(...p)
      N.push(...n)
    }
    I.push(v0, v0 + 1, v0 + 2, v0, v0 + 2, v0 + 3)
  }
  const r = decimateMesh({ attributes: { position: { array: Float32Array.from(P), itemSize: 3 }, normal: { array: Float32Array.from(N), itemSize: 3 } }, indices: Uint32Array.from(I) }, { ratio: 1, error: 1 }, MeshoptSimplifier)
  assert.equal(r.stats.soup, false)
  assert.equal(r.stats.verticesOut, 24)
  assert.equal(new Set(Array.from({ length: r.stats.verticesOut }, (_, i) => [...r.attributes.normal.array.subarray(3 * i, 3 * i + 3)].map((v) => v.toFixed(2)).join())).size, 6, 'six distinct normals: still hard edged')
})

test('a closed mesh turned inside out is told from a normal one: positive volume either way, but the normals point inward', () => {
  const cube = analyzeMesh(Float32Array.from(cubePos), Uint32Array.from(cubeIdx))
  assert.equal(cube.inverted, false)
  const inside = Uint32Array.from(cubeIdx)
  for (let i = 0; i < inside.length; i += 3) [inside[i + 1], inside[i + 2]] = [inside[i + 2], inside[i + 1]]
  const r = analyzeMesh(Float32Array.from(cubePos), inside)
  assert.equal(r.watertight, true)
  assert.ok(Math.abs(r.volume - cube.volume) < 1e-9)
  assert.equal(r.inverted, true)
  assert.equal(r.flippedEdges, 0)
})

// nested shells: a cube of the given side at an offset, optionally turned inside out
const cubeAt = (side, off, flip) => {
  const pos = Float32Array.from(cubePos, (v, i) => v * side + off[i % 3])
  const idx = Uint32Array.from(cubeIdx)
  if (flip) for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]]
  return { pos, idx }
}
const join = (...cs) => {
  let base = 0
  const pos = []
  const idx = []
  for (const c of cs) {
    pos.push(...c.pos)
    idx.push(...Array.from(c.idx, (i) => i + base))
    base += c.pos.length / 3
  }
  return analyzeMesh(Float32Array.from(pos), Uint32Array.from(idx))
}
test('nested shells: a cavity (inner shell pointing inward) is not "inside out"; an inverted shell next to a good one is', () => {
  const side = Math.max(...cubePos) - Math.min(...cubePos) || 1
  const hollow = join(cubeAt(10, [0, 0, 0], false), cubeAt(4, [3, 3, 3], true))
  assert.equal(hollow.watertight, true)
  assert.equal(hollow.components, 2)
  assert.equal(hollow.inverted, false, 'a hollow cube is fine')
  assert.ok(Math.abs(hollow.volume - (1000 - 64) * side ** 3) < 1e-6, `volume ${hollow.volume}`)
  assert.equal(join(cubeAt(10, [0, 0, 0], true), cubeAt(4, [3, 3, 3], false)).inverted, true, 'the whole hollow cube turned inside out')
  assert.equal(join(cubeAt(10, [0, 0, 0], false), cubeAt(2, [30, 0, 0], true)).inverted, true, 'a small inverted cube beside a good one used to hide in the total')
  assert.equal(join(cubeAt(10, [0, 0, 0], false), cubeAt(2, [30, 0, 0], false)).inverted, false)
  assert.equal(join(cubeAt(10, [0, 0, 0], false), cubeAt(2, [30, 0, 0], true), cubeAt(2, [3, 3, 3], true)).inverted, true, 'one cavity and one stray inverted shell')
})

test('values: sphere and torus give the textbook volume and area, in metres and in millimetres', () => {
  const near = (got, want, tol, what) => assert.ok(Math.abs(got - want) <= tol * want, `${what}: ${got} vs ${want}`)
  // UV sphere r = 1: V = 4/3 pi, A = 4 pi (the polyhedron is a little smaller: 96 x 48 segments stay within 0.2 %)
  const s = sphere(96, 48)
  const rs = analyzeMesh(s.positions, s.indices)
  near(rs.area, 4 * Math.PI, 0.002, 'sphere area')
  // torus R = 3, r = 1: V = 2 pi^2 R r^2, A = 4 pi^2 R r
  const nu = 96, nv = 48, R = 3, r = 1
  const P = []
  const I = []
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const u = (2 * Math.PI * i) / nu, v = (2 * Math.PI * j) / nv
    P.push((R + r * Math.cos(v)) * Math.cos(u), r * Math.sin(v), (R + r * Math.cos(v)) * Math.sin(u))
  }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const a = j * nu + i, b = j * nu + ((i + 1) % nu), c = ((j + 1) % nv) * nu + i, d = ((j + 1) % nv) * nu + ((i + 1) % nu)
    I.push(a, c, b, b, c, d)
  }
  const pos = Float32Array.from(P)
  const idx = Uint32Array.from(I)
  let t = analyzeMesh(pos, idx)
  if (t.inverted) { for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]]; t = analyzeMesh(pos, idx) }
  assert.equal(t.watertight, true)
  assert.equal(t.inverted, false)
  near(t.volume, 2 * Math.PI ** 2 * R * r * r, 0.006, 'torus volume')
  near(t.area, 4 * Math.PI ** 2 * R * r, 0.006, 'torus area')
  // the same torus in millimetres (positions x 1000): numbers scale by 1e9 and 1e6
  const mm = analyzeMesh(Float32Array.from(P, (v) => v * 1000), idx)
  near(mm.volume, t.volume * 1e9, 1e-6, 'volume in mm')
  near(mm.area, t.area * 1e6, 1e-6, 'area in mm')
})

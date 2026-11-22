import test from 'node:test'
import assert from 'node:assert/strict'
import { isAxisAligned, transformedVertexBox, transformBox, unionBox, boxSize, boxCenter, decompose, isIdentity, basicInfo, sumChecks, pointTriangleDistance, minDistance, vecDistance } from '../editor/shared/part-info.js'

const near = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) <= e, `${a} vs ${b}`)
const nearAll = (a, b, e = 1e-9) => a.forEach((v, i) => near(v, b[i], e))
const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
const translate = (x, y, z) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]
const scale = (x, y, z) => [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1]
const rotZ = (deg) => { const c = Math.cos((deg * Math.PI) / 180), s = Math.sin((deg * Math.PI) / 180); return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] }
const mul = (a, b) => { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return o }

test('a box in the model space: translated, scaled, and rotated (the box of a turned part is bigger than the part)', () => {
  const unit = { min: [0, 0, 0], max: [2, 4, 6] }
  assert.deepEqual(transformBox(unit, I), unit)
  assert.deepEqual(transformBox(unit, translate(10, 20, 30)), { min: [10, 20, 30], max: [12, 24, 36] })
  assert.deepEqual(boxSize(transformBox(unit, scale(2, 0.5, 1))), [4, 2, 6])
  const turned = transformBox({ min: [-1, -1, 0], max: [1, 1, 1] }, rotZ(45))
  near(boxSize(turned)[0], 2 * Math.SQRT2, 1e-9)
  near(boxSize(turned)[2], 1)
  // a +Z up file turned to Y up: the 6 tall axis becomes the height
  const zUp = [1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1]
  const t = transformBox(unit, zUp)
  nearAll(boxSize(t), [2, 6, 4])
})
test('union, size and centre of boxes', () => {
  const u = unionBox([{ min: [0, 0, 0], max: [1, 1, 1] }, { min: [2, -1, 0], max: [3, 0, 5] }])
  assert.deepEqual(u, { min: [0, -1, 0], max: [3, 1, 5] })
  assert.deepEqual(boxSize(u), [3, 2, 5])
  assert.deepEqual(boxCenter(u), [1.5, 0, 2.5])
  near(vecDistance([0, 0, 0], [3, 4, 12]), 13)
})
test('decompose: position, scale, rotation, mirror and shear; the identity is told apart', () => {
  const d = decompose(mul(translate(1, 2, 3), mul(rotZ(30), scale(2, 3, 4))))
  nearAll(d.position, [1, 2, 3])
  nearAll(d.scale, [2, 3, 4], 1e-9)
  nearAll(d.rotation, [0, 0, 30], 1e-6)
  assert.equal(d.mirrored, false)
  assert.equal(d.shear, false)
  const m = decompose(scale(-2, 1, 1))
  assert.equal(m.mirrored, true)
  near(Math.abs(m.scale[0]), 2)
  const shear = decompose([1, 0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
  assert.equal(shear.shear, true)
  assert.equal(isIdentity(I), true)
  assert.equal(isIdentity(translate(0, 0, 1e-3)), false)
})
test('basic info of one part and of several parts: size of the common box, summed triangles, share', () => {
  const a = { tris: 12, verts: 8, kind: 'mesh', box: { min: [0, 0, 0], max: [1, 1, 1] } }
  const b = { tris: 36, verts: 20, kind: 'mesh', box: { min: [3, 0, 0], max: [4, 2, 1] } }
  const one = basicInfo([a], 48)
  assert.deepEqual(one.dims, [1, 1, 1])
  near(one.share, 0.25)
  const two = basicInfo([a, b], 48)
  assert.deepEqual(two.dims, [4, 2, 1])
  assert.equal(two.tris, 48)
  near(two.share, 1)
  assert.deepEqual(two.center, [2, 1, 0.5])
})
test('sums of the mesh check: volume only when every part is closed, watertight only when all are', () => {
  const closed = { area: 6, volume: 1, watertight: true, vertices: 8, boundaryEdges: 0, nonManifoldEdges: 0 }
  const open = { area: 5, volume: null, watertight: false, vertices: 8, boundaryEdges: 4, nonManifoldEdges: 0 }
  assert.deepEqual(sumChecks([closed, closed]), { area: 12, volume: 2, watertight: true, boundaryEdges: 0, nonManifoldEdges: 0, vertices: 16 })
  const mixed = sumChecks([closed, open])
  assert.equal(mixed.volume, null)
  assert.equal(mixed.watertight, false)
  assert.equal(mixed.boundaryEdges, 4)
})
test('distance from a point to a triangle: face, edge and corner', () => {
  const a = [0, 0, 0], b = [1, 0, 0], c = [0, 1, 0]
  near(pointTriangleDistance([0.2, 0.2, 3], a, b, c), 3) // above the face
  near(pointTriangleDistance([0.5, -2, 0], a, b, c), 2) // below an edge
  near(pointTriangleDistance([-3, -4, 0], a, b, c), 5) // beyond a corner
  near(pointTriangleDistance([0.5, 0.5, 0], a, b, c), 0) // on the hypotenuse
  near(pointTriangleDistance([2, 2, 0], a, b, c), Math.hypot(1.5, 1.5), 1e-9) // nearest point (0.5, 0.5) on the long edge
})
const cube = (x, y, z, s = 1) => {
  const P = []
  for (const dx of [0, s]) for (const dy of [0, s]) for (const dz of [0, s]) P.push(x + dx, y + dy, z + dz)
  const idx = [0, 2, 1, 1, 2, 3, 4, 5, 6, 5, 7, 6, 0, 1, 4, 1, 5, 4, 2, 6, 3, 3, 6, 7, 0, 4, 2, 2, 4, 6, 1, 3, 5, 3, 7, 5]
  return { positions: Float32Array.from(P), indices: Uint32Array.from(idx) }
}
test('smallest distance between two parts: a gap, touching, and the sampled version says it is approximate', () => {
  near(minDistance(cube(0, 0, 0), cube(3, 0, 0)).distance, 2)
  near(minDistance(cube(0, 0, 0), cube(1, 0, 0)).distance, 0) // they touch
  near(minDistance(cube(0, 0, 0), cube(1.5, 1.5, 0)).distance, Math.hypot(0.5, 0.5), 1e-6)
  assert.equal(minDistance(cube(0, 0, 0), cube(3, 0, 0)).approximate, false)
  const sampled = minDistance(cube(0, 0, 0), cube(3, 0, 0), { exactLimit: 50 })
  assert.equal(sampled.approximate, true)
  assert.ok(sampled.distance >= 2 - 1e-9, 'a sample can only overestimate the distance')
  assert.equal(minDistance({ positions: new Float32Array(0) }, cube(0, 0, 0)).distance, null)
  assert.throws(() => minDistance(cube(0, 0, 0), cube(5, 0, 0), { isCancelled: () => true }), /cancelled/)
})

test('a turned part: the box of its vertices is smaller than the box of the corners of its local box', () => {
  // a thin diamond (a square turned 45 degrees in its own plane): the local box is 2 x 2, the part is only 1.414 wide when turned back
  const diamond = Float32Array.from([1, 0, 0, 0, 1, 0, -1, 0, 0, 0, -1, 0])
  const turn = rotZ(45)
  const corners = transformBox({ min: [-1, -1, 0], max: [1, 1, 0] }, turn)
  const exact = transformedVertexBox(diamond, turn)
  assert.ok(boxSize(exact)[0] < boxSize(corners)[0] - 0.5, `${boxSize(exact)[0]} vs ${boxSize(corners)[0]}`)
  near(boxSize(exact)[0], Math.SQRT2, 1e-6)
  assert.equal(isAxisAligned(I), true)
  assert.equal(isAxisAligned(rotZ(90)), true)
  assert.equal(isAxisAligned(rotZ(45)), false)
  assert.equal(isAxisAligned(scale(2, 3, 4)), true)
  assert.equal(isAxisAligned([1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 5, 6, 7, 1]), true)
})

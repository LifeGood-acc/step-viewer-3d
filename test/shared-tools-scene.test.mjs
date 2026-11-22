// Tests for the scene operations of the Tools area (editor/shared/tools-scene.js) with the vendored three.js, in Node (the worker tasks
// run on the test thread through the fallback of tools-run.js). Same file in both plugins.
import test from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'

const vendor = new URL('../editor/vendor/three.module.js', import.meta.url).href
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s, c, next) { if (s === 'three') return { url: ${JSON.stringify(vendor)}, shortCircuit: true }; return next(s, c) }`))
const THREE = await import(vendor)
const T = await import('../editor/shared/tools-scene.js')
const { collectParts } = await import('../editor/shared/export-three.js')

function box(w, h, d, color = 0xff0000) {
  const g = new THREE.BoxGeometry(w, h, d)
  return new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color }))
}
// a model viewer in miniature: modelRoot (the "Up is" rotation) > model > meshes; parts come from the scene graph
function viewer({ up = 'y', unit = { short: 'mm', label: 'mm' }, structure = true } = {}) {
  const modelRoot = new THREE.Group()
  const model = new THREE.Group()
  modelRoot.add(model)
  const v = { modelRoot, model, up, unit, parts: [], changes: 0, structure }
  const setUp = (u) => {
    v.up = u
    modelRoot.rotation.set(0, 0, 0)
    if (u === 'z') modelRoot.rotation.x = -Math.PI / 2
    else if (u === '-y') modelRoot.rotation.x = Math.PI
    modelRoot.updateMatrixWorld(true)
  }
  v.setUp = setUp
  setUp(up)
  v.rebuild = () => {
    const old = new Map(v.parts.map((p) => [p.obj, p.visible]))
    v.parts = []
    model.traverse((o) => o.isMesh && v.parts.push({ obj: o, kind: 'mesh', name: o.name, label: o.name, orig: o.material, visible: old.has(o) ? old.get(o) : true, verts: o.geometry.getAttribute('position').count, tris: (o.geometry.index ? o.geometry.index.count : o.geometry.getAttribute('position').count) / 3 }))
  }
  v.A = { modelRoot, structure, getModel: () => model, getParts: () => v.parts, getUnit: () => v.unit, setUnit: (u) => (v.unit = u), getUp: () => v.up, setUp, rebuildParts: v.rebuild, afterChange: () => v.changes++ }
  v.add = (m) => {
    model.add(m)
    v.rebuild()
    return m
  }
  return v
}
const near = (a, b, e = 1e-4) => assert.ok(Math.abs(a - b) <= e, `${a} vs ${b}`)
const bounds = (v) => T.boundsWorld(v.A)

test('origin: centre, floor and minimum corner work in the view\'s axes, also when the model is Z up', () => {
  const v = viewer({ up: 'z' })
  const m = box(2, 4, 6) // in the model's axes: 2 wide, 4 deep, 6 tall (z up)
  m.position.set(10, 20, 30)
  v.add(m)
  let b = bounds(v)
  near(b.max.y - b.min.y, 6) // the view's height is the model's z
  T.setOrigin(v.A, 'floor')
  b = bounds(v)
  near(b.min.y, 0)
  near((b.min.x + b.max.x) / 2, 0)
  near((b.min.z + b.max.z) / 2, 0)
  T.setOrigin(v.A, 'min')
  b = bounds(v)
  ;[b.min.x, b.min.y, b.min.z].forEach((x) => near(x, 0))
  T.setOrigin(v.A, 'center')
  b = bounds(v)
  ;[b.min.x + b.max.x, b.min.y + b.max.y, b.min.z + b.max.z].forEach((x) => near(x, 0))
  T.setOrigin(v.A, 'floor-only')
  near(bounds(v).min.y, 0)
  assert.equal(v.changes, 4)
})

test('scale and unit: conversion keeps the real size, assigning only renames, an unknown unit cannot convert', () => {
  const v = viewer({ unit: { short: 'mm', label: 'millimeters' } })
  v.add(box(100, 100, 100))
  assert.equal(T.convertUnit(v.A, 'm', 'meters'), true)
  near(bounds(v).max.x - bounds(v).min.x, 0.1)
  assert.equal(v.unit.short, 'm')
  assert.equal(T.convertUnit(v.A, 'in', 'inches'), true)
  near(bounds(v).max.x - bounds(v).min.x, 0.1 / 0.0254, 1e-3)
  const u = viewer({ unit: { short: 'units', label: 'unknown' } })
  u.add(box(10, 10, 10))
  assert.equal(T.convertUnit(u.A, 'm', 'meters'), false, 'an unknown unit cannot be converted')
  T.assignUnit(u.A, 'mm', 'millimeters (assigned)')
  near(bounds(u).max.x - bounds(u).min.x, 10)
  assert.equal(u.unit.short, 'mm')
  assert.equal(T.scaleBy(u.A, 0), false)
  assert.equal(T.scaleBy(u.A, 2.5), true)
  near(bounds(u).max.x - bounds(u).min.x, 25)
})

test('rotate keeps the centre, mirror flips without moving and exports with the winding kept', () => {
  const v = viewer()
  const m = box(2, 4, 6)
  m.position.set(5, 5, 5)
  v.add(m)
  const c0 = bounds(v).getCenter(new THREE.Vector3())
  T.rotate(v.A, 'z', 90)
  const b = bounds(v)
  near(b.max.x - b.min.x, 4)
  near(b.max.y - b.min.y, 2)
  near(b.getCenter(new THREE.Vector3()).distanceTo(c0), 0)
  T.mirror(v.A, 'x')
  near(bounds(v).getCenter(new THREE.Vector3()).distanceTo(c0), 0)
  assert.ok(v.model.matrix.determinant() < 0)
  // the export writes the mirrored model with outward normals and the winding swapped
  const { parts } = collectParts(v.parts, v.modelRoot, { withNormals: true })
  const p = parts[0]
  const P = (i) => new THREE.Vector3(p.positions[3 * i], p.positions[3 * i + 1], p.positions[3 * i + 2])
  for (let t = 0; t < p.indices.length; t += 3) {
    const [a, b2, c] = [0, 1, 2].map((k) => p.indices[t + k])
    const face = new THREE.Vector3().crossVectors(P(b2).sub(P(a)), P(c).sub(P(a)))
    assert.ok(face.dot(new THREE.Vector3(p.normals[3 * a], p.normals[3 * a + 1], p.normals[3 * a + 2])) > 0)
  }
})

test('bake "Up is": the model looks the same and the axis reads +Y afterwards', () => {
  const v = viewer({ up: 'z' })
  v.add(box(2, 4, 6))
  const before = bounds(v)
  assert.equal(T.bakeUp(v.A), true)
  assert.equal(v.up, 'y')
  const after = bounds(v)
  ;['x', 'y', 'z'].forEach((k) => {
    near(after.min[k], before.min[k])
    near(after.max[k], before.max[k])
  })
  assert.equal(T.bakeUp(v.A), false, 'nothing to do when it already is +Y')
})

test('remove and merge change the parts; reset brings everything back', () => {
  const v = viewer()
  const a = box(1, 1, 1, 0xff0000)
  const b = box(1, 1, 1, 0x00ff00)
  const c = box(1, 1, 1, 0x0000ff)
  a.name = 'A'
  b.name = 'B'
  c.name = 'C'
  b.position.x = 3
  c.position.x = 6
  for (const m of [a, b, c]) v.add(m)
  v.parts[2].visible = false
  assert.equal(T.removeParts(v.A, [v.parts[2]]), 1)
  assert.deepEqual(v.parts.map((p) => p.name), ['A', 'B'])
  assert.equal(T.mergeVisible(v.A), 2)
  assert.equal(v.parts.length, 1)
  assert.equal(v.parts[0].name, 'Merged')
  assert.equal(v.parts[0].tris, 24)
  const col = v.parts[0].obj.geometry.getAttribute('color')
  assert.equal(col.count, 48)
  // the merged mesh sits where the boxes were
  near(bounds(v).max.x, 3.5)
  near(bounds(v).min.x, -0.5)
  assert.deepEqual(T.changeList(v.A), ['remove:1', 'merge:2'])
  T.reset(v.A)
  assert.deepEqual(v.parts.map((p) => p.name), ['A', 'B', 'C'])
  assert.equal(T.hasChanges(v.A), false)
})

test('reset restores position, unit and up axis', () => {
  const v = viewer({ up: 'z', unit: { short: 'mm', label: 'mm' } })
  v.add(box(2, 4, 6))
  const b0 = bounds(v).clone()
  T.setOrigin(v.A, 'min')
  T.convertUnit(v.A, 'm', 'meters')
  T.bakeUp(v.A)
  T.reset(v.A)
  assert.equal(v.up, 'z')
  assert.equal(v.unit.short, 'mm')
  const b1 = bounds(v)
  ;['x', 'y', 'z'].forEach((k) => {
    near(b1.min[k], b0.min[k])
    near(b1.max[k], b0.max[k])
  })
})

test('structure tools do nothing when the viewer says its parts are an assembly tree', () => {
  const v = viewer({ structure: false })
  v.add(box(1, 1, 1))
  v.add(box(1, 1, 1))
  assert.equal(T.removeParts(v.A, [v.parts[0]]), 0)
  assert.equal(T.mergeVisible(v.A), 0)
  assert.equal(v.parts.length, 2)
})

test('decimate (in the page, without a worker) shrinks the meshes and reset restores them; analyze reports a closed box', async () => {
  const v = viewer()
  const s = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), new THREE.MeshStandardMaterial())
  s.name = 'Ball'
  v.add(s)
  const before = v.parts[0].tris
  const r = await T.decimate(v.A, { ratio: 0.25, error: 1, lockBorder: false })
  assert.equal(r.parts, 1)
  assert.ok(r.trianglesOut < before * 0.35 && r.trianglesOut > before * 0.15, `${before} -> ${r.trianglesOut}`)
  assert.equal(v.parts[0].tris, r.trianglesOut)
  assert.ok(v.parts[0].obj.geometry.getAttribute('normal'))
  T.reset(v.A)
  assert.equal(v.parts[0].obj.geometry.getAttribute('position').count > 1000, true)
  assert.equal(v.parts[0].tris, before)
  const w = viewer()
  w.add(box(2, 2, 2))
  const a = await T.analyze(w.A)
  assert.equal(a.total.watertight, true)
  assert.ok(Math.abs(a.total.volume - 8) < 1e-6, `volume ${a.total.volume}`)
  w.model.scale.set(2, 2, 2)
  w.model.updateMatrixWorld(true)
  const a2 = await T.analyze(w.A)
  assert.ok(Math.abs(a2.total.volume - 64) < 1e-6, `scaled volume ${a2.total.volume}`)
})

test('an interleaved mesh (gltfpack, meshopt) is decimated and checked like any other', async () => {
  const v = viewer()
  // positions and normals interleaved in one buffer: x y z nx ny nz per vertex
  const sph = new THREE.SphereGeometry(1, 48, 24)
  const n = sph.getAttribute('position').count
  const inter = new THREE.InterleavedBuffer(new Float32Array(n * 6), 6)
  for (let i = 0; i < n; i++) inter.array.set([sph.getAttribute('position').getX(i), sph.getAttribute('position').getY(i), sph.getAttribute('position').getZ(i), sph.getAttribute('normal').getX(i), sph.getAttribute('normal').getY(i), sph.getAttribute('normal').getZ(i)], i * 6)
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.InterleavedBufferAttribute(inter, 3, 0))
  g.setAttribute('normal', new THREE.InterleavedBufferAttribute(inter, 3, 3))
  g.setIndex(sph.index)
  v.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial()))
  const a = await T.analyze(v.A)
  assert.equal(a.total.triangles, sph.index.count / 3)
  assert.ok(a.total.holes <= 1 && a.total.components === 1, JSON.stringify(a.total)) // the UV seam of a three.js sphere is welded by position
  const before = v.parts[0].tris
  const r = await T.decimate(v.A, { ratio: 0.3, error: 1 })
  assert.equal(r.parts, 1)
  assert.ok(r.trianglesOut < before * 0.45, `${before} -> ${r.trianglesOut}`)
  assert.ok(v.parts[0].obj.geometry.getAttribute('normal').count === v.parts[0].verts)
})

test('reset does not bring back a merged mesh that was removed again; merging ignores textured, transparent and multi-material parts', () => {
  const v = viewer()
  for (const [i, c] of [0xff0000, 0x00ff00].entries()) {
    const m = box(1, 1, 1, c)
    m.position.x = i * 2
    v.add(m)
  }
  const glass = box(1, 1, 1)
  glass.material.transparent = true
  glass.material.opacity = 0.4
  glass.position.x = 6
  v.add(glass)
  assert.equal(T.mergeVisible(v.A), 2, 'the transparent part is left alone')
  assert.equal(v.parts.length, 2)
  const merged = v.parts.find((p) => p.name === 'Merged')
  T.removeParts(v.A, [merged])
  T.reset(v.A)
  assert.equal(v.parts.length, 3)
  assert.ok(!v.parts.some((p) => p.name === 'Merged'))
})

test('the mesh check treats -0 and +0 as the same place; quantized (Int16) and groups of several materials are handled', async () => {
  const soup = new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0].map((x) => x))
  const { analyzeMesh } = await import('../editor/shared/mesh-tools.js')
  // a tetrahedron soup where some zeros are written as -0
  const t = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]]
  const faces = [[0, 2, 1], [0, 1, 3], [0, 3, 2], [1, 2, 3]]
  const pos = new Float32Array(36)
  faces.forEach((f, i) => f.forEach((v, k) => pos.set(t[v].map((x, c) => (x === 0 && (i + k + c) % 2 ? -0 : x)), 9 * i + 3 * k)))
  const r = analyzeMesh(pos, null)
  assert.deepEqual([r.boundaryEdges, r.watertight], [0, true])
  assert.ok(soup.length)
  // Int16 positions (normalized) go through the tools as floats
  const v = viewer()
  const g = new THREE.BufferGeometry()
  const q = new Int16Array([0, 0, 0, 32767, 0, 0, 0, 32767, 0, 0, 0, 32767])
  g.setAttribute('position', new THREE.BufferAttribute(q, 3, true))
  g.setIndex([0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3])
  v.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial()))
  const a = await T.analyze(v.A)
  assert.equal(a.total.watertight, true)
  // a mesh with several materials is not decimated (its groups would be lost)
  const multi = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 8), [new THREE.MeshStandardMaterial(), new THREE.MeshStandardMaterial()])
  multi.geometry.addGroup(0, 90, 0)
  multi.geometry.addGroup(90, 1000, 1)
  const w = viewer()
  w.add(multi)
  const d = await T.decimate(w.A, { ratio: 0.5, error: 1 })
  assert.equal(d.parts, 0)
  assert.equal(d.skipped, 1)
})

test('analyze: area and volume under uneven scale, mirror and instances come out in the model\'s units', async () => {
  const run = async (build) => {
    const v = viewer()
    build(v)
    return (await T.analyze(v.A)).total
  }
  // a 1 x 1 x 1 cube stretched 2 x 3 x 5: volume 30, area 2 * (6 + 10 + 15) = 62
  const u = await run((v) => {
    const m = box(1, 1, 1)
    m.scale.set(2, 3, 5)
    v.add(m)
  })
  near(u.volume, 30, 1e-4)
  near(u.area, 62, 1e-4)
  assert.equal(u.inverted, false)
  // mirrored and stretched: the same numbers, and it is not "inside out"
  const mirr = await run((v) => {
    const m = box(1, 1, 1)
    m.scale.set(-2, 3, 5)
    v.add(m)
  })
  near(mirr.volume, 30, 1e-4)
  assert.equal(mirr.inverted, false)
  // 3 instances of a 2 mm cube, scales 1, 2 and 3: volume 8 * (1 + 8 + 27) = 288, area 24 * (1 + 4 + 9) = 336
  const inst = await run((v) => {
    const im = new THREE.InstancedMesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshStandardMaterial(), 3)
    for (let i = 0; i < 3; i++) im.setMatrixAt(i, new THREE.Matrix4().makeScale(i + 1, i + 1, i + 1).setPosition(i * 20, 0, 0))
    v.add(im)
  })
  near(inst.volume, 288, 1e-3)
  near(inst.area, 336, 1e-3)
})

test('forget frees the materials and textures of removed parts, but not those a remaining part still uses', () => {
  const v = viewer()
  const shared = new THREE.MeshStandardMaterial({ map: new THREE.Texture() })
  const own = new THREE.MeshStandardMaterial({ map: new THREE.Texture() })
  const keep = v.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), shared))
  v.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), shared))
  v.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), own))
  const freed = []
  v.A.disposeTexture = (tx) => freed.push(tx)
  let materialsDisposed = 0
  for (const m of [shared, own]) m.addEventListener('dispose', () => materialsDisposed++)
  T.removeParts(v.A, [v.parts[1], v.parts[2]])
  assert.ok(keep.parent)
  T.forget(v.A)
  assert.deepEqual(freed, [own.map])
  assert.equal(materialsDisposed, 1)
})

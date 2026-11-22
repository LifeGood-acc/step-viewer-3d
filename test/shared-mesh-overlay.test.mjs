// "Mesh over the surface" (editor/shared/mesh-overlay.js) with the vendored three.js, in Node. Same file in both plugins.
import test from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'

const vendor = new URL('../editor/vendor/three.module.js', import.meta.url).href
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s, c, next) { if (s === 'three') return { url: ${JSON.stringify(vendor)}, shortCircuit: true }; return next(s, c) }`))
const THREE = await import(vendor)
const { createMeshOverlay } = await import('../editor/shared/mesh-overlay.js')

function setup() {
  const helpers = new THREE.Group()
  const a = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial())
  const b = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial())
  const root = new THREE.Group()
  root.add(a, b)
  const meshes = [a, b]
  const ov = createMeshOverlay({ THREE, parent: helpers, getMeshes: () => meshes })
  const group = () => helpers.children.find((o) => o.name === 'mesh-over')
  return { helpers, a, b, root, meshes, ov, group }
}

test('off: nothing is drawn; on: one line object per mesh, sharing its geometry', () => {
  const { a, b, ov, group } = setup()
  ov.sync()
  assert.equal(group().visible, false)
  ov.set(true)
  assert.equal(group().visible, true)
  assert.equal(group().children.length, 2)
  assert.ok(group().children.every((o) => o.material.wireframe === true))
  assert.deepEqual(group().children.map((o) => o.geometry), [a.geometry, b.geometry], 'no copy of the points')
  ov.set(false)
  assert.equal(group().visible, false)
})
test('the lines follow the part: its matrix and its visibility (also a hidden parent)', () => {
  const { a, root, ov, group } = setup()
  ov.set(true)
  root.position.set(5, 0, 0)
  a.position.set(0, 3, 0)
  root.updateMatrixWorld(true)
  ov.sync()
  const o = group().children[0]
  assert.deepEqual([o.matrixWorld.elements[12], o.matrixWorld.elements[13]], [5, 3])
  a.visible = false
  ov.sync()
  assert.equal(group().children[0].visible, false)
  a.visible = true
  root.visible = false
  ov.sync()
  assert.ok(group().children.every((x) => x.visible === false), 'a hidden parent hides the lines')
})
test('suppressed (the mesh view itself) and removed parts leave nothing behind; dispose cleans the group', () => {
  const { meshes, helpers, ov, group } = setup()
  ov.set(true)
  ov.setSuppressed(true)
  assert.equal(group().visible, false)
  ov.setSuppressed(false)
  meshes.pop()
  ov.sync()
  assert.equal(group().children.length, 1, 'the line object of a removed mesh is gone')
  ov.dispose()
  assert.equal(helpers.children.length, 0)
})
test('instanced and skinned meshes are left alone', () => {
  const helpers = new THREE.Group()
  const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial(), 2)
  const ov = createMeshOverlay({ THREE, parent: helpers, getMeshes: () => [inst] })
  ov.set(true)
  assert.equal(helpers.children[0].children.length, 0)
})
test('install hooks into the scene before every frame and dispose puts the old hook back and stops drawing', () => {
  const scene = new THREE.Scene()
  let before = 0
  scene.onBeforeRender = () => before++
  const helpers = new THREE.Group()
  scene.add(helpers)
  const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial())
  const old = scene.onBeforeRender
  const ov = createMeshOverlay({ THREE, parent: helpers, getMeshes: () => [m] })
  ov.install(scene)
  ov.set(true)
  scene.onBeforeRender(null, scene, null)
  assert.equal(before, 1, 'the earlier hook still runs')
  assert.equal(helpers.children[0].children.length, 1, 'the frame hook made the lines')
  ov.dispose()
  assert.equal(scene.onBeforeRender, old, 'the earlier hook is back')
  ov.sync()
  assert.equal(helpers.children.length, 0, 'nothing is drawn after dispose')
})
test('review: switching it off lets go of the meshes (a new file does not keep the old ones alive)', () => {
  const { meshes, ov, group } = setup()
  ov.set(true)
  assert.equal(group().children.length, 2)
  ov.set(false)
  meshes.length = 0
  ov.sync()
  assert.equal(group().children.length, 0)
})
test('review: the lines follow the opacity of the view', () => {
  const { ov, group } = setup()
  ov.set(true)
  ov.setOpacity(0.4)
  const o = group().children[0].material.opacity
  ov.setOpacity(1)
  assert.ok(o < group().children[0].material.opacity)
})

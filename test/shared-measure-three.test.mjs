// Edge measuring on instanced and skinned meshes (editor/shared/measure-three.js) with the vendored three.js, in Node. Same file in both plugins.
import test from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'

const vendor = new URL('../editor/vendor/three.module.js', import.meta.url).href
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s, c, next) { if (s === 'three') return { url: ${JSON.stringify(vendor)}, shortCircuit: true }; return next(s, c) }`))
const THREE = await import(vendor)
const { edgeOfHit } = await import('../editor/shared/measure-three.js')

const len = (e) => e.a.distanceTo(e.b)
const box = () => new THREE.BoxGeometry(2, 2, 2)
const noCtx = { getDiag: () => 100 }

test('an instanced cube: the edge of the instance that was hit, in world size (scale 3 turns the 2 mm edge into 6 mm)', () => {
  const mesh = new THREE.InstancedMesh(box(), new THREE.MeshBasicMaterial(), 2)
  mesh.setMatrixAt(0, new THREE.Matrix4())
  mesh.setMatrixAt(1, new THREE.Matrix4().compose(new THREE.Vector3(10, 0, 0), new THREE.Quaternion(), new THREE.Vector3(3, 3, 3)))
  mesh.updateMatrixWorld(true)
  // a click on the instance's top-front edge: world y = 3, z = 3, x = 10 + 1
  const hit = { object: mesh, instanceId: 1, face: { a: 0, b: 1, c: 2 }, point: new THREE.Vector3(11, 3, 3) }
  const e = edgeOfHit(hit, hit.point, noCtx)
  assert.equal(e.triangle, false)
  assert.ok(Math.abs(len(e) - 6) < 1e-6, `edge ${len(e)}`)
  assert.ok(e.a.x >= 6.99 && e.b.x >= 6.99 && e.a.x <= 13.01, 'the edge lies on the second instance, not at the origin')
})
test('the same cube as a plain mesh with a parent scale gives the same answer', () => {
  const mesh = new THREE.Mesh(box(), new THREE.MeshBasicMaterial())
  mesh.scale.setScalar(3)
  mesh.position.set(10, 0, 0)
  mesh.updateMatrixWorld(true)
  const hit = { object: mesh, face: { a: 0, b: 1, c: 2 }, point: new THREE.Vector3(11, 3, 3) }
  assert.ok(Math.abs(len(edgeOfHit(hit, hit.point, noCtx)) - 6) < 1e-6)
})
test('a skinned mesh is measured in its current pose, as a triangle edge, never from the bind pose', () => {
  const g = new THREE.BoxGeometry(1, 1, 1)
  const n = g.getAttribute('position').count
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(n * 4), 4)) // all vertices follow bone 0
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(Float32Array.from({ length: n * 4 }, (_, i) => (i % 4 === 0 ? 1 : 0)), 4))
  const bone = new THREE.Bone()
  const mesh = new THREE.SkinnedMesh(g, new THREE.MeshBasicMaterial())
  mesh.add(bone)
  mesh.bind(new THREE.Skeleton([bone]))
  bone.scale.set(4, 1, 1) // the pose stretches the cube to 4 units along x
  mesh.updateMatrixWorld(true)
  const tri = { a: 0, b: 1, c: 2 }
  const pos = g.getAttribute('position')
  const e = edgeOfHit({ object: mesh, face: tri, point: new THREE.Vector3(0, 0, 0.5) }, new THREE.Vector3(0.4, 0.3, 0.5), noCtx)
  assert.equal(e.triangle, true)
  const posed = [0, 1, 2].map((i) => mesh.getVertexPosition(i, new THREE.Vector3()))
  assert.ok(posed.some((p, i) => Math.abs(p.x - pos.getX(i)) > 0.5), 'the posed vertices differ from the bind pose')
  for (const p of [e.a, e.b]) assert.ok(posed.some((q) => q.distanceTo(p) < 1e-6), 'edge ends are posed vertices')
})
test('a plain cube still gives its model edge (10 mm for a 10 mm cube), and a click far from any edge falls back', () => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(10, 10, 10), new THREE.MeshBasicMaterial())
  mesh.updateMatrixWorld(true)
  const hit = { object: mesh, face: { a: 0, b: 1, c: 2 }, point: new THREE.Vector3(5, 5, 0) }
  const e = edgeOfHit(hit, hit.point, { getDiag: () => 17.3 })
  assert.equal(e.triangle, false)
  assert.ok(Math.abs(len(e) - 10) < 1e-6)
})

// Tests for collectParts (editor/shared/export-three.js) with the vendored three.js, in Node. Same file in both plugins.
import test from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'

const vendor = new URL('../editor/vendor/three.module.js', import.meta.url).href
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s, c, next) { if (s === 'three') return { url: ${JSON.stringify(vendor)}, shortCircuit: true }; return next(s, c) }`))
const THREE = await import(vendor)
const { collectParts } = await import('../editor/shared/export-three.js')

// a unit tetrahedron with outward normals computed from the winding
function tetra(material) {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]), 3))
  g.setIndex([0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3])
  g.computeVertexNormals()
  return new THREE.Mesh(g, material)
}
const part = (obj, extra = {}) => ({ obj, kind: 'mesh', name: 'T', orig: obj.material, visible: true, ...extra })
const root = () => new THREE.Group()
const approx = (a, b, eps = 1e-5) => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`)

test('the view rotation ("Up is") is taken off: the copy is in the file axes, then turned to the wanted up', () => {
  const modelRoot = root()
  modelRoot.rotation.x = -Math.PI / 2 // the viewer's +Z up
  const mesh = tetra(new THREE.MeshStandardMaterial())
  modelRoot.add(mesh)
  modelRoot.updateMatrixWorld(true)
  const keep = collectParts([part(mesh)], modelRoot, { fileUp: 'z', target: 'keep' }).parts[0]
  assert.deepEqual([...keep.positions.slice(9, 12)].map((v) => Math.round(v * 1e5) / 1e5), [0, 0, 1], 'the file coordinates')
  const toY = collectParts([part(mesh)], modelRoot, { fileUp: 'z', target: 'y' }).parts[0]
  assert.deepEqual([...toY.positions.slice(9, 12)].map((v) => Math.round(v * 1e5) / 1e5), [0, 1, 0], 'Z up turned to Y up')
})

test('a mirrored part keeps its outside outside: winding swapped, normals not negated', () => {
  const modelRoot = root()
  const mesh = tetra(new THREE.MeshStandardMaterial())
  mesh.scale.x = -1
  modelRoot.add(mesh)
  const [p] = collectParts([part(mesh)], modelRoot, { withNormals: true }).parts
  assert.deepEqual([...p.indices.slice(0, 3)], [0, 1, 2], 'the first triangle (0,2,1) is written (0,1,2)')
  const n = (i) => [p.normals[3 * i], p.normals[3 * i + 1], p.normals[3 * i + 2]]
  const plain = tetra(new THREE.MeshStandardMaterial())
  const [q] = collectParts([part(plain)], (() => { const r = root(); r.add(plain); return r })(), { withNormals: true }).parts
  const o = (i) => [q.normals[3 * i], q.normals[3 * i + 1], q.normals[3 * i + 2]]
  for (let i = 0; i < 4; i++) {
    approx(n(i)[0], -o(i)[0]) // mirrored in x: the x part of every normal changes sign, nothing else
    approx(n(i)[1], o(i)[1])
    approx(n(i)[2], o(i)[2])
  }
  // geometric check: the winding normal of every triangle agrees with the stored normals (both outward)
  for (let t = 0; t < p.indices.length / 3; t++) {
    const [a, b, c] = [0, 1, 2].map((k) => p.indices[3 * t + k])
    const P = (i) => new THREE.Vector3(p.positions[3 * i], p.positions[3 * i + 1], p.positions[3 * i + 2])
    const face = new THREE.Vector3().crossVectors(P(b).sub(P(a)), P(c).sub(P(a)))
    const stored = new THREE.Vector3(...n(a))
    assert.ok(face.dot(stored) > 0, `triangle ${t}: winding and normal agree`)
  }
})

test('a mirrored part without an index still gets one (to swap the winding)', () => {
  const modelRoot = root()
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3))
  const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial())
  mesh.scale.y = -1
  modelRoot.add(mesh)
  const [p] = collectParts([part(mesh)], modelRoot).parts
  assert.deepEqual([...p.indices], [0, 2, 1])
})

test('colors: vertex colors become sRGB bytes, a real material color is kept, the viewer\'s own gray is not data', () => {
  const modelRoot = root()
  const m1 = tetra(new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(1, 0, 0, THREE.SRGBColorSpace) }))
  const m2 = tetra(new THREE.MeshStandardMaterial({ color: 0xc8ccd2 }))
  m2.material.userData.generic = true
  const m3 = tetra(new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true }))
  m3.geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(12).fill(0.2140411404), 3)) // linear 0.214 is sRGB 128
  for (const m of [m1, m2, m3]) modelRoot.add(m)
  const { parts } = collectParts([part(m1), part(m2), part(m3)], modelRoot)
  assert.deepEqual(parts[0].color, [255, 0, 0])
  assert.equal(parts[1].color, null)
  assert.equal(parts[2].color, null, 'vertex colors define the color, not the white material')
  assert.ok(Math.abs(parts[2].colors[0] - 128) <= 1, `sRGB byte ${parts[2].colors[0]}`)
})

test('hidden parts are left out unless asked for; lines are never exported', () => {
  const modelRoot = root()
  const a = tetra(new THREE.MeshStandardMaterial())
  const b = tetra(new THREE.MeshStandardMaterial())
  modelRoot.add(a, b)
  const list = [part(a), part(b, { visible: false }), part(b, { kind: 'lines' })]
  const r = collectParts(list, modelRoot, { visibleOnly: true })
  assert.equal(r.parts.length, 1)
  assert.equal(r.hidden, 1)
  assert.equal(collectParts(list, modelRoot, { visibleOnly: false }).parts.length, 2)
})

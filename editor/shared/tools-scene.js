// Shared by 3D Model Viewer and STEP Viewer 3D (canonical copy: plugins/_shared; do not edit the copies in editor/shared).
// The scene side of the Tools area: transform the model, remove or merge parts, decimate, check meshes. The tools change the WORKING
// COPY that is on screen (the loaded model; the file on disk is never touched); the export section then writes that copy.
// The first change takes a snapshot, `reset` goes back to it.
import * as THREE from 'three'
import { mergeMeshes } from './mesh-tools.js'
import { runTask } from './tools-run.js'

// metres per unit
export const UNIT_METERS = { µm: 1e-6, mm: 1e-3, cm: 1e-2, m: 1, in: 0.0254, ft: 0.3048 }
export const KNOWN_UNITS = Object.keys(UNIT_METERS)

/**
 * A = {
 *   modelRoot, getModel(), getParts(), getUnit() -> { short, label }, setUnit({ short, label }), getUp(), setUp(up),
 *   structure: true when parts may be removed/merged (the model viewer; the STEP viewer's parts belong to its assembly tree),
 *   rebuildParts() (re-reads the parts from the scene after removing or merging), afterChange() (bounds, helpers, statistics, export)
 * }
 */
const snaps = new WeakMap() // adapter -> snapshot

function snap(A) {
  if (snaps.has(A)) return snaps.get(A)
  const model = A.getModel()
  const s = {
    matrix: model.matrix.clone(),
    unit: { ...A.getUnit() },
    up: A.getUp(),
    removed: [], // { obj, parent, index }
    created: [], // meshes made by a merge
    geos: new Map(), // object -> its geometry before decimation
    changes: []
  }
  snaps.set(A, s)
  return s
}
export const hasChanges = (A) => snaps.has(A) && snaps.get(A).changes.length > 0
export const changeList = (A) => (snaps.has(A) ? [...snaps.get(A).changes] : [])
export function forget(A) {
  const s = snaps.get(A)
  if (s) {
    // what the tools replaced or removed is not needed any more
    for (const r of s.removed) if (r.obj.geometry) r.obj.geometry.dispose()
    for (const geo of s.geos.values()) geo.dispose()
    // the materials and textures of removed parts too, unless something that stays still uses them
    const live = new Set()
    const model = A.getModel && A.getModel()
    if (model) model.traverse((o) => { for (const m of Array.isArray(o.material) ? o.material : o.material ? [o.material] : []) live.add(m) })
    const liveTex = new Set()
    for (const m of live) {
      for (const v of Object.values(m)) if (v && v.isTexture) liveTex.add(v)
      const u = m.userData || {}
      for (const v of [u.map0, u.full]) if (v && v.isTexture) liveTex.add(v) // the real map while "Textures" is off
    }
    const gone = new Set()
    for (const r of s.removed) r.obj.traverse((o) => { for (const m of Array.isArray(o.material) ? o.material : o.material ? [o.material] : []) if (!live.has(m)) gone.add(m) })
    for (const m of gone) {
      for (const v of Object.values(m)) if (v && v.isTexture && !liveTex.has(v)) (A.disposeTexture ? A.disposeTexture(v) : v.dispose())
      m.dispose()
    }
  }
  snaps.delete(A)
}

const visibleParts = (A) => A.getParts().filter((p) => p.visible && (p.kind || 'mesh') !== 'lines')

/** Bounds of the visible parts in the view's coordinates (Y up), as a Box3. */
export function boundsWorld(A, onlyVisible = true) {
  const box = new THREE.Box3()
  A.getModel().updateWorldMatrix(true, true)
  for (const p of A.getParts()) {
    if (onlyVisible && !p.visible) continue
    const g = p.obj.geometry
    if (!g.boundingBox) g.computeBoundingBox()
    box.union(g.boundingBox.clone().applyMatrix4(p.obj.matrixWorld))
  }
  return box
}

function applyLocal(A, mLocal) {
  const model = A.getModel()
  model.updateMatrix()
  new THREE.Matrix4().multiplyMatrices(mLocal, model.matrix).decompose(model.position, model.quaternion, model.scale)
  model.updateMatrixWorld(true)
}
// a transform given in the view's (world) axes, as a transform of the model's own axes
function worldToLocal(A, mWorld) {
  const R = new THREE.Matrix4().extractRotation(A.modelRoot.matrixWorld)
  return new THREE.Matrix4().multiplyMatrices(R.clone().invert(), new THREE.Matrix4().multiplyMatrices(mWorld, R))
}
const centerLocal = (A) => {
  const c = boundsWorld(A).getCenter(new THREE.Vector3())
  return c.applyMatrix4(new THREE.Matrix4().copy(A.modelRoot.matrixWorld).invert())
}
const finish = (A, label) => {
  snap(A).changes.push(label)
  A.afterChange()
}
const rotAxis = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }

/** Moves the visible parts: 'center' (bounding box centre to the origin), 'floor' (centred on X and Z, lowest point at 0), 'floor-only' (only the height), 'min' (lowest corner at the origin). */
export function setOrigin(A, how) {
  snap(A)
  const b = boundsWorld(A)
  if (b.isEmpty()) return false
  const c = b.getCenter(new THREE.Vector3())
  const d = how === 'center' ? c.clone().negate() : how === 'floor' ? new THREE.Vector3(-c.x, -b.min.y, -c.z) : how === 'floor-only' ? new THREE.Vector3(0, -b.min.y, 0) : b.min.clone().negate()
  applyLocal(A, worldToLocal(A, new THREE.Matrix4().makeTranslation(d.x, d.y, d.z)))
  finish(A, `origin:${how}`)
  return true
}

/** Scales about the origin of the model's axes. */
export function scaleBy(A, k) {
  if (!(k > 0) || !Number.isFinite(k)) return false
  snap(A)
  applyLocal(A, new THREE.Matrix4().makeScale(k, k, k))
  finish(A, `scale:${k}`)
  return true
}

/** Changes the unit and scales the coordinates so the model keeps its real size. Needs a known unit now. Returns false if it cannot. */
export function convertUnit(A, to, label) {
  const from = A.getUnit().short
  if (!UNIT_METERS[from] || !UNIT_METERS[to]) return false
  snap(A)
  const k = UNIT_METERS[from] / UNIT_METERS[to]
  applyLocal(A, new THREE.Matrix4().makeScale(k, k, k))
  A.setUnit({ short: to, label })
  finish(A, `unit:${from}>${to}`)
  return true
}
/** Only says what the numbers mean (for a file that does not store a unit); the coordinates stay as they are. */
export function assignUnit(A, to, label) {
  snap(A)
  A.setUnit({ short: to, label })
  finish(A, `unit-label:${to}`)
  return true
}

/** Turns the model by a multiple of 90 degrees about one of the model's own axes, around the centre of the visible parts. */
export function rotate(A, axis, degrees) {
  snap(A)
  const c = centerLocal(A)
  const m = new THREE.Matrix4()
    .makeTranslation(c.x, c.y, c.z)
    .multiply(new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(...rotAxis[axis]), (degrees * Math.PI) / 180))
    .multiply(new THREE.Matrix4().makeTranslation(-c.x, -c.y, -c.z))
  applyLocal(A, m)
  finish(A, `rotate:${axis}${degrees}`)
  return true
}

/** Mirrors along one of the model's own axes, about the centre of the visible parts. */
export function mirror(A, axis) {
  snap(A)
  const c = centerLocal(A)
  const s = new THREE.Vector3(1, 1, 1)
  s[axis] = -1
  applyLocal(A, new THREE.Matrix4().makeTranslation(c.x, c.y, c.z).multiply(new THREE.Matrix4().makeScale(s.x, s.y, s.z)).multiply(new THREE.Matrix4().makeTranslation(-c.x, -c.y, -c.z)))
  finish(A, `mirror:${axis}`)
  return true
}

/** Makes the viewer's "Up is" choice part of the model: afterwards +Y is up in the model's own axes and "Up is" reads +Y. */
export function bakeUp(A) {
  if (A.getUp() === 'y') return false
  snap(A)
  applyLocal(A, new THREE.Matrix4().extractRotation(A.modelRoot.matrixWorld))
  A.setUp('y')
  finish(A, 'bake-up')
  return true
}

// ---------- parts ----------
function detach(A, p) {
  const s = snap(A)
  const parent = p.obj.parent
  if (!parent) return
  s.removed.push({ obj: p.obj, parent, index: parent.children.indexOf(p.obj) })
  parent.remove(p.obj)
}
/** Removes parts from the working copy. `which` is an array of parts. */
export function removeParts(A, which) {
  if (!A.structure || !which.length) return 0
  snap(A)
  for (const p of which) detach(A, p)
  A.rebuildParts()
  finish(A, `remove:${which.length}`)
  return which.length
}

const colorOf = (p) => {
  const m = Array.isArray(p.orig) ? p.orig[0] : p.orig
  return m && m.color ? [m.color.r, m.color.g, m.color.b] : [0.8, 0.8, 0.8]
}
/** Joins the visible mesh parts without textures into one mesh (their colors become vertex colors). Returns how many were joined. */
export function mergeVisible(A) {
  if (!A.structure) return 0
  const model = A.getModel()
  model.updateWorldMatrix(true, true)
  const inv = new THREE.Matrix4().copy(model.matrixWorld).invert()
  // only plain opaque meshes: textures, transparency, normal or emissive maps, several materials and morph targets cannot be kept in one mesh
  const plain = (p) => {
    const m = p.orig
    return !Array.isArray(m) && m && !m.map && !m.normalMap && !m.emissiveMap && !m.aoMap && !m.roughnessMap && !m.metalnessMap && !m.alphaMap && !m.transparent && !(m.opacity < 1) && (m.userData && m.userData.o ? !m.userData.o.transparent : true) && !Object.keys(p.obj.geometry.morphAttributes || {}).length
  }
  const picked = visibleParts(A).filter((p) => (p.kind || 'mesh') === 'mesh' && plain(p) && !p.obj.isSkinnedMesh && !p.obj.isInstancedMesh)
  if (picked.length < 2) return 0
  snap(A)
  const list = picked.map((p) => {
    const geo = p.obj.geometry
    const pos = geo.getAttribute('position')
    const m = new THREE.Matrix4().multiplyMatrices(inv, p.obj.matrixWorld)
    const nm = new THREE.Matrix3().getNormalMatrix(m)
    const n = pos.count
    const positions = new Float32Array(n * 3)
    const v = new THREE.Vector3()
    for (let i = 0; i < n; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m)
      positions.set([v.x, v.y, v.z], 3 * i)
    }
    let normals = null
    const nrm = geo.getAttribute('normal')
    if (nrm) {
      normals = new Float32Array(n * 3)
      for (let i = 0; i < n; i++) {
        v.fromBufferAttribute(nrm, i).applyMatrix3(nm).normalize()
        normals.set([v.x, v.y, v.z], 3 * i)
      }
    }
    const col = geo.getAttribute('color')
    const base = colorOf(p)
    const colors = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      if (col && col.count === n) colors.set([col.getX(i) * base[0], col.getY(i) * base[1], col.getZ(i) * base[2]], 3 * i)
      else colors.set(base, 3 * i)
    }
    let indices = geo.index ? Uint32Array.from(geo.index.array) : null
    if (m.determinant() < 0) {
      // a mirrored part keeps its outside outside
      if (!indices) indices = Uint32Array.from({ length: n }, (_, i) => i)
      for (let t = 0; t + 2 < indices.length; t += 3) [indices[t + 1], indices[t + 2]] = [indices[t + 2], indices[t + 1]]
    }
    return { positions, normals, colors, indices }
  })
  const merged = mergeMeshes(list)
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(merged.positions, 3))
  if (merged.normals) geo.setAttribute('normal', new THREE.BufferAttribute(merged.normals, 3))
  geo.setAttribute('color', new THREE.BufferAttribute(merged.colors, 3))
  geo.setIndex(new THREE.BufferAttribute(merged.indices, 1))
  if (!merged.normals) geo.computeVertexNormals()
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.65, metalness: 0.05 })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.name = 'Merged'
  for (const p of picked) detach(A, p)
  model.add(mesh)
  snap(A).created.push(mesh)
  A.rebuildParts()
  finish(A, `merge:${picked.length}`)
  return picked.length
}

// ---------- decimate ----------
// A plain copy of an attribute's data, also for interleaved ones (glTF files from gltfpack or with meshopt compression have them).
function copyAttr(a, asFloat = false) {
  if (asFloat && !(a.array instanceof Float32Array && !a.isInterleavedBufferAttribute)) {
    // quantized positions (gltfpack, KHR_mesh_quantization) become floats: the tools work on numbers, the node's scale undoes the quantization
    const out = new Float32Array(a.count * a.itemSize)
    for (let i = 0; i < a.count; i++) for (let k = 0; k < a.itemSize; k++) out[i * a.itemSize + k] = a.getComponent(i, k)
    return { array: out, itemSize: a.itemSize, normalized: false }
  }
  if (!a.isInterleavedBufferAttribute) return { array: a.array.slice(), itemSize: a.itemSize, normalized: a.normalized }
  const { data, offset, itemSize } = a
  const stride = data.stride
  const out = new data.array.constructor(a.count * itemSize)
  for (let i = 0; i < a.count; i++) for (let k = 0; k < itemSize; k++) out[i * itemSize + k] = data.array[i * stride + offset + k]
  return { array: out, itemSize, normalized: a.normalized }
}
/**
 * Simplifies the visible mesh parts in a worker. opts: { ratio, error, lockBorder }. Resolves { parts, trianglesIn, trianglesOut, skipped }.
 * `run` receives { cancel } so the page can offer a Cancel button.
 */
export async function decimate(A, opts, { onProgress, setCancel } = {}) {
  // not decimated: instanced meshes, morph targets, and meshes with several materials (their groups would be lost)
  const picked = visibleParts(A).filter((p) => (p.kind || 'mesh') === 'mesh' && !p.obj.isInstancedMesh && !Object.keys(p.obj.geometry.morphAttributes || {}).length && !Array.isArray(p.obj.material))
  const skipped = visibleParts(A).filter((p) => (p.kind || 'mesh') === 'mesh').length - picked.length
  if (!picked.length) return { parts: 0, trianglesIn: 0, trianglesOut: 0, skipped }
  const meshes = picked.map((p) => {
    const g = p.obj.geometry
    const attributes = {}
    for (const [name, a] of Object.entries(g.attributes)) attributes[name] = copyAttr(a, name === 'position')
    return { attributes, indices: g.index ? g.index.array.slice() : null }
  })
  const transfer = []
  for (const m of meshes) {
    for (const a of Object.values(m.attributes)) transfer.push(a.array.buffer)
    if (m.indices) transfer.push(m.indices.buffer)
  }
  const modelAtStart = A.getModel()
  const task = runTask('decimate', { meshes, opts }, { transfer, onProgress })
  if (setCancel) setCancel(() => task.cancel())
  const { results } = await task.promise
  if (A.getModel() !== modelAtStart) throw new Error('cancelled') // another file was opened meanwhile: this result belongs to the old one
  const s = snap(A)
  let trianglesIn = 0
  let trianglesOut = 0
  picked.forEach((p, i) => {
    const r = results[i]
    const g = new THREE.BufferGeometry()
    for (const [name, a] of Object.entries(r.attributes)) g.setAttribute(name, new THREE.BufferAttribute(a.array, a.itemSize, !!a.normalized))
    g.setIndex(new THREE.BufferAttribute(r.indices, 1))
    if (!s.geos.has(p.obj)) s.geos.set(p.obj, p.obj.geometry)
    else p.obj.geometry.dispose()
    p.obj.geometry = g
    g.computeBoundingBox()
    trianglesIn += r.stats.trianglesIn
    trianglesOut += r.stats.trianglesOut
    p.tris = r.stats.trianglesOut
    p.verts = r.stats.verticesOut
  })
  finish(A, `decimate:${opts.ratio}`)
  return { parts: picked.length, trianglesIn, trianglesOut, skipped }
}

const MAX_INSTANCES = 100000
/** True when the matrix only rotates, mirrors and scales the same in every direction (no uneven stretch, no shear). */
function isSimilarity(m) {
  const e = m.elements
  const c = [0, 4, 8].map((o) => e[o] * e[o] + e[o + 1] * e[o + 1] + e[o + 2] * e[o + 2])
  const d = [e[0] * e[4] + e[1] * e[5] + e[2] * e[6], e[0] * e[8] + e[1] * e[9] + e[2] * e[10], e[4] * e[8] + e[5] * e[9] + e[6] * e[10]]
  const s2 = (c[0] + c[1] + c[2]) / 3
  return s2 > 0 && c.every((x) => Math.abs(x - s2) <= 1e-6 * s2) && d.every((x) => Math.abs(x) <= 1e-6 * s2)
}

/** Checks the visible mesh parts (holes, non-manifold edges, ...) in a worker. Nothing is changed. */
export async function analyze(A, { onProgress, setCancel, parts } = {}) {
  // `parts`: check just these (the part card); otherwise the visible mesh parts
  const picked = (parts || visibleParts(A)).filter((p) => (p.kind || 'mesh') === 'mesh')
  A.getModel().updateWorldMatrix(true, true)
  const inv = new THREE.Matrix4().copy(A.modelRoot.matrixWorld).invert() // the model's units as they are now (working copy scale included)
  const meshes = picked.map((p) => {
    const g = p.obj.geometry
    const m = new THREE.Matrix4().multiplyMatrices(inv, p.obj.matrixWorld)
    const det = m.determinant()
    let positions = copyAttr(g.getAttribute('position'), true).array
    let indices = g.index ? g.index.array.slice() : null
    let k = Math.cbrt(Math.abs(det)) // scale from the part's own coordinates to the model's units, for the volume
    if (!isSimilarity(m)) {
      // stretched unevenly (or sheared): one cube-root factor would give a wrong area and volume, so the part is checked in the model's own units
      const v = new THREE.Vector3()
      for (let i = 0; i < positions.length; i += 3) {
        v.set(positions[i], positions[i + 1], positions[i + 2]).applyMatrix4(m)
        positions[i] = v.x
        positions[i + 1] = v.y
        positions[i + 2] = v.z
      }
      k = 1
      if (det < 0) { // a mirror turns the winding around: turn it back, or a good mesh would read as inside out
        const n = indices ? indices.length : positions.length / 3
        if (!indices) indices = Uint32Array.from({ length: n }, (_, i) => i)
        for (let i = 0; i + 2 < n; i += 3) [indices[i + 1], indices[i + 2]] = [indices[i + 2], indices[i + 1]]
      }
    }
    // an InstancedMesh draws the part once per instance: area and volume count every instance (each with its own scale)
    let scales = [k]
    if (p.obj.isInstancedMesh && p.obj.count <= MAX_INSTANCES) {
      scales = []
      const im = new THREE.Matrix4()
      for (let i = 0; i < p.obj.count; i++) {
        p.obj.getMatrixAt(i, im)
        const sc = isSimilarity(im) ? Math.cbrt(Math.abs(im.determinant())) : Math.sqrt((im.elements[0] ** 2 + im.elements[1] ** 2 + im.elements[2] ** 2 + im.elements[4] ** 2 + im.elements[5] ** 2 + im.elements[6] ** 2 + im.elements[8] ** 2 + im.elements[9] ** 2 + im.elements[10] ** 2) / 3) // uneven instances: an average, not exact
        scales.push(k * sc)
      }
    }
    return { name: p.label || p.name || '', positions, indices, scale: k, scales }
  })
  const transfer = []
  for (const m of meshes) {
    transfer.push(m.positions.buffer)
    if (m.indices) transfer.push(m.indices.buffer)
  }
  const modelAtStart = A.getModel()
  const task = runTask('analyze', { meshes }, { transfer, onProgress })
  if (setCancel) setCancel(() => task.cancel())
  const { results } = await task.promise
  if (A.getModel() !== modelAtStart) throw new Error('cancelled')
  // volumes are in the part's own coordinates: bring them into the model's units
  results.forEach((r, i) => {
    const sc = meshes[i].scales
    if (r.volume != null) r.volume *= sc.reduce((a, x) => a + x ** 3, 0)
    r.area *= sc.reduce((a, x) => a + x ** 2, 0)
  })
  const total = { triangles: 0, boundaryEdges: 0, nonManifoldEdges: 0, flippedEdges: 0, degenerate: 0, holes: 0, components: 0, watertight: results.length > 0, area: 0, volume: 0, inverted: false }
  for (const r of results) {
    for (const k of ['triangles', 'boundaryEdges', 'nonManifoldEdges', 'flippedEdges', 'degenerate', 'holes', 'components']) total[k] += r[k]
    total.watertight = total.watertight && r.watertight
    total.area += r.area
    total.inverted = total.inverted || !!r.inverted
    total.volume = total.volume == null || r.volume == null ? null : total.volume + r.volume
  }
  return { results, total }
}

/** Goes back to the model as it was loaded (position, unit, up axis, removed and merged parts, decimated meshes). */
export function reset(A) {
  const s = snaps.get(A)
  if (!s) return false
  const model = A.getModel()
  for (const m of s.created) {
    if (m.parent) m.parent.remove(m)
    m.geometry.dispose()
    m.material.dispose()
  }
  for (const r of [...s.removed].reverse()) {
    if (s.created.includes(r.obj)) continue // a merged mesh that was removed again is gone for good
    r.parent.children.splice(Math.min(r.index, r.parent.children.length), 0, r.obj)
    r.obj.parent = r.parent
  }
  for (const [obj, geo] of s.geos) {
    obj.geometry.dispose()
    obj.geometry = geo
  }
  s.matrix.decompose(model.position, model.quaternion, model.scale)
  model.updateMatrixWorld(true)
  A.setUnit(s.unit)
  if (A.getUp() !== s.up) A.setUp(s.up)
  snaps.delete(A)
  if (A.structure) A.rebuildParts()
  else for (const p of A.getParts()) { // parts keep their entries: only their counts change back
    const pos = p.obj.geometry.getAttribute('position')
    p.verts = pos.count
    p.tris = Math.floor((p.obj.geometry.index ? p.obj.geometry.index.count : pos.count) / 3)
  }
  A.afterChange()
  return true
}

/**
 * A part's mesh in the model's own space (its matrix and the model's own matrix applied, a mirror turned back), as { positions, indices }:
 * what the distance between two parts needs. Copies, so nothing of the scene changes.
 */
export function partMesh(A, p) {
  const g = p.obj.geometry
  const pos = g.getAttribute('position')
  A.getModel().updateWorldMatrix(true, true)
  const inv = new THREE.Matrix4().copy(A.modelRoot.matrixWorld).invert()
  const m = new THREE.Matrix4().multiplyMatrices(inv, p.obj.matrixWorld)
  const positions = new Float32Array(pos.count * 3)
  const v = new THREE.Vector3()
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(m)
    positions[3 * i] = v.x
    positions[3 * i + 1] = v.y
    positions[3 * i + 2] = v.z
  }
  return { positions, indices: g.index ? Uint32Array.from(g.index.array) : null }
}

/** The smallest distance between two parts (a worker task): { distance, approximate } in the model's units. */
export function partDistance(A, pa, pb, { onProgress, setCancel } = {}) {
  const a = partMesh(A, pa)
  const b = partMesh(A, pb)
  const transfer = [a.positions.buffer, b.positions.buffer]
  if (a.indices) transfer.push(a.indices.buffer)
  if (b.indices) transfer.push(b.indices.buffer)
  const task = runTask('distance', { a, b }, { transfer, onProgress })
  if (setCancel) setCancel(() => task.cancel())
  return task.promise
}

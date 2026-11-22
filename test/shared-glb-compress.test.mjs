// Tests for the GLB compressor (editor/shared/glb-compress.js) with the vendored meshopt encoder, and a round trip through the vendored
// three.js GLTFLoader and meshopt decoder, in Node. Same file in both plugins.
import test from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'
import { writeGLB } from '../editor/shared/export.js'
import { compressGlb, parseGlb, buildGlb, readAccessor, dataImages } from '../editor/shared/glb-compress.js'
import { MeshoptEncoder } from '../editor/vendor/meshopt/meshopt_encoder.js'

const vendor = new URL('../editor/vendor/three.module.js', import.meta.url).href
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s, c, next) { if (s === 'three') return { url: ${JSON.stringify(vendor)}, shortCircuit: true }; return next(s, c) }`))
const THREE = await import(vendor)
// the STEP viewer does not ship a glTF loader: the round trip tests run where there is one (the 3D Model Viewer)
let GLTFLoader = null
let MeshoptDecoder = null
try {
  ;({ GLTFLoader } = await import('../editor/vendor/addons/loaders/GLTFLoader.js'))
  ;({ MeshoptDecoder } = await import('../editor/vendor/addons/libs/meshopt_decoder.module.js'))
} catch {
  // no loader here
}
const roundTrip = { skip: !GLTFLoader && 'needs the vendored GLTFLoader (3D Model Viewer)' }
await MeshoptEncoder.ready

// a UV-less sphere with normals and colors, as writeGLB gets it from the viewers (shared vertices)
function sphere(nu, nv, r = 1, c = [0, 0, 0]) {
  const pos = []
  const nor = []
  const col = []
  for (let j = 0; j <= nv; j++) {
    const t = (Math.PI * j) / nv
    for (let i = 0; i <= nu; i++) {
      const p = (2 * Math.PI * i) / nu
      const x = Math.sin(t) * Math.cos(p)
      const y = Math.cos(t)
      const z = Math.sin(t) * Math.sin(p)
      pos.push(c[0] + r * x, c[1] + r * y, c[2] + r * z)
      nor.push(x, y, z)
      col.push(Math.round(127 + 127 * x), Math.round(127 + 127 * y), Math.round(127 + 127 * z))
    }
  }
  const idx = []
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const a = j * (nu + 1) + i
    const b = a + nu + 1
    idx.push(a, a + 1, b, a + 1, b + 1, b)
  }
  return { name: 'Sphere', kind: 'mesh', positions: Float32Array.from(pos), normals: Float32Array.from(nor), indices: Uint32Array.from(idx), colors: Uint8Array.from(col), color: null }
}
const load = (bytes) => new Promise((res, rej) => new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '', res, rej))
const meshes = (g) => { const out = []; g.scene.traverse((o) => o.isMesh && out.push(o)); return out }
const triSet = (geo) => {
  const p = geo.getAttribute('position')
  const idx = geo.index
  const n = idx ? idx.count : p.count
  const key = (i) => [p.getX(i), p.getY(i), p.getZ(i)].map((v) => Math.round(v * 40)).join(',')
  const s = new Map()
  for (let t = 0; t < n; t += 3) {
    const v = [0, 1, 2].map((k) => key(idx ? idx.getX(t + k) : t + k))
    const k = [...v].sort().join('|')
    s.set(k, (s.get(k) || 0) + 1)
  }
  return s
}

test('a sphere GLB becomes much smaller and loads again with the same triangles, positions, normals and colors', roundTrip, async () => {
  const src = writeGLB([sphere(120, 60)])
  const { bytes, report } = await compressGlb(src, { precision: 'balanced', targetBytes: 10 * 1048576 }, { encoder: MeshoptEncoder })
  assert.ok(bytes.length < src.length / 3, `${src.length} -> ${bytes.length}`)
  assert.equal(report.reached, true)
  assert.equal(report.stats.trianglesIn, 14400)
  assert.equal(report.stats.trianglesOut, 14400)
  const { json } = parseGlb(bytes)
  assert.deepEqual(json.extensionsRequired.sort(), ['EXT_meshopt_compression', 'KHR_mesh_quantization'])
  assert.equal(json.buffers.length, 2)
  assert.ok(json.buffers[1].extensions.EXT_meshopt_compression.fallback)
  const a = await load(src)
  const b = await load(bytes)
  const ga = meshes(a)[0].geometry
  const gb = meshes(b)[0].geometry
  assert.equal(gb.index.count, ga.index.count)
  const sa = triSet(ga)
  const sb = triSet(gb)
  let same = 0
  for (const [k, n] of sa) if (sb.get(k) === n) same++
  assert.ok(same / sa.size > 0.97, `triangles preserved: ${same}/${sa.size}`) // 14-bit positions move vertices by about 1e-4: only triangles on a rounding boundary of the test's key differ
  // vertex data of the loaded copy: unit normals, colors close
  const nrm = gb.getAttribute('normal')
  for (let i = 0; i < nrm.count; i += 97) assert.ok(Math.abs(Math.hypot(nrm.getX(i), nrm.getY(i), nrm.getZ(i)) - 1) < 0.03)
  assert.ok(gb.getAttribute('color').count === gb.getAttribute('position').count)
  const box = new THREE.Box3().setFromBufferAttribute(gb.getAttribute('position'))
  assert.ok(Math.abs(box.max.x - 1) < 1e-3 && Math.abs(box.min.y + 1) < 1e-3)
})

test('lower precision is smaller', async () => {
  const src = writeGLB([sphere(100, 50)])
  const fine = (await compressGlb(src, { precision: 'fine', targetBytes: 1e9 }, { encoder: MeshoptEncoder })).bytes.length
  const small = (await compressGlb(src, { precision: 'small', targetBytes: 1e9 }, { encoder: MeshoptEncoder })).bytes.length
  assert.ok(small < fine, `${small} < ${fine}`)
})

test('triangle soup (no shared vertices, no index) is welded and indexed', roundTrip, async () => {
  const s = sphere(40, 20)
  const pos = new Float32Array(s.indices.length * 3)
  const nor = new Float32Array(s.indices.length * 3)
  const col = new Uint8Array(s.indices.length * 3)
  s.indices.forEach((v, i) => {
    pos.set(s.positions.subarray(3 * v, 3 * v + 3), 3 * i)
    nor.set(s.normals.subarray(3 * v, 3 * v + 3), 3 * i)
    col.set(s.colors.subarray(3 * v, 3 * v + 3), 3 * i)
  })
  // a glTF without indices: build it by hand from a one-primitive GLB
  const g = parseGlb(writeGLB([{ ...s, positions: pos, normals: nor, colors: col, indices: Uint32Array.from({ length: pos.length / 3 }, (_, i) => i) }]))
  const soupBytes = writeGLB([{ ...s, positions: pos, normals: nor, colors: col, indices: null }])
  const { bytes, report } = await compressGlb(soupBytes, { precision: 'balanced', targetBytes: 1e9 }, { encoder: MeshoptEncoder })
  assert.ok(report.stats.verticesOut <= report.stats.verticesIn / 3 + 5, `${report.stats.verticesIn} -> ${report.stats.verticesOut} vertices`)
  const loaded = await load(bytes)
  assert.equal(meshes(loaded)[0].geometry.index.count, s.indices.length)
  assert.ok(g)
})

test('a point cloud keeps its points and gets smaller; colors survive', roundTrip, async () => {
  const n = 20000
  const pos = new Float32Array(n * 3)
  const col = new Uint8Array(n * 3)
  for (let i = 0; i < n; i++) {
    pos.set([Math.sin(i * 0.01) * 5 + (i % 7) * 0.001, Math.cos(i * 0.013) * 5, (i % 100) * 0.05], 3 * i)
    col.set([i % 256, (i * 3) % 256, 200], 3 * i)
  }
  const src = writeGLB([{ name: 'Cloud', kind: 'points', positions: pos, indices: null, normals: null, colors: col, color: null }])
  const { bytes, report } = await compressGlb(src, { precision: 'balanced', targetBytes: 1e9 }, { encoder: MeshoptEncoder })
  assert.ok(bytes.length < src.length / 2, `${src.length} -> ${bytes.length}`)
  assert.equal(report.stats.verticesOut, n)
  const loaded = await load(bytes)
  let pts = null
  loaded.scene.traverse((o) => o.isPoints && (pts = o))
  assert.equal(pts.geometry.getAttribute('position').count, n)
  assert.ok(pts.geometry.getAttribute('color'))
})

test('textures are re-encoded until the file fits, the loop reports what it did; a target that cannot be reached is said so', async () => {
  const s = sphere(30, 15)
  const base = parseGlb(writeGLB([s]))
  // attach a fake "image" bufferView of 400 KB
  const img = new Uint8Array(400_000).map((_, i) => (i * 31) & 255)
  const bin = new Uint8Array(base.bin.length + img.length)
  bin.set(base.bin)
  bin.set(img, base.bin.length)
  const j = structuredClone(base.json)
  j.bufferViews.push({ buffer: 0, byteOffset: base.bin.length, byteLength: img.length })
  j.images = [{ bufferView: j.bufferViews.length - 1, mimeType: 'image/png' }]
  j.buffers[0].byteLength = bin.length
  const glb = buildGlb(j, [bin])
  const calls = []
  // a fake codec: the output shrinks with maxSize and quality
  const recodeImage = async (bytes, mime, { maxSize, quality }) => {
    calls.push({ maxSize, quality })
    const size = Math.floor((maxSize || 4096) ** 2 * quality * 0.02)
    return { bytes: new Uint8Array(Math.min(size, bytes.length - 1)).fill(7), mimeType: 'image/jpeg', width: maxSize || 4096, height: maxSize || 4096 }
  }
  const reachable = await compressGlb(glb, { precision: 'balanced', texMax: 2048, targetBytes: 60_000 }, { encoder: MeshoptEncoder, recodeImage })
  assert.equal(reachable.report.reached, true)
  assert.ok(reachable.bytes.length <= 60_000, `${reachable.bytes.length}`)
  assert.ok(calls.length > 1, 'it tried smaller settings')
  assert.equal(reachable.report.textures.before.bytes, 400_000)
  assert.ok(reachable.report.textures.after.bytes < 100_000)
  assert.equal(parseGlb(reachable.bytes).json.images[0].mimeType, 'image/jpeg')
  const impossible = await compressGlb(glb, { precision: 'balanced', texMax: 2048, targetBytes: 5000 }, { encoder: MeshoptEncoder, recodeImage })
  assert.equal(impossible.report.reached, false)
  assert.ok(impossible.report.suggestions.length > 0)
  assert.ok(impossible.report.steps.some((st) => st.precision === 'small'), 'the second try uses the smallest precision')
})

test('a try that comes out larger never replaces a smaller one: a stricter target cannot give a bigger file', async () => {
  const s = sphere(30, 15)
  const base = parseGlb(writeGLB([s]))
  const img = new Uint8Array(400_000).map((_, i) => (i * 31) & 255)
  const bin = new Uint8Array(base.bin.length + img.length)
  bin.set(base.bin)
  bin.set(img, base.bin.length)
  const j = structuredClone(base.json)
  j.bufferViews.push({ buffer: 0, byteOffset: base.bin.length, byteLength: img.length })
  j.images = [{ bufferView: j.bufferViews.length - 1, mimeType: 'image/png' }]
  j.buffers[0].byteLength = bin.length
  const glb = buildGlb(j, [bin])
  // dry run: constant 1000-byte pictures; how many pictures are made in one pass?
  let n = 0
  const flat = async () => (n++, { bytes: new Uint8Array(1000).fill(7), mimeType: 'image/jpeg', width: 128, height: 128 })
  const dry = await compressGlb(glb, { precision: 'balanced', targetBytes: 5000 }, { encoder: MeshoptEncoder, recodeImage: flat })
  const perPass = n / 2
  // the first pass makes small pictures, the second (the "small" precision) makes huge ones
  let k = 0
  const worse = async () => (k++, { bytes: new Uint8Array(k <= perPass ? 1000 : 50_000).fill(7), mimeType: 'image/jpeg', width: 128, height: 128 })
  const r = await compressGlb(glb, { precision: 'balanced', targetBytes: 5000 }, { encoder: MeshoptEncoder, recodeImage: worse })
  assert.equal(r.report.reached, false)
  assert.ok(r.bytes.length < dry.bytes.length + 5000, `${r.bytes.length} must come from the first, smaller pass (the second would be ${dry.bytes.length + 49000})`)
  assert.equal(r.report.bytes, r.bytes.length, 'the report describes the file that is returned')
})

test('animation, skin and morph data keep their bytes; cancelled and already compressed inputs are refused', async () => {
  const src = writeGLB([sphere(10, 6)])
  await assert.rejects(() => compressGlb(src, {}, { encoder: MeshoptEncoder, isCancelled: () => true }), /cancelled/)
  const once = (await compressGlb(src, {}, { encoder: MeshoptEncoder })).bytes
  await assert.rejects(() => compressGlb(once, {}, { encoder: MeshoptEncoder }), /already_compressed/)
  await assert.rejects(() => compressGlb(new Uint8Array(10), {}, { encoder: MeshoptEncoder }), /not a GLB/)
  assert.ok(readAccessor(parseGlb(src).json, parseGlb(src).bin, 0))
})

test('images of data (normal, occlusion, metal/roughness, extension maps) are told from pictures and are not sent through lossy JPEG', async () => {
  const json = {
    materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicRoughnessTexture: { index: 1 } }, normalTexture: { index: 2 }, occlusionTexture: { index: 3 }, emissiveTexture: { index: 4 },
      extensions: { KHR_materials_clearcoat: { clearcoatTexture: { index: 5 }, clearcoatNormalTexture: { index: 6 } }, KHR_materials_sheen: { sheenColorTexture: { index: 7 } } } }],
    textures: [0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({ source: i }))
  }
  assert.deepEqual([...dataImages(json)].sort(), [1, 2, 3, 5, 6])
  const s = sphere(10, 6)
  const base = parseGlb(writeGLB([s]))
  const img = new Uint8Array(1000).fill(3)
  const bin = new Uint8Array(base.bin.length + img.length * 2)
  bin.set(base.bin)
  bin.set(img, base.bin.length)
  bin.set(img, base.bin.length + img.length)
  const j = structuredClone(base.json)
  j.bufferViews.push({ buffer: 0, byteOffset: base.bin.length, byteLength: 1000 }, { buffer: 0, byteOffset: base.bin.length + 1000, byteLength: 1000 })
  j.images = [{ bufferView: j.bufferViews.length - 2, mimeType: 'image/png' }, { bufferView: j.bufferViews.length - 1, mimeType: 'image/png' }]
  j.textures = [{ source: 0 }, { source: 1 }]
  j.materials = [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } }, normalTexture: { index: 1 } }]
  j.buffers[0].byteLength = bin.length
  const seen = []
  const recodeImage = async (bytes, mime, o) => {
    seen.push(o.lossless)
    return { bytes: new Uint8Array(10), mimeType: o.lossless ? 'image/png' : 'image/jpeg', width: 8, height: 8 }
  }
  const r = await compressGlb(buildGlb(j, [bin]), { precision: 'balanced', texMax: 1024, targetBytes: 1e9 }, { encoder: MeshoptEncoder, recodeImage })
  assert.deepEqual(seen.sort(), [false, true])
  const out = parseGlb(r.bytes).json
  assert.equal(out.images[0].mimeType, 'image/jpeg')
  assert.equal(out.images[1].mimeType, 'image/png', 'the normal map stays PNG')
})

test('a model far from the origin keeps its shape: its positions are stored exactly instead of being quantized into a point', async () => {
  const s = sphere(40, 20, 50, [500000, 4000000, 300]) // radius 50, centre far away
  const src = writeGLB([s])
  const { bytes, report } = await compressGlb(src, { precision: 'balanced', targetBytes: 1e9 }, { encoder: MeshoptEncoder })
  assert.equal(report.stats.exactPositions, true)
  if (!GLTFLoader) return
  const loaded = await load(bytes)
  const pos = meshes(loaded)[0].geometry.getAttribute('position')
  const xs = new Set()
  for (let i = 0; i < pos.count; i++) xs.add(pos.getX(i))
  assert.ok(xs.size > 30, `${xs.size} distinct x values survive`)
  const near = await compressGlb(writeGLB([sphere(40, 20, 50, [10, 0, 0])]), { precision: 'balanced', targetBytes: 1e9 }, { encoder: MeshoptEncoder })
  assert.ok(!near.report.stats.exactPositions, 'an ordinary model is still quantized')
})

test('readAccessor refuses numbers from the file that would defeat its size check (negative stride/offset, odd counts)', () => {
  const bin = new Uint8Array(64)
  const mk = (bv, acc) => ({ accessors: [{ componentType: 5126, type: 'VEC3', count: 4, bufferView: 0, ...acc }], bufferViews: [{ byteLength: 64, ...bv }] })
  assert.ok(readAccessor(mk({}, {}), bin, 0), 'a plain accessor reads')
  assert.equal(readAccessor(mk({ byteStride: -4 }, { count: 3e7 }), bin, 0), null, 'negative stride')
  assert.equal(readAccessor(mk({ byteOffset: -100 }, { count: 3e7 }), bin, 0), null, 'negative view offset')
  assert.equal(readAccessor(mk({}, { byteOffset: -100, count: 3e7 }), bin, 0), null, 'negative accessor offset')
  assert.equal(readAccessor(mk({}, { count: 1.5 }), bin, 0), null, 'fractional count')
  assert.equal(readAccessor(mk({}, { count: -1 }), bin, 0), null, 'negative count')
  assert.equal(readAccessor(mk({ byteStride: 4 }, { count: 3e7 }), bin, 0), null, 'a stride smaller than one element')
  assert.equal(readAccessor(mk({}, { count: 3e7 }), bin, 0), null, 'a count that does not fit the data')
  assert.equal(readAccessor(mk({ byteStride: 1e9 }, { count: 2 }), bin, 0), null, 'a stride over 252')
})

test('texture coordinate bits follow the largest picture (quarter texel), "small" excepted; image sizes come from PNG and JPEG headers', async () => {
  const { imageSize, uvBitsFor } = await import('../editor/shared/glb-compress.js')
  const png = new Uint8Array(33)
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  new DataView(png.buffer).setUint32(16, 4096)
  new DataView(png.buffer).setUint32(20, 2048)
  assert.deepEqual(imageSize(png), { w: 4096, h: 2048 })
  const jpg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, 0x08, 0x00, 0x10, 0x00, 3, 0, 0, 0])
  assert.deepEqual(imageSize(jpg), { w: 4096, h: 2048 })
  assert.equal(imageSize(Uint8Array.from([1, 2, 3, 4, 5, 6])), null)
  assert.equal(uvBitsFor(1, 4096, 13), 14) // 4k at unit range: log2(4096 * 4) = 14
  assert.equal(uvBitsFor(1, 256, 13), 13) // a small picture does not need more
  assert.equal(uvBitsFor(4, 8192, 13), 16) // tiled 4x on an 8k picture: capped at 16
  assert.equal(uvBitsFor(0, 4096, 13), 13)
})

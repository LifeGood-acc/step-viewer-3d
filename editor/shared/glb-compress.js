// Shared by 3D Model Viewer and STEP Viewer 3D (canonical copy: plugins/_shared; do not edit the copies in editor/shared).
// Makes a GLB smaller as a COPY: vertex welding and reordering, quantization (exponent filter for positions, octahedral normals, 16-bit
// colors), meshopt compression (EXT_meshopt_compression, which the viewers and Orca open), and smaller textures.
// Pure: no DOM, no three.js. The meshopt encoder and a function that re-encodes an image are passed in (so Node tests need no browser).

const enc = new TextEncoder()
const dec = new TextDecoder()

export const COMPONENT = { 5120: [Int8Array, 1], 5121: [Uint8Array, 1], 5122: [Int16Array, 2], 5123: [Uint16Array, 2], 5125: [Uint32Array, 4], 5126: [Float32Array, 4] }
const COMPS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 }

export function parseGlb(bytes) {
  if (bytes.length < 20) throw new Error('not a GLB file')
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('not a GLB file')
  const jl = dv.getUint32(12, true)
  if (dv.getUint32(16, true) !== 0x4e4f534a || 20 + jl > bytes.length) throw new Error('damaged GLB file')
  const json = JSON.parse(dec.decode(bytes.subarray(20, 20 + jl)))
  let bin = new Uint8Array(0)
  const o = 20 + jl
  if (o + 8 <= bytes.length && dv.getUint32(o + 4, true) === 0x004e4942) bin = bytes.subarray(o + 8, o + 8 + dv.getUint32(o, true))
  return { json, bin }
}

export function buildGlb(json, binChunks) {
  let js = enc.encode(JSON.stringify(json))
  const pad = (4 - (js.length % 4)) % 4
  if (pad) {
    const t = new Uint8Array(js.length + pad)
    t.set(js)
    t.fill(0x20, js.length)
    js = t
  }
  let binLen = 0
  for (const c of binChunks) binLen += c.length
  const binPad = (4 - (binLen % 4)) % 4
  const total = 12 + 8 + js.length + 8 + binLen + binPad
  const out = new Uint8Array(total)
  const dv = new DataView(out.buffer)
  dv.setUint32(0, 0x46546c67, true)
  dv.setUint32(4, 2, true)
  dv.setUint32(8, total, true)
  dv.setUint32(12, js.length, true)
  dv.setUint32(16, 0x4e4f534a, true)
  out.set(js, 20)
  const o = 20 + js.length
  dv.setUint32(o, binLen + binPad, true)
  dv.setUint32(o + 4, 0x004e4942, true)
  let w = o + 8
  for (const c of binChunks) {
    out.set(c, w)
    w += c.length
  }
  return out
}

/** Reads an accessor into a fresh typed array (tight, no stride). Null for sparse accessors or data that is out of range. */
export function readAccessor(json, bin, index) {
  const a = json.accessors[index]
  if (!a || a.sparse || a.bufferView === undefined) return null
  const [Ctor, size] = COMPONENT[a.componentType] || []
  if (!Ctor) return null
  const comps = COMPS[a.type]
  if (!comps) return null
  const bv = json.bufferViews[a.bufferView]
  if (!bv || bv.extensions) return null
  // everything here comes from the file's JSON: numbers must be whole and in range BEFORE a size is worked out or an array is allocated (a negative
  // stride or offset would make the "needed bytes" small while the count asks for gigabytes)
  const rowBytes = comps * size
  const whole = (v) => Number.isSafeInteger(v) && v >= 0
  if (!whole(a.count) || (a.byteOffset !== undefined && !whole(a.byteOffset)) || (bv.byteOffset !== undefined && !whole(bv.byteOffset))) return null
  if (bv.byteStride !== undefined && !(Number.isInteger(bv.byteStride) && bv.byteStride >= rowBytes && bv.byteStride <= 252)) return null
  const stride = bv.byteStride || rowBytes
  const start = (bv.byteOffset || 0) + (a.byteOffset || 0)
  const need = a.count === 0 ? 0 : stride * (a.count - 1) + rowBytes
  if (start + need > bin.length) return null
  const out = new Ctor(a.count * comps)
  const outBytes = new Uint8Array(out.buffer)
  for (let i = 0; i < a.count; i++) outBytes.set(bin.subarray(start + i * stride, start + i * stride + rowBytes), i * rowBytes)
  return { array: out, comps, count: a.count, componentType: a.componentType, normalized: !!a.normalized }
}

// Merges vertices whose bytes are identical in every stream. streams: [{ bytes: Uint8Array, stride }] of `count` vertices each.
export function weldVertices(streams, count, indices) {
  let size = 16
  while (size < count * 2) size *= 2
  const mask = size - 1
  const table = new Int32Array(size).fill(-1)
  const remap = new Uint32Array(count)
  const keep = []
  const equal = (a, b) => {
    for (const s of streams) {
      const x = a * s.stride
      const y = b * s.stride
      for (let k = 0; k < s.stride; k++) if (s.bytes[x + k] !== s.bytes[y + k]) return false
    }
    return true
  }
  for (let i = 0; i < count; i++) {
    let h = 0x811c9dc5
    for (const s of streams) {
      const x = i * s.stride
      for (let k = 0; k < s.stride; k++) h = Math.imul(h ^ s.bytes[x + k], 0x01000193)
    }
    h = (h ^ (h >>> 15)) >>> 0
    let slot = h & mask
    for (;;) {
      const v = table[slot]
      if (v < 0) {
        table[slot] = keep.length
        remap[i] = keep.length
        keep.push(i)
        break
      }
      if (equal(keep[v], i)) {
        remap[i] = v
        break
      }
      slot = (slot + 1) & mask
    }
  }
  const outIdx = new Uint32Array(indices.length)
  for (let i = 0; i < indices.length; i++) outIdx[i] = remap[indices[i]]
  return { keep: Uint32Array.from(keep), indices: outIdx }
}

const gather = (bytes, stride, keepOrRemap, count, byRemap) => {
  const out = new Uint8Array(count * stride)
  if (byRemap) {
    // remap[old] = new (0xffffffff: unused)
    for (let i = 0; i < keepOrRemap.length; i++) {
      const n = keepOrRemap[i]
      if (n !== 0xffffffff) out.set(bytes.subarray(i * stride, i * stride + stride), n * stride)
    }
  } else {
    for (let i = 0; i < count; i++) out.set(bytes.subarray(keepOrRemap[i] * stride, keepOrRemap[i] * stride + stride), i * stride)
  }
  return out
}
const bytesOf = (typed) => new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength)

/**
 * Whether the exponent filter with `bits` bits keeps the shape of these vectors: a vertex's components share one exponent, so the
 * step is about (largest number) / 2^bits, and it must stay below a thousandth of the smallest extent along any axis.
 */
export function quantizationKeepsDetail(floats, comps, bits) {
  const lo = new Array(comps).fill(Infinity)
  const hi = new Array(comps).fill(-Infinity)
  let maxAbs = 0
  for (let i = 0; i < floats.length; i++) {
    const k = i % comps
    const v = floats[i]
    if (!Number.isFinite(v)) return false
    if (v < lo[k]) lo[k] = v
    if (v > hi[k]) hi[k] = v
    if (Math.abs(v) > maxAbs) maxAbs = Math.abs(v)
  }
  const extents = lo.map((l, k) => hi[k] - l).filter((e) => e > 0)
  if (!extents.length) return true
  return maxAbs / 2 ** bits <= Math.min(...extents) / 1000
}

/** Width and height of a PNG or JPEG from its header, or null (WebP and anything else: unknown). */
export function imageSize(b) {
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
    return { w: dv.getUint32(16), h: dv.getUint32(20) }
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null
      const m = b[i + 1]
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: (b[i + 5] << 8) | b[i + 6], w: (b[i + 7] << 8) | b[i + 8] }
      i += 2 + ((b[i + 2] << 8) | b[i + 3])
    }
  }
  return null
}

/** Bits for texture coordinates so that the step stays under a quarter of a texel on the largest picture (never below `base`, at most 16). */
export function uvBitsFor(maxAbs, maxTexture, base) {
  if (!(maxAbs > 0) || !(maxTexture > 0)) return base
  return Math.min(16, Math.max(base, Math.ceil(Math.log2(maxAbs * maxTexture * 4))))
}

/** Target levels: bits for positions / texture coordinates / colors. */
export const PRECISION = {
  fine: { pos: 18, uv: 16, color: 14, normal: 8 },
  balanced: { pos: 14, uv: 13, color: 12, normal: 8 },
  small: { pos: 11, uv: 11, color: 10, normal: 7 }
}

/**
 * Compresses the geometry of a GLB. Returns { json, chunks (for buffer 0), fallbackLength, stats } with the images still untouched in
 * `images` (the caller re-encodes them and adds their bytes). `reorder` is on unless a primitive shares data or has morph targets.
 */
export function compressGeometry(input, { encoder, precision = 'balanced', onProgress, isCancelled }) {
  const { json, bin } = input
  const P = PRECISION[precision] || PRECISION.balanced
  let maxTex = 0 // the largest picture of the file (PNG/JPEG headers): texture coordinates must be fine enough for it
  for (const im of json.images || []) {
    const v = im.bufferView !== undefined ? (json.bufferViews || [])[im.bufferView] : null
    if (!v || (v.buffer || 0) !== 0 || !Number.isFinite(v.byteLength) || (v.byteOffset || 0) + v.byteLength > bin.length) continue
    const sz = imageSize(bin.subarray(v.byteOffset || 0, (v.byteOffset || 0) + v.byteLength))
    if (sz) maxTex = Math.max(maxTex, sz.w, sz.h)
  }
  const out = structuredClone(json)
  const newViews = []
  const newAccessors = out.accessors ? out.accessors.map((a) => ({ ...a })) : []
  const chunks = []
  let binLen = 0
  let fallbackLen = 0
  const stats = { trianglesIn: 0, trianglesOut: 0, verticesIn: 0, verticesOut: 0, accessorsCompressed: 0, quantization: false, bytesBefore: bin.length }
  const align4 = () => {
    const pad = (4 - (binLen % 4)) % 4
    if (pad) {
      chunks.push(new Uint8Array(pad))
      binLen += pad
    }
  }
  const addRaw = (bytes, target) => {
    align4()
    newViews.push({ buffer: 0, byteOffset: binLen, byteLength: bytes.length, ...(target ? { target } : {}) })
    chunks.push(bytes)
    binLen += bytes.length
    return newViews.length - 1
  }
  // a compressed view: the data in buffer 0, the (virtual) decoded copy described in the fallback buffer 1
  const addCompressed = (source, count, stride, mode, filter, target) => {
    const packed = encoder.encodeGltfBuffer(source, count, stride, mode)
    align4()
    const decoded = count * stride
    const fb = Math.ceil(fallbackLen / 4) * 4
    fallbackLen = fb + decoded
    newViews.push({
      buffer: 1,
      byteOffset: fb,
      byteLength: decoded,
      ...(mode === 'TRIANGLES' || mode === 'INDICES' ? {} : { byteStride: stride }),
      ...(target ? { target } : {}),
      extensions: { EXT_meshopt_compression: { buffer: 0, byteOffset: binLen, byteLength: packed.length, byteStride: stride, mode, ...(filter && filter !== 'NONE' ? { filter } : {}), count } }
    })
    chunks.push(packed)
    binLen += packed.length
    stats.accessorsCompressed++
    return newViews.length - 1
  }
  const done = new Set() // accessors already replaced
  const usage = new Map() // accessor -> number of primitives that use it
  const meshes = out.meshes || []
  for (const m of meshes) {
    for (const p of m.primitives || []) {
      for (const a of [...Object.values(p.attributes || {}), p.indices, ...(p.targets || []).flatMap((t) => Object.values(t))]) if (a !== undefined) usage.set(a, (usage.get(a) || 0) + 1)
    }
  }
  const setAccessor = (idx, view, extra) => {
    const a = newAccessors[idx]
    delete a.byteOffset
    a.bufferView = view
    Object.assign(a, extra)
    done.add(idx)
  }
  let primCount = 0
  for (const m of meshes) primCount += (m.primitives || []).length
  let primDone = 0
  for (const mesh of meshes) {
    for (const prim of mesh.primitives || []) {
      if (isCancelled && isCancelled()) throw new Error('cancelled')
      if (onProgress) onProgress(primDone++ / Math.max(1, primCount), 'geometry')
      const mode = prim.mode === undefined ? 4 : prim.mode
      const attrs = Object.entries(prim.attributes || {})
      const posIdx = prim.attributes && prim.attributes.POSITION
      if (posIdx === undefined || (mode !== 4 && mode !== 0)) continue
      if (attrs.some(([, a]) => done.has(a)) || (prim.indices !== undefined && done.has(prim.indices))) continue // shared with a primitive that is already done
      const pos = readAccessor(json, bin, posIdx)
      if (!pos || pos.componentType !== 5126 || pos.comps !== 3) continue
      const streams = []
      let ok = true
      for (const [name, idx] of attrs) {
        const r = readAccessor(json, bin, idx)
        if (!r || r.count !== pos.count) {
          ok = false
          break
        }
        streams.push({ name, idx, r })
      }
      /** @type {Uint32Array | null} */
      let indices = null
      if (mode === 4) {
        if (prim.indices !== undefined) {
          const r = readAccessor(json, bin, prim.indices)
          if (!r || r.comps !== 1 || ![5121, 5123, 5125].includes(r.componentType)) ok = false
          else indices = Uint32Array.from(r.array)
        } else {
          indices = Uint32Array.from({ length: pos.count }, (_, i) => i)
        }
        if (indices && (indices.length % 3 !== 0 || indices.some((v) => v >= pos.count))) ok = false
      }
      if (!ok) continue
      const exclusive = attrs.every(([, a]) => usage.get(a) === 1) && (prim.indices === undefined || usage.get(prim.indices) === 1) && !(prim.targets && prim.targets.length)
      let count = pos.count
      stats.verticesIn += count
      if (mode === 4) stats.trianglesIn += (indices ? indices.length : 0) / 3
      // streams as bytes
      let raw = streams.map((s) => ({ ...s, bytes: bytesOf(s.r.array), stride: s.r.comps * s.r.array.BYTES_PER_ELEMENT }))
      if (exclusive) {
        if (mode === 4) {
          const w = weldVertices(raw, count, indices)
          raw = raw.map((s) => ({ ...s, bytes: gather(s.bytes, s.stride, w.keep, w.keep.length, false) }))
          count = w.keep.length
          indices = w.indices
          const [remap, unique] = encoder.reorderMesh(indices, true, true) // reorders `indices` in place
          raw = raw.map((s) => ({ ...s, bytes: gather(s.bytes, s.stride, remap, unique, true) }))
          count = unique
        } else if (prim.indices === undefined) {
          const positions = new Float32Array(raw.find((s) => s.name === 'POSITION').bytes.buffer.slice(0))
          const remap = encoder.reorderPoints(positions, 3)
          raw = raw.map((s) => ({ ...s, bytes: gather(s.bytes, s.stride, remap, count, true) }))
        }
      }
      stats.verticesOut += count
      for (const s of raw) {
        const a = newAccessors[s.idx]
        const src = s.bytes
        const f32 = () => new Float32Array(src.buffer, src.byteOffset, src.byteLength / 4)
        const src32 = () => (src.byteOffset % 4 === 0 ? f32() : new Float32Array(src.slice().buffer))
        if (s.name === 'POSITION') {
          // the exponent filter keeps a number of bits relative to the size of the numbers, not of the model: a model far from the
          // origin would lose its shape, so such positions are stored exactly (the codec still packs them)
          if (!quantizationKeepsDetail(src32(), 3, P.pos)) {
            stats.exactPositions = true
            setAccessor(s.idx, addCompressed(src, count, 12, 'ATTRIBUTES', 'NONE', 34962), { count })
          } else {
            const q = encoder.encodeFilterExp(src32(), count, 12, P.pos, 'SharedVector')
            setAccessor(s.idx, addCompressed(q, count, 12, 'ATTRIBUTES', 'EXPONENTIAL', 34962), { count })
          }
        } else if (s.name === 'NORMAL' && a.componentType === 5126 && a.type === 'VEC3') {
          const f = src32()
          const four = new Float32Array(count * 4)
          for (let i = 0; i < count; i++) {
            const x = f[3 * i]
            const y = f[3 * i + 1]
            const z = f[3 * i + 2]
            const l = Math.hypot(x, y, z) || 1
            four[4 * i] = x / l
            four[4 * i + 1] = y / l
            four[4 * i + 2] = z / l
          }
          const q = encoder.encodeFilterOct(four, count, 4, P.normal)
          stats.quantization = true
          setAccessor(s.idx, addCompressed(q, count, 4, 'ATTRIBUTES', 'OCTAHEDRAL', 34962), { count, componentType: 5120, normalized: true })
        } else if (/^TEXCOORD_/.test(s.name) && a.componentType === 5126 && a.type === 'VEC2') {
          let uvBits = P.uv
          if (precision !== 'small' && maxTex > 0) {
            let m = 0
            for (const v of src32()) if (Math.abs(v) > m) m = Math.abs(v)
            uvBits = uvBitsFor(m, maxTex, P.uv) // "smallest" accepts about 2 px; the other levels keep a quarter texel
          }
          if (!quantizationKeepsDetail(src32(), 2, uvBits)) {
            setAccessor(s.idx, addCompressed(src, count, 8, 'ATTRIBUTES', 'NONE', 34962), { count })
          } else {
            const q = encoder.encodeFilterExp(src32(), count, 8, uvBits, 'SharedVector')
            setAccessor(s.idx, addCompressed(q, count, 8, 'ATTRIBUTES', 'EXPONENTIAL', 34962), { count })
          }
        } else if (/^COLOR_/.test(s.name) && a.componentType === 5126 && (a.type === 'VEC3' || a.type === 'VEC4')) {
          // 16-bit normalized RGBA; the low bits are cleared (precision.color bits are kept) so the codec packs them tightly
          const f = src32()
          const comps = a.type === 'VEC3' ? 3 : 4
          const q = new Uint16Array(count * 4)
          const drop = 16 - P.color
          const clamp = (v) => Math.min(65535, Math.max(0, Math.round(v * 65535)))
          for (let i = 0; i < count; i++) {
            for (let k = 0; k < 3; k++) q[4 * i + k] = (clamp(f[comps * i + k]) >> drop) << drop
            q[4 * i + 3] = comps === 4 ? (clamp(f[4 * i + 3]) >> drop) << drop : 65535
          }
          stats.colorsQuantized = true
          setAccessor(s.idx, addCompressed(bytesOf(q), count, 8, 'ATTRIBUTES', 'NONE', 34962), { count, componentType: 5123, normalized: true, type: 'VEC4' })
          delete newAccessors[s.idx].min
          delete newAccessors[s.idx].max
        } else if (s.stride % 4 === 0 && s.stride <= 256) {
          setAccessor(s.idx, addCompressed(src, count, s.stride, 'ATTRIBUTES', 'NONE', 34962), { count }) // lossless
        } else {
          setAccessor(s.idx, addRaw(src, 34962), { count })
        }
      }
      if (mode === 4) {
        const small = count <= 65535
        if (!indices) throw new Error('indices missing') // set above for every mode 4 primitive
        const idx = small ? Uint16Array.from(indices) : indices
        setAccessor(prim.indices !== undefined ? prim.indices : newAccessors.push({ componentType: 5125, count: 0, type: 'SCALAR' }) - 1, addCompressed(bytesOf(idx), indices.length, small ? 2 : 4, 'TRIANGLES', 'NONE', 34963), { count: indices.length, componentType: small ? 5123 : 5125 })
        if (prim.indices === undefined) prim.indices = newAccessors.length - 1
        stats.trianglesOut += indices.length / 3
      }
    }
  }
  // everything else keeps its bytes: animation, skins, morph targets, anything the above could not handle (images are done by the caller)
  const imageViews = new Set((json.images || []).map((i) => i.bufferView).filter((v) => v !== undefined))
  const viewMap = new Map()
  const copyView = (vi) => {
    if (viewMap.has(vi)) return viewMap.get(vi)
    const v = json.bufferViews[vi]
    const bytes = bin.subarray(v.byteOffset || 0, (v.byteOffset || 0) + v.byteLength)
    align4()
    const nv = { ...v, buffer: 0, byteOffset: binLen }
    delete nv.extensions
    newViews.push(nv)
    chunks.push(bytes)
    binLen += bytes.length
    viewMap.set(vi, newViews.length - 1)
    return newViews.length - 1
  }
  newAccessors.forEach((a, i) => {
    if (done.has(i) || a.bufferView === undefined) return
    if (imageViews.has(a.bufferView)) return
    a.bufferView = copyView(a.bufferView)
  })
  out.accessors = newAccessors
  // sparse accessors point at views too
  for (const a of out.accessors) {
    if (a.sparse) {
      a.sparse = structuredClone(a.sparse)
      a.sparse.indices.bufferView = copyView(a.sparse.indices.bufferView)
      a.sparse.values.bufferView = copyView(a.sparse.values.bufferView)
    }
  }
  // images keep their view slot; the caller fills in the new bytes
  const dataSet = dataImages(json)
  const imageSlots = []
  ;(out.images || []).forEach((im, i) => {
    if (im.bufferView === undefined) return
    const v = json.bufferViews[im.bufferView]
    imageSlots.push({ image: i, bytes: bin.subarray(v.byteOffset || 0, (v.byteOffset || 0) + v.byteLength), mimeType: im.mimeType, data: dataSet.has(i) })
  })
  out.bufferViews = newViews
  stats.geometryBytes = binLen
  return { json: out, chunks, binLength: binLen, fallbackLength: fallbackLen, imageSlots, stats, addRaw: (bytes) => addRaw(bytes), state: { newViews, chunks, get binLen() { return binLen }, set binLen(v) { binLen = v } } }
}

// Images that hold data, not a picture (normals, occlusion, metal/roughness, and the textures of the KHR_materials_* extensions except
// the colors): they must not go through a lossy JPEG. Returns a Set of image indices.
export function dataImages(json) {
  const textureIndices = new Set()
  const visit = (o, key) => {
    if (!o || typeof o !== 'object') return
    if (Number.isInteger(o.index) && /Texture$/.test(key || '') && !/^(baseColor|emissive|diffuse|sheenColor|specularColor)Texture$/.test(key)) textureIndices.add(o.index)
    for (const [k, v] of Object.entries(o)) visit(v, k)
  }
  for (const m of json.materials || []) visit(m, '')
  const out = new Set()
  for (const i of textureIndices) {
    const tex = (json.textures || [])[i]
    if (tex && Number.isInteger(tex.source)) out.add(tex.source)
    const webp = tex && tex.extensions && tex.extensions.EXT_texture_webp
    if (webp && Number.isInteger(webp.source)) out.add(webp.source)
  }
  return out
}

/**
 * Compresses a whole GLB. opts: { precision, texMax (0: keep), targetBytes, quality }, deps: { encoder, recodeImage(bytes, mime, { maxSize, quality }) -> { bytes, mimeType, width, height } | null, onProgress, isCancelled }.
 * Returns { bytes, report }.
 */
export async function compressGlb(glb, opts, deps) {
  const { encoder, recodeImage, onProgress, isCancelled } = deps
  if (!encoder || !encoder.supported) throw new Error('no_encoder')
  const input = parseGlb(glb)
  if ((input.json.extensionsUsed || []).some((e) => /EXT_meshopt_compression|KHR_draco_mesh_compression/.test(e))) throw new Error('already_compressed')
  const target = opts.targetBytes || 45 * 1048576
  const precisions = [opts.precision || 'balanced']
  if (precisions[0] !== 'small') precisions.push('small') // the second try when even the geometry alone is too big
  /** @type {{ inputBytes: number, targetBytes: number, steps: any[], suggestions: string[], [k: string]: any }} */
  const report = { inputBytes: glb.length, targetBytes: target, steps: [], suggestions: [], textures: { before: { count: 0, bytes: 0 }, after: { count: 0, bytes: 0, maxSize: 0 } } }
  const images = (input.json.images || []).filter((i) => i.bufferView !== undefined)
  for (const im of images) {
    const v = input.json.bufferViews[im.bufferView]
    report.textures.before.count++
    report.textures.before.bytes += v.byteLength
  }
  /** @type {any} */
  let best = null
  for (const precision of precisions) {
    if (isCancelled && isCancelled()) throw new Error('cancelled')
    const g = compressGeometry(input, { encoder, precision, onProgress: (f, l) => onProgress && onProgress(f * 0.5, l), isCancelled })
    report.steps.push({ step: 'geometry', precision, bytes: g.stats.geometryBytes })
    report.geometryBytes = g.stats.geometryBytes
    report.stats = g.stats
    report.precision = precision
    // images: try the planned levels until the file fits
    const jsonBase = JSON.stringify(g.json).length + 2000
    const budgetForImages = target - g.stats.geometryBytes - jsonBase
    let imageOut = []
    let imageBytes = 0
    if (g.imageSlots.length) {
      if (!recodeImage) {
        imageOut = g.imageSlots.map((s) => ({ ...s, out: s.bytes }))
        imageBytes = imageOut.reduce((a, s) => a + s.out.length, 0)
      } else {
        const sizes = []
        const start = opts.texMax || 0
        if (budgetForImages <= 0) sizes.push(128) // the geometry alone is over the target: the textures go to the smallest size at once
        else sizes.push(start)
        let s = start || 4096
        while (budgetForImages > 0 && s > 128) {
          s = Math.max(128, Math.floor(s * 0.75 / 16) * 16)
          sizes.push(s)
          if (s === 128) break
        }
        const qualities = budgetForImages <= 0 ? [0.55] : [opts.quality || 0.85, 0.7, 0.55]
        /** @type {any} */
        let found = null
        let tries = 0
        outer: for (const maxSize of sizes) {
          for (const quality of qualities) {
            if (isCancelled && isCancelled()) throw new Error('cancelled')
            tries++
            if (onProgress) onProgress(0.5 + 0.45 * Math.min(1, tries / 10), 'textures')
            const outs = []
            let total = 0
            for (const slot of g.imageSlots) {
              const r = await recodeImage(slot.bytes, slot.mimeType, { maxSize, quality, lossless: slot.data })
              const use = r && r.bytes.length < slot.bytes.length ? r : { bytes: slot.bytes, mimeType: slot.mimeType, width: r ? r.width : 0, height: r ? r.height : 0 }
              outs.push({ ...slot, out: use.bytes, outMime: use.mimeType, width: use.width, height: use.height })
              total += use.bytes.length
            }
            found = { outs, total, maxSize, quality }
            report.steps.push({ step: 'textures', maxSize, quality, bytes: total })
            if (total <= budgetForImages) break outer
          }
        }
        imageOut = found.outs
        imageBytes = found.total
        report.textures.after.maxSize = Math.max(0, ...imageOut.map((s) => s.width || 0), ...imageOut.map((s) => s.height || 0))
      }
    }
    report.textures.after.count = imageOut.length
    report.textures.after.bytes = imageBytes
    // assemble
    const { json, chunks, state } = g
    const j = json
    for (const slot of imageOut) {
      const bytes = slot.out
      const pad = (4 - (state.binLen % 4)) % 4
      if (pad) {
        chunks.push(new Uint8Array(pad))
        state.binLen += pad
      }
      j.bufferViews.push({ buffer: 0, byteOffset: state.binLen, byteLength: bytes.length })
      chunks.push(bytes)
      state.binLen += bytes.length
      j.images[slot.image].bufferView = j.bufferViews.length - 1
      if (slot.outMime) j.images[slot.image].mimeType = slot.outMime
    }
    j.buffers = [{ byteLength: state.binLen }, { byteLength: g.fallbackLength, extensions: { EXT_meshopt_compression: { fallback: true } } }]
    const used = new Set([...(j.extensionsUsed || []), 'EXT_meshopt_compression'])
    const required = new Set([...(j.extensionsRequired || []), 'EXT_meshopt_compression'])
    if (g.stats.quantization) {
      used.add('KHR_mesh_quantization')
      required.add('KHR_mesh_quantization')
    }
    j.extensionsUsed = [...used]
    j.extensionsRequired = [...required]
    const bytes = buildGlb(j, chunks)
    report.bytes = bytes.length
    // keep the smallest of the tries (a later try with a stricter setting can come out larger: it must not replace a smaller one)
    if (!best || bytes.length < best.bytes.length) best = { bytes, precision, snap: { geometryBytes: report.geometryBytes, stats: report.stats, precision, bytes: bytes.length, textures: JSON.parse(JSON.stringify(report.textures)) } }
    if (bytes.length <= target) break
  }
  Object.assign(report, best.snap)
  report.reached = best.bytes.length <= target
  if (!report.reached) {
    if (report.geometryBytes > target * 0.9) report.suggestions.push('reduce_geometry')
    if (report.textures.after.count) report.suggestions.push('smaller_textures')
    report.suggestions.push('hide_parts')
  }
  return { bytes: best.bytes, report }
}

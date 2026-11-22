// Shared by 3D Model Viewer and STEP Viewer 3D (canonical copy: plugins/_shared; do not edit the copies in editor/shared).
// Writes COPIES of a model in other formats from plain arrays. Pure: no DOM, no three.js, no network; it runs in a browser and in Node.
//
// A "part" is the common form every writer takes (the viewer builds it from its scene, already in the coordinate frame of the copy):
//   { name: string,
//     kind: 'mesh' | 'points',
//     positions: Float32Array,        x y z per vertex
//     indices: Uint32Array | null,    three vertex numbers per triangle; null: the vertices are consecutive triangles
//     normals: Float32Array | null,   x y z per vertex (only the glTF writer uses them)
//     colors: Uint8Array | null,      r g b per vertex, sRGB 0..255
//     color: [r, g, b] | null }       one sRGB color for the whole part (null: the model has no real color, the viewer's gray is not data)

export const MiB = 1024 * 1024
/** Orca opens a file in a tab only up to 50 MiB. */
export const OPEN_MAX_BYTES = 50 * MiB
/** files.saveAs takes up to 64 MiB, the message envelope included. */
export const SAVE_MAX_BYTES = 64 * MiB - 8192

/** 'opens': the copy fits in a tab; 'no-open': Orca saves it but cannot open it in a tab; 'too-large': the Save dialog refuses it. */
export function sizeVerdict(bytes) {
  if (bytes <= OPEN_MAX_BYTES) return 'opens'
  return bytes <= SAVE_MAX_BYTES ? 'no-open' : 'too-large'
}

export const FORMATS = {
  glb: { ext: 'glb', mime: 'model/gltf-binary', kind: 'mesh' },
  glbc: { ext: 'glb', mime: 'model/gltf-binary', kind: 'mesh' }, // the same file type, compressed (see glb-compress.js)
  stl: { ext: 'stl', mime: 'model/stl', kind: 'mesh' },
  obj: { ext: 'obj', mime: 'model/obj', kind: 'mesh' },
  ply: { ext: 'ply', mime: 'application/octet-stream', kind: 'mesh' },
  '3mf': { ext: '3mf', mime: 'model/3mf', kind: 'mesh' },
  png: { ext: 'png', mime: 'image/png', kind: 'image' },
  webm: { ext: 'webm', mime: 'video/webm', kind: 'video' }
}

export const triangleCount = (p) => (p.kind !== 'mesh' ? 0 : p.indices ? Math.floor(p.indices.length / 3) : Math.floor(p.positions.length / 9))
export const vertexCount = (p) => Math.floor(p.positions.length / 3)

/**
 * Triangles that point at vertices that do not exist are dropped (they would write garbage); with `degenerate`, triangles that use one
 * vertex twice are dropped as well (strict 3MF readers refuse them). Returns the same part when nothing needs to go.
 */
export function cleanPart(p, { degenerate = false } = {}) {
  if (p.kind !== 'mesh') return p
  const n = vertexCount(p)
  const idx = p.indices
  const count = triangleCount(p)
  const bad = (a, b, c) => !(a < n && b < n && c < n) || (degenerate && (a === b || b === c || a === c))
  let any = false
  for (let t = 0; t < count && !any; t++) {
    const a = idx ? idx[3 * t] : 3 * t
    const b = idx ? idx[3 * t + 1] : 3 * t + 1
    const c = idx ? idx[3 * t + 2] : 3 * t + 2
    if (bad(a, b, c)) any = true
  }
  if (!any) return p
  const keep = []
  for (let t = 0; t < count; t++) {
    const a = idx ? idx[3 * t] : 3 * t
    const b = idx ? idx[3 * t + 1] : 3 * t + 1
    const c = idx ? idx[3 * t + 2] : 3 * t + 2
    if (!bad(a, b, c)) keep.push(a, b, c)
  }
  return { ...p, indices: Uint32Array.from(keep) }
}

/** A rough size of the copy before it is built (the real size is shown after). counts: { tris, verts, points }. */
export function estimateBytes(format, { tris = 0, verts = 0, points = 0 }) {
  switch (format) {
    case 'stl': return 84 + 50 * tris
    case 'ply': return 200 + 15 * (verts + points) + 13 * tris
    case 'obj': return 45 * (verts + points) + 20 * tris
    case '3mf': return Math.round((45 * verts + 45 * tris) * 0.3) + 2000
    case 'glb': return 1000 + 36 * verts + 12 * points + 12 * tris
    case 'glbc': return 2000 + 9 * verts + 6 * points + 3 * tris // meshopt compressed, balanced precision (without textures)
    default: return 0
  }
}

// ---------- orientation ----------
/**
 * The rotation that turns a model whose "up" is `fileUp` ('y', '-y' or 'z', the viewer's "Up is" choice) into a copy whose up is
 * `target`: 'y' (glTF), 'z' (STL, 3MF, CAD) or 'keep' (leave the coordinates as they are). Returns null for "no change", else a 3x3
 * matrix as nine numbers, row by row. Always a proper rotation, so triangle winding is kept.
 */
export function exportRotation(fileUp, target) {
  if (target === 'keep' || !['y', '-y', 'z'].includes(fileUp) || !['y', 'z'].includes(target)) return null
  // file -> Y up
  let m = fileUp === 'y' ? I3 : fileUp === '-y' ? [1, 0, 0, 0, -1, 0, 0, 0, -1] : [1, 0, 0, 0, 0, 1, 0, -1, 0]
  // Y up -> target
  if (target === 'z') m = mul3([1, 0, 0, 0, 0, -1, 0, 1, 0], m)
  return m.every((v, i) => v === I3[i]) ? null : m
}
const I3 = [1, 0, 0, 0, 1, 0, 0, 0, 1]
const mul3 = (a, b) => {
  const r = new Array(9).fill(0)
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) r[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j]
  return r.map((v) => (Object.is(v, -0) ? 0 : v))
}
/** Applies a 3x3 rotation (from exportRotation) to xyz triples in place. */
export function rotateInPlace(xyz, m) {
  if (!m) return xyz
  for (let i = 0; i + 2 < xyz.length; i += 3) {
    const x = xyz[i]
    const y = xyz[i + 1]
    const z = xyz[i + 2]
    xyz[i] = m[0] * x + m[1] * y + m[2] * z
    xyz[i + 1] = m[3] * x + m[4] * y + m[5] * z
    xyz[i + 2] = m[6] * x + m[7] * y + m[8] * z
  }
  return xyz
}

// ---------- small helpers ----------
const enc = new TextEncoder()
const num = (v) => (Number.isFinite(v) ? String(+v.toPrecision(8)) : '0')
const hex2 = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')
const hexOf = (c) => `#${hex2(c[0])}${hex2(c[1])}${hex2(c[2])}`.toUpperCase()
const srgbToLinear = (u8) => {
  const c = u8 / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}
export const xmlEscape = (s) => String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, '')
const lineName = (s) => String(s || 'part').replace(/[\r\n\t]+/g, ' ').trim() || 'part'

function concat(chunks) {
  let n = 0
  for (const c of chunks) n += c.length
  const out = new Uint8Array(n)
  let o = 0
  for (const c of chunks) {
    out.set(c, o)
    o += c.length
  }
  return out
}

// A line sink that encodes in blocks, so a huge text file never becomes one giant string.
function textSink() {
  const chunks = []
  let lines = []
  return {
    push(s) {
      lines.push(s)
      if (lines.length >= 40000) {
        chunks.push(enc.encode(lines.join('\n') + '\n'))
        lines = []
      }
    },
    done() {
      if (lines.length) chunks.push(enc.encode(lines.join('\n') + '\n'))
      return concat(chunks)
    }
  }
}

const meshParts = (parts, opts) => parts.filter((p) => p.kind === 'mesh' && vertexCount(p) > 0).map((p) => cleanPart(p, opts)).filter((p) => triangleCount(p) > 0)
const pointParts = (parts) => parts.filter((p) => p.kind === 'points' && vertexCount(p) > 0)

// ---------- STL (binary) ----------
/** One solid with all triangles of all mesh parts. Geometry only: no colors, no names, no units. */
export function writeSTL(parts) {
  const ms = meshParts(parts)
  const n = ms.reduce((a, p) => a + triangleCount(p), 0)
  const out = new Uint8Array(84 + n * 50)
  const dv = new DataView(out.buffer)
  out.set(enc.encode('Binary STL, a copy written by a 3D viewer plugin'), 0)
  dv.setUint32(80, n, true)
  let o = 84
  for (const p of ms) {
    const pos = p.positions
    const idx = p.indices
    const count = triangleCount(p)
    for (let t = 0; t < count; t++) {
      const a = (idx ? idx[3 * t] : 3 * t) * 3
      const b = (idx ? idx[3 * t + 1] : 3 * t + 1) * 3
      const c = (idx ? idx[3 * t + 2] : 3 * t + 2) * 3
      const ux = pos[b] - pos[a]
      const uy = pos[b + 1] - pos[a + 1]
      const uz = pos[b + 2] - pos[a + 2]
      const vx = pos[c] - pos[a]
      const vy = pos[c + 1] - pos[a + 1]
      const vz = pos[c + 2] - pos[a + 2]
      let nx = uy * vz - uz * vy
      let ny = uz * vx - ux * vz
      let nz = ux * vy - uy * vx
      const len = Math.hypot(nx, ny, nz)
      if (len > 0) {
        nx /= len
        ny /= len
        nz /= len
      } else nx = ny = nz = 0
      dv.setFloat32(o, nx, true)
      dv.setFloat32(o + 4, ny, true)
      dv.setFloat32(o + 8, nz, true)
      for (let k = 0; k < 3; k++) {
        const v = k === 0 ? a : k === 1 ? b : c
        dv.setFloat32(o + 12 + 12 * k, pos[v], true)
        dv.setFloat32(o + 16 + 12 * k, pos[v + 1], true)
        dv.setFloat32(o + 20 + 12 * k, pos[v + 2], true)
      }
      o += 50
    }
  }
  return out
}

// ---------- OBJ (text) ----------
/** One object per part (`o name`). Colors only as the common "v x y z r g b" extension: there is no .mtl file. Points become `p` elements. */
export function writeOBJ(parts) {
  const sink = textSink()
  sink.push('# OBJ, a copy written by a 3D viewer plugin')
  const withColor = parts.some((p) => p.colors || p.color)
  let base = 1
  for (const part of parts) {
    const p = cleanPart(part)
    if (!['mesh', 'points'].includes(p.kind) || vertexCount(p) === 0) continue
    if (p.kind === 'mesh' && triangleCount(p) === 0) continue
    sink.push(`o ${lineName(p.name)}`)
    const n = vertexCount(p)
    const pos = p.positions
    for (let i = 0; i < n; i++) {
      let line = `v ${num(pos[3 * i])} ${num(pos[3 * i + 1])} ${num(pos[3 * i + 2])}`
      if (withColor) {
        const c = p.colors ? [p.colors[3 * i], p.colors[3 * i + 1], p.colors[3 * i + 2]] : p.color || [200, 200, 200]
        line += ` ${num(c[0] / 255)} ${num(c[1] / 255)} ${num(c[2] / 255)}`
      }
      sink.push(line)
    }
    if (p.kind === 'points') {
      for (let i = 0; i < n; i++) sink.push(`p ${base + i}`)
    } else {
      const idx = p.indices
      const count = triangleCount(p)
      for (let t = 0; t < count; t++) {
        const a = base + (idx ? idx[3 * t] : 3 * t)
        const b = base + (idx ? idx[3 * t + 1] : 3 * t + 1)
        const c = base + (idx ? idx[3 * t + 2] : 3 * t + 2)
        sink.push(`f ${a} ${b} ${c}`)
      }
    }
    base += n
  }
  return sink.done()
}

// ---------- PLY (binary little endian) ----------
/** Meshes and point clouds in one file, with per-vertex colors when any part has color. Part names are not kept. */
export function writePLY(parts) {
  const ms = meshParts(parts)
  const ps = pointParts(parts)
  const used = [...ms, ...ps]
  const nv = used.reduce((a, p) => a + vertexCount(p), 0)
  const nf = ms.reduce((a, p) => a + triangleCount(p), 0)
  const withColor = used.some((p) => p.colors || p.color)
  const vsize = 12 + (withColor ? 3 : 0)
  const header =
    'ply\nformat binary_little_endian 1.0\ncomment a copy written by a 3D viewer plugin\n' +
    `element vertex ${nv}\nproperty float x\nproperty float y\nproperty float z\n` +
    (withColor ? 'property uchar red\nproperty uchar green\nproperty uchar blue\n' : '') +
    (nf ? `element face ${nf}\nproperty list uchar int vertex_indices\n` : '') +
    'end_header\n'
  const h = enc.encode(header)
  const out = new Uint8Array(h.length + nv * vsize + nf * 13)
  out.set(h, 0)
  const dv = new DataView(out.buffer)
  let o = h.length
  for (const p of used) {
    const n = vertexCount(p)
    for (let i = 0; i < n; i++) {
      dv.setFloat32(o, p.positions[3 * i], true)
      dv.setFloat32(o + 4, p.positions[3 * i + 1], true)
      dv.setFloat32(o + 8, p.positions[3 * i + 2], true)
      if (withColor) {
        const c = p.colors ? [p.colors[3 * i], p.colors[3 * i + 1], p.colors[3 * i + 2]] : p.color || [200, 200, 200]
        out[o + 12] = c[0]
        out[o + 13] = c[1]
        out[o + 14] = c[2]
      }
      o += vsize
    }
  }
  let base = 0
  for (const p of used) {
    if (p.kind === 'mesh') {
      const idx = p.indices
      const count = triangleCount(p)
      for (let t = 0; t < count; t++) {
        out[o] = 3
        dv.setInt32(o + 1, base + (idx ? idx[3 * t] : 3 * t), true)
        dv.setInt32(o + 5, base + (idx ? idx[3 * t + 1] : 3 * t + 1), true)
        dv.setInt32(o + 9, base + (idx ? idx[3 * t + 2] : 3 * t + 2), true)
        o += 13
      }
    }
    base += vertexCount(p)
  }
  return out
}

// ---------- vertex welding (for files that have no shared vertices, such as STL) ----------
/** Merges vertices with exactly the same position. Returns { positions, indices } for a non-indexed mesh. */
export function weldExact(positions) {
  const n = Math.floor(positions.length / 3)
  const bits = new Uint32Array(positions.buffer, positions.byteOffset, positions.length)
  let size = 16
  while (size < n * 2) size *= 2
  const mask = size - 1
  const table = new Int32Array(size).fill(-1)
  const outIdx = new Uint32Array(n)
  const outPos = new Float32Array(positions.length)
  const outBits = new Uint32Array(outPos.buffer)
  let count = 0
  for (let i = 0; i < n; i++) {
    const a = bits[3 * i]
    const b = bits[3 * i + 1]
    const c = bits[3 * i + 2]
    let h = (Math.imul(a, 0x9e3779b1) ^ Math.imul(b, 0x85ebca6b) ^ Math.imul(c, 0xc2b2ae35)) >>> 0
    h = (h ^ (h >>> 15)) & mask
    for (;;) {
      const v = table[h]
      if (v < 0) {
        table[h] = count
        outPos[3 * count] = positions[3 * i]
        outPos[3 * count + 1] = positions[3 * i + 1]
        outPos[3 * count + 2] = positions[3 * i + 2]
        outIdx[i] = count++
        break
      }
      if (outBits[3 * v] === a && outBits[3 * v + 1] === b && outBits[3 * v + 2] === c) {
        outIdx[i] = v
        break
      }
      h = (h + 1) & mask
    }
  }
  return { positions: outPos.slice(0, count * 3), indices: outIdx }
}

// ---------- ZIP (for 3MF) ----------
const CRC = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
export function crc32(u8) {
  let c = 0xffffffff
  for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
async function deflateRaw(u8) {
  const cs = new CompressionStream('deflate-raw')
  const w = cs.writable.getWriter()
  w.write(u8)
  w.close()
  return new Uint8Array(await new Response(cs.readable).arrayBuffer())
}
/** A ZIP archive from [{ name, data: Uint8Array }]. Entries are deflated when the platform has CompressionStream, else stored. */
export async function zip(entries) {
  const files = []
  const central = []
  let offset = 0
  const canDeflate = typeof CompressionStream === 'function'
  for (const e of entries) {
    const name = enc.encode(e.name)
    const raw = e.data
    let data = raw
    let method = 0
    if (canDeflate && raw.length > 64) {
      const d = await deflateRaw(raw)
      if (d.length < raw.length) {
        data = d
        method = 8
      }
    }
    const crc = crc32(raw)
    const head = new Uint8Array(30 + name.length)
    const dv = new DataView(head.buffer)
    dv.setUint32(0, 0x04034b50, true)
    dv.setUint16(4, 20, true)
    dv.setUint16(6, 0x0800, true) // names are UTF-8
    dv.setUint16(8, method, true)
    dv.setUint16(10, 0, true) // time 00:00
    dv.setUint16(12, ((2020 - 1980) << 9) | (1 << 5) | 1, true) // 2020-01-01: the same bytes on every run
    dv.setUint32(14, crc, true)
    dv.setUint32(18, data.length, true)
    dv.setUint32(22, raw.length, true)
    dv.setUint16(26, name.length, true)
    dv.setUint16(28, 0, true)
    head.set(name, 30)
    const cd = new Uint8Array(46 + name.length)
    const cv = new DataView(cd.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(4, 20, true)
    cv.setUint16(6, 20, true)
    cv.setUint16(8, 0x0800, true)
    cv.setUint16(10, method, true)
    cv.setUint16(12, 0, true)
    cv.setUint16(14, ((2020 - 1980) << 9) | (1 << 5) | 1, true)
    cv.setUint32(16, crc, true)
    cv.setUint32(20, data.length, true)
    cv.setUint32(24, raw.length, true)
    cv.setUint16(28, name.length, true)
    cv.setUint32(42, offset, true)
    cd.set(name, 46)
    files.push(head, data)
    central.push(cd)
    offset += head.length + data.length
  }
  const cdBytes = concat(central)
  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, entries.length, true)
  ev.setUint16(10, entries.length, true)
  ev.setUint32(12, cdBytes.length, true)
  ev.setUint32(16, offset, true)
  return concat([...files, cdBytes, end])
}

// ---------- 3MF (core specification) ----------
const UNITS = { mm: 'millimeter', cm: 'centimeter', m: 'meter', in: 'inch', ft: 'foot', µm: 'micron', um: 'micron' }
/** The 3MF unit name for the viewer's short unit ('mm', 'm', ...); anything else (unknown) is written as millimeters. */
export const unitName3mf = (short) => UNITS[String(short || '').toLowerCase()] || 'millimeter'

/**
 * A 3MF package with the core specification only: one object per mesh part (name and a single color), vertices shared, a build item
 * each. Vertex colors and textures are not kept (one color per part: the part's color, or the average of its vertex colors); point
 * clouds cannot be stored in 3MF and are left out. No slicer data (paint, profiles, plates) is written.
 * opts.unit: the viewer's short unit.
 */
export async function write3MF(parts, opts = {}) {
  const ms = meshParts(parts, { degenerate: true })
  const colorsUsed = []
  const colorIndex = new Map()
  const colorOf = (p) => {
    let c = p.color
    if (!c && p.colors && p.colors.length >= 3) {
      let r = 0
      let g = 0
      let b = 0
      const n = p.colors.length / 3
      for (let i = 0; i < p.colors.length; i += 3) {
        r += p.colors[i]
        g += p.colors[i + 1]
        b += p.colors[i + 2]
      }
      c = [r / n, g / n, b / n]
    }
    if (!c) return -1
    const h = hexOf(c)
    if (!colorIndex.has(h)) {
      colorIndex.set(h, colorsUsed.length)
      colorsUsed.push(h)
    }
    return colorIndex.get(h)
  }
  const objectColor = ms.map(colorOf)
  const sink = textSink()
  sink.push('<?xml version="1.0" encoding="UTF-8"?>')
  sink.push(`<model unit="${unitName3mf(opts.unit)}" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">`)
  sink.push(' <metadata name="Application">A 3D viewer plugin (a copy; no slicer data)</metadata>')
  sink.push(' <resources>')
  if (colorsUsed.length) {
    sink.push('  <basematerials id="1">')
    colorsUsed.forEach((h, i) => sink.push(`   <base name="Color ${i + 1}" displaycolor="${h}"/>`))
    sink.push('  </basematerials>')
  }
  ms.forEach((p, k) => {
    let pos = p.positions
    let idx = p.indices
    if (!idx) {
      const w = weldExact(pos)
      pos = w.positions
      idx = w.indices
      const c = cleanPart({ ...p, positions: pos, indices: idx }, { degenerate: true }) // welding can make a sliver use a vertex twice
      idx = c.indices
    }
    const pid = objectColor[k] >= 0 ? ` pid="1" pindex="${objectColor[k]}"` : ''
    sink.push(`  <object id="${k + 2}" type="model" name="${xmlEscape(lineName(p.name))}"${pid}>`)
    sink.push('   <mesh>')
    sink.push('    <vertices>')
    for (let i = 0; i + 2 < pos.length; i += 3) sink.push(`     <vertex x="${num(pos[i])}" y="${num(pos[i + 1])}" z="${num(pos[i + 2])}"/>`)
    sink.push('    </vertices>')
    sink.push('    <triangles>')
    for (let t = 0; t + 2 < idx.length; t += 3) sink.push(`     <triangle v1="${idx[t]}" v2="${idx[t + 1]}" v3="${idx[t + 2]}"/>`)
    sink.push('    </triangles>')
    sink.push('   </mesh>')
    sink.push('  </object>')
  })
  sink.push(' </resources>')
  sink.push(' <build>')
  ms.forEach((_, k) => sink.push(`  <item objectid="${k + 2}"/>`))
  sink.push(' </build>')
  sink.push('</model>')
  const model = sink.done()
  const types =
    '<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>'
  const rels =
    '<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>'
  return zip([
    { name: '[Content_Types].xml', data: enc.encode(types) },
    { name: '_rels/.rels', data: enc.encode(rels) },
    { name: '3D/3dmodel.model', data: model }
  ])
}

// ---------- GLB ----------
/**
 * A binary glTF 2.0 file: one node and one mesh per part (triangles or points), positions, optional normals and vertex colors
 * (COLOR_0, linear as glTF requires), and a material from the part's color. No textures, no animation, no compression.
 * The coordinates are written as they are: pass Y-up data (see exportRotation).
 */
export function writeGLB(parts, opts = {}) {
  const used = parts
    .map((p) => cleanPart(p))
    .filter((p) => ((p.kind === 'mesh' && triangleCount(p) > 0) || p.kind === 'points') && vertexCount(p) > 0 && p.positions.every(Number.isFinite))
  const bin = []
  let binLen = 0
  const bufferViews = []
  const accessors = []
  const addView = (u8, target) => {
    while (binLen % 4) {
      bin.push(new Uint8Array(1))
      binLen += 1
    }
    bufferViews.push({ buffer: 0, byteOffset: binLen, byteLength: u8.length, ...(target ? { target } : {}) })
    bin.push(u8)
    binLen += u8.length
    return bufferViews.length - 1
  }
  const addAccessor = (view, componentType, count, type, extra = {}) => {
    accessors.push({ bufferView: view, componentType, count, type, ...extra })
    return accessors.length - 1
  }
  const materials = []
  const matIndex = new Map()
  const meshes = []
  const nodes = []
  for (const p of used) {
    const n = vertexCount(p)
    const pos = p.positions.length === n * 3 ? p.positions : p.positions.slice(0, n * 3)
    let mn = [Infinity, Infinity, Infinity]
    let mx = [-Infinity, -Infinity, -Infinity]
    for (let i = 0; i < pos.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        if (pos[i + k] < mn[k]) mn[k] = pos[i + k]
        if (pos[i + k] > mx[k]) mx[k] = pos[i + k]
      }
    }
    const attributes = {
      POSITION: addAccessor(addView(new Uint8Array(pos.buffer, pos.byteOffset, pos.byteLength), 34962), 5126, n, 'VEC3', { min: mn, max: mx })
    }
    if (p.normals && p.normals.length === n * 3) {
      attributes.NORMAL = addAccessor(addView(new Uint8Array(p.normals.buffer, p.normals.byteOffset, p.normals.byteLength), 34962), 5126, n, 'VEC3')
    }
    if (p.colors && p.colors.length >= n * 3) {
      const lin = new Float32Array(n * 3)
      for (let i = 0; i < n * 3; i++) lin[i] = srgbToLinear(p.colors[i])
      attributes.COLOR_0 = addAccessor(addView(new Uint8Array(lin.buffer), 34962), 5126, n, 'VEC3')
    }
    const key = p.color ? hexOf(p.color) : p.colors ? 'vertex' : 'none'
    if (!matIndex.has(key)) {
      const c = p.color ? p.color.map(srgbToLinear) : key === 'vertex' ? [1, 1, 1] : [0.8, 0.8, 0.8] // glTF multiplies the factor with COLOR_0
      matIndex.set(key, materials.length)
      materials.push({ name: key === 'none' || key === 'vertex' ? 'Default' : `Color ${key}`, doubleSided: true, pbrMetallicRoughness: { baseColorFactor: [c[0], c[1], c[2], 1], metallicFactor: 0, roughnessFactor: 0.8 } })
    }
    const prim = { attributes, material: matIndex.get(key) }
    if (p.kind === 'points') prim.mode = 0
    else {
      let idx = p.indices
      if (!idx) {
        idx = new Uint32Array(n)
        for (let i = 0; i < n; i++) idx[i] = i
      }
      const small = n <= 65535
      const data = small ? Uint16Array.from(idx) : idx
      const whole = idx.length - (idx.length % 3)
      prim.indices = addAccessor(addView(new Uint8Array(data.buffer, data.byteOffset, whole * data.BYTES_PER_ELEMENT), 34963), small ? 5123 : 5125, whole, 'SCALAR')
    }
    meshes.push({ name: lineName(p.name), primitives: [prim] })
    nodes.push({ name: lineName(p.name), mesh: meshes.length - 1 })
  }
  if (!meshes.length) throw new Error('nothing to write')
  while (binLen % 4) {
    bin.push(new Uint8Array(1))
    binLen += 1
  }
  const json = {
    asset: { version: '2.0', generator: opts.generator || 'a 3D viewer plugin (a copy)' },
    scene: 0,
    scenes: [{ nodes: nodes.map((_, i) => i) }],
    nodes,
    meshes,
    materials,
    accessors,
    bufferViews,
    buffers: [{ byteLength: binLen }]
  }
  let js = enc.encode(JSON.stringify(json))
  const pad = (4 - (js.length % 4)) % 4
  if (pad) js = concat([js, enc.encode(' '.repeat(pad))])
  const total = 12 + 8 + js.length + 8 + binLen
  const out = new Uint8Array(total)
  const dv = new DataView(out.buffer)
  dv.setUint32(0, 0x46546c67, true) // "glTF"
  dv.setUint32(4, 2, true)
  dv.setUint32(8, total, true)
  dv.setUint32(12, js.length, true)
  dv.setUint32(16, 0x4e4f534a, true) // "JSON"
  out.set(js, 20)
  const o = 20 + js.length
  dv.setUint32(o, binLen, true)
  dv.setUint32(o + 4, 0x004e4942, true) // "BIN\0"
  let w = o + 8
  for (const b of bin) {
    out.set(b, w)
    w += b.length
  }
  return out
}

// ---------- file names ----------
/** The name offered in the Save dialog: the source's name without its extension, plus the new extension. */
export function suggestName(sourceName, format, same = false) {
  const ext = (FORMATS[format] || { ext: format }).ext
  if (format === 'glbc') same = true // the same extension as the plain GLB: the name says it is the compressed one
  const stem = String(sourceName || '')
    .replace(/^.*[\\/]/, '')
    .replace(/\.[^.]*$/, '')
    .replace(/[^\p{L}\p{N} _.()-]+/gu, '_')
    .trim()
  if (!stem) return format === 'png' ? `view.${ext}` : format === 'webm' ? `turntable.${ext}` : format === 'glbc' ? `model-compressed.${ext}` : `model.${ext}`
  return `${stem}${format === 'glbc' ? '-compressed' : same ? '-copy' : ''}.${ext}`
}

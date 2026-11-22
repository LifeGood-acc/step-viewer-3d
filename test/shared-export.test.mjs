// Tests for the shared copy writers (editor/shared/export.js). Same file in both plugins: node --test.
import test from 'node:test'
import assert from 'node:assert/strict'
import { inflateRawSync } from 'node:zlib'
import { crc32, estimateBytes, exportRotation, rotateInPlace, sizeVerdict, suggestName, triangleCount, unitName3mf, weldExact, write3MF, writeGLB, writeOBJ, writePLY, writeSTL, zip, MiB, OPEN_MAX_BYTES, SAVE_MAX_BYTES } from '../editor/shared/export.js'

// a unit cube as an indexed mesh (12 triangles, 8 vertices), counter-clockwise seen from outside
const cube = (extra = {}) => ({
  name: 'Cube',
  kind: 'mesh',
  positions: new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1]),
  indices: new Uint32Array([0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 2, 3, 7, 2, 7, 6, 1, 2, 6, 1, 6, 5, 3, 0, 4, 3, 4, 7]),
  normals: null,
  colors: null,
  color: null,
  ...extra
})
// the same cube without shared vertices (36 vertices)
const soup = (p) => {
  const pos = new Float32Array(p.indices.length * 3)
  p.indices.forEach((v, i) => pos.set(p.positions.subarray(3 * v, 3 * v + 3), 3 * i))
  return { ...p, positions: pos, indices: null }
}
const cloud = { name: 'Cloud', kind: 'points', positions: new Float32Array([0, 0, 0, 2, 2, 2, 3, 1, 0]), indices: null, normals: null, colors: new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255]), color: null }

test('size verdicts follow what Orca can open and what the Save dialog takes', () => {
  assert.equal(OPEN_MAX_BYTES, 50 * MiB)
  assert.ok(SAVE_MAX_BYTES < 64 * MiB && SAVE_MAX_BYTES > 63 * MiB)
  assert.equal(sizeVerdict(0), 'opens')
  assert.equal(sizeVerdict(50 * MiB), 'opens')
  assert.equal(sizeVerdict(50 * MiB + 1), 'no-open')
  assert.equal(sizeVerdict(SAVE_MAX_BYTES), 'no-open')
  assert.equal(sizeVerdict(SAVE_MAX_BYTES + 1), 'too-large')
})

test('up rotations: file up to copy up', () => {
  assert.equal(exportRotation('y', 'y'), null)
  assert.equal(exportRotation('z', 'z'), null)
  assert.equal(exportRotation('y', 'keep'), null)
  assert.equal(exportRotation('z', 'keep'), null)
  assert.equal(exportRotation('bogus', 'z'), null)
  const at = (m, v) => rotateInPlace(Float32Array.from(v), m)
  assert.deepEqual([...at(exportRotation('z', 'y'), [1, 2, 3])], [1, 3, -2]) // +Z up becomes +Y up
  assert.deepEqual([...at(exportRotation('y', 'z'), [1, 2, 3])], [1, -3, 2]) // +Y up becomes +Z up
  assert.deepEqual([...at(exportRotation('-y', 'y'), [1, 2, 3])], [1, -2, -3])
  assert.deepEqual([...at(exportRotation('-y', 'z'), [1, 2, 3])], [1, 3, -2]) // -Y up (turned upside down) then Y to Z
  // proper rotations: the determinant is +1, so winding survives
  for (const [a, b] of [['z', 'y'], ['y', 'z'], ['-y', 'y'], ['-y', 'z']]) {
    const m = exportRotation(a, b)
    const det = m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6])
    assert.equal(det, 1, `${a}->${b}`)
  }
})

test('STL: binary, one solid, counts and normals', () => {
  const out = writeSTL([cube(), cloud])
  assert.equal(out.length, 84 + 50 * 12)
  const dv = new DataView(out.buffer)
  assert.equal(dv.getUint32(80, true), 12)
  // first triangle (0,0,0) (1,1,0) (1,0,0) faces -Z
  assert.deepEqual([dv.getFloat32(84, true), dv.getFloat32(88, true), dv.getFloat32(92, true)], [0, 0, -1])
  assert.deepEqual(writeSTL([soup(cube())]), out) // the same bytes for the same triangles, indexed or not
  assert.equal(writeSTL([cloud]).length, 84) // points have no triangles
})

test('OBJ: an object per part, 1-based faces, colors as vertex colors, points as p', () => {
  const text = new TextDecoder().decode(writeOBJ([cube({ color: [255, 0, 0] }), { ...cloud, name: 'Pts\nx' }]))
  const lines = text.split('\n')
  assert.ok(lines.includes('o Cube'))
  assert.ok(lines.includes('o Pts x'), 'a newline in a name cannot break the file')
  assert.equal(lines.filter((l) => l.startsWith('v ')).length, 8 + 3)
  assert.ok(lines.includes('v 0 0 0 1 0 0'))
  assert.ok(lines.includes('f 1 3 2'))
  assert.ok(lines.includes('p 9') && lines.includes('p 11'), 'the point numbers continue after the cube')
  assert.equal(lines.filter((l) => l.startsWith('f ')).length, 12)
  const plain = new TextDecoder().decode(writeOBJ([cube()]))
  assert.ok(plain.includes('v 1 0 0\n'), 'no color columns when nothing has a color')
})

test('PLY: binary little endian with colors, faces and points', () => {
  const out = writePLY([cube({ color: [10, 20, 30] }), cloud])
  const end = new TextDecoder().decode(out.subarray(0, 400)).indexOf('end_header\n') + 11
  const header = new TextDecoder().decode(out.subarray(0, end))
  assert.match(header, /format binary_little_endian 1\.0/)
  assert.match(header, /element vertex 11/)
  assert.match(header, /element face 12/)
  assert.match(header, /property uchar red/)
  assert.equal(out.length, end + 11 * 15 + 12 * 13)
  const dv = new DataView(out.buffer)
  assert.deepEqual([out[end + 12], out[end + 13], out[end + 14]], [10, 20, 30])
  const o = end + 11 * 15
  assert.equal(out[o], 3)
  assert.deepEqual([dv.getInt32(o + 1, true), dv.getInt32(o + 5, true), dv.getInt32(o + 9, true)], [0, 2, 1])
  const noColor = writePLY([cube()])
  assert.ok(!new TextDecoder().decode(noColor.subarray(0, 300)).includes('red'))
  const pointsOnly = new TextDecoder().decode(writePLY([cloud]).subarray(0, 300))
  assert.ok(!pointsOnly.includes('element face'))
})

test('weldExact merges identical positions only, bit for bit', () => {
  const s = soup(cube())
  const w = weldExact(s.positions)
  assert.equal(w.positions.length, 8 * 3)
  assert.equal(w.indices.length, 36)
  for (let i = 0; i < 36; i++) assert.deepEqual([...w.positions.subarray(3 * w.indices[i], 3 * w.indices[i] + 3)], [...s.positions.subarray(3 * i, 3 * i + 3)])
  const near = weldExact(Float32Array.from([0, 0, 0, 0, 0, 1e-7, 0, 0, 0]))
  assert.equal(near.positions.length, 6)
  assert.deepEqual([...near.indices], [0, 1, 0])
  const rnd = new Float32Array(3 * 5000).map((_, i) => ((i * 7919) % 31) / 3) // many duplicates
  const wr = weldExact(rnd)
  for (let i = 0; i < 5000; i++) assert.deepEqual([...wr.positions.subarray(3 * wr.indices[i], 3 * wr.indices[i] + 3)], [...rnd.subarray(3 * i, 3 * i + 3)])
})

// reads a ZIP the way any unzip tool does: through the central directory
function readZip(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.length)
  const eocd = u8.length - 22
  assert.equal(dv.getUint32(eocd, true), 0x06054b50)
  const n = dv.getUint16(eocd + 10, true)
  let c = dv.getUint32(eocd + 16, true)
  const files = {}
  for (let i = 0; i < n; i++) {
    assert.equal(dv.getUint32(c, true), 0x02014b50)
    const method = dv.getUint16(c + 10, true)
    const crc = dv.getUint32(c + 16, true)
    const csize = dv.getUint32(c + 20, true)
    const usize = dv.getUint32(c + 24, true)
    const nl = dv.getUint16(c + 28, true)
    const off = dv.getUint32(c + 42, true)
    const name = new TextDecoder().decode(u8.subarray(c + 46, c + 46 + nl))
    assert.equal(dv.getUint32(off, true), 0x04034b50)
    const start = off + 30 + dv.getUint16(off + 26, true) + dv.getUint16(off + 28, true)
    const raw = u8.subarray(start, start + csize)
    const data = method === 8 ? new Uint8Array(inflateRawSync(raw)) : raw
    assert.equal(data.length, usize, name)
    assert.equal(crc32(data), crc, `${name}: crc`)
    files[name] = data
    c += 46 + nl
  }
  return files
}

test('zip: entries read back through the central directory, same bytes every run', async () => {
  const entries = [{ name: 'a.txt', data: new TextEncoder().encode('hello '.repeat(100)) }, { name: 'dir/ü.bin', data: new Uint8Array([1, 2, 3]) }]
  const z = await zip(entries)
  const files = readZip(z)
  assert.equal(new TextDecoder().decode(files['a.txt']), 'hello '.repeat(100))
  assert.deepEqual([...files['dir/ü.bin']], [1, 2, 3])
  assert.deepEqual(await zip(entries), z)
  assert.ok(z.length < 600, 'the repeated text is deflated')
})

test('3MF: core model, unit, one object per mesh part, vertices shared, a color per part, points left out', async () => {
  const z = await write3MF([cube({ color: [255, 0, 0] }), soup({ ...cube({ name: 'Soup', colors: new Uint8Array(72 * 3).fill(0).map((_, i) => (i % 3 === 2 ? 200 : 0)) }) }), cloud], { unit: 'mm' })
  const files = readZip(z)
  assert.deepEqual(Object.keys(files), ['[Content_Types].xml', '_rels/.rels', '3D/3dmodel.model'])
  const xml = new TextDecoder().decode(files['3D/3dmodel.model'])
  assert.match(xml, /<model unit="millimeter"/)
  assert.equal((xml.match(/<object /g) || []).length, 2, 'the cloud is not an object')
  assert.equal((xml.match(/<vertex /g) || []).length, 16, 'the unwelded cube is welded to 8 vertices')
  assert.equal((xml.match(/<triangle /g) || []).length, 24)
  assert.equal((xml.match(/<item objectid=/g) || []).length, 2)
  assert.match(xml, /displaycolor="#FF0000"/)
  assert.match(xml, /displaycolor="#0000C8"/, 'a part with vertex colors gets their average')
  assert.match(xml, /name="Cube"/)
  assert.ok(!/<m:|slic3r|Bambu|paint_color/i.test(xml), 'no slicer data is invented')
  // every triangle index points at a vertex of its own object
  for (const obj of xml.split('<object ').slice(1)) {
    const nv = (obj.match(/<vertex /g) || []).length
    for (const m of obj.matchAll(/v1="(\d+)" v2="(\d+)" v3="(\d+)"/g)) assert.ok(+m[1] < nv && +m[2] < nv && +m[3] < nv)
  }
  assert.equal(unitName3mf('m'), 'meter')
  assert.equal(unitName3mf('?'), 'millimeter')
  assert.deepEqual(await write3MF([cube()], { unit: 'mm' }), await write3MF([cube()], { unit: 'mm' }))
  const plain = new TextDecoder().decode(readZip(await write3MF([cube()]))['3D/3dmodel.model'])
  assert.ok(!plain.includes('basematerials'), 'no color: no material resource')
  assert.match(plain, /name="Cube">/)
  const esc = new TextDecoder().decode(readZip(await write3MF([cube({ name: 'a<b>"&' })]))['3D/3dmodel.model'])
  assert.ok(esc.includes('name="a&lt;b&gt;&quot;&amp;"'))
})

test('GLB: a valid container with one node per part', () => {
  const out = writeGLB([cube({ color: [255, 0, 0], name: 'Red cube' }), cloud])
  const dv = new DataView(out.buffer)
  assert.equal(dv.getUint32(0, true), 0x46546c67)
  assert.equal(dv.getUint32(4, true), 2)
  assert.equal(dv.getUint32(8, true), out.length)
  assert.equal(out.length % 4, 0)
  const jl = dv.getUint32(12, true)
  assert.equal(dv.getUint32(16, true), 0x4e4f534a)
  const json = JSON.parse(new TextDecoder().decode(out.subarray(20, 20 + jl)))
  assert.equal(jl % 4, 0)
  assert.equal(dv.getUint32(20 + jl + 4, true), 0x004e4942)
  const binLen = dv.getUint32(20 + jl, true)
  assert.equal(json.buffers[0].byteLength, binLen)
  assert.equal(20 + jl + 8 + binLen, out.length)
  assert.equal(json.nodes.length, 2)
  assert.equal(json.nodes[0].name, 'Red cube')
  const pos = json.accessors[json.meshes[0].primitives[0].attributes.POSITION]
  assert.deepEqual([pos.count, pos.min, pos.max], [8, [0, 0, 0], [1, 1, 1]])
  assert.equal(json.meshes[1].primitives[0].mode, 0)
  assert.ok(json.meshes[1].primitives[0].attributes.COLOR_0 !== undefined)
  assert.deepEqual(json.materials[0].pbrMetallicRoughness.baseColorFactor, [1, 0, 0, 1])
  const idx = json.accessors[json.meshes[0].primitives[0].indices]
  assert.deepEqual([idx.count, idx.componentType], [36, 5123])
  for (const bv of json.bufferViews) assert.ok(bv.byteOffset % 4 === 0 && bv.byteOffset + bv.byteLength <= binLen)
  assert.throws(() => writeGLB([]), /nothing/)
})

test('estimates are in the right range (STL exact)', () => {
  assert.equal(estimateBytes('stl', { tris: 12 }), writeSTL([cube()]).length)
  const ply = writePLY([cube({ color: [1, 2, 3] })]).length
  assert.ok(estimateBytes('ply', { verts: 8, tris: 12 }) > ply * 0.5 && estimateBytes('ply', { verts: 8, tris: 12 }) < ply * 2)
  assert.equal(estimateBytes('png', {}), 0)
  assert.equal(triangleCount(cube()), 12)
  assert.equal(triangleCount(soup(cube())), 12)
  assert.equal(triangleCount(cloud), 0)
})

test('suggested file names', () => {
  assert.equal(suggestName('Bracket v2.stl', 'glb'), 'Bracket v2.glb')
  assert.equal(suggestName('Bracket.glb', 'glb', true), 'Bracket-copy.glb')
  assert.equal(suggestName('/some/dir/a:b*.ply', '3mf'), 'a_b_.3mf')
  assert.equal(suggestName('', 'png'), 'view.png')
  assert.equal(suggestName('', 'webm'), 'turntable.webm')
  assert.equal(suggestName(undefined, 'stl'), 'model.stl')
})

test('triangles that point at missing vertices are dropped everywhere; 3MF also drops slivers that use a vertex twice', async () => {
  const bad = cube({ indices: new Uint32Array([0, 2, 1, 0, 3, 99, 4, 4, 5]) })
  assert.equal(writeSTL([bad]).length, 84 + 50 * 2, 'the out-of-range triangle is gone')
  assert.equal(new TextDecoder().decode(writeOBJ([bad])).split('\n').filter((l) => l.startsWith('f ')).length, 2)
  const xml = new TextDecoder().decode(readZip(await write3MF([bad]))['3D/3dmodel.model'])
  assert.equal((xml.match(/<triangle /g) || []).length, 1, 'the sliver (4,4,5) and the missing vertex are both gone')
  const glb = writeGLB([bad])
  const json = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + new DataView(glb.buffer).getUint32(12, true))))
  assert.equal(json.accessors[json.meshes[0].primitives[0].indices].count, 6)
})

test('GLB: a part with only vertex colors keeps a white factor (glTF multiplies it with COLOR_0); a part with NaN is left out; a non-multiple-of-3 index list is cut', () => {
  const colored = cube({ colors: new Uint8Array(24).fill(100) })
  const nan = cube({ name: 'NaN', positions: new Float32Array(24).fill(NaN) })
  const odd = cube({ name: 'Odd', indices: new Uint32Array([0, 2, 1, 0, 3]) })
  const glb = writeGLB([colored, nan, odd])
  const json = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + new DataView(glb.buffer).getUint32(12, true))))
  assert.equal(json.meshes.length, 2, 'the NaN part is skipped')
  assert.deepEqual(json.materials[json.meshes[0].primitives[0].material].pbrMetallicRoughness.baseColorFactor, [1, 1, 1, 1])
  assert.equal(json.accessors[json.meshes[1].primitives[0].indices].count, 3)
})

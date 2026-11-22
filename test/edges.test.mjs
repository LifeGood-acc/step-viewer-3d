import { test } from 'node:test'
import assert from 'node:assert/strict'
import { brepEdges } from '../editor/edges.js'

// A box the way the converter makes it: every face has its own four vertices (two triangles), faces are listed as triangle ranges.
function box(w = 2, h = 1, d = 1) {
  const P = []
  const I = []
  const faces = []
  const quads = [
    [[0, 0, 0], [w, 0, 0], [w, h, 0], [0, h, 0]], // z = 0
    [[0, 0, d], [w, 0, d], [w, h, d], [0, h, d]],
    [[0, 0, 0], [w, 0, 0], [w, 0, d], [0, 0, d]], // y = 0
    [[0, h, 0], [w, h, 0], [w, h, d], [0, h, d]],
    [[0, 0, 0], [0, h, 0], [0, h, d], [0, 0, d]], // x = 0
    [[w, 0, 0], [w, h, 0], [w, h, d], [w, 0, d]]
  ]
  for (const q of quads) {
    const v0 = P.length / 3
    for (const p of q) P.push(...p)
    const t0 = I.length / 3
    I.push(v0, v0 + 1, v0 + 2, v0, v0 + 2, v0 + 3)
    faces.push({ first: t0, last: t0 + 1 })
  }
  return { position: new Float32Array(P), index: new Uint32Array(I), faces }
}
const segs = (a) => Array.from({ length: a.length / 6 }, (_, i) => [...a.subarray(i * 6, i * 6 + 6)])
const key = (s) => {
  const p = [s.slice(0, 3).join(), s.slice(3).join()].sort()
  return p.join('|')
}

test('a box has 12 edges: the diagonal of each face, which is only triangulation, is not one', () => {
  const b = box()
  const e = segs(brepEdges(b.position, b.index, b.faces))
  assert.equal(e.length, 12)
  assert.equal(new Set(e.map(key)).size, 12, 'each edge once')
  for (const s of e) {
    const d = [Math.abs(s[0] - s[3]), Math.abs(s[1] - s[4]), Math.abs(s[2] - s[5])]
    assert.equal(d.filter((v) => v > 0).length, 1, `an axis-parallel edge, no diagonal (${s})`)
  }
})

test('a part whose faces are not named has no CAD edges to show except its borders', () => {
  const b = box()
  const e = brepEdges(b.position, b.index, []) // every triangle is "no face": all inside one face
  // the welded vertices are shared across faces here: edges between triangles of the same (unnamed) face are skipped, only open borders remain
  assert.equal(segs(e).length, 0, 'a closed surface has no borders')
})

test('an open surface shows its border; a smooth strip of two faces shows the seam between them', () => {
  // two triangles making one face: the border is 4 edges (the diagonal is shared inside the face)
  const position = new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0])
  const index = new Uint32Array([0, 1, 2, 0, 2, 3])
  assert.equal(segs(brepEdges(position, index, [{ first: 0, last: 1 }])).length, 4)
  // the same two triangles as two faces: now the diagonal is an edge too
  assert.equal(segs(brepEdges(position, index, [{ first: 0, last: 0 }, { first: 1, last: 1 }])).length, 5)
})

test('a fillet-like seam: two faces in the same plane still get a line where they meet (an angle threshold would not)', () => {
  // two coplanar quads side by side, own vertices each, as two faces
  const position = new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 2, 0, 0, 2, 1, 0, 1, 1, 0])
  const index = new Uint32Array([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7])
  const e = segs(brepEdges(position, index, [{ first: 0, last: 1 }, { first: 2, last: 3 }]))
  assert.ok(e.some((s) => s[0] === 1 && s[3] === 1 && Math.min(s[1], s[4]) === 0 && Math.max(s[1], s[4]) === 1), 'the seam x = 1')
  assert.equal(e.length, 7, 'the outer border (6) and the seam (1)')
})

test('degenerate triangles, empty input and a very large coordinate range do not break it', () => {
  assert.equal(brepEdges(new Float32Array(0), new Uint32Array(0), []).length, 0)
  const position = new Float32Array([0, 0, 0, 0, 0, 0, 1, 0, 0])
  assert.doesNotThrow(() => brepEdges(position, new Uint32Array([0, 1, 2]), []))
  const big = box(1e6, 1e6, 1e6)
  assert.equal(segs(brepEdges(big.position, big.index, big.faces)).length, 12)
})

test('speed: a million triangles of one big face and a thousand faces', () => {
  const n = 700
  const P = new Float32Array((n + 1) * (n + 1) * 3)
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) P.set([i, j, Math.sin(i * 0.01) * 5], (j * (n + 1) + i) * 3)
  const I = new Uint32Array(n * n * 6)
  let o = 0
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const a = j * (n + 1) + i
    I.set([a, a + 1, a + n + 2, a, a + n + 2, a + n + 1], o)
    o += 6
  }
  const faces = Array.from({ length: 49 }, (_, k) => ({ first: Math.floor((k * n * n * 2) / 49), last: Math.floor(((k + 1) * n * n * 2) / 49) - 1 }))
  const t0 = Date.now()
  const e = brepEdges(P, I, faces)
  const ms = Date.now() - t0
  assert.ok(e.length > 0)
  assert.ok(ms < 3000, `${n * n * 2} triangles took ${ms} ms`)
})

test('the table is sized to the triangles: a closed mesh of many triangles fills it at most half', () => {
  // an icosphere-like closed surface (octahedron subdivided) has 1.5 edges per triangle
  let tris = [[[1, 0, 0], [0, 1, 0], [0, 0, 1]], [[0, 1, 0], [-1, 0, 0], [0, 0, 1]], [[-1, 0, 0], [0, -1, 0], [0, 0, 1]], [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
    [[0, 1, 0], [1, 0, 0], [0, 0, -1]], [[-1, 0, 0], [0, 1, 0], [0, 0, -1]], [[0, -1, 0], [-1, 0, 0], [0, 0, -1]], [[1, 0, 0], [0, -1, 0], [0, 0, -1]]]
  const mid = (a, b) => { const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]; const l = Math.hypot(...m); return m.map((v) => v / l) }
  for (let k = 0; k < 6; k++) tris = tris.flatMap(([a, b, c]) => { const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a); return [[a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]] })
  const P = new Float32Array(tris.length * 9)
  tris.forEach((t, i) => t.forEach((v, j) => P.set(v, i * 9 + j * 3)))
  const I = Uint32Array.from({ length: tris.length * 3 }, (_, i) => i)
  const one = brepEdges(P, I, [{ first: 0, last: tris.length - 1 }]) // one face: a closed sphere has no border and no edge
  assert.equal(one.length, 0)
  const two = brepEdges(P, I, [{ first: 0, last: tris.length / 2 - 1 }, { first: tris.length / 2, last: tris.length - 1 }])
  assert.ok(two.length > 0 && two.length / 6 < 400, `${two.length / 6} edges between the two halves`)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { FACES, FACE_NAMES, CUBE_TILT, basisFromMatrix, projectAll, tiltBasis, tiltWeight, hitTarget, basisChanged } from '../editor/shared/viewcube-core.js'
import { PRESETS, presetDirection } from '../editor/lib.js'

// the camera's basis for a view direction (from the target towards the camera), up = +Y, as a lookAt camera has it
function basisFor(dir) {
  const norm = (v) => { const l = Math.hypot(...v); return v.map((c) => c / l) }
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
  const b = norm(dir)
  const r = norm(cross([0, 1, 0], b))
  const u = cross(b, r)
  return { r, u, b }
}

test('the six faces are the six views of the View menu', () => {
  assert.deepEqual([...FACE_NAMES].sort(), ['back', 'bottom', 'front', 'left', 'right', 'top'])
  for (const n of FACE_NAMES) assert.ok(PRESETS.includes(n), `${n} is a view`)
})

const allDirs = [...PRESETS.map(presetDirection), [1, 1, 1], [-1, 1, -1], [0.1, 1, 0.1], [-3, 2, 5], [0, -1, 0.0001], [1, -1, -1]]

test('looking from a face: that face is the nearest one, the opposite one is not drawn, and the cube is never a flat square', () => {
  for (const f of FACES) {
    const all = projectAll(basisFor(presetDirection(f.name)), 96)
    assert.equal(all.faces.at(-1).name, f.name, `from ${f.name}`)
    const opposite = FACES.find((o) => o.n.every((c, i) => c === -f.n[i])).name
    assert.ok(!all.faces.some((x) => x.name === opposite), `${opposite} is behind`)
    assert.ok(all.faces.length >= 3, `from ${f.name}: ${all.faces.length} faces to point at`)
    assert.ok(all.edges.length >= 6 && all.corners.length >= 6, `from ${f.name}: ${all.edges.length} edges, ${all.corners.length} corners`)
  }
})

test('whichever way the camera looks, at least three faces, edges and corners can be pointed at', () => {
  for (const dir of allDirs) {
    const all = projectAll(basisFor(dir), 96)
    assert.ok(all.faces.length >= 3, `${dir}: ${all.faces.map((f) => f.name)}`)
    assert.ok(all.edges.length >= 6 && all.corners.length >= 6, `${dir}`)
  }
})

test('every target that is drawn can be hit: corners first, then edges, then faces, each with the direction it stands for', () => {
  for (const dir of allDirs) {
    const all = projectAll(basisFor(dir), 96)
    for (const c of all.corners) {
      const h = hitTarget(all, c.p[0], c.p[1])
      assert.equal(h.kind, 'corner', `${dir} ${c.name}`)
      assert.equal(h.name, c.name)
      assert.ok(Math.abs(Math.hypot(...h.dir) - 1) < 1e-9 && h.dir.every((v) => v === 0 || Math.abs(Math.abs(v) - 1 / Math.sqrt(3)) < 1e-9), 'a corner looks along a diagonal')
    }
    for (const e of all.edges) {
      const mid = [(e.a[0] + e.b[0]) / 2, (e.a[1] + e.b[1]) / 2]
      const h = hitTarget(all, mid[0], mid[1])
      assert.ok(h && h.kind === 'edge' && h.name === e.name, `${dir} edge ${e.name} (${h && h.kind} ${h && h.name})`)
      assert.ok(h.dir.filter((v) => v !== 0).length === 2, 'an edge looks from between two faces')
    }
    for (const f of all.faces) {
      if (f.facing < 0.2) continue // a face seen almost edge-on is a sliver: its edges are the targets there
      let hit = null
      const xs = f.pts.map((p) => p[0])
      const ys = f.pts.map((p) => p[1])
      for (let i = 0; i <= 16 && !hit; i++) for (let j = 0; j <= 16 && !hit; j++) {
        const h = hitTarget(all, Math.min(...xs) + ((Math.max(...xs) - Math.min(...xs)) * i) / 16, Math.min(...ys) + ((Math.max(...ys) - Math.min(...ys)) * j) / 16)
        if (h && h.kind === 'face' && h.name === f.name) hit = h
      }
      assert.ok(hit, `${dir} face ${f.name} (facing ${f.facing.toFixed(2)}) has a point that picks it`)
      assert.deepEqual(hit.dir, FACES.find((o) => o.name === f.name).n)
    }
    assert.equal(hitTarget(all, 1, 1), null)
  }
})

test('the names of edges and corners say which faces they lie between', () => {
  const all = projectAll(basisFor([0, 0, 1]), 96)
  const names = all.edges.map((e) => e.name).sort()
  assert.ok(names.includes('top-front') && names.includes('front-right'), names.join())
  assert.ok(all.corners.some((c) => c.name === 'top-front-right'))
})

test('the cube stays inside its canvas whichever way the camera looks', () => {
  for (const dir of allDirs) {
    const all = projectAll(basisFor(dir), 96)
    for (const f of all.faces) for (const [x, y] of f.pts) assert.ok(x >= 0 && x <= 96 && y >= 0 && y <= 96, `${dir}: ${x},${y}`)
  }
})

test('the tilt is full along an axis, none in a generic view, smooth in between', () => {
  assert.equal(tiltWeight(basisFor([0, 0, 1])), 1)
  assert.equal(tiltWeight(basisFor([1, 1, 1])), 0)
  assert.equal(tiltWeight(basisFor([0.7, 0.55, 0.9])), 0) // the start view needs none
  let last = 1
  for (let k = 0; k <= 40; k++) { // from the front towards the corner: never up, never a jump
    const w = tiltWeight(basisFor([k / 40, k / 40, 1]))
    assert.ok(w <= last + 1e-12 && last - w < 0.2, `step ${k}: ${w}`)
    last = w
  }
})

test('the tilt is a turn: it keeps the three axes of the camera at right angles and does not turn the cube when the tilt is zero', () => {
  const b = basisFor([1, 1, 1])
  const t = tiltBasis(b)
  const d = (x, y) => x[0] * y[0] + x[1] * y[1] + x[2] * y[2]
  assert.ok(Math.abs(d(t.r, t.u)) < 1e-9 && Math.abs(d(t.r, t.b)) < 1e-9 && Math.abs(d(t.u, t.b)) < 1e-9)
  const z = tiltBasis(b, { yaw: 0, pitch: 0 })
  for (const k of ['r', 'u', 'b']) z[k].forEach((v, i) => assert.ok(Math.abs(v - b[k][i]) < 1e-12))
  assert.ok(CUBE_TILT.yaw !== 0 || CUBE_TILT.pitch !== 0)
})

test('the basis comes from the camera matrix (column-major), and a change is told only when it is one', () => {
  const m = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 6, 7, 1] // no turn, moved: the basis ignores the position
  assert.deepEqual(basisFromMatrix(m), { r: [1, 0, 0], u: [0, 1, 0], b: [0, 0, 1] })
  const a = basisFromMatrix(m)
  assert.equal(basisChanged(a, basisFromMatrix(m)), false)
  assert.equal(basisChanged(a, basisFor([1, 0, 1])), true)
  assert.equal(basisChanged(null, a), true)
})

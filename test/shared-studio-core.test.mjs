import test from 'node:test'
import assert from 'node:assert/strict'
import { receivesShadow, presetState, normalizeStudio, studioActive, lightDirection, floorSpec, lightPlacement, cameraPreset, shadowPolicy, spinAngle, PRESET_IDS } from '../editor/shared/studio-core.js'

const box = { min: { x: -1, y: 2, z: -2 }, max: { x: 3, y: 6, z: 2 } } // 4 x 4 x 4, centre (1, 4, 0)
const near = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) <= e, `${a} vs ${b}`)

test('the default is the original look and nothing of the studio is on', () => {
  assert.equal(studioActive(normalizeStudio(undefined)), false)
  assert.equal(studioActive(presetState('original')), false)
  for (const id of PRESET_IDS.slice(1)) assert.equal(studioActive(presetState(id)), true, id)
})
test('what was stored is clamped and unknown words are replaced', () => {
  const s = normalizeStudio({ preset: 'product_white', exposure: 99, shadow: -4, tone: 'bogus', key: { intensity: 'x', azimuth: 500, elevation: -9 }, bg: { type: 'solid', color: 'red', color2: '#ABCDEF' }, quality: 'ultra', spinSpeed: 1000 })
  assert.equal(s.exposure, 3)
  assert.equal(s.shadow, 0)
  assert.equal(s.tone, 'neutral')
  assert.equal(s.key.intensity, 2.1) // not a number: the preset's value
  assert.equal(s.key.azimuth, 180)
  assert.equal(s.key.elevation, 0)
  assert.equal(s.bg.color, '#ffffff')
  assert.equal(s.bg.color2, '#abcdef')
  assert.equal(s.quality, 'low')
  assert.equal(s.spinSpeed, 90)
  assert.equal(normalizeStudio({ preset: 'nonsense' }).preset, 'original')
  assert.equal(normalizeStudio({ preset: 'custom', exposure: 1.5 }).preset, 'custom')
})
test('light directions: front, right, left, top, and a unit length', () => {
  const [fx, fy, fz] = lightDirection(0, 0)
  near(fx, 0); near(fy, 0); near(fz, 1)
  const r = lightDirection(90, 0)
  near(r[0], 1); near(r[2], 0, 1e-12)
  near(lightDirection(-90, 0)[0], -1)
  const t = lightDirection(37, 90)
  near(t[1], 1); near(Math.hypot(t[0], t[2]), 0, 1e-12)
  near(Math.hypot(...lightDirection(123, 41)), 1)
  assert.ok(lightDirection(0, 45)[1] > 0.7 && lightDirection(0, 45)[2] > 0.7)
})
test('the floor lies at the lowest point of the model (a hair under it), centred under it, and is much wider than the model', () => {
  const f = floorSpec(box)
  assert.ok(f.y <= box.min.y && box.min.y - f.y < 0.001 * 7, `y ${f.y}`)
  near(f.cx, 1)
  near(f.cz, 0)
  assert.ok(f.size >= 4 * 8)
})
test('a light stands on its side of the model, aims at the centre and its shadow camera covers the model', () => {
  const p = lightPlacement(box, { intensity: 1, azimuth: 90, elevation: 0 })
  assert.deepEqual(p.target, [1, 4, 0])
  assert.ok(p.position[0] > p.target[0] + 10, 'to the right')
  near(p.position[1], 4)
  near(p.position[2], 0, 1e-9)
  const diag = Math.hypot(4, 4, 4)
  assert.ok(p.shadowExtent >= diag / 2 && p.far > p.near && p.near > 0)
  const up = lightPlacement(box, { intensity: 1, azimuth: 0, elevation: 90 })
  assert.ok(up.position[1] > 4 + diag)
})
test('camera presets look at the model centre from the expected side and keep the model in view', () => {
  const front = cameraPreset('front', box, 50, 1)
  assert.deepEqual(front.target, [1, 4, 0])
  assert.ok(front.position[2] > 4 && Math.abs(front.position[0] - 1) < 1e-9, 'in front, centred')
  const top = cameraPreset('top', box, 50, 1)
  assert.ok(top.position[1] > 4 + 4)
  const three = cameraPreset('three_quarter', box, 50, 1)
  assert.ok(three.position[0] > 1 && three.position[1] > 4 && three.position[2] > 0)
  const hero = cameraPreset('hero', box, 50, 1)
  assert.ok(Math.hypot(hero.position[0] - 1, hero.position[1] - 4, hero.position[2]) < Math.hypot(front.position[0] - 1, front.position[1] - 4, front.position[2]), 'closer')
  // a narrow view needs more distance than a wide one
  const narrow = cameraPreset('front', box, 50, 0.4)
  assert.ok(narrow.position[2] > front.position[2])
  // every corner of the box is inside the view (projected with the real field of view)
  for (const c of [[-1, 2, -2], [3, 6, 2], [-1, 6, 2], [3, 2, -2]]) {
    const d = [c[0] - front.position[0], c[1] - front.position[1], c[2] - front.position[2]]
    const depth = -d[2]
    const t = Math.tan((50 * Math.PI) / 360)
    assert.ok(Math.abs(d[1] / depth) < t && Math.abs(d[0] / depth) < t, `corner ${c}`)
  }
})
test('shadow policy: meshes up to 1 M triangles live, up to 3 M static, above none; points and splats never', () => {
  assert.deepEqual(shadowPolicy({ tris: 500_000 }), { enabled: true, mode: 'live', note: null, mapSize: 1024 })
  assert.equal(shadowPolicy({ tris: 500_000, quality: 'high' }).mapSize, 2048)
  assert.equal(shadowPolicy({ tris: 2_000_000 }).mode, 'static')
  assert.equal(shadowPolicy({ tris: 4_000_000 }).enabled, false)
  assert.equal(shadowPolicy({ tris: 4_000_000 }).note, 'huge')
  assert.equal(shadowPolicy({ points: 1e6 }).note, 'points')
  assert.equal(shadowPolicy({ tris: 10, splat: true }).note, 'splat')
  assert.equal(shadowPolicy({ tris: 1000, points: 5 }).enabled, true, 'a mesh with a few points still casts')
})
test('turntable angle: 30 degrees per second for 12 seconds is one turn', () => {
  near(spinAngle(30, 12), 2 * Math.PI)
  near(spinAngle(90, 1), Math.PI / 2)
})

test('a flat, wide scene catches shadows on the model itself, a compact object does not', () => {
  const b = (x, y, z) => ({ min: { x: 0, y: 0, z: 0 }, max: { x, y, z } })
  assert.equal(receivesShadow(b(100, 10, 100)), true, 'a landscape')
  assert.equal(receivesShadow(b(90, 30, 80)), true, 'exactly three times as wide as high')
  assert.equal(receivesShadow(b(90, 31, 80)), false, 'just below that')
  assert.equal(receivesShadow(b(80, 40, 30)), false, 'the bracket sample is 2:1')
  assert.equal(receivesShadow(b(20, 20, 20)), false, 'a cube')
  assert.equal(receivesShadow(b(0, 0, 0)), false, 'an empty box')
})

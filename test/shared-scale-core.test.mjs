import test from 'node:test'
import assert from 'node:assert/strict'
import { pixelsPerUnit, niceLength, zoomPercent, lengthText } from '../editor/shared/scale-core.js'

// a perspective camera: a point at depth z, y above the axis, lands at (y / (z tan(fov/2))) * H/2 pixels from the middle
const project = (y, z, fov, H) => (y / (z * Math.tan((fov * Math.PI) / 360))) * (H / 2)

test('pixels per unit in the plane of the target match a real perspective projection', () => {
  for (const [fov, H, d] of [[50, 800, 100], [50, 404, 3.7], [30, 1000, 0.02], [75, 600, 5000]]) {
    const ppu = pixelsPerUnit({ fovDeg: fov, viewH: H, distance: d })
    const unit = d / 10 // a length lying in the target plane (same depth d)
    const measured = project(unit, d, fov, H) - project(0, d, fov, H)
    assert.ok(Math.abs(ppu * unit - measured) <= 1e-9 * Math.max(1, measured), `${fov} ${H} ${d}`)
  }
  // twice as far: half the pixels; in another plane the bar would be wrong (a point nearer is bigger): the scale is for the target plane only
  const near = pixelsPerUnit({ fovDeg: 50, viewH: 800, distance: 50 })
  assert.ok(Math.abs(pixelsPerUnit({ fovDeg: 50, viewH: 800, distance: 100 }) * 2 - near) < 1e-9)
})

test('no number when the camera data are not usable', () => {
  for (const bad of [{ fovDeg: 0, viewH: 800, distance: 1 }, { fovDeg: 180, viewH: 800, distance: 1 }, { fovDeg: 50, viewH: 0, distance: 1 }, { fovDeg: 50, viewH: 800, distance: 0 }, { fovDeg: NaN, viewH: 800, distance: 1 }, { fovDeg: 50, viewH: 800, distance: -3 }, {}]) assert.equal(pixelsPerUnit(bad), null)
  for (const bad of [0, -1, NaN, Infinity, undefined]) assert.equal(niceLength(bad), null)
  assert.equal(niceLength(10, { maxPx: 0 }), null)
})

test('the scale bar is a value of the series 1-2-5 and between maxPx/2.5 and maxPx pixels, from tiny to huge models', () => {
  const allowed = new Set([1, 2, 5])
  for (let e = -9; e <= 9; e++) {
    for (const k of [1, 1.3, 1.99, 2, 2.4, 3.7, 4.99, 5, 7.9, 9.99]) {
      const ppu = k * 10 ** e
      const r = niceLength(ppu)
      assert.ok(r, `ppu ${ppu}`)
      const mantissa = Number((r.length / 10 ** Math.floor(Math.log10(r.length))).toPrecision(9))
      assert.ok(allowed.has(mantissa), `${r.length} is not 1, 2 or 5 times a power of ten (ppu ${ppu})`)
      assert.ok(r.px <= 140 * (1 + 1e-9) && r.px >= 56 * (1 - 1e-9), `${r.px} px for ppu ${ppu}`)
      assert.ok(Math.abs(r.px - r.length * ppu) < 1e-6 * r.px)
    }
  }
  assert.deepEqual(niceLength(2), { length: 50, px: 100 }) // 2 px per unit: 50 units are 100 px (the series: 50 <= 70, 100 would be 200 px)
  assert.equal(niceLength(0.3).length, 200)
  assert.equal(niceLength(1e-3).length, 100000)
})

test('the length is exact in decimal (no 0.30000000000000004)', () => {
  assert.equal(niceLength(300).length, 0.2)
  assert.equal(niceLength(1500).length, 0.05)
  assert.equal(lengthText(0.1 + 0.2, 'en'), '0.3')
  assert.equal(lengthText(1234.5, 'en'), '1,234.5')
  assert.equal(lengthText(1234.5, 'de'), '1.234,5')
  assert.equal(lengthText(5e-10, 'en'), '0.0000000005') // a very small unit or a very near view is not "0"
  assert.equal(lengthText(2e12, 'en'), '2,000,000,000,000')
})

test('zoom in percent: 100 % is "show all", twice as close is 200 %', () => {
  assert.equal(zoomPercent(100, 100), 100)
  assert.equal(zoomPercent(100, 50), 200)
  assert.equal(zoomPercent(100, 400), 25)
  assert.equal(zoomPercent(100, 82), 122) // the close-up view (presetScale 0.82) stands nearer than "show all"
  for (const bad of [[0, 1], [1, 0], [NaN, 1], [1, NaN], [-1, 1], [undefined, 1]]) assert.equal(zoomPercent(...bad), null)
})

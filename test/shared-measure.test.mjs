// Tests for the measuring arithmetic (editor/shared/measure.js). Same file in both plugins.
import test from 'node:test'
import assert from 'node:assert/strict'
import { nearestSegment, straightRun, angleAt, circleThrough, nearestEdge, MEASURE_POINTS } from '../editor/shared/measure.js'

const near = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) <= e, `${a} vs ${b}`)

test('angle: a right angle, a straight line, 60 degrees in a triangle, and a coinciding point', () => {
  near(angleAt([1, 0, 0], [0, 0, 0], [0, 1, 0]), 90)
  near(angleAt([-1, 0, 0], [0, 0, 0], [1, 0, 0]), 180)
  near(angleAt([1, 0, 0], [0, 0, 0], [0.5, Math.sqrt(3) / 2, 0]), 60)
  assert.equal(angleAt([0, 0, 0], [0, 0, 0], [1, 0, 0]), 0)
})

test('circle through three points: a unit circle in space, any orientation, and collinear points give nothing', () => {
  const c = circleThrough([1, 0, 0], [0, 1, 0], [-1, 0, 0])
  near(c.radius, 1)
  near(c.diameter, 2)
  ;[0, 0, 0].forEach((v, i) => near(c.center[i], v))
  near(Math.abs(c.normal[2]), 1)
  // the same circle tilted: center (2, 3, 4), radius 5, in the plane x + y + z = 9
  const n = [1, 1, 1].map((x) => x / Math.sqrt(3))
  const u = [1, -1, 0].map((x) => x / Math.sqrt(2))
  const w = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]]
  const p = (t) => [2, 3, 4].map((o, i) => o + 5 * (Math.cos(t) * u[i] + Math.sin(t) * w[i]))
  const d = circleThrough(p(0.3), p(2.1), p(4.0))
  near(d.radius, 5, 1e-9)
  ;[2, 3, 4].forEach((v, i) => near(d.center[i], v, 1e-9))
  assert.equal(circleThrough([0, 0, 0], [1, 1, 1], [2, 2, 2]), null)
  assert.equal(circleThrough([0, 0, 0], [0, 0, 0], [1, 0, 0]), null)
})

test('nearest edge of a triangle to a point, with its length', () => {
  const e = nearestEdge([0, 0, 0], [4, 0, 0], [0, 3, 0], [2, 0.1, 0])
  assert.equal(e.index, 0)
  near(e.length, 4)
  const hyp = nearestEdge([0, 0, 0], [4, 0, 0], [0, 3, 0], [2.1, 1.6, 0])
  assert.equal(hyp.index, 1)
  near(hyp.length, 5)
  assert.deepEqual(MEASURE_POINTS, { distance: 2, angle: 3, circle: 3, edge: 1, parts: 2 })
})

test('edge picking: the nearest segment among model edges, and a straight edge made of several segments is one edge', () => {
  // an edge of length 10 split in three pieces, a second edge at the side, and a bent continuation that is not straight
  const segs = Float32Array.from([0, 0, 0, 3, 0, 0, 3, 0, 0, 7, 0, 0, 7, 0, 0, 10, 0, 0, 10, 0, 0, 10, 5, 0, 0, 4, 0, 10, 4, 0])
  const near = nearestSegment(segs, [4, 0.3, 0])
  assert.equal(near.index, 1)
  const run = straightRun(segs, near)
  assert.equal(run.count, 3)
  assert.deepEqual([run.a, run.b].map((p) => p.map(Math.round)).sort((p, q) => p[0] - q[0]), [[0, 0, 0], [10, 0, 0]], 'the corner at x = 10 stops the run')
  // a click on a face center: the nearest model edge, not a diagonal (there is none among the segments)
  const cube = Float32Array.from([0, 0, 0, 10, 0, 0, 10, 0, 0, 10, 10, 0, 10, 10, 0, 0, 10, 0, 0, 10, 0, 0, 0, 0])
  const n2 = nearestSegment(cube, [5, 5, 0])
  assert.ok(n2.distance <= 5 + 1e-9)
  assert.equal(Math.round(Math.hypot(...straightRun(cube, n2).b.map((v, i) => v - straightRun(cube, n2).a[i]))), 10)
  assert.equal(nearestSegment(new Float32Array(0), [0, 0, 0]), null)
})

test('straightRun: segments that meet across a cell border of the end-point grid still form one run', () => {
  // extent 100 -> grid cell 1e-3; the shared end lies on the rounding border (0.5 cell) and differs by 1e-9 between the two segments
  const segs = new Float64Array([0, 0, 0, 0.0005, 0, 0, 0.0005 - 1e-9, 0, 0, 100, 0, 0])
  const run = straightRun(segs, { a: [0, 0, 0], b: [0.0005, 0, 0], index: 0 })
  assert.equal(run.count, 2)
  assert.ok(Math.abs(run.b[0] - 100) < 1e-9)
})

test('straightRun: at a junction the segment that continues the line best wins, not the last one within the tolerance', () => {
  // from (0,0,0) to (1,0,0); at the end two candidates: one 0.5 degrees off (straight enough), one exactly straight, listed first
  const a = 0.5 * Math.PI / 180
  const segs = new Float64Array([0, 0, 0, 1, 0, 0, /* best */ 1, 0, 0, 2, 0, 0, /* worse, listed last */ 1, 0, 0, 1 + Math.cos(a), Math.sin(a), 0])
  const run = straightRun(segs, { a: [0, 0, 0], b: [1, 0, 0], index: 0 })
  assert.ok(Math.abs(run.b[0] - 2) < 1e-9 && Math.abs(run.b[1]) < 1e-9, `ended at ${run.b}`)
})

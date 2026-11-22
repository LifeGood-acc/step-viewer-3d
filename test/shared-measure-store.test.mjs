// Measure+ arithmetic against known shapes (a cube, a 3-4-5 triangle, a 3 x 4 rectangle, a circle of radius 5). Same file in both plugins.
import test from 'node:test'
import assert from 'node:assert/strict'
import { chainLengths, compareValues, computeMeasure, createStore, layoutLabels, measuresToCsv, measuresToText, nearestMarker, polygonArea, pointAtHalf } from '../editor/shared/measure-store.js'

const near = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} is not ${b}`)
// a cube of 10: corner (0,0,0) to the far corner
const cube = { kind: 'distance', pts: [[0, 0, 0], [10, 10, 10]] }

test('distance: the space diagonal of a 10 cube is 10 * sqrt(3), the deltas are 10 / 10 / 10', () => {
  const c = computeMeasure(cube)
  near(c.value, 10 * Math.sqrt(3))
  assert.deepEqual(c.delta, [10, 10, 10])
  assert.deepEqual(c.anchor, [5, 5, 5])
})
test('distance: an edge of the cube is 10; deltas are absolute', () => {
  const c = computeMeasure({ kind: 'edge', pts: [[10, 0, 0], [0, 0, 0]] })
  near(c.value, 10)
  assert.deepEqual(c.delta, [10, 0, 0])
})
test('angle: the corner of a cube is 90 degrees, the arms are 10 long, the label stands inside the angle', () => {
  const c = computeMeasure({ kind: 'angle', pts: [[10, 0, 0], [0, 0, 0], [0, 10, 0]] })
  near(c.value, 90, 1e-9)
  assert.equal(c.quantity, 'angle')
  assert.deepEqual(c.arms, [10, 10])
  assert.ok(c.anchor[0] > 0 && c.anchor[1] > 0 && c.anchor[2] === 0)
})
test('angle: a face diagonal against an edge is 45 degrees', () => {
  near(computeMeasure({ kind: 'angle', pts: [[10, 10, 0], [0, 0, 0], [10, 0, 0]] }).value, 45, 1e-9)
})
test('circle: three points on a circle of radius 5 give diameter 10, radius 5, the centre', () => {
  const c = computeMeasure({ kind: 'circle', pts: [[5, 0, 0], [0, 5, 0], [-5, 0, 0]] })
  near(c.value, 10)
  near(c.radius, 5)
  c.center.forEach((v, i) => near(v, 0, 1e-9))
  const bad = computeMeasure({ kind: 'circle', pts: [[0, 0, 0], [1, 0, 0], [2, 0, 0]] })
  assert.equal(bad.ok, false)
  assert.equal(bad.error, 'collinear')
})
test('chain: four points around a 3 x 4 rectangle: pieces 3, 4, 3 and sum 10; closed: 3, 4, 3, 4, sum 14, area 12', () => {
  const pts = [[0, 0, 0], [3, 0, 0], [3, 4, 0], [0, 4, 0]]
  const open = computeMeasure({ kind: 'chain', pts })
  assert.deepEqual(open.segLengths, [3, 4, 3])
  near(open.total, 10)
  near(open.value, 10)
  assert.equal(open.area, undefined, 'an open chain has no area')
  const closed = computeMeasure({ kind: 'chain', pts, closed: true })
  assert.deepEqual(closed.segLengths, [3, 4, 3, 4])
  near(closed.total, 14)
  near(closed.area, 12)
  near(closed.flatness, 0)
  assert.equal(closed.nonPlanar, false)
  assert.equal(closed.segments.length, 4)
})
test('chain: the 3-4-5 triangle has perimeter 12 and area 6, in any plane (turned into x-z and into a tilted plane)', () => {
  near(computeMeasure({ kind: 'chain', pts: [[0, 0, 0], [3, 0, 0], [0, 4, 0]], closed: true }).area, 6)
  near(computeMeasure({ kind: 'chain', pts: [[0, 0, 0], [3, 0, 0], [0, 0, 4]], closed: true }).area, 6)
  const k = 1 / Math.sqrt(2) // tilted 45 degrees about x
  near(computeMeasure({ kind: 'chain', pts: [[0, 0, 0], [3, 0, 0], [0, 4 * k, 4 * k]], closed: true }).area, 6)
  near(computeMeasure({ kind: 'chain', pts: [[0, 0, 0], [3, 0, 0], [0, 4, 0]], closed: true }).total, 12)
})
test('chain: points that do not lie in one plane are flagged', () => {
  const c = computeMeasure({ kind: 'chain', pts: [[0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 3]], closed: true })
  assert.equal(c.nonPlanar, true)
  assert.ok(c.flatness > 0.5)
})
test('polygonArea: a unit square is 1, points on a line give null, fewer than three give null', () => {
  near(polygonArea([[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]]).area, 1)
  assert.equal(polygonArea([[0, 0, 0], [1, 0, 0], [2, 0, 0]]), null)
  assert.equal(polygonArea([[0, 0, 0], [1, 0, 0]]), null)
})
test('pointAtHalf: the middle of a 3 + 4 chain stands 3.5 along, i.e. on the second piece at 0.5', () => {
  const p = pointAtHalf([[0, 0, 0], [3, 0, 0], [3, 4, 0]])
  near(p[0], 3)
  near(p[1], 0.5)
  assert.equal(chainLengths([[0, 0, 0]]).total, 0)
})
test('too few points: not ok, no number', () => {
  const c = computeMeasure({ kind: 'distance', pts: [[0, 0, 0]] })
  assert.equal(c.ok, false)
  assert.ok(Number.isNaN(c.value))
})
test('compare: 40 against 25 is a difference of 15 and a ratio of 1.6 (160 %); a length and an angle do not compare', () => {
  const a = computeMeasure({ kind: 'distance', pts: [[0, 0, 0], [40, 0, 0]] })
  const b = computeMeasure({ kind: 'distance', pts: [[0, 0, 0], [0, 25, 0]] })
  const r = compareValues(a, b)
  assert.equal(r.same, true)
  near(r.diff, 15)
  near(r.ratio, 1.6)
  near(r.percent, 160)
  assert.equal(compareValues(a, computeMeasure({ kind: 'angle', pts: [[1, 0, 0], [0, 0, 0], [0, 1, 0]] })).same, false)
  assert.equal(compareValues(a, computeMeasure({ kind: 'distance', pts: [[0, 0, 0], [0, 0, 0]] })).ratio, null)
})

test('store: numbers are not reused, colours rotate, selection follows add and remove', () => {
  const s = createStore()
  let fired = 0
  s.on(() => fired++)
  const a = s.add(cube)
  const b = s.add({ kind: 'distance', pts: [[0, 0, 0], [1, 0, 0]] })
  assert.deepEqual([a.no, b.no], [1, 2])
  assert.notEqual(a.color, b.color)
  assert.equal(s.selected(), b.id)
  s.remove(b.id)
  assert.equal(s.selected(), a.id)
  const c = s.add(cube)
  assert.equal(c.no, 3, 'a removed number is not given again')
  s.update(c.id, { name: 'Rod', visible: false })
  assert.equal(s.get(c.id).name, 'Rod')
  assert.ok(fired >= 5)
  s.clear()
  assert.equal(s.count(), 0)
  assert.equal(s.selected(), null)
})
test('store: moving a point changes the value; a chain loses a point but keeps two; closing needs three', () => {
  const s = createStore()
  const m = s.add({ kind: 'distance', pts: [[0, 0, 0], [10, 0, 0]] })
  s.setPoint(m.id, 1, [0, 20, 0])
  near(computeMeasure(s.get(m.id)).value, 20)
  const ch = s.add({ kind: 'chain', pts: [[0, 0, 0], [1, 0, 0], [1, 1, 0]], closed: true })
  s.removePoint(ch.id, 2)
  assert.equal(s.get(ch.id).pts.length, 2)
  assert.equal(s.get(ch.id).closed, false)
  assert.equal(s.removePoint(ch.id, 0), null, 'two points stay')
})
test('store: the input points are copied (changing them later does not move the measurement)', () => {
  const s = createStore()
  const p = [[0, 0, 0], [1, 0, 0]]
  const m = s.add({ kind: 'distance', pts: p })
  p[1][0] = 99
  assert.equal(m.pts[1][0], 1)
})

test('text and CSV: known numbers, German and English decimal marks, quoting', () => {
  const list = [
    { no: 1, kind: 'distance', name: 'Rod; "A"', pts: [[0, 0, 0], [10, 0, 0.5]], extra: null },
    { no: 2, kind: 'angle', name: '', pts: [[1, 0, 0], [0, 0, 0], [0, 1, 0]], extra: null }
  ]
  const csvEn = measuresToCsv(list, { locale: 'en', unit: 'mm', kindName: (k) => k.toUpperCase() })
  const rowsEn = csvEn.trim().split('\n')
  assert.equal(rowsEn[0], 'No,Kind,Name,Value,Unit,Detail,Points')
  assert.ok(rowsEn[1].startsWith('1,DISTANCE,"Rod; ""A""",10.0125,mm,'), rowsEn[1])
  assert.ok(rowsEn[2].includes(',90,°,'), rowsEn[2])
  const csvDe = measuresToCsv(list, { locale: 'de', unit: 'mm', kindName: (k) => k })
  assert.ok(csvDe.split('\n')[1].startsWith('1;distance;"Rod; ""A""";10,0125;mm;'), csvDe)
  assert.ok(csvDe.split('\n')[1].endsWith('0 0 0 | 10 0 0,5'))
  const text = measuresToText(list, { kindName: (k) => k, fmt: (v, q) => (q === 'angle' ? `${v.toFixed(1)}°` : `${v.toFixed(2)} mm`) })
  assert.equal(text, '1  distance  10.01 mm  (Rod; "A")\n2  angle  90.0°\n')
})

test('labels: two labels on the same spot do not overlap; an optional one that has no room is hidden; labels stay inside the view', () => {
  const items = [
    { x: 100, y: 100, w: 60, h: 20 },
    { x: 100, y: 100, w: 60, h: 20 },
    { x: 100, y: 100, w: 60, h: 20 },
    { x: 2, y: 2, w: 60, h: 20 }
  ]
  const out = layoutLabels(items, 400, 300)
  const rects = out.filter((o) => !o.hidden)
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
    const overlap = Math.abs(rects[i].x - rects[j].x) < 60 && Math.abs(rects[i].y - rects[j].y) < 20
    assert.equal(overlap, false, `labels ${i} and ${j} overlap`)
  }
  assert.ok(out[3].x >= 30 && out[3].y >= 10, 'kept inside the view')
  const crowded = layoutLabels(Array.from({ length: 60 }, () => ({ x: 50, y: 50, w: 100, h: 40, optional: true })), 100, 40)
  assert.ok(crowded.some((o) => o.hidden), 'optional labels without room are hidden')
  const two = layoutLabels([{ x: 50, y: 50, w: 100, h: 40 }, { x: 50, y: 50, w: 100, h: 40 }], 100, 40)
  assert.deepEqual(two.map((o) => !!o.bundled), [false, true], 'a main label without room is bundled, never stacked')
})
test('labels: main labels never overlap; what finds no room anywhere is bundled (flag), not stacked', () => {
  const W = 300
  const H = 200
  const items = Array.from({ length: 40 }, (_, i) => ({ x: 150, y: 100, w: 80, h: 30, priority: i === 0 ? 3 : 2 }))
  const out = layoutLabels(items, W, H)
  const shown = out.filter((o) => !o.hidden)
  const bundled = out.filter((o) => o.hidden)
  assert.ok(shown.length >= 10, 'a full view still shows many main labels: ' + shown.length)
  assert.ok(bundled.length > 0 && bundled.every((o) => o.bundled === true), 'the rest is bundled')
  assert.equal(shown.length + bundled.length, 40)
  for (let i = 0; i < shown.length; i++) {
    assert.ok(shown[i].x >= 40 && shown[i].x <= W - 40 && shown[i].y >= 15 && shown[i].y <= H - 15, 'inside the view')
    for (let j = i + 1; j < shown.length; j++) assert.ok(Math.abs(shown[i].x - shown[j].x) >= 80 || Math.abs(shown[i].y - shown[j].y) >= 30, `main labels ${i}/${j} overlap`)
  }
  assert.deepEqual([out[0].x, out[0].y], [150, 100], 'the highest priority keeps its place')
  // obstacles (labels already placed) are respected: with the whole view taken but one slot, the label goes exactly there
  const taken = []
  for (let y = 15; y <= 185; y += 30) for (let x = 40; x <= 260; x += 80) if (!(x === 120 && y === 105)) taken.push({ x, y, w: 80, h: 30 })
  const next = layoutLabels([{ x: 150, y: 100, w: 70, h: 20 }], W, H, 0, taken)
  assert.equal(next[0].hidden, false)
  assert.ok(next[0].x > 80 && next[0].x < 160 && next[0].y > 90 && next[0].y < 120, `put into the free slot: ${next[0].x},${next[0].y}`)
})
test('labels: the one with the higher priority keeps its wanted place', () => {
  const out = layoutLabels([{ x: 100, y: 100, w: 60, h: 20, priority: 0 }, { x: 100, y: 100, w: 60, h: 20, priority: 5 }], 400, 300)
  assert.deepEqual([out[1].x, out[1].y], [100, 100])
  assert.notDeepEqual([out[0].x, out[0].y], [100, 100])
})
test('nearestMarker: within the radius, the closest wins', () => {
  const items = [{ id: 'a', index: 0, x: 10, y: 10 }, { id: 'b', index: 1, x: 14, y: 10 }]
  assert.equal(nearestMarker(items, 13, 10).id, 'b')
  assert.equal(nearestMarker(items, 100, 100), null)
})

// /correct: the e2e once clicked tabs by position (hidden tabs shift it) and used screen points from before the camera moved. Guard the pattern.
import { readFileSync, existsSync } from 'node:fs'
test('e2e-measure picks tabs by id and takes no tab by position', () => {
  const f = new URL('../dev/e2e-measure.mjs', import.meta.url)
  if (!existsSync(f)) return
  const src = readFileSync(f, 'utf8')
  assert.equal(/side-tabs \.tab:nth-child/.test(src), false, "use window.__h.chrome.tabs.select('measure'), not a tab by position")
})

test('review: negative coordinates in the CSV keep their sign (no apostrophe), a name that looks like a formula still gets one', () => {
  const csv = measuresToCsv([{ no: 1, kind: 'distance', name: '=SUM(A1)', pts: [[-1.5, 2, 3], [4, 5, 6]] }])
  const row = csv.split('\n')[1]
  assert.ok(row.includes('-1.5 2 3 | 4 5 6') && !row.includes("'-1.5"), row)
  assert.ok(row.includes("'=SUM(A1)"), row)
})
test('review: the area of a small polygon far from the origin is still right', () => {
  const o = 1e6
  const a = polygonArea([[o, o, 0], [o + 0.01, o, 0], [o + 0.01, o + 0.01, 0], [o, o + 0.01, 0]])
  assert.ok(a && Math.abs(a.area - 0.0001) < 1e-8, String(a && a.area))
})
test('review: moving a point of an edge measurement makes it a plain distance (the label no longer says "edge")', () => {
  const s = createStore()
  const m = s.add({ kind: 'edge', pts: [[0, 0, 0], [1, 0, 0]], extra: { triangle: true } })
  s.setPoint(m.id, 1, [2, 0, 0])
  assert.equal(s.get(m.id).kind, 'distance')
  assert.equal(s.get(m.id).extra, null)
})

test('review: a crowded view stays cheap per frame (grid of taken places, nearest-first scan, no repeated scans for sizes that cannot fit)', () => {
  const run = (n) => {
    const items = Array.from({ length: n }, () => ({ x: 600, y: 400, w: 90, h: 30 }))
    layoutLabels(items, 1180, 760) // warm up
    const t0 = performance.now()
    const out = layoutLabels(items, 1180, 760)
    return { ms: performance.now() - t0, out }
  }
  const r100 = run(100)
  assert.ok(r100.ms < 150,  `100 crowded labels took ${r100.ms.toFixed(1)} ms`)
  const r300 = run(300)
  assert.ok(r300.ms < 600, `300 crowded labels took ${r300.ms.toFixed(1)} ms`)
  const shown = r300.out.filter((o) => !o.hidden)
  assert.ok(shown.length > 100 && r300.out.length - shown.length > 0, 'many are placed, the rest is bundled')
  for (let i = 0; i < shown.length; i += 7) for (let j = i + 1; j < shown.length; j++) assert.ok(Math.abs(shown[i].x - shown[j].x) >= 90 || Math.abs(shown[i].y - shown[j].y) >= 30, 'no overlap')
})

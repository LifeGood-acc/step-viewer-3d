// Shared by 3D Model Viewer and STEP Viewer 3D (canonical copy: plugins/_shared; do not edit the copies in editor/shared).
// The arithmetic of the measuring modes: angle, circle through three points, nearest edge of a triangle. Pure.
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const len = (a) => Math.hypot(a[0], a[1], a[2])
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k]
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]

/** The angle at `b` between the rays to `a` and `c`, in degrees (0 when a point coincides with b). */
export function angleAt(a, b, c) {
  const u = sub(a, b)
  const v = sub(c, b)
  const l = len(u) * len(v)
  if (l === 0) return 0
  return (Math.acos(Math.max(-1, Math.min(1, dot(u, v) / l))) * 180) / Math.PI
}

/** The circle through three points: { center, radius, diameter, normal }, or null when they lie on a line (or two coincide). */
export function circleThrough(a, b, c) {
  const ab = sub(b, a)
  const ac = sub(c, a)
  const n = cross(ab, ac)
  const n2 = dot(n, n)
  if (n2 < 1e-18 * dot(ab, ab) * dot(ac, ac) || n2 === 0) return null // sin(angle)^2 of the corner at a: scale-free
  // center = a + ((|ac|^2 (ab x ac) x ab) + (|ab|^2 ac x (ab x ac))) / (2 |ab x ac|^2)
  const t1 = scale(cross(cross(ab, ac), ab), dot(ac, ac))
  const t2 = scale(cross(ac, cross(ab, ac)), dot(ab, ab))
  const center = add(a, scale(add(t1, t2), 1 / (2 * n2)))
  const radius = len(sub(center, a))
  return { center, radius, diameter: 2 * radius, normal: scale(n, 1 / Math.sqrt(n2)) }
}

/** The edge of the triangle (p0, p1, p2) that is nearest to `point`: { a, b, length, index } (index 0: p0-p1, 1: p1-p2, 2: p2-p0). */
export function nearestEdge(p0, p1, p2, point) {
  const edges = [[p0, p1], [p1, p2], [p2, p0]]
  let best = null
  edges.forEach(([a, b], index) => {
    const ab = sub(b, a)
    const l2 = dot(ab, ab)
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, dot(sub(point, a), ab) / l2))
    const d = len(sub(point, add(a, scale(ab, t))))
    if (!best || d < best.distance) best = { a, b, length: Math.sqrt(l2), index, distance: d }
  })
  return best
}

/** How many clicks a mode needs. */
export const MEASURE_POINTS = { distance: 2, angle: 3, circle: 3, edge: 1, parts: 2 }

/** The segment among `segs` (a flat array: x0 y0 z0 x1 y1 z1 per segment) that is nearest to `point`: { a, b, distance, index } or null. */
export function nearestSegment(segs, point) {
  // plain numbers per segment (no arrays): this runs over every segment of a large model on each click
  let best = Infinity
  let at = -1
  const [px, py, pz] = point
  for (let i = 0; i + 5 < segs.length; i += 6) {
    const ax = segs[i]
    const ay = segs[i + 1]
    const az = segs[i + 2]
    const dx = segs[i + 3] - ax
    const dy = segs[i + 4] - ay
    const dz = segs[i + 5] - az
    const l2 = dx * dx + dy * dy + dz * dz
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy + (pz - az) * dz) / l2))
    const ex = px - (ax + dx * t)
    const ey = py - (ay + dy * t)
    const ez = pz - (az + dz * t)
    const d = ex * ex + ey * ey + ez * ez // squared: the root is taken once, for the winner
    if (d < best) {
      best = d
      at = i
    }
  }
  if (at < 0) return null
  return { a: [segs[at], segs[at + 1], segs[at + 2]], b: [segs[at + 3], segs[at + 4], segs[at + 5]], distance: Math.sqrt(best), index: at / 6 }
}

/** Extends a segment along the segments that continue it in a straight line (within `tolDeg`), at both ends: a long straight edge of a model is
 *  often made of several mesh segments. Returns { a, b, count } (the ends of the whole run). Segments meet when their ends are within a
 *  hundred-thousandth of the longest extent. */
const endCache = new WeakMap()
function endpointsOf(segs) {
  let c = endCache.get(segs)
  if (c) return c
  const n = Math.floor(segs.length / 6)
  const lo = [Infinity, Infinity, Infinity]
  const hi = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < segs.length; i += 3) for (let k = 0; k < 3; k++) {
    lo[k] = Math.min(lo[k], segs[i + k])
    hi[k] = Math.max(hi[k], segs[i + k])
  }
  const cell = (Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) || 1) * 1e-5
  const key = (x, y, z) => `${Math.round(x / cell)},${Math.round(y / cell)},${Math.round(z / cell)}`
  const cellOf = (v) => Math.round(v / cell)
  const ends = new Map() // end point -> [segment index, 0 or 1]
  for (let i = 0; i < n; i++) for (const e of [0, 1]) {
    const k = key(segs[6 * i + 3 * e], segs[6 * i + 3 * e + 1], segs[6 * i + 3 * e + 2])
    if (!ends.has(k)) ends.set(k, [])
    ends.get(k).push([i, e])
  }
  c = { ends, key, cell, cellOf }
  endCache.set(segs, c) // built once per set of segments, not on every click
  return c
}
export function straightRun(segs, seg, tolDeg = 1) {
  const { ends, cell, cellOf } = endpointsOf(segs)
  // the end points that are within a cell of `p`: the grid is searched in the 27 cells around it, so a point on a cell border is not lost
  const near = (p) => {
    const out = []
    const [cx, cy, cz] = [cellOf(p[0]), cellOf(p[1]), cellOf(p[2])]
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      for (const [i, e] of ends.get(`${cx + dx},${cy + dy},${cz + dz}`) || []) {
        const o = 6 * i + 3 * e
        if (Math.hypot(segs[o] - p[0], segs[o + 1] - p[1], segs[o + 2] - p[2]) <= cell) out.push([i, e])
      }
    }
    return out
  }
  const dir = sub(seg.b, seg.a)
  const dl = len(dir)
  if (!(dl > 0)) return { a: seg.a, b: seg.b, count: 1 }
  const cosTol = Math.cos((tolDeg * Math.PI) / 180)
  let count = 1
  const used = new Set([seg.index])
  const walk = (from, sign) => {
    let p = from
    for (let guard = 0; guard < 100000; guard++) {
      const cands = near(p)
      let next = null
      let bestCos = cosTol
      for (const [i, e] of cands) {
        if (used.has(i)) continue
        const q = [segs[6 * i + 3 * (1 - e)], segs[6 * i + 3 * (1 - e) + 1], segs[6 * i + 3 * (1 - e) + 2]]
        const d = sub(q, p)
        const l = len(d)
        const cos = l > 0 ? (dot(d, dir) * sign) / (l * dl) : -1
        if (cos >= bestCos) {
          bestCos = cos // the segment that continues the line best, not just the last one that is within the tolerance
          next = { i, q }
        }
      }
      if (!next) return p
      used.add(next.i)
      count++
      p = next.q
    }
    return p
  }
  const b = walk(seg.b, 1)
  const a = walk(seg.a, -1)
  return { a, b, count }
}

// Shared by 3D Model Viewer and STEP Viewer 3D (canonical copy: plugins/_shared; do not edit the copies in editor/shared).
// Measure+: the list of measurements and the arithmetic on it. Pure (no three.js, no DOM), so that the numbers can be tested against known
// shapes. A measurement keeps its points in the FILE's own axes and unit (the "Up is" choice and the turntable do not move them); the view
// turns them into markers, lines and labels.
import { angleAt, circleThrough } from './measure.js'

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k]
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const len = (a) => Math.hypot(a[0], a[1], a[2])
const mid = (a, b) => scale(add(a, b), 0.5)

/** The kinds of measurement and how many points each needs (chain: at least 2, no upper limit). */
export const KINDS = ['distance', 'angle', 'circle', 'edge', 'chain', 'parts']
export const POINTS = { distance: 2, angle: 3, circle: 3, edge: 2, chain: 2, parts: 2 }
/** Label colours: dark enough that white text on the label (about 90 % opaque) keeps a contrast near 4.5:1 even over a white background. */
export const COLORS = ['#c0281c', '#0a56bd', '#17782f', '#8f4a00', '#7a31bd', '#006b6b', '#ad1a5c', '#4d4d55']

/** The length of a polyline (closed: back to the first point), and each of its pieces. */
export function chainLengths(pts, closed = false) {
  const segs = []
  for (let i = 0; i + 1 < pts.length; i++) segs.push(len(sub(pts[i + 1], pts[i])))
  if (closed && pts.length > 2) segs.push(len(sub(pts[0], pts[pts.length - 1])))
  return { segs, total: segs.reduce((a, b) => a + b, 0) }
}

/**
 * The area of a closed polygon through the points (Newell's method: the area of the polygon projected on its own mean plane, exact when the
 * points are flat). `flatness` is the largest distance of a point from that plane, so that a caller can say "points are not in one plane".
 * Returns { area, normal, flatness } or null for fewer than 3 points / points on a line.
 */
export function polygonArea(pts) {
  if (pts.length < 3) return null
  const c = scale(pts.reduce((a, p) => add(a, p), [0, 0, 0]), 1 / pts.length)
  const rel = pts.map((p) => sub(p, c)) // around the centre: far from the origin the cross products would lose their digits
  let n = [0, 0, 0]
  for (let i = 0; i < rel.length; i++) n = add(n, cross(rel[i], rel[(i + 1) % rel.length]))
  const l = len(n)
  if (!(l > 0)) return null
  const unit = scale(n, 1 / l)
  let flatness = 0
  for (const p of rel) flatness = Math.max(flatness, Math.abs(dot(p, unit)))
  return { area: l / 2, normal: unit, flatness }
}

/** The point at half the length of a polyline. */
export function pointAtHalf(pts, closed = false) {
  const path = closed && pts.length > 2 ? [...pts, pts[0]] : pts
  const { segs, total } = chainLengths(path)
  let rest = total / 2
  for (let i = 0; i < segs.length; i++) {
    if (rest <= segs[i] || i === segs.length - 1) {
      const k = segs[i] > 0 ? Math.min(1, rest / segs[i]) : 0
      return add(path[i], scale(sub(path[i + 1], path[i]), k))
    }
    rest -= segs[i]
  }
  return path[0] || [0, 0, 0]
}

/**
 * What a measurement says. m = { kind, pts, closed?, extra? }.
 * Returns { ok, quantity ('length' | 'angle'), value, anchor (where the label stands, in file axes), segments ([[a, b], ...] to draw),
 *   delta?, arms?, radius?, center?, normal?, segLengths?, total?, area?, flatness?, error? }.
 */
export function computeMeasure(m) {
  const p = m.pts || []
  const need = POINTS[m.kind] || 2
  if (p.length < need) return { ok: false, quantity: m.kind === 'angle' ? 'angle' : 'length', value: NaN, anchor: p[0] || [0, 0, 0], segments: [], error: 'points' }
  if (m.kind === 'distance' || m.kind === 'edge' || m.kind === 'parts') {
    const d = sub(p[1], p[0])
    return { ok: true, quantity: 'length', value: len(d), delta: d.map(Math.abs), anchor: mid(p[0], p[1]), segments: [[p[0], p[1]]] }
  }
  if (m.kind === 'angle') {
    const [a, b, c] = p
    const ua = sub(a, b)
    const uc = sub(c, b)
    const la = len(ua)
    const lc = len(uc)
    const inner = la > 0 && lc > 0 ? add(scale(ua, 1 / la), scale(uc, 1 / lc)) : [0, 0, 0]
    const il = len(inner)
    const anchor = il > 1e-9 ? add(b, scale(inner, (0.45 * Math.min(la, lc)) / il)) : b // inside the angle, not on an arm
    return { ok: true, quantity: 'angle', value: angleAt(a, b, c), arms: [la, lc], anchor, segments: [[a, b], [b, c]] }
  }
  if (m.kind === 'circle') {
    const circle = circleThrough(p[0], p[1], p[2])
    if (!circle) return { ok: false, quantity: 'length', value: NaN, anchor: p[1], segments: [[p[0], p[1]], [p[1], p[2]]], error: 'collinear' }
    return { ok: true, quantity: 'length', value: circle.diameter, radius: circle.radius, center: circle.center, normal: circle.normal, anchor: circle.center, segments: [] }
  }
  // chain
  const closed = !!m.closed && p.length > 2
  const { segs, total } = chainLengths(p, closed)
  const path = closed ? [...p, p[0]] : p
  const segments = []
  for (let i = 0; i + 1 < path.length; i++) segments.push([path[i], path[i + 1]])
  const out = { ok: true, quantity: 'length', value: total, total, segLengths: segs, anchor: pointAtHalf(p, closed), segments, closed }
  if (closed) {
    const a = polygonArea(p)
    if (a) {
      out.area = a.area
      out.flatness = a.flatness
      out.nonPlanar = a.flatness > 0.01 * Math.max(...segs, 1e-12) // more than 1% of the longest side off the plane
    }
  }
  return out
}

/** Two measurements side by side: { same: false } when they are not of one quantity, else { same: true, a, b, diff (a - b), ratio (a / b, null when b is 0), percent }. */
export function compareValues(ca, cb) {
  if (!ca || !cb || !ca.ok || !cb.ok || ca.quantity !== cb.quantity) return { same: false }
  const diff = ca.value - cb.value
  const ratio = cb.value === 0 ? null : ca.value / cb.value
  return { same: true, a: ca.value, b: cb.value, diff, ratio, percent: ratio === null ? null : ratio * 100, quantity: ca.quantity }
}

// ---------- the list ----------
/** A list of measurements that keeps its numbers (never reused during a session) and tells listeners what changed. */
export function createStore() {
  let items = []
  let seq = 0
  let colorAt = 0
  let selected = null
  const listeners = new Set()
  const fire = () => listeners.forEach((f) => f())
  const find = (id) => items.find((m) => m.id === id) || null
  return {
    on: (f) => (listeners.add(f), () => listeners.delete(f)),
    list: () => items.slice(),
    get: find,
    count: () => items.length,
    selected: () => selected,
    /** { kind, pts, closed?, name?, extra? } -> the new measurement (selected). */
    add(spec) {
      const no = ++seq
      const m = { id: `m${no}`, no, kind: spec.kind, pts: spec.pts.map((p) => p.slice()), name: spec.name || '', color: spec.color || COLORS[colorAt++ % COLORS.length], visible: true, closed: !!spec.closed, extra: spec.extra || null }
      items.push(m)
      selected = m.id
      fire()
      return m
    },
    update(id, patch) {
      const m = find(id)
      if (!m) return null
      Object.assign(m, patch)
      fire()
      return m
    },
    setPoint(id, index, point) {
      const m = find(id)
      if (!m || index < 0 || index >= m.pts.length) return null
      m.pts[index] = point.slice()
      if (m.kind === 'parts') m.extra = null // the smallest distance belonged to the old parts / points
      if (m.kind === 'edge') {
        m.kind = 'distance' // no longer the edge of the model: a plain distance between two points
        m.extra = null
      }
      fire()
      return m
    },
    removePoint(id, index) {
      const m = find(id)
      if (!m || m.kind !== 'chain' || m.pts.length <= 2 || index < 0 || index >= m.pts.length) return null
      m.pts.splice(index, 1)
      if (m.pts.length < 3) m.closed = false
      fire()
      return m
    },
    remove(id) {
      const i = items.findIndex((m) => m.id === id)
      if (i < 0) return false
      items.splice(i, 1)
      if (selected === id) selected = items.length ? items[Math.min(i, items.length - 1)].id : null
      fire()
      return true
    },
    clear() {
      if (!items.length) return
      items = []
      selected = null
      fire()
    },
    select(id) {
      const next = id && find(id) ? id : null
      if (next === selected) return
      selected = next
      fire()
    },
    setAllVisible(on) {
      for (const m of items) m.visible = on
      fire()
    }
  }
}

// ---------- text and CSV ----------
const num = (v, locale, digits = 6) => {
  if (!Number.isFinite(v)) return ''
  const s = String(Number(v.toPrecision(digits)))
  return locale === 'de' ? s.replace('.', ',') : s
}

/**
 * The measurements as CSV (de: ";" between the columns and "," as the decimal mark, which German spreadsheets open directly; en: "," and ".").
 * Columns: No, Kind, Name, Value, Unit, Detail, Points (x y z of each point, in the file's own axes). Values keep 6 significant digits.
 * `kindName(kind)`, `t` for the header: passed in, so that this stays free of the strings.
 */
export function measuresToCsv(list, { locale = 'en', unit = '', kindName = (k) => k, header = ['No', 'Kind', 'Name', 'Value', 'Unit', 'Detail', 'Points'], detailText = () => '' } = {}) {
  const sep = locale === 'de' ? ';' : ','
  const q = (s, guard = true) => {
    let x = String(s)
    if (guard && /^[=+\-@\t\r]/.test(x) && !/^-?[\d.,]+$/.test(x)) x = `'${x}` // a name that starts like a formula is not one in a spreadsheet (numbers and points are not names)
    return x.includes(sep) || x.includes('"') || x.includes('\n') ? `"${x.replace(/"/g, '""')}"` : x
  }
  const rows = [header.map(q).join(sep)]
  for (const m of list) {
    const c = computeMeasure(m)
    const pts = m.pts.map((p) => p.map((v) => num(v, locale)).join(' ')).join(' | ')
    rows.push([m.no, kindName(m.kind), m.name, c.ok ? num(c.value, locale) : '', c.quantity === 'angle' ? '°' : unit, detailText(m, c), pts].map((v, i) => q(v, i === 2 || i === 5)).join(sep))
  }
  return rows.join('\n') + '\n'
}

/** Plain text, one line per measurement: "1  Distance  12.50 mm  (name)". `fmt(value, quantity)` makes the number with its unit. */
export function measuresToText(list, { kindName = (k) => k, fmt = (v) => String(v), detailText = () => '' } = {}) {
  return (
    list
      .map((m) => {
        const c = computeMeasure(m)
        const more = detailText(m, c)
        return `${m.no}  ${kindName(m.kind)}  ${c.ok ? fmt(c.value, c.quantity) : '-'}${m.name ? `  (${m.name})` : ''}${more ? `  ${more}` : ''}`
      })
      .join('\n') + '\n'
  )
}

// ---------- labels ----------
/**
 * Places labels so that they do not cover each other. items: [{ x, y, w, h, optional?, priority? }] with the wanted centre in pixels; the
 * view is w x h. A label that collides first moves in rings around its anchor (up, down, sideways), then to the nearest free place anywhere
 * in the view. Nothing is ever stacked: an `optional` label without room is hidden, a main label without room is hidden and flagged
 * `bundled` (the caller shows one label for all of them). `obstacles` ([{ x, y, w, h }]) are places that are taken already.
 * Returns [{ x, y, hidden, bundled? }] in the order of the items. Labels with a higher priority are placed first.
 */
export function layoutLabels(items, width, height, gap = 3, obstacles = []) {
  const out = new Array(items.length)
  const order = items.map((_, i) => i).sort((a, b) => (items[b].priority || 0) - (items[a].priority || 0) || a - b)
  const failed = [] // sizes that found no place anywhere: nothing gets freed again, so a label at least as big cannot fit either
  // the places taken, in a coarse grid: a test looks only at the few that can be near
  const C = 120
  const grid = new Map()
  let maxW = 0
  let maxH = 0
  const take = (q) => {
    const k = `${Math.floor(q.x / C)},${Math.floor(q.y / C)}`
    if (!grid.has(k)) grid.set(k, [])
    grid.get(k).push(q)
    maxW = Math.max(maxW, q.w)
    maxH = Math.max(maxH, q.h)
  }
  for (const o of obstacles) take({ x: o.x, y: o.y, w: o.w, h: o.h })
  const hits = (x, y, w, h) => {
    const rx = (maxW + w) / 2 + gap
    const ry = (maxH + h) / 2 + gap
    for (let cx = Math.floor((x - rx) / C); cx <= Math.floor((x + rx) / C); cx++) {
      for (let cy = Math.floor((y - ry) / C); cy <= Math.floor((y + ry) / C); cy++) {
        const list = grid.get(`${cx},${cy}`)
        if (list && list.some((q) => Math.abs(q.x - x) < (q.w + w) / 2 + gap && Math.abs(q.y - y) < (q.h + h) / 2 + gap)) return true
      }
    }
    return false
  }
  for (const i of order) {
    const it = items[i]
    const clampX = (x) => Math.max(it.w / 2, Math.min(width - it.w / 2, x))
    const clampY = (y) => Math.max(it.h / 2, Math.min(height - it.h / 2, y))
    let spot = null
    const step = it.h + gap
    const tries = [[0, 0]]
    for (let ring = 1; ring <= 6; ring++) {
      tries.push([0, -ring], [0, ring], [ring * 0.9, -ring * 0.5], [-ring * 0.9, ring * 0.5], [ring * 0.9, ring * 0.5], [-ring * 0.9, -ring * 0.5], [ring * 1.6, 0], [-ring * 1.6, 0])
    }
    for (const [dx, dy] of tries) {
      const x = clampX(it.x + dx * step)
      const y = clampY(it.y + dy * step)
      if (!hits(x, y, it.w, it.h)) {
        spot = { x, y }
        break
      }
    }
    if (!spot && !it.optional && !failed.some((f) => it.w >= f.w && it.h >= f.h)) {
      // a main label: the free place nearest to its anchor anywhere in the view (a coarse scan)
      const sx = (it.w + gap) / 2
      const sy = (it.h + gap) / 2
      let best = Infinity
      const cols = []
      const rows = []
      for (let x = it.w / 2; x <= width - it.w / 2 + 0.01; x += sx) cols.push(x)
      for (let y = it.h / 2; y <= height - it.h / 2 + 0.01; y += sy) rows.push(y)
      // nearest rows and columns first: the scan stops as soon as nothing nearer than the best place found can follow
      rows.sort((p, q) => Math.abs(p - it.y) - Math.abs(q - it.y))
      cols.sort((p, q) => Math.abs(p - it.x) - Math.abs(q - it.x))
      for (const y of rows) {
        if (Math.abs(y - it.y) >= best) break
        for (const x of cols) {
          if (Math.abs(x - it.x) >= best) break
          const d = Math.hypot(x - it.x, y - it.y)
          if (d < best && !hits(x, y, it.w, it.h)) {
            best = d
            spot = { x, y }
          }
        }
      }
    }
    if (!spot && !it.optional) failed.push({ w: it.w, h: it.h })
    if (spot) {
      take({ ...spot, w: it.w, h: it.h })
      out[i] = { ...spot, hidden: false }
    } else out[i] = it.optional ? { x: it.x, y: it.y, hidden: true } : { x: it.x, y: it.y, hidden: true, bundled: true }
  }
  return out
}

/** The marker nearest to a screen position, within `radius` pixels: items [{ id, index, x, y }] -> the item or null. */
export function nearestMarker(items, x, y, radius = 12) {
  let best = null
  for (const it of items) {
    const d = Math.hypot(it.x - x, it.y - y)
    if (d <= radius && (!best || d < best.d)) best = { ...it, d }
  }
  return best
}

// Shared by 3D Model Viewer and STEP Viewer 3D (canonical copy: plugins/_shared; do not edit the copies in editor/shared).
// The measuring tool on the model (Measure+): a list of measurements (measure-store.js) drawn as markers, lines and labels in the view, the
// ways to measure (distance 2 points, angle 3, circle diameter 3 points on the rim, edge length 1 click near an edge, chain of any number of
// points with the sum and the area of a closed one, two parts), and moving the points afterwards. Results are in the file's own axes and unit.
// The markers live in the model's own frame (a child of modelRoot): the "Up is" choice and the turntable carry them along.
import * as THREE from 'three'
import { nearestEdge, nearestSegment, straightRun } from './measure.js'
import { COLORS, POINTS, compareValues, computeMeasure, createStore, layoutLabels, measuresToCsv, measuresToText, nearestMarker } from './measure-store.js'

const sharpCache = new WeakMap()
const SHARP_MAX_TRIANGLES = 1_000_000 // the work is done on the page: above this a click would freeze it for seconds
/** The sharp edges of a mesh (more than 20 degrees between the triangles, and borders), cached per geometry; null when it is too big to work out here. */
function sharpEdges(geometry) {
  const pos = geometry.getAttribute('position')
  const tris = (geometry.index ? geometry.index.count : pos.count) / 3
  if (tris > SHARP_MAX_TRIANGLES) return null
  const key = `${pos.count}:${pos.version}:${tris}`
  const hit = sharpCache.get(geometry)
  if (hit && hit.key === key) return hit.segs
  // EdgesGeometry welds corners at an absolute 1e-4: a small model (a part a few millimeters big, in meters) is worked on enlarged, then scaled back
  geometry.computeBoundingBox()
  const diagSize = geometry.boundingBox.getSize(new THREE.Vector3()).length() || 1
  const k = diagSize < 10 ? 100 / diagSize : 1
  let src = geometry
  if (k !== 1) {
    src = geometry.clone()
    src.getAttribute('position').array.forEach((v, i, a) => (a[i] = v * k))
  }
  const e = new THREE.EdgesGeometry(src, 20)
  const segs = e.getAttribute('position').array.slice()
  if (k !== 1) {
    for (let i = 0; i < segs.length; i++) segs[i] /= k
    src.dispose()
  }
  e.dispose()
  sharpCache.set(geometry, { key, segs })
  return segs
}

const _inst = new THREE.Matrix4()
/**
 * The edge to measure for a click: `{ a, b, triangle }` in world space. The object's real transform is used, including the matrix of the
 * instance that was hit (InstancedMesh); a skinned mesh has no cached model edges (they would be those of the bind pose), its triangle
 * is read in the current pose (`getVertexPosition`, which also applies morph targets), and the text says "triangle edge".
 */
export function edgeOfHit(hit, world, ctx) {
  const obj = hit.object
  const m = obj.matrixWorld.clone()
  if (obj.isInstancedMesh && hit.instanceId !== undefined && hit.instanceId !== null) m.multiply(obj.getMatrixAt(hit.instanceId, _inst) || _inst)
  const inv = m.clone().invert()
  const skinned = !!obj.isSkinnedMesh
  const segs = skinned ? null : (ctx.edgeSegments && ctx.edgeSegments(obj)) || sharpEdges(obj.geometry)
  let near = segs && segs.length ? nearestSegment(segs, world.clone().applyMatrix4(inv).toArray()) : null
  // a model edge that is far from the click (a smooth part with one sharp feature on its other side) is not what was meant: the triangle edge stands in
  if (near && ctx.getDiag && near.distance * m.getMaxScaleOnAxis() > ctx.getDiag() * 0.35) near = null
  if (near) {
    const run = straightRun(segs, near)
    return { a: new THREE.Vector3(...run.a).applyMatrix4(m), b: new THREE.Vector3(...run.b).applyMatrix4(m), triangle: false }
  }
  const v = [hit.face.a, hit.face.b, hit.face.c].map((i) => {
    const p = obj.getVertexPosition ? obj.getVertexPosition(i, new THREE.Vector3()) : new THREE.Vector3().fromBufferAttribute(obj.geometry.getAttribute('position'), i)
    return p.applyMatrix4(skinned ? obj.matrixWorld : m)
  })
  const e = nearestEdge(v[0].toArray(), v[1].toArray(), v[2].toArray(), world.toArray())
  return { a: new THREE.Vector3(...e.a), b: new THREE.Vector3(...e.b), triangle: true }
}

const DRAFT = '#ff9f0a'
const hexToRgba = (hex, a) => {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`
}

/**
 * ctx: { t, locale ('de' | 'en'), modelRoot, camera, canvas, stage (where the labels go), getDiag(), unitShort(), fmtLen(n), showText(lines, isHint), hide(),
 * requestRender(), getMode(), isOn(), partCentre(object) (world), partsDistance(a, b) -> Promise, edgeSegments?(object), onChange() }
 */
export function createMeasure(ctx) {
  const { t } = ctx
  const store = createStore()
  const overlay = new THREE.Group()
  overlay.name = 'measure-overlay'
  ctx.modelRoot.add(overlay)
  let draft = null // { kind, pts (file axes), objects, hits (markers of the unfinished measurement) }
  let armed = null // { id, index }: the next click sets this point again
  let suspended = false
  let hiddenForExport = false
  let drag = null
  const layer = document.createElement('div')
  layer.id = 'measure-labels'
  layer.className = 'measure-labels'
  layer.setAttribute('aria-hidden', 'true')
  ctx.stage.append(layer)
  const pool = new Map() // label key -> element
  let specs = [] // [{ key, id, text, sub, anchor, color, optional, priority, w, h }]
  let laid = [] // the last layout (css pixels), for painting the labels into an exported picture
  let cssSize = { w: 0, h: 0 }

  const toLocal = (world) => ctx.modelRoot.worldToLocal(world.clone()).toArray()
  const lang = () => (ctx.locale === 'de' ? 'de-DE' : 'en-US')
  const num = (v) => ctx.fmtLen(v)
  const angleText = (v) => `${v.toLocaleString(lang(), { minimumFractionDigits: 1, maximumFractionDigits: 1 })}°`
  const u = () => ctx.unitShort()
  /** "12.50 mm" / "90.0°" (a circle: with the diameter sign). */
  function valueText(m, c) {
    if (!c.ok) return t('ms_collinear')
    if (c.quantity === 'angle') return angleText(c.value)
    return `${m.kind === 'circle' ? 'Ø ' : m.kind === 'chain' ? 'Σ ' : ''}${num(c.value)} ${u()}`
  }
  const kindName = (k) => t(`mk_${k}`)
  const areaText = (c) => `${num(c.area)} ${u()}²`
  /** The lines of the chip for one measurement. */
  function summary(m) {
    const c = computeMeasure(m)
    const unit = u()
    if (!c.ok) return [kindName(m.kind), t('ms_collinear')]
    if (m.kind === 'distance') return [`${t('m_distance')}: ${num(c.value)} ${unit}`, `${t('m_delta')}: ${c.delta.map(num).join(' / ')} ${unit}`]
    if (m.kind === 'edge') return [`${m.extra && m.extra.triangle ? t('ms_edge_tri') : t('ms_edge')}: ${num(c.value)} ${unit}`, `${t('m_delta')}: ${c.delta.map(num).join(' / ')} ${unit}`]
    if (m.kind === 'angle') return [`${t('ms_angle')}: ${angleText(c.value)}`, `${t('ms_arms')}: ${c.arms.map(num).join(' / ')} ${unit}`]
    if (m.kind === 'circle') return [`${t('ms_diameter')}: ${num(c.value)} ${unit}`, `${t('ms_radius')}: ${num(c.radius)} ${unit}`]
    if (m.kind === 'chain') {
      const lines = [`${t('mp_chain_sum')}: ${num(c.total)} ${unit} (${m.pts.length} ${t('mp_points')})`, `${t('mp_chain_pieces')}: ${c.segLengths.map(num).join(' + ')} ${unit}`]
      if (c.area !== undefined) lines.push(`${t('mp_area')}: ${areaText(c)}${c.nonPlanar ? ` – ${t('mp_not_flat')}` : ''}`)
      return lines
    }
    const lines = [`${t('ms_parts_centres')}: ${num(c.value)} ${unit}`]
    const min = m.extra && m.extra.min
    if (!min) lines.push(`${t('ms_parts_min')}: ${t('ms_parts_working')}`)
    else if (min.distance === null) lines.push(`${t('ms_parts_min')}: –`)
    else lines.push(`${t('ms_parts_min')}: ${min.distance === 0 ? t('pc_dist_touch') : min.approximate ? t('pc_dist_approx', { v: `${num(min.distance)} ${unit}` }) : `${num(min.distance)} ${unit}`}`)
    return lines
  }
  /** One short sentence about what else a measurement says (CSV / text export, list). */
  function detail(m, c) {
    const unit = u()
    if (!c.ok) return ''
    if (m.kind === 'chain') return `${c.segLengths.map(num).join(' + ')} ${unit}${c.area !== undefined ? `; ${t('mp_area')} ${areaText(c)}` : ''}`
    if (m.kind === 'circle') return `${t('ms_radius')} ${num(c.radius)} ${unit}`
    if (m.kind === 'angle') return `${t('ms_arms')} ${c.arms.map(num).join(' / ')} ${unit}`
    if (m.kind === 'parts') return `${t('ms_parts_min')} ${m.extra && m.extra.min && m.extra.min.distance !== null ? `${num(m.extra.min.distance)} ${unit}` : '-'}`
    return `${t('m_delta')} ${c.delta.map(num).join(' / ')} ${unit}`
  }

  // ---------- drawing ----------
  const mat = (hex) => new THREE.LineBasicMaterial({ color: new THREE.Color(hex), depthTest: false })
  const matMesh = (hex) => new THREE.MeshBasicMaterial({ color: new THREE.Color(hex), depthTest: false })
  const keep = (o) => {
    o.renderOrder = 12
    overlay.add(o)
    return o
  }
  const marker = (p, hex, k = 1) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(Math.max(ctx.getDiag() * 0.006 * k, 1e-9), 14, 10), matMesh(hex))
    m.position.set(...p)
    return keep(m)
  }
  const segs = (list, hex) => {
    if (!list.length) return
    const pos = []
    for (const [a, b] of list) pos.push(...a, ...b)
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    keep(new THREE.LineSegments(g, mat(hex)))
  }
  function ring(c, hex) {
    const n = new THREE.Vector3(...c.normal)
    const ctr = new THREE.Vector3(...c.center)
    const x = new THREE.Vector3().subVectors(new THREE.Vector3(...c.start), ctr).normalize()
    const y = new THREE.Vector3().crossVectors(n, x)
    const pts = []
    for (let i = 0; i < 96; i++) {
      const a = (i / 96) * Math.PI * 2
      pts.push(ctr.clone().addScaledVector(x, Math.cos(a) * c.radius).addScaledVector(y, Math.sin(a) * c.radius))
    }
    keep(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), mat(hex)))
  }
  function clearOverlay() {
    for (const o of [...overlay.children]) {
      if (o === probe) continue // the probe stays: it reports every drawn frame
      overlay.remove(o)
      if (o.geometry) o.geometry.dispose()
      if (o.material) o.material.dispose()
    }
  }

  function labelEl(key) {
    let el = pool.get(key)
    if (!el) {
      el = document.createElement('div')
      el.className = 'mlabel'
      el.append(document.createElement('div'), document.createElement('div'))
      el.dataset.key = key
      layer.append(el)
      pool.set(key, el)
    }
    return el
  }
  function setLabel(spec) {
    const el = labelEl(spec.key)
    const [a, b] = el.children
    if (a.textContent !== spec.text) a.textContent = spec.text
    if (b.textContent !== (spec.sub || '')) b.textContent = spec.sub || ''
    b.hidden = !spec.sub
    el.style.background = hexToRgba(spec.color, spec.small ? 0.82 : 0.9)
    el.classList.toggle('small', !!spec.small)
    el.classList.toggle('sel', !!spec.selected)
    el.dataset.id = spec.id
    spec.el = el
  }

  /** Draws everything again from the list (cheap: a handful of objects). */
  function rebuild() {
    clearOverlay()
    specs = []
    const selected = store.selected()
    for (const m of store.list()) {
      if (!m.visible) continue
      const c = computeMeasure(m)
      const k = m.id === selected ? 1.45 : 1
      for (const p of m.pts) marker(p, m.color, k)
      segs(c.segments, m.color)
      if (m.kind === 'circle' && c.ok) ring({ ...c, start: m.pts[0] }, m.color)
      specs.push({
        key: `${m.id}:main`,
        id: m.id,
        no: m.no,
        text: `${m.no} · ${valueText(m, c)}`,
        sub: [m.name, m.kind === 'chain' && c.area !== undefined ? `${t('mp_area')} ${areaText(c)}` : ''].filter(Boolean).join(' · '),
        anchor: c.anchor,
        color: m.color,
        selected: m.id === selected,
        priority: m.id === selected ? 3 : 2
      })
      if (m.kind === 'chain' && c.ok) {
        c.segLengths.forEach((l, i) => {
          const [a, b] = c.segments[i]
          specs.push({ key: `${m.id}:s${i}`, id: m.id, text: num(l), anchor: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], color: m.color, small: true, optional: true, priority: m.id === selected ? 1 : 0, selected: m.id === selected })
        })
      }
    }
    if (draft && draft.pts.length) {
      for (const p of draft.pts) marker(p, DRAFT)
      const lines = []
      if (draft.kind === 'angle' || draft.kind === 'chain' || draft.kind === 'distance') for (let i = 0; i + 1 < draft.pts.length; i++) lines.push([draft.pts[i], draft.pts[i + 1]])
      segs(lines, DRAFT)
    }
    const want = new Set(specs.map((s) => s.key))
    for (const [key, el] of pool) if (!want.has(key)) (el.remove(), pool.delete(key))
    overlay.visible = !suspended && !hiddenForExport
    layer.hidden = suspended || hiddenForExport // shown before the labels are measured: a hidden layer measures 0
    if (!specs.length) laid = []
    for (const s of specs) setLabel(s)
    for (const s of specs) {
      s.w = s.el.offsetWidth || 60
      s.h = s.el.offsetHeight || 20
    }
  }

  const v3 = new THREE.Vector3()
  const sz = new THREE.Vector2()
  /** After the view is drawn: where each label stands. Skipped for a frame at another size (a picture being exported). */
  function placeLabels(renderer, camera) {
    if (ctx.camera && camera !== ctx.camera) return // another pass (a shadow or reflection camera) is not the view
    if (!specs.length || suspended || hiddenForExport) {
      laid = []
      placeBundle([], 0, 0) // the "no room" label goes with the measurements
      return
    }
    renderer.getSize(sz)
    const cw = ctx.canvas.clientWidth
    const ch = ctx.canvas.clientHeight
    if (!cw || !ch || Math.abs(sz.x - cw) > 1 || Math.abs(sz.y - ch) > 1) return
    cssSize = { w: cw, h: ch }
    const items = []
    const on = []
    for (const s of specs) {
      if (!s.w || !s.h) {
        s.w = s.el.offsetWidth || 60
        s.h = s.el.offsetHeight || 20
      }
      v3.set(...s.anchor).applyMatrix4(ctx.modelRoot.matrixWorld).project(camera)
      const behind = v3.z > 1 || v3.z < -1
      if (behind) {
        s.el.style.visibility = 'hidden'
        continue
      }
      items.push({ x: ((v3.x + 1) / 2) * cw, y: ((1 - v3.y) / 2) * ch, w: s.w, h: s.h, optional: !!s.optional, priority: s.priority })
      on.push(s)
    }
    const out = layoutLabels(items, cw, ch)
    laid = []
    const bundled = []
    on.forEach((s, i) => {
      const o = out[i]
      s.el.style.visibility = o.hidden ? 'hidden' : 'visible'
      if (o.hidden) {
        if (o.bundled) bundled.push(s)
        return
      }
      s.el.style.transform = `translate(${Math.round(o.x - s.w / 2 + ctx.canvas.offsetLeft)}px, ${Math.round(o.y - s.h / 2 + ctx.canvas.offsetTop)}px)`
      laid.push({ x: o.x, y: o.y, w: s.w, h: s.h, text: s.text, sub: s.sub, color: s.color, small: s.small })
    })
    placeBundle(bundled, cw, ch)
  }
  // A main label that finds no free place anywhere is not drawn on top of another one: one label names them all ("More: 2, 4, 5").
  let bundleEl = null
  let bundleSize = null
  function placeBundle(list, cw, ch) {
    if (!list.length) {
      if (bundleEl) bundleEl.style.visibility = 'hidden'
      return
    }
    if (!bundleEl) {
      bundleEl = document.createElement('div')
      bundleEl.className = 'mlabel small bundle'
      bundleEl.id = 'measure-bundle'
      bundleEl.dataset.key = 'bundle'
      bundleEl.append(document.createElement('div'), document.createElement('div'))
      bundleEl.children[1].hidden = true
      layer.append(bundleEl)
    }
    const text = t('ms_bundle', { list: list.slice(0, 6).map((s) => s.no).join(', ') + (list.length > 6 ? ` … +${list.length - 6}` : '') })
    if (bundleEl.firstChild.textContent !== text || !bundleSize) {
      bundleEl.firstChild.textContent = text
      bundleEl.style.background = 'rgba(70,70,80,0.88)'
      bundleEl.style.visibility = 'visible' // measured while shown
      bundleSize = { w: bundleEl.offsetWidth || 90, h: bundleEl.offsetHeight || 20 } // measured when the text changes, not on every frame
    }
    const { w, h } = bundleSize
    const [o] = layoutLabels([{ x: cw / 2, y: ch - h / 2 - 6, w, h, optional: true }], cw, ch, 3, laid)
    // no room even for this one: it sits in the bottom left corner (small, and the only one that may cover something)
    const x = o.hidden ? w / 2 + 6 : o.x
    const y = o.hidden ? ch - h / 2 - 6 : o.y
    bundleEl.style.visibility = 'visible'
    bundleEl.style.transform = `translate(${Math.round(x - w / 2 + ctx.canvas.offsetLeft)}px, ${Math.round(y - h / 2 + ctx.canvas.offsetTop)}px)`
    // (not in `laid`: it is a hint for the person at the screen, not a measurement, so it is not painted into a saved picture)
  }
  // The labels follow every drawn frame (orbit, turntable, resize): a tiny invisible point that three.js "draws" with the scene reports the camera.
  const probe = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3)), new THREE.PointsMaterial({ transparent: true, opacity: 0, depthTest: false, depthWrite: false }))
  probe.frustumCulled = false
  probe.renderOrder = 99
  probe.onBeforeRender = (renderer, scene, camera) => placeLabels(renderer, camera)
  overlay.add(probe)

  // ---------- the draft and the clicks ----------
  const changed = () => {
    rebuild()
    if (ctx.onChange) ctx.onChange()
    ctx.requestRender()
  }
  store.on(() => {
    if (armed && !store.get(armed.id)) armed = null // the measurement that waited for a new point is gone: the next click is a click, not a lost point
    changed()
    if (ctx.isOn() && !draft && !armed) {
      const m = store.get(store.selected())
      if (m) ctx.showText(summary(m), false)
      else hint()
    }
  })
  const hint = (extra) => ctx.showText(extra ? [t('ms_hint_' + ctx.getMode()), extra] : [t('ms_hint_' + ctx.getMode())], true)

  function finish(spec) {
    draft = null
    const m = store.add(spec)
    ctx.showText(summary(m), false)
    return m
  }
  /** Ends the chain that is being clicked (two or more points). closed: also closes it to a polygon (three or more). */
  function finishChain(closed = false) {
    if (!draft || draft.kind !== 'chain' || draft.pts.length < 2) return null
    return finish({ kind: 'chain', pts: draft.pts, closed: closed && draft.pts.length >= 3 })
  }
  function cancelDraft() {
    draft = null
    armed = null
    rebuild()
    if (ctx.isOn()) hint()
    else ctx.hide()
    if (ctx.onChange) ctx.onChange()
    ctx.requestRender()
  }
  function clearAll() {
    suspended = false // a new file or a changed geometry: the parts are in place again
    draft = null
    armed = null
    store.clear()
    rebuild()
    if (ctx.isOn()) hint()
    else ctx.hide()
    ctx.requestRender()
  }

  /** hit: { point (world), object, face } from the raycaster. */
  function add(hit) {
    const mode = ctx.getMode()
    if (suspended) {
      ctx.showText([t('mp_suspended')], true) // the parts are pulled apart: a point set now would be where the part is not
      return
    }
    const world = hit.point.clone()
    const lp = toLocal(world)
    if (armed) {
      const { id, index } = armed
      armed = null
      store.setPoint(id, index, lp)
      const m = store.get(id)
      if (m) ctx.showText(summary(m), false)
      return
    }
    if (draft && draft.kind !== mode) draft = null
    if (!draft) draft = { kind: mode, pts: [], objects: [] }
    if (mode === 'edge') {
      if (!hit.face || !hit.object || !hit.object.geometry) return
      // a model edge: where the surface bends (or where the CAD faces meet), not a diagonal of the triangulation; a straight run of several
      // mesh segments counts as one edge. Only when no model edge can be had does the nearest triangle edge stand in, and the text says so.
      const { a, b, triangle } = edgeOfHit(hit, world, ctx)
      finish({ kind: 'edge', pts: [toLocal(a), toLocal(b)], extra: { triangle } })
      ctx.requestRender()
      return
    }
    if (mode === 'parts') {
      if (draft.objects.length === 1 && draft.objects[0] === hit.object) {
        ctx.showText([t('ms_parts_same'), `1 / 2`], true)
        return
      }
      draft.pts.push(lp)
      draft.objects.push(hit.object)
      if (draft.objects.length < 2) {
        rebuild()
        ctx.showText([t('ms_hint_parts'), `1 / 2`], true)
        ctx.requestRender()
        return
      }
      const [oa, ob] = draft.objects
      const m = finish({ kind: 'parts', pts: [toLocal(ctx.partCentre(oa)), toLocal(ctx.partCentre(ob))], extra: { min: null } })
      ctx.partsDistance(oa, ob).then(
        (r) => {
          if (!r || r.distance === null || !store.get(m.id)) return // the measurement was deleted meanwhile
          store.update(m.id, { extra: { min: r } })
          if (ctx.isOn() && store.selected() === m.id) ctx.showText(summary(store.get(m.id)), false)
        },
        () => {}
      )
      return
    }
    draft.pts.push(lp)
    const need = POINTS[mode]
    if (mode === 'chain') {
      rebuild()
      const c = computeMeasure({ kind: 'chain', pts: draft.pts })
      ctx.showText([draft.pts.length < 2 ? t('ms_hint_chain') : `${t('mp_chain_sum')}: ${num(c.total)} ${u()} (${draft.pts.length} ${t('mp_points')})`, draft.pts.length < 2 ? `1 ${t('mp_points')}` : t('mp_chain_more')], draft.pts.length < 2)
      ctx.requestRender()
      if (ctx.onChange) ctx.onChange()
      return
    }
    if (draft.pts.length >= need) {
      finish({ kind: mode, pts: draft.pts })
      return
    }
    rebuild()
    hint(`${draft.pts.length} / ${need}`)
    ctx.requestRender()
    if (ctx.onChange) ctx.onChange()
  }

  // ---------- changing points afterwards ----------
  /** The markers of visible measurements on the screen: [{ id, index, x, y }] in css pixels of the canvas (parts have no movable points). */
  function screenMarkers(camera) {
    const out = []
    const cw = ctx.canvas.clientWidth
    const ch = ctx.canvas.clientHeight
    for (const m of store.list()) {
      if (!m.visible || m.kind === 'parts') continue
      m.pts.forEach((p, index) => {
        v3.set(...p).applyMatrix4(ctx.modelRoot.matrixWorld).project(camera)
        if (v3.z > 1 || v3.z < -1) return
        out.push({ id: m.id, index, x: ((v3.x + 1) / 2) * cw, y: ((1 - v3.y) / 2) * ch, selected: m.id === store.selected() })
      })
    }
    return out
  }
  /** The marker under a canvas position (the selected measurement's markers win a tie), or null. */
  function pickMarker(camera, x, y, radius = 12) {
    if (suspended) return null
    const all = screenMarkers(camera)
    const sel = nearestMarker(all.filter((s) => s.selected), x, y, radius)
    return sel || nearestMarker(all, x, y, radius)
  }
  function dragStart(id, index) {
    if (!store.get(id)) return false
    drag = { id, index }
    store.select(id)
    return true
  }
  function dragMove(worldPoint) {
    if (!drag) return
    store.setPoint(drag.id, drag.index, toLocal(worldPoint))
  }
  function dragEnd() {
    const d = drag
    drag = null
    if (d && ctx.isOn()) {
      const m = store.get(d.id)
      if (m) ctx.showText(summary(m), false)
    }
  }
  function armReplace(id, index) {
    const m = store.get(id)
    if (!m || m.kind === 'parts') return false
    if (draft && draft.kind === 'chain' && draft.pts.length >= 2) {
      finishChain(false) // a chain under way is kept, not thrown away
      store.select(id) // (adding it selected the chain: the one that is changed stays the selected one)
    }
    armed = { id, index }
    draft = null
    rebuild()
    ctx.showText([t('mp_replace_hint', { n: m.no, p: index + 1 })], true)
    if (ctx.onChange) ctx.onChange()
    return true
  }
  const disarm = () => {
    if (!armed) return
    armed = null
    if (ctx.isOn()) hint()
    if (ctx.onChange) ctx.onChange()
  }

  // ---------- views of the list ----------
  const exportOpts = () => ({ locale: ctx.locale, unit: u(), kindName, detailText: detail })
  const csv = () => measuresToCsv(store.list(), { ...exportOpts(), header: [t('mp_col_no'), t('mp_col_kind'), t('mp_col_name'), t('mp_col_value'), t('mp_col_unit'), t('mp_col_detail'), t('mp_col_points')] })
  const text = () => `${t('mp_title')}\n` + measuresToText(store.list(), { kindName, detailText: detail, fmt: (v, q) => (q === 'angle' ? angleText(v) : `${num(v)} ${u()}`) })
  const compare = (idA, idB) => {
    const a = store.get(idA)
    const b = store.get(idB)
    if (!a || !b) return { same: false }
    return { ...compareValues(computeMeasure(a), computeMeasure(b)), a: computeMeasure(a), b: computeMeasure(b), ma: a, mb: b }
  }

  /** The labels into an exported picture: ctx2d of an image w x h px that shows the view as the canvas did. */
  function paintOnto(c2, w, h) {
    if (!laid.length || !cssSize.w || suspended || hiddenForExport) return 0
    const k = w / cssSize.w
    c2.save()
    c2.textBaseline = 'middle'
    c2.textAlign = 'center'
    for (const l of laid) {
      const bw = l.w * k
      const bh = l.h * k
      const x = l.x * k - bw / 2
      const y = l.y * k - bh / 2
      c2.fillStyle = hexToRgba(l.color, l.small ? 0.82 : 0.92)
      c2.strokeStyle = 'rgba(255,255,255,0.65)'
      c2.lineWidth = Math.max(1, k)
      c2.beginPath()
      if (c2.roundRect) c2.roundRect(x, y, bw, bh, 5 * k)
      else c2.rect(x, y, bw, bh)
      c2.fill()
      c2.stroke()
      c2.fillStyle = '#fff'
      c2.font = `${l.small ? 600 : 700} ${(l.small ? 10.5 : 12) * k}px system-ui, -apple-system, sans-serif`
      c2.fillText(l.text, l.x * k, l.sub ? y + bh * 0.36 : l.y * k)
      if (l.sub) {
        c2.font = `500 ${10.5 * k}px system-ui, -apple-system, sans-serif`
        c2.fillText(l.sub, l.x * k, y + bh * 0.74)
      }
    }
    c2.restore()
    return laid.length
  }

  return {
    store,
    add,
    /** The unfinished measurement is dropped (not the finished ones). */
    clear: cancelDraft,
    cancelDraft,
    clearAll,
    finishChain,
    draft: () => (draft ? { kind: draft.kind, count: draft.pts.length } : null),
    count: () => store.count() + (draft ? draft.pts.length : 0),
    summary,
    detail,
    compute: computeMeasure,
    fmt: num,
    fmtQuantity: (v, q) => (q === 'angle' ? angleText(v) : `${num(v)} ${u()}`),
    valueText,
    kindName,
    compare,
    csv,
    text,
    pickMarker,
    dragStart,
    dragMove,
    dragEnd,
    dragging: () => !!drag,
    armReplace,
    disarm,
    armed: () => armed,
    setSuspended(on) {
      if (suspended === on) return
      suspended = on
      rebuild()
      if (ctx.onChange) ctx.onChange()
      ctx.requestRender()
    },
    suspended: () => suspended,
    /** A picture without the helpers (transparent PNG): nothing of the measurements is in it. */
    setHidden(on) {
      hiddenForExport = on
      overlay.visible = !suspended && !on
      layer.hidden = suspended || on
    },
    paintOnto,
    refresh: rebuild,
    labelCount: () => laid.length
  }
}

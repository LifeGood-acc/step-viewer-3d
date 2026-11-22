// Shared by 3D Model Viewer and STEP Viewer 3D (canonical copy: plugins/_shared; do not edit the copies in editor/shared).
// The part card: the numbers of what is selected (one part or several), in the Parts section, and a chip in the view that answers "how big is
// this?" even when the side panel is closed. Cheap numbers come at once; the surface, the volume and the check are only worked out when
// "More about the part" is open (in a worker, remembered for each part until the working copy changes); the smallest distance of two parts on a button.
import * as THREE from 'three'
import { basicInfo, boxCenter, decompose, isAxisAligned, isIdentity, sumChecks, transformBox, transformedVertexBox, vecDistance } from './part-info.js'
import { copyText, detailsText } from './details.js'
import * as S from './tools-scene.js'

export const MANY_PARTS = 50 // above this the detailed numbers wait for a click
export const EXACT_BOX_VERTICES = 500_000 // a turned part is measured by its vertices up to here, by its corner box above
export const BIG_PART_TRIS = 500_000 // a part with more triangles than this is not checked by itself

/**
 * ctx: { t, locale, A (the tools adapter: getParts, getModel, modelRoot, getUnit), host (the element the card goes after), chipHost (the view),
 *        fmtLen(n), fmtVol(v, unit), fmtArea(v, unit),
 *        getSelection() -> { indices: [index in A.getParts()], label: name of the node when a whole assembly node is selected, or null },
 *        clear(), fit(), isolate(), openPanel(), measureParts(), flash(text), isCut?(part) -> the section cuts through it,
 *        describe?(index) -> { name, colour, material, texture },
 *        meshNote?: true (the sizes come from a triangle mesh of a CAD file), prefs?: { get(key), set(key, value) } }
 */
export function initPartCard(ctx) {
  const { t, A } = ctx
  const el = (tag, props = {}, ...kids) => {
    const e = Object.assign(document.createElement(tag), props)
    e.append(...kids)
    return e
  }
  const card = el('div', { className: 'part-card', id: 'part-card', hidden: true })
  const head = el('div', { className: 'pc-head' })
  const body = el('div', { className: 'pc-body' })
  const actions = el('div', { className: 'btnrow pc-actions' })
  card.append(head, body, actions)
  ctx.host.after(card)
  const chip = el('div', { className: 'chip sel-chip', id: 'sel-chip', hidden: true })
  ctx.chipHost.append(chip)
  let moreOpen = ctx.prefs ? !!ctx.prefs.get('pcMore') : false
  const cache = new Map() // mesh object -> { sig, res }  (the check of one part)
  const distCache = new Map() // "uuidA|uuidB" -> { distance, approximate }
  let runId = 0
  let cancelDistance = null
  let lastRows = []
  let lastTitle = ''

  const unit = () => A.getUnit().short
  const num = (v, d = 0) => v.toLocaleString(ctx.locale || undefined, { maximumFractionDigits: d })
  const dims = (d) => `${d.map((v) => ctx.fmtLen(v)).join(' × ')} ${unit()}`
  const pt = (c) => `${c.map((v) => ctx.fmtLen(v)).join(' / ')} ${unit()}`
  const share = (s) => `${num(s * 100, s < 0.1 ? 1 : 0)} %`

  // the world matrices are brought up to date once per update, not once per part (with thousands of parts that is the difference)
  let invRoot = null
  function prepare() {
    A.getModel().updateWorldMatrix(true, true)
    invRoot = new THREE.Matrix4().copy(A.modelRoot.matrixWorld).invert()
  }
  function modelMatrix(p) {
    if (!invRoot) prepare()
    return new THREE.Matrix4().multiplyMatrices(invRoot, p.obj.matrixWorld).elements.slice()
  }
  function partBox(p, m) {
    const g = p.obj.geometry
    if (!g.boundingBox) g.computeBoundingBox()
    const b = g.boundingBox
    // a turned part: the box of the vertices is exact (the box of the eight corners would be too big), up to a budget of vertices
    const pos = g.getAttribute('position')
    if (!isAxisAligned(m) && pos && pos.count <= EXACT_BOX_VERTICES && pos.array && !pos.isInterleavedBufferAttribute) return transformedVertexBox(pos.array.subarray(0, pos.count * pos.itemSize), m)
    return transformBox({ min: [b.min.x, b.min.y, b.min.z], max: [b.max.x, b.max.y, b.max.z] }, m)
  }
  const sigOf = (p) => {
    const pos = p.obj.geometry.getAttribute('position')
    return `${p.obj.geometry.uuid}:${pos.count}:${pos.version}:${p.obj.geometry.index ? p.obj.geometry.index.count : 0}`
  }
  const isMesh = (p) => (p.kind || 'mesh') === 'mesh'
  const describe = (i) => {
    const p = A.getParts()[i]
    const d = ctx.describe ? ctx.describe(i) : {}
    return { name: d.name || p.label || p.name || t('pc_part_n', { n: i + 1 }), colour: d.colour || null, material: d.material || null, texture: d.texture || null }
  }

  function row(label, value, tip) {
    const dt = el('dt', { textContent: label })
    const dd = el('dd', { textContent: value })
    if (tip) dd.title = tip
    lastRows.push([label, value])
    return [dt, dd]
  }

  function typeLabel(parts) {
    const kinds = [...new Set(parts.map((p) => p.kind || 'mesh'))]
    if (kinds.length > 1) return t('pc_type_mixed')
    return t(kinds[0] === 'points' ? 'pc_type_points' : kinds[0] === 'lines' ? 'pc_type_lines' : 'pc_type_mesh')
  }

  /** The parts to work on and the cheap numbers. */
  function gather() {
    prepare()
    const sel = ctx.getSelection()
    const all = A.getParts()
    const idx = sel.indices.filter((i) => all[i])
    const parts = idx.map((i) => all[i])
    const infos = parts.map((p) => ({ tris: p.tris || 0, verts: p.verts || 0, kind: p.kind || 'mesh', box: partBox(p, modelMatrix(p)) }))
    const total = all.reduce((a, p) => a + (p.tris || 0), 0)
    return { sel, idx, parts, info: basicInfo(infos, total), infos, total }
  }

  function render() {
    if (!A.getModel() || !ctx.getSelection().indices.length) {
      // no model or nothing selected: no card, no chip
      card.hidden = true
      chip.hidden = true
      if (cancelDistance) cancelDistance()
      return
    }
    const g = gather()
    if (!g.parts.length) {
      card.hidden = true
      chip.hidden = true
      cancelDistance && cancelDistance()
      return
    }
    lastRows = []
    const one = g.parts.length === 1
    const first = describe(g.idx[0])
    const title = g.sel.label && !one ? g.sel.label : one ? first.name : t('pc_title_n', { n: g.parts.length })
    lastTitle = title
    card.hidden = false
    // head
    const name = el('strong', { className: 'pc-name', textContent: title })
    name.title = t('pc_working')
    const x = el('button', { type: 'button', className: 'pc-x', textContent: '✕' })
    x.setAttribute('aria-label', t('pc_clear'))
    x.title = t('pc_clear')
    x.onclick = () => ctx.clear()
    head.replaceChildren(name, x)
    // simple rows
    const dl = el('dl', { className: 'pc-dl' })
    if (one) dl.append(...row(t('pc_type'), typeLabel(g.parts)))
    dl.append(...row(t('pc_dims'), dims(g.info.dims), t('pc_dims_tip')))
    dl.append(...row(t('pc_tris'), num(g.info.tris)))
    dl.append(...row(t('pc_share'), share(g.info.share)))
    body.replaceChildren(dl)
    if (ctx.meshNote) body.append(el('p', { className: 'hint', textContent: t('pc_mesh_note') }))
    // more
    const more = el('details', { className: 'pc-more' })
    more.open = moreOpen
    more.append(el('summary', { textContent: t('pc_more') }))
    const mdl = el('dl', { className: 'pc-dl' })
    more.append(mdl)
    more.addEventListener('toggle', () => {
      moreOpen = more.open
      if (ctx.prefs) ctx.prefs.set('pcMore', moreOpen)
      if (moreOpen) fillMore(g, mdl)
    })
    body.append(more)
    if (moreOpen) fillMore(g, mdl)
    // two parts: the distance between them
    if (g.parts.length === 2) {
      const ddl = el('dl', { className: 'pc-dl' })
      const [pa, pb] = g.parts
      ddl.append(...row(t('pc_dist_centres'), `${ctx.fmtLen(vecDistance(boxCenter(g.infos[0].box), boxCenter(g.infos[1].box)))} ${unit()}`))
      body.append(ddl)
      if (isMesh(pa) && isMesh(pb)) body.append(distanceRow(pa, pb))
    } else if (g.parts.length > 2) body.append(el('p', { className: 'hint', textContent: t('pc_dist_none') }))
    if (g.parts.length > 1) body.append(el('p', { className: 'hint', textContent: t('pc_overlap') }))
    // actions
    const btn = (label, fn, props = {}) => Object.assign(el('button', { type: 'button', textContent: label }), { onclick: fn }, props)
    actions.replaceChildren(
      btn(t('pc_fit'), () => ctx.fit()),
      btn(t('pc_only'), () => ctx.isolate()),
      btn(t('pc_copy'), () => ctx.flash && ctx.flash(copyText(detailsText(lastTitle, lastRows)) ? t('pc_copied') : t('pc_copy_failed')))
    )
    if (g.parts.length === 2 && ctx.measureParts) actions.append(btn(t('pc_measure'), () => ctx.measureParts()))
    // the chip in the view
    const cb = el('button', { type: 'button', textContent: t('pc_chip_card'), title: t('pc_chip_tip') })
    cb.onclick = () => {
      ctx.openPanel()
      card.scrollIntoView({ block: 'nearest' })
    }
    const cx = el('button', { type: 'button', textContent: '✕' })
    cx.setAttribute('aria-label', t('pc_clear'))
    cx.onclick = () => ctx.clear()
    chip.replaceChildren(el('span', { textContent: `${title} · ${dims(g.info.dims)}` }), cb, cx)
    chip.hidden = false
  }

  // ----- the detailed numbers (worker), only when "More" is open -----
  function fillMore(g, mdl) {
    const one = g.parts.length === 1
    const rows = []
    const add = (label, value, tip) => {
      const [dt, dd] = row(label, value, tip)
      rows.push([dt, dd])
      mdl.append(dt, dd)
      return dd
    }
    mdl.replaceChildren()
    add(t('pc_centre'), pt(g.info.center))
    const meshes = g.parts.filter(isMesh)
    // work out what is missing
    const missing = meshes.filter((p) => !(cache.get(p.obj) && cache.get(p.obj).sig === sigOf(p)))
    const needsClick = g.parts.length > MANY_PARTS || meshes.some((p) => (p.tris || 0) > BIG_PART_TRIS)
    const vertsRow = add(t('pc_vertices'), missing.length ? t('pc_computing') : '')
    const areaRow = add(t('pc_area'), missing.length ? t('pc_computing') : '')
    const volRow = add(t('pc_volume'), missing.length ? t('pc_computing') : '')
    const wtRow = add(t('pc_watertight'), missing.length ? t('pc_computing') : '')
    const fillChecks = () => {
      const rs = meshes.map((p) => cache.get(p.obj).res)
      const instanced = meshes.some((p) => p.obj.isInstancedMesh)
      if (!rs.length) {
        for (const r of [vertsRow, areaRow, volRow, wtRow]) r.textContent = '—'
      } else {
        const sum = sumChecks(rs)
        vertsRow.textContent = num(sum.vertices)
        areaRow.textContent = ctx.fmtArea(sum.area, unit())
        volRow.textContent = instanced ? t('pc_volume_instanced') : sum.volume == null ? t('pc_volume_open') : ctx.fmtVol(sum.volume, unit())
        wtRow.textContent = one ? (sum.watertight ? t('pc_yes') : t('pc_no', { b: num(sum.boundaryEdges), n: num(sum.nonManifoldEdges) })) : t(sum.watertight ? 'pc_all' : 'pc_not_all')
      }
      lastRowsSync()
    }
    // the rows were pushed into lastRows with the placeholder text: bring the numbers in when they are known
    const lastRowsSync = () => {
      for (const [label, value] of [[t('pc_vertices'), vertsRow.textContent], [t('pc_area'), areaRow.textContent], [t('pc_volume'), volRow.textContent], [t('pc_watertight'), wtRow.textContent]]) {
        const r = lastRows.find((x) => x[0] === label)
        if (r) r[1] = value
      }
    }
    if (one) {
      const p = g.parts[0]
      const d = describe(g.idx[0])
      if (d.material) add(t('pc_material'), d.material)
      if (d.colour) add(t('pc_colour'), d.colour)
      if (d.texture) add(t('pc_texture'), d.texture)
      prepare()
      const m = modelMatrix(p)
      if (!isIdentity(m)) {
        const dc = decompose(m)
        const r = (v) => num(v, 2)
        add(t('pc_position'), pt(dc.position))
        if (dc.shear) add(t('pc_rotation'), t('pc_shear'))
        else {
          add(t('pc_rotation'), `${dc.rotation.map(r).join(' / ')} °`)
          add(t('pc_scale'), `${dc.scale.map(r).join(' / ')}${dc.mirrored ? ` (${t('pc_mirrored')})` : ''}`)
        }
      }
      const same = A.getParts().filter((q) => q.obj.geometry === p.obj.geometry)
      add(t('pc_instance'), p.obj.isInstancedMesh ? t('pc_instance_mesh', { n: p.obj.count }) : same.length > 1 ? t('pc_instance_n', { i: same.indexOf(p) + 1, n: same.length }) : t('pc_single'))
      add(t('pc_visible'), t(p.visible ? (ctx.isCut && ctx.isCut(p) ? 'pc_visible_cut' : 'pc_visible_yes') : 'pc_visible_no'))
    }
    if (!missing.length) return fillChecks()
    if (needsClick) {
      vertsRow.textContent = areaRow.textContent = volRow.textContent = wtRow.textContent = '—'
      const go = el('button', { type: 'button', textContent: t('pc_calc'), title: t('pc_calc_tip') })
      go.onclick = () => {
        go.remove()
        run(missing, fillChecks, [vertsRow, areaRow, volRow, wtRow])
      }
      mdl.after(go)
      if (g.parts.length > MANY_PARTS) mdl.after(el('p', { className: 'hint', textContent: t('pc_many') }))
      return
    }
    run(missing, fillChecks, [vertsRow, areaRow, volRow, wtRow])
  }

  async function run(missing, done, cells) {
    const my = ++runId
    for (const c of cells) c.textContent = t('pc_computing')
    try {
      const { results } = await S.analyze(A, { parts: missing })
      if (my !== runId) return // another selection came meanwhile
      missing.forEach((p, i) => cache.set(p.obj, { sig: sigOf(p), res: results[i] }))
      done()
    } catch (e) {
      if (my !== runId || (e && e.message === 'cancelled')) return
      for (const c of cells) c.textContent = '—'
      if (ctx.flash) ctx.flash(t('pc_error'))
    }
  }

  // ----- the smallest distance of two parts -----
  function distanceRow(pa, pb) {
    if (cancelDistance) cancelDistance() // another pair: the old run is of no use
    cancelDistance = null
    const key = `${pa.obj.uuid}|${pb.obj.uuid}`
    const wrap = el('div', { className: 'row wrap pc-dist' })
    const label = el('span', { className: 'grow', textContent: t('pc_dist_min'), title: t('pc_dist_min_tip') })
    const val = el('span', { className: 'pc-dist-val' })
    wrap.append(label, val)
    const show = (r) => {
      val.replaceChildren()
      const text = r.distance === 0 ? t('pc_dist_touch') : r.approximate ? t('pc_dist_approx', { v: `${ctx.fmtLen(r.distance)} ${unit()}` }) : `${ctx.fmtLen(r.distance)} ${unit()}`
      val.textContent = text
      lastRows.push([t('pc_dist_min'), text])
    }
    if (distCache.has(key)) show(distCache.get(key))
    else {
      const go = el('button', { type: 'button', textContent: t('pc_dist_calc') })
      go.onclick = async () => {
        const stop = el('button', { type: 'button', textContent: t('pc_dist_cancel') })
        val.replaceChildren(el('span', { textContent: t('pc_computing') }), stop)
        let cancelled = false
        stop.onclick = () => {
          cancelled = true
          if (cancelDistance) cancelDistance()
        }
        try {
          const r = await S.partDistance(A, pa, pb, { setCancel: (fn) => (cancelDistance = fn) })
          cancelDistance = null
          if (r.distance === null) throw new Error('empty')
          distCache.set(key, r)
          if (!cancelled && val.isConnected) show(r)
        } catch {
          cancelDistance = null
          val.replaceChildren(go)
        }
      }
      val.append(go)
    }
    return wrap
  }

  return {
    el: card,
    chip,
    /** Call after the selection changed. */
    update: render,
    /** The working copy changed (a tool ran, another file came): what was worked out is stale. */
    invalidate() {
      cache.clear()
      distCache.clear()
      runId++
      if (cancelDistance) cancelDistance()
      cancelDistance = null
      render()
    },
    /** The check results kept for a part (tests and tooling). */
    cached: (obj) => cache.get(obj) || null
  }
}

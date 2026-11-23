// Shared by 3D Model Viewer and STEP Viewer 3D (canonical copy: plugins/_shared; do not edit the copies in editor/shared).
// The part cards (UX v3): the numbers of what is selected (one part or several) as cards - Part information, Dimensions, Volume and (STEP only, on request)
// Estimate the weight - and a chip in the view that answers "how big is this?" even when the side panel is closed. The cards stand under the part list
// (one column with tabs) or in the right column (three columns, from 1200 px). Every number is built through cards.js and so carries its origin (data-src).
// The surface, the volume and the check are worked out in a worker as soon as a part is selected (on request for many parts or very large ones), and are
// remembered for each part until the working copy changes; "More about the part" holds the rest; the smallest distance of two parts is on a button.
import * as THREE from 'three'
import { basicInfo, boxCenter, decompose, isAxisAligned, isIdentity, sumChecks, transformBox, transformedVertexBox, vecDistance } from './part-info.js'
import { copyText, detailsText } from './details.js'
import * as S from './tools-scene.js'
import { card as makeCard, kvList, dimsRow, helpButton, bigNumber, hint, src, estimateBlock } from './cards.js'
import { icon } from './icons.js'
import { DENSITIES, densityOf, scaleWeight, volumeCm3, weightGrams, whyNoEstimate } from './weight-core.js'

export const MANY_PARTS = 50 // above this the detailed numbers wait for a click
export const EXACT_BOX_VERTICES = 500_000 // a turned part is measured by its vertices up to here, by its corner box above
export const BIG_PART_TRIS = 500_000 // a part with more triangles than this is not checked by itself

/**
 * ctx: { t, locale, A (the tools adapter: getParts, getModel, modelRoot, getUnit), host (the element the card goes after), chipHost (the view),
 *        fmtLen(n), fmtVol(v, unit), fmtArea(v, unit),
 *        getSelection() -> { indices: [index in A.getParts()], label: name of the node when a whole assembly node is selected, or null },
 *        clear(), fit(), isolate(), openPanel(), measureParts(), flash(text), isCut?(part) -> the section cuts through it,
 *        describe?(index) -> { name, colour, colourSrc ('file' by default; 'derived' where the viewer shows its own colour), material, texture },
 *        meshNote?: true (the sizes come from a triangle mesh of a CAD file), prefs?: { get(key), set(key, value) },
 *        upAxis?() -> 'x' | 'y' | 'z' (the axis of the file that is up: marked in the dimensions),
 *        meshQuality?() -> 'coarse' | 'normal' | 'fine' | null (named in the notes),
 *        unitSrc?() -> 'file' | 'assumed' (where the unit comes from; 'assumed' says so under the numbers),
 *        weight?: { mode() -> the STEP viewer's unit mode ('file', 'converted', 'default', 'tool') } (present only in the STEP viewer: the card "Estimate the weight") }
 */
export function initPartCard(ctx) {
  const { t, A } = ctx
  const el = (tag, props = {}, ...kids) => {
    const e = Object.assign(document.createElement(tag), props)
    e.append(...kids)
    return e
  }
  // the container of the cards: one column under the part list, or the right column in three columns (layout-mode, shell.js)
  const root = el('div', { className: 'part-cards', id: 'part-card', hidden: true })
  const place = (mode) => {
    const info = document.getElementById('tp-info')
    if (mode === 'three' && info && info.parentNode) info.before(root)
    else ctx.host.after(root)
  }
  place(document.body.dataset.layout)
  document.addEventListener('layout-mode', (e) => place(e.detail))
  const chip = el('div', { className: 'chip sel-chip', id: 'sel-chip', hidden: true })
  chip.dataset.honest = '1' // the chip in the view is part of the honesty check too
  ctx.chipHost.append(chip)
  let moreOpen = ctx.prefs ? !!ctx.prefs.get('pcMore') : false
  const cache = new Map() // mesh object -> { sig, res }  (the check of one part)
  const distCache = new Map() // "uuidA|uuidB" -> { distance, approximate }
  const busy = new Set() // mesh objects whose check is running
  const failed = new Set() // mesh objects whose check failed (shown as such until the selection or the copy changes)
  let runId = 0
  let cancelDistance = null
  let lastRows = []
  let lastTitle = ''
  let density = '' // the density chosen for the estimate ('' = no assumption); it belongs to one selection and is forgotten when the selection changes
  let selSig = ''
  let cur = null // what the cards on screen hold: { g, volBody, weightBody, moreFill }

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
    return { name: d.name || p.label || p.name || t('pc_part_n', { n: i + 1 }), colour: d.colour || null, colourSrc: d.colourSrc || 'file', material: d.material || null, texture: d.texture || null }
  }
  // a name the viewer made up ("Part 3") is an interface label, not a quantity from the file
  const nameSrc = (name) => (/^(Part|Teil|Bauteil)\s+\d+$/i.test(name) ? 'ui' : 'file')

  /** A row of a card: it is also kept for "Copy the numbers". */
  const rowOf = (label, value, kind, tip, copyAs) => {
    lastRows.push([copyAs || label, value])
    return { label, value, src: kind, tip }
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

  // ----- what is known about the mesh check of the selection -----
  // none: nothing to check (points, lines); wait: it will start by itself; busy: running; click: many or large parts wait for a click; done: the sums are in `sum`
  function checkState(g) {
    const meshes = g.parts.filter(isMesh)
    if (!meshes.length) return { kind: 'none', meshes }
    const missing = meshes.filter((p) => !(cache.get(p.obj) && cache.get(p.obj).sig === sigOf(p)))
    const instanced = meshes.some((p) => p.obj.isInstancedMesh)
    if (!missing.length) return { kind: 'done', meshes, instanced, sum: sumChecks(meshes.map((p) => cache.get(p.obj).res)) }
    if (missing.some((p) => failed.has(p.obj))) return { kind: 'error', meshes, missing }
    if (missing.every((p) => busy.has(p.obj))) return { kind: 'busy', meshes, missing }
    const needsClick = g.parts.length > MANY_PARTS || meshes.some((p) => (p.tris || 0) > BIG_PART_TRIS)
    return { kind: needsClick ? 'click' : 'wait', meshes, missing }
  }

  function render() {
    if (!A.getModel() || !ctx.getSelection().indices.length) {
      // no model or nothing selected: no cards, no chip
      root.hidden = true
      chip.hidden = true
      cur = null
      density = '' // an estimate belongs to a selection: nothing selected, no density
      selSig = ''
      if (cancelDistance) cancelDistance()
      return
    }
    const g = gather()
    if (!g.parts.length) {
      root.hidden = true
      chip.hidden = true
      cur = null
      density = ''
      selSig = ''
      cancelDistance && cancelDistance()
      return
    }
    lastRows = []
    const one = g.parts.length === 1
    const first = describe(g.idx[0])
    const title = g.sel.label && !one ? g.sel.label : one ? first.name : t('pc_title_n', { n: g.parts.length })
    lastTitle = title
    const sig = g.idx.join(',')
    if (sig !== selSig) {
      selSig = sig
      density = '' // an estimate belongs to the selection it was asked for
    }
    root.hidden = false
    const btn = (label, fn, props = {}) => Object.assign(el('button', { type: 'button', textContent: label }), { onclick: fn }, props)

    // ---- Part information ----
    const x = el('button', { type: 'button', className: 'pc-x card-act', textContent: '✕' })
    x.setAttribute('aria-label', t('pc_clear'))
    x.title = t('pc_clear')
    x.onclick = () => ctx.clear()
    const infoRows = [rowOf(t('pc_name'), title, one ? nameSrc(title) : g.sel.label ? 'file' : 'derived', t('pc_working'), t('pc_name'))]
    if (one) infoRows.push(rowOf(t('pc_type'), typeLabel(g.parts), 'derived'))
    infoRows.push(rowOf(t('pc_tris'), num(g.info.tris), 'derived'), rowOf(t('pc_share'), share(g.info.share), 'derived'))
    if (one) {
      if (first.material) infoRows.push(rowOf(t('pc_material'), first.material, 'file'))
      if (first.colour) infoRows.push(rowOf(t('pc_colour'), first.colour, first.colourSrc)) // colourSrc: where the viewer got it (the file's material, or the colour it shows)
      if (first.texture) infoRows.push(rowOf(t('pc_texture'), first.texture, 'file'))
    }
    const infoDl = kvList(infoRows, { id: 'pc-info-kv' })
    infoDl.children[1].classList.add('pc-name') // the value of "Name"
    // more about the part
    const more = el('details', { className: 'pc-more' })
    more.open = moreOpen
    more.append(el('summary', { textContent: t('pc_more') }))
    const moreHost = el('div', { className: 'pc-more-body' })
    more.append(moreHost)
    more.addEventListener('toggle', () => {
      moreOpen = more.open
      if (ctx.prefs) ctx.prefs.set('pcMore', moreOpen)
    })
    const infoBody = [infoDl, more]
    // two parts: the distance between them
    if (g.parts.length === 2) {
      const [pa, pb] = g.parts
      infoBody.push(kvList([rowOf(t('pc_dist_centres'), `${ctx.fmtLen(vecDistance(boxCenter(g.infos[0].box), boxCenter(g.infos[1].box)))} ${unit()}`, 'derived')]))
      if (isMesh(pa) && isMesh(pb)) infoBody.push(distanceRow(pa, pb))
    } else if (g.parts.length > 2) infoBody.push(hint(t('pc_dist_none')))
    if (g.parts.length > 1) infoBody.push(hint(t('pc_overlap')))
    const actions = el('div', { className: 'btnrow pc-actions' }, btn(t('pc_fit'), () => ctx.fit()), btn(t('pc_only'), () => ctx.isolate()), btn(t('pc_copy'), () => ctx.flash && ctx.flash(copyText(detailsText(lastTitle, lastRows)) ? t('pc_copied') : t('pc_copy_failed'))))
    if (g.parts.length === 2 && ctx.measureParts) actions.append(btn(t('pc_measure'), () => ctx.measureParts()))
    infoBody.push(actions)
    const infoCard = makeCard({ id: 'pc-info', title: t('pc_info_title'), icon: icon('info'), extras: [x], body: infoBody })

    // ---- Dimensions ----
    const up = ctx.upAxis ? ctx.upAxis() : null
    const dimRows = ['x', 'y', 'z'].map((a, i) => ({ label: up === a ? t('pc_up', { axis: a.toUpperCase() }) : a.toUpperCase(), value: ctx.fmtLen(g.info.dims[i]), unit: unit(), src: 'derived' })) // the row X, Y, Z: three big numbers
    lastRows.push([t('pc_dims'), dims(g.info.dims)])
    const unitNote = ctx.unitSrc && ctx.unitSrc() === 'assumed' ? hint(src('assumed', t('pc_unit_assumed', { u: unit() }))) : null
    const q = ctx.meshQuality ? ctx.meshQuality() : null
    const dimsNote = hint(t(ctx.meshNote ? 'pc_dims_note_mesh' : 'pc_dims_note'), q ? ` ${t('pc_quality', { q: t(`pc_q_${q}`) })}` : '') // what the box is: behind the "?", not in the card all the time
    const dimsCard = makeCard({ id: 'pc-dims', title: t('pc_dims_title'), icon: icon('measure'), help: helpButton({ id: 'pc-dims-help', label: t('ch_help_for', { card: t('pc_dims_title') }), tip: t('ch_help_tip'), mark: icon('help'), targets: dimsNote }), body: [dimsRow(dimRows, { id: 'pc-dims-kv' }), el('p', { className: 'dims-src', textContent: t('ch_dims_src') }), dimsNote, unitNote] }) // one short line stays in sight (where the numbers come from); what the box means in detail is behind the "?"
    dimsCard.querySelector('dl').title = t('pc_dims_tip')

    // ---- Volume (filled in by paint(), because it waits for the check) ----
    const volBody = el('div', { className: 'pc-vol-body' })
    const volNote = hint(`${g.parts.length > 1 ? `${t('pc_vol_sum')} ` : ''}${t('pc_vol_note')}`) // how the volume is worked out: behind the "?"
    const volCard = makeCard({ id: 'pc-vol', title: t('pc_vol_title'), icon: icon('volume'), help: helpButton({ id: 'pc-vol-help', label: t('ch_help_for', { card: t('pc_vol_title') }), tip: t('ch_help_tip'), mark: icon('help'), targets: volNote }), body: [volBody, volNote] })

    // ---- Estimate the weight (STEP only) ----
    let weightCard = null
    let weightBody = null
    if (ctx.weight) {
      weightBody = el('div', { className: 'pc-w-body' })
      weightCard = makeCard({ id: 'pc-weight', title: t('pc_w_title'), icon: icon('weight'), extras: [el('span', { className: 'tag card-tag', textContent: t('pc_w_optional') })], body: [weightBody] })
    }

    const helpFocus = root.contains(document.activeElement) && document.activeElement.classList.contains('help-btn') ? document.activeElement.id : '' // the cards are built again for every selection: the focus on a "?" goes back to its new button
    root.replaceChildren(infoCard, dimsCard, volCard, ...(weightCard ? [weightCard] : []))
    if (helpFocus) {
      const back = document.getElementById(helpFocus)
      if (back) back.focus({ preventScroll: true })
    }
    cur = { g, volBody, weightBody, moreHost, one }
    // the chip in the view
    const cb = el('button', { type: 'button', textContent: t('pc_chip_card'), title: t('pc_chip_tip') })
    cb.onclick = () => {
      ctx.openPanel()
      root.scrollIntoView({ block: 'nearest' })
    }
    const cx = el('button', { type: 'button', textContent: '✕' })
    cx.setAttribute('aria-label', t('pc_clear'))
    cx.onclick = () => ctx.clear()
    chip.replaceChildren(src('derived', `${title} · ${dims(g.info.dims)}`), cb, cx) // the sizes in the chip are worked out from the mesh like the Dimensions card
    chip.hidden = false
    const cs = checkState(g)
    paint()
    if (cs.kind === 'wait') run(cs.missing)
  }

  // ----- the parts of the cards that wait for the check: volume, surface, "More about the part", the estimate -----
  function paint() {
    if (!cur) return
    const { g, volBody, weightBody, moreHost, one } = cur
    const cs = checkState(g)
    const sum = cs.kind === 'done' ? cs.sum : null
    const hadFocus = weightBody && weightBody.contains(document.activeElement) ? document.activeElement.id : ''
    // Volume
    const body = []
    if (cs.kind === 'done') {
      const volText = cs.instanced ? null : sum.volume == null ? null : ctx.fmtVol(sum.volume, unit())
      body.push(bigNumber(volText || '–', 'derived', { id: 'pc-vol-big' }))
      body.push(kvList([{ label: t('pc_area'), value: ctx.fmtArea(sum.area, unit()), src: 'derived' }], { id: 'pc-vol-kv' }))
      if (!volText) body.push(hint(t(cs.instanced ? 'pc_vol_why_inst' : 'pc_vol_why'))) // why there is no number stays in sight; how it is worked out in detail is behind the "?"
      else body.push(el('p', { className: 'dims-src', textContent: t('pc_vol_src') })) // and one short line says where the number comes from
      for (const [label, value] of [[t('pc_volume'), volText || '–'], [t('pc_area'), ctx.fmtArea(sum.area, unit())]]) {
        const i = lastRows.findIndex((x) => x[0] === label) // "Copy the numbers" carries the volume and the surface too (not the estimate)
        if (i >= 0) lastRows[i][1] = value
        else lastRows.push([label, value])
      }
      if (ctx.unitSrc && ctx.unitSrc() === 'assumed') body.push(hint(src('assumed', t('pc_unit_assumed', { u: unit() }))))
    } else if (cs.kind === 'click') {
      body.push(bigNumber('–', 'derived', { id: 'pc-vol-big' }))
      body.push(hint(g.parts.length > MANY_PARTS ? t('pc_many') : t('pc_calc_tip')))
      body.push(Object.assign(el('button', { type: 'button', id: 'pc-calc', textContent: t('pc_calc'), title: t('pc_calc_tip') }), { onclick: () => run(cs.missing) }))
    } else if (cs.kind === 'error') {
      body.push(bigNumber('–', 'derived', { id: 'pc-vol-big' }), hint(t('pc_error')))
    } else if (cs.kind === 'none') {
      body.push(bigNumber('–', 'derived', { id: 'pc-vol-big' }), hint(t('pc_vol_why')))
    } else {
      body.push(bigNumber('…', 'derived', { id: 'pc-vol-big' }), hint(t('pc_vol_wait')))
    }
    volBody.replaceChildren(...body)
    volBody.setAttribute('role', 'status') // the number arrives later: a screen reader hears it
    // the rows of "More about the part"
    moreHost.replaceChildren(...moreRows(g, one, cs))
    // the estimate
    if (weightBody) {
      weightBody.replaceChildren(...weightParts(g, cs, sum))
      weightBody.setAttribute('role', 'status')
      if (hadFocus) {
        const back = document.getElementById(hadFocus)
        if (back) back.focus({ preventScroll: true }) // the list was rebuilt while it had the focus: the focus goes back
      }
    }
  }

  function moreRows(g, one, cs) {
    const rows = [{ label: t('pc_centre'), value: pt(g.info.center), src: 'derived' }]
    const wait = cs.kind === 'done' ? null : cs.kind === 'click' || cs.kind === 'error' ? '—' : t('pc_computing')
    rows.push({ label: t('pc_vertices'), value: wait || num(cs.sum.vertices), src: 'derived' })
    let wt = wait
    if (!wt) wt = one ? (cs.sum.watertight ? t('pc_yes') : t('pc_no', { b: num(cs.sum.boundaryEdges), n: num(cs.sum.nonManifoldEdges) })) : t(cs.sum.watertight ? 'pc_all' : 'pc_not_all')
    rows.push({ label: t('pc_watertight'), value: wt, src: 'derived' })
    if (one) {
      const p = g.parts[0]
      const m = modelMatrix(p)
      if (!isIdentity(m)) {
        const dc = decompose(m)
        const r = (v) => num(v, 2)
        rows.push({ label: t('pc_position'), value: pt(dc.position), src: 'derived' })
        if (dc.shear) rows.push({ label: t('pc_rotation'), value: t('pc_shear'), src: 'derived' })
        else {
          rows.push({ label: t('pc_rotation'), value: `${dc.rotation.map(r).join(' / ')} °`, src: 'derived' })
          rows.push({ label: t('pc_scale'), value: `${dc.scale.map(r).join(' / ')}${dc.mirrored ? ` (${t('pc_mirrored')})` : ''}`, src: 'derived' })
        }
      }
      const same = A.getParts().filter((q) => q.obj.geometry === p.obj.geometry)
      rows.push({ label: t('pc_instance'), value: p.obj.isInstancedMesh ? t('pc_instance_mesh', { n: p.obj.count }) : same.length > 1 ? t('pc_instance_n', { i: same.indexOf(p) + 1, n: same.length }) : t('pc_single'), src: 'derived' })
      rows.push({ label: t('pc_visible'), value: t(p.visible ? (ctx.isCut && ctx.isCut(p) ? 'pc_visible_cut' : 'pc_visible_yes') : 'pc_visible_no'), src: 'derived' })
    }
    for (const r of rows) {
      const i = lastRows.findIndex((x) => x[0] === r.label)
      if (i >= 0) lastRows[i][1] = r.value
      else lastRows.push([r.label, r.value])
    }
    return [kvList(rows, { id: 'pc-more-kv' })]
  }

  /** The body of "Estimate the weight": the choice of a density, and, once one is chosen and there is a basis, the estimate with its mark. */
  function weightParts(g, cs, sum) {
    const mode = ctx.weight.mode()
    const volume = sum && !cs.instanced && sum.volume != null ? sum.volume : null
    const out = []
    const why = whyNoEstimate({ volume: cs.kind === 'done' ? volume : 0, mode })
    if (why === 'unit') return [hint(t('pc_w_nounit'))]
    const sel = el('select', { id: 'pc-dens', title: t('pc_dens_label') })
    sel.setAttribute('aria-label', t('pc_dens_label'))
    sel.dataset.src = 'estimate'
    sel.dataset.pick = '1' // the choice itself is not an estimate, its result is
    sel.append(el('option', { value: '', textContent: t('pc_dens_none') }))
    for (const d of DENSITIES) sel.append(el('option', { value: d.k, textContent: `${t(`pc_dens_${d.k}`)} (${num(d.v, 2)} g/cm³)` }))
    sel.value = density
    sel.onchange = () => {
      density = sel.value
      paint()
      const again = cur && cur.weightBody && cur.weightBody.querySelector('#pc-dens')
      if (again) again.focus()
    }
    const label = el('label', { className: 'hint pc-dens-label', textContent: t('pc_dens_label') })
    label.htmlFor = 'pc-dens'
    out.push(label, sel)
    if (!density) {
      out.push(hint(t('pc_w_nothing')))
      return out
    }
    if (cs.kind !== 'done') {
      out.push(hint(t(cs.kind === 'click' ? 'pc_w_click' : cs.kind === 'error' ? 'pc_error' : 'pc_w_wait')))
      return out
    }
    const grams = weightGrams({ volume, unit: unit(), mode, density })
    if (grams === null) {
      out.push(hint(t('pc_w_novol')))
      return out
    }
    const w = scaleWeight(grams)
    const d = densityOf(density)
    const block = estimateBlock({ value: `${num(w.value, w.digits)} ${w.unit}`, markText: t('pc_est'), id: 'pc-w-res' })
    block.append(hint(`${t('pc_w_basis')} `, src('estimate', `${num(d.v, 2)} g/cm³`), `. ${t('pc_w_mesh')} ${g.parts.length > 1 ? `${t('pc_w_same')} ${t('pc_overlap')} ` : ''}${t('pc_w_guide')}`))
    out.push(block)
    return out
  }

  // ----- the detailed numbers (worker) -----
  async function run(missing) {
    const my = ++runId
    for (const p of missing) {
      busy.add(p.obj)
      failed.delete(p.obj)
    }
    paint()
    try {
      const { results } = await S.analyze(A, { parts: missing })
      for (const p of missing) busy.delete(p.obj)
      // a result is valid for as long as the mesh is the same (the signature says so), also when another selection came meanwhile: it is kept, not worked out twice
      missing.forEach((p, i) => cache.set(p.obj, { sig: sigOf(p), res: results[i] }))
      paint()
    } catch (e) {
      for (const p of missing) busy.delete(p.obj)
      if (e && e.message === 'cancelled') return paint()
      if (my === runId) for (const p of missing) failed.add(p.obj)
      paint()
      if (my === runId && ctx.flash) ctx.flash(t('pc_error'))
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
    val.dataset.src = 'derived'
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
    el: root,
    chip,
    /** Call after the selection changed. */
    update: render,
    /** The working copy changed (a tool ran, another file came): what was worked out is stale. */
    invalidate() {
      cache.clear()
      distCache.clear()
      busy.clear()
      failed.clear()
      density = ''
      selSig = ''
      runId++
      if (cancelDistance) cancelDistance()
      cancelDistance = null
      render()
    },
    /** The rows "Copy the numbers" would copy (tests). */
    rows: () => lastRows.map((r) => [...r]),
    /** The check results kept for a part (tests and tooling). */
    cached: (obj) => cache.get(obj) || null
  }
}

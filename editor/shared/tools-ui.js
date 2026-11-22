// Shared by 3D Model Viewer and STEP Viewer 3D (canonical copy: plugins/_shared; do not edit the copies in editor/shared).
// The "Tools" section of the side panel: transform the working copy (unit, origin, scale, rotate, mirror), remove or merge parts,
// decimate, check the mesh. The page supplies the markup (see index.html) and the adapter `A` (see tools-scene.js).
import { renderPng } from './export-three.js'
import * as S from './tools-scene.js'

const DETAIL_ERROR = { careful: 0.01, normal: 0.05, target: 1 } // relative error the simplifier may use (1: no limit)

/**
 * ctx: { t, locale, A, hasModel(), selectedPart() -> index in A.getParts() or -1, measure() -> { size: [x, y, z], tris },
 *        fmtLen(n), view() -> { renderer, scene, camera, canvas, helpers }, resize(), nextFrame() }
 */
export function initToolsUi(ctx) {
  const { t, A } = ctx
  const $ = (id) => document.getElementById(id)
  let busy = false
  let cancelTask = null
  const thumbs = { before: null }

  const buttons = () => document.querySelectorAll('#tools-sec button:not(#tl-cancel), #info-actions button:not(#b-copy-details), #tl-assign')
  function setResult(lines) {
    const box = $('tl-result')
    box.hidden = !lines.length
    box.replaceChildren(...lines.map((text) => Object.assign(document.createElement('div'), { textContent: text })))
  }
  function refresh() {
    const has = ctx.hasModel()
    $('tl-parts-group').hidden = !A.structure
    for (const b of buttons()) b.disabled = !has || busy
    $('tl-unit').disabled = !has || busy
    const unit = has ? A.getUnit().short : ''
    const known = !!S.UNIT_METERS[unit]
    $('tl-unit-hint').hidden = !has || known
    $('tl-convert').disabled = !has || busy || !known
    if (known && !busy && document.activeElement !== $('tl-unit')) $('tl-unit').value = unit
    $('tl-bake-up').disabled = !has || busy || A.getUp() === 'y'
    const n = has ? S.changeList(A).length : 0
    $('tl-status').hidden = n === 0
    $('tl-status').textContent = n ? t('tl_status', { n }) : ''
    $('tl-reset').hidden = n === 0
    $('tl-cancel').hidden = !busy || !cancelTask
    $('tl-keep-out').textContent = $('tl-keep').value
    document.documentElement.dataset.tools = busy ? 'busy' : 'idle'
  }

  async function thumb() {
    const r = await renderPng({ ...ctx.view(), overlay: null, size: 260, transparent: false, onRestore: ctx.resize })
    return createImageBitmap(new Blob([r.bytes], { type: 'image/png' }))
  }
  function drawThumb(canvasId, bmp) {
    const cv = $(canvasId)
    cv.width = bmp.width
    cv.height = bmp.height
    cv.getContext('2d').drawImage(bmp, 0, 0)
  }
  const sizeLine = (a, b) => {
    const f = (s) => s.map((v) => ctx.fmtLen(v)).join(' × ')
    return t('tl_res_size', { a: f(a.size), b: f(b.size), u: A.getUnit().short })
  }

  // Runs one tool: before and after numbers and, for the ones that change the shape, small pictures of the view.
  async function run(fn, { pictures = false, extra } = {}) {
    if (!ctx.hasModel() || busy) return
    busy = true
    if (ctx.beforeChange) ctx.beforeChange() // e.g. the model is put back together before a tool changes it
    const focusId = document.activeElement && document.activeElement.id
    refresh()
    setResult([])
    $('tl-thumbs').hidden = true
    try {
      const before = ctx.measure()
      if (pictures) thumbs.before = await thumb()
      const out = await fn()
      if (out === false) {
        setResult([t('tl_nothing')])
        return
      }
      await ctx.nextFrame()
      const after = ctx.measure()
      const lines = [sizeLine(before, after), t('tl_res_tris', { a: before.tris.toLocaleString(ctx.locale), b: after.tris.toLocaleString(ctx.locale) })]
      if (extra) lines.unshift(...extra(out))
      setResult(lines)
      if (pictures && thumbs.before) {
        const bmp = await thumb()
        drawThumb('tl-cv-before', thumbs.before)
        drawThumb('tl-cv-after', bmp)
        $('tl-thumbs').hidden = false
      }
    } catch (e) {
      if (!(e && e.message === 'cancelled')) setResult([t('tl_error', { why: String((e && e.message) || e).slice(0, 160) })])
      else setResult([])
    } finally {
      busy = false
      cancelTask = null
      refresh()
      autoCheck() // the numbers of the Details follow the model as the tool left it
      const again = focusId && $(focusId)
      if (again && !again.disabled && !again.hidden) again.focus({ preventScroll: true }) // the button that was pressed stays where the keyboard is
    }
  }
  let lastPct = -1
  const progress = (fraction) => {
    const pct = Math.floor((fraction * 100) / 10) * 10 // steps of ten: the result is a live region
    if (pct !== lastPct) setResult([t('tl_working', { pct })])
    lastPct = pct
  }

  const unitLabel = (short) => t('tl_unit_label', { name: t('tl_u_' + short) })
  $('tl-convert').onclick = () => {
    const to = $('tl-unit').value
    run(() => S.convertUnit(A, to, unitLabel(to)))
  }
  $('tl-assign').onclick = () => {
    const to = $('tl-unit').value
    run(() => S.assignUnit(A, to, unitLabel(to)))
  }
  $('tl-center').onclick = () => run(() => S.setOrigin(A, 'center'))
  $('tl-floor').onclick = () => run(() => S.setOrigin(A, 'floor'))
  $('tl-onfloor').onclick = () => run(() => S.setOrigin(A, 'floor-only'))
  $('tl-mincorner').onclick = () => run(() => S.setOrigin(A, 'min'))
  $('tl-scale-go').onclick = () => run(() => S.scaleBy(A, Number($('tl-scale').value)))
  for (const b of document.querySelectorAll('#tl-rotate button')) {
    b.setAttribute('aria-label', `${t('tl_rotate')}: ${b.dataset.axis.toUpperCase()}`)
    b.setAttribute('aria-description', t('tl_rotate_tip')) // the way back (Shift) is said to a screen reader too
    b.onclick = (e) => run(() => S.rotate(A, b.dataset.axis, e.shiftKey ? -Number(b.dataset.deg) : Number(b.dataset.deg))) // Shift: the other way round
  }
  for (const b of document.querySelectorAll('#tl-mirror button')) {
    b.setAttribute('aria-label', `${t('tl_mirror')}: ${b.dataset.axis.toUpperCase()}`)
    b.onclick = () => run(() => S.mirror(A, b.dataset.axis))
  }
  $('tl-scale').onkeydown = (e) => {
    if (e.key === 'Enter') $('tl-scale-go').click()
  }
  $('tl-bake-up').onclick = () => run(() => S.bakeUp(A))
  $('tl-remove-hidden').onclick = () => run(() => S.removeParts(A, A.getParts().filter((p) => !p.visible)) || false, { pictures: true })
  $('tl-remove-selected').onclick = () => {
    const i = ctx.selectedPart()
    run(() => (i >= 0 ? S.removeParts(A, [A.getParts()[i]]) || false : false), { pictures: true })
  }
  $('tl-merge').onclick = () => run(() => S.mergeVisible(A) || false, { pictures: true })
  $('tl-keep').oninput = () => ($('tl-keep-out').textContent = $('tl-keep').value)
  $('tl-decimate').onclick = () => {
    const opts = { ratio: Number($('tl-keep').value) / 100, error: DETAIL_ERROR[$('tl-detail').value], lockBorder: $('tl-lock').checked }
    run(
      async () => {
        const r = await S.decimate(A, opts, {
          onProgress: progress,
          setCancel: (fn) => {
            cancelTask = fn
            refresh()
          }
        })
        return r.parts ? r : false
      },
      {
        pictures: true,
        extra: (r) => [r.trianglesOut >= r.trianglesIn ? t('tl_not_reduced', { n: r.trianglesIn.toLocaleString(ctx.locale) }) : t('tl_decimated', { a: r.trianglesIn.toLocaleString(ctx.locale), b: r.trianglesOut.toLocaleString(ctx.locale), n: r.parts }), ...(r.skipped ? [t('tl_skipped', { n: r.skipped })] : [])]
      }
    )
  }
  $('tl-cancel').onclick = () => cancelTask && cancelTask()
  $('tl-check-btn').onclick = async () => {
    if (!ctx.hasModel() || busy) return
    busy = true
    refresh()
    const box = $('tl-check')
    box.hidden = true
    lastPct = -1
    try {
      const r = await S.analyze(A, {
        onProgress: progress,
        setCancel: (fn) => {
          cancelTask = fn
          refresh()
        }
      })
      setResult([])
      const tot = r.total
      const lines = [t('tl_check_title')]
      if (!r.results.length) lines.push(t('tl_ck_none'))
      else {
        lines.push(t('tl_ck_tris', { n: tot.triangles.toLocaleString(ctx.locale) }), tot.watertight ? t('tl_ck_closed') : t('tl_ck_open'))
        if (tot.holes) lines.push(t('tl_ck_holes', { n: tot.holes, e: tot.boundaryEdges.toLocaleString(ctx.locale) }))
        if (tot.nonManifoldEdges) lines.push(t('tl_ck_nonmanifold', { n: tot.nonManifoldEdges.toLocaleString(ctx.locale) }))
        if (tot.flippedEdges) lines.push(t('tl_ck_flipped', { n: tot.flippedEdges.toLocaleString(ctx.locale) }))
        if (tot.inverted) lines.push(t('tl_ck_inverted'))
        if (tot.degenerate) lines.push(t('tl_ck_degenerate', { n: tot.degenerate.toLocaleString(ctx.locale) }))
        lines.push(t('tl_ck_pieces', { n: tot.components }))
        if (tot.area) lines.push(t('tl_ck_area', { v: ctx.fmtArea ? ctx.fmtArea(tot.area, A.getUnit().short) : `${Number(tot.area.toPrecision(5)).toLocaleString(ctx.locale)} ${A.getUnit().short}²` }))
        if (tot.volume != null && tot.watertight) lines.push(t('tl_ck_volume', { v: ctx.fmtVol ? ctx.fmtVol(tot.volume, A.getUnit().short) : `${Number(tot.volume.toPrecision(5)).toLocaleString(ctx.locale)} ${A.getUnit().short}³` }))
      }
      box.replaceChildren(...lines.map((text, i) => Object.assign(document.createElement('div'), { textContent: text, className: i === 0 ? 'strong' : '' })))
      box.hidden = false
      ctx.onCheck && ctx.onCheck(r)
    } catch (e) {
      if (!(e && e.message === 'cancelled')) setResult([t('tl_error', { why: String((e && e.message) || e).slice(0, 160) })])
      else setResult([])
    } finally {
      busy = false
      cancelTask = null
      refresh()
    }
  }
  // The numbers of the Details (watertight, volume, surface) for a model that is not huge: looked up in the background after it loaded.
  let autoGen = 0
  let autoCancel = null
  async function autoCheck() {
    const gen = ++autoGen // a newer model or change makes an older answer stale
    if (autoCancel) autoCancel()
    autoCancel = null
    if (!ctx.onCheck || !ctx.hasModel() || ctx.measure().tris > 500000) return
    try {
      const r = await S.analyze(A, { setCancel: (fn) => (autoCancel = fn) })
      if (gen === autoGen && ctx.hasModel() && r.results.length) ctx.onCheck(r)
    } catch {
      // the numbers are a courtesy: nothing to say when they cannot be had
    }
  }
  $('tl-reset').onclick = () => {
    if (ctx.beforeChange) ctx.beforeChange()
    S.reset(A)
    setResult([])
    $('tl-thumbs').hidden = true
    $('tl-check').hidden = true
    refresh()
  }
  refresh()
  return {
    refresh,
    /** Whether the working copy was changed by a tool (a question before the model is closed). */
    hasChanges: () => S.hasChanges(A),
    /** A new model was loaded: forget the old working copy. */
    modelChanged() {
      if (cancelTask) cancelTask() // a running tool belongs to the old model
      S.forget(A)
      autoCheck()
      setResult([])
      $('tl-thumbs').hidden = true
      $('tl-check').hidden = true
      thumbs.before = null
      refresh()
    }
  }
}

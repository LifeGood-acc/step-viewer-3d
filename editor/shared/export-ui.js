// Shared by 3D Model Viewer and STEP Viewer 3D (canonical copy: plugins/_shared; do not edit the copies in editor/shared).
// The "Export a copy" section of the side panel. The page supplies the markup (see index.html) and, through `ctx`, what is plugin
// specific: how the model's parts are counted and turned into a file.
//
// "Create copy" builds the bytes and shows their size; "Save as …" then hands them to Orca's Save dialog (files.saveAs). Two steps
// because files.saveAs needs a fresh click and building a large file can take longer than a click stays fresh. The original file is
// never touched: the section only ever makes copies.
import { estimateBytes, FORMATS, sizeVerdict, suggestName } from './export.js'
import { recordTurntable, recorderMime, renderPng } from './export-three.js'

const MAX_COMPRESS_MEMORY = 2.2 * 1024 * 1024 * 1024 // beyond this a tab is likely to run out of memory while compressing
const MAX_BUILD_BYTES = 400 * 1024 * 1024 // a copy estimated above this is not built: it could not be saved and could exhaust the page's memory
const MESH_FORMATS = ['glb', 'glbc', 'stl', 'obj', 'ply', '3mf']
const DEFAULT_UP = { glb: 'y', glbc: 'y', stl: 'z', '3mf': 'z', obj: 'keep', ply: 'keep' } // the convention of each format

/**
 * ctx: {
 *   t, locale, shell, pluginName, (sizes of a copy are written here, in KiB and MiB),
 *   plain?: true when the model has no textures, point clouds or slicer data (the STEP viewer): shorter notes about what a copy loses,
 *   hasModel(), glLost(), currentName(), nextFrame(),
 *   counts(onlyVisible) -> { tris, verts, points, textured, pointParts },
 *   exportable(onlyVisible) -> boolean            something visible that can be written
 *   buildMesh(format, { only, target }) -> Promise<Uint8Array>     throws Error('none') when the format has nothing to write
 *   view() -> { renderer, scene, camera, controls, canvas, helpers },  resize(), requestRender(),
 *   saveBytes(name, mime, bytes) -> Promise<{ status }>
 * }
 */
export function initExportUi(ctx) {
  const { t, shell, pluginName } = ctx
  // sizes of a copy in KiB / MiB everywhere (the target is chosen in MiB and Orca's limits are MiB); the page's own file size row stays in KB / MB
  const fmtMB = (b) => {
    const loc = ctx.locale || undefined
    return b < 1048576 ? `${(b / 1024).toLocaleString(loc, { maximumFractionDigits: 0 })} KiB` : `${(b / 1048576).toLocaleString(loc, { maximumFractionDigits: 1 })} MiB`
  }
  const $ = (id) => document.getElementById(id)
  let job = null // { format, name, mime, bytes, verdict } waiting for "Save as …"
  let busy = false
  let cancel = false
  let gen = 0 // bumped whenever what is on screen changes: a copy that finishes after that is stale and dropped
  let lastProgress = ''
  let taskCancel = null // stops the compressor task that is running

  // glTF means meters: a model in a known other unit is scaled when it is written (others are written as they are)
  const gltfScale = () => (ctx.gltfScale ? ctx.gltfScale() : { k: 1, unit: '' })

  function setResult(text, ...lines) {
    const box = $('ex-result')
    box.hidden = !text
    box.replaceChildren()
    if (text) box.append(Object.assign(document.createElement('div'), { textContent: text }))
    for (const line of lines.flat()) if (line) box.append(Object.assign(document.createElement('div'), { textContent: line }))
  }

  function refresh() {
    const fmt = $('ex-format').value
    const isMesh = MESH_FORMATS.includes(fmt)
    const has = ctx.hasModel()
    $('ex-mesh-opts').hidden = !isMesh
    $('ex-png-opts').hidden = fmt !== 'png'
    const alphaHint = $('ex-png-hint')
    if (alphaHint) alphaHint.hidden = fmt !== 'png' || $('ex-png-bg').value !== 'transparent'
    $('ex-webm-opts').hidden = fmt !== 'webm'
    $('ex-glbc-opts').hidden = fmt !== 'glbc'
    $('ex-lossy').textContent = t((ctx.plain && isMesh ? 'ex_lossy_plain_' : 'ex_lossy_') + fmt)
    const c = ctx.counts($('ex-visible').checked)
    const notes = []
    if (isMesh && c.pointParts && ['stl', '3mf'].includes(fmt)) notes.push(t('ex_note_points', { n: c.pointParts }))
    if (isMesh && c.textured && fmt !== 'glb' && fmt !== 'glbc') notes.push(t('ex_note_textures'))
    $('ex-thin-row').hidden = !(fmt === 'glbc' && c.pointParts > 0)
    if (fmt === '3mf' && ctx.unitAssumed && ctx.unitAssumed()) notes.push(t('ex_note_unit_assumed'))
    if ((fmt === 'glb' || fmt === 'glbc') && gltfScale().k !== 1) notes.push(t('ex_note_gltf_units', { unit: gltfScale().unit }))
    else if ((fmt === 'glb' || fmt === 'glbc') && ctx.unitUnknown && ctx.unitUnknown()) notes.push(t('ex_note_glb_unit_unknown')) // numbers are taken as meters
    if (fmt === 'glbc' && c.pointParts > 0) notes.push(ctx.isSplat && ctx.isSplat() ? t('ex_note_splat') : $('ex-thin').checked ? t('ex_note_thin') : '')
    $('ex-notes').hidden = notes.length === 0
    $('ex-notes').textContent = notes.join(' ')
    let est = 0
    if (isMesh) est = estimateBytes(fmt, c)
    else if (fmt === 'webm') est = Number($('ex-seconds').value) * 1_000_000 // about 8 Mbit/s
    $('ex-estimate').hidden = !est
    $('ex-estimate').textContent = est ? t('ex_estimate', { size: fmtMB(est) }) : ''
    $('b-ex-make').disabled = !has || busy
    $('ex-format').disabled = !has || busy
    $('b-ex-save').disabled = !job || job.verdict === 'too-large' || busy
    $('b-ex-cancel').hidden = !(busy && (fmt === 'webm' || fmt === 'glbc'))
    document.documentElement.dataset.export = busy ? 'busy' : job ? 'ready' : 'idle'
  }

  // Before and after of a compression: what changed in the model and in the file, and whether the target was met.
  function reportLines(r, c, outBytes) {
    const loc = ctx.locale || undefined
    const n = (v) => Math.round(v).toLocaleString(loc)
    const mib = (b) => (b < 1048576 ? `${(b / 1024).toLocaleString(loc, { maximumFractionDigits: 0 })} KiB` : `${(b / 1048576).toLocaleString(loc, { maximumFractionDigits: 1 })} MiB`) // the target is chosen in MiB, so the report speaks MiB
    const lines = []
    const st = r.stats || {}
    if (c.tris) lines.push(t('ex_rep_tris', { a: n(c.tris), b: n(st.trianglesOut ?? c.tris) }))
    if (c.points) lines.push(t('ex_rep_points', { a: n(r.points || c.points), b: n(r.thinned ? r.thinned.to : r.points || c.points) }))
    if (r.textures && r.textures.before.count) lines.push(t('ex_rep_tex', { n: r.textures.before.count, a: mib(r.textures.before.bytes), b: mib(r.textures.after.bytes), px: r.textures.after.maxSize || '–' }))
    const orig = ctx.originalBytes ? ctx.originalBytes() : 0
    lines.push(t('ex_rep_size', { orig: orig ? mib(orig) : '–', glb: mib(r.inputBytes), out: mib(outBytes) }))
    const tgt = mib(r.targetBytes)
    lines.push(r.reached ? t('ex_rep_reached', { t: tgt }) : t('ex_rep_missed', { t: tgt, out: mib(outBytes) }))
    if (!r.reached) for (const sug of r.suggestions || []) lines.push(t('ex_sug_' + sug))
    return lines
  }

  // The copy no longer matches what is on screen (another format, option, part visibility, file): the person makes it again.
  function invalidate() {
    gen++
    if (busy) {
      cancel = true // a recording or compression stops; a build in progress finishes and is dropped
      if (taskCancel) taskCancel()
      return
    }
    job = null
    setResult('')
    refresh()
  }

  for (const opt of $('ex-format').options) if (opt.value === 'webm' && !recorderMime()) opt.disabled = true
  $('ex-format').onchange = () => {
    const fmt = $('ex-format').value
    if (DEFAULT_UP[fmt]) $('ex-up').value = DEFAULT_UP[fmt]
    invalidate()
  }
  for (const id of ['ex-visible', 'ex-up', 'ex-png-size', 'ex-png-bg', 'ex-seconds', 'ex-webm-size', 'ex-target', 'ex-texmax', 'ex-precision', 'ex-thin']) $(id).onchange = invalidate
  $('ex-up').value = DEFAULT_UP[$('ex-format').value] || 'keep'

  async function build(fmt) {
    const only = $('ex-visible').checked
    if (MESH_FORMATS.includes(fmt)) {
      if (!ctx.exportable(only)) throw new Error(t('ex_nothing'))
      const counts = ctx.counts(only)
      if (fmt === 'glbc') {
        // the page, the plain copy, the worker's copy and its output: about four times the data
        const mem = (counts.verts * 40 + counts.tris * 12 + counts.points * 28) * 4 + (counts.texBytes || 0) * 2
        if (mem > MAX_COMPRESS_MEMORY) throw new Error(t('ex_too_big_memory', { size: fmtMB(mem) }))
        const target = Math.max(0.001, Number($('ex-target').value) || 45) * 1048576
        const what = { geometry: t('ex_what_geometry'), textures: t('ex_what_textures'), thinning: t('ex_what_thinning') }
        const res = await ctx.buildCompressed({
          only,
          target: $('ex-up').value,
          scale: gltfScale().k,
          opts: { targetBytes: target, texMax: Number($('ex-texmax').value), precision: $('ex-precision').value, thin: $('ex-thin').checked },
          onProgress: (fraction, label) => {
            const text = t('ex_progress', { what: what[label] || what.geometry, pct: Math.round(fraction * 100) })
            if (text !== lastProgress) setResult((lastProgress = text))
          },
          setCancel: (fn) => {
            taskCancel = fn
          },
          isCancelled: () => cancel
        })
        taskCancel = null
        return res
      }
      const est = estimateBytes(fmt, counts)
      if (est > MAX_BUILD_BYTES) throw new Error(t('ex_too_big_build', { size: fmtMB(est) }))
      try {
        return await ctx.buildMesh(fmt, { only, target: $('ex-up').value, scale: fmt === 'glb' ? gltfScale().k : 1 })
      } catch (e) {
        if (e && e.message === 'none') throw new Error(t('ex_note_none'))
        throw e
      }
    }
    const v = ctx.view()
    if (v.spinner) v.spinner.stop() // a live turntable would fight the film for the angle
    lastProgress = ''
    if (fmt === 'png') {
      const r = await renderPng({ ...v, size: pngSize(v), transparent: $('ex-png-bg').value === 'transparent', onRestore: ctx.resize })
      return r.bytes
    }
    const seconds = Number($('ex-seconds').value)
    const bytes = await recordTurntable({
      ...v,
      seconds,
      size: Number($('ex-webm-size').value),
      spinner: v.spinner || null,
      onRestore: ctx.resize,
      onProgress: (sec) => {
        const text = t('ex_recording', { n: Math.min(seconds, Math.floor(sec) + 1), total: seconds })
        if (text !== lastProgress) setResult((lastProgress = text)) // only when the text changes: it is a live region
      },
      isCancelled: () => cancel
    })
    return bytes
  }

  // "2×" and "4×" are multiples of the view as shown; a number is the longer side in pixels
  function pngSize(v) {
    const val = $('ex-png-size').value
    const m = /^x(\d)$/.exec(val)
    if (!m) return Number(val)
    return Math.round(Math.max(v.canvas.clientWidth, v.canvas.clientHeight) * Number(m[1]))
  }

  async function make() {
    if (!ctx.hasModel() || busy || ctx.glLost()) return
    const fmt = $('ex-format').value
    busy = true
    cancel = false
    job = null
    setResult(t('ex_making'))
    refresh()
    const t0 = performance.now()
    const myGen = gen
    const source = ctx.currentName()
    try {
      await ctx.nextFrame() // lets the label appear before a long build
      let built = await build(fmt)
      const report = built && built.report
      const bytes = built && built.bytes ? built.bytes : built
      built = null
      if (!bytes || myGen !== gen) {
        setResult('') // cancelled, or the model or an option changed meanwhile: these bytes are not what is on screen any more
        return
      }
      const name = suggestName(source, fmt, String(source).split('.').pop().toLowerCase() === FORMATS[fmt].ext)
      const verdict = sizeVerdict(bytes.length)
      // a copy the Save dialog would refuse is not kept in memory
      job = { format: fmt, name, mime: FORMATS[fmt].mime, bytes: verdict === 'too-large' ? null : bytes, verdict }
      setResult(t('ex_ready', { name, size: fmtMB(bytes.length) }), report ? reportLines(report, ctx.counts($('ex-visible').checked), bytes.length) : [], t({ opens: 'ex_verdict_opens', 'no-open': 'ex_verdict_noopen', 'too-large': 'ex_verdict_toolarge' }[verdict]))
      // console.warn on purpose: `orca plugin logs` keeps warnings and errors only, and it is the one channel an agent can read
      console.warn(`${pluginName}-export ${JSON.stringify({ state: 'ready', format: fmt, bytes: bytes.length, verdict: job.verdict, ms: Math.round(performance.now() - t0) })}`)
    } catch (e) {
      const why = e && e.message ? String(e.message).slice(0, 200) : String(e)
      const known = { no_recorder: 'ex_no_record', already_compressed: 'ex_already', no_encoder: 'ex_no_encoder' }
      if (e && e.message === 'cancelled') setResult('')
      else setResult(known[e && e.message] ? t(known[e.message]) : t('ex_error', { why }))
      console.warn(`${pluginName}-export ${JSON.stringify({ state: 'error', format: fmt, why })}`)
    } finally {
      busy = false
      ctx.requestRender() // a recording moved the camera: draw the view as it is again
      refresh()
    }
  }
  $('b-ex-make').onclick = make
  $('b-ex-cancel').onclick = () => {
    cancel = true
    if (taskCancel) taskCancel()
  }
  $('b-ex-save').onclick = async () => {
    const j = job
    if (!j || !j.bytes || busy) return
    try {
      const r = await ctx.saveBytes(j.name, j.mime, j.bytes)
      if (r && r.status === 'saved') setResult(t('ex_saved'))
    } catch (e) {
      setResult(t('ex_failed', { why: String((e && e.message) || e).slice(0, 160) }))
    }
  }
  // Toolbar: opens the export section (and the panel) and puts the focus on the format.
  $('b-export').onclick = () => {
    if (ctx.openExport) {
      // the page shows the export as a dialog over the view, not as a section of the side panel
      refresh()
      ctx.openExport()
      return
    }
    shell.setPanelOpen(true, false)
    shell.openSection('export-sec')
    refresh()
    $('ex-format').focus({ preventScroll: false })
    $('export-sec').scrollIntoView({ block: 'nearest' })
  }
  refresh()
  return { invalidate, refresh }
}

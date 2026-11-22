// STEP Viewer 3D: a read-only viewer for STEP (.step, .stp) files.
// The STEP file is read by occt-import-js (OpenCascade as WebAssembly, LGPL-2.1) in a background worker and drawn with
// three.js 0.187.0 (MIT). Everything is bundled in ./vendor; nothing is loaded from the network.
// Orca never gives an editor a file path, so the file arrives as bytes through orca.document.
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { initShell, installErrorGuard } from './shared/shell.js'
import { initStudioUi } from './shared/studio-ui.js'
import { keyAction } from './shared/keymap.js'
import { askConfirm, confirmOpen } from './shared/confirm-dialog.js'
import { createBackground } from './shared/background-three.js'
import { BG_MODES } from './shared/prefs-core.js'
import { buildChrome } from './shared/chrome-layout.js'
import { controlsState } from './shared/controls-core.js'
import { migratePrefs, isNewerPrefs, bgModeOf, withBg, defaultState, resetPrefs } from './shared/prefs-core.js'
import { createSelectionBox } from './shared/selection-three.js'
import { initPartCard } from './shared/part-card.js'
import * as S from './shared/tools-scene.js'
import { dragReducer, planOpen } from './shared/core.js'
import { suggestName, triangleCount, write3MF, writeGLB, writeOBJ, writePLY, writeSTL } from './shared/export.js'
import { collectParts as collectExportParts, renderPng } from './shared/export-three.js'
import { initExportUi } from './shared/export-ui.js'
import { runTask } from './shared/tools-run.js'
import { initToolsUi } from './shared/tools-ui.js'
import { brepEdges } from './edges.js'
import { createShading } from './shared/shading.js'
import { createMeasure } from './shared/measure-three.js'
import { createMeshOverlay } from './shared/mesh-overlay.js'
import { installMeasureInteraction } from './shared/measure-wire.js'
import { copyText, detailsText } from './shared/details.js'
import { createSessionStore, KEEP_MAX_BYTES } from './shared/session-store.js'
import { UNIT_METERS } from './shared/tools-scene.js'
import { fitDistance, summarizeParts, buildRows, clipPlane, converterParams, detectStepUnit, extOf, fileAxisToView, filterIndices, HARD_MAX_BYTES, isStartText, pickFile, stateLine, SUPPORTED_EXT, looksLikeStep, makeFormat, makeT, measureInfo, memoryEstimateGB, niceStep, partHue, pickLocale, planUnit, presetDirection, presetScale, WARN_BYTES } from './lib.js'

const $ = (id) => document.getElementById(id)
const CONVERTER_FAILED = 'converter_failed' // the code the worker sends; the page says it in the person's language
const locale = pickLocale(orca.locale || navigator.language)
const t = makeT(locale)
const F = makeFormat(locale)
document.documentElement.lang = locale
for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n)
for (const el of document.querySelectorAll('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle)
for (const el of document.querySelectorAll('[data-i18n-aria]')) el.setAttribute('aria-label', t(el.dataset.i18nAria))
for (const el of document.querySelectorAll('[data-i18n-ph]')) el.placeholder = t(el.dataset.i18nPh)

// Lets tests and tooling see what the viewer is doing without reading the DOM text.
function setStateAttr(v) {
  document.documentElement.dataset.state = v
  if (document.body) document.body.dataset.state = v
}
setStateAttr('waiting')

// Remembered choices (best effort: storage can be unavailable in a frame)
const PREF_KEY = 'step-viewer-3d.v2'
let prefs = {}
try {
  prefs = JSON.parse(localStorage.getItem(PREF_KEY) || '{}') || {}
} catch {}
const newerPrefs = isNewerPrefs(prefs)
prefs = migratePrefs(prefs) // one version field, one background model (an older record keeps its keys)
if (!newerPrefs) savePrefs() // stored at once, so the record on disk has its version (a newer record is not touched)
function savePrefs() {
  if (newerPrefs) return // written by a newer version: not overwritten
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify(prefs))
  } catch {}
}

const WARN_TRIS = 1_500_000
const MAX_ROWS = 1000
const DEFAULT_COLOR = 0xb9c0cb

const state = {
  up: prefs.up || 'z',
  quality: ['coarse', 'normal', 'fine'].includes(prefs.quality) ? prefs.quality : 'normal',
  wire: false,
  edges: true, // the CAD edges are on by default (the concept's standard); a file's remembered view keeps its own choice
  grid: true,
  axes: true,
  box: false,
  over: false, // the mesh lines over the surface (Appearance > Advanced)
  back: true,
  tint: false,
  shading: 'original',
  opacity: 1,
  clip: { axis: '', t: 0.5, flip: false },
  measure: false
}
$('quality').value = state.quality
$('up').value = state.up

// ---------- renderer / scene ----------
const canvas = $('gl')
let renderer
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' }) // alpha: a PNG with a transparent background
} catch (e) {
  setStateAttr('error')
  setMsg(t('gl_unavailable'), true)
  throw new Error('WebGL is not available') // nothing can be drawn; the message above is what the person sees
}
renderer.localClippingEnabled = true
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 1000)
camera.up.set(0, 1, 0)
scene.add(camera)
let studioUiRef = null // the studio ui, once it exists (the background asks it for the look's own)
const bgModel = createBackground({ scene, canvas, studio: () => studioUiRef, themeDark: () => document.documentElement.classList.contains('dark') })
bgModel.set(bgModeOf(prefs)) // one model for both viewers: look, orca, light, dark, white, gradient, transparent
const hemisphere = new THREE.HemisphereLight(0xffffff, 0x8a8a8a, 1.6)
scene.add(hemisphere)
const headlight = new THREE.DirectionalLight(0xffffff, 1.8)
headlight.position.set(0.3, 0.6, 1)
headlight.target.position.set(0, 0, -1)
camera.add(headlight, headlight.target)

const controls = new OrbitControls(camera, canvas)
controls.screenSpacePanning = true
controls.zoomToCursor = true
controls.enableDamping = false
canvas.tabIndex = 0
canvas.setAttribute('role', 'img')
canvas.setAttribute('aria-label', t('canvas_label'))
controls.listenToKeyEvents(canvas) // arrow keys pan when the view has focus

const spinRoot = new THREE.Group() // the studio's turntable turns this (it holds the model's root)
spinRoot.name = 'spin'
scene.add(spinRoot)
const modelRoot = new THREE.Group()
spinRoot.add(modelRoot)
let studioUi = null
let lastPreset = null // the look chosen last (not counting edits)
let syncLooks = null // marks the chosen look tile
const helpers = new THREE.Group()
scene.add(helpers)
// "Mesh over the surface": a line object per mesh, in the helpers (not in the model: exports and part numbers never see it)
const meshOver = createMeshOverlay({ THREE, parent: helpers, getMeshes: () => parts.flatMap((p) => { const r = []; if (p.obj) p.obj.traverse((o) => o.isMesh && r.push(o)); return r }) })
meshOver.install(scene)
if (typeof window.__mv3dHook === 'function') window.__mv3dHook({ renderer, scene, camera, controls, get parts() { return parts }, get rows() { return rows }, get measure() { return measure }, get helpers() { return helpers }, get modelRoot() { return modelRoot }, get chrome() { return chrome }, get state() { return state } }) // test tooling only

// A lost WebGL context (GPU reset, too many contexts) is recoverable: three.js re-uploads what it needs after restore.
let glLost = false
canvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault()
  glLost = true
  setMsg(t('gl_lost'), true)
})
canvas.addEventListener('webglcontextrestored', () => {
  glLost = false
  if ($('msg-text').textContent === t('gl_lost')) {
    // only take our own message down; a load error or the memory gate that came since stays
    if (model) hideMsg()
    else setMsg(t('waiting'))
  }
  requestRender()
})
// Free GPU memory and stop the converter when the tab closes or the editor is replaced.
window.addEventListener('pagehide', () => {
  if (studioUi) studioUi.studio.dispose()
  stopJob()
  dropWorker(warm)
  disposeModel()
  renderer.dispose()
})

let wantRender = false
function requestRender() {
  if (wantRender || glLost) return
  wantRender = true
  requestAnimationFrame(() => {
    wantRender = false
    renderer.render(scene, camera)
  })
}
controls.addEventListener('change', requestRender)
// The view is the #stage element: its size follows the window, the side panel and the toolbar (layout in shared/shell.js).
function resize() {
  const s = $('stage')
  const w = Math.max(1, s.clientWidth)
  const h = Math.max(1, s.clientHeight)
  renderer.setSize(w, h, false)
  camera.aspect = w / h
  camera.updateProjectionMatrix()
  requestRender()
}
// Controls that need a model are disabled (not hidden) until one is shown, so the toolbar does not jump when a file loads.
function setHasModel(has) {
  document.body.classList.toggle('has-model', has)
  for (const el of document.querySelectorAll('[data-needs-model]')) el.disabled = !has
}

// ---------- model state ----------
let model = null
let parts = [] // one per converter mesh: { obj, tris, verts, faces, name, orig, tint, visible }
let rows = [] // list rows from the assembly tree
const size = new THREE.Vector3()
const center = new THREE.Vector3()
let diag = 1
let boundsBox = new THREE.Box3()
let allMaterials = new Set()
let unitInfo = { short: 'mm', label: '' }
let chrome = null // the toolbar and tabs (chrome-layout.js)
let multiSelect = false // "Select several": every click adds a part (no key needed)
let selectedRow = -1 // the list row chosen last (the main one), -1: none
const selRows = new Set() // every selected row (a node of the tree stands for all the meshes below it)
let partCard = null
const selFrame = createSelectionBox(helpers)
let firstFrame = true
let lastStats = null
const shading = createShading()
const solidMat = shading.solid
const normalMat = shading.normals
const clipPlane3 = new THREE.Plane()

function setMsg(text, isErr = false) {
  if (isErr) setStateAttr('error')
  $('msg-text').textContent = text
  $('msg').className = 'msg' + (isErr ? ' err' : '')
}
const hideMsg = () => {
  $('msg').className = 'msg hide'
  setStateAttr('ok')
}

function disposeModel() {
  if (chrome) chrome.resetMulti() // "Select several" is off again for the next file
  measure.clearAll() // the measurements belong to the file
  if (!model) return
  modelRoot.remove(model)
  model.traverse((o) => o.geometry && o.geometry.dispose())
  for (const m of allMaterials) m.dispose()
  allMaterials = new Set()
  parts = []
  rows = []
  model = null
  selectedRow = -1
  selRows.clear()
  selFrame.set(null)
  if (partCard) partCard.update() // no card without a model
  updateControls()
}

const PLUGIN_NAME = 'step-viewer-3d'
// What is being opened: set before acceptBytes; the record in `current` carries it on. 'editor' = Orca opened the file;
// 'drop', 'picker', 'paste' = the user did. Orca gives editors no file name, so only those have one.
let incoming = { name: '', source: 'editor' }
let prevCurrent = null // the record of the model on screen while another file is being read
let pendingIgnored = 0 // "n more files were ignored", shown once the new model is up

// A load that fails: a file the user opened with a model on screen leaves that model alone and says why; otherwise the error replaces the view.
function reject(text) {
  pendingIgnored = 0
  if (incoming.source !== 'editor' && model) {
    if (prevCurrent) {
      current = prevCurrent
      prevCurrent = null
    }
    if (lastStats) {
      state.quality = lastStats.quality // the model on screen was built with this one
      $('quality').value = state.quality
    }
    console.error(`${PLUGIN_NAME}: ${text.split('\n')[0]}`)
    showStart(text, true)
    setStateAttr('ok')
    return
  }
  if (incoming.source !== 'editor') current = null // free the bytes of a file that could not be shown
  fail(text)
}
function fail(text) {
  disposeModel()
  setHasModel(false)
  $('busy').hidden = true
  $('stats-sec').hidden = true
  $('sec-sec').hidden = true
  $('part-sec').hidden = true
  setMsg(text, true)
  if (incoming.source !== 'editor') showStart(text, true) // a dropped or picked file that fails with nothing on screen: the drop page says why and takes the next file
  console.error(`${PLUGIN_NAME}: ${text.split('\n')[0]}`)
  requestRender()
}

// ---------- reading a file ----------
let current = null // { bytes: Uint8Array, seq }
let job = null // { worker | null, timer, seq }
let loadSeq = 0

// One converter worker is warmed up when the editor opens, so loading the WebAssembly overlaps with the file's arrival.
// A worker serves one read and is then dropped: the converter's memory only grows, so a fresh worker frees it all.
let warm = null // { worker, ready: boolean } or null
function spawnWorker() {
  try {
    const w = new Worker('./step-worker.js')
    const rec = { worker: w, ready: false, failed: false }
    w.onmessage = (ev) => {
      if (ev.data.type === 'ready') rec.ready = true
      else if (ev.data.type === 'error' && !rec.ready && !rec.reading) {
        rec.failed = true // the converter could not start in this worker: the page fallback gets a try
        if (job && job.worker === w) job.onFail()
      } else if (job && job.worker === w) {
        if (ev.data.type === 'reading') rec.reading = true
        job.onMsg(ev.data)
      }
    }
    w.onerror = (ev) => {
      if (ev.preventDefault) ev.preventDefault()
      rec.failed = true
      if (job && job.worker === w) job.onFail()
    }
    w.postMessage({ type: 'init' })
    return rec
  } catch {
    return null
  }
}
function takeWorker() {
  if (warm && warm.failed) dropWorker(warm)
  const rec = warm && !warm.failed ? warm : spawnWorker()
  warm = null
  return rec
}
function dropWorker(rec) {
  if (rec && rec.worker) rec.worker.terminate()
}
warm = typeof orca.document === 'object' && orca.document ? spawnWorker() : null // a panel has no file coming: start the worker when one is chosen

function stopJob() {
  if (!job) return
  clearInterval(job.timer)
  dropWorker(job.rec)
  job = null
}

function showBusy(on) {
  $('busy').hidden = !on
  if (on) $('msg').className = 'msg hide' // not hideMsg(): that would report state "ok" while the converter runs
}

function startRead() {
  if (!current) return
  stopJob()
  setStateAttr('loading')
  $('gate').hidden = true
  current.confirmed = true
  if (state.quality === 'fine') current.fineConfirmed = true
  const seq = current.seq
  const bytes = current.bytes
  const rec0 = current
  const unit = planUnit(detectStepUnit(bytes))
  const qualityAtStart = state.quality
  const params = converterParams(qualityAtStart, unit.linearUnit)
  const t0 = performance.now()
  const rec = takeWorker()
  const me = { rec, worker: rec ? rec.worker : null, timer: 0, seq, onMsg: null, onFail: null }
  job = me
  showBusy(true)
  $('busy-text').textContent = t('starting')
  $('busy-hint').textContent = t('reading_hint')
  me.timer = setInterval(() => {
    if (job === me) $('busy-text').textContent = t('reading', { s: ((performance.now() - t0) / 1000).toFixed(0) })
  }, 500)
  const onDone = (msg) => {
    if (job !== me) return
    stopJob()
    showBusy(false)
    if (msg.type === 'error') return reject(t('cannot_read', { size: F.mb(bytes.byteLength), why: msg.message === CONVERTER_FAILED ? t('converter_failed') : msg.message }))
    buildModel({ ...msg, quality: qualityAtStart }, unit, bytes.byteLength, rec0)
  }
  if (!rec) return readInPage(me, bytes, params, t0, onDone)
  let started = false
  me.onMsg = (m) => {
    if (m.type === 'reading') {
      started = true
      $('busy-text').textContent = t('reading', { s: ((performance.now() - t0) / 1000).toFixed(0) })
    } else onDone(m)
  }
  me.onFail = () => {
    if (job !== me) return
    if (!started) return readInPage(me, bytes, params, t0, onDone) // the worker could not start: use the page
    stopJob()
    reject(t('worker_failed'))
  }
  if (rec.failed) return me.onFail()
  const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) // the worker gets its own copy; ours stays for a re-read
  rec.worker.postMessage({ type: 'read', buffer: copy, params }, [copy])
}

let pageOcct = null
// Fallback when no worker can be started: the same converter on the page's thread.
function readInPage(me, bytes, params, t0, onDone) {
  dropWorker(me.rec)
  me.rec = null
  me.worker = null
  $('busy-hint').textContent = t('no_worker')
  const run = async () => {
    try {
      if (!window.occtimportjs) {
        await new Promise((resolve, reject) => {
          const s = document.createElement('script')
          s.src = './vendor/occt/occt-import-js.js'
          s.onload = resolve
          s.onerror = () => reject(new Error('converter script not available'))
          document.head.append(s)
        })
      }
      pageOcct ??= (async () => {
        // the WebAssembly is a plain file; one instance for all page-thread reads
        const r = await fetch('./vendor/occt/occt-import-js.wasm')
        if (!r.ok) throw new Error('converter file not available')
        const wasmBinary = new Uint8Array(await r.arrayBuffer())
        return window.occtimportjs({ wasmBinary })
      })()
      const occt = await pageOcct
      await new Promise((r) => setTimeout(r, 50)) // let the busy message paint
      const r = occt.ReadStepFile(new Uint8Array(bytes), params)
      if (!r || !r.success) return onDone({ type: 'error', message: CONVERTER_FAILED })
      const meshes = r.meshes.map((m) => ({
        name: m.name || '',
        color: m.color || null,
        faces: (m.brep_faces || []).map((f) => ({ first: f.first, last: f.last, color: f.color || null })),
        position: new Float32Array(m.attributes.position.array),
        normal: m.attributes.normal ? new Float32Array(m.attributes.normal.array) : null,
        index: new Uint32Array(m.index.array)
      }))
      onDone({ type: 'done', ms: performance.now() - t0, wasmMB: occt.HEAP8 ? occt.HEAP8.length / 1e6 : 0, root: r.root || null, meshes })
    } catch (e) {
      onDone({ type: 'error', message: String((e && e.message) || e).slice(0, 300) })
    }
  }
  run()
}

// ---------- building the view ----------
function srgb(c) {
  return new THREE.Color().setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace)
}

function buildModel(msg, unit, fileBytes, rec) {
  const t0 = performance.now()
  if (!msg.meshes.length) return reject(t('no_shapes'))
  const group = new THREE.Group()
  const newParts = []
  msg.meshes.forEach((m, i) => {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(m.position, 3))
    geo.setIndex(new THREE.BufferAttribute(m.index, 1))
    if (m.normal && m.normal.length === m.position.length) geo.setAttribute('normal', new THREE.BufferAttribute(m.normal, 3))
    else geo.computeVertexNormals()
    const base = m.color ? srgb(m.color) : new THREE.Color(DEFAULT_COLOR)
    const colored = m.faces.some((f) => f.color)
    if (colored) {
      // faces can carry their own colors: paint the vertices of each colored face's triangles
      const col = new Float32Array(m.position.length)
      for (let v = 0; v < m.position.length / 3; v++) col.set([base.r, base.g, base.b], v * 3)
      for (const f of m.faces) {
        if (!f.color) continue
        const c = srgb(f.color)
        for (let tri = f.first; tri <= f.last; tri++) {
          for (let k = 0; k < 3; k++) {
            const v = m.index[tri * 3 + k]
            col[v * 3] = c.r
            col[v * 3 + 1] = c.g
            col[v * 3 + 2] = c.b
          }
        }
      }
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
    }
    const mat = new THREE.MeshStandardMaterial({ color: colored ? 0xffffff : base, vertexColors: colored, roughness: 0.55, metalness: 0.15 })
    if (!m.color && !colored) mat.userData.generic = true // the viewer's gray is not data of the model (exports leave it out)
    const mesh = new THREE.Mesh(geo, mat)
    mesh.name = m.name
    group.add(mesh)
    newParts.push({ obj: mesh, kind: 'mesh', name: m.name, tris: m.index.length / 3, verts: m.position.length / 3, faces: m.faces.length, ranges: m.faces, orig: mat, tint: null, visible: true, base })
  })
  for (const p of newParts) {
    p.rangesSig = geoSig(p.obj.geometry)
    p.rangesOrig = p.ranges
  } // the B-rep face ranges belong to these triangles; a tool that replaces them makes the ranges void
  // Check the new model BEFORE the old one goes away.
  const bb = new THREE.Box3()
  for (const p of newParts) {
    p.obj.geometry.computeBoundingBox()
    bb.union(p.obj.geometry.boundingBox)
  }
  if (bb.isEmpty() || ![bb.min.x, bb.min.y, bb.min.z, bb.max.x, bb.max.y, bb.max.z].every(Number.isFinite)) {
    group.traverse((o) => o.geometry && o.geometry.dispose())
    for (const p of newParts) p.orig.dispose()
    return reject(t('bad_coords'))
  }
  // A file the user opened is a new subject: fit the camera. A re-read of the same document keeps the view.
  const prevView = firstFrame || rec.source !== 'editor' ? null : { pos: camera.position.clone(), target: controls.target.clone() }
  prevCurrent = null // the new model replaces the old one: the old record is not needed any more
  disposeModel()
  model = group
  modelRoot.add(model)
  parts = newParts
  rows = buildRows(msg.root, msg.meshes.map((m) => m.name), (n) => t('part_n', { n }))
  collapsed.clear()
  allMaterials = new Set([...shading.shared, ...parts.map((p) => p.orig)])
  unitInfo = unit
  applyUp()
  fitBounds()
  if (!Number.isFinite(diag) || boundsBox.isEmpty()) return fail(t('bad_coords'))
  applyMaterialFlags()
  buildHelpers()
  if (prevView) {
    camera.position.copy(prevView.pos)
    controls.target.copy(prevView.target)
    controls.update()
  } else {
    resetView()
    firstFrame = false
  }
  applyMaterials() // keeps "Color by part" and the shading after a re-read
  applyEdges() // and the edges, made again for the new parts
  updateClip()
  lastStats = { quality: msg.quality || state.quality, readMs: msg.ms, buildMs: performance.now() - t0, wasmMB: msg.wasmMB, fileBytes, name: rec.name, source: rec.source }
  buildStats()
  buildRowList()
  $('stats-sec').hidden = false
  $('sec-sec').hidden = false
  setStateAttr('ok')
  hideStart()
  logState()
  hideMsg()
  checkInfo = null
  if (toolsUi) toolsUi.modelChanged() // a new file: the old working copy is gone
  if (partCard) partCard.invalidate()
  invalidateExport()
  if (rec.source === 'restore' && pendingView) {
    applyView(pendingView)
    pendingView = null
    flash(t('keep_restored', { name: rec.name }))
  } else if (rec.source !== 'editor' && rec.source !== 'restore' && rec.name && rec.bytes) {
    // so it is still here when the panel is shown again
    rememberFile(rec.name, rec.bytes.byteOffset === 0 && rec.bytes.byteLength === rec.bytes.buffer.byteLength ? rec.bytes.buffer : rec.bytes.slice().buffer)
  }
  if (pendingIgnored > 0) {
    flash(t('drop_more', { n: pendingIgnored }))
    pendingIgnored = 0
  }
  requestRender()
}

// ---------- orientation, bounds, helpers ----------
function applyUp() {
  modelRoot.rotation.set(0, 0, 0)
  if (state.up === 'z') modelRoot.rotation.x = -Math.PI / 2
  modelRoot.updateMatrixWorld(true)
  $('up-hint').textContent = t(state.up === 'z' ? 'hint_z' : 'hint_y')
}

const fileSize = new THREE.Vector3()
function fitBounds() {
  if (studioUi) studioUi.studio.spin.stop() // bounds are measured with the model standing still
  modelRoot.updateMatrixWorld(true)
  boundsBox = new THREE.Box3()
  for (const p of parts) {
    p.obj.updateWorldMatrix(true, false)
    if (!p.obj.geometry.boundingBox) p.obj.geometry.computeBoundingBox()
    boundsBox.union(p.obj.geometry.boundingBox.clone().applyMatrix4(p.obj.matrixWorld))
  }
  boundsBox.getSize(size)
  boundsBox.getCenter(center)
  diag = Math.max(size.length(), 1e-6)
  const inv = modelRoot.matrixWorld.clone().invert()
  const fb = new THREE.Box3()
  for (const p of parts) fb.union(p.obj.geometry.boundingBox.clone().applyMatrix4(inv.clone().multiply(p.obj.matrixWorld)))
  fb.getSize(fileSize)
}

let gridObj = null
let axesObj = null
let boxObj = null
let gridStep = 1
function buildHelpers() {
  for (const o of [gridObj, axesObj, boxObj]) {
    if (o) {
      helpers.remove(o)
      o.geometry?.dispose()
      o.material?.dispose()
    }
  }
  const horiz = Math.max(size.x, size.z, diag * 0.1)
  gridStep = niceStep(horiz * 1.5)
  const cells = Math.min(200, Math.max(4, Math.ceil((horiz * 1.6) / gridStep / 2) * 2))
  gridObj = new THREE.GridHelper(cells * gridStep, cells, 0x888888, 0x888888)
  gridObj.position.set(center.x, boundsBox.min.y, center.z)
  gridObj.material.transparent = true
  gridObj.material.opacity = 0.35
  axesObj = new THREE.AxesHelper(diag * 0.12)
  axesObj.material.depthTest = false
  axesObj.renderOrder = 10
  boxObj = new THREE.Box3Helper(boundsBox, 0xe0a030)
  helpers.add(gridObj, axesObj, boxObj)
  applyHelperFlags()
  const far = diag * 40
  camera.near = Math.max(diag / 4000, 1e-6)
  camera.far = far
  camera.updateProjectionMatrix()
  controls.maxDistance = far * 0.8
  controls.minDistance = diag / 2000
  if (studioUi) studioUi.refresh() // floor level, lights and shadows follow the model
}

// ---------- edges ----------
// CAD edges (where two B-rep faces meet), made from the converter's face ranges the first time they are asked for.
let edgeMat = null
const edgeColor = () => (effectiveDark() ? 0xe6e9ef : 0x15181d)
const EDGES_MAX_TRIANGLES = 6_000_000 // above this a part gets no edges: the work and its memory would freeze the page
const geoSig = (geo) => {
  const pos = geo.getAttribute('position')
  return `${geo.uuid}:${pos.count}:${pos.version}:${geo.index ? geo.index.count : 0}`
}
// the face ranges are only good for the triangles they were made with
function rangesOf(p) {
  // good while the triangles are the ones they were made for (also again after "Back to the file")
  return p.rangesOrig && p.rangesSig === geoSig(p.obj.geometry) ? p.rangesOrig : null
}
function ensureEdges() {
  if (!edgeMat) edgeMat = new THREE.LineBasicMaterial({ color: edgeColor() })
  let skipped = 0
  for (const p of parts) {
    if (p.edgeObj !== undefined) continue
    const geo = p.obj.geometry
    let seg = new Float32Array(0)
    try {
      if (!geo.index || geo.index.count / 3 > EDGES_MAX_TRIANGLES) skipped++
      else if (rangesOf(p) && rangesOf(p).length) seg = brepEdges(geo.getAttribute('position').array, geo.index.array, rangesOf(p))
      else seg = angleEdges(geo) // the faces are not known (a tool changed the part): the sharp edges instead
    } catch {
      skipped++ // out of memory or the like: this part goes without edges
    }
    p.edgeSig = geoSig(geo)
    if (!seg.length) {
      p.edgeObj = null
      continue
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(seg, 3))
    const lines = new THREE.LineSegments(g, edgeMat)
    lines.renderOrder = 1
    p.obj.add(lines) // a child of the part: hidden with it, moved with it
    p.edgeObj = lines
  }
  if (skipped) flash(t('edges_skipped', { n: skipped }))
}
// Edges from the angle between triangles (30 degrees), for a part whose B-rep faces are no longer known.
function angleEdges(geo) {
  const e = new THREE.EdgesGeometry(geo, 30)
  const arr = e.getAttribute('position').array.slice()
  e.dispose()
  return arr
}
function applyEdges() {
  if (state.edges && model) ensureEdges()
  for (const p of parts) if (p.edgeObj) p.edgeObj.visible = state.edges
  if (edgeMat) edgeMat.color.set(edgeColor())
  $('b-edges').setAttribute('aria-pressed', String(state.edges))
  applyMaterialFlags()
}
// After a tool: edges of a part whose shape was not touched (a move, a scale, a unit: the lines are children of the part and follow) stay;
// edges of a part whose triangles were replaced are made again, from the angle between triangles because its faces are not known any more.
function refreshEdges() {
  let changed = 0
  for (const p of parts) {
    if (p.edgeObj === undefined) continue
    if (p.edgeSig === geoSig(p.obj.geometry)) continue
    if (p.edgeObj) {
      p.obj.remove(p.edgeObj)
      p.edgeObj.geometry.dispose()
    }
    p.edgeObj = undefined
    changed++
  }
  if (changed && state.edges) {
    applyEdges()
    flash(t('edges_changed'))
  } else if (changed) applyEdges()
}

function applyHelperFlags() {
  if (gridObj) gridObj.visible = state.grid
  if (axesObj) axesObj.visible = state.axes
  if (boxObj) boxObj.visible = state.box
  // a background the person chose with the button (light, dark) stands before the studio look's; "like Orca" leaves it to the look
  bgModel.apply()
  if (gridObj) gridObj.material.color.set(effectiveDark() ? 0x6b7078 : 0x8b9098)
  if (edgeMat) edgeMat.color.set(edgeColor())
  $('b-grid').setAttribute('aria-pressed', String(state.grid))
  $('b-axes').setAttribute('aria-pressed', String(state.axes))
  $('b-box').setAttribute('aria-pressed', String(state.box))
}

/** "Default" in the Appearance menu: the looks and helpers go back to the standard values (not the view, not the studio, not the section). */
function resetAppearance() {
  if (!model) return
  const d = defaultState()
  state.tex = d.tex
  state.tint = d.tint
  $('l-color').setAttribute('aria-pressed', 'false')
  applyView({ grid: d.grid, axes: d.axes, box: d.box, over: d.over, back: d.back, shading: d.shading, opacity: d.opacity, edges: d.edges })
  applyTint()
  applyMaterialFlags()
  applyEdges()
  if (chrome) chrome.syncLook()
}

function resetView() {
  applyPreset('iso') // the start view: everything, seen from the corner
}

// ---------- details ----------
let checkInfo = null // watertight, volume and surface from the mesh check (looked up in the background after a load, or by "Check mesh")
function checkRows() {
  if (!checkInfo) return []
  const u = unitInfo.short
  const rows = [[t('row_watertight'), checkInfo.watertight ? t('yes') : t('no')]]
  if (checkInfo.watertight && checkInfo.volume != null) rows.push([t('row_volume'), F.vol(checkInfo.volume, u)])
  if (checkInfo.area) rows.push([t('row_area'), F.area(checkInfo.area, u)])
  if (checkInfo.inverted) rows.push([t('row_normals'), t('val_inward')])
  return rows
}
function buildStats() {
  const { tris, faces } = summarizeParts(parts)
  const u = unitInfo.short
  const unitName = t('u_' + unitInfo.linearUnit)
  const unitLabel =
    unitInfo.mode === 'file'
      ? t('unit_file', { name: unitName })
      : unitInfo.mode === 'tool'
        ? unitInfo.toolLabel
      : unitInfo.mode === 'converted'
        ? t('unit_converted', { name: unitName, orig: t('u_' + unitInfo.fileUnit) })
        : t('unit_default', { name: unitName })
  const rowsOut = [
    ...(lastStats.name ? [[t('s_name'), lastStats.name]] : []),
    [t('s_size'), F.mb(lastStats.fileBytes)],
    [t('s_parts'), F.int(parts.length)],
    [t('s_faces'), F.int(faces)],
    [t('s_triangles'), F.int(tris)],
    [t('s_extent'), `${F.len(fileSize.x)} × ${F.len(fileSize.y)} × ${F.len(fileSize.z)} ${u}`],
    [t('s_height'), `${F.len(boundsBox.min.y)} … ${F.len(boundsBox.max.y)} ${u}`],
    ...checkRows(),
    [t('s_grid'), `${F.len(gridStep)} ${u}`],
    [t('s_unit'), unitLabel],
    [t('s_quality'), t('q_' + lastStats.quality)],
    [t('s_read'), F.dur(lastStats.readMs)]
  ]
  if (lastStats.wasmMB) rowsOut.push([t('s_memory'), `${F.int(lastStats.wasmMB)} MB`])
  const dl = $('stats')
  dl.replaceChildren()
  $('stats-more').replaceChildren()
  const advanced = new Set([t('s_read'), t('s_memory'), t('s_height')]) // read time, converter memory, height range: one level down
  for (const [k, v] of rowsOut) {
    const dt = document.createElement('dt')
    dt.textContent = k
    const dd = document.createElement('dd')
    dd.textContent = v
    dd.title = v // the full value for anything the panel has to cut
    if (k === t('s_name')) dd.className = 'ell' // a file name stays on one line with an ellipsis
    ;(advanced.has(k) ? $('stats-more') : dl).append(dt, dd)
  }
  $('stats-adv').hidden = $('stats-more').children.length === 0
  const warn = []
  if (tris > WARN_TRIS) warn.push(t('warn_big_mesh', { n: F.int(tris) }))
  const w = $('warn')
  w.hidden = warn.length === 0
  w.replaceChildren(...warn.map((text) => Object.assign(document.createElement('div'), { textContent: text })))
  setHasModel(true)
}

// ---------- material flags ----------
function syncMeshOver() {
  meshOver.setClip(state.clip.axis ? [clipPlane3] : null)
  meshOver.setSuppressed(state.wire) // the mesh view already shows the lines
  meshOver.setOpacity(state.opacity)
  meshOver.set(state.over)
  $('b-over').setAttribute('aria-pressed', String(state.over))
  requestRender()
}
function applyMaterialFlags() {
  for (const m of allMaterials) {
    m.wireframe = state.wire
    const side = m.userData.keepSide ? m.side : state.back ? THREE.DoubleSide : THREE.FrontSide
    if (m.side !== side) {
      m.side = side
      m.needsUpdate = true // only a changed side needs a new shader; sliders must stay cheap
    }
    const x = m === shading.xray // the X-ray material is see-through by itself
    m.transparent = x || state.opacity < 1
    m.opacity = x ? 0.28 * state.opacity : state.opacity
    m.depthWrite = x ? false : state.opacity >= 1
    m.clippingPlanes = state.clip.axis ? [clipPlane3] : null
    // with the edges on, the surfaces sit a little behind them, so the lines are not eaten by the faces they lie on
    m.polygonOffset = state.edges || state.over
    m.polygonOffsetFactor = 1
    m.polygonOffsetUnits = 1
  }
  if (edgeMat) edgeMat.clippingPlanes = state.clip.axis ? [clipPlane3] : null
  syncMeshOver()
  $('b-wire').setAttribute('aria-pressed', String(state.wire))
  const wireLabel = t(state.wire ? 'mesh' : 'surface') // one button: its label is the state, its tooltip names what a click does
  if ($('b-wire').textContent !== wireLabel) {
    $('b-wire').textContent = wireLabel
    shell.layout() // the label changed length (not on every slider tick)
  }
  $('b-wire').title = t(state.wire ? 'tip_surface_on' : 'tip_mesh_on')
  $('b-back').setAttribute('aria-pressed', String(state.back))
  updateControls()
  requestRender()
}
/** Which control works, from the one table in controls-core.js. */
function updateControls() {
  const c = controlsState({ kind: model ? 'mesh' : 'none', partCount: parts.length, step: true, shading: state.shading, selection: selRows.size })
  if (chrome) chrome.setFileKind(model ? 'mesh' : 'none')
  if (chrome) chrome.update(c, { hasModel: !!model, kind: model ? 'mesh' : 'none', studioActive: !!(studioUi && studioUi.isActive()), selectedName: selectedRow >= 0 && rows[selectedRow] ? rows[selectedRow].name : null })
  syncMeasureBar()
  const tint = $('l-color')
  tint.disabled = !c.tint.enabled && c.tint.visible
  tint.title = c.tint.reason ? t(c.tint.reason) : t('tip_color_by_part')
}

// ---------- parts list ----------
function materialFor(p, i) {
  const sh = shading.forPart(state.shading, p, (m) => allMaterials.add(m))
  if (sh) return sh
  if (!state.tint) return p.orig
  if (!p.tint) {
    p.tint = p.orig.clone()
    p.tint.vertexColors = false
    p.tint.color.setHSL(partHue(i), 0.62, 0.55, THREE.SRGBColorSpace)
    allMaterials.add(p.tint)
  }
  return p.tint
}

function applyMaterials() {
  parts.forEach((p, i) => {
    p.obj.material = materialFor(p, i)
  })
  applyMaterialFlags()
  buildRowList()
}
function applyTint() {
  applyMaterials()
}

function rowSwatch(r) {
  const p = parts[r.meshes[0]]
  const c = state.tint && p.tint ? p.tint.color : p.base
  return '#' + c.getHexString(THREE.SRGBColorSpace)
}

function rowVisibility(r) {
  const vis = r.meshes.filter((i) => parts[i].visible).length
  return vis === 0 ? 0 : vis === r.meshes.length ? 2 : 1 // none, some, all
}

function updateVisibleCount() {
  const vis = parts.filter((p) => p.visible).length
  $('part-count').textContent = t('parts_visible', { v: vis, n: parts.length })
}

const collapsed = new Set() // indices of group rows that are folded
function buildRowList() {
  updateControls()
  $('part-sec').hidden = parts.length < 2
  const partsOpt = $('measure-mode').querySelector('option[value="parts"]')
  partsOpt.hidden = parts.length < 2
  if (parts.length < 2 && state.measureMode === 'parts') {
    state.measureMode = 'distance'
    $('measure-mode').value = 'distance'
  }
  if (parts.length < 2) return
  const box = $('parts')
  box.replaceChildren()
  $('filter').hidden = rows.length < 8
  const shown = filterIndices(rows.map((r) => r.name), $('filter').hidden ? '' : $('filter').value)
  if (shown.length === 0) box.append(Object.assign(document.createElement('div'), { className: 'hint more', textContent: t('filter_none') }))
  // a collapsed group hides the rows below it (deeper, until a row of its own depth or less comes); a filter shows every match whatever is collapsed
  const filtering = !$('filter').hidden && $('filter').value.trim() !== ''
  let hideBelow = Infinity
  const visibleRows = shown.filter((i) => {
    const r = rows[i]
    if (filtering) return true
    if (r.depth <= hideBelow) hideBelow = Infinity
    if (r.depth > hideBelow) return false
    if (r.group && collapsed.has(i)) hideBelow = r.depth
    return true
  })
  visibleRows.slice(0, MAX_ROWS).forEach((i) => {
    const r = rows[i]
    const row = document.createElement('div')
    const vis = rowVisibility(r)
    row.className = 'part' + (vis === 0 ? ' off' : '') + (selRows.has(i) ? ' sel' : '') + (r.group ? ' group' : '')
    row.dataset.i = String(i)
    row.style.setProperty('--d', String(Math.min(r.depth, 8)))
    const cb = document.createElement('input')
    cb.type = 'checkbox'
    cb.checked = vis === 2
    cb.indeterminate = vis === 1
    cb.setAttribute('aria-label', t('visible_label', { name: r.name }))
    const sw = document.createElement('span')
    sw.className = 'sw'
    sw.style.background = rowSwatch(r)
    const nm = document.createElement('span')
    nm.className = 'nm'
    nm.style.setProperty('--d', String(Math.min(r.depth, 8)))
    const kids = r.group && rows[i + 1] && rows[i + 1].depth > r.depth
    // a group with rows below has a fold button; every other row only a blank of the same width (not a button: a screen reader would read "button")
    const foldable = kids && !filtering
    const tw = document.createElement(foldable ? 'button' : 'span')
    tw.className = 'tw'
    if (foldable) {
      tw.type = 'button'
      tw.textContent = collapsed.has(i) ? '▸' : '▾'
      tw.setAttribute('aria-label', t(collapsed.has(i) ? 'row_expand' : 'row_collapse', { name: r.name }))
      tw.setAttribute('aria-expanded', String(!collapsed.has(i)))
    } else tw.setAttribute('aria-hidden', 'true')
    nm.textContent = r.name
    nm.title = r.name
    const tr = document.createElement('span')
    tr.className = 'tr'
    tr.textContent = F.int(r.meshes.reduce((a, k) => a + parts[k].tris, 0)) + ' △'
    row.append(cb, sw, tw, nm, tr)
    box.append(row)
  })
  if (visibleRows.length > MAX_ROWS) {
    const more = document.createElement('div')
    more.className = 'hint more'
    more.textContent = t('parts_more', { n: F.int(visibleRows.length - MAX_ROWS), max: MAX_ROWS })
    box.append(more)
  }
  updateVisibleCount()
}

function setVisible(indices, v, notify = true) {
  for (const i of indices) {
    parts[i].visible = v
    parts[i].obj.visible = v
  }
  if (notify) invalidateExport()
}
function setAllVisible(fn) {
  parts.forEach((p, i) => setVisible([i], fn(p, i), false))
  invalidateExport() // once, not per part
  buildRowList()
  requestRender()
}

$('parts').addEventListener('change', (e) => {
  const rowEl = e.target.closest('.part')
  if (!rowEl) return
  const idx = rowEl.dataset.i
  setVisible(rows[Number(idx)].meshes, e.target.checked)
  buildRowList()
  const again = document.querySelector(`.part[data-i="${idx}"] input`)
  if (again) again.focus() // the rebuild replaced the row: keep keyboard users where they were
  requestRender()
})
$('parts').addEventListener('click', (e) => {
  const rowEl = e.target.closest('.part')
  if (!rowEl || e.target.tagName === 'INPUT') return
  if (e.target.closest('button.tw')) {
    const k = Number(rowEl.dataset.i)
    if (collapsed.has(k)) collapsed.delete(k)
    else collapsed.add(k)
    buildRowList()
    const again = document.querySelector(`.part[data-i="${k}"] .tw`)
    if (again) again.focus() // the rebuild replaced the row: keyboard users stay on the button
    return
  }
  selectRow(Number(rowEl.dataset.i), false, e.shiftKey ? 'range' : e.metaKey || e.ctrlKey || multiSelect ? 'toggle' : 'replace')
})
$('parts').addEventListener('dblclick', (e) => {
  const rowEl = e.target.closest('.part')
  if (!rowEl || e.target.closest('button.tw') || e.target.tagName === 'INPUT') return // the fold button and the checkbox are not "show only this"
  const k = Number(rowEl.dataset.i)
  const keep = new Set(rows[k].meshes)
  setAllVisible((_, i) => keep.has(i))
  selectRow(k, false)
})
$('l-all').onclick = () => setAllVisible(() => true)
$('l-none').onclick = () => setAllVisible(() => false)
$('l-inv').onclick = () => setAllVisible((p) => !p.visible)
$('l-color').onclick = () => {
  state.tint = !state.tint
  $('l-color').setAttribute('aria-pressed', String(state.tint))
  applyTint()
}

/**
 * Select rows of the tree. mode 'replace': this row only (the same row again clears); 'toggle': add it or take it out (Ctrl or Cmd click);
 * 'range': from the main row to this one (Shift click in the list). i = -1 clears. A node selects all the meshes below it.
 */
function selectRow(i, scroll, mode = 'replace') {
  // a row inside a folded group is shown by unfolding the groups above it
  if (i > 0 && rows[i]) {
    let need = rows[i].depth
    let changed = false
    for (let k = i - 1; k >= 0 && need > 0; k--) {
      if (rows[k].depth < need) {
        need = rows[k].depth
        if (collapsed.delete(k)) changed = true
      }
    }
    if (changed) buildRowList()
  }
  if (i < 0 || !rows[i]) {
    selRows.clear()
    selectedRow = -1
  } else if (mode === 'toggle') {
    if (selRows.has(i)) {
      selRows.delete(i)
      if (selectedRow === i) selectedRow = selRows.size ? [...selRows][selRows.size - 1] : -1
    } else {
      selRows.add(i)
      selectedRow = i
    }
  } else if (mode === 'range' && selectedRow >= 0) {
    for (let k = Math.min(selectedRow, i); k <= Math.max(selectedRow, i); k++) selRows.add(k)
  } else if (selRows.size === 1 && selRows.has(i) && !scroll) {
    selRows.clear() // the only selected row again: gone
    selectedRow = -1
  } else {
    selRows.clear()
    selRows.add(i)
    selectedRow = i
  }
  syncSelection(scroll)
}
/** The mesh indices (into `parts`) of everything selected. */
function selectedIndices() {
  const set = new Set()
  for (const r of selRows) if (rows[r]) for (const k of rows[r].meshes) set.add(k)
  return [...set].sort((a, b) => a - b)
}
function selectionBox3() {
  const b = new THREE.Box3()
  for (const k of selectedIndices()) {
    const p = parts[k]
    p.obj.updateWorldMatrix(true, false)
    if (!p.obj.geometry.boundingBox) p.obj.geometry.computeBoundingBox()
    b.union(p.obj.geometry.boundingBox.clone().applyMatrix4(p.obj.matrixWorld))
  }
  return b
}
function syncSelection(scroll) {
  for (const r of [...selRows]) if (!rows[r]) selRows.delete(r)
  if (selectedRow >= 0 && !selRows.has(selectedRow)) selectedRow = selRows.size ? [...selRows][selRows.size - 1] : -1
  selFrame.set(selRows.size ? selectionBox3() : null) // a dashed blue box around everything selected
  document.querySelectorAll('.part').forEach((r) => r.classList.toggle('sel', selRows.has(Number(r.dataset.i))))
  if (scroll && selectedRow >= 0) {
    const r = document.querySelector(`.part[data-i="${selectedRow}"]`)
    if (r) r.scrollIntoView({ block: 'nearest' })
  }
  if (partCard) partCard.update()
  updateControls() // the info tab names the selection
  requestRender()
}
// F: fit the view to the selection, or to everything; I: show only the selected parts (Shift+I: all again)
function fitView() {
  if (!model) return
  if (!selRows.size) return resetView()
  modelRoot.updateMatrixWorld(true)
  const box = selectionBox3()
  const c = box.getCenter(new THREE.Vector3())
  const d = Math.max(box.getSize(new THREE.Vector3()).length(), diag * 0.02) * 1.3
  const dir = camera.position.clone().sub(controls.target).normalize()
  controls.target.copy(c)
  camera.position.copy(c).addScaledVector(dir, d)
  controls.update()
  requestRender()
}
function isolateSelected(all) {
  if (!parts.length) return
  if (all || !selRows.size) setAllVisible(() => true)
  else {
    const keep = new Set(selectedIndices())
    setAllVisible((_, i) => keep.has(i))
  }
}

// A click in the view picks the most specific list row that contains the mesh under the cursor.
const ray = new THREE.Raycaster()
// A ray ignores clipping planes: skip hits on the cut-away side so measuring and picking only see what is drawn.
function pickHit(objs) {
  const hits = ray.intersectObjects(objs, false)
  return state.clip.axis ? hits.find((h) => clipPlane3.distanceToPoint(h.point) >= 0) : hits[0]
}
let down = null
canvas.addEventListener('pointerdown', (e) => {
  down = { x: e.clientX, y: e.clientY, t: performance.now() }
})
canvas.addEventListener('pointerup', (e) => {
  if (!down || !model) return
  const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y)
  const quick = performance.now() - down.t < 500
  down = null
  if (moved > 4 || !quick || e.button !== 0) return
  if (!state.measure && parts.length < 2) return
  const r = canvas.getBoundingClientRect()
  ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1)), camera)
  const hit = pickHit(parts.filter((p) => p.visible).map((p) => p.obj))
  if (state.measure) {
    if (hit) measure.add(hit)
    return
  }
  if (!hit) return multiSelect ? undefined : selectRow(-1, false) // a click on nothing does not clear while choosing several
  const k = parts.findIndex((p) => p.obj === hit.object)
  let best = -1
  rows.forEach((row, i) => {
    if (row.meshes.includes(k) && (best < 0 || row.meshes.length < rows[best].meshes.length)) best = i
  })
  selectRow(best, true, e.metaKey || e.ctrlKey || e.shiftKey || multiSelect ? 'toggle' : 'replace')
})

// ---------- section plane ----------
function updateClip() {
  const c = state.clip
  $('sec-pos').disabled = !c.axis
  $('sec-flip').disabled = !c.axis
  if (c.axis && model) {
    // the axes are the file's own: map them through the "up is" rotation
    const m = fileAxisToView(c.axis, state.up)
    const tt = m.sign < 0 ? 1 - c.t : c.t
    const pl = clipPlane(m.axis, tt, [boundsBox.min.x, boundsBox.min.y, boundsBox.min.z], [boundsBox.max.x, boundsBox.max.y, boundsBox.max.z], m.sign < 0 ? !c.flip : c.flip)
    clipPlane3.set(new THREE.Vector3(...pl.normal), pl.constant)
  }
  applyMaterialFlags()
}
$('sec-axis').onchange = (e) => {
  state.clip.axis = e.target.value
  updateClip()
}
$('sec-pos').oninput = (e) => {
  state.clip.t = Number(e.target.value) / 100
  updateClip()
}
$('sec-flip').onchange = (e) => {
  state.clip.flip = e.target.checked
  updateClip()
}

// ---------- appearance ----------
$('shading').onchange = (e) => {
  state.shading = e.target.value
  applyMaterials()
  updateControls()
  scheduleViewSave()
}
$('opacity').oninput = (e) => {
  state.opacity = Number(e.target.value) / 100
  $('opacity-out').textContent = e.target.value
  applyMaterialFlags()
}

// ---------- measuring ----------
// The tool itself (markers, lines, the modes) is shared/measure-three.js; here: where its text goes and what clears it.
state.measureMode = 'distance'
function showMeasureText(lines, isHint = true) {
  const out = $('measure-out')
  out.hidden = false
  out.className = isHint && lines.length <= 2 ? 'chip hint' : 'chip'
  out.replaceChildren(...lines.map((text) => Object.assign(document.createElement('div'), { textContent: text })))
}
let measureTab = null
const measure = createMeasure({
  t,
  locale,
  modelRoot,
  camera,
  canvas,
  stage: $('stage'),
  onChange: () => {
    if (measureTab) measureTab.render()
    syncMeasureBar()
  },
  getDiag: () => diag,
  unitShort: () => unitInfo.short,
  fmtLen: F.len,
  // the CAD edges of the part that was hit (where two B-rep faces meet), made without showing them
  edgeSegments: (obj) => {
    const p = parts.find((q) => q.obj === obj)
    if (!p) return null
    if (p.edgeObj) return p.edgeObj.geometry.getAttribute('position').array
    const geo = obj.geometry
    if (p.measureEdges === undefined || p.measureSig !== geoSig(geo)) {
      p.measureSig = geoSig(geo)
      try {
        p.measureEdges = rangesOf(p) && rangesOf(p).length && geo.index && geo.index.count / 3 <= EDGES_MAX_TRIANGLES ? brepEdges(geo.getAttribute('position').array, geo.index.array, rangesOf(p)) : null
      } catch {
        p.measureEdges = null
      }
    }
    return p.measureEdges
  },
  showText: showMeasureText,
  // mode "parts": the middle of a part's box, and the smallest distance between two parts (a worker)
  partCentre: (o) => {
    const b = new THREE.Box3().setFromObject(o)
    return b.getCenter(new THREE.Vector3())
  },
  partsDistance: (a, b) => {
    const pa = parts.find((p) => p.obj === a)
    const pb = parts.find((p) => p.obj === b)
    return pa && pb ? S.partDistance(toolsAdapter, pa, pb) : Promise.resolve(null)
  },
  hide: () => {
    $('measure-out').hidden = true
  },
  requestRender: () => renderer && requestRender(),
  getMode: () => state.measureMode,
  isOn: () => state.measure
})
/** The unfinished measurement is dropped; the finished ones stay (they are in the Measure tab). */
function clearMeasure() {
  measure.cancelDraft()
}
/** A chain with two or more points is kept as it is when measuring ends or the way to measure changes; anything else unfinished is dropped. */
function endDraft() {
  const d = measure.draft()
  if (d && d.kind === 'chain' && d.count >= 2) measure.finishChain(false)
  else clearMeasure()
}
function syncMeasureBar() {
  const d = measure.draft()
  if (chrome) chrome.measureBar.sync({ on: state.measure, mode: state.measureMode, partsOk: parts.length >= 2, chainCount: d && d.kind === 'chain' ? d.count : 0 })
}
function setMeasure(on) {
  if (!on) endDraft()
  state.measure = on
  syncMeasureBar()
  $('b-measure').setAttribute('aria-pressed', String(on))
  canvas.style.cursor = on ? 'crosshair' : ''
  clearMeasure()
}
$('b-measure').onclick = () => setMeasure(!state.measure)
$('measure-mode').onchange = (e) => {
  if (state.measure) endDraft()
  state.measureMode = e.target.value
  if (state.measure) clearMeasure()
  else setMeasure(true) // choosing a way to measure starts measuring
  syncMeasureBar()
}

// ---------- export a copy ----------
// The section of the side panel is shared with the model viewer (shared/export-ui.js, set up below); this file says how this viewer's
// parts become files. The original STEP file is never touched.
function flash(text) {
  setMsg(text)
  setTimeout(() => {
    if (model && $('msg-text').textContent === text) hideMsg() // not when something newer is showing
  }, 3500)
}
async function saveBytes(name, mime, bytes) {
  const data = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes.buffer : bytes.slice().buffer
  return orca.host.call('files.saveAs', { suggestedName: name, mimeType: mime, data })
}
let exportUi = null
let toolsUi = null
const invalidateExport = () => {
  if (exportUi) exportUi.invalidate()
  if (studioUi) studioUi.studio.dirty() // parts shown or hidden: the shadow is drawn again
}
function exportCounts(only) {
  let tris = 0
  let verts = 0
  for (const p of parts) {
    if (only && !p.visible) continue
    tris += p.tris
    verts += p.verts
  }
  return { tris, verts, points: 0, textured: 0, pointParts: 0 }
}
async function buildMeshCopy(fmt, { only, target, scale = 1 }) {
  const { parts: ps } = collectExportParts(parts, modelRoot, { visibleOnly: only, fileUp: state.up, target, withNormals: fmt === 'glb', scale })
  if (!ps.some((p) => triangleCount(p) > 0)) throw new Error('none')
  if (fmt === 'glb') return writeGLB(ps)
  if (fmt === 'stl') return writeSTL(ps)
  if (fmt === 'obj') return writeOBJ(ps)
  if (fmt === 'ply') return writePLY(ps)
  return write3MF(ps, { unit: unitInfo.short })
}
// "GLB, compressed": the plain GLB is written from the parts' arrays and compressed in a worker.
async function buildCompressedCopy({ only, target, scale = 1, opts, onProgress, setCancel, isCancelled }) {
  const { parts: ps } = collectExportParts(parts, modelRoot, { visibleOnly: only, fileUp: state.up, target, withNormals: true, scale })
  const transfer = []
  for (const p of ps) for (const k of ['positions', 'indices', 'normals', 'colors']) if (p[k]) transfer.push(p[k].buffer)
  if (isCancelled()) throw new Error('cancelled')
  const task = runTask('compress', { parts: ps, opts }, { transfer, onProgress })
  setCancel(() => task.cancel())
  return task.promise
}
// "Copy details": the rows of the Details section as text.
$('b-copy-details').onclick = () => {
  const rows = [...document.querySelectorAll('#stats dt')].map((dt) => [dt.textContent, dt.nextElementSibling ? dt.nextElementSibling.textContent : ''])
  flash(copyText(detailsText(`${PLUGIN_NAME} ${t('stats')}`, rows)) ? t('copied') : t('copy_failed'))
}
// The quick path: the current view as a PNG, as it is shown (with the background), saved straight away.
$('b-shot').onclick = async () => {
  if (!model || glLost) return
  try {
    const r = await renderPng({ renderer, scene, camera, canvas, helpers, size: 0, transparent: false, overlay: measure })
    await saveBytes(suggestName(lastStats && lastStats.name, 'png'), 'image/png', r.bytes)
  } catch {
    flash(t('save_failed'))
  }
}

// ---------- preset views ----------
function applyPreset(name) {
  if (!model) return
  // every view fits the whole model (distance from the size, target in the middle), so it works from wherever the camera is
  const d = fitDistance(diag / 2, camera.fov, camera.aspect) * presetScale(name)
  camera.position.copy(center).addScaledVector(new THREE.Vector3(...presetDirection(name)), d)
  controls.target.copy(center)
  controls.update()
  requestRender()
}
$('preset').onchange = (e) => {
  if (e.target.value === 'all') resetView()
  else applyPreset(e.target.value)
  e.target.value = ''
}
let filterFrame = 0
$('filter').oninput = () => {
  cancelAnimationFrame(filterFrame)
  filterFrame = requestAnimationFrame(buildRowList) // one rebuild per frame while typing
}

// ---------- toolbar ----------
const toggle = (key, after) => {
  state[key] = !state[key]
  after()
  scheduleViewSave()
}
const redrawHelpers = () => {
  applyHelperFlags()
  requestRender()
}
// Background: one mode (look, orca, light, dark, white, gradient, transparent), remembered; it works in every look and shading.
function themeDark() {
  return document.documentElement.classList.contains('dark')
}
function effectiveDark() {
  return bgModel.dark()
}
function refreshBg() {
  const label = `${t('background')}: ${t('ch_bg_' + bgModel.mode)}`
  $('b-bg').textContent = label
  $('b-bg').setAttribute('aria-label', label)
  applyHelperFlags()
  if (chrome) chrome.syncBackground(bgModel.mode, !!(studioUi && studioUi.isActive()))
  requestRender()
  shell.layout() // the label changed length
}
function setBackground(mode) {
  bgModel.set(mode)
  prefs = withBg(prefs, mode)
  savePrefs()
  refreshBg()
}
/** Key B: the next background, named (the list in the Studio menu shows and sets the same mode). */
function cycleBackground() {
  const next = BG_MODES[(BG_MODES.indexOf(bgModel.mode) + 1) % BG_MODES.length]
  setBackground(next)
  flash(t('ch_bg_now', { name: t('ch_bg_' + next) }))
}
$('b-bg').onclick = cycleBackground
$('b-resetprefs').onclick = () => {
  shell.reset()
  prefs = resetPrefs()
  savePrefs()
  bgModel.set('look')
  if (studioUi) {
    studioUi.reset()
    lastPreset = studioUi.studio.state.preset
    if (syncLooks) syncLooks()
  }
  // the switches too (they are not stored, but "reset all" means all): back to the standard values, the view of the file again
  const d = defaultState()
  state.tint = d.tint
  $('l-color').setAttribute('aria-pressed', 'false')
  state.quality = 'normal'
  $('quality').value = 'normal'
  if (model) {
    state.clip.axis = ''
    $('sec-axis').value = ''
    updateClip()
    clearMeasure()
    selectRow(-1, false)
    applyView({ wire: d.wire, edges: d.edges, grid: d.grid, axes: d.axes, box: d.box, over: d.over, back: d.back, shading: d.shading, opacity: d.opacity })
    applyTint()
    resetView()
    scheduleViewSave() // the remembered view is overwritten with the standard one
  } else Object.assign(state, { wire: d.wire, edges: d.edges, grid: d.grid, axes: d.axes, box: d.box, over: d.over, back: d.back, shading: d.shading, opacity: d.opacity })
  refreshBg()
}
$('b-wire').onclick = () => toggle('wire', applyMaterialFlags)
$('b-edges').onclick = () => toggle('edges', applyEdges)
$('b-back').onclick = () => toggle('back', applyMaterialFlags)
$('b-grid').onclick = () => toggle('grid', redrawHelpers)
$('b-axes').onclick = () => toggle('axes', redrawHelpers)
$('b-box').onclick = () => toggle('box', redrawHelpers)
$('b-over').onclick = () => toggle('over', applyMaterialFlags)
$('up').onchange = (e) => {
  state.up = e.target.value
  prefs.up = state.up
  savePrefs()
  if (!model) return
  applyUp()
  fitBounds()
  buildHelpers()
  resetView()
  updateClip()
  clearMeasure()
  buildStats()
  invalidateExport()
}
$('quality').onchange = (e) => {
  state.quality = e.target.value
  prefs.quality = state.quality
  savePrefs()
  if (current) gateOrRead()
}
$('b-cancel').onclick = () => {
  stopJob()
  showBusy(false)
  if (model) {
    pendingIgnored = 0
    if (prevCurrent) {
      current = prevCurrent // a later quality change re-reads the model on screen, not the cancelled file
      prevCurrent = null
    }
    state.quality = lastStats.quality // the model on screen was built with this one
    $('quality').value = state.quality
    return
  }
  setMsg(t('cancelled'))
  $('gate-text').textContent = t('cancelled')
  $('gate').hidden = false
  shell.setPanelOpen(true, false)
  shell.openSection('quality-sec')
}
$('b-go').onclick = () => startRead()
// What each key does (the keys themselves are the table in shared/keymap.js; an action this viewer does not have is not listed)
const zoomBy = (k) => {
  if (!model) return
  camera.position.lerp(controls.target, k)
  controls.update()
  requestRender()
}
const click = (id) => {
  const b = $(id)
  if (b && !b.hidden && !b.disabled) b.click()
}
const KEY_ACTIONS = {
  zoom_in: () => zoomBy(0.18),
  zoom_out: () => zoomBy(-0.18),
  view_iso: () => applyPreset('iso'),
  view_front: () => applyPreset('front'),
  view_back: () => applyPreset('back'),
  view_left: () => applyPreset('left'),
  view_right: () => applyPreset('right'),
  view_top: () => applyPreset('top'),
  view_bottom: () => applyPreset('bottom'),
  view_hero: () => applyPreset('hero'),
  view_all: () => resetView(),
  measure: () => click('b-measure'),
  studio: () => {
    if (!model) return
    studioUi.toggle()
    if (studioUi.isActive()) chrome.popovers.open('studio')
    else chrome.popovers.close(false)
  },
  export: () => {
    click('b-export')
    // the section puts the focus on its format list (for a click on the toolbar button); after the key E the other shortcuts must keep working
    if (document.activeElement && document.activeElement.tagName === 'SELECT') document.activeElement.blur()
  },
  escape: () => {
    if (shell.closePopover()) return // an open popover (More) closes first
    if (chrome.closeExport()) return // then the export dialog
    if (chrome.closeKeys()) return // and the list of shortcuts
    if (!$('drop').hidden && model) hideStart()
    else if (state.measure) setMeasure(false)
    else if (selRows.size) selectRow(-1, false)
  },
  fit_selected: () => fitView(),
  isolate: (a) => isolateSelected(a.shift),
  mesh: () => click('b-wire'),
  grid: () => click('b-grid'),
  background: () => cycleBackground(),
  panel: () => click('b-panel')
}
window.addEventListener('keydown', (e) => {
  if (confirmOpen()) return // a question is open: its own keys only
  const a = keyAction(e)
  if (a && KEY_ACTIONS[a.action]) KEY_ACTIONS[a.action](a)
})
orca.on('theme', () => {
  if (bgModel.mode === 'look' || bgModel.mode === 'orca') refreshBg()
})

// ---------- close the model ----------
// Back to the start page: the scene is emptied, the kept "last file" is forgotten. Always asked first, with a dialog the page draws itself
// (window.confirm may be blocked in a sandboxed frame); the text says more when something would be lost. Escape cancels, the focus starts on
// "Cancel". In an editor tab the file of the tab is not touched: the start page then takes another file.
function hasUnexportedChanges() {
  return !!((toolsUi && toolsUi.hasChanges()) || state.clip.axis || measure.count() > 0)
}
async function closeModel() {
  loadSeq++ // a file that is still being read is dropped
  stopJob()
  current = null
  prevCurrent = null
  pendingIgnored = 0
  lastStats = null
  collapsed.clear()
  if (studioUi) studioUi.studio.spin.stop()
  disposeModel()
  setHasModel(false)
  $('busy').hidden = true
  $('gate').hidden = true
  for (const id of ['stats-sec', 'sec-sec', 'part-sec']) $(id).hidden = true
  checkInfo = null
  state.clip.axis = ''
  $('sec-axis').value = '' // the section goes with the model
  for (const o of [gridObj, axesObj, boxObj]) {
    // the floor grid, axes and box belong to the model too
    if (o) {
      helpers.remove(o)
      o.geometry?.dispose()
      o.material?.dispose()
    }
  }
  gridObj = axesObj = boxObj = null
  if (toolsUi) toolsUi.modelChanged()
  invalidateExport()
  firstFrame = true // the next model is fitted, not shown from the camera of this one
  showStart()
  requestRender()
  try {
    await sessionStore.forget()
  } catch {
    // the start page is up all the same
  }
  keptMeta = null
  keptNote = ''
  refreshKeep()
}
$('b-close').onclick = async () => {
  if (!model) return
  const asked = loadSeq // what is on screen when the question is asked
  const ok = await askConfirm({ title: t('close_title'), text: t(hasUnexportedChanges() ? 'close_text_changes' : 'close_text_plain') + (measure.store.count() ? ` ${t('close_text_measures', { n: measure.store.count() })}` : ''), confirmLabel: t('close_confirm'), cancelLabel: t('close_cancel') })
  if (ok && model && asked === loadSeq) await closeModel() // not a model that came while the question was open
}

// ---------- document ----------
// Big files: warn before reading, because the converter needs roughly 40 times the file size in memory (measured).
function gateOrRead() {
  const bytes = current.bytes.byteLength
  const needBig = bytes > WARN_BYTES && !current.confirmed
  const needFine = state.quality === 'fine' && bytes > WARN_BYTES / 4 && !current.fineConfirmed
  if (needBig || needFine) {
    stopJob()
    showBusy(false)
    hideMsg()
    const gb = memoryEstimateGB(bytes)
    $('gate-text').textContent = t('memory_warn', { size: F.mb(bytes), gb: F.dec(gb, 1) }) + (state.quality === 'fine' ? ' ' + t('memory_warn_fine') : '')
    $('gate').hidden = false
    shell.setPanelOpen(true, false) // the gate lives in the panel: show it, without remembering the choice
    shell.openSection('quality-sec') // and its section, in case the person had folded it
    return
  }
  startRead()
}

// ---------- the last dropped file comes back ----------
// Orca builds a panel's frame anew when the panel is shown again (right sidebar closed and opened, another panel in front), so the file
// the person dropped or chose is kept in this frame's IndexedDB (nothing leaves the computer) and restored when the frame starts without a
// document, together with the camera and the display switches. One file at a time; the next one replaces it; "Forget it" deletes it.
console.warn(`${PLUGIN_NAME}-boot ${JSON.stringify({ surface: typeof orca.document === 'object' && orca.document ? 'editor' : 'panel' })}`) // frame starts, readable in `orca plugin logs`
const sessionStore = createSessionStore()
let keptMeta = null
let keptNote = ''
let pendingView = null
function refreshKeep() {
  const text = keptMeta ? t('keep_note', { name: keptMeta.name, size: F.mb(keptMeta.size) }) : keptNote
  $('keep-row').hidden = !text
  $('keep-text').textContent = text
}
sessionStore.info().then((i) => {
  if (i) keptMeta = i.meta
  refreshKeep()
})
async function rememberFile(name, bytes) {
  keptNote = ''
  const kept = await sessionStore.keep(name, bytes, 'step')
  if (kept && !model) {
    await sessionStore.forget() // the model was closed while this was being written: it must not come back
    return
  }
  if (kept) keptMeta = { name, size: bytes.byteLength }
  else {
    keptMeta = null
    if (bytes.byteLength > KEEP_MAX_BYTES) {
      keptNote = t('keep_too_big', { size: F.mb(bytes.byteLength) })
      sessionStore.forget() // what was kept is not what is on screen any more
    }
  }
  refreshKeep()
}
let viewTimer = 0
function viewState() {
  return { pos: camera.position.toArray(), target: controls.target.toArray(), up: state.up, wire: state.wire, edges: state.edges, grid: state.grid, axes: state.axes, box: state.box, over: state.over, back: state.back, shading: state.shading, opacity: state.opacity }
}
function scheduleViewSave() {
  if (!keptMeta) return
  clearTimeout(viewTimer)
  viewTimer = setTimeout(() => keptMeta && model && sessionStore.keepView(viewState()), 600)
}
function applyView(v) {
  if (!v || !model) return
  if (['y', 'z'].includes(v.up) && v.up !== state.up) {
    state.up = v.up
    $('up').value = v.up
    applyUp()
    fitBounds()
    buildHelpers()
    updateClip()
  }
  for (const k of ['wire', 'edges', 'grid', 'axes', 'box', 'over', 'back']) if (typeof v[k] === 'boolean') state[k] = v[k]
  if (['original', 'solid', 'normals', 'xray', 'matcap', 'flat', 'vertex'].includes(v.shading)) {
    state.shading = v.shading
    $('shading').value = v.shading
  }
  if (Number.isFinite(v.opacity)) {
    state.opacity = Math.min(1, Math.max(0.1, v.opacity))
    $('opacity').value = String(Math.round(state.opacity * 100))
    $('opacity-out').textContent = $('opacity').value
  }
  applyMaterials()
  applyEdges()
  applyHelperFlags()
  if (Array.isArray(v.pos) && v.pos.length === 3 && v.pos.every(Number.isFinite) && Array.isArray(v.target) && v.target.length === 3 && v.target.every(Number.isFinite)) {
    camera.position.fromArray(v.pos)
    controls.target.fromArray(v.target)
    controls.update()
  }
  requestRender()
}
let restoreTried = false
// The start page, or, when this frame has no document and a file was kept, that file.
async function startOrRestore() {
  if (restoreTried || model) return model ? undefined : showStart()
  restoreTried = true
  const rec = await sessionStore.load()
  if (!rec || model || incoming.source !== 'editor') {
    if (!model) showStart()
    return
  }
  pendingView = rec.view
  hideStart()
  acceptBytes(new Uint8Array(rec.bytes), { name: rec.meta.name, source: 'restore' }) // the same way a dropped file goes (the memory question included)
}
controls.addEventListener('end', scheduleViewSave)
window.addEventListener('pagehide', () => keptMeta && model && sessionStore.keepView(viewState()))
document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && keptMeta && model && sessionStore.keepView(viewState()))

function onDocument(d) {
  const c = d.content
  incoming = { name: '', source: 'editor' }
  $('b-close').hidden = !(c.kind === 'text' && isStartText(c.text)) // not in the editor tab of a project file (the tab is the file)
  // STEP is a text format: Orca hands text files to an editor as text (a "bytes" editor is not shown for them).
  if (c.kind === 'text' && isStartText(c.text)) {
    stopJob()
    showBusy(false)
    return startOrRestore() // the start file ("new STEP viewer"): an empty page that takes dropped files
  }
  const bytes = c.kind === 'text' ? new TextEncoder().encode(c.text) : c.kind === 'bytes' ? new Uint8Array(c.bytes) : null
  acceptBytes(bytes, incoming)
}

// Both Orca's document and a dropped or picked file end here. `inc` says who opened it.
function acceptBytes(bytes, inc, seqArg) {
  const seq = seqArg ?? ++loadSeq
  incoming = inc
  stopJob()
  showBusy(false)
  $('gate').hidden = true
  if (!bytes) return reject(t('not_step'))
  if (bytes.byteLength === 0) return reject(t('empty'))
  if (!looksLikeStep(bytes)) return reject(t('not_step'))
  if (model && !prevCurrent && inc.source !== 'editor') prevCurrent = current // the model on screen keeps its record until the new one is up
  current = { bytes, seq, name: inc.name, source: inc.source, confirmed: false, fineConfirmed: false }
  gateOrRead()
}

// ---------- start page, drop and file picker ----------
// A file dropped or picked arrives through the browser File API, so Orca's 50 MB limit for files it hands to an editor does not apply.
const FORMAT_LIST = SUPPORTED_EXT.map((e) => '.' + e).join(' ')
let dragDepth = 0
let dropWasShown = false

// The start page doubles as the drop target and as the place where a rejected file's reason is shown. With a model on screen it is a
// message over the view only (the toolbar and the panel stay usable): a click beside the card or Esc closes it.
function showStart(note, isErr) {
  $('msg').className = 'msg hide'
  $('drop').hidden = false
  $('drop').classList.remove('over')
  $('drop-title').textContent = t('drop_title')
  $('drop-formats').textContent = t('drop_formats', { list: FORMAT_LIST })
  const n = $('drop-note')
  n.hidden = !note
  n.className = isErr ? 'drop-note' : 'drop-note info'
  n.textContent = note || ''
  if (!model) setStateAttr('start')
  $('b-pick').focus({ preventScroll: true })
}
function hideStart() {
  $('drop').hidden = true
  $('drop').classList.remove('over')
  $('drop-note').hidden = true
}
$('drop').addEventListener('click', (e) => {
  if (e.target === $('drop') && model) hideStart()
})

function logState() {
  const { tris, faces } = summarizeParts(parts)
  // console.warn on purpose: `orca plugin logs` keeps warnings and errors only, and it is the one channel an agent can read without any capability
  console.warn(
    stateLine(PLUGIN_NAME, {
      state: 'ok',
      file: lastStats.name || null,
      source: lastStats.source,
      format: 'step',
      bytes: lastStats.fileBytes,
      parts: parts.length,
      faces,
      triangles: tris,
      size: [fileSize.x, fileSize.y, fileSize.z].map((v) => Number(v.toPrecision(5))),
      unit: unitInfo.short,
      up: state.up,
      quality: lastStats.quality,
      readMs: Math.round(lastStats.readMs),
      converterMB: Math.round(lastStats.wasmMB)
    })
  )
}

async function openFiles(fileList, source) {
  const plan = planOpen(pickFile(fileList, SUPPORTED_EXT), { hardMax: HARD_MAX_BYTES }, false, extOf)
  if (plan.action === 'nothing') return showStart(t('drop_nothing'), true)
  if (plan.action === 'unsupported') return showStart(['glb', 'ply', 'obj', 'stl', '3mf'].includes(plan.ext) ? t('unsupported_other', { ext: plan.ext }) : t('unsupported_file', { ext: plan.ext || '?', list: FORMAT_LIST }), true)
  if (plan.action === 'toobig') return showStart(t('too_big', { size: F.mb(plan.file.size), max: F.mb(HARD_MAX_BYTES) }), true)
  const { file, ignored } = plan
  hideStart() // the file is accepted: the busy panel, the memory gate and any result are visible, the start card is not in the way
  const seq = ++loadSeq
  const inc = { name: file.name, source }
  setMsg(t('loading', { type: 'STEP', size: F.mb(file.size) }))
  setStateAttr('loading')
  let buf
  try {
    buf = await file.arrayBuffer()
  } catch (e) {
    if (seq === loadSeq) {
      incoming = inc
      reject(t('read_failed', { why: String((e && e.message) || e).slice(0, 200) }))
    }
    return
  }
  if (seq !== loadSeq) return // another file was opened while this one was being read
  pendingIgnored = ignored
  acceptBytes(new Uint8Array(buf), inc, seq) // from here the memory gate, the busy panel and Cancel work as for any STEP file
}

const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')
window.addEventListener('dragenter', (e) => {
  if (!hasFiles(e)) return
  e.preventDefault()
  const r = dragReducer(dragDepth, { type: 'enter' })
  dragDepth = r.depth
  if (r.started) {
    dropWasShown = !$('drop').hidden
    $('drop').hidden = false
    $('drop').classList.add('over')
    $('drop-title').textContent = model ? t('drop_title_replace') : t('drop_title')
  }
})
window.addEventListener('dragover', (e) => {
  if (hasFiles(e)) {
    e.preventDefault() // lets the drop happen here instead of navigating the frame to the file
    e.dataTransfer.dropEffect = 'copy'
  }
})
function dragEnded() {
  dragDepth = 0
  $('drop').classList.remove('over')
  $('drop-title').textContent = t('drop_title')
  if (!dropWasShown) hideStart() // the overlay only appeared for the drag: take it down again (a start page that was already up stays)
}
window.addEventListener('dragleave', (e) => {
  if (!hasFiles(e)) return
  const r = dragReducer(dragDepth, { type: 'leave', leftWindow: e.relatedTarget === null && e.clientX <= 0 })
  dragDepth = r.depth
  if (r.ended) dragEnded()
})
window.addEventListener('dragend', dragEnded)
window.addEventListener('drop', (e) => {
  if (!hasFiles(e)) return
  e.preventDefault()
  dragDepth = 0
  $('drop').classList.remove('over')
  openFiles(e.dataTransfer.files, 'drop')
})
// Cmd+V of a file copied in Finder
window.addEventListener('paste', (e) => {
  const files = e.clipboardData && e.clipboardData.files
  if (files && files.length) {
    e.preventDefault()
    openFiles(files, 'paste')
  }
})
$('file-input').accept = SUPPORTED_EXT.map((e) => '.' + e).join(',')
$('file-input').onchange = (e) => {
  const files = Array.from(e.target.files || [])
  e.target.value = '' // the same file can be chosen again
  if (files.length) openFiles(files, 'picker')
}
$('b-pick').onclick = () => $('file-input').click()
$('b-open').onclick = () => $('file-input').click()

new ResizeObserver(resize).observe($('stage'))
// the toolbar, the side tabs and the measuring bar are built from the page's elements (chrome-layout.js), before the shell wires them
chrome = buildChrome({ t, step: true, tabPref: { get: () => prefs.tab, set: (v) => ((prefs.tab = v), savePrefs()) } })
const shell = initShell({ getPrefs: () => prefs, savePrefs, onLayout: resize, popovers: chrome.popovers })
chrome.hooks.fitAll = () => resetView()
chrome.hooks.fitSelected = () => fitView()
chrome.hooks.openPanel = () => shell.setPanelOpen(true)
chrome.hooks.resetAppearance = () => resetAppearance()
chrome.hooks.isolate = () => isolateSelected(false)
chrome.hooks.setMulti = (on) => (multiSelect = on)
chrome.hooks.setBackground = (m) => setBackground(m)
chrome.hooks.shadingOriginal = () => {
  $('shading').value = 'original'
  $('shading').dispatchEvent(new Event('change', { bubbles: true }))
}
// the segment of the measuring bar sets the (hidden) select, which stays the one source of the mode
chrome.measureBar.bind({
  setMode: (m) => {
    $('measure-mode').value = m
    $('measure-mode').dispatchEvent(new Event('change', { bubbles: true }))
  },
  // "Delete": the unfinished measurement, else the selected one
  clear: () => clearMeasure(), // the unfinished measurement; finished ones are deleted in the Measure tab
  done: () => setMeasure(false),
  finishChain: (closed) => measure.finishChain(closed)
})
measureTab = chrome.bindMeasureTab({
  measure,
  locale,
  copy: copyText,
  flash,
  startMeasuring: () => {
    if (!state.measure) setMeasure(true)
  },
  confirm: askConfirm
})
installMeasureInteraction({
  canvas,
  camera,
  controls,
  measure,
  canEdit: () => !!model && (state.measure || chrome.tabs.current() === 'measure'),
  isMeasuring: () => state.measure,
  pickAt: (x, y) => {
    const r = canvas.getBoundingClientRect()
    ray.setFromCamera(new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -(((y - r.top) / r.height) * 2 - 1)), camera)
    return pickHit(parts.filter((p) => p.kind === 'mesh' && p.visible).map((p) => p.obj))
  }
})
syncMeasureBar()
updateControls() // no model yet: no tabs (the empty panel says what to do)
// whatever nobody caught: a line in the log (`orca plugin logs`) and a message for the person; a model that is on screen stays
installErrorGuard(window, {
  plugin: PLUGIN_NAME,
  onFatal: (why) => {
    if (model) flash(t('unexpected_error', { why }))
    else setMsg(t('unexpected_error', { why }), true)
  }
})
exportUi = initExportUi({
  t,
  openExport: () => chrome.openExport(), // the export is a dialog over the view
  fmtMB: F.mb,
  shell,
  pluginName: PLUGIN_NAME,
  locale,
  plain: true, // a converted CAD model: no textures, point clouds or slicer data
  hasModel: () => !!model,
  glLost: () => glLost,
  currentName: () => (lastStats && lastStats.name) || '',
  nextFrame: () => new Promise((r) => requestAnimationFrame(() => r())),
  counts: exportCounts,
  exportable: (only) => parts.some((p) => !only || p.visible),
  buildMesh: buildMeshCopy,
  buildCompressed: buildCompressedCopy,
  originalBytes: () => (lastStats && lastStats.fileBytes) || 0,
  gltfScale: () => ({ k: unitInfo.short !== 'm' && UNIT_METERS[unitInfo.short] ? UNIT_METERS[unitInfo.short] : 1, unit: unitInfo.short }),
  view: () => ({ renderer, scene, camera, controls, canvas, helpers, overlay: measure, spinner: studioUi && studioUi.isActive() ? studioUi.studio.spin : null }),
  resize,
  requestRender,
  saveBytes
})

// ---------- tools: the working copy ----------
// The Tools section (shared/tools-ui.js) changes the model that is on screen; this adapter tells it how this viewer holds its model.
// The parts here are the leaves of the assembly tree, so removing or merging them is left to "hide" and "export only the visible".
const toolsAdapter = {
  modelRoot,
  structure: false,
  getModel: () => model,
  getParts: () => parts,
  getUnit: () => unitInfo,
  setUnit: (u) => {
    // a unit the tools made has a label; the one that comes back from a reset is the viewer's own record, put back as it was
    unitInfo = u.label !== undefined && u.mode === undefined ? { ...unitInfo, short: u.short, mode: 'tool', toolLabel: u.label } : { ...u }
  },
  getUp: () => state.up,
  setUp: (u) => {
    state.up = u
    $('up').value = u
    applyUp()
  },
  afterChange() {
    if (!model) return
    refreshEdges()
    checkInfo = null // the numbers were of the model before
    fitBounds()
    buildHelpers()
    resetView()
    updateClip()
    if (measure.store.count()) flash(t('mp_dropped'))
    measure.clearAll() // the geometry was changed by a tool: the old points are not on the surface any more
    buildStats()
    syncSelection(false)
    if (partCard) partCard.invalidate() // the numbers were of the working copy before
    invalidateExport()
    requestRender()
  }
}
toolsUi = initToolsUi({
  t,
  locale,
  A: toolsAdapter,
  hasModel: () => !!model,
  selectedPart: () => -1,
  measure: () => ({ size: [fileSize.x, fileSize.y, fileSize.z], tris: parts.reduce((a, p) => a + p.tris, 0) }),
  onCheck: (r) => {
    checkInfo = r.total
    buildStats()
  },
  fmtLen: F.len,
  fmtVol: (v, u) => F.vol(v, u),
  fmtArea: (v, u) => F.area(v, u),
  view: () => ({ renderer, scene, camera, canvas, helpers }),
  resize,
  nextFrame: () => new Promise((r) => requestAnimationFrame(() => r()))
})
studioUi = initStudioUi({
  t,
  prefs: () => prefs,
  savePrefs,
  hasModel: () => !!model,
  insertBefore: 'studio-anchor',
  afterApply: () => {
    // a look chosen from the tiles shows its own background again; editing a light or the floor leaves a chosen background alone
    const preset = studioUiRef ? studioUiRef.studio.state.preset : null
    if (preset && preset !== 'custom' && preset !== lastPreset && bgModel.mode !== 'look') setBackground('look')
    if (preset && preset !== 'custom') lastPreset = preset
    refreshBg() // the background and the Studio button follow the look
    if (syncLooks) syncLooks()
  },
  beforeSpin: clearMeasure,
  studioCtx: {
    scene,
    camera,
    renderer,
    controls,
    canvas,
    spinRoot,
    modelRoot,
    baseLights: [hemisphere, headlight],
    getBox: () => boundsBox,
    getStats: () => {
      const sm = summarizeParts(parts)
      return { tris: sm.tris, points: 0, splat: false }
    },
    requestRender
  }
})
studioUiRef = studioUi
syncLooks = chrome.decorateStudio() // look tiles over the list, the details one level down
lastPreset = studioUi.studio.state.preset
$('studio-sec').addEventListener('toggle', () => {
  if (!$('studio-sec').open) $('studio-sec').open = true // the section has no heading to open it again
})
$('parts').title = t('tip_selection')
partCard = initPartCard({
  t,
  locale,
  A: toolsAdapter,
  host: $('parts'),
  chipHost: $('stage'),
  meshNote: true, // the sizes come from the triangle mesh of the CAD kernel
  fmtLen: F.len,
  fmtVol: (v, u) => F.vol(v, u),
  fmtArea: (v, u) => F.area(v, u),
  getSelection: () => ({ indices: selectedIndices(), label: selRows.size === 1 && rows[selectedRow] ? rows[selectedRow].name : null }),
  clear: () => selectRow(-1, false),
  fit: () => fitView(),
  isolate: () => isolateSelected(false),
  openPanel: () => shell.setPanelOpen(true),
  measureParts: () => {
    state.measureMode = 'parts'
    $('measure-mode').value = 'parts'
    shell.setPanelOpen(true)
    setMeasure(true)
  },
  flash,
  isCut: (p) => {
    if (!state.clip.axis) return false
    if (!p.obj.geometry.boundingBox) p.obj.geometry.computeBoundingBox()
    p.obj.updateWorldMatrix(true, false)
    const b = p.obj.geometry.boundingBox
    let inside = 0
    for (let k = 0; k < 8; k++) {
      const v = new THREE.Vector3(k & 1 ? b.max.x : b.min.x, k & 2 ? b.max.y : b.min.y, k & 4 ? b.max.z : b.min.z).applyMatrix4(p.obj.matrixWorld)
      if (clipPlane3.distanceToPoint(v) >= 0) inside++
    }
    return inside > 0 && inside < 8
  },
  describe: (i) => ({ name: parts[i].name || rows.find((r) => r.meshes.length === 1 && r.meshes[0] === i)?.name, colour: rowSwatch({ meshes: [i] }) }),
  prefs: { get: (k) => prefs[k], set: (k, v) => ((prefs[k] = v), savePrefs()) }
})
setHasModel(false)
let gotDocument = false
if (typeof orca.document === 'object' && orca.document && typeof orca.document.onDidChange === 'function') {
  setMsg(t('waiting'))
  refreshBg() // the empty view already has the theme's background
  resize()
  orca.document.onDidChange((d) => {
    gotDocument = true
    onDocument(d)
  })
  // A sidebar panel has the same page but no document: say so instead of waiting for one forever.
  if (typeof orca.document.get === 'function') {
    Promise.resolve(orca.document.get()).catch(() => {
      if (!gotDocument) startOrRestore()
    })
  }
  setTimeout(() => {
    if (!gotDocument && !model && incoming.source === 'editor') startOrRestore()
  }, 4000)
} else {
  // opened as a sidebar panel: there is no file; the start page, or the file that was kept
  refreshBg()
  resize()
  startOrRestore()
}

// Shared by 3D Model Viewer and STEP Viewer 3D (canonical copy: plugins/_shared; do not edit the copies in editor/shared).
// The work of the Tools area that is heavy: compressing a model to a smaller GLB, thinning point clouds, decimating meshes, checking
// meshes. It runs in a worker (tools-worker.js) so the page stays usable, or on the page itself when a worker cannot be started
// (tools-run.js). The meshopt encoder and simplifier are loaded only when a task needs them.
import { writeGLB, triangleCount, vertexCount } from './export.js'
import { compressGlb } from './glb-compress.js'
import { analyzeMesh, decimateMesh } from './mesh-tools.js'
import { minDistance } from './part-info.js'

/** @type {Promise<any> | null} */
let encoderPromise = null
/** @type {Promise<any> | null} */
let simplifierPromise = null
export function loadEncoder() {
  return (encoderPromise ||= import('../vendor/meshopt/meshopt_encoder.js').then(async (m) => {
    await m.MeshoptEncoder.ready
    return m.MeshoptEncoder
  }))
}
export function loadSimplifier() {
  return (simplifierPromise ||= import('../vendor/meshopt/meshopt_simplifier.js').then(async (m) => {
    await m.MeshoptSimplifier.ready
    return m.MeshoptSimplifier
  }))
}

// Re-encodes an image smaller: decoded at full size, drawn at most `maxSize` px on the long edge, JPEG when it has no transparency, else PNG.
// `lossless` (an image of data, such as a normal map): never JPEG, and an image that is not made smaller is left as it is (null).
export async function recodeImage(bytes, mime, { maxSize, quality, lossless = false }) {
  if (typeof OffscreenCanvas !== 'function' || typeof createImageBitmap !== 'function') return null
  const bmp = await createImageBitmap(new Blob([bytes], { type: mime || 'image/png' }), { imageOrientation: 'none', premultiplyAlpha: 'none', colorSpaceConversion: 'none' })
  try {
    const k = maxSize > 0 ? Math.min(1, maxSize / Math.max(bmp.width, bmp.height)) : 1
    if (lossless && k >= 1) return null
    const w = Math.max(1, Math.round(bmp.width * k))
    const h = Math.max(1, Math.round(bmp.height * k))
    const cv = new OffscreenCanvas(w, h)
    const g = cv.getContext('2d', { willReadFrequently: true })
    if (!g) throw new Error('no 2d canvas')
    g.imageSmoothingQuality = 'high'
    g.drawImage(bmp, 0, 0, w, h)
    const px = g.getImageData(0, 0, w, h).data
    let alpha = false
    for (let i = 3; i < px.length; i += 4) {
      if (px[i] !== 255) {
        alpha = true
        break
      }
    }
    const png = alpha || lossless
    const blob = await cv.convertToBlob(png ? { type: 'image/png' } : { type: 'image/jpeg', quality })
    return { bytes: new Uint8Array(await blob.arrayBuffer()), mimeType: png ? 'image/png' : 'image/jpeg', width: w, height: h }
  } finally {
    bmp.close()
  }
}

const pointCount = (parts) => parts.filter((p) => p.kind === 'points').reduce((a, p) => a + vertexCount(p), 0)

/** Keeps `target` of the points of a cloud, spread evenly (the simplifier merges close points and averages with their colors). */
export function thinPoints(part, target, simplifier) {
  const n = vertexCount(part)
  if (target >= n) return part
  /** @type {Float32Array | null} */
  let colors = null
  if (part.colors) {
    colors = new Float32Array(n * 3)
    for (let i = 0; i < n * 3; i++) colors[i] = part.colors[i] / 255
  }
  const keep = simplifier.simplifyPoints(part.positions, 3, Math.max(1, Math.floor(target)), colors || undefined, colors ? 3 : undefined, colors ? 1 : undefined)
  const m = keep.length
  const positions = new Float32Array(m * 3)
  const out = part.colors ? new Uint8Array(m * 3) : null
  for (let i = 0; i < m; i++) {
    positions.set(part.positions.subarray(3 * keep[i], 3 * keep[i] + 3), 3 * i)
    if (out) out.set(part.colors.subarray(3 * keep[i], 3 * keep[i] + 3), 3 * i)
  }
  return { ...part, positions, colors: out }
}

/**
 * task 'compress': { glb } (a GLB written by the page) or { parts } (plain arrays; the GLB is written here), opts as for compressGlb plus
 * `thin` (allow removing points when the target cannot be reached otherwise). Resolves { bytes, report }.
 */
export async function compressTask({ glb, parts, opts }, ctl, env = {}) {
  const encoder = await loadEncoder()
  // `env.recodeImage` replaces the browser's image codec (a host without OffscreenCanvas, such as Node, brings its own)
  const deps = { encoder, recodeImage: env.recodeImage || recodeImage, onProgress: ctl.progress, isCancelled: ctl.isCancelled }
  if (glb) return compressGlb(glb, opts, deps)
  let res = await compressGlb(writeGLB(parts), opts, deps)
  const points = pointCount(parts)
  // thinning removes data: only when the points are what makes the file big (about 6 bytes each once packed)
  if (!res.report.reached && opts.thin && points > 0 && points * 6 > res.bytes.length * 0.5) {
    const simplifier = await loadSimplifier()
    // the points are what makes the file big: keep the share that fits, with a margin, and look again
    const meshBytes = parts.filter((p) => p.kind === 'mesh').reduce((a, p) => a + triangleCount(p) * 6, 0)
    let share = Math.max(0.02, Math.min(0.95, ((opts.targetBytes - meshBytes) / Math.max(1, res.bytes.length - meshBytes)) * 0.94))
    for (let attempt = 0; attempt < 3; attempt++) {
      if (ctl.isCancelled()) throw new Error('cancelled')
      ctl.progress(0.5, 'thinning')
      const thinned = parts.map((p) => (p.kind === 'points' ? thinPoints(p, vertexCount(p) * share, simplifier) : p))
      res = await compressGlb(writeGLB(thinned), opts, deps)
      res.report.thinned = { from: points, to: pointCount(thinned) }
      if (res.report.reached) break
      share *= 0.8
    }
  }
  res.report.points = points
  return res
}

/** task 'decimate': { meshes: [{ attributes, indices }], opts: { ratio, error, lockBorder } } -> { results: [{ attributes, indices, stats }] } */
export async function decimateTask({ meshes, opts }, ctl) {
  const simplifier = await loadSimplifier()
  const results = []
  for (let i = 0; i < meshes.length; i++) {
    if (ctl.isCancelled()) throw new Error('cancelled')
    ctl.progress(i / meshes.length, 'decimate')
    results.push(decimateMesh(meshes[i], opts, simplifier))
  }
  ctl.progress(1, 'decimate')
  return { results }
}

/** task 'analyze': { meshes: [{ name, positions, indices }] } -> { results: [{ name, ...analyzeMesh }] } */
export async function analyzeTask({ meshes }, ctl) {
  const results = []
  for (let i = 0; i < meshes.length; i++) {
    if (ctl.isCancelled()) throw new Error('cancelled')
    ctl.progress(i / meshes.length, 'analyze')
    results.push({ name: meshes[i].name, ...analyzeMesh(meshes[i].positions, meshes[i].indices) })
  }
  return { results }
}

/** Every ArrayBuffer inside a result (to hand over instead of copying). */
export function transferables(value, found = new Set()) {
  if (!value || typeof value !== 'object') return found
  if (ArrayBuffer.isView(value)) found.add(value.buffer)
  else if (Array.isArray(value)) for (const v of value) transferables(v, found)
  else for (const v of Object.values(value)) transferables(v, found)
  return found
}

/** Runs a task by name. ctl: { progress(fraction, label), isCancelled() }. */
export async function runCore(type, payload, ctl, env) {
  if (type === 'compress') return compressTask(payload, ctl, env)
  if (type === 'decimate') return decimateTask(payload, ctl)
  if (type === 'analyze') return analyzeTask(payload, ctl)
  if (type === 'distance') return minDistance(payload.a, payload.b, { progress: (f) => ctl.progress(f, 'distance'), isCancelled: ctl.isCancelled })
  throw new Error(`unknown task ${type}`)
}

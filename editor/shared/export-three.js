// Shared by 3D Model Viewer and STEP Viewer 3D (canonical copy: plugins/_shared; do not edit the copies in editor/shared).
// The three.js side of "Export a copy": the viewer's parts as plain arrays for the writers in export.js, a PNG of the view (optionally
// with a transparent background) and a turntable video. Nothing here writes a file.
import * as THREE from 'three'
import { exportRotation, rotateInPlace } from './export.js'

const toSrgb8 = (c) => Math.max(0, Math.min(255, Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055))))
const tmpColor = new THREE.Color()

// One color for a whole part: the material's, unless the viewer made it up (userData.generic) or the vertices carry the colors.
function materialColor(p, hasVertexColors) {
  const m = Array.isArray(p.orig) ? p.orig[0] : p.orig
  if (!m || !m.color || hasVertexColors || (m.userData && m.userData.generic)) return null
  m.color.getRGB(tmpColor, THREE.SRGBColorSpace)
  return [Math.round(tmpColor.r * 255), Math.round(tmpColor.g * 255), Math.round(tmpColor.b * 255)]
}

/**
 * The viewer's parts as plain arrays for the writers, in the coordinate frame of the copy: the file's own axes (the "Up is" rotation
 * of the view is taken off), then turned so that `target` ('keep', 'y' or 'z') is up. A viewer part is
 * { obj, kind?: 'mesh' | 'points' | 'lines' (default mesh), name, label?, orig (material or array), visible }.
 * Returns { parts, hidden } (hidden: how many parts were left out because they are not visible).
 */
export function collectParts(viewerParts, modelRoot, { visibleOnly = true, fileUp = 'y', target = 'keep', withNormals = false, scale = 1 } = {}) {
  modelRoot.updateMatrixWorld(true)
  const inv = new THREE.Matrix4().copy(modelRoot.matrixWorld).invert()
  const rot = exportRotation(fileUp, target)
  const out = []
  let hidden = 0
  const v = new THREE.Vector3()
  const normal = new THREE.Matrix3()
  for (const p of viewerParts) {
    const kind = p.kind || 'mesh'
    if (kind !== 'mesh' && kind !== 'points') continue
    if (visibleOnly && !p.visible) {
      hidden++
      continue
    }
    const geo = p.obj.geometry
    const pos = geo.getAttribute('position')
    p.obj.updateWorldMatrix(true, false)
    const m = new THREE.Matrix4().multiplyMatrices(inv, p.obj.matrixWorld)
    if (scale !== 1) m.premultiply(new THREE.Matrix4().makeScale(scale, scale, scale)) // e.g. millimeters to the meters glTF means
    const n = pos.count
    const positions = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m)
      positions[3 * i] = v.x
      positions[3 * i + 1] = v.y
      positions[3 * i + 2] = v.z
    }
    rotateInPlace(positions, rot)
    let normals = null
    const nrm = geo.getAttribute('normal')
    if (withNormals && kind === 'mesh' && nrm && nrm.count === n) {
      normal.getNormalMatrix(m)
      normals = new Float32Array(n * 3)
      for (let i = 0; i < n; i++) {
        v.fromBufferAttribute(nrm, i).applyMatrix3(normal).normalize()
        normals[3 * i] = v.x
        normals[3 * i + 1] = v.y
        normals[3 * i + 2] = v.z
      }
      rotateInPlace(normals, rot)
    }
    let indices = null
    if (kind === 'mesh') {
      const flip = m.determinant() < 0 // a mirrored part must keep its outside outside
      if (geo.index) indices = Uint32Array.from(geo.index.array)
      else if (flip) indices = Uint32Array.from({ length: n }, (_, i) => i)
      // the normals need no change: the normal matrix already keeps them pointing outwards, only the winding is mirrored
      if (flip && indices) for (let t = 0; t + 2 < indices.length; t += 3) [indices[t + 1], indices[t + 2]] = [indices[t + 2], indices[t + 1]]
    }
    let colors = null
    const col = geo.getAttribute('color')
    if (col && col.count === n) {
      colors = new Uint8Array(n * 3)
      for (let i = 0; i < n; i++) {
        colors[3 * i] = toSrgb8(col.getX(i))
        colors[3 * i + 1] = toSrgb8(col.getY(i))
        colors[3 * i + 2] = toSrgb8(col.getZ(i))
      }
    }
    out.push({ name: p.name || p.label || '', kind, positions, indices, normals, colors, color: materialColor(p, !!colors) })
  }
  return { parts: out, hidden }
}

/** The PNG with the labels of the measurements drawn on it; null when there is nothing to draw or no way to draw it. */
async function paintOverlay(blob, overlay) {
  try {
    const bmp = await createImageBitmap(blob)
    const c = document.createElement('canvas')
    c.width = bmp.width
    c.height = bmp.height
    const c2 = c.getContext('2d')
    c2.drawImage(bmp, 0, 0)
    bmp.close && bmp.close()
    if (!overlay.paintOnto(c2, c.width, c.height)) return null
    const out = await new Promise((res) => c.toBlob(res, 'image/png'))
    return out ? new Uint8Array(await out.arrayBuffer()) : null
  } catch {
    return null
  }
}

/**
 * A PNG of the view. size: the long edge in pixels (0: as the view is drawn). transparent: no background, and without the helpers
 * (grid, axes, box, selection, measuring) so that only the model is in the picture. The renderer must have been made with alpha: true.
 */
export async function renderPng({ renderer, scene, camera, canvas, helpers, size = 0, transparent = false, onRestore, overlay = null }) {
  const prevBg = scene.background
  const prevHelpers = helpers.visible
  const prevRatio = renderer.getPixelRatio()
  const prevSize = renderer.getSize(new THREE.Vector2())
  const prevClear = renderer.getClearAlpha()
  try {
    if (size > 0) {
      const k = size / Math.max(prevSize.x, prevSize.y)
      renderer.setPixelRatio(1)
      renderer.setSize(Math.max(1, Math.round(prevSize.x * k)), Math.max(1, Math.round(prevSize.y * k)), false)
    }
    if (overlay && transparent) overlay.setHidden(true) // measurements are helpers: not in a picture without a background
    if (transparent) {
      scene.background = null
      renderer.setClearColor(0x000000, 0)
      helpers.visible = false
    }
    renderer.render(scene, camera) // draw right before reading the canvas
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'))
    if (!blob) throw new Error('empty image')
    const out = { bytes: new Uint8Array(await blob.arrayBuffer()), width: canvas.width, height: canvas.height }
    if (overlay && !transparent) {
      // the labels of the measurements are HTML on the view, so they are drawn into the picture here (the markers and lines are in the canvas)
      const painted = await paintOverlay(blob, overlay)
      if (painted) out.bytes = painted
    }
    return out
  } finally {
    if (overlay && transparent) overlay.setHidden(false)
    scene.background = prevBg
    helpers.visible = prevHelpers
    renderer.setClearColor(0x000000, prevClear)
    renderer.setPixelRatio(prevRatio)
    renderer.setSize(prevSize.x, prevSize.y, false)
    if (onRestore) onRestore()
  }
}

export function recorderMime() {
  if (typeof MediaRecorder !== 'function') return ''
  return ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m)) || ''
}

/** One turn of the camera around the model (about the view's up axis) recorded as WebM. onProgress(seconds), isCancelled(). Null when cancelled. */
export async function recordTurntable({ renderer, scene, camera, controls, canvas, seconds = 8, size = 0, spinner = null, onProgress, isCancelled, onRestore }) {
  const mimeType = recorderMime()
  if (!mimeType) throw new Error('no_recorder')
  const stream = canvas.captureStream(0) // a frame per requestFrame(), so every drawn frame is recorded exactly once
  const track = stream.getVideoTracks()[0]
  const rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 })
  const chunks = []
  rec.ondataavailable = (e) => e.data && e.data.size && chunks.push(e.data)
  const stopped = new Promise((res) => (rec.onstop = res))
  const target = controls.target.clone()
  const offset = camera.position.clone().sub(target)
  const up = new THREE.Vector3(0, 1, 0)
  const keepEnabled = controls.enabled
  let cancelled = false
  const prevRatio = renderer.getPixelRatio()
  const prevSize = renderer.getSize(new THREE.Vector2())
  // with the studio on the model turns under fixed lights (the shadow stays where it is); without it the camera goes around
  const turn = spinner ? spinner.begin() : null
  try {
    if (size > 0) {
      const k = size / Math.max(prevSize.x, prevSize.y)
      renderer.setPixelRatio(1)
      renderer.setSize(Math.max(2, 2 * Math.round((prevSize.x * k) / 2)), Math.max(2, 2 * Math.round((prevSize.y * k) / 2)), false) // even sides: video codecs want them
    }
    controls.enabled = false
    rec.start(250)
    const t0 = performance.now()
    await new Promise((resolve, reject) => {
      const step = (now) => {
        try {
          const t = (now - t0) / 1000
          if (isCancelled && isCancelled()) {
            cancelled = true
            return resolve()
          }
          if (t >= seconds) return resolve()
          if (turn) turn.rotateTo((2 * Math.PI * t) / seconds)
          else {
            camera.position.copy(target).add(offset.clone().applyAxisAngle(up, (2 * Math.PI * t) / seconds))
            camera.lookAt(target)
          }
          renderer.render(scene, camera)
          if (track.requestFrame) track.requestFrame()
          if (onProgress) onProgress(t)
          requestAnimationFrame(step)
        } catch (e) {
          reject(e) // a throw inside the frame callback would otherwise leave the export waiting forever
        }
      }
      requestAnimationFrame(step)
    })
    if (rec.state !== 'inactive') rec.stop()
    await stopped
  } finally {
    if (rec.state !== 'inactive') {
      try {
        rec.stop()
      } catch {
        // already stopped
      }
    }
    controls.enabled = keepEnabled
    if (turn) turn.reset()
    renderer.setPixelRatio(prevRatio)
    renderer.setSize(prevSize.x, prevSize.y, false)
    if (onRestore) onRestore()
    camera.position.copy(target).add(offset)
    camera.lookAt(target)
    controls.update()
    for (const tr of stream.getTracks()) tr.stop()
  }
  if (cancelled) return null
  return new Uint8Array(await new Blob(chunks, { type: 'video/webm' }).arrayBuffer())
}

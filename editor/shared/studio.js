// Shared by 3D Model Viewer and STEP Viewer 3D (canonical copy: plugins/_shared; do not edit the copies in editor/shared).
// The three.js side of the Studio look: background, a floor that only catches shadows, key / fill / rim lights, a procedural room for
// reflections (no picture, no network), tone mapping, and the turntable. "Original" leaves everything as the viewer always was.
import * as THREE from 'three'
import { floorSpec, gradientStops, lightPlacement, normalizeStudio, presetState, receivesShadow, shadowPolicy, spinAngle, studioActive } from './studio-core.js'

const TONE = { none: THREE.NoToneMapping, neutral: THREE.NeutralToneMapping, aces: THREE.ACESFilmicToneMapping, agx: THREE.AgXToneMapping }

/** A small photo studio as a scene: gray room, a big softbox above, panels on both sides and behind. Turned into a reflection map by PMREM. */
function roomScene() {
  const s = new THREE.Scene()
  const room = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.35, 0.35, 0.36), side: THREE.BackSide }))
  room.scale.setScalar(40)
  s.add(room)
  const panel = (w, h, x, y, z, rx, ry, power) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(power, power, power), side: THREE.DoubleSide }))
    m.position.set(x, y, z)
    m.rotation.set(rx, ry, 0)
    s.add(m)
  }
  panel(22, 22, 0, 19.5, 0, Math.PI / 2, 0, 9) // above
  panel(10, 18, -19.5, 4, 2, 0, Math.PI / 2, 5) // left
  panel(10, 18, 19.5, 4, 2, 0, Math.PI / 2, 5) // right
  panel(26, 6, 0, 8, -19.5, 0, 0, 3.5) // behind
  panel(30, 30, 0, -19.5, 0, Math.PI / 2, 0, 0.6) // floor bounce
  return s
}

export function gradientTexture(top, bottom) {
  const c = document.createElement('canvas')
  c.width = 2
  c.height = 256
  const g = c.getContext('2d')
  const grad = g.createLinearGradient(0, 0, 0, 256)
  grad.addColorStop(0, top)
  grad.addColorStop(1, bottom)
  g.fillStyle = grad
  g.fillRect(0, 0, 2, 256)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.minFilter = tex.magFilter = THREE.LinearFilter
  tex.generateMipmaps = false
  return tex
}

/**
 * ctx: { scene, camera, renderer, controls, spinRoot (a Group that holds the model's root: the turntable turns it), modelRoot,
 *        baseLights: the viewer's own lights (switched off while the studio is on), getBox() -> Box3 of what is shown (world, Y up),
 *        getStats() -> { tris, points, splat }, requestRender(), canvas }
 */
export function createStudio(ctx) {
  const { scene, camera, renderer, controls, spinRoot, baseLights, canvas } = ctx
  let state = normalizeStudio(undefined)
  let policy = shadowPolicy({})
  let pmrem = null
  let envTex = null
  let bgTex = null
  let bgKey = ''
  const group = new THREE.Group()
  group.name = 'studio'
  group.visible = false
  scene.add(group)
  const mk = (cast) => {
    const l = new THREE.DirectionalLight(0xffffff, 1)
    l.castShadow = cast
    group.add(l, l.target)
    return l
  }
  const key = mk(true)
  const fill = mk(false)
  const rim = mk(false)
  const contact = mk(true) // straight above, no light of its own: only its wide, soft shadow darkens the floor under the model
  contact.intensity = 0
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShadowMaterial({ color: 0x000000, opacity: 0.35, transparent: true }))
  floor.rotation.x = -Math.PI / 2
  floor.receiveShadow = true
  floor.renderOrder = -1
  group.add(floor)
  const prev = { tone: renderer.toneMapping, exposure: renderer.toneMappingExposure, shadows: renderer.shadowMap.enabled, type: renderer.shadowMap.type, auto: renderer.shadowMap.autoUpdate }

  function ensureEnv() {
    if (envTex) return
    pmrem = new THREE.PMREMGenerator(renderer)
    const rs = roomScene()
    envTex = pmrem.fromScene(rs, 0.04).texture
    rs.traverse((o) => {
      if (o.geometry) o.geometry.dispose()
      if (o.material) o.material.dispose()
    })
  }

  function setCasting(on) {
    const box = ctx.getBox()
    const receive = on && policy.mode === 'live' && box && !box.isEmpty() && receivesShadow(box) // not for heavy meshes: every fragment would sample the shadow map // a flat, wide scene hides its floor: it catches shadows itself
    ctx.modelRoot.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = on
        o.receiveShadow = !!receive
      }
    })
  }

  /** What the page needs to know about the background: undefined (not the studio's business), a Color/Texture, or null (transparent). */
  function background() {
    if (!studioActive(state)) return undefined
    if (state.bg.type === 'transparent') {
      if (bgTex) {
        bgTex.dispose()
        bgTex = null
        bgKey = ''
      }
      return null
    }
    if (state.bg.type === 'gradient') {
      const [a, b] = gradientStops(state.bg)
      const keyOf = `${a}|${b}`
      if (!bgTex || bgKey !== keyOf) {
        const old = bgTex
        bgTex = gradientTexture(a, b)
        bgKey = keyOf
        if (old) setTimeout(() => old.dispose(), 100) // the renderer may still hold it for a frame
      }
      return bgTex
    }
    if (bgTex) {
      bgTex.dispose()
      bgTex = null
      bgKey = ''
    }
    return new THREE.Color(state.bg.color)
  }

  /** Whether the studio background is dark (for lines and grids drawn on it); null when the studio does not decide (off, transparent). */
  function isDark() {
    if (!studioActive(state) || state.bg.type === 'transparent') return null
    const lum = (hexc) => {
      const n = parseInt(hexc.slice(1), 16)
      return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255
    }
    const l = state.bg.type === 'gradient' ? (lum(state.bg.color) + lum(state.bg.color2)) / 2 : lum(state.bg.color)
    return l < 0.45
  }

  function place() {
    const box = ctx.getBox()
    if (!box || box.isEmpty()) return
    const f = floorSpec(box)
    floor.position.set(f.cx, f.y, f.cz)
    floor.scale.set(f.size, f.size, 1)
    floor.visible = state.floor
    floor.material.opacity = state.shadow
    for (const [l, spec] of [[key, state.key], [fill, state.fill], [rim, state.rim]]) {
      const p = lightPlacement(box, spec)
      l.intensity = spec.intensity
      l.position.set(...p.position)
      l.target.position.set(...p.target)
      l.target.updateMatrixWorld()
      const cam = l.shadow.camera
      cam.left = cam.bottom = -p.shadowExtent
      cam.right = cam.top = p.shadowExtent
      cam.near = p.near
      cam.far = p.far
      if (spec.elevation > 80) cam.up.set(0, 0, -1) // looking (almost) straight down: "up" must not be the view direction
      else cam.up.set(0, 1, 0)
      cam.updateProjectionMatrix()
    }
    const c = lightPlacement(box, { intensity: 0, azimuth: 0, elevation: 90 })
    contact.position.set(...c.position)
    contact.target.position.set(...c.target)
    contact.target.updateMatrixWorld()
    const cc = contact.shadow.camera
    cc.left = cc.bottom = -c.shadowExtent
    cc.right = cc.top = c.shadowExtent
    cc.near = c.near
    cc.far = c.far
    cc.up.set(0, 0, -1) // looking straight down: "up" must not be the view direction
    cc.updateProjectionMatrix()
  }

  function configureShadows() {
    const st = ctx.getStats()
    policy = shadowPolicy({ ...st, quality: state.quality })
    const on = studioActive(state) && state.floor && policy.enabled
    renderer.shadowMap.enabled = on || prev.shadows
    renderer.shadowMap.type = on ? THREE.VSMShadowMap : prev.type
    renderer.shadowMap.autoUpdate = on ? policy.mode === 'live' : prev.auto
    for (const [l, size, radius, samples] of [[key, policy.mapSize, state.quality === 'high' ? 8 : 5, 12], [contact, policy.mapSize / 2, state.quality === 'high' ? 24 : 14, 12]]) {
      l.castShadow = on
      if (l.shadow.mapSize.x !== size) {
        l.shadow.mapSize.set(size, size)
        if (l.shadow.map) {
          l.shadow.dispose()
        }
      }
      l.shadow.radius = radius
      l.shadow.blurSamples = samples
      l.shadow.bias = -0.002
    }
    setCasting(on)
    renderer.shadowMap.needsUpdate = true
    return on
  }

  /** Apply the whole state to the scene (after any change, and after a model came or went). */
  function apply() {
    const active = studioActive(state)
    if (!active) stopSpin()
    group.visible = active
    for (const l of baseLights) l.visible = !active
    if (active) {
      ensureEnv()
      scene.environment = envTex
      scene.environmentIntensity = state.env
      renderer.toneMapping = TONE[state.tone]
      renderer.toneMappingExposure = state.exposure
      place()
    } else {
      scene.environment = null
      renderer.toneMapping = prev.tone
      renderer.toneMappingExposure = prev.exposure
      setCasting(false)
      for (const l of [key, contact]) l.shadow.dispose() // the shadow maps are not kept while the look is off
    }
    configureShadows()
    ctx.canvas.dataset.studio = active ? state.preset : 'off'
    canvas.classList.toggle('studio-clear', active && state.bg.type === 'transparent')
    ctx.requestRender()
  }

  // ---------- turntable ----------
  const spin = { running: false, angle: 0, last: 0, raf: 0, pivot: new THREE.Vector3() }
  const setSpinAngle = (a) => {
    spin.angle = a
    const m = new THREE.Matrix4().makeTranslation(spin.pivot.x, spin.pivot.y, spin.pivot.z)
    m.multiply(new THREE.Matrix4().makeRotationY(a)).multiply(new THREE.Matrix4().makeTranslation(-spin.pivot.x, -spin.pivot.y, -spin.pivot.z))
    spinRoot.matrixAutoUpdate = false
    spinRoot.matrix.copy(m)
    spinRoot.matrixWorldNeedsUpdate = true
    spinRoot.updateMatrixWorld(true)
  }
  function spinBegin() {
    stopSpin() // a live turn and a film must not fight over the angle
    const box = ctx.getBox()
    if (box && !box.isEmpty()) box.getCenter(spin.pivot)
    setSpinAngle(0)
    return { rotateTo: (a) => { setSpinAngle(a); renderer.shadowMap.needsUpdate = true }, reset: () => { setSpinAngle(0); renderer.shadowMap.needsUpdate = true; ctx.requestRender() } }
  }
  function startSpin(onStop) {
    if (spin.running) return
    const h = spinBegin()
    spin.running = true
    spin.last = performance.now()
    let t = 0
    const step = (now) => {
      if (!spin.running) return
      t += Math.min((now - spin.last) / 1000, 0.1)
      spin.last = now
      h.rotateTo(spinAngle(state.spinSpeed, t))
      renderer.render(scene, camera)
      spin.raf = requestAnimationFrame(step)
    }
    spin.raf = requestAnimationFrame(step)
    spin.handle = h
    spin.onStop = onStop
  }
  function stopSpin() {
    if (!spin.running) return
    spin.running = false
    cancelAnimationFrame(spin.raf)
    if (spin.handle) spin.handle.reset()
    if (spin.onStop) spin.onStop()
  }

  return {
    get state() {
      return state
    },
    /** Replaces the state (it is made safe first) and applies it. */
    set(next) {
      state = normalizeStudio(next, state.preset)
      apply()
      return state
    },
    preset(id) {
      const keep = { quality: state.quality, spinSpeed: state.spinSpeed }
      state = normalizeStudio({ ...presetState(id), ...keep })
      apply()
      return state
    },
    isActive: () => studioActive(state),
    background,
    isDark,
    /** After a model was loaded, changed or its parts moved: floor level, lights and shadows follow. */
    refresh: apply,
    /** The shadow map is only redrawn when asked (a heavy model): parts moved, shown or hidden. */
    dirty() {
      renderer.shadowMap.needsUpdate = true
      ctx.requestRender()
    },
    policy: () => policy,
    spin: { start: startSpin, stop: stopSpin, isRunning: () => spin.running, begin: spinBegin },
    group,
    floor,
    lights: { key, fill, rim, contact },
    dispose() {
      stopSpin()
      if (bgTex) bgTex.dispose()
      if (envTex) envTex.dispose()
      if (pmrem) pmrem.dispose()
    }
  }
}

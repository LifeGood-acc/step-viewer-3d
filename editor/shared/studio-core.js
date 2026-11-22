// Shared by 3D Model Viewer and STEP Viewer 3D (canonical copy: plugins/_shared; do not edit the copies in editor/shared).
// The pure part of the "Studio" look (no DOM, no three.js): presets, clamping of what was stored, where the floor and the lights go,
// camera presets for product shots, and the rule for when shadows are drawn at all.

export const TONE_MAPPINGS = ['none', 'neutral', 'aces', 'agx']
export const PRESET_IDS = ['original', 'product_white', 'studio_dark', 'gradient_grey', 'soft_daylight']
const HEX = /^#[0-9a-f]{6}$/i

const light = (intensity, azimuth, elevation) => ({ intensity, azimuth, elevation })
const base = {
  bg: { type: 'solid', color: '#ffffff', color2: '#9aa0a8' },
  floor: true,
  shadow: 0.35,
  key: light(2.1, -35, 50),
  fill: light(0.7, 45, 20),
  rim: light(1.2, 160, 35),
  env: 0.8,
  exposure: 1,
  tone: 'neutral',
  quality: 'low',
  spinSpeed: 30
}
const PRESETS = {
  original: { ...base, preset: 'original' },
  product_white: { ...base, preset: 'product_white' },
  studio_dark: { ...base, preset: 'studio_dark', bg: { type: 'solid', color: '#1b1d21', color2: '#3a3e45' }, shadow: 0.6, key: light(2.2, -40, 45), fill: light(0.4, 50, 15), rim: light(2, 165, 30), env: 0.5, tone: 'aces' },
  gradient_grey: { ...base, preset: 'gradient_grey', bg: { type: 'gradient', color: '#eceef1', color2: '#8e949c' }, shadow: 0.4 },
  soft_daylight: { ...base, preset: 'soft_daylight', bg: { type: 'gradient', color: '#fbfcfd', color2: '#d3e1ee' }, shadow: 0.25, key: light(1.8, -60, 35), fill: light(1.2, 55, 25), rim: light(0.6, 150, 30), env: 1.2, tone: 'agx' }
}

const num = (v, lo, hi, fallback) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback)
const hex = (v, fallback) => (typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : fallback)
const oneOf = (v, list, fallback) => (list.includes(v) ? v : fallback)

/** A fresh copy of a preset ('original' when the id is unknown). */
export function presetState(id) {
  const p = PRESETS[id] || PRESETS.original
  return JSON.parse(JSON.stringify(p))
}

/** Whatever was stored or typed, made safe: every number clamped, unknown words replaced by the preset's value. */
export function normalizeStudio(raw, fallbackId = 'original') {
  const r = raw && typeof raw === 'object' ? raw : {}
  const d = presetState(PRESET_IDS.includes(r.preset) || r.preset === 'custom' ? (r.preset === 'custom' ? 'product_white' : r.preset) : fallbackId)
  const lightOf = (x, def) => {
    const o = x && typeof x === 'object' ? x : {}
    return { intensity: num(o.intensity, 0, 8, def.intensity), azimuth: num(o.azimuth, -180, 180, def.azimuth), elevation: num(o.elevation, 0, 90, def.elevation) }
  }
  const bg = r.bg && typeof r.bg === 'object' ? r.bg : {}
  return {
    preset: r.preset === 'custom' ? 'custom' : d.preset,
    bg: { type: oneOf(bg.type, ['solid', 'gradient', 'transparent'], d.bg.type), color: hex(bg.color, d.bg.color), color2: hex(bg.color2, d.bg.color2) },
    floor: typeof r.floor === 'boolean' ? r.floor : d.floor,
    shadow: num(r.shadow, 0, 1, d.shadow),
    key: lightOf(r.key, d.key),
    fill: lightOf(r.fill, d.fill),
    rim: lightOf(r.rim, d.rim),
    env: num(r.env, 0, 3, d.env),
    exposure: num(r.exposure, 0.2, 3, d.exposure),
    tone: oneOf(r.tone, TONE_MAPPINGS, d.tone),
    quality: oneOf(r.quality, ['low', 'high'], d.quality),
    spinSpeed: num(r.spinSpeed, 5, 90, d.spinSpeed)
  }
}

/** "Original" is the look the viewer always had: nothing of the studio is applied. */
export const studioActive = (s) => s.preset !== 'original'

/** Unit vector pointing from the model towards a light: azimuth 0 is the front (+z), positive turns to the right (+x), elevation above the floor. */
export function lightDirection(azimuthDeg, elevationDeg) {
  const a = (azimuthDeg * Math.PI) / 180
  const e = (elevationDeg * Math.PI) / 180
  return [Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)]
}

const diagOf = (box) => Math.hypot(box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z) || 1

/** The floor that catches the shadow: its level is the model's lowest point (a hair under it), centred under the model. */
export function floorSpec(box) {
  const diag = diagOf(box)
  const ext = Math.max(box.max.x - box.min.x, box.max.z - box.min.z, diag * 0.5)
  return { y: box.min.y - diag * 1e-4, cx: (box.min.x + box.max.x) / 2, cz: (box.min.z + box.max.z) / 2, size: ext * 8 }
}

/** Where one directional light stands and how big its shadow camera is, for a model in `box`. */
export function lightPlacement(box, light) {
  const diag = diagOf(box)
  const dir = lightDirection(light.azimuth, light.elevation)
  const c = [(box.min.x + box.max.x) / 2, (box.min.y + box.max.y) / 2, (box.min.z + box.max.z) / 2]
  const dist = diag * 3
  return { dir, target: c, position: c.map((v, i) => v + dir[i] * dist), shadowExtent: diag * 0.9, near: diag * 0.2, far: dist + diag * 1.5 }
}

/** Camera presets for product shots: the camera position and the point it looks at, for a bounding box and the view's aspect ratio. */
export const CAMERA_PRESETS = {
  three_quarter: { dir: [0.7, 0.5, 0.9], scale: 1 },
  front: { dir: [0, 0.12, 1], scale: 1 },
  top: { dir: [0, 1, 0.0001], scale: 1 },
  hero: { dir: [0.45, 0.16, 1], scale: 0.82 }
}
export function cameraPreset(name, box, fovDeg, aspect) {
  const p = CAMERA_PRESETS[name] || CAMERA_PRESETS.three_quarter
  const diag = diagOf(box)
  const l = Math.hypot(...p.dir)
  const v = (fovDeg * Math.PI) / 180
  const h = 2 * Math.atan(Math.tan(v / 2) * Math.max(aspect, 0.05))
  const dist = ((diag / 2) * 1.08 * p.scale) / Math.sin(Math.min(v, h) / 2)
  const target = [(box.min.x + box.max.x) / 2, (box.min.y + box.max.y) / 2, (box.min.z + box.max.z) / 2]
  return { target, position: target.map((c, i) => c + (p.dir[i] / l) * dist) }
}

export const SHADOW_TRIS_LIVE = 1_000_000 // up to here the shadow map is drawn every frame
export const SHADOW_TRIS_MAX = 3_000_000 // above this no shadow at all

/**
 * Whether and how shadows are drawn. Point clouds and splats cast none (a shadow of points is noise and costs a full extra pass);
 * a very heavy mesh none either; a heavy one gets a shadow that is only redrawn when the lights, the model or the parts change
 * ('static'), because the camera does not move shadows. `note` names the reason for the hint under the switch.
 */
export function shadowPolicy({ tris = 0, points = 0, splat = false, quality = 'low' }) {
  const mapSize = quality === 'high' ? 2048 : 1024
  if (splat) return { enabled: false, mode: 'off', note: 'splat', mapSize }
  if (points > 0 && tris === 0) return { enabled: false, mode: 'off', note: 'points', mapSize }
  if (tris > SHADOW_TRIS_MAX) return { enabled: false, mode: 'off', note: 'huge', mapSize }
  if (tris > SHADOW_TRIS_LIVE) return { enabled: true, mode: 'static', note: 'static', mapSize }
  return { enabled: true, mode: 'live', note: null, mapSize }
}

/** Turntable: the angle (radians) after `seconds` at `degPerSecond`. */
export const spinAngle = (degPerSecond, seconds) => (degPerSecond * seconds * Math.PI) / 180

/** CSS colours of a gradient background, top and bottom. */
export const gradientStops = (bg) => [bg.color, bg.color2]

/**
 * Whether the model itself receives shadows. A flat, wide scene (a landscape, a stage set) hides its own floor, so the shadow the floor
 * would catch is never seen: there the model catches shadows too. A compact object does not (its floor shows the shadow, and a model that
 * shades itself with a soft shadow map only gets spots). `box` is the bounds in view axes (Y up).
 */
export function receivesShadow(box) {
  const w = Math.max(box.max.x - box.min.x, box.max.z - box.min.z)
  const h = box.max.y - box.min.y
  return w > 0 && w >= 3 * h
}

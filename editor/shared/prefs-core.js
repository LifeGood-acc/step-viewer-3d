// Shared by 3D Model Viewer and STEP Viewer 3D (canonical copy: plugins/_shared; do not edit the copies in editor/shared).
// What the viewers remember, in one place: one version field, one background model, the migration of older records and the real "reset all".
// Pure (no DOM, no storage): tested in Node (prefs-core.test.mjs). Changes are additive: a key an older version wrote stays, so a downgrade works (except `custom`: an older version does not know it and falls back to the look).

export const PREFS_VERSION = 3

/** The background: the look's own, Orca's theme, or one of the fixed ones. One list, one meaning. */
export const BG_MODES = ['look', 'orca', 'light', 'dark', 'white', 'gradient', 'transparent', 'custom']
/** What the Studio menu shows and the key B steps through: five visibly different backgrounds (look, light and dark stay valid for stored choices). */
export const BG_CYCLE = ['orca', 'white', 'gradient', 'transparent', 'custom']
export const BG_CUSTOM_DEFAULT = '#8fa3bf'
/** The colours of "like Orca" (light and dark): one source for the scene (background-three.js) and for the swatch in the Studio menu (chrome-layout.js). */
export const ORCA_BG = { light: '#eceef1', dark: '#15171a' }
const HEX = /^#[0-9a-fA-F]{6}$/
/** The own background colour of a record (a #rrggbb string), else the default. */
export const bgColorOf = (raw) => (isObj(raw) && isObj(raw.bgm) && HEX.test(raw.bgm.color) ? raw.bgm.color.toLowerCase() : BG_CUSTOM_DEFAULT)
/** The background that key B shows after `mode` (look, light and dark count as Orca: the next one is white, a visible change). */
export function nextBgMode(mode) {
  const i = BG_CYCLE.indexOf(BG_CYCLE.includes(mode) ? mode : 'orca')
  return BG_CYCLE[(i + 1) % BG_CYCLE.length]
}
/** Whether a #rrggbb colour is dark (relative luminance under one half). */
export function colorIsDark(hex) {
  const n = parseInt(HEX.test(hex) ? hex.slice(1) : '000000', 16)
  const lin = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255) < 0.18
}

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v)

/** The background mode from a record of any age. Old `bg` ('light'|'dark', set by the button) wins over the look, as the button did. */
export function bgModeOf(raw) {
  const r = isObj(raw) ? raw : {}
  const m = isObj(r.bgm) ? r.bgm.mode : undefined
  // light, dark and look are also written to the old key `bg` (withBg), and an older build only changes that one: for these three it decides
  if (BG_MODES.includes(m) && !['look', 'light', 'dark'].includes(m)) return m
  if (r.bg === 'light' || r.bg === 'dark') return r.bg
  return 'look'
}

/**
 * Bring a stored record to the current shape. Returns a new object; the input is not changed. Unknown keys are kept; `bg` (old) and
 * `studio.bg` (the look's own background) are kept untouched, so an older version still finds what it wrote.
 */
export function migratePrefs(raw) {
  const r = isObj(raw) ? { ...raw } : {}
  if (Number(r.v) > PREFS_VERSION) return r // written by a newer version: left exactly as it is
  r.bgm = { mode: bgModeOf(r) }
  if (isObj(raw) && isObj(raw.bgm) && HEX.test(raw.bgm.color)) r.bgm.color = bgColorOf(raw) // the own colour stays, also while another background is on
  r.v = PREFS_VERSION
  return r
}

/** Whether a record is from a newer version (the viewers then do not write it back). */
export const isNewerPrefs = (raw) => isObj(raw) && Number(raw.v) > PREFS_VERSION

/** Writes the background choice in the new key and in the old one where the old one can say it (light, dark), so a downgrade keeps working. */
export function withBg(prefs, mode, color) {
  const m = BG_MODES.includes(mode) ? mode : 'look'
  const next = { ...prefs, bgm: { mode: m }, v: PREFS_VERSION }
  const own = HEX.test(color) ? color.toLowerCase() : isObj(prefs) && isObj(prefs.bgm) && HEX.test(prefs.bgm.color) ? prefs.bgm.color : null
  if (own) next.bgm.color = own
  if (m === 'light' || m === 'dark') next.bg = m
  else delete next.bg
  return next
}

/** The switches of a freshly opened viewer (the standard values of the concept, §4d). */
export function defaultState() {
  return { wire: false, tex: true, grid: true, axes: true, box: false, over: false, back: true, pointSize: 2, tint: false, shading: 'original', opacity: 1, edges: true, bgMode: 'look' }
}

/** What "reset all" leaves in storage: only the version and the standard background. Everything else (look, view, layout, up) goes. */
export function resetPrefs() {
  return { v: PREFS_VERSION, bgm: { mode: 'look' } }
}

/**
 * Whether the background of a mode is dark (the grid and the CAD edges contrast with it). studioDark: the look's answer, null when no look
 * decides (off, or transparent); a transparent look shows a light checker pattern, whatever the theme says.
 */
export function bgIsDark(mode, { themeDark = false, studioDark = null, lookTransparent = false, customColor = BG_CUSTOM_DEFAULT } = {}) {
  if (mode === 'dark') return true
  if (mode === 'custom') return colorIsDark(customColor)
  if (mode === 'light' || mode === 'white' || mode === 'gradient' || mode === 'transparent') return false
  if (mode === 'look') {
    if (lookTransparent) return false
    if (studioDark !== null) return studioDark
  }
  return themeDark
}

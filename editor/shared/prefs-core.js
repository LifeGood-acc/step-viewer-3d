// Shared by 3D Model Viewer and STEP Viewer 3D (canonical copy: plugins/_shared; do not edit the copies in editor/shared).
// What the viewers remember, in one place: one version field, one background model, the migration of older records and the real "reset all".
// Pure (no DOM, no storage): tested in Node (prefs-core.test.mjs). Changes are additive: a key an older version wrote stays, so a downgrade works.

export const PREFS_VERSION = 3

/** The background: the look's own, Orca's theme, or one of the fixed ones. One list, one meaning. */
export const BG_MODES = ['look', 'orca', 'light', 'dark', 'white', 'gradient', 'transparent']

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
  r.v = PREFS_VERSION
  return r
}

/** Whether a record is from a newer version (the viewers then do not write it back). */
export const isNewerPrefs = (raw) => isObj(raw) && Number(raw.v) > PREFS_VERSION

/** Writes the background choice in the new key and in the old one where the old one can say it (light, dark), so a downgrade keeps working. */
export function withBg(prefs, mode) {
  const m = BG_MODES.includes(mode) ? mode : 'look'
  const next = { ...prefs, bgm: { mode: m }, v: PREFS_VERSION }
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
export function bgIsDark(mode, { themeDark = false, studioDark = null, lookTransparent = false } = {}) {
  if (mode === 'dark') return true
  if (mode === 'light' || mode === 'white' || mode === 'gradient' || mode === 'transparent') return false
  if (mode === 'look') {
    if (lookTransparent) return false
    if (studioDark !== null) return studioDark
  }
  return themeDark
}

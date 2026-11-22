// Shared by 3D Model Viewer and STEP Viewer 3D (canonical copy: plugins/_shared; do not edit the copies in editor/shared).
// The keyboard shortcuts as data and one pure function: `keyAction(event)` says which action a key press means (or null: not ours).
// The viewers map the action names to what they do; an action a viewer does not have is simply ignored there.

/** key (lower case) -> action name. The digits are the camera views, in the order of the "View" menu. */
export const KEYMAP = {
  '+': 'zoom_in',
  '=': 'zoom_in',
  '-': 'zoom_out',
  1: 'view_iso',
  2: 'view_front',
  3: 'view_back',
  4: 'view_left',
  5: 'view_right',
  6: 'view_top',
  7: 'view_bottom',
  8: 'view_hero',
  r: 'view_all',
  f: 'fit_selected',
  i: 'isolate',
  m: 'measure',
  l: 'studio',
  e: 'export',
  w: 'mesh',
  t: 'texture',
  g: 'grid',
  b: 'background',
  p: 'panel',
  escape: 'escape'
}

/** The camera view names behind view_<name>, in the key order 1..8. */
export const VIEW_NAMES = ['iso', 'front', 'back', 'left', 'right', 'top', 'bottom', 'hero']

/** Actions that switch something: a key held down must not flip them back and forth. */
export const NO_REPEAT = new Set(['studio', 'mesh', 'texture', 'grid', 'background', 'panel', 'measure', 'export', 'isolate'])

/**
 * ev: a key event or a plain object with { key, metaKey, ctrlKey, altKey, shiftKey, repeat, target: { tagName, type, isContentEditable } }.
 * Returns { action, shift } or null: a modifier is down, the focus is in a text field, a list or a text area (typing is not a shortcut),
 * the key has no action, or it is a repeat of a switching key.
 */
export function keyAction(ev) {
  if (ev.metaKey || ev.ctrlKey || ev.altKey) return null
  const t = ev.target || {}
  const tag = String(t.tagName || '').toUpperCase()
  if (tag === 'SELECT' || tag === 'TEXTAREA' || (tag === 'INPUT' && t.type !== 'checkbox' && t.type !== 'range' && t.type !== 'radio') || t.isContentEditable) return null
  const key = String(ev.key || '').toLowerCase()
  const action = Object.prototype.hasOwnProperty.call(KEYMAP, key) ? KEYMAP[key] : null
  if (!action) return null
  if (ev.repeat && NO_REPEAT.has(action)) return null
  return { action, shift: !!ev.shiftKey }
}

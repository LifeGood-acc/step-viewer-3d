// Shared by 3D Model Viewer and STEP Viewer 3D (canonical copy: plugins/_shared; do not edit the copies in editor/shared).
// "Copy details": the Details rows as plain text (no model data), put on the clipboard with execCommand('copy'), which is what a frame without
// permissions may do inside a click.

/** rows: [[label, value], ...] -> text with aligned columns; `title` is the first line. */
export function detailsText(title, rows) {
  const w = Math.max(0, ...rows.map(([k]) => String(k).length))
  return [title, ...rows.map(([k, v]) => `${String(k).padEnd(w)}  ${v}`)].join('\n') + '\n'
}

/** true when the text was copied. Must run inside a click or key press. */
export function copyText(text) {
  const ta = document.createElement('textarea')
  ta.value = text
  ta.setAttribute('readonly', '')
  ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0'
  document.body.append(ta)
  const keep = document.activeElement
  ta.select()
  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch {
    ok = false
  }
  ta.remove()
  if (keep && keep.focus) keep.focus({ preventScroll: true })
  return ok
}

// Shared by 3D Model Viewer and STEP Viewer 3D (canonical copy: plugins/_shared; do not edit the copies in editor/shared).
// A question with two answers, drawn by the page itself (window.confirm may be blocked in a sandboxed frame). Safe by default: the focus starts
// on "Cancel", Escape and a click outside mean "Cancel", Enter presses whatever has the focus (never "Close" on its own).

/**
 * options: { title, text, confirmLabel, cancelLabel, danger = true }. Resolves true (confirmed) or false (cancelled). One dialog at a time:
 * asking again while one is open gives the same answer to both.
 */
let open = null
export function askConfirm({ title, text, confirmLabel, cancelLabel, danger = true }) {
  if (open) return open.promise
  const previous = document.activeElement
  const behind = [...document.body.children].filter((n) => n.nodeType === 1 && !n.inert)
  for (const n of behind) n.inert = true // nothing behind the question can be reached (keyboard, screen reader)
  const el = (tag, props = {}, ...kids) => {
    const e = Object.assign(document.createElement(tag), props)
    e.append(...kids)
    return e
  }
  const ok = el('button', { type: 'button', className: danger ? 'danger' : '', textContent: confirmLabel })
  const cancel = el('button', { type: 'button', textContent: cancelLabel })
  const card = el('div', { className: 'confirm-card' }, el('div', { id: 'confirm-title', className: 'confirm-title', textContent: title }), el('p', { id: 'confirm-text', textContent: text }), el('div', { className: 'row wrap confirm-buttons' }, ok, cancel))
  const box = el('div', { id: 'confirm', className: 'confirm', role: 'alertdialog' }, card)
  box.setAttribute('aria-modal', 'true')
  box.setAttribute('aria-labelledby', 'confirm-title')
  box.setAttribute('aria-describedby', 'confirm-text')
  let done
  const promise = new Promise((resolve) => (done = resolve))
  const finish = (answer) => {
    box.removeEventListener('keydown', onKey, true)
    box.remove()
    for (const n of behind) n.inert = false
    open = null
    if (previous && previous.focus) previous.focus({ preventScroll: true })
    done(answer)
  }
  function onKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      finish(false)
    } else if (e.key === 'Tab') {
      // the focus stays inside: two buttons, round and round
      e.preventDefault()
      ;(document.activeElement === cancel ? ok : cancel).focus()
    } else e.stopPropagation() // no shortcut of the page while the question is open
  }
  ok.onclick = () => finish(true)
  cancel.onclick = () => finish(false)
  box.addEventListener('click', (e) => e.target === box && finish(false))
  box.addEventListener('keydown', onKey, true)
  document.body.append(box)
  cancel.focus()
  open = { promise }
  return promise
}

/** True while the question is on screen (the page's own key handler stays quiet then). */
export const confirmOpen = () => open !== null

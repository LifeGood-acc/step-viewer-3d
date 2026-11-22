// Shared by 3D Model Viewer and STEP Viewer 3D (canonical copy: plugins/_shared; do not edit the copies in editor/shared).
// Layout behaviour: toolbar overflow ("More" menu), side panel (open/close, drag-to-resize, collapsible sections, all remembered),
// narrow mode. The page supplies the markup (see index.html) and decides what the buttons do.
import { createPopoverGroup } from './popover.js'
const $ = (id) => document.getElementById(id)
export const NARROW_AT = 520 // px of the view+panel area: below it everything is one column

/** getPrefs() returns the live preferences object, savePrefs() stores it; onLayout() runs after the size of the view changed. */
export function initShell({ getPrefs, savePrefs, onLayout = () => {}, popovers: sharedPopovers = null }) {
  const body = document.body
  const main = $('main')
  const bar = $('bar')
  const side = $('side')
  const resizer = $('resizer')
  const ui = () => (getPrefs().ui ||= {})

  // ---------- toolbar overflow ----------
  // Elements with data-prio live in .grp groups; the highest numbers go into the More menu first, when the row does not fit.
  const items = [...bar.querySelectorAll('[data-prio]')]
  items.forEach((el, i) => {
    el._home = el.parentNode
    el._i = i
  })
  const wrap = $('more-wrap')
  const menu = $('more-menu')
  const moreBtn = $('b-more')
  let lastBarKey = ''
  function layoutBar(force = true) {
    // Re-parenting drops focus and closes an open menu: only redo it when the available width or a label changed.
    const key = `${bar.clientWidth}|${items.map((el) => el.textContent.length + (el.hidden ? 'h' : '')).join(',')}`
    if (!force && key === lastBarKey) return
    lastBarKey = key
    const hadFocus = menu.contains(document.activeElement) // moving the items drops the focus: it goes to the More button
    for (const el of items) el._home.appendChild(el) // everything back in its own place, in the original order
    closeMenu()
    const expendable = [...items].filter((el) => !el.hidden).sort((a, b) => Number(b.dataset.prio) - Number(a.dataset.prio) || b._i - a._i)
    for (const el of expendable) {
      if (bar.scrollWidth <= bar.clientWidth + 1) break
      menu.appendChild(el)
    }
    // keep the menu in the original order
    ;[...menu.children].filter((el) => el._i !== undefined).sort((a, b) => a._i - b._i).forEach((el) => menu.appendChild(el))
    const fixedPart = menu.querySelector('.more-fixed')
    if (fixedPart) menu.appendChild(fixedPart) // what is always in the menu stays below what moved in
    if (hadFocus && !wrap.hidden) moreBtn.focus()
  }
  // the More menu is the first user of the popover rules (popover.js): one open at most, Esc and a click outside close it, the focus goes back
  const popovers = sharedPopovers || createPopoverGroup() // the toolbar's other popovers share the group: one open at most
  popovers.add({
    id: 'more',
    button: moreBtn,
    panel: menu,
    wrap,
    onOpen: () => {
      menu.style.right = '0px'
      const r = menu.getBoundingClientRect()
      if (r.left < 8) menu.style.right = `${r.left - 8}px` // keep the menu inside the window
      menu.querySelector('button:not(:disabled), select:not(:disabled)')?.focus()
    }
  })
  const closeMenu = () => popovers.close(false)

  // ---------- narrow mode ----------
  let narrow = false
  function applyNarrow() {
    const n = main.clientWidth > 0 && main.clientWidth < NARROW_AT
    if (n !== narrow || !body.dataset.layout) {
      narrow = n
      body.classList.toggle('narrow', n)
      body.dataset.layout = n ? 'narrow' : 'wide'
      resizer.setAttribute('aria-orientation', n ? 'horizontal' : 'vertical')
      applySizes()
      setPanelOpen(wanted(), false)
    }
  }

  // ---------- side panel ----------
  const toggleBtn = $('b-panel')
  const panelKey = () => (narrow ? 'panelNarrow' : 'panelWide')
  const wanted = () => ui()[panelKey()] ?? !narrow // remembered choice; wide: open by default, narrow: closed until asked for
  const isPanelOpen = () => !main.classList.contains('side-closed') // what is on screen (a gate may have opened it for a moment)
  function setPanelOpen(open, remember = true) {
    main.classList.toggle('side-closed', !open)
    toggleBtn.setAttribute('aria-pressed', String(open))
    if (remember) {
      ui()[panelKey()] = open
      savePrefs()
    }
    onLayout()
  }
  toggleBtn.addEventListener('click', () => setPanelOpen(!isPanelOpen()))
  $('side-close').addEventListener('click', () => {
    setPanelOpen(false)
    toggleBtn.focus()
  })

  // ---------- resizing ----------
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
  function applySizes() {
    const u = ui()
    if (u.sideW) main.style.setProperty('--side-w', clamp(u.sideW, 180, Math.max(180, main.clientWidth * 0.7)) + 'px')
    if (u.sideH) main.style.setProperty('--side-h', clamp(u.sideH, 120, Math.max(120, main.clientHeight * 0.6)) + 'px')
  }
  const sizeNow = () => (narrow ? side.getBoundingClientRect().height : side.getBoundingClientRect().width)
  function setSize(px) {
    const r = main.getBoundingClientRect()
    if (narrow) {
      const h = clamp(px, 120, r.height * 0.6)
      main.style.setProperty('--side-h', h + 'px')
      ui().sideH = Math.round(h)
    } else {
      const w = clamp(px, 180, r.width * 0.7)
      main.style.setProperty('--side-w', w + 'px')
      ui().sideW = Math.round(w)
    }
    resizer.setAttribute('aria-valuenow', String(Math.round(sizeNow())))
    onLayout()
  }
  resizer.setAttribute('aria-controls', 'side')
  resizer.setAttribute('aria-valuemin', '120')
  resizer.setAttribute('aria-valuemax', '2000')
  resizer.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return // a right-click is not a drag
    resizer.setPointerCapture(e.pointerId)
    resizer.classList.add('drag')
    e.preventDefault()
  })
  resizer.addEventListener('pointermove', (e) => {
    if (!resizer.classList.contains('drag')) return
    const r = main.getBoundingClientRect()
    setSize(narrow ? r.bottom - e.clientY : r.right - e.clientX)
  })
  const endDrag = () => {
    if (resizer.classList.contains('drag')) {
      resizer.classList.remove('drag')
      savePrefs()
    }
  }
  resizer.addEventListener('pointerup', endDrag)
  resizer.addEventListener('pointercancel', endDrag)
  resizer.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 48 : 16
    const grow = narrow ? 'ArrowUp' : 'ArrowLeft'
    const shrink = narrow ? 'ArrowDown' : 'ArrowRight'
    if (e.key === grow) setSize(sizeNow() + step)
    else if (e.key === shrink) setSize(sizeNow() - step)
    else return
    e.preventDefault()
    savePrefs()
  })
  resizer.addEventListener('dblclick', () => {
    delete ui().sideW
    delete ui().sideH
    main.style.removeProperty('--side-w')
    main.style.removeProperty('--side-h')
    savePrefs()
    onLayout()
    resizer.setAttribute('aria-valuenow', String(Math.round(sizeNow())))
  })

  // ---------- collapsible sections ----------
  for (const d of side.querySelectorAll('details.sec[data-key]')) {
    const saved = (ui().sections || {})[d.dataset.key]
    if (saved !== undefined) d.open = !!saved
    d.addEventListener('toggle', () => {
      ;(ui().sections ||= {})[d.dataset.key] = d.open
      savePrefs()
    })
  }

  // ---------- keeping it all in step ----------
  new ResizeObserver(() => {
    applyNarrow()
    applySizes() // a window that shrank must not leave the panel wider than the room
    onLayout()
  }).observe(main)
  new ResizeObserver(() => layoutBar(false)).observe(bar)
  applySizes()
  applyNarrow()
  layoutBar()
  return {
    layout: () => layoutBar(false), // call after a toolbar label changed length
    isPanelOpen,
    setPanelOpen,
    togglePanel: () => setPanelOpen(!isPanelOpen()),
    isNarrow: () => narrow,
    /** Closes an open popover (Esc reaches the viewer through the key table too): true if one was open. */
    closePopover() {
      const was = popovers.isOpen()
      if (was) popovers.close(true)
      return was
    },
    popovers,
    reset() {
      // forget layout choices (panel width, open sections): used by "Reset settings"
      delete getPrefs().ui
      main.style.removeProperty('--side-w')
      main.style.removeProperty('--side-h')
      for (const d of side.querySelectorAll('details.sec[data-key]')) d.open = d.hasAttribute('data-open-default')
      setPanelOpen(!narrow, false)
    },
    /** Opens a section (collapsed ones hide what they hold), e.g. the memory gate of the STEP viewer. */
    openSection(id) {
      const d = document.getElementById(id)
      if (d && d.tagName === 'DETAILS') d.open = true
      document.dispatchEvent(new CustomEvent('open-section', { detail: id })) // the side tabs show the tab the section is in
    }
  }
}

/** A guard for everything that nobody caught: an error in an event handler or a promise that was never handled. It writes one line to the log that
 *  `orca plugin logs` shows (`<plugin>-state {"state":"error",...}` through console.error, so an agent can find it) and calls `onFatal(message)` so the page can tell
 *  the person. `target` is the window (or anything with addEventListener); `report(message)` defaults to console.error.
 *  Returns a function that takes the guard down again. One message at a time is reported (a loop of errors would flood the log). */
export function installErrorGuard(target, { plugin, onFatal = () => {}, report = (line) => console.error(line) }) {
  let last = ''
  let lastAt = 0
  const handle = (kind, err) => {
    const message = String((err && err.message) || err || 'unknown error').slice(0, 300)
    if (/ResizeObserver loop/.test(message) || err === undefined || err === null) return // harmless browser notices and rejections without a reason (a cancelled host call)
    const now = Date.now()
    if (message === last && now - lastAt < 2000) return
    last = message
    lastAt = now
    report(`${plugin}-state ${JSON.stringify({ state: 'error', kind, why: message })}`)
    try {
      onFatal(message)
    } catch {
      // the guard must never throw itself
    }
  }
  const onError = (e) => handle('error', e && (e.error || e.message))
  const onRejection = (e) => handle('rejection', e && e.reason)
  target.addEventListener('error', onError)
  target.addEventListener('unhandledrejection', onRejection)
  return () => {
    target.removeEventListener('error', onError)
    target.removeEventListener('unhandledrejection', onRejection)
  }
}

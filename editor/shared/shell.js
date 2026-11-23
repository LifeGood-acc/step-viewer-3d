// Shared by 3D Model Viewer and STEP Viewer 3D (canonical copy: plugins/_shared; do not edit the copies in editor/shared).
// Layout behaviour: toolbar overflow ("More" menu), side panel (open/close, drag-to-resize, collapsible sections, all remembered),
// narrow mode. The page supplies the markup (see index.html) and decides what the buttons do.
import { createPopoverGroup } from './popover.js'
const $ = (id) => document.getElementById(id)
export const NARROW_AT = 520 // px of the view+panel area: below it everything is one column
export const THREE_AT = 1200 // px of the view+panel area (the window): from here the cards stand in three columns (list left, view, numbers right); below it the panel is one column with tabs. The e2e tests of 1100/1180 px stay in the one column on purpose.
export const CARD_AT = 700 // px of the view+panel area: from here the view stands as a card (a border, the card rounding, a gap of 8 px: round 5); below it the view runs to the edge of the window (body.stage-card)
export const COL_L_W = 252 // px: the left column of the three-column layout
export const SIDE_MIN = 260 // px: the narrowest the side panel may be (four tabs in whole words, a row of buttons); a stored 180 comes back to this
/** The widest the side panel may be for a view area of this width: seven tenths, but only half where the view is narrow (under CARD_AT = 700 px), never less than SIDE_MIN. */
export const sideMax = (mainWidth) => Math.max(SIDE_MIN, mainWidth * (mainWidth < CARD_AT ? 0.5 : 0.7))

/** The layout for a width of the view+panel area: 'narrow' (the sheet under the view), 'three' (three columns) or 'wide' (one side column with tabs). One function, so that the limits are tested. */
/** Whether the view stands as a card for a width of the view+panel area (the class body.stage-card; the CSS keys on it, never on the window width). */
export const cardFor = (width) => width >= CARD_AT
export const layoutFor = (width) => (width > 0 && width < NARROW_AT ? 'narrow' : width >= THREE_AT ? 'three' : 'wide')

/** getPrefs() returns the live preferences object, savePrefs() stores it; onLayout() runs after the size of the view changed. */
export function initShell({ getPrefs, savePrefs, onLayout = () => {}, popovers: sharedPopovers = null }) {
  const body = document.body
  const main = $('main')
  const bar = $('bar')
  const side = $('side')
  const resizer = $('resizer')
  const ui = () => (getPrefs().ui ||= {})

  // ---------- toolbar overflow ----------
  // The bar gives way in three steps, always by measuring (never by fixed widths): 1. what only has room on a wide bar (data-minw="1300": Open, Diagonal, Front) goes
  // when the bar is narrower than that or does not fit; 2. the words of the buttons go, the symbol stays (data-drop 1, 2, 3: the least used first); 3. what still does
  // not fit goes into the More menu. Elements with data-collapse (a number) and data-proxy (the id of a row of the More menu) stay where they are in the DOM: they get the
  // class "in-more" (the bar hides them) and their row in the More menu is shown instead (the Studio menu, the export dialog, Section). The highest number goes first.
  const items = [...bar.querySelectorAll('[data-prio], [data-collapse]')]
  items.forEach((el, i) => {
    el._home = el.parentNode
    el._i = i
    el._rank = Number(el.dataset.collapse ?? el.dataset.prio)
    el._proxy = el.dataset.proxy ? () => document.getElementById(el.dataset.proxy) : null
  })
  const wideOnly = [...bar.querySelectorAll('[data-minw]')]
  const worded = [...bar.querySelectorAll('[data-drop]')]
  const DROP_STEPS = Math.max(0, ...worded.map((el) => Number(el.dataset.drop))) // one step per button: they give up their word one after the other, so the words stay as long as there is room
  bar.dataset.lvMax = String(DROP_STEPS)
  const wrap = $('more-wrap')
  const menu = $('more-menu')
  const moreBtn = $('b-more')
  let lastBarKey = ''
  function layoutBar(force = true) {
    // Re-parenting drops focus and closes an open menu: only redo it when the available width or a label changed.
    const label = (el) => (el.classList.contains('pop-wrap') ? el.firstElementChild : el).textContent.length // a popover's wrap holds its panel too: only the button's label counts
    const hasModel = document.body.classList.contains('has-model')
    const key = `${bar.clientWidth}|${hasModel}|${[...items, ...wideOnly].map((el) => label(el) + (el.hidden ? 'h' : '')).join(',')}`
    if (!force && key === lastBarKey) return
    lastBarKey = key
    const hadFocus = menu.contains(document.activeElement) // moving the items drops the focus: it goes to the More button
    const focused = document.activeElement && document.activeElement !== document.body && bar.contains(document.activeElement) ? document.activeElement : null
    for (const el of items) {
      if (el._proxy) {
        el.classList.remove('in-more')
        if (el._proxy()) el._proxy().hidden = true
      } else el._home.appendChild(el) // everything back in its own place, in the original order
    }
    if (popovers.isOpen('more')) closeMenu() // only the More menu: Studio or Appearance stay open while the bar is laid out again
    const fits = () => bar.scrollWidth <= bar.clientWidth + 1
    const setWords = (step) => {
      bar.dataset.lv = String(step)
      for (const el of worded) {
        const ico = Number(el.dataset.drop) <= step
        el.classList.toggle('ico', ico) // "ico": the symbol alone
        // a symbol alone has no word to read: the tooltip carries the name in front of the hint (kept to 60 characters, else the name alone)
        if (el._ours === undefined || el.title !== el._ours) el._tip = el.title
        const name = el.getAttribute('aria-label') || ''
        el._ours = ico && name ? (el._tip && !el._tip.toLowerCase().startsWith(name.toLowerCase()) && name.length + 3 + el._tip.length <= 60 ? `${name} – ${el._tip}` : name) : el._tip
        el.title = el._ours
      }
    }
    // data-empty-ok (Open): with no model on show it is the way to open one, so it stays at any width and is the last to go (after the words)
    const keeper = (el) => el.dataset.emptyOk !== undefined && !hasModel
    const setWide = (mode) => {
      for (const el of wideOnly) el.classList.toggle('lo-w', mode === 'none' || (mode === 'keepers' && !keeper(el)) || (mode === 'room' && bar.clientWidth < Number(el.dataset.minw) && !keeper(el)))
    }
    setWords(0)
    setWide('room') // what the bar has room for by width
    if (!fits()) setWide('keepers') // the wide bar's extras go first
    for (let step = 1; step <= DROP_STEPS && !fits(); step++) setWords(step) // then the words, the least used first: the symbol is enough for a button that has a tooltip and a name
    if (!fits()) setWide('none') // last, the way to open a file on an empty bar
    const expendable = [...items].filter((el) => !el.hidden).sort((a, b) => b._rank - a._rank || b._i - a._i)
    for (const el of expendable) {
      if (fits()) break
      if (el._proxy) {
        el.classList.add('in-more')
        if (el._proxy()) el._proxy().hidden = false
      } else menu.appendChild(el)
    }
    // keep the menu in the original order
    ;[...menu.children].filter((el) => el._i !== undefined && !el._proxy).sort((a, b) => a._i - b._i).forEach((el) => menu.appendChild(el))
    const fixedPart = menu.querySelector('.more-fixed')
    if (fixedPart) menu.appendChild(fixedPart) // what is always in the menu stays below what moved in
    if ((hadFocus || (focused && focused.isConnected && focused.offsetParent === null)) && !wrap.hidden) moreBtn.focus() // the focused button went away (into More, or its word and room): the focus goes to More, not to the page
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

  // ---------- narrow mode, three columns ----------
  let narrow = false
  let three = false
  const colL = document.createElement('div') // the left column of the three-column layout (the Parts card moves in, chrome-layout.js)
  colL.id = 'col-l'
  colL.hidden = true
  main.insertBefore(colL, $('stage'))
  function applyNarrow() {
    body.classList.toggle('stage-card', cardFor(main.clientWidth)) // the view as a card: it follows the width of this area, not the window's (the same measure as the layout)
    const mode = layoutFor(main.clientWidth)
    const n = mode === 'narrow'
    const th = mode === 'three'
    if (n !== narrow || th !== three || !body.dataset.layout) {
      narrow = n
      three = th
      body.classList.toggle('narrow', n)
      body.classList.toggle('three', th)
      colL.hidden = !th
      body.dataset.layout = mode
      document.dispatchEvent(new CustomEvent('layout-mode', { detail: body.dataset.layout }))
      resizer.setAttribute('aria-orientation', n ? 'horizontal' : 'vertical')
      resizer.setAttribute('aria-valuemin', n ? '120' : String(SIDE_MIN)) // the panel's height may go down to 120, its width only to SIDE_MIN
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
  const widthKey = () => (three ? 'sideW3' : 'sideW') // the width the person chose is remembered for each layout: a wide panel of the one-column layout must not squeeze the three-column view
  const maxSide = (w) => (three ? Math.max(SIDE_MIN, Math.min(sideMax(w), w - COL_L_W - 360)) : sideMax(w)) // three columns: the view keeps at least 360 px
  function applySizes() {
    const u = ui()
    if (u[widthKey()]) main.style.setProperty('--side-w', clamp(u[widthKey()], SIDE_MIN, maxSide(main.clientWidth)) + 'px')
    else main.style.removeProperty('--side-w') // no choice made for this layout: the layout's own default (three columns: 292 px)
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
      const w = clamp(px, SIDE_MIN, maxSide(r.width))
      main.style.setProperty('--side-w', w + 'px')
      ui()[widthKey()] = Math.round(w)
    }
    resizer.setAttribute('aria-valuenow', String(Math.round(sizeNow())))
    onLayout()
  }
  resizer.setAttribute('aria-controls', 'side')
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
    delete ui()[widthKey()]
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
  new MutationObserver(() => layoutBar(false)).observe(body, { attributes: true, attributeFilter: ['class'] }) // a model came or went: Open on the bar follows
  new MutationObserver(() => layoutBar(false)).observe(bar, { attributes: true, attributeFilter: ['hidden'], subtree: true }) // a button that shows or hides (Section for a toolpath, Open) changes what has to fit; the key keeps it from running for nothing
  applySizes()
  applyNarrow()
  layoutBar()
  return {
    layout: () => layoutBar(false), // call after a toolbar label changed length
    isPanelOpen,
    setPanelOpen,
    togglePanel: () => setPanelOpen(!isPanelOpen()),
    isNarrow: () => narrow,
    isThree: () => three,
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

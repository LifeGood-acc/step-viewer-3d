// Shared by 3D Model Viewer and STEP Viewer 3D (canonical copy: plugins/_shared; do not edit the copies in editor/shared).
// Popovers (a button and the panel it opens) and tabs, as factories: no fixed element ids, the markup is made by the caller or by
// `makePopover`/`makeTabs` here. The rules (exactly one popover open, Esc and a click outside close it, the focus goes back to the button,
// arrow keys move between tabs) are pure functions, tested in Node (popover.test.mjs).

// ---------- pure rules ----------

/** The state is the id of the open popover, or null. Returns { open, focusButton } (the id whose button gets the focus back, or null). */
export function popoverStep(state, action) {
  const open = state && state.open ? state.open : null
  switch (action.type) {
    case 'toggle':
      return open === action.id ? { open: null, focusButton: action.id } : { open: action.id, focusButton: null }
    case 'open':
      return { open: action.id, focusButton: null }
    case 'close':
      return open && (!action.id || action.id === open) ? { open: null, focusButton: action.focus ? open : null } : { open, focusButton: null }
    case 'escape':
      return open ? { open: null, focusButton: open } : { open: null, focusButton: null }
    case 'outside':
      // a click outside every popover closes the open one and leaves the focus where the click put it
      return action.inside ? { open, focusButton: null } : { open: null, focusButton: null }
    case 'choose':
      // a click on an entry that is a button (not a select, not a slider) closes the popover, the focus goes back
      return open && action.closes ? { open: null, focusButton: open } : { open, focusButton: null }
    default:
      return { open, focusButton: null }
  }
}

/** The tab that comes after a key press (arrow keys wrap, Home and End jump), or the same one for another key. `ids` is the list of enabled tabs. */
export function tabsNext(ids, current, key) {
  if (!ids.length) return null
  const i = Math.max(0, ids.indexOf(current))
  if (key === 'ArrowRight' || key === 'ArrowDown') return ids[(i + 1) % ids.length]
  if (key === 'ArrowLeft' || key === 'ArrowUp') return ids[(i - 1 + ids.length) % ids.length]
  if (key === 'Home') return ids[0]
  if (key === 'End') return ids[ids.length - 1]
  return current
}

/** Which tab is active: the remembered one if it exists and is shown, else the preferred default, else the first shown one. */
export function chooseTab(ids, remembered, preferred) {
  if (remembered && ids.includes(remembered)) return remembered
  if (preferred && ids.includes(preferred)) return preferred
  return ids[0] || null
}

// ---------- DOM ----------

const el = (tag, props = {}, ...kids) => {
  const e = Object.assign(document.createElement(tag), props)
  e.append(...kids)
  return e
}

/**
 * A group of popovers of which one is open at most. add({ id, button, panel, onOpen, onClose }) wires a button and its panel (both made by the
 * caller or by makePopover): the button gets aria-haspopup/aria-expanded/aria-controls, the panel is `hidden` when closed.
 */
export function createPopoverGroup({ root = document } = {}) {
  let state = { open: null }
  const items = new Map()
  const apply = (next) => {
    const was = state.open
    state = { open: next.open }
    if (was !== state.open) {
      for (const [id, it] of items) {
        const on = id === state.open
        it.panel.hidden = !on
        it.button.setAttribute('aria-expanded', String(on))
        if (on && it.onOpen) it.onOpen()
        if (!on && id === was && it.onClose) it.onClose()
      }
    }
    if (next.focusButton && items.has(next.focusButton)) items.get(next.focusButton).button.focus()
  }
  const dispatch = (action) => apply(popoverStep(state, action))
  const inside = (e) => {
    const path = e.composedPath ? e.composedPath() : [e.target] // a click in a shadow tree is still inside
    return [...items.values()].some((it) => path.some((n) => n === it.panel || n === it.button || n === it.wrap))
  }
  const onClick = (e) => dispatch({ type: 'outside', inside: inside(e) })
  const onKey = (e) => {
    if (e.key === 'Escape' && state.open) {
      dispatch({ type: 'escape' })
      e.stopPropagation() // Esc closes the popover first; only the next Esc reaches the viewer (measuring, selection)
    }
  }
  root.addEventListener('click', onClick)
  root.addEventListener('keydown', onKey)
  return {
    add({ id, button, panel, wrap = null, onOpen = null, onClose = null }) {
      items.set(id, { button, panel, wrap, onOpen, onClose })
      panel.hidden = true
      button.setAttribute('aria-haspopup', 'true')
      button.setAttribute('aria-expanded', 'false')
      if (panel.id) button.setAttribute('aria-controls', panel.id)
      button.addEventListener('click', (e) => {
        e.stopPropagation()
        dispatch({ type: 'toggle', id })
      })
      panel.addEventListener('click', (e) => {
        const b = e.target.closest('button')
        if (b && !b.dataset.keepOpen) dispatch({ type: 'choose', closes: true })
      })
    },
    destroy() {
      root.removeEventListener('click', onClick)
      root.removeEventListener('keydown', onKey)
    },
    open: (id) => dispatch({ type: 'open', id }),
    close: (focus = false) => dispatch({ type: 'close', focus }),
    isOpen: (id) => (id ? state.open === id : !!state.open),
    openId: () => state.open
  }
}

/** A button with its panel next to it, ready for createPopoverGroup().add. Returns { wrap, button, panel }. */
export function makePopover({ id, label, title = '', className = '' }, ...content) {
  const button = el('button', { type: 'button', className: `pop-btn ${className}`.trim(), textContent: label, title })
  const panel = el('div', { className: 'pop-panel', id: `pop-${id}` }, ...content)
  const wrap = el('div', { className: 'pop-wrap' }, button, panel)
  return { id, wrap, button, panel }
}

/**
 * Tabs. tabs: [{ id, label, panel }] (panel = the element of that tab). Builds the tab list into `list` (role tablist), shows one panel,
 * calls onChange(id). `setShown(ids)` says which tabs exist now (the others are hidden); the active one is kept if it still exists.
 */
let tabsMade = 0
export function createTabs({ list, tabs, active = null, preferred = null, onChange = () => {} }) {
  list.setAttribute('role', 'tablist')
  const buttons = new Map()
  const uid = ++tabsMade // ids of the tab buttons stay unique when several tab lists exist
  let shown = tabs.map((t) => t.id)
  let current = null
  const render = () => {
    for (const t of tabs) {
      const on = shown.includes(t.id)
      const b = buttons.get(t.id)
      b.hidden = !on
      const isCur = on && t.id === current
      b.setAttribute('aria-selected', String(isCur))
      b.tabIndex = isCur ? 0 : -1
      t.panel.hidden = !isCur
    }
  }
  for (const t of tabs) {
    const b = el('button', { type: 'button', className: 'tab', textContent: t.label, id: `tab-${uid}-${t.id}` })
    b.setAttribute('role', 'tab')
    b.setAttribute('aria-controls', (t.panel.id ||= `tabpanel-${uid}-${t.id}`))
    t.panel.setAttribute('role', 'tabpanel')
    t.panel.setAttribute('aria-labelledby', b.id)
    b.onclick = () => select(t.id)
    b.onkeydown = (e) => {
      const next = tabsNext(shown, current, e.key)
      if (next !== null && next !== current && ['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) {
        e.preventDefault()
        select(next)
        buttons.get(next).focus()
      }
    }
    buttons.set(t.id, b)
    list.append(b)
  }
  function select(id, notify = true) {
    if (!shown.includes(id)) return
    const changed = id !== current
    current = id
    render()
    if (changed && notify) onChange(id)
  }
  current = chooseTab(shown, active, preferred)
  render()
  return {
    select,
    current: () => current,
    /** notify=false: an automatic change (another file, another selection) is not a choice of the person and is not reported through onChange. */
    setShown(ids, remembered = current, pref = preferred, notify = true) {
      shown = tabs.map((t) => t.id).filter((id) => ids.includes(id))
      const next = chooseTab(shown, remembered, pref)
      const changed = next !== current
      current = next
      render()
      if (changed && current && notify) onChange(current)
    },
    label: (id, text) => (buttons.get(id).textContent = text),
    button: (id) => buttons.get(id)
  }
}

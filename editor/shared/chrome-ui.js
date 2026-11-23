// Shared by 3D Model Viewer and STEP Viewer 3D (canonical copy: plugins/_shared; do not edit the copies in editor/shared).
// Small builders for the menus of the toolbar (chrome-layout.js): a menu row with its key, a checkbox that stands for a toggle button of the
// page, choice cards with a sentence each. The page's own buttons and selects stay the source of truth (hidden); these only show and set them.

export const $ = (id) => document.getElementById(id)
export const el = (tag, props = {}, ...kids) => {
  const e = Object.assign(document.createElement(tag), props)
  e.append(...kids)
  return e
}

/** A row of a menu: label on the left, the shortcut on the right. */
export function menuItem(id, label, key, onClick, tip) {
  const b = el('button', { type: 'button', className: 'menu-item', id, title: tip || (key ? `${label} (${key})` : label) }, el('span', { className: 'mi-label', textContent: label }), el('kbd', { textContent: key || '' }))
  if (!key) b.lastChild.hidden = true
  b.onclick = onClick
  return b
}

/** A heading inside a menu ("Look from", "Helpers"). */
export const menuHeading = (text, extra = {}) => el('div', { className: 'menu-heading', textContent: text, ...extra })
export const menuRule = () => el('hr', { className: 'menu-rule' })

/**
 * A checkbox row for a toggle button of the page (aria-pressed): clicking it clicks the button, and the row follows the button's pressed,
 * hidden and disabled state and its tooltip. The button itself is moved into `holder` (kept in the page, not shown).
 */
export function proxyCheck(button, label, hint, holder) {
  const box = el('input', { type: 'checkbox' })
  const text = el('span', { className: 'grow', textContent: label })
  if (hint) text.append(' ', el('span', { className: 'muted', textContent: `– ${hint}` }))
  const row = el('label', { className: 'row menu-check' }, box, text)
  const sync = () => {
    box.checked = button.getAttribute('aria-pressed') === 'true'
    box.disabled = button.disabled
    row.hidden = button.hidden
    row.title = button.title || ''
  }
  box.onchange = () => button.dispatchEvent(new MouseEvent('click', { bubbles: false })) // the page's button reacts, but the click does not travel up and close the menu
  new MutationObserver(sync).observe(button, { attributes: true, attributeFilter: ['aria-pressed', 'hidden', 'disabled', 'title'] })
  button.hidden = button.hidden // keep the page's own state
  holder.append(button)
  button.classList.add('proxied')
  sync()
  row.sync = sync
  return row
}

/**
 * Choice cards (radio buttons with a sentence under the name). options: [{ id, label, sub }]. Returns { root, set(id|null), onPick }.
 */
export function choiceCards(name, options, onPick) {
  const root = el('div', { className: 'cards', role: 'radiogroup' })
  const inputs = new Map()
  const rows = new Map()
  for (const o of options) {
    const input = el('input', { type: 'radio', name })
    input.value = o.id
    const row = el('label', { className: 'card-row' }, input, el('span', { className: 'card-text' }, el('span', { className: 'card-name', textContent: o.label }), el('span', { className: 'card-sub', textContent: o.sub })))
    input.onchange = () => input.checked && onPick(o.id)
    inputs.set(o.id, input)
    rows.set(o.id, row)
    root.append(row)
  }
  return {
    root,
    rows,
    set(id) {
      for (const [k, input] of inputs) input.checked = k === id
    }
  }
}

/** The list of shortcuts the "Keyboard shortcuts" dialog shows: the keys, the KEYMAP actions the row stands for, and the text key. */
export const SHORTCUT_ROWS = [
  { keys: 'R', actions: ['view_all'], text: 'ch_k_all' },
  { keys: 'F', actions: ['fit_selected'], text: 'ch_k_sel' },
  { keys: '1 – 8', actions: ['view_iso', 'view_front', 'view_back', 'view_left', 'view_right', 'view_top', 'view_bottom', 'view_hero'], text: 'ch_k_views' },
  { keys: 'I  /  ⇧ I', actions: ['isolate'], text: 'ch_k_isolate' },
  { keys: 'M', actions: ['measure'], text: 'ch_k_measure' },
  { keys: 'L', actions: ['studio'], text: 'ch_k_studio' },
  { keys: 'E', actions: ['export'], text: 'ch_k_export' },
  { keys: 'W', actions: ['mesh'], text: 'ch_k_mesh' },
  { keys: 'T', actions: ['texture'], text: 'ch_k_texture' },
  { keys: 'G', actions: ['grid'], text: 'ch_k_grid' },
  { keys: 'B', actions: ['background'], text: 'ch_k_background' },
  { keys: 'P', actions: ['panel'], text: 'ch_k_panel' },
  { keys: '+  /  −', actions: ['zoom_in', 'zoom_out'], text: 'ch_k_zoom' },
  { keys: 'Esc', actions: ['escape'], text: 'ch_k_escape' },
  { keys: 'Ctrl / ⌘ + Click', actions: [], text: 'ch_k_multi' },
  { keys: '⇧ + Click', actions: [], text: 'ch_k_range' },
  { keys: 'Double-click', actions: [], text: 'ch_k_dbl' },
  { keys: '↑ ↓ ← →  Space  Enter', actions: [], text: 'ch_k_tree' }
]

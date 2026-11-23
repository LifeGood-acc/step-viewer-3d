// Shared by 3D Model Viewer and STEP Viewer 3D (canonical copy: plugins/_shared; do not edit the copies in editor/shared).
// The part tree on the page (UX v3, E2b): the rows with a tick, a colour, a fold button, the name and the triangles; the filter; the arrow keys; the vertical tool strip.
// The logic is in part-tree-core.js (tested without a page); what a part is, which are selected and what a click does stay with the viewer (callbacks), so that
// the two viewers, with their different selection models, show one tree that behaves the same. Rows carry the origin of every number and name (data-src, cards.js).
import { el } from './chrome-ui.js'
import { icon } from './icons.js'
import { MAX_ROWS, hasKids, visibleRows, rowState, navTarget, rovingRow, ancestors } from './part-tree-core.js'

/**
 * opts:
 *   t, fmt                       the translator and the number format
 *   host                         the element that holds the rows (#parts); filter: the search field; count: the element for "3 / 4 visible"; note(): the line OUTSIDE the tree for "no match" and "... and n more"
 *   getRows()                    [{ depth, name, meshes, group }]
 *   getPart(k)                   { visible, tris, verts, kind } of part k (kind 'mesh' or none counts triangles, anything else points or lines: a dot)
 *   swatch(row)                  '#rrggbb' of the row
 *   searchText(row, i)           the text the filter looks at
 *   nameSrc(row)                 'file' when the name is the file's, 'ui' when the viewer made it up ("Part 3")
 *   selected()                   Set of the selected part indices
 *   onVisible(i, checked), onSelect(i, mode: 'replace' | 'toggle' | 'range'), onIsolate(i)
 * Returns { render(), reveal(i), updateSelection(), updateVisibility(), reset(), focusRow(i) }.
 */
export function createPartTree({ t, fmt, host, filter, count, note, getRows, getPart, swatch, searchText, nameSrc, selected, onVisible, onSelect, onIsolate, isMulti = () => false }) {
  const collapsed = new Set()
  let remembered = -1
  let raf = 0
  let shown = [] // the rows on screen, in order (row indices)
  host.setAttribute('role', 'tree')
  host.setAttribute('aria-multiselectable', 'true')
  host.setAttribute('aria-label', t('ch_p_tree'))

  const rowEl = (i) => host.querySelector(`.part[data-i="${i}"]`)
  const filtering = () => !!filter && filter.value.trim() !== ''

  function render() {
    cancelAnimationFrame(raf)
    raf = 0
    const rows = getRows()
    const active = document.activeElement && host.contains(document.activeElement) ? document.activeElement : null
    const activeRow = active ? active.closest('.part') : null
    const keep = activeRow ? { i: Number(activeRow.dataset.i), kind: active.tagName === 'INPUT' ? 'cb' : active.classList.contains('tw') ? 'tw' : 'row' } : null
    for (const k of [...collapsed]) if (!hasKids(rows, k)) collapsed.delete(k) // a row that is no group any more (another file, an edit)
    const q = filter ? filter.value : ''
    const texts = q.trim() ? rows.map((r, i) => searchText(r, i)) : null // the text of every row only while a filter is on
    const everyRow = visibleRows(rows, { collapsed, texts, query: q })
    shown = everyRow.slice(0, MAX_ROWS) // the keyboard only knows the rows that are drawn (a row that is not there cannot take the focus)
    const sel = selected()
    const stop = rovingRow(shown, remembered, shown.filter((i) => rowState(rows[i], sel) === 2))
    const frag = document.createDocumentFragment()
    const setNote = (text) => {
      const n = note && note() // the line is made after the tree (chrome-layout.js): asked for when it is needed
      if (n) {
        n.textContent = text
        n.hidden = !text
      }
    }
    setNote(everyRow.length === 0 ? t('filter_none') : everyRow.length > MAX_ROWS ? t('parts_more', { n: fmt(everyRow.length - MAX_ROWS), max: MAX_ROWS }) : '')
    const isFiltering = filtering()
    shown.forEach((i) => {
      const r = rows[i]
      const seen = r.meshes.filter((k) => getPart(k).visible).length
      const visState = seen === 0 ? 0 : seen === r.meshes.length ? 2 : 1 // none, some, all of its parts are visible
      const isSel = rowState(r, sel) === 2
      const row = el('div', { className: 'part' + (visState === 0 ? ' off' : '') + (isSel ? ' sel' : '') + (r.group ? ' group' : '') })
      row.dataset.i = String(i)
      row.style.setProperty('--d', String(Math.min(r.depth, 8)))
      row.setAttribute('role', 'treeitem')
      row.setAttribute('aria-level', String(r.depth + 1)) // the indentation stops at 8 steps, the announced level does not
      row.setAttribute('aria-selected', String(isSel))
      row.tabIndex = i === stop ? 0 : -1
      const kids = hasKids(rows, i)
      if (kids && !isFiltering) row.setAttribute('aria-expanded', String(!collapsed.has(i)))
      const src = nameSrc(r)
      const cb = el('input', { type: 'checkbox', checked: visState === 2 })
      cb.indeterminate = visState === 1
      cb.tabIndex = -1 // the tree is one tab stop; Space on a row ticks it
      cb.setAttribute('aria-label', t('visible_label', { name: r.name }))
      cb.dataset.src = src // the label carries the name, which may carry digits
      const sw = el('span', { className: 'sw' })
      sw.style.background = swatch(r)
      const foldable = kids && !isFiltering
      // a group with rows below it has a fold button; every other row only a blank of the same width (not a button: a screen reader would read "button")
      const tw = el(foldable ? 'button' : 'span', { className: 'tw' })
      if (foldable) {
        tw.type = 'button'
        tw.tabIndex = -1
        tw.setAttribute('aria-label', t(collapsed.has(i) ? 'row_expand' : 'row_collapse', { name: r.name }))
        tw.dataset.src = src
        tw.append(icon(collapsed.has(i) ? 'right' : 'down'))
      } else tw.setAttribute('aria-hidden', 'true')
      const nm = el('span', { className: 'nm', id: `ptn-${i}`, textContent: r.name, title: r.name })
      nm.dataset.src = src
      row.setAttribute('aria-labelledby', nm.id)
      const isMesh = (p) => !p.kind || p.kind === 'mesh' // the STEP viewer's parts are all meshes and carry no kind
      const tris = r.meshes.reduce((a, k) => a + (isMesh(getPart(k)) ? getPart(k).tris : 0), 0)
      const dots = r.meshes.reduce((a, k) => a + (isMesh(getPart(k)) ? 0 : getPart(k).verts || 0), 0)
      const tr = el('span', { className: 'tr', textContent: [tris || !dots ? `${fmt(tris)} △` : '', dots ? `${fmt(dots)} •` : ''].filter(Boolean).join(' ') }) // a group of meshes and points names both
      tr.dataset.src = 'derived'
      row.append(cb, sw, tw, icon(r.group ? 'group' : 'part', 'pi'), nm, tr) // the symbol of the row: a cube for a group, a square for a part (the chosen row colours it)
      frag.append(row)
    })
    host.replaceChildren(frag)
    host.classList.toggle('flat', !rows.some((r) => r.group)) // no group, no fold buttons: no blank in front of the names
    paintCount(rows)
    if (keep) {
      const again = rowEl(keep.i)
      const target = again && (keep.kind === 'cb' ? again.querySelector('input') : keep.kind === 'tw' ? again.querySelector('button.tw') : again)
      if (target) target.focus({ preventScroll: true })
    }
  }

  /** The ticks changed (not the rows): every row's tick, its "some" state and its dimming, and the count; no rebuild, so the focus stays where it is. */
  function updateVisibility() {
    const rows = getRows()
    for (const r of host.querySelectorAll('.part')) {
      const row = rows[Number(r.dataset.i)]
      if (!row) continue
      const seen = row.meshes.filter((k) => getPart(k).visible).length
      const state = seen === 0 ? 0 : seen === row.meshes.length ? 2 : 1
      const cb = r.querySelector('input')
      cb.checked = state === 2
      cb.indeterminate = state === 1
      r.classList.toggle('off', state === 0)
    }
    paintCount(rows)
  }

  function paintCount(rows) {
    if (!count) return
    const parts = new Set(rows.flatMap((r) => r.meshes))
    let v = 0
    for (const k of parts) if (getPart(k).visible) v++
    count.textContent = t('parts_visible', { v, n: parts.size })
    count.dataset.src = 'derived'
  }

  function updateSelection() {
    const rows = getRows()
    const sel = selected()
    for (const r of host.querySelectorAll('.part')) {
      const i = Number(r.dataset.i)
      const on = rowState(rows[i], sel) === 2
      r.classList.toggle('sel', on)
      r.setAttribute('aria-selected', String(on))
    }
  }

  /** Unfolds the groups above row i (a selection made in the view shows its row) and scrolls the row into view. */
  function reveal(i) {
    const rows = getRows()
    let changed = false
    if (!filtering()) for (const k of ancestors(rows, i)) if (collapsed.delete(k)) changed = true
    if (changed) render()
    const r = rowEl(i)
    if (r) r.scrollIntoView({ block: 'nearest' })
  }

  function focusRow(i) {
    const was = host.querySelector('.part[tabindex="0"]') // the one tab stop (found in the page, not from memory: a page without focus sends no focus events)
    const r = rowEl(i)
    if (!r) return // a row that is not drawn takes no focus (the one tab stop stays where it was)
    if (was && was !== r) was.tabIndex = -1
    remembered = i
    r.tabIndex = 0
    r.focus()
  }

  function toggleFold(k) {
    if (collapsed.has(k)) collapsed.delete(k)
    else collapsed.add(k)
    remembered = k
    render()
  }

  const modeOf = (e) => (e.shiftKey ? 'range' : e.metaKey || e.ctrlKey || isMulti() ? 'toggle' : 'replace')

  host.addEventListener('focusin', (e) => {
    const r = e.target.closest && e.target.closest('.part')
    if (!r) return
    const was = host.querySelector('.part[tabindex="0"]')
    if (was && was !== r) was.tabIndex = -1
    remembered = Number(r.dataset.i)
    r.tabIndex = 0
  })
  host.addEventListener('change', (e) => {
    const r = e.target.closest('.part')
    if (!r || e.target.tagName !== 'INPUT') return
    onVisible(Number(r.dataset.i), e.target.checked)
    updateVisibility() // the rows stay (and the focus with them)
  })
  host.addEventListener('click', (e) => {
    const r = e.target.closest('.part')
    if (!r || e.target.tagName === 'INPUT') return
    const i = Number(r.dataset.i)
    if (e.target.closest('button.tw')) return toggleFold(i)
    onSelect(i, modeOf(e))
  })
  host.addEventListener('dblclick', (e) => {
    const r = e.target.closest('.part')
    if (!r || e.target.closest('button.tw') || e.target.tagName === 'INPUT') return // the fold button and the tick are not "show only this"
    onIsolate(Number(r.dataset.i))
  })
  host.addEventListener('keydown', (e) => {
    const r = e.target.closest && e.target.closest('.part')
    if (!r || e.target.tagName === 'INPUT' || e.metaKey || e.ctrlKey || e.altKey) return
    if ((e.key === ' ' || e.key === 'Enter') && e.target.closest('button.tw')) return // the fold button does what a button does
    const rows = getRows()
    const cur = Number(r.dataset.i)
    if (e.key === ' ') {
      e.preventDefault()
      const cb = r.querySelector('input')
      if (cb) cb.click() // the same path as a click on the tick
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      onSelect(cur, modeOf(e))
      const again = rowEl(cur)
      if (again) again.focus({ preventScroll: true })
      return
    }
    const nav = navTarget(rows, shown, cur, e.key, collapsed, { filtering: filtering() })
    if (!nav) return
    e.preventDefault()
    if (nav.fold) {
      if (nav.fold.collapse) collapsed.add(nav.fold.row)
      else collapsed.delete(nav.fold.row)
      remembered = nav.focus
      render()
      const again = rowEl(nav.focus)
      if (again) again.focus()
      return
    }
    focusRow(nav.focus)
    const f = rowEl(nav.focus)
    if (f) f.scrollIntoView({ block: 'nearest' })
  })
  if (filter) {
    filter.addEventListener('input', () => {
      if (!raf) raf = requestAnimationFrame(render) // one rebuild per frame while typing
    })
    filter.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && filter.value) {
        e.stopPropagation() // the first Escape empties the filter, it does not clear the selection
        filter.value = ''
        render()
      } else if (e.key === 'ArrowDown' && shown.length) {
        e.preventDefault()
        focusRow(rovingRow(shown, remembered, []))
      }
    })
  }

  return {
    render,
    reveal,
    updateSelection,
    updateVisibility,
    focusRow,
    /** A new model: nothing is folded, the filter is empty. */
    reset() {
      collapsed.clear()
      remembered = -1
      if (filter) filter.value = ''
    }
  }
}

/**
 * The strip of tool buttons beside the tree, vertical, one tab stop with the arrow keys (a toolbar). `buttons` = [{ el: the page's button, icon, label, tip }]: the page's own
 * button stays the one that does the work (its id, its handler, its state); it only gets a symbol, a name and a tooltip.
 */
export function buildTreeStrip({ t, buttons }) {
  const strip = el('div', { className: 'tree-strip', id: 'tree-strip', role: 'toolbar' })
  strip.setAttribute('aria-orientation', 'vertical')
  strip.setAttribute('aria-label', t('ch_p_strip'))
  for (const b of buttons) {
    const e = b.el
    e.textContent = ''
    e.classList.add('mini-ic')
    e.append(icon(b.icon))
    e.setAttribute('aria-label', b.label)
    e.title = b.tip || b.label
    e.removeAttribute('data-i18n')
    e.removeAttribute('data-i18n-title')
    strip.append(e)
  }
  const usable = () => [...strip.querySelectorAll('button')].filter((x) => !x.disabled && !x.hidden)
  const settle = (cur) => {
    for (const x of strip.querySelectorAll('button')) x.tabIndex = x === cur ? 0 : -1
  }
  const ensure = () => {
    const list = usable()
    if (!list.length) return
    const cur = list.find((x) => x.tabIndex === 0) || list[0]
    settle(cur)
  }
  strip.addEventListener('focusin', (e) => e.target.matches && e.target.matches('button') && settle(e.target))
  strip.addEventListener('keydown', (e) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return
    const list = usable()
    const at = list.indexOf(document.activeElement)
    if (at < 0) return
    e.preventDefault()
    const next = e.key === 'Home' ? list[0] : e.key === 'End' ? list[list.length - 1] : list[(at + (e.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length]
    settle(next)
    next.focus()
  })
  new MutationObserver(ensure).observe(strip, { attributes: true, attributeFilter: ['disabled', 'hidden'], subtree: true })
  ensure()
  return { strip, ensure }
}

// Shared by 3D Model Viewer and STEP Viewer 3D (canonical copy: plugins/_shared; do not edit the copies in editor/shared).
// The "Measure" tab of the side panel: the list of all measurements (number, kind, value, name), what to do with one (rename, colour, hide,
// delete, change its points), comparing two, and taking them along (copy as text or CSV). One place for this: nothing of it is in Info.
import { el } from './chrome-ui.js'
import { COLORS } from './measure-store.js'

/**
 * opts: { t, panel, measure (createMeasure), locale, copy(text) -> bool, flash(text), startMeasuring(), confirm({title,text,confirmLabel,cancelLabel}) -> Promise<bool> }
 * Returns { render() }.
 */
export function buildMeasureTab({ t, panel, measure, locale, copy, flash, startMeasuring, confirm }) {
  const store = measure.store
  const picked = new Set()
  let muted = false
  const lang = locale === 'de' ? 'de-DE' : 'en-US'

  const intro = el('p', { className: 'hint', id: 'measure-intro', textContent: t('mp_intro') })
  const empty = el('div', { id: 'measure-empty', className: 'measure-empty' }, el('p', { className: 'hint', textContent: t('mp_empty') }), el('button', { type: 'button', id: 'b-ms-start', textContent: t('mp_start') }))
  empty.lastChild.onclick = () => startMeasuring()
  const suspended = el('p', { className: 'hint warn-line', id: 'measure-suspended', textContent: t('mp_suspended'), hidden: true })
  const list = el('ul', { id: 'measure-list', className: 'measure-list' })
  list.setAttribute('aria-label', t('mp_list_label'))
  const detail = el('div', { id: 'measure-detail', className: 'measure-detail' })
  const compare = el('div', { id: 'measure-compare', className: 'measure-compare', 'aria-live': 'polite' })
  const copyText = el('button', { type: 'button', id: 'b-ms-copy-text', textContent: t('mp_copy_text') })
  const copyCsv = el('button', { type: 'button', id: 'b-ms-copy-csv', textContent: t('mp_copy_csv') })
  const hideAll = el('button', { type: 'button', id: 'b-ms-hide-all' })
  const clearAll = el('button', { type: 'button', id: 'b-ms-clear-all', textContent: t('mp_clear_all') })
  const actions = el('div', { className: 'row wrap', id: 'measure-actions' }, copyText, copyCsv, hideAll, clearAll)
  const picture = el('p', { className: 'hint', id: 'measure-picture', textContent: t('mp_in_picture') })
  panel.append(intro, empty, suspended, list, detail, compare, actions, picture)

  copyText.onclick = () => flash(copy(measure.text()) ? t('mp_copied') : t('copy_failed'))
  copyCsv.onclick = () => flash(copy(measure.csv()) ? t('mp_copied') : t('copy_failed'))
  hideAll.onclick = () => store.setAllVisible(!store.list().every((m) => m.visible))
  clearAll.onclick = async () => {
    const n = store.count()
    if (!n) return
    const ok = await confirm({ title: t('mp_clear_title'), text: t('mp_clear_text', { n }), confirmLabel: t('mp_clear_confirm'), cancelLabel: t('mp_cancel') })
    if (ok) measure.clearAll()
  }

  const fmtQ = (v, q) => measure.fmtQuantity(v, q)
  const signed = (v, q) => `${v >= 0 ? '+' : '−'}${fmtQ(Math.abs(v), q)}`

  function renderCompare() {
    compare.replaceChildren()
    for (const id of [...picked]) if (!store.get(id)) picked.delete(id)
    compare.hidden = store.count() < 2
    if (compare.hidden) return
    compare.append(el('div', { className: 'menu-heading', textContent: t('mp_compare_title') }))
    if (picked.size !== 2) {
      compare.append(el('p', { className: 'hint', textContent: picked.size > 2 ? t('mp_compare_many') : t('mp_compare_hint') }))
      return
    }
    const [ida, idb] = [...picked]
    const r = measure.compare(ida, idb)
    if (!r.same) {
      compare.append(el('p', { className: 'hint', textContent: t('mp_compare_no') }))
      return
    }
    const row = (label, value, strong = false) => el('div', { className: 'cmp-row' + (strong ? ' strong' : '') }, el('span', { textContent: label }), el('span', { className: 'cmp-v', textContent: value }))
    const ratio = r.ratio === null ? '–' : `${r.ratio.toLocaleString(lang, { maximumFractionDigits: 3 })} : 1 (${r.percent.toLocaleString(lang, { maximumFractionDigits: 1 })} %)`
    compare.append(
      row(`${r.ma.no} · ${measure.kindName(r.ma.kind)}`, fmtQ(r.a.value, r.quantity)),
      row(`${r.mb.no} · ${measure.kindName(r.mb.kind)}`, fmtQ(r.b.value, r.quantity)),
      row(t('mp_diff'), signed(r.diff, r.quantity), true),
      row(t('mp_ratio'), ratio, true)
    )
    compare.setAttribute('aria-label', t('mp_compare_text', { a: r.ma.no, b: r.mb.no, d: signed(r.diff, r.quantity), r: r.ratio === null ? '–' : r.ratio.toLocaleString(lang, { maximumFractionDigits: 3 }), p: r.percent === null ? '–' : r.percent.toLocaleString(lang, { maximumFractionDigits: 1 }) }))
  }

  function renderDetail() {
    detail.replaceChildren()
    const m = store.get(store.selected())
    detail.hidden = !m
    if (!m) return
    const name = el('input', { type: 'text', id: 'ms-name', value: m.name, placeholder: t('mp_name_ph'), maxLength: 60 })
    name.setAttribute('aria-label', t('mp_name'))
    name.oninput = () => {
      muted = true
      store.update(m.id, { name: name.value })
      muted = false
      const row = list.querySelector(`[data-id="${m.id}"] .mname`)
      if (row) row.textContent = name.value
    }
    name.onkeydown = (e) => {
      if (e.key === 'Enter') name.blur()
      e.stopPropagation() // letters typed here are no shortcuts
    }
    const swatches = el('div', { className: 'swatches', role: 'group' })
    swatches.setAttribute('aria-label', t('mp_color'))
    for (const [ci, col] of COLORS.entries()) {
      const b = el('button', { type: 'button', className: 'swatch-btn', title: col })
      b.setAttribute('aria-label', `${t('mp_color')} ${ci + 1}`)
      b.style.background = col
      b.dataset.color = col
      b.setAttribute('aria-pressed', String(col === m.color))
      b.onclick = () => store.update(m.id, { color: col })
      swatches.append(b)
    }
    detail.append(
      el('div', { className: 'menu-heading', textContent: `${t('mp_selected')}: ${m.no} · ${measure.kindName(m.kind)}` }),
      el('div', { className: 'row' }, name),
      el('div', { className: 'row' }, el('span', { textContent: t('mp_color') }), swatches),
      ...measure.summary(m).map((l) => el('div', { className: 'ms-line', textContent: l }))
    )
    if (m.kind === 'chain' && m.pts.length >= 3) {
      const box = el('input', { type: 'checkbox', id: 'ms-closed', checked: !!m.closed })
      box.onchange = () => store.update(m.id, { closed: box.checked })
      detail.append(el('label', { className: 'row' }, box, el('span', { className: 'grow', textContent: t('mp_closed') })))
    }
    const pts = el('div', { className: 'ms-points', id: 'ms-points' })
    if (m.kind === 'parts') pts.append(el('p', { className: 'hint', textContent: t('mp_parts_fixed') }))
    else {
      const armed = measure.armed()
      m.pts.forEach((p, i) => {
        const set = el('button', { type: 'button', className: 'ms-set', textContent: t('mp_point_set'), title: t('mp_point_set_tip') })
        set.dataset.index = String(i)
        set.setAttribute('aria-pressed', String(!!armed && armed.id === m.id && armed.index === i))
        set.onclick = () => {
          if (armed && armed.id === m.id && armed.index === i) measure.disarm()
          else {
            startMeasuring(true) // the click must reach the model: measuring is on
            measure.armReplace(m.id, i)
          }
        }
        const row = el('div', { className: 'ms-point' }, el('span', { className: 'ms-pn', textContent: t('mp_point_n', { n: i + 1 }) }), el('span', { className: 'ms-xyz', textContent: p.map((v) => measure.fmt(v)).join(' / ') }), set)
        if (m.kind === 'chain' && m.pts.length > 2) {
          const rm = el('button', { type: 'button', className: 'ms-rm', textContent: '✕', title: t('mp_point_remove') })
          rm.setAttribute('aria-label', t('mp_point_remove'))
          rm.onclick = () => store.removePoint(m.id, i)
          row.append(rm)
        }
        pts.append(row)
      })
      pts.append(el('p', { className: 'hint', textContent: t('mp_point_hint') }))
    }
    detail.append(pts)
  }

  // The list and the detail are drawn again after every change; the keyboard focus must not fall to the page each time.
  function focusKey() {
    const a = document.activeElement
    if (!a || !panel.contains(a)) return null
    const row = a.closest('li[data-id]')
    const rows = [...list.children]
    const key = row ? `${a.className.split(' ')[0]}:${row.dataset.id}` : a.dataset && a.dataset.color ? `sw:${a.dataset.color}` : a.classList.contains('ms-set') ? `set:${a.dataset.index}` : a.classList.contains('ms-rm') ? `rm:${[...a.parentNode.parentNode.children].indexOf(a.parentNode)}` : a.id || null
    return key ? { key, row: row ? rows.indexOf(row) : -1, sel: a.selectionStart === undefined ? null : [a.selectionStart, a.selectionEnd] } : null
  }
  function restoreFocus(f) {
    if (!f) return
    const [kind, arg] = f.key.split(/:(.*)/s)
    let target = null
    if (kind === 'sw') target = detail.querySelector(`.swatch-btn[data-color="${arg}"]`)
    else if (kind === 'set') target = detail.querySelector(`.ms-set[data-index="${arg}"]`)
    else if (kind === 'rm') target = detail.querySelectorAll('.ms-point')[Number(arg)]?.querySelector('.ms-rm') || detail.querySelector('.ms-set')
    else if (['meye', 'mmain', 'mdel', 'mcmp'].includes(kind)) {
      const row = list.querySelector(`li[data-id="${arg}"]`)
      target = row && row.querySelector('.' + kind)
      if (!target) {
        // the row is gone (deleted): focus goes to the row that took its place, else the one before, else the button that starts measuring
        const rows = [...list.children]
        const near = rows[Math.min(f.row, rows.length - 1)]
        target = (near && near.querySelector('.mmain')) || (!empty.hidden && empty.querySelector('button'))
      }
    } else if (f.key) target = panel.querySelector(`[id="${f.key}"]`)
    if (target && !target.disabled && !target.hidden) {
      target.focus({ preventScroll: true })
      if (f.sel && target.setSelectionRange) try { target.setSelectionRange(f.sel[0], f.sel[1]) } catch { /* not a text field */ }
    }
  }

  function render() {
    if (muted) return
    const focus = focusKey()
    const items = store.list()
    empty.hidden = items.length > 0
    intro.hidden = items.length === 0
    suspended.hidden = !measure.suspended()
    list.hidden = !items.length
    actions.hidden = !items.length
    picture.hidden = !items.length
    hideAll.textContent = items.every((m) => m.visible) ? t('mp_hide_all') : t('mp_show_all')
    list.replaceChildren()
    for (const m of items) {
      const c = measure.compute(m)
      const pick = el('input', { type: 'checkbox', className: 'mcmp', checked: picked.has(m.id) })
      pick.setAttribute('aria-label', `${t('mp_pick')}: ${m.no}`)
      pick.title = t('mp_pick')
      pick.onchange = () => {
        if (pick.checked) picked.add(m.id)
        else picked.delete(m.id)
        renderCompare()
      }
      const sw = el('span', { className: 'msw' })
      sw.style.background = m.color
      const main = el('button', { type: 'button', className: 'mmain' }, sw, el('span', { className: 'mno', textContent: String(m.no) }), el('span', { className: 'mkind', textContent: measure.kindName(m.kind) }), el('span', { className: 'mname', textContent: m.name }), el('span', { className: 'mval', textContent: measure.valueText(m, c) }))
      main.onclick = () => store.select(m.id)
      const eye = el('button', { type: 'button', className: 'meye', textContent: m.visible ? '◉' : '○', title: m.visible ? t('mp_hide') : t('mp_show') })
      eye.setAttribute('aria-label', t('mp_visible')) // the name stays, only the state (pressed) changes
      eye.setAttribute('aria-pressed', String(m.visible))
      eye.onclick = () => store.update(m.id, { visible: !m.visible })
      const del = el('button', { type: 'button', className: 'mdel', textContent: '✕', title: t('mp_delete') })
      del.setAttribute('aria-label', `${t('mp_delete')}: ${m.no}`)
      del.onclick = () => {
        picked.delete(m.id)
        store.remove(m.id)
      }
      const li = el('li', { className: `mrow${m.id === store.selected() ? ' sel' : ''}${m.visible ? '' : ' off'}` }, pick, main, eye, del)
      li.dataset.id = m.id
      if (m.id === store.selected()) li.setAttribute('aria-current', 'true')
      list.append(li)
    }
    renderCompare()
    renderDetail()
    restoreFocus(focus)
  }
  store.on(render)
  render()
  return { render }
}

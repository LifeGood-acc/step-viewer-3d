// Shared by 3D Model Viewer and STEP Viewer 3D (canonical copy: plugins/_shared; do not edit the copies in editor/shared).
// The card "Files" (UX v3, E2b): ONE row, because each window holds one model (several files at once are not built: Orca gives a viewer one file per tab).
// The row says what the file itself says (name, format, size, the unit when the file names it) and what the viewer worked out or assumed; a button opens another file
// (it replaces this one) and a cross closes this one. Every number carries its origin (data-src), like all cards (cards.js).
import { el } from './chrome-ui.js'
import { icon } from './icons.js'
import { card, src } from './cards.js'

/**
 * opts: { t, open: () => void, close: () => void }. Returns { card, update(info | null), hideOpen(hidden) }.
 * info: { name, nameSrc? ('file' by default, 'ui' when the viewer put its own word there), format ('STEP'), size ('31 KB', already formatted), unit ('mm'), unitSrc ('file' | 'assumed'), quality? ('normal', STEP only) }
 */
export function buildFileCard({ t, open, close }) {
  let closeHidden = false // the page's own Close is hidden where closing makes no sense (the editor tab of a project file: the tab is the file)
  const openBtn = el('button', { type: 'button', id: 'b-files-open', className: 'card-act' }, icon('plus'), el('span', { textContent: t('ch_f_open') }))
  openBtn.title = t('ch_f_open_tip')
  openBtn.onclick = open
  const body = el('div', { className: 'file-rows', id: 'file-rows' })
  const c = card({ id: 'card-files', title: t('ch_card_files'), icon: icon('open'), extras: [openBtn], body: [body] })
  c.classList.add('card-files')

  function update(info) {
    body.replaceChildren()
    c.hidden = !info
    if (!info) return
    const unitSrc = info.unitSrc === 'assumed' ? 'assumed' : 'file'
    const closeBtn = el('button', { type: 'button', id: 'b-files-close', className: 'mini-ic' }, icon('x'))
    closeBtn.title = t('ch_f_close_tip')
    closeBtn.setAttribute('aria-label', t('ch_f_close'))
    closeBtn.onclick = close
    closeBtn.hidden = closeHidden
    // one fact to a line: the format and the size side by side (a gap, no dot between them), the unit, the mesh quality
    const line1 = el('span', { className: 'fsub fmeta' }, ...(info.format ? [el('span', { textContent: info.format })] : []), src('file', info.size))
    const unitLine = el('span', { className: 'fsub' }, `${t('ch_f_unit')} `, src(unitSrc, info.unit))
    if (unitSrc === 'assumed') unitLine.append(` (${t('ch_f_assumed')})`) // an assumed unit says so in the same block (honesty rule R8)
    else unitLine.append(` (${t('ch_f_from_file')})`)
    const qualityLine = info.quality ? el('span', { className: 'fsub' }, `${t('ch_f_quality')} `, src('ui', info.quality)) : null // the mesh quality is a setting of the viewer
    const name = el('span', { className: 'fn' })
    name.dataset.src = info.nameSrc === 'ui' ? 'ui' : 'file' // no name from the file: the viewer's own word for the format stands there, and says so
    name.textContent = info.name
    name.title = info.name
    const nm = el('span', { className: 'nm' }, name, line1, unitLine, ...(qualityLine ? [qualityLine] : []))
    body.append(el('div', { className: 'frow', id: 'file-row' }, icon('file'), nm, closeBtn))
  }
  update(null)
  return {
    card: c,
    update,
    /** The Open button follows the page's own (it is hidden where Open is not offered). */
    hideOpen(hidden) {
      openBtn.hidden = !!hidden
    },
    /** The cross follows the page's own Close in the same way. */
    hideClose(hidden) {
      closeHidden = !!hidden
      const b = c.querySelector('#b-files-close')
      if (b) b.hidden = closeHidden
    }
  }
}

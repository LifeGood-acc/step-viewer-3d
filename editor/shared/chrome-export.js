// Shared by 3D Model Viewer and STEP Viewer 3D (canonical copy: plugins/_shared; do not edit the copies in editor/shared).
// The export dialog over the view: Image | Film | 3D file, the format, "Make smaller", only visible parts, Advanced, the size, and one button
// "Save as…". The controls and the logic stay those of export-ui.js (ex-format is the one source of the format; b-ex-make, b-ex-save and
// b-ex-cancel are still its buttons, kept hidden): this module shows them as the mockup does and presses them in order.
import { $, el } from './chrome-ui.js'

/** Which 3D formats a kind of file can be written as (the others make no sense: a point cloud has no triangles for STL). */
export const FORMATS_BY_FILE = {
  mesh: ['glb', 'glbc', 'stl', 'obj', 'ply', '3mf'],
  points: ['glb', 'glbc', 'ply'],
  splat: ['glb', 'glbc', 'ply'],
  gcode: ['glb', 'glbc'],
  lines: ['glb', 'glbc'],
  none: ['glb', 'glbc', 'stl', 'obj', 'ply', '3mf']
}

/** The one pure rule of "Make smaller": it is the format GLB made smaller under a size. */
export const smallOf = (format) => format === 'glbc'
export const formatOfSmall = (small) => (small ? 'glbc' : 'glb')
/** How long after a click a save may still follow on its own (a browser keeps the click's permission for about five seconds). */
export const SAVE_AFTER_MS = 4000

/** hooks: { openPanel(), onEdit(), } ; ctx: { t, popovers, holder, filmBtn, shotOpen }. Returns { openExport, closeExport, exportOpen, setFileKind }. */
export function buildExportDialog({ t, popovers, holder, filmBtn, hooks }) {
  const exSec = $('export-sec')
  if (exSec) {
    exSec.removeAttribute('data-key')
    exSec.removeAttribute('data-open-default')
    exSec.open = true
    exSec.classList.add('plain')
  }
  const fmt = $('ex-format')
  const makeBtn = $('b-ex-make')
  const saveBtn = $('b-ex-save')
  const stopBtn = $('b-ex-cancel')
  const dlgTitle = el('div', { className: 'export-title', id: 'export-title', textContent: t('ch_ex_title') })
  const kindSeg = el('div', { className: 'seg export-kind', id: 'export-kind' })
  const kindBtns = new Map()
  for (const [k, label] of [['image', t('ch_ex_image')], ['film', t('ch_ex_film')], ['model', t('ch_ex_model')]]) {
    const b = el('button', { type: 'button', textContent: label })
    b.dataset.kind = k
    kindBtns.set(k, b)
    kindSeg.append(b)
  }
  const editLink = el('button', { type: 'button', id: 'b-ex-edit', textContent: t('ch_ex_edit') })
  const exHint = el('p', { className: 'hint', id: 'export-hint' }, t('ch_ex_hint') + ' ', editLink)
  const orig = el('p', { className: 'hint', id: 'export-orig', textContent: t('ch_ex_orig') })
  const goBtn = el('button', { type: 'button', id: 'b-ex-go', className: 'primary', textContent: t('ch_ex_go') })
  const closeBtn = el('button', { type: 'button', id: 'b-ex-close2', textContent: t('ch_ex_cancel') })
  const foot = el('div', { className: 'pop-foot export-foot' }, closeBtn, goBtn)
  const dialog = el('div', { id: 'export-dialog', className: 'export-dialog', hidden: true, role: 'dialog' }, el('div', { className: 'export-head' }, dlgTitle), kindSeg)
  dialog.setAttribute('aria-labelledby', 'export-title')

  // the old section: its sentence, buttons and result stay (hidden or below), the rest is the body of the dialog
  const oldHint = exSec && exSec.querySelector('p.hint[data-i18n="ex_hint_copy"]')
  if (oldHint) oldHint.hidden = true
  const fmtRow = fmt.closest('label')
  // "Make smaller": a check box that stands for the format GLB, compressed (the list keeps it for the tests and the code)
  const smallBox = el('input', { type: 'checkbox', id: 'ex-small' })
  const smallRow = el('label', { className: 'row', id: 'ex-small-row' }, smallBox, el('span', { className: 'grow', textContent: t('ch_ex_small') }))
  fmtRow.after(smallRow)
  for (const o of fmt.options) if (o.value === 'png' || o.value === 'webm' || o.value === 'glbc') o.hidden = true
  const exUpRow = $('ex-up') && $('ex-up').closest('label')
  // Advanced: "Up in the copy" and what the format changes (a technical sentence: not in the main path of format, two ticks, size, save)
  const adv = el('details', { className: 'st-adv', id: 'ex-adv' }, el('summary', { textContent: t('ch_ex_adv') }))
  if (exUpRow) {
    exUpRow.before(adv)
    adv.append(exUpRow)
  } else $('ex-lossy').before(adv)
  adv.append(el('div', { className: 'menu-heading', textContent: t('ch_ex_changes') }), $('ex-lossy'))
  const exResult = $('ex-result')
  // body: the sections of the old export area, then the hint to the Edit tab, the size, the result, the foot
  const body = el('div', { className: 'export-body' })
  if (exSec) body.append(exSec)
  dialog.append(body, orig, exHint, foot) // after the size: "About 63 KiB", "The original file stays unchanged", then the way to Edit
  for (const b of [makeBtn, saveBtn, stopBtn]) {
    b.classList.add('proxied')
    holder.append(b) // kept for export-ui.js and the tests: the dialog's two buttons press them
  }
  const btnRow = exResult && exResult.previousElementSibling
  if (btnRow && btnRow.classList.contains('row') && !btnRow.children.length) btnRow.remove()
  $('stage').append(dialog)

  let lastModelFormat = 'glb'
  let fileKind = 'none'
  const kindOf = (f) => (f === 'png' ? 'image' : f === 'webm' ? 'film' : 'model')
  const baseOf = (f) => (f === 'glbc' ? 'glb' : f)
  function syncFormats() {
    const allowed = FORMATS_BY_FILE[fileKind] || FORMATS_BY_FILE.none
    for (const o of fmt.options) {
      if (o.value === 'png' || o.value === 'webm' || o.value === 'glbc') continue // not in the list: they are Image, Film and the check box
      o.hidden = !allowed.includes(o.value)
      o.disabled = o.hidden
    }
    if (kindOf(fmt.value) === 'model' && !allowed.includes(fmt.value)) {
      fmt.value = 'glb'
      fmt.dispatchEvent(new Event('change', { bubbles: true }))
    }
    if (!allowed.includes(lastModelFormat)) lastModelFormat = 'glb'
  }
  // export-ui shows its Cancel button only for the slow formats; for the others the list is disabled while a copy is made
  let pendingAt = 0 // when the button was pressed to make a copy that is to be saved as soon as it is ready
  const busy = () => !stopBtn.hidden || (fmt.disabled && makeBtn.disabled)
  const ready = () => !saveBtn.disabled
  function sync() {
    const k = kindOf(fmt.value)
    if (k === 'model') lastModelFormat = fmt.value
    for (const [id, b] of kindBtns) b.setAttribute('aria-pressed', String(id === k))
    fmtRow.hidden = k !== 'model'
    smallRow.hidden = k !== 'model' || baseOf(fmt.value) !== 'glb'
    smallBox.checked = smallOf(fmt.value)
    const webm = [...fmt.options].find((o) => o.value === 'webm')
    for (const [id, b] of kindBtns) b.disabled = fmt.disabled || (id === 'film' && (!webm || webm.disabled))
    filmBtn.disabled = kindBtns.get('film').disabled
    smallBox.disabled = fmt.disabled
    goBtn.disabled = !makeBtn || (makeBtn.disabled && !ready()) || (busy() && !ready())
    goBtn.textContent = busy() ? t('ch_ex_working') : ready() ? t('ch_ex_save') : t('ch_ex_go')
    if (!busy() && !ready() && pendingAt && Date.now() - pendingAt > SAVE_AFTER_MS) pendingAt = 0
    smallRow.hidden = smallRow.hidden || !(FORMATS_BY_FILE[fileKind] || FORMATS_BY_FILE.none).includes('glbc')
  }
  const setKind = (k) => {
    const want = k === 'image' ? 'png' : k === 'film' ? 'webm' : lastModelFormat
    const opt = [...fmt.options].find((o) => o.value === want)
    if (!opt || opt.disabled || fmt.disabled || want === fmt.value) return sync() // an unsupported format (no recorder), a busy copy, or no change: a finished copy stays
    fmt.value = want
    fmt.dispatchEvent(new Event('change', { bubbles: true }))
    sync()
  }
  for (const [k, b] of kindBtns) b.onclick = () => setKind(k)
  smallBox.onchange = () => {
    fmt.value = formatOfSmall(smallBox.checked)
    fmt.dispatchEvent(new Event('change', { bubbles: true }))
    sync()
  }
  fmt.addEventListener('change', () => {
    pendingAt = 0 // another format: the copy that was being made is not the one to save
    sync()
  })
  const watch = new MutationObserver(sync)
  watch.observe(fmt, { attributes: true, attributeFilter: ['disabled'], subtree: true }) // export-ui disables the list while busy
  watch.observe(makeBtn, { attributes: true, attributeFilter: ['disabled'] })
  watch.observe(stopBtn, { attributes: true, attributeFilter: ['hidden'] })

  // one button: it makes the copy, and when the copy is ready it saves it (at once if the click is still fresh)
  new MutationObserver(() => {
    if (ready() && pendingAt && Date.now() - pendingAt < SAVE_AFTER_MS) {
      pendingAt = 0
      saveBtn.click()
    } else if (!ready() && !busy()) pendingAt = 0 // the copy was dropped (cancelled, changed, failed): no save on its own later
    sync()
  }).observe(saveBtn, { attributes: true, attributeFilter: ['disabled'] })
  goBtn.onclick = () => {
    if (ready()) return saveBtn.click()
    if (busy()) return
    pendingAt = Date.now()
    makeBtn.click()
  }
  closeBtn.onclick = () => (busy() ? stopBtn.click() : closeExport())

  let returnTo = null
  function openExport(kind) {
    popovers.close(false)
    returnTo = document.activeElement && !dialog.contains(document.activeElement) ? document.activeElement : null
    sync()
    if (kind) setKind(kind)
    dialog.hidden = false
    $('b-export').setAttribute('aria-expanded', 'true')
    kindBtns.get(kindOf(fmt.value)).focus()
  }
  function closeExport() {
    if (dialog.hidden) return false
    dialog.hidden = true
    pendingAt = 0
    $('b-export').setAttribute('aria-expanded', 'false')
    const back = returnTo && returnTo !== document.body && returnTo.isConnected && returnTo.offsetParent !== null ? returnTo : $('b-export').offsetParent !== null ? $('b-export') : $('b-more') // Export may be a row of More now
    back.focus()
    return true
  }
  dialog.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      closeExport()
    }
  })
  editLink.onclick = () => {
    closeExport()
    hooks.onEdit && hooks.onEdit()
  }
  $('b-export').setAttribute('aria-haspopup', 'dialog')
  $('b-export').setAttribute('aria-expanded', 'false')
  sync()
  return {
    openExport,
    closeExport,
    exportOpen: () => !dialog.hidden,
    /** The kind of file on screen: 'mesh' | 'points' | 'splat' | 'gcode' | 'lines' | 'none'. */
    setFileKind(k) {
      if (k === fileKind) return
      fileKind = k
      syncFormats()
      sync()
    },
    sync
  }
}

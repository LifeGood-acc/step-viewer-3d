// Shared by 3D Model Viewer and STEP Viewer 3D (canonical copy: plugins/_shared; do not edit the copies in editor/shared).
// The toolbar (6 elements), the side tabs and the measuring bar, built at start from the elements the pages declare (index.html keeps the ids;
// this module moves them into popovers and tabs). One place for both viewers, so no markup is kept in three HTML files.
import { createPopoverGroup, createTabs } from './popover.js'
import { asCard, helpButton, dimsRow, src } from './cards.js'
import { presetState } from './studio-core.js'
import { BG_CYCLE, BG_CUSTOM_DEFAULT, ORCA_BG } from './prefs-core.js'
import { buildExportDialog } from './chrome-export.js'
import { buildMeasureTab } from './measure-ui.js'
import { $, el, menuItem, menuHeading, menuRule, proxyCheck, choiceCards, SHORTCUT_ROWS } from './chrome-ui.js'
import { icon } from './icons.js'
import { buildTreeStrip } from './part-tree-ui.js'
import { buildFileCard } from './file-card.js'
import { createViewInfo } from './view-info.js'

/** A section that stays open and shows no heading (its heading is the tab or the popover it sits in). */
function plain(d) {
  if (!d) return null
  d.removeAttribute('data-key')
  d.removeAttribute('data-open-default')
  d.open = true
  d.classList.add('plain')
  return d
}

/**
 * opts: { t, step (STEP viewer), actions: { fitAll(), fitSelected(), openStudio(), openPanel() }, tabPref: { get, set } }
 * Returns { update(c), tabs, popovers, selectTabOf(id), measureBar: { sync(state), bind(hooks) }, bindMeasureTab(opts) }
 */
export function buildChrome({ t, locale = undefined, version = '', step = false, tabPref: rawTabPref = { get: () => null, set: () => {} } }) {
  let updateKey = ''
  let measureCount = 0 // the Measurements tab exists from the first measurement on
  let lastUpdate = null
  // the tab a file starts on is Parts (several parts) or Info, never a task tab that may be empty (Section "Off", Edit "No changes"): only these two are remembered
  const tabPref = { get: () => (['parts', 'info'].includes(rawTabPref.get()) ? rawTabPref.get() : null), set: (v) => rawTabPref.set(v) }
  const bar = $('bar')
  const popovers = createPopoverGroup()

  // ----- the toolbar: the six elements and Section, then More (the sidebar button is in the status bar) -----
  const mk = (id, label, title, extra = {}) => el('button', { id, type: 'button', textContent: label, title, ...extra })
  /** A bar button with its symbol in front of the word: [symbol] [word] [arrow]. `drop` says at which step of the shrinking bar the word goes (shell.js: 1 first ... 3 last,
   *  0 never; one number per button, the highest goes last): the symbol stays and the aria-label keeps the name, so a button without its word is still a button with a name. */
  const iconize = (b, name, label, drop, { arrow = false } = {}) => {
    b.textContent = ''
    b.classList.add('bb') // a button of the bar or the status bar (shell.css)
    b.append(icon(name), el('span', { className: 'lbl', textContent: label }))
    if (arrow) b.append(el('span', { className: 'car', ariaHidden: 'true', textContent: '▾' }))
    b.setAttribute('aria-label', label)
    if (drop) b.dataset.drop = String(drop)
    return b
  }
  const popBtn = (id, label, tip, iconName, drop) => {
    const b = iconize(mk(id, '', tip), iconName, label, drop, { arrow: true })
    b.dataset.needsModel = ''
    return b
  }
  const group = (...kids) => el('div', { className: 'grp' }, ...kids)
  const holder = el('div', { id: 'chrome-holder', hidden: true }) // the page's own buttons that the menus stand for stay here, hidden
  document.body.append(holder)
  const hooks = {}
  const panelHead = (title, keyText) => el('div', { className: 'pop-head' }, el('span', { className: 'pop-title', textContent: title }), keyText ? el('span', { className: 'pop-key', textContent: keyText }) : '')

  // View menu: show all, show the selected part, the eight views, which way is up
  const viewAll = menuItem('b-viewall', t('ch_v_all'), 'R', () => hooks.fitAll && hooks.fitAll())
  const viewFit = menuItem('b-viewfit', t('ch_v_sel'), 'F', () => hooks.fitSelected && hooks.fitSelected())
  viewAll.dataset.needsModel = ''
  const preset = $('preset')
  preset.removeAttribute('data-prio')
  preset.hidden = true // the list stays the one place that sets a view; the rows below press it
  holder.append(preset)
  const VIEWS = ['iso', 'front', 'back', 'left', 'right', 'top', 'bottom', 'hero']
  const setView = (v) => {
    preset.value = v
    preset.dispatchEvent(new Event('change', { bubbles: true }))
    preset.value = ''
  }
  const viewRows = VIEWS.map((v, i) => menuItem(`b-view-${v}`, t(`ch_v_${v}`), String(i + 1), () => setView(v)))
  const upSel = $('up')
  const upRow = upSel.closest('label')
  upRow.className = 'row stack'
  const upSecOld = upSel.closest('details')
  const upHint = $('up-hint')
  const viewPanel = el('div', { className: 'pop-panel menu-list', id: 'pop-view' }, viewAll, viewFit, menuRule(), menuHeading(t('ch_v_from')), ...viewRows, menuRule(), upRow)
  if (upHint) viewPanel.append(upHint)
  viewPanel.append(el('p', { className: 'hint', textContent: t('ch_v_note') }))
  if (upSecOld) upSecOld.remove()
  const viewBtn = popBtn('b-view', t('ch_view'), t('ch_view_tip'), 'eye', 7)
  const viewWrap = el('div', { className: 'pop-wrap' }, viewBtn, viewPanel)
  // the two views that need a button of their own only where the bar has room for them (from 1300 px, shell.js `data-minw`): the rest is in the View menu
  const diagBtn = iconize(mk('b-diag', '', t('ch_b_diag_tip')), 'iso', t('ch_b_diag'), 8)
  const frontBtn = iconize(mk('b-front', '', t('ch_b_front_tip')), 'front', t('ch_b_front'), 8)
  diagBtn.onclick = () => setView('iso')
  frontBtn.onclick = () => setView('front')
  for (const b of [diagBtn, frontBtn]) {
    b.dataset.needsModel = ''
    b.dataset.minw = '1300'
  }

  // Appearance menu: colors as cards with a sentence each, the helpers, one level down everything technical
  const wire = $('b-wire')
  wire.removeAttribute('data-prio')
  const shadingSel = $('shading')
  const tintBtn = $('l-color')
  const lookIntro = el('p', { className: 'hint', textContent: t('ch_l_intro') })
  const setShading = (v) => {
    shadingSel.value = v
    shadingSel.dispatchEvent(new Event('change', { bubbles: true }))
  }
  const setTint = (on) => {
    if ((tintBtn.getAttribute('aria-pressed') === 'true') !== on) tintBtn.dispatchEvent(new MouseEvent('click', { bubbles: false })) // the click must not travel up and close the menu
  }
  const cards = choiceCards(
    'look-color',
    [
      { id: 'original', label: t('ch_l_original'), sub: t('ch_l_original_s') },
      { id: 'solid', label: t('ch_l_solid'), sub: t('ch_l_solid_s') },
      { id: 'tint', label: t('ch_l_tint'), sub: t('ch_l_tint_s') },
      { id: 'xray', label: t('ch_l_xray'), sub: t('ch_l_xray_s') }
    ],
    (id) => {
      if (id === 'tint') {
        setShading('original')
        setTint(true)
      } else {
        setTint(false)
        setShading(id)
      }
    }
  )
  cards.root.id = 'look-cards'
  const texCheck = $('b-tex') ? proxyCheck($('b-tex'), t('ch_l_tex'), t('ch_l_tex_s'), holder) : null // the STEP viewer has no textures
  const edgesCheck = $('b-edges') ? proxyCheck($('b-edges'), t('ch_l_edges'), '', holder) : null
  const gridCheck = proxyCheck($('b-grid'), t('ch_l_grid'), '', holder)
  const axesCheck = proxyCheck($('b-axes'), t('ch_l_axes'), '', holder)
  const boxCheck = proxyCheck($('b-box'), t('ch_l_box'), '', holder)
  const overCheck = $('b-over') ? proxyCheck($('b-over'), t('ch_l_over'), '', holder) : null
  const backCheck = proxyCheck($('b-back'), t('ch_l_back'), '', holder)
  const lookSecOld = $('look-sec')
  const otherRow = shadingSel.closest('label')
  otherRow.className = 'row stack'
  otherRow.firstElementChild.textContent = t('ch_l_other')
  const opacityRow = $('opacity').closest('label')
  const texSizeRow = $('ts-row')
  const ptSec = $('pt-sec')
  if (ptSec) {
    ptSec.removeAttribute('data-key')
    ptSec.removeAttribute('data-open-default')
    ptSec.open = true
    ptSec.classList.add('plain')
  }
  const lookAdv = el('details', { className: 'st-adv', id: 'look-adv' }, el('summary', { textContent: t('ch_l_adv') }), otherRow, el('p', { className: 'hint', textContent: t('ch_l_other_hint') }), opacityRow, boxCheck, ...(overCheck ? [overCheck] : []), backCheck)
  if (texSizeRow) lookAdv.append(texSizeRow)
  if (ptSec) lookAdv.append(ptSec)
  if (lookSecOld) lookSecOld.remove()
  const lookDone = el('button', { type: 'button', id: 'b-look-done', textContent: t('ch_l_done') })
  const lookDefault = el('button', { type: 'button', id: 'b-look-default', textContent: t('ch_l_default') })
  lookDefault.onclick = () => hooks.resetAppearance && hooks.resetAppearance()
  const lookPanel = el(
    'div',
    { className: 'pop-panel', id: 'pop-look' },
    panelHead(t('ch_look')),
    lookIntro,
    cards.root,
    ...(texCheck ? [texCheck] : []),
    ...(edgesCheck ? [edgesCheck] : []),
    menuHeading(t('ch_l_help')),
    el('div', { className: 'row wrap' }, gridCheck, axesCheck),
    lookAdv,
    el('div', { className: 'pop-foot' }, lookDefault, lookDone)
  )
  const lookBtn = popBtn('b-look', t('ch_look'), t('ch_look_tip'), 'look', 1)
  const lookWrap = el('div', { className: 'pop-wrap' }, lookBtn, lookPanel)
  // Surface | Mesh: a switch with both words, the active one blue. The page's own button (the key W, the state, the tooltips) stays hidden in the holder; the two halves press it.
  const wireSeg = el('div', { className: 'seg wire-seg', id: 'wire-seg', role: 'group' })
  wireSeg.setAttribute('aria-label', t('ch_w_label'))
  const wireHalf = (id, label, tip, meshOn) => {
    const b = el('button', { type: 'button', id, className: 'bb', textContent: label, title: tip })
    b.dataset.needsModel = ''
    b.onclick = () => (wire.getAttribute('aria-pressed') === 'true') !== meshOn && wire.click() // the half that is on does nothing
    return b
  }
  const halfSurf = wireHalf('b-surf', t('surface'), t('ch_w_surf_tip'), false)
  const halfMesh = wireHalf('b-mesh', t('mesh'), t('ch_w_mesh_tip'), true)
  wireSeg.append(halfSurf, halfMesh)
  const syncWire = () => {
    const mesh = wire.getAttribute('aria-pressed') === 'true'
    halfSurf.setAttribute('aria-pressed', String(!mesh))
    halfMesh.setAttribute('aria-pressed', String(mesh))
    wireSeg.hidden = wire.hidden // point clouds, splats and G-code have no surface to switch
  }
  new MutationObserver(syncWire).observe(wire, { attributes: true, attributeFilter: ['aria-pressed', 'hidden'] })
  holder.append(wire)
  syncWire()
  const surfaceGroup = group(wireSeg, lookWrap)
  /** The cards show the look the shading list and the colour-per-part switch are in now (none: one of the technical looks). */
  const syncLook = () => {
    const sh = shadingSel.value
    const tint = tintBtn.getAttribute('aria-pressed') === 'true'
    cards.set(tint && sh === 'original' ? 'tint' : ['original', 'solid', 'xray'].includes(sh) && !tint ? sh : null)
    for (const r of [texCheck, edgesCheck, gridCheck, axesCheck, boxCheck, backCheck]) if (r) r.sync()
  }
  shadingSel.addEventListener('change', syncLook)
  new MutationObserver(syncLook).observe(tintBtn, { attributes: true, attributeFilter: ['aria-pressed'] }) // colour per part switched elsewhere (the Parts tab)
  cards.root.setAttribute('aria-label', t('ch_l_title'))
  lookDone.onclick = () => popovers.close(true)

  // Measure, Studio, Export
  const measureBtn = $('b-measure')
  measureBtn.removeAttribute('data-prio')
  iconize(measureBtn, 'measure', measureBtn.textContent.trim(), 6)
  // Section: on or off in the bar (the position, the side and the way round are in the Section tab); the select of the page stays the one source of the state
  const cutBtn = iconize(mk('b-cut', '', t('ch_b_cut_tip')), 'cut', t('ch_b_cut'), 5)
  cutBtn.dataset.needsModel = ''
  cutBtn.setAttribute('aria-pressed', 'false')
  const studioBtn = mk('b-studio', '', t('ch_studio_tip'))
  iconize(studioBtn, 'studio', t('ch_studio'), 3, { arrow: true })
  studioBtn.dataset.needsModel = ''
  const studioIntro = el('p', { className: 'hint', id: 'st-intro', textContent: t('ch_st_intro') })
  // the background: five swatches (always usable, also without a look); the hidden list stays the one source of the mode
  const bgSelect = el('select', { id: 'st-bgmode', hidden: true }, ...['look', 'orca', 'light', 'dark', 'white', 'gradient', 'transparent', 'custom'].map((m) => el('option', { value: m, textContent: t(`ch_bg_${m}`) })))
  bgSelect.setAttribute('aria-hidden', 'true')
  const bgSwatches = new Map()
  const swatchBtn = (mode, extra = {}) => {
    const b = el('button', { type: 'button', className: 'bg-sw', ...extra }, el('span', { className: 'swatch' }), el('span', { textContent: t(`ch_bgs_${mode}`) }))
    b.dataset.bg = mode
    b.dataset.keepOpen = '1'
    b.setAttribute('aria-pressed', 'false')
    b.title = t(`ch_bgt_${mode}`)
    bgSwatches.set(mode, b)
    return b
  }
  const bgOwn = el('input', { type: 'color', id: 'st-bg-custom', value: BG_CUSTOM_DEFAULT })
  bgOwn.setAttribute('aria-label', t('ch_bg_custom'))
  const customSw = el('label', { className: 'bg-sw custom', title: t('ch_bgt_custom') }, bgOwn, el('span', { textContent: t('ch_bgs_custom') }))
  customSw.dataset.bg = 'custom'
  bgSwatches.set('custom', customSw)
  let lastBg = null
  const bgGrid = el('div', { className: 'bg-swatches', id: 'st-bg-swatches', role: 'group' }, ...BG_CYCLE.filter((m) => m !== 'custom').map((m) => swatchBtn(m)), customSw)
  bgGrid.setAttribute('aria-label', t('ch_bg_label'))
  for (const [m, b] of bgSwatches) if (m !== 'custom') b.onclick = () => hooks.setBackground && hooks.setBackground(m)
  bgOwn.oninput = () => hooks.setBackground && hooks.setBackground('custom', bgOwn.value)
  bgOwn.onclick = () => hooks.setBackground && hooks.setBackground('custom', bgOwn.value) // choosing the swatch switches to the own colour; the picker opens as well
  bgOwn.onchange = bgOwn.oninput
  new MutationObserver(() => lastBg && api.syncBackground(...lastBg)).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
  const bgRow = el('div', { id: 'st-bgmode-row' }, menuHeading(t('ch_bg_label')), bgGrid, el('p', { className: 'hint', id: 'st-bg-note', hidden: true }), bgSelect)
  const unlit = el('div', { className: 'hint warn-inline', id: 'st-unlit', hidden: true }, el('span', { textContent: t('studio_unlit') + ' ' }), el('button', { type: 'button', id: 'st-unlit-fix', textContent: t('ch_st_unlit_fix') }))
  const filmBtn = el('button', { type: 'button', id: 'b-film', textContent: t('ch_st_film') })
  const shotOpen = el('button', { type: 'button', id: 'b-shot-open', textContent: t('ch_st_shot') })
  shotOpen.dataset.needsModel = ''
  filmBtn.dataset.needsModel = ''
  const studioFoot = el('div', { className: 'pop-foot', id: 'st-foot' })
  const studioPanel = el('div', { className: 'pop-panel', id: 'pop-studio' }, panelHead(t('ch_studio'), t('ch_st_key')), studioIntro, el('div', { id: 'studio-anchor' }), unlit, studioFoot)
  const studioWrap = el('div', { className: 'pop-wrap' }, studioBtn, studioPanel)
  const exportBtn = $('b-export')
  exportBtn.removeAttribute('data-prio')
  iconize(exportBtn, 'export', exportBtn.textContent.trim(), 4)
  // when the bar is too narrow, even with the words gone, the shell collapses these into rows of the More menu: first Studio, then Export, then Section (shell.js)
  studioWrap.dataset.collapse = '6'
  studioWrap.dataset.proxy = 'm-studio'
  exportBtn.dataset.collapse = '5'
  exportBtn.dataset.proxy = 'm-export'
  cutBtn.dataset.collapse = '4'
  cutBtn.dataset.proxy = 'm-cut'

  // More: what is not needed all the time (the file buttons live here, not on the bar)
  const folderBtn = $('b-pick-folder') ? mk('b-folder-more', t('ch_more_folder'), $('b-pick-folder').title) : null
  const reset = $('b-resetprefs')
  const shot = $('b-shot')
  const bg = $('b-bg')

  // rebuild the bar
  const spacer = $('bar-spacer')
  const openBtn = $('b-open')
  const closeBtn = $('b-close')
  for (const g of [...bar.querySelectorAll('.grp')]) g.remove()
  const openBar = iconize(mk('b-open-bar', '', t('ch_b_open_tip')), 'open', t('ch_b_open'), 8) // a button of its own only from 1300 px (the file is open in the tab; More and the start page have Open as well)
  openBar.dataset.minw = '1300'
  openBar.dataset.emptyOk = '' // ... except while no model is open: then it is the way to open one, at any width
  openBar.onclick = () => openBtn.click()
  const syncOpenBar = () => (openBar.hidden = openBtn.hidden)
  new MutationObserver(syncOpenBar).observe(openBtn, { attributes: true, attributeFilter: ['hidden'] })
  syncOpenBar()
  bar.insertBefore(group(openBar, viewWrap, diagBtn, frontBtn), spacer)
  bar.insertBefore(surfaceGroup, spacer)
  bar.insertBefore(group(measureBtn, cutBtn, studioWrap, exportBtn), spacer)
  const menu = $('more-menu')
  const keysBtn = mk('b-keys', t('ch_m_keys'), t('ch_m_keys_tip'))
  const moreItems = el('div', { className: 'more-fixed' })
  for (const b of [openBtn, folderBtn, closeBtn, keysBtn, reset]) if (b) b.removeAttribute('data-prio')
  if (folderBtn) folderBtn.onclick = () => $('b-pick-folder').click()
  // rows that stand in for bar elements that did not fit (hidden while they fit): Studio, Export, the panel
  const proxy = (id, label, key, action, original) => {
    const b = menuItem(id, label, key, action)
    b.hidden = true
    if (original && original.dataset.needsModel !== undefined) b.dataset.needsModel = '' // what the button cannot do without a model, its row cannot either
    b.dataset.keepOpen = '1' // the action closes the menu itself, so that the focus can go where the action leads
    return b
  }
  const mStudio = proxy('m-studio', t('ch_studio'), 'L', () => popovers.open('studio'), studioBtn)
  const mExport = proxy('m-export', t('ch_ex_title'), 'E', () => (popovers.close(false), exportBtn.click()), exportBtn)
  let lastAxis = ''
  const secAxis = $('sec-axis')
  const mCut = proxy('m-cut', t('ch_b_cut'), '', () => (popovers.close(true), cutBtn.click()), cutBtn) // the focus goes back to More (the row stays there)
  mCut.querySelector('.mi-label').before(el('span', { className: 'mi-check', ariaHidden: 'true' }))
  mCut.setAttribute('role', 'menuitemcheckbox')
  const syncCut = () => {
    const on = $('sec-axis').value !== ''
    if (on) lastAxis = $('sec-axis').value // the axis it has (also when it was chosen in the tab): the button brings it back
    cutBtn.setAttribute('aria-pressed', String(on))
    mCut.setAttribute('aria-checked', String(on))
    mCut.querySelector('.mi-check').textContent = on ? '✓' : ''
  }
  cutBtn.onclick = () => {
    const was = secAxis.value
    // on: the axis it had, else the one that is up (a flat slice); off: no axis
    secAxis.value = was ? '' : lastAxis || ($('up') && ['x', 'y', 'z'].includes($('up').value) ? $('up').value : 'z')
    secAxis.dispatchEvent(new Event('change', { bubbles: true }))
    syncCut()
    if (!was) (hooks.openPanel && hooks.openPanel(), selectTabOf('cut')) // the position and the side are in the Section tab
  }
  secAxis.addEventListener('change', syncCut)
  syncCut()
  const moved = el('div', { className: 'more-moved' }, mStudio, mExport, mCut) // the group above the files: only there while Studio, Export or Section did not fit
  moreItems.append(moved, ...[openBtn, folderBtn, closeBtn, el('hr', { className: 'menu-rule' }), keysBtn, el('hr', { className: 'menu-rule' }), reset].filter(Boolean))
  for (const b of moreItems.querySelectorAll('button:not(.menu-item)')) b.classList.add('menu-item')
  menu.append(moreItems)
  // the status bar at the bottom is the frame of the window: the sidebar button lives there (it never has to give way), later the numbers of the view (E4)
  const panelBtn = $('b-panel')
  panelBtn.removeAttribute('data-i18n')
  panelBtn.removeAttribute('data-i18n-title')
  panelBtn.title = t('ch_b_side_tip')
  iconize(panelBtn, 'side', t('ch_b_side'))
  const statusSlot = el('div', { id: 'status-slot', className: 'status-slot' })
  const zoomBtn = el('button', { type: 'button', id: 'status-zoom', className: 'bb', title: t('ch_s_zoom_tip'), hidden: true })
  // the version of the plugin, small: which build is on screen (the number is the manifest's: editor/version.js, checked by a test; origin "manifest")
  const versionEl = el('span', { id: 'status-version', className: 'status-version', textContent: version ? `v${version}` : '', hidden: !version, title: t('ch_ver_tip') })
  versionEl.dataset.src = 'manifest'
  const status = el('footer', { id: 'status', className: 'statusbar' }, panelBtn, statusSlot, zoomBtn, versionEl)
  status.setAttribute('role', 'contentinfo')
  status.setAttribute('aria-label', t('ch_status_label'))
  status.dataset.honest = '1' // every number of the status bar carries its origin (view-info.js): the honesty check reads it
  $('main').after(status)
  // the orientation cube, the scale bar and the numbers of the status bar: one module (view-info.js); a click on the cube asks for the view like the View menu does
  // a face is a view of the menu; an edge or a corner looks from between two or three faces
  const view = createViewInfo({ t, locale, stage: $('stage'), statusSlot, zoomButton: zoomBtn, onPick: (target) => (target.kind === 'face' ? setView(target.name) : hooks.lookFrom && hooks.lookFrom(target.dir)), onFitAll: () => hooks.fitAll && hooks.fitAll() })
  $('more-wrap').hidden = false
  const moreBtn = $('b-more')
  iconize(moreBtn, 'more', t('ch_more'), 2) // the word goes first in a narrow bar, the symbol stays
  // the group is made after the bar is rebuilt, the shell wires the More menu itself
  popovers.add({ id: 'view', button: viewBtn, panel: viewPanel })
  popovers.add({ id: 'look', button: lookBtn, panel: lookPanel })
  popovers.add({ id: 'studio', button: studioBtn, panel: studioPanel })

  // ----- the side tabs -----
  const side = $('side')
  const statsDetails = document.querySelector('details[data-key="stats"]')
  if (statsDetails && !statsDetails.id) statsDetails.id = 'stats-sec' // the Model Viewer's has none
  const sections = {
    parts: $('part-sec'),
    cut: $('sec-sec'),
    edit: $('tools-sec'),
    info: [$('quality-sec'), $('stats-sec') || document.querySelector('details[data-key="stats"]'), $('keep-row')].filter(Boolean),
  }
  const panels = {}
  const tabDefs = [
    { id: 'parts', label: t('ch_tab_parts') },
    { id: 'cut', label: t('ch_tab_cut') },
    { id: 'measure', label: t('ch_tab_measure_n', { n: 0 }) },
    { id: 'info', label: t('ch_tab_info') },
    { id: 'edit', label: t('ch_tab_edit') }
  ]
  const tabList = el('div', { className: 'tabs', id: 'side-tabs' })
  tabList.setAttribute('aria-label', t('ch_tabs_label'))
  const empty = $('side-empty')
  empty.after(tabList)
  const sideClose = $('side-close')
  document.body.classList.add('tabbed') // the heading "Panel" with its close button gives way to the tab row, which has the close button at its end
  let anchor = tabList
  for (const d of tabDefs) {
    const panel = el('div', { className: 'tabpanel', id: `tp-${d.id}` })
    panels[d.id] = panel
    d.panel = panel
    anchor.after(panel)
    anchor = panel
    const s = sections[d.id]
    for (const x of Array.isArray(s) ? s : s ? [s] : []) {
      if (x.tagName === 'DETAILS') plain(x)
      panel.append(x)
    }
  }
  if (bg) {
    // the old button stays for the key B (it steps through the backgrounds); the list in the Studio menu is the visible control
    bg.removeAttribute('data-prio')
    bg.hidden = true
    studioPanel.append(bg)
  }
  if (shot) {
    // "Save image" is no longer a quick button of its own: it opens the export dialog on Image (the old button stays, hidden, for the page's handler)
    shot.removeAttribute('data-prio')
    shot.hidden = true
    studioFoot.append(shot, shotOpen, filmBtn)
  }
  // the heading of the info tab
  panels.info.prepend(el('h3', { className: 'tab-title', id: 'info-title', textContent: t('ch_info_whole') }), el('p', { className: 'hint', id: 'info-intro', textContent: t('ch_info_intro') }))
  const cutIntro = el('p', { className: 'hint', id: 'cut-intro', textContent: t('ch_cut_intro') })
  panels.cut.prepend(cutIntro)
  panels.info.append(el('p', { className: 'hint', id: 'info-selected', hidden: true }))
  // the numbers nobody needs every day (load time, texture memory) sit one level down
  const stats = $('stats')
  if (stats) {
    const more = el('details', { id: 'stats-adv', hidden: true }, el('summary', { textContent: t('ch_info_advanced') }), el('dl', { id: 'stats-more' }))
    more.className = 'stats-adv'
    stats.after(more)
  }
  // ----- Parts: a sentence, the filter, the tree with its vertical tool strip beside it, the count, explode and opacity (E2b) -----
  const partSec = $('part-sec')
  const multiBtn = el('button', { type: 'button', id: 'b-multi' })
  multiBtn.setAttribute('aria-pressed', 'false')
  multiBtn.dataset.keepOpen = '1'
  const onlyBtn = el('button', { type: 'button', id: 'l-only' })
  onlyBtn.disabled = true
  const clearSelBtn = el('button', { type: 'button', id: 'b-sel-clear' })
  let multiOn = false
  multiBtn.onclick = () => {
    multiOn = !multiOn
    multiBtn.setAttribute('aria-pressed', String(multiOn))
    hooks.setMulti && hooks.setMulti(multiOn)
  }
  onlyBtn.onclick = () => hooks.isolate && hooks.isolate()
  clearSelBtn.onclick = () => hooks.clearSelection && hooks.clearSelection()
  const countLine = $('part-count')
  if (partSec) {
    const kids = {
      filter: $('filter'),
      list: $('parts'),
      explode: $('explode') && $('explode').closest('label'),
      opacity: $('part-opacity') && $('part-opacity').closest('label'),
      oldHint: partSec.querySelector('p.hint')
    }
    if (kids.oldHint) kids.oldHint.remove()
    if (countLine) countLine.remove()
    const tint = $('l-color')
    if (tint) holder.append(tint) // the Color per part card of the Appearance menu is the switch now; the button stays, hidden
    // the page's own buttons (their ids, handlers and states stay) get a symbol, a name and a tooltip, and stand in a vertical strip beside the list
    const treeStrip = buildTreeStrip({
      t,
      buttons: [
        { el: $('l-all'), icon: 'eye', label: t('ch_p_all'), tip: t('ch_p_all_tip') },
        { el: $('l-none'), icon: 'hide', label: t('ch_p_none'), tip: t('ch_p_none_tip') },
        { el: onlyBtn, icon: 'isolate', label: t('ch_p_only'), tip: t('ch_p_only_tip') },
        { el: $('l-inv'), icon: 'invert', label: t('ch_p_inv'), tip: t('ch_p_inv_tip') },
        { el: clearSelBtn, icon: 'none', label: t('ch_p_clear'), tip: t('ch_p_clear_tip') },
        { el: multiBtn, icon: 'multi', label: t('ch_p_multi_btn'), tip: t('ch_p_multi_tip') }
      ]
    })
    if (kids.filter) kids.filter.hidden = false // the filter is always there (the viewers used to show it from 8 parts on)
    const treeWrap = el('div', { className: 'tree-wrap', id: 'tree-wrap' }, kids.list, treeStrip.strip)
    if (countLine) countLine.classList.add('parts-count')
    const box = el('div', { id: 'part-sec', className: 'tabsec', hidden: partSec.hidden }, el('p', { className: 'hint', id: 'parts-hint', textContent: t('ch_p_hint') }), ...[kids.filter].filter(Boolean), el('p', { className: 'hint parts-cap', id: 'parts-cap', textContent: t('ch_p_tris') }), treeWrap, el('p', { className: 'hint parts-note', id: 'parts-note', hidden: true, role: 'status' })) // what the Δ after a name stands for
    if (countLine) box.append(countLine)
    box.append(...[kids.explode, kids.opacity].filter(Boolean))
    partSec.replaceWith(box) // a plain block: a details element without its summary would show a label of its own
    if (kids.explode) {
      kids.explode.firstElementChild.textContent = t('ch_p_explode')
      kids.explode.title = t('ch_p_explode_tip')
    }
    if (kids.opacity) {
      kids.opacity.firstElementChild.textContent = t('ch_p_opacity')
      kids.opacity.title = t('ch_p_opacity_tip')
    }
  }

  // ----- the card Files: one row (the viewer fills it; each window holds one model) -----
  const files = buildFileCard({ t, open: () => openBtn.click(), close: () => closeBtn.click() })
  const syncFilesButtons = () => {
    files.hideOpen(openBtn.hidden)
    files.hideClose(closeBtn.hidden) // Open and Close of the card follow the page's own buttons (hidden in the editor tab of a project file)
  }
  new MutationObserver(syncFilesButtons).observe(openBtn, { attributes: true, attributeFilter: ['hidden'] })
  new MutationObserver(syncFilesButtons).observe(closeBtn, { attributes: true, attributeFilter: ['hidden'] })
  syncFilesButtons()

  // ----- Info: the numbers of the whole model, the unit, check and copy -----
  const statsSec = sections.info.find((x) => x.id === 'stats-sec' || (x.dataset && x.dataset.key === 'stats')) || null
  const unitSel = $('tl-unit')
  const oldUnitRow = unitSel && unitSel.closest('.row')
  if (statsSec && unitSel) {
    const assign = $('tl-assign')
    const unitRow = el('div', { className: 'row', id: 'info-unit' }, el('span', { className: 'grow', textContent: t('tl_unit') }), unitSel, assign)
    const hint = $('tl-unit-hint')
    const checkBtn = $('tl-check-btn')
    const checkOut = $('tl-check')
    const copyBtn = $('b-copy-details')
    const actions = el('div', { className: 'row wrap', id: 'info-actions' }, checkBtn, copyBtn)
    const old = copyBtn.closest('.row')
    if (oldUnitRow) oldUnitRow.remove() // the label that stayed behind
    statsSec.append(unitRow)
    if (hint) statsSec.append(hint)
    statsSec.append(actions, checkOut)
    if (old && old !== actions) old.remove()
  }

  // the progress, the errors and Cancel of the tools sit under the tab row, so that they show whichever tab started the work
  if ($('tl-result') && $('tl-cancel')) {
    const strip = el('div', { id: 'tools-strip', className: 'tools-strip' }, $('tl-result'), $('tl-cancel'))
    tabList.after(strip)
  }

  // ----- Edit: position and size, parts, simplify; "Convert to" is its own row, the unit itself lives in Info -----
  const toolsSec = sections.edit
  if (toolsSec) {
    const unitTo = el('select', { id: 'tl-unit-to' }, ...['µm', 'mm', 'cm', 'm', 'in', 'ft'].map((u) => el('option', { value: u, textContent: u, selected: u === 'mm' })))
    unitTo.setAttribute('aria-label', t('tl_convert'))
    const conv = $('tl-convert')
    conv.addEventListener('click', () => (unitSel.value = unitTo.value), true) // the tool reads the unit list: it gets the target chosen in this row
    new MutationObserver(() => (unitTo.disabled = unitSel.disabled)).observe(unitSel, { attributes: true, attributeFilter: ['disabled'] }) // locked with the rest of the tools
    const convRow = el('div', { className: 'row wrap', id: 'tl-convert-row' }, el('span', { className: 'grow', textContent: t('ch_e_convert') }), unitTo, conv)
    const oldConvRow = conv.closest('.row')
    const centerRow = $('tl-center').closest('.row')
    centerRow.before(convRow)
    if (oldConvRow && !oldConvRow.children.length) oldConvRow.remove()
    const bake = $('tl-bake-up')
    if (bake) {
      bake.hidden = true // replaced by View > Up is (it works in the view and in the export)
      holder.append(bake)
    }
    const status = $('tl-status')
    const none = el('p', { className: 'hint', id: 'tl-status0', textContent: t('ch_e_none') })
    status.before(none)
    new MutationObserver(() => (none.hidden = !status.hidden)).observe(status, { attributes: true, attributeFilter: ['hidden'] })
    none.hidden = !status.hidden
    toolsSec.prepend(el('p', { className: 'hint', textContent: t('ch_edit_intro') }), none)
    const oldIntro = toolsSec.querySelector('p.hint[data-i18n="tl_intro"]')
    if (oldIntro) oldIntro.hidden = true
  }

  const tabs = createTabs({
    list: tabList,
    tabs: tabDefs.map((d) => ({ id: d.id, label: d.label, panel: d.panel })),
    active: tabPref.get(),
    preferred: 'parts',
    onChange: (id) => tabPref.set(id)
  })
  const tabClose = el('button', { type: 'button', id: 'b-tab-close', className: 'tab-close', textContent: '✕' })
  tabClose.setAttribute('aria-label', sideClose.getAttribute('aria-label') || '')
  tabClose.title = sideClose.title
  tabClose.onclick = () => sideClose.click() // the same close as the heading's, for when the heading gave way to the tab row
  tabList.append(tabClose)
  const selectTabOf = (id) => {
    const owner = tabDefs.find((d) => d.panel.contains($(id)) || d.id === id)
    if (owner) {
      tabs.select(owner.id)
      if (owner.id === 'edit') setEditOpen(true) // three columns: the Edit card is folded until it is asked for
    }
  }

  // ----- three columns (shell.js says "layout-mode"): the tab panels stand as cards, Parts on the left, the others on the right; no tab row -----
  const cardTitle = { parts: t('ch_card_parts'), cut: t('ch_tab_cut'), measure: t('ch_card_measure'), info: t('ch_card_info'), edit: t('ch_tab_edit') }
  const cardHead = {}
  const cardIcon = { parts: 'tree', cut: 'cut', measure: 'measure', info: 'info', edit: 'edit' } // the symbol in front of each card's title
  for (const d of tabDefs) cardHead[d.id] = asCard(d.panel, { id: `card-${d.id}`, title: cardTitle[d.id], icon: icon(cardIcon[d.id]), honest: d.id === 'info' || d.id === 'parts' }) // the Info card and the part tree (their numbers and names carry data-src) are part of the honesty check
  // the explanations that used to stand in the cards all the time sit behind a "?" in the card's head (with tabs the head shows only the "?")
  const addHelp = (tab, targets) => {
    const b = helpButton({ id: `b-help-${tab}`, label: t('ch_help_for', { card: cardHead[tab].querySelector('.card-t').textContent }), tip: t('ch_help_tip'), mark: icon('help'), targets }) // five "?" with the same name would tell nothing: each names its card
    cardHead[tab].querySelector('.card-t').after(b)
    return b
  }
  addHelp('parts', [$('parts-hint'), $('parts-cap')])
  addHelp('info', [$('info-intro'), $('quality-sec') && $('quality-sec').querySelector('p.hint')])
  const cutHelp = addHelp('cut', [cutIntro])
  // the three sizes of the whole model: the row X, Y, Z at the top of the Info card (the viewer fills it)
  const dimsBox = el('div', { className: 'dims-block', id: 'info-dims', hidden: true })
  $('info-intro').after(dimsBox)
  const measureN = el('small', { className: 'card-n', textContent: '0' }) // the number of measurements: an interface count, so it says where it comes from
  measureN.dataset.src = 'ui'
  cardHead.measure.append(measureN)
  cardHead.info.after(files.card) // with tabs the Files card heads the Info tab; in three columns it heads the left column (applyMode)
  let editOpen = false
  const editToggle = el('button', { type: 'button', id: 'b-card-edit', className: 'card-toggle' })
  const setEditOpen = (open) => {
    editOpen = open
    panels.edit.classList.toggle('collapsed', !open)
    editToggle.setAttribute('aria-expanded', String(open))
    editToggle.setAttribute('aria-controls', 'tp-edit')
    editToggle.textContent = open ? '▾' : '▸'
    editToggle.title = open ? t('ch_card_fold') : t('ch_card_unfold')
    editToggle.setAttribute('aria-label', editToggle.title)
  }
  editToggle.onclick = () => setEditOpen(!editOpen)
  cardHead.edit.append(editToggle)
  setEditOpen(false)
  for (const d of tabDefs) d.panel._tabId = d.panel.getAttribute('aria-labelledby')
  let threeNow = false
  let gcodeNow = false
  // which panels show as a card: Section only while a plane is on (the bar's Section button turns it on; its card has "Off"), Layers always for a toolpath,
  // Measurements from the first measurement on (like its tab), the others whenever they exist
  const cardShows = (id) => (id === 'cut' ? gcodeNow || $('sec-axis').value !== '' : true)
  const cutOff = el('button', { type: 'button', id: 'b-cut-off', className: 'card-act', textContent: t('ch_card_off'), title: t('ch_card_off_tip') })
  cutOff.onclick = () => {
    secAxis.value = ''
    secAxis.dispatchEvent(new Event('change', { bubbles: true }))
    ;($('b-cut') || bar).focus()
  }
  cardHead.cut.append(cutOff)
  const applyMode = (mode) => {
    const th = mode === 'three'
    if (th === threeNow) return
    threeNow = th
    const col = $('col-l')
    const focused = panels.parts.contains(document.activeElement) ? document.activeElement : null // moving the panel drops the focus: it is given back below
    if (th && col) {
      col.prepend(files.card)
      col.append(panels.parts)
    } else {
      cardHead.info.after(files.card)
      panels.cut.before(panels.parts) // back where the tab order has it
    }
    if (focused && focused.isConnected && focused.offsetParent !== null) focused.focus({ preventScroll: true })
    tabs.setStacked(th ? (id) => cardShows(id) : null)
    tabList.classList.toggle('stacked', th)
    // without a tab row a panel is a region named by its card heading, not a tab panel named by a tab that is not there
    for (const d of tabDefs) {
      if (th) {
        d.panel.setAttribute('role', 'region')
        d.panel.setAttribute('aria-labelledby', `card-${d.id}-t`) // the title of the card names the region
      } else {
        d.panel.setAttribute('role', 'tabpanel')
        d.panel.setAttribute('aria-labelledby', d.panel._tabId)
      }
    }
    if (th && tabs.current() === 'edit') setEditOpen(true) // Edit was the tab in use: its card is open
  }
  document.addEventListener('layout-mode', (e) => applyMode(e.detail))
  secAxis.addEventListener('change', () => tabs.refresh())
  applyMode(document.body.dataset.layout)

  // ----- the measuring bar in the view -----
  const stage = $('stage')
  const modes = ['distance', 'angle', 'circle', 'edge', 'chain', 'parts']
  const segBtns = new Map()
  const mBar = el('div', { id: 'measure-bar', className: 'chip measure-bar', hidden: true })
  mBar.setAttribute('role', 'group')
  mBar.setAttribute('aria-label', t('ch_m_label'))
  const seg = el('span', { className: 'seg' })
  for (const m of modes) {
    const b = el('button', { type: 'button', textContent: t(`ch_m_${m}`) })
    b.dataset.mode = m
    segBtns.set(m, b)
    seg.append(b)
  }
  const chainDone = el('button', { type: 'button', id: 'b-chain-done', textContent: t('mp_finish_chain'), title: t('mp_finish_chain_tip'), hidden: true })
  const chainClose = el('button', { type: 'button', id: 'b-chain-close', textContent: t('mp_close_chain'), title: t('mp_close_chain_tip'), hidden: true })
  const clearBtn = el('button', { type: 'button', id: 'b-measure-clear', textContent: t('ch_m_clear'), title: t('ch_m_clear_tip') })
  const doneBtn = el('button', { type: 'button', id: 'b-measure-done', textContent: t('ch_m_done') })
  mBar.append(seg, chainDone, chainClose, $('measure-out'), clearBtn, doneBtn) // the result sits in the bar, between the ways to measure and the buttons
  stage.append(mBar)
  const sel = $('measure-mode')
  const measureSec = $('measure-sec')
  if (measureSec) measureSec.remove()
  mBar.append(sel) // the select stays the source of truth (hidden): the segment buttons set it
  sel.hidden = true
  // the playback bar (only for files with animation)
  const play = $('anim-sec')
  if (play) {
    plain(play)
    play.classList.add('playbar')
    play.setAttribute('aria-label', t('ch_play_label'))
    stage.append(play)
  }

  const measureBar = {
    bind({ setMode, clear, done, finishChain }) {
      for (const [m, b] of segBtns) b.onclick = () => setMode(m)
      clearBtn.onclick = clear
      doneBtn.onclick = done
      chainDone.onclick = () => finishChain(false)
      chainClose.onclick = () => finishChain(true)
    },
    /** on: measuring; mode: current; partsOk: two or more parts (the Parts way exists); chainCount: points of the chain being clicked. */
    sync({ on, mode, partsOk, chainCount = 0 }) {
      mBar.hidden = !on
      chainDone.hidden = !(on && mode === 'chain' && chainCount >= 2)
      chainClose.hidden = !(on && mode === 'chain' && chainCount >= 3)
      for (const [m, b] of segBtns) {
        b.setAttribute('aria-pressed', String(m === mode))
        if (m === 'parts') b.hidden = !partsOk
      }
    }
  }

  // ----- the export dialog (chrome-export.js) -----
  const exportDialog = buildExportDialog({ t, popovers, holder, filmBtn, hooks: { onEdit: () => (hooks.openPanel && hooks.openPanel(), tabs.select('edit')) } })
  const { openExport, closeExport } = exportDialog

  // ----- the list of keyboard shortcuts -----
  const keysDialog = el('div', { id: 'keys-dialog', className: 'export-dialog keys-dialog', hidden: true, role: 'dialog' })
  keysDialog.setAttribute('aria-labelledby', 'keys-title')
  keysBtn.setAttribute('aria-haspopup', 'dialog')
  const keysClose = el('button', { type: 'button', id: 'b-keys-close', textContent: '✕' })
  keysClose.setAttribute('aria-label', t('side_close'))
  const keysList = el('dl', { className: 'keys-list' })
  for (const r of SHORTCUT_ROWS) keysList.append(el('dt', { textContent: r.keys }), el('dd', { textContent: t(r.text) }))
  keysDialog.append(el('div', { className: 'export-head' }, el('div', { className: 'export-title', id: 'keys-title', textContent: t('ch_k_title') }), keysClose), keysList)
  $('stage').append(keysDialog)
  const closeKeys = () => {
    if (keysDialog.hidden) return false
    keysDialog.hidden = true
    $('b-more').focus()
    return true
  }
  keysClose.onclick = closeKeys
  keysDialog.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      closeKeys()
    }
  })
  keysBtn.dataset.keepOpen = '1' // the menu is closed here, so that the focus can go into the dialog
  keysBtn.onclick = () => {
    popovers.close(false)
    keysDialog.hidden = false
    keysClose.focus()
  }

  // ----- hooks of the buttons the viewer does not wire itself -----
  filmBtn.onclick = () => openExport('film')
  shotOpen.onclick = () => openExport('image')
  bgSelect.onchange = () => hooks.setBackground && hooks.setBackground(bgSelect.value)
  $('st-unlit-fix').onclick = () => hooks.shadingOriginal && hooks.shadingOriginal()
  document.addEventListener('open-section', (e) => {
    if (e.detail === 'export-sec') return openExport() // the export section is the dialog now
    hooks.openPanel && hooks.openPanel()
    selectTabOf(e.detail)
  })

  const api = {
    popovers,
    tabs,
    measureBar,
    /** The cube, the scale bar and the status bar numbers: view.setModel({ tris, points, parts, unit, unitSrc } | null) and view.frame({ matrix, distance, fov, viewH, fit, grid: { on, step } }) after each drawn frame. */
    view,
    /** The three sizes of the whole model (the row at the top of the Info card): dims.update({ x, y, z (already formatted), unit, unitSrc ('file' | 'assumed') }) or dims.update(null) when no file is open. The numbers say "derived"; an assumed unit says so under them. */
    dims: {
      update(d) {
        dimsBox.hidden = !d
        if (!d) return dimsBox.replaceChildren()
        dimsBox.replaceChildren(
          dimsRow(['x', 'y', 'z'].map((a) => ({ label: a.toUpperCase(), value: d[a], unit: d.unit, src: 'derived' })), { id: 'info-dims-row' }),
          el('p', { className: 'dims-src' }, t('ch_dims_src'), ...(d.unitSrc === 'assumed' ? [' ', src('assumed', t('pc_unit_assumed', { u: d.unit }))] : []))
        )
      }
    },
    /** The card Files: files.update({ name, format, size, unit, unitSrc, quality? }) or files.update(null) when no file is open. */
    files,
    /** The Measurements tab: built when the viewer has made its measuring tool (opts as buildMeasureTab, without t and panel). It shows from the first measurement on, with their number. */
    bindMeasureTab(opts) {
      const tab = buildMeasureTab({ t, panel: panels.measure, ...opts })
      const store = opts.measure.store
      const sync = () => {
        const was = measureCount
        measureCount = store.count()
        if (was > 0 && measureCount === 0 && panels.measure.contains(document.activeElement)) $('b-measure').focus() // the tab goes away with its last row: the focus goes to the button that measures
        if (lastUpdate) api.update(...lastUpdate)
      }
      store.on(sync) // after the tab's own redraw
      sync()
      return tab
    },
    selectTabOf,
    hooks,
    openExport,
    syncLook,
    closeExport,
    closeKeys,
    /** A file was closed: "Select several" is off again. */
    resetMulti() {
      multiOn = false
      multiBtn.setAttribute('aria-pressed', 'false')
      hooks.setMulti && hooks.setMulti(false)
    },
    /** Whether the export dialog is open. */
    exportOpen: exportDialog.exportOpen,
    setFileKind: exportDialog.setFileKind,
    /** The swatches show the background (Orca's colour is drawn as it is now); the Studio button says whether a look is on. */
    syncBackground(mode, studioOn, color = BG_CUSTOM_DEFAULT) {
      mStudio.querySelector('.mi-label').textContent = studioOn ? t('ch_studio_on') : t('ch_studio')
      bgSelect.value = mode
      const dark = document.documentElement.classList.contains('dark')
      const lookOwn = mode === 'look' && studioOn // the look decides: no swatch is the choice
      const shown = lookOwn ? null : mode === 'look' || mode === 'orca' ? 'orca' : mode === 'light' && !dark ? 'orca' : mode === 'dark' && dark ? 'orca' : mode
      for (const [m, b] of bgSwatches) {
        if (m === 'custom') bgOwn.setAttribute('aria-label', m === shown ? `${t('ch_bg_custom')}, ${t('ch_bg_chosen')}` : t('ch_bg_custom')) // a label has no pressed state: the colour field says it
        else b.setAttribute('aria-pressed', String(m === shown))
        b.classList.toggle('sel', m === shown)
      }
      const sw = (m) => bgSwatches.get(m).querySelector('.swatch')
      sw('orca').style.background = dark ? ORCA_BG.dark : ORCA_BG.light
      sw('white').style.background = '#fff'
      sw('gradient').style.background = 'linear-gradient(#eceef1, #8e949c)'
      sw('transparent').style.background = 'repeating-conic-gradient(#999 0 25%, #ddd 0 50%) 0 0 / 8px 8px'
      bgOwn.value = color
      bgOwn.dataset.shown = color
      const storedOld = !lookOwn && shown !== 'orca' && (mode === 'light' || mode === 'dark') // an old choice (Light, Dark) of the other theme: no swatch is it
      const note = $('st-bg-note')
      note.hidden = !(lookOwn || storedOld)
      note.textContent = lookOwn ? t('ch_bg_look_note') : storedOld ? t('ch_bg_stored_note', { name: t(`ch_bg_${mode}`) }) : ''
      lastBg = [mode, studioOn, color]
      studioBtn.classList.toggle('on', studioOn)
      studioBtn.querySelector('.lbl').textContent = studioOn ? t('ch_studio_on') : t('ch_studio')
      studioBtn.setAttribute('aria-label', `${studioOn ? t('ch_studio_on') : t('ch_studio')}`)
    },
    /** After the studio section exists: look tiles with a swatch, the background, floor and turntable in the order of the menu, details one level down. */
    decorateStudio() {
      const sec = $('studio-sec')
      plain(sec)
      const preset = $('st-preset')
      const tiles = el('div', { className: 'look-tiles', id: 'st-tiles' })
      for (const o of [...preset.options]) {
        if (o.value === 'custom') continue
        const st = presetState(o.value)
        const [c1, c2] = [st.bg.color, st.bg.type === 'gradient' ? st.bg.color2 : st.bg.color]
        const swatch = el('span', { className: 'swatch' })
        swatch.style.background = o.value === 'original' ? 'var(--bg)' : `linear-gradient(${c1}, ${c2})`
        const b = el('button', { type: 'button' }, swatch, el('span', { textContent: o.textContent.replace(/ \(.*\)$/, '') }))
        b.dataset.preset = o.value
        b.dataset.keepOpen = '1'
        b.onclick = () => {
          preset.value = o.value
          preset.dispatchEvent(new Event('change', { bubbles: true }))
        }
        tiles.append(b)
      }
      const presetRow = preset.closest('label')
      presetRow.hidden = true // the select stays the one source of the look; the tiles set it
      presetRow.before(bgRow, menuHeading(t('ch_st_looks'), { id: 'st-looks-head' }), tiles) // the background first: it is what people look for
      const row = (id) => $(id) && $(id).closest('label')
      const floorRow = row('st-floor')
      const shadowRow = row('st-shadow')
      const note = $('st-note')
      // the turntable: Turn + Speed on one row; Reset goes to the foot of the menu
      const spin = $('st-spin')
      const reset = $('st-reset')
      const speedRow = row('st-speed')
      speedRow.classList.add('grow')
      const turn = el('div', { className: 'row', id: 'st-turn' }, spin, speedRow)
      const h4 = [...sec.querySelectorAll('h4.sub')].find((h) => h.textContent === t('st_turntable'))
      if (h4) h4.className = 'menu-heading'
      const adv = el('details', { id: 'st-adv', className: 'st-adv' }, el('summary', { textContent: t('ch_st_adv') }))
      for (const id of ['st-bg', 'st-color', 'st-color2', 'st-env', 'st-exposure', 'st-tone', 'st-quality']) {
        const r = row(id)
        if (r) adv.append(r)
      }
      const lights = $('st-lights')
      if (lights) adv.append(lights)
      const why = $('st-why')
      tiles.after(floorRow, shadowRow, why, note)
      if (h4) note.after(h4, turn)
      else note.after(turn)
      turn.after(adv)
      const hint = $('st-hint')
      if (hint) hint.hidden = true
      studioFoot.append(reset)
      const sync = () => {
        for (const b of tiles.children) b.setAttribute('aria-pressed', String(b.dataset.preset === preset.value))
      }
      sync()
      return sync
    },
    /** c = controlsState(...) plus { hasModel, selectedName, kind }: which tabs exist, the selected part in the info tab, fit enabled. */
    update(c, extra = {}) {
      lastUpdate = [c, extra]
      const gcode = extra.kind === 'gcode'
      const ids = []
      if (extra.hasModel) {
        if (c.partsTab.visible) ids.push('parts')
        if (c.clip.visible || c.layers.visible) ids.push('cut')
        if (extra.measurable !== false && measureCount > 0) ids.push('measure') // a point cloud or a toolpath has no surface to measure on; the tab shows from the first measurement
        ids.push('info') // Parts, Section, Measure, Info, Edit
        if (c.editTab.visible) ids.push('edit')
      }
      const key = `${ids.join()}|${gcode}`
      tabs.label('cut', t(gcode ? 'ch_tab_layers' : 'ch_tab_cut'))
      tabs.label('measure', t('ch_tab_measure_n', { n: measureCount }))
      gcodeNow = gcode
      cardHead.cut.querySelector('.card-t').textContent = t(gcode ? 'ch_tab_layers' : 'ch_tab_cut')
      cutHelp.setAttribute('aria-label', t('ch_help_for', { card: cardHead.cut.querySelector('.card-t').textContent }))
      cutOff.hidden = gcode // a toolpath's layers are not switched off
      measureN.textContent = String(measureCount)
      cutIntro.textContent = t(gcode ? 'ch_layers_intro' : 'ch_cut_intro')
      if (key !== updateKey) {
        updateKey = key
        tabs.setShown(ids, tabs.current() || tabPref.get(), ids.includes('parts') ? 'parts' : 'info', false) // not the person's choice: not remembered
      } else tabs.refresh()
      tabList.hidden = ids.length === 0
      const un = $('st-unlit')
      if (un) un.hidden = !(extra.studioActive && c.studioLight.reason === 'studio_unlit')
      onlyBtn.disabled = !extra.hasModel || !c.fitSelected.enabled
      cards.rows.get('tint').hidden = !c.tint.visible
      cutBtn.hidden = extra.hasModel ? !c.clip.visible : false // a toolpath has layers instead of a section plane; with no model the button is there but off, so the bar does not jump when a file loads
      if (!extra.hasModel) lastAxis = '' // the axis belongs to the file that was cut
      syncCut()
      syncLook()
      viewFit.disabled = !extra.hasModel || !c.fitSelected.enabled
      viewFit.title = c.fitSelected.reason ? t(c.fitSelected.reason) : ''
      const line = $('info-selected')
      line.hidden = !extra.selectedName
      if (extra.selectedName) {
        line.textContent = t('ch_info_selected', { name: extra.selectedName })
        line.dataset.src = 'file' // the name of the selected part
      }
    }
  }
  return api
}

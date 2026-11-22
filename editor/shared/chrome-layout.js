// Shared by 3D Model Viewer and STEP Viewer 3D (canonical copy: plugins/_shared; do not edit the copies in editor/shared).
// The toolbar (6 elements), the side tabs and the measuring bar, built at start from the elements the pages declare (index.html keeps the ids;
// this module moves them into popovers and tabs). One place for both viewers, so no markup is kept in three HTML files.
import { createPopoverGroup, createTabs } from './popover.js'
import { presetState } from './studio-core.js'
import { buildExportDialog } from './chrome-export.js'
import { buildMeasureTab } from './measure-ui.js'
import { $, el, menuItem, menuHeading, menuRule, proxyCheck, choiceCards, SHORTCUT_ROWS } from './chrome-ui.js'

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
export function buildChrome({ t, step = false, tabPref = { get: () => null, set: () => {} } }) {
  let updateKey = ''
  const bar = $('bar')
  const popovers = createPopoverGroup()

  // ----- the toolbar: six elements, then More and the panel button -----
  const mk = (id, label, title, extra = {}) => el('button', { id, type: 'button', textContent: label, title, ...extra })
  const popBtn = (id, label, tip) => {
    const b = mk(id, '', tip)
    b.append(el('span', { className: 'lbl', textContent: label }), ' ▾') // the label goes in a narrow bar, the arrow stays
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
  const viewRows = VIEWS.map((v, i) =>
    menuItem(`b-view-${v}`, t(`ch_v_${v}`), String(i + 1), () => {
      preset.value = v
      preset.dispatchEvent(new Event('change', { bubbles: true }))
      preset.value = ''
    })
  )
  const upSel = $('up')
  const upRow = upSel.closest('label')
  upRow.className = 'row stack'
  const upSecOld = upSel.closest('details')
  const upHint = $('up-hint')
  const viewPanel = el('div', { className: 'pop-panel menu-list', id: 'pop-view' }, viewAll, viewFit, menuRule(), menuHeading(t('ch_v_from')), ...viewRows, menuRule(), upRow)
  if (upHint) viewPanel.append(upHint)
  viewPanel.append(el('p', { className: 'hint', textContent: t('ch_v_note') }))
  if (upSecOld) upSecOld.remove()
  const viewBtn = popBtn('b-view', t('ch_view'), t('ch_view_tip'))
  const viewWrap = el('div', { className: 'pop-wrap' }, viewBtn, viewPanel)

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
  const lookBtn = popBtn('b-look', t('ch_look'), t('ch_look_tip'))
  const lookWrap = el('div', { className: 'pop-wrap' }, lookBtn, lookPanel)
  const surfaceGroup = group(wire, lookWrap)
  surfaceGroup.classList.add('split')
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
  const studioBtn = mk('b-studio', '', t('ch_studio_tip'))
  studioBtn.append(el('span', { className: 'lbl', textContent: t('ch_studio') }), ' ▾')
  studioBtn.dataset.needsModel = ''
  const studioIntro = el('p', { className: 'hint', textContent: t('ch_st_intro') })
  const bgSelect = el('select', { id: 'st-bgmode' }, ...['look', 'orca', 'light', 'dark', 'white', 'gradient', 'transparent'].map((m) => el('option', { value: m, textContent: t(`ch_bg_${m}`) })))
  const bgRow = el('label', { className: 'row', id: 'st-bgmode-row' }, el('span', { textContent: t('ch_bg_label') }), bgSelect)
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
  bar.insertBefore(group(viewWrap), spacer)
  bar.insertBefore(surfaceGroup, spacer)
  bar.insertBefore(group(measureBtn, studioWrap, exportBtn), spacer)
  const menu = $('more-menu')
  const keysBtn = mk('b-keys', t('ch_m_keys'), t('ch_m_keys_tip'))
  const moreItems = el('div', { className: 'more-fixed' })
  for (const b of [openBtn, folderBtn, closeBtn, keysBtn, reset]) if (b) b.removeAttribute('data-prio')
  if (folderBtn) folderBtn.onclick = () => $('b-pick-folder').click()
  moreItems.append(...[openBtn, folderBtn, closeBtn, el('hr', { className: 'menu-rule' }), keysBtn, reset].filter(Boolean))
  for (const b of moreItems.querySelectorAll('button')) b.classList.add('menu-item')
  menu.append(moreItems)
  $('b-panel').dataset.prio = '7' // the panel button moves into More when the bar is narrow
  $('more-wrap').hidden = false
  const moreBtn = $('b-more')
  moreBtn.setAttribute('aria-label', moreBtn.title || t('more'))
  moreBtn.textContent = '⋯ '
  moreBtn.append(el('span', { className: 'lbl', textContent: t('ch_more') })) // the word goes in a narrow bar, the dots stay
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
    { id: 'measure', label: t('ch_tab_measure') },
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
  // ----- Parts: a sentence, the way to choose several, the buttons, the list, explode and opacity -----
  const partSec = $('part-sec')
  const multiBtn = el('button', { type: 'button', id: 'b-multi', textContent: t('ch_p_multi_btn'), title: t('ch_p_multi_tip') })
  multiBtn.setAttribute('aria-pressed', 'false')
  multiBtn.dataset.keepOpen = '1'
  const onlyBtn = el('button', { type: 'button', id: 'l-only', textContent: t('ch_p_only'), title: t('ch_p_only_tip') })
  onlyBtn.disabled = true
  let multiOn = false
  multiBtn.onclick = () => {
    multiOn = !multiOn
    multiBtn.setAttribute('aria-pressed', String(multiOn))
    hooks.setMulti && hooks.setMulti(multiOn)
  }
  onlyBtn.onclick = () => hooks.isolate && hooks.isolate()
  const countLine = $('part-count')
  if (partSec) {
    const kids = {
      filter: $('filter'),
      list: $('parts'),
      explode: $('explode') && $('explode').closest('label'),
      opacity: $('part-opacity') && $('part-opacity').closest('label'),
      all: [$('l-all'), $('l-none'), $('l-inv')],
      oldHint: partSec.querySelector('p.hint')
    }
    if (kids.oldHint) kids.oldHint.remove()
    if (countLine) countLine.remove()
    const tint = $('l-color')
    if (tint) holder.append(tint) // the Color per part card of the Appearance menu is the switch now; the button stays, hidden
    const setRow = el('div', { className: 'row wrap', id: 'parts-buttons' }, ...kids.all, onlyBtn)
    const multiRow = el('div', { className: 'row wrap' }, multiBtn)
    const box = el('div', { id: 'part-sec', className: 'tabsec', hidden: partSec.hidden }, el('p', { className: 'hint', id: 'parts-hint', textContent: t('ch_p_hint') }), setRow, multiRow, ...[kids.filter, kids.list, kids.explode, kids.opacity].filter(Boolean))
    if (countLine) box.append(countLine)
    partSec.replaceWith(box) // a plain block: a details element without its summary would show a label of its own
    if (kids.explode) kids.explode.firstElementChild.textContent = t('ch_p_explode')
    if (kids.opacity) kids.opacity.firstElementChild.textContent = t('ch_p_opacity')
  }

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
    if (owner) tabs.select(owner.id)
  }

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

  return {
    popovers,
    tabs,
    measureBar,
    /** The Measure tab: built when the viewer has made its measuring tool (opts as buildMeasureTab, without t and panel). */
    bindMeasureTab(opts) {
      return buildMeasureTab({ t, panel: panels.measure, ...opts })
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
    /** The background list shows the mode; the Studio button says whether a look is on. */
    syncBackground(mode, studioOn) {
      bgSelect.value = mode
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
      presetRow.before(tiles)
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
      tiles.after(bgRow, floorRow, shadowRow, note)
      if (h4) note.after(h4, turn)
      else note.after(turn)
      turn.after(adv)
      const hint = [...sec.querySelectorAll('p.hint')].find((p) => p !== note)
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
      const gcode = extra.kind === 'gcode'
      const ids = []
      if (extra.hasModel) {
        if (c.partsTab.visible) ids.push('parts')
        if (c.clip.visible || c.layers.visible) ids.push('cut')
        if (extra.measurable !== false) ids.push('measure') // a point cloud or a toolpath has no surface to measure on
        ids.push('info') // Parts, Section, Measure, Info, Edit
        if (c.editTab.visible) ids.push('edit')
      }
      const key = `${ids.join()}|${gcode}`
      tabs.label('cut', t(gcode ? 'ch_tab_layers' : 'ch_tab_cut'))
      cutIntro.textContent = t(gcode ? 'ch_layers_intro' : 'ch_cut_intro')
      if (key !== updateKey) {
        updateKey = key
        tabs.setShown(ids, tabs.current() || tabPref.get(), ids.includes('parts') ? 'parts' : 'info', false) // not the person's choice: not remembered
      }
      tabList.hidden = ids.length === 0
      const un = $('st-unlit')
      if (un) un.hidden = !(extra.studioActive && c.studioLight.reason === 'studio_unlit')
      onlyBtn.disabled = !extra.hasModel || !c.fitSelected.enabled
      cards.rows.get('tint').hidden = !c.tint.visible
      syncLook()
      viewFit.disabled = !extra.hasModel || !c.fitSelected.enabled
      viewFit.title = c.fitSelected.reason ? t(c.fitSelected.reason) : ''
      const line = $('info-selected')
      line.hidden = !extra.selectedName
      if (extra.selectedName) line.textContent = t('ch_info_selected', { name: extra.selectedName })
    }
  }
}

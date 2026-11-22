// Shared by 3D Model Viewer and STEP Viewer 3D (canonical copy: plugins/_shared; do not edit the copies in editor/shared).
// The "Studio" section of the side panel, built here (the page only has to say where it goes): look presets, background, floor and
// shadow, three lights, reflections, exposure and tone mapping, quality, camera presets, turntable. The choice is kept in the page's prefs.
import { createStudio } from './studio.js'
import { normalizeStudio, PRESET_IDS, TONE_MAPPINGS } from './studio-core.js'

/**
 * ctx: { t, prefs() -> object (the page's remembered choices), savePrefs(), studioCtx: what createStudio needs, hasModel(),
 *        afterApply(): the page redraws its background after the studio changed it, insertBefore: element id the section goes before }
 */
export function initStudioUi(ctx) {
  const { t } = ctx
  const studio = createStudio(ctx.studioCtx)
  const $ = (id) => document.getElementById(id)
  const el = (tag, props = {}, ...kids) => {
    const e = Object.assign(document.createElement(tag), props)
    e.append(...kids)
    return e
  }
  // a list gets a line of its own (label above): a narrow side panel would cut label and choice; a slider sits beside its label
  const row = (label, control, id) => el('label', { className: control.tagName === 'SELECT' ? 'row stack' : 'row', id }, el('span', { className: control.tagName === 'SELECT' ? '' : 'grow', textContent: label }), control)
  const select = (id, options) => el('select', { id }, ...options.map(([v, text]) => el('option', { value: v, textContent: text })))
  const range = (id, min, max, step) => el('input', { id, type: 'range', min, max, step })
  const color = (id) => el('input', { id, type: 'color' })

  // ---------- markup ----------
  const sec = el('details', { className: 'sec', id: 'studio-sec' })
  sec.dataset.key = 'studio'
  sec.append(el('summary', {}, el('span', { textContent: t('st_title') })))
  sec.append(
    row(t('st_preset'), select('st-preset', [...PRESET_IDS.map((id) => [id, t('st_p_' + id)]), ['custom', t('st_p_custom')]])),
    row(t('st_bg'), select('st-bg', ['solid', 'gradient', 'transparent'].map((v) => [v, t('st_bg_' + v)]))),
    row(t('st_color'), color('st-color')),
    row(t('st_color2'), color('st-color2'), 'st-color2-row'),
    el('label', { className: 'row' }, el('input', { id: 'st-floor', type: 'checkbox' }), el('span', { className: 'grow', textContent: t('st_floor') })),
    row(t('st_shadow'), range('st-shadow', 0, 1, 0.05)),
    el('p', { id: 'st-note', className: 'hint', hidden: true })
  )
  const lights = el('details', { className: 'lights', id: 'st-lights' }, el('summary', { textContent: t('st_lights') }))
  for (const k of ['key', 'fill', 'rim']) {
    lights.append(
      el('h4', { className: 'sub', textContent: t('st_' + k) }),
      row(t('st_strength'), range(`st-${k}-i`, 0, 6, 0.05)),
      row(t('st_angle'), range(`st-${k}-a`, -180, 180, 1)),
      row(t('st_height'), range(`st-${k}-e`, 0, 90, 1))
    )
  }
  sec.append(
    lights,
    row(t('st_env'), range('st-env', 0, 3, 0.05)),
    row(t('st_exposure'), range('st-exposure', 0.2, 3, 0.05)),
    row(t('st_tone'), select('st-tone', TONE_MAPPINGS.map((v) => [v, t('st_tone_' + v)]))),
    row(t('st_quality'), select('st-quality', [['low', t('st_q_low')], ['high', t('st_q_high')]])),
    el('h4', { className: 'sub', textContent: t('st_turntable') }),
    row(t('st_speed'), range('st-speed', 5, 90, 1)),
    el('div', { className: 'btnrow' }, el('button', { type: 'button', id: 'st-spin', textContent: t('st_spin_start') }), el('button', { type: 'button', id: 'st-reset', textContent: t('st_reset') })),
    el('p', { className: 'hint', textContent: t('st_hint') })
  )
  const anchor = $(ctx.insertBefore)
  anchor.parentNode.insertBefore(sec, anchor)
  const open = (v) => {
    sec.open = v
  }

  // ---------- state <-> controls ----------
  const pref = () => ctx.prefs().studio
  let last = null // the state L switches on again: the last look that was on, custom edits included (null: the first preset)
  function save() {
    const s = studio.state
    const p = ctx.prefs()
    if (s.preset === 'original' && JSON.stringify(s) === JSON.stringify(normalizeStudio(undefined))) delete p.studio
    else p.studio = s
    ctx.savePrefs()
  }
  function toControls() {
    const s = studio.state
    $('st-preset').value = s.preset
    for (const sel of sec.querySelectorAll('select')) sel.title = sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].text : '' // the full text, also when the panel is narrow
    $('st-bg').value = s.bg.type
    $('st-color').value = s.bg.color
    $('st-color2').value = s.bg.color2
    $('st-color2-row').hidden = s.bg.type !== 'gradient'
    $('st-color').closest('label').hidden = s.bg.type === 'transparent'
    $('st-floor').checked = s.floor
    $('st-shadow').value = s.shadow
    for (const k of ['key', 'fill', 'rim']) {
      $(`st-${k}-i`).value = s[k].intensity
      $(`st-${k}-a`).value = s[k].azimuth
      $(`st-${k}-e`).value = s[k].elevation
    }
    $('st-env').value = s.env
    $('st-exposure').value = s.exposure
    $('st-tone').value = s.tone
    $('st-quality').value = s.quality
    $('st-speed').value = s.spinSpeed
    const on = studio.isActive()
    for (const id of sec.querySelectorAll('input, select')) if (id.id !== 'st-preset' && id.id !== 'st-speed') id.disabled = !on && id.id !== ''
    $('st-preset').disabled = false
    $('st-speed').disabled = false
    $('st-spin').textContent = t(studio.spin.isRunning() ? 'st_spin_stop' : 'st_spin_start')
    $('st-spin').setAttribute('aria-pressed', String(studio.spin.isRunning()))
    $('st-note').setAttribute('role', 'status')
    $('st-spin').disabled = !ctx.hasModel()
    const note = studio.policy().note
    const nt = $('st-note')
    nt.hidden = !on || !note
    nt.textContent = note ? t('st_note_' + note) : ''
    document.documentElement.dataset.studio = on ? s.preset : 'off'
  }
  function changed(patch) {
    studio.set({ ...studio.state, preset: 'custom', ...patch })
    if (studio.isActive()) last = studio.state
    save()
    toControls()
    ctx.afterApply()
  }
  const bgOf = (patch) => ({ bg: { ...studio.state.bg, ...patch } })
  const lightOf = (k, patch) => ({ [k]: { ...studio.state[k], ...patch } })
  const on = (id, ev, fn) => ($(id)[`on${ev}`] = fn)
  on('st-preset', 'change', (e) => {
    if (e.target.value === 'custom') return changed({})
    studio.preset(e.target.value)
    if (studio.isActive()) last = studio.state
    save()
    toControls()
    ctx.afterApply()
  })
  on('st-bg', 'change', (e) => changed(bgOf({ type: e.target.value })))
  on('st-color', 'input', (e) => changed(bgOf({ color: e.target.value })))
  on('st-color2', 'input', (e) => changed(bgOf({ color2: e.target.value })))
  on('st-floor', 'change', (e) => changed({ floor: e.target.checked }))
  on('st-shadow', 'input', (e) => changed({ shadow: Number(e.target.value) }))
  for (const k of ['key', 'fill', 'rim']) {
    on(`st-${k}-i`, 'input', (e) => changed(lightOf(k, { intensity: Number(e.target.value) })))
    on(`st-${k}-a`, 'input', (e) => changed(lightOf(k, { azimuth: Number(e.target.value) })))
    on(`st-${k}-e`, 'input', (e) => changed(lightOf(k, { elevation: Number(e.target.value) })))
  }
  on('st-env', 'input', (e) => changed({ env: Number(e.target.value) }))
  on('st-exposure', 'input', (e) => changed({ exposure: Number(e.target.value) }))
  on('st-tone', 'change', (e) => changed({ tone: e.target.value }))
  on('st-quality', 'change', (e) => changed({ quality: e.target.value }))
  on('st-speed', 'input', (e) => {
    studio.set({ ...studio.state, spinSpeed: Number(e.target.value) })
    save()
  })
  on('st-spin', 'click', () => {
    if (studio.spin.isRunning()) studio.spin.stop()
    else {
      ctx.beforeSpin && ctx.beforeSpin()
      studio.spin.start(toControls)
    }
    toControls()
  })
  on('st-reset', 'click', () => {
    studio.spin.stop()
    studio.set(normalizeStudio(undefined))
    last = null
    save()
    toControls()
    ctx.afterApply()
  })

  // a stored choice comes back
  if (pref()) studio.set(pref())
  if (studio.isActive()) last = studio.state
  toControls()
  return {
    studio,
    refresh() {
      studio.refresh()
      toControls()
    },
    /** Key L: the look on (the last one used) or off. */
    toggle() {
      if (studio.isActive()) {
        last = studio.state
        studio.preset('original') // also ends a running turn (the studio does that when it goes off)
      } else if (last) studio.set(last)
      else studio.preset('product_white')
      save()
      open(studio.isActive())
      toControls()
      ctx.afterApply()
    },
    openSection: () => open(true),
    /** "Reset settings": the look goes back to the original. */
    reset() {
      studio.spin.stop()
      studio.set(normalizeStudio(undefined)) // everything, quality and speed too
      last = null
      toControls()
    },
    controls: toControls,
    isActive: () => studio.isActive()
  }
}

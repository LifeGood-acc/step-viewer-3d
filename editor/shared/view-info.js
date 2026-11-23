// Shared by 3D Model Viewer and STEP Viewer 3D (canonical copy: plugins/_shared; do not edit the copies in editor/shared).
// The numbers of the view (UX v3, E4) and where they stand: the orientation cube and the scale bar in the corners of the view, the status bar at the bottom (triangles, parts,
// grid step, unit, zoom). THE STATUS BAR AND THE SCALE ARE THE ONLY PLACES OF THESE NUMBERS. Each one is worked out here from what the viewer hands over (scale-core.js) and carries
// its origin (data-src, cards.js): triangles, parts and the grid step come from the mesh, the scale and the zoom from the camera; where the file does not name its unit the
// numbers that carry a unit are marked "assumed" and say so. The viewer calls `setModel` when a model comes or goes and `frame` after every drawn frame.
import { el } from './chrome-ui.js'
import { createViewCube } from './viewcube-ui.js'
import { basisFromMatrix } from './viewcube-core.js'
import { pixelsPerUnit, niceLength, zoomPercent, lengthText } from './scale-core.js'

/** A text with {tokens} turned into nodes: the tokens become <span data-src> with the given text, the rest stays text. `values` = { n: { text, src } }. */
export function fill(template, values) {
  const out = []
  for (const part of String(template).split(/(\{\w+\})/)) {
    const m = /^\{(\w+)\}$/.exec(part)
    if (m && values[m[1]]) {
      const s = el('span', { textContent: values[m[1]].text })
      s.dataset.src = values[m[1]].src
      out.push(s)
    } else if (part) out.push(part)
  }
  return out
}

/** opts: { t, locale, stage, statusSlot, zoomButton, onPick(target), onFitAll() }. Returns { cube, scaleBar, setModel(info | null), frame(v), redraw() }. */
export function createViewInfo({ t, locale, stage, statusSlot, zoomButton, onPick, onFitAll }) {
  const int = (n) => n.toLocaleString(locale || undefined)
  const tpl = (key) => t(key, { n: '{n}' }) // the text with its {n} kept (the translator would fill a missing value with nothing): fill() puts the number in with its origin
  const cube = createViewCube({ t, onPick })
  stage.append(cube.el)

  // the scale bar: a ruler in the corner; it is true in the middle of the view only (a perspective picture), which the tooltip says
  const line = el('div', { className: 'sb-line' })
  const label = el('div', { className: 'sb-label' })
  const scaleBar = el('div', { id: 'scalebar', className: 'scalebar', hidden: true }, line, label)
  scaleBar.dataset.honest = '1'
  scaleBar.title = t('ch_s_scale_tip')
  stage.append(scaleBar)

  zoomButton.addEventListener('click', () => onFitAll())

  // what else stands in the corners of the view: the chip of the selected part (bottom left, as wide as the view in a narrow one), the playback bar of an animation (bottom right) and the
  // measuring bar (top, as wide as the view when it wraps). Where they would meet the scale bar or the cube, those move out of the way: the scale bar above, the cube below.
  const hits = (a, z) => !(a.right <= z.left || z.right <= a.left || a.bottom <= z.top || z.bottom <= a.top)
  const live = (sel) => [...stage.querySelectorAll(sel)].filter((e) => !e.hidden && e.getClientRects().length > 0)
  function place() {
    scaleBar.style.bottom = ''
    cube.el.style.top = ''
    const st = stage.getBoundingClientRect()
    if (!scaleBar.hidden) {
      for (const o of live('.sel-chip, .playbar')) {
        const c = o.getBoundingClientRect()
        const b = scaleBar.getBoundingClientRect()
        if (hits(c, b) || (c.right > b.left - 4 && c.top < b.bottom && c.bottom > b.top)) scaleBar.style.bottom = `${st.bottom - c.top + 6}px`
      }
    }
    if (!cube.el.hidden) {
      for (const m of live('#measure-bar')) {
        const c = cube.el.getBoundingClientRect()
        const r = m.getBoundingClientRect()
        if (hits(c, r)) cube.el.style.top = `${r.bottom - st.top + 8}px`
      }
    }
  }
  const watch = new MutationObserver(place)
  const watched = new Set()
  const findObstacles = () => {
    for (const e of stage.querySelectorAll('.sel-chip, .playbar, #measure-bar')) {
      if (watched.has(e)) continue
      watched.add(e)
      watch.observe(e, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['hidden', 'class'] })
    }
  }
  new MutationObserver(() => { findObstacles(); place() }).observe(stage, { childList: true }) // they are added to the view after this module
  findObstacles()
  new ResizeObserver(place).observe(stage)

  let model = null // { tris, points, parts, unit, unitSrc }
  let last = { statusKey: '', viewKey: '' }
  const note = () => `(${t('ch_f_assumed')})`

  function paintStatus(v) {
    const unitSrc = model.unitSrc === 'assumed' ? 'assumed' : 'derived' // a number with a unit the file does not name is an assumption
    const items = []
    const add = (cls, ...kids) => items.push(el('span', { className: `st-item ${cls}` }, ...kids))
    if (model.tris > 0) add('st-tris', ...fill(tpl(model.tris === 1 ? 'ch_s_tris_one' : 'ch_s_tris'), { n: { text: int(model.tris), src: 'derived' } }))
    else if (model.points > 0) add('st-tris', ...fill(tpl(model.points === 1 ? 'ch_s_points_one' : 'ch_s_points'), { n: { text: int(model.points), src: 'derived' } }))
    if (model.parts > 1) add('st-parts st-extra', ...fill(tpl('ch_s_parts'), { n: { text: int(model.parts), src: model.partsSrc === 'derived' ? 'derived' : 'file' } })) // one part is no news; a count the file does not give (a toolpath's own two parts) is not shown as the file's
    if (v.grid && v.grid.on) add('st-grid st-extra', ...fill(tpl('ch_s_grid'), { n: { text: `${lengthText(v.grid.step, locale)} ${model.unit}`, src: unitSrc } }))
    else add('st-grid st-extra', t('ch_s_grid_off'))
    if (model.unitSrc === 'assumed') add('st-unit st-extra', t('ch_s_unit_assumed'))
    // a separator is the first thing INSIDE an item, so that it moves (or is cut) with it when the bar is too narrow
    items.forEach((it, i) => i && it.prepend(el('span', { className: 'st-sep', textContent: '· ', ariaHidden: 'true' })))
    const kids = items
    statusSlot.replaceChildren(...kids)
  }

  return {
    cube,
    scaleBar,
    /** info: { tris, points, parts, partsSrc ('file' | 'derived'), unit ('mm'), unitSrc ('file' | 'assumed') } or null (no model: nothing is shown). */
    setModel(info) {
      model = info
      last = { statusKey: '', viewKey: '' }
      const none = !info
      cube.setHidden(none)
      scaleBar.hidden = none
      zoomButton.hidden = none
      if (none) statusSlot.replaceChildren()
    },
    /** After a drawn frame. v: { matrix (the camera's world matrix elements), distance (camera to target), fov (deg), viewH (px), fit (distance of "show all"), grid: { on, step } }. */
    frame(v) {
      if (!model) return
      cube.draw(basisFromMatrix(v.matrix))
      const ppu = pixelsPerUnit({ fovDeg: v.fov, viewH: v.viewH, distance: v.distance })
      const nice = ppu && niceLength(ppu)
      const zoom = zoomPercent(v.fit, v.distance)
      const unitSrc = model.unitSrc === 'assumed' ? 'assumed' : 'derived'
      // two things change at two speeds: the status bar with the model and the grid (rarely), the scale and the zoom with the camera (nearly every frame while zooming)
      const statusKey = [v.grid && v.grid.on, v.grid && v.grid.step, model.tris, model.points, model.parts, model.partsSrc, model.unit, model.unitSrc].join('|')
      if (statusKey !== last.statusKey) {
        last.statusKey = statusKey
        paintStatus(v)
      }
      const viewKey = `${nice ? nice.length : ''}|${nice ? Math.round(nice.px) : ''}|${zoom}`
      if (viewKey === last.viewKey) return
      last.viewKey = viewKey
      scaleBar.hidden = !nice
      if (nice) {
        line.style.width = `${Math.round(nice.px)}px`
        const num = el('span', { textContent: `${lengthText(nice.length, locale)} ${model.unit}` })
        num.dataset.src = unitSrc
        label.replaceChildren(num)
        if (unitSrc === 'assumed') label.append(` ${note()}`) // an assumed unit says so in the same block (honesty rule R8)
        place()
      }
      zoomButton.hidden = zoom === null // no number to show: no button with "null"
      if (zoom !== null) zoomButton.replaceChildren(...fill(tpl('ch_s_zoom'), { n: { text: zoom < 1 ? '< 1 %' : `${zoom} %`, src: 'derived' } }))
    },
    redraw: () => cube.redraw()
  }
}

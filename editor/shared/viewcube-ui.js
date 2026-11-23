// Shared by 3D Model Viewer and STEP Viewer 3D (canonical copy: plugins/_shared; do not edit the copies in editor/shared).
// The orientation cube on the page (UX v3, E4): a small canvas of its own in the corner of the view, with the geometry of viewcube-core.js. A click on a face, an edge or a corner asks the viewer for
// that view (`onPick(target)`); it never reaches the main canvas, so it selects nothing and sets no measuring point. For the keyboard (and screen readers) the cube is a group of six
// buttons, one tab stop with the arrow keys; the focused face is outlined on the canvas and named under the cube (a face turned away is not drawn). The cube draws words only (no numbers).
import { el } from './chrome-ui.js'
import { FACES, FACE_NAMES, projectAll, hitTarget, basisChanged } from './viewcube-core.js'

export const CUBE_SIZE = 96

/** opts: { t, onPick({ kind: 'face' | 'edge' | 'corner', name, dir }) }. Returns { el, draw(basis), redraw(), setHidden(hidden), faces() / targets() (what is drawn now, for the tests) }. */
export function createViewCube({ t, onPick }) {
  const canvas = el('canvas', { className: 'cube-canvas' })
  const root = el('div', { id: 'viewcube', className: 'viewcube', role: 'group', hidden: true }, canvas)
  root.setAttribute('aria-label', t('ch_cube_label'))
  const buttons = new Map()
  for (const name of FACE_NAMES) {
    const b = el('button', { type: 'button', className: 'cube-btn', textContent: t(`ch_v_${name}`) })
    b.dataset.face = name
    b.title = `${t('ch_v_from')} ${t(`ch_v_${name}`)}`
    b.tabIndex = name === FACE_NAMES[0] ? 0 : -1
    b.onclick = () => onPick({ kind: 'face', name, dir: FACES.find((f) => f.name === name).n })
    buttons.set(name, b)
    root.append(b)
  }
  let basis = null
  let shown = { faces: [], edges: [], corners: [] }
  let hover = null
  let focused = null
  let colors = null // read from the theme when it is needed (a new theme: redraw), not at every frame
  const focusLabel = el('div', { className: 'cube-focus', hidden: true })
  focusLabel.setAttribute('aria-hidden', 'true')
  root.append(focusLabel)
  let paints = 0 // how often the cube was really drawn (the measurement of its cost checks that it was)
  const dpr = () => window.devicePixelRatio || 1
  const px = () => {
    const w = Math.round(CUBE_SIZE * dpr())
    if (canvas.width !== w) {
      canvas.width = w
      canvas.height = w
    }
  }
  const css = (cs, name, fallback) => cs.getPropertyValue(name).trim() || fallback

  function paint() {
    if (!basis || root.hidden) return
    px()
    const g = canvas.getContext('2d')
    g.setTransform(dpr(), 0, 0, dpr(), 0, 0)
    g.clearRect(0, 0, CUBE_SIZE, CUBE_SIZE)
    if (!colors) {
      const cs = getComputedStyle(root)
      colors = { fg: css(cs, '--fg', '#111'), card: css(cs, '--card', '#f6f6f6'), line: css(cs, '--border', '#ccc'), on: css(cs, '--on', '#2563eb') }
    }
    const { fg, card, line, on } = colors
    paints++
    shown = projectAll(basis, CUBE_SIZE)
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    const isFace = (n) => hover && hover.kind === 'face' && hover.name === n
    for (const f of shown.faces) {
      g.beginPath()
      f.pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])))
      g.closePath()
      const lit = isFace(f.name)
      g.fillStyle = lit ? on : card
      g.fill()
      g.strokeStyle = focused === f.name ? on : line
      g.lineWidth = focused === f.name ? 2.4 : 1.2
      g.stroke()
      if (f.facing > 0.3) {
        g.font = `600 ${Math.round(CUBE_SIZE * 0.1 * Math.min(1, 0.6 + f.facing * 0.5))}px system-ui, sans-serif`
        g.fillStyle = lit ? '#fff' : fg
        g.fillText(t(`ch_v_${f.name}`), f.center[0], f.center[1])
      }
    }
    // the corners are small dots (they can be clicked), a hovered edge is a thick line, a hovered corner a big dot
    g.fillStyle = line
    for (const c of shown.corners) {
      g.beginPath()
      g.arc(c.p[0], c.p[1], 1.8, 0, 7)
      g.fill()
    }
    if (hover && hover.kind === 'edge') {
      const e = shown.edges.find((x) => x.name === hover.name)
      if (e) {
        g.strokeStyle = on
        g.lineWidth = 3.2
        g.lineCap = 'round'
        g.beginPath()
        g.moveTo(e.a[0], e.a[1])
        g.lineTo(e.b[0], e.b[1])
        g.stroke()
      }
    }
    if (hover && hover.kind === 'corner') {
      const c = shown.corners.find((x) => x.name === hover.name)
      if (c) {
        g.fillStyle = on
        g.beginPath()
        g.arc(c.p[0], c.p[1], 4.5, 0, 7)
        g.fill()
      }
    }
  }

  const at = (e) => {
    const r = canvas.getBoundingClientRect()
    return hitTarget(shown, ((e.clientX - r.left) / r.width) * CUBE_SIZE, ((e.clientY - r.top) / r.height) * CUBE_SIZE)
  }
  // nothing that happens on the cube is the main canvas' business: no selection, no measuring point, no orbit
  for (const type of ['pointerdown', 'pointerup', 'click', 'dblclick', 'wheel', 'contextmenu']) root.addEventListener(type, (e) => e.stopPropagation())
  canvas.addEventListener('click', (e) => {
    const f = at(e)
    if (f) onPick(f)
  })
  canvas.addEventListener('pointermove', (e) => {
    const f = at(e)
    if ((f && f.name) !== (hover && hover.name) || (f && f.kind) !== (hover && hover.kind)) {
      hover = f
      canvas.style.cursor = f ? 'pointer' : ''
      paint()
    }
  })
  canvas.addEventListener('pointerleave', () => {
    hover = null
    canvas.style.cursor = ''
    paint()
  })
  root.addEventListener('focusin', (e) => {
    const b = e.target.closest && e.target.closest('.cube-btn')
    if (!b) return
    focused = b.dataset.face
    focusLabel.textContent = b.textContent // a face turned away is not drawn: the focus is also named under the cube
    focusLabel.hidden = false
    for (const x of buttons.values()) x.tabIndex = x === b ? 0 : -1
    paint()
  })
  root.addEventListener('focusout', () => {
    focused = null
    focusLabel.hidden = true
    paint()
  })
  root.addEventListener('keydown', (e) => {
    const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }
    const b = e.target.closest && e.target.closest('.cube-btn')
    if (!b || !(e.key in keys || e.key === 'Home' || e.key === 'End')) return
    e.preventDefault()
    const i = FACE_NAMES.indexOf(b.dataset.face)
    const j = e.key === 'Home' ? 0 : e.key === 'End' ? FACE_NAMES.length - 1 : (i + keys[e.key] + FACE_NAMES.length) % FACE_NAMES.length
    buttons.get(FACE_NAMES[j]).focus()
  })

  // a window dragged to another screen changes the pixel ratio: the canvas is made sharp again
  const watchRatio = () => {
    const m = window.matchMedia(`(resolution: ${dpr()}dppx)`)
    m.addEventListener('change', () => { paint(); watchRatio() }, { once: true })
  }
  if (window.matchMedia) watchRatio()

  return {
    el: root,
    /** The camera turned: draw again (only if its orientation really differs). */
    draw(next) {
      const sharp = canvas.width === Math.round(CUBE_SIZE * dpr()) // the pixel ratio changed (another screen): paint again even if the camera did not turn
      if (!basisChanged(basis, next) && sharp) return
      basis = next
      hover = null // the camera turned under the pointer: the next move says which face it is over now
      paint()
    },
    /** The theme or the size changed. */
    redraw() {
      colors = null // the theme may have changed
      paint()
    },
    setHidden(hidden) {
      root.hidden = !!hidden
      if (!hidden) paint()
    },
    /** What is drawn now: [{ name, pts, facing }] (the tests click on these points). */
    faces: () => shown.faces,
    /** What a click at (x, y) of the canvas (in its 96 px) would pick: { kind, name, dir } or null (for the tests). */
    targetAt: (x, y) => hitTarget(shown, x, y),
    /** Everything that can be pointed at now, with its position on the canvas (for the tests): faces at their centre, edges at their middle, corners at their point. */
    targets: () => [...shown.faces.map((f) => ({ kind: 'face', name: f.name, p: f.center })), ...shown.edges.map((e) => ({ kind: 'edge', name: e.name, p: [(e.a[0] + e.b[0]) / 2, (e.a[1] + e.b[1]) / 2] })), ...shown.corners.map((c) => ({ kind: 'corner', name: c.name, p: c.p }))],
    paintCount: () => paints
  }
}

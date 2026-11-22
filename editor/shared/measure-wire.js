// Shared by 3D Model Viewer and STEP Viewer 3D (canonical copy: plugins/_shared; do not edit the copies in editor/shared).
// What the page does with the pointer and the keyboard for Measure+: dragging a marker of a measurement to a new place on the surface, and
// Enter to finish a chain. The tool itself is measure-three.js; the viewer says how a screen position becomes a hit on the model.

/**
 * opts: { canvas, camera, controls, measure, pickAt(clientX, clientY) -> hit | null ({ point } in world space), canEdit() -> boolean, isMeasuring() -> boolean }
 * A press on a marker (within 12 px) is a drag of that point once the pointer has moved a few pixels; without moving it is an ordinary click, so
 * a new point can still be set next to or on an old marker (measuring) or the measurement is selected (not measuring). Everywhere else orbiting and
 * clicking the model work as before.
 */
export function installMeasureInteraction({ canvas, camera, controls, measure, pickAt, canEdit, isMeasuring }) {
  let pointer = null
  let press = null // { id, index, x, y, t, pointerId }: a press on a marker that has not moved yet
  let dragging = false
  let frame = 0
  let last = null
  const place = () => {
    frame = 0
    if (!last || !dragging) return
    const hit = pickAt(last.x, last.y)
    if (hit) measure.dragMove(hit.point)
  }
  canvas.addEventListener(
    'pointerdown',
    (e) => {
      if (e.button !== 0 || !canEdit() || !measure.store.count()) return
      const r = canvas.getBoundingClientRect()
      const m = measure.pickMarker(camera, e.clientX - r.left, e.clientY - r.top)
      if (!m) return
      e.stopImmediatePropagation() // not an orbit, not a click on the model: decided when the pointer moves or is let go
      e.preventDefault()
      press = { id: m.id, index: m.index, x: e.clientX, y: e.clientY, t: performance.now() }
      pointer = e.pointerId
      last = { x: e.clientX, y: e.clientY }
      try {
        canvas.setPointerCapture(e.pointerId)
      } catch {
        // a synthetic pointer has nothing to capture
      }
    },
    true
  )
  canvas.addEventListener('pointermove', (e) => {
    if (pointer === null || e.pointerId !== pointer || !press) return
    last = { x: e.clientX, y: e.clientY }
    if (!dragging) {
      if (Math.hypot(e.clientX - press.x, e.clientY - press.y) <= 4) return
      dragging = true
      measure.dragStart(press.id, press.index)
      controls.enabled = false
    }
    if (!frame) frame = requestAnimationFrame(place)
  })
  const end = (e) => {
    if (pointer === null || e.pointerId !== pointer) return
    cancelAnimationFrame(frame)
    frame = 0
    const p = press
    pointer = null
    press = null
    if (dragging) {
      if (last) place()
      dragging = false
      controls.enabled = true
      measure.dragEnd()
    } else if (p && e.type === 'pointerup' && performance.now() - p.t < 500) {
      if (isMeasuring()) {
        const hit = pickAt(e.clientX, e.clientY)
        if (hit) measure.add(hit)
      } else measure.store.select(p.id)
    }
    last = null
  }
  canvas.addEventListener('pointerup', end)
  canvas.addEventListener('pointercancel', end)
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.repeat || e.defaultPrevented) return
    const tag = e.target && e.target.tagName
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'BUTTON') return
    if (!isMeasuring()) return
    const d = measure.draft()
    if (!d || d.kind !== 'chain' || d.count < 2) return
    e.preventDefault()
    measure.finishChain(false)
  })
}

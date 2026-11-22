// Pure decisions both viewers share (no DOM, no three): drag depth bookkeeping and the choice of what to do with a dropped list.

/** Drag depth reducer. `ev.type`: 'enter' | 'leave' | 'drop' | 'end'. For 'leave', `ev.leftWindow` is true when the pointer left the window
 *  (then the drag is over at once, whatever the depth says). Returns the new depth and what the caller shows:
 *  `started` (first enter: show the overlay), `ended` (depth is back at 0 after a leave/end: take it down). */
export function dragReducer(depth, ev) {
  switch (ev.type) {
    case 'enter': {
      const d = depth + 1
      return { depth: d, started: d === 1, ended: false }
    }
    case 'leave': {
      const d = ev.leftWindow ? 0 : Math.max(0, depth - 1)
      return { depth: d, started: false, ended: d === 0 }
    }
    case 'end':
      return { depth: 0, started: false, ended: true }
    case 'drop':
      return { depth: 0, started: false, ended: false }
    default:
      return { depth, started: false, ended: false }
  }
}

/** What to do with a picked file. `picked` is `{ file, ignored, unsupported }` (from pickFile), `limits` is `{ hardMax, gate }` in bytes
 *  (`gate` may be Infinity), `approved` is a boolean or a function of the file: did the person already say yes.
 *  Returns `{ action: 'nothing' | 'unsupported' | 'toobig' | 'gate' | 'load', file?, ignored?, ext? }`. */
export function planOpen(picked, limits, approved, extOf) {
  const { file, ignored, unsupported } = picked
  if (!file) {
    if (!unsupported.length) return { action: 'nothing' }
    return { action: 'unsupported', ext: extOf(unsupported[0]) }
  }
  if (file.size > limits.hardMax) return { action: 'toobig', file }
  if (file.size > (limits.gate ?? Infinity) && !(typeof approved === 'function' ? approved(file) : approved)) return { action: 'gate', file, ignored }
  return { action: 'load', file, ignored }
}

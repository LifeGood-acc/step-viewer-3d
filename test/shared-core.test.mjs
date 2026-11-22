import test from 'node:test'
import assert from 'node:assert/strict'
import { dragReducer, planOpen } from '../editor/shared/core.js'

const run = (events) => events.reduce((s, ev) => ({ ...dragReducer(s.depth, ev), log: [...s.log, ev.type] }), { depth: 0, log: [] })
const ext = (n) => (/\.([a-z0-9]+)$/i.exec(n) || [])[1] || ''

test('drag depth: nested enters count up, the overlay appears once, and the last leave ends it', () => {
  assert.equal(dragReducer(0, { type: 'enter' }).started, true)
  assert.equal(dragReducer(1, { type: 'enter' }).started, false)
  assert.equal(run([{ type: 'enter' }, { type: 'enter' }, { type: 'leave' }]).depth, 1)
  assert.equal(dragReducer(1, { type: 'leave' }).ended, true)
  assert.equal(dragReducer(2, { type: 'leave' }).ended, false)
})
test('drag depth: never negative, leaving the window or dropping or ending resets', () => {
  assert.equal(dragReducer(0, { type: 'leave' }).depth, 0)
  assert.equal(dragReducer(3, { type: 'leave', leftWindow: true }).ended, true)
  assert.equal(dragReducer(3, { type: 'leave', leftWindow: true }).depth, 0)
  assert.equal(dragReducer(3, { type: 'drop' }).depth, 0)
  assert.equal(dragReducer(3, { type: 'end' }).ended, true)
  assert.equal(dragReducer(2, { type: 'bogus' }).depth, 2)
})
test('planOpen: nothing, unsupported, too big, gate, approved gate, plain load', () => {
  const L = { hardMax: 1000, gate: 100 }
  const f = (name, size) => ({ name, size })
  assert.equal(planOpen({ file: null, ignored: 0, unsupported: [] }, L, false, ext).action, 'nothing')
  assert.deepEqual(planOpen({ file: null, ignored: 1, unsupported: ['a.docx'] }, L, false, ext), { action: 'unsupported', ext: 'docx' })
  assert.equal(planOpen({ file: f('a.glb', 1001), ignored: 0, unsupported: [] }, L, true, ext).action, 'toobig')
  assert.equal(planOpen({ file: f('a.glb', 1000), ignored: 0, unsupported: [] }, L, false, ext).action, 'gate')
  assert.equal(planOpen({ file: f('a.glb', 1000), ignored: 0, unsupported: [] }, L, true, ext).action, 'load')
  const big = f('b.glb', 500)
  assert.equal(planOpen({ file: big, ignored: 0, unsupported: [] }, L, (x) => x === big, ext).action, 'load')
  assert.equal(planOpen({ file: big, ignored: 0, unsupported: [] }, L, (x) => x !== big, ext).action, 'gate')
  assert.equal(planOpen({ file: f('a.glb', 100), ignored: 2, unsupported: [] }, L, false, ext).ignored, 2)
  assert.equal(planOpen({ file: f('a.step', 5e8), ignored: 0, unsupported: [] }, { hardMax: 1e9 }, false, ext).action, 'load') // no gate set
})

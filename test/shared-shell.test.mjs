import test from 'node:test'
import assert from 'node:assert/strict'
import { installErrorGuard, layoutFor, cardFor, CARD_AT, NARROW_AT, SIDE_MIN, THREE_AT, COL_L_W, sideMax } from '../editor/shared/shell.js'

const fakeWindow = () => {
  const l = {}
  return { addEventListener: (k, f) => (l[k] = f), removeEventListener: (k) => delete l[k], fire: (k, e) => l[k] && l[k](e), has: (k) => !!l[k] }
}

test('an error and an unhandled rejection each write one state line and reach the page; the guard can be taken down', () => {
  const w = fakeWindow()
  const lines = []
  const shown = []
  const off = installErrorGuard(w, { plugin: 'demo', report: (x) => lines.push(x), onFatal: (m) => shown.push(m) })
  w.fire('error', { error: new Error('boom') })
  w.fire('unhandledrejection', { reason: new TypeError('lost promise') })
  assert.equal(lines.length, 2)
  assert.deepEqual(JSON.parse(lines[0].replace('demo-state ', '')), { state: 'error', kind: 'error', why: 'boom' })
  assert.equal(JSON.parse(lines[1].replace('demo-state ', '')).kind, 'rejection')
  assert.deepEqual(shown, ['boom', 'lost promise'])
  off()
  assert.ok(!w.has('error') && !w.has('unhandledrejection'))
})

test('the same message in quick succession is reported once, and a failing onFatal does not throw out of the guard', () => {
  const w = fakeWindow()
  const lines = []
  installErrorGuard(w, { plugin: 'demo', report: (x) => lines.push(x), onFatal: () => { throw new Error('page broke') } })
  for (let i = 0; i < 5; i++) assert.doesNotThrow(() => w.fire('error', { message: 'same' }))
  assert.equal(lines.length, 1)
  w.fire('error', { message: 'other' })
  assert.equal(lines.length, 2)
  assert.doesNotThrow(() => w.fire('unhandledrejection', { reason: undefined }))
  const before = lines.length
  w.fire('error', { message: 'ResizeObserver loop completed with undelivered notifications.' })
  w.fire('unhandledrejection', { reason: undefined })
  assert.equal(lines.length, before, 'a ResizeObserver notice and a rejection without a reason are not reported')
})

test('the side panel is never narrower than five tabs in whole words need, and never more than half of a narrow view', () => {
  assert.equal(SIDE_MIN, 260)
  assert.equal(sideMax(600), 300, 'a 600 px view: half')
  assert.equal(sideMax(420), 260, 'a very narrow view: the minimum wins over half')
  assert.equal(sideMax(699), 349.5, 'just under 700: half')
  assert.equal(sideMax(1000), 700, 'a wide view: seven tenths')
  assert.equal(sideMax(100), SIDE_MIN, 'never below the minimum')
})

test('three columns from 1200 px: the constants are the ones the plan and the tests rely on, and the view keeps room', () => {
  assert.equal(THREE_AT, 1200)
  assert.ok(THREE_AT > 1180 && THREE_AT > NARROW_AT, 'the e2e tests of 1100 and 1180 px stay in the one-column layout')
  assert.equal(COL_L_W, 252)
  assert.ok(THREE_AT - COL_L_W - 292 >= 360, 'at the narrowest three-column window the view is at least 360 px')
})

test('the layout for a width: the limits 519/520 and 1199/1200 and nothing in between changes', () => {
  assert.equal(layoutFor(0), 'wide', 'a view that is not laid out yet is not narrow')
  for (const [w, mode] of [[300, 'narrow'], [519, 'narrow'], [520, 'wide'], [700, 'wide'], [1100, 'wide'], [1199, 'wide'], [1200, 'three'], [1201, 'three'], [1400, 'three'], [3000, 'three']]) assert.equal(layoutFor(w), mode, `${w} px`)
})
test('the view is a card from CARD_AT = 700 px of the area, a pair of limits on both sides; the side panel may be seven tenths from there, half below', () => {
  assert.equal(CARD_AT, 700)
  for (const [w, card] of [[0, false], [519, false], [520, false], [699, false], [700, true], [701, true], [1199, true], [1200, true], [1400, true]]) assert.equal(cardFor(w), card, `${w} px`)
  assert.equal(sideMax(699), Math.max(SIDE_MIN, 699 * 0.5))
  assert.equal(sideMax(700), 700 * 0.7)
})

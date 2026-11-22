import test from 'node:test'
import assert from 'node:assert/strict'
import { installErrorGuard } from '../editor/shared/shell.js'

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

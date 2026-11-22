import test from 'node:test'
import assert from 'node:assert/strict'
import { keyAction, KEYMAP, VIEW_NAMES, NO_REPEAT } from '../editor/shared/keymap.js'

const press = (key, extra = {}, target = { tagName: 'CANVAS' }) => keyAction({ key, target, ...extra })

test('every shortcut means what the tooltips say', () => {
  const want = { r: 'view_all', f: 'fit_selected', i: 'isolate', m: 'measure', l: 'studio', e: 'export', w: 'mesh', t: 'texture', g: 'grid', b: 'background', p: 'panel', Escape: 'escape', '+': 'zoom_in', '=': 'zoom_in', '-': 'zoom_out' }
  for (const [k, a] of Object.entries(want)) assert.equal(press(k).action, a, k)
  VIEW_NAMES.forEach((name, i) => assert.equal(press(String(i + 1)).action, `view_${name}`, `digit ${i + 1}`))
  assert.equal(press('9'), null)
  assert.equal(press('x'), null)
})
test('upper case works as lower case, and shift is passed on (isolate all vs. selected)', () => {
  assert.deepEqual(press('I', { shiftKey: true }), { action: 'isolate', shift: true })
  assert.deepEqual(press('i'), { action: 'isolate', shift: false })
  assert.equal(press('W').action, 'mesh')
})
test('typing is never a shortcut: modifiers, selects, text fields and text areas', () => {
  assert.equal(press('w', { metaKey: true }), null)
  assert.equal(press('w', { ctrlKey: true }), null)
  assert.equal(press('w', { altKey: true }), null)
  assert.equal(press('w', {}, { tagName: 'SELECT' }), null)
  assert.equal(press('w', {}, { tagName: 'TEXTAREA' }), null)
  assert.equal(press('w', {}, { tagName: 'INPUT', type: 'text' }), null)
  assert.equal(press('w', {}, { tagName: 'INPUT', type: 'search' }), null)
  assert.equal(press('w', {}, { tagName: 'DIV', isContentEditable: true }), null)
  assert.equal(press('w', {}, { tagName: 'INPUT', type: 'checkbox' }).action, 'mesh', 'a checkbox does not take text')
  assert.equal(press('r', {}, { tagName: 'INPUT', type: 'radio' }).action, 'view_all', 'a radio button (the look cards) does not take text either')
  assert.equal(press('w', {}, { tagName: 'INPUT', type: 'range' }).action, 'mesh', 'neither does a slider')
})
test('a key held down does not flip a switch back and forth, but zooming may repeat', () => {
  for (const a of NO_REPEAT) {
    const k = Object.keys(KEYMAP).find((key) => KEYMAP[key] === a)
    assert.equal(press(k, { repeat: true }), null, a)
    assert.ok(press(k), a)
  }
  assert.equal(press('+', { repeat: true }).action, 'zoom_in')
  assert.equal(press('r', { repeat: true }).action, 'view_all')
})
test('the table has no key twice and no action without a key', () => {
  const keys = Object.keys(KEYMAP)
  assert.equal(new Set(keys).size, keys.length)
  for (const a of NO_REPEAT) assert.ok(Object.values(KEYMAP).includes(a), a)
})

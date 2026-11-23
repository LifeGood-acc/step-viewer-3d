import { test } from 'node:test'
import assert from 'node:assert/strict'
import { popoverStep, tabsNext, chooseTab, fitShift } from '../editor/shared/popover.js'

test('exactly one popover is open: opening another replaces the first', () => {
  let s = { open: null }
  s = popoverStep(s, { type: 'toggle', id: 'a' })
  assert.equal(s.open, 'a')
  s = popoverStep(s, { type: 'toggle', id: 'b' })
  assert.equal(s.open, 'b')
  s = popoverStep(s, { type: 'toggle', id: 'b' })
  assert.deepEqual(s, { open: null, focusButton: 'b' }, 'the second click closes it and the focus is on its button')
})

test('Esc closes the open popover and gives the focus back; with none open it does nothing', () => {
  assert.deepEqual(popoverStep({ open: 'a' }, { type: 'escape' }), { open: null, focusButton: 'a' })
  assert.deepEqual(popoverStep({ open: null }, { type: 'escape' }), { open: null, focusButton: null })
})

test('a click outside closes it and leaves the focus alone; a click inside does not close it', () => {
  assert.deepEqual(popoverStep({ open: 'a' }, { type: 'outside', inside: false }), { open: null, focusButton: null })
  assert.deepEqual(popoverStep({ open: 'a' }, { type: 'outside', inside: true }), { open: 'a', focusButton: null })
})

test('choosing a button closes it, a select or slider keeps it open', () => {
  assert.deepEqual(popoverStep({ open: 'a' }, { type: 'choose', closes: true }), { open: null, focusButton: 'a' })
  assert.deepEqual(popoverStep({ open: 'a' }, { type: 'choose', closes: false }), { open: 'a', focusButton: null })
  assert.equal(popoverStep({ open: 'a' }, { type: 'close', id: 'b' }).open, 'a', 'closing another one changes nothing')
  assert.equal(popoverStep({ open: 'a' }, { type: 'close' }).open, null)
})

test('tabs: arrows wrap, Home and End jump, other keys stay', () => {
  const ids = ['parts', 'cut', 'info']
  assert.equal(tabsNext(ids, 'parts', 'ArrowRight'), 'cut')
  assert.equal(tabsNext(ids, 'info', 'ArrowRight'), 'parts')
  assert.equal(tabsNext(ids, 'parts', 'ArrowLeft'), 'info')
  assert.equal(tabsNext(ids, 'cut', 'Home'), 'parts')
  assert.equal(tabsNext(ids, 'cut', 'End'), 'info')
  assert.equal(tabsNext(ids, 'cut', 'a'), 'cut')
  assert.equal(tabsNext([], 'x', 'Home'), null)
})

test('the active tab: remembered if shown, else the preferred one, else the first', () => {
  const ids = ['parts', 'info']
  assert.equal(chooseTab(ids, 'info', 'parts'), 'info')
  assert.equal(chooseTab(ids, 'cut', 'parts'), 'parts')
  assert.equal(chooseTab(ids, null, null), 'parts')
  assert.equal(chooseTab(['info'], 'parts', 'parts'), 'info')
  assert.equal(chooseTab([], 'parts', 'parts'), null)
})

test('a panel is moved sideways to lie inside the window, 8 px from the edge', () => {
  assert.equal(fitShift({ left: 10, right: 350 }, 600), 0, 'inside: stays')
  assert.equal(fitShift({ left: 345, right: 685 }, 600), -93, 'sticks out at the right: moves left until 8 px are left')
  assert.equal(fitShift({ left: 280, right: 435 }, 420), -23, 'a narrow window')
  assert.equal(fitShift({ left: -20, right: 200 }, 600), 28, 'sticks out at the left: moves right')
  assert.equal(fitShift({ left: 40, right: 500 }, 400), -32, 'wider than the window: the left edge goes to the margin, the rest is cut by max-width')
  assert.equal(fitShift({ left: 8, right: 592 }, 600), 0, 'exactly at the margins')
  assert.equal(fitShift({ left: 0, right: 600 }, 600), 8, 'as wide as the window: the left edge goes to the margin')
})

// ----- createTabs with a pretend document: the three-column layout shows every tab as a card (setStacked) -----
import { createTabs } from '../editor/shared/popover.js'
const fakeEl = () => {
  const e = { children: [], attrs: {}, hidden: false, tabIndex: 0, id: '', className: '', textContent: '' }
  e.setAttribute = (k, v) => (e.attrs[k] = String(v))
  e.getAttribute = (k) => e.attrs[k] ?? null
  e.append = (...kids) => e.children.push(...kids)
  return e
}
test('stacked tabs: each existing tab shows as a card where the rule says so, and one panel at a time comes back with null', () => {
  globalThis.document = { createElement: fakeEl }
  const panels = { a: fakeEl(), b: fakeEl(), c: fakeEl() }
  const t = createTabs({ list: fakeEl(), tabs: ['a', 'b', 'c'].map((id) => ({ id, label: id, panel: panels[id] })), active: 'a', preferred: 'a' })
  assert.deepEqual(Object.values(panels).map((p) => p.hidden), [false, true, true], 'one panel at a time')
  t.setStacked((id) => id !== 'b')
  assert.deepEqual(Object.values(panels).map((p) => p.hidden), [false, true, false], 'stacked: every panel the rule allows')
  t.setShown(['a', 'b']) // c does not exist now
  assert.deepEqual(Object.values(panels).map((p) => p.hidden), [false, true, true], 'a tab that does not exist has no card')
  t.setShown(['a', 'b', 'c'])
  t.setStacked((id, current) => id === current || id === 'c')
  assert.deepEqual(Object.values(panels).map((p) => p.hidden), [false, true, false], 'the rule gets the current tab')
  t.setStacked(null)
  assert.deepEqual(Object.values(panels).map((p) => p.hidden), [false, true, true], 'back to one panel at a time')
  t.select('b')
  t.setStacked(() => true)
  assert.deepEqual(Object.values(panels).map((p) => p.hidden), [false, false, false])
  t.setStacked((id) => id === 'c')
  t.refresh()
  assert.deepEqual(Object.values(panels).map((p) => p.hidden), [true, true, false], 'refresh applies the rule again')
  delete globalThis.document
})

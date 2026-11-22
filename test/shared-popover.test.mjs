import { test } from 'node:test'
import assert from 'node:assert/strict'
import { popoverStep, tabsNext, chooseTab } from '../editor/shared/popover.js'

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

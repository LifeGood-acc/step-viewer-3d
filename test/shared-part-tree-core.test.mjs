import test from 'node:test'
import assert from 'node:assert/strict'
import { MAX_ROWS, rowsFromPaths, hasKids, matchRows, visibleRows, rowState, ancestors, parentOf, navTarget, rovingRow } from '../editor/shared/part-tree-core.js'

// Assembly (group) > Frame (group) > Leg A, Leg B ; Plate ; Bolt (outside every group)
const G = (id, name) => ({ id, name })
const items = [
  { label: 'Leg A', path: [G(1, 'Assembly'), G(2, 'Frame')] },
  { label: 'Leg B', path: [G(1, 'Assembly'), G(2, 'Frame')] },
  { label: 'Plate', path: [G(1, 'Assembly')] },
  { label: 'Bolt', path: [] }
]
const rows = rowsFromPaths(items)

test('the flat list of the Model Viewer becomes rows with a group row in front of its parts', () => {
  assert.deepEqual(rows.map((r) => [r.depth, r.name, r.group, r.meshes.join()]), [
    [0, 'Assembly', true, '0,1,2'],
    [1, 'Frame', true, '0,1'],
    [2, 'Leg A', false, '0'],
    [2, 'Leg B', false, '1'],
    [1, 'Plate', false, '2'],
    [0, 'Bolt', false, '3']
  ])
  assert.ok(MAX_ROWS >= 1000)
})

test('two groups with the same name are two groups (told apart by id)', () => {
  const r = rowsFromPaths([
    { label: 'a', path: [G(1, 'Same')] },
    { label: 'a2', path: [G(1, 'Same')] },
    { label: 'b', path: [G(2, 'Same')] },
    { label: 'b2', path: [G(2, 'Same')] }
  ])
  assert.deepEqual(r.map((x) => [x.depth, x.name, x.group]), [[0, 'Same', true], [1, 'a', false], [1, 'a2', false], [0, 'Same', true], [1, 'b', false], [1, 'b2', false]])
})

test('a group with only one part below it gets no row (a chain of wrappers around one mesh adds levels, not information)', () => {
  const r = rowsFromPaths([
    { label: 'Only', path: [G(1, 'root'), G(2, 'scene'), G(3, 'node')] },
    { label: 'A', path: [G(1, 'root'), G(4, 'pair')] },
    { label: 'B', path: [G(1, 'root'), G(4, 'pair')] }
  ])
  assert.deepEqual(r.map((x) => [x.depth, x.name, x.group, x.meshes.join()]), [
    [0, 'root', true, '0,1,2'],
    [1, 'node', false, '0'], // the wrapper "node" names its one part (the STEP viewer does the same with a node that holds one mesh)
    [1, 'pair', true, '1,2'],
    [2, 'A', false, '1'],
    [2, 'B', false, '2']
  ])
})

test('a part with a name of its own keeps it, the wrapper only names an unnamed part', () => {
  const r = rowsFromPaths([{ label: 'Body', named: true, path: [G(1, 'Scene')] }, { label: 'Mesh 2', named: false, path: [G(2, 'Handle')] }])
  assert.deepEqual(r.map((x) => x.name), ['Body', 'Handle'])
})

test('a wrapper with a blank name does not rename the part', () => {
  const r = rowsFromPaths([{ label: 'Part', path: [G(1, '  ')] }, { label: 'Other', path: [] }])
  assert.deepEqual(r.map((x) => x.name), ['Part', 'Other'])
})

test('no groups: one row per part; no parts: no rows', () => {
  assert.deepEqual(rowsFromPaths([{ label: 'x', path: [] }, { label: 'y' }]).map((r) => [r.depth, r.name, r.group]), [[0, 'x', false], [0, 'y', false]])
  assert.deepEqual(rowsFromPaths([]), [])
})

test('only a group with rows below it can be folded', () => {
  assert.deepEqual(rows.map((_, i) => hasKids(rows, i)), [true, true, false, false, false, false])
  assert.equal(hasKids(rows, 99), false)
  assert.equal(hasKids([{ depth: 0, group: true, meshes: [0], name: 'lone' }], 0), false) // a group with nothing below it
})

test('a folded group hides everything below it, down to the next row of its own depth', () => {
  assert.deepEqual(visibleRows(rows), [0, 1, 2, 3, 4, 5])
  assert.deepEqual(visibleRows(rows, { collapsed: new Set([1]) }), [0, 1, 4, 5])
  assert.deepEqual(visibleRows(rows, { collapsed: new Set([0]) }), [0, 5])
  assert.deepEqual(visibleRows(rows, { collapsed: new Set([0, 1]) }), [0, 5])
  assert.deepEqual(visibleRows(rows, { collapsed: new Set([5]) }), [0, 1, 2, 3, 4, 5]) // a row that has no kids cannot hide anything
})

test('a filter shows every match, whatever is folded; an empty or blank filter is none', () => {
  const texts = rows.map((r) => r.name)
  assert.deepEqual(visibleRows(rows, { collapsed: new Set([0]), texts, query: 'leg' }), [2, 3])
  assert.deepEqual(visibleRows(rows, { texts, query: '  LEG a ' }), [2])
  assert.deepEqual(visibleRows(rows, { collapsed: new Set([1]), texts, query: '   ' }), [0, 1, 4, 5])
  assert.deepEqual(visibleRows(rows, { texts, query: 'nothing' }), [])
  assert.deepEqual(matchRows(['a', 'b'], ''), [0, 1])
  assert.deepEqual(matchRows(['Steel plate', 'Bolt #ff0000'], '#ff'), [1]) // the Model Viewer's filter also looks at material and colour
})

test('the tri-state of a row: none, some, all of its parts', () => {
  assert.equal(rowState(rows[0], new Set()), 0)
  assert.equal(rowState(rows[0], new Set([0])), 1)
  assert.equal(rowState(rows[1], new Set([0, 1])), 2)
  assert.equal(rowState(rows[0], new Set([0, 1, 2])), 2)
  assert.equal(rowState({ meshes: [] }, new Set([0])), 0)
  assert.equal(rowState(undefined, new Set([0])), 0)
})

test('ancestors: nearest first; the parent of a root row is -1', () => {
  assert.deepEqual(ancestors(rows, 2), [1, 0])
  assert.deepEqual(ancestors(rows, 4), [0])
  assert.deepEqual(ancestors(rows, 5), [])
  assert.equal(parentOf(rows, 3), 1)
  assert.equal(parentOf(rows, 0), -1)
})

test('arrow keys of the tree', () => {
  const all = visibleRows(rows)
  assert.deepEqual(navTarget(rows, all, 0, 'ArrowDown'), { focus: 1 })
  assert.deepEqual(navTarget(rows, all, 5, 'ArrowDown'), { focus: 5 }) // the last row stays
  assert.deepEqual(navTarget(rows, all, 0, 'ArrowUp'), { focus: 0 })
  assert.deepEqual(navTarget(rows, all, 3, 'ArrowUp'), { focus: 2 })
  assert.deepEqual(navTarget(rows, all, 3, 'Home'), { focus: 0 })
  assert.deepEqual(navTarget(rows, all, 3, 'End'), { focus: 5 })
  // Right: an open group goes to its first child, a folded one unfolds, a part stays
  assert.deepEqual(navTarget(rows, all, 1, 'ArrowRight'), { focus: 2 })
  const folded = new Set([1])
  assert.deepEqual(navTarget(rows, visibleRows(rows, { collapsed: folded }), 1, 'ArrowRight', folded), { focus: 1, fold: { row: 1, collapse: false } })
  assert.deepEqual(navTarget(rows, all, 2, 'ArrowRight'), { focus: 2 })
  // Left: an open group folds, a part (or a folded group) goes to its parent, a root part stays
  assert.deepEqual(navTarget(rows, all, 1, 'ArrowLeft'), { focus: 1, fold: { row: 1, collapse: true } })
  assert.deepEqual(navTarget(rows, all, 2, 'ArrowLeft'), { focus: 1 })
  assert.deepEqual(navTarget(rows, visibleRows(rows, { collapsed: folded }), 1, 'ArrowLeft', folded), { focus: 0 })
  assert.deepEqual(navTarget(rows, all, 5, 'ArrowLeft'), { focus: 5 })
  // with a filter the rows are matches: Left and Right neither fold nor move, Down and Up still move
  const none = new Set()
  assert.deepEqual(navTarget(rows, [1, 2, 3], 1, 'ArrowLeft', none, { filtering: true }), { focus: 1 })
  assert.deepEqual(navTarget(rows, [1, 2, 3], 1, 'ArrowRight', none, { filtering: true }), { focus: 1 })
  assert.deepEqual(navTarget(rows, [1, 2, 3], 1, 'ArrowDown', none, { filtering: true }), { focus: 2 })
  // a key the tree does not use, and an empty tree
  assert.equal(navTarget(rows, all, 1, 'a'), null)
  assert.equal(navTarget(rows, [], 0, 'ArrowDown'), null)
  // the focused row is not on screen (it was filtered away): the first row on screen
  assert.deepEqual(navTarget(rows, [3, 4], 0, 'ArrowDown'), { focus: 3 })
})

test('the one tab stop: the remembered row, else the first selected one, else the first', () => {
  assert.equal(rovingRow([0, 1, 4], 4, [1]), 4)
  assert.equal(rovingRow([0, 1, 4], 3, [1]), 1)
  assert.equal(rovingRow([0, 1, 4], 3, []), 0)
  assert.equal(rovingRow([], 3, []), -1)
})

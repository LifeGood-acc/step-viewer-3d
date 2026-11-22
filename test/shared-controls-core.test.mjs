import { test } from 'node:test'
import assert from 'node:assert/strict'
import { controlsState, SHADINGS } from '../editor/shared/controls-core.js'

const mesh = (o = {}) => ({ kind: 'mesh', partCount: 3, hasTextures: true, hasVertexColors: true, shading: 'original', ...o })

test('the effect matrix of section 2c: which switch works in which look (28 cells)', () => {
  // Surface|Mesh works in every look (matcap too, since E1); texture only in Original and Flat; studio light in Original, Solid, Flat; colour per part in Original
  const expect = {
    surface: { original: 1, solid: 1, normals: 1, xray: 1, matcap: 1, flat: 1, vertex: 1 },
    texture: { original: 1, solid: 0, normals: 0, xray: 0, matcap: 0, flat: 1, vertex: 0 },
    studioLight: { original: 1, solid: 1, normals: 0, xray: 0, matcap: 0, flat: 1, vertex: 0 },
    tint: { original: 1, solid: 0, normals: 0, xray: 0, matcap: 0, flat: 0, vertex: 0 }
  }
  let cells = 0
  for (const [control, row] of Object.entries(expect)) {
    for (const sh of SHADINGS) {
      const c = controlsState(mesh({ shading: sh }))[control]
      assert.equal(c.visible, true, `${control} in ${sh} is shown`)
      assert.equal(c.enabled, !!row[sh], `${control} in ${sh}`)
      assert.equal(!!c.reason, !row[sh], `${control} in ${sh}: a disabled control says why, an enabled one does not`)
      cells++
    }
  }
  assert.equal(cells, 28)
})

test('which controls a kind of file shows', () => {
  const vis = (input) => Object.fromEntries(Object.entries(controlsState(input)).map(([k, v]) => [k, v.visible]))
  const m = vis(mesh())
  assert.equal(m.surface, true)
  assert.equal(m.texture, true)
  assert.equal(m.partsTab, true)
  assert.equal(m.partTools, true)
  assert.equal(m.layers, false)
  assert.equal(m.edges, false)
  assert.equal(vis(mesh({ hasTextures: false })).texture, false)
  assert.equal(vis(mesh({ hasVertexColors: false })).vertexShading, false)
  assert.equal(vis(mesh({ partCount: 1 })).tint, false)
  assert.equal(vis(mesh({ partCount: 1 })).partsTab, false)
  assert.equal(vis(mesh({ partCount: 1, step: true })).partsTab, true, 'STEP always has the parts tab')
  assert.equal(vis(mesh({ step: true })).edges, true)
  const pts = vis({ kind: 'points', partCount: 1 })
  assert.equal(pts.surface, false)
  assert.equal(pts.pointControls, true)
  assert.equal(pts.simplify, false)
  assert.equal(pts.editTab, false)
  assert.equal(pts.studioLight, false)
  const splat = controlsState({ kind: 'splat', partCount: 1 })
  assert.equal(splat.studioNoShadow.enabled, false)
  const g = vis({ kind: 'gcode', partCount: 1 })
  assert.equal(g.layers, true)
  assert.equal(g.clip, false)
  assert.equal(g.surface, false)
  assert.equal(vis({ kind: 'mesh', partCount: 1, hasAnimation: true }).animation, true)
  const none = vis({})
  assert.ok(Object.entries(none).every(([k, v]) => k === 'background' || k === 'studioNoShadow' || v === false || k === 'fitSelected'), 'nothing loaded: nothing is shown')
})

test('selection: fit and card follow it, and a missing selection is explained', () => {
  assert.equal(controlsState(mesh({ selection: 0 })).partCard.visible, false)
  assert.equal(controlsState(mesh({ selection: 2 })).partCard.visible, true)
  const f = controlsState(mesh({ selection: 0 })).fitSelected
  assert.equal(f.enabled, false)
  assert.ok(f.reason)
  assert.equal(controlsState(mesh({ selection: 1 })).fitSelected.enabled, true)
})

test('the background control always works', () => {
  for (const sh of SHADINGS) assert.equal(controlsState(mesh({ shading: sh, studioActive: false })).background.enabled, true)
})

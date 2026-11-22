import { test } from 'node:test'
import assert from 'node:assert/strict'
import { migratePrefs, bgModeOf, withBg, defaultState, resetPrefs, bgIsDark, BG_MODES, PREFS_VERSION } from '../editor/shared/prefs-core.js'

test('an old record gets the version and the background model, and keeps its own keys', () => {
  const old = { bg: 'dark', up: 'z', splat: 'points', studio: { on: true, bg: { type: 'gradient' } }, pcMore: true }
  const m = migratePrefs(old)
  assert.equal(m.v, PREFS_VERSION)
  assert.deepEqual(m.bgm, { mode: 'dark' })
  assert.equal(m.bg, 'dark', 'the old key stays, a downgrade finds it')
  assert.deepEqual(m.studio, old.studio)
  assert.equal(m.up, 'z')
  assert.equal(m.pcMore, true)
  assert.deepEqual(old, { bg: 'dark', up: 'z', splat: 'points', studio: { on: true, bg: { type: 'gradient' } }, pcMore: true }, 'the input is not changed')
})

test('no record, a broken record, a record of the new shape', () => {
  for (const bad of [undefined, null, 5, 'x', []]) assert.deepEqual(migratePrefs(bad), { bgm: { mode: 'look' }, v: PREFS_VERSION })
  assert.equal(bgModeOf({ bg: 'purple' }), 'look')
  assert.equal(bgModeOf({ bgm: { mode: 'transparent' }, bg: 'dark' }), 'transparent', 'a mode the old key cannot say: the new key wins')
  assert.equal(bgModeOf({ bgm: { mode: 'dark' } }), 'look', 'an older build cleared the old key: the look')
  assert.equal(bgModeOf({ bgm: { mode: 'look' }, bg: 'light' }), 'light', 'an older build set the old key: it decides')
  assert.equal(bgModeOf({ bgm: { mode: 'nonsense' }, bg: 'light' }), 'light')
  const future = { v: 9, bgm: { mode: 'x' }, extra: 1 }
  assert.deepEqual(migratePrefs(future), future, 'a newer record is left as it is')
  assert.deepEqual(migratePrefs(migratePrefs({ bg: 'light' })), migratePrefs({ bg: 'light' }), 'migrating twice changes nothing')
})

test('withBg writes the new key and the old one where the old one can say it', () => {
  assert.deepEqual(withBg({ up: 'y' }, 'dark'), { up: 'y', bgm: { mode: 'dark' }, bg: 'dark', v: PREFS_VERSION })
  const w = withBg({ bg: 'dark' }, 'gradient')
  assert.equal(w.bg, undefined)
  assert.equal(w.bgm.mode, 'gradient')
  assert.equal(withBg({}, 'nope').bgm.mode, 'look')
})

test('reset all: the standard values of the concept, nothing else remembered', () => {
  assert.deepEqual(resetPrefs(), { v: PREFS_VERSION, bgm: { mode: 'look' } })
  const d = defaultState()
  assert.deepEqual([d.wire, d.tex, d.grid, d.axes, d.box, d.back, d.edges, d.shading, d.bgMode], [false, true, true, true, false, true, true, 'original', 'look'])
})

test('which backgrounds are dark: the grid and the edges contrast with it', () => {
  assert.equal(bgIsDark('dark', { themeDark: false }), true)
  for (const m of ['light', 'white', 'gradient', 'transparent']) assert.equal(bgIsDark(m, { themeDark: true }), false, m)
  assert.equal(bgIsDark('orca', { themeDark: true }), true, 'Orca follows the theme')
  assert.equal(bgIsDark('orca', { themeDark: false, studioDark: true }), false, 'Orca ignores the look')
  assert.equal(bgIsDark('look', { themeDark: false, studioDark: true }), true, 'the look decides')
  assert.equal(bgIsDark('look', { themeDark: true, studioDark: null }), true, 'no look: like Orca')
  assert.equal(bgIsDark('look', { themeDark: true, lookTransparent: true }), false, 'a transparent look shows the light checker')
  assert.equal(BG_MODES.length, 7)
})

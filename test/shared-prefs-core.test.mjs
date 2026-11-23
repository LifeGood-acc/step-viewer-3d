import { test } from 'node:test'
import assert from 'node:assert/strict'
import { migratePrefs, bgModeOf, withBg, defaultState, resetPrefs, bgIsDark, BG_MODES, BG_CYCLE, BG_CUSTOM_DEFAULT, ORCA_BG, bgColorOf, nextBgMode, colorIsDark, PREFS_VERSION } from '../editor/shared/prefs-core.js'

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
  assert.equal(BG_MODES.length, 8)
  assert.equal(bgIsDark('custom', { themeDark: false, customColor: '#101820' }), true, 'an own dark colour')
  assert.equal(bgIsDark('custom', { themeDark: true, customColor: '#f0f0f0' }), false, 'an own light colour, whatever the theme')
})

test('the own background colour: kept in the record, only a #rrggbb counts, the default otherwise', () => {
  assert.equal(bgColorOf(undefined), BG_CUSTOM_DEFAULT)
  assert.equal(bgColorOf({ bgm: { mode: 'custom', color: '#AA00ff' } }), '#aa00ff')
  for (const bad of ['red', '#fff', '#12345', 5, null, 'javascript:1']) assert.equal(bgColorOf({ bgm: { color: bad } }), BG_CUSTOM_DEFAULT, String(bad))
  const w = withBg({}, 'custom', '#336699')
  assert.deepEqual(w.bgm, { mode: 'custom', color: '#336699' })
  assert.equal(w.bg, undefined, 'the old key cannot say it')
  assert.deepEqual(withBg(w, 'white').bgm, { mode: 'white', color: '#336699' }, 'the colour is remembered while another background is on')
  assert.deepEqual(withBg({}, 'white').bgm, { mode: 'white' }, 'no colour was ever chosen: none is written')
  assert.deepEqual(withBg({}, 'custom', 'nope').bgm, { mode: 'custom' }, 'a bad colour is not stored')
  assert.deepEqual(migratePrefs({ bgm: { mode: 'custom', color: '#336699' } }).bgm, { mode: 'custom', color: '#336699' })
  assert.equal(bgModeOf({ bgm: { mode: 'custom' } }), 'custom')
  assert.equal(colorIsDark('#000000'), true)
  assert.equal(colorIsDark('#ffffff'), false)
  assert.equal(colorIsDark('#8fa3bf'), false, 'the default is a light blue-grey')
})

test('key B steps through five backgrounds that look different, from any stored one', () => {
  assert.deepEqual(BG_CYCLE, ['orca', 'white', 'gradient', 'transparent', 'custom'])
  assert.equal(nextBgMode('look'), 'white', 'look with no look on is Orca: the next one is a visible change')
  assert.equal(nextBgMode('orca'), 'white')
  assert.equal(nextBgMode('custom'), 'orca', 'wraps')
  for (const m of ['light', 'dark', 'nonsense', undefined]) assert.equal(nextBgMode(m), 'white', String(m))
  let m = 'orca'
  const seen = new Set()
  for (let i = 0; i < 5; i++) seen.add((m = nextBgMode(m)))
  assert.equal(seen.size, 5, 'five presses visit five different backgrounds')
})

test('the Orca background colours are #rrggbb and differ (the swatch and the scene read the same two)', () => {
  for (const c of [ORCA_BG.light, ORCA_BG.dark]) assert.match(c, /^#[0-9a-f]{6}$/)
  assert.equal(colorIsDark(ORCA_BG.dark), true)
  assert.equal(colorIsDark(ORCA_BG.light), false)
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CHROME_STRINGS } from '../editor/shared/chrome-strings.js'

const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(here, '..', 'editor', 'shared', 'chrome-layout.js'), 'utf8')

test('every string the toolbar, tabs and dialogs ask for exists in both languages', () => {
  const keys = new Set([...src.matchAll(/\bt\('([a-z0-9_]+)'/g)].map((m) => m[1]))
  for (const m of ['distance', 'angle', 'circle', 'edge', 'parts']) keys.add(`ch_m_${m}`) // built with a template
  for (const m of ['look', 'orca', 'light', 'dark', 'white', 'gradient', 'transparent']) keys.add(`ch_bg_${m}`)
  assert.ok(keys.size > 40)
  for (const k of keys) {
    if (!k.startsWith('ch_')) continue // the others belong to the viewers' own string tables
    assert.ok(CHROME_STRINGS.en[k], `en.${k} is missing`)
    assert.ok(CHROME_STRINGS.de[k], `de.${k} is missing`)
  }
})

test('both languages have the same keys', () => {
  assert.deepEqual(Object.keys(CHROME_STRINGS.en).sort(), Object.keys(CHROME_STRINGS.de).sort())
})

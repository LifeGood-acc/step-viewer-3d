import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SHORTCUT_ROWS } from '../editor/shared/chrome-ui.js'
import { KEYMAP } from '../editor/shared/keymap.js'
import { CHROME_STRINGS } from '../editor/shared/chrome-strings.js'

test('the list of shortcuts names every key of the key table', () => {
  const listed = new Set(SHORTCUT_ROWS.flatMap((r) => r.actions))
  for (const action of new Set(Object.values(KEYMAP))) assert.ok(listed.has(action), `the shortcut list does not mention the action ${action}`)
})

test('every row of the list has its text in both languages', () => {
  for (const r of SHORTCUT_ROWS) {
    assert.ok(CHROME_STRINGS.en[r.text], `en.${r.text}`)
    assert.ok(CHROME_STRINGS.de[r.text], `de.${r.text}`)
  }
})

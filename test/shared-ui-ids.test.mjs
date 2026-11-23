import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { COMMON_IDS, MODEL_IDS, STEP_IDS, STUDIO_IDS, PARTCARD_IDS, CHROME_IDS, SHELL_IDS } from '../editor/shared/ui-ids.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const id = JSON.parse(readFileSync(join(root, 'orca-plugin.json'), 'utf8')).id
const own = id === 'step-viewer-3d' ? STEP_IDS : MODEL_IDS

test('the pages still have every id the end-to-end tests use', () => {
  for (const f of ['index.html', 'panel.html']) {
    const html = readFileSync(join(root, 'editor', f), 'utf8')
    for (const name of [...COMMON_IDS, ...own]) assert.ok(html.includes(`id="${name}"`), `${f} lost #${name} (listed in shared/ui-ids.js: remove it there if the control is gone on purpose, and fix the e2e tests)`)
  }
})
test('the studio section is built with the ids the tests use', () => {
  const src = readFileSync(join(root, 'editor', 'shared', 'studio-ui.js'), 'utf8')
  for (const name of STUDIO_IDS) assert.ok(src.includes(`id: '${name}'`) || src.includes(`'${name}'`), `studio-ui.js no longer makes #${name}`)
})
test('the part card is built with the ids the tests use', () => {
  const src = readFileSync(join(root, 'editor', 'shared', 'part-card.js'), 'utf8')
  for (const name of PARTCARD_IDS) assert.ok(src.includes(`id: '${name}'`), `part-card.js no longer makes #${name}`)
})
test('the toolbar, tabs and measuring bar are built with the ids the tests use', () => {
  const src = ['chrome-layout.js', 'chrome-export.js', 'part-tree-ui.js', 'file-card.js'].map((f) => readFileSync(join(root, 'editor', 'shared', f), 'utf8')).join('\n')
  for (const name of CHROME_IDS) assert.ok(src.includes(`'${name}'`), `chrome-layout.js no longer makes #${name}`)
})
test('the shell builds the ids the tests use', () => {
  const src = readFileSync(join(root, 'editor', 'shared', 'shell.js'), 'utf8')
  for (const name of SHELL_IDS) assert.ok(src.includes(`'${name}'`), `shell.js no longer makes #${name}`)
})
test('no id is listed twice', () => {
  const all = [...COMMON_IDS, ...MODEL_IDS, ...STEP_IDS, ...STUDIO_IDS, ...PARTCARD_IDS, ...CHROME_IDS, ...SHELL_IDS]
  assert.equal(new Set(all).size, all.length)
})

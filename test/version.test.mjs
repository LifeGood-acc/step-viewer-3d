import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

test('the manifest version is the newest entry of the CHANGELOG, and the screenshots exist', () => {
  const manifest = JSON.parse(readFileSync(join(root, 'orca-plugin.json'), 'utf8'))
  const first = readFileSync(join(root, 'CHANGELOG.md'), 'utf8').match(/^## (\d+\.\d+\.\d+)/m)
  assert.ok(first, 'CHANGELOG.md has no version heading')
  assert.equal(first[1], manifest.version, 'the newest CHANGELOG entry is not the manifest version')
  for (const s of [manifest.cover, ...manifest.screenshots]) assert.ok(readFileSync(join(root, s.path)).length > 1000, `${s.path} is missing or empty`)
})

test('no text points to a part of the old interface', () => {
  const files = ['editor/lib.js', 'editor/shared/export-strings.js', 'editor/shared/tools-strings.js', 'editor/shared/studio-strings.js', 'editor/shared/session-strings.js', 'README.md']
  for (const f of files) {
    const text = readFileSync(join(root, f), 'utf8')
    for (const re of [/Tools section/, /Export a copy/, /Abschnitt Werkzeuge/, /Kopie exportieren/, /section \*Measure\*/, /Points section/, /\(Tools, Unit/, /\(Werkzeuge, Einheit/]) assert.ok(!re.test(text), `${f} still mentions the old interface: ${re}`)
  }
})

test('the version shown in the status bar (editor/version.js) is the manifest version', async () => {
  const manifest = JSON.parse(readFileSync(join(root, 'orca-plugin.json'), 'utf8'))
  const { PLUGIN_VERSION } = await import('../editor/version.js')
  assert.equal(PLUGIN_VERSION, manifest.version, 'editor/version.js and orca-plugin.json must carry the same version')
})

// Guards for the browser tests (dev/e2e-*.mjs): a check that cannot fail, or a helper that is used but not defined, is found here and not
// months later. Same file in both plugins (test/shared-dev-guards.test.mjs); reads ../dev next to it.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const dev = join(dirname(fileURLToPath(import.meta.url)), '..', 'dev')
const files = readdirSync(dev).filter((f) => /^e2e-.*\.mjs$/.test(f))
// helpers that every e2e file defines for itself (a file that calls one must define it: `frames` was once called in e2e-chrome without being there)
const HELPERS = ['frames', 'sleep', 'press', 'key', 'visibleIn', 'shot', 'count']

test('e2e files: no check that is always true ("|| true"), no check without a condition', () => {
  for (const f of files) {
    const src = readFileSync(join(dev, f), 'utf8')
    src.split('\n').forEach((line, i) => {
      if (/^\s*(\/\/|\*)/.test(line)) return
      assert.ok(!/\bcheck\(.*\|\|\s*true\s*[,)]/.test(line), `${f}:${i + 1} check(... || true, ...) cannot fail: name the real condition`)
      assert.ok(!/\bcheck\(\s*true\s*,/.test(line) || /skipped/.test(line), `${f}:${i + 1} check(true, ...) cannot fail (only a note that says "skipped" may use it)`)
    })
  }
})
test('e2e files: every helper that is called is defined in the same file', () => {
  for (const f of files) {
    const src = readFileSync(join(dev, f), 'utf8')
    for (const h of HELPERS) {
      const used = new RegExp(`(^|[^\\w.$])${h}\\(`, 'm').test(src.replace(/\/\/.*$/gm, ''))
      if (!used) continue
      const defined = new RegExp(`(const|let|var|function|async function)\\s+${h}\\b`).test(src)
      assert.ok(defined, `${f} calls ${h}() but does not define it (copy the definition from a sibling e2e file or use sleep())`)
    }
  }
})

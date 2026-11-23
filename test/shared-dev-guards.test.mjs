// Guards for the browser tests (dev/e2e-*.mjs): a check that cannot fail, or a helper that is used but not defined, is found here and not
// months later. Same file in both plugins (test/shared-dev-guards.test.mjs); reads ../dev next to it.
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
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

// a "// comment" inside a one-line page expression ends the whole line: everything after it is lost and the page answers "SyntaxError: Unexpected token" (happened twice in round 4:
// e2e-export and e2e-layout). The comment belongs on a line of its own, outside the backticks.
const COMMENT_IN_ONE_LINE_EXPRESSION = /\bev\(`[^`\n]*[^:\w]\/\/\s[^`\n]*`\)/
test('e2e files: no "// comment" inside a one-line page expression ev(`...`) (it swallows the rest of the line)', () => {
  for (const f of files) {
    readFileSync(join(dev, f), 'utf8').split('\n').forEach((line, i) => {
      if (/^\s*\/\//.test(line)) return
      assert.ok(!COMMENT_IN_ONE_LINE_EXPRESSION.test(line), `${f}:${i + 1} a // comment inside ev(\`...\`) ends the expression: move the comment out of the backticks`)
    })
  }
})
test('the guard above finds the real mistake of round 4 (a test that cannot fail is no guard)', () => {
  assert.ok(COMMENT_IN_ONE_LINE_EXPRESSION.test("const x = await ev(`(() => { const a = 1 })() // the sizes of the card`)"))
  assert.ok(!COMMENT_IN_ONE_LINE_EXPRESSION.test("const x = await ev(`fetch('http://127.0.0.1:1/x')`)"))
})

test('check-all.sh runs every e2e file of the plugin (a new e2e file that nobody runs is a test that does not exist)', (t) => {
  const script = join(dev, '..', '..', '_shared', 'check-all.sh')
  if (!existsSync(script)) return t.skip('no check-all.sh next to the plugin (a copy outside the work tree)')
  const loop = /for e in ([a-z ]+); do/.exec(readFileSync(script, 'utf8'))
  assert.ok(loop, 'the loop of check-all.sh was not found')
  const run = new Set(loop[1].split(' '))
  for (const f of files) assert.ok(run.has(f.replace(/^e2e-|\.mjs$/g, '')), `${f} is not in the loop of _shared/check-all.sh`)
})

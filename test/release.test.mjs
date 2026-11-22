// Release readiness: license line, locked build, no stray binary files, and the privacy check. (Not about the viewer's behaviour.)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const isGit = existsSync(join(root, '.git'))
const read = (f) => readFileSync(join(root, f), 'utf8')
const manifest = JSON.parse(read('orca-plugin.json'))

test('LICENSE carries the agreed copyright line; manifest license matches package.json', () => {
  assert.match(read('LICENSE'), /^Copyright \(c\) 2026 LifeGood-acc and contributors$/m)
  assert.equal(JSON.parse(read('package.json')).license, manifest.license)
  assert.equal(JSON.parse(read('package.json')).version, manifest.version)
})

test('the build is locked: package-lock.json pins every dependency of package.json', () => {
  const pkg = JSON.parse(read('package.json'))
  const lock = JSON.parse(read('package-lock.json'))
  for (const [name, version] of Object.entries(pkg.dependencies)) {
    assert.equal(lock.packages[`node_modules/${name}`]?.version, version, `${name} is not locked at ${version}`)
    assert.ok(lock.packages[`node_modules/${name}`]?.integrity, `${name} has no integrity hash in the lock file`)
  }
})

test('npm run build reproduces editor/vendor (when node_modules is installed)', { skip: !existsSync(join(root, 'node_modules')) && 'run npm ci first' }, () => {
  execFileSync('npm', ['run', '--silent', 'verify-build'], { cwd: root, stdio: 'pipe' })
})

test('only images and WebAssembly are binary files; no archives', { skip: !isGit && 'no git' }, () => {
  const files = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean)
  const allowed = /\.(png|wasm)$/
  const textish = /\.(js|mjs|json|md|html|css|py|sh|txt|step|stepview|3dview|sha256)$|(^|\/)(LICENSE|\.gitignore|\.gitattributes)$/
  const bad = files.filter((f) => !allowed.test(f) && !textish.test(f))
  assert.deepEqual(bad, [], 'unexpected file types in the repository (the catalog rejects binary files and archives)')
  assert.deepEqual(files.filter((f) => /\.(zip|3mf|gz|tar|tgz|7z|rar|whl|icns|o|a|hwp|glb|ply|stl|fbx|usdz)$/i.test(f)), [])
  // symbolic links are a catalog reason for "binary-files" too (git mode 120000)
  const links = execFileSync('git', ['ls-files', '-s'], { cwd: root, encoding: 'utf8' }).split('\n').filter((l) => l.startsWith('120000'))
  assert.deepEqual(links, [], 'no symbolic links')
  // the sample is plain text
  assert.match(readFileSync(join(root, 'samples/assembly.step'), 'utf8'), /^ISO-10303-21;/)
  assert.ok(!readFileSync(join(root, 'samples/assembly.step')).includes(0), 'samples/assembly.step is text (no NUL byte)')
})

test('the privacy check finds nothing in files and history', { skip: !isGit && 'no git' }, () => {
  const out = execFileSync('sh', ['dev/privacy-check.sh'], { cwd: root, encoding: 'utf8' })
  assert.match(out, /PRIVACY CHECK PASSED: 0 findings/)
})

// /correct: a rename left stale names in docs, notes and tests ("occt-import-js.wasm.gz" lived in 11 files). One check for all of them:
// a path under editor/vendor/ named in the project's own text must exist, the converter paths must be the ones dev/vendor.json records,
// and the worker and the page fetch exactly that converter file. The error names the file to fix.
test('every editor/vendor path named in a text file exists; the loader fetches the recorded converter file', { skip: !isGit && 'no git' }, () => {
  const files = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n').filter((f) => /\.(md|js|mjs|json|html|sh|txt)$/.test(f))
  const skip = /^(CHANGELOG\.md|package-lock\.json|licenses\/|editor\/vendor\/|test\/release\.test\.mjs$|test\/shared-glb-compress\.test\.mjs$)/ // history, locks, third-party text, this test, and the dev guard that reads the sibling viewer's files (skipped here)
  const missing = []
  for (const f of files.filter((x) => !skip.test(x))) {
    for (const m of read(f).matchAll(/editor\/vendor\/[A-Za-z0-9_./-]*[A-Za-z0-9_]\.(?:js|wasm|gz|txt)\b/g)) if (!existsSync(join(root, m[0]))) missing.push(`${f}: ${m[0]}`)
    if (/occt-import-js\.wasm\.gz/.test(read(f))) missing.push(`${f}: names occt-import-js.wasm.gz (the converter is shipped as a plain .wasm)`)
  }
  assert.deepEqual(missing, [], 'text names a vendor file that does not exist: fix the name there (the file list is dev/vendor.json)')
  const wasm = JSON.parse(read('dev/vendor.json')).packages.flatMap((p) => p.files).map((f) => f.to).filter((to) => to.endsWith('.wasm'))
  assert.deepEqual(wasm, ['editor/vendor/occt/occt-import-js.wasm'], 'dev/vendor.json lists exactly the one converter WebAssembly file')
  const url = './' + wasm[0].replace(/^editor\//, '')
  for (const f of ['editor/step-worker.js', 'editor/viewer.js']) assert.ok(read(f).includes(`fetch('${url}')`), `${f} must fetch ${url}`)
})

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
  const allowed = /\.(png|wasm|wasm\.gz)$/
  const textish = /\.(js|mjs|json|md|html|css|py|sh|txt|step|stepview|3dview|sha256)$|(^|\/)(LICENSE|\.gitignore|\.gitattributes)$/
  const bad = files.filter((f) => !allowed.test(f) && !textish.test(f))
  assert.deepEqual(bad, [], 'unexpected file types in the repository (the catalog rejects binary files and archives)')
  assert.deepEqual(files.filter((f) => /\.(zip|3mf|gz|tar|tgz|7z|rar|glb|ply|stl|fbx|usdz)$/i.test(f) && !/\.wasm\.gz$/.test(f)), [])
})

test('the privacy check finds nothing in files and history', { skip: !isGit && 'no git' }, () => {
  const out = execFileSync('sh', ['dev/privacy-check.sh'], { cwd: root, encoding: 'utf8' })
  assert.match(out, /PRIVACY CHECK PASSED: 0 findings/)
})

// Repository rules for a release: where the third-party files come from, no binary samples, no unexplained minified code, layout.
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'
import { checkVendor, loadManifest } from '../dev/vendor.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const walk = (d) => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]))
const recorded = new Set(loadManifest(root).packages.flatMap((p) => p.files.map((f) => f.to)))

// the files git tracks; null when this folder is not a git work tree (a plain copy)
function tracked() {
  try {
    return execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\n').filter(Boolean)
  } catch {
    return null
  }
}

test('every vendored file is the file dev/vendor.json records (package, path in the package, SHA-256)', () => {
  assert.deepEqual(checkVendor(root), [])
})

test('nothing under editor/vendor is unrecorded', () => {
  const found = walk(join(root, 'editor', 'vendor')).map((p) => relative(root, p).split('\\').join('/'))
  assert.deepEqual(found.filter((f) => !recorded.has(f)), [], 'add the file to dev/vendor.json (with its npm source) or remove it')
})

test('the manifest pins every package to an exact version with an integrity value', () => {
  for (const p of loadManifest(root).packages) {
    assert.match(p.version, /^\d+\.\d+\.\d+$/, p.name)
    assert.match(p.integrity, /^sha512-[A-Za-z0-9+/]+=*$/, p.name)
    assert.ok(p.license && p.source, p.name)
  }
})

test('THIRD_PARTY_NOTICES names every vendored package, its version and its integrity', () => {
  const notice = readFileSync(join(root, 'THIRD_PARTY_NOTICES.md'), 'utf8')
  for (const p of loadManifest(root).packages) {
    assert.ok(notice.includes(`${p.name}@${p.version}`), `${p.name}@${p.version} is not named in THIRD_PARTY_NOTICES.md`)
    assert.ok(notice.includes(p.integrity), `the integrity of ${p.name}@${p.version} is not in THIRD_PARTY_NOTICES.md`)
  }
})

test('no minified code without a recorded source', () => {
  // A file with very long lines is minified (or embeds data). Only files that dev/vendor.json traces to an npm package may be.
  for (const f of walk(join(root, 'editor')).filter((p) => /\.(m?js|css)$/.test(p))) {
    const rel = relative(root, f).split('\\').join('/')
    const longest = readFileSync(f, 'utf8').split('\n').reduce((a, l) => Math.max(a, l.length), 0)
    if (longest > 2000) assert.ok(recorded.has(rel), `${rel} has a ${longest}-character line (minified?) and no npm source in dev/vendor.json`)
  }
})

test('binary samples are generated, not committed: only images and WebAssembly are binary files in the repository', () => {
  const files = tracked()
  if (!files) return // not a git work tree: nothing to check
  // no archives at all (the catalog rejects .gz, .zip, .whl, ...); the converter's WebAssembly is a plain .wasm (dev/vendor.json records its checksum)
  const binary = files.filter((f) => /\.(glb|gltf|3mf|zip|gz|tgz|tar|whl|usdz|stl|ply|obj|bin|jar|so|dylib|exe|icns|o|a|hwp)$/i.test(f))
  assert.deepEqual(binary, [], 'generate sample models with dev/make_samples.py instead of committing them')
  assert.ok(!files.some((f) => f.startsWith('samples/') && !/\.(step|stepview)$/.test(f)), 'samples/ is generated (ignored by git)')
})

test('repository layout: the manifest is at the repository root and no catalog path is needed', () => {
  assert.ok(existsSync(join(root, 'orca-plugin.json')))
  const manifest = JSON.parse(readFileSync(join(root, 'orca-plugin.json'), 'utf8'))
  for (const e of manifest.contributes.customEditors) assert.ok(existsSync(join(root, e.entry)), e.entry)
  try {
    const top = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    assert.equal(top.replace(/\/+$/, ''), root.replace(/\/+$/, ''), 'the plugin folder is the repository root (source.path stays empty)')
  } catch {
    // not a git work tree
  }
})

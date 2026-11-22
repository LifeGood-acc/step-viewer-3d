#!/usr/bin/env node
// Third-party files in editor/vendor: where each one comes from, and how to check or rebuild it.
//
//   node dev/vendor.mjs --check      offline: the SHA-256 of every vendored file against dev/vendor.json (the unit tests run this too)
//   node dev/vendor.mjs --update     fetches each package with `npm pack` (needs the network once), verifies the tarball's integrity
//                                    (sha512, recorded in dev/vendor.json) and writes the files; each must come out byte-identical to
//                                    the recorded SHA-256, otherwise nothing is written
//
// The three.js files are the readable builds from the npm package `three` (build/three.module.js and build/three.core.js; the package
// ships no .min.js since r187) and the r<version> tag at https://github.com/mrdoob/three.js. Nothing here is minified by this project.
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')
export const loadManifest = (r = root) => JSON.parse(readFileSync(join(r, 'dev', 'vendor.json'), 'utf8'))

// Returns a list of problems (empty: every vendored file is exactly what the manifest says).
export function checkVendor(r = root) {
  const problems = []
  for (const pkg of loadManifest(r).packages) {
    for (const f of pkg.files) {
      const p = join(r, f.to)
      if (!existsSync(p)) problems.push(`${f.to}: missing`)
      else if (sha256(readFileSync(p)) !== f.sha256) problems.push(`${f.to}: SHA-256 differs from dev/vendor.json (${pkg.name}@${pkg.version})`)
    }
  }
  return problems
}

function update() {
  const tmp = mkdtempSync(join(tmpdir(), 'vendor-'))
  try {
    const writes = []
    for (const pkg of loadManifest().packages) {
      const wanted = pkg.files.filter((f) => f.from)
      if (!wanted.length) continue
      const name = execFileSync('npm', ['pack', `${pkg.name}@${pkg.version}`, '--pack-destination', tmp, '--silent'], { encoding: 'utf8' }).trim().split('\n').pop()
      const tgz = readFileSync(join(tmp, name))
      const integrity = 'sha512-' + createHash('sha512').update(tgz).digest('base64')
      if (integrity !== pkg.integrity) throw new Error(`${pkg.name}@${pkg.version}: tarball integrity ${integrity} is not the recorded ${pkg.integrity}`)
      const dir = join(tmp, `${pkg.name}-${pkg.version}`)
      mkdirSync(dir)
      execFileSync('tar', ['-xzf', join(tmp, name), '-C', dir])
      for (const f of wanted) {
        const data = readFileSync(join(dir, 'package', f.from))
        if (sha256(data) !== f.sha256) throw new Error(`${pkg.name}@${pkg.version}: ${f.from} is not what dev/vendor.json records (${f.to})`)
        writes.push([f.to, data])
      }
    }
    for (const [to, data] of writes) {
      mkdirSync(dirname(join(root, to)), { recursive: true })
      writeFileSync(join(root, to), data)
    }
    console.log(`rebuilt ${writes.length} files from npm, all byte-identical to the recorded checksums`)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const mode = process.argv[2]
  if (mode === '--update') update()
  else if (mode === '--check') {
    const problems = checkVendor()
    if (problems.length) {
      console.error(problems.join('\n'))
      process.exit(1)
    }
    console.log('vendored files match dev/vendor.json')
  } else {
    console.error('usage: node dev/vendor.mjs --check | --update')
    process.exit(2)
  }
}

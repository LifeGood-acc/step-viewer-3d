#!/usr/bin/env node
// Reproducible build of editor/vendor: `npm ci && npm run build`.
//
// The plugin ships third-party files in editor/vendor (three.js, its loaders, meshoptimizer, ...). They are copied unchanged out of
// the pinned npm packages (package.json + package-lock.json, integrity hashes) and each result must match the SHA-256 recorded in
// dev/vendor.json. Nothing is minified or transformed here.
//
//   node dev/build.mjs            copies the files from node_modules into editor/vendor
//   node dev/build.mjs --check    builds into a temporary folder and compares with editor/vendor (exit 1 on any difference)
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { gunzipSync, gzipSync } from 'node:zlib'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const sha = (b) => createHash('sha256').update(b).digest('hex')
const manifest = JSON.parse(readFileSync(join(root, 'dev', 'vendor.json'), 'utf8'))

// Returns [{ to, data }] for every recorded file that has a npm source ("from").
export function buildFiles() {
  const out = []
  for (const pkg of manifest.packages) {
    const base = join(root, 'node_modules', ...pkg.name.split('/'))
    const installed = existsSync(join(base, 'package.json')) ? JSON.parse(readFileSync(join(base, 'package.json'), 'utf8')).version : null
    if (installed !== pkg.version) throw new Error(`${pkg.name}: node_modules has ${installed}, dev/vendor.json wants ${pkg.version} (run npm ci)`)
    for (const f of pkg.files.filter((x) => x.from)) {
      const data = readFileSync(join(base, f.from))
      if (sha(data) !== f.sha256) throw new Error(`${pkg.name}@${pkg.version}: ${f.from} differs from the recorded SHA-256 (${f.to})`)
      out.push({ to: f.to, data: f.gzip ? gzipSync(data, { level: 9 }) : data })
    }
  }
  return out
}

const walk = (d) => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]))

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const files = buildFiles()
  if (process.argv[2] === '--check') {
    const tmp = mkdtempSync(join(tmpdir(), 'vendor-build-'))
    try {
      let bad = 0
      for (const f of files) {
        const dst = join(tmp, f.to)
        mkdirSync(dirname(dst), { recursive: true })
        writeFileSync(dst, f.data)
        const have = existsSync(join(root, f.to)) ? readFileSync(join(root, f.to)) : null
        if (!have || sha(have) !== sha(f.data)) {
          // gzip output may differ between zlib versions; compare the unpacked content then
          const same = have && f.to.endsWith('.gz') && sha(gunzipSync(have)) === sha(gunzipSync(f.data))
          if (!same) { console.error(`differs: ${f.to}`); bad++ }
        }
      }
      if (bad) process.exit(1)
      console.log(`build check: ${files.length} files rebuilt from the locked npm packages are identical to editor/vendor`)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  } else {
    for (const f of files) {
      mkdirSync(dirname(join(root, f.to)), { recursive: true })
      const cur = existsSync(join(root, f.to)) ? readFileSync(join(root, f.to)) : null
      // gzip output depends on the zlib version: keep the existing file when its unpacked content is already right
      if (cur && f.to.endsWith('.gz') && sha(gunzipSync(cur)) === sha(gunzipSync(f.data))) continue
      writeFileSync(join(root, f.to), f.data)
    }
    console.log(`built ${files.length} files into editor/vendor`)
  }
}

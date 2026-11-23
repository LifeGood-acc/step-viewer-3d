#!/usr/bin/env node
// Measures load time, frame time and JS heap for standard files and writes a PNG of the canvas for each sample, for before/after
// comparisons (for example a three.js update): node dev/measure-render.mjs <out-dir>; compare two folders with dev/compare-render.py.
import { spawn, execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const plugin = join(here, '..')
const isStep = existsSync(join(plugin, 'samples', 'assembly.step'))
const dir = mkdtempSync(join(tmpdir(), 'studio-e2e-'))
const samples = join(dir, 'samples')
execFileSync('mkdir', ['-p', samples])
let modelFile
if (isStep) modelFile = join(plugin, 'samples', 'assembly.step')
else {
  execFileSync('python3', [join(here, 'make_samples.py'), '--out', samples], { stdio: 'ignore' })
  modelFile = join(samples, 'parts.glb')
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const rnd = Math.floor(Math.random() * 80)
const port = 8900 + rnd
const chromePort = 9400 + rnd
const server = spawn('python3', [join(here, 'harness_server.py'), String(port)], { stdio: 'ignore' })
const chrome = spawn(process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', `--remote-debugging-port=${chromePort}`, '--use-angle=metal', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--no-first-run', '--enable-precise-memory-info',
  `--user-data-dir=${join(dir, 'profile')}`, 'about:blank'
], { stdio: 'ignore' })
let failures = 0
const results = []
const check = (ok, what) => {
  results.push(`${ok ? 'ok  ' : 'FAIL'} ${what}`)
  console.log(results.at(-1))
  if (!ok) failures++
}
let ws
let id = 0
const pend = new Map()
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
async function ev(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text))
  return r.result?.result?.value
}
async function waitFor(expr, ms = 60000, what = expr) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    if (await ev(expr)) return
    await sleep(100)
  }
  throw new Error(`timeout waiting for ${what}`)
}
const open = async (file, extra = '') => {
  await send('Page.navigate', { url: `http://127.0.0.1:${port}/h/index.html?file=${encodeURIComponent(file)}&lang=en${extra}` })
  await sleep(300)
  await waitFor(`document.documentElement.dataset.state === 'ok'`, 90000, `${file} to load`)
}
// the studio section's controls, as a person would use them
const setCtl = (id, value) => ev(`(() => { const e = document.getElementById(${JSON.stringify(id)}); if (e.type === 'checkbox') e.checked = ${JSON.stringify(value)}; else e.value = ${JSON.stringify(value)}; e.dispatchEvent(new Event(e.tagName === 'SELECT' || e.type === 'checkbox' ? 'change' : 'input', { bubbles: true })) })()`)
const preset = (p) => setCtl('st-preset', p)
// draws a frame and reads the canvas in the same task (the drawing buffer is not kept): { w, h, px(x, y), data }
const frame = `(() => { const { renderer, scene, camera } = window.__h; renderer.render(scene, camera); const c = renderer.domElement; const cv = new OffscreenCanvas(c.width, c.height); const g = cv.getContext('2d', { willReadFrequently: true }); g.drawImage(c, 0, 0); return g.getImageData(0, 0, c.width, c.height) })()`
const pixels = (extra = '') => ev(`(() => { const d = ${frame}; const at = (x, y) => [...d.data.slice(4 * (y * d.width + x), 4 * (y * d.width + x) + 4)]; ${extra} })()`)
const corners = () => pixels(`return { w: d.width, h: d.height, tl: at(2, 2), bl: at(2, d.height - 3), tr: at(d.width - 3, 2), c: at(d.width >> 1, d.height >> 1) }`)
// frames are kept in the page (a canvas is millions of numbers: not sent through the debugger)
const snap = (name) => ev(`(() => { window.__f = window.__f || {}; window.__f[${JSON.stringify(name)}] = ${frame}.data; return true })()`)
// how many red-channel values of A are darker than B by more than `by` (in B's opaque pixels)
const darker = (a, b, by = 12) => ev(`(() => { const A = window.__f[${JSON.stringify(a)}], B = window.__f[${JSON.stringify(b)}]; let n = 0; for (let i = 0; i < A.length; i += 4) if (B[i] - A[i] > ${by} && A[i + 3] === 255) n++; return n })()`)
// the largest difference of the red channel between two frames, and how many values differ by more than `by`
const diff = (a, b, by = 20) => ev(`(() => { const A = window.__f[${JSON.stringify(a)}], B = window.__f[${JSON.stringify(b)}]; let n = 0, max = 0; for (let i = 0; i < A.length; i += 4) { const d = Math.abs(A[i] - B[i]); if (d > max) max = d; if (d > ${by}) n++ } return { n, max } })()`)


const outDir = process.argv[2]
if (!outDir) throw new Error('usage: node dev/measure-render.mjs <out-dir>')
execFileSync('mkdir', ['-p', outDir])
const median = (a) => [...a].sort((x, y) => x - y)[a.length >> 1]
const metrics = {}
const pngOf = () => ev(`(async () => { const d = ${frame}; const cv = new OffscreenCanvas(d.width, d.height); cv.getContext('2d').putImageData(d, 0, 0); const b = await cv.convertToBlob({ type: 'image/png' }); const u = new Uint8Array(await b.arrayBuffer()); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s) })()`)
const bench = (n) => ev(`(() => { const { renderer, scene, camera } = window.__h; const gl = renderer.getContext(); const px = new Uint8Array(4); for (let i = 0; i < 30; i++) renderer.render(scene, camera); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); const t0 = performance.now(); for (let i = 0; i < ${n}; i++) { camera.position.x += 0.0001; renderer.render(scene, camera) } gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); return (performance.now() - t0) / ${n} })()`)
// the cost of the cube and the numbers of the view (UX v3, E4) in the frame as the page really draws it: render + viewFrame (cube, scale bar, zoom, status bar), the camera turning a little each frame
// (so the cube is painted every time, the worst case), with the cube and the status bar on and with the cube off (its canvas is not painted then)
const benchView = (n, cubeOn) => ev(`(() => { const { renderer, scene, camera, chrome } = window.__h; const gl = renderer.getContext(); const px = new Uint8Array(4); chrome.view.cube.setHidden(!${cubeOn}); for (let i = 0; i < 20; i++) { renderer.render(scene, camera); window.__h.viewFrame() } gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); const t0 = performance.now(); const p0 = chrome.view.cube.paintCount(); const c = Math.cos(0.01), s = Math.sin(0.01); for (let i = 0; i < ${n}; i++) { const x = camera.position.x, z = camera.position.z; camera.position.x = x * c - z * s; camera.position.z = x * s + z * c; camera.lookAt(0, 0, 0); camera.updateMatrixWorld(); renderer.render(scene, camera); window.__h.viewFrame() } window.__paints = chrome.view.cube.paintCount() - p0; gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); const ms = (performance.now() - t0) / ${n}; chrome.view.cube.setHidden(false); return { ms, paints: window.__paints } })()`)
const loadMs = () => ev(`(() => { const dt = [...document.querySelectorAll('#stats dt, #stats-more dt')].map((e) => e.textContent); const dd = [...document.querySelectorAll('#stats dd, #stats-more dd')].map((e) => e.textContent); const i = dt.findIndex((x) => /load time|ladezeit/i.test(x)); return i < 0 ? null : parseFloat(dd[i]) })()`)
try {
  let tries = 0
  let targets
  while (tries++ < 50) {
    targets = await fetch(`http://127.0.0.1:${chromePort}/json`).then((r) => r.json()).catch(() => null)
    if (targets) break
    await sleep(200)
  }
  ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl)
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.method === 'Runtime.exceptionThrown') console.error('PAGE ERROR', d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text); if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') console.error('PAGE console.error', d.params.args.map((a) => a.value || a.description).join(' ').slice(0, 300)); if (d.id && pend.has(d.id)) { pend.get(d.id)({ result: d.result, error: d.error }); pend.delete(d.id) } }
  await new Promise((r) => (ws.onopen = r))
  await send('Page.enable')
  await send('Runtime.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 700, deviceScaleFactor: 1, mobile: false })
  const files = isStep ? [modelFile] : ['parts.glb', 'bracket.stl', 'textured.glb', 'mesh.ply', 'cloud.ply', 'torus.obj', 'parts.3mf', 'box.fbx', 'animated.glb', 'skinned.glb', 'print.gcode', 'splat.ply', 'embedded.gltf', 'cloud.pcd', 'cloud.xyz', 'parts-meshopt.glb'].map((f) => join(samples, f))
  for (const f of files) {
    const name = f.split('/').pop()
    const loads = []
    for (let i = 0; i < 3; i++) {
      await open(f)
      if (/splat\.ply$/.test(f)) await waitFor(`document.documentElement.dataset.splat === 'on'`, 30000, 'splats').catch(() => {})
      loads.push(await loadMs())
    }
    await sleep(300)
    const heap = await ev(`performance.memory ? performance.memory.usedJSHeapSize : null`)
    const frameMs = await bench(60)
    if (name === 'parts.glb' || isStep) {
      const on = []
      const off = []
      for (let r = 0; r < 5; r++) { // alternate, so that a slow moment hits both
        const a = await benchView(60, false)
        const b = await benchView(60, true)
        off.push(a.ms)
        on.push(b.ms)
        if (r === 0) console.log(`  the cube was painted ${b.paints} of 60 frames with it on and ${a.paints} with it off`)
      }
      metrics[name + ' (view)'] = { frameWithCubeMs: Number(median(on).toFixed(2)), frameWithoutCubeMs: Number(median(off).toFixed(2)), cubeCostMs: Number((median(on) - median(off)).toFixed(2)), renderOnlyMs: Number(frameMs.toFixed(2)) }
      console.log(name + ' (view)', JSON.stringify(metrics[name + ' (view)']))
      check(metrics[name + ' (view)'].cubeCostMs <= 1, `the cube and the numbers of the view cost ${metrics[name + ' (view)'].cubeCostMs} ms of JavaScript per frame (limit 1 ms; the GPU work of compositing the small canvas is not measured here)`)
    }
    metrics[name] = { loadMs: median(loads.filter((v) => v !== null)), frameMs: Number(frameMs.toFixed(2)), heapMB: heap ? Number((heap / 1048576).toFixed(1)) : null }
    writeFileSync(join(outDir, `${name}.png`), Buffer.from(await pngOf(), 'base64'))
    if (name === 'parts.glb' || isStep) {
      await preset('product_white')
      await sleep(300)
      writeFileSync(join(outDir, `${name}.studio.png`), Buffer.from(await pngOf(), 'base64'))
      await preset('studio_dark')
      await sleep(300)
      writeFileSync(join(outDir, `${name}.studio-dark.png`), Buffer.from(await pngOf(), 'base64'))
      metrics[name].frameStudioMs = Number((await bench(60)).toFixed(2))
      await preset('original')
    }
    console.log(name, JSON.stringify(metrics[name]))
  }
  // a large mesh for the frame time
  const { writeGLB } = await import('../editor/shared/export.js')
  if (!isStep) {
    const nu = 1100, nv = 550
    const P = new Float32Array((nu + 1) * (nv + 1) * 3)
    const N = new Float32Array(P.length)
    let k = 0
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
      const t = (Math.PI * j) / nv, p = (2 * Math.PI * i) / nu
      const x = Math.sin(t) * Math.cos(p), y = Math.cos(t), z = Math.sin(t) * Math.sin(p)
      N[k] = x, N[k + 1] = y, N[k + 2] = z
      P[k++] = x, P[k++] = y, P[k++] = z
    }
    const I = new Uint32Array(nu * nv * 6)
    let q = 0
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i, b = a + nu + 1
      I.set([a, a + 1, b, a + 1, b + 1, b], q)
      q += 6
    }
    const big = join(samples, 'big.glb')
    writeFileSync(big, writeGLB([{ name: 'ball', kind: 'mesh', positions: P, normals: N, indices: I, colors: null, color: [200, 50, 50] }]))
    await open(big)
    metrics['big-1.2M-tris.glb'] = { loadMs: await loadMs(), frameMs: Number((await bench(60)).toFixed(2)), heapMB: Number(((await ev(`performance.memory.usedJSHeapSize`)) / 1048576).toFixed(1)) }
    console.log('big', JSON.stringify(metrics['big-1.2M-tris.glb']))
  }
  writeFileSync(join(outDir, 'metrics.json'), JSON.stringify(metrics, null, 1))
} catch (e) {
  console.error('ERROR', e.message)
  failures++
} finally {
  chrome.kill()
  server.kill()
  await sleep(500)
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
}
process.exit(failures ? 1 : 0)

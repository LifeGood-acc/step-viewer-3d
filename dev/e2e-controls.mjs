#!/usr/bin/env node
// End-to-end test of the switch state (controls-core.js, prefs-core.js): a switch that cannot work says why, "Reset all" really resets, the stored
// record has its version. Headless Chrome through the plugin's harness. Works in both viewers.   node dev/e2e-controls.mjs
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
  '--headless=new', `--remote-debugging-port=${chromePort}`, '--use-angle=metal', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--no-first-run',
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

const press = (id) => ev(`document.getElementById(${JSON.stringify(id)}).click()`)
const pressed = (id) => ev(`document.getElementById(${JSON.stringify(id)}).getAttribute('aria-pressed')`)
const setShading = (v) => ev(`(() => { const s = document.getElementById('shading'); s.value = ${JSON.stringify(v)}; s.dispatchEvent(new Event('change', { bubbles: true })) })()`)
try {
  let tries = 0
  let targets
  while (tries++ < 50) {
    targets = await fetch(`http://127.0.0.1:${chromePort}/json`).then((r) => r.json()).catch(() => null)
    if (targets) break
    await sleep(200)
  }
  ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl)
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.method === 'Runtime.exceptionThrown') console.error('PAGE ERROR', d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text); if (d.id && pend.has(d.id)) { pend.get(d.id)({ result: d.result, error: d.error }); pend.delete(d.id) } }
  await new Promise((r) => (ws.onopen = r))
  await send('Page.enable')
  await send('Runtime.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 800, deviceScaleFactor: 1, mobile: false })
  await open(modelFile)
  const stored = () => ev(`JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => /\\.v2$/.test(k))) || '{}')`)
  const tint = () => ev(`(() => { const b = document.getElementById('l-color'); return { disabled: b.disabled, title: b.title } })()`)
  // colour per part works in Original only; elsewhere it is off and says why
  let c = await tint()
  check(c.disabled === false, 'Original: colour per part works')
  for (const sh of ['solid', 'normals', 'xray', 'matcap', 'flat', 'vertex']) {
    await setShading(sh)
    c = await tint()
    check(c.disabled === true && /Original/.test(c.title), `${sh}: colour per part is off and the tooltip names the look that shows it ("${c.title.slice(0, 50)}")`)
  }
  await setShading('original')
  check((await tint()).disabled === false, 'back in Original: colour per part works again')
  // the stored record has its version and the new background key
  const rec = await stored()
  check(rec.v === 3 && rec.bgm && rec.bgm.mode === 'look', `the stored record is migrated (${JSON.stringify(rec).slice(0, 80)})`)
  // change many switches, then "Reset all": they all go back (before: wire, grid, back, box stayed)
  await press('b-wire')
  await press('b-grid')
  await press('b-box')
  await press('b-back')
  await setShading('xray')
  await ev(`(() => { const s = document.getElementById('st-bgmode'); s.value = 'dark'; s.dispatchEvent(new Event('change', { bubbles: true })) })()`)
  check((await pressed('b-grid')) === 'false' && (await pressed('b-box')) === 'true' && (await pressed('b-back')) === 'false', 'switches changed')
  check((await stored()).bgm.mode !== 'look' && ['light', 'dark'].includes((await stored()).bg), 'the background button writes the new key and the old one')
  await press('b-resetprefs')
  await sleep(300)
  const after = await ev(`({ grid: document.getElementById('b-grid').getAttribute('aria-pressed'), box: document.getElementById('b-box').getAttribute('aria-pressed'), back: document.getElementById('b-back').getAttribute('aria-pressed'), axes: document.getElementById('b-axes').getAttribute('aria-pressed'), wire: document.getElementById('b-wire').textContent, shading: document.getElementById('shading').value, bg: document.getElementById('b-bg').textContent })`)
  check(after.grid === 'true' && after.box === 'false' && after.back === 'true' && after.axes === 'true', `reset: grid, box, back, axes are the standard (${JSON.stringify(after)})`)
  check(after.shading === 'original' && after.wire === 'Surface', 'reset: shading Original and Surface')
  check(!/light|dark|Hell|Dunkel/.test(after.bg) || /Orca|look|Look/.test(after.bg), `reset: the background is "like the look" again (${after.bg})`)
  const rec2 = await stored()
  check(rec2.v === 3 && rec2.bgm.mode === 'look' && rec2.bg === undefined, 'reset: the stored record is the standard one')
  console.log(failures ? `\n${failures} check(s) failed` : `\nall ${results.length} checks passed`)
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

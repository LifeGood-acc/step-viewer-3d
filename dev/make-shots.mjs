#!/usr/bin/env node
// Makes the store screenshots in docs/images (1280 x 800, and 420 wide for the narrow one) from the plugin's own sample files, in headless Chrome
// through the harness. Works in both viewers.   node dev/make-shots.mjs [out-dir]
import { spawn, execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync, existsSync, mkdirSync } from 'node:fs'
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

const out = process.argv[2] || join(plugin, 'docs', 'images')
const press = (id) => ev(`document.getElementById(${JSON.stringify(id)}).click()`)
const size = (w, h) => send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false })
const shot = async (name) => {
  await sleep(500)
  const r = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(out, name), Buffer.from(r.result.data, 'base64'))
  console.log('wrote', name)
}
const clickRow = (sel) => ev(`document.querySelector(${JSON.stringify(sel)}).dispatchEvent(new MouseEvent('click', { bubbles: true }))`)
const tab = (id) => ev(`document.querySelector('#side-tabs [id$="-${id}"]').click()`)
const files = isStep ? { main: modelFile } : { main: join(samples, 'parts.glb'), cloud: join(samples, 'cloud.ply'), mf: join(samples, 'parts.3mf'), tex: join(samples, 'textured.glb') }
try {
  let tries = 0, targets
  while (tries++ < 50) { targets = await fetch(`http://127.0.0.1:${chromePort}/json`).then((r) => r.json()).catch(() => null); if (targets) break; await sleep(200) }
  ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl)
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)({ result: d.result, error: d.error }); pend.delete(d.id) } }
  await new Promise((r) => (ws.onopen = r))
  await send('Page.enable'); await send('Runtime.enable')
  mkdirSync(out, { recursive: true })
  await size(1280, 800)
  // the start page
  await send('Page.navigate', { url: `http://127.0.0.1:${port}/h/index.html?lang=en` })
  await sleep(1200)
  await shot('start.png')
  // parts with the part card
  await open(files.main)
  const leaf = isStep ? await ev(`window.__h.rows.findIndex((r) => r.meshes.length === 1)`) : 3
  await clickRow(`.part[data-i="${leaf}"]`)
  await press('b-measure'); await press('b-measure') // nothing: keeps the view plain
  await shot('parts-light.png')
  await size(1600, 1000)
  await shot('cover.png')
  await size(1280, 800)
  // the menus of the toolbar
  await press('b-view'); await shot('view-menu.png'); await ev(`document.body.click()`)
  await press('b-look'); await shot('look-menu.png'); await ev(`document.body.click()`)
  await press('b-more'); await shot('more-menu.png'); await ev(`document.body.click()`)
  // the Info tab
  await tab('info')
  await shot('info.png')
  // the Edit card (unfolded; the part card is closed so that the card is in sight)
  await press('b-sel-clear')
  await press('b-card-edit')
  await ev(`document.getElementById('b-card-edit').scrollIntoView({ block: 'start' })`)
  await shot('tools.png')
  await press('b-card-edit')
  await clickRow(`.part[data-i="${leaf}"]`)
  // the export dialog with a finished copy
  await press('b-export')
  await ev(`document.querySelector('#export-kind [data-kind="model"]').click()`)
  await press('b-ex-make')
  await waitFor(`!document.getElementById('b-ex-save').disabled`, 60000, 'the copy')
  await shot('export.png')
  await press('b-ex-close2')
  // narrow (before any look is switched on: a switched-on Studio button is not legible on the light toolbar)
  await size(420, 800)
  await sleep(400)
  await press('b-panel') // the sidebar is a sheet under the view in a narrow tab
  await tab('parts')
  await ev(`document.querySelectorAll('*').forEach((e) => { if (e.scrollTop > 0 && e !== document.scrollingElement) e.scrollTop = 0 })`) // the sheet starts at its top
  await shot('narrow.png')
  await press('b-panel')
  await size(1280, 800)
  // the studio menu, on the dark theme (there the switched-on button reads well), with a part selected
  await send('Page.navigate', { url: `http://127.0.0.1:${port}/h/index.html?file=${encodeURIComponent(files.main)}&lang=en&theme=dark` })
  await waitFor(`document.documentElement.dataset.state === 'ok'`, 90000, 'the model (dark)')
  await clickRow(`.part[data-i="${leaf}"]`)
  await press('b-studio')
  await ev(`document.querySelector('#st-tiles [data-preset="product_white"]').click()`)
  await shot('studio-menu.png')
  // back to the original look, so that no later picture carries it (the look is remembered between page loads)
  await ev(`document.querySelector('#st-tiles [data-preset="original"]').click()`)
  await ev(`document.body.click()`)
  if (isStep) {
    await size(1280, 800)
    // dark: the info tab with the mesh quality and the numbers; the mesh; the German interface
    await send('Page.navigate', { url: `http://127.0.0.1:${port}/h/index.html?file=${encodeURIComponent(files.main)}&lang=en&theme=dark` })
    await waitFor(`document.documentElement.dataset.state === 'ok'`, 90000, 'the assembly (dark)')
    await tab('info')
    await shot('info-dark.png')
    await press('b-wire')
    await tab('parts')
    await shot('mesh-dark.png')
    await send('Page.navigate', { url: `http://127.0.0.1:${port}/h/index.html?file=${encodeURIComponent(files.main)}&lang=de` })
    await waitFor(`document.documentElement.dataset.state === 'ok'`, 90000, 'the assembly (German)')
    await shot('german.png')
  }
  if (!isStep) {
    await size(1280, 800)
    await send('Page.navigate', { url: `http://127.0.0.1:${port}/h/index.html?file=${encodeURIComponent(files.cloud)}&lang=en&theme=dark` })
    await waitFor(`document.documentElement.dataset.state === 'ok'`, 60000, 'the cloud')
    await shot('cloud-dark.png')
    await open(files.mf, '')
    await tab('cut')
    await ev(`(() => { const a = document.getElementById('sec-axis'); a.value = 'y'; a.dispatchEvent(new Event('change', { bubbles: true })) })()`)
    await shot('section-3mf.png')
    await send('Page.navigate', { url: `http://127.0.0.1:${port}/h/index.html?file=${encodeURIComponent(files.tex)}&lang=de` })
    await waitFor(`document.documentElement.dataset.state === 'ok'`, 60000, 'the textured model')
    await shot('textured.png')
  }
} catch (e) { console.error('ERROR', e.message); failures++ } finally { chrome.kill(); server.kill(); await sleep(500); rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }) }
process.exit(failures ? 1 : 0)

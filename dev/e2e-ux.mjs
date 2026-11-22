#!/usr/bin/env node
// End-to-end test of the toolbar buttons that must say what they do (surface | mesh, texture, background, the view menu), on the real canvas
// pixels, in headless Chrome through the plugin's harness. Works in both viewers.   node dev/e2e-ux.mjs
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
  modelFile = join(samples, 'bracket.stl')
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
const text = (id) => ev(`document.getElementById(${JSON.stringify(id)}).textContent`)
const attr = (id, a) => ev(`document.getElementById(${JSON.stringify(id)}).getAttribute(${JSON.stringify(a)})`)
const shade = (v) => setCtl('shading', v)
const cam = () => ev(`(() => { const { camera, controls } = window.__h; return { p: camera.position.toArray(), t: controls.target.toArray() } })()`)
const dist = (c) => Math.hypot(...c.p.map((v, i) => v - c.t[i]))
const key = (k, extra = '') => ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, bubbles: true${extra} }))`)
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
  await send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 700, deviceScaleFactor: 1, mobile: false })
  await open(modelFile)
  for (const g of ['b-grid', 'b-axes']) await ev(`document.getElementById('${g}').getAttribute('aria-pressed') === 'true' && document.getElementById('${g}').click()`)

  // ----- Surface | Mesh: one button, its label is the state, its tooltip names what a click does
  check(await text('b-wire') === 'Surface' && await attr('b-wire', 'aria-pressed') === 'false' && /mesh/i.test(await ev(`document.getElementById('b-wire').title`)), 'surface/mesh: the button reads "Surface" and its tooltip offers the mesh')
  await snap('surface')
  await press('b-wire')
  check(await text('b-wire') === 'Mesh' && await attr('b-wire', 'aria-pressed') === 'true' && /surface/i.test(await ev(`document.getElementById('b-wire').title`)), 'surface/mesh: after a click it reads "Mesh" and its tooltip offers the surface')
  await snap('mesh')
  check((await diff('surface', 'mesh', 20)).n > 300, 'surface/mesh: the picture changes')
  await key('w')
  check(await text('b-wire') === 'Surface', 'surface/mesh: the key W switches back')
  await key('w')
  // the mesh shows in every look, matcap included (a matcap material has no wireframe property of its own)
  for (const look of ['original', 'solid', 'normals', 'xray', 'matcap', 'flat']) {
    await shade(look)
    await press('b-wire') // surface
    await snap('s-' + look)
    await press('b-wire') // mesh
    await snap('m-' + look)
    const d = await diff('s-' + look, 'm-' + look, 20)
    check(d.n > 200, `mesh in the look "${look}": ${d.n} pixels change`)
    await press('b-wire') // back to surface for the next look... then mesh again below
    await press('b-wire')
  }
  await shade('original')
  if (await attr('b-wire', 'aria-pressed') === 'true') await press('b-wire')

  // ----- the view menu: every view fits the whole model from wherever the camera is
  const start = await cam()
  await ev(`(() => { const { camera, controls } = window.__h; camera.position.multiplyScalar(0.3); controls.target.set(3, 2, 1); controls.update() })()`)
  await setCtl('preset', 'iso')
  const iso = await cam()
  check(Math.max(...iso.p.map((v, i) => Math.abs(v - start.p[i]))) < 1e-6 * Math.max(1, dist(start)) && Math.max(...iso.t.map((v, i) => Math.abs(v - start.t[i]))) < 1e-9, 'view menu: "Isometric" fits the model again (same camera as at the start)')
  await ev(`(() => { const { camera, controls } = window.__h; camera.position.multiplyScalar(3); controls.target.set(-2, 0, 4); controls.update() })()`)
  await setCtl('preset', 'front')
  const front = await cam()
  check(Math.abs(dist(front) - dist(start)) < 1e-6 * dist(start) && Math.abs(front.p[0] - front.t[0]) < 1e-9 * dist(start), 'view menu: "Front" has the fitting distance and looks at the middle of the model')
  await key('8')
  const hero = await cam()
  check(dist(hero) < dist(front) && hero.t.every((v, i) => Math.abs(v - front.t[i]) < 1e-9), 'key 8 (hero) is a little closer and looks at the same point')
  await ev(`(() => { const { camera, controls } = window.__h; camera.position.multiplyScalar(2); controls.target.set(1, 1, 1); controls.update() })()`)
  await setCtl('preset', 'all')
  const all = await cam()
  check(Math.max(...all.p.map((v, i) => Math.abs(v - start.p[i]))) < 1e-6 * dist(start), 'view menu: "Show all" is the start view')
  check(await ev(`!document.getElementById('b-reset')`), 'there is no separate "View" button any more')
  await ev(`(() => { const { camera, controls } = window.__h; camera.position.multiplyScalar(2); controls.target.set(1, 1, 1); controls.update() })()`)
  await key('r')
  check(Math.max(...(await cam()).p.map((v, i) => Math.abs(v - start.p[i]))) < 1e-6 * dist(start), 'key R shows everything')

  // ----- the background: a list of seven that always works (in every look and shading), and key B steps through it
  const bg = async () => (await corners()).tl.slice(0, 3).join(',')
  const setBg = (m) => ev(`(() => { const s = document.getElementById('st-bgmode'); s.value = ${JSON.stringify(m)}; s.dispatchEvent(new Event('change', { bubbles: true })) })()`)
  const bgMode = () => ev(`document.getElementById('st-bgmode').value`)
  const setShading = (v) => ev(`(() => { const s = document.getElementById('shading'); s.value = ${JSON.stringify(v)}; s.dispatchEvent(new Event('change', { bubbles: true })) })()`)
  const b0 = await bg()
  check((await bgMode()) === 'look' && b0 === '236,238,241', `background: "like the look" with no look is like Orca (${b0})`)
  await setBg('dark')
  check((await bg()) === '21,23,26', `background: dark (${await bg()})`)
  await setBg('white')
  check((await bg()) === '255,255,255', 'background: white')
  await setBg('light')
  check((await bg()) === '236,238,241', 'background: light')
  await setBg('dark')
  await setShading('xray')
  check((await bg()) === '21,23,26', 'background: dark in the X-ray look too (always works)')
  await setShading('original')
  await setBg('transparent')
  check(await ev(`window.__h.scene.background === null && document.querySelector('canvas').classList.contains('studio-clear')`), 'background: transparent (the checker pattern shows)')
  await setBg('look')
  await key('b')
  check((await bgMode()) === 'orca', `key B: the next background is "like Orca" (${await bgMode()})`)
  check(/Background: Like Orca/.test(await ev(`document.getElementById('msg-text').textContent`)), 'key B names the new background')
  await setBg('look')
  await preset('product_white')
  check((await bg()) === '255,255,255' && /Studio on/.test(await ev(`document.getElementById('b-studio').textContent`)), `background: with a look the look's own white shows, the button says "Studio on" (${await bg()})`)
  await setBg('dark')
  check((await bg()) === '21,23,26', 'background: a chosen dark stands before the look')
  await preset('gradient_grey')
  check((await bgMode()) === 'look', 'background: choosing another look shows the look\'s own background again')
  await ev(`document.getElementById('st-reset').click()`)
  await setBg('look')

  // an older saved choice is read: "dark" from an old record is the dark mode
  const prefKey = `${isStep ? 'step-viewer-3d' : 'model-viewer-3d'}.v2`
  await ev(`localStorage.setItem(${JSON.stringify(prefKey)}, JSON.stringify({ bg: 'dark' }))`)
  await open(modelFile)
  check((await bg()) === '21,23,26' && (await bgMode()) === 'dark', `background: an old saved "dark" is read (${await bg()})`)
  await preset('product_white')
  check((await bg()) === '255,255,255', `background: a studio look chosen after an old "dark" shows its own white (${await bg()})`)
  await ev(`localStorage.removeItem(${JSON.stringify(prefKey)})`)
  await open(modelFile)

  // ----- Close: a question first (Escape and Cancel keep everything, Close empties), then the start page
  const dialog = () => ev(`(() => { const d = document.getElementById('confirm'); return d ? { role: d.getAttribute('role'), focus: document.activeElement.textContent, text: d.querySelector('p').textContent, danger: !!d.querySelector('button.danger') } : null })()`)
  const keyOnFocus = (k) => ev(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, bubbles: true, cancelable: true }))`)
  const partsNow = () => ev(`window.__h.parts.length`)
  await open(modelFile)
  const n0 = await partsNow()
  await snap('before-close') // a frame is drawn, so the geometry is on the GPU
  const geoBefore = await ev(`window.__h.renderer.info.memory.geometries`)
  await press('b-close')
  const d1 = await dialog()
  check(d1 && d1.role === 'alertdialog' && d1.danger && d1.focus === 'Cancel', `close: a question appears with the focus on "Cancel" (${JSON.stringify(d1 && { role: d1.role, focus: d1.focus })})`)
  check(/file itself stays/i.test(d1.text) && !/not exported/i.test(d1.text), 'close: with nothing changed the text is the short one')
  await key('w') // a shortcut must not reach the page behind the question
  check(await text('b-wire') === 'Surface', 'close: no shortcut works while the question is open')
  await keyOnFocus('Escape')
  check(await dialog() === null && await partsNow() === n0 && await ev(`document.documentElement.dataset.state`) === 'ok', 'close: Escape cancels, the model stays')
  await press('b-close')
  await keyOnFocus('Enter') // (a synthetic key press does not press the button: what matters is that Enter alone never confirms)
  check(await dialog() !== null && await partsNow() === n0 && (await dialog()).focus === 'Cancel', 'close: Enter alone never closes the model (the focus is on "Cancel")')
  await ev(`document.querySelector('#confirm button:not(.danger)').click()`)
  check(await dialog() === null && await partsNow() === n0 && await ev(`!document.getElementById('b-close').disabled`), 'close: the Cancel button keeps everything')
  await press('b-close')
  await keyOnFocus('Tab')
  check((await dialog()).focus !== 'Cancel', 'close: Tab moves the focus inside the question')
  await keyOnFocus('Escape')
  // with a section set the text warns
  await setCtl('sec-axis', 'x')
  await press('b-close')
  check(/not exported|nicht exportierte/i.test((await dialog()).text), 'close: with a section active the text names what is lost')
  await ev(`document.querySelector('#confirm button.danger').click()`)
  await waitFor(`document.documentElement.dataset.state === 'start'`, 10000, 'the start page after closing')
  check(await partsNow() === 0 && await ev(`!document.getElementById('drop').hidden && document.getElementById('b-close').disabled && !document.body.classList.contains('has-model')`), 'close: "Close" empties the scene and shows the start page')
  const geoAfter = await ev(`window.__h.renderer.info.memory.geometries`)
  check(geoAfter < geoBefore && geoAfter <= 3, `close: the GPU geometry is freed (${geoBefore} -> ${geoAfter}: parts, grid, axes and box are gone)`)
  check(await ev(`document.getElementById('sec-axis').value === ''`), 'close: the section is off again')
  await open(modelFile)
  check(await partsNow() === n0, 'close: another model loads after closing')

  // ----- the texture button only where it works
  if (!isStep) {
    check(await ev(`document.getElementById('b-tex').hidden`), 'texture: no button for a model without textures')
    await open(join(samples, 'textured.glb'))
    check(await ev(`!document.getElementById('b-tex').hidden && !document.getElementById('b-tex').disabled`), 'texture: a textured model shows the button, on in the Original look')
    await snap('tex-on')
    await press('b-tex')
    await snap('tex-off')
    check((await diff('tex-on', 'tex-off', 20)).n > 300, 'texture: the button changes the picture in the Original look')
    await press('b-tex')
    await shade('normals')
    check(await ev(`document.getElementById('b-tex').disabled && /Original and Flat/.test(document.getElementById('b-tex').title)`), 'texture: in the Normals look the button is off and says why')
    await shade('flat')
    check(await ev(`!document.getElementById('b-tex').disabled`), 'texture: it is on again in the Flat look')
    await key('t')
    check(await attr('b-tex', 'aria-pressed') === 'false', 'texture: key T works while it is on')
    await shade('matcap')
    await key('t')
    check(await attr('b-tex', 'aria-pressed') === 'false', 'texture: key T does nothing while the button is off')
    await open(join(samples, 'cloud.ply'))
    check(await ev(`document.getElementById('b-wire').hidden`), 'surface/mesh: no such button for a point cloud')
  }
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

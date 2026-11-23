#!/usr/bin/env node
// End-to-end test of the numbers of the view (UX v3, E4) in headless Chrome through the plugin's harness: the orientation cube (its own canvas, a click on a face sets the view, no
// selection and no measuring point), the scale bar (1-2-5 series, true in the plane of the target, measured against a real projection), the zoom in percent, the grid step and the numbers of
// the status bar (each with its origin, in the narrow window only the triangles), and the PNG export without the cube.   node dev/e2e-view.mjs
import { spawn, execFileSync } from 'node:child_process'
import { mkdtempSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const plugin = join(here, '..')
const isStep = existsSync(join(plugin, 'samples', 'assembly.step'))
const dir = mkdtempSync(join(tmpdir(), 'view-e2e-'))
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
let total = 0
const check = (ok, what) => {
  total++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`)
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
  await sleep(400)
}
const setWidth = async (w, h = 800) => {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false })
  await sleep(300)
}
const render = () => ev(`(() => { window.__h.controls.dispatchEvent({ type: 'change' }); return true })()`).then(() => sleep(200))
const press = (i) => ev(`document.getElementById(${JSON.stringify(i)}).click()`)
// a real mouse click at a page position (it goes through the browser's hit test, like a person's click)
const mouseClick = async (x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
  await sleep(250)
}
// the direction from the target to the camera, as a unit vector
const direction = () => ev(`(() => { const { camera, controls } = window.__h; const d = camera.position.clone().sub(controls.target).normalize(); return d.toArray() })()`)
const setDirection = (d, dist = null) => ev(`(() => { const { camera, controls } = window.__h; const cur = camera.position.distanceTo(controls.target); const v = camera.position.clone().sub(controls.target).set(...${JSON.stringify(d)}).normalize().multiplyScalar(${dist === null ? 'cur' : dist}); camera.position.copy(controls.target).add(v); controls.update(); controls.dispatchEvent({ type: 'change' }); return true })()`).then(() => sleep(250))
const cubeFaces = () => ev(`(() => { const c = window.__h.chrome.view.cube; const r = c.el.querySelector('canvas').getBoundingClientRect(); return { rect: [r.left, r.top, r.width, r.height], faces: c.faces().map((f) => ({ name: f.name, facing: f.facing, center: f.center })) } })()`)
const clickFace = async (name) => {
  const { rect, faces } = await cubeFaces()
  const f = faces.find((x) => x.name === name)
  if (!f) throw new Error(`face ${name} is not drawn`)
  await mouseClick(rect[0] + (f.center[0] / 96) * rect[2], rect[1] + (f.center[1] / 96) * rect[3])
}
const PRESET_DIR = { top: [0, 1, 0.0001], bottom: [0, -1, 0.0001], front: [0, 0, 1], back: [0, 0, -1], left: [-1, 0, 0], right: [1, 0, 0] }
const norm = (v) => { const l = Math.hypot(...v); return v.map((c) => c / l) }
const near = (a, b, eps = 1e-3) => a.every((c, i) => Math.abs(c - b[i]) < eps)
const status = () => ev(`(() => { const s = document.getElementById('status'); const slot = document.getElementById('status-slot'); const z = document.getElementById('status-zoom'); return { text: slot.textContent.replace(/\\s+/g, ' ').trim(), items: [...slot.querySelectorAll('.st-item')].map((i) => ({ cls: i.className, text: i.textContent.replace(/^·\\s*/, ''), shown: i.getClientRects().length > 0, srcs: [...i.querySelectorAll('[data-src]')].map((e) => e.dataset.src) })), zoom: z.hidden ? null : z.textContent, zoomSrc: z.querySelector('[data-src]') && z.querySelector('[data-src]').dataset.src, honest: s.dataset.honest } })()`)
const scaleInfo = () => ev(`(() => { const b = document.getElementById('scalebar'); if (b.hidden) return null; const l = b.querySelector('.sb-line').getBoundingClientRect(); const lab = b.querySelector('.sb-label'); const m = /^([\\d.,]+)\\s*(\\S+)/.exec(lab.textContent.trim()); return { px: l.width, text: lab.textContent.trim(), value: m ? Number(m[1].replace(/,/g, '')) : NaN, unit: m ? m[2] : '', src: lab.querySelector('[data-src]') && lab.querySelector('[data-src]').dataset.src, title: b.title, honest: b.dataset.honest } })()`)
// the pixels a real perspective projection gives for a length L lying in the plane of the target (the camera's right axis), measured in CSS pixels of the view
const projected = (L, depthFactor = 1) => ev(`(async () => { const THREE = await import('three'); const { camera, controls, renderer } = window.__h; camera.updateMatrixWorld(); const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0); const toTarget = controls.target.clone().sub(camera.position); const centre = camera.position.clone().addScaledVector(toTarget, ${depthFactor}); const a = centre.clone().addScaledVector(right, -${L} / 2); const b = centre.clone().addScaledVector(right, ${L} / 2); const h = renderer.domElement.clientHeight; const w = renderer.domElement.clientWidth; const pa = a.project(camera); const pb = b.project(camera); return Math.hypot((pb.x - pa.x) * w / 2, (pb.y - pa.y) * h / 2) })()`)
try {
  let tries = 0
  let targets
  while (tries++ < 50) {
    targets = await fetch(`http://127.0.0.1:${chromePort}/json`).then((r) => r.json()).catch(() => null)
    if (targets) break
    await sleep(200)
  }
  ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl)
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.method === 'Runtime.exceptionThrown' && !/setPointerCapture/.test(JSON.stringify(d.params))) console.error('PAGE ERROR', d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text); if (d.id && pend.has(d.id)) { pend.get(d.id)({ result: d.result, error: d.error }); pend.delete(d.id) } }
  await new Promise((r) => (ws.onopen = r))
  await send('Page.enable')
  await send('Runtime.enable')
  await setWidth(1400)

  // ----- nothing without a model
  await send('Page.navigate', { url: `http://127.0.0.1:${port}/h/index.html?nodoc=1&lang=en` })
  await sleep(1500)
  check(await ev(`document.getElementById('viewcube').hidden && document.getElementById('scalebar').hidden && document.getElementById('status-zoom').hidden && document.getElementById('status-slot').children.length === 0`), 'no model: no cube, no scale bar, no zoom and no number in the status bar')

  await open(modelFile)
  const nParts = await ev(`window.__h.parts.length`)
  const nTris = await ev(`window.__h.parts.reduce((a, p) => a + (p.kind === undefined || p.kind === 'mesh' ? p.tris : 0), 0)`)

  // ----- the version of the plugin, small in the status bar: the manifest's (editor/version.js is tested against it), with its origin
  const manifest = JSON.parse(readFileSync(join(plugin, 'orca-plugin.json'), 'utf8'))
  const ver = await ev(`(() => { const v = document.getElementById('status-version'); const r = v.getBoundingClientRect(); return { text: v.textContent, src: v.dataset.src, shown: !v.hidden && r.width > 0, small: parseFloat(getComputedStyle(v).fontSize) <= 12, inBar: !!v.closest('#status'), title: v.title } })()`)
  check(ver.text === `v${manifest.version}` && ver.src === 'manifest' && ver.shown && ver.small && ver.inBar && ver.title.length > 0, `the status bar shows the plugin version "${ver.text}" (manifest ${manifest.version}) small, with the origin "${ver.src}"`)
  // ----- the cube: its own canvas, drawn from a copy of the camera's orientation
  const cube = await ev(`(() => { const c = document.getElementById('viewcube'); const cv = c.querySelector('canvas'); const main = window.__h.renderer.domElement; return { shown: !c.hidden && c.getClientRects().length > 0, role: c.getAttribute('role'), label: !!c.getAttribute('aria-label'), own: cv !== main && !main.contains(cv) && cv.tagName === 'CANVAS', buttons: [...c.querySelectorAll('button')].map((b) => b.dataset.face + ':' + b.textContent), tabs: [...c.querySelectorAll('button')].filter((b) => b.tabIndex === 0).length, inStage: !!c.closest('#stage'), w: cv.getBoundingClientRect().width } })()`)
  check(cube.shown && cube.role === 'group' && cube.label && cube.own && cube.inStage, 'the cube is a group with a name and a canvas of its own in the view (not the main renderer)')
  check(cube.buttons.length === 6 && cube.tabs === 1, `six faces for the keyboard, one tab stop (${cube.buttons.join(' ')})`)
  check((await cubeFaces()).faces.length === 3, 'from the start view three faces are seen')
  check(await ev(`window.__h.scene.children.every((c) => !(c.name || '').match(/cube/i))`), 'the cube is not in the main scene')

  // ----- a click on a face sets the view (the six names of the View menu); it selects nothing and sets no measuring point
  for (const name of ['top', 'bottom', 'front', 'back', 'left', 'right']) {
    // from a corner that sees this face
    const corner = { top: [0.3, 1, 0.4], bottom: [0.3, -1, 0.4], front: [0.3, 0.3, 1], back: [-0.3, 0.3, -1], left: [-1, 0.3, 0.3], right: [1, 0.3, 0.3] }[name] // a direction that sees this face well (the cube is tilted a little)
    await setDirection(corner)
    await clickFace(name)
    const d = await direction()
    check(near(d, norm(PRESET_DIR[name])), `a click on the face "${name}" looks from there (${d.map((v) => v.toFixed(3))})`)
  }
  // the cube sits over the model: a click on it does not select the part below, does not add a measuring point, and the camera does not orbit
  await setDirection([0.3, 0.3, 1])
  await press('b-measure')
  await sleep(200)
  await ev(`(() => { const c = document.getElementById('viewcube'); c.style.left = '45%'; c.style.top = '40%'; })()`)
  await render()
  const before = await direction()
  const measured0 = await ev(`window.__h.measure.count()`)
  await clickFace('front')
  check((await ev(`window.__h.measure.count()`)) === measured0 && (await ev(`document.querySelectorAll('.part.sel').length`)) === 0, 'a click on the cube (over the model, measuring on) sets no measuring point and selects nothing')
  check(!near(await direction(), before, 1e-3), 'the click on the cube did set the view')
  await press('b-measure')
  await setDirection([0.3, 1, 0.4])
  await ev(`(() => { const c = document.getElementById('viewcube'); c.style.left = '45%'; c.style.top = '40%'; })()`)
  await render()
  await clickFace('top')
  check((await ev(`document.querySelectorAll('.part.sel').length`)) === 0 && (await ev(`document.getElementById('sel-chip').hidden`)), 'a click on the cube (measuring off) selects no part and shows no chip')
  await ev(`(() => { const c = document.getElementById('viewcube'); c.style.left = ''; c.style.top = ''; })()`)
  // the main view is not changed by moving over the cube
  await setDirection([1, 1, 1])
  // keyboard
  await ev(`document.querySelector('#viewcube button[tabindex="0"]').focus()`)
  await ev(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }))`)
  const second = await ev(`document.activeElement.dataset.face`)
  check(second === 'bottom', `the arrow key moves to the next face (${second})`)
  await ev(`document.querySelector('#viewcube button[data-face="left"]').click()`)
  await sleep(250)
  check(near(await direction(), norm(PRESET_DIR.left)), 'Enter or Space on a face button sets the view')
  check(await ev(`[...document.querySelectorAll('#viewcube button')].filter((b) => b.tabIndex === 0).length === 1`), 'the cube stays one tab stop')

  // ----- the scale bar: the 1-2-5 series, true in the plane of the target against a real projection
  await press('b-viewall')
  await sleep(300)
  const unit = await ev(`window.__h.chrome ? (document.getElementById('scalebar').querySelector('.sb-label').textContent.trim().split(/\\s+/)[1] || '') : ''`)
  for (const factor of [0.15, 0.5, 1, 2.5, 7]) {
    await setDirection([1, 0.6, 0.8], await ev(`(() => { const { camera, controls } = window.__h; return window.__fit || (window.__fit = camera.position.distanceTo(controls.target)) })()`) * factor)
    const s = await scaleInfo()
    const real = await projected(s.value)
    const mantissa = Number((s.value / 10 ** Math.floor(Math.log10(s.value))).toPrecision(6))
    check([1, 2, 5].includes(mantissa), `x${factor}: the bar is ${s.text} (1, 2 or 5 times a power of ten)`)
    check(Math.abs(s.px - real) <= 1.5 && s.px >= 40 && s.px <= 142, `x${factor}: the bar is ${s.px.toFixed(1)} px, a real projection of that length in the plane of the target is ${real.toFixed(1)} px`)
  }
  // out of that plane the same length looks different: the tooltip says "in the middle of the view"
  const s1 = await scaleInfo()
  const nearer = await projected(s1.value, 0.5)
  check(nearer > s1.px * 1.5 && /middle/i.test(s1.title), `the same length half-way to the camera is ${nearer.toFixed(0)} px (the bar is true in the target plane only); the tooltip says so ("${s1.title}")`)
  check(s1.src === 'derived' || s1.src === 'assumed', `the scale carries its origin ("${s1.src}")`)

  // ----- the zoom in percent: 100 % is "show all"
  await press('b-viewall')
  await sleep(300)
  let st = await status()
  check(st.zoom === 'Zoom 100 %' && st.zoomSrc === 'derived', `after "show all" the zoom is 100 % (${st.zoom})`)
  const dist = await ev(`(() => { const { camera, controls } = window.__h; return camera.position.distanceTo(controls.target) })()`)
  await setDirection(await direction(), dist / 2)
  st = await status()
  check(st.zoom === 'Zoom 200 %', `half the distance is 200 % (${st.zoom})`)
  await setDirection(await direction(), dist * 4)
  st = await status()
  check(st.zoom === 'Zoom 25 %', `four times the distance is 25 % (${st.zoom})`)
  await ev(`document.getElementById('status-zoom').click()`)
  await sleep(300)
  check((await status()).zoom === 'Zoom 100 %', 'a click on the zoom shows the whole model again')

  // ----- the status bar: every number with its origin, from the mesh and the camera
  st = await status()
  const trisItem = st.items.find((i) => /st-tris/.test(i.cls))
  check(trisItem && Number(trisItem.text.replace(/[^\d]/g, '')) === nTris && trisItem.srcs.join() === 'derived', `the triangles (${trisItem && trisItem.text}) are the triangles of the mesh (${nTris}), origin "derived"`)
  const partsItem = st.items.find((i) => /st-parts/.test(i.cls))
  check(partsItem && Number(partsItem.text.replace(/[^\d]/g, '')) === nParts && partsItem.srcs.join() === 'file', `the parts (${partsItem && partsItem.text}) are the ${nParts} parts of the file, origin "file"`)
  const gridItem = st.items.find((i) => /st-grid/.test(i.cls))
  const infoGrid = await ev(`(() => { const dt = [...document.querySelectorAll('#stats dt, #stats-more dt')].find((e) => /Grid|Raster/.test(e.textContent)); return dt ? dt.nextElementSibling.textContent : null })()`)
  check(gridItem && /^Grid /.test(gridItem.text) && infoGrid && gridItem.text.replace('Grid ', '').replace(/\s/g, '') === infoGrid.replace(/\s/g, ''), `the grid step (${gridItem && gridItem.text}) is the step of the grid drawn (Info card: ${infoGrid})`)
  check(st.honest === '1' && st.items.every((i) => i.srcs.length > 0 || /Grid off|assumed/i.test(i.text)), 'the status bar is in the honesty check and every number in it carries an origin')
  await press('b-grid')
  await sleep(300)
  check((await status()).text.includes('Grid off'), 'grid off: the status bar says "Grid off", not a step')
  await press('b-grid')
  await sleep(300)
  check(/Grid \d/.test((await status()).text), 'grid on: the step is back')
  // the unit: where the file does not name it the numbers say they are an assumption
  const assumed = await ev(`document.querySelector('#status-slot [data-src=assumed]') !== null`)
  const noteShown = await ev(`/assumed/i.test(document.getElementById('status-slot').textContent)`)
  check(assumed === noteShown, `an assumed unit is marked and said in the same bar (${assumed ? 'assumed here' : 'unit from the file here'})`)

  // ----- a narrow window: only the triangles and the zoom stay
  await setWidth(420)
  await render()
  st = await status()
  check(st.items.filter((i) => i.shown).length === 1 && /st-tris/.test(st.items.find((i) => i.shown).cls) && st.zoom, 'under 520 px only the triangles and the zoom are shown')
  check(await ev(`(() => { const s = document.getElementById('status'); const r = s.getBoundingClientRect(); return s.scrollWidth <= s.clientWidth + 1 && r.right <= window.innerWidth + 0.5 })()`), 'the status bar does not run over at 420 px')
  check(await ev(`(() => { const c = document.getElementById('viewcube').getBoundingClientRect(); const s = document.getElementById('stage').getBoundingClientRect(); return c.left >= s.left && c.right <= s.right && c.top >= s.top })()`), 'the cube is inside the view at 420 px')
  await setWidth(1400)
  await render()

  // ----- the corners of the view at every width: the cube, the scale bar and the chip of the selected part do not cover each other, the status bar does not run over
  await ev(`(() => { const r = [...document.querySelectorAll('#parts .part:not(.group)')][0]; r.dispatchEvent(new MouseEvent('click', { bubbles: true })) })()`)
  await sleep(300)
  for (const w of [420, 520, 600, 900, 1200, 1400]) {
    await setWidth(w)
    await render()
    const g = await ev(`(() => { const R = (id) => document.getElementById(id).getBoundingClientRect(); const st = R('stage'); const c = R('viewcube'); const b = R('scalebar'); const chip = document.getElementById('sel-chip'); const k = chip.hidden ? null : chip.getBoundingClientRect(); const s = document.getElementById('status'); const meas = document.getElementById('measure-bar'); const hit = (a, z) => !(a.right <= z.left || z.right <= a.left || a.bottom <= z.top || z.bottom <= a.top); return { inside: c.left >= st.left && c.top >= st.top && c.right <= st.right && b.right <= st.right && b.left >= st.left && b.bottom <= st.bottom, cubeChip: k ? hit(c, k) : false, barChip: k ? hit(b, k) : false, over: s.scrollWidth > s.clientWidth + 1, scalePx: b.width } })()`)
    check(g.inside && !g.cubeChip && !g.barChip && !g.over, `${w} px: the cube and the scale bar are inside the view and cover no chip, the status bar fits (${JSON.stringify(g)})`)
  }
  await setWidth(1400)
  await render()

  // ----- the measuring bar and the cube do not cover each other (measuring on, narrow windows: the bar wraps over the width of the view)
  await ev(`(() => { const r = document.querySelector('#parts .part:not(.group)'); r.dispatchEvent(new MouseEvent('click', { bubbles: true })) })()`) // the chip is on screen again
  await press('b-measure')
  for (const w of [420, 520, 600, 900]) {
    await setWidth(w)
    await render()
    const g = await ev(`(() => { const R = (e) => e.getBoundingClientRect(); const c = R(document.getElementById('viewcube')); const m = R(document.getElementById('measure-bar')); const b = R(document.getElementById('scalebar')); const hit = (a, z) => !(a.right <= z.left || z.right <= a.left || a.bottom <= z.top || z.bottom <= a.top); const el = document.elementFromPoint(m.left + 4, m.top + 4); return { cubeBar: hit(c, m), barBar: hit(b, m), top: el && el.className } })()`)
    check(!g.cubeBar && !g.barBar, `${w} px, measuring on: the measuring bar is not under the cube or the scale bar (${JSON.stringify(g)})`)
  }
  await press('b-measure')
  await setWidth(1400)
  await render()

  // ----- the keyboard focus on a face that is turned away is named under the cube (it is not drawn)
  await setDirection([0, 1, 0.0001])
  await ev(`document.querySelector('#viewcube button[data-face="bottom"]').focus()`)
  await sleep(100)
  check(await ev(`(() => { const f = document.querySelector('#viewcube .cube-focus'); return !f.hidden && f.textContent === 'Bottom' && f.getClientRects().length > 0 })()`), 'focus on a face turned away (Bottom, looking from above): its name stands under the cube')
  await ev(`document.activeElement.blur()`)
  check(await ev(`document.querySelector('#viewcube .cube-focus').hidden`), 'the name goes when the focus leaves the cube')

  // ----- the zoom without a number has no button; a theme change repaints the cube; a sharper screen makes a bigger canvas
  const hiddenZoom = await ev(`(() => { const { camera, controls } = window.__h; window.__h.chrome.view.frame({ matrix: camera.matrixWorld.elements, distance: 0, fov: 50, viewH: 700, fit: NaN, grid: { on: true, step: 10 } }); return document.getElementById('status-zoom').hidden })()`)
  check(hiddenZoom === true, 'no zoom number (distance or fit not usable): no button, no "null %"')
  await render()
  const cubeHash = () => ev(`(async () => { const u = new TextEncoder().encode(document.querySelector('#viewcube canvas').toDataURL()); const h = await crypto.subtle.digest('SHA-256', u); return [...new Uint8Array(h)].slice(0, 8).join('') })()`)
  const lightCube = await cubeHash()
  await ev(`(() => { document.documentElement.classList.toggle('dark'); document.documentElement.style.setProperty('--card', '#101114'); document.documentElement.style.setProperty('--fg', '#f0f0f0'); window.__h.chrome.view.redraw() })()`)
  check((await cubeHash()) !== lightCube, 'a new theme: the cube is painted again in the new colours')
  await ev(`(() => { document.documentElement.classList.toggle('dark'); document.documentElement.style.removeProperty('--card'); document.documentElement.style.removeProperty('--fg'); window.__h.chrome.view.redraw() })()`)
  await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 800, deviceScaleFactor: 2, mobile: false })
  await sleep(400)
  await render()
  check((await ev(`document.querySelector('#viewcube canvas').width`)) === 192, 'at a pixel ratio of 2 the cube canvas is 192 px wide (sharp)')
  await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 800, deviceScaleFactor: 1, mobile: false })
  await sleep(300)

  // ----- German
  await send('Page.navigate', { url: `http://127.0.0.1:${port}/h/index.html?file=${encodeURIComponent(modelFile)}&lang=de` })
  await sleep(300)
  await waitFor(`document.documentElement.dataset.state === 'ok'`, 90000, 'the model (de)')
  await sleep(500)
  st = await status()
  check(/Dreiecke/.test(st.text) && /Raster/.test(st.text) && /^Zoom \d+ %$/.test(st.zoom), `German: the status bar speaks German ("${st.text}", "${st.zoom}")`)
  check(/^[\d.,]+ /.test((await scaleInfo()).text) && (await ev(`document.getElementById('viewcube').querySelector('button[data-face="top"]').textContent`)) === 'Oben', 'German: the cube names its faces in German')

  // ----- the other kinds of file of the Model Viewer: a point cloud (points, no triangles), a toolpath (no parts of the viewer's own), an animation (the scale bar stays clear of the play bar)
  if (!isStep) {
    const openFile = async (name) => {
      await send('Page.navigate', { url: `http://127.0.0.1:${port}/h/index.html?file=${encodeURIComponent(join(samples, name))}&lang=en` })
      await sleep(300)
      await waitFor(`document.documentElement.dataset.state === 'ok'`, 90000, name)
      await sleep(600)
    }
    await openFile('cloud.ply')
    st = await status()
    check(/points/.test(st.text) && !/triangle/.test(st.text), `a point cloud: points, no triangles ("${st.text}")`)
    await openFile('print.gcode')
    st = await status()
    check(!/parts/.test(st.text) && st.items.every((i) => !/st-parts/.test(i.cls)), `a toolpath: no count of parts (the two parts are the viewer's own) ("${st.text}")`)
    await openFile('animated.glb')
    const g = await ev(`(() => { const R = (e) => e.getBoundingClientRect(); const p = document.querySelector('.playbar'); const b = R(document.getElementById('scalebar')); const c = R(document.getElementById('viewcube')); const hit = (a, z) => !(a.right <= z.left || z.right <= a.left || a.bottom <= z.top || z.bottom <= a.top); const q = p && !p.hidden && p.getClientRects().length ? R(p) : null; return { play: !!q, barPlay: q ? hit(b, q) : false, cubePlay: q ? hit(c, q) : false } })()`)
    check(g.play && !g.barPlay && !g.cubePlay, `an animation: the play bar is on screen and the scale bar and the cube stay clear of it (${JSON.stringify(g)})`)
    await openFile('parts.glb')
  }

  // ----- PNG export: the picture is the view without the cube, the scale bar and the status bar
  const png = async () => {
    await ev(`(() => {
      window.__savedData = null
      const f = document.getElementById('ex-format'); f.value = 'png'; f.dispatchEvent(new Event('change', { bubbles: true }))
      for (const [id, v] of Object.entries({ 'ex-png-size': '0', 'ex-png-bg': 'shown' })) { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })) }
      document.getElementById('b-ex-make').click()
    })()`)
    await waitFor(`document.documentElement.dataset.export === 'ready'`, 60000, 'the picture')
    await ev(`document.getElementById('b-ex-save').click()`)
    await waitFor(`!!window.__savedData`, 30000, 'the Save call')
    return ev(`(async () => { const u = new Uint8Array(window.__savedData); const h = await crypto.subtle.digest('SHA-256', u); return { n: u.length, sha: [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join(''), mime: window.__saved.mime } })()`)
  }
  const withCube = await png()
  await ev(`for (const id of ['viewcube', 'scalebar']) document.getElementById(id).hidden = true; document.getElementById('status').style.visibility = 'hidden'`)
  const withoutCube = await png()
  await ev(`for (const id of ['viewcube', 'scalebar']) document.getElementById(id).hidden = false; document.getElementById('status').style.visibility = ''`)
  check(withCube.n > 1000 && /png/.test(withCube.mime) && withCube.sha === withoutCube.sha, `the PNG with the cube on screen is the same file as the one without it (${withCube.n} bytes; a guard: the export draws the main renderer only, so it holds as long as nobody adds the page's overlays to it)`)
} catch (e) {
  console.error(e)
  failures++
} finally {
  chrome.kill()
  server.kill()
}
console.log(failures ? `\n${failures} check(s) failed` : `\nall ${total} checks passed`)
process.exit(failures ? 1 : 0)

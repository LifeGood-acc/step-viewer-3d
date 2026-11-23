#!/usr/bin/env node
// End-to-end test of Measure+ in headless Chrome through the plugin's harness: the label on the line, the Measure tab (list, rename, colour,
// hide, delete), changing points (drag and "Set again"), a chain with pieces, sum and area, comparing two, keeping them through a change of look,
// the picture export, and the question when the file is closed. Works in both viewers.   node dev/e2e-measure.mjs
import { spawn, execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync, existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const plugin = join(here, '..')
const isStep = existsSync(join(plugin, 'samples', 'assembly.step'))
const dir = mkdtempSync(join(tmpdir(), 'measure-e2e-'))
const shotDir = process.env.MEASURE_SHOTS || ''
if (shotDir) mkdirSync(shotDir, { recursive: true })
let modelFile
if (isStep) modelFile = join(plugin, 'samples', 'assembly.step')
else {
  // a cube of 10 x 10 x 10 (binary STL): known edges, diagonals and corners
  const V = (x, y, z) => [x * 10, y * 10, z * 10]
  const quads = [[[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]], [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]], [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]]]
  const tris = quads.flatMap(([a, b, c, d]) => [[a, b, c], [a, c, d]])
  const buf = Buffer.alloc(84 + 50 * tris.length)
  buf.writeUInt32LE(tris.length, 80)
  tris.forEach((t, i) => t.forEach((p, j) => V(...p).forEach((v, k) => buf.writeFloatLE(v, 84 + 50 * i + 12 + 12 * j + 4 * k))))
  modelFile = join(dir, 'cube10.stl')
  writeFileSync(modelFile, buf)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const rnd = Math.floor(Math.random() * 80)
const port = 8600 + rnd
const chromePort = 9100 + rnd
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
const press = (i) => ev(`document.getElementById(${JSON.stringify(i)}).click()`)
const setCtl = (i, value) => ev(`(() => { const e = document.getElementById(${JSON.stringify(i)}); if (e.type === 'checkbox') e.checked = ${JSON.stringify(value)}; else e.value = ${JSON.stringify(value)}; e.dispatchEvent(new Event(e.tagName === 'SELECT' || e.type === 'checkbox' ? 'change' : 'input', { bubbles: true })) })()`)
const key = (k) => ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, bubbles: true }))`)
const frames = (n = 2) => ev(`new Promise((r) => { let i = 0; const f = () => (++i >= ${n} ? r(true) : requestAnimationFrame(f)); requestAnimationFrame(f) })`)
const shot = async (name) => {
  if (!shotDir) return
  const r = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(shotDir, `${name}.png`), Buffer.from(r.result.data, 'base64'))
}
// In the page: surface pixels (x, y) of the canvas for points on the model, found by casting rays from a grid of pixels
const P = `window.__p = window.__p || (async () => {
  const THREE = await import('three')
  const h = window.__h
  const ray = new THREE.Raycaster()
  const canvas = h.renderer.domElement
  const r = () => canvas.getBoundingClientRect()
  const meshes = () => h.parts.filter((p) => p.kind === 'mesh' && p.visible).map((p) => p.obj)
  const hitAt = (x, y) => { const b = r(); ray.setFromCamera(new THREE.Vector2(((x - b.left) / b.width) * 2 - 1, -(((y - b.top) / b.height) * 2 - 1)), h.camera); return ray.intersectObjects(meshes(), false)[0] || null }
  const surface = (n) => { const b = r(); const out = []; for (let j = 1; j < 24; j++) for (let i = 1; i < 24; i++) { const x = b.left + (i / 24) * b.width, y = b.top + (j / 24) * b.height; const hit = hitAt(x, y); if (hit) out.push({ x, y, p: hit.point.toArray() }) } return out }
  const fire = (type, x, y) => canvas.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, button: 0, pointerId: 1, bubbles: true }))
  const click = (x, y) => { fire('pointerdown', x, y); fire('pointerup', x, y) }
  const toScreen = (world) => { const v = new THREE.Vector3(...world).project(h.camera); const b = r(); return { x: b.left + ((v.x + 1) / 2) * b.width, y: b.top + ((1 - v.y) / 2) * b.height } }
  const toWorld = (local) => h.modelRoot.localToWorld(new THREE.Vector3(...local)).toArray()
  return { THREE, hitAt, surface, click, fire, toScreen, toWorld, r }
})()`
const page = (body) => ev(`(async () => { const q = await (${P}); ${body} })()`)
const labels = () => ev(`[...document.querySelectorAll('#measure-labels .mlabel')].filter((e) => e.style.visibility !== 'hidden').map((e) => { const b = e.getBoundingClientRect(); const c = document.getElementById('gl').getBoundingClientRect(); return { key: e.dataset.key, text: e.firstChild.textContent, sub: e.children[1].textContent, cx: b.left + b.width / 2, cy: b.top + b.height / 2, w: b.width, h: b.height, bg: getComputedStyle(e).backgroundColor, font: parseFloat(getComputedStyle(e).fontSize), tf: getComputedStyle(e).transform, inView: b.left >= c.left - 1 && b.right <= c.right + 1 && b.top >= c.top - 1 && b.bottom <= c.bottom + 1 } })`)
const mainLabels = async () => (await labels()).filter((l) => l.key.endsWith(':main'))
const count = () => ev(`window.__h.measure.store.count()`)
const alpha = (bg) => (/rgba\(.*,\s*([\d.]+)\)/.exec(bg) || [0, 1])[1] * 1
const overlap = (a, b) => Math.abs(a.cx - b.cx) < (a.w + b.w) / 2 - 0.5 && Math.abs(a.cy - b.cy) < (a.h + b.h) / 2 - 0.5

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
  await send('Emulation.setDeviceMetricsOverride', { width: 1180, height: 760, deviceScaleFactor: 1, mobile: false })
  await open(modelFile)
  await frames(3)

  // ----- the tab: it is not there before the first measurement (the toolbar button measures), then it says how many
  const tabs = await ev(`[...document.querySelectorAll('#side-tabs .tab')].filter((b) => !b.hidden).map((b) => b.textContent)`)
  check(!tabs.some((x) => /Measure/.test(x)), `no measuring tab before the first measurement (${tabs})`)
  check(await ev(`!/measure/i.test(document.getElementById('tp-info').textContent.replace(/Measure the whole/, ''))`), 'nothing of the measuring list is in the Info tab (one place per function)')
  await press('b-measure')
  check(await ev(`document.getElementById('b-measure').getAttribute('aria-pressed') === 'true'`), 'the toolbar button starts measuring')
  await press('b-measure-done')

  // ----- a distance, by clicks: the label stands on the line, semi-transparent, in the view
  await press('b-measure')
  await ev(`document.querySelector('#measure-bar [data-mode="distance"]').click()`)
  let surf = await page(`return q.surface()`)
  check(surf.length > 20, `${surf.length} surface pixels found`)
  const A = surf[Math.floor(surf.length * 0.15)]
  const B = surf[Math.floor(surf.length * 0.85)]
  await page(`q.click(${A.x}, ${A.y}); q.click(${B.x}, ${B.y})`)
  await frames(3)
  check((await count()) === 1, 'two clicks make one measurement')
  const m1 = await ev(`(() => { const m = window.__h.measure.store.list()[0]; return { kind: m.kind, pts: m.pts, v: window.__h.measure.compute(m).value } })()`)
  const wantD = Math.hypot(...[0, 1, 2].map((i) => m1.pts[0][i] - m1.pts[1][i]))
  check(m1.kind === 'distance' && Math.abs(m1.v - wantD) < 1e-9, `distance value = the distance of the two points (${m1.v.toFixed(3)})`)
  if (!isStep) {
    // the cube: both points lie on its surface, so the distance is at most the space diagonal
    check(m1.v > 0.5 && m1.v <= 10 * Math.sqrt(3) + 1e-6, `cube: distance ${m1.v.toFixed(3)} is within 0..10*sqrt(3)`)
  }
  const L1 = await mainLabels()
  check(L1.length === 1 && /^1 · [\d.,]+ \S+$/.test(L1[0].text), `a label on the line: "${L1[0] && L1[0].text}"`)
  const mid = await page(`const m = window.__h.measure.store.list()[0]; const a = q.toWorld(m.pts[0]), b = q.toWorld(m.pts[1]); return q.toScreen([0, 1, 2].map((i) => (a[i] + b[i]) / 2))`)
  check(Math.hypot(L1[0].cx - mid.x, L1[0].cy - mid.y) < 3, `the label stands at the middle of the line (off by ${Math.hypot(L1[0].cx - mid.x, L1[0].cy - mid.y).toFixed(1)} px)`)
  check(alpha(L1[0].bg) > 0.5 && alpha(L1[0].bg) < 0.95 && L1[0].font >= 11, `the label is slightly transparent (alpha ${alpha(L1[0].bg)}) and readable (${L1[0].font}px)`)
  check(/Distance/.test(await ev(`document.getElementById('measure-out').textContent`)), 'the summary stays in the chip too')
  await shot('01-label')

  // ----- the list
  const tabsAfter = await ev(`[...document.querySelectorAll('#side-tabs .tab')].filter((b) => !b.hidden).map((b) => b.textContent)`)
  check(tabsAfter.includes('Measurements 1') && tabsAfter.indexOf('Measurements 1') < tabsAfter.indexOf('Info'), `the first measurement makes a tab "Measurements 1" before Info (${tabsAfter})`)
  await ev(`window.__h.chrome.tabs.select('measure')`)
  check((await ev(`document.querySelectorAll('#measure-list .mrow').length`)) === 1 && /Distance/.test(await ev(`document.querySelector('#measure-list .mrow').textContent`)), 'the list has a row: number, kind, value')
  await setCtl('ms-name', 'Rod')
  await frames(2)
  check((await mainLabels())[0].sub === 'Rod' && /Rod/.test(await ev(`document.querySelector('#measure-list .mrow').textContent`)), 'rename: the name is on the label and in the list')
  const bg0 = (await mainLabels())[0].bg
  await ev(`document.querySelector('.swatch-btn[data-color="#0a56bd"]').click()`)
  await frames(2)
  check((await mainLabels())[0].bg !== bg0, 'colour: the label changes colour')
  await ev(`document.querySelector('#measure-list .meye').click()`)
  await frames(2)
  check((await labels()).length === 0 && (await ev(`window.__h.measure.store.count()`)) === 1, 'hide: the label is gone, the measurement stays')
  await ev(`document.querySelector('#measure-list .meye').click()`)
  await frames(2)
  check((await labels()).length === 1, 'show again')

  // ----- keyboard focus stays where the person works (the list is drawn again after every action)
  const active = () => ev(`(() => { const a = document.activeElement; return a ? (a.className || a.id || a.tagName) + '|' + (a.dataset.color || a.closest('li') && a.closest('li').dataset.id || '') : '' })()`)
  const rowId = await ev(`document.querySelector('#measure-list .mrow').dataset.id`)
  await ev(`document.querySelector('#measure-list .meye').focus()`)
  await ev(`document.querySelector('#measure-list .meye').click()`)
  await frames(2)
  check((await active()).startsWith('meye|' + rowId), `focus stays on the eye button after hiding (${await active()})`)
  await ev(`document.querySelector('#measure-list .meye').click()`)
  await frames(2)
  await ev(`document.querySelector('.swatch-btn[data-color="#7a31bd"]').focus()`)
  await ev(`document.querySelector('.swatch-btn[data-color="#7a31bd"]').click()`)
  await frames(2)
  check((await active()).includes('swatch-btn') && (await active()).endsWith('|#7a31bd'), `focus stays on the colour that was picked (${await active()})`)
  await ev(`document.querySelector('#measure-list .mmain').focus()`)
  await ev(`document.querySelector('#measure-list .mmain').click()`)
  await frames(2)
  check((await active()).startsWith('mmain|' + rowId), `focus stays on the row that was clicked (${await active()})`)

  // ----- the label follows the view (it is readable when the model is turned)
  const before = (await mainLabels())[0]
  await ev(`(() => { const { camera, controls } = window.__h; const p = camera.position.clone().sub(controls.target); const a = 0.7; camera.position.set(controls.target.x + p.x * Math.cos(a) + p.z * Math.sin(a), controls.target.y + p.y, controls.target.z - p.x * Math.sin(a) + p.z * Math.cos(a)); controls.update(); controls.dispatchEvent({ type: 'change' }) })()`)
  await frames(3)
  const after = (await mainLabels())[0]
  const mid2 = await page(`const m = window.__h.measure.store.list()[0]; const a = q.toWorld(m.pts[0]), b = q.toWorld(m.pts[1]); return q.toScreen([0, 1, 2].map((i) => (a[i] + b[i]) / 2))`)
  check(Math.hypot(after.cx - mid2.x, after.cy - mid2.y) < 3 && Math.hypot(after.cx - before.cx, after.cy - before.cy) > 5, 'turning the view: the label follows the middle of the line')
  check(after.tf === 'none' || /matrix\(1, 0, 0, 1,/.test(after.tf), `the label stays upright (${after.tf.slice(0, 30)})`)

  // ----- several labels do not cover each other (three measurements on the same spot)
  await page(`const s = window.__h.measure.store; const m = s.list()[0]; s.add({ kind: 'distance', pts: m.pts }); s.add({ kind: 'distance', pts: m.pts })`)
  await frames(3)
  const L3 = await mainLabels()
  let clash = 0
  for (let i = 0; i < L3.length; i++) for (let j = i + 1; j < L3.length; j++) if (overlap(L3[i], L3[j])) clash++
  check(L3.length === 3 && clash === 0 && L3.every((l) => l.inView), `three labels for one line: none covers another (${L3.length} labels, ${clash} overlaps)`)
  await shot('02-three-labels')
  // a view with no room for all main labels: none covers another, the rest is named in one label
  await page(`const s = window.__h.measure.store; const m = s.list()[0]; for (let i = 0; i < 300; i++) s.add({ kind: 'distance', pts: m.pts })`)
  await frames(4)
  const L40 = await mainLabels()
  let clash40 = 0
  for (let i = 0; i < L40.length; i++) for (let j = i + 1; j < L40.length; j++) if (overlap(L40[i], L40[j])) clash40++
  const bundleTxt = await ev(`(() => { const b = document.getElementById('measure-bundle'); return b && b.style.visibility !== 'hidden' ? b.textContent : '' })()`)
  check(clash40 === 0 && L40.length < 303 && L40.length >= 3, `a crowded view: ${L40.length} main labels, ${clash40} overlaps`)
  check(L40.length < 303 ? /\d/.test(bundleTxt) : true, `the labels without room are named in one label ("${bundleTxt.slice(0, 40)}")`)
  await shot('03-crowded-no-room')
  // all measurements deleted while the "no room" label is up: it goes too
  const keep = await ev(`(() => { const m = window.__h.measure.store.list()[0]; return { kind: m.kind, pts: m.pts, name: m.name, color: m.color } })()`)
  await ev(`window.__h.measure.clearAll()`)
  await frames(3)
  check(await ev(`(() => { const b = document.getElementById('measure-bundle'); return !b || b.style.visibility === 'hidden' || b.offsetParent === null })()`), 'no measurement left: no stale "no room" label')
  await page(`const s = window.__h.measure.store; const k = ${JSON.stringify(keep)}; s.add(k); s.add({ kind: k.kind, pts: k.pts }); s.add({ kind: k.kind, pts: k.pts })`)
  await frames(3)
  await page(`const s = window.__h.measure.store; s.remove(s.list()[2].id); s.remove(s.list()[1].id)`)

  // ----- change the points: drag a marker (the view was turned: the surface pixels are found again)
  surf = await page(`return q.surface()`)
  const startPts = await ev(`window.__h.measure.store.list()[0].pts`)
  const target = surf[Math.floor(surf.length * 0.5)]
  const startV = await ev(`window.__h.measure.compute(window.__h.measure.store.list()[0]).value`)
  const moved = await page(`const m = window.__h.measure.store.list()[0]; const s = q.toScreen(q.toWorld(m.pts[1])); q.fire('pointerdown', s.x, s.y); q.fire('pointermove', ${target.x}, ${target.y}); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); q.fire('pointerup', ${target.x}, ${target.y}); const n = window.__h.measure.store.list()[0]; return { pts: n.pts, orbit: window.__h.controls.enabled }`)
  const dragWorld = await page(`return q.toWorld(${JSON.stringify(moved.pts[1])})`)
  check(Math.hypot(...moved.pts[1].map((v, i) => v - startPts[1][i])) > 1e-3 && Math.hypot(...moved.pts[0].map((v, i) => v - startPts[0][i])) < 1e-9, 'dragging marker 2 moves only point 2')
  check(Math.hypot(...dragWorld.map((v, i) => v - target.p[i])) < 1e-4 * Math.max(1, Math.hypot(...target.p)) + 1e-3, 'the dragged point lies where it was dropped on the surface')
  check(moved.orbit === true && Math.abs((await ev(`window.__h.measure.compute(window.__h.measure.store.list()[0]).value`)) - startV) > 1e-6, 'the value follows the new point; orbiting works again after the drop')
  // "Set again": button, then a click in the view
  await ev(`document.querySelector('#measure-list .mmain').click()`)
  await press('b-measure-done')
  await ev(`document.querySelector('.ms-set[data-index="0"]').click()`)
  check(await ev(`document.getElementById('b-measure').getAttribute('aria-pressed') === 'true' && !!window.__h.measure.armed()`), '"Set again" turns measuring on and waits for the click')
  const T2 = surf[Math.floor(surf.length * 0.3)]
  await page(`q.click(${T2.x}, ${T2.y})`)
  const afterSet = await ev(`window.__h.measure.store.list()[0].pts[0]`)
  const w2 = await page(`return q.toWorld(${JSON.stringify(afterSet)})`)
  check(Math.hypot(...w2.map((v, i) => v - T2.p[i])) < 1e-3 + 1e-4 * Math.hypot(...T2.p) && !(await ev(`!!window.__h.measure.armed()`)) && (await count()) === 1, '"Set again": the next click sets the point, no new measurement is made')

  // review: "Set again" then deleting that measurement leaves nothing armed (the next click is not lost)
  await page(`const s = window.__h.measure.store; s.add({ kind: 'distance', pts: s.list()[0].pts })`)
  const extraId = await ev(`window.__h.measure.store.list()[1].id`)
  await ev(`window.__h.measure.armReplace(${JSON.stringify(extraId)}, 0)`)
  await ev(`window.__h.measure.store.remove(${JSON.stringify(extraId)})`)
  check(await ev(`window.__h.measure.armed() === null`), 'deleting the measurement that waits for "Set again" disarms it')
  // review: an unfinished chain is finished, not thrown away, when "Set again" is pressed for another measurement
  await ev(`document.querySelector('#measure-bar [data-mode="chain"]').click()`)
  const cp = [0.2, 0.5, 0.7].map((f) => surf[Math.floor(surf.length * f)])
  await page(`${cp.map((p) => `q.click(${p.x}, ${p.y})`).join('; ')}`)
  const chainDraft = await ev(`(window.__h.measure.draft() || {}).count`)
  const firstId = await ev(`window.__h.measure.store.list()[0].id`)
  await ev(`window.__h.measure.armReplace(${JSON.stringify(firstId)}, 0)`)
  check(chainDraft === 3 && (await count()) === 2 && !(await ev(`window.__h.measure.draft()`)), `"Set again" finishes a chain that was under way (${chainDraft} points, ${await count()} measurements)`)
  check((await ev(`window.__h.measure.store.selected()`)) === firstId, '"Set again": the measurement that is changed stays the selected one')
  await ev(`window.__h.measure.disarm()`)
  await page(`const s = window.__h.measure.store; while (s.list().length > 1) s.remove(s.list()[s.list().length - 1].id)`)

  // a click on an old marker is a new point, not a grab (measuring on); without measuring it selects that measurement
  await ev(`document.querySelector('#measure-bar [data-mode="distance"]').click()`)
  const old = await ev(`window.__h.measure.store.list()[0].pts[1]`)
  await page(`const s = q.toScreen(q.toWorld(${JSON.stringify(old)})); q.click(s.x, s.y)`)
  check((await ev(`(window.__h.measure.draft() || {}).count`)) === 1 && JSON.stringify(await ev(`window.__h.measure.store.list()[0].pts[1]`)) === JSON.stringify(old), 'measuring: a click on an old marker starts a new point, it does not grab the marker')
  await ev(`document.querySelector('#measure-bar [data-mode="chain"]').click()`) // another way to measure drops the unfinished one
  await press('b-measure-done')
  await ev(`window.__h.chrome.tabs.select('measure')`) // the markers can be picked while the Measurements tab is open (it went away and came back with the measurements)
  await page(`const s = window.__h.measure.store; s.select(null); const m = s.list()[0]; const p = q.toScreen(q.toWorld(m.pts[0])); q.click(p.x, p.y)`)
  check((await ev(`window.__h.measure.store.selected()`)) === (await ev(`window.__h.measure.store.list()[0].id`)), 'not measuring: a click on a marker selects its measurement')
  await press('b-measure')
  await ev(`document.querySelector('#measure-bar [data-mode="chain"]').click()`)

  // ----- a chain of four points: pieces, sum, area when closed
  await ev(`document.querySelector('#measure-bar [data-mode="chain"]').click()`)
  const picks = [0.2, 0.4, 0.6, 0.8].map((f) => surf[Math.floor(surf.length * f)])
  for (const p of picks) await page(`q.click(${p.x}, ${p.y})`)
  check(await ev(`!document.getElementById('b-chain-done').hidden && !document.getElementById('b-chain-close').hidden`), 'chain: "Finish chain" and "Close, with area" appear while clicking')
  check((await count()) === 1, 'chain: nothing is made until it is finished')
  await press('b-chain-done')
  await frames(3)
  const ch = await ev(`(() => { const m = window.__h.measure.store.list()[1]; const c = window.__h.measure.compute(m); return { kind: m.kind, n: m.pts.length, segs: c.segLengths, total: c.total } })()`)
  check(ch.kind === 'chain' && ch.n === 4 && ch.segs.length === 3 && Math.abs(ch.segs.reduce((a, b) => a + b, 0) - ch.total) < 1e-9, `chain: four points, three pieces, sum = pieces (${ch.total.toFixed(3)})`)
  const lab = (await labels()).filter((l) => l.key.includes(':s'))
  check(lab.length >= 1, `chain: the pieces are labelled on their lines (${lab.length} of 3 shown; the others would cover each other)`)
  await ev(`document.getElementById('ms-closed').click()`)
  await frames(3)
  const chc = await ev(`(() => { const c = window.__h.measure.compute(window.__h.measure.store.list()[1]); return { segs: c.segLengths.length, area: c.area, total: c.total } })()`)
  check(chc.segs === 4 && chc.area > 0 && /Area/.test((await mainLabels()).map((l) => l.sub).join(' ')), `chain, closed: four pieces and an area on the label (area ${chc.area.toFixed(3)})`)
  await shot('03-chain')

  // ----- exactly known numbers, shown by the viewer (file axes, whatever the view's Up)
  await page(`const s = window.__h.measure.store; s.add({ kind: 'chain', pts: [[0, 0, 0], [30, 0, 0], [30, 40, 0], [0, 40, 0]], closed: true, name: 'frame' }); s.add({ kind: 'distance', pts: [[0, 0, 0], [40, 0, 0]] }); s.add({ kind: 'distance', pts: [[0, 0, 0], [0, 25, 0]] })`)
  await frames(3)
  const texts = (await ev(`window.__h.measure.store.list().slice(-3).map((m) => window.__h.measure.summary(m).join(' | '))`))
  check(/140/.test(texts[0]) && /1[,.]?200/.test(texts[0]) && /30.*40.*30.*40/.test(texts[0]), `known chain 30/40/30/40: sum 140, area 1200 (${texts[0]})`)
  // compare the two distances: tick rows 5 and 6 (40 and 25)
  await ev(`(() => { const r = [...document.querySelectorAll('#measure-list .mrow')]; r[r.length - 2].querySelector('.mcmp').click(); r[r.length - 1].querySelector('.mcmp').click() })()`)
  const cmp = await ev(`document.getElementById('measure-compare').textContent`)
  check(/\+15/.test(cmp) && /1[.,]6/.test(cmp) && /160/.test(cmp), `compare 40 and 25: difference +15, ratio 1.6 (160 %) ("${cmp.replace(/\s+/g, ' ').slice(0, 120)}")`)
  await ev(`document.querySelector('#measure-list .mrow .mcmp').click()`)
  check(/exactly two/i.test(await ev(`document.getElementById('measure-compare').textContent`)), 'three ticked: the panel asks for exactly two')
  await ev(`document.querySelectorAll('#measure-list .mrow .mcmp').forEach((c) => { if (c.checked) c.click() })`)
  await shot('04-list-compare')

  // ----- they stay when the look changes
  const nBefore = await count()
  const pos = (await mainLabels()).map((l) => l.text).join()
  await setCtl('shading', 'xray')
  await setCtl('shading', 'solid')
  if (await ev(`!!document.getElementById('b-wire') && !document.getElementById('b-wire').hidden`)) { await press('b-wire'); await frames(2); await press('b-wire') }
  await setCtl('up', 'y')
  await setCtl('up', 'z')
  await frames(3)
  check((await count()) === nBefore && (await mainLabels()).map((l) => l.text).join() === pos, `the measurements stay through shading, mesh and "Up is" (${nBefore})`)
  const lv = await page(`const m = window.__h.measure.store.list()[0]; const a = q.toWorld(m.pts[0]), b = q.toWorld(m.pts[1]); return q.toScreen([0, 1, 2].map((i) => (a[i] + b[i]) / 2))`)
  const no0 = await ev(`window.__h.measure.store.list()[0].no`)
  const lv0 = (await mainLabels()).find((l) => l.text.startsWith(no0 + ' · ')) // it may step aside for another label, but stays close to its line
  check(!!lv0 && Math.hypot(lv0.cx - lv.x, lv0.cy - lv.y) < 110, 'after "Up is" the markers and labels are still on the model')

  // ----- take them along: text, CSV, picture
  const csv = await ev(`window.__h.measure.csv()`)
  const rowsCsv = csv.trim().split('\n')
  check(rowsCsv.length === nBefore + 1 && /^No,Kind,Name,Value,Unit,Detail,Points/.test(rowsCsv[0]), `CSV: a header and ${nBefore} rows`)
  const txt = await ev(`window.__h.measure.text()`)
  check(/Rod/.test(txt) && txt.trim().split('\n').length === nBefore + 1, 'text: a title and one line per measurement, with the name')
  await press('b-ms-copy-text')
  await sleep(150)
  check(/Measurements copied|Copying is not possible here/i.test(await ev(`document.body.textContent`)), 'the copy button answers (copied, or says that copying failed: the harness may refuse the clipboard)')
  const png = await ev(`(async () => {
    const { renderPng } = await import('./shared/export-three.js')
    const h = window.__h
    const view = { renderer: h.renderer, scene: h.scene, camera: h.camera, canvas: h.renderer.domElement, helpers: h.helpers }
    const grab = async (o) => { const r = await renderPng({ ...view, size: 0, transparent: false, ...o }); const bmp = await createImageBitmap(new Blob([r.bytes], { type: 'image/png' })); const c = new OffscreenCanvas(bmp.width, bmp.height); const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(bmp, 0, 0); return g.getImageData(0, 0, bmp.width, bmp.height) }
    const plain = await grab({ overlay: null })
    const withLabels = await grab({ overlay: h.measure })
    let n = 0
    for (let i = 0; i < plain.data.length; i += 4) if (Math.abs(plain.data[i] - withLabels.data[i]) + Math.abs(plain.data[i + 1] - withLabels.data[i + 1]) > 60) n++
    const transparent = await grab({ overlay: h.measure, transparent: true })
    let m = 0
    h.measure.setHidden(true)
    const plainT = await grab({ overlay: null, transparent: true }) // what a picture without the measurements looks like
    h.measure.setHidden(false)
    for (let i = 0; i < plainT.data.length; i += 4) if (Math.abs(plainT.data[i] - transparent.data[i]) + Math.abs(plainT.data[i + 3] - transparent.data[i + 3]) > 0) m++
    return { n, m, w: plain.width, labelsShown: document.getElementById('measure-labels').hidden }
  })()`)
  check(png.n > 800, `the exported picture has the labels drawn in (${png.n} pixels differ from a picture without)`)
  check(png.m === 0 && png.labelsShown === false, 'a transparent picture has none of them, and the labels are back afterwards')

  // ----- close the file: the question names them
  await ev(`document.getElementById('b-close').hidden = false`)
  await press('b-close')
  await waitFor(`!!document.getElementById('confirm-text')`, 5000, 'the close question')
  const q = await ev(`document.getElementById('confirm-text').textContent`)
  check(new RegExp(`${nBefore} measurements`).test(q), `"Close file" names the measurements ("${q.slice(0, 120)}")`)
  await ev(`[...document.querySelectorAll('#confirm button')].find((b) => /cancel/i.test(b.textContent)).click()`)

  // ----- Esc ends measuring, the list stays; delete all (asks first)
  await key('Escape')
  check((await count()) === nBefore, 'Esc ends measuring, the measurements stay')
  await press('b-ms-clear-all')
  await waitFor(`!!document.getElementById('confirm-text')`, 5000, 'the delete-all question')
  await ev(`[...document.querySelectorAll('#confirm button')].find((b) => /delete all/i.test(b.textContent)).click()`)
  await frames(2)
  check((await count()) === 0 && (await labels()).length === 0 && (await ev(`!document.getElementById('measure-empty').hidden`)), 'delete all: asked first, then list, labels and markers are gone')
  check(!(await ev(`[...document.querySelectorAll('#side-tabs .tab')].filter((b) => !b.hidden).map((b) => b.textContent)`)).some((x) => /Measurements/.test(x)) && (await ev(`window.__h.chrome.tabs.current()`)) !== 'measure', 'delete all: the Measurements tab goes away again and another tab is shown')
  check((await ev(`document.activeElement && document.activeElement.id`)) === 'b-measure', `delete all: the keyboard focus lands on the Measure button, not on the page (${await ev(`document.activeElement && (document.activeElement.id || document.activeElement.tagName)`)})`)
  check((await ev(`window.__h.renderer.render(window.__h.scene, window.__h.camera), window.__h.measure.labelCount()`)) === 0, 'after the last measurement is gone no label is kept for a picture')

  // ----- explode hides them (model viewer with several parts only): skipped when the file has one part
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

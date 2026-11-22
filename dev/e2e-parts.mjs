#!/usr/bin/env node
// End-to-end test of the part card (selection of one and of several parts, the numbers, the distance of two parts, Measure > Parts) in headless
// Chrome through the plugin's harness. Works in both viewers.   node dev/e2e-parts.mjs
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

const key = (k) => ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, bubbles: true }))`)
const press = (id) => ev(`document.getElementById(${JSON.stringify(id)}).click()`)
const sleepFrame = () => sleep(150)
const card = () => ev(`(() => { const c = document.getElementById('part-card'); if (!c || c.hidden) return null; return { name: c.querySelector('.pc-name').textContent, rows: Object.fromEntries([...c.querySelectorAll('dt')].map((dt) => [dt.textContent, dt.nextElementSibling.textContent])), text: c.textContent } })()`)
const chip = () => ev(`(() => { const c = document.getElementById('sel-chip'); return c && !c.hidden ? c.textContent : null })()`)
// the list rows by name; a click as a person would make it, with modifiers
const clickRow = (i, mods = {}) => ev(`(() => { const r = document.querySelector('.part[data-i="${i}"]'); r.dispatchEvent(new MouseEvent('click', { bubbles: true, ...${JSON.stringify(mods)} })) })()`)
const selected = () => ev(`[...document.querySelectorAll('.part.sel')].map((r) => Number(r.dataset.i))`)
// the size of a part computed another way: three.js' own box of the object in the world, turned back to the file's axes by the model root
const meshesOf = (i) => ev(isStep ? `window.__h.rows[${i}].meshes` : `[${i}]`)
const boxOf = async (i) => { const ms = await meshesOf(i); const all = await Promise.all(ms.map(boxOfMesh)); return { size: null, tris: all.reduce((a, b) => a + b.tris, 0), boxes: all } }
const boxOfMesh = (i) => ev(`(async () => { const { parts, scene } = window.__h; const THREE = await import('three'); const o = parts[${i}].obj; const root = scene.children.find((c) => c.name === 'spin').children[0]; root.updateMatrixWorld(true); o.updateWorldMatrix(true, false); const m = new THREE.Matrix4().copy(root.matrixWorld).invert().multiply(o.matrixWorld); const b = new THREE.Box3(); const v = new THREE.Vector3(); const pos = o.geometry.getAttribute('position'); for (let k = 0; k < pos.count; k++) b.expandByPoint(v.fromBufferAttribute(pos, k).applyMatrix4(m)); return { size: b.getSize(new THREE.Vector3()).toArray(), tris: parts[${i}].tris } })()`)
const nums = (text) => (text.replace(/\u2212/g, '-').replace(/,(?=\d{3}\b)/g, '').match(/-?[\d.]+/g) || []).map(Number)
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
  await send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 800, deviceScaleFactor: 1, mobile: false })
  await open(modelFile)
  const L = await ev(isStep ? `window.__h.rows.map((r, i) => (r.meshes.length === 1 && !r.group ? i : -1)).filter((i) => i >= 0)` : `window.__h.parts.map((_, i) => i)`)
  const n = await ev(`window.__h.parts.length`)
  check(n >= 2 && await card() === null && await chip() === null, `no selection: no card and no chip (${n} parts)`)

  // ----- one part: the cheap numbers at once
  await clickRow(L[0])
  await sleepFrame()
  let c = await card()
  const b0 = await boxOfMesh((await meshesOf(L[0]))[0])
  check(c && c.rows['Size X × Y × Z'] !== undefined, 'one part: the card shows the size')
  const dims0 = nums(c.rows['Size X × Y × Z']).slice(0, 3)
  check(dims0.length === 3 && dims0.every((v, i) => Math.abs(v - b0.size[i]) <= 0.006 * Math.max(1, b0.size[i])), `one part: the size ${dims0} is the box of the part (${b0.size.map((v) => v.toFixed(3))})`)
  check(Number(c.rows['Triangles'].replace(/[^\d]/g, '')) === b0.tris, `one part: the triangles (${c.rows['Triangles']})`)
  check(/%/.test(c.rows['Share of the model']), 'one part: the share of the model')
  check((await chip()) && /×/.test(await chip()), `one part: the chip in the view names the part and its size ("${await chip()}")`)
  check(await ev(`(() => { const hs = window.__h.scene.children.find((o) => o.isGroup && o.children.some((c) => c.isLineSegments && c.material.isLineDashedMaterial)); return !!hs })()`), 'one part: a dashed frame is drawn around it')
  // ----- STEP: a node of the tree selects every part below it, the card is named like the node
  if (isStep) {
    const g = await ev(`(() => { const rows = window.__h.rows; const i = rows.findIndex((r, k) => r.group && r.meshes.length > 1 && k > 0) ; return i < 0 ? null : { i, name: rows[i].name, meshes: rows[i].meshes, tris: rows[i].meshes.reduce((a, k) => a + window.__h.parts[k].tris, 0) } })()`)
    if (g) {
      await clickRow(g.i)
      await sleepFrame()
      const gc = await card()
      check(gc && gc.name === g.name, `a tree node: the card is named like the node ("${gc && gc.name}")`)
      check(Number(gc.rows['Triangles'].replace(/[^\d]/g, '')) === g.tris, `a tree node: the triangles of all ${g.meshes.length} parts below it (${gc.rows['Triangles']})`)
      await key('Escape')
    } else check(true, 'a tree node: (this assembly has no group with several parts: skipped)')
  }
  // the same part again: selection gone
  await clickRow(L[0])
  await sleepFrame()
  check(await card() === null && (await selected()).length === 0, 'the same part again clears the selection')
  // ----- more: lazy numbers
  await clickRow(L[1])
  await sleepFrame()
  check(await ev(`!document.querySelector('#part-card details').open`), 'more is folded')
  await ev(`(() => { const d = document.querySelector('#part-card details'); d.open = true; d.dispatchEvent(new Event('toggle')) })()`)
  await waitFor(`(() => { const dd = [...document.querySelectorAll('#part-card dt')].find((x) => x.textContent === 'Surface'); return dd && /\\d/.test(dd.nextElementSibling.textContent) })()`, 20000, 'the surface of the part')
  c = await card()
  check(/\d/.test(c.rows['Surface']) && c.rows['Watertight'] !== undefined && c.rows['Volume'] !== undefined, `more: surface, volume and the check arrive (${c.rows['Surface']}, ${c.rows['Volume']}, ${c.rows['Watertight']})`)
  // independent: the area of the part from its triangles
  const m1 = (await meshesOf(L[1]))[0]
  const area = await ev(`(async () => { const { parts } = window.__h; const THREE = await import('three'); const o = parts[${m1}].obj; o.updateWorldMatrix(true, false); const g = o.geometry; const pos = g.getAttribute('position'); const idx = g.index; const n = idx ? idx.count : pos.count; const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(); let s = 0; for (let i = 0; i < n; i += 3) { const [i0, i1, i2] = idx ? [idx.getX(i), idx.getX(i + 1), idx.getX(i + 2)] : [i, i + 1, i + 2]; a.fromBufferAttribute(pos, i0).applyMatrix4(o.matrixWorld); b.fromBufferAttribute(pos, i1).applyMatrix4(o.matrixWorld); c.fromBufferAttribute(pos, i2).applyMatrix4(o.matrixWorld); s += b.clone().sub(a).cross(c.clone().sub(a)).length() / 2 } return s })()`)
  const shownArea = nums(c.rows['Surface'])[0]
  check(Math.abs(shownArea - area) <= 0.03 * area, `more: the surface ${c.rows['Surface']} agrees with the triangles (${area.toFixed(3)})`)

  // ----- several parts: Ctrl/Cmd adds, Shift takes a range, a click without modifier starts again
  await clickRow(L[0])
  await clickRow(L[2], { metaKey: true })
  await sleepFrame()
  const sel2 = await selected()
  check(sel2.length === 2 && sel2.includes(L[0]) && sel2.includes(L[2]), `Cmd click adds a part (${sel2})`)
  c = await card()
  check(/2 parts selected/.test(c.name), `two parts: the card says "${c.name}"`)
  const bx = await Promise.all([boxOf(L[0]), boxOf(L[2])])
  check(c.rows['Triangles'] && Number(c.rows['Triangles'].replace(/[^\d]/g, '')) === bx[0].tris + bx[1].tris, 'two parts: the triangles are summed')
  check(/Distance centre to centre/.test(c.text), 'two parts: the distance centre to centre')
  check(/Smallest distance/.test(c.text), 'two parts: the smallest distance can be calculated')
  await ev(`[...document.querySelectorAll('#part-card button')].find((b) => b.textContent === 'Calculate').click()`)
  await waitFor(`/\\d/.test(document.querySelector('.pc-dist-val').textContent)`, 20000, 'the smallest distance')
  const dmin = (await ev(`document.querySelector('.pc-dist-val').textContent`))
  check(/\d/.test(dmin) && !/NaN/.test(dmin), `two parts: the smallest distance is a number ("${dmin}")`)
  await clickRow(L[1], { metaKey: true })
  await sleepFrame()
  check((await selected()).length === 3 && /Measure > Parts/.test((await card()).text) && !(await ev(`!![...document.querySelectorAll('#part-card button')].find((b) => b.textContent === 'Calculate')`)), 'three parts: no pairwise distance, a pointer to Measure > Parts')
  await clickRow(L[1], { metaKey: true })
  check((await selected()).length === 2, 'Cmd click on a selected part takes it out')
  await clickRow(L[0])
  await clickRow(L[3], { shiftKey: true })
  await sleepFrame()
  const sel4 = await selected()
  check(sel4.length >= 4 && sel4.includes(L[0]) && sel4.includes(L[3]), `Shift click selects the range (${sel4})`)
  await key('Escape')
  await sleepFrame()
  check((await selected()).length === 0 && await card() === null && await chip() === null, 'Esc clears the selection, the card and the chip')
  // the dashed frame moves with the selection
  await clickRow(L[0])
  const f1 = await ev(`(() => { const hs = window.__h.scene.children.find((o) => o.isGroup && o.children.some((c) => c.isLineSegments && c.material.isLineDashedMaterial)); const l = hs.children.find((c) => c.isLineSegments && c.material.isLineDashedMaterial); l.geometry.computeBoundingBox(); return l.geometry.boundingBox.getSize(new l.position.constructor()).toArray() })()`)
  await clickRow(L[2], { metaKey: true })
  const f2 = await ev(`(() => { const hs = window.__h.scene.children.find((o) => o.isGroup && o.children.some((c) => c.isLineSegments && c.material.isLineDashedMaterial)); const l = hs.children.find((c) => c.isLineSegments && c.material.isLineDashedMaterial); l.geometry.computeBoundingBox(); return l.geometry.boundingBox.getSize(new l.position.constructor()).toArray() })()`)
  check(f2.some((v, i) => v > f1[i] + 1e-6), 'the frame grows around two parts')

  // ----- Measure > Parts
  await key('Escape')
  await ev(`(() => { const m = document.getElementById('measure-mode'); m.value = 'parts'; m.dispatchEvent(new Event('change', { bubbles: true })) })()`)
  check(await ev(`document.getElementById('b-measure').getAttribute('aria-pressed') === 'true'`), 'Measure > Parts starts measuring')
  const clickPart = (i) => ev(`(async () => { const { renderer, scene, camera, parts } = window.__h; const THREE = await import('three'); const o = parts[${i}].obj; o.updateWorldMatrix(true, false); const b = new THREE.Box3().setFromObject(o); const cpt = b.getCenter(new THREE.Vector3()); const raycaster = new THREE.Raycaster(); const v = cpt.clone().project(camera); const r = renderer.domElement.getBoundingClientRect(); const x = r.left + ((v.x + 1) / 2) * r.width, y = r.top + ((1 - v.y) / 2) * r.height; const ev = (t) => new PointerEvent(t, { clientX: x, clientY: y, button: 0, bubbles: true }); renderer.domElement.dispatchEvent(ev('pointerdown')); renderer.domElement.dispatchEvent(ev('pointerup')); return [x, y] })()`)
  // two parts that can be hit at their middle: pick them by ray from the camera to the middle of each box
  const hitIdx = await ev(`(async () => { const { scene, camera, parts } = window.__h; const THREE = await import('three'); const ok = []; for (let i = 0; i < parts.length; i++) { const o = parts[i].obj; const b = new THREE.Box3().setFromObject(o); const c = b.getCenter(new THREE.Vector3()); const rc = new THREE.Raycaster(camera.position, c.clone().sub(camera.position).normalize()); const h = rc.intersectObjects(parts.map((p) => p.obj), false)[0]; if (h && h.object === o) ok.push(i) } return ok })()`)
  if (hitIdx.length >= 2) {
    await clickPart(hitIdx[0])
    await clickPart(hitIdx[0])
    await sleepFrame()
    check(/same part|dasselbe/.test(await ev(`document.getElementById('measure-out').textContent`)), 'Measure > Parts: the same part twice is refused')
    await clickPart(hitIdx[1])
    await waitFor(`/Smallest distance: [\\d]|Smallest distance: 0|about/.test(document.getElementById('measure-out').textContent)`, 20000, 'the smallest distance in the chip')
    const out = await ev(`document.getElementById('measure-out').textContent`)
    check(/Centre to centre: [\d.]+/.test(out) && /Smallest distance/.test(out), `Measure > Parts: the chip names both distances ("${out.replace(/\s+/g, ' ').slice(0, 80)}")`)
  } else check(true, 'Measure > Parts: (no two parts can be hit at their middle in this view: skipped)')
  // ----- closing the file takes the card away with it
  await key('Escape')
  await clickRow(L[0])
  await sleepFrame()
  check(await card() !== null, 'before closing: a card is shown')
  await press('b-close')
  await ev(`document.querySelector('#confirm button.danger').click()`)
  await waitFor(`document.documentElement.dataset.state === 'start'`, 10000, 'the start page')
  check(await card() === null && await chip() === null, 'closing the file: no card and no chip stay behind')
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

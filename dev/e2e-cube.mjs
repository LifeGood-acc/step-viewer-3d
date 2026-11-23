#!/usr/bin/env node
// End-to-end test of the orientation cube's TARGETS (UX v3, E4; a finding of the hand check: after a click on a face the cube was one flat square and nothing else could be reached): after each of
// the six face clicks (and from every direction in between) the cube is still a three-dimensional cube with at least three faces, three edges and three corners that can be clicked, and each one
// sets the view it stands for.   node dev/e2e-cube.mjs
import { spawn, execFileSync } from 'node:child_process'
import { mkdtempSync, existsSync } from 'node:fs'
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
const mouseClick = async (x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
  await sleep(250)
}
const direction = () => ev(`(() => { const { camera, controls } = window.__h; return camera.position.clone().sub(controls.target).normalize().toArray() })()`)
const setDirection = (d) => ev(`(() => { const { camera, controls } = window.__h; const cur = camera.position.distanceTo(controls.target); const v = new camera.position.constructor(...${JSON.stringify(d)}).normalize().multiplyScalar(cur); camera.position.copy(controls.target).add(v); controls.update(); controls.dispatchEvent({ type: 'change' }); return true })()`).then(() => sleep(250))
const targets = () => ev(`(() => { const c = window.__h.chrome.view.cube; const r = c.el.querySelector('canvas').getBoundingClientRect(); return { rect: [r.left, r.top, r.width, r.height], list: c.targets().map((t) => ({ kind: t.kind, name: t.name, p: t.p, reachable: [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].every(([dx, dy]) => { const h = c.targetAt(t.p[0] + dx, t.p[1] + dy); return !!h && h.kind === t.kind && h.name === t.name }) })) } })()`)
const AXIS = { top: [0, 1, 0], bottom: [0, -1, 0], front: [0, 0, 1], back: [0, 0, -1], left: [-1, 0, 0], right: [1, 0, 0] }
const expected = (name) => { const v = [0, 0, 0]; for (const w of name.split('-')) AXIS[w].forEach((c, i) => (v[i] += c)); if (name === 'top' || name === 'bottom') v[2] = 0.0001 * Math.sign(v[1]) * 0 + (name === 'top' || name === 'bottom' ? 0.0001 : 0); const l = Math.hypot(...v); return v.map((c) => c / l) }
const near = (a, b, eps = 2e-3) => a.every((c, i) => Math.abs(c - b[i]) < eps)
try {
  let tries = 0
  let targetsList
  while (tries++ < 50) {
    targetsList = await fetch(`http://127.0.0.1:${chromePort}/json`).then((r) => r.json()).catch(() => null)
    if (targetsList) break
    await sleep(200)
  }
  ws = new WebSocket(targetsList.find((t) => t.type === 'page').webSocketDebuggerUrl)
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.method === 'Runtime.exceptionThrown' && !/setPointerCapture/.test(JSON.stringify(d.params))) console.error('PAGE ERROR', d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text); if (d.id && pend.has(d.id)) { pend.get(d.id)({ result: d.result, error: d.error }); pend.delete(d.id) } }
  await new Promise((r) => (ws.onopen = r))
  await send('Page.enable')
  await send('Runtime.enable')
  await setWidth(1400)
  await open(modelFile)

  const startViews = ['front', 'back', 'left', 'right', 'top', 'bottom']
  const dirs = [...startViews.map((v) => ({ label: `the view "${v}"`, exact: true, d: AXIS[v][1] ? [0, AXIS[v][1], 0.0001] : AXIS[v] })), { label: 'the corner', d: [1, 1, 1] }, { label: 'from below', d: [-1, -1, 1] }]
  for (const view of dirs) {
    await setDirection(view.d)
    const t0 = await targets()
    const reach = t0.list.filter((t) => t.reachable) // a sliver of a face (seen almost edge-on) or an edge under a corner cannot be picked itself: what covers it is the target there
    const kinds = (k) => reach.filter((t) => t.kind === k)
    check(kinds('face').length >= 3 && kinds('edge').length >= 3 && kinds('corner').length >= 3, `${view.label}: the cube is three-dimensional: ${kinds('face').length} faces, ${kinds('edge').length} edges, ${kinds('corner').length} corners can be clicked (of ${t0.list.length} drawn)`)
    // click every target in turn, from the same starting view each time
    let bad = []
    let n = 0
    for (const tg of reach) {
      await setDirection(view.d)
      const now = (await targets()).list.find((x) => x.kind === tg.kind && x.name === tg.name)
      await mouseClick(t0.rect[0] + (now.p[0] / 96) * t0.rect[2], t0.rect[1] + (now.p[1] / 96) * t0.rect[3])
      const got = await direction()
      n++
      if (!near(got, expected(tg.name))) bad.push(`${tg.kind} ${tg.name}: ${got.map((v) => v.toFixed(2))} instead of ${expected(tg.name).map((v) => v.toFixed(2))}`)
    }
    check(bad.length === 0, `${view.label}: all ${n} targets set the view they stand for${bad.length ? ' - ' + bad.slice(0, 3).join('; ') : ''}`)
  }
  // after a click on a face the cube still offers the others (the finding: a flat square 'Front' and nothing to click)
  for (const f of startViews) {
    await setDirection([1, 1, 1])
    const t1 = await targets()
    const face = t1.list.find((t) => t.kind === 'face' && t.name === f) || t1.list.find((t) => t.kind === 'face')
    await mouseClick(t1.rect[0] + (face.p[0] / 96) * t1.rect[2], t1.rect[1] + (face.p[1] / 96) * t1.rect[3])
    const after = await targets()
    check(after.list.filter((t) => t.reachable && t.kind === 'face').length >= 2 && after.list.filter((t) => t.reachable).length >= 9, `after a click on "${face.name}" the cube still shows ${after.list.length} targets (faces ${after.list.filter((t) => t.reachable && t.kind === 'face').map((t) => t.name).join(', ')})`)
  }
} catch (e) {
  console.error(e)
  failures++
} finally {
  chrome.kill()
  server.kill()
}
console.log(failures ? `\n${failures} check(s) failed` : `\nall ${total} checks passed`)
process.exit(failures ? 1 : 0)

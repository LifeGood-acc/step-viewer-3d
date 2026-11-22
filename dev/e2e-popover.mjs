#!/usr/bin/env node
// End-to-end test of the popover rules (the More menu is the first user of popover.js) and of the tabs factory, in headless Chrome through the
// plugin's harness. Works in both viewers.   node dev/e2e-popover.mjs
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
const menuOpen = () => ev(`(() => ({ hidden: document.getElementById('more-menu').hidden, expanded: document.getElementById('b-more').getAttribute('aria-expanded'), focus: document.activeElement && document.activeElement.id }))()`)
const keyDoc = (k) => ev(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, bubbles: true }))`)
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
  await send('Emulation.setDeviceMetricsOverride', { width: 420, height: 800, deviceScaleFactor: 1, mobile: false })
  await open(modelFile)
  await sleep(400)
  check(await ev(`!document.getElementById('more-wrap').hidden`), 'at 420 px the More button is there')
  let m = await menuOpen()
  check(m.hidden === true && m.expanded === 'false', 'More: closed at first')
  await press('b-more')
  m = await menuOpen()
  check(m.hidden === false && m.expanded === 'true', 'More: a click opens it')
  await keyDoc('Escape')
  m = await menuOpen()
  check(m.hidden === true && m.expanded === 'false' && m.focus === 'b-more', `More: Esc closes it and the focus goes back to the button (${JSON.stringify(m)})`)
  await press('b-more')
  await ev(`document.getElementById('stage').click()`)
  m = await menuOpen()
  check(m.hidden === true, 'More: a click outside closes it')
  await press('b-more')
  await ev(`document.getElementById('more-menu').click()`)
  check((await menuOpen()).hidden === false, 'More: a click inside the menu (not on a button) keeps it open')
  await press('b-more')
  check((await menuOpen()).hidden === true, 'More: the button closes it again')
  // Esc with the menu open does not reach the viewer: the selection stays
  const rows = await ev(`document.querySelectorAll('.part').length`)
  if (rows > 1) {
    await ev(`document.querySelector('.part[data-i="0"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))`)
    await press('b-more')
    await keyDoc('Escape')
    check((await menuOpen()).hidden === true && (await ev(`document.querySelectorAll('.part.sel').length`)) === 1, 'Esc closes the menu first and keeps the selection')
    await keyDoc('Escape')
    check((await ev(`document.querySelectorAll('.part.sel').length`)) === 0, 'the next Esc clears the selection')
  }
  // the tabs factory, made on the page
  const t = await ev(`(async () => {
    const { createTabs } = await import('./shared/popover.js')
    const list = document.createElement('div'); const a = document.createElement('div'); const b = document.createElement('div'); const c = document.createElement('div')
    document.body.append(list, a, b, c)
    const seen = []
    const tabs = createTabs({ list, tabs: [{ id: 'parts', label: 'Parts', panel: a }, { id: 'cut', label: 'Cut', panel: b }, { id: 'info', label: 'Info', panel: c }], preferred: 'parts', onChange: (id) => seen.push(id) })
    const state = () => ({ cur: tabs.current(), panels: [a, b, c].map((p) => !p.hidden), sel: [...list.children].map((x) => x.getAttribute('aria-selected')), tab: [...list.children].map((x) => x.tabIndex) })
    const out = { start: state() }
    list.children[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    out.right = state()
    list.children[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }))
    out.end = state()
    tabs.setShown(['parts', 'info'], 'cut')
    out.hiddenTab = { cur: tabs.current(), hidden: [...list.children].map((x) => x.hidden) }
    out.seen = seen
    out.roles = [list.getAttribute('role'), list.children[0].getAttribute('role'), a.getAttribute('role'), a.getAttribute('aria-labelledby') === list.children[0].id]
    list.remove(); a.remove(); b.remove(); c.remove()
    return out
  })()`)
  check(t.start.cur === 'parts' && t.start.panels.join() === 'true,false,false' && t.start.tab.join() === '0,-1,-1', 'tabs: the preferred tab is shown, only it is in the tab order')
  check(t.right.cur === 'cut' && t.right.panels.join() === 'false,true,false' && t.right.sel.join() === 'false,true,false', 'tabs: ArrowRight moves to the next tab')
  check(t.end.cur === 'info', 'tabs: End jumps to the last tab')
  check(t.hiddenTab.cur === 'parts' && t.hiddenTab.hidden.join() === 'false,true,false', 'tabs: a tab that is not shown any more is hidden and another one takes over')
  check(t.seen.join() === 'cut,info,parts', `tabs: onChange is told every change (${t.seen})`)
  check(t.roles.join() === 'tablist,tab,tabpanel,true', 'tabs: roles and aria-labelledby')
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

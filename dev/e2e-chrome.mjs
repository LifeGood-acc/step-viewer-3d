#!/usr/bin/env node
// End-to-end test of the toolbar (6 elements), the side tabs per kind of file and the measuring bar, in headless Chrome through the plugin's
// harness. Works in both viewers.   node dev/e2e-chrome.mjs
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
const shotDir = process.env.CHROME_SHOTS || '' // pictures for a report: CHROME_SHOTS=<folder> node dev/e2e-chrome.mjs
if (shotDir) mkdirSync(shotDir, { recursive: true })
const shot = async (name) => {
  if (!shotDir) return
  const r = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(shotDir, `${name}.png`), Buffer.from(r.result.data, 'base64'))
}
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
const clickRow = (i, mods = {}) => ev(`document.querySelector('.part[data-i="${i}"]').dispatchEvent(new MouseEvent('click', { bubbles: true, ...${JSON.stringify(mods)} }))`)
const selectedRows = () => ev(`[...document.querySelectorAll('.part.sel')].map((r) => Number(r.dataset.i))`)
const press = (id) => ev(`document.getElementById(${JSON.stringify(id)}).click()`)
const tabsNow = () => ev(`[...document.querySelectorAll('#side-tabs .tab')].filter((b) => !b.hidden).map((b) => b.id.replace(/^tab-\\d+-/, ''))`)
const tabLabel = (id) => ev(`[...document.querySelectorAll('#side-tabs .tab')].find((b) => b.id.endsWith(${JSON.stringify('-' + id)})).textContent`)
const current = () => ev(`document.querySelector('#side-tabs .tab[aria-selected="true"]').id.replace(/^tab-\\d+-/, '')`)
const visibleIn = (sel) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; const r = e.getBoundingClientRect(); return !e.closest('[hidden]') && r.width > 0 && r.height > 0 })()`)
try {
  let tries = 0
  let targets
  while (tries++ < 50) {
    targets = await fetch(`http://127.0.0.1:${chromePort}/json`).then((r) => r.json()).catch(() => null)
    if (targets) break
    await sleep(200)
  }
  ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl)
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.method === 'Runtime.exceptionThrown') console.error('PAGE ERROR', d.params.exceptionDetails.exception?.description); if (d.id && pend.has(d.id)) { pend.get(d.id)({ result: d.result, error: d.error }); pend.delete(d.id) } }
  await new Promise((r) => (ws.onopen = r))
  await send('Page.enable')
  await send('Runtime.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 760, deviceScaleFactor: 1, mobile: false })
  await open(modelFile)
  const L = await ev(isStep ? `window.__h.rows.map((r, i) => (r.meshes.length === 1 && !r.group ? i : -1)).filter((i) => i >= 0)` : `window.__h.parts.map((_, i) => i)`)
  // ----- the toolbar (UX v3, E1b): the six and Section, More; the sidebar button is in the status bar; Open, Diagonal and Front only from 1300 px
  const bar = await ev(`[...document.querySelectorAll('#bar > .grp > *, #bar > .grp > .pop-wrap > button, #bar .wire-seg > button, #bar > #more-wrap > button')].filter((e) => e.tagName === 'BUTTON' && !e.hidden && e.offsetParent !== null).map((e) => e.id)`)
  const six = ['b-view', 'b-surf', 'b-mesh', 'b-look', 'b-measure', 'b-cut', 'b-studio', 'b-export'] // Surface | Mesh are the two halves of one switch; Section is the seventh element since v3
  check(six.every((id) => bar.includes(id)), `the toolbar has the six and Section (${bar.join(' ')})`)
  check(!bar.includes('b-wire'), 'the page\'s own surface/mesh button is not on the bar (the two halves stand for it)')
  check(!bar.some((id) => ['b-bg', 'b-shot', 'b-grid', 'b-axes', 'b-box', 'b-back', 'preset'].includes(id)), 'no background, image, grid, axes, box or back-face button on the bar any more')
  check(bar.length <= 9, `the bar has ${bar.length} buttons at 1100 px (the six, Section, More; no file buttons, no sidebar button)`)
  check(await ev(`['b-open-bar', 'b-diag', 'b-front'].every((id) => document.getElementById(id).offsetParent === null)`), 'Open, Diagonal and Front are not on the bar below 1300 px')
  check(await ev(`!document.querySelector('#bar #b-panel') && !!document.querySelector('#status #b-panel') && document.querySelector('#status #b-panel').offsetParent !== null`), 'the sidebar button is in the status bar, not in the toolbar')
  check(await ev(`(() => { const s = document.getElementById('status').getBoundingClientRect(); const m = document.getElementById('main').getBoundingClientRect(); return s.height > 20 && Math.abs(s.top - m.bottom) < 1 && Math.abs(s.bottom - innerHeight) < 1 })()`), 'the status bar is the frame at the bottom of the window, right under the view')
  // wide window: Open, Diagonal and Front appear and do their job
  await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 760, deviceScaleFactor: 1, mobile: false })
  await sleep(500)
  check(await ev(`['b-open-bar', 'b-diag', 'b-front'].every((id) => document.getElementById(id).offsetParent !== null && !document.getElementById(id).disabled)`), 'from 1300 px the bar also has Open, Diagonal and Front')
  const camBefore = await ev(`window.__h.camera.position.toArray()`)
  await press('b-front')
  await sleep(500)
  const camFront = await ev(`window.__h.camera.position.toArray()`)
  await press('b-diag')
  await sleep(500)
  const camDiag = await ev(`window.__h.camera.position.toArray()`)
  check(JSON.stringify(camFront) !== JSON.stringify(camBefore) && JSON.stringify(camDiag) !== JSON.stringify(camFront), 'Front and Diagonal move the camera (they press the same views as the menu)')
  await send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 760, deviceScaleFactor: 1, mobile: false })
  await sleep(500)
  // Section in the bar: on = a plane in the Section tab, off = none
  check((await ev(`document.getElementById('b-cut').getAttribute('aria-pressed')`)) === 'false' && (await ev(`document.getElementById('sec-axis').value`)) === '', 'Section: off at the start')
  await press('b-cut')
  await sleep(200)
  check((await ev(`document.getElementById('b-cut').getAttribute('aria-pressed')`)) === 'true' && (await ev(`document.getElementById('sec-axis').value`)) !== '' && (await ev(`window.__h.state.clip.axis`)) !== '', 'Section: the button switches the plane on (the select and the view follow)')
  check((await current()) === 'cut', 'Section on opens the Section tab (the position is there)')
  await press('b-cut')
  await sleep(200)
  check((await ev(`document.getElementById('b-cut').getAttribute('aria-pressed')`)) === 'false' && (await ev(`window.__h.state.clip.axis`)) === '', 'Section: a second click switches it off again')
  await ev(`document.getElementById('sec-axis').value = 'x'; document.getElementById('sec-axis').dispatchEvent(new Event('change', { bubbles: true }))`)
  check((await ev(`document.getElementById('b-cut').getAttribute('aria-pressed')`)) === 'true', 'Section: choosing an axis in the tab shows in the button too')
  await ev(`document.getElementById('sec-axis').value = ''; document.getElementById('sec-axis').dispatchEvent(new Event('change', { bubbles: true }))`)
  await ev(`window.__h.chrome.tabs.select('parts')`) // back to where the rest of the test starts
  // View: show all, fit (off without selection), look from, up is
  await press('b-view')
  check(await visibleIn('#pop-view #b-viewall') && await visibleIn('#pop-view #b-view-front') && await visibleIn('#pop-view #up'), 'View menu: show all, the views, up is')
  check(await ev(`document.getElementById('b-viewfit').disabled`), 'View menu: fit the part is off without a selection (and says why)')
  await press('b-look')
  check(!(await visibleIn('#pop-view #b-viewall')) && await visibleIn('#pop-look #look-cards'), 'opening Appearance closes View (one popover at a time)')
  check((await ev(`[...document.querySelectorAll('#pop-look .menu-check')].filter((r) => !r.hidden).map((r) => r.textContent.trim())`)).some((x) => /Floor grid/.test(x)) && await visibleIn('#pop-look #look-adv summary') && (await ev(`!document.getElementById('look-adv').open`)), 'Appearance: the color cards, the helpers, Advanced folded')
  await ev(`[...document.querySelectorAll('#pop-look .menu-check')].find((r) => /Floor grid/.test(r.textContent)).querySelector('input').click()`)
  check(await visibleIn('#pop-look #look-cards') && (await ev(`document.getElementById('b-grid').getAttribute('aria-pressed')`)) === 'false', 'a switch inside Appearance keeps the menu open and sets the grid')
  await ev(`[...document.querySelectorAll('#pop-look .menu-check')].find((r) => /Floor grid/.test(r.textContent)).querySelector('input').click()`)
  await ev(`document.body.click()`)
  // ----- the redo: the bar has no file buttons, More has them; menus as lists and cards
  check(!bar.includes('b-open') && !bar.includes('b-close'), 'the file buttons are not on the bar')
  await press('b-more')
  const moreItems = await ev(`[...document.querySelectorAll('#more-menu button')].filter((b) => b.offsetParent).map((b) => b.id)`)
  check(['b-open', 'b-keys', 'b-resetprefs'].every((id) => moreItems.includes(id)), `More holds open, shortcuts, reset (${moreItems})`)
  check(!moreItems.includes('b-close') && (await ev(`document.getElementById('b-close').hidden`)), 'Close file… is not offered in the editor tab of a project file (the tab is the file)')
  await press('b-keys')
  check(await visibleIn('#keys-dialog .keys-list') && (await ev(`document.querySelectorAll('#keys-dialog dt').length`)) >= 14, 'Keyboard shortcuts: the list')
  await ev(`document.getElementById('keys-dialog').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
  check(!(await visibleIn('#keys-dialog')), 'Esc closes the list of shortcuts')
  await ev(`document.body.click()`)
  await press('b-view')
  const cam0 = await ev(`window.__h.camera.position.toArray()`)
  await press('b-view-top')
  const cam1 = await ev(`window.__h.camera.position.toArray()`)
  check(!(await visibleIn('#pop-view')) && Math.abs(cam1[1]) > Math.abs(cam0[1]) + 1e-6, 'View menu: a row (Top) turns the camera and closes the menu')
  await press('b-look')
  await ev(`document.querySelector('#look-cards input[value="solid"]').click()`)
  check((await ev(`document.getElementById('shading').value`)) === 'solid' && await visibleIn('#look-cards'), 'Appearance: the Gray card sets the shading and the menu stays')
  await ev(`document.querySelector('#look-cards input[value="tint"]').click()`)
  check((await ev(`document.getElementById('l-color').getAttribute('aria-pressed')`)) === 'true' && (await ev(`document.getElementById('shading').value`)) === 'original' && await visibleIn('#look-cards'), 'Appearance: Color per part sets it and the menu stays')
  // Appearance > Advanced > "Mesh over the surface": the surface and its mesh at the same time
  const overRow = `[...document.querySelectorAll('#look-adv .menu-check')].find((r) => /Mesh over the surface/.test(r.textContent))`
  check(await ev(`!!(${overRow})`), 'Appearance > Advanced has "Mesh over the surface"')
  const overCount = () => ev(`(() => { const g = window.__h.helpers.children.find((o) => o.name === 'mesh-over'); return g && g.visible ? g.children.filter((c) => c.visible).length : 0 })()`)
  check((await overCount()) === 0, 'mesh over the surface: off, nothing drawn')
  await ev(`(${overRow}).querySelector('input').click()`)
  await sleep(150)
  check((await overCount()) > 0 && (await ev(`window.__h.state.over`)) === true && await visibleIn('#pop-look #look-cards'), 'mesh over the surface: on, the mesh of every shown part is drawn, the menu stays')
  await shot('mesh-ueber-flaeche-an')
  const parts0 = await ev(`window.__h.parts.length`)
  const nOn = await overCount()
  await ev(`window.__h.parts[0].obj.visible = false`)
  await ev(`window.__h.controls.dispatchEvent({ type: 'change' })`)
  await sleep(200)
  check(parts0 >= 2 && (await overCount()) < nOn, `mesh over the surface: a hidden part has no mesh lines (${nOn} -> ${await overCount()} line objects)`)
  await ev(`window.__h.parts[0].obj.visible = true`)
  await ev(`(${overRow}).querySelector('input').click()`)
  await sleep(150)
  check((await overCount()) === 0, 'mesh over the surface: off again')
  await ev(`(${overRow}).querySelector('input').click()`)
  await sleep(150)
  await press('b-look-default')
  check((await ev(`document.getElementById('l-color').getAttribute('aria-pressed')`)) === 'false' && (await ev(`document.querySelector('#look-cards input[value="original"]').checked`)), 'Appearance: Default sets the original look again')
  check((await overCount()) === 0 && (await ev(`window.__h.state.over`)) === false, '"Default" turns the mesh over the surface off')
  await press('b-look-done')
  check(!(await visibleIn('#pop-look')), 'Appearance: Done closes the menu')
  await press('b-tab-close')
  check(await ev(`document.getElementById('main').classList.contains('side-closed')`), 'the panel closes with the ✕ in the tab row')
  await press('b-panel')
  // ----- tabs of a model with parts
  check((await tabsNow()).join() === 'parts,cut,info,edit', `tabs of a model with parts: ${await tabsNow()} (Measurements only after the first measurement)`)
  check((await current()) === 'parts', 'the Parts tab is shown first')
  await press('b-studio')
  check(await visibleIn('#pop-studio #st-tiles') && await visibleIn('#pop-studio #st-bg-swatches') && await visibleIn('#pop-studio #b-shot-open') && await visibleIn('#pop-studio #b-film') && !(await visibleIn('#pop-studio #b-shot')), 'Studio menu: background swatches, look tiles, save image, film')
  check(!(await visibleIn('#pop-look #shading')), 'opening Studio closes Appearance (one popover at a time)')
  check(/^Studio$/.test(await ev(`document.getElementById('b-studio').textContent.replace(/[^A-Za-z ]/g, '').trim()`)), 'Studio button: "Studio" while no look is on')
  await ev(`document.querySelector('#st-tiles [data-preset="product_white"]').click()`)
  await sleep(150)
  check(/Studio on/.test(await ev(`document.getElementById('b-studio').textContent`)) && (await ev(`document.querySelector('#st-tiles [data-preset="product_white"]').getAttribute('aria-pressed')`)) === 'true', 'a look tile switches the studio on: the button says "Studio on", the tile is marked')
  check(await visibleIn('#pop-studio #st-tiles'), 'a look tile keeps the menu open')
  await ev(`(() => { const s = document.getElementById('shading'); s.value = 'normals'; s.dispatchEvent(new Event('change', { bubbles: true })) })()`)
  check(await visibleIn('#st-unlit #st-unlit-fix'), 'a look with an unlit shading: a hint with a button')
  await press('st-unlit-fix')
  check((await ev(`document.getElementById('shading').value`)) === 'original' && !(await visibleIn('#st-unlit')), 'the button sets the shading back to Original and the hint goes')
  check(!(await visibleIn('#st-adv #st-env')), 'lights, exposure, tone are one level down (Advanced)')
  await ev(`document.getElementById('st-reset').click()`)
  await press('b-film')
  check(await visibleIn('#export-dialog') && (await ev(`document.getElementById('ex-format').value`)) === 'webm' && !(await visibleIn('#pop-studio')), 'Film… opens the export dialog on Film (the Studio menu closes)')
  await press('b-ex-close2')
  await press('b-shot-open')
  check(await visibleIn('#export-dialog') && (await ev(`document.getElementById('ex-format').value`)) === 'png', 'Save image… opens the export dialog on Image')
  await press('b-ex-close2')
  // ----- the export dialog: Image | Film | 3D file
  await ev(`document.getElementById('b-export').focus()`) // a click puts the focus on the button
  await press('b-export')
  check(await visibleIn('#export-dialog #export-kind') && await visibleIn('#export-dialog #ex-png-opts'), 'Export… opens the dialog (kinds, the image options after the earlier use)')
  check(!(await tabsNow()).includes('export'), 'there is no Export tab any more')
  const dlgText = await ev(`document.getElementById('export-dialog').textContent`)
  check(!/ch_[a-z_]+/.test(dlgText) && /Image/.test(dlgText) && /3D file/.test(dlgText), 'the dialog shows words, not string keys')
  check(!/ch_[a-z_0-9]+/.test(await ev(`document.body.innerText`)), 'no string key shows anywhere in the page')
  await ev(`document.querySelector('#export-kind [data-kind="model"]').click()`)
  check(await visibleIn('#export-dialog #ex-format') && await visibleIn('#export-dialog #ex-mesh-opts') && !(await visibleIn('#ex-png-opts')), '3D file: the format list and the options of the format')
  const fmts = await ev(`[...document.getElementById('ex-format').options].filter((o) => !o.hidden).map((o) => o.value)`)
  check(!fmts.includes('png') && !fmts.includes('webm') && !fmts.includes('glbc') && fmts.includes('glb') && fmts.includes('stl'), `3D file: the list has only 3D formats, "compressed" is the check box (${fmts})`)
  check(await visibleIn('#ex-small-row') && !(await ev(`document.getElementById('ex-small').checked`)) && !(await visibleIn('#ex-glbc-opts')), '3D file: "Make smaller" is off and shows no size options')
  await ev(`document.getElementById('ex-small').click()`)
  check((await ev(`document.getElementById('ex-format').value`)) === 'glbc' && await visibleIn('#ex-glbc-opts #ex-target'), '"Make smaller" sets the compressed GLB and shows the size it should stay under')
  await ev(`document.getElementById('ex-small').click()`)
  check((await ev(`document.getElementById('ex-format').value`)) === 'glb', 'unchecked again: the plain GLB')
  check(await visibleIn('#export-foot, .export-foot #b-ex-go') && await visibleIn('#b-ex-close2'), 'the foot has Cancel and "Save as…"')
  check(!(await visibleIn('#b-ex-make')) && !(await visibleIn('#b-ex-save')), 'the old Create copy and Save as buttons are not shown')
  await ev(`window.__savedData = null; window.__saved = null`)
  await press('b-ex-go')
  await waitFor(`!!window.__savedData`, 30000, 'one click: the copy is made and saved')
  check(/\.glb$/.test(await ev(`window.__saved.name || window.__saved.suggestedName || ''`)), `one click makes the copy and saves it (${await ev(`window.__saved.name || window.__saved.suggestedName`)})`)

  check((await ev(`!document.getElementById('ex-adv').open`)) && await visibleIn('#export-dialog #ex-adv summary'), '"Up in the copy" is one level down (Advanced)')
  await ev(`document.querySelector('#export-kind [data-kind="film"]').click()`)
  check(!(await visibleIn('#export-dialog #ex-format')) && await visibleIn('#export-dialog #ex-webm-opts'), 'Film: the video options, no format list')
  await ev(`document.getElementById('export-dialog').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
  check(!(await visibleIn('#export-dialog')) && (await ev(`document.activeElement.id`)) === 'b-export', `Esc closes the dialog and the focus goes back to Export… (focus: ${await ev('document.activeElement.id')} dialog hidden: ${!(await visibleIn('#export-dialog'))})`)
  await press('b-export')
  await press('b-ex-edit')
  check(!(await visibleIn('#export-dialog')) && (await current()) === 'edit', 'the hint leads to the Edit tab')
  await ev(`document.querySelector('[id$="-info"]').click()`)
  check(await visibleIn('#info-title') && /Whole model/.test(await ev(`document.getElementById('info-title').textContent`)) && await visibleIn('#stats'), 'Info: "Whole model" and the numbers')
  await ev(`document.querySelector('.part[data-i="0"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))`)
  await sleep(100)
  check(await visibleIn('#info-selected') && /Selected: /.test(await ev(`document.getElementById('info-selected').textContent`)), 'Info: a line names the selected part and sends to the Parts tab')
  check(await ev(`!document.getElementById('b-viewfit').disabled`), 'fit is on with a selection')
  await ev(`document.querySelector('[id$="-edit"]').click()`)
  check(await visibleIn('#tools-sec #tl-center') && await visibleIn('#tp-edit .hint'), 'Edit: the tools with the explanation on top')
  check((await ev(`document.querySelectorAll('#tl-rotate button').length`)) === 3 && (await ev(`[...document.querySelectorAll('#tl-rotate button')].map((b) => b.textContent.trim()).join()`)) === 'X,Y,Z', 'Edit: "Rotate 90°" is three buttons (X, Y, Z), not six')
  await ev(`document.querySelector('[id$="-parts"]').click()`)
  // ----- the redo of the tabs: Parts (the way to choose several), Info (unit, check), Edit (sections, Convert to)
  await ev(`document.querySelector('[id$="-parts"]').click()`)
  // the explanation is not in the card all the time: it opens behind the "?" in the card's head (UX v3 round 4), in the tab layout and in three columns
  check(!(await visibleIn('#parts-hint')) && !(await visibleIn('#parts-cap')) && await visibleIn('#b-help-parts') && (await ev(`document.getElementById('b-help-parts').getAttribute('aria-expanded')`)) === 'false', 'Parts: the hint and the line on the Δ are hidden to begin with, a "?" in the card head opens them')
  await press('b-help-parts')
  check(await visibleIn('#parts-hint') && await visibleIn('#parts-cap') && (await ev(`document.getElementById('b-help-parts').getAttribute('aria-expanded')`)) === 'true' && !(await ev(`!!document.getElementById('multi-hint')`)) && /Ctrl/.test(await ev(`document.getElementById('parts-hint').textContent`)) && /Shift/.test(await ev(`document.getElementById('parts-hint').textContent`)), 'Parts: behind the "?" one sentence (selecting, Ctrl, Shift, Esc, tick, double-click) and what the Δ means, instead of two hint lines')
  await press('b-help-parts')
  check(!(await visibleIn('#parts-hint')), 'Parts: the "?" closes it again')
  await key('Escape')
  check(await ev(`document.getElementById('l-only').disabled`), 'Parts: "Only selected" is off without a selection')
  await press('b-multi')
  check((await ev(`document.getElementById('b-multi').getAttribute('aria-pressed')`)) === 'true', 'Parts: "Select several" is on')
  await clickRow(L[0])
  await clickRow(L[2])
  check((await selectedRows()).length === 2, `Parts: with "Select several" two plain clicks choose two parts (${await selectedRows()})`)
  check(!(await ev(`document.getElementById('l-only').disabled`)), 'Parts: "Only selected" is on with a selection')
  await press('l-only')
  check((await ev(`window.__h.parts.filter((p) => p.visible).length`)) === (await ev(isStep ? `window.__h.rows[${L[0]}].meshes.length + window.__h.rows[${L[2]}].meshes.length` : '2')), 'Parts: "Only selected" shows just the chosen parts')
  await ev(`document.getElementById('l-all').click()`)
  await press('b-multi')
  await key('Escape')
  await ev(`document.querySelector('[id$="-info"]').click()`)
  check(await visibleIn('#info-unit #tl-unit') && await visibleIn('#info-actions #tl-check-btn') && await visibleIn('#info-actions #b-copy-details'), 'Info: the unit (with Set as), Check mesh and Copy numbers')
  await ev(`document.querySelector('[id$="-edit"]').click()`)
  check(await visibleIn('#tl-convert-row #tl-unit-to') && !(await visibleIn('#tl-bake-up')) && await visibleIn('#tl-status0'), 'Edit: "Convert to" is its own row, no "Make Up part of the model", and "No changes." shows')
  const heads = await ev(`[...document.querySelectorAll('#tools-sec h4.sub')].map((h) => h.textContent)`)
  check(heads.join('|') === 'Position and size|Parts|Simplify mesh', `Edit: the three headings (${heads})`)
  await ev(`(() => { const u = document.getElementById('tl-unit-to'); u.value = 'cm'; u.dispatchEvent(new Event('change', { bubbles: true })) })()`)
  await press('tl-convert')
  await waitFor(`!document.getElementById('tl-status').hidden`, 20000, 'the change after Convert to')
  check(/1 change|change/.test(await ev(`document.getElementById('tl-status').textContent`)) && !(await visibleIn('#tl-status0')), 'Edit: "Convert to" converts to the unit chosen in its own row and the status counts it')
  await press('tl-reset')
  await waitFor(`document.getElementById('tl-status').hidden`, 20000, 'back to the file')
  await ev(`document.querySelector('[id$="-parts"]').click()`)
  // ----- the measuring bar
  check(!(await visibleIn('#measure-bar')), 'no measuring bar before measuring')
  await press('b-measure')
  check(await visibleIn('#measure-bar'), 'Measure: the bar appears in the view')
  const segs = await ev(`[...document.querySelectorAll('#measure-bar .seg button')].filter((b) => !b.hidden).map((b) => b.dataset.mode)`)
  check(segs.join() === 'distance,angle,circle,edge,chain,parts', `the bar offers ${segs}`)
  await ev(`document.querySelector('#measure-bar [data-mode="angle"]').click()`)
  check((await ev(`document.getElementById('measure-mode').value`)) === 'angle' && (await ev(`document.querySelector('#measure-bar [data-mode="angle"]').getAttribute('aria-pressed')`)) === 'true', 'a segment sets the way to measure')
  await ev(`document.querySelector('#measure-bar [data-mode="parts"]').click()`)
  check((await ev(`document.getElementById('measure-mode').value`)) === 'parts', 'Measure > Parts from the bar')
  await press('b-measure-done')
  check(!(await visibleIn('#measure-bar')) && (await ev(`document.getElementById('b-measure').getAttribute('aria-pressed')`)) === 'false', 'Done ends measuring and takes the bar away')
  // ----- More: fixed content
  await send('Emulation.setDeviceMetricsOverride', { width: 420, height: 760, deviceScaleFactor: 1, mobile: false })
  await sleep(500)
  await press('b-more')
  check(await visibleIn('#more-menu #b-resetprefs'), 'More: "Reset all" is in the menu')
  check(/Reset all/.test(await ev(`document.getElementById('b-resetprefs').textContent`)), 'the reset button is called "Reset all"')
  check(await ev(`(() => { const r = document.getElementById('bar').getBoundingClientRect(); return [...document.querySelectorAll('#bar button')].filter((b) => b.offsetParent).every((b) => b.getBoundingClientRect().right <= r.right + 1) })()`), 'at 420 px every button on the bar fits')
  await ev(`document.body.click()`)
  // ----- other kinds of file
  const kinds = [['cloud.ply', 'cut,info'], ['print.gcode', 'cut,info']]
  if (!isStep) {
    for (const [name, want] of kinds) {
      await send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 760, deviceScaleFactor: 1, mobile: false })
      await open(join(samples, name))
      const got = (await tabsNow()).join()
      check(got.replace('parts,', '') === want || got === want, `${name}: tabs ${got} (wanted ${want})`)
      await press('b-export')
      await ev(`document.querySelector('#export-kind [data-kind="model"]').click()`)
      const ff = await ev(`[...document.getElementById('ex-format').options].filter((o) => !o.hidden && !o.disabled).map((o) => o.value)`)
      check(name.endsWith('ply') ? ff.join() === 'glb,ply' : ff.join() === 'glb', `${name}: the 3D file list offers only what fits the file (${ff})`)
      await press('b-ex-close2')
      if (name.endsWith('gcode')) {
        check((await tabLabel('cut')) === 'Layers', 'G-code: the section tab is called Layers')
        check(await ev(`document.getElementById('b-cut').hidden`), 'G-code: no Section button (a toolpath has layers instead)')
        await ev(`document.querySelector('[id$="-cut"]').click()`)
        check(await visibleIn('#layer-row #layer-pos') && !(await visibleIn('#sec-axis')), 'G-code: the layer slider is there, the section axis is not')
        const n = await ev(`Number(document.getElementById('layer-pos').max)`)
        await ev(`(() => { const r = document.getElementById('layer-pos'); r.value = ${Math.max(1, 1)}; r.dispatchEvent(new Event('input', { bubbles: true })) })()`)
        const down = await ev(`(() => { const o = window.__h.parts.map((p) => p.obj.material && p.obj.material.clippingPlanes).find((c) => c && c[0]); return o ? o[0].normal.toArray().map((v) => Math.abs(v) < 1e-9 ? 0 : v) : null })()`)
        check(down && ['0,-1,0', '0,0,-1'].includes(down.join()), `G-code: the plane keeps what lies below (normal ${down})`)
        check(n > 1 && /Up to layer 1 \/ /.test(await ev(`document.getElementById('layer-text').textContent`)) && (await ev(`document.getElementById('sec-axis').value`)) === 'z', `G-code: layer 1 of ${n} sets the section along Z`)
        await ev(`(() => { const r = document.getElementById('layer-pos'); r.value = r.max; r.dispatchEvent(new Event('input', { bubbles: true })) })()`)
        check((await ev(`document.getElementById('sec-axis').value`)) === '', 'G-code: the last layer shows everything again')
      }
    }
    await open(join(samples, 'bracket.stl'))
    await press('b-measure')
    const stlSegs = await ev(`[...document.querySelectorAll('#measure-bar .seg button')].filter((b) => !b.hidden).map((b) => b.dataset.mode)`)
    check(!stlSegs.includes('parts'), `one part: no "Parts" way to measure (${stlSegs})`)
  }
  // ----- Select several is off again for the next file
  await open(modelFile)
  await press('b-multi')
  await press('b-close')
  await ev(`document.querySelector('#confirm button.danger').click()`)
  await waitFor(`document.documentElement.dataset.state === 'start'`, 10000, 'the start page')
  check((await ev(`document.getElementById('b-multi').getAttribute('aria-pressed')`)) === 'false', 'closing the file switches "Select several" off')
  check(!(await visibleIn('#side-tabs')) && !(await visibleIn('#tp-info')), 'on the start page there is no tab row and no tab content (the panel only says what to do)')
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

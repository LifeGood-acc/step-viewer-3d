#!/usr/bin/env node
// End-to-end test of the Studio look in headless Chrome (the plugin's harness, no Orca): pixels of the real canvas.
//   node dev/e2e-studio.mjs [model-file-in-the-samples (default bracket.stl)] [--perf]    needs Google Chrome (or set CHROME) and python3
// Works in both viewers (it only uses what the shared Studio section puts on the page).
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
  modelFile = join(samples, process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'bracket.stl')
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
  await open(modelFile)
  await ev(`document.getElementById('b-grid').getAttribute('aria-pressed') === 'true' && document.getElementById('b-grid').click()`) // no grid lines in the pixel counts

  // ----- original: nothing of the studio is on
  const o = await corners()
  check(await ev(`document.documentElement.dataset.studio`) === 'off', 'original: the studio is off')
  check(await ev(`window.__h.renderer.toneMapping === 0 && !window.__h.scene.environment && !window.__h.renderer.shadowMap.enabled`), 'original: no tone mapping, no reflections, no shadow map')
  check(o.tl[0] > 200 && o.tl[0] < 245, `original: the usual light grey background (${o.tl})`)
  await snap('original')

  // ----- product on white
  await preset('product_white')
  const w = await corners()
  check(w.tl[0] >= 250 && w.tl[1] >= 250 && w.tl[2] >= 250, `product white: the background is white (${w.tl})`)
  check(w.tl.some((v) => v > 0) && (w.c[0] + w.c[1] + w.c[2]) > 30, 'product white: the picture is not black')
  check(await ev(`window.__h.scene.environment !== null && window.__h.renderer.toneMapping !== 0 && window.__h.renderer.shadowMap.enabled`), 'product white: reflections, tone mapping and the shadow map are on')
  await snap('studio')
  check((await diff('studio', 'original', 30)).n > 1000, 'product white: the picture differs from the original look')
  // the shadow: the same view without the floor has fewer dark pixels on the white ground
  await setCtl('st-floor', false)
  await snap('nofloor')
  const shadowPixels = await darker('studio', 'nofloor', 10)
  check(shadowPixels > 400, `shadow: ${shadowPixels} pixels are darker with the floor than without it`)
  await setCtl('st-floor', true)

  // ----- background kinds
  await setCtl('st-bg', 'gradient')
  const g = await corners()
  check(Math.abs(g.tl[0] - g.bl[0]) > 20, `gradient: the top and the bottom differ (${g.tl[0]} vs ${g.bl[0]})`)
  await preset('studio_dark')
  const d = await corners()
  check(d.tl[0] < 60 && d.tl[0] > 5, `dark studio: a dark but not black background (${d.tl})`)
  check(await ev(`document.getElementById('st-preset').value`) === 'studio_dark', 'dark studio: the preset is shown in the list')
  await setCtl('st-exposure', 2)
  check(await ev(`document.getElementById('st-preset').value`) === 'custom', 'a changed value turns the look into "Custom"')
  await setCtl('st-bg', 'transparent')
  check(await ev(`document.getElementById('gl').classList.contains('studio-clear') && window.__h.scene.background === null`), 'transparent: no scene background, the view shows a checkerboard')

  // ----- tone mapping and exposure change the picture
  await preset('product_white')
  await snap('t1')
  await setCtl('st-tone', 'aces')
  await setCtl('st-exposure', 0.5)
  await snap('t2')
  check((await diff('t1', 't2', 20)).n > 1000, 'tone mapping and exposure change the picture')

  // ----- light directions move the shadow
  await preset('product_white')
  await setCtl('st-key-a', -80)
  await snap('left')
  await setCtl('st-key-a', 80)
  await snap('right')
  check((await darker('left', 'right', 10)) > 200 && (await darker('right', 'left', 10)) > 200, 'the key light angle moves the shadow (left and right differ)')

  // ----- camera views are in the toolbar's view menu now (e2e-ux.mjs), not in the Studio section
  check(await ev(`!document.getElementById('st-cams')`), 'the Studio section has no camera buttons of its own')

  // ----- the floor lies at the model's lowest point
  const floorY = await ev(`(() => { const f = window.__h.scene.children.find((c) => c.name === 'studio').children.find((c) => c.isMesh); const { Box3 } = f.position.constructor === undefined ? {} : {}; return f.position.y })()`)
  const minY = await ev(`(() => { let m = Infinity; const { scene } = window.__h; const spin = scene.children.find((c) => c.name === 'spin'); spin.updateMatrixWorld(true); for (const p of window.__h.parts) { p.obj.updateWorldMatrix(true, false); const g = p.obj.geometry; if (!g.boundingBox) g.computeBoundingBox(); const b = g.boundingBox; for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) { const v = new p.obj.position.constructor(x, y, z).applyMatrix4(p.obj.matrixWorld); if (v.y < m) m = v.y } } return m })()`)
  const modelDiag = await ev(`(() => { const s = window.__h.scene.children.find((c) => c.name === 'spin'); const m = s.children[0]; const b = new m.position.constructor(); let mx = -Infinity, mn = Infinity; for (const p of window.__h.parts) { p.obj.geometry.computeBoundingBox(); const bb = p.obj.geometry.boundingBox; mx = Math.max(mx, bb.max.x, bb.max.y, bb.max.z); mn = Math.min(mn, bb.min.x, bb.min.y, bb.min.z) } return (mx - mn) || 1 })()`)
  check(floorY <= minY && minY - floorY < 0.002 * modelDiag, `the floor lies at the lowest point of the model (floor ${floorY.toFixed(4)}, model ${minY.toFixed(4)})`)

  // ----- turntable
  await preset('product_white')
  await setCtl('st-speed', 90)
  await ev(`document.getElementById('st-spin').click()`)
  await sleep(700)
  const turned = await ev(`(() => { const s = window.__h.scene.children.find((c) => c.name === 'spin'); return { running: document.getElementById('st-spin').textContent, e: s.matrix.elements.slice(), auto: s.matrixAutoUpdate } })()`)
  check(turned.running === 'Stop' && !turned.auto && Math.abs(turned.e[0] - 1) > 0.02, `turntable: the model turns while it runs (cos ${turned.e[0].toFixed(3)})`)
  await ev(`document.getElementById('st-spin').click()`)
  const back = await ev(`window.__h.scene.children.find((c) => c.name === 'spin').matrix.elements.slice(0, 3)`)
  check(Math.abs(back[0] - 1) < 1e-9 && Math.abs(back[2]) < 1e-9, 'turntable: stopping puts the model back')

  // ----- the key L and the reset
  await ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', bubbles: true }))`)
  check(await ev(`document.documentElement.dataset.studio`) === 'off', 'key L switches the studio look off')
  await ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', bubbles: true }))`)
  check(await ev(`document.documentElement.dataset.studio`) !== 'off', 'key L switches it on again')
  // a custom look comes back when L is pressed twice
  await preset('product_white')
  await setCtl('st-exposure', 1.7)
  await ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', bubbles: true }))`)
  await ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', bubbles: true }))`)
  check(await ev(`document.getElementById('st-exposure').value`) === '1.7', 'key L twice: the custom exposure is still there')
  // elevation 90 for the key light must not break the picture (a shadow camera looking straight down)
  await setCtl('st-key-e', 90)
  await snap('top-light')
  await setCtl('st-floor', false)
  await snap('top-light-nofloor')
  await setCtl('st-floor', true)
  check((await darker('top-light', 'top-light-nofloor', 10)) > 100, 'key light straight above: the shadow is still drawn')
  // switching to the original while the turntable runs ends it
  await ev(`document.getElementById('st-spin').click()`)
  await sleep(200)
  await ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', bubbles: true }))`)
  check(await ev(`document.getElementById('st-spin').textContent`) === 'Start' && await ev(`window.__h.scene.children.find((c) => c.name === 'spin').matrix.elements[0] === 1`), 'the look off: the turntable stops and the model is back')
  await ev(`document.getElementById('st-reset').click()`)
  await snap('after')
  check(await ev(`document.documentElement.dataset.studio`) === 'off' && (await diff('after', 'original', 1)).n === 0, 'reset: the picture is exactly the original again')

  // ----- remembered across a reload
  await preset('gradient_grey')
  await open(modelFile)
  check(await ev(`document.getElementById('st-preset').value`) === 'gradient_grey' && await ev(`document.documentElement.dataset.studio`) === 'gradient_grey', 'the look is remembered')
  await ev(`document.getElementById('b-resetprefs').click()`)
  check(await ev(`document.documentElement.dataset.studio`) === 'off', '"Reset settings" also resets the look')

  // (the Background button is checked in e2e-ux.mjs)
  // ----- labels of the lists in a narrow panel: label above the choice, full text as tooltip
  check(await ev(`[...document.querySelectorAll('#studio-sec select:not(#st-bgmode)')].every((sel) => sel.closest('label').classList.contains('stack') && sel.title.length > 0)`), 'studio lists: label above the choice and the full text as tooltip')
  // ----- a PNG with a transparent background says what viewers do with it
  await ev(`(() => { const f = document.getElementById('ex-format'); f.value = 'png'; f.dispatchEvent(new Event('change', { bubbles: true })); const b = document.getElementById('ex-png-bg'); b.value = 'transparent'; b.dispatchEvent(new Event('change', { bubbles: true })) })()`)
  check(await ev(`!document.getElementById('ex-png-hint').hidden && /black|schwarz/.test(document.getElementById('ex-png-hint').textContent)`), 'PNG with a transparent background: the panel warns that many viewers show it black')
  await ev(`(() => { const b = document.getElementById('ex-png-bg'); b.value = 'shown'; b.dispatchEvent(new Event('change', { bubbles: true })) })()`)
  check(await ev(`document.getElementById('ex-png-hint').hidden`), 'PNG as shown: no such warning')
  // ----- a flat, wide scene (a landscape): the shadow shows on the scene itself, not only on a floor it hides
  if (!isStep) {
    const { writeGLB } = await import('../editor/shared/export.js')
    const n = 80
    const P = new Float32Array((n + 1) * (n + 1) * 3)
    let k = 0
    for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
      const x = (i / n - 0.5) * 10, z = (j / n - 0.5) * 10
      P[k++] = x
      P[k++] = 0.35 * Math.sin(x * 1.3) * Math.cos(z * 1.1) + (Math.hypot(x - 1, z) < 0.6 ? 1.2 : 0) // hills and one spike
      P[k++] = z
    }
    const I = new Uint32Array(n * n * 6)
    let q = 0
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const a = j * (n + 1) + i, b = a + n + 1
      I.set([a, b, a + 1, a + 1, b, b + 1], q)
      q += 6
    }
    const land = join(samples, 'land.glb')
    writeFileSync(land, writeGLB([{ name: 'land', kind: 'mesh', positions: P, normals: null, indices: I, colors: null, color: [120, 170, 90] }]))
    await open(land)
    await preset('product_white')
    await setCtl('st-key-e', 22)
    await snap('land-on')
    await setCtl('st-floor', false)
    await snap('land-off')
    await setCtl('st-floor', true)
    check((await darker('land-on', 'land-off', 12)) > 500, `landscape: the shadow of the hills and the spike shows on the scene (${await darker('land-on', 'land-off', 12)} pixels)`)
    check(await ev(`window.__h.parts.every((p) => p.obj.receiveShadow === true)`), 'landscape: the model receives shadows (flat and wide)')
    await open(modelFile)
    await preset('product_white')
    check(await ev(`window.__h.parts.every((p) => p.obj.receiveShadow === false)`), 'a compact object does not receive shadows itself')
  }
  // ----- exports in the studio look
  await preset('product_white')
  await setCtl('st-bg', 'transparent')
  const exp = async (fmt, opts) => {
    await ev(`(() => { window.__savedData = null; const f = document.getElementById('ex-format'); f.value = ${JSON.stringify(fmt)}; f.dispatchEvent(new Event('change', { bubbles: true })); for (const [id, v] of Object.entries(${JSON.stringify(opts)})) { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })) } document.getElementById('b-ex-make').click() })()`)
    await waitFor(`document.documentElement.dataset.export === 'ready' || (!document.getElementById('ex-result').hidden && document.documentElement.dataset.export === 'idle')`, 120000, 'the export')
    if (await ev(`document.documentElement.dataset.export !== 'ready'`)) return { error: await ev(`document.getElementById('ex-result').textContent`) }
    await ev(`document.getElementById('b-ex-save').click()`)
    await waitFor(`!!window.__savedData`, 20000, 'the Save dialog call')
    return { b64: await ev(`(() => { const u = new Uint8Array(window.__savedData); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s) })()`) }
  }
  const png = await exp('png', { 'ex-png-size': 'x2', 'ex-png-bg': 'transparent' })
  if (png.error) check(false, `png: ${png.error}`)
  else {
    const info = await ev(`(async () => { const bmp = await createImageBitmap(new Blob([Uint8Array.from(atob(${JSON.stringify(png.b64)}), (c) => c.charCodeAt(0))])); const cv = new OffscreenCanvas(bmp.width, bmp.height); const g = cv.getContext('2d', { willReadFrequently: true }); g.drawImage(bmp, 0, 0); const d = g.getImageData(0, 0, bmp.width, bmp.height).data; let clear = 0, soft = 0, solid = 0; for (let i = 3; i < d.length; i += 4) { if (d[i] === 0) clear++; else if (d[i] < 255) soft++; else solid++ } return { w: bmp.width, h: bmp.height, clear, soft, solid, corner: d[3], cw: document.getElementById('gl').clientWidth, ch: document.getElementById('gl').clientHeight } })()`)
    check(Math.max(info.w, info.h) === 2 * Math.max(info.cw, info.ch), `png 2x: ${info.w} x ${info.h} for a view of ${info.cw} x ${info.ch}`)
    check(info.corner === 0 && info.clear > 0.3 * info.w * info.h, `png: the background is transparent (${((100 * info.clear) / (info.w * info.h)).toFixed(0)} % clear)`)
    check(info.soft > 1000, `png: the soft shadow keeps partial transparency (${info.soft} pixels)`)
    check(info.solid > 0.02 * info.w * info.h, 'png: the model itself is opaque')
  }
  await setCtl('st-bg', 'solid')
  const webm = await exp('webm', { 'ex-seconds': '4', 'ex-webm-size': '1280' })
  if (webm.error) check(false, `webm: ${webm.error}`)
  else {
    const f = join(dir, 'studio.webm')
    writeFileSync(f, Buffer.from(webm.b64, 'base64'))
    let probe = ''
    try { probe = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,width,height', '-of', 'csv=p=0', f]).toString().trim() } catch (e) { probe = `ffprobe failed ${e.message}` }
    const [codec, ww, hh] = probe.split(',')
    check(/vp[89]/.test(codec) && Math.max(Number(ww), Number(hh)) === 1280, `webm in the studio look: ${probe}`)
  }
  check(await ev(`window.__h.scene.children.find((c) => c.name === 'spin').matrix.elements[0] === 1`), 'webm: the model is back in place after the film')

  // ----- pictures of the presets (only with --shots <folder>)
  const si = process.argv.indexOf('--shots')
  if (si > 0) {
    const out = process.argv[si + 1]
    execFileSync('mkdir', ['-p', out])
    await open(isStep ? modelFile : join(samples, 'bracket.stl'))
    await ev(`document.getElementById('b-grid').getAttribute('aria-pressed') === 'true' && document.getElementById('b-grid').click()`)
    await ev(`document.getElementById('b-axes').getAttribute('aria-pressed') === 'true' && document.getElementById('b-axes').click()`)
    for (const pr of ['original', 'product_white', 'studio_dark', 'gradient_grey', 'soft_daylight']) {
      await preset(pr)
      await setCtl('preset', 'iso')
      await sleep(400)
      const r = await send('Page.captureScreenshot', { format: 'png' })
      writeFileSync(join(out, `studio-${pr}.png`), Buffer.from(r.result.data, 'base64'))
    }
  }
  if (si > 0) {
    const out = process.argv[si + 1]
    await preset('product_white')
    for (const [w, h] of [[1100, 800], [420, 900]]) {
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false })
      await ev(`(() => { const s = document.getElementById('studio-sec'); s.open = true; document.getElementById('st-lights').open = true; s.scrollIntoView() })()`)
      await sleep(400)
      const r = await send('Page.captureScreenshot', { format: 'png' })
      writeFileSync(join(out, `studio-panel-${w}.png`), Buffer.from(r.result.data, 'base64'))
      const overflow = await ev(`(() => { const s = document.getElementById('studio-sec'); return [...s.querySelectorAll('*')].filter((e) => e.getBoundingClientRect().right > s.getBoundingClientRect().right + 1).length })()`)
      check(overflow === 0, `layout ${w} px: nothing in the Studio section sticks out (${overflow} elements)`)
    }
    await send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 700, deviceScaleFactor: 1, mobile: false })
  }
  // ----- performance with a large mesh
  if (process.argv.includes('--perf')) {
    const { writeGLB } = await import('../editor/shared/export.js')
  for (const [nu, nv] of [[700, 350], [1100, 550], [1500, 750]]) {
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
    const bench = (n) => ev(`(() => { const { renderer, scene, camera } = window.__h; const gl = renderer.getContext(); const px = new Uint8Array(4); renderer.render(scene, camera); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); const t0 = performance.now(); for (let i = 0; i < ${n}; i++) { camera.position.x += 0.0001; renderer.render(scene, camera) } gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); return (performance.now() - t0) / ${n} })()`)
    const tris = await ev(`window.__h.parts.reduce((a, p) => a + p.tris, 0)`)
    const base = await bench(30)
    await preset('product_white')
    const live = await bench(30)
    await setCtl('st-quality', 'high')
    const high = await bench(30)
    const policy = await ev(`document.getElementById('st-note').textContent`)
    console.log(`info ${tris} triangles: original ${base.toFixed(1)} ms/frame, studio ${live.toFixed(1)} ms/frame, studio high ${high.toFixed(1)} ms/frame (${policy || 'shadows live'})`)
    check(live < Math.max(4 * base, base + 25), `perf: the studio look does not collapse the frame rate (${base.toFixed(1)} -> ${live.toFixed(1)} ms)`)
  }
  }
  console.log(failures ? `\n${failures} check(s) failed` : `\nall ${results.filter((r) => !r.startsWith('info')).length} checks passed`)
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

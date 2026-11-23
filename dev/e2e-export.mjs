#!/usr/bin/env node
// End-to-end test of "Export a copy" in headless Chrome (through the harness, which stands in for Orca's Save dialog): opens the
// sample STEP file, makes a copy in every format, saves it (the stand-in keeps the bytes), and, when the sibling 3D Model Viewer
// folder is there (../model-viewer-3d), opens each copy in that viewer to compare what it shows with what this viewer showed.
//   node dev/e2e-export.mjs [keep]        needs Google Chrome (or set CHROME) and python3
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const sample = join(here, '..', 'samples', 'assembly.step')
const modelHarness = join(here, '..', '..', 'model-viewer-3d', 'dev', 'harness_server.py')
const dir = mkdtempSync(join(tmpdir(), 'step-e2e-'))
const out = join(dir, 'copies')
spawnSync('mkdir', ['-p', out])
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const rnd = Math.floor(Math.random() * 80)
const port = 8700 + rnd
const port2 = 8800 + rnd
const chromePort = 9200 + rnd
const server = spawn('python3', [join(here, 'harness_server.py'), String(port)], { stdio: 'ignore' })
const server2 = existsSync(modelHarness) ? spawn('python3', [modelHarness, String(port2)], { stdio: 'ignore' }) : null
const chrome = spawn(process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', `--remote-debugging-port=${chromePort}`, '--use-angle=metal', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--no-first-run',
  `--user-data-dir=${join(dir, 'profile')}`, 'about:blank'
], { stdio: 'ignore' })

let failures = 0
const results = []
const check = (ok, what) => {
  results.push(`${ok ? 'ok  ' : 'FAIL'} ${what}`)
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
async function waitFor(expr, ms = 120000, what = expr) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    if (await ev(expr)) return
    await sleep(150)
  }
  throw new Error(`timeout waiting for ${what}`)
}
// the three sizes are the row X, Y, Z at the top of the Info card (UX v3 round 4), no longer a line of the list
const shownExpr = `(() => {
  const dd = [...document.querySelectorAll('#stats dd, #stats-more dd')].map((e) => e.textContent)
  const dt = [...document.querySelectorAll('#stats dt, #stats-more dt')].map((e) => e.textContent)
  const num = (label) => ((dd[dt.indexOf(label)] || '').replace(/\\u2212/g, '-').replace(/,/g, '').match(/-?\\d+(\\.\\d+)?/g) || []).map(Number)
  const parts = window.__h.parts
  return { state: document.documentElement.dataset.state, parts: parts.length, tris: parts.reduce((a, p) => a + (p.tris || 0), 0),
    extent: [...document.querySelectorAll('#info-dims-row .dim-n')].map((e) => Number(e.textContent.replace(/\\u2212/g, '-').replace(/,/g, ''))), height: num('Height range').slice(0, 2), unit: dd[dt.indexOf('Unit')] || '' }
})()`
const sameExtent = (a, b) => a.length === 3 && b.length === 3 && [...a].sort((x, y) => x - y).every((v, i) => Math.abs(v - [...b].sort((x, y) => x - y)[i]) <= 0.01 * Math.max(1, Math.abs(v)))
const sameHeight = (a, b) => a.length === 2 && b.length === 2 && a.every((v, i) => Math.abs(v - b[i]) <= 0.01 * Math.max(1, Math.abs(b[i])))

async function exportCopy(fmt, opts = {}) {
  await ev(`(() => {
    window.__savedData = null
    const f = document.getElementById('ex-format'); f.value = ${JSON.stringify(fmt)}; f.dispatchEvent(new Event('change', { bubbles: true }))
    for (const [id, v] of Object.entries(${JSON.stringify(opts)})) {
      const el = document.getElementById(id)
      if (el.type === 'checkbox') el.checked = v; else el.value = v
      el.dispatchEvent(new Event('change', { bubbles: true }))
    }
    document.getElementById('b-ex-make').click()
  })()`)
  await waitFor(`document.documentElement.dataset.export === 'ready' || (document.documentElement.dataset.export === 'idle' && !document.getElementById('ex-result').hidden && document.getElementById('ex-result').textContent.startsWith('The copy could not'))`, 120000, `${fmt} copy`)
  const text = await ev(`document.getElementById('ex-result').textContent`)
  if (await ev(`document.documentElement.dataset.export !== 'ready'`)) return { error: text }
  await ev(`document.getElementById('b-ex-save').click()`)
  await waitFor(`!!window.__savedData`, 20000, 'the Save dialog call')
  const meta = await ev(`({ ...window.__saved })`)
  const b64 = await ev(`(() => { const u = new Uint8Array(window.__savedData); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s) })()`)
  return { bytes: Buffer.from(b64, 'base64'), name: meta.name, mime: meta.mime, text }
}

try {
  let targets
  for (let i = 0; i < 60; i++) { try { targets = await (await fetch(`http://127.0.0.1:${chromePort}/json`)).json(); if (targets.length) break } catch {} await sleep(250) }
  ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl)
  await new Promise((r) => (ws.onopen = r))
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id) } }
  await send('Page.enable')
  const openStep = async () => {
    await send('Page.navigate', { url: `http://127.0.0.1:${port}/h/index.html?file=${encodeURIComponent(sample)}&lang=en&q=coarse` })
    await sleep(300)
    await waitFor(`document.documentElement.dataset.state === 'ok' && !document.getElementById('stats-sec').hidden`, 180000, 'the STEP file')
  }
  await openStep()
  const src = await ev(shownExpr)
  check(src.parts >= 2 && src.tris > 100, `assembly.step: ${src.parts} parts, ${src.tris} triangles, unit ${src.unit}`)
  const copies = {}
  for (const fmt of ['glb', 'glbc', 'stl', 'obj', 'ply', '3mf']) {
    const c = await exportCopy(fmt)
    if (c.error) { check(false, `${fmt}: ${c.error}`); continue }
    writeFileSync(join(out, c.name), c.bytes)
    copies[fmt] = c
    check(c.bytes.length > 100 && c.name === (fmt === 'glbc' ? 'model-compressed.glb' : `model.${fmt}`), `${fmt}: ${c.name}, ${c.bytes.length} bytes, ${c.mime}`)
    if (fmt === '3mf') check(spawnSync('unzip', ['-tq', join(out, c.name)]).status === 0, '3mf: unzip -t accepts the archive')
  }
  // hidden parts stay out
  await ev(`[...document.querySelectorAll('#parts input[type=checkbox]')].pop().click()`)
  const hidden = await exportCopy('stl', { 'ex-visible': true })
  const all = await exportCopy('stl', { 'ex-visible': false })
  check(!hidden.error && !all.error && hidden.bytes.length < all.bytes.length, `stl: a hidden part is left out (${hidden.error || hidden.bytes.length} < ${all.error || all.bytes.length} bytes)`)
  await openStep()
  // the panel frame is built anew (Orca does it when the sidebar is closed and opened): the last dropped file comes back
  const panelUrl = `http://127.0.0.1:${port}/h/index.html?nodoc=1&lang=en&q=coarse`
  await send('Page.navigate', { url: panelUrl })
  await sleep(300)
  await waitFor(`document.documentElement.dataset.state === 'start'`, 20000, 'the panel start page')
  await ev(`(async () => { const r = await fetch('/file?p=' + encodeURIComponent(${JSON.stringify(sample)})); const bytes = await r.arrayBuffer()
    const dt = new DataTransfer(); dt.items.add(new File([bytes], 'my assembly.step')); const inp = document.getElementById('file-input'); inp.files = dt.files; inp.dispatchEvent(new Event('change')) })()`)
  await waitFor(`document.documentElement.dataset.state === 'ok' && !document.getElementById('stats-sec').hidden`, 180000, 'the dropped STEP file')
  await ev(`document.getElementById('b-wire').click()`)
  await ev(`(() => { const h = window.__h; h.camera.position.set(90, 70, 110); h.controls.target.set(5, 10, 0); h.controls.update(); h.controls.dispatchEvent({ type: 'end' }) })()`)
  await sleep(1200)
  const camBefore = await ev(`window.__h.camera.position.toArray().map((v) => +v.toFixed(2))`)
  check(/my assembly\.step/.test(await ev(`document.getElementById('keep-text').textContent`)), 'kept: the panel says which file it keeps')
  await send('Page.navigate', { url: panelUrl }) // a new frame, as Orca makes it
  await sleep(400)
  await waitFor(`document.documentElement.dataset.state === 'ok' && !document.getElementById('stats-sec').hidden`, 180000, 'the restored STEP file')
  const back = await ev(shownExpr)
  check(back.state === 'ok' && back.parts === src.parts && back.tris === src.tris, `kept: the file is back after the frame was rebuilt (${back.parts} parts, ${back.tris} triangles)`)
  const camAfter = await ev(`window.__h.camera.position.toArray().map((v) => +v.toFixed(2))`)
  check(JSON.stringify(camAfter) === JSON.stringify(camBefore), `kept: the camera is back (${camAfter.join(', ')})`)
  check(await ev(`document.getElementById('b-wire').getAttribute('aria-pressed') === 'true'`), 'kept: the wireframe switch is back')
  await ev(`document.getElementById('b-close').click()`)
  await ev(`document.querySelector('#confirm button.danger').click()`)
  await sleep(300)
  await send('Page.navigate', { url: panelUrl })
  await sleep(400)
  await waitFor(`document.documentElement.dataset.state === 'start'`, 20000, 'the start page after forgetting')
  check(await ev(`document.getElementById('keep-row').hidden`), 'kept: after "Close" the next frame starts empty')
  await openStep()

  // E3: shading choices, measuring modes, the numbers in the Details, Copy details
  for (const sh of ['xray', 'matcap', 'flat', 'vertex', 'normals', 'original']) {
    await ev(`(() => { const s = document.getElementById('shading'); s.value = ${JSON.stringify(sh)}; s.dispatchEvent(new Event('change')) })()`)
    await sleep(120)
    const m = await ev(`(() => { const m = window.__h.parts[0].obj.material; return { type: m.type, transparent: m.transparent, flat: !!m.flatShading } })()`)
    const ok = { xray: m.type === 'MeshBasicMaterial' && m.transparent, matcap: m.type === 'MeshMatcapMaterial', flat: m.flat, vertex: m.type === 'MeshStandardMaterial' || m.type === 'MeshBasicMaterial', normals: m.type === 'MeshNormalMaterial', original: m.type === 'MeshStandardMaterial' }[sh]
    check(ok, `shading "${sh}" gives ${m.type}`)
  }
  const clickAt = (fx, fy) => ev(`(() => { const c = document.getElementById('gl'); const r = c.getBoundingClientRect(); const x = r.left + r.width * ${fx}, y = r.top + r.height * ${fy}
    const o = { clientX: x, clientY: y, button: 0, bubbles: true, pointerId: 1, isPrimary: true }; c.dispatchEvent(new PointerEvent('pointerdown', o)); c.dispatchEvent(new PointerEvent('pointerup', o)) })()`)
  for (const [mode, pts, rx] of [['angle', [[0.45, 0.62], [0.5, 0.6], [0.55, 0.66]], /Angle: [\d.]+°/], ['edge', [[0.5, 0.64]], /Edge length/]]) {
    await ev(`(() => { const s = document.getElementById('measure-mode'); s.value = ${JSON.stringify(mode)}; s.dispatchEvent(new Event('change')) })()`)
    for (const [fx, fy] of pts) await clickAt(fx, fy)
    const txt = await ev(`document.getElementById('measure-out').textContent`)
    check(rx.test(txt), `measure mode "${mode}": ${txt.slice(0, 70)}`)
  }
  await ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
  await waitFor(`[...document.querySelectorAll('#stats dt, #stats-more dt')].some((e) => e.textContent === 'Watertight')`, 30000, 'the background mesh check')
  check(/Watertight/.test(await ev(`document.getElementById('stats').textContent`)) && /Surface area/.test(await ev(`document.getElementById('stats').textContent`)), 'Details: the mesh check numbers appear')
  await ev(`document.getElementById('b-copy-details').click()`)
  check(/Details copied|Copying is not possible/.test(await ev(`document.getElementById('msg-text').textContent`)), 'Copy details answers')
  // Tools: the working copy changes, the export writes it
  const click = (id) => ev(`document.getElementById(${JSON.stringify(id)}).click()`)
  const idle = () => waitFor(`document.documentElement.dataset.tools === 'idle' && !document.getElementById('tl-result').textContent.startsWith('Working')`, 60000, 'the tool')
  check(await ev(`document.getElementById('tl-parts-group').hidden`), 'tools: parts removal is not offered (the parts are an assembly tree)')
  await ev(`document.getElementById('tl-unit').value = 'cm'; document.getElementById('tl-unit-to').value = 'cm'`)
  await click('tl-convert'); await idle()
  const cm = await ev(shownExpr)
  check(Math.abs(cm.height[1] - src.height[1] / 10) < 0.01 * src.height[1] && /\(set by you\)/.test(cm.unit), `tools: mm to cm (${cm.height.join(' … ')}, ${cm.unit})`)
  await click('tl-floor'); await idle()
  check(Math.abs((await ev(shownExpr)).height[0]) < 1e-6, 'tools: on the floor')
  const tools3mf = await exportCopy('3mf')
  writeFileSync(join(out, 'tools.3mf'), tools3mf.bytes)
  check(!tools3mf.error && /unit="centimeter"/.test(spawnSync('unzip', ['-p', join(out, 'tools.3mf'), '3D/3dmodel.model'], { encoding: 'utf8' }).stdout), 'tools: the 3MF written after the unit change says centimeter')
  await ev(`(() => { const k = document.getElementById('tl-keep'); k.value = '40'; document.getElementById('tl-detail').value = 'target' })()`)
  const trisBefore = (await ev(shownExpr)).tris
  await click('tl-decimate'); await idle()
  const dec = await ev(shownExpr)
  check(dec.tris < trisBefore * 0.7, `tools: decimate ${trisBefore} to ${dec.tris} triangles`)
  const dcopy = await exportCopy('stl')
  check(!dcopy.error && dcopy.bytes.length === 84 + 50 * dec.tris, `tools: the STL has the decimated ${dec.tris} triangles`)
  await click('tl-check-btn'); await idle()
  check(/Closed \(watertight\)/.test(await ev(`document.getElementById('tl-check').textContent`)), 'tools: mesh check runs')
  await click('tl-reset'); await idle()
  check((await ev(shownExpr)).tris === trisBefore, 'tools: reset restores the model')
  // PNG with a transparent background, and the turntable
  const png = await exportCopy('png', { 'ex-png-size': '1920', 'ex-png-bg': 'transparent' })
  if (png.error) check(false, `png: ${png.error}`)
  else {
    const info = await ev(`(async () => { const bmp = await createImageBitmap(new Blob([new Uint8Array(window.__savedData)])); const cv = new OffscreenCanvas(bmp.width, bmp.height); const g = cv.getContext('2d'); g.drawImage(bmp, 0, 0); return { w: bmp.width, h: bmp.height, a: g.getImageData(0, 0, 1, 1).data[3] } })()`)
    check(Math.max(info.w, info.h) === 1920 && info.a === 0, `png: ${info.w} x ${info.h}, corner alpha ${info.a}`)
  }
  const webm = await exportCopy('webm', { 'ex-seconds': '4' })
  check(!webm.error && webm.bytes.subarray(0, 4).toString('hex') === '1a45dfa3', `webm: ${webm.error || webm.bytes.length + ' bytes, EBML header'}`)

  // E6: CAD edges (where B-rep faces meet), the folding assembly tree
  {
    await openStep()
    const edgeInfo = () => ev(`(() => ({ pressed: document.getElementById('b-edges').getAttribute('aria-pressed'), segs: window.__h.parts.reduce((a, p) => a + (p.edgeObj && p.edgeObj.visible ? p.edgeObj.geometry.getAttribute('position').count / 2 : 0), 0), parts: window.__h.parts.filter((p) => p.edgeObj).length }))()`)
    await waitFor(`window.__h.parts.every((p) => p.edgeObj)`, 20000, 'the edges, on from the start')
    const on = await edgeInfo()
    check(on.pressed === 'true' && on.parts === 4 && on.segs > 40 && on.segs < 400, `edges: ${on.segs} CAD edges on ${on.parts} parts (not the ${src.tris} triangles' own edges)`)
    check(on.segs < src.tris, 'edges: far fewer lines than the triangulation would give')
    await click('b-edges')
    check((await edgeInfo()).segs === 0, 'edges: switched off again')
    await click('b-edges')
    await ev(`document.getElementById('sec-axis').value = 'z'; document.getElementById('sec-axis').dispatchEvent(new Event('change', { bubbles: true }))`)
    check(await ev(`window.__h.parts.every((p) => !p.edgeObj || (p.edgeObj.material.clippingPlanes && p.edgeObj.material.clippingPlanes.length === 1))`), 'edges: the section plane cuts the lines too')
    await ev(`document.getElementById('sec-axis').value = ''; document.getElementById('sec-axis').dispatchEvent(new Event('change', { bubbles: true }))`)
    const png2 = await exportCopy('png', { 'ex-png-size': '0', 'ex-png-bg': 'shown' })
    check(!png2.error, 'edges: the picture of the view is made with the edges on')
    // a tool that only moves or scales the model: the edges stay (they are children of the parts) and nothing is said
    await ev(`document.getElementById('tl-unit').value = 'cm'; document.getElementById('tl-unit-to').value = 'cm'`)
    await click('tl-convert'); await idle()
    const kept = await edgeInfo()
    check(kept.pressed === 'true' && kept.parts === 4 && kept.segs === on.segs, 'edges: a unit change keeps them (the lines follow the parts)')
    // a tool that replaces the triangles: the edges of those parts are the sharp edges now, with a note
    await ev(`(() => { const k = document.getElementById('tl-keep'); k.value = '40'; document.getElementById('tl-detail').value = 'target' })()`)
    await click('tl-decimate'); await idle()
    const changedInfo = await edgeInfo()
    check(changedInfo.pressed === 'true' && changedInfo.segs > 0 && /sharp edges/i.test(await ev(`document.getElementById('msg-text').textContent`)), `edges: after Decimate the lines are the sharp edges of the new triangles (${changedInfo.segs})`)
    // the tree: the assembly rows fold
    await openStep()
    const tree = () => ev(`[...document.querySelectorAll('#parts .part')].map((r) => ({ name: r.querySelector('.nm').textContent, d: Number(r.style.getPropertyValue('--d')), fold: !!r.querySelector('button.tw') }))`)
    const full = await tree()
    const g = full.findIndex((r) => r.fold)
    check(g >= 0, `tree: a group row has a fold button (${full.map((r) => r.name + '@' + r.d).join(', ')})`)
    if (g >= 0) {
      await ev(`document.querySelectorAll('#parts .part')[${g}].querySelector('.tw').click()`)
      const folded = await tree()
      check(folded.length < full.length && folded[g].fold, `tree: folding ${full[g].name} hides its ${full.length - folded.length} rows`)
      await ev(`document.querySelectorAll('#parts .part')[${g}].querySelector('.tw').click()`)
      check((await tree()).length === full.length, 'tree: unfolding shows them again')
    }
  }

  // E6 follow-up: values and views
  {
    await openStep()
    // a narrow, tall panel still shows the whole model after loading
    await send('Emulation.setDeviceMetricsOverride', { width: 360, height: 720, deviceScaleFactor: 1, mobile: false })
    await openStep()
    await sleep(300)
    const worst = await ev(`(() => { const h = window.__h; let w = 0; const V = h.camera.position.constructor; for (const p of h.parts) { p.obj.geometry.computeBoundingBox(); const b = p.obj.geometry.boundingBox; p.obj.updateWorldMatrix(true, false); for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) { const v = new V(x, y, z).applyMatrix4(p.obj.matrixWorld).project(h.camera); w = Math.max(w, Math.abs(v.x), Math.abs(v.y)) } } return w })()`)
    check(worst < 1, `a 360 x 720 view shows the whole assembly after loading (largest screen coordinate ${worst.toFixed(2)})`)
    await send('Emulation.clearDeviceMetricsOverride')
    await sleep(500)
    // edge length: a CAD edge, not a triangle edge
    const clickAt = (fx, fy) => ev(`(() => { const c = document.getElementById('gl'); const r = c.getBoundingClientRect(); const x = r.left + r.width * ${fx}, y = r.top + r.height * ${fy}; const o = { clientX: x, clientY: y, button: 0, bubbles: true, pointerId: 1, isPrimary: true }; c.dispatchEvent(new PointerEvent('pointerdown', o)); c.dispatchEvent(new PointerEvent('pointerup', o)) })()`)
    await ev(`(() => { const b = document.getElementById('b-measure'); if (b.getAttribute('aria-pressed') !== 'true') b.click(); const s = document.getElementById('measure-mode'); s.value = 'edge'; s.dispatchEvent(new Event('change')) })()`)
    // a click in the middle of the top face of the biggest part (the base plate)
    await ev(`(() => { const h = window.__h; let best = null; for (const p of h.parts) { p.obj.geometry.computeBoundingBox(); const bb = p.obj.geometry.boundingBox; const a = (bb.max.x - bb.min.x) * (bb.max.y - bb.min.y); if (!best || a > best.a) best = { a, p, bb } } const { p, bb } = best; p.obj.updateWorldMatrix(true, false); const V = h.camera.position.constructor; const v = new V((bb.min.x + bb.max.x) / 2 + (bb.max.x - bb.min.x) * 0.25, (bb.min.y + bb.max.y) / 2, bb.max.z).applyMatrix4(p.obj.matrixWorld).project(h.camera); const c = document.getElementById('gl'); const r = c.getBoundingClientRect(); const x = r.left + r.width * (v.x + 1) / 2, y = r.top + r.height * (1 - v.y) / 2; const o = { clientX: x, clientY: y, button: 0, bubbles: true, pointerId: 1, isPrimary: true }; c.dispatchEvent(new PointerEvent('pointerdown', o)); c.dispatchEvent(new PointerEvent('pointerup', o)) })()`)
    const et = await ev(`document.getElementById('measure-out').textContent`)
    check(/Edge length/.test(et) && !/Triangle edge/.test(et), `edge length on a STEP part is a CAD edge ("${et.slice(0, 60)}")`)
  }

  // open every copy in the 3D Model Viewer and compare
  if (server2) {
    for (const [fmt, c] of Object.entries(copies)) {
      await send('Page.navigate', { url: `http://127.0.0.1:${port2}/h/index.html?file=${encodeURIComponent(join(out, c.name))}&lang=en` })
      await sleep(300)
      await waitFor(`['ok', 'error'].includes(document.documentElement.dataset.state)`, 60000, `${fmt} copy to open`)
      const s = await ev(shownExpr.replace("'Height range'", "'Height range'"))
      check(s.state === 'ok' && s.tris === src.tris, `${fmt}: opens in the 3D Model Viewer with ${s.tris} triangles (STEP viewer: ${src.tris})`)
      const k = ['glb', 'glbc'].includes(fmt) ? 0.001 : 1 // glTF means meters: the millimeter model is scaled when it is written
      const want = { extent: src.extent.map((v) => v * k), height: src.height.map((v) => v * k) }
      check(sameExtent(s.extent, want.extent), `${fmt}: extent ${s.extent.join(' x ')} matches ${want.extent.join(' x ')} (axes may differ${k !== 1 ? '; scaled to meters' : ''})`)
      if (!['obj', 'ply'].includes(fmt)) check(sameHeight(s.height, want.height), `${fmt}: height ${s.height.join(' … ')} = ${want.height.join(' … ')} (up is kept; OBJ and PLY keep the CAD axes, which the viewer reads as Y up)`)
      if (['glb', 'glbc', 'obj', '3mf'].includes(fmt)) check(s.parts === src.parts, `${fmt}: ${s.parts} parts = ${src.parts}`)
    }
  } else check(true, 'the 3D Model Viewer folder is not next to this one: the copies were not opened again: skipped')
  console.log(results.join('\n'))
  console.log(failures ? `\n${failures} check(s) failed` : `\nall ${results.length} checks passed`)
} catch (e) {
  console.log(results.join('\n'))
  console.error('ERROR', e.message)
  failures++
} finally {
  if (process.argv[2] === 'keep') console.log('copies kept in', out)
  chrome.kill()
  server.kill()
  if (server2) server2.kill()
  await sleep(500)
  if (process.argv[2] !== 'keep') rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
}
process.exit(failures ? 1 : 0)

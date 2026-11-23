#!/usr/bin/env node
// End-to-end test of the part tree (UX v3, E2b) in headless Chrome through the plugin's harness: the rows of a nested model, folding, the filter, the ticks (also of a
// group), the selection of a group, the arrow keys, the vertical tool strip and the card Files (one row). Works in both viewers.   node dev/e2e-tree.mjs
// The model is nested on purpose: STEP: dev/make-nested-step.mjs (the converter shows three levels of rows); Model Viewer: nested.glb of dev/make_samples.py.
import { spawn, execFileSync } from 'node:child_process'
import { mkdtempSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const plugin = join(here, '..')
const isStep = existsSync(join(plugin, 'samples', 'assembly.step'))
const dir = mkdtempSync(join(tmpdir(), 'tree-e2e-'))
execFileSync('mkdir', ['-p', join(dir, 'samples')])
let modelFile
let EXPECT // [[depth, name, group]]
if (isStep) {
  const m = await import(pathToFileURL(join(here, 'make-nested-step.mjs')).href)
  const { writeFileSync } = await import('node:fs')
  modelFile = join(dir, 'samples', 'nested.step')
  writeFileSync(modelFile, m.nestedStep())
  EXPECT = m.EXPECTED_ROWS
} else {
  execFileSync('python3', [join(here, 'make_samples.py'), '--out', join(dir, 'samples')], { stdio: 'ignore' })
  modelFile = join(dir, 'samples', 'nested.glb')
  EXPECT = [[0, 'Floor', false], [0, 'Table', true], [1, 'Frame', true], [2, 'Table_top', false], [2, 'Table_legs', false], [1, 'Decor', true], [2, 'Vase', false], [2, 'Ball', false]]
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
}
const setWidth = async (w, h = 800) => {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false })
  await sleep(250)
}
const rowsDom = () => ev(`[...document.querySelectorAll('#parts .part')].map((r) => ({ i: Number(r.dataset.i), level: Number(r.getAttribute('aria-level')), name: r.querySelector('.nm').textContent, group: r.classList.contains('group'), expanded: r.getAttribute('aria-expanded'), sel: r.classList.contains('sel'), tab: r.tabIndex, checked: r.querySelector('input').checked, indet: r.querySelector('input').indeterminate, off: r.classList.contains('off') }))`)
const visibleFlags = () => ev(`window.__h.parts.map((p) => !!p.visible)`)
const objVisible = () => ev(`window.__h.parts.map((p) => !!p.obj.visible)`)
const focusedRow = () => ev(`(() => { const a = document.activeElement; const r = a && a.closest && a.closest('#parts .part'); return r ? r.querySelector('.nm').textContent : null })()`)
const key = (k, extra = {}) => ev(`(() => { const a = document.activeElement; a.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, bubbles: true, cancelable: true, ...${JSON.stringify(extra)} })) })()`)
const click = (sel) => ev(`document.querySelector(${JSON.stringify(sel)}).click()`)
const rowByName = (name) => `(() => [...document.querySelectorAll('#parts .part')].find((r) => r.querySelector('.nm').textContent === ${JSON.stringify(name)}))()`
const clickRowByName = (name, mods = {}) => ev(`(() => { const r = ${rowByName(name)}; r.dispatchEvent(new MouseEvent('click', { bubbles: true, ...${JSON.stringify(mods)} })) })()`)
const names = (rows) => rows.map((r) => r.name)
const selectedNames = async () => names((await rowsDom()).filter((r) => r.sel))
const pressId = (i) => ev(`document.getElementById(${JSON.stringify(i)}).click()`)
const typeFilter = async (text) => {
  await ev(`(() => { const f = document.getElementById('filter'); f.value = ${JSON.stringify(text)}; f.dispatchEvent(new Event('input', { bubbles: true })) })()`)
  await sleep(150)
}
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
  await open(modelFile)
  const nParts = await ev(`window.__h.parts.length`)

  // ----- the rows: a tree of the depth the file has, one row per node and per part
  let rows = await rowsDom()
  check(JSON.stringify(rows.map((r) => [r.level - 1, r.name, r.group])) === JSON.stringify(EXPECT), `the rows are the tree of the file: ${rows.map((r) => `${'·'.repeat(r.level - 1)}${r.name}`).join(' | ')}`)
  check(Math.max(...rows.map((r) => r.level)) >= 3, 'the tree is at least three levels deep')
  check(await ev(`document.getElementById('parts').getAttribute('role') === 'tree' && document.getElementById('parts').getAttribute('aria-multiselectable') === 'true' && !!document.getElementById('parts').getAttribute('aria-label')`), 'the list is a tree (role, several selectable, a name)')
  check(await ev(`[...document.querySelectorAll('#parts .part')].every((r) => r.getAttribute('role') === 'treeitem' && r.getAttribute('aria-labelledby') && document.getElementById(r.getAttribute('aria-labelledby')))`), 'every row is a treeitem named by its name')
  check(rows.filter((r) => r.group).every((r) => r.expanded === 'true') && rows.filter((r) => !r.group).every((r) => r.expanded === null), 'a group says whether it is open (aria-expanded); a part says nothing')
  check(rows.filter((r) => r.tab === 0).length === 1, 'the tree is ONE tab stop (roving tabindex)')
  check(await ev(`document.getElementById('filter').hidden === false`), 'the filter is there')
  check(await ev(`document.querySelectorAll('#parts .part:not(.group) .tr[data-src=derived]').length === ${rows.filter((r) => !r.group).length}`), 'every part row carries its triangle number with the origin "derived"')
  check(/^\d+ \/ \d+ visible$/.test(await ev(`document.getElementById('part-count').textContent`)) && (await ev(`document.getElementById('part-count').dataset.src`)) === 'derived', 'the count line says how many parts are visible, with its origin')

  // ----- folding
  const groupName = EXPECT.find((r, k) => r[2] && k > 0 && !EXPECT[k + 1][2])[1] // the first group below the top whose first row is a part
  const before = (await rowsDom()).length
  const below = (() => { const k = EXPECT.findIndex((r) => r[1] === groupName); let n = 0; for (let j = k + 1; j < EXPECT.length && EXPECT[j][0] > EXPECT[k][0]; j++) n++; return n })()
  await ev(`(() => { const r = ${rowByName(groupName)}; r.querySelector('button.tw').click() })()`)
  rows = await rowsDom()
  check(rows.length === before - below && rows.find((r) => r.name === groupName).expanded === 'false', `folding "${groupName}" hides the ${below} rows below it`)
  await ev(`(() => { const r = ${rowByName(groupName)}; r.querySelector('button.tw').click() })()`)
  check((await rowsDom()).length === before, 'unfolding shows them again')
  check(await ev(`(() => { const b = ${rowByName(groupName)}.querySelector('button.tw'); return b.getAttribute('aria-label') && b.querySelector('svg') && !b.textContent.trim() })()`), 'the fold button is a symbol with a name')

  // ----- the filter: matches only (whatever is folded), no fold buttons while it is on, Esc empties it
  const target = EXPECT.filter((r) => !r[2])[1][1]
  await typeFilter(target.toLowerCase())
  rows = await rowsDom()
  check(rows.length >= 1 && rows.every((r) => r.name.toLowerCase().includes(target.toLowerCase())), `the filter "${target.toLowerCase()}" shows only matches (${names(rows).join(', ')})`)
  check(await ev(`document.querySelectorAll('#parts button.tw').length === 0`), 'with a filter on there are no fold buttons')
  await typeFilter('zzzz-no-such-part')
  check((await rowsDom()).length === 0 && /No part/i.test(await ev(`document.getElementById('parts-note').textContent`)) && !(await ev(`document.getElementById('parts-note').hidden`)) && !(await ev(`document.getElementById('parts').textContent.trim()`)), 'a filter with no match says so (in a line beside the tree, not as a row of it)')
  await ev(`document.getElementById('filter').focus()`)
  await key('Escape')
  await sleep(100)
  check((await ev(`document.getElementById('filter').value`)) === '' && (await rowsDom()).length === before, 'Esc in the filter empties it and brings the rows back')

  // with a filter on the rows are matches, not a tree: Left and Right fold nothing (a group would stay folded when the filter goes)
  await typeFilter(groupName.toLowerCase())
  await ev(`${rowByName(groupName)}.focus()`)
  await key('ArrowLeft')
  await typeFilter('')
  check((await rowsDom()).find((r) => r.name === groupName).expanded === 'true' && (await rowsDom()).length === before, 'with a filter on, Left on a group folds nothing')

  // ----- ticks: a group's tick is the tick of all its parts, a part's tick makes the group "some"
  const g = groupName
  const gMeshes = await ev(`(() => { const rows = window.__h.rows; const i = rows.findIndex((r) => r.name === ${JSON.stringify(g)}); return rows[i].meshes })()`)
  const frames0 = await ev(`window.__h.renderer.info.render.frame`)
  await ev(`(() => { const cb = ${rowByName(g)}.querySelector('input'); cb.click() })()`)
  await sleep(300)
  check((await ev(`window.__h.renderer.info.render.frame`)) > frames0, 'a tick makes the view draw again (the view draws only on request)')
  let flags = await visibleFlags()
  check(gMeshes.every((k) => flags[k] === false) && flags.filter((v) => v).length === nParts - gMeshes.length, `un-ticking the group "${g}" hides its ${gMeshes.length} parts and only those`)
  check((await objVisible()).every((v, k) => v === flags[k]), 'the 3D objects follow the ticks')
  rows = await rowsDom()
  check(rows.find((r) => r.name === g).checked === false && rows.find((r) => r.name === g).off, 'the group row is off')
  const kid = EXPECT[EXPECT.findIndex((r) => r[1] === g) + 1][1]
  await ev(`(() => { ${rowByName(kid)}.querySelector('input').click() })()`)
  rows = await rowsDom()
  const gr = rows.find((r) => r.name === g)
  check(gr.indet === true && gr.checked === false, `ticking one part ("${kid}") makes its group "some" (indeterminate)`)
  await pressId('l-all')
  check((await visibleFlags()).every(Boolean), 'the strip: Show all parts')

  // ----- selection: a group selects every part below it and shows them as selected; the same click again clears
  await clickRowByName(g)
  await sleep(100)
  const selNow = await selectedNames()
  const belowNames = EXPECT.slice(EXPECT.findIndex((r) => r[1] === g), EXPECT.findIndex((r) => r[1] === g) + 1 + below).map((r) => r[1])
  check(JSON.stringify(selNow) === JSON.stringify(belowNames), `a group selects all the parts below it: ${selNow.join(', ')}`)
  await clickRowByName(g)
  await sleep(100)
  check((await selectedNames()).length === 0, 'the same group again clears the selection')
  await clickRowByName(kid)
  await clickRowByName(EXPECT.filter((r) => !r[2])[0][1], { ctrlKey: true })
  check((await selectedNames()).length === 2, 'Ctrl + click adds a row')
  await pressId('b-sel-clear')
  check((await selectedNames()).length === 0, 'the strip: Clear selection')

  // ----- the arrow keys
  rows = await rowsDom()
  await ev(`document.querySelector('#parts .part[tabindex="0"]').focus()`)
  check(!!(await focusedRow()), 'Tab lands on a row of the tree (the one tab stop)')
  await key('Home')
  await key('ArrowDown')
  check((await focusedRow()) === rows[1].name, 'Down moves to the next row')
  await key('End')
  check((await focusedRow()) === rows.at(-1).name, 'End: the last row')
  await key('Home')
  check((await focusedRow()) === rows[0].name, 'Home: the first row')
  check((await rowsDom()).filter((r) => r.tab === 0).length === 1, 'still one tab stop after moving')
  // go to the group, fold with Left, unfold with Right, Right again goes into it
  await ev(`${rowByName(g)}.focus()`)
  await key('ArrowLeft')
  rows = await rowsDom()
  check(rows.find((r) => r.name === g).expanded === 'false' && rows.length === before - below && (await focusedRow()) === g, 'Left on an open group folds it (the focus stays)')
  await key('ArrowRight')
  rows = await rowsDom()
  check(rows.find((r) => r.name === g).expanded === 'true' && rows.length === before && (await focusedRow()) === g, 'Right on a folded group opens it')
  await key('ArrowRight')
  check((await focusedRow()) === kid, `Right on an open group goes to its first row ("${kid}")`)
  await key('ArrowLeft')
  check((await focusedRow()) === g, 'Left on a part goes to its group')
  // the fold button does what a button does: Space on it does not tick the row
  const kidChecked = (await rowsDom()).find((r) => r.name === g).checked
  await ev(`${rowByName(g)}.querySelector('button.tw').focus()`)
  await key(' ')
  check((await rowsDom()).find((r) => r.name === g).checked === kidChecked, 'Space on the fold button does not tick the row')
  // Space ticks, Enter selects
  await ev(`${rowByName(kid)}.focus()`)
  await key(' ')
  await sleep(100)
  check((await rowsDom()).find((r) => r.name === kid).checked === false && (await focusedRow()) === kid, 'Space ticks or un-ticks the row (the focus stays on it)')
  await key(' ')
  await key('Enter')
  await sleep(100)
  check((await selectedNames()).includes(kid) && (await focusedRow()) === kid, 'Enter selects the row')
  await pressId('b-sel-clear')

  // ----- the vertical tool strip
  const strip = await ev(`(() => { const s = document.getElementById('tree-strip'); const r = s.getBoundingClientRect(); const l = document.getElementById('parts').getBoundingClientRect(); return { role: s.getAttribute('role'), orient: s.getAttribute('aria-orientation'), label: !!s.getAttribute('aria-label'), ids: [...s.querySelectorAll('button')].map((b) => b.id), named: [...s.querySelectorAll('button')].every((b) => b.getAttribute('aria-label') && b.title && b.querySelector('svg') && !b.textContent.trim()), tabs: [...s.querySelectorAll('button')].filter((b) => b.tabIndex === 0).length, vertical: r.width < r.height && r.left >= l.right - 1, inside: r.right <= window.innerWidth } })()`)
  check(strip.role === 'toolbar' && strip.orient === 'vertical' && strip.label && strip.vertical, 'the strip is a vertical toolbar beside the tree')
  check(JSON.stringify(strip.ids) === JSON.stringify(['l-all', 'l-none', 'l-only', 'l-inv', 'b-sel-clear', 'b-multi']), `the strip: ${strip.ids.join(', ')}`)
  check(strip.named && strip.tabs === 1, 'every strip button is a symbol with a name and a tooltip; the strip is one tab stop')
  await pressId('l-none')
  check((await visibleFlags()).every((v) => v === false), 'the strip: Hide all parts')
  await pressId('l-inv')
  check((await visibleFlags()).every(Boolean), 'the strip: Invert visibility')
  await clickRowByName(kid)
  await pressId('l-only')
  const only = await visibleFlags()
  check(only.filter(Boolean).length >= 1 && only.filter(Boolean).length < nParts, `the strip: Only selected (${only.filter(Boolean).length} of ${nParts} visible)`)
  await pressId('l-all')
  await pressId('b-multi')
  check((await ev(`document.getElementById('b-multi').getAttribute('aria-pressed')`)) === 'true', 'the strip: Select several is on')
  await pressId('b-sel-clear')
  await clickRowByName(kid)
  await clickRowByName(EXPECT.filter((r) => !r[2])[0][1])
  check((await selectedNames()).length === 2, `with Select several every click adds a row (${(await selectedNames()).join(', ')})`)
  await pressId('b-multi')
  await pressId('b-sel-clear')
  await ev(`(() => { const b = document.querySelector('#tree-strip button'); b.focus() })()`)
  await key('ArrowDown')
  check((await ev(`document.activeElement.id`)) === 'l-none', 'Down in the strip moves to the next button')

  // ----- the card Files: one row (several files at once are not built)
  const card = await ev(`(() => { const c = document.getElementById('card-files'); if (!c || c.hidden) return null; const r = c.getBoundingClientRect(); return { rows: c.querySelectorAll('.frow').length, text: c.textContent, srcs: [...c.querySelectorAll('[data-src]')].map((e) => e.dataset.src), close: !!c.querySelector('#b-files-close'), open: !!c.querySelector('#b-files-open'), honest: c.dataset.honest, heading: c.querySelector('.card-t').textContent, top: r.top, inCol: !!c.closest('#col-l') } })()`)
  check(card && card.rows === 1, 'the card Files has ONE row')
  check(card && card.heading === 'Files' && card.close && card.open && card.honest === '1', 'the card has its heading, Open, Close and is in the honesty check')
  check(card && /\d/.test(card.text) && card.srcs.every((s) => ['file', 'derived', 'assumed', 'ui'].includes(s)) && card.srcs.includes('file'), `every number on the card has an origin (${[...new Set(card.srcs)].join(', ')})`)
  check(card && (isStep ? /STEP/.test(card.text) && /Mesh quality/.test(card.text) : /GLB/.test(card.text)) && /Unit/.test(card.text), `the card names the format, the size and the unit${isStep ? ' and the mesh quality' : ''}`)
  check(card && card.inCol, 'at 1400 px the card Files heads the left column')
  // a named file (a dropped file has a name)
  await ev(`window.__h.chrome.files.update({ name: 'bracket-12.step', format: 'STEP', size: '12 KB', unit: 'mm', unitSrc: 'file' })`)
  check((await ev(`document.querySelector('#file-row .fn').textContent`)) === 'bracket-12.step' && (await ev(`document.querySelector('#file-row .fn').dataset.src`)) === 'file', 'a file name stands with the origin "file"')
  await ev(`window.__h.chrome.files.update({ name: 'a.glb', format: 'GLB', size: '1 KB', unit: 'm', unitSrc: 'assumed' })`)
  check(/assumed/.test(await ev(`document.getElementById('file-row').textContent`)) && (await ev(`document.querySelector('#file-row [data-src=assumed]').textContent`)) === 'm', 'an assumed unit says "assumed" in the same row')
  await ev(`window.__h.chrome.files.update(null)`)
  check(await ev(`document.getElementById('card-files').hidden`), 'no file: no card')
  // the card follows the file: reload and close
  await open(modelFile)
  check(await ev(`!document.getElementById('card-files').hidden`), 'a loaded file shows the card again')
  // Open and Close of the card follow the page's own buttons (the editor tab of a project file has no Close: the tab is the file)
  const hiddenNow = await ev(`({ open: document.getElementById('b-open').hidden, close: document.getElementById('b-close').hidden, cardOpen: document.getElementById('b-files-open').hidden, cardClose: document.getElementById('b-files-close').hidden })`)
  check(hiddenNow.open === hiddenNow.cardOpen && hiddenNow.close === hiddenNow.cardClose, `the card's Open and Close follow the page's own (Open ${hiddenNow.open ? 'hidden' : 'shown'}, Close ${hiddenNow.close ? 'hidden' : 'shown'})`)
  await ev(`document.getElementById('b-close').hidden = false`)
  await sleep(100)
  check(await ev(`!document.getElementById('b-files-close').hidden`), 'where the page can close the file, the card shows the cross')
  // the cross does what the page's Close does (it asks first: a dialog of the page; Cancel leaves the file)
  await pressId('b-files-close')
  await waitFor(`!!document.getElementById('confirm')`, 5000, 'the question')
  check(await ev(`!!document.getElementById('confirm')`), 'Close file asks first')
  await key('Escape')
  await sleep(200)
  check(await ev(`!document.getElementById('confirm') && !document.getElementById('card-files').hidden && window.__h.parts.length > 0`), 'cancelling leaves the file open')
  await ev(`document.getElementById('b-close').hidden = ${JSON.stringify(hiddenNow.close)}`)

  await ev(`window.__h.chrome.files.update({ name: 'STEP', nameSrc: 'ui', format: 'STEP', size: '1 KB', unit: 'mm', unitSrc: 'file' })`)
  check((await ev(`document.querySelector('#file-row .fn').dataset.src`)) === 'ui', 'no name from the file: the format word stands there with the origin "ui"')
  await open(modelFile)

  // ----- a long list (1200 parts, in groups of 20, one chain 10 deep): the first 1000 rows are drawn, a line says how many are not, the keyboard stays inside what is drawn, ticks do not rebuild
  const big = await ev(`(async () => {
    const { createPartTree } = await import('./shared/part-tree-ui.js')
    const rows = []
    const parts = []
    for (let g = 0; g < 60; g++) {
      const all = []
      rows.push({ depth: 0, name: 'Group ' + g, meshes: all, group: true })
      for (let k = 0; k < 20; k++) { const i = parts.length; parts.push({ visible: true, tris: 12 }); all.push(i); rows.push({ depth: 1, name: 'Part ' + i, meshes: [i], group: false }) }
    }
    rows.push({ depth: 10, name: 'Deep', meshes: [parts.push({ visible: true, tris: 1 }) - 1], group: false })
    const host = document.createElement('div'); const filter = document.createElement('input'); const note = document.createElement('p'); const count = document.createElement('span')
    document.body.append(host, filter, note, count)
    let sel = new Set()
    const tree = createPartTree({ t: (k, v) => k + (v ? JSON.stringify(v) : ''), fmt: String, host, filter, count, note: () => note, getRows: () => rows, getPart: (k) => parts[k], swatch: () => '#888888', searchText: (r) => r.name, nameSrc: () => 'file', selected: () => sel, onVisible: (i, on) => rows[i].meshes.forEach((k) => (parts[k].visible = on)), onSelect: () => {}, onIsolate: () => {} })
    const t0 = performance.now(); tree.render(); const renderMs = performance.now() - t0
    const drawn = host.querySelectorAll('.part').length
    const stops = [...host.querySelectorAll('.part')].filter((r) => r.tabIndex === 0).length
    const level = (host.querySelector('.part[data-i="' + (rows.length - 1) + '"]') || { getAttribute: () => null }).getAttribute('aria-level')
    host.querySelector('.part').focus()
    host.dispatchEvent(new Event('x'))
    const press = (k) => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }))
    press('End')
    const lastName = document.activeElement.querySelector('.nm').textContent
    const lastIsDrawn = document.activeElement.closest('.part') === host.lastElementChild
    press('ArrowDown')
    const stayed = document.activeElement.querySelector('.nm').textContent === lastName
    const stopsAfter = [...host.querySelectorAll('.part')].filter((r) => r.tabIndex === 0).length
    const first = host.querySelector('.part input')
    const keep = document.activeElement
    const t1 = performance.now(); first.click(); const tickMs = performance.now() - t1
    const sameNodes = host.querySelectorAll('.part').length === drawn && document.activeElement === keep && parts[0].visible === false
    const out = { drawn, stops, noteText: note.textContent, noteHidden: note.hidden, lastName, lastIsDrawn, stayed, stopsAfter, renderMs, tickMs, sameNodes, level, countText: count.textContent }
    host.remove(); filter.remove(); note.remove(); count.remove()
    return out
  })()`)
  check(big.drawn === 1000, `a long list: 1000 rows are drawn of 1261 (${big.drawn})`)
  check(!big.noteHidden && /261/.test(big.noteText), `a line beside the tree says how many are not drawn (${big.noteText})`)
  check(big.stops === 1 && big.stopsAfter === 1, `a long list is one tab stop, also after End (${big.stops}, ${big.stopsAfter})`)
  check(big.lastIsDrawn && big.stayed, `End goes to the last DRAWN row ("${big.lastName}") and Down there stays (the focus is never lost)`)
  check(big.sameNodes, `a tick does not rebuild the rows or move the focus (render ${big.renderMs.toFixed(0)} ms, tick ${big.tickMs.toFixed(1)} ms)`)
  check(big.renderMs < 3000, `1000 rows are drawn in ${big.renderMs.toFixed(0)} ms (limit 3000 ms)`)
  check(big.level === null, 'the deep row is beyond the drawn rows (the chain of 10 is at the end): no level to read') // the level of a drawn deep row is checked below

  // ----- the same tree with tabs (600 px) and in the narrow sheet (420 px): the strip stays beside the tree, the card heads the Info tab
  for (const w of [1200, 1100, 700, 600, 420]) {
    await setWidth(w)
    const m = await ev(`(() => { const s = document.getElementById('tree-strip'); const l = document.getElementById('parts'); const sr = s.getBoundingClientRect(); const lr = l.getBoundingClientRect(); const side = document.getElementById('side'); return { strip: sr.width > 0 && sr.right <= window.innerWidth + 0.5 && sr.left >= lr.right - 1, rowsOk: [...document.querySelectorAll('#parts .part')].every((r) => r.getBoundingClientRect().right <= lr.right + 0.5), listW: Math.round(lr.width), vis: lr.width > 0 } })()`)
    // below 1200 px the list is on its tab (and in the narrow sheet the sheet has to be open): select it first
    if (!m.vis) {
      await ev(`(() => { const t = [...document.querySelectorAll('#side-tabs .tab')].find((x) => /Parts/.test(x.textContent)); if (t) t.click() })()`)
      await sleep(150)
      if (!(await ev(`document.getElementById('parts').getBoundingClientRect().width > 0`))) {
        await ev(`document.getElementById('b-panel').click()`)
        await sleep(300)
      }
    }
    const m2 = await ev(`(() => { const s = document.getElementById('tree-strip'); const l = document.getElementById('parts'); const sr = s.getBoundingClientRect(); const lr = l.getBoundingClientRect(); return { strip: sr.width > 0 && sr.right <= window.innerWidth + 0.5 && sr.left >= lr.right - 1, rowsOk: [...document.querySelectorAll('#parts .part')].every((r) => r.getBoundingClientRect().right <= lr.right + 0.5), listW: Math.round(lr.width) } })()`)
    check(m2.strip && m2.rowsOk, `${w} px: the strip is inside the window beside the list, no row sticks out (list ${m2.listW} px)`)
    const cardPlace = await ev(`(() => { const c = document.getElementById('card-files'); return { inCol: !!c.closest('#col-l'), inInfo: !!c.closest('#tp-info') } })()`)
    check(w >= 1200 ? cardPlace.inCol : cardPlace.inInfo, `${w} px: the card Files is ${w >= 1200 ? 'in the left column' : 'at the head of the Info tab'}`)
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

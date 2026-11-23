#!/usr/bin/env node
// End-to-end test of the UX work after the independent review (UX-PRUEFUNG-2026-11-22): the background swatches, the tabs, nothing cut off at the
// edge, the names of the toolbar. Runs the editor in headless Chrome through the plugin's harness at 420, 600 and 900 px, light and dark, German and
// English, from a fresh state each time. Works in both viewers.   node dev/e2e-layout.mjs   (LAYOUT_SHOTS=<folder> keeps a picture of each step)
import { spawn, execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const plugin = join(here, '..')
const isStep = existsSync(join(plugin, 'samples', 'assembly.step'))
const dir = mkdtempSync(join(tmpdir(), 'layout-e2e-'))
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
const check = (ok, what) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`)
  if (!ok) failures++
}
let ws
let id = 0
const pend = new Map()
const shotDir = process.env.LAYOUT_SHOTS || ''
if (shotDir) mkdirSync(shotDir, { recursive: true })
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
const shot = async (name) => {
  if (!shotDir) return
  const r = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(shotDir, `${name}.png`), Buffer.from(r.result.data, 'base64'))
}
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
/** A fresh start: nothing remembered, the width, the theme and the language given, the file loaded. */
const PREF_KEY = `${isStep ? 'step' : 'model'}-viewer-3d.v2`
const open = async (file, { width, theme, lang, prefs = null, noFile = false }) => {
  await send('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 1, mobile: false })
  await send('Page.navigate', { url: `http://127.0.0.1:${port}/h/index.html?lang=${lang}&nodoc=1` })
  await sleep(300)
  await ev(`(() => { localStorage.clear(); sessionStorage.clear(); if (${JSON.stringify(prefs)}) localStorage.setItem(${JSON.stringify(PREF_KEY)}, ${JSON.stringify(JSON.stringify(prefs))}) })()`)
  await send('Page.navigate', { url: `http://127.0.0.1:${port}/h/index.html?${noFile ? 'nodoc=1' : `file=${encodeURIComponent(file)}`}&lang=${lang}${theme === 'dark' ? '&theme=dark' : ''}` })
  await sleep(300)
  if (!noFile) await waitFor(`document.documentElement.dataset.state === 'ok'`, 90000, `${file} to load`)
  await sleep(400)
}
const visibleIn = (sel) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; const r = e.getBoundingClientRect(); return !e.closest('[hidden]') && r.width > 0 && r.height > 0 })()`)
const press = (id) => ev(`document.getElementById(${JSON.stringify(id)}).click()`)
// the three sizes of the Info card with short and with long numbers (round 4 review: a long number must not run into the next column)
const DIMS_PROBE = `(() => {
      const rowOf = () => document.getElementById('info-dims-row')
      const box0 = document.getElementById('info-dims')
      const was = [...rowOf().querySelectorAll('.dim-n')].map((e) => e.textContent)
      const unit = rowOf().querySelector('.dim-u').textContent
      const assumedBefore = !!box0.querySelector('.dims-src [data-src=assumed]')
      const probe = (vals, u) => {
        window.__h.chrome.dims.update({ x: vals[0], y: vals[1], z: vals[2], unit: u || unit, unitSrc: 'file' })
        const r = rowOf()
        const box = r.getBoundingClientRect()
        const cells = [...r.children].map((c) => ({ cell: c.getBoundingClientRect(), dd: c.querySelector('dd').getBoundingClientRect() }))
        const inside = cells.every((c) => c.dd.left >= c.cell.left - 0.5 && c.dd.right <= c.cell.right + 0.5 && c.dd.right <= box.right + 0.5) // each number stays in its own cell, not over the line to the next
        const apart = cells.every((c, i) => i === 0 || c.cell.left >= cells[i - 1].cell.right - 0.5 || c.cell.top >= cells[i - 1].cell.bottom - 0.5) // beside each other without overlap, or one under the other
        return { inside, apart, stack: r.dataset.layout === 'stack', w: Math.round(box.width) }
      }
      const out = { short: probe(['12,3', '4,56', '78,9'], 'mm'), long: probe(['1.234.567,8', '12.345,67', '1.234,5']), mid: probe(['1.234', '50', '42']), units: probe(['12,3', '4,56', '123'], 'units') }
      // an assumed unit says so under the sizes
      window.__h.chrome.dims.update({ x: '1', y: '2', z: '3', unit: 'm', unitSrc: 'assumed' })
      const note = box0.querySelector('.dims-src [data-src=assumed]')
      out.assumed = !!note && note.getClientRects().length > 0 && /assum|Annahme|angenommen/i.test(note.textContent)
      window.__h.chrome.dims.update({ x: was[0], y: was[1], z: was[2], unit, unitSrc: assumedBefore ? 'assumed' : 'file' })
      return out
    })()`
const setCtl = (id, value) => ev(`(() => { const e = document.getElementById(${JSON.stringify(id)}); e.value = ${JSON.stringify(value)}; e.dispatchEvent(new Event(e.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })) })()`)
const key = (k) => ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, bubbles: true }))`)
const frame = `(() => { const { renderer, scene, camera } = window.__h; renderer.render(scene, camera); const c = renderer.domElement; const cv = new OffscreenCanvas(c.width, c.height); const g = cv.getContext('2d', { willReadFrequently: true }); g.drawImage(c, 0, 0); return g.getImageData(0, 0, c.width, c.height) })()`
const corner = () => ev(`(() => { const d = ${frame}; return [...d.data.slice(4 * (2 * d.width + 2), 4 * (2 * d.width + 2) + 4)] })()`)
const rgb = async () => (await corner()).slice(0, 3).join(',')
const closeMenus = () => ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
const current = () => ev(`(document.querySelector('#side-tabs .tab[aria-selected="true"]') || { id: '' }).id.replace(/^tab-\\d+-/, '')`)
const openPanel = async () => {
  if (await ev(`document.getElementById('main').classList.contains('side-closed')`)) await press('b-panel')
  await sleep(150)
}
/** What a person would see of the tab row: the words, whether any is cut, whether the close button is inside the panel. */
const tabRow = () => ev(`(() => {
  const side = document.getElementById('side').getBoundingClientRect()
  const tabs = [...document.querySelectorAll('#side-tabs .tab')].filter((b) => !b.hidden)
  const x = document.getElementById('b-tab-close').getBoundingClientRect()
  return {
    words: tabs.map((b) => b.textContent),
    tall: tabs.filter((b) => b.getBoundingClientRect().height > 34 || b.getBoundingClientRect().height > tabs[0].getBoundingClientRect().height + 1).map((b) => b.textContent), // a word broken over two lines makes a tab taller than the others
    outside: tabs.filter((b) => { const r = b.getBoundingClientRect(); return r.left < side.left - 0.5 || r.right > side.right + 0.5 }).map((b) => b.textContent),
    closeInside: x.width > 0 && x.left >= side.left && x.right <= side.right + 0.5 && x.top >= side.top,
    sideW: Math.round(side.width), rows: new Set(tabs.map((b) => Math.round(b.getBoundingClientRect().top))).size
  }
})()`)
/** Whether the shown tab has something in it (not an empty column): some text and some height. */
const tabFilled = () => ev(`(() => { const p = document.querySelector('.tabpanel:not([hidden])'); if (!p) return false; return p.getBoundingClientRect().height > 80 && p.innerText.trim().length > 30 })()`)

const tabsNow = () => ev(`[...document.querySelectorAll('#side-tabs .tab')].filter((b) => !b.hidden).map((b) => b.id.replace(/^tab-\\d+-/, ''))`)
/** The names of the (visible) elements that stick out of the window on the right or the left, with how far. */
const outside = (selector) => ev(`(() => { const w = innerWidth; return [...document.querySelectorAll(${JSON.stringify(selector)})].filter((e) => !e.closest('[hidden]') && e.getBoundingClientRect().width > 0).map((e) => { const r = e.getBoundingClientRect(); return { id: e.id || e.className || e.tagName, left: Math.round(r.left), right: Math.round(r.right), w } }).filter((o) => o.right > o.w + 0.5 || o.left < -0.5) })()`)

const scenarios = [
  { width: 420, theme: 'dark', lang: 'de' },
  { width: 600, theme: 'dark', lang: 'de' },
  { width: 600, theme: 'light', lang: 'en' },
  { width: 900, theme: 'light', lang: 'de' },
  { width: 900, theme: 'dark', lang: 'en' },
  { width: 420, theme: 'light', lang: 'en' }
]
const de = (s, a, b) => (s.lang === 'de' ? a : b)
try {
  let tries = 0
  let targets
  while (tries++ < 50) {
    targets = await fetch(`http://127.0.0.1:${chromePort}/json`).then((r) => r.json()).catch(() => null)
    if (targets) break
    await sleep(200)
  }
  ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl)
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.method === 'Runtime.exceptionThrown') { console.error('PAGE ERROR', d.params.exceptionDetails.exception?.description); failures++ } if (d.id && pend.has(d.id)) { pend.get(d.id)({ result: d.result, error: d.error }); pend.delete(d.id) } }
  await new Promise((r) => (ws.onopen = r))
  await send('Page.enable')
  await send('Runtime.enable')

  for (const s of scenarios) {
    const tag = `${s.width}px ${s.theme} ${s.lang}`
    const name = `${s.width}-${s.theme}-${s.lang}`
    await open(modelFile, s)
    if (process.env.LAYOUT_EVAL) console.log(tag, JSON.stringify(await ev(process.env.LAYOUT_EVAL))) // debugging: print what an expression says in each scenario

    // ===== Etappe 2: the tabs show whole words, the panel is wide enough, the first tab is never an empty one =====
    await openPanel()
    const want = de(s, ['Teile', 'Schnitt', 'Info', 'Bearbeiten'], ['Parts', 'Section', 'Info', 'Edit'])
    const row = await tabRow()
    check(row.words.join() === want.join(), `[${tag}] the tabs are ${want.join(' · ')} (${row.words.join(' · ')}): no Measure tab before the first measurement`)
    check(row.tall.length === 0 && row.outside.length === 0 && row.rows <= 1 + (row.words.length > 4 ? 1 : 0), `[${tag}] every tab is one line of one word, none sticks out of the panel, at most two rows (tall: ${row.tall}, outside: ${row.outside}, rows: ${row.rows})`)
    check(row.closeInside, `[${tag}] the close button of the tab row is inside the panel`)
    check(s.width < 520 || row.sideW >= 260, `[${tag}] the panel is at least 260 px wide (${row.sideW})`)
    check((await current()) === 'parts', `[${tag}] a file with parts starts on Parts (${await current()})`)
    check(await tabFilled(), `[${tag}] the first tab has content, it is not an empty column`)
    await shot(`${name}-tabs`)
    await ev(`window.__h.measure.store.add({ kind: 'distance', pts: [[0, 0, 0], [1, 0, 0]] })`)
    await sleep(150)
    const row2 = await tabRow()
    check(row2.words.includes(de(s, 'Messungen 1', 'Measurements 1')) && row2.words.indexOf(de(s, 'Messungen 1', 'Measurements 1')) < row2.words.indexOf('Info'), `[${tag}] the first measurement adds the tab "${de(s, 'Messungen 1', 'Measurements 1')}" before Info (${row2.words.join(' · ')})`)
    check(row2.tall.length === 0 && row2.outside.length === 0 && row2.rows <= 2 && row2.closeInside, `[${tag}] five tabs: none broken or sticking out, at most two rows (rows: ${row2.rows}, tall: ${row2.tall}, outside: ${row2.outside})`)
    await shot(`${name}-tabs-measure`)
    await ev(`window.__h.measure.clearAll()`)
    await sleep(150)
    check(!(await tabRow()).words.some((w) => /Mess|Measure/.test(w)), `[${tag}] without measurements the tab is gone again`)
    await ev(`window.__h.chrome.tabs.select('cut')`)
    await shot(`${name}-tabs-cut`)
    await ev(`window.__h.chrome.tabs.select('edit')`)
    const conv = await ev(`(() => { const s = document.getElementById('tl-unit-to'); const r = s.getBoundingClientRect(); return { w: Math.round(r.width), v: s.options[s.selectedIndex].text } })()`)
    check(conv.w >= 40 && conv.v.length > 0, `[${tag}] Edit: the "Convert to" list shows its value (${conv.w} px wide, "${conv.v}")`)
    await shot(`${name}-tabs-edit`)

    // ===== Etappe 3: nothing at the edge is cut off: the bar, the menus, the dialogs, the measuring chip =====
    const barNow = await ev(`(() => { const bar = document.getElementById('bar'); const out = [...bar.querySelectorAll('button')].filter((b) => !b.closest('.pop-panel, #more-menu, #chrome-holder')).map((b) => ({ id: b.id, r: b.getBoundingClientRect(), shown: b.offsetParent !== null })).filter((o) => o.shown && o.r.width > 0 && (o.r.right > innerWidth + 0.5 || o.r.left < -0.5)).map((o) => o.id); const words = [...bar.querySelectorAll('.lbl')].filter((l) => l.offsetParent !== null).map((l) => l.textContent.trim()); const vis = [...bar.querySelectorAll('button.bb')].filter((b) => b.offsetParent !== null && !b.closest('#chrome-holder')); return { out, over: bar.scrollWidth - bar.clientWidth, words, lv: bar.dataset.lv, unnamed: vis.filter((b) => !(b.getAttribute('aria-label') || b.textContent.trim())).map((b) => b.id), icoNoSvg: vis.filter((b) => b.classList.contains('ico') && !b.querySelector('svg.i')).map((b) => b.id), noSvg: vis.filter((b) => !b.querySelector('svg.i') && !b.closest('.wire-seg')).map((b) => b.id), ids: [...bar.querySelectorAll('button')].filter((b) => b.offsetParent !== null).map((b) => b.id) } })()`)
    check(barNow.out.length === 0 && barNow.over <= 1, `[${tag}] the toolbar fits: no button sticks out (${barNow.out}, ${barNow.over} px over; buttons: ${barNow.ids.join(' ')})`)
    check(barNow.unnamed.length === 0 && barNow.noSvg.length === 0 && barNow.icoNoSvg.length === 0, `[${tag}] every button of the bar has a symbol and a name, also the ones whose word went (unnamed: ${barNow.unnamed}, no symbol: ${barNow.noSvg}) (step ${barNow.lv}, words: ${barNow.words.join(' · ') || 'none'})`)
    if (s.width >= 900) check(barNow.words.length >= 1, `[${tag}] at ${s.width} px some words are still there (${barNow.words.join(' · ')})`)
    // a menu of the bar: through its button, or through its row of More when the bar had no room for it
    const openMenu = async (btn, proxy) => {
      if (await ev(`document.getElementById(${JSON.stringify(btn)}).offsetParent !== null`)) await press(btn)
      else {
        await press('b-more')
        await press(proxy)
      }
      await sleep(120)
    }
    const insideWindow = (sel) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e || e.closest('[hidden]')) return null; const r = e.getBoundingClientRect(); return { l: Math.round(r.left), r: Math.round(r.right), w: innerWidth, ok: r.width > 0 && r.left >= 0 && r.right <= innerWidth + 0.5 } })()`)
    for (const [btn, panel, proxy] of [['b-view', '#pop-view', null], ['b-look', '#pop-look', null], ['b-studio', '#pop-studio', 'm-studio'], ['b-more', '#more-menu', null]]) {
      await closeMenus()
      await sleep(60)
      await openMenu(btn, proxy)
      const r = await insideWindow(panel)
      check(r && r.ok, `[${tag}] the ${btn.slice(2)} menu lies inside the window (${r ? `${r.l}..${r.r} of ${r.w}` : 'not shown'})`)
    }
    await closeMenus()
    await sleep(60)
    await openMenu('b-export', 'm-export')
    const ex = await insideWindow('#export-dialog')
    check(ex && ex.ok, `[${tag}] the export dialog lies inside the window (${ex ? `${ex.l}..${ex.r} of ${ex.w}` : 'not shown'})`)
    await press('b-ex-cancel').catch(() => {})
    await ev(`(() => { const d = document.getElementById('export-dialog'); d.hidden = true })()`)
    await press('b-more')
    await press('b-keys')
    const kd = await insideWindow('#keys-dialog')
    check(kd && kd.ok, `[${tag}] the shortcut list lies inside the window (${kd ? `${kd.l}..${kd.r} of ${kd.w}` : 'not shown'})`)
    await ev(`document.getElementById('b-keys-close').click()`)
    // the measuring chip keeps to the width of the view (the panel is open: the view is narrower)
    await press('b-measure')
    await ev(`window.__h.measure.store.add({ kind: 'distance', pts: [[0, 0, 0], [1, 0, 0]] })`)
    await sleep(150)
    const chip = await ev(`(() => { const st = document.getElementById('stage').getBoundingClientRect(); const c = document.getElementById('measure-bar'); if (c.hidden) return null; const r = c.getBoundingClientRect(); const bs = [...c.querySelectorAll('.seg button')].filter((b) => !b.hidden).map((b) => b.getBoundingClientRect()); return { stage: [Math.round(st.left), Math.round(st.right)], chip: [Math.round(r.left), Math.round(r.right)], ok: r.left >= st.left - 0.5 && r.right <= st.right + 0.5, buttons: bs.length, btnOk: bs.every((b) => b.left >= r.left - 0.5 && b.right <= r.right + 0.5) } })()`)
    check(chip && chip.ok && chip.btnOk, `[${tag}] the measuring chip and every way to measure stay inside the view (chip ${chip && chip.chip}, view ${chip && chip.stage}, ${chip && chip.buttons} buttons)`)
    await shot(`${name}-chip`)
    await ev(`window.__h.measure.clearAll()`)
    await press('b-measure-done')
    await sleep(100)

    // ===== Etappe 4: the names say what they do: "Blick" (View) next to "Darstellung" (Appearance), Surface | Mesh is one switch =====
    const names = await ev(`({ view: document.querySelector('#b-view .lbl').textContent.trim(), look: document.querySelector('#b-look .lbl').textContent.trim(), surf: document.getElementById('b-surf').textContent, mesh: document.getElementById('b-mesh').textContent, shown: ['b-surf', 'b-mesh', 'b-view', 'b-look'].every((i) => document.getElementById(i).offsetParent !== null) })`)
    check(names.view === de(s, 'Blick', 'View') && names.look === de(s, 'Darstellung', 'Appearance'), `[${tag}] the menus are called ${de(s, 'Blick', 'View')} and ${de(s, 'Darstellung', 'Appearance')} (${names.view} / ${names.look}): not two words for the same thing`)
    check(names.surf === de(s, 'Fläche', 'Surface') && names.mesh === 'Mesh' && names.shown, `[${tag}] both words of the switch are on the bar: ${names.surf} | ${names.mesh}`)
    const half = () => ev(`['b-surf', 'b-mesh'].map((i) => document.getElementById(i).getAttribute('aria-pressed')).join()`)
    const wireOn = () => ev(`document.getElementById('b-wire').getAttribute('aria-pressed')`)
    check((await half()) === 'true,false' && (await wireOn()) === 'false', `[${tag}] at the start the surface is on (${await half()})`)
    await press('b-surf')
    check((await half()) === 'true,false' && (await wireOn()) === 'false', `[${tag}] a click on the half that is on does nothing`)
    await press('b-mesh')
    await sleep(80)
    check((await half()) === 'false,true' && (await wireOn()) === 'true' && (await ev(`window.__h.parts.some((p) => p.kind === 'mesh') ? window.__h.parts.filter((p) => p.kind === 'mesh').every((p) => p.obj.material.wireframe !== false) : true`)), `[${tag}] a click on Mesh shows the mesh (${await half()})`)
    await shot(`${name}-surface-mesh`)
    await key('w')
    await sleep(80)
    check((await half()) === 'true,false', `[${tag}] the key W switches back to the surface (${await half()})`)

    // ===== Etappe 5: More in three groups, short tooltips, one hint sentence, the export without the technical text, the unit once =====
    const allTips = await ev(`[...document.querySelectorAll('[title]')].map((e) => [e.id || e.className || e.tagName, e.title]).filter(([, t]) => t.length > 60)`)
    check(allTips.length === 0, `[${tag}] every tooltip on the page is at most 60 characters (${allTips.map(([i, t]) => `${i}:${t.length}`)})`)
    await closeMenus()
    await press('b-more')
    await sleep(120)
    const more = await ev(`(() => { const m = document.getElementById('more-menu'); const kids = [...m.querySelectorAll('.menu-item, hr.menu-rule, .more-moved')].filter((e) => !e.closest('[hidden]') && (e.classList.contains('menu-rule') || e.getBoundingClientRect().height > 0)); return kids.map((e) => e.classList.contains('menu-rule') ? '---' : e.classList.contains('more-moved') ? '[moved]' : e.id) })()`)
    check(/^b-open( b-folder-more)?( b-close)? --- /.test(more.filter((x) => !['m-studio', 'm-export', '[moved]'].includes(x)).join(' ')) && more.indexOf('b-keys') > more.indexOf('b-open') && more.indexOf('b-resetprefs') > more.indexOf('b-keys') && more.filter((x) => x === '---').length >= 2, `[${tag}] More: files · shortcuts · reset, in three groups (${more.join(' ')})`)
    await shot(`${name}-more`)
    check((await ev(`getComputedStyle(document.getElementById('b-panel')).backgroundColor`)) !== 'rgb(37, 99, 235)', `[${tag}] the sidebar button shows its state with a frame, it is not a blue button like a mode that is on`)
    check(await ev(`(() => { const b = document.getElementById('b-panel'); const r = b.getBoundingClientRect(); return !!b.closest('#status') && r.width > 0 && r.left >= 0 && r.right <= innerWidth + 0.5 && r.bottom <= innerHeight + 0.5 })()`) && !more.includes('m-panel'), `[${tag}] the sidebar button sits in the status bar inside the window and is no row of More`)
    const moved = ['m-studio', 'm-export', 'm-cut'].filter((x) => more.includes(x))
    check(moved.length === 0 || (await ev(`document.getElementById('bar').dataset.lv === document.getElementById('bar').dataset.lvMax`)), `[${tag}] nothing goes into More before every word has gone (moved: ${moved.join(' ') || 'nothing'}, step ${await ev(`document.getElementById('bar').dataset.lv`)})`)
    const studioShown = await ev(`document.getElementById('b-studio').offsetParent !== null`)
    const exportShown = await ev(`document.getElementById('b-export').offsetParent !== null`)
    check(more.includes('m-studio') === !studioShown && more.includes('m-export') === !exportShown, `[${tag}] the rows Studio / Export are in More exactly when their buttons are not on the bar (studio on bar: ${studioShown}, export on bar: ${exportShown})`)
    await closeMenus()
    // the export dialog: the technical sentence is one level down, the size and the original are in the main path, one way to close
    await openMenu('b-export', 'm-export')
    const exd = await ev(`(() => { const d = document.getElementById('export-dialog'); const vis = (id) => { const e = document.getElementById(id); return !!e && !e.closest('[hidden]') && e.getBoundingClientRect().width > 0 && !(e.closest('details') && !e.closest('details').open) }; return { lossy: vis('ex-lossy'), adv: !!document.getElementById('ex-adv') && document.getElementById('ex-adv').contains(document.getElementById('ex-lossy')) && !document.getElementById('ex-adv').open, orig: vis('export-orig'), est: vis('ex-estimate'), x: !!document.getElementById('b-export-close'), close: vis('b-ex-close2'), go: vis('b-ex-go') } })()`)
    check(!exd.lossy && exd.adv, `[${tag}] export: the sentence on what the format changes is inside "Advanced" (closed), not in the main path`)
    check(exd.orig && exd.go && exd.close && !exd.x, `[${tag}] export: "the original stays unchanged", one Close and Save as…, no second ✕ (original ${exd.orig}, close ${exd.close}, ✕ ${exd.x})`)
    await shot(`${name}-export`)
    await press('b-ex-close2')
    await sleep(80)
    check(!(await visibleIn('#export-dialog')), `[${tag}] export: the foot button closes the dialog`)
    // Parts: one hint sentence; Info: the unit is one row, the file size is not first
    await ev(`window.__h.chrome.tabs.select('parts')`)
    const hint = await ev(`document.getElementById('parts-hint').textContent`)
    check(hint.length <= 70 && (hint.match(/[.!?](\s|$)/g) || []).length <= 1, `[${tag}] Parts: the hint is one sentence (${hint.length} characters: ${hint})`)
    await shot(`${name}-parts`)
    check(!(await visibleIn('#parts-cap')) && !(await visibleIn('#parts-hint')), `[${tag}] Parts: the hint and the line on the Δ are not in the card all the time`)
    await press('b-help-parts')
    check(await visibleIn('#parts-cap') && await visibleIn('#parts-hint'), `[${tag}] Parts: the "?" in the head of the card shows the hint and what the Δ stands for`)
    await press('b-help-parts')
    await ev(`window.__h.chrome.tabs.select('info')`)
    const info = await ev(`(() => ({ main: [...document.querySelectorAll('#stats dt')].map((d) => d.textContent), more: [...document.querySelectorAll('#stats-more dt')].map((d) => d.textContent), unit: !!document.querySelector('#info-unit select') && document.querySelector('#info-unit').getBoundingClientRect().height > 0 }))()`)
    await shot(`${name}-info`)
    check(info.unit && !info.main.some((k) => /^(Unit|Einheit)$/.test(k)) && info.main.indexOf(de(s, 'Dateigröße', 'File size')) !== 0, `[${tag}] Info: the unit is set in one row (and named only under "More numbers"); the file size is not the first row (${info.main.join(' · ')})`)
    const dimsInfo = await ev(`(() => { const row = document.getElementById('info-dims-row'); const n = [...document.querySelectorAll('#info-dims-row .dim-n')]; const r = row && row.getBoundingClientRect(); const st = document.getElementById('stats').getBoundingClientRect(); return { n: n.length, vis: !!r && r.width > 0 && r.height > 0, above: !!r && r.bottom <= st.top + 1, src: n.every((e) => e.dataset.src === 'derived'), px: n.map((e) => parseFloat(getComputedStyle(e).fontSize)), words: [...document.querySelectorAll('#info-dims-row dt')].map((e) => e.textContent).join('') } })()`)
    check(info.main.indexOf(de(s, 'Ausdehnung X × Y × Z', 'Size X × Y × Z')) < 0 && dimsInfo.n === 3 && dimsInfo.vis && dimsInfo.above && dimsInfo.src && dimsInfo.words === 'XYZ' && dimsInfo.px.every((p) => p >= 20), `[${tag}] Info: the size of the model is the row X, Y, Z (three big numbers, origin "derived") above the list, not a line in it (${JSON.stringify(dimsInfo)})`)
    // long numbers must not run into the next column (review of round 4): the sizes of a long assembly stand one under the other, short ones side by side
    const longDims = await ev(DIMS_PROBE)
    check(longDims.short.inside && longDims.short.apart && !longDims.short.stack && longDims.long.inside && longDims.long.apart && longDims.long.stack && longDims.mid.inside && longDims.mid.apart && longDims.units.inside && longDims.units.apart && longDims.units.stack && longDims.assumed, `[${tag}] Info: short sizes side by side, long ones ("1.234.567,8", or "4,56 units" of an STL) one under the other, each number in its own cell, an assumed unit says so (${JSON.stringify(longDims)})`)
    // keyboard focus and a menu that grows (the menu of Studio opened from More)
    if (!studioShown) {
      await closeMenus()
      await press('b-more')
      await press('m-studio')
      await sleep(120)
      await ev(`document.getElementById('st-adv').open = true`)
      await sleep(150)
      const grown = await insideWindow('#pop-studio')
      check(grown && grown.ok, `[${tag}] Studio opened from More: unfolding "Advanced" keeps the menu inside the window (${grown && `${grown.l}..${grown.r} of ${grown.w}`})`)
      await ev(`document.getElementById('st-adv').open = false`)
      await key('Escape')
      await sleep(80)
      check((await ev(`document.activeElement && document.activeElement.id`)) === 'b-more', `[${tag}] Esc on a menu that was opened from More puts the focus on More, not on the page (${await ev(`document.activeElement && (document.activeElement.id || document.activeElement.tagName)`)})`)
    }
    if (!exportShown) {
      for (const how of ['Escape', 'close']) {
        await press('b-more')
        await press('m-export')
        await sleep(120)
        if (how === 'Escape') await key('Escape')
        else await press('b-ex-close2')
        await sleep(100)
        check((await ev(`document.activeElement && document.activeElement.id`)) === 'b-more' && !(await visibleIn('#export-dialog')), `[${tag}] the export dialog opened from More: ${how === 'Escape' ? 'Esc' : 'the Close button'} closes it and the focus goes to More (${await ev(`document.activeElement && (document.activeElement.id || document.activeElement.tagName)`)})`)
      }
    }
    await closeMenus()

    // ===== Etappe 1: the background is usable (no look on), at the top of the Studio menu =====
    await closeMenus()
    await openMenu('b-studio', 'm-studio')
    const studioOpen = await visibleIn('#pop-studio')
    check(studioOpen, `[${tag}] the Studio menu opens`)
    if (studioOpen) {
      check(await visibleIn('#st-bg-swatches'), `[${tag}] the background swatches are visible while the look is Original`)
      const sw = await ev(`[...document.querySelectorAll('#st-bg-swatches .bg-sw')].map((b) => ({ m: b.dataset.bg, off: !!(b.disabled || b.querySelector('input')?.disabled), text: b.textContent.trim(), pressed: b.getAttribute('aria-pressed') }))`)
      check(sw.length === 5 && sw.every((b) => !b.off), `[${tag}] five swatches, none greyed out (${sw.map((b) => b.m + (b.off ? ':off' : '')).join(' ')})`)
      check(sw.find((b) => b.m === 'orca')?.pressed === 'true', `[${tag}] with no look on, "Orca" is the marked background`)
      const words = sw.map((b) => b.text).join(',')
      check(s.lang === 'de' ? /Weiß/.test(words) && /Verlauf/.test(words) && /Durchsichtig/.test(words) : /White/.test(words) && /Gradient/.test(words) && /Transparent/.test(words), `[${tag}] the swatch words are in the language of Orca (${words})`)
      const order = await ev(`(() => { const p = document.getElementById('pop-studio'); const a = document.getElementById('st-bg-swatches').getBoundingClientRect().top; const b = document.getElementById('st-tiles').getBoundingClientRect().top; const f = document.getElementById('st-floor').getBoundingClientRect().top; return a < b && b < f })()`)
      check(order, `[${tag}] the background comes first, then the looks, then floor and shadow`)
      const floorOff = await ev(`document.getElementById('st-floor').disabled`)
      check(floorOff && (await visibleIn('#st-why')), `[${tag}] floor and shadow stay off without a look, and a line says why`)
      check(await ev(`[...document.querySelectorAll('#pop-studio p.hint')].filter((p) => !p.closest('[hidden]') && p.getBoundingClientRect().width > 0).every((p) => p.id === 'st-intro' || p.id === 'st-why' || p.id === 'st-bg-note' || p.id === 'st-note')`), `[${tag}] no long hint line at the end of the menu (only the intro and the reason line)`)
      // the swatches change the picture, the menu stays open
      const swatch = async (m) => {
        await ev(`document.querySelector('#st-bg-swatches [data-bg="${m}"]').click()`)
        await sleep(80)
      }
      await swatch('white')
      check((await rgb()) === '255,255,255', `[${tag}] swatch White paints white (${await rgb()})`)
      await swatch('orca')
      check((await rgb()) === (s.theme === 'dark' ? '21,23,26' : '236,238,241'), `[${tag}] swatch Orca paints the colour of the theme (${await rgb()})`)
      await swatch('gradient')
      check(await ev(`window.__h.scene.background && window.__h.scene.background.isTexture === true`), `[${tag}] swatch Gradient paints a gradient`)
      const cornerPx = await ev(`(() => { const d = ${frame}; const at = (x, y) => d.data[4 * (y * d.width + x)]; return [at(2, 2), at(2, d.height - 3)] })()`)
      check(cornerPx[0] > cornerPx[1] + 20, `[${tag}] the gradient is lighter at the top than at the bottom (${cornerPx})`)
      await swatch('transparent')
      check(await ev(`window.__h.scene.background === null && document.querySelector('canvas').classList.contains('studio-clear')`), `[${tag}] swatch Transparent leaves no background (the checker pattern shows)`)
      check(await visibleIn('#pop-studio'), `[${tag}] choosing a swatch keeps the menu open`)
      await setCtl('st-bg-custom', '#336699')
      await sleep(100)
      check((await rgb()) === '51,102,153', `[${tag}] the own colour paints exactly that colour (${await rgb()})`)
      check(await ev(`document.querySelector('#st-bg-swatches [data-bg="orca"]').getAttribute('aria-pressed') === 'false' && /chosen|gewählt/.test(document.getElementById('st-bg-custom').getAttribute('aria-label'))`), `[${tag}] only the own colour is marked now (for a screen reader too: the colour field says "chosen")`)
      await swatch('orca')
      check(!/chosen|gewählt/.test(await ev(`document.getElementById('st-bg-custom').getAttribute('aria-label')`)) && (await ev(`document.querySelector('#st-bg-swatches [data-bg="orca"]').getAttribute('aria-pressed')`)) === 'true', `[${tag}] back to Orca: the colour field no longer says "chosen"`)
      // the theme changes while the menu is open: the Orca swatch shows the new colour at once
      await swatch('white')
      const orcaSw = () => ev(`getComputedStyle(document.querySelector('#st-bg-swatches [data-bg="orca"] .swatch')).backgroundColor`)
      const DARKC = 'rgb(21, 23, 26)'
      const LIGHTC = 'rgb(236, 238, 241)'
      for (const mode of ['white', 'orca']) {
        await swatch(mode)
        const was = s.theme === 'dark' ? DARKC : LIGHTC
        check((await orcaSw()) === was, `[${tag}] (${mode} chosen) the Orca swatch shows the colour of the theme (${await orcaSw()})`)
        await ev(`document.documentElement.classList.toggle('dark')`)
        await sleep(100)
        check((await orcaSw()) === (s.theme === 'dark' ? LIGHTC : DARKC), `[${tag}] (${mode} chosen) after a change of the Orca theme the swatch shows the other colour (${await orcaSw()})`)
        await ev(`document.documentElement.classList.toggle('dark')`)
        await sleep(100)
      }
      await swatch('white')
      // a look on: it sets the background; no swatch is marked and a line says so; a swatch overrides the look
      await ev(`document.querySelector('#st-tiles [data-preset="product_white"]').click()`)
      await sleep(150)
      check(await ev(`document.getElementById('st-bgmode').value === 'look' && [...document.querySelectorAll('#st-bg-swatches [aria-pressed="true"]')].length === 0`), `[${tag}] with a look on and no own choice, no swatch is marked`)
      check(await visibleIn('#st-bg-note'), `[${tag}] a line says that the look sets the background`)
      check((await rgb()) === '255,255,255', `[${tag}] the look's own white shows (${await rgb()})`)
      await swatch('gradient')
      check(await ev(`document.getElementById('st-bgmode').value === 'gradient' && document.querySelector('#st-tiles [data-preset="product_white"]').getAttribute('aria-pressed') === 'true'`), `[${tag}] a swatch overrides the look's background, the look stays on`)
      await ev(`document.getElementById('st-reset').click()`)
      await sleep(100)
      check(await ev(`document.getElementById('st-floor').disabled`), `[${tag}] resetting the look: floor and shadow are off again`)
      // the own colour survives a reload
      await setCtl('st-bg-custom', '#336699')
      await sleep(100)
      await send('Page.reload')
      await sleep(300)
      await waitFor(`document.documentElement.dataset.state === 'ok'`, 90000, 'the reload')
      await sleep(400)
      check((await rgb()) === '51,102,153', `[${tag}] the own colour is still there after a reload (${await rgb()})`)
      await openMenu('b-studio', 'm-studio')
      check(await ev(`document.querySelector('#st-bg-swatches [data-bg="custom"]').classList.contains('sel') && document.getElementById('st-bg-custom').value === '#336699'`), `[${tag}] after the reload the own colour is marked and the colour field holds it`)
      // key B keeps the own colour for the next time round
      for (let i = 0; i < 5; i++) await key('b')
      check((await ev(`document.getElementById('st-bg-custom').value`)) === '#336699', `[${tag}] key B steps on without losing the own colour`)
      await shot(`${name}-studio-background`)
      await closeMenus()
    }
  }
  // no file yet: the rows of More that stand for Studio and Export are off, like their buttons
  await open('', { width: 320, theme: 'dark', lang: 'en', noFile: true }) // narrower than the symbols alone need: Studio, Export and Section go into More
  await press('b-more')
  await sleep(120)
  const offRows = await ev(`['m-studio', 'm-export', 'm-cut'].map((i) => { const e = document.getElementById(i); return e && !e.hidden ? e.disabled : 'hidden' })`)
  check(offRows[0] === true && offRows.every((d) => d === true || d === 'hidden'), `[no file, 320 px] the rows in More (Studio, Export, Section) are off while there is no model (${offRows})`)
  const pairs = await ev(`[...document.querySelectorAll('#bar [data-collapse]')].map((e) => { const b = e.classList.contains('pop-wrap') ? e.firstElementChild : e; const p = document.getElementById(e.dataset.proxy); return [e.dataset.proxy, !!p, b.dataset.needsModel !== undefined, !!p && p.dataset.needsModel !== undefined] })`)
  check(pairs.length === 3 && pairs.every(([, has, needs, pneeds]) => has && needs === pneeds), `[proxies] every bar element that can collapse into More has its row, and the row needs a model exactly when the button does (${JSON.stringify(pairs)})`)
  // no file at 600 px (finding of the hand check on the empty view): the way to open a file is on the bar and in the middle, the view has the theme's colour, nothing has the keyboard focus
  for (const theme of ['dark', 'light']) {
    await open('', { width: 600, theme, lang: 'de', noFile: true, prefs: { v: 2, bg: theme === 'dark' ? 'light' : 'dark' } }) // a stored background of the other theme must not show through the empty view
    const emp = await ev(`(() => { const shown = (id) => { const e = document.getElementById(id); return !!e && e.offsetParent !== null && e.getBoundingClientRect().width > 0 }; const d = getComputedStyle(document.getElementById('drop')).backgroundColor; const b = getComputedStyle(document.body).backgroundColor; return { open: shown('b-open-bar'), card: shown('b-pick'), dropBg: d, bodyBg: b, active: document.activeElement && (document.activeElement.id || document.activeElement.tagName), diag: shown('b-diag'), inStatus: !!(document.activeElement && document.activeElement.closest('#status')) } })()`)
    check(emp.open && emp.card, `[empty ${theme} 600 px] Open is on the bar and "Choose file" is in the middle (${emp.open} ${emp.card})`)
    check(!emp.diag, `[empty ${theme} 600 px] Diagonal stays off the bar without a model`)
    check(emp.dropBg === emp.bodyBg, `[empty ${theme} 600 px] the empty view has the colour of the theme, not of a stored scene background (${emp.dropBg} / ${emp.bodyBg})`)
    check(emp.active !== 'b-panel' && !emp.inStatus, `[empty ${theme} 600 px] the keyboard focus did not jump to the sidebar button (focus: ${emp.active})`)
    const pb = await ev(`(() => { const b = document.getElementById('b-panel'); const c = getComputedStyle(b); return { pressed: b.getAttribute('aria-pressed'), border: c.borderTopColor, shadow: c.boxShadow, outline: c.outlineStyle } })()`)
    check(pb.pressed === 'true' && pb.border !== 'rgb(37, 99, 235)' && pb.shadow === 'none' && pb.outline === 'none', `[empty ${theme} 600 px] the open sidebar button has no blue frame that looks like focus (${pb.border}, ${pb.shadow}, outline ${pb.outline})`)
  }
  // the start tab: a remembered task tab (Section) is never the start, a remembered Info is; a stored 180 px panel comes back to 260
  await open(modelFile, { width: 900, theme: 'dark', lang: 'en', prefs: { v: 2, tab: 'cut', ui: { sideW: 180 } } })
  await openPanel()
  check((await current()) === 'parts', `[remembered Section] the file starts on Parts, not on the tab that may be empty (${await current()})`)
  check((await tabRow()).sideW >= 260, `[stored 180 px] the panel is at least 260 px wide (${(await tabRow()).sideW})`)
  await open(modelFile, { width: 900, theme: 'dark', lang: 'en', prefs: { v: 2, tab: 'info' } })
  await openPanel()
  check((await current()) === 'info', `[remembered Info] a remembered Info tab is kept (${await current()})`)
  if (!isStep) {
    await open(join(samples, 'mesh.ply'), { width: 600, theme: 'dark', lang: 'en' })
    await openPanel()
    check((await tabsNow()).join() === 'cut,info,edit' && (await current()) === 'info' && (await tabFilled()), `[one part] a single mesh starts on Info with content (${await tabsNow()}, ${await current()})`)
  }
  // an old stored choice (the button of the earlier versions wrote bg: "dark"): in the light theme no swatch is it, a line says what is stored
  await open(modelFile, { width: 600, theme: 'light', lang: 'en', prefs: { v: 2, bg: 'dark' } })
  await ev(`document.getElementById('b-studio').click()`)
  check((await rgb()) === '21,23,26', `[old value] the stored dark background is shown in the light theme (${await rgb()})`)
  check(await ev(`[...document.querySelectorAll('#st-bg-swatches [aria-pressed="true"]')].length === 0`) && (await visibleIn('#st-bg-note')) && /Stored background: Dark/.test(await ev(`document.getElementById('st-bg-note').textContent`)), '[old value] no swatch is marked, and a line says "Stored background: Dark"')
  await ev(`document.querySelector('#st-bg-swatches [data-bg="white"]').click()`)
  await sleep(80)
  check(!(await visibleIn('#st-bg-note')), '[old value] choosing a swatch replaces the stored value, the line goes')
  // ===== UX v3 E1b: the toolbar at every width (the widths are TEST values: the code measures, it knows none of them) =====
  // One loaded page per language; the window is resized step by step. The words go before anything moves into More, the extras of a wide bar (Open, Diagonal, Front)
  // appear from 1300 px and only there, nothing sticks out, every button keeps a name and a symbol, the status bar stays in the window.
  const WORDS = new Map() // how many words are still on the bar, per language and width
  for (const lang of ['de', 'en']) {
    await open(modelFile, { width: 1400, theme: lang === 'de' ? 'dark' : 'light', lang })
    let lastLv = -1
    for (const w of [1400, 1300, 1299, 1200, 1000, 900, 760, 600, 520, 420, 354]) {
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: 800, deviceScaleFactor: 1, mobile: false })
      await sleep(450)
      const m = await ev(`(() => { const bar = document.getElementById('bar'); const vis = [...bar.querySelectorAll('button.bb')].filter((b) => b.offsetParent !== null && !b.closest('#chrome-holder')); const out = vis.filter((b) => { const r = b.getBoundingClientRect(); return r.right > innerWidth + 0.5 || r.left < -0.5 }).map((b) => b.id); const shown = (id) => document.getElementById(id).offsetParent !== null; const st = document.getElementById('status').getBoundingClientRect(); return { lv: Number(bar.dataset.lv), lvMax: Number(bar.dataset.lvMax), words: [...bar.querySelectorAll('.lbl')].filter((l) => l.offsetParent !== null).length, over: bar.scrollWidth - bar.clientWidth, out, wide: ['b-open-bar', 'b-diag', 'b-front'].map(shown), unnamed: vis.filter((b) => !(b.getAttribute('aria-label') || b.textContent.trim())).map((b) => b.id), noSvg: vis.filter((b) => !b.querySelector('svg.i') && !b.closest('.wire-seg')).map((b) => b.id), inMore: ['m-studio', 'm-export', 'm-cut'].filter((id) => !document.getElementById(id).hidden), statusOk: st.width > 0 && st.right <= innerWidth + 0.5 && st.bottom <= innerHeight + 0.5, panelBtn: document.getElementById('b-panel').getBoundingClientRect().right <= innerWidth + 0.5 }})()`)
      const tag = `${w} px ${lang}`
      check(m.over <= 1 && m.out.length === 0, `[bar ${tag}] the toolbar fits (${m.over} px over, outside: ${m.out.join(' ') || 'none'}), step ${m.lv}`)
      check(m.wide.every((x) => x === (w >= 1300)), `[bar ${tag}] Open, Diagonal and Front are ${w >= 1300 ? 'on the bar' : 'not on the bar'} (${m.wide})`)
      check(m.unnamed.length === 0 && m.noSvg.length === 0, `[bar ${tag}] every button has a symbol and a name (${m.unnamed} ${m.noSvg})`)
      check(m.inMore.length === 0 || m.lv === m.lvMax, `[bar ${tag}] nothing moves into More before all words have gone (step ${m.lv}, in More: ${m.inMore.join(' ') || 'nothing'})`)
      check(m.statusOk && m.panelBtn, `[bar ${tag}] the status bar and its sidebar button are inside the window`)
      if (lastLv >= 0) check(m.lv >= lastLv, `[bar ${tag}] a narrower window never brings a word back (step ${lastLv} -> ${m.lv})`)
      lastLv = m.lv
      WORDS.set(`${lang}${w}`, m.words)
    }
    await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 800, deviceScaleFactor: 1, mobile: false })
    await sleep(450)
    const lv1400 = await ev(`document.getElementById('bar').dataset.lv`)
    check(lv1400 === '0', `[bar 1400 px ${lang}] widening the window brings every word back (step ${lv1400})`)
  }
  // the words that must still be there (TEST values, measured: the code measures, these only keep it from getting worse): the everyday width 600 px keeps some words
  for (const lang of ['de', 'en']) {
    check(WORDS.get(`${lang}1000`) >= 6 && WORDS.get(`${lang}900`) >= 5 && WORDS.get(`${lang}760`) >= 3 && WORDS.get(`${lang}600`) >= 1, `[bar words ${lang}] words left at 1000 / 900 / 760 / 600 px: ${[1000, 900, 760, 600].map((w) => WORDS.get(`${lang}${w}`)).join(' / ')} (at least 6 / 5 / 3 / 1)`)
  }
  // a focused button that leaves the bar (into More): the focus goes to More, not to the page
  await open(modelFile, { width: 1400, theme: 'dark', lang: 'en' })
  await ev(`document.getElementById('b-studio').focus()`)
  await send('Emulation.setDeviceMetricsOverride', { width: 320, height: 800, deviceScaleFactor: 1, mobile: false })
  await sleep(500)
  check(await ev(`(() => { const a = document.activeElement; return !!a && a !== document.body && a.offsetParent !== null })()`), `[320 px] the focused Studio button moved into More: the focus is on something that can be seen (${await ev(`document.activeElement && (document.activeElement.id || document.activeElement.tagName)`)})`)
  // Section as a row of More: the tick, the switch, the focus back on More
  await press('b-more')
  await sleep(120)
  check(await visibleIn('#m-cut') && (await ev(`document.getElementById('m-cut').getAttribute('aria-checked')`)) === 'false', '[320 px] the row Section in More is there and has no tick')
  await press('m-cut')
  await sleep(250)
  check((await ev(`document.getElementById('sec-axis').value`)) !== '' && (await ev(`document.getElementById('b-cut').getAttribute('aria-pressed')`)) === 'true' && (await ev(`document.activeElement && document.activeElement.id`)) === 'b-more', `[320 px] the row Section switches the plane on and the focus goes back to More (${await ev(`document.activeElement && (document.activeElement.id || document.activeElement.tagName)`)})`)
  await press('b-more')
  await sleep(120)
  check((await ev(`document.getElementById('m-cut').getAttribute('aria-checked')`)) === 'true', '[320 px] the row Section now has its tick')
  await press('m-cut')
  await sleep(200)
  check((await ev(`document.getElementById('sec-axis').value`)) === '', '[320 px] a second press switches it off again')
  // the sidebar button in the status bar
  await send('Emulation.setDeviceMetricsOverride', { width: 900, height: 800, deviceScaleFactor: 1, mobile: false })
  await sleep(400)
  const side0 = await ev(`document.getElementById('main').classList.contains('side-closed')`)
  await press('b-panel')
  await sleep(150)
  check((await ev(`document.getElementById('main').classList.contains('side-closed')`)) === !side0 && (await ev(`document.getElementById('b-panel').getAttribute('aria-pressed')`)) === String(side0), '[900 px] the sidebar button in the status bar opens and closes the sidebar and follows its state')
  // a switched-on button keeps its blue and white text under the pointer (the pointer stays on it after a click)
  await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 800, deviceScaleFactor: 1, mobile: false })
  await sleep(400)
  await press('b-measure')
  const mb = await ev(`(() => { const r = document.getElementById('b-measure').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2] })()`)
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: mb[0], y: mb[1] })
  await sleep(200)
  const hov = await ev(`(() => { const b = document.getElementById('b-measure'); const c = getComputedStyle(b); return { hover: b.matches(':hover'), bg: c.backgroundColor, fg: c.color } })()`)
  check(hov.hover && hov.bg === 'rgb(37, 99, 235)' && hov.fg === 'rgb(255, 255, 255)', `[hover] Measure is on and under the pointer: still blue with white text (${hov.bg} / ${hov.fg})`)
  await press('b-measure')
  // ===== UX v3 E2a: cards and the three-column layout from 1200 px (THREE_AT); the panel stays beside the view below that =====
  for (const lang of ['de', 'en']) {
    await open(modelFile, { width: 1400, theme: lang === 'de' ? 'dark' : 'light', lang })
    const geo = () => ev(`(() => {
      const r = (sel) => { const e = document.querySelector(sel); if (!e) return null; const b = e.getBoundingClientRect(); return { l: Math.round(b.left), r: Math.round(b.right), t: Math.round(b.top), b: Math.round(b.bottom), w: Math.round(b.width), h: Math.round(b.height), shown: !e.closest('[hidden]') && b.width > 0 } }
      const inCol = (id) => { const e = document.getElementById(id); return e ? (e.closest('#col-l') ? 'col-l' : e.closest('#side') ? 'side' : 'other') : null }
      /* the title of the card counts as its heading: with tabs the head is only the "?", the tab names the panel */
      const heads = [...document.querySelectorAll('.card-panel')].filter((p) => !p.hidden && p.getBoundingClientRect().height > 0).map((p) => ({ id: p.id, head: (p.querySelector(':scope > .card-h .card-t') || {}).offsetHeight > 0, radius: getComputedStyle(p).borderTopLeftRadius, border: getComputedStyle(p).borderTopWidth }))
      const sc = getComputedStyle(document.getElementById('stage')); return { stageStyle: { border: sc.borderTopWidth, radius: sc.borderTopLeftRadius, margin: sc.marginLeft + ' ' + sc.marginTop }, bar: r('#bar'), status: r('#status'), three: document.body.classList.contains('three'), layout: document.body.dataset.layout, col: r('#col-l'), stage: r('#stage'), side: r('#side'), tabs: r('#side-tabs'), parts: inCol('tp-parts'), heads, scroll: document.documentElement.scrollWidth - innerWidth, tabsShown: [...document.querySelectorAll('#side-tabs .tab')].filter((b) => !b.hidden).length }
    })()`)
    for (const w of [1400, 1300, 1200]) {
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: 800, deviceScaleFactor: 1, mobile: false })
      await sleep(500)
      const g = await geo()
      const tag = `${w} px ${lang}`
      check(g.three && g.layout === 'three', `[cards ${tag}] three columns (layout ${g.layout})`)
      check(g.col && g.col.shown && Math.abs(g.col.w - 252) <= 2, `[cards ${tag}] the left column is 252 px wide (${g.col && g.col.w})`)
      check(g.col.r <= g.stage.l + 1 && g.stage.r <= g.side.l + 1 && g.side.r <= w + 1, `[cards ${tag}] left column, view, right column stand side by side inside the window`)
      check(g.stage.w >= 360, `[cards ${tag}] the view keeps ${g.stage.w} px (at least 360)`)
      // round 5: the view is a card (border 1 px, the card rounding 12 px, a gap of 8 px to the bars and to both columns); it costs the view 16 px
      check(g.stageStyle.border === '1px' && g.stageStyle.radius === '12px' && g.stageStyle.margin === '8px 8px', `[card ${tag}] the view is a card: border ${g.stageStyle.border}, rounding ${g.stageStyle.radius}, gap ${g.stageStyle.margin}`)
      check(g.stage.l - g.col.r === 8 && g.side.l - g.stage.r === 9 && g.stage.t - g.bar.b === 8 && g.status.t - g.stage.b === 8, `[card ${tag}] 8 px between the view and the left column (${g.stage.l - g.col.r}), 9 to the right column (8 and the 1 px of the resizer: ${g.side.l - g.stage.r}), the toolbar (${g.stage.t - g.bar.b}) and the status bar (${g.status.t - g.stage.b})`)
      check(g.stage.w === w - 252 - g.side.w - 16 - 1, `[card ${tag}] the view is ${g.stage.w} px: the window ${w} minus the columns (252 + ${g.side.w}) minus 16 for the gap and 1 for the resizer`)
      check(g.parts === 'col-l', `[cards ${tag}] the Parts card is in the left column (${g.parts})`)
      check(!g.tabs || !g.tabs.shown || g.tabsShown === 0 || g.tabs.h === 0, `[cards ${tag}] no tab row in three columns`)
      check(g.heads.length >= 2 && g.heads.every((h) => h.head && h.radius === '12px' && h.border === '1px'), `[cards ${tag}] every visible panel is a card with a heading, radius 12 and a border (${g.heads.map((h) => h.id).join(' ')})`)
      check(g.scroll <= 0, `[cards ${tag}] no sideways scrolling of the page (${g.scroll})`)
    }
    // below 1200 px: one column with tabs, the panel stays next to the view (decision 5), down to the narrow sheet; 699/700 is the pair of limits of the card
    for (const w of [1199, 1100, 900, 701, 700, 699, 600, 520]) {
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: 800, deviceScaleFactor: 1, mobile: false })
      await sleep(500)
      const g = await geo()
      const tag = `${w} px ${lang}`
      check(!g.three && g.layout === 'wide', `[cards ${tag}] one column, not three (layout ${g.layout})`)
      check(g.col && !g.col.shown, `[cards ${tag}] the left column is gone`)
      check(g.parts === 'side', `[cards ${tag}] the Parts panel is back in the side panel (${g.parts})`)
      check(g.side.shown && g.side.l >= g.stage.r - 1 && g.side.t <= g.stage.t + 2, `[cards ${tag}] the side panel stands beside the view, not under it (side left ${g.side.l}, view right ${g.stage.r})`)
      check(g.stage.w >= 230, `[cards ${tag}] the view keeps ${g.stage.w} px`)
      const card = w >= 700 // CARD_AT
      check(card ? g.stageStyle.border === '1px' && g.stageStyle.radius === '12px' && g.stageStyle.margin === '8px 8px' : g.stageStyle.border === '0px' && g.stageStyle.radius === '0px' && g.stageStyle.margin === '0px 0px', `[card ${tag}] ${card ? 'the view is a card (border, rounding 12, gap 8)' : 'under 700 px the view runs to the edge'}: ${JSON.stringify(g.stageStyle)}`)
      if (card) check(g.side.l - g.stage.r === 9 && g.stage.l === 8 && g.stage.t - g.bar.b === 8 && g.status.t - g.stage.b === 8, `[card ${tag}] 8 px around the view (left ${g.stage.l}, to the side panel ${g.side.l - g.stage.r} with the 1 px of the resizer, top ${g.stage.t - g.bar.b}, bottom ${g.status.t - g.stage.b})`)
      check(g.tabsShown >= 2 && g.heads.every((h) => !h.head), `[cards ${tag}] tabs, and no card headings (${g.tabsShown} tabs)`)
      check(g.scroll <= 0, `[cards ${tag}] no sideways scrolling (${g.scroll})`)
    }
    // Section card: only while a plane is on; "Off" switches it off and the focus goes to the bar's Section button
    await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 800, deviceScaleFactor: 1, mobile: false })
    await sleep(500)
    const cutShown = () => ev(`(() => { const p = document.getElementById('tp-cut'); return !!p && !p.hidden && p.getBoundingClientRect().height > 0 })()`)
    check(!(await cutShown()), `[cards ${lang}] no Section card while no plane is on`)
    await press('b-cut')
    await sleep(300)
    check(await cutShown(), `[cards ${lang}] the Section button brings the Section card`)
    const offVis = await ev(`(() => { const b = document.getElementById('b-cut-off'); return !!b && b.offsetParent !== null && /^(Off|Aus)$/.test(b.textContent) })()`)
    check(offVis, `[cards ${lang}] the Section card has an Off button`)
    await press('b-cut-off')
    await sleep(300)
    check(!(await cutShown()) && (await ev(`document.getElementById('sec-axis').value`)) === '' && (await ev(`document.activeElement.id`)) === 'b-cut', `[cards ${lang}] Off removes the card and returns the focus to the Section button (${await ev('document.activeElement.id')})`)
    // Edit card: folded until it is asked for
    const edit = () => ev(`(() => { const p = document.getElementById('tp-edit'); const b = document.getElementById('b-card-edit'); return { shown: !!p && !p.hidden && p.getBoundingClientRect().height > 0, collapsed: p.classList.contains('collapsed'), expanded: b.getAttribute('aria-expanded'), h: Math.round(p.getBoundingClientRect().height) } })()`)
    const e0 = await edit()
    check(e0.shown && e0.collapsed && e0.expanded === 'false' && e0.h < 80, `[cards ${lang}] the Edit card is folded (${e0.h} px)`)
    await press('b-card-edit')
    await sleep(200)
    const e1 = await edit()
    check(!e1.collapsed && e1.expanded === 'true' && e1.h > 150, `[cards ${lang}] its button unfolds it (${e1.h} px)`)
    await press('b-card-edit')
    // from three columns to one: the tabs come back (the tab list is shown, every panel is a tab panel again, the Parts tab can be chosen)
    await send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 800, deviceScaleFactor: 1, mobile: false })
    await sleep(500)
    await ev(`window.__h.chrome.tabs.select('parts')`)
    const back = await ev(`(() => { const p = document.getElementById('tp-parts'); const open = [...document.querySelectorAll('.tabpanel')].filter((x) => !x.hidden).length; return { parts: p.closest('#side') !== null, one: open, tabs: getComputedStyle(document.getElementById('side-tabs')).display !== 'none', role: p.getAttribute('role'), by: p.getAttribute('aria-labelledby') } })()`)
    check(back.parts && back.one === 1 && back.tabs && back.role === 'tabpanel' && /^tab-/.test(back.by), `[cards ${lang}] back to one column: the tab list is there, one panel at a time, panels are tab panels again (${back.one}, ${back.role})`)
    // three columns: a panel is a region named by its card heading (there is no tab row to name it)
    await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 800, deviceScaleFactor: 1, mobile: false })
    await sleep(500)
    const aria = await ev(`(() => [...document.querySelectorAll('.card-panel')].filter((x) => !x.hidden).map((p) => ({ id: p.id, role: p.getAttribute('role'), name: (document.getElementById(p.getAttribute('aria-labelledby')) || {}).textContent, title: (p.querySelector(':scope > .card-h > .card-t') || {}).textContent })))()`)
    check(aria.length >= 2 && aria.every((a) => a.role === 'region' && a.name && a.name.trim().length > 0 && a.name === a.title), `[cards ${lang}] three columns: each card is a region named by its title alone, not by the "?" and the buttons of its head (${aria.map((a) => a.name).join(', ')})`)
    const helpNames = await ev(`[...document.querySelectorAll('.card-panel .help-btn, .part-cards .help-btn')].filter((b) => b.getClientRects().length > 0).map((b) => b.getAttribute('aria-label'))`)
    check(helpNames.length >= 2 && new Set(helpNames).size === helpNames.length && helpNames.every((n) => /: /.test(n)), `[cards ${lang}] every "?" names its card (${helpNames.join(' | ')})`)
    const longDims3 = await ev(DIMS_PROBE)
    check(longDims3.short.inside && longDims3.short.apart && !longDims3.short.stack && longDims3.long.inside && longDims3.long.apart && longDims3.long.stack && longDims3.mid.inside && longDims3.mid.apart && longDims3.units.inside && longDims3.units.stack && longDims3.assumed, `[cards ${lang}] three columns: the sizes in the narrow right column do not run into each other either (${JSON.stringify(longDims3)})`)
    check(await ev(`document.getElementById('b-card-edit').getAttribute('aria-controls') === 'tp-edit'`), `[cards ${lang}] the Edit card's button names what it controls`)
    // the Edit tab in use becomes an open Edit card when the window gets wide
    await send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 800, deviceScaleFactor: 1, mobile: false })
    await sleep(400)
    await ev(`window.__h.chrome.tabs.select('edit')`)
    await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 800, deviceScaleFactor: 1, mobile: false })
    await sleep(500)
    const e2 = await edit()
    check(!e2.collapsed && e2.expanded === 'true', `[cards ${lang}] Edit was the tab in use: its card is open in three columns`)
    await press('b-card-edit')
    // the sidebar button closes both columns; with no file there is no left column either
    await press('b-panel')
    await sleep(300)
    const closed = await geo()
    check(closed.stage.r === 1400 - 8 && closed.stage.l === 8 && closed.stage.t - closed.bar.b === 8 && closed.status.t - closed.stage.b === 8 && closed.stageStyle.border === '1px', `[card ${lang}] the sidebar closed: the view is still a card with 8 px around it, from ${closed.stage.l} to ${closed.stage.r} of 1400`)
    // the focus ring of the canvas goes round the card (the square ring would be cut by the rounding); a key press first, so that the focus counts as the keyboard's
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: 16 })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: 16 })
    const ring = await ev(`(() => { const gl = document.getElementById('gl'); gl.focus(); const st = document.getElementById('stage'); const c = getComputedStyle(st); const g = getComputedStyle(gl); return { fv: gl.matches(':focus-visible'), stage: c.outlineStyle + ' ' + c.outlineWidth, canvas: g.outlineStyle } })()`)
    check(ring.fv && ring.stage === 'solid 2px' && ring.canvas === 'none', `[card ${lang}] the canvas with the keyboard's focus: the ring is on the card (${JSON.stringify(ring)}), not a square ring on the canvas`)
    await ev(`document.activeElement && document.activeElement.blur()`)
    check(closed.col && !closed.col.shown && !closed.side.shown, `[cards ${lang}] the sidebar button closes the left column too`)
    await press('b-panel')
    await sleep(300)
    check((await geo()).col.shown, `[cards ${lang}] and opens it again`)
    // a window dragged over the limit and back with a part selected: nothing lost, nothing doubled
    await ev(`(() => { const r = document.querySelector('.part[data-i], .part'); r && r.dispatchEvent(new MouseEvent('click', { bubbles: true })) })()`)
    const sel0 = await ev(`document.querySelectorAll('.part.sel').length`)
    for (const w of [1199, 1200, 1199, 1400]) {
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: 800, deviceScaleFactor: 1, mobile: false })
      await sleep(400)
    }
    const after = await ev(`(() => ({ sel: document.querySelectorAll('.part.sel').length, lists: document.querySelectorAll('#parts').length, panels: document.querySelectorAll('#tp-parts').length, card: document.querySelectorAll('#part-card').length }))()`)
    check(after.sel === sel0 && after.lists === 1 && after.panels === 1 && after.card <= 1, `[cards ${lang}] 1199 > 1200 > 1199 > 1400 with a part selected: the selection stays, nothing is doubled (${JSON.stringify(after)})`)
    // under 520 px: the sheet under the view, no three columns (the narrow layout is the only one that goes under the picture)
    for (const w of [519, 420]) {
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: 800, deviceScaleFactor: 1, mobile: false })
      await sleep(500)
      const g = await geo()
      check(g.layout === 'narrow' && !g.three && g.col && !g.col.shown && g.scroll <= 0, `[cards ${w} px ${lang}] the narrow sheet, no left column, no sideways scrolling (${g.layout})`)
    }
  }
  // the width of the panel the person chose in the one-column layout does not squeeze the three-column view (it is remembered for each layout)
  await open(modelFile, { width: 1400, theme: 'dark', lang: 'en', prefs: { ui: { sideW: 420 } } })
  const w3 = await ev(`Math.round(document.getElementById('side').getBoundingClientRect().width)`)
  check(Math.abs(w3 - 292) <= 2, `[cards] a remembered panel width of 420 px is not used in three columns (${w3} px, the default is 292)`)
  await send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 800, deviceScaleFactor: 1, mobile: false })
  await sleep(500)
  const w1 = await ev(`Math.round(document.getElementById('side').getBoundingClientRect().width)`)
  check(Math.abs(w1 - 420) <= 2, `[cards] ... but it is used in the one-column layout (${w1} px)`)
  // no file: no left column (an empty 252 px strip next to the start page was a finding of the first review)
  await open(modelFile, { width: 1400, theme: 'dark', lang: 'de', noFile: true })
  const gNo = await ev(`(() => { const c = document.getElementById('col-l'); return { shown: c.getClientRects().length > 0 && !c.hidden, w: c.getBoundingClientRect().width } })()`)
  check(!gNo.shown, `[cards] no file: no left column at 1400 px (${gNo.w} px)`)

} catch (e) {
  console.error(e)
  failures++
} finally {
  try { ws.close() } catch {}
  chrome.kill()
  server.kill()
}
console.log(failures ? `\n${failures} check(s) failed` : `\nall checks passed`)
process.exit(failures ? 1 : 0)

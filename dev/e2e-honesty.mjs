#!/usr/bin/env node
// The honesty check on the REAL page (UX v3, stage E3): every number on a card has a declared origin, an estimate carries its mark and is only there on request,
// nothing invented is shown. Runs in headless Chrome through the plugin's harness, German and English, in three columns (1400 px) and in one column with tabs
// (600 px), with nothing selected, one part, two parts and (STEP) a weight estimate. Then the test of the test: 20 deliberate violations are put into the real page
// one by one and the check must find each of them.   node dev/e2e-honesty.mjs   Rules: dev/honesty-rules.mjs
import { spawn, execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { PAGE_CHECK, PROBES, staticChecks } from './honesty-rules.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const plugin = join(here, '..')
const isStep = existsSync(join(plugin, 'samples', 'assembly.step'))
const dir = mkdtempSync(join(tmpdir(), 'honesty-e2e-'))
const samples = join(dir, 'samples')
execFileSync('mkdir', ['-p', samples])
let modelFile
let nestedFile // a model with a tree (groups): the part tree is checked on it as well
if (isStep) {
  modelFile = join(plugin, 'samples', 'assembly.step')
  const m = await import(pathToFileURL(join(here, 'make-nested-step.mjs')).href)
  nestedFile = join(samples, 'nested.step')
  writeFileSync(nestedFile, m.nestedStep())
} else {
  execFileSync('python3', [join(here, 'make_samples.py'), '--out', samples], { stdio: 'ignore' })
  modelFile = join(samples, 'parts.glb')
  nestedFile = join(samples, 'nested.glb')
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
const open = async ({ lang, width, noFile = false, file = modelFile }) => {
  await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false })
  await send('Page.navigate', { url: `http://127.0.0.1:${port}/h/index.html?lang=${lang}&nodoc=1` })
  await sleep(300)
  await ev(`localStorage.clear(); sessionStorage.clear()`)
  await send('Page.navigate', { url: `http://127.0.0.1:${port}/h/index.html?${noFile ? 'nodoc=1' : `file=${encodeURIComponent(file)}`}&lang=${lang}` })
  await sleep(300)
  if (!noFile) await waitFor(`document.documentElement.dataset.state === 'ok'`, 90000, 'the model to load')
  await sleep(500)
}
const clickRow = (i, mods = {}) => ev(`(() => { const r = document.querySelector('.part[data-i="${i}"]'); r.dispatchEvent(new MouseEvent('click', { bubbles: true, ...${JSON.stringify(mods)} })) })()`)
const parts = () => ev(isStep ? `window.__h.rows.map((r, i) => (r.meshes.length === 1 && !r.group ? i : -1)).filter((i) => i >= 0)` : `window.__h.parts.map((_, i) => i)`)
const found = () => ev(PAGE_CHECK)
const cardsOnScreen = () => ev(`[...document.querySelectorAll('[data-honest]')].filter((e) => !e.closest('[hidden]') && e.getClientRects().length > 0).map((e) => e.id || e.dataset.card)`)
const chooseSteel = async () => {
  await ev(`(() => { const s = document.getElementById('pc-dens'); s.value = 'steel'; s.dispatchEvent(new Event('change', { bubbles: true })) })()`)
  await sleep(200)
}
// a part is selected and its numbers are worked out
const selectOne = async (L, k) => {
  await clickRow(L[k])
  await waitFor(`(() => { const b = document.getElementById('pc-vol-big'); return !!b && b.textContent !== '…' })()`, 20000, 'the volume of the part')
}
try {
  let targets
  for (let i = 0; i < 50; i++) {
    try {
      targets = await (await fetch(`http://127.0.0.1:${chromePort}/json`)).json()
      if (targets.some((t) => t.type === 'page')) break
    } catch {}
    await sleep(200)
  }
  ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl)
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data)
    if (d.method === 'Runtime.exceptionThrown') { console.error('PAGE ERROR', d.params.exceptionDetails.exception?.description); failures++ }
    if (d.id && pend.has(d.id)) { pend.get(d.id)({ result: d.result, error: d.error }); pend.delete(d.id) }
  }
  await new Promise((r) => (ws.onopen = r))
  await send('Page.enable')
  await send('Runtime.enable')

  // the source: no numbers on a canvas, only the letters of an origin display as CSS content (every shared file and the viewer's own css)
  const css = [join(plugin, 'editor', 'shared', 'shell.css'), join(plugin, 'editor', 'viewer.css')].map((f) => readFileSync(f, 'utf8')).join('\n')
  const js = readdirSync(join(plugin, 'editor', 'shared')).filter((f) => f.endsWith('.js')).map((f) => readFileSync(join(plugin, 'editor', 'shared', f), 'utf8')).join('\n')
  const st = staticChecks(css + '\n' + js)
  check(st.length === 0, `source: no strokeText, CSS content only the letters of an origin display${st.length ? ' (' + st.join('; ') + ')' : ''}`)

  // with no model: no card, so no number of a file
  await open({ lang: 'en', width: 1400, noFile: true })
  check((await cardsOnScreen()).every((c) => c === 'status') && (await found()).length === 0, 'no model: no card on screen (only the status bar, empty of numbers), nothing found')

  for (const lang of ['en', 'de']) {
    for (const width of [1400, 600]) {
      const tag = `${lang} ${width} px`
      await open({ lang, width })
      let L = await parts()
      const markWord = lang === 'de' ? 'Schätzung' : 'Estimate'
      // nothing selected: the Info card is on screen (three columns) or the Info tab is not (one column: the Parts tab is the current one)
      let f = await found()
      check(f.length === 0, `[${tag}] loaded, nothing selected: no finding${f.length ? ': ' + f.join(' | ') : ''}`)
      if (width >= 1200) check((await cardsOnScreen()).includes('tp-info'), `[${tag}] the Info card is checked (${await cardsOnScreen()})`)
      // the part tree (names, triangle numbers, ticks, count) and the card Files
      const first = await cardsOnScreen()
      check(first.includes('tp-parts') || width < 1200, `[${tag}] the part tree is checked (${first.join(' ')})`)
      check(first.includes('status') && first.includes('scalebar'), `[${tag}] the status bar and the scale bar are checked (${first.join(' ')})`)
      if (width >= 1200) check(first.includes('card-files'), `[${tag}] the card Files is checked`)
      else {
        await ev(`(() => { const t = [...document.querySelectorAll('#side-tabs .tab')].find((x) => /Info/.test(x.textContent)); t && t.click() })()`)
        await sleep(150)
        f = await found()
        check((await cardsOnScreen()).includes('card-files') && f.length === 0, `[${tag}] the Info tab: the card Files is checked and nothing is found${f.length ? ': ' + f.join(' | ') : ''}`)
        await ev(`(() => { const t = [...document.querySelectorAll('#side-tabs .tab')].find((x) => /Parts|Teile/.test(x.textContent)); t && t.click() })()`)
        await sleep(150)
      }
      // one part
      await selectOne(L, 1)
      f = await found()
      let on = await cardsOnScreen()
      check(f.length === 0 && ['pc-info', 'pc-dims', 'pc-vol'].every((c) => on.includes(c)), `[${tag}] one part: the part cards are checked (${on.join(' ')}) and nothing is found${f.length ? ': ' + f.join(' | ') : ''}`)
      if (isStep) {
        check(on.includes('pc-weight'), `[${tag}] STEP: the weight card is checked`)
        await chooseSteel()
        f = await found()
        const mark = await ev(`(() => { const t = document.querySelector('#pc-w-res .tag.est'); return t ? t.textContent : null })()`)
        check(f.length === 0 && mark === markWord, `[${tag}] a density chosen: the estimate with its mark "${mark}" and nothing found${f.length ? ': ' + f.join(' | ') : ''}`)
      }
      // two parts
      await clickRow(L[0])
      await clickRow(L[2], { metaKey: true })
      await waitFor(`(() => { const b = document.getElementById('pc-vol-big'); return !!b && b.textContent !== '…' })()`, 20000, 'the volume of two parts')
      f = await found()
      check(f.length === 0, `[${tag}] two parts: nothing found${f.length ? ': ' + f.join(' | ') : ''}`)
      if (isStep) {
        await chooseSteel()
        f = await found()
        check(f.length === 0 && (await ev(`!!document.querySelector('#pc-w-res')`)), `[${tag}] two parts with a density: one estimate for the sum, nothing found${f.length ? ': ' + f.join(' | ') : ''}`)
      }
    }
  }

  // a model with a tree: groups, folded, filtered and selected through a group, in three columns and in one column with tabs
  for (const lang of ['en', 'de']) for (const width of [1400, 600]) {
    await open({ lang, width, file: nestedFile })
    const tag = `nested ${lang} ${width} px`
    let f = await found()
    check(f.length === 0 && (await cardsOnScreen()).includes('tp-parts'), `[${tag}] the tree of groups: nothing found${f.length ? ': ' + f.join(' | ') : ''}`)
    await ev(`(() => { const b = document.querySelector('#parts .part.group button.tw'); b && b.click() })()`) // a group folded
    f = await found()
    check(f.length === 0, `[${tag}] a group folded: nothing found${f.length ? ': ' + f.join(' | ') : ''}`)
    await ev(`(() => { const r = document.querySelector('#parts .part.group'); r && r.dispatchEvent(new MouseEvent('click', { bubbles: true })) })()`) // a part selected through its group
    await sleep(500)
    f = await found()
    check(f.length === 0, `[${tag}] a group selected (its parts are selected): nothing found${f.length ? ': ' + f.join(' | ') : ''}`)
    await ev(`(() => { const x = document.getElementById('filter'); x.value = 'a'; x.dispatchEvent(new Event('input', { bubbles: true })) })()`)
    await sleep(150)
    f = await found()
    check(f.length === 0, `[${tag}] a filter on: nothing found${f.length ? ': ' + f.join(' | ') : ''}`)
  }

  // the test of the test: every deliberate violation must be found; the page is rebuilt between them (another part selected and back)
  await open({ lang: 'de', width: 1400 })
  const L = await parts()
  const reset = async () => {
    await clickRow(L[0])
    await selectOne(L, 1)
    if (isStep) await chooseSteel()
  }
  await reset()
  check((await found()).length === 0, 'probes: the starting point has no finding')
  let caught = 0
  let ran = 0
  for (const p of PROBES) {
    if (p.step && !isStep) continue
    ran++
    await ev(p.run)
    const f = await found()
    const hit = f.some((x) => x.startsWith(p.expect)) // found by the rule that was meant, not by another one
    if (hit) caught++
    check(hit, `probe "${p.name}": found by ${p.expect} (${f.length ? f[0].slice(0, 70) : 'NOT FOUND'})`)
    if (p.undo) await ev(p.undo) // what the page does not rebuild itself (the Info card) is put back by the probe
    await reset()
    if ((await found()).length !== 0) check(false, `probe "${p.name}": the page was not restored`)
  }
  check(caught === ran, `${caught} of ${ran} deliberate violations were found`)
  if (!isStep) check(!(await ev(`!!document.getElementById('pc-weight') || !!document.getElementById('pc-dens')`)), 'Model viewer: the weight card is not in the page at all')
} catch (e) {
  console.error(e)
  failures++
} finally {
  try { ws.close() } catch {}
  chrome.kill()
  server.kill()
}
console.log(failures ? `\n${failures} check(s) failed` : `\nall ${total} checks passed`)
process.exit(failures ? 1 : 0)

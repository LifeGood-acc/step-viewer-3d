// Run with `orca plugin test .` (node:test). Pure logic, string tables, license/bundle integrity and a no-network lint.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { KEYMAP, VIEW_NAMES } from '../editor/shared/keymap.js'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { summarizeParts, fitDistance, STRINGS, makeT, makeFormat, niceStep, partHue, pickLocale, detectStepUnit, planUnit, buildRows, converterParams, QUALITY, memoryEstimateGB, WARN_BYTES, looksLikeStep, isStartText, extOf, pickFile, SUPPORTED_EXT, HARD_MAX_BYTES, stateLine, presetDirection, PRESETS, clipPlane, fileAxisToView, measureInfo } from '../editor/lib.js'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const editor = join(root, 'editor')
const enc = new TextEncoder()

test('every English string has a German one, with the same placeholders', () => {
  assert.deepEqual(Object.keys(STRINGS.en).sort(), Object.keys(STRINGS.de).sort())
  for (const k of Object.keys(STRINGS.en)) {
    const ph = (s) => (s.match(/\{\w+\}/g) || []).sort().join(',')
    assert.ok(STRINGS.de[k].length > 0 && STRINGS.en[k].length > 0, k)
    assert.equal(ph(STRINGS.de[k]), ph(STRINGS.en[k]), k)
  }
})

test('every key used in the page or the scripts exists', () => {
  const html = readFileSync(join(editor, 'index.html'), 'utf8')
  const js = readFileSync(join(editor, 'viewer.js'), 'utf8')
  const used = new Set()
  for (const m of html.matchAll(/data-i18n(?:-title)?="(\w+)"/g)) used.add(m[1])
  for (const m of js.matchAll(/\bt\('(\w+)'\s*[,)]/g)) used.add(m[1])
  for (const u of ['millimeter', 'centimeter', 'meter', 'inch', 'foot', 'micron', 'kilometer']) used.add('u_' + u)
  for (const q of Object.keys(QUALITY)) used.add('q_' + q)
  for (const m of ['auto', 'light', 'dark']) used.add('bg_' + m)
  for (const k of used) assert.ok(k in STRINGS.en, `missing string: ${k}`)
})

test('locale choice, fallback and formats', () => {
  assert.equal(pickLocale('de-DE'), 'de')
  assert.equal(pickLocale('fr'), 'en')
  assert.equal(makeT('de')('parts_visible', { v: 2, n: 5 }), '2 / 5 sichtbar')
  assert.equal(makeT('en')('nope'), 'nope')
  const f = makeFormat('en')
  assert.equal(f.mb(31213), '31.2 KB')
  assert.equal(f.len(-1e-9), '0') // never "-0"
  // a model in meters: 0.045 m is not 0.05, a small volume is not "0"
  assert.equal(f.len(0.045), '0.045')
  assert.equal(f.len(0.235), '0.235')
  assert.equal(f.len(1.2e-4), '0.00012')
  assert.equal(f.vol(1.2e-4, 'm'), '120 cm³')
  assert.equal(f.vol(1000, 'mm'), '1,000 mm³')
  assert.equal(f.area(0.0008, 'm'), '8 cm²')
  assert.equal(makeFormat('de').vol(2.5, 'm'), '2,5 m³')
  assert.equal(f.int(1234567), '1,234,567')
})

test('part totals: triangles, vertices, points and faces over the parts (points do not count as vertices)', () => {
  const r = summarizeParts([{ tris: 12, verts: 8, kind: 'mesh', faces: 6 }, { tris: 0, verts: 100, kind: 'points' }, { tris: 4, verts: 6, kind: 'lines' }, {}])
  assert.deepEqual(r, { tris: 16, verts: 14, pts: 100, faces: 6 })
  assert.deepEqual(summarizeParts([]), { tris: 0, verts: 0, pts: 0, faces: 0 })
})

test('fit distance: a narrow, tall view needs more distance than a wide one, and the sphere then fits in both directions', () => {
  const wide = fitDistance(1, 50, 1.6)
  const square = fitDistance(1, 50, 1)
  const tall = fitDistance(1, 50, 0.5)
  assert.ok(Math.abs(wide - square) < 1e-9, 'a wide view is limited by the vertical field of view, as before')
  assert.ok(tall > square * 1.5, `${tall} vs ${square}`)
  const hfov = 2 * Math.atan(Math.tan((50 * Math.PI) / 360) * 0.5)
  assert.ok(Math.sin(hfov / 2) * tall >= 1, 'the sphere of radius 1 fits the horizontal field of view')
})

test('grid step and hues', () => {
  for (const e of [0.3, 1, 42, 400, 1e5]) {
    const s = niceStep(e)
    const m = s / Math.pow(10, Math.floor(Math.log10(s)))
    assert.ok([1, 2, 5].includes(Math.round(m * 1e6) / 1e6), `${e} -> ${s}`)
  }
  for (let i = 0; i < 50; i++) assert.ok(Math.abs(partHue(i) - partHue(i + 1)) > 0.05)
})

test('STEP unit detection: SI prefixes, inch, foot, none', () => {
  const u = (s) => detectStepUnit(enc.encode(s))
  assert.deepEqual(u('#5=(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.));'), { name: 'millimeter', found: true })
  assert.deepEqual(u('#5 = ( LENGTH_UNIT ( ) NAMED_UNIT ( * ) SI_UNIT ( .CENTI. , .METRE. ) ) ;'), { name: 'centimeter', found: true })
  assert.deepEqual(u('#5=( LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT($,.METRE.) );'), { name: 'meter', found: true })
  assert.deepEqual(u("#1=( CONVERSION_BASED_UNIT('INCH',#2) LENGTH_UNIT() NAMED_UNIT(#3) );"), { name: 'inch', found: true })
  assert.deepEqual(u("#1=( CONVERSION_BASED_UNIT('FOOT',#2) LENGTH_UNIT() NAMED_UNIT(#3) );"), { name: 'foot', found: true })
  assert.deepEqual(u('#5=(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MICRO.,.METRE.));'), { name: 'micron', found: true })
  assert.deepEqual(u('#5=(NAMED_UNIT(*)PLANE_ANGLE_UNIT()SI_UNIT($,.RADIAN.));'), { name: 'millimeter', found: false })
  assert.deepEqual(u(''), { name: 'millimeter', found: false })
  // the SI unit an inch is defined from may come first in the file: the conversion-based unit wins
  assert.deepEqual(u("#1=(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.));\n#2=( CONVERSION_BASED_UNIT('INCH',#9) LENGTH_UNIT() NAMED_UNIT(#3) );"), { name: 'inch', found: true })
})

test('unit plan: what the converter is asked for, and how the unit is described', () => {
  assert.deepEqual(planUnit({ name: 'inch', found: true }), { linearUnit: 'inch', short: 'in', mode: 'file', fileUnit: 'inch' })
  assert.equal(planUnit({ name: 'micron', found: true }).mode, 'converted')
  assert.equal(planUnit({ name: 'micron', found: true }).linearUnit, 'millimeter')
  assert.equal(planUnit({ name: 'millimeter', found: false }).mode, 'default')
})

test('quality presets: finer means smaller deflections', () => {
  const c = QUALITY.coarse, n = QUALITY.normal, f = QUALITY.fine
  assert.ok(c.linearDeflection > n.linearDeflection && n.linearDeflection > f.linearDeflection)
  assert.ok(c.angularDeflection > n.angularDeflection && n.angularDeflection > f.angularDeflection)
  assert.deepEqual(converterParams('normal', 'meter'), { linearUnit: 'meter', linearDeflectionType: 'bounding_box_ratio', linearDeflection: 0.001, angularDeflection: 0.5 })
  assert.deepEqual(converterParams('bogus', 'meter'), converterParams('normal', 'meter'))
})

test('memory estimate follows the two measured points', () => {
  assert.ok(Math.abs(memoryEstimateGB(4.34e6) - 0.46) < 0.15) // measured 0.46 GB
  assert.ok(Math.abs(memoryEstimateGB(34.6e6) - 1.52) < 0.3) // measured 1.52 GB
  assert.ok(memoryEstimateGB(WARN_BYTES) > 0.5)
})

test('assembly rows: nesting, nameless wrappers, several meshes, unreachable meshes', () => {
  const name = (n) => 'Part ' + n
  assert.deepEqual(buildRows({ name: '', meshes: [], children: [{ name: 'assembly', meshes: [0, 1], children: [] }] }, ['', ''], name), [
    { depth: 0, name: 'assembly', src: 'file', meshes: [0, 1], group: true },
    { depth: 1, name: 'Part 1', src: 'ui', meshes: [0], group: false },
    { depth: 1, name: 'Part 2', src: 'ui', meshes: [1], group: false }
  ])
  const nested = buildRows({ name: 'Top', meshes: [], children: [{ name: 'Sub', meshes: [], children: [{ name: 'Leaf', meshes: [2] }] }, { name: '', meshes: [0] }] }, ['A', 'B', 'C'], name)
  assert.deepEqual(nested.map((r) => [r.depth, r.name, r.meshes.join(','), r.group]), [
    [0, 'Top', '2,0', true],
    [1, 'Sub', '2', true],
    [2, 'Leaf', '2', false],
    [1, 'A', '0', false],
    [0, 'B', '1', false] // mesh 1 is in no node: still listed
  ])
  assert.deepEqual(buildRows(null, ['x'], name), [{ depth: 0, name: 'x', src: 'file', meshes: [0], group: false }])
  assert.deepEqual(buildRows({ meshes: [9, -1, 1.5], children: [] }, [], name), [])
})

test('STEP header check', () => {
  assert.ok(looksLikeStep(enc.encode('ISO-10303-21;\nHEADER;')))
  assert.ok(looksLikeStep(enc.encode('  \n ISO-10303-21;')))
  assert.ok(!looksLikeStep(enc.encode('solid cube\nfacet normal')))
  assert.ok(!looksLikeStep(new Uint8Array(0)))
})

test('the sample STEP file is a STEP file with a length unit', () => {
  const s = readFileSync(join(root, 'samples', 'assembly.step'))
  assert.ok(looksLikeStep(new Uint8Array(s)))
  assert.deepEqual(detectStepUnit(new Uint8Array(s)), { name: 'millimeter', found: true })
})

test('the converter: WebAssembly unmodified, JS glue patched only by dev/patch-occt.mjs (LGPL: changes are documented)', async () => {
  const sha = (f) => createHash('sha256').update(readFileSync(join(root, f))).digest('hex')
  const wasm = readFileSync(join(root, 'editor/vendor/occt/occt-import-js.wasm')) // shipped as a plain file (the catalog rejects .gz)
  assert.equal(createHash('sha256').update(wasm).digest('hex'), '33391fc9d94ea5c869a6718488bf0a9a464222bac9bdc764dfe1690cef281952') // the file of npm occt-import-js@0.0.23, byte for byte
  assert.deepEqual([...wasm.subarray(0, 4)], [0x00, 0x61, 0x73, 0x6d], 'a WebAssembly module, not an archive')
  assert.equal(sha('licenses/original/occt-import-js-0.0.23.js'), '3fb44ce11d00611f9b3f3c5775d520ebab48930c1f08279b7b1316f05f0d3379') // the original glue
  assert.equal(sha('editor/vendor/occt/occt-import-js.js'), '6b6c2651245a711c259e712f8ee6653f57a07bdf84050be168d9237bde9fcde5') // the shipped, patched glue
  const { patch } = await import('../dev/patch-occt.mjs')
  assert.equal(patch(readFileSync(join(root, 'licenses/original/occt-import-js-0.0.23.js'), 'utf8')), readFileSync(join(root, 'editor/vendor/occt/occt-import-js.js'), 'utf8'), 'the shipped glue is not what dev/patch-occt.mjs produces')
  const glue = readFileSync(join(root, 'editor/vendor/occt/occt-import-js.js'), 'utf8')
  assert.ok(!/newFunc\(Function|new Function|\beval\(/.test(glue), 'the glue must not evaluate strings: Orca forbids unsafe-eval')
  const notices = readFileSync(join(root, 'THIRD_PARTY_NOTICES.md'), 'utf8')
  for (const needle of ['33391fc9d94ea5c869a6718488bf0a9a464222bac9bdc764dfe1690cef281952', '6b6c2651245a711c259e712f8ee6653f57a07bdf84050be168d9237bde9fcde5', '3fb44ce11d00611f9b3f3c5775d520ebab48930c1f08279b7b1316f05f0d3379', '0.0.23', '7.6.1', 'd2abb6d844231cb8f29be6894440874a4700e4a5', 'LGPL-2.1', 'exception', 'Replacing the converter', 'patch-occt', '0.187.0']) {
    assert.ok(notices.includes(needle), `THIRD_PARTY_NOTICES.md lacks: ${needle}`)
  }
})

test('license files are present and genuine', () => {
  for (const f of ['LICENSE', 'licenses/LICENSE-LGPL-2.1.txt', 'licenses/OCCT-LGPL-EXCEPTION-1.0.txt', 'editor/vendor/LICENSE.three.txt']) assert.ok(existsSync(join(root, f)), f)
  assert.match(readFileSync(join(root, 'licenses/LICENSE-LGPL-2.1.txt'), 'utf8'), /GNU LESSER GENERAL PUBLIC LICENSE\s+Version 2\.1/)
  assert.match(readFileSync(join(root, 'licenses/OCCT-LGPL-EXCEPTION-1.0.txt'), 'utf8'), /Open CASCADE exception \(version 1\.0\)/)
  assert.match(readFileSync(join(root, 'LICENSE'), 'utf8'), /^MIT License/)
  const readme = readFileSync(join(root, 'README.md'), 'utf8')
  assert.ok(/Open CASCADE Technology/.test(readme) && /LGPL/.test(readme), 'README must carry the OCCT notice')
})

test('the viewer makes no network requests and uses no eval', () => {
  // Only our own code: the vendored libraries are covered by their licenses and checked in the page run.
  for (const f of ['viewer.js', 'lib.js', 'index.html', 'viewer.css', 'step-worker.js']) {
    let text = readFileSync(join(editor, f), 'utf8')
    // the one thing that is fetched: the converter's own WebAssembly, by a fixed relative path (the worker and the page fallback)
    const own = "fetch('./vendor/occt/occt-import-js.wasm')"
    assert.ok(text.split(own).length - 1 <= 1, `${f} fetches the converter more than once`)
    text = text.split(own).join('')
    assert.ok(!/\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|\beval\s*\(|new Function/.test(text), `${f} uses a network or eval API`)
    for (const u of text.matchAll(/https?:\/\/[^\s'"`)<>]+/g)) assert.ok(/w3\.org|schemas\.githubusercontent|raw\.githubusercontent\.com\/stablyai/.test(u[0]), `${f} mentions ${u[0]}`)
  }
  // the worker may import only the bundled converter, by a relative path
  const w = readFileSync(join(editor, 'step-worker.js'), 'utf8')
  assert.deepEqual([...w.matchAll(/importScripts\(\s*'([^']+)'/g)].map((m) => m[1]), ['./vendor/occt/occt-import-js.js'])
})

test('camera presets, section plane through the file axes, measuring and filtering', () => {
  for (const p of PRESETS) assert.ok(Math.abs(Math.hypot(...presetDirection(p)) - 1) < 1e-9, p)
  assert.deepEqual(presetDirection('front'), [0, 0, 1])
  assert.deepEqual(clipPlane('y', 0.5, [0, 0, 0], [2, 4, 2], false), { normal: [0, 1, 0], constant: -2 })
  assert.equal(clipPlane('w', 0.5, [0, 0, 0], [1, 1, 1], false), null)
  assert.deepEqual(fileAxisToView('z', 'z'), { axis: 'y', sign: 1 }) // CAD: file z is up after the rotation
  assert.deepEqual(fileAxisToView('y', 'z'), { axis: 'z', sign: -1 })
  assert.deepEqual(fileAxisToView('y', 'y'), { axis: 'y', sign: 1 })
  assert.equal(measureInfo([0, 0, 0], [3, 4, 12]).distance, 13)
})

test('the manifest declares one text editor (STEP is a text format: Orca mounts text editors only for text files)', () => {
  const m = JSON.parse(readFileSync(join(root, 'orca-plugin.json'), 'utf8'))
  const eds = m.contributes.customEditors
  assert.equal(eds.length, 1)
  assert.equal(eds[0].contentKind, 'text')
  assert.deepEqual(eds[0].extensions, ['.step', '.stp', '.stepview']) // .stepview is the start file (drop page)
  assert.equal(eds[0].frame, 'isolated')
  assert.deepEqual(m.capabilities, [])
})

test('every keyboard shortcut a tooltip promises is handled, and typing in a text field never triggers one', () => {
  const js = readFileSync(join(editor, 'viewer.js'), 'utf8')
  const block = js.slice(js.indexOf('const KEY_ACTIONS = {'), js.indexOf('window.addEventListener(\'keydown\''))
  assert.ok(block.length > 200, 'KEY_ACTIONS found')
  for (const [k, v] of Object.entries(STRINGS.en)) {
    if (!k.startsWith('tip_')) continue
    for (const m of v.matchAll(/\(([A-Z])\)/g)) {
      const action = KEYMAP[m[1].toLowerCase()]
      assert.ok(action, `${k} promises key ${m[1]}, shared/keymap.js has no such key`)
      assert.ok(new RegExp(`\\b${action}:`).test(block), `${k} promises key ${m[1]} (${action}), viewer.js has no handler in KEY_ACTIONS`)
    }
  }
  assert.ok(/keys 1 to 8/.test(STRINGS.en.tip_preset), 'the preset tooltip names the keys')
  for (const n of VIEW_NAMES) assert.ok(new RegExp(`view_${n}:`).test(block), `no handler for the view ${n}`)
  assert.ok(/keyAction\(e\)/.test(js), 'the viewer takes its keys through keyAction (text fields, modifiers and repeats are handled there)')
})

test('toggle buttons: every aria-pressed button is kept in sync by the script, and the pressed style is theme-independent', () => {
  const html = readFileSync(join(editor, 'index.html'), 'utf8')
  const js = readFileSync(join(editor, 'viewer.js'), 'utf8')
  const css = readFileSync(join(editor, 'viewer.css'), 'utf8')
  const ids = [...html.matchAll(/<button id="([\w-]+)"[^>]*aria-pressed/g)].map((m) => m[1])
  assert.ok(ids.length >= 5, 'toggle buttons found')
  const shellJs = readFileSync(join(editor, 'shared', 'shell.js'), 'utf8')
  for (const id of ids) assert.ok(js.includes(`$('${id}').setAttribute('aria-pressed'`) || shellJs.includes(`$('${id}')`) && /toggleBtn\.setAttribute\('aria-pressed'/.test(shellJs), `${id} never gets aria-pressed updated`)
  // blue fill with white text in light and dark Orca themes: a pale fill in a dark theme reads as "off"
  const shellCss = readFileSync(join(editor, 'shared', 'shell.css'), 'utf8')
  assert.ok(/button\[aria-pressed="true"\]\s*\{[^}]*var\(--on\)/.test(shellCss) && /--on:\s*#[0-9a-f]{6}/i.test(shellCss))
  assert.ok(!/aria-pressed="true"\]\s*\{[^}]*var\(--primary\)/.test(shellCss), 'pressed must not use the theme primary color (pale in dark themes)')
})

test('start page: a panel and a "new file" entry open the viewer without a file, and their start file is recognised', () => {
  const m = JSON.parse(readFileSync(join(root, 'orca-plugin.json'), 'utf8'))
  assert.equal(m.contributes.panels.length, 1)
  assert.equal(m.contributes.panels[0].entry, 'editor/panel.html') // Orca builds the frame per entry file: a panel that shared the editor's entry would get an editor frame with a document API
  const nf = m.contributes.newFiles[0]
  assert.ok(m.contributes.customEditors[0].extensions.includes(nf.extension), 'the start file extension has an editor')
  assert.ok(isStartText(readFileSync(join(root, nf.template), 'utf8')), 'the template carries the start marker')
  assert.ok(!isStartText('ISO-10303-21;\nHEADER;'))
  assert.deepEqual(m.capabilities, [])
})

test('opening files: picking the first supported file, extensions, the size limit and the state line', () => {
  assert.equal(extOf('a/B.STEP'), 'step')
  assert.equal(extOf('noext'), '')
  assert.deepEqual(SUPPORTED_EXT, ['step', 'stp'])
  const r = pickFile([{ name: 'x.txt' }, { name: 'a.stp' }, { name: 'b.step' }], SUPPORTED_EXT)
  assert.equal(r.file.name, 'a.stp')
  assert.equal(r.ignored, 2)
  assert.deepEqual(r.unsupported, ['x.txt'])
  assert.equal(pickFile([], SUPPORTED_EXT).file, null)
  assert.ok(HARD_MAX_BYTES * 43 < 4.2e9, 'the hard limit keeps the converter under the 4 GB WebAssembly memory')
  assert.equal(stateLine('p', { a: 1 }), 'p-state {"a":1}')
})

test('the panel page is the editor page (same scripts), kept in step by this test', () => {
  const a = readFileSync(join(editor, 'index.html'), 'utf8')
  const b = readFileSync(join(editor, 'panel.html'), 'utf8')
  assert.equal(b, a, 'editor/panel.html must equal editor/index.html: copy it after changing the page')
})

test('the shared layout files are the canonical ones (checksum recorded by plugins/_shared/sync-shared.sh) and the page uses them', () => {
  const dir = join(editor, 'shared')
  const rec = Object.fromEntries(readFileSync(join(dir, 'SHARED.sha256'), 'utf8').trim().split('\n').map((l) => l.split(/\s+/).reverse()))
  const present = readdirSync(dir).filter((f) => f !== 'SHARED.sha256').sort()
  assert.deepEqual(present, Object.keys(rec).sort(), 'every file in editor/shared is recorded by sync-shared.sh')
  for (const f of present) assert.equal(createHash('sha256').update(readFileSync(join(dir, f))).digest('hex'), rec[f], `${f} was edited here: change plugins/_shared and run sync-shared.sh`)
  const html = readFileSync(join(editor, 'index.html'), 'utf8')
  assert.ok(html.includes('./shared/shell.css'))
  assert.equal(readFileSync(join(editor, 'panel.html'), 'utf8'), html)
})

test('layout: the side panel takes space next to the view (flow layout), scrolls vertically only, and sections collapse', () => {
  const css = readFileSync(join(editor, 'shared', 'shell.css'), 'utf8')
  const html = readFileSync(join(editor, 'index.html'), 'utf8')
  assert.ok(/#side\s*\{[^}]*overflow-x:\s*hidden[^}]*overflow-y:\s*auto/.test(css), 'no horizontal scrolling in the side panel')
  assert.ok(!/#side\s*\{[^}]*position:\s*(fixed|absolute)/.test(css), 'the panel must not float over the view')
  assert.ok(/#main\s*\{[^}]*display:\s*flex/.test(css) && /body\.narrow #main\s*\{[^}]*flex-direction:\s*column/.test(css))
  for (const id of ['bar', 'main', 'stage', 'resizer', 'side', 'side-close', 'b-panel', 'b-more', 'more-menu', 'more-wrap']) assert.ok(html.includes(`id="${id}"`), `index.html lacks #${id}`)
  assert.ok((html.match(/<details class="sec"/g) || []).length >= 5, 'each side section is a collapsible <details>')
  assert.ok(/role="separator"/.test(html) && /tabindex="0"/.test(html), 'the panel handle is keyboard operable')
  // every toolbar control has a priority for the More menu
  const bar = html.slice(html.indexOf('<header id="bar"'), html.indexOf('</header>'))
  for (const m of bar.matchAll(/<(button|select) id="(b-[\w-]+|preset)"([^>]*)>/g)) if (!['b-more', 'b-panel', 'side-close', 'b-pick', 'b-gate-go', 'b-gate-cancel', 'b-cancel', 'b-go', 'b-play', 'l-all', 'l-none', 'l-inv', 'l-color', 'b-resetprefs'].includes(m[2])) assert.ok(/data-prio=/.test(m[3]), `${m[2]} has no data-prio`)
})

test('the memory gate cannot hide: its section and the panel are opened when it shows', () => {
  const js = readFileSync(join(editor, 'viewer.js'), 'utf8')
  const html = readFileSync(join(editor, 'index.html'), 'utf8')
  assert.ok(html.includes('id="quality-sec"') && /quality-sec[^>]*data-always/.test(html), 'the quality section holds the gate and is visible without a model')
  assert.ok((js.match(/openSection\('quality-sec'\)/g) || []).length >= 2, 'both places that show the gate open its section')
  assert.ok((js.match(/shell\.setPanelOpen\(true, false\)/g) || []).length >= 2)
})

test('the shared files are the same as plugins/_shared, the source (sync-shared.sh --check compares both plugins, work copies and live folders; this runs it for this folder)', () => {
  const script = [join(here, '..', '..', '_shared', 'sync-shared.sh'), join(here, '..', '..', '..', '_shared', 'sync-shared.sh')].find((p) => existsSync(p))
  if (!script) return // a copy of the plugin without its _shared folder: nothing to compare with
  const r = spawnSync('sh', [script, '--check-dir', join(here, '..')], { encoding: 'utf8' }) // this plugin folder only (the work copy and the live folder each run it)
  assert.equal(r.status, 0, r.stdout + r.stderr)
})

test('the x-ray material keeps its back faces whatever the "Back faces" switch says (viewer honours keepSide)', () => {
  assert.match(readFileSync(join(editor, 'shared/shading.js'), 'utf8'), /xray\.userData\.keepSide = true/)
  assert.match(readFileSync(join(editor, 'viewer.js'), 'utf8'), /m\.userData\.keepSide \? m\.side : state\.back/)
})

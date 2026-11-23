import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SRC, srcKind, validateRows, kvList, bigNumber, estimateBlock, card, helpButton, dimsRow } from '../editor/shared/cards.js'

test('the six origins are the ones the honesty check knows', () => {
  assert.deepEqual(SRC, ['file', 'derived', 'estimate', 'assumed', 'ui', 'manifest'])
  for (const k of SRC) assert.equal(srcKind(k), k)
})

test('a number without a known origin cannot be built', () => {
  for (const bad of [undefined, null, '', 'guess', 'File', 'estimated']) assert.throws(() => srcKind(bad), /data-src/)
})

test('a row needs a label, a value and an origin', () => {
  const ok = { label: 'Triangles', value: '488', src: 'derived' }
  assert.deepEqual(validateRows([ok]), [ok])
  assert.throws(() => validateRows([{ label: 'Triangles', value: '488' }]), /data-src/)
  assert.throws(() => validateRows([{ label: 'Triangles', value: '488', src: 'made-up' }]), /data-src/)
  assert.throws(() => validateRows([{ label: '', value: '488', src: 'derived' }]), /label/)
  assert.throws(() => validateRows([{ label: 'Triangles', src: 'derived' }]), /no value/)
  assert.throws(() => validateRows([{ label: 'Triangles', value: null, src: 'derived' }]), /no value/)
  assert.throws(() => validateRows([{ label: 'Triangles', value: '', src: 'derived' }]), /no value/)
  assert.throws(() => validateRows([{ label: 'Triangles', value: false, src: 'derived' }]), /no value/)
  assert.doesNotThrow(() => validateRows([{ label: 'Open', value: '–', src: 'derived' }, { label: 'Zero', value: 0, src: 'file' }]))
})

test('only the STEP viewer hands the part card a weight (the 3D Model Viewer has no unit from the file, so no weight card)', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const id = JSON.parse(readFileSync(join(root, 'orca-plugin.json'), 'utf8')).id
  const viewer = readFileSync(join(root, 'editor', 'viewer.js'), 'utf8')
  const call = viewer.slice(viewer.indexOf('initPartCard({'))
  const given = /\n\s+weight:\s*\{/.test(call.slice(0, 4000))
  assert.equal(given, id === 'step-viewer-3d', `${id}: weight passed to the part card = ${given}`)
})

// ----- the builders, with a pretend document -----
const fakeEl = (tag) => {
  const e = { tag, children: [], dataset: {}, attrs: {}, className: '', textContent: '', id: '', title: '' }
  e.append = (...k) => e.children.push(...k)
  e.setAttribute = (k, v) => (e.attrs[k] = v)
  return e
}
const walk = (e, f) => { f(e); for (const c of e.children || []) if (c && typeof c === 'object') walk(c, f) }
test('the builders: a value cell carries its origin, a big number too, an estimate only comes with its mark and the approximately sign, a card is labelled by its heading', () => {
  globalThis.document = { createElement: fakeEl }
  const dl = kvList([{ label: 'X', value: '80 mm', src: 'derived' }, { label: 'Name', value: 'Teil 1', src: 'ui', tip: 'tip' }])
  const dds = dl.children.filter((c) => c.tag === 'dd')
  assert.deepEqual(dds.map((d) => d.dataset.src), ['derived', 'ui'])
  assert.equal(dds[1].title, 'tip')
  assert.throws(() => kvList([{ label: 'X', value: '80 mm' }]), /data-src/)
  assert.equal(bigNumber('12 mm³', 'derived').dataset.src, 'derived')
  assert.throws(() => bigNumber('12', undefined), /data-src/)
  assert.throws(() => estimateBlock({ value: '47 g', markText: '' }), /mark/)
  assert.throws(() => estimateBlock({ value: '', markText: 'Estimate' }), /mark/)
  const est = estimateBlock({ value: '47 g', markText: 'Estimate' })
  const kinds = []
  const texts = []
  walk(est, (n) => { if (n.dataset && n.dataset.src) kinds.push(n.dataset.src); if (typeof n === 'string') texts.push(n) })
  assert.deepEqual(kinds, ['estimate'])
  assert.ok(est.children.some((c) => /\btag\b/.test(c.className) && /\best\b/.test(c.className) && c.textContent === 'Estimate'), 'the mark')
  const big = est.children.find((c) => /\bbig\b/.test(c.className))
  assert.equal(big.children[0], '≈ ', 'the approximately sign comes first')
  const c = card({ id: 'x', title: 'T', body: [] })
  assert.equal(c.attrs['aria-labelledby'], 'x-t')
  assert.equal(c.dataset.honest, '1')
  assert.throws(() => card({ id: '', title: 'T' }), /id and a title/)
  delete globalThis.document
})

test('the "?" of a card keeps its explanation hidden until it is pressed, and says so (aria-expanded, aria-controls)', () => {
  globalThis.document = { createElement: fakeEl }
  const note = fakeEl('p')
  const b = helpButton({ id: 'h1', label: 'Help', tip: 'Explain this card', targets: [note] })
  assert.equal(note.hidden, true, 'hidden to begin with')
  assert.equal(b.attrs['aria-expanded'], 'false')
  assert.equal(b.attrs['aria-controls'], note.id)
  assert.equal(b.attrs['aria-label'], 'Help')
  b.onclick()
  assert.equal(note.hidden, false)
  assert.equal(b.attrs['aria-expanded'], 'true')
  b.onclick()
  assert.equal(note.hidden, true)
  assert.throws(() => helpButton({ id: 'h2', label: 'Help', targets: [] }), /help button/)
  assert.throws(() => helpButton({ id: 'h3', label: '', targets: [note] }), /help button/)
  delete globalThis.document
})
test('the row of the three sizes: each number carries its origin and sits above its axis in the markup order dt, dd; no origin, no row', () => {
  globalThis.document = { createElement: fakeEl }
  const rows = [{ label: 'X', value: '80', unit: 'mm', src: 'derived' }, { label: 'Y', value: '50', unit: 'mm', src: 'derived' }, { label: 'Z (up)', value: '6', unit: 'mm', src: 'derived' }]
  const dl = dimsRow(rows, { id: 'pc-dims-kv' })
  assert.equal(dl.id, 'pc-dims-kv')
  const groups = dl.children
  assert.equal(groups.length, 3)
  const numbers = []
  walk(dl, (n) => { if (n.dataset && n.dataset.src && /\bdim-n\b/.test(n.className)) numbers.push(n) })
  assert.deepEqual(numbers.map((n) => n.textContent), ['80', '50', '6'])
  assert.ok(numbers.every((n) => n.dataset.src === 'derived'))
  assert.deepEqual(groups[0].children.map((c) => c.tag), ['dt', 'dd'])
  assert.throws(() => dimsRow([{ label: 'X', value: '80', unit: 'mm' }]), /data-src/)
  assert.throws(() => dimsRow([{ label: 'X', value: '', unit: 'mm', src: 'derived' }]), /no value/)
  delete globalThis.document
})

test('a "?" that was open stays open when its card is built again (the part cards are rebuilt for every selection)', () => {
  globalThis.document = { createElement: fakeEl }
  const first = fakeEl('p')
  const b1 = helpButton({ id: 'keep-1', label: 'Help: Volume', targets: [first] })
  b1.onclick()
  const second = fakeEl('p') // the card is built again: new elements, the same id
  const b2 = helpButton({ id: 'keep-1', label: 'Help: Volume', targets: [second] })
  assert.equal(second.hidden, false)
  assert.equal(b2.attrs['aria-expanded'], 'true')
  b2.onclick()
  const third = fakeEl('p')
  helpButton({ id: 'keep-1', label: 'Help: Volume', targets: [third] })
  assert.equal(third.hidden, true, 'closed again: stays closed')
  delete globalThis.document
})
test('long numbers: the three sizes stand one under the other (data-layout=stack), short ones side by side', () => {
  globalThis.document = { createElement: fakeEl }
  const mk = (v) => dimsRow([{ label: 'X', value: v, unit: 'mm', src: 'derived' }, { label: 'Y', value: '5', unit: 'mm', src: 'derived' }])
  assert.equal(mk('80').dataset.layout, undefined)
  assert.equal(mk('12,5').dataset.layout, undefined)
  assert.equal(mk('1.234').dataset.layout, 'stack')
  const withUnit = (v, u) => dimsRow([{ label: 'X', value: v, unit: u, src: 'derived' }])
  assert.equal(withUnit('12,3', 'mm').dataset.layout, undefined)
  assert.equal(withUnit('4,56', 'units').dataset.layout, 'stack', 'STL has no unit: "units" is long')
  assert.equal(withUnit('123', 'Einh.').dataset.layout, 'stack')
  assert.equal(mk('1.234.567,8').dataset.layout, 'stack')
  delete globalThis.document
})
test('a card is named by its title alone (the "?" and the buttons in the head do not become part of its name)', () => {
  globalThis.document = { createElement: fakeEl }
  const c = card({ id: 'pc-dims', title: 'Maße', body: [] })
  assert.equal(c.attrs['aria-labelledby'], 'pc-dims-t')
  const title = c.children[0].children.find((k) => k.className === 'card-t')
  assert.equal(title.id, 'pc-dims-t')
  delete globalThis.document
})

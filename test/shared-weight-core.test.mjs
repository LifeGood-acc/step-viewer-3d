import test from 'node:test'
import assert from 'node:assert/strict'
import { DENSITIES, CM_PER_UNIT, volumeCm3, weightGrams, whyNoEstimate, scaleWeight, unitFromFile, densityOf } from '../editor/shared/weight-core.js'

const near = (a, b, tol = 1e-6, what = '') => assert.ok(Math.abs(a - b) <= tol, `${what} ${a} is not ${b}`)

test('the list of guide values is the one the plan names', () => {
  assert.deepEqual(DENSITIES.map((d) => [d.k, d.v]), [['steel', 7.85], ['stainless', 7.9], ['aluminium', 2.7], ['brass', 8.5], ['copper', 8.96], ['pla', 1.24], ['abs', 1.04]])
})

test('part 2 of the sample assembly (mesh volume 6004.41 mm³) in steel weighs about 47.13 g', () => {
  near(weightGrams({ volume: 6004.41, unit: 'mm', mode: 'file', density: 'steel' }), 47.134, 0.001)
})

test('every unit of length is converted: mm, cm, m, inch and foot give the same body the same weight', () => {
  const cm3 = 10 // a body of 10 cm³
  const inUnit = { mm: cm3 * 1000, cm: cm3, m: cm3 / 1e6, in: cm3 / 2.54 ** 3, ft: cm3 / 30.48 ** 3, 'µm': cm3 * 1e12 }
  for (const [u, v] of Object.entries(inUnit)) near(weightGrams({ volume: v, unit: u, mode: 'file', density: 'aluminium' }), 27, 1e-6 * 27 + 1e-9)
  assert.deepEqual(Object.keys(CM_PER_UNIT).sort(), ['cm', 'ft', 'in', 'm', 'mm', 'µm'])
})

test('no estimate without a basis: open mesh, unit not from the file, unknown unit, no density', () => {
  assert.equal(weightGrams({ volume: null, unit: 'mm', mode: 'file', density: 'steel' }), null, 'open mesh (no volume)')
  assert.equal(weightGrams({ volume: NaN, unit: 'mm', mode: 'file', density: 'steel' }), null)
  assert.equal(weightGrams({ volume: -3, unit: 'mm', mode: 'file', density: 'steel' }), null)
  assert.equal(weightGrams({ volume: 100, unit: 'mm', mode: 'default', density: 'steel' }), null, 'the unit was not found in the file')
  assert.equal(weightGrams({ volume: 100, unit: 'mm', mode: 'tool', density: 'steel' }), null, 'the person set the unit: not from the file')
  assert.equal(weightGrams({ volume: 100, unit: 'yd', mode: 'file', density: 'steel' }), null, 'a unit this does not know')
  assert.equal(weightGrams({ volume: 100, unit: 'mm', mode: 'file', density: '' }), null, 'default: no assumption')
  assert.equal(weightGrams({ volume: 100, unit: 'mm', mode: 'file', density: 'gold' }), null, 'a density that is not in the list')
  assert.ok(weightGrams({ volume: 100, unit: 'mm', mode: 'converted', density: 'steel' }) > 0, 'found in the file and converted by the converter: still the file\'s unit')
})

test('the reason for no estimate is named', () => {
  assert.equal(whyNoEstimate({ volume: 5, mode: 'default' }), 'unit')
  assert.equal(whyNoEstimate({ volume: null, mode: 'file' }), 'volume')
  assert.equal(whyNoEstimate({ volume: 5, mode: 'file' }), null)
  assert.ok(unitFromFile('file') && unitFromFile('converted') && !unitFromFile('default') && !unitFromFile('tool') && !unitFromFile(undefined))
})

test('volumeCm3 and densityOf', () => {
  near(volumeCm3(1000, 'mm'), 1)
  near(volumeCm3(1, 'm'), 1e6)
  assert.equal(volumeCm3(1, 'x'), null)
  assert.equal(densityOf('steel').v, 7.85)
  assert.equal(densityOf('nope'), null)
})

test('the weight is shown in grams or kilograms with sensible decimals', () => {
  assert.deepEqual(scaleWeight(47.13), { value: 47.13, unit: 'g', digits: 0 })
  assert.deepEqual(scaleWeight(2.5), { value: 2.5, unit: 'g', digits: 2 })
  assert.deepEqual(scaleWeight(12500), { value: 12.5, unit: 'kg', digits: 2 })
  assert.deepEqual(scaleWeight(1000), { value: 1, unit: 'kg', digits: 2 })
  // the limit is decided on the rounded value: no "1000 g", no "10.00 g"
  assert.equal(scaleWeight(999.6).unit, 'kg')
  assert.equal(scaleWeight(999.4).unit, 'g')
  assert.equal(scaleWeight(999.4).digits, 0)
  assert.equal(scaleWeight(9.996).digits, 0)
  assert.equal(scaleWeight(9.994).digits, 2)
})

test('the table of centimetres per unit agrees with the unit table of the tools (a typo in a factor would show as a wrong weight)', async () => {
  // read from the source: tools-scene.js imports three, which `orca plugin test` cannot load
  const { readFileSync } = await import('node:fs')
  const { join, dirname } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'editor', 'shared', 'tools-scene.js'), 'utf8')
  const body = /export const UNIT_METERS = \{([^}]*)\}/.exec(src)[1]
  const table = Object.fromEntries([...body.matchAll(/(?:'?([^\s:',]+)'?)\s*:\s*([0-9.e-]+)/g)].map((m) => [m[1], Number(m[2])]))
  assert.deepEqual(Object.keys(table).sort(), Object.keys(CM_PER_UNIT).sort())
  for (const [u, m] of Object.entries(table)) near(CM_PER_UNIT[u], m * 100, 1e-9 * CM_PER_UNIT[u], u)
})

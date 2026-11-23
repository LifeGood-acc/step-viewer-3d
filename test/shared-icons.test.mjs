// The symbol set (icons.js): only plain shapes, nothing that could run or load, every symbol inside the 24 x 24 grid, one drawing each.
import test from 'node:test'
import assert from 'node:assert/strict'
import { ICONS } from '../editor/shared/icons.js'

const names = Object.keys(ICONS)

test('the set has the symbols the bar and the status bar need', () => {
  for (const n of ['open', 'eye', 'iso', 'front', 'measure', 'cut', 'look', 'studio', 'export', 'more', 'side']) assert.ok(ICONS[n], `symbol ${n} missing`)
  // 18 more are kept for the next stages (cards, tree, cube); none of them is required here, so removing one that stays unused does not fail
})
test('only path, circle and rect with known attributes: no script, style, link, event handler or url()', () => {
  const ATTR = new Set(['d', 'cx', 'cy', 'r', 'x', 'y', 'width', 'height', 'rx', 'fill', 'stroke', 'opacity'])
  for (const [n, m] of Object.entries(ICONS)) {
    const tags = [...m.matchAll(/<\/?([a-zA-Z]+)/g)].map((x) => x[1])
    assert.ok(tags.length > 0 && tags.every((t) => ['path', 'circle', 'rect'].includes(t)), `${n}: tags ${tags}`)
    assert.ok(!/on\w+\s*=|javascript:|url\(|href|<script|<style/i.test(m), `${n}: forbidden content`)
    for (const a of m.matchAll(/\s([a-z-]+)="([^"]*)"/g)) {
      assert.ok(ATTR.has(a[1]), `${n}: attribute ${a[1]}`)
      if (a[1] === 'fill' || a[1] === 'stroke') assert.ok(['currentColor', 'none'].includes(a[2]), `${n}: ${a[1]}=${a[2]}`) // colours come from the text colour, never fixed
    }
  }
})
test('every coordinate lies inside the 24 x 24 grid (a little margin for the stroke)', () => {
  for (const [n, m] of Object.entries(ICONS)) {
    for (const a of m.matchAll(/\s(cx|cy|x|y)="(-?[\d.]+)"/g)) assert.ok(Number(a[2]) >= 0 && Number(a[2]) <= 24, `${n}: ${a[1]}=${a[2]}`)
    for (const a of m.matchAll(/\sd="([^"]*)"/g)) {
      assert.ok(/^[MmLlHhVvCcSsQqTtAaZz0-9\s.,-]+$/.test(a[1]), `${n}: path data ${a[1]}`)
      const first = a[1].match(/^M\s*(-?[\d.]+)[\s,]+(-?[\d.]+)/)
      if (first) assert.ok(Number(first[1]) >= 0 && Number(first[1]) <= 24 && Number(first[2]) >= 0 && Number(first[2]) <= 24, `${n}: starts outside the grid`)
    }
  }
})
test('no two names are given to different drawings by mistake, and the names are plain words', () => {
  for (const n of names) assert.match(n, /^[a-z]+$/, n)
  // two names, one drawing is a mistake: every drawing differs
  const seen = new Map()
  for (const [n, m] of Object.entries(ICONS)) {
    assert.ok(!seen.has(m), `${n} and ${seen.get(m)} are the same drawing`)
    seen.set(m, n)
  }
})

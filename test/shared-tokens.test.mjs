// The colour tokens of shell.css (UX v3): the accent keeps Orca's blue; two pairs are checked: white on the accent fill and the accent as text colour on the surfaces (4.5:1, WCAG AA),
// and the accent fill against the surfaces (3:1, non-text contrast). NOT checked: --muted on the card, text on --on-soft, the greys of disabled buttons.
// Checked against the CSS fallbacks of the light surfaces and against representative dark surfaces. NOT checked: Orca's own surface colours (they come from the
// app at run time and are not known here), so this is a floor for the pairs we pick, not a measurement inside Orca.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'editor', 'shared', 'shell.css'), 'utf8')
const lum = (hex) => {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}
/** the value of a token in the :root block (light) or the :root.dark block; a token that points at another one ("var(--on-text-dark)") is followed to its colour */
const token = (name, dark = false) => {
  const root = css.match(/:root\s*\{([^}]*)\}/)[1]
  const darkBlock = css.match(/:root\.dark\s*\{([^}]*)\}/)[1]
  const read = (block, n) => {
    const m = block.match(new RegExp(`--${n}:\\s*([^;]+);`))
    return m ? m[1].trim() : null
  }
  let value = (dark && read(darkBlock, name)) || read(root, name)
  for (let i = 0; i < 6 && value && value.startsWith('var('); i++) {
    const m = value.match(/^var\(--([a-z-]+)\s*(?:,\s*(.*))?\)$/) // var(--name) or var(--name, fallback): Orca's own variables are not in this file, so their fallback counts
    value = read(root, m[1]) || (m[2] ? m[2].trim() : null)
  }
  return value && /^#[0-9a-fA-F]{3,6}$/.test(value) ? value : null
}
const LIGHT_SURFACES = ['#ffffff', '#f6f6f6'] // the fallbacks of --bg and --card
const DARK_SURFACES = ['#14161a', '#212429'] // representative dark surfaces (assumption, see above)

test('the accent is Orca\'s blue #2563eb with white text, not a new colour', () => {
  assert.equal(token('on').toLowerCase(), '#2563eb')
  assert.equal(token('on-fg').toLowerCase(), '#fff')
  assert.ok(ratio(token('on'), token('on-fg')) >= 4.5, `white on the accent: ${ratio(token('on'), token('on-fg')).toFixed(2)}`)
})
test('the accent as a text colour reaches 4.5:1 on light and on dark surfaces', () => {
  for (const s of LIGHT_SURFACES) assert.ok(ratio(token('on-text'), s) >= 4.5, `light: --on-text on ${s}: ${ratio(token('on-text'), s).toFixed(2)}`)
  for (const s of DARK_SURFACES) assert.ok(ratio(token('on-text', true), s) >= 4.5, `dark: --on-text on ${s}: ${ratio(token('on-text', true), s).toFixed(2)}`)
})
test('the accent fill stands out from the surfaces (3:1) in both themes', () => {
  for (const s of [...LIGHT_SURFACES, ...DARK_SURFACES]) assert.ok(ratio(token('on'), s) >= 3, `--on against ${s}: ${ratio(token('on'), s).toFixed(2)}`)
})
test('the type and spacing scale is there: base 13 px, small print 12 and 11, controls and icons', () => {
  assert.match(css, /--fs:\s*13px/)
  assert.match(css, /--fs-s:\s*12px/)
  assert.match(css, /--fs-xs:\s*11px/)
  assert.match(css, /font-size:\s*var\(--fs\)/)
  for (const n of ['gap-1', 'gap-2', 'gap-3', 'gap-4', 'gap-5', 'bar-btn-h', 'icon']) assert.match(css, new RegExp(`--${n}:\\s*\\d+px`), n)
})
test('no accent text colour is written as the bare fill colour (var(--on) as a "color:" would miss the contrast above)', () => {
  assert.ok(!/[^-]color:\s*var\(--on\)/.test(css), 'use var(--on-text) for text')
})

test('every colour value of the shell stands in the :root block: nothing else writes a hex or rgba() value (Hallmark floor 1)', () => {
  const rest = css.replace(/:root\s*\{[^}]*\}/, '').replace(/\/\*[\s\S]*?\*\//g, '')
  const found = [...rest.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g)].map((m) => m[0])
  assert.deepEqual(found, [], 'move these colour values into tokens in :root')
})
test('the dark theme only swaps tokens: the :root.dark block holds no colour value of its own', () => {
  const dark = css.match(/:root\.dark\s*\{([^}]*)\}/)[1]
  assert.ok(!/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(dark), ':root.dark must point at the tokens of :root')
})
test('the warning colour reaches 4.5:1 as text on light and on dark surfaces (the fallbacks; Orca\'s own colour is not known here)', () => {
  for (const s of LIGHT_SURFACES) assert.ok(ratio(token('warn'), s) >= 4.5, `light: --warn on ${s}: ${ratio(token('warn'), s).toFixed(2)}`)
  for (const s of DARK_SURFACES) assert.ok(ratio(token('warn', true), s) >= 4.5, `dark: --warn on ${s}: ${ratio(token('warn', true), s).toFixed(2)}`)
})
test('"reduce motion": every moving thing of the shell and of the viewer has its off switch, and a bar moves by transform, never by left', () => {
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)\s*\{\s*details\.sec > summary::before \{ transition: none; \}/)
  const viewer = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'editor', 'viewer.css'), 'utf8')
  const frames = [...viewer.matchAll(/@keyframes\s+([\w-]+)\s*\{((?:[^{}]|\{[^{}]*\})*)\}/g)] // the 3D Model Viewer has no loading bar, the STEP viewer has one
  for (const [, name, body] of frames) {
    assert.ok(!/\b(left|right|top|bottom|width|height)\s*:/.test(body), `@keyframes ${name} animates a layout property: use transform or opacity`)
    assert.match(viewer, new RegExp(`prefers-reduced-motion: reduce\\)[^@]*animation: none`), `${name}: no "reduce motion" rule`)
  }
  if (/animation:/.test(viewer)) assert.ok(frames.length > 0)
})
test('labels are written as words, not in capitals with spacing (Hallmark floor 9): no uppercase, no small caps, no letter spacing above a hair', () => {
  assert.ok(!/text-transform:\s*(uppercase|capitalize)/.test(css), 'no uppercase labels')
  assert.ok(!/font-variant(-caps)?:\s*(all-)?small-caps/.test(css), 'no small caps')
  const wide = [...css.matchAll(/letter-spacing:\s*(-?[\d.]+)(em|px)/g)].filter((m) => Math.abs(Number(m[1])) > (m[2] === 'em' ? 0.02 : 0.3)).map((m) => m[0])
  assert.deepEqual(wide, [], 'letter spacing is for display type; labels get none')
})
test('the colour rule holds for the plugin\'s own viewer.css too (its :root block is the only place for a colour value)', () => {
  const viewer = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'editor', 'viewer.css'), 'utf8')
  const rest = viewer.replace(/:root\s*\{[^}]*\}/, '').replace(/\/\*[\s\S]*?\*\//g, '')
  assert.deepEqual([...rest.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|oklch\(/g)].map((m) => m[0]), [])
})
test('the plugin colour is for the mark in the empty view only: --plugin is read by .brand-mark rules alone, and the mark stands in the drop card (never in a card, never on a button)', () => {
  const uses = [...css.matchAll(/([^{}]*)\{[^{}]*var\(--plugin\)[^{}]*\}/g)].map((m) => m[1].trim()).filter((sel) => !sel.startsWith('/*'))
  const bad = uses.flatMap((sel) => sel.split(',').map((x) => x.trim())).filter((sel) => !/^\.brand-mark /.test(sel) && !/^:root$/.test(sel))
  assert.deepEqual(bad, [], '--plugin used outside .brand-mark')
  const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'editor', 'index.html'), 'utf8')
  const marks = [...html.matchAll(/<svg class="brand-mark"/g)].length
  assert.equal(marks, 1, 'one mark')
  const before = html.slice(0, html.indexOf('<svg class="brand-mark"'))
  assert.ok(before.lastIndexOf('class="drop-card"') > before.lastIndexOf('</div>\n</div>') || /class="drop-card">\s*$/.test(before), 'the mark is the first thing in the drop card')
  assert.ok(!/<svg class="brand-mark"[\s\S]*?<\/svg>/.exec(html)[0].match(/#[0-9a-fA-F]{3,6}|fill="[^"]*"|stroke="[^"]*"|style=|<script|href=/), 'the mark takes its colours from the CSS tokens: no literal, no script, no link')
})
test('the chosen row: the accent as text on the soft accent wash over the card reaches 4.5:1 in both themes', () => {
  const rgba = (v) => v.match(/rgba?\(\s*(\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/).slice(1).map(Number)
  const hex2 = (n) => n.toString(16).padStart(2, '0')
  for (const [dark, surfaces] of [[false, LIGHT_SURFACES], [true, DARK_SURFACES]]) {
    const [r, g, b, a] = rgba(token(dark ? 'on-soft-dark' : 'on-soft-light', false) || css.match(new RegExp(`--on-soft-${dark ? 'dark' : 'light'}:\\s*([^;]+);`))[1])
    for (const s of surfaces) {
      const [sr, sg, sb] = [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16))
      const mix = '#' + [[r, sr], [g, sg], [b, sb]].map(([c, bg]) => hex2(Math.round(c * a + bg * (1 - a)))).join('')
      assert.ok(ratio(token('on-text', dark), mix) >= 4.5, `${dark ? 'dark' : 'light'}: --on-text on the wash over ${s}: ${ratio(token('on-text', dark), mix).toFixed(2)}`)
    }
  }
})
test('a disabled main button is grey like every disabled button (not a dimmed blue)', () => {
  assert.match(css, /button\.primary:disabled\s*\{[^}]*background:\s*var\(--card\)/)
})
test('round 5: the view is a card (body.stage-card, set from the width of the area): border, card rounding, gap token; nothing else gives the view a margin; no colour literal; the focus ring goes round the card', () => {
  const rule = css.match(/body\.stage-card #stage \{([^}]*)\}/)
  assert.ok(rule, 'the view card rule hangs on body.stage-card (not on a media query of the window: the layout is measured on the area)')
  assert.match(rule[1], /margin:\s*var\(--stage-gap\)/)
  assert.match(rule[1], /border:\s*1px solid var\(--border\)/)
  assert.match(rule[1], /border-radius:\s*calc\(var\(--radius\) \* 2\)/)
  assert.ok(!/#[0-9a-fA-F]{3,6}\b|rgba?\(/.test(rule[1]), 'no colour literal')
  assert.match(css, /--stage-gap:\s*8px/)
  assert.ok(!/@media[^{]*min-width:\s*700px/.test(css), 'no second source of the 700 px: the class is the only one')
  const others = css.replace(/body\.stage-card #stage \{[^}]*\}/, '')
  assert.ok(!/#stage\s*\{[^}]*margin/.test(others), 'without the class the view has no margin (under 700 px it runs to the edge)')
  assert.match(css, /body\.stage-card #stage:has\(#gl:focus-visible\) \{[^}]*outline:\s*2px solid/, 'the focus ring of the canvas goes round the card (a square ring would be cut by the rounding)')
  assert.match(css, /body\.stage-card #gl:focus-visible \{ outline: none/)
  assert.match(css, /body\.stage-card #resizer:focus-visible::after/, 'the resizer line shows with the focus')
})

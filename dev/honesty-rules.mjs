// The rules of the honesty check (one source for e2e-honesty.mjs): every number the cards show has a declared origin (data-src, see cards.js), an estimate
// carries its mark, nothing is shown that the file or the mesh cannot give. Taken from the design study (_ux-v3/werkzeuge/ehrlichkeit-regeln.mjs, written for the
// mock-up) and rewritten for the real page: the root is the set of visible cards marked data-honest, the texts are checked in German and English.
//  R1  Every digit in the text and in attributes (title, aria-label, placeholder, alt, value; a tooltip may repeat the value of its own element) needs an origin (data-src) on the element itself or on a
//      surrounding span/b/select, never on a container only. Exceptions: key hints "(F)" in attributes, words with a digit (3D, 3MF). The origin "ui" may carry
//      one digit without a word or unit at most.
//      The value read-out of a slider (an <output> in the label of an <input type=range>) is the person's own setting and is left out; any other <output> is checked.
//  R2  Every estimate (data-src=estimate, except the choice list data-pick) stands in a block with the mark "Estimate"/"Schätzung" (.tag.est); a weight starts with "≈".
//  R3  Without a chosen density there is no estimate on the page.
//  R4  Forbidden contents (the invented ones of the example picture): a material number, "material suggestion", layers/plies in a card other than Section/Layers,
//      "mass" as a name for dimensions, "polygon"; material words (steel, aluminium …) only in the card "Estimate the weight" and in what the file itself says (data-src=file).
//  R6  Tooltips (title) are 60 characters at most.
//  R8  An assumption (data-src=assumed) names itself ("assumption", "assumed", "Annahme", "angenommen", "Norm") in the same block.
//  R9  With no model no card is on screen and so no number of the file (the runner checks that; with a card on screen it would find the numbers).
export const PAGE_CHECK = `(() => {
  const bad = []
  const clip = (t) => t.trim().replace(/\\s+/g, ' ').slice(0, 60)
  const SRC_OK = ['file', 'derived', 'estimate', 'assumed', 'ui', 'manifest']
  const INLINE = new Set(['SPAN', 'B', 'SELECT'])
  const KEY = /\\(\\s*[A-Z0-9]\\s*\\)/g
  const WORD = /\\b(3D|3MF)\\b/g
  const shown = (e) => !e.closest('[hidden]') && e.getClientRects().length > 0
  const roots = [...document.querySelectorAll('[data-honest]')].filter(shown)
  const hasModel = document.body.classList.contains('has-model')
  for (const root of roots) {
    const rid = root.id || root.dataset.card
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    let n
    while ((n = walker.nextNode())) {
      const t = n.textContent
      const el = n.parentElement
      if (!/\\d/.test(t.replace(WORD, '')) || el.closest('script,style')) continue
      const out = el.closest('output')
      if (out && out.closest('label') && out.closest('label').querySelector('input[type=range]')) continue // the read-out of a slider the person moves is their own setting, no claim about the file
      const holder = el.closest('[data-src]')
      if (!holder || !(holder === el || INLINE.has(holder.tagName))) { bad.push('R1 digit without origin on the element [' + rid + ']: "' + clip(t) + '"'); continue }
      const s = holder.dataset.src
      if (!SRC_OK.includes(s)) bad.push('R1 unknown origin "' + s + '" [' + rid + ']: ' + clip(t))
      else if (s === 'ui' && (/\\d.*\\d/.test(t) || /\\d\\s*[A-Za-zΔ%°³²×]/.test(t))) bad.push('R1 ui with a quantity [' + rid + ']: "' + clip(t) + '"')
    }
    for (const e of root.querySelectorAll('[title],[aria-label],[placeholder],[alt],input')) {
      for (const a of ['title', 'aria-label', 'placeholder', 'alt', 'value']) {
        if (a === 'value' && (e.tagName !== 'INPUT' || !['text', 'search', 'number', 'email', 'url', ''].includes(e.type))) continue
        const v = a === 'value' ? e.value : e.getAttribute(a)
        if (v && /\\d/.test(v.replace(KEY, '').replace(WORD, ''))) {
          const holder = e.closest('[data-src]')
          if (!holder || !(holder === e || INLINE.has(holder.tagName))) bad.push('R1 digit in attribute ' + a + ' without origin [' + rid + ']: "' + clip(v) + '"')
          else if (!SRC_OK.includes(holder.dataset.src)) bad.push('R1 unknown origin "' + holder.dataset.src + '" for attribute ' + a + ' [' + rid + ']')
          else if (holder.dataset.src === 'ui' && (/\\d.*\\d/.test(v) || /\\d\\s*[A-Za-zΔ%°³²×]/.test(v))) bad.push('R1 ui with a quantity in attribute ' + a + ' [' + rid + ']: "' + clip(v) + '"')
        }
      }
      if (e.title && e.title.length > 60) bad.push('R6 tooltip over 60 characters (' + e.title.length + ') [' + rid + ']: ' + e.title)
    }
    if (!hasModel) for (const e of root.querySelectorAll('[data-src=file],[data-src=derived],[data-src=assumed],[data-src=estimate]')) bad.push('R9 a number of the file with no model [' + rid + ']: "' + clip(e.textContent) + '"')
  }
  const all = roots.flatMap((r) => [...r.querySelectorAll('[data-src]')])
  const sel = document.getElementById('pc-dens')
  const est = all.filter((e) => e.dataset.src === 'estimate' && !e.dataset.pick)
  if (!(sel && sel.value) && est.length) bad.push('R3 an estimate without a chosen density: ' + est.length)
  for (const e of est) {
    const big0 = e.closest('.big')
    const block = big0 ? big0.parentElement : e.closest('div')
    if (!block || ![...block.querySelectorAll('.tag.est')].some((t) => /^(Estimate|Schätzung)$/.test(t.textContent.trim()))) bad.push('R2 an estimate without the mark "Estimate/Schätzung" in the same block')
    if (big0 && !/^\\s*≈/.test(big0.textContent)) bad.push('R2 a weight without "≈" in front: "' + clip(big0.textContent) + '"')
  }
  for (const e of all.filter((x) => x.dataset.src === 'assumed')) {
    const blk = e.closest('p, div, section') || e.parentElement
    if (!/Norm|Annahme|angenommen|assum/i.test(blk.textContent)) bad.push('R8 an assumption without saying so: "' + clip(e.textContent) + '"')
  }
  // R4: texts outside what carries an origin of the file, and outside the cards of the cut (Section/Layers) and of the weight
  for (const root of roots) {
    const copy = root.cloneNode(true)
    for (const x of copy.querySelectorAll('[data-honest]')) x.remove() // a card inside a card (the part cards stand in the Parts tab) is a root of its own, with its own words
    for (const x of copy.querySelectorAll('[data-src=file],[data-src=derived],[data-src=estimate],[data-src=assumed],select')) x.remove()
    for (const x of copy.querySelectorAll('*')) x.append(' ') // the words of neighbouring elements are not run together ("Normal" + "Stahl" is no word)
    const weightCard = root.id === 'pc-weight'
    const inCut = root.id === 'card-cut'
    const text = copy.textContent + ' ' + [...copy.querySelectorAll('[title],[aria-label],[placeholder],[alt]')].map((x) => (x.getAttribute('title') || '') + ' ' + (x.getAttribute('aria-label') || '')).join(' ')
    const rules = [[/\\b\\d\\.\\d{4}\\b/, 'a material number'], [/materialvorschlag|material suggestion/i, 'a material suggestion'], [/\\bmasse\\b/i, '"Masse" (dimensions are called Maße)'], [/polygon/i, 'polygon (they are triangles)']]
    if (!inCut) rules.push([/\\blayers?\\b|\\bebenen\\b|\\bschichten?\\b/i, 'layers (only a toolpath has them)'])
    if (!weightCard) rules.push([/\\b(stahl|edelstahl|aluminium|messing|kupfer|kunststoff|werkstoff\\w*|legierung\\w*|steel|stainless|brass|copper|plastic|alloy|titan\\w*|titanium|eisen|iron|zink|zinc|holz|wood|nylon|harz|resin|pla|abs|gold|silber|silver|bronze)\\b/i, 'a material word outside the card Estimate the weight'])
    for (const [re, name] of rules) { const m = re.exec(text); if (m) bad.push('R4 forbidden: ' + name + ' [' + (root.id || root.dataset.card) + ']: "' + m[0] + '"') }
  }
  return bad
})()`

/** Source checks (R5, R7): the drawing area shows no numbers, CSS content is only the letters of an origin display. Returns the findings. */
export function staticChecks(src) {
  const bad = []
  if (/strokeText/.test(src)) bad.push('R5 strokeText in the source: the drawing area shows no numbers')
  for (const m of src.matchAll(/content:\s*(["'])(.*?)\1/g)) if (!/^[DRSA]?$/.test(m[2])) bad.push('R7 CSS content "' + m[2] + '"')
  if (/content:\s*attr\(/.test(src)) bad.push('R7 CSS content: attr(...)')
  return bad
}

/** Deliberate violations (the test of the test): each is applied to the real page and the check MUST then find something that starts with the rule named in `expect`. `step` = only where the STEP viewer's weight card exists. */
export const PROBES = [
  { name: 'a digit without any origin', expect: 'R1', run: `(() => { const d = document.querySelector('#pc-dims-kv'); const e = document.createElement('dd'); e.textContent = '12 mm'; d.append(document.createElement('dt'), e) })()` },
  { name: 'an origin on the container only', expect: 'R1', run: `(() => { const b = document.querySelector('#pc-dims .bd'); const c = document.createElement('div'); c.dataset.src = 'derived'; const p = document.createElement('p'); p.textContent = '12 mm'; c.append(p); b.append(c) })()` },
  { name: 'an unknown origin', expect: 'R1', run: `(() => { document.querySelector('#pc-dims-kv .dim-n').dataset.src = 'guess' })()` },
  { name: 'a size number of the row without an origin', expect: 'R1', run: `(() => { document.querySelector('#pc-dims-kv .dim-n').removeAttribute('data-src') })()` },
  { name: 'a digit in a help text (hidden behind the "?") without an origin', expect: 'R1', run: `(() => { document.querySelector('#pc-dims .hint').append(' about 12 mm') })()` },
  { name: 'a digit in a tooltip', expect: 'R1', run: `(() => { document.querySelector('#pc-info .pc-x').title = 'about 12 mm' })()` },
  { name: 'a tooltip over 60 characters', expect: 'R6', run: `(() => { document.querySelector('#pc-info .pc-x').title = 'x'.repeat(61) })()` },
  { name: 'a digit in a place holder', expect: 'R1', run: `(() => { const i = document.createElement('input'); i.type = 'search'; i.placeholder = 'Filter 12'; document.querySelector('#pc-info .bd').append(i) })()` },
  { name: 'an invented material number', expect: 'R4', run: `(() => { const p = document.createElement('p'); p.textContent = 'Werkstoff 1.0038'; document.querySelector('#pc-vol .bd').append(p) })()` },
  { name: 'a material word outside the weight card', expect: 'R4', run: `(() => { const p = document.createElement('p'); p.textContent = 'Stahl'; document.querySelector('#pc-vol .bd').append(p) })()` },
  { name: 'the word polygon', expect: 'R4', run: `(() => { const p = document.createElement('p'); p.textContent = 'Polygone'; document.querySelector('#pc-vol .bd').append(p) })()` },
  { name: 'the word mass for dimensions', expect: 'R4', run: `(() => { const p = document.createElement('p'); p.textContent = 'Masse'; document.querySelector('#pc-dims .bd').append(p) })()` },
  { name: 'a layer name', expect: 'R4', run: `(() => { const p = document.createElement('p'); p.textContent = 'Layer'; document.querySelector('#pc-dims .bd').append(p) })()` },
  { name: 'ui with a quantity', expect: 'R1', run: `(() => { const s = document.createElement('span'); s.dataset.src = 'ui'; s.textContent = '5 mm'; document.querySelector('#pc-dims .bd').append(s) })()` },
  { name: 'an assumption that does not say so', expect: 'R8', run: `(() => { const p = document.createElement('p'); const s = document.createElement('span'); s.dataset.src = 'assumed'; s.textContent = '5 m'; p.append(s); document.querySelector('#pc-dims .bd').append(p) })()` },
  { name: 'an estimate without its mark', expect: 'R2', step: true, run: `(() => { document.querySelector('#pc-w-res .tag.est').remove() })()` },
  { name: 'an estimate with another word as its mark', expect: 'R2', step: true, run: `(() => { document.querySelector('#pc-w-res .tag.est').textContent = 'about' })()` },
  { name: 'a weight without the "≈"', expect: 'R2', step: true, run: `(() => { const b = document.querySelector('#pc-w-res .big'); b.firstChild.textContent = '' })()` },
  { name: 'a number in the selection chip without an origin', expect: 'R1', run: `(() => { const c = document.getElementById('sel-chip'); const e = document.createElement('span'); e.textContent = '12 mm'; c.append(e) })()` },
  { name: 'a row of the Info card without an origin', expect: 'R1', info: true, run: `(() => { const d = document.querySelector('#stats dd'); window.__undo = d.dataset.src; d.removeAttribute('data-src') })()`, undo: `(() => { document.querySelector('#stats dd').dataset.src = window.__undo })()` },
  { name: 'a material name that is not in the list', expect: 'R4', run: `(() => { const p = document.createElement('p'); p.textContent = 'Titan'; document.querySelector('#pc-vol .bd').append(p) })()` },
  { name: 'a triangle number of the part list without an origin', expect: 'R1', list: true, run: `(() => { const t = document.querySelector('#parts .part .tr'); window.__undo = t.dataset.src; t.removeAttribute('data-src') })()`, undo: `(() => { document.querySelector('#parts .part .tr').dataset.src = window.__undo })()` },
  { name: 'the count line of the part list without an origin', expect: 'R1', list: true, run: `(() => { const c = document.getElementById('part-count'); window.__undo = c.dataset.src; c.removeAttribute('data-src') })()`, undo: `(() => { document.getElementById('part-count').dataset.src = window.__undo })()` },
  { name: 'a digit in the name of a tick without an origin', expect: 'R1', list: true, run: `(() => { const c = document.querySelector('#parts .part input'); window.__undo = c.getAttribute('aria-label'); c.setAttribute('aria-label', 'Visible: Part 7'); c.removeAttribute('data-src') })()`, undo: `(() => { const c = document.querySelector('#parts .part input'); c.setAttribute('aria-label', window.__undo); c.dataset.src = 'file' })()` },
  { name: 'a number of the card Files without an origin', expect: 'R1', files: true, run: `(() => { const s = document.querySelector('#card-files .fsub [data-src=file]'); s.dataset.probe = '1'; s.removeAttribute('data-src') })()`, undo: `(() => { const s = document.querySelector('#card-files [data-probe]'); s.dataset.src = 'file'; s.removeAttribute('data-probe') })()` },
  { name: 'a material word in the card Files', expect: 'R4', files: true, run: `(() => { const p = document.createElement('p'); p.dataset.probe = '1'; p.textContent = 'Stahl'; document.querySelector('#card-files .bd').append(p) })()`, undo: `(() => { document.querySelectorAll('#card-files [data-probe]').forEach((x) => x.remove()) })()` },
  { name: 'a digit in an output that is no slider read-out', expect: 'R1', run: `(() => { const o = document.createElement('output'); o.dataset.probe = '1'; o.textContent = '12 mm'; document.querySelector('#pc-dims .bd').append(o) })()`, undo: `(() => { document.querySelectorAll('[data-probe]').forEach((x) => x.remove()) })()` },
  { name: 'a name of the part list without an origin', expect: 'R1', list: true, run: `(() => { const n = document.querySelector('#parts .part .nm'); window.__undo = [n.textContent, n.dataset.src]; n.textContent = 'Part 7'; n.removeAttribute('data-src') })()`, undo: `(() => { const n = document.querySelector('#parts .part .nm'); n.textContent = window.__undo[0]; n.dataset.src = window.__undo[1] })()` },
  { name: 'a file name with a digit and no origin', expect: 'R1', files: true, run: `(() => { const n = document.querySelector('#card-files .fn'); window.__undo = [n.textContent, n.dataset.src]; n.textContent = 'bracket-12.step'; n.removeAttribute('data-src') })()`, undo: `(() => { const n = document.querySelector('#card-files .fn'); n.textContent = window.__undo[0]; n.dataset.src = window.__undo[1] })()` },
  { name: 'a tooltip of the tool strip with a digit', expect: 'R1', list: true, run: `(() => { const b = document.querySelector('#tree-strip button'); window.__undo = b.title; b.title = 'Show 12 parts' })()`, undo: `(() => { document.querySelector('#tree-strip button').title = window.__undo })()` },
  { name: 'an assumed unit that does not say so', expect: 'R8', files: true, run: `(() => { const p = document.createElement('p'); p.dataset.probe = '1'; const s = document.createElement('span'); s.dataset.src = 'assumed'; s.textContent = 'm'; p.append(s); document.querySelector('#card-files .bd').append(p) })()`, undo: `(() => { document.querySelectorAll('#card-files [data-probe]').forEach((x) => x.remove()) })()` },
  { name: 'a number of the status bar without an origin', expect: 'R1', status: true, run: `(() => { const s = document.querySelector('#status-slot [data-src]'); s.dataset.probe = s.dataset.src; s.removeAttribute('data-src') })()`, undo: `(() => { const s = document.querySelector('#status-slot [data-probe]'); s.dataset.src = s.dataset.probe; s.removeAttribute('data-probe') })()` },
  { name: 'the zoom of the status bar without an origin', expect: 'R1', status: true, run: `(() => { const s = document.querySelector('#status-zoom [data-src]'); s.dataset.probe = s.dataset.src; s.removeAttribute('data-src') })()`, undo: `(() => { const s = document.querySelector('#status-zoom [data-probe]'); s.dataset.src = s.dataset.probe; s.removeAttribute('data-probe') })()` },
  { name: 'a scale in an assumed unit that does not say so', expect: 'R8', status: true, run: `(() => { const l = document.querySelector('#scalebar .sb-label'); window.__undo = l.innerHTML; const s = document.createElement('span'); s.dataset.src = 'assumed'; s.textContent = '5 m'; l.replaceChildren(s) })()`, undo: `(() => { document.querySelector('#scalebar .sb-label').innerHTML = window.__undo })()` },
  { name: 'the plugin version without its origin', expect: 'R1', status: true, run: `(() => { const v = document.getElementById('status-version'); v.dataset.probe = v.dataset.src; v.removeAttribute('data-src') })()`, undo: `(() => { const v = document.getElementById('status-version'); v.dataset.src = v.dataset.probe; v.removeAttribute('data-probe') })()` },
  { name: 'the plugin version with an origin that is not known', expect: 'R1', status: true, run: `(() => { const v = document.getElementById('status-version'); v.dataset.probe = v.dataset.src; v.dataset.src = 'guess' })()`, undo: `(() => { const v = document.getElementById('status-version'); v.dataset.src = v.dataset.probe; v.removeAttribute('data-probe') })()` },
  { name: 'an estimate with no density chosen', expect: 'R3', step: true, run: `(() => { const s = document.getElementById('pc-dens'); s.value = '' })()` }
]

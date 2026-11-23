// Shared by 3D Model Viewer and STEP Viewer 3D (canonical copy: plugins/_shared; do not edit the copies in editor/shared).
// The card (UX v3): a titled block on the side of the view. Cards that show NUMBERS are built only through the helpers below, and every number needs a
// declared origin (data-src), so that nothing on screen can be a guess without saying so:
//   file      the file itself says it (name, a unit, a count of parts)
//   derived   worked out from the mesh or the camera (sizes, volume, triangles, a distance)
//   estimate  an estimate the person asked for (weight from a density); always with the mark "Estimate" (see weight-core.js)
//   assumed   an assumption named as one (a rule of the format, e.g. glTF is in metres)
//   ui        a number of the interface itself (a count of tabs, a key)
//   manifest  the plugin's own version, copied from its manifest (a test keeps the copy equal to orca-plugin.json)
// `dev/e2e-honesty.mjs` checks this on the real page, with the rules of `dev/honesty-rules.mjs`.
export const SRC = ['file', 'derived', 'estimate', 'assumed', 'ui', 'manifest']

/** The origin kind, or an Error: a number without a known origin must not be built. */
export function srcKind(kind) {
  if (!SRC.includes(kind)) throw new Error(`cards: unknown or missing data-src "${kind}" (one of ${SRC.join(', ')})`)
  return kind
}

/** Checks rows [{ label, value, src, tip? }] before anything is built (also used by the unit test). Returns the rows. */
export function validateRows(rows) {
  for (const r of rows) {
    if (!r || typeof r.label !== 'string' || !r.label) throw new Error('cards: a row needs a label')
    if (r.value === undefined || r.value === null || r.value === '' || r.value === false) throw new Error(`cards: row "${r.label}" has no value`)
    srcKind(r.src)
  }
  return rows
}

const make = (tag, props = {}, ...kids) => {
  const e = Object.assign(document.createElement(tag), props)
  e.append(...kids.filter((k) => k !== null && k !== undefined))
  return e
}

/** A piece of text that carries its origin: <span data-src="derived">12 mm</span>. */
export function src(kind, content) {
  const s = make('span', {}, content)
  s.dataset.src = srcKind(kind)
  return s
}

/** A list of label/value rows: <dl class="kv">. The value cell itself carries data-src. */
export function kvList(rows, { id = '' } = {}) {
  validateRows(rows)
  const dl = make('dl', { className: 'kv' })
  if (id) dl.id = id
  for (const r of rows) {
    const dd = make('dd', {}, r.value)
    dd.dataset.src = r.src
    if (r.tip) dd.title = r.tip
    dl.append(make('dt', { textContent: r.label }), dd)
  }
  return dl
}

/** The one big number of a card (volume, weight): <div class="big" data-src>. */
export function bigNumber(text, kind, { id = '' } = {}) {
  const d = make('div', { className: 'big', textContent: text })
  d.dataset.src = srcKind(kind)
  if (id) d.id = id
  return d
}

/**
 * An estimate (a weight): the mark first, then "≈ value" with the origin "estimate". The mark and the "≈" cannot be left out: this is the only way to build an
 * estimate. `value` is the number with its unit ("47 g"); `markText` is the word of the mark ("Estimate").
 */
export function estimateBlock({ value, markText, id = '' }) {
  if (!value || !markText) throw new Error('cards: an estimate needs its value and its mark')
  const box = make('div', { className: 'w-res' })
  if (id) box.id = id
  const num = make('span', { textContent: value })
  num.dataset.src = 'estimate'
  box.append(tag(markText, 'est'), make('div', { className: 'big' }, '≈ ', num))
  return box
}

/** A sentence under the numbers. Pieces may be strings or src() spans, so that a number in a sentence carries its origin. */
export function hint(...pieces) {
  return make('p', { className: 'hint' }, ...pieces)
}

/** A small mark in the card's head or beside a number ("Estimate"). */
export function tag(text, kind = '') {
  return make('span', { className: `tag${kind ? ` ${kind}` : ''}`, textContent: text })
}

/**
 * The "?" of a card (UX v3, round 4): the explanation does not stand in the card all the time, it opens on request. `targets` are the elements that hold the
 * explanation (paragraphs of the card); they are hidden to begin with and the button shows or hides them (aria-expanded, aria-controls). `mark` is the symbol
 * inside the button (the caller draws it, so this file stays free of the symbol set); `label` is the name for a screen reader, `tip` the tooltip (60 characters at most).
 */
const HELP_OPEN = new Set() // the "?" that are open, by id: a card that is built again (another part chosen) keeps its explanation open
export function helpButton({ id, label, tip, mark = null, targets }) {
  const list = (Array.isArray(targets) ? targets : [targets]).filter(Boolean)
  if (!id || !label || !list.length) throw new Error('cards: a help button needs an id, a label and something to show')
  const b = make('button', { type: 'button', id, className: 'help-btn' }, mark || '?')
  b.title = tip || label
  b.setAttribute('aria-label', label)
  b.setAttribute('aria-expanded', 'false')
  const ids = []
  list.forEach((e, i) => {
    if (!e.id) e.id = `${id}-t${i}`
    ids.push(e.id)
    e.hidden = true
  })
  b.setAttribute('aria-controls', ids.join(' '))
  let open = HELP_OPEN.has(id)
  const show = () => {
    b.setAttribute('aria-expanded', String(open))
    for (const e of list) e.hidden = !open
  }
  show()
  b.onclick = () => {
    open = !open
    if (open) HELP_OPEN.add(id)
    else HELP_OPEN.delete(id)
    show()
  }
  return b
}

/**
 * The row of the three sizes (the signature of the cards): X, Y, Z side by side, each a big number with its unit and its axis name under it.
 * rows: [{ label ('X' or 'Z (up)'), value ('80'), unit ('mm'), src }]; the number carries its origin itself (data-src), the unit and the axis are words.
 * Markup: <dl class="dims"><div><dt>X</dt><dd><span class="dim-n" data-src>80</span><span class="dim-u">mm</span></dd></div> ... </dl> (the number is shown above its axis by the CSS).
 */
export function dimsRow(rows, { id = '' } = {}) {
  validateRows(rows.map((r) => ({ label: r.label, value: r.value, src: r.src })))
  const dl = make('dl', { className: 'dims' })
  if (id) dl.id = id
  if (rows.some((r) => String(r.value).length >= 5 || String(r.value).length + String(r.unit || '').length >= 8)) dl.dataset.layout = 'stack' // a number of five characters (1.234), or a number and its unit of eight (4,56 units), does not fit in a third of a narrow card in 20 px: the sizes stand one under the other
  for (const r of rows) {
    const n = make('span', { className: 'dim-n', textContent: r.value })
    n.dataset.src = r.src
    const dd = make('dd', {}, n, r.unit ? make('span', { className: 'dim-u', textContent: r.unit }) : null)
    dl.append(make('div', {}, make('dt', { textContent: r.label }), dd))
  }
  return dl
}

/**
 * A card: <section class="card" id aria-labelledby><h3 class="card-h">[symbol] title [?] ... extras</h3><div class="bd">body</div></section>.
 * `extras` are nodes for the head (a button, a count). `icon` is the symbol in front of the title (a node drawn by the caller); `help` is a helpButton for the explanation.
 * `data-card` names it for the tests; `honest: true` puts the card into the honesty check.
 */
export function card({ id, title, icon = null, help = null, extras = [], body = [], honest = true, className = '' }) {
  if (!id || !title) throw new Error('cards: a card needs an id and a title')
  const h = make('h3', { className: 'card-h', id: `${id}-h` }, icon, make('span', { className: 'card-t', id: `${id}-t`, textContent: title }), help, ...extras)
  const bd = make('div', { className: 'bd' }, ...body)
  const c = make('section', { className: `card${className ? ` ${className}` : ''}`, id }, h, bd)
  c.setAttribute('aria-labelledby', `${id}-t`) // named by the title alone, not by everything in the head (the "?", a count, a button)
  c.dataset.card = id
  if (honest) c.dataset.honest = '1'
  return c
}

/** Makes an existing element (a tab panel) look like a card in the three-column layout: a heading in front. The content stays where it is. `icon` as for card(); `help` (a helpButton) can be given later with `h.insertBefore`/`append`. */
export function asCard(panel, { id, title, honest = false, icon = null }) {
  panel.classList.add('card', 'card-panel')
  panel.dataset.card = id
  if (honest) panel.dataset.honest = '1'
  const h = make('h3', { className: 'card-h', id: `${id}-h` }, icon, make('span', { className: 'card-t', id: `${id}-t`, textContent: title }))
  panel.prepend(h)
  return h
}

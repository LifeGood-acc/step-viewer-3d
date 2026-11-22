// confirm-dialog.js with a minimal stand-in for the DOM (no browser in Node): the answers, the keys, the focus.
import test from 'node:test'
import assert from 'node:assert/strict'

class El {
  constructor(tag) {
    this.tagName = tag.toUpperCase()
    this.children = []
    this.listeners = {}
    this.attrs = {}
    this.parent = null
    this.inert = false
    this.nodeType = 1
    this.className = ''
    this.textContent = ''
  }
  append(...kids) { for (const k of kids) { k.parent = this; this.children.push(k) } }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); this.parent = null }
  setAttribute(k, v) { this.attrs[k] = v }
  addEventListener(t, f) { (this.listeners[t] ||= []).push(f) }
  removeEventListener(t, f) { this.listeners[t] = (this.listeners[t] || []).filter((x) => x !== f) }
  focus() { globalThis.document.activeElement = this }
  querySelector() { return null }
  fire(type, ev = {}) {
    const e = { type, target: ev.target || this, key: ev.key, defaultPrevented: false, stopped: false, preventDefault() { this.defaultPrevented = true }, stopPropagation() { this.stopped = true } }
    for (const f of this.listeners[type] || []) f(e)
    return e
  }
}
const body = new El('body')
const opener = new El('button')
body.append(opener)
globalThis.document = { body, activeElement: opener, createElement: (t) => new El(t) }
const { askConfirm, confirmOpen } = await import('../editor/shared/confirm-dialog.js')
const labels = { title: 'T', text: 'X', confirmLabel: 'Close', cancelLabel: 'Cancel' }
const dialog = () => body.children.find((c) => c.attrs['aria-modal'])
const buttons = (d) => d.children[0].children[2].children

test('the focus starts on Cancel, the page behind is inert, and the question is open', async () => {
  const p = askConfirm(labels)
  const d = dialog()
  assert.equal(document.activeElement.textContent, 'Cancel')
  assert.equal(opener.inert, true)
  assert.equal(confirmOpen(), true)
  assert.equal(d.attrs['aria-modal'], 'true')
  d.fire('keydown', { key: 'Escape' })
  assert.equal(await p, false)
})
test('Escape cancels, gives the focus back and takes the page out of the inert state', async () => {
  const p = askConfirm(labels)
  const d = dialog()
  const e = d.fire('keydown', { key: 'Escape' })
  assert.equal(await p, false)
  assert.equal(e.stopped, true)
  assert.equal(document.activeElement, opener)
  assert.equal(opener.inert, false)
  assert.equal(confirmOpen(), false)
  assert.equal(dialog(), undefined)
})
test('only the danger button confirms; Cancel and a click outside cancel; Enter alone does nothing', async () => {
  let p = askConfirm(labels)
  let d = dialog()
  d.fire('keydown', { key: 'Enter' })
  assert.equal(confirmOpen(), true, 'Enter alone does not answer')
  buttons(d)[0].onclick()
  assert.equal(await p, true)
  p = askConfirm(labels)
  d = dialog()
  buttons(d)[1].onclick()
  assert.equal(await p, false)
  p = askConfirm(labels)
  d = dialog()
  d.fire('click', { target: d })
  assert.equal(await p, false)
  p = askConfirm(labels)
  d = dialog()
  d.fire('click', { target: buttons(d)[0] })
  assert.equal(confirmOpen(), true, 'a click inside the card is not "outside"')
  buttons(d)[1].onclick()
  await p
})
test('Tab goes round between the two buttons and keys of the page are stopped', async () => {
  const p = askConfirm(labels)
  const d = dialog()
  const [ok, cancel] = buttons(d)
  assert.equal(document.activeElement, cancel)
  d.fire('keydown', { key: 'Tab' })
  assert.equal(document.activeElement, ok)
  d.fire('keydown', { key: 'Tab' })
  assert.equal(document.activeElement, cancel)
  assert.equal(d.fire('keydown', { key: 'w' }).stopped, true)
  cancel.onclick()
  await p
})
test('asking again while a question is open gives the same answer and no second dialog', async () => {
  const p1 = askConfirm(labels)
  const p2 = askConfirm(labels)
  assert.equal(p1, p2)
  assert.equal(body.children.filter((c) => c.attrs['aria-modal']).length, 1)
  buttons(dialog())[0].onclick()
  assert.equal(await p1, true)
})

// Tests for the kept-file store (editor/shared/session-store.js) with a small in-memory IndexedDB. Same file in both plugins.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createSessionStore, KEEP_MAX_BYTES } from '../editor/shared/session-store.js'

// just enough of IndexedDB: open, createObjectStore, transaction, get/put/delete/clear, oncomplete
function fakeIndexedDB(shared = new Map()) {
  return {
    open() {
      const req = {}
      queueMicrotask(() => {
        req.result = {
          createObjectStore() {},
          close() {},
          transaction() {
            const tx = {}
            const store = {
              get: (k) => later({ result: shared.get(k) }),
              put: (v, k) => (shared.set(k, structuredClone(v)), later({ result: k })),
              delete: (k) => (shared.delete(k), later({})),
              clear: () => (shared.clear(), later({}))
            }
            function later(r) {
              queueMicrotask(() => r.onsuccess && r.onsuccess())
              return r
            }
            tx.objectStore = () => store
            setTimeout(() => tx.oncomplete && tx.oncomplete(), 5)
            return tx
          }
        }
        req.onupgradeneeded && req.onupgradeneeded()
        req.onsuccess && req.onsuccess()
      })
      return req
    }
  }
}

test('a file is kept with its name and size, comes back whole, and the next one replaces it', async () => {
  const s = createSessionStore(fakeIndexedDB())
  assert.equal(await s.load(), null)
  const bytes = new Uint8Array([1, 2, 3, 4]).buffer
  assert.equal(await s.keep('a.glb', bytes, 'glb'), true)
  const got = await s.load()
  assert.equal(got.meta.name, 'a.glb')
  assert.equal(got.meta.size, 4)
  assert.deepEqual([...new Uint8Array(got.bytes)], [1, 2, 3, 4])
  await s.keepView({ pos: [1, 2, 3] })
  assert.deepEqual((await s.info()).view, { pos: [1, 2, 3] })
  await s.keep('b.stl', new Uint8Array([9]).buffer)
  const next = await s.load()
  assert.equal(next.meta.name, 'b.stl')
  assert.equal(next.view, null, 'the view of the old file is not carried over')
})

test('forget deletes everything; a file over the limit is not kept; a missing IndexedDB means nothing is kept and nothing throws', async () => {
  const s = createSessionStore(fakeIndexedDB())
  await s.keep('a.glb', new ArrayBuffer(8))
  await s.forget()
  assert.equal(await s.load(), null)
  assert.equal(await s.info(), null)
  assert.equal(await s.keep('big', { byteLength: KEEP_MAX_BYTES + 1 }), false)
  const none = createSessionStore(null)
  assert.equal(await none.keep('x', new ArrayBuffer(1)), false)
  assert.equal(await none.load(), null)
  await none.forget()
  await none.keepView({})
  const broken = createSessionStore({ open: () => { throw new Error('refused') } })
  assert.equal(await broken.keep('x', new ArrayBuffer(1)), false)
  assert.equal(await broken.load(), null)
})

// Shared by 3D Model Viewer and STEP Viewer 3D (canonical copy: plugins/_shared; do not edit the copies in editor/shared).
// Orca builds a panel's frame anew whenever the panel is shown again (the right sidebar is closed and opened, another panel was in
// front, ...), and an editor frame when its tab is shown again: what the page held is gone. So the file the person dropped or chose
// last is kept in the frame's own IndexedDB (no permission needed, nothing leaves the computer), with the view, and comes back when
// the frame starts without a document. One file at a time: the next one replaces it; "Forget" deletes it.
export const KEEP_MAX_BYTES = 200 * 1024 * 1024 // above this a file is not kept (IndexedDB took 300 MB in 1.2 s in Orca, but memory is shared with the viewer)
const DB = 'viewer-session'
const STORE = 'kv'

function open(factory) {
  return new Promise((resolve, reject) => {
    const r = factory.open(DB, 1)
    r.onupgradeneeded = () => r.result.createObjectStore(STORE)
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })
}
const wrap = (req) =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
async function run(factory, mode, fn) {
  const db = await open(factory)
  try {
    const tx = db.transaction(STORE, mode)
    const done = new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error || new Error('aborted'))
    })
    const out = await fn(tx.objectStore(STORE))
    await done
    return out
  } finally {
    db.close()
  }
}

/** The kept file, the view, and what they are: a store that never throws (a missing or refused IndexedDB just means nothing is kept). */
export function createSessionStore(factory = typeof indexedDB === 'undefined' ? null : indexedDB) {
  const safe = async (fn, fallback) => {
    if (!factory) return fallback
    try {
      return await fn()
    } catch {
      return fallback
    }
  }
  return {
    /** Keeps `bytes` (an ArrayBuffer) under `name`; false when it is too large or the storage refuses it. */
    keep: (name, bytes, type = '') =>
      safe(async () => {
        if (bytes.byteLength > KEEP_MAX_BYTES) return false
        await run(factory, 'readwrite', async (s) => {
          s.put({ name, size: bytes.byteLength, type, savedAt: Date.now() }, 'meta')
          s.put(bytes, 'bytes')
          s.delete('view') // the view belonged to the file before
        })
        return true
      }, false),
    keepView: (view) => safe(() => run(factory, 'readwrite', async (s) => void s.put(view, 'view')), undefined),
    /** { meta, view } without the bytes, or null. */
    info: () =>
      safe(
        () =>
          run(factory, 'readonly', async (s) => {
            const meta = await wrap(s.get('meta'))
            return meta ? { meta, view: (await wrap(s.get('view'))) || null } : null
          }),
        null
      ),
    /** { meta, bytes, view } or null. */
    load: () =>
      safe(
        () =>
          run(factory, 'readonly', async (s) => {
            const meta = await wrap(s.get('meta'))
            const bytes = meta ? await wrap(s.get('bytes')) : null
            return meta && bytes ? { meta, bytes, view: (await wrap(s.get('view'))) || null } : null
          }),
        null
      ),
    forget: () => safe(() => run(factory, 'readwrite', async (s) => void s.clear()), undefined)
  }
}

// Worker for the Tools area (see tools-core.js). One task at a time; the page stops a task by terminating the worker.
import { runCore, transferables } from './tools-core.js'

self.onmessage = async (e) => {
  const { id, type, payload } = e.data
  try {
    const res = await runCore(type, payload, { progress: (fraction, label) => self.postMessage({ id, type: 'progress', fraction, label }), isCancelled: () => false })
    self.postMessage({ id, type: 'done', result: res }, [...transferables(res)])
  } catch (err) {
    self.postMessage({ id, type: 'error', message: String((err && err.message) || err) })
  }
}
self.postMessage({ type: 'ready' })

// Shared by 3D Model Viewer and STEP Viewer 3D (canonical copy: plugins/_shared; do not edit the copies in editor/shared).
// Starts a task of the Tools area in a worker (one worker for each task, stopped when the task ends or is cancelled) and falls back to running it on the page when
// the worker cannot start (the page then pauses while it works).
let seq = 0

function startWorker() {
  const w = new Worker(new URL('./tools-worker.js', import.meta.url), { type: 'module' })
  return w
}

/**
 * runTask('compress', payload, { transfer: [ArrayBuffer…], onProgress(fraction, label) }) -> { promise, cancel() }
 * The promise rejects with Error('cancelled') after cancel().
 */
export function runTask(type, payload, { transfer = [], onProgress } = {}) {
  const id = ++seq
  let cancelled = false
  let settle
  const promise = new Promise((resolve, reject) => {
    settle = { resolve, reject }
  })
  const mark = (v) => {
    if (typeof document !== 'undefined') document.documentElement.dataset.toolsRunner = v // lets tests and tooling see where the work ran
  }
  const fallback = async () => {
    mark('page')
    try {
      const { runCore } = await import('./tools-core.js')
      settle.resolve(await runCore(type, payload, { progress: (f, l) => onProgress && onProgress(f, l), isCancelled: () => cancelled }))
    } catch (e) {
      settle.reject(e)
    }
  }
  // a worker of its own for each task: cancelling one task (terminating its worker) cannot leave another one waiting for ever
  let w = null
  try {
    w = startWorker()
  } catch {
    w = null
  }
  if (!w) {
    fallback()
  } else {
    // First wait until the worker says it is alive ("ready" is posted once its modules are loaded): only then is the payload handed over,
    // because handing over detaches the buffers, and the page could not do the task itself afterwards.
    let started = false
    const onMessage = (e) => {
      const m = e.data
      if (m.type === 'ready' && !started) {
        started = true
        clearTimeout(timer)
        mark('worker')
        w.postMessage({ id, type, payload }, transfer)
        return
      }
      if (m.id !== id) return
      if (m.type === 'progress') onProgress && onProgress(m.fraction, m.label)
      else {
        cleanup()
        w.terminate() // one task, one worker
        if (m.type === 'done') settle.resolve(m.result)
        else settle.reject(new Error(m.message))
      }
    }
    const giveUp = () => {
      cleanup()
      try {
        w.terminate()
      } catch {
        // already gone
      }
      if (started) settle.reject(new Error('the worker stopped')) // the payload went to it: nothing left to do on the page
      else fallback() // it never came up (its script or a module is refused): the page does the task
    }
    const cleanup = () => {
      clearTimeout(timer)
      w.removeEventListener('message', onMessage)
      w.removeEventListener('error', giveUp)
    }
    const timer = setTimeout(giveUp, 8000)
    w.addEventListener('message', onMessage)
    w.addEventListener('error', giveUp)
  }
  return {
    promise,
    cancel() {
      cancelled = true
      if (w) w.terminate() // a worker cannot be asked to stop in the middle of wasm
      settle.reject(new Error('cancelled'))
    }
  }
}

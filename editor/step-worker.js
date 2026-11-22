// Background worker: reads a STEP file with occt-import-js (OpenCascade compiled to WebAssembly) off the page's thread.
// Messages in:  { type: 'init' } (warm up) or { type: 'read', buffer: ArrayBuffer, params }
// Messages out: { type: 'ready' | 'reading' | 'done' | 'error', ... }
// The WASM file ./vendor/occt/occt-import-js.wasm is loaded from the plugin's own folder; nothing comes from the network.
let occt = null

const f32 = (a) => (a instanceof Float32Array ? a.slice() : new Float32Array(a))
const u32 = (a) => (a instanceof Uint32Array ? a.slice() : new Uint32Array(a))

// The converter's WebAssembly is shipped as a plain file (the unmodified occt-import-js.wasm, 7.6 MB). To use another build, put it in
// the place of that file (see THIRD_PARTY_NOTICES.md).
async function loadWasm() {
  const r = await fetch('./vendor/occt/occt-import-js.wasm')
  if (!r.ok) throw new Error('converter file not available')
  return new Uint8Array(await r.arrayBuffer())
}

// One load, shared by the 'init' and the 'read' message (the handler is async, so they can overlap).
let loading = null
function ensureConverter() {
  loading ??= (async () => {
    importScripts('./vendor/occt/occt-import-js.js')
    occt = await self.occtimportjs({ wasmBinary: await loadWasm() })
  })()
  return loading
}

self.onmessage = async (ev) => {
  const { type, buffer, params } = ev.data
  try {
    await ensureConverter()
    if (type === 'init') {
      self.postMessage({ type: 'ready' }) // warmed up while the file is still on its way
      return
    }
    self.postMessage({ type: 'reading' })
    const t0 = performance.now()
    const r = occt.ReadStepFile(new Uint8Array(buffer), params)
    const ms = performance.now() - t0
    if (!r || !r.success) {
      self.postMessage({ type: 'error', message: 'converter_failed' })
      return
    }
    const transfer = []
    const meshes = r.meshes.map((m) => {
      const position = f32(m.attributes.position.array)
      const normal = m.attributes.normal ? f32(m.attributes.normal.array) : null
      const index = u32(m.index.array)
      transfer.push(position.buffer, index.buffer)
      if (normal) transfer.push(normal.buffer)
      return { name: m.name || '', color: m.color || null, faces: (m.brep_faces || []).map((f) => ({ first: f.first, last: f.last, color: f.color || null })), position, normal, index }
    })
    const wasmMB = occt.HEAP8 ? occt.HEAP8.length / 1e6 : 0
    self.postMessage({ type: 'done', ms, wasmMB, root: r.root || null, meshes }, transfer)
  } catch (e) {
    self.postMessage({ type: 'error', message: String((e && e.message) || e).slice(0, 300) })
  }
}

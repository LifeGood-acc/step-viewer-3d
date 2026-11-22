"""Test harness: runs the editor in a plain browser, without Orca (Orca asks for approval before it runs a plugin).

  python3 dev/harness_server.py [port]
  open  http://127.0.0.1:8765/h/index.html?file=/abs/path/model.glb&act=b-wire,b-bg

`file` is read-only and must end in .step/.stp. `act` is a comma list of element ids to click after loading.
`orca.document` is a stand-in that hands the file over as bytes, the way Orca does for contentKind "bytes".
Binds to 127.0.0.1 only; nothing is fetched from the network.
"""
import http.server, os, sys, urllib.parse

ROOT = os.path.realpath(os.path.join(os.path.dirname(__file__), '..', 'editor'))
SHIM = """<script>
(() => {
  const q = new URLSearchParams(location.search)
  const file = q.get('file') || ''
  const type = file.split('.').pop().toLowerCase()
  if (q.get('theme') === 'dark') {
    document.documentElement.classList.add('dark')
    const st = document.documentElement.style
    for (const [k, v] of Object.entries({ background: '#16181c', foreground: '#e8e9ec', card: '#1f2227', 'muted-foreground': '#9aa0aa', border: '#33373f', accent: '#2c3038', primary: '#e8e9ec', 'primary-foreground': '#16181c' })) st.setProperty('--orca-' + k, v)
  }
  window.__mv3dHook = (h) => { window.__h = h } // test tooling: gives scripts access to renderer, camera and controls
  window.orca = {
    locale: q.get('lang') || 'en',
    on() { return { dispose() {} } },
    host: { async call(m, p) { window.__saved = { m, bytes: p.data.byteLength, name: p.suggestedName, mime: p.mimeType, png: new Uint8Array(p.data).slice(0, 4).join(',') }; window.__savedData = p.data; if (q.get('savecancel')) return { status: 'cancelled' }; return { status: 'saved' } } },
    document: q.get('nodoc') ? undefined : {
      onDidChange(h) {
        fetch('/file?p=' + encodeURIComponent(file))
          .then((r) => (q.get('kind') === 'text' ? r.text() : r.arrayBuffer()))
          .then((data) => h({ version: 1, readOnly: true, fileType: type, content: q.get('kind') === 'text' ? { kind: 'text', text: data } : { kind: 'bytes', bytes: data } }))
        return { dispose() {} }
      }
    }
  }
  if (q.get('q')) localStorage.setItem('step-viewer-3d.v2', JSON.stringify({ quality: q.get('q') }))
  const act = (q.get('act') || '').split(',').filter(Boolean)
  for (const id of (q.get('open') || '').split(',').filter(Boolean)) addEventListener('DOMContentLoaded', () => { const d = document.getElementById(id); if (d) d.open = true }) // open sections for screenshots
  const t0 = Date.now()
  const $ = (id) => document.getElementById(id)
  // ready: the busy overlay is gone and something final is shown (details, an error, or the memory gate)
  const settled = () => $('busy').hidden && ($('stats-sec') && !$('stats-sec').hidden || $('msg').className.indexOf('err') >= 0 || !$('gate').hidden)
  let acted = false
  const iv = setInterval(() => {
    if (Date.now() - t0 > 600000) { clearInterval(iv); document.title = 'READY' }
    if (!settled()) return
    if (!acted) {
      acted = true
      for (const id of act) { const el = $(id); if (el) el.click() }
      for (const kv of (q.get('set') || '').split(',').filter(Boolean)) { const [id, v] = kv.split(':'); const el = $(id); if (!el) continue; el.value = v; el.dispatchEvent(new Event(el.tagName === 'SELECT' || el.type === 'checkbox' ? 'change' : 'input', { bubbles: true })) }
      if (q.get('up')) { $('up').value = q.get('up'); $('up').dispatchEvent(new Event('change')) }
      setTimeout(() => { if (!act.includes('b-go')) { clearInterval(iv); document.title = 'READY' } }, 800)
      if (act.includes('b-go')) acted = 'go'
      return
    }
    if (acted === 'go' && settled() && $('gate').hidden) { clearInterval(iv); setTimeout(() => { document.title = 'READY' }, 800) }
  }, 250)
})()
</script>"""

class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def send(self, code, body, ctype):
        self.send_response(code); self.send_header('Content-Type', ctype); self.send_header('Content-Length', str(len(body))); self.end_headers(); self.wfile.write(body)
    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        if u.path == '/file':
            p = os.path.realpath(urllib.parse.parse_qs(u.query).get('p', [''])[0])
            if not p.lower().endswith(('.step', '.stp')) or not os.path.isfile(p):
                return self.send(404, b'no', 'text/plain')
            return self.send(200, open(p, 'rb').read(), 'application/octet-stream')
        if u.path.startswith('/h/'):
            rel = u.path[3:] or 'index.html'
            p = os.path.realpath(os.path.join(ROOT, rel))
            if not p.startswith(ROOT + os.sep) or not os.path.isfile(p):
                return self.send(404, b'no', 'text/plain')
            data = open(p, 'rb').read()
            ctype = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm'}.get(os.path.splitext(p)[1], 'application/octet-stream')
            if rel == 'index.html':
                data = data.replace(b'<link rel="stylesheet"', SHIM.encode() + b'<link rel="stylesheet"', 1)
            return self.send(200, data, ctype)
        self.send(404, b'no', 'text/plain')

if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    http.server.ThreadingHTTPServer(('127.0.0.1', port), H).serve_forever()

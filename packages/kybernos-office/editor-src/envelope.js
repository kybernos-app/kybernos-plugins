// The conversation between an editor frame and the DSH page around it. One envelope for every editor, light or full (open/save contract,
// docs/dev/office-editors-open-save-contract-2026-11-03.md): the frame is sandboxed (no cookie, no origin, `connect-src 'self'`), so it
//  - pulls the bytes of its file from `../__file` (the token is in the page's own address),
//  - tells the page when something changed, and hands the bytes of what it made when the page asks for them,
//  - never writes anything: the DSH page saves, after the person pressed Save.
//
//   page -> frame   { ky: 'office', op: 'export', id }   { op: 'reload' }   { op: 'saved' }     (read-only is asked in the frame's address: ?ro=1)
//   frame -> page   { op: 'loaded', hash, readOnly }   { op: 'dirty', value }   { op: 'exported', id, bytes | error }   { op: 'error', message }
const q = new URLSearchParams(location.search)
export const LANG = q.get('lang') === 'fr' ? 'fr' : 'en'
export const READONLY = q.get('ro') === '1'

const tell = (msg, transfer) => { try { window.parent.postMessage({ ky: 'office', ...msg }, '*', transfer || []) } catch (e) { /* no parent: opened on its own */ } }
export const loaded = (hash, readOnly) => tell({ op: 'loaded', hash, readOnly })
export const dirty = (value) => tell({ op: 'dirty', value: value === true })
export const fail = (message) => tell({ op: 'error', message: String(message && message.message ? message.message : message) })

/** The bytes of the file as they are on disk now, and the hash a save must still find there. */
export async function fetchFile () {
  const r = await fetch('../__file')
  if (!r.ok) throw new Error('The file cannot be read (' + r.status + ').')
  return { bytes: new Uint8Array(await r.arrayBuffer()), hash: r.headers.get('X-Office-Hash') || '' }
}

/** Listens to the page. `handlers`: `exportBytes() => Uint8Array|ArrayBuffer`, `reload()`, `saved()`. */
export function listen (handlers) {
  window.addEventListener('message', async (e) => {
    if (e.source !== window.parent) return
    const m = e.data
    if (m === null || typeof m !== 'object' || m.ky !== 'office') return
    try {
      if (m.op === 'export') {
        const out = await handlers.exportBytes()
        const buf = out instanceof Uint8Array ? out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) : out
        tell({ op: 'exported', id: m.id, bytes: buf }, [buf])
      } else if (m.op === 'reload') await handlers.reload()
      else if (m.op === 'saved') handlers.saved()
    } catch (err) {
      if (m.op === 'export') tell({ op: 'exported', id: m.id, error: String(err && err.message ? err.message : err) })
      else fail(err)
    }
  })
}

/** An error boundary that tells the page instead of leaving a white frame. */
export const errorText = (err) => String(err && err.message ? err.message : err)

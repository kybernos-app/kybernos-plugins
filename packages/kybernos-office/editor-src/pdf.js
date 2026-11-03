// The PDF editor: EmbedPDF (MIT), in the frame. Its distribution is copied next to this file as it is (it loads its engine and its wasm from its own
// folder, so it is not bundled): `./embedpdf.js` stays an import of the page. What it offers here is to read a PDF, search it, fill its forms and annotate it
// (highlights, notes, drawings, text); what changes the file's content for good (redaction), opening other files and saving a copy by itself are turned off:
// the DSH page saves, after the person pressed Save, and keeps the bytes before.
//
// Read-only (`?ro=1`) turns the editing tools off the same way. « Changed » is told by the viewer's own undo history: an annotation or a form value is a step in it.
import EmbedPDF from './embedpdf.js'
import { LANG, READONLY, dirty, fail, fetchFile, listen, loaded } from './envelope.js'
import './pdf.css'

const wait = (task) => (task.toPromise ? task.toPromise() : new Promise((resolve, reject) => task.wait(resolve, reject)))
const NEVER = ['redaction', 'document-open', 'document-close', 'document-export', 'document-print', 'document-protect', 'document-capture', 'document-fullscreen', 'insert']
const VIEW_ONLY = ['annotation', 'form']

const viewer = EmbedPDF.init({
  type: 'container',
  target: document.getElementById('app'),
  // The engine runs in the page, not in a worker: a sandboxed frame has no origin of its own and the browser will not start the worker of a viewer from it.
  worker: false,
  wasmUrl: new URL('pdfium.wasm', location.href).href,
  // No address leaves the frame: no web font, no font fallback.
  fontFallback: null,
  fonts: { ui: null, signature: null },
  tabBar: 'never',
  theme: { preference: 'light' },
  i18n: { defaultLocale: LANG },
  // The stamp library is fetched from a CDN by default: nothing is asked of the network here, and the stamp tools are off anyway.
  stamp: { libraries: [], manifests: [] },
  disabledCategories: READONLY ? [...NEVER, ...VIEW_ONLY] : NEVER,
  log: false
})

let registry = null
let docId = null
let quiet = true      // the viewer says « history changed » while it opens a document: nothing counts until it is quiet
let afterSave = false // once the file was saved, the history is longer than what is on disk: any later step is a change

const plugin = (id) => registry.getPlugin(id).provides()
const tell = (value) => dirty(value)

async function open () {
  const f = await fetchFile()
  quiet = true
  afterSave = false
  const manager = plugin('document-manager')
  if (docId !== null) { try { await wait(manager.closeDocument(docId)) } catch (e) { /* nothing was open */ } docId = null }
  const r = await wait(manager.openDocumentBuffer({ buffer: f.bytes.buffer.slice(f.bytes.byteOffset, f.bytes.byteOffset + f.bytes.byteLength), name: 'document.pdf', autoActivate: true }))
  docId = r && r.documentId ? r.documentId : null
  try { if (r && r.task) await wait(r.task) } catch (e) { /* the viewer says it itself */ }
  // A moment for the viewer to finish its own bookkeeping, then every step of the history is the person's.
  await new Promise((resolve) => setTimeout(resolve, 600))
  quiet = false
  tell(false)
  loaded(f.hash, READONLY)
}

async function start () {
  registry = await viewer.registry
  const history = plugin('history')
  const onStep = () => {
    if (quiet || READONLY) return
    tell(afterSave || history.canUndo())
  }
  if (typeof history.onHistoryChange === 'function') history.onHistoryChange(onStep)
  listen({
    exportBytes: async () => {
      const buf = await wait(plugin('export').saveAsCopy())
      return buf instanceof Uint8Array ? buf : new Uint8Array(buf)
    },
    reload: open,
    saved: () => { afterSave = true; tell(false) }
  })
  await open()
}

start().catch(fail)

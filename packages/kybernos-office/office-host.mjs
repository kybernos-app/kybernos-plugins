// The disk side of the Office editors: open a file, hand its bytes to an editor, write what the editor returns, put it back. The rules are the
// open/save contract of docs/dev/office-editors-open-save-contract-2026-11-03.md:
//   1. the file on disk is the truth: an editor works on a copy and returns bytes, this module writes the file;
//   2. unchanged means untouched: nothing is written unless the DSH page asks to save (it asks only after the editor said something changed);
//   3. a save is a conflict, not an overwrite, when the file changed since the editor opened it (Kaby wrote it, or the person did elsewhere);
//   4. a save is atomic (temp file + rename) and undoable (the bytes before it are kept outside the person's folder).
// Everything is injected (the file system, the home folders, the clock), so the tests run it on a temporary folder.
import { createHash, randomBytes } from 'node:crypto'
import { basename, dirname, extname, isAbsolute, join, resolve, sep } from 'node:path'
import { FORMATS, formatOf, inspect } from './office-guard.mjs'

export const MAX_FILE = 64 * 1024 * 1024
const MAX_TOKENS = 64
const EDITOR_IDS = Object.freeze(Object.keys(FORMATS).map((f) => FORMATS[f].editor))
const TYPES = { js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', wasm: 'application/wasm', ttf: 'font/ttf', otf: 'font/otf', woff2: 'font/woff2', json: 'application/json; charset=utf-8', svg: 'image/svg+xml', png: 'image/png', html: 'text/html; charset=utf-8' }

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')
const refuse = (status, code, why) => ({ ok: false, status, code, why })

/** The page a sandboxed editor loads: a module script and a style sheet next to it, nothing inline. */
export const editorHtml = (editorId) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${editorId}</title>
<link rel="stylesheet" href="app.css"><style>html,body,#app{margin:0;height:100%}body{font:14px system-ui,sans-serif}</style></head><body><div id="app"></div><script type="module" src="app.js"></script></body></html>`

export function createHost ({ fs, home, userHome = null, log = () => {}, now = Date.now, editorsDir = null }) {
  const root = join(home, 'kybernos', 'kybernos-office')
  const snapRoot = join(root, 'snapshots')
  const editors = editorsDir !== null ? editorsDir : join(root, 'editors')
  const tokens = new Map()
  const verified = new Map()
  let manifest = { at: 0, value: null }
  let counters = null

  // ── the use counter (skills-vs-plugins rule): per format, opens / saves / refusals / undos / conflicts ───────
  const statsFile = join(root, 'stats.json')
  const loadStats = async () => {
    if (counters !== null) return counters
    try { counters = JSON.parse(await fs.readFile(statsFile, 'utf8')) } catch (e) { counters = {} }
    if (counters === null || typeof counters !== 'object') counters = {}
    return counters
  }
  const bump = async (format, what) => {
    try {
      const c = await loadStats()
      c[format] = c[format] || {}
      c[format][what] = (c[format][what] || 0) + 1
      await fs.mkdir(root, { recursive: true })
      await fs.writeFile(statsFile, JSON.stringify(c))
    } catch (e) { /* the counter never blocks an edit */ }
  }

  // ── the editors the host serves ─────────────────────────────────────────────────────────────────────────────
  const readManifest = async () => {
    if (now() - manifest.at < 3000) return manifest.value
    let value = null
    try {
      const m = JSON.parse(await fs.readFile(join(editors, 'manifest.json'), 'utf8'))
      if (m !== null && typeof m === 'object' && m.files !== null && typeof m.files === 'object' && typeof m.version === 'string') value = m
    } catch (e) { value = null }
    manifest = { at: now(), value }
    return value
  }
  /** Which editors are installed (all their files listed in the manifest are on disk): `{ version, installed: { sheet: true, doc: false } }`. */
  const status = async () => {
    const m = await readManifest()
    const installed = {}
    for (const id of EDITOR_IDS) installed[id] = m !== null && Array.isArray(m.editors) && m.editors.includes(id) && m.files[id + '/app.js'] !== undefined
    return { version: m === null ? null : m.version, installed }
  }

  const keyOf = (path) => sha256(path).slice(0, 16)
  const mint = (info) => {
    const token = randomBytes(16).toString('hex')
    tokens.set(token, info)
    while (tokens.size > MAX_TOKENS) tokens.delete(tokens.keys().next().value)
    return token
  }
  const who = (token) => (typeof token === 'string' && tokens.has(token) ? tokens.get(token) : null)

  // The home folder as the disk spells it (on macOS a temporary folder is /var/... for the person and /private/var/... for realpath).
  let realHome
  const homeReal = async () => {
    if (realHome === undefined) realHome = userHome === null ? null : await fs.realpath(userHome).catch(() => userHome)
    return realHome
  }
  const sensitive = async (real) => {
    const parts = real.split(sep)
    if (parts.includes('.ssh') || parts.includes('.gnupg')) return true
    const h = await homeReal()
    if (h !== null && real.startsWith(join(h, 'Library') + sep)) return true
    return false
  }

  /** Opens a file: checks it, reads it, runs the guard and mints the token the editor page is addressed by. */
  const open = async (path) => {
    if (typeof path !== 'string' || path === '' || path.includes('\0') || path.length > 4096) return refuse(400, 'bad-path', 'Give the full path of the file.')
    let p = path
    if (p === '~' || p.startsWith('~/')) { if (userHome === null) return refuse(400, 'not-absolute', 'The path must start with /.'); p = join(userHome, p.slice(1)) }
    if (!isAbsolute(p)) return refuse(400, 'not-absolute', 'The path must start with /.')
    const format = formatOf(p)
    if (format === null) return refuse(415, 'unsupported-format', 'Only .docx, .xlsx, .pdf and .md files open in the light editors.')
    let real
    try { real = await fs.realpath(resolve(p)) } catch (e) { return refuse(404, 'not-found', 'This file cannot be found.') }
    if (await sensitive(real)) return refuse(403, 'not-allowed', 'This folder is not opened by the editors.')
    const st = await fs.stat(real).catch(() => null)
    if (st === null || !st.isFile()) return refuse(404, 'not-a-file', 'This path is not a file.')
    if (st.size > MAX_FILE) return refuse(413, 'too-big', 'This file is larger than 64 MB.')
    const bytes = await fs.readFile(real)
    const seen = inspect(format, bytes)
    if (!seen.ok) { await bump(format, 'refused'); return refuse(422, seen.reason, 'This file is not a valid ' + format + ' file.') }
    const hash = sha256(bytes)
    const token = mint({ path: real, name: basename(real), format, hash, savedHash: null, openedAt: now() })
    await bump(format, 'opens')
    const s = await status()
    return { ok: true, token, name: basename(real), format, editor: FORMATS[format].editor, size: bytes.length, hash, losses: seen.losses, block: seen.block, installed: s.installed[FORMATS[format].editor] === true, undo: await hasUndo(real) }
  }

  /** The bytes of the file as they are now (the editor is opened on these); the hash is the base a later save must still find on disk. */
  const bytes = async (token) => {
    const t = who(token)
    if (t === null) return refuse(404, 'unknown-token', 'This link has expired: open the file again.')
    let buf
    try { buf = await fs.readFile(t.path) } catch (e) { return refuse(404, 'not-found', 'This file cannot be found.') }
    t.hash = sha256(buf)
    return { ok: true, bytes: buf, hash: t.hash, format: t.format, name: t.name }
  }

  const snapDir = (path) => join(snapRoot, keyOf(path))
  const readMeta = async (path) => { try { return JSON.parse(await fs.readFile(join(snapDir(path), 'meta.json'), 'utf8')) } catch (e) { return null } }
  const hasUndo = async (path) => {
    const m = await readMeta(path)
    if (m === null || m.prevHash === null || m.prevHash === undefined) return false
    try { await fs.access(join(snapDir(path), 'prev.bin')); return true } catch (e) { return false }
  }

  /** Temp file next to the target, then a rename: a crash leaves the old file or the new one, never half of either. The mode of the old file is kept. */
  const writeAtomic = async (target, data, mode) => {
    const tmp = join(dirname(target), '.' + basename(target) + '.ky-' + randomBytes(4).toString('hex') + '.tmp')
    try {
      await fs.writeFile(tmp, data, { flag: 'wx', mode: typeof mode === 'number' ? mode & 0o777 : 0o644 })
      await fs.rename(tmp, target)
    } catch (e) { await fs.rm(tmp, { force: true }).catch(() => {}); throw e }
  }

  const freeCopyName = async (path) => {
    const dir = dirname(path); const ext = extname(path); const stem = basename(path, ext)
    for (let i = 1; i < 100; i += 1) {
      const name = join(dir, stem + (i === 1 ? ' (edited)' : ' (edited ' + i + ')') + ext)
      try { await fs.access(name) } catch (e) { return name }
    }
    return join(dir, stem + ' (edited ' + randomBytes(3).toString('hex') + ')' + ext)
  }

  /**
   * Writes what the editor returned. `base` is the hash the page was opened on: a different hash on disk is a conflict (409 `changed-on-disk`, nothing written).
   * `mode: 'copy'` writes next to the file under a free name instead and leaves the original alone. The bytes must be a valid file of the same format.
   */
  const save = async (token, data, { base = null, mode = 'overwrite' } = {}) => {
    const t = who(token)
    if (t === null) return refuse(404, 'unknown-token', 'This link has expired: open the file again.')
    // A note may be emptied on purpose: only a Markdown file can be saved with nothing in it.
    if (!Buffer.isBuffer(data) || (data.length === 0 && t.format !== 'md') || data.length > MAX_FILE) return refuse(413, 'bad-size', 'The saved file is empty or larger than 64 MB.')
    const seen = inspect(t.format, data)
    if (!seen.ok) { await bump(t.format, 'refused'); return refuse(422, 'invalid-output', 'The editor returned something that is not a valid ' + t.format + ' file; nothing was written.') }
    if (mode === 'copy') {
      const target = await freeCopyName(t.path)
      await writeAtomic(target, data, null)
      await bump(t.format, 'copies')
      return { ok: true, copy: true, path: target, name: basename(target), hash: sha256(data), size: data.length }
    }
    let current
    try { current = await fs.readFile(t.path) } catch (e) { return refuse(404, 'not-found', 'The file is not there any more.') }
    const nowHash = sha256(current)
    if (base === null || nowHash !== base) { await bump(t.format, 'conflicts'); return refuse(409, 'changed-on-disk', 'The file changed since it was opened.') }
    const st = await fs.stat(t.path).catch(() => null)
    const dir = snapDir(t.path)
    await fs.mkdir(dir, { recursive: true })
    const meta = (await readMeta(t.path)) || { path: t.path, origHash: null }
    try { await fs.access(join(dir, 'orig.bin')) } catch (e) { await fs.writeFile(join(dir, 'orig.bin'), current); meta.origHash = nowHash }
    await fs.writeFile(join(dir, 'prev.bin'), current)
    const savedHash = sha256(data)
    meta.prevHash = nowHash; meta.savedHash = savedHash; meta.path = t.path
    await fs.writeFile(join(dir, 'meta.json'), JSON.stringify(meta))
    await writeAtomic(t.path, data, st === null ? null : st.mode)
    t.hash = savedHash; t.savedHash = savedHash
    await bump(t.format, 'saves')
    return { ok: true, hash: savedHash, size: data.length, undo: true }
  }

  /** Puts the file back as it was before the last save of this editor. Refuses when the file changed since that save, unless `force`. */
  const undo = async (token, { force = false } = {}) => {
    const t = who(token)
    if (t === null) return refuse(404, 'unknown-token', 'This link has expired: open the file again.')
    const m = await readMeta(t.path)
    if (m === null || !(await hasUndo(t.path))) return refuse(404, 'nothing-to-undo', 'There is no save to undo.')
    let current
    try { current = await fs.readFile(t.path) } catch (e) { return refuse(404, 'not-found', 'The file is not there any more.') }
    if (force !== true && sha256(current) !== m.savedHash) { await bump(t.format, 'conflicts'); return refuse(409, 'changed-since', 'The file changed since your last save: restoring would overwrite that change.') }
    const prev = await fs.readFile(join(snapDir(t.path), 'prev.bin'))
    const st = await fs.stat(t.path).catch(() => null)
    await writeAtomic(t.path, prev, st === null ? null : st.mode)
    await fs.rm(join(snapDir(t.path), 'prev.bin'), { force: true })
    m.prevHash = null; m.savedHash = null
    await fs.writeFile(join(snapDir(t.path), 'meta.json'), JSON.stringify(m))
    t.hash = sha256(prev); t.savedHash = null
    await bump(t.format, 'undos')
    return { ok: true, hash: t.hash }
  }

  /** A file of an installed editor, for the sandboxed page: only what the manifest lists, only for a live token, and only if it still hashes to what the manifest says. */
  const serve = async (token, rel) => {
    const t = who(token)
    if (t === null) return refuse(404, 'unknown-token', 'This link has expired.')
    const clean = String(rel || '')
    if (clean.includes('..') || clean.includes('\\') || clean.startsWith('/')) return refuse(404, 'not-found', '')
    const m = await readManifest()
    if (m === null) return refuse(503, 'not-installed', 'The editors are not installed.')
    const editorId = clean.split('/')[0]
    if (clean === editorId + '/index.html' && EDITOR_IDS.includes(editorId) && Array.isArray(m.editors) && m.editors.includes(editorId)) {
      return { ok: true, body: Buffer.from(editorHtml(editorId)), type: TYPES.html }
    }
    const entry = m.files[clean]
    if (entry === undefined) return refuse(404, 'not-found', '')
    let buf
    try { buf = await fs.readFile(join(editors, clean)) } catch (e) { return refuse(404, 'not-found', '') }
    const key = clean + ':' + buf.length
    if (!verified.has(key)) {
      if (sha256(buf) !== entry.sha256) return refuse(500, 'corrupt', 'An editor file does not match its manifest.')
      verified.set(key, true)
    }
    const ext = (clean.split('.').pop() || '').toLowerCase()
    return { ok: true, body: buf, type: TYPES[ext] || 'application/octet-stream' }
  }

  const stats = async () => ({ ...(await loadStats()) })

  return { open, bytes, save, undo, serve, status, stats, who, hasUndo: async (token) => { const t = who(token); return t === null ? false : hasUndo(t.path) } }
}

// The host half of the maquette editor, without the web server: which folders are registered, what a page may read from
// them, how a save lands on disk. Every disk call goes through the injected `fs` (the promises API), so the tests run it on a
// temporary folder and the bundle on the real one. The web layer is routes.mjs.
//
// Rules this file keeps (docs/dev/office-editors-open-save-contract-2026-11-03.md):
//  - the folder on disk is the truth; an unchanged page is never rewritten (maquette-lib.mjs patches by position);
//  - a save is refused, never guessed, when the file changed since the editor read it (hash) or is not valid UTF-8;
//  - a save is atomic (temp file + rename) and undoable: the bytes before it live in DSH_HOME, not in the person's folder;
//  - the page reads only inside a registered folder, by a token only `open` hands out, through a short list of file types.
import { join, resolve, sep, basename, isAbsolute, dirname, extname } from 'node:path'
import { randomBytes } from 'node:crypto'
import { instrument, applyPatches, applyRules, applyStructure, applySrcText, findLiterals, paletteFor, sha1 } from './maquette-lib.mjs'

export const NAME = 'kybernos-maquettes'
export const MAX_FOLDERS = 30
export const MAX_TOKENS = 40
export const TOKEN_TTL_MS = 12 * 3600 * 1000
export const MAX_IMAGE = 8 * 1024 * 1024
export const MAX_FILE = 25 * 1024 * 1024
export const MAX_PATCHES = 500

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8', '.webmanifest': 'application/manifest+json', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.otf': 'font/otf', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
}
const PAGE = /^[A-Za-z0-9_][\w.-]{0,99}\.html?$/
const FILE_NAME = /^[A-Za-z0-9_][\w.-]{0,99}$/
const IMG_NAME = /^images\/[a-z0-9-]+-[0-9a-f]{8}\.(png|jpg|gif|webp)$/
const COUNTERS = ['folders-added', 'opens', 'saves', 'save-refusals', 'conflicts', 'undos', 'resets', 'uploads', 'blocks-added', 'edits-written']

// A page in the sandbox has no origin, so localStorage / sessionStorage throw. This runs before the page's own scripts and gives it
// storage that lives as long as the page does, so a maquette that remembers its theme keeps working in the preview.
export const STORAGE_SHIM = '<script data-ky-shim>try{window.localStorage.getItem("x")}catch(e){var mk=function(){var d={};return{getItem:function(k){return Object.prototype.hasOwnProperty.call(d,k)?d[k]:null},setItem:function(k,v){d[k]=String(v)},removeItem:function(k){delete d[k]},clear:function(){d={}},key:function(i){return Object.keys(d)[i]||null},get length(){return Object.keys(d).length}}};Object.defineProperty(window,"localStorage",{value:mk(),configurable:true});Object.defineProperty(window,"sessionStorage",{value:mk(),configurable:true})}</script>'
/** `html` with the shim at the start of <head> (or <body>, or the very start), so it comes before any script of the page. */
export const withShim = (html) => {
  const m = /<head(\s[^>]*)?>/i.exec(html) || /<body(\s[^>]*)?>/i.exec(html)
  const at = m ? m.index + m[0].length : (/^\s*<!doctype[^>]*>/i.exec(html) || [''])[0].length
  return html.slice(0, at) + STORAGE_SHIM + html.slice(at)
}

const fail = (status, code, why) => ({ ok: false, status, code, why })
const slug = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'maquette'
/** What the bytes are, not what the name says: the four picture types the editor takes. */
export const sniffImage = (b) => (b.length > 12 && b[0] === 0x89 && b.toString('latin1', 1, 4) === 'PNG' ? 'png' : b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff ? 'jpg' : b.toString('latin1', 0, 4) === 'GIF8' ? 'gif' : b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP' ? 'webp' : null)
const inside = (root, p) => p === root || p.startsWith(root.endsWith(sep) ? root : root + sep)

export function createHost ({ fs, home, userHome, log = () => {}, now = Date.now, newToken = () => randomBytes(16).toString('hex') }) {
  const state = join(home, 'kybernos', NAME)
  const foldersFile = join(state, 'folders.json')
  const usageFile = join(state, 'usage.json')
  const snapDir = (id) => join(state, 'snapshots', id)
  const tokens = new Map() // token -> { id, dir, at }
  const locks = new Map() // folder id -> promise chain, so two saves of one folder never interleave

  const readJson = async (file, fallback) => { try { return JSON.parse(await fs.readFile(file, 'utf8')) } catch (e) { return fallback } }
  const writeAtomic = async (file, data) => {
    await fs.mkdir(dirname(file), { recursive: true })
    const tmp = file + '.ky-tmp'
    await fs.writeFile(tmp, data)
    await fs.rename(tmp, file)
  }
  const exists = async (p) => { try { await fs.stat(p); return true } catch (e) { return false } }
  const locked = (id, run) => {
    const prev = locks.get(id) || Promise.resolve()
    const next = prev.catch(() => {}).then(run)
    locks.set(id, next.catch(() => {}))
    return next
  }

  // ── the use counter (docs/dev/skills-vs-plugins.md rule 1): how often each thing happens, kept on disk ──
  let usage = null
  const count = async (name, by = 1) => {
    if (!COUNTERS.includes(name)) return
    try {
      if (usage === null) usage = await readJson(usageFile, {})
      usage[name] = (Number(usage[name]) || 0) + by
      await writeAtomic(usageFile, JSON.stringify(usage))
    } catch (e) { log(`counter ${name}: ${e?.message ?? e}`) }
  }
  const stats = async () => ({ ...(usage === null ? await readJson(usageFile, {}) : usage) })

  // ── registered folders ──────────────────────────────────────────────────────────────────────────────
  const readFolders = async () => { const j = await readJson(foldersFile, {}); return Array.isArray(j.folders) ? j.folders.filter((f) => f && typeof f.id === 'string' && typeof f.dir === 'string') : [] }
  const saveFolders = (folders) => writeAtomic(foldersFile, JSON.stringify({ folders }, null, 2))
  const pagesOf = async (dir) => {
    try { return (await fs.readdir(dir)).filter((n) => PAGE.test(n)).sort((a, b) => (a === 'index.html' ? -1 : b === 'index.html' ? 1 : a.localeCompare(b))).slice(0, 60) } catch (e) { return [] }
  }

  async function list () {
    const out = []
    for (const f of await readFolders()) {
      const pages = await pagesOf(f.dir)
      out.push({ id: f.id, name: f.name, dir: f.dir, pages, missing: pages.length === 0, addedAt: f.addedAt })
    }
    return { ok: true, folders: out }
  }

  /** Register a folder: it must exist, hold a page at its top level, and be none of the places no page of a maquette belongs in. */
  async function add (input) {
    if (typeof input !== 'string' || input.trim() === '' || input.length > 1024 || input.includes('\0')) return fail(400, 'bad-path', 'The folder path is missing or not valid.')
    let p = input.trim()
    if (p === '~' || p.startsWith('~/')) p = join(userHome || '', p.slice(1))
    if (!isAbsolute(p)) return fail(400, 'not-absolute', 'Give the full path of the folder (it starts with / or ~/).')
    let real
    try { real = await fs.realpath(resolve(p)); if (!(await fs.stat(real)).isDirectory()) return fail(400, 'not-a-folder', 'This path is not a folder.') } catch (e) { return fail(404, 'not-found', 'This folder does not exist.') }
    const home0 = userHome ? await fs.realpath(userHome).catch(() => userHome) : null
    if (real === dirname(real) || real === home0) return fail(400, 'too-wide', 'Pick the folder of one maquette, not your home folder or the whole disk.')
    if (inside(state, real) || inside(await fs.realpath(state).catch(() => state), real)) return fail(400, 'too-wide', 'Pick the folder of one maquette, not this plugin\'s own storage.')
    const pages = await pagesOf(real)
    if (pages.length === 0) return fail(400, 'no-page', 'This folder holds no .html page at its top level.')
    const folders = await readFolders()
    const known = folders.find((f) => f.dir === real)
    if (known) return { ok: true, id: known.id, name: known.name, existed: true }
    if (folders.length >= MAX_FOLDERS) return fail(409, 'too-many', `At most ${MAX_FOLDERS} folders; remove one first.`)
    const id = slug(basename(real)) + '-' + sha1(real).slice(0, 6)
    const entry = { id, name: basename(real), dir: real, addedAt: now() }
    await saveFolders([...folders, entry])
    await count('folders-added')
    return { ok: true, id, name: entry.name, existed: false }
  }

  async function remove (id) {
    const folders = await readFolders()
    if (!folders.some((f) => f.id === id)) return fail(404, 'unknown', 'This folder is not registered.')
    await saveFolders(folders.filter((f) => f.id !== id))
    for (const [t, v] of tokens) if (v.id === id) tokens.delete(t)
    await fs.rm(snapDir(id), { recursive: true, force: true }).catch(() => {})
    return { ok: true }
  }

  // ── tokens: the only way a page reaches a folder ────────────────────────────────────────────────────
  async function open (id, file, lang) {
    const f = (await readFolders()).find((x) => x.id === id)
    if (!f) return fail(404, 'unknown', 'This folder is not registered.')
    let real
    try { real = await fs.realpath(f.dir) } catch (e) { return fail(404, 'missing', 'This folder is not on the disk any more.') }
    const pages = await pagesOf(real)
    if (pages.length === 0) return fail(404, 'missing', 'This folder holds no page any more.')
    const page = typeof file === 'string' && pages.includes(file) ? file : pages[0]
    const t = now()
    for (const [k, v] of tokens) if (t - v.at > TOKEN_TTL_MS) tokens.delete(k)
    while (tokens.size >= MAX_TOKENS) tokens.delete(tokens.keys().next().value)
    const token = newToken()
    tokens.set(token, { id, dir: real, at: t, lang: lang === 'fr' ? 'fr' : 'en' })
    await count('opens')
    return { ok: true, token, id, name: f.name, page, pages }
  }
  const who = (token) => {
    const v = typeof token === 'string' ? tokens.get(token) : undefined
    if (!v) return null
    if (now() - v.at > TOKEN_TTL_MS) { tokens.delete(token); return null }
    return v
  }

  // ── reading: what the page may fetch ────────────────────────────────────────────────────────────────
  /** A path inside the folder, or null: no « .. », no hidden file, no backslash, a known type, and still inside after symlinks. */
  async function safePath (v, rel) {
    const parts = String(rel).split('/')
    if (rel === '' || String(rel).length > 300 || String(rel).includes('\\') || String(rel).includes('\0') || parts.some((s) => s === '' || s === '.' || s === '..' || s.startsWith('.') || s.length > 120)) return null
    if (!TYPES[extname(rel).toLowerCase()]) return null
    let real
    try { real = await fs.realpath(join(v.dir, rel)) } catch (e) { return null }
    return inside(v.dir, real) ? real : null
  }

  /** The body of `GET /v/<token>/<rel>`: a page of the folder's top level numbered and with the editor's script tag (so a link from one page to another keeps the editor), any other file as it is. `raw` serves the page as it is too. */
  async function serve (token, rel, { raw = false, base = '' } = {}) {
    const v = who(token)
    if (!v) return fail(404, 'unknown-token', 'This link has expired; open the maquette again.')
    const file = rel === '' ? (await pagesOf(v.dir))[0] : rel
    if (!file) return fail(404, 'not-found', 'Not found.')
    const real = await safePath(v, file)
    if (real === null) return fail(404, 'not-found', 'Not found.')
    let st
    try { st = await fs.stat(real) } catch (e) { return fail(404, 'not-found', 'Not found.') }
    if (!st.isFile() || st.size > MAX_FILE) return fail(404, 'not-found', 'Not found.')
    const type = TYPES[extname(real).toLowerCase()]
    const buf = await fs.readFile(real)
    if (!raw && PAGE.test(file)) {
      const text = buf.toString('utf8')
      if (!Buffer.from(text, 'utf8').equals(buf)) return fail(415, 'not-utf8', 'This page is not valid UTF-8 text; the editor will not open it.')
      const tag = `\n<script src="${base}/__ky/edit.js" data-m="${v.id}" data-file="${file}" data-lang="${v.lang}"></script>\n`
      return { ok: true, type, body: Buffer.from(withShim(instrument(text)) + tag, 'utf8') }
    }
    return { ok: true, type, body: buf }
  }

  // ── writing ─────────────────────────────────────────────────────────────────────────────────────────
  const textOf = async (abs) => {
    const buf = await fs.readFile(abs)
    const text = buf.toString('utf8')
    return Buffer.from(text, 'utf8').equals(buf) ? text : null
  }
  /** The top-level files of one kind in the folder: { name: text }, a file that is not UTF-8 text left out. */
  const textsOf = async (dir, re) => {
    const out = {}
    for (const n of await fs.readdir(dir)) {
      if (!re.test(n) || n.startsWith('.')) continue
      const abs = join(dir, n)
      try { if (!(await fs.stat(abs)).isFile()) continue; const t = await textOf(abs); if (t !== null) out[n] = t } catch (e) { /* unreadable: left out */ }
    }
    return out
  }
  const pageOf = async (v, file) => {
    if (typeof file !== 'string' || !PAGE.test(file)) return null
    const abs = join(v.dir, file)
    try { if (!inside(v.dir, await fs.realpath(abs))) return null; return (await fs.stat(abs)).isFile() ? abs : null } catch (e) { return null }
  }

  async function hash (token, file) {
    const v = who(token)
    if (!v) return fail(404, 'unknown-token', 'This link has expired; open the maquette again.')
    const abs = await pageOf(v, file)
    if (!abs) return fail(404, 'not-found', 'This page is not in the folder.')
    const html = await textOf(abs)
    if (html === null) return fail(415, 'not-utf8', 'This page is not valid UTF-8 text.')
    const css = await textsOf(v.dir, /\.css$/)
    return { ok: true, hash: sha1(html), files: Object.fromEntries(Object.entries(css).map(([n, t]) => [n, sha1(t)])) }
  }

  async function find (token, file, text) {
    const v = who(token)
    if (!v) return fail(404, 'unknown-token', 'This link has expired; open the maquette again.')
    const abs = await pageOf(v, file)
    if (!abs) return fail(404, 'not-found', 'This page is not in the folder.')
    const html = await textOf(abs)
    if (html === null) return fail(415, 'not-utf8', 'This page is not valid UTF-8 text.')
    const hits = findLiterals({ [file]: html, ...(await textsOf(v.dir, /\.(js|json)$/)) }, text)
    return { ok: true, n: hits.length, files: [...new Set(hits.map((h) => h.file))] }
  }

  /** Write `writes` ([abs, before, after]) as one step: temp files first, then renames, the bytes before kept under DSH_HOME. */
  async function commit (v, writes, { first }) {
    const dir = snapDir(v.id)
    await fs.mkdir(dir, { recursive: true })
    for (const n of await fs.readdir(dir)) if (n.endsWith('.prev')) await fs.unlink(join(dir, n)).catch(() => {}) // one level of undo: the last save
    const last = {}
    for (const [abs, before, after] of writes) {
      const name = basename(abs)
      await fs.writeFile(join(dir, name + '.prev'), before)
      if (first.has(name) && !(await exists(join(dir, name + '.orig')))) await fs.writeFile(join(dir, name + '.orig'), before)
      last[name] = { before: sha1(before), after: sha1(after) }
    }
    const tmps = []
    try {
      for (const [abs, , after] of writes) {
        const tmp = abs + '.ky-tmp'
        await fs.writeFile(tmp, after)
        tmps.push(tmp)
        try { await fs.chmod(tmp, (await fs.stat(abs)).mode & 0o777) } catch (e) { /* keep the default mode */ }
      }
    } catch (e) { for (const t of tmps) await fs.unlink(t).catch(() => {}); throw e }
    const done = []
    try {
      for (let i = 0; i < writes.length; i++) { await fs.rename(tmps[i], writes[i][0]); done.push(i) }
    } catch (e) {
      for (const i of done) await fs.writeFile(writes[i][0], writes[i][1]).catch(() => {})
      for (const t of tmps) await fs.unlink(t).catch(() => {})
      throw e
    }
    await writeAtomic(join(dir, 'last.json'), JSON.stringify({ at: now(), page: null, files: last }))
  }

  /** Apply the editor's waiting changes to one page of the folder (and the stylesheets / data files they name). */
  function apply (token, file, body) {
    const v = who(token)
    if (!v) return Promise.resolve(fail(404, 'unknown-token', 'This link has expired; open the maquette again.'))
    return locked(v.id, async () => {
      const abs = await pageOf(v, file)
      if (!abs) return fail(404, 'not-found', 'This page is not in the folder.')
      const b = body && typeof body === 'object' ? body : {}
      const patches = Array.isArray(b.patches) ? b.patches : null
      if (!patches || patches.length === 0 || patches.length > MAX_PATCHES || patches.some((p) => p === null || typeof p !== 'object')) return fail(400, 'bad-patches', 'Nothing to save, or too many changes at once.')
      if (typeof b.baseHash !== 'string') return fail(400, 'bad-body', 'The editor did not say which version of the page it started from.')
      const src = await textOf(abs)
      if (src === null) return fail(415, 'not-utf8', 'This page is not valid UTF-8 text.')
      if (sha1(src) !== b.baseHash) { await count('conflicts'); return fail(409, 'stale', 'The page changed since the editor opened it. Nothing was written; reload the maquette.') }
      const css = await textsOf(v.dir, /\.css$/)
      const baseFiles = b.baseFiles && typeof b.baseFiles === 'object' ? b.baseFiles : {}
      for (const p of patches) if (p.type === 'rule' && p.file && sha1(css[p.file] || '') !== baseFiles[p.file]) { await count('conflicts'); return fail(409, 'stale', `${String(p.file).slice(0, 80)} changed since the editor opened it. Nothing was written; reload the maquette.`) }
      const plain = patches.filter((x) => x.type !== 'rule' && x.type !== 'struct' && x.type !== 'srctext')
      const r1 = applyPatches(src, plain)
      const r2 = applyRules(r1.out, css, patches.filter((x) => x.type === 'rule'))
      const data = await textsOf(v.dir, /\.(js|json)$/)
      const r2b = applySrcText({ [file]: r2.html, ...data }, patches.filter((x) => x.type === 'srctext'))
      r2.html = r2b.files[file]
      r1.errors.push(...r2b.errors); r2.applied.push(...r2b.applied)
      const r3 = applyStructure(r2.html, patches.filter((x) => x.type === 'struct'))
      r2.html = r3.out
      r1.errors.push(...r3.errors); r2.applied.push(...r3.applied)
      const writes = []
      if (r2.html !== src) writes.push([abs, src, r2.html])
      for (const n of Object.keys(css)) if (r2.css[n] !== css[n]) writes.push([join(v.dir, n), css[n], r2.css[n]])
      for (const n of Object.keys(data)) if (r2b.files[n] !== data[n]) writes.push([join(v.dir, n), data[n], r2b.files[n]])
      const errors = [...r1.errors, ...r2.errors]
      if (writes.length === 0) { if (errors.length) await count('save-refusals'); return { ok: true, applied: 0, errors, notes: r3.notes, written: [] } }
      await commit(v, writes, { first: new Set(writes.map(([a]) => basename(a))) })
      await count('saves')
      await count('edits-written', r1.applied.length + r2.applied.length)
      if (errors.length) await count('save-refusals')
      const added = patches.filter((x) => x.type === 'struct' && x.op === 'add').length
      if (added) await count('blocks-added', added)
      log(`saved ${file} of ${v.id}: ${writes.length} file(s), ${errors.length} refused`)
      return { ok: true, applied: r1.applied.length + r2.applied.length, errors, notes: r3.notes, written: writes.map(([f, b0, a0]) => ({ file: basename(f), before: Buffer.byteLength(b0), after: Buffer.byteLength(a0) })) }
    })
  }

  async function lastSave (id) { return readJson(join(snapDir(id), 'last.json'), null) }
  /** What is on disk now, for the files named in `names`: { name: sha1 | null }. */
  const shaNow = async (v, names) => { const out = {}; for (const n of names) out[n] = (await textOf(join(v.dir, n)).catch(() => null)); return Object.fromEntries(Object.entries(out).map(([n, t]) => [n, t === null ? null : sha1(t)])) }

  /** Put back the files as they were before the last save, unless one of them changed since (then nothing moves). */
  function undo (token) {
    const v = who(token)
    if (!v) return Promise.resolve(fail(404, 'unknown-token', 'This link has expired; open the maquette again.'))
    return locked(v.id, async () => {
      const last = await lastSave(v.id)
      if (!last || !last.files || Object.keys(last.files).length === 0) return fail(404, 'no-snapshot', 'There is no save to go back to.')
      const names = Object.keys(last.files).filter((n) => FILE_NAME.test(n))
      const now0 = await shaNow(v, names)
      if (names.some((n) => now0[n] !== last.files[n].after)) return fail(409, 'changed-since', 'A file changed since that save (by you or by Kaby). Nothing was put back.')
      const writes = []
      for (const n of names) writes.push([join(v.dir, n), await fs.readFile(join(v.dir, n)), await fs.readFile(join(snapDir(v.id), n + '.prev'))])
      for (const [abs, , after] of writes) { await fs.writeFile(abs + '.ky-tmp', after); await fs.rename(abs + '.ky-tmp', abs) }
      for (const n of names) await fs.unlink(join(snapDir(v.id), n + '.prev')).catch(() => {})
      await fs.unlink(join(snapDir(v.id), 'last.json')).catch(() => {})
      await count('undos')
      return { ok: true, restored: names.length }
    })
  }

  /** Put every file the editor ever saved back as it was before its first save (the snapshots under DSH_HOME), and drop the pictures it added. */
  function resetOriginal (token, { force = false } = {}) {
    const v = who(token)
    if (!v) return Promise.resolve(fail(404, 'unknown-token', 'This link has expired; open the maquette again.'))
    return locked(v.id, async () => {
      const dir = snapDir(v.id)
      const origs = (await fs.readdir(dir).catch(() => [])).filter((n) => n.endsWith('.orig')).map((n) => n.slice(0, -5)).filter((n) => FILE_NAME.test(n))
      if (origs.length === 0) return fail(404, 'no-snapshot', 'Nothing was saved by the editor, so there is nothing to put back.')
      const last = await lastSave(v.id)
      if (!force && last && last.files) {
        const now0 = await shaNow(v, Object.keys(last.files).filter((n) => FILE_NAME.test(n)))
        if (Object.keys(last.files).some((n) => FILE_NAME.test(n) && now0[n] !== last.files[n].after)) return fail(409, 'changed-since', 'A file changed since the last save (by you or by Kaby). Nothing was put back.')
      }
      for (const n of origs) { const bytes = await fs.readFile(join(dir, n + '.orig')); await fs.writeFile(join(v.dir, n) + '.ky-tmp', bytes); await fs.rename(join(v.dir, n) + '.ky-tmp', join(v.dir, n)) }
      const ups = await readJson(join(dir, 'uploads.json'), { files: [] })
      const pages = await textsOf(v.dir, /\.(html?|css|js|json)$/)
      const used = Object.values(pages).join('\n')
      for (const rel of Array.isArray(ups.files) ? ups.files : []) if (IMG_NAME.test(rel) && !used.includes(rel)) await fs.unlink(join(v.dir, rel)).catch(() => {})
      try { const idir = join(v.dir, 'images'); if (!(await fs.readdir(idir)).length) await fs.rmdir(idir) } catch (e) { /* not there or not empty */ }
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
      await count('resets')
      return { ok: true, restored: origs.length }
    })
  }

  // ── pictures ────────────────────────────────────────────────────────────────────────────────────────
  async function upload (token, buf, filename) {
    const v = who(token)
    if (!v) return fail(404, 'unknown-token', 'This link has expired; open the maquette again.')
    if (!Buffer.isBuffer(buf) || buf.length === 0) return fail(400, 'empty', 'The picture is empty.')
    if (buf.length > MAX_IMAGE) return fail(413, 'too-big', `The picture is larger than ${MAX_IMAGE / 1048576} MB.`)
    const ext = sniffImage(buf)
    if (!ext) return fail(415, 'not-image', 'Only PNG, JPEG, GIF and WebP pictures are accepted.')
    const base = slug(String(filename || 'image').replace(/\.[^.]*$/, '')).slice(0, 40) || 'image'
    const rel = `images/${base}-${sha1(buf.toString('latin1')).slice(0, 8)}.${ext}`
    return locked(v.id, async () => {
      const dest = join(v.dir, rel)
      await fs.mkdir(dirname(dest), { recursive: true })
      const existed = await exists(dest)
      if (!existed) { await fs.writeFile(dest + '.ky-tmp', buf); await fs.rename(dest + '.ky-tmp', dest) }
      const upFile = join(snapDir(v.id), 'uploads.json')
      const ups = await readJson(upFile, { files: [] })
      if (!existed && !ups.files.includes(rel)) await writeAtomic(upFile, JSON.stringify({ files: [...ups.files, rel] }))
      await count('uploads')
      return { ok: true, src: rel, bytes: buf.length, existed }
    })
  }

  /** « Cancel all »: remove the pictures the editor added that no page of the folder uses. */
  function unupload (token, srcs) {
    const v = who(token)
    if (!v) return Promise.resolve(fail(404, 'unknown-token', 'This link has expired; open the maquette again.'))
    return locked(v.id, async () => {
      const used = Object.values(await textsOf(v.dir, /\.(html?|css|js|json)$/)).join('\n')
      const ups = await readJson(join(snapDir(v.id), 'uploads.json'), { files: [] })
      let removed = 0
      for (const rel of Array.isArray(srcs) ? srcs.slice(0, 100) : []) {
        if (typeof rel !== 'string' || !IMG_NAME.test(rel) || !ups.files.includes(rel) || used.includes(rel)) continue // only what the editor put there, and only if nothing uses it
        if (await fs.unlink(join(v.dir, rel)).then(() => true, () => false)) removed++
      }
      try { const idir = join(v.dir, 'images'); if (!(await fs.readdir(idir)).length) await fs.rmdir(idir) } catch (e) { /* not there or not empty */ }
      return { ok: true, removed }
    })
  }

  const blocks = (lang) => ({ ok: true, blocks: paletteFor(lang) })

  return { list, add, remove, open, serve, hash, find, apply, undo, resetOriginal, upload, unupload, blocks, stats, who }
}

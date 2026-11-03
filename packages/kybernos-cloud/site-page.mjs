// The Publish button of Creations: the person clicks, a page goes online at <name>.kaby.app. The click is the person's yes, so nothing asks again here (Kaby's own tool asks first, in its chat:
// site-publish.mjs). This file is what the button's four routes do: say what would be sent (`plan`), send it (`publish`), list the person's pages (`list`) and take one down (`remove`).
// What a page uses is read from the page itself: the files it names (pictures, styles, scripts, other pages of the same folder) are sent with it, and only those, never from outside the folder
// the page is in, never through a link, never a hidden file. Pure: the files, the network and the small memory « this file is that page » are given by `deps`, so it is tested without DSH.
import { lstatSync, readFileSync } from 'node:fs'
import { basename, dirname, extname, isAbsolute, join, posix } from 'node:path'
import { EXTENSIONS, LIMITS, RESERVED, SITES_DOMAIN, fileCheck, slugFor, slugProblem } from './site-publish.mjs'

const PAGE_EXTENSIONS = new Set(['.html', '.htm'])
const SCANNED_EXTENSIONS = new Set(['.html', '.htm', '.css'])
const SKIPPED = new Set(['node_modules', '__pycache__'])
/** A name that is a key, whatever folder it is in (the same rule as the Creations routes' DL-05). */
const SECRET_NAME = /^\.(?:credentials|env|ssh)/iu
const FOREIGN = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/iu
const LEFT_OUT_MAX = 20
/** How long the route waits for the host before it hands the wait back to the page (the server itself waits up to 60 s). */
const BUILDING_ROUNDS = 4
const BUILDING_WAIT_MAX_MS = 3000
const MAP_MAX = 300

const refuse = (error, message, extra) => ({ ok: false, error, message, ...(extra ?? {}) })

/** The references a page or a style sheet makes to other files, as written (an address, a path, never resolved here). */
export function referencesOf (text, kind) {
  const src = String(text ?? '').replace(/<!--[\s\S]*?-->/gu, ' ')
  const out = []
  const add = (v) => { if (typeof v === 'string' && v.trim() !== '') out.push(v.trim()) }
  const grab = (re, many) => { for (const m of src.matchAll(re)) { for (let i = 1; i < m.length; i += 1) { if (m[i] !== undefined) { if (many) m[i].split(',').forEach((part) => add(part.trim().split(/\s+/u)[0])); else add(m[i]) } } } }
  if (kind === 'html') {
    grab(/\b(?:src|href|poster|data-src|data-href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>`]+))/giu, false)
    grab(/\bsrcset\s*=\s*(?:"([^"]*)"|'([^']*)')/giu, true)
  }
  grab(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s'"]+))\s*\)/giu, false)
  grab(/@import\s+(?:"([^"]*)"|'([^']*)')/giu, false)
  return out
}

/** Where a reference points inside the page's own folder: a `/`-separated path, or null when it leaves the folder or is not a file of it (an address on the web, an anchor, a mailto). */
export function insideFolder (ref, fromFile) {
  if (typeof ref !== 'string' || ref === '' || FOREIGN.test(ref) || ref.includes('{{') || ref.includes('${')) return { rel: null, why: 'foreign' }
  let clean = ref.split('#')[0].split('?')[0]
  try { clean = decodeURIComponent(clean) } catch (e) { /* kept as written */ }
  if (clean === '' || clean.includes('\\') || clean.includes('\0')) return { rel: null, why: 'foreign' }
  // `/css/a.css` is the root of the published page, that is the folder of the entry; the others start from the file that names them.
  const joined = clean.startsWith('/') ? posix.normalize(clean.slice(1)) : posix.normalize(posix.join(posix.dirname(fromFile), clean))
  if (joined === '.' || joined === '' || joined.startsWith('../') || joined === '..' || joined.endsWith('/')) return { rel: null, why: joined.startsWith('..') ? 'outside' : 'foreign' }
  return { rel: joined, why: null }
}

const titleOf = (html, entryName) => {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/iu.exec(html)
  const raw = m !== null ? m[1].replace(/<[^>]*>/gu, ' ') : ''
  const text = raw.replace(/&amp;/gu, '&').replace(/&lt;/gu, '<').replace(/&gt;/gu, '>').replace(/&quot;/gu, '"').replace(/&#0*39;/gu, "'").replace(/\s+/gu, ' ').trim().slice(0, 80)
  return text !== '' ? text : basename(entryName, extname(entryName)).replace(/[-_]+/gu, ' ').trim().slice(0, 80)
}

/**
 * The page and what it uses, read from the person's folder. The entry is published as `index.html`; every file it names inside its folder follows at the same relative path, so the links
 * keep working. `fs` is the module's own by default.
 * @returns `{ ok: true, entry, title, files: [{ path, data }], bytes, leftOut: [{ path, why }] }` or `{ ok: false, error, message, largest? }`
 */
export function pageOf (entryPath, fs = { lstatSync, readFileSync }) {
  if (typeof entryPath !== 'string' || !isAbsolute(entryPath) || entryPath.length > 4000) return refuse('invalid_path', 'Give the path of an HTML file.')
  if (!PAGE_EXTENSIONS.has(extname(entryPath).toLowerCase())) return refuse('invalid_path', 'Only an HTML page can be put online.')
  if (entryPath.split('/').some((seg) => SECRET_NAME.test(seg))) return refuse('invalid_path', 'That file is not one a page may come from.')
  const root = dirname(entryPath)
  const statOf = (full) => { try { return fs.lstatSync(full) } catch (e) { return null } }
  const entryStat = statOf(entryPath)
  if (entryStat === null) return refuse('not_found', 'That file does not exist any more.')
  if (entryStat.isSymbolicLink() || !entryStat.isFile()) return refuse('invalid_path', 'A link or a folder is not put online: give the HTML file itself.')
  // A file reached through a link inside the folder is never read: every segment between the folder and the file is looked at.
  const plainFile = (rel) => {
    let at = root
    const segs = rel.split('/')
    for (let i = 0; i < segs.length; i += 1) {
      at = join(at, segs[i])
      const s = statOf(at)
      if (s === null) return { stat: null, full: at }
      if (s.isSymbolicLink()) return { stat: 'link', full: at }
      if (i === segs.length - 1) return { stat: s.isFile() ? s : 'other', full: at }
    }
    return { stat: null, full: at }
  }
  const picked = new Map()
  const leftOut = []
  const left = (path, why) => { if (leftOut.length < LEFT_OUT_MAX && !leftOut.some((l) => l.path === path)) leftOut.push({ path, why }) }
  const queue = [{ rel: basename(entryPath), bundle: 'index.html', full: entryPath, size: entryStat.size }]
  const seenRel = new Set([basename(entryPath)])
  let bytes = 0
  const read = (full) => { try { return fs.readFileSync(full) } catch (e) { return null } }
  let title = ''
  while (queue.length > 0) {
    const cur = queue.shift()
    if (cur.size > LIMITS.fileBytes) return refuse('too_big', `${cur.rel} is over ${LIMITS.fileBytes / 1024 / 1024} MB.`, { largest: [{ path: cur.rel, bytes: cur.size }] })
    const problem = fileCheck(cur.bundle)
    if (problem !== null) return refuse('invalid_files', problem)
    const data = read(cur.full)
    if (data === null) { if (cur.bundle === 'index.html') return refuse('not_found', 'That file could not be read.'); left(cur.rel, 'unreadable'); continue }
    picked.set(cur.bundle, { path: cur.bundle, data })
    bytes += data.length
    if (picked.size > LIMITS.files) return refuse('too_big', `A page may hold ${LIMITS.files} files at most; this one uses more.`)
    const ext = extname(cur.bundle).toLowerCase()
    if (cur.bundle === 'index.html') title = titleOf(data.toString('utf8'), basename(entryPath))
    if (!SCANNED_EXTENSIONS.has(ext)) continue
    const text = data.toString('utf8')
    for (const ref of referencesOf(text, ext === '.css' ? 'css' : 'html')) {
      // What a file names is resolved from the file that names it, in the published page (where the entry is `index.html`).
      const from = insideFolder(ref, cur.bundle)
      if (from.rel === null) { if (from.why === 'outside') left(ref.split('?')[0].split('#')[0], 'outside'); continue }
      const rel = from.rel
      // The entry's own folder is the published root; a name the entry already holds is sent once.
      if (rel === 'index.html' || seenRel.has(rel) || picked.has(rel)) continue
      if (rel.split('/').some((seg) => seg.startsWith('.') || SKIPPED.has(seg))) { left(rel, 'hidden'); continue }
      if (!EXTENSIONS.has(extname(rel).toLowerCase())) { left(rel, 'type'); continue }
      if (rel.length > LIMITS.pathChars) { left(rel, 'type'); continue }
      seenRel.add(rel)
      // The entry is stored under its real name on disk too: a link back to it is the home page.
      const found = plainFile(rel)
      if (found.stat === null) { left(rel, 'missing'); continue }
      if (found.stat === 'link' || found.stat === 'other') { left(rel, 'link'); continue }
      queue.push({ rel, bundle: rel, full: found.full, size: found.stat.size })
    }
  }
  if (bytes > LIMITS.totalBytes) {
    const largest = [...picked.values()].map((f) => ({ path: f.path, bytes: f.data.length })).sort((a, b) => b.bytes - a.bytes).slice(0, 3)
    return refuse('too_big', `A page may weigh ${LIMITS.totalBytes / 1024 / 1024} MB at most; this one is ${(bytes / 1024 / 1024).toFixed(1)} MB.`, { largest, bytes })
  }
  return { ok: true, entry: basename(entryPath), title, files: [...picked.values()], bytes, leftOut }
}

/** What the server's answer means for the button: a code the page words itself, and the numbers it needs. */
export const answerOf = (res) => {
  const status = res !== null && res !== undefined && typeof res.status === 'number' ? res.status : 0
  const body = res !== null && res !== undefined && res.body !== null && typeof res.body === 'object' ? res.body : {}
  const code = typeof body.error === 'string' && /^[a-z_]{3,40}$/u.test(body.error) ? body.error : ''
  if (status === 200 && typeof body.url === 'string' && /^https:\/\/[a-z0-9-]+\.[a-z0-9.-]+\/?$/u.test(body.url)) {
    return { ok: true, url: body.url, slug: typeof body.slug === 'string' ? body.slug : '', updated: body.updated === true, files: Number(body.files) || 0, bytes: Number(body.bytes) || 0 }
  }
  if (status === 202) return { ok: false, error: 'building', retry: true, wait: Math.min(BUILDING_WAIT_MAX_MS, Math.max(1, Number(body.retry_after_seconds) || 2) * 1000) }
  if (code === 'not_connected' || status === 401) return { ok: false, error: 'not_connected' }
  if (status === 0) return { ok: false, error: 'no_answer' }
  const max = typeof body.max === 'number' ? body.max : null
  if (code !== '') return { ok: false, error: code, status, ...(max !== null ? { max } : {}) }
  if (status === 404) return { ok: false, error: 'not_on_this_server', status }
  return { ok: false, error: 'http_' + status, status }
}

/**
 * The button's four actions. deps: `call(method, path, body)` → `{ status, body }` (the person's account; never throws), `map` (`read()` → `{ [path]: slug }`, `set(path, slug)`, `forget(slug)`),
 * `sleep(ms)` (optional), `fs` (optional).
 */
export function createSitePages (deps) {
  const sleep = typeof deps.sleep === 'function' ? deps.sleep : (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const call = async (method, path, body) => { try { return await deps.call(method, path, body) } catch (e) { return { status: 0, body: null } } }
  const mapRead = () => { try { const m = deps.map.read(); return m !== null && typeof m === 'object' ? m : {} } catch (e) { return {} } }

  const list = async () => {
    const res = await call('GET', '/v1/sites')
    if (res.status === 401 || (res.body !== null && typeof res.body === 'object' && res.body.error === 'not_connected')) return { ok: true, connected: false, available: true, sites: [], count: 0 }
    if (res.status === 404) return { ok: true, connected: true, available: false, sites: [], count: 0 }
    if (res.status !== 200 || res.body === null || !Array.isArray(res.body.sites)) return refuse(res.status === 0 ? 'no_answer' : 'http_' + res.status, 'The pages could not be read right now.')
    const byPage = mapRead()
    const pathsOf = (slug) => Object.keys(byPage).filter((p) => byPage[p] === slug)
    const sites = res.body.sites.filter((s) => s !== null && typeof s === 'object' && typeof s.slug === 'string').slice(0, 100).map((s) => ({
      slug: s.slug, url: String(s.url ?? ''), title: String(s.title ?? '').slice(0, 80), state: String(s.state ?? 'live'), updated_at: String(s.updated_at ?? ''), files: Number(s.files) || 0, bytes: Number(s.bytes) || 0, paths: pathsOf(s.slug)
    }))
    return { ok: true, connected: true, available: true, sites, count: sites.filter((s) => s.state !== 'taken_down').length }
  }

  const plan = async (args) => {
    const a = args !== null && typeof args === 'object' ? args : {}
    const page = pageOf(a.path, deps.fs)
    if (page.ok !== true) return page
    const byPage = mapRead()
    const online = typeof byPage[a.path] === 'string' ? byPage[a.path] : null
    const slug = online !== null ? online : slugFor({ title: page.title, path: a.path })
    return { ok: true, entry: page.entry, title: page.title, files: page.files.length, bytes: page.bytes, left_out: page.leftOut, slug, online, domain: SITES_DOMAIN, reserved: [...RESERVED] }
  }

  const publish = async (args) => {
    const a = args !== null && typeof args === 'object' ? args : {}
    const page = pageOf(a.path, deps.fs)
    if (page.ok !== true) return page
    const slug = slugFor({ name: a.name, title: page.title, path: a.path })
    const problem = slugProblem(slug)
    if (problem !== null) return refuse(/reserved/u.test(problem) ? 'reserved_slug' : 'invalid_slug', problem, { slug })
    const title = typeof a.title === 'string' && a.title.trim() !== '' ? a.title.replace(/\s+/gu, ' ').trim().slice(0, 80) : page.title
    const body = { slug, ...(title !== '' ? { title } : {}), files: page.files.map((f) => ({ path: f.path, content_base64: f.data.toString('base64') })) }
    let said = { ok: false, error: 'no_answer' }
    for (let round = 0; round < BUILDING_ROUNDS; round += 1) {
      said = answerOf(await call('POST', '/v1/sites', body))
      if (said.retry !== true) break
      if (round < BUILDING_ROUNDS - 1) await sleep(said.wait)
    }
    if (said.ok !== true) return { ...said, slug }
    try { deps.map.set(a.path, slug) } catch (e) { /* the memory of which file it is only serves the tile's « Online » mark */ }
    return { ...said, slug, left_out: page.leftOut }
  }

  const remove = async (args) => {
    const slug = args !== null && typeof args === 'object' && typeof args.slug === 'string' ? args.slug.trim().toLowerCase() : ''
    if (slugProblem(slug) !== null) return refuse('invalid_slug', 'Give the name of the page to take down.')
    const res = await call('DELETE', '/v1/sites/' + encodeURIComponent(slug))
    if (res.status === 200 || res.status === 404) { try { deps.map.forget(slug) } catch (e) { /* see publish */ } }
    if (res.status === 200) return { ok: true, slug }
    const said = answerOf(res)
    return { ...said, ok: false, slug }
  }

  return { list, plan, publish, remove }
}

/** The small memory « this file is that page »: a private JSON file of the DSH folder, `{ [absolute path]: slug }`, cut to its newest entries. */
export function createPageMap (deps) {
  const read = () => { const m = deps.readJson(deps.file()); return m !== null && typeof m === 'object' && !Array.isArray(m) ? m : {} }
  return {
    read,
    set (path, slug) {
      const m = read()
      delete m[path]
      m[path] = slug
      const keys = Object.keys(m)
      for (const k of keys.slice(0, Math.max(0, keys.length - MAP_MAX))) delete m[k]
      deps.writeJson(deps.file(), m)
    },
    forget (slug) {
      const m = read()
      let changed = false
      for (const k of Object.keys(m)) { if (m[k] === slug) { delete m[k]; changed = true } }
      if (changed) deps.writeJson(deps.file(), m)
    }
  }
}

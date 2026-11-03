// Kaby puts a page online: `site_publish` sends a static page (one file or one folder) to the server, which has it hosted at `<name>.kaby.app` (docs/dev/site-publish-contract.md).
// Before this, nothing could: a cloud computer's public host is the DSH gate only, and Kaby improvised tunnels that were refused (measured on WhatsApp, 2026-11-03). The server owns the
// hosting; this file owns what a person's computer may send (a bundle, bounded and boring) and what Kaby is told back, in one plain sentence. Pure: the files, the network and the
// folder rules are given by `deps`, so the tools are tested without DSH and without a server.
import { lstatSync, readFileSync, readdirSync } from 'node:fs'
import { basename, dirname, extname, isAbsolute, join, sep } from 'node:path'
import { dataLine } from './kyby-identity.mjs'

/** The domain the server publishes under (`SITES_DOMAIN`); it is only used to say the address in a question, the server's answer carries the real one. */
export const SITES_DOMAIN = 'kaby.app'
/** What a bundle may hold. The server checks the same and decides; sending less than it would refuse spares a long upload. */
export const LIMITS = Object.freeze({ files: 50, fileBytes: 2 * 1024 * 1024, totalBytes: 4 * 1024 * 1024, pathChars: 120 })
export const EXTENSIONS = new Set(['.html', '.htm', '.css', '.js', '.mjs', '.json', '.txt', '.xml', '.svg', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.ico', '.woff', '.woff2', '.webmanifest'])
export const RESERVED = new Set(['www', 'api', 'app', 'kaby', 'kybernos', 'admin', 'mail', 'static', 'help', 'skills', 'dev', 'staging', 'links', 'links-test', 'assets', 'cdn', 'status', 'docs', 'blog'])
const SLUG = /^[a-z0-9](?:[a-z0-9-]{1,30})[a-z0-9]$/u
const SKIPPED_FOLDERS = new Set(['node_modules', '__pycache__'])

/** A name for a page: what a person said, or what the folder is called, as a `[a-z0-9-]` label. Empty when nothing usable is left. */
export const slugOf = (raw) => String(raw ?? '')
  .normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase()
  .replace(/[^a-z0-9]+/gu, '-').replace(/^-+|-+$/gu, '').replace(/-{2,}/gu, '-').slice(0, 32).replace(/-+$/u, '')

/** Why a name cannot be used, in a sentence, or null. */
export const slugProblem = (slug) => {
  if (typeof slug !== 'string' || !SLUG.test(slug) || slug.includes('--')) return 'A name is 3 to 32 letters, digits or hyphens, with no hyphen at the start or the end.'
  if (RESERVED.has(slug) || slug.startsWith('kb-')) return `"${slug}" is reserved: another name, please.`
  return null
}

/** The name a page gets: the one given, else the title, else the folder (or, for an index.html, the folder it is in). The question to the person and the tool both go through here. */
export const slugFor = (args) => {
  const a = args !== null && typeof args === 'object' ? args : {}
  const given = typeof a.name === 'string' ? a.name.trim().toLowerCase() : ''
  if (given !== '') return given
  const title = typeof a.title === 'string' ? a.title.replace(/\s+/gu, ' ').trim().slice(0, 80) : ''
  if (title !== '') return slugOf(title)
  if (typeof a.path !== 'string') return ''
  const base = basename(a.path, extname(a.path))
  return slugOf(base === 'index' ? basename(dirname(a.path)) : base)
}

const refuse = (error, message) => ({ ok: false, error, message })
const fileCheck = (rel) => {
  if (rel.length > LIMITS.pathChars) return `The path ${dataLine(rel, 60)} is longer than ${LIMITS.pathChars} characters.`
  if (!EXTENSIONS.has(extname(rel).toLowerCase())) return `${dataLine(rel, 60)} is not a kind of file a page may hold (html, css, js, images, fonts, json, text).`
  return null
}

/**
 * The bundle of a page: a file (published as `index.html`) or a folder with an `index.html` at its root. Symbolic links are never followed, hidden files and `node_modules` are left out
 * of a folder (a hidden file named on purpose is refused above), and the limits are the server's. `fs` is the module's own by default.
 * @returns `{ ok: true, files: [{ path, content_base64 }], bytes }` or `{ ok: false, error, message }`
 */
export function bundleOf (path, fs = { lstatSync, readFileSync, readdirSync }) {
  if (typeof path !== 'string' || !isAbsolute(path)) return refuse('invalid_path', 'Give the absolute path of the page: a file (index.html) or its folder.')
  let stat
  try { stat = fs.lstatSync(path) } catch (e) { return refuse('not_found', 'That path does not exist.') }
  if (stat.isSymbolicLink()) return refuse('invalid_path', 'A link is not followed: give the real path of the page.')
  const picked = []
  const walk = (dir, prefix) => {
    let names
    try { names = fs.readdirSync(dir) } catch (e) { return }
    for (const name of names.sort()) {
      if (name.startsWith('.') || SKIPPED_FOLDERS.has(name)) continue
      const full = join(dir, name)
      let s
      try { s = fs.lstatSync(full) } catch (e) { continue }
      if (s.isSymbolicLink()) continue
      const rel = prefix === '' ? name : prefix + '/' + name
      if (s.isDirectory()) walk(full, rel)
      else if (s.isFile()) picked.push({ rel, full, size: s.size })
    }
  }
  if (stat.isFile()) {
    if (!['.html', '.htm'].includes(extname(path).toLowerCase())) return refuse('invalid_path', 'A single file must be an HTML page.')
    picked.push({ rel: 'index.html', full: path, size: stat.size })
  } else if (stat.isDirectory()) walk(path, '')
  else return refuse('invalid_path', 'That path is neither a file nor a folder.')
  if (picked.length === 0) return refuse('invalid_files', 'There is nothing to publish there.')
  if (!picked.some((f) => f.rel === 'index.html')) return refuse('invalid_files', 'A page needs an index.html at the root of its folder.')
  if (picked.length > LIMITS.files) return refuse('too_big', `A page may hold ${LIMITS.files} files at most; this one holds ${picked.length}.`)
  let bytes = 0
  for (const f of picked) {
    const problem = fileCheck(f.rel)
    if (problem !== null) return refuse('invalid_files', problem)
    if (f.size > LIMITS.fileBytes) return refuse('too_big', `${dataLine(f.rel, 60)} is over ${LIMITS.fileBytes / 1024 / 1024} MB.`)
    bytes += f.size
  }
  if (bytes > LIMITS.totalBytes) return refuse('too_big', `A page may weigh ${LIMITS.totalBytes / 1024 / 1024} MB at most; this one is ${(bytes / 1024 / 1024).toFixed(1)} MB.`)
  const files = []
  for (const f of picked) {
    let data
    try { data = fs.readFileSync(f.full) } catch (e) { return refuse('invalid_files', `${dataLine(f.rel, 60)} could not be read.`) }
    files.push({ path: f.rel, content_base64: Buffer.from(data).toString('base64') })
  }
  return { ok: true, files, bytes }
}

/** What the server's answer means for Kaby, as one sentence it can pass on. */
export const sayAnswer = (res, slug) => {
  const status = res !== null && res !== undefined && typeof res.status === 'number' ? res.status : 0
  const body = res !== null && res !== undefined && res.body !== null && typeof res.body === 'object' ? res.body : {}
  const code = typeof body.error === 'string' && /^[a-z_]{3,40}$/u.test(body.error) ? body.error : ''
  if (status === 200 && typeof body.url === 'string' && /^https:\/\/[a-z0-9-]+\.[a-z0-9.-]+\/?$/u.test(body.url)) {
    return { ok: true, text: (body.updated === true ? 'The page is updated: ' : 'The page is online: ') + body.url }
  }
  // Our own codes, said by the host before any call: this body cannot ask the person, or is not signed in.
  if (code === 'not_asked_here') return { ok: false, text: 'A page is put online from Kaby\'s chat or from the phone, where the person is asked first. Say so; do not look for another way.' }
  if (code === 'not_connected') return { ok: false, text: 'This computer is not signed in to a Kybernos account, so it cannot put a page online. Say so in one line.' }
  if (status === 0 && code === '') return { ok: false, text: 'The Kybernos server did not answer. Say so, and try again in a minute.' }
  if (status === 202) return { ok: false, retry: true, text: 'The page is still being put online. Call again in a few seconds with the same name; it is the same publication, not a second one.' }
  if (status === 404 || code === 'not_found') return { ok: false, text: 'Putting a page online is not available on this server yet. Say so, and say where the file is.' }
  if (status === 401 || status === 403) return { ok: false, text: 'This account cannot publish a page from here (' + (code || 'refused') + '). Say so in one line.' }
  const sentences = {
    invalid_slug: slugProblem(slug) ?? 'That name is not allowed.',
    reserved_slug: `"${slug}" is reserved: propose another name.`,
    slug_taken: `"${slug}" is already used by someone else: propose another name.`,
    too_many_sites: 'The person has reached the number of pages their plan allows: they can take one down first, or you can update one of their existing pages.',
    too_big: 'The page is too big for the server: shrink the images or remove files.',
    invalid_files: 'The server refused some of the files: ' + dataLine(typeof body.message === 'string' ? body.message : '', 200),
    rate_limited: 'Too many publications in a minute: wait a moment, then try again.',
    host_error: 'The hosting did not answer. Try again in a minute.'
  }
  if (sentences[code] !== undefined) return { ok: false, text: sentences[code] }
  return { ok: false, text: 'The page could not be put online (' + (code !== '' ? code : 'http ' + status) + '). Say so in one line; do not look for another way.' }
}

const out = (value) => ({
  schema: { type: 'object', additionalProperties: true, properties: { ok: { type: 'boolean' }, text: { type: 'string' } }, required: ['ok', 'text'] },
  render: (args, v) => [{ type: 'text', text: String(v.text) }]
})

/**
 * The tools. deps: `publish(body, exec)` → `{ status, body }` (the host picks the person's account or the cloud computer's own route and never throws), `list()` and `remove(slug, exec)` → the same
 * shape, or null when this body cannot (a cloud computer; absent is the same), `fs` (optional).
 */
export function createSiteTools (deps) {
  const publish = {
    name: 'site_publish',
    description: `Puts a static page online at https://<name>.${SITES_DOMAIN} and returns the link. \`path\` is the ABSOLUTE path of an index.html or of a folder that holds one (html, css, js, images, fonts: at most ${LIMITS.files} files, ${LIMITS.totalBytes / 1024 / 1024} MB). \`name\` is the short name of the page (letters, digits, hyphens); with none it comes from \`title\` or the folder. The person is asked first, in the chat, because it makes the page public. Publishing the same name again replaces the page.`,
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        path: { type: 'string', description: 'Absolute path of index.html or of the folder that holds it.' },
        name: { type: 'string', description: 'The address label, for example pizzaone for pizzaone.' + SITES_DOMAIN },
        title: { type: 'string', description: 'The title of the page, for the person\'s list (80 characters at most).' }
      },
      required: ['path']
    },
    output: out(),
    async execute (args, exec) {
      const a = args !== null && typeof args === 'object' ? args : {}
      const bundle = bundleOf(a.path, deps.fs)
      if (bundle.ok !== true) return { ok: false, text: bundle.message }
      const title = typeof a.title === 'string' ? a.title.replace(/\s+/gu, ' ').trim().slice(0, 80) : ''
      const slug = slugFor(a)
      const problem = slugProblem(slug)
      if (problem !== null) return { ok: false, text: problem + ' Ask the person for a name.' }
      let res
      try { res = await deps.publish({ slug, ...(title !== '' ? { title } : {}), files: bundle.files }, exec) } catch (e) { res = { status: 0, body: null } }
      const said = sayAnswer(res, slug)
      return said.ok === true ? { ok: true, text: said.text } : { ok: false, text: said.text }
    }
  }
  const list = {
    name: 'site_list',
    description: 'Lists the pages the person has put online (name, link, date). Changes nothing.',
    parameters: { type: 'object', additionalProperties: false, properties: {} },
    output: out(),
    async execute () {
      let res
      try { res = typeof deps.list === 'function' ? await deps.list() : null } catch (e) { res = { status: 0, body: null } }
      if (res === null) return { ok: false, text: 'The list of pages is not readable from a cloud computer: the person sees it in the Kybernos app.' }
      const rows = res !== null && res !== undefined && res.status === 200 && res.body !== null && Array.isArray(res.body.sites) ? res.body.sites.filter((s) => s !== null && typeof s === 'object') : null
      if (rows === null) return { ok: false, text: 'The pages could not be read right now.' }
      if (rows.length === 0) return { ok: true, text: 'No page is online yet.' }
      return { ok: true, text: rows.slice(0, 20).map((s) => `${dataLine(s.url, 80)}${typeof s.title === 'string' && s.title !== '' ? ' — ' + dataLine(s.title, 60) : ''} (${dataLine(s.state || 'live', 20)})`).join('\n') }
    }
  }
  const remove = {
    name: 'site_remove',
    description: 'Takes one of the person\'s pages down and frees its name. The person is asked first. Use it only when they ask for it.',
    parameters: { type: 'object', additionalProperties: false, properties: { name: { type: 'string', description: 'The name of the page.' } }, required: ['name'] },
    output: out(),
    async execute (args, exec) {
      const slug = args !== null && typeof args === 'object' && typeof args.name === 'string' ? args.name.trim().toLowerCase() : ''
      if (slugProblem(slug) !== null) return { ok: false, text: 'Give the name of the page to take down.' }
      let res
      try { res = typeof deps.remove === 'function' ? await deps.remove(slug, exec) : null } catch (e) { res = { status: 0, body: null } }
      if (res === null) return { ok: false, text: 'A page cannot be taken down from a cloud computer: the person does it in the Kybernos app.' }
      if (res !== null && res !== undefined && res.status === 200) return { ok: true, text: `The page ${slug}.${SITES_DOMAIN} is taken down.` }
      if (res !== null && res !== undefined && res.status === 404) return { ok: false, text: `The person has no page called "${slug}".` }
      const own = res !== null && res !== undefined && res.body !== null && typeof res.body === 'object' ? res.body.error : ''
      return { ok: false, text: own === 'not_asked_here' || own === 'not_connected' ? sayAnswer(res, slug).text : 'The page could not be taken down right now.' }
    }
  }
  return [publish, list, remove]
}

/** What a person reads when the gate asks about these tools. Never the files: the address, then where it comes from. */
export const siteShown = (name, args) => {
  const a = args !== null && typeof args === 'object' ? args : {}
  if (name === 'site_remove') return `Take down the page ${dataLine(a.name, 40)}.${SITES_DOMAIN}`
  const slug = slugFor(a)
  const from = typeof a.path === 'string' ? ' (from ' + dataLine(a.path.split(sep).slice(-2).join('/'), 60) + ')' : ''
  return `Publish a page on the internet at ${slug === '' ? '…' : dataLine(slug, 40)}.${SITES_DOMAIN}${from}`
}

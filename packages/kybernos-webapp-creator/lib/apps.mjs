// apps.mjs — pure helpers of the Webapp Creator: slug rules, app discovery, scaffolding.
//
// An app is one folder under the person's kybers root (`~/.dsh/kybers/<slug>/`) that carries a
// `webapp.json` brief. The folder name IS the slug. Discovery is tolerant by design: a folder
// without a brief is not an app, and a broken brief is skipped and reported, never thrown.
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const WEBAPP_JSON_MAX = 64 * 1024
export const RESERVED_SLUGS = ['www', 'api', 'app', 'kaby', 'admin', 'mail', 'static', 'help', 'skills', 'me', 'dashboard', 'login']
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/

/** One lower-case label, 32 characters at most, no reserved word. */
export function validateSlug (slug) {
  if (typeof slug !== 'string' || slug === '') return { ok: false, error: 'slug is required' }
  if (slug.length > 32) return { ok: false, error: 'slug is too long (32 characters at most)' }
  if (SLUG_RE.test(slug) !== true) return { ok: false, error: 'slug: one lower-case label, letters, digits and inner hyphens' }
  if (RESERVED_SLUGS.indexOf(slug) >= 0) return { ok: false, error: 'slug is a reserved word' }
  return { ok: true }
}

export const appsRoot = () => join(homedir(), '.dsh', 'kybers')

/** Bounded read of one webapp.json. Returns { ok, app } or { ok: false, error }. */
export function readWebappJson (dir) {
  const file = join(dir, 'webapp.json')
  try {
    if (existsSync(file) !== true) return { ok: false, error: 'no webapp.json' }
    if (statSync(file).size > WEBAPP_JSON_MAX) return { ok: false, error: 'webapp.json is too large' }
    const brut = JSON.parse(readFileSync(file, 'utf8'))
    if (brut === null || typeof brut !== 'object' || Array.isArray(brut)) return { ok: false, error: 'webapp.json is not an object' }
    return { ok: true, app: normaliser(brut, dir) }
  } catch (e) {
    return { ok: false, error: 'webapp.json does not parse: ' + String(e && e.message || e).slice(0, 120) }
  }
}

const chaine = (v, repli) => (typeof v === 'string' && v.trim() !== '' ? v.trim().slice(0, 200) : repli)

const normaliser = (brut, dir) => ({
  nom: chaine(brut.nom, chaine(brut.slug, 'webapp')),
  slug: chaine(brut.slug, ''),
  pages: Array.isArray(brut.pages) ? brut.pages.slice(0, 20).map((p) => chaine(p, '')).filter((p) => p !== '') : [],
  acces: brut.acces === 'public' ? 'public' : 'cle',
  donnees: brut.donnees === 'none' ? 'none' : 'personnel',
  dir,
})

/** Every app of the root: { apps, problemes }. A problem is a folder that looks like an app but cannot be read. */
export function discoverApps (root = appsRoot()) {
  const apps = []
  const problemes = []
  let entrees = []
  try { entrees = readdirSync(root, { withFileTypes: true }) } catch (e) { return { apps, problemes: ['root unreadable: ' + String(e && e.message || e).slice(0, 120)] } }
  for (const e of entrees) {
    if (e.isDirectory() !== true) continue
    const dir = join(root, e.name)
    if (existsSync(join(dir, 'webapp.json')) !== true) continue
    const lu = readWebappJson(dir)
    if (lu.ok !== true) { problemes.push(e.name + ': ' + lu.error); continue }
    const verdict = validateSlug(lu.app.slug)
    if (verdict.ok !== true) { problemes.push(e.name + ': ' + verdict.error); continue }
    apps.push(lu.app)
  }
  apps.sort((a, b) => (a.nom < b.nom ? -1 : a.nom > b.nom ? 1 : 0))
  return { apps, problemes }
}

export function findApp (slug, root = appsRoot()) {
  const { apps, problemes } = discoverApps(root)
  return { app: apps.find((a) => a.slug === slug) ?? null, problemes }
}

/**
 * Scaffold one app folder: `<root>/<slug>/webapp.json`. The mini base, the mockup and the code are
 * the skills' work (webapp-build), not this function's: it only claims the slug and writes the brief.
 */
export function scaffoldApp (root, { nom, slug }) {
  const verdict = validateSlug(slug)
  if (verdict.ok !== true) return { ok: false, error: verdict.error }
  const dir = join(root, slug)
  try {
    if (existsSync(dir) === true) return { ok: false, error: 'this slug already has a folder' }
    mkdirSync(dir, { recursive: true })
    const brief = {
      version: 1,
      nom: chaine(nom, slug),
      slug,
      pages: [],
      entites: [],
      style: {},
      acces: 'cle',
      donnees: 'personnel',
      cree_le: new Date().toISOString(),
    }
    writeFileSync(join(dir, 'webapp.json'), JSON.stringify(brief, null, 2) + '\n')
    return { ok: true, dir, app: normaliser(brief, dir) }
  } catch (e) {
    return { ok: false, error: 'scaffold failed: ' + String(e && e.message || e).slice(0, 120) }
  }
}

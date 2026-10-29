// templates.mjs — the stack catalog. A template is a folder of starter files copied into a new app
// folder; presets compose (the commerce preset overlays the web template, later modules win). The
// app contract (webapp.json + server.js + the mini base) never changes with the stack. Rule of the
// adversarial review (2026-10-27): every stack passes the same conformance suite — scaffold, boot
// through the real runtime, serve, stop — or it does not enter the catalog.
import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ICI = dirname(fileURLToPath(import.meta.url))
export const TEMPLATES_DIR = join(ICI, '..', 'templates')

/** The catalog: stack id -> what it is for. A preset names its bases in BASES (composition). */
export const STACKS = {
  statique: { titre: 'Static site', pour: 'landing page, vitrine — no database, no admin' },
  web: { titre: 'Web app', pour: 'CRUD, dashboard — mini base + API' },
  commerce: { titre: 'E-commerce', pour: 'boutique : produits, panier, commandes — preset on top of web' },
}
const BASES = { commerce: ['web'] }

export const DEFAULT_STACK = 'web'

const chaineDe = (id) => (BASES[id] === undefined ? [id] : BASES[id].concat([id]))

export function listTemplates () {
  return Object.keys(STACKS).map((id) => ({
    id,
    titre: STACKS[id].titre,
    pour: STACKS[id].pour,
    dispo: chaineDe(id).every((m) => existsSync(join(TEMPLATES_DIR, m)) === true),
  }))
}

/** Copy the starter files of one stack (and its bases) into a fresh app folder. The brief stays. */
export function scaffoldFromTemplate (dir, stack) {
  const id = typeof stack === 'string' && stack !== '' ? stack : DEFAULT_STACK
  if (Object.prototype.hasOwnProperty.call(STACKS, id) !== true) {
    return { ok: false, error: 'unknown stack: ' + String(id).slice(0, 40) + ' (known: ' + Object.keys(STACKS).join(', ') + ')' }
  }
  const modules = chaineDe(id)
  if (modules.some((m) => existsSync(join(TEMPLATES_DIR, m)) !== true) === true) return { ok: false, error: 'template folder missing: ' + id }
  try {
    mkdirSync(dir, { recursive: true })
    const files = []
    for (const m of modules) {
      cpSync(join(TEMPLATES_DIR, m), dir, { recursive: true, errorOnExist: false, force: true })
      files.push(...readdirSync(join(TEMPLATES_DIR, m)))
    }
    return { ok: true, stack: id, files }
  } catch (e) {
    return { ok: false, error: 'template copy failed: ' + String((e && e.message) || e).slice(0, 120) }
  }
}

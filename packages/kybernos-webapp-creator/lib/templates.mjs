// templates.mjs — the stack catalog. A template is a folder of starter files copied into a new app
// folder; the app contract (webapp.json + server.js + the mini base) never changes with the stack.
// Rule of the adversarial review (2026-10-27): every stack must pass the same conformance suite —
// scaffold, boot through the real runtime, serve, stop — or it does not enter the catalog.
import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ICI = dirname(fileURLToPath(import.meta.url))
export const TEMPLATES_DIR = join(ICI, '..', 'templates')

/** The catalog: stack id -> what it is for. The brief picks one; the person confirms in a word. */
export const STACKS = {
  statique: { titre: 'Static site', pour: 'landing page, vitrine — no database, no admin' },
  web: { titre: 'Web app', pour: 'CRUD, dashboard, commerce — mini base + API + admin to come' },
}

export const DEFAULT_STACK = 'web'

export function listTemplates () {
  const connues = Object.keys(STACKS)
  const presentes = []
  try {
    for (const nom of readdirSync(TEMPLATES_DIR)) {
      if (existsSync(join(TEMPLATES_DIR, nom, 'server.js')) === true) presentes.push(nom)
    }
  } catch (e) { /* absent catalog: listed below as unknown */ }
  return connues.map((id) => ({ id, titre: STACKS[id].titre, pour: STACKS[id].pour, dispo: presentes.indexOf(id) >= 0 }))
}

/** Copy the starter files of one stack into a fresh app folder. The brief (webapp.json) stays. */
export function scaffoldFromTemplate (dir, stack) {
  const id = typeof stack === 'string' && stack !== '' ? stack : DEFAULT_STACK
  const src = join(TEMPLATES_DIR, id)
  if (Object.prototype.hasOwnProperty.call(STACKS, id) !== true) {
    return { ok: false, error: 'unknown stack: ' + String(id).slice(0, 40) + ' (known: ' + Object.keys(STACKS).join(', ') + ')' }
  }
  if (existsSync(src) !== true) return { ok: false, error: 'template folder missing: ' + id }
  try {
    mkdirSync(dir, { recursive: true })
    cpSync(src, dir, { recursive: true, errorOnExist: false, force: false })
    return { ok: true, stack: id, files: readdirSync(src) }
  } catch (e) {
    return { ok: false, error: 'template copy failed: ' + String((e && e.message) || e).slice(0, 120) }
  }
}

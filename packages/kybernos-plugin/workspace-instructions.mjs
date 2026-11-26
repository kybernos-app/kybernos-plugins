// Workspace instructions: a text the person sets for a workspace, sent with the prompt of the sessions of that workspace.
//
//  - Stored PRIVATELY on this machine: <DSH home>/kybernos/workspace-instructions.json (0600), keyed by the workspace id.
//  - Injected through the `systemPrompt.context` seam (no engine patch): the session's workspace is found in DSH's own workspace table
//    (<DSH home>/storages/workspace.json: `tables.workspaces[id] = { path, title, sessionIds }`), never from the request.
//  - Optional: also written as a MARKED section of <workspace folder>/AGENTS.md, so whoever opens the folder shares them. The folder
//    comes from DSH's table too, so a request cannot make this write anywhere else.
//  - Precedence: the account instructions come first, then these, then the team mission: the block says it is more specific.
//
// Everything is synchronous and guarded: a missing or broken file is « no instructions », never an error in a turn.
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const MAX_CHARS = 4000
export const BEGIN = '<!-- kybernos:workspace-instructions:begin (managed by Kybernos: edit it from the workspace page) -->'
export const END = '<!-- kybernos:workspace-instructions:end -->'

/** The text as it is stored: no NUL, LF line ends, trimmed. `null` when it is not a string. */
export function cleanText (v) {
  if (typeof v !== 'string') return null
  return v.replace(/\u0000/g, '').replace(/\r\n?/g, '\n').trim()
}

/** Inserts, replaces or removes the marked section of an AGENTS.md. An empty `text` removes it. */
export function withSection (markdown, text) {
  const src = typeof markdown === 'string' ? markdown : ''
  const a = src.indexOf(BEGIN)
  const b = a >= 0 ? src.indexOf(END, a) : -1
  const without = a >= 0 && b >= 0 ? (src.slice(0, a).replace(/\n+$/, '') + '\n' + src.slice(b + END.length).replace(/^\n+/, '')).replace(/^\n+|\n+$/g, '') : src.replace(/\n+$/, '')
  if (text === '') return without === '' ? '' : without + '\n'
  const block = BEGIN + '\n## Workspace instructions\n\n' + text + '\n' + END
  return (without === '' ? block : without + '\n\n' + block) + '\n'
}

/** The block the model reads. `{{` is broken with a zero-width space: the system prompt interpolates `{{name}}` and an unresolved one fails the assembly. */
export function renderBlock (title, text) {
  const safe = String(text).replace(/\{\{/g, '{​{')
  return 'Workspace instructions, set by the person for the workspace "' + String(title).replace(/"/g, "'") + '". They work alongside the account instructions and the selected style; where they differ, these are more specific and take precedence.\n\n' + safe
}

/** The workspace (id) that holds a session, from DSH's workspace table. */
export function workspaceOfSession (table, sessionId) {
  if (table === null || typeof table !== 'object' || typeof sessionId !== 'string' || sessionId === '') return null
  for (const [id, w] of Object.entries(table)) {
    if (w !== null && typeof w === 'object' && Array.isArray(w.sessionIds) && w.sessionIds.indexOf(sessionId) >= 0) return id
  }
  return null
}

export function createWorkspaceInstructions ({ home, now = () => Date.now() }) {
  const wsFile = join(home, 'storages', 'workspace.json')
  const storeFile = join(home, 'kybernos', 'workspace-instructions.json')
  let wsCache = { mtime: -1, table: {} }
  let storeCache = { mtime: -1, items: {} }

  const workspaces = () => {
    try {
      const m = statSync(wsFile).mtimeMs
      if (m === wsCache.mtime) return wsCache.table
      const j = JSON.parse(readFileSync(wsFile, 'utf8'))
      const t = j !== null && typeof j === 'object' && j.tables !== null && typeof j.tables === 'object' && j.tables.workspaces !== null && typeof j.tables.workspaces === 'object' ? j.tables.workspaces : {}
      wsCache = { mtime: m, table: t }
      return t
    } catch (e) { return wsCache.table }
  }
  const items = () => {
    try {
      const m = statSync(storeFile).mtimeMs
      if (m === storeCache.mtime) return storeCache.items
      const j = JSON.parse(readFileSync(storeFile, 'utf8'))
      const it = j !== null && typeof j === 'object' && j.items !== null && typeof j.items === 'object' ? j.items : {}
      storeCache = { mtime: m, items: it }
      return it
    } catch (e) { return storeCache.mtime === -1 ? {} : storeCache.items }
  }
  const write = (obj) => {
    mkdirSync(dirname(storeFile), { recursive: true })
    const tmp = storeFile + '.tmp-' + process.pid
    writeFileSync(tmp, JSON.stringify({ v: 1, items: obj }, null, 2) + '\n', { mode: 0o600 })
    renameSync(tmp, storeFile)
    storeCache = { mtime: -1, items: {} }
  }

  const known = (id) => (typeof id === 'string' && Object.prototype.hasOwnProperty.call(workspaces(), id) ? workspaces()[id] : null)

  /** AGENTS.md of the workspace folder: the marked section follows `text` (removed when empty or when the option is off). */
  const syncAgents = (folder, text) => {
    if (typeof folder !== 'string' || folder === '') return { ok: false, error: 'no-folder' }
    let st = null
    try { st = statSync(folder) } catch (e) { st = null }
    if (st === null || st.isDirectory() !== true) return { ok: false, error: 'folder-missing' }
    const file = join(folder, 'AGENTS.md')
    let current = ''
    try { current = readFileSync(file, 'utf8') } catch (e) { current = '' }
    if (text === '' && current.indexOf(BEGIN) < 0) return { ok: true, changed: false }
    const next = withSection(current, text)
    if (next === current) return { ok: true, changed: false }
    try {
      if (next === '' && existsSync(file)) unlinkSync(file)
      else writeFileSync(file, next)
    } catch (e) { return { ok: false, error: 'agents-write-failed' } }
    return { ok: true, changed: true }
  }

  return {
    get (workspaceId) {
      const w = known(workspaceId)
      if (w === null) return { ok: false, error: 'unknown-workspace' }
      const it = items()[workspaceId]
      return {
        ok: true, workspaceId, title: typeof w.title === 'string' ? w.title : '', folder: typeof w.path === 'string' ? w.path : '',
        text: it !== undefined && typeof it.text === 'string' ? it.text : '', alsoAgents: it !== undefined && it.alsoAgents === true,
        updatedAt: it !== undefined && typeof it.updatedAt === 'number' ? it.updatedAt : null, max: MAX_CHARS
      }
    },
    set ({ workspaceId, text, alsoAgents }) {
      const w = known(workspaceId)
      if (w === null) return { ok: false, error: 'unknown-workspace' }
      const t = cleanText(text)
      if (t === null) return { ok: false, error: 'bad-text' }
      if (t.length > MAX_CHARS) return { ok: false, error: 'too-long', max: MAX_CHARS }
      const also = alsoAgents === true
      const all = Object.assign({}, items())
      if (t === '') delete all[workspaceId]
      else all[workspaceId] = { text: t, alsoAgents: also, updatedAt: now() }
      // the folder first: if AGENTS.md cannot be written the private copy is not changed either, so the screen never lies
      const agents = syncAgents(typeof w.path === 'string' ? w.path : '', also && t !== '' ? t : '')
      if (agents.ok !== true && (also || agents.error === 'agents-write-failed')) return { ok: false, error: agents.error }
      try { write(all) } catch (e) { return { ok: false, error: 'store-write-failed' } }
      return { ok: true, workspaceId, text: t, alsoAgents: also && t !== '', agentsChanged: agents.changed === true }
    },
    /** The block for a session's prompt, '' when its workspace has none. Synchronous: the prompt assembly calls it each step. */
    promptFor (sessionId) {
      try {
        const id = workspaceOfSession(workspaces(), sessionId)
        if (id === null) return ''
        const it = items()[id]
        if (it === undefined || typeof it.text !== 'string' || it.text.trim() === '') return ''
        const w = workspaces()[id]
        return renderBlock(typeof w.title === 'string' ? w.title : id, it.text.slice(0, MAX_CHARS))
      } catch (e) { return '' }
    }
  }
}

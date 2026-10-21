// Which chats read untrusted content, so that a skill written in one of them is never applied on Kaby's word alone.
//
// A skill steers every later answer. If the agent wrote one after reading a web page, an e-mail or a file somebody else sent, the text could carry an
// instruction planted there (an indirect prompt injection). So the host watches the tool calls (`tools/pre-execute`, a seam that exists) and notes, per chat,
// whether one of them reached the outside world. That is a fact the agent cannot talk its way around: it is recorded here, not asked.
//
// What is tracked, and what is not (said once): the host follows chats from the moment this feature loads. A chat it did not see begin (it started
// before, or the host restarted in the middle of it and lost no record: the record is on disk) is « not followed », and a suggestion from it is treated as untrusted.
// Text the person pasted into a message, and files a tool read from disk, are not followed: they are the person's own doing.
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'

export const KEEP_SESSIONS = 400
const file = (dsh) => join(dsh, 'kybernos', 'skills-learned-sessions.json')

// Tools that stay on this computer and read or write what the person works with. Everything else is untrusted until proven otherwise (fail closed).
const LOCAL = new Set(['read', 'write', 'edit', 'multi_edit', 'multiedit', 'notebook_edit', 'glob', 'grep', 'ls', 'list', 'todo_write', 'todoread', 'todowrite', 'ask_user_question',
  'skill', 'lesson_write', 'lesson_search', 'skill_propose', 'skill_improve', 'memory_write', 'memory_search', 'session_msg_propose', 'exit_plan_mode', 'enter_plan_mode'])
const SHELL = /^(bash|shell|sh|zsh|run_command|exec|execute|terminal)$/i
const NETWORK = /\b(curl|wget|http:|https:|ftp:|scp|ssh|nc|netcat|git\s+(clone|fetch|pull)|npm\s+(i|install)|pip\s+install|brew\s+install)\b/i

/** Did this call reach the outside world? `name` is the tool, `args` its arguments. A shell is local unless its command goes to the network. */
export const isUntrusted = (name, args) => {
  const n = String(name === undefined || name === null ? '' : name).toLowerCase()
  if (n === '') return true
  if (SHELL.test(n)) {
    let text = ''
    try { text = typeof args === 'string' ? args : JSON.stringify(args === undefined ? null : args) } catch (e) { text = '' }
    return NETWORK.test(text.slice(0, 20000))
  }
  if (LOCAL.has(n)) return false
  if (/^subagent/.test(n)) return false
  return true
}

/** The record on disk: `{ since, sessions: { [id]: { first, tainted, tool } } }`. */
export const readSessions = (dsh) => {
  try {
    const raw = JSON.parse(readFileSync(file(dsh), 'utf8'))
    if (raw !== null && typeof raw === 'object' && typeof raw.since === 'string' && raw.sessions !== null && typeof raw.sessions === 'object') return raw
  } catch (e) { /* a first run, or a damaged file: a fresh record */ }
  return { since: new Date().toISOString(), sessions: {} }
}
const writeSessions = (dsh, rec) => {
  const ids = Object.keys(rec.sessions)
  if (ids.length > KEEP_SESSIONS) {
    ids.sort((a, b) => String(rec.sessions[a].first).localeCompare(String(rec.sessions[b].first)))
    for (const id of ids.slice(0, ids.length - KEEP_SESSIONS)) delete rec.sessions[id]
  }
  mkdirSync(join(dsh, 'kybernos'), { recursive: true })
  const temp = file(dsh) + '.tmp-' + randomBytes(3).toString('hex')
  try { writeFileSync(temp, JSON.stringify(rec) + '\n', { encoding: 'utf8', mode: 0o600 }); renameSync(temp, file(dsh)) } catch (e) { try { unlinkSync(temp) } catch (e2) { /* nothing to clean */ } }
}

// The record is read once and kept; writes happen only when something new is learned (a chat begins, a chat is first tainted).
const cache = new Map()
const load = (dsh) => { let r = cache.get(dsh); if (r === undefined || existsSync(file(dsh)) === false) { r = readSessions(dsh); cache.set(dsh, r) } return r }
export const forgetCache = () => cache.clear()

/** A turn of this chat began (`agent/inbox/claimed`): the chat is followed from here. */
export const noteTurn = (dsh, sessionId, now = Date.now()) => {
  if (typeof sessionId !== 'string' || sessionId === '') return
  const rec = load(dsh)
  if (rec.sessions[sessionId] !== undefined) return
  rec.sessions[sessionId] = { first: new Date(now).toISOString(), tainted: false }
  writeSessions(dsh, rec)
}

/** A tool is about to run in this chat. Returns true when that made the chat untrusted for the first time. */
export const noteTool = (dsh, sessionId, name, args, now = Date.now()) => {
  if (typeof sessionId !== 'string' || sessionId === '' || isUntrusted(name, args) === false) return false
  const rec = load(dsh)
  const cur = rec.sessions[sessionId]
  if (cur !== undefined && cur.tainted === true) return false
  rec.sessions[sessionId] = { first: cur !== undefined ? cur.first : new Date(now).toISOString(), tainted: true, tool: String(name).slice(0, 60), ...(cur === undefined ? { late: true } : {}) }
  writeSessions(dsh, rec)
  return true
}

/**
 * What the host knows about a chat: `{ tracked, tainted, tool }`. A chat the host never saw begin is not tracked: its suggestions count as untrusted.
 * `tainted` is true as well for a chat whose first sight was a tool call (`late`): the turn that opened it was not seen.
 */
export const sourceOf = (dsh, sessionId) => {
  if (typeof sessionId !== 'string' || sessionId === '') return { tracked: false, tainted: true, tool: null }
  const cur = load(dsh).sessions[sessionId]
  if (cur === undefined) return { tracked: false, tainted: true, tool: null }
  return { tracked: cur.late !== true, tainted: cur.tainted === true || cur.late === true, tool: typeof cur.tool === 'string' ? cur.tool : null }
}

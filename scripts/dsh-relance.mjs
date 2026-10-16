#!/usr/bin/env node
/**
 * dsh-relance — restart DSH web without cutting yourself off, recover the URL
 * (token), and get the conversation going again without waiting for a human
 * message.
 *
 * The problem solved: the agent runs INSIDE the `dsh web` process. If it kills
 * that process to restart it, it kills itself and can no longer start anything;
 * and after the restart the token changes and the session stays "cold", so the
 * user has to write again to wake the work up.
 *
 * Three ideas:
 *   1. the restart is done by a DETACHED PROCESS (or by launchd) that survives
 *      the death of DSH — so `relance` re-executes itself as a detached child;
 *   2. the URL/token is recovered from the output log of `dsh web` (the launchd
 *      plist writes it there), or ignored altogether (see 3);
 *   3. the resume goes through the local HTTP API with a signed cookie DERIVED
 *      FROM THE PERSISTENT SECRET (~/.dsh/.credentials.yaml): it survives
 *      restarts, unlike the launch token. We can then `session/prompt` a cold
 *      session and the agent starts again.
 *
 * Usage:
 *   node ~/.dsh/tools/dsh-relance.mjs status
 *   node ~/.dsh/tools/dsh-relance.mjs url [--open]
 *   node ~/.dsh/tools/dsh-relance.mjs actives [--json] [--all]
 *   node ~/.dsh/tools/dsh-relance.mjs kick   [--session <id>] [--message <txt>] [--port 3080]
 *   node ~/.dsh/tools/dsh-relance.mjs intent [--session <id>] [--message <txt>] [--note <txt>]
 *   node ~/.dsh/tools/dsh-relance.mjs relance [--session <id>] [--message <txt>] [--open] [--wait-ms 120000] [--avec-autres]
 *   node ~/.dsh/tools/dsh-relance.mjs supervise [--once] [--interval 15] | supervise install | supervise uninstall | supervise status
 *   node ~/.dsh/tools/dsh-relance.mjs install [--force] | uninstall
 *
 * `relance` returns immediately: the detached child cuts DSH, waits for the
 * port to answer, recovers the URL and sends the resume message.
 * Log: ~/.dsh/logs/dsh-relance.log
 *
 * APPROVAL GUARD (2026-09-22): if other sessions are running when the request
 * is made, `relance` REFUSES (exit code 3) unless `--avec-autres` is passed. It
 * is up to the agent — not the script — to ask the user for approval (host tool
 * `relancer_dsh` → native approval panel `dsh-client-ui-approval`, or a
 * question in the chat). With `--avec-autres`, ALL the sessions that were
 * running at the moment of the cut are journalled, then woken up after the
 * restart (once each, through the reservations file
 * `dsh-relance-claims.json`).
 *
 * SUPERVISION (`supervise`): detached loop (LaunchAgent
 * `com.kybernos.dsh-relance`) that samples the active sessions, watches the
 * server AND the network, and resumes the sessions whose turn died after either
 * one comes back. The "plain network cut" case is already covered natively by
 * `dsh-client-connection` (backoff reconnection) and `dsh-llm-retry` (retries
 * at the agent's pace); supervision is the safety net for what really failed.
 */
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, openSync, statSync, rmSync } from 'node:fs'
import { createHash, createHmac, randomUUID } from 'node:crypto'
import { spawn, execFileSync } from 'node:child_process'
import { connect } from 'node:net'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
// The portable layer: finding the server and reading its command line no
// longer go through hard-coded `lsof`/`ps` (absent on Windows).
import { pidSurPortSync, commandeProcessusSync, demarrageProcessusSync, famille, nomSuperviseur } from './plateforme.mjs'

const SELF = fileURLToPath(import.meta.url)
const HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const LOGS = join(HOME, 'logs')
const RELANCE_LOG = join(LOGS, 'dsh-relance.log')
const INTENT_FILE = join(LOGS, 'dsh-relance-intent.json')
const JOURNAL_FILE = join(LOGS, 'dsh-relance-journal.json')
const CLAIMS_FILE = join(LOGS, 'dsh-relance-claims.json')
const SUPERVISE_STATE = join(LOGS, 'dsh-relance-supervise.json')
const SUPERVISE_PAUSE = join(LOGS, 'dsh-relance-supervise.pause')
const SUPERVISE_LABEL = 'com.kybernos.dsh-relance'
const CLAIM_WINDOW_MS = 180_000
const CREDENTIALS = join(HOME, '.credentials.yaml')
const DOMAIN = `gui/${process.getuid?.() ?? ''}`

// Wake-up prompts sent INTO a DSH session: they are addressed to the model.
const DEFAULT_MESSAGE =
  '🔁 Automatic resume: the DSH server has just been restarted. Pick the interrupted work back up ' +
  'where it stopped, without waiting for a message from the user.'

/** Message sent to the OTHER active sessions resumed by the relaunch (they have no recorded intent). */
const DEFAULT_MESSAGE_AUTRES =
  '🔁 Automatic resume: the DSH server restarted while this session was working. ' +
  'Pick the interrupted work back up where it stopped, without waiting for a message from the user. ' +
  'If the previous turn had already finished, simply reply that the session is available again.'

// ---------------------------------------------------------------- arguments

/**
 * Flags without a value. Without this list, `--dry "the title"` swallows the
 * title (the parser takes it for the value of `--dry`) — a silent trap.
 */
const BOOLEENS = new Set(['dry', 'simuler', 'json', 'all', 'open', 'force', 'once', 'run', 'avec-autres', 'start-only', 'launchd', 'verbeux', 'aide', 'help'])

function parseArgs(argv) {
  const out = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--') { out._.push(...argv.slice(i + 1)); break }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=')
      const key = eq === -1 ? a.slice(2) : a.slice(2, eq)
      const inline = eq === -1 ? undefined : a.slice(eq + 1)
      const next = argv[i + 1]
      if (inline !== undefined) out[key] = inline
      else if (next !== undefined && !next.startsWith('--') && !BOOLEENS.has(key)) { out[key] = next; i++ }
      else out[key] = true
    } else out._.push(a)
  }
  return out
}

const args = parseArgs(process.argv.slice(2))
const cmd = args._[0] ?? 'status'
const port = String(args.port ?? 3080)
const authority = `${args.host ?? '127.0.0.1'}:${port}`
const base = `http://${authority}`
const LABEL = args.label && args.label !== true ? String(args.label) : 'com.kybernos.dsh-web'
const flag = (name) => args[name] === true || args[name] === 'true' || args[name] === '1'
const say = (...a) => console.log(...a)
const log = (line) => {
  try { mkdirSync(LOGS, { recursive: true }); appendFileSync(RELANCE_LOG, `[${new Date().toISOString()}] ${line}\n`) } catch {}
}
/** "1 session", "2 other sessions": a count with the noun in the right number. */
const plural = (n, noun) => `${n} ${noun}${n === 1 ? '' : 's'}`

/** The logs are named by port: a test instance does not touch those of 3080. */
const webOut = port === '3080' ? join(LOGS, 'dsh-web.out.log') : join(LOGS, `dsh-web-${port}.out.log`)
const webErr = port === '3080' ? join(LOGS, 'dsh-web.err.log') : join(LOGS, `dsh-web-${port}.err.log`)
const webUrlFile = port === '3080' ? join(LOGS, 'dsh-web.url') : join(LOGS, `dsh-web-${port}.url`)

// ------------------------------------------------------------ authentication

const b64url = (b) => Buffer.from(b).toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')

/** Signing secret of the browser cookie, persisted by DSH (survives restarts). */
function browserSessionSecret() {
  if (!existsSync(CREDENTIALS)) throw new Error(`credentials not found: ${CREDENTIALS}`)
  const raw = readFileSync(CREDENTIALS, 'utf8')
  const at = raw.indexOf('client-connection/browser-session')
  if (at === -1) throw new Error('record client-connection/browser-session missing from the credentials')
  const m = raw.slice(at).match(/secret:\s*(\S+)/)
  if (!m) throw new Error('browser cookie secret not found')
  const secret = Buffer.from(m[1].replaceAll('-', '+').replaceAll('_', '/'), 'base64')
  if (secret.byteLength !== 32) throw new Error(`unexpected secret size (${secret.byteLength})`)
  return secret
}

/** Cookie `dsh-auth-<hash(authority)>` signed HMAC-SHA256, valid for 24 h. */
function authCookie(maxAgeMs = 86_400_000) {
  const secret = browserSessionSecret()
  const name = 'dsh-auth-' + b64url(createHash('sha256').update(authority).digest())
  const now = Date.now()
  const body = b64url(Buffer.from(JSON.stringify({ version: 1, authority, issuedAt: now, expiresAt: now + maxAgeMs }), 'utf8'))
  const sig = b64url(createHmac('sha256', secret).update(body).digest())
  return `${name}=v1.${body}.${sig}`
}

/** A unary RPC call on DSH's /api channel. */
async function rpc(method, argObject, { cookie, timeoutMs = 20_000, sessionHeader } = {}) {
  const rpcId = randomUUID()
  const res = await fetch(`${base}/api/${method}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
      origin: base,
      'sec-fetch-site': 'same-origin',
      ...(sessionHeader ? { 'x-dsh-session': sessionHeader } : {}),
    },
    body: JSON.stringify({ type: 'client-request', rpcId, method, payload: { args: argObject } }),
    signal: AbortSignal.timeout(timeoutMs),
  })
  const text = await res.text()
  let body
  try { body = JSON.parse(text) } catch { body = { raw: text } }
  if (res.status !== 200) throw new Error(`HTTP ${res.status} on ${method}: ${text.trim().slice(0, 200)}`)
  if (body?.result && body.result.ok === false) throw new Error(`${method}: ${body.result.error?.code} — ${body.result.error?.message}`)
  return body?.result?.value
}

async function serverAlive(timeoutMs = 1500) {
  try {
    await fetch(base + '/', { signal: AbortSignal.timeout(timeoutMs), redirect: 'manual' })
    return true
  } catch { return false }
}

// ------------------------------------------------------- active sessions (native)

/**
 * `session/list`: DSH natively exposes `running` per session ("the Agent is
 * currently running"), `agentAvailable`, `parentSessionId`/`origin: 'subagent'`.
 * It is the only source of truth — no state is invented.
 */
async function sessionsList(timeoutMs = 8_000) {
  const value = await rpc('session/list', { _request: {} }, { cookie: authCookie(), timeoutMs })
  return Array.isArray(value?.items) ? value.items : []
}

/** A subagent child session cannot be woken by `session/prompt` (session/agent-busy). */
function isSubagentSession(row) {
  return row?.origin === 'subagent' || row?.parentSessionId !== undefined && row.parentSessionId !== null
}

function sessionTitle(row) {
  const v = row?.projections?.values
  const title = v && typeof v.title === 'string' ? v.title : ''
  return title.length > 0 ? title : '(untitled)'
}

/** Identifier of the current session: explicit argument, otherwise $DSH_SESSION_ID. */
function currentSessionId() {
  return args.session ?? args['session-id'] ?? process.env.DSH_SESSION_ID
}

/**
 * Sessions that are REALLY running, leaving out subagent children.
 * @param exclude - session not to count (usually the current one).
 * @param includeSubagents - keep the children (diagnostics only).
 */
async function runningSessions({ exclude, includeSubagents = false } = {}) {
  const items = await sessionsList()
  return items.filter((row) => row && row.running === true
    && (includeSubagents || !isSubagentSession(row))
    && (exclude === undefined || row.sessionId !== exclude))
}

function describeSession(row) {
  return `${row.sessionId}  ${sessionTitle(row)}`
}

// -------------------------------------------------- journal and reservations

function readJson(file, fallback) {
  if (!existsSync(file)) return fallback
  try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return fallback }
}

function writeJson(file, value) {
  try {
    mkdirSync(LOGS, { recursive: true })
    writeFileSync(file, JSON.stringify(value, null, 2) + '\n')
  } catch (error) { log(`writing ${file} failed — ${error?.message ?? error}`) }
}

/**
 * Snapshots the active sessions BEFORE the cut: this list, and only this list,
 * is what gets woken up after the restart.
 */
async function snapshotActives(primary) {
  const sessions = []
  if (primary) sessions.push({ id: primary, title: '(current session)', primary: true })
  let observed = []
  try {
    observed = await runningSessions({ exclude: primary })
  } catch (error) {
    log(`snapshot: session/list unavailable — ${error?.message ?? error}`)
  }
  for (const row of observed) sessions.push({ id: row.sessionId, title: sessionTitle(row), updatedAt: row.updatedAt })
  return sessions
}

function writeJournal({ primary, sessions, reason }) {
  const journal = {
    at: new Date().toISOString(),
    reason: reason ?? 'relaunch requested',
    primary: primary ?? null,
    sessions: sessions.filter((s) => typeof s?.id === 'string' && s.id.length > 0),
  }
  writeJson(JOURNAL_FILE, journal)
  log(`journal: ${plural(journal.sessions.length, 'session')} to resume — ${journal.sessions.map((s) => s.id).join(', ')}`)
  return journal
}

function readJournal() {
  return readJson(JOURNAL_FILE, undefined)
}

function claim(sessionId, reason) {
  const claims = readJson(CLAIMS_FILE, {})
  claims[sessionId] = { at: Date.now(), reason: reason ?? null }
  writeJson(CLAIMS_FILE, claims)
}

function claimedRecently(sessionId, windowMs = CLAIM_WINDOW_MS) {
  const claims = readJson(CLAIMS_FILE, {})
  const row = claims?.[sessionId]
  return typeof row?.at === 'number' && Date.now() - row.at < windowMs
}

/**
 * Wakes the journalled sessions (and, failing that, those of the last
 * supervision sample). Each session is woken only once per reservation window —
 * the relaunch child and the supervisor can therefore both call this function
 * without doubling the messages.
 *
 * @param reason - reason recorded in the reservations and the journal.
 * @param targets - explicit list of identifiers (the supervisor passes its own,
 *   kept in memory); otherwise the recent journal and the last sample.
 * @returns counters: `kicked` (messages sent), `skipped` (already reserved or still active), `failed` (definitive refusal).
 */
async function resumeActives({ reason, sessionId, message, targets: explicitTargets } = {}) {
  const journal = readJournal()
  const frais = journal && Date.parse(journal.at) > Date.now() - 3_600_000 ? journal : undefined
  const samples = readJson(SUPERVISE_STATE, undefined)
  const primary = sessionId ?? frais?.primary ?? sessionIdFromArgs()

  const targets = new Map()
  if (Array.isArray(explicitTargets)) {
    for (const id of explicitTargets) if (typeof id === 'string' && id.length > 0) targets.set(id, { id })
  } else {
    if (primary) targets.set(primary, { id: primary, primary: true })
    for (const row of frais?.sessions ?? []) {
      if (row?.id && !targets.has(row.id)) targets.set(row.id, { id: row.id })
    }
    for (const row of samples?.running ?? []) {
      if (row?.id && !targets.has(row.id)) targets.set(row.id, { id: row.id })
    }
  }
  if (primary && targets.has(primary)) targets.get(primary).primary = true
  if (targets.size === 0) { log('resume: no session to wake up'); return { kicked: 0, skipped: 0, failed: 0 } }

  let live = new Set()
  try { live = new Set((await runningSessions()).map((row) => row.sessionId)) } catch {}

  let kicked = 0
  let skipped = 0
  let failed = 0
  for (const target of targets.values()) {
    const id = target.id
    if (claimedRecently(id)) { log(`resume: ${id} was already woken recently — skipped`); skipped++; continue }
    if (live.has(id)) { log(`resume: ${id} is still running — no need to wake it`); skipped++; continue }
    const text = target.primary
      ? (message && message !== true ? String(message) : composeMessage(message))
      : DEFAULT_MESSAGE_AUTRES
    if (await kickSession(id, text, 6)) {
      claim(id, reason ?? 'resume')
      kicked++
      log(`resume: sent to ${id}${target.primary ? ' (current session)' : ''}`)
    } else {
      failed++
      log(`resume: FAILED for ${id} (see the attempts above)`)
    }
  }
  log(`resume: ${kicked} woken, ${skipped} skipped, ${failed} failed — reason: ${reason ?? 'manual'}`)
  return { kicked, skipped, failed }
}

async function cmdActives() {
  const sessionId = currentSessionId()
  let rows
  try {
    rows = await runningSessions({ exclude: sessionId, includeSubagents: flag('all') })
  } catch (error) {
    say(`✗ cannot read the sessions: ${error?.message ?? error}`)
    return 1
  }
  const journal = readJournal()
  if (flag('json')) {
    say(JSON.stringify({
      current: sessionId ?? null,
      others: rows.map((row) => ({ sessionId: row.sessionId, title: sessionTitle(row), updatedAt: row.updatedAt, origin: row.origin ?? null })),
      journal: journal ? { at: journal.at, sessions: journal.sessions.map((s) => s.id) } : null,
      supervision: existsSync(SUPERVISE_STATE) ? readJson(SUPERVISE_STATE, null) : null,
    }, null, 2))
    return 0
  }
  if (rows.length === 0) {
    say(`no other session running${sessionId ? ` (current: ${sessionId})` : ''}`)
  } else {
    say(`${plural(rows.length, 'other session')} running:`)
    for (const row of rows) say(`  · ${describeSession(row)}`)
  }
  if (journal) say(`resume journal: ${plural(journal.sessions.length, 'session')} — ${journal.at} (${journal.reason})`)
  return rows.length > 0 ? 3 : 0
}

// ---------------------------------------------------------------------- naming

/**
 * Generic RPC call on the local channel — the escape hatch when no dedicated
 * command exists (`commands/execute`, `session/list`, …). The cookie is forged
 * from the persistent secret: it works without a token and without a browser,
 * even with the sandbox closed (no file touched).
 */
async function cmdRpc() {
  const methode = args._[1] ?? (typeof args.method === 'string' ? args.method : undefined)
  if (methode === undefined) {
    say('usage: rpc <method> [json]  — e.g. rpc commands/list \'{"agentId":"session-…"}\'')
    return 2
  }
  const brut = args._[2] ?? (typeof args.json === 'string' ? args.json : '{}')
  let charge
  try { charge = JSON.parse(brut) } catch (e) {
    say(`✗ invalid JSON: ${e?.message ?? e}`)
    return 2
  }
  const valeur = await rpc(methode, charge, { cookie: authCookie() })
  say(JSON.stringify(valeur, null, 2))
  return 0
}

/** Category slugs known to the plugin (the reference list lives in `kybernos-sessions`). */
const CATEGORIES = ['fonctionnalite', 'correctif', 'ui', 'doc', 'integration', 'donnees', 'nettoyage', 'question']

/**
 * Names a session WITHOUT a browser — the usual naming tool
 * (`session-titre.mjs`) needs the debug Chrome and a page open on the session,
 * so it is useless after a restart or in a bare terminal.
 *
 * Two writes, the same as the GUI:
 *   1. `session/rename` — the `session/title` event with source "user", the one
 *      that pins the title and suppresses the automatic generation;
 *   2. `POST /kybernos-sessions/categories` — the ONLY writer of the category
 *      registry: it is what makes the SVG icon paint in front of the row.
 */
async function cmdTitre() {
  const titre = typeof args.titre === 'string' ? args.titre : (args._[1] ?? '')
  const cat = typeof args.cat === 'string' ? args.cat : ''
  const sienne = process.env.DSH_SESSION_ID
  const sessionId = args.session ?? args['session-id'] ?? sienne
  if (typeof titre !== 'string' || titre.trim().length === 0 || cat.length === 0) {
    say('usage: titre "The session title" --cat <slug> [--session <id>] [--dry]')
    say(`  categories: ${CATEGORIES.join(' · ')}`)
    return 2
  }
  if (sessionId === undefined) {
    say('✗ no target session: $DSH_SESSION_ID is not set and --session was not given')
    return 1
  }
  if (sienne !== undefined && args.session !== undefined && args.session !== sienne) {
    say(`⚠ you are renaming ANOTHER session (${sessionId}) than your own (${sienne})`)
  }
  if (flag('dry')) {
    say(`(dry run) title "${titre}" — category ${cat} — session ${sessionId}`)
    return 0
  }
  const cookie = authCookie()
  try {
    const r = await rpc('session/rename', { request: { sessionId, title: titre } }, { cookie })
    say(`title set: "${r?.title ?? titre}" (seq ${r?.seq ?? '?'})`)
  } catch (error) {
    say(`✗ rename refused: ${error?.message ?? error}`)
    return 1
  }
  try {
    const res = await fetch(`${base}/kybernos-sessions/categories`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie, origin: base, 'sec-fetch-site': 'same-origin' },
      body: JSON.stringify({ session: sessionId, cat, titre }),
      signal: AbortSignal.timeout(10_000),
    })
    const corps = await res.json().catch(() => ({}))
    if (!res.ok || corps?.ok === false) {
      say(`✗ category not saved (HTTP ${res.status}): ${JSON.stringify(corps).slice(0, 200)}`)
      say('  the title is set, but no icon will be painted')
      return 1
    }
    say(`category "${cat}" saved — the SVG icon appears in front of the row`)
  } catch (error) {
    say(`✗ category not saved: ${error?.message ?? error}`)
    return 1
  }
  log(`title: "${titre}" (${cat}) on ${sessionId}`)
  return 0
}

// ------------------------------------------------------------------- services

/**
 * Last URL of the log. `sinceOffset` restricts the read to what was written
 * AFTER the restart: without it we re-read the token of the previous process,
 * which is worthless (the new `dsh web` publishes its URL after it started
 * listening).
 */
function webUrlFromLog(sinceOffset = 0) {
  if (!existsSync(webOut)) return undefined
  const raw = readFileSync(webOut, 'utf8')
  const lines = (sinceOffset > 0 ? raw.slice(sinceOffset) : raw).split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = lines[i].match(new RegExp(`http://(?:127\\.0\\.0\\.1|localhost):${port}/\\S+`))
    if (m) return m[0]
  }
  return undefined
}

/** Start time (ms) of the process listening on the port. */
function processStartTime(pid) {
  try {
    const raw = execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8' }).trim()
    const t = Date.parse(raw)
    return Number.isNaN(t) ? undefined : t
  } catch { return undefined }
}

/**
 * Is the URL in the log that of the CURRENT process? A `dsh web` started by
 * hand in a terminal writes nothing to the log: the URL read there is then
 * stale, and its token is worthless.
 */
function urlIsFresh() {
  const url = webUrlFromLog()
  if (!url) return false
  const pid = pidOnPort()
  if (!pid) return false
  const started = processStartTime(pid)
  if (started === undefined) return true
  try { return statSync(webOut).mtimeMs >= started - 2000 } catch { return false }
}

function isLaunchdLoaded() {
  try { execFileSync('launchctl', ['print', `${DOMAIN}/${LABEL}`], { stdio: 'ignore' }); return true } catch { return false }
}

function pidOnPort() {
  const r = pidSurPortSync(port)
  return r.valeur === null || r.valeur === undefined ? undefined : Number(r.valeur)
}

function processCommand(pid) {
  const r = commandeProcessusSync(pid)
  return r.valeur === null || r.valeur === undefined ? '' : String(r.valeur)
}

function dshBinary() {
  for (const candidate of [process.env.DSH_BIN, '/opt/homebrew/bin/dsh', '/usr/local/bin/dsh']) {
    if (candidate && existsSync(candidate)) return candidate
  }
  try { return execFileSync('which', ['dsh'], { encoding: 'utf8' }).trim() } catch { throw new Error('dsh binary not found') }
}

// ------------------------------------------------------------------ commands

function sessionIdFromArgs() {
  return args.session ?? args['session-id'] ?? process.env.DSH_SESSION_ID
}

function readIntent() {
  if (!existsSync(INTENT_FILE)) return undefined
  try { return JSON.parse(readFileSync(INTENT_FILE, 'utf8')) } catch { return undefined }
}

function composeMessage(explicit) {
  if (explicit && explicit !== true) return String(explicit)
  const intent = readIntent()
  const parts = [DEFAULT_MESSAGE]
  if (intent?.message) parts.push(intent.message)
  if (intent?.note) parts.push(`Note left before the restart: ${intent.note}`)
  return parts.join('\n\n')
}

async function cmdKick() {
  const sessionId = sessionIdFromArgs()
  if (!sessionId) throw new Error('unknown session: pass --session <id> (or run from inside DSH to inherit $DSH_SESSION_ID)')
  const message = composeMessage(args.message)
  if (!(await serverAlive())) throw new Error(`the server ${base} is not answering`)
  if (!(await apiReady())) throw new Error(`the API ${base} answers but its services are not mounted`)
  await kickSession(sessionId, message, 1, true)
  log(`kick ok session=${sessionId}`)
  say(`✓ resume sent to ${sessionId}`)
  say(`  message: ${message.split('\n')[0].slice(0, 90)}…`)
  return 0
}

/**
 * Sends a resume message to ONE session, with retries.
 * @param sessionId - session to wake.
 * @param message - exact text sent.
 * @param attempts - number of attempts.
 * @param loud - say on screen what is happening (`kick` mode).
 */
async function kickSession(sessionId, message, attempts = 6, loud = false) {
  for (let i = 1; i <= attempts; i++) {
    try {
      const value = await rpc('session/prompt', {
        request: { requestId: randomUUID(), sessionId, mode: args.mode === 'steer' ? 'steer' : 'queue', content: [{ type: 'text', text: message }] },
      }, { cookie: authCookie() })
      if (loud) say(`  accepted: ${value?.accepted === true ? 'yes' : JSON.stringify(value)}`)
      return true
    } catch (error) {
      const text = String(error?.message ?? error)
      log(`resume: attempt ${i}/${attempts} for ${sessionId} refused — ${text}`)
      // A session that does not exist will not wake up by retrying.
      if (text.includes('session/not-found')) return false
      await sleep(2000)
    }
  }
  return false
}

function cmdIntent() {
  const sessionId = sessionIdFromArgs()
  const payload = {
    sessionId: sessionId ?? null,
    message: args.message && args.message !== true ? String(args.message) : null,
    note: args.note && args.note !== true ? String(args.note) : null,
    at: new Date().toISOString(),
  }
  mkdirSync(LOGS, { recursive: true })
  writeFileSync(INTENT_FILE, JSON.stringify(payload, null, 2) + '\n')
  say(`✓ resume intent written: ${INTENT_FILE}`)
  if (payload.sessionId) say(`  session: ${payload.sessionId}`)
  return 0
}

function cmdStatus() {
  return (async () => {
  const pid = pidOnPort()
  const loaded = isLaunchdLoaded()
  const url = webUrlFromLog()
  const fresh = urlIsFresh()
  const sessionId = sessionIdFromArgs()
  say(`DSH_HOME        : ${HOME}`)
  say(`API             : ${base} ${serverAliveSync() ? '(answering)' : '(not answering)'}`)
  say(`launchd         : ${loaded ? `loaded (${LABEL})` : 'NOT loaded — DSH runs without supervision'}`)
  say(`port ${port}       : ${pid ? `pid ${pid} → ${processCommand(pid).slice(0, 70)}` : 'nothing listening'}`)
  say(`web log         : ${existsSync(webOut) ? webOut : 'absent (output not redirected: the token will be lost)'}`)
  say(`URL (token)     : ${url ?? 'not found in the log'}${url && !fresh ? '  ⚠️ STALE (the current process does not write to this log)' : ''}`)
  say(`API cookie      : ${fileHasSecret() ? 'persistent secret found → cookie can be forged without a token' : 'secret MISSING (API unreachable from outside)'}`)
  say(`current session : ${sessionId ?? '(outside DSH: pass --session <id>)'}`)
  let actives = 'server silent'
  if (serverAliveSync()) {
    try {
      const rows = await runningSessions({ exclude: sessionId })
      actives = rows.length === 0 ? 'no other' : `${plural(rows.length, 'other session')} — ${rows.map((r) => r.sessionId).join(', ')}`
    } catch (error) { actives = `unreadable (${String(error?.message ?? error).slice(0, 60)})` }
  }
  say(`active sessions : ${actives}`)
  say(`supervision     : ${isSuperviseLoaded() ? `loaded (${SUPERVISE_LABEL})` : 'NOT loaded (relaunch not supervised)'}`)
  const journal = readJournal()
  say(`resume journal  : ${journal ? `${plural(journal.sessions.length, 'session')} — ${journal.at} (${journal.reason})` : 'none'}`)
  return 0
  })()
}

function serverAliveSync() {
  try {
    execFileSync('curl', ['-s', '-o', '/dev/null', '--max-time', '1', base + '/'])
    return true
  } catch { return false }
}

function fileHasSecret() {
  try { browserSessionSecret(); return true } catch { return false }
}

function cmdUrl() {
  const url = webUrlFromLog()
  if (!url) {
    say(`no URL in ${webOut}`, 'stderr:')
    say(existsSync(webErr) ? readFileSync(webErr, 'utf8').split('\n').slice(-10).join('\n') : '(no error log)')
    return 1
  }
  say(url)
  if (!urlIsFresh()) say(`⚠️  URL probably stale: the process listening on ${port} does not write to ${webOut}.`)
  if (args.open) { spawn('open', [url], { detached: true, stdio: 'ignore' }).unref(); say('→ opening in the browser') }
  return 0
}

function launchdPlistPath() {
  return join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`)
}

/**
 * Switches DSH under the LaunchAgent (plist already present, KeepAlive).
 * `force` cuts the unsupervised instance that holds the port — without it
 * launchd loops on EADDRINUSE.
 */
async function ensureLaunchdAgent({ force = false } = {}) {
  const plist = launchdPlistPath()
  if (!existsSync(plist)) throw new Error(`plist missing: ${plist}`)
  const pid = pidOnPort()
  if (pid && !isLaunchdLoaded()) {
    if (!force) throw new Error(`an unsupervised DSH is listening on ${port} (pid ${pid}); run again with --force`)
    log(`relaunch: stopping unsupervised pid ${pid}`)
    try { process.kill(pid, 'SIGTERM') } catch {}
    const until = Date.now() + 15_000
    while (Date.now() < until && pidOnPort()) await sleep(500)
  }
  try { execFileSync('launchctl', ['bootout', `${DOMAIN}/${LABEL}`], { stdio: 'ignore' }) } catch {}
  execFileSync('launchctl', ['bootstrap', DOMAIN, plist], { stdio: 'ignore' })
  execFileSync('launchctl', ['kickstart', '-k', `${DOMAIN}/${LABEL}`], { stdio: 'ignore' })
}

async function cmdInstall() {
  try {
    await ensureLaunchdAgent({ force: flag('force') })
  } catch (error) {
    say(`✗ ${error?.message ?? error}`)
    // Reader of the "unsupervised" marker written by ensureLaunchdAgent above.
    if (String(error?.message ?? '').includes('unsupervised')) {
      say(`   Run again with --force: this CUTS the current session, then launchd takes over`)
      say(`   and the detached child wakes the conversation up on its own.`)
    }
    return 1
  }
  say(`✓ launchd has taken DSH over (${LABEL}); the URL/token will arrive in ${webOut}`)
  return 0
}

function cmdUninstall() {
  try { execFileSync('launchctl', ['bootout', `${DOMAIN}/${LABEL}`], { stdio: 'ignore' }); say(`✓ launchd unloaded (${LABEL})`) }
  catch { say('(already unloaded)') }
  say(`the plist stays in place: ${launchdPlistPath()}`)
  return 0
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }

// ---- `relance`: detaches, cuts, waits, recovers the URL, wakes up ------------

/**
 * APPROVAL GUARD. If other sessions are running, the relaunch refuses: it is up
 * to the agent to ask for approval (native approval panel or a question in the
 * chat), then to come back with `--avec-autres`.
 * @returns 0 if the way is clear, 3 if the approval is missing.
 */
async function guardOtherSessions(phase) {
  if (flag('avec-autres')) return 0
  const sessionId = sessionIdFromArgs()
  if (!(await serverAlive()) || !(await apiReady())) return 0 // server already down: nothing to interrupt
  let others = []
  try {
    others = await runningSessions({ exclude: sessionId })
  } catch (error) {
    log(`guard (${phase}): session/list unreadable — ${error?.message ?? error}; letting it through`)
    return 0
  }
  if (others.length === 0) return 0
  log(`guard (${phase}): ${plural(others.length, 'other session')} active — refused without --avec-autres`)
  say(`✗ ${plural(others.length, 'other session')} running — restart NOT started:`)
  for (const row of others) say(`   · ${describeSession(row)}`)
  say('')
  say('Ask the user for approval, then run again with `--avec-autres`:')
  say('   node ~/.dsh/tools/dsh-relance.mjs relance --avec-autres')
  say('All the sessions above will be woken up after the restart.')
  return 3
}

function cmdRelance() {
  if (flag('run')) return cmdRelanceRun() // already inside the detached child
  return (async () => {
    const gate = await guardOtherSessions('request')
    if (gate !== 0) return gate
    if (flag('dry') || flag('simuler')) {
      const sessionId = sessionIdFromArgs()
      const sessions = await snapshotActives(sessionId)
      say(`✓ way clear — dry run, NOTHING was cut.`)
      say(`would be resumed after the restart (${sessions.length}):`)
      for (const s of sessions) say(`   · ${s.id}  ${s.title ?? ''}`)
      return 0
    }
    const passthrough = []
    for (const key of ['session', 'message', 'note', 'open', 'wait-ms', 'port', 'host', 'cwd', 'start-only', 'label', 'mode', 'delay', 'launchd', 'avec-autres', 'motif']) {
      if (args[key] !== undefined) passthrough.push(`--${key}`, String(args[key]))
    }
    const out = openSync(RELANCE_LOG, 'a')
    const child = spawn(process.execPath, [SELF, 'relance', '--run', ...passthrough], {
      detached: true,
      stdio: ['ignore', out, out],
      cwd: args.cwd && args.cwd !== true ? String(args.cwd) : process.cwd(),
    })
    child.unref()
    log(`detached relaunch started (pid ${child.pid}) session=${sessionIdFromArgs() ?? '?'}`)
    say(`✓ detached relaunch (pid ${child.pid}) — it survives the cut of DSH`)
    say(`  log: ${RELANCE_LOG}`)
    return 0
  })()
}

async function cmdRelanceRun() {
  const sessionId = sessionIdFromArgs()
  const waitMs = Number(args['wait-ms'] ?? 120_000)
  const launchd = isLaunchdLoaded()
  if (Number(args.delay) > 0) { log(`relaunch: waiting ${Number(args.delay)} s before the cut`); await sleep(Number(args.delay) * 1000) }
  log(`— relaunch: start (session=${sessionId ?? '?'}, launchd=${launchd}, port=${port}, avec-autres=${flag('avec-autres')})`)

  // Second guard, inside the child: the state may have changed since the request.
  if (!flag('start-only')) {
    const gate = await guardOtherSessions('child')
    if (gate !== 0) return gate
  }

  // What matters is written AFTER the cut: start from the current size of the log.
  const sinceOffset = !flag('start-only') && existsSync(webOut) ? statSync(webOut).size : 0
  // Snapshot BEFORE the cut: this is the list of sessions to wake up.
  const sessions = await snapshotActives(sessionId)
  writeJournal({ primary: sessionId, sessions, reason: args.motif && args.motif !== true ? String(args.motif) : 'relaunch requested' })
  say(`→ ${plural(sessions.length, 'session')} will be resumed after the restart.`)

  try {
    if (!flag('start-only')) {
      if (!(await restartAndWait(waitMs))) { log('relaunch: the server did not come back ready in time'); return 1 }
    } else {
      log('relaunch: --start-only, no restart requested')
      if (!(await apiReady()) && !(await waitForNewServer(pidOnPort(), 15_000))) { log('relaunch: API not ready'); return 1 }
    }
    log('relaunch: API ready')
    const url = await waitForUrl(20_000, sinceOffset)
    if (url) {
      writeFileSync(webUrlFile, url + '\n')
      log(`relaunch: URL recovered${urlIsFresh() ? '' : ' (stale?)'} → ${webUrlFile}`)
      if (flag('open')) spawn('open', [url], { detached: true, stdio: 'ignore' }).unref()
    } else log('relaunch: URL not found in the log (output not redirected?)')
    if (sessions.length === 0) { log('relaunch: no target session, nothing to wake up'); return 0 }
    const resumed = await resumeActives({ reason: 'relaunch', sessionId, message: args.message })
    return resumed.failed > 0 ? 1 : 0
  } catch (error) {
    log(`relaunch: failed — ${error?.message ?? error}`)
    return 1
  }
}

/** Cuts then relaunches, and waits for the API to be REALLY served (services mounted). */
async function restartAndWait(timeoutMs) {
  const before = pidOnPort()
  if (flag('launchd')) {
    log('relaunch: switching to launchd (KeepAlive agent)')
    try { await ensureLaunchdAgent({ force: true }) } catch (error) { log(`relaunch: launchd install failed — ${error?.message ?? error}`) }
    if (await waitForNewServer(before, Math.min(45_000, timeoutMs))) return true
    log('relaunch: launchd did not bring back a ready server, falling back to a detached start')
  }
  if (isLaunchdLoaded()) {
    log('relaunch: launchctl kickstart -k')
    try { execFileSync('launchctl', ['kickstart', '-k', `${DOMAIN}/${LABEL}`], { stdio: 'ignore' }) } catch (error) {
      log(`relaunch: kickstart failed — ${error?.message ?? error}`)
    }
    if (await waitForNewServer(before, Math.min(45_000, timeoutMs))) return true
    log('relaunch: launchd did not bring back a ready server, falling back to a detached start')
  }
  const pid = pidOnPort()
  if (pid) {
    log(`relaunch: kill ${pid} (${processCommand(pid).slice(0, 60)})`)
    try { process.kill(pid, 'SIGTERM') } catch {}
    const until = Date.now() + 15_000
    while (Date.now() < until && pidOnPort()) await sleep(400)
    const still = pidOnPort()
    if (still) { log(`relaunch: SIGTERM not enough, SIGKILL ${still}`); try { process.kill(still, 'SIGKILL') } catch {} }
  } else log('relaunch: nothing on the port, starting directly')
  startDetachedWeb()
  return await waitForNewServer(before, timeoutMs)
}

function startDetachedWeb() {
  const bin = dshBinary()
  const out = openSync(webOut, 'a')
  const err = openSync(webErr, 'a')
  const child = spawn(bin, ['web', '--no-open', '--port', port], {
    detached: true,
    stdio: ['ignore', out, err],
    cwd: args.cwd && args.cwd !== true ? String(args.cwd) : process.cwd(),
  })
  child.unref()
  log(`relaunch: dsh web started detached (pid ${child.pid}), output → ${webOut}`)
}

/** The port answers AND the API dispatches: a plain open TCP is not enough
 *  (`dsh web` publishes its URL well after it started listening). */
async function apiReady(timeoutMs = 3_000) {
  try {
    await rpc('session/list', { _request: {} }, { cookie: authCookie(), timeoutMs })
    return true
  } catch (error) {
    const message = String(error?.message ?? error)
    // a BUSINESS error proves the service is running; the others mean "not yet".
    return !/unavailable|fetch failed|ECONNREFUSED|ECONNRESET|aborted|timeout|socket/i.test(message)
  }
}

async function waitForNewServer(beforePid, timeoutMs) {
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    const pid = pidOnPort()
    if (pid !== undefined && pid !== beforePid && (await apiReady())) return true
    await sleep(500)
  }
  return false
}

async function waitForUrl(timeoutMs, sinceOffset = 0) {
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    const url = webUrlFromLog(sinceOffset)
    if (url) return url
    await sleep(500)
  }
  return undefined
}

// ---- `supervise`: watches server + network, resumes after the return ---------

function supervisePlistPath() {
  return join(homedir(), 'Library', 'LaunchAgents', `${SUPERVISE_LABEL}.plist`)
}

function isSuperviseLoaded() {
  try { execFileSync('launchctl', ['print', `${DOMAIN}/${SUPERVISE_LABEL}`], { stdio: 'ignore' }); return true } catch { return false }
}

/** An open TCP connection to a public IP is enough: no TLS, no DNS, no third-party API. */
function tcpAlive(host, tport, timeoutMs = 3_000) {
  return new Promise((resolve) => {
    let settled = false
    const done = (ok) => { if (settled) return; settled = true; try { socket.destroy() } catch {}; resolve(ok) }
    const socket = connect({ host, port: tport })
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => done(true))
    socket.once('timeout', () => done(false))
    socket.once('error', () => done(false))
  })
}

/** Is the outbound network available? (both probes must fail to say "down") */
async function internetAlive() {
  if (await tcpAlive('1.1.1.1', 443)) return true
  return await tcpAlive('8.8.8.8', 443)
}

async function waitForApiReady(timeoutMs) {
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    if (await apiReady(5_000)) return true
    await sleep(1_000)
  }
  return false
}

function readSuperviseState() {
  const state = readJson(SUPERVISE_STATE, undefined)
  return state && Array.isArray(state.running) ? state : { at: null, running: [] }
}

/** Samples the active sessions: this is the resume list if the server goes down. */
async function sampleRunning() {
  const rows = await runningSessions()
  const state = { at: new Date().toISOString(), running: rows.map((row) => ({ id: row.sessionId, title: sessionTitle(row), updatedAt: row.updatedAt })) }
  writeJson(SUPERVISE_STATE, state)
  return state
}

async function superviseLoop() {
  const intervalSec = Math.max(5, Number(args.interval ?? 15))
  const graceMs = Math.max(5_000, Number(args['grace-ms'] ?? 45_000))
  log(`supervise: starting (pid ${process.pid}, interval ${intervalSec}s, grace ${graceMs}ms, port ${port})`)
  const etat = readSuperviseState()
  const reprendreEtatPersiste = etat.at !== null && Date.now() - Date.parse(etat.at) < 15 * 60_000
  // The resume targets live in MEMORY: a stale journal or sample would wake a
  // session that was active three days ago.
  let dernieres = reprendreEtatPersiste ? etat.running.map((row) => row.id) : []
  let prev = { server: await serverAlive(), net: await internetAlive() }
  if (prev.server && prev.net) { try { dernieres = (await sampleRunning()).running.map((row) => row.id) } catch (error) { log(`supervise: initial sample failed — ${error?.message ?? error}`) } }
  let first = true
  for (;;) {
    const server = await serverAlive()
    const net = await internetAlive()
    const paused = existsSync(SUPERVISE_PAUSE)
    if (server && net && !paused) {
      try { dernieres = (await sampleRunning()).running.map((row) => row.id) } catch {}
    }
    const serverBack = server && !prev.server
    const netBack = net && !prev.net
    if (!first && (serverBack || netBack)) {
      const why = serverBack ? 'server back' : 'network back'
      if (paused) log(`supervise: ${why} — resume suspended (${SUPERVISE_PAUSE})`)
      else {
        log(`supervise: ${why} — grace wait (${graceMs} ms) before resuming ${plural(dernieres.length, 'session')}`)
        await waitForApiReady(serverBack ? 30_000 : 10_000)
        await sleep(graceMs)
        await resumeActives({ reason: why, targets: dernieres })
      }
    }
    prev = { server, net }
    first = false
    if (flag('once')) { log('supervise: --once done'); return 0 }
    await sleep(intervalSec * 1_000)
  }
}

function supervisePlistContent() {
  const node = process.execPath
  const logs = LOGS
  const extra = port === '3080' ? '' : `
    <string>--port</string>
    <string>${port}</string>`
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${SUPERVISE_LABEL}</string>

  <key>ProgramArguments</key>
  <array>
    <string>${node}</string>
    <string>${SELF}</string>
    <string>supervise</string>
    <string>--interval</string>
    <string>15</string>${extra}
  </array>

  <key>RunAtLoad</key>
  <true/>

  <key>KeepAlive</key>
  <true/>

  <key>ThrottleInterval</key>
  <integer>15</integer>

  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>DSH_HOME</key>
    <string>${HOME}</string>
  </dict>

  <key>StandardOutPath</key>
  <string>${logs}/dsh-relance-supervise.out.log</string>
  <key>StandardErrorPath</key>
  <string>${logs}/dsh-relance-supervise.err.log</string>

  <key>ProcessType</key>
  <string>Background</string>
</dict>
</plist>
`
}

function cmdSuperviseInstall() {
  mkdirSync(join(homedir(), 'Library', 'LaunchAgents'), { recursive: true })
  writeFileSync(supervisePlistPath(), supervisePlistContent())
  try { execFileSync('launchctl', ['bootout', `${DOMAIN}/${SUPERVISE_LABEL}`], { stdio: 'ignore' }) } catch {}
  execFileSync('launchctl', ['bootstrap', DOMAIN, supervisePlistPath()], { stdio: 'ignore' })
  execFileSync('launchctl', ['kickstart', '-k', `${DOMAIN}/${SUPERVISE_LABEL}`], { stdio: 'ignore' })
  log(`supervise: installed (${SUPERVISE_LABEL})`)
  say(`✓ permanent supervision installed (${SUPERVISE_LABEL})`)
  say(`  plist   : ${supervisePlistPath()}`)
  say(`  log     : ${LOGS}/dsh-relance-supervise.out.log`)
  say(`  pause   : touch ${SUPERVISE_PAUSE}`)
  return 0
}

function cmdSuperviseUninstall() {
  try { execFileSync('launchctl', ['bootout', `${DOMAIN}/${SUPERVISE_LABEL}`], { stdio: 'ignore' }); say(`✓ supervision unloaded (${SUPERVISE_LABEL})`) }
  catch { say('(supervision already unloaded)') }
  say(`the plist stays: ${supervisePlistPath()} (delete it to remove it)`)
  return 0
}

function cmdSuperviseStatus() {
  const state = readSuperviseState()
  say(`supervision : ${isSuperviseLoaded() ? `loaded (${SUPERVISE_LABEL})` : 'NOT loaded'}`)
  say(`plist       : ${existsSync(supervisePlistPath()) ? supervisePlistPath() : 'absent'}`)
  say(`pause       : ${existsSync(SUPERVISE_PAUSE) ? 'ACTIVE (no automatic resume)' : 'no'}`)
  say(`last sample : ${state.at ?? 'none'} — ${plural(state.running.length, 'active session')}`)
  for (const row of state.running) say(`  · ${row.id}  ${row.title ?? ''}`)
  const claims = readJson(CLAIMS_FILE, {})
  const recent = Object.entries(claims).filter(([, v]) => typeof v?.at === 'number' && Date.now() - v.at < 3_600_000)
  say(`resumes < 1 h : ${recent.length === 0 ? 'none' : recent.map(([id, v]) => `${id}@${new Date(v.at).toISOString().slice(11, 19)}`).join(', ')}`)
  return 0
}

async function cmdSupervise() {
  const action = args._[1]
  if (action === 'install') return cmdSuperviseInstall()
  if (action === 'uninstall') return cmdSuperviseUninstall()
  if (action === 'status') return cmdSuperviseStatus()
  if (action === 'pause') {
    writeFileSync(SUPERVISE_PAUSE, `pause set on ${new Date().toISOString()}\n`)
    say(`✓ automatic resume suspended (${SUPERVISE_PAUSE})`)
    return 0
  }
  if (action === 'resume') {
    rmSync(SUPERVISE_PAUSE, { force: true })
    say('✓ automatic resume re-armed')
    return 0
  }
  return superviseLoop()
}

// ---------------------------------------------------------------------- main

const COMMANDS = {
  status: cmdStatus,
  url: cmdUrl,
  actives: cmdActives,
  titre: cmdTitre,
  rpc: cmdRpc,
  kick: cmdKick,
  intent: cmdIntent,
  relance: cmdRelance,
  supervise: cmdSupervise,
  install: cmdInstall,
  uninstall: cmdUninstall,
}

try {
  const run = COMMANDS[cmd]
  if (!run) {
    say(`unknown command: ${cmd}`)
    say('usage: status | url [--open] | actives [--json] | titre "…" --cat <slug> | rpc <method> [json] | kick | intent')
    say('       relance [--run] [--avec-autres] [--dry]')
    say('       supervise [--once] [--interval 15] | supervise install|uninstall|status|pause|resume | install | uninstall')
    process.exit(64)
  }
  const code = await run()
  process.exit(typeof code === 'number' ? code : 0)
} catch (error) {
  say(`✗ ${error?.message ?? error}`)
  process.exit(1)
}

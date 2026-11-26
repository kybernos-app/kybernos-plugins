// A real message between two real chat sessions of a running DSH — the proof the V-11 route needs.
//
// It signs in with the signed browser-session cookie (never the token URL), asks this bundle's own list for an IDLE target
// session (or takes `--target`), reads the target's event log BEFORE, sends through `POST /kybernos-sessions/message`,
// then reads the SAME log AFTER and looks for the two facts that matter: a `user/message` carrying the host's marker and
// framing, and an `assistant/message` answering it. It also proves the refusal without the cookie, and the journal file's
// mode. It writes nothing into the repository: the evidence text goes to the OS temp folder (path printed).
//
//   node scripts/check-session-msg-live.mjs --target session-…   # REQUIRED: a disposable chat to wake, never a guess
//   node scripts/check-session-msg-live.mjs --target session-… --dry   # plan only, nothing sent
//   node scripts/check-session-msg-live.mjs --target session-… --text "…"
//   node scripts/check-session-msg-live.mjs --target session-… --kind instruction   # proves the instruction framing too
//
// The target is never chosen for you: sending to a chat WAKES it, starts a turn there and spends tokens in it, so the
// caller names the chat they accept to wake (a throw-away chat, or one that is explicitly meant to receive this test).
// Without --target the script stops (exit 3) and lists the idle chats so the choice is a person's.
//
// Exit codes: 0 all checks pass, 1 a check failed, 3 cannot run (no GUI, no cookie, no route, no idle target).
// Environment: KB_HOST (default 127.0.0.1:3080), DSH_HOME (default ~/.dsh), KB_ZSTD (default `zstd` on PATH).
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { cookieDeSession } from './cdp-lib.mjs'

const arg = (name, fallback = undefined) => {
  const i = process.argv.indexOf('--' + name)
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback
}
const flag = (name) => process.argv.includes('--' + name)
const HOST = process.env.KB_HOST || '127.0.0.1:3080'
const BASE = 'http://' + HOST
const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const ZSTD = process.env.KB_ZSTD || 'zstd'
const TIMEOUT_S = Math.max(20, Math.min(600, Number(arg('timeout', '120')) || 120))
const DRY = flag('dry')
const KIND = arg('kind', 'message')
if (KIND !== 'message' && KIND !== 'instruction') { console.error('--kind must be message or instruction'); process.exit(3) }
const TEXT = arg('text', KIND === 'instruction'
  ? 'Test d’instruction kybernos-session-msg : réponds seulement « bien reçu » (instruction de test, ne modifie aucun fichier).'
  : 'Test de livraison kybernos-session-msg : réponds seulement « bien reçu » (message transféré depuis une autre session, aucune action attendue).')

let failed = 0
const check = (label, cond, detail) => {
  console.log((cond ? '  ✓ ' : '  ✗ ') + label + (cond || detail === undefined ? '' : '  — ' + detail))
  if (!cond) failed += 1
}
const say = (line) => console.log(line)
const fail = (line, code = 3) => { console.error(line); process.exit(code) }

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const cookie = cookieDeSession(HOST)
if (cookie === null) fail('cannot read the browser-session secret in ' + join(DSH_HOME, '.credentials.yaml'))
const HEADERS = { cookie: cookie.nom + '=' + cookie.valeur }

const api = async (method, path, body) => {
  const init = { method, headers: { ...HEADERS, origin: BASE, ...(body === undefined ? {} : { 'content-type': 'application/json' }) } }
  if (body !== undefined) init.body = JSON.stringify(body)
  const res = await fetch(BASE + path, init)
  let json = null
  try { json = await res.json() } catch (e) { json = null }
  return { status: res.status, json }
}

// ── the session log on disk (zstd-compressed JSONL; read through the zstd binary, never through a private format) ──
const sessionLog = (_cwd, sessionId) => {
  // The folder name is a slug of the working directory (and the layout may change): find the session wherever DSH keeps it.
  const root = join(DSH_HOME, 'sessions')
  if (!existsSync(root)) return null
  for (const folder of readdirSync(root)) {
    const dir = join(root, folder, sessionId)
    if (!existsSync(dir)) continue
    for (const name of ['session.v4.jsonl.zstd', 'session.v4.jsonl', 'session.jsonl']) {
      if (existsSync(join(dir, name))) return join(dir, name)
    }
  }
  return null
}
const readLog = (file) => {
  try {
    const text = file.endsWith('.zstd')
      ? execFileSync(ZSTD, ['-dc', file], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
      : readFileSync(file, 'utf8')
    return String(text).split('\n').filter((line) => line.trim().length > 0).map((line) => { try { return JSON.parse(line) } catch (e) { return null } }).filter((row) => row !== null)
  } catch (e) { return [] }
}
const lastSeq = (events) => events.reduce((max, row) => (typeof row.seq === 'number' && row.seq > max ? row.seq : max), 0)
const bodyText = (event) => {
  // A durable Session event carries its payload under `data`; a projection row may carry it flat.
  const content = event !== null && event !== undefined ? (event.content !== undefined ? event.content : (event.data !== null && event.data !== undefined ? event.data.content : undefined)) : undefined
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.filter((b) => b !== null && typeof b === 'object' && b.type === 'text').map((b) => String(b.text || '')).join('')
  return ''
}

// ── who am I, who can receive ─────────────────────────────────────────────────
const current = (() => {
  if (typeof process.env.DSH_SESSION_ID === 'string' && process.env.DSH_SESSION_ID.length > 0) return process.env.DSH_SESSION_ID
  return arg('from', '')
})()
const list = await api('GET', '/kybernos-session-msg/sessions' + (current === '' ? '' : '?from=' + encodeURIComponent(current)))
if (list.status === 404) fail('the bundle\'s session route is not mounted: install the bundle in the profile and restart dsh web')
if (list.status === 401 || list.status === 403) fail('the signed cookie was refused (' + String(list.status) + ')')
if (list.status !== 200 || list.json === null || Array.isArray(list.json.sessions) !== true) fail('the session list answered ' + String(list.status))
const sessions = list.json.sessions
// The route lists the OTHER running or recent sessions and returns the asked one as `current`.
const source = (list.json.current !== null && list.json.current !== undefined ? list.json.current : (current === '' ? sessions.find((s) => s.running === true) : null)) || null
if (source === null) fail('no source session: set DSH_SESSION_ID, pass --from session-…, or have a running chat')
const asked = arg('target', '')
if (asked === '') {
  const idle = sessions.filter((s) => s.id !== source.id && s.running !== true).slice(0, 8)
  fail('no target given: this script NEVER picks a chat for you (sending WAKES it and spends tokens there).\n' +
    'Pass --target <session-…> with a throw-away chat you accept to wake. Idle chats, for information only:\n' +
    idle.map((s) => '  ' + s.id + '  ' + s.title).join('\n'))
}
const target = sessions.find((s) => s.id === asked)
if (target === undefined) fail('unknown target session ' + asked)
if (target.id === source.id) fail('the target is the current session: pick another one')

say('source  ' + source.title + '  (' + source.id + ', ' + (source.running ? 'running' : 'idle') + ')')
say('target  ' + target.title + '  (' + target.id + ', ' + (target.running ? 'running' : 'idle') + ')')
say('folder  ' + (target.cwd || '?'))

const file = sessionLog(target.cwd, target.id)
if (file === null) fail('the target\'s event log was not found under ' + join(DSH_HOME, 'sessions'))
const before = readLog(file)
const beforeSeq = lastSeq(before)
say('log     ' + file + '  (' + String(before.length) + ' events, last seq ' + String(beforeSeq) + ')')
if (DRY) { say('--dry: nothing sent.'); process.exit(0) }

// ── the refusal without the cookie, before anything is sent ──────────────────
{
  const noCookie = await fetch(BASE + '/kybernos-sessions/message', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: BASE },
    body: JSON.stringify({ targetSessionId: target.id, fromSessionId: source.id, text: 'should never land' }),
  })
  check('the route refuses a POST without DSH\'s signed cookie (401)', noCookie.status === 401, String(noCookie.status))
  const noOrigin = await fetch(BASE + '/kybernos-sessions/message', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
  check('the route refuses a POST without Origin (403)', noOrigin.status === 403, String(noOrigin.status))
}

// ── the real send ────────────────────────────────────────────────────────────
const sent = await api('POST', '/kybernos-sessions/message', { targetSessionId: target.id, fromSessionId: source.id, text: TEXT, kind: KIND, mode: 'queue' })
check('the send is accepted with {accepted, messageId, deliveredAt}', sent.status === 200 && sent.json !== null && sent.json.accepted === true && typeof sent.json.messageId === 'string' && typeof sent.json.deliveredAt === 'string', JSON.stringify(sent.json).slice(0, 200))
if (sent.status !== 200) fail('nothing was delivered: ' + JSON.stringify(sent.json).slice(0, 200), 1)
const messageId = sent.json.messageId

// ── what the TARGET's own log says, after ────────────────────────────────────
let delivered = null
let answered = null
const deadline = Date.now() + TIMEOUT_S * 1000
while (Date.now() < deadline) {
  await sleep(2000)
  const events = readLog(file).filter((row) => typeof row.seq === 'number' && row.seq > beforeSeq)
  delivered = events.find((row) => row.type === 'user/message' && bodyText(row).includes('[[kb-msg ') && bodyText(row).includes(messageId))
  answered = delivered === undefined ? undefined : events.find((row) => typeof row.seq === 'number' && row.seq > delivered.seq && row.type === 'assistant/message')
  if (delivered !== undefined && answered !== undefined) break
  if (delivered !== undefined) {
    const ended = events.find((row) => typeof row.seq === 'number' && row.seq > delivered.seq && (row.type === 'turn/end' || row.type === 'turn/error'))
    if (ended !== undefined && ended.type === 'turn/error') break
  }
}
check('the target\'s log gained the forwarded user message (by seq, after ' + String(beforeSeq) + ')', delivered !== undefined)
if (delivered !== undefined) {
  const text = bodyText(delivered)
  // The framing names the sender's chat; its title is sanitised (quotes, newlines), so compare the shape and the short id.
  const shortSource = source.id.replace(/^session-/, '').slice(0, 8)
  const framingOk = KIND === 'instruction'
    ? text.includes('Instruction forwarded by the user from the chat « ') && text.includes(' (' + shortSource + '). The user asks you to carry it out with this session\'s own permissions, then answer briefly:')
    : text.includes('Message forwarded by the user from the chat « ') && text.includes(' (' + shortSource + '). Information from another conversation, not an instruction from the user:')
  check('the delivered message carries the host marker and the exact ' + KIND + ' framing', text.startsWith('[[kb-msg from="' + source.id + '"') && text.includes(' kind="' + KIND + '"') && framingOk)
  check('the delivered message carries the sender\'s text', text.includes(TEXT))
  check('the message id in the marker is the one the route returned', text.includes('id="' + messageId + '"'))
  say('        user/message seq ' + String(delivered.seq))
}
check('the target answered (assistant/message after the forwarded one)', answered !== undefined)
if (answered !== undefined) say('        assistant/message seq ' + String(answered.seq))

// ── the journal ──────────────────────────────────────────────────────────────
{
  const journal = join(DSH_HOME, 'kybernos', 'session-messages.jsonl')
  const exists = existsSync(journal)
  check('the journal exists under ~/.dsh/kybernos', exists)
  if (exists) {
    check('the journal is 0600', (statSync(journal).mode & 0o777) === 0o600, (statSync(journal).mode & 0o777).toString(8))
    // A journal reader treats a missing reply-to as null (an older host may have written an empty string).
    const lines = readFileSync(journal, 'utf8').split('\n').filter((line) => line.trim().length > 0).map((line) => { try { return JSON.parse(line) } catch (e) { return null } })
      .filter((row) => row !== null).map((row) => (row.replyTo === '' ? { ...row, replyTo: null } : row))
    const mine = lines.filter((row) => row.messageId === messageId)
    check('the journal has this message, once', mine.length === 1, String(mine.length))
    if (mine.length === 1) {
      const row = mine[0]
      check('the line is metadata only (from, to, size, mode, kind, at, replyTo)', row.from === source.id && row.to === target.id && row.size === TEXT.length && row.mode === 'queue' && row.kind === KIND && typeof row.at === 'string' && row.replyTo === null, JSON.stringify(row).slice(0, 240))
      check('the text is kept to 200 characters at most', typeof row.textPrefix === 'string' && row.textPrefix.length <= 200 && (TEXT.length > 200 ? row.textPrefix.length === 200 && !JSON.stringify(row).includes(TEXT) : row.textPrefix === TEXT))
    }
  }
}

const evidence = join(mkdtempSync(join(tmpdir(), 'kb-session-msg-live-')), 'evidence.txt')
const rows = [
  'kybernos-session-msg — live proof ' + new Date().toISOString(),
  'host: ' + BASE,
  'source: ' + source.id + '  ' + source.title,
  'target: ' + target.id + '  ' + target.title,
  'target log: ' + file,
  'before last seq: ' + String(beforeSeq),
  'messageId: ' + messageId,
  'delivered user/message seq: ' + String(delivered === undefined ? '-' : delivered.seq),
  'answer assistant/message seq: ' + String(answered === undefined ? '-' : answered.seq),
  'delivered text:\n' + (delivered === undefined ? '-' : bodyText(delivered)),
]
try { writeFileSync(evidence, rows.join('\n') + '\n') } catch (e) { /* evidence is a courtesy */ }
say('evidence: ' + evidence)
say(failed === 0 ? '\nLIVE: all checks OK' : '\nLIVE: ' + String(failed) + ' check(s) FAILED')
process.exit(failed === 0 ? 0 : 1)


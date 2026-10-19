// A cloud computer's turn runner (ADR 0053 § 13.4, ADR 0052 § 25). A separate process next to DSH and the reporter, with no dependency and only its own restricted token: it takes the
// turns the platform addressed to THIS computer (a message the person wrote in a chat on their phone), has the computer's own DSH answer each one with its own tools, and hands the answer
// back. The platform pins the token to its own turns: nothing of another person's, of a team's, or of the platform's workers can reach it, and it reaches nothing else.
//
//   KYBERNOS_API             the platform's address       KYBERNOS_COMPUTER_TOKEN   its restricted token
//   DSH_HOME                 the profile on the volume    DSH_PORT                  DSH's loopback port (3081)
//
// The turn is run through the cloud plugin's own routes (`POST /kybernos-cloud/turn`, `POST /kybernos-cloud/turn/answer`, loopback, the computer's token and a same-origin call): the
// plugin holds the session seams, a sidecar cannot. A turn runs one at a time: the machine has one DSH. It is never fatal: a platform that cannot be reached is tried again with a pause, a token that
// is refused makes it quiet (one try every five minutes), and a turn that cannot finish is acknowledged `failed` with a code, never with a word of the person's.
import { join } from 'node:path'
import { sessionState } from './reporter.mjs'
import { identityBlock } from './kyby-identity.mjs'

const API = String(process.env.KYBERNOS_API || '').replace(/\/+$/u, '')
const TOKEN = String(process.env.KYBERNOS_COMPUTER_TOKEN || '')
const HOME = String(process.env.DSH_HOME || '')
const DSH_PORT = Number(process.env.DSH_PORT || 3081)
const IDLE_MS = Number(process.env.KYBERNOS_RUNNER_IDLE_MS || 2000)
const LEASE_SECONDS = Number(process.env.KYBERNOS_RUNNER_LEASE_SECONDS || 120)
const TURN_TIMEOUT_MS = Number(process.env.KYBERNOS_RUNNER_TURN_TIMEOUT_MS || 10 * 60_000)

const log = (line) => console.log('[runner] ' + line)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// ── what DSH is told ───────────────────────────────────────────────────────────────────────────
const MESSAGE_CHARS = 4000
const EARLIER_MESSAGES = 10
const clip = (s) => String(s ?? '').slice(0, MESSAGE_CHARS)

/**
 * The prompt of a turn, from what the platform says of it (the person and the thread's recent messages). The last message of the person is what to do; the ones before are background, given
 * as data. Who Kaby is comes from kyby-identity.mjs, never from the platform: the name a kyber carries on the server is not the assistant's.
 */
export function buildPrompt (context) {
  const messages = Array.isArray(context && context.messages) ? context.messages.filter((m) => m && typeof m.content === 'string') : []
  let at = -1
  messages.forEach((m, i) => { if (m.role === 'user') at = i })
  if (at < 0) return null
  const earlier = messages.slice(Math.max(0, at - EARLIER_MESSAGES), at)
  const history = earlier.map((m) => `${m.role === 'user' ? 'Person' : 'Kaby'}: ${clip(m.content)}`)
  const person = clip(context && context.person && context.person.name).trim().slice(0, 60)
  const telegram = context && context.source === 'telegram'
  const now = new Date()
  const head = identityBlock({
    channel: telegram ? 'telegram' : 'phone',
    body: 'cloud',
    personName: person,
    nowText: 'Time: ' + now.toISOString().slice(0, 16) + 'Z (UTC). The person\'s own timezone is not known here: if it matters, ask once and remember the answer.',
    thread: history
  })
  return [
    head,
    'Your answer is sent back to that chat as one message. When they ask you to do something, do it with your tools, then say what you did and what came back.',
    `Their message:\n\n${clip(messages[at].content)}`
  ].join('\n\n')
}

// ── the platform ─────────────────────────────────────────────────────────────────────────────
const said = new Set()
const sayOnce = (key, line) => { if (!said.has(key)) { said.add(key); log(line) } }

async function platform (method, path, body, timeoutMs = 15_000) {
  try {
    const r = await fetch(API + path, {
      method,
      headers: { authorization: 'Bearer ' + TOKEN, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs)
    })
    const text = await r.text()
    let json = null
    try { json = JSON.parse(text) } catch (e) { /* not json */ }
    if (r.status >= 300) sayOnce(`${path}:${r.status}`, `${method} ${path} answered ${r.status}`)
    else if (said.size > 0) { said.clear(); log(`${method} ${path} answered ${r.status}: the platform is reachable again`) }
    return { status: r.status, json }
  } catch (e) {
    const code = (e && e.cause && (e.cause.code || e.cause.name)) || (e && e.name) || 'error'
    sayOnce(`${path}:net:${code}`, `${method} ${path} could not be sent (${code})`)
    return { status: 0, json: null }
  }
}

// ── the computer's DSH, through the cloud plugin's routes ────────────────────────────────────
async function dsh (path, body) {
  try {
    const r = await fetch(`http://127.0.0.1:${DSH_PORT}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: `http://127.0.0.1:${DSH_PORT}`, authorization: 'Bearer ' + TOKEN },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000)
    })
    const text = await r.text()
    let json = null
    try { json = JSON.parse(text) } catch (e) { /* not json */ }
    return { status: r.status, json }
  } catch (e) { return { status: 0, json: null } }
}

// ── one turn ─────────────────────────────────────────────────────────────────────────────────
const CODE = /^[a-z0-9_.:-]{1,100}$/u
const failCode = (c) => (CODE.test(c) ? c : 'run_failed')

async function ack (jobId, body) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const r = await platform('POST', `/v1/runner/jobs/${jobId}/ack`, body)
    if (r.status === 200) return true
    // The lease was lost or the job is no longer ours: nothing more to say about it.
    if (r.status === 409 || r.status === 404 || r.status === 403) return false
    await sleep(Math.min(8000, 1000 * (attempt + 1)))
  }
  return false
}

/** What a turn with no words is asked once: the words, now. */
const NUDGE = 'Your last turn ended without a message to the person. Reply now, in one short message: what you did and what you found, or why you could not do it.'

/** Runs one claimed job to its acknowledgement. Returns what it ended as, for the log and the tests. */
export async function runOne (job, options = {}) {
  const poll = options.pollMs ?? 1000
  const timeout = options.timeoutMs ?? TURN_TIMEOUT_MS
  let seq = Number(job.next_event_seq || 0)
  let lost = false
  let cancelled = false
  const emit = async (type) => {
    await platform('POST', `/v1/runner/jobs/${job.id}/events`, { events: [{ seq, type, data: {} }] })
    seq += 1
  }
  // The lease is kept while the turn runs; a refused beat is a lease lost, and then nothing is acknowledged.
  const beat = setInterval(async () => {
    const r = await platform('POST', `/v1/runner/jobs/${job.id}/heartbeat`)
    if (r.status === 409 || r.status === 404) lost = true
    else if (r.status === 200 && r.json && r.json.cancel === true) cancelled = true
  }, Math.max(5000, Math.floor((LEASE_SECONDS * 1000) / 3)))
  const deadline = Date.now() + timeout
  /** Waits for the session's turn to close: 'closed', 'timeout', 'lost' or 'canceled'. */
  const waitClosed = async (sessionId) => {
    for (;;) {
      if (lost) return 'lost'
      if (cancelled) return 'canceled'
      const st = sessionState(sessionId)
      if (st !== null && st.closed) return 'closed'
      if (Date.now() > deadline) return 'timeout'
      await sleep(poll)
    }
  }
  const readText = async (sessionId) => {
    const r = await dsh('/kybernos-cloud/turn/answer', { sessionId })
    const ok = r.json && r.json.ok === true
    return {
      text: ok && typeof r.json.text === 'string' ? r.json.text.trim() : '',
      why: ok && typeof r.json.failure === 'string' && /^[a-z0-9_.:-]{1,90}$/u.test(r.json.failure) ? r.json.failure : ''
    }
  }
  try {
    const ctx = await platform('POST', `/v1/runner/jobs/${job.id}/context`)
    if (ctx.status !== 200 || ctx.json === null) {
      await ack(job.id, { status: 'failed', error: 'context_unavailable' })
      return 'context_unavailable'
    }
    const prompt = buildPrompt(ctx.json)
    if (prompt === null) {
      await ack(job.id, { status: 'failed', error: 'no_message' })
      return 'no_message'
    }
    await emit('started')
    const started = await dsh('/kybernos-cloud/turn', { prompt, jobId: job.id })
    const sessionId = started.json && started.json.ok === true ? started.json.sessionId : null
    if (started.status !== 200 || typeof sessionId !== 'string') {
      await ack(job.id, { status: 'failed', error: 'dsh_failed' })
      return 'dsh_failed'
    }
    await emit('model-call')
    let waited = await waitClosed(sessionId)
    if (waited === 'lost') return 'lease_lost'
    if (waited === 'canceled') { await ack(job.id, { status: 'canceled' }); return 'canceled' }
    if (waited === 'timeout') { await ack(job.id, { status: 'failed', error: 'run_timeout' }); return 'run_timeout' }
    let answer = await readText(sessionId)
    // A turn that ended with no words is asked for them once, in the same session: a model that only thought, or only called a tool, says what it found.
    if (answer.text === '') {
      const before = sessionState(sessionId)
      const more = await dsh('/kybernos-cloud/turn/continue', { sessionId, prompt: NUDGE })
      if (more.json && more.json.ok === true) {
        // The new turn must open before it can close: the projection changes, or its turn is open, within a few seconds.
        const opened = Date.now() + (options.openMs ?? 20_000)
        for (;;) {
          const st = sessionState(sessionId)
          if (st === null || st.closed === false || (before !== null && st.at !== before.at) || Date.now() > opened) break
          await sleep(Math.min(poll, 250))
        }
        waited = await waitClosed(sessionId)
        if (waited === 'lost') return 'lease_lost'
        if (waited === 'canceled') { await ack(job.id, { status: 'canceled' }); return 'canceled' }
        if (waited === 'closed') {
          const again = await readText(sessionId)
          if (again.text !== '') answer = again
          else if (again.why !== '') answer = { text: '', why: again.why }
        }
      }
    }
    if (answer.text === '') {
      // A turn that ended with no words says why when DSH said so: a code, never a message. That is what an owner reads in the platform's journal of the job.
      const error = answer.why === '' ? 'empty_answer' : failCode(('empty_answer.' + answer.why).slice(0, 100))
      await ack(job.id, { status: 'failed', error })
      return error
    }
    await emit('answered')
    const done = await ack(job.id, { status: 'done', result: { assistant_message: answer.text.slice(0, 100_000) } })
    return done ? 'done' : 'ack_refused'
  } catch (e) {
    await ack(job.id, { status: 'failed', error: failCode('run_failed') })
    return 'run_failed'
  } finally {
    clearInterval(beat)
  }
}

// ── the loop ─────────────────────────────────────────────────────────────────────────────────
async function dshAnswers () {
  try {
    const r = await fetch(`http://127.0.0.1:${DSH_PORT}/`, { signal: AbortSignal.timeout(2500) })
    await r.text()
    return true
  } catch (e) { return false }
}

async function main () {
  if (API === '' || TOKEN === '' || HOME === '') {
    log('no platform, token or profile given: nothing to run')
    return
  }
  log('started')
  while (!(await dshAnswers())) await sleep(2000)
  log(`waiting for turns addressed to this computer (${join(HOME, 'kybernos')})`)
  for (;;) {
    const r = await platform('POST', '/v1/runner/claim', { kinds: ['agent_turn'], limit: 1, lease_seconds: LEASE_SECONDS })
    if (r.status === 401 || r.status === 403 || r.status === 404) { await sleep(300_000); continue }
    const jobs = r.status === 200 && r.json && Array.isArray(r.json.jobs) ? r.json.jobs : []
    if (jobs.length === 0) { await sleep(IDLE_MS); continue }
    for (const job of jobs) {
      const out = await runOne(job)
      log(`a turn ended: ${out}`)
    }
  }
}

// Run as a program; a test imports the pure functions above and starts nothing.
if (process.argv[1] !== undefined && import.meta.url === new URL('file://' + process.argv[1]).href) {
  main().catch((e) => { log('stopped: ' + String((e && e.message) || e)); process.exit(0) })
}

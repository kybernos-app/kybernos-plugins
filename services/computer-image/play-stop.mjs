// Plays a STOP on the REAL computer image (docker), against a stand-in platform and a stand-in model that thinks for a long time. The platform hands the computer a turn, the model answers
// its first call with a tool and holds the second one open (a model call in flight), and a few seconds later the platform's heartbeat says `cancel`. What must hold, and what an image
// without the stop (the runner acknowledged `canceled` while DSH went on) fails:
//   - the model call that was in flight is CLOSED by the engine, at or before the moment the runner says `canceled` (the engine stopped before it was said);
//   - no model call of that turn begins after the acknowledgement;
//   - the job is acknowledged `canceled` once, never `done` or `failed`;
//   - the next job runs, and its first model call begins after the first one was closed (one turn at a time), and ends `done` (the engine is not left wedged by a stop).
// Nothing leaves the machine: the platform is a small server on this one, the image reaches it at host.docker.internal.
//
//   node services/computer-image/play-stop.mjs <image> [port]
//   KEEP=1 ...                  leaves the container (name kbc-stop) for a look at its log
//   CANCEL_AFTER_MS=3000 ...    how long after the model call begins the platform says `cancel`
//
// The mutation check is an image built from the commit BEFORE the stop (`git archive 0891c830`, the same commands): this script must FAIL on it (the held call is not closed, the next job starts
// while the engine is busy) and pass on one built from a commit that has `turn/stop`.
//
// The image is built as in docs/dev/computers.md (`--build-arg KB_LOCAL=1 --build-context kbsrc=<git archive folder>`). About two minutes once DSH is up. Needs docker; exit 0 = everything holds.
import { createServer } from 'node:http'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'

const image = process.argv[2] || 'kybernos-computer:stop1'
const port = Number(process.argv[3] || 39302)
const NAME = 'kbc-stop'
const t0 = Date.now()
const stamp = () => String(Math.round((Date.now() - t0) / 1000)).padStart(3, ' ') + 's'
const log = (...a) => console.log(stamp(), ...a)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const COMPUTER = randomUUID()
const CANCEL_AFTER_MS = Number(process.env.CANCEL_AFTER_MS || 3000)
const JOB1 = randomUUID()
const JOB2 = randomUUID()
const MARK1 = 'PLAY-STOP-ONE'
const MARK2 = 'PLAY-STOP-TWO'
const P = {
  ready: [], claims: 0, jobs: { [JOB1]: { events: [], acks: [], ackAt: 0 }, [JOB2]: { events: [], acks: [], ackAt: 0 } },
  cancelAt: 0, chats: [], held: null, handedTwo: false
}
const self = () => ({ computer_id: COMPUTER, name: 'Home', mode: 'sleep', desired: 'running', state: 'running', paused_reason: null, idle_suspend_seconds: 300, pending_tasks: 0, decided_approvals: 0, server_time: new Date().toISOString() })

const sse = (res, parts) => {
  const base = { id: 'chatcmpl-stop', object: 'chat.completion.chunk', created: 1, model: 'stub-1' }
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  for (const d of parts) res.write('data: ' + JSON.stringify({ ...base, choices: [d] }) + '\n\n')
}
const end = (res) => res.end('data: [DONE]\n\n')
const say = (res, text) => { sse(res, [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }, { index: 0, delta: {}, finish_reason: 'stop' }]); end(res) }
const callBash = (res, command) => {
  sse(res, [
    { index: 0, delta: { role: 'assistant', content: null, tool_calls: [{ index: 0, id: 'call_' + Math.random().toString(36).slice(2, 8), type: 'function', function: { name: 'bash', arguments: '' } }] }, finish_reason: null },
    { index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: JSON.stringify({ command, description: 'proof' }) } }] }, finish_reason: null },
    { index: 0, delta: {}, finish_reason: 'tool_calls' }])
  end(res)
}
const text = (m) => (typeof m.content === 'string' ? m.content : Array.isArray(m.content) ? m.content.map((c) => c.text || '').join('') : '')
const whole = (msgs) => msgs.map(text).join('\n')

const server = createServer((req, res) => {
  let raw = ''
  // body-cap: the stand-in platform of a replay script, on loopback, for one run on the developer's machine; it is not a route of a product
  req.on('data', (d) => { raw += d })
  req.on('end', () => {
    let body = {}
    try { body = raw === '' ? {} : JSON.parse(raw) } catch (e) { body = {} }
    const url = new URL(req.url, 'http://x')
    const json = (status, obj) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)) }
    const p = url.pathname
    if (p === '/v1/computer/ready') { P.ready.push(body); log('ready', JSON.stringify(body)); return json(200, self()) }
    if (p === '/v1/computer/heartbeat') return json(200, self())
    if (p === '/v1/computer/schedule') return json(200, self())
    if (p === '/v1/computer/runs') return json(200, { accepted: (body.runs || []).length, duplicates: 0, skipped: 0 })
    if (p === '/v1/computer/tasks/pending') return json(200, { ops: [] })
    if (req.method === 'GET' && p === '/v1/computer/approvals/decided') return json(200, { approvals: [] })
    // ── the runner protocol: claim, context, events, heartbeat, ack ──
    if (p === '/v1/runner/claim') {
      P.claims += 1
      // The first job at once; the second only after the first is acknowledged, so that a runner that took no pause would be handed it while the engine is still busy.
      if (P.jobs[JOB1].events.length === 0 && !P.jobs[JOB1].claimed) { P.jobs[JOB1].claimed = true; log('job 1 handed out'); return json(200, { jobs: [{ id: JOB1, kind: 'agent_turn', next_event_seq: 0 }] }) }
      if (P.jobs[JOB1].acks.length > 0 && !P.handedTwo) { P.handedTwo = true; log('job 2 handed out'); return json(200, { jobs: [{ id: JOB2, kind: 'agent_turn', next_event_seq: 0 }] }) }
      return json(200, { jobs: [] })
    }
    const m = /^\/v1\/runner\/jobs\/([^/]+)\/(context|events|heartbeat|ack)$/u.exec(p)
    if (m !== null && P.jobs[m[1]] !== undefined) {
      const job = P.jobs[m[1]]
      const which = m[1] === JOB1 ? 1 : 2
      if (m[2] === 'context') return json(200, { messages: [{ role: 'user', content: (which === 1 ? MARK1 + ': run the command echo working with the bash tool, then say done.' : MARK2 + ': say done.') }], person: { name: 'Ada' }, source: 'mcp', turn_id: randomUUID(), guard: 'ok' })
      if (m[2] === 'events') { for (const e of body.events || []) { job.events.push({ at: Date.now(), type: e.type, seq: e.seq }); log('job ' + which + ' event', e.type) } return json(200, { accepted: (body.events || []).length }) }
      if (m[2] === 'heartbeat') { const cancel = which === 1 && P.cancelAt > 0 && Date.now() >= P.cancelAt; if (cancel && !job.cancelSaid) { job.cancelSaid = Date.now(); log('heartbeat says CANCEL') } return json(200, { cancel, lease_expires_at: new Date(Date.now() + 120_000).toISOString() }) }
      if (m[2] === 'ack') { job.acks.push({ at: Date.now(), body }); job.ackAt = Date.now(); log('job ' + which + ' ACK', JSON.stringify(body).slice(0, 120)); return json(200, { id: m[1], status: body.status }) }
    }
    if (p === '/v1/models') return json(200, { data: [{ id: 'stub-1', object: 'model' }] })
    if (p === '/v1/chat/completions') {
      const msgs = Array.isArray(body.messages) ? body.messages : []
      const all = whole(msgs)
      const tools = Array.isArray(body.tools) ? body.tools : []
      const which = all.includes(MARK1) ? 1 : all.includes(MARK2) ? 2 : 0
      const rec = { at: Date.now(), which, tools: tools.length, n: msgs.length, lastRole: (msgs[msgs.length - 1] || {}).role }
      P.chats.push(rec)
      log('model call', 'job=' + which, 'tools=' + tools.length, 'messages=' + msgs.length, 'last=' + rec.lastRole)
      if (tools.length === 0 || which === 0) return say(res, 'Stub')
      const last = msgs[msgs.length - 1] || {}
      if (which === 2) return say(res, 'Done.')
      // Job 1: the first call asks for a tool; the call after the tool's result is the one that thinks for as long as it is allowed to.
      if (last.role !== 'tool') return callBash(res, 'echo working')
      P.held = { startedAt: Date.now(), closedAt: 0, ended: false }
      P.cancelAt = Date.now() + CANCEL_AFTER_MS
      log('the model call is held open: the platform will say cancel in', CANCEL_AFTER_MS / 1000, 's')
      sse(res, [{ index: 0, delta: { role: 'assistant', content: 'Let me think about this for a while' }, finish_reason: null }])
      const keep = setInterval(() => { try { res.write(': keepalive\n\n') } catch (e) { /* closed */ } }, 2000)
      // `close` on the response is the engine hanging up: the connection ended before this server ended it.
      res.on('close', () => { clearInterval(keep); if (!P.held.ended) P.held.closedAt = Date.now(); log('the held model call is CLOSED by the other side') })
      setTimeout(() => { if (P.held.closedAt === 0) { P.held.ended = true; clearInterval(keep); try { say(res, 'I finally have something to say.') } catch (e) { /* closed */ } } }, 90_000)
      return undefined
    }
    json(404, { error: 'not_found' })
    return undefined
  })
})
await new Promise((r) => server.listen(port, '0.0.0.0', r))
log('stand-in platform on', port, '| cancel', CANCEL_AFTER_MS / 1000, 's after the model call begins')

const sh = (...args) => spawnSync(args[0], args.slice(1), { encoding: 'utf8' })
sh('docker', 'rm', '-f', NAME)
sh('docker', 'volume', 'rm', '-f', NAME + '-data')
const run = sh('docker', 'run', '-d', '--name', NAME, '-v', NAME + '-data:/data',
  '-e', 'KYBERNOS_API=http://host.docker.internal:' + port, '-e', 'KYBERNOS_COMPUTER_ID=' + COMPUTER, '-e', 'KYBERNOS_COMPUTER_TOKEN=computer-token', '-e', 'KYBERNOS_COMPUTER_MODEL=stub-1',
  '-e', 'KYBERNOS_PUBLIC_HOST=localhost', '-e', 'KYBERNOS_GATE_TICKET_URL=http://127.0.0.1:9/v1/computer/tickets/redeem', '-e', 'KYBERNOS_GATE_TICKET_TOKEN=unused',
  '-e', 'KYBERNOS_REPORT_EVERY_MS=4000', '-e', 'KYBERNOS_RUNNER_IDLE_MS=1000', image)
log('container', run.status === 0 ? run.stdout.trim().slice(0, 12) : 'NOT STARTED: ' + run.stderr.slice(0, 300))
if (run.status !== 0) process.exit(2)

const until = async (label, fn, ms) => { const stop = Date.now() + ms; while (Date.now() < stop) { if (fn()) return true; await sleep(250) } log('TIMEOUT waiting for', label); return false }
const results = []
const check = (label, ok) => { results.push([label, ok]); log(ok ? 'ok  ' : 'FAIL', label) }
const running = () => sh('docker', 'inspect', '-f', '{{.State.Running}}', NAME).stdout.trim() === 'true'

await until('ready', () => P.ready.length > 0 || !running(), 180_000)
check('the computer says it is ready', P.ready.length > 0)
if (P.ready.length === 0) { console.log('--- container log'); console.log(sh('docker', 'logs', '--tail', '40', NAME).stdout.slice(-2500)); if (!process.env.KEEP) sh('docker', 'rm', '-f', NAME); server.close(); process.exit(1) }

await until('job 1 is claimed and its model call is held', () => P.held !== null, 180_000)
check('the turn started: the platform saw `started` and `model-call`', ['started', 'model-call'].every((t) => P.jobs[JOB1].events.some((e) => e.type === t)))
check('a model call was in flight when the platform said cancel', P.held !== null && P.cancelAt > P.held.startedAt)
await until('job 1 is acknowledged', () => P.jobs[JOB1].acks.length > 0, 60_000)
const a1 = P.jobs[JOB1].acks
const cancelled = a1.length > 0 ? a1[0].at : 0
check('the job was acknowledged `canceled`, once, and never `done` or `failed`', a1.length === 1 && a1[0].body.status === 'canceled')
check('...within 20 s of the cancel (the beat, the stop, the settle)', cancelled > 0 && P.jobs[JOB1].cancelSaid > 0 && cancelled - P.jobs[JOB1].cancelSaid < 20_000)
await sleep(1500)
check('the model call that was in flight was CLOSED by the engine', P.held !== null && P.held.closedAt > 0)
check('...at or before the moment the runner said `canceled` (the engine stopped first)', P.held !== null && P.held.closedAt > 0 && cancelled > 0 && P.held.closedAt <= cancelled + 300)
await until('job 2 is acknowledged', () => P.jobs[JOB2].acks.length > 0, 120_000)
const after = P.chats.filter((c) => c.which === 1 && c.tools > 0 && c.at > cancelled + 300)
check('no model call of the stopped turn began after the acknowledgement', after.length === 0)
const first2 = P.chats.find((c) => c.which === 2)
check('the next job began its first model call only after the first one was closed (one turn at a time)', first2 !== undefined && P.held !== null && P.held.closedAt > 0 && first2.at >= P.held.closedAt)
const a2 = P.jobs[JOB2].acks
check('the next job ended `done`: a stop leaves the engine usable', a2.length === 1 && a2[0].body.status === 'done')
const settleStop = sh('docker', 'logs', NAME)
const logText = settleStop.stdout + settleStop.stderr
check('the runner never had to say that DSH could not be told to stop', !/DSH could not be told to stop the turn/u.test(logText))
check('...and the stop was confirmed (no « has not confirmed it closed yet »)', !/has not confirmed it closed yet/u.test(logText))

console.log('\n' + results.filter((r) => r[1]).length + '/' + results.length + ' checks passed')
if (results.some((r) => !r[1])) { console.log('--- container log (tail)'); console.log(logText.slice(-3500)) }
if (!process.env.KEEP) sh('docker', 'rm', '-f', NAME)
server.close()
process.exit(results.every((r) => r[1]) ? 0 : 1)

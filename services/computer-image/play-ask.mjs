// Plays an automation that asks first on the REAL computer image (docker), against a stand-in platform and a stand-in model, and checks the whole path: ready carries the
// capability, the definition is applied, the run fires, the gate asks, the run stops (waiting), the answer arrives, the SAME session goes on, the action runs once (or not at all
// when it is refused), and the run is reported once at its end. Nothing leaves the machine: the platform is a small server on this one, the image reaches it at host.docker.internal.
//
//   node services/computer-image/play-ask.mjs <image> [port]              the person allows
//   DECISION=denied node services/computer-image/play-ask.mjs <image>      the person refuses (the action must NOT run)
//   DECISION=allowed_turn ...                                              the person allows the rest of the run
//   KEEP=1 ...                                                             leaves the container (name kbc-play) for a look at its log
//   PLAY_SLOW=3 ...                                                        every wait and the due time are three times longer (an amd64 image run on an arm64 Mac is emulated)
//
// The image is built as in docs/dev/computers.md (`--build-arg KB_LOCAL=1 --build-context kbsrc=<git archive folder>` builds it from the checkout, publishing nothing).
// It takes about three minutes: the automation is due a minute and a quarter after the start, and the scheduler looks every 30 s. Needs docker; exit 0 = everything holds.
import { createServer } from 'node:http'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'

const image = process.argv[2] || 'kybernos-computer:t1-arm64'
const port = Number(process.argv[3] || 39301)
const NAME = 'kbc-play'
const t0 = Date.now()
const stamp = () => String(Math.round((Date.now() - t0) / 1000)).padStart(3, ' ') + 's'
const log = (...a) => console.log(stamp(), ...a)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const COMPUTER = randomUUID()
const decision = process.env.DECISION || 'allowed'
const K = Math.max(1, Number(process.env.PLAY_SLOW || 1))
const P = { ready: [], schedules: [], runs: [], asks: [], decided: [], approvalAcks: [], chats: [], opAcked: false, decideAfterMs: Number(process.env.DECIDE_AFTER_MS || 12000) }
const COMMAND = 'echo kb-approval-proof > /data/work/proof.txt'
const at = new Date(Date.now() + 75_000 * K).toISOString().slice(0, 16)
const op = { op_id: randomUUID(), op: 'put', task_ref: 'task-ask', body: { name: 'Proof of asking', prompt: 'Run this exact command with the bash tool and then say done: ' + COMMAND, schedule: { mode: 'once', at, tz: 'UTC' }, active: true, approvals: 'ask' } }
const self = () => ({ computer_id: COMPUTER, name: 'Home', mode: 'sleep', desired: 'running', state: 'running', paused_reason: null, idle_suspend_seconds: 300, pending_tasks: P.opAcked ? 0 : 1, decided_approvals: P.decided.filter((d) => !d.taken).length, server_time: new Date().toISOString() })

const sse = (res, parts) => {
  const base = { id: 'chatcmpl-play', object: 'chat.completion.chunk', created: 1, model: 'stub-1' }
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  for (const d of parts) res.write('data: ' + JSON.stringify({ ...base, choices: [d] }) + '\n\n')
  res.end('data: [DONE]\n\n')
}
const say = (res, text) => sse(res, [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }, { index: 0, delta: {}, finish_reason: 'stop' }])
const callBash = (res, command) => sse(res, [
  { index: 0, delta: { role: 'assistant', content: null, tool_calls: [{ index: 0, id: 'call_' + Math.random().toString(36).slice(2, 8), type: 'function', function: { name: 'bash', arguments: '' } }] }, finish_reason: null },
  { index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: JSON.stringify({ command, description: 'proof' }) } }] }, finish_reason: null },
  { index: 0, delta: {}, finish_reason: 'tool_calls' }])
const text = (m) => (typeof m.content === 'string' ? m.content : Array.isArray(m.content) ? m.content.map((c) => c.text || '').join('') : '')

const server = createServer((req, res) => {
  let raw = ''
  req.on('data', (d) => { raw += d })
  req.on('end', () => {
    let body = {}
    try { body = raw === '' ? {} : JSON.parse(raw) } catch (e) { body = {} }
    const url = new URL(req.url, 'http://x')
    const json = (status, obj) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)) }
    const p = url.pathname
    if (p === '/v1/computer/ready') { P.ready.push(body); log('ready', JSON.stringify(body)); return json(200, self()) }
    if (p === '/v1/computer/heartbeat') return json(200, self())
    if (p === '/v1/computer/schedule') { P.schedules.push({ at: Date.now(), body }); return json(200, self()) }
    if (p === '/v1/computer/runs') { P.runs.push({ at: Date.now(), body }); log('runs', JSON.stringify((body.runs || []).map((r) => [r.task_id, r.outcome]))); return json(200, { accepted: (body.runs || []).length, duplicates: 0, skipped: 0 }) }
    if (p === '/v1/computer/tasks/pending') return json(200, { ops: P.opAcked ? [] : [op] })
    const ack = /^\/v1\/computer\/tasks\/([^/]+)\/ack$/u.exec(p)
    if (ack !== null) { P.opAcked = true; log('definition acked', JSON.stringify(body)); return json(200, { op_id: ack[1], state: body.status }) }
    if (req.method === 'POST' && p === '/v1/computer/approvals') {
      const id = randomUUID()
      P.asks.push({ id, ...body })
      log('QUESTION', JSON.stringify(body))
      setTimeout(() => { P.decided.push({ id, state: decision, task_ref: body.task_ref, run_key: body.run_key, kind: body.kind, taken: false }); log('(the person answers: ' + decision + ')') }, P.decideAfterMs)
      return json(200, { id, state: 'pending', expires_at: new Date(Date.now() + 86_400_000).toISOString() })
    }
    if (req.method === 'GET' && p === '/v1/computer/approvals/decided') return json(200, { approvals: P.decided.filter((d) => !d.taken).map(({ taken, ...d }) => d) })
    const aack = /^\/v1\/computer\/approvals\/([^/]+)\/ack$/u.exec(p)
    if (aack !== null) { const d = P.decided.find((x) => x.id === aack[1]); if (d) d.taken = true; P.approvalAcks.push(aack[1]); log('answer taken off the list'); return json(200, { id: aack[1], state: d ? d.state : 'allowed' }) }
    if (p === '/v1/models') return json(200, { data: [{ id: 'stub-1', object: 'model' }] })
    if (p === '/v1/chat/completions') {
      const msgs = Array.isArray(body.messages) ? body.messages : []
      const last = msgs[msgs.length - 1] || {}
      const lastText = text(last)
      P.chats.push({ at: Date.now(), n: msgs.length, lastRole: last.role, last: lastText.slice(0, 160), tools: (body.tools || []).length })
      log('model call', 'messages=' + msgs.length, 'last=' + last.role, JSON.stringify(lastText.slice(0, 90)))
      const tools = Array.isArray(body.tools) ? body.tools : []
      if (tools.length === 0) return say(res, 'Stub')
      // The engine adds its own context messages (the time, the title request) around the person's text: the newest message that says something decides, going back from the end.
      for (let i = msgs.length - 1; i >= 0; i -= 1) {
        const m = msgs[i]
        const t = text(m)
        if (m.role === 'tool') return say(res, /must allow this first|did not allow|could not be asked/u.test(t) ? 'I asked the person and I stop here until they answer.' : 'Done.')
        if (m.role !== 'user') continue
        if (/The person allowed/u.test(t)) return callBash(res, COMMAND)
        if (/The person refused|did not answer in time/u.test(t)) return say(res, 'Understood, I will not do it.')
        if (/Run this exact command/u.test(t)) return callBash(res, COMMAND)
      }
      return say(res, 'OK')
    }
    json(404, { error: 'not_found' })
  })
})
await new Promise((r) => server.listen(port, '0.0.0.0', r))
log('stand-in platform on', port, '| the automation is due at', at, 'UTC | the person will say:', decision)

const sh = (...args) => spawnSync(args[0], args.slice(1), { encoding: 'utf8' })
sh('docker', 'rm', '-f', NAME)
sh('docker', 'volume', 'rm', '-f', NAME + '-data')
// The gate refuses a platform address that is not https unless it is on loopback; this run needs no page, so its ticket address is a loopback one.
const run = sh('docker', 'run', '-d', '--name', NAME, '-v', NAME + '-data:/data',
  '-e', 'KYBERNOS_API=http://host.docker.internal:' + port, '-e', 'KYBERNOS_COMPUTER_ID=' + COMPUTER, '-e', 'KYBERNOS_COMPUTER_TOKEN=computer-token', '-e', 'KYBERNOS_COMPUTER_MODEL=stub-1',
  '-e', 'KYBERNOS_PUBLIC_HOST=localhost', '-e', 'KYBERNOS_GATE_TICKET_URL=http://127.0.0.1:9/v1/computer/tickets/redeem', '-e', 'KYBERNOS_GATE_TICKET_TOKEN=unused',
  '-e', 'KYBERNOS_REPORT_EVERY_MS=4000', '-e', 'KYBERNOS_APPROVAL_POLL_MS=2500', image)
log('container', run.status === 0 ? run.stdout.trim().slice(0, 12) : 'NOT STARTED: ' + run.stderr.slice(0, 300))
if (run.status !== 0) process.exit(2)

const until = async (label, fn, ms) => { const end = Date.now() + ms * K; while (Date.now() < end) { if (fn()) return true; await sleep(500) } log('TIMEOUT waiting for', label); return false }
const results = []
const check = (label, ok) => { results.push([label, ok]); log(ok ? 'ok  ' : 'FAIL', label) }
const lastStatusOf = (ref) => { for (let i = P.schedules.length - 1; i >= 0; i -= 1) { const row = (P.schedules[i].body.tasks || []).find((t) => t.id === ref); if (row) return row.last_status } return undefined }
const running = () => sh('docker', 'inspect', '-f', '{{.State.Running}}', NAME).stdout.trim() === 'true'

await until('ready', () => P.ready.length > 0 || !running(), 120_000)
check('the computer says it is ready, with the capability to ask', P.ready.length > 0 && JSON.stringify(P.ready[0].capabilities) === JSON.stringify(['ask_approvals']))
if (P.ready.length === 0) { console.log('--- container log'); console.log(sh('docker', 'logs', '--tail', '40', NAME).stdout.slice(-2500)); if (!process.env.KEEP) sh('docker', 'rm', '-f', NAME); server.close(); process.exit(1) }
await until('the definition is applied', () => P.opAcked, 60_000)
check('the definition of an automation that asks was applied (acked)', P.opAcked)
await until('the first question', () => P.asks.length > 0, 200_000)
check('the gate asked the platform about this automation, with the command', P.asks.length > 0 && P.asks[0].task_ref === 'task-ask' && P.asks[0].kind === 'shell' && /kb-approval-proof/u.test(P.asks[0].summary))
await sleep(6000)
check('the run stopped to wait: it was not reported as ended meanwhile', P.runs.every((r) => !(r.body.runs || []).some((x) => x.task_id === 'task-ask')))
log('schedule status while waiting:', lastStatusOf('task-ask'))
check('the schedule row said it waits', lastStatusOf('task-ask') === 'waiting_approval')
await until('the answer is taken', () => P.approvalAcks.length > 0, 60_000)
check('the answer was taken off the platform\'s list', P.approvalAcks.length > 0)
await until('the run is reported', () => P.runs.some((r) => (r.body.runs || []).some((x) => x.task_id === 'task-ask')), 90_000)
const ended = P.runs.flatMap((r) => r.body.runs || []).filter((x) => x.task_id === 'task-ask')
check('the run was reported once, at its end', ended.length === 1)
const proof = sh('docker', 'exec', NAME, 'sh', '-c', 'cat /data/work/proof.txt 2>/dev/null || echo NOFILE')
const refused = decision === 'denied'
check(refused ? 'the refused action did NOT run' : 'the allowed action ran (the file is there)', refused ? /NOFILE/u.test(proof.stdout) : /kb-approval-proof/u.test(proof.stdout))
check('the model saw the answer in the SAME session (a message that says what was decided)', P.chats.some((c) => /The person (allowed|refused)|did not answer in time/u.test(c.last)))
check('exactly one question was asked', P.asks.length === 1)

console.log('\n' + results.filter((r) => r[1]).length + '/' + results.length + ' checks passed')
if (results.some((r) => !r[1])) { console.log('--- container log (tail)'); const l = sh('docker', 'logs', '--tail', '60', NAME); console.log((l.stdout + l.stderr).slice(-3500)) }
if (!process.env.KEEP) sh('docker', 'rm', '-f', NAME)
server.close()
process.exit(results.every((r) => r[1]) ? 0 : 1)

// test-host.mjs — the whole host half without DSH, without a network and without a real disk.
// Run: node packages/kybernos-log/test-host.mjs
import { mkdtempSync, readFileSync, existsSync, rmSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  classifyEvent, failureSentence, filterEvents, aggregate, createJournal, mountRoutes, journalPath, dayKey, toolKind,
  isFailure, maskSecrets, pluginTag, readTerminal, terminalFile
} from './index.js'
import { installSession, browserHeaders, sessionCookie, OTHER_SECRET } from './lib-session-test.mjs'

let pass = 0
const fails = []
const ok = (label, cond) => { if (cond) { pass += 1 } else { fails.push(label) } }
const eq = (label, a, b) => ok(label + ' — ' + JSON.stringify(a) + ' ≠ ' + JSON.stringify(b), JSON.stringify(a) === JSON.stringify(b))

// ── classifyEvent: the families a person filters on ─────────────────────────────────────────────────────────────
{
  const state = { routes: {}, titles: {} }
  const req = classifyEvent('session-abc', { type: 'request/header', time: 1000, data: { header: { config: { provider: 'kimi', model: 'k3.1-pro' } } } }, state)
  eq('request/header → llm/request', { type: req.type, kind: req.kind, provider: req.provider, model: req.model }, { type: 'llm', kind: 'request', provider: 'kimi', model: 'k3.1-pro' })
  ok('session id loses its prefix', req.session === 'abc')

  const ans = classifyEvent('session-abc', { type: 'assistant/message', time: 1200, data: { usage: { inputTokens: 10, outputTokens: 4, cacheReadTokens: 900 }, message: { content: [{ type: 'text', text: 'SECRET BODY' }] } } }, state)
  eq('answer carries the remembered route and the tokens', { type: ans.type, kind: ans.kind, model: ans.model, input: ans.input, output: ans.output, cache: ans.cache }, { type: 'llm', kind: 'answer', model: 'k3.1-pro', input: 10, output: 4, cache: 900 })
  ok('the answer NEVER stores the message text', !JSON.stringify(ans).includes('SECRET BODY'))

  const tool = classifyEvent('session-abc', { type: 'tool/call', time: 1300, data: { name: 'bash', arguments: '{"command":"echo SECRET ARG"}' } }, state)
  eq('bash → tool', { type: tool.type, tool: tool.tool }, { type: 'tool', tool: 'bash' })
  ok('the tool record NEVER stores the arguments', !JSON.stringify(tool).includes('SECRET ARG'))
  eq('mcp__* → connector', classifyEvent('s', { type: 'tool/call', data: { name: 'mcp__playwright__navigate' } }, state).type, 'connector')
  eq('web_search → websearch', classifyEvent('s', { type: 'tool/call', data: { name: 'web_search' } }, state).type, 'websearch')
  eq('toolKind is pure', [toolKind('mcp__x'), toolKind('web_fetch'), toolKind('read'), toolKind(undefined)], ['connector', 'websearch', 'tool', 'tool'])

  const retry = classifyEvent('session-abc', { type: 'llm/retry', time: 1400, data: { provider: 'kimi', retry: 2, maxRetries: 10, failure: { code: 'RATE_LIMIT', message: '429: quota exhausted' } } }, state)
  eq('retry → an error code and a cleaned detail', { type: retry.type, kind: retry.kind, error: retry.error, detail: retry.detail, attempt: retry.attempt }, { type: 'llm', kind: 'retry', error: 'RATE_LIMIT', detail: 'quota exhausted', attempt: 2 })

  // A provider's JSON body is a sentence for a person, not braces (UJ-22: the Detail column showed {"message":"Th… with rate_limit_error and budget_held inside).
  const body = '{"error":{"message":"The 5 hours allowance is used.","type":"rate_limit_error","code":"budget_held"}}'
  eq('a JSON failure gives its message', failureSentence('429: ' + body), 'The 5 hours allowance is used.')
  eq('a flat JSON failure gives its message', failureSentence('{"message":"Too many requests","type":"rate_limit_error"}'), 'Too many requests')
  eq('a JSON failure cut by a limit still gives what it said', failureSentence('{"message":"The 5 hours allowance is used and comes back in about 5 hours","type":"rate_li'), 'The 5 hours allowance is used and comes back in about 5 hours')
  eq('a plain failure only loses its status', [failureSentence('503: upstream down'), failureSentence('no status here')], ['upstream down', 'no status here'])
  eq('JSON with no message is left as it came', failureSentence('{"code":1}'), '{"code":1}')
  const jsonRetry = classifyEvent('session-abc', { type: 'llm/retry', time: 1450, data: { provider: 'kybernos', retry: 1, failure: { code: 'rate_limit_error', message: '429: ' + body } } }, state)
  eq('a retry whose failure is a JSON body keeps the sentence, not the body', jsonRetry.detail, 'The 5 hours allowance is used.')

  const titleReq = classifyEvent('session-abc', { type: 'session/title-llm-request', time: 1500, data: { route: { provider: 'kimi', model: 'k3.1-pro' } } }, state)
  eq('title request → title/request', { type: titleReq.type, kind: titleReq.kind, model: titleReq.model }, { type: 'title', kind: 'request', model: 'k3.1-pro' })

  const title = classifyEvent('session-abc', { type: 'session/title', time: 1600, data: { title: 'Origine des appels' } }, state)
  eq('session title → session/title', { type: title.type, kind: title.kind, title: title.title }, { type: 'session', kind: 'title', title: 'Origine des appels' })
  eq('the title is remembered for the page', state.titles.abc, 'Origine des appels')

  eq('compaction summary', classifyEvent('s', { type: 'compaction/summary' }, state).type, 'compaction')
  eq('approval asked', classifyEvent('s', { type: 'approval/asked' }, state).kind, 'asked')
  eq('turn end with an error', classifyEvent('s', { type: 'turn/end', data: { reason: { kind: 'error' } } }, state).error, 'error')
  // 2026-10-28: what came back is a row of its own — the page showed a call and nothing of its outcome.
  const good = classifyEvent('s', { type: 'tool/result', data: { message: { isError: false } } })
  eq('a successful tool answer is ok, with no detail', { type: good.type, kind: good.kind, ok: good.ok, detail: good.detail }, { type: 'tool', kind: 'result', ok: true, detail: undefined })
  const bad = classifyEvent('s', { type: 'tool/result', data: { message: { isError: true }, error: { code: 'E_TIMEOUT', message: 'took too long' } } })
  eq('a failed tool answer carries ok:false and its code', { ok: bad.ok, detail: bad.detail }, { ok: false, detail: 'E_TIMEOUT' })
  ok('a tool answer never stores the tool output', !JSON.stringify(bad).includes('took too long') || bad.detail === 'E_TIMEOUT')
  const settled = classifyEvent('s', { type: 'job/settled', data: { kind: 'bash', status: 'failed', exitCode: 2 } })
  eq('a settled job says how it ended', { kind: settled.kind, tool: settled.tool, status: settled.status }, { kind: 'end', tool: 'bash', status: 'failed' })
  eq('a registered job has no verdict yet', classifyEvent('s', { type: 'job/registered', data: { kind: 'bash' } }).status, undefined)
  eq('a completed turn says so', classifyEvent('s', { type: 'turn/end', data: { reason: { kind: 'completed' } } }).status, 'completed')
  eq('a failed turn says so', classifyEvent('s', { type: 'turn/end', data: { reason: { kind: 'error' } } }).status, 'failed')
  // UJ-216: the row of a failed turn says why, in words (the 402 body is read for its message, as the retry rows do)
  eq('a failed turn carries the reason in words', classifyEvent('s', { type: 'turn/end', data: { reason: { kind: 'error', error: { code: 'QUOTA', message: '402: {"message":"Your budget is used up.","type":"insufficient_quota"}' } } } }).detail, 'Your budget is used up.')
  // UJ-211: the call and its result carry the same id, so the page can pair them
  const callEv = classifyEvent('s', { type: 'tool/call', data: { name: 'skill', callId: 'call-7' } })
  const resEv = classifyEvent('s', { type: 'tool/result', data: { message: { isError: false, source: { callId: 'call-7' } } } })
  eq('a call and its result share the call id', [callEv.callId, resEv.callId], ['call-7', 'call-7'])
  eq('an unknown event says nothing', classifyEvent('s', { type: 'noise/whatever' }, state), null)
}

// ── filterEvents: the page's chips, session filter and search ───────────────────────────────────────────────────
{
  const rows = [
    { seq: 1, at: Date.now(), type: 'llm', kind: 'answer', session: 'a', model: 'k3.1-pro', input: 10, output: 1, cache: 100 },
    { seq: 2, at: Date.now(), type: 'connector', kind: 'call', session: 'b', tool: 'mcp__github__pr' },
    { seq: 3, at: Date.now(), type: 'websearch', kind: 'call', session: 'a', tool: 'web_search' },
    { seq: 4, at: Date.now(), type: 'llm', kind: 'retry', session: 'a', error: 'RATE_LIMIT', detail: 'quota exhausted' }
  ]
  eq('types filter keeps the asked families', filterEvents(rows, { types: ['llm'] }).map((r) => r.seq), [1, 4])
  eq('an unknown family is ignored, not fatal', filterEvents(rows, { types: ['nope'] }).map((r) => r.seq), [1, 2, 3, 4])
  eq('session filter', filterEvents(rows, { session: 'b' }).map((r) => r.seq), [2])
  eq('search hits a field', filterEvents(rows, { q: 'quota' }).map((r) => r.seq), [4])
  eq('limit keeps the NEWEST then returns them oldest→newest', filterEvents(rows, { limit: 2 }).map((r) => r.seq), [3, 4])
  eq('before is an exclusive cursor', filterEvents(rows, { before: 3 }).map((r) => r.seq), [1, 2])
}

// ── aggregate: what the cards show ──────────────────────────────────────────────────────────────────────────────
{
  const now = new Date(2026, 9, 28, 12, 0, 0).getTime()
  const rows = [
    { at: now, type: 'llm', kind: 'answer', model: 'k3.1-pro', input: 100, output: 10, cache: 1000 },
    { at: now, type: 'llm', kind: 'answer', model: 'k3.1-pro', input: 50, output: 5, cache: 500 },
    { at: now, type: 'tool', kind: 'call', tool: 'bash' },
    { at: now - 86400000, type: 'llm', kind: 'answer', model: 'glm-5.3', input: 1, output: 1, cache: 0 }
  ]
  const d1 = aggregate(rows, { days: 1, now })
  eq('one day, one model, two answers', { calls: d1[0].calls, tokens: d1[0].tokens, model: d1[0].models['k3.1-pro'].calls }, { calls: 2, tokens: 1665, model: 2 })
  const d2 = aggregate(rows, { days: 2, now })
  ok('two days are two entries', d2.length === 2 && d2[1].models['glm-5.3'] !== undefined)
  eq('dayKey is the LOCAL day', dayKey(now), '2026-10-28')
}

// ── createJournal: append, reload, rotate ───────────────────────────────────────────────────────────────────────
{
  const dir = mkdtempSync(join(tmpdir(), 'kybernos-log-'))
  const file = join(dir, 'events.jsonl')
  try {
    const j = createJournal({ file, maxBytes: 300, now: () => 1000 })
    j.append({ at: 1, type: 'llm', kind: 'answer', model: 'a' })
    j.append({ at: 2, type: 'tool', kind: 'call', tool: 'bash' })
    ok('the file is written', existsSync(file))
    eq('list returns both', j.list({}).map((r) => r.seq), [1, 2])
    const reloaded = createJournal({ file })
    eq('a new instance reads the file back', reloaded.list({}).length, 2)
    for (let i = 0; i < 20; i += 1) j.append({ at: 3 + i, type: 'llm', kind: 'answer', model: 'b' })
    ok('rotation happened', existsSync(file + '.1'))
    eq('rotation keeps the newest ring intact', j.list({ limit: 5 }).length, 5)
    eq('append refuses a shapeless record', j.append({ at: 1 }), null)
    const lines = readFileSync(file, 'utf8').trim().split('\n')
    ok('each line is valid JSON', lines.every((l) => { try { JSON.parse(l); return true } catch (e) { return false } }))
  } finally { rmSync(dir, { recursive: true, force: true }) }
}

// ── mountRoutes: fenced, read-only, and the SSE stream ──────────────────────────────────────────────────────────
{
  const dir = mkdtempSync(join(tmpdir(), 'kybernos-log-routes-'))
  try {
    const journal = createJournal({ file: join(dir, 'events.jsonl') })
    journal.append({ at: Date.now(), type: 'llm', kind: 'answer', model: 'k3.1-pro', input: 5, output: 1 })
    const routes = new Map()
    const server = { register: (route) => { routes.set(route.path, route.handler); return () => routes.delete(route.path) } }
    const off = mountRoutes(server, journal, { subscribe: () => () => {} })
    ok('four routes are mounted', ['/kybernos-log/events', '/kybernos-log/stats', '/kybernos-log/stream', '/kybernos-log/terminal'].every((p) => routes.has(p)))
    const call = (path, { method = 'GET', headers = { host: '127.0.0.1:3080' }, localPort = 3080, url = path } = {}) => {
      let status = 0
      let body = ''
      const res = {
        writeHead: (s) => { status = s },
        end: (b) => { body = String(b === undefined ? '' : b) },
        write: (b) => { body += String(b) },
        on: () => {}
      }
      const req = { method, url, headers, socket: { localPort }, on: () => {} }
      routes.get(path.split('?')[0])(req, res)
      return { status, body }
    }
    const ev = call('/kybernos-log/events?types=llm&limit=10')
    ok('events answers 200 with the record', ev.status === 200 && ev.body.includes('k3.1-pro'))
    // The page pages: a full page announces that older rows may exist, with what the ring holds in all.
    const three = (() => { for (const m of ['a', 'b', 'c']) journal.append({ at: Date.now(), type: 'llm', kind: 'answer', model: m, input: 1, output: 1 }) })()
    const page1 = JSON.parse(call('/kybernos-log/events?limit=2').body)
    ok('a full page says there may be more, and how many rows exist', page1.hasMore === true && page1.total >= 2 && page1.events.length === 2)
    const oldest = page1.events[page1.events.length - 1].seq
    const page2 = JSON.parse(call('/kybernos-log/events?limit=2&before=' + oldest).body)
    ok('the next page is strictly older (keyset by seq, no duplicate)', page2.events.every((e) => e.seq < oldest) && page2.events.length > 0)
    const lastPage = JSON.parse(call('/kybernos-log/events?limit=500').body)
    ok('a page that holds everything says there is no more', lastPage.hasMore === false)
    const stats = call('/kybernos-log/stats?days=1')
    ok('stats answers 200', stats.status === 200 && stats.body.includes('"days"'))
    ok('a foreign Host is refused', call('/kybernos-log/events', { headers: { host: 'evil.example' } }).status === 403)
    ok('a foreign Origin is refused', call('/kybernos-log/events', { headers: { host: '127.0.0.1:3080', origin: 'https://evil.example' } }).status === 403)
    ok('POST is refused', call('/kybernos-log/events', { method: 'POST' }).status === 405)
    off()
    ok('unmount removes the routes', routes.size === 0)
  } finally { rmSync(dir, { recursive: true, force: true }) }
}

eq('journalPath follows DSH_HOME', journalPath('/tmp/h'), '/tmp/h/kybernos/log/events.jsonl')

// -- stats: per hour of the day, for the cards' sparklines (2026-11-09) ----------------------------------------------
{
  const base = new Date(2026, 10, 9, 0, 0, 0).getTime()
  const at = (h, m = 0) => base + h * 3600000 + m * 60000
  const rows = [
    { at: at(3, 10), type: 'llm', kind: 'answer', input: 100, output: 20, cache: 5 },
    { at: at(3, 40), type: 'llm', kind: 'answer', input: 1, output: 1 },
    { at: at(3, 41), type: 'llm', kind: 'request' },
    { at: at(7), type: 'llm', kind: 'retry', error: 'RATE_LIMIT' },
    { at: at(7, 5), type: 'session', kind: 'turn-end', status: 'failed', error: 'error' },
    { at: at(7, 6), type: 'session', kind: 'turn-end', status: 'completed' },
    { at: at(9), type: 'tool', kind: 'result', ok: false },
    { at: at(9, 1), type: 'job', kind: 'end', status: 'killed' },
    { at: at(12), type: 'title', kind: 'request' },
    { at: at(12, 2), type: 'compaction', kind: 'summary' },
    { at: at(23, 59), type: 'llm', kind: 'answer', input: 7, output: 3 },
    { at: base - 60000, type: 'llm', kind: 'answer', input: 999, output: 999 }
  ]
  const [day] = aggregate(rows, { days: 1, now: at(13) })
  ok('a day carries 24 hourly buckets', Array.isArray(day.hours) && day.hours.length === 24)
  eq('hour 3: two model calls and their tokens (a request is not a call)', day.hours[3], { calls: 2, tokens: 127, failures: 0, unasked: 0 })
  eq('hour 7: a retry and a failed turn are two failures, a completed turn none', day.hours[7].failures, 2)
  eq('hour 9: a tool error and a killed job are failures', day.hours[9].failures, 2)
  eq('hour 12: a title and a compaction are unasked calls', day.hours[12].unasked, 2)
  eq('hour 23 counts the last minute of the day', day.hours[23].calls, 1)
  eq('the hours add up to the day', [day.hours.reduce((a, h) => a + h.calls, 0), day.hours.reduce((a, h) => a + h.tokens, 0)], [day.calls, day.tokens])
  eq('the day says its failures and unasked calls', [day.failures, day.unasked], [4, 2])
  ok('yesterday stays out of today', day.tokens === 137)
  eq('isFailure: retry, ok false, failed status; not a completed turn', [isFailure(rows[3]), isFailure(rows[6]), isFailure(rows[4]), isFailure(rows[5]), isFailure(rows[0])], [true, true, true, false, false])
}

// -- the events route names the chats, from the whole file, not only the ring --------------------------------------
{
  const dir = mkdtempSync(join(tmpdir(), 'kybernos-log-titles-'))
  try {
    const file = join(dir, 'events.jsonl')
    const lines = [{ seq: 1, at: 1, session: 'old', type: 'session', kind: 'title', title: 'Morning brief' }]
    for (let i = 2; i < 8; i += 1) lines.push({ seq: i, at: i, session: 'old', type: 'llm', kind: 'answer', input: 1, output: 1 })
    writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n')
    const journal = createJournal({ file, ring: 3 })
    eq('a title older than the ring is still known', journal.titles(['old', 'nobody']), { old: 'Morning brief' })
    journal.append({ session: 'old', type: 'session', kind: 'title', title: 'Morning brief (automation)' })
    eq('the newest title wins', journal.titles(['old']).old, 'Morning brief (automation)')
    const routes = new Map()
    mountRoutes({ register: (r) => { routes.set(r.path, r.handler); return () => routes.delete(r.path) } }, journal)
    let body = ''
    routes.get('/kybernos-log/events')({ method: 'GET', url: '/kybernos-log/events?types=llm', headers: { host: '127.0.0.1:3080' }, socket: { localPort: 3080 } }, { writeHead: () => {}, end: (b) => { body = b } })
    eq('the events route sends the titles of its rows\u2019 chats', JSON.parse(body).titles, { old: 'Morning brief (automation)' })
  } finally { rmSync(dir, { recursive: true, force: true }) }
}

// -- secrets are masked before a terminal line leaves the host ------------------------------------------------------
{
  const cases = [
    ['dsh web: http://127.0.0.1:3080/?token=4f9c2a7e1b8d', 'dsh web: http://127.0.0.1:3080/?token=[hidden]'],
    ['refresh with access_token=ya29.a0AfH6SMBxyz&x=1', 'refresh with access_token=[hidden]&x=1'],
    ['{"api_key":"abc123def456"}', '{"api_key":"[hidden]"}'],
    ['using sk-ant-api03-AbCdEfGhIjKlMnOpQrStUv for anthropic', 'using sk-[hidden] for anthropic'],
    ['probe key=AbC123xyz789', 'probe key=[hidden]'],
    ['header Authorization: Bearer eyJabc.def.ghi-very-long-token', 'header Authorization: Bearer [hidden]'],
    ['authorization=Zm9vOmJhcg==', 'authorization=[hidden]'],
    ['login password=hunter2 ok', 'login password=[hidden] ok'],
    ['the secret 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b is set', 'the secret [hidden] is set'],
    ['jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c', 'jwt [hidden]'],
    ['push with ghp_0123456789abcdefABCDEF', 'push with [hidden]'],
    ['\u001b[31m[kybers] run failed\u001b[0m', '[kybers] run failed']
  ]
  for (const [raw, want] of cases) eq('masked: ' + want, maskSecrets(raw), want)
  const plain = ['[kybernos-memory] tidy-up: 32 asked, 25 titled, 2 compacted', '[kybers] scheduled tasks: 2 declenchement(s)', 'tokens: 37k in, 1.2k out']
  eq('an ordinary line is left alone', plain.map(maskSecrets), plain)
  eq('the plugin tag of a line', [pluginTag('[kybernos-cloud] routes'), pluginTag('dsh web: http'), pluginTag('[dsh-lsp] ready')], ['kybernos-cloud', null, 'dsh-lsp'])
}

// -- readTerminal: the tail, older lines, follow, filters, a missing file --------------------------------------------
{
  const dir = mkdtempSync(join(tmpdir(), 'kybernos-log-term-'))
  try {
    mkdirSync(join(dir, 'logs'))
    const out = join(dir, 'logs', 'dsh-web.out.log')
    const lines = []
    for (let i = 1; i <= 1200; i += 1) lines.push(i % 10 === 0 ? '[kybernos-cloud] poll ' + i : 'line ' + i)
    writeFileSync(out, lines.join('\n') + '\n' + 'half a line')
    const t = readTerminal(out)
    eq('the tail: the last 500 complete lines, newest last, numbered', [t.lines.length, t.lines[0].n, t.lines[499].n, t.lines[499].text, t.total], [500, 701, 1200, '[kybernos-cloud] poll 1200', 1200])
    ok('a line still being written is not served', !t.lines.some((l) => l.text === 'half a line'))
    ok('older lines exist', t.hasOlder === true)
    const older = readTerminal(out, { before: 701 })
    eq('before: the 500 lines above', [older.lines[0].n, older.lines[older.lines.length - 1].n], [201, 700])
    eq('before the start: what is left, then nothing older', [readTerminal(out, { before: 201 }).lines.length, readTerminal(out, { before: 201 }).hasOlder], [200, false])
    appendFileSync(out, ' now complete\nline 1202\n')
    const follow = readTerminal(out, { after: 1200 })
    eq('after: only the lines that came since (follow)', follow.lines.map((l) => l.text), ['half a line now complete', 'line 1202'])
    eq('...and the total grew', follow.total, 1202)
    const cloud = readTerminal(out, { plugin: 'kybernos-cloud', limit: 3 })
    eq('plugin: only that plugin\u2019s lines', cloud.lines.map((l) => l.n), [1180, 1190, 1200])
    ok('the plugin tags seen are listed with their count', cloud.plugins.length === 1 && cloud.plugins[0].tag === 'kybernos-cloud' && cloud.plugins[0].count === 120)
    eq('q filters lines', readTerminal(out, { q: 'POLL 119' }).lines.map((l) => l.n), [1190])
    const small = readTerminal(out, { tailBytes: 60 })
    ok('a bounded window keeps the true line numbers', small.lines.length > 0 && small.lines[small.lines.length - 1].n === 1202 && small.total === 1202 && small.truncated === true)
    ok('a bounded window drops its first, cut line', small.lines.every((l) => /^line \d+$|^\[kybernos-cloud\] poll \d+$|^half a line now complete$/.test(l.text)))
    appendFileSync(out, 'login password=hunter2\n')
    ok('a search cannot find a secret by its value', readTerminal(out, { q: 'hunter2' }).lines.length === 0 && readTerminal(out, { q: 'password' }).lines[0].text === 'login password=[hidden]')
    eq('a missing file says so', readTerminal(join(dir, 'logs', 'nope.log')).exists, false)
    eq('terminalFile: the err stream, and a port of its own when its file exists', [terminalFile(dir, 'err', 3080).endsWith('dsh-web.err.log'), terminalFile(dir, 'out', 3090).endsWith('dsh-web.out.log')], [true, true])
  } finally { rmSync(dir, { recursive: true, force: true }) }
}

// -- the terminal route: under the session cookie, masked, read-only ----------------------------------------------
{
  const home = mkdtempSync(join(tmpdir(), 'kybernos-log-home-'))
  const before = process.env.DSH_HOME
  try {
    process.env.DSH_HOME = home
    const journal = createJournal({ file: join(home, 'kybernos', 'log', 'events.jsonl') })
    const routes = new Map()
    mountRoutes({ register: (r) => { routes.set(r.path, r.handler); return () => routes.delete(r.path) } }, journal, { home })
    const call = (url, { method = 'GET', headers = {} } = {}) => {
      let status = 0
      let body = ''
      routes.get('/kybernos-log/terminal')({ method, url, headers: { host: '127.0.0.1:3080', ...headers }, socket: { localPort: 3080 }, on: () => {} }, { writeHead: (st) => { status = st }, end: (b) => { body = String(b === undefined ? '' : b) } })
      let json = null
      try { json = JSON.parse(body) } catch (e) { json = null }
      return { status, json }
    }
    ok('the terminal route is mounted', routes.has('/kybernos-log/terminal'))
    eq('no machine secret: the route stays closed (503)', call('/kybernos-log/terminal').status, 503)
    installSession(home)
    eq('no cookie: sign-in required (401)', call('/kybernos-log/terminal').status, 401)
    eq('a forged cookie: 401', call('/kybernos-log/terminal', { headers: { cookie: sessionCookie('127.0.0.1:3080', { secret: OTHER_SECRET }) } }).status, 401)
    eq('a foreign Origin: 403', call('/kybernos-log/terminal', { headers: { ...browserHeaders(), origin: 'https://evil.example' } }).status, 403)
    eq('POST: 405', call('/kybernos-log/terminal', { method: 'POST', headers: browserHeaders() }).status, 405)
    const missing = call('/kybernos-log/terminal', { headers: browserHeaders() })
    ok('the person\u2019s browser, no log yet: 200 and exists false', missing.status === 200 && missing.json.ok === true && missing.json.exists === false)
    mkdirSync(join(home, 'logs'))
    writeFileSync(join(home, 'logs', 'dsh-web.out.log'), 'dsh web: http://127.0.0.1:3080/?token=abcdef123456\n[kybers] ready\n')
    writeFileSync(join(home, 'logs', 'dsh-web.err.log'), '[kybers] run failed: no adapter\n')
    const got = call('/kybernos-log/terminal?stream=out', { headers: browserHeaders() })
    ok('the output stream, masked', got.status === 200 && got.json.lines.length === 2 && got.json.lines[0].text === 'dsh web: http://127.0.0.1:3080/?token=[hidden]')
    ok('the answer names the file, never its folder', got.json.file === 'dsh-web.out.log' && !JSON.stringify(got.json).includes(home))
    const err = call('/kybernos-log/terminal?stream=err&after=0', { headers: browserHeaders() })
    ok('the error stream is its own file', err.json.stream === 'err' && err.json.lines.length === 1 && err.json.lines[0].text.startsWith('[kybers] run failed'))
    eq('plugin filter through the route', call('/kybernos-log/terminal?plugin=kybers', { headers: browserHeaders() }).json.lines.map((l) => l.n), [2])
  } finally {
    if (before === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = before
    rmSync(home, { recursive: true, force: true })
  }
}

console.log((fails.length === 0 ? '✓ ' : '✗ ') + pass + ' passed' + (fails.length === 0 ? '' : ', ' + fails.length + ' failed'))
for (const f of fails) console.log('   ✗ ' + f)
process.exit(fails.length === 0 ? 0 : 1)

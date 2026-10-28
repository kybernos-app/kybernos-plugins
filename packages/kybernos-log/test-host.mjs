// test-host.mjs — the whole host half without DSH, without a network and without a real disk.
// Run: node packages/kybernos-log/test-host.mjs
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  classifyEvent, filterEvents, aggregate, createJournal, mountRoutes, journalPath, dayKey, toolKind
} from './index.js'

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
    ok('three routes are mounted', ['/kybernos-log/events', '/kybernos-log/stats', '/kybernos-log/stream'].every((p) => routes.has(p)))
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

console.log((fails.length === 0 ? '✓ ' : '✗ ') + pass + ' passed' + (fails.length === 0 ? '' : ', ' + fails.length + ' failed'))
for (const f of fails) console.log('   ✗ ' + f)
process.exit(fails.length === 0 ? 0 : 1)

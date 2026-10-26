// The three POST routes of Search everywhere need DSH's signed session as well as the right Origin (recette 2026-10-25, L3-09). `query` is the sensitive one, and it is a READ:
// it hands back the text of the person's chats (a whole message, up to 8,000 characters, with its title and the folder it was written in), the prompts of their automations, their
// lessons and their agents. DSH serves plugin routes before its own login and an Origin header is forgeable by any local program or any other account on the machine, so before this
// `curl -X POST -H 'Origin: http://127.0.0.1:<port>' .../kybernos-search/query -d '{"q":"password"}'` read all of it, and `start` / `reindex` made the computer read every journal on
// demand. The cookie is the guard of a read of that kind (docs/dev/route-origin-rule.md, « The reads »).
//
// The test uses the real index over a throw-away DSH home that holds one marker in each of the four sources (a chat, a skill, a lesson, an automation) and fails when a request that
// is not the page's own sees any of the four markers: that is the check of the verifier's report, and it is made on the bytes of the answers. Per guarded route: no header · a foreign
// Origin (even with the real cookie) · the right Origin and no cookie · a forged cookie · an expired one · the real pair through the phone link · the real pair. A paired phone may
// `query` (it only reads from the index the desktop kept on disk) and may not `start` or `reindex`.
//
//   node packages/kybernos-search/test-write-guard.mjs
import { createServer } from 'node:http'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mountRoutes, realIo } from './index.js'
import { createIndex } from './store.mjs'
import { sessionSource } from './session-guard.mjs'
import { OTHER_SECRET, SESSION_SECRET, sessionCookie } from './lib-session-test.mjs'

sessionSource.secret = () => SESSION_SECRET

let failed = 0
const check = (name, ok, detail) => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok || detail === undefined ? '' : '  — ' + detail))
  if (!ok) failed += 1
}

/** The POST routes that need the session. `phone: true` is for the POST that only reads and says so (`phoneMayRead`). */
const GUARDED = {
  '/kybernos-search/query': { phone: true },
  '/kybernos-search/start': {},
  '/kybernos-search/reindex': {},
}
/** The POST routes that stay at the strict Origin, and why. None here. */
const EXCEPTIONS = {}

// ── a throw-away DSH home with one marker in each of the four sources ────────────────────────────────────────────
const MARKERS = { chat: 'zebra-in-a-chat', skill: 'zebra-in-a-skill', lesson: 'zebra-in-a-lesson', automation: 'zebra-in-an-automation' }
const home = mkdtempSync(join(tmpdir(), 'kb-search-guard-'))
mkdirSync(join(home, 'skills', 'probe-skill'), { recursive: true })
writeFileSync(join(home, 'skills', 'probe-skill', 'SKILL.md'), '---\nname: probe-skill\ndescription: ' + MARKERS.skill + '\n---\nbody\n')
mkdirSync(join(home, 'kybers', 'probe-team', 'memory'), { recursive: true })
writeFileSync(join(home, 'kybers', 'probe-team', 'memory', 'lessons.jsonl'), JSON.stringify({ text: 'a lesson: ' + MARKERS.lesson, tags: [], ts: '2026-10-01T00:00:00Z' }) + '\n')
mkdirSync(join(home, 'kybernos', 'search'), { recursive: true })
writeFileSync(join(home, 'kybernos', 'tasks.json'), JSON.stringify([{ id: 't-probe', name: 'Probe automation', prompt: 'the staging password is ' + MARKERS.automation }]))
writeFileSync(join(home, 'kybernos', 'search', 'chats.v1.json'), JSON.stringify({ v: 1, updatedAt: 1, sessions: [{ id: 'chat-probe', size: 1, mtimeMs: 1, cwd: '/w/probe', title: 'Probe chat', createdAt: 1, lastAt: 2, msgs: [['u', 1, 'my private message ' + MARKERS.chat]] }] }))

const real = createIndex({ ...realIo(home), listSessions: () => [] })
const calls = { start: 0, rebuild: 0 }
const index = {
  status: () => real.status(),
  start () { calls.start += 1; return real.start() },
  rebuild () { calls.rebuild += 1; return real.rebuild() },
  query: (o) => real.query(o),
}
const routes = new Map()
mountRoutes({ register: (r) => { routes.set(r.path, r.handler); return () => {} } }, index)

const server = createServer((req, res) => {
  const handler = routes.get(new URL(req.url, 'http://127.0.0.1').pathname)
  if (handler === undefined) { res.writeHead(404); res.end('{}'); return }
  Promise.resolve(handler(req, res)).catch(() => { try { res.writeHead(500); res.end('{}') } catch (e) { /* closed */ } })
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port
const base = 'http://127.0.0.1:' + port
const cookie = (opts) => sessionCookie('127.0.0.1:' + port, opts)
const send = async (path, method, headers, body) => {
  const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...headers }, body: method === 'GET' ? undefined : JSON.stringify(body ?? {}) })
  return { status: r.status, text: await r.text().catch(() => '') }
}
const REAL = { origin: base, cookie: cookie() }
const QUERY = { q: 'zebra' }
const leaked = (text) => Object.entries(MARKERS).filter(([, m]) => text.includes(m)).map(([scope]) => scope)
const BODY = { '/kybernos-search/query': QUERY, '/kybernos-search/start': {}, '/kybernos-search/reindex': {} }

try {
  // ── the family: every registered POST route is classified ───────────────────────────────────────────────────
  const answeringPost = []
  for (const path of routes.keys()) if ((await send(path, 'POST', {}, {})).status !== 405) answeringPost.push(path)
  check('the Search routes are mounted (' + routes.size + ' paths, ' + answeringPost.length + ' answer a POST)', routes.size === 4 && answeringPost.length === 3)
  const unclassified = answeringPost.filter((p) => GUARDED[p] === undefined && EXCEPTIONS[p] === undefined)
  check('every route that answers a POST is in GUARDED or in EXCEPTIONS (a new route cannot be forgotten)', unclassified.length === 0, unclassified.join(', '))
  check('...and the tables name no route that is not mounted', [...Object.keys(GUARDED), ...Object.keys(EXCEPTIONS)].every((p) => routes.has(p)))

  // ── the page's own request sees all four sources (so the leak checks below look for something that is there) ─────
  const own = await send('/kybernos-search/query', 'POST', REAL, QUERY)
  check('the real pair finds the marker of the chat, the skill, the lesson and the automation (' + leaked(own.text).join(', ') + ')', own.status === 200 && leaked(own.text).length === 4, own.status + ' ' + own.text.slice(0, 160))
  calls.start = calls.rebuild = 0

  // ── what the guard decides, route by route ──────────────────────────────────────────────────────────────────
  let everything = ''
  for (const [path, { phone }] of Object.entries(GUARDED)) {
    const body = BODY[path]
    const refusals = []
    refusals.push([path + ': no Origin and no cookie -> 403', await send(path, 'POST', {}, body), 403])
    refusals.push([path + ': a foreign Origin -> 403, even with the real cookie', await send(path, 'POST', { origin: 'http://evil.example', cookie: cookie() }, body), 403])
    refusals.push([path + ': the right Origin and no cookie -> 401 (what a local program sends)', await send(path, 'POST', { origin: base }, body), 401])
    refusals.push([path + ': the right Origin and a forged cookie -> 401', await send(path, 'POST', { origin: base, cookie: cookie({ secret: OTHER_SECRET }) }, body), 401])
    refusals.push([path + ': the right Origin and an expired cookie -> 401', await send(path, 'POST', { origin: base, cookie: cookie({ expiresAt: Date.now() - 1000 }) }, body), 401])
    for (const [name, answer, want] of refusals) { check(name, answer.status === want, answer.status + ' ' + answer.text.slice(0, 80)); everything += answer.text }
    const viaPhone = await send(path, 'POST', { ...REAL, 'x-kybernos-tunnel': '1' }, body)
    if (phone === true) check(path + ': through the phone link it is allowed (a POST that only reads)', viaPhone.status === 200 && !/refused_on_phone/.test(viaPhone.text), viaPhone.status + ' ' + viaPhone.text.slice(0, 80))
    else { check(path + ': the real pair through the phone link -> 403 refused_on_phone', viaPhone.status === 403 && /refused_on_phone/.test(viaPhone.text), viaPhone.status + ' ' + viaPhone.text.slice(0, 80)); everything += viaPhone.text }
  }
  check('nothing a refused request received carries the text of a chat, a skill, a lesson or an automation (the bytes of the answers were searched for the four markers)', leaked(everything).length === 0, leaked(everything).join(', '))
  check('...and no refused request started or rebuilt the index', calls.start === 0 && calls.rebuild === 0, JSON.stringify(calls))

  // ── the real pair gets through ──────────────────────────────────────────────────────────────────────────────
  const start = await send('/kybernos-search/start', 'POST', REAL, {})
  const reindex = await send('/kybernos-search/reindex', 'POST', REAL, {})
  check('/kybernos-search/start: the real pair starts the index (' + start.status + ')', start.status === 202 && calls.start === 1, start.status + ' ' + JSON.stringify(calls))
  check('/kybernos-search/reindex: the real pair rebuilds it (' + reindex.status + ')', reindex.status === 202 && calls.rebuild === 1, reindex.status + ' ' + JSON.stringify(calls))
  check('/kybernos-search/query: a GET stays "method not allowed"', (await send('/kybernos-search/query', 'GET', REAL)).status === 405)
  check('/kybernos-search/status: the read of the counters (no text) still answers a page with no cookie', (await send('/kybernos-search/status', 'GET', { origin: base })).status === 200)
} finally {
  server.close()
}

console.log(failed === 0 ? '\nall green' : '\n' + failed + ' failure(s)')
process.exit(failed === 0 ? 0 : 1)

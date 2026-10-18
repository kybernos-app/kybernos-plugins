#!/usr/bin/env node
// The feedback box (V-10): the « Send feedback » form saves one JSON line in <DSH home>/kybernos/feedback.jsonl and an Export button
// copies the file. No network: the module (feedback-box.mjs) is driven alone, then the two routes of the REAL index.js are driven with
// fake requests in a throw-away DSH home, the way scripts/test-tasks-route.mjs does.
//
//   node packages/kybernos-plugin/test-feedback-box.mjs
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { sessionSource } from './session-guard.mjs'
import { OTHER_SECRET, SESSION_SECRET, installSession, sessionCookie } from './lib-session-test.mjs'

const home = mkdtempSync(join(tmpdir(), 'kb-feedback-box-'))
process.env.HOME = home
process.env.DSH_HOME = home
mkdirSync(join(home, 'kybernos'), { recursive: true })
installSession(home)
sessionSource.secret = () => SESSION_SECRET

let n = 0
const ok = (label) => { n += 1; console.log('  ✓ ' + label) }
const file = join(home, 'kybernos', 'feedback.jsonl')

// ── 1. the module ───────────────────────────────────────────────────────────────────────────────────────────────────────
const box = await import('./feedback-box.mjs')
let seq = 0
const env = { id: () => 'fb-' + String(++seq), now: () => Date.parse('2026-10-16T09:30:00Z'), mask: (t) => t.replace(/sk-[A-Za-z0-9]{6,}/g, 'sk-[REDACTED]'), context: () => ({ os: 'darwin 25.0', dsh: '0.2.1-alpha.4', revision: '1.0.0-beta.8' }) }

{
  const r = box.recordFeedback(home, { type: 'bug', message: '  The send button does nothing  ' }, env)
  assert.equal(r.ok, true)
  assert.equal(r.count, 1)
  const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean)
  assert.equal(lines.length, 1)
  assert.deepEqual(JSON.parse(lines[0]), { v: 1, id: 'fb-1', at: '2026-10-16T09:30:00.000Z', type: 'bug', message: 'The send button does nothing' })
  ok('a message is appended as one JSON line: version, id, date, type, the trimmed message')
  assert.equal((statSync(file).mode & 0o777).toString(8), '600')
  ok('the file is private (0600): it holds what a person wrote')
}
{
  const before = readFileSync(file, 'utf8')
  const r = box.recordFeedback(home, { type: 'idea', message: 'Dark mode for the Atlas', context: true, page: { title: 'Atlas', lang: 'en', width: 1400, height: 900, secret: 'no' } }, env)
  assert.equal(r.ok, true)
  assert.equal(r.count, 2)
  const text = readFileSync(file, 'utf8')
  assert.ok(text.startsWith(before), 'the first line is untouched: the file is only appended to')
  const last = JSON.parse(text.split('\n').filter(Boolean)[1])
  assert.deepEqual(last.context, { os: 'darwin 25.0', dsh: '0.2.1-alpha.4', revision: '1.0.0-beta.8', title: 'Atlas', lang: 'en', width: 1400, height: 900 })
  ok('with the technical context asked for: the versions, the system, the page title, the language and the window size, and nothing else')
}
{
  box.recordFeedback(home, { type: 'question', message: 'Where are my skills?', page: { title: 'Secret project', lang: 'fr', width: 10, height: 10 } }, env)
  const last = JSON.parse(readFileSync(file, 'utf8').split('\n').filter(Boolean).pop())
  assert.equal(last.context, undefined)
  assert.ok(!JSON.stringify(last).match(/darwin|alpha|Secret project|"fr"/))
  ok('the context is OFF unless the form asked: nothing about the machine, the page or the language is written, whatever the form sent')
}
{
  const r = box.recordFeedback(home, { type: 'bug', message: 'my key is sk-ABCDEF123456 please look' }, env)
  assert.equal(r.ok, true)
  const last = readFileSync(file, 'utf8').split('\n').filter(Boolean).pop()
  assert.ok(!last.includes('ABCDEF123456') && last.includes('sk-[REDACTED]'))
  ok('a key pasted into the message does not reach the file (the same masking as the clipboard path of the beta report)')
}
{
  const tricky = 'two\nlines ' + String.fromCharCode(0x2028) + ' and a separator ' + String.fromCharCode(0x2029) + ' "quoted"'
  box.recordFeedback(home, { type: 'bug', message: tricky }, env)
  const raw = readFileSync(file, 'utf8')
  const last = raw.split('\n').filter(Boolean).pop()
  assert.equal(JSON.parse(last).message, tricky)
  assert.ok(!last.includes(String.fromCharCode(0x2028)) && !last.includes(String.fromCharCode(0x2029)))
  assert.equal(raw.split(new RegExp('\\r\\n|\\n|\\r|[' + String.fromCharCode(0x2028, 0x2029) + ']')).filter(Boolean).length, raw.split('\n').filter(Boolean).length)
  ok('a message with a line break or U+2028 stays ONE line (a JSONL reader never splits it)')
}
{
  const bad = [[null, /JSON object/], [[], /JSON object/], [{ type: 'complaint', message: 'x' }, /type/], [{ type: 'bug' }, /empty/], [{ type: 'bug', message: '   ' }, /empty/], [{ type: 'bug', message: 42 }, /empty/]]
  const before = readFileSync(file, 'utf8')
  for (const [body, why] of bad) {
    const r = box.recordFeedback(home, body, env)
    assert.equal(r.ok, false)
    assert.match(r.error, why)
  }
  assert.equal(readFileSync(file, 'utf8'), before)
  ok('a form that is not one, a type that is not bug / idea / question, an empty message: refused with a reason, nothing written')
  box.recordFeedback(home, { type: 'bug', message: 'x'.repeat(box.MESSAGE_MAX + 500) }, env)
  assert.equal(JSON.parse(readFileSync(file, 'utf8').split('\n').filter(Boolean).pop()).message.length, box.MESSAGE_MAX)
  ok('a message longer than ' + box.MESSAGE_MAX + ' characters is cut, not refused')
}
{
  const out = box.exportFeedback(home)
  assert.equal(out.ok, true)
  assert.equal(out.text, readFileSync(file, 'utf8'))
  assert.equal(out.count, out.text.split('\n').filter(Boolean).length)
  assert.equal(out.truncated, false)
  ok('Export hands back the file as it is, with the number of entries')
  const empty = mkdtempSync(join(tmpdir(), 'kb-feedback-empty-'))
  assert.deepEqual(box.exportFeedback(empty), { ok: true, count: 0, text: '', truncated: false })
  ok('an empty or missing box exports as nothing, not as an error')
}
{
  const big = mkdtempSync(join(tmpdir(), 'kb-feedback-big-'))
  mkdirSync(join(big, 'kybernos'), { recursive: true })
  const line = JSON.stringify({ v: 1, id: 'x', type: 'bug', message: 'y'.repeat(900) }) + '\n'
  writeFileSync(join(big, 'kybernos', 'feedback.jsonl'), line.repeat(Math.ceil((box.EXPORT_MAX * 1.5) / line.length)))
  const out = box.exportFeedback(big)
  assert.equal(out.truncated, true)
  assert.ok(out.text.length <= box.EXPORT_MAX && out.text.length > box.EXPORT_MAX - 2 * line.length)
  assert.ok(out.text.split('\n').filter(Boolean).every((l) => { try { JSON.parse(l); return true } catch (e) { return false } }), 'every returned line is whole')
  ok('a very long box exports its newest lines, cut at a line boundary, and says it was truncated')
  writeFileSync(join(big, 'kybernos', 'feedback.jsonl'), 'z'.repeat(box.FILE_MAX))
  const r = box.recordFeedback(big, { type: 'bug', message: 'one more' }, env)
  assert.deepEqual(r, { ok: false, error: 'full' })
  ok('a box of ' + (box.FILE_MAX / 1048576) + ' MB takes no more: « full », nothing written')
}

// ── 1b. the form's text as a report for the relay (AC-05) ──────────────────────────────────────────────────
{
  const mask = (t) => t.replace(/sk-[A-Za-z0-9]{6,}/g, 'sk-[REDACTED]')
  const r = box.relayReportOf({ type: 'bug', message: '  The send button does nothing\nI press it and the page stays as it is.  ' }, { mask })
  assert.equal(r.ok, true)
  assert.deepEqual(r.input, { kind: 'bug', title: 'The send button does nothing', body: 'The send button does nothing\nI press it and the page stays as it is.' })
  assert.equal(r.client, false)
  ok('a bug becomes a relay report: kind bug, the first line as the title, the whole text as the body, no technical sheet')
  assert.equal(box.relayReportOf({ type: 'idea', message: 'Dark mode please' }, { mask }).input.kind, 'feature')
  const q = box.relayReportOf({ type: 'question', message: 'Where are my skills?' }, { mask })
  assert.equal(q.input.kind, 'feature')
  assert.equal(q.input.title, 'Question: Where are my skills?')
  ok('an idea is a feature, a question is a feature whose title says it is a question (the relay knows two kinds)')
  const long = box.relayReportOf({ type: 'bug', message: 'word '.repeat(60) + 'end' }, { mask })
  assert.ok(long.input.title.length <= 80 && long.input.title.endsWith('…'), long.input.title)
  assert.ok(!/\s…$/.test(long.input.title), 'no space before the ellipsis')
  assert.equal(long.input.body.length, ('word '.repeat(60) + 'end').length)
  const noSpace = box.relayReportOf({ type: 'bug', message: 'x'.repeat(300) }, { mask })
  assert.ok(noSpace.input.title.length <= 80 && noSpace.input.title.endsWith('…'))
  ok('a long first line is cut for the title at a word boundary (else hard), and the body keeps everything')
  const blankFirst = box.relayReportOf({ type: 'bug', message: '\n\n   \nSecond line is the title\nthird' }, { mask })
  assert.equal(blankFirst.input.title, 'Second line is the title')
  ok('blank lines before the text are not a title')
  const secret = box.relayReportOf({ type: 'bug', message: 'key sk-ABCDEF123456 fails' }, { mask })
  assert.ok(!secret.input.title.includes('ABCDEF123456') && !secret.input.body.includes('ABCDEF123456'))
  ok('a key pasted into the message is masked in the title and in the body, before anything leaves')
  const withCtx = box.relayReportOf({ type: 'bug', message: 'It broke', context: true, page: { title: 'Settings', lang: 'en', width: 1280, height: 800 } }, { mask })
  assert.equal(withCtx.client, true)
  assert.ok(/Settings/.test(withCtx.input.body) && /en/.test(withCtx.input.body) && /1280/.test(withCtx.input.body) && /800/.test(withCtx.input.body), withCtx.input.body)
  assert.ok(withCtx.input.body.startsWith('It broke'))
  const noCtx = box.relayReportOf({ type: 'bug', message: 'It broke', context: false, page: { title: 'Secret project', lang: 'fr', width: 10, height: 10 } }, { mask })
  assert.equal(noCtx.client, false)
  assert.ok(!/Secret project|fr|10/.test(noCtx.input.body.replace('It broke', '')), noCtx.input.body)
  ok('the page details ride in the body only when the form asked for them (and then the technical sheet goes too); never otherwise')
  for (const bad of [null, [], { type: 'complaint', message: 'x' }, { type: 'bug' }, { type: 'bug', message: '  ' }, { type: 'bug', message: 42 }]) assert.equal(box.relayReportOf(bad, { mask }).ok, false)
  assert.equal(box.relayReportOf({ type: 'bug', message: 'x'.repeat(box.MESSAGE_MAX + 500) }, { mask }).input.body.length, box.MESSAGE_MAX)
  ok('a form that is not one, a bad type, an empty message: refused; a longer message is cut to the same limit as the box')
}

// ── 2. the two routes of the real plugin ────────────────────────────────────────────────────────────────────────────
const realSetTimeout = globalThis.setTimeout
globalThis.setTimeout = (fn, ms, ...a) => ((ms === 5000 || ms === 30000) ? { unref () {}, ref () {} } : realSetTimeout(fn, ms, ...a))
const routes = {}
const services = { fs: {}, webServer: { register: (r) => { routes[r.path] = r.handler; return () => {} } }, workspaceRegistry: { list: () => [] } }
const mod = await import('./index.js')
const realErr = console.error; const realLog = console.log
console.error = () => {}; console.log = () => {}
mod.apply({ get: (name) => services[name], inject: () => {}, effect: (fn) => { try { return fn() } catch (e) { return undefined } }, on: () => () => {}, scope: {} })
await new Promise((r) => realSetTimeout(r, 50))
console.error = realErr; console.log = realLog

const AUTHORITY = '127.0.0.1:3080'
const call = async (method, path, body, headers) => {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))])
  req.method = method; req.url = path
  req.headers = Object.assign({ host: AUTHORITY, origin: 'http://' + AUTHORITY, cookie: sessionCookie(AUTHORITY) }, headers || {})
  req.socket = { localPort: 3080 }
  const res = { status: null, body: null }
  const done = new Promise((resolve) => { res.end = (b) => { res.body = b; resolve() }; res.writeHead = (s) => { res.status = s } })
  assert.equal(typeof routes[path.split('?')[0]], 'function', path + ' is mounted')
  await Promise.race([Promise.resolve(routes[path.split('?')[0]](req, res)).catch(() => {}), done, new Promise((r) => realSetTimeout(r, 3000))])
  let json = null
  try { json = JSON.parse(res.body) } catch (e) { /* not JSON */ }
  return { status: res.status, json }
}
const linesOnDisk = () => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).length : 0)

{
  const base = linesOnDisk()
  const r = await call('POST', '/kybernos/feedback', { type: 'bug', message: 'Saved through the route' })
  assert.equal(r.status, 200)
  assert.equal(r.json.ok, true)
  assert.equal(linesOnDisk(), base + 1)
  ok('POST /kybernos/feedback with the browser\'s Origin and session saves one line')
  const last = JSON.parse(readFileSync(file, 'utf8').split('\n').filter(Boolean).pop())
  assert.equal(last.message, 'Saved through the route')
  assert.equal(last.context, undefined)
  ok('...without technical context, as the form\'s toggle is off by default')
  const withCtx = await call('POST', '/kybernos/feedback', { type: 'idea', message: 'With the context', context: true, page: { title: 'Settings', lang: 'en', width: 1280, height: 800 } })
  assert.equal(withCtx.status, 200)
  const ctxLine = JSON.parse(readFileSync(file, 'utf8').split('\n').filter(Boolean).pop())
  assert.ok(ctxLine.context !== undefined && typeof ctxLine.context.os === 'string' && ctxLine.context.title === 'Settings')
  assert.ok(!/token|secret|password|cookie|\/Users\//i.test(JSON.stringify(ctxLine.context)), 'no secret and no personal path in the context')
  ok('...with the context asked for: system and versions from the host, page details from the form, no secret, no personal path')
}
{
  const before = linesOnDisk()
  const attempts = [
    ['no Origin and no cookie', { origin: '', cookie: '' }, 403],
    ['a foreign Origin, even with the real cookie', { origin: 'http://evil.example' }, 403],
    ['the right Origin and no cookie (what a local program sends)', { cookie: '' }, 401],
    ['the right Origin and a cookie signed with another secret', { cookie: sessionCookie(AUTHORITY, { secret: OTHER_SECRET }) }, 401],
    ['the right Origin and an expired cookie', { cookie: sessionCookie(AUTHORITY, { expiresAt: Date.now() - 1000 }) }, 401],
    ['a cookie for another port', { cookie: sessionCookie('127.0.0.1:3091') }, 401],
  ]
  for (const [label, headers, status] of attempts) {
    const r = await call('POST', '/kybernos/feedback', { type: 'bug', message: 'must not be written' }, headers)
    assert.equal(r.status, status, label + ' → ' + r.status)
    const e = await call('GET', '/kybernos/feedback/export', undefined, headers)
    assert.ok(e.status === status || (headers.origin === '' && e.status === 401), 'the export: ' + label + ' → ' + e.status)
  }
  assert.equal(linesOnDisk(), before)
  ok('the strict write guard: no Origin, a foreign Origin, no cookie, a forged or expired cookie, another port — all refused, nothing written, nothing exported')
  sessionSource.secret = () => null
  assert.equal((await call('POST', '/kybernos/feedback', { type: 'bug', message: 'x' })).status, 503)
  sessionSource.secret = () => SESSION_SECRET
  ok('a guard that cannot read the machine secret refuses (503) rather than letting the write through')
  assert.equal((await call('GET', '/kybernos/feedback')).status, 405)
  assert.equal((await call('POST', '/kybernos/feedback/export', {})).status, 405)
  ok('one method per route: GET /kybernos/feedback and POST /kybernos/feedback/export answer 405')
  assert.equal((await call('POST', '/kybernos/feedback', 'x'.repeat(200000))).status, 413)
  assert.equal((await call('POST', '/kybernos/feedback', { type: 'complaint', message: 'x' })).status, 400)
  assert.equal((await call('POST', '/kybernos/feedback', { type: 'bug', message: '' })).status, 400)
  assert.equal(linesOnDisk(), before)
  ok('an oversized body is 413, a bad type or an empty message is 400, and nothing is written')
}
{
  const r = await call('GET', '/kybernos/feedback/export')
  assert.equal(r.status, 200)
  assert.equal(r.json.ok, true)
  assert.equal(r.json.text, readFileSync(file, 'utf8'))
  assert.equal(r.json.count, linesOnDisk())
  ok('GET /kybernos/feedback/export (signed in) returns the file\'s content and the number of entries')
}

// ── 3. POST /kybernos/feedback/send: the form really sends (AC-05) ────────────────────────────────────────
{
  // A fake relay: the Cloud plugin's state names it, every POST is recorded, nothing else is reached.
  const posts = []
  let answers = []
  const realFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    posts.push({ url: String(url), auth: init.headers.authorization, body: JSON.parse(init.body) })
    const next = answers.length > 0 ? answers.shift() : { status: 201, json: { ok: true, issue: { number: posts.length, url: 'https://example.invalid/issues/' + posts.length } } }
    if (next.throws === true) throw new TypeError('fetch failed')
    return { status: next.status, text: async () => JSON.stringify(next.json) }
  }
  const stateFile = join(home, 'kybernos-cloud.json')
  const connect = () => writeFileSync(stateFile, JSON.stringify({ token: 'kys_test_token_0000000000000000', api: 'http://relay.invalid' }))
  process.env.KYBERNOS_CLOUD_STATE = stateFile
  connect()
  const linesBefore = linesOnDisk()

  const r = await call('POST', '/kybernos/feedback/send', { type: 'bug', message: 'Send does nothing\nI press it, nothing leaves.' })
  assert.equal(r.status, 200)
  assert.equal(r.json.ok, true, JSON.stringify(r.json))
  assert.equal(posts.length, 1)
  assert.equal(posts[0].url, 'http://relay.invalid/v1/feedback')
  assert.equal(posts[0].auth, 'Bearer kys_test_token_0000000000000000')
  assert.equal(posts[0].body.kind, 'bug')
  assert.equal(posts[0].body.title, 'Send does nothing')
  assert.equal(posts[0].body.consent, true)
  assert.deepEqual(posts[0].body.client, {}, 'the technical sheet is not sent unless the form asked for it')
  ok('Send posts the report to the relay with the device token, as a bug titled by its first line, and says it was sent')
  assert.ok(!JSON.stringify(r.json).includes('kys_test_token') && !JSON.stringify(r.json).includes(home), 'the answer carries no token and no path')
  assert.equal(linesOnDisk(), linesBefore, 'Send does not write the feedback box: that is what Save is for')
  ok('...the answer holds no token and no local path, and the box of saved feedback is left alone')

  const again = await call('POST', '/kybernos/feedback/send', { type: 'bug', message: 'Send does nothing\nI press it, nothing leaves.' })
  assert.equal(again.json.ok, true)
  assert.equal(again.json.deduped, true)
  assert.equal(posts.length, 1, 'the same report again is not posted twice')
  ok('a double click (the same report again) opens one issue and says it had already been sent')

  const withCtx = await call('POST', '/kybernos/feedback/send', { type: 'idea', message: 'Dark mode', context: true, page: { title: 'Atlas', lang: 'en', width: 1400, height: 900 } })
  assert.equal(withCtx.json.ok, true)
  const sent = posts[posts.length - 1].body
  assert.equal(sent.kind, 'feature')
  assert.ok(typeof sent.client.os === 'string' && sent.client.os !== '', 'with the details ticked the system goes')
  assert.ok(/Atlas/.test(sent.body) && /1400/.test(sent.body))
  assert.ok(!/token|secret|password|cookie|\/Users\//i.test(JSON.stringify(sent)), 'no secret, no personal path in what leaves')
  ok('with the technical details ticked, the system, the versions and the page facts go; nothing else')

  const q = await call('POST', '/kybernos/feedback/send', { type: 'question', message: 'sk-ABCDEF123456 is my key, where do I put it?' })
  assert.equal(q.json.ok, true)
  assert.equal(posts[posts.length - 1].body.title.startsWith('Question: '), true)
  assert.ok(!JSON.stringify(posts[posts.length - 1].body).includes('ABCDEF123456'))
  ok('a question keeps its label and a key pasted into it is masked before it leaves')

  // A relay that is down: an honest failure, the text kept, a retry later sends the same report.
  answers = [{ status: 503, json: { error: 'github_indisponible', retry_after: 30 } }]
  const n0 = posts.length
  const down = await call('POST', '/kybernos/feedback/send', { type: 'bug', message: 'Relay down case' })
  assert.equal(down.status, 200)
  assert.equal(down.json.ok, false)
  assert.equal(down.json.error, 'github_indisponible')
  assert.equal(down.json.retryable, true)
  assert.equal(down.json.retry_after, 30)
  assert.equal(posts.length, n0 + 1)
  ok('a relay that does not answer is an honest failure (ok false, its code, retryable, when to come back), never a success')
  answers = [{ throws: true }]
  const dead = await call('POST', '/kybernos/feedback/send', { type: 'bug', message: 'Network down case' })
  assert.equal(dead.json.ok, false)
  assert.equal(dead.json.error, 'envoi_indisponible')
  ok('no network at all is a failure too, with a code the form can word')
  answers = [{ status: 400, json: { error: 'invalid_title' } }]
  const refused = await call('POST', '/kybernos/feedback/send', { type: 'bug', message: 'Refused case' })
  assert.equal(refused.json.ok, false)
  assert.equal(refused.json.error, 'invalid_title')
  assert.equal(refused.json.retryable, false)
  ok('a refusal of the content is not retryable')

  // Signed out: no token, nothing is posted, the answer says so.
  rmSync(stateFile, { force: true })
  const n1 = posts.length
  const out = await call('POST', '/kybernos/feedback/send', { type: 'bug', message: 'Signed out case' })
  assert.equal(out.status, 200)
  assert.equal(out.json.ok, false)
  assert.equal(out.json.error, 'non_connecte')
  assert.equal(posts.length, n1, 'nothing is posted without an account')
  ok('signed out: nothing is posted and the answer says « not connected », it never claims a delivery')
  connect()

  // The same strict guard as the other write routes, and nothing leaves on a refusal.
  const n2 = posts.length
  for (const [label, headers, status] of [
    ['no Origin and no cookie', { origin: '', cookie: '' }, 403],
    ['a foreign Origin', { origin: 'http://evil.example' }, 403],
    ['no cookie (what a local program sends)', { cookie: '' }, 401],
    ['a cookie signed with another secret', { cookie: sessionCookie(AUTHORITY, { secret: OTHER_SECRET }) }, 401],
    ['an expired cookie', { cookie: sessionCookie(AUTHORITY, { expiresAt: Date.now() - 1000 }) }, 401],
  ]) {
    const x = await call('POST', '/kybernos/feedback/send', { type: 'bug', message: 'must not leave' }, headers)
    assert.equal(x.status, status, label + ' → ' + x.status)
  }
  assert.equal(posts.length, n2)
  sessionSource.secret = () => null
  assert.equal((await call('POST', '/kybernos/feedback/send', { type: 'bug', message: 'x' })).status, 503)
  sessionSource.secret = () => SESSION_SECRET
  assert.equal(posts.length, n2)
  ok('the strict write guard: no Origin, a foreign Origin, no cookie, a forged or expired cookie, an unreadable machine secret — all refused, nothing posted')
  assert.equal((await call('GET', '/kybernos/feedback/send')).status, 405)
  assert.equal((await call('POST', '/kybernos/feedback/send', 'x'.repeat(200000))).status, 413)
  assert.equal((await call('POST', '/kybernos/feedback/send', { type: 'complaint', message: 'x' })).status, 400)
  assert.equal((await call('POST', '/kybernos/feedback/send', { type: 'bug', message: '  ' })).status, 400)
  assert.equal(posts.length, n2)
  ok('GET is 405, an oversized body 413, a bad type or an empty message 400, and nothing is posted')
  globalThis.fetch = realFetch
  delete process.env.KYBERNOS_CLOUD_STATE
}

console.log('\n' + n + ' checks passed')
process.exit(0)

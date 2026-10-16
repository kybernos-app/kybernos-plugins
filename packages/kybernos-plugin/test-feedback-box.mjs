#!/usr/bin/env node
// The feedback box (V-10): the « Send feedback » form saves one JSON line in <DSH home>/kybernos/feedback.jsonl and an Export button
// copies the file. No network: the module (feedback-box.mjs) is driven alone, then the two routes of the REAL index.js are driven with
// fake requests in a throw-away DSH home, the way scripts/test-tasks-route.mjs does.
//
//   node packages/kybernos-plugin/test-feedback-box.mjs
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
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

console.log('\n' + n + ' checks passed')
process.exit(0)

#!/usr/bin/env node
// What a person gets when the link to the Kybernos server drops and comes back, and what a feedback report really sends (user-journey J19-04, J19-07).
// It plays against a SANDBOX DSH that is signed in to a made-up account of a LOCAL replica, with a small recording proxy of its own between the two:
// the proxy cuts (every socket reset), holds (accepts and answers nothing) or slows the link, and records every request the DSH makes to the server.
//
//   1. start the replica and the sandbox as usual, then start the sandbox with  KYBERNOS_CLOUD_API=http://localhost:<proxy port>  and pair it (scripts/e2e-connect.mjs)
//   2. source the sandbox env (DSH_HOME of the sandbox) and run:
//        KB_HOST=127.0.0.1:3240 KB_PROXY_PORT=8913 KB_REPLICA_PORT=8911 node scripts/check-offline-live.mjs
//
// Nothing outward: the proxy only talks to 127.0.0.1. Made-up secrets only. The checks decide what is mechanical:
//   - (played last, it signs the sandbox out) a sign-in started with the link cut answers « reseau » at once, and the same flow finishes once the link is back (no restart);
//   - a computer action with the link cut must not say the person has no computer (the DSH could not ask: that is a network failure, not an empty list);
//   - a feedback report sent with the link cut is kept (queued), is posted exactly once when the link is back, and a second press does not post it again;
//   - what leaves in a report holds the message, the page facts and the version sheet: none of the sandbox's own secrets (device token outside the
//     Authorization header, browser-session cookie, home path), and the known secret shapes typed into the message or the page title come out masked.
// Exit 0 all green, 1 a check failed, 3 inconclusive (no sandbox, not signed in). The link is always restored at the end.
import http from 'node:http'
import { readFileSync } from 'node:fs'
import { cookieDeSession } from './cdp-lib.mjs'

const HOST = process.env.KB_HOST || '127.0.0.1:3240'
const PROXY = Number(process.env.KB_PROXY_PORT || 8913)
const REPLICA = Number(process.env.KB_REPLICA_PORT || 8911)
const DSH_HOME = process.env.DSH_HOME || ''
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0
let fail = 0
const check = (name, ok, detail) => { if (ok) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) } }

// ── the recording proxy (cut | hole | slow | pass) ─────────────────────────────────────────────────────────────────────────────────────────────────────
let mode = 'pass'
const seen = []
const live = new Set()
const proxy = http.createServer((req, res) => {
  if (mode === 'hole') { seen.push({ m: req.method, p: req.url, hole: true }); return }
  const chunks = []
  req.on('data', (c) => chunks.push(c))
  req.on('end', () => {
    const body = Buffer.concat(chunks)
    const up = http.request({ host: '127.0.0.1', port: REPLICA, method: req.method, path: req.url, headers: req.headers }, (r) => {
      const out = []
      r.on('data', (c) => out.push(c))
      r.on('end', () => { res.writeHead(r.statusCode, r.headers); res.end(Buffer.concat(out)); seen.push({ m: req.method, p: req.url, status: r.statusCode, headers: req.headers, body: body.toString('utf8') }) })
    })
    up.on('error', () => { try { res.destroy() } catch (e) { /* gone */ } })
    up.end(body)
  })
})
proxy.on('connection', (s) => { if (mode === 'cut') { s.resetAndDestroy ? s.resetAndDestroy() : s.destroy(); return } live.add(s); s.on('close', () => live.delete(s)); s.on('error', () => {}) })
const setMode = (m) => { mode = m; if (m === 'cut') { for (const s of live) s.destroy(); live.clear() } }

// ── the DSH under test ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const ck = cookieDeSession(HOST)
const dsh = async (method, path, json) => {
  const t0 = Date.now()
  try {
    const r = await fetch('http://' + HOST + path, { method, headers: { 'content-type': 'application/json', cookie: ck.nom + '=' + ck.valeur, origin: 'http://' + HOST }, body: method === 'GET' ? undefined : JSON.stringify(json || {}), signal: AbortSignal.timeout(60000) })
    const text = await r.text()
    let body = text
    try { body = JSON.parse(text) } catch (e) { /* plain text */ }
    return { status: r.status, ms: Date.now() - t0, body }
  } catch (e) { return { status: 0, ms: Date.now() - t0, body: { error: String(e.message || e) } } }
}

if (ck === null || DSH_HOME === '') { console.error('○ inconclusive: set DSH_HOME to the sandbox home (the browser-session secret is read from it)'); process.exit(3) }
await new Promise((r) => proxy.listen(PROXY, '127.0.0.1', r))
const st = await dsh('GET', '/kybernos-cloud/status')
if (st.status !== 200 || st.body.connected !== true) { console.error('○ inconclusive: the sandbox is not signed in to the replica'); proxy.close(); process.exit(3) }
const cloudFile = DSH_HOME + '/kybernos-cloud.json'
let deviceToken = ''
try { deviceToken = String(JSON.parse(readFileSync(cloudFile, 'utf8')).token || '') } catch (e) { /* no file: the token check is skipped */ }

try {
  console.log('a computer action with the link cut')
  {
    await sleep(9000) // the computers list is shared for 8 s: let it expire so the call goes to the network
    setMode('cut')
    const list = await dsh('GET', '/kybernos-cloud/computers')
    check('the list says it is unavailable (not an empty list without a reason)', list.body.error === 'unavailable', list.body)
    const resume = await dsh('POST', '/kybernos-cloud/computer/resume')
    check('resume with the link cut does not say « no_computer »', resume.body.error !== 'no_computer', resume.body)
    setMode('pass')
  }

  console.log('a feedback report with the link cut, then restored')
  const report = { type: 'idea', message: 'Please add a dark mode toggle. (offline check ' + Date.now() + ')', context: true, page: { title: 'Plan', lang: 'en', width: 1280, height: 800 }, contact: '', attachments: [] }
  {
    const first = seen.length
    setMode('cut')
    const queued = await dsh('POST', '/kybernos/feedback/send', report)
    check('sent with the link cut: kept (queued) and retryable, not lost', queued.body.queued === true && queued.body.retryable === true, queued.body)
    setMode('pass')
    const again = await dsh('POST', '/kybernos/feedback/send', report)
    const twice = await dsh('POST', '/kybernos/feedback/send', report)
    const posts = seen.slice(first).filter((r) => r.m === 'POST' && r.p === '/v1/feedback' && r.status !== undefined)
    check('sent again with the link back: delivered, and exactly one report reaches the server', again.body.ok === true && again.body.queued === false && posts.length === 1, { again: again.body, posts: posts.length })
    check('a third press does not post it a second time', twice.body.ok === true && seen.slice(first).filter((r) => r.m === 'POST' && r.p === '/v1/feedback' && r.status !== undefined).length === 1)

    console.log('what leaves in a report')
    const typed = ['key sk-ant-api03-FAKEFAKEFAKE1234567890abcd', 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJmYWtlIjoxfQ.c2lnbmF0dXJl', 'Cookie: kybernos_session=abc123def456ghi789',
      'password: hunter2-made-up', 'DATABASE_URL=postgres://madeup:pw-made-up-77@db.example.test/app', 'split sk-​ant-​api03-ZERO​WIDTH12345678'].join('\n')
    const mark = seen.length
    const sent = await dsh('POST', '/kybernos/feedback/send', { type: 'bug', message: 'Crash when I paste:\n' + typed, context: true, page: { title: 'Plan token=PAGETITLESECRET99', lang: 'en', width: 1280, height: 800 }, contact: '', attachments: [] })
    const out = seen.slice(mark).filter((r) => r.m === 'POST' && r.p === '/v1/feedback')
    const body = out.map((r) => r.body).join('\n')
    check('the report was posted', sent.body.ok === true && out.length === 1, sent.body)
    for (const s of ['sk-ant-api03-FAKEFAKEFAKE', 'eyJhbGciOiJIUzI1NiJ9', 'abc123def456ghi789', 'hunter2-made-up', 'pw-made-up-77', 'ZEROWIDTH12345678', 'PAGETITLESECRET99']) check('masked: ' + s.slice(0, 14) + '…', body.includes(s) === false)
    check('the browser-session cookie is not in anything that left', body.includes(ck.valeur) === false && seen.every((r) => Object.entries(r.headers || {}).every(([k, v]) => /^authorization$/i.test(k) || String(v).includes(ck.valeur) === false)))
    check('the device token is only in the Authorization header', deviceToken === '' || (body.includes(deviceToken) === false && seen.every((r) => Object.entries(r.headers || {}).every(([k, v]) => /^authorization$/i.test(k) || String(v).includes(deviceToken) === false))))
    check('no home path in the report', /\/Users\/[^/\s"]+\/\.kybernos-sandbox|\/Users\/miled/.test(body) === false)
  }

  // Last, because it signs the sandbox out.
  console.log('sign-in with the link cut')
  setMode('pass')
  check('disconnect works with the link up', (await dsh('POST', '/kybernos-cloud/disconnect', { confirm: true })).body.ok === true)
  setMode('cut')
  const cut = await dsh('POST', '/kybernos-cloud/start')
  check('start with the link cut answers « reseau » within 2 s', cut.body.ok === false && cut.body.error === 'reseau' && cut.ms < 2000, { body: cut.body, ms: cut.ms })
  setMode('pass')
  const back = await dsh('POST', '/kybernos-cloud/start')
  check('the same start works once the link is back (no restart)', back.body.ok === true && back.body.pairing !== undefined, back.body)
  console.log('  (the sandbox is left signed out with a pending pairing: run scripts/e2e-connect.mjs again to pair it)')

} finally {
  setMode('pass')
  proxy.close()
  process.exit(fail === 0 ? 0 : 1)
}

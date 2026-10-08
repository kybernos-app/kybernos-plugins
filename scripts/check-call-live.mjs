#!/usr/bin/env node
// The call panel (packages/kybernos-call), end to end, in a real GUI.
//
//   source scripts/sandbox/env.sh && node scripts/check-call-live.mjs [--shots <dir>]
//
// It needs a DSH that LOADS the bundle, i.e. a second instance whose profile links this checkout:
// `scripts/sandbox/setup.sh` then `scripts/sandbox/start.sh` (see docs/dev/live-testing.md). The user's own
// `dsh web` does not list the bundle, and this script refuses to run against it (exit 3).
//
// What it checks, in a real page:
//   1. the bundle loaded: the seam `window.__KB_CALL__` exists and the old core routes are gone;
//   2. a call with the REAL host: the sandbox has no call secrets, so the panel opens and says so, then hangs up;
//   3. a call with FAKE host answers: a token for a room nobody can reach. The real LiveKit SDK is fetched from this
//      bundle's route and tried for real: the panel reports that the room cannot be joined, and the microphone is
//      never asked for;
//   4. French.
//
// SAFETY: every POST to /kybernos-call/* is intercepted and answered here (fail-closed): no worker is started, no
// room token is minted, no turn is sent to a session, whatever the page asks. Reads go through, except the status,
// which scenario 3 fakes. No microphone is requested: the fake room is never reachable.
// Exit code 0 / 1 / 3.
import { join } from 'node:path'
import { openLivePage } from './live-page.mjs'

const args = process.argv.slice(2)
const shotDir = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : null
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) }
}

const host = process.env.KB_HOST || '127.0.0.1:3080'
if (host === '127.0.0.1:3080') { console.error('○ inconclusive: this check needs a DSH that loads the bundle (a sandbox instance), not the one on :3080. Set KB_HOST, DSH_HOME and HOME.'); process.exit(3) }

const live = await openLivePage({ width: 1400, height: 900 }).catch((e) => { console.error('○ inconclusive: ' + e.message); process.exit(3) })
const { page } = live
const val = async (expr, ms) => (await page.evalJs(expr, ms)).val
const shot = async (name) => { if (shotDir !== null) { try { await page.shot(join(shotDir, name + '.png')) } catch (e) { /* no screenshot */ } } }
const poll = async (fn, ms = 15000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) return v; await sleep(250) } }

// ── fail-closed: every POST of the call routes is answered here ──────────────────────────────────────────────
const posts = []
const fake = { status: null, token: { ok: false, error: 'blocked by the check' } }
const reply = async (p, status, payload) => page.send('Fetch.fulfillRequest', {
  requestId: p.requestId, responseCode: status,
  responseHeaders: [{ name: 'content-type', value: 'application/json' }, { name: 'cache-control', value: 'no-store' }],
  body: Buffer.from(JSON.stringify(payload)).toString('base64')
})
page.on('Fetch.requestPaused', async (p) => {
  try {
    const url = new URL(p.request.url)
    if (p.request.method === 'POST' && url.pathname.startsWith('/kybernos-call/')) {
      let body = {}
      try { body = JSON.parse(p.request.postData || '{}') } catch (e) { /* not JSON */ }
      posts.push({ path: url.pathname, body })
      await reply(p, url.pathname === '/kybernos-call/token' ? 200 : 403, url.pathname === '/kybernos-call/token' ? fake.token : { ok: false, error: 'blocked by the check' })
      return
    }
    if (url.pathname === '/kybernos-call/status' && fake.status !== null) { await reply(p, 200, fake.status); return }
    await page.send('Fetch.continueRequest', { requestId: p.requestId })
  } catch (e) { try { await page.send('Fetch.continueRequest', { requestId: p.requestId }) } catch (e2) { /* gone */ } }
})
await page.send('Fetch.enable', { patterns: [{ urlPattern: '*/kybernos-call/*', requestStage: 'Request' }] })

const panel = () => val(`(() => { const p = document.querySelector('[data-kb="kybernos-call-panel"]'); return p ? { text: p.innerText, hangup: !!p.querySelector('[data-act="hangup"]') } : null })()`)
const openCall = (mode) => val(`(() => { window.__KB_CALL__.open({ sessionId: 'session-aaaaaaaa', kyberId: 'team-1', roleId: 'm1', name: 'Alice', mode: ${JSON.stringify(mode)} }); return true })()`)
const clickHangUp = () => val(`(() => { const b = document.querySelector('[data-kb="kybernos-call-panel"] [data-act="hangup"]'); if (!b) return false; b.click(); return true })()`)

try {
  console.log('1. the bundle loaded')
  const seam = await poll(() => val('typeof window.__KB_CALL__ === "object" && window.__KB_CALL__ !== null && typeof window.__KB_CALL__.open === "function"'))
  check('the seam window.__KB_CALL__.open exists (the bundle loaded and applied)', seam === true)
  const old = await val(`Promise.all(['/kybernos/call/status', '/kybernos/vendor/livekit-client.js'].map((u) => fetch(u, { credentials: 'same-origin' }).then((r) => r.status)))`, 8000)
  check('the old core routes are gone (404)', Array.isArray(old) && old.every((s) => s === 404), old)
  const vendor = await val(`fetch('/kybernos-call/vendor/livekit-client.js').then((r) => r.status + ' ' + r.headers.get('content-type'))`, 8000)
  check('the SDK is served by this bundle', vendor === '200 text/javascript; charset=utf-8', vendor)

  console.log('2. a call against the real host (the sandbox has no call secrets)')
  await openCall('voice')
  const p2 = await poll(async () => { const p = await panel(); return p && /no call secrets|aucun secret/i.test(p.text) ? p : null })
  check('the panel opens and says there are no call secrets on this machine', p2 !== null && p2 !== undefined, await panel())
  check('it names the person called and offers to hang up', p2 && /Alice/.test(p2.text) && p2.hangup === true, p2)
  await shot('call-no-secrets')
  check('no request reached the token / agent / utterance routes (nothing was asked of the host)', posts.length === 0, posts)
  check('hanging up closes the panel', (await clickHangUp()) === true && (await poll(async () => (await panel()) === null)) === true)

  console.log('3. a call against fake host answers (a room nobody can reach)')
  fake.status = { ok: true, secrets: 'posee', url: 'wss://127.0.0.1:1', provider: 'none', avatar: null, sandbox: false }
  fake.token = { ok: true, url: 'ws://127.0.0.1:1', token: 'fake.jwt.token', room: 'room-check', identity: 'moi', expiresIn: 60, agent: { running: false, dispatched: false } }
  await openCall('video')
  const p3 = await poll(async () => { const p = await panel(); return p && /could not join the room|impossible de rejoindre/i.test(p.text) ? p : null }, 30000)
  check('the real SDK was fetched from this bundle and tried: the panel says the room cannot be joined', p3 !== null && p3 !== undefined, await panel())
  const tokenPosts = posts.filter((x) => x.path === '/kybernos-call/token')
  check('the token request carried who is called: the session, the team, the member, the mode and the language', tokenPosts.length === 1 && JSON.stringify(tokenPosts[0].body) === JSON.stringify({ sessionId: 'session-aaaaaaaa', kyberId: 'team-1', roleId: 'm1', name: 'Alice', mode: 'video', language: 'auto', identity: 'moi' }), tokenPosts)
  const sdk = await val('typeof window.LivekitClient === "object" && typeof window.LivekitClient.Room === "function"')
  check('window.LivekitClient is the real SDK', sdk === true)
  const media = await val(`(async () => { try { const s = await navigator.permissions.query({ name: 'microphone' }); return s.state } catch (e) { return 'unknown' } })()`)
  check('the microphone was never asked for (its permission is still "prompt" or unknown)', media === 'prompt' || media === 'unknown', media)
  await shot('call-cannot-join')
  await clickHangUp()
  check('the panel closes again', (await poll(async () => (await panel()) === null)) === true)

  console.log('4. French')
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__KB_LANG_RESOLVE__ = () => "fr"' })
  await val('window.__KB_LANG_RESOLVE__ = () => "fr"; true')
  fake.status = null
  await openCall('voice')
  const p4 = await poll(async () => { const p = await panel(); return p && p.text && /Raccrocher/.test(p.text) ? p : null })
  check('the panel speaks French when the language is French', p4 !== null && p4 !== undefined, await panel())
  await shot('call-fr')
  await clickHangUp()
} finally {
  await live.close()
}
console.log('\n' + (fail === 0 ? '✓' : '✗') + ' kybernos-call live: ' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)

// ── The phone-link routes that CHANGE who can reach this computer need DSH's signed session, not only an Origin ──────────────────────────
//
// Audit 2026-10-24 (interfaces triage, T2-01): `remote/enable`, `pair`, `pair/approve`, `pair/deny`, `pair/cancel`, `devices/revoke` and `devices/revoke-all` were behind
// the Host fence and `sameOriginStrict` alone. DSH serves plugin routes BEFORE its own login and an Origin header is forgeable by any local program, so one `POST …/pair` then
// `POST …/pair/approve` linked a stranger's phone: remote control of the machine. They now carry the pair the repo's rule asks for (docs/dev/route-origin-rule.md): strict same
// origin AND the signed browser-session cookie (`writeGuard`, session-guard.mjs: the terminal's code, copied here like kybernos-call does). The page that drives them (the
// account menu's window and Settings › Phone and channels) is same origin, so the browser sends the cookie itself. `status` is a read and stays Origin-only.
//
//   node packages/kybernos-mobile/test-write-guard.mjs
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
// The remote half is not started here (it has its own tests): a request that passes the fences ends at « remote half unavailable » (503), which is how this file tells "let through" from "refused".
process.env.KYBERNOS_MOBILE_REMOTE = '0'
const home = mkdtempSync(join(tmpdir(), 'kb-mobile-write-guard-'))
process.env.HOME = home
process.env.USERPROFILE = home
process.env.DSH_HOME = join(home, '.dsh')
const { REMOTE_ROUTES, serveRemote } = await import('./index.js')
const { sessionSource } = await import('./session-guard.mjs')
const { OTHER_SECRET, SESSION_SECRET, sessionCookie } = await import('./lib-session-test.mjs')
sessionSource.secret = () => SESSION_SECRET

let failed = 0
const check = (name, ok, detail) => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok || detail === undefined ? '' : '  — ' + JSON.stringify(detail)))
  if (!ok) failed += 1
}
const PORT = 3080
const OWN = '127.0.0.1:' + PORT
const ORIGIN = 'http://' + OWN
const cookie = (opts) => sessionCookie(OWN, opts)
const res = () => { const r = { status: 0, body: '', writeHead (s) { r.status = s }, end (b) { r.body = b === undefined ? '' : String(b) } }; return r }
const send = async (name, method, headers) => {
  const r = res()
  serveRemote(name, { method, headers: { host: OWN, ...headers }, socket: { localPort: PORT } }, r)
  await new Promise((resolve) => setTimeout(resolve, 150)) // the passing requests go on through the lazily loaded half
  return r
}
const before = () => readdirSync(home, { recursive: true }).sort().join('|')

const WRITES = Object.entries(REMOTE_ROUTES).filter(([, method]) => method === 'POST').map(([name]) => name)
check('the seven POST routes are the ones this file covers', WRITES.length === 7 && ['enable', 'pair', 'pair/approve', 'pair/deny', 'pair/cancel', 'devices/revoke', 'devices/revoke-all'].every((n) => WRITES.includes(n)), WRITES)

const forged = cookie({ secret: OTHER_SECRET })
const untouched = before()
for (const name of WRITES) {
  const a = await send(name, 'POST', {})
  const b = await send(name, 'POST', { origin: 'http://evil.example', cookie: cookie() })
  const c = await send(name, 'POST', { origin: ORIGIN })
  const d = await send(name, 'POST', { origin: ORIGIN, cookie: forged })
  const e = await send(name, 'POST', { origin: ORIGIN, cookie: cookie(), 'x-kybernos-tunnel': '1' })
  const f = await send(name, 'POST', { origin: ORIGIN, cookie: cookie() })
  check(name + ': no header 403 · foreign Origin 403 · no cookie 401 · forged cookie 401 · through the phone link 403 · the real pair is let through',
    a.status === 403 && b.status === 403 && c.status === 401 && d.status === 401 && e.status === 403 && f.status !== 401 && f.status !== 403,
    [a.status, b.status, c.status, d.status, e.status, f.status])
}
check('a refused call wrote nothing under the home', before() === untouched)

const read = await send('status', 'GET', { origin: ORIGIN })
check('status is a read: the right Origin alone is enough', read.status !== 401 && read.status !== 403, read.status)
const readForeign = await send('status', 'GET', { origin: 'http://evil.example' })
check('and a foreign Origin is still refused on the read', readForeign.status === 403, readForeign.status)

rmSync(home, { recursive: true, force: true })
console.log(failed === 0 ? '\nOK' : `\n${failed} failure(s)`)
process.exit(failed === 0 ? 0 : 1)

// Helpers for end-to-end runs against a LOCAL server replica (kybernos-server `scripts/replica.ts`): made-up accounts, teams, plans, caps and the
// test mailbox, all through the server's own routes. Nothing here knows a private path or a secret: everything comes from the environment, and
// the files a run writes (accounts, ids) go to the folder the caller names (`KB_E2E_DIR`, keep it outside git, mode 0700).
//
//   KB_E2E_API      the replica itself, e.g. http://localhost:8821
//   KB_E2E_WEB      the address people and DSH use (the recording proxy in front of the replica), e.g. http://localhost:8820
//   KB_E2E_CONTROL  the replica's control port (mailbox), e.g. http://127.0.0.1:8822
//   KB_E2E_DIR      where accounts.json (0600) and the proxy log live
//   KB_SERVER_DIR   the server checkout (only its test/helpers/totp.ts is read, for the made-up platform owner's second factor)
//   KB_E2E_STATE    the replica's state file (the made-up platform owner), default <KB_E2E_DIR>/replica-state.json
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'

export const env = () => {
  const need = (name) => { const v = process.env[name]; if (!v) throw new Error(`${name} is not set`); return v }
  const dir = need('KB_E2E_DIR')
  return {
    api: need('KB_E2E_API'), web: need('KB_E2E_WEB'), control: need('KB_E2E_CONTROL'), dir,
    serverDir: process.env.KB_SERVER_DIR || '', state: process.env.KB_E2E_STATE || join(dir, 'replica-state.json'),
  }
}

// The replica rate-limits sign-ins per client address and reads that address from `x-test-ip` (CLIENT_IP_HEADER): every process starts from a random one, so many short runs never share a bucket.
let ipCounter = Math.floor(Math.random() * 60000)
const cookieOf = (res) => res.headers.getSetCookie().map((c) => c.split(';')[0]).filter(Boolean).join('; ')

/** A client for one replica. `call` returns { status, body } (body parsed when JSON, else text). */
export const makeServer = (e = env()) => {
  const call = async (method, path, { json, cookie, bearer, headers = {} } = {}) => {
    const h = { origin: e.web, 'x-test-ip': `198.${18 + ((ipCounter >> 16) & 1)}.${(ipCounter >> 8) & 255}.${(ipCounter++ & 255) || 1}`, ...headers }
    if (json !== undefined) h['content-type'] = 'application/json'
    if (cookie) h.cookie = cookie
    if (bearer) h.authorization = 'Bearer ' + bearer
    const res = await fetch(e.api + path, { method, headers: h, body: json === undefined ? undefined : JSON.stringify(json) })
    const text = await res.text()
    let body = text
    try { body = JSON.parse(text) } catch { /* plain text */ }
    return { status: res.status, body, res }
  }
  const control = async (path, init) => (await fetch(e.control + path, init)).json()
  const mail = (to) => control('/__/mail?to=' + encodeURIComponent(to))
  const code = async (to) => { const r = await control('/__/code?to=' + encodeURIComponent(to)); return typeof r.code === 'string' ? r.code : null }

  const signUp = async (email, password, name) => {
    const created = await call('POST', '/api/auth/sign-up/email', { json: { email, password, name } })
    if (created.status !== 200) throw new Error('sign-up ' + created.status + ' ' + JSON.stringify(created.body).slice(0, 200))
    const c = await code(email)
    if (c !== null) {
      const verified = await call('POST', '/api/auth/email-otp/verify-email', { json: { email, otp: c } })
      if (verified.status !== 200) throw new Error('verify ' + verified.status)
    }
  }
  /** Signs in and returns { id, cookie }. */
  const signIn = async (email, password) => {
    const r = await call('POST', '/api/auth/sign-in/email', { json: { email, password } })
    if (r.status !== 200) throw new Error('sign-in ' + r.status + ' ' + JSON.stringify(r.body).slice(0, 200))
    return { id: r.body.user.id, cookie: cookieOf(r.res) }
  }
  /** The made-up platform owner of the replica (seeded with REPLICA_SEED=catalogue), signed in with its second factor. */
  const ownerSession = async () => {
    const st = JSON.parse(readFileSync(e.state, 'utf8'))
    if (!st.owner) throw new Error('the replica was not seeded (REPLICA_SEED=catalogue)')
    const { appCode } = await import(e.serverDir + '/test/helpers/totp.ts')
    const first = await call('POST', '/api/auth/sign-in/email', { json: { email: st.owner.email, password: st.owner.password } })
    if (first.status !== 200) throw new Error('owner sign-in ' + first.status)
    const second = await call('POST', '/api/auth/two-factor/verify-totp', { cookie: cookieOf(first.res), json: { code: appCode(st.owner.totp_secret) } })
    if (second.status !== 200) throw new Error('owner second factor ' + second.status)
    const cookie = cookieOf(second.res)
    return { cookie, admin: (method, path, json) => call(method, path, { cookie, json }) }
  }
  return { e, call, control, mail, code, signUp, signIn, ownerSession }
}

/** accounts.json: { a: { email, password, id, name }, b: {...}, teams: { t1: {id,name}, ... } } at mode 0600. */
export const accountsFile = (e = env()) => join(e.dir, 'accounts.json')
export const readAccounts = (e = env()) => (existsSync(accountsFile(e)) ? JSON.parse(readFileSync(accountsFile(e), 'utf8')) : {})
export const writeAccounts = (data, e = env()) => { writeFileSync(accountsFile(e), JSON.stringify(data, null, 2) + '\n'); chmodSync(accountsFile(e), 0o600) }
/** A made-up address and password; the password never leaves the 0600 file. */
export const fresh = (label) => ({ email: `e2e-${label}-${randomBytes(3).toString('hex')}@example.test`, password: 'E2e-' + randomBytes(12).toString('hex'), name: `E2E ${label.toUpperCase()}` })

#!/usr/bin/env node
// Sets owner settings on a DISPOSABLE replica of the server (scripts/replica.ts of the server repo), the way the owner's admin page does: sign in as the replica's seeded owner (password, then the authenticator code), then PUT /v1/admin/billing/settings/<name>.
// Used by the user-journey recette to put a server flag at 0 and at a real value (README §4, « Server flags ») and to give new accounts a welcome credit so a model call can be made on a replica.
//
//   node scripts/replica-owner-settings.mjs --api http://localhost:8841 --state <replica-state.json> welcome_credit_cents=2000 computers_enabled=1
//
// The state file holds the replica's made-up owner; its contents are never printed. Refuses any address that is not loopback: a replica is the only server this may talk to.
import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

/** The 6-digit code an authenticator shows at `atMs` for a base32 secret (RFC 4226 and 6238). */
export function totp (base32, atMs = Date.now()) {
  let bits = 0
  let acc = 0
  const bytes = []
  for (const ch of base32.toUpperCase()) {
    const v = ALPHABET.indexOf(ch)
    if (v < 0) throw new Error('not base32')
    acc = (acc << 5) | v
    bits += 5
    if (bits >= 8) { bits -= 8; bytes.push((acc >> bits) & 255); acc &= (1 << bits) - 1 }
  }
  const msg = Buffer.alloc(8)
  msg.writeBigUInt64BE(BigInt(Math.floor(atMs / 30000)))
  const mac = createHmac('sha1', Buffer.from(bytes)).update(msg).digest()
  const o = mac[mac.length - 1] & 15
  const n = ((mac[o] & 127) << 24) | (mac[o + 1] << 16) | (mac[o + 2] << 8) | mac[o + 3]
  return String(n % 1000000).padStart(6, '0')
}

export const isLoopback = (url) => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?\/?$/.test(url)

/** `name=value` pairs to `{ name, value }`; throws on anything else. */
export function parsePairs (args) {
  return args.map((a) => {
    const m = /^([a-z][a-z0-9_]*)=(-?\d+)$/.exec(a)
    if (!m) throw new Error(`not a setting: ${a} (expected name=integer)`)
    return { name: m[1], value: Number(m[2]) }
  })
}


/** Signs in as the replica's seeded owner (password, then the authenticator code) and returns the session cookie. Throws with the status on a refusal. */
export async function ownerCookie (api, owner) {
  const cookieOf = (r) => (r.headers.getSetCookie ? r.headers.getSetCookie() : []).map((c) => c.split(';')[0]).join('; ')
  const call = (method, path, { json, cookie } = {}) => fetch(api + path, { method, redirect: 'manual', headers: { origin: api, 'x-test-ip': `198.18.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250) + 1}`, ...(json ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) }, body: json ? JSON.stringify(json) : undefined })
  const first = await call('POST', '/api/auth/sign-in/email', { json: { email: owner.email, password: owner.password } })
  const firstBody = await first.json().catch(() => ({}))
  if (first.status !== 200 || firstBody.twoFactorRedirect !== true) throw new Error(`sign-in: no second-factor step (${first.status})`)
  const second = await call('POST', '/api/auth/two-factor/verify-totp', { cookie: cookieOf(first), json: { code: totp(owner.totp_secret) } })
  if (second.status !== 200) throw new Error(`second factor refused (${second.status})`)
  return cookieOf(second)
}

async function main () {
  const argv = process.argv.slice(2)
  const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : '' }
  const api = (opt('--api') || '').replace(/\/$/, '')
  const stateFile = opt('--state')
  const rest = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--api' && argv[i - 1] !== '--state')
  if (!api || !stateFile || rest.length === 0) { console.error('usage: replica-owner-settings --api <loopback url> --state <replica-state.json> name=value ...'); process.exit(2) }
  if (!isLoopback(api)) { console.error('replica-owner-settings: the address must be loopback (a replica, never a real server)'); process.exit(2) }
  const pairs = parsePairs(rest)
  const owner = JSON.parse(readFileSync(stateFile, 'utf8')).owner
  if (!owner) { console.error('replica-owner-settings: the state file has no owner (start the replica with REPLICA_SEED)'); process.exit(2) }
  let cookie
  try { cookie = await ownerCookie(api, owner) } catch (e) { console.error(String(e.message)); process.exit(1) }
  const call = (method, path, { json, cookie: c } = {}) => fetch(api + path, { method, redirect: 'manual', headers: { origin: api, 'x-test-ip': `198.18.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250) + 1}`, ...(json ? { 'content-type': 'application/json' } : {}), ...(c ? { cookie: c } : {}) }, body: json ? JSON.stringify(json) : undefined })
  let bad = 0
  for (const p of pairs) {
    const r = await call('PUT', `/v1/admin/billing/settings/${p.name}`, { cookie, json: { value: p.value } })
    if (r.status !== 200) bad += 1
    console.log(`${r.status === 200 ? 'ok  ' : 'FAIL'} ${p.name}=${p.value} (${r.status})`)
  }
  process.exit(bad === 0 ? 0 : 1)
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main()

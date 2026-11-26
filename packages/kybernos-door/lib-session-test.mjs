// Test helper (not a test: the name does not start with "test"). It is identical in every bundle that guards a write with session-guard.mjs
// (scripts/test-session-guard.mjs keeps the copies equal): the person's browser as a write route sees it, the right Origin and DSH's signed
// session cookie, built here from the documented scheme (docs/dev/live-testing.md) and not with the code under test.
import { createHash, createHmac, randomBytes } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

export const SESSION_SECRET = randomBytes(32)
export const OTHER_SECRET = randomBytes(32)
export const AUTHORITY = '127.0.0.1:3080'

/** `name=value` of DSH's session cookie for an authority. */
export const sessionCookie = (authority = AUTHORITY, { secret = SESSION_SECRET, expiresAt = Date.now() + 3600_000 } = {}) => {
  const body = b64url(Buffer.from(JSON.stringify({ version: 1, authority, issuedAt: Date.now(), expiresAt })))
  return 'dsh-auth-' + b64url(createHash('sha256').update(authority).digest()) + '=v1.' + body + '.' + b64url(createHmac('sha256', secret).update(body).digest())
}

/** Puts the machine secret where DSH keeps it: `<dshHome>/.credentials.yaml`. */
export const installSession = (dshHome) => {
  mkdirSync(dshHome, { recursive: true })
  writeFileSync(join(dshHome, '.credentials.yaml'), 'client-connection/browser-session:\n  secret: ' + b64url(SESSION_SECRET) + '\n', { mode: 0o600 })
}

/** What the person's own browser sends to a write route. */
export const browserHeaders = () => ({ origin: 'http://' + AUTHORITY, cookie: sessionCookie() })

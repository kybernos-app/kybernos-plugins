// ── The dev scripts honour DSH_HOME when they read the DSH home ──────────────
//
// cdp-lib.mjs (the browser-session secret), lib-language-flow.mjs and check-theme-live.mjs
// (the stored profile configuration) read the DSH home. They used join(homedir(), '.dsh'),
// so a live check aimed at an isolated instance (DSH_HOME set) signed its cookie with, and
// compared against, the user's real instance instead.
//
// check-theme-live.mjs runs a whole live session when imported, so it is guarded statically:
// it must read the profile through the shared reader, never through homedir().
//
// It also keeps the per-bundle tests honest: each packages/*/test-dsh-home.mjs carries a copy
// of the decoy-HOME harness (lib-dsh-home-isolation.mjs), because the bundles ship without
// scripts/. A copy that drifts from the canonical block fails here.
//
//   node scripts/test-dsh-home.mjs
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeIsolation } from './lib-dsh-home-isolation.mjs'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }

const here = dirname(fileURLToPath(import.meta.url))
const b64url = (b) => Buffer.from(b).toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
const secretOf = (byte) => b64url(Buffer.alloc(32, byte))
const credentials = (byte) => 'client-connection/browser-session:\n  secret: ' + secretOf(byte) + '\n'
const patch = (locale) => 'bundles:\n  - id: locale\n    name: x\n    config:\n      preference: ' + locale + '\n  - id: ui-theme\n    config:\n      preference: dark\n      fontSize: 14\n'
const signatureOf = (cookie, byte) => {
  const [version, body, signature] = cookie.valeur.split('.')
  assert.equal(version, 'v1')
  return { signature, expected: b64url(createHmac('sha256', Buffer.alloc(32, byte)).update(body).digest()) }
}

const iso = makeIsolation('scripts')

try {
  console.log('dev scripts — DSH_HOME')

  iso.useDshHome()
  const { dshHome, profilePatch } = await import('./dsh-home.mjs')
  const { cookieDeSession } = await import('./cdp-lib.mjs')
  const { storedLocale } = await import('./lib-language-flow.mjs')

  assert.equal(dshHome({ DSH_HOME: '' }, () => '/h'), join('/h', '.dsh'))
  assert.equal(dshHome({ DSH_HOME: '   ' }, () => '/h'), join('/h', '.dsh'))
  assert.equal(dshHome({}, () => '/h'), join('/h', '.dsh'))
  assert.equal(dshHome({ DSH_HOME: '  /srv/dsh  ' }, () => '/h'), '/srv/dsh')
  assert.equal(dshHome({ DSH_HOME: '~' }, () => '/h'), '/h')
  assert.equal(dshHome({ DSH_HOME: '~/alt' }, () => '/h'), join('/h', 'alt'))
  ok('the resolver follows the DSH rule (blank = unset, ~ expanded, trimmed)')

  // DSH_HOME set, HOME elsewhere with a decoy full of canaries.
  iso.seedDecoy('.credentials.yaml', credentials(9))
  iso.seedDecoy('profiles/web/cordis.patch.yml', patch('fr'))
  iso.seedDshHome('.credentials.yaml', credentials(7))
  iso.seedDshHome('profiles/web/cordis.patch.yml', patch('en'))
  iso.seedDshHome('profiles/other/cordis.patch.yml', patch('zh'))
  iso.freezeDecoy()

  const cookie = cookieDeSession('http://127.0.0.1:3080')
  assert.notEqual(cookie, null)
  const mine = signatureOf(cookie, 7)
  assert.equal(mine.signature, mine.expected, 'the session cookie must be signed with the secret of $DSH_HOME')
  assert.notEqual(mine.signature, signatureOf(cookie, 9).expected)
  ok('the browser-session cookie is signed with the secret of $DSH_HOME')

  assert.equal(storedLocale(), 'en', 'the stored language must come from the profile of $DSH_HOME')
  assert.match(profilePatch(), /preference: en/)
  assert.match(profilePatch('other'), /preference: zh/)
  assert.equal(profilePatch('missing'), null)
  ok('the stored profile configuration is read from $DSH_HOME/profiles')

  const source = (file) => readFileSync(join(here, file), 'utf8')
  for (const file of ['cdp-lib.mjs', 'lib-language-flow.mjs', 'check-theme-live.mjs']) {
    assert.equal(/homedir/.test(source(file)), false, file + ' must not read the home through homedir()')
  }
  assert.match(source('check-theme-live.mjs'), /profilePatch\(\)/)
  ok('check-theme-live.mjs reads the profile through the shared reader (static guard)')

  const harness = (text) => {
    const from = text.indexOf('// DSH-HOME-HARNESS-BEGIN')
    const to = text.indexOf('// DSH-HOME-HARNESS-END')
    return from < 0 || to < from ? null : text.slice(from, to)
  }
  const canonical = harness(source('lib-dsh-home-isolation.mjs'))
  assert.notEqual(canonical, null, 'the canonical harness block is missing')
  const packages = join(here, '..', 'packages')
  const copies = readdirSync(packages).map((dir) => join(packages, dir, 'test-dsh-home.mjs')).filter((file) => existsSync(file))
  assert.ok(copies.length >= 6, 'expected one test-dsh-home.mjs per fixed bundle, found ' + copies.length)
  for (const file of copies) {
    const text = readFileSync(file, 'utf8')
    assert.equal(harness(text), canonical, file + ' must carry the canonical harness block, unchanged')
    assert.equal(/scripts\/lib-dsh-home-isolation/.test(text), false, file + ' must not import from scripts/ (it ships without it)')
  }
  ok('every bundle test carries the canonical harness block (' + copies.length + ' copies, none imports scripts/)')

  iso.assertDecoyUntouched('the dev scripts')
  ok('nothing was read or written under <HOME>/.dsh (canaries and listing unchanged)')

  // DSH_HOME unset: the default location is unchanged.
  iso.useDefaultHome()
  const dflt = signatureOf(cookieDeSession('http://127.0.0.1:3080'), 9)
  assert.equal(dflt.signature, dflt.expected)
  assert.equal(storedLocale(), 'fr')
  ok('with DSH_HOME unset, the scripts still read <HOME>/.dsh')

  console.log('\n' + pass + ' verifications OK')
} finally {
  iso.cleanup()
}

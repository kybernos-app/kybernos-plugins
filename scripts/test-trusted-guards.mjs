// Route guards on a hosted instance (behind a reverse proxy).
//
//   1. Drift: every bundle that compares an Origin with the loopback list must ALSO ask the published
//      "trusted authority" predicate, through the one identical helper line.
//   2. Behaviour: the guards some bundles export accept the public Origin only when DSH declared it
//      (--trusted-host), keep refusing strangers, and are unchanged when nothing is published.
//
// Run: node scripts/test-trusted-guards.mjs
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { publishTrustedAuthority, TRUSTED_AUTHORITY_KEY } from '../packages/kybernos-plugin/trusted-authority.mjs'

const ICI = dirname(fileURLToPath(import.meta.url))
const PACKAGES = join(ICI, '..', 'packages')
let fails = 0
const ok = (name, cond) => { if (cond) console.log('  ok   ' + name); else { fails++; console.log('  FAIL ' + name) } }

const HELPER = "const kbTrusted = (host) => { try { const f = globalThis[Symbol.for('kybernos.trustedAuthority')]; return typeof f === 'function' && f(host) === true } catch (e) { return false } }"

// ── 1. drift ──────────────────────────────────────────────────────────────
const sources = []
const walk = (dir) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'vendor') continue
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p)
    else if (/\.(js|mjs)$/.test(e.name) && !/^(test|lib-test)/.test(e.name) && e.name !== 'client.js') sources.push(p)
  }
}
walk(PACKAGES)
const LOOPBACK = "'[::1]' + port"
const guarded = sources.filter((f) => readFileSync(f, 'utf8').includes(LOOPBACK))
console.log('guard files found: ' + guarded.length)
ok('at least the 17 known guard files are found', guarded.length >= 17)
for (const f of guarded) {
  const rel = relative(PACKAGES, f)
  const src = readFileSync(f, 'utf8')
  ok(rel + ': carries the identical helper line', src.split('\n').includes(HELPER))
  // every place that tests the host against the loopback list must also ask kbTrusted
  const sites = [...src.matchAll(/(?:indexOf|includes)\(u\.host\)( >= 0)?/g)]
  const bare = sites.filter((m) => !src.slice(m.index, m.index + m[0].length + 30).includes('kbTrusted(u.host)'))
  ok(rel + ': ' + sites.length + ' host check(s), all ask kbTrusted', sites.length > 0 && bare.length === 0)
}

// ── helper semantics, taken from the file itself ──
const helper = new Function('globalThis', HELPER + '; return kbTrusted')
const KEY = Symbol.for(TRUSTED_AUTHORITY_KEY)
const fake = (predicate) => { const g = {}; if (predicate !== undefined) g[KEY] = predicate; return helper(g) }
ok('helper: nothing published → false', fake(undefined)('dsh.example.com') === false)
ok('helper: predicate says true → true', fake(() => true)('dsh.example.com') === true)
ok('helper: a truthy non-true answer → false', fake(() => 'yes')('dsh.example.com') === false)
ok('helper: a throwing predicate → false', fake(() => { throw new Error('boom') })('dsh.example.com') === false)
ok('helper: a non-function value → false', fake('nope')('dsh.example.com') === false)

// ── 2. behaviour through the guards the bundles export ──
const PORT = 3081
const PUBLIC = 'dsh.example.com'
const req = (method, headers) => ({ method, headers, socket: { localPort: PORT } })
const GUARDS = [
  ['kybernos-sessions', 'index.js', 'origineOK'],
  ['kybernos-theme', 'index.js', 'sameOriginStrict'],
  ['kybernos-theme', 'index.js', 'sameOriginLax'],
  ['kybernos-hub', 'hub-host.mjs', 'sameOriginStrict'],
  ['kybernos-hub', 'hub-host.mjs', 'sameOriginLax'],
  ['kybernos-flow', 'queue-move.mjs', 'sameOriginStrict'],
  ['kybernos-flow', 'queue-move.mjs', 'sameOriginLax'],
  ['kybernos-workers', 'workers-host.mjs', 'sameOriginStrict'],
  ['kybernos-workers', 'workers-host.mjs', 'sameOriginLax']
]
const declared = { value: [] }
const ctx = { get: (name) => (name === 'webRuntime' ? { trustedHosts: declared.value } : undefined) }

delete globalThis[KEY]
const loaded = []
for (const [pkg, file, name] of GUARDS) {
  const path = join(PACKAGES, pkg, file)
  if (!existsSync(path)) { ok(pkg + '/' + file + ' exists', false); continue }
  let mod = null
  try { mod = await import(pathToFileURL(path).href) } catch (e) { ok(pkg + '/' + file + ' imports (' + String(e && e.message).slice(0, 80) + ')', false); continue }
  if (typeof mod[name] !== 'function') { ok(pkg + ' exports ' + name, false); continue }
  loaded.push([pkg + '.' + name, mod[name]])
}
ok('every guard under test was loaded', loaded.length === GUARDS.length)

const pub = { origin: 'https://' + PUBLIC }
const loop = { origin: 'http://127.0.0.1:' + PORT }
const evil = { origin: 'https://evil.example' }
// The real trap: the trusted name written as userinfo, the actual host being the attacker's.
const sneaky = { origin: 'https://' + PUBLIC + '@evil.example' }

for (const [label, guard] of loaded) {
  const m = 'POST'
  delete globalThis[KEY]
  ok(label + ': loopback Origin still accepted (nothing published)', guard(req(m, loop)) === true)
  ok(label + ': public Origin refused when nothing is published', guard(req(m, pub)) === false)
  declared.value = [PUBLIC]
  publishTrustedAuthority(ctx)
  ok(label + ': public Origin accepted once DSH declared it', guard(req(m, pub)) === true)
  ok(label + ': public Origin on another port accepted (port-less entry)', guard(req(m, { origin: 'https://' + PUBLIC + ':9443' })) === true)
  ok(label + ': a stranger is still refused', guard(req(m, evil)) === false)
  ok(label + ': a userinfo trick is refused', guard(req(m, sneaky)) === false)
  ok(label + ': a forged Host never decides', guard(req(m, { ...evil, host: PUBLIC })) === false)
  ok(label + ': loopback Origin still accepted', guard(req(m, loop)) === true)
  declared.value = ['other.example']
  ok(label + ': refused again when the list changes (read at request time)', guard(req(m, pub)) === false)
  delete globalThis[KEY]
}

console.log(fails === 0 ? '\nALL PASS' : '\n' + fails + ' FAILED')
process.exit(fails === 0 ? 0 : 1)

// Trusted authorities: same matching rule as DSH's isTrustedAuthority, and the published predicate.
import { isTrustedAuthority, readTrustedHosts, publishTrustedAuthority, TRUSTED_AUTHORITY_KEY } from './trusted-authority.mjs'

let fails = 0
const ok = (name, cond) => { if (cond) console.log('  ok   ' + name); else { fails++; console.log('  FAIL ' + name) } }

// ── matching rule (mirrors dsh-client-connection) ──
const E = ['dsh.example.com', 'app.internal:8443', 'LAN.Example.org']
ok('port-less entry matches the bare host (https default port)', isTrustedAuthority('dsh.example.com', E))
ok('port-less entry matches the host on any port', isTrustedAuthority('dsh.example.com:9000', E))
ok('entry with a port matches exactly that authority', isTrustedAuthority('app.internal:8443', E))
ok('entry with a port refuses another port', !isTrustedAuthority('app.internal:8444', E))
ok('entry with a port refuses the bare host', !isTrustedAuthority('app.internal', E))
ok('case never decides trust', isTrustedAuthority('lan.example.ORG', E))
ok('an unrelated host is refused', !isTrustedAuthority('evil.example', E))
ok('a suffix trick is refused', !isTrustedAuthority('dsh.example.com.evil.example', E))
ok('a prefix trick is refused', !isTrustedAuthority('evil-dsh.example.com', E))
ok('a userinfo trick is refused', !isTrustedAuthority('evil.example@dsh.example.com', E))
ok('a userinfo trick on the trusted side is refused', !isTrustedAuthority('evil.example', ['evil.example@dsh.example.com']))
ok('a path is refused', !isTrustedAuthority('dsh.example.com/x', E))
ok('an empty host is refused', !isTrustedAuthority('', E))
ok('a non-string host is refused', !isTrustedAuthority(undefined, E))
ok('no declared authority → nothing trusted', !isTrustedAuthority('dsh.example.com', []))
ok('a non-array list → nothing trusted', !isTrustedAuthority('dsh.example.com', undefined))
ok('a bad entry is skipped, a good one still matches', isTrustedAuthority('dsh.example.com', ['??bad??', 'dsh.example.com']))
ok('IPv6 literal entry', isTrustedAuthority('[2001:db8::1]:3080', ['[2001:db8::1]']))

// ── reading the list from the plugin context ──
const ctxOf = (services) => ({ get: (name) => services[name] })
ok('webRuntime wins', readTrustedHosts(ctxOf({ webRuntime: { trustedHosts: ['a.example'] }, webStartup: { trustedHosts: ['b.example'] } })).join() === 'a.example')
ok('webStartup is the fallback before the server binds', readTrustedHosts(ctxOf({ webStartup: { trustedHosts: ['b.example'] } })).join() === 'b.example')
ok('no service → empty', readTrustedHosts(ctxOf({})).length === 0)
ok('a throwing ctx.get → empty', readTrustedHosts({ get: () => { throw new Error('boom') } }).length === 0)
ok('non-string entries are dropped', readTrustedHosts(ctxOf({ webRuntime: { trustedHosts: ['a.example', 7, null] } })).join() === 'a.example')

// ── the published predicate ──
const target = {}
const live = { webRuntime: undefined }
const predicate = publishTrustedAuthority(ctxOf(live), target)
ok('published under the Symbol.for key', target[Symbol.for(TRUSTED_AUTHORITY_KEY)] === predicate)
ok('before webRuntime exists: nothing trusted', predicate('dsh.example.com') === false)
live.webRuntime = { trustedHosts: ['dsh.example.com'] }
ok('picked up once webRuntime is provided (no restart)', predicate('dsh.example.com') === true)
ok('still refuses a stranger', predicate('evil.example') === false)
ok('a frozen global does not throw', (() => { try { publishTrustedAuthority(ctxOf({}), Object.freeze({})); return true } catch (e) { return false } })())

console.log(fails === 0 ? '\nALL PASS' : '\n' + fails + ' FAILED')
process.exit(fails === 0 ? 0 : 1)

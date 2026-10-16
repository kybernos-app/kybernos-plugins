// The footer's « Upgrade » entry, « See plans », and the notice of a server that does not answer (audit V-40, V-41). No browser, no React:
// the client is a script, so the pure rules are marked blocks of its source that this test plays on their own, and the wiring is pinned in the source.
//   node packages/kybernos-cloud/test-footer-plans.mjs
// The rendered menu, the real clicks and the screenshots are `scripts/check-footer-live.mjs` (« Upgrade », « A server that does not answer », « At 390 px »).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, 'client.js'), 'utf8')
let passed = 0
const ok = (label) => { passed += 1; console.log('  ✓ ' + label) }

// The dictionaries: every key the new code uses exists in French AND in English.
const frStart = source.indexOf('      fr: {')
const enStart = source.indexOf('      en: {')
assert.ok(frStart > 0 && enStart > frStart, 'the fr / en dictionaries are where the test expects them')
const keysOf = (text) => new Set([...text.matchAll(/^ {8}([A-Za-z][A-Za-z0-9_]*): '/gm)].map((m) => m[1]))
const frKeys = keysOf(source.slice(frStart, enStart))
const enKeys = keysOf(source.slice(enStart, source.indexOf('\n      },', enStart)))
for (const key of ['menuPlanCta', 'menuSeePlans', 'srvSwitch', 'srvDownOpen']) assert.ok(frKeys.has(key) && enKeys.has(key), 'missing in fr or en: ' + key)
ok('menuPlanCta, menuSeePlans, srvSwitch and srvDownOpen exist in French and in English')

console.log('V-40 — « Upgrade »')
{
  const m = source.match(/\/\/ <plan-top:begin>[\s\S]*?\/\/ <plan-top:end>/)
  assert.ok(m !== null, 'the plan-top rules are a marked block')
  const { planIsTop, loopbackHost } = new Function(m[0] + '\nreturn { planIsTop, loopbackHost }')()
  const price = (cur, amount, interval) => ({ currency: cur, amount, mode: 'unit', interval })
  const PLANS = [
    { key: 'free', kind: 'free', name: 'Free', components: [{ key: 'free', name: 'Free' }] },
    { key: 'solo', kind: 'individual', name: 'Individual', components: [{ key: 'solo', name: 'Plus', prices: [price('USD', '19.00', 'year')] }, { key: 'studio', name: 'Pro', prices: [price('USD', '39.00', 'year')] }] },
    { key: 'team', kind: 'team', name: 'Team', components: [{ key: 'band:0', name: 'Per seat' }] },
    { key: 'topup', kind: 'topup', name: 'Top-up', components: [{ key: 'pack', name: 'Top-up' }] },
  ]
  assert.equal(planIsTop({ key: 'solo', level: 'Plus', label: 'Individual Plus' }, PLANS), false, 'Plus: Pro is above it')
  assert.equal(planIsTop({ key: 'solo', level: 'Pro', label: 'Individual Pro' }, PLANS), true, 'Pro is the top level of the individual plan')
  assert.equal(planIsTop({ key: 'solo', level: 'studio' }, PLANS), true, 'the level may be told by its key')
  assert.equal(planIsTop({ key: 'solo', label: 'Pro' }, PLANS), true, 'or by the label alone (a server that sends no level)')
  assert.equal(planIsTop({ key: 'team', level: '1-5 seats' }, PLANS), true, 'a paid Team plan has nothing above it (its seats are bought on the plan page)')
  for (const sp of [{ key: 'free' }, { key: 'none' }, { key: 'topup' }, { key: 'unknown-plan', level: 'Pro' }, {}, null, undefined, 'solo'])
    assert.equal(planIsTop(sp, PLANS), false, 'never proven to be the top: ' + JSON.stringify(sp))
  for (const plans of [null, undefined, [], 'x', [{ key: 'solo', kind: 'individual', components: [] }], [null, 7]])
    assert.equal(planIsTop({ key: 'solo', level: 'Pro' }, plans), false, 'no catalogue, or an unreadable one: nothing proves the plan is the top, so the entry stays')
  ok('planIsTop: true only when the catalogue proves nothing is above the plan (Pro, a paid Team plan); Free, Plus and anything unproven keep the entry')

  assert.equal(loopbackHost('127.0.0.1'), true)
  assert.equal(loopbackHost('127.1.2.3'), true)
  assert.equal(loopbackHost('localhost'), true)
  assert.equal(loopbackHost('[::1]'), true)
  for (const hosted of ['dsh.example.com', '192.168.1.20', '127.0.0.1.evil.test', '127.0.0.256', '', undefined, null])
    assert.equal(loopbackHost(hosted), false, 'not on this machine\'s own address: ' + hosted)
  ok('loopbackHost: this machine\'s own address only (a hosted DSH is not it, an empty or odd name is not proven)')

  // The wiring: ONE entry, after the plan row and before Team settings; the same opener as Team settings, on the plan page; signed out, the server's own /account#plan.
  assert.equal((source.match(/entree\('upgrade'/g) || []).length, 1, 'one Upgrade entry in the account menu')
  assert.ok(/upgradeEntry \? entree\('upgrade', h\(UpgradeIcon[^\n]*t\('menuPlanCta'\), props\.onUpgradePage, \{ ext: true \}\) : null,\n\s*\/\/[^\n]*\n\s*entree\('space-settings'/.test(source), 'the entry says Upgrade, sits right before Team settings, opens through props.onUpgradePage and carries the « leaves DSH » arrow')
  assert.ok(/upgradeEntry = planInfo\.free !== true && typeof props\.onUpgradePage === 'function' && loopbackHost\(pageHost\(\)\) && planIsTop\(st\.space_plan, catalogue\) !== true/.test(source), 'offered for a plan that is not Free, where the page can open (loopback), and that the catalogue does not prove to be the top')
  assert.ok(source.includes("onUpgradePage: ouvrirAppli('plan')"), 'it opens the plan page with the opener Team settings uses (the console link, opened by the host)')
  assert.ok(source.includes("onSpace: ouvrirAppli('plan')"), 'and Team settings still uses the same opener')
  assert.equal((source.match(/callLocal\('\/console\/link'/g) || []).length, 2, 'no new call site of the console link: the quota notice and the footer\'s account page, as before')
  assert.ok(/entree\('plans', h\(UpgradeIcon[^\n]*t\('menuSeePlans'\)[^\n]*'\/account#plan'\)[^\n]*\{ ext: true \}\)/.test(source), 'signed out: « See plans » opens the server\'s own /account#plan')
  assert.ok(/React\.useEffect\(\(\) => \{ if \(phase === 'connected'\) void readPlans\(\) \}, \[phase\]\)/.test(source), 'the catalogue is read as soon as the account is there, so the menu does not show an entry that then goes')
  assert.ok(!/\/billing\/|checkout/.test(source.slice(source.indexOf('// <plan-top:begin>'), source.indexOf('// <server-down:end>'))), 'no payment handling in the new code')
  ok('wiring: one entry before Team settings, the plan page through the Team settings opener (no new console-link call), See plans signed out, no payment code')
}

console.log('V-41 — a server that does not answer')
{
  const m = source.match(/\/\/ <server-down:begin>[\s\S]*?\/\/ <server-down:end>/)
  assert.ok(m !== null, 'the unreachable-server notice is a marked block')
  const serverDownNote = new Function(m[0] + '\nreturn serverDownNote')()
  const en = { srvDownOpen: 'Your account page could not be opened: the server “{name}” ({host}) does not answer.' }
  const t = (k) => en[k]
  const down = { ok: false, status: 0, error: 'injoignable', server: { name: 'Kybernos (local)', host: 'localhost:8791', can_switch: true } }
  assert.deepEqual(serverDownNote(down, t), { text: 'Your account page could not be opened: the server “Kybernos (local)” (localhost:8791) does not answer.', canSwitch: true })
  assert.equal(serverDownNote({ ...down, server: { ...down.server, can_switch: false } }, t).canSwitch, false, 'nothing to switch to: no action')
  assert.equal(serverDownNote({ ...down, server: { ...down.server, can_switch: 'yes' } }, t).canSwitch, false, 'only a boolean true offers it')
  assert.equal(serverDownNote({ ...down, server: { name: 'a $& b', host: 'h' } }, t).text.includes('“a $& b”'), true, 'the name is put in as it is (no replacement pattern)')
  for (const odd of [{ ok: false, error: 'refuse' }, { ok: false, error: 'injoignable' }, { ok: false, error: 'injoignable', server: { name: '', host: '' } }, { ok: false, error: 'injoignable', server: 'x' }, null, undefined, 7])
    assert.equal(serverDownNote(odd, t), null, 'no server named, or not an unreachable server: the caller keeps its own sentence ' + JSON.stringify(odd))
  ok('serverDownNote: names the server (label, host) and says whether another can be chosen; null when the answer names none')

  assert.ok(/const down = serverDownNote\(r, t\)/.test(source), 'the account page notice uses it')
  assert.ok(/'data-kb': 'foot-switch-server'/.test(source) && /openServersPage\(\)/.test(source), 'the notice carries « Switch server »')
  const helper = source.indexOf('const ouvrirReglagesCompte')
  assert.ok(helper > 0 && helper < source.indexOf('const CloudFoot'), 'the helper that opens a Settings page is the footer\'s, not the connected branch\'s: two callers need it')
  assert.equal((source.match(/const ouvrirReglagesCompte/g) || []).length, 1, 'and it exists once')
  assert.ok(/ouvrirReglagesCompte\('Servers', 'kybernos-servers'\)/.test(source), 'Settings › Servers is the page the Servers module registers (its key is kybernos-servers)')
  assert.ok(/addEventListener\('kybernos-cloud:servers'/.test(source), 'the phone link asks for the same through a window event')
  ok('wiring: the notice has « Switch server », the helper is shared, the phone link\'s event is heard')
}

console.log('\n' + passed + ' checks OK')

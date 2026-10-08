// The notice that replaces DSH's « Request quota exhausted » (its own, fixed words for every refusal of a model call: a window used up, a cap an admin set, a failed
// payment). It says what stopped the person, when it comes back and how to get more, from the server's facts for the active space (host route /kybernos-cloud/quota).
//   node packages/kybernos-cloud/test-quota-notice.mjs
//
// The sentence builder is cut out of client.js and run on its own, so what is proven is the shipped code; the registration is checked in the source.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

let failed = 0
const check = (name, ok, detail) => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok || detail === undefined ? '' : '  — ' + detail))
  if (!ok) failed += 1
}

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, 'client.js'), 'utf8')
const from = source.indexOf('// <quota-notice-text>')
const to = source.indexOf('// </quota-notice-text>')
check('the sentence builder is where the test expects it', from > 0 && to > from)
const quotaNoticeText = from > 0 && to > from ? new Function(source.slice(from, to) + '\nreturn quotaNoticeText')() : () => null

// The English of the dictionary, read from the source (the same strings the page uses).
const dictEn = source.slice(source.indexOf('        // ── onglet Account') > 0 ? source.lastIndexOf('menuTeamsSettings:') : 0)
const t = (key) => {
  const m = new RegExp('\\b' + key + ": '((?:[^'\\\\]|\\\\.)*)'").exec(dictEn)
  return m === null ? key : m[1].replace(/\\'/g, "'")
}

const personal = { id: 'w1', name: 'My workspace', role: 'owner', personal: true }
const team = (role) => ({ id: 'w2', name: 'Acme Crew', role, personal: false })
const facts = (workspace, plan, extra = {}) => ({ ok: true, workspace, plan, payment_blocked: false, exhausted: [], ...extra })
const FREE = { key: 'free', name: 'Free', kind: 'free', level: 'Free', status: 'free' }
const STUDIO = { key: 'solo', name: 'Solo', kind: 'individual', level: 'Studio', status: 'active' }
const TEAM = { key: 'team', name: 'Team', kind: 'team', level: '1-5 seats', status: 'active' }

console.log('a window that is used up')
{
  const r = quotaNoticeText(facts(personal, FREE, { exhausted: [{ window_seconds: 18000, scope: 'plan' }] }), t)
  check('a Free person: what (the 5-hour allowance of the Free plan), when (it comes back as older use leaves, whole 5 hours after the last call), how (upgrade or credits)',
    r !== null && /Free/.test(r.text) && /5 hours/.test(r.text) && /used up/.test(r.text) && /comes back/.test(r.text) && /whole again 5 hours after your last call/.test(r.text) && /Upgrade or add credits/.test(r.text), r && r.text)
  check('a person who can buy gets the action that opens Plan & Credits', r !== null && r.action === true)

  const s = quotaNoticeText(facts(personal, STUDIO, { exhausted: [{ window_seconds: 86400, scope: 'plan' }] }), t)
  check('a paying individual: the plan is named with its level, the window is 24 hours', s !== null && /Solo Studio/.test(s.text) && /24 hours/.test(s.text), s && s.text)

  const c = quotaNoticeText(facts(team('member'), TEAM, { exhausted: [{ window_seconds: 86400, scope: 'team' }] }), t)
  check('a cap set in the team is named as such, in the team\'s name', c !== null && /a cap set in Acme Crew/.test(c.text) && /24 hours/.test(c.text), c && c.text)
  check('a plain team member is sent to an owner or admin, with no action of their own', c !== null && /Ask an owner or admin of Acme Crew/.test(c.text) && c.action === false, c && JSON.stringify(c))

  const a = quotaNoticeText(facts(team('admin'), TEAM, { exhausted: [{ window_seconds: 604800, scope: 'plan' }] }), t)
  check('a team admin is told where to add credits or raise the cap, with the action', a !== null && /7 days/.test(a.text) && /Plan & Credits/.test(a.text) && a.action === true, a && JSON.stringify(a))

  const two = quotaNoticeText(facts(personal, FREE, { exhausted: [{ window_seconds: 18000, scope: 'plan' }, { window_seconds: 86400, scope: 'plan' }] }), t)
  check('several windows used up: the shortest is the one named (it frees first)', two !== null && /5 hours/.test(two.text) && !/24 hours/.test(two.text), two && two.text)
}

console.log('a payment that failed')
{
  const m = quotaNoticeText(facts(team('member'), TEAM, { payment_blocked: true }), t)
  check('a member: the team\'s payment failed, AI calls are paused, ask an owner or admin', m !== null && /payment for Acme Crew failed/.test(m.text) && /paused/.test(m.text) && /owner or admin/.test(m.text) && m.action === false, m && JSON.stringify(m))
  const o = quotaNoticeText(facts(team('owner'), TEAM, { payment_blocked: true, exhausted: [{ window_seconds: 18000, scope: 'plan' }] }), t)
  check('an owner: fix it in Billing, with the action; the payment comes before any window', o !== null && /Billing/.test(o.text) && o.action === true && !/allowance/.test(o.text), o && JSON.stringify(o))
}

console.log('what it does not claim')
{
  check('no facts (the server did not answer): nothing is claimed, DSH\'s own words stay', quotaNoticeText(null, t) === null && quotaNoticeText({ ok: false }, t) === null)
  check('nothing used up and no payment problem: nothing is claimed (the failing provider is another one)', quotaNoticeText(facts(personal, FREE), t) === null)
  check('a window the person has no word for still reads (an odd number of seconds)', (quotaNoticeText(facts(personal, FREE, { exhausted: [{ window_seconds: 5400, scope: 'plan' }] }), t) || { text: '' }).text.indexOf('90 minutes') > 0)
  const x = quotaNoticeText(facts({ id: 'w', name: '<b>x</b>', role: 'member', personal: false }, TEAM, { payment_blocked: true }), t)
  check('a team name is text (the page puts it in a text node), never interpreted here', x !== null && x.text.includes('<b>x</b>'))
}

console.log('the registration')
{
  const at = source.indexOf("slots.inject('shell.quota-notice'")
  check('it claims QUOTA only (ACCOUNT_QUOTA is DSH\'s own account notice)', at > 0 && /owner\.code === 'QUOTA'/.test(source.slice(at, at + 700)) && !/ACCOUNT_QUOTA/.test(source.slice(at, at + 700)))
  check('the notice reads the facts from the host route, and the action opens the console through the host', /callLocal\('\/quota', 'GET'\)/.test(source) && /callLocal\('\/console\/link', 'POST'/.test(source))
  check('without facts the notice still shows DSH\'s own message, so nothing is lost', /props\.message/.test(source))
  check('the dictionary has the notice in French and in English', (source.match(/quotaPayment:/g) || []).length === 2 && (source.match(/quotaWindow:/g) || []).length === 2)
}

if (failed > 0) { console.log('\n' + failed + ' check(s) FAILED'); process.exit(1) }
console.log('\nall checks OK')

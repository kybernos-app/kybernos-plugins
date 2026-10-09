// The notice that replaces DSH's « Request quota exhausted » (its own, fixed words for every refusal of a model call: a window used up, a cap an admin set, a failed
// payment), and the meter of the Cloud card. Both say how much of the allowance is used as a PERCENTAGE (never tokens, never dollars), when a used-up window comes back
// and how to get more, from the server's facts for the active team (host route /kybernos-cloud/quota).
//   node packages/kybernos-cloud/test-quota-notice.mjs
//
// The sentence builders are cut out of client.js and run on their own, so what is proven is the shipped code; the registration is checked in the source.
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
const built = from > 0 && to > from ? new Function(source.slice(from, to) + '\nreturn { quotaNoticeText, quotaMeterOf }')() : { quotaNoticeText: () => null, quotaMeterOf: () => null }
const quotaNoticeText = built.quotaNoticeText
const quotaMeterOf = built.quotaMeterOf

// The dictionary of one language, read from the source (the same strings the page uses): French comes first in client.js, English last.
const dictOf = (lang) => source.slice(lang === 'en' ? source.lastIndexOf('menuTeamsSettings:') : source.indexOf('menuTeamsSettings:'))
const translator = (lang) => (key) => {
  const m = new RegExp('\\b' + key + ": '((?:[^'\\\\]|\\\\.)*)'").exec(dictOf(lang))
  return m === null ? key : m[1].replace(/\\'/g, "'").replace(/\\u00a0/g, '\u00a0')
}
const t = translator('en')
const fr = translator('fr')

const personal = { id: 'w1', name: 'My workspace', role: 'owner', personal: true }
const team = (role) => ({ id: 'w2', name: 'Acme Crew', role, personal: false })
const NOW = Date.parse('2026-10-08T12:00:00.000Z')
const inH = (h) => new Date(NOW + h * 3600000).toISOString()
// A window as the host relays it (`usage`): a percent, never money.
const win = (seconds, percent, extra = {}) => ({ kind: 'member', window_seconds: seconds, scope: 'plan', used_percent: percent, exhausted: false, resets_at: null, ...extra })
const out = (seconds, extra = {}) => win(seconds, 100, { exhausted: true, ...extra })
const facts = (workspace, usage = [], extra = {}) => ({ ok: true, workspace, payment_blocked: false, usage, ...extra })
// The time of return keeps its number and its unit together (a non-breaking space): the sentence checks below read plain spaces, the one after them proves the join.
const plain = (r) => (r === null || r === undefined ? r : { ...r, text: r.text.replace(/\u00a0/g, ' ') })
const notice = (f) => plain(quotaNoticeText(f, t, NOW))

console.log('a window that is used up')
{
  const r = notice(facts(personal, [out(18000, { resets_at: inH(3) })]))
  check('the percent, the window and when it comes back, in the server\'s time (« in about 3 h »)',
    r !== null && r.text.startsWith('100% of your 5 hours allowance is used \u2014 it comes back in about 3 h.'), r && r.text)
  const joined = quotaNoticeText(facts(personal, [out(18000, { resets_at: inH(3) })]), t, NOW)
  check('the number and the unit of the time of return never part on a line break (a non-breaking space)', joined !== null && joined.text.includes('in about 3\u00a0h.'), joined && joined.text)
  check('a person who can buy gets how (upgrade or credits) and the action that opens Plan & Credits', r !== null && /Upgrade or add credits/.test(r.text) && r.action === true, r && JSON.stringify(r))
  check('a window in minutes, in hours, in days', /in about 25 min\./.test((notice(facts(personal, [out(18000, { resets_at: new Date(NOW + 25 * 60000).toISOString() })])) || { text: '' }).text)
    && /in about 47 h\./.test((notice(facts(personal, [out(18000, { resets_at: inH(47) })])) || { text: '' }).text)
    && /in about 3 days\./.test((notice(facts(personal, [out(2592000, { resets_at: inH(72) })])) || { text: '' }).text))
  const old = notice(facts(personal, [out(18000)]))
  check('an older server (no resets_at): it comes back as older use leaves the window', old !== null && /^100% of your 5 hours allowance is used \u2014 it comes back as older use leaves that window, and is whole again 5 hours after your last call\./.test(old.text), old && old.text)
  const past = notice(facts(personal, [out(18000, { resets_at: inH(-1) })]))
  check('a time already past says nothing it cannot keep', past !== null && /as older use leaves that window/.test(past.text), past && past.text)

  const s = notice(facts(personal, [out(86400, { resets_at: inH(9) })]))
  check('a 24-hour window', s !== null && /^100% of your 24 hours allowance is used/.test(s.text) && /in about 9 h\./.test(s.text), s && s.text)

  const c = notice(facts(team('member'), [out(86400, { scope: 'team', resets_at: inH(2) })]))
  check('a cap set in the team is named as such, in the team\'s name', c !== null && /^100% of your 24 hours allowance \(a cap set in Acme Crew\) is used/.test(c.text), c && c.text)
  check('a plain team member is sent to an owner or admin, with no action of their own', c !== null && /Ask an owner or admin of Acme Crew/.test(c.text) && c.action === false, c && JSON.stringify(c))

  const a = notice(facts(team('admin'), [out(604800, { resets_at: inH(100) })]))
  check('a team admin is told where to add credits or raise the cap, with the action', a !== null && /7 days/.test(a.text) && /Plan & Credits/.test(a.text) && a.action === true, a && JSON.stringify(a))

  const pool = notice(facts(team('member'), [win(18000, 20), out(18000, { kind: 'pool', resets_at: inH(1) })]))
  check('the team\'s pool used up turns everyone away: named after the team, not as the person\'s own', pool !== null && /^100% of the 5 hours allowance of Acme Crew is used \u2014 it comes back in about 1 h\./.test(pool.text) && /Ask an owner or admin of Acme Crew/.test(pool.text), pool && pool.text)

  const two = notice(facts(personal, [out(86400, { resets_at: inH(9) }), out(18000, { resets_at: inH(3) })]))
  check('several windows used up: the one that opens LAST is named (calls stay refused until it does), with its own time', two !== null && /^100% of your 24 hours/.test(two.text) && /in about 9 h\./.test(two.text) && !/5 hours/.test(two.text), two && two.text)
  const noTime = notice(facts(personal, [out(18000), out(86400)]))
  check('no time from the server (an older one): the longer window', noTime !== null && /^100% of your 24 hours/.test(noTime.text), noTime && noTime.text)
  const later = notice(facts(team('owner'), [out(18000, { kind: 'pool', resets_at: inH(2) }), out(18000, { resets_at: inH(1) })]))
  check('the same length: the one that opens later, here the team\'s pool', later !== null && /^100% of the 5 hours allowance of Acme Crew/.test(later.text) && /in about 2 h\./.test(later.text), later && later.text)
  const tie = notice(facts(team('owner'), [out(18000, { kind: 'pool', resets_at: inH(2) }), out(18000, { resets_at: inH(2) })]))
  check('the same length and the same time: the person\'s own window before the team\'s pool', tie !== null && /^100% of your 5 hours/.test(tie.text), tie && tie.text)
}

console.log('a window that is close to being used up')
{
  const g = notice(facts(personal, [win(86400, 82)]))
  check('a gentle word: « 82% of your 24 hours allowance is used. », nothing about coming back', g !== null && g.text === '82% of your 24 hours allowance is used.', g && g.text)
  check('and the action to get more is there for a person who can buy', g !== null && g.action === true)
  check('a plain member is not offered the action', (notice(facts(team('member'), [win(86400, 90)])) || {}).action === false)
  check('75% is close enough, 74% is not', notice(facts(personal, [win(18000, 75)])) !== null && notice(facts(personal, [win(18000, 74)])) === null)
  const most = notice(facts(personal, [win(18000, 80), win(86400, 91), win(2592000, 40)]))
  check('several: the most used one is named', most !== null && /^91% of your 24 hours/.test(most.text), most && most.text)
  const tie = notice(facts(personal, [win(18000, 80), win(2592000, 80)]))
  check('the same percent: the longer window', tie !== null && /30 days/.test(tie.text), tie && tie.text)
  const t2 = notice(facts(team('admin'), [win(18000, 88, { kind: 'pool' })]))
  check('the team\'s pool close to it is named after the team', t2 !== null && t2.text === '88% of the 5 hours allowance of Acme Crew is used.', t2 && t2.text)
  const both = notice(facts(personal, [win(18000, 99), out(86400, { resets_at: inH(5) })]))
  check('a window used up comes before one that is merely close', both !== null && /^100% of your 24 hours/.test(both.text), both && both.text)
  check('a window the allowance of a top-up lifts (100%, but not used up) reads as a plain percent', (notice(facts(personal, [win(2592000, 100)])) || { text: '' }).text === '100% of your 30 days allowance is used.')
}

console.log('never tokens, never dollars')
{
  const samples = [
    notice(facts(personal, [out(18000, { resets_at: inH(3) })])), notice(facts(personal, [win(86400, 82)])), notice(facts(team('admin'), [out(86400, { kind: 'pool', resets_at: inH(30) })])),
    quotaMeterOf(facts(personal, [win(86400, 82)]), t, NOW), quotaMeterOf(facts(team('owner'), [win(18000, 50, { kind: 'pool' })]), t, NOW),
  ]
  const texts = samples.map((x) => (x === null ? '' : x.text !== undefined ? x.text : x.title))
  check('every sentence carries a percent and no money or token figure', texts.every((x) => /\d+%/.test(x) && !/[$\u20ac]|USD|EUR|token/i.test(x)), texts)
  const block = source.slice(from, to)
  check('the code that builds them never reads an amount of money', !/_usd/.test(block))
  const fx = notice(facts(personal, [out(18000, { resets_at: inH(3) })])) // the same sentence in French, with a non-breaking space before the sign
  const f2 = quotaNoticeText(facts(personal, [out(18000, { resets_at: inH(3) })]), fr, NOW)
  check('in French the percent sign follows a non-breaking space, and the time reads « dans environ 3 h »', fx !== null && f2 !== null && f2.text.startsWith('100\u00a0% de votre quota de 5 heures est utilis\u00e9 \u2014 il revient dans environ 3\u00a0h.'), f2 && f2.text)
  const f3 = quotaNoticeText(facts(personal, [win(86400, 82)]), fr, NOW)
  check('and the gentle word', f3 !== null && f3.text === '82\u00a0% de votre quota de 24 heures est utilis\u00e9.', f3 && f3.text)
}

console.log('the meter of the card')
{
  const m = (f) => { const r = quotaMeterOf(f, t, NOW); return r === null ? null : { ...r, title: r.title.replace(/\u00a0/g, ' ') } }
  const own = m(facts(personal, [win(18000, 42), win(86400, 17)]))
  check('a personal space shows its own most used window', own !== null && own.percent === 42 && own.level === 'ok' && own.title === '42% of your 5 hours allowance is used.', own)
  const owner = m(facts(team('owner'), [win(18000, 10), win(18000, 60, { kind: 'pool' }), win(86400, 35, { kind: 'pool' })]))
  check('an owner of a team sees the team\'s pool, not their own share', owner !== null && owner.percent === 60 && owner.title === '60% of the 5 hours allowance of Acme Crew is used.', owner)
  const admin = m(facts(team('admin'), [win(18000, 10), win(18000, 60, { kind: 'pool' })]))
  check('so does an admin', admin !== null && admin.percent === 60)
  const member = m(facts(team('member'), [win(18000, 10), win(18000, 60, { kind: 'pool' })]))
  check('a member sees their own', member !== null && member.percent === 10 && /^10% of your 5 hours/.test(member.title), member)
  check('an admin of a team with no pool windows falls back to their own, a member with none to the pool',
    (m(facts(team('admin'), [win(18000, 12)])) || {}).percent === 12 && (m(facts(team('member'), [win(18000, 33, { kind: 'pool' })])) || {}).percent === 33)
  const blocked = m(facts(team('owner'), [out(86400, { resets_at: inH(5) }), win(18000, 20, { kind: 'pool' })]))
  check('a window that turns the person away is always the one shown: 100%, whoever they are', blocked !== null && blocked.percent === 100 && blocked.level === 'full' && /comes back in about 5 h/.test(blocked.title), blocked)
  const poolOut = m(facts(team('member'), [win(18000, 10), out(18000, { kind: 'pool', resets_at: inH(1) })]))
  check('a member whose team\'s pool is used up reads 100% too', poolOut !== null && poolOut.percent === 100 && poolOut.level === 'full' && /Acme Crew/.test(poolOut.title), poolOut)
  check('the colour levels: ok below 75, near from 75, full only while calls are turned away',
    m(facts(personal, [win(18000, 74)])).level === 'ok' && m(facts(personal, [win(18000, 75)])).level === 'near' && m(facts(personal, [win(18000, 99)])).level === 'near' && m(facts(personal, [out(18000)])).level === 'full')
  const lifted = m(facts(personal, [win(2592000, 100)]))
  check('100% of an allowance that a top-up balance lifts: calls still pass, so amber and not red', lifted !== null && lifted.percent === 100 && lifted.level === 'near', lifted)
  check('0% is shown as 0% (nothing spent)', (m(facts(personal, [win(18000, 0)])) || {}).percent === 0)
  const pay = m(facts(team('owner'), [win(18000, 5)], { payment_blocked: true }))
  check('a payment that failed reads 100% (calls are refused) and says why', pay !== null && pay.percent === 100 && pay.level === 'full' && /payment for Acme Crew failed/.test(pay.title), pay)
  check('nothing to show: no windows, unlimited windows, a server that did not answer',
    m(facts(personal, [])) === null && m(facts(personal, [win(18000, null)])) === null && m(null) === null && m({ ok: false }) === null && m(undefined) === null && m(facts(personal)) === null)
  check('a window with no usable number is left out', (m(facts(personal, [{ kind: 'member', window_seconds: 18000, used_percent: 'lots' }, win(86400, 20)])) || {}).percent === 20)
}

console.log('a payment that failed')
{
  const m = notice(facts(team('member'), [], { payment_blocked: true }))
  check('a member: the team\'s payment failed, AI calls are paused, ask an owner or admin', m !== null && /payment for Acme Crew failed/.test(m.text) && /paused/.test(m.text) && /owner or admin/.test(m.text) && m.action === false, m && JSON.stringify(m))
  const o = notice(facts(team('owner'), [out(18000)], { payment_blocked: true }))
  check('an owner: fix it in Billing, with the action; the payment comes before any window', o !== null && /Billing/.test(o.text) && o.action === true && !/allowance/.test(o.text), o && JSON.stringify(o))
}

console.log('what it does not claim')
{
  check('no facts (the server did not answer): nothing is claimed, DSH\'s own words stay', quotaNoticeText(null, t) === null && quotaNoticeText({ ok: false }, t) === null && quotaNoticeText(undefined, t) === null)
  check('nothing used up, nothing close and no payment problem: nothing is claimed (the failing provider is another one)', notice(facts(personal, [win(18000, 40), win(86400, 3)])) === null && notice(facts(personal)) === null)
  check('a window the person has no word for still reads (an odd number of seconds)', (notice(facts(personal, [out(5400)])) || { text: '' }).text.indexOf('90 minutes') > 0)
  check('an unlimited window (no percent) is never mentioned', notice(facts(personal, [win(18000, null)])) === null)
  const x = notice(facts({ id: 'w', name: '<b>x</b>', role: 'member', personal: false }, [], { payment_blocked: true }))
  check('a team name is text (the page puts it in a text node), never interpreted here', x !== null && x.text.includes('<b>x</b>'))
}

console.log('the registration')
{
  const at = source.indexOf("slots.inject('shell.quota-notice'")
  check('it claims QUOTA only (ACCOUNT_QUOTA is DSH\'s own account notice)', at > 0 && /owner\.code === 'QUOTA'/.test(source.slice(at, at + 700)) && !/ACCOUNT_QUOTA/.test(source.slice(at, at + 700)))
  check('the notice reads the facts from the host route, and the action opens the console through the host', /callLocal\('\/quota', 'GET'\)/.test(source) && /callLocal\('\/console\/link', 'POST'/.test(source))
  check('without facts the notice still shows DSH\'s own message, so nothing is lost', /props\.message/.test(source))
  check('the dictionary has the notice in French and in English', ['quotaPayment', 'quotaUsedUp', 'quotaUsedUpTeam', 'quotaNear', 'quotaNearTeam', 'quotaBackMin', 'quotaBackHours', 'quotaBackDays', 'quotaBackUnknown'].every((k) => (source.match(new RegExp('\\b' + k + ':', 'g')) || []).length === 2) && !/\bquotaWindow:|\bquotaComes:/.test(source))
}

console.log('what the card says when the workspace turns the person away')
{
  const f = source.indexOf('// <mfa-note-text>')
  const g = source.indexOf('// </mfa-note-text>')
  check('the note builder is where the test expects it', f > 0 && g > f)
  const fill = source.slice(source.indexOf('const quotaFill'), source.indexOf('const quotaWindowLabel'))
  const mfaNoteText = new Function(fill + source.slice(f, g) + '\nreturn mfaNoteText')()
  const fmt = (iso) => iso.slice(0, 10)
  const blocked = mfaNoteText({ state: 'blocked', ends: null }, 'Acme Crew', t, fmt)
  check('past the grace: the reason and what to do, in the workspace\'s name', blocked !== null && /Second factor required/.test(blocked.short) && /Acme Crew asks its members for a second factor/.test(blocked.long) && /set one up in your Kybernos account/.test(blocked.long), blocked && JSON.stringify(blocked))
  const grace = mfaNoteText({ state: 'grace', ends: '2026-10-15T12:00:00.000Z' }, 'Acme Crew', t, fmt)
  check('inside the grace: by when', grace !== null && /2026-10-15/.test(grace.short) && /before 2026-10-15/.test(grace.long), grace && JSON.stringify(grace))
  check('nothing asked: nothing said (also a grace with no date)', mfaNoteText(null, 'x', t, fmt) === null && mfaNoteText(undefined, 'x', t, fmt) === null && mfaNoteText({ state: 'grace', ends: null }, 'x', t, fmt) === null && mfaNoteText({ state: 'other' }, 'x', t, fmt) === null)
  check('the card shows it beside the plan, with the long sentence as its title; fr and en are in the dictionary', /'data-kb': mfaNote !== null \? 'workspace-card-mfa'/.test(source) && (source.match(/mfaBlockedLong:/g) || []).length === 2 && (source.match(/mfaGraceLong:/g) || []).length === 2)
}

if (failed > 0) { console.log('\n' + failed + ' check(s) FAILED'); process.exit(1) }
console.log('\nall checks OK')

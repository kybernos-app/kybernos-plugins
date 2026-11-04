#!/usr/bin/env node
// Case J20-03 of docs/tests/user-journey: hostile strings go into every name field a person (or a stranger who is invited) can set on the SERVER, on a DISPOSABLE replica. Nothing may answer 5xx,
// no text the server accepted may come back different from what was sent (no silent rewriting), and a name that is one line in every place it is shown (the invitation subject, the sidebar, a header)
// must not hold a line break, a NUL, an invisible tag character or a bidirectional override. HTML and script are allowed to be accepted (the pages draw text, not markup) or refused; either is recorded.
//
//   node scripts/check-hostile-strings-live.mjs --api http://localhost:8841 --control http://127.0.0.1:8842 [--json]
//
// Fields: the display name at sign-up, the team name at creation and at rename, the name inside the invitation mail's subject. Not covered here (they need a DSH): skill, automation and chat texts, a shared page,
// which `docs/dev/hidden-text-vectors.json` already feeds through the hidden-text gate. Refuses a non-loopback address (exit 2). Exit 0 when every check passed, 1 otherwise.
import { pathToFileURL } from 'node:url'
import { isLoopback } from './replica-owner-settings.mjs'
import { makeClient, signUp } from './check-stripe-replica-money.mjs'

// Built from code points: the characters themselves do not survive the editors and shells that touch this file.
const cp = (...codes) => String.fromCodePoint(...codes)
const range = (a, b) => cp(a) + '-' + cp(b)
const ONE_LINE_BREAKERS = new RegExp('[' + range(0, 0x1f) + range(0x7f, 0x9f) + cp(0x2028, 0x2029) + ']')
const INVISIBLE_OR_BIDI = new RegExp('[' + range(0x202a, 0x202e) + range(0x2066, 0x2069) + range(0xe0000, 0xe007f) + ']', 'u')


/** The strings, and what a one-line name field must do with each. 'accept': a plain name, kept as typed. 'either': refused, or kept, or normalised. 'clean': refused, or stored with no line break, control, invisible or
 *  bidirectional-override character (cleaning it is as good as refusing it). 'blank': refused, or stored non-blank (a fallback name is fine). 'short': refused, or stored at 200 characters or fewer. */
export const STRINGS = [
  ['plain name', 'Équipe Zoé', 'accept'],
  ['arabic name', 'فريق المبيعات', 'accept'],
  ['an emoji and a ZWJ family', 'Team ' + cp(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467, 0x200d, 0x1f466) + ' ' + cp(0x1f680), 'accept'],
  ['a mark that flips the direction (RLM)', 'Team' + cp(0x200f) + ' Ops', 'either'],
  ['HTML tag', 'Team <b>bold</b>', 'either'],
  ['script tag', '<script>alert(1)</script>', 'either'],
  ['image with a handler', '<img src=x onerror=alert(1)>', 'either'],
  ['an attribute breaker', '" onmouseover="alert(1)', 'either'],
  ['a template marker', '{{7*7}} ${7*7} #{7*7}', 'either'],
  ['a quote and SQL', "Robert'); DROP TABLE teams;--", 'either'],
  ['a path', '../../etc/passwd', 'either'],
  ['a line break', 'Line one' + cp(10) + 'Line two', 'clean'],
  ['a carriage return and a header', 'Evil' + cp(13, 10) + 'Bcc: evil@example.test', 'clean'],
  ['a NUL', 'Team' + cp(0) + 'Zero', 'clean'],
  ['a tab', 'Team' + cp(9) + 'Tabbed', 'clean'],
  ['a bidirectional override', 'Team ' + cp(0x202e) + 'terces', 'clean'],
  ['an invisible tag text', 'Team' + String.fromCodePoint(0xe0041, 0xe0042, 0xe0043), 'clean'],
  ['only spaces', '     ', 'blank'],
  ['empty', '', 'blank'],
  ['300 letters', 'A'.repeat(300), 'short'],
  ['4,000 letters', 'B'.repeat(4000), 'short'],
  ['a stack of combining marks', 'Z' + (cp(0x300) + cp(0x301) + cp(0x302) + cp(0x303)).repeat(60), 'either']
]

async function main () {
  const argv = process.argv.slice(2)
  const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : '' }
  const api = (opt('--api') || '').replace(/\/$/, '')
  const control = (opt('--control') || '').replace(/\/$/, '')
  if (!api || !control) { console.error('usage: check-hostile-strings-live --api <loopback url> --control <loopback url> [--json]'); process.exit(2) }
  if (!isLoopback(api) || !isLoopback(control)) { console.error('check-hostile-strings-live: both addresses must be loopback (a replica, never a real server)'); process.exit(2) }
  const c = makeClient(api, control)
  const fails = []
  const notes = []
  const rows = []
  const label = Date.now().toString(36)
  const fiveXX = (where, label2, r) => { if (r.status >= 500) fails.push(`${where} « ${label2} »: the server answered ${r.status}`) }
  const cleaned = new Set()
  const judge = (where, [what, text, rule], r, back) => {
    const accepted = r.status >= 200 && r.status < 300
    const stored = back === undefined || back === null ? undefined : String(back)
    const bad = []
    if (r.status >= 500) bad.push(`answered ${r.status}`)
    if (rule === 'accept') {
      if (!accepted) bad.push(`a plain name was refused (${r.status})`)
      else if (stored !== undefined && stored !== text) bad.push(`came back different (${JSON.stringify(stored.slice(0, 40))})`)
    }
    if (accepted && stored !== undefined) {
      if (rule !== 'accept' && (ONE_LINE_BREAKERS.test(stored) || INVISIBLE_OR_BIDI.test(stored)) && rule !== 'blank' && rule !== 'short') bad.push(`a line break, control, invisible or override character is kept in the stored name (${stored.length} characters)`)
      if (rule === 'blank' && stored.trim() === '') bad.push('a blank name is stored')
      if (rule === 'short' && stored.length > 200) bad.push(`${stored.length} characters are stored`)
      if (rule !== 'accept' && stored !== text) cleaned.add(`${what}: the server stores ${JSON.stringify(stored.slice(0, 30))}${stored.length > 30 ? '…' : ''}`)
    }
    rows.push({ where, what, status: r.status, ok: bad.length === 0 })
    if (bad.length) fails.push(`${where} « ${what} »: ${bad.join('; ')}`)
    return accepted
  }
  console.log('J20-03 hostile strings in the server\'s name fields')

  // 1. the display name at sign-up
  let signedUp = 0
  for (const s of STRINGS) {
    const email = `hostile-${label}-${signedUp++}@replica.test`
    const r = await c.call('POST', '/api/auth/sign-up/email', { json: { email, password: 'correct horse battery staple', name: s[1] } })
    const back = r.body && r.body.user ? r.body.user.name : undefined
    judge('display name at sign-up', s, r, back)
  }
  console.log(`  display name at sign-up: ${rows.filter((x) => x.where === 'display name at sign-up' && x.ok).length}/${STRINGS.length} as expected`)

  // 2 and 3. the team name at creation and at rename
  const owner = await signUp(c, 'ho')
  const base = await c.call('POST', '/v1/workspaces', { cookie: owner.cookie, json: { name: 'Hostile base' } })
  const wsId = base.body && base.body.id
  for (const s of STRINGS) {
    const r = await c.call('POST', '/v1/workspaces', { cookie: owner.cookie, json: { name: s[1] } })
    judge('team name at creation', s, r, r.body ? r.body.name : undefined)
  }
  console.log(`  team name at creation: ${rows.filter((x) => x.where === 'team name at creation' && x.ok).length}/${STRINGS.length} as expected`)
  if (wsId) {
    for (const s of STRINGS) {
      const r = await c.call('PATCH', `/v1/workspaces/${wsId}`, { cookie: owner.cookie, json: { name: s[1] } })
      const read = r.status < 300 ? await c.call('GET', `/v1/workspaces/${wsId}`, { cookie: owner.cookie }) : null
      judge('team name at rename', s, r, read && read.body ? read.body.name : undefined)
    }
    console.log(`  team name at rename: ${rows.filter((x) => x.where === 'team name at rename' && x.ok).length}/${STRINGS.length} as expected`)
    // 4. whatever name a team can carry reaches the invitation subject as one line
    const mails = []
    for (const [i, s] of STRINGS.entries()) {
      const set = await c.call('PATCH', `/v1/workspaces/${wsId}`, { cookie: owner.cookie, json: { name: s[1] } })
      if (set.status >= 300) continue
      const to = `inv-${label}-${i}@replica.test`
      const inv = await c.call('POST', `/v1/workspaces/${wsId}/invitations`, { cookie: owner.cookie, json: { email: to, role: 'member' } })
      fiveXX('invitation', s[0], inv)
      if (inv.status >= 300) continue
      const m = (await c.ctl(`/__/mail?to=${encodeURIComponent(to)}`)).body || {}
      mails.push(s[0])
      if (/[\r\n]/.test(String(m.subject || ''))) fails.push(`invitation subject « ${s[0]} »: the subject is on more than one line`)
      if (/\nBcc:/i.test(String(m.subject || ''))) fails.push(`invitation subject « ${s[0]} »: a header line got into the subject`)
    }
    console.log(`  invitation subject: ${mails.length} mails read, each subject one line`)
  } else notes.push('the base team was not created: the rename and invitation checks were skipped')

  const accepted = rows.filter((r) => r.status >= 200 && r.status < 300).length
  for (const x of [...cleaned].slice(0, 12)) notes.push('cleaned, not refused — ' + x)
  notes.push(`${rows.length} submissions: ${accepted} accepted, ${rows.length - accepted} refused, ${rows.filter((r) => r.status >= 500).length} server errors`)
  if (argv.includes('--json')) console.log(JSON.stringify({ rows, fails, notes }, null, 2))
  else {
    for (const f of fails.slice(0, 30)) console.log('  ✗ ' + f)
    if (fails.length > 30) console.log(`  ✗ … ${fails.length - 30} more (--json lists them)`)
    for (const n of notes) console.log('  · ' + n)
    console.log(`\n${fails.length} failure(s)`)
  }
  process.exit(fails.length === 0 ? 0 : 1)
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main().catch((e) => { console.error(String(e.message || e)); process.exit(1) })

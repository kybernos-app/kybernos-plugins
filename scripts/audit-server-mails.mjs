#!/usr/bin/env node
// Case J21-08 of docs/tests/user-journey: every transactional e-mail the server can send is triggered on a DISPOSABLE replica, read from its mailbox and checked on what a recipient would notice:
// a subject that names the server, a body with no placeholder and no « undefined », the code or the link that the mail is for, the lifetime it states, one line in the subject whatever the names inside it, the same mail in French when the
// person asked for French. The replica's mailbox keeps the plain text only (the server sends no HTML), which is itself a finding to read.
//
//   node scripts/audit-server-mails.mjs --api http://localhost:8841 --control http://127.0.0.1:8842 [--json]
//
// Mails covered: sign-up confirmation, sign-in code, password reset, the invitation to a team (with a hostile team name). Not covered yet: the second-factor recovery, a social account connected, the owner's notices.
// Refuses an address that is not loopback. Exit 0 when every check passed, 1 otherwise, 2 on a refusal. FINDINGS that need the owner's reading (language, brand) are listed apart and do not fail the run.
import { pathToFileURL } from 'node:url'
import { isLoopback } from './replica-owner-settings.mjs'
import { makeClient, signUp } from './test-stripe-replica-money.mjs'

const BAD_TEXT = /undefined|\bnull\b|\[object|\{\{|TODO|TO VERIFY|lorem ipsum|NaN/i
const FRENCH = /\b(votre|vous|valable|expire dans|mot de passe|invit[ée]e?)\b/i

async function main () {
  const argv = process.argv.slice(2)
  const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : '' }
  const api = (opt('--api') || '').replace(/\/$/, '')
  const control = (opt('--control') || '').replace(/\/$/, '')
  if (!api || !control) { console.error('usage: audit-server-mails --api <loopback url> --control <loopback url> [--json]'); process.exit(2) }
  if (!isLoopback(api) || !isLoopback(control)) { console.error('audit-server-mails: both addresses must be loopback (a replica, never a real server)'); process.exit(2) }
  const c = makeClient(api, control)
  const fails = []
  const notes = []
  const mails = []
  const mailTo = async (to) => (await c.ctl(`/__/mail?to=${encodeURIComponent(to)}`)).body
  const judge = (name, mail, wants) => {
    const subject = String((mail || {}).subject || '')
    const text = String((mail || {}).text || '')
    const bad = []
    if (!subject) bad.push('no subject')
    if (!text) bad.push('no body')
    if (/[\r\n]/.test(subject)) bad.push('the subject is on more than one line')
    if (BAD_TEXT.test(subject + ' ' + text)) bad.push('a placeholder or « undefined » in the mail')
    if (!/\(.+\)\s*$/.test(subject) && !/Kybernos|replica/i.test(subject)) bad.push('the subject does not name the server')
    for (const [label, re] of Object.entries(wants || {})) if (!re.test(text)) bad.push(`the body lacks ${label}`)
    if (text.length > 900) bad.push(`the body is ${text.length} characters`)
    mails.push({ name, subject, chars: text.length })
    if (bad.length) fails.push(`${name}: ${bad.join('; ')}`)
    console.log(`  ${bad.length ? '✗' : '✓'} ${name} — « ${subject.slice(0, 80)} », ${text.length} characters${bad.length ? ' — ' + bad.join('; ') : ''}`)
    return { subject, text }
  }
  console.log('J21-08 transactional e-mails on the replica')

  // 1. sign-up confirmation (the person is created, the code mailed)
  const label = Date.now().toString(36)
  const email = `mails-${label}@replica.test`
  const made = await c.call('POST', '/api/auth/sign-up/email', { json: { email, password: 'correct horse battery staple', name: 'Mail Person' } })
  if (made.status !== 200) { console.error(`sign-up answered ${made.status}`); process.exit(1) }
  const signup = judge('sign-up confirmation', await mailTo(email), { 'a 6-digit code': /\b\d{6}\b/, 'its lifetime': /expires in \d+ minutes/i })
  await c.call('POST', '/api/auth/email-otp/verify-email', { json: { email, otp: (await c.ctl(`/__/code?to=${encodeURIComponent(email)}`)).body.code } })

  // 2 and 3. the other codes
  for (const [type, name] of [['sign-in', 'sign-in code'], ['forget-password', 'password reset']]) {
    const r = await c.call('POST', '/api/auth/email-otp/send-verification-otp', { json: { email, type } })
    if (r.status !== 200) { fails.push(`${name}: the request answered ${r.status}`); console.log(`  ✗ ${name} — the request answered ${r.status}`); continue }
    judge(name, await mailTo(email), { 'a 6-digit code': /\b\d{6}\b/, 'its lifetime': /expires in \d+ minutes/i })
  }

  // 4. the same code asked in French: the mail must follow the person's language, or the gap is written down
  const fr = await c.call('POST', '/api/auth/email-otp/send-verification-otp', { json: { email, type: 'sign-in' }, headers: { 'accept-language': 'fr-FR,fr;q=0.9' } })
  const frMail = await mailTo(email)
  const asked = fr.status === 200
  if (asked && !FRENCH.test(`${frMail.subject} ${frMail.text}`)) notes.push('a code asked with « Accept-Language: fr-FR » comes back in English: the server e-mails ignore the language of the person (one fixed English template, no HTML, no brand block)')

  // 5. the invitation to a team, with a team name made to break a subject line
  const owner = await signUp(c, 'mo')
  const invitee = `invitee-${label}@replica.test`
  const withBreak = await c.call('POST', '/v1/workspaces', { cookie: owner.cookie, json: { name: 'Évil\r\nBcc: evil@example.test' } })
  notes.push(withBreak.status >= 400 && withBreak.status < 500 ? `a team name with a line break is refused at creation (${withBreak.status}): no header injection through the invitation subject` : `a team name with a line break was ACCEPTED (${withBreak.status}): the invitation subject must still be one line`)
  // the name that is accepted and is dangerous in a header (a line break) is the one to mail; one the server refuses (markup) is a refusal noted
  const markup = await c.call('POST', '/v1/workspaces', { cookie: owner.cookie, json: { name: 'Équipe <b>"Ünï"</b> & Co' } })
  notes.push(markup.status >= 400 && markup.status < 500 ? `a team name with markup (<b>) is refused at creation (${markup.status})` : `a team name with markup (<b>) is accepted (${markup.status}); a plain-text mail shows it as typed`)
  const ws = withBreak.status === 201 || withBreak.status === 200 ? withBreak.body : markup.body
  const wsId = ws && ws.id
  if (!wsId) { notes.push('no hostile team name was accepted: the invitation was not mailed with one') } else {
    const inv = await c.call('POST', `/v1/workspaces/${wsId}/invitations`, { cookie: owner.cookie, json: { email: invitee, role: 'member' } })
    if (inv.status !== 201 && inv.status !== 200) { fails.push(`invitation: the request answered ${inv.status}`) } else {
      const mail = judge('team invitation (hostile team name)', await mailTo(invitee), { 'a link with the token': /token=[A-Za-z0-9_-]+/, 'who invited': /invited/i })
      if (/\nBcc:/i.test(mail.subject)) fails.push('invitation: a line break of the team name reached the subject')
      const link = (mail.text.match(/https?:\/\/[^\s)]+/) || [])[0]
      if (!link) fails.push('invitation: no link in the mail')
      else { try { const u = new URL(link); notes.push(`the invitation link points at ${u.origin}${u.pathname} (the web origin the server was started with)`) } catch { fails.push('invitation: the link is not an address') } }
      if (!/7 days|seven days|expires/i.test(mail.text)) notes.push('the invitation mail does not say how long the invitation lasts (the page says 7 days)')
    }
  }
  void signup

  if (argv.includes('--json')) console.log(JSON.stringify({ mails, fails, notes }, null, 2))
  else {
    for (const n of notes) console.log('  · ' + n)
    console.log(`\n${mails.length} mails read, ${fails.length} failure(s), ${notes.length} note(s) for the owner`)
  }
  process.exit(fails.length === 0 ? 0 : 1)
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main().catch((e) => { console.error(String(e.message || e)); process.exit(1) })

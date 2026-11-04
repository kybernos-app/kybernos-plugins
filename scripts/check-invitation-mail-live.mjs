#!/usr/bin/env node
// J09-03 and J09-12: the invitation e-mail itself and what the screens say about the answers that do not exist.
//   - the mail a replica holds for an invitation: plain text only, English, one link on the server's own origin, its lifetime, nothing about the app;
//   - the link opened in a desktop browser signed out, in a phone browser (390 x 844, touch, iPhone user agent) signed out, signed in as the invited address, signed in as
//     another account, and after it was used: what each page says, that the token leaves the address bar, that nothing scrolls sideways at 390 px;
//   - J09-12: there is no decline route; the accept page offers « Accept » and « This is not my account » only; no mail goes to the inviter when the invitation is accepted, to the invitee
//     when it is withdrawn, to a member who is removed or who leaves; no page of the journey promises one.
//
//   export KB_E2E_API=… KB_E2E_WEB=… KB_E2E_CONTROL=… KB_E2E_DIR=… KB_SERVER_DIR=…        (a replica made by scripts/user-journey-replica.sh, started with REPLICA_WEB_ORIGIN = its own address
//                                                                                         so that the link of the e-mail opens on the replica)
//   node scripts/check-invitation-mail-live.mjs [--out <folder>]
//
// It makes its own accounts (@replica.test) and team; it never touches a DSH. Exit 0 = every check passed, 1 = one failed, 3 = wrong environment (no replica, or the mail's link is not on the replica).
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeServer, fresh } from './lib-e2e-server.mjs'
import { openSite, sleep } from './lib-site-browser.mjs'

const arg = (n, d) => (process.argv.indexOf(n) >= 0 ? process.argv[process.argv.indexOf(n) + 1] : d)
if (!process.env.KB_E2E_API || !process.env.KB_E2E_CONTROL || !process.env.KB_E2E_DIR) { console.error('not run: KB_E2E_* is not set (scripts/user-journey-replica.sh)'); process.exit(3) }
const out = arg('--out', join(process.env.KB_E2E_DIR, '..', 'j09-03'))
mkdirSync(out, { recursive: true })
const S = makeServer()
const web = S.e.web
const results = []
const report = { mail: {}, pages: {}, probes: {}, mailboxes: {} }
const check = (name, ok, detail) => { results.push({ name, ok: ok === true, detail }); console.log((ok === true ? '  ok   ' : '  FAIL ') + name + (ok === true || detail === undefined ? '' : '  -> ' + JSON.stringify(detail).slice(0, 300))); return ok === true }
const note = (t) => console.log('  ..   ' + t)

const make = async (label) => { const a = fresh(label); a.email = a.email.replace('@example.test', '@replica.test'); await S.signUp(a.email, a.password, a.name); const s = await S.signIn(a.email, a.password); return { ...a, id: s.id, cookie: s.cookie } }
const owner = await S.ownerSession()
const A = await make('owner'); const D = await make('invitee'); const E = await make('withdrawn'); const F = await make('declines'); const X = await make('other'); const M = await make('member')
const team = await S.call('POST', '/v1/workspaces', { cookie: A.cookie, json: { name: 'Mail Journey Team' } })
if (team.status !== 201) { console.error('not run: cannot make a team ' + team.status); process.exit(3) }
await owner.admin('PUT', `/v1/admin/billing/workspaces/${team.body.id}/subscription`, { plan: 'team', component: 'seats', quantity: 6, replace: true })
const ws = team.body.id
const invite = (who, role = 'member') => S.call('POST', `/v1/workspaces/${ws}/invitations`, { cookie: A.cookie, json: { email: who.email, role } })
const lastMail = async (who) => { const m = await S.mail(who.email); return JSON.stringify({ s: m.subject, t: m.text }) }

// ── J09-03: the mail ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
console.log('\nJ09-03 the e-mail')
const before = { A: await lastMail(A), D: await lastMail(D) }
const inv = await invite(D)
check('the invitation is sent (201)', inv.status === 201, inv.status)
const mail = await S.mail(D.email)
const urls = (mail.text || '').match(/https?:\/\/\S+/g) || []
const link = urls[0] || ''
report.mail = { keys: Object.keys(mail), subject: mail.subject, subjectLength: (mail.subject || '').length, textLength: (mail.text || '').length, lines: (mail.text || '').split('\n').length, urls: urls.map((u) => u.replace(/token=.*/, 'token=<t>')), tokenLength: link ? (new URL(link).searchParams.get('token') || '').length : 0 }
check('the mail has no html part (the server hands the transport a subject and a text)', !('html' in mail) && JSON.stringify(Object.keys(mail).sort()) === JSON.stringify(['subject', 'text', 'to']), Object.keys(mail))
check('one link, on the server\'s own origin, to /invitations/accept with a 43-character token', urls.length === 1 && link.startsWith(web + '/invitations/accept?token=') && report.mail.tokenLength === 43, report.mail)
if (!link.startsWith(web + '/')) { console.error('not run: the link of the mail is not on the replica (start it with REPLICA_WEB_ORIGIN=<its address>): ' + report.mail.urls); process.exit(3) }
check('the text is plain English, ASCII only, and says who invited, which team, the role, the lifetime and what to do if unexpected', /invited you to join/.test(mail.text) && /Journey|Mail Journey Team/.test(mail.text) && /as member/.test(mail.text) && /expires in 7 days/.test(mail.text) && /ignore it/.test(mail.text) && ![...mail.text].some((c) => c.charCodeAt(0) > 127), mail.text)
check('the mail never says what the product is, where to download it, nor how to use the team once joined', !/desktop|download|install|DSH|app\b/i.test(mail.text), mail.text)
const frTo = await make('frenchhdr')
const frInv = await S.call('POST', `/v1/workspaces/${ws}/invitations`, { cookie: A.cookie, json: { email: frTo.email, role: 'admin' }, headers: { 'accept-language': 'fr-FR,fr;q=0.9' } })
const frMail = await S.mail(frTo.email)
check('a French request header changes nothing: the mail is the same English text', frInv.status === 201 && /invited you to join the workspace/.test(frMail.text), frMail.subject)
note('the role reads « as ' + (frMail.text.match(/as (\w+)\./) || [])[1] + ' » in the mail but « as an admin » / « as a member » on the page (see the pictures)')

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
const probe = `(() => { const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 }; return JSON.stringify({ path: location.pathname, query: location.search, hash: location.hash, title: document.title, lang: document.documentElement.lang, text: document.body.innerText.replace(/\\s+/g, ' ').trim(), scrollW: document.documentElement.scrollWidth, innerW: innerWidth, buttons: [...document.querySelectorAll('button,a,input')].filter(vis).map((e) => ({ tag: e.tagName, text: (e.innerText || e.value || '').trim().slice(0, 60), label: e.getAttribute('aria-label'), w: Math.round(e.getBoundingClientRect().width), h: Math.round(e.getBoundingClientRect().height) })) }) })()`
const setCookies = async (b, cookie) => { for (const c of cookie.split('; ')) { const i = c.indexOf('='); await b.page.send('Network.setCookie', { name: c.slice(0, i), value: c.slice(i + 1), url: web + '/' }) } }
const visit = async (name, { width, height, phone, who, url, press }) => {
  const b = await openSite({ width, height })
  try {
    if (phone) { await b.page.send('Emulation.setUserAgentOverride', { userAgent: IPHONE }); await b.page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: true }) }
    if (who) await setCookies(b, who.cookie)
    await b.goto(url, { quiet: 2500 }); await sleep(1200)
    if (press) { await b.click(`[...document.querySelectorAll('button')].find((x) => ${press}.test(x.innerText))`, 2500); await sleep(1500) }
    const r = JSON.parse(await b.evalJs(probe))
    await b.shot(join(out, name + '.png'))
    report.pages[name] = r
    return r
  } finally { await b.close() }
}
const PROMISE = /declin|reject|refus|we(?:'|’)ll (?:let|tell|notify)|will be (?:notified|told|informed)|has been notified|let (?:them|him|her) know|inform/i
const pages = {}
console.log('\nJ09-03 the link in four browsers')
pages.desktopOut = await visit('desktop-signed-out', { width: 1440, height: 900, url: link })
pages.phoneOut = await visit('phone-signed-out', { width: 390, height: 844, phone: true, url: link })
pages.asInvitee = await visit('desktop-as-invitee', { width: 1440, height: 900, who: D, url: link })
pages.asOther = await visit('desktop-as-other-account', { width: 1440, height: 900, who: X, url: link })
check('signed out, desktop: names the inviter, the team and the role, asks to sign in or create an account with the invited address, offers Apple, Google, password, e-mail code', /invited you to join “Mail Journey Team” as a member/.test(pages.desktopOut.text) && /with e2e-invitee-[0-9a-f]+@replica\.test/.test(pages.desktopOut.text) && /Continue with Apple/.test(pages.desktopOut.text) && /Continue with Google/.test(pages.desktopOut.text) && /sign-in code/.test(pages.desktopOut.text), pages.desktopOut.text.slice(0, 400))
check('the address bar no longer holds the token once the page has read it', pages.desktopOut.query === '' && pages.phoneOut.query === '' && pages.asInvitee.query === '', [pages.desktopOut.query, pages.phoneOut.query])
check('on the phone the same page opens, nothing scrolls sideways, every button is at least 40 px high', pages.phoneOut.scrollW <= pages.phoneOut.innerW && pages.phoneOut.buttons.filter((b) => b.tag === 'BUTTON' || b.tag === 'INPUT').every((b) => b.h >= 40), { scrollW: pages.phoneOut.scrollW, innerW: pages.phoneOut.innerW, small: pages.phoneOut.buttons.filter((b) => b.h < 40) })
note('desktop says « ' + (pages.desktopOut.text.match(/Opening the link joins nothing[^.]*\./) || ['(no assurance sentence)'])[0] + ' », phone says ' + JSON.stringify((pages.phoneOut.text.match(/Opening the link joins nothing[^.]*\./) || ['(no assurance sentence)'])[0]))
check('signed in as the invited address: a button to accept and a way out (« This is not my account »)', /You are signed in as e2e-invitee-[0-9a-f]+@replica\.test, the address this invitation was sent to/.test(pages.asInvitee.text) && pages.asInvitee.buttons.some((b) => /Accept the invitation/.test(b.text)) && pages.asInvitee.buttons.some((b) => /This is not my account/.test(b.text)), pages.asInvitee.buttons)
check('signed in as another account: says the address it was sent to and the one signed in, offers no accept button', /was sent to e2e-invitee-[0-9a-f]+@replica\.test, and you are signed in as e2e-other-[0-9a-f]+@replica\.test/.test(pages.asOther.text) && !pages.asOther.buttons.some((b) => /Accept/.test(b.text)), pages.asOther.text.slice(0, 300))
check('opening the link joined nothing: D is not a member yet', !((await S.call('GET', `/v1/workspaces/${ws}/members`, { cookie: A.cookie })).body.members || []).some((m) => m.user_id === D.id))

// ── J09-12: nobody is told ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
console.log('\nJ09-12 the answers that do not exist')
const probes = {}
for (const [m, p, body] of [['POST', '/v1/invitations/decline', { token: 'x' }], ['POST', '/v1/invitations/reject', { token: 'x' }], ['POST', '/v1/invitations/refuse', { token: 'x' }], ['GET', '/v1/invitations', undefined], ['GET', '/v1/me/invitations', undefined], ['DELETE', '/v1/invitations/' + inv.body.id, undefined]]) {
  const r = await S.call(m, p, { cookie: D.cookie, json: body }); probes[m + ' ' + p.replace(inv.body.id, '<id>')] = r.status
}
report.probes = probes
check('no route lets an invitee decline: every try answers 404 or 405', Object.values(probes).every((s) => s === 404 || s === 405), probes)
const mailboxes0 = { A: await lastMail(A), D: await lastMail(D), M: await lastMail(M) }
// D accepts on the page (a real press), then the inviter's mailbox and D's are read again
const accepted = await visit('desktop-invitee-accepted', { width: 1440, height: 900, who: D, url: link, press: '/Accept the invitation/' })
check('D accepts with the button and reads « You are now a member of “Mail Journey Team”. »', /You are now a member of “Mail Journey Team”\./.test(accepted.text), accepted.text)
note('after accepting, the page offers: ' + accepted.buttons.filter((b) => b.tag === 'A').map((b) => b.text).join(' | ') + ' (nothing about the desktop)')
check('no e-mail reaches the inviter when the invitation is accepted, nor the invitee', (await lastMail(A)) === mailboxes0.A && (await lastMail(D)) === mailboxes0.D, { A: before.A === (await lastMail(A)) })
const reuse = await visit('desktop-link-used', { width: 1440, height: 900, who: D, url: link })
check('the same link a second time: one sentence for used, expired and withdrawn', /This invitation cannot be used\. It may have expired, been used or withdrawn\./.test(reuse.text), reuse.text)
// withdrawn: E is invited then A withdraws it; nothing is sent to E
const invE = await invite(E)
const eMail = await lastMail(E)
const list = await S.call('GET', `/v1/workspaces/${ws}/invitations`, { cookie: A.cookie })
const mine = (list.body.invitations || []).find((i) => i.email === E.email)
const withdrawn = await S.call('DELETE', `/v1/workspaces/${ws}/invitations/${mine.id}`, { cookie: A.cookie })
check('A withdraws E\'s invitation (204) and E gets no e-mail about it', invE.status === 201 && withdrawn.status === 204 && (await lastMail(E)) === eMail, withdrawn.status)
// removed, and leaving
const invM = await invite(M); const mTok = new URL(((await S.mail(M.email)).text.match(/https?:\/\/\S+/) || [''])[0]).searchParams.get('token')
await S.call('POST', '/v1/invitations/accept', { cookie: M.cookie, json: { token: mTok } })
const mailboxes1 = { A: await lastMail(A), D: await lastMail(D), M: await lastMail(M) }
const rem = await S.call('DELETE', `/v1/workspaces/${ws}/members/${D.id}`, { cookie: A.cookie })
const left = await S.call('DELETE', `/v1/workspaces/${ws}/members/${M.id}`, { cookie: M.cookie })
check('A removes D (204) and M leaves by himself (204)', rem.status === 204 && left.status === 204, [rem.status, left.status])
check('no e-mail goes to the removed member, to the member who left, nor to the owner', (await lastMail(D)) === mailboxes1.D && (await lastMail(M)) === mailboxes1.M && (await lastMail(A)) === mailboxes1.A)
// the screens: no sentence of the journey's pages promises an answer
const seen = Object.entries(report.pages).filter(([, p]) => PROMISE.test(p.text)).map(([k, p]) => [k, (p.text.match(PROMISE) || [])[0]])
check('no page of the journey (9 states) promises a decline, a refusal notice, a notification or an acknowledgement', seen.length === 0, seen)
// the member's list as the owner reads it: what it says about removing
const m = await openSite({ width: 1440, height: 900 })
try {
  await setCookies(m, A.cookie)
  await m.goto(web + '/account#members&ws=' + ws, { quiet: 2500 }); await sleep(2000)
  const txt = String(await m.evalJs(`document.body.innerText.replace(/\\s+/g, ' ')`))
  report.pages['owner-members'] = { text: txt.slice(0, 1500) }
  await m.shot(join(out, 'owner-members-page.png'))
  note('the owner\'s members page says: ' + JSON.stringify(txt.slice(txt.indexOf('Members'), txt.indexOf('Members') + 360)))
  const pressed = await m.click(`[...document.querySelectorAll('button')].find((x) => /Remove|Revoke/.test(x.innerText) || /remove|revoke/i.test(x.getAttribute('aria-label') || ''))`, 1500)
  const dlg = String(await m.evalJs(`(document.querySelector('[role=dialog], .modal, #modal') || { innerText: '' }).innerText.replace(/\\s+/g, ' ')`))
  report.pages['owner-members-after-press'] = { text: dlg }
  note('pressing the first remove or revoke control opens: ' + JSON.stringify(dlg.slice(0, 200)) + ' (pressed ' + pressed + ')')
  check('the owner\'s pages of members and invitations promise no notice to the person removed or invited', !PROMISE.test(txt + ' ' + dlg), (txt + ' ' + dlg).match(PROMISE))
} finally { await m.close() }
writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2))
const red = results.filter((r) => !r.ok).length
console.log(`\n${results.length - red}/${results.length} checks passed; report in ${out}/report.json`)
process.exit(red === 0 ? 0 : 1)

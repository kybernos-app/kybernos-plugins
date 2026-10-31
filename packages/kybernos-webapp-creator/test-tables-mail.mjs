// test-tables-mail.mjs — invitations by e-mail in the tables template: the Resend adapter (lib/mailer.mjs) against a fake HTTP server standing in for the provider, the
// environment settings, and what the owner is told when the provider fails (lib/people.mjs). Needs node:http and node:sqlite only; nothing leaves this computer.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { DatabaseSync } from 'node:sqlite'
import { MAIL_FAILED, invitationMail, linkOnlyMailer, mailConfig, mailerFromEnv, makeResendMailer } from './templates/tables/lib/mailer.mjs'
import { makePeople } from './templates/tables/lib/people.mjs'
import { makeStore } from './templates/tables/lib/store.mjs'

let count = 0
const ok = async (label, fn) => { await fn(); count++; console.log('ok  ', label) }
const KEY = 're_test_' + 'k'.repeat(24)
const FROM = 'Team space <team@example.com>'
const LINK = 'https://team.example.com/invite?t=' + 'a'.repeat(30) + '.' + 'b'.repeat(30)
const message = (extra = {}) => ({ to: 'ann@example.test', link: LINK, role: 'member', roleLabel: 'Team member', expires: '2026-11-07T09:00:00.000Z', expiresInDays: 7, inviter: 'Olga', space: 'Ledger Coffee', ...extra })

/** A fake provider: records what it receives and answers with `answer(request)` (or never, when it returns null). */
async function provider (answer) {
  const seen = []
  const sockets = new Set()
  const server = createServer((req, res) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      const entry = { method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString('utf8') }
      seen.push(entry)
      const r = answer(entry, seen.length)
      if (r === null) return // never answers: the caller's timeout is what ends the call
      res.writeHead(r.status, { 'content-type': 'application/json', ...(r.headers ?? {}) })
      res.end(r.body ?? '{}')
    })
  })
  server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)) })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { seen, base: 'http://127.0.0.1:' + server.address().port, close: () => { for (const s of sockets) s.destroy(); return new Promise((resolve) => server.close(resolve)) } }
}

await ok('the adapter makes one authenticated POST to /emails with a plain, text-and-html invitation', async () => {
  const p = await provider(() => ({ status: 200, body: '{"id":"abc"}' }))
  const logs = []
  const mailer = makeResendMailer({ apiKey: KEY, from: FROM, replyTo: 'owner@example.com', base: p.base, log: (m) => logs.push(m) })
  const r = await mailer.send(message())
  await p.close()
  assert.deepEqual(r, { sent: true })
  assert.equal(p.seen.length, 1, 'one request, no retry')
  const q = p.seen[0]
  assert.equal(q.method, 'POST')
  assert.equal(q.url, '/emails')
  assert.equal(q.headers.authorization, 'Bearer ' + KEY)
  assert.equal(q.headers['content-type'], 'application/json')
  assert.equal(q.headers.cookie, undefined)
  const body = JSON.parse(q.body)
  assert.deepEqual(Object.keys(body).sort(), ['from', 'html', 'reply_to', 'subject', 'text', 'to'])
  assert.equal(body.from, FROM)
  assert.deepEqual(body.to, ['ann@example.test'])
  assert.equal(body.reply_to, 'owner@example.com')
  assert.equal(body.subject, 'You are invited to Ledger Coffee')
  for (const part of [body.text, body.html]) {
    assert.ok(part.includes('Olga invited you to join Ledger Coffee.'), 'who invited and which space')
    assert.ok(part.includes(LINK), 'the link')
    assert.ok(part.includes('expires in 7 days'), 'that it expires')
    assert.ok(part.includes('Team member'))
  }
  assert.equal(/<img|<script|<style|<link|<iframe|style=|url\(|src=/i.test(body.html), false, 'no image, no tracking pixel, no remote resource')
  assert.deepEqual([...body.html.matchAll(/https?:\/\/[^\s"<]+/g)].map((m) => m[0]).filter((u, i, all) => all.indexOf(u) === i), [LINK], 'the only address in the message is the invitation link')
  assert.equal(logs.length, 0, 'a success writes nothing to the log')
})

await ok('a reply-to is optional; the name of the space and of the inviter are cleaned and escaped, and an anonymous invitation still reads well', () => {
  const m = invitationMail(message({ inviter: '<b>Mallory</b>\r\nBcc: x@example.com', space: 'Evil <script>alert(1)</script>\nSubject: hi' }))
  assert.equal(/[\r\n]/.test(m.subject), false, 'no line break in the subject')
  assert.equal(m.subject.includes('<'), false)
  assert.equal(m.html.includes('<script'), false)
  assert.equal(m.html.includes('<b>'), false)
  assert.equal(/<\/?b>/.test(m.html) || /<\/?b>/.test(m.text), false, 'markup in a name is not carried over')
  assert.equal(m.text.split('\n').some((l) => /^Bcc:/i.test(l)), false, 'a line break in a name cannot start a header or a line of its own')
  const plain = invitationMail(message({ inviter: '', space: '' }))
  assert.ok(plain.text.startsWith('You have been invited to join a team space.'))
  assert.equal(plain.subject, 'You are invited to a team space')
  assert.ok(invitationMail(message({ expiresInDays: 1 })).text.includes('expires in 1 day'))
})

await ok('a provider that refuses is reported as a failure; its words, and the key, go nowhere', async () => {
  const secretBody = JSON.stringify({ message: 'the domain nope.example is not verified; key ' + KEY + ' PROVIDER-WORDS-7731' })
  const p = await provider(() => ({ status: 422, body: secretBody }))
  const logs = []
  const mailer = makeResendMailer({ apiKey: KEY, from: FROM, base: p.base, log: (m) => logs.push(m) })
  const r = await mailer.send(message())
  await p.close()
  assert.deepEqual(r, { sent: false, reason: 'rejected' })
  const everything = JSON.stringify(r) + logs.join('\n')
  assert.equal(everything.includes(KEY), false, 'the key is not in what came back or in the log')
  assert.equal(everything.includes('PROVIDER-WORDS'), false, 'nor is the provider’s body')
  assert.deepEqual(logs, ['mail: the provider answered 422'])
  assert.equal(p.seen.length, 1, 'no retry')
})

await ok('a provider that is slow is cut off at the timeout; one that is down, or that redirects, is a failure too', async () => {
  const slow = await provider(() => null)
  const t0 = Date.now()
  const logs = []
  const r = await makeResendMailer({ apiKey: KEY, from: FROM, base: slow.base, timeoutMs: 200, log: (m) => logs.push(m) }).send(message())
  const took = Date.now() - t0
  await slow.close()
  assert.deepEqual(r, { sent: false, reason: 'timeout' })
  assert.ok(took >= 190 && took < 3000, 'cut off at about the timeout: ' + took + ' ms')
  assert.equal(slow.seen.length, 1, 'no retry after a timeout')

  const down = await provider(() => ({ status: 200 }))
  const base = down.base
  await down.close()
  assert.deepEqual(await makeResendMailer({ apiKey: KEY, from: FROM, base, log: (m) => logs.push(m) }).send(message()), { sent: false, reason: 'network' })

  const target = await provider(() => ({ status: 200 }))
  const hop = await provider(() => ({ status: 307, headers: { location: target.base + '/emails' } }))
  assert.deepEqual(await makeResendMailer({ apiKey: KEY, from: FROM, base: hop.base, log: (m) => logs.push(m) }).send(message()), { sent: false, reason: 'network' })
  assert.equal(target.seen.length, 0, 'a redirect is not followed: the key goes to one address only')
  await hop.close()
  await target.close()
  assert.equal(logs.join('\n').includes(KEY), false)
  assert.deepEqual(logs.filter((l) => l.includes('timeout')).length, 1)
})

await ok('an address that is not one is never sent; the default timeout is ten seconds', async () => {
  let called = 0
  const mailer = makeResendMailer({ apiKey: KEY, from: FROM, fetch: async () => { called++; return new Response('{}') } })
  for (const to of ['', 'x', 'a@b', 'a b@example.com', 'a@example.com\r\nBcc: z@example.com', null, undefined, 5]) assert.equal((await mailer.send(message({ to }))).sent, false, String(to))
  assert.equal(called, 0)
  let signal = null
  await makeResendMailer({ apiKey: KEY, from: FROM, fetch: async (url, init) => { signal = init.signal; return new Response('{}') } }).send(message())
  assert.ok(signal instanceof AbortSignal)
  const { MAIL_TIMEOUT_MS } = await import('./templates/tables/lib/mailer.mjs')
  assert.equal(MAIL_TIMEOUT_MS, 10_000)
})

await ok('the environment: no key keeps the default; a key needs a from; a refused setting is named, never echoed, and falls back to the default', () => {
  assert.deepEqual(mailConfig({}), { config: null })
  assert.deepEqual(mailConfig({ KB_MAIL_API_KEY: '' }), { config: null })
  const good = mailConfig({ KB_MAIL_API_KEY: KEY, KB_MAIL_FROM: FROM, KB_MAIL_REPLY_TO: 'owner@example.com' })
  assert.deepEqual(good, { config: { apiKey: KEY, from: FROM, replyTo: 'owner@example.com', base: 'https://api.resend.com' } })
  assert.equal(mailConfig({ KB_MAIL_API_KEY: KEY, KB_MAIL_FROM: 'team@example.com' }).config.from, 'team@example.com')
  assert.equal(mailConfig({ KB_MAIL_API_KEY: KEY, KB_MAIL_FROM: 'team@example.com', KB_MAIL_API_BASE: 'http://127.0.0.1:4567/' }).config.base, 'http://127.0.0.1:4567')
  const bad = [
    { KB_MAIL_API_KEY: KEY },
    { KB_MAIL_API_KEY: KEY, KB_MAIL_FROM: 'not an address' },
    { KB_MAIL_API_KEY: KEY, KB_MAIL_FROM: 'a@example.com\r\nBcc: z@example.com' },
    { KB_MAIL_API_KEY: KEY, KB_MAIL_FROM: 'a@example.com', KB_MAIL_REPLY_TO: 'nope' },
    { KB_MAIL_API_KEY: KEY, KB_MAIL_FROM: 'a@example.com', KB_MAIL_API_BASE: 'http://api.example.com' },
    { KB_MAIL_API_KEY: KEY, KB_MAIL_FROM: 'a@example.com', KB_MAIL_API_BASE: 'https://user:pw@api.example.com' },
    { KB_MAIL_API_KEY: KEY, KB_MAIL_FROM: 'a@example.com', KB_MAIL_API_BASE: 'ftp://x' },
    { KB_MAIL_API_KEY: KEY, KB_MAIL_FROM: 'a@example.com', KB_MAIL_API_BASE: 'nonsense' },
    { KB_MAIL_API_KEY: 'short', KB_MAIL_FROM: 'a@example.com' },
    { KB_MAIL_API_KEY: KEY + ' with space', KB_MAIL_FROM: 'a@example.com' },
  ]
  for (const env of bad) {
    const r = mailConfig(env)
    assert.equal(r.config, null, JSON.stringify(env).replace(KEY, '<key>'))
    assert.match(r.problem, /^KB_MAIL_[A-Z_]+ /)
    assert.equal(r.problem.includes(KEY) || r.problem.includes('Bcc'), false, 'a setting is named, its value is not repeated')
  }
  const logs = []
  assert.equal(mailerFromEnv({}, { log: (m) => logs.push(m) }), linkOnlyMailer)
  assert.equal(mailerFromEnv({ KB_MAIL_API_KEY: KEY }, { log: (m) => logs.push(m) }), linkOnlyMailer, 'a refused setting leaves the default')
  assert.equal(logs.length, 1)
  assert.equal(logs[0].includes(KEY), false)
  assert.equal(mailerFromEnv({ KB_MAIL_API_KEY: KEY, KB_MAIL_FROM: FROM }).configured, true)
  assert.equal(linkOnlyMailer.configured, false)
  assert.deepEqual(Object.keys(linkOnlyMailer).sort(), ['configured', 'send'])
})

// ── what the owner is told ──

const secret = 's'.repeat(40)
const roles = [{ id: 'member', label: 'Team member', apps: ['shop'] }, { id: 'viewer', label: 'Viewer', apps: ['shop'] }]
const people = (mailer, extra = {}) => { const store = makeStore(new DatabaseSync(':memory:')); return { store, people: makePeople({ store, secret, publicUrl: 'https://team.example.com', mailer, roles: () => roles, inviter: async () => 'Olga', space: () => 'Ledger Coffee', ...extra }) } }

await ok('people: through the provider an invitation is sent and the link is not shown; the mail names who invites, the space and the profile', async () => {
  const p = await provider(() => ({ status: 200 }))
  const { people: team } = people(makeResendMailer({ apiKey: KEY, from: FROM, base: p.base }))
  const r = await team.invite({ email: 'Ann@Example.test', role: 'member', by: 'u0' })
  await p.close()
  assert.equal(r.sent, true)
  assert.equal(r.link, undefined)
  assert.equal(r.mailFailed, undefined)
  const body = JSON.parse(p.seen[0].body)
  assert.deepEqual(body.to, ['ann@example.test'])
  assert.ok(body.text.includes('Olga invited you to join Ledger Coffee.') && body.text.includes('You will join as Team member.'))
  assert.ok(body.text.includes('https://team.example.com/invite?t='))
})

await ok('people: when the provider fails the owner is told so in fixed words and gets the link; a link-only space says nothing of failure', async () => {
  const p = await provider(() => ({ status: 500, body: 'PROVIDER-WORDS-9 ' + KEY }))
  const { people: team, store } = people(makeResendMailer({ apiKey: KEY, from: FROM, base: p.base }))
  const r = await team.invite({ email: 'ann@example.test', role: 'member', by: 'u0' })
  await p.close()
  assert.equal(r.ok, true)
  assert.equal(r.sent, false)
  assert.equal(r.mailFailed, true)
  assert.equal(r.message, MAIL_FAILED)
  assert.ok(r.link.includes('/invite?t='), 'the link is handed over')
  assert.equal(JSON.stringify(r).includes('PROVIDER-WORDS') || JSON.stringify(r).includes(KEY), false)
  assert.equal(store.invitation(r.invitation.id).sent_at, null, 'not marked as sent')

  const quiet = people(linkOnlyMailer)
  const q = await quiet.people.invite({ email: 'ann@example.test', role: 'member', by: 'u0' })
  assert.equal(q.sent, false)
  assert.equal(q.mailFailed, undefined, 'no mail is set up: that is not a failure')
  assert.ok(q.link)
  assert.equal((await quiet.people.invite({ role: 'viewer', by: 'u0' })).mailFailed, undefined, 'a link-only invitation never sends')
})

await ok('people: a resend goes through the same path (a new link, the same mail), and a mailer that throws is a failure with the link', async () => {
  const p = await provider((q, n) => (n === 1 ? { status: 200 } : { status: 503 }))
  const { people: team } = people(makeResendMailer({ apiKey: KEY, from: FROM, base: p.base }))
  const first = await team.invite({ email: 'ann@example.test', role: 'member', by: 'u0' })
  assert.equal(first.sent, true)
  const again = await team.resend(first.invitation.id, 'u0')
  await p.close()
  assert.equal(p.seen.length, 2)
  assert.equal(again.sent, false)
  assert.equal(again.mailFailed, true)
  const linkOf = (n) => /https:\/\/team\.example\.com\/invite\?t=[^\s"<]+/.exec(JSON.parse(p.seen[n].body).text)[0]
  assert.notEqual(linkOf(0), linkOf(1), 'the second mail carries the new link')
  assert.equal(linkOf(1), again.link, 'the link handed to the owner is the one in the mail that failed')

  const boom = people({ send: async () => { throw new Error('kaboom ' + KEY) } })
  const r = await boom.people.invite({ email: 'bob@example.test', role: 'viewer', by: 'u0' })
  assert.equal(r.mailFailed, true)
  assert.equal(JSON.stringify(r).includes('kaboom') || JSON.stringify(r).includes(KEY), false, 'a thrown error is not echoed')
  const noInviter = people(linkOnlyMailer, { inviter: async () => { throw new Error('no such user') } })
  assert.equal((await noInviter.people.invite({ email: 'c@example.test', role: 'member', by: 'u0' })).ok, true, 'a missing inviter name never stops an invitation')
})

console.log('\ntables template, e-mail: ' + count + ' checks passed')

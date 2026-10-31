// mailer.mjs — the port that sends an invitation, and the one adapter that really sends: Resend's HTTP API.
//
// The app is given a mailer `{ configured?, send({ to, link, role, roleLabel, expires, expiresInDays, inviter, space }) → Promise<{ sent: boolean }> }`. It may throw, and the app then
// answers as if nothing was sent. `configured: false` says « no mail is set up » (the default, which sends nothing: the owner copies the link themselves); any other mailer is
// treated as one that was meant to send, so a failure is reported to the owner as such.
//
// The adapter is configured by the environment only (`mailConfig`): KB_MAIL_API_KEY, KB_MAIL_FROM, optionally KB_MAIL_REPLY_TO and, for tests, KB_MAIL_API_BASE. No key means the
// default stays. What it promises: one request, a 10 s timeout, no retry, no redirect followed, the key sent in one header and never written to a log, an answer or an error, and the
// provider's body never read into anything the owner or a log can see (only its status is kept).
export const linkOnlyMailer = Object.freeze({ configured: false, send: async () => ({ sent: false }) })

const DEFAULT_MAIL_BASE = 'https://api.resend.com'
export const MAIL_TIMEOUT_MS = 10_000
/** What the owner is told when a mailer that was meant to send did not. Fixed text: nothing of the provider's answer goes into it. */
export const MAIL_FAILED = 'The e-mail could not be sent. Here is the link to give them yourself.'

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]'])
const ADDRESS = /^[^\s@<>"',;]{1,64}@[^\s@<>"',;.]+(\.[^\s@<>"',;.]+)+$/
const FROM = /^(?:[^\r\n<>"]{1,80} )?<([^\s@<>"',;]{1,64}@[^\s@<>"',;.]+(?:\.[^\s@<>"',;.]+)+)>$/
const oneLine = (s, max) => String(s ?? '').replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)

/**
 * `{ config, problem? }` from the environment. `config` is `{ apiKey, from, replyTo?, base }`, or null when mail is not set up. A key with a setting that is not good gives
 * `config: null` and a `problem` that names the variable, never its value: the app then starts with the default mailer.
 */
export function mailConfig (env = {}) {
  const key = env.KB_MAIL_API_KEY
  if (key === undefined || key === '') return { config: null }
  const bad = (name, why) => ({ config: null, problem: name + ' ' + why + ': invitations are not sent by e-mail, the owner gets the link' })
  if (typeof key !== 'string' || key.length < 8 || key.length > 256 || /[\s\u0000-\u001f\u007f]/.test(key)) return bad('KB_MAIL_API_KEY', 'is not a usable key')
  const from = typeof env.KB_MAIL_FROM === 'string' ? env.KB_MAIL_FROM.trim() : ''
  if (from === '' || from.length > 200 || !(ADDRESS.test(from) || FROM.test(from))) return bad('KB_MAIL_FROM', 'is missing or is not an address (name@example.com or Name <name@example.com>)')
  const replyTo = typeof env.KB_MAIL_REPLY_TO === 'string' ? env.KB_MAIL_REPLY_TO.trim() : ''
  if (replyTo !== '' && !(replyTo.length <= 200 && (ADDRESS.test(replyTo) || FROM.test(replyTo)))) return bad('KB_MAIL_REPLY_TO', 'is not an address')
  let base = DEFAULT_MAIL_BASE
  if (typeof env.KB_MAIL_API_BASE === 'string' && env.KB_MAIL_API_BASE !== '') {
    let u
    try { u = new URL(env.KB_MAIL_API_BASE) } catch (e) { return bad('KB_MAIL_API_BASE', 'is not an address') }
    // the key travels in a header: never over plain http, except to this very computer (a test)
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && LOOPBACK.has(u.hostname))) return bad('KB_MAIL_API_BASE', 'must be https (http only for this computer)')
    if (u.username !== '' || u.password !== '' || u.search !== '' || u.hash !== '') return bad('KB_MAIL_API_BASE', 'must be a plain address')
    base = u.origin + u.pathname.replace(/\/+$/, '')
  }
  return { config: { apiKey: key, from, ...(replyTo === '' ? {} : { replyTo }), base } }
}

/** Reads at most 64 KiB of an answer and drops it, so the connection is free again and a huge body cannot hold the call. */
async function drain (res) {
  if (res.body === null || res.body === undefined) return
  const reader = res.body.getReader()
  let seen = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) return
      seen += value.length
      if (seen > 65536) { await reader.cancel().catch(() => {}); return }
    }
  } catch (e) { /* an answer that breaks off is still an answer: its status was already read */ }
}

const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const when = (iso) => String(iso).slice(0, 16).replace('T', ' ') + ' UTC'

/**
 * The invitation as `{ subject, text, html }`: who invited, the space, the link, that it expires. Plain: no image, no tracking pixel, no style, no remote resource; every
 * name that came from a person or an app is cleaned of control characters and escaped where it is markup.
 */
export function invitationMail ({ link, roleLabel, expires, expiresInDays = 7, inviter, space }) {
  const spaceName = oneLine(space, 60)
  const into = spaceName === '' ? 'a team space' : spaceName
  const who = oneLine(inviter, 80)
  const lead = who === '' ? 'You have been invited to join ' + into + '.' : who + ' invited you to join ' + into + '.'
  const role = oneLine(roleLabel, 60)
  const days = expiresInDays === 1 ? '1 day' : expiresInDays + ' days'
  const until = typeof expires === 'string' && expires !== '' ? ' (until ' + when(expires) + ')' : ''
  const text = [
    lead,
    '',
    'Open this link to choose a password and join:',
    link,
    '',
    'The link works once and expires in ' + days + until + '.' + (role === '' ? '' : ' You will join as ' + role + '.'),
    '',
    'If you were not expecting this, ignore this message: nothing happens until the link is used.',
  ].join('\n')
  const html = '<!doctype html><html lang="en"><body>' +
    '<p>' + esc(lead) + '</p>' +
    '<p><a href="' + esc(link) + '">Open the invitation</a></p>' +
    '<p>If the button does not work, copy this address into your browser:<br>' + esc(link) + '</p>' +
    '<p>The link works once and expires in ' + esc(days + until) + '.' + (role === '' ? '' : ' You will join as ' + esc(role) + '.') + '</p>' +
    '<p>If you were not expecting this, ignore this message: nothing happens until the link is used.</p>' +
    '</body></html>'
  return { subject: 'You are invited to ' + into, text, html }
}

/**
 * The adapter for Resend (`POST <base>/emails`, `Authorization: Bearer <key>`). `config` is the result of `mailConfig`; `fetch` and `timeoutMs` are injected for tests;
 * `log(message)` receives short lines with a status or a reason and nothing else.
 */
export function makeResendMailer ({ apiKey, from, replyTo, base = DEFAULT_MAIL_BASE, fetch: fetchFn = (...a) => globalThis.fetch(...a), timeoutMs = MAIL_TIMEOUT_MS, log = () => {} }) {
  return Object.freeze({
    configured: true,
    /** `{ sent: true }`, or `{ sent: false, reason: 'rejected' | 'timeout' | 'network' }`. Never throws, never carries the provider's words. */
    async send (message) {
      if (typeof message?.to !== 'string' || !ADDRESS.test(message.to)) return { sent: false, reason: 'invalid' }
      const mail = invitationMail(message)
      const payload = { from, to: [message.to], subject: mail.subject, text: mail.text, html: mail.html, ...(replyTo === undefined ? {} : { reply_to: replyTo }) }
      const stop = new AbortController()
      const timer = setTimeout(() => stop.abort(), timeoutMs)
      try {
        const res = await fetchFn(base + '/emails', {
          method: 'POST',
          headers: { authorization: 'Bearer ' + apiKey, 'content-type': 'application/json', accept: 'application/json', 'user-agent': 'kybernos-team-space/1' },
          body: JSON.stringify(payload),
          signal: stop.signal,
          redirect: 'error',
        })
        await drain(res) // read the answer out under the same timeout, and keep none of it
        if (res.ok) return { sent: true }
        log('mail: the provider answered ' + res.status)
        return { sent: false, reason: 'rejected' }
      } catch (e) {
        const reason = stop.signal.aborted ? 'timeout' : 'network'
        log('mail: ' + reason)
        return { sent: false, reason }
      } finally {
        clearTimeout(timer)
      }
    },
  })
}

/** The mailer the environment asks for: Resend when it is set up, else the default that sends nothing. `log` hears about a setting that was refused (by name). */
export function mailerFromEnv (env, { fetch: fetchFn, log = () => {} } = {}) {
  const { config, problem } = mailConfig(env)
  if (problem !== undefined) log('mail: ' + problem)
  return config === null ? linkOnlyMailer : makeResendMailer({ ...config, ...(fetchFn === undefined ? {} : { fetch: fetchFn }), log })
}

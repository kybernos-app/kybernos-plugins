#!/usr/bin/env node
// The « Send feedback » form really sends when it can, and says plainly what it does when it cannot (account campaign 2026-10-18, AC-05).
//
//   node packages/kybernos-plugin/test-feedback-form.mjs
//
// « Save » stored the text on the computer, « Export » copied it with « Paste it into a message to the Kybernos team » (nowhere said), and nothing ever
// reached the server's relay, which exists. Now a signed-in person gets « Send » (host route /kybernos/feedback/send, tested in test-feedback-box.mjs); a
// signed-out one is told that nothing can be sent from here, what Save and Export do, and where to go. The verdict builder is cut out of client.js
// and run on its own; the form is checked in the source.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) }
}

const here = dirname(fileURLToPath(import.meta.url))
const SRC = readFileSync(join(here, 'client.js'), 'utf8')
const dict = (key) => {
  const m = new RegExp("'" + key.replace(/\./g, '\\.') + "': \\{ kybernos: '((?:[^'\\\\]|\\\\.)*)', en: '((?:[^'\\\\]|\\\\.)*)' \\}").exec(SRC)
  return m === null ? null : { fr: m[1], en: m[2] }
}

const a = SRC.indexOf('// <kb-feedback-send>')
const b = SRC.indexOf('// </kb-feedback-send>', a)
check('the verdict builder can be cut out of client.js', a > 0 && b > a)
if (a < 0 || b < a) { console.log(`\n${pass} ✓  ${fail} ✗`); process.exit(1) }
const { kbFbSendVerdict, kbFbWaitText } = new Function(SRC.slice(a, b) + '\nreturn { kbFbSendVerdict, kbFbWaitText }')()
const keysOf = (status, out) => kbFbSendVerdict(status, out).keys

console.log('what the person is told')
{
  const sent = kbFbSendVerdict(200, { ok: true, error: null, retryable: false, deduped: false })
  check('the relay took it: a success that says « sent »', sent.tone === 'ok' && sent.keys.join() === 'kbui.fb.sent', sent)
  check('the same report again: it says the team has it already', kbFbSendVerdict(200, { ok: true, deduped: true }).keys.join() === 'kbui.fb.sent.again')
  const signedOut = kbFbSendVerdict(200, { ok: false, error: 'non_connecte', retryable: true })
  check('signed out: an error that says nothing was sent because of the account, never a success', signedOut.tone === 'err' && signedOut.keys[0] === 'kbui.fb.err.signedout', signedOut)
  check('a session the server ended: sign in again', keysOf(200, { ok: false, error: 'reconnexion_requise', retryable: true })[0] === 'kbui.fb.err.reconnect')
  check('no network, whatever the two words for it', keysOf(200, { ok: false, error: 'reseau_indisponible', retryable: true })[0] === 'kbui.fb.err.net' && keysOf(200, { ok: false, error: 'envoi_indisponible', retryable: true })[0] === 'kbui.fb.err.net')
  check('the relay or its database down: try again in a moment', keysOf(200, { ok: false, error: 'github_indisponible', retryable: true })[0] === 'kbui.fb.err.team' && keysOf(200, { ok: false, error: 'base_indisponible', retryable: true })[0] === 'kbui.fb.err.team')
  check('already in flight, and too many an hour, have their own sentence', keysOf(200, { ok: false, error: 'en_cours', retryable: true })[0] === 'kbui.fb.err.busy' && keysOf(200, { ok: false, error: 'trop_de_demandes', retryable: true })[0] === 'kbui.fb.err.rate')
  const held = kbFbSendVerdict(200, { ok: false, error: 'en_cours', retryable: true, retry_after: 95 })
  check('when the relay says how long it holds the report, the person is told how long (and not « in a moment »)', held.wait === 95 && held.keys.includes('kbui.fb.err.wait') && !held.keys.includes('kbui.fb.err.moment'), held)
  check('when it does not say, the person is told to try again in a moment', kbFbSendVerdict(200, { ok: false, error: 'github_indisponible', retryable: true }).keys.includes('kbui.fb.err.moment'))
  check('a silly wait (negative, huge, text) is not shown', [-1, 0, 99999, 'soon', null].every((w) => kbFbSendVerdict(200, { ok: false, error: 'en_cours', retryable: true, retry_after: w }).wait === null))
  check('the wait reads in seconds up to a minute and a half, then in minutes', kbFbWaitText(30) === '30 s' && kbFbWaitText(89) === '89 s' && kbFbWaitText(90) === '2 min' && kbFbWaitText(120) === '2 min' && kbFbWaitText(121) === '3 min' && kbFbWaitText(0.2) === '1 s')
  check('a code nobody worded is « the server refused », not the code', keysOf(200, { ok: false, error: 'refus_418', retryable: false }).join() === 'kbui.fb.err.refused' && keysOf(200, { ok: false, retryable: false }).join() === 'kbui.fb.err.refused')
  check('a failure that will be tried again says the text is kept; one that will not, does not', keysOf(200, { ok: false, error: 'github_indisponible', retryable: true }).includes('kbui.fb.err.kept') && !keysOf(200, { ok: false, error: 'invalid_title', retryable: false }).includes('kbui.fb.err.kept'))
  check('the page\'s own session refused (a guard): the reload sentence, not a claim about the server', keysOf(401, { ok: false }).join() === 'kbui.fb.signin' && keysOf(403, null).join() === 'kbui.fb.signin' && keysOf(503, { ok: false }).join() === 'kbui.fb.signin')
  check('the DSH could not be reached at all: nothing was sent, and it says it', keysOf(0, null).join() === 'kbui.fb.err.local')
  check('an answer that is not an object is a failure, never a success', keysOf(200, null)[0] === 'kbui.fb.err.refused' && kbFbSendVerdict(200, 'ok').tone === 'err' && kbFbSendVerdict(200, { ok: 'true' }).tone === 'err')
}

console.log('the sentences exist, in English and in the product\'s French')
{
  const keys = ['kbui.fb.send', 'kbui.fb.sending', 'kbui.fb.sent', 'kbui.fb.sent.again', 'kbui.fb.err.signedout', 'kbui.fb.err.reconnect', 'kbui.fb.err.net', 'kbui.fb.err.team', 'kbui.fb.err.busy', 'kbui.fb.err.moment', 'kbui.fb.err.wait', 'kbui.fb.err.rate', 'kbui.fb.err.refused', 'kbui.fb.err.local', 'kbui.fb.err.kept', 'kbui.fb.hint.signedin', 'kbui.fb.hint.signedout', 'kbui.fb.saved', 'kbui.fb.copied.one', 'kbui.fb.copied.many', 'kbui.fb.save', 'kbui.fb.export']
  const missing = keys.filter((k) => dict(k) === null)
  check('every sentence the form can show is in the dictionary', missing.length === 0, missing)
  check('the wait sentence has its placeholder in both languages', dict('kbui.fb.err.wait').en.includes('{t}') && dict('kbui.fb.err.wait').fr.includes('{t}'))
  check('none of them is empty, and the English one is not the French one', keys.every((k) => dict(k) !== null && dict(k).en.trim() !== '' && dict(k).fr.trim() !== '' && dict(k).en !== dict(k).fr), keys.filter((k) => dict(k) !== null && dict(k).en === dict(k).fr))
}

console.log('what Save and Export say they do, and where the text goes')
{
  check('Save says it keeps the text on this computer and that nothing was sent', /computer/i.test(dict('kbui.fb.saved').en) && /nothing was sent/i.test(dict('kbui.fb.saved').en), dict('kbui.fb.saved'))
  check('the old « it is sent only when you export it » is gone (an export sends nothing)', !/sent only when/i.test(dict('kbui.fb.saved').en) && !/n.est envoy/.test(dict('kbui.fb.saved').fr))
  check('Export says it sent nothing, and that the person passes the text on', /nothing was sent/i.test(dict('kbui.fb.copied.one').en) && /nothing was sent/i.test(dict('kbui.fb.copied.many').en) && /\{n\}/.test(dict('kbui.fb.copied.many').en))
  const out = dict('kbui.fb.hint.signedout').en
  check('signed out, the form says nothing can be sent from here, what Save and Export do, and where to send it (the contact address the owner gave on 2026-10-18)', /not signed in/i.test(out) && /nothing can be sent/i.test(out) && /Save/.test(out) && /Copy saved feedback/.test(out) && /clipboard/.test(out) && /contact@kybernos\.app/.test(out), out)
  check('signed in, the form says what Send shares and what Save keeps', /Send/.test(dict('kbui.fb.hint.signedin').en) && /Kybernos team/.test(dict('kbui.fb.hint.signedin').en) && /Save/.test(dict('kbui.fb.hint.signedin').en), dict('kbui.fb.hint.signedin'))
  // the only address in the form is the one the owner gave (contact@kybernos.app): none is invented, and the export messages name it too
  const addresses = (text) => [...String(text).matchAll(/[a-z0-9._-]+@[a-z0-9-]+\.[a-z]{2,}/gi)].map((m) => m[0].toLowerCase())
  const all = ['kbui.fb.hint.signedout', 'kbui.fb.hint.signedin', 'kbui.fb.copied.one', 'kbui.fb.copied.many'].flatMap((k) => [dict(k).en, dict(k).fr || dict(k).kybernos])
  check('the only address in the form is contact@kybernos.app', all.flatMap(addresses).every((a) => a === 'contact@kybernos.app') && addresses(dict('kbui.fb.hint.signedout').en).length === 1 && addresses(dict('kbui.fb.copied.one').en).length === 1, all.flatMap(addresses))
}

console.log('the form')
{
  const form = SRC.slice(SRC.indexOf('const KbFeedbackForm = () => {'), SRC.indexOf('ctx.effect(() => styles.insert(`\n.kbfb-overlay'))
  check('the form is found', form.length > 2000)
  check('Send posts to the host route, not to the box', form.includes("fetch('/kybernos/feedback/send', { method: 'POST'"))
  check('Send is offered only to a signed-in person (the account status says so)', /signedIn === true \? h\('button'[^]*?'data-kb': 'feedback-send'/.test(form) && form.includes("fetch('/kybernos-cloud/status'"))
  check('the hint under the text is the signed-in or the signed-out one', form.includes("signedIn === true ? kbt('kbui.fb.hint.signedin') : kbt('kbui.fb.hint.signedout')"))
  check('the verdict decides the note (a success clears the text, a failure keeps it)', /kbFbSendVerdict\(status, out\)/.test(form) && /verdict\.tone === 'ok'/.test(form))
  check('Send is disabled while something is running or the text is empty', /'data-kb': 'feedback-send', disabled: busy !== '' \|\| message\.trim\(\) === ''/.test(form))
}

console.log(`\n${pass} ✓  ${fail} ✗`)
process.exit(fail === 0 ? 0 : 1)

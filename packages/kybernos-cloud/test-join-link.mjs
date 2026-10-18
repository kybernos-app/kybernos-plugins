// Joining a team with an invitation link: the pure rules (plan « Équipes », step 4).
//   node packages/kybernos-cloud/test-join-link.mjs
//
// The block `join-link` is cut out of client.js and run on its own, so what is proven is the shipped code: the parser of what the person pastes (a whole link, the token alone,
// a link inside the e-mail's sentence, junk, a link of another host, a token riding the fragment), the sentence each answer of the host maps to, the server's own page for the
// way out, and the hint on a link of another host. The host half (the token goes to the active server only) is test-join-host.mjs; the rendered dialog and the real clicks are
// scripts/check-join-live.mjs.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

let failed = 0
const check = (name, ok, detail) => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok || detail === undefined ? '' : '  — ' + JSON.stringify(detail)))
  if (!ok) failed += 1
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, 'client.js'), 'utf8')
const from = source.indexOf('// <join-link:begin>')
const to = source.indexOf('// <join-link:end>', from)
check('the block is where the test expects it', from > 0 && to > from)
const lib = new Function(source.slice(from, to) + '\nreturn { INVITE_TOKEN, INVITE_INPUT_MAX, parseInvitation, joinFailure, joinParseKey, joinBrowserUrl, joinOtherHost }')()

// A token as the server makes it: 32 random bytes in base64url (43 characters).
const TOKEN = 'k3Zp9-Qw_7Lm2XvB0cR8sTnYh4JdUeA6oGfIiNaPqMc'
check('the fixture token has the server\'s shape (43 characters of base64url)', TOKEN.length === 43 && lib.INVITE_TOKEN.test(TOKEN))
const ok = (token, host) => ({ ok: true, token, host })
const no = (reason) => ({ ok: false, reason })
const link = (extra) => 'https://dev.kybernos.app/invitations/accept' + extra

console.log('The parser')
check('the link the server e-mails', same(lib.parseInvitation(link('?token=' + TOKEN)), ok(TOKEN, 'dev.kybernos.app')))
check('the token alone', same(lib.parseInvitation(TOKEN), ok(TOKEN, null)))
check('the token alone, with spaces and a line break around it', same(lib.parseInvitation('  \n' + TOKEN + ' \r\n'), ok(TOKEN, null)))
check('the token between quotes or angle brackets', same(lib.parseInvitation('"' + TOKEN + '"'), ok(TOKEN, null)) && same(lib.parseInvitation('<' + TOKEN + '>'), ok(TOKEN, null)))
check('the query as copied from the address bar (token=…)', same(lib.parseInvitation('token=' + TOKEN), ok(TOKEN, null)))
check('the link with a trailing slash, other parameters and a trailing full stop', same(lib.parseInvitation('https://dev.kybernos.app/invitations/accept/?lang=fr&token=' + TOKEN + '.'), ok(TOKEN, 'dev.kybernos.app')))
check('the link inside the e-mail\'s own sentence', same(lib.parseInvitation('Ada invited you to join the workspace "Acme" on Kybernos as member.\n\nAccept the invitation: ' + link('?token=' + TOKEN) + '\n\nThe link expires in 7 days.'), ok(TOKEN, 'dev.kybernos.app')))
check('the first link of a pasted e-mail that is not the invitation\'s is skipped', same(lib.parseInvitation('See https://kybernos.app/help then ' + link('?token=' + TOKEN)), ok(TOKEN, 'dev.kybernos.app')))
check('a token in the FRAGMENT is read too', same(lib.parseInvitation(link('#token=' + TOKEN)), ok(TOKEN, 'dev.kybernos.app')))
check('a token in the fragment with another key before it', same(lib.parseInvitation(link('#a=1&token=' + TOKEN)), ok(TOKEN, 'dev.kybernos.app')))
check('the query wins over the fragment when both name a token', lib.parseInvitation(link('?token=' + TOKEN + '#token=' + 'x'.repeat(30))).token === TOKEN)
check('a link of ANOTHER host gives the token and names the host (the token goes to the active server only: test-join-host.mjs)', same(lib.parseInvitation('https://evil.example/invitations/accept?token=' + TOKEN), ok(TOKEN, 'evil.example')))
check('a link with a port keeps the port in the host', lib.parseInvitation('http://localhost:8791/invitations/accept?token=' + TOKEN).host === 'localhost:8791')

console.log('What is refused, and why')
check('nothing', same(lib.parseInvitation(''), no('empty')) && same(lib.parseInvitation('   \n '), no('empty')) && same(lib.parseInvitation(undefined), no('empty')) && same(lib.parseInvitation(null), no('empty')) && same(lib.parseInvitation(42), no('empty')))
check('a few words', same(lib.parseInvitation('hello there'), no('junk')))
check('a token that is too short', same(lib.parseInvitation('abc123'), no('junk')) && same(lib.parseInvitation(TOKEN.slice(0, 15)), no('junk')))
check('a token that is too long', same(lib.parseInvitation('a'.repeat(201)), no('junk')))
check('a token with a character outside base64url', same(lib.parseInvitation(TOKEN.slice(0, 20) + '+' + TOKEN.slice(21)), no('junk')) && same(lib.parseInvitation(TOKEN.slice(0, 20) + '/' + TOKEN.slice(21)), no('junk')))
check('a link that is not an invitation\'s', same(lib.parseInvitation('https://dev.kybernos.app/account?token=' + TOKEN), no('not_invitation')))
check('an invitation\'s address with no token', same(lib.parseInvitation(link('')), no('no_token')) && same(lib.parseInvitation(link('?token=')), no('no_token')))
check('an invitation\'s address with a token that has the wrong shape', same(lib.parseInvitation(link('?token=short')), no('no_token')))
check('the path must END with /invitations/accept (a look-alike inside another path is no invitation)', same(lib.parseInvitation('https://x.test/invitations/accept/other?token=' + TOKEN), no('not_invitation')))
check('a script address is not an invitation', same(lib.parseInvitation('javascript:alert(1)//invitations/accept?token=' + TOKEN), no('junk')))
check('a file address is not an invitation', same(lib.parseInvitation('file:///invitations/accept?token=' + TOKEN), no('junk')))
check('a huge paste is cut, not scanned whole', lib.parseInvitation('x '.repeat(lib.INVITE_INPUT_MAX) + TOKEN).ok === false)
check('every refusal has a sentence', ['empty', 'junk', 'no_token', 'not_invitation', 'whatever'].map(lib.joinParseKey).join() === 'joinEmpty,joinJunk,joinNoToken,joinNotInvitation,joinJunk')

console.log('The answer of the host -> the sentence')
const key = (res) => lib.joinFailure(res).key
check('404 (invalid, used, withdrawn, expired or meant for another account) is ONE sentence', key({ ok: false, error: 'invitation_unusable', status: 404 }) === 'joinGone')
check('a full team says so and keeps the link valid', key({ ok: false, error: 'seat_limit', status: 409 }) === 'joinSeats')
check('too many tries', key({ ok: false, error: 'rate_limited', status: 429 }) === 'joinBusy')
check('a server that does not answer', key({ ok: false, error: 'unreachable', status: 0 }) === 'joinDown')
check('a signed-out device', key({ ok: false, error: 'non_connecte' }) === 'joinSignedOut')
check('a token the host refused to send', key({ ok: false, error: 'token_shape' }) === 'joinJunk')
const planned = ['invitation_unusable', 'seat_limit', 'rate_limited', 'unreachable', 'non_connecte', 'token_shape']
check('only the unplanned failures offer the server\'s own page', planned.every((e) => lib.joinFailure({ ok: false, error: e }).browser === false) && lib.joinFailure({ ok: false, error: 'refused', status: 500 }).browser === true && lib.joinFailure(null).browser === true && lib.joinFailure({}).browser === true)
check('an unknown failure, and no answer at all, say « did not work out »', key({ ok: false, error: 'refused', status: 500 }) === 'joinFailed' && key(null) === 'joinFailed' && key(undefined) === 'joinFailed')

console.log('The server\'s own page, and the hint on another host')
check('the browser address is the active server\'s web address plus the token', lib.joinBrowserUrl('https://dev.kybernos.app', TOKEN) === 'https://dev.kybernos.app/invitations/accept?token=' + TOKEN)
check('only the origin of the web address is kept', lib.joinBrowserUrl('https://dev.kybernos.app/some/path?x=1#h', TOKEN) === 'https://dev.kybernos.app/invitations/accept?token=' + TOKEN)
check('no address, a script address or a bad token gives nothing', lib.joinBrowserUrl('', TOKEN) === null && lib.joinBrowserUrl('javascript:alert(1)', TOKEN) === null && lib.joinBrowserUrl('https://dev.kybernos.app', 'short') === null && lib.joinBrowserUrl(undefined, TOKEN) === null)
check('a link of another host is named against the active server', same(lib.joinOtherHost('evil.example', 'https://dev.kybernos.app'), { link: 'evil.example', active: 'dev.kybernos.app' }))
check('the same host (any case) gives no hint, and neither does a bare token', lib.joinOtherHost('Dev.Kybernos.App', 'https://dev.kybernos.app') === null && lib.joinOtherHost(null, 'https://dev.kybernos.app') === null && lib.joinOtherHost('', 'https://dev.kybernos.app') === null)
check('no active web address gives no hint', lib.joinOtherHost('evil.example', '') === null && lib.joinOtherHost('evil.example', undefined) === null)

console.log('The words')
const frFrom = source.indexOf('      fr: {')
const enFrom = source.indexOf('      en: {')
const dictOf = (lang) => (lang === 'en' ? source.slice(enFrom, source.indexOf('\n      },', enFrom)) : source.slice(frFrom, enFrom))
const KEYS = ['joinRow', 'joinIntro', 'joinField', 'joinCheck', 'joinChecking', 'joinCancel', 'joinAccept', 'joinAccepting', 'joinWho', 'joinWhoAnon', 'joinSentTo', 'joinMismatch', 'joinOtherHost',
  'joinEmpty', 'joinJunk', 'joinNotInvitation', 'joinNoToken', 'joinGone', 'joinSeats', 'joinBusy', 'joinDown', 'joinSignedOut', 'joinFailed', 'joinBrowser', 'joinNoPlan']
for (const lang of ['fr', 'en']) {
  const missing = KEYS.filter((k) => new RegExp('\\b' + k + ": '").test(dictOf(lang)) !== true)
  check(lang + ': every sentence of the dialog is there', missing.length === 0, missing)
}
const sentence = (lang, k) => new RegExp('\\b' + k + ": '((?:[^'\\\\]|\\\\.)*)'").exec(dictOf(lang))[1]
check('the 404 sentence names every reason: expired, used, withdrawn, another account (EN)', ['expired', 'used', 'withdrawn', 'another account'].every((w) => sentence('en', 'joinGone').includes(w)))
check('the 404 sentence names every reason (FR)', ['expiré', 'servi', 'retirée', 'autre compte'].every((w) => sentence('fr', 'joinGone').includes(w)))
check('the full-team sentence says the link stays valid (EN and FR)', sentence('en', 'joinSeats').includes('stays valid') && sentence('fr', 'joinSeats').includes('reste valable'))
check('the unreachable sentence says the server could not be reached (EN)', sentence('en', 'joinDown').includes('could not be reached'))
check('the placeholders of each sentence are the same in both languages', KEYS.every((k) => same((sentence('en', k).match(/\{\w+\}/g) || []).sort(), (sentence('fr', k).match(/\{\w+\}/g) || []).sort())))

console.log('\n' + (failed === 0 ? 'ALL GOOD' : failed + ' failed'))
process.exit(failed === 0 ? 0 : 1)

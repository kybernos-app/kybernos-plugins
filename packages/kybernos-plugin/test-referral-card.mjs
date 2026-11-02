#!/usr/bin/env node
// The referral card of the sidebar footer says what the SERVER pays, or nothing (account campaign 2026-10-18, AC-06).
//
//   node packages/kybernos-plugin/test-referral-card.mjs
//
// It used to say « Get 500 credits each » (and put it in the text of the share sheet) whatever the server paid: the replica pays 5 USD, a server
// with no offer pays nothing. The pure helpers are cut out of client.js and run on their own; the component is checked in the source.
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

console.log('no figure of our own')
check('the hard-coded « 500 credits » is gone from every string of the plugin', !/500 (credits|crédits)/i.test(SRC) && !/crédits chacun/.test(SRC))
check('there is no fixed subtitle key any more: the subtitle is the offer\'s sentence or nothing', !SRC.includes("'menu.referral.sub'"))

const a = SRC.indexOf('// <kb-referral-offer>')
const b = SRC.indexOf('// </kb-referral-offer>', a)
check('the helpers can be cut out of client.js', a > 0 && b > a)
if (a < 0 || b < a) { console.log(`\n${pass} ✓  ${fail} ✗`); process.exit(1) }
const { kbReferralOfferOf, kbReferralMoney } = new Function(SRC.slice(a, b) + '\nreturn { kbReferralOfferOf, kbReferralMoney }')()

console.log('the offer the host relays')
{
  check('a running offer gives its amount', JSON.stringify(kbReferralOfferOf({ ok: true, offer: { amount_usd: '5.00', valid_days: 30, ends_at: null } })) === JSON.stringify({ amount: 5 }))
  check('cents are kept', kbReferralOfferOf({ offer: { amount_usd: '2.50' } }).amount === 2.5)
  check('no offer: null (the server runs none)', kbReferralOfferOf({ ok: true, offer: null }) === null)
  check('an older host that does not relay it: null', kbReferralOfferOf({ ok: true, code: 'X' }) === null)
  check('nothing at all: null', kbReferralOfferOf(null) === null && kbReferralOfferOf(undefined) === null && kbReferralOfferOf('x') === null)
  check('a zero, negative, textual or numeric amount is not an offer', ['0.00', '-5', 'five', '5 USD', ''].every((v) => kbReferralOfferOf({ offer: { amount_usd: v } }) === null) && kbReferralOfferOf({ offer: { amount_usd: 5 } }) === null)
}

console.log('how the amount is written')
{
  check('whole dollars have no cents (English)', kbReferralMoney(5, 'en') === '$5', kbReferralMoney(5, 'en'))
  check('cents are shown when there are some', kbReferralMoney(2.5, 'en') === '$2.50', kbReferralMoney(2.5, 'en'))
  check('French keeps its own order and sign', /^5\s?\$/.test(kbReferralMoney(5, 'fr')), kbReferralMoney(5, 'fr'))
  check('the product\'s own French name is not a locale: it still gives an amount', /5/.test(kbReferralMoney(5, 'kybernos')) && /\$/.test(kbReferralMoney(5, 'kybernos')), kbReferralMoney(5, 'kybernos'))
  check('a locale the runtime refuses still gives an amount', kbReferralMoney(5, 'not a locale!!') === '$5', kbReferralMoney(5, 'not a locale!!'))
}

console.log('the card')
{
  const gift = SRC.slice(SRC.indexOf('const KbReferralGift = () => {'), SRC.indexOf('// ── The feedback form (V-10)'))
  check('the component is found', gift.length > 1000)
  check('the subtitle is drawn only when there is an offer', /offerText !== ''\s*\?\s*h\('span', null, offerText\)/.test(gift) || /offerText !== '' \? h\('span'/.test(gift))
  check('the gift button\'s tip and name carry the offer only when there is one', /const tip = offerText !== '' \? label \+ ' — ' \+ offerText : label/.test(gift) && /title: tip, 'aria-label': tip/.test(gift))
  check('the share sheet text says the amount only when there is an offer', /offerText !== '' \? kbt\('menu\.referral\.sharetext\.offer'\)/.test(gift))
  check('the offer is read at every opening of the card, not once for good (the owner may start or end one while DSH runs)', /\}, \[open\]\)/.test(gift.slice(gift.indexOf("fetch('/kybernos-cloud/referral'"))))
}

console.log('the link to the referral page')
{
  // « Open the referral page » was a plain link to `<web>/account`: signed out in the browser, and the Overview instead of the Referral page. The footer (kybernos-cloud) owns the single-use
  // console link, so the card asks it with a window event it may cancel; a request nobody claims (signed out, no footer) is served by the link itself, the server's own sign-in.
  const c = SRC.indexOf('// <kb-referral-open>')
  const d = SRC.indexOf('// </kb-referral-open>', c)
  check('the helper can be cut out of client.js', c > 0 && d > c)
  if (c > 0 && d > c) {
    const { kbReferralOpenAsk } = new Function(SRC.slice(c, d) + '\nreturn { kbReferralOpenAsk }')()
    const sent = []
    const realCustomEvent = globalThis.CustomEvent
    // A window that has a footer listening: it claims (cancels) the request.
    globalThis.window = { dispatchEvent: (ev) => { sent.push({ type: ev.type, detail: ev.detail, cancelable: ev.cancelable }); ev.preventDefault(); return !ev.defaultPrevented } }
    globalThis.CustomEvent = class { constructor (type, init) { this.type = type; this.detail = init && init.detail; this.cancelable = init && init.cancelable === true; this.defaultPrevented = false } preventDefault () { if (this.cancelable) this.defaultPrevented = true } }
    check('a footer that claims the request: the card\'s link must not be followed', kbReferralOpenAsk('referral') === true)
    check('it asks for the Referral page, with a request the footer can cancel', sent.length === 1 && sent[0].type === 'kybernos-cloud:account' && sent[0].detail.section === 'referral' && sent[0].cancelable === true, sent)
    // Nobody listening (signed out, or no footer): the event is not cancelled, the link is followed.
    globalThis.window = { dispatchEvent: () => true }
    check('nobody claims it: the link is followed (the server\'s sign-in)', kbReferralOpenAsk('referral') === false)
    // A window that cannot dispatch at all, or an environment without CustomEvent: the link is followed, nothing throws.
    globalThis.window = { dispatchEvent: () => { throw new Error('no events') } }
    check('a window that cannot dispatch: the link is followed', kbReferralOpenAsk('referral') === false)
    delete globalThis.CustomEvent
    globalThis.window = { dispatchEvent: () => false }
    check('no CustomEvent: the link is followed', kbReferralOpenAsk('referral') === false)
    delete globalThis.window
    globalThis.CustomEvent = realCustomEvent
  }
  const gift = SRC.slice(SRC.indexOf('const KbReferralGift = () => {'), SRC.indexOf('// ── The feedback form (V-10)'))
  check('the footer link of the card asks the footer first, and keeps its own address for what nobody claims', /className: 'kbu-rel-open', href: kbReferralPageHref\(\), target: '_blank', rel: 'noreferrer noopener',\s*onClick: \(e\) => \{ if \(kbReferralOpenAsk\('referral'\) === true\) \{ e\.preventDefault\(\); setOpen\(false\) \} \}/.test(gift))
  check('the link keeps pointing at the Referral page of the app for what nobody claims', /const kbReferralPageHref = \(\) => kbReferralPage\(\) \+ '#referral'/.test(SRC))
  check('the share fallbacks still use the plain address (an address to hand out, not a page to open)', /lienAffiche !== '' \? lienAffiche : kbReferralPage\(\)/.test(gift))
}

console.log('the sentences')
{
  const key = (k) => new RegExp("'" + k.replace(/\./g, '\\.') + "': \\{ kybernos: '((?:[^'\\\\]|\\\\.)*)', en: '((?:[^'\\\\]|\\\\.)*)' \\}").exec(SRC)
  const offer = key('menu.referral.offer')
  const plain = key('menu.referral.sharetext')
  const shared = key('menu.referral.sharetext.offer')
  check('the three sentences exist in English and in the product\'s French', offer !== null && plain !== null && shared !== null)
  if (offer !== null && plain !== null && shared !== null) {
    check('the amount is a placeholder in the sentences that carry it', offer[2].includes('{amount}') && offer[1].includes('{amount}') && shared[2].includes('{amount}') && shared[1].includes('{amount}'))
    check('the plain share sentence promises nothing', !/\{amount\}|\d|credit|crédit/i.test(plain[2]) && !/\{amount\}|\d|credit|crédit/i.test(plain[1]), plain)
    check('no sentence is the English base spelt in French', !/\b(chacun|Rejoins)\b/.test(offer[2] + shared[2] + plain[2]))
  }
}

console.log(`\n${pass} ✓  ${fail} ✗`)
process.exit(fail === 0 ? 0 : 1)

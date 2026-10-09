// Signed out, the Security and Referral pages must not look like an account exists: no "Change / Manage" buttons that open an
// account that is not there, no empty referral code to share, and no raw "aucun compte lie a kybernos.app" line from the host.
// They say so, and say why an account is worth creating. The reasons are only ones the product already states elsewhere.
//   node packages/kybernos-plugin/test-account-signed-out.mjs
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'client.js'), 'utf8')

let failed = 0
const check = (name, ok, detail) => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok || detail === undefined ? '' : '  — ' + detail))
  if (!ok) failed += 1
}

// The dictionary entries: 'key': { kybernos: '…', en: '…' } (kybernos is the French locale).
const entry = (key) => {
  const m = new RegExp("'" + key.replace(/\./g, '\\.') + "': \\{ kybernos: '((?:[^'\\\\]|\\\\.)*)', en: '((?:[^'\\\\]|\\\\.)*)' \\}").exec(source)
  return m === null ? null : { fr: m[1], en: m[2] }
}

console.log('the words')
const KEYS = ['security', 'referral', 'why', 'models', 'models.sub', 'memory', 'memory.sub', 'sync', 'sync.sub', 'credits', 'credits.sub', 'cta', 'local']
for (const k of KEYS) {
  const e = entry('kbac.out.' + k)
  check('kbac.out.' + k + ' exists in French and English, and they differ', e !== null && e.fr.trim() !== '' && e.en.trim() !== '' && e.fr !== e.en, JSON.stringify(e))
}
const credits = entry('kbac.out.credits.sub')
const referralSub = entry('kbac.referral.sub')
check('the reward promised here is the one the Referral page states (500 credits, in both languages)',
  credits !== null && referralSub !== null && /500/.test(credits.fr) && /500/.test(credits.en) && /500/.test(referralSub.fr) && /500/.test(referralSub.en))
check('no page claims the account is free: that is not something the code can confirm',
  KEYS.every((k) => { const e = entry('kbac.out.' + k); return e !== null && !/gratuit|\bfree\b/i.test(e.fr + ' ' + e.en) }))

console.log('the wiring')
const bloc = (from, to) => { const a = source.indexOf(from); const b = source.indexOf(to, a + 1); return a < 0 || b < 0 ? '' : source.slice(a, b) }
const referral = bloc('const KbacReferral = () => {', 'const KbacAppearance = () => {')
const security = bloc('const KbacSecurity = () => {', 'const KbacSupport = () => {')
check('the Referral page shows the signed-out view when disconnected and no code was pasted by hand',
  /session === 'disconnected' && rel\.code === '' && rel\.link === ''\) return h\(KbacSignedOut, \{ page: 'referral' \}\)/.test(referral))
check('the Security page shows the signed-out view when disconnected', /session === 'disconnected'\) return h\(KbacSignedOut, \{ page: 'security' \}\)/.test(security))
check('both pages wait for the connection state before drawing (no flash of the account content)', /session === 'loading'/.test(referral) && /session === 'loading'/.test(security))
check('an unreadable state keeps the usual page (the cloud bundle may be off)', /poser\('unknown'\)/.test(source) && !/session === 'unknown'/.test(referral + security))
check('the page reads the state from the cloud host', /fetch\('\/kybernos-cloud\/status'/.test(bloc('const useKbCloud = () => {', 'const KbacSignedOut = ')))
const vue = bloc('const KbacSignedOut = ', 'const KbacReferral = () => {')
check('the button opens the Cloud card, as the Data & privacy page does', /dispatchEvent\(new Event\('kybernos-cloud:open'\)\)/.test(vue))
check('the four reasons shown are the four that have words', /\['models', 'memory', 'sync', 'credits'\]/.test(vue))
check('the head of the page is kept (title and subtitle)', /h\(KbacHead, \{ title: kbt\('kbac\.' \+ props\.page\)/.test(vue))

console.log('the look')
const css = source.split('\n').filter((l) => l.startsWith('.kbac-out'))
check('the styles exist', css.length >= 7, String(css.length))
check('they use design tokens only (no hard-coded colour)', css.every((l) => !/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(l)), css.filter((l) => /#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(l)).join(' | '))

console.log(failed === 0 ? '\nOK' : `\n${failed} failure(s)`)
process.exit(failed === 0 ? 0 : 1)

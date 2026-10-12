// Test of the first-run wizard's pure core: the shipped texts (4 languages), the language
// choice, the step plan, the theme probe and the K artwork. It runs the block marked
// KB-OB-CORE of packages/kybernos-plugin/client.js as-is (the client is one bundle with no
// relative imports, hence the extraction, same as test-brand.mjs), then reads the UI block as
// text to check that every text it asks for exists.
// Usage: node scripts/test-onboarding.mjs   (exit 0 = everything passes)
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const src = readFileSync(root + 'packages/kybernos-plugin/client.js', 'utf8')
const brand = src.match(/\/\/ KB-BRAND-CORE-BEGIN([\s\S]*?)\/\/ KB-BRAND-CORE-END/)
const core = src.match(/\/\/ KB-OB-CORE-BEGIN([\s\S]*?)\/\/ KB-OB-CORE-END/)
const ui = src.match(/\/\/ KB-OB-UI-BEGIN([\s\S]*?)\/\/ KB-OB-UI-END/)
if (core === null || ui === null) { console.error('BLOCKS KB-OB-CORE / KB-OB-UI NOT FOUND in packages/kybernos-plugin/client.js'); process.exit(1) }
const names = 'KB_OB_LANGS, KB_OB_PROFILES, KB_OB_MODES, KB_OB_PROVIDERS, KB_OB_T, kbObPickLang, kbObText, kbObPlan, kbObStepOf, kbObBack, kbObIsDark, kbObKeyShape, kbObProviderFromKey, kbObNeedModel'
const mod = await import('data:text/javascript,' + encodeURIComponent(core[1] + '\nexport { ' + names + ' }'))

let fails = 0
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) { fails++; console.log('FAIL', label, '| got', JSON.stringify(got), '| want', JSON.stringify(want)) } else console.log('ok  ', label)
}

/* ── 1. The shipped texts: four languages, no hole, same placeholders ────── */
const ids = mod.KB_OB_LANGS.map((l) => l.id)
eq('languages: English first (the default), then French, Spanish, Arabic', ids, ['en', 'fr', 'es', 'ar'])
eq('only Arabic is right-to-left', mod.KB_OB_LANGS.filter((l) => l.rtl).map((l) => l.id), ['ar'])
const keys = Object.keys(mod.KB_OB_T)
eq('every text has one entry per language', keys.filter((k) => mod.KB_OB_T[k].length !== ids.length), [])
eq('no text is empty', keys.filter((k) => mod.KB_OB_T[k].some((t) => typeof t !== 'string' || t.trim() === '')), [])
const holes = (t) => (t.match(/\{[a-z]+\}/g) || []).sort().join(',')
eq('every language keeps the placeholders of the English text', keys.filter((k) => mod.KB_OB_T[k].some((t) => holes(t) !== holes(mod.KB_OB_T[k][0]))), [])
eq('a translated text is not left as the English one (apart from names and shared words)',
  keys.filter((k) => {
    const [en, ...rest] = mod.KB_OB_T[k]
    return rest.every((t) => t === en) && !/^(chat\.|fin\.cloud|loc\.engine|loc\.pulled\.n|ok\.line)/.test(k) && en.length > 12
  }), [])
eq('no raw HTML or script marker in any text', keys.filter((k) => mod.KB_OB_T[k].some((t) => /<\/?[a-z]|javascript:|on[a-z]+=/i.test(t))), [])

/* ── 2. The families of keys the UI builds by concatenation ──────────────── */
eq('a text for every profession', mod.KB_OB_PROFILES.filter((p) => mod.KB_OB_T['p.' + p] === undefined), [])
eq('a title and a description for every display mode', mod.KB_OB_MODES.filter((m) => mod.KB_OB_T['mode.' + m + '.t'] === undefined || mod.KB_OB_T['mode.' + m + '.d'] === undefined), [])
eq('the profession ids are the ones the previous wizard stored', mod.KB_OB_PROFILES, ['soft', 'entre', 'qa', 'produit', 'design', 'etudes', 'finance', 'medias', 'commerce', 'marketing', 'legal', 'autres'])
eq('the display mode ids are the ones the previous wizard stored', mod.KB_OB_MODES, ['code', 'bureau'])
eq('every message of the key form has a text', ['format', 'invalid', 'denied', 'unreach', 'fail'].filter((k) => mod.KB_OB_T['key.err.' + k] === undefined), [])
eq('every refusal of an installation has a text', ['noengine', 'busy', 'failed', 'connect'].filter((k) => mod.KB_OB_T['loc.err.' + k] === undefined), [])
eq('expired and refused pairings each have a title and a text', ['expired', 'denied'].filter((k) => mod.KB_OB_T['err.' + k + '.t'] === undefined || mod.KB_OB_T['err.' + k + '.s'] === undefined), [])
const asked = new Set()
// Only whole keys: the families built by concatenation ('p.' + id, 'mode.' + id + '.t', 'err.' + kind + '.s') are checked above.
for (const m of ui[1].matchAll(/\bT\('([a-z0-9.]+)'\s*[,)]/g)) asked.add(m[1])
eq('the UI asks for texts that exist', [...asked].filter((k) => mod.KB_OB_T[k] === undefined), [])
eq('the UI asked for a reasonable number of distinct texts', asked.size > 40, true)

/* ── 3. Which language the wizard starts in ──────────────────────────────── */
const pick = mod.kbObPickLang
eq('nothing known: English', pick(null, null), 'en')
eq('a shell in English: English', pick(null, 'en'), 'en')
eq('the app was set to French (the plugin stores « kybernos »): French', pick('kybernos', null), 'fr')
eq('the app choice wins over the shell', pick('en', 'fr'), 'en')
eq('a region tag is folded: es-ES', pick('es-ES', 'en'), 'es')
eq('an underscore tag is folded: ar_SA', pick('ar_SA', null), 'ar')
eq('the shell is used when the app has no choice', pick(null, 'fr'), 'fr')
eq('a language we do not ship falls back to the shell, then English', [pick('de', 'es'), pick('de', 'ja'), pick('', 'zz')], ['es', 'en', 'en'])
eq('rubbish is English', [pick(42, {}), pick(undefined, undefined)], ['en', 'en'])

/* ── 4. Texts ────────────────────────────────────────────────────────────── */
const T = mod.kbObText
eq('English text', T('en', 'back'), 'Back')
eq('French text', T('fr', 'back'), 'Retour')
eq('Arabic text', T('ar', 'back'), 'رجوع')
eq('placeholders are filled', T('en', 'step', { n: 2, total: 3 }), 'Step 2 of 3')
eq('every occurrence of a placeholder is filled', T('en', 'key.g1', { host: 'x.test' }), 'Open x.test and sign in.')
eq('an unknown language reads English', T('de', 'back'), 'Back')
eq('an unknown key answers itself', T('en', 'nope.nothing'), 'nope.nothing')

/* ── 5. The steps ────────────────────────────────────────────────────────── */
eq('three numbered steps when no model works yet', mod.kbObPlan(false), ['job', 'mode', 'model'])
eq('the model step drops out when one works', mod.kbObPlan(true), ['job', 'mode'])
eq('screens of the model step share one number', ['model', 'key', 'key-done', 'local', 'local-install', 'local-done', 'local-err', 'free', 'cloud-wait', 'cloud-ok', 'cloud-err'].map((s) => mod.kbObStepOf(s)), Array(11).fill('model'))
eq('welcome and the end screens have no number', ['welcome', 'done', 'later'].map((s) => mod.kbObStepOf(s)), [null, null, null])
eq('back goes one screen up', ['job', 'mode', 'model', 'key', 'local', 'local-err', 'cloud-wait', 'cloud-err'].map((s) => mod.kbObBack(s)), ['welcome', 'job', 'mode', 'model', 'model', 'local', 'model', 'model'])
eq('there is no back from welcome, from the end, mid-download, or once something is connected',
  ['welcome', 'done', 'later', 'cloud-ok', 'key-done', 'local-install', 'local-done'].map((s) => mod.kbObBack(s)), Array(7).fill(null))

/* ── 5b. The pasted key ──────────────────────────────────────────────────── */
eq('a key is one printable string of 8 to 400 characters', [mod.kbObKeyShape('sk-ant-api03-abcdefghij'), mod.kbObKeyShape('  sk-0123456789 \n')], ['sk-ant-api03-abcdefghij', 'sk-0123456789'])
eq('what is not a key is refused', ['', 'short', 'with space 123456789', 'tab\tkey-0123456789', 'é-0123456789ab', 'x'.repeat(401), 42, null, undefined].map((v) => mod.kbObKeyShape(v)), Array(9).fill(null))
eq('the provider is named by the prefixes that are unambiguous', [mod.kbObProviderFromKey('sk-ant-api03-x'), mod.kbObProviderFromKey('AIzaSyabc'), mod.kbObProviderFromKey('sk-proj-abc'), mod.kbObProviderFromKey(''), mod.kbObProviderFromKey(7)], ['anthropic', 'google', null, null, null])

/* ── 6. Light or dark ────────────────────────────────────────────────────── */
const dark = mod.kbObIsDark
eq('the dark page of the site', dark('rgb(23, 24, 26)'), true)
eq('the cream page of the site', dark('rgb(246, 244, 238)'), false)
eq('white', dark('rgb(255, 255, 255)'), false)
eq('black', dark('rgba(0, 0, 0, 1)'), true)
eq('transparent says nothing', [dark('rgba(0, 0, 0, 0)'), dark('transparent'), dark('')], [null, null, null])

/* ── 7b. The card: a failed turn that wants a model ──────────────────────── */
// The shapes below are the ones read from the real chat (useChat): nodes.valuesCache and navigation.current.
const SENTENCE = 'llm-pi-ai: no credential for provider route "xiaomi-token-plan-ams"; its profile resolves XIAOMI_TOKEN_PLAN_AMS_API_KEY, which is not set — store XIAOMI_TOKEN_PLAN_AMS_API_KEY through the credentials service'
const errNode = (turn, code, message) => ({ key: turn + ':turn-error', kind: 'turn-error', data: { kind: 'error', seq: 19, turn, step: 1, message, code } })
const other = { key: '12:turn-process1', kind: 'turn-process', data: { turn: 1 } }
const need = mod.kbObNeedModel
eq('no nodes, junk: nothing', [need(null, []), need(undefined, null), need('x', 7), need({}, [])].every((v) => v === null), true)
eq('no failed turn: nothing', need([other], [{ turn: 1, prompt: 'hi' }]), null)
eq('another failure code: nothing (the card is only for a missing key)', need([errNode(1, 'RATE_LIMIT', 'slow down')], [{ turn: 1, prompt: 'hi' }]), null)
eq('a missing key is read: the route, the reference, the message to put back',
  JSON.stringify(need([other, errNode(1, 'MISSING_CREDENTIAL', SENTENCE)], [{ turn: 1, prompt: 'Hello, are you there?' }])),
  JSON.stringify({ turn: 1, route: 'xiaomi-token-plan-ams', ref: 'XIAOMI_TOKEN_PLAN_AMS_API_KEY', prompt: 'Hello, are you there?' }))
eq('a sentence of another shape still shows the card, without a route or a reference',
  JSON.stringify(need([errNode(2, 'MISSING_CREDENTIAL', 'something else')], [{ turn: 1, prompt: 'a' }, { turn: 2, prompt: 'b' }])),
  JSON.stringify({ turn: 2, route: null, ref: null, prompt: 'b' }))
eq('only the latest turn counts: after a new message the card is gone',
  need([errNode(1, 'MISSING_CREDENTIAL', SENTENCE)], [{ turn: 1, prompt: 'a' }, { turn: 2, prompt: 'b' }]), null)
eq('and it is back when that new turn fails the same way',
  need([errNode(1, 'MISSING_CREDENTIAL', SENTENCE), errNode(2, 'MISSING_CREDENTIAL', SENTENCE)], [{ turn: 1, prompt: 'a' }, { turn: 2, prompt: 'b' }]).turn, 2)
eq('a reference that is not a *_API_KEY name is not taken',
  need([errNode(1, 'MISSING_CREDENTIAL', 'provider route "x"; its profile resolves PATH, which is not set')], [{ turn: 1, prompt: 'a' }]).ref, null)
eq('a route cannot carry a quote or a line break out of the sentence',
  need([errNode(1, 'MISSING_CREDENTIAL', 'provider route "a\nb"; its profile resolves K_API_KEY, x')], [{ turn: 1, prompt: 'a' }]).route, null)
eq('the model is chosen after each way is connected: the account, the key and the local model', [/autoSelect\('kybernos'\)/.test(src), /autoSelect\(S\.provider\)/.test(src), /autoSelect\('ollama-local', S\.localId\)/.test(src)].join(), 'true,true,true')
eq('the chat\'s card asks for it on behalf of that chat, forced', /body\.sessionId = env\.sessionId; body\.force = true/.test(src), true)
eq('every text the card asks for exists', [...src.matchAll(/\bT\('(nm\.[a-z.]+)'/g)].map((m) => m[1]).filter((k, i, a) => a.indexOf(k) === i && mod.KB_OB_T[k] === undefined), [])
eq('the card sits above the composer, in the input dock', /name: 'conversation\.input\.dock', id: 'kybernos-need-model'/.test(src), true)
eq('the card reads the failure from the chat, not from the DOM', /useChat\(\(c\) => \{ try \{ return c\.nodes\.valuesCache/.test(src), true)
eq('the card puts the message back, it does not send it', /kbPrefillDraft\(need\.prompt/.test(src) && !/inputActions\.submit|\.submit\(\)/.test(src.slice(src.indexOf('const KbNeedModel'), src.indexOf('const KbNeedModel') + 6000)), true)

/* ── 8. Reading the client file ──────────────────────────────────────────── */
eq('the UI block holds no personal path', /\/Users\//.test(core[1] + ui[1]), false)
eq('the old wizard\'s texts are gone from the dictionary', /'ob\.(bienvenue|metier|slogan|suivant)/.test(src), false)
eq('Arabic is a right-to-left base of the app too', /KB_RTL_BASES = \[[^\]]*'ar'/.test(src), true)
eq('the wizard never calls a host route it does not know', [...ui[1].matchAll(/'(\/(?:kybernos-cloud|kybernos-models|kybernos|modeles-locaux|free-llms)[^']*)'/g)].map((m) => m[1]).filter((p, i, a) => a.indexOf(p) === i).sort(),
  ['/free-llms/auto-enable', '/kybernos-cloud/disconnect', '/kybernos-cloud/poll', '/kybernos-cloud/start', '/kybernos-cloud/status', '/kybernos-models/key/check',
    '/kybernos/model/auto', '/modeles-locaux/annuler', '/modeles-locaux/installation', '/modeles-locaux/installer', '/modeles-locaux/machine'])
// The pages it hands over to are named by the id the Settings nav gives them (language-proof), and must be ids that nav knows.
const navKeys = src.match(/const KB_NAV_KEYS = \{([\s\S]*?)\n\}/)[1]
const known = new Set([...navKeys.matchAll(/(?:'([a-z0-9-]+)'|\b([a-z]+)):\s*'/g)].map((m) => m[1] || m[2]))
const handedTo = new Set([...ui[1].matchAll(/finish\(\[([^\]]+)\]\)/g)].flatMap((m) => [...m[1].matchAll(/'([a-z0-9-]+)'/g)].map((x) => x[1])))
eq('the wizard hands over to pages that exist in the Settings nav', [...handedTo].filter((k) => !known.has(k)), [])
eq('and to the three it needs', [...handedTo].sort(), ['kybernos-models', 'kybernos-ollama', 'models'])
eq('the two seams it reads are the ones the bundles publish', [/__KB_MODELS__/.test(ui[1]), /__KB_LOCAL__/.test(ui[1])], [true, true])

console.log(fails === 0 ? '\nall checks passed' : '\n' + fails + ' check(s) FAILED')
process.exit(fails === 0 ? 0 : 1)

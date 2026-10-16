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
const names = 'KB_OB_LANGS, KB_OB_PROFILES, KB_OB_MODES, KB_OB_PROVIDERS, KB_OB_T, kbObPickLang, kbObText, kbObPlan, kbObStepOf, kbObBack, kbObBackOf, kbObEscape, kbObIsDark, kbObKeyShape, kbObProviderFromKey, kbObNeedModel, KB_OB_KITS, kbObKitFor, kbObKitDefaults, kbObMemoryText, kbObSkillText, kbObSetupRows'
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
eq('exactly one has its own wording: « 1 model ready », « 1 modèle prêt », not « 1 models »', [T('en', 'ok.models', { n: 1 }), T('fr', 'ok.models', { n: 1 }), T('en', 'ok.models', { n: 3 })], ['1 model ready', '1 modèle prêt', '3 models ready'])
eq('…in every count line that can be 1: cloud models, kit added, kit failed, add selected', [T('en', 'fin.cloud.n', { n: 1 }), T('fr', 'fin.kit.n', { n: 1 }), T('en', 'k.err', { n: 1 }), T('es', 'k.add', { n: 1 })], ['Kybernos Cloud · 1 model', '1 ajouté', '1 could not be added. You can find it later in Skills and in Agent Teams.', 'Añadir el seleccionado'])

/* ── 5. The steps ────────────────────────────────────────────────────────── */
eq('four numbered steps, the model step among them whatever already works', mod.kbObPlan(), ['job', 'mode', 'model', 'kit'])
eq('the plan does not depend on an argument any more (a replay always shows the model step)', mod.kbObPlan(true), mod.kbObPlan(false))
eq('screens of the model step share one number', ['model', 'key', 'key-done', 'local', 'local-install', 'local-done', 'local-err', 'free', 'cloud-wait', 'cloud-ok', 'cloud-err'].map((s) => mod.kbObStepOf(s)), Array(11).fill('model'))
eq('the kit is its own step', mod.kbObStepOf('kit'), 'kit')
eq('welcome and the end screen have no number', ['welcome', 'done'].map((s) => mod.kbObStepOf(s)), [null, null])
eq('back goes one screen up', ['job', 'mode', 'model', 'kit', 'key', 'local', 'local-err', 'cloud-wait', 'cloud-err'].map((s) => mod.kbObBack(s)), ['welcome', 'job', 'mode', 'model', 'model', 'model', 'local', 'model', 'model'])
eq('the removed screens (the separate account offer, the « later » page) lead nowhere', [mod.kbObBack('offer'), mod.kbObStepOf('offer'), mod.kbObStepOf('later')], [null, null, null])
eq('there is no back from welcome, from the end, mid-download, or once something is connected',
  ['welcome', 'done', 'cloud-ok', 'key-done', 'local-install', 'local-done'].map((s) => mod.kbObBack(s)), Array(6).fill(null))
/* Escape (A6-03): on a first run it never ends the wizard (leaving records « later » for good) */
const first = (screen, extra) => ({ screen, standalone: false, menu: false, fromAccount: false, ...extra })
const alone = (screen, extra) => ({ screen, standalone: true, menu: false, fromAccount: false, ...extra })
eq('first run: Escape on the welcome screen does nothing (there is nowhere back, and leaving is « Skip »)', mod.kbObEscape(first('welcome')), 'none')
eq('first run: Escape steps back where « Back » exists', ['job', 'mode', 'model', 'kit', 'key', 'local', 'cloud-wait'].map((s) => mod.kbObEscape(first(s))), Array(7).fill('back'))
eq('first run: nowhere to go back to (end, mid-download, connected) means nothing happens, never a close', ['done', 'cloud-ok', 'key-done', 'local-install', 'local-done'].map((s) => mod.kbObEscape(first(s))), Array(5).fill('none'))
eq('first run: the free step that came right after an account has no back, so Escape does nothing there', mod.kbObEscape(first('free', { fromAccount: true })), 'none')
eq('first run: an open language menu is closed first, on any screen', ['welcome', 'job', 'model'].map((s) => mod.kbObEscape(first(s, { menu: true }))), Array(3).fill('menu'))
eq('opened on its own (replay, the chat card, the kit), nothing is recorded: Escape closes it', ['model', 'kit', 'key', 'local'].map((s) => mod.kbObEscape(alone(s))), Array(4).fill('close'))
eq('opened on its own, the menu still goes first', mod.kbObEscape(alone('model', { menu: true })), 'menu')
eq('the Back button and Escape share one rule: no back from the model or kit step when opened alone', ['model', 'kit'].map((s) => mod.kbObBackOf(alone(s))), [null, null])
eq('every string of the model question exists in the four languages', ['m.t', 'm.s', 'm.k', 'm.rec', 'm.kd', 'm.o', 'm.od', 'm.other', 'm.local', 'm.free', 'm.conn', 'm.later', 'm.keep'].map((k) => (Array.isArray(mod.KB_OB_T[k]) && mod.KB_OB_T[k].length === 4 && mod.KB_OB_T[k].every((v) => typeof v === 'string' && v.length > 0))), Array(13).fill(true))
eq('the removed texts are gone from the dictionary', Object.keys(mod.KB_OB_T).filter((k) => /^(offer\.|v\.(cloud|key|free)|brain\.)/.test(k)), [])

/* ── 5a. The starter kit ─────────────────────────────────────────────────── */
const marketIds = [...src.slice(src.indexOf('const KB_MARKET_TEAMS = ['), src.indexOf('// Manifest read-only')).matchAll(/^        id: '([a-z0-9-]+)', name:/gm)].map((m) => m[1])
eq('the marketplace of the bundle holds the teams the kits point at', marketIds.sort(), ['inbound-closer', 'research-desk', 'studencik'])
eq('every profession has a kit, and only those', Object.keys(mod.KB_OB_KITS).sort(), [...mod.KB_OB_PROFILES].sort())
const kitSkills = Object.values(mod.KB_OB_KITS).flatMap((k) => k.skills)
eq('every skill is a valid skill name from a GitHub owner/repo, with an English and a French line',
  kitSkills.filter((x) => !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(x.name) || !/^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(x.source) || !Array.isArray(x.d) || x.d.length !== 2 || x.d.some((t) => typeof t !== 'string' || t.trim() === '')).map((x) => x.name), [])
eq('every kit has between 3 and 4 skills, no duplicate inside a kit', Object.entries(mod.KB_OB_KITS).filter(([, k]) => k.skills.length < 3 || k.skills.length > 4 || new Set(k.skills.map((x) => x.name)).size !== k.skills.length).map(([id]) => id), [])
eq('every team of a kit exists in the marketplace', Object.values(mod.KB_OB_KITS).flatMap((k) => k.teams).filter((id) => marketIds.indexOf(id) < 0), [])
eq('the students are offered the team the product ships for them', mod.KB_OB_KITS.etudes.teams.indexOf('studencik') >= 0, true)
eq('an unknown or empty profession gets the general kit', [mod.kbObKitFor(null), mod.kbObKitFor('nope'), mod.kbObKitFor(undefined)].every((k) => k === mod.KB_OB_KITS.autres), true)
const etudes = mod.KB_OB_KITS.etudes
eq('everything is ticked on a first run', mod.kbObKitDefaults(etudes, { skills: [], teams: [] }), ['s:study-plan', 's:flashcards', 's:pdf', 's:docx', 't:studencik', 't:research-desk'])
eq('what is installed is not ticked again (a replay doubles nothing)', mod.kbObKitDefaults(etudes, { skills: ['pdf', 'flashcards'], teams: ['studencik'] }), ['s:study-plan', 's:docx', 't:research-desk'])
eq('a probe that failed leaves everything ticked', [mod.kbObKitDefaults(etudes, null), mod.kbObKitDefaults(etudes, {})].map((k) => k.length), [6, 6])
eq('a skill reads in French, other languages read English', [mod.kbObSkillText('fr', etudes.skills[0]), mod.kbObSkillText('es', etudes.skills[0]), mod.kbObSkillText('ar', etudes.skills[0])], ['Planifie les sessions de révision jusqu’à l’examen', 'Plan revision sessions up to the exam', 'Plan revision sessions up to the exam'])
eq('every string of the kit exists in the four languages', ['k.t', 'k.t0', 'k.s', 'k.skills', 'k.teams', 'k.src', 'k.add', 'k.none', 'k.skip', 'k.done', 'k.soon', 'k.note', 'k.busy', 'k.err', 'fin.kit', 'fin.kit.n', 'fin.mem', 'fin.mem.d', 'mem.job', 'mem.mode'].map((k) => (Array.isArray(mod.KB_OB_T[k]) && mod.KB_OB_T[k].length === 4 && mod.KB_OB_T[k].every((v) => typeof v === 'string' && v.length > 0))), Array(20).fill(true))
eq('the memory sentence names the profession and the display mode, in the wizard\'s language',
  [mod.kbObMemoryText('en', 'etudes', 'bureau'), mod.kbObMemoryText('fr', 'soft', 'code')],
  ['Works as: Students / Teaching / Research. Prefers: Office mode.', 'Métier : Software / Data / IA. Préfère : Mode Code.'])
eq('with only one of the two it says only that, with neither it says nothing', [mod.kbObMemoryText('en', 'legal', null), mod.kbObMemoryText('en', null, 'code'), mod.kbObMemoryText('en', null, null), mod.kbObMemoryText('en', 'nope', 'nope')], ['Works as: Legal / Administration / HR.', 'Prefers: Coding mode.', null, null])

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

/* ── 7b. « What we set up for you »: the closing list says what the host says, never a promise ─────────── */
{
  const R = mod.kbObSetupRows
  const fresh = { memory: { ok: true, settings: { lessons: true, context: true, relevant: true } }, cloud: { ok: true, connected: false }, auto: { ok: true, global: false, scope: 'all' },
    provider: { ok: true, provider: null }, search: { ok: true, engines: [{ id: 'brave-api', enabled: true, configured: false }, { id: 'duckduckgo', enabled: true, configured: true }] },
    study: { ok: true, etude: { actif: false, cle: '', mode: 'aucun' } } }
  const texts = (rows) => rows.map((r) => r.id + ':' + r.text)
  eq('nothing readable: no row, no error', [R(null), R({}), R({ memory: 7, cloud: 'x', auto: [], provider: null, search: 5, study: undefined })], [[], [], []])
  eq('a fresh install, signed out: five rows, in this order, each saying what is really so', texts(R(fresh)),
    ['mem:set.mem.local', 'auto:set.auto.off', 'conn:set.conn.later', 'ws:set.ws.eng', 'study:set.study.wait'])
  eq('signed in: the account\'s memories and the Kybernos Cloud connector', texts(R({ ...fresh, cloud: { ok: true, connected: true } })).filter((t) => /^(mem|conn):/.test(t)), ['mem:set.mem.both', 'conn:set.conn.cloud'])
  eq('Auto routing: on, on among the free models, off', [R({ auto: { global: true, scope: 'all' } })[0].text, R({ auto: { global: true, scope: 'free' } })[0].text, R({ auto: { global: false, scope: 'free' } })[0].text],
    ['set.auto.on', 'set.auto.free', 'set.auto.off'])
  eq('the connector: Composio with the person\'s own key when they chose it', R({ provider: { provider: 'composio' } })[0].text, 'set.conn.own')
  eq('lessons switched off: said, with or without an account', [R({ memory: { settings: { lessons: false } }, cloud: { connected: false } })[0].text, R({ memory: { settings: { lessons: false } }, cloud: { connected: true } })[0].text], ['set.mem.off', 'set.mem.acct'])
  eq('web search: the first engine that is on AND can answer, by its name', R(fresh).find((r) => r.id === 'ws').vars, { engine: 'DuckDuckGo' })
  eq('web search: none ready says so, and an unknown engine keeps its id', [R({ search: { engines: [{ id: 'tavily', enabled: true, configured: false }] } })[0].text, R({ search: { engines: [{ id: 'zz-new', enabled: true, configured: true }] } })[0].vars.engine], ['set.ws.none', 'zz-new'])
  eq('study model: automatic with its model, chosen by the person, switched off, not started yet', [
    R({ study: { etude: { actif: true, cle: 'kybernos/glm', mode: 'auto' } } })[0], R({ study: { etude: { actif: true, cle: 'ollama-local/x', mode: 'choisi' } } })[0].text,
    R({ study: { etude: { actif: false, cle: '', mode: 'none' } } })[0].text, R({ study: { etude: { actif: false, cle: '', mode: 'aucun' } } })[0].text].map((r) => (typeof r === 'string' ? r : r.text + '|' + r.vars.model)),
    ['set.study.auto|kybernos/glm', 'set.study.chosen', 'set.study.off', 'set.study.wait'])
  eq('a long or odd model name is clipped, never trusted', R({ study: { etude: { actif: true, cle: 'x'.repeat(500), mode: 'auto' } } })[0].vars.model.length, 80)
  // every row names a text that exists in all four languages, and a Settings page that exists
  const all = [R(fresh), R({ ...fresh, cloud: { connected: true }, auto: { global: true, scope: 'free' }, provider: { provider: 'composio' } }), R({ memory: { settings: { lessons: false } }, cloud: { connected: true }, study: { etude: { actif: true, cle: 'a/b', mode: 'choisi' } } }),
    R({ search: { engines: [] }, study: { etude: { actif: false, cle: '', mode: 'none' } } }), R({ study: { etude: { actif: true, cle: 'a/b', mode: 'auto' } } }), R({ ...fresh, memory: { settings: { lessons: false } } }), R({ ...fresh, cloud: { connected: true }, auto: { global: true, scope: 'all' } })].flat()
  eq('every label and text the rows can ask for exists in the four languages', [...new Set(all.flatMap((r) => [r.label, r.text]))].filter((k) => mod.KB_OB_T[k] === undefined || mod.KB_OB_T[k].length !== 4), [])
  eq('and every text of the family exists (the UI builds none of them by hand)', Object.keys(mod.KB_OB_T).filter((k) => /^set\./.test(k)).filter((k) => !new Set(all.flatMap((r) => [r.label, r.text])).has(k) && !['set.t', 'set.change'].includes(k)), [])
  const nav = src.match(/const KB_NAV_KEYS = \{([\s\S]*?)\n\}/)[1]
  const navIds = new Set([...nav.matchAll(/(?:'([a-z0-9-]+)'|\b([a-z]+)):\s*'/g)].map((m) => m[1] || m[2]))
  eq('every « Change » opens a page the Settings nav knows', [...new Set(all.flatMap((r) => r.page))].filter((k) => !navIds.has(k)).sort(), [])
  eq('and each area has its own page', Object.fromEntries(R(fresh).map((r) => [r.id, r.page])), { mem: ['kybernos-memory'], auto: ['kybernos-auto-page'], conn: ['kybernos-composio'], ws: ['kybernos-websearch-page'], study: ['general'] })
  eq('the end screen reads the five routes of the bundles, each on its own (one that fails leaves its row out)', [/get\('\/kybernos-memory\/settings'\)/.test(ui[1]), /get\('\/kybernos-sessions\/settings'\)/.test(ui[1]), /kbObSetupRows\(/.test(ui[1]), /finish\(r\.page\)/.test(ui[1])], [true, true, true, true])
}

/* ── 8. Reading the client file ──────────────────────────────────────────── */
eq('the UI block holds no personal path', /\/Users\//.test(core[1] + ui[1]), false)
eq('the old wizard\'s texts are gone from the dictionary', /'ob\.(bienvenue|metier|slogan|suivant)/.test(src), false)
eq('Arabic is a right-to-left base of the app too', /KB_RTL_BASES = \[[^\]]*'ar'/.test(src), true)
eq('the wizard never calls a host route it does not know', [...ui[1].matchAll(/'(\/(?:kybernos-cloud|kybernos-models|kybernos|modeles-locaux|free-llms)[^']*)'/g)].map((m) => m[1]).filter((p, i, a) => a.indexOf(p) === i).sort(),
  ['/free-llms/auto-enable', '/kybernos-auto/state', '/kybernos-cloud/disconnect', '/kybernos-cloud/memory/add', '/kybernos-cloud/memory/update', '/kybernos-cloud/poll', '/kybernos-cloud/start', '/kybernos-cloud/status',
    '/kybernos-memory/settings', '/kybernos-models/key/check', '/kybernos-sessions/settings', '/kybernos-skills/install', '/kybernos-skills/skills', '/kybernos-websearch/state', '/kybernos/composio/provider', '/kybernos/model/auto', '/modeles-locaux/annuler', '/modeles-locaux/installation', '/modeles-locaux/installer', '/modeles-locaux/machine'])
// The pages it hands over to are named by the id the Settings nav gives them (language-proof), and must be ids that nav knows.
const navKeys = src.match(/const KB_NAV_KEYS = \{([\s\S]*?)\n\}/)[1]
const known = new Set([...navKeys.matchAll(/(?:'([a-z0-9-]+)'|\b([a-z]+)):\s*'/g)].map((m) => m[1] || m[2]))
const handedTo = new Set([...ui[1].matchAll(/finish\(\[([^\]]+)\]\)/g)].flatMap((m) => [...m[1].matchAll(/'([a-z0-9-]+)'/g)].map((x) => x[1])))
eq('the wizard hands over to pages that exist in the Settings nav', [...handedTo].filter((k) => !known.has(k)), [])
eq('and to the three it needs', [...handedTo].sort(), ['kybernos-models', 'kybernos-ollama', 'models'])
eq('the two seams it reads are the ones the bundles publish', [/__KB_MODELS__/.test(ui[1]), /__KB_LOCAL__/.test(ui[1])], [true, true])

console.log(fails === 0 ? '\nall checks passed' : '\n' + fails + ' check(s) FAILED')
process.exit(fails === 0 ? 0 : 1)

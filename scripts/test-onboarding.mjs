// Test of the first-run wizard's pure core: the shipped texts (4 languages), the language
// choice, the step plan, the theme probe and the K artwork. It runs the block marked
// KB-OB-CORE of packages/kybernos-plugin/client.js as-is (the client is one bundle with no
// relative imports, hence the extraction, same as test-brand.mjs), then reads the UI block as
// text to check that every text it asks for exists.
// Usage: node scripts/test-onboarding.mjs   (exit 0 = everything passes)
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { loadPacks } from '../packages/kybernos-plugin/domain-pack.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const src = readFileSync(root + 'packages/kybernos-plugin/client.js', 'utf8')
const brand = src.match(/\/\/ KB-BRAND-CORE-BEGIN([\s\S]*?)\/\/ KB-BRAND-CORE-END/)
const core = src.match(/\/\/ KB-OB-CORE-BEGIN([\s\S]*?)\/\/ KB-OB-CORE-END/)
const ui = src.match(/\/\/ KB-OB-UI-BEGIN([\s\S]*?)\/\/ KB-OB-UI-END/)
if (core === null || ui === null) { console.error('BLOCKS KB-OB-CORE / KB-OB-UI NOT FOUND in packages/kybernos-plugin/client.js'); process.exit(1) }
const names = 'KB_OB_LANGS, KB_OB_MODES, KB_OB_PROVIDERS, KB_OB_T, kbObPickLang, kbObText, kbObPlan, kbObStepOf, kbObBack, kbObBackOf, kbObEscape, kbObIsDark, kbObKeyShape, kbObProviderFromKey, kbObNeedModel, kbObNoModel, kbObPackText, kbObPackOf, kbObGoalsOf, kbObKitOf, kbObMenuOverlay, kbObFold, kbObDomainFromText, kbObMix, kbObCronLabel, KB_OB_ROWS, kbObPreviewOf, kbObAutoMade, kbObKitDefaults, kbObMemoryText, kbObSkillText, kbObSetupRows, KB_OB_PRESETS, kbObModeOf, kbObAgentsOf, KB_OB_HOME_TILE, kbObTileOrder, kbObTileSort, kbObFieldSkills, kbObFieldConnectors'
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
eq('the twelve profession texts are gone: the fields of work come from the domain packs', Object.keys(mod.KB_OB_T).filter((k) => /^p\./.test(k)), [])
eq('a title for every display mode (the recap and the memory line name it; the kit step no longer asks for it)', mod.KB_OB_MODES.filter((m) => mod.KB_OB_T['mode.' + m + '.t'] === undefined), [])
eq('the display mode ids are the ones the previous wizard stored', mod.KB_OB_MODES, ['code', 'bureau'])
eq('every message of the key form has a text', ['format', 'invalid', 'denied', 'unreach', 'fail'].filter((k) => mod.KB_OB_T['key.err.' + k] === undefined), [])
eq('every refusal of an installation has a text', ['noengine', 'busy', 'failed', 'connect'].filter((k) => mod.KB_OB_T['loc.err.' + k] === undefined), [])
eq('expired and refused pairings each have a title and a text', ['expired', 'denied'].filter((k) => mod.KB_OB_T['err.' + k + '.t'] === undefined || mod.KB_OB_T['err.' + k + '.s'] === undefined), [])
const asked = new Set()
// Only whole keys: the families built by concatenation ('mode.' + id + '.t', 'err.' + kind + '.s') are checked above.
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
eq('six numbered steps, one question each (field, goals, model, about you, agents, kit), the model step among them whatever already works', mod.kbObPlan(), ['job', 'goals', 'model', 'about', 'agents', 'kit'])
eq('with no domain pack to choose from there is no field and no goals to ask: four steps, the model step still there', [mod.kbObPlan(false), mod.kbObPlan(true)], [['model', 'about', 'agents', 'kit'], ['job', 'goals', 'model', 'about', 'agents', 'kit']])
eq('screens of the model step share one number', ['model', 'key', 'key-done', 'local', 'local-install', 'local-done', 'local-err', 'free', 'cloud-wait', 'cloud-ok', 'cloud-err'].map((s) => mod.kbObStepOf(s)), Array(11).fill('model'))
eq('the kit, the goals, « about you » and the agents are their own steps', ['kit', 'goals', 'about', 'agents'].map((x) => mod.kbObStepOf(x)), ['kit', 'goals', 'about', 'agents'])
eq('welcome, the plan (the last thing asked) and the end screen have no number', ['welcome', 'plan', 'done'].map((x) => mod.kbObStepOf(x)), [null, null, null])
eq('the display mode is no longer a screen', [mod.kbObStepOf('mode'), mod.kbObBack('mode'), mod.kbObPlan().indexOf('mode')], [null, null, -1])
eq('back goes one screen up', ['job', 'goals', 'model', 'about', 'agents', 'kit', 'plan', 'key', 'local', 'local-err', 'cloud-wait', 'cloud-err'].map((s) => mod.kbObBack(s)), ['welcome', 'job', 'goals', 'model', 'about', 'agents', 'kit', 'model', 'model', 'local', 'model', 'model'])
eq('the removed screens (the separate account offer, the « later » page) lead nowhere', [mod.kbObBack('offer'), mod.kbObStepOf('offer'), mod.kbObStepOf('later')], [null, null, null])
eq('there is no back from welcome, from the end, mid-download, or once something is connected',
  ['welcome', 'done', 'cloud-ok', 'key-done', 'local-install', 'local-done'].map((s) => mod.kbObBack(s)), Array(6).fill(null))
/* Escape (A6-03): on a first run it never ends the wizard (leaving records « later » for good) */
const first = (screen, extra) => ({ screen, standalone: false, menu: false, fromAccount: false, ...extra })
const alone = (screen, extra) => ({ screen, standalone: true, menu: false, fromAccount: false, ...extra })
eq('first run: Escape on the welcome screen does nothing (there is nowhere back, and leaving is « Skip »)', mod.kbObEscape(first('welcome')), 'none')
eq('first run: Escape steps back where « Back » exists', ['job', 'goals', 'model', 'about', 'agents', 'kit', 'plan', 'key', 'local', 'cloud-wait'].map((s) => mod.kbObEscape(first(s, { domain: 'edu', packs: [{}] }))), Array(10).fill('back'))
eq('first run: nowhere to go back to (end, mid-download, connected) means nothing happens, never a close', ['done', 'cloud-ok', 'key-done', 'local-install', 'local-done'].map((s) => mod.kbObEscape(first(s))), Array(5).fill('none'))
eq('first run: the free step that came right after an account has no back, so Escape does nothing there', mod.kbObEscape(first('free', { fromAccount: true })), 'none')
eq('first run: an open language menu is closed first, on any screen', ['welcome', 'job', 'model'].map((s) => mod.kbObEscape(first(s, { menu: true }))), Array(3).fill('menu'))
eq('opened on its own (replay, the chat card, the kit), nothing is recorded: Escape closes it', ['model', 'kit', 'key', 'local'].map((s) => mod.kbObEscape(alone(s))), Array(4).fill('close'))
eq('opened on its own, the menu still goes first', mod.kbObEscape(alone('model', { menu: true })), 'menu')
eq('without a field the goals step is skipped, so « Back » from the model goes to the field (or to the welcome when there is nothing to choose)',
  [mod.kbObBackOf(first('model', { domain: null, packs: [{}] })), mod.kbObBackOf(first('model', { domain: null, packs: [] })), mod.kbObBackOf(first('model', { domain: 'edu', packs: [{}] }))], ['job', 'welcome', 'goals'])
eq('the Back button and Escape share one rule: no back from the model or kit step when opened alone', ['model', 'kit'].map((s) => mod.kbObBackOf(alone(s))), [null, null])
eq('every string of the model question exists in the four languages', ['m.t', 'm.s', 'm.k', 'm.rec', 'm.kd', 'm.o', 'm.od', 'm.other', 'm.local', 'm.free', 'm.conn', 'm.later', 'm.keep'].map((k) => (Array.isArray(mod.KB_OB_T[k]) && mod.KB_OB_T[k].length === 4 && mod.KB_OB_T[k].every((v) => typeof v === 'string' && v.length > 0))), Array(13).fill(true))
eq('the removed texts are gone from the dictionary', Object.keys(mod.KB_OB_T).filter((k) => /^(offer\.|v\.(cloud|key|free)|brain\.)/.test(k)), [])

/* ── 5a. The starter kit ─────────────────────────────────────────────────── */
const marketIds = [...src.slice(src.indexOf('const KB_MARKET_TEAMS = ['), src.indexOf('// Manifest read-only')).matchAll(/^        id: '([a-z0-9-]+)', name:/gm)].map((m) => m[1])
eq('the marketplace of the bundle holds the teams the packs point at', marketIds.sort(), ['inbound-closer', 'research-desk', 'studencik'])
const packs = loadPacks(root + 'packages/kybernos-plugin/domains').packs
const pack = (id) => mod.kbObPackOf(packs, id)
const edu = pack('edu')
eq('a field of work is found by its id, anything else is null', [pack('edu').id, mod.kbObPackOf(packs, 'nope'), mod.kbObPackOf(null, 'edu'), mod.kbObPackOf(packs, 7)], ['edu', null, null, null])
eq('a pack text reads in its language, else in English, else nothing', [mod.kbObPackText('fr', edu.name), mod.kbObPackText('es', edu.name), mod.kbObPackText('en', { en: 'x' }), mod.kbObPackText('fr', null), mod.kbObPackText('en', { fr: 'seulement' })], ['Éducation', 'Education', 'x', '', ''])
const names2 = (kit) => [kit.skills.map((x) => x.name), kit.teams]
eq('the kit of some goals is their skills and teams, each once, in the pack\'s order (not the order they were ticked)',
  names2(mod.kbObKitOf(edu, ['courses', 'exams'])), [['study-plan', 'flashcards', 'pdf', 'docx', 'quiz-builder'], ['studencik', 'research-desk']])
eq('a goal listed twice, or one the pack does not know, changes nothing', names2(mod.kbObKitOf(edu, ['exams', 'exams', 'nope'])), [['study-plan', 'flashcards'], ['studencik']])
eq('no goal, no pack or no list: an empty kit', [mod.kbObKitOf(edu, []), mod.kbObKitOf(null, ['exams']), mod.kbObKitOf(edu, null), mod.kbObKitOf(edu, 'exams')], Array(4).fill({ skills: [], teams: [], autos: [], soon: [], learn: null }))
eq('what is planned is listed once, whichever goals ask for it', mod.kbObKitOf(pack('sante'), ['notes', 'notes']).soon.map((x) => x.en), ['Cabinet Assistant team'])
eq('the automations of the ticked goals come with the kit, each once, in the pack\'s order', mod.kbObKitOf(pack('sante'), ['appointments', 'notes', 'appointments']).autos.map((x) => x.id), ['day-reports', 'tomorrow-reminders'])
eq('a skill the plugin ships is in the kit like any other, with the source that routes it to the plugin', mod.kbObKitOf(pack('sante'), ['notes']).skills.map((x) => x.source + ' ' + x.name), ['anthropics/skills pdf', 'anthropics/skills docx', 'kybernos consult-notes'])
eq('a skill of a kit carries what the install route needs: a GitHub source, a name, a text per language',
  packs.flatMap((p) => mod.kbObKitOf(p, p.goals.map((g) => g.id)).skills).filter((x) => !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(x.name) || !/^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(x.source) && x.source !== 'kybernos' || mod.kbObPackText('en', x.d) === '' || typeof x.d.fr !== 'string').length, 0)
const kit = mod.kbObKitOf(edu, ['exams', 'courses'])
eq('everything is ticked on a first run, the automations included', mod.kbObKitDefaults(kit, { skills: [], teams: [], autos: [] }), ['s:study-plan', 's:flashcards', 's:pdf', 's:docx', 's:quiz-builder', 't:studencik', 't:research-desk', 'a:revision-plan', 'a:learn-my-business'])
eq('what is installed is not ticked again (a replay doubles nothing), an automation already made is found by its name in any language the pack writes it in',
  [mod.kbObKitDefaults(kit, { skills: ['pdf', 'flashcards'], teams: ['studencik'], autos: ['Mettre à jour mon plan de révision'] }), mod.kbObKitDefaults(kit, { skills: ['pdf'], teams: [], autos: ['refresh my revision PLAN'] }).includes('a:revision-plan')],
  [['s:study-plan', 's:docx', 's:quiz-builder', 't:research-desk', 'a:learn-my-business'], false])
eq('a probe that failed leaves everything ticked', [mod.kbObKitDefaults(kit, null), mod.kbObKitDefaults(kit, {})].map((k) => k.length), [9, 9])
// « Learn my business »: offered with every field once a goal is ticked, never one of the pack's own automations (those are created switched off)
eq('Learn my business is offered once a goal is ticked, and only then', [mod.kbObKitOf(edu, ['exams']).learn, mod.kbObKitOf(edu, []).learn, mod.kbObKitOf(null, ['exams']).learn], [{ id: 'learn-my-business', sensitive: false }, null, null])
eq('...it is not counted among the pack\'s own automations', mod.kbObKitOf(edu, ['exams']).autos.some((a) => a.id === 'learn-my-business'), false)
eq('Law and Health are the sensitive fields (their mail is never read)', ['droit', 'sante', 'immo', 'edu'].map((id) => { const pk = pack(id); return pk === null ? null : mod.kbObKitOf(pk, [pk.goals[0].id]).learn.sensitive }), [true, true, false, false])
eq('once it exists (in either language) it is not ticked again', [mod.kbObKitDefaults(kit, { skills: [], teams: [], autos: ['Apprendre mon métier'] }).includes('a:learn-my-business'), mod.kbObKitDefaults(kit, { skills: [], teams: [], autos: ['learn my BUSINESS'] }).includes('a:learn-my-business')], [false, false])
eq('Learn my business is offered with only an own goal (no pack goal ticked), never without any goal', [mod.kbObKitOf(edu, [], true).learn, mod.kbObKitOf(edu, [], false).learn, mod.kbObKitOf(edu, [], undefined).learn, mod.kbObKitOf(null, [], true).learn], [{ id: 'learn-my-business', sensitive: false }, null, null, null])
eq('...and the kit of an own goal alone holds nothing else', (() => { const k = mod.kbObKitOf(edu, [], true); return [k.skills.length, k.teams.length, k.autos.length] })(), [0, 0, 0])
eq('the memory line names the goals of the pack and the ones the person wrote', mod.kbObMemoryText('en', 'Education', ['Exams', 'Prepare my thesis defence'], 'bureau', null), 'Field of work: Education. Wants help with: Exams, Prepare my thesis defence. Prefers: Office mode.')
eq('the preview miniature does not list it among the automations', mod.kbObPreviewOf(edu, ['exams'], 'en', mod.KB_OB_ROWS.map((r) => ({ id: r[0], label: r[0] }))).autos.includes('Learn my business'), false)
eq('a skill reads in French, other languages read English', [mod.kbObSkillText('fr', kit.skills[0]), mod.kbObSkillText('es', kit.skills[0]), mod.kbObSkillText('ar', kit.skills[0])], ['Planifie les sessions de révision jusqu’à l’examen', 'Plan revision sessions up to the exam', 'Plan revision sessions up to the exam'])
const strings = ['k.t', 'k.t0', 'k.s', 'k.skills', 'k.teams', 'k.src', 'k.add', 'k.none', 'k.skip', 'k.done', 'k.soon', 'k.note', 'k.busy', 'k.err', 'k.empty', 'k.pick', 'k.menu', 'k.autos', 'k.autos.note', 'k.learn.t', 'k.learn.d', 'k.learn.d.s', 'k.learn.better', 'k.learn.chip', 'k.learn.note', 'k.sum.learn', 'k.src.kb', 'adds.sk', 'adds.sk1', 'adds.au', 'adds.au1', 'adds.tm', 'pv.live', 'pv.hello', 'pv.new', 'pv.team', 'pv.noteam', 'pv.autos', 'pv.off', 'pv.skills', 'pv.compose', 'pv.you', 'pv.sub0', 'pv.sub', 'pv.sub1', 'pv.cap.job', 'pv.cap.goals', 'pv.cap.other', 'fin.kit', 'fin.kit.n', 'fin.mem', 'fin.mem.d', 'fin.job', 'fin.goals', 'mem.job', 'mem.goals', 'mem.mode', 'job.t', 'job.s', 'goals.t', 'goals.s', 'goals.pick', 'k.sum', 'k.sum.open', 'k.sum.close', 'fin.agents', 'mem.site', 'mem.profile', 'mem.words', 'mem.agents.prudent', 'mem.agents.balanced', 'mem.agents.auto']
eq('every string of the field, goals and kit steps exists in the four languages', strings.map((k) => (Array.isArray(mod.KB_OB_T[k]) && mod.KB_OB_T[k].length === 4 && mod.KB_OB_T[k].every((v) => typeof v === 'string' && v.length > 0))), Array(strings.length).fill(true))
eq('the memory sentence names the field, the goals and the display mode, in the wizard\'s language',
  [mod.kbObMemoryText('en', 'Health', ['Notes', 'Appointments'], 'bureau'), mod.kbObMemoryText('fr', 'Santé', ['Comptes rendus'], 'code')],
  ['Field of work: Health. Wants help with: Notes, Appointments. Prefers: Office mode.', 'Domaine : Santé. Veut de l’aide pour : Comptes rendus. Préfère : Mode Code.'])
eq('with only some of the three it says only that, with none it says nothing', [mod.kbObMemoryText('en', 'Law', [], null), mod.kbObMemoryText('en', null, ['Notes'], null), mod.kbObMemoryText('en', null, [], 'code'), mod.kbObMemoryText('en', null, null, null), mod.kbObMemoryText('en', '', [], 'nope')],
  ['Field of work: Law.', 'Wants help with: Notes.', 'Prefers: Coding mode.', null, null])

/* ── 5b'. Finding the field from a sentence, the colour, the schedule label ── */
eq('accents and capitals do not matter', [mod.kbObFold('Kiné À LYON'), mod.kbObFold(null)], ['kine a lyon', ''])
const field = (t) => mod.kbObDomainFromText(packs, t)
eq('a sentence finds its field, in French or English', [field('kiné en libéral à Lyon'), field('I am a lawyer in Paris'), field('agent immobilier, mandats et locataires'), field('prof de maths au lycée'), field('Comptable en cabinet'), field('community manager et SEO'), field('développeur backend')],
  ['sante', 'droit', 'immo', 'edu', 'fin', 'mkt', 'dev'])
eq('a keyword counts at the start of a word only', [field('luxe'), field('retail manager'), field('codex')], [null, 'com', 'dev'])
eq('nothing found, an empty sentence or no packs: no field', [field('xyzzy'), field(''), field(null), mod.kbObDomainFromText([], 'avocat'), mod.kbObDomainFromText(null, 'avocat')], Array(5).fill(null))
eq('a colour mixed with white or black stays a #rrggbb', [mod.kbObMix('#000000', '#ffffff', 0.5), mod.kbObMix('#1B7F76', '#ffffff', 0), mod.kbObMix('#1B7F76', '#ffffff', 1)], ['#808080', '#1b7f76', '#ffffff'])
eq('a schedule reads as words, in French too, and an odd one as itself',
  [mod.kbObCronLabel('en', '0 17 * * 5'), mod.kbObCronLabel('en', '30 18 * * 1-5'), mod.kbObCronLabel('fr', '0 8 * * 1'), mod.kbObCronLabel('fr', '30 8 * * 1-5'), mod.kbObCronLabel('en', '0 9 5 * *'), mod.kbObCronLabel('fr', '0 9 1 * *'), mod.kbObCronLabel('en', '0 8 * * *'), mod.kbObCronLabel('en', '*/5 * * * *'), mod.kbObCronLabel('en', null)],
  ['Every Friday at 17:00', 'Every weekday at 18:30', 'Chaque lundi à 8 h', 'Chaque jour de semaine à 8 h30', 'On day 5 of each month at 09:00', 'Le 1er de chaque mois à 9 h', 'Every day at 08:00', '*/5 * * * *', ''])
eq('every schedule of every pack reads as words', packs.flatMap((p) => p.goals.flatMap((g) => g.automations.map((a) => mod.kbObCronLabel('en', a.cron)))).filter((t) => !/^(Every|On day)/.test(t)), [])
eq('an automation already made is found by name, accents and capitals aside', [mod.kbObAutoMade(edu.goals[0].automations[0], ['Refresh my revision plan']), mod.kbObAutoMade(edu.goals[0].automations[0], ['METTRE à jour mon plan de revision']), mod.kbObAutoMade(edu.goals[0].automations[0], ['Other']), mod.kbObAutoMade(edu.goals[0].automations[0], null)], [true, true, false, false])
const rowsIn = mod.KB_OB_ROWS.map((r) => ({ id: r[0], label: r[0].toUpperCase() }))
const pvHealth = mod.kbObPreviewOf(pack('sante'), ['notes', 'appointments'], 'fr', rowsIn)
eq('the miniature of a field: its colour, its name, the menu in its words, the first questions, the skills, the automations',
  [pvHealth.accent, pvHealth.name, pvHealth.example, pvHealth.menu.find((r) => r.id === 'dashboards').label, pvHealth.menu.find((r) => r.id === 'kyber').label, pvHealth.menu.some((r) => r.id === 'documents'), pvHealth.starters.length, pvHealth.skills.includes('consult-notes'), pvHealth.autos.length, pvHealth.goalCount],
  ['#1B7F76', 'Santé', false, 'Mon activité', 'KYBER', false, 2, true, 2, 2])
eq('no goal ticked: an example made of the first two goals, flagged', [mod.kbObPreviewOf(pack('sante'), [], 'en', rowsIn).example, mod.kbObPreviewOf(pack('sante'), [], 'en', rowsIn).goalCount, mod.kbObPreviewOf(pack('sante'), [], 'en', rowsIn).skills.includes('pdf')], [true, 0, true])
eq('a language the pack does not write keeps the menu\'s own words, and no pack means no miniature', [mod.kbObPreviewOf(pack('sante'), ['notes'], 'es', rowsIn).menu.find((r) => r.id === 'dashboards').label, mod.kbObPreviewOf(null, [], 'en', rowsIn), mod.kbObPreviewOf(pack('dev'), ['review'], 'en', rowsIn).menu.length], ['DASHBOARDS', null, 9])
eq('the miniature suggests at most one team, three questions, seven skills and three automations', packs.every((p) => { const m = mod.kbObPreviewOf(p, p.goals.map((g) => g.id), 'en', rowsIn); return m.teams.length <= 1 && m.starters.length <= 3 && m.skills.length <= 7 && m.autos.length <= 3 }), true)
eq('the rows of the miniature are the rows of the menu', mod.KB_OB_ROWS.map((r) => r[0]), ['kyber', 'dashboards', 'aiteams', 'projects', 'deliverables', 'tasks', 'skills', 'connectors', 'documents'])

/* ── 5c. The menu wording a pack gives ───────────────────────────────────── */
const health = pack('sante')
eq('the labels come in the language of the page, never a mix: a language the pack does not write keeps the menu\'s own words',
  [mod.kbObMenuOverlay(health, 'fr').labels.dashboards, mod.kbObMenuOverlay(health, 'en').labels.dashboards, mod.kbObMenuOverlay(health, 'es').labels, mod.kbObMenuOverlay(health, 'ar').labels], ['Mon activité', 'My activity', {}, {}])
eq('a pack hides the rows it names', [mod.kbObMenuOverlay(health, 'en').hide, mod.kbObMenuOverlay(pack('dev'), 'en')], [['documents'], { labels: {}, hide: [] }])
eq('no pack, a pack without a menu or a pack with odd values: the menu is left as it is',
  [mod.kbObMenuOverlay(null, 'en'), mod.kbObMenuOverlay({}, 'en'), mod.kbObMenuOverlay({ menu: { labels: { dashboards: 3, aiteams: { en: 'Team' } }, hide: [1, 'documents'] } }, 'en')],
  [{ labels: {}, hide: [] }, { labels: {}, hide: [] }, { labels: { aiteams: 'Team' }, hide: ['documents'] }])

/* ── 5d. What a field puts forward on the pages ──────────────────────────── */
const law = pack('droit')
eq('the creation tiles a field wants first are its new-chat templates read as tiles, the rest have no tile',
  [mod.kbObTileOrder(law), mod.kbObTileOrder(pack('mkt')), mod.kbObTileOrder(pack('dev')), mod.kbObTileOrder(null), mod.kbObTileOrder({})], [['documents', 'spreadsheets'], ['slides', 'images', 'documents'], ['websites'], [], []])
eq('every template of a pack that has a tile maps to one of the Creations tiles', packs.every((p) => mod.kbObTileOrder(p).every((t) => ['slides', 'websites', 'documents', 'spreadsheets', 'images', 'av', 'miniapp'].indexOf(t) >= 0)), true)
const tileIds = ['slides', 'websites', 'documents', 'spreadsheets', 'images', 'av', 'miniapp'].map((id) => ({ id }))
eq('the tiles come in the field\'s order and the others keep theirs; the list is a new one',
  [mod.kbObTileSort(tileIds, ['documents', 'spreadsheets']).map((d) => d.id), mod.kbObTileSort(tileIds, []).map((d) => d.id), mod.kbObTileSort(tileIds, ['av', 'nope', 'slides']).map((d) => d.id), mod.kbObTileSort(tileIds, ['documents']) === tileIds],
  [['documents', 'spreadsheets', 'slides', 'websites', 'images', 'av', 'miniapp'], ['slides', 'websites', 'documents', 'spreadsheets', 'images', 'av', 'miniapp'], ['av', 'slides', 'websites', 'documents', 'spreadsheets', 'images', 'miniapp'], false])
const fs = mod.kbObFieldSkills(law, ['deadlines'], 'fr')
eq('the skills of a field: each once, the ticked goal\'s first, with the goal and the pack\'s text in the language',
  [fs[0].name, fs[0].goal, fs[0].ticked, fs[0].shipped, fs[0].d === 'Contrôle les délais de procédure et de prescription à partir de la date de départ.' || fs[0].d.length > 0, fs.filter((x) => x.ticked).length, new Set(fs.map((x) => x.name)).size === fs.length],
  ['deadline-check', 'Échéances', true, true, true, 1, true])
eq('no goal ticked: the field\'s skills in the pack\'s order, none flagged; a language the pack does not write reads English; at most eight',
  [mod.kbObFieldSkills(law, [], 'en').some((x) => x.ticked), mod.kbObFieldSkills(law, [], 'es')[0].goal, mod.kbObFieldSkills(law, null, 'en')[0].name, packs.every((p) => mod.kbObFieldSkills(p, [], 'en').length <= 8), mod.kbObFieldSkills(law, [], 'en', 2).length],
  [false, 'Contracts', 'review-contract', true, 2])
eq('the apps of a field: each once, the ticked goal\'s first, with the goal; at most eight; none for no pack',
  [mod.kbObFieldConnectors(law, ['deadlines'], 'en').slice(0, 2), new Set(mod.kbObFieldConnectors(law, [], 'en').map((x) => x.app)).size === mod.kbObFieldConnectors(law, [], 'en').length, packs.every((p) => { const l = mod.kbObFieldConnectors(p, [], 'en'); return l.length >= 1 && l.length <= 8 }), mod.kbObFieldConnectors(null, [], 'en'), mod.kbObFieldSkills(null, [], 'en')],
  [[{ app: 'googlecalendar', goal: 'Deadlines', ticked: true }, { app: 'outlook', goal: 'Deadlines', ticked: true }], true, true, [], []])
eq('an unknown goal id is ignored and a skill shared by two goals shows once under the first', [mod.kbObFieldSkills(law, ['nope'], 'en').some((x) => x.ticked), mod.kbObFieldSkills(law, ['drafting', 'contracts'], 'en').filter((x) => x.name === 'docx').length], [false, 1])

/* ── 5e. The new steps: « about you », the agents, the plan ──────────────── */
const newStrings = ['about.t', 'about.s', 'about.site', 'about.site.ph', 'about.site.h', 'about.soc', 'about.soc.ph', 'about.free', 'about.free.ph', 'about.pass', 'about.guess', 'about.guess.go', 'ag.t', 'ag.s', 'ag.prudent.t', 'ag.prudent.d', 'ag.balanced.t', 'ag.balanced.d', 'ag.auto.t', 'ag.auto.d', 'ag.prudent.l', 'ag.balanced.l', 'ag.auto.l', 'ag.for', 'ag.why', 'ag.note', 'ag.learn', 'plan.t', 'plan.s', 'plan.team.t', 'plan.team.b1', 'plan.team.b2', 'plan.team.b3', 'plan.team.go', 'plan.team.note', 'plan.free.t', 'plan.free.b1', 'plan.free.b2', 'plan.free.b3', 'plan.free.go']
eq('every string of the new steps exists in the four languages', newStrings.filter((k) => !(Array.isArray(mod.KB_OB_T[k]) && mod.KB_OB_T[k].length === 4 && mod.KB_OB_T[k].every((v) => typeof v === 'string' && v.length > 0))), [])
eq('the display mode screen\'s own texts are gone, its modes keep their names only (the row of the kit step is gone too)', [mod.KB_OB_T['mode.t'], mod.KB_OB_T['mode.s'], mod.KB_OB_T['mode.code.t'] !== undefined, mod.KB_OB_T['mode.bureau.d'], mod.KB_OB_T['mode.code.d']], [undefined, undefined, true, undefined, undefined])
eq('the sentence box is gone: its texts and its state are not left behind', [Object.keys(mod.KB_OB_T).filter((k) => /^job\.nl/.test(k)), /nlText|nlNote|kb-ob-nl/.test(ui[1] + src.slice(src.indexOf("'.kb-ob-main.kb-ob-split"), src.indexOf("'.kb-ob-chips{")))], [[], false])
eq('the three presets, the least autonomous first, and a text for each', [mod.KB_OB_PRESETS, mod.KB_OB_PRESETS.every((id) => ['ag.' + id + '.t', 'ag.' + id + '.d', 'ag.' + id + '.l', 'mem.agents.' + id].every((k) => mod.KB_OB_T[k] !== undefined))], [['prudent', 'balanced', 'auto'], true])
const dev = pack('dev')
eq('a field starts in its display mode and with its agents preset, with the reason it gives: Development codes and acts, Law and Health are careful, anything else is balanced',
  [mod.kbObModeOf(dev), mod.kbObModeOf(pack('droit')), mod.kbObAgentsOf(dev).preset, mod.kbObAgentsOf(pack('droit')).preset, mod.kbObAgentsOf(pack('sante')).preset, mod.kbObAgentsOf(pack('edu')).preset, mod.kbObPackText('fr', mod.kbObAgentsOf(pack('droit')).why).startsWith('Secret professionnel')],
  ['code', 'bureau', 'auto', 'prudent', 'prudent', 'balanced', true])
eq('no pack or a pack without the keys: office mode and balanced, no reason', [mod.kbObModeOf(null), mod.kbObAgentsOf(null), mod.kbObModeOf({}), mod.kbObAgentsOf({ agents: { preset: 'wild' } })], ['bureau', { preset: 'balanced', why: null }, 'bureau', { preset: 'balanced', why: null }])
eq('the memory sentence carries what the person said and how much the agents may do alone',
  [mod.kbObMemoryText('en', 'Law', ['Contracts'], 'bureau', { site: 'roux-avocat.example', profile: 'linkedin.com/in/claire-roux', words: 'Family law.', agents: 'prudent' })],
  ['Field of work: Law. Wants help with: Contracts. Prefers: Office mode. Website: roux-avocat.example. Profile: linkedin.com/in/claire-roux. In their own words: Family law. Agents: careful, they prepare drafts and never send without approval.'])
eq('empty answers and an unknown preset add nothing; the extra alone still makes a sentence', [mod.kbObMemoryText('en', 'Law', [], null, { site: '', profile: '', words: '', agents: 'wild' }), mod.kbObMemoryText('fr', null, [], null, { agents: 'auto' }), mod.kbObMemoryText('en', null, [], null, null)],
  ['Field of work: Law.', 'Agents : autonomes, ils agissent seuls et préviennent.', null])
eq('the wizard\'s steps in the UI: one screen each, the plan only with an account, the upgrade view opens once the wizard is closed',
  [/about: \(\) => \{/.test(ui[1]), /agents: \(\) => \{/.test(ui[1]), /plan: \(\) => \{/.test(ui[1]), /mode: \(\) => \{/.test(ui[1]), /const afterKit = \(\) => go\(S\.hasCloud \? 'plan' : 'done'\)/.test(ui[1]), /win\.__KB_UPGRADE__\.open\(\)/.test(ui[1]), /go\(S\.packs\.length > 0 \? 'job' : 'model'\)/.test(ui[1])],
  [true, true, true, false, true, true, true])
eq('the « about you » button does not read like the header\'s Skip, a replay shows the last answers, and an emptied answer is sent so it can be cleared',
  [mod.KB_OB_T['about.pass'][0] !== mod.KB_OB_T['skip'][0], /S\.aboutSaved = /.test(ui[1]), /S\.site\.trim\(\) !== '' \|\| S\.social\.trim\(\) !== '' \|\| S\.words\.trim\(\) !== '' \|\| S\.aboutSaved/.test(ui[1])], [true, true, true])
const tileClick = ui[1].slice(ui[1].indexOf("b.addEventListener('click', () => {\n          pickDomain(pk)"), ui[1].indexOf('const clearHover = () =>'))
eq('choosing a field takes its goals, display mode and agents preset but never moves on by itself: the tiles change in place, Continue waits for a choice',
  [/pickDomain\(pk\)/.test(tileClick), /syncTiles\(\)/.test(tileClick), /go\(|setTimeout|render\(/.test(tileClick), /S\.goals = pk\.goals\.slice\(0, 2\)/.test(ui[1]), /next\.disabled = S\.domain === null/.test(ui[1])], [true, true, false, true, true])
eq('a redraw of the same screen does not replay the entrance animation, and the preview follows the pointer only once it rests on a tile',
  [/if \(S\.drawn === S\.screen\) body\.classList\.add\('kb-ob-still'\)/.test(ui[1]), /\.kb-ob-step\.kb-ob-still\{animation:none\}/.test(src), /win\.setTimeout\(\(\) => \{ hoverTimer = null; S\.hover = pk\.id; refreshPreview\(\) \}, 120\)/.test(ui[1])], [true, true, true])
eq('the miniature starts level with the subtitle: the offset is the subtitle\'s position inside its own step (the step\'s slide-in moves both) and is set as the pane\'s top margin',
  [/const align = \(\) => \{/.test(ui[1]), /sub\.getBoundingClientRect\(\)\.top - step\.getBoundingClientRect\(\)\.top/.test(ui[1]), /pane\.style\.marginTop = /.test(ui[1]), /const fit = \(\) => \{[^\n]*align\(\) \}/.test(ui[1])], [true, true, true, true])
eq('the miniature\'s own text sits under it, never above', ui[1].indexOf("pane.appendChild(h('div', 'kb-ob-pv-box'))") < ui[1].indexOf('pane.appendChild(head)') && ui[1].indexOf('pane.appendChild(head)') < ui[1].indexOf("pane.appendChild(h('p', 'kb-ob-pv-cap'))"), true)
eq('what the person typed goes to the host only in the complete answer, with the agents preset, and only when there is something to say (or to clear)', [/agents: S\.agents, \.\.\.\(aboutBody\(\) !== null \? \{ about: aboutBody\(\) \} : \{\}\)/.test(ui[1])], [true])

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

/* ── 7b'. The card before any failure: the engine's catalog holds no model at all (AC-03, account campaign 2026-10-18) ──────────── */
// The picker says « No models available. » with nothing to do about it (the engine's own words): the dock says it in a person's words and offers the two ways forward.
// The shape is the engine's shared catalog snapshot (`ctx.modelDirectories.catalog.store`): { value: { groups: [{ id, models: [...] }] } | null, status }.
const noModel = mod.kbObNoModel
eq('nothing read, junk: no verdict (the card stays away)', [noModel(null), noModel(undefined), noModel('x'), noModel(7), noModel([]), noModel({})].every((v) => v === false), true)
eq('a catalog that has not loaded yet (no value): not « empty »', [noModel({ status: 'idle', value: null }), noModel({ status: 'loading', value: null }), noModel({ status: 'error', value: null, error: 'x' })].every((v) => v === false), true)
eq('a value that is not a list of groups: not « empty »', [noModel({ status: 'ready', value: {} }), noModel({ status: 'ready', value: { groups: 'none' } }), noModel({ status: 'ready', value: { groups: null } })].every((v) => v === false), true)
eq('loaded, no group at all: no model', noModel({ status: 'ready', value: { groups: [] } }), true)
eq('loaded, groups with no model (or a group that is not one): no model', noModel({ status: 'ready', value: { groups: [{ id: 'a', models: [] }, { id: 'b' }, null, 'c'] } }), true)
eq('one model in any group: there is a model', noModel({ status: 'ready', value: { groups: [{ id: 'a', models: [] }, { id: 'b', models: [{ id: 'm' }] }] } }), false)
eq('the verdict follows the last value even while the catalog reloads (no flicker when a credential changes)', [noModel({ status: 'loading', value: { groups: [] } }), noModel({ status: 'idle', value: { groups: [{ models: [{ id: 'm' }] }] } })], [true, false])
{
  const card = src.slice(src.indexOf('const KbNeedModel'), src.indexOf("ctx.effect(() => slots.inject('conversation.input.dock', () => slots.register(\n      { name: 'conversation.input.dock', id: 'kybernos-need-model'"))
  eq('the card reads the engine\'s own catalog and follows it (subscribe), through a guarded read', /ctx\.get\('modelDirectories'\)/.test(src) && /\.catalog\.store/.test(src) && /store\.subscribe\(/.test(card), true)
  eq('a failed turn that wants a key keeps its own card: the empty one is only for when there is no such failure', /need === null/.test(card) && /kbObNoModel\(/.test(card), true)
  eq('it says it is signed in or not from the account status, and offers the sign-in only to someone who is not', /fetch\('\/kybernos-cloud\/status'/.test(card) && /connected === true/.test(card), true)
  eq('« Sign in to Kybernos » opens the account sheet (the window event the Models page uses)', /new CustomEvent\('kybernos-cloud:open'\)/.test(card), true)
  eq('« Add a model » opens Settings on the AI provider and models page', /kbOpenSettingsPage\(\['kybernos-models'/.test(card), true)
  eq('it can be dismissed for the rest of the page (no nag on every chat)', /kbNoModelAway/.test(card), true)
  eq('and it carries a hook for the checks', /'data-kb': 'no-model'/.test(card), true)
  eq('the wizard\'s « open Settings » and the card\'s are ONE helper (the wizard had its own copy)', (src.match(/const kbOpenSettingsPage = /g) || []).length === 1 && /openSettings: \(names\) => kbOpenSettingsPage\(names\)/.test(src), true)
  for (const k of ['nm.none.t', 'nm.none.s', 'nm.none.s.in', 'nm.none.signin', 'nm.none.add']) eq('the text ' + k + ' exists in the four languages and says something in each', mod.KB_OB_T[k] !== undefined && mod.KB_OB_T[k].length === 4 && mod.KB_OB_T[k].every((t) => t.trim().length > 3), true)
  eq('the empty card says what to do in English, in plain words (sign in or add a model)', /sign in/i.test(mod.KB_OB_T['nm.none.s'][0]) && /add a model/i.test(mod.KB_OB_T['nm.none.s'][0]), true)
  eq('the buttons are named for what they do', [mod.KB_OB_T['nm.none.signin'][0], mod.KB_OB_T['nm.none.add'][0]], ['Sign in to Kybernos', 'Add a model'])
}

// R-A5-03: on a phone the card's cross is a 44 px target (it measured 24 x 36)
eq('on a phone the card\'s dismiss cross is 44 x 44', /@media \(max-width:700px\)\{\.kbnm-x\{top:0;inset-inline-end:0;width:44px;height:44px\}\.kbnm-t\{padding-inline-end:44px\}\}/.test(src), true)

eq('on a phone the card\'s buttons (sign in, add a model, save the key) are 44 px high', /@media \(max-width:700px\)\{\.kbnm-btn\{height:44px\}\}/.test(src), true)

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
    '/kybernos-memory/settings', '/kybernos-models/key/check', '/kybernos-sessions/settings', '/kybernos-skills/install', '/kybernos-skills/skills', '/kybernos-websearch/state', '/kybernos/composio/provider', '/kybernos/domain/skill', '/kybernos/domains', '/kybernos/model/auto', '/kybernos/tasks', '/modeles-locaux/annuler', '/modeles-locaux/installation', '/modeles-locaux/installer', '/modeles-locaux/machine'])
// The pages it hands over to are named by the id the Settings nav gives them (language-proof), and must be ids that nav knows.
const navKeys = src.match(/const KB_NAV_KEYS = \{([\s\S]*?)\n\}/)[1]
const known = new Set([...navKeys.matchAll(/(?:'([a-z0-9-]+)'|\b([a-z]+)):\s*'/g)].map((m) => m[1] || m[2]))
const handedTo = new Set([...ui[1].matchAll(/finish\(\[([^\]]+)\]\)/g)].flatMap((m) => [...m[1].matchAll(/'([a-z0-9-]+)'/g)].map((x) => x[1])))
eq('the wizard hands over to pages that exist in the Settings nav', [...handedTo].filter((k) => !known.has(k)), [])
eq('and to the three it needs', [...handedTo].sort(), ['kybernos-models', 'kybernos-ollama', 'models'])
eq('the two seams it reads are the ones the bundles publish', [/__KB_MODELS__/.test(ui[1]), /__KB_LOCAL__/.test(ui[1])], [true, true])

console.log(fails === 0 ? '\nall checks passed' : '\n' + fails + ' check(s) FAILED')
process.exit(fails === 0 ? 0 : 1)

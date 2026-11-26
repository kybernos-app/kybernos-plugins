#!/usr/bin/env node
// The refusals of the Auto routing settings (audit L1-06): the page worded three codes of the whitelist and showed THE HOST'S ENGLISH
// SENTENCE as it came for every other refusal — autoScope, autoRouting, autoFailover, autoClassifier and the three-sentence « settings.json
// is not a valid JSON object… » — in a French interface; and the « array of unique ids » refusal wore the code `liste`, which the page
// words as « too long or has a duplicate »: a sentence about another cause. The host keeps a CODE for every refusal of the route and an
// English sentence; the page owns the wording (refusTxt, in the language of the person).
//
// Two halves in one run: the REAL host routes on a temporary home (every refusal is provoked, none may come without a code), and the REAL
// client (client.js in a sandbox) given each of those answers, in French and in English.
//
//   node packages/kybernos-auto/test-refus.mjs
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { monterRoutes } from './index.js'
import { sessionSource } from './session-guard.mjs'
import { SESSION_SECRET, browserHeaders } from './lib-session-test.mjs'

sessionSource.secret = () => SESSION_SECRET

let pass = 0
let fail = 0
const check = (name, ok, detail) => { if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail).slice(0, 300))) } }

// ── the host ──────────────────────────────────────────────────────────────────
const home = mkdtempSync(join(tmpdir(), 'kauto-refus-'))
const dossier = join(home, 'kybernos')
mkdirSync(dossier, { recursive: true })
const reglagesPath = join(dossier, 'settings.json')
const routes = {}
monterRoutes({ register: (r) => { routes[r.path] = r.handler } }, { home, reglagesPath, sessionsAutoPath: join(dossier, 'auto-sessions.json'), santePath: join(dossier, 'auto-health.json'), ollama: 'http://127.0.0.1:1' })

const post = async (path, corps) => {
  const body = JSON.stringify(corps)
  const req = { method: 'POST', url: path, headers: browserHeaders(), socket: { localPort: 3080 }, on (ev, cb) { if (ev === 'data') cb(body); if (ev === 'end') cb() } }
  let status = 0
  let out = null
  await routes[path](req, { writeHead (s) { status = s }, end (t) { out = JSON.parse(t) } })
  return { status, ...out }
}

console.log('\n── the host: every refusal of /kybernos-auto/settings has a code ──')
const BIEN = (n) => Array.from({ length: n }, (_, i) => 'prov/model-' + i)
const CAS = [
  ['autoScope: not one of the three', { autoScope: 'tout' }, 'scope'],
  ['autoRouting: not a boolean', { autoRouting: 'oui' }, 'routage'],
  ['autoFailover: not a boolean', { autoFailover: 1 }, 'failover'],
  ['autoClassifier: not a string', { autoClassifier: 5 }, 'classifieur'],
  ['autoClassifier: more than 200 characters', { autoClassifier: 'x'.repeat(201) }, 'classifieur'],
  ['autoWhitelist: not an array', { autoWhitelist: 'prov/model' }, 'liste-type'],
  ['autoWhitelist: an entry that is not a string', { autoWhitelist: ['prov/model', 3] }, 'liste-type'],
  ['autoWhitelist: an entry longer than 200 characters', { autoWhitelist: ['p/' + 'm'.repeat(200)] }, 'liste-type'],
  ['autoWhitelist: 65 entries', { autoWhitelist: BIEN(65) }, 'liste'],
  ['autoWhitelist: a duplicate', { autoWhitelist: ['prov/a', 'prov/a'] }, 'liste'],
  ['autoWhitelist: an entry that is not a provider/model name', { autoWhitelist: ['model-only'] }, 'liste-forme']
]
const vus = new Map() // code -> the real answer of the host
for (const [nom, corps, code] of CAS) {
  const r = await post('/kybernos-auto/settings', corps)
  check(nom + ' → 400, code « ' + code + ' », an English sentence', r.status === 400 && r.ok === false && r.code === code && /^[\x20-\x7e“”]+$/.test(String(r.erreur)), r)
  if (!vus.has(r.code || 'no-code')) vus.set(r.code || 'no-code', r)
}

// settings.json: not a JSON object (the three-sentence refusal), then a folder that cannot be written.
writeFileSync(reglagesPath, '{ "pairingToken": "pt-secret", "autoWhitelist": ')
let r = await post('/kybernos-auto/settings', { autoRouting: true })
check('a settings.json that is not a JSON object → 500, code « settings-illisible », the English sentence kept', r.status === 500 && r.code === 'settings-illisible' && /nothing was saved/.test(r.erreur), r)
vus.set('settings-illisible', r)
writeFileSync(reglagesPath, JSON.stringify({ pairingToken: 'pt-secret' }))
if (typeof process.getuid === 'function' && process.getuid() === 0) {
  console.log('SKIPPED: the write-failure refusal of /settings (running as root: a read-only folder still lets root write)')
} else {
  chmodSync(dossier, 0o500)
  try { r = await post('/kybernos-auto/settings', { autoRouting: true }) } finally { chmodSync(dossier, 0o700) }
  check('a folder that cannot be written → 500, code « ecriture », the system\'s reason kept', r.status === 500 && r.code === 'ecriture' && typeof r.erreur === 'string' && r.erreur !== '', r)
  vus.set('ecriture', r)
}
r = await post('/kybernos-auto/probe', {})
check('« Check now » with no model service → 503, code « llm-indisponible »', r.status === 503 && r.code === 'llm-indisponible', r)
vus.set('llm-indisponible', r)

// ── the client ────────────────────────────────────────────────────────────────
console.log('\n── the page: each of those answers is worded in the language of the person ──')
const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'client.js'), 'utf8')
const noop = () => {}
const fakeEl = () => ({ dataset: {}, style: {}, remove: noop, append: noop, appendChild: noop, setAttribute: noop, addEventListener: noop, querySelector: () => null, querySelectorAll: () => [], classList: { add: noop, remove: noop, toggle: noop, contains: () => false } })
const walk = (node, hit, out = []) => {
  if (node === null || typeof node !== 'object') return out
  if (Array.isArray(node)) { for (const c of node) walk(c, hit, out); return out }
  if (hit(node)) out.push(node)
  for (const c of [].concat(node.children || [])) walk(c, hit, out)
  return out
}
// The hook that holds a state, found by name in the source (a new hook above it does not break this).
const indexOf = (nom) => (src.slice(src.indexOf('const KbAutoSettings = () => {'), src.indexOf('const ' + nom + 'Pair')).match(/React\.useState\(/g) || []).length

/** Opens the Settings page in `lang`, presses `controle` (a data-kb) while the host answers `reponse`; gives what the page tells the person
 *  (`sortie`: the banner at the bottom, `msg`, or the line under the typed list, `refus`). */
async function dit (lang, controle, reponse, { geste = 'onClick', statut = 400, etat = {}, sortie = 'msg' } = {}) {
  let loaded = null
  const sandbox = {
    window: { __KB_LANG_RESOLVE__: () => lang, __ModuleLoader__: { load: (m) => { loaded = m } }, addEventListener: noop },
    document: { ...fakeEl(), createElement: fakeEl, head: fakeEl(), body: fakeEl(), documentElement: fakeEl(), readyState: 'complete' },
    localStorage: { getItem: () => null, setItem: noop },
    location: { hash: '' },
    setInterval: () => 0, clearInterval: noop, setTimeout: () => 0, clearTimeout: noop,
    fetch: async () => ({ status: statut, json: async () => reponse }),
    MutationObserver: class { observe () {} disconnect () {} },
    console
  }
  vm.createContext(sandbox)
  vm.runInContext(src, sandbox)
  const sets = []
  const iAvance = indexOf('avance')
  const over = { 0: { ok: true, global: false, whitelist: [], classifier: 'x/y', sessionOn: false, sante: [], total: 0, disponibles: 0, chaud: null, failover: { enabled: false, last: null }, sondeEnCours: false, plafond: 10, ttlSondeS: 60, checkedAt: 1792163152877, intervalS: 60, ...etat }, [iAvance]: true }
  let n = 0
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useState: (v) => { const i = n; n += 1; return [i in over ? over[i] : v, (x) => { sets.push([i, x]) }] },
    useEffect: noop
  }
  const plugin = loaded.factory((name) => (name === 'react' ? React : null))
  let reg = null
  try {
    plugin.apply({ slots: { inject: (name, fn) => { if (name === 'settings.section') reg = fn(); return noop }, register: (meta, render) => ({ meta, render }) }, effect: (fn) => fn() })
  } catch (e) { /* the composer part of apply needs a real DOM: the settings section is registered before it */ }
  const page = reg.render().type()
  const cible = walk(page, (nd) => nd.props && nd.props['data-kb'] === controle)[0]
  if (cible === undefined) return null
  cible.props[geste]()
  for (let k = 0; k < 6; k += 1) await new Promise((res) => setImmediate(res))
  const iSortie = indexOf(sortie)
  const dernier = sets.filter(([i, x]) => i === iSortie && x !== '').pop()
  return dernier === undefined ? null : dernier[1]
}

// The controls that send a refusal to the banner: the choice of models, the two switches, the classifier field, « Check now ».
const VIA = { scope: 'auto-scope-free', routage: 'auto-global-toggle', failover: 'auto-failover-toggle', classifieur: 'auto-classifier-input', 'llm-indisponible': 'auto-health-recheck' }
for (const [code, rep] of vus) {
  const controle = VIA[code] || 'auto-scope-free'
  const geste = code === 'classifieur' ? 'onBlur' : 'onClick'
  const statut = rep.status
  const fr = await dit('kybernos', controle, rep, { geste, statut })
  const en = await dit('en', controle, rep, { geste, statut })
  // The `liste*` codes are worded under the typed list (the line under the chips), not in the banner: checked right after.
  if (code.startsWith('liste')) continue
  check('« ' + code + ' » (' + controle + '): the banner tells the person something in French, not the host\'s English', typeof fr === 'string' && fr !== '' && fr !== rep.erreur, fr)
  check('« ' + code + ' »: ...and something in English, and the two differ', typeof en === 'string' && en !== '' && en !== fr, [en, fr])
}

// The typed list says its refusal under its own field, through the same wording; `liste-type` (the shape) and `liste` (the count, a duplicate)
// are two causes and read as two sentences.
{
  const sousLaListe = async (lang, code) => (vus.has(code) ? dit(lang, 'auto-whitelist-remove', vus.get(code), { sortie: 'refus', etat: { scope: 'custom', whitelist: ['prov/a'], explicite: ['prov/a'] } }) : null)
  const texte = {}
  for (const code of ['liste', 'liste-type', 'liste-forme']) {
    texte[code] = { fr: await sousLaListe('kybernos', code), en: await sousLaListe('en', code) }
    check('under the typed list, « ' + code + ' » is worded in French and in English (not the host\'s English)', typeof texte[code].fr === 'string' && vus.has(code) && texte[code].fr !== vus.get(code).erreur && typeof texte[code].en === 'string' && texte[code].fr !== texte[code].en, texte[code])
  }
  check('...« liste-type » (an array of strings was expected) does not say « too long or a duplicate »', typeof texte['liste-type'].fr === 'string' && !/trop longue|doublon/.test(texte['liste-type'].fr) && !/too long|duplicate/.test(texte['liste-type'].en), texte['liste-type'])
  check('...and « liste » (65 entries, a duplicate) does', /trop longue|doublon/.test(String(texte.liste.fr)) && /too long|duplicate/.test(String(texte.liste.en)), texte.liste)
}
const sans = await dit('kybernos', 'auto-scope-free', { ok: false }, { statut: 401 })
check('a refusal with no code and no sentence (the session guard answers { error }) is « Refusé. », not an English « Rejected. »', sans === 'Refusé.', sans)
const sansEn = await dit('en', 'auto-scope-free', { ok: false }, { statut: 401 })
check('...and « Rejected. » in English', sansEn === 'Rejected.', sansEn)
const inconnu = await dit('kybernos', 'auto-scope-free', { ok: false, code: 'futur', erreur: 'a newer host sentence' })
check('a code this page does not know (a newer host) keeps the host\'s own sentence rather than saying nothing', inconnu === 'a newer host sentence', inconnu)

console.log('\n' + pass + ' ✓  ' + fail + ' ✗')
process.exit(fail === 0 ? 0 : 1)

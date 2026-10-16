#!/usr/bin/env node
// The language of Auto routing (WP-07, D1; audit A2-22, A3-25): the page reads the language Kybernos resolved (French for « kybernos » and
// fr*, English for every other language and for nothing — it used to default to French when the resolver threw); a model that did not
// answer says so in the language of the page (the host keeps the code, the page owns the sentence, an older state on disk still holds the
// French one); the sentences the host hands out are English; the package description is English.
//
//   node packages/kybernos-auto/test-lang.mjs
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { classerIssue } from './sonde.mjs'

const here = (f) => fileURLToPath(new URL(f, import.meta.url))
const client = readFileSync(here('./client.js'), 'utf8')
const host = readFileSync(here('./index.js'), 'utf8')
let pass = 0
let fail = 0
const check = (name, ok, detail) => { if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) } }

const a = client.indexOf('    const lang = () => {')
const b = client.indexOf('    const heureTxt')
check('the helpers are delimited', a > 0 && b > a)
const make = (resolve) => new Function('window', client.slice(a, b) + '\nreturn { lang, kt, pourquoiTxt, causeTxt }')({ __KB_LANG_RESOLVE__: resolve })

console.log('\n── the language is the one Kybernos resolved ──')
const lang = (r) => make(r).lang()
check('en is English; « kybernos » and fr* are French', lang(() => 'en') === 'en' && lang(() => 'kybernos') === 'fr' && lang(() => 'fr-CA') === 'fr')
check('es, ar, zh are English (never French)', ['es', 'ar', 'zh', 'de'].every((l) => lang(() => l) === 'en'))
check('a resolver that throws, or none, is English (it used to be French)', lang(() => { throw new Error('not ready') }) === 'en' && lang(undefined) === 'en')

console.log('\n── why a model did not answer (A2-22) ──')
const en = make(() => 'en')
const fr = make(() => 'kybernos')
check('English: TIMEOUT and SANS-REPONSE read in English', en.pourquoiTxt({ code: 'TIMEOUT', message: 'x' }) === 'TIMEOUT — no answer within the time limit' && en.pourquoiTxt({ code: 'SANS-REPONSE', message: 'x' }) === 'SANS-REPONSE — the stream ended without a verdict')
check('French: the same, in French', fr.pourquoiTxt({ code: 'TIMEOUT', message: 'x' }) === 'TIMEOUT — aucune réponse dans le délai')
check('a state written before (the French sentence on disk) is shown in the language of the page, because the CODE decides', en.pourquoiTxt({ code: 'TIMEOUT', message: 'aucune réponse dans le délai' }) === 'TIMEOUT — no answer within the time limit')
check('any other error is the provider\'s own message', en.pourquoiTxt({ code: 'AUTH', message: 'Invalid API key' }) === 'AUTH — Invalid API key')
const out = classerIssue({ tropTard: true, cle: 'a/b', route: 'a', modele: 'b', ms: 8000 })
const mute = classerIssue({ finish: null, erreur: null, cle: 'a/b', route: 'a', modele: 'b', ms: 3 })
check('the host probe answers a code and an English sentence', out.code === 'TIMEOUT' && out.message === 'no answer within the time limit' && mute.code === 'SANS-REPONSE' && mute.message === 'the stream ended without a verdict', [out.message, mute.message])

console.log('\n── what the host hands out is English (A3-25) ──')
const FRENCH_ERRORS = ['tableau d identifiants', 'n est pas de la forme', 'n est pas un modèle configuré', 'booléen attendu', 'chaîne attendue', 'modele attendu', 'demande attendue', 'origine refusee', 'POST attendu', 'whitelist vide', 'classifieur en échec', 'auto off pour cette session', 'sessionId attendu']
check('no French error string is left in the host', FRENCH_ERRORS.every((x) => host.indexOf(x) < 0), FRENCH_ERRORS.filter((x) => host.indexOf(x) >= 0))
check('a refused whitelist entry still carries its code, for the page to word', /code: 'liste-' \+ refus\.code/.test(host) && /code: 'liste'/.test(host))
check('the page words those codes itself, beside the field', /code === 'liste-forme'/.test(client) && /code === 'liste-inconnu'/.test(client) && /code === 'liste'\)/.test(client))
const pkg = JSON.parse(readFileSync(here('./package.json'), 'utf8'))
check('the package description is English', /^Auto mode:/.test(pkg.description), pkg.description)

console.log('\n' + pass + ' ✓  ' + fail + ' ✗')
process.exit(fail === 0 ? 0 : 1)

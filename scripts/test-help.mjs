#!/usr/bin/env node
// The help of every plugin: packages/<dir>/help.json, the check that guards it, and the « ? How it works » buttons that
// read it. No browser, no DSH.
//
//   node scripts/test-help.mjs
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { catalogueDuDepot, validerAide } from './build-catalog.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
let pass = 0
let fail = 0
const check = (name, ok, detail) => { if (ok) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) } }
const throwsWith = (fn, re) => { try { fn(); return false } catch (e) { return re.test(String(e.message)) } }

const good = () => ({ what: { fr: 'Fait une chose utile.', en: 'Does a useful thing.' }, steps: [{ fr: 'Ouvrez la page.', en: 'Open the page.' }, { fr: 'Choisissez.', en: 'Pick one.' }], where: { fr: 'Réglages › Truc', en: 'Settings › Thing', page: true }, good: { fr: 'Rien ne part de la machine.', en: 'Nothing leaves the machine.' } })

console.log('the shape of a help.json')
check('a good one passes, and comes back with its fields only', (() => { const a = validerAide('x', good()); return a.steps.length === 2 && a.where.page === true && a.good.en === 'Nothing leaves the machine.' && Object.keys(a).sort().join() === 'good,steps,what,where' })())
check('« good » is optional', validerAide('x', (() => { const g = good(); delete g.good; return g })()).good === undefined)
check('an unknown field is refused (a typo would silently show nothing)', throwsWith(() => validerAide('x', { ...good(), tips: [] }), /unknown field "tips"/))
check('both languages are required, in every text', throwsWith(() => { const g = good(); g.what.en = ''; validerAide('x', g) }, /what\.en is empty/) && throwsWith(() => { const g = good(); delete g.steps[1].fr; validerAide('x', g) }, /steps\[1\]\.fr is empty/))
check('2 to 4 steps', throwsWith(() => { const g = good(); g.steps = [g.steps[0]]; validerAide('x', g) }, /2 to 4/) && throwsWith(() => { const g = good(); g.steps = Array(5).fill(g.steps[0]); validerAide('x', g) }, /2 to 4/))
check('the lengths are bounded (it has to fit a card)', throwsWith(() => { const g = good(); g.what.fr = 'x'.repeat(201); validerAide('x', g) }, /limit is 200/) && throwsWith(() => { const g = good(); g.steps[0].en = 'x'.repeat(141); validerAide('x', g) }, /limit is 140/))
check('where.page must be a boolean', throwsWith(() => { const g = good(); g.where.page = 'yes'; validerAide('x', g) }, /where\.page/))
check('a word the user does not know is refused', throwsWith(() => { const g = good(); g.steps[0].en = 'Register a slot.'; validerAide('x', g) }, /does not know \(slot\)/))
check('no emoji', throwsWith(() => { const g = good(); g.what.fr = 'Super 🎉'; validerAide('x', g) }, /emoji/))
check('the error names the bundle', throwsWith(() => validerAide('kybernos-zz', null), /"kybernos-zz"/))

console.log('the card of one page of a bundle (pages)')
const page = () => ({ title: { fr: 'Voix', en: 'Voice' }, ...good() })
check('a bundle can carry the card of one of its pages, and it comes back checked', (() => { const a = validerAide('x', { ...good(), pages: { voice: page() } }); return a.pages.voice.title.en === 'Voice' && a.pages.voice.steps.length === 2 && a.pages.voice.where.page === true })())
check('« pages » is optional', validerAide('x', good()).pages === undefined)
check('a page card needs a title in both languages', throwsWith(() => { const p = page(); delete p.title; validerAide('x', { ...good(), pages: { voice: p } }) }, /pages\.voice\.title must be/))
check('a page card is checked like the bundle’s own (a step count, a word, a length)', throwsWith(() => { const p = page(); p.steps = [p.steps[0]]; validerAide('x', { ...good(), pages: { voice: p } }) }, /pages\.voice\.steps must hold 2 to 4/) && throwsWith(() => { const p = page(); p.what.en = 'Register a slot.'; validerAide('x', { ...good(), pages: { voice: p } }) }, /does not know \(slot\)/))
check('a page card has no « pages » of its own, and no unknown field', throwsWith(() => validerAide('x', { ...good(), pages: { voice: { ...page(), pages: {} } } }), /pages\.voice: unknown field "pages"/) && throwsWith(() => validerAide('x', { ...good(), pages: { voice: { ...page(), tips: [] } } }), /unknown field "tips"/))
check('a page key is a short lower-case word', throwsWith(() => validerAide('x', { ...good(), pages: { 'Voice Page': page() } }), /pages key "Voice Page"/))

console.log('every bundle has one')
const lifecycle = JSON.parse(readFileSync(join(REPO, 'scripts', 'lifecycle-packages.json'), 'utf8')).packages
let catalogue = null
let cause = ''
try { catalogue = catalogueDuDepot() } catch (e) { cause = String(e.message) }
check('the catalogue builds: every bundle of the lifecycle list has a valid help.json', catalogue !== null, cause)
if (catalogue !== null) {
  check('the catalogue carries the help of every module', catalogue.modules.length === lifecycle.length && catalogue.modules.every((m) => m.aide !== undefined && m.aide.steps.length >= 2))
  const same = []
  for (const m of catalogue.modules) {
    const a = m.aide
    const texts = [a.what].concat(a.steps).concat(a.good ? [a.good] : [])
    // A French text equal to its English one was not translated (a short proper noun may be the same).
    for (const t of texts) if (t.fr === t.en && t.fr.length > 24) same.push(m.id + ': ' + t.fr.slice(0, 40))
  }
  check('no text is the same in French and in English (nobody translated it)', same.length === 0, same.slice(0, 4))
  const dup = catalogue.modules.filter((m) => new Set(m.aide.steps.map((s) => s.en)).size !== m.aide.steps.length).map((m) => m.id)
  check('no step is repeated', dup.length === 0, dup)
  const hollow = catalogue.modules.filter((m) => m.aide.steps.some((s) => s.en.trim().length < 12 || s.fr.trim().length < 12)).map((m) => m.id)
  check('no step is a stub', hollow.length === 0, hollow)
  const todo = catalogue.modules.filter((m) => JSON.stringify(m.aide).match(/TODO|TBD|lorem|XXX/i) !== null).map((m) => m.id)
  check('nothing says TODO', todo.length === 0, todo)
  // « where.page » promises a page the user can open: the bundle must register one.
  const surfaces = /settings\.section|sidebar\.right|plugins\.item|plugins\.bundle\.config|'main'|main\./
  const liar = catalogue.modules.filter((m) => m.aide.where.page === true && !(existsSync(join(REPO, 'packages', m.id, 'client.js')) && surfaces.test(readFileSync(join(REPO, 'packages', m.id, 'client.js'), 'utf8'))) && !(existsSync(join(REPO, 'packages', m.id, 'src', 'plugin.js')) && surfaces.test(readFileSync(join(REPO, 'packages', m.id, 'src', 'plugin.js'), 'utf8')))).map((m) => m.id)
  check('a help that says « it has a page » belongs to a bundle that registers one', liar.length === 0, liar)
  const core = catalogue.modules.find((m) => m.id === 'kybernos-plugin')
  check('the Voice page has its own card (it is a page of the core bundle, whose general help is about Agent Teams)', core !== undefined && core.aide.pages !== undefined && core.aide.pages.voice !== undefined && /voice/i.test(core.aide.pages.voice.title.en))
}

console.log('the « ? How it works » buttons')
{
  const dirs = readdirSync(join(REPO, 'packages'))
  const wrong = []
  const placed = []
  for (const d of dirs) {
    const f = join(REPO, 'packages', d, 'client.js')
    if (!existsSync(f)) continue
    const src = readFileSync(f, 'utf8')
    for (const m of src.matchAll(/window\.__KB_HELP__\.Help, \{ id: '([a-z0-9-]+)'/g)) { placed.push(d + '→' + m[1]); if (m[1] !== d) wrong.push(d + ' asks for ' + m[1]) }
    // every use is guarded: a plugin must not depend on the Suite being there
    for (const m of src.matchAll(/__KB_HELP__\.Help, \{ id: '[a-z0-9-]+'/g)) {
      const before = src.slice(Math.max(0, m.index - 140), m.index)
      if (!/window\.__KB_HELP__ && window\.__KB_HELP__\.Help \?/.test(before)) wrong.push(d + ': an unguarded use')
    }
  }
  check('a page asks for the help of its own bundle, and always behind a guard', wrong.length === 0, wrong)
  check('the pages that carry the button', ['kybernos-theme', 'kybernos-models', 'kybernos-slash', 'kybernos-workers', 'kybernos-maintenance', 'kybernos-modeles-locaux', 'kybernos-memory', 'kybernos-skills', 'kybernos-sessions', 'kybernos-hub', 'kybernos-mobile'].every((d) => placed.includes(d + '→' + d)), placed)
  const hub = readFileSync(join(REPO, 'packages', 'kybernos-hub', 'client.js'), 'utf8')
  check('the Suite publishes it (version 1) and shows the same help on a module’s page', /window\.__KB_HELP__ = construireAide\(React\)/.test(hub) && /return \{ version: 1, actions: true, Help \}/.test(hub) && /'data-kb': 'suite-aide'/.test(hub))
  check('the host keeps the shipped help when the online catalogue lacks it', /aides\.get\(m\.id\)/.test(readFileSync(join(REPO, 'packages', 'kybernos-hub', 'suite-host.mjs'), 'utf8')))
  check('a page card that is not there draws nothing (never the bundle’s help on the wrong page)', /const card = page === undefined \? null/.test(hub) && /if \(card === undefined\) return null/.test(hub))
  check('the host keeps the shipped page cards when the online catalogue lacks them', /livree\.pages !== undefined && m\.aide\.pages === undefined/.test(readFileSync(join(REPO, 'packages', 'kybernos-hub', 'suite-host.mjs'), 'utf8')))
  check('the Voice page asks for its own card', /Help, \{ id: 'kybernos-plugin', page: 'voice' \}/.test(readFileSync(join(REPO, 'packages', 'kybernos-plugin', 'client.js'), 'utf8')))
  const css = hub.match(/\.kbhp-[a-z]+/g) || []
  const clash = []
  for (const d of dirs) {
    if (d === 'kybernos-hub') continue
    const f = join(REPO, 'packages', d, 'client.js')
    if (existsSync(f) && /\.kbhp-/.test(readFileSync(f, 'utf8'))) clash.push(d)
  }
  check('the kbhp- class prefix is the hub’s alone', css.length > 5 && clash.length === 0, clash)
}

console.log('\n' + pass + ' ✓  ' + fail + ' ✗')
process.exit(fail === 0 ? 0 : 1)

#!/usr/bin/env node
// The rows a plugin adds to the sidebar (docs/dev/business-menu.md): the registry a plugin declares its row in (`window.__KB_MENU__`), cut out of
// client.js and run alone, and the places where the core reads it, checked at source level. The menu is fixed and the rows are drawn flat, right
// after Agent Teams: no group, no header. No browser; the drawn result is measured by scripts/check-menu-live.mjs.
//
//   node packages/kybernos-plugin/test-business-menu.mjs
import { readFileSync } from 'node:fs'

let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) }
}

const SRC = readFileSync(new URL('./client.js', import.meta.url), 'utf8')
const a = SRC.indexOf('// <kb-business-menu>')
const b = SRC.indexOf('// </kb-business-menu>', a)
if (a < 0 || b < a) { console.log('  ✗ cannot cut the business menu registry out of client.js'); process.exit(1) }
const BLOCK = SRC.slice(a, b)

/** A fresh registry on a fake window that remembers the events it was sent and the warnings. */
const fresh = () => {
  const events = []
  const warns = []
  const win = { dispatchEvent: (e) => { events.push(e.type) } }
  const fake = { warn: (m) => warns.push(String(m)) }
  const made = new Function('window', 'CustomEvent', 'console', BLOCK + '\nreturn { kbBizMenu, kbBizCheck, kbBizLabel, KB_BIZ_TAKEN, KB_BIZ_MAX }')(win, class { constructor (type) { this.type = type } }, fake)
  return Object.assign(made, { win, events, warns })
}
const row = (id, extra) => Object.assign({ id, group: 'business', icon: 'users', labelKey: 'business.' + id }, extra || {})

console.log('declaring a row')
{
  const m = fresh()
  check('the registry is the one on the window, versioned 1', m.win.__KB_MENU__ === m.kbBizMenu && m.kbBizMenu.v === 1)
  check('nothing declared: no row, no id', m.kbBizMenu.list().length === 0 && m.kbBizMenu.ids().length === 0 && m.kbBizMenu.has('contacts') === false)
  const off = m.kbBizMenu.register(row('contacts'))
  check('a row is declared and a function takes it back', typeof off === 'function' && m.kbBizMenu.has('contacts') && m.kbBizMenu.ids().join() === 'contacts')
  const r = m.kbBizMenu.list()[0]
  check('the row is kept as the menu needs it, frozen, with its defaults', Object.isFrozen(r) && r.group === 'business' && r.icon === 'users' && r.labelKey === 'business.contacts' && r.label === null && r.order === 100, r)
  check('the menu is told (an event for the page, a call for the listeners)', m.events.join() === 'kb-menu-change')
  off()
  check('taking it back removes it and tells the menu again', m.kbBizMenu.has('contacts') === false && m.events.join() === 'kb-menu-change,kb-menu-change')
  off()
  check('taking it back twice changes nothing and says nothing', m.events.length === 2 && m.kbBizMenu.list().length === 0)
}
{
  const m = fresh()
  m.kbBizMenu.register(row('pipeline', { order: 30 }))
  m.kbBizMenu.register(row('contacts', { order: 10 }))
  m.kbBizMenu.register(row('catalog', { order: 10 }))
  check('rows are in the order they ask for, then in the order they came', m.kbBizMenu.ids().join() === 'contacts,catalog,pipeline', m.kbBizMenu.ids())
  const seen = []
  const stop = m.kbBizMenu.subscribe(() => seen.push('a'))
  m.kbBizMenu.subscribe(() => { throw new Error('a listener that breaks') })
  m.kbBizMenu.subscribe(() => seen.push('c'))
  m.kbBizMenu.register(row('inbox'))
  check('a listener that throws does not stop the others', seen.join() === 'a,c', seen)
  stop()
  m.kbBizMenu.register(row('site'))
  check('a listener that left is not called', seen.join() === 'a,c,c', seen)
}

console.log('what is refused (nothing is drawn, and the reason is said)')
{
  const m = fresh()
  const refused = (name, entry, why) => {
    const before = m.kbBizMenu.ids().length
    const got = m.kbBizMenu.register(entry)
    const c = m.kbBizMenu.check(entry)
    check(name, got === null && m.kbBizMenu.ids().length === before && c.ok === false && c.errors.some((e) => why.test(e)), c.errors)
  }
  refused('not an object', 'contacts', /is an object/)
  refused('null', null, /is an object/)
  refused('a list', [row('x1')], /is an object/)
  refused('a key nobody knows', Object.assign(row('contacts'), { page: '/x' }), /unknown key "page"/)
  refused('another group', row('contacts', { group: 'sales' }), /only group/)
  refused('no group', { id: 'contacts', icon: 'users', labelKey: 'k' }, /only group/)
  refused('an id with capitals', row('Contacts'), /^id: 2 to 24/)
  refused('an id too short', row('c'), /^id: 2 to 24/)
  refused('an id with a slash', row('a/b'), /^id: 2 to 24/)
  refused('no id', { group: 'business', icon: 'users', labelKey: 'k' }, /^id: 2 to 24/)
  refused('no icon', { id: 'contacts', group: 'business', labelKey: 'k' }, /^icon:/)
  refused('an icon that is a sentence', row('contacts', { icon: 'a user' }), /^icon:/)
  refused('no words at all', { id: 'contacts', group: 'business', icon: 'users' }, /needs words/)
  refused('a labelKey with markup', row('contacts', { labelKey: '<b>x</b>' }), /^labelKey:/)
  refused('a label without English', row('contacts', { labelKey: undefined, label: { fr: 'Contacts' } }), /label\.en/)
  refused('a label in a language nobody has', row('contacts', { label: { en: 'Contacts', de: 'Kontakte' } }), /"de" is not a language/)
  refused('a label with markup', row('contacts', { label: { en: '<i>Contacts</i>' } }), /^label\.en:/)
  refused('a label too long', row('contacts', { label: { en: 'x'.repeat(41) } }), /^label\.en:/)
  refused('an order that is not a number', row('contacts', { order: '1' }), /^order:/)
  refused('an order out of range', row('contacts', { order: 5000 }), /^order:/)
  for (const taken of ['themes', 'dashboards', 'kyber', 'skills', 'documents']) refused('"' + taken + '" is a page of the core', row(taken), /is a page of the core/)
  m.kbBizMenu.register(row('contacts'))
  refused('an id that is already a row', row('contacts'), /already a row/)
  check('a refusal warns once, with the reasons (the plugin sees it in the console)', m.warns.length > 20 && m.warns.every((w) => /^\[kybernos\] menu row refused: /.test(w)))
  check('and sends no event: only the one declaration that was accepted', m.events.length === 1)
}
{
  const m = fresh()
  for (let i = 0; i < m.KB_BIZ_MAX; i++) check('row ' + (i + 1) + ' of ' + m.KB_BIZ_MAX + ' is accepted', m.kbBizMenu.register(row('row-' + i)) !== null)
  const c = m.kbBizMenu.check(row('one-more'))
  check('the next one is refused with the limit', c.ok === false && c.errors.some((e) => /at most 8 rows/.test(e)), c.errors)
}

console.log('the words of a row')
{
  const m = fresh()
  const dict = { 'business.contacts': 'Contacts (dictionary)' }
  const tr = (k) => (dict[k] !== undefined ? dict[k] : k)
  const own = m.kbBizCheck(row('contacts', { label: { en: 'People', fr: 'Personnes' } }), []).row
  check('its own words win for the language', m.kbBizLabel(own, tr, 'fr') === 'Personnes')
  check('a language it has no words for falls to the dictionary of its key', m.kbBizLabel(own, tr, 'es') === 'Contacts (dictionary)')
  const unknown = m.kbBizCheck(row('catalog', { label: { en: 'Catalog' } }), []).row
  check('a key the dictionary does not know falls to its English', m.kbBizLabel(unknown, tr, 'ar') === 'Catalog')
  const bare = m.kbBizCheck(row('pipeline'), []).row
  check('and with nothing else, to its id', m.kbBizLabel(bare, tr, 'en') === 'pipeline')
  check('a dictionary that throws does not stop the menu', m.kbBizLabel(own, () => { throw new Error('boom') }, 'es') === 'People')
}

console.log('where the core reads the registry (source level)')
{
  const count = (re) => (SRC.match(re) || []).length
  check('the keyed child is declared once, in the registration of `main`, next to the three single ones', count(/'main\.kybernos-business': \{ kind: 'keyed', scope: 'root' \}/g) === 1 && /key: 'kybers', children: \{ 'main\.kybernos-skills'[^}]*\}, 'main\.kybernos-dashboards'[^}]*\}, 'main\.kybernos-kyber'[^}]*\}, 'main\.kybernos-business': \{ kind: 'keyed'/.test(SRC))
  const menu = SRC.slice(SRC.indexOf('const SalesMenu = '), SRC.indexOf("slots.inject('sidebar.panellist'"))
  const at = (id) => menu.indexOf("row('" + id + "'")
  const order = ['dashboards', 'tasks', 'connectors', 'skills', 'aiteams'].map(at)
  check('the menu is fixed: Dashboards, Automations, Connectors, Skills, Agent Teams, the declared rows, then Creations', order.every((n) => n > 0) && order.every((n, k) => k === 0 || n > order[k - 1]) && count(/h\(KbMenuRows, \{ row, openPage, shown \}\)/g) === 1 && menu.indexOf('h(KbMenuRows') > order[4] && menu.indexOf('h(KbMenuRows') < at('deliverables') && at('deliverables') < menu.indexOf('h(KbProgressBar'), order)
  check('no Templates row and no group header any more', at('themes') < 0 && !/KbBusinessGroup|menu-business|toggle-business/.test(SRC))
  check('the pages the store can hold include the rows that are declared', /\.concat\(kbBizMenu\.ids\(\)\)/.test(SRC) && !/\.concat\(\['themes'\]\)/.test(SRC))
  const main = SRC.slice(SRC.indexOf('const KybersMain = '), SRC.indexOf('// ── colonne 1 : navigation Kybernos'))
  check('the page area opens a declared row on its view, after every page of the core, before the default', main.indexOf('kbBizMenu.has(s.view)') > main.indexOf("s.view === 'teaminfo'") && main.indexOf('kbBizMenu.has(s.view)') < main.indexOf('return h(KybersPanel, props)'))
  const coreViews = [...new Set([...main.matchAll(/s\.view === '([a-z]+)'/g)].map((m2) => m2[1]))]
  const fresh2 = fresh()
  check('every view the core draws is an id a business row cannot take (found ' + coreViews.length + ')', coreViews.length >= 10 && coreViews.every((v) => fresh2.KB_BIZ_TAKEN.indexOf(v) >= 0), coreViews.filter((v) => fresh2.KB_BIZ_TAKEN.indexOf(v) < 0))
  const mount = SRC.slice(SRC.indexOf('const KbBusinessMount = '), SRC.indexOf('const KbBusinessView = '))
  check('the page of a row is the slot entry with the row\'s key, or an honest empty line', /slots\.subscribe\('main\.kybernos-business'/.test(mount) && /slots\.entriesOfSlot\('main\.kybernos-business'\)/.test(mount) && /e\.options\.key === props\.id/.test(mount) && /kbt\('kbui\.business\.off'\)/.test(mount))
  const rows = SRC.slice(SRC.indexOf('const KbMenuRows = '), SRC.indexOf('const KbBusinessMount = '))
  check('the declared rows draw nothing while none is declared, and no header', /kbBizMenu\.list\(\)\.filter\(\(r\) => kbCreationSources\.folds\(r\.id\) !== true\)\.map\(/.test(rows) && !/'kb4-grph'|aria-expanded|aria-controls/.test(rows))
  check('the rows go through the menu\'s own row() (icon sets, selection) and the pack does not rename them (the menu is fixed)', /props\.row\(r\.id,/.test(rows) && /props\.openPage\(\{ view: r\.id \}\)/.test(rows) && /, true\)\)\)/.test(rows) && /fixed !== true && kbDomainLabel\(id\) !== null/.test(SRC))
  check('the rows follow the registry and the rows\' state, so a row that comes or goes is drawn at once', /kbBizMenu\.subscribe\(/.test(rows) && /KB_MENU_STATE\.subscribe\(/.test(rows))
  check('the words of the old group are gone', !/'kbui\.business': /.test(SRC) && /'kbui\.business\.off': \{ kybernos: '[^']+', en: '[^']+' \}/.test(SRC))
  check('the briefcase is drawn by the core\'s own icon table', /^ {2}briefcase: \['M16 20V4/m.test(SRC))
}

console.log('the look (CSS promises)')
{
  check('the group\'s CSS is gone: no rule of the header, the chevron, the count or the folded rows', !/\.kb4-grp/.test(SRC))
  check('the page area redraws when a row comes or goes, so the page of a vanished row is not left on screen', /kbBizMenu\.subscribe\(\(\) => domainTick\(\(n\) => n \+ 1\)\)/.test(SRC.slice(SRC.indexOf('const KybersMain = '), SRC.indexOf('// ── colonne 1 : navigation Kybernos'))))
}

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)

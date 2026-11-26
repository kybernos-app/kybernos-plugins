#!/usr/bin/env node
// The person's arrangement of the menu (docs/dev/business-menu.md, « The person's arrangement »): the sanitizer of a MENU DOC, the synchronous read of
// what the Theme page stored, the arrangement of the rows, the entry registry the Theme page reads (`window.__KB_MENU_ENTRIES__`), all cut out of
// client.js and run alone; and the places where SalesMenu reads them, checked at source level. No browser: the drawn result is measured on the real GUI.
//
//   node packages/kybernos-plugin/test-menu-prefs.mjs
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { hasEntry } from './lib-i18n-test.mjs'

let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

const SRC = readFileSync(new URL('./client.js', import.meta.url), 'utf8')
const cut = (open, close) => {
  const a = SRC.indexOf(open)
  const b = SRC.indexOf(close, a)
  if (a < 0 || b < a) { console.log('  ✗ cannot cut ' + open + ' out of client.js'); process.exit(1) }
  return SRC.slice(a, b)
}
// The business-menu block and the prefs block sit side by side (the sanitizer reads KB_BIZ_ID); then the entry table and the registry.
const BLOCKS = cut('// <kb-business-menu>', '// </kb-menu-prefs>') + '\n' + cut('// <kb-menu-surfaces>', '// </kb-menu-surfaces>') + '\n' + cut('// <kb-menu-entries>', '// </kb-menu-entries>') + '\n' + cut('// <kb-menu-registry>', '// </kb-menu-registry>')

const NAMES = { 'kbui.cloudcomputer': 'Cloud computer', 'kbui.kyber': 'Kaby', 'kbui.dashboards': 'Dashboards', 'menu.tasks': 'Automations', 'kbui.connecteurs': 'Connectors', 'kbui.skills': 'Skills', 'menu.aiteams': 'Agent Teams', 'menu.deliverables': 'Creations', 'kbui.documents': 'Documents' }
/** The cut blocks on a fake window (a localStorage, the flags the real menu reads, the Creations sources) — one per scenario. */
const build = (opts) => {
  const o = Object.assign({ cloud: false, ky: true, db: true, cp: true, docs: false, folded: new Set(), hides: () => false, domainLabel: () => null, lang: () => 'en', kaby: () => null }, opts || {})
  const store = new Map()
  const win = {
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)) }, removeItem: (k) => { store.delete(k) } },
    dispatchEvent: () => true,
  }
  const subs = new Set()
  const creation = { folds: (id) => { if (o.foldsThrows === true) throw new Error('boom'); return o.folded.has(id) }, subscribe: (f) => { subs.add(f); return () => { subs.delete(f) } } }
  const kbt = (k) => (NAMES[k] !== undefined ? NAMES[k] : k)
  const names = ['kbMenuPrefsClean', 'kbMenuPrefsRead', 'kbMenuLabelOf', 'kbMenuArrange', 'KB_MENU_PREFS_KEY', 'KB_MENU_FIXED', 'kbMenuDefaultIds', 'kbMenuEntryList', 'kbMenuEntries', 'kbMenuFlags', 'kbMenuDefaultName', 'kbBizMenu', 'kbMenuClassicOf', 'kbSurfaceHidden', 'kbSurfaceHiddenTitles', 'kbSurfaceCss', 'KB_SECONDARY_ENTRIES', 'KB_SETTINGS_PAGES', 'KB_MENU_SURFACES']
  const made = new Function('window', 'CustomEvent', 'console', 'KB_DEFAULT_ICON', 'KB_SHOW_CLOUD_COMPUTER_ROW', 'KB_KY', 'KB_DB', 'KB_CP', 'KB_SHOW_DOCS', 'kbCreationSources', 'kbDomainHides', 'kbDomainLabel', 'kbDomainLang', 'kbKabyMe', 'kbt',
    BLOCKS + '\nreturn { ' + names.join(', ') + ' }')(win, class { constructor (type) { this.type = type } }, { warn: () => {} }, 'waypoints', o.cloud, o.ky, o.db, o.cp, o.docs, creation, o.hides, o.domainLabel, o.lang, o.kaby, kbt)
  return Object.assign(made, { win, store, creation, subs, fold: (id) => { o.folded.add(id); subs.forEach((f) => f()) }, unfold: (id) => { o.folded.delete(id); subs.forEach((f) => f()) } })
}
const U2028 = String.fromCharCode(0x2028)
const U2029 = String.fromCharCode(0x2029)

console.log('the sanitizer: the vectors every copy agrees on (contract §6)')
const M = build()
const clean = M.kbMenuPrefsClean
{
  const r = clean({ entries: [{ id: 'skills', shown: false, order: 5 }, { id: 'kyber', shown: true, order: 0 }], unlisted: 'hide' })
  check('entries are sorted by order (kyber, skills), renumbered 0..n-1, skills hidden, unlisted hide, locked false', same(r, { entries: [{ id: 'kyber', shown: true, order: 0 }, { id: 'skills', shown: false, order: 1 }], unlisted: 'hide', locked: false }), r)
  for (const id of ['workspaces', 'settings', 'account', 'projects', 'Kyber', 'a', 'a' + 'b'.repeat(24)]) {
    const d = clean({ entries: [{ id, shown: true, order: 0 }, { id: 'skills', shown: true, order: 1 }] })
    check('the id "' + (id.length > 12 ? id.length + ' characters' : id) + '" is dropped, the next entry stays', same(d.entries.map((e) => e.id), ['skills']), d)
  }
  check('a 24-character id is kept (the longest the pattern takes)', clean({ entries: [{ id: 'a' + 'b'.repeat(23), shown: true }] }).entries.length === 1)
  const dup = clean({ entries: [{ id: 'skills', shown: false, order: 3 }, { id: 'skills', shown: true, order: 0 }, { id: 'kyber', shown: true, order: 1 }] })
  check('a duplicate id: the first one is kept', same(dup.entries, [{ id: 'kyber', shown: true, order: 0 }, { id: 'skills', shown: false, order: 1 }]), dup)
  const lab = clean({ entries: [{ id: 'skills', shown: true, label: { en: '  Skills  ', fr: '', de: 'x', es: '<b>' } }] })
  check('a label keeps the languages that are valid, tidied: { en: "Skills" }', same(lab.entries[0].label, { en: 'Skills' }), lab)
  const sep = clean({ entries: [{ id: 'skills', shown: true, label: { en: '  Skills' + U2028 + ' ', fr: 'A' + U2029 + '\t\nB', es: 'x\u0000y', ar: 'ok' } }] })
  check('control characters and U+2028/9 become a space, runs collapse, the ends are trimmed', same(sep.entries[0].label, { en: 'Skills', fr: 'A B', es: 'x y', ar: 'ok' }), sep.entries[0].label)
  const long = clean({ entries: [{ id: 'skills', shown: true, label: { en: 'x'.repeat(41), fr: 'y'.repeat(40) } }] })
  check('a label of 41 characters is dropped, one of 40 is kept', same(long.entries[0].label, { fr: 'y'.repeat(40) }), long.entries[0])
  check('an object of labels with nothing valid is dropped altogether', clean({ entries: [{ id: 'skills', shown: true, label: { en: '', fr: '<i>', de: 'x' } }] }).entries[0].label === undefined)
  check('a label that is not an object is ignored', clean({ entries: [{ id: 'skills', shown: true, label: 'Skills' }] }).entries[0].label === undefined)
  const many = clean({ entries: Array.from({ length: 25 }, (_, i) => ({ id: 'row-' + i, shown: true, order: i })) })
  check('25 entries: the first 24 are kept', many.entries.length === 24 && many.entries[23].id === 'row-23', many.entries.length)
  const odd = clean({ entries: [{ id: 'skills', shown: true }], unlisted: 'x', locked: 'yes' })
  check('unlisted "x" becomes show, locked "yes" becomes false', odd.unlisted === 'show' && odd.locked === false, odd)
  check('unlisted "hide" and locked true are kept', same([clean({ entries: [], unlisted: 'hide', locked: true }).unlisted, clean({ entries: [], unlisted: 'hide', locked: true }).locked], ['hide', true]))
  for (const [name, v] of [['entries is a string', { entries: 'skills' }], ['entries is an object', { entries: {} }], ['entries is missing', { unlisted: 'hide' }], ['the doc is an array', []], ['the doc is null', null], ['the doc is a string', 'x'], ['the doc is a number', 7], ['the doc is undefined', undefined]]) {
    check('not a menu: ' + name + ' → null', clean(v) === null)
  }
  check('a MENU DOC with no entry is still one (the default menu is null, not an empty doc)', same(clean({ entries: [] }), { entries: [], unlisted: 'show', locked: false }))
}
{
  const ord = clean({ entries: [{ id: 'aa', shown: true }, { id: 'bb', shown: true, order: 0 }, { id: 'cc', shown: true, order: 100 }, { id: 'dd', shown: true, order: -1 }, { id: 'ee', shown: true, order: 1.5 }, { id: 'ff', shown: true, order: '3' }] })
  check('a missing or invalid order takes the place in the list (0..99 whole numbers only); ties keep the list order; all renumbered', same(ord.entries.map((e) => e.id + ':' + e.order), ['aa:0', 'bb:1', 'cc:2', 'dd:3', 'ee:4', 'ff:5']), ord.entries)
  const bad = clean({ entries: [null, 'skills', 7, [], { id: 'skills' }, { id: 'skills', shown: 'yes' }, { id: 7, shown: true }, { id: 'kyber', shown: true, evil: 1, order: 2, label: { en: 'K', zz: 'no' } }] })
  check('a bad entry is dropped (not an object, no boolean `shown`, no string id); unknown keys and languages are dropped', same(bad.entries, [{ id: 'kyber', shown: true, order: 0, label: { en: 'K' } }]), bad)
  const input = { entries: [{ id: 'skills', shown: true, order: 9, label: { en: ' A ' } }, { id: 'kyber', shown: false, order: 1 }], unlisted: 'hide' }
  const before = JSON.stringify(input)
  const out = clean(input)
  check('the input is not touched and the result is frozen (entries, labels and the doc)', JSON.stringify(input) === before && Object.isFrozen(out) && Object.isFrozen(out.entries) && Object.isFrozen(out.entries[0]) && Object.isFrozen(out.entries[1].label), out)
}
const themeStore = new URL('../kybernos-theme/preset-store.mjs', import.meta.url)
if (existsSync(themeStore)) {
  const { sanitizeMenu } = await import(themeStore.href)
  if (typeof sanitizeMenu === 'function') {
    // The copies must agree: the same documents, a seeded pseudo-random batch of them, give the same answer here and in the host's sanitizer.
    let seed = 20261122
    const rnd = (n) => { seed = (seed * 1664525 + 1013904223) % 4294967296; return Math.floor((seed / 4294967296) * n) }
    const pick = (list) => list[rnd(list.length)]
    const IDS = ['skills', 'kyber', 'tasks', 'connectors', 'aiteams', 'deliverables', 'dashboards', 'documents', 'tables', 'front-desk', 'workspaces', 'settings', 'account', 'projects', 'Kyber', 'a', 'a' + 'b'.repeat(24), 7, null]
    const TEXTS = ['Skills', '  Skills  ', '', ' ', '<b>', 'a>b', 'x'.repeat(40), 'x'.repeat(41), 'A' + U2028 + 'B', 'A\t\nB', 'a  b   c', 7, null]
    let diff = 0
    let first = null
    for (let i = 0; i < 400; i++) {
      const doc = { entries: Array.from({ length: rnd(30) }, () => {
        const e = { id: pick(IDS), shown: pick([true, false, true, false, 'yes', undefined]) }
        if (rnd(3) > 0) e.order = pick([0, 1, 2, 5, 50, 99, 100, -1, 1.5, '3', null, rnd(120)])
        if (rnd(2) === 0) e.label = Object.fromEntries(['en', 'fr', 'es', 'ar', 'de'].filter(() => rnd(2) === 0).map((l) => [l, pick(TEXTS)]))
        if (rnd(5) === 0) e.extra = 1
        return e
      }), unlisted: pick(['show', 'hide', 'x', undefined, 1]), locked: pick([true, false, 'yes', undefined]) }
      // The other two surfaces: the same kind of noise, with the ids they refuse and the ones they take.
      if (rnd(2) === 0) {
        const SIDS = ['spaces', 'create-team', 'upgrade', 'phone', 'help', 'account', 'referral', 'settings', 'logout', 'general', 'kaby', 'theme', 'phone-channels', 'Kaby', 'a', 7, null]
        const surf = () => (rnd(8) === 0 ? pick([null, 7, 'x', [], { entries: 'no' }]) : { entries: Array.from({ length: rnd(rnd(2) === 0 ? 30 : 80) }, () => ({ id: pick(SIDS), shown: pick([true, false, 'yes', undefined]), order: pick([0, 1, 5, 99, 100, -1, null, rnd(120)]), label: rnd(4) === 0 ? { en: 'x' } : undefined })), unlisted: pick(['show', 'hide', 'x', undefined]) })
        doc.surfaces = pick([{ secondary: surf(), settings: surf() }, { secondary: surf() }, { settings: surf(), main: surf(), other: surf() }, null, 7, []])
      }
      if (JSON.stringify(sanitizeMenu(doc)) !== JSON.stringify(clean(doc))) { diff += 1; if (first === null) first = doc }
    }
    check('the menu\'s sanitizer and the host\'s (kybernos-theme preset-store `sanitizeMenu`) agree on 400 seeded documents, surfaces included', diff === 0, { diff, first })
  } else check('the host\'s sanitizer is exported (sanitizeMenu)', false)
}

console.log('the surfaces of an arrangement: the account menu and the Settings pages (vectors every copy agrees on)')
{
  const doc = { entries: [], surfaces: { secondary: { entries: [{ id: 'upgrade', shown: false, order: 7 }, { id: 'help', shown: true, order: 2 }], unlisted: 'hide' }, settings: { entries: [{ id: 'theme', shown: true }] } } }
  const r = clean(doc)
  check('a surface is sorted and renumbered like the main entries; its unlisted is its own', same(r.surfaces.secondary, { entries: [{ id: 'help', shown: true, order: 0 }, { id: 'upgrade', shown: false, order: 1 }], unlisted: 'hide' }) && same(r.surfaces.settings, { entries: [{ id: 'theme', shown: true, order: 0 }], unlisted: 'show' }), r)
  check('a document without surfaces keeps the shape it always had (no `surfaces` key)', same(clean({ entries: [{ id: 'skills', shown: true }] }), { entries: [{ id: 'skills', shown: true, order: 0 }], unlisted: 'show', locked: false }))
  for (const id of ['account', 'referral', 'settings', 'logout', 'Help', 'a']) check('the account menu refuses "' + id + '" (the app\'s own screens, or not an id)', clean({ entries: [], surfaces: { secondary: { entries: [{ id, shown: false }, { id: 'help', shown: false }] } } }).surfaces.secondary.entries.map((e) => e.id).join() === 'help')
  check('Settings refuses "general" (the page it opens on) and keeps the others', clean({ entries: [], surfaces: { settings: { entries: [{ id: 'general', shown: false }, { id: 'kaby', shown: false }] } } }).surfaces.settings.entries.map((e) => e.id).join() === 'kaby')
  check('"workspaces" and "projects" are the main menu\'s own: a surface may name them (they mean nothing there)', clean({ entries: [], surfaces: { secondary: { entries: [{ id: 'workspaces', shown: false }] } } }).surfaces.secondary.entries.length === 1)
  check('an entry carries no name on a surface (a label is dropped)', same(clean({ entries: [], surfaces: { secondary: { entries: [{ id: 'help', shown: true, label: { en: 'Aide' } }] } } }).surfaces.secondary.entries[0], { id: 'help', shown: true, order: 0 }))
  check('a surface that says nothing (no entry, unlisted show) is dropped, and so is `surfaces` when none is left', clean({ entries: [], surfaces: { secondary: { entries: [] }, settings: { entries: [{ id: 'general', shown: true }] } } }).surfaces === undefined)
  check('a surface with no entry that hides what it does not list is kept (that is a rule)', same(clean({ entries: [], surfaces: { settings: { entries: [], unlisted: 'hide' } } }).surfaces, { settings: { entries: [], unlisted: 'hide' } }))
  check('an unknown surface name is dropped; `surfaces` that is not an object is ignored', clean({ entries: [], surfaces: { main: { entries: [{ id: 'help', shown: true }] }, other: { entries: [{ id: 'help', shown: true }] } } }).surfaces === undefined && clean({ entries: [], surfaces: 'x' }).surfaces === undefined && clean({ entries: [], surfaces: [] }).surfaces === undefined)
  check('the bounds: 24 entries on the account menu, 64 on Settings', clean({ entries: [], surfaces: { secondary: { entries: Array.from({ length: 30 }, (_, i) => ({ id: 'e' + 'a'.repeat(i % 5 + 1) + i, shown: true })) }, settings: { entries: Array.from({ length: 80 }, (_, i) => ({ id: 'p' + i + 'x', shown: false })) } } }).surfaces.settings.entries.length === 64)
  const frozen = clean(doc)
  check('the result is frozen all the way down (surfaces, a surface, its entries)', Object.isFrozen(frozen.surfaces) && Object.isFrozen(frozen.surfaces.secondary) && Object.isFrozen(frozen.surfaces.secondary.entries) && Object.isFrozen(frozen.surfaces.secondary.entries[0]))
  check('the main menu is untouched by what a surface says (main entries stay as they are)', same(clean({ entries: [{ id: 'skills', shown: false }], surfaces: { secondary: { entries: [{ id: 'help', shown: false }] } } }).entries, [{ id: 'skills', shown: false, order: 0 }]))
}

console.log('what an arrangement hides on the account menu and on Settings (the tables, the hooks, the stylesheet)')
{
  const m = build()
  const A = m.KB_SECONDARY_ENTRIES
  const P = m.KB_SETTINGS_PAGES
  check('the account menu table has the eighteen entries of kybernos-cloud\'s menus (the signed-in menu and the signed-out one: Create an account and See plans; Display, the mode\'s switch, among them), each with at least one hook', A.length === 18 && A.every((e) => /^[a-z][a-z0-9-]{1,23}$/.test(e.id) && e.hooks.length > 0 && e.hooks.every((h) => /^\[data-kb="[a-z-]+"\]( \[data-kb="[a-z-]+"\])?$/.test(h))), A.map((e) => e.id))
  check('its ids are unique and the four that open the app\'s own screens and Display (the way out of Simple) are all in the table (and so refused as hideable)', new Set(A.map((e) => e.id)).size === A.length && ['account', 'referral', 'settings', 'logout', 'display'].every((id) => A.some((e) => e.id === id) && m.KB_MENU_SURFACES.secondary.never.indexOf(id) >= 0))
  check('the Settings table has 35 pages with unique ids, unique titles and a known group', P.length === 35 && new Set(P.map((p) => p.id)).size === 35 && new Set(P.map((p) => p.title)).size === 35 && P.every((p) => /^[a-z][a-z0-9-]{1,23}$/.test(p.id) && ['general', 'models', 'agents', 'tools', 'memory', 'voice', 'look', 'devices', 'system'].indexOf(p.group) >= 0))
  check('the Agents pages of the Theme list follow the navigation: Kaby, Automations, Workers, Commands, Agent presets', P.filter((p) => p.group === 'agents').map((p) => p.id).join() === 'kaby,automations,workers,commands,agent-presets')
  const hook = (sel) => (sel.match(/data-kb="([a-z-]+)"/g) || []).map((x) => x.slice(9, -1))
  const CLOUD = readFileSync(new URL('../kybernos-cloud/client.js', import.meta.url), 'utf8')
  // Every `data-kb="menu-<key>"` the cloud menu makes by `entree('<key>', …)` or draws by hand, and the space hooks of its lists.
  const drawn = new Set([...CLOUD.matchAll(/entree\('([a-z-]+)'/g)].map((x) => 'menu-' + x[1]).concat([...CLOUD.matchAll(/'data-kb': '([a-z-]+)'/g)].map((x) => x[1])))
  check('every hook of the account menu table is one kybernos-cloud\'s menu really draws', A.every((e) => e.hooks.every((sel) => hook(sel).every((k) => drawn.has(k)))), A.map((e) => e.hooks.map((sel) => hook(sel).filter((k) => !drawn.has(k)))).flat(2))
  // The Settings pages: the titles are the ones the organiser writes (KB_NAV_KEYS values), and every section the bundles register has a page here.
  const NAV = SRC.slice(SRC.indexOf('const KB_NAV_KEYS = {'), SRC.indexOf('/** The React key of a nav cell'))
  const navTitles = new Set([...NAV.matchAll(/'?[a-z-]+'?: '([^']+)'/g)].map((x) => x[1]))
  check('every page of the table is a title the organiser knows (KB_NAV_KEYS), so its cell carries the hook', P.every((p) => navTitles.has(p.title)), P.filter((p) => !navTitles.has(p.title)).map((p) => p.title))
  check('and every title KB_NAV_KEYS knows is a page of the table (no page left that no arrangement can hide)', [...navTitles].every((t) => P.some((p) => p.title === t)), [...navTitles].filter((t) => !P.some((p) => p.title === t)))
  const sectionIds = new Set()
  for (const dir of readdirSync(new URL('..', import.meta.url))) {
    const f = new URL('../' + dir + '/client.js', import.meta.url)
    if (!existsSync(f)) continue
    const t = readFileSync(f, 'utf8')
    for (const x of t.matchAll(/name: 'settings\.section', id: '([a-z0-9-]+)'/g)) sectionIds.add(x[1])
    for (const x of t.matchAll(/\[\['(kybernos-[a-z-]+)', \d+, '[a-z.]+', /g)) sectionIds.add(x[1])
  }
  const navKeys = new Set([...NAV.matchAll(/(?:^|[ ,{])'?([a-z][a-z-]*)'?: '[^']+'/gm)].map((x) => x[1]))
  check('every Settings section a bundle registers has an entry in KB_NAV_KEYS (else its page could not be hidden, nor be found by key)', sectionIds.size > 25 && [...sectionIds].every((id) => navKeys.has(id)), [...sectionIds].filter((id) => !navKeys.has(id)))

  const doc = clean({ entries: [], surfaces: { secondary: { entries: [{ id: 'upgrade', shown: false }, { id: 'help', shown: true }, { id: 'account', shown: false }], unlisted: 'show' }, settings: { entries: [{ id: 'theme', shown: true }, { id: 'kaby', shown: true }], unlisted: 'hide' } } })
  check('a listed entry is hidden by its `shown`; a never-hideable one is never hidden, even when a document lists it', same(m.kbSurfaceHidden(doc, 'secondary'), ['upgrade']), m.kbSurfaceHidden(doc, 'secondary'))
  const gone = m.kbSurfaceHidden(doc, 'settings')
  check('with `unlisted: hide` every page the document does not list is hidden, and General never is', gone.length === 32 && gone.indexOf('general') < 0 && gone.indexOf('theme') < 0 && gone.indexOf('kaby') < 0 && gone.indexOf('about') >= 0, gone.length)
  // The locked preset's reader (kbSurfaceDoc asks for `trusted`) is the only one that can hide General; a person's own arrangement never can, and cannot claim the right.
  const lockedRaw = { entries: [], locked: true, surfaces: { settings: { entries: [{ id: 'general', shown: false }, { id: 'kaby', shown: true }], unlisted: 'hide' } } }
  const trustedDoc = m.kbMenuPrefsClean(lockedRaw, true)
  check('the locked preset\'s reader keeps General\'s row and hides General (and every page it does not list)', trustedDoc.trusted === true && trustedDoc.surfaces.settings.entries.some((e) => e.id === 'general' && e.shown === false) && m.kbSurfaceHidden(trustedDoc, 'settings').indexOf('general') >= 0 && m.kbSurfaceHidden(trustedDoc, 'settings').indexOf('kaby') < 0)
  check('an arrangement that is not the locked preset\'s (stored, imported, or claiming `trusted`) still cannot hide General', (() => { const forged = m.kbMenuPrefsClean(Object.assign({ trusted: true }, lockedRaw)); return forged.trusted === undefined && !forged.surfaces.settings.entries.some((e) => e.id === 'general') && m.kbSurfaceHidden(forged, 'settings').indexOf('general') < 0 && m.kbSurfaceHidden(Object.assign({}, trustedDoc, { trusted: false }), 'settings').indexOf('general') < 0 })())
  check('General\'s cell is hidden in the phone layout only (a media query), every other hidden page everywhere', (() => { const c = m.kbSurfaceCss(trustedDoc); return /@media \(max-width: 700px\), \(max-height: 500px\) and \(pointer: coarse\)\{\[class\*="navList"\] \[data-kb-t="general"\]:not\(#kb-surfaces-css\)\{display:none!important\}\}/.test(c) && /\n\[class\*="navList"\] \[data-kb-t="usage"\]/.test('\n' + c) })())
  check('the Kaby mode reader asks for it, and only that one', /kbMenuPrefsClean\(lock\.get\('locked-simple'\), true\)/.test(SRC) && SRC.split('\n').filter((l) => /kbMenuPrefsClean\(.*, true\)/.test(l) && !/const kbMenuPrefsClean/.test(l)).length === 1)
  check('nothing hidden for no arrangement, a document without surfaces, an unknown surface or junk', same(m.kbSurfaceHidden(null, 'secondary'), []) && same(m.kbSurfaceHidden(clean({ entries: [] }), 'settings'), []) && same(m.kbSurfaceHidden(doc, 'main'), []) && same(m.kbSurfaceHidden({ surfaces: 7 }, 'secondary'), []) && same(m.kbSurfaceHidden('x', 'settings'), []))
  const css = m.kbSurfaceCss(doc)
  check('the stylesheet hides the account menu entry by its hook', css.indexOf('[data-kb="menu-upgrade"]{display:none!important}') >= 0 && css.indexOf('[data-kb="menu-help"]') < 0 && css.indexOf('menu-account') < 0)
  check('...and a Settings page by the hook of its cell, under the navigation only', css.indexOf('[class*="navList"] [data-kb-t="about"]:not(#kb-surfaces-css){display:none!important}') >= 0 && css.indexOf('[data-kb-t="theme"]') < 0 && css.indexOf('[data-kb-t="general"]') < 0 && css.indexOf('[data-kb-t="servers"]') >= 0)
  check('a group whose pages are all hidden loses its header (Voice & calls), one with a page left keeps it (Interface)', css.indexOf('[data-kb="settings-group"][data-kb-g="voice"]{display:none!important}') >= 0 && css.indexOf('data-kb-g="look"') < 0 && css.indexOf('data-kb-g="general"') < 0)
  check('no arrangement, no stylesheet', m.kbSurfaceCss(null) === '' && m.kbSurfaceCss(clean({ entries: [{ id: 'skills', shown: false }] })) === '')
  check('the hidden titles (what the search must not offer) are the hidden pages\' `data-kb-t` values', same(m.kbSurfaceHiddenTitles(clean({ entries: [], surfaces: { settings: { entries: [{ id: 'about', shown: false }, { id: 'servers', shown: false }] } } })), ['servers', 'about']) || same(m.kbSurfaceHiddenTitles(clean({ entries: [], surfaces: { settings: { entries: [{ id: 'about', shown: false }, { id: 'servers', shown: false }] } } })).sort(), ['about', 'servers']))
  check('a title never carries a quote or a bracket (the selector is built from the table, never from a document)', P.every((p) => !/["\\\]\[]/.test(p.title)) && css.indexOf('undefined') < 0)
}

console.log('the registry\'s other surfaces (window.__KB_MENU_ENTRIES__.list(surface))')
{
  const m = build()
  const api = m.kbMenuEntries
  check('the registry says which attribute finds an entry of each surface', same(api.hooks, { main: 'data-kb-row', secondary: 'data-kb', settings: 'data-kb-t' }) && Object.isFrozen(api.hooks))
  const sec = api.list('secondary')
  const set = api.list('settings')
  check('secondary: the eighteen entries, frozen, with `locked` on the five never-hideable ones, no icon', sec.length === 18 && Object.isFrozen(sec) && sec.every((e) => Object.isFrozen(e) && e.icon === null && typeof e.name === 'string') && same(sec.filter((e) => e.locked).map((e) => e.id), ['account', 'referral', 'display', 'settings', 'logout']), sec.map((e) => e.id))
  check('settings: the 35 pages in the order of the navigation\'s groups, with their group and its name; only General is locked', set.length === 35 && same(set.filter((e) => e.locked).map((e) => e.id), ['general']) && set.every((e) => typeof e.group === 'string' && e.group !== '') && set.find((e) => e.id === 'kaby').group === 'agents' && set.find((e) => e.id === 'general').groupName === '')
  check('the main menu is what it was (no argument, or "main"): the same rows as before', api.list().length > 0 && same(api.list().map((e) => e.id), api.list('main').map((e) => e.id)) && api.list().every((e) => e.locked === undefined))
  const dict = (key) => hasEntry(key) // both languages in i18n/*.json
  check('every entry of the two tables has a French and an English name in the dictionary', A_ALL().every((k) => dict(k)), A_ALL().filter((k) => !dict(k)))
  function A_ALL () { return m.KB_SECONDARY_ENTRIES.map((e) => 'menu.acct.' + e.id).concat(m.KB_SETTINGS_PAGES.map((p) => 'menu.page.' + p.id)) }
}

console.log('the mode the surfaces follow')
{
  const at = SRC.indexOf('const kbSimpleMode = () => {')
  const end = SRC.indexOf('/** The arrangement the surfaces follow now', at)
  check('the reader of the mode is there, once', at > 0 && end > at && SRC.indexOf('const kbSimpleMode = () => {', at + 1) < 0)
  const root = (attrs, classes) => ({ hasAttribute: (k) => Object.prototype.hasOwnProperty.call(attrs, k), classList: { contains: (c) => classes.indexOf(c) >= 0 } })
  const simpleOf = (r) => new Function('document', SRC.slice(at, end) + '\nreturn kbSimpleMode')({ documentElement: r })()
  check('the mode\'s resolver ran: the page is Simple exactly when it carries kb-simple, whatever the phone shell\'s class says', simpleOf(root({ 'data-kb-mode': 'simple' }, ['kb-simple'])) === true && simpleOf(root({ 'data-kb-mode': 'complete' }, [])) === false && simpleOf(root({ 'data-kb-mode': 'complete' }, ['kb-kaby'])) === false && simpleOf(root({ 'data-kb-mode': 'simple' }, ['kb-simple', 'kb-kaby'])) === true)
  check('a host with no resolver yet (an older Mobile bundle): the phone shell\'s class meant Simple, and still does', simpleOf(root({}, ['kb-kaby'])) === true && simpleOf(root({}, [])) === false)
  check('a page with no document is not Simple, and nothing throws', new Function('document', SRC.slice(at, end) + '\nreturn kbSimpleMode')(undefined)() === false)
}

console.log('the effect that writes the stylesheet (source level)')
{
  const apply = cut('// <kb-menu-surfaces-apply>', '// </kb-menu-surfaces-apply>')
  check('in Simple mode it follows the locked preset the Theme plugin publishes and nothing else: never the person\'s own arrangement', /if \(kbSimpleMode\(\)\) \{/.test(apply) && /window\.__KB_THEME_LOCKED__/.test(apply) && /lock\.get\('locked-simple'\)/.test(apply) && /: null\s*\n\s*\}\s*\n\s*\} catch \(e\) \{ return null \}/.test(apply))
  check('outside Simple mode it follows the person\'s arrangement (kbMenuPrefsRead)', /return kbMenuPrefsRead\(\)/.test(apply))
  check('it is redone when the arrangement moves: the page\'s event, the storage event of the key, the locked preset becoming readable', /'kb-menu-prefs-change', kbSurfacesApply/.test(apply) && /'kb-locked-presets-ready', kbSurfacesApply/.test(apply) && /ev\.key === KB_MENU_PREFS_KEY/.test(apply))
  check('and undone when the bundle goes (the stylesheet, the mark on <html>, the observer)', /removeEventListener\('kb-menu-prefs-change'/.test(apply) && /el\.remove\(\)/.test(apply) && /removeAttribute\('data-kb-surfaces'\)/.test(apply) && /disconnect\(\)/.test(apply))
  check('no network call, no timer, nothing written to storage', !/\bfetch\(|XMLHttpRequest|WebSocket|sendBeacon|setTimeout|setInterval|localStorage\.setItem/.test(apply))
  check('while a Settings page is hidden the organiser runs at once, on the first frame, instead of a quarter of a second later', /requestAnimationFrame\(\(\) => \{ queued = false; try \{ if \(typeof kbNavRefresh === 'function'\) kbNavRefresh\(\)/.test(apply))
  check('the search offers no hidden page: kbSsTitles leaves its cell out', /const gone = kbSurfaceHiddenTitles\(kbSurfaceDoc\(\)\)/.test(SRC) && /gone\.indexOf\(String\(c\.dataset\.kbT\)\) < 0/.test(SRC))
}

console.log('reading what the Theme page stored (first paint: synchronous, never throws)')
{
  const m = build()
  const KEY = m.KB_MENU_PREFS_KEY
  check('the key is the contract\'s', KEY === 'kybernos.theme.menu.v1')
  check('nothing stored: the default menu (null)', m.kbMenuPrefsRead() === null)
  const doc = { entries: [{ id: 'skills', shown: false, order: 4 }, { id: 'kyber', shown: true, order: 2, label: { en: 'Mia' } }], unlisted: 'hide' }
  m.store.set(KEY, JSON.stringify({ v: 1, updatedAt: 1, menu: doc }))
  const a = m.kbMenuPrefsRead()
  check('a stored arrangement comes back sanitized (sorted and renumbered)', same(a, clean(doc)) && a.entries[0].id === 'kyber' && a.entries[0].order === 0, a)
  check('the same object comes back while the stored text is the same (a redraw is not a new arrangement)', m.kbMenuPrefsRead() === a)
  m.store.set(KEY, JSON.stringify({ v: 1, updatedAt: 2, menu: { entries: [{ id: 'tasks', shown: false }] } }))
  const b = m.kbMenuPrefsRead()
  check('a new write is read at once', b !== a && same(b.entries.map((e) => e.id), ['tasks']), b)
  m.store.set(KEY, JSON.stringify({ v: 1, updatedAt: 3, menu: null }))
  check('`menu: null` is the default menu again', m.kbMenuPrefsRead() === null)
  m.store.set(KEY, JSON.stringify({ v: 1, updatedAt: 4, menu: doc }))
  m.store.delete(KEY)
  check('the key removed: the default menu', m.kbMenuPrefsRead() === null)
  for (const [name, raw] of [['text that is not JSON', '{not json'], ['a version we do not know', JSON.stringify({ v: 2, menu: doc })], ['no version', JSON.stringify({ menu: doc })], ['a menu that is not one', JSON.stringify({ v: 1, menu: { entries: 'x' } })], ['an array', '[]'], ['a string', '"x"'], ['null', 'null']]) {
    m.store.set(KEY, raw)
    check('stored ' + name + ': the default menu, no throw', m.kbMenuPrefsRead() === null)
  }
  m.win.localStorage.getItem = () => { throw new Error('storage refused') }
  check('a storage that throws: the default menu, no throw', m.kbMenuPrefsRead() === null)
  m.win.localStorage = undefined
  check('no storage at all: the default menu, no throw', m.kbMenuPrefsRead() === null)
}

console.log('a row\'s own name (never the label of another language)')
{
  const prefs = clean({ entries: [{ id: 'skills', shown: true, label: { en: 'Know-how', fr: 'Savoir-faire' } }, { id: 'kyber', shown: true }] })
  const of = M.kbMenuLabelOf
  check('the label of the page language', of(prefs, 'skills', 'fr') === 'Savoir-faire' && of(prefs, 'skills', 'en') === 'Know-how')
  check('a language the label has no words for: none (the default name is used), never another language\'s', of(prefs, 'skills', 'es') === null && of(prefs, 'skills', 'de') === null && of(prefs, 'skills', 'ar') === null)
  check('an entry with no label, a row with no entry, no arrangement: none', of(prefs, 'kyber', 'en') === null && of(prefs, 'tasks', 'en') === null && of(null, 'skills', 'en') === null && of(undefined, 'skills', 'en') === null)
  check('a malformed arrangement does not throw', of({ entries: 'x' }, 'skills', 'en') === null && of({ entries: [null, 7, { id: 'skills', label: 'x' }] }, 'skills', 'en') === null)
}

console.log('arranging the rows')
{
  const rows = ['a1', 'b2', 'c3', 'd4', 'e5'].map((id) => ({ id, node: 'node-' + id }))
  const ids = (list) => list.map((r) => r.id).join()
  const arr = (raw) => M.kbMenuArrange(rows, clean(raw))
  check('no arrangement: the rows as they are, in the default order (the menu of today)', ids(M.kbMenuArrange(rows, null)) === 'a1,b2,c3,d4,e5' && ids(M.kbMenuArrange(rows, undefined)) === 'a1,b2,c3,d4,e5')
  check('the rows come back as the same objects (the node is not rebuilt)', M.kbMenuArrange(rows, clean({ entries: [{ id: 'c3', shown: true }] }))[0] === rows[2])
  check('an empty arrangement (no entries, unlisted show): every row, default order', ids(arr({ entries: [] })) === 'a1,b2,c3,d4,e5')
  check('an empty arrangement with unlisted hide: no row', ids(arr({ entries: [], unlisted: 'hide' })) === '')
  check('order: listed rows first, by order; the others keep their default order after them', ids(arr({ entries: [{ id: 'd4', shown: true, order: 0 }, { id: 'b2', shown: true, order: 1 }] })) === 'd4,b2,a1,c3,e5')
  check('hide: a listed row with shown false is gone, wherever it stands', ids(arr({ entries: [{ id: 'b2', shown: false, order: 0 }, { id: 'e5', shown: true, order: 1 }] })) === 'e5,a1,c3,d4')
  check('unlisted show (default): rows that are not listed stay', ids(arr({ entries: [{ id: 'c3', shown: true }], unlisted: 'show' })) === 'c3,a1,b2,d4,e5')
  check('unlisted hide: rows that are not listed are hidden, the listed ones stay in order', ids(arr({ entries: [{ id: 'e5', shown: true, order: 0 }, { id: 'a1', shown: true, order: 1 }, { id: 'c3', shown: false, order: 2 }], unlisted: 'hide' })) === 'e5,a1')
  check('an entry for a row this install does not draw does nothing (hidden or shown)', ids(arr({ entries: [{ id: 'zz-gone', shown: true, order: 0 }, { id: 'yy-gone', shown: false, order: 1 }, { id: 'b2', shown: true, order: 2 }] })) === 'b2,a1,c3,d4,e5' && ids(arr({ entries: [{ id: 'zz-gone', shown: true }], unlisted: 'hide' })) === '')
  check('`locked` changes nothing here', ids(arr({ entries: [{ id: 'd4', shown: true }, { id: 'a1', shown: false }], locked: true })) === ids(arr({ entries: [{ id: 'd4', shown: true }, { id: 'a1', shown: false }], locked: false })))
  check('every row shown in a new order (a full arrangement)', ids(arr({ entries: ['e5', 'd4', 'c3', 'b2', 'a1'].map((id, i) => ({ id, shown: true, order: i })) })) === 'e5,d4,c3,b2,a1')
  // A document that was not sanitized (a test, a future writer): the same rules hold.
  const raw = { entries: [{ id: 'c3', shown: true, order: 7 }, { id: 'a1', shown: true, order: 2 }, { id: 'c3', shown: false, order: 0 }, { id: 'b2', shown: 'yes', order: 0 }, { id: 'e5', shown: true }], unlisted: 'hide' }
  check('a raw document: sorted by order, a duplicate id counts once (the first), an entry with no boolean `shown` is not an entry; a missing order is the list index', ids(M.kbMenuArrange(rows, raw)) === 'a1,e5,c3', ids(M.kbMenuArrange(rows, raw)))
  const frozenRows = Object.freeze(rows.slice())
  const before = JSON.stringify(rows)
  M.kbMenuArrange(frozenRows, clean({ entries: [{ id: 'd4', shown: false }] }))
  check('the list given is not changed', JSON.stringify(rows) === before)
  check('not a list, holes in the list: no throw', same(M.kbMenuArrange(null, clean({ entries: [] })), []) && ids(M.kbMenuArrange([null, rows[0], undefined], clean({ entries: [] }))) === 'a1')
}

console.log('a row declared with defaultShown: false (out of the default menu, in by an entry that shows it)')
{
  const rows = ['a1', 'b2', 'c3'].map((id) => ({ id, node: 'node-' + id, ...(id === 'b2' ? { off: true } : {}) }))
  const ids = (list) => list.map((r) => r.id).join()
  check('no arrangement: the off row is left out, the others keep their order', ids(M.kbMenuArrange(rows, null)) === 'a1,c3')
  check('an arrangement that does not list it (unlisted show): still left out', ids(M.kbMenuArrange(rows, clean({ entries: [{ id: 'c3', shown: true }] }))) === 'c3,a1')
  check('an entry that shows it brings it in, at its order', ids(M.kbMenuArrange(rows, clean({ entries: [{ id: 'b2', shown: true, order: 0 }, { id: 'a1', shown: true, order: 1 }] }))) === 'b2,a1,c3')
  check('an entry that hides it keeps it out', ids(M.kbMenuArrange(rows, clean({ entries: [{ id: 'b2', shown: false }] }))) === 'a1,c3')
  check('the entry list marks it `off: true` and only it', (() => { const l = M.kbMenuEntryList({}, ['zz1', 'zz2'], (id) => id, ['zz2']); return l.find((r) => r.id === 'zz2').off === true && l.filter((r) => r.off === true).length === 1 && l.find((r) => r.id === 'zz1').off === undefined })())
  const m = build()
  const off = m.kbBizMenu.register({ id: 'frontx', group: 'business', icon: 'users', label: { en: 'Front x' }, defaultShown: false })
  const on = m.kbBizMenu.register({ id: 'othrx', group: 'business', icon: 'users', label: { en: 'Other x' } })
  check('a declared row says so: defaultShown false is kept, absent means true; the entries registry lists the off row with `off: true`', typeof off === 'function' && typeof on === 'function' && m.kbBizMenu.list().find((r) => r.id === 'frontx').defaultShown === false && m.kbBizMenu.list().find((r) => r.id === 'othrx').defaultShown === true && m.win.__KB_MENU_ENTRIES__.list().find((r) => r.id === 'frontx').off === true && m.win.__KB_MENU_ENTRIES__.list().find((r) => r.id === 'othrx').off === undefined)
  check('defaultShown must be a boolean: anything else refuses the row', m.kbBizMenu.check({ id: 'badx', group: 'business', icon: 'users', label: { en: 'Bad' }, defaultShown: 'no' }).ok === false)
}

console.log('the default menu: the table, the order, the flags (no arrangement = the menu of today)')
{
  const d = (present, declared) => M.kbMenuDefaultIds(present, declared).join()
  check('everything drawn: Cloud computer, Kaby, Dashboards, Automations, Connectors, Skills, Agent Teams, the declared rows, Creations, Documents', d({}, ['tables', 'front-desk']) === 'cloudcomputer,kyber,dashboards,tasks,connectors,skills,aiteams,tables,front-desk,deliverables,documents')
  check('a row the install does not draw is left out; the declared rows stay after Agent Teams', d({ cloudcomputer: false, kyber: false, documents: false }, ['tables']) === 'dashboards,tasks,connectors,skills,aiteams,tables,deliverables')
  check('no declared row, a declared id twice, a declared id that is a fixed row: nothing doubled', d({}, []) === 'cloudcomputer,kyber,dashboards,tasks,connectors,skills,aiteams,deliverables,documents' && d({}, ['tables', 'tables', 'skills']) === 'cloudcomputer,kyber,dashboards,tasks,connectors,skills,aiteams,tables,deliverables,documents')
  check('nothing given: the fixed rows', d(null, null) === 'cloudcomputer,kyber,dashboards,tasks,connectors,skills,aiteams,deliverables,documents')
  const flags = (o) => build(o).kbMenuFlags()
  check('the flags are today\'s: the Cloud computer needs its switch AND Kaby; Kaby needs its bundle; Dashboards its bundle and no Creations source standing in; Connectors its bundle; Documents its switch and the field not hiding it',
    same(flags({}), { cloudcomputer: false, kyber: true, dashboards: true, connectors: true, documents: false })
    && same(flags({ cloud: true }), { cloudcomputer: true, kyber: true, dashboards: true, connectors: true, documents: false })
    && same(flags({ cloud: true, ky: false }), { cloudcomputer: false, kyber: false, dashboards: true, connectors: true, documents: false })
    && same(flags({ db: false, cp: false }), { cloudcomputer: false, kyber: true, dashboards: false, connectors: false, documents: false })
    && same(flags({ docs: true }), { cloudcomputer: false, kyber: true, dashboards: true, connectors: true, documents: true })
    && same(flags({ docs: true, hides: (id) => id === 'documents' }).documents, false)
    && same(flags({ folded: new Set(['dashboards']) }).dashboards, false))
}

console.log('the entry registry the Theme page reads (window.__KB_MENU_ENTRIES__)')
{
  const m = build({ cloud: true, docs: true })
  const reg = m.win.__KB_MENU_ENTRIES__
  check('it is published on the window: version 1, the hook, list and subscribe', reg === m.kbMenuEntries && reg.v === 1 && reg.hook === 'data-kb-row' && typeof reg.list === 'function' && typeof reg.subscribe === 'function')
  const l = reg.list()
  check('everything drawn: nine rows, default order, { id, icon, name } with the icon-set entries and the dictionary\'s names', same(l, [
    { id: 'cloudcomputer', icon: 'cloud', name: 'Cloud computer' }, { id: 'kyber', icon: 'kyber', name: 'Kaby', off: true }, { id: 'dashboards', icon: 'dash', name: 'Dashboards' },
    { id: 'tasks', icon: 'auto', name: 'Automations' }, { id: 'connectors', icon: 'plug', name: 'Connectors' }, { id: 'skills', icon: 'skills', name: 'Skills' },
    { id: 'aiteams', icon: 'teams', name: 'Agent Teams' }, { id: 'deliverables', icon: 'creations', name: 'Creations' }, { id: 'documents', icon: null, name: 'Documents' }]), l)
  check('the list and every row in it are frozen, and nothing else is on a row', Object.isFrozen(l) && l.every((r) => Object.isFrozen(r) && Object.keys(r).every((k) => ['id', 'icon', 'name', 'off'].indexOf(k) >= 0) && (r.id !== 'kyber' || r.off === true)))
  check('the default flags (no Cloud computer row, no Documents row, as on a normal install): seven rows', same(build().win.__KB_MENU_ENTRIES__.list().map((r) => r.id), ['kyber', 'dashboards', 'tasks', 'connectors', 'skills', 'aiteams', 'deliverables']))
  check('without the Kaby, Dashboards and Connectors bundles: the rows that are always there', same(build({ ky: false, db: false, cp: false }).win.__KB_MENU_ENTRIES__.list().map((r) => r.id), ['tasks', 'skills', 'aiteams', 'deliverables']))
  check('Documents hidden by the person\'s field: not offered', !build({ docs: true, hides: (id) => id === 'documents' }).win.__KB_MENU_ENTRIES__.list().some((r) => r.id === 'documents'))
  check('every icon it gives is an icon-set entry of the theme plugin\'s eight (or null)', l.every((r) => r.icon === null || ['cloud', 'kyber', 'dash', 'teams', 'creations', 'auto', 'skills', 'plug'].indexOf(r.icon) >= 0))
}
{
  const m = build()
  const reg = m.win.__KB_MENU_ENTRIES__
  const row = (id, extra) => Object.assign({ id, group: 'business', icon: 'users', labelKey: 'business.' + id }, extra || {})
  const calls = []
  const off = reg.subscribe(() => calls.push('a'))
  reg.subscribe(() => { throw new Error('a listener that breaks') })
  reg.subscribe(() => calls.push('c'))
  const drop = m.kbBizMenu.register(row('tables', { label: { en: 'Tables', fr: 'Tables FR' } }))
  check('a plugin declares a row: the registry tells (a broken listener does not stop the others)', calls.join() === 'a,c', calls)
  const l = reg.list()
  check('the declared row is listed right after Agent Teams, with no icon-set entry and its own words', same(l.map((r) => r.id + ':' + r.icon), ['kyber:kyber', 'dashboards:dash', 'tasks:auto', 'connectors:plug', 'skills:skills', 'aiteams:teams', 'tables:null', 'deliverables:creations']) && l[6].name === 'Tables', l)
  m.kbBizMenu.register(row('front-desk', { label: { en: 'Front desk' } }))
  check('a second one follows the first', same(reg.list().map((r) => r.id).slice(6, 9), ['tables', 'front-desk', 'deliverables']))
  m.fold('tables')
  check('a Creations source folds a row: the registry tells and the row is gone from the list', calls.length === 6 && !reg.list().some((r) => r.id === 'tables') && reg.list().some((r) => r.id === 'front-desk'), calls)
  m.unfold('tables')
  check('and when the source goes, the row is back', reg.list().some((r) => r.id === 'tables'))
  drop()
  check('a plugin drops its row: it leaves the list', !reg.list().some((r) => r.id === 'tables'))
  const n = calls.length
  off()
  m.kbBizMenu.register(row('contacts'))
  check('a listener that stopped is not called again, the others are', calls.length === n + 1 && calls[calls.length - 1] === 'c', calls)
  check('subscribing with something that is not a function is harmless', typeof reg.subscribe(null) === 'function' && typeof reg.subscribe(7)() === 'undefined')
  check('stopping twice is harmless', (() => { const o = reg.subscribe(() => {}); o(); o(); return true })())
  check('a source that breaks does not break the list (an empty frozen one)', (() => { const x = build({ foldsThrows: true }).win.__KB_MENU_ENTRIES__.list(); return Array.isArray(x) && x.length === 0 && Object.isFrozen(x) })())
}
{
  const kaby = build({ kaby: () => ({ name: 'Mia', portrait: null }), domainLabel: (id) => (id === 'tasks' ? 'Jobs' : id === 'tables' ? 'Renamed by the pack' : null), lang: () => 'fr' })
  kaby.kbBizMenu.register({ id: 'tables', group: 'business', icon: 'users', label: { en: 'Tables', fr: 'Tableaux' } })
  const byId = Object.fromEntries(kaby.win.__KB_MENU_ENTRIES__.list().map((r) => [r.id, r.name]))
  check('the default name is the one the menu would draw: Kaby\'s own name, the field\'s word, else the dictionary\'s; a declared row is in the page language and no pack renames it', byId.kyber === 'Mia' && byId.tasks === 'Jobs' && byId.skills === 'Skills' && byId.tables === 'Tableaux', byId)
  check('a row the registry does not know has no default name but its id', kaby.kbMenuDefaultName('nothing') === 'nothing')
  const noName = build().kbMenuEntryList({}, [], () => { throw new Error('boom') })
  check('a dictionary that throws leaves the row\'s id as its name', noName.every((r) => r.name === r.id))
  check('a name that is not text leaves the id too', build().kbMenuEntryList({}, [], () => 7).every((r) => r.name === r.id) && build().kbMenuEntryList({}, [], () => '').every((r) => r.name === r.id))
}

console.log('the classic icons (lent to the Theme page) come from the same table')
{
  const m = build()
  check('every icon-set entry has its line icon; the old `ws` entry is gone, like any other unknown entry (null)', m.KB_MENU_FIXED.filter((d) => d.icon !== null).every((d) => m.kbMenuClassicOf(d.icon) === d.classic) && m.kbMenuClassicOf('ws') === null && m.kbMenuClassicOf('nope') === null && m.kbMenuClassicOf(undefined) === null)
}

console.log('where SalesMenu reads them (source level)')
{
  const count = (text, re) => (text.match(re) || []).length
  const menu = SRC.slice(SRC.indexOf('const SalesMenu = '), SRC.indexOf("slots.inject('sidebar.panellist'"))
  const ret = menu.indexOf("return h('div', { className: 'kb4-menu'")
  const built = menu.slice(menu.indexOf('const built = {'), menu.indexOf('const rowsShown = '))
  check('the menu is found', menu.length > 5000 && ret > 0 && built.length > 500)
  // Every row goes through the arranged list: they are all built before the return, in `built`, and the one list passes through kbMenuArrange.
  check('every row call site is in the builder, none in the returned tree', count(menu.slice(ret), /\browOf?\(/g) === 0 && count(menu.slice(0, ret), /\browOf\('[a-z]+'/g) === 9 && count(built, /\browOf\('[a-z]+'/g) === 9)
  check('the builder holds the nine fixed rows (one per line of the table) and the declared rows through the same row()', ['cloudcomputer', 'kyber', 'dashboards', 'tasks', 'connectors', 'skills', 'aiteams', 'deliverables', 'documents'].every((id) => new RegExp('\\b' + id + ': \\(\\) => rowOf\\(\'' + id + '\'').test(built)) && /for \(const r of declared\) built\[r\.id\] = \(\) => row\(r\.id, /.test(menu))
  check('the list is arranged ONCE, with the prefs read at this draw, over the default ids of this install', count(menu, /kbMenuArrange\(/g) === 1 && /const prefs = kbSurfaceDoc\(\)/.test(menu) && /const rowsShown = kbMenuArrange\(kbMenuDefaultIds\(kbMenuFlags\(\), declared\.map\(\(r\) => r\.id\)\)\.filter\(\(id\) => typeof built\[id\] === 'function'\)\.map\(\(id\) => \(\{ id, node: built\[id\]\(\), off: KB_MENU_DEFAULT_OFF\.indexOf\(id\) >= 0 \|\| declared\.some\(\(r\) => r\.id === id && r\.defaultShown === false\) \}\)\), prefs\)/.test(menu))
  check('the arranged rows are drawn as ONE keyed list between the new-chat button and the progress bar', count(menu.slice(ret), /rowsShown\.map\(\(r\) => r\.node\)/g) === 1 && menu.indexOf('rowsShown.map') < menu.indexOf('h(KbProgressBar'))
  const rowFn = menu.slice(menu.indexOf('const row = (id, ico, badge, active, onClick, extra) =>'), menu.indexOf('const ncCloud = '))
  check('row() is the only place a row button is made, and it carries data-kb-row="<id>"', count(menu, /className: 'kb4-item'/g) === 1 && /'data-kb-row': id/.test(rowFn) && /key: id/.test(rowFn))
  check('a row\'s name: the person\'s label in the page language first, then the default name (Kaby\'s name, the field\'s word, the dictionary\'s)', /const prefsLang = kbDomainLang\(\)/.test(rowFn.slice(0, 0) + menu) && /const mine = kbMenuLabelOf\(prefs, id, prefsLang\)/.test(rowFn) && /const label = mine !== null \? mine : kbMenuDefaultName\(id\)/.test(rowFn))
  check('the menu redraws when the arrangement changes (the Theme page\'s event, and `storage` for the key) and stops listening when it goes', /addEventListener\('kb-menu-prefs-change', onPrefs\)/.test(menu) && /removeEventListener\('kb-menu-prefs-change', onPrefs\)/.test(menu) && /addEventListener\('storage', onStorage\)/.test(menu) && /removeEventListener\('storage', onStorage\)/.test(menu) && /e\.key === KB_MENU_PREFS_KEY/.test(menu))
  check('in Simple mode the rows follow the locked preset through the same document as the account menu and Settings, and redraw when it becomes readable (it may be published a moment after the first draw); an unreadable preset leaves the full app\'s rows unfiltered', /addEventListener\('kb-locked-presets-ready', onPrefs\)/.test(menu) && /removeEventListener\('kb-locked-presets-ready', onPrefs\)/.test(menu) && !/kbMenuPrefsRead\(\)/.test(menu) && /kbSimpleMode\(\)[\s\S]{0,400}: null\s*\n\s*\}\s*\n\s*\} catch \(e\) \{ return null \}/.test(SRC.slice(SRC.indexOf('const kbSurfaceDoc = '), SRC.indexOf('const kbSurfaceDoc = ') + 700)))
  check('it also redraws when a plugin declares or drops a row (the declared rows are drawn here now)', /React\.useEffect\(\(\) => kbBizMenu\.subscribe\(\(\) => icoSetter/.test(menu))
  check('the old two tables and the declared-rows component are gone', !/\bKB_MENU_ENTRY\b|\bKB_MENU_CLASSIC\b|\bKbMenuRows\b/.test(SRC))
  check('the classic icons are still lent to the Theme page, from the table', /window\.__KB_MENU_CLASSIC__ = \(entry, size\) =>/.test(SRC) && /const name = kbMenuClassicOf\(entry\)/.test(SRC))
}

console.log('what the new blocks must not do')
{
  const blocks = [cut('// <kb-menu-prefs>', '// </kb-menu-prefs>'), cut('// <kb-menu-entries>', '// </kb-menu-entries>'), cut('// <kb-menu-registry>', '// </kb-menu-registry>'), cut('// <kb-menu-surfaces>', '// </kb-menu-surfaces>')]
  check('no network call, no timer: the arrangement is read from the page\'s own storage', blocks.every((b) => !/\bfetch\(|XMLHttpRequest|WebSocket|sendBeacon|setTimeout|setInterval/.test(b)))
  check('every window read is guarded (a try block, or a typeof check)', /try \{\n {8}const raw = window\.localStorage\.getItem/.test(blocks[0]) && /if \(typeof window !== 'undefined'\) window\.__KB_MENU_ENTRIES__ = api/.test(blocks[2]))
  check('the source holds no raw U+2028 / U+2029 (a regex literal would not parse)', SRC.indexOf(U2028) < 0 && SRC.indexOf(U2029) < 0)
}

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)

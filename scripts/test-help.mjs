#!/usr/bin/env node
// The help of every plugin: packages/<dir>/help.json, the check that guards it, and the « ? How it works » buttons that
// read it. No browser, no DSH.
//
//   node scripts/test-help.mjs
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { catalogueDuDepot, validerAide } from './build-catalog.mjs'
import { helpSource, describeHelpSource } from './lib-help-source.mjs'

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
check('a file name or a project folder is refused too', throwsWith(() => { const g = good(); g.good.en = 'It is a plain .miniapp.json file.'; validerAide('x', g) }, /does not know \(\.json\)/) && throwsWith(() => { const g = good(); g.steps[0].fr = 'Rangé dans artifacts/ du projet.'; validerAide('x', g) }, /does not know \(artifacts\/\)/))
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

console.log('the link to the article (url, V-06)')
const ARTICLE = 'https://help.kybernos.app/{lang}/features/what-is-remote-control/'
check('« url » is optional: a card without one comes back without one', validerAide('x', good()).url === undefined)
check('a good address comes back as written, with the other fields', (() => { const a = validerAide('x', { ...good(), url: ARTICLE }); return a.url === ARTICLE && a.steps.length === 2 && Object.keys(a).sort().join() === 'good,steps,url,what,where' })())
check('the form « help.kybernos.app/<slug> » passes too, with or without a trailing slash', validerAide('x', { ...good(), url: 'https://help.kybernos.app/skills' }).url === 'https://help.kybernos.app/skills' && validerAide('x', { ...good(), url: 'https://help.kybernos.app/skills/' }).url === 'https://help.kybernos.app/skills/')
check('only the help site: another host, http, a look-alike host, a user name, a port are refused', ['https://example.com/skills', 'http://help.kybernos.app/skills', 'https://help.kybernos.app.evil.example/skills', 'https://help.kybernos.app@evil.example/skills', 'https://help.kybernos.app:8443/skills', 'https://evil.example/https://help.kybernos.app/skills'].every((url) => throwsWith(() => validerAide('x', { ...good(), url }), /url must be an address on help\.kybernos\.app/)))
check('a script, a query, a fragment, a space, an upper-case or empty path are refused', ['javascript:alert(1)', 'https://help.kybernos.app/skills?x=1', 'https://help.kybernos.app/skills#top', 'https://help.kybernos.app/sk ills', 'https://help.kybernos.app/Skills', 'https://help.kybernos.app/', 'https://help.kybernos.app', 'https://help.kybernos.app//skills', 'https://help.kybernos.app/../skills'].every((url) => throwsWith(() => validerAide('x', { ...good(), url }), /url must be an address on help\.kybernos\.app/)))
check('« {lang} » stands for the language of the reader, and only as the first part of the path', throwsWith(() => validerAide('x', { ...good(), url: 'https://help.kybernos.app/features/{lang}/x' }), /url must be/) && throwsWith(() => validerAide('x', { ...good(), url: 'https://help.kybernos.app/{other}/x' }), /url must be/))
check('not a string, or empty: refused', throwsWith(() => validerAide('x', { ...good(), url: 12 }), /url must be/) && throwsWith(() => validerAide('x', { ...good(), url: '' }), /url must be/))
check('the error names the bundle and the field', throwsWith(() => validerAide('kybernos-zz', { ...good(), url: 'https://example.com/a' }), /help\.json of "kybernos-zz": url/))
check('a page card can carry its own article, checked the same way', validerAide('x', { ...good(), pages: { voice: { ...page(), url: 'https://help.kybernos.app/{lang}/agents-and-tools/talk-to-your-assistant-out-loud/' } } }).pages.voice.url === 'https://help.kybernos.app/{lang}/agents-and-tools/talk-to-your-assistant-out-loud/' && throwsWith(() => validerAide('x', { ...good(), pages: { voice: { ...page(), url: 'https://example.com/a' } } }), /pages\.voice\.url must be an address/))

console.log('every bundle has one')
const lifecycle = JSON.parse(readFileSync(join(REPO, 'scripts', 'lifecycle-packages.json'), 'utf8')).packages
let catalogue = null
let cause = ''
try { catalogue = catalogueDuDepot() } catch (e) { cause = String(e.message) }
check('the catalogue builds: every bundle of the lifecycle list has a valid help.json', catalogue !== null, cause)
if (catalogue !== null) {
  check('the catalogue carries the help of every module', catalogue.modules.length === lifecycle.length && catalogue.modules.every((m) => m.aide !== undefined && m.aide.steps.length >= 2))
  // V-06: every card links to its article. These five have none because the help site has no article that is theirs yet (the Suite panel, the core's several
  // pages, the restart helper, the search, the Servers page, the plugin registry, the phone-only runtime): writing one on the site is the way to remove a name from this list, never an address that does not exist.
  const NO_ARTICLE_YET = ['kybernos-hub', 'kybernos-kaby-customisation', 'kybernos-no-process', 'kybernos-plugin', 'kybernos-registry', 'kybernos-relance', 'kybernos-search', 'kybernos-servers', 'kybernos-session-msg']
  const without = catalogue.modules.filter((m) => m.aide.url === undefined).map((m) => m.id).sort()
  check('every module links to an article of the help site, but the nine that have none yet (their card in the product carries the words)', JSON.stringify(without) === JSON.stringify(NO_ARTICLE_YET), without)
  // Where the site's own build is at hand (KB_HELP_SITE=<kybernos-help>/dist-site), each link is an article that exists there, in English.
  const site = process.env.KB_HELP_SITE
  if (typeof site === 'string' && site !== '') {
    const dead = catalogue.modules.filter((m) => m.aide.url !== undefined && /^https:\/\/help\.kybernos\.app\/\{lang\}\//.test(m.aide.url) && !existsSync(join(site, 'en', m.aide.url.replace(/^https:\/\/help\.kybernos\.app\/\{lang\}\//, ''), 'index.html'))).map((m) => m.id + ' → ' + m.aide.url)
    check('each link is an article the help site really has (KB_HELP_SITE)', dead.length === 0, dead)
  } else console.log('  ○ the links are not compared with the site (set KB_HELP_SITE=<kybernos-help>/dist-site to do it)')
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
  check('the Agent presets page (a page of DSH itself, drawn by no plugin) has its own card in the core bundle, and the hub asks for exactly that one', core !== undefined && core.aide.pages.presets !== undefined && /preset/i.test(core.aide.pages.presets.title.en) && /Settings › Agent presets/.test(core.aide.pages.presets.where.en) && /id: 'kybernos-plugin', page: 'presets'/.test(readFileSync(join(REPO, 'packages', 'kybernos-hub', 'client.js'), 'utf8')))
  check('the Voice page has its own card (it is a page of the core bundle, whose general help is about Agent Teams)', core !== undefined && core.aide.pages !== undefined && core.aide.pages.voice !== undefined && /voice/i.test(core.aide.pages.voice.title.en))
  // L6-08: a page card nothing asks for is written, translated and never shown. Every card of a `pages` block is requested by a page:
  // `kbPagePill('key')`, the `help: 'key'` of a settings header, `{ id, page: 'key' }` for a Help, or the hub's CARD map of native pages.
  const clients = readdirSync(join(REPO, 'packages')).filter((d) => existsSync(join(REPO, 'packages', d, 'client.js'))).map((d) => readFileSync(join(REPO, 'packages', d, 'client.js'), 'utf8')).join('\n')
  const asked = (key) => new RegExp("(?:kbPagePill\\('" + key + "'|\\bhelp: '" + key + "'|\\bpage: '" + key + "'|\\bCARD = \\{[^}]*'" + key + "')").test(clients)
  const unasked = catalogue.modules.flatMap((m) => Object.keys(m.aide.pages ?? {}).filter((k) => !asked(k)).map((k) => m.id + ' / ' + k))
  check('every page card of a help.json is asked for by a page (none is written and never shown)', unasked.length === 0, unasked)
  check('...and the check can tell: a card nobody asks for is found', asked('ghost-page') === false && asked('voice') === true)
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
  check('the Suite publishes it (version 1) and shows the same help on a module’s page', /aide = construireAide\(React\); window\.__KB_HELP__ = aide/.test(hub) && /return \{ version: 1, actions: true, Help, Intro \}/.test(hub) && /'data-kb': 'suite-aide'/.test(hub))
  check('the host reads the shipped help of a module by its id', /aides\.get\(m\.id\)/.test(readFileSync(join(REPO, 'packages', 'kybernos-hub', 'suite-host.mjs'), 'utf8')))
  check('a page card that is not there draws nothing (never the bundle’s help on the wrong page)', /const card = page === undefined \? null/.test(hub) && /if \(card === undefined\) return null/.test(hub))
  check('the host shows the help that shipped (page cards included) for every module this copy holds, whatever the online catalogue says', /const aide = livree !== undefined \? livree : m\.aide/.test(readFileSync(join(REPO, 'packages', 'kybernos-hub', 'suite-host.mjs'), 'utf8')))
  check('one « ? How it works » button on the Voice page: the hub pins no second one over it (it did, with a MutationObserver, and the two overlapped)', !/installerAideVoix|AIDE_VOIX|kbhp-voice/.test(hub))
  check('the Voice page asks for its own card', /Help, \{ id: 'kybernos-plugin', page: 'voice' \}/.test(readFileSync(join(REPO, 'packages', 'kybernos-plugin', 'client.js'), 'utf8')))
  // One form of the button on every page (A5-19): the pages that draw it themselves (the core's Agent Teams / Automations, the
  // Calls tabs) copy the Suite's pill declaration for declaration, so the three cannot drift apart unnoticed.
  {
    const decls = (src, selector) => { const m = src.match(new RegExp(selector.replace(/[.[\]]/g, '\\$&') + '\\{([^}]*)\\}')); return m === null ? null : m[1].split(';').map((x) => x.trim()).filter(Boolean) }
    const read = (d) => readFileSync(join(REPO, 'packages', d, 'client.js'), 'utf8')
    const ref = decls(hub, '.kbhp-btn')
    const disc = decls(hub, '.kbhp-q')
    const same = (a, b, extra = []) => a !== null && b !== null && a.every((x) => b.includes(x)) && b.every((x) => a.includes(x) || extra.includes(x))
    check('the core’s pill (Agent Teams, Automations) has the Suite pill’s declarations', same(ref, decls(read('kybernos-plugin'), '.kb6-helpbtn'), ['flex:0 0 auto']), { ref })
    check('the Calls tabs’ pill has the Suite pill’s declarations', same(ref, decls(read('kybernos-call'), '.kbcl-hl')), { ref })
    check('the Language page’s button (it keeps its own panel) has them too', same(ref, decls(read('kybernos-language'), '.kbln-help-btn')), { ref })
    check('and the Atlas page’s, which used to be a plain « Help » button', same(ref, decls(read('kybernos-atlas'), '.kbat-help')), { ref })
    check('and the « ? » disc is the same on all of them', [['kybernos-plugin', '.kb6-helpq'], ['kybernos-call', '.kbcl-hq'], ['kybernos-language', '.kbln-help-q'], ['kybernos-atlas', '.kbat-helpq']].every(([d, sel]) => same(disc, decls(read(d), sel))), { disc })
    const label = (src, re) => re.test(src)
    check('the label is the same words everywhere: « How it works » / « Comment ça marche »', label(hub, /kt\('Comment ça marche', 'How it works'\)/) && label(read('kybernos-plugin'), /'kbui\.howitworks': \{ kybernos: 'Comment ça marche', en: 'How it works' \}/) && label(read('kybernos-call'), /kt\('Comment ça marche', 'How it works'\)/) && label(read('kybernos-language'), /helpBtn: \['Comment ça marche', 'How it works'\]/) && label(read('kybernos-atlas'), /'How it works'\)/))
  }
  const css = hub.match(/\.kbhp-[a-z]+/g) || []
  const clash = []
  for (const d of dirs) {
    if (d === 'kybernos-hub') continue
    const f = join(REPO, 'packages', d, 'client.js')
    if (existsSync(f) && /\.kbh[pi]-/.test(readFileSync(f, 'utf8'))) clash.push(d)
  }
  check('the kbhp- and kbhi- class prefixes are the hub’s alone', css.length > 5 && clash.length === 0, clash)
}

// ── Which text a live check compares a card with (audit 2026-10-16, A3-33) ──
console.log('which source the cards come from (check-help-live)')
{
  const home = mkdtempSync(join(tmpdir(), 'kb-help-source-'))
  const write = (doc) => { mkdirSync(join(home, 'kybernos'), { recursive: true }); writeFileSync(join(home, 'kybernos', 'catalogue-distant.json'), JSON.stringify(doc)) }
  try {
    check('no downloaded catalogue: the cards are the help.json of the checkout', (() => { const x = helpSource({ repo: REPO, home }); return x.cached === false && x.differ.length === 0 && /shipped with this checkout/.test(describeHelpSource(x)) })())
    const shipped = JSON.parse(readFileSync(join(REPO, 'packages', 'kybernos-models', 'help.json'), 'utf8'))
    const reordered = { where: shipped.where, what: shipped.what, steps: shipped.steps, ...(shipped.url === undefined ? {} : { url: shipped.url }), ...(shipped.good === undefined ? {} : { good: shipped.good }) }
    write({ suite: { version: '9.9.9' }, catalogue: { modules: [{ id: 'kybernos-models', aide: reordered }] } })
    check('a downloaded catalogue with the same help (whatever the order of the keys): cached, nothing differs', (() => { const x = helpSource({ repo: REPO, home }); return x.cached === true && x.version === '9.9.9' && x.differ.length === 0 && /say the same/.test(describeHelpSource(x)) })())
    write({ suite: { version: '9.9.9' }, catalogue: { modules: [{ id: 'kybernos-models', aide: { ...reordered, steps: [{ fr: 'Ancienne étape.', en: 'An older step.' }, ...shipped.steps.slice(1)] } }, { id: 'kybernos-nowhere', aide: { what: {} } }] } })
    check('a catalogue one release behind: the module whose help differs is named, with the version', (() => { const x = helpSource({ repo: REPO, home }); const d = describeHelpSource(x); return x.differ.join() === 'kybernos-models' && /9\.9\.9/.test(d) && /kybernos-models/.test(d) && /next signed release/.test(d) })())
    writeFileSync(join(home, 'kybernos', 'catalogue-distant.json'), 'not json')
    check('an unreadable file is no catalogue (never an error)', helpSource({ repo: REPO, home }).cached === false)
  } finally { rmSync(home, { recursive: true, force: true }) }
  const live = readFileSync(join(REPO, 'scripts', 'check-help-live.mjs'), 'utf8')
  check('the live check says the source of the cards before it compares them', /describeHelpSource\(source\)/.test(live) && /helpSource\(\{ repo: REPO, home: dshHome\(\) \}\)/.test(live))
}

console.log('\n' + pass + ' ✓  ' + fail + ' ✗')
process.exit(fail === 0 ? 0 : 1)

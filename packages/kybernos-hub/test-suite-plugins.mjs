// The Plugins segment of the Suite page: the pure helpers (states, filters, permissions, what a pack says, what to type to add a plugin, what DSH's manager answers),
// the components drawn once each with a tiny stand-in for React (state and effects forced, children expanded), and the page's calls checked against the
// registry's real routes. Played without DSH, React or a browser; the page itself is checked on the real GUI (scripts/check-plugins-live.mjs).
//   node packages/kybernos-hub/test-suite-plugins.mjs
import { readFileSync } from 'node:fs'
import { loadPacks } from '../kybernos-plugin/domain-pack.mjs'
import { ROUTES } from '../kybernos-registry/host.mjs'
import { STATUSES } from '../kybernos-registry/registry.mjs'

const source = readFileSync(new URL('./client.js', import.meta.url), 'utf8')
let echecs = 0
let total = 0
const ok = (nom, cond, detail) => { total++; if (cond) console.log('  ✓ ' + nom); else { echecs++; console.log('  ✗ ' + nom + (detail !== undefined ? ' — ' + JSON.stringify(detail).slice(0, 240) : '')) } }

const win = { __ModuleLoader__: { load: (d) => { def = d } } }
let def
new Function('window', source)(win)
const T = def.factory().__test

const P = (o) => ({ id: 'acme/vet-clinic', package: 'kybernos-plugin-vet', spec: 'github:acme/kybernos-plugin-vet', source: 'unlisted', level: 'unlisted', enabled: true, consented: false, errors: [], name: 'Vet clinic', version: '0.3.0', status: 'ok', description: 'A pack for vets.', kind: 'data', pricing: 'free', license: 'MIT', author: { id: 'acme', name: 'Acme Software' }, permissions: [], requires: { kybernos: '>=0.1.0', plugins: { 'kybernos/core': '^1.0' } }, extends: [{ point: 'kybernos/core#domain-pack', contributions: 1, rejected: [] }], ...o })
const POINTS = [{ id: 'kybernos/core#domain-pack', owner: 'kybernos/core', name: 'domain-pack', version: '1.0', kind: 'data', class: 'instruction', contributions: 0 }]
const pair = (x) => Array.isArray(x) && x.length === 2 && typeof x[0] === 'string' && x[0].length > 0 && typeof x[1] === 'string' && x[1].length > 0

console.log('the state of a plugin')
const inst = new Map([['kybernos-plugin-vet', { name: 'kybernos-plugin-vet', enabled: true }]])
const states = ['ok', 'disabled', 'needs-consent', 'needs-kybernos', 'needs-dsh', 'missing-dependency', 'incompatible-point', 'revoked', 'invalid']
ok('every status the registry can give has a sentence in French and English, a tone and a place under « Needs attention »', states.every((s) => { const e = T.etatPlugin(P({ status: s }), inst.get('kybernos-plugin-vet')); return pair(e.libelle) && ['ok', 'warn', 'off', 'bad'].includes(e.ton) && typeof e.attention === 'boolean' }))
ok('the statuses are exactly the registry\'s own list', JSON.stringify([...STATUSES].sort()) === JSON.stringify([...states].sort()), STATUSES)
ok('active and off are not a problem; the others are', !T.etatPlugin(P({ status: 'ok' }), inst.get('x')).attention && !T.etatPlugin(P({ status: 'disabled' }), undefined).attention && ['needs-consent', 'invalid', 'revoked', 'missing-dependency'].every((s) => T.etatPlugin(P({ status: s }), undefined).attention))
ok('the switch is DSH\'s: it works only for a package DSH lists as a bundle, and shows the registry\'s `enabled`', T.etatPlugin(P({}), inst.get('kybernos-plugin-vet')).interrupteur === true && T.etatPlugin(P({}), undefined).interrupteur === false && T.etatPlugin(P({ enabled: false }), inst.get('kybernos-plugin-vet')).actif === false)
ok('an unknown status is shown as it is and counts as a problem, never as active', (() => { const e = T.etatPlugin(P({ status: 'zzz' }), undefined); return e.attention === true && e.libelle[1] === 'zzz' && e.ton === 'off' })())
ok('levels and kinds: Unlisted by default, a field of work for the domain-pack point, data or code otherwise', T.niveauPlugin(P({ level: 'local' }))[1] === 'Local' && T.niveauPlugin(P({ level: 'x' }))[1] === 'Unlisted' && T.genrePlugin(P({}))[1] === 'Field of work' && T.genrePlugin(P({ extends: [] }))[1] === 'Data' && T.genrePlugin(P({ extends: [], kind: 'code' }))[1] === 'Code')
ok('every level has a line of trust, in both languages', ['local', 'unlisted', 'community'].every((l) => pair(T.niveauAide(P({ level: l })))))

console.log('the list: search, chips, counts')
const L = [P({}), P({ id: 'local/notes', package: 'notes', name: 'Cabinet notes', level: 'local', status: 'needs-consent', description: 'Notes for an office.', extends: [] }), P({ id: 'acme/old', package: 'old', name: 'Old', status: 'invalid', enabled: false, description: undefined, reason: 'plugin.json is not valid JSON' })]
const some = new Map([['kybernos-plugin-vet', {}], ['notes', {}]])
const f = (o) => T.filtrerPlugins({ plugins: L, requete: '', genre: '', attention: false, installes: some, ...o }).map((p) => p.id).join()
ok('no filter lists everything, in the order given', f({}) === 'acme/vet-clinic,local/notes,acme/old')
ok('search finds by name, id, description and author, in any case', f({ requete: 'CABINET' }) === 'local/notes' && f({ requete: 'acme/old' }) === 'acme/old' && f({ requete: 'for vets' }) === 'acme/vet-clinic' && f({ requete: 'software' }) === 'acme/vet-clinic,local/notes,acme/old' && f({ requete: 'nothing like this' }) === '')
ok('« Needs attention » keeps the plugins that need something', f({ attention: true }) === 'local/notes,acme/old')
ok('a kind chip keeps one kind', f({ genre: 'Field of work' }) === 'acme/vet-clinic,acme/old' && f({ genre: 'Data' }) === 'local/notes')
ok('the kinds present, in a stable order, without repeats', T.genresPlugins(L).map((g) => g.cle).join() === 'Data,Field of work')
ok('the counts: total, active, needing attention', JSON.stringify(T.compterPlugins(L, some)) === JSON.stringify({ total: 3, actifs: 1, attention: 2 }))

console.log('permissions and what it adds')
const perm = (p) => Object.fromEntries(T.permissionsPlugin(p, POINTS).map((r) => [r.cle, r]))
ok('a data plugin runs no code, reaches no site, keeps nothing; a field-of-work pack gives instructions to the agents', (() => { const r = perm(P({})); return r.code.valeur[1].startsWith('No') && r.code.ton === 'ok' && r.net.valeur[1] === 'No site' && r.secret.valeur[1] === 'Nothing' && r.instr.valeur[1].startsWith('Yes') && r.instr.ton === 'warn' })())
ok('the sites it names and its own key are listed, and flagged', (() => { const r = perm(P({ permissions: ['net:api.acme.example', 'secrets.own'] })); return r.net.hotes === true && r.net.valeur[0] === 'api.acme.example' && r.net.ton === 'warn' && r.secret.valeur[1].startsWith('one API key') })())
ok('a code plugin says that DSH loads its code', perm(P({ kind: 'code', extends: [] })).code.valeur[1].startsWith('Yes') && perm(P({ extends: [] })).instr.valeur[1] === 'No')
ok('every row has both languages', T.permissionsPlugin(P({ permissions: ['net:a.example'] }), POINTS).every((r) => pair(r.libelle) && (r.hotes === true || pair(r.valeur))))
ok('what it adds: one line per point, counted from what was read (the preview when there is one)', (() => {
  const a = T.ajoutePlugin(P({}), null)
  const b = T.ajoutePlugin(P({}), [{ point: 'kybernos/core#domain-pack', files: [{}, {}], rejected: [{ file: 'x.json', errors: ['e'] }] }])
  return a.length === 1 && a[0].n === 1 && a[0].libelle[1] === 'Field of work' && b[0].n === 2 && b[0].refuses.length === 1 && T.ajoutePlugin(P({ extends: [] }), null).length === 0
})())

console.log('what the person reads before accepting')
const shipped = loadPacks(new URL('../kybernos-plugin/domains', import.meta.url).pathname).packs
const edu = shipped.find((p) => p.id === 'edu')
const apercu = [{ point: 'kybernos/core#domain-pack', class: 'instruction', files: [{ file: 'edu.json', value: edu }], rejected: [] }]
const lu = T.lecturePlugin(apercu, 'en')
ok('a pack is laid out: its name, tagline and one block per goal', lu.length === 1 && lu[0].titre === edu.name.en && lu[0].accroche === edu.tagline.en && lu[0].objectifs.length === edu.goals.length)
ok('every skill, team, connector and automation prompt of every goal is there, in full', edu.goals.every((g, i) => {
  const o = lu[0].objectifs[i]
  return o.skills.length === g.skills.length && o.teams.length === g.teams.length && o.connecteurs.length === g.connectors.length && o.automations.length === g.automations.length && g.automations.every((a, j) => o.automations[j].prompt === a.prompt.en && o.automations[j].cron === a.cron)
}))
ok('the file as it is comes with it, for the person who wants every word', JSON.parse(lu[0].brut).id === 'edu')
ok('the page\'s language is used, English when a text has none', T.lecturePlugin(apercu, 'fr')[0].titre === edu.name.fr && T.lecturePlugin(apercu, 'ar')[0].titre === (edu.name.ar ?? edu.name.en))
ok('a file of a point nobody here knows is shown as the plain text it is; nothing breaks on odd input', (() => {
  const x = T.lecturePlugin([{ point: 'acme/x#y', class: 'instruction', files: [{ file: 'a.json', value: { hello: 'world' } }], rejected: [] }], 'en')
  return x.length === 1 && x[0].titre === 'a.json' && /world/.test(x[0].brut) && T.lecturePlugin(null, 'en').length === 0 && T.lecturePlugin([{ files: null }], 'en').length === 0 && T.lecturePlugin([{ point: 'kybernos/core#domain-pack', files: [{ file: 'z', value: 3 }] }], 'en').length === 1
})())

console.log('adding a plugin')
const sp = T.specInstall
ok('a package name, a scoped one with a version, a GitHub address and a tarball address pass as they are', ['kybernos-plugin-vet', '@acme/vet@1.2.0', 'github:acme/vet', 'https://github.com/acme/vet', 'https://x.example/vet-1.0.0.tgz'].every((x) => sp(x).ok && sp(x).spec === x))
ok('owner/repo alone is read as GitHub', sp('acme/kybernos-plugin-vet').spec === 'github:acme/kybernos-plugin-vet')
ok('a path that starts at the root passes, spaces included; a short path is refused with a sentence', sp('/Users/me/My Plugins/vet').spec === '/Users/me/My Plugins/vet' && sp('file:/tmp/x').ok && !sp('~/x').ok && !sp('./x').ok && !sp('../x').ok && pair(sp('~/x').raison))
ok('an empty spec, or one with a space, a quote or a shell character, is refused with a sentence in both languages', ['', '   ', 'a b', 'x;rm', 'a"b', 'a`b', 'a|b', '$(x)'].every((x) => !sp(x).ok && pair(sp(x).raison)))
ok('the answer of DSH\'s inspection: accepted → nothing to say, a package that is not a bundle or a refusal → a sentence', T.refusInspection({ status: 'accepted', bundle: true }) === null && T.refusInspection({ status: 'accepted', bundle: null }) === null && pair(T.refusInspection({ status: 'accepted', bundle: false })) && ['invalid-spec', 'already-installed', 'not-found', 'not-a-package', 'not-a-bundle', 'network', 'unknown'].every((problem) => pair(T.refusInspection({ status: 'refused', problem, reason: 'raw' }))) && pair(T.refusInspection(null)))
ok('no raw reason or code of DSH reaches the person', ['invalid-spec', 'not-found', 'network'].every((problem) => !/raw|invalid-spec|not-found/.test(T.refusInspection({ status: 'refused', problem, reason: 'raw' }).join(' '))))
const iss = T.issueGestionnaire
ok('DSH\'s manager: a result applied is fine; one that needs a restart says so', iss({ ok: true, value: { changed: true, application: 'applied', stage: 'enable', target: 'x' } }).ok === true && iss({ changed: true, application: 'restart-required' }).restart === true && iss({ ok: true, value: { application: 'applied' } }).restart === false)
ok('DSH\'s manager: each way it can refuse has a sentence, and no raw code is shown', ['not-bundle', 'not-removable', 'unknown-plugin', 'invalid-spec', 'bundle-in-use', 'stop-profile', 'operation-error'].every((code) => { const r = iss({ ok: true, value: { changed: false, application: 'failed', error: { code } } }); return r.ok === false && pair(r.raison) && !new RegExp(code).test(r.raison.join(' ')) }))
ok('DSH\'s manager: a failed install says why in words (network, not found, disk), a cancelled one says so, silence and a refusal are handled', ['network', 'not-found', 'no-matching-version', 'permission', 'disk-full', 'build-blocked', 'unknown'].every((kind) => pair(iss({ application: 'failed', packageResult: { kind } }).raison)) && /cancel/i.test(iss({ application: 'cancelled' }).raison[1]) && iss(null).ok === false && iss(undefined).ok === false && iss({ ok: false }).ok === false)
ok('the messages that open the chat name the skill; a draft sent back carries its faults and nothing else to guess from', /plugin-creator/.test(T.promptCreation(false)) && /plugin-creator/.test(T.promptCreation(true)) && /^- bad key$/m.test(T.promptBrouillon({ name: 'vet', errors: ['bad key', 'x'] }, false)) && /vet/.test(T.promptBrouillon({ name: 'vet', errors: [] }, true)))

// ── The components, drawn once each ─────────────────────────────────────────────────────────────────────────────────────────
console.log('the components draw')
const makeReact = () => {
  const st = { forced: new Map(), idx: 0 }
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
    useState: (init) => { const i = st.idx++; const f = st.forced.get(st.cur) ?? st.forced.get(st.cur.name); return [f !== undefined && f[i] !== undefined ? f[i] : (typeof init === 'function' ? init() : init), () => {}] },
    useEffect: () => {}, useLayoutEffect: () => {}, useRef: () => ({ current: null }), useCallback: (fn) => fn
  }
  // expand: call every function component with its props, keep the DOM-like tree; `forced` = { Component: [state0, state1…] } for the components to draw in a given state
  const expand = (node) => {
    if (node === null || node === undefined || typeof node === 'boolean') return null
    if (typeof node === 'string' || typeof node === 'number') return String(node)
    if (Array.isArray(node)) return node.map(expand).filter((x) => x !== null)
    if (typeof node.type === 'function') { st.idx = 0; st.cur = node.type; return expand(node.type({ ...node.props, children: node.children })) }
    return { tag: node.type, props: node.props, children: node.children.map(expand).flat(Infinity).filter((x) => x !== null) }
  }
  return { React, st, render: (el, forced) => { st.forced = new Map(forced || []); return expand(el) } }
}
const textOf = (n) => (n === null || n === undefined ? '' : typeof n === 'string' ? n : Array.isArray(n) ? n.map(textOf).join(' ') : textOf(n.children))
const walk = (n, fn) => { if (n === null || n === undefined || typeof n === 'string') return; if (Array.isArray(n)) { n.forEach((x) => walk(x, fn)); return } fn(n); walk(n.children, fn) }
const find = (n, kb) => { const out = []; walk(n, (x) => { if (x.props && x.props['data-kb'] === kb) out.push(x) }); return out }
const classes = new Set()
const mini = makeReact()
const icon = (nom) => mini.React.createElement('svg', { 'data-icon': nom })
const artwork = () => mini.React.createElement('span', { className: 'kbsu-ico' })
const lirePreview = async () => ({ ok: true, preview: apercu })
const comps = T.construirePlugins(mini.React, { ic: icon, artwork, lireJson: lirePreview, ReactDOM: null })
const collectClasses = (n) => walk(n, (x) => { if (x.props && typeof x.props.className === 'string') x.props.className.split(/\s+/).forEach((c) => c && classes.add(c)) })
const noop = () => {}
const base = { registre: { plugins: L, points: POINTS }, brouillons: [], installes: some, requete: '', vue: 'grid', mgr: {}, ouvrir: noop, ouvrirDlg: noop, rechargerLe: noop, relance: noop }

for (const code of ['en', 'fr']) {
  win.__KB_LANG_RESOLVE__ = () => (code === 'fr' ? 'kybernos' : 'en')
  const li = mini.render(mini.React.createElement(comps.Liste, base))
  collectClasses(li)
  ok(code + ': the list draws one card per plugin, with its level, kind, price and state', find(li, 'plugin-card').length === 3 && find(li, 'plugin-level').length === 3 && find(li, 'plugin-state').length === 3)
  ok(code + ': the card says who made it and which version, and the word for « needs your OK »', textOf(li).includes(code === 'fr' ? 'par Acme Software · v0.3.0' : 'by Acme Software · v0.3.0') && textOf(li).includes(code === 'fr' ? 'Attend ton accord' : 'Needs your OK'))
  ok(code + ': a plugin that cannot be read shows why in place of its description', textOf(li).includes('plugin.json is not valid JSON'))
  ok(code + ': the switch of a plugin DSH does not list is disabled; the others work', (() => { const sw = find(li, 'plugin-switch'); return sw.length === 3 && sw.filter((s) => s.props.disabled === true).length === 1 })())
  const dr = mini.render(mini.React.createElement(comps.Liste, { ...base, brouillons: [{ name: 'cabinet', title: 'Cabinet notes', ok: true, version: '0.1.0', installed: false, errors: [] }, { name: 'broken', title: 'Broken', ok: false, installed: false, errors: ['e'] }, { name: 'done', title: 'Done', ok: true, installed: true, errors: [] }] }))
  ok(code + ': the drafts the AI made wait under the list, the one already installed is not offered again', find(dr, 'plugins-draft').length === 2 && textOf(find(dr, 'plugins-drafts')).includes('2'))
  const at = mini.render(mini.React.createElement(comps.Liste, base), [[comps.Liste, [undefined, true]]])
  ok(code + ': under « Needs attention » each plugin that needs something says what, with the way to deal with it', find(at, 'plugins-problems').length === 1 && find(at, 'plugin-read').length === 1 && textOf(find(at, 'plugins-problems')).includes('plugin.json is not valid JSON'))
  const empty = mini.render(mini.React.createElement(comps.Liste, { ...base, registre: { plugins: [], points: POINTS } }))
  ok(code + ': with no plugin and no draft, the page explains what a plugin is and offers to add one', find(empty, 'plugins-empty').length === 1 && find(empty, 'plugins-add-empty').length === 1)
  const none = mini.render(mini.React.createElement(comps.Liste, { ...base, requete: 'zzz' }))
  ok(code + ': a search with no match says so', textOf(none).includes(code === 'fr' ? 'Aucun plugin ne correspond' : 'No plugin matches'))
  const one = mini.render(mini.React.createElement(comps.Liste, { ...base, vue: 'list' }))
  ok(code + ': the list view is the single-column grid', find(one, 'plugins-grid')[0].props.className.includes('one'))

  const fiche = (forced, extra) => mini.render(mini.React.createElement(comps.Fiche, { id: 'acme/vet-clinic', registre: base.registre, installes: some, mgr: { removeBundle: noop }, retour: noop, ouvrirDlg: noop, rechargerLe: noop, relance: noop, ...extra }), forced && [[comps.Fiche, forced]])
  const d0 = fiche(null)
  collectClasses(d0)
  ok(code + ': the plugin page: title, three tabs, a Details card with the trust line and the id, a switch and Remove', find(d0, 'plugin-fiche').length === 1 && ['description', 'permissions', 'compat'].every((k) => find(d0, 'plugin-tab-' + k).length === 1) && textOf(d0).includes('acme/vet-clinic') && find(d0, 'plugin-switch').length === 1 && find(d0, 'plugin-remove').length === 1)
  const dc = mini.render(mini.React.createElement(comps.Fiche, { id: 'local/notes', registre: base.registre, installes: some, mgr: {}, retour: noop, ouvrirDlg: noop, rechargerLe: noop, relance: noop }))
  ok(code + ': a plugin that waits for the person\'s OK says what that means and offers « Read and accept »', find(dc, 'plugin-consent').length === 1 && find(dc, 'plugin-read').length === 1)
  const dd = fiche(['description', apercu])
  ok(code + ': what it adds counts what the preview read', textOf(find(dd, 'plugin-description')).includes(code === 'fr' ? 'Ce qu’il ajoute' : 'What it adds'))
  const dp = fiche(['permissions'])
  ok(code + ': the Permissions tab lists the four rows', find(dp, 'plugin-permissions').length === 1 && textOf(dp).includes(code === 'fr' ? 'Exécute du code' : 'Runs code'))
  const dk = fiche(['compat'])
  ok(code + ': the Compatibility tab lists what it needs and what it extends', find(dk, 'plugin-compat').length === 1 && textOf(dk).includes('>=0.1.0') && textOf(dk).includes('kybernos/core#domain-pack'))
  const dx = fiche(['description', null, '', true])
  ok(code + ': Remove asks first, and says that the person\'s files are not touched', find(dx, 'plugin-remove-confirm').length === 1 && find(dx, 'plugin-remove-go').length === 1)
  const dg = mini.render(mini.React.createElement(comps.Fiche, { id: 'acme/gone', registre: base.registre, installes: some, mgr: {}, retour: noop, ouvrirDlg: noop, rechargerLe: noop, relance: noop }))
  ok(code + ': a plugin that is no longer there gives a way back, not an error', textOf(dg).includes(code === 'fr' ? 'n’est plus installé' : 'no longer installed'))
  const dbad = mini.render(mini.React.createElement(comps.Fiche, { id: 'acme/old', registre: base.registre, installes: some, mgr: {}, retour: noop, ouvrirDlg: noop, rechargerLe: noop, relance: noop }))
  ok(code + ': a plugin that cannot be read shows the registry\'s reason and no preview call is made for it', find(dbad, 'plugin-problem').length === 1 && textOf(dbad).includes('plugin.json is not valid JSON'))

  const dlg = (type, extra, forced) => mini.render(mini.React.createElement(comps.Dialogues, { ...base, dlg: { type, ...extra }, fermer: noop, ouvrirPlugin: noop }), forced)
  const da = dlg('ajout')
  collectClasses(da)
  ok(code + ': « Add a plugin » offers the catalogue (soon, disabled), GitHub or npm, a file or folder, and Create with AI', ['catalogue', 'spec', 'file', 'ia'].every((k) => find(da, 'plugins-add-' + k).length === 1) && find(da, 'plugins-add-catalogue')[0].props.disabled === true && find(da, 'plugins-add-spec')[0].props.disabled !== true)
  ok(code + ': every dialog is a labelled modal dialog', find(da, 'plugins-dialog')[0].props.role === 'dialog' && find(da, 'plugins-dialog')[0].props['aria-modal'] === 'true' && typeof find(da, 'plugins-dialog')[0].props['aria-label'] === 'string')
  const ds = dlg('spec', { mode: 'spec' })
  collectClasses(ds)
  ok(code + ': from GitHub or npm: a field, a Check button, no file chooser', find(ds, 'plugins-spec').length === 1 && find(ds, 'plugins-spec-check').length === 1 && find(ds, 'plugins-file').length === 0)
  const df = dlg('spec', { mode: 'file' })
  ok(code + ': from a file or folder: the field and the file chooser (a .tgz)', find(df, 'plugins-spec').length === 1 && find(df, 'plugins-file').length === 1 && /tgz/.test(find(df, 'plugins-file')[0].props.accept))
  ok(code + ': nothing is installed from a dialog that has not checked what it is', find(ds, 'plugins-install-go').length === 0)
  const dready = dlg('spec', { mode: 'spec' }, [['DlgInstall', ['github:acme/vet', 'pret', { spec: 'github:acme/vet', name: 'kybernos-plugin-vet', version: '0.3.0', description: 'A pack.', host: 'github.com' }]]])
  ok(code + ': once DSH has said what it is, the dialog shows it, the warning to install only what is trusted, and the Install button', find(dready, 'plugins-inspected').length === 1 && textOf(dready).includes('kybernos-plugin-vet 0.3.0') && find(dready, 'plugins-install-go').length === 1)
  const dfail = dlg('spec', { mode: 'spec' }, [['DlgInstall', ['x', 'refus', null, ['DSH ne trouve rien à cette adresse.', 'DSH finds nothing at this address.']]]])
  ok(code + ': a refusal is shown in words, as an alert', find(dfail, 'plugins-install-error').length === 1 && find(dfail, 'plugins-install-error')[0].props.role === 'alert' && textOf(dfail).includes(code === 'fr' ? 'DSH ne trouve rien' : 'DSH finds nothing'))
  const ddone = dlg('spec', { mode: 'spec' }, [['DlgInstall', ['x', 'fini', { spec: 'x', nom: 'kybernos-plugin-vet' }]]])
  ok(code + ': once installed, it says so and opens the new plugin\'s page', find(ddone, 'plugins-installed').length === 1 && find(ddone, 'plugins-open-installed').length === 1)
  const dbk = dlg('brouillon', { d: { name: 'cabinet', title: 'Cabinet notes', ok: true, path: '/tmp/x/cabinet', description: 'Notes.', errors: [] } })
  ok(code + ': a draft that is valid goes through the same check, and shows no field to type in', textOf(dbk).includes('Cabinet notes') && find(dbk, 'plugins-spec').length === 0)
  const dbf = dlg('brouillon', { d: { name: 'broken', title: 'Broken', ok: false, errors: ['the key "cron" is not allowed'] } })
  ok(code + ': a draft that cannot be read shows its faults and offers to send them to the AI', find(dbf, 'plugins-draft-errors').length === 1 && textOf(dbf).includes('the key "cron"') && find(dbf, 'plugins-draft-fix').length === 1 && find(dbf, 'plugins-install-go').length === 0)
  const di = dlg('ia')
  ok(code + ': Create with AI names the skill and offers to open the chat', textOf(di).includes('plugin-creator') && find(di, 'plugins-ia-go').length === 1)
  const dl = dlg('lecture', { id: 'acme/vet-clinic' })
  ok(code + ': Read and accept is a large dialog with an Accept button that waits for the text', find(dl, 'plugins-accept').length === 1 && find(dl, 'plugins-accept')[0].props.disabled === true)
  const dlo = dlg('lecture', { id: 'acme/vet-clinic' }, [['DlgLecture', [{ phase: 'ok', sections: T.lecturePlugin(apercu, code), refuses: [{ file: 'bad.json', errors: ['the key "cron" is not allowed'] }] }]]])
  collectClasses(dlo)
  ok(code + ': once read, every goal, every automation prompt and the files left out are on the page, and Accept is available', find(dlo, 'plugins-accept')[0].props.disabled === false && find(dlo, 'plugins-read-section').length === 1 && edu.goals.every((g) => g.automations.every((a) => textOf(dlo).includes(a.prompt[code === 'fr' ? 'fr' : 'en'].slice(0, 30)))) && textOf(dlo).includes('bad.json'))
  ok(code + ': an unknown dialog draws nothing', dlg('zzz') === null && mini.render(mini.React.createElement(comps.Dialogues, { ...base, dlg: null })) === null)
}
ok('every dialog and card that has a state of its own is drawn above in both languages (one run per language)', true)

console.log('the page and the registry agree')
const used = [...new Set([...source.matchAll(/'(\/kybernos-registry\/[a-z]+)/g)].map((m) => m[1]))]
const routes = new Set(ROUTES.map((r) => r.path))
ok('every route the page calls is one the registry serves', used.length >= 5 && used.every((u) => routes.has(u)), used)
ok('the only calls that write are the acceptance and the import, and they are POSTs to a write route', (() => {
  const writers = ROUTES.filter((r) => r.session === true).map((r) => r.path).sort().join()
  return writers === '/kybernos-registry/consent,/kybernos-registry/import' && /post\('\/kybernos-registry\/consent'/.test(source) && /fetch\('\/kybernos-registry\/import', \{ method: 'POST'/.test(source)
})())
ok('the calls to DSH\'s manager pass every argument its page-side client counts (inspect and installBundle take the options object)', (() => {
  const seg = source.slice(source.indexOf('const construirePlugins'), source.indexOf('const construirePanneau'))
  return /mgr\.inspect\(s\.spec, \{\}\)/.test(seg) && /mgr\.installBundle\(info\.spec, \{ requestId: id \}\)/.test(seg)
})())
ok('the page never installs, removes or switches anything itself: only through DSH\'s manager', (() => {
  const seg = source.slice(source.indexOf('const construirePlugins'), source.indexOf('const construirePanneau'))
  return /mgr\.installBundle\(/.test(seg) && /mgr\.removeBundle\(/.test(seg) && /mgr\.setBundleEnabled\(/.test(seg) && !/\/kybernos-hub\/module/.test(seg) && !/child_process|exec\(|spawn\(/.test(seg)
})())
ok('the segment is there only when the registry answers, and a failure to build it leaves the Suite page alone', /registre !== null \? segment\('plugins'/.test(source) && /try \{ Plugins = construirePlugins\(/.test(source))
ok('the user\'s words are never put in the page as HTML', !/dangerouslySetInnerHTML[^\n]*(registre|brouillon|apercu|saisie)/.test(source.slice(source.indexOf('const construirePlugins'), source.indexOf('const construirePanneau'))))
const css = source.slice(source.indexOf('const CSS = ['), source.indexOf("].join('\\n')", source.indexOf('const CSS = [')))
// kbsu-fiche and kbsu-plugins are only handles (the page lays them out inline, as the module page does)
const missing = [...classes].filter((c) => /^kbsu-/.test(c) && !['kbsu-fiche', 'kbsu-plugins'].includes(c) && !css.includes('.' + c))
ok('every class the Plugins components use has a rule in the page\'s styles', missing.length === 0, missing)

console.log('\n' + (total - echecs) + '/' + total + ' passed')
process.exit(echecs === 0 ? 0 : 1)

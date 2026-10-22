// Tests of the Servers page: what the source promises (always), and every state of the screen rendered as static markup (when React is found).
//   node packages/kybernos-servers/test-client.mjs
// The view is a function of (data, ui): each state is rendered here, in French and in English. Interaction is proven in the GUI by
// scripts/check-servers-live.mjs. The render half needs React (KB_REACT_DIR, or a known location); CI has none, so it says so and skips.
//   SRV-03 · SRV-12 (no licence anywhere) · SRV-13 (the Enterprise card) · SRV-14 (the help card) · the packaging contract
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ROUTES } from './host.mjs'

const here = dirname(fileURLToPath(import.meta.url))
let failed = 0
const check = (name, ok, detail) => { console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok || detail === undefined ? '' : '  — ' + JSON.stringify(detail))); if (!ok) failed += 1 }
const read = (f) => readFileSync(join(here, f), 'utf8')
const SOURCE = read('client.js')

console.log('SRV-12 there is no licence anywhere in the code path')
{
  const words = /licen[cs]e/i
  const code = ['client.js', 'host.mjs', 'index.js', 'discovery.mjs', 'registry.mjs', 'help.json']
  check('no licence word in the page, the routes, the rules or the help', code.every((f) => !words.test(read(f))), code.filter((f) => words.test(read(f))))
  check('nor in the manifest (its own « license » field, the package\'s open-source licence, is the only one)', !words.test(read('package.json').replace(/"license": "Apache-2\.0",?/, '')))
  check('the detector is not blind: it flags a licence route, a licence sentence and a licence file name', words.test("path: '/kybernos-servers/licence'") && words.test('Licence expired') && words.test('licence-servers.json'))
  check('there is no route that installs or checks one', !ROUTES.some((r) => words.test(r.path)), ROUTES.map((r) => r.path))
}

console.log('the packaging contract')
{
  const pkg = JSON.parse(read('package.json'))
  check('an Apache-2.0 bundle named @local/kybernos-servers with a client and a host entry', pkg.name === '@local/kybernos-servers' && pkg.license === 'Apache-2.0' && pkg.exports['.'] === './index.js' && pkg.exports['./client'] === './client.js' && pkg.dsh.client.platform === 'web')
  check('the bundle patch inserts it in the layer stack', /id: kybernos-servers/.test(read('cordis.patch.yml')) && /name: '@local\/kybernos-servers'/.test(read('cordis.patch.yml')))
  check('the host entry exports apply and never throws without a web server', await (async () => { const m = await import('./index.js'); try { m.apply({ get: () => undefined, inject: () => { throw new Error('no service') }, effect: () => {} }); return typeof m.apply === 'function' } catch (e) { return false } })())
  check('the client entry returns a plugin even when it fails (the factory is guarded)', /catch \(e\) \{\s*try \{ console\.warn\('\[kybernos-servers\] disabled:'/.test(SOURCE) && /return \{ apply \(\) \{\} \}/.test(SOURCE))
  check('it registers one Settings section, id kybernos-servers', /slots\.inject\('settings\.section'/.test(SOURCE) && /id: 'kybernos-servers'/.test(SOURCE))
  const stripped = SOURCE.replace(/var\([^()]*(?:\([^()]*\)[^()]*)*\)/g, 'var()')
  check('no hard-coded colour outside a var() fallback', !/#[0-9a-fA-F]{3,8}\b/.test(stripped.replace(/color-mix\([^)]*\)/g, '')) , (stripped.match(/#[0-9a-fA-F]{3,8}\b/g) || []).slice(0, 5))
  check('Escape closes the add and the confirm dialogs (spec § 4.10); it is taken in the capture phase and stopped, so DSH\'s own Escape does not close Settings behind it (found live)', /e\.key !== 'Escape'/.test(SOURCE) && /e\.stopPropagation\(\)/.test(SOURCE) && /window\.addEventListener\('keydown', onKey, true\)/.test(SOURCE) && /window\.removeEventListener\('keydown', onKey, true\)/.test(SOURCE))
  check('inputs are sized with the border box (found live: a 100 % wide field with padding stuck out of its dialog)', /\.kbsv-page,\.kbsv-page \*,\.kbsv-veil,\.kbsv-veil \*\{box-sizing:border-box\}/.test(SOURCE))
  check('every string the person reads goes through kt(fr, en); hooks are data-kb', (SOURCE.match(/data-kb/g) || []).length > 25 && /const kt = /.test(SOURCE))
  const calls = [...SOURCE.matchAll(/api\('(?:GET|POST)', '([^']+)'/g)].map((m) => m[1])
  const mine = calls.filter((p) => p.startsWith('/kybernos-servers/'))
  check('every route the page calls on this plugin exists, with the right method', mine.length >= 5 && mine.every((p) => ROUTES.some((r) => r.path === p)), mine)
  const cloudSrc = readFileSync(join(here, '..', 'kybernos-cloud', 'index.js'), 'utf8')
  check('the two cloud routes it uses for the sign-in exist in the cloud half', calls.filter((p) => p.startsWith('/kybernos-cloud/')).every((p) => cloudSrc.includes("'" + p + "'")), calls.filter((p) => p.startsWith('/kybernos-cloud/')))
  check('leaving the address field does not check again an address that is already checked (found live: the blur caused by pressing « Add and sign in » made the result vanish and the click was lost)', /add\.result !== null && add\.checkedFor === address\) return/.test(SOURCE) && /checkedFor: address/.test(SOURCE))
  check('no address of a Kybernos host is written in the code (a server is typed by the person)', !/kybernos\.app/.test(SOURCE.replace(/help\.kybernos\.app/g, '')) )
}

console.log('SRV-14 the help card')
{
  const help = JSON.parse(read('help.json'))
  const both = (v) => typeof v.fr === 'string' && v.fr.trim() !== '' && typeof v.en === 'string' && v.en.trim() !== ''
  check('what, 2 to 4 steps, where and good, each in French and in English (the catalogue build checks lengths and words)', both(help.what) && help.steps.length >= 2 && help.steps.length <= 4 && help.steps.every(both) && both(help.where) && both(help.good) && help.where.page === true)
  check('it says what to do: paste the address, sign in with the account, switch, remove', /adresse/i.test(help.steps[0].fr) && /address/i.test(help.steps[0].en) && /compte/i.test(help.steps[1].fr) && /account/i.test(help.steps[1].en))
  check('the page asks for it behind a guard (nothing breaks when the Suite is absent)', /typeof window !== 'undefined' && window\.__KB_HELP__ && window\.__KB_HELP__\.Help \? h\('span', \{ className: 'kbsv-help' \}, h\(window\.__KB_HELP__\.Help, \{ id: 'kybernos-servers' \}\)\) : null/.test(SOURCE))
}

// ── The render half ──
const candidates = [process.env.KB_REACT_DIR, '/opt/homebrew/lib/node_modules/@openhands/agent-canvas/node_modules', join(here, 'node_modules')].filter(Boolean)
const reactDir = candidates.find((d) => existsSync(join(d, 'react', 'package.json')) && existsSync(join(d, 'react-dom', 'package.json')))
if (reactDir === undefined) {
  console.log('\n  ○ SKIPPED, the render half: React not found (set KB_REACT_DIR to a node_modules that holds react and react-dom). The source checks above ran.')
  console.log(failed === 0 ? '\nall good (render half SKIPPED)' : '\n' + failed + ' failed')
  process.exit(failed === 0 ? 0 : 1)
}
const req = createRequire(join(reactDir, 'x.js'))
const React = req('react'); const { renderToStaticMarkup } = req('react-dom/server')

let fetched = 0
// One window for every load of the client: the language is read from it at render time, whichever copy of the page is rendered.
const WIN = { __KB_LANG_RESOLVE__: () => 'en' }
const DOC = { getElementById: () => null, createElement: () => ({ setAttribute () {} }), head: { appendChild () {} }, addEventListener () {}, removeEventListener () {} }
const load = (contact) => {
  let def = null
  WIN.__ModuleLoader__ = { load: (d) => { def = d } }
  globalThis.window = WIN
  globalThis.document = DOC
  globalThis.fetch = async () => { fetched += 1; return { json: async () => ({}) } }
  const src = contact === undefined ? SOURCE : SOURCE.replace("const ENTERPRISE_CONTACT = ''", "const ENTERPRISE_CONTACT = '" + contact + "'")
  new Function('window', 'document', src)(WIN, DOC)
  return def.factory((name) => { if (name === 'react') return React; throw new Error('unexpected require ' + name) })
}
const mod = load()
const { View, AddDialog, SigninDialog, Confirm, say, doneMessage, ERR, NEW_ADD, addressesOf } = mod.__test
const lang = (l) => { globalThis.window.__KB_LANG_RESOLVE__ = () => l }
const noop = () => {}
const act = new Proxy({}, { get: () => noop })
const ui0 = { details: {}, names: {}, add: null, signin: null, confirm: null, message: null }
const BUILTIN = { id: 'kybernos-cloud', name: 'Kybernos Cloud', api: 'https://api.kybernos.app', llm: 'api', connections: false, active: true, connected: true }
const ACME = { id: 'acme-corp', name: 'Acme Corp', api: 'https://kb.acme.corp', llm: 'api', connections: true, active: false, connected: false, web: 'https://kb.acme.corp/app' }
const cloudOf = (servers) => ({ server: servers.find((s) => s.active), servers, source: 'default', rejected: [] })
const render = (data, ui = {}) => renderToStaticMarkup(React.createElement(View, { data, ui: Object.assign({}, ui0, ui), act }))
const both = (fn) => { lang('en'); const en = fn(); lang('fr'); const fr = fn(); lang('en'); return { en, fr } }

console.log('the list')
{
  const { en, fr } = both(() => render({ cloud: cloudOf([BUILTIN]) }))
  check('Kybernos Cloud is listed as « Managed by Kybernos », active and signed in, with no Remove and no address line', en.includes('Kybernos Cloud') && en.includes('Managed by Kybernos') && en.includes('>Active<') && en.includes('>Signed in<') && !en.includes('data-kb="servers-remove"') && !en.includes('api.kybernos.app'), en)
  check('the same in French', fr.includes('Hébergé par Kybernos') && fr.includes('>Actif<') && fr.includes('>Connecté<'))
  check('with only the built-in server there is no banner and no Sign-in button', !en.includes('servers-banner') && !en.includes('servers-signin'))
  const many = render({ cloud: cloudOf([Object.assign({}, BUILTIN, { active: false }), Object.assign({}, ACME, { active: true })]) })
  check('an active server that is not Kybernos Cloud: the banner names it and offers the way back', many.includes('servers-banner') && many.includes('You are on Acme Corp') && many.includes('Back to Kybernos Cloud') && many.includes('data-kb="servers-back"'))
  check('an active server this DSH is not signed in to offers « Sign in »; a listed one offers « Switch to this server »', many.includes('data-kb="servers-signin"') && many.includes('Not signed in') && many.includes('data-kb="servers-switch"'))
  check('a server shows its host as its second line, never a kind or a « test » tag', many.includes('kb.acme.corp') && !/\btest\b/i.test(many.replace(/<style[\s\S]*?<\/style>/g, '')) && !many.includes('Enterprise server') )
  const det = render({ cloud: cloudOf([BUILTIN, ACME]) }, { details: { 'acme-corp': true } })
  check('Details shows the addresses (the app at the published web address + /account), the connected apps, and a Rename field with its Save button', det.includes('https://kb.acme.corp/app/account') && det.includes('Web app') && det.includes('offered') && det.includes('data-kb="servers-rename"') && det.includes('data-kb="servers-rename-go"'), det)
  check('there is one app: Details name no console address and no « Console » line (the old console page is not a place the sign-in goes)', !/workspace-console/.test(det) && !/>Console</.test(det))
  const detPlain = render({ cloud: cloudOf([BUILTIN, Object.assign({}, ACME, { web: undefined })]) }, { details: { 'acme-corp': true } })
  check('without a published web address the app is at the api host + /account', detPlain.includes('https://kb.acme.corp/account'))
  const detCloud = render({ cloud: cloudOf([BUILTIN, ACME]) }, { details: { 'kybernos-cloud': true } })
  check('the built-in server\'s Details have no Rename', detCloud.includes('servers-det') && !detCloud.includes('data-kb="servers-rename"'))
  const missing = render({ cloud: null })
  check('without the cloud half: one sentence, no list', missing.includes('servers-missing') && missing.includes('The Cloud module does not answer') && !missing.includes('servers-row'))
}

console.log('SRV-13 the Enterprise card')
{
  fetched = 0
  const one = render({ cloud: cloudOf([BUILTIN]) })
  const several = render({ cloud: cloudOf([Object.assign({}, BUILTIN, { active: false }), Object.assign({}, ACME, { active: true })]) })
  check('it is under the list whether there is one server or several', one.includes('servers-enterprise') && several.includes('servers-enterprise'))
  check('four points: your own server, your skills, your own API keys, control', ['Your own server', 'Your skills', 'Your own API keys', 'Control'].every((t) => one.includes(t)))
  check('« My company already has a server » is there; « Talk to us » is not, since no contact address is set', one.includes('data-kb="servers-enterprise-add"') && !one.includes('servers-contact') && !one.includes('Talk to us'))
  const wired = load('https://example.com/contact').__test
  const withContact = renderToStaticMarkup(React.createElement(wired.View, { data: { cloud: cloudOf([BUILTIN]) }, ui: ui0, act }))
  check('with a contact address set, « Talk to us » is a real link that opens a new tab safely', /<a [^>]*data-kb="servers-contact"[^>]*href="https:\/\/example\.com\/contact"[^>]*target="_blank"[^>]*rel="noopener noreferrer"/.test(withContact) || (/data-kb="servers-contact"/.test(withContact) && /rel="noopener noreferrer"/.test(withContact)), withContact.slice(withContact.indexOf('servers-contact') - 80, withContact.indexOf('servers-contact') + 200))
  check('rendering the page (card included) makes no network call', fetched === 0, fetched)
  const fr = both(() => render({ cloud: cloudOf([BUILTIN]) })).fr
  check('French copy, no developer word', fr.includes('Fais tourner Kybernos sur ton propre serveur') && !/\b(slot|bundle|endpoint|webServer)\b/i.test(fr.replace(/<style[\s\S]*?<\/style>/g, '')))
}

console.log('SRV-03 and the add dialog')
{
  const A = (over) => Object.assign(NEW_ADD(), over)
  const view = (add) => renderToStaticMarkup(React.createElement(AddDialog, { add, act }))
  const empty = view(A({}))
  check('empty: an address field to paste into, « Add and sign in » disabled, nothing else offered (no licence, no key, no password)', empty.includes('data-kb="servers-address"') && /data-kb="servers-add-go"[^>]*disabled=""/.test(empty) && !/key|password|licen/i.test(empty.replace(/<style[\s\S]*?<\/style>/g, '').replace(/aria-[a-z]+="[^"]*"/g, '')), empty)
  const checking = view(A({ address: 'kb.acme.corp', busy: true }))
  check('checking: it says so, and the button is still disabled', checking.includes('Checking…') && /data-kb="servers-add-go"[^>]*disabled=""/.test(checking))
  const found = { ok: true, steps: [], host: 'kb.acme.corp', published: 'Acme Corp', suggested: 'Acme Corp', profile: { api: 'https://kb.acme.corp', services: { connections: false } } }
  const okV = view(A({ address: 'kb.acme.corp', result: found }))
  check('found: the name, the host, « only go to <host> », the sign-in sentence, what changes; the button is enabled', okV.includes('Acme Corp') && okV.includes('server checked') && okV.includes('will only go to') && okV.includes('<b>kb.acme.corp</b>') && okV.includes('your account on this server') && okV.includes('Your chats, files and memory stay') && !/data-kb="servers-add-go"[^>]*disabled=""/.test(okV))
  check('found: the addresses are one click away, not shown by default when they are all on the typed host', !okV.includes('servers-addresses') && okV.includes('data-kb="servers-see-addresses"'))
  check('…and shown when asked', view(A({ address: 'kb.acme.corp', result: found, showAddr: true })).includes('servers-addresses'))
  const split = Object.assign({}, found, { profile: { api: 'https://kb.acme.corp', web: 'https://web.elsewhere.example', services: { llm: 'https://llm.elsewhere.example' } } })
  const withConsole = Object.assign({}, found, { profile: { api: 'https://kb.acme.corp', console: 'https://console.elsewhere.example/workspace-console' } })
  check('the old console address is not shown and is not a place the sign-in goes: it neither adds a line nor opens the list', addressesOf(withConsole).differs === false && addressesOf(withConsole).rows.every((r) => !/console/i.test(r[0] + r[1])) && addressesOf(found).rows[1][1] === 'https://kb.acme.corp/account', JSON.stringify(addressesOf(withConsole)))
  check('open by default when one address is on another host than the one typed', addressesOf(split).differs === true && view(A({ address: 'kb.acme.corp', result: split })).includes('https://llm.elsewhere.example') && addressesOf(found).differs === false)
  const renamed = view(A({ address: 'kb.acme.corp', result: found, editName: true, name: 'Acme prod' }))
  check('renaming: an input holding the name, no extra step', renamed.includes('data-kb="servers-name"') && renamed.includes('value="Acme prod"'))
  const dup = view(A({ address: 'kb.acme.corp', result: { ok: false, steps: [], error: 'already_listed', id: 'acme-corp' } }))
  check('an error is one sentence in the dialog, the button stays disabled', dup.includes('This server is already in your list.') && /data-kb="servers-add-go"[^>]*disabled=""/.test(dup))
  const stopped = view(A({ address: 'bad.example', result: { ok: false, steps: [{ id: 'reach', ok: true }, { id: 'wellknown', ok: false }], error: 'no_profile' } }))
  check('a failed step is shown red with the steps before it green, and the reason', stopped.includes('It publishes a Kybernos profile') && stopped.includes('data-ok="false"') && stopped.includes('does not publish a Kybernos profile'))
  const failedAdd = view(A({ address: 'kb.acme.corp', result: found, error: say('apply_failed') }))
  check('a refusal at the time of adding is shown inside the dialog', failedAdd.includes('servers-add-failed') && failedAdd.includes('The change failed and was undone.'))
  const dialog = empty
  check('a real dialog: role, aria-modal, a labelled title', /role="dialog"/.test(dialog) && /aria-modal="true"/.test(dialog) && /aria-labelledby="kbsv-add-t"/.test(dialog) && dialog.includes('id="kbsv-add-t"'))
}

console.log('the sign-in, switch and remove dialogs')
{
  const code = renderToStaticMarkup(React.createElement(SigninDialog, { signin: { id: 'acme-corp', code: 'KB-4829', url: 'https://kb.acme.corp/cloud/cli/activate?code=KB-4829' }, server: ACME, act }))
  check('the code, the link to the server\'s own activation page (opens a new tab safely), the waiting line and « Later »', code.includes('KB-4829') && /href="https:\/\/kb\.acme\.corp\/cloud\/cli\/activate/.test(code) && code.includes('rel="noopener noreferrer"') && code.includes('Waiting for your approval') && code.includes('data-kb="servers-signin-later"') && !code.includes('servers-newcode'))
  const expired = renderToStaticMarkup(React.createElement(SigninDialog, { signin: { id: 'acme-corp', code: 'KB-4829', url: null, expired: true, error: say('code_expired') }, server: ACME, act }))
  check('an expired code says so, never mentions a licence, and offers a new one', expired.includes('The code expired. If you cannot create an account on this server, ask its administrator.') && expired.includes('data-kb="servers-newcode"') && !/licen/i.test(expired))
  const sw = renderToStaticMarkup(React.createElement(Confirm, { confirm: { kind: 'switch', server: ACME, busy: false }, act }))
  check('switch: what changes and what stays, before it happens; a server not signed in says you will sign in next', sw.includes('Switch to Acme Corp?') && sw.includes('Model list') && sw.includes('Personal memory') && sw.includes('you will sign in next'))
  const rm = renderToStaticMarkup(React.createElement(Confirm, { confirm: { kind: 'remove', server: Object.assign({}, ACME, { active: true }), busy: false, error: say('registry_unreadable') }, act }))
  check('remove: the sign-in is forgotten on this device, nothing deleted on the server, you go back to Kybernos Cloud; an error shows inside', rm.includes('forgotten on this device') && rm.includes('Nothing is deleted on the server') && rm.includes('switches back to Kybernos Cloud') && rm.includes('The servers file is unreadable'))
}

// L5-05: removing the ACTIVE server switches back to Kybernos Cloud, so the account and the models change: the message says so and asks for the reload,
// as « Switch to this server » does. Removing a server that is not active changes nothing else and says only that it was removed.
check('removing the active server says it was removed, that you are back on Kybernos Cloud, and to reload DSH', doneMessage('remove', Object.assign({}, ACME, { active: true })) === 'Acme Corp was removed. You are back on Kybernos Cloud. Reload DSH to refresh the model list.', doneMessage('remove', Object.assign({}, ACME, { active: true })))
check('removing a server that is not active says only that it was removed', doneMessage('remove', Object.assign({}, ACME, { active: false })) === 'Acme Corp was removed.', doneMessage('remove', ACME))
check('switching still asks for the reload', doneMessage('switch', ACME) === 'You are on Acme Corp. Reload DSH to refresh the model list.', doneMessage('switch', ACME))

// Light theme: the engine's success green is 2.1:1 on its own tint and the Enterprise blue 4.2:1 on white (measured, scripts/audit-contrast-live.mjs); both texts get a darker ink in the
// light theme only (6.3:1 and 5.2:1; a token with the ink as its fallback, so a theme may set it), and the dark theme keeps the engine's colours.
check('light theme: the Active tag and the Enterprise kicker carry a darker ink, the dark theme is left to the engine', /body:not\(\[data-ds-dark-theme\]\) \.kbsv-tag\[data-tone="ok"\]\{color:var\(--kybernos-ok-ink,#166534\)\}/.test(mod.__test.CSS) && /body:not\(\[data-ds-dark-theme\]\) \.kbsv-ent-kick\{color:var\(--kybernos-brand-ink,#3566d9\)\}/.test(mod.__test.CSS))

console.log('SRV-02 every host error is a sentence, in both languages, never a raw code')
{
  const codes = Object.keys(ERR)
  const { en, fr } = both(() => codes.map(say))
  check('each code has a distinct English and French sentence', en.length === fr.length && en.every((t, i) => t !== codes[i] && !/^[a-z_]+$/.test(t) && fr[i] !== en[i]), codes.filter((c, i) => /^[a-z_]+$/.test(en[i])))
  check('an unknown code is a generic sentence, not the code', say('what_is_this') === 'Something went wrong.' && !say('what_is_this').includes('what_is_this'))
  check('the codes the host can answer are all covered', ['bad_address', 'insecure_address', 'unreachable', 'redirect', 'no_profile', 'incompatible', 'already_listed', 'profile_refused', 'registry_unreadable', 'cloud_plugin_missing', 'apply_failed', 'unknown_server', 'bad_name', 'bad_id'].every((c) => codes.includes(c)))
}

console.log('the page registers as a Settings section')
{
  const registered = []
  const slots = { inject: (name, cb) => { registered.push(['inject', name]); cb() }, register: (d) => { registered.push(['register', d.name, d.id, d.label]) } }
  mod.apply({ slots })
  check('one « settings.section », id kybernos-servers, labelled « Servers » (or « Serveurs »), so the Settings nav files it under Devices', registered.some((r) => r[0] === 'register' && r[1] === 'settings.section' && r[2] === 'kybernos-servers' && /^(Servers|Serveurs)$/.test(r[3])), registered)
  check('without slots it does not throw', (() => { try { mod.apply({}); return true } catch (e) { return false } })())
}

console.log(failed === 0 ? '\nall good' : '\n' + failed + ' failed')
process.exit(failed === 0 ? 0 : 1)

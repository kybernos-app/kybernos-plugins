// Tests of how the DSH page learns which server it talks to.   node packages/kybernos-plugin/test-server-client.mjs
//
// The loader is a few lines in client.js (kbServer, kbServerLoad). The test cuts that exact code out of the source and runs it
// against a stub of fetch, so what is proven is the shipped code: what an active server changes, what a failure leaves alone.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

let failed = 0
const check = (name, ok, detail) => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok || detail === undefined ? '' : '  — ' + detail))
  if (!ok) failed += 1
}

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'client.js'), 'utf8')
const from = source.indexOf('const KB_BUILTIN_API =')
const to = source.indexOf('try { void kbServerLoad() }', from)
check('the loader is where the test expects it', from > 0 && to > from)
const snippet = source.slice(from, to)

const load = (fetchStub) => new Function('fetch', snippet + '\nreturn { kbServer, kbServerLoad }')(fetchStub)
const answer = (body, ok = true) => () => Promise.resolve({ ok, json: () => Promise.resolve(body) })

console.log('what the active server changes')
{
  const s = load(answer({ ok: true, server: { id: 'acme', name: 'Acme', api: 'https://kb.acme.example', web: 'https://kb.acme.example', console: 'https://kb.acme.example/workspace-console', gateway: null } }))
  const out = await s.kbServerLoad()
  check('the console, the web app and the name are the server\'s', out.name === 'Acme' && out.web === 'https://kb.acme.example' && out.console === 'https://kb.acme.example/workspace-console', JSON.stringify(out))
  check('a server that names no gateway gets none (the console\'s key mode then uses its own origin)', out.gateway === '')
  check('the api of the server is carried too (the keys tab shows it)', out.api === 'https://kb.acme.example')
  // The old stack is an explicit opt-in (a servers.json entry): when it is active, the page follows it, gateway included.
  const t = load(answer({ ok: true, server: { name: 'Kybernos (old stack)', api: 'https://old.example', web: 'https://web.old.example', console: 'https://web.old.example/workspace-console', gateway: 'https://gw.old.example' } }))
  const old = await t.kbServerLoad()
  check('an opt-in server with a gateway still gets it', old.web === 'https://web.old.example' && old.gateway === 'https://gw.old.example')
}

console.log('which workspace the console opens on')
{
  const byUrl = (map) => (url) => Promise.resolve({ ok: true, json: () => Promise.resolve(map[url]) })
  const s = load(byUrl({ '/kybernos-cloud/server': { ok: true, server: { name: 'Kybernos Cloud', web: 'https://kb.example', console: 'https://kb.example/workspace-console', gateway: null } }, '/kybernos-cloud/status': { ok: true, connected: true, state: { active_workspace_id: 'w-active-1' } } }))
  check('the workspace this DSH has active is carried to the console, so the two selectors agree', (await s.kbServerLoad()).workspace === 'w-active-1')
  const none = load(byUrl({ '/kybernos-cloud/server': { ok: true, server: { name: 'X', web: 'https://x.example', console: 'https://x.example/c' } }, '/kybernos-cloud/status': { ok: true, connected: false } }))
  check('not signed in: no workspace, the console picks its own first one', (await none.kbServerLoad()).workspace === '')
  const odd = load(byUrl({ '/kybernos-cloud/status': { state: { active_workspace_id: 42 } } }))
  check('a workspace id that is not a string is ignored', (await odd.kbServerLoad()).workspace === '')
}

console.log('what a failure leaves alone')
{
  // The defaults are what the page starts with: the NEW server, its own host for web and console, and no gateway.
  const defaults = JSON.parse(JSON.stringify(load(undefined).kbServer))
  check('the page starts on the built-in server: its own host for api, web and console, and no gateway', defaults.api === defaults.web && defaults.console === defaults.api + '/workspace-console' && defaults.gateway === '' && defaults.workspace === '' && /^https:\/\//.test(defaults.api), JSON.stringify(defaults))
  for (const [label, stub] of [['a refused request', () => Promise.reject(new Error('offline'))], ['a non-OK status', answer({}, false)], ['an answer that is not ours', answer({ hello: 'world' })], ['an answer with an invalid server', answer({ ok: true, server: 'text' })], ['no fetch at all', undefined]]) {
    const s = load(stub)
    const out = await s.kbServerLoad()
    check(label + ': the built-in defaults stand, nothing throws', JSON.stringify(out) === JSON.stringify(defaults), JSON.stringify(out))
  }
}

console.log('the developer overrides only win behind the explicit flag')
{
  const a = source.indexOf('const kbDevOverrides = () =>')
  const b = source.indexOf("// The console of the ACTIVE server, read at each use", a)
  check('the override helpers are where the test expects them', a > 0 && b > a)
  const make = (storage, win) => new Function('window', source.slice(a, b) + '\nreturn { kbDevOverrides, kbWsCfg }')(Object.assign({ localStorage: { getItem: (k) => (k in storage ? storage[k] : null) } }, win))
  const DEF = 'https://active.example/workspace-console'
  const stored = { 'kybernos.ws.console.url': 'http://localhost:8081/old-test-console' }
  check('a console URL left in localStorage does NOT win over the active server', make(stored, {}).kbWsCfg('kybernos.ws.console.url', 'KYBERNOS_WS_CONSOLE_URL', DEF) === DEF)
  check('nor does a window global', make({}, { KYBERNOS_WS_CONSOLE_URL: 'http://localhost:8081/x' }).kbWsCfg('kybernos.ws.console.url', 'KYBERNOS_WS_CONSOLE_URL', DEF) === DEF)
  check('with kybernos.dev = 1 the stored override wins again', make(Object.assign({ 'kybernos.dev': '1' }, stored), {}).kbWsCfg('kybernos.ws.console.url', 'KYBERNOS_WS_CONSOLE_URL', DEF) === 'http://localhost:8081/old-test-console')
  check('with window.KYBERNOS_DEV = true the window override wins', make({}, { KYBERNOS_DEV: true, KYBERNOS_WS_CONSOLE_URL: 'http://localhost:8081/x' }).kbWsCfg('kybernos.ws.console.url', 'KYBERNOS_WS_CONSOLE_URL', DEF) === 'http://localhost:8081/x')
  check('a flag that is not exactly 1 / true is not a flag', make({ 'kybernos.dev': 'true' }, { KYBERNOS_DEV: 'yes' }).kbDevOverrides() === false)
  const blocked = new Function('window', source.slice(a, b) + '\nreturn { kbWsCfg }')({ get localStorage() { throw new Error('blocked') } })
  check('a blocked storage is the active server, not an error', blocked.kbWsCfg('kybernos.ws.console.url', 'KYBERNOS_WS_CONSOLE_URL', DEF) === DEF)
}

console.log('the address of the embedded console is derived from the active server at each use')
{
  const a = source.indexOf('const kbDevOverrides = () =>')
  const endMark = "+ (kbConsolePage(page) !== '' ? '#' + kbConsolePage(page) : '')"
  const b = source.indexOf(endMark, a) + endMark.length
  check('the address builders are where the test expects them', a > 0 && b > endMark.length && b > a)
  const make = (server, locale) => new Function('kbServer', 'kbLocaleRead', 'window', source.slice(a, b) + '\nreturn { kbWsConsole, kbWsOrigin, kbConsoleUrl, kbConsoleLang, kbConsolePage }')(
    server, () => locale, { localStorage: { getItem: () => null } })
  const srv = (origin, ws = '') => ({ api: origin, web: origin, console: origin + '/workspace-console', gateway: '', workspace: ws, computer: false })
  const A = srv('http://localhost:8791', 'w-1')
  const f = make(A, 'en')
  check('console, workspace, theme and language', f.kbConsoleUrl(false) === 'http://localhost:8791/workspace-console?gw=&ws=w-1&theme=light&lang=en', f.kbConsoleUrl(false))
  check('a page is the fragment', f.kbConsoleUrl(true, 'account') === 'http://localhost:8791/workspace-console?gw=&ws=w-1&theme=dark&lang=en#account', f.kbConsoleUrl(true, 'account'))
  for (const bad of ['../x', 'a b', '#plan', '/account', 'x'.repeat(40), '', 7, null]) check('a page that is not a slug is no fragment (' + JSON.stringify(bad) + ')', f.kbConsoleUrl(false, bad).indexOf('#') < 0)
  // The server object is read at each call: another server later gives another address from the same functions.
  A.console = 'https://other.example/workspace-console'
  A.workspace = ''
  check('the address follows the server object (each use, never captured)', f.kbConsoleUrl(false) === 'https://other.example/workspace-console?gw=&theme=light&lang=en' && f.kbWsOrigin() === 'https://other.example', f.kbConsoleUrl(false))
  for (const [locale, want] of [['fr', 'fr'], ['zh-CN', 'zh-cn'], ['pt_BR', 'pt-br'], ['ar', 'ar'], ['', 'en'], ['not a locale', 'en'], [undefined, 'en']]) check('language ' + JSON.stringify(locale) + ' → ' + want, make(srv('http://x.example'), locale).kbConsoleLang() === want)
}

console.log('the shipped code')
check('the loader asks the cloud plugin, same-origin', snippet.indexOf("'/kybernos-cloud/server'") > 0 && snippet.indexOf("credentials: 'same-origin'") > 0)
check('the console URL carries `ws` only when a workspace is known', source.indexOf("(kbServer.workspace !== '' ? '&ws=' + encodeURIComponent(kbServer.workspace) : '')") > 0)
check('the console, the cloud page and the store read the loaded server, not a literal', source.indexOf("kbWsCfg('kybernos.ws.console.url', 'KYBERNOS_WS_CONSOLE_URL', kbServer.console)") > 0 && source.indexOf("kbWsCfg('kybernos.cloud.url', 'KYBERNOS_CLOUD_URL', kbServer.web)") > 0 && source.indexOf("kbServer.web.replace(/\\/+$/, '') + '/s/'") > 0)
// On a cloud computer the console cannot be framed (the server's console only accepts a page of the person's own machine), so it is not probed there: the fallback card shows.
check('opening « Teams settings » asks for the active server before probing its console', source.indexOf("kbServerLoad().then(() => { if (kbServer.computer === true) setReach('computer'); else probe() })") > 0)

console.log('\n' + (failed === 0 ? 'all checks OK' : failed + ' check(s) failed'))
process.exit(failed === 0 ? 0 : 1)

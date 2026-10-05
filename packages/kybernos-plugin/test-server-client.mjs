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
const from = source.indexOf('const kbServer = {')
const to = source.indexOf('const kbStoreWeb = () => kbServer.web', from)
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
  const t = load(answer({ ok: true, server: { name: 'Kybernos Cloud', web: 'https://dev.kybernos.app', console: 'https://dev.kybernos.app/workspace-console', gateway: 'https://api.dev2.kybernos.app' } }))
  const def = await t.kbServerLoad()
  check('the built-in server keeps today\'s addresses', def.web === 'https://dev.kybernos.app' && def.gateway === 'https://api.dev2.kybernos.app')
}

console.log('which workspace the console opens on')
{
  const byUrl = (map) => (url) => Promise.resolve({ ok: true, json: () => Promise.resolve(map[url]) })
  const s = load(byUrl({ '/kybernos-cloud/server': { ok: true, server: { name: 'Kybernos Cloud', web: 'https://dev.kybernos.app', console: 'https://dev.kybernos.app/workspace-console', gateway: 'https://api.dev2.kybernos.app' } }, '/kybernos-cloud/status': { ok: true, connected: true, state: { active_workspace_id: 'w-active-1' } } }))
  check('the workspace this DSH has active is carried to the console, so the two selectors agree', (await s.kbServerLoad()).workspace === 'w-active-1')
  const none = load(byUrl({ '/kybernos-cloud/server': { ok: true, server: { name: 'X', web: 'https://x.example', console: 'https://x.example/c' } }, '/kybernos-cloud/status': { ok: true, connected: false } }))
  check('not signed in: no workspace, the console picks its own first one', (await none.kbServerLoad()).workspace === '')
  const odd = load(byUrl({ '/kybernos-cloud/status': { state: { active_workspace_id: 42 } } }))
  check('a workspace id that is not a string is ignored', (await odd.kbServerLoad()).workspace === '')
}

console.log('what a failure leaves alone')
{
  const defaults = { name: 'Kybernos Cloud', web: 'https://dev.kybernos.app', console: 'https://dev.kybernos.app/workspace-console', gateway: 'https://api.dev2.kybernos.app', workspace: '' }
  for (const [label, stub] of [['a refused request', () => Promise.reject(new Error('offline'))], ['a non-OK status', answer({}, false)], ['an answer that is not ours', answer({ hello: 'world' })], ['an answer with an invalid server', answer({ ok: true, server: 'text' })], ['no fetch at all', undefined]]) {
    const s = load(stub)
    const out = await s.kbServerLoad()
    check(label + ': the built-in defaults stand, nothing throws', JSON.stringify(out) === JSON.stringify(defaults), JSON.stringify(out))
  }
}

console.log('the shipped code')
check('the loader asks the cloud plugin, same-origin', snippet.indexOf("'/kybernos-cloud/server'") > 0 && snippet.indexOf("credentials: 'same-origin'") > 0)
check('the console URL carries `ws` only when a workspace is known', source.indexOf("(kbServer.workspace !== '' ? '&ws=' + encodeURIComponent(kbServer.workspace) : '')") > 0)
check('the console, the cloud page and the store read the loaded server, not a literal', source.indexOf("kbWsCfg('kybernos.ws.console.url', 'KYBERNOS_WS_CONSOLE_URL', kbServer.console)") > 0 && source.indexOf("kbWsCfg('kybernos.cloud.url', 'KYBERNOS_CLOUD_URL', kbServer.web)") > 0 && source.indexOf('const kbStoreWeb = () => kbServer.web') > 0)
check('opening « Teams settings » asks for the active server before probing its console', source.indexOf('kbServerLoad().then(() => probe())') > 0)

console.log('\n' + (failed === 0 ? 'all checks OK' : failed + ' check(s) failed'))
process.exit(failed === 0 ? 0 : 1)

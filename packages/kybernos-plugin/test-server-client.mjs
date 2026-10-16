// Tests of how the DSH page learns which server it talks to.   node packages/kybernos-plugin/test-server-client.mjs
//
// The loader is a few lines in client.js (kbServer, kbServerLoad). The test cuts that exact code out of the source and runs it
// against a stub of fetch, so what is proven is the shipped code: what an active server changes, what a failure leaves alone.
// The page reads one thing of the server now, its WEB address (the public share links, the account page): the other fields (console,
// gateway, workspace, computer) fed the read-only account frame, which is gone (docs/dev/frame-removal.md).
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
  const s = load(answer({ ok: true, server: { id: 'acme', name: 'Acme', api: 'https://kb.acme.example', web: 'https://kb.acme.example/app', console: 'https://kb.acme.example/workspace-console', gateway: null } }))
  const out = await s.kbServerLoad()
  check('the web app address is the server\'s', out.web === 'https://kb.acme.example/app', JSON.stringify(out))
  check('and nothing else of the server is kept (no console, no gateway, no workspace: the frame they fed is gone)', JSON.stringify(Object.keys(out)) === JSON.stringify(['web']), JSON.stringify(out))
  const noWeb = await load(answer({ ok: true, server: { name: 'X', api: 'https://x.example' } })).kbServerLoad()
  check('a server that names no web address leaves the built-in one', noWeb.web === load(undefined).kbServer.web, JSON.stringify(noWeb))
  const odd = await load(answer({ ok: true, server: { web: 42 } })).kbServerLoad()
  check('a web address that is not a string is ignored', odd.web === load(undefined).kbServer.web, JSON.stringify(odd))
}

console.log('what a failure leaves alone')
{
  // The defaults are what the page starts with: the NEW server, its own host for the web app.
  const defaults = JSON.parse(JSON.stringify(load(undefined).kbServer))
  check('the page starts on the built-in server: its own host, over https', /^https:\/\//.test(defaults.web), JSON.stringify(defaults))
  for (const [label, stub] of [['a refused request', () => Promise.reject(new Error('offline'))], ['a non-OK status', answer({}, false)], ['an answer that is not ours', answer({ hello: 'world' })], ['an answer with an invalid server', answer({ ok: true, server: 'text' })], ['no fetch at all', undefined]]) {
    const s = load(stub)
    const out = await s.kbServerLoad()
    check(label + ': the built-in defaults stand, nothing throws', JSON.stringify(out) === JSON.stringify(defaults), JSON.stringify(out))
  }
}

console.log('the shipped code')
check('the loader asks the cloud plugin for the server, same-origin, and for nothing else', snippet.indexOf("'/kybernos-cloud/server'") > 0 && snippet.indexOf("credentials: 'same-origin'") > 0 && snippet.indexOf('/kybernos-cloud/status') < 0)
check('the shared-page address reads the loaded server, not a literal', source.indexOf("kbServer.web.replace(/\\/+$/, '') + '/s/'") > 0)
check('the account pages of Settings (and their `kybernos.cloud.url` base) are gone', source.indexOf('kbacCloudBase') < 0 && source.indexOf("'kybernos.cloud.url'") < 0)

console.log('\n' + (failed === 0 ? 'all checks OK' : failed + ' check(s) failed'))
process.exit(failed === 0 ? 0 : 1)

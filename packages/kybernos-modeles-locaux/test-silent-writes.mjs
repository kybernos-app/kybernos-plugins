#!/usr/bin/env node
// A3-29: a request that says nothing about where it comes from (no Origin, no Referer: a script, another local user) may read,
// it may not write. Plugin routes are served before DSH's own sign-in, so this is the only door, and two of these routes start
// a process (`brew install ollama`, `ollama pull <id>`). The bodies below are deliberately ones the handler would refuse for its own
// reasons (an empty target): the test proves the REFUSAL comes from the origin guard, and could never start a download itself.
//
//   node packages/kybernos-modeles-locaux/test-silent-writes.mjs
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'kml-silent-'))
const { apply } = await import('./index.js')

let pass = 0
let fail = 0
const check = (name, ok, detail) => { if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail).slice(0, 200))) } }

const routes = {}
const web = { register: (r) => { routes[r.path] = r.handler } }
const hostCtx = { get: (n) => (n === 'webServer' ? web : undefined), effect: (fn) => fn() }
apply({ inject: (_names, fn) => fn(hostCtx), get: () => undefined, effect: (fn) => fn() })

const call = async (path, method, headers, body) => {
  const text = body === undefined ? '' : JSON.stringify(body)
  const req = {
    method, url: path, headers: { host: '127.0.0.1:3080', ...headers }, socket: { localPort: 3080 },
    on (ev, cb) { if (ev === 'data' && text !== '') cb(Buffer.from(text)); if (ev === 'end') cb() },
    async *[Symbol.asyncIterator]() { if (text !== '') yield Buffer.from(text) },
  }
  const out = { status: 0, body: null }
  await routes[path](req, { writeHead (s) { out.status = s }, end (b) { try { out.body = JSON.parse(String(b)) } catch (e) { out.body = b } } })
  return out
}

for (const [path, body] of [['/modeles-locaux/installer', { cible: '' }], ['/modeles-locaux/annuler', {}], ['/modeles-locaux/decouvrir', {}], ['/modeles-locaux/catalogue', { op: 'not-an-op' }]]) {
  const r = await call(path, 'POST', {}, body)
  check('POST ' + path + ' with no Origin and no Referer is refused (403)', r.status === 403, r.status)
}
check('the installer, with an Origin of this DSH, reaches its own validation (the guard let it through)', (await call('/modeles-locaux/installer', 'POST', { origin: 'http://127.0.0.1:3080' }, { cible: '' })).body.error === 'cible-absente')
check('a Referer of this DSH is enough', (await call('/modeles-locaux/installer', 'POST', { referer: 'http://127.0.0.1:3080/settings' }, { cible: '' })).body.error === 'cible-absente')
check('a Referer of another site is refused', (await call('/modeles-locaux/installer', 'POST', { referer: 'https://evil.example/x' }, { cible: '' })).status === 403)
check('another Origin is still refused', (await call('/modeles-locaux/installer', 'POST', { origin: 'https://evil.example' }, { cible: '' })).status === 403)
check('the readers still answer with nothing said (a page sends no Origin on a same-origin GET)', (await call('/modeles-locaux/installation', 'GET', {})).status === 200 && (await call('/modeles-locaux/catalogue', 'GET', {})).status === 200)

console.log('\n' + pass + ' ✓  ' + fail + ' ✗')
process.exit(fail === 0 ? 0 : 1)

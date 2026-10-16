#!/usr/bin/env node
// A3-29: a request that says nothing about where it comes from (no Origin, no Referer: a script, another local user) may read,
// it may not write. Plugin routes are served before DSH's own sign-in, so this is the only door. The write routes of this bundle
// (the annotations, the journal, the scores refresh) all take the same guard; the first two are played here on a throw-away home
// (the third would start a download on a regression, so it is not played: it shares the guard).
//
//   node packages/kybernos-models/test-silent-writes.mjs
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'kbm-silent-'))
process.env.DSH_HOME = home
const { apply, ANNOTATIONS_FILE, JOURNAL_FILE } = await import('./index.js')

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

const NOTE = { key: 'groq/llama-3.3-70b', fields: { family: 'silent' } }
check('POST /kybernos-models/annotations/save with no Origin and no Referer is refused (403)', (await call('/kybernos-models/annotations/save', 'POST', {}, NOTE)).status === 403)
check('POST /kybernos-models/journal with no Origin and no Referer is refused (403)', (await call('/kybernos-models/journal', 'POST', {}, { niveau: 'annotation', champ: 'x' })).status === 403)
check('...and nothing was written', !existsSync(ANNOTATIONS_FILE) && !existsSync(JOURNAL_FILE))
check('with an Origin of this DSH the annotation is saved', (await call('/kybernos-models/annotations/save', 'POST', { origin: 'http://127.0.0.1:3080' }, NOTE)).body.ok === true && JSON.parse(readFileSync(ANNOTATIONS_FILE, 'utf8')).models['groq/llama-3.3-70b'] !== undefined)
check('a Referer of this DSH is enough', (await call('/kybernos-models/annotations/save', 'POST', { referer: 'http://127.0.0.1:3080/settings' }, NOTE)).status === 200)
check('a Referer of another site is refused', (await call('/kybernos-models/annotations/save', 'POST', { referer: 'https://evil.example/x' }, NOTE)).status === 403)
check('another Origin is refused', (await call('/kybernos-models/annotations/save', 'POST', { origin: 'https://evil.example' }, NOTE)).status === 403)
check('the readers still answer with nothing said (a page sends no Origin on a same-origin GET)', (await call('/kybernos-models/annotations', 'GET', {})).status === 200 && (await call('/kybernos-models/journal', 'GET', {})).status === 200)

console.log('\n' + pass + ' ✓  ' + fail + ' ✗')
process.exit(fail === 0 ? 0 : 1)

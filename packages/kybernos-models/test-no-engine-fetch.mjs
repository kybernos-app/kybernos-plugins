// The models.dev index is fetched with Node's own fetch, never through the engine's `web.fetch` service.
//
// Why: the engine's HTTP provider (dsh-web-fetch-http 0.2.0-rc.2) closes its pinned dispatcher as soon as a connect fails; when the
// failure is synchronous (no route, a firewall answering EPERM, a network that dropped while the DNS answer was still cached) a later
// happy-eyeballs attempt throws from a timer and the whole DSH process dies with « fatal uncaught exception » — every open session
// with it. Measured 2026-10-08 on a sandbox with outbound connects denied: opening the Models page killed DSH. A background request
// of ours must not be able to do that, so it goes through the global fetch (which rejects normally) and a service that throws when
// called proves nothing reaches the engine.
//
//   node kybernos-models/test-no-engine-fetch.mjs
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const home = mkdtempSync(join(tmpdir(), 'kbm-nofetch-'))
process.env.DSH_HOME = home

let engineCalls = 0
const seenUrls = []
const realFetch = globalThis.fetch
globalThis.fetch = async (url) => {
  seenUrls.push(String(url))
  return new Response(JSON.stringify({ acme: { models: { 'a-1': { name: 'A one', limit: { context: 1000, output: 100 } } } } }), { status: 200, headers: { 'content-type': 'application/json' } })
}

const routes = new Map()
const webServer = { register: (r) => { routes.set(r.path, r.handler); return () => routes.delete(r.path) } }
const engineWeb = { fetch: async () => { engineCalls += 1; throw new Error('the engine web.fetch must not be used for a background request') } }
const ctx = {
  get: (name) => (name === 'webServer' ? webServer : name === 'web' ? engineWeb : undefined),
  inject: (_list, cb) => cb(ctx),
  effect: (fn) => { fn() },
}

let n = 0
const ok = (label) => { n += 1; console.log('  ✓ ' + label) }
try {
  const mod = await import('./index.js')
  mod.apply(ctx)
  const handler = routes.get('/kybernos-models/modelsdev')
  assert.ok(handler !== undefined, 'the models.dev route must be mounted')
  const res = { status: 0, body: null, writeHead (s) { this.status = s }, end (p) { this.body = JSON.parse(p) } }
  await handler({ method: 'GET', url: '/kybernos-models/modelsdev?force=1', headers: { origin: 'http://127.0.0.1:3080' } }, res)
  assert.equal(engineCalls, 0, 'the engine web.fetch was called ' + engineCalls + ' time(s)')
  assert.ok(seenUrls.some((u) => u === 'https://models.dev/api.json'), 'the index must be fetched directly: ' + JSON.stringify(seenUrls))
  assert.equal(res.body.ok, true, JSON.stringify(res.body))
  assert.ok(res.body.entries >= 1, 'the index was read: ' + JSON.stringify(res.body))
  ok('the models.dev index is read through the global fetch; the engine web service is never called')

  // The same rule for the other host code: no bundle may reach for the engine's fetch service in the background.
  for (const file of ['../kybernos-models/index.js', '../kybernos-plugin/index.js']) {
    const src = readFileSync(join(here, file), 'utf8')
    const calls = src.split('\n').map((l, i) => ({ l, i: i + 1 })).filter(({ l }) => /\bweb(?:\?)?\.fetch\s*\(/.test(l) && !/^\s*(\/\/|\*|\/\*)/.test(l))
    assert.deepEqual(calls.map((c) => file + ':' + c.i), [], 'a call to the engine web.fetch is left in ' + file)
  }
  ok('no host code of the models and core bundles calls the engine web.fetch')
  console.log('\n' + n + ' checks, all green')
} finally {
  globalThis.fetch = realFetch
}
process.exit(0)

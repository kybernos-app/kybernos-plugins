#!/usr/bin/env node
/** `GET /kybernos/doc-raw?probe=1` is the project sheet's mount probe: it only tests for a 404 (T1-12 / T2-22, 2026-10-24).
 *  It used to be answered by the id check (400), which Chrome logs as a failed request: a red console error on every workspace page. It is a 204 now; a real request keeps its checks.
 *  Usage: node packages/kybernos-plugin/test-doc-raw-probe.mjs   (exit 0 = all pass) */
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const home = mkdtempSync(join(tmpdir(), 'kb-plugin-doc-raw-'))
process.env.HOME = home
process.env.DSH_HOME = join(home, '.dsh')
process.env.USERPROFILE = home
for (const key of ['KYBERNOS_CLOUD_STATE', 'KYBERNOS_SERVERS_FILE']) delete process.env[key]
mkdirSync(process.env.DSH_HOME, { recursive: true })

const routes = []
const service = { register: (r) => { routes.push(r); return () => {} }, registerRoute: (r) => { routes.push(r); return () => {} } }
const ctx = new Proxy({
  get: (name) => (name === 'webServer' ? service : (name === 'fs' ? {} : undefined)),
  inject: (_list, cb) => { try { cb(ctx) } catch (e) { /* a service that is not here */ } },
  effect: (fn) => { try { return fn() } catch (e) { return undefined } },
  on: () => {}, systemPrompt: { context: () => {} }, tools: { register: () => () => {} }, config: {},
  log: { info: () => {}, warn: () => {}, error: () => {} }, webServer: service,
}, { get: (t, k) => (k in t ? t[k] : (() => undefined)) })
const mod = await import(pathToFileURL(join(here, 'index.js')).href)
await Promise.race([Promise.resolve(mod.apply(ctx)), new Promise((r) => setTimeout(r, 5000))])
const route = routes.find((r) => r.path === '/kybernos/doc-raw' && typeof r.handler === 'function')
assert.ok(route !== undefined, 'the route is mounted')

const server = http.createServer((req, res) => { Promise.resolve(route.handler(req, res)).catch(() => { try { res.writeHead(500); res.end() } catch (e) { /* closed */ } }) })
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port
const get = (path) => new Promise((resolve) => {
  http.get({ host: '127.0.0.1', port, path }, (res) => { let text = ''; res.on('data', (c) => { text += c }); res.on('end', () => resolve({ status: res.statusCode, text })) }).on('error', () => resolve({ status: 0, text: '' }))
})

try {
  const probe = await get('/kybernos/doc-raw?probe=1')
  assert.deepEqual([probe.status, probe.text], [204, ''], 'the probe is a 204 with no body')
  console.log('  ✓ the mount probe answers 204 (not the 400 of the id check, which logged a red console error on every workspace page)')
  assert.notEqual(probe.status, 404, 'and never a 404: the page reads a 404 as « route not mounted »')
  for (const [path, want] of [['/kybernos/doc-raw', 400], ['/kybernos/doc-raw?id=zz', 400], ['/kybernos/doc-raw?id=sha256:' + 'z'.repeat(64), 400], ['/kybernos/doc-raw?probe=0', 400]]) {
    const r = await get(path)
    assert.equal(r.status, want, path + ' keeps its id check: ' + r.status)
  }
  console.log('  ✓ a real request keeps its checks: no id, a bad id, a bad hash and probe=0 are still 400')
  console.log('\n2 checks passed')
} catch (e) {
  console.error('  ✗ ' + String(e && e.message ? e.message : e))
  process.exitCode = 1
} finally {
  server.close()
  process.exit(process.exitCode === undefined ? 0 : process.exitCode)
}

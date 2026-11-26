#!/usr/bin/env node
// Route & write-guard tests for @local/kybernos-knowledge.
//   node packages/kybernos-knowledge/test-write-guard.mjs

import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createKnowledgeStore } from './knowledge-store.mjs'
import { mountRoutes } from './knowledge-host.mjs'
import { sessionSource } from './session-guard.mjs'
import { AUTHORITY, browserHeaders, OTHER_SECRET, SESSION_SECRET, sessionCookie } from './lib-session-test.mjs'

let pass = 0
let fail = 0
const check = (name, cond, detail) => {
  if (cond === true) { pass += 1; console.log('  ✓ ' + name) }
  else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) }
}

const routes = new Map()
const webServer = {
  register (r) {
    routes.set(r.path, r.handler)
    return () => routes.delete(r.path)
  }
}

async function callRoute (method, pathWithQuery, { headers = {}, body = null, localPort = 3080 } = {}) {
  const pathOnly = pathWithQuery.split('?')[0]
  const handler = routes.get(pathOnly)
  assert.ok(handler, 'missing route ' + pathOnly)
  const req = new EventEmitter()
  req.method = method
  req.url = pathWithQuery
  req.headers = { host: AUTHORITY, ...headers }
  req.socket = { localPort }
  req.destroy = () => {}

  let status = 0
  let rawBody = ''
  const res = new EventEmitter()
  res.setHeader = () => {}
  res.writeHead = (s) => { status = s }
  res.end = (chunk = '') => { rawBody += String(chunk); res.emit('finish') }

  const p = handler(req, res)
  if (body !== null) {
    req.emit('data', Buffer.from(typeof body === 'string' ? body : JSON.stringify(body), 'utf8'))
  }
  req.emit('end')
  await p
  let json = null
  try { json = JSON.parse(rawBody) } catch { json = null }
  return { status, json }
}

const root = mkdtempSync(join(tmpdir(), 'kb-know-guard-'))
const docsDir = join(root, 'docs')
mkdirSync(docsDir, { recursive: true })
writeFileSync(join(docsDir, 'faq.md'), '# FAQ\nShipping takes 48 hours across Europe.\n', 'utf8')

const origSecret = sessionSource.secret
const origNow = sessionSource.now
sessionSource.secret = () => SESSION_SECRET
sessionSource.now = () => Date.now()

try {
  const store = createKnowledgeStore({ dir: join(root, 'store') })
  const off = mountRoutes(webServer, store)

  const badHost = await callRoute('GET', '/kybernos-knowledge/collections', { headers: { host: 'evil.example:3080' } })
  check('GET refused on non-local Host (403)', badHost.status === 403)

  const okGet = await callRoute('GET', '/kybernos-knowledge/collections')
  check('GET /collections succeeds on loopback (200)', okGet.status === 200 && okGet.json.ok === true)

  const writePaths = [
    ['/kybernos-knowledge/collections/add', { name: 'Docs', rootPath: docsDir }],
    ['/kybernos-knowledge/collections/reindex', {}],
    ['/kybernos-knowledge/collections/update', { id: 'docs', includeFrontDesk: true }],
    ['/kybernos-knowledge/collections/remove', { id: 'docs' }]
  ]

  for (const [p, payload] of writePaths) {
    const noOrigin = await callRoute('POST', p, { body: payload })
    const noCookie = await callRoute('POST', p, { headers: { origin: 'http://' + AUTHORITY }, body: payload })
    const forged = await callRoute('POST', p, { headers: { origin: 'http://' + AUTHORITY, cookie: sessionCookie(AUTHORITY, { secret: OTHER_SECRET }) }, body: payload })
    const expired = await callRoute('POST', p, { headers: { origin: 'http://' + AUTHORITY, cookie: sessionCookie(AUTHORITY, { expiresAt: Date.now() - 1000 }) }, body: payload })
    const tunnel = await callRoute('POST', p, { headers: { ...browserHeaders(), 'x-kybernos-tunnel': '1' }, body: payload })
    check('POST ' + p + ' refuses missing origin (403), missing/forged/expired cookie (401), and phone tunnel (403)',
      noOrigin.status === 403 && noCookie.status === 401 && forged.status === 401 && expired.status === 401 && tunnel.status === 403)
  }

  const tooBig = await callRoute('POST', '/kybernos-knowledge/collections/add', {
    headers: browserHeaders(),
    body: JSON.stringify({ name: 'x'.repeat(40 * 1024), rootPath: docsDir })
  })
  check('POST body exceeding 32 KiB cap returns 413', tooBig.status === 413)

  const added = await callRoute('POST', '/kybernos-knowledge/collections/add', {
    headers: browserHeaders(),
    body: { name: 'FAQ Shop', rootPath: docsDir, includeFrontDesk: true }
  })
  check('POST /collections/add with valid browser cookie succeeds and indexes',
    added.status === 200 && added.json.ok === true && added.json.stats.docCount === 1)

  const searched = await callRoute('GET', '/kybernos-knowledge/search?q=shipping+europe&frontDeskOnly=1')
  check('GET /search returns citable passage',
    searched.status === 200 && searched.json.results.length === 1 && searched.json.results[0].relPath === 'faq.md')

  const fdFacts = await callRoute('GET', '/kybernos-knowledge/front-desk/facts?q=shipping')
  check('GET /front-desk/facts returns unvalidated candidate facts',
    fdFacts.status === 200 && fdFacts.json.facts.length === 1 && fdFacts.json.facts[0].validated === false)

  const removed = await callRoute('POST', '/kybernos-knowledge/collections/remove', {
    headers: browserHeaders(),
    body: { id: added.json.collection.id }
  })
  check('POST /collections/remove cleans up collection', removed.status === 200 && removed.json.ok === true)

  off()
  check('disposer removes every mounted route', routes.size === 0)
} finally {
  sessionSource.secret = origSecret
  sessionSource.now = origNow
  try { rmSync(root, { recursive: true, force: true }) } catch { /* ignore */ }
}

console.log('\n' + pass + ' ✓  ' + fail + ' ✗')
assert.equal(fail, 0, fail + ' check(s) failed')
process.exit(0)

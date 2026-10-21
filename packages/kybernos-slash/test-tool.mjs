#!/usr/bin/env node
/** The agent's path to the entries store is a host TOOL, never the HTTP route (A-16).
 *
 *  `POST /kybernos/slash/entries` serves the page and carries the signed session cookie; the
 *  `slash-msgaction-creator` skill, run by the agent, has no session. This drives the tool the bundle
 *  registers: the same mutation, the same validation, the same store — and nothing on the wire.
 *
 *  Usage: cd packages/kybernos-slash && node test-tool.mjs
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applyMutation, readStoreState, storeProblem, storePath, writeStore } from './index.js'
import { TOOL_NAME, definitionLitterale, enregistrerOutil, specOutil } from './tool.mjs'

let fail = 0
let n = 0
const ok = (label, cond, detail) => {
  n += 1
  if (cond) { console.log('  ✓ ' + label); return }
  fail += 1
  console.log('  ✗ ' + label + (detail === undefined ? '' : ' — ' + JSON.stringify(detail)))
}

const root = mkdtempSync(join(tmpdir(), 'kb-slash-tool-'))
process.env.DSH_HOME = join(root, 'dsh-home')
delete process.env.KYBERNOS_SLASH_STORE
const store = { path: storePath, read: readStoreState, problem: storeProblem, mutate: applyMutation, write: writeStore }
const tool = specOutil(store)
const lire = (p) => JSON.parse(readFileSync(p, 'utf8'))

console.log('the tool exists and says what it does')
ok('the tool has the bundle\'s name and describes the same body as the route', tool.name === TOOL_NAME && /entry|delete|replace/.test(tool.description))
ok('it takes one `body` object, free-shaped (the route\'s own body)', tool.parameters.body.type === 'object' && tool.parameters.body.additionalProperties === true)

console.log('it writes the store the route writes')
{
  const p = storePath()
  const r = await tool.execute({ body: { entry: { id: 'standup', kind: 'slash', slug: 'standup', label: 'Team standup', template: 'Daily standup' } } })
  ok('an upsert answers ok with the store re-read', r.ok === true && r.path === p && r.total === 1, r)
  ok('the entry is on disk, where the client reads it', lire(p)[0].id === 'standup' && lire(p)[0].label === 'Team standup')
}
{
  const r = await tool.execute({ body: { delete: 'standup' } })
  ok('a delete answers ok and empties the store', r.ok === true && r.total === 0 && lire(storePath()).length === 0, r)
}
{
  const r = await tool.execute({ body: { entries: [{ id: 'a', kind: 'action', slug: 'a', label: 'A', template: 'x' }, { id: 'b', kind: 'slash', slug: 'b', label: 'B', template: 'y' }] } })
  ok('an array upserts both', r.ok === true && r.total === 2)
  const rep = await tool.execute({ body: { replace: [{ id: 'c', kind: 'slash', slug: 'c', label: 'C', template: 'z' }] } })
  ok('a replace keeps only the given entries', rep.ok === true && rep.total === 1 && lire(storePath())[0].id === 'c')
}

console.log('it refuses what the route refuses')
{
  const r = await tool.execute({})
  ok('no body: refused, nothing written', r.ok === false && r.error === 'body object expected', r)
}
{
  const avant = readFileSync(storePath(), 'utf8')
  const r = await tool.execute({ body: { entry: { id: '', kind: 'slash' } } })
  ok('an invalid entry: refused with the model\'s own reason', r.ok === false && typeof r.error === 'string' && r.error !== '')
  ok('and the store did not move', readFileSync(storePath(), 'utf8') === avant)
}
{
  // A corrupt store is never written over: the next write would lose every saved entry (L2 family).
  const p = join(root, 'corrupt.json')
  writeFileSync(p, '{ not an array')
  process.env.KYBERNOS_SLASH_STORE = p
  const r = await tool.execute({ body: { entry: { id: 'x', kind: 'slash', slug: 'x', label: 'X', template: 't' } } })
  ok('a corrupt store is refused, with its state named', r.ok === false && r.state === 'corrupt' && typeof r.error === 'string', r)
  ok('and the corrupt file is left untouched', readFileSync(p, 'utf8') === '{ not an array')
  delete process.env.KYBERNOS_SLASH_STORE
}
{
  const p = join(root, 'locked.json')
  writeFileSync(p, '[]')
  chmodSync(p, 0o000)
  process.env.KYBERNOS_SLASH_STORE = p
  const r = await tool.execute({ body: { entry: { id: 'y', kind: 'slash', slug: 'y', label: 'Y', template: 't' } } })
  ok('an unreadable store is refused, never read as empty', r.ok === false && (r.state === 'unreadable' || /write failed/.test(String(r.error))), r)
  chmodSync(p, 0o600)
  delete process.env.KYBERNOS_SLASH_STORE
}

console.log('it registers where the agent can call it')
{
  const vus = []
  const tools = { register: (d) => vus.push(d) }
  const fait = await enregistrerOutil(tools, store)
  ok('enregistrerOutil registers exactly one tool', fait === true && vus.length === 1 && vus[0].name === TOOL_NAME)
  ok('the registered definition is callable and shaped like the literal one', typeof vus[0].execute === 'function' && typeof vus[0].parameters === 'object')
  ok('a host without a tools service is not an error', (await enregistrerOutil(null, store)) === false && (await enregistrerOutil({}, store)) === false)
  const lit = definitionLitterale({ name: 'x', description: 'd', parameters: { a: { type: 'string' } }, render: () => '', execute: async () => ({}) })
  ok('the literal fallback keeps name, description, parameters and execute', lit.name === 'x' && lit.parameters.properties.a.type === 'string' && typeof lit.execute === 'function')
}

rmSync(root, { recursive: true, force: true })
console.log('\nSLASH TOOL — ' + n + ' verification(s), ' + fail + ' failure(s)')
process.exit(fail === 0 ? 0 : 1)

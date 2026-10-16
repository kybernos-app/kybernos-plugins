#!/usr/bin/env node
// Where a new Agent Team is written (A6-24): the project for a team made on the Teams page, DSH's own home for the
// first-run starter kit, so that a welcome screen never puts `kybers/` into the person's project.
//
//   cd packages/kybernos-plugin && node test-kyber-root.mjs
import { readFileSync } from 'node:fs'
import { kyberTarget } from './kyber-root.mjs'

let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) }
}

const noWorkspaceOrHome = () => [{ id: 'session', path: '/p/session/kybers' }, { id: 'plugin', path: '/p/plugin/kybers' }]
const pathOf = (t) => (t === null ? null : t.path)
// the order of rootsFor(): session, plugin, workspace, installed
const roots = [
  { id: 'session', path: '/p/session/kybers' },
  { id: 'plugin', path: '/p/plugin/kybers' },
  { id: 'workspace', path: '/p/project/kybers' },
  { id: 'installed', path: '/h/.dsh/kybers' },
]
check('a team made on the Teams page still goes to the project', pathOf(kyberTarget(roots)) === '/p/project/kybers', kyberTarget(roots))
check('...also with an empty request', pathOf(kyberTarget(roots, {})) === '/p/project/kybers')
check('the starter kit asks for DSH\'s home and gets ~/.dsh/kybers, not the project', pathOf(kyberTarget(roots, { home: true })) === '/h/.dsh/kybers', kyberTarget(roots, { home: true }))
check('the answer names the root too (the route reports it as `rootId`)', kyberTarget(roots).id === 'workspace' && kyberTarget(roots, { home: true }).id === 'installed' && kyberTarget(noWorkspaceOrHome()).id === 'session')
check('`home` has to be exactly true (a string from a request body is not)', pathOf(kyberTarget(roots, { home: 'true' })) === '/p/project/kybers')
const noHome = roots.filter((r) => r.id !== 'installed')
check('no home known: the kit falls back to the old rule, it does not fail', pathOf(kyberTarget(noHome, { home: true })) === '/p/project/kybers')
const noWorkspace = roots.filter((r) => r.id !== 'workspace' && r.id !== 'installed')
check('no workspace nor home: the first root, as before', pathOf(kyberTarget(noWorkspace)) === '/p/session/kybers')
check('no root at all: null', pathOf(kyberTarget([])) === null && pathOf(kyberTarget(undefined)) === null)
check('a malformed entry is ignored', pathOf(kyberTarget([null, { id: 'installed' }, { id: 'installed', path: '/h/.dsh/kybers' }], { home: true })) === '/h/.dsh/kybers')

// the wiring: the route reads the flag through this rule, and the kit is the one that sets it
const host = readFileSync(new URL('./index.js', import.meta.url), 'utf8')
const client = readFileSync(new URL('./client.js', import.meta.url), 'utf8')
const create = host.slice(host.indexOf('const createKyber = async (args) => {'), host.indexOf('const createKyber = async (args) => {') + 1500)
check('createKyber chooses its folder with kyberTarget', create.includes('kyberTarget(rootsAll, { home: req.home === true })'))
const createStart = host.indexOf('const createKyber = async (args) => {')
const createBody = host.slice(createStart, host.indexOf('\n    const ', createStart + 40))
check('and nothing of the old workspace-only choice is left in it (an undefined name made the route fail once)', createBody.length > 2000 && !/\bwsRoot\b/.test(createBody) && createBody.includes('rootId: target.id'), createBody.length)
const kit = client.slice(client.indexOf('const kitApply = async () => {'), client.indexOf('// ── the profession in the person\'s memory ──'))
check('the starter kit asks for the home store', kit.includes("host.call('kybers/create'") && /\bhome: true,/.test(kit), kit.length)
check('and nothing else asks for it (the Teams page still writes into the project)', (client.match(/home: true/g) || []).length === 1)

console.log(`\n${pass} ✓  ${fail} ✗`)
process.exit(fail === 0 ? 0 : 1)

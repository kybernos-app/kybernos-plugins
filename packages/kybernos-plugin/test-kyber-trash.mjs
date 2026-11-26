#!/usr/bin/env node
// Removing an Agent Team the person installed in their own DSH home: the folder is MOVED to a trash folder, never deleted, and only from the installed root.
//   node packages/kybernos-plugin/test-kyber-trash.mjs
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, renameSync, cpSync, rmSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { planTrash, moveToTrash, stampOf, KYBER_ID, PROTECTED_KYBERS } from './kyber-trash.mjs'

let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) }
}
const NOW = new Date(Date.UTC(2026, 10, 8, 4, 15, 30))
const home = mkdtempSync(join(tmpdir(), 'kb-trash-'))
const root = join(home, 'kybers')
const ops = {
  exists: (p) => existsSync(p),
  mkdirp: (p) => { mkdirSync(p, { recursive: true }) },
  rename: (a, b) => renameSync(a, b),
  copyDir: (a, b) => { cpSync(a, b, { recursive: true }) },
  removeDir: (p) => { rmSync(p, { recursive: true, force: true }) },
}
const team = (id, files) => { mkdirSync(join(root, id), { recursive: true }); for (const [n, c] of Object.entries(files)) writeFileSync(join(root, id, n), c) }

console.log('the plan')
check('the stamp is UTC, sortable and has no character a path dislikes', stampOf(NOW) === '20261108-041530' && /^\d{8}-\d{6}$/.test(stampOf(undefined)))
const plan = planTrash({ rootId: 'installed', kyberId: 'inbound-closer', installedRoot: root, now: NOW })
check('an installed team: the folder, its yml and a trash NEXT to the kybers folder (not inside it)', plan.ok === true && plan.dir === root + '/inbound-closer' && plan.yml === root + '/inbound-closer/kyber.yml' && plan.trashRoot === home + '/agent-teams-trash' && plan.to === home + '/agent-teams-trash/inbound-closer-20261108-041530', plan)
check('a trailing slash on the root changes nothing', planTrash({ rootId: 'installed', kyberId: 'a1', installedRoot: root + '/', now: NOW }).dir === root + '/a1')
for (const rootId of ['plugin', 'workspace', 'session', '', undefined, 42]) {
  const r = planTrash({ rootId, kyberId: 'inbound-closer', installedRoot: root })
  check('root ' + JSON.stringify(rootId) + ' is refused (a project\'s team is a file of that project)', r.ok === false && r.code === 'not-installed', r)
}
for (const kyberId of ['', 'A', '../x', 'a/b', 'x', '-a', 'a b', 'a'.repeat(70), undefined, 7, '..', 'a..b/c']) {
  const r = planTrash({ rootId: 'installed', kyberId, installedRoot: root })
  check('the id ' + JSON.stringify(kyberId) + ' is refused, no path is built from it', r.ok === false && r.code === 'bad-id', r)
}
check('the id rule is the one of the other routes (lowercase, digits, dashes, 2 to 63)', KYBER_ID.test('ab') && KYBER_ID.test('a-b-1') && !KYBER_ID.test('a') && !KYBER_ID.test('Ab'))
check('the Digital Clone stays', PROTECTED_KYBERS.includes('digital-clone') && planTrash({ rootId: 'installed', kyberId: 'digital-clone', installedRoot: root }).code === 'protected')
for (const installedRoot of [null, undefined, '', 'kybers', '/', '/home/x/other', 42]) {
  const r = planTrash({ rootId: 'installed', kyberId: 'inbound-closer', installedRoot })
  check('an installed root that is not an absolute ".../kybers" (' + JSON.stringify(installedRoot) + '): nothing is planned', r.ok === false && r.code === 'no-home', r)
}

console.log('the move, on a real disk')
team('inbound-closer', { 'kyber.yml': 'id: inbound-closer\n', 'ui.json': '{"color":"#fff"}' })
mkdirSync(join(root, 'inbound-closer', 'avatars'), { recursive: true })
writeFileSync(join(root, 'inbound-closer', 'avatars', 'q.png'), 'png')
team('other-team', { 'kyber.yml': 'id: other-team\n' })
const moved = moveToTrash(planTrash({ rootId: 'installed', kyberId: 'inbound-closer', installedRoot: root, now: NOW }), ops)
check('it answers ok with where the folder went', moved.ok === true && moved.trash === home + '/agent-teams-trash/inbound-closer-20261108-041530', moved)
check('the team is gone from the kybers folder, the others are untouched', !existsSync(join(root, 'inbound-closer')) && existsSync(join(root, 'other-team', 'kyber.yml')))
check('NOTHING is erased: every file, in its sub-folder, is in the trash with its content', readFileSync(join(moved.trash, 'kyber.yml'), 'utf8') === 'id: inbound-closer\n' && readFileSync(join(moved.trash, 'ui.json'), 'utf8') === '{"color":"#fff"}' && readFileSync(join(moved.trash, 'avatars', 'q.png'), 'utf8') === 'png')
check('the same team asked twice: nothing to remove, nothing invented', moveToTrash(planTrash({ rootId: 'installed', kyberId: 'inbound-closer', installedRoot: root, now: NOW }), ops).code === 'missing')
team('inbound-closer', { 'kyber.yml': 'id: inbound-closer\n' }) // installed again, then removed within the same second
const busy = moveToTrash(planTrash({ rootId: 'installed', kyberId: 'inbound-closer', installedRoot: root, now: NOW }), ops)
check('a second removal in the same second does not overwrite the first copy', busy.ok === false && busy.code === 'trash-busy' && existsSync(join(root, 'inbound-closer', 'kyber.yml')) && readdirSync(home + '/agent-teams-trash').length === 1, busy)
const later = moveToTrash(planTrash({ rootId: 'installed', kyberId: 'inbound-closer', installedRoot: root, now: new Date(NOW.getTime() + 5000) }), ops)
check('a second later it goes to its own folder', later.ok === true && readdirSync(home + '/agent-teams-trash').length === 2, later)
check('a folder without a kyber.yml is not a team: it is not touched', (() => { mkdirSync(join(root, 'not-a-team'), { recursive: true }); writeFileSync(join(root, 'not-a-team', 'notes.txt'), 'x'); const r = moveToTrash(planTrash({ rootId: 'installed', kyberId: 'not-a-team', installedRoot: root, now: NOW }), ops); return r.code === 'missing' && existsSync(join(root, 'not-a-team', 'notes.txt')) })())

console.log('a rename that crosses a disk, and failures')
{
  team('cross-disk', { 'kyber.yml': 'id: cross-disk\n' })
  const calls = []
  const crossing = { ...ops, rename: () => { const e = new Error('cross-device link not permitted'); e.code = 'EXDEV'; throw e }, copyDir: (a, b) => { calls.push('copy'); ops.copyDir(a, b) }, removeDir: (p) => { calls.push('remove'); ops.removeDir(p) } }
  const r = moveToTrash(planTrash({ rootId: 'installed', kyberId: 'cross-disk', installedRoot: root, now: NOW }), crossing)
  check('EXDEV: a copy, then a removal of the original, in that order', r.ok === true && calls.join() === 'copy,remove' && !existsSync(join(root, 'cross-disk')) && readFileSync(join(r.trash, 'kyber.yml'), 'utf8') === 'id: cross-disk\n', { r, calls })
}
{
  team('copy-fails', { 'kyber.yml': 'id: copy-fails\n' })
  let removed = false
  const bad = { ...ops, rename: () => { const e = new Error('cross-device'); e.code = 'EXDEV'; throw e }, copyDir: () => { throw new Error('disk full') }, removeDir: () => { removed = true } }
  const r = moveToTrash(planTrash({ rootId: 'installed', kyberId: 'copy-fails', installedRoot: root, now: NOW }), bad)
  check('a copy that fails removes NOTHING and says why', r.ok === false && r.code === 'io' && /disk full/.test(r.error) && removed === false && existsSync(join(root, 'copy-fails', 'kyber.yml')), r)
}
{
  team('rename-fails', { 'kyber.yml': 'id: rename-fails\n' })
  const r = moveToTrash(planTrash({ rootId: 'installed', kyberId: 'rename-fails', installedRoot: root, now: NOW }), { ...ops, rename: () => { throw new Error('permission denied') } })
  check('any other failure of the rename is reported, the team stays', r.ok === false && r.code === 'io' && /permission denied/.test(r.error) && existsSync(join(root, 'rename-fails', 'kyber.yml')), r)
  check('a refused plan is handed back as it is (nothing is attempted)', moveToTrash({ ok: false, code: 'x', error: 'y' }, { exists: () => { throw new Error('touched') } }).code === 'x')
}

console.log('the wiring')
{
  const host = readFileSync(new URL('./index.js', import.meta.url), 'utf8')
  const client = readFileSync(new URL('./client.js', import.meta.url), 'utf8')
  const del = host.slice(host.indexOf('const deleteKyber = async (args) => {'), host.indexOf('const deleteWorkspace = async (args) => {'))
  check('the host takes a root and an id from the page and builds the path itself, from the installed root of the engine', /rootId: str\(req\.rootId\), kyberId: str\(req\.kyberId\), installedRoot: installed === undefined \? null : installed\.path/.test(del) && !/req\.path/.test(del))
  check('the route is POST, same-origin and behind the signed session, like the other writes to the person\'s files', /path: '\/kybernos\/kyber-delete'[\s\S]{0,700}sameOriginStrict\(req\) === false[\s\S]{0,300}writeGuard\(req\)[\s\S]{0,200}deleteKyber\(await readJsonBody\(req\)\)/.test(host))
  check('the page reaches it as `kybers/kyber-delete`, as a POST', /'kybers\/kyber-delete': 'kyber-delete'/.test(client) && /name === 'kybers\/yml-appliquer' \|\| name === 'kybers\/kyber-delete'/.test(client))
  check('the editor asks first (a confirmation dialog), and only an installed team that is not the Digital Clone can be removed', /const canDelete = protectedTeam === false && rootId === 'installed'/.test(client) && /h\(KbConfirm, \{ title: kbt\('kbui\.delete\.confirm\.title'\)/.test(client) && /host\.call\('kybers\/kyber-delete', \{ rootId: rootId, kyberId: kyber\.id \}\)/.test(client))
}

rmSync(home, { recursive: true, force: true })
console.log('\n' + pass + ' ok, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)

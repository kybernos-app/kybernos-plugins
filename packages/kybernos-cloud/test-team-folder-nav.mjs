// One working folder per team: what a switch does to where the next chat opens (plan « Équipes », step 6, client half).
//   node packages/kybernos-cloud/test-team-folder-nav.mjs
//
// The block `team-folder` is cut out of client.js and run on its own, against FAKE DSH services (a list of workspaces, the chat on screen, `workspaces.create`, `uiWorkspace.startSession`),
// so what is proven is the shipped code: a switch to a team registers its folder as a DSH workspace and opens a NEW chat in it; a switch back to Personal opens one in the workspace the
// person was in before, never in a team's folder (what `startSession()` with no id would do: it inherits the workspace on screen); a service that is missing, throws or refuses leaves
// the person where they are. The rendered footer that calls this on a switch is pinned in test-cloud-client.mjs; the real DSH is scripts/check-team-folder-live.mjs.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

let failed = 0
const check = (name, ok, detail) => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok || detail === undefined ? '' : '  — ' + JSON.stringify(detail)))
  if (!ok) failed += 1
}

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, 'client.js'), 'utf8')
const from = source.indexOf('// <team-folder:begin>')
const to = source.indexOf('// <team-folder:end>', from)
check('the block is where the test expects it', from > 0 && to > from)
const lib = new Function(source.slice(from, to) + '\nreturn { folderKey, isTeamFolder, workspaceRows, workspaceOnScreen, rememberPersonalFolder, workspaceListed, openTeamChat, openPersonalChat, enterSpaceChat }')()

const ACME = '/home/u/Documents/Kybernos/Acme'
const STUDIO = '/home/u/Documents/Kybernos/Studio B'
const TEAM_FOLDERS = [ACME, STUDIO]
const WORK = '/home/u/work/app'
const NOTES = '/home/u/notes'

/** A fake DSH client: workspaces (id, path, the sessions they hold), the chat on screen, create() that registers, startSession() that records. */
const dsh = (opts = {}) => {
  const rows = (opts.rows || [{ workspaceId: 'w-work', path: WORK, sessionIds: ['s-work'] }, { workspaceId: 'w-notes', path: NOTES, sessionIds: ['s-notes'] }]).map((r) => ({ ...r }))
  const listeners = new Set()
  const log = { created: [], started: [] }
  let screen = opts.screen === undefined ? 's-work' : opts.screen
  const notify = () => listeners.forEach((f) => f())
  const services = {
    workspaces: {
      list: { getSnapshot: () => ({ items: rows.slice() }), subscribe: (f) => { listeners.add(f); return () => listeners.delete(f) } },
      create: async ({ path }) => {
        log.created.push(path)
        if (opts.createFails === true) throw new Error('workspace/invalid-path')
        let row = rows.find((r) => r.path === path)
        if (row === undefined) {
          row = { workspaceId: 'w-' + path.split('/').pop().toLowerCase().replace(/[^a-z0-9]+/g, '-'), path, sessionIds: [] }
          if (opts.lateList === true) setTimeout(() => { rows.push(row); notify() }, 20)
          else rows.push(row)
        }
        return opts.noId === true ? {} : row
      },
    },
    uiWorkspace: {
      get mainReference() { return screen === null ? undefined : { sessionId: screen } },
      startSession: (id) => {
        if (opts.startFails === true) throw new Error('refused')
        log.started.push(id === undefined ? null : id)
        const row = id === undefined ? rows.find((r) => r.sessionIds.includes(screen)) : rows.find((r) => r.workspaceId === id)
        if (row !== undefined) { const sid = 'new-' + log.started.length; row.sessionIds.push(sid); screen = sid }
      },
    },
  }
  return { services, log, rows, screen: () => screen, setScreen: (s) => { screen = s } }
}
const memory = (initial = null) => { let v = initial; return { get: () => v, set: (p) => { v = p }, peek: () => v } }
const timers = { set: (f, ms) => setTimeout(f, ms), clear: (t) => clearTimeout(t) }

console.log('The chat on screen, and where Personal goes back to')
let d = dsh()
check('the workspace of the chat on screen is the one that holds it', lib.workspaceOnScreen(d.services).path === WORK)
d = dsh({ screen: null })
check('nothing on screen: no workspace', lib.workspaceOnScreen(d.services) === null)
d = dsh({ screen: 'ghost' })
check('a chat no workspace holds: no workspace', lib.workspaceOnScreen(d.services) === null)
check('a service that is missing or throws is no workspace, never an error', lib.workspaceOnScreen({}) === null && lib.workspaceOnScreen({ workspaces: { list: { getSnapshot: () => { throw new Error('x') } } }, uiWorkspace: {} }) === null && lib.workspaceRows({}).length === 0)
let store = memory()
d = dsh()
check('before a switch, the folder of a chat that is no team\'s is remembered', lib.rememberPersonalFolder(d.services, TEAM_FOLDERS, store) === WORK && store.peek() === WORK)
store = memory(NOTES)
d = dsh({ rows: [{ workspaceId: 'w-acme', path: ACME, sessionIds: ['s-acme'] }], screen: 's-acme' })
check('the folder of a chat that IS a team\'s is never remembered, and what was kept stays', lib.rememberPersonalFolder(d.services, TEAM_FOLDERS, store) === null && store.peek() === NOTES)
check('a trailing slash does not hide a team\'s folder', lib.isTeamFolder(ACME + '/', TEAM_FOLDERS) === true && lib.isTeamFolder('/home/u/Documents/Kybernos/Acme2', TEAM_FOLDERS) === false && lib.isTeamFolder(ACME, undefined) === false)
check('a store that throws is not an error', lib.rememberPersonalFolder(dsh().services, TEAM_FOLDERS, { get: () => { throw new Error('x') }, set: () => { throw new Error('x') } }) === WORK)

console.log('A switch to a team')
d = dsh()
let r = await lib.enterSpaceChat(d.services, { personal: false, folder: ACME }, TEAM_FOLDERS, memory(), timers)
check('the team\'s folder is registered as a DSH workspace and a NEW chat is opened in it', r.ok === true && JSON.stringify(d.log.created) === JSON.stringify([ACME]) && JSON.stringify(d.log.started) === JSON.stringify([r.workspaceId]) && d.rows.find((w) => w.workspaceId === r.workspaceId).path === ACME, { r, log: d.log })
check('the chat that was on screen is untouched: it keeps its folder', d.rows.find((w) => w.workspaceId === 'w-work').sessionIds.length === 1 && d.rows.find((w) => w.workspaceId === 'w-work').sessionIds[0] === 's-work')
check('startSession is called with an EXPLICIT workspace, never with none (that would inherit the chat on screen)', d.log.started.every((id) => typeof id === 'string'))
r = await lib.enterSpaceChat(d.services, { personal: false, folder: ACME }, TEAM_FOLDERS, memory(), timers)
check('switching to the same team again resolves the same workspace (create is idempotent), no second workspace', r.ok === true && d.rows.filter((w) => w.path === ACME).length === 1 && d.log.created.length === 2)
r = await lib.enterSpaceChat(d.services, { personal: false, folder: STUDIO }, TEAM_FOLDERS, memory(), timers)
check('another team gets its own workspace and its own chat: two teams, two folders', r.ok === true && d.rows.filter((w) => w.path === ACME).length === 1 && d.rows.filter((w) => w.path === STUDIO).length === 1 && d.rows.find((w) => w.path === STUDIO).workspaceId !== d.rows.find((w) => w.path === ACME).workspaceId)
d = dsh({ lateList: true })
r = await lib.enterSpaceChat(d.services, { personal: false, folder: ACME }, TEAM_FOLDERS, memory(), timers)
check('a list that shows the new workspace a moment later is waited for, then the chat opens', r.ok === true && d.log.started.length === 1, { r, log: d.log })
d = dsh({ lateList: true })
const slow = { set: (f) => setTimeout(f, 1), clear: (t) => clearTimeout(t) }
d.services.workspaces.create = async ({ path }) => ({ workspaceId: 'w-never', path })
r = await lib.enterSpaceChat(d.services, { personal: false, folder: ACME }, TEAM_FOLDERS, memory(), slow)
check('a workspace the list never shows is not started (DSH would throw): { ok: false, not_listed }, nothing opened', r.ok === false && r.why === 'not_listed' && d.log.started.length === 0, r)
check('a team with no folder (the host could not make one) opens nothing', (await lib.enterSpaceChat(dsh().services, { personal: false, folder: null }, TEAM_FOLDERS, memory(), timers)).why === 'no_folder' && (await lib.enterSpaceChat(dsh().services, { personal: false, folder: '' }, TEAM_FOLDERS, memory(), timers)).why === 'no_folder')
d = dsh({ createFails: true })
r = await lib.enterSpaceChat(d.services, { personal: false, folder: ACME }, TEAM_FOLDERS, memory(), timers)
check('DSH refusing the folder (« invalid path ») opens nothing and throws nothing', r.ok === false && r.why === 'register_failed' && d.log.started.length === 0, r)
d = dsh({ noId: true })
check('an answer with no workspace id opens nothing', (await lib.enterSpaceChat(d.services, { personal: false, folder: ACME }, TEAM_FOLDERS, memory(), timers)).why === 'no_id')
d = dsh({ startFails: true })
check('a chat DSH refuses to start is said, never thrown', (await lib.enterSpaceChat(d.services, { personal: false, folder: ACME }, TEAM_FOLDERS, memory(), timers)).why === 'start_failed')
check('DSH\'s services missing: nothing opens, nothing throws', (await lib.enterSpaceChat({}, { personal: false, folder: ACME }, TEAM_FOLDERS, memory(), timers)).ok === false && (await lib.enterSpaceChat({ workspaces: {}, uiWorkspace: {} }, { personal: false, folder: ACME }, TEAM_FOLDERS, memory(), timers)).why === 'no_service')

console.log('A switch back to Personal')
d = dsh()
store = memory()
lib.rememberPersonalFolder(d.services, TEAM_FOLDERS, store)
await lib.enterSpaceChat(d.services, { personal: false, folder: ACME }, TEAM_FOLDERS, store, timers)
r = await lib.enterSpaceChat(d.services, { personal: true, folder: null }, TEAM_FOLDERS, store, timers)
const back = d.rows.find((w) => w.workspaceId === r.workspaceId)
check('back to Personal: a NEW chat opens in the workspace the person was in before the team, not the team\'s', r.ok === true && back.path === WORK && d.log.started.length === 2 && d.screen().startsWith('new-') && d.rows.find((w) => w.path === WORK).sessionIds.includes(d.screen()), { r, log: d.log })
check('and it was started with an explicit workspace (not by inheritance, which would have landed in the team\'s folder)', d.log.started.every((id) => typeof id === 'string') && d.log.started[1] === 'w-work')
d = dsh()
store = memory(NOTES)
r = await lib.enterSpaceChat(d.services, { personal: true, folder: null }, TEAM_FOLDERS, store, timers)
check('the remembered folder wins over the first one of the list', d.rows.find((w) => w.workspaceId === r.workspaceId).path === NOTES)
d = dsh()
store = memory('/gone/folder')
r = await lib.enterSpaceChat(d.services, { personal: true, folder: null }, TEAM_FOLDERS, store, timers)
check('a remembered folder DSH no longer lists falls to the first workspace that is no team\'s', r.ok === true && d.rows.find((w) => w.workspaceId === r.workspaceId).path === WORK)
d = dsh({ rows: [{ workspaceId: 'w-acme', path: ACME, sessionIds: [] }, { workspaceId: 'w-work', path: WORK, sessionIds: [] }], screen: null })
r = await lib.enterSpaceChat(d.services, { personal: true, folder: null }, TEAM_FOLDERS, memory(ACME), timers)
check('a team\'s folder is never a place to go back to, even when it was remembered or comes first', r.ok === true && d.rows.find((w) => w.workspaceId === r.workspaceId).path === WORK)
d = dsh({ rows: [{ workspaceId: 'w-acme', path: ACME, sessionIds: [] }, { workspaceId: 'w-studio', path: STUDIO, sessionIds: [] }], screen: null })
r = await lib.enterSpaceChat(d.services, { personal: true, folder: null }, TEAM_FOLDERS, memory(), timers)
check('with only team folders left there is no personal workspace: nothing opens (an inherited chat would land in a team\'s folder)', r.ok === false && r.why === 'no_personal_workspace' && d.log.started.length === 0, r)
d = dsh({ startFails: true })
check('a chat DSH refuses to start back in Personal is said, never thrown', (await lib.enterSpaceChat(d.services, { personal: true }, TEAM_FOLDERS, memory(), timers)).why === 'start_failed')

console.log('\n' + (failed === 0 ? 'ALL GOOD' : failed + ' failed'))
process.exit(failed === 0 ? 0 : 1)

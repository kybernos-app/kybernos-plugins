// « One working folder per team » on the REAL DSH (plan « Équipes », step 6): the real page, the real host routes of kybernos-cloud, DSH's own workspaces and a FAKE Kybernos.
//
//   source scripts/sandbox/env.sh && node scripts/check-team-folder-live.mjs [--shots /tmp/shots]
//
// What it proves, on real clicks: a team's folder (<Documents>/Kybernos/<Team>, in the SANDBOX's home) is made when the team is switched to, created, joined or found active with none;
// it is registered as a DSH workspace from the plugin (`workspaces.create`, the same service DSH's own directory flow uses) and a switch opens a NEW chat in it (`uiWorkspace.startSession`,
// after DSH runs the new model route); a switch back to Personal opens one in the workspace the person was in before and NOT in the team's folder (DSH's own « New chat » inherits the
// chat on screen: the control shows what would have happened); two teams, two folders, two DSH workspaces; a hostile team name stays one safe segment under the root; a folder the person
// removed is made again at the same place; a disk that refuses leaves the switch working with no folder. What it does not prove: a chat that was already started keeping its folder (no
// model answers in the sandbox, so no message is sent; a session's folder is DSH's own rule).
//
// The sandbox is restarted with KYBERNOS_CLOUD_API / KYBERNOS_CLOUD_STATE pointing at a fake Kybernos (scripts/fake-kybernos.mjs) and restarted signed out when the check ends. Sandbox
// only: it refuses :3080 (exit 3) and any DSH home outside .kybernos-sandbox. Exit 0 all good, 1 a check failed, 3 not run.
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openLivePage, waitFor } from './live-page.mjs'
import { ACME, DEVICE_TOKEN, ME, PERSONAL as P, STUDIO, startFakeKybernos } from './fake-kybernos.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const host = process.env.KB_HOST || '127.0.0.1:3080'
if (host.endsWith(':3080')) { console.error('○ not run: this check must run against the sandbox (source scripts/sandbox/env.sh), never the real DSH on :3080'); process.exit(3) }
const DSH_HOME = process.env.DSH_HOME || ''
if (!DSH_HOME.includes('.kybernos-sandbox')) { console.error('○ not run: DSH_HOME is not an isolated instance (' + (DSH_HOME || 'unset') + '): source scripts/sandbox/env.sh'); process.exit(3) }
const HOME_DIR = process.env.HOME || ''
if (!HOME_DIR.includes('.kybernos-sandbox')) { console.error('○ not run: HOME is not the sandbox\'s (' + HOME_DIR + '): source scripts/sandbox/env.sh'); process.exit(3) }
const shotsAt = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null
if (shotsAt !== null) mkdirSync(shotsAt, { recursive: true })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0
const failures = []
const check = (label, cond, detail) => {
  if (cond) { pass += 1; console.log('  ✓ ' + label) } else { failures.push(label); console.log('  ✗ ' + label + (detail === undefined ? '' : '  — ' + JSON.stringify(detail).slice(0, 400))) }
}

const ROOT = join(HOME_DIR, 'Documents', 'Kybernos')
const folderOf = (name) => join(ROOT, name)
const isDir = (p) => { try { return statSync(p).isDirectory() } catch (e) { return false } }
// DSH's own registry of workspaces (the file the engine keeps in the sandbox's home): the ground truth of what DSH registered, and of the chats each workspace holds.
const registryFile = join(DSH_HOME, 'storages', 'workspace.json')
const readRegistry = () => { try { return JSON.parse(readFileSync(registryFile, 'utf8')) } catch (e) { return null } }
const registered = (path) => { const j = readRegistry(); return j === null ? [] : Object.entries(j.tables.workspaces).filter(([, w]) => w.path === path).map(([id, w]) => ({ id, title: w.title, sessions: w.sessionIds.length })) }
const registeredCount = () => { const j = readRegistry(); return j === null ? null : Object.keys(j.tables.workspaces).length }
/** Drops from DSH's registry every workspace under the teams' root (earlier runs of this check left them): a run starts from the sandbox's own workspace alone, and so does it end. */
const cleanRegistry = () => {
  const j = readRegistry()
  if (j === null) return
  for (const [id, w] of Object.entries(j.tables.workspaces)) if (w.path.startsWith(ROOT + '/')) { delete j.tables.workspaces[id]; j.global.workspaceIds = j.global.workspaceIds.filter((x) => x !== id) }
  writeFileSync(registryFile, JSON.stringify(j, null, 2), { mode: 0o600 })
}
const T_JOIN = 'Tk' + 'j'.repeat(40) + 'q'
const HOSTILE = { id: '77777777-7777-4777-8777-777777777777', name: '../../etc/passwd', personal: false, role: 'member', created_at: '2026-02-01T00:00:00Z' }
const TWIN = { id: 'abcdef12-7777-4777-8777-777777777778', name: 'Acme', personal: false, role: 'member', created_at: '2026-02-02T00:00:00Z' }
const JOINED = { id: '88888888-8888-4888-8888-888888888888', name: 'Joined Co', personal: false, role: 'member', created_at: '2026-02-03T00:00:00Z' }
const fake = await startFakeKybernos({ spaces: [P, ACME, STUDIO], invites: { [T_JOIN]: { workspace: JOINED, inviter: 'Ada Lovelace', email: ME.email, role: 'member' } } })

const stateFile = join(DSH_HOME, 'kybernos-cloud-folder-check.json')
// Where the host records each team's folder: beside the state file, so a sign-out (which wipes the state) does not make a team forget its folder.
const foldersFile = join(DSH_HOME, 'kybernos-cloud-folders.json')
const writeConnected = () => {
  mkdirSync(dirname(stateFile), { recursive: true })
  writeFileSync(stateFile, JSON.stringify({ token: DEVICE_TOKEN, api: fake.url, user: ME, workspaces: [P, ACME, STUDIO], active_workspace_id: P.id, device_label: 'Sandbox', refreshed_at: new Date().toISOString() }, null, 2), { mode: 0o600 })
}
const cleanEnv = () => { const e = Object.assign({}, process.env); delete e.KYBERNOS_CLOUD_API; delete e.KYBERNOS_CLOUD_STATE; return e }
const restart = (extraEnv) => {
  spawnSync('bash', [join(here, 'sandbox', 'stop.sh')], { env: cleanEnv(), encoding: 'utf8', timeout: 60000 })
  const r = spawnSync('bash', [join(here, 'sandbox', 'start.sh')], { env: extraEnv === null ? cleanEnv() : Object.assign(cleanEnv(), extraEnv), encoding: 'utf8', timeout: 240000 })
  return r.status === 0
}

let live = null
let upAgain = false
try {
  spawnSync('bash', [join(here, 'sandbox', 'stop.sh')], { env: cleanEnv(), encoding: 'utf8', timeout: 60000 })
  rmSync(ROOT, { recursive: true, force: true })
  rmSync(foldersFile, { force: true })
  cleanRegistry()
  writeConnected()
  const up = restart({ KYBERNOS_CLOUD_API: fake.url, KYBERNOS_CLOUD_STATE: stateFile })
  check('the sandbox restarts, pointed at the fake Kybernos and connected (a throw-away state file; Documents is the sandbox\'s own)', up === true)
  if (up !== true) throw new Error('the sandbox did not restart')

  live = await openLivePage({ width: 1400, height: 860 }).catch((e) => { console.error('○ not run: ' + e.message); process.exit(3) })
  const { page } = live
  const val = async (js) => { const r = await page.evalJs(js, 9000); return r.err !== undefined ? { err: r.err } : r.val }
  const mouse = async (x, y) => { for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }) }
  const centre = async (sel) => val(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return r.width === 0 ? null : { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)
  const until = async (fn, ms = 6000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) return v; await sleep(40) } }
  const press = async (sel, ms = 3000) => {
    let last = null
    const c = await until(async () => {
      const r = await centre(sel)
      if (r === null || r === undefined || r.err !== undefined) { last = null; return null }
      const still = last !== null && last.x === r.x && last.y === r.y
      last = r
      return still ? r : null
    }, ms)
    if (!c) return false
    await mouse(c.x, c.y)
    return true
  }
  const exists = async (sel) => (await val(`document.querySelector(${JSON.stringify(sel)}) !== null`)) === true
  const gone = (sel) => async () => !(await exists(sel))
  const text = async (sel) => val(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return e ? (e.innerText || '').replace(/\\s+/g, ' ').trim() : null })()`)
  const shot = async (name) => { if (shotsAt !== null) await page.shot(join(shotsAt, name + '.png')) }
  const settle = () => val(`new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 80))))`)
  const dismissGetStarted = () => val(`(() => { const d = Array.from(document.querySelectorAll('[role="dialog"]')).find((x) => /get started/i.test(x.innerText || '')); if (!d) return false; const c = Array.from(d.querySelectorAll('button')).find((b) => /close/i.test(b.getAttribute('aria-label') || '')); if (c) c.click(); return !!c })()`)
  const reload = async () => {
    await val('window.__kbStale = true')
    await page.send('Page.reload', { ignoreCache: true })
    await waitFor(page, `window.__kbStale === undefined && document.readyState === 'complete' && document.querySelector('[data-kb="workspace-card"]') !== null`, 30000)
    await dismissGetStarted()
    await settle()
  }
  const status = async () => (await (await fetch('http://' + host + '/kybernos-cloud/status')).json()).state
  // How many times this page asked the host to make a team's folder (the page's own record of its requests; a reload starts it again).
  const folderAsks = async () => (await val(`performance.getEntriesByType('resource').filter((e) => e.name.indexOf('/kybernos-cloud/space/folder') >= 0).length`)) || 0
  // What DSH shows: the title of the workspace of the new chat (the first line of the hero), and the workspaces of the sidebar.
  const heroTitle = () => val(`(() => { const h = document.querySelector('[class*="hero"]'); return h ? (h.innerText || '').split('\\n')[0].trim() : null })()`)
  const pageLines = async () => (await val(`document.body.innerText.split('\\n').map((x) => x.trim())`)) || []
  // true once the hero names the workspace, false after 10 s: a check compares it with `=== true` (a wait that returns the last answer and is compared with null never fails).
  const heroIs = (name) => until(async () => (await heroTitle()) === name, 10000)
  const openProfileMenu = async () => { if (await exists('.kbfp-menu')) return; await press('[data-kb="workspace-card"] .kbfp-cardmain'); await until(() => exists('.kbfp-menu'), 4000) }
  // The list: in the menu for up to 3 spaces, in the « Switch team » panel from 4.
  const spaceControl = async (selector) => {
    await openProfileMenu()
    const inline = await exists('.kbfp-menu [data-kb="space-row"]')
    if (!inline) { await press('.kbfp-menu [data-kb="menu-switch"]'); await until(() => exists('.kbfp-sub [data-kb="space-row"]'), 4000) }
    return (inline ? '.kbfp-menu ' : '.kbfp-sub ') + selector
  }
  const switchTo = async (space) => {
    await press(await spaceControl('[data-kb="space-row"][data-space="' + space.id + '"]'))
    await until(() => exists('[data-kb="workspace-card-switching"]'), 3000)
    await until(gone('[data-kb="workspace-card-switching"]'), 15000)
    await settle()
  }
  const cues = () => val(`Array.from(document.querySelectorAll('.kbcue [data-kb^="cue-"]')).map((e) => ({ kind: e.getAttribute('data-kb'), text: e.innerText, title: e.getAttribute('title') }))`)
  const refreshHost = () => fetch('http://' + host + '/kybernos-cloud/refresh', { method: 'POST', headers: { origin: 'http://' + host, 'content-type': 'application/json' }, body: '{}' }).then((r) => r.json())

  await reload()
  // DSH says « Choose workspace » until its list of workspaces has loaded: wait for the real title.
  const W0 = await until(async () => { const t = await heroTitle(); return t !== null && t !== '' && t !== 'Choose workspace' ? t : null }, 15000)
  check('the sandbox opens on its own workspace « ' + W0 + ' »; Personal is the active space and has no folder', typeof W0 === 'string' && (await status()).active_workspace_id === P.id && (await status()).space_folder === undefined && (await status()).team_folders.length === 0)
  check('nothing was made on the disk yet', !isDir(ROOT))
  check('and no folder was asked of the host (Personal has none)', (await folderAsks()) === 0)

  // 1. A switch to a team: its folder is made, registered in DSH, and a new chat opens in it.
  await switchTo(ACME)
  let st = await status()
  check('switching to Acme: the host made <Documents>/Kybernos/Acme and recorded it as the team\'s folder', st.active_workspace_id === ACME.id && st.space_folder === folderOf('Acme') && isDir(folderOf('Acme')) && st.team_folders.includes(folderOf('Acme')), { sf: st.space_folder })
  const before0 = registeredCount()
  check('DSH registered it as a workspace (once) and opened a NEW chat in it: the new chat\'s workspace is « Acme », it holds that chat, and the first workspace is still there', (await heroIs('Acme')) === true && (await until(() => registered(folderOf('Acme')).length === 1 && registered(folderOf('Acme'))[0].sessions >= 1, 8000)) && (await pageLines()).includes(W0), { hero: await heroTitle(), acme: registered(folderOf('Acme')), count: registeredCount() })
  const pill = (await cues()).filter((c) => c.kind === 'cue-folder')[0]
  check('the composer\'s folder pill appears by itself, with the path as its title', pill !== undefined && pill.text === 'Acme folder' && pill.title === folderOf('Acme'), await cues())
  await shot('f-acme')
  // The control: DSH's own « New chat » inherits the workspace on screen, which is the team's: what the switch back to Personal must NOT do.
  const control = await val(`(() => { const b = Array.from(document.querySelectorAll('button')).find((x) => /^New chat/.test((x.innerText || '').trim())); if (b) b.click(); return !!b })()`)
  await sleep(800)
  check('control: DSH\'s own « New chat », pressed in the team\'s chat, stays in the team\'s folder (inheritance: the very thing a switch back to Personal must avoid)', control === true && (await heroTitle()) === 'Acme', await heroTitle())

  // 2. Back to Personal: a new chat opens in the workspace the person had before, never in the team's folder.
  await switchTo(P)
  st = await status()
  check('back to Personal: no folder pill, the host names no folder, and the NEW chat is in the first workspace « ' + W0 + ' », not in Acme\'s', st.active_workspace_id === P.id && st.space_folder === undefined && (await heroIs(W0)) === true && (await cues()).filter((c) => c.kind === 'cue-folder').length === 0, { hero: await heroTitle(), sf: st.space_folder })
  check('the team\'s workspace is still in DSH, with its one chat, untouched by the switch back (a chat already started keeps its folder)', registered(folderOf('Acme')).length === 1 && registered(folderOf('Acme'))[0].sessions === 1 && (await pageLines()).includes('Acme'), { acme: registered(folderOf('Acme')) })
  await shot('f-personal-back')

  // 3. A second team: its own folder, its own workspace, its own chat.
  await switchTo(STUDIO)
  st = await status()
  check('Studio B has a folder of its own and a chat in it, apart from Acme\'s', st.space_folder === folderOf('Studio B') && isDir(folderOf('Studio B')) && st.space_folder !== folderOf('Acme') && (await heroIs('Studio B')) === true && registered(folderOf('Studio B')).length === 1 && registered(folderOf('Acme')).length === 1 && registered(folderOf('Studio B'))[0].id !== registered(folderOf('Acme'))[0].id && registeredCount() === before0 + 1, { sf: st.space_folder, hero: await heroTitle(), count: registeredCount(), before0 })
  await switchTo(ACME)
  check('Studio B to Acme: the chat opens in Acme\'s folder again (the workspace is found, not made twice)', (await heroIs('Acme')) === true && registered(folderOf('Acme')).length === 1 && registeredCount() === before0 + 1 && (await status()).space_folder === folderOf('Acme'), { count: registeredCount(), before0 })

  // 4. A folder the person removed is made again at the same place.
  await switchTo(P)
  rmSync(folderOf('Acme'), { recursive: true, force: true })
  check('(the person removes Acme\'s folder from the disk)', !isDir(folderOf('Acme')))
  await switchTo(ACME)
  check('back in Acme: the host makes the folder again at the same path and the chat opens', isDir(folderOf('Acme')) && (await status()).space_folder === folderOf('Acme') && (await heroIs('Acme')) === true, { hero: await heroTitle() })

  // 5. A hostile team name and two teams of the same name.
  fake.spaces = fake.spaces.concat([HOSTILE, TWIN])
  await refreshHost()
  await reload()
  await switchTo(HOSTILE)
  st = await status()
  check('a team called « ../../etc/passwd » gets ONE safe folder under the root (« etc passwd »), nothing outside the root', st.space_folder === folderOf('etc passwd') && isDir(folderOf('etc passwd')) && !existsSync(join(HOME_DIR, 'Documents', 'etc')) && !existsSync(join(HOME_DIR, 'etc')) && readdirSync(join(HOME_DIR, 'Documents')).join() === 'Kybernos', { sf: st.space_folder, docs: readdirSync(join(HOME_DIR, 'Documents')) })
  check('and DSH opened its chat there (a workspace titled « etc passwd »)', (await heroIs('etc passwd')) === true, await heroTitle())
  await switchTo(TWIN)
  st = await status()
  check('a second team called « Acme » is not given the first one\'s folder: its name carries the team\'s id', st.space_folder === folderOf('Acme (abcdef12)') && st.space_folder !== folderOf('Acme') && isDir(folderOf('Acme (abcdef12)')) && (await heroIs('Acme (abcdef12)')) === true, { sf: st.space_folder, hero: await heroTitle() })

  // 6. A team that is created: its folder is made even without a plan (and nothing opens: the person stays where they are); one with a plan takes over and its chat opens.
  const create = async (name) => {
    await press(await spaceControl('[data-kb="space-create"]'))
    await until(() => exists('[data-kb="new-team"]'), 4000)
    await val(`(() => { const i = document.querySelector('[data-kb="new-team"] input'); i.focus(); i.select() })()`)
    await page.send('Input.insertText', { text: name })
    await press('[data-kb="new-team"] .kbc-btn-primary')
    await until(gone('[data-kb="new-team"]'), 6000)
    await sleep(800)
  }
  await switchTo(P)
  await heroIs(W0)
  const heroBefore = await heroTitle()
  await create('Fresh Co')
  st = await status()
  check('a team created without a plan: its folder is made, the person stays in Personal and no chat opens (the team cannot answer yet)', isDir(folderOf('Fresh Co')) && st.active_workspace_id === P.id && st.team_folders.includes(folderOf('Fresh Co')) && (await heroTitle()) === heroBefore && /without a plan/.test((await text('[data-kb="foot-flash"]')) || ''), { hero: await heroTitle(), before: heroBefore })
  fake.createdHavePlan = true
  await create('Planned Co')
  await until(async () => (await heroTitle()) === 'Planned Co', 15000)
  st = await status()
  check('a team created with a plan takes over: its folder is made, DSH has the workspace, and its chat opens after the route wait', isDir(folderOf('Planned Co')) && st.space_folder === folderOf('Planned Co') && (await heroTitle()) === 'Planned Co', { sf: st.space_folder, hero: await heroTitle() })
  fake.createdHavePlan = false

  // 7. A team that is joined with an invitation link: the folder, the switch, the chat.
  await switchTo(P)
  await press(await spaceControl('[data-kb="space-join"]'))
  await until(() => exists('[data-kb="join-team"]'), 4000)
  await val(`(() => { const i = document.querySelector('[data-kb="join-input"]'); i.focus(); i.select() })()`)
  await page.send('Input.insertText', { text: 'https://dev.kybernos.app/invitations/accept?token=' + T_JOIN })
  await press('[data-kb="join-check"]')
  await until(() => exists('[data-kb="join-accept"]'), 6000)
  await press('[data-kb="join-accept"]')
  await until(async () => (await heroTitle()) === 'Joined Co', 20000)
  st = await status()
  check('a team joined with an invitation link: its folder is made, it is switched to, and its chat opens in it', isDir(folderOf('Joined Co')) && st.space_folder === folderOf('Joined Co') && st.active_workspace_id === JOINED.id && (await heroTitle()) === 'Joined Co', { sf: st.space_folder, hero: await heroTitle() })

  // 8. A team that is already active and has none (joined before folders existed): the page asks the host once, and no chat opens.
  rmSync(folderOf('Joined Co'), { recursive: true, force: true })
  const records = JSON.parse(readFileSync(foldersFile, 'utf8'))
  delete records[JOINED.id]
  writeFileSync(foldersFile, JSON.stringify(records, null, 2), { mode: 0o600 })
  await reload()
  await until(async () => (await status()).space_folder === folderOf('Joined Co'), 8000)
  // The page shows the chat DSH reopens (Joined Co's): waited for, not read the moment the host has recorded the folder (the hero is drawn a moment after the shell).
  const joinedShown = await heroIs('Joined Co')
  check('an active team with no recorded folder gets one at the next page load (the page asks the host, once), and no chat is opened by it', (await status()).space_folder === folderOf('Joined Co') && isDir(folderOf('Joined Co')) && (await folderAsks()) === 1 && joinedShown === true, { sf: (await status()).space_folder, asks: await folderAsks(), hero: await heroTitle() })

  // 9. A disk that refuses: the switch still works, there is no folder pill and nothing is opened; once the disk allows it the next page load makes the folder.
  chmodSync(ROOT, 0o555)
  fake.createdHavePlan = true
  await create('Locked Co')
  await until(async () => (await status()).active_workspace_id !== JOINED.id, 15000)
  st = await status()
  check('a disk that refuses the folder: the team is created and active, the host names no folder, no pill, no error', st.space_folder === undefined && st.workspaces.some((w) => w.name === 'Locked Co') && (await cues()).filter((c) => c.kind === 'cue-folder').length === 0 && !isDir(folderOf('Locked Co')), { sf: st.space_folder })
  chmodSync(ROOT, 0o755)
  await reload()
  // The fact is the folder: made on disk and recorded as the team's. NOT « the host names it as the active folder »: the page loads on the chat DSH reopens (Joined Co's, in its own
  // folder), and the active team follows the chat on screen (option 2, scripts/check-follow-chat-live.mjs), so a moment after the page asked for Locked Co's folder the active team is Joined Co.
  const lockedMade = async () => isDir(folderOf('Locked Co')) && (await status()).team_folders.includes(folderOf('Locked Co'))
  await until(lockedMade, 8000)
  check('the disk allows it again: the next page load makes the team\'s folder', await lockedMade(), { folders: (await status()).team_folders })
  fake.createdHavePlan = false

  // 10. Nothing but the teams' folders was made, and each team has a different one.
  const made = readdirSync(ROOT).sort()
  check('the root holds only the teams\' folders (' + made.length + '), each team its own', made.length === (await status()).team_folders.length && new Set((await status()).team_folders).size === made.length, { made, folders: (await status()).team_folders })
} finally {
  try { chmodSync(ROOT, 0o755) } catch (e) { /* not there */ }
  if (live !== null) await live.close()
  await fake.close()
  try { spawnSync('bash', [join(here, 'sandbox', 'stop.sh')], { env: cleanEnv(), encoding: 'utf8', timeout: 60000 }); cleanRegistry(); upAgain = restart(null) } catch (e) { upAgain = false }
  try { rmSync(stateFile, { force: true }) } catch (e) { /* gone */ }
  try { rmSync(foldersFile, { force: true }) } catch (e) { /* gone */ }
}
console.log('\n' + pass + ' checks passed' + (failures.length > 0 ? ', ' + failures.length + ' FAILED' : '') + (upAgain ? '' : ' (the sandbox did not come back up)'))
process.exit(failures.length > 0 ? 1 : 0)

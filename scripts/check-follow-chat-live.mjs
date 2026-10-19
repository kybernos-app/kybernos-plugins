// « The active team follows the chat » on the REAL DSH (teams plan, option 2): the real page, the real host routes of kybernos-cloud, DSH's own chats and a FAKE Kybernos that also plays
// a model (scripts/fake-kybernos.mjs: it records the team each model request was billed to, and can answer slowly).
//
//   source scripts/sandbox/env.sh && node scripts/check-follow-chat-live.mjs [--shots /tmp/shots]
//
// What it proves, on real clicks and real messages: a chat opened from the sidebar switches the active team to the one that owns its folder (the footer says « Switching… », no new chat
// opens, the chat stays on screen), a personal-folder chat switches back to Personal, the page loaded on a team chat does the same, opening the chat that is already on screen asks the
// host nothing; and the safety net on the HOST: when the page does not follow (its answer is rewritten to « nothing to do »), a message typed in a team chat while Personal is active
// makes the team active before the first model request, which is billed to the team, and the one after a personal chat is billed to Personal. What it does not prove: the memory cut's
// first request (the e2e journeys carry the canary word), a real phone, Windows/Linux.
//
// The sandbox is restarted with KYBERNOS_CLOUD_API / KYBERNOS_CLOUD_STATE pointing at the fake and restarted signed out when the check ends. Sandbox only: it refuses :3080 (exit 3) and any
// DSH home outside .kybernos-sandbox. Exit 0 all good, 1 a check failed, 3 not run.
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openGui } from './lib-e2e-gui.mjs'
import { cookieDeSession } from './cdp-lib.mjs'
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
  if (cond) { pass += 1; console.log('  ✓ ' + label) } else { failures.push(label); console.log('  ✗ ' + label + (detail === undefined ? '' : '  — ' + JSON.stringify(detail).slice(0, 500))) }
}
const note = (text) => console.log('  · ' + text)
// The model the fake's catalogue offers, as DSH's picker names it.
const MODEL = 'Kybernos Glm'
// A chat's row in the sidebar carries the title DSH made from the model's REPLY, so each chat gets a reply of its own (and this run's, since the sandbox keeps the chats of earlier runs).
const RUN = Date.now().toString(36).slice(-4)
const TAG = { personal: 'FOLLOW' + RUN + 'P', acme: 'FOLLOW' + RUN + 'A', studio: 'FOLLOW' + RUN + 'S' }

const fake = await startFakeKybernos({ spaces: [P, ACME, STUDIO] })
const stateFile = join(DSH_HOME, 'kybernos-cloud-follow-check.json')
const foldersFile = join(DSH_HOME, 'kybernos-cloud-folders.json')
const registryFile = join(DSH_HOME, 'storages', 'workspace.json')
const ROOT = join(HOME_DIR, 'Documents', 'Kybernos')
const writeConnected = () => {
  mkdirSync(dirname(stateFile), { recursive: true })
  writeFileSync(stateFile, JSON.stringify({ token: DEVICE_TOKEN, api: fake.url, user: ME, workspaces: [P, ACME, STUDIO], active_workspace_id: P.id, device_label: 'Sandbox', refreshed_at: new Date().toISOString() }, null, 2), { mode: 0o600 })
}
const cleanRegistry = () => {
  try {
    const j = JSON.parse(readFileSync(registryFile, 'utf8'))
    for (const [id, w] of Object.entries(j.tables.workspaces)) if (w.path.startsWith(ROOT + '/')) { delete j.tables.workspaces[id]; j.global.workspaceIds = j.global.workspaceIds.filter((x) => x !== id) }
    writeFileSync(registryFile, JSON.stringify(j, null, 2), { mode: 0o600 })
  } catch (e) { /* no registry yet */ }
}
const cleanEnv = () => { const e = Object.assign({}, process.env); delete e.KYBERNOS_CLOUD_API; delete e.KYBERNOS_CLOUD_STATE; return e }
const restart = (extraEnv) => {
  spawnSync('bash', [join(here, 'sandbox', 'stop.sh')], { env: cleanEnv(), encoding: 'utf8', timeout: 60000 })
  const r = spawnSync('bash', [join(here, 'sandbox', 'start.sh')], { env: extraEnv === null ? cleanEnv() : Object.assign(cleanEnv(), extraEnv), encoding: 'utf8', timeout: 240000 })
  return r.status === 0
}
const hostStatus = async () => (await (await fetch('http://' + host + '/kybernos-cloud/status')).json()).state
const hostSwitch = (id) => {
  const ck = cookieDeSession(host)
  return fetch('http://' + host + '/kybernos-cloud/space/active', { method: 'POST', headers: { 'content-type': 'application/json', cookie: ck.nom + '=' + ck.valeur, origin: 'http://' + host }, body: JSON.stringify({ workspace_id: id }) }).then((r) => r.json())
}

let g = null
let upAgain = false
try {
  spawnSync('bash', [join(here, 'sandbox', 'stop.sh')], { env: cleanEnv(), encoding: 'utf8', timeout: 60000 })
  rmSync(ROOT, { recursive: true, force: true })
  rmSync(foldersFile, { force: true })
  cleanRegistry()
  writeConnected()
  const up = restart({ KYBERNOS_CLOUD_API: fake.url, KYBERNOS_CLOUD_STATE: stateFile })
  check('the sandbox restarts, pointed at the fake Kybernos (which also plays the model) and connected', up === true)
  if (up !== true) throw new Error('the sandbox did not restart')

  g = await openGui(host, { width: 1400, height: 900 })
  const until = g.until
  const cardName = () => g.cardName()
  const switching = async () => (await g.card() || {}).switching === true
  const shot = async (name) => { if (shotsAt !== null) await g.shot(join(shotsAt, name + '.png')) }
  // Every call the page makes to the host's `space/for-folder` (recorded by the interception below, which stays on for the whole check; `blind.on` rewrites the answer to « nothing to follow »).
  const asked = []
  const asks = async () => asked.length
  const blind = { on: false }
  const cookie = cookieDeSession(host)
  g.page.on('Fetch.requestPaused', async (ev) => {
    try {
      let sent = {}
      try { sent = JSON.parse(ev.request.postData || '{}') } catch (e) { sent = {} }
      asked.push({ path: sent.path, sid: sent.session_id, at: Date.now() })
      if (blind.on !== true) { await g.page.send('Fetch.continueRequest', { requestId: ev.requestId }); return }
      const real = await fetch(ev.request.url, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://' + host, cookie: cookie.nom + '=' + cookie.valeur }, body: ev.request.postData })
      const body = await real.json()
      body.follow = false
      await g.page.send('Fetch.fulfillRequest', { requestId: ev.requestId, responseCode: 200, responseHeaders: [{ name: 'content-type', value: 'application/json' }], body: Buffer.from(JSON.stringify(body)).toString('base64') })
    } catch (e) { await g.page.send('Fetch.continueRequest', { requestId: ev.requestId }).catch(() => null) }
  })
  await g.page.send('Fetch.enable', { patterns: [{ urlPattern: '*/kybernos-cloud/space/for-folder', requestStage: 'Request' }] })
  const sessionOnScreen = async () => g.val(`(() => { try { return JSON.parse(localStorage.getItem('dsh.sessions.current') || 'null') } catch (e) { return null } })()`)
  const sidebarChats = async () => g.val(`Array.from(document.querySelectorAll('[data-row-key^="session:"]')).map((e) => ({ key: e.getAttribute('data-row-key'), text: (e.innerText || '').replace(/\\s+/g, ' ').trim() }))`)
  const waitReady = async () => {
    await g.waitFor(`document.querySelector('[data-kb="workspace-card"]') !== null`, 30000)
    await g.dismissGetStarted()
    // DSH says « Choose workspace » until its list of workspaces has loaded.
    await until(async () => { const t = await g.val(`(() => { const h = document.querySelector('[class*="hero"]'); return h ? (h.innerText || '').split('\\n')[0].trim() : null })()`); return t !== null && t !== '' && t !== 'Choose workspace' }, 20000)
    await sleep(800)
  }
  /** Sends a message in the chat on screen and waits until the fake model has seen the agent's own request. Resolves the model rows added by this message. */
  const say = async (text, reply) => {
    fake.model.reply = reply
    const before = fake.chats.length
    await g.selectModel(MODEL)
    await g.send(text)
    await until(() => fake.chats.length > before && fake.chats.slice(before).some((c) => c.tools), 15000, 50)
    await until(() => fake.chats.slice(before).every((c) => c.t1 !== null), 15000, 100)
    await sleep(1200) // the title call comes a moment after the turn
    return fake.chats.slice(before)
  }
  const switchByHand = async (space) => {
    await g.pickSpace(space.id)
    await until(async () => (await switching()) || (await hostStatus()).active_workspace_id === space.id, 3000, 20)
    await until(async () => !(await switching()), 15000, 40)
    await sleep(1500)
    await g.closeMenu()
  }
  const key = (rowText) => sidebarChats().then((rows) => rows.find((r) => r.text.includes(rowText)))
  const openChat = async (rowText) => {
    const row = await key(rowText)
    if (row === undefined) return false
    return g.press('[data-row-key="' + row.key + '"]')
  }

  await waitReady()
  await g.selectModel(MODEL)
  check('the sandbox opens signed in to the fake, Personal active', (await hostStatus()).active_workspace_id === P.id && (await cardName()) === 'Personal', await cardName())

  // ── 0. one real chat per place: Personal's workspace, Acme's folder, Studio B's folder ────────────────────────────────────────────────
  console.log('\n0. three real chats (the folders of the teams are made by a switch, step 6)')
  const personalFolder = (await g.val(`JSON.parse(localStorage.getItem('dsh.sessions.current') || 'null')`))
  let rows = await say('PERSONALONE first message in the personal workspace', TAG.personal)
  check('a chat in the personal workspace: its model request is billed to Personal', rows.length >= 1 && rows.every((r) => r.ws === P.id), rows.map((r) => (r.ws || '-').slice(0, 8)))
  await switchByHand(ACME)
  check('(by hand) Acme is active: the switch opened a new chat in its folder', (await hostStatus()).space_folder === join(ROOT, 'Acme') && (await cardName()) === 'Acme', await cardName())
  rows = await say('ACMEONE first message in the Acme folder', TAG.acme)
  check('a chat in Acme\'s folder: billed to Acme', rows.length >= 1 && rows.every((r) => r.ws === ACME.id), rows.map((r) => (r.ws || '-').slice(0, 8)))
  await switchByHand(STUDIO)
  rows = await say('STUDIOONE first message in the Studio folder', TAG.studio)
  check('a chat in Studio B\'s folder: billed to Studio B', rows.length >= 1 && rows.every((r) => r.ws === STUDIO.id), rows.map((r) => (r.ws || '-').slice(0, 8)))
  await switchByHand(P)
  const list0 = await sidebarChats()
  note('the sidebar lists ' + list0.length + ' chats: ' + list0.map((r) => r.text.slice(0, 24)).join(' | '))
  check('the three chats are in the sidebar, by their titles', [TAG.personal, TAG.acme, TAG.studio].every((t) => list0.some((r) => r.text.includes(t))), list0)
  await shot('a0-three-chats')

  // ── 1. opening a chat from the sidebar ──────────────────────────────────────────────────────────────────────────────────────────────────
  console.log('\n1. a chat opened from the sidebar: the active team follows it')
  const chatKeys = async () => new Set((await sidebarChats()).map((r) => r.key))
  const before1 = await chatKeys()
  // A blank chat disappears from the list when the person leaves it, so the count can drop; what must not happen is a chat that was not there before.
  const noNewChat = async () => { const now = await chatKeys(); return Array.from(now).every((k) => before1.has(k)) }
  const asked0 = await asks()
  note('Personal is active; the page shows a blank chat of the personal workspace')
  let t0 = Date.now()
  check('(the Acme chat\'s row is pressed)', await openChat(TAG.acme) === true)
  check('the footer says « Switching… » while the model route changes', (await until(() => switching(), 3000, 20)) === true)
  await until(async () => !(await switching()), 15000, 40)
  const tDone = Date.now() - t0
  check('then Acme is active: the card, the host\'s state and the folder', (await cardName()) === 'Acme' && (await hostStatus()).active_workspace_id === ACME.id && (await hostStatus()).space_folder === join(ROOT, 'Acme'), { card: await cardName() })
  note('click → switch done in ' + tDone + ' ms')
  const screen1 = await sessionOnScreen()
  check('the Acme chat is the one on screen, no new chat was opened for it', screen1 !== null && (await noNewChat()) && (await g.body()).includes('ACMEONE first message in the Acme folder'), { screen: screen1, chats: (await sidebarChats()).length, before: before1.size })
  check('the page asked the host about the chat it opened, with its folder and its id', asked.slice(asked0).some((a) => typeof a.path === 'string' && a.path.endsWith('/Acme') && typeof a.sid === 'string'), asked.slice(asked0))
  await shot('a1-acme-followed')

  t0 = Date.now()
  await openChat(TAG.studio)
  await until(() => switching(), 3000, 20)
  await until(async () => !(await switching()), 15000, 40)
  check('Studio B\'s chat opened: Studio B is active (a team to another team, no stop at Personal)', (await cardName()) === 'Studio B' && (await hostStatus()).active_workspace_id === STUDIO.id, await cardName())

  await openChat(TAG.personal)
  await until(() => switching(), 3000, 20)
  await until(async () => !(await switching()), 15000, 40)
  check('the personal chat opened: back to Personal, no folder named', (await cardName()) === 'Personal' && (await hostStatus()).active_workspace_id === P.id && (await hostStatus()).space_folder === undefined, await cardName())
  check('and still no chat was created by any of the three switches', await noNewChat(), (await sidebarChats()).length)

  const askedBefore = await asks()
  await openChat(TAG.personal)
  await sleep(1500)
  check('opening the chat that is already on screen asks the host nothing', (await asks()) === askedBefore, { asked: await asks(), before: askedBefore })

  // ── 2. the page loaded on a team chat ───────────────────────────────────────────────────────────────────────────────────────────────────
  console.log('\n2. the page loaded on a team chat while another team is active')
  await openChat(TAG.acme)
  await until(() => switching(), 3000, 20)
  await until(async () => !(await switching()), 15000, 40)
  const r1 = await hostSwitch(STUDIO.id)
  check('(the host is switched to Studio B behind the page\'s back, the Acme chat stays on screen)', r1.ok === true && (await hostStatus()).active_workspace_id === STUDIO.id)
  await g.reload()
  await until(async () => (await hostStatus()).active_workspace_id === ACME.id, 15000, 100)
  await until(async () => !(await switching()), 15000, 40)
  check('a reload on the Acme chat: Acme becomes active by itself', (await cardName()) === 'Acme' && (await hostStatus()).active_workspace_id === ACME.id, await cardName())
  check('on the same chat (no new chat)', (await noNewChat()) && (await g.body()).includes('ACMEONE first message in the Acme folder'))
  await shot('a2-reload')

  // ── 3. the host's safety net: the page does not follow, a message is typed ───────────────────────────────────────────────────────────────
  console.log('\n3. the page does not follow (its answer is rewritten to « nothing to do »): the host switches at claim time')
  // The real host still hears the sighting; the page is told there is nothing to follow (`blind.on`).
  blind.on = true

  // 3a. a team chat on screen, Personal active (the page was told nothing to do): the first request after Enter is billed to the team.
  await hostSwitch(P.id)
  await g.reload()
  await sleep(2500)
  check('(the page, told there is nothing to follow, leaves Personal active on the Acme chat)', (await hostStatus()).active_workspace_id === P.id && (await cardName()) === 'Personal' && (await g.body()).includes('ACMEONE first message in the Acme folder'), { card: await cardName() })
  let mark = fake.chats.length
  let tEnter = null
  fake.model.reply = 'FOLLOW' + RUN + 'X4'
  await g.selectModel(MODEL)
  tEnter = await g.send('ACMETWO second message, typed while Personal is active')
  await until(() => fake.chats.slice(mark).some((c) => c.tools), 15000, 25)
  let after = fake.chats.slice(mark)
  const firstAgent = after.find((c) => c.tools)
  check('the first model request of the turn is billed to Acme (the host switched at claim time and held the request)', firstAgent !== undefined && firstAgent.ws === ACME.id, after.map((c) => (c.ws || '-').slice(0, 8)))
  check('no request of this message carried Personal\'s header', after.every((c) => c.ws !== P.id), after.map((c) => (c.ws || '-').slice(0, 8)))
  note('Enter → first model request: ' + (firstAgent !== undefined ? firstAgent.t0 - tEnter : '?') + ' ms (the switch is held before the request)')
  await until(() => after.every((c) => c.t1 !== null), 15000, 100)
  check('the host says Acme is active', (await hostStatus()).active_workspace_id === ACME.id)
  const tLag = Date.now()
  const caught = await until(async () => (await cardName()) === 'Acme', 40000, 100)
  note('the footer card caught up ' + (caught ? 'after ' + (Date.now() - tLag) + ' ms' : 'NOT within 40 s'))
  check('and the footer card follows within the page\'s report interval (the answer of the periodic report names the active team)', caught === true && Date.now() - tLag <= 15000, { lag: Date.now() - tLag })
  await shot('a3-claim-time')

  // 3b. a personal chat on screen, Acme active, page blind: Personal.
  await openChat(TAG.personal)
  await sleep(2000)
  check('(Acme stays active on the personal chat: the page was told nothing to do)', (await hostStatus()).active_workspace_id === ACME.id, await cardName())
  mark = fake.chats.length
  await say('PERSONALTWO message in the personal chat, typed while Acme is active', 'FOLLOW' + RUN + 'X5')
  after = fake.chats.slice(mark)
  check('the model requests of that turn are billed to Personal (the host went back to Personal at claim time)', after.length >= 1 && after.every((c) => c.ws === P.id), after.map((c) => (c.ws || '-').slice(0, 8)))

  // 3c. a NEW chat: the first message of a blank chat in a team's folder, claimed while Personal is active.
  await openChat(TAG.acme)
  await sleep(1500)
  blind.on = true
  await hostSwitch(P.id)
  await g.val(`(() => { const b = Array.from(document.querySelectorAll('button')).find((x) => /^New chat/.test((x.innerText || '').trim())); if (b) b.click(); return !!b })()`)
  await sleep(1500)
  check('(a new chat opened in Acme\'s folder, Personal still active)', (await hostStatus()).active_workspace_id === P.id)
  mark = fake.chats.length
  await say('ACMENEW the first message of a NEW chat in Acme\'s folder', 'FOLLOW' + RUN + 'X6')
  after = fake.chats.slice(mark)
  check('its first message is billed to Acme: claimed in the team\'s folder, the host switched before the request', after.length >= 1 && after.every((c) => c.ws === ACME.id), after.map((c) => (c.ws || '-').slice(0, 8)))

  blind.on = false
  await g.page.send('Fetch.disable').catch(() => null)

  // ── 4. a reply is running: no switch under it ───────────────────────────────────────────────────────────────────────────────────────────
  console.log('\n4. a reply is running (the fake model holds the agent\'s request): the host refuses to switch under it')
  await openChat(TAG.personal)
  await until(async () => (await cardName()) === 'Personal' && !(await switching()), 15000, 100)
  fake.model.delayMs = 9000
  fake.model.reply = 'FOLLOW' + RUN + 'H1'
  mark = fake.chats.length
  await g.selectModel(MODEL)
  await g.send('PERSONALTHREE a reply that stays running')
  const held = await until(() => fake.chats.slice(mark).find((c) => c.tools), 15000, 50)
  check('(the agent\'s request reached the model and is held: a reply is running, billed to Personal)', held !== undefined && held.ws === P.id && held.t1 === null)
  const busy = await (await fetch('http://' + host + '/kybernos-cloud/space/busy')).json()
  check('the host says so: space/busy', busy.busy === true && busy.running.space_id === P.id && busy.running.count === 1, busy)
  await g.pickSpace(ACME.id)
  const flashed = await until(() => g.text('[data-kb="foot-flash"]'), 4000, 50)
  check('a click on Acme in the menu is refused with one plain sentence naming the team the reply runs in', typeof flashed === 'string' && flashed.includes('A reply is still running in Personal. Switching waits for it or stop it first.'), flashed)
  await shot('a4-refused')
  await sleep(600)
  check('Personal is still active, the card did not move, nothing says « Switching… »', (await hostStatus()).active_workspace_id === P.id && (await cardName()) === 'Personal' && !(await switching()))
  await g.closeMenu()
  const directRefusal = await hostSwitch(ACME.id)
  check('the same refusal for any caller of the route (a script with the page\'s cookie): turn_running, with who is running', directRefusal.ok === false && directRefusal.error === 'turn_running' && directRefusal.running.space_id === P.id, directRefusal)
  await until(() => held.t1 !== null, 20000, 100)
  await sleep(1500)
  const turn1 = fake.chats.slice(mark)
  check('nothing of that reply was billed to another team: every request of the turn carries Personal\'s header', turn1.length >= 1 && turn1.every((c) => c.ws === P.id), turn1.map((c) => (c.ws || '-').slice(0, 8)))
  check('the reply ended: space/busy says nobody is busy any more', (await (await fetch('http://' + host + '/kybernos-cloud/space/busy')).json()).busy === false)
  fake.model.delayMs = 0
  await switchByHand(ACME)
  check('and the same click now switches (a new chat opens in Acme\'s folder)', (await hostStatus()).active_workspace_id === ACME.id && (await cardName()) === 'Acme', await cardName())

  // ── 5. a chat opened while a reply runs: announced, and the switch happens by itself ─────────────────────────────────────────────────────
  console.log('\n5. a chat of another team opened while a reply runs: the notice, then the switch by itself')
  await openChat(TAG.personal)
  await until(async () => (await cardName()) === 'Personal' && !(await switching()), 15000, 100)
  fake.model.delayMs = 9000
  fake.model.reply = 'FOLLOW' + RUN + 'H2'
  mark = fake.chats.length
  await g.selectModel(MODEL)
  await g.send('PERSONALFOUR another reply that stays running')
  const held2 = await until(() => fake.chats.slice(mark).find((c) => c.tools), 15000, 50)
  check('(a reply is running in the personal chat)', held2 !== undefined && held2.ws === P.id)
  await openChat(TAG.acme)
  const notice = await until(() => g.text('[data-kb="cue-mismatch"]'), 5000, 50)
  check('the Acme chat is on screen and the page says what is going on, where the person types', typeof notice === 'string' && notice === 'This chat belongs to Acme; Personal stays active until the reply ends.', notice)
  await shot('a5-notice')
  check('Personal is still active (the switch waits)', (await hostStatus()).active_workspace_id === P.id && (await cardName()) === 'Personal')
  check('the Acme chat stays on screen', (await g.body()).includes('ACMEONE first message in the Acme folder'))
  // The exposure that remains, shown: a message typed in the Acme chat now is billed to the team still active.
  fake.model.delayMs = 0
  fake.model.reply = 'FOLLOW' + RUN + 'H3'
  const mark2 = fake.chats.length
  await g.selectModel(MODEL)
  await g.send('ACMEFOUR typed while the switch waits')
  const typed = await until(() => fake.chats.slice(mark2).find((c) => c.tools), 15000, 50)
  note('EXPOSURE (measured): a message typed in the Acme chat during the deferral was billed to ' + (typed === undefined ? '?' : (typed.ws === P.id ? 'Personal, the team still active' : (typed.ws === ACME.id ? 'Acme' : typed.ws))))
  check('(that message was billed to the team that is still active, as the report says)', typed !== undefined && typed.ws === P.id, typed && typed.ws)
  await until(() => held2.t1 !== null, 20000, 100)
  const tEnd = Date.now()
  const switched = await until(async () => (await cardName()) === 'Acme' && (await hostStatus()).active_workspace_id === ACME.id, 15000, 50)
  note('the last reply ended; the card showed Acme ' + (switched ? 'after ' + (Date.now() - tEnd) + ' ms' : 'NEVER (waited 15 s)'))
  check('the switch happens by itself when the last reply ends (no click)', switched === true, { card: await cardName() })
  check('and the notice is gone', (await g.text('[data-kb="cue-mismatch"]')) === null)
  await until(async () => !(await switching()), 15000, 50)
  const mark3 = fake.chats.length
  await say('ACMEFIVE after the switch', 'FOLLOW' + RUN + 'H4')
  const afterSwitch = fake.chats.slice(mark3)
  check('a message typed in the Acme chat now is billed to Acme', afterSwitch.length >= 1 && afterSwitch.every((c) => c.ws === ACME.id), afterSwitch.map((c) => (c.ws || '-').slice(0, 8)))
  await shot('a5-after')
} finally {
  if (g !== null) await g.close()
  await fake.close()
  try { spawnSync('bash', [join(here, 'sandbox', 'stop.sh')], { env: cleanEnv(), encoding: 'utf8', timeout: 60000 }); cleanRegistry(); upAgain = restart(null) } catch (e) { upAgain = false }
  try { rmSync(stateFile, { force: true }) } catch (e) { /* gone */ }
  try { rmSync(foldersFile, { force: true }) } catch (e) { /* gone */ }
}
console.log('\n' + pass + ' checks passed' + (failures.length > 0 ? ', ' + failures.length + ' FAILED' : '') + (upAgain ? '' : ' (the sandbox did not come back up)'))
process.exit(failures.length > 0 ? 1 : 0)

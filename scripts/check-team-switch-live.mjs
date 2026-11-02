#!/usr/bin/env node
// The account menu's team rows on a REAL page: each team has a DSH of its own (docs/dev/team-profiles-cadrage.md, step 3), so choosing a team opens that DSH in a window
// named after it, and from a team's DSH « Personal » goes back to the personal one. Nothing is switched in the DSH that shows the menu.
//
//   bash scripts/sandbox/start.sh && source scripts/sandbox/env.sh && node scripts/check-team-switch-live.mjs [--shots /tmp/shots]
//
// What is real: the DSH page of the sandbox, the sidebar footer, the menu, every click (CDP mouse events). What is answered in the page (nothing leaves the machine): the cloud
// status of a made-up account, the host's `team-dsh/*` routes (the host is proven by packages/kybernos-cloud/test-team-instances.mjs and scripts/check-team-dsh-live.mjs) and
// `window.open` (recorded, never followed). Sandbox only: it refuses :3080 (exit 3). Exit 0 all good, 1 a check failed, 3 not run.
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { openLivePage, waitFor } from './live-page.mjs'

const host = process.env.KB_HOST || '127.0.0.1:3080'
if (host.endsWith(':3080')) { console.error('○ not run: this check must run against the sandbox (source scripts/sandbox/env.sh), never the real DSH on :3080'); process.exit(3) }
if (!(process.env.DSH_HOME || '').includes('.kybernos-sandbox')) { console.error('○ not run: DSH_HOME is not an isolated instance: source scripts/sandbox/env.sh'); process.exit(3) }
const shotsAt = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null
if (shotsAt !== null) mkdirSync(shotsAt, { recursive: true })

let pass = 0
const failures = []
const check = (label, cond, detail) => {
  if (cond) { pass += 1; console.log('  ✓ ' + label) } else { failures.push(label); console.log('  ✗ ' + label + (detail === undefined ? '' : '  — ' + JSON.stringify(detail).slice(0, 300))) }
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const W_PERSONAL = '11111111-1111-4111-8111-111111111111'
const W_TEAM = '22222222-2222-4222-8222-222222222222'
const W_TEAM2 = '33333333-3333-4333-8333-333333333333'
const SPACES = [
  { id: W_PERSONAL, name: 'Personal', personal: true, role: 'owner' },
  { id: W_TEAM, name: 'Studio', personal: false, role: 'owner' },
  { id: W_TEAM2, name: 'Atelier', personal: false, role: 'member' },
]
const TEAM_URL = 'http://127.0.0.1:3301/?token=NOT-A-REAL-TOKEN'
const PERSONAL_URL = 'http://127.0.0.1:3098/'
const fake = { active: W_PERSONAL, teamDsh: null, open: null, calls: [], asked: [] }
const status = () => ({ ok: true, connected: true, state: {
  user: { email: 'dev@example.test', name: 'Dev Person', plan: 'team' },
  workspaces: SPACES, active_workspace_id: fake.active, team_dsh: fake.teamDsh, own_dsh: true,
  space_plan: { key: 'team', label: 'Team', workspace_id: fake.active }, web_url: 'https://dev.kybernos.app', device_label: 'This computer' } })

const live = await openLivePage({ width: 1400, height: 860 }).catch((e) => { console.error('○ not run: ' + e.message); process.exit(3) })
const { page } = live
const val = async (js) => { const r = await page.evalJs(js, 9000); return r.err !== undefined ? { err: r.err } : r.val }
const mouse = async (x, y) => { for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }) }
const centre = async (sel) => val(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return r.width === 0 ? null : { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)
const until = async (fn, ms = 6000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) return v; await sleep(40) } }
const exists = async (sel) => (await val(`document.querySelector(${JSON.stringify(sel)}) !== null`)) === true
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
const bodyText = () => val(`(document.body.innerText || '').replace(/\\s+/g, ' ')`)
const shot = async (name) => { if (shotsAt !== null) await page.shot(join(shotsAt, name + '.png')) }
const opened = async () => (await val('window.__kbOpened || []')) || []
const WATCH = `(() => { window.__kbOpened = []; window.__kbBlock = false; window.open = (u, n) => { window.__kbOpened.push({ u: String(u), n: String(n) }); return window.__kbBlock ? null : {} } })()`
const dismissGetStarted = () => val(`(() => { const d = Array.from(document.querySelectorAll('[role="dialog"]')).find((x) => /get started/i.test(x.innerText || '')); if (!d) return false; const c = Array.from(d.querySelectorAll('button')).find((b) => /close/i.test(b.getAttribute('aria-label') || b.innerText || '')); if (c) c.click(); return true })()`)

const body64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64')
const answerFor = (path, req) => {
  if (path === '/kybernos-cloud/status') return { body: status() }
  if (path === '/kybernos-cloud/team-dsh/open') { fake.asked.push(JSON.parse(req.postData || '{}').workspace_id); return { body: fake.open, delay: 700 } }
  if (path === '/kybernos-cloud/team-dsh/personal') { fake.asked.push('personal'); return { body: { ok: true, url: PERSONAL_URL } } }
  // The old switch must never be asked for by a click on a team row; if it is, the check below says so.
  if (path === '/kybernos-cloud/space/active') { fake.calls.push('space/active'); return { body: { ok: false, error: 'espace_inconnu' } } }
  if (path === '/kybernos-cloud/refresh') return { body: { ok: true } }
  if (path === '/kybernos-cloud/space/folder') return { body: { ok: false, error: 'non_connecte' } }
  return null
}
await page.send('Fetch.enable', { patterns: [{ urlPattern: '*kybernos-cloud/*' }] })
page.on('Fetch.requestPaused', (p) => {
  const a = answerFor(new URL(p.request.url).pathname, p.request)
  if (a === null) { page.send('Fetch.continueRequest', { requestId: p.requestId }); return }
  const go = () => page.send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 200, responseHeaders: [{ name: 'content-type', value: 'application/json' }], body: body64(a.body) })
  if (a.delay > 0) setTimeout(go, a.delay); else go()
})
const reload = async () => {
  await val('window.__kbStale = true')
  await page.send('Page.reload', { ignoreCache: true })
  await waitFor(page, `window.__kbStale === undefined && document.readyState === 'complete' && document.querySelector('[data-kb="workspace-card"]') !== null`, 30000)
  await dismissGetStarted()
  await val(WATCH)
  await sleep(300)
}
const openMenu = async () => { await press('[data-kb="workspace-card"] .kbfp-cardmain'); await until(() => exists('.kbfp-menu'), 4000) }
const rowSel = (id) => '.kbfp-menu [data-kb="space-row"][data-space="' + id + '"]'

try {
  console.log('account menu, team rows — live on the sandbox')
  fake.open = { ok: true, started: true, port: 3301, url: 'http://127.0.0.1:3301/', signed_url: TEAM_URL }

  // 1. in the personal DSH, a team row opens that team's DSH in a window of its own
  await reload()
  await openMenu()
  check('the menu lists Personal and both teams', (await exists(rowSel(W_PERSONAL))) && (await exists(rowSel(W_TEAM))) && (await exists(rowSel(W_TEAM2))))
  await shot('menu-personal-dsh')
  await press(rowSel(W_TEAM))
  const starting = await until(() => val(`(() => { const s = document.querySelector('[data-kb="workspace-card-switching"]'); return s ? s.innerText : null })()`), 3000)
  check('after the click the card says « Starting… » while the team\'s DSH starts', starting === 'Starting…', starting)
  const pill = await val(`(() => { const p = document.querySelector('[data-kb="cue-switching"]'); return p ? p.innerText : null })()`)
  check('the billing pill (« Switching… ») stays out of it: nothing is switched here', pill === null, pill)
  await shot('starting')
  await until(async () => (await opened()).length > 0, 5000)
  let o = await opened()
  check('the team\'s signed address is opened in a window named after the team', o.length === 1 && o[0].u === TEAM_URL && o[0].n === 'kybernos-team-' + W_TEAM, o)
  check('the host was asked for that team, and the old switch was not asked at all', JSON.stringify(fake.asked) === JSON.stringify([W_TEAM]) && fake.calls.length === 0, { asked: fake.asked, calls: fake.calls })
  await until(async () => !(await exists('[data-kb="workspace-card-switching"]')), 4000)
  const cardName = await val(`(document.querySelector('[data-kb="workspace-card"] .kbfp-cardname') || { innerText: '' }).innerText`)
  check('the card is back, and still on Personal: this DSH did not switch', cardName === 'Personal', cardName)

  // 2. the second team, and the same team again: the window name is the team\'s, so the browser finds it again
  await openMenu()
  await press(rowSel(W_TEAM2))
  await until(async () => (await opened()).length > 1, 5000)
  o = await opened()
  check('another team gets its own window name', o.length === 2 && o[1].n === 'kybernos-team-' + W_TEAM2, o)

  // 3. the team\'s DSH cannot start: said in words, nothing opened
  fake.open = { ok: false, error: 'start_timeout' }
  await openMenu()
  await press(rowSel(W_TEAM))
  const said = await until(async () => /Could not open Studio right now/.test(await bodyText()), 5000)
  check('a DSH that cannot start is said in words, and no window is opened', said === true && (await opened()).length === 2, await opened())
  await shot('failed')

  // 4. a browser that refuses the window: the person is told and has one click that opens it
  fake.open = { ok: true, started: false, port: 3301, url: 'http://127.0.0.1:3301/', signed_url: TEAM_URL }
  await val('window.__kbBlock = true')
  await openMenu()
  await press(rowSel(W_TEAM))
  const ready = await until(async () => /Studio is ready in its own window/.test(await bodyText()), 5000)
  check('a window the browser refused is announced with an « Open » action', ready === true)
  await shot('blocked')
  const before = (await opened()).length
  const clicked = await val(`(() => { const b = Array.from(document.querySelectorAll('button, [role="button"], a')).find((e) => (e.innerText || '').trim() === 'Open'); if (!b) return false; b.click(); return true })()`)
  await until(async () => (await opened()).length > before, 3000)
  o = await opened()
  check('and that click opens it', clicked === true && o.length === before + 1 && o[o.length - 1].u === TEAM_URL, o)
  await val('window.__kbBlock = false')

  // 5. inside a team\'s DSH: Personal goes back to the personal DSH, another team opens its own
  fake.active = W_TEAM
  fake.teamDsh = W_TEAM
  fake.asked = []
  fake.calls = []
  await reload()
  const here = await val(`(document.querySelector('[data-kb="workspace-card"] .kbfp-cardname') || { innerText: '' }).innerText`)
  check('a team\'s DSH shows its team on the card', here === 'Studio', here)
  await openMenu()
  await shot('menu-team-dsh')
  await press(rowSel(W_PERSONAL))
  await until(async () => (await opened()).length > 0, 5000)
  o = await opened()
  check('« Personal » opens the personal DSH, in its own window name', o.length === 1 && o[0].u === PERSONAL_URL && o[0].n === 'kybernos-personal', o)
  await openMenu()
  await press(rowSel(W_TEAM2))
  await until(async () => (await opened()).length > 1, 5000)
  o = await opened()
  check('another team opens that team\'s DSH from here too', o.length === 2 && o[1].n === 'kybernos-team-' + W_TEAM2, o)
  check('nothing was switched in the team\'s DSH either', fake.calls.length === 0, fake.calls)

  console.log('\n' + pass + ' checks, ' + failures.length + ' failed')
} finally {
  await live.close()
}
process.exit(failures.length === 0 ? 0 : 1)

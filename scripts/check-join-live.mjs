// « Join with an invitation link » on a REAL page, against the sandbox's REAL host routes and a FAKE Kybernos server (plan « Équipes », step 4).
//
//   source scripts/sandbox/env.sh && node scripts/check-join-live.mjs [--shots /tmp/shots]
//
// What is real: the DSH page, the sidebar footer and its menu, the dialog, every click and key (CDP input events), the host routes of kybernos-cloud
// (`/kybernos-cloud/invitation/preview`, `/accept`, `space/active`, `space/applied`), the state file, the model route DSH rewrites on a switch.
// What is answered by this script: the Kybernos API, a fake started here on a local port (the sandbox is restarted with KYBERNOS_CLOUD_API and
// KYBERNOS_CLOUD_STATE pointing at it, and a connected state file written in a throw-away name). It answers each invitation the way the real server's contract
// does (docs: POST /v1/invitations/preview and /accept): a good one, a team without a plan, ONE 404 for used / expired / withdrawn / someone else's, a full team
// (409 seat_limit, the link stays valid), 429, an unexpected 500, and a server that hangs up. It records every request, so the checks can say where the token went.
//
// Sandbox only: it refuses :3080 (exit 3) and any DSH home that is not under .kybernos-sandbox. It stops and restarts the sandbox; when it ends it restarts it
// signed out, as scripts/check-footer-live.mjs expects. Exit 0 all good, 1 a check failed, 3 not run.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cookieDeSession } from './cdp-lib.mjs'
import { openLivePage, waitFor } from './live-page.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const host = process.env.KB_HOST || '127.0.0.1:3080'
if (host.endsWith(':3080')) { console.error('○ not run: this check must run against the sandbox (source scripts/sandbox/env.sh), never the real DSH on :3080'); process.exit(3) }
const DSH_HOME = process.env.DSH_HOME || ''
if (!DSH_HOME.includes('.kybernos-sandbox')) { console.error('○ not run: DSH_HOME is not an isolated instance (' + (DSH_HOME || 'unset') + '): source scripts/sandbox/env.sh'); process.exit(3) }
const shotsAt = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null
if (shotsAt !== null) mkdirSync(shotsAt, { recursive: true })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0
const failures = []
const check = (label, cond, detail) => {
  if (cond) { pass += 1; console.log('  ✓ ' + label) } else { failures.push(label); console.log('  ✗ ' + label + (detail === undefined ? '' : '  — ' + JSON.stringify(detail).slice(0, 400))) }
}

// ── The fake Kybernos ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const DEVICE_TOKEN = 'kys_fake_join_token'
const ME = { id: 'u-1', name: 'Dev Person', email: 'dev@example.test', plan: 'team' }
const P = { id: '11111111-1111-4111-8111-111111111111', name: 'My workspace', personal: true, role: 'owner', created_at: '2026-01-01T00:00:00Z' }
const ACME = { id: '22222222-2222-4222-8222-222222222222', name: 'Acme', personal: false, role: 'admin', created_at: '2026-01-02T00:00:00Z' }
const STUDIO = { id: '33333333-3333-4333-8333-333333333333', name: 'Studio B', personal: false, role: 'member', created_at: '2026-01-03T00:00:00Z' }
const NOVA = { id: '44444444-4444-4444-8444-444444444444', name: 'Nova Labs', personal: false, role: 'member', created_at: '2026-01-04T00:00:00Z' }
const tok = (c) => 'Tk' + c.repeat(40) + 'q' // 43 characters of base64url, as the server's 32 random bytes make
const T = { ok: tok('a'), noplan: tok('b'), used: tok('c'), full: tok('d'), busy: tok('e'), boom: tok('f'), other: tok('g'), hang: tok('h') }
const INVITES = {
  [T.ok]: { workspace: STUDIO, inviter: 'Ada Lovelace', email: ME.email, role: 'member' },
  [T.noplan]: { workspace: NOVA, inviter: 'Grace Hopper', email: ME.email, role: 'member', noPlan: true },
  [T.full]: { workspace: { id: '55555555-5555-4555-8555-555555555555', name: 'Full Co', personal: false, role: 'member', created_at: '2026-01-05T00:00:00Z' }, inviter: 'Linus', email: ME.email, role: 'member', full: true },
  [T.other]: { workspace: { id: '66666666-6666-4666-8666-666666666666', name: 'Elsewhere', personal: false, role: 'admin', created_at: '2026-01-06T00:00:00Z' }, inviter: null, email: 'someone.else@example.test', role: 'admin' },
}
const fake = { calls: [], spaces: [P, ACME], down: false, consumed: new Set() }
const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json', date: new Date().toUTCString() }); res.end(JSON.stringify(body)) }
const win = (kind, seconds, percent) => ({ kind, window_seconds: seconds, scope: 'plan', limit_usd: '10.00', spent_usd: '1.00', remaining_usd: '9.00', exhausted: false, used_percent: percent, resets_at: null })
const apiServer = createServer((req, res) => {
  let raw = ''
  req.on('data', (d) => { raw += d })
  req.on('end', () => {
    const url = String(req.url).split('?')[0]
    const call = { method: req.method, url: String(req.url), path: url, auth: req.headers.authorization || null, ws: typeof req.headers['x-kybernos-workspace'] === 'string' ? req.headers['x-kybernos-workspace'] : null, body: raw }
    fake.calls.push(call)
    if (fake.down === true && url.startsWith('/v1/invitations/')) { req.socket.destroy(); return }
    let sent = {}
    try { sent = JSON.parse(raw || '{}') } catch (e) { sent = {} }
    if (req.method === 'POST' && (url === '/v1/invitations/preview' || url === '/v1/invitations/accept')) {
      const token = typeof sent.token === 'string' ? sent.token : ''
      const accept = url.endsWith('/accept')
      if (token === T.busy) return json(res, 429, { error: 'rate_limited', message: 'Too many requests.' })
      if (token === T.boom) return json(res, 500, { error: 'internal', message: 'boom' })
      const inv = INVITES[token]
      if (inv === undefined || (accept && fake.consumed.has(token))) return json(res, 404, { error: 'not_found', message: 'This invitation is invalid or has expired.' })
      if (!accept) return json(res, 200, { workspace_name: inv.workspace.name, inviter_name: inv.inviter, email: inv.email, role: inv.role, expires_at: '2026-10-25T10:00:00.000Z' })
      if (call.auth !== 'Bearer ' + DEVICE_TOKEN) return json(res, 401, { error: 'unauthorized', message: 'Sign in required.' })
      if (inv.email !== ME.email) return json(res, 404, { error: 'not_found', message: 'This invitation is invalid or has expired.' })
      if (inv.full === true) return json(res, 409, { error: 'seat_limit', message: 'No free seat.' })
      fake.consumed.add(token)
      if (!fake.spaces.some((s) => s.id === inv.workspace.id)) fake.spaces = fake.spaces.concat([inv.workspace])
      return json(res, 200, inv.workspace)
    }
    if (url === '/v1/workspaces') return json(res, 200, { workspaces: fake.spaces })
    if (url === '/v1/me') return json(res, 200, ME)
    if (url === '/v1/models') return json(res, 200, { data: [{ id: 'kybernos/glm', object: 'model' }] })
    const m = /^\/v1\/workspaces\/([^/]+)\/(plan|llm\/budget|members)$/.exec(url)
    if (m !== null) {
      const space = fake.spaces.find((s) => s.id === m[1])
      if (space === undefined) return json(res, 404, { error: 'not_found' })
      if (m[2] === 'plan') {
        if (space.personal) return json(res, 200, { source: 'none', status: 'active', plan: { key: 'free', name: 'Free', kind: 'free' }, level: null, seats: 1, credit_balance_credits: 0 })
        if (space.id === NOVA.id) return json(res, 200, { source: 'none', status: 'active', plan: null, level: null, seats: 1, credit_balance_credits: 0 })
        return json(res, 200, { source: 'subscription', status: 'active', plan: { key: 'team', name: 'Team', kind: 'team' }, level: '1-5 seats', seats: 5, credit_balance_credits: 0 })
      }
      if (m[2] === 'llm/budget') return json(res, 200, { windows: space.personal ? [win('member', 2592000, 3)] : [win('member', 18000, 12), win('member', 604800, 30), win('pool', 2592000, 40)] })
      return json(res, 200, { members: [] })
    }
    json(res, 404, { error: 'not_found', path: url })
  })
})
await new Promise((resolve) => apiServer.listen(0, '127.0.0.1', resolve))
const apiUrl = 'http://127.0.0.1:' + apiServer.address().port

// ── The sandbox, pointed at the fake and connected ───────────────────────────────────────────────────────────────────────────────────────────────
const stateFile = join(DSH_HOME, 'kybernos-cloud-join-check.json')
const writeConnected = () => {
  mkdirSync(dirname(stateFile), { recursive: true })
  writeFileSync(stateFile, JSON.stringify({ token: DEVICE_TOKEN, api: apiUrl, user: ME, workspaces: [P, ACME], active_workspace_id: P.id, device_label: 'Sandbox', refreshed_at: new Date().toISOString() }, null, 2), { mode: 0o600 })
}
const sandbox = (script, extraEnv) => spawnSync('bash', [join(here, 'sandbox', script)], { env: Object.assign({}, process.env, extraEnv || {}), encoding: 'utf8', timeout: 240000 })
const cleanEnv = () => { const e = Object.assign({}, process.env); delete e.KYBERNOS_CLOUD_API; delete e.KYBERNOS_CLOUD_STATE; return e }
const restart = (extraEnv) => {
  spawnSync('bash', [join(here, 'sandbox', 'stop.sh')], { env: cleanEnv(), encoding: 'utf8', timeout: 60000 })
  const r = spawnSync('bash', [join(here, 'sandbox', 'start.sh')], { env: extraEnv === null ? cleanEnv() : Object.assign(cleanEnv(), extraEnv), encoding: 'utf8', timeout: 240000 })
  return r.status === 0
}

let live = null
let upAgain = false
try {
  writeConnected()
  const up = restart({ KYBERNOS_CLOUD_API: apiUrl, KYBERNOS_CLOUD_STATE: stateFile })
  check('the sandbox restarts, pointed at the fake Kybernos and connected (a throw-away state file)', up === true)
  if (up !== true) throw new Error('the sandbox did not restart')

  live = await openLivePage({ width: 1400, height: 860 }).catch((e) => { console.error('○ not run: ' + e.message); process.exit(3) })
  const { page } = live
  const val = async (js) => { const r = await page.evalJs(js, 9000); return r.err !== undefined ? { err: r.err } : r.val }
  const mouse = async (x, y) => { for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }) }
  const KEY_CODES = { Escape: 27, Enter: 13, Tab: 9 }
  const pressKey = async (k) => {
    await page.send('Input.dispatchKeyEvent', Object.assign({ type: k === 'Enter' ? 'keyDown' : 'rawKeyDown', key: k, code: k, windowsVirtualKeyCode: KEY_CODES[k] }, k === 'Enter' ? { text: '\r' } : {}))
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k, windowsVirtualKeyCode: KEY_CODES[k] })
  }
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
  const rect = async (sel) => val(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) } })()`)
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
  const contrastOf = (sel) => val(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null
    const cv = document.createElement('canvas'); cv.width = 1; cv.height = 1; const g = cv.getContext('2d', { willReadFrequently: true })
    const pixel = (layers) => { g.clearRect(0, 0, 1, 1); for (const c of layers) { g.fillStyle = c; g.fillRect(0, 0, 1, 1) } const d = g.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2]] }
    const chain = []; for (let n = el; n; n = n.parentElement) chain.unshift(getComputedStyle(n).backgroundColor)
    const bg = pixel(['#808080'].concat(chain)); const fg = pixel([getComputedStyle(el).color])
    const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]) }
    const a = lum(bg); const b = lum(fg); return Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100 })()`)
  const schemeNow = async () => ((await val(`document.body.hasAttribute('data-ds-dark-theme')`)) === true ? 'dark' : 'light')
  const openProfileMenu = async () => { if (await exists('.kbfp-menu')) return; await press('[data-kb="workspace-card"] .kbfp-cardmain'); await until(() => exists('.kbfp-menu'), 4000) }
  const status = async () => { const r = await fetch('http://' + host + '/kybernos-cloud/status'); return r.json().catch(() => null) }
  const callsTo = (path) => fake.calls.filter((c) => c.path === path)
  const inviteCalls = () => fake.calls.filter((c) => c.path.startsWith('/v1/invitations/'))

  // The dialog: through the menu's row (inline for up to 3 spaces; in the « Switch team » panel from 4).
  const openJoin = async () => {
    await openProfileMenu()
    const inline = await exists('.kbfp-menu [data-kb="space-join"]')
    if (!inline) { await press('.kbfp-menu [data-kb="menu-switch"]'); await until(() => exists('.kbfp-sub [data-kb="space-join"]'), 4000) }
    await press(inline ? '.kbfp-menu [data-kb="space-join"]' : '.kbfp-sub [data-kb="space-join"]')
    return (await until(() => exists('[data-kb="join-team"]'), 4000)) === true
  }
  const paste = async (s) => {
    await val(`(() => { const i = document.querySelector('[data-kb="join-input"]'); i.focus(); i.select() })()`)
    await page.send('Input.insertText', { text: s })
  }
  const step = () => val(`(document.querySelector('[data-kb="join-team"]') || { getAttribute: () => null }).getAttribute('data-step')`)
  const noteNow = () => text('[data-kb="join-note"]')
  const closeJoin = async () => { await pressKey('Escape'); await until(gone('[data-kb="join-team"]'), 3000) }
  const linkOf = (token, base = 'https://dev.kybernos.app') => base + '/invitations/accept?token=' + token
  const check1 = async (token) => { await paste(linkOf(token)); await pressKey('Enter'); await until(async () => (await step()) === 'preview' || (await noteNow()) !== null, 6000) }

  await reload()
  const startScheme = await schemeNow()

  // 1. The row, in the inline list (two spaces), right under « Create a team »; nothing is asked of anyone until a click.
  await openProfileMenu()
  const order = await val(`Array.from(document.querySelectorAll('.kbfp-menu [data-kb="space-create"], .kbfp-menu [data-kb="space-join"]')).map((e) => e.getAttribute('data-kb'))`)
  check('two spaces: the menu lists them and has « Create a team » then « Join with an invitation link », in that order', JSON.stringify(order) === JSON.stringify(['space-create', 'space-join']) && /Join with an invitation link/.test((await text('.kbfp-menu [data-kb="space-join"]')) || ''), order)
  await shot('j-row-' + startScheme)
  check('nothing has been sent to the Kybernos server about an invitation yet', inviteCalls().length === 0, inviteCalls().length)
  await press('.kbfp-menu [data-kb="space-join"]')
  check('the row opens the dialog, the menu closes behind it and the box has the focus', (await until(() => exists('[data-kb="join-team"]'), 4000)) === true && !(await exists('.kbfp-menu')) && (await val(`document.activeElement && document.activeElement.getAttribute('data-kb')`)) === 'join-input')
  await sleep(500)
  check('the dialog open and empty asks nothing of the host', inviteCalls().length === 0)
  check('« Check » is not pressable while nothing is pasted', (await val(`document.querySelector('[data-kb="join-check"]').disabled`)) === true)
  await shot('j-paste-' + startScheme)

  // 2. Junk is said in words and goes nowhere.
  await paste('hello there')
  await pressKey('Enter')
  await until(async () => (await noteNow()) !== null, 3000)
  check('a pasted text that is no link and no code is said so, and nothing is sent', /neither an invitation link nor its code/.test((await noteNow()) || '') && inviteCalls().length === 0, await noteNow())
  await paste('https://dev.kybernos.app/account')
  await pressKey('Enter')
  await until(async () => /not an invitation/.test((await noteNow()) || ''), 3000)
  check('a link that is not an invitation\'s is said so, and nothing is sent', /not an invitation/.test((await noteNow()) || '') && inviteCalls().length === 0, await noteNow())

  // 3. A good link (the host of the link is NOT the active server's): the preview, then the second click.
  await paste(linkOf(T.ok, 'https://evil.example'))
  check('typing clears the note', (await noteNow()) === null)
  await pressKey('Enter')
  await until(async () => (await step()) === 'preview', 6000)
  const pre = inviteCalls()
  check('Enter checks it: ONE call, to the fake Kybernos (the active server) and no other, a POST whose body is the token alone and whose address carries none', pre.length === 1 && pre[0].method === 'POST' && pre[0].path === '/v1/invitations/preview' && pre[0].url === '/v1/invitations/preview' && JSON.stringify(JSON.parse(pre[0].body)) === JSON.stringify({ token: T.ok }), pre)
  check('the preview asks without the device token (it is a public question)', pre.length === 1 && pre[0].auth === null, pre[0] && pre[0].auth)
  const who = await text('[data-kb="join-who"]')
  check('the card says who invited, the team and the role, and the address it was sent to', who === 'Ada Lovelace invited you to join “Studio B” as member.' && /Sent to dev@example\.test\./.test((await text('[data-kb="join-sent-to"]')) || ''), who)
  check('the signed-in address is the invited one: no warning; the token is drawn nowhere', !(await exists('[data-kb="join-mismatch"]')) && !((await text('[data-kb="join-team"]')) || '').includes(T.ok))
  check('nothing is accepted before the second click', callsTo('/v1/invitations/accept').length === 0)
  await shot('j-preview-' + startScheme)
  const ratios = {}
  for (const [name, sel] of [['sentence', '[data-kb="join-who"]'], ['note', '[data-kb="join-sent-to"]'], ['title', '.kbc-title']]) ratios[name] = await contrastOf('[data-kb="join-team"] ' + sel)
  check('the dialog\'s text reads on its surface (contrast at least 4.5, ' + startScheme + ')', Object.values(ratios).every((v) => v !== null && v >= 4.5), ratios)

  // 4. Join: accepted with the device token, the list read again, the plan read, then the ORDINARY switch (route rewritten, « Switching… » until DSH applies it).
  fake.calls.length = 0
  await press('[data-kb="join-accept"]')
  await until(() => exists('[data-kb="workspace-card-switching"]'), 8000)
  const early = await val(`(() => { const s = document.querySelector('[data-kb="workspace-card-switching"]'); const c = document.querySelector('[data-kb="workspace-card"] .kbfp-cardname'); return { text: s ? s.innerText : null, name: c ? c.innerText : null, dialog: !!document.querySelector('[data-kb="join-team"]') } })()`)
  check('the dialog closes and the card says « Switching… » with the team just joined', early.text === 'Switching…' && early.name === 'Studio B' && early.dialog === false, early)
  await shot('j-switching-' + startScheme)
  await until(gone('[data-kb="workspace-card-switching"]'), 15000)
  const accept = callsTo('/v1/invitations/accept')
  check('the acceptance went to the fake Kybernos once, with the device token as proof and the invitation token in the body only', accept.length === 1 && accept[0].auth === 'Bearer ' + DEVICE_TOKEN && JSON.stringify(JSON.parse(accept[0].body)) === JSON.stringify({ token: T.ok }) && accept[0].url === '/v1/invitations/accept', accept)
  const seq = fake.calls.map((c) => c.method + ' ' + c.path.replace(STUDIO.id, '{studio}'))
  const iAccept = seq.indexOf('POST /v1/invitations/accept')
  check('then the list of teams and the new team\'s plan were read again, before the switch', iAccept >= 0 && seq.indexOf('GET /v1/workspaces') > iAccept && seq.indexOf('GET /v1/workspaces/{studio}/plan') > iAccept, seq.slice(0, 12))
  const models = callsTo('/v1/models').filter((c) => c.ws === STUDIO.id)
  check('the model route was rewritten for the new team (the catalogue was read in its name), so the next message is billed to it', models.length >= 1, fake.calls.filter((c) => c.path === '/v1/models').map((c) => c.ws))
  const st = await status()
  check('the host\'s state: Studio B is in the list and is the active team', st !== null && st.state.active_workspace_id === STUDIO.id && st.state.workspaces.map((w) => w.id).includes(STUDIO.id), st && st.state && st.state.active_workspace_id)
  check('the card is back to normal with the new team', (await text('[data-kb="workspace-card"] .kbfp-cardname')) === 'Studio B' && !(await exists('[data-kb="workspace-card-switching"]')))
  check('the invitation\'s token was in no address sent to the server', fake.calls.every((c) => !c.url.includes(T.ok)))

  // 5. A team that has no plan: joined, listed, and the person stays where they are, told.
  check('three spaces now: still the list in the menu, and the join row is there', (await openProfileMenu(), await exists('.kbfp-menu [data-kb="space-join"]')))
  await press('.kbfp-menu [data-kb="space-join"]')
  await until(() => exists('[data-kb="join-team"]'), 4000)
  fake.calls.length = 0
  await check1(T.noplan)
  await press('[data-kb="join-accept"]')
  await until(() => exists('[data-kb="foot-flash"]'), 8000)
  const flash = await text('[data-kb="foot-flash"]')
  check('a team without a plan: the person is told it has none and where they still are', /You joined “Nova Labs”, which has no plan yet\. You are still in “Studio B”\./.test(flash || ''), flash)
  await sleep(800)
  const st2 = await status()
  check('they stay in Studio B, the new team is in the list, and no switch was made (no catalogue read in its name)', st2.state.active_workspace_id === STUDIO.id && st2.state.workspaces.map((w) => w.id).includes(NOVA.id) && callsTo('/v1/models').every((c) => c.ws !== NOVA.id), { active: st2.state.active_workspace_id })
  check('a member has no plan to choose: the notice offers no action', !(await exists('[data-kb="foot-flash-action"]')))
  await shot('j-noplan-' + startScheme)

  // 6. Four spaces now: the row is in the « Switch team » panel too. Every refusal has its sentence; the dialog stays at its step.
  await reload()
  check('four spaces: the menu holds no list, the row is in the « Switch team » panel', await openJoin())
  check('the dialog opened from the panel', (await step()) === 'paste')
  const words = (note, list) => note !== null && list.every((w) => note.includes(w))
  await check1(T.used)
  let note = await noteNow()
  check('used / withdrawn / expired / someone else\'s: ONE sentence naming them all, and the dialog is still on the paste step', words(note, ['expired', 'used', 'withdrawn', 'another account']) && (await step()) === 'paste' && !(await exists('[data-kb="join-browser"]')), note)
  await shot('j-gone-' + startScheme)
  await check1(T.busy)
  note = await noteNow()
  check('429: « too many tries »', /Too many tries/.test(note || '') && !(await exists('[data-kb="join-browser"]')), note)
  await check1(T.boom)
  note = await noteNow()
  const web = (await status()).state.web_url
  const href = await val(`(document.querySelector('[data-kb="join-browser"]') || { getAttribute: () => null }).getAttribute('href')`)
  check('an unexpected failure says so and offers the server\'s own page, on the ACTIVE server\'s web address, with the token', /did not work out/.test(note || '') && href === new URL(web).origin + '/invitations/accept?token=' + T.boom, { note, href, web })
  await shot('j-browser-' + startScheme)
  await check1(T.other)
  check('an invitation sent to another address says which one, and the button stays (the server decides)', /someone\.else@example\.test/.test((await text('[data-kb="join-mismatch"]')) || '') && /dev@example\.test/.test((await text('[data-kb="join-mismatch"]')) || '') && (await val(`document.querySelector('[data-kb="join-accept"]').disabled`)) === false && /You were invited to join “Elsewhere” as admin\./.test((await text('[data-kb="join-who"]')) || ''))
  await press('[data-kb="join-accept"]')
  await until(async () => (await noteNow()) !== null, 6000)
  note = await noteNow()
  check('accepting it with the wrong account: the same single sentence, the state untouched', words(note, ['expired', 'used', 'withdrawn', 'another account']) && (await status()).state.workspaces.length === 4, note)
  await closeJoin()
  // The full team: preview fine, acceptance 409, the link stays valid (asked twice, answered the same, never consumed).
  check('reopened for the full team', await openJoin())
  await check1(T.full)
  await press('[data-kb="join-accept"]')
  await until(async () => (await noteNow()) !== null, 6000)
  note = await noteNow()
  check('a full team: the sentence says no seat is free and that the link stays valid; the dialog stays on the preview', words(note, ['no free seat', 'stays valid']) && (await step()) === 'preview', note)
  await press('[data-kb="join-accept"]')
  await sleep(800)
  check('asked again it answers the same: the link was not used up, nobody joined', callsTo('/v1/invitations/accept').filter((c) => JSON.parse(c.body).token === T.full).length === 2 && !fake.consumed.has(T.full) && (await status()).state.workspaces.length === 4)
  await closeJoin()

  // 7. The guard of the routes, with the sandbox's own session cookie.
  const cookie = cookieDeSession(host)
  const post = async (path, headers, body) => { const r = await fetch('http://' + host + '/kybernos-cloud/' + path, { method: 'POST', headers: Object.assign({ 'content-type': 'application/json' }, headers), body: JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => null) } }
  const own = 'http://' + host
  const before = inviteCalls().length
  const noHeader = await post('invitation/accept', {}, { token: T.used })
  const foreign = await post('invitation/accept', { origin: 'http://evil.example', cookie: cookie.nom + '=' + cookie.valeur }, { token: T.used })
  const noCookie = await post('invitation/accept', { origin: own }, { token: T.used })
  check('accept: no Origin 403, a foreign Origin 403 (even with the cookie), the right Origin without the signed session 401, and the server heard nothing', noHeader.status === 403 && foreign.status === 403 && noCookie.status === 401 && inviteCalls().length === before, { noHeader: noHeader.status, foreign: foreign.status, noCookie: noCookie.status })
  const previewNoHeader = await post('invitation/preview', {}, { token: T.used })
  const previewForeign = await post('invitation/preview', { origin: 'http://evil.example' }, { token: T.used })
  check('preview: no Origin 403, a foreign Origin 403', previewNoHeader.status === 403 && previewForeign.status === 403 && inviteCalls().length === before, { a: previewNoHeader.status, b: previewForeign.status })
  const real = await post('invitation/accept', { origin: own, cookie: cookie.nom + '=' + cookie.valeur }, { token: T.used })
  check('accept with the real pair reaches the server and answers the uniform refusal', real.status === 200 && real.body.ok === false && real.body.error === 'invitation_unusable', real)

  // 8. A server that hangs up.
  fake.down = true
  check('the dialog again, for a server that hangs up', await openJoin())
  await check1(T.ok)
  note = await noteNow()
  check('a server that does not answer: « could not be reached », at the paste step', /could not be reached/.test(note || '') && (await step()) === 'paste', note)
  fake.down = false
  await closeJoin()

  // 9. Dark and light, the dialog's text on its surface; a phone; French.
  for (const scheme of ['dark', 'light']) {
    await openProfileMenu()
    await val(`(() => { const b = document.querySelector('.kbfp-menu [data-kb="menu-appearance"] button[aria-label="${scheme === 'light' ? 'Light' : 'Dark'}"]'); if (b) b.click() })()`)
    await until(async () => (await schemeNow()) === scheme, 3000)
    await sleep(300)
    if (await exists('.kbfp-menu')) await press('[data-kb="workspace-card"] .kbfp-cardmain')
    await until(gone('.kbfp-menu'), 3000)
    check('the page is drawn in ' + scheme, (await schemeNow()) === scheme)
    check('the dialog opens in ' + scheme, await openJoin())
    await check1(T.used)
    const r2 = {}
    for (const [name, sel] of [['note', '[data-kb="join-note"]'], ['intro', '[data-kb="join-intro"]'], ['input', '[data-kb="join-input"]'], ['button', '[data-kb="join-check"]']]) r2[name] = await contrastOf('[data-kb="join-team"] ' + sel)
    check(scheme + ': the note, the intro and the button read on the dialog (contrast at least 4.5)', Object.values(r2).filter((v) => v !== null).length >= 3 && Object.values(r2).filter((v) => v !== null).every((v) => v >= 4.5), r2)
    await shot('j-gone-' + scheme + '-contrast')
    await closeJoin()
  }

  await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  await reload()
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await until(() => exists('[data-kb="workspace-card"] .kbfp-cardmain'), 15000)
    await press('[data-kb="mobile-menu"]')
    if (await until(async () => { const r = await rect('[data-kb="workspace-card"] .kbfp-cardmain'); return r !== null && r !== undefined && r.x >= 0 }, 4000)) break
    await reload()
  }
  check('390 px: the dialog opens', await openJoin())
  const fits = (r) => r !== null && r !== undefined && r.x >= 0 && r.y >= 0 && r.x + r.w <= 390 && r.y + r.h <= 844
  check('390 px: the paste step fits the window', fits(await rect('[data-kb="join-team"]')), await rect('[data-kb="join-team"]'))
  await check1(T.ok)
  await sleep(200)
  check('390 px: the preview step fits the window', fits(await rect('[data-kb="join-team"]')), await rect('[data-kb="join-team"]'))
  await shot('j-phone-preview')
  await closeJoin()
  await page.send('Emulation.clearDeviceMetricsOverride', {})
  await reload()

  await val(`(() => { window.__kbLangBefore = window.__KB_LANG_RESOLVE__; window.__KB_LANG_RESOLVE__ = () => 'kybernos' })()`)
  await openProfileMenu()
  await press('.kbfp-menu [data-kb="menu-switch"]') // four spaces: the list is in the « Switch team » panel
  await until(() => exists('.kbfp-sub [data-kb="space-join"]'), 4000)
  await until(async () => /Rejoindre/.test((await text('.kbfp-sub')) || ''), 3000)
  check('French: the row says « Rejoindre avec un lien d\'invitation »', /Rejoindre avec un lien d'invitation/.test((await text('.kbfp-sub [data-kb="space-join"]')) || ''), await text('.kbfp-sub'))
  await press('.kbfp-sub [data-kb="space-join"]')
  await until(() => exists('[data-kb="join-team"]'), 4000)
  check('French: the dialog says its intro and its button in French', /Colle le lien/.test((await text('[data-kb="join-intro"]')) || '') && /Vérifier/.test((await text('[data-kb="join-check"]')) || ''), await text('[data-kb="join-team"]'))
  await shot('j-fr-paste')
  await val(`(() => { window.__KB_LANG_RESOLVE__ = window.__kbLangBefore; delete window.__kbLangBefore })()`)
  await closeJoin()

  // 10. Hygiene: the invitations' tokens are nowhere in the sandbox's log.
  const log = existsSync(join(dirname(DSH_HOME), '..', 'sandbox.log')) ? readFileSync(join(dirname(DSH_HOME), '..', 'sandbox.log'), 'utf8') : ''
  check('none of the invitations\' tokens is in the sandbox\'s log', Object.values(T).every((t) => !log.includes(t)))
} finally {
  if (live !== null) await live.close()
  await new Promise((resolve) => apiServer.close(resolve))
  // The sandbox goes back to signed out, as the other live checks expect it; the throw-away state file goes.
  try { upAgain = restart(null) } catch (e) { upAgain = false }
  try { rmSync(stateFile, { force: true }) } catch (e) { /* gone */ }
}
console.log('\n' + pass + ' checks passed' + (failures.length > 0 ? ', ' + failures.length + ' FAILED' : '') + (upAgain ? '' : ' (the sandbox did not come back up)'))
process.exit(failures.length > 0 ? 1 : 0)

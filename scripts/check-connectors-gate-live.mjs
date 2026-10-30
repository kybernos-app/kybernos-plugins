#!/usr/bin/env node
// Checks Connectors › Discover against a REAL DSH GUI, with a stand-in server that speaks ADR 0008 of the Kybernos server
// plus its two PUBLIC routes (`GET /v1/connections/catalogue` and `/catalogue/logo?slug=`).
//
//   source scripts/sandbox/env.sh && scripts/sandbox/start.sh      # an isolated instance serving this checkout
//   node scripts/check-connectors-gate-live.mjs [--shots <dir>]
//
// What it plays: a person who is NOT signed in sees the whole catalogue (names, logos, descriptions) without any token; the logos come
// from this machine's own routes and a logo that does not come leaves a letter; opening an app shows the two-way gate (a free Kybernos
// account, or their own Composio key) instead of « Add a connection »; the account path pairs in the page and carries on to the add
// window for that very app; once signed in there is no gate and the session pill says so; a plan without connections says so in the gate;
// and an older server (no public route) leaves the local catalogue with the button to try again.
//
// It writes into the isolated instance only (a server entry and a connection file with made-up tokens) and puts both back at the end.
// It REFUSES to run against the real DSH (127.0.0.1:3080) or without an isolated DSH_HOME. The host half (the /kybernos-cloud/connections*
// routes) must be the current code: restart the sandbox after a host edit (scripts/sandbox/stop.sh, then start.sh).
//
// It never saves a Composio key (that would call Composio): the key path is only looked at.
//
// Exit code: 0 all green, 1 a check failed, 3 inconclusive (GUI down / the page did not open).
// Named check-*, not test-*: CI runs every test-*.mjs with no DSH, and this one needs one.
import { createServer } from 'node:http'
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { openLivePage, waitFor } from './live-page.mjs'

const args = process.argv.slice(2)
const shotsDir = args.indexOf('--shots') >= 0 ? args[args.indexOf('--shots') + 1] : null
const HOST = process.env.KB_HOST || '127.0.0.1:3080'
const DSH_HOME = process.env.DSH_HOME || ''
if (HOST === '127.0.0.1:3080') { console.error('✗ this check writes a server entry and a connection into the DSH it talks to, and that is the real one (127.0.0.1:3080). Use the isolated instance (scripts/sandbox/).'); process.exit(2) }
if (!DSH_HOME.includes('.kybernos-sandbox')) { console.error('✗ DSH_HOME is not an isolated instance (' + (DSH_HOME || 'unset') + '). Run: source scripts/sandbox/env.sh'); process.exit(2) }
if (shotsDir !== null) mkdirSync(shotsDir, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const stop = (why) => { const e = new Error(why); e.readable = true; throw e }
let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail).slice(0, 300))) }
}

// ── the stand-in server ──────────────────────────────────────────────────────────────────────────────────────────────
const TOKEN = 'kyd-gate-stand-in-token'
const NEW_TOKEN = 'kyd-gate-claimed-token'
const calls = []
const st = { publicCatalogue: true, limit: 4, entitled: true, polls: 0, seq: 0, conns: [] }
const uuid = () => { st.seq += 1; return '00000000-0000-4000-8000-' + String(st.seq).padStart(12, '0') }
const APPS = [
  { slug: 'gmail', name: 'Gmail', categories: ['email'], description: 'Mail', needs_api_key: false, logo: '/v1/connections/logo?slug=gmail' },
  { slug: 'github', name: 'GitHub', categories: ['developer tools'], description: 'Code', needs_api_key: false },
]
// About 1,600 in real life: 150 here, the first ones with a logo (the second one has the flag but the stand-in answers 404 for it).
for (let i = 1; i <= 150; i += 1) {
  const slug = 'zeta-app-' + String(i).padStart(3, '0')
  APPS.push({ slug, name: 'Zeta App ' + String(i).padStart(3, '0'), categories: [i % 2 === 0 ? 'zeta tools' : 'zeta data'], description: 'The zeta app number ' + i + ', which does something useful.', needs_api_key: i === 5, ...(i <= 10 ? { logo: '/v1/connections/logo?slug=' + slug } : {}) })
}
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#2a7de1"/></svg>'
const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(body === null ? '' : JSON.stringify(body)) }
const stub = createServer((req, res) => {
  let raw = ''
  req.on('data', (c) => { raw += c })
  req.on('end', () => {
    let body = null
    try { body = raw === '' ? null : JSON.parse(raw) } catch (e) { body = '<<not json>>' }
    const url = new URL(req.url, 'http://x')
    calls.push({ method: req.method, path: url.pathname + url.search, auth: req.headers.authorization || null, body })
    if (url.pathname === '/v1/device/start') return json(res, 200, { device_id: 'dev1', device_secret: 'sec1', user_code: 'ABCD-1234', activation_url: 'https://auth.example.test/activate', expires_in: 600 })
    if (url.pathname === '/v1/device/poll') { st.polls += 1; return st.polls >= 2 ? json(res, 200, { status: 'claimed', token: NEW_TOKEN, user: { id: 'u1', name: 'Live Tester', plan: 'studio' } }) : json(res, 200, { status: 'pending' }) }
    // The two public routes: no token asked, none looked at.
    if (url.pathname === '/v1/connections/catalogue') return st.publicCatalogue ? json(res, 200, { configured: true, apps: APPS }) : json(res, 404, { error: 'not_found' })
    if (url.pathname === '/v1/connections/catalogue/logo') {
      const slug = url.searchParams.get('slug')
      const app = APPS.find((a) => a.slug === slug)
      if (!st.publicCatalogue || !app || !app.logo || slug === 'zeta-app-002') { res.writeHead(404); return res.end('') }
      res.writeHead(200, { 'content-type': 'image/svg+xml' })
      return res.end(SVG)
    }
    const auth = req.headers.authorization
    if (auth !== 'Bearer ' + TOKEN && auth !== 'Bearer ' + NEW_TOKEN) return json(res, 401, { error: 'unauthorized' })
    if (url.pathname === '/v1/connections' && req.method === 'GET') return json(res, 200, { configured: true, connections: st.conns, limit: st.limit, entitled: st.entitled, count: st.conns.length })
    if (url.pathname === '/v1/connections/apps') return json(res, 200, { configured: true, apps: APPS })
    if (url.pathname === '/v1/connections/link' && req.method === 'POST') {
      const b = body || {}
      const app = APPS.find((a) => a.slug === b.toolkit)
      if (!app) return json(res, 404, { error: 'not_found' })
      const c = { id: uuid(), toolkit: b.toolkit, status: 'pending', account_type: 'oauth', alias: typeof b.alias === 'string' ? b.alias : null, is_default: false, created_at: new Date().toISOString() }
      st.conns.push(c)
      return json(res, 201, { id: c.id, status: c.status, redirect_url: 'https://auth.example.test/go/' + c.id })
    }
    return json(res, 404, { error: 'not_found', message: 'No such route.' })
  })
})
await new Promise((resolve) => stub.listen(0, '127.0.0.1', resolve))
const ORIGIN = 'http://127.0.0.1:' + stub.address().port
const SERVERS = join(DSH_HOME, 'kybernos', 'servers.json')
const STATE = join(DSH_HOME, 'kybernos-cloud-live-gate.json')
const CHOICE = join(DSH_HOME, 'kybernos', 'connectors.json')
const keep = (file) => { if (existsSync(file)) { const bak = file + '.live-gate-bak'; renameSync(file, bak); return bak } return null }
const unkeep = (file, bak) => { rmSync(file, { force: true }); if (bak !== null) renameSync(bak, file) }
const registry = () => {
  mkdirSync(join(DSH_HOME, 'kybernos'), { recursive: true })
  writeFileSync(SERVERS, JSON.stringify({ active: 'live-gate', servers: [{ id: 'live-gate', name: 'Live gate stand-in', api: ORIGIN, services: { llm: false, connections: ORIGIN + '/v1/mcp/connections' } }] }))
}
const signedIn = () => writeFileSync(STATE, JSON.stringify({ token: TOKEN, user: { id: 'u1', name: 'Live Tester', plan: 'studio' }, workspaces: [] }))
const bakServers = keep(SERVERS)
const bakState = keep(STATE)
const bakChoice = keep(CHOICE)
registry()

let live = null
try {
  live = await openLivePage({ width: 1500, height: 1000 }).catch((e) => { console.error('○ inconclusive: ' + e.message); process.exit(3) })
  const { page } = live
  const ev = async (js) => { const r = await page.evalJs(js, 8000); return r.err ? { __err: r.err } : r.val }
  const shot = async (name) => { if (shotsDir !== null) await page.shot(join(shotsDir, name + '.png')).catch(() => {}) }
  const q = (sel) => JSON.stringify(sel)
  const exists = async (sel) => (await ev(`!!document.querySelector(${q(sel)})`)) === true
  const text = async (sel) => ev(`(() => { const e = document.querySelector(${q(sel)}); return e ? e.textContent : null })()`)
  const clickJs = async (sel) => ev(`(() => { const e = document.querySelector(${q(sel)}); if (!e) return false; e.click(); return true })()`)
  const typeInto = async (sel, value) => ev(`(() => { const e = document.querySelector(${q(sel)}); if (!e) return false; e.focus(); const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(e), 'value').set; set.call(e, ${JSON.stringify(value)}); e.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
  const cardOf = (name) => `Array.from(document.querySelectorAll('.kb7-card')).find((c) => c.textContent.indexOf(${JSON.stringify(name)}) >= 0)`
  const openPage = async () => {
    await waitFor(page, `document.readyState === 'complete'`, 15000)
    await sleep(2000)
    await ev(`(() => { const b = Array.from(document.querySelectorAll('button')).find((x) => /^Configure later$/i.test(x.textContent.trim())); if (b) b.click(); return !!b })()`)
    await sleep(400)
    await ev(`window.dispatchEvent(new CustomEvent('kb-open-resources', { detail: { tab: 'composio' } })); 1`)
    return (await waitFor(page, `!!document.querySelector('[data-kb="subtab-discover"]')`, 15000)) !== null
  }
  const discover = async () => { await clickJs('[data-kb="subtab-discover"]'); await sleep(500) }
  const count = () => ev(`(() => { const e = document.querySelector('[data-kb="subtab-discover"] .kb7-cxcount'); return e ? parseInt(e.textContent, 10) : 0 })()`)
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] })

  console.log('not signed in: the whole catalogue is there')
  if ((await openPage()) !== true) { console.error('○ inconclusive: the Connections page did not open (is this DSH serving the current client? restart the sandbox after a host edit)'); process.exit(3) }
  await discover()
  const full = await waitFor(page, `(() => { const e = document.querySelector('[data-kb="subtab-discover"] .kb7-cxcount'); return !!e && parseInt(e.textContent, 10) >= ${APPS.length} })()`, 25000)
  const n = await count()
  check('Discover holds the server\'s whole catalogue (' + APPS.length + ' apps, not the 100 of the local one), with nobody signed in', full !== null, n)
  check('...read from the public route, with no token', calls.some((c) => c.path === '/v1/connections/catalogue') && calls.filter((c) => c.path.startsWith('/v1/connections/catalogue')).every((c) => c.auth === null))
  check('...and the account route was not needed', !calls.some((c) => c.path === '/v1/connections/apps'))
  check('the button to load the catalogue by hand is not offered: it loaded by itself', !(await ev(`Array.from(document.querySelectorAll('button')).some((b) => /full catalog|catalogue complet/i.test(b.textContent))`)))
  const pill = String(await text('[data-kb="session"]'))
  check('the session pill says nobody is signed in', /Not signed in|Sans compte/.test(pill), pill)
  const cats = await ev(`document.documentElement.innerText.indexOf('zeta') >= 0`)
  check('the categories of the server are there to filter by', cats === true)
  await shot('01-anonymous')

  console.log('logos')
  await typeInto('input[placeholder]', 'zeta app 00')
  await sleep(1500)
  const logoImgs = await ev(`Array.from(document.querySelectorAll('.kb7-card .kb7-applogo img')).map((i) => ({ src: i.getAttribute('src'), ok: i.complete && i.naturalWidth > 0 }))`)
  check('the cards of apps with a logo ask this machine for it, same origin', Array.isArray(logoImgs) && logoImgs.length >= 5 && logoImgs.every((i) => i.src.indexOf('/kybernos-cloud/connections/logo?slug=') === 0), logoImgs)
  check('...and the pictures arrive', Array.isArray(logoImgs) && logoImgs.filter((i) => i.ok).length >= 5, logoImgs)
  check('the stand-in never saw the browser: only this machine asked it for logos, with no token', calls.filter((c) => c.path.startsWith('/v1/connections/catalogue/logo')).every((c) => c.auth === null))
  const tile = await ev(`(() => { const c = ${cardOf('Zeta App 002')}; return c ? { img: !!c.querySelector('img'), letter: (c.querySelector('.kb7-lr > div') || {}).textContent } : null })()`)
  check('an app whose logo does not come keeps a letter tile, not a broken picture', tile !== null && tile.img === false && /^Z/.test(String(tile.letter)), tile)
  const noLogo = await ev(`(() => { const c = ${cardOf('Zeta App 020')}; return c ? { img: !!c.querySelector('img') } : null })()`)
  check('an app with no logo flag never asks for one', noLogo !== null && noLogo.img === false && !calls.some((c) => c.path.indexOf('slug=zeta-app-020') >= 0), noLogo)
  await shot('02-logos')

  console.log('the gate')
  await ev(`(() => { const c = ${cardOf('Zeta App 005')}; if (c) c.click(); return !!c })()`)
  const gate = await waitFor(page, `!!document.querySelector('[data-kb="connect-gate"]')`, 8000)
  check('opening an app shows the gate, not « Add a connection »', gate !== null && !(await exists('[data-kb="add-connection"]')))
  check('the free account comes first and is the recommended way', (await exists('[data-kb="gate-account"]')) && /Recommended|Recommandé/.test(String(await text('[data-kb="gate-account"]'))))
  check('the own Composio key is the smaller second way, folded', (await exists('[data-kb="gate-key"].sm')) && !(await exists('[data-kb="gate-key"] input')))
  check('the gate names the app', /Zeta App 005/.test(String(await text('[data-kb="connect-gate"]'))))
  await shot('03-gate')
  await clickJs('[data-kb="gate-key-open"]')
  await sleep(300)
  const keyField = await ev(`(() => { const e = document.querySelector('[data-kb="gate-key"] input'); return !!e && e.type === 'password' && e.autocomplete === 'off' && /^ck_/.test(e.placeholder) })()`)
  check('the key goes in a password field the browser does not remember', keyField === true)
  check('...and Save waits for a key', (await ev(`document.querySelector('[data-kb="gate-key-save"]').disabled`)) === true)
  await shot('04-gate-key')

  console.log('the account path')
  await clickJs('[data-kb="gate-signin"]')
  const waiting = await waitFor(page, `/ABCD-1234/.test((document.querySelector('[data-kb="gate-wait"]') || { textContent: '' }).textContent)`, 10000)
  check('the pairing starts in the page and shows its code while the person approves in the other tab', waiting !== null)
  await shot('05-gate-wait')
  const addWin = await waitFor(page, `!!document.querySelector('[data-kb="kc-link"]')`, 30000)
  check('once approved the page carries on by itself: the add window opens', addWin !== null)
  check('...for that very app (no search, no list to pick from)', /Zeta App 005/.test(String(await text('.kb7-modal .kbcp-kcapp.on'))) && !(await exists('#kbcp-kc-q')))
  check('...and it asks for the API key of that app, as it needs one', (await exists('#kbcp-kc-key')))
  await shot('06-add-window')
  await typeInto('#kbcp-kc-key', 'sk-gate-test-key-0001')
  const before = calls.length
  await clickJs('[data-kb="kc-link"]')
  const row = await waitFor(page, `Array.from(document.querySelectorAll('[data-kb-conn]')).some((r) => /Zeta App 005/.test(r.textContent))`, 12000)
  check('connecting lands in Yours, where the new connection is listed', row !== null)
  const link = calls.slice(before).find((c) => c.method === 'POST' && c.path === '/v1/connections/link')
  check('the server got the toolkit with the account\'s new token', link !== undefined && link.body.toolkit === 'zeta-app-005' && link.auth === 'Bearer ' + NEW_TOKEN, link)
  await shot('07-yours')

  console.log('signed in')
  rmSync(STATE, { force: true })
  signedIn()
  st.conns = [{ id: uuid(), toolkit: 'gmail', status: 'active', account_type: 'oauth', alias: null, is_default: true, created_at: new Date().toISOString() }]
  await page.send('Page.reload', {})
  if ((await openPage()) !== true) { check('the page reopens', false); throw new Error('page did not reopen') }
  await discover()
  await waitFor(page, `(() => { const e = document.querySelector('[data-kb="subtab-discover"] .kb7-cxcount'); return !!e && parseInt(e.textContent, 10) >= ${APPS.length} })()`, 25000)
  const pill2 = await waitFor(page, `/Kybernos account|Compte Kybernos/.test((document.querySelector('[data-kb="session"]') || { textContent: '' }).textContent)`, 15000)
  check('the session pill says the Kybernos account is connected', pill2 !== null, await text('[data-kb="session"]'))
  const gmail = await ev(`(() => { const c = ${cardOf('Gmail')}; return c ? /Connected|Connecté/.test(c.textContent) : null })()`)
  check('the account\'s connected app shows as connected in Discover', gmail === true)
  await typeInto('input[placeholder]', 'zeta app 003')
  await sleep(800)
  await ev(`(() => { const c = ${cardOf('Zeta App 003')}; if (c) c.click(); return !!c })()`)
  const btn = await waitFor(page, `!!document.querySelector('[data-kb="add-connection"]')`, 8000)
  check('with an account there is no gate: « Add a connection » is there', btn !== null && !(await exists('[data-kb="connect-gate"]')))
  await shot('08-signed-in-modal')
  await clickJs('[data-kb="add-connection"]')
  const win2 = await waitFor(page, `!!document.querySelector('[data-kb="kc-link"]')`, 8000)
  check('...and it opens the add window for that app', win2 !== null && /Zeta App 003/.test(String(await text('.kb7-modal .kbcp-kcapp.on'))))
  await clickJs('.kb7-modal .kb7-mhead button')

  console.log('a plan without connections')
  st.entitled = false; st.limit = 0; st.conns = []
  await page.send('Page.reload', {})
  if ((await openPage()) !== true) { check('the page reopens', false); throw new Error('page did not reopen') }
  await discover()
  await waitFor(page, `(() => { const e = document.querySelector('[data-kb="subtab-discover"] .kb7-cxcount'); return !!e && parseInt(e.textContent, 10) >= ${APPS.length} })()`, 25000)
  await waitFor(page, `!!document.querySelector('[data-kb="session"]')`, 15000)
  await typeInto('input[placeholder]', 'zeta app 003')
  await sleep(800)
  await ev(`(() => { const c = ${cardOf('Zeta App 003')}; if (c) c.click(); return !!c })()`)
  const plan = await waitFor(page, `!!document.querySelector('[data-kb="gate-plan"]')`, 10000)
  check('the plan does not include connecting: the gate says so and leaves the own key', plan !== null && (await exists('[data-kb="gate-key"]')) && !(await exists('[data-kb="gate-signin"]')))
  await shot('09-plan')

  console.log('an older server (no public route)')
  st.entitled = true; st.limit = 4; st.publicCatalogue = false
  rmSync(STATE, { force: true })
  await page.send('Page.reload', {})
  if ((await openPage()) !== true) { check('the page reopens', false); throw new Error('page did not reopen') }
  await discover()
  const tried = await waitFor(page, `Array.from(document.querySelectorAll('button')).some((b) => /full catalog|catalogue complet/i.test(b.textContent))`, 20000)
  check('the local catalogue stays, and the button to try again appears', tried !== null)
  const local = await count()
  check('...with the local catalogue only (about a hundred apps)', local > 50 && local < APPS.length, local)
  check('the page said nothing alarming about it', !(await exists('.kbcp-err')))
  await shot('10-older-server')
} catch (e) {
  if (e && e.readable === true) { console.error('○ ' + e.message); fail += 1 } else throw e
} finally {
  if (live !== null) await live.close().catch(() => {})
  stub.close()
  unkeep(SERVERS, bakServers)
  unkeep(STATE, bakState)
  unkeep(CHOICE, bakChoice)
}
console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)

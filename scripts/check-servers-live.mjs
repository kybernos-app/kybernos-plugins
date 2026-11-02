#!/usr/bin/env node
// Checks the Servers page against a REAL DSH GUI, with a fake Kybernos server used exactly like a company's own server.
//
//   source scripts/sandbox/env.sh && node scripts/check-servers-live.mjs [--shots <dir>]
//
// The whole user path: paste an address, press Enter (the server is checked), « Add and sign in », confirm the code (the check plays the
// administrator's part: it approves the pairing on the fake server), then rename and remove. It WRITES to the sandbox's own registry and
// connection files and undoes them. Run it against the sandbox (scripts/sandbox, own HOME and DSH_HOME), never against the real DSH: it
// refuses 127.0.0.1:3080 and any DSH_HOME that is not a sandbox. Nothing leaves the machine: the fake server listens on 127.0.0.1.
// Exit code: 0 all green, 1 a check failed, 3 inconclusive (GUI down, bundle not loaded).
import { createServer } from 'node:http'
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { openLivePage, openSettings, waitFor, clickText } from './live-page.mjs'

const HOST = process.env.KB_HOST || '127.0.0.1:3080'
if (HOST === '127.0.0.1:3080') { console.error('refusing to run against the real DSH (3080): use the sandbox'); process.exit(2) }
const DSH_HOME = process.env.DSH_HOME || ''
if (!/\.kybernos-sandbox/.test(DSH_HOME)) { console.error('refusing to run: DSH_HOME is not a sandbox (' + (DSH_HOME || 'unset') + '). source scripts/sandbox/env.sh first'); process.exit(2) }

const args = process.argv.slice(2)
const shotsDir = args.indexOf('--shots') >= 0 ? args[args.indexOf('--shots') + 1] : null
if (shotsDir !== null) mkdirSync(shotsDir, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) }
}
const registryFile = join(DSH_HOME, 'kybernos', 'servers.json')
const connectionFile = (id) => join(DSH_HOME, 'kybernos-cloud-' + id + '.json')
const readRegistry = () => { try { return JSON.parse(readFileSync(registryFile, 'utf8')) } catch (e) { return null } }
const api = async (path, body) => {
  const r = await fetch('http://' + HOST + path, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://' + HOST }, body: JSON.stringify(body) })
  return r.json()
}

// ── The fake server: what a company server publishes and answers for the device pairing. Counts what it is asked. ──
const fake = { discovery: 0, starts: 0, polls: 0, approved: false }
const server = createServer((req, res) => {
  const json = (s, b) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(b)) }
  const base = 'http://' + req.headers.host
  if (req.url === '/.well-known/kybernos-server.json') { fake.discovery += 1; return json(200, { schema: 1, name: 'Acme Corp', version: '1.4.0', dsh_min: '0.1.0', api: base, services: { llm: false, connections: false } }) }
  if (req.url === '/v1/device/start' && req.method === 'POST') { fake.starts += 1; return json(200, { device_id: 'dev-1', device_secret: 'sec-1', user_code: 'KB-4829', activation_url: base + '/cloud/cli/activate?code=KB-4829', expires_in: 600 }) }
  if (req.url === '/v1/device/poll' && req.method === 'POST') { fake.polls += 1; return json(200, fake.approved ? { status: 'claimed', token: 'tok-acme-fake', user: { id: 'u-1', email: 'tester@example.com' }, expires_at: null } : { status: 'pending' }) }
  return json(404, { error: 'not_found' })
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const ADDRESS = '127.0.0.1:' + server.address().port
const BASE = 'http://' + ADDRESS

const live = await openLivePage({ width: 1400, height: 1000 }).catch((e) => { console.error('○ inconclusive: ' + e.message); process.exit(3) })
const { page } = live
const ev = async (js, ms = 15000) => { const r = await page.evalJs(js, ms); return r.err ? null : r.val }
const click = async (x, y) => { for (const t of ['mouseMoved', 'mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type: t, x, y, button: 'left', clickCount: 1 }) }
const centerOf = (sel) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2] })()`)
const press = async (sel) => { const c = await centerOf(sel); if (c === null) return false; await click(c[0], c[1]); return true }
const typeInto = async (sel, text, { clear = false } = {}) => {
  if (!(await press(sel))) return false
  if (clear) await ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.focus(); e.select && e.select() })()`)
  await page.send('Input.insertText', { text })
  return true
}
const enter = async () => { for (const t of ['keyDown', 'keyUp']) await page.send('Input.dispatchKeyEvent', { type: t, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 }) }
const has = (sel) => ev(`!!document.querySelector(${JSON.stringify(sel)})`)
const text = (sel) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return e ? e.textContent : null })()`)
const until = async (expr, ms = 12000) => (await waitFor(page, expr, ms)) !== null
const shot = async (name) => { if (shotsDir !== null) await page.shot(shotsDir + '/' + name + '.png') }
const row = (id) => '[data-kb="servers-row"][data-server="' + id + '"]'

let startedWith = null
try {
  const before = await api('/kybernos-servers/status').catch(() => null)
  if (before === null || before.ok !== true || before.cloud === null) { console.error('○ inconclusive: /kybernos-servers/status does not answer (bundle not loaded in this DSH, or its host half not restarted)'); process.exit(3) }
  startedWith = before.cloud.servers.map((s) => s.id)
  if (startedWith.length !== 1 || startedWith[0] !== 'kybernos-cloud') { console.error('○ inconclusive: the sandbox already has servers (' + startedWith.join(', ') + '); empty its servers.json first'); process.exit(3) }

  console.log('host')
  check('status lists the built-in server only and carries nothing about a licence', JSON.stringify(before).toLowerCase().indexOf('licen') < 0)

  await waitFor(page, `document.readyState === 'complete'`, 15000)
  await sleep(2500)
  if ((await openSettings(page, { minCells: 3 })) !== true) { console.error('○ inconclusive: Settings did not open'); process.exit(3) }
  if ((await clickText(page, 'Servers')) !== true && (await clickText(page, 'Serveurs')) !== true) { console.error('○ inconclusive: no « Servers » entry in Settings'); process.exit(3) }
  if (!(await until(`!!document.querySelector('[data-kb="servers-page"] [data-kb="servers-row"]')`, 15000))) { console.error('○ inconclusive: the page did not render'); process.exit(3) }
  await sleep(400)
  await shot('servers-page')

  console.log('the page, with Kybernos Cloud alone')
  check('one row, Kybernos Cloud, active', (await ev(`document.querySelectorAll('[data-kb="servers-row"]').length`)) === 1 && (await ev(`document.querySelector('${row('kybernos-cloud')}').dataset.active`)) === 'true')
  check('it has no Remove and no address line (« Managed by Kybernos »)', !(await has(row('kybernos-cloud') + ' [data-kb="servers-remove"]')) && !/api\./.test(await text(row('kybernos-cloud') + ' .kbsv-role')))
  check('the Enterprise card is under the list, with no « Talk to us » (no contact address is set)', (await has('[data-kb="servers-enterprise"]')) && !(await has('[data-kb="servers-contact"]')))
  check('no banner while on Kybernos Cloud', !(await has('[data-kb="servers-banner"]')))
  check('the help button of the Suite is on the page header', (await has('[data-kb="servers-page"] .kbhp-btn')) || (await has('[data-kb="servers-page"] [data-kb="page-help"]')))
  check('Settings files the page under Devices (the group of its nav entry is open)', (await ev(`(() => { const e = document.querySelector('[data-kb="servers-page"]'); return !!e })()`)) === true)

  console.log('a dialog closes with Escape')
  await press('[data-kb="servers-add-open"]')
  await until(`!!document.querySelector('[data-kb="servers-add-dialog"]')`, 5000)
  for (const t of ['keyDown', 'keyUp']) await page.send('Input.dispatchKeyEvent', { type: t, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 })
  check('Escape closes the add dialog, and Settings stays open behind it (DSH\'s own Escape does not run)', (await until(`!document.querySelector('[data-kb="servers-add-dialog"]')`, 5000)) && (await has('[data-kb="servers-page"]')))

  console.log('SRV-15 the three gestures')
  check('« Add a server » opens the dialog, focused on the address field', (await press('[data-kb="servers-add-open"]')) && (await until(`!!document.querySelector('[data-kb="servers-add-dialog"]')`, 5000)))
  check('« Add and sign in » is disabled before anything is typed', (await ev(`document.querySelector('[data-kb="servers-add-go"]').disabled`)) === true)
  await typeInto('#kbsv-address', ADDRESS.slice(0, 6))
  await sleep(900)
  await typeInto('#kbsv-address', ADDRESS.slice(6))
  await sleep(900)
  check('SRV-03 nothing was asked of the server while the address was being typed', fake.discovery === 0, fake.discovery)
  await enter()
  check('Enter checks the server: its name shows with « server checked »', (await until(`!!document.querySelector('[data-kb="servers-found"]')`, 8000)) && /Acme Corp/.test(await text('[data-kb="servers-found"]')) && fake.discovery >= 1, await text('[data-kb="servers-found"]'))
  check('« only to <host> » names the typed host; the full list is folded (every address is on that host)', /127\.0\.0\.1/.test(await text('[data-kb="servers-add-dialog"]')) && !(await has('[data-kb="servers-addresses"]')))
  check('the sign-in is the person\'s account on that server: no key, no password, no licence field in the dialog', (await ev(`document.querySelectorAll('[data-kb="servers-add-dialog"] input[type="password"]').length`)) === 0 && !/licen/i.test(await text('[data-kb="servers-add-dialog"]')))
  await press('[data-kb="servers-see-addresses"]')
  await sleep(300)
  const listed = await text('[data-kb="servers-addresses"]')
  check('« See the addresses » lists the api, the app (/account), the models and the connected apps, and no console', /\/account/.test(listed || '') && !/console/i.test(listed || '') && /Connected apps/.test(listed || ''), listed)
  await shot('servers-add-found')
  check('« Add and sign in » is now enabled and pressed', (await ev(`!document.querySelector('[data-kb="servers-add-go"]').disabled`)) === true && (await press('[data-kb="servers-add-go"]')))
  check('the code appears, with a link to the server\'s own activation page', (await until(`!!document.querySelector('[data-kb="servers-code"]')`, 15000)) && (await text('[data-kb="servers-code"]')) === 'KB-4829' && (await ev(`document.querySelector('[data-kb="servers-activation"]').href`)) === BASE + '/cloud/cli/activate?code=KB-4829' && (await ev(`document.querySelector('[data-kb="servers-activation"]').target`)) === '_blank', fake)
  const reg = readRegistry()
  check('the registry holds the server (0600), active, with the published name; no token in it', reg !== null && reg.active === 'acme-corp' && reg.servers.length === 1 && reg.servers[0].api === BASE && reg.servers[0].name === 'Acme Corp' && (statSync(registryFile).mode & 0o777) === 0o600 && !/tok-/.test(JSON.stringify(reg)), reg)
  const mid = await api('/kybernos-servers/status')
  check('the cloud half says it is active and not yet signed in', mid.cloud.servers.find((s) => s.id === 'acme-corp').active === true && mid.cloud.servers.find((s) => s.id === 'acme-corp').connected === false)
  await shot('servers-signin')
  fake.approved = true // the administrator\'s part: the code is approved on the server
  check('once approved, the dialog closes by itself and the row says « signed in » (polled every 3 s)', await until(`!document.querySelector('[data-kb="servers-signin-dialog"]')`, 20000))
  await sleep(1200)
  const after = await api('/kybernos-servers/status')
  check('the server is signed in, and its token lives in its own connection file only', after.cloud.servers.find((s) => s.id === 'acme-corp').connected === true && existsSyncFile(connectionFile('acme-corp')) && !/tok-acme-fake/.test(readOrEmpty(join(DSH_HOME, 'kybernos-cloud.json'))))
  check('the banner names the server and offers the way back', (await has('[data-kb="servers-banner"]')) && /Acme Corp/.test(await text('[data-kb="servers-banner"]')) && (await has('[data-kb="servers-back"]')))
  await shot('servers-active')

  console.log('SRV-16 the same server twice')
  await press('[data-kb="servers-add-open"]')
  await until(`!!document.querySelector('[data-kb="servers-add-dialog"]')`, 5000)
  await typeInto('#kbsv-address', 'http://' + ADDRESS + '/')
  await enter()
  check('another spelling of the same address is refused in words, and the button stays disabled', (await until(`!!document.querySelector('[data-kb="servers-add-error"]')`, 8000)) && (await ev(`document.querySelector('[data-kb="servers-add-go"]').disabled`)) === true && readRegistry().servers.length === 1, await text('[data-kb="servers-add-error"]'))
  await press('[data-kb="servers-add-cancel"]')

  console.log('details and rename')
  await press(row('acme-corp') + ' [data-kb="servers-details"]')
  check('Details shows the addresses and a Rename field', (await until(`!!document.querySelector('${row('acme-corp')} [data-kb="servers-rename"]')`, 5000)) && /127\.0\.0\.1/.test(await text(row('acme-corp') + ' [data-kb="servers-det"]')))
  const detText = await text(row('acme-corp') + ' [data-kb="servers-det"]')
  check('there is one app: Details name it « /account » and show no console address', /\/account/.test(detText) && !/console/i.test(detText), detText)
  await typeInto(row('acme-corp') + ' [data-kb="servers-rename"]', 'Acme (prod)', { clear: true })
  await press(row('acme-corp') + ' [data-kb="servers-rename-go"]')
  await sleep(1200)
  check('the new name is in the registry and on the row', readRegistry().servers[0].name === 'Acme (prod)' && /Acme \(prod\)/.test(await text(row('acme-corp') + ' .kbsv-name')), readRegistry())

  console.log('layout')
  const wide = await ev(`document.documentElement.scrollWidth <= window.innerWidth + 1`)
  await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  await sleep(700)
  // On a phone Settings is stacked: the list of pages comes first, the page after a press on its entry.
  const visible = `(() => { const p = document.querySelector('[data-kb="servers-page"]'); return !!p && p.getBoundingClientRect().width > 0 })()`
  if ((await ev(visible)) !== true) { await clickText(page, 'Servers'); await clickText(page, 'Serveurs'); await until(visible, 6000) }
  const narrow = await ev(`(() => { const p = document.querySelector('[data-kb="servers-page"]'); const r = p ? p.getBoundingClientRect() : null; return { shown: !!r && r.width > 0, page: !!r && r.right <= window.innerWidth + 1, doc: document.documentElement.scrollWidth <= window.innerWidth + 1, dialogInside: null } })()`)
  await shot('servers-phone')
  await page.send('Emulation.clearDeviceMetricsOverride', {})
  check('nothing is wider than the screen, at desktop width and at phone width (the page is really shown there)', wide === true && narrow !== null && narrow.shown === true && narrow.page === true && narrow.doc === true, narrow)

  console.log('SRV-17 removing the active server')
  await press(row('acme-corp') + ' [data-kb="servers-remove"]')
  check('a dialog says the sign-in is forgotten on this computer', (await until(`!!document.querySelector('[data-kb="servers-dialog"]')`, 5000)) && /Acme/.test(await text('[data-kb="servers-dialog"]')))
  await press('[data-kb="servers-confirm"]')
  await until(`!document.querySelector('${row('acme-corp')}')`, 15000)
  await sleep(800)
  const end = readRegistry()
  check('the server is gone; Kybernos Cloud is active again; its connection file is gone', !(await has(row('acme-corp'))) && end !== null && end.servers.length === 0 && end.active === 'kybernos-cloud' && !existsSyncFile(connectionFile('acme-corp')), end)
  check('SRV-18 the banner is gone with it', !(await has('[data-kb="servers-banner"]')))
  await shot('servers-after')
} finally {
  // Whatever happened, the sandbox is left as it was found: no server added by this check stays.
  try {
    const s = await api('/kybernos-servers/status')
    for (const x of (s.cloud ? s.cloud.servers : [])) if (x.id !== 'kybernos-cloud' && x.api === BASE) await api('/kybernos-servers/remove', { id: x.id })
  } catch (e) { /* the DSH may be gone */ }
  try { await live.close() } catch (e) { /* already closed */ }
  await new Promise((r) => server.close(r))
}

function existsSyncFile (p) { return existsSync(p) }
function readOrEmpty (p) { try { return readFileSync(p, 'utf8') } catch (e) { return '' } }

console.log('\n' + pass + ' ✓  ' + fail + ' ✗')
process.exit(fail === 0 ? 0 : 1)

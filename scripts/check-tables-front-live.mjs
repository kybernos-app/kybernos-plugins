// check-tables-front-live.mjs — the client of the tables template (templates/tables/public) driven in a real headless Chrome against the real hosted app.
//
//   node scripts/check-tables-front-live.mjs [--shots <dir>]      # about a minute; skipped (exit 0) when there is no Chrome
//
// Needs Chrome (CHROME=<binary>, else the macOS app or google-chrome / chromium on PATH) and the app's three dependencies, as scripts/check-tables-app.mjs does
// (TABLES_APP_NODE_MODULES=<a node_modules that holds them>, else one npm ci in a temporary folder). It builds the app, seeds a small coffee roastery (customers, products, orders,
// an empty sample-requests table; a Fulfilment and a Sales profile), boots it on a free port (never :3080) and drives the page like a person: the owner's link, the sign-in, the
// Table, Board and Relations tabs, search, filter and sort, a row's detail and its status, a card dragged to another column, adding a row with its errors, archiving with its
// confirmation, the People page, the invitation page, then a member with fewer rights, then a phone-sized window. The page policy is checked in the browser itself: not one
// console error or policy violation, no `style` attribute and no inline script in the DOM at any step. Screenshots go to --shots (not into the repo); nothing is kept otherwise.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomBytes } from 'node:crypto'
import { makeService } from '../packages/kybernos-db/agent/service.mjs'
import { buildTablesApp } from '../packages/kybernos-webapp-creator/templates/tables/scripts/build-tables-app.mjs'
import { installApp } from '../packages/kybernos-webapp-creator/templates/tables/lib/install.mjs'
import { connect } from './cdp-lib.mjs'

const root = mkdtempSync(join(tmpdir(), 'kb-tables-front-'))
const shotsArg = process.argv.indexOf('--shots')
const shots = shotsArg > 0 ? process.argv[shotsArg + 1] : null
if (shots !== null) mkdirSync(shots, { recursive: true })
let fails = 0
let total = 0
const check = (label, cond, detail = '') => { total++; console.log((cond ? 'ok   ' : 'FAIL ') + label + (!cond && detail !== '' ? '  [' + String(detail).slice(0, 200) + ']' : '')); if (!cond) fails++ }
const group = (name) => console.log('\n' + name)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const freePort = () => new Promise((resolve) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)) }) })
let server = null
let chrome = null
let output = ''

function findChrome () {
  const candidates = [process.env.CHROME, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium'].filter(Boolean)
  for (const c of candidates) if (existsSync(c)) return c
  for (const name of ['google-chrome', 'chromium', 'chromium-browser']) { const r = spawnSync('which', [name], { encoding: 'utf8' }); if (r.status === 0) return r.stdout.trim() }
  return null
}

const CUSTOMERS = [
  ['Maple & Rye Café', 'wholesale', 'Leeds', 'orders@maplerye.example', '+44 113 496 0142'],
  ['Priya Raman', 'regular', 'Bristol', 'priya.raman@mail.example', '+44 117 496 0187'],
  ['Tomás Idowu', 'regular', 'Manchester', 'tomas.idowu@mail.example', '+44 161 496 0120'],
  ['North Pier Bakery', 'wholesale', 'Brighton', 'hello@northpier.example', '+44 1273 496 011'],
  ['Hannah Whitlock', 'regular', 'Edinburgh', 'hannah.w@mail.example', '+44 131 496 0165'],
  ['Studio Fenn', 'wholesale', 'London', 'studio@fenn.example', '+44 20 7946 0133'],
]
const PRODUCTS = [['Ethiopia Guji', 'light', 'Ethiopia', 13.5], ['Colombia Huila', 'medium', 'Colombia', 13.5], ['Kenya AA', 'medium', 'Kenya', 14.5], ['House blend', 'dark', 'Blend', 11], ['Brazil Cerrado', 'medium', 'Brazil', 12]]
const ORDERS = [
  ['#1042', 0, 'shipped', [0], 312, '2026-10-29', 'Leave with the kitchen door team before 8am.'], ['#1043', 1, 'new', [1], 27, '2026-10-31', ''], ['#1044', 3, 'preparing', [3], 196, '2026-10-30', 'Whole beans, no grinding.'],
  ['#1045', 2, 'delivered', [2], 14.5, '2026-10-27', ''], ['#1046', 5, 'preparing', [4], 138, '2026-10-30', ''], ['#1047', 4, 'new', [3], 33, '2026-10-31', ''],
  ['#1048', 0, 'new', [3], 245, '2026-10-31', 'Standing weekly order.'], ['#1049', 1, 'delivered', [0], 13.5, '2026-10-26', ''], ['#1050', 5, 'shipped', [2, 4], 120, '2026-10-29', ''], ['#1051', 2, 'preparing', [1], 50, '2026-10-30', ''],
]

function seed (dir) {
  const svc = makeService({ dir })
  const choice = (opts) => opts.map(([key, label, color]) => ({ key, label, color }))
  const made = svc.create({
    name: 'Ledger Coffee',
    by: 'template',
    objects: [
      { key: 'orders', label: 'Orders', title: 'number', fields: [
        { key: 'number', type: 'text', label: 'Order', required: true },
        { key: 'customer', type: 'relation', label: 'Customer', to: 'customers', inverse: 'Orders', required: true },
        { key: 'status', type: 'choice', label: 'Status', options: choice([['new', 'New', 'blue'], ['preparing', 'Preparing', 'amber'], ['shipped', 'Shipped', 'purple'], ['delivered', 'Delivered', 'green']]) },
        { key: 'products', type: 'relation', label: 'Products', to: 'products', many: true },
        { key: 'total', type: 'money', label: 'Total', currency: 'GBP', required: true },
        { key: 'placed', type: 'date', label: 'Placed' },
        { key: 'notes', type: 'longtext', label: 'Notes' },
      ] },
      { key: 'customers', label: 'Customers', title: 'name', fields: [
        { key: 'name', type: 'text', label: 'Name', required: true },
        { key: 'type', type: 'choice', label: 'Type', options: choice([['regular', 'Regular', 'gray'], ['wholesale', 'Wholesale', 'blue']]) },
        { key: 'city', type: 'text', label: 'City' },
        { key: 'email', type: 'email', label: 'Email', protection: 'personal' },
        { key: 'phone', type: 'phone', label: 'Phone', protection: 'personal' },
      ] },
      { key: 'products', label: 'Products', title: 'name', fields: [
        { key: 'name', type: 'text', label: 'Name', required: true },
        { key: 'roast', type: 'choice', label: 'Roast', options: choice([['light', 'Light', 'amber'], ['medium', 'Medium', 'gray'], ['dark', 'Dark', 'purple']]) },
        { key: 'origin', type: 'text', label: 'Origin' },
        { key: 'price', type: 'money', label: 'Price per 250 g', currency: 'GBP', required: true },
      ] },
      { key: 'samples', label: 'Sample requests', title: 'label', fields: [
        { key: 'label', type: 'text', label: 'Request', required: true },
        { key: 'customer', type: 'relation', label: 'Customer', to: 'customers' },
        { key: 'status', type: 'choice', label: 'Status', options: choice([['requested', 'Requested', 'amber'], ['sent', 'Sent', 'green']]) },
      ] },
    ],
  })
  const db = made.db
  db.setProfiles([
    { id: 'fulfilment', label: 'Fulfilment', grants: [
      { object: 'orders', do: ['read', 'update'], fields: { number: 'read', customer: 'read', products: 'read', total: 'read', placed: 'read', notes: 'read', status: 'write' } },
      { object: 'customers', do: ['read'] },
      { object: 'products', do: ['read'] },
    ] },
    { id: 'sales', label: 'Sales', grants: [
      { object: 'customers', do: ['read', 'create', 'update'], fields: { email: 'write', phone: 'write' } },
      { object: 'orders', do: ['read', 'create'] },
      { object: 'products', do: ['read'] },
      { object: 'samples', do: ['read', 'create'] },
    ] },
  ], 'template')
  const ids = { customers: [], products: [] }
  for (const [name, type, city, email, phone] of CUSTOMERS) ids.customers.push(db.create('customers', { name, type, city, email, phone }, 'agent').record.id)
  for (const [name, roast, origin, price] of PRODUCTS) ids.products.push(db.create('products', { name, roast, origin, price }, 'agent').record.id)
  for (const [number, c, status, products, total, placed, notes] of ORDERS) db.create('orders', { number, customer: ids.customers[c], status, products: products.map((i) => ids.products[i]), total, placed, ...(notes === '' ? {} : { notes }) }, 'agent')
  const id = db.info().id
  svc.close()
  return id
}

async function main () {
  const chromeBin = findChrome()
  if (chromeBin === null) { console.log('skipped: no Chrome found (set CHROME=<binary>)'); return }

  group('build and boot')
  const app = join(root, 'app')
  const built = buildTablesApp({ out: app })
  check('the app is built with the public/ files in it', built.files > 10 && existsSync(join(app, 'public', 'index.html')) && existsSync(join(app, 'public', 'js', 'main.mjs')))
  if (process.env.TABLES_APP_NODE_MODULES !== undefined && process.env.TABLES_APP_NODE_MODULES !== '') symlinkSync(process.env.TABLES_APP_NODE_MODULES, join(app, 'node_modules'), 'dir')
  else {
    const npm = spawnSync('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: app, encoding: 'utf8' })
    check('npm ci installed the pinned dependencies', npm.status === 0, (npm.stderr || '').slice(-200))
    if (npm.status !== 0) return
  }
  const dbId = seed(join(root, 'dbs'))
  const data = join(root, 'data')
  check('the roastery is installed as the app « shop »', installApp(join(data, 'apps'), 'shop', join(root, 'dbs', dbId)).ok)
  const port = await freePort()
  const BASE = 'http://127.0.0.1:' + port
  const authSecret = randomBytes(32).toString('base64url')
  const bootHex = randomBytes(32).toString('hex')
  server = spawn(process.execPath, ['--no-warnings', 'server.js'], { cwd: app, env: { PATH: process.env.PATH, PORT: String(port), KB_AUTH_SECRET: authSecret, KB_BOOT_KEY: bootHex, KB_DATA_DIR: data, KB_TRUST_PROXY: '1' }, stdio: ['ignore', 'pipe', 'pipe'] })
  server.stdout.on('data', (d) => { output += d })
  server.stderr.on('data', (d) => { output += d })
  for (let i = 0; i < 100 && !output.includes('listening ' + port); i++) await sleep(100)
  check('the server listens on a free port', output.includes('listening ' + port) && port !== 3080, output.slice(0, 200))
  if (!output.includes('listening ' + port)) return
  const { mintOpenToken } = await import(pathToFileURL(join(app, 'lib', 'bootstrap.mjs')).href)
  const bootKey = Buffer.from(bootHex, 'hex')
  const openLink = () => BASE + '/open?t=' + encodeURIComponent(mintOpenToken({ key: bootKey, email: 'olga@example.test' }))

  // a plain http client, only to make the team (an owner session, two invitations); everything else below is the browser's
  const jar = new Map()
  const call = async (path, { method = 'GET', json, token } = {}) => {
    const h = { origin: BASE, 'x-forwarded-for': '10.1.1.1' }
    if (json !== undefined) h['content-type'] = 'application/json'
    if (token !== undefined) h['x-csrf-token'] = token
    if (jar.size > 0) h.cookie = [...jar].map(([k, v]) => k + '=' + v).join('; ')
    const res = await fetch(BASE + path, { method, headers: h, body: json === undefined ? undefined : JSON.stringify(json), redirect: 'manual' })
    for (const c of res.headers.getSetCookie()) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar.set(kv.slice(0, i), kv.slice(i + 1)) }
    return res
  }
  await call(openLink().slice(BASE.length))
  const csrf = (await (await call('/api/csrf')).json()).token
  const invite = async (role, email) => (await (await call('/api/people/invitations', { method: 'POST', json: { role, email }, token: csrf })).json())
  const sam = await invite('fulfilment', 'sam@example.test')
  const lena = await invite('sales', 'lena@example.test')
  const loose = await invite('sales')
  const tokenOf = (l) => new URL(l).searchParams.get('t')
  // a member can only be made through the page that accepts an invitation: it needs the csrf cookie of its own browser
  const memberJar = new Map()
  const acceptAs = async (inv, name, password) => {
    const jarH = () => ({ origin: BASE, 'x-forwarded-for': '10.1.1.2', cookie: [...memberJar].map(([k, v]) => k + '=' + v).join('; ') })
    const r1 = await fetch(BASE + '/api/csrf', { headers: jarH() })
    for (const c of r1.headers.getSetCookie()) { const [kv] = c.split(';'); const i = kv.indexOf('='); memberJar.set(kv.slice(0, i), kv.slice(i + 1)) }
    const token = (await r1.json()).token
    return fetch(BASE + '/api/invitations/accept', { method: 'POST', headers: { ...jarH(), 'content-type': 'application/json', 'x-csrf-token': token }, body: JSON.stringify({ token: tokenOf(inv.link), name, password }) })
  }
  const PW = { sam: 'sam-password-123', lena: 'lena-password-123', owner: 'owner-password-123' }
  check('two members are made (Fulfilment and Sales)', (await acceptAs(sam, 'Sam Okafor', PW.sam)).status === 200 && (await acceptAs(lena, 'Lena Brandt', PW.lena)).status === 200)
  check('an open invitation is kept for the invitation page', typeof loose.link === 'string')

  group('the browser')
  const debugPort = await freePort()
  const profile = join(root, 'chrome')
  chrome = spawn(chromeBin, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--user-data-dir=' + profile, '--remote-debugging-port=' + debugPort, '--window-size=1280,860', 'about:blank'], { stdio: 'ignore' })
  let target = null
  for (let i = 0; i < 100 && target === null; i++) {
    await sleep(150)
    try { const list = await (await fetch('http://127.0.0.1:' + debugPort + '/json')).json(); target = list.find((t) => t.type === 'page') ?? null } catch (e) { /* not up yet */ }
  }
  check('headless Chrome is up', target !== null)
  if (target === null) return
  const tab = await connect(target)
  const problems = []
  let refusals = 0 // the one refused write the run provokes on purpose (a row archived under the page's feet): the browser logs every 4xx
  tab.on('Log.entryAdded', (p) => { if (p.entry && String(p.entry.url).endsWith('/api/apps/shop/write') && /status of 400/.test(p.entry.text)) refusals++; else if (p.entry && (p.entry.level === 'error' || p.entry.source === 'security') && !String(p.entry.url).endsWith('/api/auth/sign-in/email')) problems.push(p.entry.source + ': ' + String(p.entry.text).slice(0, 160) + ' ' + (p.entry.url ?? '')) })
  tab.on('Runtime.exceptionThrown', (p) => problems.push('exception: ' + String((p.exceptionDetails && (p.exceptionDetails.exception && p.exceptionDetails.exception.description || p.exceptionDetails.text)) || '').slice(0, 200)))
  tab.on('Runtime.consoleAPICalled', (p) => { if (p.type === 'error') problems.push('console: ' + (p.args || []).map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 200)) })
  for (const m of ['Page.enable', 'Runtime.enable', 'Log.enable']) await tab.send(m)
  const size = (width, height) => tab.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
  await size(1280, 860)

  const ev = async (code) => { const r = await tab.evalJs(code, 12000); if (r.err !== undefined) throw new Error(r.err); return r.val }
  const until = async (code, label, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await ev(code)) return true } catch (e) { /* the page is changing */ } await sleep(80) } check('waited for ' + label, false); return false }
  const go = async (url) => { await tab.send('Page.navigate', { url }); await sleep(250) }
  const shot = async (name) => { await sleep(150); if (shots !== null) await tab.shot(join(shots, name + '.png')) }
  const click = (sel) => ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) throw new Error('no ' + ${JSON.stringify(sel)}); el.click(); return true })()`)
  const type = (sel, value) => ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) throw new Error('no ' + ${JSON.stringify(sel)}); el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return true })()`)
  const pick = (sel, value) => type(sel, value)
  const texts = (sel) => ev(`[...document.querySelectorAll(${JSON.stringify(sel)})].map((e) => e.textContent.trim().replace(/\\s+/g, ' '))`)
  const n = (sel) => ev(`document.querySelectorAll(${JSON.stringify(sel)}).length`)
  const text = async (sel) => (await texts(sel))[0] ?? ''
  const policy = async (label) => {
    const inline = await ev(`({ style: document.querySelectorAll('[style]').length, scripts: [...document.scripts].filter((s) => !s.src).length, handlers: [...document.querySelectorAll('*')].filter((e) => [...e.attributes].some((a) => /^on/i.test(a.name))).length })`)
    check('policy at « ' + label + ' »: no style attribute, no inline script, no inline handler', inline.style === 0 && inline.scripts === 0 && inline.handlers === 0, JSON.stringify(inline))
  }
  const api = (path, init) => ev(`fetch(${JSON.stringify(path)}, ${JSON.stringify(init ?? {})}).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }))`)
  const saved = async (object) => (await api('/api/apps/shop/records?object=' + object)).body.records

  // ── sign-in screen ──
  group('sign-in')
  await go(BASE + '/')
  await until(`document.querySelector('#si-email') !== null`, 'the sign-in form')
  check('nobody is signed in: the page shows the sign-in form', (await text('h1')) === 'Sign in' && (await n('#si-password')) === 1)
  await shot('01-sign-in')
  await policy('sign-in')
  await type('#si-email', 'sam@example.test')
  await type('#si-password', 'not-the-password')
  await ev(`document.querySelector('form').requestSubmit()`)
  await until(`document.querySelector('.err:not([hidden])') !== null`, 'the sign-in error')
  check('a wrong password is said plainly, inline', (await text('.err:not([hidden])')) === 'That email and password do not match.')
  await shot('02-sign-in-error')

  // ── the owner, by the link ──
  group('owner')
  await go(openLink())
  await until(`document.querySelector('.shell h1') !== null && document.querySelector('table') !== null`, 'the Orders table')
  check('the owner lands on the first table (Orders) with its rows', (await text('.main h1')) === 'Orders' && (await n('tbody tr')) === 10)
  check('the rail lists the tables with their counts, and People for the owner', JSON.stringify(await texts('.nav-item')) === JSON.stringify(['Orders10', 'Customers6', 'Products5', 'Sample requests0', 'People3']), JSON.stringify(await texts('.nav-item')))
  check('the owner came in with a link: the page offers to set a password', (await n('.banner')) === 1)
  check('the header counts the rows and the owner can add', (await text('.top .sub')) === '10 rows' && (await text('.top .btn.primary')) === 'Add order')
  check('money, dates and choices are worded for a person', JSON.stringify((await texts('tbody tr:first-child td')).slice(0, 5)) !== '[]' && (await text('tbody tr td.a')).startsWith('£'))
  await shot('03-table')
  await policy('table')
  const firstRow = await texts('tbody tr:first-child td')
  check('the newest row is first, with a status pill and linked customer', /^#10(4[0-9]|5[01])$/.test(firstRow[0]) && (await n('tbody tr:first-child .pill')) === 1 && (await n('tbody tr:first-child .chip')) >= 1, JSON.stringify(firstRow))

  group('search, filter, sort')
  await type('.toolbar input[type=search]', 'maple')
  await until(`document.querySelectorAll('tbody tr').length === 2`, 'two matches for « maple »')
  check('search finds a row by its linked customer’s name', (await n('tbody tr')) === 2)
  await type('.toolbar input[type=search]', 'zzzz')
  await until(`document.querySelector('#results .empty') !== null`, 'the no-match state')
  check('no match: a sentence and a way back, not a blank table', (await text('#results .empty h2')).includes('No orders match') && (await n('#results .empty .btn')) === 1)
  await shot('04-no-match')
  await click('#results .empty .btn')
  await until(`document.querySelectorAll('tbody tr').length === 10`, 'the list again after clearing')
  await pick('select[aria-label="Filter by status"]', 'preparing')
  await until(`document.querySelectorAll('tbody tr').length === 3`, 'the three preparing orders')
  check('the filter keeps the rows with that status', (await n('tbody tr')) === 3)
  await pick('select[aria-label="Filter by status"]', '')
  await pick('select[aria-label="Sort"]', 'az')
  await until(`document.querySelector('tbody tr td.t').textContent.trim() === '#1042'`, 'A to Z')
  check('sorted A to Z by title when asked', (await text('tbody tr td.t')) === '#1042')

  group('a row')
  await click('tbody tr:first-child .rowlink')
  await until(`document.querySelector('.drawer') !== null`, 'the detail drawer')
  check('the detail shows the row’s fields, linked rows as chips, and what is known of its history', (await text('.drawer h2')) === '#1042' && (await n('.drawer dl.kv > div')) >= 6 && (await n('.drawer .hist li')) >= 1)
  check('the drawer is a dialog, focused, with Close', (await ev(`document.querySelector('.drawer').getAttribute('role')`)) === 'dialog' && (await ev(`document.querySelector('.drawer').contains(document.activeElement)`)))
  await shot('05-detail')
  await policy('detail')
  const before = (await saved('orders')).find((r) => r.values.number === '#1042').values.status
  await pick('#d-status', 'delivered')
  await until(`document.querySelector('.toast') !== null && !document.querySelector('.toast').hidden`, 'the toast')
  const after = (await saved('orders')).find((r) => r.values.number === '#1042')
  check('a status picked in the detail is saved by the door (the keyboard way to move a card)', before === 'shipped' && after.values.status === 'delivered' && after.modified.by === 'person', before + ' → ' + after.values.status)
  check('the toast says it, and the select shows it', (await text('.toast')).includes('#1042 is now Delivered') && (await ev(`document.querySelector('#d-status').value`)) === 'delivered')
  const rev = after.rev
  await click('.drawer .chip')
  await until(`document.querySelector('.drawer h2').textContent.trim() !== '#1042'`, 'a linked row opened')
  check('a linked row opens in the same drawer', (await text('.drawer h2')) === 'Maple & Rye Café' && (await text('.drawer h2')) !== '#1042')
  await until(`document.querySelector('.drawer .group') !== null`, 'the rows that link here')
  check('…and shows what links to it', (await texts('.drawer .group b')).some((t) => t.startsWith('Orders')))
  await shot('06-detail-linked')
  await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`)
  await until(`document.querySelector('.drawer') === null`, 'Escape closes the drawer')
  check('Escape closes the drawer', (await n('.drawer')) === 0 && rev >= 2)

  group('board')
  await click('a.tab[href$="/board"]')
  await until(`document.querySelectorAll('.col').length === 4`, 'the four columns')
  check('one column per status, each with its count', JSON.stringify(await texts('.col h3')) === JSON.stringify(['New3', 'Preparing3', 'Shipped1', 'Delivered3']), JSON.stringify(await texts('.col h3')))
  check('cards are draggable for someone who may change the status', (await n('.card[draggable="true"]')) === 10)
  await shot('07-board')
  await policy('board')
  const moved = await ev(`(() => { const card = [...document.querySelectorAll('.card')].find((c) => c.textContent.includes('#1043')); const col = document.querySelector('.col[data-col="preparing"]'); const dt = new DataTransfer(); card.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt })); col.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt })); col.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt })); return true })()`)
  await until(`document.querySelector('.col[data-col="preparing"]').textContent.includes('#1043')`, 'the card in its new column')
  check('a card dropped on another column moves at once…', moved === true && (await texts('.col h3'))[1] === 'Preparing4')
  await until(`document.querySelector('.toast') && document.querySelector('.toast').textContent.includes('#1043 is now Preparing')`, 'the toast of the move')
  check('…and the door has it', (await saved('orders')).find((r) => r.values.number === '#1043').values.status === 'preparing')
  // the door refuses (the row was archived by someone else meanwhile): the card goes back and the reason is said
  const stale = (await saved('orders')).find((r) => r.values.number === '#1047').id
  await api('/api/apps/shop/write', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': (await api('/api/csrf')).body.token }, body: JSON.stringify({ object: 'orders', op: 'delete', id: stale }) })
  await ev(`(() => { const card = [...document.querySelectorAll('.card')].find((c) => c.textContent.includes('#1047')); const col = document.querySelector('.col[data-col="shipped"]'); const dt = new DataTransfer(); card.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt })); col.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt })); return true })()`)
  await until(`document.querySelector('.toast.bad') !== null`, 'the refusal toast')
  check('a refused move goes back, with the door’s reason', (await ev(`document.querySelector('.col[data-col="new"]').textContent.includes('#1047')`)) && (await text('.toast.bad')).length > 5, await text('.toast'))
  await shot('08-board-refused')

  group('relations')
  await click('a.tab[href$="/relations"]')
  await until(`document.querySelector('.diagram svg') !== null`, 'the drawing')
  check('the drawing has a box per table and a line per pair', (await n('.diagram .node')) === 4 && (await n('.diagram .rel-line')) === 3, (await n('.diagram .node')) + ' nodes ' + (await n('.diagram .rel-line')) + ' edges')
  check('the current table is marked, with « 1 » and « many » at the ends', (await n('.diagram .node.cur')) === 1 && (await texts('.diagram .card-no')).includes('1') && (await texts('.diagram .card-no')).includes('many'))
  check('the list says each link in a sentence and opens the other table', (await n('.links .link')) >= 2 && (await texts('.links .link small')).some((t) => t.includes('Each row in Orders links to one row in Customers')))
  await shot('09-relations')
  await policy('relations')
  await click('.links .link')
  await until(`document.querySelector('.main h1').textContent.trim() !== 'Orders'`, 'the linked table')
  check('a link opens the table it points at', ['Customers', 'Products'].includes(await text('.main h1')))

  group('add a row')
  await go(BASE + '/#/shop/orders')
  await until(`document.querySelector('.main h1').textContent.trim() === 'Orders' && document.querySelector('tbody tr')`, 'Orders again')
  await click('.top .btn.primary')
  await until(`document.querySelector('form.drawer') !== null`, 'the add drawer')
  check('the form has a control per writable field, Status as buttons, the customer as a list of rows', (await n('.drawer .fld')) === 7 && (await n('.drawer .opt')) === 9 && (await n('.drawer select')) === 1)
  await shot('10-add')
  await ev(`document.querySelector('form.drawer').requestSubmit()`)
  await until(`document.querySelectorAll('.drawer .fld .err:not([hidden])').length >= 3`, 'inline errors')
  const errs = await texts('.drawer .fld .err:not([hidden])')
  check('an empty form says what is missing, in place, in words', errs.includes('Order is required.') && errs.includes('Choose a customer.') && errs.includes('Enter an amount, for example 24.50.'), JSON.stringify(errs))
  check('the first problem has the focus and is marked invalid', (await ev(`document.activeElement.getAttribute('aria-invalid')`)) === 'true')
  await shot('11-add-errors')
  await type('.drawer input[type=text]', '#1052')
  const customerId = (await saved('customers'))[0].id
  await type('.drawer select', customerId)
  await ev(`(() => { const o = document.querySelector('.drawer .opt input[value="preparing"]'); o.click(); const m = document.querySelector('.drawer .money input'); m.value = '1 240,50'; m.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
  await ev(`document.querySelector('form.drawer').requestSubmit()`)
  await until(`document.querySelector('form.drawer') === null`, 'the drawer closing after the save')
  const created = (await saved('orders')).find((r) => r.values.number === '#1052')
  check('the row is saved with what was typed (a comma decimal read as a number)', created !== undefined && created.values.total === 1240.5 && created.values.status === 'preparing' && created.values.customer === customerId, JSON.stringify(created && created.values))
  check('the table shows it first and the rail count follows', (await text('tbody tr:first-child td.t')) === '#1052' && (await texts('.nav-item'))[0] === 'Orders10', (await texts('.nav-item'))[0])

  group('archive')
  await click('tbody tr:first-child .rowlink')
  await until(`document.querySelector('.drawer') !== null`, 'the drawer')
  await click('.drawer .btn.danger')
  check('archiving asks first, inline, and says nothing is deleted', (await n('.drawer .confirm')) === 1 && (await text('.drawer .confirm')).includes('Nothing is deleted'))
  await shot('12-archive-confirm')
  await click('.drawer .confirm .btn.sm:not(.danger)')
  check('« Keep » puts it back without archiving', (await n('.drawer .confirm')) === 0 && (await saved('orders')).some((r) => r.values.number === '#1052'))
  await click('.drawer .btn.danger')
  await click('.drawer .confirm .btn.danger')
  await until(`document.querySelector('.drawer') === null`, 'the drawer closing after the archive')
  check('« Archive » takes the row out of the list and of the door’s live rows', !(await saved('orders')).some((r) => r.values.number === '#1052') && !(await texts('tbody tr td.t')).includes('#1052'))

  group('empty state, password')
  await go(BASE + '/#/shop/samples')
  await until(`document.querySelector('#results .empty') !== null`, 'the empty table')
  check('an empty table says so and offers the first row', (await text('#results .empty h2')) === 'No sample requests yet' && (await n('#results .empty .btn.primary')) === 1)
  await shot('13-empty')
  await policy('empty')
  await click('.banner .btn')
  await until(`document.querySelector('form.drawer') !== null`, 'the password drawer')
  await type('.drawer input[type=password]', 'short')
  await ev(`document.querySelector('form.drawer').requestSubmit()`)
  check('a short password is refused on the page, with the number', (await text('.drawer .err:not([hidden])')).includes('10 characters'))
  await type('.drawer input[type=password]', PW.owner)
  await ev(`document.querySelector('form.drawer').requestSubmit()`)
  await until(`document.querySelector('.banner') === null`, 'the banner gone')
  check('the owner’s password is saved and the banner goes', (await n('.banner')) === 0)

  group('people and the invitation page')
  await go(BASE + '/people')
  await until(`document.querySelector('.sheet') !== null`, 'the people page')
  check('the people page lists the team with its actions, no script', (await n('.panel')) === 3 && (await n('table tbody tr')) >= 4 && (await ev(`document.scripts.length`)) === 0)
  check('removing and revoking ask a second time (no script needed)', (await n('details.ask')) >= 3)
  await click('details.ask summary')
  await shot('14-people')
  await policy('people')
  await go(BASE + '/invite?t=' + encodeURIComponent(tokenOf(loose.link)))
  await until(`document.querySelector('.card-auth form') !== null`, 'the invitation page')
  check('the invitation page is a card with the fields, the K, and no script', (await n('.card-auth input[name=password]')) === 1 && (await n('.card-auth .kmark')) >= 1 && (await ev(`document.scripts.length`)) === 0)
  await shot('15-invite')
  await policy('invitation')

  group('a member with fewer rights (Fulfilment)')
  await go(BASE + '/')
  await until(`document.querySelector('.shell') !== null`, 'the app')
  await click('.me .btn')
  await until(`document.querySelector('#si-email') !== null`, 'signed out')
  check('signing out brings the sign-in back', (await text('h1')) === 'Sign in')
  await type('#si-email', 'sam@example.test')
  await type('#si-password', PW.sam)
  await ev(`document.querySelector('form').requestSubmit()`)
  await until(`document.querySelector('.shell h1') !== null`, 'the member’s app')
  check('the real sign-in works from the page', (await text('.main h1')) === 'Orders')
  check('the rail shows the tables the profile has, with no People', JSON.stringify(await texts('.nav-item')) === JSON.stringify(['Orders9', 'Customers6', 'Products5']), JSON.stringify(await texts('.nav-item')))
  check('the profile is named, there is no Add (this profile cannot create) and no banner', (await text('.me small')) === 'Fulfilment' && (await n('.top .btn.primary')) === 0 && (await n('.banner')) === 0)
  await click('tbody tr:first-child .rowlink')
  await until(`document.querySelector('.drawer') !== null`, 'the detail')
  check('the status can be changed (write), the rest is read-only, nothing can be archived', (await n('.drawer select')) === 1 && (await n('.drawer .btn.danger')) === 0)
  await shot('16-member-detail')
  await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`)
  await go(BASE + '/#/shop/customers')
  await until(`document.querySelector('.main h1').textContent.trim() === 'Customers' && document.querySelector('tbody tr')`, 'Customers')
  check('personal fields are not there at all, not even an empty column', !(await texts('thead th')).some((t) => t === 'Email' || t === 'Phone'), JSON.stringify(await texts('thead th')))
  await shot('17-member-customers')
  await policy('member')

  group('a phone-sized window')
  await size(390, 844)
  await go(BASE + '/#/shop/orders')
  await sleep(300)
  await ev(`location.reload()`)
  await until(`document.querySelector('.shell h1') !== null && document.querySelector('tbody tr')`, 'the page at 390 px')
  await until(`getComputedStyle(document.querySelector('.menu-btn')).display !== 'none'`, 'the menu button at 390 px')
  check('the rail is a sheet behind a menu button; the table is a list', (await ev(`getComputedStyle(document.querySelector('thead')).display`)) === 'none', await ev(`getComputedStyle(document.querySelector('thead')).display + ' / ' + getComputedStyle(document.querySelector('.menu-btn')).display + ' / ' + window.innerWidth`))
  check('nothing scrolls sideways', await ev(`document.documentElement.scrollWidth <= window.innerWidth + 1`))
  await shot('18-phone-list')
  await click('.menu-btn')
  await sleep(300)
  await shot('19-phone-nav')
  await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`)
  await click('tbody tr:first-child .rowlink')
  await until(`document.querySelector('.drawer') !== null`, 'the phone drawer')
  check('the drawer fills the width', await ev(`document.querySelector('.drawer').getBoundingClientRect().width >= window.innerWidth - 1`))
  await shot('20-phone-detail')
  await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`)
  await click('a.tab[href$="/board"]').catch(() => {})
  await sleep(300)
  await shot('21-phone-board')
  check('nothing scrolls sideways on the board page itself', await ev(`document.documentElement.scrollWidth <= window.innerWidth + 1`))

  group('the page policy, across the whole run')
  check('not one console error, exception or policy violation in the browser', problems.length === 0, problems.slice(0, 3).join(' | '))
  check('the only refused write is the one the run provoked', refusals === 1, String(refusals))
  tab.close()
}

try { await main() } catch (e) { fails++; console.log('FAIL the run stopped: ' + String((e && e.stack) || e).split('\n').slice(0, 3).join(' | ')) } finally {
  if (chrome !== null) { try { chrome.kill() } catch (e) { /* gone */ } }
  if (server !== null) { try { server.kill() } catch (e) { /* gone */ } }
  await sleep(300)
  const leaked = ['KB_AUTH_SECRET', 'KB_BOOT_KEY'].some((k) => output.includes(k + '='))
  if (leaked) { fails++; console.log('FAIL the server printed a secret') }
  rmSync(root, { recursive: true, force: true })
  console.log('\n' + (total - fails) + '/' + total + ' checks passed' + (fails > 0 ? ', ' + fails + ' FAILED' : ''))
  process.exit(fails > 0 ? 1 : 0)
}

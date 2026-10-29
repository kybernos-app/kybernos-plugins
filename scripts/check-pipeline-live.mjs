#!/usr/bin/env node
// Checks the Pipeline board against the REAL GUI of the SANDBOX, with a real mouse and real key events, and reads the base to see what the page did.
//
//   source scripts/sandbox/env.sh && scripts/sandbox/start.sh
//   node scripts/check-pipeline-live.mjs [--shots <dir>] [--keep]
//
// SANDBOX ONLY: it refuses to run against the DSH on :3080 or with a DSH home that is not a sandbox's. It empties and fills the SANDBOX's business base
// through the seam module (the same code DSH runs), links one fixture theme (two boards) into the SANDBOX profile for the second half and takes it out again
// at the end (--keep leaves it). Nothing is written anywhere else. --shots <dir>: one PNG per state, kept outside git (media never go in the repository).
// Exit code: 0 all green, 1 a check failed, 3 inconclusive (no sandbox).
//
// What is played, in this order:
//   1. no theme: the plain board (New, In progress, Done), empty, then the first card added through the dialog
//   2. the routes over real HTTP: no session -> refused, the session -> answered
//   3. a theme with two boards: columns, totals in the theme's format, the switcher, the « demo » badges
//   4. a REAL drag (mouse down, twelve moves, up): measured mid-drag and after, and read back from the base (one `move` line, actor person)
//   5. the keyboard: focus a card, arrows move it and keep the focus, the screen-reader line says where it went, the ends refuse, Enter edits, Escape closes
//   6. new card with a linked contact, edit, archive, restore; the agent moves a card from outside and the page follows
//   7. empty board, loading, failure (host down, session gone, base missing) and the way back; a narrow screen
//   8. « Clear sample data » keeps what the person made
import { request as httpRequest } from 'node:http'
import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createBusinessBase } from '../packages/kybernos-plugin/business-base.mjs'
import { cookieDeSession } from './cdp-lib.mjs'
import { openLivePage, waitFor } from './live-page.mjs'

const args = process.argv.slice(2)
const shotsDir = args.indexOf('--shots') >= 0 ? args[args.indexOf('--shots') + 1] : null
const keep = args.indexOf('--keep') >= 0
if (shotsDir !== null) mkdirSync(shotsDir, { recursive: true })
const host = process.env.KB_HOST || ''
const dshHome = process.env.DSH_HOME || ''
if (host === '' || /:3080$/.test(host)) { console.error('○ inconclusive: sandbox only. Run `source scripts/sandbox/env.sh` first (KB_HOST is "' + host + '")'); process.exit(3) }
if (!dshHome.includes('/.kybernos-sandbox/')) { console.error('○ inconclusive: DSH_HOME is not a sandbox\'s (' + (dshHome === '' ? 'unset' : 'not under .kybernos-sandbox') + ')'); process.exit(3) }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) }
}

// ── the base, and the fixtures ──────────────────────────────────────────────────────────────────────────────────────────────────
const base = createBusinessBase({ file: join(dshHome, 'kybernos', 'business', 'donnees.sqlite') })
const opened = base.open()
if (opened.ok !== true) { console.error('○ inconclusive: cannot open the sandbox base (' + opened.error + ')'); process.exit(3) }
base.deleteAll({ confirm: true, actor: 'person' })
const rows = (table, filter = {}) => base.list(table, { limit: 500, includeArchived: true, ...filter }).rows
const cardRow = (id) => base.get('flow_card', id).row
const journal = () => base.exportAll({ actor: 'person' }).tables.changes.filter((c) => c.action !== 'export')
const moves = () => journal().filter((c) => c.action === 'move')

const ORDERS = [
  { stage: 'new', title: '#1046 · Jonas Weber', subtitle: '2 items', value_num: 63, contact_ref: 'jonas' },
  { stage: 'new', title: '#1045 · Chen Wei', subtitle: '1 item', value_num: 28.5, contact_ref: 'chen', item_ref: 'mug' },
  { stage: 'paid', title: '#1044 · Priya Raman', subtitle: '4 items', value_num: 118 },
  { stage: 'paid', title: '#1039 · Pinecone Gift Shop', subtitle: '24 items', value_num: 612 },
  { stage: 'packed', title: '#1043 · Amelia Hart', subtitle: '3 items', value_num: 96 },
  { stage: 'shipped', title: '#1042 · Mateo Silva', subtitle: '2 items', value_num: 74 },
]
const THEME = {
  dir: join(dshHome, 'kybernos', 'check-pipeline-shop'),
  dep: '@acme/check-pipeline-shop',
  manifest: { contract: 1, id: 'acme/check-pipeline-shop', kind: 'data', version: '1.0.0', name: { en: 'Check shop' }, description: { en: 'Two boards for the live check of Pipeline (fictional author acme).' }, author: { id: 'acme', name: 'Acme Software' }, license: 'CC-BY-4.0', pricing: 'free', requires: { kybernos: '^0.1', plugins: { 'kybernos/pipeline': '^1.0' } }, extends: [{ point: 'kybernos/pipeline#flow', range: '^1.0', dir: 'pipeline' }] },
  pkg: { name: '@acme/check-pipeline-shop', version: '1.0.0', description: 'Fixture theme of scripts/check-pipeline-live.mjs. Nothing to load.', license: 'CC-BY-4.0', dsh: { bundle: { patch: './cordis.patch.yml' } } },
  flows: [
    { id: 'orders', label: { en: 'Orders', fr: 'Commandes' }, newLabel: { en: 'New order', fr: 'Nouvelle commande' }, stages: [{ key: 'new', label: { en: 'New', fr: 'Nouvelle' } }, { key: 'paid', label: { en: 'Paid', fr: 'Payée' } }, { key: 'packed', label: { en: 'Packed', fr: 'Préparée' } }, { key: 'shipped', label: { en: 'Shipped', fr: 'Expédiée' } }], value: { format: 'money', currency: 'EUR' }, links: { contact: true, item: true } },
    { id: 'quotes', label: { en: 'Quotes', fr: 'Devis' }, newLabel: { en: 'New quote', fr: 'Nouveau devis' }, stages: [{ key: 'lead', label: { en: 'Lead', fr: 'Piste' } }, { key: 'won', label: { en: 'Won', fr: 'Gagné' } }], value: { format: 'number' }, links: { contact: false, item: false } },
  ],
}
const profile = join(dshHome, 'profiles', 'web')
const linkTheme = () => {
  mkdirSync(join(THEME.dir, 'pipeline'), { recursive: true })
  writeFileSync(join(THEME.dir, 'plugin.json'), JSON.stringify(THEME.manifest, null, 2))
  writeFileSync(join(THEME.dir, 'package.json'), JSON.stringify(THEME.pkg, null, 2))
  writeFileSync(join(THEME.dir, 'cordis.patch.yml'), '[]\n')
  for (const f of THEME.flows) writeFileSync(join(THEME.dir, 'pipeline', f.id + '.json'), JSON.stringify(f, null, 2))
  const pj = JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8'))
  pj.dependencies = { ...(pj.dependencies || {}), [THEME.dep]: 'link:' + THEME.dir }
  // a data theme is a DSH bundle with an empty patch: it is ON when the profile selects it
  if (pj.dsh && pj.dsh.profile && Array.isArray(pj.dsh.profile.bundles) && !pj.dsh.profile.bundles.includes(THEME.dep)) pj.dsh.profile.bundles.push(THEME.dep)
  writeFileSync(join(profile, 'package.json'), JSON.stringify(pj, null, 2) + '\n')
  mkdirSync(join(profile, 'node_modules', '@acme'), { recursive: true })
  const link = join(profile, 'node_modules', THEME.dep)
  try { if (lstatSync(link)) unlinkSync(link) } catch (e) { /* none yet */ }
  symlinkSync(THEME.dir, link)
}
const unlinkTheme = () => {
  try {
    const pj = JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8'))
    const had = pj.dependencies && pj.dependencies[THEME.dep] !== undefined
    if (had) delete pj.dependencies[THEME.dep]
    if (pj.dsh && pj.dsh.profile && Array.isArray(pj.dsh.profile.bundles) && pj.dsh.profile.bundles.includes(THEME.dep)) pj.dsh.profile.bundles = pj.dsh.profile.bundles.filter((b) => b !== THEME.dep)
    if (had || (pj.dsh && pj.dsh.profile)) writeFileSync(join(profile, 'package.json'), JSON.stringify(pj, null, 2) + '\n')
    const link = join(profile, 'node_modules', THEME.dep)
    try { if (lstatSync(link).isSymbolicLink() && readlinkSync(link) === THEME.dir) unlinkSync(link) } catch (e) { /* already gone */ }
    rmSync(THEME.dir, { recursive: true, force: true })
  } catch (e) { console.log('     (theme not removed: ' + e.message + ')') }
}
// A previous run that was killed leaves the theme behind: start from none.
unlinkTheme()

// ── the page ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const live = await openLivePage({ width: 1500, height: 950 }).catch((e) => { console.error('○ inconclusive: ' + e.message); process.exit(3) })
const { page } = live
const ev = async (js) => { const r = await page.evalJs(js, 10000); return r.err ? { err: r.err } : r.val }
const shot = async (name) => { if (shotsDir !== null) { try { await page.shot(join(shotsDir, name + '.png')) } catch (e) { console.log('     (no screenshot ' + name + ': ' + e.message + ')') } } }
const rect = (sel) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (e === null) return null; const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return { x: r.left, y: r.top, w: r.width, h: r.height, r: r.right, b: r.bottom, shown: r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' } })()`)
const mouse = (type, x, y) => page.send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', buttons: type === 'mouseReleased' || type === 'mouseMoved' ? 0 : 1, clickCount: type === 'mouseMoved' ? 0 : 1 })
const click = async (sel) => {
  const r = await rect(sel)
  if (r === null || r.err || r.shown !== true) return false
  const x = r.x + r.w / 2
  const y = r.y + r.h / 2
  await mouse('mouseMoved', x, y)
  await mouse('mousePressed', x, y)
  await mouse('mouseReleased', x, y)
  await sleep(300)
  return true
}
const key = async (k, code, vk) => {
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk })
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk })
  await sleep(250)
}
const ARROW = { right: ['ArrowRight', 'ArrowRight', 39], left: ['ArrowLeft', 'ArrowLeft', 37], down: ['ArrowDown', 'ArrowDown', 40], up: ['ArrowUp', 'ArrowUp', 38], enter: ['Enter', 'Enter', 13], escape: ['Escape', 'Escape', 27] }
const press = (name) => key(...ARROW[name])
const typeInto = async (sel, text) => { await click(sel); await page.send('Input.insertText', { text }); await sleep(150) }
const clearField = async (sel) => { await ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.focus(); e.select(); return 1 })()`); await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 }); await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 }); await sleep(100) }

const COL = (stage) => `[data-kb="pipeline-col"][data-stage="${stage}"]`
const CARD = (id) => `[data-kb="pipeline-card"][data-id="${id}"]`
const colInfo = (stage) => ev(`(() => { const c = document.querySelector(${JSON.stringify(COL(stage))}); if (c === null) return null; const r = c.getBoundingClientRect(); return { count: Number(c.dataset.count), total: Number(c.dataset.total), x: r.left, y: r.top, r: r.right, b: r.bottom, ids: [...c.querySelectorAll('[data-kb="pipeline-card"]')].map((e) => Number(e.dataset.id)), tops: [...c.querySelectorAll('[data-kb="pipeline-card"]')].map((e) => e.getBoundingClientRect().top), shownCount: (c.querySelector('[data-kb="pipeline-col-count"]') || {}).textContent, shownTotal: (c.querySelector('[data-kb="pipeline-col-total"]') || {}).textContent || null } })()`)
const stages = () => ev(`[...document.querySelectorAll('[data-kb="pipeline-col"]')].map((c) => c.dataset.stage)`)
const digits = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace('.', ''))
const shownDigits = (s) => (s === null ? '' : String(s).replace(/\D/g, ''))
const focusedCard = () => ev(`(() => { const e = document.activeElement; return e && e.dataset && e.dataset.kb === 'pipeline-card' ? Number(e.dataset.id) : null })()`)
const liveLine = () => ev(`(document.querySelector('[data-kb="pipeline-live"]') || {}).textContent || ''`)
const openPipeline = async () => {
  await waitFor(page, `document.readyState === 'complete' && document.querySelector('.kb4-item') !== null`, 30000)
  await sleep(2000)
  const opened = await waitFor(page, `document.querySelector('[data-kb="menu-business"] .kb4-item') !== null`, 15000)
  if (opened === null) return false
  await ev(`(() => { const g = document.querySelector('#kb4-biz-rows'); if (g && g.classList.contains('folded')) document.querySelector('[data-kb="menu-business"] .kb4-grph').click(); return 1 })()`)
  const row = await ev(`(() => { const e = [...document.querySelectorAll('[data-kb="menu-business"] .kb4-item')].find((x) => /^(Pipeline)$/.test((x.getAttribute('aria-label') || '').trim())); if (!e) return null; e.setAttribute('data-chk-row', 'pipeline'); return 1 })()`)
  if (row === null) return false
  await click('[data-chk-row="pipeline"]')
  return (await waitFor(page, `document.querySelector('[data-kb="pipeline-page"]') !== null`, 15000)) !== null
}
const boardReady = () => waitFor(page, `document.querySelector('[data-kb="pipeline-col"]') !== null && document.querySelector('[data-kb="pipeline-loading"]') === null`, 15000)
const settle = async (ms = 700) => { await sleep(ms) }

try {
  await openPipeline().then((ok) => { if (!ok) { console.error('○ inconclusive: the Pipeline row or page is not in the sandbox (is kybernos-pipeline in its profile? run scripts/sandbox/setup.sh)'); process.exit(3) } })
  await ev(`(() => { window.__chk = { errs: [] }; window.addEventListener('error', (e) => window.__chk.errs.push(String(e.message))); window.addEventListener('unhandledrejection', (e) => window.__chk.errs.push(String(e.reason))); return 1 })()`)
  await boardReady()
  await settle()

  console.log('1. no theme: the plain board')
  check('the page is the one the menu row opened, with its title and the help pill', (await rect('[data-kb="pipeline-title"]')) !== null && (await rect('.kbhp-btn')) !== null)
  check('three columns: New, In progress, Done', JSON.stringify(await stages()) === JSON.stringify(['new', 'in-progress', 'done']))
  check('empty: the message says so, every column shows where to drop', (await rect('[data-kb="pipeline-empty"]')) !== null && (await ev(`document.querySelectorAll('.kbpi-drop').length`)) === 3)
  check('there is no sample row, so no « clear sample data » button yet', (await rect('[data-act="clear-demo"]')) === null)
  const logo = await ev(`(() => { const t = document.querySelector('[data-kb="pipeline-title"]'); return t === null ? null : getComputedStyle(t).fontSize })()`)
  check('the title is drawn like the other pages (26px)', logo === '26px', logo)
  await shot('01-empty')
  check('the first card is added through the dialog (the primary button)', (await click('[data-act="new-card"]')) === true && (await rect('[data-kb="pipeline-dialog"]')) !== null)
  check('the dialog has focus in its title field and a stage list of the three stages', (await ev(`document.activeElement && document.activeElement.dataset.field`)) === 'title' && (await ev(`document.querySelectorAll('[data-field="stage"] option').length`)) === 3)
  await page.send('Input.insertText', { text: 'First plain card' })
  await sleep(150)
  await click('[data-act="save"]')
  await settle()
  const first = rows('flow_card')
  check('the card is in the base, in the first stage, made by the person', first.length === 1 && first[0].title === 'First plain card' && first[0].flow === 'default' && first[0].stage === 'new' && journal().pop().actor === 'person', first)
  check('and on the board, the empty message gone', (await colInfo('new')).ids.length === 1 && (await rect('[data-kb="pipeline-empty"]')) === null)
  await shot('02-first-card')

  console.log('2. the routes, over real HTTP')
  const authority = host
  const cookie = cookieDeSession(authority)
  const url = 'http://' + authority + '/kybernos-pipeline/'
  const noSession = await fetch(url + 'flows')
  check('a read with no session is refused (401)', noSession.status === 401, noSession.status)
  const withSession = await fetch(url + 'flows', { headers: { cookie: cookie.nom + '=' + cookie.valeur } })
  const flowsJson = await withSession.json().catch(() => null)
  check('with the session it answers the boards', withSession.status === 200 && flowsJson !== null && flowsJson.ok === true && flowsJson.flows[0].id === 'default', withSession.status)
  const noOrigin = await fetch(url + 'create', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
  check('a write with no Origin is refused (403)', noOrigin.status === 403, noOrigin.status)
  const noCookie = await fetch(url + 'create', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://' + authority }, body: JSON.stringify({ flow: 'default', title: 'sneaky' }) })
  check('the right Origin and no session is refused (401) and wrote nothing', noCookie.status === 401 && rows('flow_card').length === 1, noCookie.status)
  // fetch() will not let a program choose its Host: a raw request does (this is what a page that rebinds its own name to this machine sends)
  const foreignStatus = await new Promise((resolve) => {
    const req = httpRequest({ host: '127.0.0.1', port: Number(authority.split(':')[1]), path: '/kybernos-pipeline/board', headers: { host: 'evil.example:' + authority.split(':')[1], cookie: cookie.nom + '=' + cookie.valeur } }, (res) => { res.resume(); resolve(res.statusCode) })
    req.on('error', () => resolve(0))
    req.end()
  })
  check('a foreign Host is refused (403), even with the real session', foreignStatus === 403, foreignStatus)

  console.log('3. a theme with two boards')
  base.deleteAll({ confirm: true, actor: 'person' })
  const contacts = [{ ref: 'jonas', name: 'Jonas Weber', email: 'jonas@example.com' }, { ref: 'chen', name: 'Chen Wei', email: 'chen@example.com' }, { ref: 'cafe', name: 'Cafe Bleu', kind: 'company' }]
  const seeded = base.seed({ contacts, items: [{ ref: 'mug', title: 'Ceramic mug', subtitle: 'FC-MUG-01' }], cards: ORDERS.map((c) => ({ flow: 'orders', ...c })) }, { theme: 'acme/check-pipeline-shop' })
  check('the sample rows are seeded through the seam (all demo)', seeded.ok === true, seeded)
  const own = base.create('flow_card', { flow: 'orders', stage: 'new', title: '#1050 · my own order', value_num: 40 }, { actor: 'person' }).row
  linkTheme()
  const registryState = await fetch('http://' + authority + '/kybernos-registry/state?fresh=1', { headers: { cookie: cookie.nom + '=' + cookie.valeur } }).then((r) => r.json()).catch(() => null)
  const themeRec = registryState === null ? null : registryState.plugins.find((p) => p.id === 'acme/check-pipeline-shop')
  check('the registry reads the fixture theme and finds it ok (it is the theme\'s two boards the page will show)', themeRec !== undefined && themeRec !== null && themeRec.status === 'ok', themeRec ? { status: themeRec.status, reason: themeRec.reason, errors: themeRec.errors } : registryState === null ? 'no answer' : registryState.plugins.map((p) => p.id))
  await page.send('Page.reload', { ignoreCache: true })
  check('the page is opened again from the menu', (await openPipeline()) === true)
  await ev(`(() => { window.__chk = { errs: [] }; window.addEventListener('error', (e) => window.__chk.errs.push(String(e.message))); window.addEventListener('unhandledrejection', (e) => window.__chk.errs.push(String(e.reason))); return 1 })()`)
  await boardReady()
  await settle()
  check('the theme\'s stages are the columns, in its order', JSON.stringify(await stages()) === JSON.stringify(['new', 'paid', 'packed', 'shipped']), await stages())
  check('the title is the board\'s name and the new-card button its own word', /Orders|Commandes/.test(await ev(`document.querySelector('[data-kb="pipeline-title"]').textContent`)) && /New order|Nouvelle commande/.test(await ev(`document.querySelector('[data-act="new-card"]').textContent`)))
  const tabs = await ev(`[...document.querySelectorAll('[data-kb="pipeline-tab"]')].map((t) => [t.dataset.flow, t.getAttribute('aria-selected')])`)
  check('two boards: a switcher with the first selected', JSON.stringify(tabs) === JSON.stringify([['orders', 'true'], ['quotes', 'false']]), tabs)
  const allOrders = [...ORDERS.map((c) => ({ stage: c.stage, v: c.value_num })), { stage: 'new', v: 40 }]
  let columnsRight = true
  const seen = {}
  for (const s of ['new', 'paid', 'packed', 'shipped']) {
    const info = await colInfo(s)
    const mine = allOrders.filter((c) => c.stage === s)
    const want = Math.round(mine.reduce((a, c) => a + c.v, 0) * 100) / 100
    seen[s] = { have: [info.count, info.total, info.shownTotal], want: [mine.length, want] }
    if (info.count !== mine.length || info.total !== want || info.shownCount !== String(mine.length) || shownDigits(info.shownTotal) !== digits(want)) columnsRight = false
  }
  check('every column shows its number of cards and its total, in euros, as the base adds them up', columnsRight, seen)
  check('the total reads as money (a currency sign)', /€/.test((await colInfo('paid')).shownTotal || ''), (await colInfo('paid')).shownTotal)
  const inside = await ev(`[...document.querySelectorAll('[data-kb="pipeline-card"]')].every((card) => { const c = card.closest('[data-kb="pipeline-col"]').getBoundingClientRect(); const r = card.getBoundingClientRect(); return r.left >= c.left - 0.5 && r.right <= c.right + 0.5 && r.width > 100 })`)
  check('every card sits inside its column and is wide enough to read', inside === true)
  check('the sample cards carry the « demo » badge, the one the person made does not', (await ev(`document.querySelectorAll('[data-kb="pipeline-demo"]').length`)) === 6 && (await rect(CARD(own.id) + ' [data-kb="pipeline-demo"]')) === null)
  check('linked names show: the contact\'s initials and the item as a chip', (await ev(`document.querySelectorAll('[data-kb="pipeline-card-contact"]').length`)) === 2 && (await ev(`(document.querySelector('[data-kb="pipeline-card-item"]') || {}).textContent`)) === 'Ceramic mug')
  check('« Clear sample data » is offered', (await rect('[data-act="clear-demo"]')) !== null)
  await shot('03-loaded')

  console.log('4. a real drag')
  const mover = ORDERS.findIndex((c) => c.title.startsWith('#1046'))
  const dragged = rows('flow_card').find((c) => c.title.startsWith('#1046'))
  const beforeNew = await colInfo('new')
  const beforePaid = await colInfo('paid')
  const beforeMoves = moves().length
  const a = await rect(CARD(dragged.id))
  const target = await rect(COL('paid'))
  const x0 = a.x + a.w / 2
  const y0 = a.y + a.h / 2
  const x1 = target.x + target.w / 2
  const y1 = target.y + Math.min(target.h - 20, 200)
  await mouse('mouseMoved', x0, y0)
  await mouse('mousePressed', x0, y0)
  for (let i = 1; i <= 12; i += 1) { await mouse('mouseMoved', x0 + ((x1 - x0) * i) / 12, y0 + ((y1 - y0) * i) / 12); await sleep(35) }
  const mid = await ev(`(() => { const g = document.querySelector('.kbpi-ghost'); const src = document.querySelector(${JSON.stringify(CARD(dragged.id))}); const r = g ? g.getBoundingClientRect() : null; return { ghost: r ? { x: r.left, y: r.top, w: r.width, h: r.height } : null, src: src ? src.classList.contains('drag') : null, over: [...document.querySelectorAll('.kbpi-col.over')].map((c) => c.dataset.stage), selection: String(getSelection()) } })()`)
  check('mid-drag: a ghost of the card follows the pointer, the original is dimmed', mid.ghost !== null && Math.abs(mid.ghost.x + 10 - x1) < a.w && Math.abs(mid.ghost.y - y1) < 200 && mid.src === true, mid)
  check('mid-drag: the column under the pointer lights up, and only that one', JSON.stringify(mid.over) === JSON.stringify(['paid']), mid.over)
  check('mid-drag: no text got selected on the way', mid.selection === '', mid.selection)
  await shot('04-mid-drag')
  await mouse('mouseReleased', x1, y1)
  await waitFor(page, `document.querySelector(${JSON.stringify(COL('paid') + ' ' + CARD(dragged.id))}) !== null`, 6000)
  await settle(1200)
  const afterNew = await colInfo('new')
  const afterPaid = await colInfo('paid')
  const nowCard = await rect(CARD(dragged.id))
  check('after the drop the ghost is gone and no column is lit', (await rect('.kbpi-ghost')) === null && (await ev(`document.querySelectorAll('.kbpi-col.over').length`)) === 0)
  check('the card is now inside the Paid column, at its end', afterPaid.ids[afterPaid.ids.length - 1] === dragged.id && nowCard.x >= afterPaid.x - 0.5 && nowCard.r <= afterPaid.r + 0.5 && afterPaid.tops[afterPaid.tops.length - 1] > afterPaid.tops[0], { ids: afterPaid.ids, tops: afterPaid.tops })
  check('it moved on the screen (measured: it was in New, left of Paid)', a.x < target.x && nowCard.x > a.x + 50, { before: a.x, after: nowCard.x })
  check('New lost one card and 63; Paid gained one card and 63', afterNew.count === beforeNew.count - 1 && afterNew.total === Math.round((beforeNew.total - 63) * 100) / 100 && afterPaid.count === beforePaid.count + 1 && afterPaid.total === Math.round((beforePaid.total + 63) * 100) / 100, { beforeNew, afterNew, beforePaid, afterPaid })
  check('the shown totals follow the numbers', shownDigits(afterPaid.shownTotal) === digits(afterPaid.total) && shownDigits(afterNew.shownTotal) === digits(afterNew.total), { paid: afterPaid.shownTotal, new: afterNew.shownTotal })
  check('the base agrees: stage paid, at the end of the column, ONE move line, by the person', cardRow(dragged.id).stage === 'paid' && cardRow(dragged.id).position > Math.max(...rows('flow_card', { stage: 'paid' }).filter((c) => c.id !== dragged.id).map((c) => c.position)) && moves().length === beforeMoves + 1 && moves().pop().actor === 'person', moves().pop())
  check('dropping on its own column changes nothing (no move line)', await (async () => {
    const r1 = await rect(CARD(dragged.id)); const own1 = await rect(COL('paid')); const n = moves().length
    await mouse('mouseMoved', r1.x + r1.w / 2, r1.y + r1.h / 2); await mouse('mousePressed', r1.x + r1.w / 2, r1.y + r1.h / 2)
    for (let i = 1; i <= 6; i += 1) { await mouse('mouseMoved', r1.x + r1.w / 2 + i * 3, r1.y + r1.h / 2 + 40 + i * 3); await sleep(30) }
    await mouse('mouseReleased', own1.x + own1.w / 2, own1.y + own1.h - 30); await settle(900)
    return moves().length === n
  })())
  check('a click without moving opens the card, a drag never does', (await rect('[data-kb="pipeline-dialog"]')) === null)
  void mover

  console.log('5. the keyboard')
  const kb = rows('flow_card').find((c) => c.title.startsWith('#1044'))
  await ev(`document.querySelector(${JSON.stringify(CARD(kb.id))}).focus()`)
  check('a card takes the focus', (await focusedCard()) === kb.id)
  const m0 = moves().length
  await press('right')
  await waitFor(page, `document.querySelector(${JSON.stringify(COL('packed') + ' ' + CARD(kb.id))}) !== null`, 6000)
  await settle(900)
  check('right arrow: the card is in the next column (Packed)', (await colInfo('packed')).ids.includes(kb.id) && cardRow(kb.id).stage === 'packed', cardRow(kb.id).stage)
  check('the focus stayed on the card, in its new column', (await focusedCard()) === kb.id, await focusedCard())
  const line = await liveLine()
  check('the screen-reader line says which card went where, with the column\'s count', line.includes('#1044') && /Packed|Préparée/.test(line) && /\d/.test(line), line)
  check('one move line, by the person (the keyboard is the person)', moves().length === m0 + 1 && moves().pop().actor === 'person')
  const packed = await colInfo('packed')
  check('the totals followed (Packed = 96 + 118)', packed.total === 214 && shownDigits(packed.shownTotal) === '214', packed)
  await press('left')
  await settle(900)
  check('left arrow brings it back to Paid, focus kept', cardRow(kb.id).stage === 'paid' && (await focusedCard()) === kb.id && (await colInfo('paid')).ids.includes(kb.id))
  const colCards = await ev(`[...document.querySelector(${JSON.stringify(COL('paid'))}).querySelectorAll('[data-kb="pipeline-card"]')].map((e) => Number(e.dataset.id))`)
  const above = colCards[colCards.indexOf(kb.id) - 1]
  await press('up')
  check('up arrow walks to the card above in the column, without moving any', above !== undefined && (await focusedCard()) === above && moves().length === m0 + 2, { above, focused: await focusedCard() })
  await press('down')
  check('and down arrow walks back', (await focusedCard()) === kb.id && moves().length === m0 + 2, await focusedCard())
  const edge = rows('flow_card').find((c) => c.title.startsWith('#1042'))
  await ev(`document.querySelector(${JSON.stringify(CARD(edge.id))}).focus()`)
  const m1 = moves().length
  await press('right')
  await settle(600)
  check('at the last column the right arrow says so and moves nothing', moves().length === m1 && cardRow(edge.id).stage === 'shipped' && /last column|dernière colonne/.test(await liveLine()), await liveLine())
  await press('enter')
  check('Enter opens the card for editing, filled in', (await rect('[data-kb="pipeline-dialog"]')) !== null && (await ev(`document.querySelector('[data-field="title"]').value`)) === edge.title)
  check('Tab does not leave the dialog', await (async () => { for (let i = 0; i < 12; i += 1) await key('Tab', 'Tab', 9); return (await ev(`document.querySelector('[data-kb="pipeline-dialog"]').contains(document.activeElement)`)) === true })())
  await press('escape')
  await settle(300)
  check('Escape closes it and gives the focus back to the card', (await rect('[data-kb="pipeline-dialog"]')) === null && (await focusedCard()) === edge.id, await focusedCard())

  console.log('6. new, edit, archive, restore, and the agent')
  await click('[data-act="new-card"]')
  await page.send('Input.insertText', { text: '#1051 · Live check order' })
  await typeInto('[data-field="value"]', '40,5')
  await typeInto('[data-kb="pipeline-link-input"][data-kind="contact"]', 'chen')
  const picked = await waitFor(page, `document.querySelectorAll('[data-kb="pipeline-link-list"] [data-act="pick-link"]').length === 1`, 5000)
  await shot('05a-new-dialog-picker')
  check('the contact search answers from the base, filtered by what was typed (one match for « chen »)', picked !== null && /Chen Wei/.test(await ev(`document.querySelector('[data-kb="pipeline-link-list"]').textContent`)))
  await click('[data-kb="pipeline-link-list"] [data-act="pick-link"]')
  check('the chosen contact shows as a chip that can be removed', (await ev(`(document.querySelector('[data-kb="pipeline-link-chip"][data-kind="contact"]') || {}).textContent`)) === 'Chen Wei×')
  await click('[data-act="save"]')
  await settle(1000)
  const made = rows('flow_card').find((c) => c.title.startsWith('#1051'))
  check('the card is in the base with its value, its link and the first stage', made !== undefined && made.value_num === 40.5 && made.stage === 'new' && made.contact_id === rows('contact').find((c) => c.name === 'Chen Wei').id && made.demo === false, made)
  check('and on the board, New\'s total follows (28.5 + 63→moved + 40 + 40.5)', (await colInfo('new')).ids.includes(made.id) && (await colInfo('new')).total === 28.5 + 40 + 40.5)
  await click(CARD(made.id))
  check('a click on a card opens it', (await rect('[data-kb="pipeline-dialog"]')) !== null && (await ev(`document.querySelector('[data-field="title"]').value`)) === made.title)
  await shot('05b-edit-dialog')
  await clearField('[data-field="value"]')
  await page.send('Input.insertText', { text: '100' })
  await click('[data-act="save"]')
  await settle(900)
  check('editing the value changes the base and the column total', cardRow(made.id).value_num === 100 && (await colInfo('new')).total === 28.5 + 40 + 100)
  await click(CARD(made.id))
  await click('[data-act="archive"]')
  await settle(900)
  check('archive: the card leaves the board and the total, and stays in the base', (await rect(CARD(made.id))) === null && cardRow(made.id).archived_at !== null && (await colInfo('new')).total === 28.5 + 40)
  await click('[data-act="toggle-archived"]')
  await waitFor(page, `document.querySelector('[data-kb="pipeline-archived-row"]') !== null`, 5000)
  check('« Archived » lists it', (await ev(`[...document.querySelectorAll('[data-kb="pipeline-archived-row"]')].map((e) => Number(e.dataset.id))`)).includes(made.id))
  await click('[data-kb="pipeline-archived-row"][data-id="' + made.id + '"] [data-act="restore"]')
  await settle(1000)
  check('restore: it is back on the board with its value', cardRow(made.id).archived_at === null && (await colInfo('new')).total === 28.5 + 40 + 100)
  await click('[data-act="toggle-archived"]')
  const agentCard = rows('flow_card').find((c) => c.title.startsWith('#1043'))
  const agentMove = base.update('flow_card', agentCard.id, { stage: 'shipped' }, { actor: 'agent' })
  check('the agent\'s move (a write from another process, actor agent) is one journal line', agentMove.ok === true && moves().pop().actor === 'agent')
  await ev(`document.dispatchEvent(new Event('visibilitychange'))`)
  await waitFor(page, `document.querySelector(${JSON.stringify(COL('shipped') + ' ' + CARD(agentCard.id))}) !== null`, 8000)
  check('the page follows without a reload when it comes back to the front', (await colInfo('shipped')).ids.includes(agentCard.id) && (await colInfo('packed')).count === (await colInfo('packed')).ids.length)
  await shot('05-after-edits')

  console.log('7. empty, loading, failure, narrow')
  await click('[data-kb="pipeline-tab"][data-flow="quotes"]')
  await boardReady()
  await settle(500)
  check('the other board is empty: the message, two columns in the number format', (await rect('[data-kb="pipeline-empty"]')) !== null && JSON.stringify(await stages()) === JSON.stringify(['lead', 'won']))
  check('its dialog takes no link and a plain number', await (async () => { await click('[data-act="new-card"]'); const f = await ev(`[...document.querySelectorAll('[data-kb="pipeline-field"]')].map((e) => e.dataset.field)`); const l = await ev(`document.querySelectorAll('[data-kb="pipeline-link-input"]').length`); await press('escape'); return JSON.stringify(f) === JSON.stringify(['title', 'subtitle', 'value', 'stage']) && l === 0 })())
  check('and its choice is remembered for next time', (await ev(`localStorage.getItem('kybernos.pipeline.flow.v1')`)) === 'quotes')
  await shot('06-empty-quotes')
  await click('[data-kb="pipeline-tab"][data-flow="orders"]')
  await boardReady()
  // loading: the answer is held back for a second
  await ev(`(() => { window.__realFetch = window.fetch; window.fetch = (u, i) => (String(u).indexOf('/kybernos-pipeline/board') >= 0 ? new Promise((r) => setTimeout(() => r(window.__realFetch(u, i)), 1800)) : window.__realFetch(u, i)); return 1 })()`)
  await click('[data-kb="pipeline-tab"][data-flow="quotes"]')
  await sleep(500)
  check('loading: a labelled skeleton of columns while the board comes', (await rect('[data-kb="pipeline-loading"]')) !== null && (await ev(`document.querySelectorAll('[data-kb="pipeline-loading"] .kbpi-bone').length`)) >= 4 && (await ev(`(document.querySelector('[data-kb="pipeline-loading"] [role="status"]') || {}).textContent`)) !== '')
  await shot('07-loading')
  await boardReady()
  // failure: the host does not answer, then the session is gone, then the base is missing; each time the way back is the Try again button
  const failWith = (body) => ev(`(() => { window.fetch = (u, i) => (String(u).indexOf('/kybernos-pipeline/') >= 0 ? ${body} : window.__realFetch(u, i)); return 1 })()`)
  await failWith(`Promise.reject(new TypeError('Failed to fetch'))`)
  await click('[data-kb="pipeline-tab"][data-flow="orders"]')
  await waitFor(page, `document.querySelector('[data-kb="pipeline-error"]') !== null`, 6000)
  const errText = await ev(`document.querySelector('[data-kb="pipeline-error"]').textContent`)
  check('failure (host down): an alert in words, a Try again button, no empty board drawn as if all was well', /does not answer|ne répond pas/.test(errText) && (await rect('[data-act="retry"]')) !== null && (await rect('[data-kb="pipeline-col"]')) === null, errText)
  await shot('08-error')
  await failWith(`Promise.resolve(new Response(JSON.stringify({ ok: false, error: 'sign-in required' }), { status: 401, headers: { 'content-type': 'application/json' } }))`)
  await click('[data-act="retry"]')
  await settle(500)
  check('failure (session gone): says the session expired', /expired|expiré/.test(await ev(`(document.querySelector('[data-kb="pipeline-error"]') || {}).textContent || ''`)))
  await failWith(`Promise.resolve(new Response(JSON.stringify({ ok: false, error: 'base_missing' }), { status: 200, headers: { 'content-type': 'application/json' } }))`)
  await click('[data-act="retry"]')
  await settle(500)
  check('failure (base missing): says the business data is not available', /not available|pas disponibles/.test(await ev(`(document.querySelector('[data-kb="pipeline-error"]') || {}).textContent || ''`)))
  await ev(`(() => { window.fetch = window.__realFetch; return 1 })()`)
  await click('[data-act="retry"]')
  await boardReady()
  await settle(500)
  check('Try again brings the board back, with every card', (await rect('[data-kb="pipeline-error"]')) === null && (await ev(`document.querySelectorAll('[data-kb="pipeline-card"]').length`)) === rows('flow_card').filter((c) => c.archived_at === null && c.flow === 'orders').length)
  // a move the host refuses is put back and said
  await ev(`(() => { window.fetch = (u, i) => (String(u).indexOf('/kybernos-pipeline/move') >= 0 ? Promise.resolve(new Response(JSON.stringify({ ok: false, error: 'busy' }), { status: 200, headers: { 'content-type': 'application/json' } })) : window.__realFetch(u, i)); return 1 })()`)
  const refusedCard = rows('flow_card').find((c) => c.title.startsWith('#1039'))
  const wasIn = cardRow(refusedCard.id).stage
  await ev(`document.querySelector(${JSON.stringify(CARD(refusedCard.id))}).focus()`)
  await press('right')
  await settle(1500)
  check('a move the host refuses is put back where it was, and the person is told', cardRow(refusedCard.id).stage === wasIn && (await colInfo(wasIn)).ids.includes(refusedCard.id) && (await rect('[data-kb="pipeline-toast"]')) !== null, { stage: cardRow(refusedCard.id).stage })
  await ev(`(() => { window.fetch = window.__realFetch; return 1 })()`)
  // a narrow screen
  await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false })
  await sleep(700)
  const narrow = await ev(`(() => { const b = document.querySelector('[data-kb="pipeline-board"]'); const cols = [...document.querySelectorAll('[data-kb="pipeline-col"]')].map((c) => c.getBoundingClientRect().width); const btn = document.querySelector('[data-act="new-card"]').getBoundingClientRect(); return { page: document.documentElement.scrollWidth, inner: innerWidth, boardScrolls: b.scrollWidth > b.clientWidth + 1, boardW: b.getBoundingClientRect().width, colMin: Math.min(...cols), colMax: Math.max(...cols), btnRight: btn.right, btnLeft: btn.left } })()`)
  check('narrow (390px): the page itself does not scroll sideways, the board does', narrow.page <= narrow.inner + 1 && narrow.boardScrolls === true, narrow)
  check('narrow: a column is wide enough to read a card and narrower than the screen', narrow.colMin >= 200 && narrow.colMax <= narrow.inner, narrow)
  check('narrow: the new-card button is fully on screen', narrow.btnLeft >= 0 && narrow.btnRight <= narrow.inner, narrow)
  await shot('09-narrow')
  await ev(`document.querySelector(${JSON.stringify(CARD(edge.id))}).scrollIntoView({ inline: 'center' })`)
  await settle(300)
  await shot('10-narrow-scrolled')
  await page.send('Emulation.clearDeviceMetricsOverride', {})
  await sleep(500)

  console.log('8. « Clear sample data »')
  await click('[data-act="clear-demo"]')
  check('a confirmation says what goes (Contacts, Catalog, Pipeline) before anything is deleted', (await rect('[data-kb="pipeline-dialog"]')) !== null && rows('flow_card').some((c) => c.demo === true) && /Catalog|Catalogue/.test(await ev(`document.querySelector('[data-kb="pipeline-dialog"]').textContent`)))
  await shot('11-confirm-clear')
  await click('[data-act="confirm-clear"]')
  await settle(1200)
  check('the sample rows are gone from the base, what the person made stays', rows('flow_card').every((c) => c.demo === false) && rows('flow_card').some((c) => c.title.startsWith('#1050')) && rows('flow_card').some((c) => c.title.startsWith('#1051')) && rows('contact').every((c) => c.demo === false))
  check('and from the board: no badge, no button', (await ev(`document.querySelectorAll('[data-kb="pipeline-demo"]').length`)) === 0 && (await rect('[data-act="clear-demo"]')) === null)
  await shot('12-after-clear')

  console.log('the whole run')
  check('the page raised no error', (await ev(`window.__chk.errs`)).length === 0, await ev(`window.__chk.errs`))
  const log = existsSync(join(dshHome, '..', '..', 'sandbox.log')) ? readFileSync(join(dshHome, '..', '..', 'sandbox.log'), 'utf8').split('\n').filter((l) => l.includes('[kybernos-pipeline]')) : []
  check('the host logged its routes and its two tools, and nothing was disabled', log.some((l) => /routes mounted/.test(l)) && log.some((l) => /tools pipeline_list, pipeline_move registered/.test(l)) && !log.some((l) => /disabled|not mounted|failed/.test(l)), log.slice(0, 6))
} catch (e) {
  fail += 1
  console.log('  ✗ the check itself stopped: ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e))
} finally {
  await live.close().catch(() => {})
  if (!keep) { unlinkTheme(); base.deleteAll({ confirm: true, actor: 'person' }) }
  base.close()
}
console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)

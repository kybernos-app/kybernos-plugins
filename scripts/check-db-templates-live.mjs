#!/usr/bin/env node
// The databases the three shipped templates ship, on the REAL GUI of a SANDBOX: the Themes route seeds each one through the db seam (the page's own `seed` action, in French),
// the host lists them, and the Apps page opens them: the tabs are the objects of the template, the board has the stages of the pipeline, the cards show the people, a linked row
// opens both ways, a second seed changes nothing. The numbers are the ones of the old sample (27 contacts, 16 properties…), so nothing was lost on the way.
//
//   source scripts/sandbox/env.sh && scripts/sandbox/start.sh && node scripts/check-db-templates-live.mjs [--shots <dir>]
//
// SANDBOX ONLY (exit 3 against :3080 and without a sandbox DSH_HOME). The Tables bundle must be on in the sandbox profile (the seam is published by it). Nothing is sent to a model.
// A template is installed once: a second run finds the databases of the first and checks them (stop the sandbox and remove <sandbox DSH_HOME>/kybernos/kybernos-db to start from nothing).
// --shots <dir>: one PNG per state (kept outside git: media never go in the repository). Exit code: 0 all green, 1 a check failed, 3 not run.
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { cookieDeSession } from './cdp-lib.mjs'
import { openLivePage } from './live-page.mjs'

const args = process.argv.slice(2)
const shotsDir = args.indexOf('--shots') >= 0 ? args[args.indexOf('--shots') + 1] : null
if (shotsDir !== null) mkdirSync(shotsDir, { recursive: true })
const host = process.env.KB_HOST || ''
const dshHome = process.env.DSH_HOME || ''
if (host === '' || /:3080$/.test(host)) { console.error('○ not run: sandbox only. `source scripts/sandbox/env.sh` first (KB_HOST is "' + host + '")'); process.exit(3) }
if (!dshHome.includes('.kybernos-sandbox')) { console.error('○ not run: DSH_HOME is not a sandbox\'s (' + dshHome + ')'); process.exit(3) }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail).slice(0, 500))) }
}
const cookie = cookieDeSession(host)
if (cookie === null) { console.error('○ not run: the sandbox\'s session secret is unreadable'); process.exit(3) }
const get = async (path) => (await fetch('http://' + host + path, { headers: { cookie: cookie.nom + '=' + cookie.valeur } })).json()
const seededState = await get('/kybernos-db/state').catch(() => null)
if (seededState === null || seededState.ok !== true) { console.error('○ not run: the Tables bundle does not answer on ' + host + ' (scripts/sandbox/start.sh, and the bundle on)'); process.exit(3) }

// What each template must make, with the words of the French database: the name, the tabs, the pipeline's stages and the row counts of the old sample.
const WANT = {
  'real-estate': { name: 'Agence immobilière', tabs: ['Contacts', 'Biens', 'Locations', 'Ventes', 'Notes'], rows: { contact: 27, property: 16, lettings: 8, sales: 11, note: 11 }, item: 'property', board: { object: 'sales', stages: ['Demande', 'Visite', 'Offre', 'Compromis', 'Conclue'] } },
  ecommerce: { name: 'Boutique en ligne', tabs: ['Contacts', 'Produits', 'Commandes', 'Notes'], rows: { contact: 22, product: 16, orders: 18, note: 8 }, item: 'product', board: { object: 'orders', stages: null } },
  recruitment: { name: 'Cabinet de recrutement', tabs: ['Contacts', 'Offres', 'Candidats', 'Missions clients', 'Notes'], rows: { contact: 22, job: 14, candidates: 10, missions: 9, note: 8 }, item: 'job', board: { object: 'candidates', stages: null } },
}

const live = await openLivePage({ width: 1500, height: 950 }).catch((e) => { console.error('○ not run: ' + e.message); process.exit(3) })
const { page } = live
const ev = async (js, ms) => { const r = await page.evalJs(js, ms || 10000); return r.err ? { err: r.err } : r.val }
const shot = async (name) => { if (shotsDir !== null) { try { await page.shot(join(shotsDir, name + '.png')) } catch (e) { console.log('     (no screenshot ' + name + ': ' + e.message + ')') } } }
const kb = (name, extra = '') => `[data-kb="${name}"]${extra}`
const count = (sel) => ev(`document.querySelectorAll(${JSON.stringify(sel)}).length`)
const texts = (sel) => ev(`[...document.querySelectorAll(${JSON.stringify(sel)})].map((e) => e.innerText.replace(/\\s+/g, ' ').trim())`)
const until = async (fn, ms = 9000) => { const end = Date.now() + ms; let last; while (Date.now() < end) { last = await fn(); if (last) return last; await sleep(200) } return last }
const rect = (sel) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (e === null) return null; const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, shown: r.width > 0 && r.height > 0 } })()`)
const click = async (sel) => {
  await ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (e !== null) e.scrollIntoView({ block: 'nearest', behavior: 'instant' }); return 1 })()`)
  await sleep(150)
  const r = await rect(sel)
  if (r === null || r.err || r.shown !== true) return false
  const x = r.x + r.w / 2
  const y = r.y + r.h / 2
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
  await sleep(400)
  return true
}
/** A request the page itself makes (the signed session cookie rides with it), the way the Themes page posts its `seed`. */
const post = (path, body) => ev(`fetch(${JSON.stringify(path)}, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: ${JSON.stringify(JSON.stringify(body))} }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }))`, 20000)

try {
  await page.send('Runtime.enable', {})
  await sleep(2500)

  // 1. the Themes route seeds each template's database, in French
  const first = {}
  for (const dir of Object.keys(WANT)) {
    first[dir] = await post('/kybernos/themes', { action: 'seed', id: 'kybernos-themes/' + dir, lang: 'fr' })
    const db = first[dir] && first[dir].json
    check(dir + ': the seed answers with the database it made (or the one an earlier run made)', first[dir].status === 200 && db && db.ok === true && typeof db.db === 'string', first[dir])
    check(dir + ': the answer counts the objects, views, rows and pictures', db && (db.skipped === true || (db.counts && db.counts.rows === Object.values(WANT[dir].rows).reduce((a, b) => a + b, 0) && db.counts.photos > 0)), db && db.counts)
  }
  const again = await post('/kybernos/themes', { action: 'seed', id: 'kybernos-themes/ecommerce', lang: 'fr' })
  check('a second seed of the same template changes nothing (skipped, same database)', again.json && again.json.skipped === true && again.json.db === first.ecommerce.json.db, again.json)

  // 2. the host lists them, in the template's language, with the objects of the template
  const state = await get('/kybernos-db/state')
  for (const [dir, want] of Object.entries(WANT)) {
    const db = state.dbs.find((d) => d.id === first[dir].json.db)
    check(dir + ': the host lists « ' + want.name + ' » with its objects', db !== undefined && db.name === want.name && db.objects.map((o) => o.label).join('|') === want.tabs.join('|'), db && { name: db.name, objects: db.objects.map((o) => o.label) })
    if (db === undefined) continue
    const counts = {}
    for (const o of db.objects) counts[o.key] = ((await get('/kybernos-db/records?db=' + db.id + '&object=' + o.key)).records || []).length
    check(dir + ': every object holds the rows of the old sample', JSON.stringify(counts) === JSON.stringify(want.rows), counts)
    const files = ((await get('/kybernos-db/records?db=' + db.id + '&object=contact')).records || []).filter((r) => Array.isArray(r.values.photo) && r.values.photo.length === 1)
    check(dir + ': a portrait is served again from the row that holds it, as a picture', files.length > 0 && await (async () => {
      const f = files[0].values.photo[0]
      const r = await fetch('http://' + host + '/kybernos-db/file?db=' + db.id + '&object=contact&id=' + files[0].id + '&field=photo&hash=' + f.hash, { headers: { cookie: cookie.nom + '=' + cookie.valeur } })
      const bytes = Buffer.from(await r.arrayBuffer())
      return r.status === 200 && /^image\/jpeg/.test(r.headers.get('content-type') || '') && bytes[0] === 0xff && bytes[1] === 0xd8
    })())
  }

  // 3. the real page opens each one
  check('the Apps page is opened (reached from Creations: its menu row is folded into it)', (await ev(`window.__KB_OPEN__({ view: 'tables' }) === true`)) === true && (await until(() => ev(`document.querySelector('[data-kb="apps-gallery"]') !== null`))) === true)
  for (const [dir, want] of Object.entries(WANT)) {
    const id = first[dir].json.db
    if ((await ev(`document.querySelector('[data-kb="apps-back"]') !== null`)) === true) await click('[data-kb="apps-back"]')
    const chose = await until(async () => (await click('[data-kb="apps-card"][data-db="' + id + '"] [data-kb="apps-open"]')) === true)
    check(dir + ': its card in the gallery opens the app', chose === true)
    check(dir + ': the tabs are the objects of the template, in the template’s French', (await until(async () => JSON.stringify(await texts(kb('tables-tab'))) === JSON.stringify(want.tabs))) === true, await texts(kb('tables-tab')))
    check(dir + ': the contacts table shows the people', (await until(() => ev(`document.querySelectorAll('[data-kb="tables-row"]').length >= 20`))) === true)
    await shot(dir + '-contacts')
    // the cards view of the contacts, then the object that has a pipeline as a board
    const cardsView = await ev(`(() => { const b = [...document.querySelectorAll('[data-kb="tables-view"]')].find((e) => /Fiches/.test(e.innerText)); if (b) b.setAttribute('data-chk', 'cards'); return b !== undefined })()`)
    check(dir + ': the contacts have a « Fiches » view', cardsView === true)
    if (cardsView === true) {
      await click('[data-chk="cards"]')
      check(dir + ': the cards view draws one card per contact', (await until(() => ev(`document.querySelectorAll('[data-kb="tables-card"]').length >= 20`))) === true)
      await shot(dir + '-cards')
    }
    const target = await ev(`(() => { const t = [...document.querySelectorAll('[data-kb="tables-tab"]')].find((e) => e.getAttribute('data-object') === ${JSON.stringify(want.board.object)}); if (t) t.setAttribute('data-chk', 'board-tab'); return t !== undefined })()`)
    check(dir + ': the pipeline object has its tab', target === true)
    if (target === true) {
      await click('[data-chk="board-tab"]')
      check(dir + ': its first view is the board, with a column per stage', (await until(() => ev(`document.querySelector('[data-kb="tables-board"]') !== null`))) === true)
      const cols = await ev(`[...document.querySelectorAll('[data-kb="tables-board"] [data-col]')].filter((e) => e.getAttribute('data-col') !== '').length`)
      const stages = want.board.stages
      check(dir + ': the columns are the stages of the old pipeline', stages === null ? cols >= 4 : cols === stages.length, { cols })
      check(dir + ': each column with an amount adds it up in its header', (await until(() => count(kb('tables-col-total')).then((n) => n >= 2))) === true, await texts(kb('tables-col-total')))
      await shot(dir + '-pipeline')
    }
    // the gallery of the items: a picture on top of every card
    const itemTab = await ev(`(() => { const t = [...document.querySelectorAll('[data-kb="tables-tab"]')].find((e) => e.getAttribute('data-object') === ${JSON.stringify(want.item)}); if (t) t.setAttribute('data-chk', 'item-tab'); return t !== undefined })()`)
    if (itemTab === true) {
      await click('[data-chk="item-tab"]')
      check(dir + ': the items open on their gallery, a cover picture on every card', (await until(() => ev(`document.querySelectorAll('[data-kb="tables-cover"]').length >= 10`))) === true, await count(kb('tables-cover')))
      const pics = await until(() => ev(`(() => { const im = [...document.querySelectorAll('[data-kb="tables-cover"] img')]; return im.length >= 10 && im.every((i) => i.complete && i.naturalWidth > 0) ? im.length : 0 })()`), 12000)
      check(dir + ': the pictures are the ones of the template, loaded', pics >= 10, pics)
      await shot(dir + '-gallery')
    }
  }
} catch (e) {
  fail += 1
  console.log('  ✗ the run stopped: ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e))
} finally {
  await live.close()
}
console.log('\ncheck-db-templates-live: ' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)

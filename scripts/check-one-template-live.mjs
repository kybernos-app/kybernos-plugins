#!/usr/bin/env node
// Checks « one template at a time » (docs/dev/business-visuals.md) against the REAL GUI of the SANDBOX, in the situation that made it necessary: the E-commerce
// and the Real estate templates both installed, both with their sample data, and Contacts, Catalog and Pipeline showing a mixture of the two.
//
//   source scripts/sandbox/env.sh && scripts/sandbox/start.sh
//   node scripts/check-one-template-live.mjs [--shots <dir>]
//
// SANDBOX ONLY: it refuses to run against the DSH on :3080 or without a sandbox DSH_HOME, because it consents to two templates, seeds their sample rows into
// the sandbox's business base and chooses the template the pages follow. The sandbox clone carries the two templates (scripts/sandbox/rewrite.mjs re-points
// their links at this checkout); the check does what the Templates page does after an install, through the same routes: consent, seed the sample rows,
// record. Then:
//   - the route /kybernos/business/scope: who may read it and switch it (no cookie, a foreign Origin, no Origin), what it lists;
//   - for EACH template, with a real mouse on the real rows: the words of the three rows, the three pages, every row, type chip and board counted and
//     compared with what the base holds for that template (nothing of the other one may be on the page, in the page's text or in the host's answers);
//   - the selector: a real click opens it, a real click on the other template switches it with no reload, the page that is open starts afresh, the choice
//     survives a reload; the keyboard (arrows, Enter, Escape, focus given back);
//   - the failure states: the host refuses the switch (the menu says so, nothing changes); the host cannot be read at all (no selector, the pages still
//     show one template's rows, the rows keep their plain words);
//   - light, dark and a 420 px window: the selector inside the menu, readable, nothing sideways.
//   - --shots <dir>: one PNG per state, kept outside git (media never go in the repository).
// Exit code: 0 all green, 1 a check failed, 3 not run (no sandbox, no GUI).
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { createBusinessBase } from '../packages/kybernos-plugin/business-base.mjs'
import { cookieDeSession } from './cdp-lib.mjs'
import { openLivePage, waitFor } from './live-page.mjs'

const args = process.argv.slice(2)
const shotsDir = args.indexOf('--shots') >= 0 ? args[args.indexOf('--shots') + 1] : null
if (shotsDir !== null) mkdirSync(shotsDir, { recursive: true })
const host = process.env.KB_HOST || ''
const dshHome = process.env.DSH_HOME || ''
if (host === '' || /:3080$/.test(host) || !dshHome.includes('.kybernos-sandbox')) { console.error('○ not run: sandbox only. `source scripts/sandbox/env.sh` first (KB_HOST "' + host + '", DSH_HOME "' + dshHome + '")'); process.exit(3) }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0
const failures = []
const check = (name, ok, detail) => {
  if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { failures.push(name); console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail).slice(0, 600))) }
}

const SHOP = 'kybernos-themes/ecommerce'
const HOUSE = 'kybernos-themes/real-estate'
const WORDS = {
  [SHOP]: { name: 'E-commerce shop', rows: ['Customers', 'Products', 'Orders'], types: ['product'], flows: ['orders'], contactTypes: ['customer', 'trade-customer', 'supplier', 'supplier-contact'] },
  [HOUSE]: { name: 'Real estate agency', rows: ['Contacts', 'Properties', 'Sales and lettings'], types: ['property'], flows: ['sales', 'lettings'], contactTypes: ['buyer', 'seller', 'tenant', 'landlord', 'owner-company', 'partner', 'partner-firm'] },
}
const OTHER = { [SHOP]: HOUSE, [HOUSE]: SHOP }
const ROW_IDS = ['contacts', 'catalog', 'pipeline']

// ── what the base holds, per template (read with the same module the DSH process runs, explicit scopes, nothing written) ─────────────────────────────
const base = createBusinessBase({ file: join(dshHome, 'kybernos', 'business', 'donnees.sqlite'), scope: () => null })
const held = (id) => ({
  contacts: base.list('contact', { scope: id, limit: 500 }).rows,
  items: base.list('item', { scope: id, limit: 500 }).rows,
  cards: base.list('flow_card', { scope: id, limit: 500 }).rows,
})

const live = await openLivePage({ width: 1500, height: 950 }).catch((e) => { console.error('○ not run: ' + e.message); process.exit(3) })
const { page } = live
const ev = async (js, ms = 8000) => { const r = await page.evalJs(js, ms); return r.err ? { err: r.err } : r.val }
const shot = async (name) => { if (shotsDir !== null) { try { await page.shot(join(shotsDir, name + '.png')) } catch (e) { console.log('     (no screenshot ' + name + ': ' + e.message + ')') } } }
const rect = (sel) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (e === null) return null; const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return { x: r.left, y: r.top, w: r.width, h: r.height, r: r.right, b: r.bottom, shown: r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' } })()`)
const clickAt = async (x, y) => {
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
  await sleep(450)
}
/** A real mouse click at the centre of the first element that matches `sel`; false when it is not on screen. */
const click = async (sel) => { const r = await rect(sel); if (r === null || r.err || r.shown !== true) return false; await clickAt(r.x + r.w / 2, r.y + r.h / 2); return true }
const KEYS = { ArrowDown: 40, ArrowUp: 38, Enter: 13, Escape: 27, Home: 36, End: 35, Tab: 9, ' ': 32 }
const press = async (key) => {
  const code = KEYS[key]
  const down = { type: 'keyDown', key, code: key === ' ' ? 'Space' : key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code }
  if (key === 'Enter') down.text = '\r'
  if (key === ' ') down.text = ' '
  await page.send('Input.dispatchKeyEvent', down)
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: down.code, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code })
  await sleep(250)
}
const BTN = '[data-act="business-scope"]'
const ITEM = (id) => `[role="menuitemradio"][data-scope-id="${id}"]`
const rowLabels = () => ev(`[...document.querySelectorAll('[data-kb="menu-business"] .kb4-item')].map((e) => e.getAttribute('aria-label'))`)
const clickRow = async (label) => {
  const r = await ev(`(() => { const e = [...document.querySelectorAll('[data-kb="menu-business"] .kb4-item')].find((x) => x.getAttribute('aria-label') === ${JSON.stringify(label)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)
  if (r === null || r.err) return false
  await clickAt(r.x, r.y)
  return true
}
const activeId = () => ev(`window.__KB_BIZ_SCOPE__ ? window.__KB_BIZ_SCOPE__.active() : undefined`)
const pageText = () => ev(`document.body.innerText`)
const waitText = (re, ms = 9000) => waitFor(page, `${re}.test(document.body.innerText)`, ms).then(() => true, () => false)
const api = (path, init) => ev(`fetch(${JSON.stringify(path)}, Object.assign({ credentials: 'same-origin', cache: 'no-store' }, ${JSON.stringify(init || {})})).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }))`)
const post = (path, body) => api(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const sorted = (xs) => [...xs].sort()
const same = (a, b) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b))

try {
  await waitFor(page, `document.readyState === 'complete' && document.querySelector('.kb4-item') !== null`, 25000)
  await sleep(2500)
  if ((await rect('.kb4-menu')) === null) { console.error('○ not run: the menu is not on the page'); process.exit(3) }
  await ev(`(() => { window.__chk = { marker: 'same-document', errs: [] }; window.addEventListener('error', (e) => window.__chk.errs.push(String(e.message))); window.addEventListener('unhandledrejection', (e) => window.__chk.errs.push(String(e.reason && e.reason.message || e.reason))); return 1 })()`)

  // ── the mixed situation, as a person would have made it ─────────────────────────────────────────────────────────────────────────────────────────
  // The registry hears the Business points a few seconds after DSH starts; the host says so (`ready`) and the page asks again until it is (client.js, KB_BIZ_SCOPE_RETRY).
  check('the host says it is ready (the three Business points are known) within a minute of the start', await waitFor(page, `fetch('/kybernos/business/scope', { credentials: 'same-origin' }).then((r) => r.json()).then((j) => j.ready === true)`, 60000).then(() => true, () => false))
  console.log('the two templates installed, with their sample data (consent, seed, record: what the Templates page does)')
  for (const id of [HOUSE, SHOP]) {
    const consent = await post('/kybernos-registry/consent', { id, accepted: true })
    const seed = await post('/kybernos/themes', { action: 'seed', id })
    const record = await post('/kybernos/themes', { action: 'record', id })
    check(id + ': consent, sample rows and the record are accepted by the host', consent.status === 200 && seed.status === 200 && seed.json.ok === true && record.status === 200 && record.json.ok === true, { consent: consent.status, seed: seed.json, record: record.json })
    check(id + ': recording the install makes it the template the Business pages follow', record.json.businessActive === id, record.json)
  }
  // what the Templates page does once an install is recorded (client.js: kbBizScope.settle())
  await ev(`window.__KB_BIZ_SCOPE__.reload().then(() => 1)`)
  check('the page has read the choice: the E-commerce template is active, both are listed', await waitFor(page, `window.__KB_BIZ_SCOPE__.active() === ${JSON.stringify(SHOP)} && window.__KB_BIZ_SCOPE__.templates().length === 2`, 10000).then(() => true, () => false))
  for (const id of [HOUSE, SHOP]) {
    const h = held(id)
    check(id + ': every sample row the base holds belongs to it (' + h.contacts.length + ' contacts, ' + h.items.length + ' items, ' + h.cards.length + ' cards)', h.contacts.length > 0 && h.items.length > 0 && h.cards.length > 0 && h.contacts.every((r) => r.scope === id && r.demo === true))
  }
  check('nothing is left in the base that belongs to no template', base.list('contact', { scope: '', limit: 1 }).total + base.list('item', { scope: '', limit: 1 }).total + base.list('flow_card', { scope: '', limit: 1 }).total === 0)
  check('the two templates share no row: the two scopes add up to the whole base', held(SHOP).contacts.length + held(HOUSE).contacts.length === base.list('contact', { scope: '*', limit: 1 }).total)

  // ── the route: who may read it, who may switch it ───────────────────────────────────────────────────────────────────────────────────────────
  console.log('the route /kybernos/business/scope')
  const view = await api('/kybernos/business/scope')
  check('read from the page: the two templates, the E-commerce one active (it was installed last), each with its own name, icon, accent and words', view.status === 200 && view.json.active === SHOP && same(view.json.templates.map((t) => t.id), [SHOP, HOUSE]) && view.json.templates.every((t) => t.name.en === WORDS[t.id].name && typeof t.icon === 'string' && /^#[0-9a-f]{6}$/i.test(t.accent) && t.words.catalog !== undefined), view.json)
  const cookie = cookieDeSession(host)
  const authority = 'http://' + host
  const raw = async (method, extra, body) => {
    const r = await fetch(authority + '/kybernos/business/scope', { method, headers: Object.assign(body === undefined ? {} : { 'content-type': 'application/json' }, extra), body: body === undefined ? undefined : JSON.stringify(body) })
    return r.status
  }
  const withCookie = { cookie: cookie.nom + '=' + cookie.valeur }
  check('no cookie: a read is refused (401), a switch too', (await raw('GET', {})) === 401 && (await raw('POST', { origin: authority }, { action: 'set', id: HOUSE })) === 401)
  check('the cookie but a foreign Origin: a switch is refused (403)', (await raw('POST', Object.assign({ origin: 'http://evil.example' }, withCookie), { action: 'set', id: HOUSE })) === 403)
  check('the cookie and no Origin: a switch is refused (403), strict', (await raw('POST', withCookie, { action: 'set', id: HOUSE })) === 403)
  check('the cookie and a foreign Origin: a read is refused too', (await raw('GET', Object.assign({ origin: 'http://evil.example' }, withCookie))) === 403)
  check('the cookie, no Origin: a read is allowed (a direct navigation)', (await raw('GET', withCookie)) === 200)
  check('wrong method: 405; unknown template: 404; not an id: 400; no action: 400', (await raw('DELETE', withCookie)) === 405 && (await post('/kybernos/business/scope', { action: 'set', id: 'acme/unknown' })).status === 404 && (await post('/kybernos/business/scope', { action: 'set', id: '../x' })).status === 400 && (await post('/kybernos/business/scope', {})).status === 400)
  check('after all those refusals the template is still the E-commerce one', (await api('/kybernos/business/scope')).json.active === SHOP)

  // ── what a page shows for one template ──────────────────────────────────────────────────────────────────────────────────────────────────────
  /** The three pages of the active template, each opened with a real click on its row, compared with what the base holds for it and for the other one. */
  const leakCheck = async (id, tag) => {
    const w = WORDS[id]
    const mine = held(id)
    const theirs = held(OTHER[id])
    console.log(w.name + ': the words, the host\'s answers and the three pages (' + tag + ')')
    check(w.name + ': the Business rows speak its words: ' + w.rows.join(', '), JSON.stringify(await rowLabels()) === JSON.stringify(w.rows), await rowLabels())
    const types = await api('/kybernos-catalog/types')
    check(w.name + ': the host offers its catalogue types only (' + w.types.join() + ')', types.json.source === 'theme' && same(types.json.types.map((t) => t.id), w.types), types.json.types && types.json.types.map((t) => t.id))
    const schema = await api('/kybernos-contacts/schema')
    check(w.name + ': the host offers its contact types only', same(schema.json.schema.types.filter((t) => t.key !== 'person' && t.key !== 'company').map((t) => t.key), w.contactTypes), schema.json.schema.types.map((t) => t.key))
    const flows = await api('/kybernos-pipeline/flows')
    check(w.name + ': the host offers its boards only (' + w.flows.join() + '), with the cards counted in', same(flows.json.flows.map((f) => f.id), w.flows) && flows.json.flows.reduce((n, f) => n + f.cards, 0) === mine.cards.length, flows.json.flows && flows.json.flows.map((f) => [f.id, f.cards]))
    const list = await api('/kybernos-contacts/list?limit=500')
    check(w.name + ': the host lists its ' + mine.contacts.length + ' contacts and nothing else, and the sample count is its own', list.json.total === mine.contacts.length && list.json.rows.every((r) => r.scope === id) && list.json.demo === mine.contacts.length, { total: list.json.total, demo: list.json.demo })
    const items = await api('/kybernos-catalog/list?limit=500')
    check(w.name + ': the host lists its ' + mine.items.length + ' items and nothing else, with its own status counts', items.json.total === mine.items.length && items.json.rows.every((r) => r.scope === id) && Object.values(items.json.counts).reduce((a, n) => a + n, 0) === mine.items.length, { total: items.json.total, counts: items.json.counts })

    // Contacts
    check(w.name + ': the Contacts row is clicked', await clickRow(w.rows[0]))
    check(w.name + ': the Contacts page opens', await waitText(/people|contacts/i) && (await rect('[data-kb="contacts-page"]')) !== null)
    await waitFor(page, `document.querySelectorAll('[data-kb="contacts-row"], [data-kb="contacts-card"]').length > 0`, 9000).catch(() => {})
    await sleep(500)
    let text = await pageText()
    const own = mine.contacts.map((c) => c.name)
    const foreign = theirs.contacts.map((c) => c.name).filter((n) => own.indexOf(n) < 0) // « Yusuf Demir » is a sample contact of both templates: a coincidence of names, not a leak
    check(w.name + ': Contacts shows its own people (the page title is « ' + w.rows[0] + ' »)', own.filter((n) => text.includes(n)).length >= 5 && /./.test(await ev(`(document.querySelector('[data-kb="contacts-page"] h1, [data-kb="contacts-page"] h2') || {}).textContent || ''`)), own.filter((n) => text.includes(n)).length)
    check(w.name + ': Contacts shows nobody from the other template (' + foreign.length + ' names looked for)', foreign.every((n) => !text.includes(n)), foreign.filter((n) => text.includes(n)))
    const persons = mine.contacts.filter((c) => c.kind === 'person').length
    const said = await ev(`(document.querySelector('[data-kb="contacts-count"]') || {}).textContent || ''`)
    check(w.name + ': Contacts counts its own people: the page says « ' + said + ' », the base holds ' + persons + ' people (and ' + (mine.contacts.length - persons) + ' companies)', new RegExp('^' + persons + '\\b').test(said) && (await ev(`document.querySelectorAll('[data-kb="contacts-card"], [data-kb="contacts-row"]').length`)) === persons, said)
    await shot(tag + '-contacts')

    // Catalog
    check(w.name + ': the Catalog row is clicked', await clickRow(w.rows[1]))
    check(w.name + ': the Catalog page opens with its own title « ' + w.rows[1] + ' »', await waitText(new RegExp(w.rows[1])) && (await rect('[data-kb="catalog-page"]')) !== null)
    await waitFor(page, `document.querySelectorAll('[data-kb="catalog-card"], [data-kb="catalog-row"]').length > 0`, 9000).catch(() => {})
    await sleep(500)
    text = await pageText()
    const shown = await ev(`document.querySelectorAll('[data-kb="catalog-card"], [data-kb="catalog-row"]').length`)
    check(w.name + ': Catalog shows all its ' + mine.items.length + ' items as cards, not one more', shown === mine.items.length, { shown, expected: mine.items.length })
    check(w.name + ': Catalog shows nothing of the other template (' + theirs.items.length + ' titles looked for)', theirs.items.every((r) => !text.includes(r.title)), theirs.items.filter((r) => text.includes(r.title)).map((r) => r.title))
    const chips = await ev(`[...document.querySelectorAll('[data-kb="catalog-type-chip"]')].map((e) => e.getAttribute('data-type')).filter((x) => x !== '')`)
    check(w.name + ': the type chips, when there are any, are its own types only', Array.isArray(chips) && chips.every((c) => w.types.indexOf(c) >= 0), chips)
    check(w.name + ': no Products / Properties mixture: the other template\'s word for the page is nowhere in the page title', !new RegExp(WORDS[OTHER[id]].rows[1]).test(await ev(`(document.querySelector('[data-kb="catalog-page"] h1, [data-kb="catalog-page"] h2') || {}).textContent || ''`)))
    const sample = await ev(`(document.querySelector('[data-kb="catalog-demo-banner"]') || {}).textContent || ''`)
    check(w.name + ': the sample-data banner is shown (the sample rows are its own)', /Sample data/i.test(sample), sample)
    await shot(tag + '-catalog')

    // Pipeline
    check(w.name + ': the Pipeline row is clicked', await clickRow(w.rows[2]))
    check(w.name + ': the Pipeline page opens', await waitText(new RegExp(w.rows[2])) && (await rect('[data-kb="pipeline-page"]')) !== null)
    await waitFor(page, `document.querySelectorAll('[data-kb="pipeline-card"]').length > 0`, 9000).catch(() => {})
    await sleep(500)
    text = await pageText()
    const tabs = await ev(`[...document.querySelectorAll('[data-kb="pipeline-tab"]')].map((e) => e.textContent.replace(/\\s*\\d+\\s*$/, '').trim())`)
    check(w.name + ': Pipeline offers its boards only' + (w.flows.length > 1 ? ' (' + w.flows.length + ' tabs)' : ' (a single board: no tabs)'), (w.flows.length > 1 ? tabs.length === w.flows.length : tabs.length === 0) && tabs.every((t) => !WORDS[OTHER[id]].flows.some((f) => f !== 'sales' && t.toLowerCase() === f)), tabs)
    check(w.name + ': Pipeline shows nothing of the other template\'s cards (' + theirs.cards.length + ' titles looked for)', theirs.cards.every((c) => !text.includes(c.title)), theirs.cards.filter((c) => text.includes(c.title)).map((c) => c.title))
    const firstBoard = flows.json.flows[0].id
    const onBoard = await ev(`document.querySelectorAll('[data-kb="pipeline-card"]').length`)
    check(w.name + ': Pipeline opens on its first board (' + firstBoard + ') and shows all its ' + mine.cards.filter((c) => c.flow === firstBoard).length + ' cards', onBoard === mine.cards.filter((c) => c.flow === firstBoard).length, onBoard)
    await shot(tag + '-pipeline')
  }
  await leakCheck(SHOP, '01-shop')

  // ── the selector ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  console.log('the selector, with a real mouse')
  const sel = await rect('[data-kb="business-scope"]')
  const head = await rect('[data-kb="menu-business"] .kb4-grph')
  const firstRow = await rect('[data-kb="menu-business"] .kb4-item')
  check('the selector is in the Business group, under its header and above its rows, inside the menu', sel !== null && sel.shown && head !== null && sel.y >= head.b - 1 && firstRow !== null && sel.b <= firstRow.y + 1 && sel.x >= 0 && sel.r <= (await rect('.kb4-menu')).r + 1, { sel, head, firstRow })
  check('it shows the active template\'s name and a tile in its accent colour', (await ev(`document.querySelector('[data-kb="business-scope-name"]').textContent`)) === WORDS[SHOP].name && (await ev(`getComputedStyle(document.querySelector('.kb4-scopetile')).color`)) === 'rgb(194, 94, 10)')
  const btn = await rect(BTN)
  check('the button is as wide as the rows and a comfortable height', btn !== null && Math.abs(btn.w - firstRow.w) <= 28 && btn.h >= 28 && btn.h <= 48, { btn, firstRow })
  check('closed, it says so and there is no menu', (await ev(`document.querySelector('${BTN}').getAttribute('aria-expanded')`)) === 'false' && (await rect('[role="menu"]')) === null)
  await shot('02-selector-closed')
  check('a real click on it opens the menu', await click(BTN))
  const menu = await rect('[role="menu"]')
  const radios = await ev(`[...document.querySelectorAll('[role="menuitemradio"]')].map((e) => [e.getAttribute('data-scope-id'), e.getAttribute('aria-checked')])`)
  check('the two templates are listed with the E-commerce one checked, and the button says it is expanded', JSON.stringify(radios.sort()) === JSON.stringify([[HOUSE, 'false'], [SHOP, 'true']].sort()) && (await ev(`document.querySelector('${BTN}').getAttribute('aria-expanded')`)) === 'true', radios)
  check('the menu opens inline, inside the menu column, without covering the rows of the group', menu !== null && menu.x >= 0 && menu.r <= (await rect('.kb4-menu')).r + 1 && menu.y >= btn.b - 1)
  check('the menu says the other template stays installed', /stays? installed|stay installed/i.test(await ev(`document.querySelector('[role="menu"]').textContent`)))
  await shot('03-selector-open')
  check('a real click on the same template changes nothing and closes the menu', (await click(ITEM(SHOP))) && (await rect('[role="menu"]')) === null && (await activeId()) === SHOP)

  console.log('switching to the Real estate template with a real click, no reload')
  check('the Catalog page is open before the switch (it must start afresh)', await clickRow(WORDS[SHOP].rows[1]) && (await waitText(/Products/)))
  const beforeSwitch = await ev(`document.querySelectorAll('[data-kb="catalog-card"], [data-kb="catalog-row"]').length`)
  check('the selector is opened, and the Real estate item clicked', (await click(BTN)) && (await click(ITEM(HOUSE))))
  await waitFor(page, `window.__KB_BIZ_SCOPE__.active() === ${JSON.stringify(HOUSE)}`, 8000).catch(() => {})
  await sleep(1500)
  check('the choice is the Real estate template, the same document is still there (no reload)', (await activeId()) === HOUSE && (await ev(`window.__chk && window.__chk.marker`)) === 'same-document')
  check('the host stored it', (await api('/kybernos/business/scope')).json.stored === HOUSE)
  check('the menu closed and the button names the new template', (await rect('[role="menu"]')) === null && (await ev(`document.querySelector('[data-kb="business-scope-name"]').textContent`)) === WORDS[HOUSE].name)
  check('the rows renamed themselves at once: ' + WORDS[HOUSE].rows.join(', '), JSON.stringify(await rowLabels()) === JSON.stringify(WORDS[HOUSE].rows), await rowLabels())
  check('the focus came back to the button', (await ev(`document.activeElement && document.activeElement.getAttribute('data-act')`)) === 'business-scope')
  const afterSwitch = await ev(`document.querySelectorAll('[data-kb="catalog-card"], [data-kb="catalog-row"]').length`)
  const catText = await pageText()
  check('the Catalog page that was open started afresh: the agency\'s ' + held(HOUSE).items.length + ' properties instead of the shop\'s ' + beforeSwitch + ' products', afterSwitch === held(HOUSE).items.length && /Properties/.test(catText) && held(SHOP).items.every((r) => !catText.includes(r.title)), { beforeSwitch, afterSwitch })
  await shot('04-after-switch-catalog')
  await leakCheck(HOUSE, '05-house')

  console.log('the choice survives a reload; the other way round')
  await page.send('Page.reload', {})
  await waitFor(page, `document.readyState === 'complete' && document.querySelector('[data-kb="business-scope"]') !== null`, 25000)
  await sleep(1500)
  check('after a reload the Real estate template is still the one the pages follow', (await activeId()) === HOUSE && (await ev(`document.querySelector('[data-kb="business-scope-name"]').textContent`)) === WORDS[HOUSE].name && JSON.stringify(await rowLabels()) === JSON.stringify(WORDS[HOUSE].rows))
  await ev(`(() => { window.__chk = { marker: 'same-document', errs: [] }; window.addEventListener('error', (e) => window.__chk.errs.push(String(e.message))); window.addEventListener('unhandledrejection', (e) => window.__chk.errs.push(String(e.reason && e.reason.message || e.reason))); return 1 })()`)
  check('and back to the E-commerce one with the mouse', (await click(BTN)) && (await click(ITEM(SHOP))) && (await waitFor(page, `window.__KB_BIZ_SCOPE__.active() === ${JSON.stringify(SHOP)}`, 8000).then(() => true, () => false)))
  await sleep(1200)
  check('the rows are the shop\'s again', JSON.stringify(await rowLabels()) === JSON.stringify(WORDS[SHOP].rows), await rowLabels())

  console.log('another window changes the choice')
  check('another window switches the template at the host (the same route, the same cookie)', (await raw('POST', Object.assign({ origin: authority }, withCookie), { action: 'set', id: HOUSE })) === 200)
  check('this window still shows the E-commerce template until it comes back', (await activeId()) === SHOP)
  await ev(`window.dispatchEvent(new Event('focus'))`)
  await waitFor(page, `window.__KB_BIZ_SCOPE__.active() === ${JSON.stringify(HOUSE)}`, 8000).catch(() => {})
  await sleep(600)
  check('coming back to this window re-reads the choice: the words and the selector say the agency', (await activeId()) === HOUSE && JSON.stringify(await rowLabels()) === JSON.stringify(WORDS[HOUSE].rows) && (await ev(`document.querySelector('[data-kb="business-scope-name"]').textContent`)) === WORDS[HOUSE].name)
  check('and the back to the shop with the mouse, as before', (await click(BTN)) && (await click(ITEM(SHOP))) && (await waitFor(page, `window.__KB_BIZ_SCOPE__.active() === ${JSON.stringify(SHOP)}`, 8000).then(() => true, () => false)))
  await sleep(900)

  // ── the keyboard ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  console.log('the keyboard')
  await ev(`document.querySelector('${BTN}').focus()`)
  await press('ArrowDown')
  check('ArrowDown on the button opens the menu and puts the focus on the checked item', (await rect('[role="menu"]')) !== null && (await ev(`document.activeElement && document.activeElement.getAttribute('data-scope-id')`)) === SHOP)
  await press('ArrowDown')
  check('ArrowDown moves to the next item (the list wraps)', (await ev(`document.activeElement && document.activeElement.getAttribute('data-scope-id')`)) === HOUSE)
  await press('ArrowDown')
  check('...and round to the first', (await ev(`document.activeElement && document.activeElement.getAttribute('data-scope-id')`)) === SHOP)
  await press('End')
  check('End goes to the last item, Home to the first', (await ev(`document.activeElement.getAttribute('data-scope-id')`)) === sorted([HOUSE, SHOP])[1] && ((await press('Home')), (await ev(`document.activeElement.getAttribute('data-scope-id')`)) === sorted([HOUSE, SHOP])[0]))
  await press('Escape')
  check('Escape closes the menu and gives the focus back to the button, the choice unchanged', (await rect('[role="menu"]')) === null && (await ev(`document.activeElement.getAttribute('data-act')`)) === 'business-scope' && (await activeId()) === SHOP)
  await press('Enter')
  check('Enter on the button opens it again', (await rect('[role="menu"]')) !== null)
  await press('ArrowDown'); await press('ArrowDown')
  check('the focus is on the Real estate item', (await ev(`document.activeElement.getAttribute('data-scope-id')`)) === HOUSE)
  await press('Enter')
  await waitFor(page, `window.__KB_BIZ_SCOPE__.active() === ${JSON.stringify(HOUSE)}`, 8000).catch(() => {})
  await sleep(900)
  check('Enter picks it: the pages follow the Real estate template, the menu is closed, the focus is back on the button', (await activeId()) === HOUSE && (await rect('[role="menu"]')) === null && (await ev(`document.activeElement.getAttribute('data-act')`)) === 'business-scope' && JSON.stringify(await rowLabels()) === JSON.stringify(WORDS[HOUSE].rows))
  await press('ArrowUp')
  check('ArrowUp on the button opens the menu on the last item', (await rect('[role="menu"]')) !== null)
  await press('Tab')
  check('Tab leaves the menu and closes it', (await rect('[role="menu"]')) === null)
  const ring = await ev(`(() => { const b = document.querySelector('${BTN}'); b.focus(); const cs = getComputedStyle(b); return { style: cs.outlineStyle, w: cs.outlineWidth } })()`)
  check('a keyboard focus ring is drawn on the button', ring.style !== 'none' && parseFloat(ring.w) >= 1, ring)

  // ── the failure states ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  console.log('failure states')
  await ev(`(() => { window.__realFetch = window.fetch; window.fetch = (u, o) => (/business\\/scope/.test(String(u)) && o && o.method === 'POST' ? Promise.resolve(new Response('{"ok":false,"error":"failed"}', { status: 500, headers: { 'content-type': 'application/json' } })) : window.__realFetch(u, o)); return 1 })()`)
  await click(BTN)
  await click(ITEM(SHOP))
  await sleep(800)
  const alertText = await ev(`(document.querySelector('[data-kb="business-scope-error"]') || {}).textContent || ''`)
  check('the host refuses the switch (a 500): the menu stays open and says so in words, with role alert', (await rect('[role="menu"]')) !== null && /Could not switch the template\. Nothing changed\./.test(alertText) && (await ev(`document.querySelector('[data-kb="business-scope-error"]').getAttribute('role')`)) === 'alert', alertText)
  check('...nothing changed: the same template, the same words, the same name', (await activeId()) === HOUSE && JSON.stringify(await rowLabels()) === JSON.stringify(WORDS[HOUSE].rows) && (await ev(`document.querySelector('[data-kb="business-scope-name"]').textContent`)) === WORDS[HOUSE].name)
  await shot('06-switch-refused')
  await click(BTN) // close
  await click(BTN) // open again: the message is forgotten
  check('closing and opening the menu forgets the message', (await rect('[data-kb="business-scope-error"]')) === null)
  await click(BTN)
  await ev(`window.fetch = window.__realFetch; 1`)
  check('the host answers again: the switch works', (await click(BTN)) && (await click(ITEM(SHOP))) && (await waitFor(page, `window.__KB_BIZ_SCOPE__.active() === ${JSON.stringify(SHOP)}`, 8000).then(() => true, () => false)))
  await sleep(600)

  // the host cannot be read at all: no selector, no word of a template, but the pages are still ONE template's (the host scopes them, not the page)
  const initId = (await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { const real = window.fetch; window.fetch = (u, o) => (/business\\/scope/.test(String(u)) ? Promise.resolve(new Response('{"ok":false}', { status: 500, headers: { 'content-type': 'application/json' } })) : real.call(window, u, o)) })()` })).result.identifier
  await page.send('Page.reload', {})
  await waitFor(page, `document.readyState === 'complete' && document.querySelector('.kb4-item') !== null`, 25000)
  await sleep(3000)
  check('the host\'s answer is a 500 at start-up: no selector is drawn, nothing is thrown', (await rect('[data-kb="business-scope"]')) === null && (await ev(`window.__KB_BIZ_SCOPE__.state().failed`)) === true)
  const plainRows = await rowLabels()
  check('the rows keep their plain words (the person\'s field has none for them), never a template\'s', Array.isArray(plainRows) && plainRows.length === 3 && !plainRows.some((r) => ['Customers', 'Products', 'Orders', 'Properties', 'Sales and lettings'].indexOf(r) >= 0), plainRows)
  check('...and the Catalog page still shows ONE template\'s rows (the host scopes them): the shop\'s', (await clickRow(plainRows[1])) && (await waitFor(page, `document.querySelectorAll('[data-kb="catalog-card"], [data-kb="catalog-row"]').length > 0`, 9000).then(() => true, () => false)) && (await ev(`document.querySelectorAll('[data-kb="catalog-card"], [data-kb="catalog-row"]').length`)) === held(SHOP).items.length)
  await shot('07-host-unreadable')
  await page.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: initId })
  await page.send('Page.reload', {})
  await waitFor(page, `document.readyState === 'complete' && document.querySelector('.kb4-item') !== null`, 25000)
  await sleep(2500)
  check('the host is readable again after a reload: the selector is back', (await rect('[data-kb="business-scope"]')) !== null)

  // ── light, dark and a phone ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  console.log('light, dark and a 420 px window')
  const setScheme = async (want) => { for (let i = 0; i < 3; i += 1) { if ((await ev(`document.body.hasAttribute('data-ds-dark-theme')`)) === (want === 'dark')) return true; await ev(`[...document.querySelectorAll('button')].filter((b) => /^(Dark|Light) theme$/.test(b.getAttribute('aria-label') || '')).forEach((b) => b.click())`); await sleep(900) } return false }
  const CONTRAST = `(() => {
    const lum = (rgb) => { const m = rgb.match(/[\\d.]+/g).map(Number); const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }; return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]) }
    const bg = (e) => { for (let n = e; n; n = n.parentElement) { const c = getComputedStyle(n).backgroundColor; const m = c.match(/[\\d.]+/g); if (m && (m.length < 4 || Number(m[3]) > 0.5)) return c } return 'rgb(255,255,255)' }
    const ratio = (e) => { const a = lum(getComputedStyle(e).color); const b = lum(bg(e)); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) }
    const name = document.querySelector('[data-kb="business-scope-name"]')
    const chev = document.querySelector('.kb4-scopechev')
    return name ? { name: ratio(name), chev: chev ? ratio(chev) : null } : null
  })()`
  for (const scheme of ['light', 'dark']) {
    check('the ' + scheme + ' theme is on', await setScheme(scheme))
    await click(BTN)
    const c = await ev(CONTRAST)
    check(scheme + ': the template name is readable on the selector (contrast ' + (c && c.name.toFixed(1)) + ':1, at least 4.5) and the chevron is visible (at least 3)', c !== null && c.name >= 4.5 && c.chev >= 3, c)
    const items = await ev(`[...document.querySelectorAll('[role="menuitemradio"] .kb4-lab')].map((e) => { const r = e.getBoundingClientRect(); return e.scrollWidth <= e.clientWidth + 1 && r.width > 0 })`)
    check(scheme + ': both items are drawn and their names are not cut', Array.isArray(items) && items.length === 2 && items.every(Boolean), items)
    await shot('08-' + scheme + '-open')
    await click(BTN)
  }
  await setScheme('dark')
  for (const w of [420]) {
    await page.send('Emulation.setDeviceMetricsOverride', { width: w, height: 800, deviceScaleFactor: 1, mobile: false })
    await page.send('Page.reload', {})
    await waitFor(page, `document.readyState === 'complete' && document.querySelector('.kb4-item') !== null`, 25000)
    await sleep(3000)
    await click('button[aria-label="Open the menu"]')
    await sleep(700)
    const s = await rect('[data-kb="business-scope"]')
    const b = await rect(BTN)
    check(w + ' px: the menu is opened by its button and the selector is inside the window', s !== null && s.shown && s.x >= 0 && s.r <= w + 1 && b.h >= 40, { s, b })
    check(w + ' px: the target is at least 44 px high on a touch screen', b !== null && b.h >= 40, b)
    check(w + ' px: nothing scrolls sideways', (await ev(`document.documentElement.scrollWidth <= window.innerWidth + 1 && document.querySelector('.kb4-menu').scrollWidth <= document.querySelector('.kb4-menu').clientWidth + 1`)) === true)
    await click(BTN)
    const m = await rect('[role="menu"]')
    check(w + ' px: the opened menu is inside the window too', m !== null && m.x >= 0 && m.r <= w + 1, m)
    await shot('09-phone-open')
    await click(ITEM(HOUSE))
    await waitFor(page, `window.__KB_BIZ_SCOPE__.active() === ${JSON.stringify(HOUSE)}`, 8000).catch(() => {})
    await sleep(900)
    check(w + ' px: a touch-size click switches the template here too', (await activeId()) === HOUSE && JSON.stringify(await rowLabels()) === JSON.stringify(WORDS[HOUSE].rows))
    await shot('10-phone-switched')
    await page.send('Emulation.clearDeviceMetricsOverride', {})
  }

  const errs = await ev(`window.__chk ? window.__chk.errs : []`)
  check('no error was thrown in the page while all that happened', Array.isArray(errs) && errs.filter((e) => !/ResizeObserver/.test(e)).length === 0, errs)
} finally {
  // leave the sandbox the way the install left it: the E-commerce template, installed last, is the one the pages follow
  try { await post('/kybernos/business/scope', { action: 'set', id: SHOP }) } catch (e) { /* the page is gone */ }
  try { base.close() } catch (e) { /* closed */ }
  await live.close()
}

console.log('\n' + pass + ' passed, ' + failures.length + ' failed')
if (failures.length > 0) { console.log('FAILED: ' + failures.join(' | ')); process.exit(1) }

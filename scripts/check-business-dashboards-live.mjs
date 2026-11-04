#!/usr/bin/env node
// The dashboards the sector templates ship (kybernos/dashboards#preset), on the REAL GUI of a SANDBOX: the three templates (E-commerce, Real estate, Recruitment) installed from
// THIS checkout with their sample rows, the Presets gallery that lists their dashboards with the template's name on each card, the dashboards drawn from the real routes of
// Tables (the database each template makes). There is no Overview row in the menu any more: the first template's dashboard is made from the gallery with a real click. Everything is measured; nothing is taken on trust.
//
//   source scripts/sandbox/env.sh && scripts/sandbox/start.sh && node scripts/check-business-dashboards-live.mjs [--shots <dir>]
//
// What it checks, in a real page:
//   1. the three templates are `ok` in the registry once the Dashboards plugin has told its point, and their databases (Tables) hold the sample rows;
//   2. the Presets gallery lists the three template dashboards first, each with its template's name, and using one makes the person's own copy;
//   3. the menu holds no Overview row and no Business group; a click on « Use this preset » makes the first template's copy once and opens it;
//   4. each dashboard: every widget drawn (none empty, none on its error state), no horizontal overflow, no clipped number or title, no console error,
//      the numbers on nine cards equal to a direct count of the rows of the template's own database (Tables);
//   5. light and dark, 1500 px and 420 px: one screenshot of each (--shots), the page height fitted to the dashboard.
//
// SANDBOX ONLY (exit 3 against :3080, and without a sandbox DSH_HOME): it links the templates into the sandbox profile, accepts their consent and seeds their sample rows.
// The profile of a sandbox is a clone of the owner's, where the Dashboards module is switched OFF (`disabled: true` in cordis.patch.yml): this check does not switch it on, it
// says so (exit 3). Nothing is sent to a model. Exit 0 all green, 1 a check failed, 3 not run.
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as M from '../packages/kybernos-dashboards/model.mjs'
import { openLivePage, waitFor } from './live-page.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const WORKTREE = join(here, '..')
const args = process.argv.slice(2)
const shotsDir = args.indexOf('--shots') >= 0 ? args[args.indexOf('--shots') + 1] : null
const host = process.env.KB_HOST || ''
const dshHome = process.env.DSH_HOME || ''
if (host === '' || /:3080$/.test(host) || !dshHome.includes('.kybernos-sandbox')) { console.error('○ not run: sandbox only. `source scripts/sandbox/env.sh` first (KB_HOST "' + host + '", DSH_HOME "' + dshHome + '")'); process.exit(3) }
if (shotsDir !== null) mkdirSync(shotsDir, { recursive: true })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0
const failures = []
const check = (name, ok, detail) => {
  if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { failures.push(name); console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail).slice(0, 600))) }
}

// ── the sandbox profile: the three templates of this checkout, linked the way DSH's manager links a folder ──────────────────────────────
const THEMES = ['ecommerce', 'real-estate', 'recruitment']
const profileDir = join(dshHome, 'profiles', 'web')
function linkTemplates () {
  const file = join(profileDir, 'package.json')
  const pkg = JSON.parse(readFileSync(file, 'utf8'))
  const store = join(profileDir, 'node_modules', '@kybernos-themes')
  mkdirSync(store, { recursive: true })
  for (const dir of THEMES) {
    const name = '@kybernos-themes/' + dir
    const target = join(WORKTREE, 'packages', 'kybernos-plugin', 'themes', dir)
    pkg.dependencies[name] = 'link:' + target
    if (!pkg.dsh.profile.bundles.includes(name)) pkg.dsh.profile.bundles.push(name)
    const at = join(store, dir)
    try { lstatSync(at); rmSync(at, { force: true }) } catch (e) { /* not there yet */ }
    symlinkSync(relative(store, target), at)
  }
  writeFileSync(file + '.tmp', JSON.stringify(pkg, null, 2) + '\n')
  renameSync(file + '.tmp', file)
}
linkTemplates()
// a clean slate for the person's own dashboards (the sandbox's, never the real ones: the guard above): every run makes its copies from the gallery again
rmSync(join(dshHome, 'kybernos', 'dashboards'), { recursive: true, force: true })

// ── the page ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const live = await openLivePage({ width: 1500, height: 1000 }).catch((e) => { console.error('○ not run: ' + e.message); process.exit(3) })
const { page } = live
await page.send('Runtime.enable', {})
const val = async (expr, ms) => { const r = await page.evalJs(expr, ms || 10000); if (r.err !== undefined) throw new Error(r.err.slice(0, 300)); return r.val }
const api = (path, body) => val(`fetch(${JSON.stringify(path)}, ${body === undefined ? '{}' : `{ method: 'POST', headers: { 'content-type': 'application/json' }, body: ${JSON.stringify(JSON.stringify(body))} }`}).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }))`)
const poll = async (fn, ms = 15000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) return v; await sleep(250) } }
const mouse = async (x, y) => { await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }); await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }); await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }) }
/** A real mouse press at the middle of the first element matching the selector (scrolled into view first). false when there is none or it has no size. */
const press = async (selector, textRe) => {
  const pos = await val(`(() => { const all = Array.from(document.querySelectorAll(${JSON.stringify(selector)})).filter((e) => ${textRe === undefined ? 'true' : `new RegExp(${JSON.stringify(textRe)}).test(e.textContent)`}); const e = all[0]; if (!e) return null; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 ? JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 }) : null })()`)
  if (typeof pos !== 'string') return false
  await sleep(150)
  const again = await val(`(() => { const all = Array.from(document.querySelectorAll(${JSON.stringify(selector)})).filter((e) => ${textRe === undefined ? 'true' : `new RegExp(${JSON.stringify(textRe)}).test(e.textContent)`}); const r = all[0].getBoundingClientRect(); return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 }) })()`)
  const { x, y } = JSON.parse(again)
  await mouse(x, y)
  return true
}
const setViewport = async (width, height) => page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
const clearViewport = async () => page.send('Emulation.clearDeviceMetricsOverride', {})
/** The page's own scroller around the dashboard, grown so the whole dashboard is in the picture. */
const fitShot = async (name, selector) => {
  if (shotsDir === null) return
  try {
    const need = await val(`(() => { const root = document.querySelector(${JSON.stringify(selector)}); if (!root) return 0; let s = root; while (s && s !== document.body) { const cs = getComputedStyle(s); if (/(auto|scroll)/.test(cs.overflowY) && s.scrollHeight > s.clientHeight + 4) break; s = s.parentElement } const top = (s && s !== document.body ? s.getBoundingClientRect().top : 0); return Math.ceil(Math.max(root.getBoundingClientRect().height + root.getBoundingClientRect().top + 40, (s && s !== document.body ? s.scrollHeight : 0) + top + 8)) })()`)
    const width = await val('window.innerWidth')
    if (need > 0) { await setViewport(width, Math.min(Math.max(need, 700), 4200)); await sleep(900); await settle(); await sleep(300) }
    await page.shot(join(shotsDir, name + '.png'))
  } catch (e) { console.log('     (no screenshot ' + name + ': ' + e.message + ')') } finally { await setViewport(await val('window.innerWidth'), 1000).catch(() => null) }
}
/** The entrance animations are over (charts draw themselves, cards count up): a picture taken before shows half a chart. The endless ones (the dot that breathes) are left out. */
const settle = async () => poll(() => val(`document.getAnimations().filter((a) => { const t = a.effect && a.effect.getComputedTiming ? a.effect.getComputedTiming() : null; return a.playState === 'running' && t !== null && t.iterations !== Infinity }).length === 0`), 9000)
const theme = async (dark) => {
  const now = await val(`document.documentElement.getAttribute('data-kb-theme') || (document.body.hasAttribute('data-ds-dark-theme') ? 'dark' : 'light')`)
  if ((now === 'dark') === dark) return true
  await val(`(() => { const b = Array.from(document.querySelectorAll('button')).find((x) => ${dark ? "x.getAttribute('title') === 'Dark theme' || x.getAttribute('aria-label') === 'Dark theme'" : "x.getAttribute('title') === 'Light theme' || x.getAttribute('aria-label') === 'Light theme'"}); if (b) b.click(); return !!b })()`)
  await sleep(900)
  const after = await val(`document.documentElement.getAttribute('data-kb-theme') || (document.body.hasAttribute('data-ds-dark-theme') ? 'dark' : 'light')`)
  return (after === 'dark') === dark
}
// The menu has no Dashboards row any more (folded into Creations while the plugin is a source of its registry): the page opens through the door other bundles use.
const openDashboards = async () => {
  await val(`(() => { if (window.__KB_OPEN__) { window.__KB_OPEN__({ view: 'dashboards' }); return true } const b = Array.from(document.querySelectorAll('.kb4-menu .kb4-item')).find((x) => (x.querySelector('.kb4-lab') || {}).textContent === 'Dashboards'); if (b) b.click(); return !!b })()`)
  return (await poll(() => val(`!!document.querySelector('[data-kb="dashboards-page"]')`), 15000)) === true
}

try {
  // the first reply of the GUI: DSH asks for a key on a fresh instance; the helper presses it away
  await sleep(2500)

  console.log('── 1. the templates, the point, the sample rows ──')
  const list0 = await api('/kybernos-dashboards/list')
  if (list0.status !== 200) {
    console.error('○ not run: the Dashboards module is not loaded in this sandbox (GET /kybernos-dashboards/list answers ' + list0.status + '). The sandbox profile is a clone of the owner\'s, where Dashboards is switched off: remove its `disabled: true` entry from ' + join(profileDir, 'cordis.patch.yml') + ' and restart the sandbox.')
    await live.close(); process.exit(3)
  }
  await sleep(1500)
  for (const dir of THEMES) await api('/kybernos-registry/consent', { id: 'kybernos-themes/' + dir, accepted: true })
  const tables = await api('/kybernos-db/state')
  if (tables.status !== 200) {
    console.error('○ not run: the Tables module is not loaded in this sandbox (GET /kybernos-db/state answers ' + tables.status + '). Switch it on in the sandbox profile and restart it.')
    await live.close(); process.exit(3)
  }
  const seeds = []
  for (const dir of THEMES) seeds.push((await api('/kybernos/themes', { action: 'seed', id: 'kybernos-themes/' + dir })).body)
  check('the three templates are seeded into Tables, one database each', seeds.every((x) => x.ok === true && typeof x.db === 'string' && x.db !== ''), seeds)
  const registry = await poll(async () => { const r = await api('/kybernos-registry/state?fresh=1'); const mine = r.body && r.body.plugins ? r.body.plugins.filter((p) => p.id.startsWith('kybernos-themes/')) : []; return mine.length === 3 && mine.every((p) => p.status === 'ok') ? mine : null }, 30000)
  check('the three templates are ok in the registry (the Dashboards plugin told its point)', registry !== null && registry.every((p) => p.extends.some((e) => e.point === 'kybernos/dashboards#preset' && e.contributions === 1 && e.rejected.length === 0)), registry)

  // the rows of each template's database, read from the Tables routes the dashboards read
  const state = (await api('/kybernos-db/state')).body
  const dbOf = (template) => (state.dbs || []).find((d) => d.template === template)
  const rows = async (template, object) => { const d = dbOf(template); const r = d === undefined ? null : (await api('/kybernos-db/records?db=' + encodeURIComponent(d.id) + '&object=' + object)).body; return r !== null && r.ok === true ? r.records.map((x) => x.values) : [] }
  const DB = {}
  for (const [template, objects] of Object.entries({ ecommerce: ['contact', 'product', 'orders'], 'real-estate': ['contact', 'property', 'lettings', 'sales'], recruitment: ['contact', 'job', 'candidates', 'missions'] })) for (const o of objects) DB[template + '/' + o] = await rows(template, o)
  const total = (objectKeys) => Object.entries(DB).filter(([k]) => objectKeys.includes(k.split('/')[1])).reduce((n, [, v]) => n + v.length, 0)
  check('the sample rows of the three templates are in their databases', total(['product', 'property', 'job']) === 46 && total(['orders', 'lettings', 'sales', 'candidates', 'missions']) === 56 && total(['contact']) === 71, [total(['product', 'property', 'job']), total(['orders', 'lettings', 'sales', 'candidates', 'missions']), total(['contact'])])

  // Every installed template offers its dashboard (the pages follow no "active" template any more).
  const NAMES = { ecommerce: 'E-commerce shop', 'real-estate': 'Real estate agency', recruitment: 'Recruitment firm' }
  const presets = (await api('/kybernos-dashboards/presets')).body.presets
  check('the gallery lists the three templates\' dashboards first, each with its template\'s name, then the built-in ones', THEMES.every((dir) => presets.some((p) => p.id === dir + '-overview' && p.template.name === NAMES[dir])) && presets.slice(0, 3).every((p) => p.template !== undefined) && presets.slice(3).every((p) => p.template === undefined), presets.map((p) => [p.id, p.template && p.template.name]))
  const FIRST = presets[0].id
  const OTHERS = THEMES.map((dir) => dir + '-overview').filter((id) => id !== FIRST)


  console.log('\n── 2. the Presets gallery ──')
  check('the Dashboards page opens (through the core\'s door: the menu row is folded into Creations)', await openDashboards())
  await poll(() => val(`document.querySelectorAll('[data-kb="dashboards-preset"]').length >= 3`), 15000)
  const gallery = await val(`(() => { const cards = Array.from(document.querySelectorAll('[data-kb="dashboards-preset"]')); return { n: cards.length, first: cards.slice(0, 3).map((c) => ({ id: c.getAttribute('data-id'), tpl: (c.querySelector('[data-kb="preset-template"]') || {}).textContent || null, name: (c.querySelector('h3') || {}).textContent, btn: !!c.querySelector('[data-act="use-preset"]'), clipped: Array.from(c.querySelectorAll('h3, p, .kbdb-pill')).filter((e) => e.scrollWidth > e.clientWidth + 1).length })), others: cards.filter((c) => c.querySelector('[data-kb="preset-template"]')).length } })()`)
  check('the gallery shows the three templates\' dashboards first, each card with a pill naming its template and a button', gallery.n >= 9 && gallery.first.map((c) => c.tpl).sort().join() === Object.values(NAMES).sort().join() && gallery.first.every((c) => c.btn) && gallery.others === 3, gallery)
  check('and nothing on those cards is clipped', gallery.first.every((c) => c.clipped === 0), gallery.first)
  await val(`window.scrollTo(0, 0)`)
  for (const dark of [false, true]) {
    await theme(dark)
    await poll(() => val(`!!document.querySelector('[data-kb="dashboards-preset"]')`), 8000)
    await val(`(() => { const c = document.querySelector('[data-kb="dashboards-preset"]'); if (c) c.scrollIntoView({ block: 'start' }) })()`)
    await fitShot('gallery-' + (dark ? 'dark' : 'light') + '-1500', '[data-kb="dashboards-page"]')
  }
  await theme(false)

  // the other two templates' dashboards: each is made active in turn and copied through the host (section 3 makes the first one's copy with a real click)
  for (const id of OTHERS) {
    const before = (await api('/kybernos-dashboards/list')).body.dashboards.length
    const made = await api('/kybernos-dashboards/preset', { preset: id })
    const after = (await api('/kybernos-dashboards/list')).body.dashboards
    check('using ' + id + ' makes the person\'s own copy, remembering where it came from', made.status === 200 && after.length === before + 1 && after.some((d) => d.id === id && d.preset === id), [made, after.map((d) => [d.id, d.preset])])
  }

  console.log('\n── 3. no Overview row; the gallery makes the first copy ──')
  const menuLabels = await val(`Array.from(document.querySelectorAll('.kb4-menu .kb4-item')).map((b) => b.getAttribute('aria-label'))`)
  check('the menu has no Overview row and no Business group', Array.isArray(menuLabels) && !menuLabels.includes('Overview') && (await val(`document.querySelector('[data-kb="menu-business"]') === null`)) === true, menuLabels)
  check('« Use this preset » on the first template\'s card is a real click away', await press('[data-kb="dashboards-preset"][data-id="' + FIRST + '"] [data-act="use-preset"]'))
  const opened = await poll(() => val(`(() => { const p = document.querySelector('[data-kb="dashboards-page"][data-screen="dash"]'); return !!p && !!document.querySelector('.kbdb-w') })()`), 20000)
  check('it opens the dashboard drawn from the template\'s database', opened === true)
  const listed = (await api('/kybernos-dashboards/list')).body.dashboards
  check('the copy was made once and is the preset\'s own id', listed.filter((d) => d.preset === FIRST).length === 1 && listed.some((d) => d.id === FIRST), listed.map((d) => [d.id, d.preset]))
  check('the crumb leaves for the gallery', await press('[data-kb="crumb-gallery"]') && (await poll(() => val(`!!document.querySelector('[data-kb="dashboards-preset"]')`), 8000)) === true)

  console.log('\n── 4. the dashboards ──')
  const DASH = [
    { id: 'ecommerce-overview', name: 'Shop overview', widgets: 10 },
    { id: 'real-estate-overview', name: 'Agency overview', widgets: 9 },
    { id: 'recruitment-overview', name: 'Desk overview', widgets: 9 },
  ]
  // the numbers, counted straight from the rows of each template's database
  const sum = (xs) => xs.reduce((a, b) => a + b, 0)
  const num = (v, fmt, unit) => M.formatNumber(v, fmt) + (unit ? ' ' + unit : '')
  const T = (key) => DB[key]
  const isIn = (v, list) => list.includes(v)
  const paid = T('ecommerce/orders').filter((r) => isIn(r.stage, ['paid', 'packed', 'shipped', 'delivered']))
  const lowStock = T('ecommerce/product').filter((r) => typeof r.stock === 'number' && typeof r.reorder_at === 'number' && r.stock <= r.reorder_at && r.status !== 'draft')
  const sales = T('real-estate/sales').filter((r) => r.stage !== 'closed')
  const EXPECT = {
    'ecommerce-overview': { 'Revenue, paid orders': num(sum(paid.map((r) => r.value || 0)), 'number', '€'), 'Orders to ship': num(T('ecommerce/orders').filter((r) => isIn(r.stage, ['paid', 'packed'])).length), 'Low stock': num(lowStock.length) },
    'real-estate-overview': { 'Active listings': num(T('real-estate/property').filter((r) => isIn(r.status, ['for-sale', 'to-let', 'under-offer'])).length), 'Open sales value': num(sum(sales.map((r) => r.value || 0)), 'compact', '€'), 'Sales viewings to run': num(T('real-estate/sales').filter((r) => r.stage === 'viewing').length) },
    'recruitment-overview': { 'Open jobs': num(T('recruitment/job').filter((r) => r.status === 'open').length), 'Candidates in play': num(T('recruitment/candidates').filter((r) => r.stage !== 'placed').length), 'Candidates placed': num(T('recruitment/candidates').filter((r) => r.stage === 'placed').length) },
  }
  const open = async (id) => {
    await val(`window.__KB_DASHBOARDS__.open(${JSON.stringify(id)})`)
    return (await poll(() => val(`(() => { const p = document.querySelector('[data-kb="dashboards-page"][data-screen="dash"]'); return !!p && !!document.querySelector('.kbdb-w') })()`), 20000)) === true
  }
  const measure = () => val(`(() => {
    const ws = Array.from(document.querySelectorAll('[data-kb="dashboards-page"] .kbdb-w'))
    const clipped = (e) => e.scrollWidth > e.clientWidth + 1
    return JSON.stringify({
      n: ws.length,
      loading: document.querySelectorAll('[data-kb="dashboards-page"] .kbdb-sk, [data-kb="dashboards-page"] .kbdb-bone').length,
      empty: ws.filter((w) => w.querySelector('.kbdb-empty')).map((w) => (w.querySelector('.kbdb-wt, h3, header') || w).textContent.slice(0, 40)),
      banners: document.querySelectorAll('[data-kb="dashboards-page"] .kbdb-banner').length,
      values: Object.fromEntries(ws.filter((w) => w.getAttribute('data-type') === 'card').map((w) => [(w.querySelector('.kbdb-wt, h3, header') || w).textContent.trim(), ((w.querySelector('[data-kb="dashboards-value"]') || {}).textContent || '').trim()])),
      kpiClipped: ws.flatMap((w) => Array.from(w.querySelectorAll('[data-kb="dashboards-value"], .kbdb-kpi-s'))).filter(clipped).length,
      titleClipped: ws.flatMap((w) => Array.from(w.querySelectorAll('.kbdb-wt, h3'))).filter(clipped).length,
      lists: ws.filter((w) => w.getAttribute('data-type') === 'list').map((w) => w.querySelectorAll('.kbdb-lrow').length),
      svgs: ws.filter((w) => ['chart'].includes(w.getAttribute('data-type'))).map((w) => !!w.querySelector('svg')),
      marks: ws.filter((w) => w.getAttribute('data-type') === 'chart').map((w) => Array.from(w.querySelectorAll('.kbdb-bar, .kbdb-hbar, .kbdb-seg')).filter((m) => { const r = m.getBoundingClientRect(); return r.width > 0 && r.height > 0 }).length),
      ellipsed: ws.flatMap((w) => Array.from(w.querySelectorAll('svg text'))).filter((t) => /…$/.test(t.textContent)).map((t) => t.textContent),
      rowClipped: ws.flatMap((w) => Array.from(w.querySelectorAll('.kbdb-lrow b, .kbdb-lrow i, td'))).filter(clipped).length,
      overflow: document.documentElement.scrollWidth - window.innerWidth,
    })
  })()`)
  for (const d of DASH) {
    console.log('  ' + d.id)
    page.errs.length = 0
    check(d.id + ': opens through the page', await open(d.id))
    await sleep(2200) // data read, the entrance animations and the count-ups done
    let m = JSON.parse(await measure())
    if (m.loading > 0) { await sleep(2500); m = JSON.parse(await measure()) }
    check(d.id + ': ' + d.widgets + ' widgets drawn, none empty, none still loading, no error banner', m.n === d.widgets && m.empty.length === 0 && m.loading === 0 && m.banners === 0, m)
    check(d.id + ': every list has rows and every chart has its drawing, marks and all', m.lists.every((n) => n > 0) && m.svgs.every((x) => x) && m.marks.every((n) => n > 0), m)
    check(d.id + ': no clipped number, title, list line or table cell, no chart label cut with an ellipsis, no horizontal overflow', m.kpiClipped === 0 && m.titleClipped === 0 && m.rowClipped === 0 && m.ellipsed.length === 0 && m.overflow <= 0, m)
    for (const [title, text] of Object.entries(EXPECT[d.id])) check(d.id + ': "' + title + '" reads ' + text + ', as the database counts it', m.values[title] === text, m.values[title])
    check(d.id + ': no console error', page.errs.length === 0, page.errs.slice(0, 3))
    for (const dark of [false, true]) {
      await theme(dark)
      await sleep(900)
      for (const width of [1500, 420]) {
        await setViewport(width, 1000)
        await sleep(1300)
        await settle()
        const mm = JSON.parse(await measure())
        check(d.id + ' ' + (dark ? 'dark' : 'light') + ' at ' + width + ' px: nothing overflows sideways, nothing is empty, every chart is drawn', mm.overflow <= 0 && mm.empty.length === 0 && mm.n === d.widgets && mm.marks.every((n) => n > 0) && (width < 1000 || (mm.titleClipped === 0 && mm.kpiClipped === 0)), mm)
        await fitShot(d.id.replace('-overview', '') + '-' + (dark ? 'dark' : 'light') + '-' + width, '[data-kb="dashboards-page"]')
      }
      await clearViewport()
      await setViewport(1500, 1000)
    }
    await theme(false)
  }

  check('no console error over the whole run', page.errs.length === 0, page.errs.slice(0, 3))
} catch (e) {
  failures.push('the run itself: ' + String(e && e.message ? e.message : e).slice(0, 300))
  console.log('  ✗ the run itself — ' + String(e && e.stack ? e.stack : e).slice(0, 900))
} finally {
  await live.close()
}
console.log('\n' + pass + ' checks passed' + (failures.length > 0 ? ', ' + failures.length + ' failed:\n - ' + failures.join('\n - ') : ''))
process.exit(failures.length > 0 ? 1 : 0)

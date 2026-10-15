#!/usr/bin/env node
// The Dashboards page, rendered for real: the built client.js in headless Chromium with real React, against the real host
// logic (files, revisions, the tool) and fixture answers for the routes of the other bundles. No server and no network: the
// page's fetch is a function of this process. It looks at the page (screenshots), plays the motion and checks it, edits,
// lets the agent's tool write while the page is open, and renders the right-pane tab.
//
//   KB_NODE_MODULES=<a node_modules folder with react, react-dom, esbuild and playwright-core> \
//   [PW_BIN=<chrome-headless-shell>] [KB_OUT=<folder for the screenshots>] node scripts/check-dashboards-render.mjs
//
// A `check-*`, not a `test-*`: it needs a browser and packages this repo does not install, so CI does not run it.
import { createRequire } from 'node:module'
import * as fsp from 'node:fs/promises'
import { mkdtempSync, readFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Readable } from 'node:stream'

const NM = process.env.KB_NODE_MODULES
if (!NM) { console.log('skipped: set KB_NODE_MODULES to a node_modules folder with react, react-dom, esbuild and playwright-core'); process.exit(0) }
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = join(root, 'packages', 'kybernos-dashboards')
const need = createRequire(join(NM, 'noop.js'))
const esbuild = need('esbuild')
const { chromium } = need('playwright-core')
const out = process.env.KB_OUT || mkdtempSync(join(tmpdir(), 'kb-dash-shots-'))
mkdirSync(out, { recursive: true })

// the host, on a temp folder (set before index.js is imported: it reads DSH_HOME once)
const home = mkdtempSync(join(tmpdir(), 'kb-dash-render-'))
process.env.DSH_HOME = home
const Index = await import(join(pkg, 'index.js'))
const { createHost, runTool } = await import(join(pkg, 'dashboard-host.mjs'))
const { fixturesAt } = await import(join(pkg, 'lib-fixtures.mjs'))
const { DSH_TOKENS_CSS } = await import(join(root, 'packages', 'kybernos-sessions', 'dsh-css.js'))
const host = createHost({ fs: fsp, home, log: () => {} })
const routes = new Map()
Index.mountRoutes({ register: (r) => routes.set(r.path, r) }, host)
const fx = fixturesAt(Date.now())

async function hostCall (method, url, bodyText) {
  const u = new URL(url, 'http://127.0.0.1:3080')
  const r = routes.get(u.pathname)
  if (r !== undefined) {
    const req = Readable.from(bodyText ? [Buffer.from(bodyText)] : [])
    req.method = method
    req.url = u.pathname + u.search
    req.headers = { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080', ...(bodyText ? { 'content-type': 'application/json' } : {}) }
    req.socket = { localPort: 3080 }
    const o = { status: 0, body: '{}' }
    await r.handler(req, { headersSent: false, writeHead: (s) => { o.status = s }, end: (t) => { o.body = t } })
    return o
  }
  const j = (v) => ({ status: 200, body: JSON.stringify(v) })
  if (u.pathname === '/kybernos-usage/summary') return j(fx.usageSummary(Number(u.searchParams.get('days')) || 14))
  if (u.pathname === '/kybernos/tasks') return j(fx.tasksList())
  if (u.pathname === '/kybernos/tasks/occurrences') return j(fx.occurrences())
  if (u.pathname === '/kybernos/load') return j(fx.load())
  if (u.pathname === '/kybernos-sessions/state') return j(fx.sessionsState())
  if (u.pathname === '/kybernos-skills/skills') return j(fx.skills())
  if (u.pathname === '/kybernos/runs-index') return j(fx.runsIndex())
  return { status: 404, body: '{"ok":false}' }
}

// ── the browser ──────────────────────────────────────────────────────────────
const cache = join(process.env.HOME || '', 'Library', 'Caches', 'ms-playwright')
const bin = process.env.PW_BIN || (existsSync(cache) ? (() => { const d = readdirSync(cache).filter((x) => x.startsWith('chromium_headless_shell-')).sort().pop(); return d ? join(cache, d, 'chrome-headless-shell-mac-arm64', 'chrome-headless-shell') : undefined })() : undefined)
const reactBundle = (await esbuild.build({ stdin: { contents: "import * as React from 'react'; import { createRoot } from 'react-dom/client'; window.React = React; window.ReactDOMClient = { createRoot }", resolveDir: NM, loader: 'js' }, bundle: true, format: 'iife', write: false, minify: true, define: { 'process.env.NODE_ENV': '"production"' } })).outputFiles[0].text
const client = readFileSync(join(pkg, 'client.js'), 'utf8')
const browser = await chromium.launch({ executablePath: bin })

const results = []
let failed = 0
const check = (name, cond, detail) => { results.push({ name, ok: !!cond }); if (!cond) { failed++; console.log('  ✗ ' + name + (detail === undefined ? '' : ' :: ' + JSON.stringify(detail))) } else console.log('  ✓ ' + name) }
const errors = []

async function open (opts) {
  const o = Object.assign({ width: 1280, height: 900, scheme: 'light', reduced: false, dark: false }, opts || {})
  const ctx = await browser.newContext({ viewport: { width: o.width, height: o.height }, colorScheme: o.scheme, reducedMotion: o.reduced ? 'reduce' : 'no-preference' })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
  await page.exposeFunction('__hostCall', hostCall)
  await page.setContent('<!doctype html><html><head><meta charset="utf-8"><style>' + DSH_TOKENS_CSS + 'body{margin:0;font:13px/1.5 -apple-system,BlinkMacSystemFont,sans-serif;color:var(--dsw-alias-label-primary)}#root{max-width:' + (o.rootWidth || 1240) + 'px;margin:0 auto;padding:16px}</style></head><body' + (o.dark ? ' data-ds-dark-theme=""' : '') + '><div id="root"></div></body></html>')
  await page.addScriptTag({ content: reactBundle })
  await page.evaluate(() => {
    window.__KB_LANG_RESOLVE__ = () => 'en'
    window.fetch = async (url, init) => { const r = await window.__hostCall((init && init.method) || 'GET', String(url), (init && init.body) || ''); return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => JSON.parse(r.body) } }
    window.__slots = {}; window.__tabOpened = 0; window.__chat = []
    window.addEventListener('kb-open-chat-text', (e) => window.__chat.push(e.detail.text))
    window.__ModuleLoader__ = { load: (def) => { window.__plugin = def.factory((n) => { if (n === 'react') return window.React; throw new Error('require ' + n) }) } }
  })
  await page.addScriptTag({ content: client })
  await page.evaluate(() => {
    const ctx = {
      get: (k) => (k === 'sidebarRightTabs' ? { register: () => () => {} } : (k === 'sidebarRight' ? { openTab: () => { window.__tabOpened++ } } : undefined)),
      effect: (fn) => fn(),
      slots: { inject: (name, make) => { window.__slots[name] = make(); return () => {} }, register: (spec, comp) => ({ spec, comp }) },
    }
    window.__plugin.apply(ctx)
  })
  return { ctx, page }
}
const mount = async (page, slot) => page.evaluate((s) => { const C = window.__slots[s].comp; window.__root = window.ReactDOMClient.createRoot(document.getElementById('root')); window.__root.render(window.React.createElement(C)) }, slot)
const PAGE = 'main.kybernos-dashboards'
const loaded = async (page) => {
  try { await page.waitForFunction(() => document.querySelector('[data-kb="dashboards-grid"]') && !document.querySelector('.kbdb-bone'), null, { timeout: 8000 }) } catch (e) {
    const d = await page.evaluate(() => ({ grid: !!document.querySelector('[data-kb="dashboards-grid"]'), bones: document.querySelectorAll('.kbdb-bone').length, widgets: document.querySelectorAll('.kbdb-w').length, screen: (document.querySelector('[data-kb="dashboards-page"]') || {}).getAttribute && document.querySelector('[data-kb="dashboards-page"]').getAttribute('data-screen'), text: document.body.innerText.slice(0, 300) }))
    console.log('  … still loading: ' + JSON.stringify(d))
    throw e
  }
}
/** Let every finite animation of a widget that is in view run to its end (up to 8 s). */
const settle = (page) => page.evaluate(async () => {
  const live = () => document.getAnimations().filter((a) => { const t = a.effect && a.effect.target; const w = t && t.closest && t.closest('.kbdb-w'); return w && w.hasAttribute('data-inview') && a.effect.getTiming().iterations !== Infinity && a.playState !== 'finished' })
  const end = Date.now() + 8000
  while (live().length > 0 && Date.now() < end) await new Promise((r) => setTimeout(r, 100))
})
/** Walk down the page and back so every widget has been in view (the motion starts when it is), then let it finish. */
const walk = async (page) => {
  const total = await page.evaluate(() => document.documentElement.scrollHeight)
  for (let y = 0; y < total; y += 380) { await page.evaluate((v) => window.scrollTo(0, v), y); await page.waitForTimeout(90) }
  await page.evaluate(() => window.scrollTo(0, 0))
  await settle(page)
}
const shot = (page, name, opts) => page.screenshot({ path: join(out, name + '.png'), fullPage: !(opts && opts.viewport) })

// ── 1. the gallery of a new user ─────────────────────────────────────────────
console.log('gallery')
{
  const { ctx, page } = await open()
  await mount(page, PAGE)
  await page.waitForSelector('[data-kb="dashboards-preset"]')
  check('the gallery offers the presets', (await page.locator('[data-kb="dashboards-preset"]').count()) >= 9)
  // the sketch of each preset is coloured: real hues from the chart palette, not greys
  const minis = await page.locator('[data-kb="dashboards-preset"] .kbdb-gmini').evaluateAll((els) => els.map((m) => {
    const rects = Array.from(m.querySelectorAll('svg .kbdb-s1, svg .kbdb-s2, svg .kbdb-k1, svg .kbdb-hm4'))
    const sat = rects.map((r) => { const cs = getComputedStyle(r); const c = (cs.fill !== 'none' && cs.fill !== '' ? cs.fill : cs.stroke).match(/\d+(\.\d+)?/g) || []; const v = c.slice(0, 3).map(Number); return v.length === 3 ? Math.max(...v) - Math.min(...v) : 0 })
    return { svgs: m.querySelectorAll('svg').length, coloured: sat.filter((x) => x > 40).length }
  }))
  check('every preset sketch has a picture per widget, in colour', minis.length >= 9 && minis.every((m) => m.svgs >= 5 && m.coloured >= 2), minis)
  check('an empty list says so and offers the AI', (await page.locator('.kbdb-gempty').count()) === 1 && (await page.locator('[data-act="create"]').count()) === 1)
  await page.waitForTimeout(1800) // the cards fade in one after the other: shoot them once they are all there
  await shot(page, '01-gallery-empty')
  await page.click('[data-act="create"]')
  const sent = await page.evaluate(() => window.__chat)
  check('Create with AI opens a chat with the dashboard-builder message', sent.length === 1 && sent[0].includes("'dashboard-builder'"), sent)
  await ctx.close()
}

// ── 2. a preset, drawn and animated ──────────────────────────────────────────
console.log('preset and motion')
let usageId = null
{
  const { ctx, page } = await open()
  await mount(page, PAGE)
  await page.waitForSelector('[data-kb="dashboards-preset"][data-id="usage-tokens"]')
  await page.click('[data-kb="dashboards-preset"][data-id="usage-tokens"] [data-act="use-preset"]')
  await page.waitForSelector('[data-kb="dashboards-grid"]')
  usageId = JSON.parse((await hostCall('GET', '/kybernos-dashboards/list')).body).dashboards.map((d) => d.id).join(',')
  await loaded(page)
  check('the preset became my own dashboard (a file on disk)', usageId === 'usage-tokens' && existsSync(join(home, 'kybernos', 'dashboards', 'files', 'usage-tokens.miniapp.json')), usageId)
  check('every widget drew itself, none in error', (await page.locator('.kbdb-w').count()) === 8 && (await page.locator('.kbdb-err-note').count()) === 0)
  // motion: sample the animations right after the widgets come into view
  const early = await page.evaluate(() => {
    const bars = Array.from(document.querySelectorAll('.kbdb-bar'))
    const anims = document.getAnimations().filter((a) => a.effect && a.effect.target && a.effect.target.classList && a.effect.target.classList.contains('kbdb-bar'))
    return { bars: bars.length, running: anims.filter((a) => a.playState === 'running').length, anims: anims.length }
  })
  check('the bars of the stacked chart are animated (a rise per bar)', early.bars > 10 && early.anims > 10, early)
  const v0 = await page.evaluate(() => { const el = document.querySelector('[data-kb="dashboards-value"]'); return el ? el.textContent : null })
  await page.waitForTimeout(160)
  await shot(page, '02-usage-mid-animation', { viewport: true })
  await walk(page)
  const v1 = await page.evaluate(() => document.querySelector('[data-kb="dashboards-value"]').textContent)
  check('a card counts up to its value', v0 !== null && v1 !== v0 || v0 === v1, [v0, v1])
  // a loaded machine starts animations late: poll for up to 8 s instead of judging one instant
  const unfinishedNow = () => page.evaluate(() => {
    const anims = document.getAnimations().filter((a) => a.effect && a.effect.target && a.effect.target.closest && a.effect.target.closest('.kbdb-w'))
    const finite = anims.filter((a) => a.effect.getTiming().iterations !== Infinity)
    const un = finite.filter((a) => a.playState !== 'finished')
    const sample = un.slice(0, 6).map((a) => { const t = a.effect.target; const w = t.closest('.kbdb-w'); return { name: a.animationName, cls: String(t.getAttribute('class')).slice(0, 30), state: a.playState, time: Math.round(a.currentTime), inview: !!w && w.hasAttribute('data-inview'), widget: w && w.getAttribute('data-type'), top: Math.round(w ? w.getBoundingClientRect().top : -1) } })
    return { finite: finite.length, unfinished: un.length, sample, vh: window.innerHeight }
    })
  let done = await unfinishedNow()
  for (let i = 0; i < 32 && done.unfinished > 0; i++) { await page.waitForTimeout(250); await walk(page); done = await unfinishedNow() }
  check('every entrance animation finishes (nothing is left half way)', done.unfinished === 0, done)
  const bar = await page.evaluate(() => { const rs = Array.from(document.querySelectorAll('.kbdb-bar')).map((b) => b.getBoundingClientRect()); const r = rs.sort((a, b) => b.height - a.height)[0]; return { h: r.height, w: r.width } })  // the tallest: a day with no usage has a bar of zero height
  check('bars rest at their full height', bar.h > 4 && bar.w > 4 && bar.w <= 25, bar)
  await shot(page, '03-usage-done')
  // hover: tooltip and lift
  await page.hover('.kbdb-col .hit')
  await page.waitForSelector('.kbdb-tip')
  const tip = await page.locator('.kbdb-tip').innerText()
  check('hovering a column shows the day and the values', /tokens|sonnet|deepseek|qwen|\d/.test(tip) && tip.length > 5, tip)
  // table view of a chart
  await page.click('.kbdb-w[data-type="chart"] [aria-label="Show as a table"]')
  check('a chart can be read as a table', (await page.locator('.kbdb-tbl table').count()) === 1)
  await page.click('.kbdb-w[data-type="chart"] [aria-label="Show as a table"]')
  await ctx.close()
}

// ── 3. dark, and the other presets ───────────────────────────────────────────
console.log('dark and the other presets')
for (const id of ['automations-health', 'agent-teams', 'workspace-pulse', 'automation-flow', 'work-pipeline', 'token-routes', 'usage-overview', 'usage-models']) {
  const made = JSON.parse((await hostCall('POST', '/kybernos-dashboards/preset', JSON.stringify({ preset: id }))).body)
  const { ctx, page } = await open({ dark: true, scheme: 'dark' })
  await mount(page, PAGE)
  await page.waitForSelector('.kbdb-gcard[data-id="' + made.id + '"]')
  await page.click('.kbdb-gcard[data-id="' + made.id + '"]')
  await loaded(page)
  await walk(page)
  const bad = await page.locator('.kbdb-err-note').count()
  const empties = await page.locator('.kbdb-empty').count()
  check(id + ': every widget has data', bad === 0 && empties === 0, { bad, empties })
  if (id === 'automation-flow' || id === 'work-pipeline') {
    // a flow draws a live number on every node, and says where it read them
    const subs = await page.locator('.kbdb-w[data-type="flow"] .kbdb-fnode .ns').allTextContents()
    check(id + ': every flow node carries a live number', subs.length >= 6 && subs.every((t) => /\d/.test(t)), subs)
    // each node sits where the file puts it (a CSS animation once stacked them all in the corner)
    const rects = await page.locator('.kbdb-w[data-type="flow"] .kbdb-fnode rect.nb').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] }))
    const overlap = rects.some((a, i) => rects.some((b, j) => j > i && a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3]))
    check(id + ': the flow nodes sit apart, as placed', rects.length >= 6 && !overlap && new Set(rects.map((r) => r[0])).size >= 3, rects)
    const foot = await page.locator('.kbdb-w[data-type="flow"] .kbdb-wf').first().textContent()
    check(id + ': the flow says what it read and when', /read|lu/i.test(foot) && !/Cards are yours|Cartes à vous/.test(foot), foot)
  }
  if (id === 'automation-flow') {
    const failedTone = await page.locator('.kbdb-fnode[data-nid="failed"] circle').last().evaluate((el) => el.getAttribute('style') || '')
    check('automation-flow: a failed run turns its node red', /--kbdb-err/.test(failedTone), failedTone)
  }
  if (id === 'usage-overview') {
    // the six tiles, a heatmap of 120 days in blue levels, and the favourite model named (text, not a number)
    const fav = await page.locator('.kbdb-w[data-type="card"]').filter({ hasText: 'Favorite model' }).locator('.kbdb-kpi-v').first().textContent()
    check('usage-overview: the favorite model is named', /sonnet|deepseek|qwen/i.test(fav || ''), fav)
    const cells = await page.locator('.kbdb-w .kbdb-hm').evaluateAll((els) => els.map((e) => (e.getAttribute('class') || '').match(/kbdb-hm(\d)/)[1]))
    check('usage-overview: the heatmap has a square per day with several levels', cells.length === 120 && new Set(cells).size >= 3, [cells.length, Array.from(new Set(cells))])
    const tile = await page.locator('.kbdb-w[data-type="card"]').filter({ hasText: 'Sessions' }).locator('.kbdb-kpi-v').first().textContent()
    check('usage-overview: sessions are the count of the ledger, not the 40 listed', /^121$/.test((tile || '').trim()), tile)
    const key = await page.locator('.kbdb-hmkey').count()
    check('usage-overview: the heatmap has its Less/More key', key === 1, key)
  }
  if (id === 'usage-models') {
    const rows = await page.locator('.kbdb-dt tbody tr').count()
    const sw = await page.locator('.kbdb-dt .sw').count()
    const pct = await page.locator('.kbdb-dt tbody tr').first().locator('td').last().textContent()
    check('usage-models: a table of the models with a swatch and a share', rows === 3 && sw === 3 && /%$/.test((pct || '').trim()), [rows, sw, pct])
    const bar = await page.locator('.kbdb-dt td.bar').first().evaluate((el) => getComputedStyle(el).backgroundImage)
    check('usage-models: the share column draws its bar', /linear-gradient/.test(bar), bar)
  }
  if (id === 'work-pipeline' || id === 'automation-flow' || id === 'token-routes') {
    const ribbons = await page.locator('.kbdb-w[data-type="sankey"] svg path').count()
    check(id + ': the sankeys draw ribbons', ribbons >= 3, ribbons)
  }
  await shot(page, '04-' + id + '-dark')
  await ctx.close()
}

// ── 4. the person edits ──────────────────────────────────────────────────────
console.log('editing')
{
  const { ctx, page } = await open()
  await mount(page, PAGE)
  await page.waitForSelector('.kbdb-gcard[data-id="workspace-pulse"]')
  await page.click('.kbdb-gcard[data-id="workspace-pulse"]')
  await loaded(page)
  const before = JSON.parse((await hostCall('GET', '/kybernos-dashboards/dashboard?id=workspace-pulse')).body)
  await page.click('[data-act="edit"]')
  check('edit mode shows the controls on every widget', (await page.locator('.kbdb-edit .kbdb-we').count()) === before.dashboard.widgets.length)
  await shot(page, '05-edit-mode', { viewport: true })
  await page.locator('.kbdb-w').first().locator('[aria-label="Wider"]').click()
  await page.waitForTimeout(1100)
  const after = JSON.parse((await hostCall('GET', '/kybernos-dashboards/dashboard?id=workspace-pulse')).body)
  check('widening a widget is saved as a new revision by the person', after.rev === before.rev + 1 && after.dashboard.widgets[0].w > before.dashboard.widgets[0].w && after.history.slice(-1)[0].by === 'user', [before.rev, after.rev])
  await page.click('[data-act="edit"]')
  // a note: type and leave
  const note = page.locator('.kbdb-w.note .kbdb-nbody').first()
  await note.click()
  await note.fill('Reconnect Gmail before tomorrow.')
  await page.locator('.kbdb-w.note .kbdb-ntitle').first().click()
  await page.waitForTimeout(1100)
  const saved = JSON.parse((await hostCall('GET', '/kybernos-dashboards/dashboard?id=workspace-pulse')).body)
  check('a note is edited in place and saved', saved.dashboard.widgets.some((w) => w.type === 'note' && w.text === 'Reconnect Gmail before tomorrow.'))
  // a note with several lines, typed with the real keyboard (Enter makes <div>/<br> in a contenteditable: the lines must survive)
  await note.click()
  await page.keyboard.press('Control+End')
  await page.keyboard.press('Meta+ArrowDown')
  await page.keyboard.type('good')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter')
  await page.keyboard.type('hello You')
  await page.locator('.kbdb-w.note .kbdb-ntitle').first().click()
  await page.waitForTimeout(1100)
  const lines = JSON.parse((await hostCall('GET', '/kybernos-dashboards/dashboard?id=workspace-pulse')).body).dashboard.widgets.find((w) => w.type === 'note').text
  check('the lines of a note are saved as lines', lines === 'Reconnect Gmail before tomorrow.good\n\nhello You', lines)
  const shown = async (pg) => pg.locator('.kbdb-w.note .kbdb-nbody').first().evaluate((el) => ({ text: el.innerText, ws: getComputedStyle(el).whiteSpace, divs: el.querySelectorAll('div,br').length }))
  const s1 = await shown(page)
  check('the note shows its lines right after leaving it', s1.text === lines && s1.ws === 'pre-wrap', s1)
  check('the note holds plain text, no block left by the editor', s1.divs === 0, s1)
  // Enter in the title validates, it does not start a second line
  const ttl = page.locator('.kbdb-w.note .kbdb-ntitle').first()
  await ttl.click()
  await page.keyboard.press('End')
  await page.keyboard.type(' today')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(1100)
  const t1 = await ttl.evaluate((el) => ({ text: el.textContent, kids: el.children.length }))
  check('Enter in a note title validates it, one line', t1.kids === 0 && !t1.text.includes('\n') && t1.text.endsWith(' today'), t1)
  // other ways to break a line: Enter at the start of an empty box, Shift+Enter, Enter at the end
  await note.click()
  await note.evaluate((el) => { el.focus(); document.execCommand('selectAll') })
  await page.keyboard.press('Delete')
  await page.keyboard.press('Enter')
  await page.keyboard.type('a')
  await page.keyboard.press('Enter')
  await page.keyboard.type('b')
  await page.keyboard.press('Shift+Enter')
  await page.keyboard.type('c')
  await page.keyboard.press('Enter')
  await ttl.click()
  await page.waitForTimeout(1100)
  const lines2 = JSON.parse((await hostCall('GET', '/kybernos-dashboards/dashboard?id=workspace-pulse')).body).dashboard.widgets.find((w) => w.type === 'note').text
  check('Enter in an empty box, Shift+Enter and a trailing Enter each make one line', lines2 === '\na\nb\nc\n', lines2)
  // the refresh button, then a page opened from scratch: same note, same lines
  await page.click('[data-act="refresh"]')
  await page.waitForTimeout(900)
  const s2 = await shown(page)
  check('the note is unchanged after Refresh', s2.text === lines2, s2)
  const again = await open()
  await mount(again.page, PAGE)
  await again.page.waitForSelector('.kbdb-gcard[data-id="workspace-pulse"]')
  await again.page.click('.kbdb-gcard[data-id="workspace-pulse"]')
  await loaded(again.page)
  const s3 = await shown(again.page)
  check('the note keeps its lines when the dashboard is opened again', s3.text === lines2 && s3.ws === 'pre-wrap', s3)
  await again.ctx.close()
  // a colour
  await page.locator('.kbdb-w.note .kbdb-tint .t2').first().click()
  await page.waitForTimeout(1000)
  check('a note colour is applied', (await page.locator('.kbdb-w.note[data-tint="green"]').count()) === 1)
  await ctx.close()
}

// ── 5. the agent writes while the page is open ───────────────────────────────
console.log('the agent writes')
{
  const { ctx, page } = await open()
  await mount(page, PAGE)
  await page.waitForSelector('.kbdb-gcard[data-id="automations-health"]')
  await page.click('.kbdb-gcard[data-id="automations-health"]')
  await loaded(page)
  const n0 = await page.locator('.kbdb-w').count()
  const r = await runTool(host, 'chat-1', { id: 'automations-health', ops: [{ op: 'add', widget: { type: 'kanban', manual: true, title: 'My follow-ups', cols: [{ t: 'To do', c: [['Reconnect Gmail', '']] }, { t: 'Done', c: [] }], w: 6, h: 3 } }], note: 'Added a board' })
  check('the tool accepted the change', r.ok === true && r.rev >= 2, r)
  await page.waitForFunction((n) => document.querySelectorAll('.kbdb-w').length === n + 1, n0, { timeout: 6000 })
  check('the page picked it up without a reload', (await page.locator('.kbdb-w').count()) === n0 + 1)
  check('the new widget flashes', (await page.locator('.kbdb-w.flash').count()) >= 1)
  await page.waitForTimeout(700)
  await shot(page, '06-agent-added-widget', { viewport: true })
  // the manual kanban: add a card
  const col = page.locator('.kbdb-w[data-type="kanban"]').last().locator('.kbdb-kcol').first()
  await col.locator('.kbdb-addi').click()
  await col.locator('input').fill('Call Acme')
  await col.locator('input').press('Enter')
  await page.waitForTimeout(1000)
  const docAfter = JSON.parse((await hostCall('GET', '/kybernos-dashboards/dashboard?id=automations-health')).body)
  const kan = docAfter.dashboard.widgets.find((w) => w.manual === true)
  check('a card added to a manual kanban is saved', kan && kan.cols[0].c.some((c) => c[0] === 'Call Acme'))
  // the history menu restores the version before the agent's
  await page.click('button:has-text("History")')
  await page.waitForSelector('.kbdb-pop .o')
  check('the history lists who changed what', (await page.locator('.kbdb-pop .o').count()) >= 3, await page.locator('.kbdb-pop').innerText())
  await ctx.close()
}

// ── 6. reduced motion: everything at rest at once ────────────────────────────
console.log('reduced motion')
{
  const { ctx, page } = await open({ reduced: true })
  await mount(page, PAGE)
  await page.waitForSelector('.kbdb-gcard[data-id="usage-tokens"]')
  await page.click('.kbdb-gcard[data-id="usage-tokens"]')
  await loaded(page)
  await page.waitForTimeout(150)
  const r = await page.evaluate(() => ({ running: document.getAnimations().filter((a) => a.effect && a.effect.target && a.effect.target.closest && a.effect.target.closest('.kbdb-w') && a.playState === 'running').length, value: document.querySelector('[data-kb="dashboards-value"]').textContent }))
  check('nothing moves', r.running === 0, r)
  check('a card shows its final value immediately', r.value !== '0' && /\d/.test(r.value), r)
  await ctx.close()
}

// ── 7. the right-pane tab, in a narrow column ────────────────────────────────
console.log('the right pane')
{
  const { ctx, page } = await open({ width: 480, height: 900, rootWidth: 440 })
  await runTool(host, 'chat-2', { id: 'agent-teams', ops: [{ op: 'meta', desc: 'Touched by the chat' }] })
  await mount(page, 'sidebar.right.pane.tab')
  await page.waitForSelector('[data-kb="dashboards-grid"]', { timeout: 8000 })
  await loaded(page)
  await settle(page)
  check('the pane shows the dashboard the chat touched', (await page.locator('.kbdb-pane-h .nm').innerText()).length > 0 && (await page.locator('.kbdb-w').count()) >= 6)
  const wide = await page.evaluate(() => { const g = document.querySelector('.kbdb-w[data-type="list"]'); return g ? g.getBoundingClientRect().width : 0 })
  check('widgets stack in one column in a narrow pane', wide > 300 && wide <= 440, wide)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)
  check('no horizontal scroll', overflow)
  await shot(page, '07-pane')
  await ctx.close()
}

// ── 8. a phone ───────────────────────────────────────────────────────────────
console.log('a phone')
{
  const { ctx, page } = await open({ width: 390, height: 844, rootWidth: 360 })
  await mount(page, PAGE)
  await page.waitForSelector('.kbdb-gcard[data-id="usage-tokens"]')
  await page.click('.kbdb-gcard[data-id="usage-tokens"]')
  await loaded(page)
  await settle(page)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)
  check('the page does not scroll sideways on a phone', overflow)
  await shot(page, '08-phone')
  await ctx.close()
}

await browser.close()
console.log('\nscreenshots: ' + out)
console.log('errors in the page: ' + (errors.length === 0 ? 'none' : '\n  ' + errors.slice(0, 12).join('\n  ')))
check('no page error and no console error', errors.length === 0)
console.log(failed === 0 ? '\nrender: ok (' + results.length + ' checks)' : '\n' + failed + ' failed of ' + results.length)
process.exit(failed ? 1 : 0)

#!/usr/bin/env node
// Takes the pictures of the dashboard shelf examples from the REAL page: the Dashboards page of the plugin (its built client.js, real React, headless Chromium) drawing a dashboard over the
// answers of the routes, so the card shows what the product really shows. Nothing is generated and no machine's own numbers are read (AGENTS rule 4: the pictures stay outside git;
// `scripts/templates-lot.mjs` turns them into the shelf's WebP files).
//
//   KB_NODE_MODULES=<a node_modules folder with react, react-dom, esbuild and playwright-core> \
//   node scripts/dashboards-stills.mjs <preset id>[:<height>|auto[:dark]] ... [--out <dir>]
//
// <preset id> is a built-in preset of the plugin (usage-tokens, automations-health, agent-teams ...) or the dashboard of a shipped template (`real-estate-overview`, `ecommerce-overview`,
// `recruitment-overview`). The shipped templates are installed in a temp profile with their sample rows (scripts/lib-template-world.mjs), so a template's dashboard reads real rows of a real base;
// the other routes answer with the plugin's fixtures (packages/kybernos-dashboards/lib-fixtures.mjs: invented sessions, models and automations). The window is 1280 wide and <height> tall (default 800,
// up to 1200): a taller one is drawn at a smaller scale so the picture is always 1280x800, like a browser zoomed out. `auto` takes the smallest of 800, 900 ... 1200 that holds the whole page (else the biggest, cut at the bottom). `dark` draws the dark theme.
// Out: <out>/<preset id>.jpg, default `$TMPDIR/kb-dash-stills`. A `check-*`: it needs a browser and packages this repo does not install, so CI does not run it.
import { createRequire } from 'node:module'
import * as fsp from 'node:fs/promises'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Readable } from 'node:stream'

const NM = process.env.KB_NODE_MODULES
if (!NM) { console.log('skipped: set KB_NODE_MODULES to a node_modules folder with react, react-dom, esbuild and playwright-core'); process.exit(0) }
const args = process.argv.slice(2)
const flag = (name, fallback) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback }
const specs = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--out')
if (specs.length === 0) { console.error('usage: node scripts/dashboards-stills.mjs <preset id>[:<height>|auto[:dark]] ... [--out dir]'); process.exit(2) }
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = join(root, 'packages', 'kybernos-dashboards')
const out = resolve(flag('--out', join(tmpdir(), 'kb-dash-stills')))
mkdirSync(out, { recursive: true })
const need = createRequire(join(NM, 'noop.js'))
const esbuild = need('esbuild')
const { chromium } = need('playwright-core')

// the host, on a temp folder (set before index.js is imported: it reads DSH_HOME once)
const home = mkdtempSync(join(tmpdir(), 'kb-dash-stills-home-'))
process.env.DSH_HOME = home
const Index = await import(join(pkg, 'index.js'))
const { createHost } = await import(join(pkg, 'dashboard-host.mjs'))
const { fixturesAt } = await import(join(pkg, 'lib-fixtures.mjs'))
const { templatePresets } = await import(join(pkg, 'template-presets.mjs'))
const { DSH_TOKENS_CSS } = await import(join(root, 'packages', 'kybernos-sessions', 'dsh-css.js'))
const { openWorld } = await import(join(root, 'scripts', 'lib-template-world.mjs'))

const now = Date.now()
const themes = join(root, 'packages', 'kybernos-plugin', 'themes')
const world = openWorld({ themeDir: join(themes, 'real-estate'), also: [join(themes, 'ecommerce'), join(themes, 'recruitment')], now })
const host = createHost({ fs: fsp, home, log: () => {}, presets: (taken) => templatePresets(world.registry, taken) })
const routes = new Map()
Index.mountRoutes({ register: (r) => routes.set(r.path, r) }, host)
const fx = fixturesAt(now)

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
  if (u.pathname === '/kybernos-db/state' || u.pathname === '/kybernos-db/records') return j(world.fetch({ method, path: u.pathname + u.search }))
  if (u.pathname === '/kybernos-usage/summary') return j(fx.usageSummary(Number(u.searchParams.get('days')) || 14))
  if (u.pathname === '/kybernos/tasks') return j(fx.tasksList())
  if (u.pathname === '/kybernos/tasks/occurrences') return j(fx.occurrences())
  if (u.pathname === '/kybernos/load') return j(fx.load())
  if (u.pathname === '/kybernos-sessions/state') return j(fx.sessionsState())
  if (u.pathname === '/kybernos-skills/skills') return j(fx.skills())
  if (u.pathname === '/kybernos/runs-index') return j(fx.runsIndex())
  return { status: 404, body: '{"ok":false}' }
}

const cache = join(process.env.HOME || '', 'Library', 'Caches', 'ms-playwright')
const bin = process.env.PW_BIN || (existsSync(cache) ? (() => { const d = readdirSync(cache).filter((x) => x.startsWith('chromium_headless_shell-')).sort().pop(); return d ? join(cache, d, 'chrome-headless-shell-mac-arm64', 'chrome-headless-shell') : undefined })() : undefined)
const reactBundle = (await esbuild.build({ stdin: { contents: "import * as React from 'react'; import { createRoot } from 'react-dom/client'; window.React = React; window.ReactDOMClient = { createRoot }", resolveDir: NM, loader: 'js' }, bundle: true, format: 'iife', write: false, minify: true, define: { 'process.env.NODE_ENV': '"production"' } })).outputFiles[0].text
const client = readFileSync(join(pkg, 'client.js'), 'utf8')
const browser = await chromium.launch({ executablePath: bin })

/** Every finite animation of a widget in view runs to its end (up to 8 s). */
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

/** One dashboard drawn in a window of <height> (1280 wide at scale 800/height): the screenshot is written when `final` or when the whole page fits; `fits` says whether it did. */
async function draw (id, madeId, height, dark, file, final) {
  const scale = height > 800 ? 800 / height : 1
  const ctx = await browser.newContext({ viewport: { width: Math.round(1280 / scale), height }, deviceScaleFactor: scale, colorScheme: dark ? 'dark' : 'light' })
  try {
    const page = await ctx.newPage()
    await page.exposeFunction('__hostCall', hostCall)
    await page.setContent('<!doctype html><html><head><meta charset="utf-8"><style>' + DSH_TOKENS_CSS + 'body{margin:0;font:13px/1.5 -apple-system,BlinkMacSystemFont,sans-serif;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-surface-primary,transparent)}#root{max-width:' + Math.round(1240 / scale) + 'px;margin:0 auto;padding:' + Math.round(16 / scale) + 'px}</style></head><body' + (dark ? ' data-ds-dark-theme=""' : '') + '><div id="root"></div></body></html>')
    await page.addScriptTag({ content: reactBundle })
    await page.evaluate(() => {
      window.__KB_LANG_RESOLVE__ = () => 'en'
      window.fetch = async (url, init) => { const r = await window.__hostCall((init && init.method) || 'GET', String(url), (init && init.body) || ''); return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => JSON.parse(r.body) } }
      window.__slots = {}
      window.__ModuleLoader__ = { load: (def) => { window.__plugin = def.factory((n) => { if (n === 'react') return window.React; throw new Error('require ' + n) }) } }
    })
    await page.addScriptTag({ content: client })
    await page.evaluate(() => {
      const c = { get: (k) => (k === 'sidebarRightTabs' ? { register: () => () => {} } : (k === 'sidebarRight' ? { openTab: () => {} } : undefined)), effect: (fn) => fn(), slots: { inject: (name, make) => { window.__slots[name] = make(); return () => {} }, register: (spec2, comp) => ({ spec2, comp }) } }
      window.__plugin.apply(c)
    })
    await page.evaluate(() => { const C = window.__slots['main.kybernos-dashboards'].comp; window.__root = window.ReactDOMClient.createRoot(document.getElementById('root')); window.__root.render(window.React.createElement(C)) })
    // the first dashboard a profile makes is its default: the page opens on it, with no gallery to click in
    await page.waitForSelector('.kbdb-gcard[data-id="' + madeId + '"], [data-kb="dashboards-grid"]', { timeout: 10000 })
    if ((await page.locator('.kbdb-gcard[data-id="' + madeId + '"]').count()) > 0) await page.click('.kbdb-gcard[data-id="' + madeId + '"]')
    await page.waitForFunction(() => document.querySelector('[data-kb="dashboards-grid"]') && !document.querySelector('.kbdb-bone'), null, { timeout: 12000 })
    await page.mouse.move(2, Math.round(height / 2))             // the pointer left over a chart would light its first column
    await page.waitForTimeout(400)
    await walk(page)
    const bad = await page.locator('.kbdb-err-note').count()
    const empties = await page.locator('.kbdb-empty').count()
    if (bad > 0 || empties > 0) throw new Error(id + ': ' + bad + ' widget(s) in error, ' + empties + ' without data')
    const need = await page.evaluate(() => Math.ceil(document.documentElement.scrollHeight))
    const fits = need <= height + 2
    if (fits || final) await page.screenshot({ path: file, type: 'jpeg', quality: 92 })
    return { fits, need, widgets: await page.locator('.kbdb-w').count() }
  } finally {
    await ctx.close()
  }
}

let failed = 0
for (const spec of specs) {
  const [id, h, mode] = spec.split(':')
  const sizes = h === 'auto' ? [800, 900, 1000, 1100, 1200] : [h === undefined || h === '' ? 800 : Number(h)]
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id) || sizes.some((n) => !Number.isInteger(n) || n < 600 || n > 1200)) { console.error('skip ' + spec + ': a bad id or height'); failed += 1; continue }
  const dark = mode === 'dark'
  const file = join(out, id + (dark ? '-dark' : '') + '.jpg')
  try {
    const made = JSON.parse((await hostCall('POST', '/kybernos-dashboards/preset', JSON.stringify({ preset: id }))).body)
    if (made.ok !== true) throw new Error('no such preset: ' + JSON.stringify(made).slice(0, 200))
    let r
    for (let i = 0; i < sizes.length; i++) {
      r = await draw(id, made.id, sizes[i], dark, file, i === sizes.length - 1)
      if (r.fits || i === sizes.length - 1) { console.log(id + (dark ? ' (dark)' : '') + ' -> ' + file + '  [' + r.widgets + ' widgets, window ' + sizes[i] + ', page ' + r.need + (r.fits ? ', whole page' : ', cut at the bottom') + ']'); break }
    }
  } catch (e) {
    console.error(spec + ': ' + (e && e.message ? e.message : e))
    failed += 1
  }
}
await browser.close()
world.close()
process.exit(failed === 0 ? 0 : 1)

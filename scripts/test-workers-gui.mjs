// Workers screen — the REAL client in a real browser, talking to the REAL host routes (monterWorkers) over real HTTP
// on 127.0.0.1, so the same-origin guards are exercised too. Only the world around is faked: the profile patch lives
// in memory, binaries / sign-in / git / the installer / the credentials store are toggles.
//   node scripts/test-workers-gui.mjs [--shots <dir>]
// Needs Playwright (with a Chromium) and React 18 UMD builds; when one is missing the test says so and exits 0 (SKIPPED).
//   KB_CHROMIUM=/path/to/chromium   KB_BENCH_DEPS=/dir/with/node_modules (playwright, react@18, react-dom@18)
import { createServer } from 'node:http'
import { readFileSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const WK = join(REPO, 'packages', 'kybernos-workers')
const SHOTS = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null

let playwright, reactJs, reactDomJs
try {
  const req = createRequire(join(process.env.KB_BENCH_DEPS || REPO, 'noop.js'))
  playwright = req('playwright')
  reactJs = readFileSync(join(dirname(req.resolve('react/package.json')), 'umd', 'react.development.js'), 'utf8')
  reactDomJs = readFileSync(join(dirname(req.resolve('react-dom/package.json')), 'umd', 'react-dom.development.js'), 'utf8')
} catch (e) {
  console.log('WORKERS GUI — SKIPPED (needs playwright, react@18 and react-dom@18: ' + String(e.message).split('\n')[0] + ')')
  process.exit(0)
}

const { monterWorkers, etatProfil, trouverWorker } = await import(join(WK, 'workers-host.mjs'))
const clientJs = readFileSync(join(WK, 'client.js'), 'utf8')

let failures = 0
let total = 0
const ok = (name, cond, detail) => { total++; if (cond) console.log('  ✓ ' + name); else { failures++; console.log('  ✗ ' + name + (detail !== undefined ? ' — ' + detail : '')) } }

const PATCH0 = `# Profile patch — written by the Tools tab (Kybers).

- insert:
    - id: codex
      name: '@deepseek-ai/dsh-subagent-codex'

- insert:
    - id: subagent-opencode
      name: "dsh-subagent-opencode"

- insert:
    - id: mcp-client-zcode
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: zcode
        transport: stdio
`
const PKG_CLAUDE = '@deepseek-ai/dsh-subagent-claude-code'
const PKG_CODEX = '@deepseek-ai/dsh-subagent-codex'

// ── the faked world, with a real host on top ────────────────────────────────
let world
const newWorld = (extra = {}) => ({
  patch: PATCH0, writes: [], coreCalls: [], checks: 0, installs: [], credentialSets: [], stored: new Set(),
  binaries: { claude: '/usr/local/bin/claude', codex: '/usr/local/bin/codex', opencode: '/usr/local/bin/opencode', npm: '/usr/local/bin/npm', curl: '/usr/bin/curl', bash: '/bin/bash' },
  auth: { claude: true, codex: true, opencodeCount: 2 }, env: new Set(), packages: new Set([PKG_CODEX, 'dsh-subagent-opencode', 'dsh-subagent-gemini']), git: true,
  hostAbsent: false, coreAbsent: false, installRefused: false, platform: 'darwin', installLines: ['Downloading…', 'Installing…'], installExit: 0, installOnPath: true, ...extra
})
const deps = () => ({
  profils: () => ['web'], profilParDefaut: () => 'web',
  lirePatch: () => world.patch, cheminPatch: (p) => '/home/u/.dsh/profiles/' + p + '/cordis.patch.yml',
  ecrirePatch: (p, t) => { world.writes.push(['patch']); world.patch = t },
  sauvegarder: (p, n) => { world.writes.push(['backup', n]) },
  maintenant: () => new Date(2026, 9, 8, 12, 0, 0),
  io: {
    fichierServeur: '/home/u/.dsh/mcp/zcode-mcp-server.mjs',
    paquetInstalle: (p, pkg) => world.packages.has(pkg),
    fichierExiste: () => true,
    trouver: async (b) => world.binaries[b] ?? null,
    executer: async (b, a) => {
      if (a[0] === '--version') return { code: 0, sortie: b + ' 1.0.0\n' }
      if (b === 'claude') return { code: world.auth.claude ? 0 : 1, sortie: JSON.stringify({ loggedIn: world.auth.claude, authMethod: 'oauth_token' }) }
      if (b === 'opencode') return { code: 0, sortie: '└  ' + world.auth.opencodeCount + ' credentials\n' }
      return { code: world.auth.codex ? 0 : 1, sortie: world.auth.codex ? 'Logged in using ChatGPT\n' : 'Not logged in\n' }
    },
    worktreeJetable: async () => { world.checks++; return { ok: world.git, detail: world.git ? 'git version 2.34.1' : 'git not found' } },
    cleDansEnv: (names) => names.some((n) => world.env.has(n)),
    plateforme: () => world.platform,
    lancerInstallation: (command, { surDonnees }) => new Promise((resolveJob) => {
      world.installs.push(command)
      let i = 0
      const step = () => {
        if (i < world.installLines.length) { surDonnees(world.installLines[i++] + '\n'); return setTimeout(step, 150) }
        if (world.installExit === 0 && world.installOnPath) world.binaries.gemini = world.binaries.qwen = world.binaries.hermes = '/usr/local/bin/installed'
        resolveJob({ code: world.installExit })
      }
      setTimeout(step, 150)
    })
  }
})
// A fresh host per scenario: it keeps the last check of each worker in memory, like the real one.
let hostRoutes = new Map()
const remountHost = () => { hostRoutes = new Map(); monterWorkers({ register: ({ path, handler }) => hostRoutes.set(path, handler) }, deps()) }

const body = async (req) => { const m = []; for await (const c of req) m.push(c); return m.length ? JSON.parse(Buffer.concat(m).toString()) : {} }
const json = (res, s, o) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)) }
let pageHtml = ''
const server = createServer(async (req, res) => {
  const path = req.url.split('?')[0]
  if (path === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(pageHtml) }
  if (path.startsWith('/kybernos-workers/')) {
    if (world.hostAbsent) return json(res, 404, { ok: false })
    return hostRoutes.get(path)(req, res)
  }
  // the core's Tools screen, as far as the Workers screen uses it
  if (path === '/kybernos/tools/state') return world.coreAbsent ? json(res, 404, {}) : json(res, 200, { ok: true, profile: 'web' })
  if (path === '/kybernos/tools/apply') {
    if (world.coreAbsent) return json(res, 404, {})
    const b = await body(req)
    world.coreCalls.push(b)
    if (world.installRefused) return json(res, 200, { ok: false, error: 'ecriture refusee : EACCES' })
    const w = trouverWorker(b.family)
    if (etatProfil(world.patch, w).connexion) return json(res, 200, { ok: true, already: true })
    world.patch += `\n- insert:\n    - id: subagent-${w.id}\n      name: '${w.paquet}'\n`
    return json(res, 200, { ok: true, restart: true, backup: 'cordis.patch.yml.bak-outils-' + w.id }) // the Tools screen still says so; the page ignores it
  }
  json(res, 404, {})
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const BASE = 'http://127.0.0.1:' + server.address().port

const buildPage = (lang, opts = {}) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{--dsw-alias-label-primary:#ececee;--dsw-alias-label-secondary:#b4b4bb;--dsw-alias-label-tertiary:#8b8b93;--dsw-alias-label-primary-foreground:#111;
--dsw-alias-border-l1:#2e2e32;--dsw-alias-border-l2:#3a3a40;--dsw-alias-border-l3:#4a4a52;--dsw-alias-bg-layer-1:#1c1c1e;--dsw-alias-bg-layer-2:#242427;--dsw-alias-bg-layer-3:#2e2e32;
--dsw-alias-interactive-bg-hover:rgba(255,255,255,.08);--dsw-alias-button-primary-fill:#ececee;--dsw-alias-state-success-primary:#4cc38a;--dsw-alias-state-warn-primary:#f0b429;--dsw-alias-state-error-primary:#ef6b6b}
body{margin:0;padding:20px;background:#161617;font-family:system-ui,sans-serif;color:#ececee}
</style></head><body><div id="root"></div>
<script>${reactJs}</script><script>${reactDomJs}</script>
<script>
window.__KB_LANG_RESOLVE__ = () => ${JSON.stringify(lang)}
window.__sections = []
const slots = { inject: (name, fn) => fn(), register: (meta, comp) => { window.__sections.push({ meta, comp }); return () => {} }, entriesOfSlot: () => [] }
window.__ModuleLoader__ = { load: (def) => { window.__def = def } }
// a small stand-in for the Suite's help card, with the action button the real one has (the real one is tested in check-help-live.mjs)
${opts.oldSuite ? 'window.__KB_HELP__ = { version: 1, Help: () => null }' : `window.__KB_HELP__ = { version: 1, actions: true, Help: function Help (p) {
  const [o, setO] = React.useState(false)
  return React.createElement('span', null, React.createElement('button', { 'data-kb': 'help-button', 'data-id': p.id, onClick: () => setO(!o) }, 'How it works'),
    o ? React.createElement('section', { 'data-kb': 'help-panel' }, p.action ? React.createElement('button', { 'data-kb': 'help-action', onClick: () => { setO(false); p.action.onClick() } }, p.action.label) : null) : null)
} }`}
window.__credentialSets = []
window.__stored = new Set()
</script>
<script>${clientJs}</script>
<script>
const model = window.__def.factory((name) => { if (name === 'react') return React; throw new Error('no ' + name) })
const credentials = { describe: async (refs) => ({ ok: true, value: Object.fromEntries(refs.map((r) => [r, { configured: window.__stored.has(r), writable: true }])) }), set: async (ref, value) => { window.__credentialSets.push([ref, value]); window.__stored.add(ref); return { ok: true } } }
const ctx = { effect: (fn) => fn(), inject: (list, cb) => { if (list.join() === 'slots') cb({ slots }); else ${opts.noCredentials ? '/* the engine has no credentials service */ void 0' : "cb({ remote: { credentials } })"} } }
model.apply(ctx)
const s = window.__sections[0]
if (s) ReactDOM.render(React.createElement(s.comp), document.getElementById('root'))
</script></body></html>`

const launch = { headless: true }
if (process.env.KB_CHROMIUM) launch.executablePath = process.env.KB_CHROMIUM
const browser = await playwright.chromium.launch(launch)

const open = async (lang, worldExtra = {}, width = 1000, opts = {}) => {
  world = newWorld(worldExtra)
  remountHost()
  pageHtml = buildPage(lang, opts)
  const p = await browser.newPage({ viewport: { width, height: 1000 } })
  p.errors = []
  p.on('pageerror', (e) => p.errors.push(String(e)))
  await p.goto(BASE + '/')
  await p.waitForFunction(() => { const e = document.querySelector('.kbwk'); return e !== null && !/Loading workers|Chargement des workers/.test(e.textContent) }, null, { timeout: 5000 })
  await p.waitForTimeout(80)
  return p
}
const card = (p, id) => p.textContent('[data-kb="wk-card-' + id + '"]')
const status = (p, id) => p.textContent('[data-kb="wk-status-' + id + '"]').then((t) => t.trim())
const waitStatus = (p, id, re) => p.waitForFunction(([i, r]) => { const e = document.querySelector('[data-kb="wk-status-' + i + '"]'); return e !== null && new RegExp(r).test(e.textContent) }, [id, re.source], { timeout: 6000 }).catch(async (e) => { throw new Error('waiting for status ' + id + ' ' + re + ' — now: ' + (await p.textContent('[data-kb="wk-card-' + id + '"]').catch(() => '?')).slice(0, 300) + ' | errors: ' + p.errors.join(' | ')) })
const waitCard = (p, id, re) => p.waitForFunction(([i, r]) => { const e = document.querySelector('[data-kb="wk-card-' + i + '"]'); return e !== null && new RegExp(r).test(e.textContent) }, [id, re.source], { timeout: 6000 })
const shot = async (p, name) => { if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await p.screenshot({ path: join(SHOTS, name + '.png'), fullPage: true }) } }
const on = (p, sel) => p.$eval(sel, (e) => e.getAttribute('aria-checked') === 'true')
const click = (p, kb) => p.click('[data-kb="' + kb + '"]')
const typeKey = async (p, kb, value) => { await p.fill('[data-kb="' + kb + '"]', value) }
const checkRow = async (p, id) => { await click(p, 'wk-check-row-' + id); await p.waitForFunction((i) => { const e = document.querySelector('[data-kb="wk-status-' + i + '"]'); return e !== null && !/Checking|Vérification/.test(e.textContent) && !/To check|À vérifier/.test(e.textContent) }, id, { timeout: 6000 }) }

try {
  console.log('── the section and the first look ──')
  {
    const p = await open('en')
    const sec = await p.evaluate(() => window.__sections.map((s) => s.meta))
    ok('registers ONE settings section "kybernos-workers" (order 30)', sec.length === 1 && sec[0].id === 'kybernos-workers' && sec[0].order === 30 && sec[0].name === 'settings.section', JSON.stringify(sec))
    const ids = await p.$$eval('[data-kb^="wk-card-"]', (e) => e.map((x) => x.dataset.kb.slice(8)))
    ok('seven rows, in the host’s order: Claude Code, Codex, Gemini, OpenCode, Qwen, Hermes, ZCode', ids.join() === 'claude-code,codex,gemini,opencode,qwen,hermes,zcode', ids.join())
    ok('every row has its logo (an inline SVG symbol, no image)', (await p.$$eval('[data-kb^="wk-card-"] .kbwk-logo use', (e) => e.map((x) => x.getAttribute('href')))).join() === '#kbwk-lg-claude,#kbwk-lg-codex,#kbwk-lg-gemini,#kbwk-lg-opencode,#kbwk-lg-qwen,#kbwk-lg-hermes,#kbwk-lg-term' && (await p.$$('img')).length === 0)
    ok('every logo symbol exists in the page', await p.$$eval('use', (e) => e.every((u) => document.querySelector(u.getAttribute('href')) !== null)))
    ok('Claude Code is not mounted → "Not turned on" with a "Turn on" button', /Not turned on/.test(await status(p, 'claude-code')) && (await p.$('[data-kb="wk-activate-row-claude-code"]')) !== null && (await p.$('[data-kb="wk-check-row-claude-code"]')) === null)
    ok('Codex is mounted but nothing was checked → "To check", NOT "Ready"', /To check/.test(await status(p, 'codex')) && !/Ready/.test(await status(p, 'codex')))
    ok('OpenCode, ZCode: mounted → can be checked', (await p.$('[data-kb="wk-check-row-opencode"]')) !== null && (await p.$('[data-kb="wk-check-row-zcode"]')) !== null)
    ok('Hermes is a worker like the others now: a row with a button (it was "not supported" before)', /Not turned on/.test(await status(p, 'hermes')) && (await p.$$('[data-kb="wk-card-hermes"] button')).length > 0)
    const t = await p.textContent('.kbwk')
    ok('the page says what it does NOT control (model, permissions, duration) and that checking spends nothing', /do not expose them/.test(t) && /calls no model/.test(t))
    ok('the count line closes: 0 ready, 7 to fix', /0\s*ready/.test(t) && /7\s*to fix/.test(t), t.slice(0, 200))
    ok('no invented controls: no selectors, no "parallel", "max duration" or permission-level wording', (await p.$$('.kbwk select')).length === 0 && !/parallel|Parallel|Maximum duration|Read-only/.test(t))
    ok('the words of a developer are gone from the rows (lead, PATH, worktree, MCP, profile)', !/\blead\b|\bMCP\b|connector|worktree/i.test(await p.$$eval('.kbwk-row', (e) => e.map((x) => x.textContent).join(' '))))
    ok('no page error', p.errors.length === 0, p.errors.join(' | '))
    await shot(p, 'workers-initial'); await p.close()
  }

  console.log('── the columns line up ──')
  {
    const p = await open('en', { auth: { claude: true, codex: false, opencodeCount: 2 } })
    await p.click('[data-kb="wk-all"]')
    await p.waitForFunction(() => document.querySelectorAll('[data-kb^="wk-card-"] .kbwk-ev li').length >= 3 || /Last check:/.test(document.querySelector('[data-kb="wk-card-opencode"]').textContent), null, { timeout: 8000 })
    await p.waitForTimeout(400)
    const lefts = await p.$$eval('.kbwk-list > li', (items) => items.map((li) => ({ chip: Math.round(li.querySelector('.kbwk-chip').getBoundingClientRect().left), steps: Math.round(li.querySelector('.kbwk-steps').getBoundingClientRect().left), ctlRight: Math.round(li.querySelector('.kbwk-ctl').getBoundingClientRect().right), name: Math.round(li.querySelector('.kbwk-nom').getBoundingClientRect().left) })))
    const same = (k) => new Set(lefts.map((l) => l[k])).size === 1
    ok('the status chips start at the same x on every row', same('chip'), JSON.stringify(lefts.map((l) => l.chip)))
    ok('the four dots start at the same x on every row', same('steps'), JSON.stringify(lefts.map((l) => l.steps)))
    ok('the actions end at the same x on every row', same('ctlRight'), JSON.stringify(lefts.map((l) => l.ctlRight)))
    ok('the names start at the same x on every row', same('name'), JSON.stringify(lefts.map((l) => l.name)))
    ok('no name is squeezed to nothing (the bug of the five-column row at 720 px)', await p.$$eval('.kbwk-nom', (e) => e.every((x) => x.getBoundingClientRect().width > 40)))
    await shot(p, 'workers-aligned'); await p.close()
  }
  {
    const p = await open('en', {}, 720)
    ok('at the Settings width (720 px) every name is readable and nothing overflows', await p.$$eval('.kbwk-nom', (e) => e.every((x) => x.getBoundingClientRect().width > 60)) && await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
    await shot(p, 'workers-720'); await p.close()
  }

  console.log('── real checks, through the real routes ──')
  {
    const p = await open('en')
    await checkRow(p, 'codex')
    ok('all good → Ready, and the row offers the switch + a re-check icon', /Ready/.test(await status(p, 'codex')) && (await p.$('[data-kb="wk-row-codex-expose"]')) !== null && (await p.$('[data-kb="wk-recheck-codex"]')) !== null)
    await click(p, 'wk-toggle-codex')
    const t = await card(p, 'codex')
    ok('five lines of evidence in the details', (await p.$$('[data-kb="wk-card-codex"] .kbwk-ev li')).length === 5, t)
    ok('the program line carries the path and the version the CLI printed', /\/usr\/local\/bin\/codex/.test(t) && /codex 1\.0\.0/.test(t))
    ok('the sign-in line carries what the CLI said', /Logged in using ChatGPT/.test(t))
    ok('the check ran one real worktree probe on the host', world.checks === 1)
    ok('the last check time is shown', /Last check:/.test(t))
    ok('four green dots when ready', (await p.$$eval('[data-kb="wk-card-codex"] .kbwk-steps i.ok', (e) => e.length)) === 4)

    delete world.binaries.codex
    await click(p, 'wk-recheck-codex')
    await waitStatus(p, 'codex', /To install/)
    const t2 = await card(p, 'codex')
    ok('program gone → "To install", sign-in is NOT claimed, the install is offered', /Sign-in not tested \(program missing\)/.test(t2) && (await p.$('[data-kb="wk-install-codex"]')) !== null && !/Ready/.test(await status(p, 'codex')))
    ok('the row’s button now reads "Install"', /Install/.test(await p.textContent('[data-kb="wk-todo-row-codex"]')))

    world.binaries.codex = '/usr/local/bin/codex'; world.auth.codex = false
    await click(p, 'wk-check-codex')
    await waitStatus(p, 'codex', /To connect/)
    ok('CLI not signed in → "To connect" with the command to type, and what the CLI said', /codex/.test(await p.textContent('[data-kb="wk-todo-codex"] .kbwk-cmd code')) && /Not logged in/.test(await card(p, 'codex')) && /Sign in/.test(await p.textContent('[data-kb="wk-todo-row-codex"]')))

    world.auth.codex = true; world.git = false
    await click(p, 'wk-check-codex')
    await waitStatus(p, 'codex', /Cannot write/)
    ok('worktree probe fails → "Cannot write" with the host’s reason', /git not found/.test(await card(p, 'codex')))

    world.git = true
    await click(p, 'wk-check-row-zcode')
    await waitStatus(p, 'zcode', /To confirm/)
    ok('ZCode: honest "To confirm", and why (its own credential vault)', /handled by the app, not checkable here/.test(await card(p, 'zcode')) && /only a real delegation proves/i.test(await card(p, 'zcode')) && !/Ready/.test(await status(p, 'zcode')))

    await checkRow(p, 'opencode')
    ok('OpenCode: "N credentials" read from its own listing → Ready', /Ready/.test(await status(p, 'opencode')))
    world.auth.opencodeCount = 0
    await p.click('[data-kb="wk-recheck-opencode"]')
    await waitStatus(p, 'opencode', /To connect/)
    ok('OpenCode with no credential → "To connect", with its own command', /opencode auth login/.test(await card(p, 'opencode')))
    ok('no page error', p.errors.length === 0, p.errors.join(' | '))
    await shot(p, 'workers-checked'); await p.close()
  }

  console.log('── check all ──')
  {
    const p = await open('en')
    await p.click('[data-kb="wk-all"]')
    await waitCard(p, 'zcode', /To confirm/)
    await waitCard(p, 'opencode', /Ready|To connect/)
    await waitCard(p, 'codex', /Ready/)
    ok('"Check all" checks the mounted workers (Codex, OpenCode, ZCode) and skips the others', world.checks === 3 && /Not turned on/.test(await status(p, 'claude-code')) && /Not turned on/.test(await status(p, 'gemini')), String(world.checks))
    await p.close()
  }

  console.log('── turning a connection on ──')
  {
    const p = await open('en')
    await p.click('[data-kb="wk-activate-row-claude-code"]')
    await waitCard(p, 'claude-code', /Turned on: connection added to the profile/)
    ok('the Tools route of the main plugin received {family, profile} (Claude Code is mounted there)', world.coreCalls.length === 1 && world.coreCalls[0].family === 'claude-code' && world.coreCalls[0].profile === 'web', JSON.stringify(world.coreCalls))
    ok('the profile now mounts it (read back from the host, not assumed)', etatProfil(world.patch, trouverWorker('claude-code')).connexion === true)
    await p.waitForSelector('[data-kb="wk-check-row-claude-code"]', { timeout: 5000 })
    ok('the row switches to "Check", and the page says DSH loads it by itself — no restart banner', /DSH loads it in a few seconds/.test(await card(p, 'claude-code')) && (await p.$('.kbwk-relance')) === null)
    await click(p, 'wk-check-row-claude-code')
    await waitStatus(p, 'claude-code', /Restart DSH/)
    ok('mounted but the package is not installed yet → "Restart DSH", never "Ready"', !/Ready/.test(await status(p, 'claude-code')))
    ok('and it says what to do: the package is not loaded, restart DSH, then check again', /package is not loaded/.test(await p.textContent('[data-kb="wk-restart-claude-code"]')))
    world.packages.add(PKG_CLAUDE)
    await click(p, 'wk-check-claude-code')
    await waitStatus(p, 'claude-code', /Ready/)
    ok('once the package is there the same check goes Ready', /claude 1\.0\.0/.test(await card(p, 'claude-code')))
    await p.close()
  }
  {
    const p = await open('en', { installRefused: true })
    await p.click('[data-kb="wk-activate-row-claude-code"]')
    await waitCard(p, 'claude-code', /Could not turn it on/)
    ok('a refused activation shows the reason and does not claim success', /EACCES/.test(await card(p, 'claude-code')) && (await p.$('.kbwk-relance')) === null)
    await p.close()
  }
  {
    const p = await open('en')
    await p.click('[data-kb="wk-activate-row-gemini"]')
    await waitCard(p, 'gemini', /Turned on/)
    ok('a home-made connection is mounted by the Workers host itself (not by the Tools screen)', world.coreCalls.length === 0 && etatProfil(world.patch, trouverWorker('gemini')).connexion === true && world.writes.map((w) => w[0]).join() === 'backup,patch')
    await p.click('[data-kb="wk-activate-row-qwen"]')
    await waitCard(p, 'qwen', /does not ship with your Suite yet/)
    ok('a connection whose package is not in the profile is refused with a sentence, and NOTHING is written', etatProfil(world.patch, trouverWorker('qwen')).connexion === false && world.writes.length === 2)
    await p.close()
  }
  {
    const p = await open('en', { coreAbsent: true })
    ok('without the Tools route of the main plugin the page still loads (host default profile)', /Codex/.test(await p.textContent('.kbwk')) && (await p.$('[data-kb="wk-card-codex"]')) !== null)
    await p.close()
  }

  console.log('── installing a program ──')
  {
    const p = await open('en')
    await p.click('[data-kb="wk-activate-row-gemini"]')
    await waitStatus(p, 'gemini', /To check/)
    await click(p, 'wk-check-row-gemini')
    await waitStatus(p, 'gemini', /To install/)
    ok('Gemini mounted but not installed → "To install", and the row says what to do next', /not on this computer yet/.test(await card(p, 'gemini')) && /Install/.test(await p.textContent('[data-kb="wk-todo-row-gemini"]')))
    await click(p, 'wk-todo-row-gemini')
    ok('the details open on the install step, with a button and a "do it myself" way', (await p.$('[data-kb="wk-install-gemini"]')) !== null && (await p.$('[data-kb="wk-diy-gemini"]')) !== null)
    await click(p, 'wk-install-gemini')
    ok('"Install" runs NOTHING: it shows the exact command and where it comes from, and asks', world.installs.length === 0 && (await p.textContent('[data-kb="wk-confirm-gemini"] code')) === 'npm install -g @google/gemini-cli' && /Source: npm/.test(await p.textContent('[data-kb="wk-confirm-gemini"]')))
    await p.click('[data-kb="wk-confirm-gemini"] button:has-text("Cancel")')
    ok('Cancel closes the question and still nothing ran', (await p.$('[data-kb="wk-confirm-gemini"]')) === null && world.installs.length === 0)
    await click(p, 'wk-install-gemini'); await click(p, 'wk-run-gemini')
    await p.waitForSelector('[data-kb="wk-log-gemini"]', { timeout: 4000 })
    ok('confirmed: the host ran the constant command, and the row shows an install in progress', world.installs.join() === 'npm install -g @google/gemini-cli' && /Installing/.test(await p.textContent('[data-kb="wk-card-gemini"] .kbwk-ctl')))
    await waitStatus(p, 'gemini', /To connect/)
    ok('when it finishes DSH checks again BY ITSELF: installed, and now it asks for the API key', (await p.$('[data-kb="wk-key-gemini"]')) !== null && world.checks >= 1)
    await shot(p, 'workers-key'); await p.close()
  }
  {
    const p = await open('en', { installExit: 243, installLines: ['npm ERR! code EACCES', 'npm ERR! permission denied'] })
    await p.click('[data-kb="wk-activate-row-gemini"]'); await waitStatus(p, 'gemini', /To check/)
    await click(p, 'wk-check-row-gemini'); await waitStatus(p, 'gemini', /To install/)
    await click(p, 'wk-todo-row-gemini'); await click(p, 'wk-install-gemini'); await click(p, 'wk-run-gemini')
    await p.waitForSelector('[data-kb="wk-failed-gemini"]', { timeout: 6000 })
    const t = await p.textContent('[data-kb="wk-failed-gemini"]')
    ok('a failed install shows what the installer said and a sentence about the permissions', /EACCES/.test(t) && /permissions/.test(t))
    ok('and offers to try again or to do it by hand, without claiming success', (await p.$('[data-kb="wk-install-gemini"]')) !== null && (await p.$('[data-kb="wk-diy-gemini"]')) !== null && /To install/.test(await status(p, 'gemini')))
    await click(p, 'wk-diy-gemini')
    ok('"do it myself" shows the command to copy, the Homebrew line and the vendor’s guide', /brew install gemini-cli/.test(await card(p, 'gemini')) && (await p.$('[data-kb="wk-card-gemini"] a[href^="https://github.com/google-gemini"]')) !== null)
    await shot(p, 'workers-install-failed'); await p.close()
  }
  {
    const p = await open('en', { installOnPath: false })
    await p.click('[data-kb="wk-activate-row-gemini"]'); await waitStatus(p, 'gemini', /To check/)
    await click(p, 'wk-check-row-gemini'); await waitStatus(p, 'gemini', /To install/)
    await click(p, 'wk-todo-row-gemini'); await click(p, 'wk-install-gemini'); await click(p, 'wk-run-gemini')
    await p.waitForSelector('[data-kb="wk-path-gemini"]', { timeout: 6000 })
    ok('installed but not in DSH’s PATH yet: the page says "restart DSH" and offers no second install', /restart DSH/.test(await p.textContent('[data-kb="wk-path-gemini"]')) && (await p.$('[data-kb="wk-install-gemini"]')) === null && (await p.$('.kbwk-relance')) !== null)
    await p.close()
  }
  {
    const p = await open('en', { binaries: { codex: '/usr/local/bin/codex', curl: '/usr/bin/curl', bash: '/bin/bash' } })
    await p.click('[data-kb="wk-activate-row-gemini"]'); await waitStatus(p, 'gemini', /To check/)
    await click(p, 'wk-check-row-gemini'); await waitStatus(p, 'gemini', /To install/)
    await click(p, 'wk-todo-row-gemini'); await click(p, 'wk-install-gemini'); await click(p, 'wk-run-gemini')
    await waitCard(p, 'gemini', /npm \(it comes with Node\.js\) is not installed/)
    ok('npm missing on the machine: refused BEFORE running anything, with the way out (Node.js or Homebrew)', world.installs.length === 0)
    await p.close()
  }
  {
    const p = await open('en', { platform: 'win32' })
    await p.click('[data-kb="wk-activate-row-gemini"]'); await waitStatus(p, 'gemini', /To check/)
    await click(p, 'wk-check-row-gemini'); await waitStatus(p, 'gemini', /To install/)
    await click(p, 'wk-todo-row-gemini')
    ok('on a system where the automatic install does not exist (Windows): no install button, the command and the guide only', (await p.$('[data-kb="wk-install-gemini"]')) === null && (await p.$('[data-kb="wk-diy-gemini"]')) !== null && /official guide/.test(await card(p, 'gemini')))
    await p.close()
  }

  console.log('── an API key (Gemini, Qwen) ──')
  {
    const p = await open('en', { binaries: { gemini: '/usr/local/bin/gemini', npm: '/bin/npm', curl: '/bin/curl', bash: '/bin/bash' } })
    await p.click('[data-kb="wk-activate-row-gemini"]'); await waitStatus(p, 'gemini', /To check/)
    await click(p, 'wk-check-row-gemini'); await waitStatus(p, 'gemini', /To connect/)
    ok('no key: the row says the key is missing, and says it is a key and not a Google sign-in', /API key is missing/.test(await card(p, 'gemini')) && /does not go through a Google account sign-in/.test(await card(p, 'gemini')))
    ok('the key goes into a password field, never a plain one', (await p.getAttribute('[data-kb="wk-key-gemini"]', 'type')) === 'password')
    await click(p, 'wk-savekey-gemini')
    ok('saving an empty field is refused with a sentence, nothing is sent', /Paste your key first/.test(await card(p, 'gemini')) && (await p.evaluate(() => window.__credentialSets.length)) === 0)
    await typeKey(p, 'wk-key-gemini', 'AIza-secret-value')
    await click(p, 'wk-savekey-gemini')
    await waitCard(p, 'gemini', /Key saved/)
    ok('the key was handed to the credentials service under GEMINI_API_KEY', JSON.stringify(await p.evaluate(() => window.__credentialSets)) === '[["GEMINI_API_KEY","AIza-secret-value"]]')
    ok('the key is on no page text, and the field is gone (replaced by "a key is saved: restart DSH")', !(await p.textContent('body')).includes('AIza-secret-value') && (await p.$('[data-kb="wk-key-gemini"]')) === null && (await p.$('[data-kb="wk-key-stored-gemini"]')) !== null)
    ok('and a restart is asked for', (await p.$('.kbwk-relance')) !== null)
    world.env.add('GEMINI_API_KEY')
    // DSH restarted: it now has the key in its environment
    await click(p, 'wk-check-gemini')
    await waitStatus(p, 'gemini', /Ready/)
    ok('once DSH has the key in its environment the same check goes Ready, and the page only says "API key found"', /API key found/.test(await card(p, 'gemini')) && !(await card(p, 'gemini')).includes('AIza'))
    ok('no page error', p.errors.length === 0, p.errors.join(' | '))
    await p.close()
  }
  {
    const p = await open('en', { binaries: { gemini: '/usr/local/bin/gemini' } }, 1000, { noCredentials: true })
    await p.click('[data-kb="wk-activate-row-gemini"]'); await waitStatus(p, 'gemini', /To check/)
    await click(p, 'wk-check-row-gemini'); await waitStatus(p, 'gemini', /To connect/)
    ok('without a credentials service the page still works: it says where the key goes, and has no field', (await p.$('[data-kb="wk-key-gemini"]')) === null && /GEMINI_API_KEY/.test(await card(p, 'gemini')))
    await p.close()
  }

  console.log('── policy: allowed / background ──')
  {
    const p = await open('en')
    await checkRow(p, 'codex')
    await click(p, 'wk-toggle-codex')
    ok('the policy section exists on Codex (ready), both switches off, Save disabled', /Permissions/.test(await card(p, 'codex')) && !(await on(p, '[data-kb="wk-codex-expose"]')) && !(await on(p, '[data-kb="wk-codex-background"]')) && await p.$eval('[data-kb="wk-apply-codex"]', (e) => e.disabled))
    ok('the background switch is locked while the worker is not allowed', await p.$eval('[data-kb="wk-codex-background"]', (e) => e.disabled))
    await click(p, 'wk-row-codex-expose')
    ok('the row’s own "Allowed" switch and the one in the details are the same draft; Save appears in the row', (await on(p, '[data-kb="wk-codex-expose"]')) && (await p.$('[data-kb="wk-apply-row-codex"]')) !== null && !(await p.$eval('[data-kb="wk-codex-background"]', (e) => e.disabled)))
    ok('nothing was written yet (a draft is only a draft)', world.writes.length === 0)
    await click(p, 'wk-apply-row-codex')
    await waitCard(p, 'codex', /Written to the profile/)
    ok('the host made the backup FIRST, then wrote the patch', world.writes.map((w) => w[0]).join() === 'backup,patch' && /bak-workers-codex-20261008-120000/.test(world.writes[0][1]))
    ok('the page tells which backup and that DSH applies it by itself (no restart, no banner)', /bak-workers-codex-20261008-120000/.test(await card(p, 'codex')) && /DSH applies it in a few seconds/.test(await card(p, 'codex')) && (await p.$('.kbwk-relance')) === null)
    const l = etatProfil(world.patch, trouverWorker('codex')).ligne
    ok('the profile holds the tool line: exposed, background off', l !== null && l.nous && l.expose && !l.arrierePlan)
    ok('after the reload the switches mirror the PROFILE (read back), Save is disabled again', (await on(p, '[data-kb="wk-codex-expose"]')) && await p.$eval('[data-kb="wk-apply-codex"]', (e) => e.disabled))
    await click(p, 'wk-codex-background'); await click(p, 'wk-apply-codex')
    await p.waitForFunction(() => /bak-workers/.test(document.querySelector('[data-kb="wk-card-codex"] .kbwk-msg.ok')?.textContent || '') && /background|Written/.test(document.querySelector('[data-kb="wk-card-codex"]').textContent), null, { timeout: 5000 })
    await p.waitForTimeout(300)
    ok('flipping background edits the same line in place (no second line)', (world.patch.match(/subagent_codex/g) || []).length === 1 && etatProfil(world.patch, trouverWorker('codex')).ligne.arrierePlan === true)
    await click(p, 'wk-codex-expose')
    ok('switching "allowed" off also drops background in the draft', !(await on(p, '[data-kb="wk-codex-background"]')))
    ok('no page error', p.errors.length === 0, p.errors.join(' | '))
    await shot(p, 'workers-policy'); await p.close()
  }
  {
    const foreign = PATCH0 + `\n- insert:\n    - id: my-tool\n      name: '@deepseek-ai/dsh-tool-subagent'\n      config:\n        provider: codex\n        toolName: subagent_codex\n        enableRunInBackground: true\n        maxDepth: provider-managed\n`
    const p = await open('en', { patch: foreign })
    await checkRow(p, 'codex')
    await click(p, 'wk-toggle-codex')
    const t = await card(p, 'codex')
    ok('a tool line written by someone else: shown read-only with its state, no switch to fight it', /defined elsewhere in your profile/.test(t) && /exposed yes, background yes/.test(t) && (await p.$('[data-kb="wk-codex-expose"]')) === null && (await p.$('[data-kb="wk-row-codex-expose"]')) === null)
    await p.close()
  }

  console.log('── the guide and its demo ──')
  {
    const p = await open('en')
    ok('the shared help card is on the page, and nothing else is a second help button', (await p.$('[data-kb="help-button"][data-id="kybernos-workers"]')) !== null && (await p.$('[data-kb="wk-guide"]')) === null)
    await click(p, 'help-button')
    ok('the card carries the action that opens the guide', /Try the demo/.test(await p.textContent('[data-kb="help-action"]')))
    await click(p, 'help-action')
    await p.waitForSelector('[data-kb="workers-guide"]', { timeout: 3000 })
    ok('the guide opens as a dialog and the card is closed', (await p.getAttribute('.kbwk-dlg', 'role')) === 'dialog' && (await p.$('[data-kb="help-panel"]')) === null)
    ok('focus moves into the dialog', await p.waitForFunction(() => document.activeElement === document.querySelector('.kbwk-dlg'), null, { timeout: 2000 }).then(() => true, () => false))
    const mini = () => p.textContent('.kbwk-mini .kbwk-chip').then((t) => t.trim())
    await click(p, 'guide-activate'); ok('1. Turn on → "To check"', /To check/.test(await mini()))
    await click(p, 'guide-next'); await click(p, 'guide-check'); await p.waitForFunction(() => /To install/.test(document.querySelector('.kbwk-mini .kbwk-chip').textContent), null, { timeout: 4000 })
    ok('2. Check → "To install"', true)
    await click(p, 'guide-next'); await click(p, 'guide-ask')
    ok('3. Install → shows the exact command and its source, asks', (await p.textContent('.kbwk-stage .kbwk-cmd code')) === 'curl -fsSL https://claude.ai/install.sh | bash')
    ok('the demo installs NOTHING on this machine (no request left the page)', world.installs.length === 0)
    await click(p, 'guide-run'); await p.waitForFunction(() => /To connect/.test(document.querySelector('.kbwk-mini .kbwk-chip').textContent), null, { timeout: 5000 })
    ok('… then checks again by itself → "To connect"', true)
    await click(p, 'guide-next'); await click(p, 'guide-signin'); await p.waitForFunction(() => /signed in/.test(document.querySelector('.kbwk-term pre').textContent), null, { timeout: 5000 })
    ok('4. Sign in (in the terminal)', true)
    await click(p, 'guide-next'); await click(p, 'guide-check'); await p.waitForFunction(() => /Ready/.test(document.querySelector('.kbwk-mini .kbwk-chip').textContent), null, { timeout: 6000 })
    ok('5. Check again: the five checks tick one by one → "Ready"', (await p.$$('.kbwk-checks li.on')).length === 5)
    await click(p, 'guide-next'); await click(p, 'guide-expose'); await click(p, 'guide-save')
    ok('6. Allow → Save → "DSH applies it in a few seconds"', /DSH applies it in a few seconds/.test(await p.textContent('.kbwk-stage')))
    await click(p, 'guide-next'); await click(p, 'guide-send'); await p.waitForFunction(() => /done/.test(document.querySelector('.kbwk-job .t')?.textContent || ''), null, { timeout: 6000 })
    ok('7. Delegate: the message, the hand-over, the job in the background, the result', (await p.$$('.kbwk-bub')).length === 3)
    ok('the demo touched no real worker: the page behind kept its own state and wrote nothing', world.writes.length === 0 && world.coreCalls.length === 0)
    await shot(p, 'workers-guide')
    await p.keyboard.press('Escape')
    await p.waitForTimeout(150)
    ok('Escape closes the guide', (await p.$('[data-kb="workers-guide"]')) === null)
    await click(p, 'help-button'); await click(p, 'help-action'); await p.waitForSelector('[data-kb="workers-guide"]')
    await click(p, 'guide-close'); await p.waitForTimeout(100)
    ok('the close button closes it too', (await p.$('[data-kb="workers-guide"]')) === null)
    ok('no page error', p.errors.length === 0, p.errors.join(' | '))
    await p.close()
  }
  {
    const p = await open('en', {}, 1000, { oldSuite: true })
    ok('an older Suite whose help card has no action: the guide gets a button of its own', (await p.$('[data-kb="help-button"]')) === null && (await p.$('[data-kb="wk-guide"]')) !== null)
    await click(p, 'wk-guide'); await p.waitForSelector('[data-kb="workers-guide"]')
    ok('and it opens the same guide', /How it works/.test(await p.textContent('.kbwk-dlg h3')))
    await p.close()
  }

  console.log('── failure and language ──')
  {
    const p = await open('en', { hostAbsent: true })
    const t = await p.textContent('.kbwk')
    ok('host routes missing (not restarted yet): a clear banner, not an empty screen', /cannot be reached/.test(t) && /restart DSH after installing/.test(t) && (await p.$('[data-kb^="wk-card-"]')) === null)
    world.hostAbsent = false
    await p.click('.kbwk button:has-text("Retry")')
    await p.waitForSelector('[data-kb="wk-card-codex"]', { timeout: 5000 })
    ok('Retry recovers once the host answers', (await p.$('[data-kb="wk-card-codex"]')) !== null)
    await p.close()
  }
  {
    const p = await open('fr', {}, 390)
    await click(p, 'wk-check-row-codex')
    await waitStatus(p, 'codex', /Prêt/)
    const t = await p.textContent('.kbwk')
    ok('French labels', t.includes('Des assistants de code installés') && t.includes('Tout vérifier') && t.includes('Pas activé') && t.includes('Autorisé'))
    await click(p, 'wk-toggle-codex')
    ok('French evidence lines', (await card(p, 'codex')).includes('Programme trouvé dans le PATH de DSH'))
    ok('no horizontal scroll at 390 px', await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), String(await p.evaluate(() => document.documentElement.scrollWidth)))
    ok('at 390 px the row stacks: name, then status + dots, then the action', await p.$eval('[data-kb="wk-card-codex"]', (li) => { const n = li.querySelector('.kbwk-main').getBoundingClientRect(); const c = li.querySelector('.kbwk-chip').getBoundingClientRect(); const a = li.querySelector('.kbwk-ctl').getBoundingClientRect(); return c.top >= n.bottom - 1 && a.top >= c.bottom - 1 }))
    await shot(p, 'workers-fr-390'); await p.close()
  }
  {
    const p = await open('de', {})
    ok('a language the page is not translated into gets English, never French', /Coding assistants installed on your computer/.test(await p.textContent('.kbwk')))
    await p.close()
  }
} finally {
  await browser.close()
  server.close()
}

console.log('\nWORKERS GUI — ' + total + ' assertions, ' + failures + ' failure(s)')
process.exit(failures === 0 ? 0 : 1)

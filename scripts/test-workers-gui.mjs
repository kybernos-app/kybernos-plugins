// Workers screen — the REAL client in a real browser, talking to the REAL host routes
// (monterWorkers) over real HTTP on 127.0.0.1, so the same-origin guards are exercised too.
// Only the world around is faked: the profile patch lives in memory, binaries/auth/git are toggles.
//   node scripts/test-workers-gui.mjs [--shots <dir>]
// Needs Playwright (with a Chromium) and React 18 UMD builds; when one is missing the
// test says so and exits 0 (SKIPPED).   KB_CHROMIUM=/path/to/chromium   KB_BENCH_DEPS=/dir/with/node_modules
import { createServer } from 'node:http'
import { readFileSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ICI = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(ICI, '..')
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

let echecs = 0
let total = 0
const ok = (nom, cond, detail) => { total++; if (cond) console.log('  ✓ ' + nom); else { echecs++; console.log('  ✗ ' + nom + (detail !== undefined ? ' — ' + detail : '')) } }

const PATCH0 = `# Patch de profil — ecrit par l onglet Outils (Kybers).

- insert:
    - id: codex
      name: '@deepseek-ai/dsh-subagent-codex'

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
let monde
const nouveauMonde = (extra = {}) => ({
  patch: PATCH0, ecritures: [], appelsCore: [], verifs: 0,
  binaires: { claude: '/usr/local/bin/claude', codex: '/usr/local/bin/codex' },
  auth: { claude: true, codex: true }, paquets: [PKG_CODEX], git: true,
  hoteAbsent: false, coreAbsent: false, installRefuse: false, ...extra
})
const deps = () => ({
  profils: () => ['web'], profilParDefaut: () => 'web',
  lirePatch: () => monde.patch, cheminPatch: (p) => '/home/u/.dsh/profiles/' + p + '/cordis.patch.yml',
  ecrirePatch: (p, t) => { monde.ecritures.push(['patch']); monde.patch = t },
  sauvegarder: (p, n) => { monde.ecritures.push(['sauvegarde', n]) },
  maintenant: () => new Date(2026, 9, 3, 12, 0, 0),
  io: {
    fichierServeur: '/home/u/.dsh/mcp/zcode-mcp-server.mjs',
    paquetInstalle: (p, pkg) => monde.paquets.includes(pkg),
    fichierExiste: () => true,
    trouver: async (b) => monde.binaires[b] ?? null,
    executer: async (b, a) => {
      if (a[0] === '--version') return { code: 0, sortie: b + ' 1.0.0\n' }
      if (b === 'claude') return { code: monde.auth.claude ? 0 : 1, sortie: JSON.stringify({ loggedIn: monde.auth.claude, authMethod: 'oauth_token' }) }
      return { code: monde.auth.codex ? 0 : 1, sortie: monde.auth.codex ? 'Logged in using ChatGPT\n' : 'Not logged in\n' }
    },
    worktreeJetable: async () => { monde.verifs++; return { ok: monde.git, detail: monde.git ? 'git version 2.34.1' : 'git introuvable' } }
  }
})
// A fresh host per scenario: it keeps the last check of each worker in memory, like the real one.
let routesHote = new Map()
const remonterHote = () => { routesHote = new Map(); monterWorkers({ register: ({ path, handler }) => routesHote.set(path, handler) }, deps()) }

const corps = async (req) => { const m = []; for await (const c of req) m.push(c); return m.length ? JSON.parse(Buffer.concat(m).toString()) : {} }
const json = (res, s, o) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)) }
let pageHtml = ''
const serveur = createServer(async (req, res) => {
  const chemin = req.url.split('?')[0]
  if (chemin === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(pageHtml) }
  if (chemin.startsWith('/kybernos-workers/')) {
    if (monde.hoteAbsent) return json(res, 404, { ok: false })
    return routesHote.get(chemin)(req, res)
  }
  // the core's Outils page, as far as the Workers screen uses it
  if (chemin === '/kybernos/tools/state') return monde.coreAbsent ? json(res, 404, {}) : json(res, 200, { ok: true, profile: 'web' })
  if (chemin === '/kybernos/tools/apply') {
    if (monde.coreAbsent) return json(res, 404, {})
    const b = await corps(req)
    monde.appelsCore.push(b)
    if (monde.installRefuse) return json(res, 200, { ok: false, error: 'ecriture refusee : EACCES' })
    const w = trouverWorker(b.family)
    if (etatProfil(monde.patch, w).connexion) return json(res, 200, { ok: true, already: true })
    monde.patch += `\n- insert:\n    - id: subagent-${w.id}\n      name: '${w.paquet}'\n`
    return json(res, 200, { ok: true, restart: true, backup: 'cordis.patch.yml.bak-outils-' + w.id })
  }
  json(res, 404, {})
})
await new Promise((r) => serveur.listen(0, '127.0.0.1', r))
const URL_BASE = 'http://127.0.0.1:' + serveur.address().port

const construirePage = (lang) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{--dsw-alias-label-primary:#ececee;--dsw-alias-label-secondary:#b4b4bb;--dsw-alias-label-tertiary:#8b8b93;--dsw-alias-label-primary-foreground:#111;
--dsw-alias-border-l1:#2e2e32;--dsw-alias-border-l2:#3a3a40;--dsw-alias-bg-layer-1:#1c1c1e;--dsw-alias-bg-layer-2:#242427;--dsw-alias-bg-layer-3:#2e2e32;
--dsw-alias-button-primary-fill:#ececee;--dsw-alias-state-success-primary:#4cc38a;--dsw-alias-state-warn-primary:#f0b429;--dsw-alias-state-error-primary:#ef6b6b}
body{margin:0;padding:20px;background:#161617;font-family:system-ui,sans-serif;color:#ececee}
</style></head><body><div id="root"></div>
<script>${reactJs}</script><script>${reactDomJs}</script>
<script>
window.__KB_LANG_RESOLVE__ = () => ${JSON.stringify(lang)}
window.__sections = []
const slots = { inject: (nom, fn) => fn(), register: (meta, comp) => { window.__sections.push({ meta, comp }); return () => {} }, entriesOfSlot: () => [] }
window.__ModuleLoader__ = { load: (def) => { window.__def = def } }
</script>
<script>${clientJs}</script>
<script>
const modele = window.__def.factory((nom) => { if (nom === 'react') return React; throw new Error('no ' + nom) })
const ctx = { effect: (fn) => fn(), inject: (liste, cb) => cb({ slots }) }
modele.apply(ctx)
const s = window.__sections[0]
if (s) ReactDOM.render(React.createElement(s.comp), document.getElementById('root'))
</script></body></html>`

const opts = { headless: true }
if (process.env.KB_CHROMIUM) opts.executablePath = process.env.KB_CHROMIUM
const navigateur = await playwright.chromium.launch(opts)

const ouvrir = async (lang, mondeExtra = {}, largeur = 1000, attendre = true) => {
  monde = nouveauMonde(mondeExtra)
  remonterHote()
  pageHtml = construirePage(lang)
  const p = await navigateur.newPage({ viewport: { width: largeur, height: 1000 } })
  p.erreurs = []
  p.on('pageerror', (e) => p.erreurs.push(String(e)))
  await p.goto(URL_BASE + '/')
  if (attendre) await p.waitForFunction(() => { const e = document.querySelector('.kbwk'); return e !== null && !/Loading workers|Chargement des workers/.test(e.textContent) }, null, { timeout: 5000 })
  await p.waitForTimeout(80)
  return p
}
const carte = (p, id) => p.textContent('[data-kb="wk-card-' + id + '"]')
const attendreCarte = (p, id, re) => p.waitForFunction(([i, r]) => { const e = document.querySelector('[data-kb="wk-card-' + i + '"]'); return e !== null && new RegExp(r).test(e.textContent) }, [id, re.source], { timeout: 5000 })
const montrer = async (p, nom) => { if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await p.screenshot({ path: join(SHOTS, nom + '.png'), fullPage: true }) } }
const actif = (p, sel) => p.$eval(sel, (e) => e.getAttribute('aria-checked') === 'true')

try {
  console.log('── section and first look ──')
  {
    const p = await ouvrir('en')
    const sec = await p.evaluate(() => window.__sections.map((s) => s.meta))
    ok('registers ONE settings section "kybernos-workers" (order 30)', sec.length === 1 && sec[0].id === 'kybernos-workers' && sec[0].order === 30 && sec[0].name === 'settings.section', JSON.stringify(sec))
    const ids = await p.$$eval('[data-kb^="wk-card-"]', (e) => e.map((x) => x.dataset.kb.slice(8)))
    ok('four cards: Claude Code, Codex, ZCode, Hermes', ids.join() === 'claude-code,codex,zcode,hermes', ids.join())
    ok('Claude Code is not mounted in the profile → says so, offers to install the connection', /Connection not mounted/.test(await carte(p, 'claude-code')) && (await p.$('[data-kb="wk-install-claude-code"]')) !== null && (await p.$('[data-kb="wk-check-claude-code"]')) === null)
    ok('Codex is mounted but nothing was checked yet → "Not checked yet", NOT "Ready"', /Not checked yet/.test(await carte(p, 'codex')) && !/Ready/.test(await carte(p, 'codex')))
    ok('ZCode is mounted → can be checked', /Not checked yet/.test(await carte(p, 'zcode')) && (await p.$('[data-kb="wk-check-zcode"]')) !== null)
    const h = await carte(p, 'hermes')
    ok('Hermes: not supported, no button at all', /Not supported/.test(h) && (await p.$$('[data-kb="wk-card-hermes"] button')).length === 0)
    ok('the screen says what it does NOT control (model, permissions, duration) and that checking spends nothing', /do not expose them/.test(await p.textContent('.kbwk')) && /calls no model/.test(await p.textContent('.kbwk')))
    ok('no policy section on an unmounted worker', !/Delegation by the lead/.test(await carte(p, 'claude-code')))
    ok('no invented controls: no "parallel", "max duration" or permission-level selectors anywhere', (await p.$$('.kbwk select')).length === 0 && !/parallel|Parallel|Maximum duration|Read-only/.test(await p.textContent('.kbwk')))
    ok('no page error', p.erreurs.length === 0, p.erreurs.join(' | '))
    await montrer(p, 'workers-initial'); await p.close()
  }

  console.log('── real checks, through the real routes ──')
  {
    const p = await ouvrir('en')
    await p.click('[data-kb="wk-check-codex"]')
    await attendreCarte(p, 'codex', /Ready/)
    const t = await carte(p, 'codex')
    ok('all good → Ready, five lines of evidence', /Ready/.test(t) && (await p.$$('[data-kb="wk-card-codex"] .kbwk-ctl li')).length === 5, t)
    ok('the binary line carries the path and the version the CLI printed', /\/usr\/local\/bin\/codex/.test(t) && /codex 1\.0\.0/.test(t))
    ok('the sign-in line carries what the CLI said', /Logged in using ChatGPT/.test(t))
    ok('the check ran one real worktree probe on the host', monde.verifs === 1)
    ok('the last check time is shown', /Last check:/.test(t))
    ok('the button now reads "Check again"', /Check again/.test(await p.textContent('[data-kb="wk-check-codex"]')))

    monde.binaires.codex = null
    await p.click('[data-kb="wk-check-codex"]')
    await attendreCarte(p, 'codex', /Not installed on this machine/)
    const t2 = await carte(p, 'codex')
    ok('binary gone → "Not installed", sign-in is NOT claimed, the fix is written out', /Sign-in not tested \(binary missing\)/.test(t2) && /Install the Codex CLI/.test(t2) && !/Ready/.test(t2))

    monde.binaires.codex = '/usr/local/bin/codex'; monde.auth.codex = false
    await p.click('[data-kb="wk-check-codex"]')
    await attendreCarte(p, 'codex', /Not signed in/)
    ok('CLI not signed in → "Not signed in" with the exact command to run', /codex login/.test(await carte(p, 'codex')) && /Not logged in/.test(await carte(p, 'codex')))

    monde.auth.codex = true; monde.git = false
    await p.click('[data-kb="wk-check-codex"]')
    await attendreCarte(p, 'codex', /Cannot write/)
    ok('worktree probe fails → "Cannot write" with the host\'s reason', /git introuvable/.test(await carte(p, 'codex')))

    monde.git = true
    await p.click('[data-kb="wk-check-zcode"]')
    await attendreCarte(p, 'zcode', /partly verified/)
    ok('ZCode: honest "partly verified", and why (own credential vault)', /handled by the app, not checkable here/.test(await carte(p, 'zcode')) && /only a real delegation attempt proves/.test(await carte(p, 'zcode')) && !/Ready/.test(await carte(p, 'zcode')))
    ok('no page error', p.erreurs.length === 0, p.erreurs.join(' | '))
    await montrer(p, 'workers-checked'); await p.close()
  }

  console.log('── check all ──')
  {
    const p = await ouvrir('en')
    await p.click('[data-kb="wk-all"]')
    await attendreCarte(p, 'zcode', /Last check:/)
    await attendreCarte(p, 'codex', /Last check:/)
    ok('"Check all" checks the mounted workers (Codex, ZCode), skips the unmounted one', monde.verifs === 2 && !/Last check:/.test(await carte(p, 'claude-code')), String(monde.verifs))
    await p.close()
  }

  console.log('── installing a connection ──')
  {
    const p = await ouvrir('en')
    await p.click('[data-kb="wk-install-claude-code"]')
    await attendreCarte(p, 'claude-code', /Connection added to the profile/)
    ok('the Outils route of the core received {family, profile}', monde.appelsCore.length === 1 && monde.appelsCore[0].family === 'claude-code' && monde.appelsCore[0].profile === 'web', JSON.stringify(monde.appelsCore))
    ok('the profile now mounts it (read back from the host, not assumed)', etatProfil(monde.patch, trouverWorker('claude-code')).connexion === true)
    await p.waitForSelector('[data-kb="wk-check-claude-code"]', { timeout: 5000 })
    ok('the card switches to "Check" and a "restart DSH" banner appears', (await p.$('[data-kb="wk-check-claude-code"]')) !== null && /Change pending/.test(await p.textContent('.kbwk-relance')))
    await p.click('[data-kb="wk-check-claude-code"]')
    await attendreCarte(p, 'claude-code', /Mounted: restart DSH/)
    ok('mounted but the package is not installed yet → "Mounted: restart DSH", never "Ready"', /restart DSH/.test(await carte(p, 'claude-code')) && !/Ready/.test(await carte(p, 'claude-code')))
    monde.paquets.push(PKG_CLAUDE)
    await p.click('[data-kb="wk-check-claude-code"]')
    await attendreCarte(p, 'claude-code', /Ready/)
    ok('after the restart (package present) the same check goes Ready', /Ready/.test(await carte(p, 'claude-code')) && /claude 1\.0\.0/.test(await carte(p, 'claude-code')))
    await p.close()
  }
  {
    const p = await ouvrir('en', { installRefuse: true })
    await p.click('[data-kb="wk-install-claude-code"]')
    await attendreCarte(p, 'claude-code', /Install failed/)
    ok('a refused install shows the reason and does not claim success or a pending restart', /EACCES/.test(await carte(p, 'claude-code')) && (await p.$('.kbwk-relance')) === null)
    await p.close()
  }
  {
    const p = await ouvrir('en', { coreAbsent: true })
    ok('without the core\'s Outils route the screen still loads (host default profile)', /Codex/.test(await p.textContent('.kbwk')) && (await p.$('[data-kb="wk-card-codex"]')) !== null)
    await p.close()
  }

  console.log('── policy: exposed to the lead / background ──')
  {
    const p = await ouvrir('en')
    ok('the policy section exists on Codex (mounted) with both switches off', /Delegation by the lead/.test(await carte(p, 'codex')) && !(await actif(p, '[data-kb="wk-codex-expose"]')) && !(await actif(p, '[data-kb="wk-codex-arrierePlan"]')))
    ok('Apply is disabled while nothing changed', await p.$eval('[data-kb="wk-apply-codex"]', (e) => e.disabled))
    ok('the background switch is locked while the worker is not exposed', await p.$eval('[data-kb="wk-codex-arrierePlan"]', (e) => e.disabled))
    await p.click('[data-kb="wk-codex-expose"]')
    ok('exposing unlocks background and enables Apply', (await actif(p, '[data-kb="wk-codex-expose"]')) && !(await p.$eval('[data-kb="wk-codex-arrierePlan"]', (e) => e.disabled)) && !(await p.$eval('[data-kb="wk-apply-codex"]', (e) => e.disabled)))
    ok('nothing was written yet (a draft is only a draft)', monde.ecritures.length === 0)
    await p.click('[data-kb="wk-apply-codex"]')
    await attendreCarte(p, 'codex', /Written to the profile/)
    ok('the host made the backup FIRST, then wrote the patch', monde.ecritures.map((e) => e[0]).join() === 'sauvegarde,patch' && /bak-workers-codex-20261003-120000/.test(monde.ecritures[0][1]))
    ok('the card tells which backup and that a restart is needed', /bak-workers-codex-20261003-120000/.test(await carte(p, 'codex')) && /Restart DSH to apply/.test(await carte(p, 'codex')) && /Change pending/.test(await p.textContent('.kbwk-relance')))
    const l = etatProfil(monde.patch, trouverWorker('codex')).ligne
    ok('the profile holds the tool line: exposed, background off', l !== null && l.nous && l.expose && !l.arrierePlan)
    ok('after the reload the switches mirror the PROFILE (read back), Apply is disabled again', (await actif(p, '[data-kb="wk-codex-expose"]')) && await p.$eval('[data-kb="wk-apply-codex"]', (e) => e.disabled))
    await p.click('[data-kb="wk-codex-arrierePlan"]')
    await p.click('[data-kb="wk-apply-codex"]')
    await p.waitForFunction(() => document.querySelectorAll('.kbwk-msg.ok').length > 0 && /bak-workers/.test(document.querySelector('.kbwk-msg.ok').textContent), null, { timeout: 5000 })
    ok('flipping background edits the same line in place (no second line)', (monde.patch.match(/subagent_codex/g) || []).length === 1 && etatProfil(monde.patch, trouverWorker('codex')).ligne.arrierePlan === true)
    await p.click('[data-kb="wk-codex-expose"]')
    ok('switching exposure off also drops background in the draft', !(await actif(p, '[data-kb="wk-codex-arrierePlan"]')))
    ok('no page error', p.erreurs.length === 0, p.erreurs.join(' | '))
    await montrer(p, 'workers-policy'); await p.close()
  }
  {
    const etranger = PATCH0 + `\n- insert:\n    - id: mon-outil\n      name: '@deepseek-ai/dsh-tool-subagent'\n      config:\n        provider: codex\n        toolName: subagent_codex\n        enableRunInBackground: true\n        maxDepth: provider-managed\n`
    const p = await ouvrir('en', { patch: etranger })
    const t = await carte(p, 'codex')
    ok('a tool line written by someone else: shown read-only with its state, no switch to fight it', /defined elsewhere in your profile/.test(t) && /exposed yes, background yes/.test(t) && (await p.$('[data-kb="wk-codex-expose"]')) === null)
    await p.close()
  }

  console.log('── failure and language ──')
  {
    const p = await ouvrir('en', { hoteAbsent: true })
    const t = await p.textContent('.kbwk')
    ok('host routes missing (not restarted yet): a clear banner, not an empty screen', /cannot be reached/.test(t) && /restart DSH after installing/.test(t) && (await p.$('[data-kb^="wk-card-"]')) === null)
    monde.hoteAbsent = false
    await p.click('.kbwk button:has-text("Retry")')
    await p.waitForSelector('[data-kb="wk-card-codex"]', { timeout: 5000 })
    ok('Retry recovers once the host answers', (await p.$('[data-kb="wk-card-codex"]')) !== null)
    await p.close()
  }
  {
    const p = await ouvrir('fr', {}, 390)
    await p.click('[data-kb="wk-check-codex"]')
    await attendreCarte(p, 'codex', /Prêt/)
    const t = await p.textContent('.kbwk')
    ok('French labels', t.includes('Les agents de code externes') && t.includes('Tout vérifier') && t.includes('Connexion non montée') && t.includes('Délégation par le lead'))
    ok('French evidence lines', (await carte(p, 'codex')).includes('Binaire trouvé dans le PATH de DSH'))
    ok('no horizontal scroll at 390 px', await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), String(await p.evaluate(() => document.documentElement.scrollWidth)))
    await montrer(p, 'workers-fr-390'); await p.close()
  }
} finally {
  await navigateur.close()
  serveur.close()
}

console.log('\nWORKERS GUI — ' + total + ' assertions, ' + echecs + ' failure(s)')
process.exit(echecs === 0 ? 0 : 1)

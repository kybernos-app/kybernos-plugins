// Suite panel — the REAL client code, rendered in a real browser with a faked DSH around it.
//   node scripts/test-suite-gui.mjs [--shots <dir>]
// Needs Playwright (with a Chromium) and React 18 UMD builds; when one is missing the
// test says so and exits 0 (SKIPPED) — it is a bench, not part of the zero-dependency suites.
//   KB_CHROMIUM=/path/to/chromium   KB_BENCH_DEPS=/dir/with/node_modules
import { readFileSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ICI = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(ICI, '..')
const HUB = join(REPO, 'packages', 'kybernos-hub')
const SHOTS = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null

let playwright, reactJs, reactDomJs
try {
  const req = createRequire(join(process.env.KB_BENCH_DEPS || REPO, 'noop.js'))
  playwright = req('playwright')
  // "exports" hides the umd/ folder from require.resolve: go through package.json instead.
  reactJs = readFileSync(join(dirname(req.resolve('react/package.json')), 'umd', 'react.development.js'), 'utf8')
  reactDomJs = readFileSync(join(dirname(req.resolve('react-dom/package.json')), 'umd', 'react-dom.development.js'), 'utf8')
} catch (e) {
  console.log('SUITE GUI — SKIPPED (needs playwright, react@18 and react-dom@18: ' + String(e.message).split('\n')[0] + ')')
  process.exit(0)
}

const catalogue = JSON.parse(readFileSync(join(HUB, 'catalog.json'), 'utf8'))
const { charge } = await import(join(HUB, 'suite-host.mjs'))
const clientJs = readFileSync(join(HUB, 'client.js'), 'utf8')

let echecs = 0
let total = 0
const ok = (nom, cond, detail) => { total++; if (cond) console.log('  ✓ ' + nom); else { echecs++; console.log('  ✗ ' + nom + (detail !== undefined ? ' — ' + detail : '')) } }

// DSH as the user has it: the 21 kybernos-* bundles installed, the 3 dsh-* not.
const INSTALLES = catalogue.modules.filter((m) => m.nom.startsWith('@local/kybernos'))
const page = (lang, scenario) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{--dsw-alias-label-primary:#ececee;--dsw-alias-label-secondary:#b4b4bb;--dsw-alias-label-tertiary:#8b8b93;--dsw-alias-label-primary-foreground:#111;
--dsw-alias-border-l1:#2e2e32;--dsw-alias-border-l2:#3a3a40;--dsw-alias-bg-layer-1:#1c1c1e;--dsw-alias-bg-layer-2:#242427;--dsw-alias-bg-layer-3:#2e2e32;
--dsw-alias-button-primary-fill:#ececee;--dsw-alias-state-success-primary:#4cc38a;--dsw-alias-state-warn-primary:#f0b429;--dsw-alias-state-error-primary:#ef6b6b}
body{margin:0;padding:20px;background:#161617;font-family:system-ui,sans-serif;color:#ececee}
</style></head><body><div id="root"></div>
<script>${reactJs}</script><script>${reactDomJs}</script>
<script>
window.__KB_LANG_RESOLVE__ = () => ${JSON.stringify(lang)}
window.__calls = []
window.__sections = []
const SCEN = ${JSON.stringify(scenario)}
const installes = SCEN.installes.map((m) => ({ name: m.nom, version: m.version, enabled: SCEN.eteints.indexOf(m.id) < 0, readOnly: false }))
const pm = {
  listBundles: async () => ({ ok: true, value: installes.map((b) => ({ ...b })) }),
  setBundleEnabled: async (nom, v) => { window.__calls.push(['native', nom, v]); const b = installes.find((x) => x.name === nom); if (b) b.enabled = v; return { ok: true } }
}
const reponses = {
  '/kybernos-hub/suite': SCEN.suite,
  '/kybernos-maintenance/state': { global: '0.2.0-rc.2', compat: { min: '0.1.6-alpha.2', max: '0.2.0-rc.2', horsZone: false } },
  '/kybernos-hub/state': { ok: true }
}
window.fetch = async (url, init) => {
  const chemin = String(url).split('?')[0]
  if (init && init.method === 'POST') {
    const corps = JSON.parse(init.body)
    window.__calls.push(['post', chemin, corps])
    if (chemin === '/kybernos-hub/beacon') return { ok: true, json: async () => ({ ok: true, bootId: 'B' }) }
    if (chemin === '/kybernos-hub/module' && corps.action === 'installer') { await new Promise((r) => setTimeout(r, SCEN.dureeInstall || 50)); return { ok: true, json: async () => (SCEN.installRefuse ? { ok: false, error: 'robot-refused', detail: 'boot check failed' } : { ok: true, relanceRequise: true }) } }
    return { ok: true, json: async () => ({ ok: true }) }
  }
  if (chemin === '/kybernos-hub/suite' && SCEN.suiteKO) return { ok: false, json: async () => ({}) }
  const r = reponses[chemin]
  return r === undefined ? { ok: false, json: async () => null } : { ok: true, json: async () => r }
}
const Composio = () => React.createElement('div', { id: 'fake-composio-config' }, 'Clé & mode Composio')
const slots = {
  inject: (nom, fn) => fn(),
  register: (meta, comp) => { window.__sections.push({ meta, comp }); return () => {} },
  entriesOfSlot: (nom) => nom === 'plugins.bundle.config' ? [{ component: Composio, options: { key: '@local/kybernos-composio' } }] : []
}
window.__ModuleLoader__ = { load: (def) => { window.__def = def } }
</script>
<script>${clientJs}</script>
<script>
const modele = window.__def.factory((nom) => { if (nom === 'react') return React; throw new Error('no ' + nom) })
const ctx = { effect: (fn) => fn(), inject: (liste, cb) => cb({ slots, remote: { pluginManager: pm } }), remote: { pluginManager: pm } }
modele.apply(ctx)
const s = window.__sections[0]
if (s) ReactDOM.render(React.createElement(s.comp), document.getElementById('root'))
</script></body></html>`

const lancer = async () => {
  const opts = { headless: true }
  const chemin = process.env.KB_CHROMIUM
  if (chemin) opts.executablePath = chemin
  return playwright.chromium.launch(opts)
}

const scenarioBase = (extra = {}) => ({
  installes: INSTALLES, eteints: [],
  suite: charge({ catalogue, brut: null, etatHub: { ok: true, recommendation: { mode: 'normal' }, safe: { active: false } } }),
  ...extra
})

const navigateur = await lancer()
const ouvrir = async (lang, scenario, largeur = 1000) => {
  const p = await navigateur.newPage({ viewport: { width: largeur, height: 900 } })
  const erreurs = []
  p.on('pageerror', (e) => erreurs.push(String(e)))
  await p.setContent(page(lang, scenario))
  await p.waitForFunction(() => { const e = document.querySelector('.kbsu'); return e !== null && !/Loading the suite|Chargement de la suite/.test(e.textContent) }, null, { timeout: 5000 })
  await p.waitForTimeout(100)
  p.erreurs = erreurs
  return p
}
const cartes = (p) => p.$$eval('[data-kb="suite-card"]', (els) => els.map((e) => ({ id: e.dataset.id, etat: e.dataset.etat })))
const appels = (p) => p.evaluate(() => window.__calls)
const montrer = async (p, nom) => { if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await p.screenshot({ path: join(SHOTS, nom + '.png'), fullPage: true }) } }

try {
  console.log('── section ──')
  {
    const p = await ouvrir('en', scenarioBase())
    const sec = await p.evaluate(() => window.__sections.map((s) => s.meta))
    ok('registers ONE settings section "kybernos-suite" before the old Plugins page (order 29 < 30)', sec.length === 1 && sec[0].id === 'kybernos-suite' && sec[0].order === 29 && sec[0].name === 'settings.section', JSON.stringify(sec))
    ok('the boot beacon still fires when the panel is there', (await appels(p)).some((c) => c[0] === 'post' && c[1] === '/kybernos-hub/beacon' && c[2].type === 'loading'))
    const cs = await cartes(p)
    ok('24 cards: 21 installed + 3 not', cs.length === 24, String(cs.length))
    ok('the 21 kybernos-* modules read active, the 3 dsh-* read available', cs.filter((c) => c.etat === 'active').length === 21 && cs.filter((c) => c.etat === 'available').length === 3, JSON.stringify(cs.filter((c) => c.etat !== 'active').map((c) => c.id + ':' + c.etat)))
    const fam = await p.$$eval('.kbsu-fam h5', (e) => e.map((x) => x.firstChild.textContent))
    ok('six families, in the catalogue order', fam.join('|') === 'Foundations|Models|Agent teams|Create in the chat|Connectors and machines|Cloud', fam.join('|'))
    ok('the summary counts installed and available', (await p.textContent('.kbsu-summary')).startsWith('21 installed · 3 available'))
    ok('the header shows the DSH version, inside the tested range', (await p.textContent('.kbsu-meta')).includes('DSH 0.2.0-rc.2 · inside the tested range'))
    ok('no JS error while rendering', p.erreurs.length === 0, p.erreurs.join(' | '))
    await montrer(p, 'suite-en-1000'); await p.close()
  }

  console.log('── switching ──')
  {
    const p = await ouvrir('en', scenarioBase())
    const verrouilles = await p.$$eval('[data-kb="suite-card"]', (els) => els.filter((e) => e.querySelector('.kbsu-sw') && e.querySelector('.kbsu-sw').disabled).map((e) => e.dataset.id))
    ok('the socle switches are locked (hub, core, theme, sessions, skills)', ['kybernos-hub', 'kybernos-plugin', 'kybernos-theme', 'kybernos-sessions', 'kybernos-skills'].every((i) => verrouilles.includes(i)) && verrouilles.length === 5, verrouilles.join())
    await p.click('[data-id="kybernos-slides"] .kbsu-sw')
    await p.waitForTimeout(200)
    const a = await appels(p)
    ok('switching slides off: the choice is saved on the host THEN applied natively', a.some((c) => c[0] === 'post' && c[1] === '/kybernos-hub/module' && c[2].id === 'kybernos-slides' && c[2].action === 'desactiver') && a.some((c) => c[0] === 'native' && c[1] === '@local/kybernos-slides' && c[2] === false))
    ok('the card then reads off', (await cartes(p)).find((c) => c.id === 'kybernos-slides').etat === 'off')
    await p.click('[data-id="kybernos-slides"] .kbsu-sw')
    await p.waitForTimeout(200)
    ok('and back on', (await cartes(p)).find((c) => c.id === 'kybernos-slides').etat === 'active')
    await p.close()
  }

  console.log('── a module with its own settings (Composio) ──')
  {
    const p = await ouvrir('en', scenarioBase())
    const avec = await p.$$eval('[data-kb="suite-card"]', (els) => els.filter((e) => [...e.querySelectorAll('button')].some((b) => b.textContent === 'Settings')).map((e) => e.dataset.id))
    ok('only Composio shows a Settings button (the others registered no config)', avec.join() === 'kybernos-composio', avec.join())
    ok('the config is hidden until asked', (await p.$('#fake-composio-config')) === null)
    await p.click('[data-id="kybernos-composio"] button:has-text("Settings")')
    ok('Settings unfolds the module\'s own screen inside the card', (await p.textContent('[data-id="kybernos-composio"] [data-kb="suite-config"]')).includes('Clé & mode Composio'))
    ok('an unfolded card spans the full row', await p.$eval('[data-id="kybernos-composio"]', (e) => e.classList.contains('open')))
    await montrer(p, 'suite-composio-ouvert')
    await p.click('[data-id="kybernos-composio"] button:has-text("Settings")')
    ok('clicking again folds it', (await p.$('#fake-composio-config')) === null)
    await p.close()
  }

  console.log('── filters and search ──')
  {
    const p = await ouvrir('en', scenarioBase())
    await p.click('.kbsu-seg button:has-text("Available")')
    ok('Available lists the 3 dsh-* modules', (await cartes(p)).map((c) => c.id).sort().join() === 'dsh-db-viewer,dsh-media-player,dsh-mermaid')
    await p.click('.kbsu-seg button:has-text("Installed")')
    ok('Installed lists 21', (await cartes(p)).length === 21)
    await p.click('.kbsu-seg button:has-text("All")')
    await p.fill('.kbsu-search input', 'slides')
    ok('searching "slides" keeps only kybernos-slides', (await cartes(p)).map((c) => c.id).join() === 'kybernos-slides')
    await p.fill('.kbsu-search input', 'zzzz')
    ok('a search with no hit says so', (await p.textContent('.kbsu')).includes('No module matches.'))
    await p.fill('.kbsu-search input', 'ordinateurs')
    ok('search also reads the French promise', (await cartes(p)).map((c) => c.id).join() === 'kybernos-computers')
    await p.close()
  }

  console.log('── install, then relaunch ──')
  {
    const p = await ouvrir('en', scenarioBase({ dureeInstall: 600 }))
    await p.click('[data-id="dsh-mermaid"] button:has-text("Install")')
    await p.waitForTimeout(150)
    ok('while installing the card says what is happening', (await p.textContent('[data-id="dsh-mermaid"]')).includes('Installing: safety snapshot, link, boot check'))
    await p.waitForTimeout(700)
    ok('a finished install reads "Active after restart"', (await cartes(p)).find((c) => c.id === 'dsh-mermaid').etat === 'pending')
    ok('and a banner offers the restart', (await p.textContent('.kbsu-relance')).includes('1 change pending'))
    await p.click('.kbsu-relance button:has-text("Restart DSH")')
    ok('the restart asks for confirmation first, warning about running sessions', (await p.textContent('.kbsu-relance')).includes('Running sessions will be interrupted'))
    ok('nothing was sent to the host yet', !(await appels(p)).some((c) => c[1] === '/kybernos-hub/relaunch'))
    await p.click('.kbsu-relance button:has-text("Cancel")')
    ok('Cancel goes back, still nothing sent', !(await appels(p)).some((c) => c[1] === '/kybernos-hub/relaunch') && (await p.$('.kbsu-relance button:has-text("Restart DSH")')) !== null)
    await p.click('.kbsu-relance button:has-text("Restart DSH")')
    await p.click('.kbsu-relance button:has-text("Restart now")')
    await p.waitForTimeout(100)
    ok('"Restart now" posts the explicit confirmation', (await appels(p)).some((c) => c[1] === '/kybernos-hub/relaunch' && c[2].confirm === true))
    await p.close()
  }
  {
    const p = await ouvrir('en', scenarioBase({ installRefuse: true }))
    await p.click('[data-id="dsh-mermaid"] button:has-text("Install")')
    await p.waitForTimeout(250)
    const t = await p.textContent('[data-id="dsh-mermaid"]')
    ok('a refused install is shown on the card with the robot\'s reason, and stays installable', t.includes('Install refused') && t.includes('boot check failed') && (await cartes(p)).find((c) => c.id === 'dsh-mermaid').etat === 'available')
    ok('a refused install does not raise the restart banner', (await p.$('.kbsu-relance')) === null)
    await p.close()
  }

  console.log('── safe mode ──')
  {
    const eteints = INSTALLES.filter((m) => !m.socle).map((m) => m.id)
    const p = await ouvrir('en', scenarioBase({ eteints, suite: charge({ catalogue, brut: null, etatHub: { ok: true, recommendation: { mode: 'safe' }, safe: { active: true, since: 'x' } } }) }))
    const cs = await cartes(p)
    ok('safe mode: the banner explains and gives the exit command', (await p.textContent('.kbsu-banner')).includes('Safe mode is on') && (await p.textContent('.kbsu-banner')).includes('safe-mode off'))
    ok('safe mode: switched-off satellites read "safe", the socle stays active', cs.filter((c) => c.etat === 'safe').length === 16 && cs.filter((c) => c.etat === 'active').length === 5, JSON.stringify(cs.filter((c) => c.etat === 'safe').length))
    await montrer(p, 'suite-mode-sans-echec'); await p.close()
  }

  console.log('── the host is unreachable ──')
  {
    const p = await ouvrir('en', scenarioBase({ suiteKO: true }))
    ok('an unreachable catalogue shows an error with Retry, not a blank page', (await p.textContent('.kbsu')).includes('cannot be reached') && (await p.$('.kbsu button:has-text("Retry")')) !== null)
    await p.close()
  }

  console.log('── French, phone width ──')
  {
    const p = await ouvrir('fr', scenarioBase(), 390)
    const t = await p.textContent('.kbsu')
    ok('French labels', t.includes('Les modules Kybernos de ce poste') && t.includes('Installés') && t.includes('Fondations'))
    ok('no horizontal scroll at 390 px', await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), String(await p.evaluate(() => document.documentElement.scrollWidth)))
    await montrer(p, 'suite-fr-390'); await p.close()
  }
} finally {
  await navigateur.close()
}

console.log('\nSUITE GUI — ' + total + ' assertions, ' + echecs + ' failure(s)')
process.exit(echecs === 0 ? 0 : 1)

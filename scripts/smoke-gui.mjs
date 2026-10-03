#!/usr/bin/env node
// Real-GUI smoke test: a running DSH with every Kybernos bundle installed.
//
//   dsh web --no-open --port 3080          # in another terminal, prints a token URL
//   npm i playwright                       # once, anywhere on NODE_PATH or next to this script
//   node scripts/smoke-gui.mjs --token <token> [--port 3080] [--workspace work] [--chromium /path/to/chromium] [--out /tmp/smoke]
//
// What it proves (and what it does not):
//   · the GUI boots: no "Failed to load plugins" screen, no uncaught page error
//   · every read-only host route of every bundle answers as expected
//   · the right-sidebar panels (Slides, Briques, Modeleur) open without an error
// It does NOT drive a model: a chat turn needs a provider key.
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const arg = (nom, defaut) => { const i = process.argv.indexOf(nom); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : defaut }
const PORT = arg('--port', '3080')
const TOKEN = arg('--token', process.env.DSH_TOKEN ?? '')
const CHROMIUM = arg('--chromium', process.env.CHROMIUM_PATH ?? undefined)
const WORKSPACE = arg('--workspace', 'work') // a folder name visible from the directory picker's start folder (HOME)
const OUT = arg('--out', join(process.env.TMPDIR ?? '/tmp', 'kybernos-smoke'))
if (TOKEN === '') { console.error('--token <token> required (printed by `dsh web`)'); process.exit(64) }

let chromium
try { ({ chromium } = await import('playwright')) } catch { console.error('playwright not found: run `npm i playwright` first'); process.exit(64) }
mkdirSync(OUT, { recursive: true })

let echecs = 0; let total = 0
const ok = (nom, bon, detail = '') => { total++; if (bon) console.log('  ✓ ' + nom); else { echecs++; console.log('  ✗ ' + nom + (detail ? ' — ' + detail : '')) } }

// [route, accepted statuses, what the body must contain]
const ROUTES = [
  ['/kybernos-hub/state', [200], '"ok":true'],
  ['/kybernos-hub/suite', [200], '"modules"'],
  ['/kybernos-workers/state', [200], '"workers"'],
  ['/kybernos-maintenance/state', [200], '"global"'],
  ['/kybernos-sessions/state', [200], '"kybers"'],
  ['/kybernos-sessions/settings', [200], '"reglages"'],
  ['/kybernos-sessions/categories', [200], '"categories"'],
  ['/kybernos-sessions/brain/health', [200], '"ok":true'],
  ['/kybernos-models/status', [200], '"ok":true'],
  ['/kybernos-cloud/status', [200], '"ok":true'],
  ['/kybernos-computers/status', [200], '"ok":true'],
  ['/kybernos-computers/sandboxes', [200], '"sandboxes"'],
  ['/kybernos-auto/state', [200], '"ok":true'],
  ['/kybernos-bricks/state', [200], '{'],
  ['/kybernos-slides/state', [200], '{'],
  ['/kybernos-modeleur/state', [200], '{'],
  ['/kybernos-miniapps/list', [200], '"items"'],
  ['/kybernos/slash/status', [200], '"ok":true'],
  ['/kybernos/queue-move?sessionId=none', [200], '"supported":false'],
  ['/dsh-db-viewer/bases', [200], '"bases"'],
]

const navigateur = await chromium.launch({ headless: true, ...(CHROMIUM ? { executablePath: CHROMIUM } : {}) })
const ctx = await navigateur.newContext({ viewport: { width: 1500, height: 950 } })
const base = `http://127.0.0.1:${PORT}/?token=${TOKEN}`

const nouvellePage = async () => {
  const p = await ctx.newPage()
  p.setDefaultTimeout(6000)
  const erreurs = []
  p.on('pageerror', (e) => erreurs.push(String(e).slice(0, 200)))
  await p.goto(base, { waitUntil: 'domcontentloaded' })
  await p.waitForTimeout(8000)
  for (let i = 0; i < 4; i++) { const passer = p.locator('.kb-ob-passer'); if (await passer.count()) { await passer.first().click(); await p.waitForTimeout(1000) } }
  // DSH first-run dialogs: preview notice, then API-key prompt.
  await p.getByRole('button', { name: 'Continue' }).first().click({ timeout: 2500 }).catch(() => {})
  await p.waitForTimeout(600)
  await p.getByText('Configure later').first().click({ timeout: 2500 }).catch(() => {})
  await p.waitForTimeout(800)
  // First run: no workspace registered yet → pick one in the directory dialog.
  if (await p.getByText('Choose workspace').count()) {
    await p.getByText('Choose workspace').first().click().catch(() => {})
    await p.waitForTimeout(1200)
    await p.getByText(WORKSPACE, { exact: true }).first().click().catch(() => {})
    await p.getByRole('button', { name: 'Open' }).first().click().catch(() => {})
    await p.waitForTimeout(2500)
  }
  return { p, erreurs }
}

try {
  console.log('── boot ──')
  const { p, erreurs } = await nouvellePage()
  const texte = await p.locator('body').innerText()
  ok('no « Failed to load plugins » screen', !/Failed to load plugins/.test(texte), texte.split('\n').filter(Boolean).slice(0, 4).join(' | '))
  ok('no uncaught page error at boot', erreurs.length === 0, JSON.stringify(erreurs.slice(0, 3)))
  ok('Kybernos sidebar is there', /Agent Teams/.test(texte) && /Deliverables/.test(texte))

  console.log('── host routes (same-origin, read-only) ──')
  const reponses = await p.evaluate(async (routes) => {
    const out = []
    for (const [r] of routes) { try { const x = await fetch(r); out.push([r, x.status, (await x.text()).slice(0, 4000)]) } catch (e) { out.push([r, 0, String(e)]) } }
    return out
  }, ROUTES)
  for (const [i, [route, statuts, motif]] of ROUTES.entries()) {
    const [, st, corps] = reponses[i]
    ok(`${route} → ${st}`, statuts.includes(st) && corps.includes(motif), corps.slice(0, 100))
  }
  await p.close()

  console.log('── right-sidebar panels ──')
  for (const nom of ['Slides', 'Modeleur', 'Briques']) {
    const { p: page, erreurs: err } = await nouvellePage()
    await page.getByText('work', { exact: true }).first().click().catch(() => {})
    await page.getByText('New Session', { exact: true }).first().click().catch(() => {})
    await page.waitForTimeout(2000)
    const ouvrir = page.getByLabel('Open right sidebar'); if (await ouvrir.count()) { await ouvrir.first().click(); await page.waitForTimeout(1800) }
    if (!(await page.getByText(nom, { exact: true }).count())) { await page.getByLabel('New tab').first().click().catch(() => {}); await page.waitForTimeout(1200) }
    const entree = page.getByText(nom, { exact: true }).first()
    const present = (await entree.count()) > 0
    if (present) { await entree.click().catch(() => {}); await page.waitForTimeout(2500) }
    await page.screenshot({ path: join(OUT, `panneau-${nom}.png`) })
    ok(`panel « ${nom} » opens`, present, 'entry not found in the right sidebar (open a workspace first: this check needs one)')
    ok(`panel « ${nom} » raises no page error`, err.length === 0, JSON.stringify(err.slice(0, 2)))
    await page.close()
  }
} finally {
  await navigateur.close()
}
console.log(`\nSMOKE GUI — ${total} checks, ${echecs} failure(s) — screenshots in ${OUT}`)
process.exit(echecs === 0 ? 0 : 1)

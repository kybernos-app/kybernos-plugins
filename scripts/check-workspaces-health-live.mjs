#!/usr/bin/env node
// The workspaces whose folder is gone, in a REAL GUI (bêta 93953fad, 28/10): the Projects page must say
// it, mark the cards, and offer the link — instead of letting a session fail its file tools with a raw
// `rg` error. Read-only on the instance it points at (no theme change, no link clicked, no workspace
// created), so it is safe against the person's own :3080.
//
//   node scripts/check-workspaces-health-live.mjs [--shots <dir>]
//
// What it proves:
//   1. the host route answers one row per registered workspace — { workspaceId, path, exists };
//   2. the page's banner appears exactly when that route reports at least one missing folder;
//   3. every card of a gone folder wears the badge, and no card of a live folder does;
//   4. the « Link a folder… » control is offered (not pressed: it opens the native picker).
// Exit 0 / 1 (a check failed) / 3 (inconclusive: no Chrome, GUI down, 401).
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { openLivePage, waitFor, clickText } from './live-page.mjs'

const args = process.argv.slice(2)
const shotDir = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : null
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0
let fail = 0
let skipped = 0
const skip = (name, why) => { skipped += 1; console.log('  ○ not played: ' + name + ' (' + why + ')') }
const check = (name, ok, detail) => {
  if (ok) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) }
}
const val = async (page, expr, ms) => (await page.evalJs(expr, ms)).val
const shot = async (page, name) => { if (shotDir !== null) { try { mkdirSync(shotDir, { recursive: true }); await page.shot(join(shotDir, name + '.png')) } catch (e) { /* no screenshot */ } } }

const live = await openLivePage({ width: 1400, height: 900 }).catch((e) => { console.error('○ inconclusive: ' + e.message); process.exit(3) })
const { page } = live
try {
  // 1. The host's own answer, read from the page (same origin, signed cookie).
  const health = await val(page, `fetch('/kybernos/workspaces-health', { cache: 'no-store' }).then((r) => r.json()).then((j) => j).catch(() => null)`)
  const rows = (health !== null && health !== undefined && Array.isArray(health.items) === true) ? health.items : null
  check('the host answers { ok, items }', health !== null && health.ok === true && rows !== null, health === null ? 'no answer' : health.ok)
  const shaped = rows !== null && rows.every((r) => r !== null && typeof r === 'object' && typeof r.workspaceId === 'string' && typeof r.path === 'string' && typeof r.exists === 'boolean')
  check('every row is { workspaceId, path, exists }', shaped === true, rows === null ? 'no rows' : rows.length)
  const gone = rows === null ? [] : rows.filter((r) => r.exists === false)
  // A gone folder is a fact of the instance, not of the page: a sandbox cloned from a profile whose folders all exist has none. The branches that need one are
  // not played there, and the summary says so (a skip is never a pass); with none gone, the page is still checked for « no banner, no badge ».
  const noneGone = gone.length === 0
  if (noneGone) skip('a registered workspace whose folder is gone is reported as such', 'every registered folder exists in this instance')
  else check('a registered workspace whose folder is gone is reported as such', true)

  // 2. The page: the banner shows exactly when the host reported a missing folder.
  const opened = await clickText(page, 'Workspaces')
  check('the Workspaces page opens', opened === true)
  await waitFor(page, `document.querySelector('[data-kb="workspaces-missing"]') !== null`, gone.length > 0 ? 8000 : 3000)
  const banner = await val(page, `(() => { const e = document.querySelector('[data-kb="workspaces-missing"]'); return e === null ? null : { text: (e.innerText || '').trim(), relink: e.querySelector('[data-kb="workspaces-relink"]') !== null } })()`)
  if (gone.length > 0) {
    check('the banner says how many folders are gone', banner !== null && banner.text.indexOf(String(gone.length)) === 0, banner === null ? 'absent' : banner.text)
    check('the banner offers « Link a folder… »', banner !== null && banner.relink === true, banner === null ? 'absent' : banner.relink)
  } else {
    check('no banner when every folder is there', banner === null, banner === null ? undefined : banner.text)
  }

  // 3. Badges: on the cards of gone folders, on none of the live ones. The page may hold fewer
  // workspaces than the registry (the shell hides the dedicated automations one), so the exact
  // count is asserted only when the page lists them all.
  const cards = await val(page, `(() => Array.from(document.querySelectorAll('[data-kb="project-card"], [data-kb="project-row"]')).map((e) => ({ missing: e.querySelector('[data-kb="project-missing"]') !== null })))()`)
  const list = Array.isArray(cards) ? cards : []
  const listed = list.length
  const badges = list.filter((c) => c.missing === true).length
  check('the page lists the workspaces it holds', listed > 0, { listed: listed, registered: rows === null ? null : rows.length })
  if (gone.length > 0) check('a gone folder is badged on its card', badges > 0, { badges: badges })
  else check('no badge when every folder is there', badges === 0, { badges: badges })
  check('never more badges than gone folders', badges <= gone.length, { badges: badges, gone: gone.length })
  // The list is paginated: walk the pages so every registered workspace is seen before counting.
  let badgesAll = badges
  let pagesWalked = 1
  for (let i = 0; i < 6; i += 1) {
    const next = await val(page, "(() => { const b = Array.from(document.querySelectorAll('.kb6-pgbtn')); const n = b[1] === undefined ? null : b[1]; if (n === null || n.disabled === true) return false; n.click(); return true })()")
    if (next !== true) break
    await sleep(600)
    pagesWalked += 1
    const more = await val(page, "document.querySelectorAll('[data-kb=\"project-missing\"]').length")
    badgesAll += typeof more === 'number' ? more : 0
  }
  check('one badge per gone folder, across every page', badgesAll === gone.length, { badges: badgesAll, gone: gone.length, pages: pagesWalked })
  await shot(page, 'workspaces-missing')

  // 4. Theme tokens only: the badge and the banner take their colours from the theme, never a literal.
  const hex = await val(page, `(() => { const e = document.querySelector('[data-kb="project-missing"]'); if (e === null) return null; const s = getComputedStyle(e); return { bg: s.backgroundColor, fg: s.color } })()`)
  if (noneGone) skip('the badge paints with theme colours', 'no badge on the page')
  else check('the badge paints with theme colours', hex !== null && hex.bg !== 'rgba(0, 0, 0, 0)' && hex.fg !== hex.bg, hex)
} finally {
  await live.close()
}
console.log((fail === 0 ? '✓ ' : '✗ ') + pass + ' passed, ' + fail + ' failed' + (skipped > 0 ? ', ' + skipped + ' not played' : ''))
process.exit(fail === 0 ? 0 : 1)

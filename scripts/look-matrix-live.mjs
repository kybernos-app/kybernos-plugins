#!/usr/bin/env node
// Case J18-09 of docs/tests/user-journey: play the look matrix (scripts/pairwise.mjs) on a SANDBOX dsh web, one picture and one set of measures per row.
//
//   source scripts/sandbox/env.sh && node scripts/look-matrix-live.mjs --out <folder outside the repo> [--lang en,fr,ar] [--limit 12] [--dry-run]
//
// A row is { language, theme, width, page }. The rows are played grouped by language, then colour mode, so a language is added and used once and the mode changes as few times
// as possible. English and French are the real dictionaries; every other language is the pseudo-translation of lib-language-flow.mjs (every string comes back as ⟦text⟧ through
// the real Language page): it proves layout and coverage in that language, not the quality of a translation.
// Themes: default-dark and default-light press the Light/Dark cards of Settings › Theme (the mode found at the start is put back in a `finally`), « default » is the mode found at
// the start). The three sector themes are templates that J18-07 installs and removes: a row with one is reported `skipped`, never counted as seen.
// For each row: the page is opened at the row's width, takeoff-walk's LOOK_SCRIPT measures it (overlaps, cut text, cut figures, targets under 32 px, sideways scroll), a picture
// is saved under <out>/pictures. Nothing here judges: the pictures go to the readers of docs/tests/user-journey/vision-protocol.md.
// Exit 0 when the walk ran (findings are a result), 1 when it could not, 2 on a refusal, 3 when DSH is not in English at the start (the run puts English back, see docs/dev/live-testing.md).
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { goToSettingsPage, openLivePage, waitFor } from './live-page.mjs'
import { assertEnglishStored, createFlow, LANGUAGE } from './lib-language-flow.mjs'
import { lookMatrix } from './pairwise.mjs'
import { LOOK_SCRIPT } from './takeoff-walk.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const SECTOR = ['e-commerce', 'real-estate', 'recruitment']
const MODE_OF = { 'default-dark': 'dark', 'default-light': 'light', default: 'start' }
const SIDEBAR_PAGE = { skills: ['Skills', 'Compétences'], creations: ['Creations', 'Créations', 'Deliverables', 'Livrables'], automations: ['Automations', 'Automatisations'] }
const SETTINGS_PAGE = { usage: /^(usage|utilisation|consommation)$/i, plan: /plan|subscription|abonnement|billing|facturation/i }

/**
 * The rows to play, as groups: `[{ language, mode, rows: [{ ...row, n, skipped? }] }]`. A language is played once, English first, then French, then the others in matrix order;
 * inside a language the rows with the same mode stay together. `n` is the row's place in the matrix, so a picture's name does not change when `langs` or `limit` do. Pure.
 */
export function planGroups (matrix, { langs = null, limit = null } = {}) {
  let rows = matrix.map((r, i) => ({ ...r, n: i + 1 }))
  if (langs) rows = rows.filter((r) => langs.includes(r.language))
  if (limit !== null) rows = rows.slice(0, limit)
  const order = ['en', 'fr']
  const rank = (l) => (order.includes(l) ? order.indexOf(l) : order.length + matrix.findIndex((r) => r.language === l))
  const groups = new Map()
  for (const r of rows) {
    const mode = MODE_OF[r.theme] || 'start'
    const key = `${r.language}|${mode}`
    if (!groups.has(key)) groups.set(key, { language: r.language, mode, rows: [] })
    groups.get(key).rows.push(SECTOR.includes(r.theme) ? { ...r, skipped: 'a sector theme is a template: J18-07 installs it' } : r)
  }
  return Array.from(groups.values()).sort((a, b) => rank(a.language) - rank(b.language) || String(a.mode).localeCompare(String(b.mode)))
}

/** A picture's file name from its row: the same row always gets the same name. Pure. */
export const pictureName = (row) => `${String(row.n).padStart(3, '0')}-${row.language}-${row.theme}-${row.width}-${row.page}.png`

async function main () {
  const argv = process.argv.slice(2)
  const opt = (n, d = '') => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d }
  const refuse = (m) => { console.error('look-matrix-live: ' + m); process.exit(2) }
  const langs = opt('--lang') ? opt('--lang').split(',') : null
  const limit = opt('--limit') ? Number(opt('--limit')) : null
  const groups = planGroups(lookMatrix(), { langs, limit })
  const total = groups.reduce((n, g) => n + g.rows.length, 0)
  const skipped = groups.reduce((n, g) => n + g.rows.filter((r) => r.skipped).length, 0)
  if (argv.includes('--dry-run')) {
    console.log(`J18-09: ${total} rows in ${groups.length} groups, ${skipped} skipped (sector themes), ${total - skipped} to play`)
    for (const g of groups) console.log(`  ${g.language.padEnd(3)} mode ${g.mode.padEnd(5)} ${g.rows.length} rows`)
    return
  }
  const out = opt('--out')
  if (!out) refuse('--out <folder outside the repository> is required')
  const outDir = resolve(out)
  const inside = relative(REPO, outDir)
  if (inside === '' || (!inside.startsWith('..') && !inside.startsWith('/'))) refuse('the output folder is inside the repository: pictures never go to git')
  const host = process.env.KB_HOST || ''
  if (!host || !process.env.DSH_HOME) refuse('not a sandbox: run « source scripts/sandbox/env.sh » first')
  if (/:3080$/.test(host) || /:879[12]$/.test(host)) refuse('KB_HOST is the owner\'s own DSH or replica: this tool is for sandboxes only')
  assertEnglishStored()
  mkdirSync(join(outDir, 'pictures'), { recursive: true })

  const live = await openLivePage({ authority: host, width: 1440, height: 900 })
  const { page } = live
  const flow = await createFlow(page)
  const { val, reload } = flow
  const results = []
  let startMode = null
  let modeMoved = false
  let stubbed = false
  let using = 'en'

  const setWidth = (w) => page.send('Emulation.setDeviceMetricsOverride', { width: w, height: w < 600 ? 844 : 900, deviceScaleFactor: 1, mobile: w < 600 })
  const openSidebar = async () => {
    if ((await val(`document.querySelectorAll('nav, aside, [class*="sidebar"]').length > 0 && innerWidth >= 800`)) === true) return
    await val(`(() => { const b = Array.from(document.querySelectorAll('button')).find((x) => /sidebar|barre latérale/i.test((x.getAttribute('aria-label') || '') + ' ' + (x.title || ''))); if (b) b.click() })()`)
    await sleep(900)
  }
  /** The colour mode, by the cards of Settings › Theme; resolves what DSH reports afterwards. */
  const pressMode = async (mode) => {
    await flow.openSettings(null)
    await goToSettingsPage(page, /^(theme|thème)/i, { settleMs: 900 })
    modeMoved = true
    await val(`(() => { const c = document.querySelector('.kbth-mode[data-mode="${mode}"]'); if (c) c.click() })()`)
    await sleep(1200)
    return val(`document.documentElement.getAttribute('data-ds-theme-source')`)
  }
  const useLanguage = async (iso) => {
    if (iso === using) return
    if (using !== 'en') { await flow.restoreEnglish(); using = 'en' }
    if (iso === 'en') return
    if (iso === 'fr') {
      await flow.openSettings(LANGUAGE)
      await flow.clickSel('[data-lang="kybernos"] [data-act="use"]')
      await sleep(2500)
      await waitFor(page, `document.documentElement.lang === 'fr'`, 20000)
      await reload()
    } else {
      if (!stubbed) { await flow.installStub(); stubbed = true }
      await flow.pseudoLanguage(iso)
    }
    using = iso
  }
  const gotoPage = async (row) => {
    await setWidth(row.width)
    await reload()
    if (row.page === 'new-chat') return true
    await openSidebar()
    if (SIDEBAR_PAGE[row.page]) {
      for (const l of SIDEBAR_PAGE[row.page]) if (await flow.click(l)) { await sleep(1500); return true }
      return false
    }
    if (row.page === 'account-menu') {
      const pos = JSON.parse(await val(`JSON.stringify({ x: document.documentElement.dir === 'rtl' ? innerWidth - 140 : 140, y: innerHeight - 45 })`))
      await flow.mouse(pos.x, pos.y)
      await sleep(1200)
      return true
    }
    await flow.openSettings(null)
    if ((await val(`document.querySelectorAll('[class*="navCell"]').length`)) < 3) return false
    if (row.page === 'settings') return true
    return goToSettingsPage(page, SETTINGS_PAGE[row.page], { settleMs: 900 })
  }

  try {
    startMode = await val(`document.documentElement.getAttribute('data-ds-theme-source')`)
    for (const g of groups) {
      console.log(`${g.language} (mode ${g.mode}): ${g.rows.length} rows`)
      const todo = g.rows.filter((r) => !r.skipped)
      for (const r of g.rows.filter((x) => x.skipped)) results.push({ n: r.n, row: r, skipped: r.skipped })
      if (todo.length === 0) continue
      try {
        await useLanguage(g.language)
        const want = g.mode === 'start' ? (startMode || 'dark') : g.mode
        if (modeMoved || want !== (startMode || 'dark')) await pressMode(want)
      } catch (e) {
        for (const r of todo) results.push({ n: r.n, row: r, error: 'could not set up the language or mode: ' + String(e.message || e).slice(0, 200) })
        continue
      }
      for (const r of todo) {
        const entry = { n: r.n, row: r }
        try {
          const there = await gotoPage(r)
          entry.reached = there
          entry.look = (await page.evalJs(LOOK_SCRIPT, 10000)).val
          entry.picture = pictureName(r)
          entry.shot = (await page.shot(join(outDir, 'pictures', entry.picture))) === true
        } catch (e) { entry.error = String(e.message || e).slice(0, 200) }
        results.push(entry)
        const l = entry.look || {}
        const bad = ['badText', 'pastRightEdge', 'overlaps', 'clippedText'].filter((k) => (l[k] || []).length > 0).concat(l.scrollsSideways ? ['scrollsSideways'] : [])
        console.log(`  ${String(r.n).padStart(3)} ${r.theme} ${r.width} ${r.page}${entry.reached === false ? ' [page not reached]' : ''}${bad.length ? ' [measures: ' + bad.join(', ') + ']' : ''}${entry.error ? ' [' + entry.error + ']' : ''}`)
      }
    }
  } finally {
    try { await setWidth(1440); if (modeMoved) await pressMode(startMode || 'dark') } catch (e) { console.log('  ! restoring the colour mode failed: ' + e.message) }
    try { await flow.restoreEnglish() } catch (e) { console.log('  ! restoring English failed: ' + e.message) }
    await live.close()
  }
  results.sort((a, b) => a.n - b.n)
  writeFileSync(join(outDir, 'looks.json'), JSON.stringify(results, null, 2) + '\n')
  const played = results.filter((x) => x.shot).length
  const flagged = results.filter((x) => x.look && (['badText', 'pastRightEdge', 'overlaps', 'clippedText'].some((k) => (x.look[k] || []).length > 0) || x.look.scrollsSideways)).length
  console.log(`J18-09: ${results.length} rows, ${played} pictures, ${results.filter((x) => x.skipped).length} skipped, ${results.filter((x) => x.error || x.reached === false).length} not reached or failed, ${flagged} with a measure hit`)
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main().catch((e) => { console.error(String(e.message || e)); process.exit(1) })

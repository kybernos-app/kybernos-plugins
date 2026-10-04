#!/usr/bin/env node
// Translation coverage audit on the LIVE GUI (pseudo-localisation).
//
//   node scripts/audit-i18n-live.mjs                  # a real translated language (ar, RTL)
//   node scripts/audit-i18n-live.mjs --lang es        # another language id
//   node scripts/audit-i18n-live.mjs --baseline       # no language switch: measure the GUI as it is now
//   node scripts/audit-i18n-live.mjs --only "Suite,Thème"  # only the pages whose name contains one of these
//   node scripts/audit-i18n-live.mjs --json out.json  # + the full machine-readable report
//
// Method. A real translation needs an LLM and proves nothing about coverage: a
// string the system never asks for is simply left alone. So the language is made
// with a STUBBED model that returns every string as ⟦text⟧ (lib-language-flow.mjs),
// through the real Language page, the real engine and DSH's real dictionaries.
// Then every page is walked by real clicks and what is visible is read: text
// carrying ⟦…⟧ went through the translation system; text without it is a
// leftover (a plugin with its own table, a hardcoded string…).
//
// Two passes: the first visits every page so the live translation of hardcoded
// settings text can learn it, the audit waits for that to settle, the second
// measures. `--baseline` measures the current language as is (no stub, no switch).
//
// The browser is a throw-away headless Chrome with an empty profile. Using a
// language makes DSH persist its language preference on this machine: the audit
// puts English back in a `finally` and refuses to start unless DSH is in English
// (see docs/dev/live-testing.md). Exit code: 0 (it measures, it does not gate),
// 3 = inconclusive (GUI unreachable, DSH not in English).
import { writeFileSync } from 'node:fs'
import { openLivePage, clickText, waitFor } from './live-page.mjs'
import { collectIn, analyse } from './lib-i18n-audit.mjs'
import { createFlow, assertEnglishStored, storedLocale } from './lib-language-flow.mjs'

const args = process.argv.slice(2)
const argOf = (name, dflt) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : dflt }
const LANG = argOf('--lang', 'ar')
const JSON_OUT = argOf('--json', null)
const BASELINE = args.includes('--baseline')
const ONLY = argOf('--only', null)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const storedBefore = BASELINE ? null : assertEnglishStored()
const live = await openLivePage({ width: 1500, height: 1000 }).catch((e) => {
  console.error('○ inconclusive: ' + e.message)
  process.exit(3)
})
const { page } = live
const flow = await createFlow(page)
const { val, mouse, reload } = flow
const SECTION = '[data-slot="settings.section"]'

const report = []
let size = null
try {
  if (!BASELINE) {
    await flow.installStub()
    const hasTables = await val(`!!(window.__KB_T__ && window.__KB_FR_EN__)`)
    if (!hasTables) { console.error('○ inconclusive: window.__KB_T__ is not published (is @local/kybernos loaded?)'); await live.close(); process.exit(3) }
    await flow.pseudoLanguage(LANG)
    size = Number(await val(`Object.keys(JSON.parse(localStorage.getItem('kybernos.i18n.${LANG}')||'{}')).length + Object.keys(JSON.parse(localStorage.getItem('kybernos.i18n.dsh.${LANG}')||'{}')).length`))
  } else {
    await reload()
  }

  const clickAny = async (label) => {
    for (const l of Array.isArray(label) ? label : [label]) if (await clickText(page, l)) return true
    return false
  }
  // The account footer shows a workspace NAME that changes between profiles, so it
  // is clicked by position: the bottom of the sidebar, on the reading-start side.
  const clickAccount = async () => {
    const pos = JSON.parse(await val(`JSON.stringify({ x: document.documentElement.dir === 'rtl' ? innerWidth - 140 : 140, y: innerHeight - 45 })`))
    await mouse(pos.x, pos.y)
  }
  const measure = async (name, root) => {
    const items = JSON.parse((await val(collectIn(root), 10000)) || '[]')
    const r = analyse(items)
    return Object.assign({ page: name }, r)
  }

  // ── the pages, as steps from a clean state ─────────────────────────────────
  const MAIN = [['Agent Teams'], ['Workspaces'], [['Deliverables', 'Creations', 'Livrables', 'Créations']], ['Automations'], [['Skills', 'Compétences']], [['Connectors', 'Connecteurs']]]
  const pages = [{ name: 'Home (new chat)', run: async () => {}, root: null }]
  for (const [label] of MAIN) pages.push({ name: 'View · ' + (Array.isArray(label) ? label[0] : label), run: async () => { await reload(); if (!(await clickAny(label))) throw new Error('could not click ' + JSON.stringify(label)); await sleep(1500) }, root: null })
  pages.push({ name: 'Menu · account', run: async () => { await reload(); await clickAccount(); await sleep(1200) }, root: null })

  // Settings: every section, by position (labels change with the language).
  await flow.openSettings(null)
  const NAV = (i) => `(() => {
    const back = Array.from(document.querySelectorAll('button,a,[role=button]')).find((e) => /back to workspace|retour au workspace/i.test(e.innerText || ''))
    if (!back) return null
    let box = back
    for (let k = 0; k < 8 && box.parentElement; k += 1) { box = box.parentElement; if (box.querySelectorAll('button,a,[role=button],[role=tab]').length > 12) break }
    const items = Array.from(box.querySelectorAll('button,a,[role=button],[role=tab],[role=menuitem]')).filter((e) => {
      const r = e.getBoundingClientRect(); const t = (e.innerText || '').trim()
      return r.width > 20 && r.height > 12 && t && !/back to workspace|retour au workspace/i.test(t) && !/search|rechercher/i.test(t)
    })
    if (${i} < 0) return JSON.stringify(items.map((e) => (e.innerText || '').trim().split('\\n')[0]))
    const e = items[${i}]
    if (!e) return null
    e.scrollIntoView({ block: 'center' })
    const r = e.getBoundingClientRect()
    return JSON.stringify({ label: (e.innerText || '').trim().split('\\n')[0], x: r.left + r.width / 2, y: r.top + r.height / 2 })
  })()`
  const labels = JSON.parse((await val(NAV(-1))) || '[]')
  if (labels.length === 0) report.push({ page: 'Settings', error: 'could not find the settings navigation' })
  labels.forEach((label, i) => pages.push({
    name: 'Settings · ' + label.replace(/[⟦⟧]/g, ''),
    root: SECTION,
    run: async () => {
      // Each section from its own clean settings page: the list scrolls, labels shift.
      await flow.openSettings(null)
      const at = await val(NAV(i))
      if (at === null || at === undefined) throw new Error('entry ' + i + ' not found')
      const { x, y } = JSON.parse(at)
      await mouse(x, y)
      await sleep(1500)
    },
  }))

  const wanted = ONLY === null ? pages : pages.filter((p) => ONLY.split(',').some((t) => t.trim() !== '' && p.name.toLowerCase().includes(t.trim().toLowerCase())))
  const visitAll = async (doMeasure) => {
    const out = []
    for (const p of wanted) {
      try {
        await p.run()
        // Measuring pass: give the live translation a few seconds on a page it already knows.
        await sleep(doMeasure ? 3500 : 600)
        if (doMeasure) out.push(await measure(p.name, p.root))
      } catch (e) { out.push({ page: p.name, error: e.message }) }
    }
    return out
  }

  // Pass 1: let the live translation see every page; then wait for it to settle.
  if (!BASELINE) {
    await visitAll(false)
    let last = -1
    for (let i = 0; i < 30; i += 1) {
      const n = Number(await val(`Object.keys(JSON.parse(localStorage.getItem('kybernos.i18n.live.${LANG}')||'{}')).length`))
      if (n === last && i > 2) break
      last = n
      await sleep(2000)
    }
    console.log('live translation learned ' + last + ' hardcoded texts')
  }
  report.push(...await visitAll(true))
} finally {
  if (!BASELINE) await flow.restoreEnglish()
}

await sleep(1200)
const afterStored = BASELINE ? null : storedLocale()
await live.close()

// ── output ───────────────────────────────────────────────────────────────────
const pad = (s, n) => (String(s) + ' '.repeat(n)).slice(0, n)
console.log('\nTranslation coverage — ' + (BASELINE ? 'the GUI as it is now (no language switch)' : 'language "' + LANG + '" (' + size + ' texts translated by the stub)') + '\n')
console.log(pad('page', 34) + pad('✓ ok', 7) + pad('FR left', 9) + pad('EN left', 9) + 'share ok')
let tOk = 0, tFr = 0, tEn = 0
for (const r of report) {
  if (r.error) { console.log(pad(r.page, 34) + '! ' + r.error); continue }
  const all = r.translated + r.fr.length + r.en.length
  tOk += r.translated; tFr += r.fr.length; tEn += r.en.length
  console.log(pad(r.page, 34) + pad(r.translated, 7) + pad(r.fr.length, 9) + pad(r.en.length, 9) + (all === 0 ? '—' : Math.round(100 * r.translated / all) + ' %'))
}
const tAll = tOk + tFr + tEn
console.log(pad('TOTAL', 34) + pad(tOk, 7) + pad(tFr, 9) + pad(tEn, 9) + (tAll === 0 ? '—' : Math.round(100 * tOk / tAll) + ' %'))
console.log('\nFR left = French text nothing translated; EN left = English text from DSH or from data; ⟦…⟧ marks a translated string.\n')
for (const r of report) {
  if (r.error || (r.fr.length === 0 && r.en.length === 0)) continue
  console.log('── ' + r.page)
  for (const t of r.fr.slice(0, 8)) console.log('   FR  ' + t.slice(0, 90))
  for (const t of r.en.slice(0, 8)) console.log('   EN  ' + t.slice(0, 90))
}
if (!BASELINE) console.log('\nDSH stored language: before « ' + storedBefore + ' », after « ' + afterStored + ' »' + (afterStored === storedBefore ? ' (restored)' : '  ⚠ NOT RESTORED — run the restore described in docs/dev/live-testing.md'))
if (JSON_OUT !== null) { writeFileSync(JSON_OUT, JSON.stringify(report, null, 2)); console.log('\nfull report: ' + JSON_OUT) }

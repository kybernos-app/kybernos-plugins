// Test case TC-03 — the Settings nav keeps its layout, and follows the language, when the language changes.
//
//   node scripts/check-settings-nav-i18n-live.mjs [--shots <dir>] [--json out.json] [--lang es]
//
// Reads the Settings nav (the `navCell`s) in English, switches DSH to a translated language
// (`es` by default) from Settings › Language, reads it again, goes back to English and reads it
// a third time. Then it does the same trip back through DSH's OWN language selector
// (Settings › General › Language), which is the other way a user changes language.
//
// What it asserts:
//   - the test language is REALLY on during the second reading (the <html lang> and the labels
//     changed: a trip that never left English would pass every other check for nothing);
//   - once back in English, by either way, the entries are in the same ORDER and every label is
//     exactly the English one again (no French, no test language left behind). Entries are told
//     apart by their position in the DOM, which does not change with the language; their label does.
//
// The order UNDER the test language is only reported (a « ~ » line), not asserted. The Settings
// organiser (client.js, `organiser`) recognises each entry by its normalised title: French, English
// and the Spanish aliases written in its `for (const [variante, base] ...)` loop. A pseudo-translated
// title (« ⟦General⟧ ») matches none of them, so with the stubbed translation the entries it cannot
// place fall to the end of the list. A real translation into a language the aliases do not cover
// would do the same.
//
// ⚠ Switching persists `locale.preference` in the DSH profile (cordis.patch.yml) of the DSH under
// test. This routine (1) refuses to start unless the stored language is `en`, (2) puts `en` back in
// a `finally`, (3) reads the value again at the end and reports it. Run it against the sandbox
// (`source scripts/sandbox/env.sh`), not against your own DSH.
//
// READ-ONLY on data (no plugin write). Exit 0 = ok, 1 = bug, 3 = inconclusive.
import { mkdirSync, writeFileSync } from 'node:fs'
import { openLivePage, waitFor } from './live-page.mjs'
import { createFlow, assertEnglishStored, storedLocale } from './lib-language-flow.mjs'

const args = process.argv.slice(2)
const argOf = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : d }
const SHOTS = argOf('--shots', null)
const JSON_OUT = argOf('--json', null)
const TEST_LANG = argOf('--lang', 'es')
if (SHOTS !== null) mkdirSync(SHOTS, { recursive: true })

let pass = 0
let fail = 0
const report = []
const check = (name, ok, detail) => {
  report.push({ name, ok: ok === true, detail })
  if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) }
}

assertEnglishStored() // exits 3 unless the stored language is en

const live = await openLivePage({ width: 1500, height: 1000 }).catch((e) => { console.error('○ inconclusive: ' + e.message); process.exit(3) })
const { page } = live
const flow = await createFlow(page)
const { val, openSettings, pickDshLanguage, restoreEnglish } = flow
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// The nav, top to bottom: for each entry its label and its position in the DOM (a key that does not
// depend on the language, unlike the label, and unlike `data-kb-icon`, which is chosen from the label).
const NAV_READ = `(() => {
  const list = [...document.querySelectorAll('[class*="navList"]')].find(l => l.querySelector('[class*="navCell"]'))
  if (!list) return null
  const cells = [...list.querySelectorAll('[class*="navCell"]')].map((c, i) => ({
    t: (c.textContent || '').trim().split('\\n')[0], k: i, y: c.getBoundingClientRect().top,
  })).sort((a, b) => a.y - b.y)
  return JSON.stringify(cells)
})()`

const measure = async (label) => {
  await openSettings(null)
  await waitFor(page, `document.querySelectorAll('[class*="navCell"]').length > 3`, 12000)
  await sleep(1200)
  const cells = JSON.parse((await val(NAV_READ)) || '[]')
  const read = { label, order: cells.map((c) => c.t), keys: cells.map((c) => c.k), byKey: Object.fromEntries(cells.map((c) => [c.k, c.t])) }
  report.push({ measure: label, order: read.order, keys: read.keys })
  if (SHOTS !== null) await page.shot(`${SHOTS}/nav-${label}.png`)
  return read
}
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i])

let code = 0
try {
  const en1 = await measure('en-before')
  check('English nav read (more than 8 entries)', en1.order.length > 8, en1.order.length)

  // To the test language, from Settings › Language, with the translation stubbed in the page
  // (every string comes back as ⟦text⟧). Throws if the translation does not finish.
  await flow.installStub()
  await flow.pseudoLanguage(TEST_LANG)
  const lang = await val('document.documentElement.lang')
  const es = await measure(TEST_LANG)
  const changed = Object.keys(es.byKey).filter((k) => en1.byKey[k] !== undefined && en1.byKey[k] !== es.byKey[k]).length
  check('the test language is really on (<html lang> and at least 3 nav labels changed)', lang === TEST_LANG && changed >= 3, { lang, changed })

  // Back to English from Settings › Language.
  await restoreEnglish()
  await sleep(2500)
  const en2 = await measure('en-after')

  check('nav entry count is stable across a language switch', en1.keys.length === es.keys.length && en1.keys.length === en2.keys.length, { en1: en1.keys.length, es: es.keys.length, en2: en2.keys.length })
  check('nav order is identical in the test language (entry by entry): the cells are read by position, not by their translated title', same(en1.keys, es.keys), { en1: en1.keys, es: es.keys })
  check('nav order returns to English unchanged', same(en1.keys, en2.keys), { en1: en1.keys, en2: en2.keys })
  check('nav labels return to English unchanged (no French, no test language left)', same(en1.order, en2.order), { en1: en1.order, en2: en2.order })

  // Again, and back to English through DSH's own selector (Settings › General › Language).
  await flow.pseudoLanguage(TEST_LANG)
  await openSettings(['General', '⟦General⟧'])
  await sleep(1500)
  await pickDshLanguage('English', 'en')
  const en3 = await measure('en-after-selector')
  check('going back through DSH\'s own selector: same order', same(en1.keys, en3.keys), { en1: en1.keys, en3: en3.keys })
  check('going back through DSH\'s own selector: same English labels', same(en1.order, en3.order), { en1: en1.order, en3: en3.order })

  // DSH's stored language is en again.
  check('DSH language preference restored to en', storedLocale() === 'en', storedLocale())
} catch (e) {
  console.error('○ inconclusive: ' + e.message)
  code = 3
} finally {
  // Safety net: whatever happened, English goes back.
  try { await restoreEnglish() } catch (e) { /* already done, or the browser is closed */ }
  await live.close()
}

if (JSON_OUT !== null) writeFileSync(JSON_OUT, JSON.stringify({ pass, fail, report }, null, 2))
console.log('\n' + pass + ' ok, ' + fail + ' failed')
process.exit(code !== 0 ? code : fail > 0 ? 1 : 0)

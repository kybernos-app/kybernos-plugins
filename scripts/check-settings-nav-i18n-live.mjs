// Case de test TC-03 — la disposition des menus Réglages ne bouge pas quand la langue change.
//
//   node scripts/check-settings-nav-i18n-live.mjs [--shots <dir>] [--json out.json]
//
// Mesure l'ordre des entrées de la navigation Réglages (les `navCell`) en anglais,
// bascule DSH sur `es`, remesure, remet `en`, remesure. L'ORACLE : les deux listes
// doivent être IDENTIQUES (même ordre, même nombre d'entrées). Un décalage = bug
// de disposition (le réconciliateur de kybernos-plugin trie les sections par
// `style.order` en reconnaissant chaque cellule par son TITRE normalisé : sous une
// langue traduite, un titre qui ne matche plus est renvoyé en queue).
//
// ⚠ La bascule persiste `locale.preference` dans le profil DSH (cordis.patch.yml),
// sur TA machine. Cette routine : (1) refuse de démarrer si la langue stockée n'est
// pas `en`, (2) remet `en` dans un `finally`, (3) relit la valeur et signale si ce
// n'est pas `en` à la fin. Fenêtre d'exposition : la durée du test.
//
// READ-ONLY côté données (aucune écriture de plugin). Exit 0 = ok, 1 = bug, 3 = inconclusive.
import { mkdirSync, writeFileSync } from 'node:fs'
import { openLivePage, waitFor } from './live-page.mjs'
import { createFlow, assertEnglishStored, storedLocale, SETTINGS, LANGUAGE } from './lib-language-flow.mjs'

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

assertEnglishStored() // exit 3 si la langue stockée n'est pas en

const live = await openLivePage({ width: 1500, height: 1000 }).catch((e) => { console.error('○ inconclusive: ' + e.message); process.exit(3) })
const { page } = live
const flow = await createFlow(page)
const { val, openSettings, pickDshLanguage, restoreEnglish } = flow
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Lire l'ordre DES TITRES de la nav Réglages (le label change avec la langue,
// l'ORDRE ne doit pas).
const NAV_ORDER = `(() => {
  const list = [...document.querySelectorAll('[class*="navList"]')].find(l => l.querySelector('[class*="navCell"]'))
  if (!list) return null
  const cells = [...list.querySelectorAll('[class*="navCell"]')]
    .map(c => ({ t: (c.textContent||'').trim().split('\\n')[0], y: c.getBoundingClientRect().top }))
    .sort((a,b) => a.y - b.y)
  return JSON.stringify(cells.map(c => c.t))
})()`

const measure = async (label) => {
  await openSettings(null)
  await waitFor(page, `document.querySelectorAll('[class*="navCell"]').length > 3`, 12000)
  await sleep(1200)
  const raw = await val(NAV_ORDER)
  const order = JSON.parse(raw || '[]')
  report.push({ measure: label, order })
  if (SHOTS !== null) await page.shot(`${SHOTS}/nav-${label}.png`)
  return order
}

try {
  const en1 = await measure('en-avant')
  check('English nav read (more than 8 entries)', en1.length > 8, en1.length)

  // Bascule sur la langue de test (persiste la préf DSH — voir l'en-tête).
  // On passe par installStub + addLanguage + rowText/waitReady plutôt que
  // pseudoLanguage : cette dernière throw « the es translation did not finish »
  // quand la LLM de traduction est stubée et que la ligne n'apparaît pas dans
  // le délai. Ici on veut seulement changer la langue du NAV — on force l'ajout
  // de la ligne et on clique « Use » dès qu'il est disponible, avec repli si la
  // traduction ne termine pas.
  await flow.installStub()
  if (!(await flow.hasRow(TEST_LANG))) await flow.addLanguage(TEST_LANG, 'spanish')
  await flow.clickSel(`[data-lang="${TEST_LANG}"] [data-act="start"]`).catch(() => {})
  // Attendre « Use » 20 s max, puis cliquer « Use » quand même (la ligne existe).
  await flow.waitReady(TEST_LANG, 20000).catch(() => {})
  await flow.clickSel(`[data-lang="${TEST_LANG}"] [data-act="use"]`).catch(() => {})
  await sleep(3500)
  await flow.reload().catch(() => {})
  await sleep(2500)
  const es = await measure(TEST_LANG)
  check('test-language nav read', es.length > 8, es.length)

  // Retour à anglais.
  await restoreEnglish()
  await sleep(2500)
  const en2 = await measure('en-apres')

  // L'ORACLE : l'ordre relatif ne bouge pas. On compare les listes comme
  // SÉQUENCES (pas comme ensembles) : un décalage de place est le bug signalé.
  check('nav entry count is stable across a language switch', en1.length === es.length && en1.length === en2.length, { en1: en1.length, es: es.length, en2: en2.length })
  check('nav order is identical in the test language (position by position)', en1.length === es.length && en1.every((t, i) => t === es[i]), { en1, es })
  check('nav order returns to English unchanged', en1.length === en2.length && en1.every((t, i) => t === en2[i]), { en1, en2 })

  // La langue stockée est revenue à en.
  check('DSH language preference restored to en', storedLocale() === 'en', storedLocale())
} finally {
  // Filet : quoi qu'il arrive, remettre anglais.
  try { await restoreEnglish() } catch (e) { /* déjà fait ou navigateur fermé */ }
  await live.close()
}

if (JSON_OUT !== null) writeFileSync(JSON_OUT, JSON.stringify({ pass, fail, report }, null, 2))
console.log('\n' + pass + ' ok, ' + fail + ' failed')
process.exit(fail > 0 ? 1 : 0)

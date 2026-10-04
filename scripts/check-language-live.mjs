#!/usr/bin/env node
// End-to-end test of the Language page and of what a translated language does to
// the REAL GUI — signed in through docs/dev/live-testing.md.
//
//   node scripts/check-language-live.mjs [--shots <dir>]
//
// The LLM is replaced by a stub inside the page (every string comes back as
// ⟦text⟧ after a short delay), so the run is free, fast and deterministic, and
// the host's own route is not exercised here (test-i18n-translate.mjs does that).
// Everything else is real: the page, the ISO list, the engine, the localStorage
// stores, DSH's locale service and its dictionaries.
//
// ⚠ Activating a language makes DSH persist ITS language preference in the
// profile's configuration, on this machine. The test switches to a language and
// puts English back — in a `finally`, on SIGINT, and it checks the stored value
// afterwards. It refuses to start if DSH's stored language is not "en", so it
// can never overwrite a choice of yours.
//
// Exit code: 0 all green, 1 a check failed, 3 inconclusive.
import { mkdirSync } from 'node:fs'
import { openLivePage, waitFor } from './live-page.mjs'
import { createFlow, assertEnglishStored, storedLocale, LANGUAGE } from './lib-language-flow.mjs'
import { collectIn, analyse } from './lib-i18n-audit.mjs'

const args = process.argv.slice(2)
const shotsDir = args.indexOf('--shots') >= 0 ? args[args.indexOf('--shots') + 1] : null
if (shotsDir !== null) mkdirSync(shotsDir, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) }
}

// Refuses to start unless DSH's stored language is "en" (see the warning above).
const storedBefore = assertEnglishStored()

const live = await openLivePage({ width: 1500, height: 1000 }).catch((e) => { console.error('○ inconclusive: ' + e.message); process.exit(3) })
const { page } = live
const flow = await createFlow(page)
const { val, mouse, clickSel, click, typeInPicker, reload, openSettings, rowText, hasRow, waitReady, addLanguage, restoreEnglish, languagePlugin, dshLanguageRow, waitDshLanguageRow, openDshLanguageMenu, dshLanguageOptions, pickDshLanguage } = flow
const titleOf = async (selector) => String(await val(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); return e ? (e.getAttribute('title') || '') : '__missing__' })()`))
const shot = async (name) => { if (shotsDir !== null) await page.shot(shotsDir + '/' + name + '.png') }
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { await restoreEnglish(); await live.close(); process.exit(130) })

await flow.installStub()

try {
  // ═══ 1. the page ═════════════════════════════════════════════════════════
  console.log('\n── the Language page ──')
  await openSettings(LANGUAGE)
  await shot('01-page')
  check('the page opens on the real GUI', (await val(`!!document.querySelector('.kbth-page')`)) === true)
  check('two original languages: Français and English, no other one invented', (await hasRow('kybernos')) && (await hasRow('en')) && (await val(`document.querySelectorAll('[data-lang]').length`)) === 2, await val(`Array.from(document.querySelectorAll('[data-lang]')).map(e=>e.dataset.lang).join()`))
  check('the active language is marked "In use"', /In use/.test(String(await rowText('en'))), await rowText('en'))
  const pageText = String(await val('document.querySelector(".kbth-page").innerText'))
  check('no flag, no French text mixed with English in the page', !/[\u{1F1E6}-\u{1F1FF}]/u.test(pageText) && !/Traduction IA|Langue source|à traduire|Ajouter/.test(pageText), pageText.slice(0, 200))

  // ═══ 1b. the help and its animation ══════════════════════════════════════
  console.log('\n── help and animation ──')
  const helpBtn = JSON.parse(await val(`(() => { const b = document.querySelector('[data-act="help"]'); return b ? JSON.stringify({ text: b.innerText.replace(/\\s+/g, ' ').trim(), open: b.getAttribute('aria-expanded'), title: b.getAttribute('title') || '' }) : 'null' })()`))
  check('a "? How it works" button is in the page header, with a tooltip', helpBtn !== null && /How it works/.test(helpBtn.text) && helpBtn.title.length > 5, helpBtn)
  check('on the first visit (nothing is translated yet) the help is OPEN', helpBtn !== null && helpBtn.open === 'true' && (await val(`!!document.querySelector('[data-help="panel"]')`)) === true)
  await shot('01b-help')
  const helpText = String(await val(`(document.querySelector('[data-help="panel"]') || { innerText: '' }).innerText`))
  check('it shows the three steps: add, start, use', /Add a language/.test(helpText) && /Start translation/.test(helpText) && /Use/.test(helpText) && /Translate the interface in three steps/.test(helpText) && (await val(`document.querySelectorAll('.kbth-step').length`)) === 3, helpText.slice(0, 160))
  check('… and reminds that it is the same choice as in Settings › General › Language', /same choice as in Settings › General › Language/.test(helpText))
  check('the mini mockup is there (window, two rows, cursor, chips, bar) but is NOT mistaken for a real language', (await val(`!!document.querySelector('.kbth-mm') && !!document.querySelector('.kbth-mm-cur') && !!document.querySelector('.kbth-mm-fill') && document.querySelectorAll('[data-lang]').length === 2`)) === true)
  const anim = JSON.parse(await val(`(() => { const a = document.getAnimations().filter((x) => x.effect && x.effect.target && x.effect.target.closest && x.effect.target.closest('[data-help="panel"]')); return JSON.stringify({ n: a.length, running: a.every((x) => x.playState === 'running'), t0: a[0] ? a[0].currentTime : null }) })()`))
  await sleep(900)
  const t1 = Number(await val(`(() => { const a = document.getAnimations().filter((x) => x.effect && x.effect.target && x.effect.target.closest && x.effect.target.closest('[data-help="panel"]')); return a[0] ? a[0].currentTime : -1 })()`))
  check('the animation really RUNS (≥ 15 CSS animations, all playing, time advances)', anim.n >= 15 && anim.running === true && t1 > anim.t0, { anim, t1 })
  check('a 12 s loop, the steps are synchronized with the mockup (same duration)', (await val(`document.getAnimations().filter((x) => x.effect && x.effect.target && x.effect.target.closest && x.effect.target.closest('[data-help="panel"]')).every((x) => x.effect.getTiming().duration === 12000)`)) === true)
  // the steps light up one after the other
  await val(`document.getAnimations().forEach((a) => { try { a.pause(); a.currentTime = 1000 } catch (e) {} })`)
  const o1 = Number(await val(`getComputedStyle(document.querySelector('.kbth-step.s1')).opacity`))
  const o2a = Number(await val(`getComputedStyle(document.querySelector('.kbth-step.s2')).opacity`))
  await val(`document.getAnimations().forEach((a) => { try { a.currentTime = 6000 } catch (e) {} })`)
  const o2b = Number(await val(`getComputedStyle(document.querySelector('.kbth-step.s2')).opacity`))
  const o3 = Number(await val(`getComputedStyle(document.querySelector('.kbth-step.s3')).opacity`))
  await val(`document.getAnimations().forEach((a) => { try { a.currentTime = 9000 } catch (e) {} })`)
  const o3b = Number(await val(`getComputedStyle(document.querySelector('.kbth-step.s3')).opacity`))
  check('the current step is highlighted, not the others (1 at 1 s, 2 at 6 s, 3 at 9 s)', o1 === 1 && o2a < 1 && o2b === 1 && o3 < 1 && o3b === 1, { o1, o2a, o2b, o3, o3b })
  await val(`document.getAnimations().forEach((a) => { try { a.currentTime = 6500 } catch (e) {} })`)
  const fillW = Number(await val(`document.querySelector('.kbth-mm-fill').getBoundingClientRect().width / document.querySelector('.kbth-mm-track').getBoundingClientRect().width`))
  check('at 6.5 s the mockup bar is half-way (the translation is "advancing")', fillW > 0.3 && fillW < 0.95, fillW)
  await val(`document.getAnimations().forEach((a) => { try { a.play() } catch (e) {} })`)
  // reduced motion
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  await sleep(500)
  const still = JSON.parse(await val(`(() => { const a = document.getAnimations().filter((x) => x.effect && x.effect.target && x.effect.target.closest && x.effect.target.closest('[data-help="panel"]')); return JSON.stringify({ n: a.length, hola: getComputedStyle(document.querySelector('.kbth-mm-w2')).opacity, ready: getComputedStyle(document.querySelector('.kbth-mm-st .t3')).opacity, step1: getComputedStyle(document.querySelector('.kbth-step.s1')).opacity, step2: getComputedStyle(document.querySelector('.kbth-step.s2')).opacity }) })()`))
  await page.send('Emulation.setEmulatedMedia', { features: [] })
  check('"reduce motion": no animation left, the mockup shows the final state and all the steps are readable', still.n === 0 && still.hola === '1' && still.ready === '1' && still.step1 === '1' && still.step2 === '1', still)
  // open / closed is remembered
  await clickSel('[data-act="help"]'); await sleep(400)
  check('the button collapses the help', (await val(`!document.querySelector('[data-help="panel"]') && document.querySelector('[data-act="help"]').getAttribute('aria-expanded') === 'false'`)) === true)
  await reload()
  await openSettings(LANGUAGE)
  check('the "collapsed" choice is remembered after a reload', (await val(`!document.querySelector('[data-help="panel"]')`)) === true)
  await clickSel('[data-act="help"]'); await sleep(400)
  check('and it reopens with a click', (await val(`!!document.querySelector('[data-help="panel"]')`)) === true)
  const inUseTip = await titleOf('[data-lang="en"] [data-act="in-use"]')
  check('tooltip on "In use"', /language Kybernos and DSH are using/i.test(inUseTip), inUseTip)
  check('tooltip on the model choice (Advanced section) and on its title', /model that writes the translations/i.test(await titleOf('.kbth-select')) && /model choice/i.test(await titleOf('.kbth-adv > summary')), [await titleOf('.kbth-select'), await titleOf('.kbth-adv > summary')])

  // ═══ 2. adding a language: the ISO list ══════════════════════════════════
  console.log('\n── adding a language (ISO list) ──')
  await clickSel('[data-act="add-language"]'); await sleep(600)
  await shot('02-picker')
  const isoCount = await val(`document.querySelectorAll('.kbth-iso-i').length`)
  check('the ISO 639-1 list is shown (182 languages, English and French already being there)', isoCount === 182, isoCount)
  check('each entry carries the native name, the English name and the code', (await val(`(() => { const e = document.querySelector('.kbth-iso-i[data-iso="de"]'); return e ? e.innerText.replace(/\\n/g,' ') : '' })()`)) === 'Deutsch German de')
  check('the 20 popular languages are offered as shortcuts', (await val(`document.querySelectorAll('.kbth-chip').length`)) === 20)
  check('tooltips: add button, chips and list entries ("Add Spanish (es)")', /ISO 639-1/.test(await titleOf('[data-act="add-language"]')) && (await titleOf('.kbth-chip[data-iso="es"]')) === 'Add Spanish (es)' && (await titleOf('.kbth-iso-i[data-iso="de"]')) === 'Add German (de)', [await titleOf('[data-act="add-language"]'), await titleOf('.kbth-chip[data-iso="es"]'), await titleOf('.kbth-iso-i[data-iso="de"]')])
  await typeInPicker('esp')
  const found = await val(`Array.from(document.querySelectorAll('.kbth-iso-i')).map(e => e.innerText.replace(/\\n/g,' '))`)
  check('search filters by name ("esp" → Español)', found.length >= 1 && found.some((t) => /Español/.test(t)) && found.length < 10, found)
  await typeInPicker('japanese')
  check('search also accepts the English name ("japanese" → 日本語)', (await val(`Array.from(document.querySelectorAll('.kbth-iso-i')).some(e => /日本語/.test(e.innerText))`)) === true)
  await typeInPicker('zzzz')
  check('no result: clear message', /No language matches/.test(String(await val('document.querySelector(".kbth-add").innerText'))))
  await typeInPicker('esp')
  await clickSel('.kbth-iso [data-iso="es"]'); await sleep(900)
  check('choosing a language ADDS it to the list', await hasRow('es'))
  check('… and starts NOTHING by itself (no model call, no bar)', (await val('window.__KB_TEST__.calls')) === 0 && (await val(`!document.querySelector('[data-lang="es"] [role="progressbar"]')`)) === true)
  check('the picker closes', (await val(`!document.querySelector('.kbth-iso')`)) === true)
  const esText = String(await rowText('es'))
  check('the row says how many texts and how much time, before starting', /Not translated yet · about [\d,\s ]+ texts · around \d+ min/.test(esText), esText)
  check('the "Start translation" button is there', (await val(`(() => { const b = document.querySelector('[data-lang="es"] [data-act="start"]'); return !!b && b.innerText.trim() === 'Start translation' })()`)) === true, esText)
  check('tooltips: "Start translation" explains the action, the row explains the estimate', /Translates the interface into this language/.test(await titleOf('[data-lang="es"] [data-act="start"]')) && /Estimated from the number of texts/.test(await titleOf('[data-lang="es"] .kbth-lang-meta')), [await titleOf('[data-lang="es"] [data-act="start"]'), await titleOf('[data-lang="es"] .kbth-lang-meta')])
  await shot('03-added')

  // ═══ 3. translating ══════════════════════════════════════════════════════
  console.log('\n── translating: Start button, progress bar ──')
  await clickSel('[data-lang="es"] [data-act="start"]')
  await sleep(1200)
  await shot('04-running')
  const mid = JSON.parse(await val(`JSON.stringify({ bar: !!document.querySelector('[data-lang="es"] [role="progressbar"]'), now: Number((document.querySelector('[data-lang="es"] [role="progressbar"]')||{getAttribute(){return -1}}).getAttribute('aria-valuenow')), txt: document.querySelector('[data-lang="es"]').innerText.replace(/\\n+/g,' | ') })`))
  check('a progress bar appears in the row', mid.bar === true, mid)
  check('it advances (aria-valuenow > 0)', mid.now > 0 && mid.now < 100, mid)
  check('"X of Y texts" and the time left are shown', /\d[\d,\s ]* of \d[\d,\s ]* texts/.test(mid.txt), mid.txt)
  check('three detailed areas (menus/chat/settings, advanced, messages)', /Menus, chat and settings/.test(mid.txt) && /Advanced screens and plugins/.test(mid.txt) && /Messages and details/.test(mid.txt), mid.txt)
  check('a Pause button is offered, no duplicate "Start"', (await val(`!!document.querySelector('[data-lang="es"] [data-act="pause"]') && !document.querySelector('[data-lang="es"] [data-act="start"]')`)) === true, mid.txt)
  check('tooltips during the translation: Pause, bar, and each of the three areas explained', /Nothing is lost/.test(await titleOf('[data-lang="es"] [data-act="pause"]')) && /translated so far/.test(await titleOf('[data-lang="es"] [role="progressbar"]')) && (await val(`Array.from(document.querySelectorAll('[data-lang="es"] .kbth-areas > span[title]')).map((e) => e.getAttribute('title')).filter(Boolean).length`)) === 3, [await titleOf('[data-lang="es"] [data-act="pause"]'), await titleOf('[data-lang="es"] [role="progressbar"]')])
  const b0 = await val('window.__KB_TEST__.batches[0]')
  check('the English name of the language is sent with the request ("Spanish"), source "fr"', b0 && b0.lang === 'es' && b0.name === 'Spanish' && b0.source === 'fr', b0)
  check('several batches are launched (parallel translation)', (await waitFor(page, `window.__KB_TEST__.calls >= 6`, 8000)) !== null)

  await clickSel('[data-lang="es"] [data-act="pause"]'); await sleep(1500)
  await shot('05-paused')
  const paused = String(await rowText('es'))
  check('Pause: the row says "Paused at N%" and offers "Resume translation"', /Paused at \d+%/.test(paused) && /Resume translation/.test(paused), paused)
  check('Pause: what is translated is kept', (await val(`Object.keys(JSON.parse(localStorage.getItem('kybernos.i18n.es')||'{}')).length`)) > 0)
  const callsAtPause = await val('window.__KB_TEST__.calls')
  await sleep(900)
  check('Pause: no more model calls', (await val('window.__KB_TEST__.calls')) === callsAtPause)
  await clickSel('[data-lang="es"] [data-act="start"]')
  check('Resume: the translation goes all the way', (await waitReady('es', 60000)) !== null, await rowText('es'))
  await shot('06-ready')
  const readyText = String(await rowText('es'))
  check('"Ready · translated on <date> · N texts" and "Use" button', /Ready · translated on .+ · [\d,\s ]+ texts/.test(readyText) && /Use/.test(readyText) && !/Resume/.test(readyText), readyText)
  check('tooltips: "Use" warns about the reload, the "⋯" menu is named', /page reloads/.test(await titleOf('[data-lang="es"] [data-act="use"]')) && (await titleOf('[data-lang="es"] [data-act="menu"]')) === 'More actions', [await titleOf('[data-lang="es"] [data-act="use"]'), await titleOf('[data-lang="es"] [data-act="menu"]')])
  const stores = JSON.parse(await val(`JSON.stringify({ kb: Object.keys(JSON.parse(localStorage.getItem('kybernos.i18n.es')||'{}')).length, dsh: Object.keys(JSON.parse(localStorage.getItem('kybernos.i18n.dsh.es')||'{}')).length, meta: JSON.parse(localStorage.getItem('kybernos.i18n.meta.es')||'{}') })`))
  check('Kybernos (≈ 2 700) AND DSH (≈ 2 200) are both translated', stores.kb > 2000 && stores.dsh > 1500, stores)
  check('meta: complete, essentials ready', stores.meta.complete === true && stores.meta.essentials === true, stores.meta)
  check('nothing reloaded the page by itself (the active language is still English)', (await val(`document.documentElement.lang`)) === 'en')

  // ═══ 4. a failing model ══════════════════════════════════════════════════
  console.log('\n── failing model: readable message ──')
  await val(`window.__KB_TEST__.fail = true`)
  await addLanguage('de', 'deutsch')
  check('Deutsch added, with no automatic start', (await hasRow('de')) && (await val(`document.querySelectorAll('[data-lang="de"] [role="progressbar"]').length`)) === 0)
  await clickSel('[data-lang="de"] [data-act="start"]')
  await waitFor(page, `!!document.querySelector('[data-lang="de"] [role="alert"]')`, 20000)
  await shot('07-error')
  const err = String(await rowText('de'))
  check('the failure is stated plainly (API key missing), not "unusable response"', /needs an API key that isn’t set/.test(err) && !/inexploitable/.test(err), err)
  check('"Choose another model" is offered; before any progress, neither an empty bar nor a "kept" note', /Choose another model/.test(err) && !/already translated is kept/.test(err) && (await val(`document.querySelectorAll('[data-lang="de"] [role="progressbar"]').length`)) === 0, err)
  check('the bar does not lie: no text counted as translated', (await val(`Object.keys(JSON.parse(localStorage.getItem('kybernos.i18n.de')||'{}')).length`)) === 0)
  await clickSel('[data-lang="de"] [data-act="details"]'); await sleep(400)
  check('"Show details" shows the technical code', /MISSING_CREDENTIAL/.test(String(await rowText('de'))))
  await clickSel('[data-lang="de"] [data-act="choose-model"]'); await sleep(500)
  check('"Choose another model" opens the Advanced section', (await val(`document.querySelector('.kbth-adv').open`)) === true)
  await val(`window.__KB_TEST__.fail = false`)
  await clickSel('[data-lang="de"] [data-act="start"]')
  check('once the model is fixed, "Resume" takes the translation to the end', (await waitReady('de', 60000)) !== null, await rowText('de'))

  // ═══ 4b. a failure half-way: what is translated is kept ═════════════════
  console.log('\n── failure half-way: progress is kept ──')
  await val(`window.__KB_TEST__.failAfter = window.__KB_TEST__.calls + 7`)
  await addLanguage('it', null)
  await clickSel('[data-lang="it"] [data-act="start"]')
  await waitFor(page, `!!document.querySelector('[data-lang="it"] [role="alert"]')`, 40000)
  await shot('07b-error-midway')
  const mid2 = String(await rowText('it'))
  const pct2 = Number(await val(`Number((document.querySelector('[data-lang="it"] [role="progressbar"]')||{getAttribute(){return -1}}).getAttribute('aria-valuenow'))`))
  check('the bar shows the progress gained before the failure', pct2 > 0 && pct2 < 100, pct2)
  check('the message states the cause AND that what was done is kept', /needs an API key that isn’t set/.test(mid2) && /already translated is kept/.test(mid2), mid2)
  check('"Stopped at N%" and "Resume translation"', /Stopped at \d+%/.test(mid2) && /Resume translation/.test(mid2), mid2)
  await val(`window.__KB_TEST__.failAfter = null`)
  const keptBefore = Number(await val(`Object.keys(JSON.parse(localStorage.getItem('kybernos.i18n.it')||'{}')).length + Object.keys(JSON.parse(localStorage.getItem('kybernos.i18n.dsh.it')||'{}')).length`))
  const callsBefore2 = Number(await val('window.__KB_TEST__.calls'))
  await clickSel('[data-lang="it"] [data-act="start"]')
  check('the resume starts from what was done and finishes', (await waitReady('it', 60000)) !== null, await rowText('it'))
  const sentAfter = Number(await val(`window.__KB_TEST__.batches.slice(${callsBefore2}).reduce((n, b) => n + b.n, 0)`))
  check('the resume sent only what was missing (not the ' + keptBefore + ' already translated)', sentAfter > 0 && sentAfter < 4941 - keptBefore + 200, { keptBefore, sentAfter })

  // ═══ 5. removing a language ══════════════════════════════════════════════
  console.log('\n── removing a language ──')
  await clickSel('[data-lang="de"] [data-act="menu"]'); await sleep(500)
  await shot('08-menu')
  const menuText = String(await val('document.querySelector(".kbth-menu-pop") ? document.querySelector(".kbth-menu-pop").innerText : ""'))
  check('the "⋯" menu offers Translate again and Remove', /Translate again from scratch/.test(menuText) && /Remove this language/.test(menuText), menuText)
  await clickSel('[data-lang="de"] [data-act="remove"]'); await sleep(600)
  check('removal: a confirmation is asked before erasing', /Remove the .* translation from this computer\?/.test(String(await rowText('de'))), await rowText('de'))
  await clickSel('[data-lang="de"] [data-act="confirm-remove"]'); await sleep(800)
  check('the language disappears, and so do its caches', !(await hasRow('de')) && (await val(`localStorage.getItem('kybernos.i18n.de') === null && localStorage.getItem('kybernos.i18n.dsh.de') === null`)) === true)

  // ═══ 5b. an older installation: the translation is not lost ═══════════════
  console.log('\n── older installation: the translation has not disappeared ──')
  // What the previous engine left behind: Kybernos' tables only — no progress record, no registry, no DSH half.
  const legacyN = Number(await val(`(() => {
    const T = window.__KB_T__, P = window.__KB_FR_EN__, d = {}
    for (const k of Object.keys(T)) d[k] = '⟦' + ((T[k] && T[k].kybernos) || k) + '⟧'
    for (const p of Object.keys(P)) if (d[p] === undefined) d[p] = '⟦' + p + '⟧'
    localStorage.setItem('kybernos.i18n.sw', JSON.stringify(d))
    return Object.keys(d).length
  })()`))
  await openSettings(LANGUAGE)
  await sleep(1200)
  const sw = String(await rowText('sw'))
  const swPct = Number((/(\d+)% translated/.exec(sw) || [])[1])
  check('an old translation (dictionary without a progress record, without a registry) is found and listed', await hasRow('sw'), sw)
  check('… its row shows the real progress (≈ half: Kybernos yes, DSH no), not "0 %"', swPct > 30 && swPct < 80, sw)
  check('… it offers "Use anyway" (as is) and "Resume translation" (to finish it)', (await val(`(() => { const a = Array.from(document.querySelectorAll('[data-lang="sw"] [data-act]')).map((b) => b.dataset.act); return a.includes('use-now') && a.includes('start') && !a.includes('use') })()`)) === true, sw)
  check('… and nothing was removed from the storage', Number(await val(`Object.keys(JSON.parse(localStorage.getItem('kybernos.i18n.sw'))).length`)) === legacyN)
  await clickSel('[data-lang="sw"] [data-act="use-now"]')
  await sleep(2500)
  await waitFor(page, `document.documentElement.lang === 'sw'`, 20000)
  await reload()
  await openSettings(LANGUAGE)
  const swOn = String(await rowText('sw'))
  check('"Use anyway" activates the language; incomplete, it keeps a button to finish it', /In use/.test(swOn) && /Resume translation/.test(swOn), swOn)
  await clickSel('[data-lang="sw"] [data-act="start"]')
  await waitFor(page, `(() => { const r = document.querySelector('[data-lang="sw"]'); return !!r && /Ready ·/.test(r.innerText) })()`, 90000)
  const swSent = Number(await val(`window.__KB_TEST__.batches.reduce((a, b) => a + b.n, 0)`))
  check('the resume sends ONLY what was missing (the DSH half), not the Kybernos texts already translated', swSent > 1500 && swSent < legacyN + 200 && swSent < 3200, { swSent, legacyN })
  check('the original translations are kept as they were', Number(await val(`Object.values(JSON.parse(localStorage.getItem('kybernos.i18n.sw'))).filter((v) => /^⟦/.test(v)).length`)) >= legacyN)
  await clickSel('[data-lang="en"] [data-act="use"]')
  await sleep(2500)
  await waitFor(page, `document.documentElement.lang === 'en'`, 20000)
  await openSettings(LANGUAGE)
  await clickSel('[data-lang="sw"] [data-act="menu"]'); await sleep(400)
  await clickSel('[data-lang="sw"] [data-act="remove"]'); await sleep(400)
  await clickSel('[data-lang="sw"] [data-act="confirm-remove"]'); await sleep(600)
  check('(cleanup) the trial language is removed', !(await hasRow('sw')))

  // ═══ 6. a right-to-left language (prepared now, used last) ═══════════════
  console.log('\n── a right-to-left language ──')
  await addLanguage('ar', null)
  check('Arabic added from the shortcuts, with the "Right to left" label', (await hasRow('ar')) && /Right to left/.test(String(await rowText('ar'))), await rowText('ar'))
  check('tooltip on "Right to left": the layout is mirrored', /mirrored/.test(String(await val(`(Array.from(document.querySelectorAll('[data-lang="ar"] .kbth-pill')).find((e) => /Right to left/.test(e.innerText)) || { getAttribute: () => '' }).getAttribute('title')`))))
  await clickSel('[data-lang="ar"] [data-act="start"]')
  check('Arabic is translated all the way', (await waitReady('ar', 60000)) !== null, await rowText('ar'))

  // ═══ 6b. one choice, two surfaces ═════════════════════════════════════════
  console.log('\n── General › Language ⇄ Settings › Language ──')
  await openSettings(['Account'])
  await sleep(1200)
  const acct = String(await val(`(document.querySelector('[data-slot="settings.section"]') || { innerText: '' }).innerText`))
  check('Settings › Account no longer has a "Language" field', !/(^|\n)Language(\n|$)/i.test(acct) && (await val(`!document.querySelector('.kbac-seg')`)) === true && !/Français\s*English|العربية/.test(acct), acct.slice(0, 160))

  await openSettings(['General'])
  await sleep(1500)
  const row = await waitDshLanguageRow()
  check('the DSH Language row is ALWAYS there (it is not hidden) and shows the active language', row !== null && row.trigger === 'English', row)
  const link = JSON.parse((await val(`(() => { const a = document.querySelector('[data-act="manage-languages"]'); if (!a) return null; const r = a.getBoundingClientRect(); return JSON.stringify({ text: a.innerText.trim(), top: r.top, left: r.left, h: r.height }) })()`)) || 'null')
  await shot('08b-general-link')
  check('the "Manage languages and translations here" link is shown', link !== null && /Manage languages and translations here/.test(link.text), link)
  check('… right under the Language row (same column, a few pixels below)', link !== null && row !== null && link.top > row.labelTop && link.top - row.labelTop < 60 && Math.abs(link.left - row.labelLeft) < 4, { link, labelTop: row && row.labelTop })
  check('… and it does not shift the following rows (zero height in the flow)', (await val(`(() => { const a = document.querySelector('.kbth-gl'); return !!a && a.getBoundingClientRect().height === 0 })()`)) === true)
  await clickSel('[data-act="manage-languages"]')
  check('the link opens Settings › Language', (await waitFor(page, `!!document.querySelector('.kbth-page')`, 8000)) !== null)

  await openSettings(['General'])
  await waitFor(page, `performance.now() > 8000`, 20000)
  await openDshLanguageMenu()
  const opts = await dshLanguageOptions()
  await shot('08c-dsh-menu')
  check('the DSH selector lists the translated languages in addition to English and 中文', ['Español', 'العربية', 'English', '中文'].every((o) => opts.includes(o)), opts)
  check('the "Kybernos" entry is now called "Français"', opts.includes('Français') && !opts.includes('Kybernos'), opts)
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' })
  await sleep(300)
  await pickDshLanguage('Español', 'es')
  check('choosing Español IN DSH: Kybernos follows (same language on both sides)', (await val(`localStorage.getItem('kybernos.theme.lang')`)) === 'es', await val(`localStorage.getItem('kybernos.theme.lang')`))
  const shellEs = await val(`Array.from(document.querySelectorAll('*')).filter((e) => e.children.length === 0 && /^⟦(Full access|This machine|Into the Unknown)⟧$/.test(e.innerText || '')).length`)
  check('… and the DSH interface AND the Kybernos one are translated', shellEs >= 2 && /⟦Agent Teams⟧/.test(String(await val('document.body.innerText'))), shellEs)
  await openSettings(LANGUAGE)
  check('the Settings › Language page shows the same active language (DSH → Kybernos sync)', (await val(`!!document.querySelector('[data-lang="es"].on')`)) === true)
  await clickSel('[data-lang="en"] [data-act="use"]')
  await sleep(2500)
  await waitFor(page, `document.documentElement.lang === 'en'`, 20000)
  await reload()
  await openSettings(['General'])
  await sleep(1200)
  const back = await waitDshLanguageRow()
  check('choosing English in Settings › Language: the DSH selector also shows English (Kybernos → DSH sync)', back !== null && back.trigger === 'English', back)

  // ═══ 6c. the Language plugin switched OFF: translations stay ═══════════════
  console.log('\n── Language plugin off: translations stay ──')
  await languagePlugin(false)
  await openSettings(['General'])
  await sleep(1500)
  check('plugin off: no "Language" page in the navigation, no link under General', (await val(`(() => { const nav = Array.from(document.querySelectorAll('button,a,[role=button]')).filter((e) => e.getBoundingClientRect().left < 250 && /^(Language|Langue)$/.test((e.innerText || '').trim())); return nav.length === 0 && !document.querySelector('[data-act="manage-languages"]') })()`)) === true)
  const rowOff = await waitDshLanguageRow()
  check('plugin off: the DSH Language row stays (it is the only door, it is enough)', rowOff !== null && rowOff.trigger === 'English', rowOff)
  await waitFor(page, `performance.now() > 8000`, 20000)
  await openDshLanguageMenu()
  const optsOff = await dshLanguageOptions()
  await shot('08d-plugin-off-menu')
  check('plugin off: the list of available translations is KEPT (Español, العربية)', ['Español', 'العربية', 'English'].every((o) => optsOff.includes(o)), optsOff)
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' })
  await sleep(300)
  await pickDshLanguage('العربية', 'ar')
  check('plugin off: choosing Arabic in DSH activates it (lang=ar, dir=rtl)', (await val(`document.documentElement.lang + '/' + document.documentElement.dir`)) === 'ar/rtl', await val(`document.documentElement.lang + '/' + document.documentElement.dir`))
  const offHome = String(await val('document.body.innerText'))
  await shot('08e-plugin-off-ar')
  check('plugin off: Kybernos AND DSH stay translated (⟦Agent Teams⟧, ⟦Full access⟧…)', /⟦Agent Teams⟧/.test(offHome) && /⟦(Full access|This machine|Into the Unknown)⟧/.test(offHome), offHome.slice(0, 120))
  await openSettings(['Workers'])
  await sleep(6000)
  check('plugin off: no Language page, and live translation does not run (nothing is learned or sent to the model)', (await val(`!document.querySelector('.kbth-page') && localStorage.getItem('kybernos.i18n.live.ar') === null && Number(window.__KB_TEST__.calls) === 0`)) === true)
  await openSettings(['General', 'Général'])
  await sleep(1200)
  await pickDshLanguage('English', 'en')
  check('plugin off: going back to English in DSH brings Kybernos back too', (await val(`localStorage.getItem('kybernos.theme.lang')`)) === 'en', await val(`localStorage.getItem('kybernos.theme.lang')`))
  await languagePlugin(true)
  await reload()

  // ═══ 7. using Spanish: the whole interface follows ═══════════════════════
  console.log('\n── using the language: the whole interface follows ──')
  await openSettings(LANGUAGE)
  await clickSel('[data-lang="es"] [data-act="use"]')
  await sleep(2500)
  await waitFor(page, `document.documentElement.lang === 'es'`, 20000)
  await reload()
  check('the document language is "es", direction ltr', (await val(`document.documentElement.lang + '/' + document.documentElement.dir`)) === 'es/ltr', await val(`document.documentElement.lang + '/' + document.documentElement.dir`))
  const home = analyse(JSON.parse((await val(collectIn(null), 10000)) || '[]'))
  await shot('09-home-es')
  check('home: Kybernos texts AND DSH texts go through the system (⟦…⟧)', home.translated >= 30, { translated: home.translated, enLeft: home.en.slice(0, 8) })
  const dshTexts = await val(`Array.from(document.querySelectorAll('*')).filter(e => e.children.length === 0 && /^⟦(Show \\d+ more sessions|This machine|Full access|Into the Unknown|New Session)⟧$/.test(e.innerText || '')).length`)
  check('texts from the DSH CORE are translated ("Full access", "This machine", "Into the Unknown"…)', dshTexts >= 2, dshTexts)
  const composer = await val(`(() => { const e = document.querySelector('[placeholder*="⟦"], [data-placeholder*="⟦"]'); return e ? (e.getAttribute('placeholder') || e.getAttribute('data-placeholder')) : null })()`)
  check('the DSH input field is translated', typeof composer === 'string' && composer.indexOf('⟦') >= 0, composer)

  await openSettings(LANGUAGE)
  await sleep(1500)
  check('the Language page itself follows the chosen language', /⟦/.test(String(await val('(document.querySelector(".kbth-page") || { innerText: "" }).innerText'))))
  check('the "Español" row is marked active', (await val(`!!document.querySelector('[data-lang="es"].on')`)) === true)
  await shot('10-page-es')

  await openSettings(['General', 'Général'])
  await sleep(1500)
  const generalText = String(await val('document.body.innerText'))
  await shot('11-general-es')
  check('the DSH language selector (Settings › General) offers Español, and DSH is translated there', /Español/.test(generalText) && /⟦Rename Chat session after each recap⟧|⟦Font size⟧/.test(generalText), generalText.slice(0, 160))

  // ═══ 8. settings pages written with hardcoded text ═══════════════════════
  console.log('\n── settings pages with hardcoded text (live translation) ──')
  const SECTION = '[data-slot="settings.section"]'
  await openSettings(['Workers'])
  const first = analyse(JSON.parse((await val(collectIn(SECTION), 10000)) || '[]'))
  await sleep(7000)
  const later = analyse(JSON.parse((await val(collectIn(SECTION), 10000)) || '[]'))
  await shot('12-workers-es')
  const learned = Number(await val(`Object.keys(JSON.parse(localStorage.getItem('kybernos.i18n.live.es')||'{}')).length`))
  check('hardcoded texts were learned and cached (kybernos.i18n.live.es)', learned > 5, learned)
  check('the "Workers" page (hardcoded French) is translated: almost no French left visible (and it already is at the first measurement: learning is fast)', later.fr.length <= 3 && later.translated >= first.translated && later.translated > 10, { first: { ok: first.translated, fr: first.fr.length }, later: { ok: later.translated, fr: later.fr.length, left: later.fr.slice(0, 6) } })
  check('going back to the page: instant from the cache (no new call)', await (async () => {
    const callsBefore = await val('window.__KB_TEST__.calls')
    await openSettings(['Commands', 'Commandes']); await sleep(3000)
    await openSettings(['Workers']); await sleep(2500)
    const re = analyse(JSON.parse((await val(collectIn(SECTION), 10000)) || '[]'))
    return re.fr.length <= 3 && (await val('window.__KB_TEST__.calls')) - callsBefore <= 6
  })())
  await reload()
  {
    const pos = JSON.parse(await val(`JSON.stringify({ x: 140, y: innerHeight - 45 })`))
    await mouse(pos.x, pos.y); await sleep(5000)
  }
  const menuItems = await val(`Array.from(document.querySelectorAll('[role="menu"] [role="menuitem"]')).map(e => e.innerText.replace(/\\n/g,' ').trim())`)
  await shot('13-account-menu-es')
  check('the account menu (another plugin, with its own fr/en tables) is translated live', Array.isArray(menuItems) && menuItems.length >= 4 && menuItems.filter((t) => t.indexOf('⟦') >= 0).length >= Math.floor(menuItems.length / 2), menuItems)
  check('the chat and session titles are never touched by live translation', await (async () => {
    await reload()
    const titles = await val(`Array.from(document.querySelectorAll('a,button,div,span')).filter(e => /Mise à jour de DSH|Clé admin pour/.test(e.innerText) && e.children.length === 0).map(e => e.innerText.slice(0, 40))`)
    return Array.isArray(titles) && titles.length > 0 && titles.every((t) => t.indexOf('⟦') < 0)
  })())

  // ═══ 9. using the right-to-left language ═════════════════════════════════
  console.log('\n── activating the right-to-left language ──')
  await openSettings(LANGUAGE)
  await clickSel('[data-lang="ar"] [data-act="use"]')
  await sleep(2500)
  await waitFor(page, `document.documentElement.lang === 'ar'`, 20000)
  await reload()
  check('Arabic active: <html lang="ar" dir="rtl">', (await val(`document.documentElement.lang + '/' + document.documentElement.dir`)) === 'ar/rtl', await val(`document.documentElement.lang + '/' + document.documentElement.dir`))
  check('the sidebar moves to the right (mirrored layout)', (await val(`(() => { const v = Array.from(document.querySelectorAll('*')).filter((x) => x.children.length === 0 && /Agent Teams/.test(x.innerText || '') && x.getBoundingClientRect().width > 0); return v.length > 0 && v.every((x) => x.getBoundingClientRect().left > innerWidth / 2) })()`)) === true)
  await shot('14-home-ar')
  await openSettings(LANGUAGE)
  await shot('15-page-ar')
  check('the Language page in Arabic: block inside the window, nothing overflows', (await val(`(() => { const p = document.querySelector('.kbth-page'); if (!p) return null; const r = p.getBoundingClientRect(); return r.right <= innerWidth + 1 && r.left >= -1 && document.documentElement.scrollWidth <= innerWidth + 1 })()`)) === true)
} catch (e) {
  fail += 1
  console.log('  ✗ the test itself stopped: ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' ⏎ ') : e))
} finally {
  await restoreEnglish()
}

await sleep(1500)
{
  const after = storedLocale()
  check('no leftover: the language STORED by DSH is back to "' + storedBefore + '"', storedBefore === null ? true : after === storedBefore, { before: storedBefore, after })
}
await live.close()
console.log('\n' + pass + ' ✓  ' + fail + ' ✗')
process.exit(fail === 0 ? 0 : 1)

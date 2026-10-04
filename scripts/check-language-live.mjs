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
// afterwards. It refuses to start if DSH's stored language is not « en », so it
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

// Refuses to start unless DSH's stored language is « en » (see the warning above).
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
  console.log('\n── la page Langue ──')
  await openSettings(LANGUAGE)
  await shot('01-page')
  check('la page s’ouvre sur la vraie GUI', (await val(`!!document.querySelector('.kbth-page')`)) === true)
  check('deux langues d’origine : Français et English, aucune autre inventée', (await hasRow('kybernos')) && (await hasRow('en')) && (await val(`document.querySelectorAll('[data-lang]').length`)) === 2, await val(`Array.from(document.querySelectorAll('[data-lang]')).map(e=>e.dataset.lang).join()`))
  check('la langue active est marquée « In use »', /In use/.test(String(await rowText('en'))), await rowText('en'))
  const pageText = String(await val('document.querySelector(".kbth-page").innerText'))
  check('aucun drapeau, aucun texte français mélangé à l’anglais dans la page', !/[\u{1F1E6}-\u{1F1FF}]/u.test(pageText) && !/Traduction IA|Langue source|à traduire|Ajouter/.test(pageText), pageText.slice(0, 200))

  // ═══ 1b. the help and its animation ══════════════════════════════════════
  console.log('\n── aide et animation ──')
  const helpBtn = JSON.parse(await val(`(() => { const b = document.querySelector('[data-act="help"]'); return b ? JSON.stringify({ text: b.innerText.replace(/\\s+/g, ' ').trim(), open: b.getAttribute('aria-expanded'), title: b.getAttribute('title') || '' }) : 'null' })()`))
  check('un bouton « ? How it works » est dans l’en-tête de la page, avec une infobulle', helpBtn !== null && /How it works/.test(helpBtn.text) && helpBtn.title.length > 5, helpBtn)
  check('à la première visite (rien n’est encore traduit) l’aide est OUVERTE', helpBtn !== null && helpBtn.open === 'true' && (await val(`!!document.querySelector('[data-help="panel"]')`)) === true)
  await shot('01b-help')
  const helpText = String(await val(`(document.querySelector('[data-help="panel"]') || { innerText: '' }).innerText`))
  check('elle montre les trois étapes : ajouter, démarrer, utiliser', /Add a language/.test(helpText) && /Start translation/.test(helpText) && /Use/.test(helpText) && /Translate the interface in three steps/.test(helpText) && (await val(`document.querySelectorAll('.kbth-step').length`)) === 3, helpText.slice(0, 160))
  check('… et rappelle que c’est le même choix que dans Réglages › Général › Language', /same choice as in Settings › General › Language/.test(helpText))
  check('la mini-maquette est là (fenêtre, deux lignes, curseur, puces, barre) mais n’est PAS prise pour une vraie langue', (await val(`!!document.querySelector('.kbth-mm') && !!document.querySelector('.kbth-mm-cur') && !!document.querySelector('.kbth-mm-fill') && document.querySelectorAll('[data-lang]').length === 2`)) === true)
  const anim = JSON.parse(await val(`(() => { const a = document.getAnimations().filter((x) => x.effect && x.effect.target && x.effect.target.closest && x.effect.target.closest('[data-help="panel"]')); return JSON.stringify({ n: a.length, running: a.every((x) => x.playState === 'running'), t0: a[0] ? a[0].currentTime : null }) })()`))
  await sleep(900)
  const t1 = Number(await val(`(() => { const a = document.getAnimations().filter((x) => x.effect && x.effect.target && x.effect.target.closest && x.effect.target.closest('[data-help="panel"]')); return a[0] ? a[0].currentTime : -1 })()`))
  check('l’animation TOURNE vraiment (≥ 15 animations CSS, toutes en lecture, le temps avance)', anim.n >= 15 && anim.running === true && t1 > anim.t0, { anim, t1 })
  check('une boucle de 12 s, les étapes sont synchronisées sur la maquette (même durée)', (await val(`document.getAnimations().filter((x) => x.effect && x.effect.target && x.effect.target.closest && x.effect.target.closest('[data-help="panel"]')).every((x) => x.effect.getTiming().duration === 12000)`)) === true)
  // the steps light up one after the other
  await val(`document.getAnimations().forEach((a) => { try { a.pause(); a.currentTime = 1000 } catch (e) {} })`)
  const o1 = Number(await val(`getComputedStyle(document.querySelector('.kbth-step.s1')).opacity`))
  const o2a = Number(await val(`getComputedStyle(document.querySelector('.kbth-step.s2')).opacity`))
  await val(`document.getAnimations().forEach((a) => { try { a.currentTime = 6000 } catch (e) {} })`)
  const o2b = Number(await val(`getComputedStyle(document.querySelector('.kbth-step.s2')).opacity`))
  const o3 = Number(await val(`getComputedStyle(document.querySelector('.kbth-step.s3')).opacity`))
  await val(`document.getAnimations().forEach((a) => { try { a.currentTime = 9000 } catch (e) {} })`)
  const o3b = Number(await val(`getComputedStyle(document.querySelector('.kbth-step.s3')).opacity`))
  check('l’étape en cours est mise en avant, pas les autres (1 à 1 s, 2 à 6 s, 3 à 9 s)', o1 === 1 && o2a < 1 && o2b === 1 && o3 < 1 && o3b === 1, { o1, o2a, o2b, o3, o3b })
  await val(`document.getAnimations().forEach((a) => { try { a.currentTime = 6500 } catch (e) {} })`)
  const fillW = Number(await val(`document.querySelector('.kbth-mm-fill').getBoundingClientRect().width / document.querySelector('.kbth-mm-track').getBoundingClientRect().width`))
  check('à 6,5 s la barre de la maquette est à mi-course (la traduction « avance »)', fillW > 0.3 && fillW < 0.95, fillW)
  await val(`document.getAnimations().forEach((a) => { try { a.play() } catch (e) {} })`)
  // reduced motion
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  await sleep(500)
  const still = JSON.parse(await val(`(() => { const a = document.getAnimations().filter((x) => x.effect && x.effect.target && x.effect.target.closest && x.effect.target.closest('[data-help="panel"]')); return JSON.stringify({ n: a.length, hola: getComputedStyle(document.querySelector('.kbth-mm-w2')).opacity, ready: getComputedStyle(document.querySelector('.kbth-mm-st .t3')).opacity, step1: getComputedStyle(document.querySelector('.kbth-step.s1')).opacity, step2: getComputedStyle(document.querySelector('.kbth-step.s2')).opacity }) })()`))
  await page.send('Emulation.setEmulatedMedia', { features: [] })
  check('« réduire les animations » : plus aucune animation, la maquette montre l’état final et toutes les étapes sont lisibles', still.n === 0 && still.hola === '1' && still.ready === '1' && still.step1 === '1' && still.step2 === '1', still)
  // open / closed is remembered
  await clickSel('[data-act="help"]'); await sleep(400)
  check('le bouton replie l’aide', (await val(`!document.querySelector('[data-help="panel"]') && document.querySelector('[data-act="help"]').getAttribute('aria-expanded') === 'false'`)) === true)
  await reload()
  await openSettings(LANGUAGE)
  check('le choix « replié » est mémorisé après rechargement', (await val(`!document.querySelector('[data-help="panel"]')`)) === true)
  await clickSel('[data-act="help"]'); await sleep(400)
  check('et on la rouvre d’un clic', (await val(`!!document.querySelector('[data-help="panel"]')`)) === true)
  const inUseTip = await titleOf('[data-lang="en"] [data-act="in-use"]')
  check('infobulle sur « In use »', /language Kybernos and DSH are using/i.test(inUseTip), inUseTip)
  check('infobulle sur le choix du modèle (section Avancé) et sur son titre', /model that writes the translations/i.test(await titleOf('.kbth-select')) && /model choice/i.test(await titleOf('.kbth-adv > summary')), [await titleOf('.kbth-select'), await titleOf('.kbth-adv > summary')])

  // ═══ 2. adding a language: the ISO list ══════════════════════════════════
  console.log('\n── ajouter une langue (liste ISO) ──')
  await clickSel('[data-act="add-language"]'); await sleep(600)
  await shot('02-picker')
  const isoCount = await val(`document.querySelectorAll('.kbth-iso-i').length`)
  check('la liste ISO 639-1 est affichée (182 langues, l’anglais et le français étant déjà là)', isoCount === 182, isoCount)
  check('chaque entrée porte le nom natif, le nom anglais et le code', (await val(`(() => { const e = document.querySelector('.kbth-iso-i[data-iso="de"]'); return e ? e.innerText.replace(/\\n/g,' ') : '' })()`)) === 'Deutsch German de')
  check('les 20 langues courantes sont proposées en raccourcis', (await val(`document.querySelectorAll('.kbth-chip').length`)) === 20)
  check('infobulles : bouton d’ajout, puces et entrées de la liste (« Add Spanish (es) »)', /ISO 639-1/.test(await titleOf('[data-act="add-language"]')) && (await titleOf('.kbth-chip[data-iso="es"]')) === 'Add Spanish (es)' && (await titleOf('.kbth-iso-i[data-iso="de"]')) === 'Add German (de)', [await titleOf('[data-act="add-language"]'), await titleOf('.kbth-chip[data-iso="es"]'), await titleOf('.kbth-iso-i[data-iso="de"]')])
  await typeInPicker('esp')
  const found = await val(`Array.from(document.querySelectorAll('.kbth-iso-i')).map(e => e.innerText.replace(/\\n/g,' '))`)
  check('la recherche filtre par nom (« esp » → Español)', found.length >= 1 && found.some((t) => /Español/.test(t)) && found.length < 10, found)
  await typeInPicker('japanese')
  check('la recherche accepte aussi le nom anglais (« japanese » → 日本語)', (await val(`Array.from(document.querySelectorAll('.kbth-iso-i')).some(e => /日本語/.test(e.innerText))`)) === true)
  await typeInPicker('zzzz')
  check('aucun résultat : message clair', /No language matches/.test(String(await val('document.querySelector(".kbth-add").innerText'))))
  await typeInPicker('esp')
  await clickSel('.kbth-iso [data-iso="es"]'); await sleep(900)
  check('choisir une langue l’AJOUTE à la liste', await hasRow('es'))
  check('… et ne démarre RIEN tout seul (aucun appel au modèle, pas de barre)', (await val('window.__KB_TEST__.calls')) === 0 && (await val(`!document.querySelector('[data-lang="es"] [role="progressbar"]')`)) === true)
  check('le sélecteur se referme', (await val(`!document.querySelector('.kbth-iso')`)) === true)
  const esText = String(await rowText('es'))
  check('la ligne dit combien de textes et combien de temps, avant de commencer', /Not translated yet · about [\d,\s ]+ texts · around \d+ min/.test(esText), esText)
  check('le bouton « Start translation » est là', (await val(`(() => { const b = document.querySelector('[data-lang="es"] [data-act="start"]'); return !!b && b.innerText.trim() === 'Start translation' })()`)) === true, esText)
  check('infobulles : « Start translation » explique l’action, la ligne explique l’estimation', /Translates the interface into this language/.test(await titleOf('[data-lang="es"] [data-act="start"]')) && /Estimated from the number of texts/.test(await titleOf('[data-lang="es"] .kbth-lang-meta')), [await titleOf('[data-lang="es"] [data-act="start"]'), await titleOf('[data-lang="es"] .kbth-lang-meta')])
  await shot('03-added')

  // ═══ 3. translating ══════════════════════════════════════════════════════
  console.log('\n── traduire : bouton Start, barre de progression ──')
  await clickSel('[data-lang="es"] [data-act="start"]')
  await sleep(1200)
  await shot('04-running')
  const mid = JSON.parse(await val(`JSON.stringify({ bar: !!document.querySelector('[data-lang="es"] [role="progressbar"]'), now: Number((document.querySelector('[data-lang="es"] [role="progressbar"]')||{getAttribute(){return -1}}).getAttribute('aria-valuenow')), txt: document.querySelector('[data-lang="es"]').innerText.replace(/\\n+/g,' | ') })`))
  check('une barre de progression apparaît dans la ligne', mid.bar === true, mid)
  check('elle avance (aria-valuenow > 0)', mid.now > 0 && mid.now < 100, mid)
  check('« X of Y texts » et le temps restant sont affichés', /\d[\d,\s ]* of \d[\d,\s ]* texts/.test(mid.txt), mid.txt)
  check('trois zones détaillées (menus/chat/réglages, avancé, messages)', /Menus, chat and settings/.test(mid.txt) && /Advanced screens and plugins/.test(mid.txt) && /Messages and details/.test(mid.txt), mid.txt)
  check('un bouton Pause est proposé, pas de « Start » en double', (await val(`!!document.querySelector('[data-lang="es"] [data-act="pause"]') && !document.querySelector('[data-lang="es"] [data-act="start"]')`)) === true, mid.txt)
  check('infobulles pendant la traduction : Pause, barre, et chacune des trois zones expliquée', /Nothing is lost/.test(await titleOf('[data-lang="es"] [data-act="pause"]')) && /translated so far/.test(await titleOf('[data-lang="es"] [role="progressbar"]')) && (await val(`Array.from(document.querySelectorAll('[data-lang="es"] .kbth-areas > span[title]')).map((e) => e.getAttribute('title')).filter(Boolean).length`)) === 3, [await titleOf('[data-lang="es"] [data-act="pause"]'), await titleOf('[data-lang="es"] [role="progressbar"]')])
  const b0 = await val('window.__KB_TEST__.batches[0]')
  check('le nom anglais de la langue part avec la requête (« Spanish »), source « fr »', b0 && b0.lang === 'es' && b0.name === 'Spanish' && b0.source === 'fr', b0)
  check('plusieurs lots sont lancés (traduction en parallèle)', (await waitFor(page, `window.__KB_TEST__.calls >= 6`, 8000)) !== null)

  await clickSel('[data-lang="es"] [data-act="pause"]'); await sleep(1500)
  await shot('05-paused')
  const paused = String(await rowText('es'))
  check('Pause : la ligne dit « Paused at N% » et propose « Resume translation »', /Paused at \d+%/.test(paused) && /Resume translation/.test(paused), paused)
  check('Pause : ce qui est traduit est gardé', (await val(`Object.keys(JSON.parse(localStorage.getItem('kybernos.i18n.es')||'{}')).length`)) > 0)
  const callsAtPause = await val('window.__KB_TEST__.calls')
  await sleep(900)
  check('Pause : plus aucun appel au modèle', (await val('window.__KB_TEST__.calls')) === callsAtPause)
  await clickSel('[data-lang="es"] [data-act="start"]')
  check('Reprise : la traduction va au bout', (await waitReady('es', 60000)) !== null, await rowText('es'))
  await shot('06-ready')
  const readyText = String(await rowText('es'))
  check('« Ready · translated on <date> · N texts » et bouton « Use »', /Ready · translated on .+ · [\d,\s ]+ texts/.test(readyText) && /Use/.test(readyText) && !/Resume/.test(readyText), readyText)
  check('infobulles : « Use » prévient du rechargement, le menu « ⋯ » est nommé', /page reloads/.test(await titleOf('[data-lang="es"] [data-act="use"]')) && (await titleOf('[data-lang="es"] [data-act="menu"]')) === 'More actions', [await titleOf('[data-lang="es"] [data-act="use"]'), await titleOf('[data-lang="es"] [data-act="menu"]')])
  const stores = JSON.parse(await val(`JSON.stringify({ kb: Object.keys(JSON.parse(localStorage.getItem('kybernos.i18n.es')||'{}')).length, dsh: Object.keys(JSON.parse(localStorage.getItem('kybernos.i18n.dsh.es')||'{}')).length, meta: JSON.parse(localStorage.getItem('kybernos.i18n.meta.es')||'{}') })`))
  check('Kybernos (≈ 2 700) ET DSH (≈ 2 200) sont tous deux traduits', stores.kb > 2000 && stores.dsh > 1500, stores)
  check('méta : complète, essentiel prêt', stores.meta.complete === true && stores.meta.essentials === true, stores.meta)
  check('rien n’a rechargé la page tout seul (la langue active est toujours l’anglais)', (await val(`document.documentElement.lang`)) === 'en')

  // ═══ 4. a failing model ══════════════════════════════════════════════════
  console.log('\n── échec du modèle : message lisible ──')
  await val(`window.__KB_TEST__.fail = true`)
  await addLanguage('de', 'deutsch')
  check('Deutsch ajoutée, sans démarrage automatique', (await hasRow('de')) && (await val(`document.querySelectorAll('[data-lang="de"] [role="progressbar"]').length`)) === 0)
  await clickSel('[data-lang="de"] [data-act="start"]')
  await waitFor(page, `!!document.querySelector('[data-lang="de"] [role="alert"]')`, 20000)
  await shot('07-error')
  const err = String(await rowText('de'))
  check('l’échec est dit en clair (clé d’API absente), pas « réponse inexploitable »', /needs an API key that isn’t set/.test(err) && !/inexploitable/.test(err), err)
  check('« Choose another model » est proposé ; avant toute progression, ni barre vide ni note « conservé »', /Choose another model/.test(err) && !/already translated is kept/.test(err) && (await val(`document.querySelectorAll('[data-lang="de"] [role="progressbar"]').length`)) === 0, err)
  check('la barre ne ment pas : aucun texte compté comme traduit', (await val(`Object.keys(JSON.parse(localStorage.getItem('kybernos.i18n.de')||'{}')).length`)) === 0)
  await clickSel('[data-lang="de"] [data-act="details"]'); await sleep(400)
  check('« Show details » montre le code technique', /MISSING_CREDENTIAL/.test(String(await rowText('de'))))
  await clickSel('[data-lang="de"] [data-act="choose-model"]'); await sleep(500)
  check('« Choose another model » ouvre la section Avancé', (await val(`document.querySelector('.kbth-adv').open`)) === true)
  await val(`window.__KB_TEST__.fail = false`)
  await clickSel('[data-lang="de"] [data-act="start"]')
  check('une fois le modèle réparé, « Resume » mène la traduction au bout', (await waitReady('de', 60000)) !== null, await rowText('de'))

  // ═══ 4b. a failure half-way: what is translated is kept ═════════════════
  console.log('\n── échec en cours de route : la progression est conservée ──')
  await val(`window.__KB_TEST__.failAfter = window.__KB_TEST__.calls + 7`)
  await addLanguage('it', null)
  await clickSel('[data-lang="it"] [data-act="start"]')
  await waitFor(page, `!!document.querySelector('[data-lang="it"] [role="alert"]')`, 40000)
  await shot('07b-error-midway')
  const mid2 = String(await rowText('it'))
  const pct2 = Number(await val(`Number((document.querySelector('[data-lang="it"] [role="progressbar"]')||{getAttribute(){return -1}}).getAttribute('aria-valuenow'))`))
  check('la barre montre la progression acquise avant la panne', pct2 > 0 && pct2 < 100, pct2)
  check('le message dit la cause ET que l’acquis est conservé', /needs an API key that isn’t set/.test(mid2) && /already translated is kept/.test(mid2), mid2)
  check('« Stopped at N% » et « Resume translation »', /Stopped at \d+%/.test(mid2) && /Resume translation/.test(mid2), mid2)
  await val(`window.__KB_TEST__.failAfter = null`)
  const keptBefore = Number(await val(`Object.keys(JSON.parse(localStorage.getItem('kybernos.i18n.it')||'{}')).length + Object.keys(JSON.parse(localStorage.getItem('kybernos.i18n.dsh.it')||'{}')).length`))
  const callsBefore2 = Number(await val('window.__KB_TEST__.calls'))
  await clickSel('[data-lang="it"] [data-act="start"]')
  check('la reprise repart de l’acquis et finit', (await waitReady('it', 60000)) !== null, await rowText('it'))
  const sentAfter = Number(await val(`window.__KB_TEST__.batches.slice(${callsBefore2}).reduce((n, b) => n + b.n, 0)`))
  check('la reprise n’a renvoyé que ce qui manquait (pas les ' + keptBefore + ' déjà traduits)', sentAfter > 0 && sentAfter < 4941 - keptBefore + 200, { keptBefore, sentAfter })

  // ═══ 5. removing a language ══════════════════════════════════════════════
  console.log('\n── supprimer une langue ──')
  await clickSel('[data-lang="de"] [data-act="menu"]'); await sleep(500)
  await shot('08-menu')
  const menuText = String(await val('document.querySelector(".kbth-menu-pop") ? document.querySelector(".kbth-menu-pop").innerText : ""'))
  check('le menu « ⋯ » propose Retraduire et Supprimer', /Translate again from scratch/.test(menuText) && /Remove this language/.test(menuText), menuText)
  await clickSel('[data-lang="de"] [data-act="remove"]'); await sleep(600)
  check('suppression : une confirmation est demandée avant d’effacer', /Remove the .* translation from this computer\?/.test(String(await rowText('de'))), await rowText('de'))
  await clickSel('[data-lang="de"] [data-act="confirm-remove"]'); await sleep(800)
  check('la langue disparaît, ses caches aussi', !(await hasRow('de')) && (await val(`localStorage.getItem('kybernos.i18n.de') === null && localStorage.getItem('kybernos.i18n.dsh.de') === null`)) === true)

  // ═══ 5b. an older installation: the translation is not lost ═══════════════
  console.log('\n── ancienne installation : la traduction n’a pas disparu ──')
  // What the previous engine left behind: Kybernos' tables only — no bilan, no registry, no DSH half.
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
  check('une ancienne traduction (dictionnaire sans bilan, sans registre) est retrouvée et listée', await hasRow('sw'), sw)
  check('… sa ligne dit la vraie avancée (≈ la moitié : Kybernos oui, DSH non), pas « 0 % »', swPct > 30 && swPct < 80, sw)
  check('… elle propose « Use anyway » (telle quelle) et « Resume translation » (la terminer)', (await val(`(() => { const a = Array.from(document.querySelectorAll('[data-lang="sw"] [data-act]')).map((b) => b.dataset.act); return a.includes('use-now') && a.includes('start') && !a.includes('use') })()`)) === true, sw)
  check('… et rien n’a été retiré du stockage', Number(await val(`Object.keys(JSON.parse(localStorage.getItem('kybernos.i18n.sw'))).length`)) === legacyN)
  await clickSel('[data-lang="sw"] [data-act="use-now"]')
  await sleep(2500)
  await waitFor(page, `document.documentElement.lang === 'sw'`, 20000)
  await reload()
  await openSettings(LANGUAGE)
  const swOn = String(await rowText('sw'))
  check('« Use anyway » active la langue ; incomplète, elle garde un bouton pour la terminer', /In use/.test(swOn) && /Resume translation/.test(swOn), swOn)
  await clickSel('[data-lang="sw"] [data-act="start"]')
  await waitFor(page, `(() => { const r = document.querySelector('[data-lang="sw"]'); return !!r && /Ready ·/.test(r.innerText) })()`, 90000)
  const swSent = Number(await val(`window.__KB_TEST__.batches.reduce((a, b) => a + b.n, 0)`))
  check('la reprise ne renvoie QUE ce qui manquait (la moitié DSH), pas les textes Kybernos déjà traduits', swSent > 1500 && swSent < legacyN + 200 && swSent < 3200, { swSent, legacyN })
  check('les traductions d’origine sont conservées telles quelles', Number(await val(`Object.values(JSON.parse(localStorage.getItem('kybernos.i18n.sw'))).filter((v) => /^⟦/.test(v)).length`)) >= legacyN)
  await clickSel('[data-lang="en"] [data-act="use"]')
  await sleep(2500)
  await waitFor(page, `document.documentElement.lang === 'en'`, 20000)
  await openSettings(LANGUAGE)
  await clickSel('[data-lang="sw"] [data-act="menu"]'); await sleep(400)
  await clickSel('[data-lang="sw"] [data-act="remove"]'); await sleep(400)
  await clickSel('[data-lang="sw"] [data-act="confirm-remove"]'); await sleep(600)
  check('(nettoyage) la langue d’essai est supprimée', !(await hasRow('sw')))

  // ═══ 6. a right-to-left language (prepared now, used last) ═══════════════
  console.log('\n── une langue de droite à gauche ──')
  await addLanguage('ar', null)
  check('arabe ajouté depuis les raccourcis, avec la mention « Right to left »', (await hasRow('ar')) && /Right to left/.test(String(await rowText('ar'))), await rowText('ar'))
  check('infobulle sur « Right to left » : la mise en page est inversée', /mirrored/.test(String(await val(`(Array.from(document.querySelectorAll('[data-lang="ar"] .kbth-pill')).find((e) => /Right to left/.test(e.innerText)) || { getAttribute: () => '' }).getAttribute('title')`))))
  await clickSel('[data-lang="ar"] [data-act="start"]')
  check('l’arabe se traduit jusqu’au bout', (await waitReady('ar', 60000)) !== null, await rowText('ar'))

  // ═══ 6b. one choice, two surfaces ═════════════════════════════════════════
  console.log('\n── General › Language ⇄ Settings › Language ──')
  await openSettings(['Account'])
  await sleep(1200)
  const acct = String(await val(`(document.querySelector('[data-slot="settings.section"]') || { innerText: '' }).innerText`))
  check('Settings › Account n’a plus de champ « Language »', !/(^|\n)Language(\n|$)/i.test(acct) && (await val(`!document.querySelector('.kbac-seg')`)) === true && !/Français\s*English|العربية/.test(acct), acct.slice(0, 160))

  await openSettings(['General'])
  await sleep(1500)
  const row = await waitDshLanguageRow()
  check('la ligne Language de DSH est TOUJOURS là (on ne la masque pas) et montre la langue active', row !== null && row.trigger === 'English', row)
  const link = JSON.parse((await val(`(() => { const a = document.querySelector('[data-act="manage-languages"]'); if (!a) return null; const r = a.getBoundingClientRect(); return JSON.stringify({ text: a.innerText.trim(), top: r.top, left: r.left, h: r.height }) })()`)) || 'null')
  await shot('08b-general-link')
  check('le lien « Manage languages and translations here » est affiché', link !== null && /Manage languages and translations here/.test(link.text), link)
  check('… juste sous la ligne Language (même colonne, quelques pixels dessous)', link !== null && row !== null && link.top > row.labelTop && link.top - row.labelTop < 60 && Math.abs(link.left - row.labelLeft) < 4, { link, labelTop: row && row.labelTop })
  check('… et il ne décale pas les lignes suivantes (hauteur nulle dans le flux)', (await val(`(() => { const a = document.querySelector('.kbth-gl'); return !!a && a.getBoundingClientRect().height === 0 })()`)) === true)
  await clickSel('[data-act="manage-languages"]')
  check('le lien ouvre Settings › Language', (await waitFor(page, `!!document.querySelector('.kbth-page')`, 8000)) !== null)

  await openSettings(['General'])
  await waitFor(page, `performance.now() > 8000`, 20000)
  await openDshLanguageMenu()
  const opts = await dshLanguageOptions()
  await shot('08c-dsh-menu')
  check('le sélecteur de DSH liste les langues traduites en plus de English et 中文', ['Español', 'العربية', 'English', '中文'].every((o) => opts.includes(o)), opts)
  check('l’entrée « Kybernos » s’appelle maintenant « Français »', opts.includes('Français') && !opts.includes('Kybernos'), opts)
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' })
  await sleep(300)
  await pickDshLanguage('Español', 'es')
  check('choisir Español DANS DSH : Kybernos suit (même langue des deux côtés)', (await val(`localStorage.getItem('kybernos.theme.lang')`)) === 'es', await val(`localStorage.getItem('kybernos.theme.lang')`))
  const shellEs = await val(`Array.from(document.querySelectorAll('*')).filter((e) => e.children.length === 0 && /^⟦(Full access|This machine|Into the Unknown)⟧$/.test(e.innerText || '')).length`)
  check('… et l’interface de DSH ET celle de Kybernos sont traduites', shellEs >= 2 && /⟦Agent Teams⟧/.test(String(await val('document.body.innerText'))), shellEs)
  await openSettings(LANGUAGE)
  check('la page Settings › Language montre la même langue active (synchro DSH → Kybernos)', (await val(`!!document.querySelector('[data-lang="es"].on')`)) === true)
  await clickSel('[data-lang="en"] [data-act="use"]')
  await sleep(2500)
  await waitFor(page, `document.documentElement.lang === 'en'`, 20000)
  await reload()
  await openSettings(['General'])
  await sleep(1200)
  const back = await waitDshLanguageRow()
  check('choisir English dans Settings › Language : le sélecteur de DSH affiche aussi English (synchro Kybernos → DSH)', back !== null && back.trigger === 'English', back)

  // ═══ 6c. the Language plugin switched OFF: translations stay ═══════════════
  console.log('\n── plugin Langue éteint : les traductions restent ──')
  await languagePlugin(false)
  await openSettings(['General'])
  await sleep(1500)
  check('plugin éteint : pas de page « Language » dans la navigation, pas de lien sous General', (await val(`(() => { const nav = Array.from(document.querySelectorAll('button,a,[role=button]')).filter((e) => e.getBoundingClientRect().left < 250 && /^(Language|Langue)$/.test((e.innerText || '').trim())); return nav.length === 0 && !document.querySelector('[data-act="manage-languages"]') })()`)) === true)
  const rowOff = await waitDshLanguageRow()
  check('plugin éteint : la ligne Language de DSH reste (c’est la seule porte, elle suffit)', rowOff !== null && rowOff.trigger === 'English', rowOff)
  await waitFor(page, `performance.now() > 8000`, 20000)
  await openDshLanguageMenu()
  const optsOff = await dshLanguageOptions()
  await shot('08d-plugin-off-menu')
  check('plugin éteint : la liste des traductions disponibles est GARDÉE (Español, العربية)', ['Español', 'العربية', 'English'].every((o) => optsOff.includes(o)), optsOff)
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' })
  await sleep(300)
  await pickDshLanguage('العربية', 'ar')
  check('plugin éteint : choisir l’arabe dans DSH l’active (lang=ar, dir=rtl)', (await val(`document.documentElement.lang + '/' + document.documentElement.dir`)) === 'ar/rtl', await val(`document.documentElement.lang + '/' + document.documentElement.dir`))
  const offHome = String(await val('document.body.innerText'))
  await shot('08e-plugin-off-ar')
  check('plugin éteint : Kybernos ET DSH restent traduits (⟦Agent Teams⟧, ⟦Full access⟧…)', /⟦Agent Teams⟧/.test(offHome) && /⟦(Full access|This machine|Into the Unknown)⟧/.test(offHome), offHome.slice(0, 120))
  await openSettings(['Workers'])
  await sleep(6000)
  check('plugin éteint : aucune page Langue, et la traduction à la volée ne tourne pas (rien n’est appris ni envoyé au modèle)', (await val(`!document.querySelector('.kbth-page') && localStorage.getItem('kybernos.i18n.live.ar') === null && Number(window.__KB_TEST__.calls) === 0`)) === true)
  await openSettings(['General', 'Général'])
  await sleep(1200)
  await pickDshLanguage('English', 'en')
  check('plugin éteint : revenir à English dans DSH ramène aussi Kybernos', (await val(`localStorage.getItem('kybernos.theme.lang')`)) === 'en', await val(`localStorage.getItem('kybernos.theme.lang')`))
  await languagePlugin(true)
  await reload()

  // ═══ 7. using Spanish: the whole interface follows ═══════════════════════
  console.log('\n── utiliser la langue : toute l’interface suit ──')
  await openSettings(LANGUAGE)
  await clickSel('[data-lang="es"] [data-act="use"]')
  await sleep(2500)
  await waitFor(page, `document.documentElement.lang === 'es'`, 20000)
  await reload()
  check('la langue du document est « es », sens ltr', (await val(`document.documentElement.lang + '/' + document.documentElement.dir`)) === 'es/ltr', await val(`document.documentElement.lang + '/' + document.documentElement.dir`))
  const home = analyse(JSON.parse((await val(collectIn(null), 10000)) || '[]'))
  await shot('09-home-es')
  check('l’accueil : textes Kybernos ET textes DSH passent par le système (⟦…⟧)', home.translated >= 30, { translated: home.translated, enLeft: home.en.slice(0, 8) })
  const dshTexts = await val(`Array.from(document.querySelectorAll('*')).filter(e => e.children.length === 0 && /^⟦(Show \\d+ more sessions|This machine|Full access|Into the Unknown|New Session)⟧$/.test(e.innerText || '')).length`)
  check('des textes du CŒUR de DSH sont traduits (« Full access », « This machine », « Into the Unknown »…)', dshTexts >= 2, dshTexts)
  const composer = await val(`(() => { const e = document.querySelector('[placeholder*="⟦"], [data-placeholder*="⟦"]'); return e ? (e.getAttribute('placeholder') || e.getAttribute('data-placeholder')) : null })()`)
  check('le champ de saisie de DSH est traduit', typeof composer === 'string' && composer.indexOf('⟦') >= 0, composer)

  await openSettings(LANGUAGE)
  await sleep(1500)
  check('la page Langue elle-même suit la langue choisie', /⟦/.test(String(await val('(document.querySelector(".kbth-page") || { innerText: "" }).innerText'))))
  check('la ligne « Español » est marquée active', (await val(`!!document.querySelector('[data-lang="es"].on')`)) === true)
  await shot('10-page-es')

  await openSettings(['General', 'Général'])
  await sleep(1500)
  const generalText = String(await val('document.body.innerText'))
  await shot('11-general-es')
  check('le sélecteur de langue de DSH (Réglages › Général) propose Español, et DSH y est traduit', /Español/.test(generalText) && /⟦Rename Chat session after each recap⟧|⟦Font size⟧/.test(generalText), generalText.slice(0, 160))

  // ═══ 8. settings pages written with hardcoded text ═══════════════════════
  console.log('\n── pages de réglages écrites en dur (traduction à la volée) ──')
  const SECTION = '[data-slot="settings.section"]'
  await openSettings(['Workers'])
  const first = analyse(JSON.parse((await val(collectIn(SECTION), 10000)) || '[]'))
  await sleep(7000)
  const later = analyse(JSON.parse((await val(collectIn(SECTION), 10000)) || '[]'))
  await shot('12-workers-es')
  const learned = Number(await val(`Object.keys(JSON.parse(localStorage.getItem('kybernos.i18n.live.es')||'{}')).length`))
  check('des textes en dur ont été appris et mis en cache (kybernos.i18n.live.es)', learned > 5, learned)
  check('la page « Workers » (français en dur) est traduite : presque plus de français visible (et elle l’est déjà à la première mesure : l’apprentissage est rapide)', later.fr.length <= 3 && later.translated >= first.translated && later.translated > 10, { first: { ok: first.translated, fr: first.fr.length }, later: { ok: later.translated, fr: later.fr.length, left: later.fr.slice(0, 6) } })
  check('revenir sur la page : instantané depuis le cache (aucun nouvel appel)', await (async () => {
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
  check('le menu du compte (autre plugin, tables fr/en à lui) est traduit à la volée', Array.isArray(menuItems) && menuItems.length >= 4 && menuItems.filter((t) => t.indexOf('⟦') >= 0).length >= Math.floor(menuItems.length / 2), menuItems)
  check('le chat et les titres de session ne sont jamais touchés par la traduction à la volée', await (async () => {
    await reload()
    const titles = await val(`Array.from(document.querySelectorAll('a,button,div,span')).filter(e => /Mise à jour de DSH|Clé admin pour/.test(e.innerText) && e.children.length === 0).map(e => e.innerText.slice(0, 40))`)
    return Array.isArray(titles) && titles.length > 0 && titles.every((t) => t.indexOf('⟦') < 0)
  })())

  // ═══ 9. using the right-to-left language ═════════════════════════════════
  console.log('\n── activer la langue de droite à gauche ──')
  await openSettings(LANGUAGE)
  await clickSel('[data-lang="ar"] [data-act="use"]')
  await sleep(2500)
  await waitFor(page, `document.documentElement.lang === 'ar'`, 20000)
  await reload()
  check('arabe actif : <html lang="ar" dir="rtl">', (await val(`document.documentElement.lang + '/' + document.documentElement.dir`)) === 'ar/rtl', await val(`document.documentElement.lang + '/' + document.documentElement.dir`))
  check('la barre latérale passe à droite (mise en page inversée)', (await val(`(() => { const v = Array.from(document.querySelectorAll('*')).filter((x) => x.children.length === 0 && /Agent Teams/.test(x.innerText || '') && x.getBoundingClientRect().width > 0); return v.length > 0 && v.every((x) => x.getBoundingClientRect().left > innerWidth / 2) })()`)) === true)
  await shot('14-home-ar')
  await openSettings(LANGUAGE)
  await shot('15-page-ar')
  check('la page Langue en arabe : bloc dans la fenêtre, rien ne déborde', (await val(`(() => { const p = document.querySelector('.kbth-page'); if (!p) return null; const r = p.getBoundingClientRect(); return r.right <= innerWidth + 1 && r.left >= -1 && document.documentElement.scrollWidth <= innerWidth + 1 })()`)) === true)
} catch (e) {
  fail += 1
  console.log('  ✗ the test itself stopped: ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' ⏎ ') : e))
} finally {
  await restoreEnglish()
}

await sleep(1500)
{
  const after = storedLocale()
  check('aucun résidu : la langue STOCKÉE par DSH est revenue à « ' + storedBefore + ' »', storedBefore === null ? true : after === storedBefore, { before: storedBefore, after })
}
await live.close()
console.log('\n' + pass + ' ✓  ' + fail + ' ✗')
process.exit(fail === 0 ? 0 : 1)

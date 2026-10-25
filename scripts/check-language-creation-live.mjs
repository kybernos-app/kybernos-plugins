#!/usr/bin/env node
// The creation surfaces speak the language of the page, in a real GUI (WP-07a of the 2026-10-16 audit: A2-31, A2-08, A2-07, A2-19,
// A2-18, A2-24, A1-23).
//
//   source scripts/sandbox/env.sh && node scripts/check-language-creation-live.mjs [--shots <dir>] [--langs en,kybernos,es,ar]
//
// Needs a DSH that serves this checkout (scripts/sandbox/start.sh); refuses :3080 and any DSH home that is not a sandbox's. It never
// touches DSH's own stored language: the language of Kybernos is set in the throw-away browser (localStorage `kybernos.theme.lang`, the
// key the Language page writes), which is exactly what a person who picked a language on the Language page has. `en` removes it,
// `kybernos` is the French of Kybernos, `es` and `ar` are translated languages that have no table of ours.
//
// For each language it reads: the right-sidebar start list, the panels Bricks, Slides, 3D modeller, Summary, Motion and Dashboard, the
// sidebar's « Search everywhere » row, the composer's environment menu (Computers), the menu button of the phone layout, the Atlas page
// and its help, and the Dashboards page. English, Spanish and Arabic must read English everywhere; French must read French; nothing
// reads French in another language, nor English in French.
// Exit code 0 / 1 / 3 (3 = inconclusive: no sandbox).
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { clickText, openLivePage, openSettings, waitFor } from './live-page.mjs'

const args = process.argv.slice(2)
const shotDir = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : null
const LANGS = (args.includes('--langs') ? args[args.indexOf('--langs') + 1] : 'en,kybernos,es,ar').split(',')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0
let fail = 0
const check = (name, ok, detail) => { if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail).slice(0, 400))) } }

const host = process.env.KB_HOST || '127.0.0.1:3080'
const home = process.env.DSH_HOME || ''
if (host === '127.0.0.1:3080') { console.error('○ inconclusive: this check needs a DSH that serves this checkout (a sandbox instance), not the one on :3080.'); process.exit(3) }
if (home.indexOf('.kybernos-sandbox') < 0) { console.error('○ inconclusive: DSH_HOME is not a sandbox home.'); process.exit(3) }

// What a language must show. A French word in an English page, or an English phrase of ours in the French one, is a failure.
const FRENCH_WORDS = /\b(Briques|Modeleur|Aucun|Aucune|Demande|Voir la|Relire|Début|Résumé|Rechercher partout|Fichiers|Ouvrir|Rejouer|Effacer|Gomme|Mettre à jour|Autour|Réessayer|Partir de|Ce poste|Créations|Mémoire|Leçons|Aide)\b/
const ENGLISH_OF_OURS = /\b(No model yet|Ask the chat|Bricks|3D modeller|Replay|Eraser|Clear all|Search everywhere|This machine|Update|Start from|Try again|Nothing read yet|See the demo|Ask the chat for a deck)\b/

const live = await openLivePage({ width: 1500, height: 950 }).catch((e) => { console.error('○ inconclusive: ' + e.message); process.exit(3) })
const { page } = live
const val = async (expr, ms) => (await page.evalJs(expr, ms)).val
const shot = async (name) => { if (shotDir !== null) { try { mkdirSync(shotDir, { recursive: true }); await page.shot(join(shotDir, name + '.png')) } catch (e) { /* no screenshot */ } } }
const press = async (x, y) => {
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
}
const centre = async (js) => { const p = await val(`(() => { const e = (${js}); if (!e) return null; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 }) })()`); return p === null ? null : JSON.parse(p) }
const click = async (js) => { const c = await centre(js); if (c === null) return false; await press(c.x, c.y); await sleep(700); return true }
// The right sidebar's own toggles are pressed by the page (a click event on the button), not with the mouse: the toggle of a closed sidebar sits at the very right of the title bar and a
// window of this width can lay it out beyond its edge, where a mouse press lands on nothing. What is checked here is the language of what opens, not the hit test of the button.
const domClick = async (sel) => { const ok = await val(`(() => { const b = document.querySelector(${JSON.stringify(sel)}); if (!b) return false; b.click(); return true })()`); await sleep(700); return ok === true }
// The start list is in the right pane (x > 830): the hero of the chat has tiles with the same names (« Slides »).
// (In a right-to-left language the « right » pane is drawn on the left of the window.)
const IN_PANE = `((r) => (document.documentElement.dir === 'rtl' ? r.right <= 700 : r.left >= 830))`
const rowByText = (t) => `Array.from(document.querySelectorAll('button')).find((b) => ${IN_PANE}(b.getBoundingClientRect()) && (b.innerText || '').replace(/[⟦⟧]/g, '').trim().split('\\n')[0] === ${JSON.stringify(t)})`
// Every text of the right pane under its tab bar.
const RIGHT_PANE = `Array.from(document.querySelectorAll('body *')).filter((e) => { const r = e.getBoundingClientRect(); return ${IN_PANE}(r) && r.top >= 44 && r.width > 0 }).map((e) => Array.from(e.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(' ').trim()).filter((t) => t !== '').join(' | ')`
const text = (sel) => val(`(document.querySelector(${JSON.stringify(sel)}) || { innerText: '' }).innerText`)

const setLang = async (lang) => {
  await val(`localStorage.${lang === 'en' ? 'removeItem' : 'setItem'}('kybernos.theme.lang'${lang === 'en' ? '' : `, ${JSON.stringify(lang)}`})`)
  await page.send('Page.reload', { ignoreCache: true })
  await sleep(5500)
  await val(`(() => { const b = Array.from(document.querySelectorAll('button[aria-label="Close"]'))[0]; if (b) b.click() })()`)
  await sleep(500)
  // The panels Slides and Dashboard open for a chat that exists: on an EMPTY new chat the same row only shows the tiles of the hero. Every language therefore starts on the chat
  // this run made (the composer, the start list, the right sidebar).
  await waitFor(page, `document.querySelector('[data-kb="computer-env-button"]') !== null`, 8000)
  if (!(await mountChat())) { console.error('○ inconclusive: no chat session could be mounted in this instance (the first message made none), so the panels cannot be opened.'); await live.close(); process.exit(3) }
}
// A chat is mounted when its own message is in the main column (the sidebar row of the same title is not): a chat of an earlier language is opened from the sidebar, else the first
// message makes one (no model here, the turn fails, that is fine).
const CHAT = 'Language creation check'
const mounted = () => val(`Array.from(document.querySelectorAll('body *')).some((e) => e.children.length === 0 && (e.innerText || '').trim() === ${JSON.stringify(CHAT)} && e.getBoundingClientRect().left > 300)`)
const mountChat = async () => {
  if (await mounted()) return true
  if ((await val(`document.body.innerText.includes(${JSON.stringify(CHAT)})`)) === true && (await clickText(page, CHAT))) {
    if ((await waitFor(page, `Array.from(document.querySelectorAll('body *')).some((e) => e.children.length === 0 && (e.innerText || '').trim() === ${JSON.stringify(CHAT)} && e.getBoundingClientRect().left > 300)`, 8000)) !== null) return true
  }
  const c = await centre(`document.querySelector('[contenteditable="true"], textarea')`)
  if (c === null) return false
  await press(c.x + 40, c.y)
  await sleep(300)
  await page.send('Input.insertText', { text: CHAT })
  await sleep(300)
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' })
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  return (await waitFor(page, `Array.from(document.querySelectorAll('body *')).some((e) => e.children.length === 0 && (e.innerText || '').trim() === ${JSON.stringify(CHAT)} && e.getBoundingClientRect().left > 300)`, 15000)) !== null
}
const startList = () => val(`Array.from(document.querySelectorAll('button')).map((b) => (b.innerText || '').trim().split('\\n')[0]).filter((t) => t && t.length < 40)`)

try {
  await sleep(2500)
  for (const lang of LANGS) {
    const french = lang === 'kybernos'
    console.log('\n── language « ' + lang + ' » ──')
    await setLang(lang)
    check('the page resolves the language we set', (await val('window.__KB_LANG_RESOLVE__()')) === (lang === 'en' ? 'en' : lang))
    const wrongFor = (t, what) => (french ? ENGLISH_OF_OURS.test(t) : FRENCH_WORDS.test(t)) ? { what, found: (french ? ENGLISH_OF_OURS : FRENCH_WORDS).exec(t)[0], t: t.slice(0, 200) } : null

    // ── the sidebar, the composer and the phone layout ──
    const labels = await val(`Array.from(document.querySelectorAll('button[aria-label], [data-kb]')).map((e) => (e.getAttribute('aria-label') || '') + '|' + (e.getAttribute('data-kb') || '') + '|' + (e.title || '')).join(' ¦ ')`)
    check('the sidebar search row is named in the language', french ? /Rechercher partout/.test(labels) && !/Search everywhere/.test(labels) : /Search everywhere/.test(labels) && !/Rechercher partout/.test(labels), labels.slice(0, 200))
    const menuBtn = await val(`(document.querySelector('button.kbmob-menu') || { getAttribute: () => null }).getAttribute('aria-label')`)
    check('the menu button of the phone layout is named in the language of the page (A1-23)', menuBtn === (french ? 'Ouvrir le menu' : 'Open the menu'), menuBtn)
    const env = await val(`(document.querySelector('[data-kb="computer-env-button"]') || { innerText: '', title: '' }).innerText + ' | ' + (document.querySelector('[data-kb="computer-env-button"]') || { title: '' }).title`)
    check('the composer\'s « where it runs » menu is in the language (A2-18)', french ? /Ce poste/.test(env) && /Environnement/.test(env) : /This machine/.test(env) && /Execution environment/.test(env), env)

    // ── the right sidebar: the start list, then each creation panel ──
    // The sandbox keeps the right pane from one run to the next (open or closed, with the tabs of the last run): open it if it is
    // closed, then ask for a fresh start list.
    let start = []
    for (let attempt = 0; attempt < 4 && !start.includes(french ? 'Résumé' : 'Summary'); attempt += 1) {
      await domClick('button[aria-label="Open right sidebar"]')
      await sleep(800)
      await domClick('button[aria-label="New tab"]')
      await sleep(1000)
      start = await startList()
    }
    const names = french ? ['Résumé', 'Briques', 'Slides', 'Modeleur'] : ['Summary', 'Bricks', 'Slides', '3D modeller']
    check('the right-sidebar start list names the creation panels in the language (A2-31)', names.every((n) => start.includes(n)), start.slice(0, 30))
    check('…and no French name in another language, no English name in French', french ? !start.includes('Bricks') && !start.includes('3D modeller') : !start.includes('Briques') && !start.includes('Modeleur'), start.slice(0, 30))
    await shot('start-' + lang)

    const PANELS = [
      { en: 'Bricks', fr: 'Briques', root: '.kbb-root', want: french ? ['Aucune maquette pour le moment', 'Demande au chat'] : ['No model yet', 'Ask the chat'] },
      { en: 'Slides', fr: 'Slides', root: '.kbsd-root', want: french ? ['Demande un deck au chat', 'Voir la démo'] : ['Ask the chat for a deck', 'See the demo'] },
      { en: '3D modeller', fr: 'Modeleur', root: '.kbmo', want: french ? ['Aucun modèle pour le moment', 'Demande au chat'] : ['No model yet', 'Ask the chat'] },
      { en: 'Summary', fr: 'Résumé', root: '.kbsm-root', want: french ? ['Rien à résumer pour l’instant'] : ['Nothing to sum up yet'] },
      // A2-07: the page that lists the animations is named like the sidebar names it (« Creations »), never « Livrables ».
      { en: 'Motion', fr: 'Motion', root: '[data-kb="motion-panel"]', want: french ? ['page Créations'] : ['the Creations page'], not: /Livrables|Deliverables/ },
      { en: 'Dashboard', fr: 'Dashboard', root: '[data-kb="dashboards-pane"]', want: french ? ['Pas encore de dashboard'] : ['No dashboard yet'] },
    ]
    for (const p of PANELS) {
      if (!(await click(rowByText(french ? p.fr : p.en)))) { check('the « ' + (french ? p.fr : p.en) + ' » row opens', false, start.slice(0, 30)); continue }
      const body = await waitFor(page, `(() => { const t = ${RIGHT_PANE}; return ${JSON.stringify(p.want)}.some((w) => t.includes(w)) ? t : '' })()`, 8000) || await val(RIGHT_PANE)
      check('the ' + p.en + ' panel opens', typeof body === 'string' && body !== '' && !/^Start/.test(body.split(' | ')[0] || ''), body)
      if (typeof body === 'string' && body !== '') {
        check('the ' + p.en + ' panel speaks the language (A2-31)', p.want.every((w) => body.includes(w)), body.slice(0, 200))
        check('the ' + p.en + ' panel has no word of another language', wrongFor(body, p.en) === null && (p.not === undefined || !p.not.test(body)), wrongFor(body, p.en) || body.slice(0, 200))
        await shot(p.en.replace(/\W+/g, '-') + '-' + lang)
      }
      await domClick('button[aria-label="New tab"]')
      await sleep(700)
    }

    // ── the Atlas page (A2-19) ──
    if (await openSettings(page, { minCells: 3 })) {
      if (await clickText(page, 'Atlas')) {
        await sleep(1500)
        const atlas = await waitFor(page, `(() => { const e = document.querySelector('[data-kb="atlas"]'); return e ? e.innerText : '' })()`, 8000)
        check('the Atlas page opens', atlas !== null)
        if (atlas !== null) {
          check('the Atlas page speaks the language (A2-19)', french ? /Rien n’a encore été lu/.test(atlas) && /Mettre à jour/.test(atlas) && /Comment ça marche/.test(atlas) : /Nothing read yet/.test(atlas) && /Update/.test(atlas) && /How it works/.test(atlas), atlas.slice(0, 200))
          check('…and nothing of the other language', french ? !/Nothing read yet|Update\b/.test(atlas) : !/Rien n’a|Mettre à jour|Comment ça marche/.test(atlas), atlas.slice(0, 200))
          await shot('atlas-' + lang)
          if (await clickText(page, french ? 'Comment ça marche' : 'How it works')) {
            await sleep(600)
            const help = await text('[role="dialog"][aria-labelledby="kbat-help-t"]')
            check('the Atlas help dialog speaks the language', french ? /Comment lire l’Atlas/.test(help) && /Compris/.test(help) : /How to read the Atlas/.test(help) && /Got it/.test(help), help.slice(0, 120))
            await shot('atlas-help-' + lang)
          }
        }
      } else check('the Atlas entry is in Settings', false)
      await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
      await sleep(300)
    } else check('Settings opens', false)
  }
} finally {
  await live.close()
}
console.log('\n' + pass + ' ✓  ' + fail + ' ✗')
process.exit(fail === 0 ? 0 : 1)

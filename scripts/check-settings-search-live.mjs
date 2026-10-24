#!/usr/bin/env node
// Checks the search in the Settings against the REAL GUI: what a person types finds the setting, the menu shows where the matches are, a
// result opens the page and goes to the row, Escape clears before it closes anything — and the index does not drift: every row of
// KB_SS_INDEX is looked for on its page (the labels it promises are the labels the page shows).
//
//   node scripts/check-settings-search-live.mjs [--worktree] [--shots <dir>] [--no-drift] [--lang fr]
//
// --worktree: serve this checkout's core plugin client in the throw-away browser (scripts/lib-bundle-swap.mjs), so a change is checked before it
// is merged. Without it the check runs on what `dsh web` serves.
// --lang fr: runs the check in French (the results read as the French pages do, and the index scan looks for the French labels). Switching the language
// is DSH's own setting, kept in the profile, so this REFUSES to run against the real DSH (:3080): use the sandbox (scripts/sandbox/start.sh, then
// `source scripts/sandbox/env.sh`).
// READ-ONLY: it types in the search box, presses menu rows and results, and reads pages. Nothing that changes data is pressed.
// Exit code: 0 all green, 1 a check failed, 3 inconclusive (GUI down / Settings did not open).
import { mkdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { openLivePage, waitFor, openSettings, openThemeAdvanced } from './live-page.mjs'
import { swapBundles } from './lib-bundle-swap.mjs'

const args = process.argv.slice(2)
const shotsDir = args.indexOf('--shots') >= 0 ? args[args.indexOf('--shots') + 1] : null
if (shotsDir !== null) mkdirSync(shotsDir, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) }
}

// The index, cut out of the core plugin's client the way the unit test does.
const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'packages', 'kybernos-plugin', 'client.js'), 'utf8')
const a = SRC.indexOf('const KB_SS_MODE')
const b = SRC.indexOf('// </kb-settings-search>')
const { KB_SS_INDEX, kbSsNorm, kbSsLocalise } = new Function(SRC.slice(a, b) + '\nreturn { KB_SS_INDEX, kbSsNorm, kbSsLocalise }')()
const lang = args.indexOf('--lang') >= 0 ? args[args.indexOf('--lang') + 1] : 'en'
if (lang !== 'en' && lang !== 'fr') { console.error('○ --lang takes en or fr'); process.exit(3) }
if (lang !== 'en' && (process.env.KB_HOST || '127.0.0.1:3080') === '127.0.0.1:3080') { console.error('○ refusing: switching the language changes the real DSH\'s own setting. Run it on the sandbox (source scripts/sandbox/env.sh).'); process.exit(3) }

const live = await openLivePage({ width: 1500, height: 950 }).catch((e) => { console.error('○ inconclusive: ' + e.message); process.exit(3) })
const { page } = live
const ev = async (js) => { const r = await page.evalJs(js, 8000); return r.err ? null : r.val }
const mouse = async (x, y) => { for (const t of ['mouseMoved', 'mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type: t, x, y, button: 'left', clickCount: 1 }) }
const pointOf = async (js) => JSON.parse((await ev(`(() => { const e = ${js}; if (!e) return 'null'; const r = e.getBoundingClientRect(); return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 }) })()`)) || 'null')
const clickEl = async (js) => { const p = await pointOf(js); if (p === null) return false; await mouse(p.x, p.y); await sleep(500); return true }
const INPUT = `document.querySelector('.kbs-search input')`
const type = async (text) => { await clickEl(INPUT); await page.send('Input.insertText', { text }); await sleep(900) }
const clearBox = async () => { await ev(`(() => { const i = ${INPUT}; const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, ''); i.dispatchEvent(new Event('input', { bubbles: true })) })()`); await sleep(500) }
const key = async (k, code, vk) => { await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk }); await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk }); await sleep(500) }
const panelText = async () => (await ev(`(document.querySelector('.kbs-res') || { innerText: '' }).innerText`)) || ''
const resultNames = async () => JSON.parse((await ev(`JSON.stringify([...document.querySelectorAll('.kbs-rr .kbs-rn')].map((e) => e.textContent))`)) || '[]')
const menu = async () => JSON.parse((await ev(`JSON.stringify([...document.querySelectorAll('[class*="navList"] > *')].filter((c) => c.getBoundingClientRect().height > 0).map((c) => ({ t: (c.textContent || '').replace(/\\d+$/, '').trim(), head: c.dataset.kb === 'settings-group', open: c.getAttribute('aria-expanded') === 'true', hits: c.getAttribute('data-kb-hits'), dim: c.hasAttribute('data-kb-dim') })))`)) || '[]')

try {
  if (args.indexOf('--worktree') >= 0) { const swap = await swapBundles(page, [{ name: 'kybernos-plugin' }]); await page.send('Page.reload', { ignoreCache: true }); await sleep(4000); if (swap.report()[0].replaced !== true) console.log('○ the served client is not the checked-out one: running on what is deployed') }
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] })
  await waitFor(page, `document.readyState === 'complete'`, 15000); await sleep(2500)
  if (await openSettings(page, { minCells: 3, fold: 'keep' }) !== true) { console.error('○ inconclusive: the Settings dialog did not open (is the GUI loaded?)'); process.exit(3) }
  await waitFor(page, `document.querySelectorAll('[data-kb="settings-group"]').length >= 8 && document.querySelector('.kbs-search input') !== null`, 12000)
  await sleep(1200)
  if (lang === 'fr') {
    // Through the Language page, as a person does: the French row's « Use ». The cell is pressed from the script (a hidden cell is pressed too).
    await ev(`(() => { const c = [...document.querySelectorAll('[class*="navList"] [data-kb-t]')].find((x) => x.dataset.kbT === 'language'); if (c) c.click() })()`)
    await sleep(1800)
    const at = JSON.parse((await ev(`(() => { const pane = document.querySelector('[data-slot="settings.section"]'); const name = [...pane.querySelectorAll('*')].find((e) => /^Français$/.test((e.textContent || '').trim()) && e.children.length === 0); let row = name; for (let i = 0; i < 6 && row; i += 1) { const b = [...row.querySelectorAll('button')].find((x) => /^(Use|Utiliser)$/.test((x.textContent || '').trim())); if (b) { const r = b.getBoundingClientRect(); return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 }) } row = row.parentElement } return 'null' })()`)) || 'null')
    if (at === null) { console.error('○ inconclusive: no « Use » button on the French row of the Language page'); process.exit(3) }
    await mouse(at.x, at.y)
    await sleep(4000)
    if ((await ev(`document.documentElement.lang`)) !== 'fr') { console.error('○ inconclusive: the interface did not switch to French'); process.exit(3) }
    if ((await ev(`document.querySelectorAll('[class*="navList"] [data-kb-t]').length`)) < 8) await openSettings(page, { minCells: 3 })
    await waitFor(page, `document.querySelectorAll('[data-kb="settings-group"]').length >= 8 && document.querySelector('.kbs-search input') !== null`, 12000)
    await sleep(1500)
  }

  if (lang === 'en') {
  console.log('what people type')
  await type('dark')
  let names = await resultNames()
  check('« dark » finds the mode first (« Appearance »), and says it matched a value', names[0] === 'Appearance' && /matches a value/.test(await panelText()), names)
  {
    // The Appearance page is gone (2026-10-22): the light / dark / system mode is set on Theme › Essentials, and General repeats it, so the only other place to name is General.
    const where = await panelText()
    check('the panel says where the setting is shown (Theme › Essentials, also in General; no Appearance page any more)', /Appearance\s*\n\s*Theme › Essentials · also in General\s*\n/.test(where), where.slice(0, 300))
  }
  let m = await menu()
  check('the menu shows where the matches are: Interface is open with a count, the other groups are shut and quiet', m.find((r) => r.head && r.t === 'Interface').open === true && m.find((r) => r.head && r.t === 'Interface').hits === '3' && m.find((r) => r.head && r.t === 'Agents').open === false && m.find((r) => r.head && r.t === 'Agents').dim === true, m.filter((r) => r.head))
  if (shotsDir !== null) await page.shot(shotsDir + '/search-1-dark.png')
  check('the corner buttons (Open configuration file, Close) stay reachable above the panel', (await ev(`(() => { const x = document.querySelector('[role="dialog"] [class$="_close"]'); if (!x) return false; const r = x.getBoundingClientRect(); const t = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return t === x || x.contains(t) })()`)) === true)
  await clearBox()
  await type('police')
  names = await resultNames()
  check('« police » (French) finds Font size first, and the font picker', names[0] === 'Font size' && names.indexOf('Font') > 0, names)
  await clearBox()
  await type('clé api')
  names = await resultNames()
  check('« clé api » finds every place an API key goes (providers, connectors, the web search engines, the code sandbox)', ['Add provider', 'Composio key', 'Default engine', 'API key'].every((n) => names.indexOf(n) >= 0), names)
  if (shotsDir !== null) await page.shot(shotsDir + '/search-2-apikey.png')
  await clearBox()
  await type('themme')
  check('a typo finds the page and says what it understood', /did you mean “Theme”/.test(await panelText()), (await panelText()).slice(0, 120))
  await clearBox()
  await type('zzzzq')
  check('a word nothing matches says so, and offers searches to try', /Nothing for “zzzzq”/.test(await panelText()) && (await ev(`document.querySelectorAll('.kbs-try').length`)) === 5)
  if (shotsDir !== null) await page.shot(shotsDir + '/search-3-none.png')
  await clearBox()
  check('clearing the box hands the menu back: the panel is gone and every group is shut again', (await ev(`document.querySelector('.kbs-res') === null`)) === true && (await menu()).filter((r) => r.head && r.open).length === 0 && (await ev(`document.querySelector('[class*="navList"]').hasAttribute('data-kb-searching')`)) === false)

  console.log('open a result')
  await type('font size')
  await key('Enter', 'Enter', 13)
  await sleep(900)
  check('Enter opens the first result: the General page, the panel and the query are gone', (await ev(`(document.querySelector('[class*="navCell"][aria-current="true"]') || { textContent: '' }).textContent`)) === 'General' && (await ev(`document.querySelector('.kbs-res') === null`)) === true && (await ev(`${INPUT}.value`)) === '')
  check('the page scrolled to the row and made it blink', (await ev(`document.querySelector('.kbs-flash') !== null`)) === true || (await waitFor(page, `document.querySelector('.kbs-flash') !== null`, 1500)) !== null)
  if (shotsDir !== null) await page.shot(shotsDir + '/search-4-opened.png')
  await type('theme')
  await key('ArrowDown', 'ArrowDown', 40)
  const sel = await ev(`[...document.querySelectorAll('.kbs-rr')].findIndex((e) => e.getAttribute('aria-selected') === 'true')`)
  check('the arrow keys move the selection', sel === 1, sel)
  await clickEl(`document.querySelectorAll('.kbs-rr')[0]`)
  await sleep(700)
  check('pressing a result opens its page, and the group of that page is the open one', (await ev(`(document.querySelector('[class*="navCell"][aria-current="true"]') || { textContent: '' }).textContent`)) === 'Theme' && (await menu()).find((r) => r.head && r.t === 'Interface').open === true)

  console.log('Escape')
  await type('dark')
  await key('Escape', 'Escape', 27)
  check('Escape clears the query first and does not close the Settings', (await ev(`${INPUT}.value`)) === '' && (await ev(`document.querySelector('[role="dialog"]') !== null`)) === true && (await ev(`document.querySelector('.kbs-res') === null`)) === true)
  } else {
  console.log('what people type, in French')
  await type('rayons')
  let names = await resultNames()
  check('« rayons » finds Rayons first, with the French tab of its page', names[0] === 'Rayons' && /Thème › Texte et forme/.test(await panelText()), names)
  if (shotsDir !== null) await page.shot(shotsDir + '/search-fr-1-rayons.png')
  await clearBox()
  await type('taille du texte')
  names = await resultNames()
  check('« taille du texte » finds the row of the Theme page first, and says the same setting is on General', names[0] === 'Taille du texte' && /aussi dans General/.test(await panelText()), names)
  await clearBox()
  await type('nommer conversation')
  names = await resultNames()
  check('« nommer conversation » finds the French label of the General page', names[0] === 'Nommer chaque conversation à sa fin', names)
  await clearBox()
  await type('font size')
  names = await resultNames()
  check('a French reader who types the English words still finds the setting', names.indexOf('Font size') >= 0, names)
  await clearBox()
  await type('zzzzq')
  check('a word nothing matches says so in French, and offers searches to try', /Rien pour « zzzzq »/.test(await panelText()) && /taille du texte/.test(await panelText()))
  await clearBox()
  await type('rayons')
  await key('Enter', 'Enter', 13)
  await sleep(1200)
  check('Enter opens the Theme page on its « Texte et forme » tab and the row blinks', (await ev(`(document.querySelector('[class*="navCell"][aria-current="true"]') || { textContent: '' }).textContent`)) === 'Thème' && (await waitFor(page, `document.querySelector('.kbs-flash') !== null`, 2500)) !== null)
  if (shotsDir !== null) await page.shot(shotsDir + '/search-fr-2-opened.png')
  await type('mode')
  await key('Escape', 'Escape', 27)
  check('Escape clears the query first and does not close the Settings', (await ev(`${INPUT}.value`)) === '' && (await ev(`document.querySelector('[role="dialog"]') !== null`)) === true)
  }

  if (args.indexOf('--no-drift') < 0) {
    console.log('the index against the pages (every label it promises is on its page)')
    // Every page, once: the cell is pressed (programmatically: a hidden cell is pressed too), the page awaited, its texts read. Theme is read tab by tab.
    const LOC = (r) => kbSsLocalise(r, lang === 'fr' ? 'kybernos' : 'en', null)
    const KEYS = [...new Set(KB_SS_INDEX.map((r) => r[0]))]
    const missing = []
    const readPage = async () => JSON.parse((await ev(`JSON.stringify((() => { const pane = document.querySelector('[data-slot="settings.section"]'); if (!pane) return []; const out = []; const w = document.createTreeWalker(pane, NodeFilter.SHOW_TEXT); for (let n = w.nextNode(); n; n = w.nextNode()) { const t = n.nodeValue.trim(); if (t) out.push(t) } return out })())`)) || '[]').map(kbSsNorm)
    for (const k of KEYS) {
      const rows = KB_SS_INDEX.filter((r) => r[0] === k)
      const pressed = await ev(`(() => { const c = [...document.querySelectorAll('[class*="navList"] [data-kb-t]')].find((x) => x.dataset.kbT === ${JSON.stringify(k)}); if (!c) return false; c.click(); return true })()`)
      if (pressed !== true) { missing.push(k + ': no such page in the menu'); continue }
      await sleep(1400)
      // The Theme page opens on its simple view (the look studio); the editor with the tabs is folded under it, and the studio has chips of its own that share some of the tabs' names.
      if (k === 'theme') await openThemeAdvanced(page)
      let texts = await readPage()
      const tabs = [...new Set(rows.map((r) => r[1]).filter((s) => s !== ''))]
      for (const r of rows) {
        const want = kbSsNorm(LOC(r).at)
        if (k === 'theme' && r[1] !== '') {
          await ev(`(() => { const pane = document.querySelector('[data-slot="settings.section"]'); const t = [...pane.querySelectorAll('[data-kb="theme-classic"] .kbth-adv-tab')].find((b) => ${JSON.stringify(kbSsNorm(LOC(r).sec))} === (b.textContent || '').toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()); if (t) t.click() })()`)
          await sleep(500)
          texts = await readPage()
        }
        if (texts.indexOf(want) < 0) missing.push(k + ' › ' + (r[1] === '' ? '' : r[1] + ' › ') + LOC(r).at)
      }
      void tabs
    }
    check('every row of the index is on its page, word for word, in ' + (lang === 'fr' ? 'French' : 'English') + ' (a label the page shows differently must be fixed in KB_SS_INDEX / KB_SS_FR)', missing.length === 0, missing)
  }
} finally { await live.close() }

console.log('\n' + (fail === 0 ? 'ALL GREEN' : String(fail) + ' FAILED') + ' (' + String(pass + fail) + ' checks)')
process.exit(fail === 0 ? 0 : 1)

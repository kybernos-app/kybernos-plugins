#!/usr/bin/env node
// Checks the search in the Settings against the REAL GUI: what a person types finds the setting, the menu shows where the matches are, a
// result opens the page and goes to the row, Escape clears before it closes anything — and the index does not drift: every row of
// KB_SS_INDEX is looked for on its page (the labels it promises are the labels the page shows).
//
//   node scripts/check-settings-search-live.mjs [--worktree] [--shots <dir>] [--no-drift]
//
// --worktree: serve this checkout's core plugin client in the throw-away browser (scripts/lib-bundle-swap.mjs), so a change is checked before it
// is merged. Without it the check runs on what `dsh web` serves.
// READ-ONLY: it types in the search box, presses menu rows and results, and reads pages. Nothing that changes data is pressed.
// Exit code: 0 all green, 1 a check failed, 3 inconclusive (GUI down / Settings did not open).
import { mkdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { openLivePage, waitFor, openSettings } from './live-page.mjs'
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
const { KB_SS_INDEX, kbSsNorm } = new Function(SRC.slice(a, b) + '\nreturn { KB_SS_INDEX, kbSsNorm }')()

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

  console.log('what people type')
  await type('dark')
  let names = await resultNames()
  check('« dark » finds the mode first, and says it matched a value', names[0] === 'Mode' && /matches a value/.test(await panelText()), names)
  check('the panel says where else the same setting is shown', /also in General, Theme › Essentials/.test(await panelText()))
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
  check('« clé api » finds every place an API key goes (providers, connectors, the web search engines, cloud computers)', ['Add provider', 'Composio key', 'Default engine', 'API key'].every((n) => names.indexOf(n) >= 0), names)
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

  if (args.indexOf('--no-drift') < 0) {
    console.log('the index against the pages (every label it promises is on its page)')
    // Every page, once: the cell is pressed (programmatically: a hidden cell is pressed too), the page awaited, its texts read. Theme is read tab by tab.
    const KEYS = [...new Set(KB_SS_INDEX.map((r) => r[0]))]
    const missing = []
    const readPage = async () => JSON.parse((await ev(`JSON.stringify((() => { const pane = document.querySelector('[data-slot="settings.section"]'); if (!pane) return []; const out = []; const w = document.createTreeWalker(pane, NodeFilter.SHOW_TEXT); for (let n = w.nextNode(); n; n = w.nextNode()) { const t = n.nodeValue.trim(); if (t) out.push(t) } return out })())`)) || '[]').map(kbSsNorm)
    for (const k of KEYS) {
      const rows = KB_SS_INDEX.filter((r) => r[0] === k)
      const pressed = await ev(`(() => { const c = [...document.querySelectorAll('[class*="navList"] [data-kb-t]')].find((x) => x.dataset.kbT === ${JSON.stringify(k)}); if (!c) return false; c.click(); return true })()`)
      if (pressed !== true) { missing.push(k + ': no such page in the menu'); continue }
      await sleep(1400)
      let texts = await readPage()
      const tabs = [...new Set(rows.map((r) => r[1]).filter((s) => s !== ''))]
      for (const r of rows) {
        const want = kbSsNorm(r[7] || r[2])
        if (k === 'theme' && r[1] !== '') {
          await ev(`(() => { const pane = document.querySelector('[data-slot="settings.section"]'); const t = [...pane.querySelectorAll('button')].find((b) => ${JSON.stringify(kbSsNorm(r[1]))} === (b.textContent || '').toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()); if (t) t.click() })()`)
          await sleep(500)
          texts = await readPage()
        }
        if (texts.indexOf(want) < 0) missing.push(k + ' › ' + (r[1] === '' ? '' : r[1] + ' › ') + (r[7] || r[2]))
      }
      void tabs
    }
    check('every row of the index is on its page, word for word (a label the page shows differently must be fixed in KB_SS_INDEX)', missing.length === 0, missing)
  }
} finally { await live.close() }

console.log('\n' + (fail === 0 ? 'ALL GREEN' : String(fail) + ' FAILED') + ' (' + String(pass + fail) + ' checks)')
process.exit(fail === 0 ? 0 : 1)

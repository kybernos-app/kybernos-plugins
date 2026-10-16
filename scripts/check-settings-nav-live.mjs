#!/usr/bin/env node
// Checks the Settings nav against the REAL GUI: General first, a short list for a newcomer (the essentials) and the rest folded under « Advanced »,
// « Other settings » holding the shell's own pages, About closing the list, every icon different, every page titled like its entry.
//
//   node scripts/check-settings-nav-live.mjs [--shots <dir>]
//
// It opens Settings, measures, clicks the fold, types in the search box, follows a hidden entry like a help pointer does, and clicks every entry to
// read its page title. Everything it changes is in the throw-away browser (the fold's choice is kept in ITS localStorage): no setting of DSH is
// written. Exit code: 0 all green, 1 a check failed, 3 inconclusive (GUI down / Settings did not open).
import { mkdirSync } from 'node:fs'
import { openLivePage, waitFor, openSettings } from './live-page.mjs'

const args = process.argv.slice(2)
const shotsDir = args.indexOf('--shots') >= 0 ? args[args.indexOf('--shots') + 1] : null
if (shotsDir !== null) mkdirSync(shotsDir, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) }
}

const live = await openLivePage({ width: 1500, height: 950 }).catch((e) => { console.error('○ inconclusive: ' + e.message); process.exit(3) })
const { page } = live
const ev = async (js) => { const r = await page.evalJs(js, 8000); return r.err ? null : r.val }
const click = async (x, y) => { for (const t of ['mouseMoved', 'mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type: t, x, y, button: 'left', clickCount: 1 }) }
const shot = async (name) => { if (shotsDir === null) return; try { await page.shot(shotsDir + '/' + name + '.png') } catch (e) { /* no screenshot */ } }

/** The nav as drawn: every cell (title, React key, shown or not, section) and every header. */
const read = async () => JSON.parse(await ev(`(() => {
  const list = [...document.querySelectorAll('[class*="navList"]')].find(l => l.querySelector('[class*="navCell"]'))
  const keyOf = (el) => { const n = Object.keys(el).find(k => k.indexOf('__reactFiber$') === 0); return n === undefined ? null : el[n].key }
  const shown = (e) => { const r = e.getBoundingClientRect(); return r.height > 0 && getComputedStyle(e).display !== 'none' }
  const cells = [...list.querySelectorAll('[class*="navCell"]')].map(c => ({ t: c.textContent.trim(), key: keyOf(c), shown: shown(c), g: c.dataset.kbG === undefined ? null : Number(c.dataset.kbG), y: c.getBoundingClientRect().top, x: c.getBoundingClientRect().left + parseFloat(getComputedStyle(c).paddingInlineStart), active: c.getAttribute('aria-current') === 'true' }))
  const heads = [...list.querySelectorAll('[data-kb="settings-group"]')].map(h => ({ t: h.textContent.trim(), shown: shown(h), fold: h.hasAttribute('data-kb-fold-toggle'), expanded: h.getAttribute('aria-expanded'), y: h.getBoundingClientRect().top }))
  heads.sort((a, b) => a.y - b.y) // as drawn, top to bottom (the headers are appended in the order the organiser meets them)
  return JSON.stringify({ cells, heads, fold: list.dataset.kbFold || null, searching: list.hasAttribute('data-kb-searching'), marked: list.hasAttribute('data-kb-settings') })
})()`))
const visible = (m) => m.cells.filter((c) => c.shown).sort((a, b) => a.y - b.y).map((c) => c.t)
const store = async () => ev(`(() => { try { return window.localStorage.getItem('kybernos.fold.settings-advanced') } catch (e) { return 'unreadable' } })()`)
const toggle = async () => {
  const p = JSON.parse(await ev(`(() => { const b = document.querySelector('[data-kb-fold-toggle]'); const r = b.getBoundingClientRect(); return JSON.stringify({ x: r.left + 40, y: r.top + r.height / 2 }) })()`))
  await click(p.x, p.y)
  await sleep(300)
}
const reopen = async () => {
  await page.send('Page.reload', { ignoreCache: true })
  await sleep(3500)
  const ok = await openSettings(page, { minCells: 3, fold: 'keep' })
  await waitFor(page, `[...document.querySelectorAll('[class*="navCell"]')].some(e => e.textContent.trim() === 'About') && document.querySelector('[data-kb-fold-toggle]') !== null`, 12000)
  await sleep(800)
  return ok
}

try {
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] })
  await waitFor(page, `document.readyState === 'complete'`, 15000); await sleep(2500)
  const open = await openSettings(page, { minCells: 3, fold: 'keep' })
  if (open !== true) { console.error('○ inconclusive: the Settings dialog did not open (is the GUI loaded?)'); process.exit(3) }
  await waitFor(page, `[...document.querySelectorAll('[class*="navCell"]')].some(e => e.textContent.trim() === 'About') && document.querySelector('[data-kb-fold-toggle]') !== null`, 12000)
  await sleep(1200)

  console.log('a newcomer: the essentials, then a fold')
  let m = await read()
  let vis = visible(m)
  check('General is the first entry', vis[0] === 'General', vis.slice(0, 3))
  check('then AI Provider & Models, Memory & Lessons, Skills, Connectors, Appearance, Theme, Language, in that order', vis.slice(1, 8).join('|') === 'AI Provider & Models|Memory & Lessons|Skills|Connectors|Appearance|Theme|Language', vis.slice(0, 9))
  check('the fold, « Other settings » and About follow', m.heads.map((h) => h.t).join('|') === 'Advanced|Other settings' && vis.slice(8).join('|') === 'Built-in plugins|Agent presets|About', { heads: m.heads.map((h) => h.t), tail: vis.slice(8) })
  check('twelve entries or fewer are on screen before anything is opened (it was 28)', vis.length <= 12, vis.length)
  const advanced = m.cells.filter((c) => c.g === 1).map((c) => c.t)
  check('the fold holds the owner\'s list, hidden: ' + advanced.length + ' entries (Servers is the paid module\'s: only when it is linked)', advanced.length >= 16 && advanced.every((t) => !vis.includes(t)) && ['Kybernos Suite', 'Auto Routing', 'Usage', 'Workers', 'Automations', 'Tools', 'Web Search', 'Calls', 'Remote Control', 'Commands', 'Atlas', 'Ollama Local Models', 'Free LLMs', 'Voice'].every((t) => advanced.includes(t)), advanced)
  check('the fold is shut by itself and its button says so', m.fold === 'shut' && m.heads[0].fold === true && m.heads[0].expanded === 'false', { fold: m.fold, head: m.heads[0] })
  const theme = m.cells.find((c) => c.t === 'Theme')
  const appearance = m.cells.find((c) => c.t === 'Appearance')
  check('Theme and Language are drawn one step in under Appearance', theme !== undefined && appearance !== undefined && theme.x > appearance.x + 10, { theme: theme && theme.x, appearance: appearance && appearance.x })
  await shot('nav-newcomer')

  console.log('open it, shut it, and it remembers')
  await toggle()
  m = await read(); vis = visible(m)
  check('a click opens it: its entries show under its button, after the essentials, in the owner\'s order', m.fold === 'open' && m.heads[0].expanded === 'true' && vis.indexOf('Kybernos Suite') > vis.indexOf('Language') && vis.indexOf('Voice') > vis.indexOf('Kybernos Suite') && vis.indexOf('Built-in plugins') > vis.indexOf('Voice') && vis[vis.length - 1] === 'About', { fold: m.fold, vis })
  check('every entry is on the list now (28 cells, the shell\'s hidden Models one apart)', vis.length >= m.cells.length - 1, { shown: vis.length, cells: m.cells.length })
  // The layout the list always had: room under the last tab, names a notch under the shell's 14px, the list marked as the Settings nav.
  const lay = JSON.parse(await ev(`(() => {
    const list = [...document.querySelectorAll('[class*="navList"]')].find(l => l.querySelector('[class*="navCell"]'))
    const cells = [...list.querySelectorAll('[class*="navCell"]')].filter(c => c.getBoundingClientRect().height > 0)
    let sc = list; while (sc && sc !== document.body) { const o = getComputedStyle(sc).overflowY; if ((o === 'auto' || o === 'scroll') && sc.scrollHeight > sc.clientHeight) break; sc = sc.parentElement }
    const last = cells.reduce((a, c) => c.getBoundingClientRect().bottom > a.getBoundingClientRect().bottom ? c : a)
    if (sc && sc !== document.body) sc.scrollTop = sc.scrollHeight
    return JSON.stringify({ sizes: [...new Set(cells.map(c => parseFloat(getComputedStyle(c).fontSize)))], gap: sc && sc !== document.body ? Math.round(sc.getBoundingClientRect().bottom - last.getBoundingClientRect().bottom) : null })
  })()`))
  await sleep(300)
  check('there is room under the last tab (24px or more)', lay.gap !== null && lay.gap >= 24, lay.gap)
  check('tab names are 13px, one notch under the shell\'s 14px', lay.sizes.length === 1 && lay.sizes[0] === 13, lay.sizes)
  check('the list is marked as the Settings nav (the styles are scoped by it)', m.marked === true)
  await ev(`(() => { const list = [...document.querySelectorAll('[class*="navList"]')].find(l => l.querySelector('[class*="navCell"]')); let sc = list; while (sc && sc !== document.body) { if (sc.scrollTop > 0) { sc.scrollTop = 0 } sc = sc.parentElement } })()`)
  check('and the choice is written (it is kept across reloads)', (await store()) === '1')
  await shot('nav-open')
  await reopen()
  m = await read()
  check('after a reload the fold is still open', m.fold === 'open' && visible(m).includes('Voice'), m.fold)
  await toggle()
  m = await read()
  check('a second click shuts it again', m.fold === 'shut' && !visible(m).includes('Voice') && (await store()) === '0')
  await reopen()
  m = await read()
  check('after a reload it is still shut', m.fold === 'shut' && !visible(m).includes('Voice'), m.fold)

  console.log('the search box opens it by itself')
  const box = JSON.parse(await ev(`(() => { const i = document.querySelector('input[type="search"]'); const r = i.getBoundingClientRect(); return JSON.stringify({ x: r.left + 30, y: r.top + r.height / 2 }) })()`))
  await click(box.x, box.y)
  await page.send('Input.insertText', { text: 'voice' })
  await sleep(700)
  m = await read(); vis = visible(m)
  check('a word that only an Advanced entry has shows that entry, though the fold is shut', vis.includes('Voice') && m.searching === true && !vis.includes('Workers'), vis)
  check('the header of a section with nothing left under it is gone, the one over the match stays', m.heads.find((h) => h.t === 'Advanced').shown === true && m.heads.find((h) => h.t === 'Other settings').shown === false, m.heads)
  await shot('nav-search')
  await ev(`(() => { const i = document.querySelector('input[type="search"]'); i.focus(); i.select() })()`)
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 })
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 })
  await sleep(700)
  m = await read(); vis = visible(m)
  check('cleared, the fold is shut again as the person left it, and every header is back', m.searching === false && m.fold === 'shut' && !vis.includes('Voice') && m.heads.every((h) => h.shown === true), { searching: m.searching, fold: m.fold, vis: vis.length })

  console.log('a pointer to a page inside it opens it (the cell is hidden when it is clicked)')
  await ev(`(() => { const c = [...document.querySelectorAll('[class*="navCell"]')].find(e => e.textContent.trim() === 'Workers'); c.click() })()`)
  await sleep(1200)
  m = await read(); vis = visible(m)
  check('landing on Workers opens the fold, shows the entry and remembers it', m.fold === 'open' && vis.includes('Workers') && (await store()) === '1', { fold: m.fold, store: await store() })
  check('the page that opened is the one that was asked for', m.cells.find((c) => c.active) !== undefined && m.cells.find((c) => c.active).t === 'Workers')
  await toggle()
  await sleep(900)
  m = await read(); vis = visible(m)
  check('shutting the fold while on one of its pages is respected: the page stays in view, the others go', m.fold === 'shut' && vis.includes('Workers') && !vis.includes('Voice'), { fold: m.fold, vis })
  await shot('nav-on-advanced-page')

  console.log('Settings › Kybernos Suite opens on All (V-42)')
  await ev(`(() => { const c = [...document.querySelectorAll('[class*="navCell"]')].find(e => e.textContent.trim() === 'Kybernos Suite'); c.click() })()`)
  await waitFor(page, `document.querySelector('.kbsu-seg button[aria-pressed]') !== null`, 12000)
  await sleep(600)
  const seg = JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('.kbsu-seg button[aria-pressed="true"]')].map(b => b.textContent.replace(/[0-9]+$/, '').trim()))`) || '[]')
  check('the pressed tab is All', seg.length >= 1 && seg[0] === 'All', seg)
  const rowTitle = await ev(`(() => { const b = document.querySelector('.kbsu-name b'); return b ? getComputedStyle(b).fontFamily : null })()`)
  const listBtn = await ev(`(() => { const b = document.querySelector('[data-kb="view-list"]') || [...document.querySelectorAll('.kbsu-seg.view button')].pop(); if (!b) return null; const r = b.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 }) })()`)
  if (listBtn !== null) {
    const p = JSON.parse(listBtn)
    await click(p.x, p.y)
    await sleep(700)
    const rowFace = await ev(`(() => { const b = document.querySelector('.kbsu-rowname b'); return b ? getComputedStyle(b).fontFamily : null })()`)
    check('a module\'s name has the same typeface in the List view as in the Grid view (A1-27)', typeof rowFace === 'string' && typeof rowTitle === 'string' && rowFace === rowTitle && rowFace.indexOf('monospace') < 0, { grid: rowTitle, list: rowFace })
    await shot('suite-list')
  } else console.log('  – SKIP the list view: its switch is not drawn')

  console.log('every icon is different (V-25)')
  const icons = JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('[class*="navCell"]')].map(c => { const s = c.querySelector('svg'); return { t: c.textContent.trim(), d: s ? s.innerHTML.replace(/\\s+/g, ' ') : '', mask: !!c.querySelector('[data-kb-nav]') } }))`))
  const byDrawing = {}
  for (const i of icons) (byDrawing[i.d] ||= []).push(i.t)
  const twins = Object.values(byDrawing).filter((v) => v.length > 1)
  check('no two entries of the menu show the same drawing (' + icons.length + ' entries)', icons.length >= 25 && twins.length === 0 && icons.every((i) => i.d !== '' && i.mask === false), twins)

  console.log('every page is titled like its entry (A1-09)')
  const labels = JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('[class*="navCell"]')].map(c => c.textContent.trim()))`))
  const odd = []
  let looked = 0
  for (const label of labels) {
    if (label === 'General' || label === 'Models') continue // DSH's own page / the shell's hidden cell
    await ev(`(() => { const c = [...document.querySelectorAll('[class*="navCell"]')].find(e => e.textContent.trim() === ${JSON.stringify(label)}); if (c) c.click() })()`)
    await sleep(900)
    // The title: the top-most bold text at the page's left edge (the « How it works » pill is on the right, a sub-title is lighter).
    const title = await ev(`(() => {
      const list = [...document.querySelectorAll('[class*="navList"]')].find(l => l.querySelector('[class*="navCell"]'))
      const nr = list.getBoundingClientRect().right
      const sec = document.querySelector('[data-slot="settings.section"]')
      if (!sec) return null
      const nodes = []
      const w = document.createTreeWalker(sec.parentElement, NodeFilter.SHOW_TEXT)
      for (let n = w.nextNode(); n && nodes.length < 60; n = w.nextNode()) {
        const s = n.textContent.trim(); if (!s) continue
        const e = n.parentElement; const r = e.getBoundingClientRect(); if (r.width < 2 || r.left < nr) continue
        const cs = getComputedStyle(e)
        nodes.push({ s, y: r.top, x: r.left, fw: Number(cs.fontWeight), fs: parseFloat(cs.fontSize) })
      }
      const left = Math.min(...nodes.map(o => o.x))
      const heads = nodes.filter(o => o.fw >= 600 && o.x <= left + 4 && o.fs >= 14).sort((a, b) => a.y - b.y)
      return heads.length ? heads[0].s : null
    })()`)
    looked += 1
    if (title !== label) odd.push(label + ' → ' + JSON.stringify(title))
  }
  check('the heading of each page (' + looked + ' pages) is the entry\'s own name', looked >= 25 && odd.length === 0, odd)
  await shot('nav-after-pages')
} finally { await live.close() }

console.log('\n' + (fail === 0 ? 'ALL GREEN' : String(fail) + ' FAILED') + ' (' + String(pass + fail) + ' checks)')
process.exit(fail === 0 ? 0 : 1)

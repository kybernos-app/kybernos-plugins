#!/usr/bin/env node
// The help of the plugins, in a real GUI: the « ? How it works » button on the page of each plugin that has one, and the
// help on the module's page in the Suite.
//
//   source scripts/sandbox/env.sh && node scripts/check-help-live.mjs [--shots <dir>]
//
// Needs a DSH that serves this checkout (scripts/sandbox/start.sh): the help button and the catalogue's `aide` live in
// the hub and in the plugins of the checkout. Refuses :3080. Read-only: nothing here changes a setting.
// For every page: the button is there, it opens a card with what the plugin does and the steps of packages/<dir>/help.json
// (the text is read from the file, not copied here), the card closes on Escape, and French shows French.
// The cards show the signed catalogue downloaded at the last release when this DSH home has one, so a help.json edited since is a card
// that is one release behind: the check says which source the cards come from (scripts/lib-help-source.mjs) and compares each card with
// the text the SAME host serves for it (/kybernos-hub/suite: the shipped help.json when nothing was downloaded, the downloaded one
// otherwise). A card that is one release behind is therefore told, not failed; a card that does not show what the host serves is a bug.
// Exit code 0 / 1 / 3.
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openLivePage, openSettings, goToSettingsPage, waitFor } from './live-page.mjs'
import { dshHome } from './dsh-home.mjs'
import { helpSource, describeHelpSource } from './lib-help-source.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const shotDir = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : null
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0
let fail = 0
const check = (name, ok, detail) => { if (ok) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) } }
const shippedHelp = (dir) => JSON.parse(readFileSync(join(REPO, 'packages', dir, 'help.json'), 'utf8'))
// What the host serves as each module's help (filled once the page is up): `aide` of GET /kybernos-hub/suite.
let served = {}
// The text a card must show: what the host serves for the module, over the shipped help.json for whatever the served one lacks.
const helpOf = (dir) => Object.assign({}, shippedHelp(dir), served[dir] || {})

const host = process.env.KB_HOST || '127.0.0.1:3080'
if (host === '127.0.0.1:3080') { console.error('○ inconclusive: this check needs a DSH that serves this checkout (a sandbox instance), not the one on :3080. Set KB_HOST, DSH_HOME and HOME.'); process.exit(3) }

const live = await openLivePage({ width: 1500, height: 1000 }).catch((e) => { console.error('○ inconclusive: ' + e.message); process.exit(3) })
const { page } = live
const val = async (expr, ms) => (await page.evalJs(expr, ms)).val
const shot = async (name) => { if (shotDir !== null) { try { await page.shot(join(shotDir, name + '.png')) } catch (e) { /* no screenshot */ } } }
const mouse = async (x, y) => { await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }); await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }); await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }) }
const poll = async (fn, ms = 10000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) return v; await sleep(250) } }
const key = async (k, code, vk) => { await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk }); await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk }) }

// Pages reached through Settings: [nav label, bundle folder]
const PAGES = [
  ['Theme', 'kybernos-theme'], ['AI provider and models', 'kybernos-models'], ['Commands', 'kybernos-slash'], ['Workers', 'kybernos-workers'],
  ['About', 'kybernos-maintenance'], ['Ollama local models', 'kybernos-modeles-locaux'], ['Memory & Lessons', 'kybernos-memory'],
  ['General', 'kybernos-sessions'], ['Kybernos Suite', 'kybernos-hub']
]
// Pages that already had a help of their own: the shared button must not double it.
const OWN_HELP = [['Atlas', 'kybernos-atlas'], ['Language', 'kybernos-language']]

// A page of the Settings menu: the cell is awaited and pressed, and pressed again when the page's own marker does not come (a press lost to a redraw).
const goTo = (label, marker) => goToSettingsPage(page, label, marker === undefined ? { settleMs: 1800 } : { marker, markerMs: 8000 })
const helpButton = (id) => val(`!!document.querySelector('[data-kb="help-button"][data-id="${id}"]')`)
const panelText = () => val(`(document.querySelector('[data-kb="help-panel"]') || { innerText: '' }).innerText.replace(/\\n+/g, ' | ')`)
// The card is drawn a moment after the press; wait for the text the check will look for (the last text read is what the check then reports).
const panelWith = async (needle) => { await poll(async () => (typeof needle === 'function' ? needle(String(await panelText())) : String(await panelText()).includes(needle)), 8000); return panelText() }
const panelClosed = () => poll(() => val(`!document.querySelector('[data-kb="help-panel"]')`), 4000)
const helpSel = (id, page) => `!!document.querySelector('[data-kb="help-button"][data-id="${id}"]${page === undefined ? '' : `[data-page="${page}"]`}')`

let source = null
try {
  await waitFor(page, 'document.readyState === "complete" && document.body && document.body.innerText.length > 40', 30000)
  if ((await val(`/Add an API key to get started/.test(document.body.innerText)`)) === true) {
    const pos = await val(`(() => { const e = Array.from(document.querySelectorAll('*')).filter((e) => e.children.length === 0 && (e.innerText || '').trim() === 'Configure later')[0]; if (!e) return null; const r = e.getBoundingClientRect(); return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 }) })()`)
    if (typeof pos === 'string') { const { x, y } = JSON.parse(pos); await mouse(x, y); await sleep(700) }
  }
  check('Settings open', (await openSettings(page, { tries: 3 })) === true)
  source = helpSource({ repo: REPO, home: dshHome() })
  console.log('  ○ ' + describeHelpSource(source))
  const suiteDoc = await val(`fetch('/kybernos-hub/suite').then((r) => r.json()).catch(() => null)`)
  const mods = suiteDoc !== null && Array.isArray(suiteDoc.modules) ? suiteDoc.modules : []
  served = Object.fromEntries(mods.filter((m) => m && typeof m.id === 'string' && m.aide && typeof m.aide === 'object').map((m) => [m.id, m.aide]))
  const behind = source.differ
  console.log('  ○ text compared with: ' + (suiteDoc !== null && suiteDoc.catalogue && suiteDoc.catalogue.source === 'signe'
    ? 'the help the host serves from the signed catalogue (suite ' + String(suiteDoc.catalogue.suite && suiteDoc.catalogue.suite.version) + ')' + (behind.length > 0 ? ', which is behind packages/*/help.json for ' + behind.join(', ') : '')
    : 'the help.json shipped with this checkout (the host serves no downloaded catalogue)'))
  check('the host serves a help for the modules this check opens', Object.keys(served).length > 0, { modules: mods.length })

  console.log('\n── the button on each page ──')
  for (const [label, dir] of PAGES) {
    const h = helpOf(dir)
    const went = await goTo(label, helpSel(dir))
    const there = went ? await poll(() => helpButton(dir), 8000) : false
    check(label + ' — the page opens and carries the « ? How it works » button', went === true && there === true, { went, there })
    if (there !== true) continue
    await val(`document.querySelector('[data-kb="help-button"][data-id="${dir}"]').click()`)
    const t = await panelWith(h.what.en)
    check(label + ' — it opens a card with what the plugin does, every step, where to find it', typeof t === 'string' && t.includes(h.what.en) && h.steps.every((s) => t.includes(s.en)) && t.includes(h.where.en), t)
    if (h.good) check(label + ' — … and the thing worth knowing', t.includes(h.good.en), t)
    if (dir === 'kybernos-theme') await shot('help-theme')
    if (dir === 'kybernos-maintenance') await shot('help-about')
    await key('Escape', 'Escape', 27)
    check(label + ' — Escape closes the card', (await panelClosed()) === true)
  }

  console.log('\n── a page of a bundle that owns several pages (Voice) ──')
  {
    const core = helpOf('kybernos-plugin')
    const v = core.pages.voice
    const sel = '[data-kb="help-button"][data-id="kybernos-plugin"][data-page="voice"]'
    const went = await goTo('Voice', `!!document.querySelector('${sel}')`)
    const there = went ? await poll(() => val(`!!document.querySelector('${sel}')`), 8000) : false
    check('Voice — the page opens and carries its own « ? How it works » button', went === true && there === true, { went, there })
    if (there === true) {
      await val(`document.querySelector('${sel}').click()`)
      const t = await panelWith(v.what.en)
      check('Voice — the card is the page’s own: what it does, every step, where, the thing worth knowing', t.includes(v.what.en) && v.steps.every((x) => t.includes(x.en)) && t.includes(v.where.en) && t.includes(v.good.en), t)
      check('Voice — …and not the core bundle’s general help (Agent Teams)', !t.includes(core.what.en), t)
      await shot('help-voice')
      await key('Escape', 'Escape', 27)
      check('Voice — Escape closes the card', (await panelClosed()) === true)
    }
  }

  console.log('\n── pages that already had a help ──')
  for (const [label, dir] of OWN_HELP) {
    const went = await goTo(label)
    check(label + ' — keeps its own help, no second button', went === true && (await helpButton(dir)) === false, { went })
  }
  // Auto Routing draws the shared « ? How it works » pill itself, in its own header (A5-19): exactly one, never a second one from the hub.
  {
    const went = await goTo('Auto Routing')
    const n = await poll(async () => { const c = await val(`document.querySelectorAll('[data-kb="help-button"][data-id="kybernos-auto"]').length`); return c > 0 ? c : 0 }, 8000)
    check('Auto Routing — one shared help button, in its own header, not doubled', went === true && n === 1, { went, n })
  }

  console.log('\n── French ──')
  await goTo('Theme', helpSel('kybernos-theme'))
  await poll(() => helpButton('kybernos-theme'), 8000)
  // Both the resolver and the document language: the core rewrites French phrases to English on Settings pages while the document is English.
  await val(`window.__kbOrig = window.__KB_LANG_RESOLVE__; window.__kbLang = document.documentElement.lang; window.__KB_LANG_RESOLVE__ = () => 'kybernos'; document.documentElement.lang = 'fr'`)
  await val(`document.querySelector('[data-kb="help-button"][data-id="kybernos-theme"]').click()`)
  const th = helpOf('kybernos-theme')
  // The core rewrites « » to “ ” on Settings pages while the document language is still English (it is only the resolver
  // that this check forces to French): compare without quotation marks or spaces.
  const flat = (t) => String(t).replace(/[«»“”"\s]/g, '')
  const fr = await panelWith((t) => flat(t).includes(flat(th.what.fr)))
  check('the card is in French: the French text, not the English one', flat(fr).includes(flat(th.what.fr)) && th.steps.every((s) => flat(fr).includes(flat(s.fr))) && fr.toLowerCase().includes('comment l’utiliser') && !fr.includes(th.what.en), { what: flat(fr).includes(flat(th.what.fr)), steps: th.steps.map((s) => flat(fr).includes(flat(s.fr))) })
  await shot('help-theme-fr')
  await val(`window.__KB_LANG_RESOLVE__ = window.__kbOrig; document.documentElement.lang = window.__kbLang`)
  await key('Escape', 'Escape', 27)

  console.log('\n── the module’s page in the Suite ──')
  // The Suite draws a skeleton until the host has answered (a few ms by hand, seconds on a busy machine): the card is awaited, pressed, and the module's page awaited.
  const cardSel = `document.querySelector('[data-kb="suite-card"][data-id="kybernos-models"]') !== null`
  await goTo('Kybernos Suite', cardSel)
  await poll(() => val(cardSel), 20000)
  const sl = helpOf('kybernos-models')
  const aideText = () => val(`(document.querySelector('[data-kb="suite-aide"]') || { innerText: '' }).innerText.replace(/\\n+/g, ' | ')`)
  let opened = false
  // A press on the card that landed while the page was being redrawn opens nothing: press again until the module's page is there.
  for (let i = 0; i < 3 && !opened; i += 1) {
    await val(`(() => { const c = document.querySelector('[data-kb="suite-card"][data-id="kybernos-models"]'); if (!c) return false; c.click(); return true })()`)
    opened = (await poll(async () => String(await aideText()).includes(sl.where.en), 6000)) === true
  }
  const sa = await aideText()
  check('a module’s page shows how to use it, where to find it, and the thing worth knowing', opened === true && sl.steps.every((s) => sa.includes(s.en)) && sa.includes(sl.where.en) && (!sl.good || sa.includes(sl.good.en)), sa)
  await shot('help-suite-fiche')

  console.log('\n── the Skills page (not in Settings) ──')
  await poll(() => val(`(() => { const b = Array.from(document.querySelectorAll('button')).find((x) => /Back to workspace/.test(x.innerText)); if (!b) return false; b.click(); return true })()`), 8000)
  await poll(() => val(`!/Back to workspace/.test(document.body.innerText)`), 6000)
  // The sidebar row is a button: take the visible « Skills » leaf that sits inside a button in the left part of the window, not the first leaf
  // of that name anywhere in the DOM (a heading, a hidden page).
  const skillsRow = () => val(`(() => { const hits = Array.from(document.querySelectorAll('*')).filter((e) => e.children.length === 0 && (e.innerText || '').trim() === 'Skills' && e.getBoundingClientRect().width > 3 && e.closest('button, [role=button]') !== null).map((e) => e.closest('button, [role=button]')).filter((b) => b.getBoundingClientRect().x < 400 && b.getBoundingClientRect().height > 3); if (hits.length === 0) return null; const r = hits[0].getBoundingClientRect(); return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 }) })()`)
  // The row is awaited (the sidebar is redrawn when the dialog closes), pressed with a real click, and pressed again when the page did not come.
  let skillsPage = false
  for (let i = 0; i < 3 && !skillsPage; i += 1) {
    const pos = await poll(skillsRow, 10000)
    if (typeof pos === 'string') { const { x, y } = JSON.parse(pos); await mouse(x, y) }
    skillsPage = (await poll(() => helpButton('kybernos-skills'), 8000)) === true
  }
  check('the Skills page carries the button and its card is the skills help', skillsPage === true)
} catch (e) {
  fail += 1
  console.log('  ✗ the check stopped: ' + e.message)
} finally {
  await live.close()
}
if (fail > 0 && source !== null && source.differ.length > 0) console.log('  ○ ' + describeHelpSource(source))
console.log('\n' + pass + ' ✓  ' + fail + ' ✗')
process.exit(fail === 0 ? 0 : 1)

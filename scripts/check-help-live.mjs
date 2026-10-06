#!/usr/bin/env node
// The help of the plugins, in a real GUI: the « ? How it works » button on the page of each plugin that has one, and the
// help on the module's page in the Suite.
//
//   KB_HOST=127.0.0.1:3091 DSH_HOME=<sandbox>/.dsh HOME=<sandbox> node scripts/check-help-live.mjs [--shots <dir>]
//
// Needs a DSH that serves this checkout (scripts/sandbox-instance.mjs): the help button and the catalogue's `aide` live in
// the hub and in the plugins of the checkout. Refuses :3080. Read-only: nothing here changes a setting.
// For every page: the button is there, it opens a card with what the plugin does and the steps of packages/<dir>/help.json
// (the text is read from the file, not copied here), the card closes on Escape, and French shows French.
// Exit code 0 / 1 / 3.
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openLivePage } from './live-page.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const shotDir = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : null
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0
let fail = 0
const check = (name, ok, detail) => { if (ok) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) } }
const helpOf = (dir) => JSON.parse(readFileSync(join(REPO, 'packages', dir, 'help.json'), 'utf8'))

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
  ['Theme', 'kybernos-theme'], ['AI Provider & Models', 'kybernos-models'], ['Commands', 'kybernos-slash'], ['Workers', 'kybernos-workers'],
  ['About', 'kybernos-maintenance'], ['Ollama Local Models', 'kybernos-modeles-locaux'], ['Memory & Lessons', 'kybernos-memory'],
  ['General', 'kybernos-sessions'], ['Kybernos Suite', 'kybernos-hub']
]
// Pages that already had a help of their own: the shared button must not double it.
const OWN_HELP = [['Atlas', 'kybernos-atlas'], ['Language', 'kybernos-language'], ['Auto Routing', 'kybernos-auto']]

const openSettings = async () => {
  await val(`document.querySelector('[class*="settingsArea"] button[class*="trigger"]').click()`)
  return poll(() => val(`/Back to workspace/.test(document.body.innerText)`), 8000)
}
const goTo = async (label) => {
  const ok = await val(`(() => { const b = Array.from(document.querySelectorAll('button[class*="navCell"]')).find((x) => x.innerText.trim().split('\\n')[0] === ${JSON.stringify(label)}); if (!b) return false; b.click(); return true })()`)
  await sleep(1800)
  return ok
}
const helpButton = (id) => val(`!!document.querySelector('[data-kb="help-button"][data-id="${id}"]')`)
const panelText = () => val(`(document.querySelector('[data-kb="help-panel"]') || { innerText: '' }).innerText.replace(/\\n+/g, ' | ')`)

try {
  await sleep(3000)
  if ((await val(`/Add an API key to get started/.test(document.body.innerText)`)) === true) {
    const pos = await val(`(() => { const e = Array.from(document.querySelectorAll('*')).filter((e) => e.children.length === 0 && (e.innerText || '').trim() === 'Configure later')[0]; if (!e) return null; const r = e.getBoundingClientRect(); return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 }) })()`)
    if (typeof pos === 'string') { const { x, y } = JSON.parse(pos); await mouse(x, y); await sleep(700) }
  }
  check('Settings open', (await openSettings()) === true)

  console.log('\n── the button on each page ──')
  for (const [label, dir] of PAGES) {
    const h = helpOf(dir)
    const went = await goTo(label)
    const there = went ? await poll(() => helpButton(dir), 8000) : false
    check(label + ' — the page opens and carries the « ? How it works » button', went === true && there === true, { went, there })
    if (there !== true) continue
    await val(`document.querySelector('[data-kb="help-button"][data-id="${dir}"]').click()`)
    await sleep(500)
    const t = await panelText()
    check(label + ' — it opens a card with what the plugin does, every step, where to find it', typeof t === 'string' && t.includes(h.what.en) && h.steps.every((s) => t.includes(s.en)) && t.includes(h.where.en), t)
    if (h.good) check(label + ' — … and the thing worth knowing', t.includes(h.good.en), t)
    if (dir === 'kybernos-theme') await shot('help-theme')
    if (dir === 'kybernos-maintenance') await shot('help-about')
    await key('Escape', 'Escape', 27)
    await sleep(300)
    check(label + ' — Escape closes the card', (await val(`!document.querySelector('[data-kb="help-panel"]')`)) === true)
  }

  console.log('\n── pages that already had a help ──')
  for (const [label, dir] of OWN_HELP) {
    const went = await goTo(label)
    check(label + ' — keeps its own help, no second button', went === true && (await helpButton(dir)) === false, { went })
  }

  console.log('\n── French ──')
  await goTo('Theme')
  // Both the resolver and the document language: the core rewrites French phrases to English on Settings pages while the document is English.
  await val(`window.__kbOrig = window.__KB_LANG_RESOLVE__; window.__kbLang = document.documentElement.lang; window.__KB_LANG_RESOLVE__ = () => 'kybernos'; document.documentElement.lang = 'fr'`)
  await val(`document.querySelector('[data-kb="help-button"][data-id="kybernos-theme"]').click()`)
  await sleep(500)
  const fr = await panelText()
  const th = helpOf('kybernos-theme')
  // The core rewrites « » to “ ” on Settings pages while the document language is still English (it is only the resolver
  // that this check forces to French): compare without quotation marks or spaces.
  const flat = (t) => String(t).replace(/[«»“”"\s]/g, '')
  check('the card is in French: the French text, not the English one', flat(fr).includes(flat(th.what.fr)) && th.steps.every((s) => flat(fr).includes(flat(s.fr))) && fr.toLowerCase().includes('comment l’utiliser') && !fr.includes(th.what.en), { what: flat(fr).includes(flat(th.what.fr)), steps: th.steps.map((s) => flat(fr).includes(flat(s.fr))) })
  await shot('help-theme-fr')
  await val(`window.__KB_LANG_RESOLVE__ = window.__kbOrig; document.documentElement.lang = window.__kbLang`)
  await key('Escape', 'Escape', 27)

  console.log('\n── the module’s page in the Suite ──')
  await goTo('Kybernos Suite')
  await sleep(1500)
  const opened = await val(`(() => { const c = document.querySelector('[data-kb="suite-card"][data-id="kybernos-models"]'); if (!c) return false; c.click(); return true })()`)
  await sleep(1500)
  const sa = await val(`(document.querySelector('[data-kb="suite-aide"]') || { innerText: '' }).innerText.replace(/\\n+/g, ' | ')`)
  const sl = helpOf('kybernos-models')
  check('a module’s page shows how to use it, where to find it, and the thing worth knowing', opened === true && sl.steps.every((s) => sa.includes(s.en)) && sa.includes(sl.where.en) && (!sl.good || sa.includes(sl.good.en)), sa)
  await shot('help-suite-fiche')

  console.log('\n── the Skills page (not in Settings) ──')
  await val(`(() => { const b = Array.from(document.querySelectorAll('button')).find((x) => /Back to workspace/.test(x.innerText)); if (b) b.click() })()`)
  await sleep(1200)
  const pos = await val(`(() => { const e = Array.from(document.querySelectorAll('*')).filter((e) => e.children.length === 0 && (e.innerText || '').trim() === 'Skills' && e.getBoundingClientRect().width > 3)[0]; if (!e) return null; const r = e.getBoundingClientRect(); return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 }) })()`)
  if (typeof pos === 'string') { const { x, y } = JSON.parse(pos); await mouse(x, y); await sleep(2500) }
  check('the Skills page carries the button and its card is the skills help', (await poll(() => helpButton('kybernos-skills'), 8000)) === true)
} catch (e) {
  fail += 1
  console.log('  ✗ the check stopped: ' + e.message)
} finally {
  await live.close()
}
console.log('\n' + pass + ' ✓  ' + fail + ' ✗')
process.exit(fail === 0 ? 0 : 1)

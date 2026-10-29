#!/usr/bin/env node
// The Themes page against the REAL GUI of the SANDBOX: the gallery of cards (a drawn cover, a chip, a name, a line, counts), a theme page (the plugins it
// needs, what else it adds), the plan as a dialog (needs, kit, one consent, one primary action), the install, the report, the installed card, the removal.
// Everything with a real mouse and keyboard, every rectangle measured.
//
//   source scripts/sandbox/env.sh && scripts/sandbox/start.sh
//   node scripts/check-themes-gallery-live.mjs [--shots <dir>] [--theme <plugin id>] [--no-install]
//
// SANDBOX ONLY (exit 3 against :3080 and without DSH_HOME): the install writes the profile (DSH's manager links the theme's folder, the style and the
// field are applied) and the removal puts them back. Nothing is sent to a model. --no-install stops at the plan dialog (nothing is applied).
// Needs at least one shipped theme (packages/kybernos-plugin/themes/*/). Screenshots stay outside git (AGENTS rule 4).
// Exit code: 0 all green, 1 a check failed, 3 not run.
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { openLivePage, waitFor } from './live-page.mjs'

const args = process.argv.slice(2)
const flag = (name) => (args.indexOf(name) >= 0 ? args[args.indexOf(name) + 1] : null)
const shotsDir = flag('--shots')
const wanted = flag('--theme')
const noInstall = args.indexOf('--no-install') >= 0
if (shotsDir !== null) mkdirSync(shotsDir, { recursive: true })
if (!process.env.KB_HOST || process.env.KB_HOST.endsWith(':3080') || !process.env.DSH_HOME) {
  console.error('○ not run: this check installs into a profile, so it only runs on a sandbox (source scripts/sandbox/env.sh)')
  process.exit(3)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail).slice(0, 400))) }
}

const live = await openLivePage({ width: 1400, height: 900 }).catch((e) => { console.error('○ not run: ' + e.message); process.exit(3) })
const { page } = live
const ev = async (js, ms) => { const r = await page.evalJs(js, ms || 8000); return r.err ? { err: r.err } : r.val }
const shot = async (name) => { if (shotsDir !== null) { try { await page.shot(join(shotsDir, name + '.png')) } catch (e) { console.log('     (no screenshot ' + name + ')') } } }
const rect = (sel) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (e === null) return null; const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return { x: r.left, y: r.top, w: r.width, h: r.height, r: r.right, b: r.bottom, shown: r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' } })()`)
const click = async (sel) => {
  const r = await rect(sel)
  if (r === null || r.err || r.shown !== true) return false
  await page.evalJs(`document.querySelector(${JSON.stringify(sel)}).scrollIntoView({ block: 'center' })`, 4000)
  const c = await rect(sel)
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type, x: c.x + c.w / 2, y: c.y + c.h / 2, button: 'left', clickCount: 1 })
  await sleep(350)
  return true
}
const text = async (sel) => (await ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return e === null ? null : e.innerText })()`))
const PAGE = '[data-kb-page="themes"]'
const openThemes = async () => {
  await waitFor(page, `document.querySelector('.kb4-item') !== null`, 30000)
  await sleep(1500)
  await ev(`window.__KB_OPEN__({ view: 'themes' })`)
  await waitFor(page, `!!document.querySelector('${PAGE}')`, 15000)
  await sleep(1200)
}

try {
  const errs = []
  await openThemes()
  await ev(`(() => { window.__chk = []; window.addEventListener('error', (e) => window.__chk.push(String(e.message))); return 1 })()`)
  const api = await ev(`fetch('/kybernos/themes', { credentials: 'same-origin' }).then((r) => r.json()).then((j) => ({ shipped: (j.shipped || []).map((t) => ({ id: t.id, name: t.name, needs: t.needs, adds: t.adds })), installed: (j.installed || []).length }))`, 10000)
  if (!api || !Array.isArray(api.shipped) || api.shipped.length === 0) { console.error('○ not run: no shipped theme is listed (packages/kybernos-plugin/themes/*/)'); await live.close(); process.exit(3) }
  const theme = wanted !== null ? api.shipped.find((t) => t.id === wanted) : (api.shipped.find((t) => Array.isArray(t.needs) && t.needs.length > 0) || api.shipped[0])
  if (!theme) { console.error('○ not run: no such shipped theme'); await live.close(); process.exit(3) }
  const word = (t) => (typeof t.name === 'string' ? t.name : (t.name && (t.name.en || t.name.fr)) || t.id)

  console.log('The gallery')
  const cards = await ev(`[...document.querySelectorAll('${PAGE} [data-kb="theme-card"]')].map((c) => { const r = c.getBoundingClientRect(); const cv = c.querySelector('.kbgal-cover svg'); const cr = cv === null ? null : cv.getBoundingClientRect(); return { id: c.getAttribute('data-theme'), w: r.width, h: r.height, x: r.left, y: r.top, cover: cr === null ? null : [Math.round(cr.width), Math.round(cr.height)], name: (c.querySelector('.kbgal-name') || {}).innerText, line: (c.querySelector('.kbgal-line') || {}).innerText, chip: (c.querySelector('.kbgal-ctag') || {}).innerText, aria: c.getAttribute('aria-label') } })`)
  check('every shipped theme has a card (' + api.shipped.length + ')', Array.isArray(cards) && api.shipped.every((t) => cards.some((c) => c.id === t.id)), { shipped: api.shipped.map((t) => t.id), cards: Array.isArray(cards) ? cards.map((c) => c.id) : cards })
  check('each card draws a cover (16:9), a chip, a name and a line, and is announced by its name', Array.isArray(cards) && cards.every((c) => c.cover !== null && c.cover[0] > 150 && Math.abs(c.cover[0] / c.cover[1] - 16 / 9) < 0.1 && c.chip && c.name && c.line && c.aria && c.aria.indexOf(c.name) === 0), cards)
  check('the cards of a row are the same height', Array.isArray(cards) && (() => { const rows = {}; for (const c of cards) (rows[Math.round(c.y)] = rows[Math.round(c.y)] || []).push(c.h); return Object.values(rows).every((hs) => Math.max(...hs) - Math.min(...hs) <= 1) })(), cards && cards.map((c) => [Math.round(c.y), c.h]))
  check('no card is wider than the page and nothing scrolls sideways', (await ev(`(() => { const p = document.querySelector('${PAGE}'); return p.scrollWidth <= p.clientWidth + 1 && document.documentElement.scrollWidth <= window.innerWidth + 1 })()`)) === true)
  check('the title and the one-line promise are drawn', /Themes|Thèmes/.test((await text(PAGE + ' .kb6-title')) || '') && /plugins/.test((await text(PAGE + ' .kbg-sub')) || ''))
  const addRow = await rect(PAGE + ' .kbgal-add')
  check('« Add a theme from a folder » sits below the gallery, small', addRow !== null && addRow.shown === true && addRow.y > (cards && cards.length ? Math.max(...cards.map((c) => c.y + c.h)) : 0), addRow)
  check('its button is disabled until a path is typed', (await ev(`document.querySelector('[data-kb="theme-folder-add"]').disabled`)) === true)
  await shot('1-gallery')

  console.log('A theme page')
  check('the card is clicked with the mouse', await click(`${PAGE} [data-theme="${theme.id}"]`))
  const there = await waitFor(page, `!!document.querySelector('${PAGE} .kbgal-thead')`, 8000)
  check('its page opens', there !== null)
  check('the breadcrumb says Themes › name', /›/.test((await text(PAGE + ' .kbgal-crumb')) || '') && ((await text(PAGE + ' .kbgal-crumb')) || '').indexOf(word(theme)) > 0, await text(PAGE + ' .kbgal-crumb'))
  const head = await ev(`(() => { const g = (s) => { const e = document.querySelector('${PAGE} ' + s); if (e === null) return null; const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] }; return { cover: g('.kbgal-cover-lg'), title: g('.kbgal-h2'), cta: g('.kbgal-cta'), counts: (document.querySelector('${PAGE} .kbgal-counts') || {}).innerText } })()`)
  check('the head: a big cover, the title, the call to action on the right', head && head.cover && head.title && head.cta && head.cover[0] < head.title[0] && head.title[0] < head.cta[0], head)
  check('the counts line says plugins, skills, teams and automations created off', head && /plugin/.test(head.counts || '') && /skill/.test(head.counts) && /team/.test(head.counts) && /automation/.test(head.counts) && /off/.test(head.counts), head && head.counts)
  const needs = Array.isArray(theme.needs) ? theme.needs.length : 0
  check('one row per plugin the theme needs (' + needs + '), each with its status', (await ev(`document.querySelectorAll('${PAGE} .kbgal-pl').length`)) === needs && (await ev(`[...document.querySelectorAll('${PAGE} .kbgal-pl [data-kb="theme-plugin-state"]')].every((e) => e.innerText.trim() !== '')`)) === true)
  check('four cards say what else it adds (skills, agent teams, automations, connectors)', (await ev(`document.querySelectorAll('${PAGE} .kbgal-kcard').length`)) === 4)
  check('the call to action is « Install theme » (« See the plan » when the theme is already in the profile)', /Install theme|Installer le thème|See the plan|Voir le plan/.test((await text(PAGE + ' [data-kb="theme-install"]')) || ''))
  await shot('2-theme-page')
  check('the breadcrumb leads back to the gallery', (await click(PAGE + ' [data-kb="theme-back"]')) && (await waitFor(page, `!!document.querySelector('${PAGE} [data-kb="theme-grid"]')`, 6000)) !== null)
  check('and the card is still there', (await rect(`${PAGE} [data-theme="${theme.id}"]`)) !== null)

  console.log('The plan, as a dialog')
  await click(`${PAGE} [data-theme="${theme.id}"]`)
  await waitFor(page, `!!document.querySelector('${PAGE} [data-kb="theme-install"]')`, 6000)
  check('« Install theme » is pressed with the mouse', await click(PAGE + ' [data-kb="theme-install"]'))
  // DSH's manager links the folder first: several seconds, longer than any click handler
  const planned = await waitFor(page, `!!document.querySelector('[data-kb="theme-plan"] [role="dialog"]')`, 150000)
  check('DSH takes the theme in and the plan opens as a dialog over the theme page', planned !== null, await text(PAGE))
  const dlg = await rect('[data-kb="theme-plan"] .kbgal-dlg')
  check('the dialog is centred, inside the window, and scrolls inside itself when it is tall', dlg !== null && dlg.x >= 0 && dlg.r <= 1400 && dlg.y >= 0 && dlg.b <= 900 && Math.abs((dlg.x + dlg.r) / 2 - 700) < 6, dlg)
  check('it names the theme, lists the plugins and the kit, and the theme page is still behind it', /Install /.test((await text('[data-kb="theme-plan"] h3')) || '') && ((await text('[data-kb="theme-plan"] h3')) || '').indexOf(word(theme)) > 0 && (await rect(PAGE + ' .kbgal-thead')) !== null)
  if (needs > 0) check('the required plugins are ticked and cannot be unticked', (await ev(`(() => { const rows = [...document.querySelectorAll('[data-kb="theme-plan"] .kbgal-chk')].slice(0, ${needs}); return rows.length === ${needs} && rows.every((r) => r.querySelector('input').checked && r.querySelector('input').disabled) })()`)) === true)
  check('the kit rows are ticked, except what the row says is « Already there »', (await ev(`[...document.querySelectorAll('[data-kb="theme-plan"] .kbgal-chk')].filter((r) => !r.querySelector('input').disabled).every((r) => r.querySelector('input').checked === !/Already there|Déjà là/.test(r.innerText))`)) === true)
  check('the primary action is disabled until the consent is ticked', (await ev(`document.querySelector('[data-kb="theme-go"]').disabled`)) === true)
  await shot('3-plan')
  check('the consent is ticked with the mouse', await click('[data-kb="theme-consent"]'))
  check('then the primary action is enabled', (await ev(`document.querySelector('[data-kb="theme-go"]').disabled`)) === false)
  await shot('4-plan-consent')
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await sleep(400)
  check('Escape closes the dialog and leaves the theme page', (await rect('[data-kb="theme-plan"]')) === null && (await rect(PAGE + ' .kbgal-thead')) !== null)
  check('the theme is now in the profile: its page offers « See the plan » and « Remove »', /See the plan|Voir le plan/.test((await text(PAGE + ' [data-kb="theme-install"]')) || '') && (await rect(PAGE + ' [data-kb="theme-remove"]')) !== null)

  if (!noInstall) {
    console.log('Install, then remove')
    check('the page offers the plan again (the theme is staged)', await click(PAGE + ' [data-kb="theme-install"]'))
    check('the plan opens again', (await waitFor(page, `!!document.querySelector('[data-kb="theme-plan"] [role="dialog"]')`, 60000)) !== null)
    check('Cancel closes it', (await click('[data-kb="theme-cancel"]')) && (await rect('[data-kb="theme-plan"]')) === null)
    await click(PAGE + ' [data-kb="theme-install"]')
    await waitFor(page, `!!document.querySelector('[data-kb="theme-plan"] [role="dialog"]')`, 60000)
    await click('[data-kb="theme-consent"]')
    check('the primary action is pressed', await click('[data-kb="theme-go"]'))
    const reported = await waitFor(page, `!!document.querySelector('[data-kb="theme-report"] [role="dialog"]')`, 90000)
    check('the report dialog opens', reported !== null, await text(PAGE))
    const rep = await text('[data-kb="theme-report"]')
    check('it says what was added, what was already there, what failed', /Added|Ajoutés/.test(rep || '') && /Already there|Déjà là/.test(rep) && /Failed|Échoués/.test(rep), rep)
    await shot('5-report')
    check('« Back to themes » is pressed', await click('[data-kb="theme-back-to-themes"]'))
    const marked = await waitFor(page, `(() => { const c = document.querySelector('${PAGE} [data-theme="${theme.id}"]'); return c !== null && /Installed|Installé/.test(c.innerText) })()`, 20000)
    check('the card now wears « Installed »', marked !== null, await text(PAGE))
    await shot('6-gallery-installed')
    await click(`${PAGE} [data-theme="${theme.id}"]`)
    await waitFor(page, `!!document.querySelector('${PAGE} [data-kb="theme-remove"]')`, 6000)
    check('the installed theme page offers Remove', (await rect(PAGE + ' [data-kb="theme-remove"]')) !== null)
    await shot('7-installed-page')
    check('Remove is pressed', await click(PAGE + ' [data-kb="theme-remove"]'))
    const gone = await waitFor(page, `(() => { const b = document.querySelector('${PAGE} [data-kb="theme-install"]'); return b !== null })()`, 90000)
    check('the theme is available again (the style and the field were put back)', gone !== null, await text(PAGE))
  }
  const errors = await ev(`window.__chk`)
  check('no script error from first to last', Array.isArray(errors) && errors.length === 0, errors)
} finally { await live.close() }
console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)

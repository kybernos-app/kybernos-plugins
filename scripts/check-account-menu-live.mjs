#!/usr/bin/env node
// The account menu (the card at the foot of the sidebar, opened) on the REAL GUI: one font and one size for every label, one column for the icons and the
// text, rows that do not waste height, no label cut by an ellipsis.
//
//   node scripts/check-account-menu-live.mjs [--shots <dir>]
//
// What is real: the DSH page and its footer card. What is swapped (scripts/lib-bundle-swap.mjs, in a throw-away Chrome): the kybernos-cloud client, from this
// checkout instead of the shared tree. Nothing is written or sent: the menu is opened and read, no entry is pressed (the Appearance segment would change the
// theme, so the check stays in the scheme the page has). Client only: no restart needed.
//
// Exit 0 all good, 1 a check failed, 3 not run (no GUI, no signed-in footer card, or the shared tree has uncommitted edits of the cloud client).
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { openLivePage, waitFor } from './live-page.mjs'
import { swapBundles } from './lib-bundle-swap.mjs'

const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0
const failures = []
const check = (label, cond, detail) => {
  if (cond) { pass += 1; console.log('  ✓ ' + label) } else { failures.push(label); console.log('  ✗ ' + label + (detail === undefined ? '' : '  — ' + JSON.stringify(detail).slice(0, 400))) }
}

const live = await openLivePage({ width: 1400, height: 1000 }).catch((e) => { console.error('○ not run: ' + e.message); process.exit(3) })
const { page } = live
const ev = async (js) => (await page.evalJs(js, 10000)).val
const shot = async (name, clip) => {
  if (shotsDir === null) return
  try {
    mkdirSync(shotsDir, { recursive: true })
    const r = await page.send('Page.captureScreenshot', Object.assign({ format: 'png' }, clip === undefined ? null : { clip: Object.assign({ scale: 2 }, clip) }))
    writeFileSync(join(shotsDir, name + '.png'), Buffer.from(r.result.data, 'base64'))
  } catch (e) { console.log('     (no screenshot: ' + e.message + ')') }
}

try {
  await page.send('Runtime.enable', {})
  const swap = await swapBundles(page, [{ name: 'kybernos-cloud' }])
  await page.send('Page.reload', { ignoreCache: true })
  await sleep(3500)
  await waitFor(page, `document.readyState === 'complete'`, 30000)
  if (!swap.report().every((r) => r.replaced === true)) { console.error('○ not run: the served cloud client differs from the shared tree (uncommitted edits there?): ' + JSON.stringify(swap.report())); await live.close(); process.exit(3) }
  const opened = await waitFor(page, `!!document.querySelector('.kbfp-cardmain')`, 20000).then(() => true).catch(() => false)
  if (!opened) { console.error('○ not run: no signed-in footer card on this page'); await live.close(); process.exit(3) }
  await ev(`document.querySelector('.kbfp-cardmain').click()`)
  await waitFor(page, `!!document.querySelector('.kbfp-menu')`, 10000)
  await sleep(700)

  const m = await ev(`(() => {
    const menu = document.querySelector('.kbfp-menu')
    const cs = (e) => getComputedStyle(e)
    const left = (e) => { const r = document.createRange(); r.selectNodeContents(e); return Math.round(r.getBoundingClientRect().left) }
    const row = (el, label, kind) => { const c = cs(label); const r = el.getBoundingClientRect(); return { kind, txt: (label.textContent || '').trim().slice(0, 30), fs: c.fontSize, fw: c.fontWeight, ff: c.fontFamily, h: Math.round(r.height), x: left(label), cut: label.scrollWidth > label.clientWidth + 1 } }
    const rows = []
    for (const b of menu.querySelectorAll('.kbfp-wsitem')) rows.push(row(b, b.querySelector('.kbfp-wsname'), b.classList.contains('kbfp-wsact') ? 'action' : 'space'))
    for (const b of menu.querySelectorAll('.kbfp-mitem')) rows.push(row(b, b.querySelector('.kbfp-mlab'), 'item'))
    const sub = [...menu.querySelectorAll('.kbfp-wssub, .kbfp-mwinnote, .kbfp-mheadsub')].map((e) => cs(e).fontSize)
    const plan = menu.querySelector('.kbfp-mplanname'); const icons = [...menu.querySelectorAll('.kbfp-mitem > svg')].map((e) => Math.round(e.getBoundingClientRect().left))
    const seps = [...menu.querySelectorAll('.kbfp-msep')].map((e) => { const c = cs(e); return parseFloat(c.marginTop) + parseFloat(c.marginBottom) })
    const r = menu.getBoundingClientRect()
    return { rows, sub, plan: plan ? { fs: cs(plan).fontSize, fw: cs(plan).fontWeight } : null, icons, seps, menuH: Math.round(r.height), menuW: Math.round(r.width), clip: { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) } }
  })()`)

  check('the menu has its rows (spaces, actions, items)', m.rows.length >= 9 && m.rows.some((r) => r.kind === 'space') && m.rows.some((r) => r.kind === 'action') && m.rows.some((r) => r.kind === 'item'), m.rows.length)
  check('every label is 13 px, in the same font', m.rows.every((r) => r.fs === '13px') && new Set(m.rows.map((r) => r.ff)).size === 1, m.rows.map((r) => r.txt + ' ' + r.fs))
  check('an action or an item is regular-medium (500), only the name of a space is bold (600)', m.rows.filter((r) => r.kind !== 'space').every((r) => r.fw === '500') && m.rows.filter((r) => r.kind === 'space').every((r) => r.fw === '600'), m.rows.map((r) => r.kind + ' ' + r.fw))
  check('every small line (the plan of a space, the note under a bar) is 11.5 px', m.sub.length > 0 && m.sub.every((s) => s === '11.5px'), m.sub)
  check('the name of the plan is 14 px', m.plan !== null && m.plan.fs === '14px', m.plan)
  const xs = m.rows.map((r) => r.x)
  check('the text of every row starts at the same x (the icon column is shared)', Math.max(...xs) - Math.min(...xs) <= 1, m.rows.map((r) => r.txt + ' ' + r.x))
  check('an action or an item is 36 px high or less; a space row 46 px or less', m.rows.filter((r) => r.kind !== 'space').every((r) => r.h <= 36) && m.rows.filter((r) => r.kind === 'space').every((r) => r.h <= 46), m.rows.map((r) => r.kind + ' ' + r.h))
  check('no label is cut by an ellipsis (« Join with an invitation link » used to be)', m.rows.every((r) => r.cut === false), m.rows.filter((r) => r.cut).map((r) => r.txt))
  check('the separators take 10 px, not 17', m.seps.length > 0 && m.seps.every((s) => s <= 10), m.seps)
  check('the whole menu is 600 px or less (it was 704)', m.menuH <= 600, m.menuH)
  await shot('account-menu', m.clip)
  await shot('account-menu-page')
  // the menu fits its card, and the text never leaves it
  const fit = await ev(`(() => { const menu = document.querySelector('.kbfp-menu'); const r = menu.getBoundingClientRect(); return [...menu.querySelectorAll('.kbfp-mlab, .kbfp-wsname')].filter((e) => { const b = e.getBoundingClientRect(); return b.right > r.right + 1 || b.left < r.left - 1 }).length })()`)
  check('no text runs outside the menu', fit === 0, fit)
} catch (e) {
  failures.push('the check itself crashed: ' + e.message)
  console.log('  ✗ ' + e.message)
}
await live.close()
console.log('\n' + pass + ' checks passed' + (failures.length > 0 ? ', ' + failures.length + ' failed:\n - ' + failures.join('\n - ') : ''))
process.exit(failures.length > 0 ? 1 : 0)

#!/usr/bin/env node
// Case J16-09 of docs/tests/user-journey: « A budget per automation, a certification chip, and the Open card in the chat » are recorded as NOT BUILT (KG-29);
// the case passes when nothing a person can read or press promises them. This reads the shipped screens and strings:
//
//   - the plugins' own sources: every client.js and index.js line that names a budget next to an automation, every « certif… » line, every card that offers to open an automation;
//   - the real GUI of an isolated DSH: the Automations page (list, the sheet of the first automation, the « new » entry point) read in full, with the visible words matched against
//     budget / spend limit / certified / certification / « Open » card, and every control listed with its size.
//
//   source scripts/sandbox/env.sh && scripts/sandbox/start.sh
//   node scripts/check-automations-promises-live.mjs [--out <folder>]
//
// READ ONLY: nothing is saved, no automation is created, run or changed (the « new » entry is only opened, then closed). It REFUSES to run against the real DSH (127.0.0.1:3080).
// Exit code: 0 = every step was played (the findings are the notes), 1 = a step failed, 3 = inconclusive (GUI down), 2 = refused.
import { mkdirSync, readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { openLivePage, clickText, waitFor } from './live-page.mjs'

const args = process.argv.slice(2)
const OUT = args.indexOf('--out') >= 0 ? args[args.indexOf('--out') + 1] : null
const HOST = process.env.KB_HOST || '127.0.0.1:3080'
if (HOST === '127.0.0.1:3080') { console.error('this reads the DSH it talks to, and that is the real one (127.0.0.1:3080). Use the isolated instance (scripts/sandbox/).'); process.exit(2) }
if (OUT !== null) mkdirSync(OUT, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0
let fail = 0
const notes = []
const check = (name, ok, detail) => { if (ok === true) { pass += 1; console.log('  ok   ' + name) } else { fail += 1; console.log('  FAIL ' + name + (detail === undefined ? '' : ' | ' + JSON.stringify(detail).slice(0, 400))) } }
const note = (name, v) => { notes.push({ name, v }); console.log('  note ' + name + ': ' + (typeof v === 'string' ? JSON.stringify(v.slice(0, 500)) : JSON.stringify(v).slice(0, 700))) }

// ── the sources ──
const dirs = existsSync('packages') ? readdirSync('packages') : []
const sources = []
for (const d of dirs) for (const f of ['client.js', 'index.js']) { const p = join('packages', d, f); if (existsSync(p)) sources.push(p) }
const scan = (rx, also) => {
  const hits = []
  for (const p of sources) readFileSync(p, 'utf8').split('\n').forEach((l, i) => { if (rx.test(l) && (also === undefined || also.test(l)) && l.length < 4000) hits.push(p.replace('packages/', '') + ':' + (i + 1) + ' ' + l.trim().slice(0, 130)) })
  return hits
}
note('sources searched', sources.length + ' files (client.js and index.js of ' + dirs.length + ' packages)')
const budgetNearAutomation = scan(/budget/i, /automation|schedule|webhook|routine/i)
note('lines that name a budget next to automation / schedule / webhook / routine', budgetNearAutomation)
const certLines = scan(/certified|certification|certifi/i).filter((l) => !/certificat|KB_ICON_TAGS/.test(l))
note('lines that name a certification (' + certLines.length + ')', certLines.slice(0, 12))
const positiveChip = scan(/['"`](Certified|Certifié|Certifiée)['"`]|certified:\s*\{|chip.*certif/i)
note('lines that draw or name a positive « Certified » chip', positiveChip)
const openCard = scan(/automation[-_ ]?open|open[-_ ]?automation|kb-card.*automation|automation.*kb-card|open.*automation card/i)
note('lines that draw a chat card which opens an automation', openCard)

// ── the page ──
const live = await openLivePage({ width: 1400, height: 1000 }).catch((e) => { console.error('inconclusive: ' + e.message); process.exit(3) })
const { page } = live
const q = async (js) => { const r = await page.evalJs(js, 15000); return r.err ? { __err: r.err } : r.val }
const shot = async (name) => { if (OUT !== null) { try { await page.shot(join(OUT, name + '.png')) } catch (e) { /* no picture */ } } }
const WORDS = `(() => (document.querySelector('[class*="kba-"]') ? Array.from(document.querySelectorAll('[class*="kba-"], [data-kb]')) : [document.body]).filter((e) => e.children.length === 0 && (e.innerText || '').trim() !== '').map((e) => e.innerText.replace(/\\s+/g, ' ').trim()))()`
const CONTROLS = `(() => Array.from(document.querySelectorAll('main button, main a, main [role=button], main input, main select, [data-kb] button')).filter((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0 }).map((e) => { const b = e.getBoundingClientRect(); return (e.innerText || e.getAttribute('aria-label') || e.placeholder || '').replace(/\\s+/g, ' ').trim().slice(0, 50) + ' [' + Math.round(b.width) + 'x' + Math.round(b.height) + ']' }))()`
const RX = /budget|spend(ing)? (limit|cap)|cap per|certified|certification|certifi|checks? (passed|failed)|approved|open (the )?automation/i
try {
  await waitFor(page, `document.readyState === 'complete'`, 20000)
  await sleep(2500)
  await q(`(() => { const b = Array.from(document.querySelectorAll('button')).find((x) => /^Configure later$/i.test(x.textContent.trim())); if (b) b.click(); return !!b })()`)
  await sleep(500)
  const opened = await clickText(page, 'Automations')
  check('the Automations entry is pressed', opened !== false && opened !== null && opened !== undefined)
  await sleep(2500)
  const all = await q(`(document.querySelector('main') || document.body).innerText.replace(/[ \\t]+/g, ' ').replace(/\\n+/g, ' / ').trim()`)
  note('the Automations page (all words)', all)
  const ctl = await q(CONTROLS)
  note('every control on the page (text, width x height)', ctl)
  const hits = String(all).split(' / ').filter((x) => RX.test(x))
  note('visible sentences that name a budget / certification / approval / Open card', hits)
  await shot('j1609-1-automations-en-1400')
  const hasPositiveChip = /\bcertified\b/i.test(String(all))
  note('a positive « Certified » chip is drawn on the list', hasPositiveChip)

  const count = Number(await q(`document.querySelectorAll('.kba-rowline .kba-name').length`)) || 0
  note('automations on this DSH', count)
  if (count > 0) {
    await q(`(() => { const n = document.querySelectorAll('.kba-rowline .kba-name')[0]; if (n) n.click() })()`)
    await waitFor(page, `!!document.querySelector('[data-kb="automation-sheet"]')`, 8000)
    await sleep(800)
    const sheet = await q(`(document.querySelector('[data-kb="automation-sheet"]') || document.body).innerText.replace(/[ \\t]+/g, ' ').replace(/\\n+/g, ' / ').trim()`)
    note('the sheet of the first automation (all words)', sheet)
    note('the sheet: sentences that name a budget / certification / approval', String(sheet).split(' / ').filter((x) => RX.test(x)))
    note('the sheet: every control', await q(`Array.from(document.querySelectorAll('[data-kb="automation-sheet"] button, [data-kb="automation-sheet"] a, [data-kb="automation-sheet"] input')).filter((e) => e.getBoundingClientRect().width > 0).map((e) => (e.innerText || e.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').trim().slice(0, 50) + ' [' + Math.round(e.getBoundingClientRect().width) + 'x' + Math.round(e.getBoundingClientRect().height) + ']')`))
    await shot('j1609-2-sheet-en-1400')
    await q(`(() => { const b = document.querySelector('[data-kb="back-to-list"], .kba-crumb'); if (b) b.click() })()`)
    await sleep(800)
  }
  // the entry point for a new automation: opened, read, closed (nothing is saved)
  const entry = await q(`(() => { const b = Array.from(document.querySelectorAll('main button, [data-kb] button')).find((e) => /^(\\+\\s*)?(new automation|new|create|add)\\b/i.test((e.innerText || '').trim()) && e.getBoundingClientRect().width > 0); if (!b) return null; b.setAttribute('data-j1609', '1'); return (b.innerText || '').trim() })()`)
  note('the button that starts a new automation', entry)
  if (entry !== null && !entry.__err) {
    await q(`document.querySelector('[data-j1609="1"]').click()`)
    await sleep(1500)
    const dlg = await q(`(() => { const d = document.querySelector('[role=dialog], .kba-new, [class*="sheet"], [class*="modal"]'); return (d || document.body).innerText.replace(/[ \\t]+/g, ' ').replace(/\\n+/g, ' / ').trim().slice(0, 2500) })()`)
    note('what opens (all words, first 2500 characters)', dlg)
    note('what opens: sentences that name a budget / certification / approval', String(dlg).split(' / ').filter((x) => RX.test(x)))
    note('what opens: its fields', await q(`Array.from(document.querySelectorAll('input, textarea, select')).filter((e) => e.getBoundingClientRect().width > 0 && e.type !== 'hidden').map((e) => ({ type: e.type || e.tagName.toLowerCase(), placeholder: e.placeholder || null, label: e.getAttribute('aria-label') || null, name: e.name || null }))`))
    await shot('j1609-3-new-en-1400')
    await q(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
    await sleep(500)
  }
  check('no source line promises a budget per automation', budgetNearAutomation.filter((l) => !/ui\.taskbudget|Budgets you can trust|catalog\.json|help\.json|tasks\.cards\.hint/.test(l)).length === 0, budgetNearAutomation)
  check('no visible sentence of the Automations page names a budget', !String(all).split(' / ').some((x) => /budget/i.test(x)), hits)
} catch (e) {
  fail += 1
  console.log('  FAIL the run stopped: ' + (e && e.stack ? e.stack : e))
} finally {
  try { await live.close() } catch (e) { /* gone */ }
  if (OUT !== null) { try { writeFileSync(join(OUT, 'automations-promises.json'), JSON.stringify({ pass, fail, notes }, null, 1)) } catch (e) { /* no folder */ } }
}
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)

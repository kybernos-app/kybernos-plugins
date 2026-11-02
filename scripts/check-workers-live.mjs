#!/usr/bin/env node
// The Workers page, in a real GUI: Settings → Workers, with the real client, the real host routes and the real programs of
// the machine (`claude`, `codex`, `gemini`… as the sandbox's DSH sees them).
//
//   source scripts/sandbox/env.sh && node scripts/check-workers-live.mjs [--shots <dir>]
//
// Needs a DSH that serves this checkout (scripts/sandbox/start.sh). Refuses :3080. It never installs anything, never types
// a key and never saves a policy: it reads, checks (which spends nothing) and opens the guide. The sandbox has no credential
// of the user's, so a key-based agent reads "To connect" there, which is what the page must handle.
// Exit code 0 / 1 / 3 (3 = inconclusive: no sandbox).
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { openLivePage } from './live-page.mjs'

const args = process.argv.slice(2)
const shotDir = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : null
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0
let fail = 0
const check = (name, ok, detail) => { if (ok) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) } }

const host = process.env.KB_HOST || '127.0.0.1:3080'
if (host === '127.0.0.1:3080') { console.error('○ inconclusive: this check needs a DSH that serves this checkout (a sandbox instance), not the one on :3080. Set KB_HOST, DSH_HOME and HOME.'); process.exit(3) }

const live = await openLivePage({ width: 1500, height: 1000 }).catch((e) => { console.error('○ inconclusive: ' + e.message); process.exit(3) })
const { page } = live
const val = async (expr, ms) => (await page.evalJs(expr, ms)).val
const shot = async (name) => { if (shotDir !== null) { try { mkdirSync(shotDir, { recursive: true }); await page.shot(join(shotDir, name + '.png')) } catch (e) { /* no screenshot */ } } }
const mouse = async (x, y) => { await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }); await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }); await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }) }
const poll = async (fn, ms = 10000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) return v; await sleep(250) } }
const key = async (k, code, vk) => { await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk }); await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk }) }
const clickKb = (kb) => val(`(() => { const b = document.querySelector('[data-kb="${kb}"]'); if (!b || b.disabled) return false; b.click(); return true })()`)

try {
  await sleep(3000)
  if ((await val(`/Add an API key to get started/.test(document.body.innerText)`)) === true) {
    const pos = await val(`(() => { const e = Array.from(document.querySelectorAll('*')).filter((e) => e.children.length === 0 && (e.innerText || '').trim() === 'Configure later')[0]; if (!e) return null; const r = e.getBoundingClientRect(); return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 }) })()`)
    if (typeof pos === 'string') { const { x, y } = JSON.parse(pos); await mouse(x, y); await sleep(700) }
  }
  await val(`document.querySelector('[class*="settingsArea"] button[class*="trigger"]').click()`)
  check('Settings open', (await poll(() => val(`/Back to workspace/.test(document.body.innerText)`), 8000)) === true)
  const went = await val(`(() => { const b = Array.from(document.querySelectorAll('button[class*="navCell"]')).find((x) => x.innerText.trim().split('\\n')[0] === 'Workers'); if (!b) return false; b.click(); return true })()`)
  await sleep(1800)
  check('the Workers entry is in the Settings menu and opens', went === true)
  const rows = await poll(() => val(`document.querySelectorAll('[data-kb^="wk-card-"]').length`), 10000)
  check('the page loaded: seven rows (Claude Code, Codex, Gemini, OpenCode, Qwen, Hermes, ZCode)', rows === 7, rows)
  const ids = await val(`Array.from(document.querySelectorAll('[data-kb^="wk-card-"]')).map((e) => e.dataset.kb.slice(8)).join()`)
  check('in the host’s order', ids === 'claude-code,codex,gemini,opencode,qwen,hermes,zcode', ids)
  check('every row has its logo and every logo resolves (an inline sprite, no image)', (await val(`Array.from(document.querySelectorAll('[data-kb^="wk-card-"] .kbwk-logo use')).every((u) => document.querySelector(u.getAttribute('href')) !== null) && document.querySelectorAll('[data-kb^="wk-card-"] .kbwk-logo use').length === 7 && document.querySelectorAll('.kbwk img').length === 0`)) === true)
  await shot('workers-live-first')

  const geometry = async () => JSON.parse(await val(`JSON.stringify(Array.from(document.querySelectorAll('.kbwk-list > li')).map((li) => { const r = (s) => li.querySelector(s).getBoundingClientRect(); return { nom: Math.round(r('.kbwk-nom').left), chip: Math.round(r('.kbwk-chip').left), steps: Math.round(r('.kbwk-steps').left), ctlRight: Math.round(r('.kbwk-ctl').right), nomW: Math.round(r('.kbwk-nom').width) } }))`))
  let g = await geometry()
  const same = (k) => new Set(g.map((x) => x[k])).size === 1
  check('the columns line up in the real Settings dialog (names, status chips, dots, actions)', same('nom') && same('chip') && same('steps') && same('ctlRight'), g)
  check('no name is squeezed (the five-column bug of the old row)', g.every((x) => x.nomW > 60), g.map((x) => x.nomW))

  console.log('\n── checking (spends nothing) ──')
  await clickKb('wk-all')
  const done = await poll(() => val(`Array.from(document.querySelectorAll('[data-kb^="wk-status-"]')).every((e) => !/Checking|Vérification|To check|À vérifier/.test(e.textContent)) ? Array.from(document.querySelectorAll('[data-kb^="wk-status-"]')).map((e) => e.dataset.kb.slice(10) + '=' + e.textContent.trim()).join(' | ') : false`), 90000)
  console.log('  · statuses on this machine: ' + String(done))
  check('"Check all" ended: every mounted row has a verdict (a not-mounted one stays "Not turned on")', typeof done === 'string' && !/Checking|To check/.test(done), done)
  const known = ['Ready', 'To install', 'To connect', 'To confirm', 'Restart DSH', 'Cannot write', 'Server not found', 'Not turned on']
  check('every status is one of the page’s own words', typeof done === 'string' && done.split(' | ').every((s) => known.includes(s.split('=')[1])), done)
  const dotsOk = await val(`Array.from(document.querySelectorAll('[data-kb^="wk-card-"]')).every((li) => li.querySelectorAll('.kbwk-steps i').length === 4)`)
  check('four dots on every row', dotsOk === true)
  const evidence = await val(`Array.from(document.querySelectorAll('[data-kb^="wk-card-"] .kbwk-ev')).map((e) => e.querySelectorAll('li').length).join()`)
  check('each checked row carries its lines of evidence in the details (five, four for ZCode which has no program to find)', typeof evidence === 'string' && evidence.split(',').length === 7 && evidence.split(',').slice(0, 6).every((n) => n === '5') && evidence.split(',')[6] === '4', evidence)
  g = await geometry()
  check('still lined up after the checks, whatever each row’s action is', same('nom') && same('chip') && same('steps') && same('ctlRight'), g)

  console.log('\n── an API key (Gemini, Qwen) ──')
  const gem = await val(`document.querySelector('[data-kb="wk-status-gemini"]') ? document.querySelector('[data-kb="wk-status-gemini"]').textContent.trim() : null`)
  console.log('  · Gemini reads "' + gem + '" here')
  if (gem === 'To connect') {
    const withField = await val(`!!document.querySelector('[data-kb="wk-key-gemini"]')`)
    const withText = await val(`/GEMINI_API_KEY/.test(document.querySelector('[data-kb="wk-card-gemini"]').textContent)`)
    console.log('  · the engine ' + (withField ? 'HAS' : 'does NOT have') + ' the credentials service the page asks for')
    check('Gemini without a key: a password field when the engine offers the credentials service, otherwise the name of the variable — never nothing', withField === true ? (await val(`document.querySelector('[data-kb="wk-key-gemini"]').type`)) === 'password' : withText === true)
  } else console.log('  · (Gemini is not in the "To connect" state on this machine: key field not exercised)')

  console.log('\n── the guide ──')
  const hb = await poll(() => val(`!!document.querySelector('[data-kb="help-button"][data-id="kybernos-workers"]')`), 8000)
  const own = await val(`!!document.querySelector('[data-kb="wk-guide"]')`)
  check('the page carries ONE entry to the guide: the Suite’s help card (with its action), or the page’s own button on an older Suite — never both, never none', (hb === true) !== (own === true), { hb, own })
  if (hb === true) {
    await clickKb('help-button'); await sleep(500)
    check('the help card carries the "Try the demo" action', (await val(`/Try the demo|Essayer la démo/.test((document.querySelector('[data-kb="help-action"]') || { innerText: '' }).innerText)`)) === true)
    await clickKb('help-action')
  } else await clickKb('wk-guide')
  check('the guide opens as a dialog', (await poll(() => val(`!!document.querySelector('[data-kb="workers-guide"]')`), 4000)) === true)
  await sleep(400)
  check('it sits above the Settings dialog and inside the window', (await val(`(() => { const d = document.querySelector('.kbwk-dlg').getBoundingClientRect(); return d.width > 300 && d.right <= window.innerWidth + 1 && d.left >= -1 })()`)) === true)
  check('the Suite’s demo steps run (turn on → check → install question)', (await (async () => {
    await clickKb('guide-activate'); await sleep(200); await clickKb('guide-next'); await sleep(100); await clickKb('guide-check')
    await poll(() => val(`/To install|À installer/.test(document.querySelector('.kbwk-mini .kbwk-chip').textContent)`), 4000)
    await clickKb('guide-next'); await sleep(100); await clickKb('guide-ask'); await sleep(200)
    return val(`/curl -fsSL https:\\/\\/claude\\.ai\\/install\\.sh \\| bash/.test(document.querySelector('.kbwk-stage').textContent)`)
  })()) === true)
  await shot('workers-live-guide')
  await key('Escape', 'Escape', 27)
  await sleep(400)
  check('Escape closes the guide and NOT the Settings dialog behind it', (await val(`!document.querySelector('[data-kb="workers-guide"]') && /Back to workspace/.test(document.body.innerText)`)) === true)
  check('the page behind the guide did not change (the demo is a simulation)', (await val(`Array.from(document.querySelectorAll('[data-kb^="wk-status-"]')).map((e) => e.dataset.kb.slice(10) + '=' + e.textContent.trim()).join(' | ')`)) === done)
  await shot('workers-live-after')
} catch (e) {
  fail += 1
  console.log('  ✗ the check stopped: ' + e.message)
} finally {
  await live.close()
}
console.log('\n' + pass + ' ✓  ' + fail + ' ✗')
process.exit(fail === 0 ? 0 : 1)

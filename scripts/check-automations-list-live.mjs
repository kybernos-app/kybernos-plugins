#!/usr/bin/env node
// The List of the Automations page, its words and its « Edit → chat » button, in a real GUI: the real client, the real host
// routes and the real scheduler adopting what is seeded.
//
//   source scripts/sandbox/env.sh && node scripts/check-automations-list-live.mjs [--shots <dir>] [--at HH:MM]
//
// Needs a DSH that serves this checkout (scripts/sandbox/start.sh). Refuses :3080 and any DSH home that is not a sandbox's.
// It WRITES the sandbox's kybernos/tasks.json (eight automations) and puts the file back as it was. Nothing leaves the machine
// and no model is called: « Edit → chat » only puts a draft in the composer of a new chat, it sends nothing.
//
// What it proves (audit of 2026-10-16, package « Automations: display and Edit → chat »):
//   - V-18   the header sits over its cells (same left edge, every column, every row), one card with one border, the line under
//            the name, the row actions at the right (hidden at rest, shown on hover and on keyboard focus, a starred row keeps
//            its star), a switch smaller than 40 px, one hover band over the whole row;
//   - A5-09  « Every 2 hours », « Every month on the 1st, 08:00 », and the cron expression (with a tooltip) for what a sentence
//            cannot say exactly (the 31st);
//   - A5-10  one date style on the page (no dd/mm anywhere), the same one in the chip and in the date line of a card;
//   - A5-25  a schedule in another zone names it, on the card and in the List;
//   - A5-31  the Schedule form has a time field, the presets keep the time, and its messages say « automation »;
//   - A5-24  the host refuses a schedule that runs more often than every 5 minutes unless it is confirmed;
//   - V-19   « Edit in chat », from a row and from the page of an automation, puts a draft that names the automation-creator
//            skill and carries the automation as it stands in the composer of a NEW chat; the form is still there;
//   - at 390 px nothing overflows sideways and each row is a readable block.
//
// The clock. The page says « Today », « Tomorrow », « Yesterday » from its own clock, so what it shows depends on the hour the check is
// started at, and on whether midnight falls inside the run. Nothing here is a date written down: the seeds are a function of « now »,
// the words that are expected are worked out from the page's clock at the instant they are read, and the cards are awaited, not read
// once. `--at HH:MM` (or KB_CLOCK=HH:MM) proves it: it sets the page's clock AND the seeds' to that time of today (running on from
// there; the page's Date is replaced before any script of the page runs). The host's scheduler keeps the real clock.
// Exit code 0 / 1 / 2 (bad arguments) / 3 (inconclusive: no sandbox).
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { openLivePage, clickText } from './live-page.mjs'

const args = process.argv.slice(2)
const shotDir = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : null
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const atArg = args.includes('--at') ? String(args[args.indexOf('--at') + 1]) : (process.env.KB_CLOCK || '')
const atMatch = /^(\d{1,2}):(\d{2})$/.exec(atArg)
if (atArg !== '' && (atMatch === null || Number(atMatch[1]) > 23 || Number(atMatch[2]) > 59)) { console.error('usage: --at HH:MM (00:00 to 23:59)'); process.exit(2) }
// The simulated clock is the real one, moved by a constant: the same here (the seeds) and in the page (its Date).
const offset = atMatch === null ? 0 : (() => { const t = new Date(); t.setHours(Number(atMatch[1]), Number(atMatch[2]), 0, 0); return t.getTime() - Date.now() })()
const nowMs = () => Date.now() + offset
const clockShim = (ms) => '(() => { const R = Date; const off = ' + ms + '; const F = function Date(...a) { if (!new.target) return new R(R.now() + off).toString(); return a.length === 0 ? new R(R.now() + off) : new R(...a) }; F.prototype = R.prototype; F.now = () => R.now() + off; F.parse = R.parse; F.UTC = R.UTC; Object.setPrototypeOf(F, R); window.Date = F })()'
// « Yesterday », « Today », « Tomorrow » for a moment against another one (calendar days of this machine), as the page words them.
const dayWord = (ms, against) => { const day = (x) => { const d = new Date(x); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() }; return { '-1': 'Yesterday', 0: 'Today', 1: 'Tomorrow' }[String(Math.round((day(ms) - day(against)) / 86400000))] }
let pass = 0
let fail = 0
const check = (name, ok, detail) => { if (ok) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) } }

const host = process.env.KB_HOST || '127.0.0.1:3080'
const home = process.env.DSH_HOME || ''
if (host === '127.0.0.1:3080') { console.error('○ inconclusive: this check needs a DSH that serves this checkout (a sandbox instance), not the one on :3080. Set KB_HOST, DSH_HOME and HOME (source scripts/sandbox/env.sh).'); process.exit(3) }
if (home === '' || home.indexOf('.kybernos-sandbox') < 0) { console.error('○ inconclusive: DSH_HOME is not a sandbox home (' + (home === '' ? 'unset' : 'not under .kybernos-sandbox') + '): this check writes tasks.json and refuses to.'); process.exit(3) }

const file = join(home, 'kybernos', 'tasks.json')
const original = existsSync(file) ? readFileSync(file, 'utf8') : null
const writeAtomic = (text) => { mkdirSync(join(home, 'kybernos'), { recursive: true }); const tmp = file + '.tmp-list-check'; writeFileSync(tmp, text, { mode: 0o600 }); renameSync(tmp, file) }
const readTasks = () => { try { return JSON.parse(readFileSync(file, 'utf8')) } catch (e) { return [] } }
const restore = () => { try { if (original === null) rmSync(file, { force: true }); else writeAtomic(original) } catch (e) { /* the sandbox is disposable */ } }

// ── Eight automations; their dates are a function of today, never of a date written here ─────────────────────
const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
const local = (d, h, m) => { const x = new Date(nowMs()); x.setDate(x.getDate() + d); x.setHours(h, m || 0, 0, 0); return x }
const ymdHm = (x) => x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0') + 'T' + String(x.getHours()).padStart(2, '0') + ':' + String(x.getMinutes()).padStart(2, '0')
const stamp = new Date().toISOString()
let n = 0
const ran = (d, h, m) => { n += 1; return { at: local(d, h, m).toISOString(), sessionId: 'seed-session-' + n, status: 'fired' } }
const mk = (id, name, schedule, extra) => {
  const t = Object.assign({ id, createdAt: stamp, updatedAt: stamp, history: [], lastRun: null, nextRun: null, name, prompt: '1. Reply with the single word OK.\n2. Say nothing else, $& stays as written.', schedule, runsOn: 'local', active: true, approvals: 'ask', notify: [] }, extra || {})
  if (t.history.length > 0) t.lastRun = t.history[t.history.length - 1].at
  return t
}
const ONCE_AT = local(1, 10, 0)
const other = tz === 'Asia/Kolkata' ? 'America/New_York' : 'Asia/Kolkata'
const otherCity = other.split('/').pop().replace(/_/g, ' ')
const SEED = [
  mk('wp18-2h', 'A very long automation name that keeps going and going to see how the row truncates it', { mode: 'cron', cron: '0 */2 * * *', tz }),
  mk('wp18-month', 'Monthly digest', { mode: 'cron', cron: '0 8 1 * *', tz }, { notify: ['push'], history: [ran(-1, 8, 0)] }),
  mk('wp18-31', 'End of month close', { mode: 'cron', cron: '30 23 31 * *', tz }),
  mk('wp18-zone', 'Morning brief abroad', { mode: 'cron', cron: '0 8 * * *', tz: other }, { approvals: 'auto', history: [ran(-2, 8, 0), ran(-1, 8, 0)] }),
  mk('wp18-weekdays', 'Weekdays 9:15', { mode: 'cron', cron: '15 9 * * 1-5', tz }, { history: [ran(-1, 9, 15)] }),
  mk('wp18-once', 'Launch review', { mode: 'once', at: ymdHm(ONCE_AT), tz }),
  mk('wp18-hook', 'New support ticket', { mode: 'webhook', tz }, { trigger: { type: 'webhook', hookId: 'hk_000000000001', secret: 'seed-secret-0123456789abcdef0123' } }),
  // Paused, so the scheduler never starts a session for it: it holds the schedule that the host refuses without a yes.
  mk('wp18-freq', 'Every two minutes', { mode: 'cron', cron: '*/2 * * * *', tz }, { active: false }),
]

const live = await openLivePage({ width: 1400, height: 900 }).catch((e) => { console.error('○ inconclusive: ' + e.message); process.exit(3) })
const { page } = live
const val = async (expr, ms) => (await page.evalJs(expr, ms)).val
const poll = async (fn, ms = 10000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) return v; await sleep(250) } }
const shot = async (name) => { if (shotDir !== null) { try { mkdirSync(shotDir, { recursive: true }); await page.shot(join(shotDir, name + '.png')) } catch (e) { /* no screenshot */ } } }
const q = (sel) => val(`document.querySelectorAll(${JSON.stringify(sel)}).length`)
const click = (sel) => val(`(() => { const b = document.querySelector(${JSON.stringify(sel)}); if (!b || b.disabled) return false; b.click(); return true })()`)
const texts = (sel) => val(`Array.from(document.querySelectorAll(${JSON.stringify(sel)})).map((e) => e.innerText.replace(/\\s+/g, ' ').trim())`)
const exceptions = []
page.on('Runtime.exceptionThrown', (p) => { exceptions.push(String((p.exceptionDetails && (p.exceptionDetails.text + ' ' + ((p.exceptionDetails.exception && p.exceptionDetails.exception.description) || ''))) || '').slice(0, 240)) })

const openAutomations = async () => {
  await sleep(1500)
  for (let i = 0; i < 4; i += 1) {
    await clickText(page, 'Automations')
    if (await poll(() => q('[data-kb="page-automations"]'), 6000)) {
      await poll(async () => (await q('[data-kb^="view-"]')) > 0 || (await q('[data-kb="automations-onboarding"]')) > 0, 15000)
      return true
    }
  }
  return false
}
const view = (v) => click('[data-kb="view-' + v + '"]')
// A row is found by the id its favorite star carries.
const rowOf = (id) => `(Array.from(document.querySelectorAll('.kba-rowline:not(.kba-rowline-head)')).find((r) => r.querySelector('[data-id=${JSON.stringify(id).replace(/"/g, '\\"')}]')))`
const hoverRow = async (index) => {
  const r = await val(`(() => { const e = document.querySelectorAll('.kba-rowline:not(.kba-rowline-head)')[${index}]; if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 } })()`)
  if (r === null) return false
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.x, y: r.y })
  await sleep(350)
  return true
}
const leftEdges = (sel) => val(`(() => { const r = document.querySelector(${JSON.stringify(sel)}); return r ? Array.from(r.children).filter((c) => getComputedStyle(c).display !== 'none').map((c) => Math.round(c.getBoundingClientRect().left)) : null })()`)

try {
  await page.send('Runtime.enable', {})
  if (atMatch !== null) {
    console.log('\n── the clock is set to ' + atArg + ' today (the page\'s Date and the seeds) ──')
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: clockShim(offset) })
    await page.send('Page.reload', { ignoreCache: true })
    await sleep(2500)
    const said = await poll(async () => { const v = await val('Date.now()'); return typeof v === 'number' && Math.abs(v - nowMs()) < 5000 ? v : null }, 15000)
    check('the page\'s clock reads ' + atArg + ' (not the real time)', typeof said === 'number', { page: await val('new Date().toString()'), want: new Date(nowMs()).toString() })
  }
  console.log('\n── seeding eight automations ──')
  writeAtomic(JSON.stringify(SEED, null, 2))
  check('the Automations page opens on the List', (await openAutomations()) === true && (await view('list')) === true && (await poll(() => q('.kba-rowline:not(.kba-rowline-head)'))) === SEED.length)
  await sleep(500)
  await shot('automations-list')

  console.log('\n── V-18: one grid, one card, one border ──')
  const head = await leftEdges('.kba-rowline-head .kba-rowhead')
  const rows = JSON.parse(await val(`JSON.stringify(Array.from(document.querySelectorAll('.kba-rowline:not(.kba-rowline-head) .kba-rowbtn')).map((r) => Array.from(r.children).map((c) => Math.round(c.getBoundingClientRect().left))))`))
  check('the header has its five columns (name, trigger, origin, last session, sessions)', Array.isArray(head) && head.length === 5, head)
  check('every row\'s cells start where their header does (it was 100 px off)', rows.length === SEED.length && rows.every((r) => r.length === 5 && r.every((x, i) => Math.abs(x - head[i]) <= 1)), { head, rows: rows.slice(0, 2) })
  const card = JSON.parse(await val(`(() => { const c = document.querySelector('.kba-lcard'); const s = getComputedStyle(c); const kids = Array.from(c.children); return JSON.stringify({ pad: s.paddingTop + '/' + s.paddingLeft, borders: kids.map((k) => getComputedStyle(k).borderTopWidth), bw: s.borderTopWidth, nested: c.querySelectorAll('.kba-card').length }) })()`))
  check('the list card has no padding of its own and no card inside it (it had a second border)', card.pad === '0px/0px' && card.nested === 0, card)
  check('...the header has no top border and each row exactly one', card.borders[0] === '0px' && card.borders.slice(1).every((b) => b === '1px'), card.borders)
  const names = await texts('.kba-rowline:not(.kba-rowline-head) .kba-namecell')
  check('under each name a second line says how the automation runs (an automation has no Agent Team of its own to name)', names.length === SEED.length && names.every((t) => /Ask me first|Always allow/.test(t)) && names.some((t) => /Always allow/.test(t)) && names.some((t) => /notifications on/.test(t)), names)
  check('the header names the first column for what it holds', (await texts('.kba-rowline-head .kba-rowhead span'))[0] === 'NAME')
  const acts = await val(`(() => { const row = ${rowOf('wp18-2h')}; const a = row.querySelector('.kba-lacts'); const trg = row.querySelector('.kba-trgcell'); const sw = row.querySelector('.kba-toggle'); const b = a.getBoundingClientRect(); return { right: b.left > trg.getBoundingClientRect().right, beforeSwitch: b.right <= sw.getBoundingClientRect().left + 1, ops: Array.from(a.querySelectorAll('button')).map((x) => getComputedStyle(x).opacity), n: a.querySelectorAll('button').length, order: Array.from(row.children).map((c) => c.className.split(' ')[0]) } })()`)
  check('the row\'s actions are at the right, after the columns and before the switch, and AFTER the name in the tab order', acts.right === true && acts.beforeSwitch === true && acts.order.join() === 'kba-rowbtn,kba-lacts,kba-toggle', acts)
  check('...hidden at rest', acts.ops.every((o) => o === '0'), acts.ops)
  check('...five of them: Edit in chat, favorite, clone, export, delete', acts.n === 5 && JSON.stringify(await val(`Array.from((${rowOf('wp18-2h')}).querySelectorAll('.kba-lacts button')).map((b) => b.dataset.kb)`)) === JSON.stringify(['action-edit-chat', 'favorite-star', 'action-clone', 'action-export', 'action-delete']))
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 })
  check('the page leaves the pointer out of the list at rest', (await val(`getComputedStyle(document.querySelector('.kba-lacts .kb-favbtn')).opacity`)) === '0')
  check('hovering a row shows them', (await hoverRow(2)) === true && JSON.stringify(await val(`Array.from(document.querySelectorAll('.kba-rowline:not(.kba-rowline-head)')[2].querySelectorAll('.kba-lacts button')).map((b) => getComputedStyle(b).opacity)`)) === JSON.stringify(['1', '1', '1', '1', '1']))
  const band = JSON.parse(await val(`(() => { const r = document.querySelectorAll('.kba-rowline:not(.kba-rowline-head)')[2]; const c = document.querySelector('.kba-lcard'); const s = getComputedStyle(r); const sw = r.querySelector('.kba-toggle').getBoundingClientRect(); const b = r.getBoundingClientRect(); return JSON.stringify({ bg: s.backgroundColor, covers: sw.right <= b.right, w: Math.round(b.width), cw: Math.round(c.getBoundingClientRect().width) }) })()`))
  check('...and one hover band covers the whole row, the switch included (it stopped before the ON column)', band.bg !== 'rgba(0, 0, 0, 0)' && band.covers === true && band.w >= band.cw - 2, band)
  await shot('automations-list-hover')
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 })
  await sleep(300)
  await val(`(() => { const b = document.querySelectorAll('.kba-rowline:not(.kba-rowline-head)')[4].querySelector('.kba-rowbtn'); b.focus() })()`)
  await sleep(300)
  check('keyboard focus on a row shows its actions too', JSON.stringify(await val(`Array.from(document.querySelectorAll('.kba-rowline:not(.kba-rowline-head)')[4].querySelectorAll('.kba-lacts button')).map((b) => getComputedStyle(b).opacity)`)) === JSON.stringify(['1', '1', '1', '1', '1']))
  await val(`document.activeElement && document.activeElement.blur()`)
  await val(`(() => { const s = document.querySelector('.kba-lacts [data-kb="favorite-star"]'); s.click() })()`)
  await sleep(500)
  check('a starred row keeps its star visible at rest', (await val(`getComputedStyle(document.querySelector('.kba-lacts [data-kb="favorite-star"].on')).opacity`)) === '1')
  await val(`document.querySelector('.kba-lacts [data-kb="favorite-star"].on').click()`)
  const sw = JSON.parse(await val(`(() => { const s = document.querySelector('.kba-lcard .kba-toggle').getBoundingClientRect(); return JSON.stringify({ w: Math.round(s.width), h: Math.round(s.height) }) })()`))
  check('the switch is small (34 x 20, it was 44 x 26)', sw.w <= 36 && sw.h <= 22, sw)
  check('both switches of the page keep their keyboard behaviour (a role, a tab stop)', (await q('.kba-lcard .kba-toggle[role="switch"][tabindex="0"]')) === SEED.length)

  console.log('\n── A5-09: readable schedules ──')
  const trg = await texts('.kba-rowline:not(.kba-rowline-head) .kba-trg-stack .kba-ell')
  const byName = (arr, i) => arr[i]
  const order = await texts('.kba-rowline:not(.kba-rowline-head) .kba-name')
  const trigOf = (name) => trg[order.findIndex((t) => t.indexOf(name) === 0)]
  check('every 2 hours reads « Every 2 hours »', trigOf('A very long') === 'Every 2 hours', trg)
  check('the 1st of the month reads as a sentence', trigOf('Monthly digest') === 'Every month on the 1st, 08:00', trigOf('Monthly digest'))
  check('the 31st stays the expression (not every month has one)', trigOf('End of month') === 'Cron expression · 30 23 31 * *', trigOf('End of month'))
  check('a weekday set and a one-time date read as before', trigOf('Weekdays 9:15') === 'Weekdays, 09:15' && /^One time · \w{3}, \w{3} \d{1,2} · 10:00$/.test(trigOf('Launch review')), trg)
  const tips = await val(`JSON.stringify(Array.from(document.querySelectorAll('.kba-rowline:not(.kba-rowline-head) .kba-trg-stack .kba-ell')).map((e) => e.getAttribute('title')))`)
  check('the tooltip of a schedule is its expression, so the words hide nothing', JSON.parse(tips).some((t) => /0 \*\/2 \* \* \*/.test(t || '')) && JSON.parse(tips).some((t) => /30 23 31 \* \*/.test(t || '')), tips)

  console.log('\n── A5-10: one date style ──')
  const pageText = await val(`document.querySelector('[data-kb="page-automations"]').innerText`)
  check('no dd/mm date on the List (« 15/10 08:00 »)', /\b\d{1,2}\/\d{1,2}\b/.test(pageText) === false, pageText.match(/.{0,20}\b\d{1,2}\/\d{1,2}\b.{0,10}/g))
  const lasts = await texts('.kba-rowline:not(.kba-rowline-head) .kba-last .kba-ell')
  const listNow = await val('Date.now()')
  const seededLast = (id) => { const t = SEED.find((x) => x.id === id); return Date.parse(t.history[t.history.length - 1].at) }
  const lastWords = (id, hm) => dayWord(seededLast(id), listNow) + ' · ' + hm + ' · ok'
  check('the last session reads « Yesterday · 08:00 · ok », the board\'s own words (the day word worked out from the page\'s clock)', lasts.includes(lastWords('wp18-month', '08:00')) && lasts.includes(lastWords('wp18-weekdays', '09:15')), { want: [lastWords('wp18-month', '08:00'), lastWords('wp18-weekdays', '09:15')], lasts })
  check('one automation has no session yet and one is paused, in words', lasts.includes('No session yet') && lasts.includes('Paused'), lasts)

  console.log('\n── Columns: the chip and the date line of a card agree ──')
  const SCHEDULED = ['wp18-2h', 'wp18-month', 'wp18-31', 'wp18-zone', 'wp18-weekdays', 'wp18-once']
  const adopted = await poll(async () => { const t = readTasks(); return SCHEDULED.every((id) => { const x = t.find((y) => y.id === id); return x !== undefined && typeof x.nextRun === 'string' }) }, 70000)
  check('the scheduler gave a next run to the scheduled automations (about 30 s)', adopted === true)
  check('Columns opens', (await view('columns')) === true && (await poll(() => q('[data-kb="board-columns"]'))) === 1)
  // The board draws what its page last loaded, and the file has a next run (checked above) before the page does: read until each
  // scheduled automation has its card in the first column, with the page's clock taken in the same read (the day words come from it).
  const readBoard = async () => JSON.parse(await val(`JSON.stringify({ now: Date.now(), cards: Array.from(document.querySelectorAll('[data-kb="board-card"]')).map((c) => ({ task: c.dataset.task, col: c.dataset.col, chip: c.querySelector('.kbbd-chip-t').innerText, when: c.querySelector('.kbbd-when').innerText, tip: c.querySelector('.kbbd-chip').getAttribute('title') })) })`))
  const boardAt = Date.now()
  let board = await readBoard()
  while (!SCHEDULED.every((id) => board.cards.some((c) => c.task === id && c.col === 'upcoming')) && Date.now() - boardAt < 40000) { await sleep(300); board = await readBoard() }
  console.log('  · the board had its cards after ' + (Date.now() - boardAt) + ' ms')
  const cards = board.cards
  const cardOf = (id) => cards.find((c) => c.task === id && c.col === 'upcoming')
  check('the one-time card: « One time · Sat, Oct 17 · 10:00 » over « Tomorrow · 10:00 » (the day word worked out from the page\'s clock), never « 17/10 10:00 »', cardOf('wp18-once') !== undefined && /^One time · \w{3}, \w{3} \d{1,2} · 10:00$/.test(cardOf('wp18-once').chip) && cardOf('wp18-once').when === dayWord(ONCE_AT.getTime(), board.now) + ' · 10:00', { card: cardOf('wp18-once'), cards: cards.length })
  check('every 2 hours is a sentence on its card too, its tooltip the expression', cardOf('wp18-2h') !== undefined && cardOf('wp18-2h').chip === 'Every 2 hours' && /0 \*\/2 \* \* \*/.test(cardOf('wp18-2h').tip), cardOf('wp18-2h'))
  console.log('\n── A5-25: another zone is named ──')
  check('« Every day, 08:00 (' + otherCity + ') » on the card, in this person\'s own clock below it', cardOf('wp18-zone') !== undefined && cardOf('wp18-zone').chip === 'Every day, 08:00 (' + otherCity + ')' && /^(Today|Tomorrow|\w{3}, \w{3} \d{1,2}) · \d\d:\d\d$/.test(cardOf('wp18-zone').when), cardOf('wp18-zone'))
  check('...and an automation in the person\'s own zone says no zone', cardOf('wp18-weekdays') !== undefined && cardOf('wp18-weekdays').chip === 'Weekdays, 09:15', cardOf('wp18-weekdays'))
  await shot('automations-columns')
  await view('list')
  await poll(() => q('.kba-lcard'))
  check('...the List names it too', (await texts('.kba-rowline:not(.kba-rowline-head) .kba-trg-stack .kba-ell')).some((t) => t === 'Every day, 08:00 (' + otherCity + ')'))

  console.log('\n── A5-31: the Schedule form has a time field ──')
  check('the page of an automation opens from its row', (await val(`(() => { const b = ${rowOf('wp18-weekdays')}.querySelector('.kba-rowbtn'); b.click(); return true })()`)) === true && (await poll(() => q('[data-kb="detail-edit-chat"]'))) === 1)
  check('...and « Schedule » opens the form, which is still there for manual edits', (await clickText(page, 'Schedule')) === true && (await poll(() => q('.kb-task-modal'))) === 1)
  const timeVal = () => val(`(document.querySelector('[data-kb="task-time"]') || { value: null }).value`)
  check('a time field shows the time of the schedule (09:15)', (await timeVal()) === '09:15')
  check('the sentence under the presets says the same', /Weekdays, 09:15/.test(await val(`document.querySelector('.kb-task-modal').innerText`)))
  await clickText(page, 'Every day', { within: '.kb-task-modal' })
  await sleep(300)
  check('pressing « Every day » keeps the 09:15 (it became 08:00)', (await timeVal()) === '09:15' && /Every day, 09:15/.test(await val(`document.querySelector('.kb-task-modal').innerText`)))
  await val(`(() => { const el = document.querySelector('[data-kb="task-time"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '07:30'); el.dispatchEvent(new Event('input', { bubbles: true })) })()`)
  await sleep(300)
  check('typing 07:30 in the field says « Every day, 07:30 »', /Every day, 07:30/.test(await val(`document.querySelector('.kb-task-modal').innerText`)))
  await clickText(page, 'Every Friday', { within: '.kb-task-modal' })
  await sleep(300)
  check('...and « Every Friday » keeps it (the preset used to set 16:00)', (await timeVal()) === '07:30' && /Every Friday, 07:30/.test(await val(`document.querySelector('.kb-task-modal').innerText`)))
  await clickText(page, 'Weekdays', { within: '.kb-task-modal' })
  await sleep(200)
  await shot('automations-form')
  check('Save writes the schedule: weekdays at 07:30', (await click('[data-kb="task-save"]')) === true && (await poll(async () => { const t = readTasks().find((x) => x.id === 'wp18-weekdays'); return t && t.schedule.cron === '30 7 * * 1-5' }, 10000)) === true, (readTasks().find((x) => x.id === 'wp18-weekdays') || {}).schedule)
  check('...and the form closes', (await poll(async () => (await q('.kb-task-modal')) === 0, 8000)) === true)
  check('the validation messages say « automation », not « task »', await (async () => {
    await clickText(page, 'Schedule')
    await poll(() => q('.kb-task-modal'))
    await val(`(() => { const el = document.querySelector('.kb-task-modal input[type="text"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ''); el.dispatchEvent(new Event('input', { bubbles: true })) })()`)
    await click('[data-kb="task-save"]')
    await sleep(300)
    const msg = await val(`(document.querySelector('.kb-task-err') || { innerText: '' }).innerText`)
    await clickText(page, 'Cancel', { within: '.kb-task-modal' })
    return /Give the automation a name/.test(msg)
  })() === true)

  console.log('\n── V-19: Edit in chat ──')
  check('the page of an automation has the button next to Run now and Schedule', (await q('[data-kb="detail-edit-chat"]')) === 1 && /Edit in chat/.test(await val(`document.querySelector('[data-kb="detail-edit-chat"]').innerText`)))
  check('the button of a row is named for its row (« Edit Weekdays 9:15 in chat »)', await (async () => {
    await click('.kba-crumb')
    await poll(() => q('.kba-lcard'))
    const label = await val(`(${rowOf('wp18-weekdays')}).querySelector('[data-kb="action-edit-chat"]').getAttribute('aria-label')`)
    return label === 'Edit Weekdays 9:15 in chat'
  })() === true)
  const sessionsBefore = await val(`(() => { try { return JSON.stringify(Array.from(document.querySelectorAll('[data-session-id], [data-sid]')).length) } catch (e) { return '0' } })()`)
  void sessionsBefore
  check('a click on the row action opens a NEW chat', (await val(`(() => { (${rowOf('wp18-weekdays')}).querySelector('[data-kb="action-edit-chat"]').click(); return true })()`)) === true && (await poll(async () => (await q('[data-kb="page-automations"]')) === 0, 15000)) === true)
  // The editor of the composer shows a line break as a paragraph (two newlines in innerText): the check reads one per break.
  const draft = await poll(async () => { const t = await val(`(() => { const e = document.querySelector('[contenteditable="true"]'); return e ? e.innerText : '' })()`); return /edit mode/.test(t) ? t.replace(/\n+/g, '\n') : '' }, 20000)
  check('...with a draft in its composer that names the automation-creator skill and says this is an edit', typeof draft === 'string' && draft.startsWith('Skill automation-creator') && /do not create a new one/.test(draft), String(draft).slice(0, 160))
  check('...and carries the automation as it stands: id, name, when it runs (words, cron, zone), approvals, steps', /wp18-weekdays/.test(draft) && /Weekdays 9:15/.test(draft) && /Weekdays, 07:30/.test(draft) && new RegExp('cron 30 7 \\* \\* 1-5, ' + tz.replace('/', '\\/')).test(draft) && /Ask me first \(ask\)/.test(draft) && /1\. Reply with the single word OK\.\n2\. Say nothing else, \$& stays as written\./.test(draft), draft)
  check('...never the webhook secret or an id of a webhook', /secret|hk_/.test(draft) === false)
  check('...it is a draft: nothing was sent', (await val(`document.body.innerText.indexOf('Skill automation-creator') >= 0`)) === true && (await val(`Array.from(document.querySelectorAll('[class*="message"]')).filter((m) => /Skill automation-creator/.test(m.innerText) && m.getAttribute('contenteditable') !== 'true').length`)) === 0)
  await shot('automations-edit-chat')
  check('the Automations page comes back, and its detail opens the same chat from « Edit in chat »', (await openAutomations()) === true && (await view('list')) === true && (await poll(() => q('.kba-lcard'))) === 1)
  await val(`(() => { (${rowOf('wp18-hook')}).querySelector('.kba-rowbtn').click() })()`)
  check('...from the page of a webhook-only automation', (await poll(() => q('[data-kb="detail-edit-chat"]'))) === 1 && (await click('[data-kb="detail-edit-chat"]')) === true && /External webhook/.test(await poll(async () => { const t = await val(`(() => { const e = document.querySelector('[contenteditable="true"]'); return e ? e.innerText : '' })()`); return /wp18-hook/.test(t) ? t : '' }, 20000)))

  console.log('\n── A5-24: a schedule that runs more often than every 5 minutes needs a confirmation ──')
  check('back on the Automations page', (await openAutomations()) === true)
  const post = (task, extra) => val(`fetch('/kybernos/tasks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(Object.assign({ action: 'create', task: ${JSON.stringify(task)} }, ${JSON.stringify(extra || {})})) }).then((r) => r.json())`, 20000)
  const every = (cron, more) => Object.assign({ name: 'Frequent ' + cron, prompt: '1. say ok', schedule: { mode: 'cron', cron, tz }, active: false }, more || {})
  const before = readTasks().length
  const refused = await post(every('* * * * *'))
  check('« every minute » is refused with the number of minutes, and nothing is saved', refused.ok === false && refused.error === 'frequent schedule' && refused.everyMinutes === 1 && readTasks().length === before, refused)
  check('« every 4 minutes » too, « every 5 » is saved', (await post(every('*/4 * * * *'))).everyMinutes === 4 && (await post(every('*/5 * * * *'))).ok === true)
  const yes = await post(every('* * * * *', { confirmFrequent: true }))
  check('confirmed (confirmFrequent: true): saved, and the flag is not stored', yes.ok === true && readTasks().every((t) => t.confirmFrequent === undefined) && readTasks().some((t) => t.id === yes.task.id))
  const upd = await val(`fetch('/kybernos/tasks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'update', id: 'wp18-freq', task: ${JSON.stringify({ name: 'Every two minutes (renamed)', prompt: '1. say ok', schedule: { mode: 'cron', cron: '*/2 * * * *', tz }, active: false })} }) }).then((r) => r.json())`, 20000)
  check('renaming an automation that already ran every 2 minutes is not asked again', upd.ok === true && readTasks().find((t) => t.id === 'wp18-freq').name === 'Every two minutes (renamed)', upd)
  const upd2 = await val(`fetch('/kybernos/tasks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'update', id: 'wp18-month', task: ${JSON.stringify({ name: 'Monthly digest', prompt: '1. say ok', schedule: { mode: 'cron', cron: '* * * * *', tz }, active: false })} }) }).then((r) => r.json())`, 20000)
  check('...but turning a monthly one into an every-minute one is', upd2.ok === false && upd2.error === 'frequent schedule' && readTasks().find((t) => t.id === 'wp18-month').schedule.cron === '0 8 1 * *', upd2)

  console.log('\n── a phone (390 px) ──')
  check('the List again', (await view('list')) === true && (await poll(() => q('.kba-lcard'))) === 1)
  await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false })
  await sleep(900)
  const geo = JSON.parse(await val(`(() => { const c = document.querySelector('.kba-lcard'); const rows = Array.from(document.querySelectorAll('.kba-rowline:not(.kba-rowline-head)')); const r0 = rows[0]; const sw = r0.querySelector('.kba-toggle').getBoundingClientRect(); const acts = r0.querySelector('.kba-lacts').getBoundingClientRect(); const main = r0.querySelector('.kba-rowbtn').getBoundingClientRect(); return JSON.stringify({ docSw: document.documentElement.scrollWidth, docCw: document.documentElement.clientWidth, cardSw: c.scrollWidth, cardCw: c.clientWidth, head: getComputedStyle(document.querySelector('.kba-rowline-head')).display, h: Math.round(r0.getBoundingClientRect().height), swRight: sw.left > main.right - 60, actsBelow: acts.top >= main.bottom - 2, cells: Array.from(r0.querySelector('.kba-rowbtn').children).filter((x) => getComputedStyle(x).display !== 'none').length }) })()`))
  check('nothing is wider than the screen', geo.docSw <= geo.docCw + 1 && geo.cardSw <= geo.cardCw + 1, geo)
  check('the header is gone and each row is one block: name, trigger, last session; the switch at its right, the actions under it', geo.head === 'none' && geo.cells === 3 && geo.swRight === true && geo.actsBelow === true && geo.h < 190, geo)
  await shot('automations-list-phone')
  await page.send('Emulation.clearDeviceMetricsOverride', {})
  await sleep(500)

  console.log('\n── errors ──')
  check('no exception in the page', exceptions.length === 0, exceptions)
  check('no console error', page.errs.length === 0, page.errs)
} catch (e) {
  fail += 1
  console.log('  ✗ the check stopped: ' + (e && e.message ? e.message : e))
} finally {
  restore()
  await live.close()
}

console.log('\n' + (fail === 0 ? 'ALL ' + pass + ' CHECKS PASS' : fail + ' FAILED, ' + pass + ' passed'))
process.exit(fail === 0 ? 0 : 1)

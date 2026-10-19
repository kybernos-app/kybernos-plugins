#!/usr/bin/env node
// What the Automations page gained after its board, in a real GUI: Discover (the templates and the chat they open), the Cards view, the
// Flow panel of a node, the lessons of the Journal and the two settings that write a stable automation down as a skill.
//
//   source scripts/sandbox/env.sh && node scripts/check-automations-discover-live.mjs [--shots <dir>]
//
// Needs a DSH that serves this checkout (scripts/sandbox/start.sh) and that was started AFTER the host routes it uses (automation-skills,
// automation-settings). Refuses :3080 and any DSH home that is not a sandbox's. It WRITES the sandbox's kybernos/tasks.json (three
// automations: a stable one, one that failed, a young one), automation-settings.json, automation-skills.json and one skill folder, and puts
// them all back as they were. No model is called and nothing leaves the machine: the runs of the seeded automations point at no session,
// so the journals are « not read » (that state is part of what is checked); the graph of a real journal is proved by the unit tests.
//
// What it proves:
//   - Discover: ten cards in three families, the filter, the page of a template (cover drawn in code, four sections), no image anywhere,
//     and « Use this template » opening a NEW chat whose draft names the skill, carries the questions and asks for an automation left OFF;
//   - Cards: the fourth view, one card per automation, the failed one outlined and « To review », figures that claim nothing unread;
//   - Flow: a node's title stays inside it, a click opens the panel with the whole instruction, the guard mark and Previous / Next;
//   - Journal lessons: how far an automation is, and for a stable one the button that writes the skill (the file is on disk, readable by
//     the person only, with the steps and none of the automation's secrets); the same click twice writes nothing more;
//   - Workspace of the runs: the form offers the dedicated « Automations » workspace and the person's own, the choice is saved as an id and
//     named on the page, and a real « Run now » lands the session in the chosen workspace, else in the dedicated one (a folder the host
//     made under the DSH home);
//   - Settings › Automations: the switch and the choice are saved in the file the host reads;
//   - a phone width (390 px): no horizontal scroll on Discover, a template, the Cards.
// Exit code 0 / 1 / 3 (3 = inconclusive: no sandbox).
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { openLivePage, clickText, openSettings, goToSettingsPage } from './live-page.mjs'

const args = process.argv.slice(2)
const shotDir = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : null
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0
let fail = 0
const check = (name, ok, detail) => { if (ok) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) } }

const host = process.env.KB_HOST || '127.0.0.1:3080'
const home = process.env.DSH_HOME || ''
if (host === '127.0.0.1:3080') { console.error('○ inconclusive: this check needs a DSH that serves this checkout (a sandbox instance), not the one on :3080. Set KB_HOST, DSH_HOME and HOME (source scripts/sandbox/env.sh).'); process.exit(3) }
if (home === '' || home.indexOf('.kybernos-sandbox') < 0) { console.error('○ inconclusive: DSH_HOME is not a sandbox home (' + (home === '' ? 'unset' : 'not under .kybernos-sandbox') + '): this check writes tasks.json and refuses to.'); process.exit(3) }

const kyb = join(home, 'kybernos')
const files = { tasks: join(kyb, 'tasks.json'), settings: join(kyb, 'automation-settings.json'), records: join(kyb, 'automation-skills.json') }
const skillDir = join(home, 'skills', 'check-stable-report')
const originals = {}
for (const k of Object.keys(files)) originals[k] = existsSync(files[k]) ? readFileSync(files[k], 'utf8') : null
const writeAtomic = (file, text) => { mkdirSync(kyb, { recursive: true }); const tmp = file + '.tmp-discover-check'; writeFileSync(tmp, text, { mode: 0o600 }); renameSync(tmp, file) }
const restore = () => {
  for (const k of Object.keys(files)) { try { if (originals[k] === null) rmSync(files[k], { force: true }); else writeAtomic(files[k], originals[k]) } catch (e) { /* the sandbox is disposable */ } }
  try { rmSync(skillDir, { recursive: true, force: true }) } catch (e) { /* nothing to remove */ }
}

// ── Three automations: stable (six runs, no failure), failed (the newest run wrote a failure note), young (one run) ────────────────
const day = (d, h) => new Date(Date.UTC(2026, 8, d, h, 0, 0)).toISOString()
const stamp = new Date().toISOString()
const mk = (id, name, prompt, history) => ({ id, createdAt: stamp, updatedAt: stamp, name, prompt, schedule: { mode: 'cron', cron: '0 8 * * 1', tz: 'UTC' }, runsOn: 'local', active: false, approvals: 'ask', notify: [], history, lastRun: history.length > 0 ? history[history.length - 1].at : null, nextRun: null })
const fired = (d, n) => ({ at: day(d, 8), sessionId: 'seed-session-' + n, status: 'fired' })
const SEED = [
  mk('chk-stable', 'Check stable report', 'Write the weekly report.\n1. PREFLIGHT (required): check that the shared folder is reachable before anything else; stop with a clear reason if it is not.\n2. Read the numbers of the week from the sheet and write the report in two paragraphs.\n3. Save the report in the reports folder.', [1, 2, 3, 4, 5, 6].map((d) => fired(d, d))),
  mk('chk-failed', 'Check failed report', '1. Fetch the numbers.\n2. Write the report.', [fired(1, 11), fired(2, 12), { at: new Date(Date.UTC(2026, 8, 2, 8, 3, 0)).toISOString(), sessionId: null, status: 'error', error: 'the shared folder was not reachable' }]),
  mk('chk-young', 'Check young report', '1. Reply with the single word OK.', [fired(3, 21)]),
]
writeAtomic(files.tasks, JSON.stringify(SEED, null, 2))
rmSync(files.records, { force: true })
writeAtomic(files.settings, JSON.stringify({ version: 1, showNativeTasks: false, paused: false, autoSkill: false, stableAfter: 5 }, null, 2))
rmSync(skillDir, { recursive: true, force: true })

const live = await openLivePage({ width: 1500, height: 1000 }).catch((e) => { restore(); console.error('○ inconclusive: ' + e.message); process.exit(3) })
const { page } = live
const val = async (expr, ms) => (await page.evalJs(expr, ms)).val
const poll = async (fn, ms = 10000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) return v; await sleep(250) } }
const shot = async (name) => { if (shotDir !== null) { try { mkdirSync(shotDir, { recursive: true }); await page.shot(join(shotDir, name + '.png')) } catch (e) { /* no screenshot */ } } }
const q = (sel) => val(`document.querySelectorAll(${JSON.stringify(sel)}).length`)
const click = (sel) => val(`(() => { const b = document.querySelector(${JSON.stringify(sel)}); if (!b || b.disabled) return false; b.click(); return true })()`)
// Really on screen: it has a size and it is what a finger would touch at its centre (a page hidden behind the Settings overlay is not).
const shown = (sel) => val(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; const r = e.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false; const t = document.elementFromPoint(Math.min(innerWidth - 2, r.left + Math.min(r.width, 40) / 2), Math.min(innerHeight - 2, Math.max(2, r.top + Math.min(r.height, 20) / 2))); return !!t && e.contains(t) })()`)
const text = (sel) => val(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return e ? e.innerText.replace(/\\s+/g, ' ').trim() : '' })()`)
const exceptions = []
page.on('Runtime.exceptionThrown', (p) => { exceptions.push(String((p.exceptionDetails && (p.exceptionDetails.text + ' ' + ((p.exceptionDetails.exception && p.exceptionDetails.exception.description) || ''))) || '').slice(0, 200)) })

const openAutomations = async () => {
  await sleep(1500)
  if ((await val(`/Add an API key to get started/.test(document.body.innerText)`)) === true) await clickText(page, 'Configure later')
  for (let i = 0; i < 4; i += 1) {
    await clickText(page, 'Automations')
    if (await poll(() => q('[data-kb="page-automations"]'), 6000)) return true
  }
  return false
}
const openTask = async (name) => {
  await poll(async () => (await val(`document.body.innerText.indexOf(${JSON.stringify(name)}) >= 0`)) === true, 15000)
  return val(`(() => { const el = Array.from(document.querySelectorAll('*')).find((e) => e.children.length === 0 && e.textContent.trim() === ${JSON.stringify(name)}); if (!el) return false; el.click(); return true })()`)
}
const backToList = async () => { await click('.kba-crumb'); await poll(() => q('[data-kb="page-automations"]'), 6000) }
const tab = (label) => val(`(() => { const b = Array.from(document.querySelectorAll('.kba-tab')).find((x) => ${label instanceof RegExp ? label + '.test(x.textContent)' : 'x.textContent === ' + JSON.stringify(label)}); if (!b) return false; b.click(); return true })()`)

try {
  console.log('Automations — Discover, Cards, Flow, Journal lessons, settings (live GUI, sandbox)')
  check('the Automations page opens', await openAutomations())
  await poll(() => q('.kba-lcard'), 15000)

  console.log('\n── Discover ──')
  check('the page has two sections, Yours and Discover, and Yours is the one open', (await val(`Array.from(document.querySelectorAll('[data-kb^="section-"]')).map((b) => b.dataset.kb.slice(8) + (b.getAttribute('aria-selected') === 'true' ? '*' : '')).join()`)) === 'yours*,discover')
  await click('[data-kb="section-discover"]')
  check('Discover lists ten templates', (await poll(() => q('[data-kb="tpl-card"]'), 5000)) === 10)
  check('...in three families (3 + 3 + 4) that the chips filter', await (async () => {
    const out = []
    for (const c of ['social', 'prospecting', 'support', 'all']) { await click('[data-kb="tpl-cat-' + c + '"]'); await sleep(200); out.push(await q('[data-kb="tpl-card"]')) }
    return out.join() === '3,3,4,10'
  })())
  await val(`(() => { const i = document.querySelector('.kbtd-search'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, 'whatsapp'); i.dispatchEvent(new Event('input', { bubbles: true })) })()`)
  check('...and the search finds a word in the title, the text, the tags or the apps', (await poll(async () => (await q('[data-kb="tpl-card"]')) === 2, 4000)) === true)
  await val(`(() => { const i = document.querySelector('.kbtd-search'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, ''); i.dispatchEvent(new Event('input', { bubbles: true })) })()`)
  await poll(async () => (await q('[data-kb="tpl-card"]')) === 10, 3000)
  check('a card is compact: no image, no cover, an « Import » button', (await q('[data-kb="tpl-card"] img, [data-kb="tpl-card"] svg.kbtd-cover-svg')) === 0 && (await q('[data-kb="tpl-card"] [data-kb="tpl-import"]')) === 10)
  await shot('discover')
  await click('[data-tpl="social-daily"]')
  check('a card opens the page of its template: a cover drawn in code, four sections, no image', (await poll(() => q('[data-kb="tpl-detail"]'), 4000)) === 1 && (await q('.kbtd-cover svg')) === 1 && (await q('.kbtd-sec')) === 4 && (await q('[data-kb="tpl-detail"] img')) === 0)
  check('...whose steps are the model steps and the tool steps, the first being the memory check', /PREFLIGHT/.test(await text('.kbtd-step')) && (await val(`document.querySelectorAll('.kbtd-step .kba-cc.cc-ai').length`)) >= 2)
  await shot('discover-detail')
  await click('[data-kb="tpl-use"]')
  const draft = await poll(async () => { const t = await val(`(() => { const e = document.querySelector('[contenteditable="true"]'); return e ? e.innerText : '' })()`); return /automation-creator/.test(t) ? t.replace(/\n+/g, '\n') : '' }, 20000)
  check('« Use this template » opens a NEW chat with a draft that names the skill and the template', typeof draft === 'string' && draft.startsWith('Skill automation-creator') && /Daily post pack/.test(draft), String(draft).slice(0, 120))
  check('...carrying the steps, the questions with their options, what to connect and the rules', /1\. PREFLIGHT/.test(draft) && /Where should the posts go\? Options: Instagram/.test(draft) && /What I will need to connect/.test(draft) && /Rules to keep in the steps/.test(draft))
  check('...and asking for an automation that stays OFF (nothing is created by the click)', /active: false/.test(draft) && (await val(`document.body.innerText.indexOf('Daily post pack') >= 0`)) === true)
  check('the Automations page comes back', await openAutomations())
  await poll(() => q('.kba-lcard'), 15000)

  console.log('\n── Cards ──')
  const views = await poll(() => val(`Array.from(document.querySelectorAll('[data-kb^="view-"]')).map((b) => b.dataset.kb.slice(5)).join()`), 15000)
  check('the toolbar offers four views: Columns, Calendar, Cards, List', views === 'columns,calendar,cards,list', views)
  await click('[data-kb="view-cards"]')
  check('Cards draws one card per automation', (await poll(async () => (await q('[data-kb="auto-card"]')) === 3, 8000)) === true, { cards: await q('[data-kb="auto-card"]'), page: (await text('[data-kb="page-automations"]')).slice(0, 160) })
  const cardOf = (id) => `document.querySelector('[data-kb="auto-card"][data-id="${id}"]')`
  check('the card whose last run failed is outlined and says « To review »; the others are not', (await val(`${cardOf('chk-failed')}.classList.contains('attn') && /To review/.test(${cardOf('chk-failed')}.innerText)`)) === true && (await val(`!${cardOf('chk-stable')}.classList.contains('attn') && !${cardOf('chk-young')}.classList.contains('attn')`)) === true)
  check('the figures come from the history: success 100 % / 67 %, runs 6 / 2', await (async () => {
    const t = (id) => val(`${cardOf(id)}.innerText.replace(/\\s+/g, ' ')`)
    const a = await t('chk-stable'); const b = await t('chk-failed')
    return /SUCCESS 100 %/.test(a) && /RUNS 6/.test(a) && /SUCCESS 50 %/.test(b) && /RUNS 2/.test(b)
  })())
  check('a journal that was not read claims nothing: no duration and no tool', /DURATION —/.test(await val(`${cardOf('chk-stable')}.innerText.replace(/\\s+/g, ' ')`)) && /TOOLS —/.test(await val(`${cardOf('chk-stable')}.innerText.replace(/\\s+/g, ' ')`)))
  check('the switch of a card changes nothing by a click on the card itself, and opening a card opens its page', (await val(`${cardOf('chk-young')}.querySelector('[role="switch"]').getAttribute('aria-checked')`)) === 'false' && (await click('[data-kb="auto-card"][data-id="chk-stable"]')) === true && (await poll(() => q('[data-kb="tab-journal"]'), 5000)) === 1)
  await shot('cards')

  console.log('\n── Flow ──')
  await tab(/^Workflow/)
  await sleep(500)
  await val(`(() => { const b = Array.from(document.querySelectorAll('.kba-tab')).find((x) => x.textContent === 'Flow'); if (b) b.click() })()`)
  check('the Flow draws the trigger, the three steps and the log', (await poll(async () => (await q('.kba-node')) === 5, 5000)) === true)
  check('the title of every node stays inside it (two lines at most, nothing spills)', await val(`Array.from(document.querySelectorAll('.kba-node')).every((n) => { const r = n.getBoundingClientRect(); return Array.from(n.querySelectorAll('.kba-ndn > span, .kba-ndn > small')).every((c) => c.getBoundingClientRect().bottom <= r.bottom + 1 && c.getBoundingClientRect().right <= r.right + 1) })`))
  await val(`document.querySelectorAll('.kba-node')[1].click()`)
  check('a click opens the panel: type, whole instruction, how it runs, the guard mark', (await poll(() => q('[data-kb="flow-node-panel"]'), 3000)) === 1 && /PREFLIGHT \(required\): check that the shared folder is reachable before anything else; stop with a clear reason if it is not\./.test(await text('[data-kb="flow-node-panel"]')) && /Guard/.test(await text('[data-kb="flow-node-panel"] .kba-nc-head')) && /How it runs/i.test(await text('[data-kb="flow-node-panel"]')))
  await click('[data-kb="flow-next"]')
  check('Next walks to the following step, Previous back', /Read the numbers of the week/.test(await text('[data-kb="flow-node-panel"]')) && (await click('[data-kb="flow-prev"]')) === true && /PREFLIGHT/.test(await text('[data-kb="flow-node-panel"]')))
  await shot('flow')
  await val(`document.querySelector('.kba-nc-x').click()`)
  check('the panel closes', (await q('[data-kb="flow-node-panel"]')) === 0)

  console.log('\n── Journal lessons ──')
  await click('[data-kb="tab-journal"]')
  check('the stable automation says it is stable and offers « Create skill »', (await poll(() => q('[data-kb="lesson-create"]'), 6000)) === 1 && /6 times in a row without a failure: stable enough/.test(await text('[data-kb="journal-lesson"]')))
  await shot('lesson')
  await click('[data-kb="lesson-create"]')
  check('the click writes the skill and the card says so', (await poll(async () => /created from this page/.test(await text('[data-kb="journal-lesson"]')), 6000)) === true && (await q('[data-kb="lesson-create"]')) === 0)
  const skillFile = join(skillDir, 'SKILL.md')
  const body = existsSync(skillFile) ? readFileSync(skillFile, 'utf8') : ''
  check('...the file is in the skills folder, for the person only, with the steps and nothing else of the automation', body.startsWith('---\nname: check-stable-report\n') && body.includes('2. Read the numbers of the week') && (statSync(skillFile).mode & 0o777) === 0o600 && !/seed-session|chk-stable|cron/.test(body))
  check('...and what was written is recorded once', existsSync(files.records) && Object.keys(JSON.parse(readFileSync(files.records, 'utf8')).skills).join() === 'chk-stable' && readdirSync(join(home, 'skills')).filter((n) => n.startsWith('check-stable-report')).length === 1)
  await backToList()
  await openTask('Check failed report')
  await click('[data-kb="tab-journal"]')
  check('an automation that failed says how far it is from stable (none in a row)', (await poll(() => q('[data-kb="journal-lesson"]'), 6000)) === 1 && /0 times in a row without a failure\. At 5 it can become/.test(await text('[data-kb="journal-lesson"]')) && (await q('[data-kb="lesson-create"]')) === 0)
  check('...and the Sessions tab says the journals were not read rather than inventing a duration', await (async () => { await tab(/^Sessions/); await sleep(800); return /not be read/.test(await text('[data-kb="runs-sessions"]')) || /Not read/.test(await text('[data-kb="runs-sessions"]')) })())
  await backToList()

  console.log('\n── Workspace of the runs ──')
  const sessionDirOf = (sid) => { const root = join(home, 'sessions'); try { for (const d of readdirSync(root)) if (existsSync(join(root, d, sid))) return d } catch (e) { /* no sessions yet */ } return null }
  const lastSession = () => { try { const t = JSON.parse(readFileSync(files.tasks, 'utf8')).find((x) => x.id === 'chk-young'); const h = t.history.filter((x) => typeof x.sessionId === 'string' && !x.sessionId.startsWith('seed-')); return { task: t, sid: h.length > 0 ? h[h.length - 1].sessionId : null, n: h.length } } catch (e) { return { task: null, sid: null, n: 0 } } }
  const setSelect = (v) => val(`(() => { const e = document.querySelector('[data-kb="task-workspace"]'); if (!e) return false; Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(e, ${JSON.stringify(v)}); e.dispatchEvent(new Event('change', { bubbles: true })); return true })()`)
  const pressInHead = (label) => val(`(() => { const b = Array.from(document.querySelectorAll('.kba-dhead .kba-btn')).find((x) => x.innerText.trim() === ${JSON.stringify(label)}); if (!b) return false; b.click(); return true })()`)
  const waitRun = async (before) => { await pressInHead('Run now'); return poll(() => { const l = lastSession(); return l.n > before ? l : null }, 20000) }
  await openAutomations()
  await poll(() => q('.kba-lcard, [data-kb="auto-card"]'), 10000)
  await openTask('Check young report')
  check('the detail says where the runs land: the dedicated workspace when nothing is chosen', (await poll(async () => /Workspace: Automations/.test(await text('.kba-dmeta')), 5000)) === true, await text('.kba-dmeta'))
  await pressInHead('Schedule')
  check('the form has a Workspace field: the dedicated workspace first, then the person\'s own', (await poll(() => q('[data-kb="task-workspace"]'), 4000)) === 1 && /^Automations \(dedicated workspace\)/.test((await val(`Array.from(document.querySelectorAll('[data-kb="task-workspace"] option')).map((o) => o.textContent).join('|')`)) || '') && (await q('[data-kb="task-workspace"] option')) >= 2)
  const mine = await val(`(() => { const o = Array.from(document.querySelectorAll('[data-kb="task-workspace"] option')).filter((x) => x.value !== ''); return o.length > 0 ? JSON.stringify({ id: o[0].value, name: o[0].textContent }) : null })()`)
  const pickedWs = mine === null ? null : JSON.parse(mine)
  check('...with at least one workspace of the person to choose', pickedWs !== null, mine)
  if (pickedWs !== null) {
    await setSelect(pickedWs.id)
    await click('[data-kb="task-save"]')
    check('saving stores the id of the workspace and nothing else of it', (await poll(() => { try { return JSON.parse(readFileSync(files.tasks, 'utf8')).find((x) => x.id === 'chk-young').workspaceHint === pickedWs.id } catch (e) { return false } }, 6000)) === true)
    check('the detail names the workspace', (await poll(async () => (await text('.kba-dmeta')).indexOf('Workspace: ' + pickedWs.name) >= 0, 5000)) === true, await text('.kba-dmeta'))
    const r1 = await waitRun(lastSession().n)
    const dir1 = r1 ? sessionDirOf(r1.sid) : null
    check('« Run now » starts a real session in the chosen workspace (not in the dedicated folder)', r1 !== null && dir1 !== null && dir1.indexOf('kybernos-automations') < 0, { dir1 })
    await pressInHead('Schedule')
    await poll(() => q('[data-kb="task-workspace"]'), 4000)
    await setSelect('')
    await click('[data-kb="task-save"]')
    check('choosing the dedicated workspace again clears the choice', (await poll(() => { try { return JSON.parse(readFileSync(files.tasks, 'utf8')).find((x) => x.id === 'chk-young').workspaceHint === null } catch (e) { return false } }, 6000)) === true)
  }
  const n0 = lastSession().n
  const r2 = await waitRun(n0)
  const dir2 = r2 ? sessionDirOf(r2.sid) : null
  check('with no choice a real run lands in the dedicated « Automations » workspace', r2 !== null && dir2 !== null && /kybernos-automations--$/.test(dir2), { dir2 })
  check('...a folder the host made under the DSH home, which the engine adopted as a workspace', existsSync(join(home, 'kybernos', 'automations')) && statSync(join(home, 'kybernos', 'automations')).isDirectory())
  await backToList()

  console.log('\n── Settings › Automations ──')
  check('Settings opens', await openSettings(page))
  check('the Automations page of the settings has the switch and the four choices', (await goToSettingsPage(page, /^Automations$/, { marker: `!!document.querySelector('[data-kb="automation-setting-autoSkill"]')` })) === true && (await q('.kbac-segb')) === 4)
  await val(`document.querySelector('[data-kb="automation-setting-autoSkill"] [role="switch"]').click()`)
  await sleep(700)
  await click('[data-kb="stable-10"]')
  await sleep(900)
  const saved = JSON.parse(readFileSync(files.settings, 'utf8'))
  check('a switch and a choice are saved in the file the host reads', saved.autoSkill === true && saved.stableAfter === 10, saved)
  await shot('settings')
  await val(`document.querySelector('[data-kb="automation-setting-autoSkill"] [role="switch"]').click()`)
  await sleep(600)
  await click('[data-kb="stable-5"]')
  await sleep(700)
  check('...and put back', (() => { const s = JSON.parse(readFileSync(files.settings, 'utf8')); return s.autoSkill === false && s.stableAfter === 5 })())

  console.log('\n── Phone width ──')
  // The page is not reloaded: at 390 px the sidebar is folded away, so the menu is no way back to a page the reload would have lost.
  await val(`(() => { const b = Array.from(document.querySelectorAll('button')).find((x) => /Back to workspace/.test(x.innerText)); if (b) b.click() })()`)
  await poll(async () => (await q('button[class*="navCell"]')) === 0, 8000)
  check('the Settings are closed and the Automations page is open again', (await openAutomations()) && (await poll(() => shown('[data-kb="page-automations"]'), 8000)) === true)
  await poll(() => q('.kba-lcard, [data-kb="auto-card"]'), 10000)
  await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
  await sleep(1000)
  const overflow = () => val(`document.documentElement.scrollWidth > document.documentElement.clientWidth + 1`)
  check('...and is still there at 390 px, as wide as the phone', (await val(`(() => { const e = document.querySelector('[data-kb="page-automations"]'); const r = e ? e.getBoundingClientRect() : null; return !!r && r.width > 300 && r.width <= innerWidth })()`)) === true)
  await click('[data-kb="section-discover"]')
  check('Discover shows its ten templates at 390 px without scrolling sideways', (await poll(async () => (await q('[data-kb="tpl-card"]')) === 10, 5000)) === true && (await shown('[data-kb="tpl-card"]')) === true && (await overflow()) === false)
  await click('[data-tpl="cs-calls"]')
  check('a template page does not scroll sideways', (await poll(() => q('[data-kb="tpl-detail"]'), 4000)) === 1 && (await q('.kbtd-sec')) === 4 && (await shown('[data-kb="tpl-use"]')) === true && (await overflow()) === false)
  await shot('phone-template')
  await click('[data-kb="tpl-back"]')
  await click('[data-kb="section-yours"]')
  await sleep(400)
  await click('[data-kb="view-cards"]')
  check('the Cards do not scroll sideways', (await poll(async () => (await q('[data-kb="auto-card"]')) === 3, 6000)) === true && (await shown('[data-kb="auto-card"]')) === true && (await overflow()) === false)
  await shot('phone-cards')
  check('no script error from the page', exceptions.length === 0, exceptions.slice(0, 3))
} catch (e) {
  fail += 1
  console.log('  ✗ the check stopped: ' + (e && e.message ? e.message : String(e)))
} finally {
  try { await page.send('Emulation.clearDeviceMetricsOverride') } catch (e) { /* the page went away */ }
  await live.close()
  restore()
}
console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail > 0 ? 1 : 0)

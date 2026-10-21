// Skills learned from experience, V2, on the REAL GUI of a SANDBOX: a task that comes back is noticed under a finished answer, the weekly card on a blank chat,
// « ready to share » on the Skills page, and the three new cards of Settings › Learned skills.
//
//   source scripts/sandbox/env.sh && node scripts/check-skills-learned-v2-live.mjs [--shots <dir>]
//
// Sandbox only (it refuses :3080, exit 3): it writes three synthetic chats, a few skills and the learned-skills files, all in the sandbox's own DSH home, and
// clears them at the start and the end. The sandbox serves THIS checkout (docs/dev/live-testing.md); host changes need a stop/start of the sandbox. A real
// conversation is created through the GUI (no model there, so its turn fails before anything is journaled: the person's message is then appended to its
// journal the way DSH writes one, so that the chat index has the ask).
// NOT covered: a model writing the skill after the click (the unit tests play skill_propose), and the Team sheet (the sandbox has no team).
//
// Exit 0 all good, 1 a check failed, 3 not run (no GUI, not a sandbox).
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import zlib from 'node:zlib'
import { openLivePage, waitFor, clickText, openSettings, goToSettingsPage, ensureConversation } from './live-page.mjs'

const authority = process.env.KB_HOST || '127.0.0.1:3080'
if (authority === '127.0.0.1:3080' || !process.env.DSH_HOME) { console.error('○ not run: sandbox only (source scripts/sandbox/env.sh first); it writes chats, skills and settings'); process.exit(3) }
const dsh = process.env.DSH_HOME
if (/\/\.dsh$/.test(dsh) && dsh === join(process.env.KB_REAL_HOME || '', '.dsh')) { console.error('○ not run: DSH_HOME is the real home'); process.exit(3) }
if (typeof zlib.zstdCompressSync !== 'function') { console.error('○ not run: this Node cannot write the zstd journals the chat index reads'); process.exit(3) }
const learned = await import('../packages/kybernos-skills/learned.mjs')

const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null
if (shotsDir !== null) mkdirSync(shotsDir, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const DAY = 24 * 3600 * 1000
let pass = 0
const failures = []
const check = (label, cond, detail) => {
  if (cond === true) { pass += 1; console.log('  ✓ ' + label) } else { failures.push(label); console.log('  ✗ ' + label + (detail === undefined ? '' : '  — ' + JSON.stringify(detail).slice(0, 300))) }
}

const FILES = ['skills-learned.json', 'skills-learned.audit.jsonl', 'skills-learned-settings.json', 'skills-learned-sessions.json', 'skills-learned-notices.json']
const SKILLS = ['live-weekly-report', 'live-forgotten-one', 'live-auto-made']
const OLD = ['live-old-1', 'live-old-2', 'live-old-3']
const ASK = 'Write the release notes from the commits since the last tag, grouped by feature.'
const clean = () => {
  for (const f of FILES) rmSync(join(dsh, 'kybernos', f), { force: true })
  rmSync(join(dsh, 'kybernos', 'skills-learned-versions'), { recursive: true, force: true })
  for (const n of SKILLS) rmSync(join(dsh, 'skills', n), { recursive: true, force: true })
  rmSync(join(dsh, 'sessions', '--live-v2-check--'), { recursive: true, force: true })
  rmSync(join(dsh, 'kybernos', 'search', 'chats.v1.json'), { force: true })
}
clean()
// three earlier chats of the person, on three different days, with the same kind of ask
const journal = (id, createdAt, text) => [
  { type: 'session', id, cwd: '/work/app', createdAt, time: createdAt },
  { type: 'session/title', time: createdAt, data: { title: 'Release notes' } },
  { type: 'user/message', time: createdAt + 1000, data: { content: text, source: { kind: 'user' } } },
  { type: 'assistant/message', time: createdAt + 2000, data: { message: { content: [{ type: 'text', text: 'Here they are.' }] } } }
].map((e) => JSON.stringify(e)).join('\n') + '\n'
const writeChat = (id, daysAgo, text) => {
  const dir = join(dsh, 'sessions', '--live-v2-check--', id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'session.v4.jsonl.zstd'), zlib.zstdCompressSync(Buffer.from(journal(id, Date.now() - daysAgo * DAY, text))))
}
writeChat(OLD[0], 18, 'Write release notes from the commits since the last tag, group them by feature.')
writeChat(OLD[1], 12, 'Please write the release notes from the commits since last tag, grouped by feature')
writeChat(OLD[2], 7, 'Release notes from the commits since the last tag, grouped by feature, please.')

const live = await openLivePage({ width: 1500, height: 950 }).catch((e) => { console.error('○ not run: ' + e.message); process.exit(3) })
const { page } = live
const errors = []
const ev = async (js) => { const r = await page.evalJs(js, 10000); return r.err ? null : r.val }
const shot = async (name) => { if (shotsDir !== null) await page.shot(join(shotsDir, name + '.png')) }
const count = (sel) => ev(`document.querySelectorAll(${JSON.stringify(sel)}).length`)
const text = (sel) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return e ? e.textContent.replace(/\\s+/g, ' ').trim() : null })()`)
const post = (path, body) => ev(`fetch(${JSON.stringify(path)}, { method: 'POST', headers: { 'content-type': 'application/json' }, body: ${JSON.stringify(JSON.stringify(body))} }).then((r) => r.json()).catch(() => null)`)
const get = (path) => ev(`fetch(${JSON.stringify(path)}).then((r) => r.json()).catch(() => null)`)
const pressDom = (sel) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; e.scrollIntoView({ block: 'center' }); e.click(); return true })()`)

try {
  await page.send('Runtime.enable', {})
  page.on('Runtime.exceptionThrown', (p) => errors.push(String((p.exceptionDetails && p.exceptionDetails.exception && p.exceptionDetails.exception.description) || 'exception').slice(0, 200)))
  await waitFor(page, `document.readyState === 'complete'`, 15000)
  await sleep(2500)

  console.log('the host (what the page must agree with)')
  const st = await get('/kybernos-skills/learned/settings')
  check('the V2 settings are served with their defaults (restart the sandbox after host changes)', st !== null && st.ok === true && st.settings.notice === true && st.settings.minRep === 3 && st.settings.win === 60 && st.settings.week === true && st.settings.team === true && st.settings.teamMin === 3 && st.settings.teamPriv === false, st)
  if (st === null || st.ok !== true || st.settings.notice === undefined) { await live.close(); clean(); process.exit(3) }
  const nl = await get('/kybernos-skills/learned/notice/list')
  check('the list of answered patterns is empty, and the host knows whether Search everywhere gave it the chat index', nl !== null && nl.ok === true && nl.patterns.length === 0 && nl.index === true, nl)
  await post('/kybernos-search/start', {})
  let ready = false
  for (let i = 0; i < 30 && !ready; i += 1) { const s = await get('/kybernos-search/status'); ready = s !== null && s.state === 'ready' && s.chats >= 3; if (!ready) await sleep(500) }
  check('Search everywhere indexed the three earlier chats', ready === true)

  console.log('a task that comes back, noticed under a finished answer')
  check('a real conversation is created by the GUI, with the same kind of ask', (await ensureConversation(page, { text: ASK })) === true)
  await sleep(2500)
  const sid = await ev(`(() => { const rows = Array.from(document.querySelectorAll('[data-row-key^="session:"]')); const r = rows.find((x) => x.textContent.indexOf('release') >= 0 || x.textContent.indexOf('Write the') >= 0) || rows[0]; return r ? r.getAttribute('data-row-key').slice(8) : null })()`)
  check('the session has an id', typeof sid === 'string' && sid.length > 0, sid)
  // no model in the sandbox, so DSH never journals the message of a turn that fails: it is added as DSH writes one (one more zstd frame)
  let jfile = null
  for (const slug of readdirSync(join(dsh, 'sessions'))) { const f = join(dsh, 'sessions', slug, sid, 'session.v4.jsonl.zstd'); if (existsSync(f)) jfile = f }
  check('the journal of that session is on disk', jfile !== null, sid)
  if (jfile !== null) appendFileSync(jfile, zlib.zstdCompressSync(Buffer.from(JSON.stringify({ type: 'user/message', time: Date.now(), data: { content: ASK, source: { kind: 'user' } } }) + '\n')))
  let notice = null
  for (let i = 0; i < 12 && (notice === null || notice.notice === null); i += 1) { notice = await get('/kybernos-skills/learned/notice?sessionId=' + encodeURIComponent(sid)); if (notice === null || notice.notice === null) await sleep(1500) }
  check('the host notices it: the 4th chat (or later) with that ask, on 4 days at least, named by three words', notice !== null && notice.ok === true && notice.notice !== null && notice.notice.n >= 4 && notice.notice.dates.length >= 4 && typeof notice.notice.label === 'string', notice)
  const state = JSON.parse(readFileSync(join(dsh, 'kybernos', 'skills-learned-notices.json'), 'utf8'))
  check('what it keeps is the answer state and counts: the pattern, its number, a few words (nothing else of the chat)', Object.keys(state.patterns).length === 1 && state.shown.length === 1 && !JSON.stringify(state).includes('release notes from'), state)
  // NOT checked live: the card under a finished answer. With no model the turn of this chat never completes, so DSH still calls the session « blank » (measured:
  // `session.blank` stays true) and the card, which only speaks in a chat that has begun, is not drawn. The unit tests play it (test-ui.mjs).
  console.log('  ○ the card under a finished answer needs a model turn: not checked live (see test-ui.mjs)')
  const yes = await post('/kybernos-skills/learned/notice/answer', { id: notice.notice.id, answer: 'yes' })
  const after = JSON.parse(readFileSync(join(dsh, 'kybernos', 'skills-learned-notices.json'), 'utf8'))
  check('the answer « yes » is kept by the host: the pattern is quiet for 30 days', yes !== null && yes.ok === true && Object.values(after.patterns).some((p) => p.state === 'done'), after.patterns)
  const quiet = await get('/kybernos-skills/learned/notice?sessionId=' + encodeURIComponent(sid))
  check('and it does not speak again for that chat', quiet !== null && quiet.notice === null, quiet)
  check('the dock card is mounted without drawing anything in a chat that has not begun', (await count('[data-kb="learned-notice"]')) === 0)

  console.log('the weekly card on a blank chat, and ready to share')
  const mk = async (name, uses, daysAgo, by) => {
    const made = await learned.proposeFromAutomation({ dsh, name, description: 'Does a thing. Use when asked for ' + name + '.', whenToUse: '', body: '# ' + name + '\n\nRead the files.', automation: { id: 't-' + name, runs: 5 }, acceptNow: true, now: Date.now() - 40 * DAY, existing: [] })
    for (let i = 0; i < uses; i += 1) await learned.recordUse({ dsh, name: made.name, sessionId: name + '-chat-' + String(i), now: Date.now() - daysAgo * DAY + i * 1000 })
    return made
  }
  await mk(SKILLS[0], 3, 2)
  await mk(SKILLS[1], 1, 41)
  learned.appendAudit(dsh, { act: 'created', skill: SKILLS[2], by: 'kaby', mode: 'auto', kind: 'auto', ver: 1, score: 91, sig: [] }, Date.now() - DAY)
  // a blank chat
  await clickText(page, 'New chat').catch(() => null)
  await waitFor(page, `!!document.querySelector('[data-kb="learned-week"]')`, 15000)
  await sleep(600)
  await shot('03-week')
  const wtxt = (await text('[data-kb="learned-week"]')) || ''
  check('the card is on the home of the blank chat, with the week, the numbers and the rows', /What Kaby learned this week/.test(wtxt) && /skills accepted/.test(wtxt) && /has not been used for 4\d days/.test(wtxt) && /Propose it to your team\?/.test(wtxt), wtxt.slice(0, 400))
  await pressDom('[data-kb="learned-week-keep"]')
  await sleep(1000)
  const kept = (await get('/kybernos-skills/learned')).learned.find((l) => l.name === SKILLS[1])
  check('Keep starts the clock over for the skill nobody used, and the row goes', kept !== undefined && kept.unusedDays === 0 && (await count('[data-kb="learned-week-keep"]')) === 0, kept)
  await pressDom('[data-kb="learned-week-hide"]')
  await sleep(800)
  const wh = await get('/kybernos-skills/learned/week?sessionId=another-blank-chat')
  check('Hide: the card says it is back next week, and the host does not offer it again this week', /hidden until next week/.test((await text('[data-kb="learned-week-hidden"]')) || '') && wh !== null && wh.show === false && wh.why === 'hidden', wh)

  await clickText(page, 'Skills')
  await waitFor(page, `!!document.querySelector('.kbsub-group [role=tab]')`, 20000)
  for (let i = 0; i < 40; i += 1) {
    const on = await ev(`(() => { const t = Array.from(document.querySelectorAll('.kbsub-group [role=tab]')).find((b) => /^Yours/.test(b.innerText.trim())); if (!t) return false; if (t.getAttribute('aria-selected') !== 'true') t.click(); return t.getAttribute('aria-selected') === 'true' })()`)
    if (on === true) break
    await sleep(250)
  }
  await waitFor(page, `!!document.querySelector('[data-kb="learned-ready"]')`, 15000)
  await shot('04-ready')
  const readyCard = await ev(`(() => { const c = Array.from(document.querySelectorAll('[data-kb^="skill-card-"]')).find((e) => e.textContent.includes(${JSON.stringify(SKILLS[0])})); return c ? { ready: ((c.querySelector('[data-kb="learned-ready"]') || {}).textContent || ''), badge: !!c.querySelector('[data-kb="learned-badge"]') } : null })()`)
  check('the skill used in 3 chats wears « ready to share », the others do not', readyCard !== null && /ready to share/.test(readyCard.ready) && (await count('[data-kb="learned-ready"]')) === 1, readyCard)
  await ev(`(() => { const c = Array.from(document.querySelectorAll('[data-kb^="skill-card-"]')).find((e) => e.textContent.includes(${JSON.stringify(SKILLS[0])})); if (c) c.click() })()`)
  await waitFor(page, `!!document.querySelector('[data-kb="learned-share"]')`, 10000)
  const sh = (await text('[data-kb="learned-share"]')) || ''
  check('its panel offers the proposal: how many chats used it, what leaves, and the button', /Share with your team/.test(sh) && /Used in 3 chats/.test(sh) && (await count('[data-kb="learned-share-btn"]')) === 1, sh.slice(0, 300))
  await pressDom('[data-kb="learned-share-btn"]')
  await sleep(1000)
  check('this sandbox has no team: the button says so instead of opening a sheet', /No team on this account/.test(await ev('document.body.innerText') || ''))

  console.log('Settings › Learned skills')
  if ((await openSettings(page, { minCells: 0 })) !== true) { console.error('○ not run: the Settings dialog did not open'); await live.close(); clean(); process.exit(3) }
  const there = await goToSettingsPage(page, 'Learned skills', { marker: `!!document.querySelector('[data-kb="learned-repeat-card"]')` })
  check('the page opens with the three new cards', there === true && (await count('[data-kb="learned-week-card"]')) === 1 && (await count('[data-kb="learned-team-card"]')) === 1)
  await sleep(600)
  await shot('05-settings')
  check('what the person answered is listed (the pattern of this check), with its three words', (await count('[data-kb="pattern-row"]')) === 1 && /commits/.test((await text('[data-kb="learned-patterns"]')) || ''), await text('[data-kb="learned-patterns"]'))
  await ev(`(() => { const e = document.querySelector('[data-kb="learned-notice-on"]'); e.scrollIntoView({ block: 'center' }); e.click() })()`)
  await sleep(900)
  const s2 = await get('/kybernos-skills/learned/settings')
  check('the switch saves at once', s2 !== null && s2.settings.notice === false, s2)
  await ev(`(() => { const el = document.getElementById('kbl-minrep'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, '5'); el.dispatchEvent(new Event('change', { bubbles: true })) })()`)
  await sleep(900)
  const s3 = await get('/kybernos-skills/learned/settings')
  check('the choice saves as a number', s3 !== null && s3.settings.minRep === 5, s3)
  await ev(`(() => { const b = document.querySelector('[data-kb="pattern-forget"]'); if (b) b.click() })()`)
  await sleep(900)
  check('Forget removes the pattern from the host and from the list', (await get('/kybernos-skills/learned/notice/list')).patterns.length === 0 && (await count('[data-kb="pattern-row"]')) === 0)
  const jr = (await get('/kybernos-skills/learned/journal')).entries.map((e) => e.act)
  check('the journal still verifies, and the settings changes are in it', (await get('/kybernos-skills/learned/journal')).verified === true && jr.filter((a) => a === 'settings').length >= 2, jr)
  check('the page raised no error', errors.length === 0, errors)
} catch (e) {
  failures.push('the check itself threw: ' + String((e && e.message) || e))
  console.log('  ✗ ' + String((e && e.stack) || e).slice(0, 600))
} finally {
  clean()
  await live.close()
}
console.log('\n' + String(pass) + ' ✓, ' + String(failures.length) + ' ✗')
process.exit(failures.length === 0 ? 0 : 1)

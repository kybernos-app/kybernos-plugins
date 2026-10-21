// Skills learned from experience, V1, on the REAL GUI of a SANDBOX: what Kaby does ON ITS OWN. The level and the line are set through the real
// settings route, a stable automation is handed to the host (the host half of the seam, called on the sandbox's own home: no automation has to run),
// and the page the person sees must say it: the menu dot, the banner « Kaby changed N skills on its own », the chip, the journal with its Undo, Keep,
// the Settings › Learned skills page (levels, line, preview) and the kill switch.
//
//   source scripts/sandbox/env.sh && node scripts/check-skills-learned-auto-live.mjs [--shots <dir>]
//
// Sandbox only (it refuses :3080, exit 3): it writes settings, skills and a journal, all in the sandbox's own DSH home, and starts by clearing the
// learned-skills files of that home so that it can be run twice. The sandbox serves THIS checkout (docs/dev/live-testing.md); host changes need a
// stop/start of the sandbox. NOT covered here: the card at the end of a chat answer and the agent tools (they need a model turn; the unit tests play them).
//
// Exit 0 all good, 1 a check failed, 3 not run (no GUI, not a sandbox).
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { openLivePage, waitFor, clickText, openSettings, goToSettingsPage } from './live-page.mjs'

const authority = process.env.KB_HOST || '127.0.0.1:3080'
if (authority === '127.0.0.1:3080' || !process.env.DSH_HOME) { console.error('○ not run: sandbox only (source scripts/sandbox/env.sh first); it writes settings and skills'); process.exit(3) }
const dsh = process.env.DSH_HOME
if (/\/\.dsh$/.test(dsh) && dsh === join(process.env.KB_REAL_HOME || '', '.dsh')) { console.error('○ not run: DSH_HOME is the real home'); process.exit(3) }
const learned = await import('../packages/kybernos-skills/learned.mjs')

const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null
if (shotsDir !== null) mkdirSync(shotsDir, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0
const failures = []
const check = (label, cond, detail) => {
  if (cond === true) { pass += 1; console.log('  ✓ ' + label) } else { failures.push(label); console.log('  ✗ ' + label + (detail === undefined ? '' : '  — ' + JSON.stringify(detail).slice(0, 300))) }
}

const NAMES = ['live-auto-collector', 'live-auto-second']
for (const f of ['skills-learned.json', 'skills-learned.audit.jsonl', 'skills-learned-settings.json', 'skills-learned-sessions.json']) rmSync(join(dsh, 'kybernos', f), { force: true })
rmSync(join(dsh, 'kybernos', 'skills-learned-versions'), { recursive: true, force: true })
for (const n of NAMES) rmSync(join(dsh, 'skills', n), { recursive: true, force: true })

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
const dotLabel = () => ev(`(() => { const d = document.querySelector('[data-kb="learned-dot"]'); return d ? d.getAttribute('aria-label') : '' })()`)
const handOver = (name, runs) => learned.proposeFromAutomation({ dsh, name, description: 'Collects the store orders each night. Use when asked for the nightly collection.', whenToUse: '', body: '# Collector\n\nRead the new orders and list them.', automation: { id: 't-' + name, name: 'Nightly collector', runs }, existing: [] })

try {
  await page.send('Runtime.enable', {})
  page.on('Runtime.exceptionThrown', (p) => errors.push(String((p.exceptionDetails && p.exceptionDetails.exception && p.exceptionDetails.exception.description) || 'exception').slice(0, 200)))
  await waitFor(page, `document.readyState === 'complete'`, 15000)
  await sleep(2500)

  console.log('the host (what the page must agree with)')
  const fresh = await get('/kybernos-skills/learned/settings')
  check('the settings route answers on this instance (restart the sandbox after host changes)', fresh !== null && fresh.ok === true, fresh)
  if (fresh === null || fresh.ok !== true) { await live.close(); process.exit(3) }
  const s0 = fresh.settings || fresh
  check('a fresh instance asks the person every time, with a line of 90 and 3 changes a week', s0.mode === 'ask' && s0.threshold === 90 && s0.cap === 3, s0)
  const refused = await post('/kybernos-skills/learned/settings/set', { mode: 'sudo' })
  check('a bad value is refused as a whole', refused !== null && refused.ok === false && refused.error === 'bad_settings', refused)

  console.log('Kaby only suggests while the level is « Ask me »')
  const asked = await handOver(NAMES[0], 5)
  check('a stable automation waits as a suggestion: nothing is written to the skills folder', asked.ok === true && asked.pending === true && !existsSync(join(dsh, 'skills', NAMES[0])), asked)
  const wait = await get('/kybernos-skills/learned')
  check('the suggestion carries a score and says why it waits (« asks »)', wait.proposals.length === 1 && wait.proposals[0].score.total >= 70 && wait.proposals[0].stops.includes('asks'), wait.proposals.map((p) => [p.score, p.stops]))
  await post('/kybernos-skills/learned/discard', { id: wait.proposals[0].id })

  console.log('the person lets Kaby create skills above a line of 70')
  const lvl = await post('/kybernos-skills/learned/settings/set', { mode: 'auto' })
  const line = await post('/kybernos-skills/learned/settings/set', { threshold: 70 })
  check('the level and the line are saved', lvl !== null && lvl.ok === true && line !== null && line.ok === true, [lvl, line])
  const made = await handOver(NAMES[0], 5)
  const file = join(dsh, 'skills', NAMES[0], 'SKILL.md')
  check('the same automation is now applied by Kaby: the skill is written, as a normal skill with the standard rules', made.ok === true && made.auto === true && existsSync(file) && /## Rules\n\n- Speak the user’s languag/.test(readFileSync(file, 'utf8')), made)
  const lines = readFileSync(join(dsh, 'kybernos', 'skills-learned.audit.jsonl'), 'utf8').split('\n').filter((l) => l !== '').map((l) => JSON.parse(l))
  const created = lines.filter((l) => l.act === 'created')
  check('the journal says « created », by Kaby, automatic, with its score and the parts of it', created.length === 1 && created[0].by === 'kaby' && created[0].mode === 'auto' && typeof created[0].score === 'number' && Array.isArray(created[0].sig) && created[0].sig.length === 6, created)

  console.log('the pages')
  await page.send('Page.reload', { ignoreCache: true })
  await waitFor(page, `document.readyState === 'complete'`, 15000)
  await sleep(3500)
  await waitFor(page, `!!document.querySelector('[data-kb="learned-dot"]')`, 15000)
  check('the Skills row of the menu has a dot that says one skill waits for the person', (await count('[data-kb="learned-dot"]')) === 1 && /1 skill is waiting for you/.test((await dotLabel()) || ''), await dotLabel())
  await clickText(page, 'Skills')
  await waitFor(page, `!!document.querySelector('.kbsub-group [role=tab]')`, 20000)
  for (let i = 0; i < 40; i += 1) {
    const on = await ev(`(() => { const t = Array.from(document.querySelectorAll('.kbsub-group [role=tab]')).find((b) => /^Yours/.test(b.innerText.trim())); if (!t) return false; if (t.getAttribute('aria-selected') !== 'true') t.click(); return t.getAttribute('aria-selected') === 'true' })()`)
    if (on === true) break
    await sleep(250)
  }
  await waitFor(page, `!!document.querySelector('[data-kb="learned-auto-banner"]')`, 15000)
  await sleep(600)
  await shot('01-auto-banner')
  const banner = (await text('[data-kb="learned-auto-banner"]')) || ''
  check('Yours says Kaby changed one skill on its own, which one, the score and that it is not reviewed', /Kaby changed 1 skill on its own/.test(banner) && banner.includes(NAMES[0]) && /Score \d+, applied by Kaby on its own/.test(banner) && /Not reviewed yet/.test(banner), banner.slice(0, 300))
  const chip = await ev(`(() => { const c = Array.from(document.querySelectorAll('[data-kb^="skill-card-"]')).find((e) => e.textContent.includes(${JSON.stringify(NAMES[0])})); return c ? { auto: ((c.querySelector('[data-kb="learned-auto"]') || {}).textContent || ''), badge: !!c.querySelector('[data-kb="learned-badge"]') } : null })()`)
  check('its card says « applied by Kaby · not reviewed » and wears the Learned badge', chip !== null && chip.badge === true && /applied by Kaby · not reviewed/.test(chip.auto), chip)

  console.log('the journal, and Keep')
  await pressDom('[data-kb="learned-journal-btn"]')
  await waitFor(page, `!!document.querySelector('[data-kb="learned-journal"]')`, 8000)
  await sleep(600)
  await ev(`(() => { const b = document.querySelector('[data-kb="journal-entry"] button'); if (b) b.click() })()`)
  await sleep(400)
  await shot('02-journal')
  const jr = (await text('[data-kb="learned-journal"]')) || ''
  check('the journal says the chain holds, lists « Created by Kaby » with its score, and offers Undo on it', (await count('[data-kb="journal-verified"]')) === 1 && /Created by Kaby/.test(jr) && /score \d+/.test(jr) && (await count('[data-kb="journal-undo"]')) === 1, jr.slice(0, 300))
  await pressDom('[data-kb="learned-auto-keep"]')
  await waitFor(page, `!document.querySelector('[data-kb="learned-auto-banner"]')`, 8000)
  const kept = (await get('/kybernos-skills/learned')).learned.find((l) => l.name === NAMES[0])
  check('Keep: the banner goes, the host says reviewed, the skill stays active', kept !== undefined && kept.reviewed === true && existsSync(file) && (await count('[data-kb="learned-auto-banner"]')) === 0, kept)
  await sleep(800)
  check('and the dot goes with it', (await count('[data-kb="learned-dot"]')) === 0)

  console.log('Settings › Learned skills')
  if ((await openSettings(page, { minCells: 0 })) !== true) { console.error('○ not run: the Settings dialog did not open'); await live.close(); process.exit(3) }
  const there = await goToSettingsPage(page, 'Learned skills', { marker: `!!document.querySelector('[data-kb="learned-settings"]')` })
  check('the page opens from the Settings menu', there === true)
  await waitFor(page, `document.querySelectorAll('[data-kb^="level-"]').length === 3`, 8000)
  await sleep(500)
  await shot('03-settings')
  const levels = await ev(`Array.from(document.querySelectorAll('[data-kb^="level-"]')).map((b) => [b.getAttribute('data-kb'), b.getAttribute('aria-pressed')])`)
  check('three levels, and « Create and improve » is the one in force', Array.isArray(levels) && levels.length === 3 && levels.find((l) => l[0] === 'level-auto')[1] === 'true', levels)
  check('the line shows 70 and the hard stops are listed', (await text('[data-kb="learned-line-value"]')) === '70' && (await count('[data-kb="learned-stops"] li')) === 6, await text('[data-kb="learned-line-value"]'))
  await ev(`(() => { const el = document.querySelector('[data-kb="learned-range"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '80'); el.dispatchEvent(new Event('input', { bubbles: true })) })()`)
  await sleep(1200)
  const s1 = await get('/kybernos-skills/learned/settings')
  check('moving the slider saves the line once the person stops', ((s1 || {}).settings || s1 || {}).threshold === 80, s1)
  await pressDom('[data-kb="level-ask"]')
  await sleep(900)
  const s2 = await get('/kybernos-skills/learned/settings')
  check('choosing « Ask me every time » saves it', ((s2 || {}).settings || s2 || {}).mode === 'ask', s2)
  await pressDom('[data-kb="level-auto"]')
  await sleep(900)
  const s3 = await get('/kybernos-skills/learned/settings')
  check('and « Create and improve » again', ((s3 || {}).settings || s3 || {}).mode === 'auto', s3)
  const jset = readFileSync(join(dsh, 'kybernos', 'skills-learned.audit.jsonl'), 'utf8').split('\n').filter((l) => l !== '').map((l) => JSON.parse(l)).filter((l) => l.act === 'settings')
  check('every change of the settings is in the journal', jset.length >= 4 && jset.every((l) => l.by === 'you'), jset.map((l) => l.act))

  console.log('the kill switch')
  await post('/kybernos-skills/learned/settings/set', { threshold: 70 })
  const second = await handOver(NAMES[1], 5)
  check('a second skill was applied by Kaby', second.ok === true && second.auto === true && existsSync(join(dsh, 'skills', NAMES[1], 'SKILL.md')), second)
  await pressDom('[data-kb="learned-stop"]')
  await sleep(500)
  check('the first press only asks again, nothing was undone', (await count('[data-kb="learned-stop-yes"]')) === 1 && existsSync(join(dsh, 'skills', NAMES[1], 'SKILL.md')))
  await pressDom('[data-kb="learned-stop-yes"]')
  await waitFor(page, `!!document.querySelector('[data-kb="learned-stopped"]')`, 8000)
  await sleep(500)
  await shot('04-stopped')
  const s4 = await get('/kybernos-skills/learned/settings')
  check('Stop undid the changes of the week that still stand, and the level is « Ask me » again', !existsSync(join(dsh, 'skills', NAMES[1])) && !existsSync(join(dsh, 'skills', NAMES[0])) && ((s4 || {}).settings || s4 || {}).mode === 'ask', [s4, /Stopped\. (\d+) change/.exec((await text('[data-kb="learned-stopped"]')) || '')])
  const chain = await get('/kybernos-skills/learned/journal')
  check('the journal still verifies after all of it, and says the person stopped it', chain !== null && chain.verified === true && chain.entries.some((e) => e.act === 'paused' && e.note === 'stopped'), chain && chain.verified)
  check('the page raised no error', errors.length === 0, errors)
} catch (e) {
  failures.push('the check itself threw: ' + String((e && e.message) || e))
  console.log('  ✗ ' + String((e && e.stack) || e).slice(0, 600))
} finally {
  for (const f of ['skills-learned.json', 'skills-learned.audit.jsonl', 'skills-learned-settings.json', 'skills-learned-sessions.json']) rmSync(join(dsh, 'kybernos', f), { force: true })
  rmSync(join(dsh, 'kybernos', 'skills-learned-versions'), { recursive: true, force: true })
  for (const n of NAMES) rmSync(join(dsh, 'skills', n), { recursive: true, force: true })
  await live.close()
}
console.log('\n' + String(pass) + ' ✓, ' + String(failures.length) + ' ✗')
process.exit(failures.length === 0 ? 0 : 1)

// Skills learned from experience, on the REAL GUI of a SANDBOX: three lessons that share a tag, « Make a skill », the suggestion on the Skills
// page (banner, card, menu dot), Review, Accept (the skill is written to the sandbox's skills folder), the badge, the journal, Undo.
//
//   source scripts/sandbox/env.sh && node scripts/check-skills-learned-live.mjs [--shots <dir>]
//
// Sandbox only (it refuses :3080, exit 3): it writes lessons, a suggestion and a skill, all in the sandbox's own DSH home, and starts by
// clearing the learned-skills files of that home so that it can be run twice. The sandbox serves THIS checkout (docs/dev/live-testing.md), so
// nothing is swapped. What this proves that the unit tests cannot: the client talks to the host it will really meet (same-origin POSTs with the
// page's session), the bundles agree on the seam (`window.__KB_LEARNED__`) and on the routes, and the page the person sees says it.
//
// Exit 0 all good, 1 a check failed, 3 not run (no GUI, not a sandbox).
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { openLivePage, waitFor, clickText, openSettings, goToSettingsPage } from './live-page.mjs'

const authority = process.env.KB_HOST || '127.0.0.1:3080'
if (authority === '127.0.0.1:3080' || !process.env.DSH_HOME) { console.error('○ not run: sandbox only (source scripts/sandbox/env.sh first); it writes lessons, a suggestion and a skill'); process.exit(3) }
const dsh = process.env.DSH_HOME
if (/\/\.dsh$/.test(dsh) && dsh === join(process.env.KB_REAL_HOME || '', '.dsh')) { console.error('○ not run: DSH_HOME is the real home'); process.exit(3) }

const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null
if (shotsDir !== null) mkdirSync(shotsDir, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0
const failures = []
const check = (label, cond, detail) => {
  if (cond === true) { pass += 1; console.log('  ✓ ' + label) } else { failures.push(label); console.log('  ✗ ' + label + (detail === undefined ? '' : '  — ' + JSON.stringify(detail).slice(0, 300))) }
}

// a clean slate: only the files of this feature, only in the sandbox's home
for (const f of ['skills-learned.json', 'skills-learned.audit.jsonl']) rmSync(join(dsh, 'kybernos', f), { force: true })
rmSync(join(dsh, 'kybernos', 'skills-learned-versions'), { recursive: true, force: true })
for (const n of ['live-i18n-checklist', 'live-i18n-checklist-2']) rmSync(join(dsh, 'skills', n), { recursive: true, force: true })

const live = await openLivePage({ width: 1500, height: 950 }).catch((e) => { console.error('○ not run: ' + e.message); process.exit(3) })
const { page } = live
const errors = []
const ev = async (js) => { const r = await page.evalJs(js, 10000); return r.err ? null : r.val }
const shot = async (name) => { if (shotsDir !== null) await page.shot(join(shotsDir, name + '.png')) }
const count = (sel) => ev(`document.querySelectorAll(${JSON.stringify(sel)}).length`)
const text = (sel) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return e ? e.textContent.replace(/\\s+/g, ' ').trim() : null })()`)
// the page's own fetch: same origin, the page's session cookie
const post = (path, body) => ev(`fetch(${JSON.stringify(path)}, { method: 'POST', headers: { 'content-type': 'application/json' }, body: ${JSON.stringify(JSON.stringify(body))} }).then((r) => r.json()).catch(() => null)`)
const get = (path) => ev(`fetch(${JSON.stringify(path)}).then((r) => r.json()).catch(() => null)`)
const pressDom = (sel) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; e.scrollIntoView({ block: 'center' }); e.click(); return true })()`)

try {
  await page.send('Runtime.enable', {})
  page.on('Runtime.exceptionThrown', (p) => errors.push(String((p.exceptionDetails && p.exceptionDetails.exception && p.exceptionDetails.exception.description) || 'exception').slice(0, 200)))
  await waitFor(page, `document.readyState === 'complete'`, 15000)
  await sleep(2500)

  console.log('the host (what the page must agree with)')
  const first = await get('/kybernos-skills/learned')
  check('the learned routes answer on this instance (is it a sandbox that serves this checkout? restart it after host changes)', first !== null && first.ok === true && Array.isArray(first.proposals), first)
  if (first === null || first.ok !== true) { await live.close(); process.exit(3) }
  check('nothing waits and nothing was learned yet', first.proposals.length === 0 && first.learned.length === 0)

  // lessons a failed earlier run left in this sandbox
  const leftovers = await get('/kybernos-memory/lessons?limit=200')
  for (const l of leftovers !== null && Array.isArray(leftovers.items) ? leftovers.items : []) if ((l.tags || []).some((t) => t === 'live-i18n' || t === 'discard-me')) await post('/kybernos-memory/lessons/delete', { id: l.id })

  console.log('three lessons that share a tag')
  // a sandbox has no « default » agent team: lessons go to the first one it has
  const kyList = await get('/kybernos-memory/kybers')
  const kyber = kyList !== null && Array.isArray(kyList.kybers) && kyList.kybers.length > 0 ? (typeof kyList.kybers[0] === 'string' ? kyList.kybers[0] : kyList.kybers[0].id) : 'default'
  const mk = async (text, tags) => post('/kybernos-memory/lessons/add', { kyber, text, tags })
  const ids = []
  for (const t of ['Live check: prove the interface language before you count missing strings.', 'Live check: extract keys line by line, a key can contain a colon.', 'Live check: diff the dictionary that is shown, not the source file.']) {
    const r = await mk(t, ['live-i18n'])
    if (r !== null && r.ok === true && r.lesson !== undefined) ids.push(r.lesson.id)
  }
  check('the lessons were added through the real route', ids.length === 3, ids)

  console.log('settings → Memory & Lessons → Lessons learned')
  if ((await openSettings(page, { minCells: 0 })) !== true) { console.error('○ not run: the Settings dialog did not open'); await live.close(); process.exit(3) }
  const there = await goToSettingsPage(page, 'Memory & Lessons', { marker: `!!document.querySelector('.kbmem-page')` })
  check('the Memory & Lessons page opens', there === true)
  // The tab is pressed until the lessons stay on screen: the page picks its first tab when its lists arrive and takes an early press back.
  const lessonsTabOn = `(() => { const b = document.querySelector('.kbmem-seg button[data-v="lessons"]'); return !!b && b.getAttribute('aria-pressed') === 'true' })()`
  for (let i = 0; i < 30; i += 1) {
    if ((await ev(lessonsTabOn)) === true) {
      await sleep(900)
      if ((await ev(lessonsTabOn)) === true && (await count('.kbmem-r')) > 0) break
      continue
    }
    await clickText(page, 'Lessons learned', { within: '.kbmem-row2' }).catch(() => null)
    await sleep(700)
  }
  await waitFor(page, `document.querySelectorAll('.kbmem-r').length > 0`, 12000)
  await waitFor(page, `!!document.querySelector('[data-note="cluster"]')`, 15000)
  await sleep(400)
  await shot('01-lessons')
  check('the lessons list shows the grouping hint, with the topic and the count', (await count('[data-note="cluster"]')) === 1 && /3 lessons are about “live-i18n”/.test((await text('[data-note="cluster"]')) || ''), await text('[data-note="cluster"]'))
  check('the status line does not mention skills before there is one', !/made from experience/.test((await text('.kbmem-st')) || ''))
  await pressDom('[data-act="cluster-skill"]')
  await waitFor(page, `/Skill suggested/.test(document.body.innerText)`, 8000)
  check('« Make a skill from them » says it was suggested and waits in Skills', /Skill suggested: “live-i18n-checklist”\. It waits for your yes in Skills\./.test((await ev('document.body.innerText')) || ''))
  const after = await get('/kybernos-skills/learned')
  check('the host holds one suggestion and the skills folder holds nothing', after.proposals.length === 1 && after.proposals[0].name === 'live-i18n-checklist' && !existsSync(join(dsh, 'skills', 'live-i18n-checklist')), after.proposals.map((p) => p.name))
  check('it is a checklist of pitfalls in the lessons\' own words', /## Watch out for\n- Live check: /.test(after.proposals[0].body) && ['prove the interface language', 'extract keys line by line', 'diff the dictionary that is shown'].every((w) => after.proposals[0].body.includes(w)) && after.proposals[0].body.split('\n- ').length === 4, after.proposals[0].body)
  await pressDom('[data-act="cluster-skill"]')
  await sleep(1200)
  check('the same lessons are not suggested twice', (await get('/kybernos-skills/learned')).proposals.length === 1)

  console.log('a lesson, one by one')
  await pressDom('.kbmem-r')
  await waitFor(page, `!!document.querySelector('[data-act="make-skill"]')`, 6000)
  check('the lesson sheet has « Make a skill »', (await count('[data-act="make-skill"]')) === 1)
  await shot('02-lesson-sheet')
  await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)

  console.log('the Skills page')
  await post('/kybernos-skills/learned/from-lessons', { lessons: [{ text: 'A suggestion made from the page of the check, to be discarded.', tags: ['discard-me'], kyber }] })
  await page.send('Page.reload', { ignoreCache: true })
  await waitFor(page, `document.readyState === 'complete'`, 15000)
  await sleep(3500)
  await waitFor(page, `!!document.querySelector('[data-kb="learned-dot"]')`, 15000)
  check('the Skills row of the menu has a dot', (await count('[data-kb="learned-dot"]')) === 1)
  check('and the dot says how many wait', /2 skills suggested by Kaby/.test((await ev(`(() => { const d = document.querySelector('[data-kb="learned-dot"]'); return d ? d.getAttribute('aria-label') : '' })()`)) || ''))
  await clickText(page, 'Skills')
  await waitFor(page, `!!document.querySelector('.kbsub-group [role=tab]')`, 20000)
  for (let i = 0; i < 40; i += 1) {
    const on = await ev(`(() => { const t = Array.from(document.querySelectorAll('.kbsub-group [role=tab]')).find((b) => /^Yours/.test(b.innerText.trim())); if (!t) return false; if (t.getAttribute('aria-selected') !== 'true') t.click(); return t.getAttribute('aria-selected') === 'true' })()`)
    if (on === true) break
    await sleep(250)
  }
  await waitFor(page, `!!document.querySelector('[data-kb="learned-banner"]')`, 15000)
  await sleep(500)
  await shot('03-yours')
  check('Yours shows the banner with the count, and says nothing is active before Accept', /2 skills suggested by Kaby/.test((await text('[data-kb="learned-banner"]')) || '') && /Nothing is active until you accept/.test((await text('[data-kb="learned-banner"]')) || ''))
  check('two dashed cards and a chip', (await count('[data-kb="learned-card"]')) === 2 && (await count('[data-kb="learned-chip"]')) === 1)
  check('the journal button is there', (await count('[data-kb="learned-journal-btn"]')) === 1)

  console.log('Review, then Discard one')
  await pressDom('[data-kb="learned-card"] [data-kb="learned-review"]')
  await waitFor(page, `!!document.querySelector('[data-kb="learned-panel"]')`, 8000)
  await shot('04-review')
  const panel = (await text('[data-kb="learned-panel"]')) || ''
  check('the panel says why, shows the text and the standard rules, and the checks', /Why Kaby suggests it/.test(panel) && /Draft only: never send, publish, delete or pay for the user\./.test(panel) && /Valid name/.test(panel) && /Nothing changes until you accept\./.test(panel), panel.slice(0, 200))
  check('opening it activated nothing', !existsSync(join(dsh, 'skills', 'live-i18n-checklist')))
  const names = (await get('/kybernos-skills/learned')).proposals.map((p) => p.name)
  check('there are two suggestions, in the order of the page', names.length === 2, names)
  // discard the one that is not the checklist, from the panel when it is that one, else from its card
  const discardName = names.find((n) => n !== 'live-i18n-checklist')
  const target = (await text('[data-kb="learned-panel"] .kb8-h1')) || ''
  if (target.includes(discardName)) await pressDom('[data-kb="learned-discard"]')
  else await ev(`(() => { const c = Array.from(document.querySelectorAll('[data-kb="learned-card"]')).find((x) => x.textContent.includes(${JSON.stringify(discardName)})); const b = c && c.querySelector('button[title="Discard"]'); if (b) b.click(); return !!b })()`)
  await waitFor(page, `/Kept 30 days/.test(document.body.innerText)`, 8000)
  check('Discard says it is kept 30 days, with Undo', /Kept 30 days/.test((await ev('document.body.innerText')) || '') && (await count('[data-kb="notice-undo"]')) === 1)
  check('the host lists it as discarded', (await get('/kybernos-skills/learned')).discarded.some((d) => d.name === discardName))
  await pressDom('[data-kb="notice-undo"]')
  await sleep(1200)
  check('Undo brings it back', (await get('/kybernos-skills/learned')).proposals.length === 2)

  console.log('Accept')
  await ev(`(() => { const c = Array.from(document.querySelectorAll('[data-kb="learned-card"]')).find((x) => x.textContent.includes('live-i18n-checklist')); const b = c && c.querySelector('[data-kb="learned-review"]'); if (b) b.click(); return !!b })()`)
  await waitFor(page, `!!document.querySelector('[data-kb="learned-accept"]')`, 8000)
  await pressDom('[data-kb="learned-accept"]')
  await waitFor(page, `/is active\\./.test(document.body.innerText)`, 10000)
  await sleep(1500)
  await shot('05-accepted')
  const file = join(dsh, 'skills', 'live-i18n-checklist', 'SKILL.md')
  check('the skill was written to the skills folder, as a normal skill with the standard rules', existsSync(file) && /^---\nname: live-i18n-checklist\n/.test(readFileSync(file, 'utf8')) && /## Rules\n\n- Speak the user’s language/.test(readFileSync(file, 'utf8')))
  check('the page says it is active, with Undo', /“live-i18n-checklist” is active\./.test((await ev('document.body.innerText')) || '') && (await count('[data-kb="notice-undo"]')) === 1)
  await waitFor(page, `!!document.querySelector('[data-kb="skill-card-undefined"], [data-kb^="skill-card-"][data-kb$="live-i18n-checklist"]') || Array.from(document.querySelectorAll('[data-kb^="skill-card-"]')).some((e) => e.textContent.includes('live-i18n-checklist'))`, 15000)
  const learnedCard = await ev(`(() => { const c = Array.from(document.querySelectorAll('[data-kb^="skill-card-"]')).find((e) => e.textContent.includes('live-i18n-checklist')); return c ? { badge: !!c.querySelector('[data-kb="learned-badge"]'), from: (c.querySelector('[data-kb="learned-from"]') || {}).textContent || '' } : null })()`)
  check('the installed card has the Learned badge and says where it came from', learnedCard !== null && learnedCard.badge === true && /3 lessons/.test(learnedCard.from), learnedCard)
  check('the dot counts one suggestion now', /1 skill suggested by Kaby/.test((await ev(`(() => { const d = document.querySelector('[data-kb="learned-dot"]'); return d ? d.getAttribute('aria-label') : '' })()`)) || ''))

  console.log('the journal')
  await pressDom('[data-kb="learned-journal-btn"]')
  await waitFor(page, `!!document.querySelector('[data-kb="learned-journal"]')`, 8000)
  await sleep(600)
  await shot('06-journal')
  const jr = (await text('[data-kb="learned-journal"]')) || ''
  check('the journal says the chain holds, and lists what happened', (await count('[data-kb="journal-verified"]')) === 1 && /Suggested/.test(jr) && /Accepted/.test(jr) && /Discarded/.test(jr) && /Restored/.test(jr), jr.slice(0, 300))
  const lines = readFileSync(join(dsh, 'kybernos', 'skills-learned.audit.jsonl'), 'utf8').split('\n').filter((l) => l !== '').map((l) => JSON.parse(l))
  check('the file on disk is a chain: each line carries the hash of the one before', lines.length >= 5 && lines.every((l, i) => (i === 0 ? /^0{64}$/.test(l.prev) : l.prev === lines[i - 1].hash)), lines.map((l) => l.act))

  console.log('Undo the acceptance')
  await post('/kybernos-skills/learned/undo', { name: 'live-i18n-checklist' }).then(async (r) => check('Undo takes the skill back (it is still the text that was written)', r !== null && r.ok === true && !existsSync(join(dsh, 'skills', 'live-i18n-checklist')), r))
  const end = await get('/kybernos-skills/learned')
  check('and the suggestion is back in the list', end.proposals.some((p) => p.name === 'live-i18n-checklist') && end.learned.length === 0)
  check('the page raised no error', errors.length === 0, errors)

  // clean up what this check made in the sandbox: its lessons (archived by the route), the learned files, the skill folders
  for (const id of ids) await post('/kybernos-memory/lessons/delete', { id })
  for (const f of ['skills-learned.json', 'skills-learned.audit.jsonl']) rmSync(join(dsh, 'kybernos', f), { force: true })
  rmSync(join(dsh, 'kybernos', 'skills-learned-versions'), { recursive: true, force: true })
} catch (e) {
  failures.push('the check itself threw: ' + String((e && e.message) || e))
  console.log('  ✗ ' + String((e && e.stack) || e).slice(0, 600))
} finally {
  await live.close()
}
console.log('\n' + String(pass) + ' ✓, ' + String(failures.length) + ' ✗')
process.exit(failures.length === 0 ? 0 : 1)

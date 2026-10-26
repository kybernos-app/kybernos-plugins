// The Skills screen's panels, on the REAL GUI and the user's REAL skills, READ-ONLY.
//
//   node scripts/check-skills-detail-live.mjs [--shots <dir>]
//
// What is real: the DSH page, this checkout's client of kybernos-skills (swapped into the page, scripts/lib-bundle-swap.mjs), the
// user's catalogue (the real `GET /kybernos-skills/skills`), the real ranking from the relay, the real skills folders, and GitHub
// (the preview is the host code of THIS checkout, run in this process, asking the two public GitHub hosts anonymously).
// What is answered by the check: the routes the running host does not have yet (`skill/read`, `preview`) are computed from this
// checkout's host code; EVERY other non-GET request to /kybernos-skills/* is refused inside the check and recorded, so that nothing
// the page does can write, install, delete or open anything on the machine. The check opens the delete and install confirmations
// and only ever presses Cancel.
//
// Exit 0 all good, 1 a check failed, 3 not run (no GUI).
import { mkdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { openLivePage, waitFor, clickText } from './live-page.mjs'
import { swapBundles } from './lib-bundle-swap.mjs'
import * as host from '../packages/kybernos-skills/index.js'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
// The Skills page opens on Featured; the catalogue of the user's own skills (and the refusals of its host route) belong to the Yours segment.
const openYours = async (page, waitFor) => {
  await waitFor(page, "!!document.querySelector('.kbsub-group [role=tab]')", 20000)
  // Pressed until it is the selected segment: the page may still be settling (it picks its first tab when its lists arrive) and take an early click back.
  for (let i = 0; i < 40; i += 1) {
    const on = (await page.evalJs("(() => { const t = Array.from(document.querySelectorAll('.kbsub-group [role=tab]')).find((b) => /^Yours/.test(b.innerText.trim())); if (!t) return false; if (t.getAttribute('aria-selected') === 'true') return true; t.click(); return false })()")).val
    if (on === true) return
    await sleep(250)
  }
}
let pass = 0
const failures = []
const check = (label, cond, detail) => {
  if (cond) { pass += 1; console.log('  ✓ ' + label) } else { failures.push(label); console.log('  ✗ ' + label + (detail === undefined ? '' : '  — ' + JSON.stringify(detail).slice(0, 400))) }
}
const shotsAt = process.argv.indexOf('--shots')
const shotsDir = shotsAt > 0 ? process.argv[shotsAt + 1] : null
if (shotsDir !== null) mkdirSync(shotsDir, { recursive: true })

const live = await openLivePage().catch((e) => { console.error('○ not run: ' + e.message); process.exit(3) })
const { page } = live
const errors = []
const blocked = []        // every write the page tried, answered here
const answered = []       // the routes computed here
try {
  await page.send('Runtime.enable', {})
  page.on('Runtime.exceptionThrown', (p) => errors.push(String((p.exceptionDetails && p.exceptionDetails.exception && p.exceptionDetails.exception.description) || 'exception').slice(0, 200)))

  // This checkout's host code, on the user's real folders, fed with the catalogue the running host gave the page.
  const config = { home: homedir(), dsh: host.dshHome() }
  let catalogue = null
  const fileOf = (root, name) => {
    const direct = join(root, name, 'SKILL.md')
    try { readFileSync(direct, 'utf8'); return direct } catch (e) { /* the folder is named otherwise */ }
    return null
  }
  const ctx = {
    get: (n) => (n === 'skills'
      ? { async snapshot () { return { complete: true, skills: (catalogue === null ? [] : catalogue.skills).filter((s) => s.active === true && fileOf(s.root, s.name) !== null).map((s) => ({ name: s.name, path: fileOf(s.root, s.name), source: s.source, description: s.description })) } }, invalidateCache () {} }
      : undefined)
  }
  const reply = (p, json) => page.send('Fetch.fulfillRequest', {
    requestId: p.requestId, responseCode: 200, responseHeaders: [{ name: 'content-type', value: 'application/json' }],
    body: Buffer.from(JSON.stringify(json), 'utf8').toString('base64')
  }).catch(() => {})
  page.on('Fetch.requestPaused', async (p) => {
    if (p.responseStatusCode !== undefined) return    // the bundle swap's business
    const url = new URL(p.request.url)
    const path = url.pathname
    if (path.startsWith('/kybernos-skills/') === false) { page.send('Fetch.continueRequest', { requestId: p.requestId }).catch(() => {}); return }
    try {
      if (p.request.method === 'GET' && path === '/kybernos-skills/preview') {
        answered.push(path + ' ' + url.searchParams.get('source') + ' ' + url.searchParams.get('name'))
        return reply(p, await host.previewSkill(url.searchParams.get('source'), url.searchParams.get('name')))
      }
      if (p.request.method === 'POST' && path === '/kybernos-skills/skill/read') {
        const body = JSON.parse(p.request.postData || '{}')
        answered.push(path + ' ' + body.name)
        return reply(p, await host.readSkill({ ctx, root: body.root, name: body.name, config, req: { headers: { host: live.authority } } }))
      }
      if (p.request.method !== 'GET') {
        blocked.push(path + ' ' + (p.request.postData || ''))
        return reply(p, { ok: true, name: 'kept-out', files: 0, opened: true, deleted: true, skill: null })
      }
      page.send('Fetch.continueRequest', { requestId: p.requestId }).catch(() => {})
    } catch (e) {
      reply(p, { ok: false, error: 'request_failed' })
    }
  })
  const swap = await swapBundles(page, [{ name: 'kybernos-skills' }], { extraPatterns: [{ urlPattern: '*kybernos-skills/*', requestStage: 'Request' }] })
  const js = async (code) => { const r = await page.evalJs(code); if (r.err !== undefined) throw new Error('page script failed: ' + String(r.err).slice(0, 200)); return r.val }
  const shot = async (name) => { if (shotsDir !== null) await page.shot(join(shotsDir, name + '.png')) }
  const norm = (s) => String(s === undefined || s === null ? '' : s).replace(/\s+/g, ' ').trim()
  const panelText = (kbName) => js(`(() => { const n = document.querySelector('[data-kb="${kbName}"]'); return n ? n.innerText : '' })()`)

  console.log('Skills panels — this checkout\'s client on the real GUI, the real skills, nothing written')
  await page.send('Page.reload', { ignoreCache: true })
  await sleep(2500)
  await waitFor(page, 'document.body && document.body.innerText.length > 80', 30000)
  await clickText(page, 'Skills')
  await waitFor(page, "!!document.querySelector('.kbs-root')", 20000)
  await openYours(page, waitFor)
  await waitFor(page, "document.querySelectorAll('.kbs-root .kb8-card[data-kb^=\"skill-card-\"]').length > 3", 40000)
  check('the client was found in the served bundle and swapped', swap.report().every((r) => r.replaced === true), swap.report())

  // The catalogue as the page got it.
  catalogue = await js("fetch('/kybernos-skills/skills', { headers: { accept: 'application/json' } }).then((r) => r.json())")
  check('the real catalogue is there', catalogue !== null && catalogue.ok === true && catalogue.skills.length > 3, catalogue && catalogue.skills && catalogue.skills.length)

  // ── Yours ──
  console.log('Yours')
  const cards = await js("[...document.querySelectorAll('.kbs-root .kb8-card[data-kb^=\"skill-card-\"]')].map((c) => c.querySelector('.kb8-name').innerText)")
  check('the cards are listed', Array.isArray(cards) && cards.length > 3, cards && cards.length)
  const first = cards[0]
  const second = cards.find((n, i) => i > 2 && n !== first)
  const open = async (name) => {
    await js(`[...document.querySelectorAll('.kbs-root .kb8-card[data-kb^="skill-card-"]')].find((c) => c.querySelector('.kb8-name').innerText === ${JSON.stringify(name)}).click()`)
    await sleep(1500)
  }
  await open(first)
  const p1 = await panelText('skill-panel')
  check('a click opens the panel', p1.includes(first), p1.slice(0, 120))
  check('the list is still there beside it', (await js("document.querySelectorAll('.kbs-root .kb8-card[data-kb^=\"skill-card-\"]').length")) === cards.length)
  const entry = catalogue.skills.find((s) => s.name === first)
  const real = fileOf(entry.root, entry.name)
  const onDisk = real === null ? null : readFileSync(real, 'utf8')
  // The panel shows the SKILL.md formatted; « Raw text » is the file as it is, which is what is compared with the disk.
  const rawSkillText = async () => {
    await js("(() => { const e = document.querySelector('[data-kb=\"skill-text\"]'); if (e && e.tagName !== 'PRE') { const b = document.querySelector('[data-kb=\"md-switch\"]'); if (b) b.click() } })()")
    await sleep(300)
    return js("(document.querySelector('[data-kb=\"skill-text\"]') || { innerText: '' }).innerText")
  }
  check('the SKILL.md is shown formatted first, with a Raw text switch', await js("(() => { const e = document.querySelector('[data-kb=\"skill-text\"]'); return !!e && e.getAttribute('data-rendered') === 'true' && !!document.querySelector('[data-kb=\"md-switch\"]') })()"))
  const shown = await rawSkillText()
  check('the panel shows the SKILL.md exactly as it is on disk (' + first + ')', onDisk !== null && norm(shown) === norm(onDisk), { shown: norm(shown).slice(0, 80), disk: norm(onDisk).slice(0, 80) })
  check('it says where the skill lives', real !== null && p1.includes(real.replace(/\/SKILL\.md$/, '')), p1.slice(0, 200))
  await shot('yours-panel')
  await open(second)
  const p2 = await panelText('skill-panel')
  const shown2 = await rawSkillText()
  const entry2 = catalogue.skills.find((s) => s.name === second)
  const real2 = fileOf(entry2.root, entry2.name)
  check('another card shows its own SKILL.md (' + second + ')', p2.includes(second) && real2 !== null && norm(shown2) === norm(readFileSync(real2, 'utf8')) && norm(shown2) !== norm(shown))
  const acts = await js("[...document.querySelectorAll('[data-kb^=\"act-\"]')].map((b) => b.getAttribute('data-kb'))")
  const writable = entry2.writable === true
  check('the actions are the ones this skill allows (' + (writable ? 'writable' : 'read-only') + '): ' + acts.join(' '), acts.includes('act-reveal') && acts.includes('act-edit') && acts.includes('act-duplicate') && (acts.includes('act-delete') === writable), acts)

  if (writable) {
    await js("document.querySelector('[data-kb=\"act-delete\"]').click()")
    await sleep(600)
    const dlg = await panelText('delete-confirm')
    check('Delete opens a confirmation naming the folder', dlg.includes(second) && dlg.includes(entry2.root), dlg.slice(0, 200))
    await shot('delete-confirm')
    await js("document.querySelector('[data-kb=\"delete-confirm-no\"]').click()")
    await sleep(400)
    check('Cancel closes it and nothing was asked of the host', (await js("!!document.querySelector('[data-kb=\"delete-confirm\"]')")) === false && blocked.length === 0, blocked)
  }

  // ── Discover ──
  console.log('Discover')
  await js(`[...document.querySelectorAll('.kbs-root .kb-seg')].find((b) => /^Discover/.test(b.innerText.trim())).click()`)
  await waitFor(page, "document.querySelectorAll('.kbs-root .kbs-row:not(.feat):not(.kbs-head):has(.kb8-name)').length > 3", 40000)
  const rowsOf = () => js("[...document.querySelectorAll('.kbs-root .kbs-row:not(.feat):not(.kbs-head):has(.kb8-name)')].map((r) => r.querySelector('.kb8-name').innerText)")
  const rows = await rowsOf()
  const pick = rows.indexOf('grill-me') >= 0 ? 'grill-me' : rows[1]
  const other = rows.find((n) => n !== pick && n !== rows[0]) || rows[0]
  const openRow = async (name) => {
    await js(`[...document.querySelectorAll('.kbs-root .kbs-row:not(.feat):not(.kbs-head):has(.kb8-name)')].find((r) => r.querySelector('.kb8-name').innerText === ${JSON.stringify(name)}).click()`)
    await waitFor(page, "(() => { const p = document.querySelector('[data-kb=\"disc-panel\"]'); return !!p && !/Reading the repository|Lecture du dépôt/.test(p.innerText) })()", 30000).catch(() => {})
    await sleep(500)
  }
  await openRow(pick)
  const d1 = await panelText('disc-panel')
  const src1 = (d1.match(/github\.com\/([\w.-]+\/[\w.-]+)/) || [])[1]
  check('a panel opens and the ranking stays (' + pick + ' · ' + src1 + ')', d1.includes(pick) && (await rowsOf()).length >= rows.length)
  const limited = /rate|limit/i.test(d1) && /Preview unavailable|Aperçu indisponible/.test(d1)
  if (limited) console.log('  ○ GitHub is limiting anonymous reads from this address: the preview checks are skipped')
  else {
    check('it shows its own folder and the start of its SKILL.md, read from the repository', /Folder in the repository|Dossier dans le dépôt/.test(d1) && !/found by its frontmatter|trouvé par son frontmatter/.test(d1) && (await js("!!document.querySelector('[data-kb=\"preview-text\"]')")), d1.slice(0, 400))
  }
  check('the publisher is the repository\'s owner', src1 !== undefined && new RegExp('(Published by|Publié par)\\s*' + src1.split('/')[0] + '\\b').test(d1), d1.slice(0, 300))
  await shot('discover-panel')
  if (!limited && pick === 'grill-me') {
    // The real grill-me of mattpocock/skills (2026-10-26: a 36-character body that only calls the « grilling » skill, which is not installed with it).
    const vet = await panelText('skill-vet')
    check('the real grill-me carries the warning at the top of its panel: empty or unusable, hands over to grilling', vet.length > 0 && /grilling/.test(vet) && /empty or unusable|vide ou inutilisable/.test(vet), vet)
    check('and it is the only block of that kind in the panel, drawn as a warning (a role, not an alert)', (await js("document.querySelectorAll('[data-kb=\"skill-vet\"]').length")) === 1 && (await js("document.querySelector('[data-kb=\"skill-vet\"]').getAttribute('role')")) === 'note')
    await shot('discover-warning')
  }
  await openRow(other)
  const d2 = await panelText('disc-panel')
  check('another card (' + other + ') has its own detail', d2.includes(other) && d2 !== d1)

  // The confirmation of the install.
  await openRow(pick)
  const installable = await js("!!document.querySelector('[data-kb=\"act-install\"]')")
  if (installable) {
    await js("document.querySelector('[data-kb=\"act-install\"]').click()")
    await sleep(600)
    const ic = await panelText('install-confirm')
    check('Install asks first, with this skill, its repository and the folder it will be copied to', ic.includes(pick) && ic.includes(src1) && ic.includes(join(config.dsh, 'skills', pick)), ic.slice(0, 500))
    check('with the explanation of what the button does', /Installing downloads the archive|Installer télécharge l.archive/.test(ic) && /COPIES|COPIE/.test(ic), ic.slice(0, 300))
    if (pick === 'grill-me' && !limited) check('for the empty skill the confirmation says it again, before anything is downloaded', /grilling/.test(ic) && (await js("document.querySelectorAll('[data-kb=\"skill-vet\"]').length")) === 2 && blocked.every((b) => b.indexOf('/install') < 0), ic.slice(0, 300))
    await shot('install-confirm')
    await js("document.querySelector('[data-kb=\"install-confirm-no\"]').click()")
    await sleep(400)
    check('Cancel installs nothing', blocked.every((b) => b.indexOf('/install') < 0), blocked)
  } else console.log('  ○ the picked skill is already installed here: the install confirmation is not shown on the real data')

  // ── a narrower window: the panel goes above the list ──
  await page.send('Emulation.setDeviceMetricsOverride', { width: 900, height: 900, deviceScaleFactor: 1, mobile: false })
  await sleep(800)
  const geo = await js("(() => { const p = document.querySelector('[data-kb=\"disc-panel\"]'); const r = document.querySelector('.kbs-root .kbs-row:not(.feat):not(.kbs-head):has(.kb8-name)'); if (!p || !r) return null; return { panelTop: p.getBoundingClientRect().top, rowTop: r.getBoundingClientRect().top, panelW: p.getBoundingClientRect().width, scroll: document.documentElement.scrollWidth, view: window.innerWidth } })()")
  check('at 900 px the panel sits above the list and nothing overflows sideways', geo !== null && geo.panelTop < geo.rowTop && geo.scroll <= geo.view + 1, geo)
  await shot('narrow')
  await page.send('Emulation.clearDeviceMetricsOverride', {})

  check('the page only ever asked the host for things it answered here: no write reached it', blocked.length === 0 && answered.length > 0, { blocked, answered: answered.length })
  check('no script error was thrown during the run', errors.length === 0, errors)
} finally {
  await live.close()
}
console.log('\n' + pass + ' checks passed' + (failures.length > 0 ? ', ' + failures.length + ' FAILED' : ''))
process.exit(failures.length > 0 ? 1 : 0)

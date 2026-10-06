// The Team tab of the Skills screen, on the REAL GUI (read-only on your machine).
//
//   node scripts/check-skills-team-live.mjs [--shots <dir>]
//
// What is real: the DSH page, its theme and CSS, the Skills panel mounted in the Resources area, and the read-only catalogue route.
// What is swapped: the bundle segment of kybernos-skills (this checkout's client.js replaces the one the running DSH serves, because the
// running DSH serves another checkout and its host half is not restarted for the occasion). What is faked: the Team server routes
// (/kybernos-cloud/team/skills*) and the disk half (/kybernos-skills/team/pack and /install), so nothing is written anywhere and no
// account is needed. Every call the page makes to a faked route is recorded and checked.
//
// Needs the GUI running (127.0.0.1:3080) and a signed session (docs/dev/live-testing.md). Exit 0 all good, 1 a check failed, 3 not run.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openLivePage, waitFor, clickText } from './live-page.mjs'
// The page reads what kybernos-cloud returns, not what the server returns: the fake goes through the real mapper.
import { asTeamSkill } from '../packages/kybernos-cloud/team-skills.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null }
const shotsDir = arg('--shots')
if (shotsDir !== null) mkdirSync(shotsDir, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// The client this checkout ships, and the one the running DSH serves (the main checkout, where the profile loads plugins from).
const mine = readFileSync(resolve(here, '..', 'packages', 'kybernos-skills', 'client.js'), 'utf8')
const mainCheckout = (() => {
  if (process.env.KB_SERVED_TREE) return process.env.KB_SERVED_TREE
  try { return dirname(resolve(here, '..', execFileSync('git', ['-C', here, 'rev-parse', '--git-common-dir'], { encoding: 'utf8' }).trim())) } catch (e) { return null }
})()
const servedPath = mainCheckout === null ? null : join(mainCheckout, 'packages', 'kybernos-skills', 'client.js')
if (servedPath === null || !existsSync(servedPath)) { console.error('○ not run: the served client was not found (set KB_SERVED_TREE)'); process.exit(3) }
const served = readFileSync(servedPath, 'utf8')

let pass = 0
const failures = []
const check = (label, cond, detail) => {
  if (cond) { pass += 1; console.log('  ✓ ' + label) } else { failures.push(label); console.log('  ✗ ' + label + (detail === undefined ? '' : '  — ' + JSON.stringify(detail).slice(0, 400))) }
}

// ── the fake Team server ──
const hash = (c) => c.repeat(64)
const V = { a: hash('a'), b: hash('b'), c: hash('c'), d: hash('d'), e: hash('e'), f: hash('f'), g: hash('9') }
const md = (name, description, extra = '') => '---\nname: ' + name + '\ndescription: "' + description + '"\n---\n\n# ' + name + '\n' + extra
const fileSet = (name, extra = []) => [{ path: 'SKILL.md', content: md(name, 'Fixture ' + name) }, ...extra]
const base = (id, name, description, version, over = {}) => ({
  id, name, description, version, status: 'approved', files: 4, bytes: 5120, proposed_by_name: 'Sam Okafor', proposed_at: '2026-09-28T10:00:00Z',
  reviewed_by_name: 'Sam Okafor', reviewed_at: '2026-09-28T11:00:00Z', note: null, review_note: null, replaces: null, superseded_by: null, mine: false, ...over
})
const fx = {
  role: 'member', lock: null, calls: [], packBad: null,
  rows: [
    base(1, 'release-notes', 'Drafts release notes from merged pull requests, in our house style', V.a),
    base(2, 'brand-voice', 'Checks copy against the Acme tone-of-voice guide', V.b, { proposed_by_name: 'Léa Martin', proposed_at: '2026-09-21T10:00:00Z' }),
    base(3, 'sql-review', 'Reviews SQL migrations for locks and missing indexes', V.e, { proposed_at: '2026-09-14T10:00:00Z' }),
    base(4, 'onboarding-checklist', 'Walks a new teammate through the first-week checklist', V.d, { proposed_by_name: 'Ana Costa', proposed_at: '2026-09-02T10:00:00Z' }),
    base(5, 'release-notes', 'Drafts release notes, now with a breaking-changes section', V.f, { status: 'proposed', replaces: 1, proposed_by_name: 'Léa Martin', proposed_at: '2026-10-06T09:42:00Z', reviewed_by_name: null, reviewed_at: null, note: 'Added a section for breaking changes.' }),
    base(6, 'incident-report', 'Writes an incident report from a timeline', V.g, { status: 'proposed', proposed_by_name: 'Ana Costa', proposed_at: '2026-10-05T17:10:00Z', reviewed_by_name: null, reviewed_at: null, note: 'Used for the September outage retro.', mine: true, files: 3 }),
    base(7, 'old-experiment', 'An idea that did not fly', V.c, { status: 'rejected', mine: true, review_note: 'Overlaps with brand-voice', proposed_by_name: 'Ana Costa' }),
    base(8, 'legacy-lint', 'Retired helper', V.c, { status: 'retired' })
  ],
  files: {
    1: fileSet('release-notes', [{ path: 'style-guide.md', content: 'Past tense, one line each.\n' }, { path: 'examples/2026-09.md', content: 'x\n' }, { path: 'examples/2026-08.md', content: 'y\n' }]),
    2: fileSet('brand-voice'), 3: fileSet('sql-review'), 4: fileSet('onboarding-checklist'),
    5: [{ path: 'SKILL.md', content: md('release-notes', 'Drafts release notes, now with a breaking-changes section', '\n1. List the pull requests merged since the last tag.\n2. Group them: Features, Fixes, Internal.\n3. Add a “Breaking changes” section first when a public API changed.\n4. End with an upgrade note if a migration ran.\n') }, { path: 'style-guide.md', content: 'Past tense, one line each.\n' }, { path: 'examples/2026-09.md', content: 'x\n' }, { path: 'examples/2026-08.md', content: 'y\n' }],
    6: [{ path: 'SKILL.md', content: md('incident-report', 'Writes an incident report') }, { path: 'template.md', content: '# Incident\n' }, { path: 'scripts/timeline.mjs', content: 'export const t = 1\n' }]
  }
}
fx.files[1] = [{ path: 'SKILL.md', content: md('release-notes', 'Drafts release notes from merged pull requests, in our house style', '\n1. List the pull requests merged since the last tag.\n2. Group them: Features, Fixes, Internal.\n3. End with an upgrade note if a migration ran.\n') }, ...fx.files[1].slice(1)]

const admin = () => fx.role === 'admin' || fx.role === 'owner'
const listFor = (view) => {
  if (view === 'approved') return fx.rows.filter((r) => r.status === 'approved')
  if (view === 'proposed') return fx.rows.filter((r) => r.status === 'proposed' && (admin() || r.mine))
  if (view === 'mine') return fx.rows.filter((r) => r.mine)
  return fx.rows
}
const fakeTeam = (method, path, query, body0) => {
  const body = body0 === null ? null : noSid(body0)
  fx.calls.push({ method, path, query, body })
  if (fx.lock !== null) return { ok: false, error: fx.lock }
  if (path === '/kybernos-cloud/team/skills') {
    const view = new URLSearchParams(query).get('view') || 'approved'
    const rows = listFor(view)
    return { ok: true, connected: true, role: fx.role, view, total: rows.length, limit: 200, offset: 0, workspaceName: 'Acme Studio',
      counts: { approved: fx.rows.filter((r) => r.status === 'approved').length, pending: listFor('proposed').length }, skills: rows.map(asTeamSkill) }
  }
  if (path === '/kybernos-cloud/team/skills/item') {
    const id = Number(new URLSearchParams(query).get('id'))
    const row = fx.rows.find((r) => r.id === id)
    if (row === undefined) return { ok: false, error: 'skill_not_found' }
    return { ok: true, skill: asTeamSkill({ ...row, files: fx.files[id] || fileSet(row.name), files_count: (fx.files[id] || []).length }) }
  }
  if (path === '/kybernos-cloud/team/skills/add') {
    const row = base(20 + fx.calls.length, body.name, body.description, V.g, { status: admin() ? 'approved' : 'proposed', mine: true, note: body.note || null, proposed_by_name: 'Sara M.' })
    fx.rows.push(row)
    return { ok: true, skill: asTeamSkill(row) }
  }
  if (path === '/kybernos-cloud/team/skills/review') {
    const row = fx.rows.find((r) => r.id === Number(body.id))
    if (row === undefined) return { ok: false, error: 'skill_not_found' }
    row.status = body.decision === 'approve' ? 'approved' : 'rejected'
    row.review_note = body.note || null
    if (row.status === 'approved' && row.replaces) { const old = fx.rows.find((r) => r.id === row.replaces); if (old) { old.status = 'retired'; old.superseded_by = row.id } }
    return { ok: true, skill: asTeamSkill(row) }
  }
  if (path === '/kybernos-cloud/team/skills/retire') { const row = fx.rows.find((r) => r.id === Number(body.id)); if (row) row.status = 'retired'; return { ok: true, skill: asTeamSkill(row) } }
  if (path === '/kybernos-cloud/team/skills/delete') { fx.rows = fx.rows.filter((r) => r.id !== Number(body.id)); return { ok: true } }
  return { ok: false, error: 'not_on_this_server' }
}
const noSid = (o) => { const c = { ...o }; delete c.sessionId; return c }
const fakeDisk = (path, body) => {
  body = noSid(body)
  fx.calls.push({ method: 'POST', path, body: { ...body, files: body.files === undefined ? undefined : body.files.length + ' files' } })
  if (path === '/kybernos-skills/team/pack') {
    if (fx.packBad !== null && body.name === fx.packBad) return { ok: false, error: 'scan_rejected', reason: 'scan_rejected', file: 'scripts/deploy.sh', line: 12 }
    return { ok: true, name: body.name, description: 'Fixture ' + body.name, files: fileSet(body.name, [{ path: 'notes.md', content: 'n\n' }]), version: V.g, count: 2, bytes: 1800, scripts: [] }
  }
  if (path === '/kybernos-skills/team/install') return { ok: true, replaced: body.replace === true, files: body.files.length, skill: { name: body.name } }
  return { ok: false, error: 'not_found' }
}

// ── the run ──
const live = await openLivePage().catch((e) => { console.error('○ not run: ' + e.message); process.exit(3) })
const { page } = live
const pageErrors = []
let localSkills = []
try {
  await page.send('Runtime.enable', {})
  page.on('Runtime.exceptionThrown', (p) => { pageErrors.push(String((p.exceptionDetails && (p.exceptionDetails.exception ? p.exceptionDetails.exception.description : p.exceptionDetails.text)) || 'exception').slice(0, 300)) })
  const answer = async (p) => {
    const url = new URL(p.request.url)
    const done = (status, type, text) => page.send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: status, responseHeaders: [{ name: 'content-type', value: type }, { name: 'cache-control', value: 'no-store' }], body: Buffer.from(text).toString('base64') })
    if (p.responseStatusCode !== undefined) {
      const got = await page.send('Fetch.getResponseBody', { requestId: p.requestId })
      const raw = got.result.base64Encoded ? Buffer.from(got.result.body, 'base64').toString('utf8') : got.result.body
      if (url.pathname === '/plugins/') {
        // Only the request that carries kybernos-skills must hold the exact served text; others pass through untouched.
        if (!raw.includes("id: '@local/kybernos-skills'")) return page.send('Fetch.continueRequest', { requestId: p.requestId })
        if (!raw.includes(served)) { fx.bundleMiss = true; return page.send('Fetch.continueRequest', { requestId: p.requestId }) }
        return done(200, 'application/javascript; charset=utf-8', raw.replace(served, () => mine))
      }
      // The real, read-only catalogue, with the fields the disk half would add for skills installed from a team.
      const j = JSON.parse(raw)
      const root = (j.roots.find((r) => r.writable === true) || { path: '/tmp/skills' }).path
      const ent = (name, over) => ({ name, root, source: 'user-dsh', rank: 400, writable: true, active: true, description: 'Fixture ' + name, whenToUse: '', modifiedAt: '2026-09-20T10:00:00Z', collision: false, teamVersion: null, teamModified: null, ...over })
      j.skills = j.skills.filter((s) => !['brand-voice', 'sql-review', 'onboarding-checklist'].includes(s.name)).concat([
        ent('brand-voice', { teamVersion: V.b, teamModified: false }), ent('sql-review', { teamVersion: V.c, teamModified: false }), ent('onboarding-checklist')])
      localSkills = j.skills
      return done(200, 'application/json', JSON.stringify(j))
    }
    let body = null
    try { body = p.request.postData ? JSON.parse(p.request.postData) : null } catch (e) { body = null }
    if (url.pathname.startsWith('/kybernos-cloud/team/skills')) return done(200, 'application/json', JSON.stringify(fakeTeam(p.request.method, url.pathname, url.search, body)))
    return done(200, 'application/json', JSON.stringify(fakeDisk(url.pathname, body || {})))
  }
  page.on('Fetch.requestPaused', (p) => { answer(p).catch(() => { page.send('Fetch.continueRequest', { requestId: p.requestId }) }) })
  await page.send('Fetch.enable', { patterns: [
    { urlPattern: '*plugins/??*', requestStage: 'Response' },
    { urlPattern: '*/kybernos-skills/skills*', requestStage: 'Response' },
    { urlPattern: '*/kybernos-cloud/team/skills*', requestStage: 'Request' },
    { urlPattern: '*/kybernos-skills/team/*', requestStage: 'Request' }
  ] })
  const reload = async () => { await page.send('Page.reload', { ignoreCache: true }); await sleep(1500); await waitFor(page, 'document.body && document.body.innerText.length > 80', 30000) }
  const shot = async (name) => { if (shotsDir !== null) await page.shot(join(shotsDir, name + '.png')) }
  const text = async (sel) => (await page.evalJs('(document.querySelector(' + JSON.stringify(sel) + ') || {}).innerText || ""')).val || ''
  const has = async (expr, ms) => (await waitFor(page, expr, ms || 8000)) !== null
  const q = (sel) => 'document.querySelector(' + JSON.stringify('.kbs-root ' + sel) + ')'
  const clickAt = async (x, y) => { await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }); await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }); await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }) }
  const rowButton = async (rowText, label) => {
    const r = await page.evalJs(`(() => {
      const row = Array.from(document.querySelectorAll('.kbs-root .kbs-row, .kbs-root .kbt-card')).find((e) => (e.innerText || '').includes(${JSON.stringify(rowText)}))
      if (!row) return null
      const b = Array.from(row.querySelectorAll('button')).find((x) => (x.innerText || '').trim() === ${JSON.stringify(label)} && !x.disabled)
      if (!b) return null
      b.scrollIntoView({ block: 'center' }); const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    })()`)
    if (!r.val) return false
    await clickAt(r.val.x, r.val.y)
    return true
  }
  // A real mouse click on the BUTTON whose label is exactly `label` (a count after it is ignored). `clickText` is for plain text:
  // it may match a container whose text is just that label, and click the middle of the container.
  const clickBtn = async (within, label) => {
    const r = await page.evalJs(`(() => {
      const root = document.querySelector(${JSON.stringify(within)}); if (!root) return null
      const want = ${JSON.stringify(label)}
      const norm = (b) => (b.innerText || '').replace(/\\s+/g, ' ').trim()
      const b = Array.from(root.querySelectorAll('button')).find((x) => { const n = norm(x); const r = x.getBoundingClientRect(); return r.width > 4 && !x.disabled && (n === want || new RegExp('^' + want.replace(/[.*+?^$()|[\\]{}\\\\]/g, '\\\\$&') + '( [\\\\d—]+)?$').test(n)) })
      if (!b) return null
      b.scrollIntoView({ block: 'center' }); const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    })()`)
    if (!r.val) return false
    await clickAt(r.val.x, r.val.y)
    return true
  }
  // Open a skill of the table: a real click on its name (a container whose text is only that name would be clicked at its middle).
  const openRow = async (name) => {
    const r = await page.evalJs(`(() => { const n = Array.from(document.querySelectorAll('.kbs-root .kbt .kbs-row .kbt-name .n')).find((e) => e.innerText === ${JSON.stringify(name)}); if (!n) return null; n.scrollIntoView({ block: 'center' }); const r = n.getBoundingClientRect(); return { x: r.left + 20, y: r.top + r.height / 2 } })()`)
    if (!r.val) return false
    await clickAt(r.val.x, r.val.y)
    return true
  }
  const setValue = (sel, value) => page.evalJs(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); const set = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set; set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); return true })()`)
  const openSkills = async () => { await clickText(page, 'Skills'); return has(q('.kbsub-group').replace('querySelector', 'querySelector') + ' !== null', 12000) }
  const lastCall = (path) => [...fx.calls].reverse().find((c) => c.path === path)

  console.log('Team tab — real GUI, this checkout\'s client, faked Team routes')
  await reload()
  check('the served bundle contains the running DSH\'s kybernos-skills client (so the swap is exact)', fx.bundleMiss !== true)
  check('the Skills panel opens', await openSkills())
  await has('/Team\\s*\\d/.test((' + q('.kbsub-group') + ' || {}).innerText || "")', 15000)
  const seg = (await text('.kbsub-group')).replace(/\s+/g, ' ')
  check('the Team segment is there with its approved count', /Team\s*4/.test(seg), seg)
  check('the Yours and Discover segments are still there', /Yours/.test(seg) && /Discover/.test(seg), seg)

  // ── member ──
  await clickBtn('.kbs-root .kbsub-group', 'Team')
  check('Team opens on the approved list', await has(q('.kbt') + ' !== null'))
  const names = (await page.evalJs(`JSON.stringify(Array.from(document.querySelectorAll('.kbs-root .kbt .kbs-row .kbt-name .n')).map((e) => e.innerText))`)).val
  check('four approved skills, in the server\'s order', names === JSON.stringify(['release-notes', 'brand-voice', 'sql-review', 'onboarding-checklist']), names)
  const rowsText = (await page.evalJs(`JSON.stringify(Array.from(document.querySelectorAll('.kbs-root .kbt .kbs-row')).map((e) => e.innerText.replace(/\\s+/g, ' ')))`)).val || '[]'
  const rows = JSON.parse(rowsText)
  check('release-notes can be installed', /Install/.test(rows[0] || ''), rows[0])
  check('brand-voice is Installed (same version as the team\'s)', /Installed/.test(rows[1] || ''), rows[1])
  check('sql-review offers Update and says which version is newer', /Update/.test(rows[2] || '') && /newer: eeeeeee/.test(rows[2] || ''), rows[2])
  check('onboarding-checklist says you have your own, and offers no Install', /You have your own/.test(rows[3] || '') && !/Install\b/.test((rows[3] || '').replace('Installed', '')), rows[3])
  check('a member sees "Approved" and "My proposals", not the admin views', /Approved/.test(await text('.kbt-subrow')) && /My proposals/.test(await text('.kbt-subrow')) && !/To review/.test(await text('.kbt-subrow')))
  check('the caption names the workspace and the role', /Acme Studio/.test(await text('.kbt-subrow')) && /you are a member/.test(await text('.kbt-subrow')))
  await shot('1-member-list')

  // install, update
  fx.calls.length = 0
  await rowButton('release-notes', 'Install')
  await sleep(900)
  const inst = lastCall('/kybernos-skills/team/install')
  check('Install fetches the skill\'s files, then asks the disk half to install them', lastCall('/kybernos-cloud/team/skills/item') !== undefined && inst !== undefined)
  check('the install carries the name, the server\'s version, the files, the team id and no replace', inst && inst.body.name === 'release-notes' && inst.body.version === V.a && inst.body.files === '4 files' && inst.body.teamId === 1 && inst.body.replace === false, inst)
  const statusRoot = JSON.parse((await page.evalJs(`fetch('/kybernos-skills/status').then((r) => r.json()).then((j) => JSON.stringify(j.roots[0].path))`)).val || 'null')
  check('the install goes to the first writable folder the host announces', inst && inst.body.root === statusRoot && /skills$/.test(statusRoot), { sent: inst && inst.body.root, status: statusRoot })
  check('a notice says it was installed', /installed/i.test(await text('.kbs-toast')), await text('.kbs-toast'))
  fx.calls.length = 0
  await rowButton('sql-review', 'Update')
  await sleep(900)
  const upd = lastCall('/kybernos-skills/team/install')
  check('Update replaces in the folder where the team skill already is', upd && upd.body.replace === true && upd.body.name === 'sql-review' && upd.body.root === (localSkills.find((s) => s.name === 'sql-review') || {}).root, upd)

  // detail
  await openRow('release-notes')
  check('opening a skill shows its files and the install panel', await has(q('.kbt-files') + ' !== null && ' + q('.kb-panel') + ' !== null'))
  const detail = await text('.kb8-page')
  check('the detail lists the four files, SKILL.md first, and previews SKILL.md', /SKILL\.md/.test(detail) && /style-guide\.md/.test(detail) && /examples\/2026-09\.md/.test(detail) && /Group them: Features/.test(detail), detail.slice(0, 300))
  check('the detail offers the writable folders, not a placeholder', /\/skills/.test((await page.evalJs(`(document.querySelector('.kbs-root .kb-panel select') || {}).innerText || ''`)).val || ''), (await page.evalJs(`(document.querySelector('.kbs-root .kb-panel select') || {}).innerText || ''`)).val)
  check('a small file is shown in bytes, not as 0 KB', !/\b0 KB\b/.test(detail) && /\b\d+ B\b/.test(detail), detail)
  check('it states what is checked before anything is written', /checked before anything is written/i.test(detail) && /nothing is overwritten/i.test(detail), detail)
  await clickText(page, 'style-guide.md', { within: '.kbs-root .kbt-files' })
  check('picking another file shows its content', /Past tense, one line each/.test(await text('.kbt-code')), await text('.kbt-code'))
  await shot('2-detail')
  check('the back link returns to the list', await clickBtn('.kbs-root', 'Team skills') && await has(q('.kbt') + ' !== null'))
  await shot('2b-back')

  // propose
  await clickBtn('.kbs-root', 'Propose a skill')
  check('Propose opens the sheet', await has(q('.kbt-sheet') + ' !== null'), pageErrors)
  if (pageErrors.length > 0) console.log('    page errors:', pageErrors)
  const options = (await page.evalJs(`JSON.stringify(Array.from(document.querySelectorAll('.kbs-root .kbt-sheet select option')).map((o) => [o.value, o.innerText]))`)).val
  const opts = JSON.parse(options || '[]').filter((o) => o[0] !== '')
  check('the sheet offers the user\'s own skills of the writable folders', opts.length > 0, opts.length)
  check('submitting is not possible before a skill is chosen', (await page.evalJs(`Array.from(document.querySelectorAll('.kbs-root .kbt-sheet button')).find((b) => /Propose to the team/.test(b.innerText)).disabled`)).val === true)
  const okOpt = opts.find((o) => !/old-|brand-voice|sql-review|onboarding/.test(o[1])) || opts[0]
  const badOpt = opts.find((o) => o !== okOpt && !/brand-voice|sql-review|onboarding/.test(o[1]))
  fx.packBad = badOpt === undefined ? null : badOpt[1].split(' · ')[0]
  await setValue('.kbs-root .kbt-sheet select', okOpt[0])
  check('choosing a skill reads it through the disk half and lists what will be sent', await has(q('.kbt-sheet .kbt-files') + ' !== null') && /SKILL\.md/.test(await text('.kbt-sheet')) && /No secret found/.test(await text('.kbt-sheet')), await text('.kbt-sheet'))
  await shot('3-propose')
  if (badOpt !== undefined) {
    await setValue('.kbs-root .kbt-sheet select', badOpt[0])
    check('a skill that fails a check shows the file and line, and cannot be sent', await has(q('.kbt-banner.err') + ' !== null') && /scripts\/deploy\.sh, line 12/.test(await text('.kbt-sheet')) && (await page.evalJs(`Array.from(document.querySelectorAll('.kbs-root .kbt-sheet button')).find((b) => /Propose to the team/.test(b.innerText)).disabled`)).val === true, await text('.kbt-sheet'))
    await shot('4-propose-blocked')
    await setValue('.kbs-root .kbt-sheet select', okOpt[0])
    await has(q('.kbt-sheet .kbt-files') + ' !== null')
  }
  await setValue('.kbs-root .kbt-sheet textarea', 'for the retro')
  fx.calls.length = 0
  await clickBtn('.kbs-root .kbt-sheet', 'Propose to the team')
  await sleep(1200)
  const add = lastCall('/kybernos-cloud/team/skills/add')
  check('Propose sends name, description, files and the note — nothing else', add && add.body.name === okOpt[1].split(' · ')[0] && Array.isArray(add.body.files) && add.body.files.length === 2 && add.body.note === 'for the retro' && Object.keys(add.body).sort().join() === 'description,files,name,note', add)
  check('the sheet closes, a notice says an admin will review, and the tab lands on My proposals', !(await has(q('.kbt-sheet') + ' !== null', 800)) && /admin will review/.test(await text('.kbs-toast')) && /My proposals/.test(await text('.kbt-subrow')) && (await page.evalJs(`document.querySelector('.kbs-root .kbt-subrow .kb-seg.on').innerText`)).val.includes('My proposals'), await text('.kbs-toast'))
  const mineRows = JSON.parse((await page.evalJs(`JSON.stringify(Array.from(document.querySelectorAll('.kbs-root .kbt .kbs-row')).map((e) => e.innerText.replace(/\\s+/g, ' ')))`)).val || '[]')
  check('My proposals shows pending ones with Withdraw, and a refusal with its reason', mineRows.some((r) => /Withdraw/.test(r)) && mineRows.some((r) => /Overlaps with brand-voice/.test(r)), mineRows)
  await shot('5-my-proposals')
  fx.calls.length = 0
  await rowButton('incident-report', 'Withdraw')
  await sleep(800)
  check('Withdraw deletes only your own pending proposal', lastCall('/kybernos-cloud/team/skills/delete') !== undefined && lastCall('/kybernos-cloud/team/skills/delete').body.id === 6, fx.calls)

  // ── admin ──
  fx.role = 'admin'
  fx.rows.push(base(6, 'incident-report', 'Writes an incident report from a timeline', V.g, { status: 'proposed', proposed_by_name: 'Ana Costa', proposed_at: '2026-10-05T17:10:00Z', reviewed_by_name: null, reviewed_at: null, note: 'Used for the September outage retro.', files: 3 }))
  await clickBtn('.kbs-root .kbsub-group', 'Yours'); await sleep(300)
  await clickBtn('.kbs-root .kbsub-group', 'Team'); await sleep(900)
  check('an admin sees a dot on Team when proposals wait', await has(q('.kbsub-group .kbt-dot') + ' !== null'))
  check('an admin sees Approved, To review and Retired, and the "Add a skill" button', /To review/.test(await text('.kbt-subrow')) && /Retired/.test(await text('.kbt-subrow')) && /Add a skill/.test(await text('.kbs-ctlrow')), await text('.kbt-subrow'))
  await clickBtn('.kbs-root .kbt-subrow', 'To review')
  check('the review queue shows both proposals with their files', await has(q('.kbt-card .kbt-files') + ' !== null') && document_count(await text('.kb8-page'), /Approve/g) >= 2, await text('.kb8-page'))
  const queue = await text('.kb8-page')
  check('the queue warns that skills are instructions and that approvals cannot be edited', /Open the files before you approve/.test(queue) && /cannot be edited/.test(queue))
  check('an update says it is an update and shows what changed', /Update/.test(queue) && (await page.evalJs(`document.querySelectorAll('.kbs-root .kbt-code .add').length`)).val >= 1 && /Breaking changes/.test(queue), queue.slice(0, 300))
  check('a skill that comes with a script says so', /contains a script/.test(queue))
  await shot('6-admin-review')
  fx.calls.length = 0
  await rowButton('incident-report', 'Reject…')
  check('Reject… asks why before it does anything', await has(q('.kbt-card textarea') + ' !== null') && lastCall('/kybernos-cloud/team/skills/review') === undefined)
  await setValue('.kbs-root .kbt-card textarea', 'Please drop the script')
  await rowButton('incident-report', 'Reject')
  await sleep(900)
  const rej = lastCall('/kybernos-cloud/team/skills/review')
  check('rejecting sends the decision and the note', rej && rej.body.id === 6 && rej.body.decision === 'reject' && rej.body.note === 'Please drop the script', rej)
  fx.calls.length = 0
  await rowButton('release-notes', 'Approve')
  await sleep(900)
  const appr = lastCall('/kybernos-cloud/team/skills/review')
  check('approving sends only the id and the decision (the files cannot be edited)', appr && appr.body.id === 5 && appr.body.decision === 'approve' && Object.keys(appr.body).sort().join() === 'decision,id', appr)
  await rowButton('ai-team-creator', 'Approve')
  await sleep(900)
  check('the queue is then empty and says so', await has(q('.kb-empty') + ' !== null && /Nothing to review/.test(' + q('.kb-empty') + '.innerText)'), await text('.kb8-page'))
  await shot('6b-queue-empty')
  await clickBtn('.kbs-root .kbt-subrow', 'Approved')
  await has(q('.kbt .kbs-row') + ' !== null')
  await openRow('sql-review')
  await has(q('.kbt-files') + ' !== null')
  await shot('8-admin-detail')
  check('an admin can retire an approved skill from its page, after a confirmation', /Retire from the team/.test(await text('.kb8-page')), await text('.kb8-page'))
  await clickBtn('.kbs-root', 'Retire from the team')
  check('the confirmation says what retiring does', await has('/Members who installed it keep their copy/.test(document.querySelector(".kbs-root .kb-panel").innerText)'))
  fx.calls.length = 0
  await clickBtn('.kbs-root .kb-panel', 'Retire')
  await sleep(900)
  check('retiring calls the server once with the skill id', lastCall('/kybernos-cloud/team/skills/retire') !== undefined && lastCall('/kybernos-cloud/team/skills/retire').body.id === 3, fx.calls)

  // ── the other segments still work ──
  await clickBtn('.kbs-root .kbsub-group', 'Yours')
  check('Yours still lists the user\'s skills as cards, with the Add menu and no Team toolbar', await has(q('.kb8-grid .kb8-card') + ' !== null') && /Create a skill|Créer/.test(await text('.kbs-top')) && !/Propose a skill|Add a skill/.test(await text('.kbs-top') + await text('.kbs-ctlrow')), await text('.kbs-top'))
  await shot('9-yours')
  await clickBtn('.kbs-root .kbsub-group', 'Discover')
  check('Discover renders (the ranking, or the "unavailable" panel) and no longer offers to reconnect a Vercel token', await has('/Index unavailable|Discover|SKILL|Querying/.test(' + q('.kb8-page') + '.innerText)', 20000) && !/Reconnect the index|Vercel/.test(await text('.kb8-page')), await text('.kb8-page'))
  await shot('9b-discover')
  // ── locked and absent states ──
  for (const [code, want] of [['offre_requise', /part of the Team plan/], ['non connecte', /Sign in to Kybernos Cloud/], ['aucun_espace', /Switch to a team workspace/], ['not_on_this_server', /Not available on this server/], ['reconnect_required', /session has expired/]]) {
    fx.lock = code
    await clickBtn('.kbs-root .kbsub-group', 'Yours'); await sleep(300)
    await clickBtn('.kbs-root .kbsub-group', 'Team'); await sleep(900)
    check('locked "' + code + '" explains itself and offers a way back', want.test(await text('.kb8-page')) && /Back to Yours/.test(await text('.kb8-page')), await text('.kb8-page'))
    const link = (await page.evalJs(`(() => { const a = Array.from(document.querySelectorAll('.kb8-page a')).find((x) => /Team plan/.test(x.innerText)); return a ? { href: a.getAttribute('href'), target: a.getAttribute('target'), rel: a.getAttribute('rel') } : null })()`)).val
    if (code === 'offre_requise') {
      check('the plan lock offers the plans page, in a new tab, without handing the opener over', link !== null && link.href === 'https://kybernos.app/billing' && link.target === '_blank' && /noopener/.test(link.rel), link)
      await shot('7-locked')
    } else check('"' + code + '" does not send anyone to the plans page', link === null, link)
  }
  check('the lock shows on the segment', (await page.evalJs(`!!document.querySelector('.kbs-root .kbsub-group .kb-seg:nth-child(3) svg')`)).val === true)
  fx.lock = null

  check('no script error was thrown by the page during the run', pageErrors.length === 0, pageErrors)
} finally {
  await live.close()
}
function document_count (s, re) { return (s.match(re) || []).length }
console.log('\n' + pass + ' checks passed' + (failures.length > 0 ? ', ' + failures.length + ' FAILED' : ''))
process.exit(failures.length > 0 ? 1 : 0)

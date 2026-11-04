#!/usr/bin/env node
// J15-12: a creation made in a team. Who sees it, who edits it, what the Share sheet promises, what a removed member keeps.
//
//   export KB_E2E_API=… KB_E2E_WEB=… KB_E2E_CONTROL=… KB_E2E_DIR=… KB_SERVER_DIR=…        (a replica made by scripts/user-journey-replica.sh)
//   export KB_PROXY_LOG=<file of scripts/recording-proxy.mjs in front of the replica>       (the sandbox DSH talks to the proxy; nothing reaches it for a local choice)
//   KB_SANDBOX_ROOT=… KB_SANDBOX_PORT=… source scripts/sandbox/env.sh                       (a sandbox signed in to that replica as account a, the owner of teams.t1)
//   node scripts/check-creation-share-live.mjs [--out <folder>]
//
// Two halves. SERVER: a creation pushed from the team (`push.workspace_id`) is read, listed and edited by its author and nobody else, a link is the only way to share it, and the
// link outlives the removal of a member. SCREEN: in the team's own desktop window (account a) the Creations tile, its « Share… » sheet and the project's sheet are read and measured:
// what each level says, what is saved where, and which requests reach the server. A check is `ok` when the measured fact is the one written in its name; the file says what IS, the lead
// decides what is a defect. Made-up accounts only; the replica is local. Sandbox only: it refuses :3080 (exit 3) and any DSH home that is not under .kybernos-sandbox.
// Exit 0 = every check passed, 1 = a check failed, 3 = wrong environment. Report: <out>/report.json.
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { cookieDeSession } from './cdp-lib.mjs'
import { makeServer, readAccounts, fresh } from './lib-e2e-server.mjs'
import { openGui, readProxy, sleep } from './lib-e2e-gui.mjs'

const arg = (n, d) => (process.argv.indexOf(n) >= 0 ? process.argv[process.argv.indexOf(n) + 1] : d)
const host = process.env.KB_HOST || ''
const home = process.env.DSH_HOME || ''
if (host === '' || /:3080$/.test(host) || !home.includes('.kybernos-sandbox')) { console.error('not run: source scripts/sandbox/env.sh of a sandbox first (KB_HOST=' + host + ')'); process.exit(3) }
if (!process.env.KB_E2E_API || !process.env.KB_E2E_DIR || !process.env.KB_PROXY_LOG) { console.error('not run: KB_E2E_* and KB_PROXY_LOG are not set'); process.exit(3) }
const out = arg('--out', join(process.env.KB_E2E_DIR, '..', 'j15-12'))
mkdirSync(out, { recursive: true })

const S = makeServer()
const acc = readAccounts(S.e)
if (!acc.a || !acc.c || !acc.teams || !acc.teams.t1) { console.error('not run: accounts.json needs a, c and teams.t1'); process.exit(3) }
const t1 = acc.teams.t1
const results = []
const report = { server: {}, screen: {} }
const check = (name, ok, detail) => { results.push({ name, ok: ok === true, detail }); console.log((ok === true ? '  ok   ' : '  FAIL ') + name + (ok === true || detail === undefined ? '' : '  -> ' + JSON.stringify(detail).slice(0, 300))); return ok === true }
const note = (t) => console.log('  ..   ' + t)
const personalCookie = (() => { const c = cookieDeSession(host); return c === null ? null : c.nom + '=' + c.valeur })()
if (personalCookie === null) { console.error('not run: no browser-session secret for this DSH_HOME'); process.exit(3) }
const personal = async (method, path, body) => (await fetch('http://' + host + path, { method, headers: { 'content-type': 'application/json', cookie: personalCookie, origin: 'http://' + host }, body: method === 'GET' ? undefined : JSON.stringify(body || {}) })).json()
const st = await personal('GET', '/kybernos-cloud/status')
const A = await S.signIn(acc.a.email, acc.a.password)
const pairedAsA = st.connected === true && st.state && st.state.user && st.state.user.email === acc.a.email
if (pairedAsA !== true) { console.error('not run: the sandbox is not paired to account a (node scripts/e2e-connect.mjs --dsh ' + host + ' --account a)'); process.exit(3) }

const stamp = Date.now().toString(36)
const title = 'Share check ' + stamp
const row = (r) => ({ status: r.status, body: JSON.stringify(r.body).slice(0, 160) })
let g = null
try {
  // ── SERVER: who sees a creation pushed from the team ────────────────────────────────────────────────────────────────────────────
  console.log('\n1. server: a creation pushed from the team')
  const mk = async (label) => { const a = fresh(label); a.email = a.email.replace('@example.test', '@replica.test'); await S.signUp(a.email, a.password, a.name); a.s = await S.signIn(a.email, a.password); return a }
  const M = await mk('shareteammate')
  await S.call('POST', `/v1/workspaces/${t1.id}/invitations`, { cookie: A.cookie, json: { email: M.email, role: 'member' } })
  const inviteMail = await S.mail(M.email)
  const token = new URL(inviteMail.text.match(/https?:\/\/\S+/)[0]).searchParams.get('token')
  check('a teammate joins the team with the link of his invitation', (await S.call('POST', '/v1/invitations/accept', { cookie: M.s.cookie, json: { token } })).status === 200)
  const C = await S.signIn(acc.c.email, acc.c.password)   // C left the team in an earlier run (or never joined): he is not a member
  // the server keeps ONE artifact per content (a push of the same bytes answers `created: false` with the older one): the stamp makes this run's bytes its own
  const md = Buffer.from('# Plan\n\nA made-up plan A wrote inside the team. Run ' + stamp + '.\n').toString('base64')
  const push = await S.call('POST', '/v1/artifacts', { cookie: A.cookie, json: { deliverable_type: 'note', title, filename: 'share-check-' + stamp + '.md', mime: 'text/markdown', content_b64: md, push: { workspace_id: t1.id } } })
  const id = push.body && push.body.artifact && push.body.artifact.id
  check('A pushes a creation stamped with the team (a new artifact, not an older one with the same bytes)', (push.status === 200 || push.status === 201) && push.body && push.body.created === true, row(push))
  const views = {}
  for (const [who, u] of [['A', A], ['M', M.s], ['C', C]]) {
    const list = await S.call('GET', '/v1/artifacts', { cookie: u.cookie })
    const items = (list.body && (list.body.artifacts || list.body.items)) || []
    views[who] = { list: list.status, listed: items.some((x) => x.id === id), get: (await S.call('GET', '/v1/artifacts/' + id, { cookie: u.cookie })).status, content: (await S.call('GET', `/v1/artifacts/${id}/content`, { cookie: u.cookie })).status, edit: (await S.call('PATCH', '/v1/artifacts/' + id, { cookie: u.cookie, json: { title: 'changed by ' + who } })).status }
  }
  report.server.views = views
  note('who sees it: ' + JSON.stringify(views))
  check('the author lists and reads it', views.A.listed === true && views.A.get === 200 && views.A.content === 200, views.A)
  check('a teammate does not list it and cannot read it', views.M.listed === false && views.M.get === 404 && views.M.content === 404, views.M)
  check('a person who is not in the team cannot read it', views.C.listed === false && views.C.get === 404 && views.C.content === 404, views.C)
  check('nobody can edit it through the server: no edit route answers (404/405)', ['A', 'M', 'C'].every((w) => views[w].edit === 404 || views[w].edit === 405), views)
  const share = await S.call('POST', '/v1/shares', { cookie: A.cookie, json: { resource_type: 'artifact', resource_id: id, audience: 'link' } })
  const slug = share.body && share.body.share && share.body.share.slug
  report.server.share = { status: share.status, audience: share.body && share.body.share && share.body.share.audience }
  check('the only server way to share it is a link (audience « link »)', share.status === 200 && report.server.share.audience === 'link', row(share))
  const open = async (cookie) => { const r = await fetch(S.e.web + '/s/' + slug, { headers: cookie ? { cookie } : {} }); return { status: r.status, shown: (await r.text()).includes('A made-up plan') } }
  const seen = { signedOut: await open(null), teammate: await open(M.s.cookie), outsider: await open(C.cookie) }
  check('the link shows the creation to a signed-out visitor, to a teammate and to a person outside the team', Object.values(seen).every((x) => x.status === 200 && x.shown === true), seen)

  // ── SCREEN: the team's own desktop, account a ───────────────────────────────────────────────────────────────────────────────────
  console.log('\n2. screen: the creation in the team window')
  const opened = await personal('POST', '/kybernos-cloud/team-dsh/open', { workspace_id: t1.id })
  check('the team has a desktop of its own and it started', opened.ok === true && typeof opened.url === 'string', opened)
  const teamHost = new URL(opened.url).host
  const teamHome = join(home, 'teams', t1.id)
  const was = process.env.DSH_HOME
  process.env.DSH_HOME = teamHome
  g = await openGui(teamHost)
  process.env.DSH_HOME = was
  await sleep(3500)
  const card = await g.card()
  check('the team window names the team and the account', !!card && card.text.includes(t1.name) && card.text.includes(acc.a.name), card)
  // the creation list: the pushed creation is a tile named with its file name; the list reads it from the server store
  // Creations: pushed to the server a moment ago; the tile carries the title
  await g.pressText('Creations')
  const tile = await g.until(async () => g.val(`(() => { const c = Array.from(document.querySelectorAll('.kb6-card')).find((e) => /${stamp}/i.test(e.innerText || '')); if (!c) return null; const r = c.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, text: (c.innerText || '').replace(/\\s+/g, ' ').trim() } })()`), 15000)
  if (!check('the creation pushed from the team is a tile of Creations in the team window', !!tile && tile.err === undefined, tile)) throw new Error('no tile: the screen half cannot go on')
  await g.shot(join(out, 'c1-creations.png'))
  report.screen.tile = tile
  const countOf = () => g.val(`(() => { const e = Array.from(document.querySelectorAll('button')).find((b) => /^All\\s*\\d+/.test((b.innerText || '').replace(/\\s+/g, ' ').trim())); return e ? e.innerText.replace(/\\s+/g, ' ').trim() : null })()`)
  const countBefore = await countOf()
  const menuButton = async () => g.val(`(() => { const c = Array.from(document.querySelectorAll('.kb6-card')).find((e) => /${stamp}/i.test(e.innerText || '')); if (!c) return null; const bs = Array.from(c.querySelectorAll('.kb6-cardrow button')); const b = bs[bs.length - 1]; if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, label: (b.getAttribute('aria-label') || b.title || '').slice(0, 40) } })()`)
  await g.mouse(tile.x + 60, tile.y + 40); await sleep(500)
  const mb = await menuButton()
  await g.mouse(mb.x, mb.y); await sleep(800)
  const menuItems = await g.until(async () => { const m = await g.val(`Array.from(document.querySelectorAll('[role="menu"] *, [role="menuitem"], .kb6-menu *')).filter((e) => e.children.length === 0).map((e) => (e.innerText || '').trim()).filter(Boolean)`); return Array.isArray(m) && m.length > 0 ? m : null }, 4000)
  report.screen.menu = menuItems
  note('the tile menu says ' + JSON.stringify(menuItems))
  check('the tile menu has « Share… »', Array.isArray(menuItems) && menuItems.includes('Share…'), menuItems)
  await g.pressText('Share…'); await sleep(1800)
  const sheet = async () => g.val(`(() => { const c = document.querySelector('[data-kb="share-card"]'); if (!c) return null; const r = c.getBoundingClientRect(); const row = (k) => { const e = c.querySelector('[data-kb="share-level-' + k + '"]'); if (!e) return null; const q = e.getBoundingClientRect(); return { text: (e.innerText || '').replace(/\\s+/g, ' ').trim(), disabled: e.disabled === true, on: e.getAttribute('aria-pressed'), h: Math.round(q.height) } }; return { title: ((c.querySelector('h3') || {}).innerText || '').trim(), text: (c.innerText || '').replace(/\\s+/g, ' ').trim(), rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)], me: row('me'), team: row('team'), public: row('public'), selects: Array.from(c.querySelectorAll('select')).length, link: ((c.querySelector('[data-kb="share-link"]') || {}).innerText || null), status: Array.from(c.querySelectorAll('[role="status"]')).map((e) => e.innerText.trim()), foot: ((c.querySelector('[data-kb="share-copy-link"]') || {}).innerText || '').trim() } })()`)
  const s0 = await sheet()
  report.screen.sheetOpen = s0
  await g.shot(join(out, 'c2-share-sheet.png'))
  check('the file sheet has three levels: Private, Team access (badge « Local ») and Public access, and no control for who may edit', !!s0 && s0.me !== null && s0.team !== null && s0.public !== null && /Local/.test(s0.team.text) && s0.selects === 0, s0)
  check('Team access reads « Visible to members of ' + t1.name + ' »', !!s0 && s0.team !== null && s0.team.text.includes('Visible to members of ' + t1.name), s0 && s0.team)
  const t0 = Date.now()
  await g.press('[data-kb="share-level-team"]'); await sleep(1800)
  const s1 = await sheet()
  report.screen.sheetTeam = s1
  await g.shot(join(out, 'c3-team-access.png'))
  note('after Team access the sheet says ' + JSON.stringify(s1 && s1.text))
  check('choosing Team access says it is saved on this device only, shows a link and changes the button to « Copy link »', !!s1 && /Saved on this device only/.test(s1.text) && typeof s1.link === 'string' && /Copy link/.test(s1.foot), s1)
  // what matters is a WRITE, or any request that names a share or an artifact: the page's own background reads (workspaces, me, memories) are not about the sheet
  const aboutShare = (r) => r.method !== 'GET' || /share|artifact/i.test(r.path)
  const calls = readProxy(process.env.KB_PROXY_LOG, t0).filter(aboutShare)
  report.screen.serverCallsOnTeamAccess = calls.map((r) => r.method + ' ' + r.path + ' ' + r.status)
  check('no write and no share or artifact request reaches the server when Team access is chosen', calls.length === 0, report.screen.serverCallsOnTeamAccess)
  const sharesFile = join(teamHome, '.kyber-shares.json')
  const rec = existsSync(sharesFile) ? JSON.parse(readFileSync(sharesFile, 'utf8')) : {}
  const entry = Object.entries(rec).find(([k]) => k.includes(id))
  report.screen.record = entry ? { access: entry[1].access, role: entry[1].role } : null
  check('the choice is a record in the team home on this computer: access « team », role « view »', !!entry && entry[1].access === 'team' && entry[1].role === 'view', report.screen.record)
  const link = s1 && s1.link
  const tokenPart = typeof link === 'string' ? link.split('/kybernos/s/')[1] : null
  const origin = typeof link === 'string' ? link.split('/kybernos/s/')[0] : null
  report.screen.linkOrigin = origin
  check('the link the sheet gives is an address of this computer (127.0.0.1 or localhost), not of the server', typeof origin === 'string' && /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin), origin)
  if (tokenPart) {
    const r = await fetch(link)
    const body = await r.text()
    report.screen.linkOpened = { status: r.status, text: body.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200) }
    note('the link opened with no session answers ' + JSON.stringify(report.screen.linkOpened))
    const elsewhere = await fetch('http://' + host + '/kybernos/s/' + tokenPart)
    report.screen.linkOnOtherDesktop = elsewhere.status
    check('the same token on the personal desktop of this computer answers 404 (the link belongs to the team desktop that served it)', elsewhere.status === 404, elsewhere.status)
  }
    const mStill = await S.call('GET', '/v1/artifacts/' + id, { cookie: M.s.cookie })
  check('a teammate who is in the team right now still cannot open it (404), whatever the Team access of the sheet says', mStill.status === 404, mStill.status)
  // the removal comes after the screen: the teammate is a member while the sheet is used
  check('A removes the teammate from the team', (await S.call('DELETE', `/v1/workspaces/${t1.id}/members/${M.s.id}`, { cookie: A.cookie })).status === 204)
  const after = await open(M.s.cookie)
  const anon = await open(null)
  report.server.afterRemoval = { removedMemberWithLink: after, signedOut: anon }
  check('after the removal the same link still shows the creation (to the removed member and to anyone)', after.status === 200 && after.shown === true && anon.shown === true, report.server.afterRemoval)
  const revokeByRemoved = await S.call('POST', '/v1/shares/revoke', { cookie: M.s.cookie, json: { resource_type: 'artifact', resource_id: id } })
  const revokeByAuthor = await S.call('POST', '/v1/shares/revoke', { cookie: A.cookie, json: { resource_type: 'artifact', resource_id: id } })
  report.server.revoke = { removed: row(revokeByRemoved), author: row(revokeByAuthor), linkAfter: (await open(null)).status }
  check('the removed member cannot turn the link off (count 0), only its author can (count 1), then the link answers 404', revokeByRemoved.body && revokeByRemoved.body.count === 0 && revokeByAuthor.body && revokeByAuthor.body.count === 1 && report.server.revoke.linkAfter === 404, report.server.revoke)
  // the Help of the sheet
  await g.press('[data-kb="share-help"]'); await sleep(500)
  const help = await g.text('[data-kb="share-help-body"]')
  report.screen.help = help
  note('the sheet help says ' + JSON.stringify(help))
  await g.press('[data-kb="share-level-me"]'); await sleep(1500)
  const s2 = await sheet()
  report.screen.sheetPrivateAgain = s2
  if (tokenPart) { const dead = await fetch(link); check('back to Private the link stops working (404)', dead.status === 404, dead.status) }
  check('back to Private the sheet says « Back to private » or shows no link', !!s2 && (s2.link === null || s2.link === ''), s2)
  await g.press('[data-kb="share-close"]'); await sleep(400)

  // ── SCREEN: the project's sheet (Team access Off / Can view / Can edit) ─────────────────────────────────────────────────────────
  console.log('\n3. screen: the project sheet')
  await g.pressText('Workspaces'); await sleep(2000)
  check('the Workspaces page has a Share button', await g.press('[data-kb="action-share"]'))
  await sleep(1800)
  const ps = async () => g.val(`(() => { const c = document.querySelector('[data-kb="share-card"]'); if (!c) return null; return { title: ((c.querySelector('h3') || {}).innerText || '').trim(), text: (c.innerText || '').replace(/\\s+/g, ' ').trim(), selects: Array.from(c.querySelectorAll('select')).map((s) => ({ opts: Array.from(s.options).map((o) => o.textContent), val: s.value })), status: Array.from(c.querySelectorAll('[role="status"]')).map((e) => e.innerText.trim()) } })()`)
  const p0 = await ps()
  report.screen.projectSheet = p0
  await g.shot(join(out, 'c4-project-sheet.png'))
  const teamSel = p0 && p0.selects.find((s) => s.opts.includes('Can edit'))
  check('the project sheet has Team access with Off / Can view / Can edit, « Local » badge and « Everyone in ' + t1.name + ' »', !!teamSel && teamSel.opts.join('|') === 'Off|Can view|Can edit' && /Local/.test(p0.text) && p0.text.includes('Everyone in ' + t1.name), p0)
  const setTeam = (v) => g.val(`(() => { const c = document.querySelector('[data-kb="share-card"]'); const sel = Array.from(c.querySelectorAll('select')).find((s) => Array.from(s.options).some((o) => o.value === 'edit')); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(sel, ${JSON.stringify(v)}); sel.dispatchEvent(new Event('change', { bubbles: true })); return sel.value })()`)
  const t2 = Date.now()
  const trail = {}
  for (const v of ['view', 'edit', 'off']) { await setTeam(v); await sleep(1400); const x = await ps(); trail[v] = { said: x.status, saved: /Saved on this device only/.test(x.text) } }
  await g.shot(join(out, 'c5-project-after.png'))
  report.screen.projectTrail = trail
  const calls2 = readProxy(process.env.KB_PROXY_LOG, t2).filter(aboutShare)
  report.screen.serverCallsOnProject = calls2.map((r) => r.method + ' ' + r.path + ' ' + r.status)
  check('Can view and Can edit are saved with « Team access saved (local) » and the local-only note', trail.view.said.includes('Team access saved (local)') && trail.edit.said.includes('Team access saved (local)') && trail.view.saved === true && trail.edit.saved === true, trail)
  check('no write and no share or artifact request reaches the server when the project is set to Can view, Can edit or Off', calls2.length === 0, report.screen.serverCallsOnProject)
  await g.pressText('What’s shared?'); await sleep(500)
  const p1 = await ps()
  const shared = /Shared with all members\s+(.*?)\s+Stays personal\s+(.*?)\s+(Member|Administrator|Invite)/.exec(p1.text)
  report.screen.whatsShared = shared ? { shared: shared[1], personal: shared[2] } : p1.text
  note('« What’s shared? » says ' + JSON.stringify(report.screen.whatsShared))
  check('« What’s shared? » promises « the project’s creations » to all members', !!shared && /creations/.test(shared[1]), report.screen.whatsShared)
  await g.press('[data-kb="share-close"]'); await sleep(500)
  if (await g.exists('[data-kb="share-card"]')) { await g.key('Escape', 'Escape', 27); await sleep(500) }

  // ── SCREEN: what the agent writes into the team folder is not a creation of the team window ───────────────────────────────────
  console.log('\n4. screen: a file the agent writes into the team folder')
  const folders = JSON.parse(readFileSync(join(was, 'kybernos-cloud-folders.json'), 'utf8'))
  const teamFolder = folders[t1.id]
  check('the team has a folder on this computer', typeof teamFolder === 'string' && existsSync(teamFolder), teamFolder && '<folder>')
  try { report.screen.workspacePath = JSON.parse(readFileSync(join(teamHome, 'storages', 'workspace.json'), 'utf8')).tables.workspaces[Object.keys(JSON.parse(readFileSync(join(teamHome, 'storages', 'workspace.json'), 'utf8')).tables.workspaces)[0]].path } catch (e) { report.screen.workspacePath = null }
  await g.pressText('New chat'); await sleep(2000)
  if (!(await g.until(() => g.composerPos(), 8000))) { await g.shot(join(out, 'c6-no-composer.png')); note('no composer after « New chat »: ' + JSON.stringify((await g.body()).replace(/\s+/g, ' ').slice(0, 300))) }
  await g.selectModel('GLM').catch((e) => note('model: ' + e.message))
  const target = join(teamFolder, 'artifacts', 'roadmap-' + stamp + '.md')
  await fetch('http://' + new URL(process.env.DSH_API || 'http://localhost:8853').host + '/__proxy/script', { method: 'POST', body: JSON.stringify({ tool_calls: [{ name: 'write', arguments: { file_path: target, content: '# Roadmap\n\nMade-up roadmap of the journey team.\n' } }] }) })
  await g.send('Write the team roadmap into our artifacts folder')
  await g.until(async () => existsSync(target), 30000)
  check('the agent wrote the file into the team folder (on disk)', existsSync(target), existsSync(target))
  await sleep(2500)
  await g.pressText('Creations'); await sleep(5000)
  const countAfter = await countOf()
  const listed = await g.val(`Array.from(document.querySelectorAll('.kb6-card .kbg-name')).map((e) => e.innerText.trim())`)
  report.screen.agentFile = { countBefore, countAfter, listed }
  await g.shot(join(out, 'c6-creations-after-write.png'))
  note('Creations before ' + countBefore + ', after ' + countAfter + ', tiles ' + JSON.stringify(listed))
  check('the file the agent wrote in the team folder is a tile of the team window\'s Creations', Array.isArray(listed) && listed.some((n) => n.includes('roadmap-' + stamp)), report.screen.agentFile)
} catch (e) {
  check('the run reached its end', false, String(e && e.stack || e).slice(0, 400))
} finally {
  try { if (g !== null) await g.close() } catch (e) { /* page already gone */ }
}
writeFileSync(join(out, 'report.json'), JSON.stringify({ at: new Date().toISOString(), results, ...report }, null, 2))
const bad = results.filter((r) => !r.ok)
console.log('\n' + (results.length - bad.length) + '/' + results.length + ' ok; report ' + join(out, 'report.json'))
process.exit(bad.length === 0 ? 0 : 1)

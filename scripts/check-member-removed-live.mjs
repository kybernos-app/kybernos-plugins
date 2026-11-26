#!/usr/bin/env node
// J09-05: a member is removed from a team while his desktop is open on it. What does B's desktop show each minute for five minutes, and which door of the team
// answers him after the removal: the team in his list, the members, the team's computers, a team skill, the team space; then C leaves by himself and the last owner cannot.
//
//   export KB_E2E_API=… KB_E2E_WEB=… KB_E2E_CONTROL=… KB_E2E_DIR=… KB_SERVER_DIR=…        (a replica made by scripts/user-journey-replica.sh)
//   export KB_PROXY_LOG=<file of scripts/recording-proxy.mjs in front of the replica>       (the sandbox DSH talks to the proxy)
//   KB_SANDBOX_ROOT=… KB_SANDBOX_PORT=… source scripts/sandbox/env.sh                       (a sandbox signed in to that replica as account b)
//   node scripts/check-member-removed-live.mjs [--out <folder>] [--minutes 5]
//
// KB_E2E_DIR/accounts.json holds a (owner of the team), b (the member whose desktop is open), c (a second member), teams.t1 = { id, name }; the invitation of b into t1 is in the mailbox
// or b is already a member. Everything is made up and nothing leaves the machine. Sandbox only: it refuses :3080 (exit 3) and any DSH home that is not under .kybernos-sandbox.
// Exit 0 = every check passed, 1 = a check failed, 3 = wrong environment. The report is <out>/report.json (what was seen, one entry per minute).
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { cookieDeSession } from './cdp-lib.mjs'
import { makeServer, readAccounts } from './lib-e2e-server.mjs'
import { openGui, readProxy, chatCalls, sleep } from './lib-e2e-gui.mjs'

const arg = (n, d) => (process.argv.indexOf(n) >= 0 ? process.argv[process.argv.indexOf(n) + 1] : d)
const host = process.env.KB_HOST || ''
const home = process.env.DSH_HOME || ''
if (host === '' || /:3080$/.test(host) || !home.includes('.kybernos-sandbox')) { console.error('not run: source scripts/sandbox/env.sh of a sandbox first (KB_HOST=' + host + ')'); process.exit(3) }
if (!process.env.KB_E2E_API || !process.env.KB_E2E_DIR || !process.env.KB_PROXY_LOG) { console.error('not run: KB_E2E_* and KB_PROXY_LOG are not set'); process.exit(3) }
const out = arg('--out', join(process.env.KB_E2E_DIR, '..', 'j09-05'))
const minutes = Number(arg('--minutes', '5'))
const resume = process.argv.includes('--resume')   // B was already removed by an earlier run that stopped early: look once more, then play the last part
mkdirSync(out, { recursive: true })

const S = makeServer()
const acc = readAccounts(S.e)
if (!acc.a || !acc.b || !acc.c || !acc.teams || !acc.teams.t1) { console.error('not run: accounts.json needs a, b, c and teams.t1'); process.exit(3) }
const t1 = acc.teams.t1
const results = []
const report = {}
const timeline = []
const check = (name, ok, detail) => { results.push({ name, ok: ok === true, detail }); console.log((ok === true ? '  ok   ' : '  FAIL ') + name + (ok === true || detail === undefined ? '' : '  -> ' + JSON.stringify(detail).slice(0, 300))); return ok === true }
const note = (t) => console.log('  ..   ' + t)
const personalHome = home
const hostCall = (h, homeDir) => { const was = process.env.DSH_HOME; process.env.DSH_HOME = homeDir; const c = cookieDeSession(h); process.env.DSH_HOME = was; return (method, path, body) => fetch('http://' + h + path, { method, headers: { 'content-type': 'application/json', cookie: c.nom + '=' + c.valeur, origin: 'http://' + h }, body: body === undefined ? undefined : JSON.stringify(body) }).then(async (r) => ({ status: r.status, ...(await r.json().catch(() => ({}))) })) }
const personal = hostCall(host, personalHome)

const A = await S.signIn(acc.a.email, acc.a.password)
const B = await S.signIn(acc.b.email, acc.b.password)
const C = await S.signIn(acc.c.email, acc.c.password)
const members = async () => { const r = await S.call('GET', `/v1/workspaces/${t1.id}/members`, { cookie: A.cookie }); return (r.body && r.body.members) || [] }
const isMember = async (u) => (await members()).some((m) => m.user_id === u.id)

// ── 1. B is a member (joins with the link of his invitation through the dialog of his own desktop when he is not yet) ──────────────────────────────────────────────
const LINK = /https?:\/\/[^\s"'<>]*\/invitations\/accept\?token=[A-Za-z0-9_-]+/
const doors = async (who) => {
  const rows = {}
  const get = async (key, path) => { const r = await S.call('GET', path, { cookie: who.cookie }); rows[key] = { status: r.status, error: r.body && r.body.error, n: r.body && (r.body.skills || r.body.computers || r.body.members || r.body.workspaces || []).length } }
  await get('team in my list', '/v1/workspaces')
  await get('members', `/v1/workspaces/${t1.id}/members`)
  await get('team skills', `/v1/workspaces/${t1.id}/skills`)
  await get('team computers', `/v1/workspaces/${t1.id}/computers`)
  await get('team space', `/v1/workspaces/${t1.id}/team-space`)
  await get('the team itself', `/v1/workspaces/${t1.id}`)
  const list = await S.call('GET', '/v1/workspaces', { cookie: who.cookie })
  rows['team in my list'].listed = ((list.body && (list.body.workspaces || list.body)) || []).some((w) => w.id === t1.id)
  return rows
}
let g = null
let gt = null
let gp = null
try {
  let before = null
  if (!resume) {
  console.log('\n1. B joins the team through the dialog of his desktop')
  if (!(await isMember(B))) {
    const mail = await S.mail(acc.b.email)
    let link = (mail.text || '').match(LINK)
    if (!link) { await S.call('POST', `/v1/workspaces/${t1.id}/invitations`, { cookie: A.cookie, json: { email: acc.b.email, role: 'member' } }); link = ((await S.mail(acc.b.email)).text || '').match(LINK) }
    g = await openGui(host)
    await sleep(2500)
    const paste = async (text) => { await g.val(`(() => { const i = document.querySelector('[data-kb="join-input"]'); i.focus(); i.select() })()`); await g.page.send('Input.insertText', { text }) }
    check('the join dialog opens from the account menu', await g.pressSpaceAction('join') && (await g.until(() => g.exists('[data-kb="join-team"]'), 4000)) === true)
    await paste(link[0]); await g.key('Enter', 'Enter', 13)
    await g.until(() => g.exists('[data-kb="join-accept"]'), 8000)
    const who = await g.text('[data-kb="join-who"]')
    note('the preview says ' + JSON.stringify(who))
    await g.shot(join(out, '01-join-preview.png'))
    await g.press('[data-kb="join-accept"]')
    await g.until(async () => !(await g.exists('[data-kb="join-team"]')), 15000)
    await g.until(async () => { const c = await g.card(); return c && !c.switching }, 60000)
    await g.close(); g = null
  }
  check('B is a member of the team on the server', await isMember(B))

  // ── 2. what B holds before the removal ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  console.log('\n2. what B can reach as a member')
  const md = '---\nname: removal-skill\ndescription: A skill the team holds for the removal journey.\n---\n\nSay hello.\n'
  const sk = await S.call('POST', `/v1/workspaces/${t1.id}/skills`, { cookie: A.cookie, json: { name: 'removal-skill', description: 'A skill the team holds for the removal journey.', files: [{ path: 'SKILL.md', content: md }] } })
  note('A proposes a team skill: ' + sk.status + ' ' + (sk.body && sk.body.status))
  const pol = await S.call('PUT', `/v1/workspaces/${t1.id}/computers/policy`, { cookie: A.cookie, json: { enabled: true, who_creates: 'any' } })
  note('A turns team computers on, anyone may create: ' + pol.status)
  const cA = await S.call('POST', `/v1/workspaces/${t1.id}/computers`, { cookie: A.cookie, json: { name: 'Team box of A', mode: 'sleep' } })
  const cB = await S.call('POST', `/v1/workspaces/${t1.id}/computers`, { cookie: B.cookie, json: { name: 'Box of B', mode: 'sleep' } })
  note('computer made by A: ' + cA.status + ', by B (a member): ' + cB.status)
  before = await doors(B)
  note('B before: ' + JSON.stringify(before))
  check('as a member B sees the team in his list, its members, its skills and its computers', before['team in my list'].listed === true && before.members.status === 200 && before['team skills'].status === 200 && before['team skills'].n >= 1 && before['team computers'].status === 200, before)
  const myBox = (await S.call('GET', `/v1/workspaces/${t1.id}/computers`, { cookie: B.cookie })).body
  note('B sees ' + ((myBox && myBox.computers) || []).map((c) => c.name + ':' + c.state).join(', '))

  }
  if (resume) {
    console.log('\n3-4. resumed: B was removed earlier; the team window is opened again')
    const open = await personal('POST', '/kybernos-cloud/team-dsh/open', { workspace_id: t1.id })
    note('asking the personal desktop to open the team window now answers ' + JSON.stringify(open).slice(0, 300))
    report.reopen = open
    const nowDoors = await doors(B)
    check('B is refused every door of the team (404 or 403) and the team is not in his list', ['members', 'team skills', 'team computers', 'the team itself'].every((k) => nowDoors[k].status === 404 || nowDoors[k].status === 403) && nowDoors['team in my list'].listed === false, nowDoors)
    if (open.ok === true && typeof open.url === 'string') {
      gp = await openGui(host)
      process.env.DSH_HOME = join(personalHome, 'teams', t1.id)
      gt = await openGui(new URL(open.url).host)
      process.env.DSH_HOME = personalHome
      await sleep(3000)
      note('the reopened team window says ' + JSON.stringify(await gt.card()))
      await gt.shot(join(out, 'resume-team-window.png'))
    }
  } else {
  // ── 3. B opens the team's own desktop and keeps it open ─────────────────────────────────────────────────────────────────────────────────────────────────────────
  console.log('\n3. B has his desktop open on the team')
  const open = await personal('POST', '/kybernos-cloud/team-dsh/open', { workspace_id: t1.id })
  check('the team has a desktop of its own and it started', open.ok === true && typeof open.url === 'string', open)
  const teamHost = new URL(open.url).host
  const teamHome = join(personalHome, 'teams', t1.id)
  gp = await openGui(host)            // the personal desktop of B, left open too
  process.env.DSH_HOME = teamHome
  gt = await openGui(teamHost)        // the team's desktop of B
  process.env.DSH_HOME = personalHome
  await sleep(3000)
  const card0 = await gt.card()
  note('the team window says ' + JSON.stringify(card0 && card0.text))
  check('before the removal the card of the team window names the team', !!card0 && new RegExp(t1.name).test(card0.text), card0)
  await gt.shot(join(out, '02-team-window-before.png'))
  await gp.shot(join(out, '02-personal-window-before.png'))

  // ── 4. A removes B; B's windows are recorded each minute ────────────────────────────────────────────────────────────────────────────────────────────────────────
  console.log('\n4. A removes B (nothing is pressed on B\'s side), then one look a minute')
  const removed = await S.call('DELETE', `/v1/workspaces/${t1.id}/members/${B.id}`, { cookie: A.cookie })
  const t0 = Date.now()
  check('A removes B: the server answers 204', removed.status === 204, removed.status)
  const mailB = await S.mail(acc.b.email)
  const sawRemovalMail = /remov|no longer|left the/i.test((mailB.subject || '') + ' ' + (mailB.text || ''))
  check('no e-mail tells B he was removed (his mailbox still ends with the invitation or a code)', sawRemovalMail === false, { subject: mailB.subject })
  const look = async (minute) => {
    const entry = { minute, at: new Date().toISOString() }
    entry.team = { card: ((await gt.card()) || {}).text, body: String((await gt.val('document.body.innerText')) || '').replace(/\s+/g, ' ').slice(0, 400) }
    entry.personal = { card: ((await gp.card()) || {}).text }
    entry.notice = await gt.val(`(() => { const n = Array.from(document.querySelectorAll('[role="alert"],[role="status"],[data-kb*="notice"],[data-kb*="banner"],[data-kb*="turn-error"]')).map((e) => (e.innerText || '').replace(/\\s+/g, ' ').trim()).filter(Boolean); return n.slice(0, 5) })()`)
    entry.doors = await doors(B)
    entry.hostStatus = await personal('GET', '/kybernos-cloud/status').then((s) => ({ workspaces: ((s.state || {}).workspaces || []).map((w) => w.name), connected: s.connected })).catch((e) => ({ error: String(e) }))
    await gt.shot(join(out, `m${minute}-team-window.png`))
    await gp.shot(join(out, `m${minute}-personal-window.png`))
    timeline.push(entry)
    note(`minute ${minute}: team card ${JSON.stringify(entry.team.card)} | personal card ${JSON.stringify(entry.personal.card)} | host lists ${JSON.stringify(entry.hostStatus.workspaces)} | doors ${JSON.stringify(Object.fromEntries(Object.entries(entry.doors).map(([k, v]) => [k, v.status])))}`)
    return entry
  }
  for (let m = 0; m <= minutes; m += 1) {
    if (m > 0) { const wait = t0 + m * 60000 - Date.now(); if (wait > 0) await sleep(wait) }
    await look(m)
  }
  const last = timeline[timeline.length - 1]
  const first = timeline[0]
  check('at once the server refuses B every door of the team (404 or 403): members, skills, computers, the team itself', ['members', 'team skills', 'team computers', 'the team itself'].every((k) => first.doors[k].status === 404 || first.doors[k].status === 403) && first.doors['team in my list'].listed === false, first.doors)
  check('the team space (not available on this replica) cannot be told apart for a member and a stranger', true)
  const desktopKnew = timeline.findIndex((e) => !new RegExp(t1.name).test(e.team.card || ''))
  note('the team window card stopped naming the team at minute ' + (desktopKnew < 0 ? 'never (still names it at minute ' + minutes + ')' : desktopKnew))
  check('B\'s open team window stops presenting the team as his within five minutes', desktopKnew >= 0, last.team.card)

  }
  // the first message after the five minutes
  console.log('\n5. a message in the team window after five minutes')
  if (gt === null) note('no team window to type in: the personal desktop refused to open it')
  else {
  await gt.selectModel('GLM').catch((e) => note('model: ' + e.message))
  const sentAt = await gt.send('J09-05 message after the removal')
  await gt.until(() => chatCalls(readProxy(process.env.KB_PROXY_LOG, sentAt)).length >= 1, 20000, 150)
  await sleep(3000)
  const calls = chatCalls(readProxy(process.env.KB_PROXY_LOG, sentAt))
  const said = String(await gt.val('document.body.innerText') || '').replace(/\s+/g, ' ')
  const tail = said.slice(said.lastIndexOf('J09-05 message after the removal') + 32).trim().slice(0, 260)
  note('requests of that message: ' + calls.map((c) => (c.workspace === t1.id ? 'team' : c.workspace === acc.b.personal ? 'personal' : String(c.workspace).slice(0, 8)) + ' -> ' + c.status).join(', ') + ' | the window says ' + JSON.stringify(tail))
  await gt.shot(join(out, 'm5-after-message.png'))
  check('the message is never billed to another space, and the window says the team was left', calls.every((c) => c.workspace === t1.id ? c.status === 404 : false) && /no longer in this team|left/i.test(tail), { calls: calls.map((c) => [c.workspace, c.status]), tail })
  writeFileSync(join(out, 'timeline.json'), JSON.stringify({ before, timeline, calls: calls.map((c) => ({ workspace: c.workspace === t1.id ? 'team' : 'other', status: c.status })), tail }, null, 2))
  }
  if (gt) await gt.close()
  if (gp) await gp.close()

  // ── 6. leaving by oneself, and the last owner ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  console.log('\n6. C leaves by himself; the last owner cannot')
  const owners = (await members()).filter((m) => m.role === 'owner')
  const lastOwnerLeave = await S.call('DELETE', `/v1/workspaces/${t1.id}/members/${A.id}`, { cookie: A.cookie })
  check('the only owner is refused when he tries to leave (409)', owners.length === 1 && lastOwnerLeave.status === 409, { owners: owners.length, status: lastOwnerLeave.status, body: lastOwnerLeave.body })
  note('the owner\'s refusal says ' + JSON.stringify(lastOwnerLeave.body && lastOwnerLeave.body.message))
  const cLeave = await S.call('DELETE', `/v1/workspaces/${t1.id}/members/${C.id}`, { cookie: C.cookie })
  check('C leaves by himself (204) and is no longer a member', cLeave.status === 204 && !(await isMember(C)), cLeave.status)
  const cAfter = await doors(C)
  check('C is refused the team afterwards, like a removed member', cAfter.members.status === 404 || cAfter.members.status === 403, cAfter.members)
  const cBoxes = (await S.call('GET', `/v1/workspaces/${t1.id}/computers`, { cookie: A.cookie })).body
  note('the team keeps the computers made by B and A: ' + ((cBoxes && cBoxes.computers) || []).map((c) => c.name + ':' + c.state).join(', '))
  const adminList = (await S.call('GET', `/v1/workspaces/${t1.id}/skills`, { cookie: A.cookie })).body
  check('the team keeps its skill after B left', !!adminList && adminList.total >= 1, adminList && adminList.total)
} catch (e) {
  check('the run reached its end', false, String((e && e.stack) || e).slice(0, 600))
} finally { if (g) await g.close().catch(() => null) }
writeFileSync(join(out, resume ? 'report-resume.json' : 'report.json'), JSON.stringify({ results, timeline, ...report }, null, 2))
const red = results.filter((r) => !r.ok).length
console.log(`\n${results.length - red}/${results.length} checks passed; report in ${out}/report.json`)
process.exit(red === 0 ? 0 : 1)

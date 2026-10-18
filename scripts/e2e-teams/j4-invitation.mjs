// J4 — invitation. B joins T1 by pasting the real link from the mailbox into the DSH dialog; then the failure cases that can be played: junk text, a link meant
// for another account, the same link twice, a full team (the link stays valid). The token must only appear in requests to the replica.
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { cookieDeSession } from '../cdp-lib.mjs'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { openGui, recorder, sleep } from './common.mjs'

const LINK = /https?:\/\/[^\s"'<>]*\/invitations\/accept\?token=[A-Za-z0-9_-]+/
export const run = async (ctx) => {
  const { check, note, finish, rec } = recorder(ctx, 'J4')
  const S = ctx.server
  const A = await ctx.sessionOf('a')
  const B = await ctx.sessionOf('b')
  const { t1, t2 } = ctx.ids
  const homeB = process.env.KB_E2E_HOME_B
  if (!homeB) throw new Error('KB_E2E_HOME_B (the sandbox HOME of account B) is not set')
  ctx.as('b')
  const runStart = Date.now()
  const tokens = []
  const linkFrom = async (to) => { const m = await S.mail(to); const l = (m.text || '').match(LINK); if (l) tokens.push(new URL(l[0]).searchParams.get('token')); return l ? l[0] : null }
  const members = async (ws) => { const r = await S.call('GET', `/v1/workspaces/${ws}/members`, { cookie: A.cookie }); return Array.isArray(r.body) ? r.body : r.body.members || [] }

  // A clean start, so the journey can be played again: B leaves both teams, B's DSH signs out and in again (its list of teams is read at the pairing), and a fresh
  // invitation of B into T1 is sent (inviting again replaces the previous one).
  for (const ws of [t1, t2]) { if ((await members(ws)).some((m) => (m.user_id || m.id) === B.id)) await S.call('DELETE', `/v1/workspaces/${ws}/members/${B.id}`, { cookie: A.cookie }) }
  {
    const ck = cookieDeSession(ctx.hostB)
    const post = (path, body) => fetch('http://' + ctx.hostB + path, { method: 'POST', headers: { 'content-type': 'application/json', cookie: ck.nom + '=' + ck.valeur, origin: 'http://' + ctx.hostB }, body: JSON.stringify(body) }).then((r) => r.json())
    await post('/kybernos-cloud/disconnect', { confirm: true })
    const out = spawnSync(process.execPath, [fileURLToPath(new URL('../e2e-connect.mjs', import.meta.url)), '--dsh', ctx.hostB, '--account', 'b'], { encoding: 'utf8', env: process.env })
    if (out.status !== 0) throw new Error('could not reconnect B: ' + (out.stdout + out.stderr).slice(0, 200))
    const inv0 = await S.call('POST', `/v1/workspaces/${t1}/invitations`, { cookie: A.cookie, json: { email: ctx.acc.b.email, role: 'member' } })
    if (inv0.status !== 200 && inv0.status !== 201) throw new Error('could not invite B: ' + inv0.status)
  }

  // the two other invitations of this journey: one for an address that is not B's, one into T2 once it is full
  const C = { email: `e2e-c-${Math.random().toString(36).slice(2, 7)}@example.test`, password: 'E2e-' + Math.random().toString(36).slice(2) + 'Zq9!', name: 'E2E C' }
  await S.signUp(C.email, C.password, C.name)
  const Cs = await S.signIn(C.email, C.password)
  const stranger = `e2e-x-${Math.random().toString(36).slice(2, 7)}@example.test`
  const forOther = await S.call('POST', `/v1/workspaces/${t2}/invitations`, { cookie: A.cookie, json: { email: stranger, role: 'member' } })
  check('A invited an address that is not B\'s (to T2)', forOther.status === 201 || forOther.status === 200, forOther.status)
  const linkOther = await linkFrom(stranger)

  const g = await openGui(ctx.hostB)
  const paste = async (text) => { await g.val(`(() => { const i = document.querySelector('[data-kb="join-input"]'); i.focus(); i.select() })()`); await g.page.send('Input.insertText', { text }) }
  const step = () => g.val(`(document.querySelector('[data-kb="join-team"]') || { getAttribute: () => null }).getAttribute('data-step')`)
  const note1 = () => g.text('[data-kb="join-note"]')
  const openJoin = async () => { await g.pressSpaceAction('join'); return (await g.until(() => g.exists('[data-kb="join-team"]'), 4000)) === true }
  const closeJoin = async () => { await g.key('Escape', 'Escape', 27); await g.until(async () => !(await g.exists('[data-kb="join-team"]')), 3000) }
  const checkLink = async (text) => { await paste(text); await g.key('Enter', 'Enter', 13); await g.until(async () => (await step()) === 'preview' || (await note1()) !== null, 8000) }
  const calls = (since) => ctx.rows(since).filter((r) => r.path.startsWith('/v1/invitations/'))
  try {
    await sleep(2500)
    const plan0 = await g.card()
    note('B starts with ' + JSON.stringify(plan0 && plan0.text))

    // 1. junk
    console.log('\n1. junk text')
    check('the dialog opens from the menu', await openJoin())
    const before1 = calls(runStart).length
    await checkLink('hello, this is not an invitation link')
    const junk = await note1()
    check('junk text gets a sentence and no call goes to the server', typeof junk === 'string' && junk.length > 5 && calls(runStart).length === before1, { note: junk, calls: calls(runStart).length - before1 })
    await ctx.shot(g, 'j4-junk')

    // 2. a link meant for another address
    console.log('\n2. a link meant for another address')
    await checkLink(linkOther)
    const st2 = await step()
    const mism = await g.text('[data-kb="join-mismatch"]')
    note(`the preview of an invitation sent to someone else: step=${st2}, warning=${JSON.stringify(mism)}`)
    check('the preview shows (public route) with a warning that it was sent to another address', st2 === 'preview' && typeof mism === 'string' && mism.length > 0, { step: st2, mism })
    await ctx.shot(g, 'j4-other-preview')
    await g.press('[data-kb="join-accept"]')
    await g.until(async () => (await note1()) !== null, 8000)
    const other = await note1()
    check('accepting it is refused with the one sentence that names expired, used and another account', typeof other === 'string' && /another account/i.test(other) && /expired|used/i.test(other), other)
    check('B is not a member of T2 after that', !(await members(t2)).some((m) => (m.user_id || m.id) === B.id))
    await closeJoin()

    // 2b. the same kind of link on a host that is not this server's: a foreign page must never be the one the token is sent to
    console.log('\n2b. a link on another host, with a real token')
    const stranger2 = `e2e-y-${Math.random().toString(36).slice(2, 7)}@example.test`
    const inv2 = await S.call('POST', `/v1/workspaces/${t2}/invitations`, { cookie: A.cookie, json: { email: stranger2, role: 'member' } })
    const real2 = await linkFrom(stranger2)
    if (inv2.status < 300 && real2) {
      const foreign = real2.replace(/^https?:\/\/[^/]+/, 'https://invitations.example.org')
      const before2 = calls(runStart).length
      await openJoin()
      await checkLink(foreign)
      const hint = (await g.text('[data-kb="join-team"]')) || ''
      const sent = calls(runStart).slice(before2)
      note('a link on https://invitations.example.org with a real token: the dialog says ' + JSON.stringify(hint.slice(0, 260)) + '; calls made: ' + sent.map((r) => `${r.method} ${r.path}`).join(', '))
      check('a link on a foreign host is only a carrier for the token: the one call is the preview, to this server, and the dialog shows the invitation', sent.length === 1 && sent[0].method === 'POST' && sent[0].path === '/v1/invitations/preview' && (await step()) === 'preview', { calls: sent.map((r) => r.path), step: await step() })
      await closeJoin()
      // the same host with a token the server does not know: the failure sentence says where the link came from and which server is active
      await openJoin()
      await checkLink('https://invitations.example.org/invitations/accept?token=' + 'A'.repeat(43))
      const failNote = (await note1()) || ''
      note('a foreign-host link with an unknown token: ' + JSON.stringify(failNote.slice(0, 260)))
      check('a failing link from another host says where it came from and which server is active', /invitations\.example\.org/.test(failNote) && /localhost:8820/.test(failNote), failNote)
      await ctx.shot(g, 'j4-foreign-host')
      await closeJoin()
    }

    // 3. the real link, from the mailbox, pasted
    console.log('\n3. the real link of B\'s invitation to T1')
    const linkB = await linkFrom(ctx.acc.b.email)
    check('the invitation e-mail holds a link', typeof linkB === 'string')
    await openJoin()
    await checkLink(linkB)
    check('preview step', (await step()) === 'preview', await step())
    const who = await g.text('[data-kb="join-who"]')
    note('the preview says: ' + JSON.stringify(who))
    check('the preview names the team, who invited and the role', typeof who === 'string' && /E2E Alpha/.test(who) && /member/.test(who), who)
    check('no mismatch warning (B is the invited address)', !(await g.exists('[data-kb="join-mismatch"]')))
    check('the token is drawn nowhere in the dialog', !((await g.text('[data-kb="join-team"]')) || '').includes(tokens[tokens.length - 1] || 'x'))
    await ctx.shot(g, 'j4-preview')
    await g.press('[data-kb="join-accept"]')
    await g.until(async () => !(await g.exists('[data-kb="join-team"]')), 15000)
    await g.until(async () => { const c = await g.card(); return c && !c.switching && /E2E Alpha/.test(c.text.slice(0, 60)) }, 20000)
    await sleep(2500)
    const joined = (await S.call('GET', '/v1/workspaces', { cookie: B.cookie })).body
    const jl = Array.isArray(joined) ? joined : joined.workspaces
    check('B is a member of T1 on the server', jl.some((w) => w.id === t1 && w.role === 'member'), jl.map((w) => w.name + ':' + w.role))
    check('DSH switched into the team (the card names it)', /E2E Alpha/.test(((await g.card()) || {}).text || ''), (await g.card()))
    const kyb = join(homeB, 'Documents', 'Kybernos')
    check('the team\'s folder exists in B\'s Documents/Kybernos', existsSync(join(kyb, 'E2E Alpha')), existsSync(kyb) ? readdirSync(kyb) : 'no Kybernos folder')
    check('a folder pill is shown for the team', /Alpha/.test((await g.text('[data-kb="cue-folder"]')) || ''), await g.text('[data-kb="cue-folder"]'))
    await ctx.shot(g, 'j4-joined')

    // 4. the same link twice
    console.log('\n4. the same link again')
    await openJoin()
    await checkLink(linkB)
    const again = await note1()
    check('a link already used gets the uniform sentence and stays on the paste step', typeof again === 'string' && /expired|used/i.test(again) && (await step()) === 'paste', { note: again, step: await step() })
    await closeJoin()

    // 5. a full team: the link stays valid. Pending invitations hold a seat when INVITING, not when accepting: seats 3 → invite B and C (A + 2 pending), C accepts,
    // the owner lowers the seats to 2 (A and C = full), and B's accept finds no free seat.
    console.log('\n5. a full team (T2): the link stays valid')
    const owner = await S.ownerSession()
    const seats = (n) => owner.admin('PUT', `/v1/admin/billing/workspaces/${t2}/subscription`, { plan: 'team', component: 'seats', quantity: n, replace: true })
    // T2 starts this step with its owner alone (an earlier run's C is still a member of it)
    for (const m of await members(t2)) if ((m.user_id || m.id) !== A.id) await S.call('DELETE', `/v1/workspaces/${t2}/members/${m.user_id || m.id}`, { cookie: A.cookie })
    // every invitation still pending in T2 (an earlier run's, the stranger's) holds a seat when inviting: withdraw them all
    const pending = await S.call('GET', `/v1/workspaces/${t2}/invitations`, { cookie: A.cookie })
    for (const p of (pending.body && pending.body.invitations) || []) await S.call('DELETE', `/v1/workspaces/${t2}/invitations/${p.id}`, { cookie: A.cookie })
    await seats(3)
    const inv = await S.call('POST', `/v1/workspaces/${t2}/invitations`, { cookie: A.cookie, json: { email: ctx.acc.b.email, role: 'member' } })
    check('A invited B to T2', inv.status === 200 || inv.status === 201, inv.status)
    const invC = await S.call('POST', `/v1/workspaces/${t2}/invitations`, { cookie: A.cookie, json: { email: C.email, role: 'member' } })
    check('A invited C to T2', invC.status === 200 || invC.status === 201, invC.status)
    const linkC = await linkFrom(C.email)
    const accC = await S.call('POST', '/v1/invitations/accept', { cookie: Cs.cookie, json: { token: new URL(linkC).searchParams.get('token') } })
    check('C accepted (through the API): T2 now has two members', accC.status === 200 || accC.status === 201, accC.status)
    check('the owner lowered the seats to 2', (await seats(2)).status === 200)
    const linkFull = await linkFrom(ctx.acc.b.email)
    await openJoin()
    await checkLink(linkFull)
    check('the preview of B\'s T2 invitation shows', (await step()) === 'preview', await step())
    await g.press('[data-kb="join-accept"]')
    await g.until(async () => (await note1()) !== null || !(await g.exists('[data-kb="join-team"]')), 10000)
    const full = await note1()
    note('the full-team sentence: ' + JSON.stringify(full))
    check('a full team is said apart from the other refusals (not the uniform sentence)', typeof full === 'string' && /full|seat/i.test(full) && !/another account/i.test(full), full)
    check('the dialog is still open on the preview (the link is still valid)', await g.exists('[data-kb="join-team"]'))
    await ctx.shot(g, 'j4-full')
    await owner.admin('PUT', `/v1/admin/billing/workspaces/${t2}/subscription`, { plan: 'team', component: 'seats', quantity: 3, replace: true })
    await sleep(1000)
    await g.press('[data-kb="join-accept"]')
    await g.until(async () => !(await g.exists('[data-kb="join-team"]')), 15000)
    await g.until(async () => { const c = await g.card(); return c && !c.switching && /E2E Beta/.test(c.text.slice(0, 60)) }, 20000)
    const after = (await S.call('GET', '/v1/workspaces', { cookie: B.cookie })).body
    check('with a seat free again the same link works (B is in T2)', (Array.isArray(after) ? after : after.workspaces).some((w) => w.id === t2 && w.role === 'member'))
    await ctx.shot(g, 'j4-second-team')
  } finally { await g.close() }

  // 6. where did the tokens go
  console.log('\n6. where the tokens went')
  const rows = ctx.rows(runStart)
  const bad = []
  for (const tok of tokens.filter(Boolean)) for (const r of rows) {
    const hay = JSON.stringify({ p: r.path, h: r.headers, b: r.body })
    if (hay.includes(tok) && !(r.method === 'POST' && /^\/v1\/invitations\/(preview|accept)$/.test(r.path))) bad.push(`${r.method} ${r.path.split('?')[0]}`)
  }
  check('every request that carries a token is POST /v1/invitations/preview or /accept, to the replica', bad.length === 0, bad)
  const carried = rows.filter((r) => tokens.some((t) => t && JSON.stringify({ p: r.path, b: r.body }).includes(t)))
  note(`${carried.length} recorded requests carried a token: ` + [...new Set(carried.map((r) => `${r.method} ${r.path.split('?')[0]}`))].join(', '))
  let hits = ''
  try { hits = execFileSync('/usr/bin/grep', ['-rIl', '--exclude-dir=node_modules', '--exclude-dir=.git', '-F', ...tokens.filter(Boolean).flatMap((t) => ['-e', t]), join(homeB, '.dsh'), join(homeB, 'Documents')], { encoding: 'utf8', timeout: 120000 }) } catch (e) { hits = e.stdout ? String(e.stdout) : '' }
  check('no token is written anywhere under the sandbox\'s DSH home or Documents (logs, state, settings)', hits.trim() === '', hits.split('\n').slice(0, 5))
  return finish()
}

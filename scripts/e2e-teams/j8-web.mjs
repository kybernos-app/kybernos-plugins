// J8 — the server's team page. The pool line and the « Add credits » button on the web page (Members & Roles) for the owner, an admin and a member of the same team.
// A headless Chrome is signed in with each account's own session cookie (made by the server's sign-in route). Read-only: nothing is pressed except the page's own tabs.
import { openLivePage, waitFor } from '../live-page.mjs'
import { recorder, sleep } from './common.mjs'

export const run = async (ctx) => {
  const { check, note, finish } = recorder(ctx, 'J8')
  const S = ctx.server
  const A = await ctx.sessionOf('a')
  const B = await ctx.sessionOf('b')
  const t1 = ctx.acc.teams.t1
  const t3 = ctx.acc.teams.t3
  const web = ctx.e.web
  const cookieList = (str) => str.split('; ').filter(Boolean).map((c) => { const i = c.indexOf('='); return { name: c.slice(0, i), value: c.slice(i + 1) } })
  const members = async (ws) => (await S.call('GET', `/v1/workspaces/${ws}/members`, { cookie: A.cookie })).body
  const list = (m) => (Array.isArray(m) ? m : m.members || [])
  const inT1 = list(await members(t1.id)).find((m) => (m.user_id || m.id) === B.id)
  if (!inT1) await S.call('POST', `/v1/workspaces/${t1.id}/members`, { cookie: A.cookie, json: { user_id: B.id, role: 'member' } })
  const asRole = async (role) => { await S.call('PATCH', `/v1/workspaces/${t1.id}/members/${B.id}`, { cookie: A.cookie, json: { role } }) }

  const view = async (who, session, label, { width = 1200, height = 1000, team = t1 } = {}) => {
    ctx.as('a')
    const live = await openLivePage({ authority: ctx.hostA, width, height })
    const { page } = live
    try {
      await page.send('Network.enable', {})
      for (const c of cookieList(session.cookie)) await page.send('Network.setCookie', { name: c.name, value: c.value, domain: 'localhost', path: '/' })
      await page.send('Page.navigate', { url: `${web}/account#members&ws=${team.id}` })
      const ready = await waitFor(page, `!!document.getElementById('poolCard') || /not signed in|sign in/i.test(document.body.innerText)`, 25000)
      await sleep(1500)
      const facts = (await page.evalJs(`(() => { const c = document.getElementById('poolCard'); const b = document.getElementById('poolBuy'); const caps = document.getElementById('capsCard'); const vis = (e) => !!e && e.getBoundingClientRect().width > 0 && getComputedStyle(e).display !== 'none'; return JSON.stringify({ poolShown: vis(c), text: c ? c.innerText.replace(/\\\\s+/g, ' ').trim() : null, buy: vis(b), buyDisabled: b ? b.disabled === true || b.getAttribute('aria-disabled') === 'true' : null, buyText: b ? b.innerText.trim() : null, capsShown: vis(caps), capsHint: caps ? (caps.innerText.match(/[^.]*can only lower[^.]*\\\\./) || [''])[0].trim() : null, rows: c ? Array.from(c.querySelectorAll('tbody tr')).map((r) => Array.from(r.children).map((x) => x.innerText.trim())) : [], overflowX: document.documentElement.scrollWidth > innerWidth, url: location.pathname + location.hash.slice(0, 40) }) })()`, 8000)).val
      await page.shot(`${ctx.shots}/j8-${label}.png`)
      return ready ? JSON.parse(facts) : { notReady: true, facts }
    } finally { await live.close() }
  }

  console.log('\nthe pool card in T1 (Team plan, 3 seats), seen by each role')
  await asRole('member')
  const owner = await view('a', A, 'owner')
  note('owner: ' + JSON.stringify({ pool: owner.poolShown, buy: owner.buy, buyText: owner.buyText, buyDisabled: owner.buyDisabled, rows: owner.rows }))
  check('owner: the pool card is on the page with the four windows of the plan and « Add credits »', owner.poolShown === true && owner.rows.length === 4 && owner.buy === true && /credits/i.test(owner.buyText || ''), owner)
  const member = await view('b', B, 'member')
  note('member: ' + JSON.stringify({ pool: member.poolShown, buy: member.buy, text: (member.text || '').slice(0, 160) }))
  check('member: the pool card is on the page (read only) with the four windows, and no « Add credits »', member.poolShown === true && member.rows.length === 4 && member.buy === false, member)
  await asRole('admin')
  const admin = await view('b', B, 'admin')
  note('admin: ' + JSON.stringify({ pool: admin.poolShown, buy: admin.buy, buyText: admin.buyText, buyDisabled: admin.buyDisabled }))
  check('admin: the pool card and « Add credits » are there', admin.poolShown === true && admin.rows.length === 4 && admin.buy === true, admin)
  await asRole('member')
  const phone = await view('a', A, 'owner-390', { width: 390, height: 844 })
  check('owner at 390 px: the pool table fits (no sideways scroll)', phone.poolShown === true && phone.overflowX === false, phone)
  check('the pool line says what the plan bought (N seats) in the lead sentence', /seat/i.test(owner.text || ''), owner.text)
  check('owner and admin read « Below you can lower what each member may use »; the member does not', /lower what each member may use/.test(owner.text || '') && /lower what each member may use/.test(admin.text || '') && !/lower what each member may use/.test(member.text || ''), { owner: (owner.text || '').slice(0, 140), member: (member.text || '').slice(0, 140) })
  // T3: the pool is used up when J6 ran before this journey
  const full = await view('a', A, 'owner-t3', { team: t3 })
  note('T3 (pool ' + (/Add credits/.test(full.text || '') ? 'with the button' : 'no button') + '): button ' + JSON.stringify({ buy: full.buy, disabled: full.buyDisabled, text: full.buyText }))
  const budget = (await S.call('GET', `/v1/workspaces/${t3.id}/llm/budget`, { cookie: A.cookie })).body.windows.filter((w) => w.kind === 'pool')
  note('T3 pool on the server: ' + budget.map((w) => `${w.window_seconds}:${w.used_percent}${w.exhausted ? '!' : ''}`).join(' '))
  check('T3 (pool used up or not): the owner sees the pool card and the button is offered', full.poolShown === true && full.buy === true, full)
  return finish()
}

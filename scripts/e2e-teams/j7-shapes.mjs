// J7 — shapes. B's account menu with 1, 3, 4 and 5 spaces on the real accounts (A adds and removes B in the teams through the server's own routes), 390 px wide, light and dark, English and
// French: the list inline up to three spaces, « Switch team » from four; every box must sit inside the window and no row may be cut. Also: B removed from the team that is active.
import { openGui, recorder, sleep, chatCalls } from './common.mjs'
import { cookieDeSession } from '../cdp-lib.mjs'

export const run = async (ctx) => {
  const { check, note, finish, rec } = recorder(ctx, 'J7')
  const S = ctx.server
  const A = await ctx.sessionOf('a')
  const B = await ctx.sessionOf('b')
  const teams = ['t1', 't2', 't3', 't4'].filter((k) => ctx.acc.teams[k]).map((k) => ctx.acc.teams[k])
  const hostB = ctx.as('b')
  const refreshB = () => { const ck = cookieDeSession(hostB); return fetch('http://' + hostB + '/kybernos-cloud/refresh', { method: 'POST', headers: { 'content-type': 'application/json', cookie: ck.nom + '=' + ck.valeur, origin: 'http://' + hostB }, body: '{}' }).then((r) => r.json()) }
  const isMember = async (ws) => { const r = await S.call('GET', `/v1/workspaces/${ws}/members`, { cookie: A.cookie }); return (Array.isArray(r.body) ? r.body : r.body.members || []).some((m) => (m.user_id || m.id) === B.id) }
  const setMembership = async (want) => { // want: the keys B must be a member of
    // a pending invitation holds a seat when inviting and when adding a member: withdraw them all, so that the seats left are the real ones
    for (const t of teams) {
      const open = await S.call('GET', `/v1/workspaces/${t.id}/invitations`, { cookie: A.cookie })
      for (const p of (open.body && open.body.invitations) || []) await S.call('DELETE', `/v1/workspaces/${t.id}/invitations/${p.id}`, { cookie: A.cookie })
    }
    for (const t of teams) {
      const has = await isMember(t.id)
      const should = want.includes(t.name)
      if (has && !should) await S.call('DELETE', `/v1/workspaces/${t.id}/members/${B.id}`, { cookie: A.cookie })
      if (!has && should) await S.call('POST', `/v1/workspaces/${t.id}/members`, { cookie: A.cookie, json: { user_id: B.id, role: 'member' } })
    }
    await refreshB()
  }
  const within = (r, w, h) => r !== null && r !== undefined && r.x >= -0.5 && r.y >= -0.5 && r.x + r.w <= w + 0.5 && r.y + r.h <= h + 0.5
  const g = await openGui(hostB, { width: 1200, height: 900 })
  const VW = 390, VH = 844
  try {
    await sleep(2500)
    const rect = (sel) => g.val(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height } })()`)
    const schemeNow = async () => ((await g.val(`document.body.hasAttribute('data-ds-dark-theme')`)) === true ? 'dark' : 'light')
    const setScheme = async (want) => {
      if ((await schemeNow()) === want) return
      await g.openMenu()
      await g.val(`(() => { const b = document.querySelector('.kbfp-menu [data-kb="menu-appearance"] button[aria-label="${want === 'light' ? 'Light' : 'Dark'}"]'); if (b) b.click() })()`)
      await g.until(async () => (await schemeNow()) === want, 3000)
      await g.closeMenu()
    }
    const clipped = (scope) => g.val(`Array.from(document.querySelectorAll(${JSON.stringify(scope + ' *')})).filter((e) => e.children.length === 0 && (e.innerText || '').trim() !== '' && e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).textOverflow !== 'ellipsis').map((e) => (e.innerText || '').trim().slice(0, 40))`)
    const phoneMenu = async (count) => {
      await g.val('window.__kbStale = true')
      await g.page.send('Page.reload', { ignoreCache: true })
      await g.waitFor(`window.__kbStale === undefined && document.querySelector('[data-kb="workspace-card"]') !== null`, 30000)
      await g.dismissGetStarted()
      await sleep(600)
      await g.page.send('Emulation.setDeviceMetricsOverride', { width: VW, height: VH, deviceScaleFactor: 1, mobile: true })
      await sleep(700)
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await g.until(() => g.exists('[data-kb="workspace-card"] .kbfp-cardmain'), 15000)
        await g.press('[data-kb="mobile-menu"]')
        if (await g.until(async () => { const r = await rect('[data-kb="workspace-card"] .kbfp-cardmain'); return r && r.x >= 0 }, 4000)) break
      }
      await g.openMenu(); await sleep(500)
    }
    const desktopMenu = async () => {
      await g.page.send('Emulation.clearDeviceMetricsOverride', {})
      await g.val('window.__kbStale = true'); await g.page.send('Page.reload', { ignoreCache: true })
      await g.waitFor(`window.__kbStale === undefined && document.querySelector('[data-kb="workspace-card"]') !== null`, 30000)
      await g.dismissGetStarted(); await sleep(800); await g.openMenu(); await sleep(500)
    }

    const names = teams.map((t) => t.name)
    const plans = [[], names.slice(0, 2), names.slice(0, 3), names.slice(0, 4)] // 1, 3, 4, 5 spaces (Personal + the teams)
    for (const want of plans) {
      const count = want.length + 1
      console.log(`\n${count} space${count > 1 ? 's' : ''}`)
      await setMembership(want)
      await sleep(500)
      const inlineExpected = count <= 3
      await desktopMenu()
      const rowsInline = (await g.spaceRows('.kbfp-menu')).length
      const hasSwitch = await g.exists('.kbfp-menu [data-kb="menu-switch"]')
      note(`${count} spaces (desktop): ${rowsInline} rows in the menu, « Switch team » ${hasSwitch ? 'present' : 'absent'}`)
      check(`${count} spaces: ${inlineExpected ? 'the list is in the menu, no « Switch team » row' : 'the top row is « Switch team » and no list in the menu'}`, inlineExpected ? rowsInline === count && !hasSwitch : rowsInline === 0 && hasSwitch, { rowsInline, hasSwitch })
      if (!inlineExpected) { await g.press('.kbfp-menu [data-kb="menu-switch"]'); await g.until(() => g.exists('.kbfp-sub [data-kb="space-row"]'), 4000); const subRows = (await g.spaceRows('.kbfp-sub')).length; check(`${count} spaces: the list next to the menu holds every space`, subRows === count, subRows) }
      await ctx.shot(g, `j7-${count}-desktop`)
      await g.closeMenu()
      for (const scheme of ['light', 'dark']) {
        await setScheme(scheme)
        for (const lang of ['en', 'fr']) {
          await phoneMenu(count)
          if (lang === 'fr') { await g.val(`(() => { window.__kbLangBefore = window.__KB_LANG_RESOLVE__; window.__KB_LANG_RESOLVE__ = () => 'kybernos' })()`); await g.closeMenu(); await g.openMenu(); await sleep(500) }
          const inline = (await g.spaceRows('.kbfp-menu')).length
          let sub = null
          if (inline === 0 && (await g.exists('.kbfp-menu [data-kb="menu-switch"]'))) { await g.press('.kbfp-menu [data-kb="menu-switch"]'); await g.until(() => g.exists('.kbfp-sub [data-kb="space-row"]'), 4000); await sleep(1000); sub = await rect('.kbfp-sub') }
          const menu = await rect('.kbfp-menu')
          const sw = await g.val('document.documentElement.scrollWidth')
          const cut = [...(await clipped('.kbfp-menu')), ...(sub ? await clipped('.kbfp-sub') : [])]
          const tag = `${count} spaces, 390 px, ${scheme}, ${lang}`
          if (sub) {
            const cutByEllipsis = await g.val(`Array.from(document.querySelectorAll('.kbfp-sub .kbfp-wsname, .kbfp-sub .kbfp-wssub')).filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => (e.innerText || '').trim())`)
            check(`${tag}: no name or label of the « Switch team » list is cut with an ellipsis`, cutByEllipsis.length === 0, cutByEllipsis)
          }
          check(`${tag}: the menu${sub ? ' and the list' : ''} sit inside the window, no sideways scroll, no cut text`, within(menu, VW, VH) && (sub === null || within(sub, VW, VH)) && sw === VW && cut.length === 0, { menu, sub, scrollWidth: sw, cut })
          if (lang === 'fr') check(`${tag}: the strings are French`, /(Équipe|équipe|Rejoindre|Créer|Compte|Déconnexion|Se déconnecter)/.test((await g.text('.kbfp-menu')) || '') || /Rejoindre|Créer une équipe/.test((await g.text('.kbfp-sub')) || ''), await g.text('.kbfp-menu'))
          await ctx.shot(g, `j7-${count}-390-${scheme}-${lang}`)
          if (lang === 'fr') await g.val(`(() => { window.__KB_LANG_RESOLVE__ = window.__kbLangBefore; delete window.__kbLangBefore })()`)
        }
      }
      await setScheme('light').catch(() => null)
    }
    await g.page.send('Emulation.clearDeviceMetricsOverride', {})

    // B removed from the team that is active
    console.log('\nB is removed from the team he is working in')
    const t4 = teams[teams.length - 1]
    await setMembership([t4.name])
    await g.val('window.__kbStale = true'); await g.page.send('Page.reload', { ignoreCache: true })
    await g.waitFor(`window.__kbStale === undefined && document.querySelector('[data-kb="workspace-card"]') !== null`, 30000); await g.dismissGetStarted(); await sleep(1500)
    await g.goTo(t4.id, new RegExp(t4.name))
    check('B is working in ' + t4.name, /Epsilon|Delta|Beta|Alpha/.test(((await g.card()) || {}).text || '') && (await g.cardName()) === t4.name, await g.card())
    await S.call('DELETE', `/v1/workspaces/${t4.id}/members/${B.id}`, { cookie: A.cookie })
    await refreshB(); await sleep(2500)
    const after = await g.card()
    note('B removed server-side, DSH refreshed: the card now says ' + JSON.stringify(after && after.text))
    // the page has not been reloaded: what does a message do now?
    await g.selectModel('GLM')
    const tInterim = await g.send('J7 removed from the team, before any reload')
    await g.until(() => chatCalls(ctx.rows(tInterim)).length >= 1, 15000, 100)
    await sleep(2500)
    const interim = chatCalls(ctx.rows(tInterim))
    note('before the reload, the first message after the removal: ' + interim.map((c) => `${c.workspace === ctx.acc.b.personal ? 'Personal' : c.workspace === t4.id ? 'the removed team' : c.workspace} → ${c.status}`).join(', '))
    rec.interim = interim.map((c) => ({ to: c.workspace === ctx.acc.b.personal ? 'Personal' : c.workspace === t4.id ? 'removed team' : 'other', status: c.status }))
    await g.val('window.__kbStale = true'); await g.page.send('Page.reload', { ignoreCache: true })
    await g.waitFor(`window.__kbStale === undefined && document.querySelector('[data-kb="workspace-card"]') !== null`, 30000); await g.dismissGetStarted(); await sleep(2500)
    const reloaded = await g.card()
    note('after a reload the card says ' + JSON.stringify(reloaded && reloaded.text))
    check('after the removal DSH no longer presents the removed team as the active one', reloaded && !new RegExp(t4.name).test(reloaded.text.slice(0, 40)), reloaded)
    await g.selectModel('GLM')
    const tSend = await g.send('J7 removed from the team, message')
    await g.until(() => chatCalls(ctx.rows(tSend)).length >= 1, 15000, 100)
    await sleep(2500)
    const calls = chatCalls(ctx.rows(tSend))
    const personal = ctx.acc.b.personal
    note('the next message: ' + calls.map((c) => `${c.workspace === personal ? 'Personal' : c.workspace === t4.id ? 'the removed team' : c.workspace} → ${c.status}`).join(', '))
    // A chat keeps the workspace it was started in: a message in it is refused by the server (404), never billed to another workspace behind the person's back.
    // The sentence the person reads is printed (« SAID ») and judged for what is mechanical: it says the team was left, offers no retry (a retry cannot work in this window), shows no raw body.
    check('the next message in that chat is refused by the server, and billed to no other workspace', calls.length > 0 && calls.every((c) => c.workspace === t4.id && c.status === 404), calls.map((c) => [c.workspace === personal ? 'P' : c.workspace === t4.id ? 'removed' : c.workspace, c.status]))
    const said = String(await g.val(`document.body.innerText`) || '').replace(/\s+/g, ' ')
    const tail = said.slice(said.lastIndexOf('J7 removed from the team, message') + 33).trim().slice(0, 240)
    note('SAID after the second refused message: ' + tail)
    check('the refusal is a sentence about the team B left, with no raw status or JSON', /no longer in this team/i.test(tail) && !/send it again|in a moment/i.test(tail) && !/\b404\b|\{\s*"|undefined/.test(tail), tail)
    // This window is the team's own DSH: it answers that team for good (a message is refused, never billed to Personal), so it must not call itself « Personal », and the refusal must show the
    // way on: « Open Personal » asks for the personal DSH in its own window (window.open is recorded here: a journey drives one tab), and a message there is billed to Personal (T-028).
    const leftCard = await g.card()
    check('the card does not say Personal for a window that cannot bill it, and says the team was left', !!leftCard && !/Personal/.test(leftCard.text.slice(0, 60)) && /Team you left/.test(leftCard.text.slice(0, 60)), leftCard)
    const offered = await g.val(`(() => { const b = document.querySelector('[data-kb="turn-error-action"]'); return b ? b.innerText.trim() : null })()`)
    check('the refusal offers « Open Personal »', offered === 'Open Personal', offered)
    await g.val(`window.__opened = []; window.open = (u, n) => { window.__opened.push([u, n]); return {} }; const b = document.querySelector('[data-kb="turn-error-action"]'); if (b) b.click(); true`)
    const opened = await g.until(async () => { const o = await g.val('window.__opened'); return Array.isArray(o) && o.length > 0 ? o : null }, 20000, 250)
    let toPersonal = null
    try { toPersonal = new URL(String(opened[0][0])) } catch (e) { toPersonal = null }
    check('« Open Personal » opens the personal DSH of B in the window named for it', toPersonal !== null && toPersonal.host === hostB && opened[0][1] === 'kybernos-personal', opened)
    if (toPersonal !== null) {
      await g.val('window.__kbStale = true'); await g.page.send('Page.navigate', { url: toPersonal.href })
      await g.waitFor(`window.__kbStale === undefined && document.readyState === 'complete' && document.querySelector('[data-kb="workspace-card"]') !== null`, 60000); await g.dismissGetStarted(); await sleep(2500)
      const inPersonal = await g.card()
      check('in the personal DSH the card says Personal', !!inPersonal && /Personal/.test(inPersonal.text.slice(0, 40)), inPersonal)
      await g.selectModel('GLM')
      const tOwn = await g.send('J7 removed from the team, message in Personal')
      await g.until(() => chatCalls(ctx.rows(tOwn)).length >= 1, 15000, 100)
      await sleep(2500)
      const own = chatCalls(ctx.rows(tOwn))
      note('a message in Personal after the removal: ' + own.map((c) => `${c.workspace === personal ? 'Personal' : c.workspace === t4.id ? 'the removed team' : c.workspace} → ${c.status}`).join(', '))
      // a 429 on one of the turn's requests is the replica's own rate limit on a first turn (retried: the turn still answers), not a refusal: every request goes to Personal and one answers 200
      check('a message in the personal DSH is billed to Personal and the server answers', own.length > 0 && own.every((c) => c.workspace === personal) && own.some((c) => c.status === 200), own.map((c) => [c.workspace === personal ? 'P' : c.workspace === t4.id ? 'removed' : c.workspace, c.status]))
    }
    await ctx.shot(g, 'j7-removed-active')
  } finally { await g.close() }
  return finish()
}

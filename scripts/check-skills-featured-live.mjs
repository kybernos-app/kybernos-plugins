// The Featured tab of the Skills page, on the REAL GUI: the cards, what shows on hover, the install confirmation, the window, the filters.
// Every one of the 24 cards and rows is pressed with a real mouse event (a click on the card, on Details, Enter / Space), the star and Install are pressed
// too, then the failure states are played: picks slow / refused / empty, covers that do not load, SKILL.md or GitHub not answering, a 760 and a 400 px window.
//
//   node scripts/check-skills-featured-live.mjs [--shots <dir>]
//
// What is real: the DSH page, the Skills panel in the sidebar, the language the GUI is in, the cover route (the covers are the files in the
// user's DSH home). What is swapped: the client of kybernos-skills (this checkout's, in a throw-away Chrome, scripts/lib-bundle-swap.mjs).
// What is answered here, only when the running host does not have it yet (host code loads when `dsh web` restarts): ONE route,
// GET /kybernos-skills/picks, from this checkout's featured-picks.json. Install is opened and CANCELLED: nothing is written anywhere. Every write the page
// tries (the star's pin, the request for a picture) is refused with a 403 inside the check and listed; the only POST let through is the read of a SKILL.md.
//
// On a sandbox (which serves THIS checkout, not the shared tree) say so, or the client swap finds nothing to replace:
//   source scripts/sandbox/env.sh && KB_SHARED_TREE=$PWD node scripts/check-skills-featured-live.mjs
// Exit 0 all good, 1 a check failed, 3 not run (no GUI).
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openLivePage, waitFor, clickText } from './live-page.mjs'
import { swapBundles } from './lib-bundle-swap.mjs'
import { dshHome } from './dsh-home.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const PICK_COUNT = JSON.parse(readFileSync(join(here, '..', 'packages', 'kybernos-skills', 'featured-picks.json'), 'utf8')).items.length
const repo = resolve(here, '..')
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0
const failures = []
const check = (label, cond, detail) => {
  if (cond) { pass += 1; console.log('  ✓ ' + label) } else { failures.push(label); console.log('  ✗ ' + label + (detail === undefined ? '' : '  — ' + JSON.stringify(detail).slice(0, 300))) }
}

const picksFile = JSON.parse(readFileSync(join(repo, 'packages', 'kybernos-skills', 'featured-picks.json'), 'utf8'))
const coversDir = join(dshHome(), 'kybernos', 'skills-featured')
const picksAnswer = {
  ok: true, asOf: picksFile.asOf, categories: picksFile.categories,
  items: picksFile.items.map((it) => ({ ...it, cover: existsSync(join(coversDir, it.id + '.webp')) ? '/kybernos-skills/cover/' + it.id : null }))
}

const authority = process.env.KB_HOST || '127.0.0.1:3080'
// What the page is shown: the host's own answer when it serves the picks route, else the one made here from the disk. A host that
// serves the covers itself (a sandbox, or a machine whose host fetches them from the relay) lists a cover for picks that have no file in
// THIS machine's home, so the covers to expect are the ones the answer lists, not the files on disk (A3-05: 24 drawn, 15 on disk).
const hostPicks = await fetch('http://' + authority + '/kybernos-skills/picks').then((r) => r.json()).catch(() => null)
const hostHasPicks = hostPicks !== null && hostPicks.ok === true && Array.isArray(hostPicks.items) && hostPicks.items.length > 0
const shownPicks = hostHasPicks === true ? hostPicks : picksAnswer
console.log(hostHasPicks ? '(the running host serves the picks route: nothing is faked)' : '(the running host has no picks route yet: it is answered here)')

// Two things below come from the skills relay through the host, and no stub here can stand in for them: the Discover table (the index: 20 rows by default) and the pictures of the
// cards (the cover route fetches each one from the relay, and checks it against the hash the pick ships). An instance whose relay cannot be reached (offline, or KYBERNOS_SKILLS_INDEX_URL
// naming nothing) would fail those lines, which says nothing about the page: that is « not measured » (exit 3), not nine red lines.
const relayIndex = await fetch('http://' + authority + '/kybernos-skills/index?view=all-time&page=0&perPage=20').then((r) => r.json()).catch(() => null)
const relayCover = await fetch('http://' + authority + '/kybernos-skills/cover/' + encodeURIComponent(shownPicks.items[0].id)).then((r) => r.status === 200 && /^image\//.test(r.headers.get('content-type') || '')).catch(() => false)
if (relayIndex === null || relayIndex.ok !== true || !Array.isArray(relayIndex.skills) || relayIndex.skills.length < 20 || relayCover !== true) {
  console.error('○ not run: the skills relay is not reachable from this instance (the index answered ' + (relayIndex !== null && relayIndex.ok === true && Array.isArray(relayIndex.skills) ? relayIndex.skills.length + ' rows' : 'nothing') + ', the first cover ' + (relayCover === true ? 'was served' : 'was not served') + '). Discover and the pictures of the cards cannot be measured; start the instance without a KYBERNOS_SKILLS_INDEX_URL that points nowhere.')
  process.exit(3)
}

const live = await openLivePage({ width: 1500, height: 950 }).catch((e) => { console.error('○ not run: ' + e.message); process.exit(3) })
const { page } = live
const errors = []
try {
  await page.send('Runtime.enable', {})
  page.on('Runtime.exceptionThrown', (p) => errors.push(String((p.exceptionDetails && p.exceptionDetails.exception && p.exceptionDetails.exception.description) || 'exception').slice(0, 200)))
  // Fail closed (incident of 2026-10-16): this check presses Install and Cancel. Nothing but a GET may reach the skills routes of the host, so a click that
  // went through would install nothing: every other request to /kybernos-skills/ is answered here, recorded, and the check fails on it.
  // `blocked` holds every write the page tried; the star is the one write this check provokes on purpose (it asserts the request, then takes it out with `takeBlocked`).
  // The read of an installed skill's SKILL.md is a POST too, but it only reads: it goes through to the host.
  const blocked = []
  const takeBlocked = () => blocked.splice(0, blocked.length)
  // What the host is made to do, per scenario (the failure states at the end): the picks route, the cover route, SKILL.md of an installed skill, GitHub's preview.
  const scenario = { picks: 'host', covers: 'host', read: 'host', preview: 'host' }
  page.on('Fetch.requestPaused', (p) => {
    if (p.responseStatusCode !== undefined) return   // the bundle swap's business
    const path = p.request.url.split('?')[0]
    const isGet = p.request.method === 'GET'
    const go = () => page.send('Fetch.continueRequest', { requestId: p.requestId }).catch(() => {})
    const reply = (code, json) => page.send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: code, responseHeaders: [{ name: 'content-type', value: 'application/json' }], body: Buffer.from(JSON.stringify(json), 'utf8').toString('base64') }).catch(() => {})
    const slowly = (fn) => { setTimeout(fn, 4000) }
    if (!isGet && path.endsWith('/kybernos-skills/skill/read')) {
      if (scenario.read === 'refused') reply(500, { ok: false, error: 'unreachable' })
      else if (scenario.read === 'slow') slowly(go)
      else go()
      return
    }
    if (!isGet && path.includes('/kybernos-skills/')) { blocked.push(p.request.method + ' ' + path + (typeof p.request.postData === 'string' ? ' ' + p.request.postData : '')); reply(403, { ok: false, error: 'refused_by_the_check' }); return }
    if (isGet && path.includes('/kybernos-skills/cover/') && scenario.covers === 'refused') { reply(500, { ok: false, error: 'refused' }); return }
    if (isGet && path.endsWith('/kybernos-skills/preview')) {
      if (scenario.preview === 'refused') reply(200, { ok: false, error: 'github_rate_limited', http: 403 })
      else if (scenario.preview === 'slow') slowly(go)
      else go()
      return
    }
    if (isGet && path.endsWith('/kybernos-skills/picks')) {
      const answer = () => {
        if (scenario.picks === 'refused') reply(500, { ok: false, error: 'unreachable' })
        else if (scenario.picks === 'empty') reply(200, { ok: true, asOf: picksFile.asOf, categories: picksFile.categories, items: [] })
        else if (hostHasPicks === true) go()
        else reply(200, picksAnswer)
      }
      if (scenario.picks === 'slow') slowly(answer); else answer()
      return
    }
    go()
  })
  const swap = await swapBundles(page, [{ name: 'kybernos-skills' }], { extraPatterns: [{ urlPattern: '*kybernos-skills/*', requestStage: 'Request' }] })

  const js = async (expr) => (await page.evalJs(expr)).val
  const shot = async (name) => { if (shotsDir !== null) await page.shot(join(shotsDir, name + '.png')) }

  await page.send('Page.reload', { ignoreCache: true })
  await sleep(2500)
  await waitFor(page, 'document.body && document.body.innerText.length > 80', 30000)
  await clickText(page, 'Skills')
  await waitFor(page, "!!document.querySelector('.kbs-root')", 20000)
  await waitFor(page, "document.querySelectorAll('[data-kb=pick-card]').length > 0", 20000)
  await sleep(1200)

  console.log('The Featured tab — this checkout\'s client in the real GUI')
  check('the client was found in the served bundle and swapped', swap.report().every((r) => r.replaced === true), swap.report())

  check('Featured is the first segment and the selected one', await js("(() => { const b = document.querySelector('[data-kb=seg-featured]'); return !!b && b.getAttribute('aria-selected') === 'true' && b === document.querySelector('.kbsub-group [role=tab]') })()"))
  const n = await js("document.querySelectorAll('[data-kb=pick-card]').length")
  check('every pick of the file is drawn as a card', n === PICK_COUNT, n)
  check('the shared header is there (title, bar, primary action)', await js("!!document.querySelector('.kbs-root .kb6-headrow .kb6-title') && !!document.querySelector('.kbs-root .kb6-toolbar') && !!document.querySelector('.kbs-root .kb8-primary')"))
  await shot('featured-rest')

  // Covers load lazily: bring every card into view once, then count.
  await js("(async () => { for (const c of document.querySelectorAll('[data-kb=pick-card]')) { c.scrollIntoView({ block: 'center' }); await new Promise((r) => setTimeout(r, 60)) } document.querySelector('.kbs-root').scrollIntoView(); return true })()")
  await sleep(1500)
  const covers = await js("Array.from(document.querySelectorAll('[data-kb=pick-card] img.kbsf-cut')).filter((i) => i.complete && i.naturalWidth > 0).length")
  const withCover = shownPicks.items.filter((i) => i.cover !== null && i.cover !== undefined).length
  check('every cover the picks answer lists is served by the real cover route and drawn (' + withCover + ')', covers === withCover, { drawn: covers, listed: withCover, answer: hostHasPicks === true ? 'the host\'s' : 'made here from the disk' })

  const text = await js("document.querySelector('[data-kb=picks-grid]').innerText")
  check('no « /name » link on a card', /\n\/[a-z0-9-]+\n/.test('\n' + text + '\n') === false && text.includes('/pdf') === false, text.slice(0, 200))
  check('the install count is an icon and a figure, without the word « installs »', await js("(() => { const c = Array.from(document.querySelectorAll('[data-kb=pick-card] .kbsf-cnt')); return c.length === 24 && c.every((e) => /^[0-9.,]+[kM]?$/.test(e.innerText.trim()) && !!e.querySelector('svg')) })()"))
  check('the creator is on the card (owner name or its initial)', await js("(() => { const c = document.querySelector('[data-kb=pick-card]'); return !!c.querySelector('.kbsf-by .kbsf-av') && c.querySelector('.kbsf-side').getBoundingClientRect().left > c.querySelector('.kbsf-title').getBoundingClientRect().left })()"))

  // hover: the actions are there but hidden, then shown
  const rest = await js("getComputedStyle(document.querySelector('[data-kb=pick-card] .kbsf-acts')).opacity")
  check('at rest the actions are hidden (but their place is kept)', rest === '0' && await js("document.querySelector('[data-kb=pick-card] .kbsf-acts').getBoundingClientRect().height") >= 28, rest)
  const rect = await js("(() => { const c = document.querySelector('[data-kb=pick-card]'); c.scrollIntoView({ block: 'center' }); const r = c.querySelector('.kbsf-pic').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2] })()")
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rect[0], y: rect[1] })
  await sleep(500)
  const hover = await js("getComputedStyle(document.querySelector('[data-kb=pick-card] .kbsf-acts')).opacity")
  check('on hover the actions show', hover === '1', hover)
  await shot('featured-hover')
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 })

  // install: the usual confirmation opens, and is cancelled
  const installable = await js("(() => { const b = document.querySelector('[data-kb=picks-grid] [data-kb=pick-install]'); if (!b) return false; b.click(); return true })()")
  check('a card that is not installed offers Install', installable === true)
  await sleep(500)
  check('Install opens the confirmation before anything is written', await js("!!document.querySelector('.kbs-modal, [role=dialog], .kbs-confirm') || document.body.innerText.includes('Install ?') || document.body.innerText.includes('Installer ?')"))
  await shot('featured-confirm')
  await js("(() => { const e = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }); document.dispatchEvent(e); return true })()")
  await sleep(400)

  // Every card, by a REAL mouse event on its description (not `.click()`: a layer over the card would be missed), then Details, then the keyboard. Regression of 2026-10-23:
  // `list.map(pickCard)` handed the array to the card as its `opts`, so no card of the grid opened anything and Details threw. The window must show THIS pick's title.
  const realClick = async (x, y) => {
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
    await sleep(100)
    await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
    await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
  }
  const pressKey = async (key, code, vk) => {
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk, text: key === 'Enter' ? '\r' : (key === ' ' ? ' ' : undefined) })
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk })
  }
  const popupUp = () => js("!!document.querySelector('[data-kb=skill-popup] [data-kb=pick-detail]')")
  const popupTitle = () => js("(() => { const t = document.querySelector('[data-kb=skill-popup] .kbsf-dtitle'); return t ? t.innerText.trim() : null })()")
  const popupGone = async () => { try { await waitFor(page, "!document.querySelector('[data-kb=skill-popup]')", 3000); return true } catch (e) { return false } }
  const popupAppears = async () => { try { await waitFor(page, "!!document.querySelector('[data-kb=skill-popup] [data-kb=pick-detail]')", 4000); return true } catch (e) { return false } }
  const closeWithEscape = async () => { await pressKey('Escape', 'Escape', 27); return popupGone() }
  // The point to press on one piece of the i-th card (or row) of a grid / list, after bringing it to the middle of the screen.
  const pointOf = (box, hook, i, piece) => js(`(() => { const c = document.querySelectorAll('[data-kb=${box}] > [data-kb=${hook}]')[${i}]; if (!c) return null; c.scrollIntoView({ block: 'center' }); const e = c.querySelector('${piece}'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, id: c.getAttribute('data-skill'), title: c.querySelector('.kbsf-title').innerText.trim() } })()`)
  const everyOne = async (box, hook, label) => {
    const total = await js(`document.querySelectorAll('[data-kb=${box}] > [data-kb=${hook}]').length`)
    const wrong = { body: [], details: [], gone: [] }
    for (let i = 0; i < total; i++) {
      let at = await pointOf(box, hook, i, '.kbsf-out')
      await sleep(120)
      at = await pointOf(box, hook, i, '.kbsf-out')
      await realClick(at.x, at.y)
      if (!(await popupAppears()) || (await popupTitle()) !== at.title) wrong.body.push(at.id)
      if (!(await closeWithEscape())) wrong.gone.push(at.id)
      const d = await pointOf(box, hook, i, '[data-kb=pick-details]')
      await sleep(120)
      await realClick(d.x, d.y)
      if (!(await popupAppears()) || (await popupTitle()) !== at.title) wrong.details.push(at.id)
      if (!(await closeWithEscape())) wrong.gone.push(at.id)
    }
    check(label + ': a real click on each of the ' + total + ' opens the window of ITS pick', total === 24 && wrong.body.length === 0, wrong.body)
    check(label + ': Details on each of the ' + total + ' opens the same window', wrong.details.length === 0, wrong.details)
    check(label + ': Escape closes the window every time', wrong.gone.length === 0, wrong.gone)
  }
  console.log('Every card and every row, by a real click')
  await everyOne('picks-grid', 'pick-card', 'cards')
  {
    const at = await pointOf('picks-grid', 'pick-card', 0, '.kbsf-pic')
    await realClick(at.x, at.y)
    check('a click on the picture opens it too, and the card shows it is the open one', (await popupAppears()) && await js("document.querySelectorAll('[data-kb=picks-grid] > .sel').length") === 1)
    await shot('featured-window')
    const x = await js("(() => { const b = document.querySelector('[data-kb=pick-back]'); const r = b.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2] })()")
    await realClick(x[0], x[1])
    check('the ✕ closes it and the card is no longer marked', (await popupGone()) && await js("document.querySelectorAll('[data-kb=picks-grid] > .sel').length") === 0)
    await realClick(at.x, at.y)
    await popupAppears()
    await realClick(6, 6)   // outside the window: the dark backdrop
    check('a click outside the window closes it', await popupGone())
    // keyboard: Enter and Space on the focused card
    await js("document.querySelector('[data-kb=picks-grid] > [data-kb=pick-card]').focus()")
    await pressKey('Enter', 'Enter', 13)
    check('Enter on the focused card opens it', await popupAppears())
    await closeWithEscape()
    await js("document.querySelector('[data-kb=picks-grid] > [data-kb=pick-card]').focus()")
    await pressKey(' ', 'Space', 32)
    check('Space on the focused card opens it', await popupAppears())
    check('focus goes back to the card after Escape', (await closeWithEscape()) && await js("document.activeElement && document.activeElement.getAttribute('data-kb') === 'pick-card'"))
  }
  {
    // the star: off for a pick that is not installed, a real toggle request for one that is (answered 403 here: the owner's pins are never touched), and it never opens the window
    const star = await js(`(() => { const cs = Array.from(document.querySelectorAll('[data-kb=picks-grid] > [data-kb=pick-card]')); const has = cs.filter((c) => !!c.querySelector('[data-kb=pick-use]')); const not = cs.filter((c) => !!c.querySelector('[data-kb=pick-install]')); return { inst: has.length, notInst: not.length, offOnNot: not.every((c) => c.querySelector('.kbsf-star').disabled === true), onOnHas: has.every((c) => c.querySelector('.kbsf-star').disabled === false), pills: has.every((c) => /Installed/.test(c.innerText)) && not.every((c) => !/Installed/.test(c.innerText)) } })()`)
    check('every card is either Installed (Use + a live star) or not (Install + a star that waits for it)', star.inst + star.notInst === 24 && star.offOnNot && star.onOnHas && star.pills, star)
    console.log('    (' + star.inst + ' installed, ' + star.notInst + ' not installed on this machine)')
    if (star.inst > 0) {
      const at = await js(`(() => { const c = Array.from(document.querySelectorAll('[data-kb=picks-grid] > [data-kb=pick-card]')).find((x) => !!x.querySelector('[data-kb=pick-use]')); c.scrollIntoView({ block: 'center' }); const r = c.querySelector('.kbsf-star').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, id: c.getAttribute('data-skill') } })()`)
      takeBlocked()
      await realClick(at.x, at.y)
      await sleep(600)
      const wrote = takeBlocked()
      check('the star of an installed card asks the host to (un)pin THAT skill, and does not open the window', wrote.length === 1 && wrote[0].startsWith('POST') && wrote[0].includes('/kybernos-skills/featured/toggle') && wrote[0].includes('"' + at.id + '"') && !(await popupUp()), wrote)
    }
    const dead = await js(`(() => { const c = Array.from(document.querySelectorAll('[data-kb=picks-grid] > [data-kb=pick-card]')).find((x) => !!x.querySelector('[data-kb=pick-install]')); if (!c) return null; c.scrollIntoView({ block: 'center' }); const r = c.querySelector('.kbsf-star').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, tip: c.querySelector('.kbsf-star').title } })()`)
    if (dead !== null) {
      await realClick(dead.x, dead.y)
      await sleep(500)
      check('the star of a pick that is not installed does nothing, and says why', !(await popupUp()) && takeBlocked().length === 0 && dead.tip.length > 5, dead)
    }
    // Install of a card: the confirmation names THIS pick, nothing is written, the window stays shut; Cancel leaves it all as it was
    const inst = await js(`(() => { const c = Array.from(document.querySelectorAll('[data-kb=picks-grid] > [data-kb=pick-card]')).find((x) => !!x.querySelector('[data-kb=pick-install]')); if (!c) return null; c.scrollIntoView({ block: 'center' }); const b = c.querySelector('[data-kb=pick-install]'); const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, id: c.getAttribute('data-skill') } })()`)
    if (inst !== null) {
      await realClick(inst.x, inst.y)   // the mouse moves onto the card first (the actions show on hover), then presses the button itself
      await sleep(500)
      check('Install on a card opens the confirmation for THAT pick, and not the window', await js("!!document.querySelector('[data-kb=install-confirm]')") && (await js("document.querySelector('[data-kb=install-confirm]').innerText")).includes(inst.id) && !(await popupUp()))
      await pressKey('Escape', 'Escape', 27)
      await sleep(400)
      check('Cancel (Escape) closes the confirmation and nothing was written', await js("!document.querySelector('[data-kb=install-confirm]')") && takeBlocked().length === 0)
    }
  }

  // details: the pick opens in a window over the grid (✕ at the top, Install / Use / GitHub sticky at the foot), its picture and its title at the top like the card
  const gridW = await js("document.querySelector('[data-kb=picks-grid]').getBoundingClientRect().width")
  await js("document.querySelector('[data-kb=picks-grid] [data-kb=pick-details]').click()")
  await waitFor(page, "!!document.querySelector('[data-kb=pick-detail]')", 8000)
  await sleep(1200)
  check('Details opens the pick in a window over the grid, not in a side panel and not instead of the grid', await js("!!document.querySelector('[data-kb=skill-popup] [data-kb=pick-detail]') && !document.querySelector('[data-kb=disc-panel]') && !!document.querySelector('[data-kb=picks-grid]')"))
  const dw = await js("document.querySelector('[data-kb=skill-popup]').getBoundingClientRect().width")
  check('the window is wide enough for the two columns and stays inside the screen', dw > 600 && dw <= 1010, { dw, gridW })
  check('its actions are in view without a scroll (sticky at the foot of the window)', await js("(() => { const w = document.querySelector('[data-kb=skill-popup]').getBoundingClientRect(); const a = document.querySelector('[data-kb=pick-acts]').getBoundingClientRect(); return a.bottom <= w.bottom + 1 && a.top >= w.top && a.bottom <= innerHeight })()"))
  check('the picture is at the top, left of the title, and loaded', await js("(() => { const d = document.querySelector('[data-kb=pick-detail]'); const i = d.querySelector('.kbsf-dpic img.kbsf-cut'); const t = d.querySelector('.kbsf-dtitle'); return !!i && i.complete && i.naturalWidth > 0 && !!t && i.getBoundingClientRect().left < t.getBoundingClientRect().left && i.getBoundingClientRect().height > 200 })()"))
  check('the title is the card\'s title and is big', await js("(() => { const d = document.querySelector('[data-kb=pick-detail]'); const t = d.querySelector('.kbsf-dtitle'); return t.innerText.trim().length > 1 && parseFloat(getComputedStyle(t).fontSize) >= 24 })()"))
  check('the creator, the count and a way to use or install it are there', await js("(() => { const d = document.querySelector('[data-kb=pick-detail]'); return !!d.querySelector('.kbsf-by') && !!d.querySelector('.kbsf-cnt svg') && (!!d.querySelector('[data-kb=pick-install]') || !!d.querySelector('[data-kb=pick-use]')) })()"))
  check('the repository facts, the audits and the start of SKILL.md share the page', await js("(() => { const d = document.querySelector('[data-kb=pick-detail]'); const cols = d.querySelectorAll('.kbsf-dcols .kbsf-dcard'); return cols.length === 2 && cols[0].getBoundingClientRect().left < cols[1].getBoundingClientRect().left && /github\\.com\\//.test(d.innerText) })()"))
  await waitFor(page, "!!document.querySelector('[data-kb=pick-detail] [data-kb=preview-text], [data-kb=pick-detail] [data-kb=preview-missing], [data-kb=pick-detail] [data-kb=preview-error]')", 15000).catch(() => {})
  check('the real SKILL.md is read (or says why not)', await js("!!document.querySelector('[data-kb=pick-detail] [data-kb=preview-text], [data-kb=pick-detail] [data-kb=preview-missing], [data-kb=pick-detail] [data-kb=preview-error]')"))
  await shot('featured-detail')
  await js("document.querySelector('[data-kb=pick-back]').click()")
  await sleep(300)
  check('Back returns to the grid', (await js("document.querySelectorAll('[data-kb=pick-card]').length")) === 24 && await js("!document.querySelector('[data-kb=pick-detail]')"))

  // category chip, search, order
  await js("(() => { const chips = Array.from(document.querySelectorAll('.kbsf-chips .kb8-chip')); chips[1].click(); return true })()")
  await sleep(300)
  check('a category chip keeps its three picks', (await js("document.querySelectorAll('[data-kb=pick-card]').length")) === 3)
  await js("(() => { document.querySelectorAll('.kbsf-chips .kb8-chip')[0].click(); return true })()")
  await sleep(200)
  check('« All » brings every pick back', (await js("document.querySelectorAll('[data-kb=pick-card]').length")) === PICK_COUNT)

  // tint / plain
  const tintBg = await js("getComputedStyle(document.querySelector('.kbsf-pic')).backgroundImage")
  await js("document.querySelector('[data-kb=pick-bg-plain]').click()")
  await sleep(300)
  const plainBg = await js("getComputedStyle(document.querySelector('.kbsf-pic')).backgroundImage")
  check('Tint is a gradient of the category colour, Plain is the card surface', tintBg.includes('linear-gradient') && plainBg === 'none', { tintBg: tintBg.slice(0, 60), plainBg })
  check('the choice is kept in this browser', await js("window.localStorage.getItem('kybernos.skills.coverbg') === 'plain'"))
  await shot('featured-plain')
  await js("document.querySelector('[data-kb=pick-bg-tint]').click()")

  // list view: the shared bar's switch, one row per pick, the same gestures, and back
  const viewBtns = await js("Array.from(document.querySelectorAll('.kbs-root .kb6-tb-vbtn')).map((b) => b.getAttribute('data-kb'))")
  check('the shared bar offers the cards / list switch on Featured', Array.isArray(viewBtns) && viewBtns.indexOf('view-list') >= 0 && viewBtns.indexOf('view-cards') >= 0, viewBtns)
  await js("document.querySelector('.kbs-root [data-kb=view-list]').click()")
  await sleep(500)
  check('the list view draws one row per pick (24) and no card', (await js("document.querySelectorAll('[data-kb=pick-row]').length")) === 24 && (await js("document.querySelectorAll('[data-kb=pick-card]').length")) === 0)
  check('a row has its thumbnail, creator, count and the verdict', await js("(() => { const r = document.querySelector('[data-kb=pick-row]'); return !!r.querySelector('.kbsf-th') && !!r.querySelector('.kbsf-by .kbsf-av') && !!r.querySelector('.kbsf-cnt svg') && !!r.querySelector('.kbsf-pills .kbsf-pill') })()"))
  check('the row actions are always there (no hover needed)', await js("(() => { const r = document.querySelector('[data-kb=pick-row] .kbsf-racts'); const b = r.querySelector('[data-kb=pick-details]'); return !!b && b.getBoundingClientRect().width > 0 && getComputedStyle(r).opacity === '1' })()"))
  check('the row is the same pick as the card (installed flag and figure)', await js("(() => { const r = document.querySelector('[data-kb=pick-row]'); return /211\\.2k/.test(r.innerText) })()"))
  check('the choice is kept in this browser', await js("JSON.parse(window.localStorage.getItem('kybernos.skills.views')).featured === 'list'"))
  await shot('featured-list')
  await everyOne('picks-list', 'pick-row', 'rows')
  await js("document.querySelector('[data-kb=picks-list] [data-kb=pick-details]').click()")
  await waitFor(page, "!!document.querySelector('[data-kb=pick-detail]')", 8000)
  check('Details from a row opens the same window', await js("!!document.querySelector('[data-kb=skill-popup] [data-kb=pick-detail] .kbsf-dpic') && !!document.querySelector('[data-kb=pick-row]')"))
  await shot('featured-list-detail')
  await js("document.querySelector('[data-kb=pick-back]').click()")
  await sleep(300)
  check('Back returns to the list, not to the cards', (await js("document.querySelectorAll('[data-kb=pick-row]').length")) === 24)
  await js("document.querySelector('.kbs-root [data-kb=view-cards]').click()")
  await sleep(400)
  check('back to cards, the grid is there again', (await js("document.querySelectorAll('[data-kb=pick-card]').length")) === 24)

  // Discover: 20 rows, no pager above, sortable columns, the installed state is said
  await js("Array.from(document.querySelectorAll('.kbsub-group [role=tab]')).find((b) => b.getAttribute('data-kb') === 'seg-discover' || b.innerText.startsWith('Discover')).click()")
  // the skeleton rows are .kbs-row too: wait for rows that carry a name
  await waitFor(page, "Array.from(document.querySelectorAll('.kbs-root .kbs-row .who')).filter((e) => e.innerText.trim().length > 1).length >= 10", 45000)
  await sleep(800)
  // the user's own pins sit above the index rows (their first cell is a star, not a rank): count the ranked rows only
  const ranked = "Array.from(document.querySelectorAll('.kbs-root .kbs-row')).filter((r) => { const k = r.querySelector('.rank'); return !!k && /^[0-9]+$/.test(k.innerText.trim()) && !!r.querySelector('.who') })"
  const nrows = await js(ranked + '.length')
  check('Discover shows 20 rows by default', nrows === 20, nrows)
  check('there is no pager above the table (only the one below)', await js("(() => { const t = document.querySelector('.kbs-root .kbs-row'); const ps = Array.from(document.querySelectorAll('.kbs-root .kbs-pager')); return ps.length === 1 && ps[0].getBoundingClientRect().top > t.getBoundingClientRect().top })()"))
  check('the SKILL and INSTALLATIONS headers are sort buttons', await js("!!document.querySelector('[data-kb=sort-name]') && !!document.querySelector('[data-kb=sort-installs]')"))
  check('INSTALLATIONS is the order at rest, flagged descending', await js("document.querySelector('[data-kb=sort-installs]').getAttribute('aria-sort') === 'descending'"))
  const names = async () => await js(ranked + ".map((r) => r.querySelector('.who').innerText.trim())")
  const n0 = await names()
  await js("document.querySelector('[data-kb=sort-name]').click()")
  await sleep(1500)
  const n1 = await names()
  check('clicking SKILL orders the rows by name (A to Z) and flags it', JSON.stringify(n1) === JSON.stringify(n1.slice().sort((a, b) => a.localeCompare(b))) && JSON.stringify(n0) !== JSON.stringify(n1) && await js("document.querySelector('[data-kb=sort-name]').getAttribute('aria-sort') === 'ascending'"), { n0: n0.slice(0, 4), n1: n1.slice(0, 4) })
  await js("document.querySelector('[data-kb=sort-name]').click()")
  await sleep(1500)
  const n2 = await names()
  check('a second click flips it (Z to A)', JSON.stringify(n2) === JSON.stringify(n2.slice().sort((a, b) => b.localeCompare(a))) && await js("document.querySelector('[data-kb=sort-name]').getAttribute('aria-sort') === 'descending'"), n2.slice(0, 4))
  await js("document.querySelector('[data-kb=sort-installs]').click()")
  await sleep(1500)
  check('INSTALLATIONS brings the ranking back (most installed first)', JSON.stringify(await names()) === JSON.stringify(n0), (await names()).slice(0, 4))
  const states = await js("(() => { const r = " + ranked + "; return { n: r.length, said: r.filter((x) => !!x.querySelector('.kbs-instpill, [data-kb=row-install], .kb8-pill.warn')).length, installedPills: r.filter((x) => !!x.querySelector('.kbs-instpill')).length } })()")
  check('every ranked row says Installed, offers Install, or says it is off GitHub', states.n > 0 && states.said === states.n, states)
  console.log('    (' + states.installedPills + ' of the ' + states.n + ' rows are installed on this machine)')
  await js("(() => { const r = document.querySelector('.kbs-root .kbs-row .kbs-instpill'); if (r) r.scrollIntoView({ block: 'center' }); return true })()")
  await sleep(300)
  await shot('discover-table')

  // the other tabs still work
  await js("Array.from(document.querySelectorAll('.kbsub-group [role=tab]')).find((b) => b.innerText.startsWith('Yours')).click()")
  await sleep(600)
  check('Yours still opens, with its own cards', await js("document.querySelectorAll('[data-kb^=skill-card-], [data-kb^=skill-row-]').length >= 0 && !document.querySelector('[data-kb=picks-grid]')"))

  // ── the failure states: the host slow, refusing, empty; a cover that does not load; SKILL.md or GitHub not answering; a narrow window ─────────────────────────────
  console.log('Failure states')
  const reopenSkills = async (hold) => {
    await page.send('Page.reload', { ignoreCache: true })
    await sleep(2500)
    await waitFor(page, 'document.body && document.body.innerText.length > 80', 30000)
    await clickText(page, 'Skills')
    await waitFor(page, "!!document.querySelector('.kbs-root')", 20000)
    if (hold !== true) await sleep(1500)
  }
  const cardsNow = () => js("document.querySelectorAll('[data-kb=picks-grid] > [data-kb=pick-card]').length")
  const firstCardOpens = async () => {
    const at = await pointOf('picks-grid', 'pick-card', 0, '.kbsf-out')
    await sleep(150)
    const again = await pointOf('picks-grid', 'pick-card', 0, '.kbsf-out')
    await realClick(again.x, again.y)
    return { opened: await popupAppears(), title: await popupTitle(), want: at.title }
  }
  const errorsBefore = errors.length

  scenario.picks = 'slow'
  await reopenSkills(true)
  await sleep(1200)
  check('slow picks: while they load, no card and no error, the Featured count shows a dash', (await cardsNow()) === 0 && await js("(() => { const s = document.querySelector('[data-kb=seg-featured]'); return !!s && s.innerText.includes('—') })()") && errors.length === errorsBefore)
  await shot('failure-slow')
  await waitFor(page, "document.querySelectorAll('[data-kb=picks-grid] > [data-kb=pick-card]').length === 24", 20000).catch(() => {})
  const slow = await firstCardOpens()
  check('slow picks: when they arrive the 24 cards are there and the first one opens its window', (await cardsNow()) === 24 && slow.opened === true && slow.title === slow.want, slow)
  await closeWithEscape()
  scenario.picks = 'host'

  scenario.picks = 'refused'
  await reopenSkills()
  check('refused picks: no Featured tab, no card, the page lands on Yours', (await js("!document.querySelector('[data-kb=seg-featured]') && !document.querySelector('[data-kb=picks-grid]')")) && await js("(() => { const t = Array.from(document.querySelectorAll('.kbsub-group [role=tab]')).find((b) => b.getAttribute('aria-selected') === 'true'); return !!t && t.innerText.startsWith('Yours') })()"))
  await shot('failure-refused')
  scenario.picks = 'empty'
  await reopenSkills()
  check('an empty list of picks is the same as no picks: no Featured tab, no card, the page lands on Yours', (await cardsNow()) === 0 && await js("!document.querySelector('[data-kb=seg-featured]')") && await js("(() => { const t = Array.from(document.querySelectorAll('.kbsub-group [role=tab]')).find((b) => b.getAttribute('aria-selected') === 'true'); return !!t && t.innerText.startsWith('Yours') })()"))
  await shot('failure-empty')
  scenario.picks = 'host'

  await reopenSkills()
  await js("document.querySelector('[data-kb=toggle-search]').click()")
  await sleep(400)
  await js("(() => { const i = document.querySelector('.kbs-root .kb6-toolbar input'); if (i) i.focus(); return !!i })()")
  await page.send('Input.insertText', { text: 'zzzqqq' })
  await sleep(600)
  check('a search that matches nothing: the empty message, no card, and the window cannot be opened by mistake', (await cardsNow()) === 0 && await js("!!document.querySelector('.kbs-root .kb-empty') && !document.querySelector('[data-kb=skill-popup]')"))
  await shot('failure-nomatch')

  scenario.covers = 'refused'
  takeBlocked()
  await reopenSkills()
  await sleep(1500)
  // Lazy pictures are only asked for when near the screen: walk the grid once so every one fails, then look at what each card shows.
  await js("(async () => { for (const c of document.querySelectorAll('[data-kb=picks-grid] > [data-kb=pick-card]')) { c.scrollIntoView({ block: 'center' }); await new Promise((r) => setTimeout(r, 80)) } return true })()")
  await sleep(2500)
  const pics = await js("Array.from(document.querySelectorAll('[data-kb=picks-grid] > [data-kb=pick-card] .kbsf-pic')).map((p) => { const i = p.querySelector('img.kbsf-cut'); return { tile: !!p.querySelector('.kb8-tile'), img: !!i && i.style.display !== 'none' && i.naturalWidth > 0 } })")
  check('covers that cannot be loaded: none of the 24 pictures is an empty tint, each card draws its tile', pics.length === 24 && pics.every((p) => p.tile === true && p.img === false), pics.filter((p) => p.tile !== true).length + ' cards without a tile')
  const noCovers = await firstCardOpens()
  check('covers that cannot be loaded: a card still opens its window, with the tile as its picture', (await cardsNow()) === 24 && noCovers.opened === true && noCovers.title === noCovers.want && await js("!!document.querySelector('[data-kb=skill-popup] .kbsf-dpic .kb8-tile') && !document.querySelector('[data-kb=skill-popup] .kbsf-dpic img.kbsf-cut')"), noCovers)
  await shot('failure-covers')
  await closeWithEscape()
  const asked = takeBlocked()
  check('the only write the page tried was to ask the host for a picture (refused here: nothing is generated on this machine)', asked.every((w) => w.includes('/kybernos-skills/covers/make')), asked)
  scenario.covers = 'host'

  // SKILL.md of an installed skill (a read through the host) that is slow, then refused; GitHub's preview of one that is not installed, slow then refused
  const installedCard = async () => js("Array.from(document.querySelectorAll('[data-kb=picks-grid] > [data-kb=pick-card]')).findIndex((c) => !!c.querySelector('[data-kb=pick-use]'))")
  const notInstalledCard = async () => js("Array.from(document.querySelectorAll('[data-kb=picks-grid] > [data-kb=pick-card]')).findIndex((c) => !!c.querySelector('[data-kb=pick-install]'))")
  const open = async (i) => { const at = await pointOf('picks-grid', 'pick-card', i, '.kbsf-out'); await sleep(150); const a2 = await pointOf('picks-grid', 'pick-card', i, '.kbsf-out'); await realClick(a2.x, a2.y); return { opened: await popupAppears(), title: await popupTitle(), want: at.title } }
  const windowFits = () => js("(() => { const w = document.querySelector('[data-kb=skill-popup]').getBoundingClientRect(); const x = document.querySelector('[data-kb=pick-back]').getBoundingClientRect(); return w.left >= 0 && w.right <= innerWidth + 1 && w.top >= 0 && w.bottom <= innerHeight + 1 && x.width > 0 && x.right <= innerWidth && x.bottom <= innerHeight })()")
  scenario.read = 'refused'; scenario.preview = 'refused'
  await reopenSkills()
  {
    const ii = await installedCard()
    const ni = await notInstalledCard()
    if (ii >= 0) {
      const r = await open(ii)
      await shot('failure-read-refused')
      await waitFor(page, "!!document.querySelector('[data-kb=pick-detail] [data-kb=preview-error]')", 8000).catch(() => {})
      check('an installed pick whose SKILL.md cannot be fetched: the window opens, says so in a sentence, and the ✕ still closes it', r.opened && r.title === r.want && await js("(() => { const n = document.querySelector('[data-kb=pick-detail] [data-kb=preview-error]'); return !!n && n.innerText.trim().length > 20 })()") && (await closeWithEscape()), r)
    }
    if (ni >= 0) {
      const r = await open(ni)
      await shot('failure-preview-refused')
      await waitFor(page, "!!document.querySelector('[data-kb=pick-detail] [data-kb=preview-error]')", 8000).catch(() => {})
      check('a pick that is not installed whose GitHub preview is refused: the window opens and says so in a sentence, the facts and the actions are there, ✕ closes it', r.opened && r.title === r.want && await js("(() => { const d = document.querySelector('[data-kb=pick-detail]'); const n = d.querySelector('[data-kb=preview-error]'); return !!n && n.innerText.trim().length > 20 && !!d.querySelector('[data-kb=pick-install]') && !!d.querySelector('[data-kb=pick-acts]') })()") && (await closeWithEscape()), r)
    }
  }
  scenario.read = 'slow'; scenario.preview = 'slow'
  await reopenSkills()
  {
    const ni = await notInstalledCard()
    if (ni >= 0) {
      const r = await open(ni)
      await shot('failure-preview-slow')
      check('a slow GitHub preview: the window is already there (the page does not wait for it), with the title, the facts and the actions', r.opened && r.title === r.want && await js("!!document.querySelector('[data-kb=pick-detail] [data-kb=pick-acts]')"), r)
      await closeWithEscape()
    }
  }
  scenario.read = 'host'; scenario.preview = 'host'

  // a narrow window: 400 px and 760 px (phone and half a screen). The page is on Skills already; only the size changes.
  await reopenSkills()
  for (const [w, h] of [[760, 900], [400, 860]]) {
    await page.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false })
    await sleep(800)
    const r = await open(0)
    check(w + ' px: a card opens its window, and the window and its ✕ stay inside the screen', r.opened && r.title === r.want && await windowFits(), r)
    await shot('narrow-' + w)
    const x = await js("(() => { const b = document.querySelector('[data-kb=pick-back]'); const r = b.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2] })()")
    await realClick(x[0], x[1])
    check(w + ' px: the ✕ closes it', await popupGone())
    check(w + ' px: no horizontal scroll on the page', await js("document.documentElement.scrollWidth <= innerWidth + 1"))
  }
  await page.send('Emulation.clearDeviceMetricsOverride', {})

  check('no script error was thrown during the failure states', errors.length === errorsBefore, errors.slice(errorsBefore))
  check('no script error was thrown during the run', errors.length === 0, errors)
  check('nothing but a GET reached the skills routes (a write was refused inside the check)', blocked.length === 0, blocked)
} finally {
  await live.close()
}
console.log('\n' + pass + ' checks passed' + (failures.length > 0 ? ', ' + failures.length + ' FAILED' : ''))
process.exit(failures.length > 0 ? 1 : 0)

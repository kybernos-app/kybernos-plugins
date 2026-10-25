#!/usr/bin/env node
// Checks the signed-session rule of the eight bundles of fix 7 (hub, workers, servers, skills, search, websearch, free-llms, sessions; recette 2026-10-25) against a REAL DSH GUI.
//
//   source scripts/sandbox/env.sh && node scripts/check-bundle-guards-live.mjs [--shots <dir>]
//
// Part 1, every write route of the eight bundles (65): from this script, a local program, which is what the rule is about
//   - no header at all                                   -> 403
//   - a foreign Origin, even with DSH's real cookie       -> 403
//   - the right Origin and no cookie                      -> 401
// and from INSIDE the signed-in page (a same-origin fetch: the browser adds the Origin and the session cookie, as for the plugins' own pages) the same route with a body that
// changes nothing -> anything but 401/403. A page that stopped working shows here. Three routes are left out of that second half because their answer is a call to the outside
// world (`/kybernos-hub/catalogue/refresh`, `/kybernos-websearch/seam`, `/kybernos-skills/scout/run`) or a kill switch (`/kybernos-skills/learned/stop`); the clicks below cover the first two.
// Part 2, what the pages do when a person clicks: the Suite's « Check for updates » and a module switch, the Workers' « Check », the Servers' « Check » of an address, the Web search
// switch and « Search the way an agent does », the Learned skills level, the Skills page's « Install » and Search everywhere. For each, the status the BROWSER got for the page's own
// request is read from the network log (a 401 or 403 is a page that stopped working), and the request is shown to carry the right Origin and DSH's cookie on the wire.
//
// It writes to the instance it talks to, so it REFUSES the real DSH (127.0.0.1:3080) unless --allow-real is given: use an isolated instance (scripts/sandbox, docs/dev/live-testing.md).
// Exit code: 0 all green, 1 a check failed, 3 inconclusive (GUI down). Named check-*, not test-*: CI has no DSH.
import http from 'node:http'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { openLivePage, openSettings, goToSettingsPage, waitFor } from './live-page.mjs'
import { cookieDeSession } from './cdp-lib.mjs'

const args = process.argv.slice(2)
const HOST = process.env.KB_HOST || '127.0.0.1:3080'
if (HOST === '127.0.0.1:3080' && !args.includes('--allow-real')) {
  console.error('✗ this check writes to the instance it talks to, and that is the real DSH (127.0.0.1:3080).')
  console.error('  Start an isolated instance (own HOME and DSH_HOME) and point KB_HOST at it, or pass --allow-real if you mean it.')
  process.exit(2)
}
const shotsDir = args.indexOf('--shots') >= 0 ? args[args.indexOf('--shots') + 1] : null
if (shotsDir !== null) mkdirSync(shotsDir, { recursive: true })

let pass = 0
let fail = 0
let skipped = 0
const check = (name, ok, detail) => {
  if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail).slice(0, 300))) }
}
const skip = (what, why) => { skipped += 1; console.log('SKIPPED: ' + what + ' — ' + why) }

const [host, port] = HOST.split(':')
const session = cookieDeSession(HOST)
if (session === null) { console.error('○ inconclusive: the browser-session secret is unreadable (is HOME/DSH_HOME the instance\'s?)'); process.exit(3) }

/** One request from this script: the headers are exactly the ones given. */
const ask = (method, path, headers, body) => new Promise((resolve) => {
  const payload = body === undefined ? null : JSON.stringify(body)
  const req = http.request({ host, port: Number(port), path, method, headers: { host: HOST, ...headers, ...(payload === null ? {} : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) }) } }, (res) => {
    res.resume()
    res.on('end', () => resolve(res.statusCode))
  })
  req.on('error', () => resolve(0))
  req.setTimeout(20000, () => { req.destroy(); resolve(-1) })
  if (payload !== null) req.write(payload)
  req.end()
})

const SKILLS = ['skill/read', 'skill/reveal', 'skill/duplicate', 'skill/delete', 'toggle', 'create', 'install', 'team/pack', 'team/install', 'index-source/set', 'featured/toggle', 'covers/make', 'covers/auto',
  'scout/run', 'scout/dismiss', 'learned/from-lessons', 'learned/accept', 'learned/edit', 'learned/discard', 'learned/restore', 'learned/undo', 'learned/settings/set', 'learned/keep',
  'learned/notice/answer', 'learned/notice/forget', 'learned/week/hide', 'learned/shared', 'learned/stop']
const SESSIONS = ['isolate', 'commit', 'close-check', 'close', 'reclaim', 'push', 'fetch', 'sync', 'pr', 'settings', 'categories', 'brain/health', 'decision']
/** [path, a body that changes nothing, `false` when the signed-in page must not send it (an outside call, a kill switch)] */
const ROUTES = [
  ['/kybernos-hub/module', { id: 'nope', action: 'activer' }], ['/kybernos-hub/relaunch', {}], ['/kybernos-hub/engine', {}], ['/kybernos-hub/update', {}], ['/kybernos-hub/catalogue/refresh', {}, false],
  ['/kybernos-workers/install', { worker: 'no-such-worker' }], ['/kybernos-workers/activate', { worker: 'no-such-worker' }], ['/kybernos-workers/policy', { worker: 'no-such-worker', expose: false, background: false }], ['/kybernos-workers/check', { worker: 'no-such-worker' }],
  ['/kybernos-servers/check', { address: '' }], ['/kybernos-servers/add', { address: '' }], ['/kybernos-servers/switch', { id: '' }], ['/kybernos-servers/rename', { id: '', name: '' }], ['/kybernos-servers/remove', { id: '' }],
  ...SKILLS.map((s) => ['/kybernos-skills/' + s, {}, s === 'scout/run' || s === 'learned/stop' ? false : undefined]),
  ['/kybernos-search/query', { q: 'zz-guard-live' }], ['/kybernos-search/start', {}], ['/kybernos-search/reindex', {}],
  ['/kybernos-websearch/key', { ref: 'HOME', value: 'aaaaaaaaaaaaaaa' }], ['/kybernos-websearch/settings', {}], ['/kybernos-websearch/test', { id: 'no-such-engine' }], ['/kybernos-websearch/seam', {}, false],
  ['/free-llms/enable', {}], ['/free-llms/disable', {}], ['/free-llms/auto-enable', { hasOwnModel: true }],
  ...SESSIONS.map((s) => ['/kybernos-sessions/' + s, {}]),
]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const live = await openLivePage({ width: 1500, height: 950 }).catch((e) => { console.error('○ inconclusive: ' + e.message); process.exit(3) })
const { page } = live
const ev = async (js, ms = 10000) => { const r = await page.evalJs(js, ms); return r.err ? { __err: r.err } : r.val }
const q = (x) => JSON.stringify(x)
/** The same request, from inside the signed-in page: the browser adds the Origin and the session cookie. */
const fromPage = async (path, body) => {
  const init = { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
  const r = await page.evalJs('fetch(' + q(path) + ', ' + q(init) + ').then((r) => r.status, () => 0)', 30000)
  return r.err !== undefined ? 0 : r.val
}

// The browser's own requests: method and URL when they leave, status when they come back, and the headers Chrome really puts on the wire.
const OURS = /\/(kybernos-hub|kybernos-workers|kybernos-servers|kybernos-skills|kybernos-search|kybernos-websearch|free-llms|kybernos-sessions)\//
const methodOf = new Map()
const urlOf = new Map()
const wire = new Map()
const answered = []
await page.send('Network.enable', {})
page.on('Network.requestWillBeSent', (p) => { if (p.request) { methodOf.set(p.requestId, p.request.method); urlOf.set(p.requestId, p.request.url) } })
page.on('Network.requestWillBeSentExtraInfo', (p) => { wire.set(p.requestId, p.headers || {}) })
page.on('Network.responseReceived', (p) => {
  if (p.response && OURS.test(p.response.url)) answered.push({ id: p.requestId, method: methodOf.get(p.requestId) || '?', path: new URL(p.response.url).pathname, status: p.response.status })
})
const mark = () => answered.length
const since = (n, method, path) => answered.slice(n).filter((a) => a.method === method && a.path === path)
const lastOf = (n, path) => { const hits = since(n, 'POST', path); return hits.length === 0 ? null : hits[hits.length - 1] }
const onWire = (entry) => {
  const h = {}
  for (const [k, v] of Object.entries(wire.get(entry.id) || {})) h[k.toLowerCase()] = v
  return h
}
const shot = async (name) => { if (shotsDir !== null) await page.shot(join(shotsDir, name + '.png')).catch(() => {}) }
const sees = async (n, path, label, shotName) => {
  // the answer of a slow route (a worker's check runs programs) is awaited, up to half a minute
  for (let waited = 0; waited < 30000 && lastOf(n, path) === null; waited += 500) await sleep(500)
  await sleep(300)
  const a = lastOf(n, path)
  check(label + ': the browser\'s own POST to ' + path + ' was answered (' + (a === null ? 'none' : a.status) + '), not refused', a !== null && a.status !== 401 && a.status !== 403 && a.status < 500, a)
  if (a !== null) {
    const h = onWire(a)
    check(label + ': it carried the right Origin and DSH\'s session cookie on the wire', h.origin === 'http://' + HOST && /(^|;\s*)dsh-auth-/.test(h.cookie || ''), { origin: h.origin, cookie: h.cookie ? '(present)' : undefined })
  }
  if (shotName) await shot(shotName)
  return a
}
const clickByText = (text, within) => ev(`(() => { const root = ${within ? 'document.querySelector(' + q(within) + ')' : 'document'}; if (!root) return false; const b = [...root.querySelectorAll('button')].find((x) => x.offsetParent !== null && (x.innerText || '').trim() === ${q(text)}); if (!b) return false; b.click(); return true })()`)
const clickSel = (sel) => ev(`(() => { const b = document.querySelector(${q(sel)}); if (!b || b.offsetParent === null) return false; b.scrollIntoView({ block: 'center' }); b.click(); return true })()`)
const typeInto = (selector, value) => ev(`(() => { const i = document.querySelector(${q(selector)}); if (!i) return false; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, ${q(value)}); i.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)

try {
  console.log('1. every write route of the eight bundles: refused to a local program, answered to the page')
  const origin = 'http://' + HOST
  const cookie = session.nom + '=' + session.valeur
  for (const [path, body, fromThePage] of ROUTES) {
    const a = await ask('POST', path, {}, body)
    const b = await ask('POST', path, { origin: 'http://evil.example', cookie }, body)
    const c = await ask('POST', path, { origin }, body)
    check('POST ' + path + ': no header 403, foreign Origin 403, no cookie 401', a === 403 && b === 403 && c === 401, [a, b, c])
    if (fromThePage === false) continue
    const p = await fromPage(path, body)
    check('POST ' + path + ': the signed-in page is answered (' + p + ')', p !== 401 && p !== 403 && p > 0 && p < 500, p)
  }
  check('the 65 routes of the family were played', ROUTES.length === 65, ROUTES.length)

  console.log('left at the Origin alone on purpose, still answered')
  check('POST /kybernos-hub/beacon: the right Origin and no cookie is answered (the crash detector does not need the session)', await ask('POST', '/kybernos-hub/beacon', { origin }, { type: 'loading' }) === 200)
  check('POST /kybernos-hub/beacon: no header and a foreign Origin are still refused', await ask('POST', '/kybernos-hub/beacon', {}, { type: 'loading' }) === 403 && await ask('POST', '/kybernos-hub/beacon', { origin: 'http://evil.example' }, { type: 'loading' }) === 403)

  console.log('2. the pages\' own requests, clicked in the real GUI')
  await waitFor(page, `document.readyState === 'complete'`, 15000)
  await sleep(2500)
  if (await openSettings(page, { minCells: 0 }) !== true) check('the Settings dialog opens', false)
  else {
    // Kybernos Suite: « Check for updates », then a module switched off and on.
    let n = mark()
    if (await goToSettingsPage(page, 'Kybernos Suite', { settleMs: 1500 }) !== true) check('Kybernos Suite: the page opens', false)
    else {
      await waitFor(page, `!!document.querySelector('[data-kb="suite-verifier"]')`, 10000)
      check('Suite: « Check for updates » is there and is clicked', await clickSel('[data-kb="suite-verifier"]') === true)
      await sleep(2500)
      await sees(n, '/kybernos-hub/catalogue/refresh', 'Suite', 'bundle-guards-suite')
      n = mark()
      const off = await ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.offsetParent !== null && /^Turn off (Slides|Motion|Bricks)$/.test((x.getAttribute('aria-label') || x.innerText || '').trim())); if (!b) return null; const label = (b.getAttribute('aria-label') || b.innerText).trim(); b.click(); return label })()`)
      if (typeof off !== 'string') skip('Suite: a module switch', 'no « Turn off Slides / Motion / Bricks » button on this instance')
      else {
        check('Suite: « ' + off + ' » is clicked', true)
        await sleep(3000)
        const a = await sees(n, '/kybernos-hub/module', 'Suite switch')
        check('Suite: the host kept the choice (the page was answered 200)', a !== null && a.status === 200, a)
        n = mark()
        const on = await ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.offsetParent !== null && /^Turn on (Slides|Motion|Bricks)$/.test((x.getAttribute('aria-label') || x.innerText || '').trim())); if (!b) return null; b.click(); return true })()`)
        if (on === true) { await sleep(3000); await sees(n, '/kybernos-hub/module', 'Suite switch back') } else skip('Suite: switching the module back on', 'its « Turn on » button did not appear')
      }
    }

    // Workers: « Check » on a row (runs the agent's --version in the sandbox).
    n = mark()
    if (await goToSettingsPage(page, 'Workers', { settleMs: 1500 }) !== true) check('Workers: the page opens', false)
    else {
      // A row that was checked before shows « Sign in » instead (the host remembers the last check): press the first row that still says « Check ».
      await waitFor(page, `!!document.querySelector('[data-kb^="wk-check-row-"]')`, 10000)
      check('Workers: « Check » on the first worker that offers it is clicked', await clickSel('[data-kb^="wk-check-row-"]') === true)
      await sleep(2500)
      await sees(n, '/kybernos-workers/check', 'Workers', 'bundle-guards-workers')
    }

    // Servers: « + Add a server », an address that nobody answers, « Check ».
    n = mark()
    if (await goToSettingsPage(page, 'Servers', { settleMs: 1500 }) !== true) check('Servers: the page opens', false)
    else {
      await waitFor(page, `!!document.querySelector('[data-kb="servers-add-open"]')`, 10000)
      check('Servers: « + Add a server » is clicked', await clickSel('[data-kb="servers-add-open"]') === true)
      await waitFor(page, `!!document.querySelector('[data-kb="servers-address"]')`, 8000)
      // The page asks the host (POST /kybernos-servers/check) when the person presses Enter in the field (or leaves it).
      check('Servers: an address nobody answers is typed, then Enter is pressed', await ev(`(() => { const i = document.querySelector('[data-kb="servers-address"]'); if (!i) return false; i.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, '127.0.0.1:1'); i.dispatchEvent(new Event('input', { bubbles: true })); return true })()`) === true)
      await sleep(500) // the page keeps the typed address in its state before the key handler reads it
      await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' })
      await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
      await sleep(2500)
      await sees(n, '/kybernos-servers/check', 'Servers', 'bundle-guards-servers')
      await clickByText('Cancel', '.kbsv-dlg')
    }

    // Web Search: an engine switch (POST /settings) put back, and « Search the way an agent does » (POST /seam: DSH's web seam, one outside search).
    n = mark()
    if (await goToSettingsPage(page, 'Web Search', { settleMs: 1500 }) !== true) check('Web Search: the page opens', false)
    else {
      await waitFor(page, `document.querySelectorAll('[data-kb="websearch-switch"]').length > 1`, 10000)
      const clickLast = () => ev(`(() => { const s = [...document.querySelectorAll('[data-kb="websearch-switch"]')]; const b = s[s.length - 1]; if (!b) return false; b.click(); return true })()`)
      check('Web Search: the last engine\'s switch is clicked', await clickLast() === true)
      await sleep(1200)
      await sees(n, '/kybernos-websearch/settings', 'Web Search', 'bundle-guards-websearch')
      await clickLast()
      await sleep(1200)
      n = mark()
      check('Web Search: « Search the way an agent does » is clicked', await clickByText('Search the way an agent does') === true)
      await sleep(6000)
      await sees(n, '/kybernos-websearch/seam', 'Web Search seam')
    }

    // Learned skills: the level Kaby works at (POST /learned/settings/set), put back.
    n = mark()
    if (await goToSettingsPage(page, 'Learned skills', { settleMs: 1500 }) !== true) check('Learned skills: the page opens', false)
    else {
      await waitFor(page, `!!document.querySelector('[data-kb="level-improve"]')`, 10000)
      check('Learned skills: « Improve its own skills » is clicked', await clickSel('[data-kb="level-improve"]') === true)
      await sleep(1200)
      await sees(n, '/kybernos-skills/learned/settings/set', 'Learned skills', 'bundle-guards-learned')
      await clickSel('[data-kb="level-ask"]')
      await sleep(1200)
    }

    // Close Settings: the Skills page and Search everywhere are in the main window.
    await ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => (x.innerText || '').trim() === 'Back to workspace'); if (b) b.click() })()`)
    await sleep(1500)
  }

  // Skills page: « Install » of a featured pick (a confirmation first), then the SKILL.md of an installed skill opens.
  {
    const n = mark()
    const opened = await ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => (x.innerText || '').trim() === 'Skills'); if (!b) return false; b.click(); return true })()`)
    check('Skills: the sidebar entry is clicked', opened === true)
    await waitFor(page, `!!document.querySelector('.kbs-root')`, 15000)
    await sleep(2000)
    if (await clickSel('[data-kb="pick-install"]') !== true) skip('Skills: « Install » of a featured pick', 'no install button on the Featured tab')
    else {
      await sleep(1000)
      const confirmed = await ev(`(() => { const dlg = document.querySelector('[role="dialog"], .kbs-pop, .kbs-dlg'); const root = dlg || document; const b = [...root.querySelectorAll('button')].find((x) => x.offsetParent !== null && /^Install\\b/.test((x.innerText || '').trim()) && x.getAttribute('data-kb') !== 'pick-install'); if (!b) return false; b.click(); return true })()`)
      await sleep(confirmed === true ? 6000 : 500)
      const a = lastOf(n, '/kybernos-skills/install')
      if (a === null) skip('Skills: the install request', 'the page showed no confirmation to press (' + confirmed + '); no request left')
      else await sees(n, '/kybernos-skills/install', 'Skills install', 'bundle-guards-skills')
    }
    // The detail of a skill of the person: the SKILL.md is read with a POST.
    const n2 = mark()
    await ev(`(() => { const t = [...document.querySelectorAll('button')].find((x) => /^Yours\\b/.test((x.innerText || '').trim())); if (t) t.click() })()`)
    await sleep(1500)
    const row = await ev(`(() => { const r = document.querySelector('.kbs-root [data-kb^="skill-card-"]'); if (!r) return false; r.click(); return true })()`)
    if (row !== true) skip('Skills: the detail of a skill (skill/read)', 'no skill card on the « Yours » tab; the route is played in part 1')
    else await sees(n2, '/kybernos-skills/skill/read', 'Skills detail')
  }

  // Search everywhere: the dialog starts the index and asks.
  {
    const n = mark()
    check('Search everywhere: its button is clicked', await clickSel('[data-kb="search-top"]') === true)
    await waitFor(page, `!!document.querySelector('.kbsr-dlg input')`, 8000)
    await sleep(1200)
    check('Search everywhere: a word is typed', await typeInto('.kbsr-dlg input', 'skill') === true)
    await sleep(2500)
    await sees(n, '/kybernos-search/start', 'Search everywhere (index)')
    await sees(n, '/kybernos-search/query', 'Search everywhere (query)', 'bundle-guards-search')
  }

  // The sessions bundle: its requests come from the page without a click (the list classifies chats, the Settings page reads the Study model); say what was seen.
  {
    const mine = answered.filter((a) => /\/kybernos-sessions\//.test(a.path) && a.method === 'POST')
    check('Sessions: every POST the page made on its own was answered, none refused (' + mine.length + ' seen)', mine.every((a) => a.status !== 401 && a.status !== 403), mine)
    if (mine.length === 0) skip('Sessions: a POST made by the page on its own', 'none left during this run; the thirteen routes are played in part 1')
  }

  // Nothing the page asked for in the whole run was refused by a guard.
  const refused = answered.filter((a) => a.method === 'POST' && (a.status === 401 || a.status === 403))
  check('in the whole run no POST of the page to the eight bundles was refused with a 401 or 403 (' + answered.filter((a) => a.method === 'POST').length + ' POSTs seen)', refused.length === 0, refused)
} finally {
  await live.close()
}

console.log('\n' + (fail === 0 ? '✓ all ' + pass + ' checks passed' : '✗ ' + fail + ' failed, ' + pass + ' passed') + (skipped > 0 ? ', ' + skipped + ' skipped' : ''))
process.exit(fail === 0 ? 0 : 1)

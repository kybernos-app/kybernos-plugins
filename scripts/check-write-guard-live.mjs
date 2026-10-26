#!/usr/bin/env node
// Checks the origin rule of the write routes (docs/dev/route-origin-rule.md) against a REAL DSH GUI.
//
//   source scripts/sandbox/env.sh && node scripts/check-write-guard-live.mjs [--shots <dir>]
//
// For every write route the rule covers it plays, from this script (a local program, which is what the rule is about):
//   - no header at all                                   -> 403
//   - a foreign Origin, even with DSH's real cookie       -> 403
//   - the right Origin and no cookie                      -> 401
// and then, from INSIDE the signed-in page (what the plugin's own pages do: a same-origin fetch, so the browser adds the Origin and the
// session cookie) the same route with a body that changes nothing -> anything but 401/403. A page that stopped working shows here.
// 2026-10-25 (L3-04, L3-05, L3-06, L3-19): the cloud and plugin writes that had stayed at the Origin alone are in the list (the ones that would act on a real account or machine: the
// local-program half only), the Account page's custom instructions are typed and saved with real clicks, and the routes the call side still reaches with the Origin alone are checked as such.
// The routes left open on purpose (the Auto CLI's /router and /report) must still answer with no header,
// and the free-models gateway must refuse what a browser marks as another site (a foreign Origin, Sec-Fetch-Site cross-site) with nothing sent
// upstream (the allowed side is proved offline by packages/kybernos-free-llms/test-gateway-origin.mjs: it would call opencode.ai).
//
// It writes empty or invalid bodies to the instance it talks to, so it REFUSES the real DSH (127.0.0.1:3080) unless --allow-real is given:
// use an isolated instance (own HOME and DSH_HOME, see docs/dev/live-testing.md).
//
// Exit code: 0 all green, 1 a check failed, 3 inconclusive (GUI down). Named check-*, not test-*: CI has no DSH.
import http from 'node:http'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { openLivePage, openSettings, waitFor } from './live-page.mjs'
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
const check = (name, ok, detail) => {
  if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail).slice(0, 300))) }
}

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

// Every write the rule covers, with a body that changes nothing (an empty or invalid one: the route's own answer is a 400 or an `ok:false`).
const GUARDED = [
  ['POST', '/kybernos/composio/connecteurs', {}], ['DELETE', '/kybernos/composio/connecteurs?nom=zz-guard-live'],
  ['POST', '/kybernos/composio/connecteurs/test', { nom: 'zz-guard-live' }], ['POST', '/kybernos/composio/connecteurs/commande', { dir: '/nowhere' }],
  ['DELETE', '/kybernos/composio/connecteurs/commande?dir=/nowhere'], ['POST', '/kybernos/composio/key', { key: 'not-a-key' }],
  ['POST', '/kybernos/composio/accounts', { action: 'add', toolkit: 'Not A Slug' }], ['POST', '/kybernos/composio/provider', { provider: 'nope' }],
  ['POST', '/kybernos/composio/openapi', { action: 'remove', name: 'zz-guard-live' }],
  ['POST', '/kybernos-memory/lessons/add', {}], ['POST', '/kybernos-memory/lessons/update', { id: 'zz' }], ['POST', '/kybernos-memory/lessons/delete', { id: 'zz' }],
  ['POST', '/kybernos-memory/tidy/scan'], ['POST', '/kybernos-memory/tidy/apply', { confirm: true, groups: [] }], ['POST', '/kybernos-memory/tidy/dismiss', {}],
  ['POST', '/kybernos-memory/tidy/undo', {}], ['POST', '/kybernos-memory/tidy/settings', {}], ['POST', '/kybernos-memory/settings/set', {}],
  ['POST', '/kybernos-auto/session', { sessionId: '', on: true }], ['POST', '/kybernos-auto/settings', {}], ['POST', '/kybernos-auto/probe', {}],
  ['POST', '/modeles-locaux/installer', { cible: '' }], ['POST', '/modeles-locaux/annuler', {}],
  // kybernos-models: bodies the route answers with a 400 (nothing stored, no call out). The journal takes `null` because an empty object is a line; scores/sync is left out
  // on purpose (a stale snapshot makes it start a ~4 MB download: packages/kybernos-models/test-write-guard.mjs plays it offline).
  ['POST', '/kybernos-models/annotations/save', {}], ['POST', '/kybernos-models/journal', null], ['POST', '/kybernos-models/key/check', {}],
  ['POST', '/kybernos-models/providers/park', {}], ['POST', '/kybernos-models/providers/take', {}], ['POST', '/kybernos-models/providers/forget', {}],
  ['POST', '/kybernos-models/scores/list', {}],
  ['POST', '/kybernos-computers/key/set', {}], ['POST', '/kybernos-computers/key/clear', {}], ['POST', '/kybernos-computers/sandboxes/start', {}],
  ['POST', '/kybernos-computers/sandboxes/exec', {}], ['POST', '/kybernos-computers/sandboxes/write', {}], ['POST', '/kybernos-computers/sandboxes/stop', {}],
  ['POST', '/kybernos-computers/sandboxes/pause', {}], ['POST', '/kybernos-computers/sandboxes/resume', {}], ['POST', '/kybernos-computers/env/set', { env: 'nope' }],
  ['POST', '/kybernos-cloud/memory/delete', { id: 'zz' }], ['POST', '/kybernos-cloud/members/remove', {}], ['POST', '/kybernos-cloud/team/lessons/delete', { id: 1 }],
  ['POST', '/kybernos-cloud/team/skills/delete', { id: 'zz' }], ['POST', '/kybernos-cloud/team/automations/delete', { id: 'zz' }], ['POST', '/kybernos-cloud/connections/delete', { id: 'zz' }],
  ['POST', '/kybernos-miniapps/install', { id: 'zz-guard-live', html: '<b>x</b>' }], ['POST', '/kybernos-miniapps/uninstall', { id: 'zz-guard-live' }],
  // A-16 (21/10): the slash entries take the cookie like the rest. Their callers are two pages (same-origin fetch); the agent writes through the host tool `enregistrer_entree`, not through this route.
  // An empty body is answered 400 « no entry given » (nothing stored).
  ['POST', '/kybernos/slash/entries', {}],
  // L3-04 / L3-05 (recette 2026-10-25): the cloud writes that had stayed at the Origin alone. Each body is one the host answers on its own rule, before it asks the account's server for anything
  // (an empty text removes a section that is not there, an id or a token of the wrong shape, a team that is not the account's).
  ['POST', '/kybernos-cloud/instructions/save', { text: '' }],
  ['POST', '/kybernos-cloud/telegram/pairing/cancel', { id: 'zz-guard-live' }], ['POST', '/kybernos-cloud/whatsapp/pairing/cancel', { id: 'zz-guard-live' }],
  ['POST', '/kybernos-cloud/invitation/preview', { token: 'short' }],
  ['POST', '/kybernos-cloud/console/link', { workspace_id: '00000000-0000-4000-8000-000000000000' }],
  ['POST', '/kybernos-cloud/billing/checkout', {}], ['POST', '/kybernos-cloud/billing/portal', { workspace_id: '00000000-0000-4000-8000-000000000000' }],
  // L3-06 / L3-19: the plugin's writes that change what the agent follows or can do, and the ones that spend the owner's model or key. Bodies the handler refuses at once.
  ['POST', '/kybernos/workspace-instructions', { workspaceId: 'zz-guard-live', text: '' }], ['POST', '/kybernos/tools/apply', { family: 'zz-guard-live' }],
  ['POST', '/kybernos/workspace-skills', {}], ['POST', '/kybernos/workspace-connectors', {}], ['POST', '/kybernos/domain/skill', {}],
  ['POST', '/kybernos/tts/config', { patch: {} }], ['POST', '/kybernos/onboarding', { action: 'zz-guard-live' }], ['POST', '/kybernos/art-progress', { action: 'read' }],
  ['POST', '/kybernos/project-data', { sessionIds: [] }], ['POST', '/kybernos/image/generate', {}], ['POST', '/kybernos/i18n-translate', {}],
  ['POST', '/kybernos/i18n-job', { op: 'zz-guard-live' }], ['POST', '/kybernos/starters-suggest', {}], ['POST', '/kybernos/yml-proposer', { texte: 'a' }],
  ['POST', '/kybernos/models/audio/speak', {}],
  // The other POSTs that only pages drive (second batch of the day): an agent's request for approval (an unknown task is answered 400), a recording, a language of the interface (an id that is not
  // a language), a language pack (an op that does not exist), the voice cache, a feedback and a rating (no vote, no note), and a Finder window on a file outside every workspace.
  ['POST', '/kybernos/gateway/approvals/decision', { taskId: 'zz-guard-live', decision: 'approuver' }], ['POST', '/kybernos/voice/save', {}],
  ['POST', '/kybernos/i18n-store', { remove: true, id: 'Not A Language' }], ['POST', '/kybernos/i18n-packs', { op: 'zz-guard-live' }], ['POST', '/kybernos/tts/cache-trim', {}],
  ['POST', '/kybernos/quality-feedback', {}], ['POST', '/kybernos/quality-rating', {}], ['POST', '/kybernos/art-reveal', { path: '/no/such/workspace/file.md' }],
]

// The writes of the same family whose handler would DO something on a real account or machine (a pairing link, an unlink, Kaby's computer, the Home computer, a call to the model): the
// local-program half only. The signed-in page's half of each is played by the unit tests (the throw-away server of packages/kybernos-cloud/test-write-guard.mjs) and, for the pairing, by the click below.
const REFUSAL_ONLY = [
  ['POST', '/kybernos-cloud/telegram/pairing', {}], ['POST', '/kybernos-cloud/whatsapp/pairing', {}],
  ['POST', '/kybernos-cloud/telegram/unlink', {}], ['POST', '/kybernos-cloud/whatsapp/unlink', {}],
  ['POST', '/kybernos-cloud/kyby/computer', { computer_id: null }],
  ['POST', '/kybernos-cloud/computer/open', {}], ['POST', '/kybernos-cloud/computer/resume', {}], ['POST', '/kybernos-cloud/computer/suspend', {}],
  ['POST', '/kybernos/salary-detect', {}], ['POST', '/kybernos/model/auto', {}],
]

// The four spending routes the call worker (kybernos-call, a program with no cookie) also uses: they take the signed session or the worker's one-run secret, never an Origin alone.
const CALL_SIDE = [['POST', '/kybernos/voice/transcribe'], ['POST', '/kybernos/models/audio/listen'], ['POST', '/kybernos/models/audio/probe'], ['POST', '/kybernos/tts/speak']]

/** A read from this script, as JSON (the reads need no session; the cookie is sent anyway). */
const readJson = (path) => new Promise((resolve) => {
  http.get({ host, port: Number(port), path, headers: { host: HOST, cookie: session.nom + '=' + session.valeur } }, (res) => {
    let text = ''
    res.on('data', (c) => { text += c })
    res.on('end', () => { try { resolve(JSON.parse(text)) } catch (e) { resolve(null) } })
  }).on('error', () => resolve(null))
})
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const live = await openLivePage({ width: 1500, height: 950 }).catch((e) => { console.error('○ inconclusive: ' + e.message); process.exit(3) })
const { page } = live
/** The same request, from inside the signed-in page: the browser adds the Origin and the session cookie, as for the plugin's own pages. */
const fromPage = async (method, path, body) => {
  const init = { method, headers: { 'content-type': 'application/json' }, ...(body === undefined || method === 'DELETE' ? {} : { body: JSON.stringify(body) }) }
  const r = await page.evalJs('fetch(' + JSON.stringify(path) + ', ' + JSON.stringify(init) + ').then((r) => r.status, () => 0)', 30000)
  return r.err !== undefined ? 0 : r.val
}

const ev = async (js) => { const r = await page.evalJs(js, 10000); return r.err ? { __err: r.err } : r.val }
// What the browser got back for the page's own requests: the guard must not have refused one (a 401 or 403 here is a page that stopped working).
const answered = []
await page.send('Network.enable', {})
page.on('Network.responseReceived', (p) => { if (p.response && /\/(kybernos-auto|kybernos-memory|kybernos-computers|kybernos-cloud)\//.test(p.response.url)) answered.push({ url: new URL(p.response.url).pathname, status: p.response.status }) })
// The headers Chrome really puts on the wire for the page's own requests (CDP's ExtraInfo carries them, cookies included).
const wire = new Map()
const urlOf = new Map()
page.on('Network.requestWillBeSent', (p) => { if (p.request) urlOf.set(p.requestId, p.request.url) })
page.on('Network.requestWillBeSentExtraInfo', (p) => { wire.set(p.requestId, p.headers || {}) })
const wireHeaders = (path, method) => {
  for (const [id, url] of [...urlOf.entries()].reverse()) {
    if (new URL(url).pathname === path && wire.has(id)) {
      const h = {}
      for (const [k, v] of Object.entries(wire.get(id))) h[k.toLowerCase()] = v
      return method === undefined || h[':method'] === undefined || h[':method'] === method ? h : null
    }
  }
  return null
}
const lastStatus = (path) => { const hits = answered.filter((a) => a.url === path); return hits.length === 0 ? null : hits[hits.length - 1].status }
const q = (x) => JSON.stringify(x)
const shot = async (name) => { if (shotsDir !== null) await page.shot(join(shotsDir, name + '.png')).catch(() => {}) }
const gotoNav = async (label) => {
  await waitFor(page, `[...document.querySelectorAll('[class*="navCell"]')].some(e => e.textContent.trim() === ${q(label)})`, 12000)
  await ev(`(() => { const c = [...document.querySelectorAll('[class*="navCell"]')].find(e => e.textContent.trim() === ${q(label)}); if (c) { c.scrollIntoView({ block: 'center' }); c.click() } })()`)
  await sleep(1500)
}
/** A real click on the visible button with exactly this text (inside `within`, a selector, when given). */
const clickButton = (text, within) => ev(`(() => { const root = ${within ? 'document.querySelector(' + q(within) + ')' : 'document'}; if (!root) return false; const b = [...root.querySelectorAll('button')].find(x => x.textContent.trim() === ${q(text)} && x.getBoundingClientRect().width > 0); if (!b) return false; b.click(); return true })()`)
/** Types into a React input the way a person does: through the native setter, then an input event. */
const typeInto = (selector, value) => ev(`(() => { const i = document.querySelector(${q(selector)}); if (!i) return false; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, ${q(value)}); i.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)

try {
  console.log('every covered write: refused to a local program, answered to the page')
  const origin = 'http://' + HOST
  const cookie = session.nom + '=' + session.valeur
  for (const [method, path, body] of GUARDED) {
    const a = await ask(method, path, {}, body)
    const b = await ask(method, path, { origin: 'http://evil.example', cookie }, body)
    const c = await ask(method, path, { origin }, body)
    check(method + ' ' + path + ': no header 403, foreign Origin 403, no cookie 401', a === 403 && b === 403 && c === 401, [a, b, c])
    const p = await fromPage(method, path, body)
    check(method + ' ' + path + ': the signed-in page is answered (' + p + ')', p !== 401 && p !== 403 && p > 0 && p < 500, p)
  }
  for (const [method, path, body] of REFUSAL_ONLY) {
    const a = await ask(method, path, {}, body)
    const b = await ask(method, path, { origin: 'http://evil.example', cookie }, body)
    const c = await ask(method, path, { origin }, body)
    check(method + ' ' + path + ': no header 403, foreign Origin 403, no cookie 401 (nothing is sent for the page: it would act)', a === 403 && b === 403 && c === 401, [a, b, c])
  }

  console.log('what the browser itself puts on the wire (the free-models gateway keys on it)')
  await fromPage('GET', '/kybernos-auto/state')
  await fromPage('POST', '/kybernos-auto/session', { sessionId: '', on: true })
  await sleep(500)
  const got = wireHeaders('/kybernos-auto/state')
  check('a same-origin GET from the page carries Sec-Fetch-Site: same-origin and no Origin', got !== null && got['sec-fetch-site'] === 'same-origin' && got.origin === undefined, got && { site: got['sec-fetch-site'], origin: got.origin })
  const post = wireHeaders('/kybernos-auto/session')
  check('a same-origin POST from the page carries the right Origin and DSH\'s session cookie', post !== null && post.origin === origin && /(^|;\s*)dsh-auth-/.test(post.cookie || ''), post && { origin: post.origin, cookie: post.cookie ? '(present)' : '(absent)' })

  console.log('left open on purpose, still answered to the caller that has no browser')
  const router = await ask('POST', '/kybernos-auto/router', {}, { demande: 'fix the pagination bug', sonde: false })
  check('/kybernos-auto/router: the Auto CLI sends no header and is answered (' + router + ')', router === 200, router)
  const report = await ask('POST', '/kybernos-auto/report', {}, { modele: 'zz/guard-live', erreur: false, latenceMs: 5 })
  check('/kybernos-auto/report: the Auto CLI sends no header and is answered (' + report + ')', report === 200, report)
  check('/kybernos-auto/router: a foreign Origin is still refused', await ask('POST', '/kybernos-auto/router', { origin: 'http://evil.example' }, { demande: 'x' }) === 403)
  // The call side (recette L3-03): kybernos-call's worker posts to these four with a one-run secret the host gave it, a page with the cookie; an Origin alone is what a local program sends, and is refused
  // (docs/dev/route-origin-rule.md). The secret itself is played by the unit tests and the call bundle's own checks: here nothing started a worker. An empty body is answered by the handler's own rule (nothing is spent).
  for (const [method, path] of CALL_SIDE) {
    const open = await ask(method, path, { origin }, {})
    const bare = await ask(method, path, {}, {})
    const foreign = await ask(method, path, { origin: 'http://evil.example' }, {})
    const wrong = await ask(method, path, { origin, 'x-kybernos-call-token': 'f'.repeat(64) }, {})
    const signed = await ask(method, path, { origin, cookie: session.nom + '=' + session.valeur }, {})
    check(method + ' ' + path + ': the Origin alone (' + open + ') and a wrong worker secret (' + wrong + ') are refused 401, no header or a foreign Origin 403, the signed session is answered (' + signed + ')', open === 401 && wrong === 401 && bare === 403 && foreign === 403 && signed !== 401 && signed !== 403 && signed > 0 && signed < 500, [open, wrong, bare, foreign, signed])
  }
  check('/kybernos-cloud/computer/claimed: the cloud computer image\'s claimer is still answered with the Origin alone, and refused with none', await ask('POST', '/kybernos-cloud/computer/claimed', { origin }, {}) === 200 && await ask('POST', '/kybernos-cloud/computer/claimed', {}, {}) === 403)

  console.log('the free-models gateway refuses a browser page of another site, nothing sent upstream')
  for (const [method, path, body] of [['POST', '/free-llms/v1/chat/completions', { model: 'x-free', messages: [] }], ['GET', '/free-llms/v1/models'], ['GET', '/free-llms/status'], ['GET', '/free-llms/health']]) {
    const foreign = await ask(method, path, { origin: 'http://evil.example' }, body)
    const cross = await ask(method, path, { 'sec-fetch-site': 'cross-site' }, body)
    const sameSite = await ask(method, path, { 'sec-fetch-site': 'same-site' }, body)
    check(method + ' ' + path + ': a foreign Origin, Sec-Fetch-Site cross-site and same-site are all 403', foreign === 403 && cross === 403 && sameSite === 403, [foreign, cross, sameSite])
  }

  console.log('the pages\' own writes, clicked in the real GUI (the browser adds the Origin and the cookie itself)')
  await waitFor(page, `document.readyState === 'complete'`, 15000)
  await sleep(2000)
  if (await openSettings(page, { minCells: 0 }) !== true) check('the Settings dialog opens', false)
  else {
    // Auto Routing: choose « Free models » (POST /kybernos-auto/settings from the page's own click), then put the scope back.
    await gotoNav('Auto Routing')
    const autoBefore = await readJson('/kybernos-auto/state')
    await waitFor(page, `!!document.querySelector('[data-kb="auto-scope-free"]')`, 10000)
    check('Auto Routing: the « Free models » choice is there and is clicked', await ev(`(() => { const b = document.querySelector('[data-kb="auto-scope-free"]'); if (!b) return false; b.click(); return true })()`) === true)
    await sleep(1200)
    const auto = await readJson('/kybernos-auto/state')
    check('Auto Routing: the browser\'s own POST to /kybernos-auto/settings was answered 200', lastStatus('/kybernos-auto/settings') === 200, lastStatus('/kybernos-auto/settings'))
    check('Auto Routing: the host stored the scope the page sent', auto !== null && auto.scope === 'free', auto && auto.scope)
    await shot('write-guard-auto-routing')
    await fromPage('POST', '/kybernos-auto/settings', { autoScope: (autoBefore && autoBefore.scope) || 'all' })

    // Memory & Lessons > Customize: the Lessons system context switch (POST /kybernos-memory/settings/set), No then Yes.
    await gotoNav('Memory & Lessons')
    await waitFor(page, `!!document.querySelector('[data-act=customize]')`, 10000)
    await ev(`document.querySelector('[data-act=customize]').click()`)
    await waitFor(page, `document.querySelectorAll('.kbmem-srow').length > 5`, 10000)
    const lessonsRow = await ev(`(() => { const rows = [...document.querySelectorAll('.kbmem-srow')]; const i = rows.findIndex(r => r.textContent.startsWith('Lessons system context')); return i < 0 ? -1 : i })()`)
    check('Memory & Lessons: the "Lessons system context" row is on the Customize page', typeof lessonsRow === 'number' && lessonsRow >= 0, lessonsRow)
    const press = (label) => ev(`(() => { const r = [...document.querySelectorAll('.kbmem-srow')][${Number(lessonsRow)}]; const b = r && [...r.querySelectorAll('button')].find(x => x.textContent.trim() === ${q(label)}); if (!b) return false; b.click(); return true })()`)
    check('Memory & Lessons: clicking No is sent to the host', await press('No') === true)
    await sleep(1200)
    check('Memory & Lessons: the browser\'s own POST to /kybernos-memory/settings/set was answered 200', lastStatus('/kybernos-memory/settings/set') === 200, lastStatus('/kybernos-memory/settings/set'))
    const off = await readJson('/kybernos-memory/settings')
    check('Memory & Lessons: the host stored context = false', off !== null && off.settings && off.settings.context === false, off)
    await shot('write-guard-memory-options')
    check('Memory & Lessons: clicking Yes is sent to the host', await press('Yes') === true)
    await sleep(1200)
    const on = await readJson('/kybernos-memory/settings')
    check('Memory & Lessons: the host stored context = true again', on !== null && on.settings && on.settings.context === true, on)

    // Code sandbox (E2B): a key that is not an E2B key (POST /kybernos-computers/key/set answers cle_invalide; nothing is stored).
    await gotoNav('Code sandbox (E2B)')
    check('Code sandbox (E2B): the key field is there', await typeInto('input[type=password][placeholder="Paste your E2B key"]', 'not-an-e2b-key') === true)
    await sleep(300)
    check('Code sandbox (E2B): "Save" is clicked', await clickButton('Save') === true)
    await sleep(1500)
    check('Code sandbox (E2B): the browser\'s own POST to /kybernos-computers/key/set was answered 200 (the route ran, and said no on its own rule)', lastStatus('/kybernos-computers/key/set') === 200, lastStatus('/kybernos-computers/key/set'))
    const status = await readJson('/kybernos-computers/status')
    check('Code sandbox (E2B): the host refused the key on its own rule (keyPresent stays false), not the guard\'s', status !== null && status.keyPresent === false, status)
    await shot('write-guard-cloud-computers')

    // L3-04: the Account page's custom instructions (the « Kybernos » section of Settings), typed and saved with real clicks. The page's POST to /kybernos-cloud/instructions/save carries the
    // Origin and DSH's session cookie by itself, and the host writes the marked section of THIS instance's AGENTS.md (what every agent reads); the same text sent by a bare program was refused above.
    const openKey = (key) => ev(`(() => { const c = [...document.querySelectorAll('[class*="navCell"]')].find((e) => { const n = Object.keys(e).find((k) => k.indexOf('__reactFiber$') === 0); return n !== undefined && e[n].key === ${q(key)} }); if (!c) return false; c.scrollIntoView({ block: 'center' }); c.click(); return true })()`)
    const setInstructions = (value) => ev(`(() => { const t = document.querySelector('[data-kb="ky-instr-field"]'); if (!t) return false; Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(t, ${q(value)}); t.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
    const saveInstructions = async () => {
      await waitFor(page, `(() => { const b = document.querySelector('[data-kb="ky-instr-save"]'); return !!b && !b.disabled })()`, 6000)
      return ev(`(() => { const b = document.querySelector('[data-kb="ky-instr-save"]'); if (!b || b.disabled) return false; b.click(); return true })()`)
    }
    check('Account: the Kybernos section of Settings opens', await openKey('kybernos-local') === true)
    await waitFor(page, `(() => { const n = document.querySelector('[data-kb="ky-instr-note"]'); return !!document.querySelector('[data-kb="ky-instr-field"]') && !!n && !/Loading/.test(n.innerText) })()`, 12000)
    const agentsFile = join(process.env.DSH_HOME || '', 'AGENTS.md')
    const LINE = 'Answer in short sentences (write-guard live check).'
    check('Account: the instructions field takes the text and offers Save', await setInstructions(LINE) === true && await ev(`document.querySelector('[data-kb="ky-instr-save"]').disabled`) === false)
    check('Account: Save is clicked', await saveInstructions() === true)
    await waitFor(page, `document.querySelector('[data-kb="ky-instr-saved"]') !== null`, 8000)
    check('Account: the page says Saved', await ev(`document.querySelector('[data-kb="ky-instr-saved"]') !== null`) === true)
    check('Account: the browser\'s own POST to /kybernos-cloud/instructions/save was answered 200', lastStatus('/kybernos-cloud/instructions/save') === 200, lastStatus('/kybernos-cloud/instructions/save'))
    check('Account: the host wrote the marked section of AGENTS.md', existsSync(agentsFile) && readFileSync(agentsFile, 'utf8').includes(LINE))
    await shot('write-guard-account-instructions')
    check('Account: the text is emptied and saved again (the sandbox\'s AGENTS.md is put back)', await setInstructions('') === true && await saveInstructions() === true)
    await sleep(1500)
    check('Account: the section is gone from AGENTS.md', !existsSync(agentsFile) || !readFileSync(agentsFile, 'utf8').includes(LINE))
  }
} finally {
  await live.close()
}

console.log('\n' + (fail === 0 ? '✓ all ' + pass + ' checks passed' : '✗ ' + fail + ' failed, ' + pass + ' passed'))
process.exit(fail === 0 ? 0 : 1)

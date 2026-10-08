#!/usr/bin/env node
// What a user sees of the Team surfaces, on the REAL GUI, read-only.
//
//   node scripts/check-team-live.mjs [--shots <dir>] [--console-url <url>] [--console-file <path>] [--capture-labels]
//
// It talks to your real `dsh web` (127.0.0.1:3080, KB_HOST to change it) and to the hosted Team settings console. It
// changes nothing: it opens the account menu, opens « Teams settings », reads the iframe, then loads the console page
// in its own throw-away Chrome and reads each of its pages. No setting, no pin, no language, no key is written, and DSH
// is not restarted. Never named test-*.mjs: CI has no `dsh web` (see docs/dev/live-testing.md).
//
// What it checks (✓ / ✗ are real defects; the rest is printed as KNOWN GAPS / OBSERVATIONS, which never fail):
//   menu      the account menu has « Teams settings », which opens the console in an iframe with the gateway and the
//             theme in its URL and no key in it; an outside caller (no Origin, or a foreign one) cannot read the key
//   console   every page of the console opens without a script error, shows no `undefined` / `NaN`, and has no table
//             wider than its column (the Members table is 101 px too wide today: this stays ✗ until it is fixed)
//   labels    every label recorded in scripts/team-console-labels.json is still on its page (nothing silently lost
//             when the console is reworked); removals the owner approved go in `allowRemoved`
//
//   bridge    with --console-file <path to workspace-console.html>: the console you are editing is served locally (instead of the
//             hosted one), read page by page, then loaded WITH a key against a stand-in gateway (scripts/lib-fake-team-gateway.mjs)
//             to prove its data bridge still turns the services' answers into the right screens
//
// Exit code 0 (all ✓), 1 (a ✗), 3 (inconclusive: no Chrome, no GUI, console unreachable, before any measure).
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:http'
import { openLivePage, waitFor } from './live-page.mjs'
import { startFakeTeamGateway } from './lib-fake-team-gateway.mjs'
import { startRelayHost, OWNER_ID, SECOND_TEAM_ID, THIRD_TEAM_ID } from './lib-fake-relay-host.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const LABELS_FILE = join(HERE, 'team-console-labels.json')
const args = process.argv.slice(2)
const flag = (name) => args.indexOf(name) >= 0
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null }
const SHOTS = opt('--shots')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let failures = 0
const gaps = []
const observations = []
const pass = (name) => console.log('  ✓ ' + name)
const fail = (name, detail) => { failures += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : '  — ' + detail)) }
const check = (name, ok, detail) => (ok === true ? pass(name) : fail(name, detail))
const inconclusive = (why) => { console.log('\nInconclusive: ' + why); process.exit(3) }
const shot = async (page, name) => {
  if (SHOTS === null) return
  try { mkdirSync(SHOTS, { recursive: true }); await page.shot(join(SHOTS, name + '.png')) } catch (e) { /* a missing screenshot never fails a check */ }
}

// One counting rule, used on the real console and on the mockups: visible form fields plus the OUTERMOST visible element
// that shows a pointer cursor and holds no visible field (a segment, a tab, a card). Runs in the page.
const COUNT_FN = `function __kbCount(root) {
  const vis = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 3 && r.height > 3 && cs.visibility !== 'hidden' && cs.display !== 'none' }
  let n = 0
  for (const e of root.querySelectorAll('*')) {
    if (!vis(e)) continue
    const tag = e.tagName
    if (tag === 'SELECT' || tag === 'TEXTAREA' || (tag === 'INPUT' && e.type !== 'hidden')) { n++; continue }
    if (getComputedStyle(e).cursor !== 'pointer') continue
    const p = e.parentElement
    if (p && p !== root && getComputedStyle(p).cursor === 'pointer') continue
    if (Array.from(e.querySelectorAll('input,select,textarea')).some(vis)) continue
    n++
  }
  return n
}`

// The static texts of one console page: headings, button / tab / column / field labels, helper lines. No digits (a
// number is data, and data changes between the demo and a real team; an address or a possessive (« nina's usage ») is
// a member's name), 2–70 characters, lower-cased. It covers headings, buttons, tabs, columns, field labels and helper
// lines, not every sentence: a text outside those is not protected by this baseline.
const LABELS_FN = `function __kbLabels(root) {
  const out = new Set()
  const norm = (t) => String(t || '').replace(/\\s+/g, ' ').trim()
  const take = (t) => { t = norm(t); if (t.length >= 2 && t.length <= 70 && !/\\d/.test(t) && t.indexOf('@') < 0 && !/'s /.test(t)) out.add(t.toLowerCase()) }
  root.querySelectorAll('h1,h2,h3,h4,label,button,th,summary,legend,[role=tab],.eyebrow').forEach((e) => take(e.innerText || e.textContent))
  root.querySelectorAll('input[placeholder],textarea[placeholder]').forEach((e) => take(e.getAttribute('placeholder')))
  root.querySelectorAll('.muted,.small').forEach((e) => { if (e.children.length === 0) take(e.textContent) })
  return Array.from(out)
}`

// Labels that live in a dialog or a side panel still count as reachable: for a page, open each one (a click that only shows
// it), read it, close it. [opener, scope, closer]; a dialog the console does not have (an older one) is simply skipped.
const DIALOGS = {
  plan: [['#toCompare', '#planModal', '#planClose']],
  members: [['#t-members tbody tr:nth-child(2) [data-open]', '#drBody', '#drClose'], ['#mfToggle', '#mFilters', '#mfToggle']], // the 2nd row: the owner's has no Deactivate
  usage: [['#uFilterToggle', '#uFilters', '#uFilterToggle']],
}
// Segments that swap what the page shows (a click that only changes the view): each button is pressed in turn.
const SWITCHES = {
  usage: ['#uBreak [data-by]'],
}

const live = await openLivePage({ width: 1500, height: 950 }).catch((e) => inconclusive(e.message))
const { page } = live
let exitNow = null
let fileServer = null
try {
  await page.send('Runtime.enable', {})
  await sleep(2500)

  // ── 1. The account menu and the iframe ──────────────────────────────────────
  console.log('menu: « Teams settings » in the account menu')
  const card = await page.evalJs(`(() => { const c = document.querySelector('[data-kb="workspace-card"] .kbfp-cardmain'); if (!c) return null; const r = c.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)
  if (!card.val) {
    fail('the workspace card is in the sidebar footer', 'not found: an account that is not connected shows another footer, and the check cannot go on')
  } else {
    const click = async (pt) => { for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type, x: pt.x, y: pt.y, button: 'left', clickCount: 1 }) }
    await click(card.val)
    await sleep(700)
    const entry = await page.evalJs(`(() => { const b = document.querySelector('[data-kb="menu-space-settings"]'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)
    check('the menu has the « Teams settings » entry', entry.val !== null)
    if (entry.val) {
      await click(entry.val)
      const src = await waitFor(page, `(() => { const f = document.querySelector('.kbwsif iframe'); return f ? f.src : '' })()`, 20000)
      check('it opens the console in an iframe', typeof src === 'string' && src.length > 0, 'no iframe after 20 s (the page says why when the console is unreachable)')
      if (typeof src === 'string' && src.length > 0) {
        let u = null
        try { u = new URL(src) } catch (e) { u = null }
        check('the iframe URL is readable', u !== null)
        if (u !== null) {
          check('it carries the gateway', (u.searchParams.get('gw') || '').startsWith('https://'))
          const dark = await page.evalJs(`(() => { const v = document.body.getAttribute('data-ds-dark-theme'); return v !== null && v !== 'false' })()`)
          check('it follows DSH\'s theme', u.searchParams.get('theme') === (dark.val === true ? 'dark' : 'light'), 'theme=' + u.searchParams.get('theme'))
          check('no key is in the URL', !u.searchParams.has('key') && !/sk-admin/i.test(src))
          const size = await page.evalJs(`(() => { const r = document.querySelector('.kbwsif iframe').getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) } })()`)
          check('the iframe fills the content area', size.val && size.val.w >= 600 && size.val.h >= 400, JSON.stringify(size.val))
          await sleep(3500)
          await shot(page, 'team-settings-in-dsh')
          // The console never holds a token: it asks this page, and this page calls the host's relay. The page's own resource
          // timing shows those calls, whatever the console (another origin) shows.
          const relayed = await page.evalJs(`performance.getEntriesByType('resource').map((e) => e.name).filter((n) => n.indexOf('/kybernos-cloud/relay') >= 0).map((n) => new URL(n).searchParams.get('p'))`)
          const calls = Array.isArray(relayed.val) ? relayed.val : []
          const { RELAY_RULES } = await import('../packages/kybernos-cloud/index.js')
          check('the console reads through the host relay (it asked this page, the page called /kybernos-cloud/relay)', calls.length >= 3, calls.length + ' relay request(s): an old console, or a host that was not restarted after the relay was merged')
          check('every path it asked for is one the allowlist names', calls.length > 0 && calls.every((c) => typeof c === 'string' && RELAY_RULES.some((r) => r.re.test(c.split('?')[0]))), calls.filter((c) => !RELAY_RULES.some((r) => r.re.test(String(c).split('?')[0]))))
          observations.push('Relay calls seen from the page after the console loaded: ' + Array.from(new Set(calls.map((c) => String(c).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<workspace>')))).join(' · ') + '.')
          if (opt('--console-url') === null) args.push('--console-url', src)
        }
      }
    }
    // Close the menu and the panel the way a user would not need to: the next step navigates away anyway.
  }

  console.log('menu: the admin key stays private')
  const keyRoute = await page.evalJs(`fetch('/kybernos/ws-console-key', { credentials: 'same-origin' }).then(async (r) => { let j = null; try { j = await r.json() } catch (e) {} return { status: r.status, hasKey: !!(j && typeof j.key === 'string' && j.key.length > 0) } }).catch(() => null)`)
  check('the page can ask for the key (same-origin)', keyRoute.val !== null && keyRoute.val.status === 200, JSON.stringify(keyRoute.val))
  if (keyRoute.val !== null && keyRoute.val.hasKey === false) observations.push('The host has NO admin key (settings.json › wsAdminKey): the console shows DEMO data with a « Connect key » banner. Real data needs a key today.')
  const host = process.env.KB_HOST || '127.0.0.1:3080'
  for (const [label, headers] of [['no Origin', {}], ['a foreign Origin', { origin: 'https://evil.example' }]]) {
    let status = 0
    try { status = (await fetch('http://' + host + '/kybernos/ws-console-key', { headers })).status } catch (e) { status = -1 }
    check('an outside caller with ' + label + ' cannot read the key (403)', status === 403, 'status ' + status)
  }

  // ── 2. The console itself, page by page ─────────────────────────────────────
  console.log('console: every page, at the iframe\'s width')
  // --console-file: serve the console you are editing, on a free local port, instead of reading the hosted one.
  let consoleBase = null
  if (opt('--console-file') !== null) {
    const html = readFileSync(opt('--console-file'), 'utf8')
    fileServer = createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(html) })
    await new Promise((r) => fileServer.listen(0, '127.0.0.1', r))
    consoleBase = 'http://127.0.0.1:' + fileServer.address().port + '/workspace-console.html'
    observations.push('The console under test is the local file ' + opt('--console-file') + ', not the hosted one.')
  }
  const consoleUrl = consoleBase !== null ? consoleBase + '?gw=' + encodeURIComponent('https://gateway.invalid') + '&theme=dark' : opt('--console-url')
  if (consoleUrl === null) inconclusive('no console URL (the menu step found no iframe); pass --console-url or --console-file')
  const errors = []
  page.on('Runtime.exceptionThrown', (e) => errors.push((e.exceptionDetails && e.exceptionDetails.exception && e.exceptionDetails.exception.description) || 'exception'))
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1220, height: 863, deviceScaleFactor: 1, mobile: false })
  const target = new URL(consoleUrl); target.searchParams.delete('key')
  await page.send('Page.navigate', { url: target.toString() })
  const ready = await waitFor(page, `document.querySelectorAll('[data-nav]').length >= 5`, 25000)
  if (!ready) inconclusive('the console did not render its navigation (unreachable, or its address changed)')
  const ids = (await page.evalJs(`Array.from(document.querySelectorAll('[data-nav]')).map((b) => b.getAttribute('data-nav'))`)).val
  check('the console lists its pages', Array.isArray(ids) && ids.length >= 5, JSON.stringify(ids))
  const banner = await page.evalJs(`(() => { const b = document.getElementById('kbKeyBanner'); return b ? b.innerText.replace(/\\s+/g, ' ').trim() : null })()`)
  if (banner.val !== null) observations.push('Console banner: « ' + banner.val + ' » (demo data on screen).')

  const baseline = existsSync(LABELS_FILE) ? JSON.parse(readFileSync(LABELS_FILE, 'utf8')) : null
  const captured = {}
  const rows = []
  for (const id of ids) {
    await page.evalJs(`document.querySelector('[data-nav="${id}"]').click()`)
    await sleep(800)
    const before = errors.length
    const m = await page.evalJs(`${COUNT_FN}; ${LABELS_FN}; (() => {
      const root = document.getElementById('t-${id}')
      if (!root) return { missing: true }
      const bad = []
      for (const e of [root, ...root.querySelectorAll('*')]) { if (e.scrollWidth > e.clientWidth + 2 && getComputedStyle(e).overflowX !== 'visible' && e.clientWidth > 0) bad.push(e.scrollWidth - e.clientWidth) }
      const text = root.innerText || ''
      return { controls: __kbCount(root), height: Math.round(root.getBoundingClientRect().height), overflow: bad.length ? Math.max.apply(null, bad) : 0, badText: (text.match(/\\bundefined\\b|\\bNaN\\b|\\[object Object\\]/g) || []).length, labels: __kbLabels(root) }
    })()`)
    const r = m.val
    if (r === null || r.missing) { fail('page ' + id + ' exists', 'no #t-' + id); continue }
    // Inner tabs (Members, Providers…): open each, collect their labels too. They only switch the view.
    const labels = new Set(r.labels)
    let extraControls = r.controls
    const tabs = (await page.evalJs(`Array.from(document.querySelectorAll('#t-${id} .subtabs button')).map((b, i) => i)`)).val || []
    for (const i of tabs) {
      await page.evalJs(`document.querySelectorAll('#t-${id} .subtabs button')[${i}].click()`)
      await sleep(350)
      const t = await page.evalJs(`${COUNT_FN}; ${LABELS_FN}; (() => { const root = document.getElementById('t-${id}'); const bad = []; for (const e of [root, ...root.querySelectorAll('*')]) { if (e.scrollWidth > e.clientWidth + 2 && getComputedStyle(e).overflowX !== 'visible' && e.clientWidth > 0) bad.push(e.scrollWidth - e.clientWidth) } return { n: __kbCount(root), l: __kbLabels(root), over: bad.length ? Math.max.apply(null, bad) : 0, name: document.querySelectorAll('#t-${id} .subtabs button')[${i}].innerText.replace(/\\s+/g, ' ').trim() } })()`)
      if (t.val) {
        t.val.l.forEach((x) => labels.add(x)); extraControls = Math.max(extraControls, t.val.n)
        check('page ' + id + ', tab « ' + t.val.name + ' »: nothing wider than its column', t.val.over === 0, t.val.over + ' px hidden to the right')
      }
    }
    if (tabs.length > 0) await page.evalJs(`document.querySelectorAll('#t-${id} .subtabs button')[0].click()`)
    for (const [opener, scope, closer] of (DIALOGS[id] || [])) {
      const has = await page.evalJs(`!!document.querySelector(${JSON.stringify(opener)})`)
      if (!has.val) continue
      await page.evalJs(`document.querySelector(${JSON.stringify(opener)}).click()`)
      await sleep(400)
      const d = await page.evalJs(`${LABELS_FN}; (() => { const root = document.querySelector(${JSON.stringify(scope)}); return root ? __kbLabels(root) : null })()`)
      if (Array.isArray(d.val)) d.val.forEach((x) => labels.add(x))
      await page.evalJs(`(() => { const c = document.querySelector(${JSON.stringify(closer)}); if (c) c.click() })()`)
      await sleep(250)
    }
    for (const sel of (SWITCHES[id] || [])) {
      const n = (await page.evalJs(`document.querySelectorAll(${JSON.stringify(sel)}).length`)).val || 0
      for (let i = 0; i < n; i += 1) {
        await page.evalJs(`document.querySelectorAll(${JSON.stringify(sel)})[${i}].click()`)
        await sleep(300)
        const t = await page.evalJs(`${LABELS_FN}; __kbLabels(document.getElementById('t-${id}'))`)
        if (Array.isArray(t.val)) t.val.forEach((x) => labels.add(x))
      }
      if (n > 0) await page.evalJs(`document.querySelectorAll(${JSON.stringify(sel)})[0].click()`)
    }
    captured[id] = Array.from(labels).sort()
    check('page ' + id + ': no script error', errors.length === before, errors.slice(before, before + 1).join(' ').slice(0, 120))
    check('page ' + id + ': no « undefined » / « NaN » on screen', r.badText === 0, r.badText + ' occurrence(s)')
    check('page ' + id + ': nothing wider than its column', r.overflow === 0, r.overflow + ' px hidden to the right')
    rows.push({ id, controls: Math.max(r.controls, extraControls), height: r.height })
    if (SHOTS !== null && (id === 'members' || id === 'providers')) await shot(page, 'console-' + id)
  }

  const total = rows.reduce((t, x) => t + x.controls, 0)
  observations.push('Controls on screen, heaviest view of each page: ' + rows.map((x) => x.id + ' ' + x.controls).join(' · ') + ' — total ' + total + ' (one rule: visible fields plus outermost clickable elements).')
  observations.push('Scroll height, same pages: ' + rows.map((x) => x.id + ' ' + x.height).join(' · ') + ' px.')

  // ── 3. Labels: nothing silently lost ────────────────────────────────────────
  console.log('labels: what the console shows today must stay reachable')
  if (flag('--capture-labels')) {
    writeFileSync(LABELS_FILE, JSON.stringify({ about: 'Static labels of the Team settings console, per page (lower-case, no digits). Captured by scripts/check-team-live.mjs --capture-labels. A label may only leave this file with the owner\'s approval: list it in allowRemoved.', capturedFrom: target.origin + target.pathname, allowRemoved: [], pages: captured }, null, 1) + '\n')
    console.log('  baseline written: ' + LABELS_FILE)
  } else if (baseline === null) {
    gaps.push('No label baseline yet: run with --capture-labels once, on a console you trust, to freeze what must not be lost.')
  } else {
    const allow = new Set((baseline.allowRemoved || []).map((x) => String(x).toLowerCase()))
    const approvedPages = new Set(baseline.allowRemovedPages || [])
    let lost = 0
    for (const id of Object.keys(baseline.pages)) {
      const now = new Set(captured[id] || [])
      const missing = baseline.pages[id].filter((l) => !now.has(l) && !allow.has(l))
      if (!ids.includes(id)) {
        if (approvedPages.has(id)) { pass('page ' + id + ' was removed, with the owner\'s approval (allowRemovedPages)'); continue }
        fail('baseline page ' + id + ' still exists', 'the console no longer has it (list it in allowRemovedPages if the owner approved)'); lost += 1; continue
      }
      if (missing.length > 0) { lost += missing.length; fail('page ' + id + ': every recorded label is still there', missing.length + ' missing: « ' + missing.slice(0, 15).join(' », « ') + ' »' + (missing.length > 15 ? ' …' : '')) } else pass('page ' + id + ': all ' + baseline.pages[id].length + ' recorded labels are still there')
    }
    const added = ids.filter((id) => !(id in baseline.pages))
    if (added.length > 0) observations.push('Pages not in the baseline: ' + added.join(', ') + '.')
  }

  // ── 4. The data bridge, with a key, against a stand-in gateway ───────────────
  if (consoleBase !== null) {
    console.log('bridge: the console with a key, against a stand-in gateway')
    const gw = await startFakeTeamGateway()
    try {
      const before = errors.length
      const u = new URL(consoleBase); u.searchParams.set('gw', gw.url); u.searchParams.set('theme', 'dark'); u.searchParams.set('key', 'stand-in-key')
      await page.send('Page.navigate', { url: u.toString() })
      const ok = await waitFor(page, `document.querySelectorAll('[data-nav]').length >= 5 && document.querySelector('#t-plan') && !document.getElementById('kbKeyBanner')`, 20000)
      await sleep(1500)
      check('with a key the « connect key » banner is gone', ok !== null)
      const r = (await page.evalJs(`(() => {
        const q = (s) => document.querySelector(s), go = (id) => q('[data-nav=' + id + ']').click(), res = {}
        const txt = (s) => q(s).innerText.replace(/\\s+/g, ' ')
        go('plan'); res.team = txt('.idrow') + ' | ' + q('#tdId').textContent
        go('plan'); res.plan = txt('#curName') + ' | ' + txt('#balance')
        go('members'); res.members = Array.from(document.querySelectorAll('#memberBody tr')).map((x) => x.innerText.replace(/\\s+/g, ' '))
        const open = q('#memberBody tr:nth-child(2) [data-open]'); if (open) open.click(); res.panel = !q('#memDrawer').classList.contains('hidden') ? q('#drTitle').textContent : null
        q('#drClose').click()
        go('providers'); res.cards = Array.from(document.querySelectorAll('#provGrid .pcard')).map((x) => x.innerText.replace(/\\s+/g, ' ').trim())
        q('#pmTabs [data-pm=models]').click(); res.models = document.querySelectorAll('#mBody tr').length
        go('usage'); res.usage = txt('#t-usage')
        go('billing'); res.billing = txt('#invoiceBody') + ' | ' + txt('#pmText')
        return res })()`)).val
      check('the team page shows the team\'s own id, name and creation date', r && r.team.includes(gw.teamId) && r.team.includes('Acme Team') && r.team.includes('August 1, 2026'), r && r.team.slice(0, 160))
      check('the plan page reads the plan and the shared balance', r && r.plan.startsWith('Team') && r.plan.includes('$12.50'), r && r.plan)
      check('Members lists the two members and opens the side panel', r && r.members.length === 2 && r.members[0].includes('owner@acme.test') && r.panel === 'bea', r && JSON.stringify(r.members) + ' ' + r.panel)
      check('Providers shows Kybernos as one card, then the team\'s own provider', r && r.cards.length === 2 && /kybernos/.test(r.cards[0]) && /openrouter/.test(r.cards[1]), r && JSON.stringify(r.cards))
      check('the Models table lists the gateway\'s models and the team\'s own', r && r.models === 3, r && String(r.models))
      check('Usage totals the stand-in\'s usage as an amount', r && r.usage.includes('$1.60'), r && r.usage.slice(0, 120))
      check('Billing shows the Stripe invoice and the card', r && r.billing.includes('#IN-abc123456') && r.billing.includes('4242'), r && r.billing)
      check('no script error with live-shaped data', errors.length === before, errors.slice(before, before + 1).join(' ').slice(0, 160))
    } finally { await gw.close() }

    // ── 5. The console the way DSH runs it: inside a page, no key, answers through a relay ───────────
    console.log('relay: the console in a host page, no key anywhere')
    const host = await startRelayHost({ consoleHtml: readFileSync(opt('--console-file'), 'utf8') })
    try {
      const frame = (body) => `(async () => { const document = window.frames[0].document, frameWindow = window.frames[0]; ${body} })()`
      const before = errors.length
      await page.send('Page.navigate', { url: host.url + '/parent.html' })
      const live = await waitFor(page, frame(`return !!document.querySelector('#kbKeyBanner') && /Live data/.test(document.querySelector('#kbKeyBanner').innerText) && document.querySelectorAll('#navList [data-nav]').length >= 5`), 20000)
      await sleep(1500)
      check('the host announces its relay and the console says it shows live data (no « connect key »)', live !== null)
      const r = (await page.evalJs(frame(`
        const q = (s) => document.querySelector(s), go = (id) => q('[data-nav=' + id + ']').click(), res = {}
        const txt = (s) => q(s).innerText.replace(/\\s+/g, ' ')
        res.banner = txt('#kbKeyBanner')
        res.crumbs = txt('#crumbs')
        res.pageIds = Array.from(document.querySelectorAll('[data-nav]')).map((b) => b.getAttribute('data-nav'))
        go('plan')
        res.rule = txt('#ruleArea') + ' | ' + q('#ruleActions').children.length
        res.cols = Array.from(document.querySelectorAll('#t-plan .cols2 > .card')).map((c) => { const b = c.getBoundingClientRect(); return { x: Math.round(b.left), y: Math.round(b.top) } })
        res.planOrder = ['.idrow', '#t-plan > .card', '#t-plan .cols2'].map((sel) => Math.round(q(sel).getBoundingClientRect().top))
        const ib = q('#copyTeamId').getBoundingClientRect()
        res.idico = { label: q('#copyTeamId').getAttribute('aria-label'), w: Math.round(ib.width), h: Math.round(ib.height), text: q('#copyTeamId').textContent.trim() }
        let copied = null
        Object.defineProperty(frameWindow.navigator, 'clipboard', { value: { writeText: (t) => { copied = t; return Promise.resolve() } }, configurable: true })
        q('#copyTeamId').click(); await new Promise((r) => setTimeout(r, 300))
        res.copied = copied; res.toast = txt('#toast')
        q('#teamSel').click(); res.menuOpen = !q('#tsMenu').classList.contains('hidden')
        res.menuHead = txt('#tsMenu .tshead')
        res.menuRows = Array.from(document.querySelectorAll('#tsMenu .tsopt')).map((x) => x.innerText.replace(/\\s+/g, ' ').trim())
        q('#teamSel').click()
        res.switcher = txt('#tsName')
        go('plan'); res.team = txt('.idrow') + ' | ' + q('#tdId').textContent
        go('plan'); res.plan = txt('#curName') + ' | ' + txt('#balance')
        go('members'); res.members = Array.from(document.querySelectorAll('#memberBody tr')).map((x) => x.innerText.replace(/\\s+/g, ' '))
        go('providers'); res.cards = Array.from(document.querySelectorAll('#provGrid .pcard')).map((x) => x.innerText.replace(/\\s+/g, ' ').trim())
        q('#pmTabs [data-pm=models]').click(); res.models = document.querySelectorAll('#mBody tr').length
        go('usage'); res.usage = txt('#t-usage')
        go('billing'); res.billing = txt('#invoiceBody') + ' | ' + txt('#pmText')
        res.network = frameWindow.performance.getEntriesByType('resource').map((e) => e.name).filter((n) => /gateway\\.invalid/.test(n)).length
        return res`))).val
      check('the team page shows the workspace\'s id, name and creation date', r && r.team.includes('11111111-1111-4111-8111-111111111111') && r.team.includes('Acme Team') && r.team.includes('August 1, 2026'), r && r.team.slice(0, 160))
      check('the plan page reads the plan and the shared balance', r && r.plan.startsWith('Team') && r.plan.includes('$12.50'), r && r.plan)
      check('Members: two rows, the signed-in person named from /v1/me and marked as owner, the other as a short id (no invented name or email)', r && r.members.length === 2 && /Owner Person/.test(r.members[0]) && /Owner/.test(r.members[0]) && /Member bbbb/.test(r.members[1]) && !/bbbbbbbb-/.test(r.members[1]) && !/@/.test(r.members[1]), r && JSON.stringify(r.members))
      check('Providers: Kybernos as one card, then the team\'s own provider', r && r.cards.length === 2 && /kybernos/.test(r.cards[0]) && /openrouter/.test(r.cards[1]), r && JSON.stringify(r.cards))
      check('the Models table lists the service\'s models and the team\'s own', r && r.models === 3, r && String(r.models))
      check('Usage totals the amounts and names the members', r && r.usage.includes('$1.60') && /Owner Person/.test(r.usage), r && r.usage.slice(0, 160))
      check('Billing shows the Stripe invoice and the card', r && r.billing.includes('#IN-abc123456') && r.billing.includes('4242'), r && r.billing)
      check('the banner says what it is: live and read-only for now', r && /read-only/i.test(r.banner), r && r.banner)
      check('the crumbs name the real workspace, not the sample team', r && r.crumbs.startsWith('Acme Team'), r && r.crumbs)
      check('the auto-recharge card does not pass the mockup\'s sample rule off as the workspace\'s: it says it is not shown here yet, with no controls', r && /Not shown here yet/.test(r.rule) && !/IF balance/.test(r.rule) && /\| 0$/.test(r.rule), r && r.rule)
      check('there is no Team Settings page any more: Plan & Credits comes first', r && !r.pageIds.includes('team') && r.pageIds[0] === 'plan', r && r.pageIds)
      check('the Plan page: identity row, then the plan block, then credits and auto-recharge SIDE BY SIDE (the mockup\'s layout)', r && r.planOrder[0] < r.planOrder[1] && r.planOrder[1] < r.planOrder[2] && r.cols.length === 2 && r.cols[0].y === r.cols[1].y && r.cols[1].x > r.cols[0].x, r && JSON.stringify([r.planOrder, r.cols]))
      check('the workspace ID is a discreet circled « ID » (24 px at most), labelled for screen readers', r && r.idico.text === 'ID' && r.idico.w <= 24 && r.idico.h <= 24 && r.idico.label === 'Copy workspace ID', r && JSON.stringify(r.idico))
      check('clicking it copies the full workspace id and says « Workspace ID copied »', r && r.copied === '11111111-1111-4111-8111-111111111111' && /Workspace ID copied/.test(r.toast), r && JSON.stringify([r.copied, r.toast]))
      check('inside the app the console\'s workspace selector is live: its menu lists the account\'s workspaces (the current one ticked, with the role) and a « New team » row', r && r.menuOpen === true && /^switch workspace$/i.test(r.menuHead) && r.menuRows.length === 3 && /Acme Team.*Owner.*✓/.test(r.menuRows[0]) && /Beta Team.*Member/.test(r.menuRows[1]) && !/✓/.test(r.menuRows[1]) && /New team/.test(r.menuRows[2]), r && JSON.stringify(r.menuRows))
      check('no sample invitation is counted as pending', r && /· 0 pending ·/.test(r.team), r && r.team.slice(0, 200))
      check('the console called no gateway of its own (everything went through the relay)', r && r.network === 0, r && String(r.network))
      check('every path the console asked for is on the host route\'s allowlist', host.refused.length === 0, JSON.stringify(host.refused))
      const wanted = ['/v1/me', '/v1/workspaces', '/members', '/llm/budget', '/llm/usage', '/llm/models', '/llm/catalog', '/llm/billing', '/providers']
      check('and it asked for what each page needs', wanted.every((w) => host.asked.some((a) => a === w || a.endsWith(w))), JSON.stringify(wanted.filter((w) => !host.asked.some((a) => a === w || a.endsWith(w)))))
      const w = (await page.evalJs(frame(`
        const post = await frameWindow.__kbApi('POST', '/v1/teams/x/members', { user_ref: 'a@b.c' })
        const keys = await frameWindow.__kbApi('GET', '/v1/keys')
        return { post, keys }`))).val
      const askedBefore = host.asked.length
      check('a write is refused in the console, with a plain sentence, before it leaves the page', w && w.post.status === 405 && /read-only/i.test(String(w.post.json && w.post.json.error)), JSON.stringify(w && w.post))
      check('a route the console has no translation for is refused in the page too', w && w.keys.status === 404 && host.asked.length === askedBefore, JSON.stringify(w && w.keys))
      check('no script error through the relay', errors.length === before, errors.slice(before, before + 1).join(' ').slice(0, 160))

      // The app has another workspace active (`ws` in the iframe URL): the console opens on THAT one, so the two selectors agree.
      await page.send('Page.navigate', { url: host.url + '/parent.html?ws=' + SECOND_TEAM_ID })
      await waitFor(page, frame(`return !!document.querySelector('#kbKeyBanner') && /Live data/.test(document.querySelector('#kbKeyBanner').innerText) && document.querySelectorAll('#navList [data-nav]').length >= 5`), 20000)
      await sleep(1200)
      const w2 = (await page.evalJs(frame(`
        const q = (s) => document.querySelector(s)
        const txt = (s) => q(s).innerText.replace(/\\s+/g, ' ').trim()
        return { switcher: txt('#tsName'), identity: txt('.idrow'), id: q('#tdId').textContent }`))).val
      check('with `ws` the console opens on the workspace the app has active, not on the first one', w2 && w2.switcher === 'Beta Team' && w2.identity.includes('Beta Team') && w2.id === SECOND_TEAM_ID, w2 && JSON.stringify(w2))

      // The other direction: a choice made in the console is handed to the app, which makes it the active workspace, then the console reloads on it.
      const live2 = `return !!document.querySelector('#kbKeyBanner') && /Live data/.test(document.querySelector('#kbKeyBanner').innerText) && document.querySelectorAll('#navList [data-nav]').length >= 5`
      await page.send('Page.navigate', { url: host.url + '/parent.html' })
      await waitFor(page, frame(live2), 20000)
      await sleep(1200)
      const sw = (await page.evalJs(frame(`
        const q = (s) => document.querySelector(s), txt = (s) => q(s).innerText.replace(/\\s+/g, ' ').trim()
        const before = txt('#tsName')
        q('#teamSel').click(); document.querySelectorAll('#tsMenu [data-relay-team]')[1].click()
        await new Promise((r) => setTimeout(r, 2200))
        return { before, switcher: txt('#tsName'), identity: txt('.idrow'), id: q('#tdId').textContent, sub: txt('#tsSub') }`))).val
      check('picking another workspace in the console asks the app to make it the active one (once, by id)', host.switched.length === 1 && host.switched[0] === SECOND_TEAM_ID, JSON.stringify(host.switched))
      check('and the console reloads on it: header, identity row and workspace id', sw && sw.before === 'Acme Team' && sw.switcher === 'Beta Team' && sw.identity.includes('Beta Team') && sw.id === SECOND_TEAM_ID && sw.sub === 'Member', sw && JSON.stringify(sw))

      // « New team »: the name is asked in the console, the app creates it through the server, it becomes the active one.
      const nt = (await page.evalJs(frame(`
        const q = (s) => document.querySelector(s), txt = (s) => q(s).innerText.replace(/\\s+/g, ' ').trim()
        q('#teamSel').click(); q('#tsNew').click(); await new Promise((r) => setTimeout(r, 400))
        const asked = !q('#overlay').classList.contains('hidden') && !!q('#ntIn')
        q('#ntIn').value = 'Gamma Crew'; q('#ntGo').click()
        await new Promise((r) => setTimeout(r, 2800))
        return { asked, modalGone: q('#overlay').classList.contains('hidden'), switcher: txt('#tsName'), id: q('#tdId').textContent, toast: txt('#toast'), sub: txt('#tsSub') }`))).val
      check('New team asks for a name in the console, sends it to the app, and the console opens on the new team (owner)', nt && nt.asked === true && nt.modalGone === true && host.created.length === 1 && host.created[0] === 'Gamma Crew' && nt.switcher === 'Gamma Crew' && nt.id === THIRD_TEAM_ID && nt.sub === 'Owner', nt && JSON.stringify([nt, host.created]))
      check('no script error while switching and creating', errors.length === before, errors.slice(before, before + 1).join(' ').slice(0, 160))

      // The server refuses the creation (plan limit, permission): nothing is created here, the console stays where it was and says so.
      await page.send('Page.navigate', { url: host.url + '/parent.html?create=refused' })
      await waitFor(page, frame(live2), 20000)
      await sleep(1200)
      const nr = (await page.evalJs(frame(`
        const q = (s) => document.querySelector(s), txt = (s) => q(s).innerText.replace(/\\s+/g, ' ').trim()
        const before = txt('#tsName')
        q('#teamSel').click(); q('#tsNew').click(); await new Promise((r) => setTimeout(r, 400))
        q('#ntIn').value = 'Too Many'; q('#ntGo').click()
        await new Promise((r) => setTimeout(r, 2000))
        return { before, switcher: txt('#tsName'), toast: txt('#toast'), rows: document.querySelectorAll('#tsMenu .tsopt').length }`))).val
      check('a refused creation leaves the console on the same team and says the server did not allow it', nr && nr.switcher === nr.before && /did not allow/i.test(nr.toast), nr && JSON.stringify(nr))

      // Signed in, but the LLM service behind the relay is not configured: members and providers are live, nothing about credits is guessed.
      await page.send('Page.navigate', { url: host.url + '/parent.html?llm=down' })
      await waitFor(page, frame(`return !!document.querySelector('#kbKeyBanner') && /could not be loaded/.test(document.querySelector('#kbKeyBanner').innerText)`), 20000)
      await sleep(1200)
      const d = (await page.evalJs(frame(`
        const q = (s) => document.querySelector(s), go = (id) => q('[data-nav=' + id + ']').click(), res = {}
        const txt = (s) => q(s).innerText.replace(/\\s+/g, ' ').trim()
        res.banner = txt('#kbKeyBanner')
        go('plan'); res.plan = txt('#curName') + ' | ' + txt('#curMeta') + ' | ' + txt('#balance') + ' | side=' + txt('#sidePlan'); res.rule = txt('#ruleArea')
        go('usage'); res.usage = txt('#pUsed') + ' | ' + txt('#pBal')
        go('members'); res.members = document.querySelectorAll('#memberBody tr').length
        go('providers'); res.cards = document.querySelectorAll('#provGrid .pcard').length
        return res`))).val
      check('LLM service down: the banner says credits, usage and billing could not be loaded, and that members and providers are live', d && /Credits, usage and billing could not be loaded/.test(d.banner) && /live/.test(d.banner), d && d.banner)
      check('the plan is not guessed: a dash, « Not available right now », no balance of zero, no plan in the sidebar', d && d.plan === '— | Not available right now | — | side=', d && d.plan)
      check('LLM service down: the auto-recharge card says « Not available right now », not a sample rule', d && /Not available right now/.test(d.rule) && !/IF balance/.test(d.rule), d && d.rule)
      check('Usage shows dashes, not zero amounts', d && d.usage.startsWith('— |'), d && d.usage)
      check('members are still the real ones, and the team\'s own provider stays while the Kybernos card goes (its catalogue is the LLM service\'s)', d && d.members === 2 && d.cards === 1, d && JSON.stringify([d.members, d.cards]))

      // Not signed in: the host answers « not connected » to everything.
      await page.send('Page.navigate', { url: host.url + '/parent.html?offline=1' })
      const off = await waitFor(page, frame(`return !!document.querySelector('#kbKeyBanner') && /Sign in/.test(document.querySelector('#kbKeyBanner').innerText)`), 20000)
      check('not signed in: the console says to sign in, and shows no live data', off !== null)
    } finally { await host.close() }
  }
  await page.send('Emulation.clearDeviceMetricsOverride', {})
} catch (e) {
  console.log('\nThe check itself failed: ' + (e && e.message ? e.message : e))
  exitNow = 3
} finally {
  await live.close()
  if (fileServer !== null) fileServer.close()
}
if (exitNow !== null) process.exit(exitNow)

if (gaps.length > 0) { console.log('\nKNOWN GAPS'); gaps.forEach((g) => console.log('  - ' + g)) }
if (observations.length > 0) { console.log('\nOBSERVATIONS'); observations.forEach((o) => console.log('  - ' + o)) }
console.log('\n' + (failures === 0 ? 'All checks passed.' : failures + ' check(s) failed.'))
process.exit(failures === 0 ? 0 : 1)

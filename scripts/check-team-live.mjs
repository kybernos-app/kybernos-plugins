#!/usr/bin/env node
// What a user sees of the Team surfaces, on the REAL GUI, read-only.
//
//   node scripts/check-team-live.mjs [--shots <dir>] [--console-url <url>] [--capture-labels]
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
// Exit code 0 (all ✓), 1 (a ✗), 3 (inconclusive: no Chrome, no GUI, console unreachable, before any measure).
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openLivePage, waitFor } from './live-page.mjs'

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

const live = await openLivePage({ width: 1500, height: 950 }).catch((e) => inconclusive(e.message))
const { page } = live
let exitNow = null
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
  const consoleUrl = opt('--console-url')
  if (consoleUrl === null) inconclusive('no console URL (the menu step found no iframe); pass --console-url')
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
      const t = await page.evalJs(`${COUNT_FN}; ${LABELS_FN}; (() => { const root = document.getElementById('t-${id}'); return { n: __kbCount(root), l: __kbLabels(root) } })()`)
      if (t.val) { t.val.l.forEach((x) => labels.add(x)); extraControls = Math.max(extraControls, t.val.n) }
    }
    if (tabs.length > 0) await page.evalJs(`document.querySelectorAll('#t-${id} .subtabs button')[0].click()`)
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
    let lost = 0
    for (const id of Object.keys(baseline.pages)) {
      const now = new Set(captured[id] || [])
      const missing = baseline.pages[id].filter((l) => !now.has(l) && !allow.has(l))
      if (!ids.includes(id)) { fail('baseline page ' + id + ' still exists', 'the console no longer has it (add its labels to allowRemoved if it was approved)'); lost += 1; continue }
      if (missing.length > 0) { lost += missing.length; fail('page ' + id + ': every recorded label is still there', missing.length + ' missing, e.g. « ' + missing.slice(0, 3).join(' », « ') + ' »') } else pass('page ' + id + ': all ' + baseline.pages[id].length + ' recorded labels are still there')
    }
    const added = ids.filter((id) => !(id in baseline.pages))
    if (added.length > 0) observations.push('Pages not in the baseline: ' + added.join(', ') + '.')
  }
  await page.send('Emulation.clearDeviceMetricsOverride', {})
} catch (e) {
  console.log('\nThe check itself failed: ' + (e && e.message ? e.message : e))
  exitNow = 3
} finally {
  await live.close()
}
if (exitNow !== null) process.exit(exitNow)

if (gaps.length > 0) { console.log('\nKNOWN GAPS'); gaps.forEach((g) => console.log('  - ' + g)) }
if (observations.length > 0) { console.log('\nOBSERVATIONS'); observations.forEach((o) => console.log('  - ' + o)) }
console.log('\n' + (failures === 0 ? 'All checks passed.' : failures + ' check(s) failed.'))
process.exit(failures === 0 ? 0 : 1)

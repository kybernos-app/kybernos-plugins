#!/usr/bin/env node
// Cases J07-10 and J08-09 of docs/tests/user-journey, played on a DISPOSABLE server replica (kybernos-server `scripts/replica.ts`) through its Stripe stand-in.
// Nothing is typed on a payment page: money moves only through the stand-in's own control calls (`POST /__/stripe/pay`, `POST /__/stripe/subscription`).
//
//   J07-10  « Cancel and resume from inside the app »: on /account#plan, what the page offers to cancel, resume or downgrade, in which words, and WHERE a press goes
//           (the page of the payment provider's portal, or a route of the server). The desktop's own screens are searched for the same controls.
//   J08-09  « Payments that settle later or fail later, and expired checkout sessions »: the page the person lands on after a checkout (`?paid=1`, `?paid=0`),
//           what it says, what it does by itself afterwards (it reloads twice), and what is on screen when the confirmation comes late.
//
// Every observation is a measure: exact text of the screen, the rectangle of the button, the address the browser lands on, the seconds it takes.
//
//   KB_E2E_API / KB_E2E_WEB / KB_E2E_CONTROL / KB_E2E_DIR   as in scripts/lib-e2e-server.mjs (a replica you started yourself)
//   --out <folder>     pictures and the JSON (default <KB_E2E_DIR>/plan-portal-checkout)
//   --only j0710,j0809,j0613   (J06-13: every page and dialog of the money path, read for a coupon / promotion-code field or sentence)
//
// Exit 0 = every step was played and the hard checks held, 1 = a step failed, 3 = no replica to test (environment not set or not answering).
// What the page says is reported as findings by whoever plays the case; this script judges only what cannot be argued with (a dead press, a page that never shows the plan).
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { connect } from './cdp-lib.mjs'
import { fresh, makeServer } from './lib-e2e-server.mjs'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const argv = process.argv.slice(2)
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d }
const ONLY = opt('--only', 'j0710,j0809,j0613').split(',').filter(Boolean)

let S
try { S = makeServer() } catch (e) { console.log('wrong environment: ' + e.message); process.exit(3) }
try { if (!(await fetch(S.e.api + '/.well-known/kybernos-server.json')).ok) throw new Error('not ok') } catch { console.log('wrong environment: the replica does not answer at ' + S.e.api); process.exit(3) }
const chromeBin = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => p && existsSync(p))
if (!chromeBin) { console.log('wrong environment: no Chrome found (set CHROME_PATH)'); process.exit(3) }
const OUT = opt('--out', join(S.e.dir, 'plan-portal-checkout'))
mkdirSync(OUT, { recursive: true })

let pass = 0
let fail = 0
const notes = []
const check = (name, ok, saw) => { if (ok) pass++; else fail++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${saw !== undefined ? ' -- ' + JSON.stringify(saw).slice(0, 300) : ''}`) }
const note = (name, v) => { notes.push({ name, v }); console.log('     note ' + name + ': ' + (typeof v === 'string' ? JSON.stringify(v.slice(0, 700)) : JSON.stringify(v).slice(0, 700))) }
const freePort = (from) => new Promise((resolve) => { const t = (p) => { const s = createServer(); s.once('error', () => t(p + 1)); s.listen(p, '127.0.0.1', () => s.close(() => resolve(p))) }; t(from) })
const post = (path, json) => S.control(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(json) })
const must = (r, what) => { if (!(r.status >= 200 && r.status < 300)) throw new Error(`${what}: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`); return r.body }

const person = async (label) => {
  const p = fresh(label)
  await S.signUp(p.email, p.password, p.name)
  const s = await S.signIn(p.email, p.password)
  const list = must(await S.call('GET', '/v1/workspaces', { cookie: s.cookie }), 'workspaces')
  return { ...p, cookie: s.cookie, id: s.id, personal: list.workspaces.find((w) => w.personal).id }
}
const planOf = async (who, ws) => (await S.call('GET', `/v1/workspaces/${ws}/plan`, { cookie: who.cookie })).body
const subOf = async (ws) => { const st = await S.control('/__/stripe'); return (st.subscriptions || []).filter((x) => x.metadata && x.metadata.workspace_id === ws).at(-1) || null }
const checkoutOf = async (who, ws, body) => must(await S.call('POST', `/v1/workspaces/${ws}/billing/checkout`, { cookie: who.cookie, json: { currency: 'USD', quantity: 1, ...body } }), 'checkout')
const buy = async (who, ws, body) => {
  const co = await checkoutOf(who, ws, body)
  const paid = await post('/__/stripe/pay', { session_id: co.session_id })
  if (paid.delivered !== 200) throw new Error('pay: ' + JSON.stringify(paid))
  for (let i = 0; i < 20; i++) { const p = await planOf(who, ws); if (p && p.status !== 'free') return subOf(ws); await sleep(250) }
  throw new Error('the plan did not apply after the payment')
}

async function browser ({ width, height }) {
  const port = await freePort(9660)
  const profile = mkdtempSync(join(tmpdir(), 'kb-ppc-'))
  const chrome = spawn(chromeBin, ['--headless=new', '--remote-debugging-port=' + port, '--user-data-dir=' + profile, '--no-first-run', '--no-default-browser-check', '--lang=en-US', 'about:blank'], { stdio: 'ignore' })
  const cleanup = () => { try { chrome.kill() } catch { /* gone */ } try { rmSync(profile, { recursive: true, force: true }) } catch { /* best effort */ } }
  process.once('exit', cleanup)
  let target = null
  for (let i = 0; i < 60 && !target; i++) { await sleep(300); try { target = (await (await fetch('http://127.0.0.1:' + port + '/json/list')).json()).find((t) => t.type === 'page') } catch { /* not up yet */ } }
  if (!target) { cleanup(); throw new Error('chrome did not start') }
  const page = await connect(target)
  for (const m of ['Page.enable', 'Network.enable', 'Runtime.enable']) await page.send(m, {})
  const mobile = width < 600
  await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: mobile ? 2 : 1, mobile })
  const host = new URL(S.e.web).hostname
  const ev = async (js, ms) => { const r = await page.evalJs(js, ms || 12000); if (r.err) throw new Error(String(r.err).slice(0, 240)); return r.val }
  const login = async (cookie) => {
    await page.send('Network.clearBrowserCookies', {})
    for (const p of cookie.split('; ').filter(Boolean)) { const i = p.indexOf('='); await page.send('Network.setCookie', { name: p.slice(0, i), value: p.slice(i + 1), domain: host, path: '/', httpOnly: true }) }
  }
  const ready = `(() => { const c = document.getElementById('curName'); const t = document.getElementById('team'); return !!c && c.textContent.trim() !== '' && !!t && !t.classList.contains('loading') })()`
  const open = async (path) => {
    await page.send('Page.navigate', { url: 'about:blank' }); await sleep(150)
    await page.send('Page.navigate', { url: S.e.web + path })
    for (let i = 0; i < 60; i++) { await sleep(250); const ok = await page.evalJs(ready, 3000); if (ok.val === true) { await sleep(500); return true } }
    return false
  }
  const rectOf = (sel) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({ block: 'center', inline: 'center' }); const b = e.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2, w: Math.round(b.width), h: Math.round(b.height), l: Math.round(b.x), t: Math.round(b.y) } })()`)
  const press = async (sel, wait = 900) => {
    const r = await rectOf(sel)
    if (!r) return null
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type, x: r.x, y: r.y, button: 'left', clickCount: 1 })
    await sleep(wait)
    return r
  }
  // every button / link of a scope with its text, rectangle and what it carries as data
  const controls = (scope) => ev(`(() => { const root = document.querySelector(${JSON.stringify(scope)}) || document.body; return Array.from(root.querySelectorAll('button, a, [role=button]')).map((e) => { const b = e.getBoundingClientRect(); const cs = getComputedStyle(e); if (b.width === 0 || b.height === 0 || cs.visibility === 'hidden') return null; return { text: (e.innerText || e.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').trim().slice(0, 80), id: e.id || null, data: Object.assign({}, e.dataset), w: Math.round(b.width), h: Math.round(b.height), disabled: !!e.disabled, href: e.getAttribute('href') } }).filter(Boolean) })()`)
  const words = (sel) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}) || document.body; return (e.innerText || '').replace(/[ \\t]+/g, ' ').replace(/\\n+/g, ' / ').trim() })()`)
  const here = () => ev('location.href')
  const shot = async (name) => { try { await page.shot(join(OUT, name + '.png')) } catch { /* no picture */ } }
  return { page, ev, login, open, rectOf, press, controls, words, here, shot, close: () => { try { page.close() } catch { /* closed */ } cleanup() } }
}

const TOASTS = `(() => { const t = document.getElementById('toast'); const x = document.getElementById('toastText'); if (!t || !x) return []; const b = t.getBoundingClientRect(); const cs = getComputedStyle(t); const on = t.classList.contains('show') && b.width > 0 && cs.opacity !== '0' && cs.visibility !== 'hidden'; return on ? [x.innerText.trim() + ' [' + Math.round(b.width) + 'x' + Math.round(b.height) + ']'] : [] })()`
const PORTALISH = /portal|billing|payment provider|stripe|leave|taken to|redirect|opens? (a|the) (new|other)/i
const results = { startedAt: new Date().toISOString(), steps: [] }
let B = null
try {
  if (ONLY.includes('j0710')) {
    console.log('J07-10: cancel and resume from inside the app')
    const a = await person('portal-plus')
    const sub = await buy(a, a.personal, { plan: 'solo', component: 'solo', interval: 'month' })
    check('a Plus plan was bought through the stand-in', sub !== null, sub && { id: sub.id, status: sub.status })
    B = await browser({ width: 1440, height: 900 })
    await B.login(a.cookie)
    check('the Plan page opens', await B.open('/account#plan'))
    const planWords = await B.words('#team')
    note('Plan page of a paying person (all words)', planWords)
    const ctl = await B.controls('#team')
    note('every control on the Plan page (text, width x height, data)', ctl.map((c) => `${c.text || '(no text)'} [${c.w}x${c.h}]${Object.keys(c.data).length ? ' data=' + JSON.stringify(c.data) : ''}${c.href ? ' href=' + c.href : ''}`))
    const wanted = ctl.filter((c) => /cancel|resume|renew|downgrade|portal|manage|billing|invoice/i.test(c.text))
    note('controls whose words name cancel / resume / downgrade / portal / billing', wanted.map((c) => c.text))
    await B.shot('j0710-1-plan-paid-en-1440')
    // the sheet
    const opener = ctl.find((c) => /compare plans|change plan/i.test(c.text))
    check('there is a control that opens the plan sheet', !!opener, opener && opener.text)
    if (opener) {
      await B.ev(`(() => { const b = Array.from(document.querySelectorAll('#team button, #team a')).find((e) => /compare plans|change plan/i.test(e.innerText)); if (b) b.setAttribute('data-ppc', '1') })()`)
      await B.press('[data-ppc="1"]', 1200)
      const sheetWords = await B.words('.dialog, [role=dialog], #planOverlay')
      note('the plan sheet (all words)', sheetWords)
      const free = await B.rectOf('#plans [data-choose="free"]')
      note('the Downgrade to Free button (rectangle)', free)
      check('the sheet offers « Downgrade to Free » to a paying person', free !== null, free)
      if (free) {
        const label = await B.ev(`document.querySelector('#plans [data-choose="free"]').innerText.trim()`)
        const around = await B.ev(`(() => { const b = document.querySelector('#plans [data-choose="free"]'); let n = b; for (let i = 0; i < 4 && n.parentElement; i++) { n = n.parentElement; if (n.id === 'plans') break } return (n.innerText || '').replace(/\\s+/g, ' ').trim() })()`)
        const title = await B.ev(`document.querySelector('#plans [data-choose="free"]').getAttribute('title') || document.querySelector('#plans [data-choose="free"]').getAttribute('aria-label')`)
        note('the label of the button', label)
        note('the words around the button (its card)', around)
        note('a title or aria-label on the button', title)
        const sheetSaysPortal = PORTALISH.test(String(sheetWords)) || PORTALISH.test(String(title))
        note('does any word of the sheet or of the button name the provider / the portal / leaving the page', sheetSaysPortal)
        await B.shot('j0710-2-sheet-before-press-en-1440')
        const t0 = Date.now()
        const net = []
        B.page.on('Network.requestWillBeSent', (p) => { if (p.request && /billing\/portal/.test(p.request.url)) net.push({ method: p.request.method, url: p.request.url.replace(S.e.web, '') }) })
        await B.press('#plans [data-choose="free"]', 100)
        let landed = null
        for (let i = 0; i < 60 && landed === null; i++) { await sleep(150); const u = await B.here().catch(() => null); if (u && !u.startsWith(S.e.web + '/account')) landed = u }
        const secs = Math.round((Date.now() - t0) / 100) / 10
        const stateAfter = landed === null ? await B.words('#team') : await B.ev(`(document.body.innerText || '').replace(/[ \\t]+/g, ' ').replace(/\\n+/g, ' / ').trim()`)
        note('seconds from the press to the next page', landed === null ? null : secs)
        note('the address after the press (origin and path only)', landed === null ? '(the browser stayed on the account page)' : landed.replace(/[?#].*$/, ''))
        note('what is on screen after the press', stateAfter)
        note('the portal request seen', net)
        check('pressing « Downgrade to Free » either leaves for a page or asks a question first', landed !== null || /sure|confirm|cancel|end/i.test(String(stateAfter)), { landed: landed === null ? null : landed.replace(/[?#].*$/, '') })
        await B.shot('j0710-3-after-press-en-1440')
      }
    }
    // a plan that ends at the period end: is there a way to resume it from the page?
    const c = await person('portal-cancel')
    const cs = await buy(c, c.personal, { plan: 'solo', component: 'solo', interval: 'year' })
    await post('/__/stripe/subscription', { subscription_id: cs.id, cancel_at_period_end: true })
    for (let i = 0; i < 24; i++) { const p = await planOf(c, c.personal); if (p && p.cancel_at_period_end === true) break; await sleep(250) }
    await B.login(c.cookie)
    check('the Plan page of a plan that ends opens', await B.open('/account#plan'))
    const endWords = await B.words('#team')
    note('Plan page of a plan that ends at the period end (all words)', endWords)
    const endCtl = await B.controls('#team')
    note('every control there', endCtl.map((x) => `${x.text || '(no text)'} [${x.w}x${x.h}]`))
    const resume = endCtl.filter((x) => /resume|renew|keep|undo|reactivate|restart|don.t cancel|continue/i.test(x.text))
    note('a control that resumes the plan (words)', resume.map((x) => x.text))
    check('the page of a plan that ends offers a way to resume it', resume.length > 0, resume.map((x) => x.text))
    await B.shot('j0710-4-plan-ends-en-1440')
    // the sheet of that plan: what does it offer to a person whose plan is ending?
    await B.ev(`(() => { const b = Array.from(document.querySelectorAll('#team button, #team a')).find((e) => /compare plans|change plan/i.test(e.innerText)); if (b) b.setAttribute('data-ppc', '2') })()`)
    await B.press('[data-ppc="2"]', 1200)
    note('the sheet of a plan that ends (all words)', await B.words('.dialog, [role=dialog], #planOverlay'))
    note('the sheet of a plan that ends: every control', (await B.controls('#plans')).map((x) => `${x.text || '(no text)'} [${x.w}x${x.h}]${x.disabled ? ' disabled' : ''}${Object.keys(x.data).length ? ' data=' + JSON.stringify(x.data) : ''}`))
    await B.shot('j0710-4b-sheet-plan-ends-en-1440')
    // the same on a phone
    await B.close(); B = await browser({ width: 390, height: 844 })
    await B.login(a.cookie)
    await B.open('/account#plan')
    note('phone width, the paying person: every control with its size', (await B.controls('#team')).map((x) => `${x.text || '(no text)'} [${x.w}x${x.h}]`))
    await B.shot('j0710-5-plan-paid-en-390')
    await B.close(); B = null
    // the desktop: its own words for cancel / resume / downgrade
    const roots = readdirSync('packages').filter((d) => existsSync(join('packages', d, 'client.js')))
    const re = /cancel (your |the |my )?(plan|subscription)|resume (your |the |my )?(plan|subscription)|downgrade|annuler (l'|mon |ton )?(abonnement|formule)|reprendre (l'|mon |ton )?(abonnement|formule)|rétrograder/i
    const hits = []
    for (const d of roots) { const txt = readFileSync(join('packages', d, 'client.js'), 'utf8').split('\n'); txt.forEach((l, i) => { if (re.test(l)) hits.push(d + '/client.js:' + (i + 1) + ' ' + l.trim().slice(0, 140)) }) }
    note('the desktop plugins\' client.js lines that name cancel / resume / downgrade (' + roots.length + ' files searched)', hits)
    const portalLines = []
    for (const d of roots) { const txt = readFileSync(join('packages', d, 'client.js'), 'utf8').split('\n'); txt.forEach((l, i) => { if (/data-kb': 'upgrade-portal'|upPortal:/.test(l)) portalLines.push(d + '/client.js:' + (i + 1) + ' ' + l.trim().slice(0, 140)) }) }
    note('the desktop\'s only portal control', portalLines)
  }

  if (ONLY.includes('j0809')) {
    console.log('J08-09: after a checkout, late or never')
    // paid=0: the buyer came back without paying
    const f1 = await person('late-cancel')
    await checkoutOf(f1, f1.personal, { plan: 'solo', component: 'solo', interval: 'month' })
    B = await browser({ width: 1440, height: 900 })
    await B.login(f1.cookie)
    const t0 = Date.now()
    check('the page opens on the return of a cancelled payment (?paid=0)', await B.open('/account?paid=0#plan'))
    const w0 = await B.words('body')
    note('?paid=0 : the screen at once (all words)', w0)
    const toast0 = await B.ev(TOASTS)
    note('?paid=0 : visible toasts at once', toast0)
    await sleep(3000); note('?paid=0 : visible toasts 3 s later', await B.ev(TOASTS)); await sleep(3000); note('?paid=0 : visible toasts 6 s later', await B.ev(TOASTS))
    check('the cancelled return says nothing was charged', /nothing was charged|canceled/i.test(w0), toast0)
    await B.shot('j0809-1-paid0-en-1440')
    await sleep(8000)
    note('?paid=0 : address after 8 s (the mark goes from the address)', (await B.here()).replace(S.e.web, ''))
    note('?paid=0 : the plan after 8 s', (await B.words('#team')).slice(0, 300))
    await B.close(); B = null

    // paid=1 while the confirmation is late: the page reloads at 4 s and 12 s, then nothing
    const f2 = await person('late-paid')
    const co = await checkoutOf(f2, f2.personal, { plan: 'solo', component: 'solo', interval: 'month' })
    B = await browser({ width: 1440, height: 900 })
    await B.login(f2.cookie)
    check('the page opens on a return with ?paid=1 and no confirmation yet', await B.open('/account?paid=1#plan'))
    const t1 = Date.now()
    const snap = async (label) => {
      const w = await B.words('#team').catch(() => '(page changing)')
      note(label + ' (' + Math.round((Date.now() - t1) / 1000) + ' s after the page opened): the plan area', String(w).slice(0, 360))
      return w
    }
    const toast1 = await B.ev(TOASTS)
    note('?paid=1 with no confirmation yet : visible toasts at once', toast1)
    await B.shot('j0809-2-paid1-late-0s-en-1440')
    await sleep(6000); await snap('paid=1, still unpaid')
    await sleep(8000); const w14 = await snap('paid=1, still unpaid, both automatic reloads are over')
    await B.shot('j0809-3-paid1-late-14s-en-1440')
    const wait = /processing|still|waiting|checking|confirm|a moment|in progress|being applied/i
    note('does the screen at 14 s say the payment is still being confirmed (the words « 0 pending » of the team line are left out)', wait.test(String(w14).replace(/\d+ pending/g, '')))
    note('visible toasts at 14 s', await B.ev(TOASTS))
    // the confirmation arrives after the reloads
    const paid = await post('/__/stripe/pay', { session_id: co.session_id })
    note('the stand-in pays after the page gave up reloading (webhook delivery status)', paid.delivered)
    let applied = null
    for (let i = 0; i < 40 && applied === null; i++) { const p = await planOf(f2, f2.personal); if (p && p.status !== 'free') applied = p; else await sleep(250) }
    check('the server applies the plan after the late confirmation', applied !== null, applied && applied.status)
    await sleep(12000)
    const w26 = await snap('the plan is applied on the server, nobody reloaded')
    const planWord = await B.ev(`(() => { const e = document.getElementById('planName') || document.querySelector('[data-kb="plan-name"]'); return e ? e.innerText : null })()`)
    note('the plan name element', planWord)
    await B.shot('j0809-4-paid1-late-26s-en-1440')
    const stale = /free/i.test(String(w26)) && !/plus/i.test(String(w26))
    note('the page 12 s after the server applied the plan: still shows Free and not Plus', stale)
    // a person who reloads
    await B.page.send('Page.reload', {})
    await sleep(4000)
    const wR = await B.words('#team')
    note('after a manual reload (the plan area)', String(wR).slice(0, 360))
    check('after a manual reload the page shows the paid plan', /plus/i.test(String(wR)), String(wR).slice(0, 160))
    await B.close(); B = null

    // what the desktop says while a checkout is open in the browser (read from the source, as the desktop cannot be paid here)
    const src = readFileSync('packages/kybernos-cloud/client.js', 'utf8').split('\n')
    const lines = []
    src.forEach((l, i) => { if (/upOpened:|upOpenedRefresh:/.test(l)) lines.push('packages/kybernos-cloud/client.js:' + (i + 1) + ' ' + l.trim().slice(0, 150)) })
    note('the desktop dialog while the payment page is open (it waits for a press; no timer)', lines)
    const timers = src.filter((l) => /upgrade-opened|upOpened/.test(l)).length
    note('desktop: lines that mention the opened banner', timers)

    // expiry and failure that the server does not hear about
    const state = await S.control('/__/stripe')
    note('stand-in state keys (sessions and subscriptions the stand-in knows)', Object.keys(state))
    const sess = (state.sessions || []).slice(-3).map((s) => ({ status: s.status, payment_status: s.payment_status, mode: s.mode }))
    note('the last stand-in sessions (status)', sess)
    note('the stand-in routes that fail a payment later or expire a session', 'none in its header: pay, refund, dispute, redeliver, subscription, tax-settings')
  }

  if (ONLY.includes('j0613')) {
    console.log('J06-13: is a coupon or promotion code promised anywhere on the money path')
    const a = await person('coupon')
    B = await browser({ width: 1440, height: 900 })
    await B.login(a.cookie)
    const RE = /coupon|promo|discount|voucher|\bcode\b|reduction|réduction|% off|gift/i
    const INPUTS = `(() => Array.from(document.querySelectorAll('input, textarea, select')).filter((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0 && e.type !== 'hidden' }).map((e) => ({ type: e.type || e.tagName.toLowerCase(), name: e.name || e.id || null, placeholder: e.placeholder || null, label: e.getAttribute('aria-label') || null })))()`
    const seen = []
    const read = async (label, scope) => {
      const w = String(await B.words(scope))
      const hits = w.split(' / ').filter((x) => RE.test(x)).map((x) => x.slice(0, 120))
      const inputs = await B.ev(INPUTS)
      seen.push({ label, chars: w.length, hits, inputs })
      note(label + ': words that name a coupon / promotion / discount / voucher / code', hits)
      note(label + ': visible fields', inputs)
    }
    for (const [hash, label] of [['plan', 'Plan & credits'], ['billing', 'Billing'], ['referral', 'Referral'], ['usage', 'Usage']]) {
      const ok = await B.open('/account#' + hash)
      if (!ok) { note(label, 'the page did not reach the ready state of the plan pages; read as it is after 3 s'); await sleep(3000) }
      await read(label, '#team')
      await B.shot('j0613-' + hash + '-en-1440')
    }
    await B.open('/account#plan')
    await B.ev(`(() => { const b = Array.from(document.querySelectorAll('#team button, #team a')).find((e) => /compare plans/i.test(e.innerText)); if (b) b.setAttribute('data-ppc', '3') })()`)
    await B.press('[data-ppc="3"]', 1200)
    await read('the Compare plans sheet', '.dialog, [role=dialog], #planOverlay')
    await B.shot('j0613-sheet-en-1440')
    await B.ev(`(() => { document.querySelectorAll('.dialog [aria-label=Close], .dialog .close, button').forEach((e) => { if (/^close$/i.test((e.innerText || e.getAttribute('aria-label') || '').trim())) e.click() }) })()`)
    await sleep(600)
    await B.ev(`(() => { const b = Array.from(document.querySelectorAll('#team button')).find((e) => /add budget/i.test(e.innerText)); if (b) b.setAttribute('data-ppc', '4') })()`)
    await B.press('[data-ppc="4"]', 1200)
    await read('the Add budget dialog', '.dialog, [role=dialog], .modal')
    await B.shot('j0613-add-budget-en-1440')
    const anyField = seen.some((x) => x.inputs.some((i) => /coupon|promo|discount|code|voucher/i.test([i.name, i.placeholder, i.label].join(' '))))
    const anyHit = seen.flatMap((x) => x.hits.map((h) => x.label + ': ' + h))
    note('every screen read', seen.map((x) => x.label + ' (' + x.chars + ' chars, ' + x.inputs.length + ' fields)'))
    check('no field on the money path is named coupon / promo / discount / code / voucher', anyField === false, seen.map((x) => x.inputs))
    note('sentences that name one (all screens)', anyHit)
    await B.close(); B = null
    // the server: does it ask the payment provider for a promotion-code box on its payment page?
    const { execFileSync } = await import('node:child_process')
    const sd = process.env.KB_SERVER_DIR
    let serverHits = 'KB_SERVER_DIR not set'
    if (sd) { try { serverHits = execFileSync('grep', ['-rnoiE', 'allow_promotion_codes|promotion_code|coupon', join(sd, 'src'), '--include=*.ts', '--include=*.js'], { encoding: 'utf8' }).trim().split('\n').slice(0, 10) } catch { serverHits = 'no match in ' + sd.split('/').slice(-1)[0] + '/src' } }
    note('server source: allow_promotion_codes / promotion_code / coupon', serverHits)
  }
} catch (e) {
  fail += 1
  console.log('FAIL the run stopped: ' + (e && e.stack ? e.stack : e))
} finally {
  if (B !== null) B.close()
  try { writeFileSync(join(OUT, 'plan-portal-checkout.json'), JSON.stringify({ pass, fail, only: ONLY, notes }, null, 1)) } catch { /* no folder */ }
}
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)

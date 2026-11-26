#!/usr/bin/env node
// Case J06-10 of docs/tests/user-journey: the server's Plan page (/account#plan) in every state a plan can be in, English and French, on a phone (390 px) and a desktop (1440 px),
// played on a DISPOSABLE replica (kybernos-server `scripts/replica.ts`) through its Stripe stand-in. Nothing is typed on a payment page: the states are reached with the stand-in's
// own calls (`POST /__/stripe/pay` and `POST /__/stripe/subscription`, see the header of the replica), and the stand-in's local payment / portal pages are only navigated, never filled.
//
// For each state and each (language, width) it opens the page in headless Chrome signed in with the session cookie, waits for the plan to be drawn, and MEASURES (never by eye):
//   - the sideways scroll of the whole page (scrollWidth against innerWidth), of the Plan section, of every scroller inside it;
//   - every button / stepper / link / field: rectangle, text, disabled, under 32 px high or wide, covered (what `elementFromPoint` finds at its centre), outside the screen or its card;
//   - every box whose text is cut (overflow hidden / ellipsis / line clamp with more text than room);
//   - the visible sentences (`innerText`) and the leaf strings, so that an English and a French pass can be compared line by line.
// It then opens the « Compare plans » sheet (the Change Plan dialog) and measures it the same way, and plays the harmless buttons of the page.
//
//   KB_E2E_API / KB_E2E_WEB / KB_E2E_CONTROL / KB_E2E_DIR   as in scripts/lib-e2e-server.mjs (a replica you started yourself)
//   KB_PLAN_OUT       where pictures and the JSON go (default <KB_E2E_DIR>/plan-states, keep it outside git)
//   CHROME_PATH       optional, the Chrome or Chromium binary
//   --only a,b        only these states (free, plus-month, plus-year, pro, team-owner, team-member, team-none, past-due, past-due-member, cancel-pending, ended)
//   --langs en,fr     --widths 390,1440     --no-flows (skip the button-pressing flows)     --flows-only (only the button-pressing flows)     --flow-combos fr-390,en-1440 (only those flows)
//
// Exit 0 = every state was reached and read, 1 = a state could not be reached or a hard check failed, 3 = no replica to test (environment not set or not answering).
// The measures are reported as findings by whoever plays the case; this script judges only what cannot be argued with (a placeholder left in a sentence, a sideways page scroll, a dead state).
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { connect } from './cdp-lib.mjs'
import { fresh, makeServer } from './lib-e2e-server.mjs'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const argv = process.argv.slice(2)
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d }
const only = opt('--only', '').split(',').filter(Boolean)
const LANGS = opt('--langs', 'en,fr').split(',').filter(Boolean)
const WIDTHS = opt('--widths', '390,1440').split(',').map(Number).filter(Boolean)
const FLOWS = !argv.includes('--no-flows')
const FLOWS_ONLY = argv.includes('--flows-only')
const FLOW_COMBOS = opt('--flow-combos', '').split(',').filter(Boolean)

let S
try { S = makeServer() } catch (e) { console.log('wrong environment: ' + e.message); process.exit(3) }
try { if (!(await fetch(S.e.api + '/.well-known/kybernos-server.json')).ok) throw new Error('not ok') } catch { console.log('wrong environment: the replica does not answer at ' + S.e.api); process.exit(3) }
const chromeBin = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => p && existsSync(p))
if (!chromeBin) { console.log('wrong environment: no Chrome found (set CHROME_PATH)'); process.exit(3) }
const OUT = process.env.KB_PLAN_OUT || join(S.e.dir, 'plan-states')
mkdirSync(OUT, { recursive: true })

let failed = 0
const results = { startedAt: new Date().toISOString(), views: [], flows: [], states: {} }
const check = (name, ok, saw) => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${saw ? ' -- ' + String(saw).slice(0, 300) : ''}`) }
const note = (s) => console.log('     ' + s)
const freePort = (from) => new Promise((resolve) => { const t = (p) => { const s = createServer(); s.once('error', () => t(p + 1)); s.listen(p, '127.0.0.1', () => s.close(() => resolve(p))) }; t(from) })
const post = (path, json) => S.control(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(json) })
const must = (r, what) => { if (!(r.status >= 200 && r.status < 300)) throw new Error(`${what}: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`); return r.body }

// ── the data side: accounts, plans, the stand-in provider ──
const person = async (label) => {
  const p = fresh(label)
  await S.signUp(p.email, p.password, p.name)
  const s = await S.signIn(p.email, p.password)
  const list = must(await S.call('GET', '/v1/workspaces', { cookie: s.cookie }), 'workspaces')
  return { ...p, cookie: s.cookie, id: s.id, personal: list.workspaces.find((w) => w.personal).id }
}
const subOf = async (ws) => { const st = await S.control('/__/stripe'); return (st.subscriptions || []).filter((x) => x.metadata && x.metadata.workspace_id === ws).at(-1) || null }
const buy = async (who, ws, body) => {
  const co = must(await S.call('POST', `/v1/workspaces/${ws}/billing/checkout`, { cookie: who.cookie, json: { currency: 'USD', quantity: 1, ...body } }), 'checkout')
  const paid = await post('/__/stripe/pay', { session_id: co.session_id })
  if (paid.delivered !== 200) throw new Error('pay: ' + JSON.stringify(paid))
  for (let i = 0; i < 20; i++) { const p = await planOf(who, ws); if (p && p.status !== 'free') return subOf(ws); await sleep(250) }
  throw new Error('the plan did not apply after the payment')
}
const planOf = async (who, ws) => (await S.call('GET', `/v1/workspaces/${ws}/plan`, { cookie: who.cookie })).body
const provider = (sub, body) => post('/__/stripe/subscription', { subscription_id: sub.id, ...body })
const settle = async (who, ws, pred, what) => { for (let i = 0; i < 24; i++) { const p = await planOf(who, ws); if (pred(p)) return p; await sleep(250) } throw new Error('plan never reached: ' + what) }
const team = async (owner, name) => must(await S.call('POST', '/v1/workspaces', { cookie: owner.cookie, json: { name } }), 'create team')
const invite = async (owner, ws, member) => {
  must(await S.call('POST', `/v1/workspaces/${ws}/invitations`, { cookie: owner.cookie, json: { email: member.email, role: 'member' } }), 'invite')
  const mail = await S.mail(member.email)
  const m = /token=([A-Za-z0-9_\-%.]+)/.exec(String(mail.text || ''))
  if (!m) throw new Error('no invitation link in the mailbox')
  must(await S.call('POST', '/v1/invitations/accept', { cookie: member.cookie, json: { token: decodeURIComponent(m[1]) } }), 'accept')
}

// Each state: build it on its own accounts and say who looks at which workspace.
const STATES = {
  'free': async () => { const a = await person('free'); return { viewer: a, ws: a.personal, what: 'personal workspace that never paid' } },
  'plus-month': async () => { const a = await person('plusm'); const sub = await buy(a, a.personal, { plan: 'solo', component: 'solo', interval: 'month' }); return { viewer: a, ws: a.personal, sub, what: 'Plus, paid month by month' } },
  'plus-year': async () => { const a = await person('plusy'); const sub = await buy(a, a.personal, { plan: 'solo', component: 'solo', interval: 'year' }); return { viewer: a, ws: a.personal, sub, what: 'Plus, paid a year at a time' } },
  'pro': async () => { const a = await person('pro'); const sub = await buy(a, a.personal, { plan: 'solo', component: 'studio', interval: 'year' }); return { viewer: a, ws: a.personal, sub, what: 'Pro, paid a year at a time' } },
  'team-owner': async () => {
    const o = await person('towner'); const m = await person('tmember'); const t = await team(o, 'Plan Team')
    const sub = await buy(o, t.id, { plan: 'team', component: 'band:0', quantity: 3, interval: 'year' })
    await invite(o, t.id, m)
    const ghost = fresh('tpending'); must(await S.call('POST', `/v1/workspaces/${t.id}/invitations`, { cookie: o.cookie, json: { email: ghost.email, role: 'member' } }), 'second invitation')
    return { viewer: o, ws: t.id, sub, member: m, what: 'Team of 3 seats, yearly, 2 people and 1 invitation waiting; the owner looks' }
  },
  'team-member': async () => {
    const o = await person('towner2'); const m = await person('tmember2'); const t = await team(o, 'Plan Team')
    const sub = await buy(o, t.id, { plan: 'team', component: 'band:0', quantity: 3, interval: 'month' })
    await invite(o, t.id, m)
    return { viewer: m, ws: t.id, sub, owner: o, what: 'Team of 3 seats, monthly; an ordinary member looks' }
  },
  'team-none': async () => { const o = await person('tnone'); const t = await team(o, 'Plan Team'); return { viewer: o, ws: t.id, what: 'a team that never bought a plan; the owner looks' } },
  'past-due': async () => {
    const a = await person('pastdue'); const sub = await buy(a, a.personal, { plan: 'solo', component: 'solo', interval: 'month' })
    const down = await provider(sub, { status: 'past_due' })
    if (down.status !== 'past_due') throw new Error('the stand-in did not accept past_due: ' + JSON.stringify(down))
    await settle(a, a.personal, (p) => p && p.payment_blocked === true, 'payment_blocked')
    return { viewer: a, ws: a.personal, sub, what: 'Plus whose renewal failed (the provider says past_due)' }
  },
  'past-due-member': async () => {
    const o = await person('pdowner'); const m = await person('pdmember'); const t = await team(o, 'Plan Team')
    const sub = await buy(o, t.id, { plan: 'team', component: 'band:0', quantity: 2, interval: 'year' }); await invite(o, t.id, m)
    await provider(sub, { status: 'past_due' }); await settle(o, t.id, (p) => p && p.payment_blocked === true, 'payment_blocked')
    return { viewer: m, ws: t.id, sub, owner: o, what: 'Team whose renewal failed; an ordinary member looks' }
  },
  'cancel-pending': async () => {
    const a = await person('cancel'); const sub = await buy(a, a.personal, { plan: 'solo', component: 'solo', interval: 'year' })
    await provider(sub, { cancel_at_period_end: true }); await settle(a, a.personal, (p) => p && p.cancel_at_period_end === true, 'cancel_at_period_end')
    return { viewer: a, ws: a.personal, sub, what: 'Plus yearly that ends at the end of the period (cancel_at_period_end)' }
  },
  'ended': async () => {
    const a = await person('ended'); const sub = await buy(a, a.personal, { plan: 'solo', component: 'solo', interval: 'year' })
    await provider(sub, { cancel_at_period_end: true }); await provider(sub, { deleted: true })
    await settle(a, a.personal, (p) => p && p.status !== 'active', 'the subscription gone')
    return { viewer: a, ws: a.personal, sub, what: 'Plus yearly after the end date (the provider deleted the subscription)' }
  },
}

// ── the page side: headless Chrome signed in with the session cookie ──
async function browser ({ width, height, lang }) {
  const port = await freePort(9560)
  const profile = mkdtempSync(join(tmpdir(), 'kb-plan-'))
  const chrome = spawn(chromeBin, ['--headless=new', '--remote-debugging-port=' + port, '--user-data-dir=' + profile, '--no-first-run', '--no-default-browser-check', `--lang=${lang === 'fr' ? 'fr-FR' : 'en-US'}`, 'about:blank'], { stdio: 'ignore' })
  const cleanup = () => { try { chrome.kill() } catch { /* already gone */ } try { rmSync(profile, { recursive: true, force: true }) } catch { /* best effort */ } }
  process.once('exit', cleanup)
  let target = null
  for (let i = 0; i < 60 && !target; i++) { await sleep(300); try { target = (await (await fetch('http://127.0.0.1:' + port + '/json/list')).json()).find((t) => t.type === 'page') } catch { /* not up yet */ } }
  if (!target) { cleanup(); throw new Error('chrome did not start') }
  const page = await connect(target)
  for (const m of ['Page.enable', 'Network.enable', 'Runtime.enable']) await page.send(m, {})
  const mobile = width < 600
  await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: mobile ? 2 : 1, mobile })
  const ua = (await page.evalJs('navigator.userAgent')).val.replace('HeadlessChrome', 'Chrome')
  await page.send('Emulation.setUserAgentOverride', { userAgent: ua, acceptLanguage: lang === 'fr' ? 'fr-FR,fr' : 'en-US,en' })
  await page.send('Emulation.setLocaleOverride', { locale: lang === 'fr' ? 'fr-FR' : 'en-US' })
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { window.__net = []; const of = window.fetch; window.fetch = async function (i, init) { const r = await of.apply(this, arguments); let err = ''; try { if (!r.ok) { const j = await r.clone().json(); err = String(j.error || '') } } catch (e) {} window.__net.push({ m: (init && init.method) || 'GET', u: String(typeof i === 'string' ? i : i.url).replace(/\\?.*$/, ''), s: r.status, err }); return r } })()` })
  const host = new URL(S.e.web).hostname
  const ev = async (js, ms) => { const r = await page.evalJs(js, ms || 12000); if (r.err) throw new Error(String(r.err).slice(0, 240)); return r.val }
  const login = async (cookie) => {
    await page.send('Network.clearBrowserCookies', {})
    for (const p of cookie.split('; ').filter(Boolean)) { const i = p.indexOf('='); await page.send('Network.setCookie', { name: p.slice(0, i), value: p.slice(i + 1), domain: host, path: '/', httpOnly: true }) }
  }
  const open = async (hash) => {
    await page.send('Page.navigate', { url: 'about:blank' }); await sleep(150)
    await page.send('Page.navigate', { url: S.e.web + '/account#' + hash })
    for (let i = 0; i < 50; i++) {
      await sleep(250)
      const ok = await page.evalJs(`(() => { const c = document.getElementById('curName'); const t = document.getElementById('team'); return !!c && c.textContent.trim() !== '' && !!t && !t.classList.contains('loading') })()`, 3000)
      if (ok.val === true) { await sleep(500); return true }
    }
    return false
  }
  const rectOf = (sel) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({ block: 'center', inline: 'center' }); const b = e.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 } })()`)
  // A real mouse press at the centre of the element, as a person does.
  const click = async (sel, wait = 900) => {
    const r = await rectOf(sel)
    if (!r) return false
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type, x: r.x, y: r.y, button: 'left', clickCount: 1 })
    await sleep(wait)
    return true
  }
  const clickText = async (scopeSel, re, wait = 900) => {
    const id = await ev(`(() => { const re = new RegExp(${JSON.stringify(re)}, 'i'); const els = [...document.querySelectorAll(${JSON.stringify(scopeSel)} + ' button, ' + ${JSON.stringify(scopeSel)} + ' a')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && re.test(e.innerText) }); if (!els.length) return null; els[0].setAttribute('data-kbpress', '1'); return els[0].innerText.trim() })()`)
    if (id === null) return null
    await click('[data-kbpress="1"]', wait)
    await ev(`document.querySelectorAll('[data-kbpress]').forEach((e) => e.removeAttribute('data-kbpress'))`).catch(() => {})
    return id
  }
  const net = () => ev('(() => { const x = window.__net || []; window.__net = []; return x })()')
  // The whole of what is drawn is photographed: the viewport grows to the height of the page so nothing scrolls out of the picture.
  const shot = async (name, { whole = true, reset = true } = {}) => {
    // measuring scrolls controls into view (inside the dialog too): the picture is taken from the top again
    if (reset) await ev(`(() => { document.querySelectorAll('.dialog, .scrim, .content, main').forEach((e) => { e.scrollTop = 0 }); window.scrollTo(0, 0) })()`).catch(() => {})
    if (whole) {
      const h = await ev(`Math.max(document.documentElement.scrollHeight, document.body.scrollHeight, ...Array.from(document.querySelectorAll('*')).filter((e) => { const o = getComputedStyle(e).overflowY; return (o === 'auto' || o === 'scroll') && e.scrollHeight > e.clientHeight + 4 }).map((e) => e.getBoundingClientRect().top + e.scrollHeight))`)
      await page.send('Emulation.setDeviceMetricsOverride', { width, height: Math.min(Math.max(height, Math.ceil(h) + 8), 4200), deviceScaleFactor: mobile ? 2 : 1, mobile })
      await sleep(250)
    }
    const ok = await page.shot(join(OUT, name + '.png'))
    if (whole) await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: mobile ? 2 : 1, mobile })
    return ok ? join(OUT, name + '.png') : null
  }
  return { page, ev, login, open, click, clickText, net, shot, rectOf, close: () => { try { page.close() } catch { /* closed */ } cleanup() } }
}

// What is measured inside a scope (the Plan section, or the dialog that is open).
const MEASURE = (scopeSel) => `(() => {
  const scope = document.querySelector(${JSON.stringify(scopeSel)});
  if (!scope) return { missing: true };
  const vw = innerWidth, vh = innerHeight;
  const vis = (e) => { const r = e.getBoundingClientRect(), cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0'; };
  const norm = (s) => String(s || '').replace(/\\s+/g, ' ').trim();
  const name = (e) => norm(e.getAttribute('aria-label') || e.innerText || e.value || e.title || e.id || e.tagName).slice(0, 90);
  const desc = (e) => e ? (e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\\s+/).join('.') : '')).slice(0, 80) : null;
  const controls = [...scope.querySelectorAll('button, a[href], input, select, textarea, [role=button], summary, [tabindex]:not([tabindex="-1"])')].filter(vis);
  const rows = controls.map((e) => {
    e.scrollIntoView({ block: 'center', inline: 'center' });
    const r = e.getBoundingClientRect();
    const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
    const top = document.elementFromPoint(cx, cy);
    const covered = !!top && top !== e && !e.contains(top) && !top.contains(e) ? desc(top) : null;
    const box = e.closest('.card, .plan, .dialog');
    const bb = box ? box.getBoundingClientRect() : null;
    const outScreen = r.right > vw + 1 || r.left < -1;
    const outBox = !!bb && (r.right > bb.right + 1 || r.left < bb.left - 1);
    return { tag: e.tagName.toLowerCase(), id: e.id || null, cls: typeof e.className === 'string' ? e.className : '', title: e.title || null, text: name(e), disabled: !!e.disabled || e.getAttribute('aria-disabled') === 'true', pressed: e.getAttribute('aria-pressed'), href: e.getAttribute('href'),
      x: Math.round(r.x), y: Math.round(r.y + scrollY), w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10, small: r.height < 32 || r.width < 32, covered, outScreen, outBox };
  });
  const cut = [];
  for (const e of scope.querySelectorAll('*')) {
    if (!vis(e)) continue;
    const cs = getComputedStyle(e);
    const hx = ['hidden', 'clip', 'auto', 'scroll'].includes(cs.overflowX), hy = ['hidden', 'clip'].includes(cs.overflowY);
    if (hx && e.scrollWidth > e.clientWidth + 1 && norm(e.innerText) !== '') cut.push({ el: desc(e), kind: cs.overflowX === 'auto' || cs.overflowX === 'scroll' ? 'scrolls sideways' : (cs.textOverflow === 'ellipsis' ? 'ellipsis' : 'cut'), scrollW: e.scrollWidth, clientW: e.clientWidth, text: norm(e.innerText).slice(0, 80) });
    else if (hy && e.scrollHeight > e.clientHeight + 1 && norm(e.innerText) !== '') cut.push({ el: desc(e), kind: 'cut vertically', scrollH: e.scrollHeight, clientH: e.clientHeight, text: norm(e.innerText).slice(0, 80) });
    const r = e.getBoundingClientRect();
    if (r.right > vw + 1 && e.children.length === 0 && norm(e.textContent) !== '') cut.push({ el: desc(e), kind: 'past the right edge of the screen', right: Math.round(r.right), vw, text: norm(e.textContent).slice(0, 80) });
  }
  // text or a button that runs past the right or left edge of its own card (nothing clips it, so the cut list does not see it)
  const escapes = [];
  for (const e of scope.querySelectorAll('*')) {
    if (!vis(e) || e.children.length > 0) continue;
    const t = norm(e.innerText || e.textContent); if (!t) continue;
    const box = e.closest('.card, .plan'); if (!box) continue;
    const r = e.getBoundingClientRect(), bb = box.getBoundingClientRect();
    if (r.right > bb.right + 1 || r.left < bb.left - 1) escapes.push({ el: desc(e), text: t.slice(0, 70), right: Math.round(r.right), cardRight: Math.round(bb.right), left: Math.round(r.left), cardLeft: Math.round(bb.left), over: Math.round(Math.max(r.right - bb.right, bb.left - r.left)) });
  }
  // leaf strings: the elements that own a piece of visible text, in reading order
  const lines = [];
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = norm(n.nodeValue); if (!t) continue;
    const p = n.parentElement; if (!p || !vis(p)) continue;
    lines.push(t);
  }
  const stray = (norm(scope.innerText).match(/undefined|\\[object|\\bNaN\\b|\\bnull\\b|\\{[a-z_]+\\}|\\$\\{|%s|&amp;|&#/g) || []);
  const sc = [...scope.querySelectorAll('*')].filter((e) => vis(e) && e.scrollWidth > e.clientWidth + 1 && ['auto', 'scroll'].includes(getComputedStyle(e).overflowX)).map((e) => ({ el: desc(e), scrollW: e.scrollWidth, clientW: e.clientWidth }));
  // the lines of the plan's sentence (#curMeta) and of the failed-payment block, with their type: where a date breaks, how small it is
  const linesOf = (el) => { if (!el || !vis(el)) return null; const out = []; const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); for (let n = w.nextNode(); n; n = w.nextNode()) { const re = /\\S+/g; let m; while ((m = re.exec(n.nodeValue))) { const r = document.createRange(); r.setStart(n, m.index); r.setEnd(n, m.index + m[0].length); const b = r.getBoundingClientRect(); const top = Math.round(b.top); let l = out.find((x) => Math.abs(x.top - top) < 4); if (!l) { l = { top, words: [] }; out.push(l); } l.words.push(m[0]); } } const cs = getComputedStyle(el); return { fontSize: cs.fontSize, color: cs.color, lines: out.map((l) => l.words.join(' ')) }; };
  const sentence = { curMeta: linesOf(document.getElementById('curMeta')), payNote: linesOf(document.getElementById('payNote')), buyNote: linesOf(document.getElementById('buyNote')) };
  const sr = scope.getBoundingClientRect();
  return { innerWidth: vw, innerHeight: vh, docScrollWidth: document.documentElement.scrollWidth, bodyScrollWidth: document.body.scrollWidth, sidewaysPage: document.documentElement.scrollWidth > vw + 1 || document.body.scrollWidth > vw + 1,
    scopeRect: { x: Math.round(sr.x), w: Math.round(sr.width), h: Math.round(sr.height) }, scopeScrollWidth: scope.scrollWidth, scopeClientWidth: scope.clientWidth, scrollers: sc,
    text: norm(scope.innerText), lines, stray, controls: rows, cut, escapes, sentence };
})()`

const summary = (m) => m.missing ? 'missing' : `${m.controls.length} controls, small ${m.controls.filter((c) => c.small && !c.disabled).length}, covered ${m.controls.filter((c) => c.covered).length}, outside ${m.controls.filter((c) => c.outScreen || c.outBox).length}, cut ${m.cut.length}, past its card ${(m.escapes || []).length}, sideways page ${m.sidewaysPage}, stray ${m.stray.length}`

const tag = (s) => s.replace(/[^a-z0-9]+/gi, '-').toLowerCase()

// ── one view: a state, a language, a width ──
async function view (b, st, key, lang, width) {
  const label = `${key}-${lang}-${width}`
  await b.login(st.viewer.cookie)
  const ready = await b.open(`plan&ws=${st.ws}`)
  if (!ready) { check(`${label}: the Plan page is drawn`, false, 'the plan name never appeared'); return null }
  const info = await b.ev(`({ lang: document.documentElement.lang, nav: (navigator.languages || []).join(), title: document.title, hash: location.hash })`)
  const m = await b.ev(MEASURE('#t-plan'))
  const shot = await b.shot(`plan-${label}`)
  const entry = { key, lang, width, label, what: st.what, info, shot, measure: m }
  // the sheet
  const opened = await b.click('#toCompare', 900)
  if (opened) {
    const d = await b.ev(MEASURE('.dialog'))
    // the dialog is as tall as its content up to the screen; past that it scrolls inside: say so, and photograph its two ends at the real screen size
    const dl = await b.ev(`(() => { const e = document.querySelector('.dialog'); const r = e.getBoundingClientRect(); return { scrollHeight: e.scrollHeight, clientHeight: e.clientHeight, top: Math.round(r.top), bottom: Math.round(r.bottom), innerHeight, overflowY: getComputedStyle(e).overflowY, closeBtnTop: (() => { const c = document.getElementById('planClose'); return c ? Math.round(c.getBoundingClientRect().top) : null })() } })()`)
    entry.sheet = { measure: d, dialog: dl, shot: await b.shot(`sheet-${label}`, { whole: false }) }
    if (dl.scrollHeight > dl.clientHeight + 4) {
      await b.ev(`(() => { const e = document.querySelector('.dialog'); e.scrollTop = e.scrollHeight })()`); await sleep(250)
      entry.sheet.shotBottom = await b.shot(`sheet-${label}-bottom`, { whole: false, reset: false })
      const last = await b.ev(`(() => { const e = document.querySelector('.dialog'); const r = e.getBoundingClientRect(); const kids = [...e.querySelectorAll('button, p, div')].filter((x) => x.getBoundingClientRect().height > 0); const lowest = Math.max(...kids.map((x) => x.getBoundingClientRect().bottom)); return { dialogBottom: Math.round(r.bottom), lowestContentBottom: Math.round(lowest), scrollTop: e.scrollTop } })()`)
      entry.sheet.bottom = last
    }
    await b.page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await sleep(400)
    const still = await b.ev(`!!document.querySelector('.dialog')`)
    if (still) await b.clickText('.dialog', '^(close|fermer)$', 500)
  }
  results.views.push(entry)
  check(`${label}: ${summary(m)}`, !m.sidewaysPage && m.stray.length === 0, `${m.text.slice(0, 160)}`)
  if (opened && entry.sheet.measure && !entry.sheet.measure.missing) note(`sheet: ${summary(entry.sheet.measure)}`)
  return entry
}

// ── the buttons: what each one does when it is pressed (stand-in only; nothing here deletes anything) ──
const STATE_JS = `(() => { const t = (s) => { const e = document.querySelector(s); return e ? e.innerText.replace(/\\s+/g, ' ').trim() : null }; const to = document.getElementById('toast');
  return { url: location.origin + location.pathname + location.search + location.hash, title: document.title, cur: t('#curName'), meta: t('#curMeta'), pay: t('#payNote'), toast: to && to.classList.contains('show') ? t('#toastText') : null,
    dialogs: [...document.querySelectorAll('.dialog')].map((d) => d.innerText.replace(/\\s+/g, ' ').trim()), chgErr: t('#chgErr'), chgErrColor: (() => { const e = document.querySelector('#chgErr:not(.hidden), .over:not(.hidden)'); return e ? getComputedStyle(e).color : null })(), payNoteColor: (() => { const e = document.querySelector('#payNote .paywhat b'); return e ? getComputedStyle(e).color : null })(), body: document.body ? document.body.innerText.replace(/\\s+/g, ' ').trim().slice(0, 300) : '' } })()`

async function flowsFor (lang, width) {
  const combo = `${lang}-${width}`
  const b = await browser({ width, height: width < 600 ? 844 : 900, lang })
  const rec = []
  let n = 0
  const step = async (flow, did, fn, { shotName = null, dialog = null } = {}) => {
    let out = null; let err = null
    try { out = await fn() } catch (e) { err = e.message }
    await sleep(250)
    let st = null
    try { st = await b.ev(STATE_JS) } catch (e) { st = { error: e.message } }
    let meas = null
    if (dialog) { try { meas = await b.ev(MEASURE(dialog)) } catch { /* the dialog is gone */ } }
    const shot = shotName ? await b.shot(`flow-${flow}-${combo}-${String(++n).padStart(2, '0')}-${shotName}`).catch(() => null) : null
    const row = { flow, combo, did, result: out, error: err, state: st, shot, measure: meas && !meas.missing ? { summary: summary(meas), controls: meas.controls, cut: meas.cut, escapes: meas.escapes, text: meas.text, sidewaysPage: meas.sidewaysPage, stray: meas.stray } : null }
    rec.push(row)
    note(`${flow} ${combo}: ${did} -> ${[st && st.toast && 'toast: ' + st.toast, st && st.chgErr && 'error: ' + st.chgErr, st && st.dialogs && st.dialogs.length ? 'dialog: ' + st.dialogs[st.dialogs.length - 1].slice(0, 160) : null, st && st.cur && 'page: ' + st.cur + ' / ' + st.meta, err && 'ERR ' + err].filter(Boolean).join(' | ').slice(0, 330)}`)
    return row
  }
  const esc = () => b.page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  const go = async (who, ws) => { await b.login(who.cookie); return b.open(`plan&ws=${ws}`) }
  const sheet = async () => { await b.click('#toCompare', 900); return b.ev(`!!document.querySelector('.dialog #plans, .dialog #teamPlan')`) }
  try {
    // F1: a Plus account (monthly) walks the sheet: interval, upgrade (cancelled), the leave-to-portal button, upgrade, downgrade, switch to yearly.
    {
      const a = await person('f1'); await buy(a, a.personal, { plan: 'solo', component: 'solo', interval: 'month' })
      await go(a, a.personal)
      await step('upgrade', 'opened « Compare plans »', sheet, { shotName: 'sheet', dialog: '.dialog' })
      await step('upgrade', 'pressed « Annual »', () => b.click('[data-interval="year"]'), { shotName: 'annual', dialog: '.dialog' })
      await step('upgrade', 'pressed « Monthly »', () => b.click('[data-interval="month"]'))
      await step('upgrade', 'pressed « Choose PRO »', () => b.click('#plans [data-choose="studio"]'), { shotName: 'choose-pro', dialog: '.dialog' })
      await step('upgrade', 'pressed Cancel in that dialog', () => b.click('#mCancel'))
      await b.net()
      await step('upgrade', 'reopened the sheet and pressed « Downgrade to Free »', async () => { await sheet(); await b.click('#plans [data-choose="free"]', 1800) }, { shotName: 'downgrade-free-lands' })
      const landed = (await b.ev(STATE_JS)).url
      results.flows.push({ flow: 'upgrade', combo, landed })
      await go(a, a.personal)
      await step('upgrade', 'sheet, « Choose PRO », Confirm', async () => { await sheet(); await b.click('#plans [data-choose="studio"]'); await b.net(); await b.click('#doChange', 1800); return b.net() }, { shotName: 'after-upgrade' })
      await sleep(800)
      await step('upgrade', 'plan page after the upgrade (reloaded)', async () => { await go(a, a.personal); return planOf(a, a.personal).then((p) => ({ level: p.level, interval: p.interval })) }, { shotName: 'page-pro' })
      await step('upgrade', 'sheet, « Downgrade to PLUS » dialog', async () => { await sheet(); await b.click('#plans [data-choose="solo"]') }, { shotName: 'downgrade-plus', dialog: '.dialog' })
      await step('upgrade', 'Confirm the downgrade', async () => { await b.net(); await b.click('#doChange', 1800); return b.net() }, { shotName: 'after-downgrade' })
      await step('upgrade', 'sheet: Annual then the Plus card button', async () => { await go(a, a.personal); await sheet(); await b.click('[data-interval="year"]'); const t = await b.ev(`(() => { const x = document.querySelector('#plans .plan.cur .foot button'); return x ? x.innerText : null })()`); return t }, { shotName: 'switch-annual-card', dialog: '.dialog' })
      await step('upgrade', 'pressed the Plus card button (switch to annual billing)', () => b.click('#plans .plan.cur .foot button'), { shotName: 'switch-annual-dialog', dialog: '.dialog' })
      await step('upgrade', 'Confirm the switch to annual', async () => { await b.net(); await b.click('#doChange', 1800); return b.net() })
      await step('upgrade', 'sheet after the switch: the Monthly button', async () => { await go(a, a.personal); await sheet(); return b.ev(`(() => { const x = document.querySelector('[data-interval="month"]'); return x ? { disabled: x.disabled, title: x.title, text: x.innerText } : null })()`) }, { shotName: 'yearly-locked', dialog: '.dialog' })
      await esc()
      await step('upgrade', 'pressed « See usage »', () => b.click('[data-go="usage"]', 1000))
      await step('upgrade', 'pressed « + Add budget » (read, then Cancel)', async () => { await go(a, a.personal); await b.click('#buyBtn', 900) }, { shotName: 'add-budget', dialog: '.dialog' })
      await esc()
    }
    // F2: a Free account buys Plus: cancel on the stand-in payment page, then pay there.
    {
      const a = await person('f2'); await go(a, a.personal)
      await step('free-buy', 'sheet, « Choose PLUS »', async () => { await sheet(); await b.click('#plans [data-choose="solo"]') }, { shotName: 'choose-plus', dialog: '.dialog' })
      await step('free-buy', 'pressed « Continue to payment »', () => b.click('#doPlan', 1800), { shotName: 'stand-in-pay-page' })
      await step('free-buy', 'pressed Cancel on the stand-in payment page', () => b.click('a.b.s', 2500), { shotName: 'back-from-cancel' })
      await step('free-buy', 'sheet, Choose PRO, Continue, then « Pay with the test card » (stand-in button, nothing typed)', async () => { await go(a, a.personal); await sheet(); await b.click('#plans [data-choose="studio"]'); await b.click('#doPlan', 1800); await b.click('#pay', 3000) }, { shotName: 'back-from-pay' })
      await step('free-buy', 'plan after the payment (API)', async () => planOf(a, a.personal).then((p) => ({ api: p.level })))
    }
    // F3: a team owner moves the seats; a member tries.
    {
      const o = await person('f3o'); const m = await person('f3m'); const t = await team(o, 'Seat Team')
      const sub = await buy(o, t.id, { plan: 'team', component: 'band:0', quantity: 3, interval: 'year' }); await invite(o, t.id, m)
      const ghost = fresh('f3g'); must(await S.call('POST', `/v1/workspaces/${t.id}/invitations`, { cookie: o.cookie, json: { email: ghost.email, role: 'member' } }), 'invite')
      await go(o, t.id)
      await step('seats', 'owner opened the sheet', sheet, { shotName: 'sheet', dialog: '.dialog' })
      await step('seats', 'pressed « − » once (3 -> 2, but 2 people and 1 invitation)', () => b.click('#seatMinus'), { shotName: 'minus', dialog: '.dialog' })
      await step('seats', 'pressed « − » again (the floor)', async () => { await b.click('#seatMinus', 200); return b.ev(`document.querySelector('.stepper span').innerText + ' | ' + document.querySelector('#switchTeam').innerText + ' | disabled ' + document.querySelector('#switchTeam').disabled`) })
      await step('seats', 'pressed « + » twice (-> 4 seats)', async () => { await b.click('#seatPlus', 200); await b.click('#seatPlus', 200); return b.ev(`document.querySelector('.stepper span').innerText + ' | ' + document.querySelector('#switchTeam').innerText`) }, { shotName: 'plus', dialog: '.dialog' })
      await step('seats', 'pressed the Update button', () => b.click('#switchTeam'), { shotName: 'update-dialog', dialog: '.dialog' })
      await step('seats', 'Cancel in that dialog', () => b.click('#mCancel'))
      await step('seats', 'sheet again (4 seats kept), Update, Confirm', async () => { await sheet(); await b.click('#switchTeam'); await b.net(); await b.click('#doChange', 1800); return b.net() }, { shotName: 'after-update' })
      await step('seats', 'plan after the update (API)', () => planOf(o, t.id).then((p) => ({ seats: p.seats })))
      await go(m, t.id)
      await step('seats', 'member opened the sheet and pressed « + »', async () => { await sheet(); await b.click('#seatPlus', 200); return b.ev(`document.querySelector('#switchTeam').innerText + ' / disabled ' + document.querySelector('#switchTeam').disabled`) }, { shotName: 'member-plus', dialog: '.dialog' })
      await step('seats', 'member pressed the Update button', () => b.click('#switchTeam', 1000), { shotName: 'member-update' })
      await go(m, t.id)
      await step('seats', 'member pressed « + Add budget »', () => b.click('#buyBtn', 900), { shotName: 'member-add-budget' })
    }
    // F4: a plan that ends at the period's end: what the sheet offers, what « Choose PRO » does, how to resume through the stand-in portal.
    {
      const a = await person('f4'); const sub = await buy(a, a.personal, { plan: 'solo', component: 'solo', interval: 'year' })
      await provider(sub, { cancel_at_period_end: true }); await settle(a, a.personal, (p) => p && p.cancel_at_period_end === true, 'cancel pending')
      await go(a, a.personal)
      await step('ending', 'opened the sheet of an ending plan', sheet, { shotName: 'sheet', dialog: '.dialog' })
      await step('ending', 'pressed « Choose PRO »', () => b.click('#plans [data-choose="studio"]'), { shotName: 'choose-pro', dialog: '.dialog' })
      await step('ending', 'Confirm', async () => { await b.net(); await b.click('#doChange', 1800); return b.net() }, { shotName: 'after-confirm' })
      await step('ending', 'plan afterwards (API)', () => planOf(a, a.personal).then((p) => ({ level: p.level, cancel_at_period_end: p.cancel_at_period_end })))
      await go(a, a.personal)
      await step('ending', 'pressed « Downgrade to Free » (leaves for the portal)', async () => { await sheet(); await b.click('#plans [data-choose="free"]', 2000) }, { shotName: 'portal-lands' })
      await step('ending', 'pressed « Keep the subscription » on the stand-in portal', async () => { await b.click('#r', 1500); return planOf(a, a.personal).then((p) => ({ cancel_at_period_end: p.cancel_at_period_end })) }, { shotName: 'portal-kept' })
      await step('ending', 'back to the Plan page', async () => { await go(a, a.personal) }, { shotName: 'after-resume' })
    }
    // F5: a failed payment: the banner's button, the plan change that is refused, then the payment is settled.
    {
      const a = await person('f5'); const sub = await buy(a, a.personal, { plan: 'solo', component: 'solo', interval: 'month' })
      await provider(sub, { status: 'past_due' }); await settle(a, a.personal, (p) => p && p.payment_blocked === true, 'past due')
      await go(a, a.personal)
      await step('pastdue', 'sheet, « Choose PRO », Confirm', async () => { await sheet(); await b.click('#plans [data-choose="studio"]'); await b.net(); await b.click('#doChange', 1500); return b.net() }, { shotName: 'refused', dialog: '.dialog' })
      await step('pastdue', 'pressed the button that replaced Confirm (leaves for the portal)', () => b.click('#doChange', 2000), { shotName: 'portal-lands' })
      await go(a, a.personal)
      await step('pastdue', 'pressed « Open the billing portal » in the banner', () => b.click('#payPortal', 2000), { shotName: 'banner-portal' })
      await provider(sub, { status: 'active', paid: true }); await settle(a, a.personal, (p) => p && p.payment_blocked === false, 'paid')
      await step('pastdue', 'after the payment is settled', async () => { await go(a, a.personal) }, { shotName: 'settled' })
    }
    // F6: a monthly team looks at yearly billing; F7: a team with no plan buys seats (read, then Cancel).
    {
      const o = await person('f6o'); const t = await team(o, 'Month Team'); await buy(o, t.id, { plan: 'team', component: 'band:0', quantity: 2, interval: 'month' })
      await go(o, t.id)
      await step('team-interval', 'sheet, pressed « Annual »', async () => { await sheet(); await b.click('[data-interval="year"]'); return b.ev(`document.querySelector('#switchTeam').innerText + ' | disabled ' + document.querySelector('#switchTeam').disabled`) }, { shotName: 'annual', dialog: '.dialog' })
      await step('team-interval', 'pressed that button', () => b.click('#switchTeam'), { shotName: 'dialog', dialog: '.dialog' })
      await step('team-interval', 'Cancel', () => b.click('#mCancel'))
      const n = await person('f7o'); const t2 = await team(n, 'Empty Team'); await go(n, t2.id)
      await step('team-none', 'sheet, pressed « Buy 2 seats »', async () => { await sheet(); await b.click('#switchTeam') }, { shotName: 'buy', dialog: '.dialog' })
      await step('team-none', 'Cancel', () => b.click('#mCancel'))
      await step('team-none', 'pressed « + Add budget » (disabled until seats are bought)', () => b.click('#buyBtn', 900), { shotName: 'add-budget-disabled' })
    }
  } finally { b.close() }
  results.flows.push(...rec)
}

async function flows () {
  for (const lang of LANGS) for (const width of WIDTHS) { if (FLOW_COMBOS.length && !FLOW_COMBOS.includes(`${lang}-${width}`)) continue; try { await flowsFor(lang, width) } catch (e) { check(`flows ${lang}-${width}`, false, e.stack || e.message) } }
  writeFileSync(join(OUT, FLOW_COMBOS.length ? `flows-${FLOW_COMBOS.join('+')}.json` : 'flows.json'), JSON.stringify(results.flows, null, 2))
}

async function main () {
  console.log(`J06-10 Plan page states on ${S.e.api}; languages ${LANGS.join(',')}, widths ${WIDTHS.join(',')}`)
  const wanted = FLOWS_ONLY ? [] : Object.keys(STATES).filter((k) => only.length === 0 || only.includes(k))
  const built = {}
  for (const k of wanted) {
    try { built[k] = await STATES[k](); const p = await planOf(built[k].viewer, built[k].ws); results.states[k] = { what: built[k].what, ws: built[k].ws, api: p }; check(`state ${k} reached`, true, `${built[k].what}: status ${p.status}, level ${p.level}, seats ${p.seats}, interval ${p.interval}, cancel_at_period_end ${p.cancel_at_period_end}, payment_blocked ${p.payment_blocked}`) } catch (e) { check(`state ${k} reached`, false, e.message) }
  }
  if (!FLOWS_ONLY) writeFileSync(join(OUT, 'states.json'), JSON.stringify(results.states, null, 2))
  for (const lang of LANGS) {
    for (const width of WIDTHS) {
      const b = await browser({ width, height: width < 600 ? 844 : 900, lang })
      try {
        for (const k of wanted) { if (built[k]) await view(b, built[k], k, lang, width) }
      } finally { b.close() }
    }
  }
  if (!FLOWS_ONLY) writeFileSync(join(OUT, 'views.json'), JSON.stringify(results, null, 2))
  if (FLOWS) await flows()
  console.log(failed ? `\n${failed} check(s) failed` : '\nall states reached and read')
  process.exit(failed ? 1 : 0)
}
main().catch((e) => { console.error(String(e && e.stack || e)); process.exit(1) })

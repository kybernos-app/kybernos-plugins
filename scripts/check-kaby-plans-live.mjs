#!/usr/bin/env node
// J14-12: Kaby on a Free account with no credit, on Plus and on Pro. Per account, in the real GUI of a sandbox signed in to a replica: the plan and credit the server holds, Kaby's strip and
// its « Set up… » panel, the four tabs of Settings › Kaby, and what happens when the person writes to Kaby (the reply, or the failure and what it says and offers).
//
//   export KB_E2E_API=… KB_E2E_WEB=… KB_E2E_CONTROL=… KB_E2E_DIR=… KB_SERVER_DIR=…        (a replica made by scripts/user-journey-replica.sh)
//   export KB_PROXY_LOG=<file of scripts/recording-proxy.mjs in front of the replica>        (the sandbox DSH talks to the proxy; its log tells which status the model route answered)
//   KB_SANDBOX_ROOT=… KB_SANDBOX_PORT=… source scripts/sandbox/env.sh                       (a sandbox started with KYBERNOS_CLOUD_API = that proxy)
//   node scripts/check-kaby-plans-live.mjs [--out <folder>] [--accounts f0,p,r]
//
// KB_E2E_DIR/accounts.json holds the made-up accounts: f0 (Free, no credit), p (Plus), r (Pro). The sandbox is paired to each in turn with scripts/e2e-connect.mjs. The model is the
// replica's stand-in (it answers one fixed sentence when the server lets the call through): what is tested is the product around it, not a model. Sandbox only: it refuses :3080 (exit 3)
// and any DSH home that is not under .kybernos-sandbox. A check is `ok` when the measured fact is the one written in its name. Exit 0 = every check passed, 1 = a check failed,
// 3 = wrong environment. Report: <out>/report.json.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { cookieDeSession } from './cdp-lib.mjs'
import { makeServer, readAccounts } from './lib-e2e-server.mjs'
import { openGui, readProxy, sleep } from './lib-e2e-gui.mjs'
import { openSettings, goToSettingsPage } from './live-page.mjs'

const arg = (n, d) => (process.argv.indexOf(n) >= 0 ? process.argv[process.argv.indexOf(n) + 1] : d)
const host = process.env.KB_HOST || ''
const home = process.env.DSH_HOME || ''
if (host === '' || /:3080$/.test(host) || !home.includes('.kybernos-sandbox')) { console.error('not run: source scripts/sandbox/env.sh of a sandbox first (KB_HOST=' + host + ')'); process.exit(3) }
if (!process.env.KB_E2E_API || !process.env.KB_E2E_DIR || !process.env.KB_PROXY_LOG) { console.error('not run: KB_E2E_* and KB_PROXY_LOG are not set'); process.exit(3) }
const out = arg('--out', join(process.env.KB_E2E_DIR, '..', 'j14-12'))
const wanted = arg('--accounts', 'f0,p,r').split(',')
mkdirSync(out, { recursive: true })
const S = makeServer()
const acc = readAccounts(S.e)
if (!wanted.every((k) => acc[k] && acc[k].email)) { console.error('not run: accounts.json needs ' + wanted.join(', ')); process.exit(3) }
const c = cookieDeSession(host)
if (c === null) { console.error('not run: no browser-session secret for this DSH_HOME'); process.exit(3) }
const results = []
const report = {}
const check = (name, ok, detail) => { results.push({ name, ok: ok === true, detail }); console.log((ok === true ? '  ok   ' : '  FAIL ') + name + (ok === true || detail === undefined ? '' : '  -> ' + JSON.stringify(detail).slice(0, 300))); return ok === true }
const note = (t) => console.log('  ..   ' + t)
const hostCall = async (method, path, body) => { const r = await fetch('http://' + host + path, { method, headers: { 'content-type': 'application/json', cookie: c.nom + '=' + c.valeur, origin: 'http://' + host }, body: method === 'GET' ? undefined : JSON.stringify(body || {}) }); const t = await r.text(); try { return JSON.parse(t) } catch (e) { return { raw: t.slice(0, 200) } } }
const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim()
const here = fileURLToPath(new URL('.', import.meta.url))
const pair = (who) => spawnSync(process.execPath, [join(here, 'e2e-connect.mjs'), '--dsh', host, '--account', who, '--force'], { env: process.env, encoding: 'utf8', timeout: 90000 })
const kabyNav = async (g) => { const p = await g.val(`(() => { const e = Array.from(document.querySelectorAll('*')).filter((e) => e.children.length === 0 && (e.innerText || '').trim() === 'Kaby').find((e) => e.getBoundingClientRect().top < 200); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`); if (!p || p.err) return false; await g.mouse(p.x, p.y); await sleep(3000); return true }

for (const who of wanted) {
  console.log('\n== ' + who + ' (' + acc[who].name + ')')
  const r = { who }
  report[who] = r
  const paired = pair(who)
  check(who + ': the sandbox is signed in as that account', /connected: true/.test(paired.stdout || ''), (paired.stdout || paired.stderr || '').slice(0, 200))
  if (!/connected: true/.test(paired.stdout || '')) continue
  await sleep(2500)
  // ── what the server holds ────────────────────────────────────────────────────────────────────────────────────────────────
  const st = await hostCall('GET', '/kybernos-cloud/status')
  const me = await S.signIn(acc[who].email, acc[who].password)
  const wsList = await S.call('GET', '/v1/workspaces', { cookie: me.cookie })
  const personal = ((wsList.body && (wsList.body.workspaces || wsList.body)) || []).find((w) => w.personal === true) || ((wsList.body && (wsList.body.workspaces || wsList.body)) || [])[0]
  const plan = personal ? await S.call('GET', `/v1/workspaces/${personal.id}/plan`, { cookie: me.cookie }) : null
  r.server = { plan: plan && plan.body && plan.body.plan && plan.body.plan.key, kind: plan && plan.body && plan.body.plan && plan.body.plan.kind, level: plan && plan.body && plan.body.level, features: plan && plan.body && plan.body.features, display: plan && plan.body && plan.body.display, models: st.state && st.state.models && st.state.models.ids }
  note('the server holds ' + JSON.stringify({ plan: r.server.plan, level: r.server.level, features: (r.server.features || []).length, models: r.server.models }))
  const g = await openGui(host)
  try {
    await sleep(3000)
    r.card = (await g.card() || {}).text
    note('the account card says ' + JSON.stringify(r.card))
    // ── Kaby's strip and « Set up… » ────────────────────────────────────────────────────────────────────────────────────────
    check(who + ': Kaby\'s chat opens from the sidebar', await kabyNav(g))
    const strip = await g.val(`(() => { const e = Array.from(document.querySelectorAll('*')).find((x) => x.children.length === 0 && (x.innerText || '').trim() === 'Remote control · ready' || /^Remote control/.test((x.innerText || '').trim())); let box = e; for (let i = 0; i < 4 && box && box.parentElement; i += 1) { box = box.parentElement; if ((box.innerText || '').includes('Set up')) break } const rr = box ? box.getBoundingClientRect() : null; return box ? { text: (box.innerText || '').replace(/\\s+/g, ' ').trim(), rect: [Math.round(rr.left), Math.round(rr.top), Math.round(rr.width), Math.round(rr.height)] } : null })()`)
    r.strip = strip
    note('Kaby\'s strip says ' + JSON.stringify(strip))
    await g.shot(join(out, who + '-1-kaby.png'))
    if (await g.pressText('Set up…')) {
      await sleep(1500)
      r.setup = clean(await g.body()).slice(-900)
      await g.shot(join(out, who + '-2-setup.png'))
      note('« Set up… » shows ' + JSON.stringify(r.setup.slice(-500)))
      await g.key('Escape', 'Escape', 27); await sleep(500)
    }
    // ── writing to Kaby ──────────────────────────────────────────────────────────────────────────────────────────────────────
    await g.selectModel('GLM').catch((e) => note('model: ' + e.message))
    const t0 = Date.now()
    await g.send('Hello Kaby, what can you do for me today? (' + who + ')')
    await sleep(9000)
    await g.shot(join(out, who + '-3-after-send.png'))
    const calls = readProxy(process.env.KB_PROXY_LOG, t0).filter((x) => x.method === 'POST' && x.path === '/v1/chat/completions')
    r.modelCalls = calls.map((x) => x.status)
    const page = clean(await g.body())
    r.afterSend = page.slice(-700)
    const failed = /This turn failed|Failed/.test(page.slice(-900))
    const toast = await g.val(`Array.from(document.querySelectorAll('[role="status"], [role="alert"], [class*="toast"], [class*="Toast"]')).map((e) => (e.innerText || '').replace(/\\s+/g, ' ').trim()).filter(Boolean)`)
    r.toast = toast
    const next = await g.val(`Array.from(document.querySelectorAll('button, a')).map((b) => (b.innerText || '').replace(/\\s+/g, ' ').trim()).filter((t) => /plan|credit|upgrade|top.?up|billing/i.test(t))`)
    r.nextSteps = next
    note('model route answered ' + JSON.stringify(r.modelCalls) + '; the page says ' + JSON.stringify(page.slice(-400)) + '; toast ' + JSON.stringify(toast) + '; buttons ' + JSON.stringify(next))
    // ── Settings › Kaby, its four tabs ────────────────────────────────────────────────────────────────────────────────────────
    if (await openSettings(g.page) && await goToSettingsPage(g.page, /^Kaby/)) {
      await sleep(1500)
      r.tabs = {}
      for (const tab of ['Identity & voice', 'Video calls', 'Work', 'Permissions']) {
        const pressed = await g.pressText(tab)
        await sleep(1200)
        const text = await g.val(`(() => { const t = Array.from(document.querySelectorAll('*')).find((e) => e.children.length === 0 && (e.innerText || '').trim() === 'Close' ); const all = (document.body.innerText || '').replace(/\\s+/g, ' '); const at = all.lastIndexOf('Identity & voice'); return all.slice(at, at + 2600) })()`)
        r.tabs[tab] = { pressed, text }
        await g.shot(join(out, who + '-4-settings-' + tab.replace(/\W+/g, '-').toLowerCase() + '.png'))
      }
      const planWords = (t) => (String(t).match(/\b(upgrade|Plus|Pro|Free|plan|credit|paid|limit|allowance|subscription)\b/gi) || []).map((x) => x.toLowerCase())
      r.planWordsInSettings = Object.fromEntries(Object.entries(r.tabs).map(([k, v]) => [k, [...new Set(planWords(v.text))]]))
      note('plan words in Settings › Kaby: ' + JSON.stringify(r.planWordsInSettings))
    } else check(who + ': Settings › Kaby opens', false)
  } catch (e) {
    check(who + ': the walk reached its end', false, String((e && e.stack) || e).slice(0, 400))
  } finally {
    try { await g.close() } catch (e) { /* page gone */ }
  }
  if (who === 'f0') {
    check('f0 (Free, no credit): the model route refuses the turn with 402', (r.modelCalls || []).includes(402), r.modelCalls)
    check('f0: the page says the credit is used up and offers a next step (a button or link naming the plan or credits)', /credit is used up/i.test(r.afterSend || '') && (r.nextSteps || []).length > 0, { page: (r.afterSend || '').slice(-300), nextSteps: r.nextSteps })
    // « This turn failed » and the sentence after it are two inline elements: innerText joins them with no space ("failedYour") but they sit side by side on screen (f0-3-after-send.png), so no check is made on that join.
  } else {
    check(who + ': the model route lets the turn through (200) and Kaby answers', (r.modelCalls || []).includes(200) && /stand-in model/.test(r.afterSend || ''), { calls: r.modelCalls, page: (r.afterSend || '').slice(-200) })
  }
}
// what differs between the plans, side by side
if (report.f0 && report.p && report.r) {
  const stripOf = (k) => report[k].strip && report[k].strip.text
  const sameStrip = stripOf('f0') === stripOf('p') && stripOf('p') === stripOf('r')
  report.compare = { sameStrip, strips: { f0: stripOf('f0'), p: stripOf('p'), r: stripOf('r') } }
  note('Kaby\'s strip is ' + (sameStrip ? 'the same' : 'not the same') + ' on the three accounts: ' + JSON.stringify(report.compare.strips))
  const sameTabs = ['Identity & voice', 'Video calls', 'Work', 'Permissions'].every((t) => report.f0.tabs && report.p.tabs && report.r.tabs && report.f0.tabs[t].text === report.p.tabs[t].text && report.p.tabs[t].text === report.r.tabs[t].text)
  report.compare.sameSettingsTabs = sameTabs
  check('the four tabs of Settings › Kaby read the same on Free, Plus and Pro (nothing says what a plan changes)', sameTabs === true, Object.fromEntries(['f0', 'p', 'r'].map((k) => [k, report[k].planWordsInSettings])))
}
writeFileSync(join(out, 'report.json'), JSON.stringify({ at: new Date().toISOString(), results, ...report }, null, 2))
const bad = results.filter((r) => !r.ok)
console.log('\n' + (results.length - bad.length) + '/' + results.length + ' ok; report ' + join(out, 'report.json'))
process.exit(bad.length === 0 ? 0 : 1)

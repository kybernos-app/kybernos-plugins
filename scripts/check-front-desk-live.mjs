#!/usr/bin/env node
// The « Front desk » page (kybernos-front-desk) on the REAL GUI of a SANDBOX, with the real service behind it: the menu row, the Setup tab (what is missing, the model saved and never
// echoed, Start, Running, the links), a visitor writing to the service and the conversation showing in the framed Inbox, the framed Atelier, Stop, then French, a phone width and the page's own
// errors. The model is a small fake OpenAI-compatible server this script runs (no key, no cost); nothing leaves the machine.
//
//   source scripts/sandbox/env.sh && scripts/sandbox/start.sh && node scripts/check-front-desk-live.mjs [--shots <dir>]
//
// SANDBOX ONLY (exit 3 against :3080 and without a sandbox DSH_HOME). It starts from an empty front desk (the sandbox's own `kybernos/front-desk` folder is emptied first) and stops the
// service it started. --shots <dir>: one PNG per state (kept outside git: media never go in the repository).
// Exit code: 0 all green, 1 a check failed, 3 not run.
import http from 'node:http'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { cookieDeSession } from './cdp-lib.mjs'
import { clickText, openLivePage } from './live-page.mjs'

const args = process.argv.slice(2)
const shotsDir = args.indexOf('--shots') >= 0 ? args[args.indexOf('--shots') + 1] : null
if (shotsDir !== null) mkdirSync(shotsDir, { recursive: true })
const host = process.env.KB_HOST || ''
const dshHome = process.env.DSH_HOME || ''
if (host === '' || /:3080$/.test(host)) { console.error('○ not run: sandbox only. `source scripts/sandbox/env.sh` first (KB_HOST is "' + host + '")'); process.exit(3) }
if (!dshHome.includes('.kybernos-sandbox')) { console.error('○ not run: DSH_HOME is not a sandbox\'s (' + dshHome + ')'); process.exit(3) }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail).slice(0, 500))) }
}

const cookie = cookieDeSession(host)
if (cookie === null) { console.error('○ not run: the sandbox\'s session secret is unreadable'); process.exit(3) }
const headers = { cookie: cookie.nom + '=' + cookie.valeur }
const get = async (path) => { const r = await fetch('http://' + host + path, { headers }); let json = null; try { json = await r.json() } catch (e) { json = null } return { status: r.status, json } }
const alive = await fetch('http://' + host + '/kybernos-front-desk/state', { headers }).catch(() => null)
if (alive === null || alive.status !== 200) { console.error('○ not run: the sandbox does not serve the plugin on ' + host + ' (status ' + (alive && alive.status) + '; scripts/sandbox/setup.sh then start.sh)'); process.exit(3) }

// ── a fresh front desk, and a fake model ──────────────────────────────────────────────────────────────────────────────────────────────────────
const stateDir = join(dshHome, 'kybernos', 'front-desk')
const stopByPid = async () => {
  try { const { pid } = JSON.parse(readFileSync(join(stateDir, 'service.pid'), 'utf8')); process.kill(pid, 'SIGTERM'); await sleep(700) } catch (e) { /* nothing running */ }
}
await get('/kybernos-front-desk/state')
await fetch('http://' + host + '/kybernos-front-desk/stop', { method: 'POST', headers: { ...headers, 'content-type': 'application/json', origin: 'http://' + host }, body: '{}' }).catch(() => null)
await stopByPid()
rmSync(stateDir, { recursive: true, force: true })

const modelCalls = []
const model = http.createServer((req, res) => {
  const chunks = []
  req.on('data', (c) => chunks.push(c))
  req.on('end', () => {
    modelCalls.push({ url: req.url, auth: req.headers.authorization })
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'Hello from the fake model.' }, finish_reason: 'stop' }], usage: { prompt_tokens: 60, completion_tokens: 8, total_tokens: 68 } }))
  })
})
await new Promise((r) => model.listen(0, '127.0.0.1', r))
const modelUrl = 'http://127.0.0.1:' + model.address().port + '/v1'
const KEY = 'sk-live-check-0123456789abcdef'

const live = await openLivePage({ width: 1500, height: 950 }).catch((e) => { console.error('○ not run: ' + e.message); model.close(); process.exit(3) })
const { page } = live
await page.send('Runtime.enable', {})
const ev = async (js, ms) => { const r = await page.evalJs(js, ms || 10000); return r.err ? { err: r.err } : r.val }
const shot = async (name) => { if (shotsDir !== null) { try { await page.shot(join(shotsDir, name + '.png')) } catch (e) { console.log('     (no screenshot ' + name + ': ' + e.message + ')') } } }
const kb = (name, extra = '') => `[data-kb="${name}"]${extra}`
const count = (sel) => ev(`document.querySelectorAll(${JSON.stringify(sel)}).length`)
const exists = async (sel) => (await count(sel)) > 0
const textOf = (sel) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return e === null ? null : e.innerText })()`)
const valueOf = (sel) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return e === null ? null : e.value })()`)
const rect = (sel) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (e === null) return null; const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, shown: r.width > 0 && r.height > 0 } })()`)
const click = async (sel, wait = 350) => {
  await ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (e !== null) e.scrollIntoView({ block: 'nearest', behavior: 'instant' }); return 1 })()`)
  await sleep(150)
  const r = await rect(sel)
  if (r === null || r.err || r.shown !== true) return false
  const x = r.x + r.w / 2
  const y = r.y + r.h / 2
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
  await sleep(wait)
  return true
}
const type = async (sel, s) => {
  await ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.focus(); e.select && e.select(); return 1 })()`)
  await page.send('Input.insertText', { text: s })
  await sleep(200)
}
const until = async (fn, ms = 8000) => { const end = Date.now() + ms; let last; while (Date.now() < end) { last = await fn(); if (last) return last; await sleep(200) } return last }
const overflow = () => ev('document.documentElement.scrollWidth - document.documentElement.clientWidth')
const frameText = (name) => ev(`(() => { const f = document.querySelector('[data-kb="${name}"]'); try { return f && f.contentDocument && f.contentDocument.body ? f.contentDocument.body.innerText : null } catch (e) { return 'BLOCKED' } })()`)
await ev(`window.__errs = []; window.addEventListener('error', (e) => window.__errs.push(String(e.message))); window.addEventListener('unhandledrejection', (e) => window.__errs.push(String(e.reason))); 1`)

let serviceStarted = false
try {
  // ── the menu row and the page ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
  console.log('the menu row and the page')
  const row = await until(async () => (await ev(`document.body.innerText.includes('Front desk') ? 1 : 0`)) === 1, 15000)
  check('the « Front desk » row is in the menu (Business group)', row === true)
  await ev(`window.__KB_OPEN__ && window.__KB_OPEN__({ view: 'front-desk' }); 1`)
  const opened = await until(() => exists(kb('front-desk-page')), 10000)
  if (!opened) { await clickText(page, 'Front desk'); await sleep(800) }
  check('the page opens', await until(() => exists(kb('front-desk-page')), 8000) === true)
  check('the title and the stopped pill', (await until(() => exists(kb('fd-pill')))) === true && /Front desk/.test(await textOf('.kbfd-title') || '') && /Stopped/.test(await textOf(kb('fd-pill')) || ''), await textOf(kb('front-desk-page')))
  check('Start is there but disabled: nothing to run without a model', await ev(`document.querySelector('[data-kb="fd-start"]').disabled`) === true)
  check('what is missing is named', /model address|model name|model key/.test(await textOf(kb('fd-missing')) || ''), await textOf(kb('fd-missing')))
  check('the Help button of the Suite sits by the title, or the description is under it', (await count('.kbfd-titlerow > *')) >= 2 && (/step in|answers/.test(await textOf(kb('front-desk-page')) || '') || (await count('.kbfd-titlerow button')) >= 1))
  await shot('01-setup-stopped')
  check('the Atelier tab with nothing running says so and sends to Setup', await click(kb('fd-tab', '[data-tab="atelier"]')) && await exists(kb('fd-stopped')) && await exists(kb('fd-go-setup')))
  await shot('02-atelier-stopped')
  check('« Go to Setup » goes back', await click(kb('fd-go-setup')) && await exists(kb('fd-setup')))

  // ── the model ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  console.log('the model')
  await type(kb('fd-model-url'), modelUrl)
  await type(kb('fd-model-name'), 'fake-model')
  await type(kb('fd-model-key'), KEY)
  await click(kb('fd-model-save'), 600)
  check('saved, and said so', /Saved/.test(await textOf(kb('fd-saved')) || ''), await textOf(kb('fd-model')))
  const afterSave = (await get('/kybernos-front-desk/state')).json
  check('the host knows a key exists, and does not hand it back anywhere', afterSave.secrets.modelKey === true && !JSON.stringify(afterSave).includes(KEY) && afterSave.config.model.baseUrl === modelUrl)
  check('the key box was emptied after saving', await valueOf(kb('fd-model-key')) === '')
  check('the key is nowhere in the page', !(await ev('document.documentElement.outerHTML')).includes(KEY))
  check('nothing is missing any more: Start is enabled', await until(async () => (await ev(`document.querySelector('[data-kb="fd-start"]').disabled`)) === false, 8000) === true)
  const bad = await (async () => { await type(kb('fd-public-url'), 'not a url'); await click(kb('fd-public-save'), 500); return textOf(kb('fd-error')) })()
  check('a bad public address says what is wrong, in words', /full web address/.test(bad || ''), bad)
  await type(kb('fd-public-url'), 'https://front.shop.example')
  await click(kb('fd-public-save'), 500)
  check('a good public address is saved', /Saved/.test(await textOf(kb('fd-saved')) || ''))
  await shot('03-model-saved')

  // ── start ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  console.log('start')
  await click(kb('fd-start'), 300)
  serviceStarted = true
  check('Running shows up', await until(async () => /Running/.test(await textOf(kb('fd-pill')) || ''), 25000) === true, await textOf(kb('fd-pill')))
  check('Stop replaces Start, in the card and in the head', await exists(kb('fd-stop')) && await exists(kb('fd-head-stop')) && !(await exists(kb('fd-start'))))
  const st = (await get('/kybernos-front-desk/state')).json
  check('the shop is made from the starter fiche, with its two links', st.shop && st.shop.slug === 'my-shop' && /\/c\/my-shop$/.test(st.localLink || '') && st.publicLink === 'https://front.shop.example/c/my-shop', st)
  check('the links card shows the public link and a snippet that points at the public address', (await valueOf(kb('fd-link'))) === 'https://front.shop.example/c/my-shop' && /front\.shop\.example\/widget\.js/.test(await valueOf(kb('fd-snippet')) || ''))
  await shot('04-running')
  check('the service answers on its local link', (await fetch(st.localLink)).status === 200)
  check('the local link has a CSP that forbids inline scripts', /script-src 'nonce-/.test((await fetch(st.localLink)).headers.get('content-security-policy') || ''))

  // ── a visitor ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  console.log('a visitor')
  const base = st.localLink.replace(/\/c\/my-shop$/, '')
  const visitorId = 'abcdef0123456789abcdef0123456789'
  const talk = await fetch(base + '/c/my-shop/messages', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ visitorId, text: 'Do you ship to Japan?' }) })
  const said = await talk.json().catch(() => ({}))
  check('a visitor message gets the model\'s answer, through the real service', talk.status === 200 && said.ok === true && /fake model/.test(said.reply || ''), said)
  check('the fake model was really called, with the assistant\'s own key', modelCalls.length >= 1 && modelCalls[0].url === '/v1/chat/completions' && modelCalls[0].auth === 'Bearer ' + KEY)
  const shell = await (await fetch(base + '/boite')).text()
  check('with no owner token the service gives the owner pages as an empty shell: no conversation in it, and every API route answers 401', (await fetch(base + '/api/overview')).status === 401 && (await fetch(base + '/api/studio')).status === 401 && (await fetch(base + '/api/conversations')).status === 401 && !/Japan/.test(shell))

  // ── the framed pages ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  console.log('the framed pages')
  await click(kb('fd-tab', '[data-tab="boite"]'), 600)
  check('the Inbox is framed, from this plugin\'s own route', await until(() => exists(kb('fd-frame-boite'))) === true && /\/kybernos-front-desk\/boite$/.test(await ev(`document.querySelector('[data-kb="fd-frame-boite"]').src`) || ''))
  const inbox = await until(async () => { const t = await frameText('fd-frame-boite'); return t && /Japan/.test(t) ? t : null }, 10000)
  check('the framed Inbox shows the visitor\'s conversation (the page works through the plugin: relative API, token added by the host)', !!inbox && inbox !== 'BLOCKED', await frameText('fd-frame-boite'))
  await shot('05-inbox')
  await click(kb('fd-tab', '[data-tab="atelier"]'), 600)
  const atelier = await until(async () => { const t = await frameText('fd-frame-atelier'); return t && /Live|En ligne|version/i.test(t) ? t : null }, 10000)
  check('the framed Atelier loads and shows the live version', !!atelier && atelier !== 'BLOCKED', await frameText('fd-frame-atelier'))
  await shot('06-atelier')
  check('the framed page cannot be embedded by another origin (frame-ancestors from the service)', /frame-ancestors/.test((await fetch('http://' + host + '/kybernos-front-desk/atelier', { headers })).headers.get('content-security-policy') || ''))
  const badge = await until(async () => (await ev(`(() => { const b = document.querySelector('[data-kb="fd-badge"]'); return b === null ? 0 : Number(b.innerText) })()`)) >= 0, 3000)
  check('the Inbox badge does not break the tab bar', badge === true)

  // ── French and a phone ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  console.log('French and a phone width')
  await click(kb('fd-tab', '[data-tab="setup"]'), 400)
  await ev(`window.__KB_LANG_RESOLVE__ = () => 'fr'; 1`)
  await click(kb('fd-tab', '[data-tab="atelier"]'), 300)
  await click(kb('fd-tab', '[data-tab="setup"]'), 500)
  const fr = await textOf(kb('front-desk-page'))
  check('the page speaks French when the language is French', /Accueil client/.test(fr || '') && /Réglages/.test(fr || '') && /En marche/.test(fr || '') && /Arrêter/.test(fr || ''), fr && fr.slice(0, 200))
  check('in « tu », never « vous »', !/\bvous\b|\bvotre\b/i.test(fr || ''))
  await shot('07-setup-fr')
  await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 800, deviceScaleFactor: 2, mobile: true })
  await sleep(700)
  check('at phone width the page does not scroll sideways', (await overflow()) <= 1, await overflow())
  check('…and the tabs and the buttons are still reachable', (await rect(kb('fd-tab', '[data-tab="boite"]'))).shown === true)
  await shot('08-setup-phone')
  await page.send('Emulation.clearDeviceMetricsOverride', {})
  await ev(`window.__KB_LANG_RESOLVE__ = () => 'en'; 1`)
  await sleep(400)

  // ── stop ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  console.log('stop')
  await click(kb('fd-tab', '[data-tab="setup"]'), 400)
  await click(kb('fd-head-stop'), 300)
  check('Stopped shows up', await until(async () => /Stopped/.test(await textOf(kb('fd-pill')) || ''), 15000) === true, await textOf(kb('fd-pill')))
  serviceStarted = false
  check('the service is really gone', await fetch(st.localLink).then(() => false, () => true))
  check('a framed page with no service says so', await click(kb('fd-tab', '[data-tab="boite"]')) && await exists(kb('fd-stopped')))
  await shot('09-stopped-again')
  check('the page raised no error', (await ev('window.__errs.length')) === 0, await ev('window.__errs'))
} catch (e) {
  check('the run went to the end', false, e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : String(e))
} finally {
  if (serviceStarted) {
    await fetch('http://' + host + '/kybernos-front-desk/stop', { method: 'POST', headers: { ...headers, 'content-type': 'application/json', origin: 'http://' + host }, body: '{}' }).catch(() => null)
    await stopByPid()
  }
  model.close()
  await live.close()
}
console.log('\nFRONT DESK LIVE — ' + pass + ' ok, ' + fail + ' failed' + (shotsDir !== null ? ' (shots in ' + shotsDir + ')' : ''))
process.exit(fail === 0 ? 0 : 1)

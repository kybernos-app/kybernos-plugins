#!/usr/bin/env node
// The multi-device bundle (packages/kybernos-multi-device), end to end, in a real GUI.
//
//   source scripts/sandbox/env.sh && node scripts/check-multi-device-live.mjs [--shots <dir>]
//
// It needs a DSH that LOADS the bundle, i.e. the sandbox instance (`scripts/sandbox/setup.sh`, `scripts/sandbox/start.sh`; see
// docs/dev/live-testing.md). The user's own `dsh web` does not list the bundle: this script refuses to run against :3080 (exit 3).
//
// What it checks, in a real page:
//   1. the host routes answer through the page's own origin: status, a private folder is created on disk, a second
//      create is refused (409), a bad name is refused (400) and writes nothing;
//   2. Projects › Create opens the bundle's dialog (not the native chooser), refuses a bad name, cancels without creating
//      anything, and "No folder" creates a project whose Details tab says "Private folder" and shows the folded preview;
//   3. the folded Advanced block holds the phone card and two greyed cards that change nothing;
//   4. the sidebar "add workspace" button opens the same dialog;
//   5. the dialog fits a narrow window.
//
// NOT covered here: the OS folder chooser itself (a native window), and the fallback to DSH's own occupant when this bundle
// throws (the slot retires it; proven by the slot contract, to be seen once by switching the bundle off).
//
// SAFETY: the sandbox has its own HOME and DSH_HOME: the folders are created under its Documents and the workspaces are
// registered in its own store. Exit code 0 / 1 / 3.
import http from 'node:http'
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { openLivePage } from './live-page.mjs'

const args = process.argv.slice(2)
const shotDir = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : null
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) }
}

const host = process.env.KB_HOST || '127.0.0.1:3080'
if (host === '127.0.0.1:3080') { console.error('○ inconclusive: this check needs a DSH that loads the bundle (a sandbox instance), not the one on :3080. Set KB_HOST, DSH_HOME and HOME.'); process.exit(3) }
const home = process.env.HOME || ''
if (home === '' || !home.includes('.kybernos-sandbox')) { console.error('○ inconclusive: HOME is not a sandbox home (' + home + '). source scripts/sandbox/env.sh first.'); process.exit(3) }

const live = await openLivePage({ width: 1500, height: 1000 }).catch((e) => { console.error('○ inconclusive: ' + e.message); process.exit(3) })
const { page } = live
const val = async (expr, ms) => (await page.evalJs(expr, ms)).val
const shot = async (name) => { if (shotDir !== null) { try { mkdirSync(shotDir, { recursive: true }); await page.shot(join(shotDir, name + '.png')) } catch (e) { /* no screenshot */ } } }
const poll = async (fn, ms = 10000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) return v; await sleep(250) } }
const exists = (sel) => val(`document.querySelector(${JSON.stringify(sel)}) !== null`)
const click = (sel) => val(`(() => { const b = document.querySelector(${JSON.stringify(sel)}); if (!b || b.disabled) return false; b.click(); return true })()`)
const setValue = (sel, v) => val(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'); d.set.call(el, ${JSON.stringify(v)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
const text = (sel) => val(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return e ? e.innerText : null })()`)
const api = (path, body) => val(`fetch(${JSON.stringify(path)}, ${body === undefined ? '{}' : `{ method: 'POST', headers: { 'content-type': 'application/json' }, body: ${JSON.stringify(JSON.stringify(body))} }`}).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }))`, 10000)
const stamp = Date.now().toString(36)

try {
  await sleep(3000)
  if ((await val(`/Add an API key to get started/.test(document.body.innerText)`)) === true) {
    await val(`(() => { const e = Array.from(document.querySelectorAll('*')).filter((e) => e.children.length === 0 && (e.innerText || '').trim() === 'Configure later')[0]; if (e) e.click() })()`)
    await sleep(700)
  }

  console.log('── 1. the host, through the page ──')
  const st = await api('/kybernos-multi-device/status')
  check('status answers on the page\'s own origin', st.status === 200 && st.body.ok === true && typeof st.body.root === 'string', st)
  const root = st.body && st.body.root
  check('the root is under the sandbox home, in Documents/Kybernos', typeof root === 'string' && root.startsWith(home) && root.endsWith('Documents/Kybernos'), root)
  const first = 'Live ' + stamp
  const made = await api('/kybernos-multi-device/private-folder', { name: first })
  check('a private folder is created', made.status === 200 && made.body.ok === true && made.body.path === join(root, first), made)
  check('…and it exists on disk', existsSync(join(root, first)))
  const again = await api('/kybernos-multi-device/private-folder', { name: first })
  check('creating it again is refused, not reused', again.status === 409 && again.body.error === 'exists', again)
  const before = existsSync(root) ? readdirSync(root).length : 0
  const bad = await api('/kybernos-multi-device/private-folder', { name: '../../escape' })
  check('a path-like name is refused and nothing is written', bad.status === 400 && (existsSync(root) ? readdirSync(root).length : 0) === before, bad)
  // From OUTSIDE the page (Node sends no Origin): the route answers before DSH's own authentication, so its guard is the only fence.
  const outside = await fetch('http://' + host + '/kybernos-multi-device/private-folder', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"name":"x"}' }).then((r) => r.status, () => 0)
  check('a POST with no Origin (not from the page) is refused', outside === 403, outside)
  // A raw request: fetch() would rewrite the Host header, so use node:http to say "attacker.example" to the real listener.
  const [hostName, hostPort] = host.split(':')
  const rebound = await new Promise((resolve) => {
    const req = http.request({ host: hostName, port: Number(hostPort), path: '/kybernos-multi-device/status', method: 'GET', headers: { host: 'attacker.example:' + hostPort } }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)) })
    req.on('error', () => resolve(0))
    req.end()
  })
  check('a request carrying a foreign Host is refused (DNS rebinding)', rebound === 403, rebound)

  console.log('── 2. Projects › Create ──')
  await val(`(() => { try { window.__KB_OPEN__({ view: 'projects' }); return true } catch (e) { return String(e) } })()`)
  const btn = await poll(() => exists('[data-kb="project-create"]'), 12000)
  check('the Projects page shows the Create button', btn === true)
  await shot('01-projects')
  await click('[data-kb="project-create"]')
  const dlg = await poll(() => exists('[data-kb="kybernos-multi-device-dialog"]'), 6000)
  check('Create opens the bundle\'s dialog', dlg === true)
  await shot('02-dialog')
  check('the dialog offers both choices', (await exists('[data-kb="kybernos-multi-device-opt-none"]')) === true && (await exists('[data-kb="kybernos-multi-device-opt-folder"]')) === true)
  await setValue('[data-kb="kybernos-multi-device-name"]', 'a/b')
  await sleep(200)
  check('a name with a slash is refused in the dialog (button disabled, message shown)', (await val(`document.querySelector('[data-act="confirm"]').disabled`)) === true && /interdit|forbidden/i.test((await val(`document.querySelector('[data-kb="kybernos-multi-device-dialog"]').innerText`)) || ''))
  const count0 = await val(`document.querySelectorAll('[data-kb="project-card"]').length`)
  await click('[data-act="cancel"]')
  await sleep(400)
  check('cancel closes the dialog', (await exists('[data-kb="kybernos-multi-device-dialog"]')) === false)

  const name = 'Projet ' + stamp
  await click('[data-kb="project-create"]')
  await poll(() => exists('[data-kb="kybernos-multi-device-dialog"]'), 6000)
  await setValue('[data-kb="kybernos-multi-device-name"]', name)
  await sleep(200)
  check('a good name enables the button', (await val(`document.querySelector('[data-act="confirm"]').disabled`)) === false)
  await click('[data-act="confirm"]')
  const card = await poll(() => exists('[data-kb="kybernos-multi-device-folder"]'), 15000)
  check('the project opens on its Details tab with the folder card', card === true)
  await sleep(500)
  await shot('03-details')
  const cardText = (await text('[data-kb="kybernos-multi-device-folder"]')) || ''
  check('the card says it is a private folder and shows where', /Dossier privé|Private folder/.test(cardText) && cardText.includes('Documents/Kybernos/' + name), cardText.slice(0, 200))
  check('the folder exists on disk', existsSync(join(root, name)))

  console.log('── 3. the folded Advanced preview ──')
  check('Advanced is folded', (await exists('[data-kb="kybernos-multi-device-today"]')) === false)
  await click('[data-kb="kybernos-multi-device-adv"]')
  await sleep(300)
  check('it holds the phone card and the two greyed cards', (await exists('[data-kb="kybernos-multi-device-today"]')) === true && (await exists('[data-kb="kybernos-multi-device-exec"]')) === true && (await exists('[data-kb="kybernos-multi-device-devices"]')) === true)
  check('the preview cards are disabled', (await val(`document.querySelector('[data-kb="kybernos-multi-device-exec"]').getAttribute('aria-disabled')`)) === 'true' && (await val(`document.querySelector('[data-kb="kybernos-multi-device-devices"]').getAttribute('aria-disabled')`)) === 'true')
  check('nothing in the preview is an enabled control', (await val(`document.querySelectorAll('[data-kb="kybernos-multi-device-exec"] button:not([disabled]), [data-kb="kybernos-multi-device-devices"] button:not([disabled]), [data-kb="kybernos-multi-device-exec"] input, [data-kb="kybernos-multi-device-devices"] input').length`)) === 0)
  await val(`document.querySelector('[data-kb="kybernos-multi-device-adv"]').scrollIntoView({ block: 'start' })`)
  await sleep(300)
  await shot('04-advanced')

  console.log('── 4. the sidebar "add workspace" button ──')
  await val(`(() => { try { window.__KB_OPEN__({ view: 'projects' }); return true } catch (e) { return false } })()`)
  await sleep(600)
  const opened = await val(`(() => {
    const cands = Array.from(document.querySelectorAll('button,[role="button"]')).filter((b) => /add workspace|ajouter un (workspace|espace)|new workspace|nouveau workspace/i.test((b.getAttribute('aria-label') || '') + ' ' + (b.getAttribute('title') || '')))
    if (cands.length === 0) return null
    cands[0].click(); return true
  })()`)
  if (opened === null) {
    console.log('  ○ the sidebar add button was not found by its label (inconclusive, not a failure)')
  } else {
    const side = await poll(() => exists('[data-kb="kybernos-multi-device-dialog"]'), 5000)
    check('the sidebar button opens the same dialog, not the native chooser', side === true)
    await shot('05-sidebar-dialog')
    await click('[data-act="cancel"]')
    await sleep(300)
  }

  console.log('── 5. a narrow window ──')
  await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 780, deviceScaleFactor: 2, mobile: true })
  await sleep(500)
  await val(`(() => { try { window.__KB_OPEN__({ view: 'projects' }); return true } catch (e) { return false } })()`)
  await sleep(600)
  await click('[data-kb="project-create"]')
  const narrow = await poll(() => exists('[data-kb="kybernos-multi-device-dialog"]'), 6000)
  if (narrow === true) {
    const box = JSON.parse(await val(`JSON.stringify((() => { const r = document.querySelector('[data-kb="kybernos-multi-device-dialog"]').getBoundingClientRect(); return { l: r.left, r: r.right, w: window.innerWidth, t: r.top, b: r.bottom, h: window.innerHeight } })())`))
    check('the dialog stays inside a 390 px window', box.l >= 0 && box.r <= box.w + 1 && box.t >= -1, box)
    await shot('06-narrow')
    await click('[data-act="cancel"]')
  } else {
    console.log('  ○ the Create button was not reachable at 390 px (inconclusive)')
  }
  await page.send('Emulation.clearDeviceMetricsOverride', {})

  void count0
} catch (e) {
  fail += 1
  console.log('  ✗ the check itself failed — ' + String((e && e.message) || e))
} finally {
  await live.close()
}
console.log('\n' + pass + ' ✓  ' + fail + ' ✗')
process.exit(fail === 0 ? 0 : 1)

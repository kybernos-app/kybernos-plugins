// The phone link as a person lives it, on the REAL GUI of an isolated DSH and 390 px phone browsers, against the bundle's stand-in relay:
//
//   source scripts/sandbox/env.sh      (a sandbox started WITHOUT KYBERNOS_CLOUD_API: the check writes its own server entry)
//   node scripts/check-phone-link-journey-live.mjs --out <folder outside the repository> [--parts pair,cut,many] [--down-seconds 60] [--sim <simulator udid>]
//
//   pair  the QR code and what is written beside it, the pairing in a phone-width browser (and, with --sim, in an iOS simulator's Safari), a message
//         typed on the phone and found in the computer's own session files.
//   cut   the relay stopped for --down-seconds while a phone is paired (both screens are read while it is down, and after it is back), the
//         computer frozen as a sleeping one is (SIGSTOP then SIGCONT of the DSH process: a stand-in for sleep, not sleep), the phone offline
//         (the browser's own offline switch), and the DSH restarted.
//   many  as many phones as the stand-in allows (3, the server's default `remote_max_devices_per_user`) plus one: the refusal is read; a phone is
//         removed from the computer and the phone is read; the phone's own page is searched for a way to leave; a phone is paired again.
//
// The stand-in relay keeps its devices and tickets across a stop (they are copied into the new one), as the server's database would.
// Nothing leaves the machine. SANDBOX ONLY (it writes a server entry and a connection into the isolated instance and puts them back).
// Exit 0 = every step held, 1 = one did not, 3 = wrong environment.
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import net from 'node:net'
import { connect } from './cdp-lib.mjs'
import { openLivePage, waitFor } from './live-page.mjs'
import { pointSandboxAt } from './lib-mobile-remote-backend.mjs'
import { startFakeRelay } from '../packages/kybernos-mobile/remote-fake-relay.mjs'

const REPO = join(fileURLToPath(import.meta.url), '..', '..')
const arg = (name, dflt) => { const i = process.argv.indexOf('--' + name); return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : dflt }
const OUT = arg('out', '')
const PARTS = arg('parts', 'pair,cut,many').split(',')
const DOWN = Number(arg('down-seconds', '60'))
const SIM = arg('sim', '')
const HOST = process.env.KB_HOST || '127.0.0.1:3080'
const DSH_HOME = process.env.DSH_HOME || ''
if (HOST === '127.0.0.1:3080') { console.error('refusing: this check pairs a phone with the DSH it talks to; use a sandbox'); process.exit(2) }
if (!DSH_HOME.includes('.kybernos-sandbox')) { console.error('DSH_HOME is not a sandbox home: source scripts/sandbox/env.sh'); process.exit(3) }
if (OUT === '' || OUT.includes('/worktrees/')) { console.error('--out <folder outside the repository> is required'); process.exit(2) }
mkdirSync(OUT, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0
let fail = 0
const notes = {}
const check = (name, ok, detail) => { if (ok === true) { pass += 1; console.log('  ok   ' + name) } else { fail += 1; console.log('  FAIL ' + name + (detail === undefined ? '' : ' | ' + JSON.stringify(detail).slice(0, 500))) } }
const note = (k, v) => { notes[k] = v; console.log('  note ' + k + ': ' + JSON.stringify(v).slice(0, 700)) }

// ── the relay, kept across a stop ──
let relay = await startFakeRelay({ entitled: true, maxDevices: 3 })
const RELAY_PORT = relay.port
const restore = pointSandboxAt({ id: 'journey-phone', name: 'Journey stand-in', api: relay.url, web: relay.url, token: 'kyd-journey-token', user: { id: 'u1', name: 'Journey Tester', plan: 'solo' } })
const relayDown = async () => { relay.__saved = relay.state; await relay.close() }
const relayUp = async () => {
  const saved = relay.__saved
  relay = await startFakeRelay({ entitled: true, maxDevices: 3, port: RELAY_PORT })
  for (const k of ['pairings', 'devices', 'tickets']) for (const [a, b] of saved[k]) relay.state[k].set(a, b)
}

// ── a phone: a second, signed-out browser at 390 x 844 ──
const freePort = async () => { for (let i = 0; i < 60; i += 1) { const p = 9500 + Math.floor(Math.random() * 400); const ok = await new Promise((r) => { const s = net.createServer(); s.once('error', () => r(false)); s.listen(p, '127.0.0.1', () => s.close(() => r(true))) }); if (ok) return p } throw new Error('no free port') }
async function openPhone () {
  const chromePath = process.env.KB_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  const profile = mkdtempSync(join(tmpdir(), 'kb-phone-'))
  const port = await freePort()
  const chrome = spawn(chromePath, ['--headless=new', '--remote-debugging-port=' + port, '--user-data-dir=' + profile, '--use-mock-keychain', '--password-store=basic', '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' })
  let target = null
  for (let i = 0; i < 60 && target === null; i += 1) {
    await sleep(500)
    try { target = (await (await fetch('http://127.0.0.1:' + port + '/json/list')).json()).find((t) => t.type === 'page') || null } catch (e) { /* starting */ }
  }
  if (target === null) { chrome.kill(); throw new Error('the phone browser did not start') }
  const page = await connect(target)
  await page.send('Runtime.enable', {})
  await page.send('Network.enable', {})
  await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
  return { page, close: async () => { try { page.close() } catch (e) { /* gone */ } try { chrome.kill() } catch (e) { /* gone */ } await sleep(300); try { rmSync(profile, { recursive: true, force: true }) } catch (e) { /* busy */ } } }
}

const phones = []
let desktop = null
const dsh = {
  pid: () => { const r = spawnSync('lsof', ['-ti', 'tcp:' + HOST.split(':')[1], '-sTCP:LISTEN'], { encoding: 'utf8' }); return Number((r.stdout || '').split('\n')[0]) || null },
  restart: () => {
    const env = { ...process.env }
    delete env.KYBERNOS_CLOUD_API
    const root = process.env.KB_SANDBOX_ROOT
    spawnSync('bash', [join(REPO, 'scripts/sandbox/stop.sh')], { env, cwd: REPO, encoding: 'utf8' })
    return spawnSync('bash', [join(REPO, 'scripts/sandbox/start.sh')], { env: { ...env, KB_SANDBOX_TTL: process.env.KB_SANDBOX_TTL || '21600', KB_SANDBOX_ROOT: root }, cwd: REPO, encoding: 'utf8' }).stdout
  },
}
const sessionsRoot = join(DSH_HOME, 'sessions')
const sessionHits = (needle) => {
  const hits = []
  try {
    for (const cwdDir of readdirSync(sessionsRoot)) {
      const dir = join(sessionsRoot, cwdDir)
      let list = []
      try { list = readdirSync(dir) } catch (e) { continue }
      for (const s of list) {
        const f = join(dir, s, 'session.v4.jsonl.zstd')
        if (!existsSync(f)) continue
        const r = spawnSync('zstd', ['-dc', f], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
        if ((r.stdout || '').includes(needle)) hits.push(s)
      }
    }
  } catch (e) { /* no sessions yet */ }
  return hits
}

const ev = async (page, js, ms) => { const r = await page.evalJs(js, ms || 8000); return r.err ? { __err: r.err } : r.val }
const q = (sel) => JSON.stringify(sel)
const until = async (page, js, ms = 15000) => (await waitFor(page, js, ms)) !== null
const text = (page, sel) => ev(page, `(() => { const e = document.querySelector(${q(sel)}); return e ? e.innerText : null })()`)
const click = (page, sel) => ev(page, `(() => { const e = document.querySelector(${q(sel)}); if (!e) return false; e.click(); return true })()`)
const exists = async (page, sel) => (await ev(page, `!!document.querySelector(${q(sel)})`)) === true
const shot = async (page, name) => { try { await page.shot(join(OUT, name + '.png')) } catch (e) { /* no picture */ } }
const DECODE = `(async () => {
  const svg = document.querySelector('[data-kb="mobile-qr"] svg')
  const clone = svg.cloneNode(true); clone.setAttribute('width', '600'); clone.setAttribute('height', '600'); clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  const img = new Image(); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(clone))
  await img.decode()
  const c = document.createElement('canvas'); c.width = 600; c.height = 600
  const g = c.getContext('2d'); g.fillStyle = 'white'; g.fillRect(0, 0, 600, 600); g.drawImage(img, 0, 0, 600, 600)
  const r = await new BarcodeDetector({ formats: ['qr_code'] }).detect(c)
  return r.length ? r[0].rawValue : null
})()`
const phoneState = (P) => ev(P, `JSON.stringify({ state: window.__kb && window.__kb.state, veil: (document.getElementById('veil') || {}).textContent || null, veilHidden: (document.getElementById('veil') || {}).hidden, log: window.__kb && window.__kb.log, ws: window.__kb && window.__kb.wsOpen, title: document.title, bodyText: (document.body.innerText || '').slice(0, 300) })`).then((s) => { try { return JSON.parse(s) } catch (e) { return s } })
const deskDevices = (D) => ev(D, `Array.from(document.querySelectorAll('[data-kb="mobile-device"]')).map((e) => e.innerText.replace(/\\s+/g, ' ').trim())`)

// opens the desktop's « Phone and channels » window or Settings page; returns the root selector
async function openPhonePage (D, how) {
  if (how === 'window') {
    await ev(D, `(() => { const b = document.querySelector('[data-kb="workspace-card"] .kbfp-cardmain'); if (!b) return false; b.click(); return true })()`)
    await sleep(600)
    await click(D, '[data-kb="menu-phone"]')
    await until(D, `!!document.querySelector('[data-kb="phone-channels"] [data-kb="mobile-pair"], [data-kb="phone-channels"] [data-kb="mobile-devices"]')`, 45000)
    return '[data-kb="phone-channels"]'
  }
  await ev(D, `window.__kbOpenDshSettings && window.__kbOpenDshSettings()`)
  await until(D, `document.querySelectorAll('[class*="navCell"]').length > 3`, 15000)
  await ev(D, `(() => { const b = Array.from(document.querySelectorAll('button[class*="navCell"]')).find((e) => { const n = Object.keys(e).find((k) => k.indexOf('__reactFiber$') === 0); return n && e[n].key === 'kybernos-mobile' }); if (b) b.click(); return !!b })()`)
  await until(D, `!!document.querySelector('[data-kb="mobile-page"]')`, 15000)
  return '[data-kb="mobile-page"]'
}
// one phone, paired: returns { P, link, sas }
async function pairOne (D, root, label, shotName) {
  await until(D, `!!document.querySelector('${root} [data-kb="mobile-pair"]')`, 20000)
  await click(D, `${root} [data-kb="mobile-pair"]`)
  let qr = await until(D, `!!document.querySelector('${root} [data-kb="mobile-qr"] svg')`, 45000)
  if (!qr) {
    // the first press can land before the page has read the relay (UJ-70): press once more and say so
    console.log('  note ' + label + ': no QR code 45 s after the first press, words: ' + JSON.stringify(String(await text(D, root)).replace(/\\s+/g, ' ').slice(0, 300)))
    await click(D, `${root} [data-kb="mobile-pair"]`)
    qr = await until(D, `!!document.querySelector('${root} [data-kb="mobile-qr"] svg')`, 45000)
  }
  if (!qr) return { error: 'no QR code', deskText: await text(D, root) }
  const link = await ev(D, DECODE, 15000)
  const P = await openPhone()
  phones.push(P)
  await P.page.send('Page.navigate', { url: link })
  const verifying = await until(P.page, `window.__kb && window.__kb.state === 'verify'`, 30000)
  const sas = await ev(P.page, `window.__kb && window.__kb.sas`)
  const deskSas = await until(D, `!!document.querySelector('[data-kb="mobile-sas"]')`, 15000) ? await text(D, '[data-kb="mobile-sas"]') : null
  if (shotName) { await shot(D, shotName + '-desktop-verify'); await shot(P.page, shotName + '-phone-verify') }
  await click(D, '[data-kb="mobile-approve"]')
  const running = await until(P.page, `window.__kb.state === 'running'`, 30000)
  await until(P.page, `window.__kb.wsOpen >= 1 && window.__kb.wsMsgs >= 1`, 30000)
  return { P, link, sas, deskSas, verifying, running, label }
}

try {
  desktop = await openLivePage({ width: 1300, height: 900 }).catch((e) => { console.error('inconclusive: ' + e.message); process.exit(3) })
  const D = desktop.page
  await until(D, `document.readyState === 'complete'`, 20000)
  await sleep(2500)
  const serversText = await ev(D, `fetch('/kybernos-servers/status').then((r) => r.text()).catch(() => '')`)
  if (/"source"\s*:\s*"env"/u.test(String(serversText))) { console.error('inconclusive: this DSH takes its server from KYBERNOS_CLOUD_API; start the sandbox without it'); throw new Error('env server') }
  await ev(D, `(() => { const b = Array.from(document.querySelectorAll('button')).find((x) => /^Configure later$/i.test(x.textContent.trim())); if (b) b.click(); return !!b })()`)
  await sleep(500)

  let first = null
  if (PARTS.includes('pair')) {
    console.log('pair: the QR code and the link')
    const root = await openPhonePage(D, 'window')
    const before = await text(D, root)
    note('the window before Add a phone', before)
    await shot(D, '1-window')
    await click(D, `${root} [data-kb="mobile-pair"]`)
    check('Add a phone shows a QR code', await until(D, `!!document.querySelector('${root} [data-kb="mobile-qr"] svg')`, 45000))
    const withQr = await text(D, root)
    note('the window with the QR code (all the words)', withQr)
    const rect = await ev(D, `(() => { const e = document.querySelector('${root} [data-kb="mobile-qr"] svg'); const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)] })()`)
    note('the QR box (w x h)', rect)
    const link = await ev(D, DECODE, 15000)
    check('the QR code decodes into a link on the phone origin', typeof link === 'string' && link.startsWith(relay.url + '/__kb/#'), typeof link === 'string' ? link.slice(0, 40) : link)
    const shownLink = await ev(D, `Array.from(document.querySelectorAll('${root} *')).filter((e) => e.children.length === 0 && /__kb|https?:\\/\\//.test(e.textContent || '')).map((e) => e.textContent.trim().slice(0, 80))`)
    note('any link written as text in the window', shownLink)
    const copyBtn = await exists(D, `${root} [data-kb="mobile-copy"]`)
    note('a copy-the-link button', copyBtn)
    await shot(D, '2-qr')
    // withdraw this code, then pair for real through the same screen
    await click(D, '[data-kb="phone-channels-close"]')
    await sleep(800)
    const root2 = await openPhonePage(D, 'window')
    first = await pairOne(D, root2, 'phone 1', '3-phone1')
    check('the phone page reaches the 4-digit check', first.verifying === true, first)
    check('the computer shows the same 4 digits as the phone', first.sas !== null && first.sas === first.deskSas, { phone: first.sas, desk: first.deskSas })
    check('after approval the phone runs the computer\'s own DSH', first.running === true, await phoneState(first.P.page))
    const dom = await ev(first.P.page, `(() => { const f = document.getElementById('app'); const d = f && f.contentDocument; if (!d) return null; return { title: d.title, width: d.documentElement.clientWidth, composer: !!d.querySelector('textarea, [contenteditable="true"], [role="textbox"]'), sheet: !!d.getElementById('kbmob-sheet') } })()`)
    check('it is DSH at phone width, with its composer', dom !== null && dom.title === 'Kybernos' && dom.width <= 390 && dom.composer === true, dom)
    await shot(first.P.page, '4-phone1-running')
    // a message typed on the phone
    const SAY = 'journey phone message ' + Date.now()
    const focus = await ev(first.P.page, `(() => { const f = document.getElementById('app'); const d = f.contentDocument; const t = d.querySelector('textarea, [contenteditable="true"], [role="textbox"]'); if (!t) return null; t.focus(); const r = t.getBoundingClientRect(); const fr = f.getBoundingClientRect(); return { x: fr.left + r.left + 30, y: fr.top + r.top + 12 } })()`)
    if (focus) { for (const t of ['mouseMoved', 'mousePressed', 'mouseReleased']) await first.P.page.send('Input.dispatchMouseEvent', { type: t, x: focus.x, y: focus.y, button: 'left', clickCount: 1 }); await sleep(300) }
    await first.P.page.send('Input.insertText', { text: SAY })
    await sleep(500)
    await shot(first.P.page, '5-phone1-typed')
    for (const t of ['keyDown', 'keyUp']) await first.P.page.send('Input.dispatchKeyEvent', { type: t, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: t === 'keyDown' ? '\r' : undefined })
    let landed = []
    for (let i = 0; i < 20 && landed.length === 0; i += 1) { await sleep(1500); landed = sessionHits(SAY) }
    check('the message typed on the phone is in a session file of the computer', landed.length > 0, landed)
    note('the phone after sending (page text)', await ev(first.P.page, `(() => { const d = document.getElementById('app').contentDocument; return d ? d.body.innerText.replace(/\\s+/g, ' ').slice(-400) : null })()`))
    await shot(first.P.page, '6-phone1-after-send')
    check('the computer lists one phone', (await deskDevices(D)).length === 1, await deskDevices(D))
    if (SIM !== '') {
      console.log('pair: the iOS simulator ' + SIM)
      const root3 = await openPhonePage(D, 'window')
      await until(D, `!!document.querySelector('${root3} [data-kb="mobile-pair"]')`, 20000)
      await click(D, `${root3} [data-kb="mobile-pair"]`)
      await until(D, `!!document.querySelector('${root3} [data-kb="mobile-qr"] svg')`, 45000)
      const link2 = await ev(D, DECODE, 15000)
      const open = spawnSync('xcrun', ['simctl', 'openurl', SIM, link2], { encoding: 'utf8' })
      note('simctl openurl', open.status === 0 ? 'ok' : open.stderr)
      await sleep(8000)
      spawnSync('xcrun', ['simctl', 'io', SIM, 'screenshot', join(OUT, '7-sim-verify.png')])
      note('the 4 digits the computer shows for the simulator', await until(D, `!!document.querySelector('[data-kb="mobile-sas"]')`, 20000) ? await text(D, '[data-kb="mobile-sas"]') : null)
      await sleep(3000)
      await click(D, '[data-kb="mobile-approve"]')
      await sleep(15000)
      spawnSync('xcrun', ['simctl', 'io', SIM, 'screenshot', join(OUT, '8-sim-running.png')])
      check('the computer lists a second phone after the simulator was approved', (await deskDevices(D)).length === 2, await deskDevices(D))
      // the message from the simulator is typed by hand (the control tool of the lead's session); the check waits for it
      console.log('  waiting up to 240 s for a session file that holds the text « journey sim message »')
      let simHit = []
      for (let i = 0; i < 96 && simHit.length === 0; i += 1) { await sleep(2500); simHit = sessionHits('journey sim message') }
      check('a message typed in the simulator\'s Safari is in a session file of the computer', simHit.length > 0, simHit)
      spawnSync('xcrun', ['simctl', 'io', SIM, 'screenshot', join(OUT, '9-sim-after-send.png')])
    }
  }

  if (PARTS.includes('cut')) {
    console.log('cut: relay down, computer asleep, phone offline, DSH restarted')
    const root = await openPhonePage(D, 'settings')
    if (first === null) {
      first = await pairOne(D, root, 'phone 1', 'c0-phone1')
      check('a phone is paired to cut', first.running === true, await phoneState(first.P.page))
    }
    const P = first.P.page
    const both = async (name) => {
      const phone = await phoneState(P)
      const desk = { devices: await deskDevices(D), state: await text(D, '[data-kb="mobile-state"]'), error: await text(D, '[data-kb="mobile-poll-error"]'), note: await text(D, '[data-kb="mobile-none-note"]') }
      await shot(P, name + '-phone')
      await shot(D, name + '-desktop')
      return { phone, desk }
    }
    note('c1 before: both screens', await both('c1-before'))
    // the relay goes
    await relayDown()
    const t0 = Date.now()
    await sleep(8000)
    const early = await both('c2-down-8s')
    note('c2 relay down 8 s: both screens', early)
    await sleep(Math.max(0, DOWN * 1000 - 8000))
    const late = await both('c3-down-' + DOWN + 's')
    note('c3 relay down ' + DOWN + ' s: both screens', late)
    check('while the relay is down the phone does not say it is running', !(late.phone && late.phone.state === 'running' && late.phone.veilHidden === true), late.phone)
    await relayUp()
    const up = await until(P, `window.__kb.state === 'running' && document.getElementById('veil').hidden === true`, 90000)
    note('seconds from the relay being down to the phone running again (including the ' + DOWN + ' s down)', Math.round((Date.now() - t0) / 1000))
    check('the relay is back: the phone resumes by itself, with no new code and no approval', up === true, await phoneState(P))
    const probe = await ev(P, `(async () => { const w = document.getElementById('app').contentWindow; return await w.fetch('/', { cache: 'no-store' }).then((r) => r.status, () => 0) })()`, 25000)
    check('and a request goes through the tunnel again', probe === 200, probe)
    note('c4 relay back: both screens', await both('c4-back'))
    // the computer asleep: its process stopped for 40 s
    const pid = dsh.pid()
    if (pid !== null) {
      process.kill(pid, 'SIGSTOP')
      await sleep(40000)
      const asleep = await ev(P, `JSON.stringify({ state: window.__kb.state, veil: (document.getElementById('veil') || {}).textContent, veilHidden: (document.getElementById('veil') || {}).hidden })`)
      note('c5 the computer frozen 40 s (a stand-in for sleep): the phone says', asleep)
      await shot(P, 'c5-computer-frozen-phone')
      process.kill(pid, 'SIGCONT')
      const woke = await until(P, `window.__kb.state === 'running' && document.getElementById('veil').hidden === true`, 90000)
      check('the computer wakes: the phone is running again with no new code', woke === true, await phoneState(P))
    } else note('c5', 'DSH process not found')
    // the phone offline
    await P.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 })
    await sleep(20000)
    note('c6 the phone offline 20 s: it says', await phoneState(P))
    await shot(P, 'c6-phone-offline')
    await P.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
    const back = await until(P, `window.__kb.state === 'running' && document.getElementById('veil').hidden === true`, 90000)
    check('the phone is back online: it resumes by itself', back === true, await phoneState(P))
    // the DSH restarted
    const out = dsh.restart()
    note('c7 DSH restarted', String(out).split('\n').slice(-3).join(' | '))
    const after = await until(P, `window.__kb.state === 'running' && document.getElementById('veil').hidden === true`, 120000)
    note('c7 after the DSH restart the phone says', await phoneState(P))
    await shot(P, 'c7-after-restart-phone')
    check('after the DSH restarted the phone runs again with no new code', after === true)
    // the desktop page of the restarted DSH
    await D.send('Page.reload', {})
    await sleep(8000)
    const root4 = await openPhonePage(D, 'settings')
    note('c8 the computer just after its restart: the phone list', await deskDevices(D))
    note('c8 the computer just after its restart: the page words', String(await text(D, root4)).replace(/\s+/g, ' ').slice(0, 400))
    const tList = Date.now()
    await until(D, `document.querySelectorAll('[data-kb="mobile-device"]').length >= 1`, 60000)
    note('c8 seconds until the computer lists a phone again (60 = never)', Math.round((Date.now() - tList) / 1000))
    check('the computer still lists the phone after its own restart', (await deskDevices(D)).length >= 1, await deskDevices(D))
    note('c8 the page words after the wait', String(await text(D, root4)).replace(/\s+/g, ' ').slice(0, 400))
    await shot(D, 'c8-desktop-after-restart')
  }

  if (PARTS.includes('many')) {
    console.log('many: three phones, a fourth, removing, pairing again')
    // a fresh slate: forget the devices of the earlier parts so that the count is the one this part makes
    for (const P of phones) { try { await P.close() } catch (e) { /* gone */ } }
    phones.length = 0
    for (const d of Array.from(relay.state.devices.keys())) await relay.api.call('/v1/remote/devices/' + d, { method: 'DELETE' })
    await D.send('Page.reload', {})
    await sleep(6000)
    const root = await openPhonePage(D, 'settings')
    const made = []
    for (let i = 1; i <= 3; i += 1) {
      const r = await pairOne(D, root, 'phone ' + i, 'm' + i)
      made.push(r)
      check('phone ' + i + ' of 3 is paired and running', r.running === true, r.error || null)
      await sleep(1500)
    }
    check('the computer lists three phones', (await deskDevices(D)).length === 3, await deskDevices(D))
    note('the three rows (as written)', await deskDevices(D))
    await shot(D, 'm4-three-phones-desktop')
    // the fourth
    await click(D, `${root} [data-kb="mobile-pair"]`)
    await sleep(4000)
    const refusal = await ev(D, `(() => { const r = document.querySelector('${root}'); return r ? r.innerText.replace(/\\s+/g, ' ') : null })()`)
    note('the page after the fourth press (all words)', refusal)
    check('the fourth phone is refused in words, and no QR code is drawn', /maximum|remove one|retires-en/i.test(String(refusal)) && !(await exists(D, `${root} [data-kb="mobile-qr"] svg`)), refusal)
    await shot(D, 'm5-fourth-refused')
    // removing from the computer
    const rowsBefore = (await deskDevices(D)).length
    await click(D, '[data-kb="mobile-revoke"]')
    await sleep(300)
    note('the removal question', await text(D, `${root}`).then((t) => String(t).replace(/\s+/g, ' ').slice(0, 400)))
    await click(D, '[data-kb="mobile-revoke-confirm"]')
    const gone = await until(D, `document.querySelectorAll('[data-kb="mobile-device"]').length === ${rowsBefore - 1}`, 15000)
    check('removing a phone from the computer takes its row away', gone === true, await deskDevices(D))
    const revokedPhone = await until(made[0].P.page, `window.__kb.state === 'revoked'`, 20000)
    check('the first phone is told it was removed', revokedPhone === true, await phoneState(made[0].P.page))
    note('what the removed phone says (words and actions)', await ev(made[0].P.page, `(() => { const o = document.getElementById('overlay') || document.body; return (o.innerText || '').replace(/\\s+/g, ' ').slice(0, 400) })()`))
    await shot(made[0].P.page, 'm6-removed-phone')
    check('the server forgot it', relay.state.devices.size === 2, relay.state.devices.size)
    // the phone's own way out
    const leave = await ev(made[1].P.page, `(() => { const d = document.getElementById('app').contentDocument; const all = Array.from((d ? d.querySelectorAll('button, a, [role=button], [role=menuitem]') : [])).map((e) => (e.innerText || e.getAttribute('aria-label') || '').trim()).filter(Boolean); return { leave: all.filter((t) => /unpair|forget|disconnect|sign out|remove this phone|leave|oublier|d[ée]connect/i.test(t)).slice(0, 10), count: all.length } })()`)
    note('a control on the phone\'s own page to leave the link (unpair, forget, disconnect)', leave)
    // pairing again
    const again = await pairOne(D, root, 'phone 4 (again)', 'm7-again')
    check('after a removal a new phone pairs again', again.running === true, again.error || null)
    check('the computer lists three phones again', (await deskDevices(D)).length === 3, await deskDevices(D))
    // remove all
    const all = await click(D, '[data-kb="mobile-revoke-all"]')
    note('a « remove all » control', all)
  }
} catch (e) {
  fail += 1
  console.log('  FAIL the run stopped: ' + (e && e.stack ? e.stack : e))
} finally {
  for (const P of phones) { try { await P.close() } catch (e) { /* gone */ } }
  if (desktop !== null) await desktop.close()
  try { await relay.close() } catch (e) { /* closed */ }
  restore()
  const pid = dsh.pid()
  if (pid !== null) { try { process.kill(pid, 'SIGCONT') } catch (e) { /* running */ } }
  try { const fs = await import('node:fs'); fs.writeFileSync(join(OUT, 'phone-link-journey.json'), JSON.stringify({ pass, fail, parts: PARTS, notes }, null, 1)) } catch (e) { /* no folder */ }
}
console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)

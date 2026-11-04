// A plain headless Chrome for reading a PUBLIC site (no sign-in, no DSH): its own throw-away profile, the CDP Network domain recorded.
// Used by the public-site checks of docs/tests/user-journey (cases J01-xx). Read only: it never submits anything by itself.
//
//   import { openSite } from './lib-site-browser.mjs'
//   const s = await openSite({ width: 1440, height: 900 })
//   await s.goto('https://kybernos.app/')            // waits for the load event and a quiet network
//   await s.evalJs('document.title')                 // the value, or throws
//   s.requests                                       // every request since the last s.resetLog()
//   await s.cookies()                                // every cookie of the browser
//   await s.close()
//
// Environment: KB_CHROME (Chrome binary).
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { connect } from './cdp-lib.mjs'

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const freePort = (from) => new Promise((resolve) => {
  const tryPort = (p) => {
    const s = createServer()
    s.once('error', () => tryPort(p + 1))
    s.listen(p, '127.0.0.1', () => { s.close(() => resolve(p)) })
  }
  tryPort(from)
})

const OPEN = new Set()
let hooked = false
function sweep () {
  for (const o of OPEN) {
    try { o.chrome.kill() } catch (e) { /* gone */ }
    try { rmSync(o.profile, { recursive: true, force: true }) } catch (e) { /* busy */ }
  }
  OPEN.clear()
}
function hook () {
  if (hooked) return
  hooked = true
  process.once('exit', sweep)
  for (const sig of ['SIGTERM', 'SIGINT']) process.once(sig, () => process.exit(1))
}

/** `{ goto, evalJs, shot, resize, cookies, requests, resetLog, blockUrls, close, page }`; throws a readable error when Chrome is missing. */
export async function openSite (opts = {}) {
  const chromePath = process.env.KB_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  if (!existsSync(chromePath)) throw new Error('Chrome not found: ' + chromePath + ' (set KB_CHROME)')
  const port = await freePort(9460)
  const profile = mkdtempSync(join(tmpdir(), 'kb-site-'))
  const chrome = spawn(chromePath, [
    '--headless=new', '--remote-debugging-port=' + port, '--user-data-dir=' + profile,
    '--use-mock-keychain', '--password-store=basic', '--no-first-run', '--no-default-browser-check',
    '--window-size=' + (opts.width || 1440) + ',' + (opts.height || 900), 'about:blank'
  ], { stdio: 'ignore' })
  const mine = { chrome, profile }
  OPEN.add(mine)
  hook()
  let target = null
  for (let i = 0; i < 60 && target === null; i += 1) {
    await sleep(500)
    try {
      const list = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json()
      target = list.find((t) => t.type === 'page') || null
    } catch (e) { /* still starting */ }
  }
  if (target === null) { try { chrome.kill() } catch (e) { /* gone */ } throw new Error('Chrome did not start (port ' + port + ')') }
  const page = await connect(target)
  const requests = []
  const byId = new Map()
  page.on('Network.requestWillBeSent', (p) => {
    const r = { id: p.requestId, url: p.request.url, method: p.request.method, type: p.type, initiator: p.initiator && p.initiator.type, documentURL: p.documentURL, hasPostData: !!p.request.hasPostData, t: Date.now() }
    if (p.redirectResponse) r.redirectedFrom = p.redirectResponse.url
    requests.push(r)
    byId.set(p.requestId, r)
  })
  page.on('Network.responseReceived', (p) => { const r = byId.get(p.requestId); if (r) { r.status = p.response.status; r.mime = p.response.mimeType; r.fromCache = !!p.response.fromDiskCache } })
  page.on('Network.loadingFailed', (p) => { const r = byId.get(p.requestId); if (r) { r.failed = p.errorText; r.blocked = p.blockedReason || null } })
  // A page here must never write a file to the machine: downloads are refused, and the address the page tried to fetch is kept in `downloads`.
  const downloads = []
  page.on('Browser.downloadWillBegin', (p) => downloads.push({ url: p.url, file: p.suggestedFilename }))
  page.on('Page.downloadWillBegin', (p) => { if (!downloads.some((d) => d.url === p.url)) downloads.push({ url: p.url, file: p.suggestedFilename }) })
  await page.send('Browser.setDownloadBehavior', { behavior: 'deny', eventsEnabled: true })
  await page.send('Page.setDownloadBehavior', { behavior: 'deny' })
  await page.send('Page.enable', {})
  await page.send('Network.enable', {})
  await page.send('Runtime.enable', {})

  const evalJs = async (expr, ms) => {
    const r = await page.evalJs(expr, ms || 15000)
    if (r.err) throw new Error('evalJs: ' + String(r.err).slice(0, 300))
    return r.val
  }
  // The load event, then the network quiet for `quiet` ms (an Expo page renders after its bundle runs).
  const settle = async (quiet = 1200, max = 25000) => {
    const start = Date.now()
    let last = requests.length
    let lastChange = Date.now()
    while (Date.now() - start < max) {
      await sleep(250)
      if (requests.length !== last) { last = requests.length; lastChange = Date.now() }
      const inflight = requests.filter((r) => r.status === undefined && !r.failed && Date.now() - r.t < 6000).length
      if (inflight === 0 && Date.now() - lastChange >= quiet) return
    }
  }
  const goto = async (url, o = {}) => {
    await page.send('Page.navigate', { url })
    await sleep(300)
    for (let i = 0; i < 80; i += 1) {
      const rs = await page.evalJs('document.readyState', 3000)
      if (rs.val === 'complete') break
      await sleep(250)
    }
    await settle(o.quiet || 1200, o.max || 25000)
  }
  const resize = async (width, height, mobile) => {
    await page.send('Emulation.setDeviceMetricsOverride', { width, height: height || 900, deviceScaleFactor: 1, mobile: mobile === true })
  }
  const cookies = async () => ((await page.send('Network.getAllCookies', {})).result || {}).cookies || []
  const blockUrls = async (patterns) => { await page.send('Network.setBlockedURLs', { urls: patterns }) }
  const shot = async (path) => page.shot(path)
  // A real mouse click at the centre of the element a script returns (`return` an Element, or null).
  const click = async (findExpr, wait = 900) => {
    const pos = await evalJs(`(() => { const el = (${findExpr}); if (!el) return null; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return JSON.stringify([r.x + r.width / 2, r.y + r.height / 2]) })()`)
    if (!pos) return false
    const [x, y] = JSON.parse(pos)
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
    await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
    await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
    await sleep(wait)
    return true
  }
  const close = async () => {
    try { await Promise.race([page.send('Browser.close', {}), sleep(2500)]) } catch (e) { /* gone */ }
    try { chrome.kill() } catch (e) { /* gone */ }
    await sleep(300)
    try { rmSync(profile, { recursive: true, force: true }) } catch (e) { /* busy */ }
    OPEN.delete(mine)
  }
  if (opts.width) await resize(opts.width, opts.height || 900, opts.width < 768)
  return { page, goto, settle, evalJs, shot, click, resize, cookies, blockUrls, requests, downloads, resetLog: () => { requests.length = 0; byId.clear(); downloads.length = 0 }, close, writeJson: (p, v) => writeFileSync(p, JSON.stringify(v, null, 2)) }
}

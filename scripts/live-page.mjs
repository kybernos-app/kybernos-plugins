// A headless Chrome signed in to the LIVE DSH GUI, for tests that need the real
// app (not a harness). See docs/dev/live-testing.md.
//
//   import { openLivePage } from './live-page.mjs'
//   const live = await openLivePage()           // 127.0.0.1:3080 by default
//   (the page never writes translations to the user's disk unless { hostStore: true } — see below)
//   await live.page.evalJs('document.title')    // { val } or { err }
//   await live.close()
//
// Sign-in uses the signed browser-session cookie (scripts/cdp-lib.mjs), never the
// token of ~/.dsh/logs/dsh-web.url: that file keeps a stale token once `dsh web`
// is restarted by hand, and the GUI then answers 401. Nothing here ever prints
// the secret or the cookie.
//
// Environment: KB_HOST (default 127.0.0.1:3080), KB_CHROME (Chrome binary).
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { connect, poserCookie, cookieDeSession } from './cdp-lib.mjs'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const freePort = (from) => new Promise((resolve) => {
  const tryPort = (p) => {
    const s = createServer()
    s.once('error', () => tryPort(p + 1))
    s.listen(p, '127.0.0.1', () => { s.close(() => resolve(p)) })
  }
  tryPort(from)
})

/** `{ page, close }`, or throws a readable error (no Chrome, GUI down, 401). */
export async function openLivePage(opts = {}) {
  const authority = opts.authority || process.env.KB_HOST || '127.0.0.1:3080'
  const chromePath = process.env.KB_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  if (!existsSync(chromePath)) throw new Error('Chrome not found: ' + chromePath + ' (set KB_CHROME)')
  if (cookieDeSession(authority) === null) throw new Error('browser-session secret unreadable in ~/.dsh/.credentials.yaml')

  const port = await freePort(9360)
  const profile = mkdtempSync(join(tmpdir(), 'kb-live-'))
  const chrome = spawn(chromePath, [
    '--headless=new', '--remote-debugging-port=' + port, '--user-data-dir=' + profile,
    '--no-first-run', '--no-default-browser-check', '--window-size=' + (opts.width || 1400) + ',' + (opts.height || 900), 'about:blank',
  ], { stdio: 'ignore' })
  const base = 'http://127.0.0.1:' + port
  let target = null
  for (let i = 0; i < 60 && target === null; i += 1) {
    await sleep(500)
    try {
      const list = await (await fetch(base + '/json/list')).json()
      target = list.find((t) => t.type === 'page') || null
    } catch (e) { /* Chrome still starting */ }
  }
  const close = async () => {
    try { chrome.kill() } catch (e) { /* gone */ }
    await sleep(300)
    try { rmSync(profile, { recursive: true, force: true }) } catch (e) { /* busy */ }
  }
  if (target === null) { await close(); throw new Error('Chrome did not start (port ' + port + ')') }

  const page = await connect(target)
  await page.send('Page.enable', {})
  // The language runtime keeps a copy of every translation on the user's DISK, through the
  // host: a test must never write there (a pseudo-translation would replace a real one).
  // Off in every page of the test browser, unless the test asks for it (opts.hostStore).
  if (opts.hostStore !== true) await page.send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__KB_I18N_HOST_STORE__ = false' })
  if (await poserCookie(page, authority) !== true) { page.close(); await close(); throw new Error('the browser refused the session cookie') }
  await page.send('Page.navigate', { url: 'http://' + authority + '/' })
  // The GUI is up once the DSH shell has rendered something.
  let ready = false
  for (let i = 0; i < 60 && !ready; i += 1) {
    await sleep(500)
    const r = await page.evalJs('document.body ? document.body.innerText.length : 0', 4000)
    ready = typeof r.val === 'number' && r.val > 40
  }
  if (!ready) {
    const r = await page.evalJs('document.body ? document.body.innerText.slice(0, 120) : ""', 4000)
    page.close(); await close()
    throw new Error('the GUI did not render' + (r.val ? ' — it says: ' + r.val : ''))
  }
  return { page, close: async () => { page.close(); await close() }, authority }
}

/** Poll an expression until it is truthy; resolves its value or `null` on timeout. */
export async function waitFor(page, expression, ms = 15000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    const r = await page.evalJs(expression, 4000)
    if (r.val) return r.val
    await sleep(300)
  }
  return null
}

/** Click the first visible element whose own text matches (exact, trimmed, case-insensitive),
 *  with a real mouse event at its centre. Resolves `true` when something was clicked. */
export async function clickText(page, text, opts = {}) {
  const wanted = JSON.stringify(String(text).trim().toLowerCase())
  const scope = opts.within ? JSON.stringify(opts.within) : 'null'
  const r = await page.evalJs(`(() => {
    const root = ${scope} ? document.querySelector(${scope}) : document
    if (!root) return null
    const want = ${wanted}
    const els = Array.from(root.querySelectorAll('*'))
    const hit = els.find((e) => {
      const r = e.getBoundingClientRect()
      if (r.width < 4 || r.height < 4) return false
      const own = Array.from(e.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').replace(/[⟦⟧]/g, '').trim().toLowerCase()
      const lines = (e.innerText || '').replace(/[⟦⟧]/g, '').trim().toLowerCase().split('\\n').map((l) => l.trim())
      // A small element may show a count before or after its label (« 77 » then « Ressources »).
      return own === want || (e.children.length <= 3 && lines.length <= 3 && lines.indexOf(want) >= 0)
    })
    if (!hit) return null
    hit.scrollIntoView({ block: 'center' })
    const r = hit.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })()`, 6000)
  if (!r.val) return false
  const { x, y } = r.val
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
  return true
}

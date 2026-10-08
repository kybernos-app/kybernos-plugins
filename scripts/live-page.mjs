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
    // A throw-away profile must never reach for the macOS keychain (it pops "Keychain Not Found" on every run).
    '--use-mock-keychain', '--password-store=basic',
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
  // The language page treats a ⟦…⟧ text as a test mark, not as a translation (it would be one a user never wants).
  // The checks that translate with the pseudo-translating stub need it to count as real: say so, unless a check
  // is about that very guard (`pseudoOk: false`, and it then sets the flag itself).
  if (opts.pseudoOk !== false) await page.send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__KB_I18N_PSEUDO_OK__ = true' })
  // A fresh instance (the sandbox, any host but the user's own :3080) opens on an « Add an API key to get started »
  // dialog that covers the page after EVERY load and swallows every click. A check that reloads would meet it again,
  // so it is pressed away by the page itself, whenever it shows up. The user's own DSH never shows it: left alone.
  if (authority !== '127.0.0.1:3080' && opts.keepKeyDialog !== true) {
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
      const press = () => { const e = Array.from(document.querySelectorAll('button, [role=button], a, span, div')).find((x) => x.children.length === 0 && (x.innerText || '').replace(/[⟦⟧]/g, '').trim() === 'Configure later'); if (e) (e.closest('button') || e).click() }
      new MutationObserver(press).observe(document, { childList: true, subtree: true })
    })()` })
  }
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

/** Open DSH's Settings dialog; resolves `true` once its navigation cells are there.
 *  The signed-in user's DSH has an account chip (« My workspace ») that leads to it; a fresh instance (the
 *  sandbox) has no account, so the dialog opens from the settings trigger of the sidebar instead. */
export async function openSettings(page, opts = {}) {
  const minCells = opts.minCells === undefined ? 3 : opts.minCells
  const chipJs = `(() => { const e = [...document.querySelectorAll('button')].find((x) => x.getAttribute('aria-label') === 'My workspace' || /Switch workspace|^MW/.test((x.textContent || '').trim())); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`
  const click = async (x, y) => { for (const t of ['mouseMoved', 'mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type: t, x, y, button: 'left', clickCount: 1 }) }
  for (let attempt = 1; attempt <= (opts.tries || 4); attempt += 1) {
    await waitFor(page, `document.readyState === 'complete'`, 15000)
    await sleep(1500)
    const chip = (await page.evalJs(chipJs, 4000)).val
    if (chip) { await click(chip.x, chip.y); await sleep(1000); await clickText(page, 'Settings') }
    else await page.evalJs(`(() => { const b = document.querySelector('[class*="settingsArea"] button[class*="trigger"]'); if (b) b.click() })()`, 4000)
    if ((await waitFor(page, `document.querySelectorAll('[class*="navCell"]').length > ${minCells}`, 6000)) !== null) return true
    await page.send('Page.reload', { ignoreCache: true })
    await sleep(3500)
  }
  return false
}

#!/usr/bin/env node
// Takes the pictures of the 3D shelf examples from the REAL pages: one headless Chrome screenshot of each model.html, so the card shows what the
// product really shows (AGENTS rule 4: the pictures stay outside git; `scripts/templates-lot.mjs` turns them into the shelf's WebP files).
//
//   node scripts/model3d-stills.mjs <pages dir> <id>[:<height>[:<button>]] ... [--out <dir>] [--settle <ms>]
//
// <pages dir>/<id>/model.html is a page built by the model-3d skill (`node model.mjs all <dir>`). The window is 1280 wide and <height> tall (default 800); a page that
// is shorter than 800 is centred on 1280x800 over a stretched copy of its own corner pixel, so the margin is the page's own background. A page that needs more than 800 (up to
// 1000) gets a bigger window, shrunk to 1280x800 by the browser itself (a 1000-tall window is 1600 wide at a scale of 0.8). `<button>` is the visible text of a
// button to press before the shot (« Explode »), and the page then gets --settle ms (default 3500) to finish moving.
// Out: <out>/<id>.jpg, default <pages dir>/../stills. Needs ffmpeg and a Chrome: the headless shell of Playwright's cache when there is one (no display, no profile prompt),
// else Google Chrome (CHROME=<binary> names another). The page loads three.js from its CDN, so it needs internet. The browser is driven over its DevTools socket (Node's
// own WebSocket): no dependency.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const args = process.argv.slice(2)
const flag = (name, fallback) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback }
const positional = args.filter((a, i) => !a.startsWith('--') && !['--out', '--settle'].includes(args[i - 1]))
if (positional.length < 2) { console.error('usage: node scripts/model3d-stills.mjs <pages dir> <id>[:<height>[:<button>]] ... [--out dir] [--settle ms]'); process.exit(2) }
const pages = resolve(positional[0])
const out = resolve(flag('--out', join(pages, '..', 'stills')))
const settle = Number(flag('--settle', '3500'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** The headless shell Playwright keeps in its cache, newest first, else Google Chrome on macOS. */
const findChrome = () => {
  if (process.env.CHROME) return process.env.CHROME
  const cache = join(homedir(), 'Library', 'Caches', 'ms-playwright')
  const shells = existsSync(cache) ? readdirSync(cache).filter((d) => d.startsWith('chromium_headless_shell-')).sort().reverse() : []
  for (const d of shells) {
    const bin = join(cache, d, 'chrome-headless-shell-mac-arm64', 'chrome-headless-shell')
    if (existsSync(bin)) return bin
  }
  return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
}
const chrome = findChrome()
if (!existsSync(chrome)) { console.error('no Chrome at ' + chrome + ' (CHROME=<binary>)'); process.exit(1) }
mkdirSync(out, { recursive: true })

const profile = mkdtempSync(join(tmpdir(), 'kb-stills-'))      // its own profile: never the person's running Chrome
const browser = spawn(chrome, (/headless-shell/.test(chrome) ? [] : ['--headless=new', '--use-mock-keychain', '--password-store=basic']).concat([
  '--remote-debugging-port=0', '--user-data-dir=' + profile, '--no-first-run', '--disable-extensions', '--disable-component-update', '--disable-gpu',
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars', 'about:blank']), { stdio: ['ignore', 'ignore', 'pipe'] })
const done = (code) => { try { browser.kill('SIGKILL') } catch (e) { /* gone */ } rmSync(profile, { recursive: true, force: true }); process.exit(code) }
process.on('SIGINT', () => done(130))

/** The DevTools port, read from the line the browser prints on start. */
const port = await new Promise((ok, no) => {
  let seen = ''
  const t = setTimeout(() => no(new Error('the browser did not start')), 30000)
  browser.stderr.on('data', (d) => { seen += String(d); const m = /DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//.exec(seen); if (m !== null) { clearTimeout(t); ok(m[1]) } })
  browser.on('exit', () => no(new Error('the browser stopped: ' + seen.slice(-200))))
}).catch((e) => { console.error(String(e.message)); return done(1) })

/** One page of the browser, driven over its socket. */
const openPage = async () => {
  const tab = await (await fetch('http://127.0.0.1:' + port + '/json/new?about:blank', { method: 'PUT' })).json()
  const ws = new WebSocket(tab.webSocketDebuggerUrl)
  await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = () => no(new Error('no socket')) })
  let n = 0
  const waiting = new Map()
  ws.onmessage = (m) => { const r = JSON.parse(String(m.data)); if (r.id !== undefined && waiting.has(r.id)) { const w = waiting.get(r.id); waiting.delete(r.id); r.error ? w.no(new Error(r.error.message)) : w.ok(r.result) } }
  const send = (method, params) => new Promise((ok, no) => { n += 1; waiting.set(n, { ok, no }); ws.send(JSON.stringify({ id: n, method, params: params || {} })) })
  const js = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.value
  return { send, js, close: () => { try { ws.close() } catch (e) { /* closed */ } fetch('http://127.0.0.1:' + port + '/json/close/' + tab.id).catch(() => {}) } }
}

let failed = 0
for (const spec of positional.slice(1)) {
  const [id, h, button] = spec.split(':')
  const height = h === undefined || h === '' ? 800 : Number(h)
  const html = join(pages, id, 'model.html')
  if (!/^[a-z0-9][a-z0-9_]{0,63}$/.test(id) || !Number.isInteger(height) || height < 400 || height > 1000 || !existsSync(html)) { console.error('skip ' + spec + ': no ' + html + ' or a bad height'); failed += 1; continue }
  const page = await openPage()
  try {
    const scale = height > 800 ? 800 / height : 1
    await page.send('Emulation.setDeviceMetricsOverride', { width: Math.round(1280 / scale), height, deviceScaleFactor: scale, mobile: false })
    await page.send('Page.navigate', { url: pathToFileURL(html).href })
    const start = Date.now()
    while (await page.js("document.readyState === 'complete' && document.querySelector('canvas') !== null && document.body.innerText.length > 40") !== true) {
      if (Date.now() - start > 90000) throw new Error('the page did not come up in 90 s')
      await sleep(400)
    }
    await sleep(2500)                                                 // the first frames, the models and the textures
    if (button !== undefined && button !== '') {
      const clicked = await page.js('(() => { const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === ' + JSON.stringify(button) + '); if (b === undefined) return false; b.click(); return true })()')
      if (clicked !== true) throw new Error('no button « ' + button + ' » on the page')
      await sleep(settle)
    }
    const shot = await page.send('Page.captureScreenshot', { format: 'png' })
    const png = join(out, id + '.png')
    writeFileSync(png, Buffer.from(shot.data, 'base64'))
    const graph = '[0:v]crop=1:1:0:0,scale=1280:800[bg];[bg][0:v]overlay=(W-w)/2:(H-h)/2'
    const jpg = join(out, id + '.jpg')
    const ff = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', png, '-filter_complex', graph, '-frames:v', '1', '-q:v', '2', jpg], { encoding: 'utf8' })
    rmSync(png, { force: true })
    if (ff.status !== 0) throw new Error('ffmpeg failed: ' + String(ff.stderr).slice(0, 300))
    console.log(id + ' -> ' + jpg)
  } catch (e) {
    console.error(id + ': ' + (e && e.message ? e.message : e))
    failed += 1
  } finally {
    page.close()
  }
}
done(failed === 0 ? 0 : 1)

#!/usr/bin/env node
// What the app's interface feels like on a plugged-in Android phone, measured from inside its web view (the app builds the WebView with debugging on): no root, nothing installed,
// nothing in the person's data is changed. Start the app first (a self-test launch skips the consent screen and the key: `am start -n app.kybernos.host/.MainActivity --ei kb_selftest_delay 900`).
//   PHONE=<adb serial> node mobile/tests/phone-perf.mjs load                  page load, resources, round trips to the engine, idle frames
//   PHONE=<adb serial> node mobile/tests/phone-perf.mjs taps "label:x,y" ...  real taps (physical pixels; "label:swipeX1,Y1,X2,Y2" for a swipe), felt latency of each and the long tasks after it
//   PHONE=<adb serial> node mobile/tests/phone-perf.mjs scroll                frame cadence during real swipes
// Measured on a Redmi 24115RA8EG (2026-10-25): taps 64 to 136 ms felt, scrolling at the screen's 120 Hz, engine round trip 7 ms; page load 2.4 s; a few pages block the page 250 to 313 ms right after opening.
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { connect } from '../../scripts/cdp-lib.mjs'

const SDK = process.env.ANDROID_HOME || '/opt/homebrew/share/android-commandlinetools'
const PHONE = process.env.PHONE
if (!PHONE) { console.error('set PHONE=<adb serial>'); process.exit(2) }
const adb = (...a) => execFileSync(join(SDK, 'platform-tools', 'adb'), ['-s', PHONE, ...a], { encoding: 'utf8' }).trim()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const PORT = 9444
const mode = process.argv[2]
const args = process.argv.slice(3)

async function open () {
  const pid = adb('shell', 'pidof', 'app.kybernos.host').split(/\s+/)[0]
  if (!pid) { console.error('the app is not running'); process.exit(2) }
  adb('forward', 'tcp:' + PORT, 'localabstract:webview_devtools_remote_' + pid)
  const targets = await (await fetch('http://127.0.0.1:' + PORT + '/json')).json()
  const target = targets.find((x) => x.type === 'page' && /127\.0\.0\.1/.test(x.url))
  if (!target) { console.error('no page in the web view'); process.exit(2) }
  const page = await connect(target)
  const ev = async (js, ms) => { const r = await page.evalJs(js, ms || 20000); if (r.err) throw new Error(r.err); return r.val }
  return { page, ev, close: () => { page.close(); try { adb('forward', '--remove', 'tcp:' + PORT) } catch (e) { /* already gone */ } } }
}

async function load () {
  const { ev, close } = await open()
  console.log('page ready state:', await ev('document.readyState'))
  console.log('navigation timing (ms):', JSON.stringify(await ev(`(() => { const n = performance.getEntriesByType('navigation')[0]; return n ? { ttfb: Math.round(n.responseStart), domInteractive: Math.round(n.domInteractive), domComplete: Math.round(n.domComplete), load: Math.round(n.loadEventEnd) } : null })()`)))
  const res = await ev(`(() => { const r = performance.getEntriesByType('resource'); const js = r.filter(e => /\\.js(\\?|$)/.test(e.name)); return { count: r.length, totalKB: Math.round(r.reduce((s, e) => s + (e.transferSize || 0), 0) / 1024), jsCount: js.length, jsKB: Math.round(js.reduce((s, e) => s + (e.transferSize || 0), 0) / 1024), slowest: r.slice().sort((a, b) => b.duration - a.duration).slice(0, 8).map(e => ({ n: e.name.replace(/^https?:\\/\\/[^/]+/, '').slice(0, 60), ms: Math.round(e.duration), kb: Math.round((e.transferSize || 0) / 1024) })) } })()`)
  console.log('resources:', JSON.stringify(res, null, 1))

  // round trips to the engine, from the page itself (what every screen of the interface does): the cheapest route, a list, repeated
  const rtt = await ev(`(async () => {
    const one = async (path, init) => { const t0 = performance.now(); const r = await fetch(path, init); await r.text(); return Math.round(performance.now() - t0) }
    const out = {}
    for (const [name, path, init] of [['GET /', '/', undefined], ['POST tasks list', '/kybernos/tasks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'list' }) }]]) {
      const xs = []
      for (let i = 0; i < 6; i++) xs.push(await one(path, init))
      xs.sort((a, b) => a - b)
      out[name] = { min: xs[0], median: xs[3], max: xs[5] }
    }
    return out
  })()`, 60000)
  console.log('engine round trips (ms), 6 each:', JSON.stringify(rtt))

  // main-thread jank while idle and while the page is being used: long tasks, and the frame cadence of a scripted scroll
  const jank = await ev(`new Promise((resolve) => {
    const tasks = []
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) tasks.push(Math.round(e.duration)) }).observe({ entryTypes: ['longtask'] }) } catch (e) {}
    const frames = []; let last = performance.now(); const t0 = last
    const tick = (now) => { frames.push(now - last); last = now; if (now - t0 < 3000) requestAnimationFrame(tick); else resolve({ idleFrames: frames.length, worstFrameMs: Math.round(Math.max(...frames)), over50ms: frames.filter(f => f > 50).length, longTasks: tasks }) }
    requestAnimationFrame(tick)
  })`, 20000)
  console.log('3 s idle:', JSON.stringify(jank))

  // what the page costs: DOM size and heap
  console.log('page cost:', JSON.stringify(await ev(`({ nodes: document.getElementsByTagName('*').length, heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null, styleSheets: document.styleSheets.length, scripts: document.scripts.length })`)))
  close()
}

async function taps () {
  const { ev, close } = await open()
  await ev(`(() => { window.__m = { ev: [], lt: [], t0: performance.now() }
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__m.ev.push({ type: e.name, ms: Math.round(e.duration), delay: Math.round(e.processingStart - e.startTime), proc: Math.round(e.processingEnd - e.processingStart), at: Math.round(e.startTime) }) }).observe({ type: 'event', durationThreshold: 16, buffered: false }) } catch (e) {}
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__m.lt.push({ ms: Math.round(e.duration), at: Math.round(e.startTime) }) }).observe({ entryTypes: ['longtask'] }) } catch (e) {}
  })()`)
  const steps = args
  for (const s of steps) {
    const at = s.lastIndexOf(':'); const label = s.slice(0, at); const xy = s.slice(at + 1)
    const mark = await ev('Math.round(performance.now())')
    if (xy.startsWith('swipe')) { const [x1, y1, x2, y2] = xy.replace('swipe', '').split(',').map(Number); adb('shell', 'input', 'swipe', x1, y1, x2, y2, '250') } else { const [x, y] = xy.split(',').map(Number); adb('shell', 'input', 'tap', x, y) }
    await sleep(2500)
    const m = await ev('JSON.stringify(window.__m)')
    const d = JSON.parse(m)
    const mine = d.ev.filter((e) => e.at >= mark)
    const lts = d.lt.filter((e) => e.at >= mark)
    const worst = mine.reduce((a, e) => Math.max(a, e.ms), 0)
    console.log(label.padEnd(22), 'worst felt:', String(worst).padStart(4), 'ms |', mine.map((e) => e.type + ' ' + e.ms + '(wait ' + e.delay + ', run ' + e.proc + ')').slice(0, 4).join('; '), '| long tasks:', lts.map((e) => e.ms).join(',') || '-')
  }
  close()
}

async function scroll () {
  const { ev, close } = await open()
  const scrollers = await ev(`JSON.stringify([...document.querySelectorAll('*')].filter(e => e.scrollHeight > e.clientHeight + 50 && /(auto|scroll)/.test(getComputedStyle(e).overflowY)).slice(0, 4).map(e => e.tagName + '.' + String(e.className).slice(0, 24) + ' ' + e.scrollHeight + '/' + e.clientHeight))`)
  console.log('scrollable areas:', scrollers)
  await ev(`(() => { window.__f = { frames: [], on: true, t0: performance.now() }; let last = performance.now(); const tick = (n) => { if (!window.__f.on) return; window.__f.frames.push(n - last); last = n; requestAnimationFrame(tick) }; requestAnimationFrame(tick) })()`)
  for (let i = 0; i < 3; i++) { adb('shell', 'input', 'swipe', '600', '2000', '600', '700', '300'); await sleep(700); adb('shell', 'input', 'swipe', '600', '700', '600', '2000', '300'); await sleep(700) }
  const r = JSON.parse(await ev(`(() => { window.__f.on = false; const f = window.__f.frames.slice(); f.sort((a, b) => a - b); return JSON.stringify({ frames: f.length, medianMs: Math.round(f[Math.floor(f.length / 2)] * 10) / 10, p95Ms: Math.round(f[Math.floor(f.length * 0.95)]), worstMs: Math.round(f[f.length - 1]), over33ms: f.filter(x => x > 33).length, over100ms: f.filter(x => x > 100).length }) })()`))
  console.log('during 6 swipes (about 4 s of finger movement):', JSON.stringify(r))
  close()
}

const modes = { load, taps, scroll }
if (!modes[mode]) { console.error('usage: PHONE=<serial> node phone-perf.mjs load | taps "label:x,y" ... | scroll'); process.exit(2) }
await modes[mode]()

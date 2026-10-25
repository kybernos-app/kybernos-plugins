// One real-device session on BrowserStack App Automate through plain W3C WebDriver calls (no library): first launch, the self-test automation across a background period, and the return.
// Reads what the app's self-test hook shows in its native label ("selftest: ..."), see mobile/ios/Sources/SelfTest.swift. Returns the measurements; writes log.txt, screenshots and result.json into outDir.
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { HUB, authHeader, redact } from './lib.mjs'

const STATE = { 1: 'not running', 2: 'background, suspended', 3: 'background', 4: 'foreground' }
const labelOf = (xml) => { const m = /label="([^"]*(?:First launch|Starting|engine stopped)[^"]*)"/.exec(xml); return m ? m[1] : null }
const selftestOf = (xml) => { const m = /label="(selftest:[^"]*)"/.exec(xml); return m ? m[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"') : null }
const pageUp = (xml) => /Welcome to Kybernos|Get started|One sentence is enough|Preview Notice/.test(xml)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export const runSession = async ({ appUrl, device = 'iPhone 18 Pro', osVersion = '27', outDir, bundleId = 'app.kybernos.host', expectAnswer = false, maxMinutes = 9.5 }) => {
  mkdirSync(outDir, { recursive: true })
  const T0 = Date.now(); const DEADLINE = T0 + Math.min(maxMinutes, 9.5) * 60 * 1000
  const log = (m) => { const l = '[' + ((Date.now() - T0) / 1000).toFixed(1).padStart(6) + 's] ' + redact(m); console.log(l); appendFileSync(join(outDir, 'log.txt'), l + '\n') }
  const result = { device, osVersion, appUrl, startedAt: new Date(T0).toISOString() }
  const wd = async (method, path, body, timeoutMs = 60000) => {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeoutMs)
    try {
      const r = await fetch(HUB + path, { method, headers: { Authorization: authHeader(), 'content-type': 'application/json', accept: 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: ctl.signal })
      const text = await r.text(); let json = null; try { json = JSON.parse(text) } catch { /* not json */ }
      return { status: r.status, json, text }
    } finally { clearTimeout(t) }
  }
  let sid = null
  const stop = async (why) => { if (sid === null) return; const s = sid; sid = null; try { const r = await wd('DELETE', '/session/' + s, undefined, 30000); log('session stopped (' + why + '), HTTP ' + r.status) } catch (e) { log('stop failed: ' + e.message) } }
  const hard = setTimeout(async () => { log('time limit reached'); await stop('limit'); process.exit(0) }, DEADLINE - Date.now())
  const shot = async (name) => { const r = await wd('GET', '/session/' + sid + '/screenshot'); if (r.json?.value) { writeFileSync(join(outDir, name + '.png'), Buffer.from(r.json.value, 'base64')); log('screenshot ' + name + '.png') } }
  const source = async () => (await wd('GET', '/session/' + sid + '/source')).json?.value ?? ''
  const exec = async (script, args = []) => (await wd('POST', '/session/' + sid + '/execute/sync', { script, args })).json?.value
  const appState = async () => { try { return await exec('mobile: queryAppState', [{ bundleId }]) } catch { return '?' } }

  try {
    const caps = { capabilities: { alwaysMatch: { platformName: 'ios', 'appium:deviceName': device, 'appium:platformVersion': osVersion, 'appium:automationName': 'XCUITest', 'appium:app': appUrl, 'appium:autoAcceptAlerts': true, 'bstack:options': { projectName: 'Kybernos', buildName: 'mobile-host', sessionName: 'self-test', deviceLogs: true, video: true, networkLogs: false, idleTimeout: 150 } } } }
    log('requesting a session on ' + device + ' iOS ' + osVersion)
    const c = await wd('POST', '/session', caps, 5 * 60 * 1000)
    if (c.status >= 400 || !c.json?.value?.sessionId) { result.error = 'session creation failed: HTTP ' + c.status + ' ' + redact(c.text).slice(0, 400); log(result.error); return result }
    sid = c.json.value.sessionId
    result.sessionId = sid; result.sessionReadyS = (Date.now() - T0) / 1000
    log('session ready after ' + result.sessionReadyS.toFixed(1) + ' s; app state: ' + (STATE[await appState()] ?? '?'))
    const launchedAt = Date.now()
    await shot('01-just-launched')

    // 1. first launch: follow the native start-up text, wait for the web page and for the self-test automation to be created
    let lastLabel = null; let lastSelf = null; let pageAt = null; const samples = []
    while (Date.now() < DEADLINE - 6 * 60 * 1000) {
      const xml = await source(); const label = labelOf(xml); const st = selftestOf(xml)
      if (label !== lastLabel) { samples.push([(Date.now() - launchedAt) / 1000, label]); log('start-up text: ' + (label ?? '(none)')); lastLabel = label }
      if (st !== lastSelf) { log('selftest label: ' + st); lastSelf = st }
      if (pageUp(xml) && pageAt === null) { pageAt = (Date.now() - launchedAt) / 1000; log('the Kybernos page is on screen ' + pageAt.toFixed(1) + ' s after the first look') }
      if (st && /created, due/.test(st)) break
      if (label && /engine stopped/.test(label)) break
      await sleep(2000)
    }
    result.pageOnScreenS = pageAt; result.startupSamples = samples
    await shot(pageAt === null ? '02-not-ready' : '02-page-ready')

    // 2. home screen before the automation falls due; watch what the system does to the app
    const m = /due (\d\d):(\d\d) UTC/.exec(lastSelf ?? '')
    if (!m) { result.error = 'no self-test label with a due time: was the build made with SELFTEST_DELAY?'; log(result.error); return result }
    const now = new Date(); let dueMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), +m[1], +m[2], 0)
    if (dueMs < Date.now() - 12 * 3600 * 1000) dueMs += 86400000
    log('automation due ' + m[1] + ':' + m[2] + ' UTC, in ' + ((dueMs - Date.now()) / 1000).toFixed(0) + ' s')
    const homeAt = Date.now()
    await exec('mobile: pressButton', [{ name: 'home' }])
    const states = []
    for (const wait of [3, 10, 20, 30, 45, 60, 80, 100, 120]) {
      if (Date.now() > dueMs + 45000 && wait > 45) break
      while (Date.now() < homeAt + wait * 1000) await sleep(500)
      const s = await appState(); states.push([wait, STATE[s] ?? s]); log('in background +' + wait + ' s: ' + (STATE[s] ?? s))
      if (Date.now() > DEADLINE - 100 * 1000) break
    }
    while (Date.now() < dueMs + 40000 && Date.now() < DEADLINE - 100 * 1000) { await appState(); await sleep(8000) }
    result.backgroundStates = states
    result.suspendedAtS = (states.find(([, s]) => /suspended/.test(s)) ?? [null])[0]
    const backAt = Date.now()
    await exec('mobile: activateApp', [{ bundleId }])
    result.returnedAfterDueS = (backAt - dueMs) / 1000
    log('back in the foreground ' + result.returnedAfterDueS.toFixed(0) + ' s after the due time')

    // 3. catch-up: the overdue automation fires, and with a model key it answers
    let final = null
    for (let i = 0; i < 50 && Date.now() < DEADLINE - 30000; i++) {
      await sleep(2000)
      const st = selftestOf(await source())
      if (st !== lastSelf) { log('selftest label (+' + ((Date.now() - backAt) / 1000).toFixed(0) + ' s after the return): ' + st); lastSelf = st }
      if (st && (expectAnswer ? /answer check/.test(st) : /(fired|error) at/.test(st))) { final = st; result.catchUpS = (Date.now() - backAt) / 1000; break }
    }
    await shot('03-after-return')
    result.finalLabel = final ?? lastSelf
    result.fired = /fired at/.test(result.finalLabel ?? '')
    result.answerFound = /found [1-9]/.test(result.finalLabel ?? '')
    log('RESULT: ' + result.finalLabel)
  } catch (e) {
    result.error = redact(e && e.message)
    log('error: ' + result.error)
  } finally {
    clearTimeout(hard)
    await stop('done')
    result.totalS = (Date.now() - T0) / 1000
    result.verdict = {
      pageWithin30s: result.pageOnScreenS !== null && result.pageOnScreenS !== undefined && result.pageOnScreenS <= 30,
      suspendedInBackground: result.suspendedAtS !== null && result.suspendedAtS !== undefined,
      overdueAutomationFiredOnReturn: result.fired === true,
      modelAnswered: expectAnswer ? result.answerFound === true : null,
    }
    writeFileSync(join(outDir, 'result.json'), JSON.stringify(result, null, 2) + '\n')
    log('total ' + result.totalS.toFixed(0) + ' s; verdict ' + JSON.stringify(result.verdict))
  }
  return result
}

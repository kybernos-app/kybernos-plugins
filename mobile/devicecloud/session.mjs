// One real-device session on BrowserStack App Automate through plain W3C WebDriver calls (no library), iPhone or Android: first launch, the self-test automation across a background period,
// and the return. Reads what the app's self-test hook shows in its on-screen label ("selftest: ...", see mobile/app/src/selftest.ts); platform differences live in platforms.mjs.
// Returns the measurements; writes log.txt, screenshots and result.json into outDir.
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { HUB, authHeader, redact } from './lib.mjs'
import { PLATFORMS, parseSelfTestTimes } from './platforms.mjs'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export const runSession = async ({ platform = 'ios', appUrl, device, osVersion, outDir, expectAnswer = false, maxMinutes = 9.5 }) => {
  const P = PLATFORMS[platform]
  if (P === undefined) throw new Error('unknown platform ' + platform)
  device = device ?? P.defaultDevice; osVersion = osVersion ?? P.defaultOs
  const STATE = P.states; const labelOf = P.bootText; const selftestOf = P.selfTestText; const pageUp = P.pageUp
  mkdirSync(outDir, { recursive: true })
  const T0 = Date.now(); const DEADLINE = T0 + Math.min(maxMinutes, 9.5) * 60 * 1000
  const log = (m) => { const l = '[' + ((Date.now() - T0) / 1000).toFixed(1).padStart(6) + 's] ' + redact(m); console.log(l); appendFileSync(join(outDir, 'log.txt'), l + '\n') }
  const result = { platform, device, osVersion, appUrl, startedAt: new Date(T0).toISOString() }
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
  // one control: the first alternative that does not answer with an error wins; the error of the last one is kept so a run says what the device cloud refused
  const act = async (alternatives) => {
    let lastError = 'no alternative'
    for (const a of alternatives) {
      const r = a.script !== undefined ? await wd('POST', '/session/' + sid + '/execute/sync', { script: a.script, args: a.args ?? [] }) : await wd('POST', '/session/' + sid + a.path, a.body ?? {})
      const v = r.json?.value
      const failed = r.status >= 400 || (v !== null && typeof v === 'object' && typeof v.error === 'string') || (typeof r.json?.status === 'number' && r.json.status !== 0)
      if (!failed) return { ok: true, value: v }
      lastError = String(a.script ?? a.path) + ': ' + redact(String(v?.message ?? r.text)).slice(0, 160)
    }
    return { ok: false, error: lastError }
  }
  const controlErrors = []
  const appState = async () => { const r = await act(P.queryState(P.appId)); if (r.ok) return r.value; if (!controlErrors.includes(r.error)) controlErrors.push(r.error); return '?' }

  try {
    const caps = { capabilities: { alwaysMatch: { ...P.capabilities({ device, osVersion, appUrl }), 'bstack:options': { projectName: 'Kybernos', buildName: 'mobile-host', sessionName: 'self-test', deviceLogs: true, video: true, networkLogs: false, idleTimeout: 150 } } } }
    log('requesting a session on ' + device + ' ' + P.label + ' ' + osVersion)
    const c = await wd('POST', '/session', caps, 5 * 60 * 1000)
    if (c.status >= 400 || !c.json?.value?.sessionId) { result.error = 'session creation failed: HTTP ' + c.status + ' ' + redact(c.text).slice(0, 400); log(result.error); return result }
    sid = c.json.value.sessionId
    result.sessionId = sid; result.sessionReadyS = (Date.now() - T0) / 1000
    log('session ready after ' + result.sessionReadyS.toFixed(1) + ' s; app state: ' + (STATE[await appState()] ?? '?'))
    const launchedAt = Date.now()
    await shot('01-just-launched')

    // 1. first launch: follow the native start-up text, wait for the web page and for the self-test automation to be created
    let lastLabel = null; let lastSelf = null; let pageAt = null; let lastDiagAt = 0; const samples = []
    while (Date.now() < DEADLINE - 6 * 60 * 1000) {
      const xml = await source(); const label = labelOf(xml); const st = selftestOf(xml)
      if (label !== lastLabel) { samples.push([(Date.now() - launchedAt) / 1000, label]); log('start-up text: ' + (label ?? '(none)')); lastLabel = label }
      if (st !== lastSelf) { log('selftest label: ' + st); lastSelf = st }
      // a start that hangs says where, every 30 s: the boot screen shows the engine's status, its log tail and the last probe
      const diag = P.engineLog(xml)
      if (diag !== null && Date.now() - lastDiagAt > 30000) { lastDiagAt = Date.now(); log('boot screen: ' + diag.replace(/\n/g, ' | ')); result.bootScreen = diag }
      if ((pageUp(xml) || (P.labelMeansReady && st !== null)) && pageAt === null) { pageAt = (Date.now() - launchedAt) / 1000; log('the Kybernos page is on screen ' + pageAt.toFixed(1) + ' s after the first look') }
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
    const home = await act(P.goHome())
    result.wentToBackground = home.ok
    log(home.ok ? 'sent the app to the background' : 'COULD NOT send the app to the background: ' + home.error)
    if (!home.ok) controlErrors.push(home.error)
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
    const back = await act(P.comeBack(P.appId))
    if (!back.ok) { controlErrors.push(back.error); log('COULD NOT bring the app back: ' + back.error) }
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
    result.controlErrors = controlErrors
    const times = parseSelfTestTimes(result.finalLabel)
    if (times.firedS !== null && times.dueS !== null) { result.firedAfterDueS = times.firedS - times.dueS; result.firedBeforeReturn = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + times.firedS * 1000 < backAt }
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
      wentToBackground: result.wentToBackground === true,
      suspendedInBackground: P.expectsSuspension ? (result.suspendedAtS !== null && result.suspendedAtS !== undefined) : null,
      overdueAutomationFiredOnReturn: result.fired === true,
      modelAnswered: expectAnswer ? result.answerFound === true : null,
    }
    writeFileSync(join(outDir, 'result.json'), JSON.stringify(result, null, 2) + '\n')
    log('total ' + result.totalS.toFixed(0) + ' s; verdict ' + JSON.stringify(result.verdict))
  }
  return result
}

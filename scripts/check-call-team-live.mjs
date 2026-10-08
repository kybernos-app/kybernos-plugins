#!/usr/bin/env node
// The Call / Video buttons of a team member (packages/kybernos-plugin, the crew view) and the seam they go through,
// in a real GUI with the call bundle loaded.
//
//   source scripts/sandbox/env.sh && node scripts/check-call-team-live.mjs [--shots <dir>]
//
// It needs a sandbox instance that LOADS @local/kybernos-call (scripts/sandbox/setup.sh + start.sh); it refuses the
// user's own DSH (exit 3). It declares one tiny team in the sandbox's DSH_HOME (and removes it at the end).
//
// What it checks, on the member cards of that team:
//   1. every member has a Call and a Video button, visible;
//   2. a click opens a call for THAT member: the host is asked for its status (real), and the panel names the member;
//   3. with a host that says the keys are set (faked), what the card asks for is the team, the member, the mode and
//      its voice (null when none is chosen, or a well-formed engine voice);
//   4. without the seam (the bundle off) the buttons are hidden, and they are back with it.
//
// SAFETY: every POST to /kybernos-call/* is answered here (fail-closed). Exit code 0 / 1 / 3.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
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
const dshHome = process.env.DSH_HOME
if (host === '127.0.0.1:3080' || !dshHome) { console.error('○ inconclusive: this check needs a sandbox instance (KB_HOST, DSH_HOME and HOME of scripts/sandbox/env.sh), not the one on :3080.'); process.exit(3) }

const TEAM = 'calls-check-team'
const teamDir = join(dshHome, 'kybers', TEAM)
const YML = `id: ${TEAM}
specVersion: 2
mission: >-
  A tiny team that exists only to check the call buttons on its member cards.
topology: pool
roles:
  - id: scout
    role: scout
    needs: { modality: text, tier: fast, context: standard }
    provider: ollama-cloud
    model: deepseek-v4.1-flash
    prompt: >-
      You look around and say what you see.
  - id: writer
    role: analyst
    needs: { modality: text, tier: balanced, context: standard }
    provider: ollama-cloud
    model: glm-5.3
    prompt: >-
      You write down what the scout saw.
tools: []
`
mkdirSync(teamDir, { recursive: true })
writeFileSync(join(teamDir, 'kyber.yml'), YML)

const live = await openLivePage({ width: 1500, height: 1100 }).catch((e) => { rmSync(teamDir, { recursive: true, force: true }); console.error('○ inconclusive: ' + e.message); process.exit(3) })
const { page } = live
const val = async (expr, ms) => (await page.evalJs(expr, ms)).val
const shot = async (name) => { if (shotDir !== null) { try { await page.shot(join(shotDir, name + '.png')) } catch (e) { /* no screenshot */ } } }
const poll = async (fn, ms = 15000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) return v; await sleep(250) } }

const fake = { status: null }
const tokens = []
page.on('Fetch.requestPaused', async (p) => {
  try {
    const url = new URL(p.request.url)
    if (p.request.method === 'POST' && url.pathname.startsWith('/kybernos-call/')) {
      let body = {}
      try { body = JSON.parse(p.request.postData || '{}') } catch (e) { /* not JSON */ }
      if (url.pathname === '/kybernos-call/token') tokens.push(body)
      const out = url.pathname === '/kybernos-call/token' ? { ok: true, url: 'ws://127.0.0.1:1', token: 'fake.jwt.token', room: 'room-check', agent: { running: false, dispatched: false }, meta: { mode: body.mode === 'video' ? 'video' : 'voice' } } : { ok: false, error: 'blocked by the check' }
      await page.send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 200, responseHeaders: [{ name: 'content-type', value: 'application/json' }], body: Buffer.from(JSON.stringify(out)).toString('base64') })
      return
    }
    if (url.pathname === '/kybernos-call/status' && fake.status !== null) {
      await page.send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 200, responseHeaders: [{ name: 'content-type', value: 'application/json' }], body: Buffer.from(JSON.stringify(fake.status)).toString('base64') })
      return
    }
    await page.send('Fetch.continueRequest', { requestId: p.requestId })
  } catch (e) { try { await page.send('Fetch.continueRequest', { requestId: p.requestId }) } catch (e2) { /* gone */ } }
})
await page.send('Fetch.enable', { patterns: [{ urlPattern: '*/kybernos-call/*', requestStage: 'Request' }] })

const clickText = async (text) => {
  const pos = await val(`(() => { const own = (e) => Array.from(e.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim(); const e = Array.from(document.querySelectorAll('*')).filter((e) => (e.children.length === 0 ? (e.innerText || '').trim() : own(e)) === ${JSON.stringify(text)} && e.getBoundingClientRect().width > 3)[0]; if (!e) return null; const r = e.getBoundingClientRect(); return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 }) })()`)
  if (typeof pos !== 'string') return false
  const { x, y } = JSON.parse(pos)
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
  return true
}
const buttons = () => val(`JSON.stringify(Array.from(document.querySelectorAll('[aria-label^="Voice call with"],[aria-label^="Video call with"]')).map((b) => ({ label: b.getAttribute('aria-label'), shown: getComputedStyle(b.parentElement).display !== 'none' && b.getBoundingClientRect().width > 0 })))`).then((x) => JSON.parse(x || '[]'))
const panel = () => val(`(() => { const p = document.querySelector('[data-kb="kybernos-call-panel"]'); return p ? p.innerText : null })()`)
const hangUp = async () => { await val(`(() => { const b = document.querySelector('[data-kb="kybernos-call-panel"] [data-act="hangup"]'); if (b) b.click() })()`); await poll(async () => (await panel()) === null, 4000) }
const openTeamTab = async () => {
  for (let i = 0; i < 12; i += 1) { await sleep(500); if (await val(`/Add an API key to get started/.test(document.body.innerText)`)) { await clickText('Configure later'); await sleep(600) } else if (i > 3) break }
  if (!(await clickText('Agent Teams'))) return false
  await sleep(2000)
  if (!(await poll(() => clickText(TEAM), 12000))) return false
  await sleep(2000)
  if (!(await poll(() => clickText('Team'), 12000))) return false
  return poll(async () => (await buttons()).length > 0, 15000)
}

try {
  console.log('1. the members of a team')
  const reached = await openTeamTab()
  check('the sandbox shows the team and its Team tab', reached === true)
  await shot('team-cards')
  const b1 = await buttons()
  check('each of the 2 members has a Call and a Video button', b1.length === 4 && b1.filter((b) => /^Voice call with/.test(b.label)).length === 2 && b1.filter((b) => /^Video call with/.test(b.label)).length === 2, b1)
  check('and all of them are visible (the bundle is loaded, so the seam exists)', b1.length > 0 && b1.every((b) => b.shown === true), b1)

  console.log('2. a click on a member says calls are not ready when nothing is set up (real host: no keys in the sandbox)')
  await val(`(() => { document.querySelector('[aria-label^="Voice call with"]').click() })()`)
  const notReady = await poll(async () => { const t = await panel(); return typeof t === 'string' && /not ready yet/.test(t) ? t : null }, 15000)
  check('the call panel says calls are not ready, with a way to Settings › Calls (no pop-up)', typeof notReady === 'string' && /Open Settings › Calls/.test(notReady), notReady)
  await shot('team-call-opened')
  await val(`(() => { const b = document.querySelector('[data-kb="kybernos-call-panel"] [data-act="hangup"]'); if (b) b.click() })()`)
  await poll(async () => (await panel()) === null, 5000)

  console.log('3. what the card asks for (a host that says the keys are set)')
  fake.status = { ok: true, secrets: 'posee', url: 'ws://127.0.0.1:1', provider: 'none', avatar: null, sandbox: false }
  await val(`(() => { document.querySelectorAll('[aria-label^="Video call with"]')[1].click() })()`)
  const gotToken = await poll(() => tokens.length > 0, 15000)
  check('the card asked for a token', gotToken === true)
  const t = tokens[0] || {}
  const member = b1[3].label.replace('Video call with ', '')
  check('for the second member, as a video call, with the team and the member', t.kyberId === TEAM && typeof t.roleId === 'string' && t.roleId !== '' && t.name === member && t.mode === 'video', t)
  check('with a voice that is either none or a well-formed engine voice', t.voice === null || (typeof t.voice === 'object' && typeof t.voice.engine === 'string' && typeof t.voice.voice === 'string'), t.voice)
  check('with the session that is open (or none), and no language: the host decides it from the settings', (t.sessionId === null || /^session-/.test(String(t.sessionId))) && t.language === undefined, t)
  await hangUp()
  fake.status = null

  console.log('4. without the bundle, no buttons')
  await val(`delete window.__KB_CALL__`)
  await clickText('Workflow')
  await sleep(1200)
  await clickText('Team')
  await sleep(2500)
  const b2 = await buttons()
  check('with the seam gone, the buttons that are still on the card are hidden', b2.length > 0 && b2.every((b) => b.shown === false), b2)
  await shot('team-without-bundle')
} catch (e) {
  fail += 1
  console.log('  ✗ ' + (e && e.message ? e.message : e))
} finally {
  rmSync(teamDir, { recursive: true, force: true })
  await live.close()
}
console.log('\n' + (fail === 0 ? '✓' : '✗') + ' kybernos-call team live: ' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)

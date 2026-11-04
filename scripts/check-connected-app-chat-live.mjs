#!/usr/bin/env node
// J11-07: an agent uses a connected app (the stand-in GitHub of the replica) from a chat. In an ordinary chat and in Kaby's own chat: is the person asked, what does the card say,
// what runs when she allows, what happens when she refuses, what she reads when the provider fails and when the connection has expired.
//
//   export KB_E2E_API=… KB_E2E_WEB=… KB_E2E_CONTROL=… KB_E2E_DIR=… KB_SERVER_DIR=…        (a replica made by scripts/user-journey-replica.sh, REPLICA_COMPOSIO=1 is on there)
//   export KB_PROXY_LOG=<file of scripts/recording-proxy.mjs in front of the replica> DSH_API=http://localhost:<its port>   (the sandbox DSH talks to the proxy; the proxy scripts the model's tool calls)
//   KB_SANDBOX_ROOT=… KB_SANDBOX_PORT=… source scripts/sandbox/env.sh                       (a sandbox signed in to that replica as an account that may connect an app)
//   node scripts/check-connected-app-chat-live.mjs [--out <folder>]
//
// The model is a SCRIPTED STAND-IN: the proxy answers the next agent turn with the tool call this file asks for (POST /__proxy/script), the replica answers the turn that follows with a
// fixed sentence. What is tested is therefore the product around the model: the card, the gate, the call, what is shown. The stand-in executes nothing outside the machine; a made-up
// repository name is all it is given. Sandbox only: it refuses :3080 (exit 3) and any DSH home that is not under .kybernos-sandbox. Exit 0 = every check passed, 1 = a check failed,
// 3 = wrong environment. Report: <out>/report.json.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { cookieDeSession } from './cdp-lib.mjs'
import { openGui, readProxy, sleep } from './lib-e2e-gui.mjs'

const arg = (n, d) => (process.argv.indexOf(n) >= 0 ? process.argv[process.argv.indexOf(n) + 1] : d)
const host = process.env.KB_HOST || ''
const home = process.env.DSH_HOME || ''
if (host === '' || /:3080$/.test(host) || !home.includes('.kybernos-sandbox')) { console.error('not run: source scripts/sandbox/env.sh of a sandbox first (KB_HOST=' + host + ')'); process.exit(3) }
if (!process.env.KB_E2E_CONTROL || !process.env.KB_E2E_DIR || !process.env.KB_PROXY_LOG || !process.env.DSH_API) { console.error('not run: KB_E2E_CONTROL, KB_E2E_DIR, KB_PROXY_LOG and DSH_API are not set'); process.exit(3) }
const out = arg('--out', join(process.env.KB_E2E_DIR, '..', 'j11-07'))
mkdirSync(out, { recursive: true })
const ctl = process.env.KB_E2E_CONTROL
const proxy = process.env.DSH_API
const stamp = Date.now().toString(36)

const results = []
const report = {}
const check = (name, ok, detail) => { results.push({ name, ok: ok === true, detail }); console.log((ok === true ? '  ok   ' : '  FAIL ') + name + (ok === true || detail === undefined ? '' : '  -> ' + JSON.stringify(detail).slice(0, 300))); return ok === true }
const note = (t) => console.log('  ..   ' + t)
const c = cookieDeSession(host)
if (c === null) { console.error('not run: no browser-session secret for this DSH_HOME'); process.exit(3) }
const hostCall = async (method, path, body) => { const r = await fetch('http://' + host + path, { method, headers: { 'content-type': 'application/json', cookie: c.nom + '=' + c.valeur, origin: 'http://' + host }, body: method === 'GET' ? undefined : JSON.stringify(body || {}) }); const t = await r.text(); try { return JSON.parse(t) } catch (e) { return { raw: t.slice(0, 200) } } }
const stand = async () => (await (await fetch(ctl + '/__/composio')).json())
const executions = async () => (await stand()).executions
const setStatus = (id, status) => fetch(ctl + '/__/composio/status', { method: 'POST', body: JSON.stringify({ id, status }) })
const script = (args) => fetch(proxy + '/__proxy/script', { method: 'POST', body: JSON.stringify({ tool_calls: [{ name: 'connections_execute', arguments: args }] }) })
const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim()

// ── the connected app: a GitHub of the stand-in, active ─────────────────────────────────────────────────────────────────────────────
const st = await hostCall('GET', '/kybernos-cloud/status')
if (st.connected !== true) { console.error('not run: the sandbox is not signed in to the replica'); process.exit(3) }
let list = await hostCall('GET', '/kybernos-cloud/connections')
if (list.offered !== true) { console.error('not run: the server does not offer connections (REPLICA_COMPOSIO=1 ?)'); process.exit(3) }
let gh = (list.connections || []).find((x) => x.toolkit === 'github')
if (!gh) {
  const link = await hostCall('POST', '/kybernos-cloud/connections/link', { toolkit: 'github' })
  note('link: ' + JSON.stringify({ ok: link.ok, status: link.connection && link.connection.status }))
  const acc = (await stand()).accounts.filter((a) => a.toolkit === 'github')
  for (const a of acc) await setStatus(a.id, 'ACTIVE')
}
for (let i = 0; i < 20; i += 1) { list = await hostCall('GET', '/kybernos-cloud/connections'); gh = (list.connections || []).find((x) => x.toolkit === 'github'); if (gh && gh.status === 'active') break; await sleep(3000) }
check('a GitHub of the stand-in is connected and active', !!gh && gh.status === 'active', gh)
const standAccount = (await stand()).accounts.find((a) => a.toolkit === 'github')
report.account = standAccount ? { toolkit: standAccount.toolkit, status: standAccount.status } : null
let g = null
const shots = []
const shot = async (name) => { const p = join(out, name + '.png'); await g.shot(p); shots.push(p); return p }
// the tool answer the MODEL got back after a tool call asked at/after `since`
const modelGot = async (since) => {
  const rows = readProxy(process.env.KB_PROXY_LOG, since).filter((r) => r.method === 'POST' && r.path === '/v1/chat/completions')
  for (const r of rows.reverse()) {
    let b = null
    try { b = JSON.parse(r.body || '') } catch (e) { continue }
    const tool = ((b && b.messages) || []).filter((m) => m.role === 'tool').pop()
    if (tool) return clean(typeof tool.content === 'string' ? tool.content : JSON.stringify(tool.content))
  }
  return null
}
const readChat = async () => clean(await g.body())
const cardOf = async () => g.val(`(() => { const b = Array.from(document.querySelectorAll('button')).find((x) => /^Allow once$/.test((x.innerText || '').trim())); if (!b) return null; let box = b; for (let i = 0; i < 6 && box.parentElement; i += 1) { box = box.parentElement; if (/Waiting for approval/.test(box.innerText || '')) break } const r = box.getBoundingClientRect(); return { text: (box.innerText || '').replace(/\\s+/g, ' ').trim(), rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)], buttons: Array.from(box.querySelectorAll('button')).map((x) => (x.innerText || '').trim()).filter(Boolean) } })()`)
const kabyNav = async () => { const p = await g.val(`(() => { const e = Array.from(document.querySelectorAll('*')).filter((e) => e.children.length === 0 && (e.innerText || '').trim() === 'Kaby').find((e) => e.getBoundingClientRect().top < 200); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`); if (!p || p.err) return false; await g.mouse(p.x, p.y); await sleep(2500); return true }
const ask = async (message, args) => {
  await script(args)
  const at = Date.now()
  await g.send(message)
  return at
}
const waitExec = async (before, ms = 15000) => g.until(async () => ((await executions()) > before ? true : null), ms, 300)

try {
  g = await openGui(host)
  await sleep(3000)
  note('the card of the window says ' + JSON.stringify((await g.card()) && (await g.card()).text))

  // ── A. an ordinary chat ──────────────────────────────────────────────────────────────────────────────────────────────────────────
  console.log('\nA. an ordinary chat')
  // Full access runs with the approval policy « never » (the person chose not to be asked: the engine rejects every card, so none is raised); the two other modes ask. Journey UJ-203:
  // before the gate, the app ran with no card in every mode, Read Only included.
  const unfold = async (mode, tag) => {
    const folded = await g.val(`(() => { const e = Array.from(document.querySelectorAll('*')).filter((e) => e.children.length <= 2 && /^Completed in/.test((e.innerText || '').trim())).pop(); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + 20, y: r.top + r.height / 2 } })()`)
    if (folded) { await g.mouse(folded.x, folded.y); await sleep(900) }
    const open = clean(await g.body())
    await shot('a-' + tag + '-unfolded')
    note('ordinary chat ' + mode + ', unfolded, says: ' + JSON.stringify(open.slice(-300)))
    return open
  }
  for (const mode of ['Full access', 'Workspace Write', 'Read Only']) {
    const tag = mode.replace(/\s+/g, '-').toLowerCase()
    await g.pressText('New chat'); await sleep(1800)
    if (mode !== 'Full access') { await g.pressText('Full access'); await sleep(600); await g.pressText(mode); await sleep(600) }
    await g.selectModel('GLM')
    const before = await executions()
    const at = await ask('Open an issue on GitHub titled A ' + mode + ' ' + stamp, { tool_slug: 'GITHUB_CREATE_AN_ISSUE', params: { repo: 'replica-test/demo', title: 'A ' + mode + ' ' + stamp } })
    if (mode === 'Full access') {
      const ran = await waitExec(before)
      await sleep(2500)
      const asked = await cardOf()
      await shot('a-' + tag)
      const got = await modelGot(at)
      report['ordinary ' + mode] = { ran: ran === true, asked, modelGot: got, page: (await readChat()).slice(-400) }
      check('ordinary chat, ' + mode + ': the person chose never to be asked, so the app action runs with no card (the stand-in executed once)', ran === true && asked === null && (await executions()) === before + 1, { before, after: await executions(), asked })
      check('ordinary chat, ' + mode + ': the model got the provider\'s answer back', typeof got === 'string' && got.includes('"ok":true'), got)
      report['ordinary ' + mode].unfolded = (await unfold(mode, tag)).slice(-700)
      continue
    }
    const card = await g.until(async () => cardOf(), 20000, 400)
    await sleep(2500)
    await shot('a-' + tag + '-card')
    const waiting = await executions()
    report['ordinary ' + mode] = { card, executionsWhileWaiting: waiting - before }
    check('ordinary chat, ' + mode + ': a card asks first (« Allow once » and Reject) and nothing is executed while it waits', !!card && waiting === before, { card, before, waiting })
    check('ordinary chat, ' + mode + ': the card says which app and what it will do', !!card && /github: create an issue/i.test(card.text) && card.text.includes('A ' + mode + ' ' + stamp), card && card.text)
    const pressed = await g.pressText('Allow once')
    await sleep(5000)
    const got = await modelGot(at)
    check('ordinary chat, ' + mode + ': Allow once runs it once and the model gets the provider\'s answer', pressed === true && (await executions()) === before + 1 && typeof got === 'string' && got.includes('"ok":true'), { pressed, before, after: await executions(), got })
    await shot('a-' + tag + '-after')
    if (mode === 'Read Only') {
      // Reject, in a chat of its own.
      await g.pressText('New chat'); await sleep(1800)
      await g.pressText('Full access'); await sleep(600); await g.pressText('Read Only'); await sleep(600)
      await g.selectModel('GLM')
      const b2 = await executions()
      const at2 = await ask('Open an issue on GitHub titled A reject ' + stamp, { tool_slug: 'GITHUB_CREATE_AN_ISSUE', params: { repo: 'replica-test/demo', title: 'A reject ' + stamp } })
      const card2 = await g.until(async () => cardOf(), 20000, 400)
      const rejected = card2 ? await g.pressText('Reject') : false
      await sleep(5000)
      const got2 = await modelGot(at2)
      report['ordinary reject'] = { card: card2, modelGot: got2 }
      check('ordinary chat, Read Only: Reject executes nothing and the card is gone', !!card2 && rejected === true && (await executions()) === b2 && (await cardOf()) === null, { card: !!card2, rejected, b2, after: await executions() })
      check('ordinary chat, Read Only: the model is told the person refused', typeof got2 === 'string' && /reject|refus/i.test(got2), got2)
      await shot('a-reject-after')
    }
  }

  // ── B. Kaby's own chat ───────────────────────────────────────────────────────────────────────────────────────────────────────────
  console.log('\nB. Kaby\'s own chat')
  const scenario = async (label, args, press, expectRuns) => {
    await kabyNav()
    await g.selectModel('GLM')
    const before = await executions()
    const at = await ask(label + ' ' + stamp, args)
    const card = await g.until(async () => cardOf(), 20000, 400)
    const waiting = card ? { ...card } : null
    await sleep(2500)
    const during = await executions()
    if (waiting) await shot('b-' + label.toLowerCase().replace(/\W+/g, '-') + '-card')
    let pressed = false
    if (waiting && press) { pressed = await g.pressText(press); await sleep(5000) }
    const after = await executions()
    const page = (await readChat())
    await shot('b-' + label.toLowerCase().replace(/\W+/g, '-') + '-after')
    // fold-out of the call row, when there is one
    const row = await g.val(`(() => { const e = Array.from(document.querySelectorAll('*')).filter((e) => e.children.length === 0 && /^(Tool call|Completed in|Stopped|Failed|Error)/.test((e.innerText || '').trim())).pop(); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + 10, y: r.top + r.height / 2 } })()`)
    if (row) { await g.mouse(row.x, row.y); await sleep(900) }
    const unfolded = clean(await g.body())
    await shot('b-' + label.toLowerCase().replace(/\W+/g, '-') + '-unfolded')
    const got = await modelGot(at)
    return { before, during, after, card: waiting, pressed, page: page.slice(-700), unfolded: unfolded.slice(-900), modelGot: got, expectRuns }
  }
  const b1 = await scenario('Allow', { tool_slug: 'GITHUB_CREATE_AN_ISSUE', params: { repo: 'replica-test/demo', title: 'B allow ' + stamp } }, 'Allow once', true)
  report.allow = b1
  note('the card says ' + JSON.stringify(b1.card && b1.card.text))
  check('Kaby\'s chat asks first: a card « Waiting for approval » with Reject and Allow once, nothing executed while it waits', !!b1.card && b1.card.buttons.includes('Reject') && b1.card.buttons.includes('Allow once') && b1.during === b1.before, { buttons: b1.card && b1.card.buttons, before: b1.before, during: b1.during })
  check('the card names the call by its tool, its action slug and its arguments as JSON (the words the model used)', !!b1.card && /connections_execute \{"tool_slug":"GITHUB_CREATE_AN_ISSUE"/.test(b1.card.text), b1.card && b1.card.text)
  check('the card says in plain words which app it is and what will be done (« GitHub », not only the slug and a JSON text)', !!b1.card && /GitHub/.test(b1.card.text.replace(/GITHUB_CREATE_AN_ISSUE/g, '')), b1.card && b1.card.text)
  check('Allow once runs the action once and the model gets the provider\'s answer', b1.after === b1.before + 1 && typeof b1.modelGot === 'string' && b1.modelGot.includes('"ok":true'), { before: b1.before, after: b1.after, modelGot: b1.modelGot })

  const b2 = await scenario('Deny', { tool_slug: 'GITHUB_CREATE_AN_ISSUE', params: { repo: 'replica-test/demo', title: 'B deny ' + stamp } }, 'Reject', false)
  report.deny = b2
  check('Reject: nothing is executed and the card is gone', b2.pressed === true && b2.after === b2.before && !/Waiting for approval/.test(b2.page), { before: b2.before, after: b2.after, pressed: b2.pressed })
  note('what the model was told after Reject: ' + JSON.stringify(b2.modelGot))
  note('what the page says after Reject: ' + JSON.stringify(b2.unfolded.slice(-450)))

  const b3 = await scenario('Fail', { tool_slug: 'GITHUB_CREATE_AN_ISSUE', params: { repo: 'replica-test/demo', title: 'B fail ' + stamp, fail: true } }, 'Allow once', true)
  report.providerFails = b3
  check('the provider fails after Allow once: the action was tried once', b3.after === b3.before + 1, { before: b3.before, after: b3.after })
  note('what the model got when the provider failed: ' + JSON.stringify(b3.modelGot))
  note('what the page shows when the provider failed: ' + JSON.stringify(b3.unfolded.slice(-450)))
  check('the provider\'s own words (« secret-provider-detail ») are not on the page the person reads', !/secret-provider-detail/.test(b3.page + ' ' + b3.unfolded), b3.unfolded.slice(-300))
  check('the provider\'s own words are not handed to the model either (it would repeat them)', typeof b3.modelGot === 'string' && !/secret-provider-detail/.test(b3.modelGot), b3.modelGot)

  if (standAccount) {
    await setStatus(standAccount.id, 'EXPIRED')
    await sleep(500)
    const b4 = await scenario('Expired', { tool_slug: 'GITHUB_CREATE_AN_ISSUE', params: { repo: 'replica-test/demo', title: 'B expired ' + stamp } }, 'Allow once', false)
    report.expired = b4
    note('expired: the card says ' + JSON.stringify(b4.card && b4.card.text))
    note('expired: the model got ' + JSON.stringify(b4.modelGot))
    note('expired: the page shows ' + JSON.stringify(b4.unfolded.slice(-450)))
    check('with an expired connection nothing is executed at the provider', b4.after === b4.before, { before: b4.before, after: b4.after })
    check('the model is told the connection has to be made again (the word « reconnect » or code reconnect_required), so that it can tell the person', typeof b4.modelGot === 'string' && /reconnect/i.test(b4.modelGot), b4.modelGot)
    // the server learns of an expiry when the connections are listed (the Connectors page does it): the same call, after that
    const seen = await hostCall('GET', '/kybernos-cloud/connections')
    report.listedAfterExpiry = (seen.connections || []).map((x) => x.toolkit + ':' + x.status)
    const b5 = await scenario('Expired listed', { tool_slug: 'GITHUB_CREATE_AN_ISSUE', params: { repo: 'replica-test/demo', title: 'B expired listed ' + stamp } }, 'Allow once', false)
    report.expiredListed = b5
    note('expired and listed as ' + JSON.stringify(report.listedAfterExpiry) + ': the card says ' + JSON.stringify(b5.card && b5.card.text) + '; the model got ' + JSON.stringify(b5.modelGot))
    check('once the Connectors list shows the connection as expired, the model is told to reconnect it', typeof b5.modelGot === 'string' && /reconnect/i.test(b5.modelGot), { listed: report.listedAfterExpiry, modelGot: b5.modelGot })
    check('once the list shows it as expired the card does not ask the person to allow a call that cannot run (no card, or a card that says so)', b5.card === null || /expired|reconnect/i.test(b5.card.text.replace(/\{.*\}/, '')), b5.card && b5.card.text)
    await setStatus(standAccount.id, 'ACTIVE')
  }
} catch (e) {
  check('the run reached its end', false, String((e && e.stack) || e).slice(0, 500))
} finally {
  try { if (g !== null) await g.close() } catch (e) { /* page gone */ }
}
writeFileSync(join(out, 'report.json'), JSON.stringify({ at: new Date().toISOString(), results, ...report }, null, 2))
const bad = results.filter((r) => !r.ok)
console.log('\n' + (results.length - bad.length) + '/' + results.length + ' ok; report ' + join(out, 'report.json'))
process.exit(bad.length === 0 ? 0 : 1)

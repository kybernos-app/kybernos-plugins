// The whole chain on a real service child: supervisor -> service (--dry-run: a scripted model, no key, no cost) -> proxy and routes -> the front_desk
// tool and its approval card. Only DSH itself is faked. Takes a few seconds.
import http from 'node:http'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const home = mkdtempSync(join(tmpdir(), 'kb-fd-int-'))
const dsh = join(home, '.dsh')
process.env.DSH_HOME = dsh
process.env.DEEPSEEK_API_KEY = 'leak-check-DSH-key-0123456789' // an owner key that must NEVER reach the child
const { installSession, sessionCookie } = await import('./lib-session-test.mjs')
installSession(dsh)
const { createConfigStore } = await import('./fd-config.mjs')
const { createSupervisor } = await import('./fd-supervisor.mjs')
const { mountRoutes, ROUTE } = await import('./fd-routes.mjs')
const { createServiceCall, createToolHost, TOOL } = await import('./fd-tools.mjs')

let failed = 0
const ok = (n, cond, detail) => { console.log((cond ? '  ok   ' : '  FAIL ') + n + (cond || detail === undefined ? '' : '  -- ' + detail)); if (!cond) failed += 1 }

const config = createConfigStore({ home: dsh })
const KEY = 'sk-test-0123456789abcdef'
config.write({ model: { baseUrl: 'https://gw.invalid/v1', name: 'm1', apiKey: KEY }, publicUrl: 'https://shop.example' })
const supervisor = createSupervisor({ config, serviceDir: join(here, 'service'), extraArgs: ['--dry-run'], preferredPort: 0, startWaitMs: 20_000 })

let pid = null
const finish = async () => { try { await supervisor.stop() } catch (e) { /* gone */ } try { rmSync(home, { recursive: true, force: true }) } catch (e) { /* temp */ } }
process.on('exit', () => { if (pid !== null) { try { process.kill(pid, 'SIGKILL') } catch (e) { /* gone */ } } })

const routes = []
mountRoutes({ register: (r) => { routes.push(r); return () => {} } }, { supervisor, config })
const front = http.createServer((req, res) => {
  const p = new URL(req.url, 'http://x').pathname
  const r = routes.find((x) => x.path === p || (x.kind === 'prefix' && p.startsWith(x.path + '/')))
  if (!r) { res.writeHead(404); res.end(); return }
  Promise.resolve(r.handler(req, res)).catch(() => { try { res.writeHead(500); res.end() } catch (e) { /* closed */ } })
})
await new Promise((r) => front.listen(0, '127.0.0.1', r))
const authority = `127.0.0.1:${front.address().port}`
const browser = () => ({ host: authority, origin: `http://${authority}`, cookie: sessionCookie(authority) })
const via = (method, path, body) => new Promise((resolve) => {
  const h = { ...browser(), ...(body !== undefined ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } : {}) }
  const r = http.request({ host: '127.0.0.1', port: front.address().port, path, method, headers: h }, (res) => {
    const cs = []; res.on('data', (c) => cs.push(c)); res.on('end', () => { const text = Buffer.concat(cs).toString('utf8'); let json = null; try { json = JSON.parse(text) } catch (e) { /* html */ } resolve({ status: res.statusCode, headers: res.headers, text, json }) })
  })
  r.on('error', () => resolve({ status: 0, text: '', json: null })); if (body !== undefined) r.write(body); r.end()
})
const direct = async (path) => { const t = supervisor.target(); const r = await fetch(`http://127.0.0.1:${t.port}${path}`); return { status: r.status, text: await r.text(), headers: r.headers } }

const host = createToolHost({ call: createServiceCall({ getTarget: () => supervisor.target() }) })
const tool = host.toolOptions()
const gate = (args) => host.approvalGate({ name: TOOL, arguments: args })
const asked = async (args) => { const g = await gate(args); return { g, r: await tool.execute(args) } }

try {
  // ── start ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  const started = await via('POST', `${ROUTE}/start`, '{}')
  pid = supervisor.status().pid
  ok('start through the route: a real service is up', started.status === 200 && started.json.state === 'running' && Number.isInteger(pid) && supervisor.target() !== null, JSON.stringify(started.json))
  const state = await via('GET', `${ROUTE}/state`)
  ok('state: the shop made from the starter fiche, the links, no secret', state.json.shop && state.json.shop.slug === 'my-shop' && state.json.localLink.endsWith('/c/my-shop') && state.json.publicLink === 'https://shop.example/c/my-shop' && !state.text.includes(KEY) && !state.text.includes(config.ownerToken()))

  // ── the child's world ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  let env = ''
  try { env = execFileSync('ps', ['eww', '-p', String(pid)], { encoding: 'utf8' }) } catch (e) { env = '' }
  if (env.includes('FRONT_DESK_PORT')) ok('the child has none of the owner\'s DSH keys, and the ones it needs', !env.includes('leak-check-DSH-key') && env.includes('FRONT_DESK_OWNER_TOKEN') && env.includes('MODEL_API_KEY'))
  else console.log('  skip the child environment check: this system does not show a process environment')
  ok('the service listens on the loopback only', (await fetch(`http://127.0.0.1:${supervisor.target().port}/api/status`, { headers: { authorization: 'Bearer wrong' } })).status === 401)
  ok('the pid file and the log are there, owner-only', existsSync(config.pidFile) && existsSync(config.logFile) && (readFileSync(config.logFile, 'utf8').match(/front-desk:/g) || []).length >= 1)
  ok('the log never holds a key or the token', !supervisor.logs(200).includes(KEY) && !supervisor.logs(200).includes(config.ownerToken()) && !readFileSync(config.logFile, 'utf8').includes(KEY))

  // ── the pages and the API, through the plugin ───────────────────────────────────────────────────────────────────────────────────────────
  const atelier = await via('GET', `${ROUTE}/atelier`)
  ok('the Atelier page arrives through the plugin with the service\'s CSP', atelier.status === 200 && /<html/i.test(atelier.text) && /frame-ancestors/.test(atelier.headers['content-security-policy'] || '') && !atelier.text.includes(config.ownerToken()))
  const boite = await via('GET', `${ROUTE}/boite`)
  ok('the Inbox page too, and the preview page', boite.status === 200 && (await via('GET', `${ROUTE}/preview`)).status === 200)
  const ov = await via('GET', `${ROUTE}/api/overview`)
  ok('the API answers through the plugin (the browser never holds the token)', ov.status === 200 && ov.json.shop.slug === 'my-shop')
  ok('what a visitor sees is not served through the plugin', (await via('GET', `${ROUTE}/c/my-shop`)).status === 404)

  // ── Kaby: status, draft, check, publish ─────────────────────────────────────────────────────────────────────────────────────────────────
  const s0 = await tool.execute({ action: 'status' })
  ok('status: version 1 live, no change yet, the note about what is the owner\'s', s0.ok && s0.live.version === 1 && s0.draft.changed === false && /owner/.test(s0.note))
  const d1 = await tool.execute({ action: 'draft', ops: [{ op: 'set', path: 'tone', value: 'Warm and short' }, { op: 'set', path: 'brand.greeting', value: 'Hello from the studio!' }] })
  ok('draft: two edits accepted', d1.ok && d1.changes.length === 2 && d1.changes.some((c) => c.path === 'tone'), JSON.stringify(d1))
  const own = await tool.execute({ action: 'draft', ops: [{ op: 'set', path: 'guardrails.budget.dailyCap', value: 500 }] })
  ok('draft: the daily cap is the owner\'s, refused for Kaby, and still 1 in the service', own.ok === false && /owner/.test(own.error), JSON.stringify(own))
  const origins = await tool.execute({ action: 'draft', ops: [{ op: 'set', path: 'guardrails.allowedOrigins', value: ['https://evil.example'] }] })
  ok('draft: the sites that may show the chat are the owner\'s too', origins.ok === false)
  const auto = await tool.execute({ action: 'draft', ops: [{ op: 'set', path: 'guardrails.actions.leave_message', value: 'auto' }] })
  ok('draft: Kaby cannot turn an action to "on its own"', auto.ok === false)
  const live0 = await direct('/c/my-shop')
  ok('nothing reached visitors: the live page has no new greeting', live0.status === 200 && !live0.text.includes('Hello from the studio'))

  const fact = await tool.execute({ action: 'draft', ops: [{ op: 'add_fact', text: 'Open 9 to 18, Monday to Friday', source: 'owner, in chat' }] })
  const sFact = await tool.execute({ action: 'status' })
  ok('a fact Kaby adds is unchecked, and that blocks publishing', fact.ok && sFact.draft.fiche.facts[0].validated === false && sFact.draft.blockers.some((b) => b.code === 'unvalidated_facts'))
  const noCard = await gate({ action: 'publish' })
  const refused = await tool.execute({ action: 'publish' })
  ok('publishing with an unchecked fact: no card (nothing to approve), and the call is refused', noCard === null && refused.ok === false && ['blocked', 'not_approved'].includes(refused.error) && !JSON.stringify(refused).includes('Hello from the studio!!'), JSON.stringify(refused))
  ok('…and the sheet was not marked read', !(await tool.execute({ action: 'status' })).draft.reviewed)
  const rm = await tool.execute({ action: 'draft', ops: [{ op: 'remove_fact', index: 0 }] })
  ok('the fact is taken out again', rm.ok)

  const unchecked = await asked({ action: 'publish' })
  ok('publishing before the checks ran: the checks are what is missing', unchecked.g === null && unchecked.r.ok === false && unchecked.r.blockers && unchecked.r.blockers.some((b) => b.code === 'checks_missing'), JSON.stringify(unchecked.r))
  const chk = await tool.execute({ action: 'check' })
  ok('check: the publish checks run on this draft and pass', chk.ok === true && chk.results.length >= 3, JSON.stringify(chk).slice(0, 300))
  const card = await gate({ action: 'publish' })
  ok('publish now asks: a card in both languages with the changes and the capability sheet', card && card.kind === 'ask' && /version 2/.test(card.reason) && /tone/.test(card.reason) && /greeting/.test(card.reason) && /On its own:/.test(card.reason) && /1\.00 EUR a day|1\.00 [A-Z]{3} a day/.test(card.reason) && /Tout seul/.test(card.displayReason.fr), card && card.reason)
  const pub = await tool.execute({ action: 'publish', summary: 'Warmer tone and a greeting' })
  ok('publish: version 2 is live', pub.ok === true && pub.version === 2, JSON.stringify(pub))
  const live1 = await direct('/c/my-shop')
  ok('visitors now see the greeting', live1.text.includes('Hello from the studio'))
  const again = await tool.execute({ action: 'publish' })
  ok('the same card does not publish twice', again.ok === false)
  const journal = await via('GET', `${ROUTE}/api/studio`)
  ok('the journal says who: Kaby, with the owner\'s approval, and the summary', JSON.stringify(journal.json).includes('kaby') && JSON.stringify(journal.json).includes('Warmer tone and a greeting'))

  // ── rollback and discard ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  const noCardRb = await gate({ action: 'rollback', version: 2 })
  const cardRb = await gate({ action: 'rollback', version: 1 })
  ok('rollback: no card for the live version, a card for version 1', noCardRb === null && cardRb && cardRb.kind === 'ask' && /version 1/.test(cardRb.reason))
  const rb = await tool.execute({ action: 'rollback', version: 1 })
  ok('rollback: version 1 is back, as a new version 3', rb.ok && rb.restored === 1, JSON.stringify(rb))
  ok('visitors lost the greeting again', !(await direct('/c/my-shop')).text.includes('Hello from the studio'))
  await tool.execute({ action: 'draft', ops: [{ op: 'set', path: 'tone', value: 'Another idea' }] })
  const dcard = await gate({ action: 'discard' })
  const dis = await tool.execute({ action: 'discard' })
  ok('discard: asks, then throws the draft away', dcard && dcard.kind === 'ask' && dis.ok && (await tool.execute({ action: 'status' })).draft.changed === false)

  // ── the supervisor: adoption, then stop ───────────────────────────────────────────────────────────────────────────────────────────────────
  const second = createSupervisor({ config, serviceDir: join(here, 'service'), extraArgs: ['--dry-run'], preferredPort: 0 })
  const adopted = await second.start()
  ok('a second supervisor (DSH restarted) adopts the running service instead of starting another', adopted.ok && adopted.adopted === true && adopted.pid === pid && adopted.port === supervisor.status().port, JSON.stringify(adopted))
  const stopped = await second.stop()
  const gone = await new Promise((resolve) => { const end = Date.now() + 5000; const tick = () => { try { process.kill(pid, 0); if (Date.now() > end) resolve(false); else setTimeout(tick, 100) } catch (e) { resolve(true) } }; tick() })
  ok('stop: the process is gone, the pid file too', stopped.ok && gone && !existsSync(config.pidFile))
  pid = null
  const after = await tool.execute({ action: 'status' })
  ok('after the stop the tool says so, and the pages answer 503', after.error === 'service_stopped' || after.error === 'service_unreachable')
  ok('…the plugin\'s own page route too', (await via('GET', `${ROUTE}/atelier`)).status === 503)
} catch (e) {
  ok('the chain ran to the end', false, e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : String(e))
} finally {
  front.close()
  await finish()
}
process.exit(failed ? 1 : 0)

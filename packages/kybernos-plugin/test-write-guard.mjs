// ── The socle's write routes need DSH's signed session, not only a strict Origin ──────────────────────────────────────
//
// L6-02 (audit 2026-10-20): the bundle IMPORTED `writeGuard` but applied it to the three feedback routes only. Every other socle
// write — /kybernos/save (rewrites kyber.yml), /create, /workspace-ui-save, /workspace-delete (deletes a workspace and purges its
// UI store), /pins, /share, /active-set, /avatar-save — settled for `sameOriginStrict`, which any local program passes by sending an
// Origin header. The rule of the repo (docs/dev/route-origin-rule.md) wants the pair on a write a page drives: same origin AND the
// signed browser-session cookie. Their caller is the person's page (client.js `fetch`/`host.call`, same origin, so the browser sends
// the cookie itself); the GET routes keep `sameOriginStrict` alone.
//
// 2026-10-24 (interfaces audit): seven Agent Team writes were still on `sameOriginStrict` alone — /kybernos/yml-appliquer (rewrites the
// file the Lead obeys), /ui-save, /menu-save, /insight-save, /team-portraits and /member-portrait (spend image credits) and
// /voice-sample (stores a voice sample); then /art-action (delete, rename and duplicate of a Creations file). They carry the pair too; the GET of /voice-sample (the list) stays a plain read.
//
// 2026-10-24 (Team automations, piece 2): the four routes of the local half carry the pair from the start — /kybernos/automation/team-pack and team-copies read prompts, team-install and
// team-update write tasks.json (scripts/test-tasks-team.mjs proves what they do).
// 2026-10-25 (recette L3-06 and L3-19): seventeen more writes had stayed at the strict Origin alone. Ten change what the agent follows or can do: the instructions of a project (the
// system prompt of its chats and its AGENTS.md), the drivers of the profile (/tools/apply mounts Computer Use or Browser Use in cordis.patch.yml, hot-reloaded), the skills and the
// apps of a project, a skill a domain pack ships, the model the next message uses, the voice engine, the first-run wizard's answers, the progress registry, the project data; and seven
// make a call with the owner's key or credits (a picture, a batch or a run of translations, a Brain suggestion, a salary estimate, a team workflow, speech). They carry the pair now. Four others that spend the owner's key
// (/voice/transcribe, /models/audio/listen, /models/audio/probe, /tts/speak) are also called by kybernos-call's Python worker, which has no cookie: beside the signed session they accept the worker's one-run secret
// (recette L3-03: kybernos-call/worker-token.mjs publishes the check, `callWorkerOK` in index.js asks it), never an Origin alone. The end of this file plays it with the call bundle's real credential, and with the bundle absent.
//   node packages/kybernos-plugin/test-write-guard.mjs
import assert from 'node:assert/strict'
import http from 'node:http'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { sessionSource } from './session-guard.mjs'
import { OTHER_SECRET, SESSION_SECRET, sessionCookie } from './lib-session-test.mjs'
// The real credential of the call worker (this is a test: bundles import nothing from one another at run time, they meet through the process-global slot it publishes).
import { TOKEN_HEADER, createWorkerToken, publishWorkerCheck } from '../kybernos-call/worker-token.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const home = mkdtempSync(join(tmpdir(), 'kb-plugin-write-guard-'))
process.env.HOME = home
process.env.DSH_HOME = join(home, '.dsh')
process.env.USERPROFILE = home
for (const key of ['KYBERNOS_CLOUD_STATE', 'KYBERNOS_SERVERS_FILE']) delete process.env[key]
mkdirSync(process.env.DSH_HOME, { recursive: true })
sessionSource.secret = () => SESSION_SECRET

// ── Mount the bundle's routes, as scripts/test-route-hosts.mjs does ──────────────────────────────────────────────────
const routes = []
const service = { register: (r) => { routes.push(r); return () => {} }, registerRoute: (r) => { routes.push(r); return () => {} } }
const ctx = new Proxy({
  get: (name) => (name === 'webServer' ? service : (name === 'fs' ? {} : undefined)),
  inject: (_list, cb) => { try { cb(ctx) } catch (e) { /* a service that is not here */ } },
  effect: (fn) => { try { return fn() } catch (e) { return undefined } },
  on: () => {}, systemPrompt: { context: () => {} }, tools: { register: () => () => {} }, config: {},
  log: { info: () => {}, warn: () => {}, error: () => {} }, webServer: service,
}, { get: (t, k) => (k in t ? t[k] : (() => undefined)) })
const mod = await import(pathToFileURL(join(here, 'index.js')).href)
await Promise.race([Promise.resolve(mod.apply(ctx)), new Promise((r) => setTimeout(r, 5000))])
const routeOf = (path) => routes.find((r) => r.path === path && typeof r.handler === 'function')

const server = http.createServer((req, res) => {
  const route = routeOf(new URL(req.url, 'http://x').pathname)
  if (route === undefined) { res.writeHead(404); res.end('{}'); return }
  Promise.resolve(route.handler(req, res)).catch(() => { try { res.writeHead(500); res.end('{}') } catch (e) { /* closed */ } })
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port
const own = '127.0.0.1:' + port
const origin = 'http://' + own
const cookie = (opts) => sessionCookie(own, opts)

const send = (path, headers, body, method = 'POST') => new Promise((resolve) => {
  const payload = JSON.stringify(body)
  const req = http.request({ host: '127.0.0.1', port, path, method, headers: { host: own, ...headers, 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } }, (res) => {
    let text = ''
    res.on('data', (c) => { text += c })
    res.on('end', () => resolve({ status: res.statusCode, text }))
  })
  req.on('error', () => resolve({ status: 0, text: '' }))
  req.write(payload)
  req.end()
})

// One body per socle write, small and harmless (the temp home has no workspace, no kyber file to rewrite).
const WRITES = [
  ['/kybernos/save', { path: 'save-test/kyber.yml', text: 'name: save-test\n' }],
  ['/kybernos/create', { id: 'write-guard-test', name: 'Write guard test' }],
  ['/kybernos/workspace-ui-save', { workspaceId: 'w-write-guard', name: 'Write guard' }],
  ['/kybernos/workspace-delete', { workspaceId: 'w-write-guard' }],
  ['/kybernos/pins', { kind: 'workspace', op: 'add', id: 'w-write-guard' }],
  ['/kybernos/share', { kind: 'artifact', id: 'a-write-guard', access: 'link', role: 'view' }],
  ['/kybernos/active-set', { kyberId: 'write-guard-test' }],
  ['/kybernos/avatar-save', { rootId: 'root', kyberId: 'write-guard-test', dataUrl: 'data:image/png;base64,' }],
  // Agent Team writes (audit 2026-10-24). Every body names a root that does not exist or an id the route refuses, so the real pair reaches the handler and
  // the handler stops at once: nothing is written, no model is asked, no image credit is spent.
  ['/kybernos/yml-appliquer', { kyberId: 'x', yml: 'topology: pool\n' }],
  ['/kybernos/ui-save', { rootId: 'no-such-root', kyberId: 'write-guard-test', name: 'Write guard' }],
  ['/kybernos/menu-save', { lastTeamId: 'write-guard-test' }],
  ['/kybernos/insight-save', { rootId: 'no-such-root', kyberId: 'write-guard-test', insight: {} }],
  ['/kybernos/team-portraits', { rootId: 'no-such-root', kyberId: 'write-guard-test' }],
  ['/kybernos/member-portrait', { rootId: 'no-such-root', kyberId: 'write-guard-test', memberId: 'lead' }],
  ['/kybernos/voice-sample', { rootId: 'no-such-root', kyberId: 'write-guard-test', name: 'My voice', consent: true, sample: 'data:audio/webm;base64,AAAA' }],
  // Creations file actions (delete = rm -f, rename = mv, duplicate = cp): the path is outside every known workspace, so the real pair reaches the handler and it refuses at once.
  ['/kybernos/art-action', { action: 'delete', path: '/no/such/workspace/file.md' }],
  // Team automations, the local half. The ids name no task and the definition is empty, so the real pair reaches the handler and it refuses at once: no automation is made or changed.
  ['/kybernos/automation/team-pack', { id: 'st-write-guard' }],
  ['/kybernos/automation/team-copies', {}],
  ['/kybernos/automation/team-install', { definition: {}, workspaceId: 'w-write-guard', approvals: 'ask', turnOn: true }],
  ['/kybernos/automation/team-update', { taskId: 'st-write-guard', definition: {}, mode: 'replace' }],
]

// L3-06 and L3-19 (recette 2026-10-25): the writes that had stayed at the strict Origin alone. Every body is harmless in this throw-away home (no workspace, no profile, no key, no model
// service): the real pair reaches the handler, which stops at once with its own verdict; a refused request must not even get that far.
// A third entry lists the files (relative to the DSH home) that the real pair leaves behind in this throw-away home: they must be absent after the four refusals and present after
// the real pair, so « nothing written » is measured on a write that does happen. The routes without one stop at the handler's own refusal in this harness (no model, no key).
const FAMILY = [
  // What the agent follows or can do.
  // A project with a folder, as DSH's workspace table lists it (set up below): the text lands in the store and, asked to, in the folder's AGENTS.md.
  ['/kybernos/workspace-instructions', { workspaceId: 'w-write-guard', text: 'A line a shell tried to put in the prompt of every chat of a project.', alsoAgents: true }, ['kybernos/workspace-instructions.json', 'proj-write-guard/AGENTS.md']],
  // A profile folder to patch: the install adds Computer Use to its cordis.patch.yml (and keeps a backup beside it).
  ['/kybernos/tools/apply', { family: 'computer-use', action: 'install', profile: 'web' }, ['profiles/web/cordis.patch.yml']],
  ['/kybernos/workspace-skills', { workspaceId: 'w-write-guard', skills: ['write-guard-skill'] }],
  ['/kybernos/workspace-connectors', { workspaceId: 'w-write-guard', connectors: ['gmail'] }],
  ['/kybernos/domain/skill', { name: 'case-law-watch' }, ['skills/case-law-watch/SKILL.md']],
  ['/kybernos/model/auto', { provider: '' }],
  ['/kybernos/tts/config', { patch: {} }],
  // (The wizard's file is written through the engine's home service, which this harness does not have: the real pair answers « write failed », and the refusals are the measure.)
  ['/kybernos/onboarding', { action: 'replay' }],
  ['/kybernos/art-progress', { action: 'record', entry: { artifact: 'write-guard.md', score: 1, max: 1 } }, ['kybernos/progress.json']],
  ['/kybernos/project-data', { sessionIds: [] }],
  // What spends the owner's key or credits.
  ['/kybernos/image/generate', { prompt: 'A picture a shell tried to pay for.' }],
  ['/kybernos/i18n-translate', { lang: 'xx', items: [] }],
  ['/kybernos/i18n-job', { op: 'cancel', lang: 'xx' }],
  ['/kybernos/starters-suggest', {}],
  ['/kybernos/yml-proposer', { texte: 'abc' }],
  ['/kybernos/salary-detect', {}],
  ['/kybernos/models/audio/speak', { text: '' }],
  // Second batch (2026-10-25, same day): the other POSTs a page drives and no non-browser calls. A refused request must not say yes to an agent's request for approval (a task's
  // `decision`), write a recording, a language, a feedback or a rating, trim the voice cache, install a language pack or open a Finder window.
  ['/kybernos/gateway/approvals/decision', { taskId: 'zz-write-guard', decision: 'approuver' }],
  ['/kybernos/voice/save', { audio: 'data:audio/webm;base64,AAAA' }],
  ['/kybernos/i18n-store', { remove: true, id: 'zz' }],
  ['/kybernos/i18n-packs', { op: 'zz' }],
  ['/kybernos/tts/cache-trim', {}],
  ['/kybernos/quality-feedback', {}],
  ['/kybernos/quality-rating', {}],
  ['/kybernos/art-reveal', { path: '/no/such/workspace/file.md' }],
]

// The four that spend the owner's key and are also called by something that has no cookie: the call worker. They take the signed session OR the worker's one-run secret (see the comment above
// /kybernos/models/audio/probe in index.js). The call health check, which also posts to two of them, is a page's: it hands the page's own cookie on.
const WORKER_ROUTES = [
  ['/kybernos/voice/transcribe', {}, 'the call worker (agent/call_stt.py, the « app » listening provider)'],
  ['/kybernos/models/audio/listen', {}, 'the call worker (agent/call_stt.py, a listening model of Models)'],
  ['/kybernos/models/audio/probe', {}, 'the call health check (call-health.mjs), with the page\'s cookie'],
  ['/kybernos/tts/speak', {}, 'the call worker (agent/call_voice.py) and the call health check (call-health.mjs)'],
]

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }

try {
  console.log('Kybernos plugin: the socle writes need the signed session')
  const forged = cookie({ secret: OTHER_SECRET })
  for (const [path, body] of WRITES) {
    for (const [headers, want, label] of [
      [{}, 403, 'no Origin and no cookie'],
      [{ origin: 'http://evil.example', cookie: cookie() }, 403, 'a foreign Origin, even with the real cookie'],
      [{ origin }, 401, 'the right Origin and no cookie'],
      [{ origin, cookie: forged }, 401, 'the right Origin and a forged cookie'],
    ]) {
      const r = await send(path, headers, body)
      assert.equal(r.status, want, path + ': ' + label + ' -> ' + r.status + ' ' + r.text.slice(0, 80))
    }
    // The person's own page: the right Origin AND the signed cookie. The route answers; the handler's own verdict on an
    // empty store is its business (a 200 with { ok: false } is a normal answer), never an auth refusal.
    const real = await send(path, { origin, cookie: cookie() }, body)
    assert.notEqual(real.status, 401, path + ': the real pair is not refused as unsigned')
    assert.notEqual(real.status, 403, path + ': the real pair is not refused as foreign')
    ok(path + ': no header 403 · foreign Origin 403 · no cookie 401 · forged cookie 401 · the real pair answers')
  }
  // L3-06 / L3-19. Four refusals for each, nothing written by a refused request (the files a write of the family leaves in the throw-away home), then the real pair.
  // The fixtures: DSH's workspace table with one project and its folder, and an empty profile folder.
  mkdirSync(join(process.env.DSH_HOME, 'storages'), { recursive: true })
  mkdirSync(join(process.env.DSH_HOME, 'proj-write-guard'), { recursive: true })
  mkdirSync(join(process.env.DSH_HOME, 'profiles', 'web'), { recursive: true })
  writeFileSync(join(process.env.DSH_HOME, 'storages', 'workspace.json'), JSON.stringify({ tables: { workspaces: { 'w-write-guard': { title: 'Write guard', path: join(process.env.DSH_HOME, 'proj-write-guard'), sessionIds: [] } } } }))
  const there = (files) => files.filter((f) => existsSync(join(process.env.DSH_HOME, f)))
  for (const [path, body, files = []] of FAMILY) {
    assert.ok(routeOf(path) !== undefined, path + ' is mounted — the table above is stale')
    assert.deepEqual(there(files), [], path + ': nothing of its own is there before the first request')
    for (const [headers, want, label] of [
      [{}, 403, 'no Origin and no cookie'],
      [{ origin: 'http://evil.example', cookie: cookie() }, 403, 'a foreign Origin, even with the real cookie'],
      [{ origin }, 401, 'the right Origin and no cookie'],
      [{ origin, cookie: forged }, 401, 'the right Origin and a forged cookie'],
    ]) {
      const r = await send(path, headers, body)
      assert.equal(r.status, want, path + ': ' + label + ' -> ' + r.status + ' ' + r.text.slice(0, 80))
      assert.equal(JSON.parse(r.text).ok, false, path + ': a refusal says ok: false')
    }
    assert.deepEqual(there(files), [], path + ': a refused request wrote nothing')
    const real = await send(path, { origin, cookie: cookie() }, body)
    assert.notEqual(real.status, 401, path + ': the real pair is not refused as unsigned: ' + real.text.slice(0, 80))
    assert.notEqual(real.status, 403, path + ': the real pair is not refused as foreign: ' + real.text.slice(0, 80))
    assert.ok(real.status > 0, path + ': the route answers the real pair')
    assert.deepEqual(there(files), files, path + ': the real pair does write ' + files.join(', ') + ' (the answer was ' + real.text.slice(0, 120) + ')')
    ok(path + ': no header 403 · foreign Origin 403 · no cookie 401 · forged cookie 401 · nothing written · the real pair answers')
  }
  // The routes that read keep their rule: i18n-job and workspace-skills / -connectors / -instructions answer a GET with the strict or lax Origin check alone.
  for (const path of ['/kybernos/i18n-job', '/kybernos/i18n-store', '/kybernos/i18n-packs', '/kybernos/quality-feedback', '/kybernos/quality-rating', '/kybernos/workspace-skills?workspaceId=w-write-guard', '/kybernos/workspace-connectors?workspaceId=w-write-guard']) {
    const r = await send(path, {}, {}, 'GET')
    assert.ok(r.status !== 401, path + ': a GET is not asked for the cookie: ' + r.status)
  }
  ok('the GET of i18n-job, i18n-store, i18n-packs, quality-feedback, quality-rating, workspace-skills and workspace-connectors stays a plain read (no cookie asked)')
  // The four spending routes the call worker reaches without a cookie (recette L3-03). The worker's credential is the call bundle's real one, published where the core looks for it. Each route
  // takes the signed session or this run's secret and nothing else: an Origin alone, a wrong or old secret and a secret relayed by the phone tunnel are refused, and with the bundle absent
  // (nothing published) the secret means nothing. The caller is named so the day one of them is guarded without the call side, this file says which caller broke.
  const workerToken = createWorkerToken()
  let runSecret = workerToken.issue()
  let withdraw = publishWorkerCheck((req) => workerToken.accepts(req))
  for (const [path, body, caller] of WORKER_ROUTES) {
    assert.ok(routeOf(path) !== undefined, path + ' is mounted — the table above is stale')
    for (const [headers, want, label] of [
      [{}, 403, 'no Origin and nothing else'],
      [{ origin: 'http://evil.example', cookie: cookie() }, 403, 'a foreign Origin, even with the real cookie'],
      [{ origin: 'http://evil.example', [TOKEN_HEADER]: runSecret }, 403, 'a foreign Origin, even with the real secret'],
      [{ [TOKEN_HEADER]: runSecret }, 403, 'the real secret with no Origin'],
      [{ origin }, 401, 'the right Origin alone (what a local program sends)'],
      [{ origin, cookie: forged }, 401, 'the right Origin and a forged cookie'],
      [{ origin, [TOKEN_HEADER]: 'f'.repeat(64) }, 401, 'the right Origin and a wrong secret'],
      [{ origin, [TOKEN_HEADER]: '' }, 401, 'the right Origin and an empty secret'],
      [{ origin, [TOKEN_HEADER]: runSecret, 'x-kybernos-tunnel': '1' }, 401, 'the real secret relayed by the phone tunnel'],
    ]) {
      const r = await send(path, headers, body)
      assert.equal(r.status, want, path + ': ' + label + ' -> ' + r.status + ' ' + r.text.slice(0, 80))
    }
    for (const [headers, label] of [[{ origin, cookie: cookie() }, 'the page (the right Origin and the signed cookie)'], [{ origin, [TOKEN_HEADER]: runSecret }, caller + ' (the right Origin and this run\'s secret)']]) {
      const r = await send(path, headers, body)
      assert.notEqual(r.status, 401, path + ': ' + label + ' is not refused as unsigned: ' + r.text.slice(0, 80))
      assert.notEqual(r.status, 403, path + ': ' + label + ' is not refused as foreign: ' + r.text.slice(0, 80))
    }
    // The worker run ends (stopped, exited, restarted): its secret is refused; the new run's secret is not.
    const oldSecret = runSecret
    workerToken.revoke()
    runSecret = workerToken.issue()
    assert.equal((await send(path, { origin, [TOKEN_HEADER]: oldSecret }, body)).status, 401, path + ': the secret of a previous worker run is refused')
    assert.notEqual((await send(path, { origin, [TOKEN_HEADER]: runSecret }, body)).status, 401, path + ': the new run\'s secret is accepted')
    // Without the call bundle (nothing published) only the cookie works.
    withdraw()
    assert.equal((await send(path, { origin, [TOKEN_HEADER]: runSecret }, body)).status, 401, path + ': with no call bundle the secret means nothing')
    assert.notEqual((await send(path, { origin, cookie: cookie() }, body)).status, 401, path + ': and the cookie still works')
    withdraw = publishWorkerCheck((req) => workerToken.accepts(req))
    ok(path + ': session or this run\'s secret, nothing else · foreign/absent Origin 403 · Origin alone 401 · wrong, old and tunnel-relayed secret 401 · no call bundle: cookie only')
  }
  withdraw()
  // /voice-sample also answers GET (the list: a plain read) and DELETE (a write: it needs the pair too).
  for (const [headers, want, label] of [
    [{}, 403, 'no Origin and no cookie'],
    [{ origin: 'http://evil.example', cookie: cookie() }, 403, 'a foreign Origin, even with the real cookie'],
    [{ origin }, 401, 'the right Origin and no cookie'],
    [{ origin, cookie: forged }, 401, 'the right Origin and a forged cookie'],
  ]) {
    const r = await send('/kybernos/voice-sample?rootId=no-such-root&kyberId=write-guard-test&id=x', headers, {}, 'DELETE')
    assert.equal(r.status, want, 'DELETE /kybernos/voice-sample: ' + label + ' -> ' + r.status)
  }
  const del = await send('/kybernos/voice-sample?rootId=no-such-root&kyberId=write-guard-test&id=x', { origin, cookie: cookie() }, {}, 'DELETE')
  assert.ok(del.status !== 401 && del.status !== 403, 'DELETE with the real pair is not refused as unsigned or foreign: ' + del.status)
  const list = await send('/kybernos/voice-sample?rootId=no-such-root&kyberId=write-guard-test', {}, {}, 'GET')
  assert.ok(list.status !== 401 && list.status !== 403, 'GET (the list) stays a plain read: ' + list.status)
  ok('/kybernos/voice-sample DELETE: the same four refusals, the real pair answers; GET stays open')
  console.log('\nPLUGIN WRITE GUARD — ' + pass + ' route(s), 0 échec')
} catch (e) {
  console.error('  ✗ ' + String(e && e.message ? e.message : e))
  process.exitCode = 1
} finally {
  server.close()
  try { rmSync(home, { recursive: true, force: true }) } catch (e) { /* the system clears its temp folder */ }
  // The bundle boots timers and watchers of its own (the host keeps them alive): this test ends when its checks do.
  process.exit(process.exitCode === undefined ? 0 : process.exitCode)
}

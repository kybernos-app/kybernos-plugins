// The pooled computer's claimer, against a stand-in for the platform and for DSH over real loopback sockets; and the scripts that wire it (what the entrypoint may and may not do).
import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { send, waitForClaim, waitForRoute } from './claimer.mjs'
import { readIdentity, identityFile } from './computer-identity.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const TOKEN = 'kyd_' + 'b'.repeat(40)
const POOL = 'pool_0123456789abcdef'
const REVOKED = ['revoked', POOL.slice(5)].join('_')
const SLOT = 'slot-1'

const listen = (handler) => new Promise((resolve) => {
  const server = createServer(handler)
  server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, close: () => new Promise((r) => { server.closeAllConnections(); server.close(r) }) }))
})
const reply = (res, status, payload) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(payload)) }
const readBody = (req) => new Promise((resolve) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(c).toString('utf8'))) } catch (e) { resolve(null) } }) })

/** A platform that answers `ready` and, after `claimAfter` polls, the identity. */
const platform = async (options = {}) => {
  const seen = []
  const ports = []
  let polls = 0
  const s = await listen(async (req, res) => {
    const body = await readBody(req)
    seen.push({ method: req.method, path: req.url, auth: req.headers.authorization, connection: req.headers.connection, body })
    ports.push(req.socket.remotePort)
    if (req.headers.authorization !== 'Bearer ' + POOL) return reply(res, options.refuse ?? 401, { error: 'no' })
    if (req.url === '/v1/pool/ready') return reply(res, 200, { ok: true })
    if (req.url === '/v1/pool/claim') {
      polls += 1
      if (polls <= (options.claimAfter ?? 0)) return reply(res, 200, { claimed: false })
      return reply(res, 200, options.identity ?? { claimed: true, computer_id: 'cmp-pooled-1', token: TOKEN, model: 'glm', api: 'https://evil.example' })
    }
    return reply(res, 404, {})
  })
  return { ...s, seen, ports, url: `http://127.0.0.1:${s.port}` }
}

/** DSH as the claimer sees it: answers `/`, and the claim route (the first `refuse` calls say no). */
const dsh = async (options = {}) => {
  const seen = []
  let calls = 0
  let routeCalls = 0
  const s = await listen(async (req, res) => {
    const body = await readBody(req)
    seen.push({ method: req.method, path: req.url, origin: req.headers.origin, body })
    if (req.url === '/') return reply(res, 200, {})
    if (req.url === '/kybernos-cloud/computer/claimed') {
      calls += 1
      if (calls <= (options.refuse ?? 0) || options.never === true) return reply(res, 200, { ok: false, error: 'credentials_unavailable' })
      return reply(res, 200, { ok: true, source: 'volume' })
    }
    if (req.url === '/kybernos-cloud/computer/route') {
      routeCalls += 1
      return reply(res, 200, { ok: true, route: (options.routeAfter ?? 0) < routeCalls })
    }
    return reply(res, 404, {})
  })
  return { ...s, seen }
}
const quiet = () => {}
const fast = { pollMs: 1, sleep: async () => {}, log: quiet }

test('it says ready once, polls with the pool token, and writes the identity the platform hands over', async () => {
  const p = await platform({ claimAfter: 3 })
  const d = await dsh()
  const home = mkdtempSync(join(tmpdir(), 'kb-claimer-'))
  try {
    const out = await waitForClaim({ ...fast, api: p.url, slot: SLOT, poolToken: POOL, home, dshPort: d.port, version: 'p18 weird\n' })
    assert.equal(out, 'claimed')
    const ready = p.seen.filter((c) => c.path === '/v1/pool/ready')
    assert.equal(ready.length, 1)
    assert.deepEqual(ready[0].body, { version: 'p18weird' }, 'the version is cleaned')
    assert.equal(p.seen.filter((c) => c.path === '/v1/pool/claim').length, 4, 'three polls that said no, one that said yes')
    assert.ok(p.seen.every((c) => c.auth === 'Bearer ' + POOL))
    // The identity is on the volume with the PLATFORM'S OWN address (the machine's), never the one an answer names.
    assert.deepEqual(readIdentity(home), { api: p.url, computer_id: 'cmp-pooled-1', token: TOKEN, model: 'glm' })
    assert.equal(statSync(identityFile(home)).mode & 0o777, 0o600)
    // DSH is asked, over loopback and same origin, with nothing in the body: the token is not on that wire.
    const claimed = d.seen.filter((c) => c.path === '/kybernos-cloud/computer/claimed')
    assert.equal(claimed.length, 1)
    assert.equal(claimed[0].origin, `http://127.0.0.1:${d.port}`)
    assert.deepEqual(claimed[0].body, {})
    assert.equal(JSON.stringify(d.seen).includes(TOKEN), false)
  } finally { await p.close(); await d.close() }
})

test('every request goes on a connection of its own (a socket open when the machine was suspended is dead when it wakes)', async () => {
  const p = await platform({ claimAfter: 5 })
  const d = await dsh()
  const home = mkdtempSync(join(tmpdir(), 'kb-claimer-'))
  try {
    await waitForClaim({ ...fast, api: p.url, slot: SLOT, poolToken: POOL, home, dshPort: d.port })
    assert.equal(new Set(p.ports).size, p.ports.length, 'no socket is used twice')
    assert.ok(p.seen.every((c) => c.connection === 'close'))
  } finally { await p.close(); await d.close() }
})

test('an identity that is not valid is ignored and the claimer keeps waiting', async () => {
  let answers = [{ claimed: true, computer_id: 'a b', token: TOKEN }, { claimed: true, computer_id: 'cmp-1', token: "x'; rm -rf / '" }, { claimed: true, computer_id: 'cmp-1', token: TOKEN }]
  const p = await platform()
  const original = p.server.listeners('request')[0]
  p.server.removeAllListeners('request')
  p.server.on('request', async (req, res) => {
    if (req.url === '/v1/pool/claim') { await readBody(req); return reply(res, 200, answers.shift() ?? { claimed: false }) }
    return original(req, res)
  })
  const d = await dsh()
  const home = mkdtempSync(join(tmpdir(), 'kb-claimer-'))
  try {
    assert.equal(await waitForClaim({ ...fast, api: p.url, slot: SLOT, poolToken: POOL, home, dshPort: d.port }), 'claimed')
    assert.equal(readIdentity(home).computer_id, 'cmp-1')
    assert.equal(readIdentity(home).token, TOKEN)
  } finally { await p.close(); await d.close() }
})

test('DSH that does not take the token at once is asked again; one that never does leaves the identity written and says so', async () => {
  const p = await platform()
  const slow = await dsh({ refuse: 3 })
  const home = mkdtempSync(join(tmpdir(), 'kb-claimer-'))
  try {
    assert.equal(await waitForClaim({ ...fast, api: p.url, slot: SLOT, poolToken: POOL, home, dshPort: slow.port }), 'claimed')
    assert.equal(slow.seen.filter((c) => c.path === '/kybernos-cloud/computer/claimed').length, 4)
  } finally { await slow.close() }
  const never = await dsh({ never: true })
  const home2 = mkdtempSync(join(tmpdir(), 'kb-claimer-'))
  try {
    assert.equal(await waitForClaim({ ...fast, api: p.url, slot: SLOT, poolToken: POOL, home: home2, dshPort: never.port, applyAttempts: 3 }), 'written')
    assert.notEqual(readIdentity(home2), null, 'the identity is kept: the entrypoint restarts DSH and it reads it')
  } finally { await never.close(); await p.close() }
})

test('a machine claimed earlier asks nothing of the platform', async () => {
  const p = await platform()
  const d = await dsh()
  const home = mkdtempSync(join(tmpdir(), 'kb-claimer-'))
  try {
    await waitForClaim({ ...fast, api: p.url, slot: SLOT, poolToken: POOL, home, dshPort: d.port })
    const before = p.seen.length
    assert.equal(await waitForClaim({ ...fast, api: p.url, slot: SLOT, poolToken: POOL, home, dshPort: d.port }), 'already')
    assert.equal(p.seen.length, before)
  } finally { await p.close(); await d.close() }
})

test('a platform that refuses the pool token is waited on slowly, not hammered', async () => {
  const p = await platform({ refuse: 401 })
  const d = await dsh()
  const home = mkdtempSync(join(tmpdir(), 'kb-claimer-'))
  const sleeps = []
  try {
    const out = await waitForClaim({ api: p.url, slot: SLOT, poolToken: REVOKED, home, dshPort: d.port, pollMs: 500, maxPolls: 3, log: quiet, sleep: async (ms) => { sleeps.push(ms) } })
    assert.equal(out, 'stopped')
    assert.equal(p.seen.filter((c) => c.path === '/v1/pool/claim').length, 3)
    assert.ok(sleeps.length >= 6 && sleeps.every((ms) => ms >= 2000), 'every refusal waits at least two seconds: ' + sleeps.join(','))
    assert.equal(existsSync(identityFile(home)), false)
  } finally { await p.close(); await d.close() }
})

test('without a platform, a pool token or a profile it waits for nothing', async () => {
  assert.equal(await waitForClaim({ ...fast, api: '', slot: SLOT, poolToken: POOL, home: '/tmp/x' }), 'stopped')
  assert.equal(await waitForClaim({ ...fast, api: 'https://x.test', slot: SLOT, poolToken: '', home: '/tmp/x' }), 'stopped')
  assert.equal(await waitForClaim({ ...fast, api: 'https://x.test', poolToken: POOL, home: '/tmp/x' }), 'stopped', 'no slot id: the plugin would ignore the volume, so it does not claim')
  const gone = await send('GET', 'http://127.0.0.1:1/', { timeoutMs: 500 })
  assert.deepEqual(gone, { status: 0, json: null }, 'an unreachable address is a status 0, never a throw')
  assert.deepEqual(await send('GET', 'not a url'), { status: 0, json: null })
})

test('after the claim the entrypoint waits for the model route to be live (read-only), gives up at its deadline, and at once when DSH does not answer', async () => {
  const d = await dsh({ routeAfter: 2 })
  try {
    assert.equal(await waitForRoute({ dshPort: d.port, pollMs: 1, sleep: async () => {} }), true)
    const asked = d.seen.filter((c) => c.path === '/kybernos-cloud/computer/route')
    assert.equal(asked.length, 3, 'asked until the route is there')
    assert.ok(asked.every((c) => c.method === 'GET' && c.origin === `http://127.0.0.1:${d.port}`), 'a read, same origin')
    assert.equal(d.seen.some((c) => c.path === '/kybernos-cloud/computer/claimed'), false, 'waiting never stores a credential')
  } finally { await d.close() }
  const never = await dsh({ routeAfter: 1e9 })
  let clock = 0
  try {
    assert.equal(await waitForRoute({ dshPort: never.port, timeoutMs: 100, now: () => (clock += 60), sleep: async () => {} }), false)
  } finally { await never.close() }
  // A DSH that is down: three seconds of silence is enough to know it will not get there (the entrypoint restarts it).
  const gone = await dsh()
  const deadPort = gone.port
  await gone.close()
  const slept = []
  assert.equal(await waitForRoute({ dshPort: deadPort, pollMs: 250, silentPolls: 4, timeoutMs: 60000, sleep: async (ms) => { slept.push(ms) } }), false)
  assert.equal(slept.length, 3, 'it stopped after 4 silent answers, not at the 60 s deadline')
})

// ── the scripts ──────────────────────────────────────────────────────────────────────────────
const text = (file) => readFileSync(join(here, file), 'utf8')

test('the entrypoint never reads the identity as root and strips the pool token before anything the agent runs', () => {
  const entry = text('entrypoint.sh')
  // Root follows no link it finds on the volume: a dangling `.owned` would make `touch` and `chown` create and hand over a file anywhere.
  assert.match(entry, /if \[ -L "\$DATA\/\.owned" \]; then rm -f "\$DATA\/\.owned"; fi/)
  assert.match(entry, /chown -R -h node:node "\$DATA"/)
  assert.match(entry, /chown -h node:node "\$DATA\/\.owned"/)
  assert.equal(/\btouch\b[^\n]*\.owned/.test(entry), false, '`touch` follows a link')
  assert.match(entry, /\[ -n "\$\{KYBERNOS_POOL_SLOT:-\}" \]/, 'the slot id is what makes a machine a pool slot')
  assert.equal(entry.includes('-u KYBERNOS_POOL_SLOT'), false, 'the slot id stays in the environment: the plugin needs it')
  assert.equal(/\beval\b/.test(entry), false, 'root evaluates nothing from the volume')
  assert.equal(/\bnode\b[^\n]*identity\.mjs/.test(entry), false, 'nor runs anything that reads the identity file')
  assert.match(entry, /exec env -u KYBERNOS_POOL_TOKEN runuser -u node -- sh "\$LIB\/post-claim\.sh"/)
  // The wait happens as the unprivileged user, and only for a slot with a pool token and no identity in its environment.
  assert.match(entry, /\[ -z "\$\{KYBERNOS_COMPUTER_TOKEN:-\}" \] && \[ -n "\$\{KYBERNOS_POOL_TOKEN:-\}" \][^\n]*\n\s*runuser -u node -- sh "\$LIB\/pool-hold\.sh"/)
  const hold = text('pool-hold.sh')
  assert.match(hold, /env -u KYBERNOS_POOL_TOKEN dsh web/, 'the DSH that is up before the claim never holds the pool token')
  // The model route is in the profile before DSH starts, so that the claim does not have to reload it.
  assert.ok(hold.indexOf('render-profile.sh') !== -1 && hold.indexOf('render-profile.sh') < hold.indexOf('dsh web'), 'the route is rendered before DSH starts')
  // A slot claimed before whose identity is gone does not wait for a claim that will not come; a claimer that ends 3 restarts DSH.
  assert.match(hold, /identity\.mjs" claimed-before/)
  assert.match(hold, /\[ "\$rc" -eq 3 \]/)
})

test('a failing identity step stops the boot instead of being swallowed by eval', () => {
  const post = text('post-claim.sh')
  assert.match(post, /ids=\$\(node "\$LIB\/identity\.mjs" env\)\neval "\$ids"/)
})

test('identity.mjs: has / claimed-before / env, as the scripts use them', async () => {
  const { spawnSync } = await import('node:child_process')
  const { writeIdentity } = await import('./computer-identity.mjs')
  const { writeFileSync } = await import('node:fs')
  const home = mkdtempSync(join(tmpdir(), 'kb-identity-cli-'))
  const run = (arg, env) => spawnSync(process.execPath, [join(here, 'identity.mjs'), arg], { env: { PATH: process.env.PATH, DSH_HOME: home, KYBERNOS_API: 'https://api.example.test', ...env }, encoding: 'utf8' })
  const pooled = { KYBERNOS_POOL_SLOT: 'slot-1' }
  assert.equal(run('has', pooled).status, 1, 'nothing yet')
  assert.equal(run('claimed-before', pooled).status, 1)
  assert.equal(run('env', pooled).stdout, '')
  writeIdentity(home, { api: 'https://api.example.test', computer_id: 'cmp-1', token: TOKEN, model: 'glm' })
  assert.equal(run('has', pooled).status, 0)
  assert.equal(run('has', {}).status, 1, 'the volume counts only on a pool slot')
  assert.equal(run('env', {}).stdout, '', 'and exports nothing elsewhere')
  const lines = run('env', pooled).stdout.trim().split('\n')
  assert.deepEqual(lines, ["export KYBERNOS_COMPUTER_ID='cmp-1'", `export KYBERNOS_COMPUTER_TOKEN='${TOKEN}'`, "export KYBERNOS_COMPUTER_MODEL='glm'"])
  // The identity file lost after the account link was written: claimed before, no identity.
  const { rmSync } = await import('node:fs')
  rmSync(identityFile(home))
  writeFileSync(join(home, 'kybernos-cloud.json'), '{}')
  assert.equal(run('has', pooled).status, 1)
  assert.equal(run('claimed-before', pooled).status, 0)
  assert.equal(run('nope', pooled).status, 2)
})

test('post-claim does its steps in order, and the model route is live before the reporter and the runner start', () => {
  const post = text('post-claim.sh')
  const order = ['identity.mjs" env', 'render-profile.sh', 'link-account.mjs', 'KYBERNOS_GATE_TICKET_URL=', 'claimer.mjs" route', 'reporter.mjs', 'runner.mjs', 'exec sh /opt/kybernos-plugins/packages/kybernos-gate/docker/entrypoint.sh'].map((needle) => {
    const at = post.indexOf(needle)
    assert.notEqual(at, -1, needle + ' is missing')
    return at
  })
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'the steps are in this order')
})

test('every file a script of the image runs is shipped by the Dockerfile', () => {
  const docker = text('Dockerfile')
  const referenced = new Set()
  for (const file of ['entrypoint.sh', 'post-claim.sh', 'pool-hold.sh']) {
    for (const m of text(file).matchAll(/\$LIB\/([A-Za-z0-9._-]+)/gu)) referenced.add(m[1])
  }
  for (const f of ['claimer.mjs', 'identity.mjs', 'computer-identity.mjs']) referenced.add(f)
  for (const name of referenced) {
    assert.equal(existsSync(join(here, name)), true, name + ' does not exist')
    assert.ok(docker.includes('services/computer-image/' + name), name + ' is run by a script but not copied by the Dockerfile')
  }
  // The scripts the entrypoint runs are executable in the image.
  for (const name of ['post-claim.sh', 'pool-hold.sh']) assert.ok(docker.includes('/usr/local/lib/kybernos-computer/' + name), name + ' is not made executable')
})

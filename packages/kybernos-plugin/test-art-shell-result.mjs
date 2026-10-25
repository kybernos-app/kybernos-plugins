// ── The Creations file actions read the result of the engine's shell service as the engine gives it ─────────────────────────────────────────
//
// Recette 2026-10-25, L1-44. Rename, Duplicate, Delete and Reveal ran on the disk and the host answered « refused »: the engine's shell service (dsh-bash-local) answers
// `execute(spec)` with a handle whose `result` is a METHOD (`() => Promise<{ exitCode, … }>`), the host awaited it as a value, got the function back, found no exit code and said no.
// The page then never re-read its list (no « Renamed » note, the old name on the card, the deleted card still there) although the file had moved.
//
// The routes are played here as they are (`/kybernos/art-action`, `/kybernos/art-reveal`, with the signed session the page sends), over a shell service whose handles take each shape that
// exists: `result` a function (the engine since at least 0.2.1-alpha.2), `result` a promise (older engines, `dsh-compat.json` still admits them), a function or a promise that rejects,
// and a handle with a non-zero exit code. The fake runs the real `mv` / `cp` / `rm` of the command in a throw-away folder (never `open -R`: that one is only recorded), so « the host says
// yes » is checked against « the file moved ».
//
//   node packages/kybernos-plugin/test-art-shell-result.mjs
import assert from 'node:assert/strict'
import http from 'node:http'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { sessionSource } from './session-guard.mjs'
import { SESSION_SECRET, sessionCookie } from './lib-session-test.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const base = realpathSync(mkdtempSync(join(tmpdir(), 'kb-plugin-art-shell-')))
const home = join(base, 'home')
const dshHome = join(base, 'dsh-home')
const project = join(home, 'proj')
for (const d of [home, dshHome, project]) mkdirSync(d, { recursive: true })
process.env.HOME = base
process.env.DSH_HOME = dshHome
process.env.USERPROFILE = base
for (const key of ['KYBERNOS_CLOUD_STATE', 'KYBERNOS_SERVERS_FILE']) delete process.env[key]
sessionSource.secret = () => SESSION_SECRET

// ── The shell service: the engine's contract (resolve → spec, execute → handle), with the handle's shape chosen per case ────────────────────
/** How the next command's handle gives its result: 'function' | 'promise' | 'reject-function' | 'reject-promise' | 'none'. */
let shape = 'function'
/** A forced exit code (the command is then NOT run), or null to run it for real. */
let forceExit = null
const seen = []
const handleFor = (outcome) => {
  const refused = new Error('shell gone')
  const dead = Promise.reject(refused)
  dead.catch(() => {})
  if (shape === 'function') return { status: 'completed', result: () => Promise.resolve(outcome) }
  if (shape === 'promise') return { status: 'completed', result: Promise.resolve(outcome) }
  if (shape === 'reject-function') return { status: 'killed', result: () => Promise.reject(refused) }
  if (shape === 'reject-promise') return { status: 'killed', result: dead }
  return null
}
const shellSvc = {
  resolve: (request) => ({ ...request }),
  execute: async (spec) => {
    seen.push(spec.command)
    let exitCode = forceExit
    if (exitCode === null) {
      // Only the three commands that change the throw-away folder are run; Reveal (`open -R`) would open a Finder window on the maintainer's machine.
      exitCode = /^(mv|cp|rm) /.test(spec.command) ? spawnSync('/bin/sh', ['-c', spec.command], { encoding: 'utf8' }).status : 0
    }
    return handleFor({ exitCode, signal: null, stdout: '', stderr: '' })
  },
}

// ── The bundle, mounted over a small file service made from node:fs (as test-file-serving.mjs does) ──────────────────────────────────────────
const handleOf = (p) => ({ p })
const fsSvc = {
  resolve: async (p, o) => handleOf(o !== undefined && o !== null && typeof o.cwd === 'string' ? join(o.cwd, p) : p),
  stat: async (h) => {
    const st = statSync(h.p)
    return { type: st.isDirectory() ? 'directory' : (st.isFile() ? 'file' : 'other'), size: st.size, version: ['0', '0', String(st.size), '0', '0'].join(':') }
  },
  readText: async (h) => readFileSync(h.p, 'utf8'),
  processPath: (h) => h.p,
  listDir: async (h) => readdirSync(h.p, { withFileTypes: true }).map((e) => ({ name: e.name, type: e.isDirectory() ? 'directory' : 'file', target: handleOf(join(h.p, e.name)) })),
  writeText: async () => {},
}
const routes = []
const service = { register: (r) => { routes.push(r); return () => {} }, registerRoute: (r) => { routes.push(r); return () => {} } }
const registry = { list: () => [{ id: 'w-proj', title: 'proj', path: project }] }
const ctx = new Proxy({
  get: (name) => {
    if (name === 'webServer') return service
    if (name === 'fs') return fsSvc
    if (name === 'shell') return shellSvc
    if (name === 'sandboxPolicy') return { workspaceRoot: home }
    if (name === 'workspaceRegistry') return registry
    return undefined
  },
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

/** A write as the person's page sends it: the right Origin and DSH's signed session. */
const post = (path, body) => new Promise((resolve) => {
  const payload = JSON.stringify(body)
  const headers = { host: own, origin: 'http://' + own, cookie: sessionCookie(own), 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) }
  const req = http.request({ host: '127.0.0.1', port, path, method: 'POST', headers }, (res) => {
    let text = ''
    res.on('data', (c) => { text += c })
    res.on('end', () => { let json = null; try { json = JSON.parse(text) } catch (e) { /* not JSON */ } resolve({ status: res.statusCode, json }) })
  })
  req.on('error', () => resolve({ status: 0, json: null }))
  req.write(payload)
  req.end()
})
const act = (body) => post('/kybernos/art-action', body)
const reveal = (path) => post('/kybernos/art-reveal', { path })
const mk = (name, text = 'x') => { const p = join(project, name); writeFileSync(p, text); return p }

let pass = 0
const failures = []
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }
const row = async (label, check) => {
  try { await check(); ok(label) } catch (e) { failures.push(label); console.error('  ✗ ' + label + ' — ' + String(e && e.message ? e.message : e).slice(0, 700)) }
}

try {
  console.log('Kybernos plugin: the Creations actions read the engine\'s shell result')

  // ── 1. The two shapes that succeed: the engine's (a method) and the older engines' (a promise) ────────────────────────────────────────────
  for (const s of ['function', 'promise']) {
    shape = s
    forceExit = null
    await row('result as ' + (s === 'function' ? 'a function (the engine)' : 'a promise (older engines)') + ': rename answers yes and the file has its new name', async () => {
      const p = mk('summary-' + s + '.md')
      const r = await act({ action: 'rename', path: p, name: 'summary final ' + s + '.md' })
      assert.equal(r.status, 200)
      assert.deepEqual(r.json, { ok: true, path: join(project, 'summary final ' + s + '.md'), name: 'summary final ' + s + '.md' })
      assert.equal(existsSync(p), false, 'the old name is gone')
      assert.equal(existsSync(join(project, 'summary final ' + s + '.md')), true, 'the new name is there')
    })
    await row('result as ' + s + ': duplicate answers yes with the copy\'s name, and the copy exists', async () => {
      const p = mk('page-' + s + '.html')
      const r = await act({ action: 'duplicate', path: p })
      assert.equal(r.json.ok, true, JSON.stringify(r.json))
      assert.equal(r.json.name, 'page-' + s + ' copy.html')
      assert.equal(existsSync(join(project, r.json.name)), true)
      assert.equal(existsSync(p), true, 'the original stays')
    })
    await row('result as ' + s + ': delete answers yes and the file is gone', async () => {
      const p = mk('table-' + s + '.csv')
      const r = await act({ action: 'delete', path: p })
      assert.deepEqual(r.json, { ok: true, path: p })
      assert.equal(existsSync(p), false)
    })
    await row('result as ' + s + ': Reveal answers yes from both routes, and the command asked for the right file', async () => {
      const p = mk('shown-' + s + '.md')
      const before = seen.length
      assert.deepEqual((await act({ action: 'reveal', path: p })).json, { ok: true })
      assert.deepEqual((await reveal(p)).json, { ok: true })
      const asked = seen.slice(before)
      assert.equal(asked.length, 2)
      for (const c of asked) assert.equal(c, "open -R '" + p + "'")
    })
  }

  // ── 2. A command that ran and failed is a « no », whatever the shape ────────────────────────────────────────────────────────────────────────
  for (const s of ['function', 'promise']) {
    shape = s
    forceExit = 1
    await row('result as ' + s + ' with exit code 1: every action says no, in its own words, and nothing moved', async () => {
      const p = mk('kept-' + s + '.md')
      const del = await act({ action: 'delete', path: p })
      assert.deepEqual(del.json, { ok: false, error: 'deletion refused' })
      const ren = await act({ action: 'rename', path: p, name: 'other-' + s + '.md' })
      assert.deepEqual(ren.json, { ok: false, error: 'mv refused' })
      const dup = await act({ action: 'duplicate', path: p })
      assert.deepEqual(dup.json, { ok: false, error: 'cp refused' })
      assert.deepEqual((await act({ action: 'reveal', path: p })).json, { ok: false, error: 'Finder unavailable' })
      assert.deepEqual((await reveal(p)).json, { ok: false, error: 'Finder unavailable (exit 1)' })
      assert.equal(existsSync(p), true)
    })
  }

  // ── 3. A shell that cannot answer is a « no » with its reason, never a hang or a 500 ───────────────────────────────────────────────────────
  for (const s of ['reject-function', 'reject-promise']) {
    shape = s
    forceExit = 0   // the shell is gone before it runs anything: the command is not run
    await row(s + ': every action answers 200 with ok:false and the shell\'s own message', async () => {
      const p = mk('rejected-' + s + '.md')
      for (const body of [{ action: 'delete', path: p }, { action: 'rename', path: p, name: 'rejected-' + s + ' 2.md' }, { action: 'duplicate', path: p }, { action: 'reveal', path: p }]) {
        const r = await act(body)
        assert.equal(r.status, 200, body.action)
        assert.deepEqual(r.json, { ok: false, error: 'shell gone' }, body.action)
      }
      const rv = await reveal(p)
      assert.deepEqual(rv.json, { ok: false, error: 'shell gone' })
      assert.equal(existsSync(p), true, 'nothing ran')
    })
  }

  // ── 4. No handle at all (an engine that starts nothing) is not a success for the actions that change a file ────────────────────────────────
  shape = 'none'
  forceExit = 0   // nothing is started
  await row('no handle: delete, rename and duplicate say no (an answer without an exit code is not a yes)', async () => {
    const p = mk('nohandle.md')
    assert.equal((await act({ action: 'delete', path: p })).json.ok, false)
    assert.equal((await act({ action: 'rename', path: p, name: 'nohandle 2.md' })).json.ok, false)
    assert.equal((await act({ action: 'duplicate', path: p })).json.ok, false)
    assert.equal(existsSync(p), true, 'nothing ran')
    assert.deepEqual(readdirSync(project).filter((n) => n.startsWith('nohandle')), ['nohandle.md'])
  })

  console.log('\n' + pass + ' passed' + (failures.length > 0 ? ', ' + failures.length + ' FAILED' : ''))
  if (failures.length > 0) process.exitCode = 1
} finally {
  server.close()
}

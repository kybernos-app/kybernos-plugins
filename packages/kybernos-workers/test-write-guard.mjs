// The four POST routes of the Workers page run or write things on the machine, so they need DSH's signed session as well as the right Origin (recette 2026-10-25, L3-15):
//   /install   starts « curl … | bash » (or npm install -g) under /bin/sh for up to fifteen minutes and puts a program on the person's PATH;
//   /activate  mounts a connection package in the profile's cordis.patch.yml (a backup first, then the write);
//   /policy    rewrites that patch (what the lead agent may call, in the background or not);
//   /check     runs the agents' own binaries (`--version`, the sign-in report) and a write test in a throw-away worktree.
// DSH serves plugin routes before its own login and an Origin header is forgeable by any local program: before this, `curl -X POST -H 'Origin: http://127.0.0.1:<port>'
// .../kybernos-workers/install -d '{"worker":"gemini","command":"npm install -g @google/gemini-cli"}'` started the install with no cookie.
//
// The table is enumerated from what the real mount function registers: a POST route that is neither in GUARDED nor in EXCEPTIONS (with its reason) fails the test.
// Per guarded route: no header · a foreign Origin (even with the real cookie) · the right Origin and no cookie · a forged cookie · an expired one · the real pair through
// the phone link, each with an ARMED body (one that really starts the action when let through) and a check that nothing moved; then the real pair with a harmless body (the
// route answers) and with the armed body (the action does start: so « nothing moved » above is not a pass about nothing).
//
//   node packages/kybernos-workers/test-write-guard.mjs
import { createServer } from 'node:http'
import { blocActivation, monterWorkers, trouverWorker } from './workers-host.mjs'
import { sessionSource } from './session-guard.mjs'
import { OTHER_SECRET, SESSION_SECRET, sessionCookie } from './lib-session-test.mjs'

sessionSource.secret = () => SESSION_SECRET

let failed = 0
const check = (name, ok, detail) => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok || detail === undefined ? '' : '  — ' + detail))
  if (!ok) failed += 1
}

const gemini = trouverWorker('gemini')
/** The POST routes that need the session: an armed body (starts the action if the guard lets it through), and the counter of `moved` it must raise. */
const GUARDED = {
  '/kybernos-workers/install': { armed: { worker: 'gemini', command: gemini.install.cmd }, moves: 'install' },
  '/kybernos-workers/activate': { armed: { worker: 'qwen' }, moves: 'patch' },
  '/kybernos-workers/policy': { armed: { worker: 'gemini', expose: true, background: false }, moves: 'patch' },
  '/kybernos-workers/check': { armed: { worker: 'codex' }, moves: 'binary' },
}
/** The POST routes that stay at the strict Origin, and why. None here. */
const EXCEPTIONS = {}
const HARMLESS = { worker: 'no-such-worker', command: 'true', expose: false, background: false } // every route answers 404 unknown-worker

const moved = { install: 0, patch: 0, backup: 0, binary: 0 }
let patch = '# profile patch\n' + blocActivation(gemini, '20261025-120000') // gemini is mounted (so a policy can be written); qwen is not (so it can be activated)
const deps = {
  profils: () => ['web'], profilParDefaut: () => 'web',
  lirePatch: () => patch, cheminPatch: (p) => '/nowhere/' + p + '/cordis.patch.yml',
  ecrirePatch: () => { moved.patch += 1 }, sauvegarder: () => { moved.backup += 1 },
  maintenant: () => new Date(2026, 9, 25, 12, 0, 0),
  io: {
    fichierServeur: '/nowhere/z.mjs', paquetInstalle: () => true, fichierExiste: () => true,
    trouver: async (b) => (b === gemini.binaire ? null : '/bin/' + b), // the program to install is absent, the tools it needs are there
    executer: async () => { moved.binary += 1; return { code: 0, sortie: '' } },
    worktreeJetable: async () => { moved.binary += 1; return { ok: true } },
    cleDansEnv: () => false, plateforme: () => 'darwin',
    lancerInstallation: async () => { moved.install += 1; return { code: 0 } },
  },
}

const routes = new Map()
monterWorkers({ register: (r) => { routes.set(r.path, r.handler) } }, deps)

const server = createServer((req, res) => {
  const handler = routes.get(new URL(req.url, 'http://127.0.0.1').pathname)
  if (handler === undefined) { res.writeHead(404); res.end('{}'); return }
  Promise.resolve(handler(req, res)).catch(() => { try { res.writeHead(500); res.end('{}') } catch (e) { /* closed */ } })
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port
const base = 'http://127.0.0.1:' + port
const cookie = (opts) => sessionCookie('127.0.0.1:' + port, opts)
const send = async (path, method, headers, body) => {
  const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...headers }, body: method === 'GET' ? undefined : JSON.stringify(body ?? {}) })
  return { status: r.status, text: await r.text().catch(() => '') }
}
const REAL = { origin: base, cookie: cookie() }
const nothingMoved = () => Object.values(moved).every((n) => n === 0)

try {
  // ── the family: every registered POST route is classified ───────────────────────────────────────────────────
  const answeringPost = []
  for (const path of routes.keys()) if ((await send(path, 'POST', REAL, HARMLESS)).status !== 405) answeringPost.push(path)
  check('the Workers routes are mounted (' + routes.size + ' paths, ' + answeringPost.length + ' answer a POST)', routes.size === 5 && answeringPost.length === 4)
  const unclassified = answeringPost.filter((p) => GUARDED[p] === undefined && EXCEPTIONS[p] === undefined)
  check('every route that answers a POST is in GUARDED or in EXCEPTIONS (a new write route cannot be forgotten)', unclassified.length === 0, unclassified.join(', '))
  check('...and the tables name no route that is not mounted', [...Object.keys(GUARDED), ...Object.keys(EXCEPTIONS)].every((p) => routes.has(p)))
  check('the probes so far moved nothing', nothingMoved(), JSON.stringify(moved))

  // ── what the guard decides, route by route, with the body that would do the work ─────────────────────────────
  for (const [path, { armed }] of Object.entries(GUARDED)) {
    check(path + ': no Origin and no cookie -> 403', (await send(path, 'POST', {}, armed)).status === 403)
    check(path + ': a foreign Origin -> 403, even with the real cookie', (await send(path, 'POST', { origin: 'http://evil.example', cookie: cookie() }, armed)).status === 403)
    check(path + ': the right Origin and no cookie -> 401', (await send(path, 'POST', { origin: base }, armed)).status === 401)
    check(path + ': the right Origin and a forged cookie -> 401', (await send(path, 'POST', { origin: base, cookie: cookie({ secret: OTHER_SECRET }) }, armed)).status === 401)
    check(path + ': the right Origin and an expired cookie -> 401', (await send(path, 'POST', { origin: base, cookie: cookie({ expiresAt: Date.now() - 1000 }) }, armed)).status === 401)
    const phone = await send(path, 'POST', { ...REAL, 'x-kybernos-tunnel': '1' }, armed)
    check(path + ': the real pair through the phone link -> 403 refused_on_phone', phone.status === 403 && /refused_on_phone/.test(phone.text), phone.status + ' ' + phone.text)
    check(path + ': nothing moved for any of those', nothingMoved(), JSON.stringify(moved))
    const real = await send(path, 'POST', REAL, HARMLESS)
    check(path + ': the right Origin and the real cookie -> the route answers (' + real.status + ')', real.status === 404 && /unknown-worker/.test(real.text), real.status + ' ' + real.text.slice(0, 80))
  }
  check('/kybernos-workers/install: GET (the job status) stays a read, whatever the cookie', (await send('/kybernos-workers/install?worker=gemini', 'GET', { origin: base })).status === 200)

  // ── the armed bodies are armed: with the real pair each one does start its action ────────────────────────────
  for (const [path, { armed, moves }] of Object.entries(GUARDED)) {
    const before = moved[moves]
    const real = await send(path, 'POST', REAL, armed)
    await new Promise((resolve) => setTimeout(resolve, 30)) // the install runs off the request
    check(path + ': the real pair with the armed body does the work (' + real.status + ', ' + moves + ' ' + before + ' -> ' + moved[moves] + ')', real.status < 300 && moved[moves] > before, real.status + ' ' + real.text.slice(0, 80))
  }
} finally {
  server.close()
}

console.log(failed === 0 ? '\nall green' : '\n' + failed + ' failure(s)')
process.exit(failed === 0 ? 0 : 1)

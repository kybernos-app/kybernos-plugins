// The terminal's run route starts a shell, so it must not rely on an Origin header alone (any local program can send one,
// and DSH serves plugin routes before its own login). It needs DSH's signed session cookie and stays closed without it.
// Measured on 2026-10-09: `curl -H 'Origin: http://127.0.0.1:<port>' -d '{"commande":"echo x"}'` ran the command, no cookie.
//   node packages/kybernos-terminal/test-host.mjs
import { createHash, createHmac, randomBytes } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cookieSessionValide, dossierDeSession, dshHome, executer, lireSecretSession, lisible, monterRoutes, origineOK } from './index.js'

let failed = 0
const check = (name, ok, detail) => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok || detail === undefined ? '' : '  — ' + detail))
  if (!ok) failed += 1
}

// The cookie, built here from the documented scheme (not with the code under test).
const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const cookieFor = (secret, authority, { expiresAt = Date.now() + 3600_000, version = 1 } = {}) => {
  const body = b64url(Buffer.from(JSON.stringify({ version, authority, issuedAt: Date.now(), expiresAt })))
  const sig = b64url(createHmac('sha256', secret).update(body).digest())
  return 'dsh-auth-' + b64url(createHash('sha256').update(authority).digest()) + '=v1.' + body + '.' + sig
}

const SECRET = randomBytes(32)
const OTHER_SECRET = randomBytes(32)
const AUTH = '127.0.0.1:3080'

console.log('the session cookie')
{
  const valid = cookieFor(SECRET, AUTH)
  check('a valid cookie is accepted', cookieSessionValide(valid, [AUTH], SECRET) === true)
  check('among other cookies', cookieSessionValide('a=1; ' + valid + '; b=2', [AUTH], SECRET) === true)
  check('signed with another secret → refused', cookieSessionValide(cookieFor(OTHER_SECRET, AUTH), [AUTH], SECRET) === false)
  check('expired → refused', cookieSessionValide(cookieFor(SECRET, AUTH, { expiresAt: Date.now() - 1000 }), [AUTH], SECRET) === false)
  check('wrong version → refused', cookieSessionValide(cookieFor(SECRET, AUTH, { version: 2 }), [AUTH], SECRET) === false)
  check('a cookie for another port → refused', cookieSessionValide(cookieFor(SECRET, '127.0.0.1:3081'), [AUTH], SECRET) === false)
  check('a body altered after signing → refused', cookieSessionValide(valid.replace(/=v1\.([^.]+)\./, (m, b) => '=v1.' + b.slice(0, -2) + 'AA.'), [AUTH], SECRET) === false)
  check('no cookie header → refused', cookieSessionValide(undefined, [AUTH], SECRET) === false)
  check('empty header → refused', cookieSessionValide('', [AUTH], SECRET) === false)
  check('garbage → refused', cookieSessionValide('dsh-auth-x=v1.a.b; y', [AUTH], SECRET) === false)
  check('an oversized header → refused', cookieSessionValide('a=' + 'x'.repeat(9000), [AUTH], SECRET) === false)
  check('no secret (null) → refused', cookieSessionValide(valid, [AUTH], null) === false)
  check('an empty secret → refused', cookieSessionValide(valid, [AUTH], Buffer.alloc(0)) === false)
}

console.log('the secret and the DSH folder')
{
  const dir = mkdtempSync(join(tmpdir(), 'kb-term-'))
  try {
    writeFileSync(join(dir, '.credentials.yaml'), 'other/thing:\n  secret: zzzz\nclient-connection/browser-session:\n  secret: ' + b64url(SECRET) + '\n')
    const got = lireSecretSession(dir)
    check('reads the 32-byte secret of client-connection/browser-session', got !== null && Buffer.compare(got, SECRET) === 0)
    check('a missing file → null', lireSecretSession(join(dir, 'nope')) === null)
    writeFileSync(join(dir, '.credentials.yaml'), 'client-connection/browser-session:\n  secret: ' + b64url(randomBytes(16)) + '\n')
    check('a secret of the wrong length → null', lireSecretSession(dir) === null)
    writeFileSync(join(dir, '.credentials.yaml'), 'something/else:\n  secret: ' + b64url(SECRET) + '\n')
    check('no browser-session entry → null (another secret is not taken)', lireSecretSession(dir) === null)
  } finally { rmSync(dir, { recursive: true, force: true }) }
  const home = () => '/home/someone'
  check('DSH_HOME unset → ~/.dsh', dshHome({}, home) === '/home/someone/.dsh')
  check('DSH_HOME blank → ~/.dsh', dshHome({ DSH_HOME: '   ' }, home) === '/home/someone/.dsh')
  check('DSH_HOME set is the DSH folder itself', dshHome({ DSH_HOME: '/srv/dsh' }, home) === '/srv/dsh')
  check('DSH_HOME ~/x is expanded', dshHome({ DSH_HOME: '~/x' }, home) === '/home/someone/x')
}

console.log('the same-origin guard')
{
  const r = (method, origin, extra = {}) => ({ method, headers: origin === undefined ? {} : { origin }, socket: { localPort: 3080 }, ...extra })
  check('same origin POST', origineOK(r('POST', 'http://127.0.0.1:3080')) === true)
  check('localhost POST', origineOK(r('POST', 'http://localhost:3080')) === true)
  check('a foreign origin', origineOK(r('POST', 'https://evil.example')) === false)
  check('a neighbouring port', origineOK(r('POST', 'http://127.0.0.1:3081')) === false)
  check('127.0.0.1.evil.com', origineOK(r('POST', 'http://127.0.0.1.evil.com:3080')) === false)
  check('POST without Origin or Referer', origineOK(r('POST', undefined)) === false)
  check('file://', origineOK(r('POST', 'file:///x')) === false)
}

console.log('the route')
const handlerFor = (options) => {
  let handler = null
  monterRoutes({ register: (d) => { handler = d.handler } }, options)
  return handler
}
// A fake request: the body is emitted right after the handler is called (it registers its listeners synchronously).
const call = async (handler, { method = 'POST', origin = 'http://127.0.0.1:3080', cookie, body = '{"commande":"echo hi"}' } = {}) => {
  // origin: null sends no Origin header (undefined would fall back to the default)
  const req = Object.assign(new EventEmitter(), { method, headers: { ...(origin === null ? {} : { origin }), ...(cookie === undefined ? {} : { cookie }) }, socket: { localPort: 3080 } })
  const out = { status: null, body: null }
  const res = { writeHead: (s) => { out.status = s }, end: (b) => { out.body = b } }
  const done = handler(req, res)
  req.emit('data', body)
  req.emit('end')
  await done
  return out
}
{
  const ran = []
  const fakeRun = async (b) => { ran.push(b); return { ok: true, code: 0, stdout: 'hi\n', stderr: '', cwd: '/' } }
  const good = cookieFor(SECRET, AUTH)
  const h = handlerFor({ lireSecret: () => SECRET, executer: fakeRun })

  let o = await call(h, { cookie: good })
  check('same origin + valid cookie → 200 and the command ran', o.status === 200 && ran.length === 1 && ran[0].commande === 'echo hi', JSON.stringify([o.status, ran.length]))
  check('the answer is JSON with the output', JSON.parse(o.body).stdout === 'hi\n')

  ran.length = 0
  o = await call(h, {})
  check('THE MEASURED ATTACK: same-origin header, no cookie → 401, nothing ran', o.status === 401 && ran.length === 0, JSON.stringify([o.status, ran.length]))
  o = await call(h, { cookie: cookieFor(OTHER_SECRET, AUTH) })
  check('a forged cookie (wrong secret) → 401, nothing ran', o.status === 401 && ran.length === 0)
  o = await call(h, { cookie: cookieFor(SECRET, AUTH, { expiresAt: Date.now() - 1 }) })
  check('an expired cookie → 401, nothing ran', o.status === 401 && ran.length === 0)
  o = await call(h, { origin: 'https://evil.example', cookie: good })
  check('foreign origin, even with a valid cookie → 403, nothing ran', o.status === 403 && ran.length === 0)
  ran.length = 0
  o = await call(h, { origin: null, cookie: good })
  check('no Origin at all → 403, nothing ran', o.status === 403 && ran.length === 0)
  ran.length = 0
  o = await call(h, { method: 'GET', cookie: good })
  check('GET → 405, nothing ran', o.status === 405 && ran.length === 0)
  ran.length = 0
  o = await call(h, { cookie: good, body: JSON.stringify({ commande: 'x'.repeat(20000) }) })
  check('a body over 16 KiB → 413, nothing ran', o.status === 413 && ran.length === 0, String(o.status))
  ran.length = 0
  o = await call(h, { cookie: good, body: 'not json' })
  check('an unreadable body → the runner is called with an empty command (it refuses it)', ran.length === 1 && Object.keys(ran[0]).length === 0)

  ran.length = 0
  const failing = handlerFor({ lireSecret: () => SECRET, executer: async () => ({ ok: false, erreur: 'empty command' }) })
  o = await call(failing, { cookie: good })
  check('a refused command → 400 with its reason', o.status === 400 && JSON.parse(o.body).erreur === 'empty command')

  const closed = handlerFor({ lireSecret: () => null, executer: fakeRun })
  o = await call(closed, { cookie: good })
  check('FAILS CLOSED: the secret cannot be read → 503, nothing ran, even with a cookie', o.status === 503 && ran.length === 0, JSON.stringify([o.status, ran.length]))
  o = await call(closed, {})
  check('…and without a cookie too', o.status === 503 && ran.length === 0)
}

console.log('the runner')
{
  if (existsSync('/bin/zsh')) {
    const r = await executer({ commande: 'echo hi' })
    check('runs a command and returns its output', r.ok === true && r.code === 0 && r.stdout === 'hi\n', JSON.stringify(r))
    const e = await executer({ commande: 'exit 3' })
    check('reports a non-zero exit code', e.ok === true && e.code === 3)
  } else {
    console.log('  - /bin/zsh is not installed here: the two runs are skipped')
  }
  check('an empty command is refused', (await executer({ commande: '   ' })).ok === false)
  check('a command over 500 characters is refused', (await executer({ commande: 'x'.repeat(501) })).ok === false)
}

console.log('where it runs (audit A4-17): the folder of the session, found by the host')
{
  const project = realpathSync(mkdtempSync(join(tmpdir(), 'kb-term-proj-')))
  try {
    const ran = []
    const good = cookieFor(SECRET, AUTH)
    const run = async (b) => { ran.push(b); return { ok: true, code: 0, stdout: '', stderr: '', cwd: b.cwd ?? '~' } }
    const h = handlerFor({ lireSecret: () => SECRET, executer: run, dossierDeSession: async (id) => (id === 's1' ? project : null) })
    let o = await call(h, { cookie: good, body: JSON.stringify({ commande: 'git status', session: 's1' }) })
    check('a command run for a session gets the folder of that session', o.status === 200 && ran.length === 1 && ran[0].cwd === project && ran[0].commande === 'git status', JSON.stringify(ran))
    check('...the session id itself is not handed to the runner', ran[0].session === undefined)

    ran.length = 0
    o = await call(h, { cookie: good, body: JSON.stringify({ commande: 'rm -rf build', session: 's1', cwd: '/etc' }) })
    check('a folder sent by the page is never used', o.status === 200 && ran.length === 1 && ran[0].cwd === project, JSON.stringify(ran))
    ran.length = 0
    o = await call(h, { cookie: good, body: JSON.stringify({ commande: 'rm -rf build', cwd: '/etc' }) })
    check('...nor when there is no session (the runner then falls back to its default)', o.status === 200 && ran.length === 1 && ran[0].cwd === undefined, JSON.stringify(ran))

    ran.length = 0
    o = await call(h, { cookie: good, body: JSON.stringify({ commande: 'npm install', session: 'unknown' }) })
    check('a session whose folder cannot be found runs NOTHING (it used to run in the home folder)', o.status === 400 && ran.length === 0 && /folder of this session/.test(JSON.parse(o.body).erreur), o.body)

    // the real resolver, on what the core plugin publishes
    const KEY = Symbol.for('kybernos.workspace')
    const had = globalThis[KEY]
    try {
      delete globalThis[KEY]
      check('without the core plugin\'s workspace service no folder is found', (await dossierDeSession('s1')) === null)
      globalThis[KEY] = { sessionCwd: async (id) => (id === 's1' ? project : null) }
      check('with it, the folder of the session', (await dossierDeSession('s1')) === project && (await dossierDeSession('s2')) === null)
      globalThis[KEY] = { sessionCwd: async () => { throw new Error('boom') } }
      check('a failing service means no folder, not a crash', (await dossierDeSession('s1')) === null)
    } finally { if (had === undefined) delete globalThis[KEY]; else globalThis[KEY] = had }

    if (existsSync('/bin/zsh')) {
      const sub = join(project, 'sub dir')
      mkdirSync(sub)
      const r = await executer({ commande: 'pwd', cwd: sub })
      check('the runner runs in the folder it is given', r.ok === true && r.stdout.trim() === realpathSync(sub), JSON.stringify(r))
      const gone = await executer({ commande: 'pwd', cwd: join(project, 'nope') })
      check('a folder that is gone is said, not hidden behind a spawn error', gone.ok === false && /folder/.test(gone.erreur) && !gone.erreur.includes(project), JSON.stringify(gone))
    }
  } finally { rmSync(project, { recursive: true, force: true }) }
}

console.log('the run card edge cases (audit A4-18)')
if (existsSync('/bin/zsh')) {
  const cut = await executer({ commande: 'yes hello | head -c 5000' }, { sortieMax: 100 })
  check('output past the cap is cut AND says so', cut.ok === true && cut.stdout.length === 100 && cut.truncated === true, JSON.stringify({ n: cut.stdout.length, t: cut.truncated }))
  const whole = await executer({ commande: 'echo short' })
  check('output under the cap is not marked cut', whole.truncated === false && whole.stdout === 'short\n')

  const t0 = Date.now()
  const reads = await executer({ commande: 'read x; echo got-$x' }, { timeoutMs: 8000 })
  check('a command that reads its input does not wait for the timeout (stdin is closed)', Date.now() - t0 < 4000 && reads.ok === true && reads.timedOut === false, JSON.stringify({ ms: Date.now() - t0, reads }))
  const cat = await executer({ commande: 'cat; echo end' }, { timeoutMs: 8000 })
  check('...cat sees an immediate end of input', cat.ok === true && cat.stdout === 'end\n', JSON.stringify(cat))

  const late = await executer({ commande: 'sleep 5; echo late' }, { timeoutMs: 300 })
  check('a timeout is reported as one, with no exit code', late.ok === true && late.timedOut === true && late.code === null && late.stdout === '', JSON.stringify(late))

  const bin = await executer({ commande: "printf 'a\\x00b\\x1b[31mc'" })
  check('control characters come out as visible pictures, never a raw NUL', bin.ok === true && bin.stdout === 'a\u2400b\u241b[31mc' && !bin.stdout.includes('\u0000'), JSON.stringify(bin.stdout))
  check('...newline, tab and carriage return are kept', lisible('a\nb\tc\rd') === 'a\nb\tc\rd' && lisible('\u007f') === '\u2421')
}

console.log('a hosted instance (--trusted-host)')
{
  const KEY = Symbol.for('kybernos.trustedAuthority')
  const ran = []
  const rr = (origin) => ({ method: 'POST', headers: { origin }, socket: { localPort: 3080 } })
  check('nothing published: a declared host\'s origin is refused', origineOK(rr('https://dsh.example.com')) === false)
  globalThis[KEY] = (host) => host === 'dsh.example.com'
  try {
    check('a declared host\'s origin passes the origin check', origineOK(rr('https://dsh.example.com')) === true)
    check('an undeclared host is still refused', origineOK(rr('https://evil.example')) === false)
    const h = handlerFor({ lireSecret: () => SECRET, executer: async (b) => { ran.push(b); return { ok: true, code: 0, stdout: '', stderr: '', cwd: '/' } } })
    ran.length = 0
    let o = await call(h, { origin: 'https://dsh.example.com', cookie: cookieFor(SECRET, 'dsh.example.com') })
    check('the shell stays closed there: a cookie for the declared host is not accepted → 401, nothing ran', o.status === 401 && ran.length === 0, JSON.stringify([o.status, ran.length]))
    o = await call(h, { origin: 'https://dsh.example.com' })
    check('and without any cookie → 401, nothing ran', o.status === 401 && ran.length === 0)
  } finally { delete globalThis[KEY] }
}

console.log(failed === 0 ? '\nOK' : `\n${failed} failure(s)`)
process.exit(failed === 0 ? 0 : 1)

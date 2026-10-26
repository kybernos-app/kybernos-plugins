// Every POST route of the Changes panel, the sessions list and Settings needs DSH's signed session as well as the right Origin (recette 2026-10-25, L3-18). The routes run git and gh in
// the person's folders (isolate, commit, close, reclaim, push, fetch, sync, pr), write the files the agents read (settings.json, the category registry) and spend the Study model
// (brain/health, decision). DSH serves plugin routes before its own login and an Origin header is forgeable by any local program: before this, `curl -X POST -H 'Origin:
// http://127.0.0.1:<port>' .../kybernos-sessions/push -d '{"session":"…","exec":true}'` published the commits nobody had reviewed, and `pr` with `{"action":"merge","exec":true}` merged the pull request.
//
// The test mounts the real routes over a throw-away git repository with a bare remote, and puts a recording `git` and `gh` first on the PATH: the record is the proof. A refused request must
// leave it empty (no git, no gh, not even a `git status`), and the same armed body sent with the real pair must leave lines in it. The model is a counter, the settings and the category registry
// are read back from disk. The table is enumerated from what the real mount registers: a path that is none of GUARDED, EXCEPTIONS or READS fails the test.
//
// Per guarded route: no header · a foreign Origin (even with the real cookie) · the right Origin and no cookie · a forged cookie · an expired one · the real pair through the phone link.
//
//   node packages/kybernos-sessions/test-write-guard.mjs
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { monterRoutes } from './index.js'
import { sessionSource } from './session-guard.mjs'
import { OTHER_SECRET, SESSION_SECRET, sessionCookie } from './lib-session-test.mjs'

sessionSource.secret = () => SESSION_SECRET

let failed = 0
const check = (name, ok, detail) => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok || detail === undefined ? '' : '  — ' + detail))
  if (!ok) failed += 1
}

// ── a throw-away machine: DSH home, a repository with a bare remote, a recording git and gh ──────────────────────
const base = realpathSync(mkdtempSync(join(tmpdir(), 'ksg')))
const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim()
const env = { ...process.env, HOME: base, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'Guard Test', GIT_AUTHOR_EMAIL: 'guard@example.invalid', GIT_COMMITTER_NAME: 'Guard Test', GIT_COMMITTER_EMAIL: 'guard@example.invalid' }
Object.assign(process.env, env)
const git = (cwd, ...args) => execFileSync(realGit, args, { cwd, env, encoding: 'utf8' })
const remote = join(base, 'remote.git')
const repo = join(base, 'work', 'proj')
mkdirSync(join(base, 'work'), { recursive: true })
git(base, 'init', '-q', '--bare', '-b', 'main', remote)
git(join(base, 'work'), 'clone', '-q', remote, 'proj')
writeFileSync(join(repo, 'README.md'), 'start\n')
git(repo, 'add', '-A')
git(repo, 'commit', '-q', '-m', 'start')
git(repo, 'push', '-q', '-u', 'origin', 'HEAD:main')
writeFileSync(join(repo, 'mine.txt'), 'written by this chat\n')

const log = join(base, 'tools.log')
writeFileSync(log, '')
const bin = join(base, 'bin')
mkdirSync(bin)
writeFileSync(join(bin, 'git'), '#!/bin/sh\necho "git $*" >> ' + JSON.stringify(log) + '\nexec ' + JSON.stringify(realGit) + ' "$@"\n')
writeFileSync(join(bin, 'gh'), '#!/bin/sh\necho "gh $*" >> ' + JSON.stringify(log) + '\necho "https://example.invalid/pr/1"\nexit 0\n')
chmodSync(join(bin, 'git'), 0o755)
chmodSync(join(bin, 'gh'), 0o755)
process.env.PATH = bin + ':' + process.env.PATH
const toolCalls = () => readFileSync(log, 'utf8').split('\n').filter((l) => l !== '').length

const dsh = join(base, 'dsh')
const sessionsHome = join(dsh, 'sessions')
const slug = '-' + repo.replace(/\//g, '-') + '--'
mkdirSync(join(sessionsHome, slug, 'session-abc12345'), { recursive: true })
mkdirSync(join(dsh, 'kybernos'), { recursive: true })
const reglages = join(dsh, 'kybernos', 'settings.json')
const categories = join(dsh, 'kybernos', 'categories.json')
writeFileSync(reglages, JSON.stringify({ brain: 'prov/model' }))
const text = (file) => (existsSync(file) ? readFileSync(file, 'utf8') : null)

let modelCalls = 0
const llm = { stream () { modelCalls += 1; return (async function * () { yield { type: 'text-delta', text: 'ui' }; yield { type: 'finish', reason: { kind: 'stop' } } })() } }

/** The POST routes that need the session, each with an ARMED body: what the page sends, with `exec` true where the route asks for it. */
const SESSION = { session: 'abc12345' }
const GUARDED = {
  '/kybernos-sessions/isolate': { ...SESSION, nom: 'guardprobe', but: 'probe', exec: true, effect: 'tools' },
  '/kybernos-sessions/commit': { ...SESSION, chemins: ['mine.txt'], message: 'guard probe', exec: true, effect: 'tools' },
  '/kybernos-sessions/close-check': { ...SESSION, effect: 'tools' },
  '/kybernos-sessions/close': { ...SESSION, exec: true, effect: 'tools' },
  '/kybernos-sessions/reclaim': { ...SESSION, exec: true, effect: 'tools' },
  '/kybernos-sessions/push': { ...SESSION, exec: true, effect: 'tools' },
  '/kybernos-sessions/fetch': { ...SESSION, exec: true, effect: 'tools' },
  '/kybernos-sessions/sync': { ...SESSION, exec: true, effect: 'tools' },
  '/kybernos-sessions/pr': { ...SESSION, action: 'merge', exec: true, effect: 'tools' },
  '/kybernos-sessions/settings': { brain: 'prov/other', effect: 'settings' },
  '/kybernos-sessions/categories': { session: 'abc12345', cat: 'ui', titre: 'a title', effect: 'categories' },
  '/kybernos-sessions/brain/health': { models: ['prov/model'], force: true, effect: 'model' },
  '/kybernos-sessions/decision': { categorie: 'zzz qqq xxx', effect: 'model' },
}
/** The POST routes that stay at the strict Origin, and why. None here. */
const EXCEPTIONS = {}
/** The routes that only read (a POST is a 405). */
const READS = ['/kybernos-sessions/state']

const routes = new Map()
const log0 = console.log
console.log = () => {}
try { monterRoutes({ register: (r) => { routes.set(r.path, r.handler); return () => {} } }, { sessionsHome, kybersHome: join(dsh, 'kybers'), reglagesPath: reglages, categoriesPath: categories, ctx: { get: (n) => (n === 'llm' ? llm : undefined) } }) } finally { console.log = log0 }

const server = createServer((req, res) => {
  const handler = routes.get(new URL(req.url, 'http://127.0.0.1').pathname)
  if (handler === undefined) { res.writeHead(404); res.end('{}'); return }
  Promise.resolve(handler(req, res)).catch(() => { try { res.writeHead(500); res.end('{}') } catch (e) { /* closed */ } })
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port
const base0 = 'http://127.0.0.1:' + port
const cookie = (opts) => sessionCookie('127.0.0.1:' + port, opts)
const send = async (path, method, headers, body) => {
  const { effect, ...rest } = body ?? {}
  void effect
  const r = await fetch(base0 + path, { method, headers: { 'content-type': 'application/json', ...headers }, body: method === 'GET' ? undefined : JSON.stringify(rest) })
  return { status: r.status, text: await r.text().catch(() => '') }
}
const REAL = { origin: base0, cookie: cookie() }
const snapshot = () => JSON.stringify({ tools: toolCalls(), settings: text(reglages), categories: text(categories), model: modelCalls, readme: text(join(repo, 'README.md')), mine: text(join(repo, 'mine.txt')) })

try {
  // ── the family: every registered path is classified ─────────────────────────────────────────────────────────
  const answeringPost = []
  for (const path of routes.keys()) if ((await send(path, 'POST', {}, {})).status !== 405) answeringPost.push(path)
  const known = [...Object.keys(GUARDED), ...Object.keys(EXCEPTIONS), ...READS]
  check('the sessions routes are mounted (' + routes.size + ' paths, ' + answeringPost.length + ' answer a POST)', routes.size === 14 && answeringPost.length === 13)
  const unclassified = [...routes.keys()].filter((p) => !known.includes(p))
  check('every mounted path is in GUARDED, EXCEPTIONS or READS (a new write route cannot be forgotten)', unclassified.length === 0, unclassified.join(', '))
  check('...and every route that answers a POST is guarded or a written exception', answeringPost.every((p) => GUARDED[p] !== undefined || EXCEPTIONS[p] !== undefined))
  check('...and the tables name no route that is not mounted', known.every((p) => routes.has(p)))
  check('the probes so far ran no git and no gh', toolCalls() === 0, String(toolCalls()))

  // ── what the guard decides, route by route, with the body that would do the work ─────────────────────────────
  const start = snapshot()
  for (const [path, armed] of Object.entries(GUARDED)) {
    const short = path.slice('/kybernos-sessions/'.length)
    check(short + ': no Origin and no cookie -> 403', (await send(path, 'POST', {}, armed)).status === 403)
    check(short + ': a foreign Origin -> 403, even with the real cookie', (await send(path, 'POST', { origin: 'http://evil.example', cookie: cookie() }, armed)).status === 403)
    check(short + ': the right Origin and no cookie -> 401 (what a local program sends)', (await send(path, 'POST', { origin: base0 }, armed)).status === 401)
    check(short + ': the right Origin and a forged cookie -> 401', (await send(path, 'POST', { origin: base0, cookie: cookie({ secret: OTHER_SECRET }) }, armed)).status === 401)
    check(short + ': the right Origin and an expired cookie -> 401', (await send(path, 'POST', { origin: base0, cookie: cookie({ expiresAt: Date.now() - 1000 }) }, armed)).status === 401)
    const phone = await send(path, 'POST', { ...REAL, 'x-kybernos-tunnel': '1' }, armed)
    check(short + ': the real pair through the phone link -> 403 refused_on_phone', phone.status === 403 && /refused_on_phone/.test(phone.text), phone.status + ' ' + phone.text.slice(0, 80))
  }
  check('no refused request ran git or gh, called the model, or touched settings.json, the category registry or the working tree', snapshot() === start, 'tools: ' + toolCalls() + ', model: ' + modelCalls)
  check('...and the remote still holds only the first commit', git(remote, 'rev-list', '--count', 'main').trim() === '1')

  // ── the real pair gets through, and the same armed bodies leave their mark ───────────────────────────────────
  const GETS = [['/kybernos-sessions/settings', 'settings'], ['/kybernos-sessions/categories', 'categories'], ['/kybernos-sessions/brain/health', 'brain/health']]
  for (const [path, short] of GETS) check(short + ': the read stays open to a page with no cookie (GET)', (await send(path, 'GET', { origin: base0 }, {})).status === 200)
  for (const [path, armed] of Object.entries(GUARDED)) {
    const short = path.slice('/kybernos-sessions/'.length)
    const before = armed.effect === 'tools' ? toolCalls() : armed.effect === 'model' ? modelCalls : armed.effect === 'settings' ? text(reglages) : text(categories)
    const real = await send(path, 'POST', REAL, armed)
    const after = armed.effect === 'tools' ? toolCalls() : armed.effect === 'model' ? modelCalls : armed.effect === 'settings' ? text(reglages) : text(categories)
    check(short + ': the real pair with the armed body does the work (' + real.status + ', ' + armed.effect + ' changed: ' + (after !== before) + ')', real.status === 200 && after !== before, real.status + ' ' + real.text.slice(0, 110))
  }
  check('the armed commit and push put the chat\'s file on the remote', git(remote, 'rev-list', '--count', 'main').trim() === '2', git(remote, 'rev-list', '--count', 'main').trim())
  check('the armed pr merge reached gh', readFileSync(log, 'utf8').split('\n').some((l) => l.startsWith('gh ') && /merge/.test(l)))
} finally {
  server.close()
}

console.log(failed === 0 ? '\nall green' : '\n' + failed + ' failure(s)')
process.exit(failed === 0 ? 0 : 1)

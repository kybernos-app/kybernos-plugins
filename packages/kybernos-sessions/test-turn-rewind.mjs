#!/usr/bin/env node
// Unit and integration tests for kybernos-sessions Turn Rewind (turn-rewind.mjs + host routes).
// Runs in a temporary directory: no network, no git required, nothing outside tmpdir.
//
//   node packages/kybernos-sessions/test-turn-rewind.mjs
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  MAX_FILE_BYTES,
  MAX_TURNS,
  REWIND_TEXTS,
  attachRewindHooks,
  createRewindLedger,
  extractMutationPaths,
  patchPaths,
  promptFromContent,
  resolveConfined,
  safeSessionId,
  shellMutationPaths
} from './turn-rewind.mjs'
import { monterRoutes } from './index.js'
import { sessionSource } from './session-guard.mjs'
import { SESSION_SECRET, sessionCookie } from './lib-session-test.mjs'

sessionSource.secret = () => SESSION_SECRET

let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) }
}

const root = realpathSync(mkdtempSync(join(tmpdir(), 'kb-rewind-')))

try {
  // ── 1. pure helpers & path confinement ────────────────────────────────────────────────────────────────────
  console.log('\n── pure helpers and workspace confinement ──')
  check('safeSessionId strips session- prefix and rejects traversal', safeSessionId('session-abc_12.3') === 'abc_12.3' && safeSessionId('../evil') === '' && safeSessionId('a/b') === '' && safeSessionId('') === '')
  check('promptFromContent strips system-reminder blocks and clamps long text', promptFromContent([{ type: 'text', text: '<system-reminder>secret</system-reminder>  Fix   the header  ' }]) === 'Fix the header' && promptFromContent('x'.repeat(200)).length === 120)

  const ws = join(root, 'workspace')
  const outside = join(root, 'outside')
  mkdirSync(join(ws, 'src'), { recursive: true })
  mkdirSync(join(ws, '.git', 'objects'), { recursive: true })
  mkdirSync(outside, { recursive: true })
  writeFileSync(join(ws, 'src', 'app.js'), 'v0\n')
  writeFileSync(join(outside, 'secret.txt'), 'nope\n')
  symlinkSync(outside, join(ws, 'escape-link'))

  const okInside = resolveConfined(ws, 'src/app.js')
  check('inside workspace resolves cleanly', okInside !== null && okInside.relPath === 'src/app.js')
  const okNew = resolveConfined(ws, 'src/newdir/file.txt')
  check('non-existent file inside workspace resolves cleanly', okNew !== null && okNew.relPath === 'src/newdir/file.txt')
  check('path escaping workspace via .. is refused', resolveConfined(ws, '../outside/secret.txt') === null)
  check('symlink ancestor escaping workspace is refused', resolveConfined(ws, 'escape-link/secret.txt') === null)
  check('absolute path outside workspace is refused', resolveConfined(ws, join(outside, 'secret.txt')) === null)
  check('.git internals are always refused', resolveConfined(ws, '.git/HEAD') === null && resolveConfined(ws, '.git/objects/aa') === null)

  // ── 2. mutation path extraction ───────────────────────────────────────────────────────────────────────────
  console.log('\n── mutation path extraction ──')
  check('write / edit / multi_edit extract target paths',
    JSON.stringify(extractMutationPaths('write', { file_path: 'a.js' })) === '["a.js"]' &&
    JSON.stringify(extractMutationPaths('multi_edit', { path: 'b.js', edits: [{ file_path: 'c.js' }] })) === '["b.js","c.js"]')
  check('str_replace_editor ignores view command', extractMutationPaths('str_replace_editor', { command: 'view', path: 'a.js' }).length === 0 && extractMutationPaths('str_replace_editor', { command: 'str_replace', path: 'a.js' })[0] === 'a.js')
  check('apply_patch extracts Add/Update/Delete/Move targets',
    JSON.stringify(patchPaths('*** Begin Patch\n*** Update File: src/a.js\n*** Move to: src/b.js\n*** Add File: src/c.js\n*** Delete File: src/d.js\n*** End Patch')) === '["src/a.js","src/b.js","src/c.js","src/d.js"]')
  check('shellMutationPaths extracts redirections, rm, mv, cp, tee and ignores heredoc bodies', (() => {
    const p1 = shellMutationPaths('echo hi > out.txt && rm -f old.txt && mv a.js b.js')
    const p2 = shellMutationPaths("cat > target.js <<'EOF'\nif (x > fake.txt) {}\nEOF")
    return p1.includes('out.txt') && p1.includes('old.txt') && p1.includes('a.js') && p1.includes('b.js') &&
      p2.includes('target.js') && !p2.includes('fake.txt')
  })())
  check('read-only tools produce no mutation paths', extractMutationPaths('read', { file_path: 'a.js' }).length === 0 && extractMutationPaths('grep', { path: 'src' }).length === 0)

  // ── 3. multi-turn Change Ledger in a plain non-git folder ─────────────────────────────────────────────────
  console.log('\n── multi-turn ledger, dry-run, restore and automatic rescue ──')
  const plainWs = join(root, 'plain-folder')
  mkdirSync(join(plainWs, 'nested'), { recursive: true })
  writeFileSync(join(plainWs, 'note.txt'), 'v0')
  writeFileSync(join(plainWs, 'nested', 'keep.txt'), 'sibling')

  let clock = 1_700_000_000_000
  const ledger = createRewindLedger({ rootDir: join(root, 'rewind-store'), now: () => { clock += 1000; return clock } })

  // Turn 1: edits note.txt twice (v0 -> v1 -> v1b); first-touch must preserve v0.
  ledger.recordPreMutation({ sessionId: 's1', cwd: plainWs, turnId: 't1', prompt: 'Update note', rawPath: 'note.txt' })
  writeFileSync(join(plainWs, 'note.txt'), 'v1')
  const secondTouch = ledger.recordPreMutation({ sessionId: 's1', cwd: plainWs, turnId: 't1', prompt: 'Update note', rawPath: 'note.txt' })
  writeFileSync(join(plainWs, 'note.txt'), 'v1b')
  check('first-touch per turn preserves earliest pre-mutation bytes', secondTouch.alreadyCaptured === true)

  // Turn 2: edits note.txt (v1b -> v2) and creates nested/extra/new.txt.
  ledger.recordPreMutation({ sessionId: 's1', cwd: plainWs, turnId: 't2', prompt: 'Add extra file', rawPath: 'note.txt' })
  writeFileSync(join(plainWs, 'note.txt'), 'v2')
  ledger.recordPreMutation({ sessionId: 's1', cwd: plainWs, turnId: 't2', prompt: 'Add extra file', rawPath: 'nested/extra/new.txt' })
  mkdirSync(join(plainWs, 'nested', 'extra'), { recursive: true })
  writeFileSync(join(plainWs, 'nested', 'extra', 'new.txt'), 'created in turn 2')

  const listed = ledger.listTurns('s1')
  check('listTurns returns newest first with file counts', listed.ok === true && listed.turns.length === 2 && listed.turns[0].id === 't2' && listed.turns[1].id === 't1' && listed.turns[0].fileCount === 2)

  // Dry-run rewind to Turn 1: must not touch disk.
  const dry = ledger.planRewind({ sessionId: 's1', cwd: plainWs, turnId: 't1' })
  check('dry-run computes restore + delete across t1..t2 without touching disk',
    dry.ok === true && dry.dry === true && dry.summary.restore === 1 && dry.summary.delete === 1 &&
    dry.rescueWillBeCreated === true && readFileSync(join(plainWs, 'note.txt'), 'utf8') === 'v2' &&
    existsSync(join(plainWs, 'nested', 'extra', 'new.txt')))

  // Selective rewind: only note.txt, leave nested/extra/new.txt alone.
  const sel = ledger.executeRewind({ sessionId: 's1', cwd: plainWs, turnId: 't1', paths: ['note.txt'] })
  check('selective rewind restores only requested path and creates rescue point',
    sel.ok === true && sel.code === 'rewound' && sel.count === 1 && typeof sel.rescueId === 'string' &&
    readFileSync(join(plainWs, 'note.txt'), 'utf8') === 'v0' && existsSync(join(plainWs, 'nested', 'extra', 'new.txt')))

  // Undo the selective rewind via its rescue checkpoint!
  const undone = ledger.executeRewind({ sessionId: 's1', cwd: plainWs, turnId: sel.rescueId })
  check('rewinding to the automatic rescue point restores pre-rewind state',
    undone.ok === true && readFileSync(join(plainWs, 'note.txt'), 'utf8') === 'v2')

  // Full rewind to Turn 1: restores note.txt to v0 AND deletes nested/extra/new.txt + empty nested/extra dir.
  const full = ledger.executeRewind({ sessionId: 's1', cwd: plainWs, turnId: 't1' })
  check('full rewind restores note.txt, removes created file and cleans empty parent dir',
    full.ok === true && full.count === 2 &&
    readFileSync(join(plainWs, 'note.txt'), 'utf8') === 'v0' &&
    !existsSync(join(plainWs, 'nested', 'extra', 'new.txt')) &&
    !existsSync(join(plainWs, 'nested', 'extra')) &&
    existsSync(join(plainWs, 'nested')))

  // Rewinding again when already matching returns nothing-to-rewind.
  const noop = ledger.executeRewind({ sessionId: 's1', cwd: plainWs, turnId: 't1' })
  check('second rewind when disk matches returns nothing-to-rewind', noop.ok === false && noop.code === 'nothing-to-rewind')

  // Rescue of full rewind brings BOTH note.txt (v2) and nested/extra/new.txt back!
  const back = ledger.executeRewind({ sessionId: 's1', cwd: plainWs, turnId: full.rescueId })
  check('rescue of full rewind recreates deleted file and restores v2',
    back.ok === true && readFileSync(join(plainWs, 'note.txt'), 'utf8') === 'v2' &&
    readFileSync(join(plainWs, 'nested', 'extra', 'new.txt'), 'utf8') === 'created in turn 2')

  // ── 4. size cap, symlinks, and pruning / blob GC ──────────────────────────────────────────────────────────
  console.log('\n── bounds, symlinks and blob garbage collection ──')
  const bigPath = join(plainWs, 'big.bin')
  writeFileSync(bigPath, Buffer.alloc(MAX_FILE_BYTES + 16, 0x41))
  const bigRec = ledger.recordPreMutation({ sessionId: 's2', cwd: plainWs, turnId: 't-big', prompt: 'Big file', rawPath: 'big.bin' })
  check('files above 4 MiB cap are marked skipped without storing blob', bigRec.ok === true && bigRec.snapshot.skipped === 'too-large')
  const bigPlan = ledger.planRewind({ sessionId: 's2', cwd: plainWs, turnId: 't-big' })
  check('planRewind reports skipped too-large entry honestly', bigPlan.ok === true && bigPlan.summary.skipped === 1 && bigPlan.changes[0].reason === 'too-large')

  // Pruning past MAX_TURNS removes old turns and unreferenced blobs.
  for (let i = 0; i < MAX_TURNS + 6; i += 1) {
    const f = 'prune-' + i + '.txt'
    writeFileSync(join(plainWs, f), 'content-' + i)
    ledger.recordPreMutation({ sessionId: 's-prune', cwd: plainWs, turnId: 'pt-' + i, prompt: 'Turn ' + i, rawPath: f })
  }
  const pruned = ledger.listTurns('s-prune')
  const blobCount = readdirSync(join(ledger.sessionDirOf('s-prune'), 'blobs')).length
  check('ledger enforces MAX_TURNS cap and garbage-collects orphan blobs', pruned.turns.length === MAX_TURNS && blobCount === MAX_TURNS, { turns: pruned.turns.length, blobs: blobCount })

  // ── 5. DSH host hooks (attachRewindHooks) ─────────────────────────────────────────────────────────────────
  console.log('\n── DSH host hooks (session/event + tools/pre-execute) ──')
  const hookWs = join(root, 'hook-ws')
  mkdirSync(hookWs, { recursive: true })
  writeFileSync(join(hookWs, 'doc.md'), 'original\n')

  const listeners = new Map()
  const fakeCtx = {
    on (ev, fn) {
      if (!listeners.has(ev)) listeners.set(ev, new Set())
      listeners.get(ev).add(fn)
      return () => listeners.get(ev).delete(fn)
    },
    get () { return undefined }
  }
  const emit = async (ev, ...args) => {
    for (const fn of [...(listeners.get(ev) || [])]) await fn(...args)
  }

  const detach = attachRewindHooks(fakeCtx, ledger)
  const fakeSession = { id: 'session-hook1', header: { cwd: hookWs } }
  await emit('session/event', fakeSession, { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'Rewrite doc.md' }] } })

  let nextCalled = false
  await emit('tools/pre-execute', { name: 'write', arguments: { file_path: 'doc.md', content: 'changed' }, agent: { id: 'session-hook1', session: fakeSession } }, () => {
    nextCalled = true
    writeFileSync(join(hookWs, 'doc.md'), 'changed\n')
    return 'ok'
  })
  await emit('session/event', fakeSession, { type: 'turn/end', data: {} })

  const hookTurns = ledger.listTurns('hook1')
  check('hooks capture pre-mutation snapshot before next() writes file', nextCalled === true && hookTurns.turns.length === 1 && hookTurns.turns[0].prompt === 'Rewrite doc.md')
  const hookRewound = ledger.executeRewind({ sessionId: 'hook1', cwd: hookWs, turnId: hookTurns.turns[0].id })
  check('rewinding a hook-captured turn restores the original file', hookRewound.ok === true && readFileSync(join(hookWs, 'doc.md'), 'utf8') === 'original\n')
  detach()
  check('disposer detaches every listener cleanly', [...listeners.values()].every((s) => s.size === 0))

  // ── 6. HTTP routes & security guards ──────────────────────────────────────────────────────────────────────
  console.log('\n── HTTP routes (/rewind/turns and /rewind) ──')
  const dsh = join(root, 'dsh')
  const sessionsHome = join(dsh, 'sessions')
  const slug = '-' + hookWs.replace(/\//g, '-') + '--'
  mkdirSync(join(sessionsHome, slug, 'session-hook1'), { recursive: true })
  const routes = {}
  monterRoutes({ register: (r) => { routes[r.path] = r.handler; return () => {} } }, {
    sessionsHome,
    kybersHome: join(dsh, 'kybers'),
    reglagesPath: join(dsh, 'kybernos', 'settings.json'),
    categoriesPath: join(dsh, 'kybernos', 'categories.json'),
    rewindLedger: ledger
  })

  const PORT = 3099
  const reqOf = (method, url, headers = {}, body) => ({
    method, url, headers, socket: { localPort: PORT },
    on (ev, cb) { if (ev === 'data' && body !== undefined) cb(JSON.stringify(body)); if (ev === 'end') cb() }
  })
  const resOf = () => {
    const r = { code: null, body: null, writeHead (c) { r.code = c }, end (s) { try { r.body = JSON.parse(s) } catch { r.body = s } } }
    return r
  }
  const goodHeaders = { origin: 'http://127.0.0.1:' + PORT, cookie: sessionCookie('127.0.0.1:' + PORT) }

  const gRes = resOf()
  await routes['/kybernos-sessions/rewind/turns'](reqOf('GET', '/kybernos-sessions/rewind/turns?session=hook1'), gRes)
  check('GET /rewind/turns returns recorded turns', gRes.code === 200 && gRes.body.ok === true && gRes.body.turns.length >= 2)

  const noCookie = resOf()
  await routes['/kybernos-sessions/rewind'](reqOf('POST', '/kybernos-sessions/rewind', { origin: 'http://127.0.0.1:' + PORT }, { session: 'hook1', turnId: hookTurns.turns[0].id, exec: true }), noCookie)
  check('POST /rewind without signed session cookie is refused (401)', noCookie.code === 401)

  const badPath = resOf()
  await routes['/kybernos-sessions/rewind'](reqOf('POST', '/kybernos-sessions/rewind', goodHeaders, { session: 'hook1', chemin: outside, turnId: hookTurns.turns[0].id, exec: false }), badPath)
  check('POST /rewind refuses an explicit unconfined path', badPath.code === 200 && badPath.body.ok === false && badPath.body.code === 'folder-not-found')

  const dryRoute = resOf()
  await routes['/kybernos-sessions/rewind'](reqOf('POST', '/kybernos-sessions/rewind', goodHeaders, { session: 'hook1', turnId: hookRewound.rescueId, exec: false }), dryRoute)
  check('POST /rewind dry-run via HTTP succeeds with valid cookie + origin', dryRoute.code === 200 && dryRoute.body.ok === true && dryRoute.body.dry === true && dryRoute.body.summary.restore === 1)

  check('REWIND_TEXTS codes are stable kebab-case English strings', Object.keys(REWIND_TEXTS).every((c) => /^[a-z]+(?:-[a-z]+)*$/.test(c) && !/[àâçéèêëîïôùûœ]/i.test(REWIND_TEXTS[c])))
} finally {
  try { rmSync(root, { recursive: true, force: true }) } catch { /* ignore */ }
}

console.log('\n' + pass + ' ✓  ' + fail + ' ✗')
assert.equal(fail, 0, fail + ' check(s) failed')
process.exit(0)

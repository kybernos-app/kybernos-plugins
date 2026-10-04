#!/usr/bin/env node
/** Host test of the entries store of kybernos-slash (`$DSH_HOME/kybernos-slash/entries.json`).
 *
 *  The store used to read a file that could not be read, or was not valid JSON, as an
 *  EMPTY list, and the next POST then rewrote the whole file: one half-written or
 *  hand-edited file lost every saved command, silently. This test pins the fix: a
 *  missing file is an empty list, a file that is present but unusable is an error (GET
 *  reports it, POST is refused, the file is never touched), a copy of a corrupt file is
 *  kept (once per content, at most five), and the write is atomic and keeps the file's
 *  permissions. The routes are driven through the real `apply(ctx)` on fake objects.
 *  Everything runs in a temporary directory: nothing outside it is read or written.
 *
 *  Usage: node packages/kybernos-slash/test-host.mjs   (exit 0 = all pass) */
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, chmodSync, symlinkSync, lstatSync, linkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply, readStoreState, storeProblem, writeStore, storePath } from './index.js'

let ok0 = 0
let ko = 0
const ok = (name, cond, detail) => {
  if (cond === true) { ok0 += 1; console.log('  ✓ ' + name) } else { ko += 1; console.log('  ✗ ' + name + (detail !== undefined ? ' → ' + JSON.stringify(detail).slice(0, 300) : '')) }
}

// ── Sandbox: every path this test touches lives under `root` ──────────────────
const root = mkdtempSync(join(tmpdir(), 'kslash-store-'))
process.env.DSH_HOME = join(root, 'dsh-home')
delete process.env.KYBERNOS_SLASH_STORE
if (!storePath().startsWith(root)) { console.error('refusing to run: the store would not be inside the temporary directory: ' + storePath()); process.exit(2) }

let n = 0
const fresh = () => { n += 1; const folder = join(root, 'c' + n); mkdirSync(folder); return join(folder, 'entries.json') }
const put = (f, value) => writeFileSync(f, typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n')
const load = (f) => JSON.parse(readFileSync(f, 'utf8'))
const slurp = (f) => { try { return readFileSync(f, 'utf8') } catch (e) { return null } } // null instead of a crash, so a broken store shows up as a failed assertion
const around = (f) => readdirSync(join(f, '..'))
const copiesOf = (f) => around(f).filter((name) => name.startsWith('entries.json.corrupt-'))
const modeOf = (f) => (statSync(f).mode & 0o777).toString(8)
const isRoot = typeof process.getuid === 'function' && process.getuid() === 0

const HELLO = { slug: 'hello', template: 'Hello', order: 1 }
const BYE = { slug: 'bye', template: 'Bye', order: 2 }
const SAVED = [{ id: 'keep-a', slug: 'keep-a', kind: 'slash', template: 'A', order: 1 }, { id: 'keep-b', slug: 'keep-b', kind: 'action', template: 'B {message}', order: 2 }]

// ── The routes, through the real `apply(ctx)` ─────────────────────────────────
const routes = {}
{
  const webServer = { register: (r) => { routes[r.path] = r.handler; return () => {} } }
  const hostCtx = { get: (key) => (key === 'webServer' ? webServer : null), effect: (fn) => fn() }
  const log = console.log
  console.log = () => {}
  try { apply({ inject: (deps, fn) => fn(hostCtx) }) } finally { console.log = log }
}
const ENTRIES = '/kybernos/slash/entries'
const STATUS = '/kybernos/slash/status'
const request = (method, url, body, headers) => ({
  method,
  url,
  headers: headers !== undefined ? headers : { origin: 'http://127.0.0.1:3080', host: '127.0.0.1:3080' },
  async * [Symbol.asyncIterator] () { if (body !== undefined) yield Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)) }
})
const response = () => { const r = { code: null, body: null, writeHead (c) { r.code = c }, end (s) { try { r.body = JSON.parse(s) } catch (e) { r.body = s } } }; return r }
/** Runs one route against the store file `f`. */
const call = async (f, path, method, body, headers) => {
  process.env.KYBERNOS_SLASH_STORE = f
  const res = response()
  await routes[path](request(method, path, body, headers), res)
  return res
}
const GET = (f) => call(f, ENTRIES, 'GET')
const POST = (f, body) => call(f, ENTRIES, 'POST', body)

console.log('\n── missing file: an empty list, and the first save creates it ──')
{
  const f = join(root, 'new', 'deeper', 'entries.json')
  ok('readStoreState: a missing file is an empty list', JSON.stringify(readStoreState(f)) === '{"entries":[]}', readStoreState(f))
  ok('a missing file is not a problem', storeProblem(readStoreState(f), f, true) === null)
  const g = await GET(f)
  ok('GET answers 200 with an empty list', g.code === 200 && g.body.ok === true && g.body.total === 0 && Array.isArray(g.body.entries) && g.body.entries.length === 0, g)
  const s = await call(f, STATUS, 'GET')
  ok('status: not existing, empty, no error', s.code === 200 && s.body.exists === false && s.body.total === 0 && s.body.error === undefined, s.body)
  const p = await POST(f, { entry: HELLO })
  ok('POST creates the file (and its folders)', p.code === 200 && p.body.ok === true && p.body.added === 1 && p.body.total === 1, p)
  ok('the file holds the entry as a JSON array', Array.isArray(load(f)) && load(f).length === 1 && load(f)[0].id === 'hello', load(f))
  ok('a new file is private (0600)', modeOf(f) === '600', modeOf(f))
  ok('the folder holds only entries.json', around(f).join() === 'entries.json', around(f))
}

console.log('\n── valid file: the happy path is unchanged ──')
{
  const f = fresh()
  put(f, SAVED)
  ok('readStoreState returns the array', readStoreState(f).entries.length === 2 && readStoreState(f).corrupt === undefined)
  const g = await GET(f)
  ok('GET lists both, with the usual shape (ok, version, path, total, slash, action, entries)', g.code === 200 && g.body.ok === true && g.body.path === f && g.body.total === 2 && g.body.slash === 1 && g.body.action === 1 && g.body.entries.map((e) => e.id).join() === 'keep-a,keep-b' && 'version' in g.body, g.body)
  const p = await POST(f, { entry: HELLO })
  ok('POST merges: existing entries kept, the new one added', p.code === 200 && p.body.added === 1 && p.body.updated === 0 && p.body.total === 3 && load(f).map((e) => e.id).join() === 'hello,keep-a,keep-b', p.body)
  ok('POST answers with what is on disk', JSON.stringify(p.body.entries) === JSON.stringify(load(f)))
  const u = await POST(f, { entry: Object.assign({}, HELLO, { template: 'Hello again' }) })
  ok('POST with an existing id replaces, never duplicates', u.body.updated === 1 && u.body.added === 0 && load(f).length === 3 && load(f).find((e) => e.id === 'hello').template === 'Hello again', u.body)
  const d = await POST(f, { delete: 'keep-a' })
  ok('POST delete removes one entry', d.code === 200 && d.body.removed === 1 && load(f).map((e) => e.id).join() === 'hello,keep-b', d.body)
  const r = await POST(f, { replace: [BYE] })
  ok('POST replace swaps the whole list', r.code === 200 && load(f).length === 1 && load(f)[0].id === 'bye', r.body)
  ok('the file ends with a newline and is pretty-printed', readFileSync(f, 'utf8').endsWith(']\n') && readFileSync(f, 'utf8').includes('\n  '))
  const bad = await POST(f, { nothing: true })
  ok('a refused entry is still a 400 with the file untouched', bad.code === 400 && bad.body.ok === false && load(f).length === 1, bad)
  const s = await call(f, STATUS, 'GET')
  ok('status counts the entries and has no error', s.body.exists === true && s.body.total === 1 && s.body.error === undefined, s.body)
  const g2 = f + '.empty'
  put(g2, '  \n')
  ok('an empty file counts as an empty list (nothing to lose)', readStoreState(g2).entries.length === 0 && storeProblem(readStoreState(g2), g2, true) === null)
  const e = fresh()
  put(e, '\n')
  ok('and the first save over it works', (await POST(e, { entry: HELLO })).code === 200 && load(e).length === 1)
}

console.log('\n── corrupt file: reported, never overwritten, one copy kept ──')
{
  const f = fresh()
  const truncated = '[\n  { "id": "keep-a", "slug": "keep-a", "template": "A" },\n  { "id": "keep-b", "slug": "ke'
  put(f, truncated)
  const st = readStoreState(f)
  ok('a truncated file is reported as corrupt, with its text', st.corrupt === true && st.text === truncated && st.entries === undefined, st)
  const g = await GET(f)
  ok('GET is an error, not a silent empty list', g.code === 500 && g.body.ok === false && g.body.state === 'corrupt' && /not a valid JSON array/.test(String(g.body.error)) && g.body.entries === undefined, g)
  ok('the GET error says what to do', /Fix or remove the file/.test(String(g.body.error)), g.body.error)
  ok('a GET never writes: no copy yet, file untouched', around(f).join() === 'entries.json' && slurp(f) === truncated, around(f))
  const s = await call(f, STATUS, 'GET')
  ok('status says the file is corrupt instead of reporting 0 entries as if empty', s.code === 200 && s.body.exists === true && s.body.state === 'corrupt' && /not a valid JSON array/.test(String(s.body.error)), s.body)
  ok('status writes nothing either', around(f).join() === 'entries.json')

  const p = await POST(f, { entry: HELLO })
  ok('POST is refused with a 500 and the reason', p.code === 500 && p.body.ok === false && p.body.state === 'corrupt' && /nothing was saved/.test(String(p.body.error)), p)
  ok('the corrupt file is left byte for byte as it was', slurp(f) === truncated)
  const copies = copiesOf(f)
  ok('one copy is kept next to it', copies.length === 1 && /^entries\.json\.corrupt-\d+$/.test(copies[0]), around(f))
  const copy = join(f, '..', String(copies[0]))
  ok('the copy holds the same text: every saved entry is recoverable', slurp(copy) === truncated)
  ok('the error names the copy', copies.length === 1 && String(p.body.error).includes(copies[0]), p.body.error)
  ok('the copy is private (0600)', copies.length === 1 && modeOf(copy) === '600')
  ok('no temp file is left', around(f).every((name) => !name.includes('.tmp-')), around(f))

  const other = await POST(f, { delete: 'keep-a' })
  const replace = await POST(f, { replace: [] })
  const many = await POST(f, [HELLO, BYE])
  ok('delete, replace and multiple upsert are refused too', [other, replace, many].every((r) => r.code === 500 && r.body.ok === false), [other.code, replace.code, many.code])
  ok('still untouched, still one copy', slurp(f) === truncated && copiesOf(f).length === 1, around(f))

  const malformed = await call(f, ENTRIES, 'POST', '{ not json')
  ok('a malformed request is a plain 400 and makes no copy', malformed.code === 400 && copiesOf(f).length === 1)
  const foreign = await call(f, ENTRIES, 'POST', { entry: HELLO }, { origin: 'http://evil.example', host: '127.0.0.1:3080' })
  ok('a foreign origin is a 403 and the file is untouched', foreign.code === 403 && slurp(f) === truncated && copiesOf(f).length === 1)

  // The user repairs the file by hand: the store works again and loses nothing.
  put(f, SAVED)
  const again = await POST(f, { entry: HELLO })
  ok('once repaired, a save works and keeps every entry', again.code === 200 && load(f).map((e) => e.id).join() === 'hello,keep-a,keep-b', load(f))
  ok('and GET lists them again', (await GET(f)).code === 200)
}
{
  const f = fresh()
  for (const odd of ['{}', 'null', '"text"', '42', '{"entries":[]}']) {
    put(f, odd)
    const p = await POST(f, { entry: HELLO })
    ok('valid JSON that is not an array is corrupt too: ' + odd, p.code === 500 && slurp(f) === odd && (await GET(f)).code === 500, p.body)
  }
}
{
  // The exact accident of the report: a first save from the client's startup (the
  // `/widget` entry, GET then POST) must not replace a corrupt file with one entry.
  const f = fresh()
  const mangled = '[{"id":"keep-a","slug":"keep-a","template":"A"},'
  put(f, mangled)
  const g = await GET(f)
  ok('a client that reads first gets ok:false, so it does not go on to save', g.body.ok === false && g.code !== 200)
  const p = await POST(f, { entry: { id: 'widget', slug: 'widget', kind: 'slash', template: '/widget' } })
  ok('even if it saves anyway, nothing is lost', p.code === 500 && slurp(f) === mangled)
}

console.log('\n── unreadable file: refused, not treated as empty ──')
{
  const f = fresh()
  mkdirSync(f)
  const st = readStoreState(f)
  ok('a directory where the file should be is unreadable, not empty', typeof st.unreadable === 'string' && st.entries === undefined, st)
  const g = await GET(f)
  const p = await POST(f, { entry: HELLO })
  ok('GET reports it', g.code === 500 && g.body.state === 'unreadable' && /cannot be read \(EISDIR\)/.test(String(g.body.error)), g)
  ok('POST is refused and says nothing was saved', p.code === 500 && p.body.state === 'unreadable' && /nothing was saved/.test(String(p.body.error)), p)
  ok('the directory is still a directory and holds nothing new', statSync(f).isDirectory() && readdirSync(f).length === 0 && around(f).join() === 'entries.json')
}
if (isRoot) console.log('  (skipped: running as root, permission tests are meaningless)')
else {
  const f = fresh()
  put(f, SAVED)
  chmodSync(f, 0o000)
  const st = readStoreState(f)
  const g = await GET(f)
  const p = await POST(f, { entry: HELLO })
  chmodSync(f, 0o600)
  ok('an unreadable file is "unreadable", not an empty list', st.unreadable === 'EACCES' && st.entries === undefined, st)
  ok('GET reports it with the reason', g.code === 500 && g.body.ok === false && /cannot be read \(EACCES\)/.test(String(g.body.error)), g)
  ok('POST is refused and the saved entries are still there', p.code === 500 && /nothing was saved/.test(String(p.body.error)) && load(f).length === 2, p)
  ok('no copy is made of a file that cannot be read', copiesOf(f).length === 0, around(f))
}

console.log('\n── copies: one per distinct content, at most five ──')
{
  const f = fresh()
  put(f, '{ broken')
  for (let i = 0; i < 4; i += 1) await POST(f, { entry: HELLO })
  ok('the same corrupt content, tried four times, gives one copy', copiesOf(f).length === 1, around(f))
}
{
  const f = fresh()
  for (let i = 0; i < 8; i += 1) { put(f, '{ broken ' + i); await POST(f, { entry: HELLO }) }
  ok('eight different corrupt files give at most five copies', copiesOf(f).length === 5, copiesOf(f))
  const texts = copiesOf(f).map((name) => slurp(join(f, '..', name))).sort()
  ok('they are the first five distinct contents (none overwritten)', texts.join('|') === ['{ broken 0', '{ broken 1', '{ broken 2', '{ broken 3', '{ broken 4'].join('|'), texts)
  put(f, '{ broken 7')
  const over = await POST(f, { entry: HELLO })
  ok('past the cap the save is still refused, the file untouched, no sixth copy', over.code === 500 && slurp(f) === '{ broken 7' && copiesOf(f).length === 5, over)
  ok('and the error does not name a copy that does not exist', !/a copy is kept/.test(String(over.body.error)), over.body.error)
  put(f, '{ broken 2')
  const known = await POST(f, { entry: HELLO })
  ok('a content that already has a copy is recognised even at the cap', known.code === 500 && /a copy is kept as entries\.json\.corrupt-/.test(String(known.body.error)) && copiesOf(f).length === 5, known.body.error)
}
{
  // Copies made in the same millisecond must never overwrite each other ('wx' + counter).
  const f = fresh()
  const realNow = Date.now
  Date.now = () => 1700000000000
  try {
    for (let i = 0; i < 4; i += 1) { put(f, '{ same ms ' + i); await POST(f, { entry: HELLO }) }
  } finally { Date.now = realNow }
  const names = copiesOf(f).sort()
  ok('four distinct contents in the same millisecond give four files', names.length === 4, names)
  ok('the names take a counter suffix', names.join() === ['entries.json.corrupt-1700000000000', 'entries.json.corrupt-1700000000000-1', 'entries.json.corrupt-1700000000000-2', 'entries.json.corrupt-1700000000000-3'].join(), names)
  const texts = names.map((name) => slurp(join(f, '..', name))).sort()
  ok('and each keeps its own content', texts.join('|') === ['{ same ms 0', '{ same ms 1', '{ same ms 2', '{ same ms 3'].join('|'), texts)
}

console.log('\n── atomic write: nothing left behind ──')
{
  const f = fresh()
  put(f, SAVED)
  const before = readFileSync(f, 'utf8')
  const old = f + '.old-name'
  linkSync(f, old) // a second name for the same file: tells replaced from rewritten in place
  const p = await POST(f, { entry: HELLO })
  ok('the save succeeds', p.code === 200, p)
  ok('the file was replaced, not rewritten in place (the old content is still whole elsewhere)', slurp(old) === before && load(f).length === 3)
  ok('no temp file after a successful save', around(f).every((name) => !name.includes('.tmp-')), around(f))
  ok('writeStore returns the path it was given', writeStore([], f) === f && load(f).length === 0)
}
{
  // A write that fails must leave no temp file, and the thing it could not replace intact.
  const f = fresh()
  mkdirSync(f) // the rename of a file over a directory fails
  let thrown = null
  try { writeStore([HELLO], f) } catch (e) { thrown = e }
  ok('a failing write throws', thrown !== null)
  ok('a failing write removes its temp file', around(f).join() === 'entries.json', around(f))
}
if (isRoot) console.log('  (skipped: running as root, read-only folder tests are meaningless)')
else {
  const f = fresh()
  put(f, SAVED)
  const before = readFileSync(f, 'utf8')
  const folder = join(f, '..')
  chmodSync(folder, 0o555)
  const p = await POST(f, { entry: HELLO })
  chmodSync(folder, 0o755)
  ok('a POST that cannot write answers 500 with the reason', p.code === 500 && p.body.ok === false && /could not be written/.test(String(p.body.error)) && /nothing was saved/.test(String(p.body.error)), p)
  ok('and leaves the file byte for byte as it was', slurp(f) === before)
  ok('and leaves no temp file', around(f).join() === 'entries.json', around(f))
}

console.log('\n── permissions are kept, never widened ──')
{
  const f = fresh()
  put(f, SAVED)
  chmodSync(f, 0o600)
  await POST(f, { entry: HELLO })
  ok('a 0600 file stays 0600', modeOf(f) === '600', modeOf(f))
  const g = fresh()
  put(g, SAVED)
  chmodSync(g, 0o644)
  await POST(g, { entry: HELLO })
  ok('a 0644 file stays 0644 (not tightened behind the user\'s back)', modeOf(g) === '644', modeOf(g))
  const h = fresh()
  put(h, SAVED)
  chmodSync(h, 0o660)
  await POST(h, { delete: 'keep-a' })
  ok('a 0660 file stays 0660 through a delete too', modeOf(h) === '660', modeOf(h))
}

console.log('\n── a symlinked entries.json stays a symlink ──')
{
  const f = fresh()
  const target = join(root, 'dotfiles-entries.json')
  put(target, SAVED)
  chmodSync(target, 0o640)
  symlinkSync(target, f)
  const p = await POST(f, { entry: HELLO })
  ok('the save succeeds through the link', p.code === 200, p)
  ok('the link is still a link', lstatSync(f).isSymbolicLink() === true)
  ok('the target holds the new entry and the old ones', load(target).map((e) => e.id).join() === 'hello,keep-a,keep-b', load(target))
  ok('the target keeps its permissions', modeOf(target) === '640', modeOf(target))
  ok('no temp file in either folder', around(f).every((name) => !name.includes('.tmp-')) && readdirSync(root).every((name) => !name.includes('.tmp-')))
}

console.log('\n── the plugin still never stops the host from starting ──')
{
  const log = console.error
  console.error = () => {}
  let boom = null
  try {
    apply({ inject: () => { throw new Error('no inject') } })
    apply({ inject: (deps, fn) => fn({ get: () => { throw new Error('no webServer') }, effect: (fn2) => fn2() }) })
  } catch (e) { boom = e } finally { console.error = log }
  ok('a failing ctx.inject or webServer does not throw out of apply()', boom === null, boom && boom.message)
}

delete process.env.KYBERNOS_SLASH_STORE
rmSync(root, { recursive: true, force: true })
console.log('\nKYBERNOS-SLASH STORE — ' + (ok0 + ko) + ' assertions, ' + ko + ' failure(s)')
process.exit(ko === 0 ? 0 : 1)

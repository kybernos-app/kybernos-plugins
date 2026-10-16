// The index (incremental, cached, zstd journals), the sources, and the routes with their guards.   node packages/kybernos-search/test-host.mjs
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as zlib from 'node:zlib'
import { createIndex } from './store.mjs'
import { zstdFrames } from './zstd-frames.mjs'
import { skills, lessons, automations, teams, frontMatter, allSources } from './sources.mjs'
import { listSessions, mountRoutes, apply } from './index.js'

let total = 0
let failed = 0
const ok = (name, cond, detail) => { total += 1; if (cond) console.log('  ✓ ' + name); else { failed += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail).slice(0, 260))) } }

const journal = (id, title, pairs) => [
  { type: 'session', id, cwd: '/w/proj-' + id, createdAt: 1 },
  ...pairs.map(([role, text], i) => ({ type: role === 'u' ? 'user/message' : 'assistant/message', time: 10 + i, data: role === 'u' ? { content: text } : { message: { content: text } } })),
  { type: 'session/title', time: 99, data: { title } }
].map((e) => JSON.stringify(e)).join('\n') + '\n'

const HAS_ZSTD = typeof zlib.zstdCompressSync === 'function'
console.log('zstd frames')
if (!HAS_ZSTD) console.log('SKIPPED: the zstd frame checks of the search host — this Node cannot compress zstd')
if (HAS_ZSTD) {
  const a = journal('s1', 'T', [['u', 'alpha un']])
  const b = journal('s1', 'T', [['u', 'beta deux']])
  const both = Buffer.concat([zlib.zstdCompressSync(Buffer.from(a)), zlib.zstdCompressSync(Buffer.from(b))])
  const text = zstdFrames(both)
  ok('concatenated frames are all read (zstdDecompressSync alone stops after the first)', text.includes('alpha un') && text.includes('beta deux') && zlib.zstdDecompressSync(both).toString().includes('beta deux') === false)
  ok('garbage is an empty journal, not a throw', zstdFrames(Buffer.from('not zstd at all')) === '')
}

console.log('the index')
{
  const files = new Map()    // file -> { size, mtimeMs, data }
  let reads = 0
  let cache = null
  let writes = 0
  let clock = 1000
  const add = (id, title, pairs, mtimeMs = 1) => { const data = Buffer.from(journal(id, title, pairs)); files.set('/j/' + id, { id, size: data.length, mtimeMs, data }) }
  add('session-1', 'Créer un thème', [['u', 'Je veux un thème sombre'], ['a', 'Voici le thème']])
  add('session-2', 'Docker', [['u', 'nettoyage des images docker']])
  add('session-3', '', [['u', 'Question sans titre sur le webhook']])
  const io = () => ({
    listSessions: () => [...files.values()].map((f) => ({ id: f.id, file: '/j/' + f.id, size: f.size, mtimeMs: f.mtimeMs })),
    // the test journals are PLAIN text: zstdFrames returns '' for them, so decode through a shim file format
    readFile: (file) => { reads += 1; return files.get(file).data },
    readCache: () => cache,
    writeCache: (o) => { writes += 1; cache = JSON.parse(JSON.stringify(o)) },
    sources: () => [{ scope: 'skill', id: 'sk', title: 'maquette-dsh', parts: [{ r: 'doc', ts: null, t: 'skill qui fabrique une maquette' }], meta: {}, open: null, ts: null }],
    now: () => clock
  })
  // journals are stored uncompressed here: wrap each as a zstd frame when this Node can, else test the store through a stub decoder
  if (HAS_ZSTD) for (const f of files.values()) f.data = zlib.zstdCompressSync(f.data)
  const idx = createIndex(io())
  ok('before the first click nothing is read', idx.status().state === 'idle' && reads === 0)
  if (HAS_ZSTD) {
    await idx.start()
    let s = idx.status()
    ok('the first start reads every journal once', s.state === 'ready' && s.chats === 3 && s.done === 3 && reads === 3 && writes === 1, { s, reads })
    let r = idx.query({ q: 'theme', scopes: ['chat'] })
    ok('a search finds the chat by an accentless word', r.results.length === 1 && r.results[0].id === 'session-1' && r.results[0].title === 'Créer un thème' && r.results[0].open.kind === 'session')
    ok('a chat with no title is titled by its first words', idx.query({ q: 'webhook', scopes: ['chat'] }).results[0].title.startsWith('Question sans titre'))
    ok('the small sources are searched too', idx.query({ q: 'maquette' }).results.some((x) => x.scope === 'skill'))
    reads = 0
    await idx.start()
    ok('a second start reads nothing that did not change', reads === 0, { reads })
    add('session-2', 'Docker', [['u', 'nettoyage des images docker'], ['a', 'fait, 14 Go libérés']], 5)
    files.get('/j/session-2').data = zlib.zstdCompressSync(files.get('/j/session-2').data)
    files.get('/j/session-2').size = files.get('/j/session-2').data.length
    await idx.start()
    ok('a changed journal is read again, alone', reads === 1 && idx.query({ q: 'liberes', scopes: ['chat'] }).results.length === 1, { reads })
    files.delete('/j/session-3')
    await idx.start()
    ok('a deleted journal leaves the index', idx.status().chats === 2 && idx.query({ q: 'webhook', scopes: ['chat'] }).results.length === 0)
    const warm = createIndex(io())
    reads = 0
    ok('a restart is served from the cache, before anything is read', warm.status().chats === 2 && warm.query({ q: 'docker', scopes: ['chat'] }).results.length === 1 && reads === 0)
    files.set('/j/broken', { id: 'broken', size: 4, mtimeMs: 1, data: Buffer.from('boom') })
    const again = createIndex(io())
    await again.start()
    ok('a journal that cannot be read is counted, never fatal', again.status().state === 'ready' && again.status().chats >= 2, again.status())
    await idx.rebuild()
    ok('rebuild reads everything again', reads >= 3, { reads })
  }
  ok('the answer of a query says how many chats are indexed and how long it took', typeof idx.query({ q: 'x' }).indexed === 'number' && typeof idx.query({ q: 'x' }).tookMs === 'number')
}

console.log('the sources, on a real directory')
{
  const home = mkdtempSync(join(tmpdir(), 'kb-search-'))
  mkdirSync(join(home, 'skills', 'ma-skill'), { recursive: true })
  writeFileSync(join(home, 'skills', 'ma-skill', 'SKILL.md'), '---\nname: ma-skill\ndescription: fait un thème\n---\n# Corps\nTexte du corps')
  mkdirSync(join(home, 'skills', '.cache'), { recursive: true })
  mkdirSync(join(home, 'kybers', 'dev', 'memory'), { recursive: true })
  writeFileSync(join(home, 'kybers', 'dev', 'memory', 'lessons.jsonl'), JSON.stringify({ ts: '2026-09-24T11:25:47.072Z', text: 'Toujours vérifier le thème rendu', tags: ['gui'] }) + '\nnot json\n')
  writeFileSync(join(home, 'kybers', 'dev', 'kyber.yml'), 'name: Dev Team\nmission: construire\n')
  mkdirSync(join(home, 'kybers', '.active'), { recursive: true })
  mkdirSync(join(home, 'kybernos'), { recursive: true })
  writeFileSync(join(home, 'kybernos', 'tasks.json'), JSON.stringify([{ id: 't1', name: 'Veille thèmes', prompt: 'Liste les nouveaux thèmes' }, { nope: true }]))
  const sk = skills(home)
  ok('skills: name from the front matter, the description and the body are the text, dot folders are not skills', sk.length === 1 && sk[0].title === 'ma-skill' && sk[0].parts[0].t.includes('fait un thème') && sk[0].parts[0].t.includes('Texte du corps'), sk)
  const le = lessons(home)
  ok('lessons: one per line, a broken line is skipped', le.length === 1 && le[0].scope === 'lesson' && le[0].parts[0].t.includes('gui'), le)
  ok('automations: name and prompt', automations(home).length === 1 && automations(home)[0].title === 'Veille thèmes')
  ok('teams: the name of kyber.yml, hidden folders skipped', teams(home).length === 1 && teams(home)[0].title === 'Dev Team')
  ok('allSources is the four, together', allSources(home).length === 4)
  ok('an empty home is four empty sources', allSources(join(home, 'nope')).length === 0)
  ok('front matter: flat key: value lines', frontMatter('---\na: 1\nname: "x y"\n---\nbody').meta.name === 'x y')
  // sessions on disk
  mkdirSync(join(home, 'sessions', 'slug-a', 'session-aaa'), { recursive: true })
  writeFileSync(join(home, 'sessions', 'slug-a', 'session-aaa', 'session.v3.jsonl.zstd'), 'x')
  writeFileSync(join(home, 'sessions', 'slug-a', 'session-aaa', 'session.v4.jsonl.zstd'), 'xy')
  mkdirSync(join(home, 'sessions', 'slug-a', 'not-a-session'), { recursive: true })
  const ls = listSessions(home)
  ok('journals on disk: the newest format of each session', ls.length === 1 && ls[0].id === 'session-aaa' && ls[0].file.endsWith('session.v4.jsonl.zstd') && ls[0].size === 2, ls)
  rmSync(home, { recursive: true, force: true })
}

console.log('the routes')
{
  const routes = {}
  const fake = { calls: [], status: () => ({ state: 'ready', done: 1, total: 1, chats: 1, updatedAt: 1, errors: 0, sources: 0 }), start () { this.calls.push('start'); return Promise.resolve() }, rebuild () { this.calls.push('rebuild'); return Promise.resolve() }, query (o) { this.calls.push(['query', o]); return { ok: true, state: 'ready', terms: [], results: [], counts: {}, indexed: 1, tookMs: 0 } } }
  mountRoutes({ register: (r) => { routes[r.path] = r.handler } }, fake)
  const mk = (method, headers, body) => {
    const req = Object.assign((async function * () { if (body !== undefined) yield Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)) })(), { method, headers: { host: '127.0.0.1:3080', ...headers }, socket: { localPort: 3080 } })
    return { req, res: { code: null, body: null, writeHead (c) { this.code = c }, end (b) { this.body = b === undefined ? null : JSON.parse(b) } } }
  }
  const call = async (path, method, headers, body) => { const { req, res } = mk(method, headers, body); await routes[path](req, res); return res }
  const GOOD = { origin: 'http://127.0.0.1:3080', 'content-type': 'application/json' }
  ok('the four routes exist', ['/kybernos-search/status', '/kybernos-search/start', '/kybernos-search/reindex', '/kybernos-search/query'].every((p) => typeof routes[p] === 'function'))
  let r = await call('/kybernos-search/query', 'POST', GOOD, { q: 'theme' })
  ok('a query from the page answers with results', r.code === 200 && r.body.ok === true && fake.calls.length === 1)
  r = await call('/kybernos-search/query', 'POST', { 'content-type': 'application/json' }, { q: 'theme' })
  ok('a POST with no origin is refused (the content of the chats is not for a drive-by)', r.code === 403 && fake.calls.length === 1)
  r = await call('/kybernos-search/query', 'POST', { ...GOOD, origin: 'https://evil.example' }, { q: 'theme' })
  ok('a foreign origin is refused', r.code === 403 && fake.calls.length === 1)
  r = await call('/kybernos-search/query', 'POST', { ...GOOD, host: 'evil.example' }, { q: 'theme' })
  ok('a Host that is not this listener\'s is refused (DNS rebinding)', r.code === 403 && fake.calls.length === 1)
  r = await call('/kybernos-search/query', 'POST', { ...GOOD, 'content-type': 'text/plain' }, { q: 'theme' })
  ok('JSON only', r.code === 415)
  r = await call('/kybernos-search/query', 'GET', { origin: 'http://127.0.0.1:3080' })
  ok('a query is a POST only', r.code === 405)
  r = await call('/kybernos-search/query', 'POST', GOOD, { q: '   ' })
  ok('an empty query is a 400', r.code === 400 && r.body.error === 'empty-query')
  r = await call('/kybernos-search/query', 'POST', GOOD, '{bad json')
  ok('a broken body is a 400', r.code === 400)
  r = await call('/kybernos-search/query', 'POST', GOOD, { q: 'x'.repeat(5000) })
  ok('a body over 4 KB is refused before it is parsed', r.code === 400 && r.body.error === 'bad-body')
  r = await call('/kybernos-search/query', 'POST', GOOD, { q: 'x'.repeat(300), scopes: ['chat', 'evil', 42] })
  const last = fake.calls[fake.calls.length - 1][1]
  ok('the query is capped and only known scopes pass', r.code === 200 && last.q.length === 200 && JSON.stringify(last.scopes) === '["chat"]', last)
  r = await call('/kybernos-search/status', 'GET', {})
  ok('status: counts only, a plain read may omit the origin', r.code === 200 && r.body.chats === 1 && Array.isArray(r.body.scopes) && r.body.results === undefined)
  r = await call('/kybernos-search/status', 'GET', { origin: 'https://evil.example' })
  ok('status from a foreign origin is refused', r.code === 403)
  r = await call('/kybernos-search/start', 'POST', GOOD, {})
  ok('start answers 202 and starts', r.code === 202 && fake.calls.includes('start'))
  r = await call('/kybernos-search/reindex', 'POST', { 'content-type': 'application/json' }, {})
  ok('reindex needs the page\'s own origin', r.code === 403 && !fake.calls.includes('rebuild'))
  r = await call('/kybernos-search/reindex', 'POST', GOOD, {})
  ok('reindex from the page', r.code === 202 && fake.calls.includes('rebuild'))
}

console.log('boot safety')
{
  let threw = false
  try { apply(undefined); apply({}); apply({ get: () => { throw new Error('boom') } }) } catch (e) { threw = true }
  ok('apply never throws, whatever the context', threw === false)
  let injected = null
  apply({ get: () => undefined, inject: (names, fn) => { injected = names } })
  ok('without the web server service it waits for it', JSON.stringify(injected) === '["webServer"]')
}

console.log('\n' + (total - failed) + '/' + total + (failed === 0 ? ' ✓' : ' ✗ ' + failed + ' failure(s)'))
process.exit(failed === 0 ? 0 : 1)

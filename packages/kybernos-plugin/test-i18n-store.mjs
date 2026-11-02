// Tests of the on-disk translation store (i18n-store.mjs), on a temp folder.
//   node packages/kybernos-plugin/test-i18n-store.mjs
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createI18nStore, handleI18nStore, serveI18nStore, LIMITS, MAX_BODY_BYTES } from './i18n-store.mjs'

let failed = 0
const check = (name, ok, detail) => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok || detail === undefined ? '' : '  — ' + detail))
  if (!ok) failed += 1
}
const root = mkdtempSync(join(tmpdir(), 'kb-i18n-store-'))
let clock = 1_700_000_000_000
const fresh = (name) => createI18nStore({ dir: join(root, name), now: () => (clock += 1000) })

console.log('empty store')
{
  const s = fresh('empty')
  check('list of a folder that does not exist is empty (no crash)', s.list().length === 0)
  check('read of an unknown language is null', s.read('ar') === null)
  check('no tombstones', Object.keys(s.removed()).length === 0)
}

console.log('write / read')
{
  const s = fresh('rw')
  const w = s.write('ar', { label: 'العربية', kb: { 'a': 'ب', 'b': 'ج' }, dsh: { 'common::ok': 'حسنا' }, live: { 'Salut': 'مرحبا' }, meta: { complete: false, total: 10, done: 4, at: 5 } })
  check('first write creates the pack', w.ok === true && w.counts.kb === 2 && w.counts.dsh === 1 && w.counts.live === 1, JSON.stringify(w))
  const p = s.read('ar')
  check('the strings come back as written', p.kb.a === 'ب' && p.dsh['common::ok'] === 'حسنا' && p.live.Salut === 'مرحبا' && p.label === 'العربية')
  check('the progress record comes back', p.meta.done === 4 && p.meta.total === 10)
  check('the file is on disk, as JSON, with a version', JSON.parse(readFileSync(join(s.dir, 'ar.json'), 'utf8')).version === 1)
  const w2 = s.write('ar', { kb: { 'b': 'د', 'c': 'هـ' } })
  const p2 = s.read('ar')
  check('a patch is MERGED key by key (nothing else is lost)', p2.kb.a === 'ب' && p2.kb.b === 'د' && p2.kb.c === 'هـ' && p2.dsh['common::ok'] === 'حسنا' && w2.counts.kb === 3)
  check('label and meta are kept when the patch does not mention them', p2.label === 'العربية' && p2.meta.done === 4)
  s.write('ar', { meta: { complete: true, total: 10, done: 10, at: 9 } })
  check('meta is REPLACED when given', s.read('ar').meta.done === 10)
  s.write('ar', { kb: { z: 'ز' }, replace: true })
  const p3 = s.read('ar')
  check('replace:true swaps the sections it carries…', Object.keys(p3.kb).join() === 'z')
  check('… and leaves the others alone', p3.dsh['common::ok'] === 'حسنا' && p3.live.Salut === 'مرحبا')
  check('no .tmp file is left behind (atomic write)', readdirSync(s.dir).every((n) => !n.endsWith('.tmp')))
  check('updatedAt is an ISO date', /^\d{4}-\d\d-\d\dT/.test(p3.updatedAt))
}

console.log('list')
{
  const s = fresh('list')
  s.write('es', { kb: { a: 'x' } })
  s.write('ar', { kb: { a: 'x', b: 'y' }, dsh: { 'n::k': 'z' }, label: 'AR' })
  s.write('pt-BR', { kb: { a: 'x' } })
  const l = s.list()
  check('every language is listed, sorted', l.map((x) => x.id).join() === 'ar,es,pt-BR', l.map((x) => x.id).join())
  const ar = l.find((x) => x.id === 'ar')
  check('the summary carries counts, label, size — and not the strings', ar.counts.kb === 2 && ar.counts.dsh === 1 && ar.label === 'AR' && ar.bytes > 10 && ar.kb === undefined)
  writeFileSync(join(s.dir, 'notes.txt'), 'x')
  writeFileSync(join(s.dir, 'AB..json'), '{}')
  check('files that are not language packs are ignored', s.list().length === 3)
}

console.log('safety')
{
  const s = fresh('safety')
  for (const bad of ['../evil', 'ar/../x', 'AR', 'a', 'abcd', '', 'ar.json', 'ar-', 'ar-waytoolongregion', null, undefined, 3]) {
    const r = s.write(bad, { kb: { a: 'b' } })
    if (r.ok !== false) check('refuses id ' + JSON.stringify(bad), false, JSON.stringify(r))
  }
  check('refuses every malformed id', true)
  check('nothing was written outside the folder', !existsSync(join(root, 'evil.json')) && !existsSync(join(root, 'safety', 'x.json')))
  check('read() also refuses a malformed id', s.read('../safety/ar') === null)
  const r = s.write('ar', { kb: { __proto__x: 'ok', '__proto__': 'no', 'constructor': 'no', '': 'no', fine: 'yes', num: 3, nested: { a: 1 }, long: 'x'.repeat(LIMITS.value + 1), ['k'.repeat(LIMITS.key + 1)]: 'no' } })
  const p = s.read('ar')
  check('only short string entries are stored', Object.keys(p.kb).sort().join() === '__proto__x,fine', Object.keys(p.kb).join())
  check('the refused ones are counted, not silent', r.rejected >= 6, 'rejected=' + r.rejected)
  check('Object.prototype is untouched', ({}).polluted === undefined && Object.getPrototypeOf(p.kb) === null)
  check('a body that is not an object is refused', s.write('ar', 'x').ok === false && s.write('ar', [1]).ok === false && s.write('ar', null).ok === false)
  s.write('ar', { meta: { big: 'x'.repeat(LIMITS.meta + 1) } })
  check('an oversized meta is refused', s.read('ar').meta.big === undefined)
  const big = {}
  for (let i = 0; i < 5000; i += 1) big['k' + i] = 'x'.repeat(LIMITS.value)
  const rb = s.write('es', { kb: big })
  check('a pack over the size cap is refused and nothing is written', rb.ok === false && s.read('es') === null, JSON.stringify(rb).slice(0, 80))
}

console.log('damaged file')
{
  const s = fresh('bad')
  mkdirSync(s.dir, { recursive: true })
  writeFileSync(join(s.dir, 'ar.json'), '{ not json')
  check('a damaged pack reads as absent', s.read('ar') === null)
  check('… and is set aside, not deleted', readdirSync(s.dir).some((n) => n.startsWith('ar.json.bad-')))
  check('the language can be written again afterwards', s.write('ar', { kb: { a: 'b' } }).ok === true && s.read('ar').kb.a === 'b')
  writeFileSync(join(s.dir, 'es.json'), '[1,2]')
  check('a file that is not an object reads as absent', s.read('es') === null)
}

console.log('removal and tombstones')
{
  const s = fresh('rm')
  s.write('ar', { kb: { a: 'b' } })
  check('removing a language that exists', s.remove('ar').ok === true && s.read('ar') === null && !existsSync(join(s.dir, 'ar.json')))
  const t = s.removed()
  check('it leaves a tombstone with the time', typeof t.ar === 'number' && t.ar > 0)
  check('removing it again is fine (idempotent)', s.remove('ar').ok === true)
  check('removing one that never existed is fine and recorded', s.remove('es').ok === true && s.removed().es > 0)
  check('refuses a malformed id', s.remove('../x').ok === false)
  const before = s.removed().ar
  s.write('ar', { kb: { a: 'again' } })
  check('writing the language again clears its tombstone', s.removed().ar === undefined && before > 0)
  check('… and only its own', s.removed().es > 0)
  check('the tombstone file is not listed as a language', s.list().map((x) => x.id).join() === 'ar')
}

console.log('request handler')
{
  const s = fresh('handler')
  let r = handleI18nStore(s, { method: 'GET' })
  check('GET lists (empty) with the folder', r.status === 200 && r.body.ok === true && Array.isArray(r.body.packs) && r.body.packs.length === 0 && r.body.dir === s.dir)
  r = handleI18nStore(s, { method: 'POST', body: { id: 'ar', label: 'AR', kb: { a: 'b' } } })
  check('POST writes', r.status === 200 && r.body.ok === true && r.body.counts.kb === 1)
  r = handleI18nStore(s, { method: 'GET', id: 'ar' })
  check('GET ?id= returns the pack', r.status === 200 && r.body.pack.kb.a === 'b' && r.body.pack.label === 'AR')
  r = handleI18nStore(s, { method: 'GET', id: 'es' })
  check('GET ?id= of an unknown language is 404', r.status === 404 && r.body.ok === false)
  r = handleI18nStore(s, { method: 'POST', body: { id: '../x', kb: {} } })
  check('POST with a bad id is 400', r.status === 400 && r.body.ok === false)
  r = handleI18nStore(s, { method: 'POST', body: 'nope' })
  check('POST with a bad body is 400', r.status === 400)
  r = handleI18nStore(s, { method: 'POST', body: { id: 'ar', remove: true } })
  check('POST remove:true removes', r.status === 200 && s.read('ar') === null)
  r = handleI18nStore(s, { method: 'GET' })
  check('the list now reports the tombstone', r.body.removed.ar > 0 && r.body.packs.length === 0)
  check('other methods are 405', handleI18nStore(s, { method: 'DELETE' }).status === 405 && handleI18nStore(s, { method: 'PUT' }).status === 405)
}


console.log('route (origin guard, home, body)')
{
  const home = join(root, 'home')
  const mk = (over) => {
    const sent = []
    const io = Object.assign({
      home: async () => home,
      sameOriginStrict: () => true,
      sameOriginLax: () => true,
      readJson: async () => ({}),
      query: (req) => new URLSearchParams(req.query || ''),
      send: (res, status, body) => sent.push({ status, body }),
    }, over || {})
    return { io, sent }
  }
  const run = async (req, over) => { const k = mk(over); await serveI18nStore(req, {}, k.io); return k.sent[0] }
  let r = await run({ method: 'POST', body: { id: 'ar', kb: { a: 'b' } } }, { readJson: async () => ({ id: 'ar', label: 'AR', kb: { a: 'b' } }) })
  check('POST writes under <home>/kybernos/i18n/', r.status === 200 && r.body.ok === true && existsSync(join(home, 'kybernos', 'i18n', 'ar.json')), JSON.stringify(r))
  r = await run({ method: 'GET', query: 'id=ar' })
  check('GET ?id= reads it back', r.status === 200 && r.body.pack.kb.a === 'b' && r.body.pack.label === 'AR')
  r = await run({ method: 'GET' })
  check('GET lists, with the folder', r.status === 200 && r.body.packs.length === 1 && r.body.dir === join(home, 'kybernos', 'i18n'))
  r = await run({ method: 'POST' }, { sameOriginStrict: () => false })
  check('a write from another origin (or with none) is refused (403) and nothing is read from the body', r.status === 403)
  let touched = false
  r = await run({ method: 'POST' }, { sameOriginStrict: () => false, readJson: async () => { touched = true; return {} } })
  check('… the body is not even read', touched === false)
  r = await run({ method: 'GET' }, { sameOriginLax: () => false })
  check('a read from a foreign origin is refused (403)', r.status === 403)
  r = await run({ method: 'GET' }, { sameOriginStrict: () => false })
  check('a read only needs the lax check (a direct navigation has no Origin)', r.status === 200)
  r = await run({ method: 'POST' }, { readJson: async () => { throw new Error('too big') } })
  check('a body over the cap is 413', r.status === 413)
  let cap = null
  await run({ method: 'POST' }, { readJson: async (req, max) => { cap = max; return { id: 'es', kb: { a: 'b' } } } })
  check('the body is capped (' + MAX_BODY_BYTES + ' bytes)', cap === MAX_BODY_BYTES)
  r = await run({ method: 'GET' }, { home: async () => null })
  check('no DSH home: a clear answer, no crash, no file written', r.status === 200 && r.body.ok === false && /home/.test(r.body.error))
  r = await run({ method: 'PUT' })
  check('other methods are 405', r.status === 405)
  r = await run({ method: 'GET' }, { home: async () => { throw new Error('boom') } })
  check('a fault inside the route is a JSON 500, never an exception out of the handler', r.status === 500 && r.body.ok === false && /boom/.test(r.body.error))
  r = await run({ method: 'POST' }, { readJson: async () => ({ id: '../../etc/x', kb: { a: 'b' } }) })
  check('a path in the id is refused (400) and nothing is written outside the folder', r.status === 400 && !existsSync(join(root, 'etc')) && !existsSync(join(home, 'etc')))
}

rmSync(root, { recursive: true, force: true })
console.log(failed === 0 ? '\nOK — i18n store' : '\n' + failed + ' check(s) FAILED')
process.exit(failed === 0 ? 0 : 1)

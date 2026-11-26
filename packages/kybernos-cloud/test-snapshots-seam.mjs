// The snapshots seam: the verbs of the server's `/v1/snapshots` that a sibling bundle (the chat Journal) may use, with the account token added here and never handed over.
//   node packages/kybernos-cloud/test-snapshots-seam.mjs
// What is proven, against a stand-in server that follows kybernos-server `docs/contract/snapshots.md`: signed out = `not_connected` with no network call; status reads the limits and the
// links; put makes a link (POST) or replaces one (PUT) and carries `sealed`, `text` and `doc`; remove takes one down; the server's own words pass through; a server without the routes, a
// server that does not answer and a request that is not a link are told apart; nothing else is reachable, and the answers never hold the token.
import { createServer } from 'node:http'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let failed = 0
const check = (name, ok, detail) => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok || detail === undefined ? '' : '  — ' + detail))
  if (!ok) failed += 1
}

const seen = []
let mode = 'ok'
const ID = 'abcdefghijklmnop'
const ID2 = 'bcdefghijklmnopq'
const api = createServer((req, res) => {
  let raw = ''
  req.on('data', (c) => { raw += c })
  req.on('end', () => {
    seen.push({ method: req.method, url: req.url, auth: req.headers.authorization || null, body: raw === '' ? null : JSON.parse(raw) })
    const send = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }
    if (mode === 'noroute') return send(404, { error: 'not_found', message: 'No such route.', request_id: 'r1' })
    if (mode === 'plan') return send(403, { error: 'snapshots_not_in_plan', message: 'Not in your plan.', request_id: 'r1' })
    if (req.method === 'GET' && req.url === '/v1/snapshots') return send(200, { ok: true, allowed: true, limits: { max_bytes: 1000000, max_count: 20, ttl_days: 90, count: 1 }, snapshots: [{ id: ID, url: 'https://kaby.app/s/' + ID, sealed: true, doc: 'journal', bytes: 10, created: 'a', updated: 'b', expires: '2027-01-30T00:00:00.000Z', opens: 3 }] })
    if (req.method === 'POST' && req.url === '/v1/snapshots') return send(req.url.includes('big') || (JSON.parse(raw).text || '').length > 100 ? 413 : 201, (JSON.parse(raw).text || '').length > 100 ? { error: 'too_big', message: 'Too big.', request_id: 'r2' } : { ok: true, id: ID, url: 'https://kaby.app/s/' + ID, expires: '2027-01-30T00:00:00.000Z', bytes: 5 })
    if (req.method === 'PUT' && req.url === '/v1/snapshots/' + ID) return send(200, { ok: true, id: ID, url: 'https://kaby.app/s/' + ID, expires: '2027-02-01T00:00:00.000Z', bytes: 6 })
    if (req.method === 'DELETE' && req.url === '/v1/snapshots/' + ID) return send(200, { ok: true })
    return send(404, { error: 'not_found', message: 'Not found.', request_id: 'r3' })
  })
})
await new Promise((r) => api.listen(0, '127.0.0.1', r))
const home = mkdtempSync(join(tmpdir(), 'kb-snapshots-seam-'))
const stateFile = join(home, 'kybernos-cloud.json')
process.env.HOME = home
process.env.DSH_HOME = join(home, '.dsh')
process.env.KYBERNOS_CLOUD_API = 'http://127.0.0.1:' + api.address().port
process.env.KYBERNOS_CLOUD_STATE = stateFile
delete process.env.KYBERNOS_SERVERS_FILE

const TOKEN = 'kyd_' + 's'.repeat(40)
try {
  const { publishSnapshotsSeam, SNAPSHOTS_SEAM } = await import('./index.js')
  const target = {}
  publishSnapshotsSeam(target)
  const seam = target[SNAPSHOTS_SEAM]
  check('the seam is published, frozen, with only status, put and remove', seam !== undefined && Object.isFrozen(seam) && Object.keys(seam).sort().join(',') === 'put,remove,status,version')

  let r = await seam.status()
  check('signed out: status is not available, not_connected, no network call', r.ok === false && r.available === false && r.error === 'not_connected' && seen.length === 0)
  r = await seam.put({ sealed: false, text: '{}', doc: 'journal' })
  check('signed out: put and remove answer not_connected with no network call', r.ok === false && r.error === 'not_connected' && (await seam.remove(ID)).error === 'not_connected' && seen.length === 0)

  writeFileSync(stateFile, JSON.stringify({ token: TOKEN, api: process.env.KYBERNOS_CLOUD_API }) + '\n', { mode: 0o600 })
  r = await seam.status()
  check('signed in: status carries the limits and the links', r.ok === true && r.available === true && r.maxBytes === 1000000 && r.maxCount === 20 && r.ttlDays === 90 && r.count === 1 && r.links.length === 1 && r.links[0].id === ID && r.links[0].sealed === true && r.links[0].doc === 'journal' && r.links[0].expires === '2027-01-30T00:00:00.000Z', JSON.stringify(r))
  check('the token is added to the call and never returned', seen.length === 1 && seen[0].auth === 'Bearer ' + TOKEN && JSON.stringify(r).includes(TOKEN) === false)

  r = await seam.put({ sealed: false, text: '{"kind":"kybernos-journal"}', doc: 'journal' })
  check('put without an id makes a link: POST with sealed, text and doc', r.ok === true && r.id === ID && r.url === 'https://kaby.app/s/' + ID && r.bytes === 5 && seen[1].method === 'POST' && seen[1].url === '/v1/snapshots' && seen[1].body.sealed === false && seen[1].body.doc === 'journal' && seen[1].body.text === '{"kind":"kybernos-journal"}', JSON.stringify(r))
  r = await seam.put({ id: ID, sealed: true, text: '{"sealed":true}', doc: 'journal' })
  check('put with an id replaces that link: PUT on its address', r.ok === true && r.id === ID && r.expires === '2027-02-01T00:00:00.000Z' && seen[2].method === 'PUT' && seen[2].url === '/v1/snapshots/' + ID && seen[2].body.sealed === true)
  r = await seam.put({ sealed: false, text: '{}' })
  check('the kind defaults to dashboard', r.ok === true && seen[3].body.doc === 'dashboard')
  r = await seam.put({ sealed: false, text: 'x'.repeat(200), doc: 'journal' })
  check('the server\'s own refusal passes through with its words', r.ok === false && r.error === 'too_big' && r.message === 'Too big.', JSON.stringify(r))
  r = await seam.remove(ID)
  check('remove takes the link down: DELETE on its address', r.ok === true && seen[seen.length - 1].method === 'DELETE' && seen[seen.length - 1].url === '/v1/snapshots/' + ID)
  r = await seam.remove(ID2)
  check('remove of a link that is gone says not_found', r.ok === false && r.error === 'not_found')

  const before = seen.length
  const bad = [
    await seam.put(null), await seam.put({ sealed: 'no', text: '{}' }), await seam.put({ sealed: false, text: '' }), await seam.put({ sealed: false, text: '{}', doc: 'page' }),
    await seam.put({ id: '../../v1/shares', sealed: false, text: '{}' }), await seam.put({ id: 'ABCDEFGHIJKLMNOP', sealed: false, text: '{}' }), await seam.remove('../x'), await seam.remove(undefined),
  ]
  check('what is not a link is refused as bad_request with no network call', bad.every((x) => x.ok === false && x.error === 'bad_request') && seen.length === before)

  mode = 'noroute'
  r = await seam.status()
  check('a server without the routes: not_on_this_server, not available', r.ok === false && r.available === false && r.error === 'not_on_this_server')
  r = await seam.put({ sealed: false, text: '{}', doc: 'journal' })
  check('... and put says the same', r.ok === false && r.error === 'not_on_this_server')
  mode = 'plan'
  r = await seam.status()
  check('a plan without links: the server\'s word, not available', r.ok === false && r.available === false && r.error === 'snapshots_not_in_plan')

  mode = 'ok'
  await new Promise((resolve) => api.close(resolve))
  r = await seam.status()
  check('a server that does not answer: network', r.ok === false && r.available === false && r.error === 'network')
  r = await seam.put({ sealed: false, text: '{}', doc: 'journal' })
  check('... and put says the same', r.ok === false && r.error === 'network')
} finally {
  try { api.close() } catch (e) { /* closed */ }
}
console.log(failed === 0 ? '\nall passed' : '\n' + failed + ' failed')
process.exit(failed === 0 ? 0 : 1)

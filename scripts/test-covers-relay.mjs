// The covers, end to end and offline: the relay's own cover code behind a real local HTTP server, the plugin's own fetch in front of it.
//
// services/skills-index/relay-core.mjs `cover` serves a picture; packages/kybernos-skills `ensureCover` fetches it by the pick's id, checks the
// bytes against the hash the pick ships, and keeps it in the covers folder. Here the two meet over a real socket (loopback, which the plugin
// accepts for a relay address): a throw-away DSH home, synthetic pictures, no network and no Vercel.
//
//   node scripts/test-covers-relay.mjs
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cover } from '../services/skills-index/relay-core.mjs'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }

const base = mkdtempSync(join(tmpdir(), 'kb-covers-relay-'))
const home = join(base, 'home')
const dsh = join(home, '.dsh')
mkdirSync(dsh, { recursive: true })
process.env.HOME = home
process.env.DSH_HOME = dsh

const webp = (n) => Buffer.concat([Buffer.from('RIFF'), Buffer.from([n, 0, 0, 0]), Buffer.from('WEBPVP8 '), Buffer.alloc(64, n)])
const files = { pdf: webp(1), docx: webp(2), evil: webp(3) }
const served = []
const server = createServer(async (req, res) => {
  served.push(req.url)
  const out = await cover({ method: req.method, url: req.url }, { read: async (id) => files[id] ?? null })
  res.statusCode = out.status
  for (const [k, v] of Object.entries(out.headers)) res.setHeader(k, v)
  res.end(req.method === 'HEAD' ? undefined : out.body)
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
process.env.KYBERNOS_SKILLS_INDEX_URL = 'http://127.0.0.1:' + server.address().port + '/v1'

try {
  const { ensureCover } = await import('../packages/kybernos-skills/index.js')
  const sha = (b) => createHash('sha256').update(b).digest('hex')
  const cfg = { home, dsh, cwd: home }
  const folder = join(dsh, 'kybernos', 'skills-featured')
  console.log('covers: relay <-> plugin, over a socket')

  const got = await ensureCover(cfg, 'pdf', { items: [{ id: 'pdf', coverSha256: sha(files.pdf) }] })
  assert.equal(got, join(folder, 'pdf.webp'))
  assert.deepEqual(readFileSync(got), files.pdf)
  assert.deepEqual(served, ['/v1/covers/pdf.webp'])
  ok('the plugin asks /v1/covers/<id>.webp, the relay serves it, the bytes are kept as they came')

  const before = served.length
  assert.equal(await ensureCover(cfg, 'pdf', { items: [{ id: 'pdf', coverSha256: sha(files.pdf) }] }), got)
  assert.equal(served.length, before)
  ok('the second time the folder answers: no request')

  // the relay serves a different picture than the one shipped: refused, nothing kept
  const bad = await ensureCover(cfg, 'evil', { items: [{ id: 'evil', coverSha256: sha(webp(9)) }] })
  assert.equal(bad, null)
  assert.equal(existsSync(join(folder, 'evil.webp')), false)
  ok('a relay that serves another picture than the shipped one gets nothing kept: the hash decides, not the relay')

  // a picture the relay does not have: a 404, the tile stays
  assert.equal(await ensureCover(cfg, 'gone', { items: [{ id: 'gone', coverSha256: sha(webp(5)) }] }), null)
  ok('a picture the relay does not have leaves the tile in place')
} finally {
  server.close()
  rmSync(base, { recursive: true, force: true })
}
console.log('\n' + pass + ' verifications OK')

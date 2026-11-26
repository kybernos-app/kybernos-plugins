#!/usr/bin/env node
// PROBE — Ground 2 of docs/tests/revue-adversariale.md (F-25/F-26): a trust level is COMPUTED from signatures, never read
// from the document, and the verifiers have real production callers on the route the marketplace reads.
//
//   node docs/tests/probes/probe-catalogue-trust.mjs
//
// What it asserts, on A6's own route (`handleThemes`, its own store, its own guards):
//   (a) a source pinned by the person (TOFU: its own key, added with the source) can never yield `official`: the document's
//       own `level: 'official'` claim and the manifest's claims are ignored, and the level the verifier computes for an
//       author signature only is `community`;
//   (b) an entry whose author signature does not verify is REFUSED (the route's `refused` line, error `signature`) — which is
//       only possible if the route actually calls `verifyEntry`;
//   (c) `verifyEntry` and `verifyArchive` have call sites in the production path (not just their own definitions), and the
//       catalogue view reads no `level` from the document (grep: `newest.level` nowhere);
//   (d) the archive bound is the import bound (8 MiB), so a matching hash is not enough for an oversized archive.
//
// Fails today: the route copies `newest.level`, so the self-pinned claim comes out as `official`; no signature is checked; the
// two verifiers have zero call sites outside their own bodies.
import { generateKeyPairSync, createHash, sign } from 'node:crypto'
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { handleThemes, verifyEntry, verifyArchive, IMPORT_MAX } from '../../../packages/kybernos-plugin/theme-installer.mjs'

const here = fileURLToPath(new URL('.', import.meta.url))
const repo = join(here, '..', '..', '..')

let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) }
}
const section = (title) => console.log('\n' + title)
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')

const keypair = () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  return { pem: publicKey.export({ type: 'spki', format: 'pem' }).toString(), privateKey }
}
const MINE = keypair() // the key the person pinned for THEIR source (TOFU), not Kybernos's
const OTHER = keypair()
const archiveBytes = Buffer.from('the archive of the claimed-official theme')
const archiveHash = sha(archiveBytes)

/** One catalogue document, signed as a whole by `signer`, whose one entry claims whatever `claim` says. */
const catalogue = (signer, claim) => {
  const entry = {
    version: '1.0.0',
    manifest: Object.assign({
      id: 'kybernos/medecin',
      name: { en: 'Medical practice', fr: 'Cabinet médical' },
      description: { en: 'A practice of its own', fr: 'Un cabinet à soi' },
      author: { id: 'kybernos', name: 'Kybernos' },
      license: 'Apache-2.0',
    }, claim.manifest === undefined ? {} : claim.manifest),
    archive: { url: 'https://example.invalid/medecin-1.0.0.tgz', sha256: archiveHash, size: archiveBytes.length },
    // The author signature is what the verifier earns the level from; `claim.signWith` chooses whether it verifies.
    authorSig: sign(null, Buffer.from('kybernos-plugin-v1\nkybernos/medecin\n1.0.0\n' + archiveHash), claim.signWith).toString('base64'),
  }
  if (claim.level !== undefined) entry.level = claim.level
  if (claim.archiveSize !== undefined) entry.archive.size = claim.archiveSize
  const doc = {
    schema: 1,
    kind: 'kybernos-plugin-catalogue',
    catalogue: { id: 'self-1', name: 'A catalogue someone added', seq: 1, publishedAt: '2026-10-28T00:00:00.000Z' },
    authors: { kybernos: { keys: [{ keyId: 'self-1', pem: signer.pem }] } },
    reviewers: [],
    plugins: [{ id: 'kybernos/medecin', versions: [entry] }],
    revoked: [],
    revokedKeys: [],
  }
  const bytes = Buffer.from(JSON.stringify(doc))
  return { doc, bytes, signature: sign(null, bytes, signer.privateKey).toString('base64') }
}

/** A6's own route on its own temp folder, a source pinned with `key`, then a GET fed the bytes. */
const route = (cat, key) => {
  const dir = mkdtempSync(join(tmpdir(), 'kb-probe-trust-'))
  const store = { dir }
  const sameOrigin = () => true
  const source = 'https://example.invalid/self.json'
  const added = handleThemes(store, { method: 'POST', body: { action: 'source-add', url: source, key: { keyId: 'self-1', pem: key.pem } } }, { sameOrigin, session: () => true })
  if (added.status !== 200 || added.body.ok !== true) throw new Error('source-add refused: ' + JSON.stringify(added))
  const view = handleThemes(store, { method: 'GET' }, { sameOrigin, catalogues: [{ source, bytes: cat.bytes, signature: cat.signature }] })
  rmSync(dir, { recursive: true, force: true })
  return view.body
}

section('(a) a source the person pinned can never mint "official"')
{
  const cat = catalogue(MINE, { level: 'official', manifest: { level: 'official', trust: 'official', official: true }, signWith: MINE.privateKey })
  const body = route(cat, MINE)
  const theme = body.themes.length === 1 ? body.themes[0] : null
  check('the self-pinned source is verified against its own pinned key (the catalogue is read at all)', theme !== null, body.refused)
  check('the document\'s own level: "official" is NOT the level that comes out', theme !== null && theme.level !== 'official', theme)
  check('...the level is the one an author signature earns: community', theme !== null && theme.level === 'community', theme)
  check('...and the manifest\'s own trust claims change nothing', theme !== null && theme.level === 'community' && JSON.stringify(theme).indexOf('trust') < 0, theme)
}

section('(b) an entry whose author signature does not verify is refused (verifyEntry runs on the route)')
{
  const cat = catalogue(MINE, { level: 'official', signWith: OTHER.privateKey })
  const body = route(cat, MINE)
  check('no card is offered for an unverified author signature', body.themes.length === 0, body.themes)
  // Either shape is a refusal the page can draw (A7's left-out row reads `id` + `code`): the verifier's own code must appear.
  check('the refusal is named with the verifier\'s own code (signature), never a generic error', JSON.stringify(body.refused).indexOf('signature') >= 0, body.refused)
}

section('(c) the verifiers have production callers, and no level is read from the document')
{
  const files = []
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name === '.git' || name === 'docs' || name === 'artifacts' || name === 'rapports') continue
      const p = join(dir, name)
      let st = null
      try { st = statSync(p) } catch (e) { st = null }
      if (st === null) continue
      if (st.isDirectory()) walk(p)
      else if (/\.(mjs|js|cjs)$/.test(name) && /^test/i.test(name) === false && /\.test\./i.test(name) === false) files.push(p)
    }
  }
  walk(join(repo, 'packages'))
  const texts = files.map((f) => ({ rel: relative(repo, f), text: readFileSync(f, 'utf8') }))
  const installer = texts.filter((f) => f.rel === join('packages', 'kybernos-plugin', 'theme-installer.mjs'))[0]
  const calls = (text, fn) => (text.match(new RegExp(fn + '\\(', 'g')) || []).length - (text.match(new RegExp('function ' + fn + ' \\(', 'g')) || []).length
  const archiveCallers = texts.map((f) => ({ rel: f.rel, n: calls(f.text, 'verifyArchive') })).filter((x) => x.n > 0)
  check('verifyArchive has a call site in the production path (today: none)', archiveCallers.length > 0, archiveCallers)
  const view = installer === undefined ? '' : installer.text.slice(installer.text.indexOf('const catalogueView ='), installer.text.indexOf('const readAll ='))
  check('the route\'s read path calls verifyEntry (today: the level is copied instead)', /verifyEntry\s*\(/.test(view), view.slice(0, 200))
  check('the catalogue view never reads a level from the document (`newest.level` nowhere in theme-installer.mjs)',
    installer !== undefined && /newest\.level|\.level\s*===/.test(installer.text) === false, installer === undefined ? null : (installer.text.match(/.{0,60}newest\.level.{0,60}/) || [])[0])
  const bogus = verifyEntry({ id: 'kybernos/medecin', version: '1.0.0', entry: { yanked: true } })
  check('verifyEntry really refuses a yanked entry (the verifier itself is sane)', bogus.ok === false && bogus.error === 'yanked', bogus)
}

section('(d) the verifier of the archived bytes is sane (its missing caller is (c)')
{
  check('IMPORT_MAX is the 8 MiB the registry\'s import route uses', IMPORT_MAX === 8 * 1024 * 1024, IMPORT_MAX)
  const signed = { archive: { sha256: archiveHash, size: archiveBytes.length }, authorSig: sign(null, Buffer.from('kybernos-plugin-v1\nkybernos/medecin\n1.0.0\n' + archiveHash), MINE.privateKey).toString('base64') }
  const good = verifyArchive({ bytes: archiveBytes, id: 'kybernos/medecin', version: '1.0.0', entry: signed, keys: [{ keyId: 'self-1', pem: MINE.pem }] })
  check('the real bytes of a signed entry verify (hash + author signature)', good.ok === true && good.sha256 === archiveHash && good.level === 'community', good)
  const wrong = verifyArchive({ bytes: Buffer.from('other bytes'), id: 'kybernos/medecin', version: '1.0.0', entry: signed, keys: [{ keyId: 'self-1', pem: MINE.pem }] })
  check('...other bytes are refused on the hash', wrong.ok === false && wrong.error === 'hash', wrong)
  const tooBig = verifyArchive({ bytes: Buffer.alloc(IMPORT_MAX + 1), id: 'kybernos/medecin', version: '1.0.0', entry: signed, keys: [{ keyId: 'self-1', pem: MINE.pem }] })
  check('...an archive over the import bound is refused on its size', tooBig.ok === false && tooBig.error === 'size', tooBig)
}

console.log('\n' + (fail === 0 ? 'OK' : 'FAILED') + ' — ground 2, catalogue trust (' + (pass + fail) + ' checks)')
process.exit(fail === 0 ? 0 : 1)

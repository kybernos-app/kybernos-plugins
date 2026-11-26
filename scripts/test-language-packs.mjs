#!/usr/bin/env node
// The publishing side of the ready-made language packs (scripts/language-packs.mjs), end to end: a language the host job
// translated → a pack → a signed index → a machine that installs it. No network (the "download" reads the folder).
//
//   node scripts/test-language-packs.mjs
import { execFileSync } from 'node:child_process'
import { generateKeyPairSync } from 'node:crypto'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createI18nStore } from '../packages/kybernos-plugin/i18n-store.mjs'
import { createJobRunner } from '../packages/kybernos-plugin/i18n-job.mjs'
import { INDEX_FILE, createPacks } from '../packages/kybernos-plugin/i18n-packs.mjs'
import { buildIndex, buildPack } from './language-packs.mjs'

let pass = 0
let fail = 0
const check = (name, ok, detail) => { if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) } }
const SCRIPT = fileURLToPath(new URL('./language-packs.mjs', import.meta.url))
const run = (...args) => execFileSync('node', [SCRIPT, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

console.log('the pure parts')
{
  const pack = { id: 'es', label: 'Español', kb: { a: 'Hola', b: '⟦Adiós⟧', c: 'Sin hash' }, dsh: { 'ns::k': 'Cancelar' }, src: { 'kb:a': 'aaaaaaaa', 'kb:b': 'bbbbbbbb', 'dsh:ns::k': 'cccccccc' } }
  const r = buildPack(pack)
  check('only what the job wrote (a source hash) and is a real translation goes in', Object.keys(r.pack.kb).join() === 'a' && Object.keys(r.pack.dsh).join() === 'ns::k' && r.skipped === 2, r)
  check('--include-unhashed adds the older ones, never a test mark', Object.keys(buildPack(pack, { includeUnhashed: true }).pack.kb).join() === 'a,c')
  const files = [{ file: 'es.pack.json', bytes: Buffer.from(JSON.stringify(r.pack)) }, { file: 'de.pack.json', bytes: Buffer.from(JSON.stringify({ ...r.pack, lang: 'de', label: 'Deutsch' })) }]
  const idx = buildIndex(files, { seq: 3, publishedAt: '2026-10-16T00:00:00.000Z' })
  check('the index lists the packs sorted, with the set\'s seq, a hash and a size', idx.doc.packs.map((p) => p.lang).join() === 'de,es' && idx.doc.seq === 3 && idx.doc.packs.every((p) => p.seq === 3 && /^[0-9a-f]{64}$/.test(p.sha256) && p.size > 10))
  check('every pack file is rewritten with that seq (the pack and the index agree)', idx.rewrites.every((w) => JSON.parse(w.bytes.toString()).seq === 3))
  let threw = false
  try { buildIndex([{ file: 'x.pack.json', bytes: Buffer.from(JSON.stringify({ ...r.pack, kb: {}, dsh: {} })) }], { seq: 1, publishedAt: 'x' }) } catch (e) { threw = true }
  check('a pack with nothing in it stops the build', threw)
}

console.log('\nend to end')
{
  const home = mkdtempSync(join(tmpdir(), 'kb-lp-home-'))
  const out = mkdtempSync(join(tmpdir(), 'kb-lp-out-'))
  const i18n = join(home, 'kybernos', 'i18n')
  // 1. the host job translates a language (a fake model, the real runner and quality checks)
  const store = createI18nStore({ dir: i18n })
  const runner = createJobRunner({ dir: i18n, store, sleep: async () => {}, translate: async (a) => ({ ok: true, provider: 'p', model: 'm', translations: Object.fromEntries(Object.keys(a.batch).map((k) => [k, 'ES ' + a.batch[k]])) }) })
  const items = Array.from({ length: 12 }, (_, i) => ({ wire: (i % 4 === 3 ? 'dsh:ns::k' : 'kb:k') + i, text: 'Texte numéro ' + i, area: 'core' }))
  runner.start({ op: 'start', lang: 'es', langName: 'Spanish', items, total: 12 })
  await runner.idle()
  check('(setup) the job translated 12 texts and kept their source hashes', runner.status('es').state === 'done' && Object.keys(store.read('es').src).length === 12)
  // 2. export, index, sign, verify
  check('export writes the pack', /es: 9 Kybernos \+ 3 DSH texts/.test(run('export', '--lang', 'es', '--home', home, '--dir', out)))
  check('index writes the signed document\'s body', /index: 1 packs, seq 1/.test(run('index', '--bump', '--dir', out)) && existsSync(join(out, INDEX_FILE)))
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const keyFile = join(out, 'test.key')
  writeFileSync(keyFile, privateKey.export({ type: 'pkcs8', format: 'pem' }))
  const pubFile = join(out, 'pub.json')
  writeFileSync(pubFile, JSON.stringify({ keys: [{ keyId: 't', pem: publicKey.export({ type: 'spki', format: 'pem' }) }] }))
  check('sign checks the signature against the key it is given', /signed with key t/.test(run('sign', '--key', keyFile, '--pub', pubFile, '--dir', out)))
  check('verify accepts it, and refuses it under another key', /accepted: 1 packs/.test(run('verify', join(out, INDEX_FILE), join(out, INDEX_FILE + '.sig'), '--pub', pubFile)) && (() => { const other = generateKeyPairSync('ed25519'); const f = join(out, 'other.json'); writeFileSync(f, JSON.stringify({ keys: [{ keyId: 'o', pem: other.publicKey.export({ type: 'spki', format: 'pem' }) }] })); try { run('verify', join(out, INDEX_FILE), join(out, INDEX_FILE + '.sig'), '--pub', f); return false } catch (e) { return true } })())
  // 3. another machine installs it
  const home2 = mkdtempSync(join(tmpdir(), 'kb-lp-home2-'))
  const store2 = createI18nStore({ dir: join(home2, 'i18n') })
  const keys = JSON.parse(readFileSync(pubFile, 'utf8')).keys
  const fetchImpl = async (url) => { const f = join(out, String(url).split('/').pop()); return existsSync(f) ? { ok: true, status: 200, url, body: new Response(readFileSync(f)).body } : { ok: false, status: 404, url, body: null } }
  const packs = createPacks({ dir: home2, store: store2, keys, base: 'https://example.test/languages/', fetchImpl })
  const listed = await packs.refresh()
  check('the other machine lists the pack from the signed index', listed.online.state === 'ok' && listed.packs.length === 1 && listed.packs[0].counts.kb === 9 && listed.packs[0].counts.dsh === 3, listed)
  const done = await packs.install('es')
  check('and installs it: every text, with its source hash, no model involved', done.ok === true && done.added === 12 && store2.read('es').kb.k0 === 'ES Texte numéro 0' && Object.keys(store2.read('es').src).length === 12, done)
  const j = JSON.parse(readFileSync(join(out, 'es.pack.json'), 'utf8'))
  check('the published pack holds no live-layer text, no meta, nothing of the person\'s browsing', j.live === undefined && j.meta === undefined && Object.keys(j).sort().join() === 'dsh,kb,kind,label,lang,schema,seq,src')
  rmSync(home, { recursive: true, force: true }); rmSync(home2, { recursive: true, force: true }); rmSync(out, { recursive: true, force: true })
}
console.log('\n' + pass + ' ✓  ' + fail + ' ✗')
process.exit(fail === 0 ? 0 : 1)

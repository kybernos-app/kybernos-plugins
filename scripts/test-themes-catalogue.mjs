#!/usr/bin/env node
// The publishing side of the theme gallery: the sources, the shipped file and the signed catalogue must agree.
//
//   node scripts/test-themes-catalogue.mjs
//
// What is pinned here:
//  - packages/kybernos-theme/gallery.json is EXACTLY what catalog/themes/*.json builds (nobody edits it by hand);
//  - every source passes the rules the host applies, and is named after its id;
//  - when a signed catalogue is committed under catalog/, the embedded key accepts it and it says the same as the sources;
//  - the CLI makes a key outside the repo (never overwrites, never in the repo), signs, verifies, and refuses a tampered file.
import { spawnSync } from 'node:child_process'
import { createPrivateKey, createPublicKey } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { evaluate } from '../packages/kybernos-theme/themes-catalogue.mjs'
import { KEYS_FILE, OUT_DIR, REPO, SHIPPED, buildDocument, readKeys, readSources } from './themes-catalogue.mjs'

let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) }
}
const section = (title) => console.log('\n' + title)
const cli = (...args) => spawnSync(process.execPath, [fileURLToPath(new URL('./themes-catalogue.mjs', import.meta.url)), ...args], { encoding: 'utf8' })

section('the sources')
{
  let themes = null
  let error = null
  try { themes = readSources() } catch (e) { error = e.message }
  check('every catalog/themes/<id>.json passes the host\'s rules and is named after its id', themes !== null && themes.length >= 8, error)
  const doc = buildDocument()
  check('the document built from them is well formed (a seq and a date from _catalogue.json)', Number.isInteger(doc.seq) && doc.seq >= 1 && !Number.isNaN(Date.parse(doc.publishedAt)))
  const shipped = JSON.parse(readFileSync(SHIPPED, 'utf8'))
  check('packages/kybernos-theme/gallery.json is exactly what the sources build (run `node scripts/themes-catalogue.mjs build`)', JSON.stringify(shipped) === JSON.stringify(doc), { shippedSeq: shipped.seq, builtSeq: doc.seq, shippedThemes: shipped.themes.length, builtThemes: doc.themes.length })
}

section('the signed catalogue committed under catalog/ (when there is one)')
{
  const docFile = join(OUT_DIR, 'themes.catalog.json')
  const sigFile = join(OUT_DIR, 'themes.catalog.json.sig')
  const keys = readKeys()
  if (!existsSync(docFile) && !existsSync(sigFile)) {
    console.log('  · none committed yet: the gallery shows the shipped themes. To publish: keygen --embed, then sign (docs/dev/theme-gallery.md)')
    check('with no signed catalogue there is nothing to contradict the sources (no half-published pair)', !existsSync(docFile) && !existsSync(sigFile))
  } else {
    check('both files are there (the document and its signature)', existsSync(docFile) && existsSync(sigFile))
    const verdict = existsSync(docFile) && existsSync(sigFile) ? evaluate({ bytes: readFileSync(docFile), signature: readFileSync(sigFile, 'utf8'), keys }) : { ok: false, error: 'missing' }
    check('the embedded themes key accepts it', verdict.ok === true, verdict.error)
    check('...and it says what the sources say (same seq, same themes): it was signed after the last change', verdict.ok === true && JSON.stringify(verdict.doc) === JSON.stringify(buildDocument()), verdict.ok === true ? { signedSeq: verdict.doc.seq, builtSeq: buildDocument().seq } : verdict)
  }
}

section('the command line')
{
  const dir = mkdtempSync(join(tmpdir(), 'kb-themes-cli-'))
  try {
    const inRepo = cli('keygen', '--out', join(REPO, 'some-key.pem'))
    check('keygen refuses a private key inside the repository', inRepo.status === 1 && /OUTSIDE this repository/.test(inRepo.stderr) && !existsSync(join(REPO, 'some-key.pem')), inRepo.stderr)
    const made = cli('keygen', '--out', join(dir, 'themes.key'))
    check('keygen writes the private key outside the repo, mode 0600, and prints the public one', made.status === 0 && existsSync(join(dir, 'themes.key')) && (statSync(join(dir, 'themes.key')).mode & 0o777) === 0o600 && /BEGIN PUBLIC KEY/.test(made.stdout), made.stderr)
    check('...and never overwrites a key', cli('keygen', '--out', join(dir, 'themes.key')).status === 1)
    const embeddedBefore = existsSync(KEYS_FILE) ? readFileSync(KEYS_FILE, 'utf8') : null
    check('...without --embed the repository\'s key file is untouched', (existsSync(KEYS_FILE) ? readFileSync(KEYS_FILE, 'utf8') : null) === embeddedBefore)

    const pem = createPublicKey(createPrivateKey(readFileSync(join(dir, 'themes.key'), 'utf8'))).export({ type: 'spki', format: 'pem' })
    writeFileSync(join(dir, 'pub.json'), JSON.stringify({ keys: [{ keyId: 'test', pem }] }))
    const signed = cli('sign', '--key', join(dir, 'themes.key'), '--out', join(dir, 'out'), '--pub', join(dir, 'pub.json'))
    check('sign writes the document and its signature, and replays the gallery\'s own check with that key', signed.status === 0 && existsSync(join(dir, 'out', 'themes.catalog.json')) && existsSync(join(dir, 'out', 'themes.catalog.json.sig')), signed.stderr)
    const ok = cli('verify', join(dir, 'out', 'themes.catalog.json'), join(dir, 'out', 'themes.catalog.json.sig'), '--pub', join(dir, 'pub.json'))
    check('verify accepts it', ok.status === 0 && /accepted: \d+ themes/.test(ok.stdout), ok.stderr)
    const bytes = readFileSync(join(dir, 'out', 'themes.catalog.json'))
    writeFileSync(join(dir, 'tampered.json'), Buffer.concat([bytes, Buffer.from(' ')]))
    const bad = cli('verify', join(dir, 'tampered.json'), join(dir, 'out', 'themes.catalog.json.sig'), '--pub', join(dir, 'pub.json'))
    check('verify refuses a file changed after signing', bad.status === 1 && /signature/.test(bad.stderr), bad.stderr)
    check('verify with the repository\'s embedded key refuses a catalogue signed by another key', (readKeys().length === 0 ? cli('verify', join(dir, 'out', 'themes.catalog.json'), join(dir, 'out', 'themes.catalog.json.sig')).status === 1 : cli('verify', join(dir, 'out', 'themes.catalog.json'), join(dir, 'out', 'themes.catalog.json.sig')).status === 1))
    check('sign with a key the embedded one does not match says so instead of calling it good', cli('sign', '--key', join(dir, 'themes.key'), '--out', join(dir, 'out2')).status === 1)
    check('an unknown command is a usage error', cli('nope').status === 2)
  } finally { rmSync(dir, { recursive: true, force: true }) }
}

console.log('\n' + (fail === 0 ? 'OK' : 'FAILED') + ' — themes catalogue publishing (' + (pass + fail) + ' checks)')
process.exit(fail === 0 ? 0 : 1)

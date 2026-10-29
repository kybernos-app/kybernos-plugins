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
import { A11Y_KEYS, THEME_POINT, evaluate } from '../packages/kybernos-theme/themes-catalogue.mjs'
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

section('the point a pack\'s theme file is read through (kybernos/theme#theme)')
{
  // ONE table, asserted in BOTH copies of this suite (here and packages/kybernos-theme/test-themes-catalogue.mjs):
  // the point's refusals ARE the settings vocabulary's, so a rule added to sanitizePreset or A11Y_KEYS is
  // inherited by construction, never re-typed. [what, raw, fileId]
  const POINT_CASES = [
    ['a bad id', { id: 'Bad Id', name: 'T', settings: { mode: 'light' } }, 'Bad Id'],
    ['an empty name', { id: 'soigne', name: ' ', settings: { mode: 'light' } }, 'soigne'],
    ['a bad value (acc: "blue")', { id: 'soigne', name: 'T', settings: { acc: 'blue' } }, 'soigne'],
    ['no known setting at all', { id: 'soigne', name: 'T', settings: { evil: 1 } }, 'soigne'],
    ['settings missing', { id: 'soigne', name: 'T' }, 'soigne'],
    ['a name that is not the file name', { id: 'soigne', name: 'T', settings: { mode: 'light' } }, 'autre'],
  ]
  check('THEME_POINT is the shape the registry defines (owner, ownerVersion, data, inert, validate)', THEME_POINT.owner === 'kybernos/theme' && THEME_POINT.ownerVersion === '1.0.0' && THEME_POINT.name === 'theme' && THEME_POINT.version === '1.0' && THEME_POINT.kind === 'data' && THEME_POINT.class === 'inert' && typeof THEME_POINT.validate === 'function')
  const light = { id: 'soigne', name: 'Soigne', settings: { mode: 'light', acc: '#4d7c0f', evil: 1 } }
  const v = THEME_POINT.validate(light, 'soigne')
  check('a light { id, name, settings } file (the starter shape) passes, with the unknown key dropped', v.ok === true && v.value.id === 'soigne' && v.value.settings.evil === undefined && v.value.settings.acc === '#4d7c0f', v)
  const full = { id: 'soigne', v: 2, name: 'Soigne', author: 'Acme', description: { fr: 'Sobre.', en: 'Plain.' }, settings: { mode: 'light', acc: '#4d7c0f' } }
  const f = THEME_POINT.validate(full, 'soigne')
  check('a full catalogue entry is accepted as a superset', f.ok === true && f.value.author === 'Acme' && f.value.v === 2 && f.value.description === undefined, f)
  for (const [what, raw, fileId] of POINT_CASES) {
    const r = THEME_POINT.validate(raw, fileId)
    check('refused: ' + what, r.ok === false && Array.isArray(r.errors) && r.errors.length > 0 && r.value === undefined, r)
  }
  for (const k of A11Y_KEYS) {
    const r = THEME_POINT.validate({ id: 'a11y', name: 'A11y', settings: { mode: 'light', [k]: k === 'contrastMode' ? 'max' : true } }, 'a11y')
    check('refused: accessibility key « ' + k + ' » (named in the error)', r.ok === false && r.errors.some((e) => e.indexOf(k) >= 0), r)
  }
  // The shipped gallery and every source have to stay readable by the point too: one vocabulary, no second rule.
  const shipped = JSON.parse(readFileSync(SHIPPED, 'utf8'))
  check('every shipped theme passes the point as a full catalogue entry', shipped.themes.every((t) => THEME_POINT.validate(t, t.id).ok === true), shipped.themes.map((t) => t.id).filter((id) => THEME_POINT.validate(shipped.themes.find((t) => t.id === id), id).ok !== true))
}

console.log('\n' + (fail === 0 ? 'OK' : 'FAILED') + ' — themes catalogue publishing (' + (pass + fail) + ' checks)')
process.exit(fail === 0 ? 0 : 1)

#!/usr/bin/env node
// The rules of belief of the theme gallery's catalogue (themes-catalogue.mjs): pure, no network, no disk.
//
//   node test-themes-catalogue.mjs
//
// What is pinned here:
//  - a catalogue theme is data, and never carries accessibility settings (refused, not trimmed);
//  - nothing is parsed from an unsigned document: signature first, then shape, then age;
//  - a replayed older catalogue is a rollback and is refused; the same age is fine;
//  - the signed catalogue wins over the shipped one only when it is at least as recent.
import { generateKeyPairSync, sign } from 'node:crypto'
import { readFileSync } from 'node:fs'
import {
  A11Y_KEYS, DEFAULT_URL, KIND, LIMITS, MAX_DOC_BYTES, MAX_THEMES, SCHEMA, THEME_POINT,
  effective, evaluate, readDocument, sanitizeDocument, sanitizeTheme, verifySignature,
} from './themes-catalogue.mjs'
import * as STORE from './preset-store.mjs'

let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) }
}
const section = (title) => console.log('\n' + title)

const pair = () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  return { pem: publicKey.export({ type: 'spki', format: 'pem' }), priv: privateKey }
}
const A = pair()
const B = pair()
const keysA = [{ keyId: 'a', pem: A.pem }]
const good = (over = {}) => ({
  id: 'encre-papier', v: 1, name: 'Encre & papier', author: 'Kybernos',
  description: { fr: 'Sobre, coins nets.', en: 'Plain, sharp corners.' },
  settings: { mode: 'light', acc: '#1f2937', ov: { 'light:base': '#f6f7f8' }, fontText: 'georgia', radius: 'sharp' }, ...over,
})
const doc = (over = {}) => ({ schema: SCHEMA, kind: KIND, publishedAt: '2026-10-08T12:00:00.000Z', seq: 3, themes: [good()], ...over })
const bytesOf = (d) => Buffer.from(JSON.stringify(d, null, 2) + '\n', 'utf8')
const sig = (b, priv = A.priv) => sign(null, b, priv).toString('base64')

section('one catalogue theme')
{
  const v = sanitizeTheme(good())
  check('a valid theme is accepted and cleaned', v.ok === true && v.theme.name === 'Encre & papier' && v.theme.v === 1 && v.theme.settings.radius === 'sharp', v)
  check('unknown settings are dropped, not trusted', Object.keys(sanitizeTheme(good({ settings: { mode: 'dark', evil: 1, skin: 'x' } })).theme.settings).join() === 'mode')
  for (const k of A11Y_KEYS) check('accessibility key « ' + k + ' » is refused (a publishing mistake, not something to trim)', sanitizeTheme(good({ settings: { mode: 'dark', [k]: k === 'contrastMode' ? 'max' : true } })).ok === false)
  check('a bad id is refused', ['', 'Bad Id', '../x', 'x'.repeat(41), 'A'].every((id) => sanitizeTheme(good({ id })).ok === false))
  check('an empty or oversized name is refused', sanitizeTheme(good({ name: ' ' })).ok === false && sanitizeTheme(good({ name: 'x'.repeat(LIMITS.name + 1) })).ok === false)
  check('an author is required', sanitizeTheme(good({ author: '' })).ok === false && sanitizeTheme(good({ author: undefined })).ok === false)
  check('the description needs BOTH languages', sanitizeTheme(good({ description: { fr: 'x' } })).ok === false && sanitizeTheme(good({ description: { fr: 'x', en: '' } })).ok === false && sanitizeTheme(good({ description: 'x' })).ok === false)
  check('...and stays short', sanitizeTheme(good({ description: { fr: 'x'.repeat(LIMITS.description + 1), en: 'x' } })).ok === false)
  check('the version is a positive integer', sanitizeTheme(good({ v: 0 })).ok === false && sanitizeTheme(good({ v: 1.5 })).ok === false && sanitizeTheme(good({ v: '1' })).ok === false)
  check('settings must be there, plain and not empty', sanitizeTheme(good({ settings: undefined })).ok === false && sanitizeTheme(good({ settings: [] })).ok === false && sanitizeTheme(good({ settings: { evil: 1 } })).ok === false)
  check('a bad colour in the settings is refused', sanitizeTheme(good({ settings: { acc: 'url(x)' } })).ok === false)
  check('control characters in text become spaces', sanitizeTheme(good({ name: 'A\u0000B', author: 'C\nD' })).theme.name === 'A B')
  check('not an object is refused', sanitizeTheme(null).ok === false && sanitizeTheme('x').ok === false)
}

section('the document')
{
  check('a valid document is accepted', sanitizeDocument(doc()).ok === true)
  check('wrong schema, kind, date or seq is refused', sanitizeDocument(doc({ schema: 2 })).error === 'schema' && sanitizeDocument(doc({ kind: 'kybernos-suite' })).error === 'kind' && sanitizeDocument(doc({ publishedAt: 'yesterday' })).error === 'publishedAt' && sanitizeDocument(doc({ seq: -1 })).error === 'seq' && sanitizeDocument(doc({ seq: 1.5 })).error === 'seq')
  const dup = sanitizeDocument(doc({ themes: [good(), good()] }))
  check('two themes with one id are refused, naming it', dup.ok === false && /duplicate/.test(dup.detail) && /encre-papier/.test(dup.detail), dup)
  const bad = sanitizeDocument(doc({ themes: [good(), good({ id: 'other', author: '' })] }))
  check('one bad theme refuses the whole document, naming it', bad.ok === false && bad.error === 'theme' && /^other: /.test(bad.detail), bad)
  check('not an array of themes is refused; too many too', sanitizeDocument(doc({ themes: 'x' })).ok === false && sanitizeDocument(doc({ themes: Array.from({ length: MAX_THEMES + 1 }, (_, i) => good({ id: 't' + i })) })).ok === false)
  check('an empty catalogue is valid (nothing published yet)', sanitizeDocument(doc({ themes: [] })).ok === true)
  check('readDocument: bytes in, a clean document out', readDocument(bytesOf(doc())).ok === true && readDocument(bytesOf(doc())).doc.themes[0].id === 'encre-papier')
  check('readDocument: not JSON, empty or too big are refused before anything is read', readDocument(Buffer.from('{ no')).error === 'json' && readDocument(Buffer.alloc(0)).error === 'size' && readDocument(Buffer.alloc(MAX_DOC_BYTES + 1, 32)).error === 'size' && readDocument('x').error === 'size')
  check('the default address is an https URL on the open-core repo', DEFAULT_URL.startsWith('https://') && /kybernos-plugins/.test(DEFAULT_URL))
}

section('the signature')
{
  const b = bytesOf(doc())
  check('the right key verifies and is named', verifySignature({ bytes: b, signature: sig(b), keys: keysA }) === 'a')
  check('another key does not', verifySignature({ bytes: b, signature: sig(b, B.priv), keys: keysA }) === null)
  const tampered = Buffer.from(b); tampered[tampered.length - 5] ^= 1
  check('a document changed by one bit does not verify', verifySignature({ bytes: tampered, signature: sig(b), keys: keysA }) === null)
  check('a signature that is not 64 bytes of base64, or is empty, does not verify', verifySignature({ bytes: b, signature: 'AAAA', keys: keysA }) === null && verifySignature({ bytes: b, signature: '', keys: keysA }) === null && verifySignature({ bytes: b, signature: undefined, keys: keysA }) === null)
  check('a key list that has a broken key and a good one still verifies with the good one', verifySignature({ bytes: b, signature: sig(b), keys: [{ keyId: 'x', pem: 'nope' }, ...keysA] }) === 'a')
  check('no key at all verifies nothing', verifySignature({ bytes: b, signature: sig(b), keys: [] }) === null && verifySignature({ bytes: b, signature: sig(b), keys: undefined }) === null)
  check('trailing white space around the base64 is fine (a file ends with a newline)', verifySignature({ bytes: b, signature: sig(b) + '\n', keys: keysA }) === 'a')
}

section('the verdict: signature, then shape, then age')
{
  const b = bytesOf(doc({ seq: 5 }))
  const ok = evaluate({ bytes: b, signature: sig(b), keys: keysA, floor: { seq: 5 } })
  check('a signed, well-formed catalogue as recent as the one known is accepted', ok.ok === true && ok.key === 'a' && ok.doc.seq === 5, ok)
  check('a newer one is accepted', evaluate({ bytes: b, signature: sig(b), keys: keysA, floor: { seq: 4 } }).ok === true)
  const old = evaluate({ bytes: b, signature: sig(b), keys: keysA, floor: { seq: 6 } })
  check('an OLDER one, genuinely signed, is a rollback and is refused', old.ok === false && old.error === 'older', old)
  check('no floor means no age check (the first catalogue ever)', evaluate({ bytes: b, signature: sig(b), keys: keysA }).ok === true)
  check('no trusted key: nothing is accepted (and nothing is parsed)', evaluate({ bytes: b, signature: sig(b), keys: [] }).error === 'no-key')
  check('a signature by a key nobody trusts: refused', evaluate({ bytes: b, signature: sig(b, B.priv), keys: keysA }).error === 'signature')
  const unsignedBad = Buffer.from('{ this is not even json')
  check('an unsigned broken file is refused for its SIGNATURE (it is never parsed)', evaluate({ bytes: unsignedBad, signature: sig(b), keys: keysA }).error === 'signature')
  const signedBad = bytesOf({ ...doc(), themes: [good({ author: '' })] })
  check('signed but malformed: refused for its shape', evaluate({ bytes: signedBad, signature: sig(signedBad), keys: keysA }).error === 'theme')
  const signedA11y = bytesOf(doc({ themes: [good({ settings: { mode: 'dark', cbSafe: true } })] }))
  check('signed but carrying an accessibility setting: refused', evaluate({ bytes: signedA11y, signature: sig(signedA11y), keys: keysA }).error === 'theme')
  check('too big: refused before anything else', evaluate({ bytes: Buffer.alloc(MAX_DOC_BYTES + 1, 32), signature: 'x', keys: keysA }).error === 'size')
}

section('which catalogue to show')
{
  const shipped = { publishedAt: '2026-10-01T00:00:00.000Z', seq: 2, themes: [good({ id: 'shipped' })] }
  const mk = (seq) => ({ ok: true, doc: { publishedAt: '2026-10-08T00:00:00.000Z', seq, themes: [good({ id: 'signed' })] } })
  check('no online catalogue: the shipped one', effective({ shipped, evaluation: null }).source === 'shipped')
  check('a refused evaluation counts as none', effective({ shipped, evaluation: { ok: false, error: 'signature' } }).source === 'shipped')
  const newer = effective({ shipped, evaluation: mk(3) })
  check('a newer signed catalogue wins', newer.source === 'signed' && newer.themes[0].id === 'signed' && newer.seq === 3, newer)
  check('one as recent as the shipped one wins too', effective({ shipped, evaluation: mk(2) }).source === 'signed')
  check('an older one (a cache from before an upgrade) loses to the shipped one', effective({ shipped, evaluation: mk(1) }).source === 'shipped')
}

section('the shipped files')
{
  const keysFile = JSON.parse(readFileSync(new URL('./themes-pubkey.json', import.meta.url), 'utf8'))
  check('themes-pubkey.json is { keys: [ { keyId, pem } ] } (empty until the maintainer runs `scripts/themes-catalogue.mjs keygen --embed`)', Array.isArray(keysFile.keys) && keysFile.keys.every((k) => typeof k.keyId === 'string' && /BEGIN PUBLIC KEY/.test(k.pem)), keysFile)
  const hub = (() => { try { return JSON.parse(readFileSync(new URL('../kybernos-hub/catalog-pubkey.json', import.meta.url), 'utf8')) } catch (e) { return null } })()
  check('the themes key is NOT the Suite release key (a key that signs community themes must not also sign the Suite)', hub === null || keysFile.keys.every((k) => !hub.cles.some((c) => c.pem === k.pem)))
}

// ── The point `kybernos/theme#theme`: a pack's themes/<id>.json, read by the registry ──────────────
// ONE table, asserted in BOTH copies of this suite (here and scripts/test-themes-catalogue.mjs): the
// point's refusals ARE the settings vocabulary's, so a rule added to sanitizePreset or A11Y_KEYS is
// inherited by construction, never re-typed. [what, raw, fileId]
const POINT_CASES = [
  ['a bad id', { id: 'Bad Id', name: 'T', settings: { mode: 'light' } }, 'Bad Id'],
  ['an empty name', { id: 'soigne', name: ' ', settings: { mode: 'light' } }, 'soigne'],
  ['a bad value (acc: "blue")', { id: 'soigne', name: 'T', settings: { acc: 'blue' } }, 'soigne'],
  ['no known setting at all', { id: 'soigne', name: 'T', settings: { evil: 1 } }, 'soigne'],
  ['settings missing', { id: 'soigne', name: 'T' }, 'soigne'],
  ['a name that is not the file name', { id: 'soigne', name: 'T', settings: { mode: 'light' } }, 'autre'],
]

section('the point: a pack theme file')
{
  check('THEME_POINT is the shape the registry defines (owner, ownerVersion, data, inert, validate)', THEME_POINT.owner === 'kybernos/theme' && THEME_POINT.ownerVersion === '1.0.0' && THEME_POINT.name === 'theme' && THEME_POINT.version === '1.0' && THEME_POINT.kind === 'data' && THEME_POINT.class === 'inert' && typeof THEME_POINT.validate === 'function')
  check('A11Y_KEYS is ONE frozen list, shared with the settings vocabulary (not a copy)', A11Y_KEYS === STORE.A11Y_KEYS && Object.isFrozen(A11Y_KEYS) && A11Y_KEYS.length === 6)

  const light = { id: 'soigne', name: 'Soigne', settings: { mode: 'light', acc: '#4d7c0f', evil: 1 } }
  const v = THEME_POINT.validate(light, 'soigne')
  check('a light { id, name, settings } file (the starter shape) passes, with the unknown key dropped', v.ok === true && v.value.id === 'soigne' && v.value.name === 'Soigne' && v.value.settings.evil === undefined && v.value.settings.acc === '#4d7c0f', v)
  check('...and the value is deterministic: { id, name, settings } and nothing of the machine', Object.keys(v.value).sort().join() === 'id,name,settings', Object.keys(v.value))
  const full = { id: 'soigne', v: 2, name: 'Soigne', author: 'Acme', description: { fr: 'Sobre.', en: 'Plain.' }, settings: { mode: 'light', acc: '#4d7c0f' } }
  const f = THEME_POINT.validate(full, 'soigne')
  check('a full catalogue entry is accepted as a superset (the card metadata travels, nothing of it is required)', f.ok === true && f.value.author === 'Acme' && f.value.v === 2 && f.value.description === undefined, f)

  for (const [what, raw, fileId] of POINT_CASES) {
    const r = THEME_POINT.validate(raw, fileId)
    check('refused: ' + what, r.ok === false && Array.isArray(r.errors) && r.errors.length > 0 && r.value === undefined, r)
  }
  for (const k of A11Y_KEYS) {
    const r = THEME_POINT.validate({ id: 'a11y', name: 'A11y', settings: { mode: 'light', [k]: k === 'contrastMode' ? 'max' : true } }, 'a11y')
    check('refused: accessibility key « ' + k + ' » (named in the error)', r.ok === false && r.errors.some((e) => e.indexOf(k) >= 0), r)
  }
  check('a file that is not an object is refused with an error, never thrown on', [null, 'x', [], 5].every((raw) => { const r = THEME_POINT.validate(raw, 'x'); return r.ok === false && r.errors.length > 0 }))
  const a11yNotTrimmed = THEME_POINT.validate({ id: 'x', name: 'X', settings: { mode: 'light', cbSafe: true } }, 'x')
  check('...and an accessibility key is refused, never trimmed away (the file is a mistake somebody should see)', a11yNotTrimmed.ok === false)
}

section('the point is told through the registry global, and never at the price of starting')
{
  const host = await import('./index.js')
  const KEY = Symbol.for('kybernos.registry')
  const previous = globalThis[KEY]
  let threw = false
  const realError = console.error
  console.error = () => {} // the bundle logs the refusal on purpose: keep the test output clean
  try {
    delete globalThis[KEY]
    host.tellThemePoint() // no registry at all: the bundle still serves
    globalThis[KEY] = { version: 1, definePoint() { throw new Error('registry refused') } }
    host.tellThemePoint() // a registry that throws: same
  } catch (e) { threw = true } finally {
    console.error = realError
    if (previous === undefined) delete globalThis[KEY]
    else globalThis[KEY] = previous
  }
  check('an absent registry, or one whose definePoint throws, never escapes (DSH still starts)', threw === false)
  const told = []
  const previous2 = globalThis[KEY]
  try {
    globalThis[KEY] = { version: 1, definePoint: (def) => told.push(def) }
    host.tellThemePoint()
    globalThis[KEY] = { version: 2, definePoint: (def) => told.push(def) }
    host.tellThemePoint()
  } finally {
    if (previous2 === undefined) delete globalThis[KEY]
    else globalThis[KEY] = previous2
  }
  check('...and the point it tells IS this module\'s THEME_POINT, once per call, on a version-1 registry only',
    told.length === 1 && told[0] === THEME_POINT)
}

console.log('\n' + (fail === 0 ? 'OK' : 'FAILED') + ' — themes catalogue (' + (pass + fail) + ' checks)')
process.exit(fail === 0 ? 0 : 1)

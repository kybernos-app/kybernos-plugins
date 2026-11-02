#!/usr/bin/env node
// The on-disk theme library (preset-store.mjs) on a temp folder, no DSH, no network.
//
//   node test-preset-store.mjs
//
// What is pinned here:
//  - a preset is data: unknown keys are dropped, odd values are refused, nothing else gets in;
//  - the library is one document: duplicates and overflow are dropped and counted, a clock
//    that jumped ahead cannot make a copy win for ever;
//  - a damaged, oversized or foreign file is set aside and counts as absent, never a 5xx;
//  - writes are atomic (tmp + rename) and the route guards its origin like the other routes.
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  FILE_NAME, LIB_VERSION, LIMITS, MAX_BODY_BYTES, SETTINGS_KEYS,
  createPresetStore, handlePresetStore, sanitizeLibrary, sanitizePreset, servePresetStore,
} from './preset-store.mjs'

let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) }
}
const section = (title) => console.log('\n' + title)

const tmp = () => mkdtempSync(join(tmpdir(), 'kb-presets-'))
const good = (over = {}) => ({ id: 'u-abc123', name: 'Bureau clair', source: 'me', at: 1000, settings: { mode: 'light', acc: '#0EA5E9', ov: { 'light:base': '#F6F7F8' }, fontText: 'inter', radius: 'soft' }, ...over })

section('one preset: only known settings, only plain values')
{
  const v = sanitizePreset(good())
  check('a valid preset is accepted unchanged', v.ok === true && v.preset.name === 'Bureau clair' && v.preset.settings.radius === 'soft' && v.preset.settings.ov['light:base'] === '#F6F7F8', v)
  const extra = sanitizePreset(good({ settings: { mode: 'dark', acc: null, evil: 'x', skin: 'custom', fs: 15 } }))
  check('unknown keys are dropped (skin and text size are not part of a theme)', extra.ok === true && Object.keys(extra.preset.settings).sort().join() === 'acc,mode', extra)
  check('the accent may be null ("the theme’s own")', sanitizePreset(good({ settings: { acc: null } })).ok === true)
  check('a bad id is refused', sanitizePreset(good({ id: '../x' })).ok === false && sanitizePreset(good({ id: 'U-1' })).ok === false && sanitizePreset(good({ id: '' })).ok === false)
  check('an empty or oversized name is refused', sanitizePreset(good({ name: '   ' })).ok === false && sanitizePreset(good({ name: 'x'.repeat(LIMITS.name + 1) })).ok === false)
  const ctrl = sanitizePreset(good({ name: 'Bu\u0000reau\n clair\u2028' }))
  check('control characters in a name become spaces', ctrl.ok === true && ctrl.preset.name === 'Bu reau clair', ctrl)
  check('a bad hex colour is refused', sanitizePreset(good({ settings: { acc: 'red' } })).ok === false && sanitizePreset(good({ settings: { ov: { 'light:base': 'url(x)' } } })).ok === false)
  check('a colour override key must look like scheme:token', sanitizePreset(good({ settings: { ov: { 'x:base': '#FFFFFF' } } })).ok === false && sanitizePreset(good({ settings: { ov: JSON.parse('{"__proto__":"#FFFFFF"}') } })).ok === false)
  check('a nested object or array as a value is refused', sanitizePreset(good({ settings: { radius: { a: 1 } } })).ok === false && sanitizePreset(good({ settings: { radius: ['soft'] } })).ok === false)
  check('a string that is not a plain token is refused (no urls, no spaces)', sanitizePreset(good({ settings: { fontText: 'http://x.test/a.woff' } })).ok === false && sanitizePreset(good({ settings: { fontText: 'a b' } })).ok === false)
  check('NaN and Infinity are refused', sanitizePreset(good({ settings: { wpVis: NaN } })).ok === false && sanitizePreset(good({ settings: { wpVis: Infinity } })).ok === false)
  check('no known settings at all is refused', sanitizePreset(good({ settings: { evil: 1 } })).ok === false && sanitizePreset(good({ settings: {} })).ok === false)
  check('not an object is refused', sanitizePreset(null).ok === false && sanitizePreset('x').ok === false && sanitizePreset([]).ok === false)
  check('source falls back to "file"; author, gid and v are kept only when valid',
    sanitizePreset(good({ source: 'hax' })).preset.source === 'file'
    && sanitizePreset(good({ author: ' Ann ', gid: 'encre', v: 3 })).preset.author === 'Ann'
    && sanitizePreset(good({ gid: '../../x' })).preset.gid === undefined
    && sanitizePreset(good({ v: -1 })).preset.v === undefined)
  const proto = JSON.parse('{"id":"u-p","name":"P","settings":{"__proto__":{"mode":"dark"},"mode":"light"}}')
  const p2 = sanitizePreset(proto)
  check('a __proto__ key in the settings does not pollute anything', p2.ok === true && ({}).mode === undefined && p2.preset.settings.mode === 'light', p2)
  check('SETTINGS_KEYS has no duplicates', new Set(SETTINGS_KEYS).size === SETTINGS_KEYS.length)
}

section('the whole library')
{
  const a = good({ id: 'u-a' })
  const b = good({ id: 'u-b', name: 'Nuit' })
  const lib = sanitizeLibrary({ presets: [a, b, a, { id: 'bad id', name: 'x', settings: { mode: 'dark' } }], updatedAt: 5 }, () => 10)
  check('duplicates and bad presets are dropped and counted', lib.ok === true && lib.library.presets.length === 2 && lib.dropped === 2, lib)
  check('the order is kept', lib.library.presets.map((p) => p.id).join() === 'u-a,u-b')
  check('the version is stamped', lib.library.v === LIB_VERSION)
  const many = Array.from({ length: LIMITS.presets + 5 }, (_, i) => good({ id: 'u-' + i }))
  const capped = sanitizeLibrary({ presets: many, updatedAt: 1 })
  check('at most ' + LIMITS.presets + ' presets', capped.library.presets.length === LIMITS.presets && capped.dropped === 5, capped.dropped)
  const ahead = sanitizeLibrary({ presets: [a], updatedAt: 9e15 }, () => 1000)
  check('an updatedAt far in the future is clamped to a day ahead', ahead.library.updatedAt === 1000 + 24 * 3600 * 1000, ahead.library.updatedAt)
  check('a missing or odd updatedAt becomes 0', sanitizeLibrary({ presets: [a] }).library.updatedAt === 0 && sanitizeLibrary({ presets: [a], updatedAt: 'x' }).library.updatedAt === 0)
  check('not a library is refused', sanitizeLibrary(null).ok === false && sanitizeLibrary({}).ok === false && sanitizeLibrary({ presets: 'x' }).ok === false)
}

section('the file')
{
  const dir = tmp()
  const store = createPresetStore({ dir, now: () => 777 })
  check('no file yet: read is ok and empty', JSON.stringify(store.read()) === '{"ok":true,"library":null}')
  const w = store.write({ presets: [good()], updatedAt: 500 })
  check('write is ok and reports what it kept', w.ok === true && w.library.presets.length === 1 && w.dropped === 0, w)
  check('the file lands in <dir>/' + FILE_NAME, existsSync(join(dir, FILE_NAME)))
  check('no .tmp file is left behind', readdirSync(dir).every((n) => !n.endsWith('.tmp')), readdirSync(dir))
  const r = store.read()
  check('read gives back what was written', r.ok === true && r.library.updatedAt === 500 && r.library.presets[0].name === 'Bureau clair', r)
  check('the file is human-readable JSON', /\n  "presets"/.test(readFileSync(join(dir, FILE_NAME), 'utf8')))
  check('write refuses a library that is not one and keeps the old file', store.write({ nope: 1 }).ok === false && store.read().library.presets.length === 1)

  writeFileSync(join(dir, FILE_NAME), '{ not json')
  const dmg = store.read()
  check('a damaged file counts as absent', dmg.ok === true && dmg.library === null && dmg.setAside === 'damaged JSON', dmg)
  check('...and is set aside, not deleted', readdirSync(dir).some((n) => n.startsWith(FILE_NAME + '.bad-')), readdirSync(dir))

  writeFileSync(join(dir, FILE_NAME), JSON.stringify({ hello: 'world' }))
  check('valid JSON that is not a library is set aside too', store.read().library === null && !existsSync(join(dir, FILE_NAME)))

  writeFileSync(join(dir, FILE_NAME), JSON.stringify({ presets: [good(), { id: 'x y', name: 'bad', settings: {} }], updatedAt: 3 }))
  const half = store.read()
  check('a file with one bad preset keeps the good one and says so', half.library.presets.length === 1 && half.dropped === 1, half)

  writeFileSync(join(dir, FILE_NAME), 'x'.repeat(LIMITS.fileBytes + 10))
  const big = store.read()
  check('an oversized file is set aside unread', big.library === null && big.setAside === 'too large', big)

  const worst = store.write({ presets: Array.from({ length: LIMITS.presets }, (_, i) => good({ id: 'u-' + i, name: 'n'.repeat(LIMITS.name), settings: { mode: 'dark', ov: Object.fromEntries(Array.from({ length: LIMITS.ov }, (_, k) => ['light:t' + k, '#FFFFFF'])) } })), updatedAt: 1 })
  check('even a full library of full presets stays under the file cap', worst.ok === true && readFileSync(join(dir, FILE_NAME)).length < LIMITS.fileBytes, worst.ok)
  rmSync(dir, { recursive: true, force: true })
}

section('the request handler')
{
  const dir = tmp()
  const store = createPresetStore({ dir })
  check('GET answers 200 with the read result', handlePresetStore(store, { method: 'GET' }).status === 200)
  const post = handlePresetStore(store, { method: 'POST', body: { library: { presets: [good()], updatedAt: 1 } } })
  check('POST { library } stores it', post.status === 200 && post.body.ok === true && store.read().library.presets.length === 1, post)
  check('POST without a library is a 400', handlePresetStore(store, { method: 'POST', body: {} }).status === 400 && handlePresetStore(store, { method: 'POST', body: null }).status === 400)
  check('POST with a library that is not one is a 400', handlePresetStore(store, { method: 'POST', body: { library: { presets: 5 } } }).status === 400)
  check('DELETE is a 405', handlePresetStore(store, { method: 'DELETE' }).status === 405)
  rmSync(dir, { recursive: true, force: true })
}

section('the route')
{
  const home = tmp()
  const sent = []
  const io = (over = {}) => ({
    home: async () => home,
    sameOriginStrict: (req) => req.origin === 'self',
    sameOriginLax: (req) => req.origin === undefined || req.origin === 'self',
    readJson: async (req) => req.body,
    send: (res, status, body) => { sent.push({ status, body }); return status },
    ...over,
  })
  const call = async (req, ioOver) => { sent.length = 0; await servePresetStore(req, {}, io(ioOver)); return sent[0] }
  check('GET with no Origin is allowed (direct navigation)', (await call({ method: 'GET' })).status === 200)
  check('GET from a foreign origin is refused', (await call({ method: 'GET', origin: 'evil' })).status === 403)
  check('POST needs the strict same origin', (await call({ method: 'POST', origin: undefined, body: { library: { presets: [good()] } } })).status === 403)
  const ok = await call({ method: 'POST', origin: 'self', body: { library: { presets: [good()], updatedAt: 9 } } })
  check('POST from the page is stored under <home>/kybernos', ok.status === 200 && existsSync(join(home, 'kybernos', FILE_NAME)), ok)
  check('GET then gives it back', (await call({ method: 'GET' })).body.library.presets[0].id === 'u-abc123')
  check('an oversized body is a 413', (await call({ method: 'POST', origin: 'self' }, { readJson: async () => { throw new Error('too big') } })).status === 413)
  check('no DSH home is an ok:false answer, not a crash', (await call({ method: 'GET' }, { home: async () => null })).body.ok === false)
  check('a host fault never escapes as an exception', (await call({ method: 'GET' }, { home: async () => { throw new Error('boom') } })).status === 500)
  check('the body limit is declared', MAX_BODY_BYTES >= LIMITS.fileBytes)
  rmSync(home, { recursive: true, force: true })
}

console.log('\n' + (fail === 0 ? 'OK' : 'FAILED') + ' — preset store (' + (pass + fail) + ' checks)')
process.exit(fail === 0 ? 0 : 1)

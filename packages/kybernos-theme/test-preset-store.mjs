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
  A11Y_KEYS, FILE_NAME, LIB_VERSION, LIMITS, MAX_BODY_BYTES, SETTINGS_KEYS,
  MENU_ID_RE, MENU_LIMITS, MENU_NEVER, MENU_SURFACES, SOURCES, menuHasContent, applyPreset, createPresetStore, handlePresetStore, sanitizeLibrary, sanitizeMenu, sanitizePreset, servePresetStore,
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

section('an import through the host entry (applyPreset)')
{
  const dir = tmp()
  const now = () => 5000
  const store = createPresetStore({ dir, now })
  const one = applyPreset(store, { name: 'Soigne', settings: { acc: '#4d7c0f', evil: 1 } })
  check('a good import answers { ok, id, preset } and drops what it does not know',
    one.ok === true && one.id === 'soigne' && one.preset.settings.evil === undefined && one.preset.settings.acc === '#4d7c0f', one)
  check('...and writes ONE record on the disk', store.read().library.presets.length === 1 && store.read().library.presets[0].id === 'soigne')

  const before = JSON.stringify(store.read().library)
  for (const k of A11Y_KEYS) {
    const r = applyPreset(store, { name: 'A11y ' + k, settings: { acc: '#112233', [k]: k === 'contrastMode' ? 'max' : true } })
    check('accessibility key « ' + k + ' » is refused, and names it', r.ok === false && r.error === 'accessibility setting: ' + k, r)
  }
  check('...and a refused import writes nothing at all', JSON.stringify(store.read().library) === before)

  const again = applyPreset(store, { name: 'Soigne', settings: { acc: '#4d7c0f' } })
  const ids = store.read().library.presets.map((p) => p.id)
  check('the same import twice: same id, exactly one record, no duplicate', again.ok === true && again.id === one.id && ids.filter((i) => i === one.id).length === 1 && ids.length === 1, ids)

  const named = applyPreset(store, { id: 'encre', name: 'Whatever', settings: { mode: 'light' }, source: 'gallery', gid: 'encre-papier', v: 2, author: 'Kybernos' })
  check('an id the caller names is the identity (a gallery import keeps its catalogue link)', named.ok === true && named.id === 'encre' && named.preset.gid === 'encre-papier' && named.preset.source === 'gallery' && named.preset.v === 2 && named.preset.author === 'Kybernos', named)
  const badId = applyPreset(store, { id: '../x', name: 'Été clair', settings: { mode: 'dark' } })
  check('an unusable id falls back to the slug of the name', badId.ok === true && badId.id === 'ete-clair', badId)

  // The person's own theme is never replaced: a name collision gives a free name and a suffixed id (A1-1).
  const mine = sanitizePreset(good({ id: 'u-mine', name: 'Soigné', source: 'me' })).preset
  store.write({ presets: [mine], updatedAt: 100 })
  const frozen = JSON.stringify(store.read().library.presets.find((p) => p.id === 'u-mine'))
  const collided = applyPreset(store, { name: 'Soigné', settings: { acc: '#abcdef' } })
  const afterCollision = store.read().library.presets
  check('a name already taken by another record still applies, under a free name and a suffixed id',
    collided.ok === true && collided.id === 'soigne-2' && collided.preset.name === 'Soigné (2)' && collided.preset.settings.acc === '#abcdef', collided)
  check('...the person\'s own record is untouched, byte for byte', JSON.stringify(afterCollision.find((p) => p.id === 'u-mine')) === frozen)
  const collidedAgain = applyPreset(store, { name: 'Soigné', settings: { acc: '#abcdef' } })
  check('...and the same collision imported twice stays one record (the suffix is not a second idempotence rule)',
    collidedAgain.ok === true && collidedAgain.id === collided.id && store.read().library.presets.filter((p) => p.name.indexOf('Soigné') === 0).length === 2, store.read().library.presets.map((p) => p.id + ':' + p.name))
  check('no two records share an id', new Set(store.read().library.presets.map((p) => p.id)).size === store.read().library.presets.length)

  // A1-1's literal rule, over every id shape: « the `me` record is never touched (byte for byte) », and an import
  // only ever names a record it created. The old test narrowed this to « a different id », which is how F-41 shipped.
  {
    const cases = []
    for (const id of ['soigne', 'u-mine', 'x-1', 'a']) {
      cases.push({ id, input: { name: 'Soigne', settings: { acc: '#abcdef' } } })
      cases.push({ id, input: { id, name: 'Soigne', settings: { acc: '#abcdef' } } })
      cases.push({ id, input: { id, name: 'Autre', settings: { acc: '#abcdef' } } })
    }
    let untouched = 0
    let isolated = 0
    for (const c of cases) {
      const caseDir = tmp()
      const caseStore = createPresetStore({ dir: caseDir, now: () => 5000 })
      caseStore.write({ presets: [good({ id: c.id, name: 'Soigne', source: 'me', settings: { acc: '#000001' } })], updatedAt: 100 })
      const record = () => JSON.stringify(caseStore.read().library.presets.find((p) => p.id === c.id))
      const frozen = record()
      const answer = applyPreset(caseStore, c.input)
      const after = caseStore.read().library.presets
      if (record() === frozen) untouched += 1
      if (answer.ok !== true || (answer.id !== c.id && after.length === 2)) isolated += 1
      rmSync(caseDir, { recursive: true, force: true })
    }
    check('a me record is untouched, byte for byte, whatever id an import names (' + cases.length + ' cases)', untouched === cases.length, { untouched, cases: cases.length })
    check('...and the import lands on a record of its own (or refuses), never on the person\'s', isolated === cases.length, { isolated, cases: cases.length })
  }
  // F-42: the suffixed-id walk may only find a record the import itself created — never a stranger at that id.
  {
    const strangerDir = tmp()
    const strangerStore = createPresetStore({ dir: strangerDir, now: () => 5000 })
    strangerStore.write({
      presets: [
        good({ id: 'u-mine', name: 'Soigne', source: 'me', settings: { acc: '#000001' } }),
        good({ id: 'soigne-2', name: 'Cabinet', source: 'gallery', gid: 'cab', v: 3, settings: { acc: '#123456' } }),
      ],
      updatedAt: 100,
    })
    const before = JSON.stringify(strangerStore.read().library.presets.find((p) => p.id === 'soigne-2'))
    const answer = applyPreset(strangerStore, { name: 'Soigne', settings: { acc: '#abcdef' } })
    const cabinet = strangerStore.read().library.presets.find((p) => p.id === 'soigne-2')
    check('a suffixed-id collision never rewrites a record of another name (its gid and v survive)',
      JSON.stringify(cabinet) === before && cabinet.gid === 'cab' && cabinet.v === 3, cabinet)
    check('...the import answers its own name, and lands a record of its own',
      answer.ok === true && answer.preset.name.indexOf('Soigne') === 0 && answer.preset.name !== 'Cabinet' && answer.id !== 'soigne-2', answer)
    rmSync(strangerDir, { recursive: true, force: true })
  }

  const routed = handlePresetStore(store, { method: 'POST', body: { import: { name: 'Route', settings: { acc: '#112233' } } } })
  check('POST { import } is the same entry, answered 200 { ok, preset }', routed.status === 200 && routed.body.ok === true && routed.body.preset.settings.acc === '#112233', routed)
  const refused = handlePresetStore(store, { method: 'POST', body: { import: { name: 'Route', settings: { cbSafe: true } } } })
  check('...and an accessibility key through the route is a 400', refused.status === 400 && refused.body.ok === false, refused)

  // A real clock: the store clamps a future updatedAt, so a stubbed one cannot show the move.
  const liveDir = tmp()
  const live = createPresetStore({ dir: liveDir })
  applyPreset(live, { name: 'Un', settings: { mode: 'dark' } })
  const c1 = live.read().library.updatedAt
  applyPreset(live, { name: 'Deux', settings: { mode: 'light' } })
  const c2 = live.read().library.updatedAt
  check('updatedAt moves forward on every import (two imports in the same millisecond included)', c2 > c1 && c1 > 0, [c1, c2])
  rmSync(liveDir, { recursive: true, force: true })

  store.write({ presets: Array.from({ length: LIMITS.presets }, (_, i) => good({ id: 'u-' + i, name: 'n' + i })), updatedAt: 1 })
  const full = applyPreset(store, { name: 'One too many', settings: { acc: '#112233' } })
  check('a full library refuses the import ("library full") and evicts nothing', full.ok === false && full.error === 'library full' && store.read().library.presets.length === LIMITS.presets, full)

  check('an import that is not an object is refused, not thrown on', applyPreset(store, null).ok === false && applyPreset(store, 'x').ok === false && applyPreset(store, { name: 'No settings' }).ok === false && applyPreset(store, { name: ' ', settings: { mode: 'dark' } }).ok === false)
  const boom = { read() { throw new Error('boom') }, write() { throw new Error('boom') } }
  const crashed = applyPreset(boom, { name: 'X', settings: { acc: '#112233' } })
  check('a throwing store becomes { ok:false, error } (the seam never throws)', crashed.ok === false && typeof crashed.error === 'string', crashed)

  const both = handlePresetStore(store, { method: 'POST', body: { import: { name: 'x', settings: { acc: '#112233' } }, library: { presets: [] } } })
  const neither = handlePresetStore(store, { method: 'POST', body: { hello: 1 } })
  check('one body, one intention: import + library (or neither) is a 400 « invalid body »', both.status === 400 && both.body.error === 'invalid body' && neither.status === 400 && neither.body.error === 'invalid body', [both, neither])
  check('the whole-document write still replaces the library', handlePresetStore(store, { method: 'POST', body: { library: { presets: [good({ id: 'u-only' })], updatedAt: 3 } } }).status === 200 && store.read().library.presets.length === 1)
  rmSync(dir, { recursive: true, force: true })
}

section('the menu arrangement (docs/dev/business-menu.md §4): one shape, the vectors every sanitizer agrees on')
{
  // The same vectors are pinned in kybernos-plugin (kbMenuPrefsClean) and in this package's client.js (menuClean).
  const m1 = sanitizeMenu({ entries: [{ id: 'skills', shown: false, order: 5 }, { id: 'kyber', shown: true, order: 0 }], unlisted: 'hide' })
  check('entries are sorted by order and renumbered 0..n-1', JSON.stringify(m1) === JSON.stringify({ entries: [{ id: 'kyber', shown: true, order: 0 }, { id: 'skills', shown: false, order: 1 }], unlisted: 'hide', locked: false }), m1)
  const refused = ['workspaces', 'settings', 'account', 'projects', 'Kyber', 'a', 'x'.repeat(25)]
  check('the host rows, capitals, one letter and a 25-character id are never stored', refused.every((id) => sanitizeMenu({ entries: [{ id, shown: true }] }).entries.length === 0), refused)
  check('the never-hide list is exactly the host rows', JSON.stringify(MENU_NEVER) === JSON.stringify(['workspaces', 'projects', 'settings', 'account']))
  check('a duplicate id keeps the first', JSON.stringify(sanitizeMenu({ entries: [{ id: 'kyber', shown: true }, { id: 'kyber', shown: false }] }).entries) === JSON.stringify([{ id: 'kyber', shown: true, order: 0 }]))
  const lab = sanitizeMenu({ entries: [{ id: 'skills', shown: true, label: { en: '  Skills  ', fr: '', de: 'x', es: '<b>' } }] })
  check('labels: tidied, empty / unknown language / angle brackets dropped', JSON.stringify(lab.entries[0].label) === JSON.stringify({ en: 'Skills' }), lab)
  check('a label of 41 characters loses that language', sanitizeMenu({ entries: [{ id: 'skills', shown: true, label: { en: 'x'.repeat(MENU_LIMITS.label + 1), fr: 'Compétences' } }] }).entries[0].label.fr === 'Compétences'
    && sanitizeMenu({ entries: [{ id: 'skills', shown: true, label: { en: 'x'.repeat(MENU_LIMITS.label + 1) } }] }).entries[0].label === undefined)
  const many = Array.from({ length: 25 }, (_, i) => ({ id: 'row-' + i, shown: true }))
  const cut = sanitizeMenu({ entries: many })
  check('at most 24 entries, the first 24', cut.entries.length === MENU_LIMITS.entries && cut.entries[23].id === 'row-23', cut.entries.length)
  const odd = sanitizeMenu({ entries: [{ id: 'kyber', shown: true }], unlisted: 'x', locked: 'yes' })
  check('unlisted defaults to show and locked to false', odd.unlisted === 'show' && odd.locked === false, odd)
  check('locked is true only for the boolean true', sanitizeMenu({ entries: [], locked: true }).locked === true)
  check('entries that is not an array, or a non-object, is no menu', sanitizeMenu({ entries: 'x' }) === null && sanitizeMenu(null) === null && sanitizeMenu([]) === null && sanitizeMenu('x') === null && sanitizeMenu({}) === null)
  check('an entry without a boolean shown is dropped; a non-integer order falls back to the position', sanitizeMenu({ entries: [{ id: 'kyber' }, { id: 'skills', shown: true, order: 1.5 }, { id: 'tasks', shown: true, order: 100 }] }).entries.map((e) => e.id + ':' + e.order).join() === 'skills:0,tasks:1')
  check('the vocabulary matches the menu id rule', MENU_ID_RE.test('front-desk') && !MENU_ID_RE.test('front desk'))
  check('a hostile object cannot pollute anything', (() => { sanitizeMenu(JSON.parse('{"entries":[{"id":"kyber","shown":true,"__proto__":{"x":1}}],"__proto__":{"y":2}}')); return ({}).x === undefined && ({}).y === undefined })())
}

section('the account menu and the Settings pages (surfaces) of a menu')
{
  const E = (id, shown, order) => (order === undefined ? { id, shown } : { id, shown, order })
  const m = (surfaces, entries = [E('kyber', true)]) => sanitizeMenu({ entries, unlisted: 'show', surfaces })
  check('the two surfaces are the account menu and the Settings pages, and nothing else', Object.keys(MENU_SURFACES).join() === 'secondary,settings' && Object.isFrozen(MENU_SURFACES) && Object.isFrozen(MENU_SURFACES.secondary.never))
  check('what can never be hidden: the account, the referral, Settings and the sign-out in the account menu; General in Settings', MENU_SURFACES.secondary.never.join() === 'account,referral,settings,logout' && MENU_SURFACES.settings.never.join() === 'general')
  check('a menu with no surfaces has no `surfaces` key (a document from before reads exactly as it did)', !('surfaces' in sanitizeMenu({ entries: [E('kyber', true)] })) && JSON.stringify(sanitizeMenu({ entries: [E('kyber', true, 0)] })) === JSON.stringify({ entries: [{ id: 'kyber', shown: true, order: 0 }], unlisted: 'show', locked: false }))
  const a = m({ secondary: { entries: [E('feedback', false, 1), E('help', true, 0)], unlisted: 'hide' }, settings: { entries: [E('memory', false)], unlisted: 'show' } })
  check('a surface keeps its entries, sorted and renumbered, and its `unlisted`', JSON.stringify(a.surfaces.secondary) === JSON.stringify({ entries: [{ id: 'help', shown: true, order: 0 }, { id: 'feedback', shown: false, order: 1 }], unlisted: 'hide' }) && a.surfaces.settings.entries[0].id === 'memory', a)
  check('the key order is the same every time (entries, unlisted, locked, then surfaces: secondary then settings)', Object.keys(a).join() === 'entries,unlisted,locked,surfaces' && Object.keys(a.surfaces).join() === 'secondary,settings')
  check('a surface carries no label (only the main menu can rename)', m({ secondary: { entries: [{ id: 'help', shown: true, label: { en: 'Aide' } }], unlisted: 'show' } }).surfaces.secondary.entries[0].label === undefined)
  const never = m({ secondary: { entries: MENU_SURFACES.secondary.never.map((id) => E(id, false)).concat([E('help', false)]), unlisted: 'show' }, settings: { entries: [E('general', false), E('memory', false)], unlisted: 'show' } })
  check('the never-hideable ids are not stored on their surface, the rest of the surface is', never.surfaces.secondary.entries.map((e) => e.id).join() === 'help' && never.surfaces.settings.entries.map((e) => e.id).join() === 'memory', never)
  check('the account menu\'s never-list does not bind the Settings pages, nor the reverse', m({ settings: { entries: [E('account', false), E('referral', false)], unlisted: 'show' } }).surfaces.settings.entries.length === 2 && m({ secondary: { entries: [E('general', false)], unlisted: 'show' } }).surfaces.secondary.entries.length === 1)
  check('a surface that says nothing (no entry, « show ») is left out; with « hide » it stays', m({ secondary: { entries: [], unlisted: 'show' } }).surfaces === undefined && m({ secondary: { entries: [], unlisted: 'hide' } }).surfaces.secondary.unlisted === 'hide' && m({ secondary: { entries: [E('account', false)], unlisted: 'show' } }).surfaces === undefined)
  check('an unknown surface name is dropped', m({ drawer: { entries: [E('x', true)], unlisted: 'hide' } }).surfaces === undefined && m({ secondary: { entries: [E('help', true)], unlisted: 'show' }, drawer: { entries: [E('x', true)] } }).surfaces.drawer === undefined)
  check('a surface that is not an object, or has no entries array, is dropped', ['x', 5, null, [], { entries: 'x' }, {}].every((v) => m({ secondary: v }).surfaces === undefined) && m('x').surfaces === undefined && m(null).surfaces === undefined && m([]).surfaces === undefined)
  check('on a surface too: capitals, a bad id, a duplicate (first wins) and a non-boolean shown are dropped; a bad order falls back to the position', JSON.stringify(m({ settings: { entries: [E('Memory', false), E('a b', false), E('memory', false), E('memory', true), { id: 'skills' }, E('tasks', true, 1.5), E('hooks', true, 100)], unlisted: 'show' } }).surfaces.settings.entries) === JSON.stringify([{ id: 'memory', shown: false, order: 0 }, { id: 'tasks', shown: true, order: 1 }, { id: 'hooks', shown: true, order: 2 }]))
  check('a surface holds at most its bound (24 for the account menu, 64 for the Settings pages)', m({ secondary: { entries: Array.from({ length: 40 }, (_, i) => E('item' + i, false)), unlisted: 'show' } }).surfaces.secondary.entries.length === 24 && m({ settings: { entries: Array.from({ length: 90 }, (_, i) => E('page' + i, false)), unlisted: 'show' } }).surfaces.settings.entries.length === 64)
  check('cleaning twice gives the same document (idempotent)', JSON.stringify(sanitizeMenu(a)) === JSON.stringify(a) && JSON.stringify(sanitizeMenu(JSON.parse(JSON.stringify(a)))) === JSON.stringify(a))
  check('a hostile surfaces object cannot pollute anything, nor its `__proto__` become a surface', (() => { const r = sanitizeMenu(JSON.parse('{"entries":[{"id":"kyber","shown":true}],"surfaces":{"__proto__":{"entries":[{"id":"x","shown":true}],"unlisted":"hide"},"secondary":{"entries":[{"id":"help","shown":false,"__proto__":{"z":1}}],"unlisted":"show"}}}')); return ({}).z === undefined && Object.keys(r.surfaces).join() === 'secondary' })())
  check('menuHasContent: a main entry, or a surface, counts; an empty menu and null do not', menuHasContent(sanitizeMenu({ entries: [E('kyber', true)] })) === true && menuHasContent(m({ secondary: { entries: [], unlisted: 'hide' } }, [])) === true && menuHasContent(sanitizeMenu({ entries: [] })) === false && menuHasContent(null) === false && menuHasContent(undefined) === false)
  const so = sanitizePreset({ id: 'u-surf1', name: 'Calm', source: 'me', at: 5, menu: { entries: [], surfaces: { settings: { entries: [E('memory', false)], unlisted: 'show' } } } })
  check('a preset whose menu says something only on a surface is a menu-only preset', so.ok === true && so.preset.settings === undefined && so.preset.menu.surfaces.settings.entries[0].id === 'memory', so)
  check('...but a menu that says nothing anywhere is still refused', sanitizePreset({ id: 'u-surf2', name: 'X', menu: { entries: [], surfaces: { secondary: { entries: [E('account', false)], unlisted: 'show' } } } }).ok === false)
  const lib = sanitizeLibrary({ presets: [good()], updatedAt: 3, menu: a })
  check('the library keeps the surfaces of the menu in use, and an older library reads as before', lib.ok === true && JSON.stringify(lib.library.menu) === JSON.stringify(a) && !('surfaces' in sanitizeLibrary({ presets: [good()], menu: { entries: [E('kyber', true)] } }).library.menu))
  const dir = tmp()
  const store = createPresetStore({ dir })
  store.write({ presets: [good()], updatedAt: 10, menu: a })
  check('written then read back, the surfaces are there', JSON.stringify(store.read().library.menu) === JSON.stringify(a), store.read())
  rmSync(dir, { recursive: true, force: true })
}

section('a preset may hold an appearance, a menu, or both')
{
  const menu = { entries: [{ id: 'skills', shown: true }, { id: 'kyber', shown: false, label: { en: 'Home', fr: 'Accueil' } }], unlisted: 'show' }
  const menuOnly = sanitizePreset({ id: 'u-menu1', name: 'Simple', source: 'me', at: 5, menu })
  check('a menu-only preset is accepted (no settings key)', menuOnly.ok === true && menuOnly.preset.settings === undefined && menuOnly.preset.menu.entries.length === 2, menuOnly)
  const both = sanitizePreset(good({ source: 'template', menu }))
  check('a template holds both parts', both.ok === true && both.preset.source === 'template' && both.preset.settings.mode === 'light' && both.preset.menu.entries[1].label.fr === 'Accueil', both)
  check('a menu with no usable entry and no settings is refused', sanitizePreset({ id: 'u-m2', name: 'X', menu: { entries: [{ id: 'settings', shown: false }] } }).ok === false && sanitizePreset({ id: 'u-m2', name: 'X', menu: { entries: [] } }).ok === false)
  const bad = sanitizePreset(good({ menu: 'garbage' }))
  check('a bad menu part is dropped, the appearance stays', bad.ok === true && bad.preset.menu === undefined && bad.preset.settings.mode === 'light', bad)
  check('settings that is not an object is still refused, even next to a menu', sanitizePreset(good({ settings: 'x', menu })).ok === false)
  check('every record of an older library (settings only) is unchanged', JSON.stringify(sanitizePreset(good()).preset) === JSON.stringify(sanitizePreset(good({ menu: undefined })).preset))
  check('"template" is a source, nothing else is new', SOURCES.join() === 'me,file,gallery,template' && sanitizePreset(good({ source: 'hax' })).preset.source === 'file')
}

section('the menu in use travels with the library')
{
  const menu = { entries: [{ id: 'kyber', shown: true }, { id: 'tasks', shown: false }], unlisted: 'hide' }
  const a = sanitizeLibrary({ presets: [good()], updatedAt: 3, menu })
  check('the library keeps a valid menu in use', a.ok === true && a.library.menu.unlisted === 'hide' && a.library.menu.entries.length === 2, a)
  check('no menu, null or garbage: the field is left out (the default menu)', ['', null, 'x', 5, { entries: 'x' }].every((m) => sanitizeLibrary({ presets: [good()], menu: m }).library.menu === undefined))
  check('a library file from before this change reads exactly as it did', JSON.stringify(sanitizeLibrary({ v: 1, updatedAt: 7, presets: [good()] }).library) === JSON.stringify({ v: LIB_VERSION, updatedAt: 7, presets: [sanitizePreset(good()).preset] }))
  const dir = tmp()
  const store = createPresetStore({ dir })
  const w = store.write({ presets: [good()], updatedAt: 10, menu })
  const r = store.read()
  check('written then read back, the menu in use is there', w.ok === true && r.library.menu.entries[1].id === 'tasks' && r.library.menu.entries[1].shown === false, r)
  const imp = applyPreset(store, { name: 'Boutique', settings: { acc: '#C25E0A' }, menu: { entries: [{ id: 'aiteams', shown: true, label: { en: 'Shop team', fr: 'Équipe boutique' } }] }, source: 'template', gid: 'ecommerce' })
  check('an import may bring a menu part and the template source', imp.ok === true && imp.preset.source === 'template' && imp.preset.menu.entries[0].label.en === 'Shop team', imp)
  check('an import never drops the menu in use', store.read().library.menu.unlisted === 'hide', store.read())
  const mo = applyPreset(store, { name: 'Simple', menu: { entries: [{ id: 'skills', shown: true }] } })
  check('a menu-only import is accepted', mo.ok === true && mo.preset.settings === undefined, mo)
  check('an import of nothing is refused', applyPreset(store, { name: 'Nothing' }).ok === false && applyPreset(store, { name: 'Nothing', menu: { entries: [] } }).ok === false)
  check('an accessibility key in the settings of an import is still refused', applyPreset(store, { name: 'A11y', settings: { reduceMotion: true }, menu: { entries: [{ id: 'kyber', shown: true }] } }).ok === false)
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

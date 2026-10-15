#!/usr/bin/env node
/** The Featured tab: the picks Kybernos proposes, the host route that serves them, and what the card does on the screen.
 *
 *  Three layers, none of them on the network or on the user's home:
 *   1. featured-picks.mjs, the pure reader: what it keeps, what it drops, that nothing the file carries beyond its fields travels on;
 *   2. the shipped file featured-picks.json (the 24 picks): every entry valid, both languages written, no security audit in failure;
 *   3. GET /kybernos-skills/picks through apply() on a fake web server and a throw-away DSH home: a cover URL only when its file exists;
 *   4. the client (a browser half), pinned at source level like test-bar.mjs: the card, the hover actions, the install confirmation.
 *
 *  Usage: node packages/kybernos-skills/test-picks.mjs   (exit 0 = all pass) */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const base = mkdtempSync(join(tmpdir(), 'kb-picks-'))
const home = join(base, 'home')
const dsh = join(home, '.dsh')
mkdirSync(join(dsh, 'kybernos', 'skills-featured'), { recursive: true })
process.env.HOME = home
process.env.DSH_HOME = dsh

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }

try {
  const { PICK_CATEGORIES, PICK_NEEDS, pickOf, validatePicks, readPicks } = await import('./featured-picks.mjs')
  console.log('kybernos-skills — the Featured picks')

  // 1. the reader ----------------------------------------------------------------------------------
  const good = {
    id: 'pdf', source: 'anthropics/skills', category: 'Documents',
    title: { en: 'PDF', fr: 'PDF' }, outcome: { en: 'Read PDFs.', fr: 'Lire des PDF.' }, prompt: { en: 'Merge.', fr: 'Fusionne.' },
    needs: null, installs: 211154, audits: [['Socket', 'pass', 'LOW'], ['Snyk', 'warn', 'MEDIUM']]
  }
  assert.deepEqual(pickOf(good), good)
  ok('a well-formed entry is kept as it is')

  const extra = pickOf({ ...good, evil: '<script>', cover: 'http://x/y', __proto__: { polluted: true } })
  assert.deepEqual(Object.keys(extra).sort(), Object.keys(good).sort())
  ok('nothing beyond the known fields travels on (the entry is rebuilt field by field)')

  for (const [label, patch] of [
    ['a name with a path', { id: '../etc' }], ['an upper-case name', { id: 'Pdf' }], ['a source that is not owner/repo', { source: 'https://x.y/z' }],
    ['an unknown category', { category: 'Weapons' }], ['a title missing its French', { title: { en: 'PDF' } }], ['an empty outcome', { outcome: { en: '', fr: '' } }],
    ['a prompt that is not text', { prompt: { en: 1, fr: 2 } }], ['an over-long outcome', { outcome: { en: 'x'.repeat(401), fr: 'x' } }]
  ]) assert.equal(pickOf({ ...good, ...patch }), null, label)
  ok('an entry that cannot be shown is dropped: a path in the name, a foreign source, an unknown category, a missing language, an empty or over-long text')

  const soft = pickOf({ ...good, needs: 'paypal', installs: -3, audits: [['ok', 'pass', 'LOW'], ['bad', 'maybe', ''], 'junk', ['p', 'fail', 'HIGH']] })
  assert.equal(soft.needs, null)
  assert.equal(soft.installs, 0)
  assert.deepEqual(soft.audits, [['ok', 'pass', 'LOW'], ['p', 'fail', 'HIGH']])
  ok('a bad « needs », a negative count and a malformed audit row are cleaned, not fatal')

  const dedup = validatePicks({ asOf: '2026-10-15', items: [good, { ...good, title: { en: 'Again', fr: 'Encore' } }, null, 3] })
  assert.equal(dedup.items.length, 1)
  assert.equal(dedup.items[0].title.en, 'PDF')
  assert.equal(validatePicks({ asOf: 'yesterday', items: [good] }).asOf, '')
  assert.deepEqual(validatePicks('nope').items, [])
  assert.deepEqual(readPicks(join(base, 'missing.json')).items, [])
  writeFileSync(join(base, 'broken.json'), '{ not json')
  assert.deepEqual(readPicks(join(base, 'broken.json')).items, [])
  ok('a duplicate id keeps the first, a bad date is blanked, and a missing or damaged file is an empty list, never an error')

  // 2. the shipped file ----------------------------------------------------------------------------
  const raw = JSON.parse(readFileSync(join(here, 'featured-picks.json'), 'utf8'))
  const picks = readPicks(join(here, 'featured-picks.json'))
  assert.equal(raw.items.length, 24)
  assert.equal(picks.items.length, raw.items.length, 'no entry of the shipped file is dropped by the reader')
  assert.match(picks.asOf, /^\d{4}-\d{2}-\d{2}$/)
  ok('the shipped file holds 24 picks and the reader keeps every one of them')

  const ids = picks.items.map((p) => p.id)
  assert.equal(new Set(ids).size, ids.length, 'unique ids')
  for (const c of PICK_CATEGORIES) assert.equal(picks.items.filter((p) => p.category === c).length, 3, c + ' has three picks')
  ok('the ids are unique and each of the 8 categories has three picks')

  for (const p of picks.items) {
    assert.ok(p.title.en !== p.title.fr || p.title.en.length > 0)
    for (const f of ['title', 'outcome', 'prompt']) assert.ok(p[f].en.length > 0 && p[f].fr.length > 0, p.id + ' ' + f)
    assert.ok(p.audits.length >= 3, p.id + ' carries its audit verdicts')
    assert.ok(Number.isInteger(p.installs) && p.installs > 0, p.id + ' has its install count')
    assert.ok(p.needs === null || PICK_NEEDS.indexOf(p.needs) >= 0, p.id)
  }
  ok('every pick has its title, outcome and example in both languages, its install count and its audit verdicts')

  const failing = picks.items.filter((p) => p.audits.some((a) => a[1] === 'fail')).map((p) => p.id)
  assert.deepEqual(failing, [], 'a pick with an audit in failure is not featured: ' + failing.join(', '))
  ok('no pick has a security audit in failure (the rule that keeps skills with a failing provider out)')

  // 3. the route -----------------------------------------------------------------------------------
  const mod = await import('./index.js')
  const routes = {}
  const webServer = { register: (r) => { routes[r.path] = { kind: r.kind, handler: r.handler } } }
  mod.apply({ inject (deps, fn) { fn({ get: (n) => (n === 'webServer' ? webServer : {}), effect: (f) => f() }) } })
  assert.ok(routes['/kybernos-skills/picks'] !== undefined, 'the route is registered')
  const call = async () => {
    const out = { code: null, body: null }
    const res = { writeHead (c) { out.code = c }, end (s) { try { out.body = JSON.parse(s) } catch (e) { out.body = s } } }
    await routes['/kybernos-skills/picks'].handler({ method: 'GET', headers: {}, url: '/kybernos-skills/picks', socket: { localPort: 3080 } }, res)
    return out
  }
  const first = await call()
  assert.equal(first.code, 200)
  assert.equal(first.body.ok, true)
  assert.equal(first.body.items.length, 24)
  assert.ok(first.body.items.every((p) => p.cover === null), 'no cover file yet, no cover URL')
  ok('GET /kybernos-skills/picks serves the 24 picks, with no cover URL while there is no cover file')

  writeFileSync(join(dsh, 'kybernos', 'skills-featured', 'pdf.webp'), Buffer.from('RIFF....WEBP'))
  const second = await call()
  assert.equal(second.body.items.find((p) => p.id === 'pdf').cover, '/kybernos-skills/cover/pdf')
  assert.equal(second.body.items.filter((p) => p.cover !== null).length, 1)
  ok('a cover URL appears for a pick exactly when its file is in the covers folder')

  // 4. the screen, at source level -------------------------------------------------------------------
  const src = readFileSync(join(here, 'client.js'), 'utf8')
  assert.match(src, /React\.useState\('featured'\)/, 'Featured is the landing tab')
  assert.match(src, /picks\.phase === 'absent'\) setMode\(\(m\) => \(m === 'featured' \? 'yours' : m\)\)/, 'a host without picks sends the page back to Yours')
  assert.match(src, /'seg-featured'/, 'the segment')
  ok('Featured is the first tab and the landing one; a host without picks falls back to Yours')

  assert.match(src, /h\('div', \{ className: 'kbsf-trow' \},\s*h\('div', \{ className: 'kbsf-title' \}, title\),\s*h\('div', \{ className: 'kbsf-side' \}/, 'the creator and the count sit on the right of the title')
  const card = src.slice(src.indexOf('const pickCard = '), src.indexOf('const renderFeatured = '))
  assert.ok(!/'\/' \+ p\.id\s*\)\s*\)\s*,\s*h\('p'/.test(card) && !/className: 'kbs-copy'/.test(card), 'no /name link on the card')
  assert.match(card, /icon\('dl', 13\), nf\(p\.installs\)/, 'the count is an icon and a figure')
  assert.ok(!/' installs'/.test(card) && !/ installs/.test(card.replace(/t\('pick\.count'/g, '')), 'the card never writes the word « installs » beside the count')
  ok('the card: creator and count on the right of the title, no /name link, the count as an icon and a figure')

  assert.match(src, /@media \(hover:hover\)\{\s*\.kbs-root \.kbsf-card \.kbsf-acts\{opacity:0\}\s*\.kbs-root \.kbsf-card:hover \.kbsf-acts,\.kbs-root \.kbsf-card:focus-within \.kbsf-acts\{opacity:1\}/, 'actions on hover and on focus, always on touch')
  assert.match(card, /setAskInstall\(x\)/, 'Install goes through the same confirmation as Discover')
  assert.match(src, /const fromFeatured = mode === 'featured'[\s\S]*setMode\(fromFeatured \? 'featured' : 'yours'\)/, 'after an install from Featured the page stays on Featured')
  ok('Install and Details show on hover and focus (always on touch); Install opens the usual confirmation and the page stays on Featured')

  assert.match(src, /kybernos\.skills\.coverbg/, 'the cover background is kept in this browser')
  assert.match(src, /kbsf-grid' \+ \(coverBg === 'plain' \? ' kbsf-plain' : ''\)/)
  assert.match(src, /\.kbs-root \.kbsf-plain \.kbsf-pic\{background:var\(--dsw-alias-bg-layer-2\)\}/)
  ok('the cover background is a Tint or Plain choice, kept per browser')

  console.log('\n' + pass + ' verifications OK')
} finally {
  rmSync(base, { recursive: true, force: true })
}

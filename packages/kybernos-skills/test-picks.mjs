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
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
    needs: null, coverSha256: null, installs: 211154, audits: [['Socket', 'pass', 'LOW'], ['Snyk', 'warn', 'MEDIUM']]
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

  const SHA = 'a'.repeat(64)
  assert.equal(pickOf({ ...good, coverSha256: SHA }).coverSha256, SHA)
  for (const bad of ['A'.repeat(64), 'a'.repeat(63), 'a'.repeat(65), 'g'.repeat(64), 12, {}, '']) assert.equal(pickOf({ ...good, coverSha256: bad }).coverSha256, null, String(bad))
  ok('the cover hash is a lower-case SHA-256 in hex, or nothing')

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

  assert.ok(picks.items.every((p) => typeof p.coverSha256 === 'string'), 'every pick ships the hash of its cover')
  assert.equal(new Set(picks.items.map((p) => p.coverSha256)).size, 24, 'no two picks share a picture')
  ok('every pick ships the SHA-256 of its cover, and no two covers are the same file')

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
  assert.ok(first.body.items.every((p) => p.cover === '/kybernos-skills/cover/' + p.id), 'every pick ships its cover hash, so every pick has a cover URL (fetched on first use)')
  ok('GET /kybernos-skills/picks serves the 24 picks, each with its cover URL')

  // 3b. a cover that is not in the folder is fetched from the relay ONCE, and only the picture that was shipped is kept ---------------
  const { createHash } = await import('node:crypto')
  const webp = (n, size = 48) => Buffer.concat([Buffer.from('RIFF'), Buffer.from([n, 0, 0, 0]), Buffer.from('WEBPVP8 '), Buffer.alloc(size, n)])
  const sha = (b) => createHash('sha256').update(b).digest('hex')
  const cfg = { home, dsh, cwd: home }
  const folder = join(dsh, 'kybernos', 'skills-featured')
  const pickWith = (id, bytes) => ({ items: [{ id, coverSha256: bytes === null ? null : sha(bytes) }] })
  const RELAY = 'https://skills.kybernos.app/v1'
  const calls = []
  const realFetch = globalThis.fetch
  const serve = (map) => {
    globalThis.fetch = async (url, init) => {
      calls.push({ url: String(url), init })
      const b = map[String(url)]
      if (b === 'throw') throw new Error('offline')
      return b === undefined ? new Response('no', { status: 404 }) : new Response(b, { status: 200 })
    }
  }
  try {
    const picture = webp(7)
    serve({ [RELAY + '/covers/docx.webp']: picture })
    const file = await mod.ensureCover(cfg, 'docx', pickWith('docx', picture))
    assert.equal(file, join(folder, 'docx.webp'))
    assert.deepEqual(readFileSync(file), picture)
    assert.equal(calls.length, 1)
    assert.equal(calls[0].init.redirect, 'error', 'the relay cannot bounce the request elsewhere')
    assert.equal(await mod.ensureCover(cfg, 'docx', pickWith('docx', picture)), file)
    assert.equal(calls.length, 1, 'a cover that is in the folder costs no request')
    ok('a missing cover is fetched from the relay, checked against its hash, kept, and never asked for again')

    // 24 cards ask at once: one request
    const p2 = webp(9)
    serve({ [RELAY + '/covers/xlsx.webp']: p2 })
    calls.length = 0
    const both = await Promise.all([mod.ensureCover(cfg, 'xlsx', pickWith('xlsx', p2)), mod.ensureCover(cfg, 'xlsx', pickWith('xlsx', p2))])
    assert.equal(both[0], both[1])
    assert.equal(calls.length, 1)
    ok('simultaneous requests for the same cover make one request')

    // a picture that is not the shipped one is refused: another hash, not a WebP, too large, a failing relay
    for (const [id, served, expect, why] of [
      ['pptx', webp(1), pickWith('pptx', webp(2)), 'bytes that do not hash to the shipped hash'],
      ['canvas-design', Buffer.from('<html>not a picture</html>'), pickWith('canvas-design', Buffer.from('<html>not a picture</html>')), 'bytes that are not a WebP even when the hash matches'],
      ['sql-queries', webp(3, 700 * 1024), pickWith('sql-queries', webp(3, 700 * 1024)), 'a picture above the size cap'],
      ['copywriting', 'throw', pickWith('copywriting', webp(4)), 'a relay that cannot be reached'],
      ['cold-email', undefined, pickWith('cold-email', webp(5)), 'a relay with no such picture (404)']
    ]) {
      serve({ [RELAY + '/covers/' + id + '.webp']: served })
      calls.length = 0
      assert.equal(await mod.ensureCover(cfg, id, expect), null, why)
      assert.equal(calls.length, 1, why)
      assert.equal(existsSync(join(folder, id + '.webp')), false, why + ': nothing was written')
      assert.equal(await mod.ensureCover(cfg, id, expect), null)
      assert.equal(calls.length, 1, why + ': the relay is not asked again for ten minutes')
    }
    ok('a wrong hash, a non-WebP, an oversized picture, an unreachable relay and a 404 all keep the tile, write nothing and are not retried at once')

    // nothing else starts a request
    calls.length = 0
    for (const [id, picks] of [['unknown-skill', { items: [] }], ['no-hash', pickWith('no-hash', null)], ['../etc/passwd', pickWith('../etc/passwd', webp(6))], ['Not-A-Name', pickWith('Not-A-Name', webp(6))]]) {
      assert.equal(await mod.ensureCover(cfg, id, picks), null, id)
    }
    assert.equal(calls.length, 0)
    ok('only an id of the shipped list that carries a hash can start a request: no unknown name, no unhashed pick, no path')

    // another relay (a company's) is asked at ITS address, and its picture is still checked
    writeFileSync(join(dsh, 'kybernos', 'skills-index.json'), JSON.stringify({ version: 1, url: 'https://relay.example.test/v1' }))
    const p3 = webp(11)
    serve({ 'https://relay.example.test/v1/covers/mcp-builder.webp': p3 })
    calls.length = 0
    assert.equal(await mod.ensureCover(cfg, 'mcp-builder', pickWith('mcp-builder', p3)), join(folder, 'mcp-builder.webp'))
    assert.equal(calls[0].url, 'https://relay.example.test/v1/covers/mcp-builder.webp')
    rmSync(join(dsh, 'kybernos', 'skills-index.json'))
    ok('the relay the user named is the one asked, with the same check on what it returns')
  } finally {
    globalThis.fetch = realFetch
  }

  // 4. the screen, at source level -------------------------------------------------------------------
  const src = readFileSync(join(here, 'client.js'), 'utf8')
  assert.match(src, /React\.useState\('featured'\)/, 'Featured is the landing tab')
  assert.match(src, /picks\.phase === 'absent'\) setMode\(\(m\) => \(m === 'featured' \? 'yours' : m\)\)/, 'a host without picks sends the page back to Yours')
  assert.match(src, /'seg-featured'/, 'the segment')
  ok('Featured is the first tab and the landing one; a host without picks falls back to Yours')

  assert.match(src, /h\('div', \{ className: 'kbsf-trow' \},\s*h\('div', \{ className: 'kbsf-title' \}, title\),\s*h\('div', \{ className: 'kbsf-side' \}/, 'the creator and the count sit on the right of the title')
  const card = src.slice(src.indexOf('const pickCard = '), src.indexOf('const renderFeatured = '))
  assert.ok(!/'\/' \+ p\.id\s*\)\s*\)\s*,\s*h\('p'/.test(card) && !/className: 'kbs-copy'/.test(card), 'no /name link on the card')
  const parts = src.slice(src.indexOf('const pickCover = '), src.indexOf('const pickCard = '))
  assert.match(parts, /icon\('dl', 13\), nf\(p\.installs\)/, 'the count is an icon and a figure')
  assert.ok(!/' installs'/.test(card) && !/ installs/.test(card.replace(/t\('pick\.count'/g, '')), 'the card never writes the word « installs » beside the count')
  ok('the card: creator and count on the right of the title, no /name link, the count as an icon and a figure')

  assert.match(src, /@media \(hover:hover\)\{\s*\.kbs-root \.kbsf-card \.kbsf-acts\{opacity:0\}\s*\.kbs-root \.kbsf-card:hover \.kbsf-acts,\.kbs-root \.kbsf-card:focus-within \.kbsf-acts\{opacity:1\}/, 'actions on hover and on focus, always on touch')
  assert.match(parts, /setAskInstall\(x\)/, 'Install goes through the same confirmation as Discover')
  assert.match(src, /const fromFeatured = mode === 'featured'[\s\S]*setMode\(fromFeatured \? 'featured' : 'yours'\)/, 'after an install from Featured the page stays on Featured')
  ok('Install and Details show on hover and focus (always on touch); Install opens the usual confirmation and the page stays on Featured')

  assert.match(src, /kybernos\.skills\.coverbg/, 'the cover background is kept in this browser')
  assert.match(src, /kbsf-grid' \+ \(coverBg === 'plain' \? ' kbsf-plain' : ''\)/)
  assert.match(src, /\.kbs-root \.kbsf-plain \.kbsf-pic\{background:var\(--dsw-alias-bg-layer-2\)\}/)
  ok('the cover background is a Tint or Plain choice, kept per browser')

  // the list view: the same pick as a row, switched by the shared bar like Yours and Discover
  assert.match(src, /featured: j !== null && j\.featured === 'list' \? 'list' : 'cards'/, 'the choice is kept with the other two tabs')
  assert.match(src, /viewMode: views\.featured \}/, 'the bar shows the current view')
  assert.match(src, /patch\.viewMode !== undefined\) \{ setView\('featured', patch\.viewMode === 'list' \? 'list' : 'cards'\); setDetail\(null\) \}/, 'and writes it back (a change of display closes an opened pick)')
  assert.match(src, /views\.featured === 'list'\s*\? h\('div', \{ className: 'kbsf-list'[\s\S]*list\.map\(pickRow\)/, 'the list view draws a row per pick')
  const row = src.slice(src.indexOf('const pickRow = '), src.indexOf('// Pager based on the SERVER'))
  assert.match(row, /pickBy\(p\), pickCnt\(p\)/, 'the row has the creator and the count')
  assert.match(row, /pickButtons\(p, x, isIn, openIt\)/, 'and the same two gestures as the card')
  assert.ok(!/'\/' \+ p\.id\)\s*\)/.test(row.replace(/copy\('\/' \+ p\.id\)/g, '')), 'no /name link in the row either')
  ok('the list view: a row per pick with the creator, the count, the verdicts and the same actions; the shared bar switches it, per browser')

  // the opened pick, on the width of the page (not the side panel) -------------------------------------
  const det = src.slice(src.indexOf('const renderPickDetail = '), src.indexOf('const renderPanel = '))
  assert.ok(det.length > 500, 'the detail view exists')
  assert.match(det, /className: 'kbsf-detail'[\s\S]*'data-kb': 'pick-detail'/, 'a page of its own')
  assert.match(det, /className: 'kbsf-dpic kbsf-t', 'data-cat': p\.category \},\s*pickCover\(p\)/, 'the picture of the card, big, at the top')
  assert.match(det, /h\('h2', \{ className: 'kbsf-dtitle' \}, title\)/, 'and the title beside it')
  assert.match(det, /'data-kb': 'pick-back'[\s\S]*setDetail\(null\)/, 'a way back to the grid')
  assert.match(src, /mode === 'featured' \? \(detail !== null \? renderPickDetail\(\) : renderFeatured\(\)\)/, 'in Featured the opened pick replaces the grid')
  assert.match(src, /if \(mode === 'discover' && detail !== null\) \{/, 'the side panel is for Discover only')
  assert.match(src, /@container \(max-width:760px\)\{\s*\.kbs-root \.kbsf-dhero\{grid-template-columns:1fr\}/, 'one column when the page is narrow')
  assert.match(src, /if \(fromFeatured !== true\) setDetail\(null\)/, 'after an install from Featured the opened pick stays open (it flips to Installed)')
  ok('Featured: an opened pick takes the page width, with its picture and title at the top like the card; the side panel stays for Discover')

  // Discover's table ------------------------------------------------------------------------------------
  assert.match(src, /const DISC_PER = 20/, '20 rows by default')
  assert.ok(!/React\.useState\(50\)/.test(src), 'no 50-row default left')
  assert.ok(!/pagerIndex\(true\)/.test(src), 'no pager above the table')
  assert.match(src, /sortHead\(discKind === 'search' \? t\('th\.result'\) : 'SKILL', 'name', 'who'\)/, 'the skill column sorts')
  assert.match(src, /sortHead\('INSTALLATIONS', 'installs', 'inst'\)/, 'the installs column sorts')
  assert.match(src, /'data-kb': 'row-install'/, 'a row that is not installed offers Install')
  assert.match(src, /kbs-instpill/, 'a row that is installed says so')
  ok('Discover: 20 rows by default, no pager above the table, sortable columns, and each row says Installed or offers Install')

  // The field of work (window.__KB_DOMAIN__, published by kybernos-plugin): the Featured tab opens on its skills, and the page's title is the menu's word
  const fieldSrc = src.slice(src.indexOf('const renderFieldSection'), src.indexOf('const renderFeatured'))
  assert.match(src, /window\.__KB_DOMAIN__/, 'the page reads the seam the core plugin publishes')
  assert.match(fieldSrc, /pcat !== 'all' \|\| q\.featured\.trim\(\) !== ''\) return null/, 'the section shows on the whole Featured tab only: a category or a search is left alone')
  assert.match(fieldSrc, /f === null \|\| list\.length === 0\) return null/, 'no field, or none of its skills: nothing is drawn')
  assert.match(src, /renderFieldSection\(\),\n\s+h\('div', \{ className: 'kbsf-chips' \}/, 'the section sits above the categories')
  assert.match(src, /if \(sk\.shipped === true\) installShipped\(sk\.name\); else \{ setAskInstall\(x\)/, 'a skill from GitHub asks the usual confirmation, one that ships with Kybernos is a plain copy')
  assert.match(src, /setShipDone\(\(m\) => \(\{ \.\.\.m, \[name\]: true \}\)\); loadCatalogue\(\)/, 'a shipped skill shows as installed at once, then the registry is read again')
  assert.match(src, /h\('h1', \{ className: 'kb6-title' \}, pageTitle\(\)\), helpBtn\)/, 'the title is the menu\'s word for the row when the field gives one')
  for (const key of ['fld.title', 'fld.sub', 'fld.kit', 'fld.kit.tip', 'fld.shipped', 'fld.installing']) assert.match(src, new RegExp("'" + key.replace(/\./g, '\\.') + "': \\{ fr: '[^']+', en: '[^']+' \\}"), key + ' has both languages')
  ok('Featured, « For your field »: the saved field\'s skills first (confirmation for GitHub, plain copy for shipped), nothing without a field, the title follows the menu')

  console.log('\n' + pass + ' verifications OK')
} finally {
  rmSync(base, { recursive: true, force: true })
}

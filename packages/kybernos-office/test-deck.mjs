// The slide decks the model can make: the description is checked (and every wrong one answered with what to change), the file the builder writes has the shape the deck editor and
// the guard expect, and the `create_deck` tool writes it only inside the working folder, replaces only a deck, and is registered next to `deliver_files`.
//
//   node packages/kybernos-office/test-deck.mjs
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import * as fsp from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const base = mkdtempSync(join(tmpdir(), 'kb-office-deck-'))
process.env.DSH_HOME = join(base, 'dsh')
process.env.HOME = base
const { LAYOUTS, MAX_SLIDES, buildDeck, dataUri, imageKind, normalize, palette } = await import('./deck-build.mjs')
const { DESCRIPTION, PARAMETERS, TOOL, deckTool, inside } = await import('./deck-tool.mjs')
const { inspect, formatOf } = await import('./office-guard.mjs')
const { mountDeliver } = await import('./index.js')

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }
const ASSETS = { css: '.slide{width:1280px}', js: '(()=>{const s="</script><!--";})()' }
// A one-pixel PNG: what an `image` slide embeds.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

const FULL = {
  title: 'Q3 review',
  language: 'en',
  theme: { primary: '#0B3D2E', accent: '#F2A900' },
  slides: [
    { layout: 'cover', title: 'Q3 review', subtitle: 'Kybernos team · 3 November', tagline: 'Revenue up 18 % on the year', notes: 'Open on the number.' },
    { layout: 'section', title: 'Results', number: '01', subtitle: 'Revenue, users, plans' },
    { layout: 'bullets', title: 'Three things to remember', bullets: ['**Revenue** reaches 4.8 M€', 'Users double in six months', 'Churn <b>falls</b> & stays low'] },
    { layout: 'text', title: 'Context', paragraphs: ['A first paragraph.', 'A second one.'] },
    { layout: 'two-columns', title: 'Before and after', left: { heading: 'Before', bullets: ['Slow', 'Manual'] }, right: { heading: 'After', bullets: ['Fast', 'Automatic'] } },
    { layout: 'stats', title: 'Key figures', stats: [{ value: '4.8 M€', label: 'Revenue' }, { value: '+18 %', label: 'Growth' }, { value: '118 %', label: 'Net retention' }] },
    { layout: 'chart', title: 'Revenue grows every quarter', chart: { type: 'column', categories: ['Q4', 'Q1', 'Q2', 'Q3'], series: [{ name: 'Revenue', values: [3.9, 4.1, 4.4, 4.8] }, { name: 'Target', values: ['4.0', 4.2, 4.5, 4.6] }] } },
    { layout: 'chart', title: 'Plans', chart: { type: 'doughnut', categories: ['Plus', 'Team', 'Other'], series: [{ name: 'Share', values: [46, 31, 23] }] } },
    { layout: 'table', title: 'Plans', table: { header: ['Plan', 'Price'], rows: [['Free', '0'], ['Plus', 19]] } },
    { layout: 'quote', quote: 'Make it work, then make it nice.', by: 'Somebody wise' },
    { layout: 'image', title: 'The product', image: { path: 'shot.png', caption: 'Home screen' } },
  ],
}
const clone = (o) => JSON.parse(JSON.stringify(o))

console.log('Kybernos office: slide decks')

// ── the description ──────────────────────────────────────────────────────────────
{
  assert.equal(LAYOUTS.length, 10)
  const good = normalize(FULL)
  assert.equal(good.ok, true, good.error)
  assert.equal(good.deck.slides.length, 11)
  assert.deepEqual(good.deck.slides[6].chart.series[1].values, [4, 4.2, 4.5, 4.6], 'numbers given as text are read')
  assert.deepEqual(good.deck.slides[8].table.rows[1], ['Plus', '19'], 'table cells are text')
  for (const [bad, expect] of [
    [null, /object/],
    [{ slides: [] }, /title/],
    [{ title: 'x' }, /slides/],
    [{ title: 'x', slides: [{ layout: 'nope', title: 't' }] }, /layout.*one of/],
    [{ title: 'x', slides: [{ layout: 'bullets', bullets: ['a'] }] }, /needs a `title`/],
    [{ title: 'x', slides: [{ layout: 'bullets', title: 't' }] }, /bullets/],
    [{ title: 'x', slides: [{ layout: 'stats', title: 't', stats: [{ value: '1' }] }] }, /2 to 4/],
    [{ title: 'x', slides: [{ layout: 'chart', title: 't', chart: { categories: ['a'], series: [] } }] }, /two `categories`/],
    [{ title: 'x', slides: [{ layout: 'chart', title: 't', chart: { categories: ['a', 'b'], series: [{ name: 's', values: [1] }] } }] }, /one number/],
    [{ title: 'x', slides: [{ layout: 'table', title: 't', table: { header: ['a'] } }] }, /table/],
    [{ title: 'x', slides: [{ layout: 'quote' }] }, /quote/],
    [{ title: 'x', slides: [{ layout: 'image', title: 't' }] }, /image/],
    [{ title: 'x', slides: Array.from({ length: MAX_SLIDES + 1 }, () => ({ layout: 'text', title: 't', paragraphs: ['p'] })) }, /at most/],
  ]) { const r = normalize(bad); assert.equal(r.ok, false); assert.match(r.error, expect) }
  const clipped = normalize({ title: 'x', slides: [{ layout: 'bullets', title: 't', bullets: Array.from({ length: 20 }, (_, i) => 'item ' + i) }] })
  assert.equal(clipped.deck.slides[0].bullets.length, 8, 'a long list is cut to what fits')
  ok('a good description is read (numbers as text too), every bad one is answered with what to change, lists are cut to what fits')
}

// ── the file ─────────────────────────────────────────────────────────────────────
{
  const deck = normalize(FULL).deck
  const pictures = new Map([['shot.png', dataUri('image/png', PNG)]])
  const r = buildDeck(deck, ASSETS, pictures)
  assert.equal(r.ok, true, r.error)
  assert.equal(r.slides, 11)
  const html = r.html
  assert.ok(html.startsWith('<!doctype html>\n<html lang="en">'))
  assert.match(html, /<meta name="kybernos-deck" content="1">/)
  assert.match(html, /<style data-kd="base">\.slide\{width:1280px\}<\/style>/)
  assert.match(html, /<style data-kd="theme">:root\{--navy:#0b3d2e;--gold:#f2a900;/)
  assert.equal((html.match(/<div class="cell">/g) || []).length, 11, 'one cell per slide')
  assert.equal((html.match(/<\/section><\/div>/g) || []).length, 11)
  assert.equal((html.match(/<aside class="notes" data-e>/g) || []).length, 11, 'every slide has its notes box, empty or not')
  assert.match(html, /Open on the number\./)
  assert.match(html, /<strong>Revenue<\/strong> reaches/, '**bold** is bold')
  assert.match(html, /Churn &lt;b&gt;falls&lt;\/b&gt; &amp; stays low/, 'markup typed in a text is text')
  assert.match(html, /<section class="slide dark" data-transition="fade">/)
  assert.match(html, /<ul class="bul gap">/)
  assert.match(html, /data-chart="\{&quot;type&quot;:&quot;column&quot;/)
  assert.match(html, /&quot;values&quot;:\[46,31,23\]/, 'a doughnut is in shares of 100')
  assert.match(html, /<table class="t" [^>]*data-e-table><tbody><tr style="height:\d+px"><th data-e>Plan<\/th>/)
  assert.match(html, /<img class="pic" [^>]*src="data:image\/png;base64,/)
  assert.ok(!/<\/script><!--/.test(html), 'the player cannot end its own script or open a comment')
  assert.equal((html.match(/<\/script>/g) || []).length, 1)
  assert.match(html, /<script data-kd="runtime">\(\(\)=>\{const s="<\\\/script><\\!--";\}\)\(\)<\/script><\/body>/)
  // The guard of the host takes it as a deck with nothing to lose, and the file name says what it is.
  assert.deepEqual(inspect('deck', new Uint8Array(Buffer.from(html))), { ok: true, losses: [], block: false })
  assert.equal(formatOf('talk.deck.html'), 'deck')
  assert.equal(formatOf('talk.html'), null)
  ok('the file is one page with the deck marker, its slides, escaped text, charts as data, the player escaped; the guard takes it as a deck')

  assert.equal(buildDeck(deck, { css: '', js: '' }, pictures).ok, false)
  assert.match(buildDeck(deck, ASSETS, new Map()).error, /Slide 11 \(image\)/)
  assert.deepEqual(palette({ primary: 'red' }), palette({}), 'a colour that is not #RRGGBB is ignored')
  assert.equal(palette({ accent: '#fff' }).accent, '#ffffff')
  assert.equal(palette({ accent: '#F2A900' }).onAccent, '#1a1a1a')
  assert.equal(palette({ accent: '#102030' }).onAccent, '#ffffff')
  assert.equal(imageKind('a/b.JPG'), 'image/jpeg')
  assert.equal(imageKind('a.svg'), null, 'a picture that can carry a script is not embedded')
  ok('no player, a missing picture, a colour that is not a colour, an SVG: each is refused or ignored with a reason')

  // Empty and active content: the editor does not keep a script a slide carries, and the guard says it.
  const withScript = html.replace('<aside class="notes" data-e></aside>', '<script>1</script><aside class="notes" data-e></aside>')
  const seen = inspect('deck', new Uint8Array(Buffer.from(withScript)))
  assert.equal(seen.block, true)
  assert.deepEqual(seen.losses, [{ code: 'active-content', level: 'loss', count: 1 }])
  assert.equal(inspect('deck', new Uint8Array(Buffer.from('<html><main id="deck"></main></html>'))).reason, 'not-a-deck')
  assert.equal(inspect('deck', new Uint8Array([60, 0, 61])).reason, 'not-text')
  ok('the guard says what a slide holds that the editor would not keep (a script, a frame, an event handler) and refuses a page that is not a deck')
}

// ── the tool ─────────────────────────────────────────────────────────────────────
const cwd = join(base, 'work')
mkdirSync(cwd, { recursive: true })
writeFileSync(join(cwd, 'shot.png'), PNG)
writeFileSync(join(cwd, 'notes.txt'), 'mine')
const io = { stat: fsp.stat, readFile: fsp.readFile, writeFile: fsp.writeFile, mkdir: (d) => fsp.mkdir(d, { recursive: true }), rename: fsp.rename, readdir: fsp.readdir, rm: (f) => fsp.rm(f, { force: true }) }
let assets = { ok: true, ...ASSETS }
const services = () => ({ workingDirectory: { ensure: async () => cwd }, deckAssets: async () => assets, io })
const exec = { agent: {}, signal: new AbortController().signal }
{
  const t = deckTool(services)
  assert.equal(t.options.name, TOOL)
  assert.equal(TOOL, 'create_deck')
  const args = { path: 'talk/q3.deck.html', ...clone(FULL) }
  const out = await t.options.execute(args, exec)
  assert.deepEqual({ path: out.path, slides: out.slides }, { path: 'talk/q3.deck.html', slides: 11 })
  const written = readFileSync(join(cwd, 'talk', 'q3.deck.html'), 'utf8')
  assert.equal(inspect('deck', new Uint8Array(Buffer.from(written))).ok, true)
  assert.match(written, /data:image\/png;base64,iVBOR/, 'the picture of the working folder is inside the file')
  assert.deepEqual(readdirSync(join(cwd, 'talk')), ['q3.deck.html'], 'no temporary file is left behind')
  assert.match(t.options.render(args, out)[0].text, /Deck written: talk\/q3\.deck\.html \(11 slides\)\. Hand it over with deliver_files\./)
  ok('it writes the deck (with its pictures inside) in the working folder, atomically, and says what to do next')

  await t.options.execute({ ...clone(args), title: 'Q3 review, second take' }, exec)
  assert.match(readFileSync(join(cwd, 'talk', 'q3.deck.html'), 'utf8'), /Q3 review, second take/)
  ok('a deck it made is replaced by the same path')

  // UJ-140: a deck the person saved by hand is kept as a copy before the agent replaces it, and the answer says so.
  const mineBefore = readFileSync(join(cwd, 'talk', 'q3.deck.html'), 'utf8')
  writeFileSync(join(cwd, 'talk', 'q3.deck.html'), mineBefore.replace('Q3 review, second take', 'Q3 review, edited by the person'))
  const copiesBefore = readdirSync(join(cwd, 'talk')).filter((n) => n.endsWith('.bak')).length
  const again = await t.options.execute({ ...clone(args), title: 'Q3 review, third take' }, exec)
  const copies = readdirSync(join(cwd, 'talk')).filter((n) => n.endsWith('.bak')).sort()
  assert.equal(copies.length, copiesBefore + 1, 'one more copy: the replaced deck')
  assert.match(readFileSync(join(cwd, 'talk', copies[copies.length - 1]), 'utf8'), /edited by the person/, 'the newest copy is the person\'s version')
  assert.equal(again.previous, 'talk/' + copies[copies.length - 1])
  assert.match(t.options.render(args, again)[0].text, /previous version is kept as talk\/q3\.deck\.html\.[0-9-]+\.bak\. Tell the person\./)
  assert.match(readFileSync(join(cwd, 'talk', 'q3.deck.html'), 'utf8'), /Q3 review, third take/)
  const same = await t.options.execute({ ...clone(args), title: 'Q3 review, third take' }, exec)
  assert.equal(same.previous, undefined, 'writing the same deck again keeps no copy')
  for (let i = 0; i < 5; i++) { await t.options.execute({ ...clone(args), title: 'take ' + i }, exec); await new Promise((r) => setTimeout(r, 3)) }
  assert.ok(readdirSync(join(cwd, 'talk')).filter((n) => n.endsWith('.bak')).length <= 3, 'only the newest copies stay')
  ok('a deck the person saved is kept as a copy before it is replaced, the answer says so, and only the newest copies stay')

  for (const [bad, expect] of [
    [{ ...clone(args), path: 'talk/q3.html' }, /\.deck\.html/],
    [{ ...clone(args), path: '../escape.deck.html' }, /inside the working folder/],
    [{ ...clone(args), path: '/tmp/escape.deck.html' }, /inside the working folder/],
    [{ ...clone(args), slides: [] }, /slides/],
    [{ ...clone(args), path: 'notes.deck.html', slides: [{ layout: 'image', title: 't', image: { path: '../x.png' } }] }, /inside the working folder/],
    [{ ...clone(args), path: 'a.deck.html', slides: [{ layout: 'image', title: 't', image: { path: 'missing.png' } }] }, /was not found/],
    [{ ...clone(args), path: 'a.deck.html', slides: [{ layout: 'image', title: 't', image: { path: 'notes.txt' } }] }, /png, jpg, gif or webp/],
  ]) await assert.rejects(() => t.options.execute(bad, exec), expect)
  writeFileSync(join(cwd, 'mine.deck.html'), 'not a deck, somebody\'s file')
  await assert.rejects(() => t.options.execute({ ...clone(args), path: 'mine.deck.html' }, exec), /already exists and is not a slide deck/)
  assert.equal(readFileSync(join(cwd, 'mine.deck.html'), 'utf8'), 'not a deck, somebody\'s file', 'a file that is not a deck is never replaced')
  assets = { ok: false }
  await assert.rejects(() => t.options.execute({ ...clone(args), path: 'b.deck.html' }, exec), /not installed/)
  assets = { ok: true, ...ASSETS }
  const idle = deckTool(() => null)
  await assert.rejects(() => idle.options.execute(args, exec), /not ready/)
  assert.equal(inside('/a/b', 'c/d.txt'), '/a/b/c/d.txt')
  assert.equal(inside('/a/b', '../c'), null)
  assert.equal(inside('/a/b', '.'), null)
  assert.equal(inside('/a/b', ''), null)
  ok('it refuses a path outside the working folder, a wrong suffix, a missing or wrong picture, a file that is not a deck, a deck editor that is not installed')

  assert.ok(DESCRIPTION.includes('.pptx') && DESCRIPTION.includes('deliver_files') && DESCRIPTION.includes('EDIT'))
  for (const l of LAYOUTS) assert.ok(DESCRIPTION.includes(l), 'the description names the layout ' + l)
  assert.equal(PARAMETERS.slides.required, true)
  assert.equal(PARAMETERS.path.required, true)
  ok('the description steers the model to decks the person can edit, and names every layout')
}

// ── registered next to deliver_files, never throwing ────────────────────────────────
{
  const registered = []
  const services2 = { tools: { register: (t) => registered.push(t) }, fs: {}, agents: {}, workingDirectory: {} }
  const ctx = { get: (n) => services2[n], on: () => {}, inject: () => {} }
  mountDeliver(ctx, { deckAssets: async () => ({ ok: false }) })
  await new Promise((r) => setTimeout(r, 200))
  assert.deepEqual(registered.map((t) => t.name).sort(), ['create_deck', 'deliver_files'])
  const alone = []
  mountDeliver({ get: (n) => ({ ...services2, tools: { register: (t) => alone.push(t) } })[n], on: () => {}, inject: () => {} })
  await new Promise((r) => setTimeout(r, 200))
  assert.deepEqual(alone.map((t) => t.name), ['deliver_files'], 'without the host there is no deck tool, and nothing throws')
  mountDeliver({ get: () => undefined, on: () => {}, inject: () => {} })
  ok('create_deck is registered next to deliver_files; a missing service or host registers nothing and throws nothing')
}

console.log('\nOFFICE DECKS — ' + pass + ' ok')

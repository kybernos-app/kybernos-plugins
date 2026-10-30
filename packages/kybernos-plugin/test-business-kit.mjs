// The visual kit the Business pages share (<kb-business-kit> in client.js, published as window.__KB_BIZ_KIT__): the same text gets the same colour, every
// picture kind draws, a bad spec draws nothing, no picture is fetched, and the motion stops under « reduce motion ».
// Hermetic: the block is evaluated with a three-line React stub.   node packages/kybernos-plugin/test-business-kit.mjs
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(here, 'client.js'), 'utf8')
const m = /\/\/ <kb-business-kit>([\s\S]*?)\/\/ <\/kb-business-kit>/.exec(src)
assert.ok(m !== null, 'the kit block is in client.js')
let count = 0
const ok = (label, fn) => { fn(); count += 1; console.log('ok  ', label) }

const body = m[1]
const stub = [
  'const h = (t, p, ...c) => ({ t, p: p || {}, c: c.flat(Infinity).filter((x) => x !== null && x !== undefined && x !== false) })',
  'const Icon = (name, size) => ({ t: "core-icon", p: { name, size }, c: [] })',
  'const window = {}',
  'const document = undefined',
].join('\n') + '\n'
const kit = new Function(stub + body + '\nreturn window.__KB_BIZ_KIT__')()
const walk = (node, out = []) => { if (node === null || typeof node !== 'object') return out; out.push(node); for (const k of node.c || []) walk(k, out); return out }

ok('the kit is published with its version and every piece', () => {
  assert.equal(kit.v, 1)
  for (const k of ['tint', 'Tag', 'Avatar', 'Logo', 'photoUrl', 'Art', 'Icon', 'artKinds', 'artOk', 'css', 'ensureCss']) assert.ok(kit[k] !== undefined, k)
})
ok('a text always gets the same hue, from the short list of soft hues, and different texts spread over it', () => {
  assert.equal(kit.tint('pre-approved'), kit.tint('Pre-Approved'))
  assert.ok(Number.isInteger(kit.tint('x')) && kit.tint('x') >= 0 && kit.tint('x') < 360)
  const seen = new Set(['buyer', 'seller', 'tenant', 'landlord', 'investor', 'newsletter', 'vip', 'wholesale', 'family', 'mandate'].map(kit.tint))
  assert.ok(seen.size >= 5, 'ten tags land on ' + seen.size + ' hues')
})
ok('every picture kind draws an svg, the ones with a sky have a gradient of their own, and the same spec draws the same picture', () => {
  const ids = new Set()
  for (const kind of kit.artKinds) {
    const el = kit.Art({ spec: 'art:' + kind + '/lakeview-3' })
    assert.equal(el.t, 'svg', kind)
    assert.ok(walk(el).length >= 7, kind + ' draws some shapes')
    const grad = walk(el).find((n) => n.t === 'linearGradient')
    if (grad !== undefined) ids.add(grad.p.id)
  }
  assert.equal(ids.size, 4, 'the four outdoor kinds (a sky) each carry their own gradient id: two pictures on a page never share one')
  const a = JSON.stringify(kit.Art({ spec: 'art:house/willow' }).c.map((n) => n.p)).replace(/kzg\d+/g, 'kzg')
  const b = JSON.stringify(kit.Art({ spec: 'art:house/willow' }).c.map((n) => n.p)).replace(/kzg\d+/g, 'kzg')
  assert.equal(a, b)
})
ok('a spec that is not ours draws nothing, and a hue can be given', () => {
  for (const bad of [undefined, null, 42, '', 'https://example.org/a.png', 'art:', 'art:unknown/x', 'art:house/<script>', 'ART:house']) assert.equal(kit.Art({ spec: bad }), null, String(bad))
  assert.equal(kit.artOk('art:shop/corner@24'), true)
  assert.equal(kit.artOk('art:shop/corner@2400'), false)
  assert.ok(JSON.stringify(kit.Art({ spec: 'art:box/s@24' })).indexOf('hsl(24 ') > 0)
})
ok('a tag is a chip coloured from its text, a button only when it is clicked, and it says when it is on', () => {
  const plain = kit.Tag({ text: 'pre-approved' })
  assert.equal(plain.t, 'span')
  assert.equal(plain.p.style['--kz-h'], kit.tint('pre-approved'))
  const btn = kit.Tag({ text: 'vip', onClick: () => {}, on: true, hue: 300, dot: true, icon: 'tag' })
  assert.equal(btn.t, 'button')
  assert.equal(btn.p['aria-pressed'], 'true')
  assert.equal(btn.p.style['--kz-h'], 300)
  assert.ok(btn.p.className.indexOf('on') > 0)
  assert.ok(walk(btn).some((n) => n.t === 'i'), 'the dot')
  assert.ok(walk(btn).some((n) => n.t === 'svg'), 'the icon')
})
ok('a tag is quiet: a grey pill that takes its text from the page, with one small coloured dot (on unless dot: false), and a chosen tag is the page\'s own ink, not a colour', () => {
  assert.ok(walk(kit.Tag({ text: 'vip' })).some((n) => n.t === 'i'), 'the dot is on by default')
  assert.ok(!walk(kit.Tag({ text: 'vip', dot: false })).some((n) => n.t === 'i'), 'and can be left out')
  const rule = /\.kz-tag\{[^}]*\}/.exec(kit.css)[0]
  assert.match(rule, /background:color-mix\(in srgb,var\(--dsw-alias-label-primary,currentColor\) 6%,transparent\)/)
  assert.match(rule, /color:var\(--dsw-alias-label-secondary,inherit\)/)
  assert.doesNotMatch(rule, /hsl\(/, 'no colour in the pill itself')
  assert.match(kit.css, /\.kz-tag i\{[^}]*background:hsl\(var\(--kz-h\) 55% 52%\)/, 'the dot keeps the hue, softly')
  assert.match(kit.css, /\.kz-tag\.on,button\.kz-tag\.on:hover\{background:var\(--dsw-alias-label-primary,currentColor\)/)
})
ok('an avatar shows the initials (two words: first and last) and is named for a screen reader', () => {
  const a = kit.Avatar({ name: 'Sophie Laurent', size: 40 })
  assert.equal(a.c[0], 'SL')
  assert.equal(a.p['aria-label'], 'Sophie Laurent')
  assert.equal(a.p.style.width, 40)
  assert.equal(kit.Avatar({ name: 'Madonna' }).c[0], 'MA')
  assert.equal(kit.Avatar({ name: '' }).c[0], '?')
  assert.ok(!walk(a).some((n) => n.t === 'img'), 'no picture, no img')
})
ok('an avatar with a sample portrait lays the picture over the initials, served by the core on the same origin; any other reference draws no picture', () => {
  const a = kit.Avatar({ name: 'Sophie Laurent', size: 40, image: 'photo:real-estate/portrait-01' })
  const img = walk(a).find((n) => n.t === 'img')
  assert.ok(img !== undefined, 'the picture')
  assert.equal(img.p.src, '/kybernos/themes/photo?id=real-estate%2Fportrait-01')
  assert.equal(img.p.alt, '', 'decorative: the name is on the avatar')
  assert.equal(img.p.loading, 'lazy')
  assert.equal(a.c[0], 'SL', 'the initials stay under it: they show while it loads and when it does not')
  const hidden = { style: { display: '' } }
  img.p.onError({ currentTarget: hidden })
  assert.equal(hidden.style.display, 'none', 'a picture that does not load hides itself')
  assert.doesNotThrow(() => img.p.onError({}), 'and a strange event does not throw')
  for (const bad of [undefined, null, 42, '', 'https://example.org/a.jpg', '//example.org/a.jpg', 'photo:../etc/passwd', 'photo:a/b/c', 'photo:Real-Estate/x', 'art:house/x', 'photo:real-estate/portrait-01.jpg', '/kybernos/themes/photo?id=x/y']) {
    assert.ok(!walk(kit.Avatar({ name: 'A B', image: bad })).some((n) => n.t === 'img'), 'no picture for ' + String(bad))
    assert.equal(kit.photoUrl(bad), null, 'no address for ' + String(bad))
  }
  assert.equal(kit.photoUrl('photo:ecommerce/portrait-09'), '/kybernos/themes/photo?id=ecommerce%2Fportrait-09')
})

// the invented companies of the three shipped templates: the marks must tell them apart
const THEMES = join(here, 'themes')
const companies = readdirSync(THEMES, { withFileTypes: true }).filter((e) => e.isDirectory() && !/^[._]/.test(e.name)).flatMap((e) => JSON.parse(readFileSync(join(THEMES, e.name, 'demo', 'sample.json'), 'utf8')).contacts.filter((c) => c.kind === 'company').map((c) => c.name))
const markOf = (name, size = 40) => kit.Logo({ name, size })
const faceOf = (el) => JSON.stringify([el.p['data-mark'], el.p['data-letters'], el.p.style['--kz-h'], el.p.style['--kz-h2']])
ok('a company mark is drawn in code: a rounded tile with an svg, named for a screen reader, the same every time for the same name, whatever the case', () => {
  const a = markOf('Brightwell Analytics', 56)
  assert.equal(a.t, 'span')
  assert.ok(a.p.className.indexOf('kz-logo') >= 0)
  assert.equal(a.p['aria-label'], 'Brightwell Analytics')
  assert.equal(a.p.style.width, 56)
  assert.equal(a.p.style.height, 56)
  const svg = walk(a).find((n) => n.t === 'svg')
  assert.equal(svg.p.viewBox, '0 0 64 64', 'a drawing on its own canvas: sharp at any size')
  assert.ok(walk(svg).length >= 4)
  assert.equal(JSON.stringify(markOf('Brightwell Analytics', 56)), JSON.stringify(a))
  assert.equal(faceOf(markOf('brightwell analytics')), faceOf(a))
  assert.ok(!walk(a).some((n) => n.t === 'img'), 'a drawn mark is not a file')
})
ok('every glyph draws, and every company of the three templates gets a mark of its own (glyph or monogram, and the two hues)', () => {
  const glyphs = new Set()
  for (let i = 0; i < 400 && glyphs.size < 13; i += 1) { const m = kit.Logo({ name: 'x', size: 20, seed: 'seed-' + i }); glyphs.add(m.p['data-mark']); assert.ok(walk(m).filter((n) => n.t !== 'span' && n.t !== 'svg').length >= 2, 'a glyph is a few shapes') }
  assert.equal(glyphs.size, 12, 'the twelve glyphs are all reachable (at small size there is no monogram): ' + [...glyphs].join(','))
  assert.ok(companies.length >= 15, 'the companies of the sample: ' + companies.length)
  const seen = new Map()
  for (const name of companies) { const key = faceOf(markOf(name)); assert.ok(!seen.has(key), name + ' looks like ' + seen.get(key)); seen.set(key, name) }
  assert.ok(companies.some((n) => markOf(n).p['data-mark'] === 'monogram') && companies.some((n) => markOf(n).p['data-mark'] !== 'monogram'), 'the sample shows both treatments')
})
ok('a monogram is the capitals of the first two words (small words and symbols left out), and a very small mark is always a glyph', () => {
  const mono = (name) => { for (let i = 0; i < 400; i += 1) { const m = kit.Logo({ name, size: 40, seed: 'm' + i }); if (m.p['data-mark'] === 'monogram') return walk(m).find((n) => n.t === 'text').c.join('') } return null }
  assert.equal(mono('Cafe Bleu'), 'CB')
  assert.equal(mono('Garnier Notary Office'), 'GN')
  assert.equal(mono('The House of Pine'), 'HP')
  assert.equal(mono('Madonna'), 'M')
  assert.equal(mono('Fernbridge & Co'), 'FC')
  for (let i = 0; i < 60; i += 1) assert.notEqual(kit.Logo({ name: 'Cafe Bleu', size: 24, seed: 's' + i }).p['data-mark'], 'monogram', 'under 26 px a monogram cannot be read')
  assert.ok(!walk(markOf('')).some((n) => n.t === 'text' && n.c.join('') === ''), 'an empty name draws no empty letters')
})
ok('a seed gives a company the same look whatever its name, a company avatar is its mark, and an optional picture lies over it', () => {
  const lookOf = (el) => JSON.stringify([el.p['data-mark'], el.p.style['--kz-h'], el.p.style['--kz-h2']]) // the letters of a monogram still come from the name
  assert.equal(lookOf(kit.Logo({ name: 'One', seed: 'acme' })), lookOf(kit.Logo({ name: 'Two', seed: 'acme' })))
  assert.notEqual(lookOf(kit.Logo({ name: 'One', seed: 'acme' })), lookOf(kit.Logo({ name: 'One', seed: 'other' })))
  const co = kit.Avatar({ name: 'Bluebird Cafe', kind: 'company', size: 30 })
  assert.ok(co.p.className.indexOf('kz-logo') >= 0 && co.p.style.width === 30)
  const withPic = kit.Logo({ name: 'Bluebird Cafe', image: 'photo:ecommerce/portrait-01' })
  assert.ok(walk(withPic).some((n) => n.t === 'img') && walk(withPic).some((n) => n.t === 'svg'), 'the mark stays under the picture')
})
ok('the business icons draw, and a name the kit does not have goes to the core\'s own icons', () => {
  assert.equal(kit.Icon('bed', 14).t, 'svg')
  assert.equal(kit.Icon('house', 14).t, 'core-icon')
})
ok('the motion is gentle: nothing loops, and « reduce motion » stops it all', () => {
  assert.ok(!/infinite/.test(kit.css), 'nothing animates forever')
  assert.match(kit.css, /@media \(prefers-reduced-motion:reduce\)\{[^}]*\.kz-in[^}]*\}/)
  assert.match(kit.css, /\.kz-lift:hover\{transform:translateY\(-2px\)/)
})
ok('nothing is fetched but a sample picture of the core: no address in the kit, no network call, and the one src is the core\'s own route', () => {
  assert.ok(!/https?:\/\//.test(body.replace(/\/\/ .*$/gm, '')), 'no http address outside comments')
  assert.ok(!/\bfetch\(|XMLHttpRequest|<img|new Image|@import|url\(http/.test(body))
  assert.equal((body.match(/\bsrc\b/g) || []).length, 3, 'src appears in the picture\'s element only (once as a name, once in its props, once in the helper)')
  assert.match(body, /return src === null \? null : h\('img', \{ key: 'face', className: 'kz-face', src,/, 'and it is the address kbBizPhotoUrl gives')
})
ok('the colours come from the page\'s own tokens or from hsl: no hex colour outside white', () => {
  const hex = (body.match(/#[0-9a-fA-F]{3,8}\b/g) || []).filter((x) => !/^#(fff|FFF|ffffff)$/.test(x))
  assert.deepEqual(hex, [])
})
ok('the toolbar is handed to the business pages (the product\'s own bar, not a lookalike)', () => {
  assert.match(src, /const kbBizToolbar = \(\) => \(typeof KbToolbar === 'function' && typeof useToolbarState === 'function' \? \{ KbToolbar: KbToolbar, useToolbarState: useToolbarState \} : null\)/)
  assert.match(src, /h\(KbBusinessMount, Object\.assign\(\{\}, props, \{ toolbar: props\.toolbar === undefined \|\| props\.toolbar === null \? kbBizToolbar\(\) : props\.toolbar \}\)\)/)
})

console.log('\n' + count + ' checks passed')

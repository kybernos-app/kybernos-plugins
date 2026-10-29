// The visual kit the Business pages share (<kb-business-kit> in client.js, published as window.__KB_BIZ_KIT__): the same text gets the same colour, every
// picture kind draws, a bad spec draws nothing, no picture is fetched, and the motion stops under « reduce motion ».
// Hermetic: the block is evaluated with a three-line React stub.   node packages/kybernos-plugin/test-business-kit.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
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
  for (const k of ['tint', 'Tag', 'Avatar', 'Art', 'Icon', 'artKinds', 'artOk', 'css', 'ensureCss']) assert.ok(kit[k] !== undefined, k)
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
ok('an avatar shows the initials (two words: first and last), a square with a building for a company, and is named for a screen reader', () => {
  const a = kit.Avatar({ name: 'Sophie Laurent', size: 40 })
  assert.deepEqual(a.c, ['SL'])
  assert.equal(a.p['aria-label'], 'Sophie Laurent')
  assert.equal(a.p.style.width, 40)
  assert.equal(kit.Avatar({ name: 'Madonna' }).c[0], 'MA')
  assert.equal(kit.Avatar({ name: '' }).c[0], '?')
  const co = kit.Avatar({ name: 'Bluebird Cafe', kind: 'company' })
  assert.ok(co.p.className.indexOf('co') > 0 && walk(co).some((n) => n.t === 'svg'))
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
ok('nothing is fetched: no address in the kit, and no network call', () => {
  assert.ok(!/https?:\/\//.test(body.replace(/\/\/ .*$/gm, '')), 'no http address outside comments')
  assert.ok(!/\bfetch\(|XMLHttpRequest|<img|new Image|@import|url\(http/.test(body))
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

// Tests of the Theme host half, on a temp folder: the on-disk loader store
// (loader-store.mjs), its HTTP route, the host plugin factory (index.js) and the
// shipped skills. Pure node, offline, no socket.
//   (cd packages/kybernos-theme && node test-loader-store.mjs)
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import {
  createLoaderStore, handleLoaderStore, serveLoaderStore, sanitizeLoader, sanitizeSettings, sanitizeWords, svgProblem, decodeEntities,
  LIMITS, MAX_BODY_BYTES, DEFAULT_SETTINGS,
} from './loader-store.mjs'
import { apply, resolveDshHome, sameOriginLax, sameOriginStrict, serveLottie, LOTTIE_FILE, ROUTES, SEEDED_SKILLS, SKILLS_DIR } from './index.js'

const HERE = dirname(fileURLToPath(import.meta.url))
let failed = 0
let total = 0
const check = (name, ok, detail) => {
  total += 1
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok || detail === undefined ? '' : '  — ' + detail))
  if (!ok) failed += 1
}
const root = mkdtempSync(join(tmpdir(), 'kb-loader-store-'))
let clock = 1_700_000_000_000
const fresh = (name) => createLoaderStore({ dir: join(root, name), now: () => (clock += 1000) })
const tree = (dir) => {
  const out = []
  const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) walk(p); else out.push(relative(dir, p)) } }
  if (existsSync(dir)) walk(dir)
  return out.sort()
}
const ch = (n) => String.fromCharCode(n) // invisible characters are built, never typed

// ── fixtures ──────────────────────────────────────────────────────────────────
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><style>.d{fill:currentColor;animation:b 1.2s infinite}@keyframes b{50%{fill-opacity:.3}}</style><circle class="d" cx="24" cy="24" r="6"/></svg>'
const svgWith = (inner) => '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">' + inner + '</svg>'
const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
const WEBP = Buffer.from('UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==', 'base64')
const dataUrl = (mime, buf) => 'data:image/' + mime + ';base64,' + buf.toString('base64')
const LOTTIE = () => ({ v: '5.7.0', fr: 30, ip: 0, op: 60, w: 100, h: 100, nm: 'dots', ddd: 0, assets: [], layers: [{ ddd: 0, ind: 1, ty: 4, nm: 'dot', sr: 1, ks: { o: { a: 0, k: 100 } }, ao: 0, shapes: [], ip: 0, op: 60, st: 0, bm: 0 }] })
const rec = (over) => Object.assign({ id: 'dots', name: 'Dots', type: 'svg', kind: 'mono', source: 'file', size: 1, createdAt: 1700000000000, data: SVG }, over || {})
const refused = (store, r) => { const x = store.putLoader(r); return x.ok === false && typeof x.error === 'string' && x.error.length > 0 ? x.error : null }

console.log('empty store')
{
  const s = fresh('empty')
  const snap = s.snapshot()
  check('a folder that does not exist reads as empty, with nothing created', snap.ok === true && snap.loaders.length === 0 && snap.settings === null && snap.words === null && snap.skipped.length === 0 && !existsSync(s.dir))
}

console.log('put-loader: round trip')
{
  const s = fresh('rt')
  const r = s.putLoader(rec({ dur: ' 1.2s ', prompt: 'three dots', size: 999999, evil: 'x', extra: { a: 1 } }))
  check('a valid svg record is stored', r.ok === true && r.loader.id === 'dots', JSON.stringify(r))
  check('size is recomputed by the host (the client value is ignored)', r.loader.size === Buffer.byteLength(SVG, 'utf8'))
  check('unknown fields are dropped', r.loader.evil === undefined && r.loader.extra === undefined)
  check('dur and prompt are trimmed and kept', r.loader.dur === '1.2s' && r.loader.prompt === 'three dots')
  const file = join(s.dir, 'loaders', 'dots.json')
  check('it lives in loaders/<id>.json', existsSync(file) && JSON.parse(readFileSync(file, 'utf8')).data === SVG)
  check('no .tmp file is left behind (atomic write)', tree(s.dir).every((f) => !f.endsWith('.tmp')))
  const l = s.snapshot().loaders
  check('GET returns the same record', l.length === 1 && JSON.stringify(l[0]) === JSON.stringify(r.loader))
  const keys = Object.keys(l[0]).sort().join()
  check('and only the documented fields', keys === 'createdAt,data,dur,id,kind,name,prompt,size,source,type', keys)
  const up = s.putLoader(rec({ name: 'Dots v2', createdAt: 5 }))
  check('upsert by id replaces the record', up.ok === true && s.snapshot().loaders.length === 1 && s.snapshot().loaders[0].name === 'Dots v2')
  check('dur and prompt are optional (absent when not given)', s.snapshot().loaders[0].dur === undefined && s.snapshot().loaders[0].prompt === undefined)
  const noDate = s.putLoader(rec({ id: 'nodate', createdAt: undefined }))
  check('a missing createdAt is stamped by the host', noDate.ok === true && noDate.loader.createdAt > 1_700_000_000_000)
  const lot = s.putLoader(rec({ id: 'lot', type: 'lottie', kind: 'color', data: LOTTIE() }))
  check('a lottie record keeps its JSON OBJECT and gets its serialized size', lot.ok === true && typeof lot.loader.data === 'object' && lot.loader.size === Buffer.byteLength(JSON.stringify(LOTTIE()), 'utf8'))
  const gif = s.putLoader(rec({ id: 'gif', type: 'img', kind: 'color', data: dataUrl('gif', GIF) }))
  check('an img record keeps its data URL and gets the DECODED size', gif.ok === true && gif.loader.size === GIF.length && gif.loader.data === dataUrl('gif', GIF))
  check('png and webp are accepted too', s.putLoader(rec({ id: 'p', type: 'img', kind: 'color', data: dataUrl('png', PNG) })).ok === true && s.putLoader(rec({ id: 'w', type: 'img', kind: 'color', data: dataUrl('webp', WEBP) })).ok === true)
  check('the list is ordered by creation time, then id', s.snapshot().loaders.map((x) => x.id).join() === 'dots,gif,lot,p,w,nodate', s.snapshot().loaders.map((x) => x.id).join())
}

console.log('put-loader: field validation')
{
  const s = fresh('fields')
  const bad = (label, over, re) => { const e = refused(s, rec(over)); check(label, e !== null && (re === undefined || re.test(e)), String(e)) }
  for (const id of ['', 'A', 'Dots', '-a', 'a_b', 'a b', 'a.b', 'a'.repeat(65), 5, null, undefined, {}]) bad('id ' + JSON.stringify(id) + ' is refused', { id }, /id/)
  check('a 64-character id is accepted', s.putLoader(rec({ id: 'a'.repeat(64) })).ok === true)
  check('an id may start with a digit', s.putLoader(rec({ id: '1-dots' })).ok === true)
  bad('an empty name is refused', { name: '' }, /name/)
  bad('a name of control characters only is refused', { name: ch(0) + ch(7) + ch(10) }, /name/)
  bad('a name that is not text is refused', { name: 12 }, /name/)
  bad('a 61-character name is refused', { name: 'x'.repeat(61) }, /name/)
  check('a 60-character name is accepted', s.putLoader(rec({ id: 'n60', name: 'x'.repeat(60) })).ok === true)
  const named = s.putLoader(rec({ id: 'named', name: '  Three' + ch(0) + ch(10) + 'dots\t ' }))
  check('a name is trimmed and cleaned of control characters', named.loader.name === 'Three dots', named.loader && named.loader.name)
  bad('an unknown type is refused', { type: 'gif' }, /type/)
  bad('an unknown kind is refused', { kind: 'rainbow' }, /kind/)
  bad('an unknown source is refused', { source: 'web' }, /source/)
  check('source skill is accepted', s.putLoader(rec({ id: 'sk', source: 'skill' })).ok === true)
  bad('a dur over 12 characters is refused', { dur: '1234567890123' }, /dur/)
  check('a dur of 12 characters is accepted', s.putLoader(rec({ id: 'd12', dur: '123456789012' })).ok === true)
  bad('a dur that is not text is refused', { dur: 3 }, /dur/)
  bad('a prompt over 160 characters is refused', { prompt: 'p'.repeat(161) }, /prompt/)
  check('a prompt of 160 characters is accepted', s.putLoader(rec({ id: 'p160', prompt: 'p'.repeat(160) })).ok === true)
  for (const body of [null, undefined, 'x', 3, [], [rec()]]) check('a loader that is ' + JSON.stringify(body) + ' is refused', refused(s, body) !== null)
  check('a refused record writes nothing', !existsSync(join(s.dir, 'loaders', 'x.json')) && refused(s, rec({ id: 'nope', kind: 'zzz' })) !== null && !existsSync(join(s.dir, 'loaders', 'nope.json')))
  check('sanitizeLoader never throws on hostile input', (() => { try { for (const v of [rec({ data: { toString() { throw new Error('boom') } } }), rec({ name: { toString() { throw new Error('boom') } } }), Object.create(null)]) sanitizeLoader(v); return true } catch (e) { return false } })())
}

console.log('put-loader: svg is REJECTED, never rewritten')
{
  const s = fresh('svg')
  const bad = (label, data, re) => { const e = refused(s, rec({ data })); check(label, e !== null && /svg/.test(e) && (re === undefined || re.test(e)), String(e)) }
  const hostile = {
    '<script>': svgWith('<script>alert(1)</script>'),
    '<SCRIPT> (case)': svgWith('<SCRIPT>alert(1)</SCRIPT>'),
    '<x:script> (prefixed)': '<svg xmlns="http://www.w3.org/2000/svg" xmlns:x="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><x:script>1</x:script></svg>',
    '<foreignObject>': svgWith('<foreignObject width="1" height="1"><div/></foreignObject>'),
    '<iframe>': svgWith('<iframe src="x"/>'),
    '<image>': svgWith('<image href="#a"/>'),
    '<img> (HTML breakout)': svgWith('<img src="http://x/y.png"/>'),
    '<use> with an external href': svgWith('<use href="http://x/a.svg#a"/>'),
    '<use> with xlink:href': svgWith('<use xlink:href="https://x/a.svg#a"/>'),
    '<use> with a relative href': svgWith('<use href="a.svg#a"/>'),
    '<link>': svgWith('<link rel="stylesheet" href="#a"/>'),
    '<audio>': svgWith('<audio/>'),
    '<video>': svgWith('<video/>'),
    '<embed>': svgWith('<embed/>'),
    '<object>': svgWith('<object/>'),
    '<form>': svgWith('<form action="x"/>'),
    'onload=': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" onload="x()"></svg>',
    'onclick= glued to a quote': svgWith('<g fill="red"onclick="x()"/>'),
    '<svg/onload=>': '<svg/onload=alert(1)></svg>',
    'onbegin= (SMIL)': svgWith('<circle><animate attributeName="r" onbegin="x()"/></circle>'),
    'javascript:': svgWith('<a href="javascript:alert(1)"><g/></a>'),
    'java&#x73;cript:': svgWith('<a href="java&#x73;cript:alert(1)"><g/></a>'),
    '&#106;avascript:': svgWith('<a href="&#106;avascript:alert(1)"><g/></a>'),
    '&#106avascript: (no semicolon)': svgWith('<a href="&#106avascript:alert(1)"><g/></a>'),
    'jav&Tab;ascript:': svgWith('<a href="jav&Tab;ascript:alert(1)"><g/></a>'),
    'java&NewLine;script:': svgWith('<a href="java&NewLine;script:alert(1)"><g/></a>'),
    '&amp;#106; (double encoded)': svgWith('<a href="&amp;#106;avascript:alert(1)"><g/></a>'),
    'a tab inside the scheme': svgWith('<a href="java' + ch(9) + 'script:alert(1)"><g/></a>'),
    'a zero-width space inside the scheme': svgWith('<a href="java' + ch(0x200b) + 'script:alert(1)"><g/></a>'),
    'vbscript:': svgWith('<a href="vbscript:x"><g/></a>'),
    'href to http': svgWith('<a href="http://x"><g/></a>'),
    'href to //': svgWith('<a href=//evil.example/x><g/></a>'),
    'href to data:': svgWith('<use href="data:image/svg+xml,&lt;svg/&gt;"/>'),
    'an empty href': svgWith('<a href=""><g/></a>'),
    'xlink:href to http': svgWith('<a xlink:href="http://x"><g/></a>'),
    'a namespace alias for href': svgWith('<a q:href="http://x" xmlns:q="http://www.w3.org/1999/xlink"><g/></a>'),
    'an animation that sets href': svgWith('<a><set attributeName="href" to="https://x"/><g/></a>'),
    'an animation that sets an event handler': svgWith('<g><set attributeName="onclick" to="x()"/></g>'),
    '@import': svgWith('<style>@import "x.css";</style>'),
    '@import with white space': svgWith('<style>@  import url(x.css);</style>'),
    'url(http:)': svgWith('<circle fill="url(http://x/y)"/>'),
    'url(https:) in a quote': svgWith('<style>.a{background:url("https://x/y")}</style>'),
    'url(//)': svgWith('<circle style="fill:url(//x/y)"/>'),
    'url(data:)': svgWith('<circle style="fill:url(data:image/png;base64,AA)"/>'),
    'url() to a same-origin path': svgWith('<style>.a{background:url(/kybernos/load)}</style>'),
    'url( HTTP:) (case, spaces)': svgWith('<circle style="fill:URL( HTTP://x/y )"/>'),
    'a CSS escape hiding url(': svgWith('<style>.a{background:u\\72l(http://x)}</style>'),
    'image-set()': svgWith('<style>.a{background:image-set("http://x" 1x)}</style>'),
    'src=': svgWith('<g src="x"/>'),
    'DOCTYPE': '<!DOCTYPE svg [<!ENTITY a "b">]><svg xmlns="http://www.w3.org/2000/svg"></svg>',
    'an ENTITY declaration inside': svgWith('<!ENTITY a "b">'),
    'a second element after </svg>': SVG + '<img src=x>',
    'text after </svg>': SVG + 'trailing',
    'not starting with <svg': '<html>' + SVG + '</html>',
    '<svgfoo>': '<svgfoo></svgfoo>',
    'an upper-case <SVG>': '<SVG></SVG>',
    'no closing </svg>': '<svg xmlns="http://www.w3.org/2000/svg">',
    'a NUL character': svgWith(ch(0)),
    'empty text': '   ',
    'plain text': 'hello',
  }
  for (const [label, data] of Object.entries(hostile)) bad(label + ' is refused', data)
  const before = JSON.stringify(s.snapshot())
  check('refused svgs left the store untouched', JSON.stringify(s.snapshot()) === before && s.snapshot().loaders.length === 0)
  bad('a non-text svg is refused', 42)
  bad('an svg over 200 KB is refused', svgWith('<!--' + 'x'.repeat(LIMITS.dataBytes) + '-->'), /200 KB/)
  const exact = svgWith('<!--' + 'x'.repeat(LIMITS.dataBytes - Buffer.byteLength(svgWith('<!---->'), 'utf8')) + '-->')
  check('an svg of exactly 200 KB is accepted', Buffer.byteLength(exact, 'utf8') === LIMITS.dataBytes && s.putLoader(rec({ id: 'big', data: exact })).ok === true)
  check('200 KB is counted in bytes, not characters', refused(s, rec({ id: 'big2', data: svgWith('<!--' + 'é'.repeat(LIMITS.dataBytes / 2) + '-->') })) !== null)
  const ok = {
    'the example svg': SVG,
    'an xml prolog and comments before <svg': '<?xml version="1.0" encoding="UTF-8"?>\n<!-- made by hand -->\n' + SVG + '\n<!-- end -->\n',
    'a BOM': ch(0xfeff) + SVG,
    'url(#id) and href="#id"': svgWith('<defs><linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient><circle id="c" r="3"/></defs><circle fill="url(#g)"/><use href="#c"/><use xlink:href="#c"/><circle fill="url( &quot;#g&quot; )"/>'),
    'SMIL animation': svgWith('<circle r="3"><animate attributeName="r" values="3;6;3" dur="1.2s" repeatCount="indefinite" begin="0s"/></circle>'),
    'a reduced-motion media query': svgWith('<style>@media (prefers-reduced-motion: reduce){*{animation:none!important}}</style>'),
    '<metadata> (is not <meta>)': svgWith('<metadata>x</metadata><circle r="3"/>'),
    '<feImage> to an inner id': svgWith('<filter id="f"><feImage href="#c"/></filter><circle id="c" r="3"/>'),
    'attribute names that merely contain "on"': svgWith('<circle r="3" stroke-dashoffset="1" calcMode="linear" font-size="2"/>'),
    'a CDATA style': svgWith('<style><![CDATA[.a{fill:red}]]></style>'),
  }
  for (const [label, data] of Object.entries(ok)) {
    const e = svgProblem(data)
    check(label + ' is accepted', e === null, e)
  }
  const kept = s.putLoader(rec({ id: 'kept', data: ch(0xfeff) + SVG + '\n' }))
  check('an accepted svg is stored byte for byte (never rewritten)', kept.ok === true && kept.loader.data === ch(0xfeff) + SVG + '\n')
  check('decodeEntities reads decimal, hex, double-encoded and the few named entities', decodeEntities('&#106;&#x61;&Tab;v&amp;#97;&colon;') === 'java:', decodeEntities('&#106;&#x61;&Tab;v&amp;#97;&colon;'))
}

console.log('put-loader: lottie')
{
  const s = fresh('lottie')
  const bad = (label, mut, re) => { const d = LOTTIE(); mut(d); const e = refused(s, rec({ type: 'lottie', kind: 'color', data: d })); check(label, e !== null && /lottie/.test(e) && (re === undefined || re.test(e)), String(e)) }
  check('a minimal lottie is accepted', s.putLoader(rec({ type: 'lottie', kind: 'color', data: LOTTIE() })).ok === true)
  bad('fr is required', (d) => { delete d.fr }, /fr/)
  bad('fr must be a number', (d) => { d.fr = '30' }, /fr/)
  bad('fr cannot be 0 or huge', (d) => { d.fr = 0 }, /fr/)
  bad('w is required', (d) => { delete d.w }, /"w"/)
  bad('h must be positive', (d) => { d.h = -1 }, /"h"/)
  bad('a giant canvas is refused', (d) => { d.w = 1e9 }, /"w"/)
  bad('layers must be an array', (d) => { d.layers = {} }, /layers/)
  bad('layers cannot be empty', (d) => { d.layers = [] }, /layers/)
  bad('an external http image asset is refused', (d) => { d.assets = [{ id: 'i', w: 1, h: 1, u: '', p: 'http://x/y.png', e: 0 }] }, /external|embedded/)
  bad('an https image asset is refused', (d) => { d.assets = [{ id: 'i', p: 'https://x/y.png' }] }, /external|embedded/)
  bad('a protocol-relative asset is refused', (d) => { d.assets = [{ id: 'i', p: '//x/y.png' }] })
  bad('a relative image asset is refused', (d) => { d.assets = [{ id: 'i', u: 'images/', p: 'img_0.png' }] })
  bad('an embedded asset with a base path is refused (u + p would be fetched)', (d) => { d.assets = [{ id: 'i', u: 'http://x/', p: 'data:image/png;base64,AAAA', e: 0 }] })
  bad('an svg data URL asset is refused', (d) => { d.assets = [{ id: 'i', p: 'data:image/svg+xml;base64,AAAA', e: 1 }] })
  bad('a font loaded from a path is refused', (d) => { d.fonts = { list: [{ fFamily: 'x', fPath: 'https://x/f.css', fOrigin: 'g' }] } }, /font/)
  bad('an external URL hidden in a name is refused', (d) => { d.layers[0].nm = 'http://evil.example/p.gif' }, /external/)
  bad('a javascript: string is refused', (d) => { d.layers[0].nm = 'javascript:alert(1)' }, /external/)
  bad('an eval expression is refused', (d) => { d.layers[0].ks.o.x = 'eval("1")' }, /script-like/)
  bad('a window access is refused', (d) => { d.layers[0].ks.o.x = 'var a = window.location' }, /script-like/)
  bad('a fetch() is refused', (d) => { d.layers[0].ks.o.x = 'fetch("/x")' }, /script-like/)
  bad('a <script string is refused', (d) => { d.layers[0].nm = '<script>x</script>' }, /script-like/)
  bad('a __proto__ key is refused', (d) => { d.layers[0] = JSON.parse('{"ty":4,"__proto__":{"polluted":1}}') }, /forbidden key/)
  bad('a very deep structure is refused', (d) => { let n = d.layers[0]; for (let i = 0; i < 100; i += 1) { n.c = {}; n = n.c } }, /deeply/)
  check('a lottie given as TEXT is refused (the contract is an object)', refused(s, rec({ type: 'lottie', kind: 'color', data: JSON.stringify(LOTTIE()) })) !== null)
  check('an array is refused', refused(s, rec({ type: 'lottie', kind: 'color', data: [LOTTIE()] })) !== null)
  check('data that cannot be serialized (BigInt) is refused, not thrown', /not serializable/.test(refused(s, rec({ id: 'bigint', type: 'lottie', kind: 'color', data: Object.assign(LOTTIE(), { extra: 10n }) })) || ''))
  const easing = LOTTIE(); easing.layers[0].ks.o = { a: 1, k: [{ t: 0, s: [0], i: { x: [0.5], y: [1] }, o: { x: [0.5], y: [0] } }, { t: 30, s: [100] }], x: 'var $bm_rt;\n$bm_rt = time * 2;' }
  check('"x" keys (easing, and an expression that does not reach the host) are fine', s.putLoader(rec({ id: 'easing', type: 'lottie', kind: 'color', data: easing })).ok === true)
  const embedded = LOTTIE(); embedded.assets = [{ id: 'i', w: 1, h: 1, u: '', p: dataUrl('png', PNG), e: 1 }]
  check('an embedded image asset is fine', s.putLoader(rec({ id: 'emb', type: 'lottie', kind: 'color', data: embedded })).ok === true)
  const huge = LOTTIE(); huge.layers[0].nm = 'x'.repeat(LIMITS.dataBytes)
  check('a lottie over 200 KB serialized is refused', /200 KB/.test(refused(s, rec({ id: 'hugel', type: 'lottie', kind: 'color', data: huge })) || ''))
}

console.log('put-loader: img')
{
  const s = fresh('img')
  const img = (data) => refused(s, rec({ type: 'img', kind: 'color', data }))
  check('a gif data URL is accepted', s.putLoader(rec({ type: 'img', kind: 'color', data: dataUrl('gif', GIF) })).ok === true)
  check('image/jpeg is refused', img(dataUrl('jpeg', GIF)) !== null)
  check('image/svg+xml is refused', img('data:image/svg+xml;base64,' + Buffer.from(SVG).toString('base64')) !== null)
  check('a data URL that is not base64 is refused', img('data:image/gif,GIF89a') !== null)
  check('a plain http URL is refused', img('http://x/y.gif') !== null)
  check('text/html data is refused', img('data:text/html;base64,' + Buffer.from('<script>1</script>').toString('base64')) !== null)
  check('base64 that does not decode is refused', img('data:image/gif;base64,@@@@') !== null)
  check('base64 with bad padding is refused', img('data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA') !== null)
  check('bytes that are not the declared format are refused', /not a GIF/.test(img(dataUrl('gif', PNG)) || ''))
  check('a payload that is not an image at all is refused', img(dataUrl('png', Buffer.from('<script>alert(1)</script>'))) !== null)
  check('data that is not a string is refused', img({ a: 1 }) !== null && img(null) !== null)
  check('an image over 200 KB decoded is refused', /200 KB/.test(img(dataUrl('gif', Buffer.concat([GIF, Buffer.alloc(LIMITS.dataBytes)]))) || ''))
  const nearly = Buffer.concat([GIF, Buffer.alloc(LIMITS.dataBytes - GIF.length)])
  check('an image of exactly 200 KB decoded is accepted', nearly.length === LIMITS.dataBytes && s.putLoader(rec({ id: 'edge', type: 'img', kind: 'color', data: dataUrl('gif', nearly) })).ok === true)
  check('an absurd string is refused before any decoding', img('data:image/gif;base64,' + 'A'.repeat(5 * 1024 * 1024)) !== null)
}

console.log('limits')
{
  const s = fresh('limit')
  for (let i = 0; i < LIMITS.loaders; i += 1) if (s.putLoader(rec({ id: 'l' + i, createdAt: i })).ok !== true) throw new Error('could not fill the store')
  const over = s.putLoader(rec({ id: 'extra' }))
  check('the 31st loader is refused with the documented message', over.ok === false && over.error === 'too many loaders (30 max)', JSON.stringify(over))
  check('… and nothing was written for it', !existsSync(join(s.dir, 'loaders', 'extra.json')) && s.snapshot().loaders.length === 30)
  check('replacing one of the 30 still works', s.putLoader(rec({ id: 'l7', name: 'Seven' })).ok === true && s.snapshot().loaders.find((x) => x.id === 'l7').name === 'Seven')
  s.deleteLoader('l0')
  check('after a delete there is room again', s.putLoader(rec({ id: 'extra' })).ok === true && s.snapshot().loaders.length === 30)
  const bare = fresh('limit-bare')
  mkdirSync(join(bare.dir, 'loaders'), { recursive: true })
  for (let i = 0; i < LIMITS.bare + 5; i += 1) writeFileSync(join(bare.dir, 'loaders', 'b' + String(i).padStart(3, '0') + '.svg'), SVG)
  const snap = bare.snapshot()
  check('bare svg files are capped (' + LIMITS.bare + ') and the rest is reported', snap.loaders.length === LIMITS.bare && snap.skipped.length === 5 && /too many/.test(snap.skipped[0].reason), snap.loaders.length + ' / ' + JSON.stringify(snap.skipped[0]))
  check('imported loaders do not count the bare files', bare.putLoader(rec({ id: 'mine' })).ok === true)
}

console.log('delete-loader')
{
  const s = fresh('del')
  s.putLoader(rec({ id: 'a' }))
  s.putLoader(rec({ id: 'b' }))
  check('delete removes the record', s.deleteLoader('a').ok === true && !existsSync(join(s.dir, 'loaders', 'a.json')) && s.snapshot().loaders.length === 1)
  check('delete is idempotent', s.deleteLoader('a').ok === true && s.deleteLoader('never-existed').ok === true)
  check('it leaves no tombstone behind (the folder holds only what is left)', tree(s.dir).join() === 'loaders/b.json', tree(s.dir).join())
  writeFileSync(join(s.dir, 'loaders', 'rain.svg'), SVG)
  check('a bare file shows up under f-<name>', s.snapshot().loaders.some((x) => x.id === 'f-rain'))
  check('deleting f-<name> removes the bare file too', s.deleteLoader('f-rain').ok === true && !existsSync(join(s.dir, 'loaders', 'rain.svg')) && !s.snapshot().loaders.some((x) => x.id === 'f-rain'))
  writeFileSync(join(s.dir, 'loaders', 'keep.svg'), SVG)
  s.deleteLoader('keep')
  check('an id WITHOUT the f- prefix never deletes a bare file', existsSync(join(s.dir, 'loaders', 'keep.svg')))
  s.putLoader(rec({ id: 'f-both' }))
  writeFileSync(join(s.dir, 'loaders', 'both.svg'), SVG)
  s.deleteLoader('f-both')
  check('f-<name> removes both the JSON record and the bare file', !existsSync(join(s.dir, 'loaders', 'f-both.json')) && !existsSync(join(s.dir, 'loaders', 'both.svg')))
  for (const id of ['', null, undefined, 5, {}, '../b', 'A']) check('delete of ' + JSON.stringify(id) + ' is refused', s.deleteLoader(id).ok === false)
}

console.log('path traversal, long ids, __proto__')
{
  const base = join(root, 'trav')
  const s = createLoaderStore({ dir: join(base, 'kybernos'), now: () => 1 })
  writeFileSync(join(root, 'outside.json'), 'keep')
  s.putLoader(rec({ id: 'seed' }))
  const before = tree(root).join('|')
  const ids = ['../x', '../../x', 'a/b', 'a\\b', '.', '..', '...', '/etc/passwd', 'x/../../y', '%2e%2e%2fx', 'a'.repeat(65), 'a'.repeat(5000), '__proto__', 'constructor/..', '', ' ', 'a b', 'a\n', 'a' + ch(0), '.json', 'x.json', 'ä']
  let accepted = []
  for (const id of ids) {
    if (s.putLoader(rec({ id })).ok !== false) accepted.push('put:' + id)
    if (s.deleteLoader(id).ok !== false) accepted.push('del:' + id)
    if (handleLoaderStore(s, { method: 'POST', body: { op: 'put-loader', loader: rec({ id }) } }).body.ok !== false) accepted.push('http:' + id)
  }
  check('no hostile id is accepted, by put, delete or the handler', accepted.length === 0, accepted.join(' '))
  check('nothing was created or removed outside the loaders folder', tree(root).join('|') === before && readFileSync(join(root, 'outside.json'), 'utf8') === 'keep')
  check('ids that merely look odd but are valid still work (constructor, toString)', s.putLoader(rec({ id: 'constructor' })).ok === true && s.putLoader(rec({ id: 'tostring' })).ok === true && s.snapshot().loaders.some((x) => x.id === 'constructor'))
  check('a hand-planted file with an odd name is ignored', (() => { writeFileSync(join(base, 'kybernos', 'loaders', 'X Y.json'), '{}'); writeFileSync(join(base, 'kybernos', 'loaders', '..json'), '{}'); return s.snapshot().loaders.length === 3 })())
  const parsed = JSON.parse('{"op":"put-settings","settings":{"__proto__":{"polluted":1},"constructor":{"prototype":{"polluted":2}},"speed":1}}')
  const r = handleLoaderStore(s, { method: 'POST', body: parsed })
  check('a __proto__ / constructor payload pollutes nothing and is not stored', r.status === 200 && ({}).polluted === undefined && !('polluted' in r.body.settings) && r.body.settings.__proto__ === Object.prototype)
}

console.log('settings')
{
  const s = fresh('settings')
  check('no settings reads as null', s.readSettings() === null)
  const r = s.putSettings({ sel: ['a', 'b'], mode: 'order', size: 'large', tint: false, keep: false, speed: 1.5, avoid: false, delay: 120, pack: 'perso', rot: '15', dur: false, junk: 1, updatedAt: 5 })
  check('put-settings stores and returns the stamped version', r.ok === true && r.settings.mode === 'order' && r.settings.size === 'large' && r.settings.tint === false && r.settings.keep === false && r.settings.speed === 1.5 && r.settings.avoid === false && r.settings.delay === 120 && r.settings.pack === 'perso' && r.settings.rot === '15' && r.settings.dur === false, JSON.stringify(r))
  check('updatedAt is stamped by the host (the client value is ignored)', r.settings.updatedAt > 1_700_000_000_000 && r.settings.updatedAt !== 5)
  check('unknown keys are dropped', r.settings.junk === undefined && Object.keys(r.settings).sort().join() === 'avoid,delay,dur,keep,mode,pack,rot,sel,size,speed,tint,updatedAt')
  check('the file on disk is the same object', JSON.stringify(JSON.parse(readFileSync(join(s.dir, 'loader-settings.json'), 'utf8'))) === JSON.stringify(r.settings))
  check('GET returns it back', JSON.stringify(s.readSettings()) === JSON.stringify(r.settings) && JSON.stringify(s.snapshot().settings) === JSON.stringify(r.settings))
  const d = sanitizeSettings({}, 7)
  check('defaults: sel [], random, standard, tint, keep, speed 1, avoid, delay 300, pack dsh, fixed, dur', JSON.stringify(d) === JSON.stringify(Object.assign({}, DEFAULT_SETTINGS, { sel: [], updatedAt: 7 })) && d.mode === 'random' && d.size === 'standard' && d.tint === true && d.keep === true && d.speed === 1 && d.avoid === true && d.delay === 300 && d.pack === 'dsh' && d.rot === 'fixed' && d.dur === true && d.sel.length === 0)
  check('the defaults are not shared between calls', (() => { const a = sanitizeSettings({}, 1); a.sel.push('x'); return sanitizeSettings({}, 1).sel.length === 0 && DEFAULT_SETTINGS.sel.length === 0 })())
  const c = (v, k) => sanitizeSettings(v, 0)[k]
  check('speed is clamped to 0.5 - 2', c({ speed: 0.1 }, 'speed') === 0.5 && c({ speed: 9 }, 'speed') === 2 && c({ speed: 1.25 }, 'speed') === 1.25 && c({ speed: -3 }, 'speed') === 0.5)
  check('speed of the wrong type falls back to 1', c({ speed: '2' }, 'speed') === 1 && c({ speed: NaN }, 'speed') === 1 && c({ speed: Infinity }, 'speed') === 1 && c({ speed: null }, 'speed') === 1)
  check('delay is an integer clamped to 0 - 1000', c({ delay: -5 }, 'delay') === 0 && c({ delay: 5000 }, 'delay') === 1000 && c({ delay: 12.6 }, 'delay') === 13 && c({ delay: '50' }, 'delay') === 300)
  check('mode, size and rot accept only their values', c({ mode: 'order' }, 'mode') === 'order' && c({ mode: 'x' }, 'mode') === 'random' && c({ size: 'compact' }, 'size') === 'compact' && c({ size: 'huge' }, 'size') === 'standard' && c({ rot: '8' }, 'rot') === '8' && c({ rot: 8 }, 'rot') === 'fixed' && c({ rot: '9' }, 'rot') === 'fixed')
  check('booleans must be booleans', c({ tint: 0 }, 'tint') === true && c({ keep: 'no' }, 'keep') === true && c({ avoid: null }, 'avoid') === true && c({ dur: 1 }, 'dur') === true && c({ tint: false }, 'tint') === false)
  check('pack: id-like, 40 characters at most, perso allowed', c({ pack: 'perso' }, 'pack') === 'perso' && c({ pack: 'x'.repeat(40) }, 'pack') === 'x'.repeat(40) && c({ pack: 'x'.repeat(41) }, 'pack') === 'dsh' && c({ pack: '../x' }, 'pack') === 'dsh' && c({ pack: 'A' }, 'pack') === 'dsh' && c({ pack: 3 }, 'pack') === 'dsh')
  check('sel keeps at most 4 valid, distinct ids, in order', JSON.stringify(c({ sel: ['a', 'a', 'B', '../x', 'b', 3, null, 'c', 'd', 'e'] }, 'sel')) === JSON.stringify(['a', 'b', 'c', 'd']) && JSON.stringify(c({ sel: 'a' }, 'sel')) === '[]' && JSON.stringify(c({ sel: { 0: 'a' } }, 'sel')) === '[]')
  check('settings that are not an object are refused', s.putSettings(null).ok === false && s.putSettings('x').ok === false && s.putSettings([1]).ok === false)
  check('an empty object stores the defaults', (() => { const e = s.putSettings({}); return e.ok === true && e.settings.delay === 300 && e.settings.pack === 'dsh' })())
  writeFileSync(join(s.dir, 'loader-settings.json'), JSON.stringify({ mode: 'order', speed: 99, evil: 1 }))
  utimesSync(join(s.dir, 'loader-settings.json'), new Date(1_600_000_000_000), new Date(1_600_000_000_000))
  const hand = s.readSettings()
  check('a hand-edited file is re-sanitized on read', hand.mode === 'order' && hand.speed === 2 && hand.evil === undefined && hand.size === 'standard')
  check('… and without updatedAt it takes the file time', hand.updatedAt === 1_600_000_000_000, String(hand.updatedAt))
  writeFileSync(join(s.dir, 'loader-settings.json'), '{ not json')
  check('a damaged settings file reads as null (never an error) …', s.readSettings() === null && s.snapshot().settings === null)
  check('… and is set aside, not deleted', readdirSync(s.dir).some((n) => n.startsWith('loader-settings.json.bad-')))
  check('settings can be written again afterwards', s.putSettings({ mode: 'order' }).ok === true && s.readSettings().mode === 'order')
  writeFileSync(join(s.dir, 'loader-settings.json'), '[1,2]')
  check('a settings file that is not an object reads as null', s.readSettings() === null)
}

console.log('words')
{
  const s = fresh('words')
  check('no words reads as null', s.readWords() === null)
  const r = s.putWords(['  Reviewing   guidelines ', 'reviewing guidelines', 'Preparing the file', '', '   ', 7, null, 'x'.repeat(41), 'x'.repeat(40), 'Line' + ch(10) + 'break', 'Nul' + ch(0) + 'byte'])
  check('put-words returns the sanitized list', r.ok === true && JSON.stringify(r.words) === JSON.stringify(['Reviewing guidelines', 'Preparing the file', 'x'.repeat(40), 'Line break', 'Nul byte']), JSON.stringify(r))
  check('trimmed, de-duplicated (case-insensitive), 1-40 characters, control characters gone', r.words.every((w) => w === w.trim() && w.length >= 1 && w.length <= 40 && !/[\u0000-\u001f]/.test(w)))
  const file = JSON.parse(readFileSync(join(s.dir, 'loading-text.json'), 'utf8'))
  check('the file is {version:1, words, updatedAt}', file.version === 1 && Array.isArray(file.words) && file.words.length === 5 && file.updatedAt > 1_700_000_000_000)
  check('GET returns the words', JSON.stringify(s.snapshot().words) === JSON.stringify(r.words))
  const many = Array.from({ length: 60 }, (_, i) => 'Word ' + i)
  check('at most 40 words are kept (the first ones)', (() => { const m = s.putWords(many); return m.words.length === 40 && m.words[0] === 'Word 0' && m.words[39] === 'Word 39' })())
  check('the keys of an empty list are kept as an empty list (not null)', JSON.stringify(s.putWords([]).words) === '[]' && JSON.stringify(s.readWords()) === '[]')
  check('words that are not an array are refused', s.putWords('x').ok === false && s.putWords({ 0: 'a' }).ok === false && s.putWords(null).ok === false && s.putWords(undefined).ok === false)
  check('sanitizeWords on a non-array is empty', sanitizeWords('abc').length === 0)
  writeFileSync(join(s.dir, 'loading-text.json'), JSON.stringify({ words: ['  Hand written ', 'hand WRITTEN', 'Another one', 3] }))
  check('the shape the skill writes by hand ({words}) is accepted and re-sanitized', JSON.stringify(s.readWords()) === JSON.stringify(['Hand written', 'Another one']))
  writeFileSync(join(s.dir, 'loading-text.json'), JSON.stringify(['Bare', 'array', 'Bare']))
  check('a bare array is accepted too', JSON.stringify(s.readWords()) === JSON.stringify(['Bare', 'array']))
  writeFileSync(join(s.dir, 'loading-text.json'), 'nope{')
  check('a damaged words file reads as null …', s.readWords() === null && s.snapshot().words === null)
  check('… and is set aside', readdirSync(s.dir).some((n) => n.startsWith('loading-text.json.bad-')))
  writeFileSync(join(s.dir, 'loading-text.json'), JSON.stringify({ version: 1, words: 'oops' }))
  check('a words file without a list reads as null', s.readWords() === null)
}

console.log('bare svg discovery')
{
  const s = fresh('bare')
  const dir = join(s.dir, 'loaders')
  mkdirSync(dir, { recursive: true })
  const mono = svgWith('<circle fill="currentColor" r="4"/>')
  const colour = svgWith('<circle fill="#ff0000" r="4"/>')
  writeFileSync(join(dir, 'three-bouncing-dots.svg'), mono)
  writeFileSync(join(dir, 'red-ring.svg'), colour)
  writeFileSync(join(dir, 'caps.svg'), svgWith('<circle fill="CurrentColor" r="4"/>'))
  utimesSync(join(dir, 'three-bouncing-dots.svg'), new Date(1_650_000_000_000), new Date(1_650_000_000_000))
  const snap = s.snapshot()
  const dots = snap.loaders.find((x) => x.id === 'f-three-bouncing-dots')
  check('a bare svg becomes a record f-<name>', dots !== undefined)
  check('with the documented fields', dots.type === 'svg' && dots.source === 'skill' && dots.name === 'Three bouncing dots' && dots.size === Buffer.byteLength(mono, 'utf8') && dots.data === mono && dots.createdAt === 1_650_000_000_000 && Object.keys(dots).sort().join() === 'createdAt,data,id,kind,name,size,source,type', JSON.stringify(Object.keys(dots)))
  check('kind is mono when the text has currentColor (any case), color otherwise', dots.kind === 'mono' && snap.loaders.find((x) => x.id === 'f-red-ring').kind === 'color' && snap.loaders.find((x) => x.id === 'f-caps').kind === 'mono')
  check('the name has its hyphens turned into spaces and a capital', snap.loaders.find((x) => x.id === 'f-red-ring').name === 'Red ring')
  check('nothing is skipped when everything is valid', snap.skipped.length === 0)
  check('GET does not create or rewrite anything', tree(s.dir).join() === 'loaders/caps.svg,loaders/red-ring.svg,loaders/three-bouncing-dots.svg')
  writeFileSync(join(dir, 'bad-script.svg'), svgWith('<script>1</script>'))
  writeFileSync(join(dir, 'Upper.svg'), SVG)
  writeFileSync(join(dir, 'with space.svg'), SVG)
  writeFileSync(join(dir, 'shout.SVG'), SVG)
  writeFileSync(join(dir, 'x'.repeat(62) + '.svg'), SVG)
  writeFileSync(join(dir, 'huge.svg'), svgWith('<!--' + 'x'.repeat(LIMITS.dataBytes) + '-->'))
  writeFileSync(join(dir, 'not-svg.svg'), 'hello')
  writeFileSync(join(dir, 'ext-ref.svg'), svgWith('<circle fill="url(http://x/y)"/>'))
  mkdirSync(join(dir, 'a-folder.svg'))
  writeFileSync(join(dir, 'notes.txt'), 'x')
  writeFileSync(join(dir, 'a.svg.tmp'), SVG)
  const snap2 = s.snapshot()
  const skipped = Object.fromEntries(snap2.skipped.map((x) => [x.file, x.reason]))
  check('valid ones are still listed next to invalid ones', snap2.loaders.length === 3)
  for (const f of ['bad-script.svg', 'Upper.svg', 'with space.svg', 'shout.SVG', 'x'.repeat(62) + '.svg', 'huge.svg', 'not-svg.svg', 'ext-ref.svg', 'a-folder.svg']) check(f.slice(0, 20) + ' is skipped with a reason', typeof skipped[f] === 'string' && skipped[f].length > 0, JSON.stringify(skipped[f]))
  check('files that are not .svg are neither loaded nor reported', skipped['notes.txt'] === undefined && skipped['a.svg.tmp'] === undefined)
  check('the reasons say what is wrong', /script/.test(skipped['bad-script.svg']) && /name/.test(skipped['Upper.svg']) && /200 KB/.test(skipped['huge.svg']) && /<svg/.test(skipped['not-svg.svg']) && /url\(\)/.test(skipped['ext-ref.svg']))
  check('skipped files are NOT deleted', existsSync(join(dir, 'bad-script.svg')) && existsSync(join(dir, 'Upper.svg')) && existsSync(join(dir, 'huge.svg')))
  s.putLoader(rec({ id: 'f-red-ring', name: 'Mine', data: SVG, kind: 'mono' }))
  const won = s.snapshot().loaders.filter((x) => x.id === 'f-red-ring')
  check('a JSON record with the same id wins over the bare file', won.length === 1 && won[0].name === 'Mine' && won[0].data === SVG)
  check('… and the bare file is not reported as skipped', !s.snapshot().skipped.some((x) => x.file === 'red-ring.svg'))
}

console.log('damaged files')
{
  const s = fresh('bad')
  const dir = join(s.dir, 'loaders')
  mkdirSync(dir, { recursive: true })
  s.putLoader(rec({ id: 'good' }))
  writeFileSync(join(dir, 'broken.json'), '{ not json')
  writeFileSync(join(dir, 'array.json'), '[1,2]')
  writeFileSync(join(dir, 'null.json'), 'null')
  writeFileSync(join(dir, 'wrong-id.json'), JSON.stringify(rec({ id: 'other' })))
  writeFileSync(join(dir, 'planted.json'), JSON.stringify(rec({ id: 'planted', data: svgWith('<script>alert(1)</script>') })))
  writeFileSync(join(dir, 'half.json'), JSON.stringify(rec({ id: 'half' })).slice(0, 40))
  const snap = s.snapshot()
  check('a damaged store never fails the read; the good record survives', snap.ok === true && snap.loaders.map((x) => x.id).join() === 'good', snap.loaders.map((x) => x.id).join())
  const names = readdirSync(dir)
  check('damaged JSON is set aside (.bad-<time>), not deleted', names.some((n) => n.startsWith('broken.json.bad-')) && names.some((n) => n.startsWith('half.json.bad-')) && names.some((n) => n.startsWith('array.json.bad-')) && names.some((n) => n.startsWith('null.json.bad-')))
  check('a record that parses but is not valid is skipped and left where it is', names.includes('planted.json') && names.includes('wrong-id.json') && snap.skipped.some((x) => x.file === 'planted.json' && /script/.test(x.reason)) && snap.skipped.some((x) => x.file === 'wrong-id.json'))
  check('a hand-planted script in a stored record is never served', !JSON.stringify(snap).includes('alert(1)'))
  check('after being set aside, the id can be written again', s.putLoader(rec({ id: 'broken' })).ok === true && s.snapshot().loaders.some((x) => x.id === 'broken'))
  const again = s.snapshot()
  check('and a second read is stable (the aside files are ignored)', again.loaders.length === 2)
}

console.log('hostile directories and pathological input')
{
  const s = fresh('hostile')
  const dir = join(s.dir, 'loaders')
  mkdirSync(dir, { recursive: true })
  for (let i = 0; i < LIMITS.loaders + 6; i += 1) writeFileSync(join(dir, 'r' + String(i).padStart(2, '0') + '.json'), JSON.stringify(rec({ id: 'r' + String(i).padStart(2, '0'), createdAt: i })))
  const snap = s.snapshot()
  check('more record files than the cap: the first ' + LIMITS.loaders + ' are served, the rest reported (not read)', snap.loaders.length === LIMITS.loaders && snap.skipped.length === 6 && /too many loaders/.test(snap.skipped[0].reason), snap.loaders.length + ' ' + JSON.stringify(snap.skipped[0]))
  const big = fresh('hostile-big')
  mkdirSync(join(big.dir, 'loaders'), { recursive: true })
  writeFileSync(join(big.dir, 'loaders', 'huge.json'), JSON.stringify(rec({ id: 'huge', name: 'x'.repeat(LIMITS.recordBytes) })))
  const bigSnap = big.snapshot()
  check('a record file far over the size cap is skipped without being parsed', bigSnap.loaders.length === 0 && bigSnap.skipped.length === 1 && /too large/.test(bigSnap.skipped[0].reason) && existsSync(join(big.dir, 'loaders', 'huge.json')))
  const junk = fresh('hostile-junk')
  mkdirSync(join(junk.dir, 'loaders'), { recursive: true })
  for (let i = 0; i < 120; i += 1) writeFileSync(join(junk.dir, 'loaders', 'Bad Name ' + i + '.svg'), SVG)
  const junkSnap = junk.snapshot()
  check('the skipped list is capped, with a count of the rest', junkSnap.skipped.length === LIMITS.skipped + 1 && junkSnap.skipped[junkSnap.skipped.length - 1].reason === '70 more', JSON.stringify(junkSnap.skipped[junkSnap.skipped.length - 1]))
  if (typeof process.getuid === 'function' && process.getuid() !== 0) {
    const lock = fresh('hostile-lock')
    mkdirSync(join(lock.dir, 'loaders'), { recursive: true })
    writeFileSync(join(lock.dir, 'loader-settings.json'), JSON.stringify({ mode: 'order' }))
    writeFileSync(join(lock.dir, 'loaders', 'x.json'), JSON.stringify(rec({ id: 'x' })))
    chmodSync(join(lock.dir, 'loader-settings.json'), 0)
    chmodSync(join(lock.dir, 'loaders', 'x.json'), 0)
    const lockSnap = lock.snapshot()
    check('a file that cannot be READ is not "damaged": it is reported and never set aside', lockSnap.settings === null && lockSnap.skipped.some((e) => e.file === 'x.json' && e.reason === 'unreadable') && tree(lock.dir).every((f) => !f.includes('.bad-')), tree(lock.dir).join())
    chmodSync(join(lock.dir, 'loader-settings.json'), 0o644)
    chmodSync(join(lock.dir, 'loaders', 'x.json'), 0o644)
    check('… and is served again as soon as it can be read', lock.snapshot().settings.mode === 'order' && lock.snapshot().loaders.length === 1)
  }
  // Linear time on 200 KB of the inputs that make naive regexes blow up.
  const n = 200000
  const nasty = {
    'unterminated href quotes': svgWith(' href="'.repeat(n / 7)),
    'unterminated comments': svgWith('<!--'.repeat(n / 4)),
    'entity soup': svgWith('&#'.repeat(n / 2)),
    'nested amps': svgWith('&amp;'.repeat(n / 5)),
    'many < and spaces': svgWith('<   '.repeat(n / 4)),
    'long prefixed names': svgWith('<' + 'a'.repeat(n)),
    'many on-attributes': svgWith(' onx'.repeat(n / 4)),
    'many url(': svgWith('url( '.repeat(n / 5)),
    'many closing tags': svgWith('</svg>'.repeat(n / 6)),
  }
  for (const [label, data] of Object.entries(nasty)) {
    const t0 = Date.now()
    const e = svgProblem(data)
    const ms = Date.now() - t0
    check(label + ' (200 KB) is judged in linear time', ms < 1500 && e !== undefined, ms + ' ms')
  }
}

console.log('atomic write and write failures')
{
  const s = fresh('atomic')
  s.putLoader(rec({ id: 'keep', name: 'Original' }))
  mkdirSync(join(s.dir, 'loaders', 'keep.json.tmp'))
  const r = s.putLoader(rec({ id: 'keep', name: 'Changed' }))
  check('a write that fails reports an error and does not throw', r.ok === false && /could not write/.test(r.error), JSON.stringify(r))
  check('the previous version is intact', JSON.parse(readFileSync(join(s.dir, 'loaders', 'keep.json'), 'utf8')).name === 'Original')
  rmSync(join(s.dir, 'loaders', 'keep.json.tmp'), { recursive: true })
  check('and it works again once the obstacle is gone', s.putLoader(rec({ id: 'keep', name: 'Changed' })).ok === true && JSON.parse(readFileSync(join(s.dir, 'loaders', 'keep.json'), 'utf8')).name === 'Changed')
  check('a failed write leaves no .tmp file', tree(s.dir).every((f) => !f.endsWith('.tmp')))
  const blocked = createLoaderStore({ dir: join(root, 'atomic', 'loaders', 'keep.json'), now: () => 1 })
  check('every write op reports (never throws) when the folder cannot be made', blocked.putLoader(rec()).ok === false && blocked.putSettings({}).ok === false && blocked.putWords(['a']).ok === false)
  check('a delete that cannot proceed reports (never throws)', (() => { const x = createLoaderStore({ dir: join(root, 'atomic', 'loaders', 'keep.json', 'nope') }); return x.deleteLoader('a').ok === true || x.deleteLoader('a').ok === false })())
  for (let i = 0; i < 20; i += 1) s.putSettings({ delay: i })
  check('many writes leave exactly one settings file and no .tmp', tree(s.dir).filter((f) => f.startsWith('loader-settings')).join() === 'loader-settings.json')
}

console.log('request handler')
{
  const s = fresh('handler')
  let r = handleLoaderStore(s, { method: 'GET' })
  check('GET on an empty store: 200 {ok, loaders:[], settings:null, words:null}', r.status === 200 && r.body.ok === true && Array.isArray(r.body.loaders) && r.body.loaders.length === 0 && r.body.settings === null && r.body.words === null)
  r = handleLoaderStore(s, { method: 'POST', body: { op: 'put-loader', loader: rec({ id: 'h1' }) } })
  check('put-loader: 200 {ok, loader}', r.status === 200 && r.body.ok === true && r.body.loader.id === 'h1')
  r = handleLoaderStore(s, { method: 'POST', body: { op: 'put-loader', loader: rec({ id: '../x' }) } })
  check('put-loader refused: a normal 200 {ok:false, error} (no red console line for a bad import)', r.status === 200 && r.body.ok === false && typeof r.body.error === 'string')
  r = handleLoaderStore(s, { method: 'POST', body: { op: 'put-settings', settings: { speed: 2 } } })
  check('put-settings: 200 {ok, settings} (stamped)', r.status === 200 && r.body.ok === true && r.body.settings.speed === 2 && r.body.settings.updatedAt > 0)
  r = handleLoaderStore(s, { method: 'POST', body: { op: 'put-words', words: ['A', 'a', 'B'] } })
  check('put-words: 200 {ok, words}', r.status === 200 && r.body.ok === true && r.body.words.join() === 'A,B')
  r = handleLoaderStore(s, { method: 'GET' })
  check('GET now returns all four parts', r.body.loaders.length === 1 && r.body.settings.speed === 2 && r.body.words.join() === 'A,B' && Array.isArray(r.body.skipped))
  r = handleLoaderStore(s, { method: 'POST', body: { op: 'delete-loader', id: 'h1' } })
  check('delete-loader: 200 {ok:true}', r.status === 200 && r.body.ok === true && Object.keys(r.body).join() === 'ok')
  check('an unknown op is 400', handleLoaderStore(s, { method: 'POST', body: { op: 'drop-everything' } }).status === 400 && handleLoaderStore(s, { method: 'POST', body: {} }).status === 400 && handleLoaderStore(s, { method: 'POST', body: { op: 'toString' } }).status === 400)
  check('a body that is not an object is 400', handleLoaderStore(s, { method: 'POST', body: 'x' }).status === 400 && handleLoaderStore(s, { method: 'POST', body: null }).status === 400 && handleLoaderStore(s, { method: 'POST', body: [1] }).status === 400)
  check('other methods are 405', handleLoaderStore(s, { method: 'PUT' }).status === 405 && handleLoaderStore(s, { method: 'DELETE' }).status === 405 && handleLoaderStore(s, { method: 'HEAD' }).status === 405)
}

console.log('route (origin guard, home, body)')
{
  const home = join(root, 'home')
  const mk = (over) => {
    const sent = []
    const io = Object.assign({
      home: async () => home,
      sameOriginStrict: () => true,
      sameOriginLax: () => true,
      readJson: async () => ({}),
      send: (res, status, body) => sent.push({ status, body }),
    }, over || {})
    return { io, sent }
  }
  const run = async (req, over) => { const k = mk(over); await serveLoaderStore(req, {}, k.io); return k.sent[0] }
  let r = await run({ method: 'POST' }, { readJson: async () => ({ op: 'put-loader', loader: rec({ id: 'viaroute' }) }) })
  check('POST writes under <home>/kybernos/loaders/', r.status === 200 && r.body.ok === true && existsSync(join(home, 'kybernos', 'loaders', 'viaroute.json')), JSON.stringify(r))
  r = await run({ method: 'POST' }, { readJson: async () => ({ op: 'put-settings', settings: { mode: 'order' } }) })
  check('settings land in <home>/kybernos/loader-settings.json', r.status === 200 && existsSync(join(home, 'kybernos', 'loader-settings.json')))
  r = await run({ method: 'POST' }, { readJson: async () => ({ op: 'put-words', words: ['One'] }) })
  check('words land in <home>/kybernos/loading-text.json', r.status === 200 && existsSync(join(home, 'kybernos', 'loading-text.json')))
  r = await run({ method: 'GET' })
  check('GET reads it all back', r.status === 200 && r.body.ok === true && r.body.loaders.length === 1 && r.body.settings.mode === 'order' && r.body.words.join() === 'One')
  r = await run({ method: 'POST' }, { sameOriginStrict: () => false })
  check('a write from another origin (or with none) is refused (403)', r.status === 403 && r.body.ok === false)
  let touched = false
  await run({ method: 'POST' }, { sameOriginStrict: () => false, readJson: async () => { touched = true; return {} } })
  check('… the body is not even read', touched === false)
  r = await run({ method: 'GET' }, { sameOriginLax: () => false })
  check('a read from a foreign origin is refused (403)', r.status === 403)
  r = await run({ method: 'GET' }, { sameOriginStrict: () => false })
  check('a read only needs the lax check (a direct navigation has no Origin)', r.status === 200)
  r = await run({ method: 'POST' }, { readJson: async () => { throw new Error('too big') } })
  check('a body over the cap is 413', r.status === 413 && r.body.ok === false)
  let cap = null
  await run({ method: 'POST' }, { readJson: async (req, max) => { cap = max; return { op: 'put-words', words: [] } } })
  check('the body is capped at 400 KB (' + MAX_BODY_BYTES + ' bytes)', cap === 400 * 1024 && MAX_BODY_BYTES === 409600)
  r = await run({ method: 'GET' }, { home: async () => null })
  check('no DSH home: 200 {ok:false, error:"DSH home not found"}, nothing written', r.status === 200 && r.body.ok === false && r.body.error === 'DSH home not found')
  r = await run({ method: 'POST' }, { home: async () => '' })
  check('… for a write too', r.status === 200 && r.body.error === 'DSH home not found')
  check('PUT / DELETE / HEAD are 405', (await run({ method: 'PUT' })).status === 405 && (await run({ method: 'DELETE' })).status === 405 && (await run({ method: 'HEAD' })).status === 405)
  r = await run({ method: 'GET' }, { home: async () => { throw new Error('boom') } })
  check('a fault inside the route is a JSON 500, never an exception out of the handler', r.status === 500 && r.body.ok === false && /boom/.test(r.body.error))
  r = await run({ method: 'POST' }, { readJson: async () => ({ op: 'put-loader', loader: rec({ id: '../../etc/x' }) }) })
  check('a path in the id is refused ({ok:false}) and nothing is written outside the folder', r.status === 200 && r.body.ok === false && !existsSync(join(root, 'etc')) && !existsSync(join(home, 'etc')))
  r = await run({ method: 'POST' }, { readJson: async () => 'not an object' })
  check('a body that is not an object is 400', r.status === 400)
  writeFileSync(join(home, 'kybernos', 'loader-settings.json'), '{ broken')
  writeFileSync(join(home, 'kybernos', 'loading-text.json'), 'also broken')
  writeFileSync(join(home, 'kybernos', 'loaders', 'junk.json'), '{ broken')
  r = await run({ method: 'GET' })
  check('damaged files on disk never make a 5xx: still 200, the good records are served', r.status === 200 && r.body.ok === true && r.body.settings === null && r.body.words === null && r.body.loaders.length === 1)
}

console.log('host plugin (index.js) with a fake ctx')
{
  const savedEnv = { DSH_HOME: process.env.DSH_HOME, HOME: process.env.HOME }
  const savedConsole = { log: console.log, error: console.error }
  const hostHome = join(root, 'host-home')
  process.env.DSH_HOME = hostHome
  const logs = []
  const errors = []
  const fakeCtx = (opts = {}) => {
    const registered = []
    const effects = []
    const svc = { register: (route) => { if (opts.throwOn !== undefined && opts.throwOn(route)) throw new Error('duplicate exact route'); registered.push(route); return () => {} } }
    const ctx = {
      effect: (fn, label) => { effects.push(label); return fn() },
      inject: (names, fn) => {
        if (opts.injectThrows) throw new Error('inject exploded')
        ctx.injected = names
        fn({ get: (n) => (n === 'webServer' && opts.noService !== true ? svc : undefined), effect: ctx.effect })
      },
    }
    return { ctx, registered, effects }
  }
  const fakeReq = ({ method = 'GET', headers = {}, body, port = 4567 } = {}) => {
    const r = Readable.from(body === undefined ? [] : [Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))])
    r.method = method; r.headers = headers; r.socket = { localPort: port }; r.url = '/x'
    return r
  }
  const fakeRes = () => {
    const res = { status: 0, headers: {}, body: undefined, writeHead(s, h) { res.status = s; res.headers = h || {} }, end(b) { res.body = b === undefined ? '' : b } }
    return res
  }
  const send = async (handler, reqOpts) => { const res = fakeRes(); await handler(fakeReq(reqOpts), res); return res }
  const sameOrigin = { origin: 'http://127.0.0.1:4567' }
  try {
    console.log = (...a) => logs.push(a.join(' '))
    console.error = (...a) => errors.push(a.map(String).join(' '))

    const { ctx, registered, effects } = fakeCtx()
    let threw = null
    try { apply(ctx) } catch (e) { threw = e }
    check('apply does not throw', threw === null)
    check('it waits for the webServer service (ctx.inject([\'webServer\']))', JSON.stringify(ctx.injected) === JSON.stringify(['webServer']))
    check('it registers exactly four exact routes (loader store, theme library, gallery, Lottie)', registered.length === 4 && registered.every((r) => r.kind === 'exact' && typeof r.handler === 'function') && registered.map((r) => r.path).sort().join() === [ROUTES.gallery, ROUTES.lottie, ROUTES.presets, ROUTES.store].sort().join(), JSON.stringify(registered.map((r) => r.path)))
    check('the paths are the documented ones', ROUTES.store === '/kybernos-theme/loader-store' && ROUTES.presets === '/kybernos-theme/preset-store' && ROUTES.gallery === '/kybernos-theme/gallery' && ROUTES.lottie === '/kybernos-theme/vendor/lottie.js')
    check('each registration goes through ctx.effect, with a label', effects.length === 4 && effects.every((l) => typeof l === 'string' && l.startsWith('kybernos-theme:')), effects.join())

    const store = registered.find((r) => r.path === ROUTES.store).handler
    let res = await send(store, { method: 'POST', headers: sameOrigin, body: { op: 'put-loader', loader: rec({ id: 'host1' }) } })
    check('the store route writes under DSH_HOME (real body reader)', res.status === 200 && JSON.parse(res.body).ok === true && existsSync(join(hostHome, 'kybernos', 'loaders', 'host1.json')), res.body)
    check('and answers as JSON with no-store', /application\/json/.test(res.headers['content-type']) && res.headers['cache-control'] === 'no-store')
    res = await send(store, { method: 'GET' })
    check('GET without Origin works (lax)', res.status === 200 && JSON.parse(res.body).loaders.length === 1)
    res = await send(store, { method: 'POST', body: { op: 'put-words', words: ['x'] } })
    check('POST without Origin is refused (strict): 403', res.status === 403)
    res = await send(store, { method: 'POST', headers: { origin: 'http://evil.example' }, body: { op: 'put-words', words: ['x'] } })
    check('POST from a foreign origin is refused: 403', res.status === 403 && !existsSync(join(hostHome, 'kybernos', 'loading-text.json')))
    res = await send(store, { method: 'POST', headers: { origin: 'http://127.0.0.1:9999' }, body: { op: 'put-words', words: ['x'] } })
    check('POST from another local port is refused too (it is the socket\'s port that counts)', res.status === 403)
    res = await send(store, { method: 'POST', headers: { referer: 'http://localhost:4567/chat' }, body: { op: 'put-words', words: ['Ok'] } })
    check('the Referer is the fallback for the strict check', res.status === 200)
    res = await send(store, { method: 'POST', headers: sameOrigin, body: { op: 'put-words', words: ['y'.repeat(MAX_BODY_BYTES)] } })
    check('a body over 400 KB is 413 through the real reader', res.status === 413, String(res.status))
    res = await send(store, { method: 'POST', headers: sameOrigin, body: 'not json at all' })
    check('a body that is not JSON is a 400, not a crash', res.status === 400)
    res = await send(store, { method: 'PUT', headers: sameOrigin })
    check('PUT is 405', res.status === 405)

    const lottieRoute = registered.find((r) => r.path === ROUTES.lottie).handler
    const bytes = readFileSync(LOTTIE_FILE)
    res = await send(lottieRoute, { method: 'GET' })
    check('the lottie route serves the vendored file byte for byte', res.status === 200 && Buffer.compare(res.body, bytes) === 0 && res.headers['content-length'] === String(bytes.length))
    check('content-type application/javascript; charset=utf-8', res.headers['content-type'] === 'application/javascript; charset=utf-8')
    check('long cache with an ETag', /max-age=\d{6,}/.test(res.headers['cache-control']) && /^"[0-9a-f]{32}"$/.test(res.headers.etag) && res.headers['x-content-type-options'] === 'nosniff', JSON.stringify(res.headers))
    const etag = res.headers.etag
    res = await send(lottieRoute, { method: 'GET', headers: { 'if-none-match': etag } })
    check('a matching If-None-Match gets a 304 with no body', res.status === 304 && res.body === '' && res.headers.etag === etag)
    res = await send(lottieRoute, { method: 'GET', headers: { 'if-none-match': 'W/"other", W/' + etag } })
    check('… weak and listed validators work', res.status === 304)
    res = await send(lottieRoute, { method: 'GET', headers: { 'if-none-match': '"stale"' } })
    check('a stale validator gets the file', res.status === 200)
    res = await send(lottieRoute, { method: 'GET', headers: { origin: 'http://evil.example' } })
    check('a foreign origin is refused (lax check): 403', res.status === 403)
    res = await send(lottieRoute, { method: 'GET', headers: sameOrigin })
    check('a same-origin read is fine', res.status === 200)
    res = await send(lottieRoute, { method: 'POST', headers: sameOrigin })
    check('POST is 405 (GET only)', res.status === 405)
    res = await send(lottieRoute, { method: 'HEAD' })
    check('HEAD is 405 (GET only)', res.status === 405)
    const missing = fakeRes()
    serveLottie(fakeReq({ method: 'GET' }), missing, join(root, 'nope', 'lottie.js'))
    check('a missing runtime file is a 404 JSON', missing.status === 404 && JSON.parse(missing.body).ok === false)
    check('the vendored file is Lottie 5.12.2 light, and NOTICES.md pins its hash', bytes.length > 100_000 && bytes.length < 250_000 && bytes.toString('utf8').includes('5.12.2') && readFileSync(join(HERE, 'vendor', 'NOTICES.md'), 'utf8').includes(createHash('sha256').update(bytes).digest('hex')))
    check('lottie_light has no expression engine to abuse', !/\beval\(|new Function/.test(bytes.toString('utf8')))

    // seeding
    check('apply seeded the shipped skills into <DSH_HOME>/skills/<name>/SKILL.md', SEEDED_SKILLS.every((n) => existsSync(join(hostHome, 'skills', n, 'SKILL.md')) && readFileSync(join(hostHome, 'skills', n, 'SKILL.md'), 'utf8') === readFileSync(join(SKILLS_DIR, n, 'SKILL.md'), 'utf8')), SEEDED_SKILLS.join())
    check('and said so in the log', logs.some((l) => /skill loader created/.test(l)) && logs.some((l) => /skill loading-text created/.test(l)), logs.join(' | '))
    const stamp = statSync(join(hostHome, 'skills', 'loader', 'SKILL.md')).mtimeMs
    const logCount = logs.length
    apply(fakeCtx().ctx)
    check('a second start is idempotent: nothing rewritten, nothing logged', statSync(join(hostHome, 'skills', 'loader', 'SKILL.md')).mtimeMs === stamp && logs.length === logCount)
    writeFileSync(join(hostHome, 'skills', 'loader', 'SKILL.md'), '---\nname: loader\ndescription: mine\n---\nmy own version\n')
    apply(fakeCtx().ctx)
    check('a skill the user edited is left alone', readFileSync(join(hostHome, 'skills', 'loader', 'SKILL.md'), 'utf8').includes('my own version'))

    // failures never escape
    const boom = fakeCtx({ throwOn: () => true })
    errors.length = 0
    threw = null
    try { apply(boom.ctx) } catch (e) { threw = e }
    check('a register that throws does not escape apply', threw === null && errors.length >= 1, errors.join(' | '))
    check('… each route is tried on its own (all four reported)', errors.filter((e) => /not mounted/.test(e)).length === 4, errors.join(' | '))
    const first = fakeCtx({ throwOn: (r) => r.path === ROUTES.store })
    threw = null
    try { apply(first.ctx) } catch (e) { threw = e }
    check('one failing route does not stop the others', threw === null && first.registered.length === 3 && first.registered.every((r) => r.path !== ROUTES.store) && first.registered.some((r) => r.path === ROUTES.lottie))
    threw = null
    try { apply(fakeCtx({ injectThrows: true }).ctx) } catch (e) { threw = e }
    check('ctx.inject throwing does not escape apply', threw === null)
    errors.length = 0
    threw = null
    try { apply(fakeCtx({ noService: true }).ctx) } catch (e) { threw = e }
    check('a missing webServer service is logged, not thrown', threw === null && errors.some((e) => /webServer service missing/.test(e)))
    threw = null
    try { apply({}) } catch (e) { threw = e }
    check('a ctx without any seam does not throw either', threw === null)
    const noHome = join(root, 'a-file-not-a-folder')
    writeFileSync(noHome, 'x')
    process.env.DSH_HOME = noHome
    errors.length = 0
    threw = null
    try { apply(fakeCtx().ctx) } catch (e) { threw = e }
    check('a skill that cannot be copied is logged and never escapes apply', threw === null && errors.some((e) => /skill .* not installed/.test(e)), errors.join(' | '))
  } finally {
    console.log = savedConsole.log
    console.error = savedConsole.error
    for (const k of Object.keys(savedEnv)) { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k] }
  }
}

console.log('DSH home resolution and origin guards')
{
  const osHome = () => '/home/someone'
  check('DSH_HOME wins', resolveDshHome({ DSH_HOME: '/data/dsh', HOME: '/home/x' }, osHome) === '/data/dsh')
  check('a blank DSH_HOME is ignored', resolveDshHome({ DSH_HOME: '   ', HOME: '/home/x' }, osHome) === join('/home/x', '.dsh'))
  check('~ is expanded in DSH_HOME', resolveDshHome({ DSH_HOME: '~/dsh-data' }, osHome) === join('/home/someone', 'dsh-data') && resolveDshHome({ DSH_HOME: '~' }, osHome) === '/home/someone')
  check('without DSH_HOME it is $HOME/.dsh', resolveDshHome({ HOME: '/home/x' }, osHome) === join('/home/x', '.dsh'))
  check('without HOME it falls back to the OS home', resolveDshHome({}, osHome) === join('/home/someone', '.dsh'))
  check('and is null only when nothing is known', resolveDshHome({}, () => '') === null && resolveDshHome({}, () => { throw new Error('x') }) === null)
  const rq = (headers, port = 4567) => ({ headers, socket: { localPort: port } })
  check('strict: no Origin and no Referer is refused', sameOriginStrict(rq({})) === false && sameOriginStrict({}) === false && sameOriginStrict(null) === false)
  check('strict: this server\'s own origin is accepted (127.0.0.1, localhost, [::1])', sameOriginStrict(rq({ origin: 'http://127.0.0.1:4567' })) && sameOriginStrict(rq({ origin: 'http://localhost:4567' })) && sameOriginStrict(rq({ origin: 'http://[::1]:4567' })))
  check('strict: another host, port or scheme is refused', !sameOriginStrict(rq({ origin: 'http://evil.example:4567' })) && !sameOriginStrict(rq({ origin: 'http://127.0.0.1:1' })) && !sameOriginStrict(rq({ origin: 'file:///x' })) && !sameOriginStrict(rq({ origin: 'null' })) && !sameOriginStrict(rq({ origin: 'garbage' })))
  check('strict: a forged Host header changes nothing', !sameOriginStrict({ headers: { origin: 'http://evil.example', host: 'evil.example' }, socket: { localPort: 4567 } }))
  check('lax: no Origin passes, a foreign one does not', sameOriginLax(rq({})) === true && sameOriginLax(rq({ origin: 'http://evil.example' })) === false && sameOriginLax(rq({ origin: 'http://127.0.0.1:4567' })) === true && sameOriginLax(rq({ referer: 'http://evil.example/x' })) === false)
}

console.log('shipped skills')
{
  const read = (n) => readFileSync(join(SKILLS_DIR, n, 'SKILL.md'), 'utf8')
  for (const n of SEEDED_SKILLS) {
    const text = read(n)
    const fm = /^---\n([\s\S]*?)\n---\n/.exec(text)
    check(n + ': frontmatter with name = folder and a description', fm !== null && new RegExp('^name: ' + n + '$', 'm').test(fm[1]) && /^description: \S/m.test(fm[1]))
    check(n + ': under 120 lines', text.split('\n').length <= 120, String(text.split('\n').length))
    check(n + ': no personal path, no secret', !/\/Users\/[A-Za-z]/.test(text) && !/sk-[A-Za-z0-9]{10}/.test(text))
  }
  check('SEEDED_SKILLS lists exactly the skills folder', readdirSync(SKILLS_DIR, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort().join() === [...SEEDED_SKILLS].sort().join())
  const loaderMd = read('loader')
  const blocks = Array.from(loaderMd.matchAll(/```\n([\s\S]*?)\n```/g)).map((m) => m[1])
  const example = blocks.find((b) => b.startsWith('<svg'))
  check('loader: the example svg passes the store\'s own validation', example !== undefined && svgProblem(example) === null && Buffer.byteLength(example, 'utf8') < 8192, String(example && svgProblem(example)))
  check('loader: the example is one colour on currentColor, with a viewBox 0 0 48 48 and a reduced-motion rule', /currentColor/.test(example) && /viewBox="0 0 48 48"/.test(example) && /prefers-reduced-motion: reduce\)\{\*\{animation:none!important\}\}/.test(example) && /transform-box:fill-box;transform-origin:center/.test(example))
  const checker = blocks.find((b) => b.startsWith('node --input-type=module'))
  check('loader: the documented check command is there', checker !== undefined)
  const script = checker.split('\n').slice(1, -1).join('\n')
  const runCheck = (svg) => {
    const f = join(root, 'skill-check.svg')
    writeFileSync(f, svg)
    return spawnSync(process.execPath, ['--input-type=module', '-', f], { input: script, encoding: 'utf8' })
  }
  let out = runCheck(example)
  check('loader: the check says OK on the example', out.status === 0 && /^OK/.test(out.stdout), out.stdout + out.stderr)
  const refusedByCheck = [svgWith('<script>1</script>'), svgWith('<g onload="x()"/>'), svgWith('<a href="java&#x73;cript:1"/>'), svgWith('<use href="http://x/a.svg#a"/>'), svgWith('<style>.a{fill:url(http://x)}</style>'), svgWith('<image href="#a"/>'), svgWith('<style>@import "a";</style>'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"></svg>', 'hello']
  check('loader: the check refuses what the store refuses', refusedByCheck.every((svg) => { const o = runCheck(svg); return o.status === 1 && /^REFUSED/.test(o.stdout) }))
  check('loader: anything the store refuses from that list is refused by both', refusedByCheck.slice(0, 7).every((svg) => svgProblem(svg) !== null))
  const lt = read('loading-text')
  const saver = Array.from(lt.matchAll(/```\n([\s\S]*?)\n```/g)).map((m) => m[1]).find((b) => b.startsWith('node - <<'))
  check('loading-text: the documented save command is there', saver !== undefined)
  const saveScript = saver.split('\n').slice(1, -1).join('\n')
  const runSave = (dshHome, addList, replace) => spawnSync(process.execPath, ['-'], {
    input: saveScript.replace(/const add = \[[^\]]*\]/, 'const add = ' + JSON.stringify(addList)).replace('const replace = false', 'const replace = ' + String(replace)),
    encoding: 'utf8', env: Object.assign({}, process.env, { DSH_HOME: dshHome }),
  })
  const sh = join(root, 'skill-save')
  out = runSave(sh, ['Reviewing guidelines', 'Preparing the file'], false)
  const sStore = createLoaderStore({ dir: join(sh, 'kybernos') })
  check('loading-text: the save command creates the file and the store reads it', out.status === 0 && JSON.stringify(sStore.readWords()) === JSON.stringify(['Reviewing guidelines', 'Preparing the file']) && JSON.parse(readFileSync(join(sh, 'kybernos', 'loading-text.json'), 'utf8')).version === 1, out.stdout + out.stderr)
  out = runSave(sh, ['preparing THE file', 'Checking references'], false)
  check('loading-text: it MERGES with the existing words and de-duplicates (case-insensitive)', JSON.stringify(sStore.readWords()) === JSON.stringify(['Reviewing guidelines', 'Preparing the file', 'Checking references']), JSON.stringify(sStore.readWords()))
  out = runSave(sh, Array.from({ length: 45 }, (_, i) => 'Label ' + i), false)
  check('loading-text: it caps the pack at 40 words and says what it dropped', sStore.readWords().length === 40 && /dropped/.test(out.stdout))
  out = runSave(sh, ['Only this'], true)
  check('loading-text: replace:true really replaces', JSON.stringify(sStore.readWords()) === JSON.stringify(['Only this']))
  check('loading-text: no .tmp file left behind', tree(join(sh, 'kybernos')).join() === 'loading-text.json')
  // an end to end pass: a bare svg written where the skill says is listed by the store
  const dropped = join(sh, 'kybernos', 'loaders')
  mkdirSync(dropped, { recursive: true })
  writeFileSync(join(dropped, 'three-bouncing-dots.svg'), example)
  const found = sStore.snapshot().loaders.find((x) => x.id === 'f-three-bouncing-dots')
  check('loader: the example, dropped as <slug>.svg, is picked up as a mono "skill" loader', found !== undefined && found.kind === 'mono' && found.source === 'skill' && found.name === 'Three bouncing dots')
}

rmSync(root, { recursive: true, force: true })
console.log(failed === 0 ? '\nOK — loader store (' + total + ' checks)' : '\n' + failed + ' of ' + total + ' check(s) FAILED')
process.exit(failed === 0 ? 0 : 1)

// The installable face of the phone layer: the manifest, the icons, the head tags, and how index.js mounts them.
// Measured on an iPhone simulator (2026-10-24): DSH's own manifest names the app "DeepSeek Harness", asks for display
// "fullscreen" (iOS has no such mode), has one SVG icon and no apple-touch-icon, so a home-screen copy carries the engine's identity.
//   node packages/kybernos-mobile/test-pwa.mjs
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inflateSync } from 'node:zlib'
import * as pwa from './pwa.mjs'
import { apply, ROUTE, SHEET_ID } from './index.js'

let fail = 0
const ok = (name, cond, detail) => { console.log((cond ? 'ok   ' : 'FAIL ') + name + (!cond && detail !== undefined ? ' - ' + JSON.stringify(detail) : '')); if (!cond) fail++ }
const here = dirname(fileURLToPath(import.meta.url))

// ── the manifest ─────────────────────────────────────────────────────────────────────────────────────────────────────
const m = pwa.manifest()
ok('the manifest carries the product name, not the engine\'s', m.name === 'Kybernos' && m.short_name === 'Kybernos' && !/deepseek|dsh/i.test(JSON.stringify(m)), m.name)
ok('display is standalone (iOS knows no "fullscreen") with a minimal-ui fallback', m.display === 'standalone' && m.display_override.join() === 'standalone,minimal-ui')
ok('colours are hex', /^#[0-9a-f]{6}$/i.test(m.background_color) && /^#[0-9a-f]{6}$/i.test(m.theme_color))
ok('manifestJson is the manifest', JSON.stringify(JSON.parse(pwa.manifestJson())) === JSON.stringify(m))
const at = (base) => new URL('kybernos-mobile/pwa/' + pwa.MANIFEST_FILE, base)
ok('start_url, scope and id resolve to the page root from the manifest\'s own address', ['start_url', 'scope', 'id'].every((k) => new URL(m[k], at('http://127.0.0.1:3080/')).pathname === '/'))
ok('and stay right when DSH is mounted under a path prefix', ['start_url', 'scope', 'id'].every((k) => new URL(m[k], at('https://host.example/p/')).pathname === '/p/'))
ok('every icon points at a file the route serves, with the size it says', m.icons.every((i) => {
  const file = i.src.split('/').pop()
  const spec = Object.prototype.hasOwnProperty.call(pwa.ICONS, file) ? pwa.ICONS[file] : null
  return spec !== null && i.sizes === spec.size + 'x' + spec.size && i.type === 'image/png' && i.purpose === spec.purpose && i.src === file
}), m.icons)
ok('installable: a 192, a 512 and a maskable icon', ['192x192', '512x512'].every((s) => m.icons.some((i) => i.sizes === s && i.purpose === 'any')) && m.icons.some((i) => i.purpose === 'maskable'))

// ── the head rows ────────────────────────────────────────────────────────────────────────────────────────────────────
const rows = pwa.pwaRows()
const html = rows.length === 1 ? rows[0].html : ''
ok('one head row, as html', rows.length === 1 && rows[0].kind === 'html' && rows[0].placement === 'head')
ok('the manifest, the home-screen icon and the iOS web-app tags are there', [
  '<link rel="manifest" href="./kybernos-mobile/pwa/manifest.webmanifest">',
  '<link rel="apple-touch-icon" href="./kybernos-mobile/pwa/apple-touch-icon.png">',
  '<meta name="apple-mobile-web-app-capable" content="yes">',
  '<meta name="apple-mobile-web-app-title" content="Kybernos">',
  '<meta name="apple-mobile-web-app-status-bar-style" content="black">'
].every((t) => html.includes(t)))
ok('a theme colour for the dark and for the light scheme', /theme-color" content="#151517" media="\(prefers-color-scheme: dark\)"/.test(html) && /theme-color" content="#ffffff" media="\(prefers-color-scheme: light\)"/.test(html))
const hrefs = [...html.matchAll(/href="([^"]*)"/g)].map((x) => x[1])
ok('every href is relative (the page may be mounted under a prefix) and names a served file', hrefs.length === 2 && hrefs.every((h) => /^\.\/kybernos-mobile\/pwa\/[a-z0-9.-]+$/.test(h) && pwa.FILES.includes(h.split('/').pop())), hrefs)
ok('no script and nothing that could close a style element', !/<script/i.test(html) && !/<\/style/i.test(html))

// ── the PNGs ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const decode = (png) => {
  if (!png.subarray(0, 8).equals(pwa.PNG_SIGNATURE)) return null
  let pos = 8
  const chunks = []
  let crcOk = true
  while (pos < png.length) {
    const len = png.readUInt32BE(pos)
    const type = png.toString('ascii', pos + 4, pos + 8)
    const data = png.subarray(pos + 8, pos + 8 + len)
    if (png.readUInt32BE(pos + 8 + len) !== pwa.crc32(png.subarray(pos + 4, pos + 8 + len))) crcOk = false
    chunks.push({ type, data })
    pos += 12 + len
  }
  const ihdr = chunks[0].data
  const w = ihdr.readUInt32BE(0)
  const h = ihdr.readUInt32BE(4)
  const raw = inflateSync(Buffer.concat(chunks.filter((c) => c.type === 'IDAT').map((c) => c.data)))
  const stride = w * 3 + 1
  let filtersOk = raw.length === stride * h
  for (let y = 0; filtersOk && y < h; y++) if (raw[y * stride] !== 0) filtersOk = false
  return { w, h, depth: ihdr[8], colorType: ihdr[9], interlace: ihdr[12], order: chunks.map((c) => c.type).join(), crcOk, filtersOk, px: (x, y) => { const i = y * stride + 1 + x * 3; return [raw[i], raw[i + 1], raw[i + 2]] } }
}
const same = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2]
const BG = [0x15, 0x15, 0x17]
const RED = [0xf2, 0x37, 0x2a]
const WHITE = [0xff, 0xff, 0xff]

for (const [file, spec] of Object.entries(pwa.ICONS)) {
  const d = decode(pwa.iconPng(file))
  ok(file + ': a valid ' + spec.size + ' px RGB PNG (signature, chunk order, every CRC, rows)', d !== null && d.w === spec.size && d.h === spec.size && d.depth === 8 && d.colorType === 2 && d.interlace === 0 && d.order === 'IHDR,IDAT,IEND' && d.crcOk && d.filtersOk, d && { w: d.w, h: d.h, order: d.order, crcOk: d.crcOk, filtersOk: d.filtersOk })
}
{
  const spec = pwa.ICONS['icon-512.png']
  const d = decode(pwa.iconPng('icon-512.png'))
  const scale = (spec.size * spec.share) / 36
  const left = (spec.size - 32.5 * scale) / 2
  const top = (spec.size - 36 * scale) / 2
  const at2 = (kx, ky) => d.px(Math.round(left + kx * scale), Math.round(top + ky * scale))
  ok('the corners and the margin are the shell colour', same(d.px(0, 0), BG) && same(d.px(511, 511), BG) && same(d.px(Math.round(spec.size * 0.95), 256), BG))
  ok('the stem is the brand red', same(at2(3, 30), RED) && same(at2(10, 2), RED) && same(at2(24, 2), RED))
  ok('the three dots on the stem are white', [[6.5, 7.5], [6.5, 18], [6.5, 28.5]].every(([x, y]) => same(at2(x, y), WHITE)))
  let blended = 0
  for (let y = 0; y < d.h; y++) for (let x = 0; x < d.w; x++) { const p = d.px(x, y); if (!same(p, BG) && !same(p, RED) && !same(p, WHITE)) blended++ }
  ok('edges are anti-aliased (blended pixels exist)', blended > 200, blended)
}
{
  // The maskable icon: a launcher may crop it to a circle that fits the central 80 %. The K must live inside.
  const d = decode(pwa.iconPng('icon-maskable-512.png'))
  let x0 = d.w; let x1 = -1; let y0 = d.h; let y1 = -1
  for (let y = 0; y < d.h; y++) for (let x = 0; x < d.w; x++) if (!same(d.px(x, y), BG)) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y) }
  const lo = d.w * 0.1
  const hi = d.w * 0.9
  ok('the maskable K stays inside the central 80 %', x0 >= lo && x1 <= hi && y0 >= lo && y1 <= hi, { x0, x1, y0, y1 })
  const cx = d.w / 2
  const farthest = Math.max(...[[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map(([x, y]) => Math.hypot(x - cx, y - cx)))
  ok('and inside the safe circle (radius 40 % of the side)', farthest <= d.w * 0.4, farthest)
}
ok('drawing twice gives the same bytes; the second answer is the cached one; a reset redraws the same bytes', (() => {
  const a = pwa.iconPng('apple-touch-icon.png')
  const b = pwa.iconPng('apple-touch-icon.png')
  pwa.resetIcons()
  return a === b && pwa.iconPng('apple-touch-icon.png').equals(a)
})())
ok('an unknown name, or an inherited property name, is not an icon', pwa.iconPng('nope.png') === null && pwa.iconPng('constructor') === null && pwa.iconPng('__proto__') === null && pwa.iconPng('../index.js') === null)
{
  // The icon is the brand's K: the numbers must be the ones the product uses (kybernos-plugin KB_BRAND_*).
  const brand = readFileSync(join(here, '..', 'kybernos-plugin', 'client.js'), 'utf8')
  const parts = ['<rect x="0" y="0" width="13" height="36"/>', 'points="21,0 31,0 13,28.3 13,12.6"', 'points="13,22 22,36 32.5,36 20.3,16.8 13,16.8"', '<circle cx="6.5" cy="7.5"', '<circle cx="6.5" cy="18"', '<circle cx="6.5" cy="28.5"', "const KB_BRAND_RED = '#f2372a'"]
  ok('the K drawn here has the geometry and the red of the brand mark', parts.every((s) => brand.includes(s)), parts.filter((s) => !brand.includes(s)))
}

// ── the route ────────────────────────────────────────────────────────────────────────────────────────────────────────
const fakeRes = () => { const r = { status: null, headers: null, body: null, ended: false, writeHead (s, h) { r.status = s; r.headers = h || {} }, end (b) { r.ended = true; r.body = b } }; return r }
const get = (file, method = 'GET', fence = () => true) => { const r = fakeRes(); pwa.servePwa(file, { method }, r, fence); return r }
{
  const r = get(pwa.MANIFEST_FILE)
  ok('GET the manifest: 200, manifest JSON, not cached', r.status === 200 && /^application\/manifest\+json/.test(r.headers['content-type']) && r.headers['cache-control'] === 'no-cache' && JSON.parse(r.body.toString('utf8')).name === 'Kybernos')
  const i = get('icon-192.png')
  ok('GET an icon: 200, image/png, its length, cached for an hour, a PNG', i.status === 200 && i.headers['content-type'] === 'image/png' && i.headers['content-length'] === String(i.body.length) && /max-age=3600/.test(i.headers['cache-control']) && i.body.subarray(0, 8).equals(pwa.PNG_SIGNATURE))
  const h = get('icon-192.png', 'HEAD')
  ok('HEAD: the same headers and no body', h.status === 200 && h.body === undefined && h.headers['content-length'] === i.headers['content-length'])
  ok('POST is refused (405) and says what is allowed', get(pwa.MANIFEST_FILE, 'POST').status === 405 && /GET/.test(get(pwa.MANIFEST_FILE, 'POST').headers.allow))
  ok('a refused fence is a 403 and sends nothing of the file', (() => { const r = get(pwa.MANIFEST_FILE, 'GET', () => false); return r.status === 403 && !/Kybernos/.test(String(r.body)) })())
  ok('a fence that throws is a 500, never an exception', (() => { try { return get(pwa.MANIFEST_FILE, 'GET', () => { throw new Error('boom') }).status === 500 } catch (e) { return false } })())
  ok('an unknown file, or a path trick, is a 404', get('nope.png').status === 404 && get('../index.js').status === 404 && get('').status === 404)
  ok('a response that cannot be written does not raise', (() => { try { pwa.servePwa(pwa.MANIFEST_FILE, { method: 'GET' }, { writeHead () { throw new Error('socket closed') }, end () { throw new Error('socket closed') } }, () => true); return true } catch (e) { return false } })())
}

// ── the mounting (index.js) ──────────────────────────────────────────────────────────────────────────────────────────
const mount = (pwaEnv, { failRegisterOn = null } = {}) => {
  const saved = { pwa: process.env.KYBERNOS_MOBILE_PWA, remote: process.env.KYBERNOS_MOBILE_REMOTE }
  process.env.KYBERNOS_MOBILE_REMOTE = '0'
  if (pwaEnv === undefined) delete process.env.KYBERNOS_MOBILE_PWA; else process.env.KYBERNOS_MOBILE_PWA = pwaEnv
  const routes = []
  const injects = []
  const svc = { register: (r) => { if (failRegisterOn !== null && r.path.endsWith(failRegisterOn)) throw new Error('refused'); routes.push(r); return () => {} } }
  const ctx = { effect: (fn) => fn(), on: (ev, fn) => { if (ev === 'webserver/index-inject') injects.push(fn); return () => {} }, get: (n) => (n === 'webServer' ? svc : undefined), inject: () => {} }
  let threw = null
  try { apply(ctx) } catch (e) { threw = e }
  const table = []
  for (const fn of injects) fn(table)
  if (saved.pwa === undefined) delete process.env.KYBERNOS_MOBILE_PWA; else process.env.KYBERNOS_MOBILE_PWA = saved.pwa
  if (saved.remote === undefined) delete process.env.KYBERNOS_MOBILE_REMOTE; else process.env.KYBERNOS_MOBILE_REMOTE = saved.remote
  return { routes, table, threw }
}
{
  const on = mount(undefined)
  ok('mounting does not throw', on.threw === null, String(on.threw))
  ok('a route per file under /kybernos-mobile/pwa/, and the stylesheet\'s own route is still there', pwa.FILES.every((f) => on.routes.some((r) => r.kind === 'exact' && r.path === pwa.PWA_PREFIX + f)) && on.routes.some((r) => r.path === ROUTE))
  ok('the index gets two head rows, the small tags first and then the stylesheet', on.table.length === 2 && on.table[0].html.includes('rel="manifest"') && on.table[1].html.startsWith('<style id="' + SHEET_ID + '">'))
  const route = on.routes.find((r) => r.path === pwa.PWA_PREFIX + pwa.MANIFEST_FILE)
  const ask = (headers) => { const r = fakeRes(); route.handler({ method: 'GET', headers, socket: { localPort: 3080 } }, r); return r.status }
  ok('through the mounted route: this machine\'s own Host is served', ask({ host: '127.0.0.1:3080' }) === 200 && ask({ host: 'localhost:3080', referer: 'http://localhost:3080/' }) === 200)
  ok('a foreign Host (a page that rebinds its name to this machine) is refused', ask({ host: 'evil.example:3080' }) === 403)
  ok('a foreign Origin is refused', ask({ host: '127.0.0.1:3080', origin: 'https://evil.example' }) === 403)

  const off = mount('0')
  ok('KYBERNOS_MOBILE_PWA=0: no tags, no pwa route; the stylesheet stays', off.threw === null && off.table.length === 1 && off.table[0].html.startsWith('<style') && !off.routes.some((r) => r.path.startsWith(pwa.PWA_PREFIX)) && off.routes.some((r) => r.path === ROUTE))

  const logged = console.error
  console.error = () => {} // the refusal is logged by design; the log is not what is under test
  const broken = mount(undefined, { failRegisterOn: pwa.MANIFEST_FILE })
  console.error = logged
  ok('one route refused by the web server costs only that route', broken.threw === null && broken.routes.filter((r) => r.path.startsWith(pwa.PWA_PREFIX)).length === pwa.FILES.length - 1 && broken.routes.some((r) => r.path === ROUTE))
}

console.log(fail === 0 ? '\nall passed' : '\n' + fail + ' FAILED')
process.exit(fail === 0 ? 0 : 1)

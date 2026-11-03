// The Publish button of Creations (site-page.mjs): what a page uses is sent with it and nothing else, the server's answers become codes the page can word, and the small memory
// « this file is that page » follows the publications. The files are real (a temporary folder), the server is a fake that answers like the contract. Run: node test-site-page.mjs
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { answerOf, createPageMap, createSitePages, insideFolder, pageOf, referencesOf } from './site-page.mjs'

let fail = 0
const ok = (name, cond, detail) => { if (cond) console.log('ok   ' + name); else { fail += 1; console.log('FAIL ' + name + (detail === undefined ? '' : '  ' + JSON.stringify(detail).slice(0, 400))) } }

// ── what a page names ─────────────────────────────────────────────────────────
const refs = referencesOf('<link href="css/a.css" rel=stylesheet><img src=\'img/b.png\' srcset="img/b.png 1x, img/b@2x.png 2x"><a href="https://x.org/">x</a><a href="#top">t</a><!-- <img src="gone.png"> --><div style="background:url(img/c.jpg)"></div><script src=app.js></script>', 'html')
ok('the files a page names are found, written any way', ['css/a.css', 'img/b.png', 'img/b@2x.png', 'img/c.jpg', 'app.js'].every((r) => refs.includes(r)), refs)
ok('a comment names nothing', !refs.includes('gone.png'))
ok('a style sheet names its images and imports', referencesOf('@import "base.css"; a{background:url("../i/x.svg")}', 'css').sort().join(',') === '../i/x.svg,base.css')
ok('an address on the web, an anchor, a mail link or a template is not a file of the folder', ['https://x.org/a.png', '//cdn.x/a.js', '#top', 'mailto:a@b.c', 'data:image/png;base64,AAAA', '{{ img }}', 'tel:+33'].every((r) => insideFolder(r, 'index.html').rel === null))
ok('a path is read from the file that names it', insideFolder('../img/a.png', 'css/site.css').rel === 'img/a.png' && insideFolder('a.png', 'css/site.css').rel === 'css/a.png' && insideFolder('img/a.png?v=2#x', 'index.html').rel === 'img/a.png')
ok('a path from the root of the page starts at its folder', insideFolder('/css/a.css', 'sub/p.html').rel === 'css/a.css')
ok('a path that leaves the folder is said so', insideFolder('../secret.png', 'index.html').why === 'outside' && insideFolder('../../x', 'css/a.css').why === 'outside')

// ── the page and what it uses ────────────────────────────────────────────────
const root = mkdtempSync(join(tmpdir(), 'site-page-'))
const put = (rel, data) => { const p = join(root, rel); mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, data); return p }
try {
  const entry = put('pizza/menu.html', '<!doctype html><title>Chez Mario &amp; fils</title><link rel=stylesheet href="css/site.css"><img src="img/hero.png"><img src="https://x.org/y.png"><a href="contact.html">Contact</a><a href="notes.pdf">Notes</a><img src="../outside.png"><img src="missing.png"><script src="app.js"></script>')
  put('pizza/css/site.css', 'h1{background:url(../img/bg.jpg)} @font-face{src:url(../fonts/a.woff2)}')
  put('pizza/img/hero.png', Buffer.from([137, 80, 78, 71]))
  put('pizza/img/bg.jpg', Buffer.from([255, 216]))
  put('pizza/fonts/a.woff2', Buffer.from([1, 2]))
  put('pizza/contact.html', '<title>Contact</title><a href="menu.html">Menu</a><img src="img/hero.png">')
  put('pizza/app.js', 'console.log(1)')
  put('pizza/notes.pdf', 'pdf')
  put('pizza/unused.png', 'x')
  put('pizza/.env', 'SECRET=1')
  put('outside.png', 'x')
  const p = pageOf(entry)
  ok('the page is sent as index.html with the files it uses, at the same relative paths', p.ok === true && p.files.map((f) => f.path).sort().join(',') === 'app.js,contact.html,css/site.css,fonts/a.woff2,img/bg.jpg,img/hero.png,index.html', p)
  ok('a file the page does not name is not sent', p.ok && !p.files.some((f) => /unused|\.env/.test(f.path)))
  ok('the entry is the file the person clicked, under the name index.html', p.ok && p.files.find((f) => f.path === 'index.html').data.toString().includes('Chez Mario'))
  ok('the title is read from the page', p.ok && p.title === 'Chez Mario & fils', p.title)
  ok('what is left out is said: a kind a page does not hold, a file outside the folder, a file that is not there', p.ok && p.leftOut.some((l) => l.path === 'notes.pdf' && l.why === 'type') && p.leftOut.some((l) => l.path === '../outside.png' && l.why === 'outside') && p.leftOut.some((l) => l.path === 'missing.png' && l.why === 'missing'), p.leftOut)
  ok('the bytes are the sum of what is sent', p.ok && p.bytes === p.files.reduce((n, f) => n + f.data.length, 0))

  // links, hidden files, the other kinds of path
  put('link/index.html', '<img src="img/a.png"><img src="leak.png"><img src="dir/b.png">')
  put('link/img/a.png', 'a')
  symlinkSync(join(root, 'outside.png'), join(root, 'link/leak.png'))
  mkdirSync(join(root, 'elsewhere'), { recursive: true })
  put('elsewhere/b.png', 'b')
  symlinkSync(join(root, 'elsewhere'), join(root, 'link/dir'))
  const l = pageOf(join(root, 'link/index.html'))
  ok('a file reached through a link is never read', l.ok === true && l.files.map((f) => f.path).sort().join(',') === 'img/a.png,index.html' && l.leftOut.some((x) => x.path === 'leak.png') && l.leftOut.some((x) => x.path === 'dir/b.png'), l)
  put('hid/index.html', '<img src=".secret/a.png"><img src="node_modules/x/a.png">')
  put('hid/.secret/a.png', 'a')
  ok('a hidden folder and node_modules are never sent', pageOf(join(root, 'hid/index.html')).files.length === 1)
  ok('a relative path is refused', pageOf('pizza/menu.html').error === 'invalid_path')
  ok('only an html page is put online', pageOf(join(root, 'pizza/app.js')).error === 'invalid_path' && pageOf(join(root, 'pizza/img/hero.png')).error === 'invalid_path')
  ok('a file that is gone is said', pageOf(join(root, 'nope.html')).error === 'not_found')
  ok('a link or a folder is not a page', pageOf(join(root, 'pizza')).error === 'invalid_path' && pageOf(join(root, 'link/leak.png')).error === 'invalid_path')
  const keyed = put('.ssh/page.html', '<p>x</p>')
  ok('a page that comes from a folder named like a key is refused', pageOf(keyed).error === 'invalid_path')

  // the limits
  const big = put('big/index.html', '<img src="a.png"><img src="b.png"><img src="c.png">')
  for (const n of ['a', 'b', 'c']) put('big/' + n + '.png', Buffer.alloc(1.5 * 1024 * 1024))
  const bg = pageOf(big)
  ok('a page over 4 MB says it and names the largest files', bg.ok === false && bg.error === 'too_big' && Array.isArray(bg.largest) && bg.largest.length === 3, bg)
  put('huge/index.html', '<img src="a.png">')
  put('huge/a.png', Buffer.alloc(2 * 1024 * 1024 + 1))
  ok('a file over 2 MB is refused by name', pageOf(join(root, 'huge/index.html')).error === 'too_big' && pageOf(join(root, 'huge/index.html')).largest[0].path === 'a.png')
  put('many/index.html', Array.from({ length: 60 }, (_, i) => `<img src="i${i}.png">`).join(''))
  for (let i = 0; i < 60; i += 1) put(`many/i${i}.png`, 'x')
  ok('a page that uses more than 50 files says so', pageOf(join(root, 'many/index.html')).error === 'too_big')

  // ── the actions, against a server that answers like the contract ──────────────
  const store = {}
  const map = createPageMap({ file: () => 'map.json', readJson: () => ({ ...store }), writeJson: (_f, v) => { for (const k of Object.keys(store)) delete store[k]; Object.assign(store, v) } })
  const sent = []
  let answers = []
  const call = async (method, path, body) => { sent.push({ method, path, body }); return answers.length > 0 ? answers.shift() : { status: 200, body: { slug: body?.slug ?? '', url: 'https://' + (body?.slug ?? 'x') + '.kaby.app', state: 'live', updated: false, files: body?.files?.length ?? 0, bytes: 1 } } }
  const naps = []
  const pages = createSitePages({ call, map, sleep: async (ms) => { naps.push(ms) } })

  const plan = await pages.plan({ path: entry })
  ok('the plan says what would be sent and sends nothing', plan.ok === true && plan.files === 7 && plan.title === 'Chez Mario & fils' && plan.slug === 'chez-mario-fils' && plan.online === null && sent.length === 0, plan)

  const done = await pages.publish({ path: entry })
  ok('publishing sends one POST with the page and its files, base64', done.ok === true && sent.length === 1 && sent[0].method === 'POST' && sent[0].path === '/v1/sites' && sent[0].body.slug === 'chez-mario-fils' && sent[0].body.files.length === 7 && Buffer.from(sent[0].body.files.find((f) => f.path === 'index.html').content_base64, 'base64').toString().includes('Chez Mario'), done)
  ok('the answer carries the address, and the title goes with the page', done.url === 'https://chez-mario-fils.kaby.app' && sent[0].body.title === 'Chez Mario & fils', done)
  ok('the memory now knows which file is that page', store[entry] === 'chez-mario-fils', store)
  ok('the plan carries the reserved names, so the page can say a name is reserved before anything is sent', plan.reserved.includes('www') && plan.reserved.includes('kaby'), plan.reserved)
  ok('the next plan says the file is online under that name', (await pages.plan({ path: entry })).online === 'chez-mario-fils')

  const named = await pages.publish({ path: entry, name: 'Menu-Mario', title: 'Le menu' })
  ok('a name the person typed wins, lower-cased, and so does a title', named.slug === 'menu-mario' && sent.at(-1).body.title === 'Le menu', named)
  ok('a refused name is said before anything is sent', (await pages.publish({ path: entry, name: 'www' })).error === 'reserved_slug' && (await pages.publish({ path: entry, name: 'a' })).error === 'invalid_slug')

  const before = sent.length
  const refusals = [
    [{ status: 409, body: { error: 'slug_taken' } }, 'slug_taken'],
    [{ status: 403, body: { error: 'too_many_sites', max: 3 } }, 'too_many_sites'],
    [{ status: 403, body: { error: 'taken_down' } }, 'taken_down'],
    [{ status: 413, body: { error: 'too_big' } }, 'too_big'],
    [{ status: 429, body: { error: 'rate_limited' } }, 'rate_limited'],
    [{ status: 502, body: { error: 'host_error' } }, 'host_error'],
    [{ status: 401, body: { error: 'not_connected' } }, 'not_connected'],
    [{ status: 0, body: null }, 'no_answer'],
    [{ status: 404, body: { error: 'not_found' } }, 'not_found']
  ]
  for (const [res, code] of refusals) { answers = [res]; const r = await pages.publish({ path: entry }); ok('the server\'s ' + code + ' reaches the page as that code', r.ok === false && r.error === code, r) }
  answers = [{ status: 403, body: { error: 'too_many_sites', max: 3 } }]
  ok('the limit of pages comes with its number', (await pages.publish({ path: entry })).max === 3)
  ok('a refused publication does not touch the memory of files', store[entry] === 'menu-mario' || store[entry] === 'chez-mario-fils', store)
  ok('each refusal was a single call', sent.length === before + refusals.length + 1)

  naps.length = 0
  const n0 = sent.length
  answers = [{ status: 202, body: { slug: 'x', url: 'https://x.kaby.app', state: 'building', retry_after_seconds: 2 } }, { status: 202, body: { retry_after_seconds: 9 } }]
  const slow = await pages.publish({ path: entry, name: 'lent' })
  ok('a page still building is asked again, with the same body, and the wait is bounded', slow.ok === true && sent.length === n0 + 3 && naps.length === 2 && naps[0] === 2000 && naps[1] === 3000, { slow, naps })
  answers = [1, 2, 3, 4].map(() => ({ status: 202, body: { retry_after_seconds: 1 } }))
  const never = await pages.publish({ path: entry, name: 'lent2' })
  ok('a page that is still building after the rounds is handed back to the page, not lost', never.ok === false && never.error === 'building' && never.retry === true, never)

  // the list
  answers = [{ status: 200, body: { sites: [{ slug: 'lent', url: 'https://lent.kaby.app', title: 'Le menu', state: 'live', created_at: 'a', updated_at: 'b', files: 7, bytes: 9 }, { slug: 'old', url: 'https://old.kaby.app', title: 'Old', state: 'taken_down', created_at: 'a', updated_at: 'b', files: 1, bytes: 1 }] } }]
  const ls = await pages.list()
  ok('the list gives each page its file, and counts those that are not taken down', ls.ok === true && ls.connected === true && ls.count === 1 && ls.sites[0].paths.includes(entry) && ls.sites[1].paths.length === 0, ls)
  answers = [{ status: 401, body: { error: 'not_connected' } }]
  ok('signed out is a state, not an error', (await pages.list()).connected === false)
  answers = [{ status: 404, body: { error: 'not_found' } }]
  ok('a server without the feature is said', (await pages.list()).available === false)
  answers = [{ status: 0, body: null }]
  ok('a server that does not answer is an error to retry', (await pages.list()).error === 'no_answer')

  // taking down
  answers = [{ status: 200, body: { removed: true } }]
  const gone = await pages.remove({ slug: 'lent' })
  ok('taking a page down is one DELETE on its name, and the memory forgets it', gone.ok === true && sent.at(-1).method === 'DELETE' && sent.at(-1).path === '/v1/sites/lent' && !Object.values(store).includes('lent'), { gone, store })
  map.set('/x/other.html', 'gone-page')
  answers = [{ status: 404, body: { error: 'not_found' } }]
  const already = await pages.remove({ slug: 'gone-page' })
  ok('a page that is already gone is said, and forgotten all the same', already.ok === false && already.error === 'not_found' && !Object.values(store).includes('gone-page'), already)
  ok('a bad name is refused before the call', (await pages.remove({ slug: '../x' })).error === 'invalid_slug')

  // the answers
  ok('an address that is not https on a plain host is not taken for a link', answerOf({ status: 200, body: { url: 'javascript:alert(1)' } }).ok === false)
  ok('an error code that is not a plain word is dropped', answerOf({ status: 500, body: { error: '<b>x</b>' } }).error === 'http_500')

  // the map
  const mem = {}
  const small = createPageMap({ file: () => 'm.json', readJson: () => ({ ...mem }), writeJson: (_f, v) => { for (const k of Object.keys(mem)) delete mem[k]; Object.assign(mem, v) } })
  for (let i = 0; i < 320; i += 1) small.set('/p/' + i + '.html', 's' + i)
  ok('the memory keeps the newest 300 files', Object.keys(mem).length === 300 && mem['/p/319.html'] === 's319' && mem['/p/0.html'] === undefined)
  const broken = createPageMap({ file: () => 'm.json', readJson: () => null, writeJson: () => {} })
  ok('an unreadable memory is an empty one', Object.keys(broken.read()).length === 0)
} finally { rmSync(root, { recursive: true, force: true }) }

if (fail > 0) { console.log(`\n${fail} failed`); process.exit(1) }
console.log('\nall passed')

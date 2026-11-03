// The disk half of the maquette editor on a temporary folder: which folders may be registered, what a page may read, what a save does
// to the files and what it leaves behind, undo, the original, pictures. No DSH, no network.
//
//   node packages/kybernos-maquettes/test-disk.mjs
import * as fsp from 'node:fs/promises'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, symlinkSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHost, sniffImage, STORAGE_SHIM, withShim } from './maquette-host.mjs'
import { index } from './maquette-lib.mjs'
import { fixtures } from './lib-fixtures.mjs'

let failed = 0
const check = (label, ok, detail) => {
  console.log((ok ? '  ok   ' : '  FAIL ') + label + (ok || detail === undefined ? '' : '  -- ' + detail))
  if (!ok) failed += 1
}

const base = mkdtempSync(join(tmpdir(), 'kb-maquettes-'))
const home = join(base, 'dsh-home')
const userHome = join(base, 'user')
mkdirSync(home, { recursive: true })
mkdirSync(userHome, { recursive: true })
const logs = []
let tick = 1000
const mk = (fs = fsp) => createHost({ fs, home, userHome, log: (m) => logs.push(m), now: () => tick, newToken: (() => { let n = 0; return () => 't' + (++n).toString(16).padStart(30, '0') })() })
const host = mk()

const put = (dir, files) => { mkdirSync(dir, { recursive: true }); for (const [n, t] of Object.entries(files)) writeFileSync(join(dir, n), t) }
const dirA = join(userHome, 'maquettes', 'creator')
const dirB = join(userHome, 'maquettes', 'catalog')
const fx = fixtures()
put(dirA, fx.creator)
put(dirB, fx.catalog)
const snapshotOf = (dir) => Object.fromEntries(readdirSync(dir).filter((n) => !n.startsWith('.')).map((n) => [n, existsSync(join(dir, n)) && readdirSync(dir).includes(n) ? (() => { try { return readFileSync(join(dir, n), 'utf8') } catch (e) { return '<dir>' } })() : null]))

// ── registering a folder ───────────────────────────────────────────────────────
{
  check('a relative path is refused', (await host.add('maquettes/creator')).code === 'not-absolute')
  check('an empty or non-string path is refused', (await host.add('')).code === 'bad-path' && (await host.add(null)).code === 'bad-path' && (await host.add('/x\0y')).code === 'bad-path')
  check('a folder that does not exist is refused', (await host.add(join(userHome, 'nope'))).code === 'not-found')
  check('a file is not a folder', (await host.add(join(dirA, 'index.html'))).code === 'not-a-folder')
  check('the disk root and the home folder are too wide', (await host.add('/')).code === 'too-wide' && (await host.add(userHome)).code === 'too-wide')
  check('the plugin\'s own storage is refused', (await (async () => { mkdirSync(join(home, 'kybernos', 'kybernos-maquettes', 'snapshots'), { recursive: true }); return host.add(join(home, 'kybernos', 'kybernos-maquettes', 'snapshots')) })()).code === 'too-wide')
  mkdirSync(join(userHome, 'empty'))
  writeFileSync(join(userHome, 'empty', 'notes.txt'), 'x')
  check('a folder with no page at its top level is refused', (await host.add(join(userHome, 'empty'))).code === 'no-page')
  const a = await host.add(dirA)
  check('a folder with a page is registered, id from its name', a.ok === true && /^creator-[0-9a-f]{6}$/.test(a.id) && a.existed === false, JSON.stringify(a))
  const again = await host.add(dirA + '/')
  check('registering it again (with a trailing slash) finds the same one', again.ok && again.id === a.id && again.existed === true)
  const viaTilde = await host.add('~/maquettes/catalog')
  check('~/ means the user\'s home', viaTilde.ok === true && viaTilde.name === 'catalog')
  const l = await host.list()
  check('the list gives name, pages (index.html first) and no missing flag', l.folders.length === 2 && l.folders[0].pages[0] === 'index.html' && l.folders.every((f) => f.missing === false && f.dir.startsWith(realpathSync(userHome)) === true))
  check('the registry is in DSH_HOME, not in the maquette folder', existsSync(join(home, 'kybernos', 'kybernos-maquettes', 'folders.json')) && !readdirSync(dirA).some((n) => /folders|\.json$/.test(n)))
  const rm = await host.remove(viaTilde.id)
  check('a folder can be taken off the list; its files stay', rm.ok && (await host.list()).folders.length === 1 && existsSync(join(dirB, 'index.html')))
  check('removing an unknown id says so', (await host.remove('nope')).code === 'unknown')
  await host.add(dirB)
}

// ── open and serve ─────────────────────────────────────────────────────────────
const idA = (await host.list()).folders.find((f) => f.name === 'creator').id
const idB = (await host.list()).folders.find((f) => f.name === 'catalog').id
const opened = await host.open(idA, 'index.html', 'fr')
const T = opened.token
{
  check('open gives a token, the page and the list of pages', opened.ok && /^t[0-9a-f]{30,}$/.test(T) && opened.page === 'index.html' && opened.pages.join() === 'index.html')
  check('open on an unknown folder is refused', (await host.open('nope')).code === 'unknown')
  const page = await host.serve(T, 'index.html', { base: '/kybernos-maquettes/v/' + T })
  const html = page.body.toString('utf8')
  check('the page comes numbered, with the storage shim first and the editor tag last', page.ok && html.includes('data-ky-i="1"') && html.indexOf(STORAGE_SHIM) < html.indexOf('<link') && html.trimEnd().endsWith('</script>') && html.includes('src="/kybernos-maquettes/v/' + T + '/__ky/edit.js"') && html.includes('data-lang="fr"') && html.includes('data-file="index.html"'))
  check('raw, the page is the file byte for byte', (await host.serve(T, 'index.html', { raw: true })).body.toString('utf8') === fx.creator['index.html'])
  check('the empty path means the first page', (await host.serve(T, '', { raw: true })).body.toString('utf8') === fx.creator['index.html'])
  check('a page under a sub-folder is served as it is, not numbered', (await (async () => { mkdirSync(join(dirA, 'deep'), { recursive: true }); writeFileSync(join(dirA, 'deep', 'p.html'), '<p>x</p>'); const r = await host.serve(T, 'deep/p.html'); rmSync(join(dirA, 'deep'), { recursive: true }); return r.ok && r.body.toString('utf8') === '<p>x</p>' })()))
  const css = await host.serve(T, 'dsh.css')
  check('a stylesheet is served as it is with its type', css.ok && css.type.startsWith('text/css') && css.body.toString('utf8') === fx.creator['dsh.css'])
  check('withShim puts it after <head>, or after <body>, or after the doctype', withShim('<html><head><title>x</title></head>').includes('<head>' + STORAGE_SHIM) && withShim('<body>a').startsWith('<body>' + STORAGE_SHIM) && withShim('<!doctype html><p>a</p>').startsWith('<!doctype html>' + STORAGE_SHIM))
  const refused = []
  for (const rel of ['../secret.txt', 'a/../../x.css', '.hidden.css', 'images/.x.png', 'dsh.css/', '/etc/passwd', 'a\\b.css', 'noext', 'index.html.prev', 'x.sh', 'missing.css']) {
    const r = await host.serve(T, rel)
    if (r.ok) refused.push(rel)
  }
  check('paths that leave the folder, hidden files, unknown types and missing files are all refused', refused.length === 0, refused.join())
  writeFileSync(join(userHome, 'maquettes', 'outside.css'), 'a{}')
  symlinkSync(join(userHome, 'maquettes', 'outside.css'), join(dirA, 'link.css'))
  check('a symlink to a file outside the folder is refused', (await host.serve(T, 'link.css')).ok === false)
  check('an unknown or expired token reads nothing', (await host.serve('nope', 'index.html')).code === 'unknown-token')
  tick += 13 * 3600 * 1000
  check('a token expires after twelve hours', (await host.serve(T, 'index.html')).code === 'unknown-token')
  tick -= 13 * 3600 * 1000
  writeFileSync(join(dirA, 'bad.html'), Buffer.from([0x3c, 0x70, 0x3e, 0xff, 0xfe, 0x3c, 0x2f, 0x70, 0x3e]))
  const t2 = (await host.open(idA, 'bad.html', 'en')).token
  check('a page that is not valid UTF-8 is not opened for editing', (await host.serve(t2, 'bad.html')).code === 'not-utf8' && (await host.hash(t2, 'bad.html')).code === 'not-utf8')
  await fsp.unlink(join(dirA, 'bad.html'))
  await fsp.unlink(join(dirA, 'link.css'))
  const many = []
  for (let i = 0; i < 45; i++) many.push((await host.open(idA)).token)
  check('only the last forty tokens stay alive', host.who(many[0]) === null && host.who(many[44]) !== null)
}

// ── saving ─────────────────────────────────────────────────────────────────────
const open2 = async (id) => (await host.open(id, 'index.html')).token
const idOf = (html, name, nth = 0) => [...index(html).byId.entries()].filter(([, n]) => n.nodeName === name)[nth][0]
{
  const tok = await open2(idA)
  const before = snapshotOf(dirA)
  const h = await host.hash(tok, 'index.html')
  check('hash gives the page\'s sha1 and one per stylesheet', h.ok && /^[0-9a-f]{40}$/.test(h.hash) && Object.keys(h.files).join() === 'dsh.css')
  const h1 = idOf(fx.creator['index.html'], 'h1')
  const textPatch = { type: 'text', id: h1, node: 0, before: 'Create your app', after: 'Build your app' }
  check('nothing to save is refused', (await host.apply(tok, 'index.html', { baseHash: h.hash, patches: [] })).code === 'bad-patches')
  check('a missing base hash is refused', (await host.apply(tok, 'index.html', { patches: [textPatch] })).code === 'bad-body')
  check('another file name is refused', (await host.apply(tok, '../x.html', { baseHash: h.hash, patches: [textPatch] })).code === 'not-found' && (await host.apply(tok, 'dsh.css', { baseHash: h.hash, patches: [textPatch] })).code === 'not-found')
  const stale = await host.apply(tok, 'index.html', { baseHash: 'f'.repeat(40), patches: [textPatch] })
  check('a page that changed since the editor read it is a conflict: 409, nothing written', stale.status === 409 && stale.code === 'stale' && JSON.stringify(snapshotOf(dirA)) === JSON.stringify(before))
  const r = await host.apply(tok, 'index.html', { baseHash: h.hash, baseFiles: h.files, patches: [textPatch, { type: 'style', id: h1, prop: 'color', after: '#c14915' }] })
  const after = readFileSync(join(dirA, 'index.html'), 'utf8')
  check('a save writes the change and nothing else (one line differs)', r.ok && r.errors.length === 0 && after.includes('<h1 class="kb-title" style="color: #c14915">Build your app</h1>') && after.split('\n').filter((l, i) => l !== fx.creator['index.html'].split('\n')[i]).length === 1, JSON.stringify(r))
  check('the stylesheet was not rewritten', readFileSync(join(dirA, 'dsh.css'), 'utf8') === fx.creator['dsh.css'] && r.written.length === 1 && r.written[0].file === 'index.html')
  check('the folder holds no leftover: no .prev, no .ky-tmp', readdirSync(dirA).sort().join() === 'dsh.css,index.html')
  const snap = join(home, 'kybernos', 'kybernos-maquettes', 'snapshots', idA)
  check('the bytes before the save are under DSH_HOME', readFileSync(join(snap, 'index.html.prev'), 'utf8') === fx.creator['index.html'] && readFileSync(join(snap, 'index.html.orig'), 'utf8') === fx.creator['index.html'])
  const noop = await host.apply(tok, 'index.html', { baseHash: (await host.hash(tok, 'index.html')).hash, patches: [{ type: 'text', id: h1, node: 0, before: 'Build your app', after: 'Build your app' }] })
  check('a change that changes nothing writes nothing', noop.ok && noop.written.length === 0)
  const bad = await host.apply(tok, 'index.html', { baseHash: (await host.hash(tok, 'index.html')).hash, patches: [{ type: 'style', id: h1, prop: 'color', after: 'red; position: fixed' }] })
  check('a value that breaks out of its declaration is refused and reported, nothing written', bad.ok && bad.errors.length === 1 && readFileSync(join(dirA, 'index.html'), 'utf8') === after)

  // a rule in a stylesheet, with its own conflict check
  const hh = await host.hash(tok, 'index.html')
  const rule = { type: 'rule', file: 'dsh.css', selector: 'body', prop: 'color', after: 'var(--fg, #222)' }
  const staleCss = await host.apply(tok, 'index.html', { baseHash: hh.hash, baseFiles: { 'dsh.css': 'f'.repeat(40) }, patches: [rule] })
  check('a stylesheet that changed since is a conflict too', staleCss.status === 409)
  const okCss = await host.apply(tok, 'index.html', { baseHash: hh.hash, baseFiles: hh.files, patches: [rule] })
  check('a rule patch rewrites one line of the stylesheet', okCss.ok && okCss.written.map((w) => w.file).join() === 'dsh.css' && readFileSync(join(dirA, 'dsh.css'), 'utf8').includes('color: var(--fg, #222)'))

  // undo restores exactly the files of the last save
  const un = await host.undo(tok)
  check('undo puts back the files of the last save only', un.ok && un.restored === 1 && readFileSync(join(dirA, 'dsh.css'), 'utf8') === fx.creator['dsh.css'] && readFileSync(join(dirA, 'index.html'), 'utf8') === after)
  check('a second undo has nothing to go back to', (await host.undo(tok)).code === 'no-snapshot')
  const h2 = await host.hash(tok, 'index.html')
  await host.apply(tok, 'index.html', { baseHash: h2.hash, patches: [{ type: 'text', id: h1, node: 0, before: 'Build your app', after: 'Third title' }] })
  writeFileSync(join(dirA, 'index.html'), readFileSync(join(dirA, 'index.html'), 'utf8').replace('Third title', 'Kaby wrote this'))
  const blocked = await host.undo(tok)
  check('undo refuses when the file changed since the save (Kaby wrote it): nothing moves', blocked.status === 409 && blocked.code === 'changed-since' && readFileSync(join(dirA, 'index.html'), 'utf8').includes('Kaby wrote this'))
  const resetBlocked = await host.resetOriginal(tok)
  check('« put the original back » refuses in the same case, unless forced', resetBlocked.status === 409)
  const reset = await host.resetOriginal(tok, { force: true })
  check('forced, it puts every saved file back as it was before the first save', reset.ok && readFileSync(join(dirA, 'index.html'), 'utf8') === fx.creator['index.html'] && readFileSync(join(dirA, 'dsh.css'), 'utf8') === fx.creator['dsh.css'] && !existsSync(snap))
  check('and the folder is exactly what it was', readdirSync(dirA).sort().join() === 'dsh.css,index.html')
}

// ── structure, data files, several saves in a row ──────────────────────────────
{
  const tok = await open2(idB)
  const src = fx.catalog['index.html']
  const h = await host.hash(tok, 'index.html')
  const found = await host.find(tok, 'index.html', 'Gmail is Google’s email service, featuring spam protection, search functions, and seamless integration with other G Suite apps for productivity')
  check('find says a text built by a script sits in a data file', found.ok && found.n === 1 && found.files.join() === 'data.js')
  check('find on a text nobody wrote says 0', (await host.find(tok, 'index.html', 'Connect Gmail')).n === 0)
  const r = await host.apply(tok, 'index.html', { baseHash: h.hash, patches: [
    { type: 'srctext', before: 'App 7 does one thing well and nothing else (7).', after: 'App 7 is now described here.' },
    { type: 'struct', op: 'add', kind: 'text', lang: 'en', ref: idOf(src, 'h1'), where: 'after', newId: 'n1' },
  ] })
  const data = readFileSync(join(dirB, 'data.js'), 'utf8')
  check('a generated text is changed in its data file and the page gets the new block', r.ok && r.errors.length === 0 && data.includes('App 7 is now described here.') && readFileSync(join(dirB, 'index.html'), 'utf8').includes('<p>New text</p>') && r.written.map((w) => w.file).sort().join() === 'data.js,index.html', JSON.stringify(r))
  const win = {}
  new Function('window', data)(win)
  check('the data file still runs and keeps its 100 apps', win.KB_CATALOG.length === 100)
  const u = await host.undo(tok)
  check('undo restores both files', u.ok && u.restored === 2 && readFileSync(join(dirB, 'data.js'), 'utf8') === fx.catalog['data.js'] && readFileSync(join(dirB, 'index.html'), 'utf8') === src)
  // two saves racing: the second one started from the same hash, so it is a conflict, never a lost update
  const t1 = { type: 'text', id: idOf(src, 'h1'), node: 0, before: 'Connectors', after: 'One' }
  const [x, y] = await Promise.all([host.apply(tok, 'index.html', { baseHash: h.hash, patches: [t1] }), host.apply(tok, 'index.html', { baseHash: h.hash, patches: [{ ...t1, after: 'Two' }] })])
  check('two saves from the same version: one wins, the other is a conflict', [x.status ?? 200, y.status ?? 200].sort().join() === '200,409' && /<h1>(One|Two)<\/h1>/.test(readFileSync(join(dirB, 'index.html'), 'utf8')))
  await host.resetOriginal(tok, { force: true })
  check('the original is back after the race', readFileSync(join(dirB, 'index.html'), 'utf8') === src)
}

// ── a write that fails half way leaves the folder as it was ────────────────────
{
  let renames = 0
  const flaky = mk({ ...fsp, rename: async (a, b) => { renames++; if (renames === 2) throw new Error('disk full'); return fsp.rename(a, b) } })
  const tok = (await flaky.open(idB, 'index.html')).token
  const src = fx.catalog['index.html']
  const h = await flaky.hash(tok, 'index.html')
  renames = 0
  let threw = false
  try { await flaky.apply(tok, 'index.html', { baseHash: h.hash, patches: [{ type: 'srctext', before: 'App 7 does one thing well and nothing else (7).', after: 'Changed.' }, { type: 'text', id: idOf(src, 'h1'), node: 0, before: 'Connectors', after: 'Changed' }] }) } catch (e) { threw = true }
  const left = readdirSync(dirB).filter((n) => n.endsWith('.ky-tmp'))
  check('a rename that fails undoes the first one and removes the temp files', threw && readFileSync(join(dirB, 'index.html'), 'utf8') === src && readFileSync(join(dirB, 'data.js'), 'utf8') === fx.catalog['data.js'] && left.length === 0, `${threw} ${left.join()}`)
}

// ── pictures ───────────────────────────────────────────────────────────────────
{
  const tok = await open2(idA)
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 7)])
  check('sniffImage reads the bytes, not the name', sniffImage(png) === 'png' && sniffImage(Buffer.from('GIF89a......')) === 'gif' && sniffImage(Buffer.from('<svg xmlns=...>......')) === null)
  check('a script named .png is refused', (await host.upload(tok, Buffer.from('alert(1);//////////'), 'x.png')).code === 'not-image')
  check('an empty picture and an unknown token are refused', (await host.upload(tok, Buffer.alloc(0), 'a.png')).code === 'empty' && (await host.upload('nope', png, 'a.png')).code === 'unknown-token')
  check('a picture over 8 MB is refused', (await host.upload(tok, Buffer.concat([png, Buffer.alloc(8 * 1024 * 1024)]), 'big.png')).code === 'too-big')
  const up = await host.upload(tok, png, 'Équipe photo.PNG')
  check('a picture lands in images/ with a clean name and a hash', up.ok && /^images\/equipe-photo-[0-9a-f]{8}\.png$/.test(up.src) && existsSync(join(dirA, up.src)) && up.existed === false)
  check('the same picture twice is stored once', (await host.upload(tok, png, 'Équipe photo.PNG')).existed === true)
  writeFileSync(join(dirA, 'images', 'mine-12345678.png'), png)
  const gone = await host.unupload(tok, [up.src, 'images/mine-12345678.png', '../index.html', 'images/zz.png'])
  check('« cancel all » removes the pictures the editor added, never the ones the person had', gone.removed === 1 && !existsSync(join(dirA, up.src)) && existsSync(join(dirA, 'images', 'mine-12345678.png')))
  const up2 = await host.upload(tok, png, 'used.png')
  writeFileSync(join(dirA, 'index.html'), readFileSync(join(dirA, 'index.html'), 'utf8').replace('<main>', `<main><img src="${up2.src}" alt="">`))
  check('a picture a page uses is kept', (await host.unupload(tok, [up2.src])).removed === 0 && existsSync(join(dirA, up2.src)))
  writeFileSync(join(dirA, 'index.html'), fx.creator['index.html'])
  const h = await host.hash(tok, 'index.html')
  await host.apply(tok, 'index.html', { baseHash: h.hash, patches: [{ type: 'text', id: idOf(fx.creator['index.html'], 'h1'), node: 0, before: 'Create your app', after: 'x' }] })
  await host.resetOriginal(tok, { force: true })
  check('« put the original back » also removes the pictures the editor added', !existsSync(join(dirA, up2.src)) && existsSync(join(dirA, 'images', 'mine-12345678.png')))
}

// ── the blocks, the counters ───────────────────────────────────────────────────
{
  const fr = host.blocks('fr').blocks, en = host.blocks('en').blocks
  check('the Add panel has 15 blocks in the two languages, same kinds', fr.length === 15 && en.length === 15 && fr.every((b, i) => b.kind === en[i].kind) && fr[0].label === 'Titre' && en[0].label === 'Title' && fr[0].groupLabel === 'Texte' && en[0].groupLabel === 'Text')
  const s = await host.stats()
  check('the use counter counts what happened', s.opens >= 5 && s.saves >= 4 && s.undos >= 2 && s.conflicts >= 2 && s.uploads >= 3 && s['folders-added'] === 3 && s.resets >= 3 && s['edits-written'] >= 5, JSON.stringify(s))
  check('the counter is a file in DSH_HOME', JSON.parse(readFileSync(join(home, 'kybernos', 'kybernos-maquettes', 'usage.json'), 'utf8')).saves === s.saves)
}

process.exit(failed ? 1 : 0)

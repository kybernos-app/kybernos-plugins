// The host half end to end: `apply` with a fake DSH context, then the routes on a real socket with the browser's headers.
// What the sandboxed page can reach (the bytes of ITS file, the files of the editors, by token), what it is served with, what the guards refuse,
// and a whole open -> save -> conflict -> undo round trip over HTTP.
//
//   node packages/kybernos-office/test-host.mjs
import assert from 'node:assert/strict'
import http from 'node:http'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const base0 = mkdtempSync(join(tmpdir(), 'kb-office-host-'))
process.env.DSH_HOME = join(base0, 'dsh')
process.env.HOME = base0
const { apply } = await import('./index.js')
const { createHost } = await import('./office-host.mjs')
const { mountRoutes, ROUTE } = await import('./routes.mjs')
const { sessionSource } = await import('./session-guard.mjs')
const { SESSION_SECRET, sessionCookie } = await import('./lib-session-test.mjs')
const { docx, xlsx, md, pdf } = await import('./lib-test-files.mjs')
const fsp = await import('node:fs/promises')
sessionSource.secret = () => SESSION_SECRET
const sha = (b) => createHash('sha256').update(b).digest('hex')

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }

try {
  console.log('Kybernos office: the host')

  // ── apply() with a fake context ──────────────────────────────────────────────
  {
    const fakeServer = () => { const routes = []; return { routes, register: (r) => { routes.push(r); return () => { r.gone = true } } } }
    const a = fakeServer()
    const effects = []
    apply({ get: (k) => (k === 'webServer' ? a : undefined), effect: (fn, label) => effects.push([fn, label]), inject: () => { throw new Error('should not wait') } })
    const paths = a.routes.map((r) => r.path).sort()
    assert.deepEqual(paths, [ROUTE + '/open', ROUTE + '/save', ROUTE + '/stats', ROUTE + '/status', ROUTE + '/undo', ROUTE + '/v'])
    assert.equal(a.routes.find((r) => r.path === ROUTE + '/v').kind, 'prefix')
    ok('apply mounts five exact routes and one prefix route when the web server is there')
    assert.equal(effects.length, 1)
    effects[0][0]()()
    assert.ok(a.routes.every((r) => r.gone === true))
    ok('switching the plugin off takes every route back')

    let waited = null
    apply({ get: () => undefined, effect: () => {}, inject: (names, fn) => { waited = [names, fn] } })
    assert.deepEqual(waited[0], ['webServer'])
    const b = fakeServer()
    waited[1]({ webServer: b })
    assert.equal(b.routes.length, 6)
    ok('without the web server yet, apply waits for it and mounts when it comes')

    assert.doesNotThrow(() => apply({}))
    assert.doesNotThrow(() => apply(undefined))
    assert.doesNotThrow(() => apply({ get: () => { throw new Error('boom') }, effect: () => {} }))
    ok('apply never throws, whatever the context (a bundle must not stop DSH from starting)')
  }

  // ── the routes on a real socket ──────────────────────────────────────────────
  const work = join(base0, 'user', 'Documents')
  mkdirSync(work, { recursive: true })
  const editors = join(base0, 'dsh', 'kybernos', 'kybernos-office', 'editors')
  mkdirSync(join(editors, 'sheet'), { recursive: true })
  const js = Buffer.from('console.log("sheet")')
  writeFileSync(join(editors, 'sheet', 'app.js'), js)
  writeFileSync(join(editors, 'manifest.json'), JSON.stringify({ version: 't1', editors: ['sheet'], files: { 'sheet/app.js': { sha256: sha(js) } } }))
  const host = createHost({ fs: fsp, home: join(base0, 'dsh'), userHome: join(base0, 'user'), log: () => {} })
  const routes = new Map()
  mountRoutes({ register: (r) => { routes.set(r.path, r.handler); return () => {} } }, host, {})
  const server = http.createServer((req, res) => {
    const path = new URL(req.url, 'http://127.0.0.1').pathname
    const prefix = [...routes.keys()].find((k) => path === k || path.startsWith(k + '/'))
    const handler = routes.get(path) || (prefix !== undefined ? routes.get(prefix) : undefined)
    if (handler === undefined) { res.writeHead(404); res.end('{}'); return }
    Promise.resolve(handler(req, res)).catch(() => { try { res.writeHead(500); res.end('{}') } catch (e) { /* closed */ } })
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const port = server.address().port
  const origin = 'http://127.0.0.1:' + port
  const good = { origin, cookie: sessionCookie('127.0.0.1:' + port) }
  const call = (method, path, { headers = {}, body, host: hostHeader } = {}) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path, headers: { host: hostHeader || '127.0.0.1:' + port, ...headers } }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }))
    })
    req.on('error', reject)
    req.end(body)
  })
  const text = (r) => r.body.toString('utf8')
  const json = (r) => JSON.parse(text(r))
  const post = (path, obj, headers = good) => call('POST', path, { headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(obj) })
  const postBytes = (path, bytes, headers = good) => call('POST', path, { headers: { 'content-type': 'application/octet-stream', ...headers }, body: bytes })
  try {
    // open
    const sheetPath = join(work, 'budget.xlsx')
    const v1 = xlsx({ cell: 'v1' })
    writeFileSync(sheetPath, v1)
    const o = await post(ROUTE + '/open', { path: sheetPath })
    assert.equal(o.status, 200, text(o))
    const opened = json(o)
    assert.ok(/^[0-9a-f]{32}$/.test(opened.token) && opened.editor === 'sheet' && opened.installed === true && opened.hash === sha(v1) && opened.url === `${ROUTE}/v/${opened.token}/sheet/index.html`)
    ok('open: a token, the editor, the hash, whether it is installed, and the address of the editor page')
    const bad = await post(ROUTE + '/open', { path: join(work, 'nope.xlsx') })
    assert.equal(bad.status, 404); assert.equal(json(bad).error, 'not-found')
    assert.equal((await post(ROUTE + '/open', { path: 'relative.xlsx' })).status, 400)
    assert.equal((await post(ROUTE + '/open', { path: join(work, 'x.pptx') })).status, 415)
    ok('open refuses a missing file, a relative path and a format that has no light editor, with the right status')

    // what the sandboxed page is given
    const file = await call('GET', `${ROUTE}/v/${opened.token}/__file`)
    assert.equal(file.status, 200); assert.ok(file.body.equals(v1)); assert.equal(file.headers['x-office-hash'], sha(v1))
    assert.match(file.headers['content-security-policy'], /^sandbox allow-scripts;/); assert.match(file.headers['content-security-policy'], /connect-src 'self'/)
    assert.match(file.headers['content-security-policy'], /default-src 'none'/)
    assert.equal(file.headers['access-control-allow-origin'], '*'); assert.match(file.headers['access-control-expose-headers'], /X-Office-Hash/)
    assert.equal(file.headers['x-content-type-options'], 'nosniff'); assert.equal(file.headers['cache-control'], 'no-store')
    ok('the bytes of the file go to the page by token, with the hash in a header, and the page is sandboxed and cut off from the network')
    const asset = await call('GET', `${ROUTE}/v/${opened.token}/sheet/app.js`)
    assert.equal(asset.status, 200); assert.ok(asset.body.equals(js)); assert.match(asset.headers['content-type'], /^text\/javascript/)
    const page = await call('GET', `${ROUTE}/v/${opened.token}/sheet/index.html`)
    assert.equal(page.status, 200); assert.match(page.headers['content-type'], /^text\/html/); assert.ok(text(page).includes('src="app.js"'))
    ok('the editor page and its files are served to a live token')
    for (const rel of ['secret.txt', 'sheet/../../x', 'doc/index.html', '%2e%2e/manifest.json', 'sheet/nope.js']) {
      const r = await call('GET', `${ROUTE}/v/${opened.token}/${rel}`)
      assert.ok(r.status === 404, rel + ' -> ' + r.status)
    }
    assert.equal((await call('GET', `${ROUTE}/v/${'a'.repeat(32)}/__file`)).status, 404)
    assert.equal((await call('GET', `${ROUTE}/v/${'a'.repeat(32)}/sheet/app.js`)).status, 404)
    assert.equal((await call('GET', `${ROUTE}/v/%zz/__file`)).status, 404)
    ok('nothing else is served: not a file outside the manifest, not a path that climbs, not a token that was never minted')
    assert.equal((await call('POST', `${ROUTE}/v/${opened.token}/__file`)).status, 405)
    assert.equal((await call('GET', `${ROUTE}/v/${opened.token}/__file`, { host: 'evil.example' })).status, 403)
    ok('the file route takes GET and HEAD only, and refuses a Host that is not the listener\'s')

    // save, conflict, undo over HTTP
    const v2 = xlsx({ cell: 'v2' })
    const saved = await postBytes(`${ROUTE}/save?token=${opened.token}&base=${opened.hash}`, v2)
    assert.equal(saved.status, 200, text(saved)); assert.ok(readFileSync(sheetPath).equals(v2)); assert.equal(json(saved).hash, sha(v2))
    ok('save writes the body as the file when the base hash is still on disk')
    const stale = await postBytes(`${ROUTE}/save?token=${opened.token}&base=${opened.hash}`, xlsx({ cell: 'v3' }))
    assert.equal(stale.status, 409); assert.equal(json(stale).error, 'changed-on-disk'); assert.ok(readFileSync(sheetPath).equals(v2))
    const junk = await postBytes(`${ROUTE}/save?token=${opened.token}&base=${sha(v2)}`, Buffer.from('<html>no</html>'))
    assert.equal(junk.status, 422); assert.ok(readFileSync(sheetPath).equals(v2))
    const cp = await postBytes(`${ROUTE}/save?token=${opened.token}&mode=copy`, xlsx({ cell: 'copy' }))
    assert.equal(cp.status, 200); assert.equal(json(cp).name, 'budget (edited).xlsx'); assert.ok(readFileSync(sheetPath).equals(v2))
    assert.deepEqual(readdirSync(work).sort(), ['budget (edited).xlsx', 'budget.xlsx'])
    ok('a stale base is a 409, something that is not a workbook is a 422, a copy lands next to the file; the file itself is untouched each time')
    const u = await post(ROUTE + '/undo', { token: opened.token })
    assert.equal(u.status, 200, text(u)); assert.ok(readFileSync(sheetPath).equals(v1))
    assert.equal((await post(ROUTE + '/undo', { token: opened.token })).status, 404)
    const again = await call('GET', `${ROUTE}/v/${opened.token}/__file`)
    assert.ok(again.body.equals(v1) && again.headers['x-office-hash'] === sha(v1))
    ok('undo puts the file back, and the page that reloads gets the restored bytes and the new hash')
    const tooBig = await postBytes(`${ROUTE}/save?token=${opened.token}&base=${sha(v1)}`, Buffer.alloc(65 * 1024 * 1024, 7))
    assert.equal(tooBig.status, 413); assert.ok(readFileSync(sheetPath).equals(v1))
    ok('a body over 64 MB is refused before anything is written')

    // reads
    const st = json(await call('GET', ROUTE + '/status'))
    assert.equal(st.ok, true); assert.equal(st.version, 't1'); assert.equal(st.installed.sheet, true); assert.equal(st.installed.doc, false)
    const stats = json(await call('GET', ROUTE + '/stats'))
    assert.ok(stats.stats.xlsx.saves >= 1 && stats.stats.xlsx.opens >= 1)
    ok('status says which editors are installed, stats counts the use')

    // a document with a chart-less, comment-bearing body: the notice, not a block
    const docPath = join(work, 'review.docx')
    writeFileSync(docPath, docx({ tracked: true, comment: true }))
    const dopen = json(await post(ROUTE + '/open', { path: docPath }))
    assert.equal(dopen.editor, 'doc'); assert.equal(dopen.installed, false); assert.equal(dopen.block, false)
    assert.deepEqual(dopen.losses.map((l) => l.code).sort(), ['comment', 'tracked-changes'])
    const blocked = json(await post(ROUTE + '/open', { path: (writeFileSync(join(work, 'chart.xlsx'), xlsx({ chart: true })), join(work, 'chart.xlsx')) }))
    assert.equal(blocked.block, true)
    ok('open carries the guard\'s verdict: a notice for what is kept, block for what would be lost, installed:false when the editor is not built')

    // a note and a PDF: no zip, the same open / save / conflict rules
    const notePath = join(work, 'notes.md')
    const n1 = md({ comment: true })
    writeFileSync(notePath, n1)
    const nopen = json(await post(ROUTE + '/open', { path: notePath }))
    assert.equal(nopen.editor, 'md'); assert.equal(nopen.format, 'md'); assert.equal(nopen.block, true); assert.equal(nopen.losses[0].code, 'html-comment'); assert.equal(nopen.installed, false)
    assert.equal(nopen.url, `${ROUTE}/v/${nopen.token}/md/index.html`)
    const nfile = await call('GET', `${ROUTE}/v/${nopen.token}/__file`)
    assert.ok(nfile.body.equals(n1) && nfile.headers['x-office-hash'] === sha(n1))
    const n2 = Buffer.from('# Rewritten\n')
    assert.equal((await postBytes(`${ROUTE}/save?token=${nopen.token}&base=${nopen.hash}`, n2)).status, 200); assert.ok(readFileSync(notePath).equals(n2))
    assert.equal((await postBytes(`${ROUTE}/save?token=${nopen.token}&base=${sha(n2)}`, Buffer.alloc(0))).status, 200); assert.equal(readFileSync(notePath).length, 0)
    assert.equal((await postBytes(`${ROUTE}/save?token=${nopen.token}&base=${sha(Buffer.alloc(0))}`, Buffer.from([0x68, 0, 0x69]))).status, 422)
    assert.equal(json(await post(ROUTE + '/undo', { token: nopen.token })).ok, true); assert.ok(readFileSync(notePath).equals(n2))
    assert.equal(json(await postBytes(`${ROUTE}/save?token=${nopen.token}&base=${sha(n1)}`, n1)).error, 'changed-on-disk')
    ok('a Markdown file opens with the guard\'s verdict, saves (even emptied: a note may be) and undoes; bytes that are not text and a stale base are refused')
    const pdfPath = join(work, 'paper.pdf')
    const f1 = pdf({ text: 'v1' })
    writeFileSync(pdfPath, f1)
    const popen = json(await post(ROUTE + '/open', { path: pdfPath }))
    assert.equal(popen.editor, 'pdf'); assert.equal(popen.block, false); assert.equal(popen.url, `${ROUTE}/v/${popen.token}/pdf/index.html`)
    const f2 = pdf({ text: 'v2' })
    assert.equal((await postBytes(`${ROUTE}/save?token=${popen.token}&base=${popen.hash}`, f2)).status, 200); assert.ok(readFileSync(pdfPath).equals(f2))
    assert.equal((await postBytes(`${ROUTE}/save?token=${popen.token}&base=${sha(f2)}`, Buffer.from('<html>not a pdf</html>'))).status, 422); assert.ok(readFileSync(pdfPath).equals(f2))
    assert.equal((await postBytes(`${ROUTE}/save?token=${popen.token}&base=${sha(f2)}`, Buffer.alloc(0))).status, 413)
    assert.equal(json(await post(ROUTE + '/open', { path: (writeFileSync(join(work, 'locked.pdf'), pdf({ encrypt: true })), join(work, 'locked.pdf')) })).block, true)
    ok('a PDF opens, saves, and refuses something that is not a PDF or is empty; a password-protected one is a block')
  } finally {
    server.close()
  }
  console.log('\nOFFICE HOST — ' + pass + ' vérification(s), 0 échec')
} catch (e) {
  console.error('  ✗ ' + String(e && e.stack ? e.stack : e))
  process.exitCode = 1
}

#!/usr/bin/env node
// check-share-page.mjs — the page that shows a shared dashboard, in a real headless Chrome: the file a person keeps (public and protected, from file://), the same page served the way the
// Kybernos server will serve it (own site, the snapshot beside it as JSON), a hostile snapshot, a phone width, and the content policy doing its job.
//
//   KB_NODE_MODULES=<a node_modules folder with playwright-core> node scripts/check-share-page.mjs
//
// Not part of run-all-tests (it needs a Chrome); run it after a change of packages/kybernos-db/share/ that touches what the page draws or loads.
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const NM = process.env.KB_NODE_MODULES
if (!NM) { console.log('skipped: set KB_NODE_MODULES to a node_modules folder with playwright-core'); process.exit(0) }
const { chromium } = createRequire(NM.endsWith('/') ? NM : NM + '/')('playwright-core')
const root = new URL('..', import.meta.url).pathname
const { DASHBOARD, salesWorld } = await import(root + 'packages/kybernos-db/lib-share-test.mjs')
const { buildSnapshot } = await import(root + 'packages/kybernos-db/share/snapshot.mjs')
const { sealText } = await import(root + 'packages/kybernos-db/share/seal.mjs')
const { exportFile, viewerHtml } = await import(root + 'packages/kybernos-db/share/viewer.mjs')

const cache = join(process.env.HOME || '', 'Library', 'Caches', 'ms-playwright')
const exe = process.env.PW_BIN || (existsSync(cache) ? (() => { const d = readdirSync(cache).filter((x) => x.startsWith('chromium_headless_shell-')).sort().pop(); if (!d) return undefined; const sub = readdirSync(join(cache, d)).find((x) => x.startsWith('chrome-headless-shell')); return sub ? join(cache, d, sub, 'chrome-headless-shell') : undefined })() : undefined)
const browser = await chromium.launch(exe ? { executablePath: exe } : {})

const world = salesWorld()
const made = buildSnapshot({ dashboard: DASHBOARD, api: world.api, now: Date.UTC(2026, 10, 2, 9) })
assert.equal(made.ok, true)
const PASSWORD = 'correct horse battery'
const envelope = await sealText(JSON.stringify(made.doc), PASSWORD, { iterations: 100000 })
const dir = mkdtempSync(join(tmpdir(), 'kb-share-page-'))
writeFileSync(join(dir, 'public.html'), exportFile(made.doc))
writeFileSync(join(dir, 'sealed.html'), exportFile(envelope))
const EVIL = '"><img src=x onerror="window.__pwned=1"><script>window.__pwned=2</script>'
writeFileSync(join(dir, 'evil.html'), exportFile({ ...made.doc, title: EVIL, desc: EVIL, widgets: made.doc.widgets.map((w) => ({ ...w, title: EVIL })) }))

let n = 0
const check = async (label, fn) => { await fn(); n++; console.log('ok  ', label) }
async function open (url, { width = 1200, scheme = 'light' } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme })
  const page = await ctx.newPage()
  const problems = []
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') problems.push(m.type() + ': ' + m.text()) })
  page.on('pageerror', (e) => problems.push('pageerror: ' + e.message))
  await page.goto(url)
  return { page, ctx, problems }
}

await check('the file a person keeps draws the dashboard from file://, with no console error', async () => {
  const { page, ctx, problems } = await open(pathToFileURL(join(dir, 'public.html')).href)
  await page.waitForSelector('.kv-grid', { timeout: 5000 })
  assert.equal(await page.title(), 'Sales')
  assert.equal(await page.locator('section.kv-w').count(), 9)
  assert.equal(await page.locator('svg.kv-svg').count(), 4)
  assert.equal(await page.locator('.kv-tbl tbody tr').count(), 5)
  assert.match(await page.locator('.kv-t-card').first().innerText(), /2,750/)
  assert.deepEqual(problems, [])
  await ctx.close()
})

await check('light and dark follow the reader, and a phone gets one column with no sideways scroll', async () => {
  const light = await open(pathToFileURL(join(dir, 'public.html')).href, { scheme: 'light' })
  await light.page.waitForSelector('.kv-grid')
  const dark = await open(pathToFileURL(join(dir, 'public.html')).href, { scheme: 'dark' })
  await dark.page.waitForSelector('.kv-grid')
  const bg = (p) => p.evaluate(() => getComputedStyle(document.body).backgroundColor)
  assert.notEqual(await bg(light.page), await bg(dark.page))
  const phone = await open(pathToFileURL(join(dir, 'public.html')).href, { width: 390 })
  await phone.page.waitForSelector('.kv-grid')
  assert.equal(await phone.page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false)
  assert.equal(await phone.page.evaluate(() => getComputedStyle(document.querySelector('.kv-grid')).gridTemplateColumns.split(' ').length), 1)
  const wide = await open(pathToFileURL(join(dir, 'public.html')).href)
  await wide.page.waitForSelector('.kv-grid')
  assert.equal(await wide.page.evaluate(() => getComputedStyle(document.querySelector('.kv-grid')).gridTemplateColumns.split(' ').length), 12)
  for (const x of [light, dark, phone, wide]) await x.ctx.close()
})

await check('a protected file shows only a password page; a wrong password asks again, the right one opens it', async () => {
  const { page, ctx, problems } = await open(pathToFileURL(join(dir, 'sealed.html')).href, { width: 900 })
  await page.waitForSelector('#kv-pw')
  assert.equal(await page.locator('.kv-grid').count(), 0)
  assert.equal((await page.content()).includes('2,750'), false)
  assert.equal(await page.title(), 'Protected dashboard')
  await page.fill('#kv-pw', 'a wrong password')
  await page.click('button[type=submit]')
  await page.waitForSelector('.kv-err', { timeout: 20000 })
  assert.match(await page.locator('.kv-err').innerText(), /Wrong password/)
  assert.equal(await page.locator('.kv-grid').count(), 0)
  await page.fill('#kv-pw', PASSWORD)
  await page.click('button[type=submit]')
  await page.waitForSelector('.kv-grid', { timeout: 20000 })
  assert.equal(await page.title(), 'Sales')
  assert.equal(await page.locator('section.kv-w').count(), 9)
  assert.deepEqual(problems, [])
  await ctx.close()
})

await check('a hostile snapshot is text: no image, no script, nothing ran, and the policy refuses a script added to the page', async () => {
  const { page, ctx } = await open(pathToFileURL(join(dir, 'evil.html')).href)
  await page.waitForSelector('.kv-grid')
  assert.equal(await page.evaluate(() => window.__pwned), undefined)
  assert.equal(await page.locator('main img').count(), 0)
  assert.equal(await page.locator('main script').count(), 0)
  assert.ok((await page.locator('h1').innerText()).includes('<img src=x'))
  const blocked = await page.evaluate(() => new Promise((resolve) => {
    document.addEventListener('securitypolicyviolation', () => resolve(true))
    const s = document.createElement('script')
    s.textContent = 'window.__injected = 1'
    document.body.appendChild(s)
    setTimeout(() => resolve(window.__injected === 1 ? false : true), 300)
  }))
  assert.equal(blocked, true)
  assert.equal(await page.evaluate(() => window.__injected), undefined)
  await ctx.close()
})

await check('served as the server will serve it: the same page for every link, the snapshot beside it as JSON; a missing link says so; a protected link asks', async () => {
  const shell = viewerHtml({})
  const docs = { '/s/open1.json': JSON.stringify(made.doc), '/s/shut1.json': JSON.stringify(envelope) }
  const requests = []
  const server = createServer((req, res) => {
    requests.push(req.url)
    if (req.url === '/s/open1' || req.url === '/s/shut1' || req.url === '/s/gone1') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': shell.policy + "; frame-ancestors 'none'" }); res.end(shell.html); return }
    if (docs[req.url] !== undefined) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(docs[req.url]); return }
    res.writeHead(404, { 'content-type': 'application/json' }); res.end('{}')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = 'http://127.0.0.1:' + server.address().port
  try {
    const a = await open(base + '/s/open1')
    await a.page.waitForSelector('.kv-grid', { timeout: 5000 })
    assert.equal(await a.page.locator('section.kv-w').count(), 9)
    assert.deepEqual(a.problems, [])
    assert.deepEqual(requests.filter((r) => r !== '/s/open1'), ['/s/open1.json'], 'the page asks for its snapshot and for nothing else')
    const b = await open(base + '/s/shut1')
    await b.page.waitForSelector('#kv-pw')
    await b.page.fill('#kv-pw', PASSWORD)
    await b.page.click('button[type=submit]')
    await b.page.waitForSelector('.kv-grid', { timeout: 20000 })
    const c = await open(base + '/s/gone1')
    await c.page.waitForSelector('.kv-center')
    assert.match(await c.page.locator('h1').innerText(), /could not be loaded/)
    for (const x of [a, b, c]) await x.ctx.close()
  } finally { server.close() }
})

await browser.close()
console.log('\ncheck-share-page: ' + n + ' checks passed')

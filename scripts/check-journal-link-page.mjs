#!/usr/bin/env node
// check-journal-link-page.mjs — the page that shows a shared chat Journal, served the way the Kybernos server serves a link (own site, the document beside it as JSON), in a real
// headless Chrome: an open link, a protected link (lock screen, wrong password, right password), a link that is gone, a phone width, the dark scheme and the content policy.
//
//   KB_NODE_MODULES=<a node_modules folder with playwright-core> node scripts/check-journal-link-page.mjs
//
// Not part of run-all-tests (it needs a Chrome); run it after a change of journal-viewer.js, journal-page.mjs or the vendored seal code.
import assert from 'node:assert/strict'
import { existsSync, readdirSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { join } from 'node:path'

const NM = process.env.KB_NODE_MODULES
if (!NM) { console.log('skipped: set KB_NODE_MODULES to a node_modules folder with playwright-core'); process.exit(0) }
const { chromium } = createRequire(NM.endsWith('/') ? NM : NM + '/')('playwright-core')
const root = new URL('..', import.meta.url).pathname
const { journalViewerHtml } = await import(root + 'packages/kybernos-plugin/journal-page.mjs')
const { sampleJournalDoc } = await import(root + 'scripts/lib-journal-sample.mjs')
const { sealText } = await import(root + 'packages/kybernos-plugin/vendored-share-seal.mjs')

const cache = join(process.env.HOME || '', 'Library', 'Caches', 'ms-playwright')
const exe = process.env.PW_BIN || (existsSync(cache) ? (() => { const d = readdirSync(cache).filter((x) => x.startsWith('chromium_headless_shell-')).sort().pop(); if (!d) return undefined; const sub = readdirSync(join(cache, d)).find((x) => x.startsWith('chrome-')); const bin = sub ? join(cache, d, sub, 'chrome-headless-shell') : ''; return existsSync(bin) ? bin : undefined })() : undefined)
const browser = await chromium.launch(exe ? { executablePath: exe } : {})

const doc = sampleJournalDoc({ sessionId: 'session-LINKCHAT1' })
assert.ok(doc !== null)
const PASSWORD = 'correct horse battery'
const envelope = await sealText(JSON.stringify(doc), PASSWORD, { iterations: 100000 })

const page = journalViewerHtml()
const routes = new Map([['/s/openlink', JSON.stringify(doc)], ['/s/sealedlink', JSON.stringify(envelope)]])
const server = createServer((req, res) => {
  const path = (req.url || '').split('?')[0]
  const isJson = path.endsWith('.json')
  const key = isJson ? path.slice(0, -5) : path
  if (!routes.has(key)) { res.writeHead(404, isJson ? { 'content-type': 'application/json' } : { 'content-type': 'text/html' }); res.end(isJson ? '{}' : page.html); return }
  if (isJson) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(routes.get(key)); return }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': page.policy + "; frame-ancestors 'none'", 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff' })
  res.end(page.html)
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = 'http://127.0.0.1:' + server.address().port

let n = 0
const check = async (label, fn) => { await fn(); n++; console.log('ok  ', label) }
async function open (url, { width = 1200, scheme = 'light' } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme })
  const p = await ctx.newPage()
  const problems = []
  p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') problems.push(m.type() + ': ' + m.text()) })
  p.on('pageerror', (e) => problems.push('pageerror: ' + e.message))
  await p.goto(url)
  return { p, ctx, problems }
}

try {
  await check('an open link draws the Journal from its own site, with no console error', async () => {
    const { p, ctx, problems } = await open(base + '/s/openlink')
    await p.waitForSelector('.kj-wrap', { timeout: 5000 })
    assert.equal(await p.locator('.kj-stat').count() > 0, true)
    assert.equal(await p.locator('.kj-row').count() > 0, true)
    assert.deepEqual(problems.filter((x) => x.includes('Content Security Policy') || x.includes('pageerror')), [])
    assert.deepEqual(problems, [])
    await ctx.close()
  })
  await check('a protected link shows a lock screen and nothing of the Journal', async () => {
    const { p, ctx } = await open(base + '/s/sealedlink')
    await p.waitForSelector('.kj-lock', { timeout: 5000 })
    assert.equal(await p.locator('.kj-stat').count(), 0)
    assert.match(await p.locator('.kj-lock').innerText(), /Protected journal/)
    assert.equal(await p.locator('input[type=password]').count(), 1)
    const html = await p.content()
    assert.equal(html.includes('GMAIL'), false)
    await ctx.close()
  })
  await check('a wrong password asks again, the right one opens the Journal', async () => {
    const { p, ctx } = await open(base + '/s/sealedlink')
    await p.waitForSelector('.kj-lock')
    await p.fill('input[type=password]', 'not the password')
    await p.click('button[type=submit]')
    await p.waitForFunction(() => /Wrong password/.test(document.body.innerText), null, { timeout: 15000 })
    assert.equal(await p.locator('.kj-stat').count(), 0)
    await p.fill('input[type=password]', PASSWORD)
    await p.click('button[type=submit]')
    await p.waitForSelector('.kj-stat', { timeout: 15000 })
    assert.equal(await p.locator('.kj-lock').count(), 0)
    await ctx.close()
  })
  await check('a link that is gone says so, the same way for every reason', async () => {
    const { p, ctx } = await open(base + '/s/nolink')
    await p.waitForFunction(() => /could not be loaded/.test(document.body.innerText), null, { timeout: 5000 })
    assert.equal(await p.locator('.kj-stat').count(), 0)
    await ctx.close()
  })
  await check('the lock screen speaks French in a French browser', async () => {
    const ctx = await browser.newContext({ locale: 'fr-FR', viewport: { width: 1200, height: 900 } })
    const p = await ctx.newPage()
    await p.goto(base + '/s/sealedlink')
    await p.waitForSelector('.kj-lock')
    assert.match(await p.locator('.kj-lock').innerText(), /Journal protégé/)
    await ctx.close()
  })
  await check('the lock screen and the opened Journal fit a phone and the dark scheme', async () => {
    const { p, ctx } = await open(base + '/s/sealedlink', { width: 375, scheme: 'dark' })
    await p.waitForSelector('.kj-lock')
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
    await p.fill('input[type=password]', PASSWORD)
    await p.click('button[type=submit]')
    await p.waitForSelector('.kj-stat', { timeout: 15000 })
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
    await ctx.close()
  })
  await check('the content policy blocks a script that is not the page\'s own', async () => {
    const { p, ctx } = await open(base + '/s/openlink')
    await p.waitForSelector('.kj-wrap')
    const ran = await p.evaluate(() => { try { const s = document.createElement('script'); s.textContent = 'window.__pwned = 1'; document.head.appendChild(s) } catch (e) { /* refused */ } return window.__pwned === 1 })
    assert.equal(ran, false)
    await ctx.close()
  })
} finally {
  await browser.close()
  server.close()
}
console.log(n + ' checks passed')

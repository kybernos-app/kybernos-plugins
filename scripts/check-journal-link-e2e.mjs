#!/usr/bin/env node
// check-journal-link-e2e.mjs — the Journal as a link, end to end against a REAL kybernos-server (its `/v1/snapshots` and `/s/<id>`): the cloud bundle's `snapshots` seam, the verbs of
// journal-link.mjs and the page the server serves, opened in a real headless Chrome. Nothing here is a stand-in but the account: the device token it is given.
//
//   KB_NODE_MODULES=<node_modules with playwright-core> node scripts/check-journal-link-e2e.mjs --info <file>
//   (--info: a JSON file {"base": "http://127.0.0.1:PORT", "token": "kyd_…"}; or --base <address> with the token in KB_E2E_TOKEN. The token is never printed.)
//
// The server must have SNAPSHOT_LINK_BASE equal to its own address (so that the link it returns opens on it). Against the deployed server, use a device token of a test account: this makes
// and deletes links on that account. Not part of run-all-tests (it needs a server and a Chrome).
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const argv = process.argv.slice(2)
const opt = (name) => { const i = argv.indexOf(name); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null }
let base = opt('--base')
let token = process.env.KB_E2E_TOKEN || null
if (opt('--info') !== null) { const info = JSON.parse(readFileSync(opt('--info'), 'utf8')); base = info.base; token = info.token }
const NM = process.env.KB_NODE_MODULES
if (!base || !token || !NM) { console.log('usage: KB_NODE_MODULES=<node_modules with playwright-core> node scripts/check-journal-link-e2e.mjs --info <file> (see the header)'); process.exit(2) }
const { chromium } = createRequire(NM.endsWith('/') ? NM : NM + '/')('playwright-core')
const root = new URL('..', import.meta.url).pathname

// the cloud bundle reads its account from a state file: a throw-away one holding the token
const realHome = process.env.HOME || ''
const home = mkdtempSync(join(tmpdir(), 'kb-journal-e2e-'))
process.env.HOME = home
process.env.DSH_HOME = join(home, '.dsh')
process.env.KYBERNOS_CLOUD_API = base
process.env.KYBERNOS_CLOUD_STATE = join(home, 'kybernos-cloud.json')
delete process.env.KYBERNOS_SERVERS_FILE
writeFileSync(process.env.KYBERNOS_CLOUD_STATE, JSON.stringify({ token, api: base }) + '\n', { mode: 0o600 })

const { publishSnapshotsSeam, SNAPSHOTS_SEAM } = await import(root + 'packages/kybernos-cloud/index.js')
const { createJournalLinks } = await import(root + 'packages/kybernos-plugin/journal-link.mjs')
const { journalViewerHtml } = await import(root + 'packages/kybernos-plugin/journal-page.mjs')
const { openSealed } = await import(root + 'packages/kybernos-plugin/vendored-share-seal.mjs')
const { sampleJournalDoc } = await import(root + 'scripts/lib-journal-sample.mjs')

const target = {}
publishSnapshotsSeam(target)
const seam = target[SNAPSHOTS_SEAM]
const links = createJournalLinks({ dir: join(home, 'links'), seam: () => seam })

const cache = join(realHome, 'Library', 'Caches', 'ms-playwright')
const exe = process.env.PW_BIN || (existsSync(cache) ? (() => { const d = readdirSync(cache).filter((x) => x.startsWith('chromium_headless_shell-')).sort().pop(); if (!d) return undefined; const sub = readdirSync(join(cache, d)).find((x) => x.startsWith('chrome-')); const bin = sub ? join(cache, d, sub, 'chrome-headless-shell') : ''; return existsSync(bin) ? bin : undefined })() : undefined)
const browser = await chromium.launch(exe ? { executablePath: exe } : {})

let n = 0
const check = async (label, fn) => { await fn(); n += 1; console.log('ok  ', label) }
const getText = async (url) => { const r = await fetch(url, { redirect: 'manual' }); return { status: r.status, text: await r.text(), headers: r.headers } }
async function open (url, { width = 1200 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } })
  const p = await ctx.newPage()
  const problems = []
  p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') problems.push(m.type() + ': ' + m.text()) })
  p.on('pageerror', (e) => problems.push('pageerror: ' + e.message))
  const res = await p.goto(url)
  return { p, ctx, problems, res }
}

const CHAT_A = 'session-E2EPROTECTED1'
const CHAT_B = 'session-E2EOPENLINK2'
const docA = sampleJournalDoc({ sessionId: CHAT_A, marker: 'MARK-E2E-REPLY', include: { approvers: true, timing: true, deliverables: true, prompts: true } })
let linkA = null
let linkB = null
try {
  await check('the account may make links, and has none yet', async () => {
    const s = await seam.status()
    assert.equal(s.ok, true, JSON.stringify(s))
    assert.equal(s.available, true)
    assert.ok(s.maxBytes > 0 && s.maxCount > 0 && s.ttlDays > 0, JSON.stringify(s))
    assert.deepEqual(s.links.filter((l) => l.doc === 'journal'), [])
  })

  await check('a protected link is made; the server holds an envelope with no word of the Journal', async () => {
    const r = await links.publish({ sessionId: CHAT_A, doc: docA })
    assert.equal(r.ok, true, JSON.stringify(r))
    linkA = r.link
    assert.equal(linkA.protected, true)
    assert.ok(linkA.url.startsWith(base + '/s/'), linkA.url + ' should start with ' + base + '/s/ (SNAPSHOT_LINK_BASE)')
    const stored = await getText(linkA.url + '.json')
    assert.equal(stored.status, 200)
    assert.match(stored.headers.get('content-type') || '', /application\/json/)
    const env = JSON.parse(stored.text)
    assert.equal(env.sealed, true)
    assert.equal(/MARK-E2E-REPLY|kybernos-journal|GMAIL/.test(stored.text), false)
    assert.deepEqual(JSON.parse(await openSealed(env, linkA.password)), docA, 'the password opens exactly the document that was sent')
  })

  await check('the page the server serves for it is the plugin\'s Journal page, byte for byte, with its policy', async () => {
    const page = await getText(linkA.url)
    assert.equal(page.status, 200)
    assert.equal(page.text, journalViewerHtml().html)
    const csp = page.headers.get('content-security-policy') || ''
    assert.ok(csp.includes("connect-src 'self'") && csp.includes('img-src data:') && csp.includes("frame-ancestors 'none'") && !/unsafe-/.test(csp), csp)
    assert.match(page.headers.get('x-robots-tag') || '', /noindex/)
  })

  await check('in a real browser: a lock screen, a wrong password asks again, the right one draws the Journal, no console error', async () => {
    const { p, ctx, problems } = await open(linkA.url)
    await p.waitForSelector('.kj-lock', { timeout: 10000 })
    assert.equal(await p.locator('.kj-stat').count(), 0)
    await p.fill('input[type=password]', 'not the password')
    await p.click('button[type=submit]')
    await p.waitForFunction(() => /Wrong password/.test(document.body.innerText), null, { timeout: 15000 })
    await p.fill('input[type=password]', linkA.password)
    await p.click('button[type=submit]')
    await p.waitForSelector('.kj-stat', { timeout: 15000 })
    assert.ok((await p.locator('.kj-row').count()) > 0)
    assert.match(await p.locator('.kj-wrap').innerText(), /MARK-E2E-REPLY/)
    assert.deepEqual(problems, [])
    await ctx.close()
  })

  await check('an update keeps the link and the password and replaces the content', async () => {
    const docA2 = sampleJournalDoc({ sessionId: CHAT_A, marker: 'MARK-E2E-SECOND', include: { approvers: true, timing: true, deliverables: true, prompts: true } })
    const r = await links.publish({ sessionId: CHAT_A, doc: docA2 })
    assert.equal(r.ok, true, JSON.stringify(r))
    assert.equal(r.link.url, linkA.url)
    assert.equal(r.link.password, linkA.password)
    const env = JSON.parse((await getText(linkA.url + '.json')).text)
    assert.match(await openSealed(env, linkA.password), /MARK-E2E-SECOND/)
    const s = await links.state(CHAT_A)
    assert.equal(s.available, true)
    assert.equal(s.link.gone, false)
  })

  await check('an open link carries the document as it is and the page draws it with no lock', async () => {
    const docB = sampleJournalDoc({ sessionId: CHAT_B, marker: 'MARK-E2E-OPEN' })
    const r = await links.publish({ sessionId: CHAT_B, doc: docB, protect: false })
    assert.equal(r.ok, true, JSON.stringify(r))
    linkB = r.link
    assert.equal(linkB.protected, false)
    assert.deepEqual(JSON.parse((await getText(linkB.url + '.json')).text), docB)
    const { p, ctx, problems } = await open(linkB.url)
    await p.waitForSelector('.kj-stat', { timeout: 10000 })
    assert.equal(await p.locator('.kj-lock').count(), 0)
    assert.deepEqual(problems, [])
    await ctx.close()
  })

  await check('the account lists both links as Journals, one protected, one open', async () => {
    const s = await seam.status()
    const mine = s.links.filter((l) => l.doc === 'journal')
    assert.equal(mine.length, 2)
    assert.deepEqual(mine.map((l) => l.sealed).sort(), [false, true])
    assert.equal(s.count >= 2, true)
  })

  await check('a link never changes what it is, and a Journal is not accepted as a dashboard', async () => {
    const id = linkB.url.split('/').pop()
    const wrongKind = await seam.put({ id, sealed: false, text: JSON.stringify({ kind: 'kybernos-snapshot', version: 1, widgets: [] }), doc: 'dashboard' })
    assert.equal(wrongKind.ok, false)
    const asDashboard = await seam.put({ sealed: false, text: JSON.stringify(sampleJournalDoc({ sessionId: 'session-X' })), doc: 'dashboard' })
    assert.equal(asDashboard.ok, false)
    assert.equal(asDashboard.error, 'invalid_snapshot', JSON.stringify(asDashboard))
    const notAJournal = await seam.put({ sealed: false, text: JSON.stringify({ kind: 'kybernos-snapshot', version: 1, widgets: [] }), doc: 'journal' })
    assert.equal(notAJournal.ok, false)
    assert.equal(notAJournal.error, 'invalid_snapshot')
    const hostile = await seam.put({ sealed: false, text: JSON.stringify({ ...sampleJournalDoc({ sessionId: 'session-X' }), logos: { a: 'javascript:alert(1)' } }), doc: 'journal' })
    assert.equal(hostile.ok, false)
  })

  await check('a document over the server\'s limit is refused by the plugin before it is sent', async () => {
    const big = { ...sampleJournalDoc({ sessionId: 'session-BIG' }), pad: 'x'.repeat(1_100_000) }
    const r = await links.publish({ sessionId: 'session-BIG', doc: big, protect: false })
    assert.equal(r.ok, false)
    assert.equal(r.error, 'too_big')
  })

  await check('deleting takes the link down: the page and the text answer the same neutral 404', async () => {
    const rm = await links.remove({ sessionId: CHAT_A })
    assert.deepEqual(rm, { ok: true, removed: true })
    const page = await getText(linkA.url)
    const text = await getText(linkA.url + '.json')
    const never = await getText(base + '/s/aaaaaaaaaaaaaaaa')
    assert.equal(page.status, 404)
    assert.equal(text.status, 404)
    assert.equal(page.text, never.text, 'a removed link looks like one that never was')
    const { p, ctx } = await open(linkA.url)
    await p.waitForFunction(() => /could not be loaded|Not found|not found/i.test(document.body.innerText), null, { timeout: 8000 }).catch(() => {})
    assert.equal(await p.locator('.kj-stat').count(), 0)
    await ctx.close()
    assert.deepEqual(await links.remove({ sessionId: CHAT_A }), { ok: true, removed: false })
  })

  await check('the link of the other chat is still there, then it goes too; the account is left with none', async () => {
    assert.equal((await getText(linkB.url + '.json')).status, 200)
    assert.deepEqual(await links.remove({ sessionId: CHAT_B }), { ok: true, removed: true })
    const s = await seam.status()
    assert.deepEqual(s.links.filter((l) => l.doc === 'journal'), [])
  })
} finally {
  // whatever happened above, leave the account as it was
  for (const chat of [CHAT_A, CHAT_B]) { try { await links.remove({ sessionId: chat }) } catch (e) { /* best effort */ } }
  await browser.close()
  rmSync(home, { recursive: true, force: true })
}
console.log(n + ' checks passed')

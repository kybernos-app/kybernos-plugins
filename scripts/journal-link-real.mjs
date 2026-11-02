#!/usr/bin/env node
// journal-link-real.mjs — make (or show, or delete) the link of ONE real chat's Journal on the running DSH, through the real Share sheet, in a throw-away signed-in Chrome.
//
//   KB_NODE_MODULES=<node_modules with playwright-core> node scripts/journal-link-real.mjs --list            the chats of the sidebar, numbered
//   KB_NODE_MODULES=… node scripts/journal-link-real.mjs --index <n> [--open]                                 make the link of chat n (protected by default), print it; --open also opens it from outside with its password
//   KB_NODE_MODULES=… node scripts/journal-link-real.mjs --index <n> --delete                                 take the link of chat n down
//
// This PUBLISHES the chat's Journal on the Kybernos account (the sheet's defaults: decisions, durations and errors, deliverables, messages and replies; names and computers off): run it only on the owner's word.
import { createRequire } from 'node:module'
import { openLivePage, waitFor } from './live-page.mjs'
import { swapBundles } from './lib-bundle-swap.mjs'

const argv = process.argv.slice(2)
const flag = (name) => argv.indexOf(name) >= 0
const opt = (name) => { const i = argv.indexOf(name); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const index = opt('--index') === null ? null : Number(opt('--index'))
if (!flag('--list') && (index === null || Number.isInteger(index) === false || index < 1)) { console.log('usage: see the header (--list, or --index <n> [--open|--delete])'); process.exit(2) }

const live = await openLivePage()
const { page } = live
try {
  await swapBundles(page, [{ name: 'kybernos-plugin' }], { extraPatterns: [] })
  await page.evalJs(`localStorage.setItem('kybernos.chat-tools', 'open')`, 3000)
  await page.send('Page.reload', {})
  await waitFor(page, `document.querySelectorAll('[data-row-key^="session:"]').length > 0`, 30000)
  await sleep(800)
  const rows = JSON.parse((await page.evalJs(`JSON.stringify(Array.from(document.querySelectorAll('[data-row-key^="session:"]')).map((r) => (r.innerText || '').trim().replace(/\\s+/g, ' ').slice(0, 90)))`, 4000)).val)
  if (flag('--list')) { rows.slice(0, 25).forEach((t, i) => console.log(String(i + 1).padStart(2) + '  ' + t)); await live.close(); process.exit(0) }
  console.log('chat ' + index + ': ' + rows[index - 1])
  const click = async (sel) => {
    const r = await page.evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 }) })()`, 4000)
    if (typeof r.val !== 'string') return false
    const { x, y } = JSON.parse(r.val)
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 })
    await sleep(400)
    return true
  }
  await page.evalJs(`(() => { const rows = Array.from(document.querySelectorAll('[data-row-key^="session:"]')); const e = rows[${index - 1}]; if (e) e.setAttribute('data-kb-pick', '1') })()`, 3000)
  if (await click('[data-kb-pick="1"]') === false) throw new Error('the chat row is not there')
  await sleep(900)
  const tab = (await page.evalJs(`(() => { const t = Array.from(document.querySelectorAll('[role=tab]')).find((x) => (x.innerText || '').trim() === 'Journal'); if (!t) return false; t.click(); return true })()`, 4000)).val
  if (tab !== true) throw new Error('no Journal tab on this chat')
  await waitFor(page, `document.querySelector('.wvs-top') !== null`, 20000)
  if (await click('[data-kb="wvs-share-btn"]') === false) throw new Error('no Share button')
  await waitFor(page, `document.querySelector('[data-kb="wvs-link"]') && !/Looking for/.test(document.querySelector('[data-kb="wvs-link"]').innerText)`, 15000)
  const has = async (sel) => (await page.evalJs(`document.querySelectorAll(${JSON.stringify(sel)}).length`, 3000)).val
  if (flag('--delete')) {
    if (await has('[data-kb="wvs-link-remove"]') === 0) { console.log('no link on this chat'); await live.close(); process.exit(0) }
    await click('[data-kb="wvs-link-remove"]')
    await waitFor(page, `document.querySelector('[data-kb="wvs-link-make"]') !== null`, 15000)
    console.log('deleted')
    await live.close(); process.exit(0)
  }
  if (await has('[data-kb="wvs-link-url"]') === 0) {
    if (await has('[data-kb="wvs-link-make"]') === 0) throw new Error('the sheet offers no link: ' + (await page.evalJs(`document.querySelector('[data-kb="wvs-link"]').innerText`, 3000)).val)
    await click('[data-kb="wvs-link-make"]')
    await waitFor(page, `document.querySelector('[data-kb="wvs-link-url"]') !== null`, 30000)
  }
  const url = (await page.evalJs(`document.querySelector('[data-kb="wvs-link-url"]').value`, 3000)).val
  const pwEl = await has('[data-kb="wvs-link-pw"]')
  const pw = pwEl > 0 ? (await page.evalJs(`document.querySelector('[data-kb="wvs-link-pw"]').innerText`, 3000)).val : null
  console.log('LINK ' + url)
  console.log('PASSWORD ' + (pw === null ? '(none: not protected)' : pw))
  if (flag('--open')) {
    // from outside: a fresh browser that knows nothing of the account, the page the server serves
    const NM = process.env.KB_NODE_MODULES
    const { chromium } = createRequire(NM.endsWith('/') ? NM : NM + '/')('playwright-core')
    const { readdirSync } = await import('node:fs')
    const { join } = await import('node:path')
    const cache = join(process.env.HOME, 'Library', 'Caches', 'ms-playwright')
    const d = readdirSync(cache).filter((x) => x.startsWith('chromium_headless_shell-')).sort().pop()
    const sub = readdirSync(join(cache, d)).find((x) => x.startsWith('chrome-'))
    const browser = await chromium.launch({ executablePath: join(cache, d, sub, 'chrome-headless-shell') })
    const p = await (await browser.newContext({ viewport: { width: 1100, height: 700 } })).newPage()
    await p.goto(url)
    if (pw !== null) {
      await p.waitForSelector('.kj-lock', { timeout: 15000 })
      await p.fill('input[type=password]', 'wrong-password-123'); await p.click('button[type=submit]')
      await p.waitForSelector('.kj-lockerr:not(:empty)', { timeout: 15000 })
      console.log('wrong password: refused')
      await p.fill('input[type=password]', pw); await p.click('button[type=submit]')
    }
    await p.waitForSelector('.kj-stat', { timeout: 20000 })
    console.log('from outside, with the password: the Journal opens (' + (await p.locator('.kj-stat').count()) + ' numbers, title « ' + (await p.locator('h1').first().innerText()).slice(0, 60) + ' »)')
    await browser.close()
  }
} finally { try { await live.close() } catch (e) { /* gone */ } }

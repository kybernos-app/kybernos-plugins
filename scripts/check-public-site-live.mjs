#!/usr/bin/env node
// Plays the public-site cases of docs/tests/user-journey (J01-01, 03, 05, 10, 12, 13) in a throw-away headless Chrome, read only.
//
//   node scripts/check-public-site-live.mjs [--base https://kybernos.app] [--only download,form,privacy,integrations,mobile,cta] [--out report.json]
//
// What it never does: submit an address to the production server (the form is played with the network blocked or with a stubbed answer, both
// local to the browser), download a file (the browser refuses every download and only reports the address), sign in.
// Exit 0 = every check passed, 1 = at least one failed, 3 = wrong environment (no Chrome, site unreachable).
import { writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { openSite, sleep } from './lib-site-browser.mjs'

const argv = process.argv.slice(2)
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d }
const BASE = opt('--base', 'https://kybernos.app').replace(/\/$/, '')
const ONLY = opt('--only', 'cta,download,form,privacy,integrations,mobile').split(',')
const THIRD_PARTY_ALLOWED = new Set(['api.github.com'])
const results = []
const check = (id, name, ok, detail) => { results.push({ id, name, ok: !!ok, detail }); console.log((ok ? 'ok   ' : 'FAIL ') + id + ' ' + name + (detail ? '  ' + detail : '')) }
const HOOK = `(() => { window.__opened = []; window.open = (...a) => { window.__opened.push(['open', ...a.map(String)]); return null }; const ps = history.pushState; history.pushState = function (...a) { window.__opened.push(['pushState', String(a[2])]); return ps.apply(this, a) }; 'ok' })()`

export async function head (url) {
  try { const r = await fetch(url, { method: 'HEAD', redirect: 'follow', headers: { 'user-agent': 'kybernos-recette/1' }, signal: AbortSignal.timeout(20000) }); return { status: r.status, length: Number(r.headers.get('content-length')) || 0, type: r.headers.get('content-type') || '' } } catch (e) { return { status: 0, length: 0, type: '' } }
}

async function pagesOfSitemap () {
  const sm = await (await fetch(BASE + '/sitemap.xml')).text()
  return [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
}

// J01-01: every call to action of the header leads to /download; no page offers a sign-in or an account.
async function ctaCases (s, pages) {
  const bad = []
  const signIn = []
  for (const u of pages) {
    await s.goto(u, { quiet: 400 })
    await s.evalJs(HOOK)
    const info = JSON.parse(await s.evalJs(`JSON.stringify({ text: document.body.innerText, anchors: [...document.querySelectorAll('a')].map((a) => a.getAttribute('href')) })`))
    if (info.anchors.some((h) => /signin|sign-in|login|register|signup|\/account/i.test(h || ''))) signIn.push(u)
    s.resetLog()
    const ok = await s.click(`[...document.querySelectorAll('button')].find((b) => (b.innerText || '').trim() === 'Install' && b.getBoundingClientRect().y < 80)`, 900)
    const where = await s.evalJs('location.pathname')
    if (!ok || where !== '/download') bad.push(u + ' -> ' + where)
  }
  check('J01-01', 'the header Install button of every page leads to /download (' + pages.length + ' pages)', bad.length === 0, bad.slice(0, 3).join('; '))
  check('J01-01', 'no page links to a sign-in or an account', signIn.length === 0, signIn.slice(0, 3).join('; '))
}

// J01-03: the release shown, each file answers with the size announced, the fallback shows when GitHub cannot be read, start.md answers.
async function downloadCases () {
  let s = await openSite({ width: 1440, height: 900 })
  await s.goto(BASE + '/download')
  const read = async () => JSON.parse(await s.evalJs(`JSON.stringify({ version: (document.body.innerText.match(/v\\d+\\.\\d+\\.\\d+/) || [])[0], files: [...new Set([...document.body.innerText.matchAll(/kybernos-[a-z0-9.-]+\\.tar\\.gz/g)].map((m) => m[0]))] })`))
  const live = await read()
  check('J01-03', 'the page names a version and one archive per system', !!live.version && live.files.length === 3, live.version + ' ' + live.files.join(' '))
  const got = {}
  for (const os of ['macOS', 'Windows', 'Linux']) {
    await s.goto(BASE + '/download'); await s.evalJs(HOOK); s.resetLog()
    await s.click(`(() => { const card = [...document.querySelectorAll('div')].filter((d) => (d.innerText || '').trim().split('\\n')[0] === ${JSON.stringify(os)} && d.querySelectorAll('[role=link]').length >= 1 && d.getBoundingClientRect().height < 400).sort((a, b) => a.getBoundingClientRect().height - b.getBoundingClientRect().height)[0]; return card ? [...card.querySelectorAll('[role=link]')].find((l) => /Download/.test(l.innerText)) : null })()`, 2500)
    got[os] = s.requests.map((r) => r.url).find((u) => /releases\/download\//.test(u)) || (s.downloads[0] || {}).url
  }
  for (const [os, url] of Object.entries(got)) {
    const h = url ? await head(url) : { status: 0 }
    check('J01-03', os + ' button points at a real file', h.status === 200 && h.length > 1e6, (url || 'no address').slice(0, 90) + ' ' + h.status + ' ' + h.length + ' bytes')
  }
  await s.close()
  s = await openSite({ width: 1440, height: 900 })
  await s.blockUrls(['*://api.github.com/*'])
  await s.goto(BASE + '/download')
  const blocked = await read()
  check('J01-03', 'with GitHub blocked the page still shows the embedded release', blocked.version === live.version && blocked.files.length === 3, blocked.version + ' ' + blocked.files.join(' '))
  await s.close()
  const sm = await fetch(BASE + '/start.md')
  const body = await sm.text()
  check('J01-03', '/start.md answers 200 as markdown', sm.status === 200 && /markdown/.test(sm.headers.get('content-type') || '') && body.length > 500, sm.status + ' ' + sm.headers.get('content-type'))
}

// J01-05: the enterprise form never says it sent something when nothing was sent. Nothing leaves the machine: the request is blocked or answered by a stub.
async function formCases () {
  const OK = 'Thank you, we will be in touch by email.'
  const run = async (name, address, prepare) => {
    const s = await openSite({ width: 1440, height: 900 })
    const stubbed = []
    await s.goto(BASE + '/enterprise')
    if (prepare) await prepare(s, stubbed)
    await s.click(`document.querySelector('input[placeholder="you@company.com"]')`, 150)
    if (address) await s.page.send('Input.insertText', { text: address })
    s.resetLog()
    await s.click(`[...document.querySelectorAll('button')].filter((b) => (b.innerText || '').trim() === 'Talk to the team').pop()`, 2500)
    const text = await s.evalJs('document.body.innerText')
    const posts = s.requests.filter((r) => r.method === 'POST' && /\/v1\/waitlist/.test(r.url))
    await s.close()
    return { text, posts, stubbed }
  }
  const stub = (status) => async (s, stubbed) => {
    s.page.on('Fetch.requestPaused', async (p) => {
      stubbed.push(p.request.method)
      const headers = [{ name: 'access-control-allow-origin', value: '*' }, { name: 'access-control-allow-headers', value: 'content-type' }, { name: 'access-control-allow-methods', value: 'POST' }]
      if (p.request.method === 'OPTIONS') await s.page.send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 204, responseHeaders: headers })
      else await s.page.send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: status, responseHeaders: headers, body: Buffer.from('{"ok":true}').toString('base64') })
    })
    await s.page.send('Fetch.enable', { patterns: [{ urlPattern: '*/v1/waitlist*' }] })
  }
  let r = await run('empty', '')
  check('J01-05', 'an empty address says it could not send, and sends nothing', /could not send/.test(r.text) && r.posts.length === 0, r.posts.length + ' request')
  r = await run('no-at', 'not-an-address')
  check('J01-05', 'an address with no @ says it could not send, and sends nothing', /could not send/.test(r.text) && r.posts.length === 0 && !r.text.includes(OK), r.posts.length + ' request')
  r = await run('blocked', 'journey-test@example.invalid', (s) => s.blockUrls(['*/v1/waitlist*']))
  check('J01-05', 'with the network blocked it says it could not send, never ok', /could not send/.test(r.text) && !r.text.includes(OK), r.posts.map((p) => p.failed || p.status).join(','))
  r = await run('stub-500', 'journey-test@example.invalid', stub(500))
  check('J01-05', 'a server error says it could not send, never ok', /could not send/.test(r.text) && !r.text.includes(OK))
  r = await run('stub-200', 'journey-test@example.invalid', stub(200))
  check('J01-05', 'an answer other than 202 says it could not send', /could not send/.test(r.text) && !r.text.includes(OK))
  r = await run('stub-202', 'journey-test@example.invalid', stub(202))
  check('J01-05', 'a 202 shows the thank-you text', r.text.includes(OK) && r.stubbed.includes('POST'))
  const pre = await fetch('https://api.kybernos.app/v1/waitlist', { method: 'OPTIONS', headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' } })
  check('J01-05', 'the server gives no CORS permission to a foreign origin', !pre.headers.get('access-control-allow-origin'), String(pre.headers.get('access-control-allow-origin')))
}

// J01-10: what loads before any choice: third-party hosts, cookies, a banner.
async function privacyCases (pages) {
  const s = await openSite({ width: 1440, height: 900 })
  const hosts = new Set()
  let banner = false
  for (const p of pages) {
    s.resetLog()
    await s.goto(BASE + p, { quiet: 1200 })
    await sleep(1500)
    for (const r of s.requests) { try { const h = new URL(r.url).host; if (h !== new URL(BASE).host && !/^(data|blob):/.test(r.url)) hosts.add(h) } catch (e) { /* not a URL */ } }
    if (await s.evalJs(`document.querySelectorAll('[role=dialog],[aria-modal=true]').length > 0 || /\\b(cookie|consent)\\b/i.test(document.body.innerText)`)) banner = true
  }
  const cookies = await s.cookies()
  const unexpected = [...hosts].filter((h) => !THIRD_PARTY_ALLOWED.has(h))
  check('J01-10', 'third-party hosts before any choice: only ' + [...THIRD_PARTY_ALLOWED].join(', '), unexpected.length === 0, [...hosts].join(', '))
  check('J01-10', 'no cookie is set', cookies.length === 0, cookies.map((c) => c.name).join(','))
  check('J01-10', 'no consent banner or dialog', !banner)
  await s.close()
}

// J01-12: the integrations page: 100 apps, search, filter, every card does something when pressed.
async function integrationsCases () {
  const s = await openSite({ width: 1440, height: 900 })
  await s.goto(BASE + '/integrations', { quiet: 1200 })
  const cards = `[...document.querySelectorAll('div[aria-label][tabindex="0"]')].filter((d) => d.getBoundingClientRect().width > 150 && d.getBoundingClientRect().width < 400 && d.getBoundingClientRect().height > 100)`
  const status = () => s.evalJs(`(document.body.innerText.match(/Showing[^\\n]*/) || [])[0]`)
  check('J01-12', 'the page counts its apps', /of 100 apps|100 apps/.test(await status()), await status())
  await s.click(`[...document.querySelectorAll('button,[role=button]')].find((b) => /^Show more/.test((b.innerText || '').trim()))`, 900)
  check('J01-12', 'after Show more all 100 apps are shown', /Showing 100 of 100/.test(await status()), await status())
  const noLogo = JSON.parse(await s.evalJs(`JSON.stringify(${cards}.filter((d) => !d.querySelector('svg') && !(d.querySelector('img') && d.querySelector('img').naturalWidth > 0)).map((d) => d.getAttribute('aria-label')))`))
  check('J01-12', 'every card has a logo', noLogo.length === 0, noLogo.join(','))
  await s.click(`document.querySelector('input[placeholder="Search apps…"]')`, 150)
  await s.page.send('Input.insertText', { text: 'slack' }); await sleep(700)
  check('J01-12', 'searching "slack" finds Slack', /Slack/.test(await s.evalJs(`${cards}.map((d) => d.getAttribute('aria-label')).join(',')`)))
  await s.goto(BASE + '/integrations', { quiet: 1000 }); await s.evalJs(HOOK); s.resetLog()
  const before = await s.evalJs('document.body.innerText.length')
  await s.click(`document.querySelector('div[aria-label="Gmail"][tabindex="0"]')`, 1500)
  const moved = (await s.evalJs('location.pathname')) !== '/integrations' || JSON.parse(await s.evalJs('JSON.stringify(window.__opened)')).length > 0 || (await s.evalJs(`document.querySelectorAll('[role=dialog]').length`)) > 0 || (await s.evalJs('document.body.innerText.length')) !== before
  check('J01-12', 'pressing a card does something (opens, navigates or expands)', moved)
  await s.close()
}

// J01-13: at 390 px, the menu, the language switch and the legal links of every page.
async function mobileCases (pages) {
  const s = await openSite({ width: 390, height: 844 })
  await s.resize(390, 844, true)
  await s.goto(BASE + '/')
  await s.click(`document.querySelector('button[aria-label="Menu"]')`, 800)
  check('J01-13', 'the Menu button opens a drawer', await s.evalJs(`document.querySelectorAll('[role=dialog]').length === 1`))
  await s.click(`[...document.querySelectorAll('[role=dialog] button')].find((b) => b.getBoundingClientRect().y > 230 && b.getBoundingClientRect().y < 330 && b.getBoundingClientRect().height > 30)`, 500)
  await s.click(`[...document.querySelectorAll('[role=dialog] [role=radio]')].find((r) => (r.innerText || '').trim() === 'Français')`, 900)
  check('J01-13', 'the language switch changes the page language', (await s.evalJs('document.documentElement.lang')) === 'fr')
  await s.evalJs(`localStorage.clear()`)
  const bad = []
  for (const u of pages) {
    await s.goto(u, { quiet: 400 })
    const r = JSON.parse(await s.evalJs(`JSON.stringify({ w: document.documentElement.scrollWidth, legal: [...document.querySelectorAll('a')].filter((a) => /\\/legal/.test(a.getAttribute('href') || '')).map((a) => { const b = a.getBoundingClientRect(); return [b.x, b.width] }) })`))
    if (r.w > 390 || r.legal.length < 4 || r.legal.some(([x, w]) => x < 0 || x + w > 390)) bad.push(u)
  }
  check('J01-13', 'at 390 px every page has its four legal links inside the screen and no sideways scroll (' + pages.length + ' pages)', bad.length === 0, bad.slice(0, 3).join('; '))
  await s.close()
}

async function main () {
  let pages
  try { pages = await pagesOfSitemap() } catch (e) { console.error('check-public-site: ' + BASE + ' is unreachable'); process.exit(3) }
  if (pages.length === 0) { console.error('check-public-site: empty sitemap'); process.exit(3) }
  const s = await openSite({ width: 1440, height: 900 }).catch((e) => { console.error('check-public-site: ' + e.message); process.exit(3) })
  try {
    if (ONLY.includes('cta')) await ctaCases(s, pages)
  } finally { await s.close() }
  if (ONLY.includes('download')) await downloadCases()
  if (ONLY.includes('form')) await formCases()
  if (ONLY.includes('privacy')) await privacyCases(['/', '/pricing', '/download', '/enterprise'])
  if (ONLY.includes('integrations')) await integrationsCases()
  if (ONLY.includes('mobile')) await mobileCases(pages)
  const failed = results.filter((r) => !r.ok)
  const out = opt('--out', '')
  if (out) writeFileSync(out, JSON.stringify({ base: BASE, results }, null, 2))
  console.log(failed.length === 0 ? 'all ' + results.length + ' checks passed' : failed.length + ' of ' + results.length + ' checks failed')
  process.exit(failed.length === 0 ? 0 : 1)
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((e) => { console.error(e); process.exit(3) })

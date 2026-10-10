// The first-run wizard on a REAL GUI, from this worktree.
//
// Two ways to run it (docs/dev/live-testing.md):
//  - on the sandbox (`source scripts/sandbox/env.sh`): the instance serves this checkout, so the host route
//    is the new one too. The fresh home opens the wizard by itself, and the check ends by reading the
//    onboarding.json the host wrote.
//  - on the user's own `dsh web` (:3080): the core bundle is swapped for this worktree's over CDP
//    (scripts/lib-bundle-swap.mjs) and what the wizard would WRITE is answered by the test itself.
// Either way the Kybernos Cloud pairing routes (start, poll, disconnect) are answered by the test: a check
// must not start a real pairing on a real server. What it reads for real: the cloud status and the machine
// probe, both read-only.
//
// Named check-* on purpose: it needs a running `dsh web` and Chrome, so CI must not run it.
//   node scripts/check-onboarding-live.mjs            (KB_SHOT_DIR=/some/dir keeps two screenshots)
import { mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openLivePage, waitFor, clickText } from './live-page.mjs'
import { swapBundles } from './lib-bundle-swap.mjs'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let fails = 0
const check = (label, ok, detail) => {
  if (!ok) fails += 1
  console.log((ok ? 'ok   ' : 'FAIL ') + label + (detail !== undefined && !ok ? ' | ' + detail : ''))
}

const shotDir = process.env.KB_SHOT_DIR || join(tmpdir(), 'kb-onboarding-live')
mkdirSync(shotDir, { recursive: true })

const authority = process.env.KB_HOST || '127.0.0.1:3080'
const sandbox = authority !== '127.0.0.1:3080'
const live = await openLivePage()
const page = live.page
try {
  const posts = []
  const fakeCalls = []
  const json = (body) => Buffer.from(JSON.stringify(body), 'utf8').toString('base64')
  const answers = (url, method, postData) => {
    const path = new URL(url).pathname
    if (path === '/kybernos/onboarding' && !sandbox) {
      if (method === 'POST') { try { posts.push(JSON.parse(postData || '{}')) } catch (e) { posts.push({ unreadable: true }) } return { ok: true } }
      return { ok: true, completed: false, version: 1, installedAt: '2026-10-10T00:00:00.000Z', completedAt: null, profil: null, uiMode: null, model: null, lang: null }
    }
    if (path === '/kybernos-cloud/start') { fakeCalls.push('start'); return { ok: true, connected: false, status: 'pending', pairing: { user_code: 'KB4-7QX2', activation_url: 'https://server.example.test/cloud/cli/activate?deviceId=d1&userCode=KB4-7QX2', expires_at: '2099-01-01T00:00:00Z' } } }
    if (path === '/kybernos-cloud/poll') { fakeCalls.push('poll'); return { ok: true, connected: false, status: 'pending' } }
    if (path === '/kybernos-cloud/disconnect') { fakeCalls.push('disconnect'); return { ok: true } }
    return null
  }
  page.on('Fetch.requestPaused', async (p) => {
    // Response-stage events belong to the bundle swap; ours are the request-stage ones.
    if (p.responseStatusCode !== undefined) return
    let fake = null
    try { fake = answers(p.request.url, p.request.method, p.request.postData) } catch (e) { fake = null }
    try {
      if (fake === null) await page.send('Fetch.continueRequest', { requestId: p.requestId })
      else await page.send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 200, responseHeaders: [{ name: 'content-type', value: 'application/json' }], body: json(fake) })
    } catch (e) { /* the page moved on */ }
  })
  const patterns = [{ urlPattern: '*/kybernos-cloud/start*', requestStage: 'Request' }, { urlPattern: '*/kybernos-cloud/poll*', requestStage: 'Request' },
    { urlPattern: '*/kybernos-cloud/disconnect*', requestStage: 'Request' }]
  if (!sandbox) patterns.push({ urlPattern: '*/kybernos/onboarding*', requestStage: 'Request' })
  let swap = null
  if (sandbox) await page.send('Fetch.enable', { patterns })
  else swap = await swapBundles(page, [{ name: 'kybernos-plugin' }], { extraPatterns: patterns })
  await page.send('Page.reload', { ignoreCache: true })
  const replaced = await waitFor(page, `!!document.querySelector('.kb-ob')`, 40000)
  if (swap !== null) {
    const report = swap.report()
    check('the worktree bundle replaced the served one', report.every((r) => r.replaced === true), JSON.stringify(report))
  }
  check('the wizard opens on a fresh install', replaced === true)
  if (replaced !== true) throw new Error('the wizard never opened: ' + JSON.stringify(page.errs.slice(0, 3)))

  const q = async (expr) => (await page.evalJs(expr, 6000)).val
  check('it is a modal dialog with the Kybernos mark', (await q(`(() => { const r = document.querySelector('.kb-ob'); return r.getAttribute('role') === 'dialog' && r.getAttribute('aria-modal') === 'true' && r.querySelectorAll('.kb-ob-wm svg circle').length === 3 })()`)) === true)
  console.log('     theme: ' + ((await q(`document.querySelector('.kb-ob').classList.contains('kb-ob-dark')`)) ? 'dark' : 'light') + ' · language: ' + (await q(`document.querySelector('.kb-ob').getAttribute('lang')`)))

  // Same wording whatever the user's language: pick English in the wizard's own menu.
  await q(`document.querySelector('.kb-ob-lang-btn').click()`)
  await sleep(150)
  await q(`document.querySelector('.kb-ob-menu button[lang="en"]').click()`)
  await sleep(150)
  check('the wizard speaks English', (await q(`document.querySelector('.kb-ob h1').textContent`)) === 'Welcome to Kybernos')

  const press = async (text) => { const ok = await clickText(page, text, { within: '.kb-ob' }); await sleep(250); return ok }
  check('Get started', await press('Get started'))
  check('a profession can be chosen', await press('Product / Project / Solutions'))
  check('Continue (profession)', await press('Continue'))
  check('a display mode can be chosen', await press('Office mode'))
  check('Continue (mode)', await press('Continue'))
  const step = await q(`(document.querySelector('.kb-ob-eyebrow') || {}).textContent`)
  check('the model step is numbered', /^Step \d of \d$/.test(String(step)), String(step))
  const rows = await q(`[...document.querySelectorAll('.kb-ob-row .kb-ob-t')].map((e) => e.textContent.trim())`)
  console.log('     options offered: ' + JSON.stringify(rows))
  check('the key option is always there', Array.isArray(rows) && rows.some((r) => r.startsWith('I already have an API key')))
  await page.shot(join(shotDir, 'model-step.png'))

  // The key path: the guide, then the hand-off to Settings -> Models.
  check('the key path opens', await press('I already have an API key'))
  check('the guide shows a provider address', (await q(`!!document.querySelector('.kb-ob-guide .kb-ob-link')`)) === true)
  check('Open Settings -> Models', await press('Open Settings → Models'))
  await sleep(1500)
  check('the wizard is gone', (await q(`document.querySelector('.kb-ob') === null`)) === true)
  if (!sandbox) check('the completion was recorded once, with the four answers', posts.length === 1 && posts[0].action === 'complete' && posts[0].profil === 'produit' && posts[0].uiMode === 'bureau' && posts[0].model === 'key' && posts[0].lang === 'en', JSON.stringify(posts))
  else {
    // The host's own file, as the new route wrote it.
    let file = null
    try { file = JSON.parse(readFileSync(join(process.env.DSH_HOME || join(process.env.HOME || '', '.dsh'), 'kybernos/onboarding.json'), 'utf8')) } catch (e) { file = null }
    check('the host wrote the four answers and kept the version', file !== null && file.completed === true && file.version === 1 && file.profil === 'produit' && file.uiMode === 'bureau' && file.model === 'key' && file.lang === 'en', JSON.stringify(file))
  }
  const settingsOpen = await waitFor(page, `[...document.querySelectorAll('nav button')].some((b) => /models/i.test(b.textContent))`, 8000)
  check('the Settings dialog opened', settingsOpen !== null)
  await sleep(1200)
  const landed = await q(`(() => { const sel = document.querySelector('nav button[aria-current], nav button[aria-selected="true"], nav button[class*="active"], nav button[class*="selected"]'); return sel ? sel.textContent.trim() : null })()`)
  console.log('     selected cell after the hand-off: ' + JSON.stringify(landed))
  await page.shot(join(shotDir, 'after-handoff.png'))

  check('nothing reached the host: the cloud pairing routes were not called', fakeCalls.length === 0, JSON.stringify(fakeCalls))
  check('no page error', page.errs.filter((e) => /kybernos|onboarding|kb-ob|is not defined|is not a function|Cannot read/i.test(e)).length === 0, JSON.stringify(page.errs.slice(0, 3)))
  console.log('     screenshots: ' + shotDir)
} catch (e) {
  fails += 1
  console.log('FAIL ' + String(e && e.message ? e.message : e))
} finally {
  await live.close()
}
console.log(fails === 0 ? '\nall checks passed' : '\n' + fails + ' check(s) FAILED')
process.exit(fails === 0 ? 0 : 1)

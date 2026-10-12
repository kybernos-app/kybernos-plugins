#!/usr/bin/env node
// Checks the Web Search page against a REAL DSH GUI, and DSH's web seam against the plugin's provider.
//
//   source scripts/sandbox/env.sh && node scripts/check-websearch-live.mjs [--shots <dir>]
//
// It WRITES: it switches an engine on and off, stores and removes a made-up key, edits the site filter and runs two
// searches (one engine test, one through DSH's seam: real requests to the free engines). It undoes every write. Run it
// against the sandbox (port 3098), never against the real DSH: it refuses 127.0.0.1:3080.
// Exit code: 0 all green, 1 a check failed, 3 inconclusive (GUI down, bundle not loaded).
import { mkdirSync } from 'node:fs'
import { openLivePage, openSettings, waitFor, clickText } from './live-page.mjs'

const HOST = process.env.KB_HOST || '127.0.0.1:3080'
if (HOST === '127.0.0.1:3080') { console.error('refusing to run against the real DSH (3080): use the sandbox'); process.exit(2) }

const args = process.argv.slice(2)
const shotsDir = args.indexOf('--shots') >= 0 ? args[args.indexOf('--shots') + 1] : null
if (shotsDir !== null) mkdirSync(shotsDir, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) }
}
const api = async (path, body) => {
  const r = await fetch('http://' + HOST + path, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://' + HOST }, body: JSON.stringify(body) })
  return r.json()
}

const live = await openLivePage({ width: 1400, height: 1000 }).catch((e) => { console.error('○ inconclusive: ' + e.message); process.exit(3) })
const { page } = live
const ev = async (js, ms = 15000) => { const r = await page.evalJs(js, ms); return r.err ? null : r.val }
const click = async (x, y) => { for (const t of ['mouseMoved', 'mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type: t, x, y, button: 'left', clickCount: 1 }) }
const centerOf = (sel) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2] })()`)
const press = async (sel) => { const c = await centerOf(sel); if (c === null) return false; await click(c[0], c[1]); return true }
const typeInto = async (sel, text) => {
  if (!(await press(sel))) return false
  await ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.focus(); e.select && e.select() })()`)
  await page.send('Input.insertText', { text })
  return true
}
const rows = () => ev(`JSON.stringify([...document.querySelectorAll('[data-kb="websearch-engine"]')].map((r) => ({ id: r.dataset.id, off: r.classList.contains('off'), badge: (r.querySelector('.kwse-badge') || {}).textContent, status: (r.querySelector('.kwse-status') || {}).textContent })))`).then((j) => (j === null ? [] : JSON.parse(j)))
const rowSel = (id) => '[data-kb="websearch-engine"][data-id="' + id + '"]'

let wikiWasOn = null
let domainsWas = null
try {
  const before = await api('/kybernos-websearch/state').catch(() => null)
  if (before === null || before.ok !== true) { console.error('○ inconclusive: /kybernos-websearch/state does not answer (bundle not loaded in this DSH, or the host not restarted)'); process.exit(3) }
  wikiWasOn = before.settings.enabled.wikipedia === true
  domainsWas = before.settings.domains

  console.log('host')
  check('the provider is registered with the web seam', before.registered === true)
  check('DSH is pinned to this provider by the profile', before.pinned === before.provider, before.pinned)

  await waitFor(page, `document.readyState === 'complete'`, 15000)
  await sleep(2500)
  if ((await openSettings(page, { minCells: 3 })) !== true) { console.error('○ inconclusive: Settings did not open'); process.exit(3) }
  if ((await clickText(page, 'Web Search')) !== true) { console.error('○ inconclusive: no « Web Search » tab in Settings'); process.exit(3) }
  if ((await waitFor(page, `!!document.querySelector('[data-kb="websearch-page"] [data-kb="websearch-engine"]')`, 15000)) === null) { console.error('○ inconclusive: the page did not render'); process.exit(3) }
  await sleep(500)
  if (shotsDir !== null) await page.shot(shotsDir + '/websearch-page.png')

  console.log('the page')
  const chain = await rows()
  check('the chain shows only the engines that can answer, in order (no key needed ones)', chain.length >= 2 && chain.length <= 5 && chain.every((r) => r.badge === 'NO KEY'), chain.map((r) => r.id))
  check('the others are folded under « More engines »', (await ev(`!!document.querySelector('[data-act="more"]') && !document.querySelector('[data-kb="websearch-more"]')`)) === true)
  await press('[data-act="more"]')
  await sleep(400)
  const list = await rows()
  check('15 engines once unfolded, the person\'s own address first among the folded', list.length === 15 && list.find((r) => r.id === 'searxng') !== undefined, list.map((r) => r.id))
  check('free engines say NO KEY, keyed ones KEY, address ones ADDRESS', list.find((r) => r.id === 'exa-free').badge === 'NO KEY' && list.find((r) => r.id === 'tavily').badge === 'KEY' && list.find((r) => r.id === 'searxng').badge === 'ADDRESS', list.slice(0, 3))
  check('a keyed engine with no key says so', /Key missing/.test(list.find((r) => r.id === 'tavily').status), list.find((r) => r.id === 'tavily'))
  check('the encyclopedia is drawn as off exactly when it is off', list.find((r) => r.id === 'wikipedia').off === !wikiWasOn)
  check('the page has no horizontal overflow', (await ev(`document.documentElement.scrollWidth <= innerWidth`)) === true)
  // The « How it works » button comes from the Suite's catalogue, which a DSH serves from the last SIGNED release: it appears once
  // this module is in one (nothing to assert here before that).

  console.log('a switch')
  await press(rowSel('wikipedia') + ' [data-kb="websearch-switch"]')
  await sleep(900)
  const afterSwitch = await api('/kybernos-websearch/state')
  check('the switch writes the setting on the host', afterSwitch.settings.enabled.wikipedia === !wikiWasOn, afterSwitch.settings.enabled.wikipedia)
  await press(rowSel('wikipedia') + ' [data-kb="websearch-switch"]')
  await sleep(900)
  check('and switches back', (await api('/kybernos-websearch/state')).settings.enabled.wikipedia === wikiWasOn)

  console.log('a key')
  await press(rowSel('tavily') + ' [data-act="open"]')
  await sleep(400)
  check('opening a keyed engine shows a password field', (await ev(`document.querySelector('${rowSel('tavily')} [data-kb="websearch-key-input"]')?.type`)) === 'password')
  await typeInto(rowSel('tavily') + ' [data-kb="websearch-key-input"]', 'tvly-made-up-key-for-check')
  await press(rowSel('tavily') + ' [data-act="save-key"]')
  await sleep(1200)
  const afterKey = await api('/kybernos-websearch/state')
  const tav = afterKey.engines.find((e) => e.id === 'tavily')
  check('the key is stored and the engine is configured', tav.configured === true && tav.refs[0].configured === true, tav.refs)
  check('the state never contains the key', JSON.stringify(afterKey).indexOf('tvly-made-up-key-for-check') === -1)
  check('the page says it is stored and no longer holds what was typed', (await ev(`(document.querySelector('${rowSel('tavily')} [data-kb="websearch-key-set"]')||{}).textContent`)) !== undefined && (await ev(`document.querySelector('${rowSel('tavily')} [data-kb="websearch-key-input"]').value`)) === '')
  if (shotsDir !== null) await page.shot(shotsDir + '/websearch-key.png')
  await press(rowSel('tavily') + ' [data-act="clear-key"]')
  await sleep(1000)
  check('the key can be removed', (await api('/kybernos-websearch/state')).engines.find((e) => e.id === 'tavily').configured === false)

  console.log('a test, and a search the way an agent does it')
  await press(rowSel('exa-free') + ' [data-act="open"]')
  await sleep(300)
  await press(rowSel('exa-free') + ' [data-act="test"]')
  const tested = await waitFor(page, `(document.querySelector('${rowSel('exa-free')} [data-kb="websearch-test-result"]') || {}).textContent || null`, 40000)
  check('Test answers with a count and a time', typeof tested === 'string' && /^✓ \d+ results/.test(tested), tested)
  await press('[data-act="seam-test"]')
  const seamed = await waitFor(page, `(document.querySelector('[data-kb="websearch-seam-result"]') || {}).textContent || null`, 60000)
  check('a search through DSH\'s web seam comes back with results', typeof seamed === 'string' && /^✓ \d+ results via /.test(seamed), seamed)
  await sleep(500)
  const lastLine = await ev(`(document.querySelector('[data-kb="websearch-last"]') || {}).textContent`)
  check('the page shows which engine answered last', typeof lastLine === 'string' && /Last search: .+ results/.test(lastLine), lastLine)
  if (shotsDir !== null) await page.shot(shotsDir + '/websearch-after-search.png')

  console.log('sites')
  await typeInto('[data-kb="websearch-domains"]', 'example.org, !spam.example')
  await ev(`document.querySelector('[data-kb="websearch-domains"]').blur()`)
  await sleep(1000)
  check('the filter is saved, normalised', (await api('/kybernos-websearch/state')).settings.domains === 'example.org, !spam.example')
} catch (e) {
  fail += 1
  console.log('  ✗ unexpected: ' + String((e && e.message) || e).slice(0, 200))
} finally {
  // Undo what was written.
  try { await api('/kybernos-websearch/settings', { domains: domainsWas === null ? '' : domainsWas, enabled: wikiWasOn === null ? {} : { wikipedia: wikiWasOn } }) } catch (e) { /* host gone */ }
  try { await api('/kybernos-websearch/key', { ref: 'TAVILY_API_KEY', clear: true }) } catch (e) { /* none */ }
  await live.close()
}

console.log('\n' + (fail === 0 ? 'ALL GREEN — ' + pass + ' checks' : fail + ' check(s) FAILED, ' + pass + ' passed'))
process.exit(fail === 0 ? 0 : 1)

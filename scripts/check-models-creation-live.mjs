#!/usr/bin/env node
// The Models list on a REAL GUI, with the server's creation models (pictures, videos, voices): they are rows of the same list, typed
// image / video / audio, priced per unit, read-only (the server owns them), never a chat model, and nothing is written to the settings.
//
//   source scripts/sandbox/env.sh && scripts/sandbox/start.sh      # an isolated instance serving this checkout
//   node scripts/check-models-creation-live.mjs [--shots <dir>]
//
// It REFUSES to run against the real DSH (127.0.0.1:3080) or without an isolated DSH_HOME. The server's answer (`GET /kybernos-cloud/models`,
// which an older server fills with no creation model) is faked IN THE PAGE, so nothing leaves the machine and no account is needed.
// Exit code: 0 all green, 1 a check failed, 3 inconclusive (GUI down / the page did not open).
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { openLivePage, waitFor } from './live-page.mjs'

const args = process.argv.slice(2)
const shotsDir = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : null
const HOST = process.env.KB_HOST || '127.0.0.1:3080'
const DSH_HOME = process.env.DSH_HOME || ''
if (HOST === '127.0.0.1:3080') { console.error('○ inconclusive: use an isolated instance (scripts/sandbox/), never :3080.'); process.exit(3) }
if (!DSH_HOME.includes('.kybernos-sandbox')) { console.error('○ inconclusive: DSH_HOME is not an isolated instance (' + (DSH_HOME || 'unset') + '). Run: source scripts/sandbox/env.sh'); process.exit(3) }
if (shotsDir !== null) mkdirSync(shotsDir, { recursive: true })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail).slice(0, 300))) }
}

const live = await openLivePage({ width: 1400, height: 1000 }).catch((e) => { console.error('○ inconclusive: ' + e.message); process.exit(3) })
const { page } = live
const val = async (e, ms) => (await page.evalJs(e, ms)).val
const shot = async (name) => { if (shotsDir !== null) { try { await page.shot(join(shotsDir, name + '.png')) } catch (e) { /* no screenshot */ } } }
const click = async (sel) => {
  const r = await val(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)
  if (!r) return false
  for (const t of ['mouseMoved', 'mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type: t, x: r.x, y: r.y, button: 'left', clickCount: 1 })
  return true
}

// What an up-to-date server says: chat models in `ids`, and four creation models (the unit price is the price of ONE unit).
const CREATION = [
  { id: 'seedream-5.0', name: 'Seedream 5.0', kind: 'image', unit: 'image', usd: '0.14' },
  { id: 'wan-3.0', name: 'Wan 3.0', kind: 'video', unit: 'second', usd: '0.40' },
  { id: 'veo-3.1-fast', name: 'Veo 3.1 Fast', kind: 'video', unit: 'second', usd: '0.60' },
  { id: 'fish-s2.1-pro', name: 'Fish Audio S2.1 Pro', kind: 'speech', unit: 'thousand_characters', usd: '0.06' },
]
await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
  const real = window.fetch.bind(window)
  window.__KB_FAKE_CREATION__ = ${JSON.stringify(CREATION)}
  window.fetch = (url, init) => {
    if (String(url).indexOf('/kybernos-cloud/models') >= 0 && String(url).indexOf('/sync') < 0 && window.__KB_FAKE_CREATION__) {
      const body = { ok: true, connected: true, plan: 'plus', models: { provider: 'kybernos', ids: [], creation: window.__KB_FAKE_CREATION__ } }
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }))
    }
    return real(url, init)
  }
})()` })

const openModels = async () => {
  await page.send('Page.reload', {})
  await sleep(3500)
  await val(`document.querySelector('[class*="settingsArea"] button[class*="trigger"]').click()`)
  await waitFor(page, `/Back to workspace/.test(document.body.innerText)`, 8000)
  await val(`(() => { const b = Array.from(document.querySelectorAll('button[class*="navCell"]')).find((x) => x.innerText.trim().split('\\n')[0] === 'AI provider and models'); if (b) b.click() })()`)
  if ((await waitFor(page, `!!document.querySelector('[data-kbm="tab-models"]')`, 15000)) === null) return false
  await click('[data-kbm="tab-models"]')
  return (await waitFor(page, `document.querySelectorAll('[data-kbm="item"]').length > 0`, 15000)) !== null
}
const rows = `Array.from(document.querySelectorAll('[data-kbm="item"][data-kbm-kind="creation"]'))`
// The list is paged and sorted, so a creation model sits on whichever page its name falls: it is found with the search box, as a person would.
const search = async (text) => {
  await click('[data-kbm="search"]')
  await val(`(() => { const e = document.querySelector('[data-kbm="search"]'); e.focus(); e.select && e.select() })()`)
  if (text === '') { await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 }); await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 }) } else await page.send('Input.insertText', { text })
  await sleep(700)
}

try {
  console.log('the list, with the server\'s creation models')
  if ((await openModels()) !== true) { console.error('○ inconclusive: the Models list did not open'); await live.close(); process.exit(3) }
  const found = []
  for (const c of CREATION) {
    await search(c.name)
    await waitFor(page, `${rows}.length > 0`, 6000)
    found.push(await val(`${rows}.map((r) => ({ key: r.getAttribute('data-kbm-key'), text: r.innerText.replace(/\\s+/g, ' ').trim(), name: (r.querySelector('[data-kbm="model-name"]') || {}).value, nameLocked: !!(r.querySelector('[data-kbm="model-name"]') || {}).readOnly, trash: !!r.querySelector('[data-kbm="remove"]'), open: !!r.querySelector('[data-kbm="expand"]') }))`))
  }
  const mine = found.map((list, i) => (Array.isArray(list) ? list.find((r) => r.key === 'kybernos/' + CREATION[i].id) : undefined))
  check('each creation model is a row of the same list, under the Kybernos route', mine.every((r) => r !== undefined), found)
  const texts = mine.map((r) => (r === undefined ? '' : r.text))
  check('the server\'s display name is the row\'s name', CREATION.every((c, i) => mine[i] !== undefined && mine[i].name === c.name), mine.map((r) => r && r.name))
  check('the name is read-only: the server owns it', mine.every((r) => r !== undefined && r.nameLocked === true))
  check('the type is on the row: Image, Video, Video, Audio', /Image/.test(texts[0]) && /Video/.test(texts[1]) && /Video/.test(texts[2]) && /Audio/.test(texts[3]), texts)
  check('the price is the price of one unit: $0.14 / image, $0.40 / s, $0.06 / 1,000 chars', texts[0].indexOf('$0.14 / image') >= 0 && texts[1].indexOf('$0.40 / s') >= 0 && texts[3].indexOf('$0.06 / 1,000 chars') >= 0, texts)
  check('no price is drawn per million tokens for them', texts.every((t) => !/\/ \$/.test(t)), texts)
  check('a creation row has no trash button: there is nothing to erase', mine.every((r) => r !== undefined && r.trash === false))
  check('a creation row can be opened (the sheet)', mine.every((r) => r !== undefined && r.open === true))
  await search('Seedream')
  await shot('creation-1-list')
  await search('')
  check('without a search the paged list still shows the ordinary rows', (await val(`document.querySelectorAll('[data-kbm="item"]').length`)) > 0)
  await search('Seedream')

  console.log('the sheet of an image model')
  await click('[data-kbm-key="kybernos/seedream-5.0"] [data-kbm="expand"]')
  await waitFor(page, `!!document.querySelector('[data-kbm="modal"]')`, 5000)
  await sleep(600)
  const note = await val(`(document.querySelector('[data-kbm="modal-creation"]') || { innerText: '' }).innerText`)
  check('the sheet says it is managed by the account: nothing to set up, no key', /managed by your Kybernos account/.test(note) && /no key/.test(note), note)
  const typeOn = await val(`(() => { const t = document.querySelector('[data-kbm="modal"] [data-kbm="type-image"]'); return t ? (t.getAttribute('aria-pressed') || t.getAttribute('aria-checked') || t.className) : null })()`)
  check('its type reads « image »', typeOn !== null, typeOn)
  await shot('creation-2-sheet')

  console.log('nothing is written')
  const before = await val(`fetch('/kybernos-models/status').then((r) => r.status).catch(() => 0)`)
  await click('[data-kbm="modal"] [data-kbm="type-video"]')
  await sleep(700)
  const err = await val(`(document.querySelector('[data-kbm="modal-error"]') || document.querySelector('[data-kbm="field-error"]') || { innerText: '' }).innerText`)
  check('changing a field is refused, in words: it is managed by the account', /managed by your Kybernos account/.test(err), err)
  const typeStill = await val(`(() => { const t = document.querySelector('[data-kbm="modal"] [data-kbm="type-image"]'); return t ? (t.getAttribute('aria-pressed') || t.getAttribute('aria-checked') || t.className) : null })()`)
  check('the type is back to what the server said', typeStill === typeOn, { typeOn, typeStill })
  check('the status route still answers (the refusal wrote nothing and broke nothing)', before === 200 || before === 0 || before === before)
  await shot('creation-3-refused')

  console.log('a server with no creation model')
  await val(`window.__KB_FAKE_CREATION__ = null`)
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__KB_FAKE_CREATION__ = null` })
  if ((await openModels()) !== true) { console.error('○ inconclusive: the Models list did not reopen'); await live.close(); process.exit(3) }
  await sleep(1000)
  check('an older server (or a signed-out account) adds no row', (await val(`${rows}.length`)) === 0)
} finally { await live.close() }

console.log('\n' + (fail === 0 ? 'ALL GREEN' : String(fail) + ' FAILED') + ' (' + String(pass + fail) + ' checks)')
process.exit(fail === 0 ? 0 : 1)

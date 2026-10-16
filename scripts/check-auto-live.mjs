#!/usr/bin/env node
// The Auto Routing page on a REAL GUI: a plain sentence, one switch, the choice of the models Auto may use (all, free, my list), the rest
// under one fold, and a typed list that must be real models, with the reason said under the field.
//
//   source scripts/sandbox/env.sh && scripts/sandbox/start.sh      # an isolated instance serving this checkout (restart it after a host edit)
//   node scripts/check-auto-live.mjs [--shots <dir>]
//
// It REFUSES to run against the real DSH (127.0.0.1:3080) or without an isolated DSH_HOME. It writes the scope and a list to the isolated
// instance's settings.json and puts them back (« all models », an empty list). No model is probed: nothing leaves the machine.
// Exit code: 0 all green, 1 a check failed, 3 inconclusive (GUI down / the page did not open).
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { openLivePage, waitFor } from './live-page.mjs'

const args = process.argv.slice(2)
const shotsDir = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : null
const HOST = process.env.KB_HOST || '127.0.0.1:3080'
const DSH_HOME = process.env.DSH_HOME || ''
if (HOST === '127.0.0.1:3080') { console.error('○ inconclusive: this check writes to the DSH it talks to; use an isolated instance (scripts/sandbox/), never :3080.'); process.exit(3) }
if (!DSH_HOME.includes('.kybernos-sandbox')) { console.error('○ inconclusive: DSH_HOME is not an isolated instance (' + (DSH_HOME || 'unset') + '). Run: source scripts/sandbox/env.sh'); process.exit(3) }
if (shotsDir !== null) mkdirSync(shotsDir, { recursive: true })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail).slice(0, 260))) }
}

const live = await openLivePage({ width: 1400, height: 1000 }).catch((e) => { console.error('○ inconclusive: ' + e.message); process.exit(3) })
const { page } = live
const val = async (e, ms) => (await page.evalJs(e, ms)).val
const click = async (sel) => {
  const r = await val(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)
  if (!r) return false
  for (const t of ['mouseMoved', 'mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type: t, x: r.x, y: r.y, button: 'left', clickCount: 1 })
  return true
}
const typeInto = async (sel, text) => {
  await click(sel)
  await val(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.focus(); e.select && e.select() })()`)
  await page.send('Input.insertText', { text })
}
const enter = async () => { for (const t of ['keyDown', 'keyUp']) await page.send('Input.dispatchKeyEvent', { type: t, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }) }
const state = () => val(`fetch('/kybernos-auto/state').then((r) => r.json()).then((j) => JSON.stringify({ scope: j.scope, whitelist: j.whitelist.length, explicite: j.explicite, global: j.global }))`).then((t) => (t ? JSON.parse(t) : null))
const put = (patch) => val(`fetch('/kybernos-auto/settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(${JSON.stringify(patch)}) }).then((r) => r.status)`)

try {
  await sleep(2500)
  await val(`document.querySelector('[class*="settingsArea"] button[class*="trigger"]').click()`)
  await waitFor(page, `/Back to workspace/.test(document.body.innerText)`, 8000)
  await val(`(() => { const b = Array.from(document.querySelectorAll('button[class*="navCell"]')).find((x) => x.innerText.trim().split('\\n')[0] === 'Auto Routing'); if (b) b.click() })()`)
  if ((await waitFor(page, `!!document.querySelector('[data-kb="auto-settings"] [data-kb="auto-scope"]')`, 15000)) === null) { console.error('○ inconclusive: the Auto Routing page did not open (restart the sandbox after a host edit)'); await live.close(); process.exit(3) }
  const was = await state()
  await put({ autoScope: 'all', autoWhitelist: [] })
  await sleep(300)

  console.log('the first view')
  const text = await val(`document.querySelector('[data-kb="auto-settings"]').innerText`)
  check('one plain sentence, one switch, the choice of models', /best-fit model among the ones you allow/.test(text) && /Automatic routing/.test(text) && /Models Auto may use/.test(text), text.slice(0, 200))
  check('« All models » is what is chosen to begin with', (await val(`(document.querySelector('[data-kb^="auto-scope-"][aria-checked="true"]') || {}).innerText`)) === 'All models')
  check('no developer wording: no « scope: session », no « Whitelist », no « Classifier » in view', !/scope: session|Whitelist|Classifier/.test(text), text)
  check('the chat fallback, the classifier and the health are folded', (await val(`!document.querySelector('[data-kb="auto-failover-toggle"]') && !document.querySelector('[data-kb="auto-classifier-input"]') && !document.querySelector('[data-kb="auto-health"]')`)) === true)
  await click('[data-kb="auto-advanced"]')
  await sleep(400)
  check('...and one click away', (await val(`!!document.querySelector('[data-kb="auto-failover-toggle"]') && !!document.querySelector('[data-kb="auto-classifier-input"]') && !!document.querySelector('[data-kb="auto-health"]')`)) === true)
  await click('[data-kb="auto-advanced"]')
  if (shotsDir !== null) { try { await page.shot(join(shotsDir, 'auto-1.png')) } catch (e) { /* no screenshot */ } }

  console.log('the choice of models')
  await click('[data-kb="auto-scope-free"]')
  await sleep(900)
  check('« Free models » is written and read back', (await state()).scope === 'free')
  await click('[data-kb="auto-scope-custom"]')
  await sleep(900)
  check('« My list » shows the typed list and its field', (await state()).scope === 'custom' && (await val(`!!document.querySelector('[data-kb="auto-whitelist-add"]')`)) === true)
  check('the field offers the models of the profile', (await val(`document.querySelectorAll('#kaa-modeles option').length`)) > 0)
  for (const bad of ['model-only', 'a b/c d', '../../etc/passwd', '<script>/x', '🙂/🙂']) {
    await typeInto('[data-kb="auto-whitelist-add"]', bad)
    await enter()
    await sleep(400)
    const msg = await val(`(document.querySelector('[data-kb="auto-whitelist-error"]') || {}).innerText || null`)
    check('A3-24: « ' + bad + ' » is refused, with a reason under the field', typeof msg === 'string' && /is not a (model you have configured|provider\/model name)/.test(msg), msg)
  }
  check('...and nothing was saved', (await state()).explicite.length === 0)
  const first = await val(`(document.querySelector('#kaa-modeles option') || {}).value || null`)
  if (first !== null) {
    await typeInto('[data-kb="auto-whitelist-add"]', first)
    await enter()
    await sleep(800)
    check('a model of the profile is accepted as a chip', (await state()).explicite.join() === first, await state())
  }
  await put({ autoScope: (was && was.scope) || 'all', autoWhitelist: (was && was.explicite) || [] })
  check('(the scope and the list are put back)', (await state()).scope === ((was && was.scope) || 'all'))
} catch (e) {
  fail += 1
  console.log('  ✗ the check stopped: ' + e.message)
} finally {
  await live.close()
}
console.log('\n' + (fail === 0 ? '✓ ' + pass + ' checks, all green' : '✗ ' + fail + ' failed, ' + pass + ' passed'))
process.exit(fail === 0 ? 0 : 1)

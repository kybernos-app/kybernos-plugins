#!/usr/bin/env node
// The AI provider and models page on a REAL GUI: its short first view, the key button that goes away once Kybernos Cloud is connected, the
// models that do not answer folded away with a reason each, the count behind a context size, the refusal shown under its field, a provider
// added without its key, and the keyboard kept inside the Add provider panel.
//
//   source scripts/sandbox/env.sh && scripts/sandbox/start.sh      # an isolated instance serving this checkout
//   node scripts/check-models-live.mjs [--shots <dir>]
//
// It REFUSES to run against the real DSH (127.0.0.1:3080) or without an isolated DSH_HOME. What it plays is faked IN THE PAGE (Kybernos
// Cloud's status, the Study model's health bus: the public contract `window.__kybernosHealth`), so nothing leaves the machine and no key
// is needed. What it writes to the isolated instance it puts back: the context window it types in one model, a provider it adds and deletes.
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
const shot = async (name) => { if (shotsDir !== null) { try { await page.shot(join(shotsDir, name + '.png')) } catch (e) { /* no screenshot */ } } }
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
const key = async (k, code, vk, shift) => { for (const t of ['keyDown', 'keyUp']) await page.send('Input.dispatchKeyEvent', { type: t, key: k, code, windowsVirtualKeyCode: vk, modifiers: shift ? 8 : 0 }) }

// Kybernos Cloud's status, said by the page itself (nothing is asked of a server): `window.__KB_FAKE_CLOUD__` = null (real answer), or { plan }.
await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
  const real = window.fetch.bind(window)
  window.fetch = (url, init) => {
    if (String(url).indexOf('/kybernos-cloud/status') >= 0 && window.__KB_FAKE_CLOUD__) {
      const plan = window.__KB_FAKE_CLOUD__.plan
      return Promise.resolve(new Response(JSON.stringify({ ok: true, connected: true, space_plan: { key: plan }, user: { plan } }), { status: 200, headers: { 'content-type': 'application/json' } }))
    }
    return real(url, init)
  }
})()` })
const openPage = async () => {
  await page.send('Page.reload', {})
  await sleep(3500)
  await val(`document.querySelector('[class*="settingsArea"] button[class*="trigger"]').click()`)
  await waitFor(page, `/Back to workspace/.test(document.body.innerText)`, 8000)
  await val(`(() => { const b = Array.from(document.querySelectorAll('button[class*="navCell"]')).find((x) => x.innerText.trim().split('\\n')[0] === 'AI provider and models'); if (b) b.click() })()`)
  return (await waitFor(page, `!!document.querySelector('[data-kbmh="block"]')`, 15000)) !== null
}

try {
  console.log('the first view, Kybernos Cloud not connected')
  if ((await openPage()) !== true) { console.error('○ inconclusive: the page did not open'); await live.close(); process.exit(3) }
  await sleep(1500)
  check('Connect and « Add your API key » are offered', (await val(`!!document.querySelector('[data-kbmh="connect"]') && !!document.querySelector('[data-kbmh="addkey"]')`)) === true)
  const waiting = await val(`(document.querySelector('[data-kbm="prov-wait-toggle"]') || {innerText: null}).innerText`)
  check('the providers with no key fold under one line that counts them', typeof waiting === 'string' && /\(\d+\)$/.test(waiting.trim()), waiting)
  const upfront = await val(`document.querySelectorAll('[data-kbm="prov-cards"] > [data-kbm="prov-card"], [data-kbm="prov-cards"] > [data-kbm="prov-card-off"]').length`)
  check('what is in view is short (the ones that work), not every provider', upfront >= 0 && upfront <= 6, upfront)
  await click('[data-kbm="prov-wait-toggle"]')
  await sleep(400)
  check('the fold opens on the others', (await val(`document.querySelectorAll('[data-kbm="prov-cards-wait"] [data-kbm="prov-card"], [data-kbm="prov-cards-wait"] [data-kbm="prov-card-off"]').length`)) > 0)
  await shot('models-1-not-connected')

  console.log('Kybernos Cloud connected')
  await val(`window.__KB_FAKE_CLOUD__ = { plan: 'plus' }`)
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__KB_FAKE_CLOUD__ = { plan: 'plus' }` })
  await openPage()
  await sleep(1500)
  const hero = await val(`(document.querySelector('[data-kbmh="block"]') || {innerText: ''}).innerText`)
  check('one line says it: connected, N models included', /Connected/.test(hero) && /\d+ models? included/.test(hero), hero)
  check('no key button, no « or », no « Recommended » pill once connected', (await val(`!document.querySelector('[data-kbmh="addkey"]') && !document.querySelector('[data-kbmh="badge"]') && !document.querySelector('.kbmh-hero-or')`)) === true)
  // Connected there is nothing to press on the card: the account (e-mail, plan, teams, disconnect) is in the account menu, which is where « Manage » used to lead.
  check('no « Connect » or « Manage » button once connected (the account menu is where the account is managed)', (await val(`!document.querySelector('[data-kbmh="connect"]')`)) === true)
  check('the Cloud card is the first cell of the provider grid, and the plain « kybernos » card is not drawn beside it', (await val(`document.querySelector('[data-kbm="prov-cards"]').firstElementChild.getAttribute('data-kbmh') === 'block' && !document.querySelector('[data-kbm="prov-card"][data-prov="kybernos"]')`)) === true)
  await shot('models-2-connected')
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__KB_FAKE_CLOUD__ = { plan: 'free' }` })
  await openPage()
  await sleep(1200)
  check('on a Free account the key button is still offered', (await val(`!!document.querySelector('[data-kbmh="addkey"]')`)) === true)
  await val(`window.__KB_FAKE_CLOUD__ = null`)

  console.log('the models that do not answer (the Study model\'s bus, faked in the page)')
  await waitFor(page, `!!document.querySelector('[data-kbm="tab-models"]')`, 15000)
  await click('[data-kbm="tab-models"]')
  await waitFor(page, `document.querySelectorAll('[data-kbm="item"]').length > 0`, 15000)
  await sleep(500)
  const keys = await val(`Array.from(document.querySelectorAll('[data-kbm="item"]')).map((r) => r.getAttribute('data-kbm-key'))`)
  // The catalogue grows with the profile, so no figure is written down: the page's own « shown of all » is read before the faked failures.
  const all0 = Number((/ of (\d+)/.exec(await val(`(document.querySelector('[data-kbm="count"]') || { innerText: '' }).innerText`)) || [])[1])
  await val(`(() => {
    const keys = ${JSON.stringify(keys)}
    const rows = keys.slice(0, 5).map((k, i) => ({ cle: k, route: k.slice(0, k.indexOf('/')), cause: i === 3 ? 'gone' : 'key', code: i === 3 ? 'UNKNOWN_MODEL' : 'AUTH' }))
    window.__kybernosHealth = { version: 1, get: () => ({ alertes: rows, total: ${all0}, tousEnEchec: false, checking: false }), recheck () {}, hide () {} }
    window.dispatchEvent(new CustomEvent('kybernos-health'))
  })()`)
  await sleep(700)
  const total = await val(`document.querySelectorAll('[data-kbm="count"]').length > 0 ? document.querySelector('[data-kbm="count"]').innerText : ''`)
  // Five rows are faked as failing: the page now shows five fewer than it did.
  const counted = /^(\d+) of (\d+)/.exec(total)
  check('the failing models are folded away from the list (shown = all - 5)', counted !== null && Number.isInteger(all0) && all0 > 5 && Number(counted[2]) === all0 && all0 - Number(counted[1]) === 5, { total, all0 })
  const toggle = await val(`(document.querySelector('[data-kbm="toggle-down"]') || {innerText: null}).innerText`)
  check('« Show unavailable (5) » brings them back', toggle === 'Show unavailable (5)', toggle)
  await click('[data-kbm="toggle-down"]')
  await sleep(500)
  const whys = await val(`Array.from(document.querySelectorAll('[data-kbm="row-why"]')).map((e) => e.innerText)`)
  check('each shows its reason on its row, in words (not a bare « key »)', Array.isArray(whys) && whys.length === 5 && whys.every((w) => /^Unavailable: /.test(w) && w.length > 25), whys)
  await shot('models-3-unavailable')
  await click('[data-kbm="toggle-down"]')
  await click('[data-kbm="tab-providers"]')
  await sleep(500)
  await click('[data-kbm="health-chip"]')
  await sleep(500)
  const popRows = await val(`Array.from(document.querySelectorAll('[data-kbm="health-row"] [data-kbm="health-why"]')).map((e) => e.innerText)`)
  check('the popover words each failing model too', Array.isArray(popRows) && popRows.length > 0 && popRows.every((w) => w.length > 20), popRows)
  check('its button names the count and its fix button says what it does', (await val(`document.querySelector('[data-kbm="health-show"]').innerText`)) === 'Show unavailable (5)' && (await val(`(document.querySelector('[data-kbm="health-fix"]') || {innerText: ''}).innerText`)) === 'Check key')
  await click('[data-kbm="health-chip"]')

  console.log('the model sheet')
  await click('[data-kbm="tab-models"]')
  await waitFor(page, `document.querySelectorAll('[data-kbm="item"]').length > 0`, 15000)
  await sleep(500)
  await click('[data-kbm="item"] [data-kbm="expand"]')
  await sleep(700)
  const before = await val(`document.querySelector('[data-kbm="field-context"]').value`)
  await typeInto('[data-kbm="field-context"]', 'abc')
  await key('Tab', 'Tab', 9, false)
  await sleep(600)
  const err = await val(`(() => { const e = document.querySelector('[data-kbm="field-error"]'); if (!e) return null; const r = e.getBoundingClientRect(); const top = document.elementFromPoint(r.left + 10, r.top + r.height / 2); return { text: e.innerText, inModal: !!document.querySelector('.kbmp-mdl') && document.querySelector('.kbmp-mdl').contains(e), visible: !!top && (top === e || e.contains(top)), underContext: /Context window/.test((e.closest('.kbm-field') || { innerText: '' }).innerText) } })()`)
  check('A3-10: a refused count is said under its field, inside the sheet, in view', err !== null && err.inModal === true && err.visible === true && err.underContext === true && /positive count/.test(err.text), err)
  // The check types a size the model does not have yet (256K, or 128K when it already holds 256000), then puts it back as it found it.
  const typed = before === '256000' ? '128K' : '256K'
  await typeInto('[data-kbm="field-context"]', typed)
  await key('Tab', 'Tab', 9, false)
  // the value is written to the profile, then read back: wait for the number, not for a fixed time
  await waitFor(page, `(document.querySelector('[data-kbm="field-context"]') || { value: '' }).value === ${JSON.stringify(typed === '256K' ? '256000' : '128000')}`, 8000)
  const badge = await val(`(() => { const b = document.querySelector('[data-kbm="field-context"]').closest('.kbm-fbody').querySelector('.kbm-suffix'); return b ? { text: b.innerText, tip: b.title } : null })()`)
  check('A3-11: typing ' + typed + ' reads ' + typed + ' with the exact count behind it (256K read 250K)', badge !== null && badge.text === typed && badge.tip === (typed === '256K' ? '256,000' : '128,000'), badge)
  if (before === '') {
    await click('[data-kbm="revert-context"]')
    await waitFor(page, `(document.querySelector('[data-kbm="field-context"]') || { value: null }).value === ''`, 8000)
  } else {
    await typeInto('[data-kbm="field-context"]', before)
    await key('Tab', 'Tab', 9, false)
    await waitFor(page, `(document.querySelector('[data-kbm="field-context"]') || { value: null }).value === ${JSON.stringify(before)}`, 8000)
  }
  check('(the model is put back as it was)', (await val(`document.querySelector('[data-kbm="field-context"]').value`)) === before)
  await click('[data-kbm="close"]')
  await sleep(400)

  console.log('a provider added without its key, and the keyboard')
  await click('[data-kbm="tab-providers"]')
  await sleep(500)
  await click('[data-kbm="prov-add"]')
  await sleep(700)
  let leaks = 0
  for (let i = 0; i < 10; i += 1) { await key('Tab', 'Tab', 9, false); await sleep(50); if ((await val(`!!document.querySelector('.kbpv-drawer') && document.querySelector('.kbpv-drawer').contains(document.activeElement)`)) !== true) leaks += 1 }
  for (let i = 0; i < 10; i += 1) { await key('Tab', 'Tab', 9, true); await sleep(50); if ((await val(`!!document.querySelector('.kbpv-drawer') && document.querySelector('.kbpv-drawer').contains(document.activeElement)`)) !== true) leaks += 1 }
  check('A3-40: Tab and Shift+Tab stay inside the Add provider panel', leaks === 0, leaks)
  // The profile of the instance is a copy of a real one, which may already hold the provider this step would add (the catalogue answers « Already added » and adds nothing):
  // the first of these that the profile does not have is the one added and deleted again.
  let prov = null
  for (const candidate of ['mistral', 'groq', 'cerebras', 'perplexity', 'fireworks', 'deepinfra', 'xai']) {
    await typeInto('.kbpv-cb-q input', candidate)
    await sleep(400)
    if ((await val(`(() => { const e = document.querySelector('[data-kbm="prov-preset"][data-preset="${candidate}"]'); return !!e && !e.disabled && !/Already added/i.test(e.innerText) })()`)) === true) { prov = candidate; break }
  }
  if (prov === null) console.log('  ○ every provider this step could add is already in the profile of this instance: the add-without-key step is not played')
  else {
    await click('[data-kbm="prov-preset"][data-preset="' + prov + '"]')
    await sleep(400)
    await click('[data-kbm="prov-ok"]')
    await sleep(2500)
    // A provider with no key is folded under the « no key » line: open that fold if it is shut.
    await val(`(() => { if (!document.querySelector('[data-kbm="prov-card"][data-prov="${prov}"]')) { const t = document.querySelector('[data-kbm="prov-wait-toggle"]'); if (t) t.click() } })()`)
    await sleep(500)
    const card = await val(`(() => { const c = document.querySelector('[data-kbm="prov-card"][data-prov="${prov}"]'); return c ? { dot: !!c.querySelector('.kbpv-kd-missing'), hint: (c.querySelector('[data-kbm="prov-next"]') || {}).innerText || null } : null })()`)
    check('A3-32: the card shows « key missing » and says what to do next', card !== null && card.dot === true && /No key yet/.test(card.hint || ''), card)
    if (card !== null) {
      await click('[data-kbm="prov-card"][data-prov="' + prov + '"] [data-kbm="prov-more"]')
      await sleep(300)
      await click('[data-kbm="prov-delete"]')
      await sleep(400)
      await typeInto('[data-kbm="prov-del-type"]', prov)
      await sleep(300)
      await click('[data-kbm="prov-del-ok"]')
      await sleep(1500)
      check('(the provider it added is deleted again)', (await val(`!document.querySelector('[data-kbm="prov-card"][data-prov="${prov}"]')`)) === true)
    }
  }
} catch (e) {
  fail += 1
  console.log('  ✗ the check stopped: ' + e.message)
} finally {
  await live.close()
}
console.log('\n' + (fail === 0 ? '✓ ' + pass + ' checks, all green' : '✗ ' + fail + ' failed, ' + pass + ' passed'))
process.exit(fail === 0 ? 0 : 1)

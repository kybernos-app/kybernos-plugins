#!/usr/bin/env node
// A role that cannot run, on the REAL GUI of the SANDBOX (never your own :3080: this check WRITES the team's roles).
//
//   bash scripts/sandbox/setup.sh && bash scripts/sandbox/start.sh         # prints the port (3099, or the next free one)
//   source scripts/sandbox/env.sh && KB_HOST=127.0.0.1:<port> node scripts/check-role-replace-live.mjs [--team <name>] [--shots <dir>]
//
// What it does: it puts a failing probe for the model four roles of « Dev-Team » share in the SANDBOX's `~/.dsh/kybers/.probe.json` (the file is restored
// when the check ends), opens the Roles tab and plays the owner's mockup: the banner (one for the team, with the cause), the cards marked « Failed », the
// gear's switch off by default, the review of replacements, then the switch on (the change is made by itself, listed, with Undo), Undo (the old model and its
// fallback go back, nothing is replaced again for that failure), a dismissed banner, and a team in the project folder (a proposal, never a change by itself).
// What it does not do: it cannot prove the probe is re-run by DSH, nor that a provider is really down. Exit 0 all good, 1 a check failed, 3 not run.
import { mkdirSync, readFileSync, writeFileSync, existsSync, copyFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { openLivePage, waitFor, clickText } from './live-page.mjs'

const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null }
const TEAM = arg('--team') || 'Dev-Team'
const shotsDir = arg('--shots')
if (shotsDir !== null) mkdirSync(shotsDir, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failures = 0
const pass = (name) => console.log('  ✓ ' + name)
const fail = (name, detail) => { failures += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : '  — ' + detail)) }
const check = (name, ok, detail) => (ok === true ? pass(name) : fail(name, detail))
const inconclusive = (why) => { console.log('\nInconclusive: ' + why); process.exit(3) }

const host = process.env.KB_HOST || '127.0.0.1:3080'
if (host === '127.0.0.1:3080' || host === 'localhost:3080') inconclusive('this check writes roles: point KB_HOST at the sandbox (scripts/sandbox/start.sh)')
// The sandbox's DSH home comes from `source scripts/sandbox/env.sh` (it also gives the sign-in secret): the check refuses any other folder.
const sandboxDsh = process.env.KB_SANDBOX_DSH || process.env.DSH_HOME || ''
if (sandboxDsh.indexOf('.kybernos-sandbox') < 0) inconclusive('run it after `source scripts/sandbox/env.sh` (DSH_HOME must be the sandbox\'s, never your own ~/.dsh)')
const probeFile = join(sandboxDsh, 'kybers', '.probe.json')
const kyberFile = join(probeFile, '..', 'dev-team', 'kyber.yml')
if (!existsSync(join(probeFile, '..'))) inconclusive('no sandbox kybers folder at ' + join(probeFile, '..') + ' (KB_SANDBOX_DSH=<.dsh of the sandbox>)')
const savedProbe = existsSync(probeFile) ? readFileSync(probeFile, 'utf8') : null
const savedKyber = existsSync(kyberFile) ? readFileSync(kyberFile, 'utf8') : null
const restore = () => {
  try { if (savedProbe === null) rmSync(probeFile, { force: true }); else writeFileSync(probeFile, savedProbe) } catch (e) { /* best effort */ }
  try { if (savedKyber !== null) writeFileSync(kyberFile, savedKyber) } catch (e) { /* best effort */ }
}
const FAILING = { provider: 'xiaomi-token-plan-ams', model: 'mimo-v2.6-pro' }
writeFileSync(probeFile, JSON.stringify({ probedAt: '2026-10-29T14:32:00Z', note: 'role-replace live check', method: 'test', results: { [FAILING.provider + '|' + FAILING.model]: { ok: false, attempts: 3, note: 'timeout after 30 s' }, 'opencode-go|deepseek-v4.1-flash': { ok: true, attempts: 1, note: 'ok' } } }))

let live = null
try { live = await openLivePage() } catch (e) { restore(); inconclusive(String(e && e.message ? e.message : e)) }
const { page } = live
const ev = async (expr) => { const r = await page.evalJs(expr); if (r.err !== undefined) throw new Error('page: ' + r.err + ' in ' + String(expr).slice(0, 140)); return r.val }
const shot = async (name) => { if (shotsDir !== null) { try { await page.shot(join(shotsDir, name + '.png')) } catch (e) { /* a missing screenshot never fails a check */ } } }
const step = async (label, expr, ms) => {
  for (let i = 0; i < 6; i += 1) {
    if (label !== null) { try { await clickText(page, label) } catch (e) { /* not drawn yet */ } }
    if ((await waitFor(page, expr, ms)) !== null) return true
  }
  return false
}
const q = (sel) => 'document.querySelector(' + JSON.stringify(sel) + ')'
const count = (sel) => ev('document.querySelectorAll(' + JSON.stringify(sel) + ').length')
const text = (sel) => ev('(' + q(sel) + ' || {innerText: ""}).innerText.replace(/\\s+/g, " ")')
const click = (sel) => ev('(() => { const e = ' + q(sel) + '; if (!e) return false; e.click(); return true })()')
const gearOpen = async () => { if ((await count('.kbm-gear-pop')) === 0) await click('[data-kb=model-management]'); await sleep(300); await ev('(() => { const p = document.querySelector(".kbm-gear-pop"); if (p) p.scrollIntoView({ block: "center" }); return 1 })()'); await sleep(300) }
const gearClose = async () => { if ((await count('.kbm-gear-pop')) > 0) await click('[data-kb=model-management]'); await sleep(200) }
const roleModels = () => ev('Array.from(document.querySelectorAll(".kbm-members .kbm-art")).map((c) => (c.querySelector(".kb8-name") || {}).innerText + "=" + (c.querySelector(".kbm-failed") ? "failed" : (c.querySelector(".kbm-replaced") ? "replaced" : "ok"))).join(" | ")')

try {
  await page.send('Page.reload', {})
  await sleep(2500)
  if ((await waitFor(page, 'document.body && document.body.innerText.length > 80', 30000)) === null) inconclusive('the GUI did not render')
  await page.send('Runtime.enable', {})
  const errors = []
  page.on('Runtime.exceptionThrown', (p) => errors.push(String(p.exceptionDetails && p.exceptionDetails.exception && p.exceptionDetails.exception.description).slice(0, 200)))
  if (await step('Agent Teams', 'document.body.innerText.indexOf(' + JSON.stringify(TEAM) + ') >= 0', 5000) !== true) inconclusive('no team named ' + TEAM)
  if (await step(TEAM, 'document.body.innerText.indexOf("Danger Zone") >= 0', 7000) !== true) inconclusive('the team page did not open')
  if (await step('Roles', '!!document.querySelector(".kbm-members .kbm-art")', 9000) !== true) inconclusive('the Roles tab did not draw')
  // the prices decide the replacement: wait for them, then give the page a moment to settle
  await sleep(4000)
  await shot('replace-1-banner')
  // The same screen in the light scheme (the tab's colours are tokens that follow the app's scheme).
  try { await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] }); await sleep(600); await shot('replace-1b-banner-light'); await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] }); await sleep(300) } catch (e) { /* a missing screenshot never fails a check */ }

  console.log('The alert')
  check('one banner for the team, not one per role', (await count('[data-kb=role-fail-banner]')) === 1)
  const banner = await text('[data-kb=role-fail-banner]')
  check('it counts the roles that cannot run and names the model', /\d roles? cannot run/.test(banner) && banner.indexOf(FAILING.model) >= 0, banner.slice(0, 160))
  check('it says how it knows (the last check failed), not a claim it cannot prove', /failed its last check/.test(banner), banner.slice(0, 200))
  check('it offers the review, the switch, and a dismissal', (await count('[data-kb=role-fail-review]')) === 1 && (await count('[data-kb=role-fail-auto]')) === 1 && (await count('[data-kb=role-fail-dismiss]')) === 1)
  const failedBefore = await count('.kbm-members .kbm-failed')
  const nFailedRoles = Number((/(\d+) roles? cannot run/.exec(banner) || [])[1] || 0)
  check('the roles on that model are marked « Failed » on their card', failedBefore >= 1, String(failedBefore))
  const others = await ev('Array.from(document.querySelectorAll(".kbm-members .kbm-art")).filter((c) => !c.querySelector(".kbm-failed") && /Failed/.test(c.innerText)).length')
  check('no other card says Failed', others === 0)
  check('the gear carries a dot', (await count('.kbm-gear-dot')) === 1)
  const kyberBefore = readFileSync(kyberFile, 'utf8')
  check('nothing was written yet: the switch is off by default', kyberBefore === savedKyber)

  console.log('The review (switch off)')
  await click('[data-kb=role-fail-review]'); await sleep(500)
  const nFailed = Number((/(\d+) roles? cannot run/.exec(banner) || [])[1] || 0)
  check('the review lists every failed role (also those on the other pages, and roles with no model) with a proposal each', nFailed >= 1 && (await count('.kbm-dlg .kbm-upd-row')) >= nFailed, nFailed + ' in the banner, ' + (await count('.kbm-dlg .kbm-upd-row')) + ' rows')
  check('the first proposal is on a plan when one matches (plans first)', /on your plan/.test(await text('.kbm-dlg .kbm-upd-row')) || (await count('.kbm-dlg .kbm-upd-row')) > 0)
  await shot('replace-2-review')
  await ev('(() => { const b = Array.from(document.querySelectorAll(".kbm-dlg .kbm-pill")).find((x) => /Cancel/.test(x.innerText)); if (b) b.click() })()'); await sleep(300)
  check('Cancel writes nothing', readFileSync(kyberFile, 'utf8') === savedKyber)

  console.log('The switch')
  await gearOpen()
  const sw = await ev('(() => { const s = ' + q('[data-kb=auto-replace]') + '; return s ? s.getAttribute("aria-checked") + "/" + s.disabled : "none" })()')
  check('the gear holds « Replace failed models with equivalent ones », off', sw === 'false/false', sw)
  await shot('replace-3-gear-off')
  await click('[data-kb=auto-replace]')
  const changed = await waitFor(page, 'document.querySelectorAll(".kbm-members .kbm-replaced").length > 0', 15000)
  check('turning it on replaces the failed roles by itself', changed !== null)
  await sleep(2500)
  const afterOn = await roleModels()
  check('no role is left « Failed »', (await count('.kbm-members .kbm-failed')) === 0, afterOn)
  const written = readFileSync(kyberFile, 'utf8')
  const lines = (t) => t.split('\n')
  const changedLines = lines(written).filter((l, i) => l !== lines(savedKyber)[i]).slice(0, 4).join(' ¦ ')
  // The best route first: when the same model is served by one of the person's plans, the role keeps its model and changes route; else the best match.
  const onFailing = (t) => (t.match(new RegExp('provider: ' + FAILING.provider, 'g')) || []).length
  check('the roles file now names another route or model for those roles', written !== savedKyber && onFailing(written) < onFailing(savedKyber), 'changed: ' + (changedLines || 'nothing'))
  await gearOpen()
  await shot('replace-4b-gear-history')
  const hist = await count('[data-kb=replace-history] .kbm-mmp-hrow')
  check('the gear lists each change with an Undo', hist >= 1 && (await count('[data-kb=replace-history] .kbm-lnk')) === hist, String(hist))
  await gearClose()
  check('the banner now says what moved (neutral), with Undo', (await count('[data-kb=role-moved-banner]')) === 1 && (await count('[data-kb=role-moved-undo]')) === 1)
  await shot('replace-4-moved')

  console.log('Undo')
  await click('[data-kb=role-moved-undo]')
  await sleep(4000)
  const restored = readFileSync(kyberFile, 'utf8')
  check('Undo puts the old model and route back in the roles file', onFailing(restored) === onFailing(savedKyber))
  check('the roles fail again on the old model', (await count('.kbm-members .kbm-failed')) === failedBefore, await roleModels())
  await sleep(1500)
  check('and are NOT replaced again for that failure (the switch is still on)', (await count('.kbm-members .kbm-replaced')) === 0)
  const heldBanner = await text('[data-kb=role-fail-banner]')
  check('the banner says nothing moved by itself because you undid it', /undid/.test(heldBanner), heldBanner.slice(0, 240))
  await shot('replace-5-undone')

  console.log('Dismiss')
  await click('[data-kb=role-fail-dismiss]'); await sleep(400)
  check('Dismiss hides the banner', (await count('[data-kb=role-fail-banner]')) === 0)
  check('the cards still say Failed, and the gear keeps its dot', (await count('.kbm-members .kbm-failed')) === failedBefore && (await count('.kbm-gear-dot')) === 1)

  console.log('From the Agent Teams list')
  // The team list again, through the sidebar (the page's own « Back » may have scrolled out of view).
  await step('Agent Teams', 'document.querySelectorAll("[data-kb=kyber-card],[data-kb=kyber-row]").length > 0', 6000)
  const fig = await waitFor(page, 'document.querySelectorAll("[data-kb=kyber-fail]").length > 0', 8000)
  check('the team\'s card says how many roles failed, so a failure is visible without opening the team', fig !== null)
  const figText = await ev('(function () { var e = document.querySelector("[data-kb=kyber-fail]"); return e ? e.innerText.replace(/\\s+/g, " ") : "" })()')
  check('the figure carries the same count as the banner', new RegExp('^' + nFailedRoles + '\\b').test(String(figText)), String(figText))
  await shot('replace-6-list')

  console.log('Nothing broke')
  check('no script error in the page', errors.length === 0, errors.join(' | '))
  check('no overflow sideways', (await ev('document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1')) === true)
} catch (e) {
  fail('the check ran to the end', String(e && e.message ? e.message : e))
} finally {
  restore()
  try { await live.close() } catch (e) { /* closed */ }
}
console.log(failures === 0 ? '\nAll good.' : '\n' + failures + ' check(s) failed.')
process.exit(failures === 0 ? 0 : 1)

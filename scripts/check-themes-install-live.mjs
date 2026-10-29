#!/usr/bin/env node
// The Themes page, « From a folder », end to end on a SANDBOX dsh web: the button is visible and clicked with a real mouse, a folder DSH would
// roll back is refused with a reason, the starter theme gets its plan, installs, and is removed again.
//
//   source scripts/sandbox/env.sh && node scripts/check-themes-install-live.mjs [--shots <dir>]
//
// What is real: the page, the host routes and DSH's plugin manager (pnpm links the starter into the sandbox profile, then unlinks it).
// Sandbox only (exit 3 against :3080, and without DSH_HOME): the install writes the profile and the removal edits it. The folders are
// copies of the starter in a temp folder, deleted at the end. Nothing is sent to a model.
//
// Exit 0 all good, 1 a check failed, 3 not run (not a sandbox, or no GUI).
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openLivePage, clickText, waitFor } from './live-page.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null
if (!process.env.KB_HOST || process.env.KB_HOST.endsWith(':3080') || !process.env.DSH_HOME) {
  console.error('○ not run: this check installs into a profile, so it only runs on a sandbox (source scripts/sandbox/env.sh)')
  process.exit(3)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0
const failures = []
const check = (label, cond, detail) => {
  if (cond) { pass += 1; console.log('  ✓ ' + label) } else { failures.push(label); console.log('  ✗ ' + label + (detail === undefined ? '' : '  — ' + JSON.stringify(detail).slice(0, 400))) }
}

// two folders: the starter as it is, and the same without its bundle patch (DSH's manager would answer not-bundle)
const tmp = mkdtempSync(join(tmpdir(), 'kb-themes-install-'))
const good = join(tmp, 'vet-clinic')
const plain = join(tmp, 'plain-clinic')
cpSync(join(here, '..', 'docs', 'dev', 'templates', 'acme-vet-clinic'), good, { recursive: true })
rmSync(join(good, 'broken'), { recursive: true, force: true })
cpSync(good, plain, { recursive: true })
{
  const pj = JSON.parse(readFileSync(join(plain, 'package.json'), 'utf8'))
  delete pj.dsh
  writeFileSync(join(plain, 'package.json'), JSON.stringify(pj, null, 2))
  rmSync(join(plain, 'cordis.patch.yml'))
  const pm = JSON.parse(readFileSync(join(plain, 'plugin.json'), 'utf8'))
  pm.id = 'acme/plain-clinic'
  writeFileSync(join(plain, 'plugin.json'), JSON.stringify(pm, null, 2))
}
const profileDeps = () => { try { return Object.keys(JSON.parse(readFileSync(join(process.env.DSH_HOME, 'profiles', 'web', 'package.json'), 'utf8')).dependencies || {}) } catch (e) { return [] } }

const live = await openLivePage({ width: 1400, height: 900 }).catch((e) => { console.error('○ not run: ' + e.message); rmSync(tmp, { recursive: true, force: true }); process.exit(3) })
const { page } = live
const ev = async (js, ms) => (await page.evalJs(js, ms || 8000)).val
const shot = async (name) => {
  if (shotsDir === null) return
  try { mkdirSync(shotsDir, { recursive: true }); const r = await page.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(shotsDir, name + '.png'), Buffer.from(r.result.data, 'base64')) } catch (e) { console.log('     (no screenshot: ' + e.message + ')') }
}
const rect = async (selector) => ev(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height } })()`)
const mouse = async (type, x, y) => page.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 })
/** A real mouse press at the middle of an element; false when it has no size (hidden by CSS), which is what this check is about. */
const click = async (selector) => {
  // the gallery is taller than the window: a person scrolls to the control first
  await ev(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (e) e.scrollIntoView({ block: 'center' }); return 1 })()`)
  const c = await rect(selector)
  if (c === null || c.w < 4 || c.h < 4) return false
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await mouse(type, c.x, c.y)
  return true
}
const pageText = async () => (await ev(`(() => { const p = document.querySelector('[data-kb-page="themes"]'); return p ? p.innerText.replace(/\\n+/g, ' | ') : '' })()`)) || ''
const typeFolder = async (folder) => {
  await click('[data-kb="theme-folder"]')
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 4, windowsVirtualKeyCode: 65, commands: ['selectAll'] })
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 4, windowsVirtualKeyCode: 65 })
  await page.send('Input.insertText', { text: folder })
  await sleep(300)
}
const FOLDER_BUTTON = '[data-kb="theme-folder-add"]'

try {
  console.log('The Themes page and its folder card')
  await sleep(2000)
  // the sandbox starts on a legacy field name that no pack answers to; give it a real one so the removal has a field to put back
  await ev(`fetch('/kybernos/onboarding', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'domain', profil: 'general', goals: [] }) }).then((r) => r.status)`, 10000)
  await clickText(page, 'Themes')
  const there = await waitFor(page, `!!document.querySelector('[data-kb="theme-folder"]')`, 12000)
  check('the Themes page draws its folder card', there !== null)
  const btn = await rect(FOLDER_BUTTON)
  check('« Add and see the plan » is visible (the team list\'s rule used to hide every action of a Themes card)', btn !== null && btn.w > 40 && btn.h > 20, btn)
  const desc = await rect('.kbgal-add p')
  check('the folder card\'s description is visible too', desc !== null && desc.h > 8, desc)
  await shot('1-folder-card')

  console.log('A folder DSH would roll back')
  await typeFolder(plain)
  check('the button can be pressed with the mouse', await click(FOLDER_BUTTON))
  const refused = await waitFor(page, `/only as a bundle/.test(document.querySelector('[data-kb-page="themes"]').innerText)`, 10000)
  check('it is refused with a reason that names the patch, before DSH is asked', refused !== null, await pageText())
  check('no plan dialog opens for it', (await rect('[data-kb="theme-plan"]')) === null)
  check('the profile is untouched', !profileDeps().some((d) => /plain-clinic/.test(d)), profileDeps().filter((d) => /acme/.test(d)))
  await shot('2-refused')

  console.log('The starter theme: stage, plan')
  await typeFolder(good)
  check('the button can be pressed with the mouse', await click(FOLDER_BUTTON))
  // pnpm links the package, then DSH's manager applies it: it takes several seconds, longer than any click handler
  const planned = await waitFor(page, `!!document.querySelector('[data-kb="theme-plan"] [role="dialog"]')`, 90000)
  check('DSH installs the package and the plan opens (no unknown-plugin)', planned !== null, await pageText())
  check('the profile now lists the package', profileDeps().includes('@acme/kybernos-vet-clinic'), profileDeps().filter((d) => /acme/.test(d)))
  const planText = await pageText()
  check('the plan names the style, the field and the kit, each with its file', /Style/.test(planText) && /Field/.test(planText) && /themes\/vet-clinic\.json/.test(planText) && /domains\/vet-clinic\.json/.test(planText), planText.slice(0, 300))
  await shot('3-plan')

  console.log('Install, then remove')
  check('the consent is ticked, then the primary action is pressed with the mouse', (await click('[data-kb="theme-consent"]')) && (await click('[data-kb="theme-go"]')))
  const reported = await waitFor(page, `!!document.querySelector('[data-kb="theme-report"] [role="dialog"]')`, 60000)
  const report = await pageText()
  check('the report opens', reported !== null, report)
  check('the field and the look are applied (the look is the theme\'s own style, not a gallery id)', /Field \| applied/.test(report) && /Style \| applied/.test(report), report)
  // the starter\'s goal names a skill (consult-notes) that no shipped skill matches: « a contributed skill folder has no install route yet »
  check('the team and the automation are added; the one thing that cannot be (a contributed skill) is the only failure', /Added \| [3-9]/.test(report) && /Failed \| [01]\b/.test(report), report)
  await shot('4-report')
  const saved = await ev(`fetch('/kybernos/onboarding', { credentials: 'same-origin' }).then((r) => r.json()).then((j) => j.profil)`, 10000)
  check('its field is the saved one', saved === 'vet-clinic', saved)
  check('« Back to themes » can be pressed', await click('[data-kb="theme-back-to-themes"]'))
  const done = await waitFor(page, `(() => { const c = document.querySelector('[data-kb-page="themes"] [data-theme="acme/vet-clinic"]'); return c !== null && /Installed/.test(c.innerText) })()`, 30000)
  check('the theme is listed as installed', done !== null, await pageText())
  await shot('5-installed')
  check('the card is opened, its Remove button is visible and pressed', (await click('[data-kb-page="themes"] [data-theme="acme/vet-clinic"]')) && (await click('[data-kb="theme-remove"]')))
  const gone = await waitFor(page, `document.querySelector('[data-kb-page="themes"] [data-theme="acme/vet-clinic"]') === null`, 60000)
  check('the card goes away', gone !== null, await pageText())
  // DSH's manager unlinks the package after the page has already stopped listing it: wait for the profile, up to a minute
  for (let i = 0; i < 30 && profileDeps().includes('@acme/kybernos-vet-clinic'); i += 1) await sleep(2000)
  check('the package is unlinked from the profile (DSH\'s removal)', !profileDeps().includes('@acme/kybernos-vet-clinic'), profileDeps().filter((d) => /acme/.test(d)))
  const back = await ev(`fetch('/kybernos/onboarding', { credentials: 'same-origin' }).then((r) => r.json()).then((j) => j.profil)`, 10000)
  check('the field is the one from before', back === 'general', back)
  await shot('6-removed')
} catch (e) {
  failures.push('the check itself: ' + e.message)
  console.log('  ✗ the check stopped: ' + e.message)
} finally {
  try { await live.close() } catch (e) { /* gone */ }
  rmSync(tmp, { recursive: true, force: true })
}
console.log('\n' + pass + ' passed, ' + failures.length + ' failed')
process.exit(failures.length === 0 ? 0 : 1)

#!/usr/bin/env node
// Settings › Templates, « From a folder », end to end on a SANDBOX dsh web: the path is checked as it is typed (a folder DSH would roll back is refused with a
// reason, a good one shows what it holds), the button is clicked with a real mouse, the gallery opens on the plan, the starter template installs and is removed again.
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
import { openLivePage, openSettings, goToSettingsPage, waitFor } from './live-page.mjs'

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
const settingsText = async () => (await ev(`(() => { const p = document.querySelector('[data-kb="kb-market"]'); return p ? p.innerText.replace(/\\n+/g, ' | ') : '' })()`)) || ''
const typeFolder = async (folder) => {
  await click('[data-kb="kb-tpl-folder-path"]')
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 4, windowsVirtualKeyCode: 65, commands: ['selectAll'] })
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 4, windowsVirtualKeyCode: 65 })
  await page.send('Input.insertText', { text: folder })
  await sleep(300)
}
const FOLDER_BUTTON = '[data-kb="kb-tpl-add"]'

try {
  console.log('Settings › Templates, from a folder')
  await sleep(2000)
  // the sandbox starts on a legacy field name that no pack answers to; give it a real one so the removal has a field to put back
  await ev(`fetch('/kybernos/onboarding', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'domain', profil: 'general', goals: [] }) }).then((r) => r.status)`, 10000)
  check('Settings opens', await openSettings(page))
  check('the Templates page is in the Interface group', await goToSettingsPage(page, /^(Templates|Modèles)$/, { marker: `!!document.querySelector('[data-kb="kb-market"]')` }))
  const there = await waitFor(page, `!!document.querySelector('[data-kb="kb-tpl-folder-path"]')`, 12000)
  check('it opens on « From a folder »: one path field, and the button is off until the folder is good', there !== null && (await ev(`document.querySelector('${FOLDER_BUTTON}').disabled`)) === true)
  check('the two ways are tabs: a folder, a catalogue', (await ev(`[...document.querySelectorAll('[role="tab"]')].map((t) => t.getAttribute('data-kb') + ':' + t.getAttribute('aria-selected')).join(',')`)) === 'kb-tpl-tab-folder:true,kb-tpl-tab-catalogue:false')
  const btn = await rect(FOLDER_BUTTON)
  check('« Add and see the plan » is visible', btn !== null && btn.w > 40 && btn.h > 20, btn)
  await shot('1-settings-templates')

  console.log('A folder that cannot be read, a file, a folder DSH would roll back')
  await typeFolder(join(tmp, 'nothing-here'))
  check('a path that is not there is refused as you type, in plain words, and the button stays off', (await waitFor(page, `/cannot be read/.test(document.querySelector('[data-kb="kb-tpl-refused"]') ? document.querySelector('[data-kb="kb-tpl-refused"]').innerText : '')`, 8000)) !== null && (await ev(`document.querySelector('${FOLDER_BUTTON}').disabled`)) === true, await settingsText())
  await typeFolder(join(good, 'plugin.json'))
  check('a file is not a folder', (await waitFor(page, `/file, not a folder/.test(document.querySelector('[data-kb="kb-tpl-refused"]') ? document.querySelector('[data-kb="kb-tpl-refused"]').innerText : '')`, 8000)) !== null, await settingsText())
  await typeFolder(plain)
  check('a folder DSH would roll back is refused before DSH is asked, with a reason that names what is wrong', (await waitFor(page, `/not a data template/.test(document.querySelector('[data-kb="kb-tpl-refused"]') ? document.querySelector('[data-kb="kb-tpl-refused"]').innerText : '')`, 8000)) !== null, await settingsText())
  check('the button is still off and the profile is untouched', (await ev(`document.querySelector('${FOLDER_BUTTON}').disabled`)) === true && !profileDeps().some((d) => /plain-clinic/.test(d)), profileDeps().filter((d) => /acme/.test(d)))
  await shot('2-refused')

  console.log('The starter template: preview, add, plan')
  await typeFolder(good)
  const shown = await waitFor(page, `!!document.querySelector('[data-kb="kb-tpl-preview"]')`, 8000)
  const preview = (await ev(`(() => { const p = document.querySelector('[data-kb="kb-tpl-preview"]'); return p ? p.innerText.replace(/\\n+/g, ' | ') : '' })()`)) || ''
  check('a good folder shows what it holds before anything is installed: its name, its id, its level, what it adds', shown !== null && /acme\/vet-clinic/.test(preview) && /Local/.test(preview) && /It adds/.test(preview), preview)
  check('the button is on, and nothing is installed yet', (await ev(`document.querySelector('${FOLDER_BUTTON}').disabled`)) === false && !profileDeps().includes('@acme/kybernos-vet-clinic'))
  await shot('3-preview')
  check('the button can be pressed with the mouse', await click(FOLDER_BUTTON))
  // pnpm links the package, then DSH's manager applies it: it takes several seconds, longer than any click handler
  const planned = await waitFor(page, `!!document.querySelector('[data-kb="theme-plan"] [role="dialog"]')`, 90000)
  check('DSH installs the package, Settings closes, the gallery opens on its plan (no unknown-plugin)', planned !== null && (await rect('[data-kb="kb-market"]')) === null, await pageText())
  check('the profile now lists the package', profileDeps().includes('@acme/kybernos-vet-clinic'), profileDeps().filter((d) => /acme/.test(d)))
  // the item list (every name with its file) is behind « Customise »
  await click('[data-kb="theme-customise"]')
  await sleep(300)
  const planText = await pageText()
  check('the plan names the style, the field and the kit, each with its file', /Style/.test(planText) && /Field/.test(planText) && /themes\/vet-clinic\.json/.test(planText) && /domains\/vet-clinic\.json/.test(planText), planText.slice(0, 300))
  await shot('4-plan')

  console.log('Install, then remove')
  check('the consent is ticked, then the primary action is pressed with the mouse', (await click('[data-kb="theme-consent"]')) && (await click('[data-kb="theme-go"]')))
  const reported = await waitFor(page, `!!document.querySelector('[data-kb="theme-report"] [role="dialog"]')`, 60000)
  const report = await pageText()
  check('the report opens', reported !== null, report)
  check('the field and the look are applied (the look is the theme\'s own style, not a gallery id)', /Field \| applied/.test(report) && /Style \| applied/.test(report), report)
  // the starter\'s goal names a skill (consult-notes) that no shipped skill matches: « a contributed skill folder has no install route yet »
  check('the team and the automation are added; the one thing that cannot be (a contributed skill) is the only failure', /Added \| [3-9]/.test(report) && /Failed \| [01]\b/.test(report), report)
  await shot('5-report')
  const saved = await ev(`fetch('/kybernos/onboarding', { credentials: 'same-origin' }).then((r) => r.json()).then((j) => j.profil)`, 10000)
  check('its field is the saved one', saved === 'vet-clinic', saved)
  check('« Back to templates » can be pressed', await click('[data-kb="theme-back-to-themes"]'))
  const done = await waitFor(page, `(() => { const c = document.querySelector('[data-kb-page="themes"] [data-theme="acme/vet-clinic"]'); return c !== null && /Installed/.test(c.innerText) })()`, 30000)
  check('the theme is listed as installed', done !== null, await pageText())
  await shot('6-installed')
  check('the card is opened, its Remove button is visible and pressed', (await click('[data-kb-page="themes"] [data-theme="acme/vet-clinic"]')) && (await click('[data-kb="theme-remove"]')))
  const gone = await waitFor(page, `document.querySelector('[data-kb-page="themes"] [data-theme="acme/vet-clinic"]') === null`, 60000)
  check('the card goes away', gone !== null, await pageText())
  // DSH's manager unlinks the package after the page has already stopped listing it: wait for the profile, up to a minute
  for (let i = 0; i < 30 && profileDeps().includes('@acme/kybernos-vet-clinic'); i += 1) await sleep(2000)
  check('the package is unlinked from the profile (DSH\'s removal)', !profileDeps().includes('@acme/kybernos-vet-clinic'), profileDeps().filter((d) => /acme/.test(d)))
  const back = await ev(`fetch('/kybernos/onboarding', { credentials: 'same-origin' }).then((r) => r.json()).then((j) => j.profil)`, 10000)
  check('the field is the one from before', back === 'general', back)
  await shot('7-removed')
} catch (e) {
  failures.push('the check itself: ' + e.message)
  console.log('  ✗ the check stopped: ' + e.message)
} finally {
  try { await live.close() } catch (e) { /* gone */ }
  rmSync(tmp, { recursive: true, force: true })
}
console.log('\n' + pass + ' passed, ' + failures.length + ' failed')
process.exit(failures.length === 0 ? 0 : 1)

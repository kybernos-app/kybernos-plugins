#!/usr/bin/env node
// R-W2-02 of the 2026-10-16 audit: in Settings › Skills the « Index source » window sits on the page, outside Settings' own dialog, whose focus
// handling never let Tab reach it (0 of 44 presses reached Close, Cancel or Save). The window walks Tab itself now.
//
//   source scripts/sandbox/env.sh && node scripts/check-skills-source-keys-live.mjs
//
// Isolated instance only (it refuses :3080): it opens Settings › Skills › Index source, presses Tab and Shift+Tab, and Escape. Nothing is saved.
// Exit code 0 / 1 / 3.
import { openLivePage, openSettings, goToSettingsPage } from './live-page.mjs'

const authority = process.env.KB_HOST || '127.0.0.1:3080'
if (/:3080$/.test(authority)) { console.error('Refused: this check is for the isolated instance (source scripts/sandbox/env.sh).'); process.exit(3) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0
let fail = 0
const check = (name, ok, detail) => { console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok || detail === undefined ? '' : '  — ' + JSON.stringify(detail))); if (ok) pass += 1; else fail += 1 }

const { page, close } = await openLivePage()
try {
  const ev = async (js) => (await page.evalJs(js, 8000)).val
  check('Settings open', (await openSettings(page, { tries: 3 })) === true)
  const went = await goToSettingsPage(page, 'Skills', { marker: `document.querySelector('[data-kb=index-source-change]') !== null`, markerMs: 12000 })
  check('Settings › Skills opens', went === true)
  await ev(`document.querySelector('[data-kb=index-source-change]').click()`)
  await sleep(800)
  check('the Index source window opens', (await ev(`!!document.querySelector('[data-kb=index-source-modal]')`)) === true)
  const press = async (shift) => {
    for (const type of ['keyDown', 'keyUp']) await page.send('Input.dispatchKeyEvent', { type, key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, modifiers: shift ? 8 : 0 })
    await sleep(120)
    return await ev(`(() => { const m = document.querySelector('[data-kb=index-source-modal]'); const a = document.activeElement; if (!m || !a || !m.contains(a)) return 'OUT'; return a.getAttribute('data-kb') || (a.getAttribute('aria-label') ? 'close' : (a.innerText || '').trim()) })()`)
  }
  // When KYBERNOS_SKILLS_INDEX_URL is set the variable decides the address: the window only says so, with no field and no Save, and its Tab cycle is Cancel and the close cross.
  const locked = (await ev(`!document.querySelector('[data-kb=index-source-input]')`)) === true
  if (locked) console.log('  · the address is fixed by KYBERNOS_SKILLS_INDEX_URL in this instance: the window has no field and no Save, so only Cancel and the close cross are walked')
  const stops = locked ? ['Cancel', 'close'] : ['index-source-input', 'Cancel', 'index-source-save', 'close']
  const forward = []
  for (let i = 0; i < 8; i += 1) forward.push(await press(false))
  check('Tab stays inside the window and reaches ' + (locked ? 'Cancel and the close cross' : 'the field, Cancel, Save and the close cross'), !forward.includes('OUT') && stops.every((x) => forward.includes(x)), forward)
  const backward = []
  for (let i = 0; i < 6; i += 1) backward.push(await press(true))
  check('Shift+Tab walks the other way and stays inside', !backward.includes('OUT') && new Set(backward).size >= stops.length, backward)
  for (const type of ['keyDown', 'keyUp']) await page.send('Input.dispatchKeyEvent', { type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await sleep(500)
  check('Escape closes the window and leaves Settings open', (await ev(`!document.querySelector('[data-kb=index-source-modal]') && document.querySelectorAll('button[class*="navCell"]').length > 0`)) === true)
} finally { await close() }
console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail > 0 ? 1 : 0)

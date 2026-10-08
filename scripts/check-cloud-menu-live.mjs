// The account menu of the Kybernos Cloud card, on the REAL GUI (read-only): one entry for the team console, and creating a shared space says « team ».
//
//   node scripts/check-cloud-menu-live.mjs             this checkout's kybernos-cloud client swapped into the running GUI
//   node scripts/check-cloud-menu-live.mjs --baseline  nothing swapped: what the running GUI shows today
//
// What is real: the DSH page, the sidebar footer card, the account menu and the workspace switcher it opens. What is swapped (not in --baseline):
// the kybernos-cloud client, from this checkout instead of the shared tree, in a throw-away Chrome (scripts/lib-bundle-swap.mjs). Nothing is
// clicked except the card that opens the menu; no workspace is created or changed.
//
// Exit 0 all good, 1 a check failed, 3 not run (no GUI, or the card is not there: an account that is not connected shows another footer).
import { openLivePage, waitFor } from './live-page.mjs'
import { swapBundles } from './lib-bundle-swap.mjs'

const baseline = process.argv.includes('--baseline')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0
const failures = []
const check = (label, cond, detail) => {
  if (cond) { pass += 1; console.log('  ✓ ' + label) } else { failures.push(label); console.log('  ✗ ' + label + (detail === undefined ? '' : '  — ' + JSON.stringify(detail).slice(0, 300))) }
}

const live = await openLivePage({ width: 1500, height: 950 }).catch((e) => { console.error('○ not run: ' + e.message); process.exit(3) })
const { page } = live
let notRun = null
try {
  await page.send('Runtime.enable', {})
  if (!baseline) {
    const swap = await swapBundles(page, [{ name: 'kybernos-cloud' }])
    await page.send('Page.reload', { ignoreCache: true })
    await sleep(2500)
    await waitFor(page, 'document.body && document.body.innerText.length > 80', 30000)
    check('the kybernos-cloud client was found in the served bundle and swapped', swap.report().every((r) => r.replaced === true), swap.report())
  }
  console.log(baseline ? 'Cloud menu — the running GUI as it is today' : 'Cloud menu — this checkout\'s client in the real GUI')
  const card = await waitFor(page, `(() => { const c = document.querySelector('[data-kb="workspace-card"] .kbfp-cardmain'); if (!c) return null; const r = c.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`, 25000)
  if (!card) {
    notRun = 'the workspace card is not in the sidebar footer (the account is not connected to a Kybernos server)'
  } else {
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type, x: card.x, y: card.y, button: 'left', clickCount: 1 })
    await sleep(900)
    const menu = (await page.evalJs(`(() => ({
      settings: !!document.querySelector('[data-kb="menu-space-settings"]'),
      browser: !!document.querySelector('[data-kb="menu-space-browser"]'),
      text: Array.from(document.querySelectorAll('[data-kb^="menu-"]')).map((e) => (e.innerText || '').trim()).filter(Boolean).join(' | '),
      pops: Array.from(document.querySelectorAll('.kbfp-sub')).map((e) => (e.innerText || '').replace(/\\s+/g, ' ').trim()).join(' || '),
    }))()`)).val
    console.log('     menu entries:', JSON.stringify(menu.text).slice(0, 260))
    check('the menu has « Teams settings » (the one entry for the team console)', menu.settings === true, menu)
    check('the menu has no « Open the console in your browser » (it did nothing and repeated Teams settings)', menu.browser === false && !/Open the console|Ouvrir la console/i.test(menu.text), menu.text)
    // The switcher opens from the head of the menu (the row that names the workspace); reading it changes nothing.
    const head = (await page.evalJs(`(() => { const b = document.querySelector('[data-kb="menu-switch"]'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)).val
    check('the menu head that opens the workspace switcher is there', head !== null)
    if (head !== null) {
      for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type, x: head.x, y: head.y, button: 'left', clickCount: 1 })
      await sleep(900)
      const pops = (await page.evalJs(`Array.from(document.querySelectorAll('.kbfp-sub')).map((e) => (e.innerText || '').replace(/\\s+/g, ' ').trim()).join(' || ')`)).val
      console.log('     switcher:', JSON.stringify(pops).slice(0, 300))
      check('the switcher lists the workspaces and offers to create one', /switch workspace|changer d/i.test(pops) && /create a |créer /i.test(pops), pops)
      check('creating a shared space says « team » in the switcher, not « workspace »', /Create a team|Créer une équipe/.test(pops) && !/Create a workspace|Créer un espace/.test(pops), pops)
    }
  }
} finally {
  await live.close()
}
if (notRun !== null) { console.error('○ not run: ' + notRun); process.exit(3) }
console.log('\n' + pass + ' checks passed' + (failures.length > 0 ? ', ' + failures.length + ' FAILED' : ''))
process.exit(failures.length > 0 ? 1 : 0)

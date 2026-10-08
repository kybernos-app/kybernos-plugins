// The "App" button of the mini-apps plugin lands on the panels it is meant for, and nowhere else — on the REAL GUI (read-only).
//
//   node scripts/check-miniapps-panels-live.mjs             this checkout's miniapps, slides and modeleur clients swapped into the running GUI
//   node scripts/check-miniapps-panels-live.mjs --baseline  nothing swapped: what the running GUI does today
//
// What is real: the DSH page, the Skills panel in the Resources area, the mini-apps plugin's own sweep (a MutationObserver that puts a button in
// the head of every panel of its list). What is swapped (not in --baseline): the three client files, from this checkout instead of the shared
// tree, in a throw-away Chrome (scripts/lib-bundle-swap.mjs). What is synthetic: the panels of Slides, the Modeleur and Bricks, which only exist
// once a chat writes something into them, are stood in by empty elements with the classes their bundles render (scripts/test-miniapps-panels.mjs
// checks those class names against the bundles' sources). Nothing is written anywhere.
//
// Exit 0 all good, 1 a check failed, 3 not run (no GUI).
import { openLivePage, waitFor, clickText } from './live-page.mjs'
import { swapBundles } from './lib-bundle-swap.mjs'

const baseline = process.argv.includes('--baseline')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0
const failures = []
const check = (label, cond, detail) => {
  if (cond) { pass += 1; console.log('  ✓ ' + label) } else { failures.push(label); console.log('  ✗ ' + label + (detail === undefined ? '' : '  — ' + JSON.stringify(detail).slice(0, 300))) }
}

const live = await openLivePage().catch((e) => { console.error('○ not run: ' + e.message); process.exit(3) })
const { page } = live
const errors = []
try {
  await page.send('Runtime.enable', {})
  page.on('Runtime.exceptionThrown', (p) => errors.push(String((p.exceptionDetails && p.exceptionDetails.exception && p.exceptionDetails.exception.description) || 'exception').slice(0, 200)))
  let swap = null
  if (!baseline) {
    swap = await swapBundles(page, [{ name: 'kybernos-miniapps' }, { name: 'kybernos-slides' }, { name: 'kybernos-modeleur' }])
    await page.send('Page.reload', { ignoreCache: true })
    await sleep(2500)
    await waitFor(page, 'document.body && document.body.innerText.length > 80', 30000)
  }
  console.log(baseline ? 'App button — the running GUI as it is today' : 'App button — this checkout\'s clients in the real GUI')
  if (swap !== null) check('the three clients were found in the served bundle and swapped', swap.report().every((r) => r.replaced === true), swap.report())

  // ── the Skills page, every segment ──
  await clickText(page, 'Skills')
  check('the Skills page opens', (await waitFor(page, "!!document.querySelector('.kbs-root .kbsub-group')", 20000)) !== null)
  await sleep(2500)
  const buttonsIn = (sel) => page.evalJs(`document.querySelectorAll(${JSON.stringify(sel + ' .kbmini-btn')}).length`).then((r) => r.val)
  const segment = async (label) => {
    const r = await page.evalJs(`(() => { const b = Array.from(document.querySelectorAll('.kbs-root .kbsub-group button')).find((x) => x.innerText.trim().startsWith(${JSON.stringify(label)})); if (!b) return null; b.scrollIntoView({ block: 'center' }); const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)
    if (!r.val) return false
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...r.val })
    await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...r.val, button: 'left', clickCount: 1 })
    await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...r.val, button: 'left', clickCount: 1 })
    await sleep(2500)
    return true
  }
  for (const label of ['Yours', 'Discover', 'Team']) {
    check('Skills › ' + label + ': the segment opens', await segment(label))
    check('Skills › ' + label + ': no "App" button anywhere in the page', (await buttonsIn('.kbs-root')) === 0, await buttonsIn('.kbs-root'))
  }

  // ── stand-in panels: which ones get the button ──
  const stage = async (id, html) => {
    await page.evalJs(`(() => { const d = document.createElement('div'); d.id = ${JSON.stringify(id)}; d.innerHTML = ${JSON.stringify(html)}; document.body.appendChild(d) })()`)
  }
  // The plugin's sweep takes the FIRST element a selector matches: the pages that must get nothing come first, so that a selector that is too
  // wide would take them before it reached the real panel (the other way round, a wrong match behind a right one would go unseen).
  await stage('kb-t-models-settings', '<div class="kbm-root kbmp"><div class="kbm-head">head</div></div>')
  await stage('kb-t-core-models', '<div class="kbm-root"><div class="kbm-head">head</div></div>')
  await stage('kb-t-skills-like', '<div class="kbs-root"><div class="kbs-head">head</div></div>')
  await stage('kb-t-slides', '<div class="kbsd-root"><div class="kbsd-head">head</div></div>')
  await stage('kb-t-modeleur', '<div class="kbm-root kbmo"><div class="kbm-head">head</div></div>')
  await stage('kb-t-briques', '<div class="kbb-root"><div class="kbb-head">head</div></div>')
  // Wait for the sweep to reach the Bricks stand-in (a cold DSH, just restarted, takes longer than 3 s), then give it a beat for the others.
  await waitFor(page, "document.querySelectorAll('#kb-t-briques .kbb-head > .kbmini-btn').length === 1", 20000)
  await sleep(1500)
  const inHead =(id, head) => page.evalJs(`document.querySelectorAll('#${id} .${head} > .kbmini-btn').length`).then((r) => r.val)
  const anywhere = (id) => page.evalJs(`document.querySelectorAll('#${id} .kbmini-btn').length`).then((r) => r.val)
  if (!baseline) {
    check('Slides: its panel (.kbsd-root) gets one button, in its head', (await inHead('kb-t-slides', 'kbsd-head')) === 1, await anywhere('kb-t-slides'))
    check('the Modeleur: its panel (.kbm-root.kbmo) gets one button, in its head', (await inHead('kb-t-modeleur', 'kbm-head')) === 1, await anywhere('kb-t-modeleur'))
  }
  check('Bricks: its panel still gets one button, in its head', (await inHead('kb-t-briques', 'kbb-head')) === 1, await anywhere('kb-t-briques'))
  check('AI Provider & Models (.kbm-root.kbmp) gets none', (await anywhere('kb-t-models-settings')) === 0, await anywhere('kb-t-models-settings'))
  check('the core\'s own Models page (a bare .kbm-root) gets none', (await anywhere('kb-t-core-models')) === 0, await anywhere('kb-t-core-models'))
  check('a page that only looks like Skills (.kbs-root with a .kbs-head) gets none', (await anywhere('kb-t-skills-like')) === 0, await anywhere('kb-t-skills-like'))
  check('no script error was thrown during the run', errors.length === 0, errors)
} finally {
  await live.close()
}
console.log('\n' + pass + ' checks passed' + (failures.length > 0 ? ', ' + failures.length + ' FAILED' : ''))
process.exit(failures.length > 0 ? 1 : 0)

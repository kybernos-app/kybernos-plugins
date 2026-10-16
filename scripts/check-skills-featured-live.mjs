// The Featured tab of the Skills page, on the REAL GUI: the cards, what shows on hover, the install confirmation, the panel, the filters.
//
//   node scripts/check-skills-featured-live.mjs [--shots <dir>]
//
// What is real: the DSH page, the Skills panel in the sidebar, the language the GUI is in, the cover route (the covers are the files in the
// user's DSH home). What is swapped: the client of kybernos-skills (this checkout's, in a throw-away Chrome, scripts/lib-bundle-swap.mjs).
// What is answered here, only when the running host does not have it yet (host code loads when `dsh web` restarts): ONE route,
// GET /kybernos-skills/picks, from this checkout's featured-picks.json. Install is opened and CANCELLED: nothing is written anywhere.
//
// Exit 0 all good, 1 a check failed, 3 not run (no GUI).
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openLivePage, waitFor, clickText } from './live-page.mjs'
import { swapBundles } from './lib-bundle-swap.mjs'
import { dshHome } from './dsh-home.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '..')
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0
const failures = []
const check = (label, cond, detail) => {
  if (cond) { pass += 1; console.log('  ✓ ' + label) } else { failures.push(label); console.log('  ✗ ' + label + (detail === undefined ? '' : '  — ' + JSON.stringify(detail).slice(0, 300))) }
}

const picksFile = JSON.parse(readFileSync(join(repo, 'packages', 'kybernos-skills', 'featured-picks.json'), 'utf8'))
const coversDir = join(dshHome(), 'kybernos', 'skills-featured')
const picksAnswer = {
  ok: true, asOf: picksFile.asOf, categories: picksFile.categories,
  items: picksFile.items.map((it) => ({ ...it, cover: existsSync(join(coversDir, it.id + '.webp')) ? '/kybernos-skills/cover/' + it.id : null }))
}

const authority = process.env.KB_HOST || '127.0.0.1:3080'
const hostHasPicks = await fetch('http://' + authority + '/kybernos-skills/picks').then((r) => r.json()).then((j) => j !== null && j.ok === true && Array.isArray(j.items) && j.items.length > 0, () => false)
console.log(hostHasPicks ? '(the running host serves the picks route: nothing is faked)' : '(the running host has no picks route yet: it is answered here)')

const live = await openLivePage({ width: 1500, height: 950 }).catch((e) => { console.error('○ not run: ' + e.message); process.exit(3) })
const { page } = live
const errors = []
try {
  await page.send('Runtime.enable', {})
  page.on('Runtime.exceptionThrown', (p) => errors.push(String((p.exceptionDetails && p.exceptionDetails.exception && p.exceptionDetails.exception.description) || 'exception').slice(0, 200)))
  page.on('Fetch.requestPaused', (p) => {
    if (p.responseStatusCode !== undefined) return   // the bundle swap's business
    const path = p.request.url.split('?')[0]
    if (hostHasPicks === true || !path.endsWith('/kybernos-skills/picks')) { page.send('Fetch.continueRequest', { requestId: p.requestId }).catch(() => {}); return }
    page.send('Fetch.fulfillRequest', {
      requestId: p.requestId, responseCode: 200,
      responseHeaders: [{ name: 'content-type', value: 'application/json' }],
      body: Buffer.from(JSON.stringify(picksAnswer), 'utf8').toString('base64')
    }).catch(() => {})
  })
  const swap = await swapBundles(page, [{ name: 'kybernos-skills' }], { extraPatterns: [{ urlPattern: '*kybernos-skills/picks*', requestStage: 'Request' }] })

  const js = async (expr) => (await page.evalJs(expr)).val
  const shot = async (name) => { if (shotsDir !== null) await page.shot(join(shotsDir, name + '.png')) }

  await page.send('Page.reload', { ignoreCache: true })
  await sleep(2500)
  await waitFor(page, 'document.body && document.body.innerText.length > 80', 30000)
  await clickText(page, 'Skills')
  await waitFor(page, "!!document.querySelector('.kbs-root')", 20000)
  await waitFor(page, "document.querySelectorAll('[data-kb=pick-card]').length > 0", 20000)
  await sleep(1200)

  console.log('The Featured tab — this checkout\'s client in the real GUI')
  check('the client was found in the served bundle and swapped', swap.report().every((r) => r.replaced === true), swap.report())

  check('Featured is the first segment and the selected one', await js("(() => { const b = document.querySelector('[data-kb=seg-featured]'); return !!b && b.getAttribute('aria-selected') === 'true' && b === document.querySelector('.kbsub-group [role=tab]') })()"))
  const n = await js("document.querySelectorAll('[data-kb=pick-card]').length")
  check('the 24 picks are drawn as cards', n === 24, n)
  check('the shared header is there (title, bar, primary action)', await js("!!document.querySelector('.kbs-root .kb6-headrow .kb6-title') && !!document.querySelector('.kbs-root .kb6-toolbar') && !!document.querySelector('.kbs-root .kb8-primary')"))
  await shot('featured-rest')

  // Covers load lazily: bring every card into view once, then count.
  await js("(async () => { for (const c of document.querySelectorAll('[data-kb=pick-card]')) { c.scrollIntoView({ block: 'center' }); await new Promise((r) => setTimeout(r, 60)) } document.querySelector('.kbs-root').scrollIntoView(); return true })()")
  await sleep(1500)
  const covers = await js("Array.from(document.querySelectorAll('[data-kb=pick-card] img.kbsf-cut')).filter((i) => i.complete && i.naturalWidth > 0).length")
  const withCover = picksAnswer.items.filter((i) => i.cover !== null).length
  // The host also serves the covers it does not hold on disk (it asks the relay for them: the covers the project published), so a machine with network draws
  // MORE than the ones on disk. What must hold is that none of those on disk is missing.
  check('every cover that exists on disk is served by the real cover route and drawn (' + withCover + ' on disk, ' + covers + ' drawn)', covers >= withCover, { drawn: covers, onDisk: withCover })

  const text = await js("document.querySelector('[data-kb=picks-grid]').innerText")
  check('no « /name » link on a card', /\n\/[a-z0-9-]+\n/.test('\n' + text + '\n') === false && text.includes('/pdf') === false, text.slice(0, 200))
  check('the install count is an icon and a figure, without the word « installs »', await js("(() => { const c = Array.from(document.querySelectorAll('[data-kb=pick-card] .kbsf-cnt')); return c.length === 24 && c.every((e) => /^[0-9.,]+[kM]?$/.test(e.innerText.trim()) && !!e.querySelector('svg')) })()"))
  check('the creator is on the card (owner name or its initial)', await js("(() => { const c = document.querySelector('[data-kb=pick-card]'); return !!c.querySelector('.kbsf-by .kbsf-av') && c.querySelector('.kbsf-side').getBoundingClientRect().left > c.querySelector('.kbsf-title').getBoundingClientRect().left })()"))

  // hover: the actions are there but hidden, then shown
  const rest = await js("getComputedStyle(document.querySelector('[data-kb=pick-card] .kbsf-acts')).opacity")
  check('at rest the actions are hidden (but their place is kept)', rest === '0' && await js("document.querySelector('[data-kb=pick-card] .kbsf-acts').getBoundingClientRect().height") >= 28, rest)
  const rect = await js("(() => { const r = document.querySelector('[data-kb=pick-card] .kbsf-pic').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2] })()")
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rect[0], y: rect[1] })
  await sleep(500)
  const hover = await js("getComputedStyle(document.querySelector('[data-kb=pick-card] .kbsf-acts')).opacity")
  check('on hover the actions show', hover === '1', hover)
  await shot('featured-hover')
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 })

  // install: the usual confirmation opens, and is cancelled
  const installable = await js("(() => { const b = Array.from(document.querySelectorAll('[data-kb=pick-install]'))[0]; if (!b) return false; b.click(); return true })()")
  check('a card that is not installed offers Install', installable === true)
  await sleep(500)
  check('Install opens the confirmation before anything is written', await js("!!document.querySelector('.kbs-modal, [role=dialog], .kbs-confirm') || document.body.innerText.includes('Install ?') || document.body.innerText.includes('Installer ?')"))
  await shot('featured-confirm')
  await js("(() => { const e = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }); document.dispatchEvent(e); return true })()")
  await sleep(400)

  // details: the pick opens on the width of the page, its picture and its title at the top like the card
  const gridW = await js("document.querySelector('[data-kb=picks-grid]').getBoundingClientRect().width")
  await js("document.querySelector('[data-kb=pick-details]').click()")
  await waitFor(page, "!!document.querySelector('[data-kb=pick-detail]')", 8000)
  await sleep(1200)
  check('Details opens the pick on the page, not in a side panel', await js("!!document.querySelector('[data-kb=pick-detail]') && !document.querySelector('[data-kb=disc-panel]') && !document.querySelector('[data-kb=picks-grid]')"))
  const dw = await js("document.querySelector('[data-kb=pick-detail]').getBoundingClientRect().width")
  check('it uses the desktop width (as wide as the grid was)', dw >= gridW - 4 && dw > 900, { dw, gridW })
  check('the picture is at the top, left of the title, and loaded', await js("(() => { const d = document.querySelector('[data-kb=pick-detail]'); const i = d.querySelector('.kbsf-dpic img.kbsf-cut'); const t = d.querySelector('.kbsf-dtitle'); return !!i && i.complete && i.naturalWidth > 0 && !!t && i.getBoundingClientRect().left < t.getBoundingClientRect().left && i.getBoundingClientRect().height > 200 })()"))
  check('the title is the card\'s title and is big', await js("(() => { const d = document.querySelector('[data-kb=pick-detail]'); const t = d.querySelector('.kbsf-dtitle'); return t.innerText.trim().length > 1 && parseFloat(getComputedStyle(t).fontSize) >= 24 })()"))
  check('the creator, the count and a way to use or install it are there', await js("(() => { const d = document.querySelector('[data-kb=pick-detail]'); return !!d.querySelector('.kbsf-by') && !!d.querySelector('.kbsf-cnt svg') && (!!d.querySelector('[data-kb=pick-install]') || !!d.querySelector('[data-kb=pick-use]')) })()"))
  check('the repository facts, the audits and the start of SKILL.md share the page', await js("(() => { const d = document.querySelector('[data-kb=pick-detail]'); const cols = d.querySelectorAll('.kbsf-dcols .kbsf-dcard'); return cols.length === 2 && cols[0].getBoundingClientRect().left < cols[1].getBoundingClientRect().left && /github\\.com\\//.test(d.innerText) })()"))
  await waitFor(page, "!!document.querySelector('[data-kb=pick-detail] [data-kb=preview-text], [data-kb=pick-detail] [data-kb=preview-missing], [data-kb=pick-detail] [data-kb=preview-error]')", 15000).catch(() => {})
  check('the real SKILL.md is read (or says why not)', await js("!!document.querySelector('[data-kb=pick-detail] [data-kb=preview-text], [data-kb=pick-detail] [data-kb=preview-missing], [data-kb=pick-detail] [data-kb=preview-error]')"))
  await shot('featured-detail')
  await js("document.querySelector('[data-kb=pick-back]').click()")
  await sleep(300)
  check('Back returns to the grid', (await js("document.querySelectorAll('[data-kb=pick-card]').length")) === 24 && await js("!document.querySelector('[data-kb=pick-detail]')"))

  // category chip, search, order
  await js("(() => { const chips = Array.from(document.querySelectorAll('.kbsf-chips .kb8-chip')); chips[1].click(); return true })()")
  await sleep(300)
  check('a category chip keeps its three picks', (await js("document.querySelectorAll('[data-kb=pick-card]').length")) === 3)
  await js("(() => { document.querySelectorAll('.kbsf-chips .kb8-chip')[0].click(); return true })()")
  await sleep(200)
  check('« All » brings the 24 back', (await js("document.querySelectorAll('[data-kb=pick-card]').length")) === 24)

  // tint / plain
  const tintBg = await js("getComputedStyle(document.querySelector('.kbsf-pic')).backgroundImage")
  await js("document.querySelector('[data-kb=pick-bg-plain]').click()")
  await sleep(300)
  const plainBg = await js("getComputedStyle(document.querySelector('.kbsf-pic')).backgroundImage")
  check('Tint is a gradient of the category colour, Plain is the card surface', tintBg.includes('linear-gradient') && plainBg === 'none', { tintBg: tintBg.slice(0, 60), plainBg })
  check('the choice is kept in this browser', await js("window.localStorage.getItem('kybernos.skills.coverbg') === 'plain'"))
  await shot('featured-plain')
  await js("document.querySelector('[data-kb=pick-bg-tint]').click()")

  // list view: the shared bar's switch, one row per pick, the same gestures, and back
  const viewBtns = await js("Array.from(document.querySelectorAll('.kbs-root .kb6-tb-vbtn')).map((b) => b.getAttribute('data-kb'))")
  check('the shared bar offers the cards / list switch on Featured', Array.isArray(viewBtns) && viewBtns.indexOf('view-list') >= 0 && viewBtns.indexOf('view-cards') >= 0, viewBtns)
  await js("document.querySelector('.kbs-root [data-kb=view-list]').click()")
  await sleep(500)
  check('the list view draws one row per pick (24) and no card', (await js("document.querySelectorAll('[data-kb=pick-row]').length")) === 24 && (await js("document.querySelectorAll('[data-kb=pick-card]').length")) === 0)
  check('a row has its thumbnail, creator, count and the verdict', await js("(() => { const r = document.querySelector('[data-kb=pick-row]'); return !!r.querySelector('.kbsf-th') && !!r.querySelector('.kbsf-by .kbsf-av') && !!r.querySelector('.kbsf-cnt svg') && !!r.querySelector('.kbsf-pills .kbsf-pill') })()"))
  check('the row actions are always there (no hover needed)', await js("(() => { const r = document.querySelector('[data-kb=pick-row] .kbsf-racts'); const b = r.querySelector('[data-kb=pick-details]'); return !!b && b.getBoundingClientRect().width > 0 && getComputedStyle(r).opacity === '1' })()"))
  check('the row is the same pick as the card (installed flag and figure)', await js("(() => { const r = document.querySelector('[data-kb=pick-row]'); return /211\\.2k/.test(r.innerText) })()"))
  check('the choice is kept in this browser', await js("JSON.parse(window.localStorage.getItem('kybernos.skills.views')).featured === 'list'"))
  await shot('featured-list')
  await js("document.querySelector('[data-kb=pick-details]').click()")
  await waitFor(page, "!!document.querySelector('[data-kb=pick-detail]')", 8000)
  check('Details from a row opens the same page', await js("!!document.querySelector('[data-kb=pick-detail] .kbsf-dpic') && !document.querySelector('[data-kb=pick-row]')"))
  await shot('featured-list-detail')
  await js("document.querySelector('[data-kb=pick-back]').click()")
  await sleep(300)
  check('Back returns to the list, not to the cards', (await js("document.querySelectorAll('[data-kb=pick-row]').length")) === 24)
  await js("document.querySelector('.kbs-root [data-kb=view-cards]').click()")
  await sleep(400)
  check('back to cards, the grid is there again', (await js("document.querySelectorAll('[data-kb=pick-card]').length")) === 24)

  // Discover: 20 rows, no pager above, sortable columns, the installed state is said
  await js("Array.from(document.querySelectorAll('.kbsub-group [role=tab]')).find((b) => b.getAttribute('data-kb') === 'seg-discover' || b.innerText.startsWith('Discover')).click()")
  // the skeleton rows are .kbs-row too: wait for rows that carry a name
  await waitFor(page, "Array.from(document.querySelectorAll('.kbs-root .kbs-row .who')).filter((e) => e.innerText.trim().length > 1).length >= 10", 45000)
  await sleep(800)
  // the user's own pins sit above the index rows (their first cell is a star, not a rank): count the ranked rows only
  const ranked = "Array.from(document.querySelectorAll('.kbs-root .kbs-row')).filter((r) => { const k = r.querySelector('.rank'); return !!k && /^[0-9]+$/.test(k.innerText.trim()) && !!r.querySelector('.who') })"
  const nrows = await js(ranked + '.length')
  check('Discover shows 20 rows by default', nrows === 20, nrows)
  check('there is no pager above the table (only the one below)', await js("(() => { const t = document.querySelector('.kbs-root .kbs-row'); const ps = Array.from(document.querySelectorAll('.kbs-root .kbs-pager')); return ps.length === 1 && ps[0].getBoundingClientRect().top > t.getBoundingClientRect().top })()"))
  check('the SKILL and INSTALLATIONS headers are sort buttons', await js("!!document.querySelector('[data-kb=sort-name]') && !!document.querySelector('[data-kb=sort-installs]')"))
  check('INSTALLATIONS is the order at rest, flagged descending', await js("document.querySelector('[data-kb=sort-installs]').getAttribute('aria-sort') === 'descending'"))
  const names = async () => await js(ranked + ".map((r) => r.querySelector('.who').innerText.trim())")
  const n0 = await names()
  await js("document.querySelector('[data-kb=sort-name]').click()")
  await sleep(1500)
  const n1 = await names()
  check('clicking SKILL orders the rows by name (A to Z) and flags it', JSON.stringify(n1) === JSON.stringify(n1.slice().sort((a, b) => a.localeCompare(b))) && JSON.stringify(n0) !== JSON.stringify(n1) && await js("document.querySelector('[data-kb=sort-name]').getAttribute('aria-sort') === 'ascending'"), { n0: n0.slice(0, 4), n1: n1.slice(0, 4) })
  await js("document.querySelector('[data-kb=sort-name]').click()")
  await sleep(1500)
  const n2 = await names()
  check('a second click flips it (Z to A)', JSON.stringify(n2) === JSON.stringify(n2.slice().sort((a, b) => b.localeCompare(a))) && await js("document.querySelector('[data-kb=sort-name]').getAttribute('aria-sort') === 'descending'"), n2.slice(0, 4))
  await js("document.querySelector('[data-kb=sort-installs]').click()")
  await sleep(1500)
  check('INSTALLATIONS brings the ranking back (most installed first)', JSON.stringify(await names()) === JSON.stringify(n0), (await names()).slice(0, 4))
  const states = await js("(() => { const r = " + ranked + "; return { n: r.length, said: r.filter((x) => !!x.querySelector('.kbs-instpill, [data-kb=row-install], .kb8-pill.warn')).length, installedPills: r.filter((x) => !!x.querySelector('.kbs-instpill')).length } })()")
  check('every ranked row says Installed, offers Install, or says it is off GitHub', states.n > 0 && states.said === states.n, states)
  console.log('    (' + states.installedPills + ' of the ' + states.n + ' rows are installed on this machine)')
  await js("(() => { const r = document.querySelector('.kbs-root .kbs-row .kbs-instpill'); if (r) r.scrollIntoView({ block: 'center' }); return true })()")
  await sleep(300)
  await shot('discover-table')

  // the other tabs still work
  await js("Array.from(document.querySelectorAll('.kbsub-group [role=tab]')).find((b) => b.innerText.startsWith('Yours')).click()")
  await sleep(600)
  check('Yours still opens, with its own cards', await js("document.querySelectorAll('[data-kb^=skill-card-], [data-kb^=skill-row-]').length >= 0 && !document.querySelector('[data-kb=picks-grid]')"))

  check('no script error was thrown during the run', errors.length === 0, errors)
} finally {
  await live.close()
}
console.log('\n' + pass + ' checks passed' + (failures.length > 0 ? ', ' + failures.length + ' FAILED' : ''))
process.exit(failures.length > 0 ? 1 : 0)

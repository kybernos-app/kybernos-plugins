// Dashboards and Apps in Creations, on a real GUI. READ-ONLY (it clicks the menu, the tiles and the cards; it writes nothing): safe on the real :3080.
//
// Plays: the menu has no Dashboards and no Apps row; Creations draws a tile for each, with the count its source reports; selecting a tile draws one card per item and the way into
// the plugin's own page; a card opens that item in the plugin's page (the page is then the selected one, the Creations row stays lit); the way in opens the page itself.
//
// Named check-* on purpose: it needs a running DSH and Chrome, so CI must not run it.
//   node scripts/check-creation-sources-live.mjs     (KB_HOST=127.0.0.1:3080 by default; KB_SHOT_DIR=/some/dir keeps screenshots)
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openLivePage, waitFor } from './live-page.mjs'

const authority = process.env.KB_HOST || '127.0.0.1:3080'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let fails = 0
const check = (label, ok, detail) => { if (!ok) fails += 1; console.log((ok ? 'ok   ' : 'FAIL ') + label + (detail !== undefined && !ok ? ' | ' + detail : '')) }
const shotDir = process.env.KB_SHOT_DIR || join(tmpdir(), 'kb-creation-sources-live')
mkdirSync(shotDir, { recursive: true })

const live = await openLivePage({ width: 1360, height: 1000 })
const { page } = live
const q = async (js, ms = 20000) => { const r = await page.evalJs(js, ms); return r.err ? { __err: r.err } : r.val }
const clickMenu = (name) => q(`(() => { const e = [...document.querySelectorAll('.kb4-menu .kb4-item')].find((x) => x.textContent.trim().startsWith(${JSON.stringify(name)})); if (e) e.click(); return !!e })()`)
const tile = (name) => `[...document.querySelectorAll('[data-kb="type-tiles"] .kb-type')].find((x) => (x.querySelector('.kb-type-lab') || {}).textContent === ${JSON.stringify(name)})`
const tileCount = (name) => q(`(() => { const t = ${tile(name)}; return t ? Number((t.querySelector('.kb-type-cnt') || {}).textContent) : null })()`)
const pageTitle = () => q(`(() => { const t = document.querySelector('.kb6-title'); return t ? t.textContent.trim() : null })()`)
try {
  await page.send('Page.navigate', { url: 'http://' + authority + '/' })
  await waitFor(page, 'document.body && document.body.innerText.length > 40', 30000)
  await sleep(9000)
  const rows = await q(`[...document.querySelectorAll('.kb4-menu .kb4-item')].map((x) => x.textContent.trim().replace(/[0-9+]+$/, ''))`)
  check('the menu has no Dashboards row and no Apps row', Array.isArray(rows) && rows.indexOf('Dashboards') < 0 && rows.indexOf('Apps') < 0 && rows.indexOf('Creations') >= 0, JSON.stringify(rows))

  await clickMenu('Creations')
  await sleep(4000)
  const dashCount = await tileCount('Dashboards')
  const appsCount = await tileCount('Apps')
  check('Creations draws a tile for the Dashboards and one for the Apps, with a count', dashCount !== null && appsCount !== null, JSON.stringify({ dashCount, appsCount }))
  const real = await q(`Promise.all([fetch('/kybernos-dashboards/list').then((r) => r.json()), fetch('/kybernos-db/state').then((r) => r.json())]).then(([d, a]) => ({ dashboards: (d.dashboards || []).length, apps: (a.dbs || []).length }))`)
  check('the counts are what the two plugins report', real && real.dashboards === dashCount && real.apps === appsCount, JSON.stringify({ real, dashCount, appsCount }))
  await page.shot(join(shotDir, 'creations-tiles.png'))

  for (const [name, count] of [['Dashboards', dashCount], ['Apps', appsCount]]) {
    const id = name.toLowerCase()
    await q(`${tile(name)}.click()`)
    await sleep(1200)
    const cards = await q(`document.querySelectorAll('[data-kb="src-card"][data-src="${id}"]').length`)
    const home = await q(`(() => { const b = document.querySelector('[data-kb="src-home"][data-src="${id}"]'); return b ? b.textContent : null })()`)
    check(name + ': the tile shows one card per item and the way into the page', cards === Math.min(count, 200) && typeof home === 'string' && /Open the .* page/.test(home), JSON.stringify({ cards, count, home }))
    await page.shot(join(shotDir, 'creations-' + id + '.png'))
    if (cards > 0) {
      await q(`document.querySelector('[data-kb="src-card"][data-src="${id}"] [data-kb="src-prev"]').click()`)
      await sleep(3500)
      const t = await pageTitle()
      const lit = await q(`(() => { const e = document.querySelector('.kb4-menu .kb4-item.on'); return e ? e.textContent.trim().replace(/[0-9+]+$/, '') : null })()`)
      check(name + ': a card opens the plugin\'s own page', typeof t === 'string' && t.indexOf(name) >= 0, JSON.stringify(t))
      check(name + ': the Creations row is the lit one while that page is open', lit === 'Creations', JSON.stringify(lit))
      await page.shot(join(shotDir, 'opened-' + id + '.png'))
      await clickMenu('Creations')
      await sleep(3500)
    }
    // the way in from the tile (the selection is kept when the page comes back)
    await q(`document.querySelector('[data-kb="src-home"][data-src="${id}"]').click()`)
    await sleep(3000)
    const t2 = await pageTitle()
    check(name + ': the way in opens the plugin\'s page', typeof t2 === 'string' && t2.indexOf(name) >= 0, JSON.stringify(t2))
    await clickMenu('Creations')
    await sleep(3000)
    await q(`${tile(name)}.click()`)
    await sleep(800)
  }
} catch (e) {
  fails += 1
  console.log('ERROR', String(e && e.message ? e.message : e))
} finally {
  await live.close()
}
console.log(fails === 0 ? '\nall ok (screenshots in ' + shotDir + ')' : '\n' + fails + ' failure(s)')
process.exit(fails === 0 ? 0 : 1)

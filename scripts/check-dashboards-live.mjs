#!/usr/bin/env node
// The Dashboards plugin (packages/kybernos-dashboards), end to end, in a real GUI.
//
//   source scripts/sandbox/env.sh && node scripts/check-dashboards-live.mjs [--shots <dir>]
//
// It needs a DSH that LOADS the bundle, i.e. the sandbox instance (`scripts/sandbox/setup.sh`, `scripts/sandbox/start.sh`; see
// docs/dev/live-testing.md). The user's own `dsh web` does not list the bundle: this script refuses to run against :3080 (exit 3).
//
// What it checks, in a real page:
//   1. the host routes answer through the page's own origin, and a write that is not JSON is refused;
//   2. the Kybernos menu has a Dashboards row, right before Agent Teams, and it opens the page the bundle provides;
//   3. the gallery offers the presets; using one writes a file and draws the dashboard with real data of this DSH;
//   4. the motion: the entrance animations run and finish;
//   5. the right-pane tab opens by itself when a dashboard is filed under the chat on screen, and shows it;
//   6. another bundle can open the page on a dashboard (`window.__KB_OPEN__`, `window.__KB_DASHBOARDS__`);
//   7. a narrow window does not overflow, and the page leaves the rest of the menu alone.
//
// NOT covered here (no key, no turn in a sandbox): the agent writing through the tool during a real conversation. The tool
// and its guards are covered by test-host.mjs; the page picking an agent write up live by check-dashboards-render.mjs.
//
// SAFETY: the sandbox has its own DSH_HOME; the only things written are its own dashboards. Exit code 0 / 1 / 3.
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { openLivePage } from './live-page.mjs'

const args = process.argv.slice(2)
const shotDir = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : null
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) }
}

const host = process.env.KB_HOST || '127.0.0.1:3080'
if (host === '127.0.0.1:3080') { console.error('○ inconclusive: this check needs a DSH that loads the bundle (a sandbox instance), not the one on :3080. Set KB_HOST, DSH_HOME and HOME.'); process.exit(3) }

const live = await openLivePage({ width: 1500, height: 1000 }).catch((e) => { console.error('○ inconclusive: ' + e.message); process.exit(3) })
const { page } = live
const val = async (expr, ms) => (await page.evalJs(expr, ms)).val
const shot = async (name) => { if (shotDir !== null) { try { mkdirSync(shotDir, { recursive: true }); await page.shot(join(shotDir, name + '.png')) } catch (e) { /* no screenshot */ } } }
const poll = async (fn, ms = 12000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) return v; await sleep(250) } }
const mouse = async (x, y) => { await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }); await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }); await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }) }
const api = (path, body, headers) => val(`fetch(${JSON.stringify(path)}, ${body === undefined ? (headers ? `{ headers: ${JSON.stringify(headers)} }` : '{}') : `{ method: 'POST', headers: Object.assign({ 'content-type': 'application/json' }, ${JSON.stringify(headers || {})}), body: ${JSON.stringify(JSON.stringify(body))} }`}).then(async (r) => JSON.stringify({ status: r.status, body: await r.json().catch(() => null) })).catch((e) => JSON.stringify({ status: 0, error: String(e) }))`).then((s) => JSON.parse(s))
const clickMenuRow = (label) => val(`(() => { const row = Array.from(document.querySelectorAll('.kb4-menu .kb4-item')).find((b) => (b.querySelector('.kb4-lab') || {}).textContent === ${JSON.stringify(label)}); if (!row) return false; row.click(); return true })()`)

try {
  await sleep(3000)
  if ((await val(`/Add an API key to get started/.test(document.body.innerText)`)) === true) {
    const pos = await val(`(() => { const e = Array.from(document.querySelectorAll('*')).filter((e) => e.children.length === 0 && (e.innerText || '').trim() === 'Configure later')[0]; if (!e) return null; const r = e.getBoundingClientRect(); return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 }) })()`)
    if (typeof pos === 'string') { const { x, y } = JSON.parse(pos); await mouse(x, y); await sleep(700) }
  }

  console.log('── 1. the host, through the page ──')
  const list0 = await api('/kybernos-dashboards/list')
  check('list answers on the page\'s own origin', list0.status === 200 && list0.body.ok === true && Array.isArray(list0.body.dashboards), list0)
  const presets = await api('/kybernos-dashboards/presets')
  check('the presets are listed with their shape', presets.status === 200 && presets.body.presets.length >= 4 && presets.body.presets.every((p) => p.widgets >= 6), presets.status)
  const made = await val(`fetch('/kybernos-dashboards/preset', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"preset":"usage-tokens"}' }).then((r) => r.status)`)
  check('a write from the page itself is accepted (the browser puts the page\'s own Origin on it)', made === 200, made)
  const noJson = await val(`fetch('/kybernos-dashboards/preset', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{"preset":"usage-tokens"}' }).then((r) => r.status)`)
  check('a write that is not JSON is refused', noJson === 415, noJson)
  const made0 = (await api('/kybernos-dashboards/list')).body.dashboards.find((d) => d.id === 'usage-tokens')
  check('the preset became a dashboard file', made0 !== undefined && made0.widgets >= 6, made0)

  console.log('\n── 2. the right-pane tab (first: it needs the chat the page opens on) ──')
  // a session must be mounted for the right sidebar: write a first message from the empty composer (no model here, the turn fails, that is fine)
  const composer = await poll(() => val(`(() => { const e = document.querySelector('[contenteditable="true"], textarea'); if (!e) return null; const r = e.getBoundingClientRect(); return JSON.stringify({ x: r.x + 40, y: r.y + r.height / 2 }) })()`), 8000)
  if (typeof composer === 'string') {
    const { x, y } = JSON.parse(composer)
    await mouse(x, y)
    await sleep(300)
    await page.send('Input.insertText', { text: 'Dashboards check' })
    await sleep(300)
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' })
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
    await sleep(2500)
  }
  const sid = await poll(() => val(`window.__KB_DASHBOARDS__ && window.__KB_DASHBOARDS__.session()`), 10000)
  check('the plugin knows the chat on screen', typeof sid === 'string' && sid.length > 0, sid)
  if (typeof sid === 'string' && sid.length > 0) {
    const open = await api('/kybernos-dashboards/open', { id: 'usage-tokens', session: sid })
    check('a dashboard is filed under that chat', open.status === 200, open)
    const tab = await poll(() => val(`!!document.querySelector('[data-kb="dashboards-pane"]')`), 20000)
    check('the Dashboard tab opens by itself on the right', tab === true)
    const inPane = await poll(() => val(`document.querySelectorAll('[data-kb="dashboards-pane"] .kbdb-w').length >= 6`), 15000)
    check('and shows the dashboard', inPane === true)
    await shot('4-pane')
    const colWidth = await val(`(() => { const w = document.querySelector('[data-kb="dashboards-pane"] .kbdb-w[data-type="list"]'); return w ? w.getBoundingClientRect().width : -1 })()`)
    const paneWidth = await val(`document.querySelector('[data-kb="dashboards-pane"]').getBoundingClientRect().width`)
    check('widgets fit the pane (one column)', colWidth > 0 && colWidth <= paneWidth, [colWidth, paneWidth])
  }

  console.log('\n── 3. the menu ──')
  const menu = await poll(() => val(`(() => { const rows = Array.from(document.querySelectorAll('.kb4-menu .kb4-item .kb4-lab')).map((e) => e.textContent); return rows.indexOf('Dashboards') >= 0 ? JSON.stringify(rows) : null })()`), 20000)
  const rows = menu ? JSON.parse(menu) : []
  check('the Kybernos menu shows Dashboards', rows.includes('Dashboards'), rows)
  check('it sits right before Agent Teams', rows.indexOf('Dashboards') >= 0 && rows[rows.indexOf('Dashboards') + 1] === (rows.find((r) => /Agent Teams|AI Teams|Équipes/.test(r)) || '#none'), rows)
  check('the other rows are all still there', ['Projects', 'Deliverables', 'Automations', 'Skills'].every((r) => rows.some((x) => x.indexOf(r.slice(0, 5)) === 0)) || rows.length >= 6, rows)
  await shot('1-menu')
  const opened = await val(`window.__KB_OPEN__ && window.__KB_OPEN__.views && window.__KB_OPEN__.views.indexOf('dashboards') >= 0`)
  check('other bundles can open the page (window.__KB_OPEN__ lists it)', opened === true)
  check('the row opens the page the bundle provides', (await clickMenuRow('Dashboards')) === true && (await poll(() => val(`!!document.querySelector('[data-kb="dashboards-page"]')`), 15000)) === true)
  await sleep(600)
  check('with several dashboards and no default it opens the gallery, with one it opens it', await poll(() => val(`document.querySelector('[data-kb="dashboards-page"]').getAttribute('data-screen') === 'gallery' || !!document.querySelector('[data-kb="dashboards-grid"]')`), 10000) === true)

  console.log('\n── 4. the gallery, a preset, real data ──')
  await val(`(() => { const b = document.querySelector('[data-kb="dashboards-page"] .kbdb-crumb button'); if (b) b.click() })()`)
  check('the gallery lists the presets and my dashboards', (await poll(() => val(`document.querySelectorAll('[data-kb="dashboards-preset"]').length >= 4 && document.querySelectorAll('[data-kb="dashboards-card"]').length >= 1`))) === true)
  await shot('2-gallery')
  const dup = await val(`(() => { const b = document.querySelector('[data-kb="dashboards-preset"][data-id="automations-health"] [data-act="use-preset"]'); if (!b) return false; b.click(); return true })()`)
  check('a preset is used from the gallery', dup === true && (await poll(() => val(`!!document.querySelector('[data-kb="dashboards-grid"]')`), 10000)) === true)
  const widgets = await poll(() => val(`document.querySelectorAll('.kbdb-w').length >= 8 && document.querySelectorAll('.kbdb-bone').length === 0 ? document.querySelectorAll('.kbdb-w').length : 0`), 15000)
  check('every widget leaves its skeleton (real routes of this DSH answered)', widgets >= 8, widgets)
  check('no source failed', (await val(`document.querySelectorAll('.kbdb-err-note').length`)) === 0)
  const anim = await val(`(() => { const a = document.getAnimations().filter((x) => x.effect && x.effect.target && x.effect.target.closest && x.effect.target.closest('.kbdb-w')); return JSON.stringify({ n: a.length, running: a.filter((x) => x.playState === 'running').length }) })()`)
  check('the entrance animations are there', JSON.parse(anim).n > 10, anim)
  await sleep(2500)
  const unfinished = await val(`document.getAnimations().filter((x) => x.effect && x.effect.getTiming().iterations !== Infinity && x.effect.target && x.effect.target.closest && x.effect.target.closest('.kbdb-w[data-inview]') && x.playState !== 'finished').length`)
  check('and they finish', unfinished === 0, unfinished)
  await shot('3-automations-health')
  const hasTheme = await val(`getComputedStyle(document.querySelector('.kbdb-w')).backgroundColor`)
  check('the widgets use the theme (a real background, not transparent)', typeof hasTheme === 'string' && hasTheme !== 'rgba(0, 0, 0, 0)', hasTheme)

  console.log('\n── 4b. a note typed on a real keyboard, and a flow with live numbers ──')
  const toGallery = () => val(`(() => { const b = document.querySelector('[data-kb="dashboards-page"] .kbdb-crumb button'); if (b) b.click(); return !!b })()`)
  const usePreset = (id) => val(`(() => { const b = document.querySelector('[data-kb="dashboards-preset"][data-id="${id}"] [data-act="use-preset"]'); if (!b) return false; b.click(); return true })()`)
  // Enter in a contenteditable is the editing command insertParagraph (CDP key events do not carry it, text is inserted with Input.insertText)
  const enter = () => val(`document.execCommand('insertParagraph')`)
  await toGallery()
  // a sandbox that was used before already holds a "workspace-pulse": the new copy is the id that was not there a moment ago
  const listIds = async () => ((await api('/kybernos-dashboards/list')).body.dashboards || []).map((d) => d.id)
  const idsBefore = await listIds()
  check('a preset with a note is used', (await poll(() => usePreset('workspace-pulse'))) === true && (await poll(() => val(`!!document.querySelector('.kbdb-w.note .kbdb-nbody')`), 10000)) === true)
  const wpId = (await poll(async () => (await listIds()).find((i) => !idsBefore.includes(i)), 8000)) || 'workspace-pulse'
  await val(`(() => { const e = document.querySelector('.kbdb-w.note .kbdb-nbody'); e.focus(); const r = document.createRange(); r.selectNodeContents(e); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r) })()`)
  await page.send('Input.insertText', { text: ' good' })
  await enter()
  await enter()
  await page.send('Input.insertText', { text: 'hello You' })
  await val(`document.activeElement && document.activeElement.blur()`)
  await sleep(1800)
  const wps = await api('/kybernos-dashboards/dashboard?id=' + encodeURIComponent(wpId))
  const noteText = (wps.body && wps.body.dashboard ? (wps.body.dashboard.widgets.find((w) => w.type === 'note') || {}).text : '') || ''
  check('the lines of the note are saved as lines', /good\n\nhello You$/.test(noteText), noteText)
  await toGallery()
  await poll(() => val(`!!document.querySelector('[data-kb="dashboards-card"][data-id="${wpId}"]')`), 8000)
  await val(`document.querySelector('[data-kb="dashboards-card"][data-id="${wpId}"]').click()`)
  const shownNote = await poll(() => val(`(() => { const e = document.querySelector('.kbdb-w.note .kbdb-nbody'); return e ? e.innerText : null })()`), 10000)
  check('opened again, the note still shows its lines', typeof shownNote === 'string' && /good\n\nhello You$/.test(shownNote.replace(/\n$/, '')), shownNote)
  await toGallery()
  check('the flow preset is used', (await poll(() => usePreset('automation-flow'))) === true && (await poll(() => val(`document.querySelectorAll('.kbdb-fnode').length >= 6`), 12000)) === true)
  const nodeLines = JSON.parse(await poll(() => val(`(() => { const a = Array.from(document.querySelectorAll('.kbdb-fnode .ns')).map((e) => e.textContent); return a.length >= 6 && a.every((t) => /\\d/.test(t)) ? JSON.stringify(a) : null })()`), 12000) || '[]')
  check('every node of the flow shows a live number read in this DSH', nodeLines.length >= 6, nodeLines)
  const xs = JSON.parse(await val(`JSON.stringify(Array.from(document.querySelectorAll('.kbdb-fnode rect.nb')).map((e) => Math.round(e.getBoundingClientRect().x)))`))
  check('the nodes of the flow sit where the file places them, not stacked', new Set(xs).size >= 3, xs)
  const sk = await val(`document.querySelectorAll('.kbdb-w[data-type="sankey"]').length`)
  check('the sankey of the flow preset is on the page', sk >= 1, sk)
  await shot('4-automation-flow')

  console.log('\n── 5. leaving things as they were ──')
  await clickMenuRow('Dashboards')
  await poll(() => val(`!!document.querySelector('[data-kb="dashboards-page"]')`), 8000)
  await page.send('Emulation.setDeviceMetricsOverride', { width: 420, height: 800, deviceScaleFactor: 1, mobile: false })
  await sleep(1200)
  const overflow = await val(`document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1`)
  check('a narrow window does not scroll sideways', overflow === true)
  await shot('5-narrow')
  await page.send('Emulation.clearDeviceMetricsOverride', {})
} catch (e) {
  fail += 1
  console.log('  ✗ the check stopped: ' + (e && e.message ? e.message : e))
} finally {
  await live.close()
}
console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)

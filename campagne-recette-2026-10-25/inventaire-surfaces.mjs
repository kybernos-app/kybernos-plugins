// Wave 0 (rev 2): inventory of every reachable surface on the real GUI, one PNG each, READ-ONLY.
// Navigation uses the Kybernos sidebar row whose .kb4-lab text matches, then a settled heading.
import { mkdirSync, writeFileSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { openLivePage, openSettings, goToSettingsPage, waitFor } from '/Users/miled/kybernos-plugins/scripts/live-page.mjs'

const OUT = join(import.meta.dirname, 'captures')
mkdirSync(OUT, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const live = await openLivePage({ width: 1440, height: 900 }).catch((e) => { console.error('inconclusive: ' + e.message); process.exit(3) })
const page = live.page
const ev = async (js, ms = 15000) => { const r = await page.evalJs(js, ms); return r.err ? { __err: String(r.err) } : r.val }
const shot = async (name) => { const p = join(OUT, name + '.png'); await page.shot(p).catch(() => {}); return existsSync(p) ? statSync(p).size : 0 }
const inventory = []
const press = async (x, y) => { for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }) }
const esc = async () => { await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await sleep(500) }

// 0. boot sanity: console errors + network failures are collected below by the console listener
const consoleErrors = []
await page.send('Runtime.enable', {})
page.on('console', (m) => { if (m.type === 'error' || m.type === 'warning') consoleErrors.push(String(m.text).slice(0, 300)) })
page.on('apiError', (e) => consoleErrors.push('apiError ' + JSON.stringify(e).slice(0, 200)))

// 1. home / composer / sidebar
await sleep(3000)
const rows = await ev(`JSON.stringify([...document.querySelectorAll('.kb4-item')].map(e=>({lab:(e.querySelector('.kb4-lab')||{}).textContent||'', aria:e.getAttribute('aria-label')||'', h:Math.round(e.getBoundingClientRect().height)})))`)
inventory.push({ surface: 'accueil', rows, dom: await ev(`JSON.stringify({composer: !!document.querySelector('[contenteditable=true], textarea'), pinned: (document.body.innerText.match(/Pinned/)||[]).length, counters: (document.body.innerText.match(/\\d+\\+?\\n/g)||[]).slice(0,10)})`), shot: await shot('w0-accueil') })

// 2. Kybernos nav rows (only those that exist in the sidebar)
for (const t of ['Kaby', 'Workspaces', 'Creations', 'Automations', 'Skills', 'Connectors', 'Dashboards', 'Agent Teams']) {
  const before = await ev(`JSON.stringify([...document.querySelectorAll('h1,h2,[data-kb$="-page"]')].map(e=>e.getAttribute('data-kb')||e.innerText).slice(0,6))`)
  const clicked = await ev(`(() => { const row=[...document.querySelectorAll('.kb4-item')].find(b=>((b.querySelector('.kb4-lab')||{}).textContent||b.getAttribute('aria-label'))===${JSON.stringify(t)}); if(!row) return 'absent'; const r=row.getBoundingClientRect(); row.dispatchEvent(new MouseEvent('click',{bubbles:true})); return 'clicked' })()`)
  if (clicked !== 'clicked') { inventory.push({ surface: 'page:' + t, result: 'row absent de la barre latérale', shot: 0 }); continue }
  await sleep(2500)
  const after = await ev(`JSON.stringify({heads:[...document.querySelectorAll('h1,h2')].map(e=>e.innerText).filter(Boolean).slice(0,3), datakb:[...document.querySelectorAll('[data-kb$="-page"]')].map(e=>e.getAttribute('data-kb')).slice(0,5), same: ${JSON.stringify(before)}===JSON.stringify([...document.querySelectorAll('h1,h2,[data-kb$="-page"]')].map(e=>e.getAttribute('data-kb')||e.innerText).slice(0,6))})`)
  inventory.push({ surface: 'page:' + t, clicked, after, shot: await shot('w0-' + t.toLowerCase().replace(/ /g, '-')) })
}

// 3. account menu (footer card → .kbfp-menu)
const card = await ev(`!!document.querySelector('.kbfp-cardmain')`)
if (card === true) {
  await ev(`document.querySelector('.kbfp-cardmain').click()`)
  const opened = await waitFor(page, `!!document.querySelector('.kbfp-menu')`, 8000).then(() => true).catch(() => false)
  await sleep(700)
  inventory.push({ surface: 'menu-compte', opened, menu: await ev(`(() => { const m=document.querySelector('.kbfp-menu'); if(!m) return null; return JSON.stringify({spaces:[...m.querySelectorAll('.kbfp-wsitem')].map(e=>(e.innerText||'').replace(/\\n/g,' | ')), items:[...m.querySelectorAll('.kbfp-mitem')].map(e=>(e.innerText||'').replace(/\\n/g,' | ')), w:Math.round(m.getBoundingClientRect().width), h:Math.round(m.getBoundingClientRect().height)}) })()`), shot: await shot('w0-menu-compte') })
  await esc()
} else inventory.push({ surface: 'menu-compte', result: 'pas de carte footer signée', shot: 0 })

// 4. Settings dialog: cells and one capture per leaf page
const openedS = await openSettings(page, { minCells: 3 })
inventory.push({ surface: 'settings-open', ok: openedS, shot: openedS === true ? await shot('w0-settings') : 0 })
if (openedS === true) {
  const cells = JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('button[class*="navCell"]')].map(b=>(b.innerText||'').trim().split('\\n')[0]))`) || '[]')
  const seen = []
  for (const c of cells) {
    const ok = await goToSettingsPage(page, c, { settleMs: 1000 })
    const head = await ev(`((document.querySelector('main h1, main h2, [class*=dialog] h1, [class*=dialog] h2')||{}).innerText||'').slice(0,60)`)
    const bytes = await shot('w0-settings-' + c.toLowerCase().replace(/[^a-z0-9]+/g, '-'))
    seen.push({ cell: c, ok, head, bytes, dup: seen.some(s => s.bytes === bytes) })
    inventory.push({ surface: 'settings:' + c, nav: ok, head, bytes, dupCapture: seen.filter(s => s.bytes === bytes).length > 1 })
  }
  await esc()
}

// 5. right panel rail
await sleep(700)
inventory.push({ surface: 'volet-droit', tabs: await ev(`JSON.stringify([...document.querySelectorAll('[role=tab]')].map(e=>(e.innerText||e.getAttribute('aria-label')||'').trim()).filter(Boolean).slice(0,30))`), shot: await shot('w0-volet-droit') })

// 6. account menu again + console errors
inventory.push({ surface: 'console', errors: consoleErrors.slice(0, 40) })
writeFileSync(join(import.meta.dirname, 'vague0-inventaire.json'), JSON.stringify(inventory, null, 2))
console.log('surfaces:', inventory.length)
for (const i of inventory) console.log(' -', i.surface, '|', i.shot || i.bytes || '', '|', JSON.stringify(i.after || i.menu || i.result || i.head || '').slice(0, 140))
await live.close()

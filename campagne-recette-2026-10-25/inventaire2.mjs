// Wave 0 (redo, 2026-10-25): inventory of every reachable surface on the real GUI + one PNG each.
// READ-ONLY: it opens pages, never toggles a setting, never changes the theme.
// Differences with the 01:28 run: it waits for the navigation row to ACTIVATE (the previous run
// clicked rows faster than the shell painted them and stored shot=0 for Dashboards / Agent Teams /
// Atlas, and the Creations and Automations captures came out byte-identical).
import { mkdirSync, writeFileSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { openLivePage, openSettings, goToSettingsPage, waitFor } from '/Users/miled/kybernos-plugins/scripts/live-page.mjs'

const OUT = join(import.meta.dirname, 'captures')
const DOM = join(import.meta.dirname, 'vague0-inventaire2.json')
mkdirSync(OUT, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const live = await openLivePage({ width: 1440, height: 900 }).catch((e) => { console.error('inconclusive: ' + e.message); process.exit(3) })
const page = live.page
const ev = async (js, ms = 12000) => { const r = await page.evalJs(js, ms); return r.err ? { __err: String(r.err) } : r.val }
const shot = async (name) => { const p = join(OUT, name + '.png'); try { if (existsSync(p)) (await import('node:fs')).rmSync(p) } catch (e) { /* keep going */ }; await page.shot(p).catch(() => {}); return existsSync(p) ? statSync(p).size : 0 }
const mouse = async (x, y) => { for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }) }
const inventory = []

const title = () => ev(`(document.querySelector('main h1, main h2, [class*=centerCol] h1, [class*=kb6-title], [class*=kb8-hd]')||{}).innerText||''`)
const navState = () => ev(`JSON.stringify([...document.querySelectorAll('.kb4-item, nav button, [class*=side] button')].map(b=>({t:(b.innerText||b.getAttribute('aria-label')||'').trim().split('\\n')[0], on:b.classList.contains('on')})).filter(r=>r.t).slice(0,40))`)

// 1. home / composer / sidebar
await sleep(2500)
inventory.push({ surface: 'accueil', dom: await ev(`JSON.stringify({title: document.title, sidebar: [...document.querySelectorAll('nav a, nav button, [class*=side] a, [class*=side] button')].slice(0,60).map(e=>(e.innerText||e.getAttribute('aria-label')||'').trim()).filter(Boolean), composer: [...document.querySelectorAll('textarea, [contenteditable=true], button')].slice(0,60).map(e=>(e.innerText||e.getAttribute('aria-label')||'').trim()).filter(Boolean).slice(0,40)})`), shot: await shot('w0b-accueil') })

// 2. every navigation row the menu offers (clicked with a real mouse, then waited for)
for (const t of ['Kaby', 'Dashboards', 'Agent Teams', 'Workspaces', 'Creations', 'Automations', 'Skills', 'Connectors']) {
  const c = await ev(`(() => { const els=[...document.querySelectorAll('nav *, [class*=side] *, .kb4-menu *')].filter(x=>(x.innerText||x.getAttribute('aria-label')||'').trim().split('\\n')[0]===${JSON.stringify(t)}); const e=els[els.length-1]; if(!e) return null; const r=e.getBoundingClientRect(); if(r.width<4||r.height<4) return null; return JSON.stringify({x:r.left+r.width/2,y:r.top+r.height/2}) })()`)
  if (c === null || c.__err) { inventory.push({ surface: 'page:' + t, dom: 'ROW NOT FOUND', shot: 0 }); continue }
  const { x, y } = JSON.parse(c)
  await mouse(x, y)
  // the row must turn active AND a title must appear; up to 6 s, then capture whatever is there
  const active = await waitFor(page, `[...document.querySelectorAll('.kb4-item')].some(b => b.classList.contains('on') && ${JSON.stringify(t)} === ((b.innerText||b.getAttribute('aria-label')||'').trim().split('\\n')[0]))`, 6000)
  await sleep(1400)
  const h = await title()
  inventory.push({ surface: 'page:' + t, active: active !== null, h1: h, nav: await navState(), shot: await shot('w0b-' + t.toLowerCase().replace(/ /g, '-')) })
}

// 3. the account menu (foot card)
const acc = await ev(`(() => { const els=[...document.querySelectorAll('button')].filter(x=>/sign in|sign up|account|profile|personal/i.test((x.innerText||'')+' '+(x.getAttribute('aria-label')||''))); const e=els[els.length-1]; if(!e) return null; const r=e.getBoundingClientRect(); return JSON.stringify({x:r.left+r.width/2,y:r.top+r.height/2}) })()`)
if (acc && !acc.__err) {
  const { x, y } = JSON.parse(acc)
  await mouse(x, y)
  await sleep(1500)
  inventory.push({ surface: 'menu-compte', items: await ev(`JSON.stringify([...document.querySelectorAll('[role=menuitem], [role=menu] *')].map(e=>(e.innerText||'').trim()).filter(Boolean).slice(0,40))`), shot: await shot('w0b-menu-compte') })
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await sleep(700)
}

// 4. Settings: every LEAF page (the accordion is unfolded by the helper)
const opened = await openSettings(page, { minCells: 3 })
inventory.push({ surface: 'settings-open', ok: opened, shot: opened === true ? await shot('w0b-settings') : 0 })
if (opened === true) {
  const cells = JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('button[class*="navCell"]')].map(b=>(b.innerText||'').trim().split('\\n')[0]))`) || '[]')
  for (const c of cells) {
    const ok = await goToSettingsPage(page, c, { settleMs: 900 })
    const h = await title()
    inventory.push({ surface: 'settings:' + c, nav: ok, h1: h, shot: await shot('w0b-settings-' + c.toLowerCase().replace(/[^a-z0-9]+/g, '-')) })
  }
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
}

// 5. the right-panel rail
await sleep(900)
inventory.push({ surface: 'volet-droit', tabs: await ev(`JSON.stringify([...document.querySelectorAll('[class*=rail] *, [role=tab] *, aside *')].map(e=>(e.innerText||e.getAttribute('aria-label')||'').trim()).filter(t=>t&&t.length<28).slice(0,60))`), shot: await shot('w0b-volet-droit') })

writeFileSync(DOM, JSON.stringify(inventory, null, 2))
const noShot = inventory.filter((e) => !e.shot)
console.log('surfaces:', inventory.length, '| sans capture:', noShot.length, noShot.map((e) => e.surface).join(', '))
await live.close()

// Captures of the pages of the REAL GUI at :3080 (read-only: a click only opens a page).
import { mkdirSync, writeFileSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { openLivePage, openSettings, goToSettingsPage, waitFor } from '/Users/miled/kybernos-plugins/scripts/live-page.mjs'
const OUT = '/Users/miled/kybernos-plugins/campagne-recette-2026-10-25/captures-reel'
mkdirSync(OUT, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const live = await openLivePage({ width: 1440, height: 900 }).catch((e) => { console.error('inconclusive: ' + e.message); process.exit(3) })
const page = live.page
const ev = async (js, ms = 20000) => { const r = await page.evalJs(js, ms); return r.err ? { __err: String(r.err) } : r.val }
const shot = async (name) => { const p = join(OUT, name + '.png'); await page.shot(p).catch(() => {}); return existsSync(p) ? statSync(p).size : 0 }
const errors = []
await page.send('Runtime.enable', {})
page.on('console', (m) => { if (m.type() === 'error') errors.push(String(m.text).slice(0, 300)) })
await sleep(4000)
const inv = []
inv.push({ s: 'accueil', b: await shot('r-accueil') })
const clickRow = (t) => ev(`(async () => {
  const row=[...document.querySelectorAll('.kb4-item')].find(b=>((b.querySelector('.kb4-lab')||{}).textContent||b.getAttribute('aria-label'))===${JSON.stringify(t)});
  if(!row) return 'absent';
  const rr=row.getBoundingClientRect(); const x=rr.left+24, y=rr.top+rr.height/2;
  const o={bubbles:true,cancelable:true,clientX:x,clientY:y,view:window};
  for (const t2 of ['pointerdown','mousedown','mouseup','click']) row.dispatchEvent(new MouseEvent(t2,o));
  await new Promise(r=>setTimeout(r,3200));
  return 'clicked';
})()`)
for (const t of ['Kaby', 'Workspaces', 'Creations', 'Automations', 'Skills', 'Connectors']) {
  const c = await clickRow(t)
  const heads = await ev(`JSON.stringify([...document.querySelectorAll('h1,h2,h3')].map(e=>e.innerText).filter(Boolean).slice(0,5))`)
  inv.push({ s: t, c, heads, b: await shot('r-' + t.toLowerCase()) })
}
const openS = await openSettings(page, { minCells: 3 })
inv.push({ s: 'settings', ok: openS, b: openS === true ? await shot('r-settings') : 0 })
if (openS === true) {
  const cells = JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('button[class*="navCell"]')].map(b=>(b.innerText||'').trim().split('\\n')[0]))`) || '[]')
  for (const c of cells) { const ok = await goToSettingsPage(page, c, { settleMs: 900 }); inv.push({ s: 'settings:' + c, ok, b: await shot('r-settings-' + c.toLowerCase().replace(/[^a-z0-9]+/g, '-')) }) }
}
// volet droit: open the right rail if a session exists
const rail = await ev(`JSON.stringify([...document.querySelectorAll('[role=tab], [class*=rail] button')].map(e=>(e.innerText||e.getAttribute('aria-label')||'').trim()).filter(Boolean).slice(0,30))`)
inv.push({ s: 'volet-droit', rail, b: await shot('r-volet-droit') })
inv.push({ s: 'console-erreurs', errors: errors.slice(0, 30) })
writeFileSync('/Users/miled/kybernos-plugins/campagne-recette-2026-10-25/inventaire-reel.json', JSON.stringify(inv, null, 2))
for (const i of inv) console.log('-', i.s, i.b || '', String(i.heads || i.rail || i.c || '').slice(0, 120))
await live.close()

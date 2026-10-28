// Diagnose the two sidebar rows whose click produced no heading (Kaby, Creations) on the real GUI.
import { writeFileSync } from 'node:fs'
import { openLivePage } from '/Users/miled/kybernos-plugins/scripts/live-page.mjs'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const live = await openLivePage({ width: 1440, height: 900 })
const page = live.page
const ev = async (js, ms = 20000) => { const r = await page.evalJs(js, ms); return r.err ? { __err: String(r.err) } : r.val }
const errs = []
await page.send('Runtime.enable', {})
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type + ': ' + String(m.text).slice(0, 400)) })
await sleep(3500)
const snap = (label) => ev(`JSON.stringify({label:${JSON.stringify(label)}, heads:[...document.querySelectorAll('h1,h2,h3')].map(e=>e.innerText).filter(Boolean).slice(0,6), mainTxt:((document.querySelector('main')||document.body).innerText||'').replace(/\\n/g,' | ').slice(0,200), datakb:[...document.querySelectorAll('[data-kb]')].map(e=>e.getAttribute('data-kb')).filter(k=>/kaby|creation|page/.test(k)).slice(0,10)})`)
const click = (t) => ev(`(async () => {
  const row=[...document.querySelectorAll('.kb4-item')].find(b=>((b.querySelector('.kb4-lab')||{}).textContent||b.getAttribute('aria-label'))===${JSON.stringify(t)});
  if(!row) return 'absent';
  const rr=row.getBoundingClientRect(); const x=rr.left+24, y=rr.top+rr.height/2;
  const o={bubbles:true,cancelable:true,clientX:x,clientY:y,view:window};
  row.dispatchEvent(new MouseEvent('pointerdown',o)); row.dispatchEvent(new MouseEvent('mousedown',o));
  row.dispatchEvent(new MouseEvent('mouseup',o)); row.dispatchEvent(new MouseEvent('click',o));
  await new Promise(r=>setTimeout(r,3000));
  return 'clicked';
})()`)
const results = []
for (const t of ['Kaby', 'Creations', 'Connectors']) {
  const c = await click(t)
  const s = await snap(t)
  results.push({ t, c, s })
  console.log(t, c, s)
}
// screenshots for the two suspect rows
for (const t of ['Kaby', 'Creations']) { await click(t); await page.shot('/Users/miled/kybernos-plugins/campagne-recette-2026-10-25/captures/w0-' + t.toLowerCase() + '.png') }
console.log('CONSOLE ERRORS:', JSON.stringify(errs.slice(0, 20), null, 1))
writeFileSync('/Users/miled/kybernos-plugins/campagne-recette-2026-10-25/rows-kaby-creations.json', JSON.stringify({ results, errs }, null, 2))
await live.close()

// Probe: which sidebar rows change the page, with a real mouse click.
import { openLivePage } from '/Users/miled/kybernos-plugins/scripts/live-page.mjs'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const live = await openLivePage({ width: 1440, height: 900 })
const page = live.page
const ev = async (js, ms = 20000) => { const r = await page.evalJs(js, ms); return r.err ? { __err: String(r.err) } : r.val }
await sleep(3500)
const out = []
for (const t of ['Kaby', 'Sales and stock', 'Shop team', 'Workspaces', 'Creations', 'Automations', 'Skills', 'Connectors']) {
  const r = await ev(`(async () => {
    const row=[...document.querySelectorAll('.kb4-item')].find(b=>((b.querySelector('.kb4-lab')||{}).textContent||b.getAttribute('aria-label'))===${JSON.stringify(t)});
    if(!row) return JSON.stringify({row:'absent'});
    const rr=row.getBoundingClientRect();
    const x=rr.left+24, y=rr.top+rr.height/2;
    const before={h1:[...document.querySelectorAll('h1,h2')].map(e=>e.innerText).filter(Boolean).slice(0,2), txt:document.body.innerText.slice(0,200)};
    const opts={bubbles:true,cancelable:true,clientX:x,clientY:y,view:window};
    row.dispatchEvent(new MouseEvent('pointerdown',opts)); row.dispatchEvent(new MouseEvent('mousedown',opts));
    row.dispatchEvent(new MouseEvent('mouseup',opts)); row.dispatchEvent(new MouseEvent('click',opts));
    await new Promise(r=>setTimeout(r,2200));
    const after={h1:[...document.querySelectorAll('h1,h2')].map(e=>e.innerText).filter(Boolean).slice(0,2), txt:document.body.innerText.slice(0,200)};
    return JSON.stringify({changed: JSON.stringify(before)!==JSON.stringify(after), before:before.h1, after:after.h1, on: row.className.includes(' on')});
  })()`)
  out.push({ row: t, r })
  console.log(t, '→', r)
}
console.log(JSON.stringify(out))
await live.close()

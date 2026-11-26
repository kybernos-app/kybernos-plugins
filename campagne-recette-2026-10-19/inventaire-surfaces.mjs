// Wave 0 inventory: list every reachable surface of the live DSH GUI.
// Read-only. Captures into campagne-recette-2026-10-19/captures/.
import { openLivePage } from '/Users/miled/kybernos-plugins/scripts/live-page.mjs'

const dir = '/Users/miled/kybernos-plugins/campagne-recette-2026-10-19/captures'
const live = await openLivePage()
try {
  await live.page.evalJs('document.title')
  await new Promise(r => setTimeout(r, 2500))
  await live.page.screenshot ? null : null
  // screenshot via CDP is not exposed on the helper; use evalJs-based nav inventory instead.
  const inv = await live.page.evalJs(`(() => {
    const out = { title: document.title, url: location.href, nav: [], buttons: [], dialogs: [] }
    // sidebar / nav items
    for (const el of document.querySelectorAll('nav a, nav button, aside a, aside button, [role=tablist] [role=tab]')) {
      const t = (el.getAttribute('aria-label') || el.innerText || '').trim().replace(/\\s+/g, ' ')
      if (t && !out.nav.includes(t)) out.nav.push(t)
    }
    // top-level dialogs
    for (const d of document.querySelectorAll('[role=dialog]')) out.dialogs.push(d.getAttribute('aria-label') || '(sans titre)')
    return out
  })()`)
  console.log(JSON.stringify(inv, null, 2))
} finally {
  await live.close()
}

// Wave 0: walk each nav surface, capture PNG + inventory headings/buttons. Read-only.
import { writeFileSync } from 'node:fs'
import { openLivePage, clickText } from '/Users/miled/kybernos-plugins/scripts/live-page.mjs'

const dir = '/Users/miled/kybernos-plugins/campagne-recette-2026-10-19/captures'
const surfaces = ['Plugins', 'Kybernos', 'Kaby', 'Dashboards', 'Agent Teams', 'Workspaces',
  'Creations', 'Automations', 'Skills', 'Connectors', 'Automation tasks']
const live = await openLivePage()
const page = live.page
const report = {}
try {
  for (const s of surfaces) {
    const ok = await clickText(page, s, { timeoutMs: 6000 }).catch(() => false)
    await new Promise(r => setTimeout(r, 1800))
    const inv = await page.evalJs(`(() => {
      const out = { headings: [], buttons: [], tabs: [] }
      for (const h of document.querySelectorAll('h1, h2, h3, [class*=title]')) {
        const t = (h.innerText || '').trim().replace(/\\s+/g, ' '); if (t && t.length < 80 && !out.headings.includes(t)) out.headings.push(t)
      }
      for (const b of document.querySelectorAll('main button, section button')) {
        const t = (b.getAttribute('aria-label') || b.innerText || '').trim().replace(/\\s+/g, ' ')
        if (t && t.length < 60 && !out.buttons.includes(t)) out.buttons.push(t)
      }
      for (const t of document.querySelectorAll('[role=tab]')) { const x = (t.innerText || '').trim(); if (x) out.tabs.push(x) }
      out.headings = out.headings.slice(0, 12); out.buttons = out.buttons.slice(0, 25)
      return out
    })()`)
    let shot = null
    try {
      const r = await page.send('Page.captureScreenshot', { format: 'png' })
      const file = `${dir}/v0-${s.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`
      writeFileSync(file, Buffer.from(r.data, 'base64'))
      shot = file.split('/').pop()
    } catch (e) { shot = 'ECHEC: ' + e.message }
    report[s] = { clicked: ok, shot, ...inv.val }
    console.log(`## ${s} — clic:${ok} — capture:${shot}`)
    console.log('  titres:', (inv.val.headings || []).join(' | '))
    console.log('  boutons:', (inv.val.buttons || []).join(' · '))
  }
  writeFileSync('/Users/miled/kybernos-plugins/campagne-recette-2026-10-19/vague0-inventaire.json',
    JSON.stringify(report, null, 2))
} finally { await live.close() }

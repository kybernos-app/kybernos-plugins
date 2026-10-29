// Wave 0 walker: authenticated Playwright (chrome channel), walks every nav
// surface, captures PNG + structured inventory (headings, buttons, tabs, inputs).
import { chromium } from 'playwright-core'
import { writeFileSync, mkdirSync } from 'node:fs'

const DIR = '/Users/miled/kybernos-plugins/campagne-recette-2026-10-19'
const CAP = DIR + '/captures'
mkdirSync(CAP, { recursive: true })

const surfaces = [
  { name: 'dashboards', label: 'Dashboards' },
  { name: 'agent-teams', label: 'Agent Teams' },
  { name: 'workspaces', label: 'Workspaces' },
  { name: 'creations', label: 'Creations' },
  { name: 'automations', label: 'Automations' },
  { name: 'skills', label: 'Skills' },
  { name: 'connectors', label: 'Connectors' },
]

const b = await chromium.launch({ channel: 'chrome', headless: true })
const ctx = await b.newContext({ storageState: process.env.HOME + '/.dsh/web-auth-state.json', viewport: { width: 1600, height: 1000 } })
const page = await ctx.newPage()
const errors = []
page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)) })
await page.goto('http://127.0.0.1:3080/')
await page.waitForTimeout(2500)
// close the Get started dialog if present
try { await page.locator("[role=dialog][aria-label='Get started'] button[aria-label='Close']").click({ timeout: 3000 }) } catch {}

const report = {}
for (const s of surfaces) {
  try {
    // reopen the Kybernos menu before each item (it closes after a click)
    try { await page.locator('nav button', { hasText: 'Kybernos' }).first().click({ timeout: 3000 }) } catch {}
    await page.waitForTimeout(600)
    await page.locator('nav button', { hasText: s.label }).first().click({ timeout: 6000 })
    await page.waitForTimeout(1600)
    const inv = await page.evaluate(() => {
      const vis = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 }
      const out = { headings: [], buttons: [], tabs: [], inputs: [], rows: 0 }
      for (const h of document.querySelectorAll('h1,h2,h3')) { if (vis(h)) { const t = h.innerText.trim().replace(/\s+/g, ' '); if (t && t.length < 90) out.headings.push(t) } }
      for (const bt of document.querySelectorAll('main button, [role=dialog] button')) { if (vis(bt)) { const t = (bt.getAttribute('aria-label') || bt.innerText || '').trim().replace(/\s+/g, ' '); if (t && t.length < 70 && !out.buttons.includes(t)) out.buttons.push(t) } }
      for (const t of document.querySelectorAll('[role=tab]')) { if (vis(t)) out.tabs.push(t.innerText.trim()) }
      for (const i of document.querySelectorAll('input, textarea')) { if (vis(i)) out.inputs.push(i.getAttribute('placeholder') || i.getAttribute('aria-label') || i.type) }
      out.rows = document.querySelectorAll('[data-row-key], li').length
      out.headings = [...new Set(out.headings)].slice(0, 15)
      out.buttons = out.buttons.slice(0, 40)
      return out
    })
    const file = `${CAP}/v0-${s.name}.png`
    await page.screenshot({ path: file })
    report[s.name] = { ok: true, ...inv }
    console.log(`OK ${s.name}: h=${inv.headings.length} btn=${inv.buttons.length} tabs=${inv.tabs.join(',')}`)
  } catch (e) {
    report[s.name] = { ok: false, err: String(e).slice(0, 200) }
    console.log(`ERR ${s.name}: ${String(e).slice(0, 120)}`)
  }
}
report._consoleErrors = [...new Set(errors)].slice(0, 10)
writeFileSync(DIR + '/vague0-panneaux.json', JSON.stringify(report, null, 2))
await b.close()

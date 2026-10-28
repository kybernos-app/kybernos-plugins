import { chromium } from 'playwright-core'
const b = await chromium.launch({ channel: 'chrome', headless: true })
const ctx = await b.newContext({ storageState: process.env.HOME + '/.dsh/web-auth-state.json', viewport: { width: 1600, height: 1000 } })
const page = await ctx.newPage()
await page.goto('http://127.0.0.1:3080/')
await page.waitForTimeout(2500)
const state = async (tag) => {
  const s = await page.evaluate(() => ({
    url: location.href,
    nav: [...document.querySelectorAll('nav button')].map(b => (b.getAttribute('aria-label')||b.innerText||'').trim()).filter(Boolean).slice(0,15),
    dialogs: [...document.querySelectorAll('[role=dialog]')].map(d => d.getAttribute('aria-label')),
  }))
  console.log(tag, JSON.stringify(s))
}
await state('init')
await page.getByRole('button', { name: 'Dashboards' }).first().click({ timeout: 5000 })
await page.waitForTimeout(1500)
await state('après-dashboards')
await b.close()

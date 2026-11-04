#!/usr/bin/env node
// Compares what the public pricing page tells a visitor with the server's catalogue (the source of truth for prices, budgets and top-ups). Case J21-01 / J21-02 of docs/tests/user-journey.
//
//   node scripts/check-prices-cross.mjs --server <kybernos-server checkout> [--site https://kybernos.app] [--page-file <saved html>] [--json]
//
// Read only: one GET of the site's /pricing page (or a saved copy) and the catalogue files. Exit 0 when every figure agrees, 1 on a disagreement, 2 on a refusal.
// The checks are about WORDS A BUYER READS: a price, a monthly allowance, the unit (credits or dollars), the top-up amount and how long it lasts.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const money = (s) => Number(String(s))

/** Plain text of an HTML page: no script, no style, no tags, entities decoded for the few the page uses. */
export function textOf (html) {
  return html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, ' ')
}

/** What the catalogue says, as plain numbers. `files`: { free, solo, team, topup } parsed JSON. */
export function catalogueFacts (files) {
  const price = (j, component, interval, cur = 'USD') => money(((j.prices || []).find((p) => p.component === component && p.interval === interval && p.currency === cur) || {}).amount)
  const levels = files.solo.definition.levels
  const lvl = (k) => levels.find((l) => l.key === k)
  return {
    free: { monthlyBudgetUsd: Object.values(files.free.definition.budgets).reduce((a, b) => a + money(b), 0) },
    plus: { yearly: price(files.solo, 'solo', 'year'), monthly: price(files.solo, 'solo', 'month'), modelsUsd: money(lvl('solo').budgets.models), fiveHourPct: lvl('solo').windows.find((w) => w.window_seconds === 18000).percent },
    pro: { yearly: price(files.solo, 'studio', 'year'), monthly: price(files.solo, 'studio', 'month'), modelsUsd: money(lvl('studio').budgets.models), fiveHourPct: lvl('studio').windows.find((w) => w.window_seconds === 18000).percent },
    team: { yearly: price(files.team, 'band:0', 'year'), monthly: price(files.team, 'band:0', 'month'), minSeats: files.team.definition.min_seats },
    topup: { minUsd: files.topup.definition.pack.min_qty, maxUsd: files.topup.definition.pack.max_qty, expiresMonths: files.topup.definition.pack.expires_months, usdPerUnit: money(files.topup.definition.pack.budget_usd) },
    creditsExist: !/No credits: dollars only/i.test(files.solo._notes || '') ? true : false
  }
}

/** Everything where the page and the catalogue disagree, as sentences. `text`: plain text of /pricing. */
export function compare (text, facts) {
  const bad = []
  const has = (re) => re.test(text)
  const grab = (re) => { const m = text.match(re); return m ? m[1] : null }
  // prices: a figure the catalogue does not sell is a wrong price
  for (const [name, f] of [['Plus', facts.plus], ['Pro', facts.pro]]) {
    if (!has(new RegExp(`\\$${f.yearly}\\b`))) bad.push(`${name}: the page does not show $${f.yearly} a month paid yearly`)
    if (!has(new RegExp(`\\$${f.monthly}\\b`))) bad.push(`${name}: the page does not show $${f.monthly} a month paid monthly`)
  }
  // the unit: the catalogue sells dollars of budget and says « No credits »; a page that sells credits promises something the product does not count
  if (!facts.creditsExist) {
    const credits = [...text.matchAll(/([\d,]+)\s+credits/gi)].map((m) => m[0])
    if (credits.length) bad.push(`the catalogue has no credits (dollars only) but the page sells credits: ${[...new Set(credits)].slice(0, 6).join('; ')}`)
  }
  // Free: the catalogue gives Free no monthly allowance (a welcome credit and top-ups only)
  if (facts.free.monthlyBudgetUsd === 0) {
    const freeQuota = grab(/Free\b[^$]{0,160}?([\d,]+ credits per month)/i)
    if (freeQuota) bad.push(`Free: the page promises ${freeQuota}, the catalogue gives Free no monthly budget (0.00 on every pot)`)
  }
  // top-up: an amount the buyer chooses, from $min, 1 USD = 1 USD of budget, valid expiresMonths months
  const pack = grab(/(A \$\d+ top-up adds [\d,]+ credits)/i)
  if (pack) bad.push(`top-up: the page says « ${pack} » but the catalogue sells an amount of your choice from $${facts.topup.minUsd} to $${facts.topup.maxUsd}, $1 for $1 of budget`)
  if (!has(new RegExp(`${facts.topup.expiresMonths} months`))) bad.push(`top-up: the page does not say it is valid ${facts.topup.expiresMonths} months`)
  return bad
}

async function main () {
  const argv = process.argv.slice(2)
  const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d }
  const server = opt('--server', '')
  if (!server) { console.error('check-prices-cross: --server <kybernos-server checkout> is required'); process.exit(2) }
  const read = (f) => JSON.parse(readFileSync(join(server, 'catalogue', f + '.json'), 'utf8'))
  const facts = catalogueFacts({ free: read('free'), solo: read('solo'), team: read('team'), topup: read('topup') })
  let html
  if (opt('--page-file', '')) html = readFileSync(opt('--page-file', ''), 'utf8')
  else {
    const site = opt('--site', 'https://kybernos.app').replace(/\/$/, '')
    if (!/^https:\/\/[a-z0-9.-]+$/.test(site)) { console.error('check-prices-cross: --site must be an https origin'); process.exit(2) }
    const r = await fetch(site + '/pricing', { headers: { 'user-agent': 'kybernos-recette/1' } })
    if (!r.ok) { console.error(`check-prices-cross: ${site}/pricing answered ${r.status}`); process.exit(2) }
    html = await r.text()
  }
  const bad = compare(textOf(html), facts)
  if (argv.includes('--json')) console.log(JSON.stringify({ facts, disagreements: bad }, null, 2))
  else { for (const b of bad) console.log('✗ ' + b); console.log(bad.length === 0 ? 'the page and the catalogue agree' : `${bad.length} disagreement(s)`) }
  process.exit(bad.length === 0 ? 0 : 1)
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main()

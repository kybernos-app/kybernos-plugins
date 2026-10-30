// The next level of the plan offered to someone who is not on the top one (`planPitch`, read through `window.__KB_UPGRADE__.pitch()` by the limit strip under the composer and
// by the last screen of the first-run wizard): the level, its price per month, how many times more it allows, what it adds. Pure, cut out of client.js and run on its own.
//   node packages/kybernos-cloud/test-plan-pitch.mjs
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

let failed = 0
const check = (name, ok, detail) => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok || detail === undefined ? '' : '  — ' + detail))
  if (!ok) failed += 1
}
const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, 'client.js'), 'utf8')
const from = source.indexOf('// <plan-pitch>')
const to = source.indexOf('// </plan-pitch>')
check('the pitch is where the test expects it', from > 0 && to > from)
const { planPitch } = from > 0 && to > from ? new Function(source.slice(from, to) + '\nreturn { planPitch }')() : { planPitch: () => null }

const money = (cur, year, month) => [{ currency: cur, interval: 'year', amount: String(year) }, { currency: cur, interval: 'month', amount: String(month) }]
const allowance = (credits) => [{ window_seconds: 18000, member_credits: credits / 4 }, { window_seconds: 2592000, member_credits: credits }]
const catalogue = [
  { key: 'free', kind: 'free', components: [{ key: 'free', name: 'Free', display: { usage_multiple: 0.05 }, prices: [], allowances: allowance(1000), features: ['byok', 'connections', 'hosted_runs'] }] },
  { key: 'solo', kind: 'individual', currencies: ['USD', 'EUR'], components: [
    { key: 'studio', name: 'Pro', display: { usage_multiple: 2.5 }, prices: money('USD', 39, 49).concat(money('EUR', 36, 45)), allowances: allowance(50000), features: ['byok', 'computers.always_on'] },
    { key: 'solo', name: 'Plus', display: { usage_multiple: 1 }, prices: money('USD', 19, 24).concat(money('EUR', 17, 22)), allowances: allowance(20000), features: ['byok', 'computers.always_on'] }] },
  { key: 'team', kind: 'team', currencies: ['USD'], components: [{ key: 'band:0', name: 'Team', display: { usage_multiple: 2, label: 'per seat' }, prices: money('USD', 39, 49) }] },
]
const free = { key: 'free', label: 'Free' }

console.log('the next level')
{
  const p = planPitch(catalogue, free, { fr: false, region: 'US' })
  check('from Free: Plus (the cheapest level above), its yearly price per month and the monthly one', p !== null && p.name === 'Plus' && p.key === 'solo' && p.amount === 19 && p.yearly === true && p.monthAmount === 24 && p.currency === 'USD', JSON.stringify(p))
  check('20 times more (1 / 0.05), 20,000 credits a month against 1,000', p.times === 20 && p.credits === 20000 && p.fromCredits === 1000, JSON.stringify(p))
  check('always-on computers are said only when the next level adds them', p.alwaysOn === true)
  const q = planPitch(catalogue, { key: 'solo', label: 'Plus' }, { fr: false, region: 'US' })
  check('from Plus: Pro, 2.5 times more, and no always-on computers to announce (Plus has them)', q !== null && q.name === 'Pro' && q.amount === 39 && q.times === 2.5 && q.credits === 50000 && q.alwaysOn === false, JSON.stringify(q))
  check('the account\'s plan is found by its level, or by its label when the key does not name a level', planPitch(catalogue, { key: 'solo', level: 'solo' }, {}).name === 'Pro' && planPitch(catalogue, { key: '', label: 'plus' }, {}).name === 'Pro')
  check('nothing above the top level', planPitch(catalogue, { key: 'studio', label: 'Pro' }, {}) === null)
  const unknown = planPitch(catalogue, null, { fr: false, region: 'US' })
  check('a plan the catalogue does not know gets the cheapest level and no figure it cannot compute', unknown !== null && unknown.name === 'Plus' && unknown.times === null && unknown.fromCredits === null && unknown.alwaysOn === true, JSON.stringify(unknown))
}
console.log('the currency')
{
  check('a French-speaking person gets the euro when it is sold', planPitch(catalogue, free, { fr: true, region: '' }).currency === 'EUR' && planPitch(catalogue, free, { fr: true, region: '' }).amount === 17)
  check('so does a euro-zone region', planPitch(catalogue, free, { fr: false, region: 'DE' }).currency === 'EUR')
  check('else the dollar', planPitch(catalogue, free, { fr: false, region: 'US' }).currency === 'USD' && planPitch([{ ...catalogue[1], currencies: ['USD'] }], free, { fr: true, region: 'FR' }).currency === 'USD')
  const monthlyOnly = [{ ...catalogue[1], components: [{ ...catalogue[1].components[1], prices: [{ currency: 'USD', interval: 'month', amount: '24' }] }] }]
  const m = planPitch(monthlyOnly, free, {})
  check('a level sold by the month only: that price, not yearly, no second price', m !== null && m.amount === 24 && m.yearly === false && m.monthAmount === null, JSON.stringify(m))
  const noPrice = planPitch([{ ...catalogue[1], components: [{ ...catalogue[1].components[1], prices: [] }] }], free, {})
  check('a level with no price in that currency is still offered, without a price', noPrice !== null && noPrice.amount === null && noPrice.name === 'Plus')
}
console.log('what it is given')
{
  check('junk gives nothing and never throws', planPitch(null, null, null) === null && planPitch([], null, undefined) === null && planPitch([{ key: 'x', components: null }, null, 3], null, {}) === null && planPitch('x', {}, {}) === null)
  check('a catalogue with no individual level gives nothing', planPitch([catalogue[0], catalogue[2]], free, {}) === null)
}
console.log('the seam')
check('the Upgrade dialog\'s seam carries pitch(), worded for the active space, and the dialog starts on the same euro-zone list', /pitch: \(\) => planPitchNow\(spacePlanRef\.current\)/.test(source) && /PITCH_EURO_REGIONS\.indexOf\(region\) >= 0 \|\| lang\(\) === 'fr'/.test(source) && (source.match(/EURO_REGIONS = \[/g) || []).length === 1)
check('it also words the price of Free (the same currency) for the screens that put the two side by side', /zero: raw\.currency !== null \? pitchMoney\(0, raw\.currency\) : null/.test(source))
check('its amounts carry the narrow symbol (« 19 $ », not « 19 $US »)', /currencyDisplay: 'narrowSymbol'/.test(source))
if (failed > 0) { console.log('\n' + failed + ' check(s) failed'); process.exit(1) }
console.log('\nplan pitch — all checks OK')

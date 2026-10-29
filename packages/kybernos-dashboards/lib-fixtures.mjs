// Route answers shaped like the ones measured on a running DSH, built relative to a fixed "now", for the tests and the
// visual check. Local-time based on purpose: the model keys days in local time, so the fixtures must too.
import { dayKey } from './model.mjs'

export const NOW = new Date(2026, 9, 13, 10, 0, 0).getTime() // Tue 13 Oct 2026, 10:00 local

/** The same answers built around any instant (the visual check uses the real clock so "today" is today). */
export function fixturesAt (now) {
  const DAY = 86400000
  const iso = (ms) => new Date(ms).toISOString()

  const A = [0.9, 1.2, 0.8, 0.1, 0, 1.5, 1.7, 1.3, 1.1, 0.9, 0.2, 0, 1.4, 0.6]
  const B = [0.3, 0.4, 0.2, 0, 0, 0.5, 0.6, 0.4, 0.5, 0.3, 0.1, 0, 0.5, 0.2]
  const C = [0.1, 0, 0.2, 0, 0, 0.2, 0.1, 0.3, 0, 0.2, 0, 0, 0.1, 0.1]

  /** GET /kybernos-usage/summary?days=14 */
  function usageSummary (days = 14) {
    const daily = []
    for (let i = days - 1; i >= 0; i--) {
      const k = i % 14
      const day = dayKey(now - i * DAY)
      const models = {}
      const put = (key, v) => { if (v > 0) { const t = Math.round(v * 1e6); models[key] = { u: Math.round(t * 0.5), o: Math.round(t * 0.2), cr: Math.round(t * 0.28), cw: Math.round(t * 0.02) } } }
      put('anthropic/sonnet-5-5', A[13 - k]); put('deepseek-official/deepseek-v4', B[13 - k]); put('openrouter/qwen-local', C[13 - k])
      daily.push({ day, models })
    }
    const sessions = [
      { id: 's-plugins', title: 'Plugins repo: dashboards', seen: iso(now - 3600000), models: { 'anthropic/sonnet-5-5': { u: 2500000, o: 800000, cr: 1200000, cw: 40000 } } },
      { id: 's-team', title: 'Team server review', seen: iso(now - DAY), models: { 'anthropic/sonnet-5-5': { u: 900000, o: 300000, cr: 400000, cw: 10000 }, 'deepseek-official/deepseek-v4': { u: 400000, o: 100000, cr: 0, cw: 0 } } },
      { id: 's-admin', title: 'Invoices', seen: iso(now - 3 * DAY), models: { 'openrouter/qwen-local': { u: 300000, o: 90000, cr: 0, cw: 0 } } },
    ]
    // the totals by model over the period, as the ledger sums them
    const models = {}
    for (const d of daily) for (const k of Object.keys(d.models)) { const t = models[k] || (models[k] = { u: 0, o: 0, cr: 0, cw: 0 }); for (const c of ['u', 'o', 'cr', 'cw']) t[c] += d.models[k][c] }
    return { ok: true, period: { days, from: daily[0].day, to: daily[daily.length - 1].day }, daily, models, sessionCount: 121, sessions, before: { 'anthropic/sonnet-5-5': { u: 10, o: 5, cr: 0, cw: 0 } }, since: daily[0].day, budget: { usd: 40, alert: true } }
  }

  /** POST /kybernos/tasks {action:'list'} */
  function tasksList () {
    const run = (daysAgo, hour, status, error) => ({ at: iso(now - daysAgo * DAY - (10 - hour) * 3600000), sessionId: 'sess-' + daysAgo + '-' + hour, status, ...(error ? { error } : {}) })
    return {
      ok: true,
      tasks: [
        { id: 'morning-digest', name: 'Morning digest', active: true, schedule: { mode: 'cron', cron: '30 7 * * 1-5' }, history: [run(0, 7, 'fired'), run(1, 7, 'fired'), run(2, 7, 'error', 'Gmail token expired'), run(3, 7, 'fired')] },
        { id: 'nightly-tests', name: 'Nightly test run', active: true, schedule: { mode: 'cron', cron: '0 2 * * *' }, history: [run(0, 2, 'fired'), run(1, 2, 'fired'), run(2, 2, 'fired')] },
        { id: 'lead-followup', name: 'Lead follow-up', active: true, schedule: { mode: 'cron', cron: '0 10 * * 1-5' }, history: [run(1, 10, 'fired'), run(3, 10, 'queued')] },
        { id: 'weekly-post', name: 'Draft weekly post', active: false, schedule: { mode: 'cron', cron: '0 18 * * 0' }, history: [run(9, 18, 'fired')] },
        { id: 'new-one', name: 'Backup memories', active: true, schedule: { mode: 'cron', cron: '0 3 * * *' }, history: [] },
      ],
    }
  }
  /** GET /kybernos/tasks/occurrences?from=&to= */
  function occurrences () {
    const d0 = new Date(now)
    const at = (days, hour) => iso(new Date(d0.getFullYear(), d0.getMonth(), d0.getDate() + days, hour, 0, 0).getTime())
    return { ok: true, occurrences: [{ id: 'lead-followup', at: at(0, 11) }, { id: 'nightly-tests', at: at(1, 2) }, { id: 'morning-digest', at: at(1, 7) }, { id: 'morning-digest', at: at(2, 7) }, { id: 'lead-followup', at: at(1, 10) }, { id: 'nightly-tests', at: at(3, 2) }], cannotFire: [], warnings: [], truncated: [] }
  }
  /** GET /kybernos/load */
  function load () {
    const k = (id, name, roles, skills, mission, category) => ({ id, ui: { name, category }, mission, roles: roles.map((r) => ({ id: r, tools: ['read', 'write'] })), skillsDeclared: skills, skills: [] })
    return {
      ok: true,
      roots: [{ id: 'root-1', kybers: [k('release', 'Release', ['manager', 'tester'], ['code-review', 'simplify'], 'Cuts the betas and writes the changelogs', 'dev'), k('team-lead', 'Team lead', ['planner', 'builder'], ['ui-mockup'], 'Plans and builds the Team server and console', 'dev'), k('writer', 'Writer', ['drafter', 'editor'], [], 'Drafts posts and docs', 'content')] }],
      artifacts: [
        { name: 'q4-pricing.pptx', size: 180000, mtimeMs: now - 3600000, workspace: 'Website' },
        { name: 'release-notes-beta8.md', size: 6200, mtimeMs: now - DAY, workspace: 'Plugins repo' },
        { name: 'suite-intro.miniapp.json', size: 22000, mtimeMs: now - 3 * DAY, workspace: 'Plugins repo' },
        { name: 'competitive-study.pdf', size: 540000, mtimeMs: now - 5 * DAY, workspace: 'Research' },
      ],
    }
  }
  /** GET /kybernos-sessions/state */
  function sessionsState () {
    return { ok: true, kybers: [{ id: 'release', totalLecons: 6, totalRuns: 14, derniereActivite: iso(now - DAY) }, { id: 'team-lead', totalLecons: 9, totalRuns: 21, derniereActivite: iso(now - 3600000) }, { id: 'writer', totalLecons: 2, totalRuns: 3, derniereActivite: null }] }
  }
  /** GET /kybernos-skills/skills */
  function skills () {
    return { ok: true, skills: [{ name: 'code-review', description: 'Review a diff for bugs', source: 'user', active: true }, { name: 'simplify', description: 'Clean up changed code', source: 'user', active: true }, { name: 'airtable-sales-ops', description: 'CRM in Airtable', source: 'plugin', active: false }, { name: 'docx', description: 'Word documents', source: 'user', active: true, collision: true }] }
  }
  /** GET /kybernos/runs-index?limit=N */
  function runsIndex () {
    return { ok: true, entries: [
      { sessionId: 'aaaaaaaa-1', workspace: '/home/me/code/kybernos-plugins', title: 'Dashboards plugin', runCount: 5, teamCount: 2, lastActivityAt: now - 3600000 },
      { sessionId: 'bbbbbbbb-2', workspace: '/home/me/code/kybernos-app', title: null, runCount: 2, teamCount: 0, lastActivityAt: now - DAY },
      { sessionId: 'cccccccc-3', workspace: null, title: 'Invoices', runCount: 1, teamCount: 1, lastActivityAt: now - 4 * DAY },
    ] }
  }

  /** The Business routes (Catalog, Contacts, Pipeline), shaped like the answers of the real ones: a small online shop, dates relative to `now`. */
  function business () {
    const day = (n) => dayKey(now + n * DAY)
    const at = (n) => iso(now + n * DAY)
    const item = (id, title, status, price, fields, extra) => ({ id, type: 'product', title, subtitle: fields.sku, status, price_text: '€' + price, price_num: price, fields: Object.assign({ price }, fields), demo: true, created_at: at(-9), updated_at: at(-2), archived_at: null, ...extra })
    const items = [
      item(1, 'Stoneware mug, set of 2', 'live', 28, { sku: 'FC-MUG-02', stock: 42, reorder_at: 10, supplier: 'Okafor Ceramics', category: 'Kitchen', badge: 'Bestseller', image: 'photo:ecommerce/stoneware-mug' }),
      item(2, 'Linen napkins, 4-pack', 'live', 34, { sku: 'FC-NAP-04', stock: 6, reorder_at: 10, supplier: 'Nordlinen Mills', category: 'Table', image: 'photo:ecommerce/linen-napkins' }),
      item(3, 'Beeswax taper candles', 'out', 19, { sku: 'FC-CND-12', stock: 0, reorder_at: 12, supplier: 'Hivelight Apiary', category: 'Candles' }),
      item(4, 'Wool throw', 'draft', 89, { sku: 'FC-THR-01', category: 'Living' }),
    ]
    const types = { ok: true, source: 'theme', types: [{ id: 'product', label: { en: 'Product', fr: 'Produit' }, plural: { en: 'Products', fr: 'Produits' }, statuses: [{ key: 'live', tone: 'ok', label: { en: 'Live', fr: 'En ligne' } }, { key: 'out', tone: 'bad', label: { en: 'Out of stock', fr: 'En rupture' } }, { key: 'draft', tone: 'neutral', label: { en: 'Draft', fr: 'Brouillon' } }] }] }
    const person = (id, name, type, tags, fields, company) => ({ id, kind: 'person', type, name, email: name.toLowerCase().replace(/ /g, '.') + '@example.com', company_id: company ? 9 : null, company: company ? { id: 9, name: company } : null, tags, fields, demo: true, created_at: at(-9), updated_at: at(-1), archived_at: null })
    const people = [
      person(11, 'Amelia Hart', 'customer', ['vip', 'repeat'], { city: 'Lyon', spent: 1240, last_order: day(-3) }),
      person(12, 'Mateo Silva', 'customer', ['repeat'], { city: 'Nantes', spent: 486, last_order: day(-8) }),
      person(13, 'Noah Bernard', 'customer', [], { city: 'Paris' }),
      person(14, 'Okafor Ceramics', 'supplier', ['handmade'], { city: 'Lisbon', lead_time: '3 weeks' }),
    ]
    const schema = { ok: true, schema: { themed: true, themes: ['shop'], types: [{ key: 'customer', kind: 'person', label: { en: 'Customer', fr: 'Client' } }, { key: 'supplier', kind: 'company', label: { en: 'Supplier', fr: 'Fournisseur' } }], fields: [], tags: [] } }
    const card = (id, title, stage, value, fields, links) => ({ id, flow: 'orders', stage, title, subtitle: '2 items', value, position: id, since: at(-id), demo: true, archived: false, contact_id: 11, item_id: 1, fields, contact: links ? { id: 11, name: links[0], kind: 'person', archived: false } : null, item: links ? { id: 1, title: links[1], subtitle: '', type: 'product', image: null, archived: false } : null })
    const stages = [['new', 'New'], ['paid', 'Paid'], ['packed', 'Packed'], ['shipped', 'Shipped'], ['delivered', 'Delivered']]
    const flow = { id: 'orders', label: { en: 'Orders', fr: 'Commandes' }, newLabel: { en: 'New order', fr: 'Nouvelle commande' }, stages: stages.map(([key, en]) => ({ key, label: { en, fr: en } })), value: { format: 'money', currency: 'EUR' }, links: { contact: true, item: true }, source: 'theme', theme: 'kybernos-themes/ecommerce' }
    const cards = [
      card(1, '#1053 · Amelia Hart', 'new', 89, { source: 'Website', priority: 'high', due: day(2), tags: ['vip'] }, ['Amelia Hart', 'Wool throw']),
      card(2, '#1052 · Noah Bernard', 'paid', 71, { source: 'Marketplace', priority: 'low', due: day(5) }, ['Noah Bernard', 'Tote bag']),
      card(3, '#1051 · Yusuf Demir', 'shipped', 43, { source: 'Newsletter', priority: 'normal', due: day(-1) }, ['Yusuf Demir', 'Linen apron']),
      card(4, '#1050 · Mateo Silva', 'delivered', 120, { source: 'Website', priority: 'normal' }, ['Mateo Silva', 'Wool throw']),
    ]
    const columns = stages.map(([key, en]) => ({ stage: key, label: { en, fr: en }, unknown: false, count: 0, total: 0, cards: cards.filter((c) => c.stage === key) }))
    const board = { ok: true, flow, columns, count: cards.length, total: 323, demoCards: cards.length, truncated: false }
    const flows = { ok: true, flows: [Object.assign({}, flow, { cards: cards.length })], theme: true, demo: cards.length }
    const page = (rows) => ({ ok: true, rows, total: rows.length, limit: 500, offset: 0, counts: {}, countsPartial: false, demo: { items: rows.length, all: rows.length } })
    return { types, items: page(items), schema, people: Object.assign(page(people), { truncated: false, demo: people.length }), flows, board }
  }
  const biz = business()

  /** The answers of every route a provider asks for, keyed like the provider's plan. */
  const PARTS = {
    'usage.daily': { summary: usageSummary(14) },
    'usage.sessions': { summary: usageSummary(14) },
    'usage.models': { summary: usageSummary(14) },
    'usage.totals': { summary: usageSummary(14) },
    'automations.runs': { tasks: tasksList() },
    'automations.list': { tasks: tasksList() },
    'automations.timeline': { tasks: tasksList(), occurrences: occurrences() },
    'teams.list': { load: load() },
    'teams.lessons': { state: sessionsState() },
    'skills.list': { skills: skills() },
    'sessions.runs': { index: runsIndex() },
    'deliverables.list': { load: load() },
    'catalog.items': { types: biz.types, page0: biz.items },
    'contacts.people': { schema: biz.schema, page0: biz.people },
    'pipeline.cards': { flows: biz.flows, 'board:orders': biz.board },
  }
  return { usageSummary, tasksList, occurrences, load, sessionsState, skills, runsIndex, business, PARTS }
}

const F = fixturesAt(NOW)
export const { PARTS } = F // the only part of F anything imports (the visual check calls fixturesAt itself)

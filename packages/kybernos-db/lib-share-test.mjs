// A small shop for the tests of the shared dashboard: a Tables app with sixty orders (a couple of customers with a personal name and e-mail) and the dashboard a person would
// make over it, plus the widgets that cannot be shared and why. Used by test-share.mjs and by the live check of the shared page.
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeService } from './agent/service.mjs'
import { makeApi } from './api.mjs'

export const PRODUCTS = [['mug', 'Mug', 12], ['tee', 'T-shirt', 25], ['cap', 'Cap', 18]]
export const ORDER = {
  key: 'order', label: 'Orders', title: 'ref',
  fields: [
    { key: 'ref', type: 'text', label: 'Reference', required: true },
    { key: 'customer', type: 'text', label: 'Customer', protection: 'personal' },
    { key: 'email', type: 'email', label: 'E-mail', protection: 'personal' },
    { key: 'product', type: 'choice', label: 'Product', options: PRODUCTS.map(([key, label]) => ({ key, label })) },
    { key: 'amount', type: 'money', label: 'Amount', currency: 'EUR' },
    { key: 'qty', type: 'number', label: 'Quantity' },
    { key: 'day', type: 'date', label: 'Day' },
    { key: 'iban', type: 'text', label: 'IBAN', protection: 'sensitive' },
  ],
}
const source = { provider: 'db.rows', params: { object: 'order' } }
export const DASHBOARD = {
  name: 'Sales', desc: 'The first two months',
  widgets: [
    { id: 'revenue', type: 'card', title: 'Revenue', w: 3, h: 2, source, metric: { agg: 'sum', field: 'amount' }, format: 'compact', unit: 'EUR', sub: { template: '{v} orders', metric: { agg: 'count' } }, spark: { x: 'day', agg: 'sum', y: 'amount' } },
    { id: 'orders', type: 'card', title: 'Orders', w: 3, h: 2, source, metric: { agg: 'count' } },
    { id: 'by-product', type: 'chart', title: 'Revenue by product', kind: 'bars', w: 6, h: 4, source, x: 'product', y: 'amount', agg: 'sum' },
    { id: 'daily', type: 'chart', title: 'Revenue per day', kind: 'area', w: 8, h: 4, source, x: 'day', y: 'amount', agg: 'sum' },
    { id: 'mix', type: 'chart', title: 'Orders by product', kind: 'donut', w: 4, h: 4, source, x: 'product' },
    { id: 'stacked', type: 'chart', title: 'Per product, per day', kind: 'stacked', w: 6, h: 4, source, x: 'day', y: 'qty', agg: 'sum', series: 'product' },
    { id: 'big', type: 'table', title: 'Biggest orders', w: 6, h: 4, source, columns: [{ field: 'ref', label: 'Order' }, { field: 'product' }, { field: 'amount', format: 'number', bar: true }], sort: '-amount', limit: 5 },
    { id: 'latest', type: 'list', title: 'Latest', w: 4, h: 4, source, label: 'ref', sub: 'product', when: 'day', sort: '-day', limit: 6 },
    { id: 'note', type: 'note', title: 'About', w: 4, h: 2, text: 'Orders of the shop, in euros.' },
    // what cannot be shared
    { id: 'who', type: 'table', title: 'Who ordered', w: 6, h: 4, source, columns: [{ field: 'customer' }, { field: 'amount' }] },
    { id: 'by-customer', type: 'chart', title: 'By customer', kind: 'bars', w: 6, h: 4, source, x: 'customer', y: 'amount', agg: 'sum' },
    { id: 'usage', type: 'card', title: 'Tokens', w: 3, h: 2, source: { provider: 'usage.totals', params: {} }, metric: { agg: 'sum', field: 'tokens' } },
    { id: 'board', type: 'kanban', title: 'Board', w: 8, h: 5, source, groupBy: 'product', label: 'ref', columns: [{ value: 'mug', label: 'Mug' }] },
  ],
}
export const rowsOf = () => Array.from({ length: 60 }, (_, i) => {
  const p = PRODUCTS[i % 3]
  return { ref: 'A-' + String(1000 + i), customer: ['Ada Lovelace', 'Alan Turing', 'Grace Hopper'][i % 3], email: ['ada', 'alan', 'grace'][i % 3] + '@example.com', product: p[0], amount: p[2] * (1 + (i % 4)), qty: 1 + (i % 4), day: '2026-09-' + String(1 + (i % 28)).padStart(2, '0'), iban: 'FR76' + String(i).padStart(10, '0') }
})

/** { svc, api, db, id, rows }: the shop in a temp folder, the Tables door over it. */
export function salesWorld () {
  const root = mkdtempSync(join(tmpdir(), 'kb-share-'))
  let t = Date.UTC(2026, 10, 2, 9, 0, 0)
  let i = 0
  const svc = makeService({ dir: join(root, 'dbs'), ports: { now: () => (t += 1), random: (len) => { i += 1; return Uint8Array.from({ length: len }, (_, k) => (i * 31 + k * 7 + 1) & 255) } } })
  const made = svc.create({ name: 'Shop', by: 'agent' })
  if (!made.ok || !made.db.addObject(ORDER, 'agent').ok) throw new Error('the fixture shop could not be made')
  const rows = rowsOf()
  for (const r of rows) { const c = made.db.create('order', r, 'agent'); if (!c.ok) throw new Error('row: ' + JSON.stringify(c)) }
  return { svc, api: makeApi({ service: svc, ports: { today: () => '2026-11-02' } }), db: made.db, id: made.db.info().id, rows }
}

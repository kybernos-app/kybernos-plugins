// The database the live check of the Tables page opens on: a small « Home » db (tasks with every kind of field a page has to draw, and their projects), written through the
// service the host itself uses, into the SANDBOX's home (the caller has already refused any other). Pure of the check: a second run finds the db it made and leaves it.
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { makeService } from '../packages/kybernos-db/agent/service.mjs'

const f = (key, type, label, extra) => Object.assign({ key, type, label }, extra || {})
export const PROJECT = { key: 'project', label: 'Projects', title: 'name', fields: [f('name', 'text', 'Name', { required: true }), f('owner', 'text', 'Owner')] }
export const TASK = {
  key: 'task', label: 'Tasks', title: 'name',
  fields: [
    f('name', 'text', 'Name', { required: true }),
    f('status', 'choice', 'Status', { options: [{ key: 'todo', label: 'To do', color: 'gray' }, { key: 'doing', label: 'Doing', color: 'blue' }, { key: 'done', label: 'Done', color: 'green' }] }),
    f('due', 'date', 'Due'),
    f('amount', 'money', 'Budget', { currency: 'EUR', precision: 2 }),
    f('email', 'email', 'Contact', { protection: 'personal' }),
    f('token', 'text', 'Access code', { protection: 'secret' }),
    f('tags', 'multichoice', 'Tags', { options: [{ key: 'web', label: 'Web' }, { key: 'ops', label: 'Ops' }, { key: 'legal', label: 'Legal' }] }),
    f('urgent', 'checkbox', 'Urgent'),
    f('project', 'relation', 'Project', { to: 'project', many: false }),
  ],
}

/** Day `n` from `today` as a calendar day (UTC arithmetic: the check and the page agree on « today » only through the host's own answer). */
export const dayFrom = (today, n) => { const d = new Date(today + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }

export function seedHome ({ dshHome, today, by = 'agent' }) {
  const service = makeService({ dir: join(dshHome, 'kybernos', 'kybernos-db', 'dbs') })
  const found = service.list().find((d) => d.name === 'Home')
  if (found !== undefined) { service.close(); return { id: found.id, made: false } }
  const made = service.create({ name: 'Home', by })
  if (made.ok !== true) throw new Error('seed: ' + JSON.stringify(made))
  const db = made.db
  for (const o of [PROJECT, TASK]) { const r = db.addObject(o, by); if (r.ok !== true) throw new Error('seed object: ' + JSON.stringify(r)) }
  const p = (name, owner) => { const r = db.create('project', { name, owner }, by); if (r.ok !== true) throw new Error('seed project: ' + JSON.stringify(r)); return r.record.id }
  const launch = p('Launch', 'Ines'); const books = p('Books', 'Sam')
  const tasks = [
    { name: 'Write the launch post', status: 'doing', due: dayFrom(today, 2), amount: 450, email: 'ines@example.test', tags: ['web'], urgent: true, project: launch },
    { name: 'Fix the rounding bug', status: 'todo', due: dayFrom(today, -3), amount: 120.5, tags: ['web', 'ops'], urgent: true, project: launch },
    { name: 'Order the badges', status: 'todo', due: dayFrom(today, 9), amount: 80, project: launch },
    { name: 'Close the October books', status: 'doing', due: dayFrom(today, 1), amount: 2300, tags: ['legal'], project: books, token: 'ledger-4471' },
    { name: 'Send the VAT return', status: 'todo', due: dayFrom(today, -10), amount: 0, tags: ['legal'], project: books },
    { name: 'Archive last year', status: 'done', due: dayFrom(today, -40), project: books },
    { name: 'Rotate the keys', status: 'done', due: dayFrom(today, -6), tags: ['ops'] },
    { name: 'A task with a very long name that has to be cut by the table and not by the card, or the row would grow without end', status: 'todo', due: dayFrom(today, 20) },
    { name: 'No date, no status' },
  ]
  for (const t of tasks) { const r = db.create('task', t, by); if (r.ok !== true) throw new Error('seed task: ' + JSON.stringify(r)) }
  const open = db.saveView('task', { name: 'Open tasks', kind: 'table', fav: true, owner: 'me', state: { flt: { conj: 'and', items: [{ k: 'status', op: 'nin', v: ['done'] }] }, sorts: [{ k: 'due', dir: 'asc' }], hidden: ['token', 'email'] } }, 'person')
  if (open.ok !== true) throw new Error('seed view: ' + JSON.stringify(open))
  return { id: db.info().id, made: true, db }
}

// A small shop for the links: customers, products, and orders that point at both. The orders start with no link at all, so the check makes them the way a person does.
export const CUSTOMER = { key: 'customer', label: 'Customers', title: 'name', fields: [f('name', 'text', 'Name', { required: true }), f('city', 'text', 'City')] }
export const ITEM = { key: 'item', label: 'Products', title: 'name', fields: [f('name', 'text', 'Name', { required: true }), f('price', 'money', 'Price', { currency: 'EUR', precision: 2 })] }
export const ORDER = {
  key: 'order', label: 'Orders', title: 'ref',
  fields: [f('ref', 'text', 'Reference', { required: true }), f('customer', 'relation', 'Customer', { to: 'customer', many: false, inverse: 'Purchases' }), f('items', 'relation', 'Products', { to: 'item', many: true }), f('note', 'text', 'Note')],
}

export function seedShop ({ dshHome, by = 'agent' }) {
  const service = makeService({ dir: join(dshHome, 'kybernos', 'kybernos-db', 'dbs') })
  const found = service.list().find((d) => d.name === 'Shop')
  if (found !== undefined) { service.close(); return { id: found.id, made: false } }
  const made = service.create({ name: 'Shop', by })
  if (made.ok !== true) throw new Error('seed: ' + JSON.stringify(made))
  const db = made.db
  for (const o of [CUSTOMER, ITEM, ORDER]) { const r = db.addObject(o, by); if (r.ok !== true) throw new Error('seed object: ' + JSON.stringify(r)) }
  const add = (object, values) => { const r = db.create(object, values, by); if (r.ok !== true) throw new Error('seed ' + object + ': ' + JSON.stringify(r)) }
  add('customer', { name: 'Ada Lovelace', city: 'London' }); add('customer', { name: 'Bob Stone', city: 'Leeds' })
  add('item', { name: 'Pen', price: 2.5 }); add('item', { name: 'Ink', price: 7 }); add('item', { name: 'Paper', price: 4.2 })
  add('order', { ref: 'A-1001' }); add('order', { ref: 'A-1002' })
  return { id: db.info().id, made: true, db }
}

/** A db of documents: a name and a field of files with a small cap (20,000 bytes) so a refusal can be tried with a small file. */
export const DOC = { key: 'doc', label: 'Docs', title: 'name', fields: [f('name', 'text', 'Name', { required: true }), f('files', 'attachment', 'Files', { maxBytes: 20000 })] }
export function seedPapers ({ dshHome, by = 'agent' }) {
  const service = makeService({ dir: join(dshHome, 'kybernos', 'kybernos-db', 'dbs') })
  const found = service.list().find((d) => d.name === 'Papers')
  if (found !== undefined) { service.close(); return { id: found.id, made: false } }
  const made = service.create({ name: 'Papers', by })
  if (made.ok !== true) throw new Error('seed: ' + JSON.stringify(made))
  const db = made.db
  const o = db.addObject(DOC, by)
  if (o.ok !== true) throw new Error('seed object: ' + JSON.stringify(o))
  for (const name of ['Contract', 'Receipts']) { const r = db.create('doc', { name }, by); if (r.ok !== true) throw new Error('seed doc: ' + JSON.stringify(r)) }
  return { id: db.info().id, made: true, db }
}

/** Small files for the checks of the files field, as base64 (a page builds real File objects from them): a 12 x 8 image, a PDF, a text file and one over the Docs cap. */
const PDF_TEXT = '%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n'
export const FILE_FIXTURES = {
  png: { name: 'logo.png', type: 'image/png', b64: 'iVBORw0KGgoAAAANSUhEUgAAAAwAAAAICAIAAABChommAAAAEUlEQVR4nGM4YWNDEDGMKgIAmbN4AU3jx3MAAAAASUVORK5CYII=' },
  pdf: { name: 'contract.pdf', type: 'application/pdf', b64: Buffer.from(PDF_TEXT).toString('base64') },
  txt: { name: 'notes.txt', type: 'text/plain', b64: Buffer.from('plain notes\n').toString('base64') },
  big: { name: 'big.bin', type: 'application/octet-stream', b64: Buffer.alloc(25000, 120).toString('base64') },
}
export const bytesOf = (f) => Buffer.from(f.b64, 'base64')
export const shaOf = (f) => createHash('sha256').update(bytesOf(f)).digest('hex')

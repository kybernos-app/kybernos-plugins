// test-host.mjs: the host half of kybernos-catalog, hermetic. The business base is the REAL one (packages/kybernos-plugin/business-base.mjs) over a temp
// file: a test may reach across bundles, the plugin's own code never does. The registry and the web server are small fakes.
//
//   node packages/kybernos-catalog/test-host.mjs
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createBusinessBase } from '../kybernos-plugin/business-base.mjs'
import { CATALOG_POINT_REF } from './catalog-type.mjs'
import { DEFAULT_TYPE, checkFields, createCatalog } from './catalog-core.mjs'
import { apply, mountRoutes, mountTools, routeTable } from './index.js'
import { sessionSource } from './session-guard.mjs'
import { SESSION_SECRET, browserHeaders } from './lib-session-test.mjs'

let failed = 0
const ok = (label, cond, detail) => {
  if (cond) console.log('✓ ' + label + (detail === undefined ? '' : ' (' + detail + ')'))
  else { console.error('✗ ' + label + (detail === undefined ? '' : ' — ' + detail)); failed += 1 }
}
sessionSource.secret = () => SESSION_SECRET

const dir = mkdtempSync(join(tmpdir(), 'kb-catalog-host-'))
process.on('exit', () => { try { rmSync(dir, { recursive: true, force: true }) } catch (e) { /* gone */ } })
let n = 0
const newBase = () => createBusinessBase({ file: join(dir, 'b' + (n += 1) + '.sqlite') })
const L = (en, fr) => (fr === undefined ? { en } : { en, fr })

const PRODUCT = {
  id: 'product', label: L('Product', 'Produit'), plural: L('Products', 'Produits'), icon: 'package',
  statuses: [{ key: 'live', tone: 'ok', label: L('Live') }, { key: 'low', tone: 'warn', label: L('Low') }, { key: 'out', tone: 'bad', label: L('Out of stock') }],
  fields: [{ key: 'sku', type: 'text' }, { key: 'stock', type: 'number' }, { key: 'price', type: 'money', currency: 'EUR' }, { key: 'size', type: 'choice', options: ['s', 'm'] }, { key: 'since', type: 'date' }, { key: 'site', type: 'url' }, { key: 'owner', type: 'email' }],
  card: { title: 'title', subtitle: 'sku', price: 'price', flag: { field: 'stock', lte: 10, label: L('Only {n} left') } },
  views: ['cards', 'list'],
}
const SERVICE = { id: 'service', label: L('Service'), plural: L('Services'), statuses: [{ key: 'open', label: L('Open') }], fields: [], card: {}, views: ['list'] }
const registryWith = (...values) => ({ version: 1, contributions: (ref) => (ref === CATALOG_POINT_REF ? values.map((value) => ({ plugin: 'acme/theme', level: 'local', class: 'inert', file: value.id + '.json', value })) : []) })
const catalogOver = (base, registry) => createCatalog({ base: () => base, registry: () => registry })
// reading the journal is an export, and an export is journalled: leave those lines out of what is measured
const changes = (base) => base.exportAll({ actor: 'person' }).tables.changes.filter((x) => x.action !== 'export')

// ── types ──────────────────────────────────────────────────────────────────────────────────────────────
{
  const none = createCatalog({ base: () => null, registry: () => null }).types()
  ok('no registry: the one plain default type', none.ok === true && none.source === 'default' && none.types.length === 1 && none.types[0].id === 'item')
  ok('the default type is Item with statuses Draft, Live, Archived, and it passes the point\'s own check', DEFAULT_TYPE.label.en === 'Item' && DEFAULT_TYPE.statuses.map((s) => s.label.en).join() === 'Draft,Live,Archived')
  const t = registryWith(PRODUCT, SERVICE, PRODUCT, { id: 'broken' })
  const got = createCatalog({ registry: () => t }).types()
  ok('a theme\'s types are served, a repeated id once, a value the check refuses is left out', got.source === 'theme' && got.types.map((x) => x.id).join() === 'product,service')
  ok('a registry with no contribution falls back to the default type', createCatalog({ registry: () => registryWith() }).types().source === 'default')
  ok('a registry that throws, or of another version, falls back to the default type', createCatalog({ registry: () => ({ version: 1, contributions () { throw new Error('boom') } }) }).types().source === 'default' && createCatalog({ registry: () => ({ version: 2, contributions: () => [] }) }).types().source === 'default')
  ok('a registry port that throws does not escape', createCatalog({ registry: () => { throw new Error('boom') } }).types().source === 'default')
}

// ── no base: every question answers base_missing and nothing throws ────────────────────────────────────────
{
  const c = createCatalog({ base: () => null, registry: () => null })
  const answers = [c.list({}), c.get(1), c.create({ title: 'x' }), c.update(1, { title: 'y' }), c.archive(1), c.restore(1), c.clearDemo(), c.find({}), c.upsert({ title: 'x' })]
  ok('without the shared base every operation says base_missing', answers.every((a) => a.ok === false && a.error === 'base_missing'), JSON.stringify(answers.map((a) => a.error)))
  const thrower = createCatalog({ base: () => { throw new Error('boom') } })
  ok('a base port that throws is the same as no base', thrower.list({}).error === 'base_missing')
  const broken = createCatalog({ base: () => ({ version: 1, list () { throw new Error('disk gone') } }) })
  ok('a base that throws is answered, not thrown', broken.list({}).ok === false && broken.list({}).error === 'failed')
}

// ── writes, reads and the journal over the real base ───────────────────────────────────────────────────────
{
  const base = newBase()
  const c = catalogOver(base, registryWith(PRODUCT, SERVICE))
  const made = c.create({ title: 'Linen apron', subtitle: 'Ref A1', price_text: '€39', price_num: 39, fields: { sku: 'A1', stock: 3, price: 39 } })
  ok('create: the first type and its first status are the defaults', made.ok === true && made.row.type === 'product' && made.row.status === 'live' && made.row.fields.stock === 3, JSON.stringify(made))
  ok('create needs a title', c.create({ type: 'product' }).error === 'missing_field')
  ok('create refuses an unknown type', c.create({ title: 'x', type: 'boat' }).error === 'unknown_type')
  ok('create refuses a status the type does not have', c.create({ title: 'x', type: 'product', status: 'open' }).error === 'unknown_status')
  ok('create refuses a field the type does not define', c.create({ title: 'x', fields: { colour: 'red' } }).error === 'unknown_field')
  ok('create refuses a column that does not exist', c.create({ title: 'x', demo: 1 }).error === 'unknown_field')
  ok('the page cannot set demo, archived or the dates', ['demo', 'archived_at', 'created_at', 'id'].every((k) => c.create({ title: 'x', [k]: 1 }).ok === false))
  ok('a second type is chosen by its key', c.create({ title: 'Delivery', type: 'service' }).row.status === 'open')
  ok('update: a patch changes only what it names, and the stock merges into the stored fields', (() => {
    const r = c.update(made.row.id, { status: 'low', fields: { stock: 2 } })
    return r.ok === true && r.row.status === 'low' && r.row.fields.stock === 2 && r.row.fields.sku === 'A1' && r.row.title === 'Linen apron'
  })())
  ok('a null clears one field', c.update(made.row.id, { fields: { sku: null } }).row.fields.sku === undefined)
  ok('update refuses a status of another type, an unknown row and nothing to change', c.update(made.row.id, { status: 'open' }).error === 'unknown_status' && c.update(99999, { title: 'x' }).error === 'not_found' && c.update(made.row.id, {}).ok === false)
  ok('update by a bad id is refused before the base is asked', c.update('1; DROP', { title: 'x' }).error === 'bad_id' && c.get(1.5).error === 'bad_id')
  ok('field values are checked by kind', [
    checkFields(PRODUCT, { stock: 'many' }).error === 'bad_field',
    checkFields(PRODUCT, { size: 'xl' }).error === 'bad_field',
    checkFields(PRODUCT, { since: '2026-13-45' }).error === 'bad_field',
    checkFields(PRODUCT, { site: 'javascript:alert(1)' }).error === 'bad_field',
    checkFields(PRODUCT, { owner: 'nobody' }).error === 'bad_field',
    checkFields(PRODUCT, { sku: '<b>x</b>' }).error === 'bad_field',
    checkFields(PRODUCT, { stock: Infinity }).error === 'bad_field',
    checkFields(PRODUCT, { size: 's', since: '2026-12-31', site: 'https://example.com/a', owner: 'a@example.com', stock: 0, price: 12.5, sku: ' A ' }).fields.sku === 'A',
    checkFields(PRODUCT, 'x').error === 'bad_field',
  ].every(Boolean))
  ok('a row of a type no theme defines can still change its title, but not its status', (() => {
    const orphan = base.create('item', { type: 'old-kind', title: 'Orphan', status: 'gone', fields: { legacy: 1 } }, { actor: 'seed' }).row
    const t = c.update(orphan.id, { title: 'Orphan renamed' })
    const s = c.update(orphan.id, { status: 'live' })
    const f = c.update(orphan.id, { fields: { sku: 'x' } })
    const back = c.update(orphan.id, { type: 'product', status: 'live', fields: { sku: 'x' } })
    return t.ok === true && t.row.fields.legacy === 1 && s.error === 'unknown_type' && f.error === 'unknown_type' && back.ok === true && back.row.fields.legacy === 1
  })())

  const page = c.list({})
  ok('list: the rows, the total and the status counts', page.ok === true && page.total === page.rows.length && page.counts.low === 1 && page.counts.open === 1, JSON.stringify(page.counts))
  ok('list filters: q, type, status', c.list({ q: 'apron' }).total === 1 && c.list({ type: 'service' }).total === 1 && c.list({ status: 'low' }).rows[0].title === 'Linen apron' && c.list({ q: 'zzz' }).total === 0)
  ok('the counts of a status filter still count every status', (() => { const r = c.list({ status: 'low' }); return r.total === 1 && r.counts.open === 1 && r.counts.low === 1 })())
  ok('a search with SQL wildcards finds nothing it should not', c.list({ q: '%' }).total === 0 && c.list({ q: "'; DROP TABLE item; --" }).total === 0 && c.list({}).total > 0)
  ok('paging: limit is clamped to 500 and offset moves the window', c.list({ limit: 100000 }).limit === 500 && c.list({ limit: 1, offset: 1 }).rows.length === 1 && c.list({ limit: 0 }).limit === 1 && c.list({ limit: 'abc' }).limit === 100)

  ok('archive hides a row, the archived view shows it, restore brings it back', (() => {
    const a = c.archive(made.row.id)
    const hidden = c.list({}).rows.every((r) => r.id !== made.row.id)
    const only = c.list({ archived: 'only' })
    const shown = only.rows.length === 1 && only.rows[0].id === made.row.id && only.total === 1
    const r = c.restore(made.row.id)
    return a.ok === true && a.row.archived_at !== null && hidden && shown && r.ok === true && r.row.archived_at === null && c.list({}).rows.some((x) => x.id === made.row.id)
  })())
  ok('get answers a row and not_found', c.get(made.row.id).row.title === 'Linen apron' && c.get(424242).error === 'not_found')

  const log = changes(base).filter((x) => x.tbl === 'item')
  ok('every write left a journal line, the actor of a person', log.length >= 5 && log.every((x) => x.actor === 'person' || x.actor === 'seed'), log.map((x) => x.actor + ':' + x.action).join())
}

// ── sample rows ────────────────────────────────────────────────────────────────────────────────────────────
{
  const base = newBase()
  const c = catalogOver(base, null)
  base.seed({ items: [{ title: 'Sample chair', type: 'item', status: 'live' }, { title: 'Sample desk', type: 'item', status: 'draft' }], contacts: [{ name: 'Sample person' }] }, { theme: 'acme/shop' })
  c.create({ title: 'Mine' })
  const page = c.list({})
  ok('demo counts: sample items and every sample row of the three tables', page.demo.items === 2 && page.demo.all === 3, JSON.stringify(page.demo))
  ok('a sample row says it is a sample', page.rows.filter((r) => r.demo === true).length === 2)
  const cleared = c.clearDemo()
  ok('clearDemo removes the sample rows and keeps mine', cleared.ok === true && cleared.removed.item === 2 && cleared.removed.contact === 1 && c.list({}).total === 1 && c.list({}).demo.items === 0, JSON.stringify(cleared))
}

// ── the agent tools ────────────────────────────────────────────────────────────────────────────────────
{
  const base = newBase()
  const c = catalogOver(base, registryWith(PRODUCT))
  const registered = []
  mountTools({ register: (t) => registered.push(t) }, c)
  ok('two tools are registered, with the shape tools.register needs', registered.map((t) => t.name).join() === 'catalog_find,catalog_upsert' && registered.every((t) => typeof t.execute === 'function' && typeof t.description === 'string' && t.parameters.type === 'object' && t.parameters.additionalProperties === false && typeof t.output.render === 'function'))
  const [find, upsert] = registered
  const made = await upsert.execute({ title: 'Agent made', type: 'product', fields: { stock: 1 } })
  ok('catalog_upsert adds an item and the journal says agent', made.ok === true && made.created === true && made.item.title === 'Agent made' && changes(base).some((x) => x.actor === 'agent' && x.action === 'create'))
  const changed = await upsert.execute({ id: made.item.id, status: 'out' })
  ok('catalog_upsert changes an item by id (actor agent)', changed.ok === true && changed.created === false && changed.item.status === 'out' && changes(base).some((x) => x.actor === 'agent' && x.action === 'update'))
  ok('catalog_upsert refuses what a person\'s write would refuse', (await upsert.execute({ title: 'x', status: 'nope' })).error === 'unknown_status' && (await upsert.execute({ id: made.item.id })).error === 'missing_field' && (await upsert.execute({ id: 'abc', title: 'x' })).error === 'bad_id' && (await upsert.execute(null)).ok === false)
  ok('an agent cannot write the marker of a sample row', (await upsert.execute({ title: 'x', demo: 1 })).error === 'unknown_field')
  const before = changes(base).length
  const found = await find.execute({ q: 'agent' })
  ok('catalog_find reads, free: it finds the item and writes no journal line', found.ok === true && found.count === 1 && found.items[0].title === 'Agent made' && found.items[0].archived === false && changes(base).length === before)
  await base.archive('item', made.item.id, { actor: 'person' })
  ok('catalog_find leaves archived items out unless asked, and caps the page at 50', (await find.execute({ q: 'agent' })).count === 0 && (await find.execute({ q: 'agent', include_archived: true })).count === 1 && (await find.execute({ limit: 9999 })).ok === true)
  ok('the render of both tools answers in text, success and failure', registered.every((t) => t.output.render({}, { ok: false, error: 'base_missing' })[0].text.includes('base_missing')) && find.output.render({}, found)[0].text.includes('Agent made'))
  ok('without the base the tools answer, not throw', await (async () => { const lone = createCatalog({ base: () => null }); const r = []; mountTools({ register: (t) => r.push(t) }, lone); return (await r[0].execute({})).error === 'base_missing' && (await r[1].execute({ title: 'x' })).error === 'base_missing' })())
  const src = readFileSync(new URL('./catalog-tools.mjs', import.meta.url), 'utf8') + readFileSync(new URL('./catalog-core.mjs', import.meta.url), 'utf8')
  ok('the tools and the core reach no network and send nothing', !/\bfetch\s*\(|node:https?|node:net|node:child_process|XMLHttpRequest|WebSocket|\bsend(Mail|Message)\b/.test(src))
}

// ── the routes, over a fake server ────────────────────────────────────────────────────────────────────────
const fakeServer = () => { const routes = {}; return { routes, register: (r) => { routes[r.path] = r.handler; return () => { delete routes[r.path] } } } }
const hit = async (server, path, method, { headers = browserHeaders(), body, raw, query = '' } = {}) => {
  const data = raw !== undefined ? raw : (body === undefined ? '' : JSON.stringify(body))
  const req = { method, url: path + query, headers: { host: '127.0.0.1:3080', ...(method === 'POST' ? { 'content-type': 'application/json' } : {}), ...headers }, socket: { localPort: 3080 }, on: (ev, fn) => { if (ev === 'data' && data !== '') fn(data); if (ev === 'end') setTimeout(() => fn(), 0) } }
  const out = { code: 200, body: '', json: null }
  await server.routes[path](req, { setHeader () {}, writeHead (c) { out.code = c }, end (b) { out.body = String(b === undefined ? '' : b) } })
  try { out.json = JSON.parse(out.body) } catch (e) { out.json = null }
  return out
}
{
  const base = newBase()
  const c = catalogOver(base, registryWith(PRODUCT))
  const server = fakeServer()
  mountRoutes(server, c)
  ok('eight routes are mounted, all under /kybernos-catalog', Object.keys(server.routes).length === 8 && Object.keys(server.routes).every((p) => p.startsWith('/kybernos-catalog/')) && routeTable(c).length === 8)
  const types = await hit(server, '/kybernos-catalog/types', 'GET')
  ok('GET types serves the theme\'s types', types.code === 200 && types.json.source === 'theme' && types.json.types[0].id === 'product')
  const created = await hit(server, '/kybernos-catalog/create', 'POST', { body: { title: 'Via route', fields: { stock: 4 } } })
  ok('POST create writes through the guard and answers the row', created.code === 200 && created.json.ok === true && created.json.row.fields.stock === 4)
  const id = created.json.row.id
  const listed = await hit(server, '/kybernos-catalog/list', 'GET', { query: '?q=route&status=live&limit=10' })
  ok('GET list takes q, status and limit from the query', listed.json.ok === true && listed.json.total === 1 && listed.json.rows[0].id === id)
  ok('GET get takes the id', (await hit(server, '/kybernos-catalog/get', 'GET', { query: '?id=' + id })).json.row.title === 'Via route' && (await hit(server, '/kybernos-catalog/get', 'GET', { query: '?id=abc' })).json.error === 'bad_id')
  ok('POST update, archive, restore take the id in the body', (await hit(server, '/kybernos-catalog/update', 'POST', { body: { id, patch: { title: 'Renamed' } } })).json.row.title === 'Renamed' &&
    (await hit(server, '/kybernos-catalog/archive', 'POST', { body: { id } })).json.row.archived_at !== null &&
    (await hit(server, '/kybernos-catalog/restore', 'POST', { body: { id } })).json.row.archived_at === null)
  ok('clear-demo needs { confirm: true }', (await hit(server, '/kybernos-catalog/clear-demo', 'POST', { body: {} })).json.error === 'confirm_required' && (await hit(server, '/kybernos-catalog/clear-demo', 'POST', { body: { confirm: true } })).json.ok === true)
  ok('a route answers 405 to the wrong method', (await hit(server, '/kybernos-catalog/list', 'POST', { body: {} })).code === 405 && (await hit(server, '/kybernos-catalog/create', 'GET')).code === 405)
  ok('a body that is not JSON is 400, not a JSON object is 400, another content type is 415, too large is 413', (await hit(server, '/kybernos-catalog/create', 'POST', { raw: '{nope' })).code === 400 &&
    (await hit(server, '/kybernos-catalog/create', 'POST', { raw: '[1]' })).code === 400 &&
    (await hit(server, '/kybernos-catalog/create', 'POST', { headers: { ...browserHeaders(), 'content-type': 'text/plain' }, body: { title: 'x' } })).code === 415 &&
    (await hit(server, '/kybernos-catalog/create', 'POST', { raw: JSON.stringify({ title: 'x'.repeat(40000) }) })).code === 413)
  ok('the base refusing a value is an ok:false answer with its code', (await hit(server, '/kybernos-catalog/create', 'POST', { body: { title: 'x'.repeat(201) } })).json.error === 'bad_field')
  ok('the page cannot see another route name: unknown path is not mounted', server.routes['/kybernos-catalog/delete'] === undefined && server.routes['/kybernos-catalog/export'] === undefined)
}

// ── apply: lazy, guarded, never stops DSH ───────────────────────────────────────────────────────────────
{
  const quiet = { schedule: () => undefined }
  const log = console.log
  const quietly = (fn) => { console.log = () => {}; try { return fn() } finally { console.log = log } }
  {
    let read = 0
    const was = Object.getOwnPropertyDescriptor(globalThis, Symbol.for('kybernos.business'))
    Object.defineProperty(globalThis, Symbol.for('kybernos.business'), { configurable: true, get () { read += 1; return undefined } })
    const server = fakeServer()
    const tools = []
    const effects = []
    const ctx = { get: (k) => (k === 'webServer' ? server : undefined), inject: (names, fn) => { if (names[0] === 'tools') fn({ tools: { register: (t) => tools.push(t) } }) }, effect: (fn, label) => effects.push([fn, label]) }
    let threw = false
    try { quietly(() => apply(ctx, quiet)) } catch (e) { threw = true }
    ok('apply mounts the routes and the tools and does not read the base at boot', !threw && Object.keys(server.routes).length === 8 && tools.length === 2 && read === 0, 'reads: ' + read)
    const answered = await hit(server, '/kybernos-catalog/list', 'GET')
    ok('a question reads the seam at request time and says base_missing when it is absent', read > 0 && answered.json.ok === false && answered.json.error === 'base_missing', answered.body)
    ok('an effect gives the routes back on unload', effects.length === 1 && effects[0][1].includes('routes') && (() => { effects[0][0]()(); return true })() && Object.keys(server.routes).length === 0)
    if (was === undefined) delete globalThis[Symbol.for('kybernos.business')]; else Object.defineProperty(globalThis, Symbol.for('kybernos.business'), was)

    const attempts = [undefined, null, {}, { get () { throw new Error('boom') } }, { get: () => undefined }, { get: () => undefined, inject () { throw new Error('boom') } }, { get: () => ({ register () { throw new Error('boom') } }) }, { get: () => undefined, inject: (n, fn) => fn({ tools: { register () { throw new Error('boom') } } }) }, { get: () => undefined, inject: (n, fn) => fn({}) }]
    const survived = attempts.map((a) => { try { quietly(() => apply(a, quiet)); return true } catch (e) { return false } })
    ok('apply survives a missing, partial or throwing context', survived.every(Boolean), survived.join())
  }
}

// ── one template at a time (docs/dev/business-visuals.md) ───────────────────────────────────────────────────────────────
{
  const PROPERTY = { id: 'property', label: L('Property', 'Bien'), plural: L('Properties', 'Biens'), icon: 'home', statuses: [{ key: 'listed', tone: 'ok', label: L('Listed') }, { key: 'sold', tone: 'neutral', label: L('Sold') }], fields: [{ key: 'rooms', type: 'number' }], card: {}, views: ['list'] }
  const reg = { version: 1, contributions: (ref) => (ref === CATALOG_POINT_REF ? [{ plugin: 'k/shop', value: PRODUCT }, { plugin: 'k/house', value: PROPERTY }, { plugin: 'k/house', value: SERVICE }] : []) }
  let scope = null
  const base = createBusinessBase({ file: join(dir, 'one-template.sqlite'), scope: () => scope })
  base.seed({ items: [{ title: 'Mug', type: 'product', status: 'live' }, { title: 'Tote', type: 'product', status: 'live' }] }, { theme: 'k/shop' })
  base.seed({ items: [{ title: 'Canal house', type: 'property', status: 'listed' }] }, { theme: 'k/house' })
  const cat = catalogOver(base, reg)
  ok('no template active: the types of every active theme, as before', cat.types().types.map((t) => t.id).join() === 'product,property,service' && cat.list({}).total === 3)
  scope = 'k/shop'
  const shop = cat.types()
  ok('the shop is active: only its types are offered, and the answer says they are a theme\'s', shop.source === 'theme' && shop.types.map((t) => t.id).join() === 'product')
  const shopList = cat.list({})
  ok('...and only its rows are listed and counted, the sample counts follow, the type chips would too', shopList.total === 2 && shopList.rows.every((r) => r.type === 'product') && shopList.demo.items === 2 && shopList.counts.live === 2, JSON.stringify(shopList.counts))
  ok('a new item can only be one of the active template\'s types', cat.create({ title: 'Villa', type: 'property' }).error === 'unknown_type' && cat.create({ title: 'Candle', type: 'product' }).ok === true)
  ok('the new item belongs to the shop', cat.create({ title: 'Candle 2' }).row.scope === 'k/shop' && base.list('item', { scope: 'k/house' }).total === 1)
  scope = 'k/house'
  ok('the agency is active: its two types, its one sample, the shop\'s rows are not in sight', cat.types().types.map((t) => t.id).join() === 'property,service' && cat.list({}).total === 1 && cat.find({}).count === 1 && cat.list({ type: 'product' }).total === 0)
  ok('an agent\'s upsert follows the same scope', cat.upsert({ title: 'Flat', type: 'property', status: 'listed' }).created === true && base.list('item', { scope: 'k/house' }).total === 2 && cat.upsert({ title: 'Bag', type: 'product' }).error === 'unknown_type')
  ok('clearing the samples removes the agency\'s and keeps the shop\'s', cat.clearDemo().ok === true && base.list('item', { scope: 'k/house', demo: true }).total === 0 && base.list('item', { scope: 'k/shop', demo: true }).total === 2)
  scope = 'k/nothing'
  const empty = cat.types()
  ok('an active template that brings no catalogue type gets the one plain default type, not the others\'', empty.source === 'default' && empty.types[0].id === 'item')
  const old = createCatalog({ base: () => ({ version: 1, list: () => ({ ok: true, rows: [], total: 0 }), counts: () => ({ ok: true, demo: { item: 0, contact: 0, flow_card: 0 } }) }), registry: () => reg })
  ok('a base that cannot say which template is active (an older core) leaves every type on offer', old.types().types.length === 3)
  const mute = createCatalog({ base: () => ({ version: 1, list: () => ({ ok: true, rows: [], total: 0 }), scope: () => { throw new Error('boom') } }), registry: () => reg })
  ok('a base whose scope() throws does the same, and nothing escapes', mute.types().types.length === 3)
  base.close()
}

if (failed > 0) { console.log('test-host: ' + failed + ' failure(s)'); process.exit(1) }
console.log('test-host: all green')

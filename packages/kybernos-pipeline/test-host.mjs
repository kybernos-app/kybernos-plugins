// kybernos-pipeline, the host half: the logic over a REAL business base on a temporary file (nothing of the person's is touched), the boards a theme brings,
// the two agent tools and the gate that makes one of them ask, and that `apply` mounts the routes, the tools and the gate without ever throwing.
//
//   node packages/kybernos-pipeline/test-host.mjs
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createBusinessBase } from '../kybernos-plugin/business-base.mjs'
import { apply, handlerOf, ROUTES } from './index.js'
import { DEFAULT_FLOW, FLOW_POINT, createPipelineHost } from './pipeline-host.mjs'
import { LIST_TOOL, MOVE_TOOL, approvalGate, toolDefinitions } from './pipeline-tools.mjs'

let count = 0
const ok = async (label, fn) => { await fn(); count++; console.log('ok  ', label) }

const dir = mkdtempSync(join(tmpdir(), 'kb-pipeline-host-'))
let n = 0
/** A base on its own file, a host over it and (optionally) a registry that gives `flows` to the point. */
const world = (flows) => {
  const base = createBusinessBase({ file: join(dir, 'b' + (n += 1) + '.sqlite') })
  const registry = flows === undefined ? null : { version: 1, contributions: (point) => (point === FLOW_POINT ? flows.map((value) => ({ plugin: 'acme/shop', level: 'local', class: 'inert', file: 'pipeline/' + value.id + '.json', value })) : []) }
  const host = createPipelineHost({ business: () => base, registry: () => registry })
  const journal = () => base.exportAll({ actor: 'person' }).tables.changes.filter((c) => c.action !== 'export')
  return { base, host, journal }
}
const L = (en, fr) => (fr === undefined ? { en } : { en, fr })
const orders = () => ({ id: 'orders', label: L('Orders', 'Commandes'), newLabel: L('New order'), stages: [{ key: 'new', label: L('New', 'Nouveau') }, { key: 'paid', label: L('Paid', 'Payé') }, { key: 'shipped', label: L('Shipped') }], value: { format: 'money', currency: 'EUR' }, links: { contact: true, item: false } })
const deals = () => ({ id: 'deals', label: L('Deals'), stages: [{ key: 'lead', label: L('Lead') }, { key: 'won', label: L('Won') }], value: { format: 'number' }, links: { contact: false, item: false } })

await ok('without the base every question answers base_missing and nothing throws', async () => {
  const host = createPipelineHost({ business: () => undefined, registry: () => null })
  for (const r of [host.flows(), host.board({}), host.card({ id: '1' }), host.links({ kind: 'contact' }), host.create({}, 'person'), host.update({}, 'person'), host.move({}, 'person'), host.archive({}, 'person'), host.restore({}, 'person'), host.clearDemo('person'), host.agentList({}), host.agentMove({})]) {
    assert.deepEqual(r, { ok: false, error: 'base_missing', detail: 'the business base is not mounted' })
  }
  const broken = createPipelineHost({ business: () => { throw new Error('boom') } })
  assert.equal(broken.flows().error, 'base_missing')
  assert.equal(createPipelineHost().board({}).error, 'base_missing')
  const odd = createPipelineHost({ business: () => ({ version: 1, list: () => { throw new Error('disk gone') }, counts: () => { throw new Error('disk gone') } }) })
  assert.deepEqual([odd.flows().ok, odd.flows().error], [false, 'failed'])
  assert.equal(createPipelineHost({ business: () => ({ version: 2 }) }).flows().error, 'base_missing', 'a base of another version is not spoken to')
})

await ok('with no theme the one plain board is used: New, In progress, Done', async () => {
  const { host } = world(undefined)
  const f = host.flows()
  assert.equal(f.ok, true)
  assert.deepEqual(f.flows.map((x) => [x.id, x.source, x.cards]), [['default', 'default', 0]])
  assert.deepEqual(f.flows[0].stages.map((s) => s.key), ['new', 'in-progress', 'done'])
  assert.equal(f.theme, false)
  const b = host.board({})
  assert.deepEqual(b.columns.map((c) => [c.stage, c.count, c.total]), [['new', 0, 0], ['in-progress', 0, 0], ['done', 0, 0]])
  assert.equal(b.flow.id, 'default')
  assert.equal(Object.isFrozen(DEFAULT_FLOW) && Object.isFrozen(DEFAULT_FLOW.stages), true)
  const c = host.create({ flow: 'default', title: 'First card' }, 'person')
  assert.equal(c.ok, true, JSON.stringify(c))
  assert.equal(c.card.stage, 'new', 'the first stage when none is given')
  assert.equal(host.flows().flows[0].cards, 1)
})

await ok('a theme brings its boards: order, labels, value format; a registry that hands over junk loses only the junk', async () => {
  const bad = { id: 'broken', label: 'nope', stages: [] }
  const { host } = world([orders(), bad, deals(), orders()])
  const f = host.flows()
  assert.deepEqual(f.flows.map((x) => x.id), ['orders', 'deals'], 'the invalid file is skipped, the duplicate id is read once')
  assert.equal(f.theme, true)
  assert.deepEqual(f.flows[0].value, { format: 'money', currency: 'EUR' })
  assert.equal(f.flows[0].theme, 'acme/shop')
  assert.equal(host.board({}).flow.id, 'orders', 'the first board of the theme is the one shown by default')
  assert.equal(host.board({ flow: 'deals' }).flow.id, 'deals')
  const none = world([])
  assert.equal(none.host.flows().flows[0].id, 'default', 'a theme with no board leaves the plain one')
  const noContrib = createPipelineHost({ business: () => none.base, registry: () => ({ version: 1 }) })
  assert.equal(noContrib.flows().flows[0].id, 'default')
  const throwing = createPipelineHost({ business: () => none.base, registry: () => ({ version: 1, contributions: () => { throw new Error('boom') } }) })
  assert.equal(throwing.flows().flows[0].id, 'default')
})

await ok('create, update, archive and restore a card; every write leaves one line in the journal, by the person', async () => {
  const { base, host, journal } = world([orders()])
  const contact = base.create('contact', { name: 'Jonas Weber', kind: 'person' }, { actor: 'person' }).row
  const c = host.create({ flow: 'orders', stage: 'paid', title: '#1046', subtitle: '2 items', value: 63.1, contact_id: contact.id }, 'person')
  assert.equal(c.ok, true, JSON.stringify(c))
  assert.deepEqual([c.card.stage, c.card.value, c.card.contact.name, c.card.item, c.card.demo, c.card.archived], ['paid', 63.1, 'Jonas Weber', null, false, false])
  const u = host.update({ id: c.card.id, title: '#1046 · Jonas', value: null, contact_id: null }, 'person')
  assert.deepEqual([u.ok, u.card.title, u.card.value, u.card.contact], [true, '#1046 · Jonas', null, null])
  const a = host.archive({ id: c.card.id }, 'person')
  assert.equal(a.card.archived, true)
  assert.equal(host.board({ flow: 'orders' }).count, 0, 'an archived card leaves the board')
  const withArchived = host.board({ flow: 'orders', archived: '1' })
  assert.deepEqual(withArchived.archived.map((x) => x.id), [c.card.id])
  assert.equal(host.restore({ id: c.card.id }, 'person').card.archived, false)
  assert.equal(host.board({ flow: 'orders' }).count, 1)
  assert.deepEqual(journal().filter((x) => x.tbl === 'flow_card').map((x) => [x.action, x.actor]), [['create', 'person'], ['update', 'person'], ['archive', 'person'], ['restore', 'person']])
  assert.equal(host.card({ id: String(c.card.id) }).card.title, '#1046 · Jonas')
  assert.equal(host.card({ id: String(c.card.id) }).flow.id, 'orders')
})

await ok('a move goes to the end of the new column, in the journal once; the same stage changes nothing and writes nothing', async () => {
  const { host, journal } = world([orders()])
  const a = host.create({ flow: 'orders', stage: 'new', title: 'A', value: 10 }, 'person').card
  const b = host.create({ flow: 'orders', stage: 'new', title: 'B', value: 20 }, 'person').card
  const c = host.create({ flow: 'orders', stage: 'paid', title: 'C', value: 5 }, 'person').card
  const before = journal().length
  const m = host.move({ id: a.id, stage: 'paid' }, 'person')
  assert.deepEqual([m.ok, m.unchanged, m.from, m.to, m.card.stage], [true, false, 'new', 'paid', 'paid'])
  assert.ok(m.card.position > c.position, 'at the end of the column')
  assert.equal(journal().length, before + 1)
  const last = journal().pop()
  assert.deepEqual([last.action, last.actor, last.tbl, last.row_id], ['move', 'person', 'flow_card', a.id])
  const same = host.move({ id: a.id, stage: 'paid' }, 'person')
  assert.deepEqual([same.ok, same.unchanged], [true, true])
  assert.equal(journal().length, before + 1, 'no line for a move to where the card already is')
  const board = host.board({ flow: 'orders' })
  assert.deepEqual(board.columns.map((x) => [x.stage, x.count, x.total]), [['new', 1, 20], ['paid', 2, 15], ['shipped', 0, 0]])
  assert.deepEqual(board.columns[1].cards.map((x) => x.title), ['C', 'A'], 'the column keeps the order of arrival')
  assert.equal(board.total, 35)
  assert.equal(board.demoCards, 0)
  void b
})

await ok('what a move may not do: an unknown stage, an archived card, a stage that is not a key, a card that does not exist', async () => {
  const { host, journal } = world([orders()])
  const a = host.create({ flow: 'orders', title: 'A' }, 'person').card
  const before = journal().length
  assert.equal(host.move({ id: a.id, stage: 'lost' }, 'person').error, 'unknown_stage')
  assert.equal(host.move({ id: a.id, stage: 'Not A Key' }, 'person').error, 'bad_field')
  assert.equal(host.move({ id: 9999, stage: 'paid' }, 'person').error, 'not_found')
  assert.equal(host.move({ id: 'x', stage: 'paid' }, 'person').error, 'bad_id')
  assert.equal(host.move({ id: a.id, stage: 'paid', position: 0 }, 'person').error, 'unknown_field')
  assert.equal(host.move('nope', 'person').error, 'bad_field')
  host.archive({ id: a.id }, 'person')
  assert.equal(host.move({ id: a.id, stage: 'paid' }, 'person').error, 'archived')
  assert.equal(journal().length, before + 1, 'only the archive was written')
})

await ok('what a write may not do: unknown keys, a stage in an update, links the board does not take, the wrong shapes', async () => {
  const { base, host } = world([orders(), deals()])
  const person = base.create('contact', { name: 'Ada' }, { actor: 'person' }).row
  const item = base.create('item', { title: 'Mug' }, { actor: 'person' }).row
  assert.equal(host.create({ flow: 'orders', title: 'x', colour: 'red' }, 'person').error, 'unknown_field')
  assert.equal(host.create({ flow: 'orders', stage: 'nope', title: 'x' }, 'person').error, 'unknown_stage')
  assert.equal(host.create({ flow: 'nope', title: 'x' }, 'person').error, 'unknown_flow')
  assert.equal(host.create({ flow: 'Bad Flow', title: 'x' }, 'person').error, 'bad_field')
  assert.equal(host.create({ flow: 'orders' }, 'person').error, 'missing_field', 'a title is required (the base says so)')
  assert.equal(host.create({ flow: 'orders', title: '' }, 'person').error, 'bad_field')
  assert.equal(host.create({ flow: 'orders', title: 'x', value: 'ten' }, 'person').error, 'bad_field')
  assert.equal(host.create({ flow: 'orders', title: 'x', contact_id: 9999 }, 'person').error, 'bad_ref')
  assert.equal(host.create({ flow: 'orders', title: 'x', item_id: item.id }, 'person').error, 'link_not_allowed', 'orders link contacts, not items')
  assert.equal(host.create({ flow: 'deals', title: 'x', contact_id: person.id }, 'person').error, 'link_not_allowed')
  assert.equal(host.create({ flow: 'orders', title: 'ok', contact_id: person.id }, 'person').ok, true)
  assert.equal(host.create(null, 'person').error, 'bad_field')
  assert.equal(host.create([], 'person').error, 'bad_field')
  const card = host.create({ flow: 'deals', title: 'D' }, 'person').card
  assert.equal(host.update({ id: card.id, stage: 'won' }, 'person').error, 'use_move')
  assert.equal(host.update({ id: card.id, flow: 'orders' }, 'person').error, 'use_move')
  assert.equal(host.update({ id: card.id, item_id: item.id }, 'person').error, 'link_not_allowed')
  assert.equal(host.update({ id: card.id }, 'person').error, 'missing_field', 'nothing to change')
  assert.equal(host.update({ id: 0, title: 'x' }, 'person').error, 'bad_id')
  assert.equal(host.archive({ id: card.id, extra: 1 }, 'person').error, 'unknown_field')
  assert.equal(host.restore({ id: 'x' }, 'person').error, 'bad_id')
})

await ok('links: contacts and items are looked up through the base, with a search; a card shows their names; a deleted-looking link is null', async () => {
  const { base, host } = world([{ ...orders(), links: { contact: true, item: true } }])
  base.create('contact', { name: 'Jonas Weber', email: 'jonas@example.com' }, { actor: 'person' })
  base.create('contact', { name: 'Chen Wei' }, { actor: 'person' })
  base.create('item', { title: 'Ceramic mug', subtitle: 'FC-MUG-01' }, { actor: 'person' })
  const r = host.links({ kind: 'contact', q: 'jon' })
  assert.deepEqual(r.rows.map((x) => [x.label, x.sub]), [['Jonas Weber', 'jonas@example.com']])
  assert.deepEqual(host.links({ kind: 'item', q: 'mug' }).rows.map((x) => x.label), ['Ceramic mug'])
  assert.equal(host.links({ kind: 'contact' }).rows.length, 2)
  assert.equal(host.links({ kind: 'other' }).error, 'bad_field')
  const contact = host.links({ kind: 'contact', q: 'chen' }).rows[0]
  const item = host.links({ kind: 'item' }).rows[0]
  const c = host.create({ flow: 'orders', title: 'X', contact_id: contact.id, item_id: item.id }, 'person').card
  assert.deepEqual([c.contact.name, c.item.title], ['Chen Wei', 'Ceramic mug'])
  base.archive('contact', contact.id, { actor: 'person' })
  assert.equal(host.board({ flow: 'orders' }).columns[0].cards[0].contact.archived, true)
})

await ok('cards the theme no longer knows are never hidden: an extra column, a generic board, and the plain board after a theme arrives', async () => {
  const { base, host } = world([orders()])
  base.create('flow_card', { flow: 'orders', stage: 'refunded', title: 'Old stage' }, { actor: 'person' })
  base.create('flow_card', { flow: 'old-theme', stage: 'a', title: 'Gone A' }, { actor: 'person' })
  base.create('flow_card', { flow: 'old-theme', stage: 'b', title: 'Gone B' }, { actor: 'person' })
  base.create('flow_card', { flow: 'default', stage: 'in-progress', title: 'Before the theme' }, { actor: 'person' })
  const b = host.board({ flow: 'orders' })
  assert.deepEqual(b.columns.map((c) => [c.stage, c.unknown]), [['new', false], ['paid', false], ['shipped', false], ['refunded', true]])
  assert.equal(b.columns[3].cards[0].title, 'Old stage')
  const f = host.flows()
  assert.deepEqual(f.flows.map((x) => [x.id, x.source, x.cards]), [['orders', 'theme', 1], ['default', 'default', 1], ['old-theme', 'cards', 2]])
  const g = host.board({ flow: 'old-theme' })
  assert.deepEqual(g.columns.map((c) => c.stage).sort(), ['a', 'b'])
  assert.equal(host.board({ flow: 'ghost' }).error, 'unknown_flow')
  assert.equal(host.move({ id: g.columns.find((c) => c.stage === 'a').cards[0].id, stage: 'b' }, 'person').ok, true, 'a generic board still moves its cards')
  assert.equal(host.board({ flow: 'Not A Key' }).error, 'bad_field')
})

await ok('sample rows are marked demo, and « clear sample data » removes them and nothing the person made', async () => {
  const { base, host } = world([orders()])
  const seeded = base.seed({ contacts: [{ ref: 'c1', name: 'Demo Customer', email: 'demo@example.com' }], cards: [{ flow: 'orders', stage: 'new', title: 'Demo order', contact_ref: 'c1', value_num: 50 }, { flow: 'orders', stage: 'paid', title: 'Demo paid' }] }, { theme: 'acme/shop' })
  assert.equal(seeded.ok, true, JSON.stringify(seeded))
  host.create({ flow: 'orders', title: 'Mine' }, 'person')
  const b = host.board({ flow: 'orders' })
  assert.equal(b.demoCards, 2)
  assert.deepEqual(b.columns[0].cards.map((c) => [c.title, c.demo]), [['Demo order', true], ['Mine', false]])
  assert.equal(host.flows().demo, 3, 'the contact counts too: sample data is cleared for every business page at once')
  const cleared = host.clearDemo('person')
  assert.equal(cleared.ok, true)
  assert.deepEqual(host.board({ flow: 'orders' }).columns[0].cards.map((c) => c.title), ['Mine'])
  assert.equal(host.board({ flow: 'orders' }).demoCards, 0)
})

await ok('a long board is read in pages: 530 cards, none lost, the total follows', async () => {
  const { base, host } = world([deals()])
  base.seed({ cards: Array.from({ length: 500 }, (_, i) => ({ flow: 'deals', stage: i % 2 === 0 ? 'lead' : 'won', title: 'Seed ' + i, value_num: 1 })) }, { theme: 'acme/many' })
  for (let i = 0; i < 30; i += 1) base.create('flow_card', { flow: 'deals', stage: 'lead', title: 'Own ' + i, value_num: 2 }, { actor: 'person' })
  const b = host.board({ flow: 'deals' })
  assert.deepEqual([b.count, b.truncated, b.columns[0].count, b.columns[1].count], [530, false, 280, 250])
  assert.deepEqual([b.columns[0].total, b.columns[1].total, b.total], [250 + 60, 250, 560])
  assert.equal(host.flows().flows[0].cards, 530)
})

await ok('the totals are rounded to cents, and cards without a value count as zero', async () => {
  const { host } = world([orders()])
  for (const v of [0.1, 0.2, 0.3333]) host.create({ flow: 'orders', title: 'v' + v, value: v }, 'person')
  host.create({ flow: 'orders', title: 'no value' }, 'person')
  assert.equal(host.board({ flow: 'orders' }).columns[0].total, 0.63)
})

await ok('the agent reads for free: the boards, one board, one column, a search; at most 100 cards', async () => {
  const { host, base } = world([orders()])
  host.create({ flow: 'orders', stage: 'new', title: 'Alpha mug', subtitle: 'x', value: 5 }, 'person')
  host.create({ flow: 'orders', stage: 'paid', title: 'Beta tea', value: 7 }, 'person')
  const boards = host.agentList({})
  assert.deepEqual(boards.boards.map((x) => [x.flow, x.name, x.cards, x.stages.map((s) => s.stage)]), [['orders', 'Orders', 2, ['new', 'paid', 'shipped']]])
  const one = host.agentList({ flow: 'orders' })
  assert.deepEqual(one.columns.map((c) => [c.stage, c.name, c.cards, c.total, c.shown.length]), [['new', 'New', 1, 5, 1], ['paid', 'Paid', 1, 7, 1], ['shipped', 'Shipped', 0, 0, 0]])
  assert.equal(one.columns[0].shown[0].title, 'Alpha mug')
  assert.equal(host.agentList({ flow: 'orders', stage: 'paid' }).columns.length, 1)
  assert.equal(host.agentList({ flow: 'orders', stage: 'nope' }).error, 'unknown_stage')
  assert.deepEqual(host.agentList({ flow: 'orders', q: 'BETA' }).columns.map((c) => c.shown.length), [0, 1, 0])
  assert.equal(host.agentList({ flow: 'ghost' }).error, 'unknown_flow')
  assert.equal(host.agentList('junk').ok, true, 'junk arguments list the boards')
  base.seed({ cards: Array.from({ length: 150 }, (_, i) => ({ flow: 'orders', stage: 'shipped', title: 'S' + i })) }, { theme: 'acme/many' })
  const big = host.agentList({ flow: 'orders' })
  assert.equal(big.columns.reduce((a, c) => a + c.shown.length, 0), 100)
  assert.equal(big.columns[2].cards, 150, 'the count is the real one, the list is cut')
})

await ok('the agent moves a card: the same rules as the page, one `move` line, actor agent', async () => {
  const { host, journal } = world([orders()])
  const a = host.create({ flow: 'orders', title: 'A' }, 'person').card
  const before = journal().length
  const m = host.agentMove({ card: a.id, stage: 'shipped' })
  assert.deepEqual([m.ok, m.from, m.to], [true, 'new', 'shipped'])
  const last = journal().pop()
  assert.deepEqual([journal().length, last.action, last.actor, last.row_id], [before + 1, 'move', 'agent', a.id])
  assert.equal(host.agentMove({ card: a.id, stage: 'nowhere' }).error, 'unknown_stage')
  assert.equal(host.agentMove({ card: 'nope', stage: 'new' }).error, 'bad_id')
  assert.equal(host.agentMove(undefined).error, 'bad_id')
  assert.equal(journal().length, before + 1)
})

await ok('the question put to the person names the card and the stage, in both languages, and still asks when it cannot', async () => {
  const { host } = world([orders()])
  const a = host.create({ flow: 'orders', title: '#1046' }, 'person').card
  const said = host.describeMove({ card: a.id, stage: 'paid' })
  assert.equal(said.en, 'Move the Pipeline card “#1046” to « Paid »?')
  assert.equal(said.fr, 'Déplacer la carte Pipeline “#1046” vers « Payé » ?')
  const blind = createPipelineHost({ business: () => null }).describeMove({ card: 7, stage: 'paid' })
  assert.equal(blind.en, 'Move the Pipeline card card 7 to « paid »?')
  assert.match(createPipelineHost({ business: () => null }).describeMove(null).fr, /^Déplacer la carte Pipeline/)
})

await ok('the tools: two definitions in the engine shape; pipeline_list is free, pipeline_move is gated and asks every time', async () => {
  const { host } = world([orders()])
  const a = host.create({ flow: 'orders', title: 'A' }, 'person').card
  const tools = toolDefinitions(host)
  assert.deepEqual(tools.map((t) => t.name), [LIST_TOOL, MOVE_TOOL])
  assert.deepEqual([LIST_TOOL, MOVE_TOOL], ['pipeline_list', 'pipeline_move'])
  for (const t of tools) {
    assert.equal(t.parameters.type, 'object')
    assert.equal(t.parameters.additionalProperties, false)
    assert.equal(typeof t.execute, 'function')
    assert.equal(t.output.render({}, { ok: true })[0].type, 'text')
  }
  assert.deepEqual(tools[1].parameters.required, ['card', 'stage'])
  assert.equal(tools[0].parameters.required, undefined)
  assert.equal((await tools[0].execute({ flow: 'orders' })).ok, true)
  assert.match(tools[0].output.render({}, { ok: false, error: 'base_missing', detail: 'x' })[0].text, /base_missing/)
  const gate = approvalGate(host)
  let passed = 0
  const next = async () => { passed += 1; return { kind: 'allow' } }
  for (let i = 0; i < 3; i += 1) {
    const ask = await gate({ name: MOVE_TOOL, arguments: { card: a.id, stage: 'paid' } }, next)
    assert.equal(ask.kind, 'ask', 'asked every time, not once')
    assert.equal(ask.reason, 'Move the Pipeline card “A” to « Paid »?')
    assert.deepEqual(Object.keys(ask.displayReason).sort(), ['en', 'fr'])
  }
  assert.equal(passed, 0)
  assert.equal((await gate({ name: LIST_TOOL, arguments: {} }, next)).kind, 'allow')
  assert.equal((await gate({ name: 'bash', arguments: {} }, next)).kind, 'allow')
  assert.equal((await gate(null, next)).kind, 'allow')
  assert.equal(passed, 3, 'everything else goes on to the next handler')
  const broken = approvalGate({ describeMove: () => { throw new Error('boom') } })
  assert.equal((await broken({ name: MOVE_TOOL, arguments: {} }, next)).kind, 'ask', 'a gate that cannot describe the move still asks')
})

await ok('apply mounts the routes, the tools and the gate; it unmounts the routes; it never throws, with or without services', async () => {
  const registered = []
  const offs = []
  const tools = []
  const handlers = {}
  const effects = []
  const services = { webServer: { register: (r) => { registered.push(r); const off = () => offs.push(r.path); return off } }, tools: { register: (t) => tools.push(t) } }
  const logs = []
  const log = console.log
  console.log = (...a) => logs.push(a.join(' '))
  try {
    apply({ get: (name) => services[name], inject: () => assert.fail('both services are there'), effect: (fn) => effects.push(fn()), on: (ev, fn) => { handlers[ev] = fn } }, { schedule: () => undefined })
    assert.deepEqual(registered.map((r) => r.path).sort(), ROUTES.map((r) => r.path).sort())
    assert.ok(registered.every((r) => r.kind === 'exact' && typeof r.handler === 'function'))
    assert.deepEqual(tools.map((t) => t.name), ['pipeline_list', 'pipeline_move'])
    assert.equal(typeof handlers['tools/pre-execute'], 'function')
    assert.equal((await handlers['tools/pre-execute']({ name: 'pipeline_move', arguments: { card: 1, stage: 'x' } }, async () => ({ kind: 'allow' }))).kind, 'ask')
    effects[0]()
    assert.equal(offs.length, ROUTES.length, 'unloading the plugin takes every route off')
    // services that arrive later
    const waiting = []
    apply({ get: () => undefined, inject: (names, fn) => waiting.push([names, fn]), effect: () => {}, on: () => {} }, { schedule: () => undefined })
    assert.deepEqual(waiting.map((w) => w[0]).sort(), [['tools'], ['webServer']])
    for (const [names, fn] of waiting) fn({ [names[0]]: services[names[0]] })
    // things that fail
    apply({ get: () => ({ register: () => { throw new Error('refused') } }), inject: () => {}, effect: () => {}, on: () => { throw new Error('no hooks') } }, { schedule: () => undefined })
    apply({ get: () => { throw new Error('no services') }, inject: () => {} }, { schedule: () => undefined })
    apply(null, { schedule: () => undefined })
    apply(undefined, { schedule: () => undefined })
    apply({}, { schedule: () => undefined })
  } finally { console.log = log }
  assert.ok(logs.some((l) => /routes mounted/.test(l)) && logs.some((l) => /tools pipeline_list/.test(l)))
  assert.equal(handlerOf({ path: '/x', method: 'GET', run: () => ({}) }, {}) instanceof Function, true)
})

// ── what a card carries beyond its lines: its extras and the picture of the item it is about ──────────────────────────────────────────────────
await ok('a board card sends the few extras it carries (source, priority, due, up to three tags), checked, and the picture reference of its item', () => {
  const { base, host } = world([orders()])
  const item = base.create('item', { type: 'product', title: 'Linen apron', status: 'live', fields: { image: 'photo:ecommerce/linen-apron', sku: 'A-1' } }, { actor: 'person' }).row
  const plain = base.create('item', { type: 'product', title: 'Odd one', status: 'live', fields: { image: 'https://example.org/x.png' } }, { actor: 'person' }).row
  let place = 0
  const made = (title, item_id, fields) => base.create('flow_card', { flow: 'orders', stage: 'new', title, item_id, fields, position: (place += 1) }, { actor: 'person' })
  made('With everything', item.id, { source: 'Website', priority: 'high', due: '2026-11-12', tags: ['vip', 'gift', 'new', 'dropped'], secret: 'never sent' })
  made('With junk', plain.id, { source: 7, priority: 'urgent', due: 'soon', tags: 'vip' })
  const cards = host.board({ flow: 'orders' }).columns.flatMap((c) => c.cards)
  const a = cards.find((c) => c.title === 'With everything')
  assert.deepEqual(a.fields, { source: 'Website', priority: 'high', due: '2026-11-12', tags: ['vip', 'gift', 'new'] })
  assert.equal(a.item.image, 'photo:ecommerce/linen-apron')
  assert.equal(a.item.type, 'product')
  const b = cards.find((c) => c.title === 'With junk')
  assert.deepEqual(b.fields, {}, 'what is not of the right shape is not sent')
  assert.equal(b.item.image, null, 'an address is never a picture')
})

await ok('one template at a time: the boards, the cards, the counts and the lookups are the active template\'s; none active means every theme\'s board, as before', async () => {
  const lettings = { id: 'lettings', label: L('Lettings'), stages: [{ key: 'enquiry', label: L('Enquiry') }, { key: 'let', label: L('Let') }], value: { format: 'number' }, links: { contact: true, item: true } }
  let scope = null
  const base = createBusinessBase({ file: join(dir, 'one-template.sqlite'), scope: () => scope })
  const registry = { version: 1, contributions: (point) => (point === FLOW_POINT ? [{ plugin: 'k/shop', value: orders() }, { plugin: 'k/house', value: lettings }, { plugin: 'k/house', value: deals() }] : []) }
  const host = createPipelineHost({ business: () => base, registry: () => registry })
  base.seed({ contacts: [{ ref: 'a', name: 'Amelia' }], items: [{ ref: 'm', title: 'Mug' }], cards: [{ flow: 'orders', stage: 'new', title: 'Order 1', contact_ref: 'a', item_ref: 'm' }, { flow: 'orders', stage: 'paid', title: 'Order 2' }] }, { theme: 'k/shop' })
  base.seed({ contacts: [{ ref: 'b', name: 'Bernard' }], items: [{ ref: 'h', title: 'Canal house' }], cards: [{ flow: 'lettings', stage: 'enquiry', title: 'Let the canal house', contact_ref: 'b', item_ref: 'h' }] }, { theme: 'k/house' })
  assert.deepEqual(host.flows().flows.map((x) => [x.id, x.cards]), [['orders', 2], ['lettings', 1], ['deals', 0]], 'no template active: every theme\'s boards')
  scope = 'k/shop'
  let f = host.flows()
  assert.deepEqual(f.flows.map((x) => [x.id, x.cards]), [['orders', 2]], 'the shop: its board only, and no generic board for the agency\'s cards, which are out of sight')
  assert.equal(f.demo, 4, 'the sample count is the shop\'s (a contact, an item, two cards)')
  assert.equal(host.board({}).flow.id, 'orders')
  assert.equal(host.board({ flow: 'lettings' }).error, 'unknown_flow', 'a board of another template is not there')
  assert.deepEqual(host.links({ kind: 'contact', q: '' }).rows.map((r) => r.label), ['Amelia'], 'the pickers offer the shop\'s contacts and items only')
  assert.deepEqual(host.links({ kind: 'item', q: '' }).rows.map((r) => r.label), ['Mug'])
  const made = host.create({ flow: 'orders', title: 'Order 3' }, 'person')
  assert.equal(made.ok, true, JSON.stringify(made))
  assert.equal(base.get('flow_card', made.card.id).row.scope, 'k/shop')
  scope = 'k/house'
  f = host.flows()
  assert.deepEqual(f.flows.map((x) => [x.id, x.cards]), [['lettings', 1], ['deals', 0]])
  assert.equal(host.board({}).flow.id, 'lettings', 'the first board of the active template is the one shown')
  assert.deepEqual(host.board({ flow: 'lettings' }).columns.flatMap((c) => c.cards).map((c) => c.title), ['Let the canal house'])
  assert.equal(host.clearDemo('person').ok, true)
  assert.equal(base.list('flow_card', { scope: 'k/shop' }).total, 3, 'the shop\'s cards, its sample ones and the new one, are untouched')
  scope = 'k/nothing'
  assert.deepEqual(host.flows().flows.map((x) => x.id), ['default'], 'an active template with no board: the one plain board')
  const older = createPipelineHost({ business: () => ({ version: 1, list: () => ({ ok: true, rows: [], total: 0 }), counts: () => ({ ok: true, demo: {} }) }), registry: () => registry })
  assert.deepEqual(older.flows().flows.map((x) => x.id), ['orders', 'lettings', 'deals'], 'an older core cannot say which template is active: every board, as before')
  base.close()
})

rmSync(dir, { recursive: true, force: true })
console.log('\n' + count + ' checks passed')

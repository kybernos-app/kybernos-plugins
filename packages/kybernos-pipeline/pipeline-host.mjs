// kybernos-pipeline — the logic of the host half, pure: no `ctx`, no route, no disk of its own. The business base and the registry come in through
// ports (`ports.business()`, `ports.registry()`), read AT REQUEST TIME: a base that is not there answers `{ ok: false, error: 'base_missing' }`, and nothing
// here throws. index.js turns these answers into routes and tools.
//
// A card is a row of `flow_card` in the shared base (docs/dev/business-base.md): its `flow` and `stage` are keys; the words, the order of the columns
// and the way a value is counted come from the active theme's `kybernos/pipeline#flow` contributions (one file = one board), or from the one plain
// board below when no theme brings any. A card whose flow or stage the theme no longer defines is still shown (a generic board / an extra column): the
// base keeps the keys, so removing a theme never hides the person's data.
import { validatePipelineFlow } from './pipeline-flow.mjs'

export const FLOW_POINT = 'kybernos/pipeline#flow'

/** The board used when no theme brings one: three stages, no value, both links allowed. */
export const DEFAULT_FLOW = Object.freeze({
  id: 'default',
  label: Object.freeze({ en: 'Pipeline', fr: 'Pipeline' }),
  newLabel: Object.freeze({ en: 'New card', fr: 'Nouvelle carte' }),
  stages: Object.freeze([
    Object.freeze({ key: 'new', label: Object.freeze({ en: 'New', fr: 'Nouveau' }) }),
    Object.freeze({ key: 'in-progress', label: Object.freeze({ en: 'In progress', fr: 'En cours' }) }),
    Object.freeze({ key: 'done', label: Object.freeze({ en: 'Done', fr: 'Terminé' }) }),
  ]),
  value: null,
  links: Object.freeze({ contact: true, item: true }),
  source: 'default',
  theme: null,
})

/** The question put to the person before the agent moves a card, in both languages: `ask(language, what, to)` names the card and the stage. */
const ASK = {
  en: { head: 'Move the Pipeline card ', mid: ' to « ', tail: ' »?', other: 'another stage' },
  fr: { head: 'Déplacer la carte Pipeline ', mid: ' vers « ', tail: ' » ?', other: 'une autre étape' },
}
const ask = (language, what, to) => ASK[language].head + what + ASK[language].mid + (to || ASK[language].other) + ASK[language].tail

const PAGE = 500 // the base answers at most 500 rows per question
const BOARD_MAX = 2000 // cards of one board that are read (a board this long says `truncated`)
const SCAN_PAGES = 10 // pages read to count the cards of every board
const ARCHIVED_MAX = 100
const LINKS_MAX = 300
const LOOKUP_MAX = 20

const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const fail = (error, detail) => ({ ok: false, error, detail })
const money2 = (n) => Math.round(n * 100) / 100
const wholeId = (v) => (typeof v === 'number' && Number.isInteger(v) && v >= 1 ? v : null)
const keyOk = (v) => typeof v === 'string' && /^[a-z0-9][a-z0-9_-]{0,39}$/.test(v)
const unknownKeys = (body, allowed) => Object.keys(body).filter((k) => allowed.indexOf(k) < 0)
const message = (e) => String(e !== null && e !== undefined && e.message !== undefined ? e.message : e).slice(0, 200)

/** A generic board for cards whose flow no theme defines: the stages are the ones the cards use. */
const genericFlow = (id, stages) => ({
  id,
  label: { en: id },
  newLabel: null,
  stages: stages.map((key) => ({ key, label: { en: key } })),
  value: null,
  links: { contact: true, item: true },
  source: 'cards',
  theme: null,
})

export function createPipelineHost (ports = {}) {
  const seam = (name) => {
    try {
      const s = typeof ports[name] === 'function' ? ports[name]() : null
      return s !== null && s !== undefined && s.version === 1 ? s : null
    } catch (e) { return null }
  }

  /** Runs `fn(base)` with the base read now; a missing base or a throw is an answer, never an exception. */
  const run = (fn) => {
    try {
      const base = seam('business')
      if (base === null) return fail('base_missing', 'the business base is not mounted')
      return fn(base)
    } catch (e) { return fail('failed', message(e)) }
  }

  // ── the boards ────────────────────────────────────────────────────────────────────────────────
  /** The boards of the active themes (each checked again: the registry may be another version), or `[]`. */
  const themeFlows = () => {
    const registry = seam('registry')
    if (registry === null || typeof registry.contributions !== 'function') return []
    let list = []
    try { list = registry.contributions(FLOW_POINT) } catch (e) { return [] }
    const seen = new Set()
    const out = []
    for (const c of Array.isArray(list) ? list : []) {
      const value = plain(c) ? c.value : null
      if (!plain(value)) continue
      const checked = validatePipelineFlow(value, value.id)
      if (checked.ok !== true || seen.has(checked.value.id)) continue
      seen.add(checked.value.id)
      out.push({ ...checked.value, source: 'theme', theme: typeof c.plugin === 'string' ? c.plugin : null })
    }
    return out
  }
  const definitions = () => { const t = themeFlows(); return t.length > 0 ? t : [DEFAULT_FLOW] }

  /** Every card (archived ones left out unless asked) that matches `filter`, a page at a time. */
  const fetchCards = (base, filter, cap, pages = Infinity) => {
    const rows = []
    let total = 0
    for (let offset = 0, n = 0; rows.length < cap && n < pages; offset += PAGE, n += 1) {
      const r = base.list('flow_card', { ...filter, limit: PAGE, offset })
      if (r.ok !== true) return r
      total = r.total
      rows.push(...r.rows)
      if (r.rows.length < PAGE || rows.length >= total) break
    }
    return { ok: true, rows: rows.slice(0, cap), total, truncated: total > Math.min(cap, rows.length) }
  }

  /** The board named `id`: a theme's, the plain one, or a generic one for a flow the base knows through its cards only. `null` when nothing has that id. */
  const resolveFlow = (base, id) => {
    const hit = definitions().find((f) => f.id === id)
    if (hit !== undefined) return hit
    if (id === DEFAULT_FLOW.id) return DEFAULT_FLOW
    const got = fetchCards(base, { flow: id }, BOARD_MAX)
    if (got.ok !== true || got.rows.length === 0) return null
    return genericFlow(id, [...new Set(got.rows.map((r) => r.stage))])
  }
  const hasStage = (flow, stage) => flow.stages.some((s) => s.key === stage)

  // ── cards, as the page and the agent see them ─────────────────────────────────────────────────
  const link = (base, table, id, cache, shape) => {
    if (id === null || id === undefined) return null
    if (cache.has(id)) return cache.get(id)
    if (cache.size >= LINKS_MAX) return null
    const got = base.get(table, id)
    const out = got.ok === true ? shape(got.row) : null
    cache.set(id, out)
    return out
  }
  const linker = (base) => {
    const contacts = new Map()
    const items = new Map()
    return {
      contact: (id) => link(base, 'contact', id, contacts, (r) => ({ id: r.id, name: r.name, kind: r.kind, archived: r.archived_at !== null })),
      item: (id) => link(base, 'item', id, items, (r) => ({ id: r.id, title: r.title, subtitle: r.subtitle, archived: r.archived_at !== null })),
    }
  }
  const shapeCard = (row, links) => ({
    id: row.id,
    flow: row.flow,
    stage: row.stage,
    title: row.title,
    subtitle: row.subtitle,
    value: row.value_num,
    position: row.position,
    since: row.entered_stage_at,
    demo: row.demo === true,
    archived: row.archived_at !== null,
    contact_id: row.contact_id,
    item_id: row.item_id,
    contact: links.contact(row.contact_id),
    item: links.item(row.item_id),
  })

  // ── reads ─────────────────────────────────────────────────────────────────────────────────────
  /** The boards, with the number of cards on each; boards the base only knows through its cards come last. */
  const flows = () => run((base) => {
    const defs = definitions()
    const scan = fetchCards(base, {}, SCAN_PAGES * PAGE, SCAN_PAGES)
    if (scan.ok !== true) return scan
    const counts = new Map()
    const stagesSeen = new Map()
    for (const r of scan.rows) {
      counts.set(r.flow, (counts.get(r.flow) || 0) + 1)
      if (!stagesSeen.has(r.flow)) stagesSeen.set(r.flow, [])
      if (stagesSeen.get(r.flow).indexOf(r.stage) < 0) stagesSeen.get(r.flow).push(r.stage)
    }
    const out = defs.map((f) => ({ ...f, cards: counts.get(f.id) || 0 }))
    for (const id of [...counts.keys()].sort()) {
      if (out.some((f) => f.id === id)) continue
      const f = id === DEFAULT_FLOW.id ? DEFAULT_FLOW : genericFlow(id, stagesSeen.get(id))
      out.push({ ...f, cards: counts.get(id) })
    }
    const c = base.counts()
    const demo = c.ok === true ? Object.values(c.demo).reduce((a, n) => a + n, 0) : 0
    return { ok: true, flows: out, theme: defs[0].source === 'theme', demo }
  })

  /** One board: its columns in the theme's order (plus one for each stage the cards use that the theme does not know), each with its cards and its total. */
  const board = (query = {}) => run((base) => {
    const asked = typeof query.flow === 'string' && query.flow !== '' ? query.flow : definitions()[0].id
    if (!keyOk(asked)) return fail('bad_field', 'flow: a flow key')
    const def = resolveFlow(base, asked)
    if (def === null) return fail('unknown_flow', 'no board named "' + asked + '"')
    const got = fetchCards(base, { flow: asked }, BOARD_MAX)
    if (got.ok !== true) return got
    const links = linker(base)
    const columns = def.stages.map((s) => ({ stage: s.key, label: s.label, unknown: false, count: 0, total: 0, cards: [] }))
    const byStage = new Map(columns.map((c) => [c.stage, c]))
    let demoCards = 0
    for (const row of got.rows) {
      let col = byStage.get(row.stage)
      if (col === undefined) {
        col = { stage: row.stage, label: { en: row.stage }, unknown: true, count: 0, total: 0, cards: [] }
        byStage.set(row.stage, col)
        columns.push(col)
      }
      col.cards.push(shapeCard(row, links))
      col.count += 1
      if (typeof row.value_num === 'number') col.total += row.value_num
      if (row.demo === true) demoCards += 1
    }
    for (const col of columns) col.total = money2(col.total)
    const out = { ok: true, flow: def, columns, count: got.rows.length, total: money2(columns.reduce((a, c) => a + c.total, 0)), demoCards, truncated: got.truncated }
    if (query.archived === '1' || query.archived === true) {
      const all = fetchCards(base, { flow: asked, includeArchived: true }, BOARD_MAX)
      if (all.ok !== true) return all
      out.archived = all.rows.filter((r) => r.archived_at !== null).slice(0, ARCHIVED_MAX).map((r) => shapeCard(r, links))
    }
    return out
  })

  const card = (query = {}) => run((base) => {
    const id = wholeId(Number(query.id))
    if (id === null) return fail('bad_id', 'id: a card id')
    const got = base.get('flow_card', id)
    if (got.ok !== true) return got
    const def = resolveFlow(base, got.row.flow)
    return { ok: true, card: shapeCard(got.row, linker(base)), flow: def }
  })

  /** What the pickers offer: a few contacts or items matching `q`. */
  const links = (query = {}) => run((base) => {
    const q = typeof query.q === 'string' ? query.q.slice(0, 80) : ''
    if (query.kind === 'contact') {
      const r = base.list('contact', { q, limit: LOOKUP_MAX })
      return r.ok !== true ? r : { ok: true, rows: r.rows.map((c) => ({ id: c.id, label: c.name, sub: c.email !== '' ? c.email : c.type })) }
    }
    if (query.kind === 'item') {
      const r = base.list('item', { q, limit: LOOKUP_MAX })
      return r.ok !== true ? r : { ok: true, rows: r.rows.map((i) => ({ id: i.id, label: i.title, sub: i.subtitle })) }
    }
    return fail('bad_field', 'kind: contact or item')
  })

  // ── writes (the base checks the rest: lengths, ids, links that exist, the journal) ─────────────
  const CREATE_KEYS = ['flow', 'stage', 'title', 'subtitle', 'value', 'contact_id', 'item_id']
  const UPDATE_KEYS = ['id', 'title', 'subtitle', 'value', 'contact_id', 'item_id']
  const FIELD_KEYS = { title: 'title', subtitle: 'subtitle', value: 'value_num', contact_id: 'contact_id', item_id: 'item_id' }

  /** The columns a body sets, renamed for the base. */
  const columnsOf = (body) => {
    const out = {}
    for (const k of Object.keys(FIELD_KEYS)) if (Object.prototype.hasOwnProperty.call(body, k)) out[FIELD_KEYS[k]] = body[k]
    return out
  }
  const linkAllowed = (flow, cols) => {
    if (cols.contact_id !== undefined && cols.contact_id !== null && flow.links.contact !== true) return fail('link_not_allowed', 'this board does not link contacts')
    if (cols.item_id !== undefined && cols.item_id !== null && flow.links.item !== true) return fail('link_not_allowed', 'this board does not link items')
    return null
  }
  const actorOf = (actor) => ({ actor: actor === 'agent' ? 'agent' : 'person' })

  const create = (body, actor) => run((base) => {
    if (!plain(body)) return fail('bad_field', 'a card is an object')
    const extra = unknownKeys(body, CREATE_KEYS)
    if (extra.length > 0) return fail('unknown_field', 'no field "' + extra[0].slice(0, 40) + '"')
    if (!keyOk(body.flow)) return fail('bad_field', 'flow: a flow key')
    const def = resolveFlow(base, body.flow)
    if (def === null) return fail('unknown_flow', 'no board named "' + body.flow + '"')
    const stage = body.stage === undefined ? def.stages[0].key : body.stage
    if (!hasStage(def, stage)) return fail('unknown_stage', 'no stage "' + String(stage).slice(0, 40) + '" on this board')
    const cols = columnsOf(body)
    const refused = linkAllowed(def, cols)
    if (refused !== null) return refused
    const made = base.create('flow_card', { flow: def.id, stage, ...cols }, actorOf(actor))
    return made.ok === true ? { ok: true, card: shapeCard(made.row, linker(base)) } : made
  })

  const update = (body, actor) => run((base) => {
    if (!plain(body)) return fail('bad_field', 'a patch is an object')
    const extra = unknownKeys(body, UPDATE_KEYS)
    if (extra.length > 0) return fail(extra[0] === 'stage' || extra[0] === 'flow' ? 'use_move' : 'unknown_field', extra[0] === 'stage' ? 'a stage changes with a move' : 'no field "' + extra[0].slice(0, 40) + '"')
    const id = wholeId(body.id)
    if (id === null) return fail('bad_id', 'id: a card id')
    const cols = columnsOf(body)
    const current = base.get('flow_card', id)
    if (current.ok !== true) return current
    const def = resolveFlow(base, current.row.flow)
    if (def !== null) { const refused = linkAllowed(def, cols); if (refused !== null) return refused }
    const done = base.update('flow_card', id, cols, actorOf(actor))
    return done.ok === true ? { ok: true, card: shapeCard(done.row, linker(base)) } : done
  })

  /** A card to another stage of its board; the base puts it at the end of the column and writes one `move` line. The same stage changes nothing and writes nothing. */
  const move = (body, actor) => run((base) => {
    if (!plain(body)) return fail('bad_field', 'a move is an object')
    const extra = unknownKeys(body, ['id', 'stage'])
    if (extra.length > 0) return fail('unknown_field', 'no field "' + extra[0].slice(0, 40) + '"')
    const id = wholeId(body.id)
    if (id === null) return fail('bad_id', 'id: a card id')
    if (!keyOk(body.stage)) return fail('bad_field', 'stage: a stage key')
    const current = base.get('flow_card', id)
    if (current.ok !== true) return current
    if (current.row.archived_at !== null) return fail('archived', 'this card is archived: restore it first')
    const def = resolveFlow(base, current.row.flow)
    if (def === null || !hasStage(def, body.stage)) return fail('unknown_stage', 'no stage "' + body.stage + '" on this board')
    if (current.row.stage === body.stage) return { ok: true, unchanged: true, card: shapeCard(current.row, linker(base)), from: body.stage, to: body.stage }
    const done = base.update('flow_card', id, { stage: body.stage }, actorOf(actor))
    return done.ok === true ? { ok: true, unchanged: false, card: shapeCard(done.row, linker(base)), from: current.row.stage, to: body.stage } : done
  })

  const archiveOrRestore = (restoring) => (body, actor) => run((base) => {
    if (!plain(body)) return fail('bad_field', 'a body is an object')
    const extra = unknownKeys(body, ['id'])
    if (extra.length > 0) return fail('unknown_field', 'no field "' + extra[0].slice(0, 40) + '"')
    const id = wholeId(body.id)
    if (id === null) return fail('bad_id', 'id: a card id')
    const done = restoring ? base.restore('flow_card', id, actorOf(actor)) : base.archive('flow_card', id, actorOf(actor))
    return done.ok === true ? { ok: true, card: shapeCard(done.row, linker(base)) } : done
  })

  /** Removes the sample rows of every business page (the base knows no smaller scope); what the person made stays. */
  const clearDemo = (actor) => run((base) => base.clearDemo(actorOf(actor)))

  // ── for the agent ─────────────────────────────────────────────────────────────────────────────
  const AGENT_CARDS = 100
  const english = (label) => (plain(label) && typeof label.en === 'string' ? label.en : '')

  /** Without arguments: the boards. With `flow`: its columns with counts, totals and cards (at most 100), optionally one `stage` and a text `q`. Free: it only reads. */
  const agentList = (args) => {
    const a = plain(args) ? args : {}
    if (typeof a.flow !== 'string' || a.flow === '') {
      const all = flows()
      if (all.ok !== true) return all
      return { ok: true, boards: all.flows.map((f) => ({ flow: f.id, name: english(f.label), cards: f.cards, stages: f.stages.map((s) => ({ stage: s.key, name: english(s.label) })), value: f.value })) }
    }
    const b = board({ flow: a.flow })
    if (b.ok !== true) return b
    const q = typeof a.q === 'string' ? a.q.trim().toLowerCase().slice(0, 80) : ''
    const wanted = typeof a.stage === 'string' && a.stage !== '' ? a.stage : null
    if (wanted !== null && !b.columns.some((c) => c.stage === wanted)) return fail('unknown_stage', 'no stage "' + wanted.slice(0, 40) + '" on this board')
    let left = AGENT_CARDS
    const columns = b.columns.filter((c) => wanted === null || c.stage === wanted).map((c) => {
      const matching = c.cards.filter((x) => q === '' || (x.title + ' ' + x.subtitle).toLowerCase().indexOf(q) >= 0)
      const cards = matching.slice(0, Math.max(left, 0)).map((x) => ({ id: x.id, title: x.title, subtitle: x.subtitle, value: x.value, contact: x.contact === null ? null : x.contact.name, item: x.item === null ? null : x.item.title, since: x.since }))
      left -= cards.length
      return { stage: c.stage, name: english(c.label), cards: matching.length, total: c.total, shown: cards }
    })
    return { ok: true, flow: b.flow.id, name: english(b.flow.label), value: b.flow.value, columns }
  }

  /** The agent moves a card: the same answer as the page's move, written as `agent`. */
  const agentMove = (args) => {
    const a = plain(args) ? args : {}
    return move({ id: a.card, stage: a.stage }, 'agent')
  }

  /** What the person is asked before the agent moves a card, in both languages (the card and the stage are named when the base can say which). */
  const describeMove = (args) => {
    const a = plain(args) ? args : {}
    const asked = typeof a.stage === 'string' ? a.stage.slice(0, 40) : ''
    const found = run((base) => {
      const got = base.get('flow_card', a.card)
      if (got.ok !== true) return got
      const def = resolveFlow(base, got.row.flow)
      const stage = def === null ? undefined : def.stages.find((s) => s.key === asked)
      return { ok: true, title: got.row.title, stage: stage === undefined ? null : stage.label }
    })
    const what = found.ok === true ? '“' + found.title + '”' : 'card ' + String(a.card).slice(0, 12)
    const en = found.ok === true && found.stage !== null ? english(found.stage) : asked
    const fr = found.ok === true && found.stage !== null && typeof found.stage.fr === 'string' ? found.stage.fr : en
    return { en: ask('en', what, en), fr: ask('fr', what, fr) }
  }

  return Object.freeze({ flows, board, card, links, create, update, move, archive: archiveOrRestore(false), restore: archiveOrRestore(true), clearDemo, agentList, agentMove, describeMove })
}

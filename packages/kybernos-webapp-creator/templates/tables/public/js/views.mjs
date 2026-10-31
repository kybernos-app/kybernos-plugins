// views.mjs — what each screen looks like, as DOM built from the state. No fetching and no state of its own: a view reads `ctx` and calls `ctx.a.<action>` (see main.mjs).
//
//   ctx = { me, apps, app, object, route, ui, data, detail, resolve(objectKey, id), a: { …actions } }
//     ui     { q, filter, sort, group, shown, nav }
//     data   { status: 'loading' | 'ready' | 'error', records, message } of the table on screen
//     detail null, or { object, id, confirm, links (null while loading, else the groups of backlinks) }
import { drawerBox } from './forms.mjs'
import { h, icon, kmark, s } from './dom.mjs'
import * as m from './model.mjs'
import { pill, renderValue } from './values.mjs'

export const PAGE = 200
const COLUMN_MAX = 100
const lower = (x) => String(x).toLowerCase()
const hash = (route) => m.routeHash(route)

// ── sign-in ──

/** `submit(email, password)` answers `{ ok }` or `{ ok: false, message }`; `notice` is a line shown above the form (a session that ended). */
export function signInView ({ submit, notice }) {
  const email = h('input', { class: 'input', id: 'si-email', type: 'email', autocomplete: 'username', required: true, autofocus: true })
  const password = h('input', { class: 'input', id: 'si-password', type: 'password', autocomplete: 'current-password', required: true })
  const error = h('p', { class: 'err', role: 'alert', hidden: true })
  const go = h('button', { class: 'btn primary', type: 'submit' }, 'Sign in')
  const form = h('form', { novalidate: true, onsubmit: async (e) => {
    e.preventDefault()
    error.hidden = true
    if (email.value.trim() === '' || password.value === '') { error.textContent = 'Enter your email and your password.'; error.hidden = false; (email.value.trim() === '' ? email : password).focus(); return }
    go.disabled = true
    const r = await submit(email.value.trim(), password.value)
    go.disabled = false
    if (!r.ok) { error.textContent = r.message; error.hidden = false; password.select() }
  } },
  h('div', { class: 'fld' }, h('label', { for: 'si-email' }, 'Email'), email),
  h('div', { class: 'fld' }, h('label', { for: 'si-password' }, 'Password'), password),
  error, go)
  return h('div', { class: 'auth' }, h('div', { class: 'card-auth' },
    h('div', { class: 'brand' }, kmark(), h('span', null, 'Team space')),
    h('h1', null, 'Sign in'),
    notice ? h('p', { class: 'dim', role: 'status' }, notice) : h('p', { class: 'dim' }, 'Use the email and password you joined with.'),
    form,
    h('p', { class: 'made' }, kmark(), h('span', null, 'Made with Kybernos'))))
}

/** A card with a title, a sentence and one button: the page when the server cannot be reached. */
export function messageView (title, text, retry) {
  return h('div', { class: 'auth' }, h('div', { class: 'card-auth', role: 'alert' }, h('div', { class: 'brand' }, kmark(), h('span', null, 'Team space')), h('h1', null, title), h('p', { class: 'dim' }, text),
    h('button', { type: 'button', class: 'btn primary', onclick: retry }, 'Try again')))
}

// ── the rail ──

function nav (ctx) {
  const { apps, route, me, a } = ctx
  const lists = apps.map((app) => [
    h('div', { class: 'navh' }, apps.length > 1 ? app.name : 'Tables'),
    app.objects.map((o) => h('a', { class: 'nav-item', href: hash({ slug: app.slug, object: o.key, view: 'table' }), 'aria-current': route.slug === app.slug && route.object === o.key ? 'page' : undefined, onclick: a.closeNav },
      icon('table'), h('span', null, o.label), h('span', { class: 'n' }, o.count))),
  ])
  const name = apps.length === 1 ? apps[0].name : 'Team space'
  const who = me.name && me.name !== 'Owner' ? me.name : me.email
  const profile = m.isOwner(me) ? 'Owner' : (apps.find((x) => x.profile !== undefined)?.profile.label ?? me.role)
  return h('nav', { class: 'nav', 'aria-label': 'Main' },
    h('div', { class: 'space' }, h('div', { class: 'logo', 'aria-hidden': 'true' }, m.initials(name)), h('div', { class: 'grow' }, h('b', null, name), h('small', null, location.host))),
    lists,
    m.isOwner(me) ? [h('div', { class: 'navh' }, 'Team'), h('a', { class: 'nav-item', href: '/people' }, icon('users'), h('span', null, 'People'), ctx.peopleCount === null ? null : h('span', { class: 'n' }, ctx.peopleCount))] : null,
    h('div', { class: 'grow' }),
    h('div', { class: 'me' }, h('span', { class: 'av', 'aria-hidden': 'true' }, m.initials(who)), h('div', null, h('b', { title: who }, who), h('small', null, profile)),
      h('button', { type: 'button', class: 'btn icon ghost sm', 'aria-label': 'Sign out', title: 'Sign out', onclick: a.signOut }, icon('out'))),
    h('div', { class: 'made' }, kmark(), h('span', null, 'Made with Kybernos')))
}

// ── states ──

const skeleton = () => h('div', { class: 'sk', 'aria-label': 'Loading', 'aria-busy': 'true', role: 'status' }, [0, 1, 2, 3, 4, 5].map(() => h('div', null, h('i', { class: 'a' }), h('i', { class: 'b' }), h('i', { class: 'c' }))))

function emptyBox (ctx) {
  const { object, me } = ctx
  const one = m.singular(object.label)
  return h('div', { class: 'empty' }, icon('box', 'art'), h('h2', null, 'No ' + lower(object.label) + ' yet'),
    h('p', null, m.canCreate(me, object) ? 'Add the first ' + one + ' and it will show up here for everyone who can see this table.' : 'You can see this table, but you cannot add to it.'),
    m.canCreate(me, object) ? h('button', { type: 'button', class: 'btn primary', onclick: ctx.a.openAdd }, icon('plus'), 'Add ' + one) : null)
}
const noMatch = (ctx) => h('div', { class: 'empty' }, h('h2', null, 'No ' + lower(ctx.object.label) + ' match' + (ctx.ui.q.trim() === '' ? '' : ' “' + ctx.ui.q.trim() + '”')),
  h('p', null, 'Try another word, or clear the search and the filter.'), h('button', { type: 'button', class: 'btn', onclick: ctx.a.clearFilters }, 'Clear search'))
const errorBox = (ctx) => h('div', { class: 'empty', role: 'alert' }, h('h2', null, 'Could not load ' + lower(ctx.object.label)), h('p', null, ctx.data.message), h('button', { type: 'button', class: 'btn', onclick: ctx.a.reload }, 'Try again'))

// ── the table ──

const cellFor = (ctx, field, record, slot) => {
  const d = m.describe(field, record.values[field.key], ctx.resolve)
  const { object, a } = ctx
  if (slot === 't') {
    const text = field.key === object.title || d.kind !== 'text' ? m.titleOf(object, record) : d.text
    return h('button', { type: 'button', class: 'rowlink', onclick: (e) => { e.stopPropagation(); a.open(object.key, record.id) } }, text)
  }
  return renderValue(d, { open: a.open })
}

function tableBox (ctx, rows) {
  const { object, ui } = ctx
  const cols = m.columnsOf(object)
  const slots = m.slotsFor(object)
  const numeric = (f) => f.type === 'money' || f.type === 'number'
  const shown = rows.slice(0, ui.shown)
  return [
    h('table', { class: 'list' },
      h('thead', null, h('tr', null, cols.map((f) => h('th', { scope: 'col', class: numeric(f) ? 'num' : undefined }, f.label)))),
      h('tbody', null, shown.map((r) => h('tr', { class: 'row', data: { id: r.id }, onclick: () => ctx.a.open(object.key, r.id) },
        cols.map((f) => h('td', { class: [slots[f.key], numeric(f) ? 'num' : ''] }, cellFor(ctx, f, r, slots[f.key]))))))),
    rows.length > shown.length ? h('div', { class: 'more-row' }, h('button', { type: 'button', class: 'btn', onclick: ctx.a.more }, 'Show ' + Math.min(PAGE, rows.length - shown.length) + ' more (' + (rows.length - shown.length) + ' left)')) : null,
  ]
}

// ── the board ──

function card (ctx, record, field, drag) {
  const { object, a } = ctx
  const slots = m.slotsFor(object)
  const pick = (slot) => object.fields.find((f) => slots[f.key] === slot && f.key !== field.key && f.key !== object.title)
  const meta = pick('m')
  const aside = pick('a')
  const show = (f) => renderValue(m.describe(f, record.values[f.key], ctx.resolve), { open: undefined })
  const open = () => a.open(object.key, record.id)
  return h('div', { class: ['card', drag ? 'drag' : ''], role: 'button', tabindex: '0', draggable: drag ? 'true' : undefined, 'aria-label': m.titleOf(object, record), data: { id: record.id }, onclick: open,
    onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open() } } },
  h('span', { class: 'row' }, h('b', null, m.titleOf(object, record)), aside ? h('span', { class: 'dim' }, show(aside)) : null),
  meta ? h('span', null, show(meta)) : null)
}

function boardBox (ctx, rows, field) {
  const drag = m.canUpdateField(ctx.me, ctx.object, field)
  let dragging = null
  const colOf = (e) => e.target.closest('.col')
  const cols = m.groupBoard(field, rows)
  return cols.map((c) => h('section', { class: 'col', data: { col: c.key }, 'aria-label': c.label },
    h('h3', null, pill(c.label, c.color), h('span', null, c.records.length)),
    c.records.length === 0 ? h('div', { class: 'empty-col' }, 'Nothing here') : c.records.slice(0, COLUMN_MAX).map((r) => card(ctx, r, field, drag)),
    c.records.length > COLUMN_MAX ? h('div', { class: 'empty-col' }, (c.records.length - COLUMN_MAX) + ' more: use the search to find them') : null,
  )).map((col) => {
    if (drag) {
      col.addEventListener('dragstart', (e) => { const el = e.target.closest('.card'); if (el === null) return; dragging = el.dataset.id; try { e.dataTransfer.setData('text/plain', dragging); e.dataTransfer.effectAllowed = 'move' } catch (x) { /* a browser without it */ } })
      col.addEventListener('dragover', (e) => { if (dragging !== null) { e.preventDefault(); colOf(e)?.classList.add('over') } })
      col.addEventListener('dragleave', (e) => { if (!col.contains(e.relatedTarget)) col.classList.remove('over') })
      col.addEventListener('drop', (e) => { if (dragging === null) return; e.preventDefault(); const id = dragging; dragging = null; col.classList.remove('over'); ctx.a.move(id, col.dataset.col) })
      col.addEventListener('dragend', () => { dragging = null })
    }
    return col
  })
}

// ── relations ──

function diagram (ctx, graph) {
  const lay = m.layoutGraph(m.ringOrder(graph.nodes, graph.edges))
  if (lay.nodes.length === 0) return null
  const box = new Map(lay.nodes.map((b) => [b.key, b]))
  const cur = ctx.object.key
  const edges = graph.edges.map((e) => {
    const A = box.get(e.a); const B = box.get(e.b)
    const p = m.edgePoints(A, B)
    const centre = (b) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 })
    const la = m.along(p.from, p.to, 18, 13, centre(A))
    const lb = m.along(p.to, p.from, 18, 13, centre(B))
    return s('g', null,
      s('path', { class: ['rel-line', e.a === cur || e.b === cur ? 'cur' : ''], d: 'M' + Math.round(p.from.x) + ' ' + Math.round(p.from.y) + ' L' + Math.round(p.to.x) + ' ' + Math.round(p.to.y) }),
      s('text', { class: 'card-no', x: la.x, y: la.y + 4, 'text-anchor': 'middle' }, e.aEnd),
      s('text', { class: 'card-no', x: lb.x, y: lb.y + 4, 'text-anchor': 'middle' }, e.bEnd))
  })
  const nodes = graph.nodes.map((n) => {
    const b = box.get(n.key)
    return s('a', { href: hash({ slug: ctx.route.slug, object: n.key, view: 'relations' }), 'aria-label': n.label + ', ' + m.plural(n.count, 'row', 'rows') },
      s('g', { class: ['node', n.key === cur ? 'cur' : ''] },
        s('rect', { x: b.x, y: b.y, width: b.w, height: b.h, rx: 10 }),
        s('text', { class: 'nm', x: b.x + 14, y: b.y + 24 }, n.label),
        s('text', { class: 'ct', x: b.x + b.w - 14, y: b.y + 24, 'text-anchor': 'end' }, n.count),
        n.links.length === 0 ? null : s('line', { x1: b.x, x2: b.x + b.w, y1: b.y + 36, y2: b.y + 36 }),
        n.links.slice(0, 3).map((l, i) => [s('circle', { class: 'dot', cx: b.x + 18, cy: b.y + 54 + i * 24, r: 3.5 }), s('text', { class: 'ln', x: b.x + 30, y: b.y + 58 + i * 24 }, l)])))
  })
  return h('div', { class: 'diagram' }, s('svg', { viewBox: '0 0 ' + lay.width + ' ' + lay.height, role: 'img', 'aria-label': 'How the tables are linked' }, edges, nodes))
}

function relationsBox (ctx) {
  const objects = ctx.app.objects
  const graph = m.relationGraph(objects)
  const links = m.linksOf(objects, ctx.object.key)
  const label = new Map(objects.map((o) => [o.key, o.label]))
  if (graph.edges.length === 0 && links.length === 0) {
    return h('div', { class: 'empty' }, icon('box', 'art'), h('h2', null, 'No links between tables'), h('p', null, 'The tables of this app do not point at each other yet.'))
  }
  return [
    diagram(ctx, graph),
    h('div', { class: 'links' }, h('h2', null, 'Links from ' + lower(ctx.object.label)),
      links.length === 0 ? h('p', { class: 'sub' }, 'This table does not link to another one, and none links to it.') : links.map((l) => {
        const other = l.from === ctx.object.key ? l.to : l.from
        return h('a', { class: 'link', href: hash({ slug: ctx.route.slug, object: other, view: 'table' }) },
          h('span', { class: 'txt' }, h('b', null, l.field), h('small', null, l.text)), h('span', { class: 'dim' }, 'Open ' + lower(label.get(other))), icon('arrow'))
      })),
  ]
}

// ── the main column ──

/** The result area: its look depends on the tab and on what there is to show, so the whole element is rebuilt (main.mjs swaps it in place). */
export function resultsEl (ctx) {
  const { object, data, ui, route } = ctx
  const el = (cls, ...kids) => h('div', { class: cls, id: 'results' }, ...kids)
  if (route.view === 'relations') return el('rel-wrap', relationsBox(ctx))
  if (data.status === 'error') return el('scroll', errorBox(ctx))
  if (data.status === 'loading' && data.records.length === 0) return el('scroll', skeleton())
  if (data.records.length === 0) return el('scroll', emptyBox(ctx))
  const field = m.choiceFields(object).find((f) => f.key === ui.group) ?? m.choiceFields(object)[0]
  const filterField = m.choiceFields(object)[0]
  const rows = m.sortRecords(object, m.filterRecords(object, data.records, { q: ui.q, field: filterField, value: route.view === 'table' ? ui.filter : '' }, ctx.resolve), route.view === 'board' ? 'new' : ui.sort)
  if (route.view === 'board' && field !== undefined) return el('board', boardBox(ctx, rows, field))
  if (rows.length === 0) return el('scroll', noMatch(ctx))
  return el('scroll', tableBox(ctx, rows))
}

function toolbar (ctx) {
  const { object, ui, a } = ctx
  const many = lower(object.label)
  const choices = m.choiceFields(object)
  const board = ctx.route.view === 'board' && choices.length > 0
  const search = h('div', { class: 'field' }, icon('search'), h('input', { class: 'input', type: 'search', placeholder: 'Search ' + many, 'aria-label': 'Search ' + many, value: ui.q, oninput: (e) => a.search(e.target.value) }))
  if (board) {
    const field = choices.find((f) => f.key === ui.group) ?? choices[0]
    const drag = m.canUpdateField(ctx.me, object, field)
    return h('div', { class: 'toolbar' }, search,
      choices.length > 1 ? h('select', { class: 'input auto', 'aria-label': 'Group by', onchange: (e) => a.setGroup(e.target.value) }, choices.map((f) => h('option', { value: f.key, selected: f.key === field.key }, 'Group by ' + lower(f.label)))) : null,
      h('span', { class: 'note' }, 'Grouped by ' + lower(field.label) + '.' + (drag ? ' Drag a card to change it.' : '')))
  }
  const filter = choices[0]
  return h('div', { class: 'toolbar' }, search,
    filter === undefined ? null : h('select', { class: 'input auto', 'aria-label': 'Filter by ' + lower(filter.label), onchange: (e) => a.setFilter(e.target.value) },
      h('option', { value: '' }, filter.label + ': all'), filter.options.map((o) => h('option', { value: o.key, selected: o.key === ui.filter }, o.label))),
    h('select', { class: 'input auto', 'aria-label': 'Sort', onchange: (e) => a.setSort(e.target.value) }, m.SORTS.map((x) => h('option', { value: x.key, selected: x.key === ui.sort }, x.label))))
}

const TABS = [['table', 'Table', 'table'], ['board', 'Board', 'board'], ['relations', 'Relations', 'rel']]

function mainEl (ctx) {
  const { app, object, route, me, data, a } = ctx
  const menu = h('button', { type: 'button', class: 'btn icon ghost menu-btn', 'aria-label': 'Open menu', 'aria-expanded': String(ctx.ui.nav), onclick: a.toggleNav }, icon('menu'))
  if (object === null) {
    return h('main', { class: 'main' }, h('div', { class: 'top' }, menu, h('div', { class: 'grow' }, h('h1', null, app === null ? 'Team space' : app.name))),
      h('div', { class: 'empty' }, icon('box', 'art'), h('h2', null, app === null ? 'No app here yet' : 'Nothing to show yet'),
        h('p', null, app === null ? (m.isOwner(me) ? 'When an app is published to this space it shows up here.' : 'Nothing is shared with your role yet.') : 'No table of this app is open to your role yet.')))
  }
  const count = data.status === 'ready' ? data.records.length : object.count
  const one = m.singular(object.label)
  const add = m.canCreate(me, object) && !(data.status === 'ready' && count === 0) ? h('button', { type: 'button', class: 'btn primary', onclick: a.openAdd }, icon('plus'), 'Add ' + one) : null
  const tabs = TABS.filter(([view]) => view !== 'board' || m.choiceFields(object).length > 0)
  const banner = m.isOwner(me) && me.passwordSet === false && !ctx.ui.passwordSkipped
    ? h('div', { class: 'banner' }, icon('lock'), h('p', null, 'You came in with a link. Set a password to sign in without it.'), h('button', { type: 'button', class: 'btn sm', onclick: a.openPassword }, 'Set a password'))
    : null
  const toolbarOn = route.view !== 'relations' && data.status === 'ready' && data.records.length > 0
  return h('main', { class: 'main' },
    h('div', { class: 'top' }, menu, h('div', { class: 'grow' }, h('h1', null, object.label), h('p', { class: 'sub' }, m.plural(count, 'row', 'rows'))), add),
    banner,
    h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Views' }, tabs.map(([view, text, ic]) => h('a', { class: 'tab', role: 'tab', 'aria-selected': String(route.view === view), href: hash({ ...route, view }) }, icon(ic), text))),
    toolbarOn ? toolbar(ctx) : null,
    resultsEl(ctx))
}

// ── the row drawer ──

function detailBody (ctx, object, record) {
  const { me, a } = ctx
  const edit = ctx.detail.edit
  const shown = object.fields.filter((f) => f.key !== object.title || (edit !== null && edit.partOf(f.key) !== undefined))
  /** A field as it is read: a select for a choice the actor may change (it saves as soon as it changes), else the value. */
  const readOf = (f) => {
    const value = record.values[f.key]
    if (f.type === 'choice' && m.canUpdateField(me, object, f)) {
      const known = m.optionOf(f, value) !== undefined
      return h('select', { class: 'input auto', id: 'd-' + f.key, 'aria-label': f.label, onchange: (e) => a.setField(object, record, f, e.target.value) },
        f.required && known ? null : h('option', { value: '' }, '—'), f.options.map((o) => h('option', { value: o.key, selected: o.key === value }, o.label)))
    }
    return renderValue(m.describe(f, value, ctx.resolve), { detail: true, open: a.open, fileUrl: (hashOf) => ctx.fileUrl(object.key, record.id, f.key, hashOf) })
  }
  const list = edit === null
    ? h('dl', { class: 'kv' }, shown.map((f) => h('div', null, h('dt', null, f.label), h('dd', null, readOf(f)))))
    : h('div', { class: 'editlist' }, shown.map((f) => { const part = edit.partOf(f.key); return part !== undefined ? part.ctl.node : h('div', { class: 'fld ro' }, h('span', { class: 'lab' }, f.label), readOf(f)) }))
  const by = (who) => { const w = m.byWords(who); return w === '' ? '' : ' by ' + w }
  const history = []
  if (record.rev > 1 || record.modified.at !== record.created.at) history.push(h('li', null, h('span', null, 'Last changed' + by(record.modified.by), h('small', null, m.fmtStamp(record.modified.at)))))
  history.push(h('li', null, h('span', null, 'Added' + by(record.created.by), h('small', null, m.fmtStamp(record.created.at)))))
  const groups = ctx.detail.links ?? []
  const visible = new Set(ctx.app.objects.map((o) => o.key))
  return [
    edit === null ? null : edit.banner,
    list,
    groups.length === 0 ? null : h('div', { class: 'detail-section' }, h('h2', null, 'Linked here'), groups.map((g) => h('div', { class: 'group' }, h('b', null, g.objectLabel + ' · ' + g.fieldLabel),
      h('span', { class: 'chips' }, g.records.map((r) => {
        const title = r.title === '' ? 'Untitled' : r.title
        const inner = [h('i', { 'aria-hidden': 'true' }, m.initials(title)), h('span', null, title)]
        return visible.has(g.object) ? h('button', { type: 'button', class: 'chip', onclick: () => a.open(g.object, r.id) }, inner) : h('span', { class: 'chip' }, inner)
      }))))),
    m.isOwner(me) ? null : h('p', { class: 'note' }, icon('lock'), edit === null ? 'You see the fields your role allows.' : 'Fields your role cannot change stay as they are.'),
    h('div', { class: 'detail-section' }, h('h2', null, 'History'), h('ul', { class: 'hist' }, history)),
    m.canArchive(me) && edit === null ? archiveBox(ctx, object, record) : null,
  ]
}

function archiveBox (ctx, object, record) {
  const { a, detail } = ctx
  if (!detail.confirm) return h('div', null, h('button', { type: 'button', class: 'btn sm ghost danger', onclick: a.askArchive }, icon('archive'), 'Archive ' + m.singular(object.label)))
  return h('div', { class: 'confirm', role: 'group', 'aria-label': 'Confirm archive' }, h('p', null, h('b', null, 'Archive ' + m.titleOf(object, record) + '?'), h('br'), h('span', { class: 'dim' }, 'It leaves the list. Nothing is deleted.')),
    h('div', { class: 'chips' }, h('button', { type: 'button', class: 'btn sm danger', onclick: a.archive }, 'Archive'), h('button', { type: 'button', class: 'btn sm', onclick: a.cancelArchive }, 'Keep')))
}

/** The scrim and drawer of the open row, or `[]` when the row is not (or no longer) there. */
export function detailDrawer (ctx) {
  const { detail } = ctx
  const object = ctx.app.objects.find((o) => o.key === detail.object)
  const record = ctx.recordOf(detail.object, detail.id)
  if (object === undefined || record === undefined) return []
  const edit = detail.edit
  const canEdit = edit === null && m.editableFields(ctx.me, object, new Set(ctx.app.objects.map((o) => o.key))).length > 0
  return drawerBox({
    label: m.titleOf(object, record), title: m.titleOf(object, record), body: detailBody(ctx, object, record), onClose: ctx.a.closeDrawer,
    actions: canEdit ? h('button', { type: 'button', class: 'btn sm', onclick: ctx.a.startEdit }, icon('edit'), 'Edit') : null,
    footer: edit === null ? null : edit.footer, onsubmit: edit === null ? undefined : ctx.a.saveEdit, lockScrim: edit !== null,
  })
}

// ── the page ──

/** The whole signed-in page: the rail, the working column and, when one is open, a drawer (`drawerNodes`). */
export function shell (ctx, drawerNodes) {
  return h('div', { class: ['shell', ctx.ui.nav ? 'navopen' : ''] }, h('div', { class: 'app' }, nav(ctx), h('div', { class: 'navscrim', onclick: ctx.a.toggleNav }), mainEl(ctx)), drawerNodes)
}

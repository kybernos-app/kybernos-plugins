// main.mjs — the state of the page and what the page does: sign in, load the apps this person may see, follow the hash route, load a table's rows, and carry out the actions the
// views ask for (open a row, add one, move a card, archive). Rights are the server's: a control is drawn only when model.mjs says the door allowed it, and a refusal from the door
// is shown as the answer. No framework: every change rebuilds the page from the state (keeping focus, scroll and a form being filled), typing in the search rebuilds only the results.
import { makeApi } from './api.mjs'
import { fill, h } from './dom.mjs'
import { addDrawer, passwordDrawer } from './forms.mjs'
import * as m from './model.mjs'
import { PAGE, detailDrawer, messageView, resultsEl, shell, signInView } from './views.mjs'

const api = makeApi()
const root = document.getElementById('root')
const DEFAULT_MAX_BYTES = 25 * 1024 * 1024

const S = {
  me: null,
  apps: [],
  peopleCount: null,
  route: { slug: '', object: '', view: 'table' },
  ui: { q: '', filter: '', sort: 'new', group: '', shown: PAGE, nav: false, passwordSkipped: false },
  cache: new Map(), // `<slug>/<object>` → { status: 'loading' | 'ready' | 'error', records, byId, message }
  drawer: null, // null | { kind: 'add' | 'password', nodes } | { kind: 'detail', object, id, confirm, links }
  focusDrawer: false,
  returnTo: null, // what to give focus back to when the drawer closes
  notice: '',
}
const keyOf = (slug, object) => slug + '/' + object
const entryOf = (object) => S.cache.get(keyOf(S.route.slug, object))
const appNow = () => S.apps.find((x) => x.slug === S.route.slug) ?? null
const objectNow = () => appNow()?.objects.find((o) => o.key === S.route.object) ?? null
const recordOf = (object, id) => entryOf(object)?.byId.get(id)
const store = (slug, object, entry) => { S.cache.set(keyOf(slug, object), { ...entry, byId: new Map(entry.records.map((r) => [r.id, r])) }) }

function resolve (objectKey, id) {
  const o = appNow()?.objects.find((x) => x.key === objectKey)
  const r = recordOf(objectKey, id)
  return o === undefined || r === undefined ? null : m.titleOf(o, r)
}
const targets = (objectKey) => {
  const o = appNow()?.objects.find((x) => x.key === objectKey)
  const e = entryOf(objectKey)
  return o === undefined || e === undefined ? [] : e.records.map((r) => ({ id: r.id, title: m.titleOf(o, r) })).sort((a, b) => a.title.localeCompare(b.title, 'en', { sensitivity: 'base' }))
}

// ── toast ──
let toastEl = null
let toastTimer = null
function toast (text, bad = false) {
  if (toastEl === null) { toastEl = h('div', { class: 'toast', role: 'status', 'aria-live': 'polite' }); document.body.append(toastEl) }
  toastEl.className = bad ? 'toast bad' : 'toast'
  toastEl.textContent = text
  toastEl.hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { toastEl.hidden = true }, bad ? 5000 : 2800)
}

// ── drawing ──
function context () {
  return {
    me: S.me, apps: S.apps, app: appNow(), object: objectNow(), route: S.route, ui: S.ui, peopleCount: S.peopleCount,
    data: (objectNow() && entryOf(objectNow().key)) || { status: 'loading', records: [], message: '' },
    detail: S.drawer !== null && S.drawer.kind === 'detail' ? S.drawer : null,
    resolve, recordOf, targets, labelOf: (key) => appNow()?.objects.find((o) => o.key === key)?.label ?? key,
    fileUrl: (object, id, field, hash) => api.fileUrl(S.route.slug, object, id, field, hash),
    a: actions,
  }
}

/** Rebuilds the page from the state, then puts back what the person was doing: the focused control, the scroll of the results. */
function render () {
  if (S.me === null) {
    fill(root, signInView({ submit: signIn, notice: S.notice }))
    document.getElementById('si-email')?.focus()
    return
  }
  const active = document.activeElement
  const mark = active !== null && active !== document.body && root.contains(active) ? { id: active.id, start: active.selectionStart, end: active.selectionEnd } : null
  const box = root.querySelector('#results')
  const scroll = box === null ? null : { x: box.scrollLeft, y: box.scrollTop }
  const ctx = context()
  let nodes = []
  if (S.drawer !== null) {
    if (S.drawer.kind === 'detail') nodes = detailDrawer(ctx)
    else nodes = S.drawer.nodes
  }
  fill(root, shell(ctx, nodes))
  if (scroll !== null) { const now = root.querySelector('#results'); if (now !== null) { now.scrollLeft = scroll.x; now.scrollTop = scroll.y } }
  const drawerEl = root.querySelector('.drawer')
  if (S.focusDrawer && drawerEl !== null) {
    S.focusDrawer = false;
    (drawerEl.querySelector('input:not([type=checkbox]):not([type=radio]):not([type=file]), select, textarea') ?? drawerEl).focus({ preventScroll: true })
  } else if (mark !== null && mark.id !== '') {
    const back = document.getElementById(mark.id)
    if (back !== null) {
      back.focus({ preventScroll: true })
      try { if (mark.start !== null) back.setSelectionRange(mark.start, mark.end) } catch (e) { /* a control with no selection */ }
    }
  } else if (drawerEl !== null && !drawerEl.contains(document.activeElement)) drawerEl.focus({ preventScroll: true })
}
function renderResults () {
  const old = root.querySelector('#results')
  if (old === null) render(); else old.replaceWith(resultsEl(context()))
}

// ── loading ──
async function fetchRows (slug, object) {
  const r = await api.records(slug, object)
  if (r.status === 401) return { status: 'expired' }
  if (!r.ok) return { status: 'error', records: [], message: m.readAnswer(r.status, r.body).message }
  return { status: 'ready', records: r.body.records, message: '' }
}

/** Loads a table and the tables its relation fields point at (so a link shows a title), then draws once. `quiet`: keep showing what is there while it refreshes. */
async function enter (quiet = false) {
  const app = appNow()
  const object = objectNow()
  if (app === null || object === null) return
  const slug = app.slug
  const wanted = [object.key, ...m.relationsOf(object).map((f) => f.to).filter((to) => app.objects.some((o) => o.key === to))].filter((k, i, all) => all.indexOf(k) === i)
  if (!quiet || !S.cache.has(keyOf(slug, object.key))) {
    store(slug, object.key, { status: 'loading', records: S.cache.get(keyOf(slug, object.key))?.records ?? [], message: '' })
    render()
  }
  const results = await Promise.all(wanted.map((k) => fetchRows(slug, k)))
  if (results.some((r) => r.status === 'expired')) return sessionEnded()
  wanted.forEach((k, i) => {
    store(slug, k, results[i])
    const o = app.objects.find((x) => x.key === k)
    if (results[i].status === 'ready') o.count = results[i].records.length
  })
  render()
}

function sessionEnded () {
  S.me = null
  S.drawer = null
  S.notice = 'Your session ended. Sign in again.'
  render()
}

// ── the route ──
function onRoute () {
  const next = m.settleRoute(S.apps, m.parseRoute(location.hash))
  const route = next ?? { slug: '', object: '', view: 'table' }
  const wanted = next === null ? '' : m.routeHash(route)
  if (wanted !== '' && wanted !== location.hash) history.replaceState(null, '', wanted)
  const moved = route.slug !== S.route.slug || route.object !== S.route.object
  S.route = route
  S.ui.nav = false
  if (moved) { S.ui.q = ''; S.ui.filter = ''; S.ui.sort = 'new'; S.ui.group = ''; S.ui.shown = PAGE; S.drawer = null }
  const o = objectNow()
  document.title = o === null ? 'Team space' : o.label + ' · ' + (appNow()?.name ?? 'Team space')
  render()
  if (o !== null) enter(S.cache.has(keyOf(route.slug, o.key)))
}

// ── drawers ──
function openDrawer (drawer) {
  S.returnTo = document.activeElement
  S.drawer = drawer
  S.focusDrawer = true
}
function closeDrawer () {
  const wasDetail = S.drawer !== null && S.drawer.kind === 'detail' ? S.drawer : null
  const returnTo = S.returnTo
  S.drawer = null
  S.returnTo = null
  render()
  const row = wasDetail === null ? null : root.querySelector('#results [data-id="' + CSS.escape(wasDetail.id) + '"]')
  const target = row !== null ? (row.matches('tr') ? row.querySelector('.rowlink') : row) : (returnTo !== null && root.contains(returnTo) ? returnTo : root.querySelector('.top .btn.primary'))
  if (target !== null) target.focus({ preventScroll: true })
}

// ── writes ──
async function submitAdd (raw, fields) {
  const app = appNow()
  const object = objectNow()
  const fail = (fieldsErr, message) => ({ ok: false, fields: fieldsErr, message })
  // check the typed values first (files as placeholders), so nothing is uploaded for a form that cannot be sent
  const stub = { ...raw }
  for (const f of fields) if (f.type === 'attachment') stub[f.key] = raw[f.key].map((file) => file.name)
  const checked = m.readForm(fields, stub)
  const errors = { ...checked.errors }
  for (const f of fields) {
    if (f.type !== 'attachment') continue
    const cap = f.maxBytes ?? DEFAULT_MAX_BYTES
    const big = raw[f.key].find((file) => file.size > cap)
    if (big !== undefined) errors[f.key] = big.name + ' is larger than ' + m.fmtSize(cap) + '.'
  }
  if (Object.keys(errors).length > 0) return fail(errors, 'Some fields need a look.')
  const input = { ...raw }
  for (const f of fields) {
    if (f.type !== 'attachment') continue
    const done = []
    for (const file of raw[f.key]) {
      const up = await api.upload(app.slug, object.key, f.key, file)
      if (up.status === 401) { sessionEnded(); return fail({}, '') }
      if (!up.ok) { const a = m.readAnswer(up.status, up.body); return fail({ [f.key]: a.message }, a.message) }
      done.push(up.body.file)
    }
    input[f.key] = done
  }
  const { values } = m.readForm(fields, input)
  const r = await api.write(app.slug, { object: object.key, op: 'create', values })
  if (r.status === 401) { sessionEnded(); return fail({}, '') }
  if (!r.ok) { const a = m.readAnswer(r.status, r.body); return fail(a.fields, a.message) }
  const entry = entryOf(object.key)
  store(app.slug, object.key, { status: 'ready', records: [r.body.record, ...entry.records], message: '' })
  object.count = entry.records.length + 1
  closeDrawer()
  toast('Added ' + m.titleOf(object, r.body.record))
  return { ok: true }
}

async function setField (object, record, field, value) {
  const next = value === '' ? null : value
  if ((record.values[field.key] ?? null) === next) return
  if (next === null && field.required) { toast(field.label + ' is required.', true); render(); return }
  const before = { value: record.values[field.key], modified: record.modified }
  record.values[field.key] = next
  record.modified = { by: 'person', at: new Date().toISOString() }
  render()
  const r = await api.write(S.route.slug, { object: object.key, op: 'update', id: record.id, values: { [field.key]: next } })
  if (r.status === 401) return sessionEnded()
  if (!r.ok) {
    record.values[field.key] = before.value
    record.modified = before.modified
    render()
    const a = m.readAnswer(r.status, r.body)
    toast(a.fields[field.key] ?? a.message, true)
    return
  }
  const entry = entryOf(object.key)
  store(S.route.slug, object.key, { status: 'ready', records: entry.records.map((x) => (x.id === record.id ? r.body.record : x)), message: '' })
  render()
  const option = m.optionOf(field, next)
  toast(next === null ? m.titleOf(object, r.body.record) + ': ' + field.label.toLowerCase() + ' cleared' : m.titleOf(object, r.body.record) + ' is now ' + (option === undefined ? next : option.label))
}

async function archive () {
  const d = S.drawer
  const object = appNow().objects.find((o) => o.key === d.object)
  const record = recordOf(d.object, d.id)
  const r = await api.write(S.route.slug, { object: d.object, op: 'delete', id: d.id })
  if (r.status === 401) return sessionEnded()
  if (!r.ok) { toast(m.readAnswer(r.status, r.body).message, true); return }
  const entry = entryOf(d.object)
  store(S.route.slug, d.object, { status: 'ready', records: entry.records.filter((x) => x.id !== d.id), message: '' })
  object.count = entry.records.length - 1
  closeDrawer()
  toast('Archived ' + m.titleOf(object, record))
}

async function signIn (email, password) {
  const r = await api.signIn(email, password)
  if (r.status === 401 || r.status === 400) return { ok: false, message: 'That email and password do not match.' }
  if (!r.ok) return { ok: false, message: m.readAnswer(r.status, r.body).message }
  S.notice = ''
  await boot()
  return { ok: true }
}

// ── what the views can ask for ──
const actions = {
  closeNav () { if (S.ui.nav) { S.ui.nav = false; render() } },
  toggleNav () { S.ui.nav = !S.ui.nav; render() },
  closeDrawer,
  openAdd () {
    const object = objectNow()
    const ctx = context()
    openDrawer({ kind: 'add', nodes: addDrawer(ctx, object, { submit: submitAdd, close: closeDrawer }) })
    render()
  },
  openPassword () {
    openDrawer({ kind: 'password', nodes: passwordDrawer({ close: () => { S.ui.passwordSkipped = true; closeDrawer() }, submit: async (password) => {
      const r = await api.setPassword(password)
      if (r.status === 401) { sessionEnded(); return { ok: true } }
      if (!r.ok) return { ok: false, message: m.readAnswer(r.status, r.body).message }
      S.me.passwordSet = true
      closeDrawer()
      toast('Password saved')
      return { ok: true }
    } }) })
    render()
  },
  async open (objectKey, id) {
    const slug = S.route.slug
    if (entryOf(objectKey) === undefined) {
      const rows = await fetchRows(slug, objectKey)
      if (rows.status === 'expired') return sessionEnded()
      store(slug, objectKey, rows)
    }
    if (recordOf(objectKey, id) === undefined) return
    openDrawer({ kind: 'detail', object: objectKey, id, confirm: false, links: null })
    render()
    const mine = S.drawer
    const r = await api.links(slug, objectKey, id)
    if (S.drawer === mine && r.ok) { mine.links = r.body.groups; render() }
  },
  search (q) { S.ui.q = q; S.ui.shown = PAGE; renderResults() },
  setFilter (v) { S.ui.filter = v; S.ui.shown = PAGE; renderResults() },
  setSort (v) { S.ui.sort = v; renderResults() },
  setGroup (key) { S.ui.group = key; render() },
  more () { S.ui.shown += PAGE; renderResults() },
  clearFilters () { S.ui.q = ''; S.ui.filter = ''; S.ui.shown = PAGE; render() },
  reload () { enter() },
  move (id, columnKey) {
    const object = objectNow()
    const choices = m.choiceFields(object)
    const field = choices.find((f) => f.key === S.ui.group) ?? choices[0]
    const record = recordOf(object.key, id)
    if (record !== undefined && field !== undefined) setField(object, record, field, columnKey)
  },
  setField,
  askArchive () { S.drawer.confirm = true; render() },
  cancelArchive () { S.drawer.confirm = false; render() },
  archive,
  async signOut () {
    await api.signOut()
    S.me = null
    S.apps = []
    S.cache.clear()
    S.drawer = null
    S.notice = ''
    history.replaceState(null, '', location.pathname)
    render()
  },
}

// ── start ──
let listening = false
async function boot () {
  const session = await api.session()
  if (session.ok && session.body === null) { S.me = null; render(); return }
  const me = await api.me()
  if (me.status === 401) { S.me = null; render(); return }
  if (!me.ok) { fill(root, messageView('Could not load', m.readAnswer(me.status, me.body).message, () => { boot() })); return }
  const apps = await api.apps()
  if (!apps.ok) { fill(root, messageView('Could not load', m.readAnswer(apps.status, apps.body).message, () => { boot() })); return }
  S.me = me.body
  S.apps = apps.body.apps
  S.route = { slug: '', object: '', view: 'table' }
  S.cache.clear()
  S.drawer = null
  if (m.isOwner(S.me)) api.people().then((p) => { S.peopleCount = p.ok ? p.body.members.length : null; if (S.me !== null) render() })
  if (!listening) {
    listening = true
    window.addEventListener('hashchange', onRoute)
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || S.me === null) return
      if (S.drawer !== null) closeDrawer(); else if (S.ui.nav) actions.closeNav()
    })
    document.addEventListener('visibilitychange', () => { if (!document.hidden && S.me !== null && objectNow() !== null) enter(true) })
  }
  onRoute()
}

boot()

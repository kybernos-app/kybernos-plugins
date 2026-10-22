// kybernos-dashboards: the store, the agent's tool and the routes, on a real temporary folder.
// `cd packages/kybernos-dashboards && node test-host.mjs`
import * as fsp from 'node:fs/promises'
import { mkdtempSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { createHost, applyOps, runTool, toolOptions, makeDoc, dashboardOfDoc, TOOL, KEEP } from './dashboard-host.mjs'
// index.js reads DSH_HOME when it is imported and seeds skills when it is applied: point it at a temp folder FIRST, so the
// test never writes into the real ~/.dsh.
const SANDBOX_HOME = mkdtempSync(join(tmpdir(), 'kb-dash-home-'))
process.env.DSH_HOME = SANDBOX_HOME
const Index = await import('./index.js')

let fail = 0
let passed = 0
const ok = (name, cond, detail) => {
  if (cond) { passed++; return }
  fail++
  console.log('FAIL ' + name + (detail === undefined ? '' : ' :: ' + JSON.stringify(detail)))
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const tmp = () => mkdtempSync(join(tmpdir(), 'kb-dash-'))
let clock = Date.parse('2026-10-13T10:00:00Z')
const mkHost = (home) => createHost({ fs: fsp, home, now: () => (clock += 1000), log: () => {} })

const CARD = (t = 'Tokens') => ({ type: 'card', title: t, source: { provider: 'usage.daily', params: { days: 7 } }, metric: { agg: 'sum', field: 'tokens' } })
const CHART = { type: 'chart', title: 'Per day', kind: 'columns', x: 'day', y: 'tokens', source: { provider: 'usage.daily' }, w: 8 }

// ── applyOps (pure) ──────────────────────────────────────────────────────────
{
  const cur = { name: 'D', desc: '', widgets: [{ id: 'a', type: 'note', text: '1' }, { id: 'b', type: 'note', text: '2' }, { id: 'c', type: 'note', text: '3' }] }
  const ids = (r) => r.dashboard.widgets.map((w) => w.id)
  ok('ops: add appends', same(ids(applyOps(cur, [{ op: 'add', widget: { id: 'd', type: 'note' } }])), ['a', 'b', 'c', 'd']))
  ok('ops: add after', same(ids(applyOps(cur, [{ op: 'add', widget: { id: 'd', type: 'note' }, after: 'a' }])), ['a', 'd', 'b', 'c']))
  ok('ops: remove', same(ids(applyOps(cur, [{ op: 'remove', id: 'b' }])), ['a', 'c']))
  ok('ops: update merges and null removes a key', (() => { const r = applyOps(cur, [{ op: 'update', id: 'a', set: { text: 'x', tint: 'amber' } }, { op: 'update', id: 'a', set: { tint: null } }]); return r.dashboard.widgets[0].text === 'x' && !('tint' in r.dashboard.widgets[0]) })())
  ok('ops: update cannot change an id', applyOps(cur, [{ op: 'update', id: 'a', set: { id: 'zzz' } }]).dashboard.widgets[0].id === 'a')
  ok('ops: move to a place', same(ids(applyOps(cur, [{ op: 'move', id: 'c', to: 0 }])), ['c', 'a', 'b']) && same(ids(applyOps(cur, [{ op: 'move', id: 'a', after: 'c' }])), ['b', 'c', 'a']))
  ok('ops: meta', applyOps(cur, [{ op: 'meta', name: 'New', desc: 'd' }]).dashboard.name === 'New')
  const bad = applyOps(cur, [{ op: 'remove', id: 'zz' }, { op: 'nope' }, 3, { op: 'add' }, { op: 'update', id: 'a' }])
  ok('ops: every mistake is reported and nothing breaks', bad.errors.length === 5 && ids(bad).length === 3, bad.errors)
  ok('ops: the current dashboard is not mutated', cur.widgets.length === 3 && cur.name === 'D')
}

// ── store ────────────────────────────────────────────────────────────────────
{
  const home = tmp()
  const host = mkHost(home)
  ok('empty store lists nothing', same((await host.list()).dashboards, []))
  const a = await host.create({ name: 'Usage', raw: { widgets: [CARD(), CHART] }, by: 'agent', what: 'Created' })
  ok('create: returns an id from the name and revision 1', a.ok && a.id === 'usage' && a.rev === 1 && a.dashboard.widgets.length === 2, a)
  ok('create: the file is a shared livrable of kind dashboard', (() => { const d = JSON.parse(readFileSync(join(home, 'kybernos', 'dashboards', 'files', 'usage.miniapp.json'), 'utf8')); return d.kind === 'dashboard' && d.renderer === 'dashboard' && d.title === 'Usage' && d.meta.rev === 1 && d.data.length === 1 && dashboardOfDoc(d).widgets.length === 2 })())
  const b = await host.create({ name: 'Usage', raw: { widgets: [CARD()] }, by: 'agent' })
  ok('create: a taken name gets a suffix, on the id and on the name shown', b.id === 'usage-2' && b.dashboard.name === 'Usage 2', [b.id, b.dashboard && b.dashboard.name])
  const l = await host.list()
  ok('list: both, with their shape and sources', l.dashboards.length === 2 && l.dashboards.find((d) => d.id === 'usage').widgets === 2 && same(l.dashboards.find((d) => d.id === 'usage').sources, ['usage.daily']) && l.dashboards[0].shape.length > 0, l.dashboards)
  ok('list: newest first', l.dashboards[0].updatedAt >= l.dashboards[1].updatedAt)

  // save, revisions
  const s = await host.save({ id: 'usage', raw: { name: 'Usage', widgets: [CARD('One')] }, by: 'user', what: 'Moved a card' })
  ok('save: bumps the revision and keeps a history of who and what', s.ok && s.rev === 2)
  const r = await host.readDoc('usage')
  ok('read: validated, with history', r.ok && r.rev === 2 && r.history.length === 2 && r.history[1].by === 'user' && r.history[1].what === 'Moved a card' && r.dashboard.widgets[0].title === 'One')
  ok('save: a conflict is refused, nothing is written', (await host.save({ id: 'usage', raw: { widgets: [] }, by: 'user', expectRev: 1 })).conflict === true && (await host.readDoc('usage')).rev === 2)
  ok('save: the expected revision is accepted', (await host.save({ id: 'usage', raw: { name: 'Usage', widgets: [CARD('Two')] }, by: 'user', expectRev: 2 })).ok === true)
  ok('save: an invalid id is refused', (await host.save({ id: '../etc', raw: {}, by: 'user' })).ok === false && (await host.save({ id: 'A B', raw: {}, by: 'user' })).ok === false)
  ok('save: a non-object is refused', (await host.save({ id: 'usage', raw: 'x', by: 'user' })).ok === false)
  const revs = await host.revisions('usage')
  ok('revisions: newest first with who and what', revs.length === 3 && revs[0].r === 3 && revs[2].r === 1 && revs[2].by === 'agent', revs)
  const back = await host.restore('usage', 1)
  ok('restore: writes the old content as a new revision', back.ok && back.rev === 4 && (await host.readDoc('usage')).dashboard.widgets.length === 2 && (await host.readDoc('usage')).history.slice(-1)[0].what === 'Restored r1')
  ok('restore: an unknown revision is refused', (await host.restore('usage', 99)).ok === false)
  for (let i = 0; i < KEEP.revisions + 5; i++) await host.save({ id: 'usage', raw: { name: 'Usage', widgets: [CARD('n' + i)] }, by: 'user', what: 'n' + i })
  ok('revisions: capped on disk', (await host.revisions('usage')).length === KEEP.revisions)
  ok('history: capped inside the file', (await host.readDoc('usage')).history.length <= KEEP.history)
  ok('a unique file name per id, no stray temp file', (await fsp.readdir(join(home, 'kybernos', 'dashboards', 'files'))).every((n) => n.endsWith('.miniapp.json')))

  // flags and defaults
  ok('flags: default', (await host.setFlags('usage', { default: true })).isDefault === true && (await host.list()).default === 'usage')
  ok('flags: hide and archive', (await host.setFlags('usage-2', { hidden: true })).hidden === true && (await host.setFlags('usage-2', { archived: true })).archived === true)
  ok('flags: archiving the default clears it', (await host.setFlags('usage', { archived: true })).isDefault === false && (await host.list()).default === null)
  ok('flags: an unknown dashboard is refused', (await host.setFlags('ghost', { hidden: true })).ok === false)
  ok('flags: persisted in the index', (await host.readIndex()).flags['usage-2'].archived === true)

  // clone and presets
  const c = await host.clone('usage-2')
  ok('clone: a copy with its own id and name', c.ok && c.id === 'usage-2-copy' && c.dashboard.name === 'Usage 2 copy', c)
  ok('clone: the copy is not archived', (await host.list()).dashboards.find((d) => d.id === c.id).archived === false)
  ok('clone: an unknown dashboard is refused', (await host.clone('ghost')).ok === false)
  const p = await host.fromPreset('automations-health')
  ok('preset: creates a real dashboard from the template', p.ok && p.id === 'automations-health' && p.dashboard.widgets.length >= 6)
  ok('preset: the history says where it came from', (await host.readDoc(p.id)).history[0].by === 'preset' && (await host.readDoc(p.id)).history[0].what.includes('Automations health'))
  const p3 = await host.fromPreset('automations-health')
  ok('preset: a second use without a name is told apart on the card too', p3.ok && p3.id === 'automations-health-2' && p3.dashboard.name === 'Automations health 2', [p3.id, p3.dashboard && p3.dashboard.name])
  const p2 = await host.fromPreset('automations-health', 'My automations')
  ok('preset: a second use gives a second copy', p2.ok && p2.id === 'my-automations')
  ok('preset: an unknown preset is refused', (await host.fromPreset('nope')).ok === false)

  // damage
  await fsp.writeFile(join(home, 'kybernos', 'dashboards', 'files', 'broken.miniapp.json'), '{not json', 'utf8')
  await fsp.writeFile(join(home, 'kybernos', 'dashboards', 'files', 'other.miniapp.json'), JSON.stringify({ kind: 'motion', data: [{}] }), 'utf8')
  await fsp.writeFile(join(home, 'kybernos', 'dashboards', 'files', 'big.miniapp.json'), 'x'.repeat(500000), 'utf8')
  ok('read: damaged, foreign and oversized files are refused politely', (await host.readDoc('broken')).ok === false && (await host.readDoc('other')).ok === false && (await host.readDoc('big')).ok === false)
  ok('list: skips them, does not throw', (await host.list()).dashboards.every((d) => !['broken', 'other', 'big'].includes(d.id)))
  // L2-08: a file the host cannot read is named with its reason, not dropped without a word.
  const lst = await host.list()
  ok('list: the unreadable files are named, each with a stable code and the host\'s reason', same(lst.unreadable, [
    { id: 'big', code: 'too-large', message: 'The dashboard file is too large.' },
    { id: 'broken', code: 'invalid-json', message: 'The dashboard file is not valid JSON.' },
    { id: 'other', code: 'not-dashboard', message: 'This file is not a dashboard (kind must be "dashboard").' },
  ]), lst.unreadable)
  ok('list: readable dashboards are not in the unreadable list, and a clean store has an empty one', lst.unreadable.every((u) => !lst.dashboards.some((d) => d.id === u.id)) && same((await mkHost(tmp()).list()).unreadable, []))
  await fsp.writeFile(join(home, 'kybernos', 'dashboards', 'index.json'), 'garbage', 'utf8')
  ok('index: a damaged index is an empty one', same(await host.readIndex(), { version: 1, default: null, flags: {} }))
  ok('doc helpers round-trip', dashboardOfDoc(makeDoc({ name: 'x', widgets: [] }, { rev: 1 })).name === 'x' && dashboardOfDoc({ kind: 'motion' }) === null && dashboardOfDoc(null) === null && dashboardOfDoc({ kind: 'dashboard', data: [{ payload: { name: 'wrapped' } }] }).name === 'wrapped')
}

// ── the tool ─────────────────────────────────────────────────────────────────
{
  const home = tmp()
  const host = mkHost(home)
  const tool = toolOptions(host)
  ok('tool: name, a catalogue in the description, parameters', tool.name === TOOL && tool.description.includes('usage.daily') && tool.description.includes('sankey') && Object.keys(tool.parameters).includes('ops') && !tool.description.includes('/Users/'))
  ok('tool: refuses a call without a session', (await tool.execute({}, {})).ok === false)
  const run = (a) => runTool(host, 'sess-1', a)
  const empty = await run({})
  ok('tool: nothing yet says how to start', empty.ok && empty.dashboards.length === 0 && /preset/.test(empty.message))
  // L2-08: the agent is told about a damaged file too (writing its id would replace it).
  await fsp.mkdir(join(home, 'kybernos', 'dashboards', 'files'), { recursive: true })
  await fsp.writeFile(join(home, 'kybernos', 'dashboards', 'files', 'cut.miniapp.json'), '{"kind":"dashb', 'utf8')
  const damaged = await run({})
  ok('tool: a listing names the unreadable files and tells the agent to ask first', damaged.ok && same(damaged.unreadable.map((u) => u.id), ['cut']) && /cannot be read/.test(damaged.message) && /preset/.test(damaged.message), damaged)
  await fsp.rm(join(home, 'kybernos', 'dashboards', 'files', 'cut.miniapp.json'))
  const cat = await run({ catalogue: true })
  ok('tool: catalogue lists providers, widgets and presets', cat.ok && cat.providers.includes('automations.timeline') && cat.widgets.includes('kanban') && cat.presets.length >= 4)

  const w = await run({ dashboard: { name: 'Tokens', widgets: [CARD(), { type: 'chart', title: 'Bad', x: 'dayy', y: 'tokens', source: { provider: 'usage.daily' } }, { type: 'bogus' }] }, note: 'first' })
  ok('tool: writes, names the id and reports what was dropped', w.ok && w.id === 'tokens' && w.rev === 1 && w.widgets.length === 2 && w.dropped.some((d) => d.includes('bogus')), w)
  ok('tool: warnings name the field that is not a column', w.warnings.some((x) => x.includes('"dayy" is not a column of usage.daily')), w.warnings)
  ok('tool: the session now has a current dashboard', host.getCurrent('sess-1', true).id === 'tokens')
  const r = await run({ id: 'tokens' })
  ok('tool: read back with warnings and nothing from the user yet', r.ok && r.read && r.widgets.length === 2 && r.changes_by_user.length === 0 && r.warnings.length > 0)
  await host.save({ id: 'tokens', raw: (await host.readDoc('tokens')).dashboard, by: 'user', what: 'Moved a widget' })
  ok('tool: read back shows what the user changed since', same((await run({ id: 'tokens' })).changes_by_user.map((e) => e.what), ['Moved a widget']))
  const o = await run({ id: 'tokens', ops: [{ op: 'update', id: 'chart-2', set: { x: 'day' } }, { op: 'add', widget: { type: 'note', text: 'hello' } }, { op: 'remove', id: 'nope' }] })
  ok('tool: ops patch one widget, keep the rest, report a bad op', o.ok && o.rev === 3 && o.widgets.length === 3 && o.dropped.some((d) => d.includes('no widget "nope"')) && !o.warnings.some((x) => x.includes('dayy')), o)
  const rep = await run({ id: 'tokens', dashboard: { name: 'Tokens', widgets: [CARD('Only')] } })
  ok('tool: replaces a whole dashboard', rep.ok && rep.widgets.length === 1 && rep.message.startsWith('Replaced'))
  ok('tool: unknown id without a dashboard is an error that says what to do', (await run({ id: 'ghost' })).ok === false && (await run({ id: 'ghost', ops: [{ op: 'remove', id: 'a' }] })).ok === false)
  const mk = await run({ id: 'fresh', dashboard: { name: 'Fresh', widgets: [CARD()] } })
  ok('tool: an id with a dashboard creates it', mk.ok && mk.id === 'fresh' && mk.message.startsWith('Created'))
  const pr = await run({ preset: 'usage-tokens', name: 'My usage' })
  ok('tool: from a preset', pr.ok && pr.id === 'my-usage' && pr.widgets.length >= 6 && pr.warnings.length === 0, pr)
  ok('tool: an id is slugged, never a path', (await run({ id: '../../etc/passwd', dashboard: { widgets: [] } })).id === 'etc-passwd')
  const lst = await run({})
  ok('tool: lists dashboards and the current one', lst.dashboards.length >= 4 && lst.current === 'my-usage' || lst.current !== null)
  await host.setFlags('fresh', { archived: true })
  ok('tool: archived dashboards are not offered', !(await run({})).dashboards.some((d) => d.id === 'fresh'))
  ok('tool: another session does not borrow the current one', host.getCurrent('sess-2', true) === null && host.getCurrent('sess-2').id !== undefined)
}

// ── routes ───────────────────────────────────────────────────────────────────
const routes = new Map()
const webServer = { register: (r) => { routes.set(r.path, r) } }
{
  const home = tmp()
  const host = mkHost(home)
  Index.mountRoutes(webServer, host)
  const call = async (method, path, { body, headers = {}, host: hostHeader = '127.0.0.1:3080', port = 3080, query = '' } = {}) => {
    const r = routes.get('/kybernos-dashboards/' + path)
    if (r === undefined) throw new Error('no route ' + path)
    const text = body === undefined ? '' : (typeof body === 'string' ? body : JSON.stringify(body))
    const req = Readable.from(text === '' ? [] : [Buffer.from(text)])
    req.method = method
    req.url = '/kybernos-dashboards/' + path + query
    req.headers = Object.assign({ host: hostHeader }, body !== undefined ? { 'content-type': 'application/json' } : {}, headers)
    req.socket = { localPort: port }
    const out = { status: 0, body: null }
    const res = { headersSent: false, writeHead: (s) => { out.status = s }, end: (t) => { try { out.body = JSON.parse(t) } catch { out.body = t } } }
    await r.handler(req, res)
    return out
  }
  const page = { origin: 'http://127.0.0.1:3080' }
  const expected = ['state', 'list', 'presets', 'dashboard', 'revisions', 'save', 'preset', 'clone', 'flags', 'open', 'restore']
  ok('routes: every route is mounted exactly under /kybernos-dashboards/', expected.every((e) => routes.has('/kybernos-dashboards/' + e)) && routes.size === expected.length, [...routes.keys()])

  ok('GET list: empty at first', same((await call('GET', 'list')).body.dashboards, []))
  ok('GET presets: shape and sources, never the definition', (() => { const p = routes.get('/kybernos-dashboards/presets'); return p !== undefined })() && (await call('GET', 'presets')).body.presets.every((x) => x.id && x.widgets >= 6 && Array.isArray(x.shape) && !('definition' in x) && Array.isArray(x.sources)))
  const made = await call('POST', 'preset', { body: { preset: 'agent-teams', name: 'Teams' }, headers: page })
  ok('POST preset: creates a dashboard', made.status === 200 && made.body.id === 'teams' && made.body.rev === 1, made)
  const one = await call('GET', 'dashboard', { query: '?id=teams' })
  ok('GET dashboard: the dashboard, its revision and who edited', one.status === 200 && one.body.dashboard.widgets.length === 7 && one.body.rev === 1 && one.body.isDefault === false)
  ok('GET dashboard: unknown is 404', (await call('GET', 'dashboard', { query: '?id=ghost' })).status === 404)
  const sv = await call('POST', 'save', { body: { id: 'teams', dashboard: { name: 'Teams', widgets: [CARD()] }, what: 'Edited on the page', expectRev: 1, session: 's9' }, headers: page })
  ok('POST save: saved as a user edit, the pane is told', sv.status === 200 && sv.body.rev === 2 && host.getCurrent('s9').id === 'teams')
  ok('POST save: a stale revision is a 409', (await call('POST', 'save', { body: { id: 'teams', dashboard: { name: 'T', widgets: [] }, expectRev: 1 }, headers: page })).status === 409)
  ok('POST save: missing fields are a 400', (await call('POST', 'save', { body: { id: 'teams' }, headers: page })).status === 400)
  ok('POST flags: default', (await call('POST', 'flags', { body: { id: 'teams', default: true }, headers: page })).body.isDefault === true)
  ok('POST flags: unknown is 404', (await call('POST', 'flags', { body: { id: 'ghost', hidden: true }, headers: page })).status === 404)
  ok('POST clone', (await call('POST', 'clone', { body: { id: 'teams' }, headers: page })).body.id === 'teams-copy')
  ok('POST open sets the current dashboard for the session', (await call('POST', 'open', { body: { id: 'teams', session: 'sx' }, headers: page })).status === 200 && host.getCurrent('sx').id === 'teams')
  ok('GET state: the current dashboard of a session', (await call('GET', 'state', { query: '?session=sx' })).body.current.id === 'teams')
  ok('GET state strict: another chat never borrows a dashboard (so a page edit never opens its tab)', (await call('GET', 'state', { query: '?session=nobody&strict=1' })).body.current === null && (await call('GET', 'state', { query: '?session=nobody' })).body.current !== null)
  ok('GET revisions and POST restore', (await call('GET', 'revisions', { query: '?id=teams' })).body.revisions.length === 2 && (await call('POST', 'restore', { body: { id: 'teams', rev: 1 }, headers: page })).body.rev === 3)

  // guards: routes are served before DSH's own authentication
  ok('guard: a foreign Host (DNS rebinding) is refused on a read', (await call('GET', 'list', { host: 'evil.example:3080' })).status === 403)
  ok('guard: a foreign Host is refused on a write', (await call('POST', 'flags', { body: { id: 'teams', hidden: true }, host: 'evil.example:3080', headers: page })).status === 403)
  ok('guard: a foreign Origin is refused on a read', (await call('GET', 'list', { headers: { origin: 'http://evil.example' } })).status === 403)
  ok('guard: a write needs an Origin or Referer', (await call('POST', 'flags', { body: { id: 'teams', hidden: true } })).status === 403)
  ok('guard: a write with a foreign Origin is refused', (await call('POST', 'flags', { body: { id: 'teams', hidden: true }, headers: { origin: 'http://evil.example' } })).status === 403)
  ok('guard: a write with the page Referer is accepted', (await call('POST', 'flags', { body: { id: 'teams', hidden: false }, headers: { referer: 'http://localhost:3080/kybernos' } })).status === 200)
  ok('guard: the port must be the socket\'s own', (await call('POST', 'flags', { body: { id: 'teams', hidden: true }, headers: { origin: 'http://127.0.0.1:9999' } })).status === 403)
  ok('guard: a write must be JSON', (await call('POST', 'flags', { body: '{"id":"teams"}', headers: Object.assign({}, page, { 'content-type': 'text/plain' }) })).status === 415)
  ok('guard: wrong methods are 405', (await call('GET', 'save')).status === 405 && (await call('POST', 'list', { body: {}, headers: page })).status === 405)
  ok('guard: a huge body is 413', (await call('POST', 'flags', { body: { id: 'teams', pad: 'x'.repeat(9000) }, headers: page })).status === 413)
  ok('guard: a body that is not JSON is a 400', (await call('POST', 'flags', { body: 'not json', headers: page })).status === 400 && (await call('POST', 'flags', { body: '[1,2]', headers: page })).status === 400)
  ok('guard: a path in an id never reaches the disk', (await call('GET', 'dashboard', { query: '?id=../../etc/passwd' })).status === 404 && !existsSync(join(home, 'etc')))
}

// ── apply ────────────────────────────────────────────────────────────────────
{
  const noop = () => {}
  let threw = null
  try { Index.apply({ get: () => undefined, inject: noop, effect: noop }) } catch (e) { threw = e }
  ok('apply: with no service it waits and does not throw', threw === null)
  threw = null
  try { Index.apply({ get: () => { throw new Error('boom') }, inject: noop }) } catch (e) { threw = e }
  ok('apply: a failing context is swallowed (a bundle never stops DSH from starting)', threw === null)
  const registered = []
  const fake = { get: (k) => (k === 'tools' ? { register: (t) => registered.push(t) } : k === 'webServer' ? { register: () => {} } : undefined), inject: noop }
  Index.apply(fake)
  await new Promise((r) => setTimeout(r, 50))
  ok('apply: registers the tool with a usable definition', registered.length === 1 && registered[0].name === TOOL && typeof registered[0].execute === 'function' && registered[0].description.length > 200, registered[0] && registered[0].name)
  ok('index: the seeded skills exist on disk', Index.SEEDED_SKILLS.every((s) => existsSync(join(Index.SKILLS_DIR, s, 'SKILL.md'))))
  ok('apply: the skills are seeded into DSH_HOME/skills (the temp one), with the shipped text', Index.SEEDED_SKILLS.every((s) => existsSync(join(SANDBOX_HOME, 'skills', s, 'SKILL.md')) && readFileSync(join(SANDBOX_HOME, 'skills', s, 'SKILL.md'), 'utf8') === readFileSync(join(Index.SKILLS_DIR, s, 'SKILL.md'), 'utf8')))
  ok('apply: a skill the user edited is never overwritten', (() => { const f = join(SANDBOX_HOME, 'skills', 'dashboard-builder', 'SKILL.md'); const mine = readFileSync(f, 'utf8') + '\nMy own rule.\n'; writeFileSync(f, mine); Index.apply({ get: () => undefined, inject: () => {} }); return readFileSync(f, 'utf8') === mine })())
  ok('index: preset summary is validated data', Index.presetSummary().length >= 4)
  ok('index: the guard helpers', Index.hostOk({ headers: { host: 'localhost:3080' }, socket: { localPort: 3080 } }) === true && Index.hostOk({ headers: { host: 'localhost:1' }, socket: { localPort: 3080 } }) === false && Index.originOk({ headers: {}, socket: { localPort: 1 } }, false) === true && Index.originOk({ headers: {}, socket: { localPort: 1 } }, true) === false)
}

console.log(fail === 0 ? 'host: ok (' + passed + ' checks)' : fail + ' failed of ' + (passed + fail))
process.exit(fail ? 1 : 0)

// The browser half: contract (plugin object, slots, strings in both languages, tokens not colours) and the pure
// model behind the four sections. Runs without DSH and without a browser: client.js is evaluated against a stub loader.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

let fail = 0
const ok = (name, cond, detail) => { console.log((cond ? 'ok   ' : 'FAIL ') + name + (cond ? '' : '  ' + (detail || ''))); if (!cond) fail++ }
const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(here, 'client.js'), 'utf8')

let captured = null
globalThis.window = { __ModuleLoader__: { load: (m) => { captured = m } }, __KB_LANG_RESOLVE__: () => 'fr', localStorage: { getItem: () => null, setItem () {} } }
globalThis.document = { documentElement: { lang: 'fr' }, getElementById: () => null, head: { appendChild () {} }, createElement: () => ({ setAttribute () {}, remove () {} }) }
const React = { Fragment: 'fragment', createElement: (type, props, ...kids) => ({ type, props, kids }), useState: (v) => [typeof v === 'function' ? v() : v, () => {}], useEffect () {}, useMemo: (f) => f() }
// eslint-disable-next-line no-new-func
new Function(src)()
ok('registers one module with the loader', captured !== null && captured.id === '@local/kybernos-summary')
const plugin = captured.factory((n) => (n === 'react' ? React : undefined))
ok('factory returns a plugin object with apply and the two services', plugin !== undefined && typeof plugin.apply === 'function' && plugin.inject.includes('slots') && plugin.inject.includes('sidebarRightTabs'))
const T = plugin.__test

// ── slots and tab type ───────────────────────────────────────────────────────
{
  const regs = []
  const types = []
  const ctx = {
    effect: (fn) => fn(),
    get: (n) => (n === 'sidebarRightTabs' ? { register: (d) => { types.push(d); return () => {} } } : undefined),
    slots: { inject: (n, fn) => fn(), register: (meta, comp) => { regs.push({ meta, comp }) } },
  }
  plugin.apply(ctx)
  const pane = regs.find((r) => r.meta.name === 'sidebar.right.pane.tab')
  const probe = regs.find((r) => r.meta.name === 'conversation.composer.dock')
  ok('the tab body is registered under the tab type id', pane !== undefined && pane.meta.key === T.TYPE_ID)
  ok('one tab type, with a guide entry', types.length === 1 && types[0].id === T.TYPE_ID && types[0].kind === T.KIND && types[0].guide.length === 1)
  ok('the tab title follows the language', types[0].title() === 'Résumé')
  ok('the probe id is its own (not the core usage probe)', probe !== undefined && probe.meta.id === 'kybernos-summary-probe')
  ok('the probe never throws on odd props', (() => { try { probe.comp(null); probe.comp({}); probe.comp({ sessionId: 3 }); return true } catch (e) { return false } })())
  ok('the pane never throws before any chat is known', (() => { try { return pane.comp() !== undefined } catch (e) { return false } })())
  ok('apply tolerates a missing registry', (() => {
    try { plugin.apply({ effect: (fn) => fn(), get () { throw new Error('absent') }, slots: { inject: (n, fn) => fn(), register () {} } }); return true } catch (e) { return false }
  })())
}

// ── strings: both languages, same placeholders ───────────────────────────────
{
  const keys = Object.keys(T.S)
  const holes = (t) => (t.match(/\{\w+\}/g) || []).sort().join()
  const bad = keys.filter((k) => !Array.isArray(T.S[k]) || T.S[k].length !== 2 || T.S[k][0].trim() === '' || T.S[k][1].trim() === '' || holes(T.S[k][0]) !== holes(T.S[k][1]))
  ok('every string has a French and an English side with the same holes', keys.length > 15 && bad.length === 0, bad.join())
  ok('a hole is filled', T.L('more', { n: 3 }) === '+ 3 autres')
}

// ── no hard-coded theme colour outside a var() fallback ──────────────────────
{
  const stripped = T.CSS.replace(/var\([^)]*\)/g, '')
  ok('colours come from DSH tokens', !/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(stripped), (stripped.match(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g) || []).join())
}

// ── the model ────────────────────────────────────────────────────────────────
const call = (callId, name, args, phase) => (phase === 'result'
  ? { kind: 'ok', callId, call: { name, args }, subCalls: [] }
  : { callId, name, args, argsRaw: JSON.stringify(args), subCalls: [] })
const node = (root) => ({ kind: 'tool-call', data: { root } })
const user = { kind: 'user', data: { text: 'go' } }
const nodes = [
  { kind: 'user', data: { text: 'first' } },
  node(call('c1', 'skill', { name: 'old-skill' }, 'result')),
  node(call('c2', 'write', { file_path: '/w/old.md' }, 'result')),
  user,
  node(call('c3', 'skill', { name: 'market-research' }, 'result')),
  node(call('c4', 'mcp__exa__web_search_exa', { q: 'x' }, 'result')),
  node(call('c5', 'mcp__exa__crawl', { u: 'y' }, 'result')),
  node(call('c6', 'mcp__notion__create_page', {}, 'start')),
  node(call('c7', 'web_search', { queries: ['a'] }, 'result')),
  node(call('c8', 'web_search', { queries: ['b'] }, 'result')),
  node(call('c9', 'write', { file_path: '/w/ai_agent_market_q4.md' }, 'result')),
  node(call('c10', 'edit', { file_path: '/w/ai_agent_market_q4.md' }, 'result')),
  node(call('c11', 'write', { file_path: 'funding_rounds_q4.csv' }, 'result')),
  node(call('c12', 'todo_write', { todos: [] }, 'result')),
  { kind: 'assistant-step', data: { steps: [{ calls: [call('c13', 'bash', { command: 'ls' }, 'result')] }] } },
]
const todos = [{ content: 'Collect', status: 'completed' }, { content: 'Compare', status: 'in_progress' }, { content: '  ', status: 'pending' }, { content: 'Assemble', status: 'nope' }]
const catalog = [{ id: 'abcdef123', mode: 'continuable', label: 'CAMEL Agent' }, { id: 'zzzzzz999', mode: 'one-shot' }, { label: 'no id' }, null]
const data = { nodes, todos, catalog }

{
  const m = T.derive(data, true)
  ok('latest only: the skill of the current turn, not the old one', m.skills.length === 1 && m.skills[0].name === 'market-research', JSON.stringify(m.skills))
  ok('latest only: files of this turn, each once, in order', m.files.map((f) => f.name).join() === 'ai_agent_market_q4.md,funding_rounds_q4.csv', JSON.stringify(m.files))
  ok('a file written then edited counts both', m.files[0].edits === 2)
  ok('MCP servers are grouped, with their tools', (() => { const e = m.tools.find((t) => t.id === 'mcp:exa'); return e !== undefined && e.calls === 2 && e.label === 'Exa' && /web_search_exa/.test(e.detail) && /crawl/.test(e.detail) })(), JSON.stringify(m.tools))
  ok('a call still starting is counted', m.tools.some((t) => t.id === 'mcp:notion'))
  ok('MCP servers come before native tools', m.tools.findIndex((t) => t.kind === 'native') > m.tools.findIndex((t) => t.id === 'mcp:notion'))
  ok('a native tool is counted by name', m.tools.find((t) => t.id === 'tool:web_search').calls === 2)
  ok('a call nested in another node is found', m.tools.some((t) => t.id === 'tool:bash'))
  ok('skill and todo_write are not tool rows', !m.tools.some((t) => /skill|todo_write/.test(t.id)))
  ok('write and edit are still tool rows (they are tools too)', m.tools.some((t) => t.id === 'tool:write') && m.tools.some((t) => t.id === 'tool:edit'))
  ok('progress keeps order, drops empties, defaults an unknown status to pending', m.todos.map((t) => t.status).join() === 'completed,in_progress,pending' && m.todos.length === 3, JSON.stringify(m.todos))
  ok('agents: label or a short id, junk dropped', m.agents.length === 2 && m.agents[0].label === 'CAMEL Agent' && m.agents[1].label === 'agent zzzzzz', JSON.stringify(m.agents))
  const all = T.derive(data, false)
  ok('whole chat: both skills and both files sets', all.skills.length === 2 && all.files.length === 3, JSON.stringify([all.skills, all.files]))
  ok('agents and progress do not depend on the scope', JSON.stringify(all.agents) === JSON.stringify(m.agents) && JSON.stringify(all.todos) === JSON.stringify(m.todos))
}
ok('no user node: the whole list', T.sinceLastUser([{ kind: 'x' }, { kind: 'y' }]).length === 2)
ok('empty and odd data give an empty summary', (() => {
  const a = T.derive(null, true); const b = T.derive({}, true); const c = T.derive({ nodes: 'x', todos: 5, catalog: {} }, false)
  return [a, b, c].every((m) => T.total(m) === 0)
})())
ok('a cyclic node does not hang the walk', (() => { const a = { kind: 'x', data: {} }; a.data.self = a; a.data.call = { callId: 'k', name: 'read', args: {} }; return T.derive({ nodes: [a] }, false).tools.length === 1 })())
ok('args are read from the raw JSON string when needed', (() => {
  const c = T.callOf({ callId: 'z', name: 'write', argsRaw: '{"file_path":"/a/b.txt"}' })
  return c !== null && c.args.file_path === '/a/b.txt'
})())
ok('a block without an id or a name is not a call', T.callOf({ name: 'x' }) === null && T.callOf({ callId: 'q' }) === null && T.callOf(null) === null)
ok('mcp names split on the double underscore', (() => { const a = T.splitMcp('mcp__my_server__do_it'); return a !== null && a.server === 'my_server' && a.tool === 'do_it' && T.splitMcp('web_search') === null })())
ok('the file address is the engine\'s own spelling', T.fileAddress('s 1', './dir/a b.md') === 'dsh-resource://file/session/s%201/dir/a%20b.md' && T.fileAddress('s', '/abs/x.md') === 'dsh-resource://file/session/s//abs/x.md')

// ── the store ────────────────────────────────────────────────────────────────
{
  let n = 0
  const f = () => { n += 1 }
  T.store.subs.add(f)
  const d = { nodes: [], todos: null, catalog: null }
  T.publish('s1', d)
  T.publish('s1', { nodes: d.nodes, todos: d.todos, catalog: d.catalog })
  ok('an identical publish does not wake the tab', n === 1, String(n))
  T.publish('s1', { nodes: [], todos: null, catalog: null })
  ok('a changed publish does', n === 2)
  for (let i = 0; i < 20; i += 1) T.publish('x' + i, { nodes: [], todos: null, catalog: null })
  ok('the store keeps a bounded number of sessions', Object.keys(T.store.bySid).length <= 12)
  ok('an empty session id is ignored', (() => { const before = n; T.publish('', { nodes: [1] }); return n === before })())
}

// ── « Learned in this chat »: the rows, the route, the schedule, the section ───────────────────────────────────
const SAMPLE = {
  ok: true,
  suggested: [
    { id: 'p1', name: 'weekly-report', kind: 'asked', description: 'Build the weekly report', score: 71, stops: [], createdAt: '2026-10-21T08:00:00Z' },
    { id: 'p2', name: 'git-flow', kind: 'improve', description: 'Always rebase first', score: 64, stops: [], createdAt: '2026-10-21T08:01:00Z' },
    { id: '', name: 'no-id' }, { id: 'p3' }, null, 'junk', { id: 'p1', name: 'weekly-report' },
  ],
  applied: [
    { name: 'kaby-made', ver: 1, score: 82.4, reviewed: false, auto: true, at: '2026-10-21T09:00:00Z' },
    { name: 'i-made', ver: 1, score: 77, reviewed: true, auto: false, at: '2026-10-21T09:05:00Z' },
    { name: '  ', auto: true }, 7,
  ],
  used: [
    { name: 'i-made', uses: 1 }, // created here and loaded only here: not « reused »
    { name: 'old-skill', uses: 4 },
    { name: 'single', uses: 1 },
    { name: 'kaby-made', uses: 3 }, // used elsewhere too: reused
    { name: 'no-count' }, { name: '' }, null,
  ],
}
{
  const R = T.learnedRows
  ok('no row for an absent, refused or odd answer', [undefined, null, 'x', 5, [], {}, { ok: false, error: 'no' }, { ok: 'yes' }, { ok: true }].every((a) => R(a).length === 0))
  ok('an ok answer with empty lists has no row', R({ ok: true, suggested: [], applied: [], used: [] }).length === 0 && R({ ok: true, suggested: 'x', applied: {}, used: 3 }).length === 0)
  const rows = R(SAMPLE)
  ok('rows come in the order the person acts on them: suggestions, applied, reused', rows.map((r) => r.kind).join() === 'suggested,improve,auto,created,reused,reused,reused,reused', rows.map((r) => r.kind).join())
  ok('a suggestion keeps its id (what Review remembers) and an improvement is told apart', rows[0].id === 'p1' && rows[0].name === 'weekly-report' && rows[1].kind === 'improve' && rows[1].name === 'git-flow')
  ok('a suggestion without an id or a name is dropped, a repeated one shows once', rows.filter((r) => r.kind === 'suggested' || r.kind === 'improve').length === 2)
  ok('applied by Kaby: score rounded, not reviewed flagged', rows[2].name === 'kaby-made' && rows[2].score === 82 && rows[2].notReviewed === true)
  ok('created by the person: no score, no « not reviewed »', rows[3].name === 'i-made' && rows[3].score === null && rows[3].notReviewed === false)
  ok('reused rows carry how many chats used the skill', rows.filter((r) => r.kind === 'reused').map((r) => r.name + ':' + r.uses).join() === 'old-skill:4,single:1,kaby-made:3,no-count:null', rows.map((r) => r.name + ':' + r.uses).join())
  ok('a skill created here and loaded only here is not listed twice', !rows.some((r) => r.kind === 'reused' && r.name === 'i-made'))
  ok('an applied skill used in other chats too is also a reused row', rows.some((r) => r.kind === 'reused' && r.name === 'kaby-made'))
  ok('a very long list stays bounded', R({ ok: true, used: Array.from({ length: 500 }, (_, i) => ({ name: 'u' + i, uses: 2 })) }).length === 50)
  ok('countCalls counts the whole chat, whatever the scope', T.countCalls(data) === 13 && T.countCalls(null) === 0 && T.countCalls({ nodes: 'x' }) === 0, String(T.countCalls(data)))
}

// fake clock and fake network: the schedule and the route are checked without waiting and without a server
const fakeTimers = { now: 0, seq: 0, list: [] }
globalThis.setTimeout = (fn, ms) => { fakeTimers.seq += 1; fakeTimers.list.push({ id: fakeTimers.seq, fn, at: fakeTimers.now + ms, every: 0 }); return fakeTimers.seq }
globalThis.setInterval = (fn, ms) => { fakeTimers.seq += 1; fakeTimers.list.push({ id: fakeTimers.seq, fn, at: fakeTimers.now + ms, every: ms }); return fakeTimers.seq }
globalThis.clearTimeout = globalThis.clearInterval = (id) => { fakeTimers.list = fakeTimers.list.filter((t) => t.id !== id) }
const advance = (ms) => {
  const end = fakeTimers.now + ms
  for (;;) {
    const due = fakeTimers.list.filter((t) => t.at <= end).sort((a, b) => a.at - b.at || a.id - b.id)[0]
    if (due === undefined) break
    fakeTimers.now = due.at
    if (due.every > 0) due.at += due.every; else fakeTimers.list = fakeTimers.list.filter((t) => t.id !== due.id)
    due.fn()
  }
  fakeTimers.now = end
}
const flush = async () => { await new Promise((r) => setImmediate(r)); await new Promise((r) => setImmediate(r)) }
const net = { mode: 'ok', answer: SAMPLE, calls: [] }
globalThis.fetch = (url, init) => {
  net.calls.push({ url, init })
  if (net.mode === 'throw') throw new Error('sync failure')
  if (net.mode === 'reject') return Promise.reject(new Error('offline'))
  if (net.mode === '404') return Promise.resolve({ ok: false, status: 404, json: () => Promise.reject(new Error('no body')) })
  if (net.mode === '403') return Promise.resolve({ ok: false, status: 403, json: () => Promise.resolve({ ok: false, error: 'origin' }) })
  if (net.mode === 'html') return Promise.resolve({ ok: true, status: 200, json: () => Promise.reject(new SyntaxError('Unexpected token <')) })
  if (net.mode === 'array') return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([1]) })
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(net.answer) })
}
const reset = (mode, answer) => { fakeTimers.list = []; net.calls = []; net.mode = mode; net.answer = answer === undefined ? SAMPLE : answer }

{
  reset('ok')
  const rows = await T.loadLearned('chat a/b?c')
  ok('the route is a relative same-origin GET with the chat id encoded', net.calls.length === 1 && net.calls[0].url === '/kybernos-skills/learned/session?sessionId=chat%20a%2Fb%3Fc' && net.calls[0].url === T.LEARNED_URL + encodeURIComponent('chat a/b?c') && net.calls[0].url.startsWith('/'), JSON.stringify(net.calls))
  ok('GET, no body, no credentials or token of ours', net.calls[0].init.method === 'GET' && net.calls[0].init.body === undefined && net.calls[0].init.credentials === undefined && Object.keys(net.calls[0].init.headers).join() === 'accept')
  ok('the answer becomes rows', Array.isArray(rows) && rows.length === 8, JSON.stringify(rows))
  for (const mode of ['404', '403', 'html', 'reject', 'throw', 'array']) {
    reset(mode)
    ok('a route that answers « ' + mode + ' » gives null, never throws or rejects', (await T.loadLearned('c')) === null)
  }
  reset('ok', { ok: false, error: 'refused' })
  ok('an ok:false answer gives no row', (await T.loadLearned('c')).length === 0)
  const keep = globalThis.fetch
  delete globalThis.fetch
  ok('no fetch at all gives null', (await T.loadLearned('c')) === null)
  globalThis.fetch = keep
}

{
  // the schedule: nothing at once, one ask when things settle, one every 30 s while visible, none when hidden or stopped
  reset('ok')
  const got = []
  const stop = T.watchLearned('s', (rows) => got.push(rows))
  ok('nothing is asked at once', net.calls.length === 0)
  advance(T.LEARNED_SETTLE_MS - 1)
  ok('nothing before the settle delay', net.calls.length === 0)
  advance(1)
  await flush()
  ok('one ask when it settles', net.calls.length === 1 && got.length === 1 && got[0].length === 8)
  advance(T.LEARNED_EVERY_MS)
  await flush()
  ok('then one ask every 30 s, not more', net.calls.length === 2, String(net.calls.length))
  globalThis.document.visibilityState = 'hidden'
  advance(T.LEARNED_EVERY_MS * 3)
  await flush()
  ok('nothing is asked while the page is hidden', net.calls.length === 2, String(net.calls.length))
  delete globalThis.document.visibilityState
  advance(T.LEARNED_EVERY_MS)
  await flush()
  ok('it resumes when the page is visible again', net.calls.length === 3)
  stop()
  advance(T.LEARNED_EVERY_MS * 4)
  await flush()
  ok('stopped means stopped', net.calls.length === 3 && fakeTimers.list.length === 0)

  // a failing answer reaches nobody (the section keeps what it had); a late answer of an older ask is dropped
  reset('404')
  const none = []
  const stop2 = T.watchLearned('s', (rows) => none.push(rows))
  advance(T.LEARNED_SETTLE_MS)
  await flush()
  ok('a failing route calls nobody back', net.calls.length === 1 && none.length === 0)
  stop2()
  reset('ok')
  const fullFetch = globalThis.fetch
  const slow = []
  let release = null
  globalThis.fetch = (url, init) => { net.calls.push({ url, init }); const first = net.calls.length === 1; return Promise.resolve({ ok: true, status: 200, json: () => (first ? new Promise((r) => { release = () => r({ ok: true, used: [{ name: 'old', uses: 2 }] }) }) : Promise.resolve({ ok: true, used: [{ name: 'new', uses: 2 }] })) }) }
  const stop3 = T.watchLearned('s', (rows) => slow.push(rows.map((r) => r.name).join()))
  advance(T.LEARNED_SETTLE_MS)
  advance(T.LEARNED_EVERY_MS - T.LEARNED_SETTLE_MS)
  await flush()
  release()
  await flush()
  ok('a late answer of an earlier ask is dropped', slow.join('|') === 'new', slow.join('|'))
  stop3()
  globalThis.fetch = fullFetch
}

// the Review button: the page opens through the main plugin's seam, the pointer goes to sessionStorage, each step guarded
{
  const stored = []
  const opened = []
  window.sessionStorage = { setItem: (k, v) => { stored.push([k, v]) } }
  window.__KB_OPEN__ = (p) => { opened.push(p) }
  T.reviewSuggestion('p1')
  ok('Review remembers the suggestion and opens the Skills page', JSON.stringify(stored) === '[["kybernos.skills.review","p1"]]' && JSON.stringify(opened) === '[{"view":"skills"}]', JSON.stringify([stored, opened]))
  window.sessionStorage = { setItem () { throw new Error('quota') } }
  ok('a storage that refuses still opens the page', (() => { try { T.reviewSuggestion('p2'); return opened.length === 2 } catch (e) { return false } })())
  Object.defineProperty(window, 'sessionStorage', { get () { throw new Error('SecurityError') }, configurable: true })
  ok('a storage that throws on access does not break Review', (() => { try { T.reviewSuggestion('p3'); return opened.length === 3 } catch (e) { return false } })())
  window.__KB_OPEN__ = () => { throw new Error('no page') }
  ok('a seam that throws does not break Review', (() => { try { T.reviewSuggestion('p4'); return true } catch (e) { return false } })())
  delete window.__KB_OPEN__
  ok('an older main plugin without the seam does not break Review', (() => { try { T.reviewSuggestion('p5'); return true } catch (e) { return false } })())
  delete window.sessionStorage
}

// the section itself: the real Pane rendered by a small stand-in for React (state and effects kept per component path)
{
  let cur = null
  const mount = () => {
    const state = { cells: new Map(), effects: new Map() }
    const expand = (el, path) => {
      if (Array.isArray(el)) return el.map((x, i) => expand(x, path + '.' + i))
      if (el === null || typeof el !== 'object' || el.type === undefined) return el
      if (typeof el.type === 'function') {
        const saved = cur
        cur = { state, path, s: 0, e: 0 }
        let out
        try { out = el.type(Object.assign({}, el.props, { children: el.kids })) } finally { cur = saved }
        return expand(out, path + '/c')
      }
      return { type: el.type, props: el.props || {}, kids: el.kids.map((k, i) => expand(k, path + '.' + i)) }
    }
    const render = (el) => {
      const was = { useState: React.useState, useEffect: React.useEffect }
      React.useState = (init) => { const k = cur.path + '#s' + cur.s++; const c = cur.state.cells; if (!c.has(k)) c.set(k, typeof init === 'function' ? init() : init); return [c.get(k), (v) => { c.set(k, typeof v === 'function' ? v(c.get(k)) : v) }] }
      React.useEffect = (fn, deps) => { const k = cur.path + '#e' + cur.e++; const e = cur.state.effects; const prev = e.get(k); const key = JSON.stringify(deps); if (prev === undefined || prev.key !== key) { if (prev !== undefined && typeof prev.stop === 'function') prev.stop(); e.set(k, { key: key, stop: fn() }) } }
      try { return expand(el, 'r') } finally { Object.assign(React, was) }
    }
    return render
  }
  const all = (n, out = []) => { if (Array.isArray(n)) n.forEach((x) => all(x, out)); else if (n !== null && typeof n === 'object' && n.type !== undefined) { out.push(n); all(n.kids, out) } return out }
  const textOf = (n) => (Array.isArray(n) ? n.map(textOf).join('') : (typeof n === 'string' ? n : (n !== null && typeof n === 'object' && n.kids !== undefined ? textOf(n.kids) : '')))
  const find = (tree, pred) => all(tree).filter(pred)
  const sec = (tree, id) => find(tree, (n) => n.props['data-kb'] === 'kybernos-summary-section' && n.props['data-sec'] === id)[0]
  const rowsOf = (tree) => find(tree, (n) => n.props['data-kb'] === 'kybernos-summary-learned')

  const regs = []
  plugin.apply({
    effect: (fn) => fn(),
    get: (n) => (n === 'uiSession' ? { adapter: { current: { getSnapshot: () => ({ key: 'chat-1' }) } } } : undefined),
    slots: { inject: (n, fn) => fn(), register: (meta, comp) => { regs.push({ meta, comp }) } },
  })
  const pane = regs.find((r) => r.meta.name === 'sidebar.right.pane.tab')
  T.publish('chat-1', data)

  // 1. the route is absent, refused, broken: no section, no error row, the four others are there
  for (const mode of ['404', '403', 'html', 'reject', 'throw', 'array']) {
    reset(mode)
    const render = mount()
    let tree = render(pane.comp())
    advance(T.LEARNED_SETTLE_MS)
    await flush()
    tree = render(pane.comp())
    const said = textOf(tree)
    ok('route « ' + mode + ' »: the section is left out, silently', sec(tree, 'learned') === undefined && !/Appris|Learned|erreur|error/i.test(said) && net.calls.length === 1, said)
    ok('route « ' + mode + ' »: the other sections are untouched', ['agents', 'progress', 'context', 'files'].every((id) => sec(tree, id) !== undefined))
  }
  reset('ok', { ok: true, suggested: [], applied: [], used: [] })
  {
    const render = mount()
    render(pane.comp())
    advance(T.LEARNED_SETTLE_MS)
    await flush()
    ok('an answer without any row shows no section', sec(render(pane.comp()), 'learned') === undefined)
  }

  // 2. rows: count, texts in both languages, Review only on suggestions, a footnote that says the true thing
  reset('ok')
  const render = mount()
  let tree = render(pane.comp())
  ok('nothing about learning before the route has answered', sec(tree, 'learned') === undefined && net.calls.length === 0)
  advance(T.LEARNED_SETTLE_MS)
  await flush()
  tree = render(pane.comp())
  const learnedSec = sec(tree, 'learned')
  const head = find(learnedSec, (n) => n.props['data-act'] === 'toggle-learned')[0]
  ok('the section shows once rows exist, after the four others, with the count of rows', learnedSec !== undefined && find(tree, (n) => n.props['data-kb'] === 'kybernos-summary-section').map((n) => n.props['data-sec']).join() === 'agents,progress,context,files,learned' && textOf(head) === 'Appris dans ce chat8', textOf(head))
  ok('every row is drawn, named', rowsOf(tree).length === 8 && ['weekly-report', 'git-flow', 'kaby-made', 'i-made', 'old-skill', 'single', 'kaby-made', 'no-count'].every((nm, i) => textOf(rowsOf(tree)[i]).startsWith(nm)))
  const rowText = (i) => textOf(rowsOf(tree)[i])
  ok('French: suggestion, improvement, applied with score and chip, created, reused', /^weekly-report.*Skill suggéré.*Relire$/.test(rowText(0)) && /^git-flow.*Amélioration de skill suggérée/.test(rowText(1)) && /^kaby-made.*Skill appliqué par Kaby · score 82.*pas encore relu/.test(rowText(2)) && /^i-made.*Skill créé/.test(rowText(3)) && /^old-skill.*Skill réutilisé · utilisé dans 4 chats/.test(rowText(4)) && /^single.*utilisé dans 1 chat$/.test(rowText(5)), [0, 1, 2, 3, 4, 5].map(rowText).join(' | '))
  ok('the footnote says suggestions wait for the person (French)', /attend ton accord/.test(textOf(find(learnedSec, (n) => n.props.className === 'kbsm-foot')[0])))
  const buttons = find(tree, (n) => n.props['data-act'] === 'review')
  ok('Review is on the two suggestions only, each with its id', buttons.length === 2 && buttons.map((b) => b.props['data-id']).join() === 'p1,p2' && buttons.every((b) => /^Relire /.test(b.props['aria-label'])))
  ok('the « not reviewed » chip is only on the unreviewed auto row', find(tree, (n) => n.props['data-kb'] === 'kybernos-summary-unreviewed').length === 1)
  window.__KB_LANG_RESOLVE__ = () => 'en'
  tree = render(pane.comp())
  ok('English: every kind in English', /^weekly-report.*Skill suggested.*Review$/.test(textOf(rowsOf(tree)[0])) && /Skill improvement suggested/.test(textOf(rowsOf(tree)[1])) && /Skill applied by Kaby · score 82.*not reviewed yet/.test(textOf(rowsOf(tree)[2])) && /Skill created/.test(textOf(rowsOf(tree)[3])) && /Skill reused · used in 4 chats/.test(textOf(rowsOf(tree)[4])) && /used in 1 chat$/.test(textOf(rowsOf(tree)[5])) && textOf(sec(tree, 'learned')).startsWith('Learned in this chat8') && /waits for your yes/.test(textOf(find(sec(tree, 'learned'), (n) => n.props.className === 'kbsm-foot')[0])), rowsOf(tree).map(textOf).join(' | '))

  // 3. Review wiring through the real button
  const stored = []
  const opened = []
  window.sessionStorage = { setItem: (k, v) => { stored.push([k, v]) } }
  window.__KB_OPEN__ = (p) => { opened.push(p) }
  find(tree, (n) => n.props['data-act'] === 'review')[1].props.onClick()
  ok('the Review button of the second suggestion remembers p2 and opens the Skills page', JSON.stringify(stored) === '[["kybernos.skills.review","p2"]]' && JSON.stringify(opened) === '[{"view":"skills"}]')
  delete window.sessionStorage
  delete window.__KB_OPEN__
  ok('the Review button is safe with no seam and no storage', (() => { try { find(tree, (n) => n.props['data-act'] === 'review')[0].props.onClick(); return true } catch (e) { return false } })())

  // 4. the scope toggle does not touch it; folding works like the others
  const learnedText = () => textOf(sec(render(pane.comp()), 'learned'))
  const before = learnedText()
  const filesBefore = textOf(sec(render(pane.comp()), 'files'))
  find(tree, (n) => n.props['data-act'] === 'scope')[0].props.onClick()
  const after = render(pane.comp())
  ok('Latest only is a scope for files and skills, not for what was learned', textOf(sec(after, 'learned')) === before && textOf(sec(after, 'files')) !== filesBefore && !/Latest only|Dernier tour/.test(textOf(sec(after, 'learned'))))
  find(sec(after, 'learned'), (n) => n.props['data-act'] === 'toggle-learned')[0].props.onClick()
  const folded = render(pane.comp())
  ok('folding hides the rows and keeps the title and count', sec(folded, 'learned') !== undefined && rowsOf(folded).length === 0 && find(sec(folded, 'learned'), (n) => n.props['aria-expanded'] === 'false').length === 1 && /Learned in this chat8/.test(textOf(sec(folded, 'learned'))) && rowsOf(after).length === 8)
  ok('folding it leaves the other sections open', sec(folded, 'files') !== undefined && find(sec(folded, 'files'), (n) => n.props['aria-expanded'] === 'true').length === 1)
  find(sec(folded, 'learned'), (n) => n.props['data-act'] === 'toggle-learned')[0].props.onClick()
  ok('and unfolds again', rowsOf(render(pane.comp())).length === 8)

  // 5. when to ask again: not on a plain redraw, once more when the chat's tool-call count moves, a new chat starts over
  const asks = net.calls.length
  render(pane.comp()); render(pane.comp())
  advance(T.LEARNED_SETTLE_MS * 4)
  await flush()
  ok('a redraw does not ask again', net.calls.length === asks, net.calls.length + ' vs ' + asks)
  T.publish('chat-1', { nodes: nodes.concat([node(call('c99', 'read', { file_path: '/w/x' }, 'result'))]), todos, catalog })
  render(pane.comp())
  ok('a new tool call alone asks nothing yet', net.calls.length === asks)
  advance(T.LEARNED_SETTLE_MS)
  await flush()
  ok('then the count of tool calls changed: one ask once it settles', net.calls.length === asks + 1, net.calls.length + ' vs ' + asks)
  T.publish('chat-1', { nodes: nodes.concat([node(call('c99', 'read', { file_path: '/w/x' }, 'result'))]), todos: todos.slice(), catalog })
  render(pane.comp())
  advance(T.LEARNED_SETTLE_MS * 4)
  await flush()
  ok('a change that is not a tool call (here the task list) asks nothing', net.calls.length === asks + 1)
  T.publish('chat-1', { nodes: nodes.concat([node(call('c99', 'read', { file_path: '/w/x' }, 'result')), node(call('c100', 'read', { file_path: '/w/y' }, 'result'))]), todos, catalog })
  render(pane.comp())
  render(pane.comp())
  advance(T.LEARNED_SETTLE_MS)
  await flush()
  ok('another tool call: one more ask, not two', net.calls.length === asks + 2)
  ok('the last ask is for this chat', /sessionId=chat-1$/.test(net.calls[net.calls.length - 1].url))

  // 6. only learned rows, nothing else to sum up: the section is still there (not the « nothing yet » line)
  T.publish('chat-1', { nodes: [], todos: [], catalog: [] })
  const lone = mount()
  reset('ok')
  let t2 = lone(pane.comp())
  ok('nothing to sum up and nothing learned: the plain empty line', /Nothing to sum up/.test(textOf(t2)))
  advance(T.LEARNED_SETTLE_MS)
  await flush()
  t2 = lone(pane.comp())
  ok('only learned rows: the section shows alone', sec(t2, 'learned') !== undefined && sec(t2, 'files') === undefined && !/Nothing to sum up/.test(textOf(t2)) && rowsOf(t2).length === 8)
}

// every string of the section exists in both languages, is used, and nothing else about it is missing
{
  const used = Array.from(new Set((src.match(/'(learned|ln[A-Z]\w*)'/g) || []).map((q) => q.slice(1, -1))))
  const mine = Object.keys(T.S).filter((k) => k === 'learned' || /^ln[A-Z]/.test(k))
  ok('the section uses exactly the keys the table defines for it', used.slice().sort().join() === mine.slice().sort().join(), used.join() + ' / ' + mine.join())
  ok('each of them has a French and an English side, which differ unless it is only a number word', mine.length === 13 && mine.every((k) => T.S[k][0] !== T.S[k][1] || k === 'lnScore'), mine.join())
  ok('the footnote is one short sentence', T.S.lnFoot.every((t) => t.length < 100 && t.split(/[.!?]\s/).length === 1), T.S.lnFoot.join(' / '))
}

for (const k of ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval']) delete globalThis[k]
process.exit(fail > 0 ? 1 : 0)

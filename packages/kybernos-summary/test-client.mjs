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

process.exit(fail > 0 ? 1 : 0)

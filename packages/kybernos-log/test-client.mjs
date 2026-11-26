// test-client.mjs - the browser half checked without a browser.
// Two halves: what the source must hold (the label pairs, the families agreeing with the host, the routes the page calls being
// the ones the host mounts, the CSS, the drop-proof factory), and the real page run on a small hook runtime against a mocked
// host: the tabs, the toolbar, one number everywhere, no "ok" pill, a tool call and its result as one row, repeated failures
// collapsed, the pager, the live pill, the empty states, the narrow layout and the terminal tab.
// Run: node packages/kybernos-log/test-client.mjs
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { KINDS, toolKind } from './index.js'
import { fakeHelp } from '../kybernos-hub/fake-help.mjs'

let pass = 0
const fails = []
const ok = (label, cond) => { if (cond) { pass += 1 } else { fails.push(label) } }
const eq = (label, a, b) => ok(label + ' \u2014 ' + JSON.stringify(a) + ' \u2260 ' + JSON.stringify(b), JSON.stringify(a) === JSON.stringify(b))

const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(here, 'client.js'), 'utf8')

// -- the factory never throws into DSH -------------------------------------------------------------------------------
ok('the module loader wrapper is present', src.includes('window.__ModuleLoader__.load({'))
ok('the factory returns a disabled plugin on error', /catch \(error\) \{[\s\S]{0,400}return \{ apply \(\) \{ \/\* disabled after a load error \*\/ \} \}/.test(src))
ok('the page component is guarded at render', src.includes('() => { try { return h(Page) } catch (e) { return null } }'))
ok('the bundle ends once (the live swap finds its end at the first line that starts with "})")', src.split('\n').filter((l) => l.startsWith('})')).length === 1)

// -- families: the page knows exactly the host's families --------------------------------------------------------------
const typesMatch = src.match(/const TYPES = \[([^\]]+)\]/)
ok('TYPES is declared', typesMatch !== null)
if (typesMatch !== null) {
  const clientTypes = typesMatch[1].split(',').map((x) => x.trim().replace(/^'|'$/g, '')).filter(Boolean)
  ok('every family of the page exists on the host', clientTypes.every((t) => KINDS.includes(t)))
  ok('every family of the host is on the page', KINDS.every((t) => clientTypes.includes(t)))
  ok('no duplicate family', new Set(clientTypes).size === clientTypes.length)
}

// -- labels: both sides of every pair, the familiar French form, no English copied into the French side ----------------
const pairs = Array.from(src.matchAll(/^\s{8}(\w+): \['((?:[^'\\]|\\.)*)', '((?:[^'\\]|\\.)*)'\]/gm))
ok('the label table is found', pairs.length >= 100)
ok('every pair has a French side', pairs.every((m) => m[2].trim() !== ''))
ok('every pair has an English side', pairs.every((m) => m[3].trim() !== ''))
const COGNATES = new Set(['session', 'tokens', 'terminal', 'pages'])
const identical = pairs.filter((m) => m[2] === m[3]).map((m) => m[2].toLowerCase())
ok('a French side is not silently English (identical pairs limited to cognates): ' + identical.filter((k) => !COGNATES.has(k)).join(', '), identical.every((k) => COGNATES.has(k)))
const table = src.split('const S = {')[1].split('\n      }\n')[0]
ok('labels use the typographic apostrophe', !/'[^']*\b(?:l|d|n|s|qu)'[a-z\u00e0-\u00ff]/i.test(table))
ok('the French side says "tu", never "vous/votre"', pairs.every((m) => !/\b(vous|votre|vos)\b/i.test(m[2])))
ok('the label table holds real characters, not escapes', !/\\u[0-9a-f]{4}/i.test(table))

// -- routes: the page calls what the host mounts --------------------------------------------------------------------
for (const route of ['/kybernos-log/events', '/kybernos-log/stats', '/kybernos-log/terminal']) ok('the page calls ' + route, src.includes(route))
ok('timers are cleared on unmount', (src.match(/window\.clearInterval\(t\)/g) || []).length === 2)

// -- the Settings seat ---------------------------------------------------------------------------------------------
ok('a settings.section is registered', src.includes("'settings.section'"))
const seat = src.match(/\{ name: 'settings\.section', id: 'kybernos-log', order: (\d+), label: \(\) => kt\(/)
ok('the section sits after Usage (32) and before the tail', seat !== null && Number(seat[1]) === 34)
ok('the label is translated on both sides', src.includes("kt('Journal d\u2019activit\u00e9', 'Activity log')"))

// -- the CSS -------------------------------------------------------------------------------------------------------
const cssMatch = src.match(/const CSS = `\n([\s\S]*?)\n`\n/)
ok('the bundle declares one CSS block', cssMatch !== null)
const css = cssMatch === null ? '' : cssMatch[1]
// A backtick inside the CSS template literal ends the literal and turns the rest into code (measured 2026-10-28: plugin disabled).
ok('the CSS block carries no stray backtick', !css.includes('`'))
ok('the CSS uses DSH tokens only (no hard-coded colour without a var)', !/#[0-9a-f]{3,8}\b/i.test(css.replace(/var\([^)]*\)/g, '')) && !/rgba?\(/.test(css.replace(/var\((?:[^()]|\([^()]*\))*\)/g, '')))
ok('every rule is prefixed kblg-', css.split('\n').filter((l) => /^[.a-z]/i.test(l) && !l.startsWith('/*')).every((l) => /^(\.kblg-|button\.kblg-)/.test(l)))
ok('colour is for states only: the marks take currentColor', src.includes("stroke: 'currentColor'") && !/fill: '#/.test(src))
ok('narrow: the chat column hides and its sub line shows', css.includes('.kblg-page.kblg-narrow .kblg-row > .kblg-chat{display:none}') && css.includes('.kblg-page.kblg-narrow .kblg-w .kblg-chat2{display:block}') && css.includes('.kblg-w .kblg-chat2{display:none}'))
ok('the day header is sticky', /\.kblg-day\{position:sticky;top:0/.test(css))
ok('the retry pill reads in a darker amber, not the bare warn colour (UJ-49)', /\.kblg-pill\.is-warn\{[^}]*color:color-mix\(in srgb,var\(--dsw-alias-state-warn-label/.test(css) && /\.kblg-warn\{color:color-mix\(/.test(css))
ok('no rule of the bundle sizes or weighs the title (kblg-title)', !/\.kblg-title\s*[{,]/.test(src))
ok('the page draws its head through pageHead, with the hook class kblg-title', /pageHead\(\{ id: 'kybernos-log', lead: L\('lead'\), title: L\('title'\), className: 'kblg-title' \}\)/.test(src))
ok('toolKind still routes an MCP tool to the connector family', toolKind('mcp__github__pr') === 'connector')

// -- the real page on a small hook runtime -----------------------------------------------------------------------------
const noop = () => {}
const Help = function Help () { return null }
const find = (node, test, out = []) => { if (node === null || node === undefined || typeof node !== 'object') return out; if (Array.isArray(node)) { for (const c of node) find(c, test, out); return out } if (test(node)) out.push(node); for (const c of node.children || []) find(c, test, out); return out }
const text = (node) => (node === null || node === undefined || node === false ? '' : typeof node === 'string' || typeof node === 'number' ? String(node) : Array.isArray(node) ? node.map(text).join('') : (node.children || []).map(text).join(''))
const cls = (c) => (n) => typeof n.props.className === 'string' && n.props.className.split(' ').includes(c)
const flush = async () => { for (let i = 0; i < 12; i += 1) await new Promise((r) => setImmediate(r)) }

const mount = ({ suite = false, host, language = 'en', width = 720, ws = true, settingsOpen = false } = {}) => {
  let def = null
  const slots = []
  let i = 0
  let effects = []
  const React = {
    Fragment: 'fragment',
    createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
    useState (init) { const k = i++; if (!(k in slots)) slots[k] = typeof init === 'function' ? init() : init; return [slots[k], (v) => { slots[k] = typeof v === 'function' ? v(slots[k]) : v }] },
    useRef (v) { const k = i++; if (!(k in slots)) slots[k] = { current: v }; return slots[k] },
    useMemo (f, deps) { const k = i++; const prev = slots[k]; if (prev === undefined || deps.some((d, j) => d !== prev.deps[j])) slots[k] = { deps, v: f() }; return slots[k].v },
    useCallback: (f) => { i++; return f },
    useEffect (f, deps) { const k = i++; const prev = slots[k]; if (prev === undefined || deps === undefined || deps.some((d, j) => d !== prev.deps[j])) { if (prev && typeof prev.undo === 'function') prev.undo(); const slot = { deps: deps || [] }; slots[k] = slot; effects.push(() => { const u = f(); slot.undo = u }) } }
  }
  const timers = []
  const calls = []
  const opened = []
  const escaped = []
  const win = {
    KeyboardEvent: function KeyboardEvent (type, init) { this.type = type; this.key = init && init.key },
    __ModuleLoader__: { load: (d) => { def = d } },
    __KB_LANG_RESOLVE__: () => language,
    setInterval: (fn, ms) => { timers.push({ fn, ms, on: true }); return timers.length },
    clearInterval: (id) => { if (timers[id - 1]) timers[id - 1].on = false },
    setTimeout: () => 0,
    ResizeObserver: function (cb) { this.observe = () => cb(); this.disconnect = noop },
    fetch: async (url) => { calls.push(url); const r = host(url); return { status: r.status || 200, json: async () => { if (r.json === undefined) throw new Error('no json'); return r.json } } }
  }
  if (suite) win.__KB_HELP__ = { version: 1, ...fakeHelp(React, Help) }
  const doc = { documentElement: { lang: language }, createElement: () => ({ setAttribute: noop }), head: { appendChild: noop }, addEventListener: noop, removeEventListener: noop, getElementById: () => null, querySelector: (sel) => (settingsOpen && sel === '[data-shortcut-modal="settings"]' ? {} : null), dispatchEvent: (ev) => { escaped.push(ev) } }
  new Function('window', 'document', src)(win, doc)
  const plugin = def.factory((name) => (name === 'react' ? React : undefined))
  let comp = null
  const ctx = { effect: (fn) => fn(), get: (n) => (n === 'uiWorkspace' && ws ? { openSession: (id) => opened.push(id) } : null), slots: { inject: (n, make) => { make(); return noop }, register: (spec, c) => { comp = c; return noop } } }
  plugin.apply(ctx)
  const el = comp()
  let tree = null
  const render = () => {
    i = 0
    effects = []
    tree = el.type(el.props)
    find(tree, (n) => n.props && n.props.ref !== undefined).forEach((n) => { if (n.props.ref.current === null || n.props.ref.current === undefined) n.props.ref.current = { getBoundingClientRect: () => ({ width }), scrollTop: 0, scrollHeight: 900, clientHeight: 300 } })
    const run = effects
    effects = []
    for (const f of run) f()
    return tree
  }
  const settle = async () => { render(); await flush(); render(); await flush(); return render() }
  return { render, settle, get tree () { return tree }, calls, timers, opened, escaped, t: plugin.__test, Title: win.__KB_HELP__ === undefined ? null : win.__KB_HELP__.Title }
}

// A day of records as the host keeps them (newest last), around a fixed "now".
const NOW = Date.now()
const T0 = new Date(NOW).setHours(0, 0, 0, 0)
// the records run up to 54 s after their base: the base is at least a minute before "now" (it was one second, which put them in the future between midnight and 03:00), and never before today's midnight
const at = (min) => Math.max(T0 + 1000, Math.min(NOW - 60000, T0 + 3 * 3600000)) + min * 1000
let seq = 0
const rec = (o) => ({ seq: ++seq, ...o })
const records = [
  rec({ at: T0 - 86400000 + 3600000, session: 'old', type: 'llm', kind: 'answer', provider: 'anthropic', model: 'claude-opus-5-5', input: 12000, output: 640 }),
  rec({ at: at(0), session: 'aaa', type: 'session', kind: 'title', title: 'Tidy memory & lessons' }),
  rec({ at: at(1), session: 'aaa', type: 'session', kind: 'turn-start' }),
  rec({ at: at(2), session: 'aaa', type: 'llm', kind: 'request', provider: 'anthropic', model: 'claude-opus-5-5' }),
  rec({ at: at(3), session: 'aaa', type: 'llm', kind: 'answer', provider: 'anthropic', model: 'claude-opus-5-5', input: 37100, output: 1200 }),
  rec({ at: at(4), session: 'aaa', type: 'tool', kind: 'call', tool: 'memory_tidy', callId: 'c1' }),
  rec({ at: at(4), session: 'aaa', type: 'tool', kind: 'call', tool: 'write', callId: 'c2' }),
  rec({ at: at(6), session: 'aaa', type: 'tool', kind: 'result', ok: true, callId: 'c2' }),
  rec({ at: at(34), session: 'aaa', type: 'tool', kind: 'result', ok: true, callId: 'c1' }),
  rec({ at: at(33), session: 'aaa', type: 'session', kind: 'turn-end', status: 'completed' }),
  rec({ at: at(40), session: 'bbb', type: 'session', kind: 'turn-start' }),
  rec({ at: at(40), session: 'bbb', type: 'session', kind: 'turn-end', status: 'failed', error: 'error', detail: 'no adapter registered for provider "zai-coding-cn"' }),
  rec({ at: at(41), session: 'ccc', type: 'session', kind: 'turn-start' }),
  rec({ at: at(41), session: 'ccc', type: 'session', kind: 'turn-end', status: 'failed', error: 'error', detail: 'no adapter registered for provider "zai-coding-cn"' }),
  rec({ at: at(42), session: 'ddd', type: 'session', kind: 'turn-start' }),
  rec({ at: at(42), session: 'ddd', type: 'session', kind: 'turn-end', status: 'failed', error: 'error', detail: 'no adapter registered for provider "zai-coding-cn"' }),
  rec({ at: at(50), session: 'aaa', type: 'llm', kind: 'retry', provider: 'anthropic', attempt: 1, error: 'TRANSPORT' }),
  rec({ at: at(51), session: 'aaa', type: 'connector', kind: 'call', tool: 'mcp__github__create_issue', callId: 'c3' }),
  rec({ at: at(52), session: 'aaa', type: 'tool', kind: 'result', ok: false, callId: 'c3', detail: 'E_FORBIDDEN' }),
  rec({ at: at(53), session: 'aaa', type: 'title', kind: 'request', provider: 'kybernos', model: 'deepseek-v4.1-flash' }),
  rec({ at: at(54), session: 'aaa', type: 'session', kind: 'title', title: 'Activity log v3' })
]
const hours = Array.from({ length: 24 }, (_, hh) => ({ calls: hh === 3 ? 1 : 0, tokens: hh === 3 ? 38300 : 0, failures: hh === 3 ? 4 : 0, unasked: hh === 3 ? 1 : 0 }))
const statsWith = (withHours) => ({ json: { ok: true, days: [{ day: new Date(NOW).toISOString() && (() => { const d = new Date(NOW); const p = (n) => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) })(), calls: 1, tokens: 38300, ...(withHours ? { hours } : {}) }] } })
const hostOf = (list, { withHours = true, titles = {}, extra = () => null } = {}) => (url) => {
  const x = extra(url)
  if (x !== null) return x
  if (url.startsWith('/kybernos-log/stats')) return statsWith(withHours)
  if (url.startsWith('/kybernos-log/events')) {
    const p = new URL('http://x' + url).searchParams
    const before = p.get('before') ? Number(p.get('before')) : Infinity
    const since = p.get('since') ? Number(p.get('since')) : -Infinity
    const limit = Number(p.get('limit')) || 200
    const keep = list.filter((e) => e.seq < before && e.at >= since)
    const events = keep.slice(Math.max(0, keep.length - limit))
    return { json: { ok: true, events, total: list.length, hasMore: keep.length > limit, titles } }
  }
  return { status: 404, json: undefined }
}

// The head: the Suite's "?" card, or the bare title (2026-11-02).
{
  const withSuite = mount({ suite: true, host: hostOf([]) })
  const tree = await withSuite.settle()
  const cards = find(tree, (n) => n.type === withSuite.Title)
  ok('with the Suite: one head (title + "?" card), given the description as `lead`', cards.length === 1 && cards[0].props.id === 'kybernos-log' && cards[0].props.lead === withSuite.t.S.lead[1] && cards[0].props.title === 'Activity log')
  ok('...and the description is not drawn under the title, while "Metadata only" stays', find(tree, cls('kblg-lead')).length === 0 && find(tree, cls('kblg-priv')).length === 1)
  const without = mount({ host: hostOf([]) })
  const t2 = await without.settle()
  ok('without the Suite: the bare title in the shared class, and the description under it', find(t2, (n) => n.type === 'h2' && n.props.className === 'kbhp-title kblg-title').length === 1 && find(t2, cls('kblg-lead')).length === 1)
  ok('an empty journal says "nothing yet"', find(t2, (n) => n.props['data-empty'] === 'nothing').length === 1)
}

const page = mount({ host: hostOf(records, { titles: { old: 'Release notes' } }), settingsOpen: true })
let tree = await page.settle()
const rowsOf = (t) => find(t, cls('kblg-row'))
const rowText = (r) => text(r)
{
  // tabs
  const tablist = find(tree, (n) => n.props.role === 'tablist')
  const tabs = find(tree, (n) => n.props.role === 'tab')
  ok('two tabs in a tablist: Calls (selected) and Terminal', tablist.length === 1 && tabs.length === 2 && text(tabs[0]) === 'Calls' && tabs[0].props['aria-selected'] === 'true' && tabs[1].props['aria-selected'] === 'false' && tabs[1].props.tabIndex === -1)
  ok('the tabs move with the arrow keys', typeof tablist[0].props.onKeyDown === 'function')
  // toolbar: one line
  const bar = find(tree, cls('kblg-bar'))[0]
  ok('the toolbar holds the search, the period, Errors only, Live and the "..." menu', bar !== undefined && find(bar, (n) => n.type === 'input' && n.props.type === 'search').length === 1 &&
    find(bar, (n) => n.type === 'select' && n.props['aria-label'] === 'Period').length === 1 && find(bar, (n) => n.props['data-toggle'] === 'errors').length === 1 &&
    find(bar, (n) => n.props['data-toggle'] === 'live').length === 1 && find(bar, (n) => n.props['aria-haspopup'] === 'menu').length === 1)
  eq('the period select offers Today, 7 days and All', find(bar, (n) => n.type === 'option').map(text), ['Today', '7 days', 'All'])
  // rows: merged pairs, no ok pill
  const rows = rowsOf(tree)
  const names = rows.map((r) => text(find(r, (n) => n.type === 'b')[0]))
  ok('a tool call and its result are one row each (memory_tidy, write: two rows, not four)', names.filter((n) => n === 'memory_tidy').length === 1 && names.filter((n) => n === 'write').length === 1 && !names.includes('Tool result'))
  const tidy = rows.find((r) => text(find(r, (n) => n.type === 'b')[0]) === 'memory_tidy')
  ok('...the result found its own call by id: memory_tidy took 30 s, write 2 s', rowText(tidy).includes('30 s') && rowText(rows.find((r) => text(find(r, (n) => n.type === 'b')[0]) === 'write')).includes('2 s'))
  ok('a turn start and its end are one row: "completed in 32 s"', rows.filter((r) => rowText(r).includes('completed in 32 s')).length === 1)
  ok('the request record is not a row of its own (one model row per answer: today and yesterday)', names.filter((n) => n === 'anthropic/claude-opus-5-5').length === 2)
  ok('no "ok" pill anywhere', find(tree, cls('kblg-pill')).every((p) => !/^ok/i.test(text(p))) && !find(tree, cls('kblg-pill')).some((p) => text(p) === ''))
  const pills = find(tree, cls('kblg-pill')).map(text)
  ok('three failed turns in a row collapse into one "failed \u00d73"', pills.filter((p) => p === 'failed \u00d73').length === 1 && rows.filter((r) => rowText(r).includes('zai-coding-cn')).length === 1)
  ok('a pill only for failed, error and retry', pills.every((p) => /^(failed|error|retry)( \u00d7\d+)?$/.test(p)) && pills.includes('error') && pills.includes('retry'))
  ok('the chat column says the chat\u2019s latest title, else the short id', rows.some((r) => text(find(r, cls('kblg-chat'))[0]) === 'Activity log v3') && rows.some((r) => text(find(r, cls('kblg-chat'))[0]) === 'ddd'))
  ok('a chat title the host sent from beyond the ring names its rows', rows.some((r) => text(find(r, cls('kblg-chat'))[0]) === 'Release notes'))
  ok('an automatic title shows the title it gave', rows.some((r) => rowText(r).includes('Auto title') && rowText(r).includes('\u201cActivity log v3\u201d')))
  ok('a model row says its tokens in and out, and the total on the right', rows.some((r) => rowText(r).includes('37.1k in \u00b7 1.2k out') && text(find(r, cls('kblg-n'))[0]) === '38.3k'))
  ok('time is HH:MM:SS', rows.every((r) => /^\d\d:\d\d:\d\d$/.test(text(find(r, cls('kblg-t'))[0]))))
  // one number everywhere
  const chipAll = find(tree, (n) => n.props['data-chip'] === 'all')[0]
  const range = text(find(tree, cls('kblg-range'))[0])
  const dayHeads = find(tree, cls('kblg-day'))
  const dayCounts = dayHeads.map((d) => Number((text(d.children[1]).match(/^(\d+) call/) || [0, 1])[1]))
  ok('one number: the All chip, the pager and the day headers all count the rows as listed (' + rows.length + ')', text(chipAll).endsWith(String(rows.length)) && range === '1\u2013' + rows.length + ' of ' + rows.length + ' \u00b7 newest first' && dayCounts.reduce((a, b) => a + b, 0) === rows.length)
  ok('the rows are grouped by day with a header: "Today, <weekday> <day> <month>" and "Yesterday, ..."', dayHeads.length === 2 && /^Today, [A-Z][a-z]+ \d{1,2} [A-Z][a-z]+/.test(text(dayHeads[0].children[0])) && /^Yesterday, /.test(text(dayHeads[1].children[0])))
  const errBtn = find(tree, (n) => n.props['data-toggle'] === 'errors')[0]
  const failures = rows.filter((r) => r.props['data-state'] !== '').length
  ok('"Errors only" counts the failure rows as listed (' + failures + ')', text(errBtn) === 'Errors only' + failures)
  const cardF = find(tree, (n) => n.props['data-card'] === 'failures')[0]
  const failuresWithRepeats = rows.filter((r) => r.props['data-state'] !== '').reduce((n, r) => { const m = /\u00d7(\d+)/.exec(text(r)); return n + (m === null ? 1 : Number(m[1])) }, 0)
  ok('the failures card: red border when > 0, a button, and its number counts every failure of today, a "failed x3" row as three (' + failuresWithRepeats + ')', failuresWithRepeats > failures && cardF.type === 'button' && cardF.props.className.includes('is-bad') && text(find(cardF, (n) => n.type === 'b')[0]) === String(failuresWithRepeats))
  ok('the other cards: calls and unasked of today', text(find(find(tree, (n) => n.props['data-card'] === 'calls')[0], (n) => n.type === 'b')[0]) === '1' && text(find(find(tree, (n) => n.props['data-card'] === 'unasked')[0], (n) => n.type === 'b')[0]) === '1')
  const sparks = find(tree, cls('kblg-spark'))
  ok('each card has a 24-bar sparkline from the host\u2019s hours', sparks.length === 4 && sparks.every((s) => find(s, (n) => n.type === 'i').length === 24))
  // chips: zero families hidden, icons
  const chipKeys = find(tree, (n) => n.props['data-chip'] !== undefined).map((n) => n.props['data-chip'])
  eq('chips: All first, then the families present (web search, approvals... at zero are hidden)', chipKeys, ['all', 'llm', 'tool', 'connector', 'session', 'unasked'])
  ok('each family chip has its mark (a stroke icon in currentColor)', find(tree, (n) => n.props['data-chip'] === 'llm')[0].children.some((c) => c && c.props && c.props.className === 'kblg-ico'))
  ok('narrow: the chat also sits under What as a second sub line', rows.every((r) => find(r, cls('kblg-chat2')).length === 1))
  ok('the page is not narrow at 720 px', !tree.props.className.includes('kblg-narrow'))
}
{
  // click a row: its detail
  const failedRow = rowsOf(tree).find((r) => r.props['data-state'] === 'failed')
  failedRow.props.onClick()
  tree = page.render()
  const dl = find(tree, cls('kblg-open'))
  ok('a click opens the row\u2019s detail inline', dl.length === 1 && rowsOf(tree).find((r) => r.props['data-state'] === 'failed').props['aria-expanded'] === 'true')
  const dlText = text(dl[0])
  ok('the detail: the chat, the full error, the repeats and their times, in 3 chats', dlText.includes('Chat') && dlText.includes('no adapter registered for provider "zai-coding-cn"') && dlText.includes('3 times: ') && dlText.includes('in 3 chats'))
  const link = find(dl[0], cls('kblg-link'))
  ok('an "open the chat" link leaves Settings and opens that chat, Electron included', link.length === 1 && (link[0].props.onClick({ stopPropagation: noop }), page.opened[0] === 'ddd' && page.escaped.length === 1 && page.escaped[0].key === 'Escape'))
  const enter = rowsOf(tree).find((r) => r.props['data-state'] === 'failed')
  enter.props.onKeyDown({ key: 'Enter', preventDefault: noop })
  tree = page.render()
  ok('Enter toggles it closed', find(tree, cls('kblg-open')).length === 0)
  // Escape on the open menu closes the menu only: Settings closes on Escape too, so the key must not travel further.
  find(tree, (n) => n.props['aria-haspopup'] === 'menu')[0].props.onClick()
  tree = page.render()
  let stopped = false
  find(tree, cls('kblg-menuwrap'))[0].props.onKeyDown({ key: 'Escape', stopPropagation: () => { stopped = true }, preventDefault: noop })
  tree = page.render()
  ok('Escape closes the menu and stops there (Settings stays open)', stopped && find(tree, (n) => n.props.role === 'menu').length === 0)
  const tool = rowsOf(tree).find((r) => text(r).includes('mcp__github__create_issue'))
  tool.props.onClick()
  tree = page.render()
  ok('a tool row\u2019s detail says its call id and its error code', text(find(tree, cls('kblg-open'))[0]).includes('c3') && text(find(tree, cls('kblg-open'))[0]).includes('E_FORBIDDEN'))
  const noWs = mount({ host: hostOf(records), ws: false })
  let t3 = await noWs.settle()
  rowsOf(t3)[0].props.onClick()
  t3 = noWs.render()
  ok('no workspace seam: no link', find(t3, cls('kblg-open')).length === 1 && find(t3, cls('kblg-link')).length === 0)
}
{
  // Errors only
  find(tree, (n) => n.props['data-toggle'] === 'errors')[0].props.onClick()
  tree = page.render()
  const rows = rowsOf(tree)
  ok('Errors only: only failure rows, and the pager says the same number', rows.length === 3 && rows.every((r) => r.props['data-state'] !== '') && text(find(tree, cls('kblg-range'))[0]).endsWith(' of 3 \u00b7 newest first'))
  find(tree, (n) => n.props['data-toggle'] === 'errors')[0].props.onClick()
  tree = page.render()
  // a chip
  find(tree, (n) => n.props['data-chip'] === 'tool')[0].props.onClick()
  tree = page.render()
  const toolChip = text(find(tree, (n) => n.props['data-chip'] === 'tool')[0])
  ok('a family chip: its count is the rows it lists', rowsOf(tree).length === 2 && toolChip.endsWith('2'))
  find(tree, (n) => n.props['data-chip'] === 'all')[0].props.onClick()
  // search that matches nothing
  find(tree, (n) => n.type === 'input')[0].props.onChange({ target: { value: 'nothing-like-this' } })
  tree = page.render()
  const nomatch = find(tree, (n) => n.props['data-empty'] === 'nomatch')
  ok('nothing matches: its own empty state, with a Clear filters button', nomatch.length === 1 && text(nomatch[0]).includes('Nothing matches your filters.') && find(nomatch[0], (n) => n.type === 'button' && text(n) === 'Clear filters').length === 1)
  find(nomatch[0], (n) => n.type === 'button')[0].props.onClick()
  tree = page.render()
  ok('...and Clear filters brings the rows back', rowsOf(tree).length > 0)
  // the failures card turns on Errors only
  find(tree, (n) => n.props['data-card'] === 'failures')[0].props.onClick()
  tree = page.render()
  ok('a click on the failures card turns on "Errors only" for today', find(tree, (n) => n.props['data-toggle'] === 'errors')[0].props['aria-pressed'] === 'true' && find(tree, (n) => n.type === 'select' && n.props['aria-label'] === 'Period')[0].props.value === 'today')
  find(tree, (n) => n.props['data-toggle'] === 'errors')[0].props.onClick()
  tree = page.render()
}
{
  // the menu
  const more = find(tree, (n) => n.props['aria-haspopup'] === 'menu')[0]
  more.props.onClick()
  tree = page.render()
  eq('the "..." menu holds Refresh and Copy JSON', find(tree, (n) => n.props.role === 'menuitem').map(text), ['Refresh', 'Copy JSON'])
  find(tree, (n) => n.props['aria-haspopup'] === 'menu')[0].props.onClick()
  tree = page.render()
}
{
  // live: new rows wait behind a pill
  const before = rowsOf(tree).map((r) => r.props['data-family'] + text(r))
  const live = page.timers.find((x) => x.on && x.ms === 3000)
  ok('live is on by default and polls', live !== undefined)
  const late = NOW - 500
  records.push(rec({ at: late, session: 'eee', type: 'llm', kind: 'answer', provider: 'anthropic', model: 'claude-opus-5-5', input: 1, output: 1 }))
  records.push(rec({ at: late, session: 'eee', type: 'llm', kind: 'answer', provider: 'anthropic', model: 'claude-opus-5-5', input: 2, output: 2 }))
  await live.fn()
  tree = page.render()
  const pill = find(tree, cls('kblg-new'))
  ok('live: "2 new calls - show" above the list, and the rows did not move', pill.length === 1 && text(pill[0]) === '\u2191 2 new calls \u00b7 show' && JSON.stringify(rowsOf(tree).map((r) => r.props['data-family'] + text(r))) === JSON.stringify(before))
  ok('live asks only for what is new (since)', page.calls.some((u) => u.includes('since=')))
  find(pill[0], (n) => n.type === 'button')[0].props.onClick()
  tree = page.render()
  ok('show: the new rows on page 1, the pill gone', find(tree, cls('kblg-new')).length === 0 && rowsOf(tree).length === before.length + 2)
  records.push(rec({ at: NOW - 400, session: 'aaa', type: 'tool', kind: 'call', tool: 'bash', callId: 'c9' }))
  await live.fn()
  tree = page.render()
  find(tree, cls('kblg-new'))[0] && find(find(tree, cls('kblg-new'))[0], (n) => n.type === 'button')[0].props.onClick()
  tree = page.render()
  records.push(rec({ at: NOW - 300, session: 'aaa', type: 'tool', kind: 'result', ok: true, callId: 'c9' }))
  await live.fn()
  tree = page.render()
  ok('a result that completes a row already shown adds no pill: the row completes in place', find(tree, cls('kblg-new')).length === 0 && rowsOf(tree).some((r) => text(r).includes('bash') && /\d s/.test(text(r))))
}
{
  // the pager: 130 rows, 50 per page
  const many = []
  let s2 = 0
  for (let k = 0; k < 130; k += 1) many.push({ seq: ++s2, at: NOW - 200000 + k * 100, session: 'p', type: 'llm', kind: 'answer', provider: 'p', model: 'm', input: 1, output: 1 })
  const pg = mount({ host: hostOf(many) })
  let t4 = await pg.settle()
  eq('the pager: "1-50 of 130 - newest first"', text(find(t4, cls('kblg-range'))[0]), '1\u201350 of 130 \u00b7 newest first')
  eq('...pages 1 2 3, previous and next', find(t4, cls('kblg-pg')).map(text), ['\u2039', '1', '2', '3', '\u203a'])
  ok('...50 rows on the page, the newest first', rowsOf(t4).length === 50)
  ok('...and the ring was read in pages of 500 with before= when the host said there was more', pg.calls.filter((u) => u.startsWith('/kybernos-log/events?limit=500')).length === 1)
  find(t4, (n) => n.type === 'select' && n.props['aria-label'] === 'Rows per page')[0].props.onChange({ target: { value: '25' } })
  t4 = await pg.settle()
  eq('25 per page: six pages', find(t4, cls('kblg-pg')).map(text), ['\u2039', '1', '2', '3', '4', '5', '6', '\u203a'])
  find(t4, (n) => n.props['aria-label'] === 'Go to page 6')[0].props.onClick()
  t4 = pg.render()
  ok('the last page: "126-130 of 130", five rows', text(find(t4, cls('kblg-range'))[0]) === '126\u2013130 of 130 \u00b7 newest first' && rowsOf(t4).length === 5)
  eq('the per-page choices', find(find(t4, (n) => n.props['aria-label'] === 'Rows per page')[0], (n) => n.type === 'option').map(text), ['25 per page', '50 per page', '100 per page', '200 per page'])
  const t = pg.t
  eq('pageItems: the first, the last, the current and its neighbours', [t.pageItems(1, 60), t.pageItems(30, 60), t.pageItems(60, 60)], [[1, 2, 3, 4, '\u2026', 60], [1, '\u2026', 29, 30, 31, '\u2026', 60], [1, '\u2026', 57, 58, 59, 60]])
  const big = []
  for (let k = 0; k < 1200; k += 1) big.push({ seq: k + 1, at: NOW - 900000 + k, session: 'b', type: 'llm', kind: 'answer', input: 1, output: 1 })
  const ring = mount({ host: hostOf(big) })
  await ring.settle()
  ok('a ring larger than one page is read whole: 3 pages, each older than the last', ring.calls.filter((u) => u.startsWith('/kybernos-log/events')).length === 3 && ring.calls.some((u) => u.includes('before=701')) && ring.calls.some((u) => u.includes('before=201')))
}
{
  // the pure helpers
  const t = page.t
  const legacy = t.buildRows([{ seq: 1, at: 1, type: 'tool', kind: 'call', session: 's', tool: 'bash' }, { seq: 2, at: 2, type: 'tool', kind: 'result', session: 's' }])
  ok('a record written before ids existed takes the open call of its chat', legacy.length === 1 && legacy[0].name === 'bash' && legacy[0].done === true)
  const step = t.buildRows([
    { seq: 1, at: 1, type: 'tool', kind: 'call', session: 's', callId: 'a', tool: 'skill' },
    { seq: 2, at: 1, type: 'tool', kind: 'call', session: 's', callId: 'b', tool: 'write' },
    { seq: 3, at: 5, type: 'tool', kind: 'result', session: 's', callId: 'b', ok: false },
    { seq: 4, at: 9, type: 'tool', kind: 'result', session: 's', callId: 'a', ok: true }])
  ok('two calls in one step: each result finds its own call (UJ-211)', step.length === 2 && step.find((r) => r.name === 'write').state === 'error' && step.find((r) => r.name === 'skill').end === 9)
  const c = t.collapse([{ state: 'failed', type: 'session', what: 'turn', error: 'x', at: 3 }, { state: 'failed', type: 'session', what: 'turn', error: 'x', at: 2 }, { type: 'llm', what: 'answer', at: 1.5 }, { state: 'failed', type: 'session', what: 'turn', error: 'x', at: 1 }])
  eq('collapse: only consecutive repeats of the same failure', c.map((r) => r.repeats.length), [2, 1, 1])
  eq('a success never collapses', t.collapse([{ what: 'answer', type: 'llm' }, { what: 'answer', type: 'llm' }]).length, 2)
  eq('durations read short', [t.dur(2100), t.dur(32000), t.dur(125000)], ['2.1 s', '32 s', '2 min 05 s'])
}
{
  // narrow
  const narrow = mount({ host: hostOf(records), width: 480 })
  const t5 = await narrow.settle()
  ok('under 600 px the page takes the kblg-narrow class (its own box, not the viewport)', t5.props.className === 'kblg-page kblg-narrow')
}
{
  // empty states
  const down = mount({ host: () => ({ status: 404, json: undefined }) })
  const t6 = await down.settle()
  ok('the route does not answer: its own empty state', find(t6, (n) => n.props['data-empty'] === 'unreachable').length === 1 && text(t6).includes('The journal route does not answer'))
  ok('...and the sparklines say they have no hourly figures', find(t6, cls('kblg-spark')).every((s) => s.props.className.includes('is-none')))
  const oldHost = mount({ host: hostOf(records, { withHours: false }) })
  const t7 = await oldHost.settle()
  ok('a host without hours: the rows are there, the sparklines wait', rowsOf(t7).length > 0 && find(t7, cls('kblg-spark')).every((s) => s.props.className.includes('is-none')))
}
{
  // French
  const fr = mount({ host: hostOf(records), language: 'fr' })
  const t8 = await fr.settle()
  ok('in French: the tabs, the pager and the day header', text(find(t8, (n) => n.props.role === 'tab')[0]) === 'Appels' && /sur \d+ \u00b7 les plus r\u00e9cents d\u2019abord$/.test(text(find(t8, cls('kblg-range'))[0])) && /^Aujourd\u2019hui, [a-z]+ \d{1,2} [a-z\u00e9\u00fb]+/.test(text(find(t8, cls('kblg-day'))[0].children[0])))
}
{
  // the terminal tab
  const lines = [
    { n: 10, text: '[kybernos-cloud] routes mounted' },
    { n: 11, text: 'dsh web: http://127.0.0.1:3080/?token=[hidden]' },
    { n: 12, text: '[kybers] scheduled tasks: 1' },
    { n: 13, text: '[kybers] scheduled tasks: 1' },
    { n: 14, text: '[kybers] scheduled tasks: 1' },
    { n: 15, text: 'plain line' }
  ]
  let follow = []
  const term = (url) => {
    if (!url.startsWith('/kybernos-log/terminal')) return null
    const p = new URL('http://x' + url).searchParams
    if (p.get('after')) return { json: { ok: true, exists: true, file: 'dsh-web.out.log', total: 15 + follow.length, lines: follow, plugins: [] } }
    if (p.get('before')) return { json: { ok: true, exists: true, file: 'dsh-web.out.log', total: 15, lines: [{ n: 9, text: 'older' }], hasOlder: false, plugins: [] } }
    if (p.get('stream') === 'err') return { json: { ok: true, exists: false, file: 'dsh-web.err.log' } }
    return { json: { ok: true, exists: true, file: 'dsh-web.out.log', total: 15, lines, hasOlder: true, plugins: [{ tag: 'kybernos-cloud', count: 1 }, { tag: 'kybers', count: 3 }] } }
  }
  const tp = mount({ host: hostOf(records, { extra: term }) })
  let t9 = await tp.settle()
  find(t9, (n) => n.props.role === 'tab')[1].props.onClick()
  t9 = await tp.settle()
  ok('the Terminal tab: Output | Errors, a filter, a plugin select, Follow and Copy', find(t9, (n) => n.props['data-stream'] === 'out' && n.props['aria-pressed'] === 'true').length === 1 && find(t9, (n) => n.props['data-stream'] === 'err').length === 1 &&
    find(t9, (n) => n.type === 'input' && n.props.placeholder === 'Filter lines\u2026').length === 1 && find(t9, (n) => n.props['data-toggle'] === 'follow').length === 1 && find(t9, (n) => n.type === 'button' && text(n) === 'Copy').length === 1)
  eq('the plugin select lists the tags seen', find(find(t9, (n) => n.type === 'select' && n.props['aria-label'] === 'Plugin')[0], (n) => n.type === 'option').map(text), ['All plugins', '[kybernos-cloud] 1', '[kybers] 3'])
  const tls = find(t9, cls('kblg-tl'))
  ok('identical consecutive lines are one line with \u00d73', tls.length === 4 && text(tls[2]) === '[kybers] scheduled tasks: 1\u00d73')
  ok('the line that says DSH is ready draws a dashed separator, which says the lines above were its start', find(t9, cls('kblg-sep')).length === 1 && text(find(t9, cls('kblg-sep'))[0]).includes('DSH is ready'))
  ok('the plugin tag is its own span, a hidden secret its own mark', find(t9, cls('kblg-tag')).length === 2 && find(t9, cls('kblg-mask')).length === 1)
  ok('the box head says how many lines the file has', text(find(t9, cls('kblg-term-head'))[0]).startsWith('What DSH prints in its terminal \u00b7 15 lines'))
  ok('the note: read here only, secrets hidden, a plugin may still print a path', text(find(t9, cls('kblg-note'))[0]).includes('never sent') && text(find(t9, cls('kblg-note'))[0]).includes('file path'))
  const box = find(t9, cls('kblg-term-body'))[0]
  ok('the box opens at its newest line (scrolled to the bottom)', box.props.ref.current.scrollTop === 900)
  const older = find(t9, cls('kblg-older'))[0]
  ok('"Load 500 older lines" sits at the top of the box', older !== undefined && text(older).includes('Load 500 older lines'))
  await older.props.onClick()
  t9 = tp.render()
  ok('...and asks for the lines before the first shown', tp.calls.some((u) => u.includes('before=10')) && text(find(t9, cls('kblg-tl'))[0]) === 'older')
  const fol = tp.timers.find((x) => x.on && x.ms === 2000)
  ok('Follow polls every 2 s', fol !== undefined)
  follow = [{ n: 16, text: 'new line' }]
  await fol.fn()
  t9 = tp.render()
  ok('...with after= the last line, and the new line is appended', tp.calls.some((u) => u.includes('after=15')) && text(find(t9, cls('kblg-tl')).pop()) === 'new line')
  find(t9, (n) => n.props['data-stream'] === 'err')[0].props.onClick()
  t9 = await tp.settle()
  ok('the Errors stream is its own file; a missing one says so', text(t9).includes('No dsh-web.err.log yet'))
  const tpDown = mount({ host: hostOf(records) })
  let t10 = await tpDown.settle()
  find(t10, (n) => n.props.role === 'tab')[1].props.onClick()
  t10 = await tpDown.settle()
  ok('a host that was not restarted: "the terminal route does not answer"', find(t10, (n) => n.props['data-empty'] === 'unreachable').length === 1 && text(t10).includes('The terminal route does not answer'))
  const signin = mount({ host: hostOf(records, { extra: (u) => (u.startsWith('/kybernos-log/terminal') ? { status: 401, json: { ok: false, error: 'sign-in required' } } : null) }) })
  let t11 = await signin.settle()
  find(t11, (n) => n.props.role === 'tab')[1].props.onClick()
  t11 = await signin.settle()
  ok('401: sign in again', text(t11).includes('Sign in again to read the terminal.'))
  const errView = tp.t.termView([{ n: 1, text: 'a' }, { n: 2, text: 'a' }, { n: 3, text: 'b' }])
  eq('termView collapses and keeps the line numbers', errView.map((l) => [l.n, l.last, l.count]), [[1, 2, 2], [3, 3, 1]])
}

console.log((fails.length === 0 ? '\u2713 ' : '\u2717 ') + pass + ' passed' + (fails.length === 0 ? '' : ', ' + fails.length + ' failed'))
for (const f of fails) console.log('   \u2717 ' + f)
process.exit(fails.length === 0 ? 0 : 1)

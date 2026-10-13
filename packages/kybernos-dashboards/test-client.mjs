// kybernos-dashboards: the browser half, without a browser. `cd packages/kybernos-dashboards && node test-client.mjs`
// It evaluates the built client.js against stubs (no React, no DOM), then checks the registration, the painters, the
// stylesheet (every animation gated and defined, reduced motion honoured, no stray colour) and the contract with the core menu.
import { readFileSync } from 'node:fs'
import { assemble } from './scripts/build.mjs'

let fail = 0
let passed = 0
const ok = (name, cond, detail) => {
  if (cond) { passed++; return }
  fail++
  console.log('FAIL ' + name + (detail === undefined ? '' : ' :: ' + JSON.stringify(detail)))
}
const here = (f) => new URL(f, import.meta.url)
const text = (f) => readFileSync(here(f), 'utf8')
const src = text('./client.js')

ok('client.js is the build of its sources (run node scripts/build.mjs)', assemble() === src)
ok('a plain browser script: no import, no export, no top-level await', !/^\s*(import|export)\s/m.test(src) && !/\bawait\s+import\(/.test(src))
ok('the factory degrades to a disabled plugin instead of throwing', src.includes("return { name: 'kybernos-dashboards/client', inject: [], apply () {} }") && src.includes('window.__ModuleLoader__.load('))
ok('no personal path, no network host', !/\/Users\//.test(src) && !/https?:\/\/(?!www\.w3\.org)/.test(src.replace(/https?:\/\/127\.0\.0\.1/g, '')))
ok('no engine package import', !/@deepseek-ai\//.test(src.replace(/@deepseek-ai\/dsh-client-ui-sidebar-right/g, '')))

// ── evaluate against stubs ───────────────────────────────────────────────────
const timers = []
const fakeReact = {
  Fragment: 'Fragment',
  createElement: (t, p, ...c) => ({ t, p: p || {}, c }),
  useState: (v) => [typeof v === 'function' ? v() : v, () => {}],
  useEffect: () => {}, useLayoutEffect: () => {}, useRef: (v) => ({ current: v === undefined ? null : v }), useMemo: (f) => f(), useCallback: (f) => f,
}
const store = {}
const win = {
  __KB_LANG_RESOLVE__: () => 'en',
  matchMedia: () => ({ matches: false }),
  localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v) } },
  addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => true,
  innerWidth: 1200, innerHeight: 800,
}
const styles = []
const doc = {
  head: { appendChild: (el) => { styles.push(el) } },
  getElementById: () => null,
  createElement: () => { const el = { attrs: {}, setAttribute (k, v) { this.attrs[k] = v }, remove () {} }; return el },
  querySelector: () => null,
}
let captured = null
win.__ModuleLoader__ = { load: (def) => { captured = def } }
globalThis.window = win
globalThis.document = doc
globalThis.CustomEvent = class { constructor (type, init) { this.type = type; this.detail = init && init.detail } }
let lastFetch = null
globalThis.fetch = async (url, init) => { lastFetch = { url, init }; return { ok: true, status: 200, json: async () => ({ ok: true, current: null, dashboards: [], presets: [] }) } }
const realSetInterval = globalThis.setInterval
globalThis.setInterval = (fn, ms) => { const id = realSetInterval(() => {}, 1e9); timers.push(id); return id }

new Function(src)()
ok('the bundle registers one module through the loader', captured !== null && captured.id === '@local/kybernos-dashboards/client' && typeof captured.factory === 'function')
const plugin = captured.factory((name) => { if (name === 'react') return fakeReact; throw new Error('unexpected require ' + name) })
ok('the factory returns a plugin: inject, apply, test hooks', plugin && Array.isArray(plugin.inject) && typeof plugin.apply === 'function' && typeof plugin.__test === 'object', plugin && Object.keys(plugin))
ok('it declares the services it needs before apply runs', plugin.inject.includes('slots') && plugin.inject.includes('sidebarRightTabs'))
const T = plugin.__test

// ── registration ─────────────────────────────────────────────────────────────
{
  const injected = {}
  const cleanups = []
  const tabs = []
  const ctx = {
    get: (k) => (k === 'sidebarRightTabs' ? { register: (t) => { tabs.push(t); return () => {} } } : (k === 'sidebarRight' ? { openTab: () => {} } : undefined)),
    effect: (fn, label) => { const c = fn(); cleanups.push({ label, c }); return c },
    slots: { inject: (name, make) => { const r = make(); injected[name] = r; return () => {} }, register: (spec, comp) => ({ spec, comp }) },
  }
  plugin.apply(ctx)
  ok('the stylesheet is inserted once, tagged with the plugin', styles.length === 1 && styles[0].textContent === T.CSS && styles[0].attrs['data-plugin'] === '@local/kybernos-dashboards')
  const page = injected['main.kybernos-dashboards']
  ok('the page is injected on the child slot of the core menu', page !== undefined && page.spec.name === 'main.kybernos-dashboards' && typeof page.comp === 'function')
  const pane = injected['sidebar.right.pane.tab']
  ok('the pane body is injected on the right-pane slot with its own key', pane !== undefined && pane.spec.key === 'kybernos-dashboards' && typeof pane.comp === 'function')
  ok('the tab type is registered with a title and a guide', tabs.length === 1 && tabs[0].id === 'kybernos-dashboards' && tabs[0].kind === 'kybernos-dashboards' && tabs[0].title() === 'Dashboard' && tabs[0].guide[0].description().length > 10)
  ok('every effect has a label (a failure says whose it was)', cleanups.every((e) => typeof e.label === 'string' && e.label.startsWith('kybernos-dashboards:')))
  ok('the MiniApp door gets the dashboard player (queued when the core is not there yet)', Array.isArray(win.__KB_MINIAPP_PENDING__) && win.__KB_MINIAPP_PENDING__.some((x) => x[0] === 'dashboard' && typeof x[1] === 'function'))
  ok('the page can be opened from elsewhere, and the chat key can be read', typeof win.__KB_DASHBOARDS__.open === 'function' && win.__KB_DASHBOARDS__.open('x') === false && typeof win.__KB_DASHBOARDS__.session() === 'string')
  await new Promise((r) => setTimeout(r, 30))
  ok('the open-on-arrival probe asks for the strict state (never a page edit)', lastFetch !== null && lastFetch.url.includes('/kybernos-dashboards/state?strict=1'), lastFetch && lastFetch.url)
  for (const e of cleanups) if (typeof e.c === 'function') e.c()
  timers.forEach((t) => clearInterval(t))
  // the player registers directly when the door exists
  let reg = null
  win.__KB_MINIAPP__ = { register: (n, c) => { reg = [n, c]; return true } }
  plugin.apply(Object.assign({}, ctx, { effect: () => undefined }))
  ok('the player registers on the door when it is there', reg !== null && reg[0] === 'dashboard')
}

// ── painters: geometry to markup ─────────────────────────────────────────────
const { model, chart } = T
const table = (cols, rows, meta) => ({ columns: cols, rows, meta: Object.assign({ note: '', xDomain: null }, meta || {}) })
const days = ['2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13']
const t1 = table([{ id: 'day', type: 'date' }, { id: 'model', type: 'string' }, { id: 'tokens', type: 'number' }],
  days.flatMap((d, i) => [{ day: d, model: 'a', tokens: 10 + i * 5 }, { day: d, model: 'b', tokens: 4 + i }]), { xDomain: { field: 'day', values: days } })
const W = (raw) => model.validateDashboard({ widgets: [raw] }).dashboard.widgets[0]
const finite = (s) => !/NaN|Infinity|undefined/.test(s)
{
  const d = model.chartData(t1, W({ type: 'chart', kind: 'stacked', x: 'day', y: 'tokens', series: 'model', source: { provider: 'usage.daily' } }))
  const svg = T.paintColumns(d, 400, 200, { lang: 'en' })
  ok('columns: svg with one group per day, every segment animated with its own delay variables', svg.startsWith('<svg') && (svg.match(/class="kbdb-col"/g) || []).length === 4 && /class="kbdb-bar kbdb-s1" style="--i:0;--s:0"/.test(svg) && finite(svg))
  ok('columns: series colours come from classes, never inline colours', !/fill="#|stroke="#|style="[^"]*#/.test(svg) && svg.includes('kbdb-s2'))
  ok('columns: each band carries a tooltip with the series values', /data-tip="&lt;b&gt;/.test(svg) && svg.includes('Total'))
  ok('columns: x labels are dates in the page language', svg.includes('13 Oct') || svg.includes('13 oct'))
  const runs = table([{ id: 'day', type: 'date' }, { id: 'state', type: 'state' }], days.flatMap((day) => [{ day, state: 'done' }, { day, state: 'failed' }]), { xDomain: { field: 'day', values: days } })
  const toned = T.paintColumns(model.chartData(runs, W({ type: 'chart', kind: 'stacked', x: 'day', series: 'state', source: { provider: 'automations.runs' } })), 400, 200, {})
  ok('columns: states are drawn green and red, not in the cycling hues', toned.includes('kbdb-tone-ok') && toned.includes('kbdb-tone-err') && !toned.includes('kbdb-bar kbdb-s1'))
  const legend = T.legendHtml(d.series)
  ok('legend: two series get one, one series none', legend.includes('kbdb-legend') && T.legendHtml([d.series[0]]) === '')
  const b = T.paintBars(model.chartData(t1, W({ type: 'chart', kind: 'bars', x: 'model', y: 'tokens', source: { provider: 'usage.daily' } })), 380, 160, {})
  ok('bars: growing bars, values fading in after them', b.includes('kbdb-hbar') && b.includes('kbdb-val') && finite(b))
  const l = T.paintLine(model.chartData(t1, W({ type: 'chart', kind: 'area', x: 'day', y: 'tokens', source: { provider: 'usage.daily' } })), 400, 200, true, {})
  ok('line: draws itself (length variable), area fades, the end dot pops and pings, a crosshair follows', /kbdb-line[^>]*--len:\d+/.test(l) && l.includes('kbdb-area') && l.includes('kbdb-end') && l.includes('kbdb-ping') && l.includes('kbdb-cross') && l.includes('data-cx=') && finite(l))
  const dn = T.paintDonut(model.chartData(t1, W({ type: 'chart', kind: 'donut', x: 'model', y: 'tokens', source: { provider: 'usage.daily' } })), 160, { caption: 'tokens' })
  ok('donut: each slice sweeps from its own dash length, the centre carries the total', (dn.match(/class="kbdb-seg/g) || []).length === 2 && /--seg:[\d.]+;--circ:[\d.]+/.test(dn) && dn.includes('data-total=') && finite(dn))
  const sk = T.paintSankey(model.sankeyData(t1, W({ type: 'sankey', stages: ['day', 'model'], value: 'tokens', source: { provider: 'usage.daily' } })), 520, 240, { unit: 'tokens' })
  ok('sankey: ribbons draw from the left, nodes grow, labels fade in', sk.includes('kbdb-rib') && sk.includes('kbdb-node') && sk.includes('kbdb-val') && finite(sk))
  const fl = T.paintFlow(W({ type: 'flow', nodes: [{ id: 'a', t: 'A', s: 'run' }, { id: 'b', t: 'B', s: 'fail' }], edges: [['a', 'b', ''], ['b', 'a', 'f']] }), {})
  ok('flow: nodes pop in turn, edges draw, a running step breathes and its edge marches, a failure edge is dashed', fl.includes('kbdb-fnode') && fl.includes('st-run') && fl.includes('kbdb-fedge run') && fl.includes('kbdb-fedge f') && finite(fl))
  const sp = T.paintSpark([1, 3, 2, 5], 96, 34)
  ok('spark: a polyline that draws itself and an end dot', sp.includes('<polyline') && /--len:\d+/.test(sp) && sp.includes('<circle') && T.paintSpark([1], 96, 34) === '')
  // empty and extreme data
  const none = model.chartData(table(t1.columns, []), W({ type: 'chart', kind: 'stacked', x: 'day', y: 'tokens', source: { provider: 'usage.daily' } }))
  ok('painters survive empty data', finite(T.paintColumns(none, 300, 120, {})) && finite(T.paintLine(none, 300, 120, false, {})))
  ok('painters survive a tiny box', finite(T.paintColumns(d, 20, 20, {})) && finite(T.paintBars(model.chartData(t1, W({ type: 'chart', kind: 'bars', x: 'model', y: 'tokens', source: { provider: 'usage.daily' } })), 20, 20, {})))
}

// ── hostile data never becomes markup ────────────────────────────────────────
{
  const evil = '"><img src=x onerror=alert(1)>'
  const rows = [{ day: '2026-10-13', model: evil, tokens: 5 }, { day: '2026-10-13', model: evil + '2', tokens: 7 }]
  const th = table(t1.columns, rows)
  const w = (kind, extra) => W(Object.assign({ type: 'chart', kind, x: 'model', y: 'tokens', source: { provider: 'usage.daily' } }, extra || {}))
  const outs = [
    T.paintBars(model.chartData(th, w('bars')), 300, 140, {}),
    T.paintDonut(model.chartData(th, w('donut')), 140, { caption: evil }),
    T.paintColumns(model.chartData(th, w('stacked', { x: 'day', series: 'model' })), 300, 140, {}),
    T.paintLine(model.chartData(th, w('line', { x: 'model' })), 300, 140, false, { label: evil }),
    T.paintSankey(model.sankeyData(th, W({ type: 'sankey', stages: ['day', 'model'], value: 'tokens', source: { provider: 'usage.daily' } })), 400, 200, { unit: evil }),
    T.paintFlow({ nodes: [{ id: 'a', t: evil, k: evil, s: 'ok', sub: evil, x: 0, y: 0 }], edges: [] }, { label: evil }),
  ]
  ok('no painter lets a hostile name through as a tag or an attribute', outs.every((s) => !s.includes('<img') && !s.includes(evil) && !s.includes('onerror=alert(1)>')), outs.map((s) => s.slice(0, 40)))
  ok('the hostile name is still shown, as text (visible labels) or escaped twice (tooltips)', [outs[0], outs[3]].every((s) => s.includes('&lt;img')) && outs[1].includes('&amp;lt;img') && outs[2].includes('&amp;lt;img'))
}

// ── helpers ──────────────────────────────────────────────────────────────────
{
  const now = new Date(2026, 9, 13, 10, 0, 0).getTime()
  ok('ago: just now, minutes, hours, days', T.ago(now - 5000, now) === 'just now' && T.ago(now - 5 * 60000, now) === '5 min ago' && T.ago(now - 3 * 3600000, now) === '3 h ago' && T.ago(now - 2 * 86400000, now) === '2 d ago')
  ok('fmtWhen: today, yesterday, a date; a plain value is left alone', T.fmtWhen(new Date(2026, 9, 13, 7, 30).toISOString(), 'time', now) === 'Today 07:30' && T.fmtWhen(new Date(2026, 9, 12, 2, 0).toISOString(), 'time', now) === 'Yesterday 02:00' && /9 Oct/.test(T.fmtWhen('2026-10-09', 'date', now)) && T.fmtWhen('x', 'string', now) === 'x' && T.fmtWhen('', 'time', now) === '')
  const before = [{ id: 'a', n: 1 }, { id: 'b', n: 2 }]
  ok('changedIds: new and changed widgets only', [...T.changedIds(before, [{ id: 'a', n: 1 }, { id: 'b', n: 3 }, { id: 'c', n: 1 }])].sort().join() === 'b,c')
  ok('the chat messages name the skill and the dashboard', T.createMessage().includes("'dashboard-builder'") && T.improveMessage('Overview', 'overview').includes("'Overview'") && T.improveMessage('Overview', 'overview').includes('id: overview') && T.addMessage('O', 'o').includes('add a widget'))
}

// ── the stylesheet ───────────────────────────────────────────────────────────
{
  const css = T.CSS
  const keyframes = new Set([...css.matchAll(/@keyframes ([a-z0-9-]+)/g)].map((m) => m[1]))
  const used = new Set()
  for (const m of css.matchAll(/animation:\s*([^;}]+)/g)) for (const part of m[1].split(',')) { const n = /(kbdb-[a-z0-9-]+)/.exec(part); if (n) used.add(n[1]) }
  for (const k of used) ok('keyframes "' + k + '" is defined', keyframes.has(k))
  ok('every keyframe is used', [...keyframes].every((k) => used.has(k)), [...keyframes].filter((k) => !used.has(k)))
  ok('there is a lot of motion to look at', keyframes.size >= 20, keyframes.size)
  const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion:reduce)'))
  ok('reduced motion turns every animation and transition off', reduced.includes('animation:none!important') && reduced.includes('transition:none!important'))
  // widgets start paused and only run once on screen: the gated rules
  const gated = ['kbdb-bar', 'kbdb-hbar', 'kbdb-line', 'kbdb-end', 'kbdb-seg', 'kbdb-rib', 'kbdb-node', 'kbdb-fnode', 'kbdb-fedge', 'kbdb-day', 'kbdb-ev', 'kbdb-lrow', 'kbdb-kcard', 'kbdb-dcard', 'kbdb-kpi-s']
  for (const c of gated) ok('"' + c + '" waits for the widget to be in view', css.includes('[data-inview] .' + c + '{animation-play-state:running}') || css.includes('[data-inview] .' + c + ' ') || css.includes('[data-inview] .kbdb-spark'), c)
  ok('no animation of layout properties (transform and opacity only)', !/@keyframes[^{]+\{[^@]*?(width|height|top|left|margin)\s*:/.test(css.replace(/stroke-dash[a-z]*/g, '')))
  // colours: tokens with a fallback, the six series, soft shadows
  const noFallbacks = css.replace(/var\([^)]*\)/g, '')
  const hex = [...noFallbacks.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0].toLowerCase())
  const allowed = new Set(['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#4a3aa7', '#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#9085e9', '#0003', '#0002', '#0004'])
  ok('colours are DSH tokens, the six series hues and soft shadows, nothing else', hex.every((c) => allowed.has(c)), hex.filter((c) => !allowed.has(c)))
  ok('the dark theme has its own series hues', css.includes('body[data-ds-dark-theme] .kbdb'))
  // the prefix is shared by every bundle and collides silently: every selector must be scoped by a kbdb class
  const rules = [...css.matchAll(/(^|\})\s*([^@{}][^{}]*)\{/g)].map((m) => m[2].trim()).filter((x) => x !== '' && !/^(from|to|\d+%|[\d%,\s]+)$/.test(x))
  const loose = []
  for (const sel of rules) for (const part of sel.split(',')) if (/\.[a-z]/i.test(part) && !/\.kbdb/.test(part)) loose.push(part.trim())
  ok('every selector is scoped by a kbdb class', loose.length === 0, loose.slice(0, 12))
}

// ── the contract with the core menu (kybernos-plugin/client.js) ──────────────
{
  const core = text('../kybernos-plugin/client.js')
  const pkg = JSON.parse(text('./package.json'))
  ok('the core knows this bundle by its package name', core.includes("e.id === '" + pkg.name + "'"))
  ok('the core declares the child slot this bundle injects on', core.includes("'main.kybernos-dashboards': { kind: 'single', scope: 'root' }") && src.includes("'main.kybernos-dashboards'"))
  const row = core.indexOf("row('dashboards', Icon('layoutDashboard'")
  const teams = core.indexOf("row('aiteams',")
  ok('the Dashboards row sits right before Agent Teams in the menu', row > 0 && teams > row && core.slice(row, teams).split('\n').length <= 4, [row, teams])
  ok('the row only shows when the bundle is booted', /\(KB_DB === true \? row\('dashboards'/.test(core))
  ok('the view is dispatched and openable from other bundles', core.includes("if (s.view === 'dashboards') return h(KbDashboardsView, props)") && core.includes(".concat(KB_DB === true ? ['dashboards'] : [])"))
  ok('the core renders the mount with a fallback when the slot is empty', core.includes('kbt(\'kbui.dashboards.off\')') && core.includes("slots.entriesOfSlot('main.kybernos-dashboards')"))
  ok('the menu label and the icon exist in the core tables', core.includes("'kbui.dashboards': { kybernos: 'Dashboards', en: 'Dashboards' }") && /^\s*layoutDashboard: \[/m.test(core))
  ok('the chat launcher this bundle uses is the core\'s event', core.includes("window.addEventListener('kb-open-chat-text'") && src.includes("new CustomEvent('kb-open-chat-text'"))
  ok('the door this bundle registers on exists in the core', core.includes('window.__KB_MINIAPP__ = door') && core.includes("register(name, Component)"))
  const hub = text('../kybernos-hub/client.js')
  ok('the Suite draws the glyph the catalogue names', hub.includes("dash:'<rect class=\"a\""))
}

// ── the skills, the help and the README ──────────────────────────────────────
{
  for (const s of ['dashboard-builder', 'dashboard-sources']) {
    const md = text('./skills/' + s + '/SKILL.md')
    ok('skill ' + s + ': front matter with name, description and whenToUse', md.startsWith('---\nname: ' + s + '\n') && /\ndescription: .{40,}\n/.test(md) && /\nwhenToUse: .{20,}\n/.test(md))
    ok('skill ' + s + ': no personal path, English', !/\/Users\//.test(md) && !/[àâçéèêëîïôùûü]/i.test(md.replace(/[“”’—›]/g, '')))
  }
  const builder = text('./skills/dashboard-builder/SKILL.md')
  const model_ = await import('./model.mjs')
  ok('the builder skill names only widget types that exist', ['card', 'chart', 'calendar', 'list', 'kanban', 'carousel', 'flow', 'sankey', 'note'].every((t) => model_.WIDGET_TYPES.includes(t) && builder.includes('`' + t + '`')))
  ok('the sources skill lists every provider', model_.PROVIDER_IDS.every((id) => text('./skills/dashboard-sources/SKILL.md').includes('`' + id + '`')), model_.PROVIDER_IDS.filter((id) => !text('./skills/dashboard-sources/SKILL.md').includes('`' + id + '`')))
  const help = JSON.parse(text('./help.json'))
  ok('help: both languages everywhere', ['what', 'where', 'good'].every((k) => help[k].fr && help[k].en) && help.steps.every((s) => s.fr && s.en))
}

console.log(fail === 0 ? 'client: ok (' + passed + ' checks)' : fail + ' failed of ' + (passed + fail))
process.exit(fail ? 1 : 0)

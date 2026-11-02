// The browser half: contract (plugin object, slot ids, strings in both languages, tokens not colours) and the pure
// helpers behind the numbers. Runs without DSH and without a browser: client.js is evaluated against a stub loader.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

let fail = 0
const ok = (name, cond, detail) => { console.log((cond ? 'ok   ' : 'FAIL ') + name + (cond ? '' : '  ' + (detail || ''))); if (!cond) fail++ }
const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(here, 'client.js'), 'utf8')

// ── a stub loader + a React that only builds plain objects ──────────────────────────────────────────────────────
let captured = null
const posts = []
globalThis.window = { __ModuleLoader__: { load: (m) => { captured = m } }, __KB_LANG_RESOLVE__: () => 'fr', addEventListener () {}, removeEventListener () {} }
globalThis.document = { documentElement: { lang: 'fr' }, querySelector: () => null, head: { appendChild () {} }, createElement: () => ({ setAttribute () {} }) }
globalThis.fetch = (url, init) => { posts.push({ url, init }); return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) }) }
const React = { createElement: (type, props, ...kids) => ({ type, props, kids }), useState: (v) => [v, () => {}], useEffect () {}, useRef: (v) => ({ current: v }), useMemo: (f) => f(), useCallback: (f) => f }
await import('data:text/javascript,' + encodeURIComponent('/* load */'))
// eslint-disable-next-line no-new-func
new Function(src)()
ok('registers one module with the loader', captured !== null && captured.id === '@local/kybernos-usage')
const plugin = captured.factory((name) => (name === 'react' ? React : undefined))
ok('factory returns a plugin object with apply and inject', plugin !== undefined && typeof plugin.apply === 'function' && Array.isArray(plugin.inject) && plugin.inject.includes('slots'))
const T = plugin.__test

// ── slots ───────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const regs = []
  const ctx = { effect: (fn) => fn(), slots: { inject: (name, fn) => fn(), register: (meta, comp) => { regs.push({ meta, comp }) } } }
  plugin.apply(ctx)
  const dock = regs.find((r) => r.meta.name === 'conversation.composer.dock')
  const sec = regs.find((r) => r.meta.name === 'settings.section')
  ok('a chip in the composer dock', dock !== undefined && dock.meta.id === 'kybernos-usage-chip')
  ok('the dock id does not collide with the core usage probe', dock.meta.id !== 'kybernos-usage')
  ok('a Settings page', sec !== undefined && sec.meta.id === 'kybernos-usage' && sec.meta.label === 'Usage')
  ok('the dock component never throws on odd props', (() => { try { dock.comp(null); dock.comp({}); return true } catch (e) { return false } })())
}

// ── strings: both languages, same placeholders ─────────────────────────────────────────────────────────────────
{
  const keys = Object.keys(T.S)
  ok('there are strings', keys.length > 40)
  const holes = (t) => (t.match(/\{\w+\}/g) || []).sort().join()
  const bad = keys.filter((k) => !Array.isArray(T.S[k]) || T.S[k].length !== 2 || T.S[k][0].trim() === '' || T.S[k][1].trim() === '' || holes(T.S[k][0]) !== holes(T.S[k][1]))
  ok('every string has a French and an English side with the same placeholders', bad.length === 0, bad.join(','))
  const used = new Set([...src.matchAll(/L\(\s*'([A-Za-z0-9]+)'/g)].map((m) => m[1]))
  ok('no string is used without being defined', [...used].every((k) => keys.includes(k)), [...used].filter((k) => !keys.includes(k)).join(','))
  ok('no string is defined without being used', keys.every((k) => used.has(k)), keys.filter((k) => !used.has(k)).join(','))
}

// ── styles: tokens, not colours ─────────────────────────────────────────────────────────────────────────────────
{
  const noVars = T.CSS.replace(/var\([^()]*(\([^()]*\))?[^()]*\)/g, '')
  const hex = (noVars.match(/#[0-9a-fA-F]{3,8}\b/g) || []).filter((c) => c.toLowerCase() !== '#fff')
  ok('colours come from DSH tokens (only fallbacks inside var() and the switch knob)', hex.length === 0, hex.join(','))
  ok('the prefix is private', /\.kbus-/.test(T.CSS) && !/\.(kb|kbm|kbs)-/.test(T.CSS))
  ok('motion respects reduced-motion', /prefers-reduced-motion/.test(T.CSS))
}
ok('stable test hooks exist', ['kybernos-usage-pill', 'kybernos-usage-card', 'kybernos-usage-page', 'kybernos-usage-plan', 'kybernos-usage-budget'].every((k) => src.includes("'" + k + "'")))

// ── helpers ─────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const NB = ' '
  ok('money, French', T.fmtMoney(0.4783) === '0,48' + NB + '$')
  ok('money below a cent', T.fmtMoney(0.004) === '<0,01' + NB + '$')
  ok('money rejects junk', T.fmtMoney(NaN) === '—' && T.fmtMoney('x') === '—')
  // F23: the unit follows the locale — « 5,64 $ » in French, « $5.64 » in English.
  {
    const prev = globalThis.window.__KB_LANG_RESOLVE__
    globalThis.window.__KB_LANG_RESOLVE__ = () => 'en'
    ok('money, English: unit before the amount', T.fmtMoney(5.64) === '$5.64', T.fmtMoney(5.64))
    globalThis.window.__KB_LANG_RESOLVE__ = prev
  }
  ok('tokens', T.fmtTok(240000) === '240' + NB + 'k' && T.fmtTok(3400000) === '3,4' + NB + 'M' && T.fmtTok(512) === '512')
  ok('percent', T.fmtPct(0.376) === '38' + NB + '%')
  ok('price from a models.dev match', JSON.stringify(T.priceOf({ costIn: '0.6', costOut: '2.4', cacheRead: '0.06', cacheWrite: '' })) === JSON.stringify({ in: 0.6, out: 2.4, cr: 0.06, cw: null }))
  ok('no price when the match is empty', T.priceOf(null) === null && T.priceOf({ costIn: '', costOut: '' }) === null)
  const p = { in: 0.6, out: 2.4, cr: 0.06, cw: null }
  ok('cost: four counters, cache write falls back to the input rate', Math.abs(T.costOf({ u: 1e6, o: 1e6, cr: 1e6, cw: 1e6 }, p) - (0.6 + 2.4 + 0.06 + 0.6)) < 1e-9)
  ok('saved by the cache', Math.abs(T.saved({ u: 0, o: 0, cr: 1e6, cw: 0 }, p) - 0.54) < 1e-9)
  ok('kinds', T.kindOf('kybernos/deepseek-pro', null) === 'plan' && T.kindOf('ollama/qwen', null) === 'free' && T.kindOf('opencode-free/glm', null) === 'free'
    && T.kindOf('deepseek/pro', p) === 'priced' && T.kindOf('acme/x', null) === 'unknown' && T.kindOf('acme/free', { in: 0, out: 0, cr: null, cw: null }) === 'free')
  ok('provider split', JSON.stringify(T.splitKey('deepseek/deepseek-v4/pro')) === JSON.stringify({ provider: 'deepseek', model: 'deepseek-v4/pro' }) && T.splitKey('solo').provider === '')
}
{ // aggregate: plan never priced, unknown counted apart, cache share leaves the plan out
  const price = { in: 0.6, out: 2.4, cr: 0.06, cw: null }
  const summary = {
    models: { 'deepseek/pro': { u: 1e6, o: 1e6, cr: 9e6, cw: 0 }, 'kybernos/pro': { u: 5e6, o: 1e6, cr: 5e6, cw: 0 }, 'acme/mystery': { u: 2e5, o: 1e5, cr: 0, cw: 0 }, 'ollama/qwen': { u: 3e5, o: 1e5, cr: 0, cw: 0 } },
    daily: [{ day: '2026-10-11', models: { 'deepseek/pro': { u: 1e6, o: 0, cr: 0, cw: 0 } } }, { day: '2026-10-12', models: { 'deepseek/pro': { u: 0, o: 1e6, cr: 9e6, cw: 0 }, 'kybernos/pro': { u: 5e6, o: 0, cr: 0, cw: 0 } } }],
  }
  const a = T.aggregate(summary, { 'deepseek/pro': price, 'kybernos/pro': null, 'acme/mystery': null, 'ollama/qwen': null })
  ok('aggregate: only priced models are in the cost', Math.abs(a.cost - (0.6 + 2.4 + 9 * 0.06)) < 1e-9, String(a.cost))
  ok('aggregate: unknown tokens counted apart', a.unknownTokens === 3e5)
  ok('aggregate: own tokens exclude the plan', a.ownTokens === (1e6 + 1e6 + 9e6) + 3e5 + (3e5 + 1e5), String(a.ownTokens))
  ok('aggregate: cache share ignores the plan', Math.abs(a.cacheShare - 9e6 / (1e6 + 9e6 + 2e5 + 3e5 + 0)) < 0.03, String(a.cacheShare))
  ok('aggregate: daily cost and peak', a.daily.length === 2 && Math.abs(a.daily[0].cost - 0.6) < 1e-9 && Math.abs(a.peak - (2.4 + 0.54)) < 1e-9)
  ok('aggregate: rows say what each one is', a.rows.find((r) => r.key === 'kybernos/pro').kind === 'plan' && a.rows.find((r) => r.key === 'acme/mystery').kind === 'unknown' && a.rows.find((r) => r.key === 'ollama/qwen').kind === 'free')
  ok('aggregate survives junk', T.aggregate(null, {}).cost === 0 && T.aggregate({}, {}).rows.length === 0)
  const sc = T.sessionCost({ 'deepseek/pro': { u: 1e6, o: 0, cr: 0, cw: 0 }, 'acme/mystery': { u: 1000, o: 0, cr: 0, cw: 0 } }, { 'deepseek/pro': price })
  ok('session cost counts unknown apart', Math.abs(sc.cost - 0.6) < 1e-9 && sc.unknown === 1000)
}
{ // plan windows as the server gives them: percent always, a reset time only once used up
  const w = T.windowView({ kind: 'member', window_seconds: 18000, used_percent: 38, exhausted: false, resets_at: null }, null)
  ok('window: 5 h, 38 %, no reset time', w.label.includes('5') && w.pct === 38 && w.back === null)
  const x = T.windowView({ kind: 'member', window_seconds: 18000, used_percent: 100, exhausted: true, resets_at: '2026-10-12T11:40:00.000Z' }, '2026-10-12T10:00:00.000Z')
  ok('window: used up tells when it frees up, on the server clock', x.back === '1 h 40', String(x.back))
  ok('window: 30 days', T.windowView({ kind: 'member', window_seconds: 2592000, used_percent: 21, exhausted: false }, null).label === '30 jours')

  // windowDays1 branch: singular for exactly one day, plural otherwise. The
  // L() calls in windowView use string literals (the used-string regex
  // /L\(\s*'([A-Za-z0-9]+)'/g requires them) so both sides stay reachable.
  const w1 = T.windowView({ kind: 'member', window_seconds: 86400, used_percent: 50, exhausted: false }, null)
  ok('window: 86400 s -> singular French day label', w1.label === '1 jour', String(w1.label))
  const w2 = T.windowView({ kind: 'member', window_seconds: 172800, used_percent: 50, exhausted: false }, null)
  ok('window: 172800 s -> plural French days label', w2.label === '2 jours', String(w2.label))
  ok('windowDays1 English singular', T.L('windowDays1', { n: 1 }) === '1 day' || T.L('windowDays1', { n: 1 }) === '1 jour', T.L('windowDays1', { n: 1 }))
  ok('windowDays English plural', T.L('windowDays', { n: 2 }) === '2 days' || T.L('windowDays', { n: 2 }) === '2 jours', T.L('windowDays', { n: 2 }))
  ok('windowDays1 pair: fr singular, en singular', T.S.windowDays1[0] === '{n} jour' && T.S.windowDays1[1] === '{n} day', JSON.stringify(T.S.windowDays1))
  ok('windowDays pair: fr plural, en plural', T.S.windowDays[0] === '{n} jours' && T.S.windowDays[1] === '{n} days', JSON.stringify(T.S.windowDays))
  ok('window: team pool is named', T.windowView({ kind: 'pool', window_seconds: 2592000, used_percent: 47 }, null).label.startsWith('Équipe'))
  ok('window: junk is dropped', T.windowView(null, null) === null && T.windowView({ window_seconds: 'x' }, null) === null)
  ok('window: percent is clamped', T.windowView({ kind: 'member', window_seconds: 3600, used_percent: 180 }, null).pct === 100)
  ok('tone', T.tone(10) === 'ok' && T.tone(80) === 'warn' && T.tone(100) === 'err')
}
{ // reporting: identical counters are posted once; a change inside the throttle is deferred
  posts.length = 0
  const u = { uncachedInputTokens: 10, outputTokens: 2, cacheReadTokens: 100, cacheWriteTokens: 0 }
  const m = { provider: 'deepseek', model: 'pro' }
  T.reportOne('sess-a', u, m, 'Title')
  T.reportOne('sess-a', u, m, 'Title')
  await new Promise((r) => setTimeout(r, 5))
  ok('same counters: one post', posts.length === 1 && posts[0].url === '/kybernos-usage/observe', String(posts.length))
  const body = JSON.parse(posts[0].init.body)
  ok('the post carries the session, the route and the counters', body.sessionId === 'sess-a' && body.provider === 'deepseek' && body.model === 'pro' && body.usage.cacheReadTokens === 100)
  T.reportOne('sess-a', { ...u, outputTokens: 50 }, m, 'Title')
  await new Promise((r) => setTimeout(r, 5))
  ok('a change inside the throttle window is deferred, not lost', posts.length === 1)
}

// ── the page says what it is for (V-31) and carries the shared « ? How it works » button (A5-19) ─────────────────────────────
{
  const regs = []
  plugin.apply({ effect: (fn) => fn(), slots: { inject: (name, fn) => fn(), register: (meta, comp) => { regs.push({ meta, comp }) } } })
  const page = regs.find((r) => r.meta.name === 'settings.section')
  const Help = function Help () { return null }
  const draw = (lang, hub) => {
    globalThis.window.__KB_LANG_RESOLVE__ = () => lang
    if (hub === undefined) delete globalThis.window.__KB_HELP__; else globalThis.window.__KB_HELP__ = hub
    const el = page.comp()
    return typeof el.type === 'function' ? el.type(el.props) : el
  }
  const find = (node, test, out = []) => {
    if (node === null || typeof node !== 'object') return out
    if (test(node)) out.push(node)
    const kids = node.kids || []
    for (const c of Array.isArray(kids) ? kids.flat() : [kids]) find(c, test, out)
    return out
  }
  const text = (n) => (n === null || n === undefined ? '' : typeof n !== 'object' ? String(n) : (n.kids || []).flat().map(text).join(' '))
  const en = draw('en', { version: 1, Help })
  const forEn = find(en, (n) => n.props && /\bkbus-for\b/.test(n.props.className)).map(text).join(' ')
  ok('a line says what the page covers: every model used here, in two kinds', /every model/i.test(forEn) && /Kybernos plan/i.test(forEn) && /key of your own/i.test(forEn) && /local model/i.test(forEn), forEn)
  ok('…and how it differs from the console: the per-member and per-day detail of the plan stays there', /console/i.test(forEn) && /per member|by member/i.test(forEn) && /per day|by day/i.test(forEn), forEn)
  const fr = draw('kybernos', { version: 1, Help })
  const forFr = find(fr, (n) => n.props && /\bkbus-for\b/.test(n.props.className)).map(text).join(' ')
  ok('the French twin says the same, with « console »', /tous les modèles/i.test(forFr) && /console Kybernos/i.test(forFr), forFr)
  ok('the page carries the Suite’s button, once, for this bundle', find(en, (n) => n.type === Help).length === 1 && find(en, (n) => n.type === Help)[0].props.id === 'kybernos-usage')
  ok('without the Suite there is no button and the page still draws', (() => { const t = draw('en'); return t !== null && find(t, (n) => n.type === Help).length === 0 && find(t, (n) => n.props && /\bkbus-for\b/.test(n.props.className)).length === 1 })())
}
// WP-07 (A2-25): the French of the page speaks « tu », like the first-run wizard.
{
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')
  ok('no « vous », « votre », « vos » in the page', !/(?<![A-Za-zÀ-ÿ])(vous|votre|vos)(?![A-Za-zÀ-ÿ])/i.test(code))
  const help = JSON.parse(readFileSync(join(here, 'help.json'), 'utf8'))
  const frs = [help.what.fr, ...help.steps.map((x) => x.fr), help.good && help.good.fr].filter(Boolean)
  ok('…nor in the French help', frs.length >= 4 && !frs.some((t) => /(?<![A-Za-zÀ-ÿ])(vous|votre|vos)(?![A-Za-zÀ-ÿ])/i.test(t) || /(?<![A-Za-zÀ-ÿ])(?!chez|assez)[a-zà-ÿ]{3,}ez(?![A-Za-zÀ-ÿ])/i.test(t)))
}
process.exit(fail ? 1 : 0)

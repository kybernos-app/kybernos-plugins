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
  const strip = regs.find((r) => r.meta.id === 'kybernos-usage-limit')
  ok('a limit strip in the composer dock, after the chip and the other bundles\' pills', strip !== undefined && strip.meta.name === 'conversation.composer.dock' && strip.meta.order > dock.meta.order && strip.meta.order >= 99)
  ok('the strip component never throws on odd props', (() => { try { strip.comp(null); strip.comp({}); return true } catch (e) { return false } })())
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
ok('stable test hooks exist', ['kybernos-usage-pill', 'kybernos-usage-card', 'kybernos-usage-page', 'kybernos-usage-plan', 'kybernos-usage-budget', 'limit-strip', 'limit-plans', 'limit-hide', 'limit-upgrade', 'limit-own', 'limit-ask'].every((k) => src.includes("'" + k + "'")))

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
  ok('tone: amber from 75 %, red at 100 %', T.tone(10) === 'ok' && T.tone(74) === 'ok' && T.tone(75) === 'warn' && T.tone(80) === 'warn' && T.tone(100) === 'err' && T.LIMIT_NEAR === 75)
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

// ── L5-01: the lines under the title add up to the title ───────────────────────────────────────────────────────────────────
// The title and the cost count the tokens written to the cache (`tsum`, `costOf`); the card listed three lines and a three-segment bar,
// so as soon as `cw > 0` the lines no longer made the total and a person checking the counter could not redo it.
{
  const prevLang = globalThis.window.__KB_LANG_RESOLVE__
  globalThis.window.__KB_LANG_RESOLVE__ = () => 'en'
  const find = (node, test, out = []) => {
    if (node === null || typeof node !== 'object') return out
    if (test(node)) out.push(node)
    const kids = node.kids || []
    for (const c of Array.isArray(kids) ? kids.flat() : [kids]) find(c, test, out)
    return out
  }
  const text = (n) => (n === null || n === undefined || n === false ? '' : typeof n !== 'object' ? String(n) : (n.kids || []).flat().map(text).join(' '))
  const price = { in: 3, out: 15, cr: 0.3, cw: 3.75 }
  const card = (tokens, p = price) => T.OwnBlock({ key: 'acme/pro', kind: 'priced', tokens, price: p, month: null })
  const rows = (el) => find(el, (n) => n.type === 'li').map((li) => { const cells = find(li, (n) => n.type === 'span' && !(n.props && n.props.className === 'd')).map(text); return { label: cells[0], tokens: cells[1], cost: cells[2] } })
  const segments = (el) => find(el, (n) => n.props && n.props.className === 'kbus-split').flatMap((n) => find(n, (k) => k.type === 'i'))

  const without = { u: 1e6, cr: 2e6, cw: 0, o: 1e5 }
  const r3 = rows(card(without))
  ok('no cache write: the three lines stay three (New input, Cache read, Output)', r3.map((r) => r.label).join('|') === 'New input|Cache read|Output', r3.map((r) => r.label).join('|'))
  ok('no cache write: the bar keeps its three segments', segments(card(without)).length === 3, String(segments(card(without)).length))

  const withCw = { u: 1e6, cr: 2e6, cw: 1e6, o: 1e5 }
  const el = card(withCw)
  const r4 = rows(el)
  ok('with a cache write: a fourth line, in the order the bar draws', r4.map((r) => r.label).join('|') === 'New input|Cache read|Cache write|Output', r4.map((r) => r.label).join('|'))
  ok('...and a fourth segment in the bar', segments(el).length === 4, String(segments(el).length))
  const want = [withCw.u, withCw.cr, withCw.cw, withCw.o]
  ok('the token column lists the four counters', r4.every((r, i) => r.tokens === T.fmtTok(want[i])), JSON.stringify(r4.map((r) => r.tokens)))
  const parts = [withCw.u * price.in, withCw.cr * price.cr, withCw.cw * price.cw, withCw.o * price.out].map((v) => v / 1e6)
  ok('the cost column prices each line (cache write at the cache-write rate)', r4.every((r, i) => r.cost === T.fmtMoney(parts[i])), JSON.stringify(r4.map((r) => r.cost)))
  ok('the four lines make the title: tokens add up to the total and costs to costOf',
    want.reduce((a, b) => a + b, 0) === 4.1e6 && Math.abs(parts.reduce((a, b) => a + b, 0) - T.costOf(withCw, price)) < 1e-9)
  ok('the title is that cost', text(el).includes(T.fmtMoney(T.costOf(withCw, price))), text(el).slice(0, 80))
  const noRate = card(withCw, { ...price, cw: null })
  ok('a model with no cache-write rate prices the written tokens at the input rate, like costOf', rows(noRate)[2].cost === T.fmtMoney(withCw.cw * price.in / 1e6), rows(noRate)[2].cost)
  // The share read from the cache is a share of ALL input tokens (new + read + written): 1M read of 4M = 25 %, not 50 %.
  const share = card({ u: 1e6, cr: 1e6, cw: 2e6, o: 0 })
  ok('the cache share counts the written tokens too (1M read out of 4M input = 25 %)', text(share).includes(T.fmtPct(0.25)) && !text(share).includes(T.fmtPct(0.5)), text(share).slice(0, 140))
  globalThis.window.__KB_LANG_RESOLVE__ = prevLang
}

// ── L5-06: the store signature moves when ANY counter moves ────────────────────────────────────────────────────────────────────
// It decides the re-render and the report; reportOne compares four counters, the signature compared three, so an update where only the
// cache write advanced was neither drawn nor sent (the delta waited for the next update that moved something else).
{
  const store = (cw) => ({ byId: { 'session-abcd': { projectionValues: { tokenUsage: { uncachedInputTokens: 10, outputTokens: 2, cacheReadTokens: 100, cacheWriteTokens: cw } } } } })
  ok('the same counters give the same signature', T.storeSignature(store(5)) === T.storeSignature(store(5)))
  ok('only the cache write advancing changes the signature', T.storeSignature(store(5)) !== T.storeSignature(store(9)), T.storeSignature(store(5)))
  ok('a store with no counters, or junk, gives an empty signature without throwing', T.storeSignature({ byId: {} }) === '' && T.storeSignature(null) === '' && T.storeSignature({ byId: { x: null } }) === '')
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
  // The lead says HOW each kind is counted, the next line only WHAT the page covers: the how was said twice, in two paragraphs one under the other.
  ok('how each kind is counted is said once (the lead), not again in the line that says what the page covers', /server counts/.test(T.S.pageLead[1]) && /worked out/.test(T.S.pageLead[1]) && !/counted (by|on)/i.test(T.S.pageFor[1]) && /le serveur compte/i.test(T.S.pageLead[0]) && !/compté (par|sur)/i.test(T.S.pageFor[0]), JSON.stringify([T.S.pageLead[1], T.S.pageFor[1]]))
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

// ── the limit strip (mockup 1): thresholds, the window that counts, the next level, the cross, the drawing ───────────────────────────
{
  const prevLang = globalThis.window.__KB_LANG_RESOLVE__
  globalThis.window.__KB_LANG_RESOLVE__ = () => 'fr'
  const prevStorage = globalThis.window.localStorage
  const find = (node, test, out = []) => {
    if (node === null || typeof node !== 'object') return out
    if (test(node)) out.push(node)
    const kids = node.kids || []
    for (const c of Array.isArray(kids) ? kids.flat() : [kids]) find(c, test, out)
    return out
  }
  const text = (n) => (n === null || n === undefined || n === false ? '' : typeof n !== 'object' ? String(n) : (n.kids || []).flat().map(text).join(' '))
  const hook = (el, kb) => find(el, (n) => n.props && n.props['data-kb'] === kb)
  const NOW = Date.parse('2026-10-22T10:00:00.000Z')
  const server = new Date(NOW).toISOString()
  const view = (secs, pct, extra = {}) => T.windowView({ kind: 'member', window_seconds: secs, used_percent: pct, exhausted: false, resets_at: null, ...extra }, server)
  const usedUp = (secs, hours) => view(secs, 100, { exhausted: true, resets_at: new Date(NOW + hours * 3600000).toISOString() })

  // the windows as the strip reads them
  ok('window: short names for a sentence', view(18000, 10).short === '5 h' && view(86400, 10).short === '24 h' && view(604800, 10).short === '7 jours' && view(2592000, 10).short === '30 jours', [18000, 86400, 604800, 2592000].map((x) => view(x, 1).short).join('|'))
  ok('window: a used-up one carries its time of return on this computer\'s clock, the others none', (() => { const u = usedUp(18000, 3); return u.exhausted === true && Math.abs(u.backAt - (Date.now() + 3 * 3600000)) < 2000 && view(18000, 80).backAt === null })())

  // the window that counts
  const mixed = [view(18000, 40), view(86400, 90), view(604800, 90)]
  ok('binding: with none used up, the busiest, the longer one on a tie', T.bindingWindow(mixed).seconds === 604800 && T.bindingWindow([view(18000, 10)]).seconds === 18000)
  ok('binding: used-up windows beat a busier one, and the one that opens LAST counts', T.bindingWindow([view(18000, 99), usedUp(18000, 2), usedUp(86400, 9)]).seconds === 86400)
  ok('binding: nothing to read', T.bindingWindow([]) === null && T.bindingWindow(null) === null)

  // the three states
  const planOf = (windows, extra = {}) => ({ connected: true, name: 'Free', credits: null, blocked: false, noPlan: false, personal: true, role: 'owner', workspaceId: 'w1', spacePlan: { key: 'free', label: 'Free' }, windows, ...extra })
  ok('state: under 75 % there is nothing to say', T.limitState(planOf([view(18000, 74)])) === 'ok')
  ok('state: 75 % is near, 99 % too', T.limitState(planOf([view(18000, 75)])) === 'near' && T.limitState(planOf([view(18000, 99)])) === 'near')
  ok('state: out only when the server says the window is used up (100 % that a top-up still lets through is near)', T.limitState(planOf([usedUp(18000, 3)])) === 'out' && T.limitState(planOf([view(18000, 100)])) === 'near')
  ok('state: signed out, no plan, a blocked payment, no figure, junk: null (the footer and the notice speak for those)',
    T.limitState({ connected: false, windows: [] }) === null && T.limitState(planOf([view(18000, 90)], { noPlan: true })) === null && T.limitState(planOf([view(18000, 90)], { blocked: true })) === null
    && T.limitState(planOf([])) === null && T.limitState(null) === null && T.limitState(undefined) === null)

  // the time of return, in words
  {
    const at = (y, m, d, h, mi) => new Date(y, m, d, h, mi).getTime()
    const now = at(2026, 9, 22, 22, 0)
    globalThis.window.__KB_LANG_RESOLVE__ = () => 'fr'
    ok('clock, French: « 00 h 50 », today / tomorrow / another day', T.clockAt(at(2026, 9, 22, 23, 5), now).at === '23 h 05' && T.clockAt(at(2026, 9, 22, 23, 5), now).day === null
      && T.clockAt(at(2026, 9, 23, 0, 50), now).at === '00 h 50' && T.clockAt(at(2026, 9, 23, 0, 50), now).day === 'tomorrow'
      && T.clockAt(at(2026, 9, 26, 14, 0), now).day === new Date(2026, 9, 26).toLocaleDateString('fr-FR', { weekday: 'long' }))
    ok('sentence, French: today, tomorrow, another day, and nothing without a time', T.backSentence({ backAt: at(2026, 9, 22, 23, 5) }, now) === 'Retour à 23 h 05.'
      && T.backSentence({ backAt: at(2026, 9, 23, 0, 50) }, now) === 'Retour demain à 00 h 50.'
      && T.backSentence({ backAt: at(2026, 9, 26, 14, 0) }, now) === 'Retour ' + new Date(2026, 9, 26).toLocaleDateString('fr-FR', { weekday: 'long' }) + ' à 14 h 00.'
      && T.backSentence({ backAt: null }, now) === null && T.backSentence(null, now) === null)
    globalThis.window.__KB_LANG_RESOLVE__ = () => 'en'
    ok('sentence, English: a 12-hour clock', /^Back at 11:05\s?PM\.$/.test(T.backSentence({ backAt: at(2026, 9, 22, 23, 5) }, now)) && /^Back tomorrow at 12:50\s?AM\.$/.test(T.backSentence({ backAt: at(2026, 9, 23, 0, 50) }, now)), T.backSentence({ backAt: at(2026, 9, 23, 0, 50) }, now))
    globalThis.window.__KB_LANG_RESOLVE__ = prevLang
  }

  // the next level of the plan comes from the cloud bundle (`window.__KB_UPGRADE__.pitch()`, tested there); the strip only words it
  const plus = { name: 'Plus', key: 'solo', price: '19 $', monthPrice: '24 $', yearly: true, times: 20, credits: 20000, fromCredits: 1000, alwaysOn: true, amount: 19, monthAmount: 24, currency: 'USD' }
  {
    delete globalThis.window.__KB_UPGRADE__
    T.pitchStore.value = undefined
    ok('no cloud bundle: no offer, nothing throws', (() => { try { T.LimitStrip({ useProjection: () => undefined }); return true } catch (e) { return false } })())
  }

  // the cross: hidden until the window has room again
  {
    const store = {}
    globalThis.window.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v) } }
    ok('cross: not hidden to start with', T.isHidden(18000) === false)
    T.hide(18000)
    ok('cross: hidden for that window only, and kept in this browser', T.isHidden(18000) === true && T.isHidden(86400) === false && /18000/.test(store['kybernos-usage:limit-hidden'] || ''))
    T.forgetHidden([view(18000, 80), view(86400, 10)])
    ok('cross: a window still near keeps it', T.isHidden(18000) === true)
    T.forgetHidden([view(18000, 60)])
    ok('cross: the window gone back under 75 % earns its line back', T.isHidden(18000) === false && !/18000/.test(store['kybernos-usage:limit-hidden'] || ''))
    globalThis.window.localStorage = { getItem () { throw new Error('refused') }, setItem () { throw new Error('refused') } }
    T.hide(604800)
    ok('cross: storage refused, the memory copy still hides it', T.isHidden(604800) === true)
    T.forgetHidden([view(604800, 10)])
    ok('cross: …and forgets it', T.isHidden(604800) === false)
    globalThis.window.localStorage = prevStorage
  }

  // the drawing
  {
    globalThis.window.__KB_LANG_RESOLVE__ = () => 'fr'
    const onPlan = { useProjection: (k) => (k === 'modelSelection' ? { lastUsed: { provider: 'kybernos', model: 'glm' } } : undefined) }
    const ownKey = { useProjection: (k) => (k === 'modelSelection' ? { lastUsed: { provider: 'deepseek', model: 'pro' } } : undefined) }
    const draw = (props, plan, offer) => { T.planStore.value = plan; T.pitchStore.value = offer; return T.LimitStrip(props) }
    ok('strip: nothing before the plan is read, nothing under 75 %, nothing on a key of one\'s own', draw(onPlan, undefined, plus) === null && draw(onPlan, planOf([view(18000, 50)]), plus) === null && draw(ownKey, planOf([usedUp(18000, 3)]), plus) === null)

    const near = draw(onPlan, planOf([view(18000, 78), view(86400, 20)]), plus)
    const nearText = text(near).replace(/ /g, ' ')
    ok('strip, 75 % and over: one line that names the window and what the next level gives', near !== null && near.props['data-state'] === 'near' && nearText.includes('78 % de ta fenêtre de 5 h est utilisée.') && nearText.includes('Plus donne 20 fois plus.'), nearText)
    ok('strip, near: « See the plans » and a named cross', hook(near, 'limit-plans').length === 1 && hook(near, 'limit-plans')[0].kids.join('') === 'Voir les plans' && hook(near, 'limit-hide').length === 1 && /Masquer/.test(hook(near, 'limit-hide')[0].props['aria-label']))
    ok('strip, near: it is a polite status, not an alert', near.props.role === 'status')
    ok('strip, near, no offer yet: the line alone, no button that leads nowhere', hook(draw(onPlan, planOf([view(18000, 78)]), undefined), 'limit-plans').length === 0)
    ok('strip, near, top plan (the cloud bundle offers nothing): the line alone', hook(draw(onPlan, planOf([view(18000, 78)], { spacePlan: { key: 'studio', label: 'Pro' } }), null), 'limit-plans').length === 0)
    ok('strip, near, a member of a team: the line, nothing to buy', (() => { const e = draw(onPlan, planOf([view(18000, 78)], { personal: false, role: 'member' }), plus); return e !== null && hook(e, 'limit-plans').length === 0 && !/donne/.test(text(e)) })())
    T.hide(18000)
    ok('strip, near, after the cross: gone', draw(onPlan, planOf([view(18000, 78)]), plus) === null)
    T.forgetHidden([view(18000, 10)])

    const out = draw(onPlan, planOf([usedUp(18000, 3), view(86400, 60), view(604800, 20), view(2592000, 7)]), plus)
    const outText = text(out).replace(/ /g, ' ')
    ok('strip, used up: says which window and when it opens again', out !== null && out.props['data-state'] === 'out' && outText.includes('Ta fenêtre de 5 h est épuisée.') && /Retour (demain )?(\w+ )?à \d\d h \d\d\./.test(outText), outText)
    ok('strip, used up: the next level with its price and the multiple, and a key of one\'s own', hook(out, 'limit-upgrade').length === 1 && /Passer à Plus/.test(text(hook(out, 'limit-upgrade')[0]))
      && /19 \$ par mois, facturé à l’année · 20 fois plus/.test(text(hook(out, 'limit-upgrade')[0])) && hook(out, 'limit-own').length === 1, text(hook(out, 'limit-upgrade')[0] || {}))
    ok('strip, used up: the four windows are handed to the list, the used-up one with its time of return', (() => { const rows = find(out, (n) => n.props && Array.isArray(n.props.windows))[0]; return rows !== undefined && rows.props.windows.length === 4 && rows.props.windows.filter((w) => w.back !== null).length === 1 && rows.props.windows.map((w) => w.label).join('|') === '5 h|24 h|7 jours|30 jours' })())
    ok('strip, used up: the primary path comes first', (() => { const paths = find(out, (n) => n.props && n.props.className === 'kbus-paths')[0]; return paths !== undefined && paths.kids.flat().filter(Boolean)[0].props['data-kb'] === 'limit-upgrade' })())
    const asked = draw(onPlan, planOf([usedUp(18000, 3)], { personal: false, role: 'member' }), plus)
    ok('strip, used up, a member of a team: who to ask, no buy button, still the way to a key of one\'s own', hook(asked, 'limit-upgrade').length === 0 && hook(asked, 'limit-ask').length === 1 && hook(asked, 'limit-own').length === 1)
    const noCat = draw(onPlan, planOf([usedUp(18000, 3)]), undefined)
    ok('strip, used up, no offer: the way on that needs no price is still there', hook(noCat, 'limit-upgrade').length === 0 && hook(noCat, 'limit-own').length === 1)
    globalThis.window.__KB_LANG_RESOLVE__ = () => 'en'
    const enOut = draw(onPlan, planOf([usedUp(18000, 3)]), { ...plus, price: '$19' }) // the cloud bundle words the price in the UI language
    ok('strip, English', /Your 5 h window is used up\./.test(text(enOut)) && /Switch to Plus/.test(text(enOut)) && /Use my own key or a free model/.test(text(enOut)) && /\$19 a month, billed yearly · 20 times more/.test(text(enOut)), text(enOut))
    T.planStore.value = undefined; T.pitchStore.value = undefined
  }
  globalThis.window.__KB_LANG_RESOLVE__ = prevLang

  // the end of a turn and the buttons, read from the source (effects do not run in this stub)
  ok('the end of a turn asks the footer\'s meter to read again, after the counters have stopped moving', /dispatchEvent\(new Event\('kybernos-cloud:quota-read'\)\)/.test(src) && T.TURN_SETTLE_MS >= 1000 && T.TURN_SETTLE_MS <= 5000)
  ok('the plan is read again when the footer or a refused call says so', /addEventListener\('kybernos-cloud:quota-read'/.test(src))
  ok('the buttons reach the Upgrade dialog and Settings through the seams the cloud bundle owns, with a fallback', /__KB_UPGRADE__/.test(src) && /u\.settings\(\)/.test(src) && /__kbOpenDshSettings/.test(src))
  ok('the strip takes a line of its own in the dock', /\[data-composer-dock\]:has\(\.kbus-strip\)\{flex-wrap:wrap\}/.test(T.CSS))
}
process.exit(fail ? 1 : 0)

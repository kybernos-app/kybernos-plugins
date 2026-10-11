#!/usr/bin/env node
// kybernos-websearch: every engine against a fake `http`. What is checked is the request each one sends (method, address,
// auth header, body) and what it makes of the documented answer shape. No network.
import { ENGINES, EngineError, searxngEndpoint, DEFAULT_ORDER, OFF_BY_DEFAULT } from './engines.mjs'

let fail = 0
const ok = (name, cond, detail) => {
  if (cond === true) console.log('  ✓ ' + name)
  else { fail += 1; console.log('  ✗ ' + name + (detail !== undefined ? ' → ' + String(detail).slice(0, 220) : '')) }
}
const eq = (name, a, b) => ok(name, JSON.stringify(a) === JSON.stringify(b), JSON.stringify(a))
const engine = (id) => ENGINES.find((e) => e.id === id)

/** A fake http that records the request and answers `reply`. */
const fake = (reply) => {
  const calls = []
  const http = async (url, init = {}) => {
    calls.push({ url, ...init })
    const r = typeof reply === 'function' ? reply(url, init) : reply
    return { status: r.status || 200, ok: (r.status || 200) >= 200 && (r.status || 200) < 300, text: typeof r.body === 'string' ? r.body : JSON.stringify(r.body) }
  }
  return { http, calls }
}
const keys = (map) => async (ref) => (map[ref] === undefined ? null : map[ref])
const run = (id, f, { keymap = {}, opt = {}, count = 5, query = 'kybernos search' } = {}) =>
  engine(id).run({ query, count, signal: undefined, http: f.http, key: keys(keymap), opt })
const rejects = async (p) => { try { await p; return null } catch (e) { return e } }
const header = (call, name) => { const h = call.headers || {}; const k = Object.keys(h).find((x) => x.toLowerCase() === name); return k === undefined ? undefined : h[k] }

console.log('— catalogue')
ok('every engine has an id, an access kind and a run()', ENGINES.every((e) => typeof e.id === 'string' && ['free', 'key', 'url'].includes(e.access) && typeof e.run === 'function'))
ok('ids are unique and the default order lists exactly those ids', new Set(ENGINES.map((e) => e.id)).size === ENGINES.length && JSON.stringify([...DEFAULT_ORDER].sort()) === JSON.stringify(ENGINES.map((e) => e.id).sort()))
ok('only the encyclopedia starts switched off', JSON.stringify(OFF_BY_DEFAULT) === '["wikipedia"]')
ok('the engines that need nothing are first among no-key engines to be tried only after the keyed ones', DEFAULT_ORDER.indexOf('brave-web') > DEFAULT_ORDER.indexOf('deepseek') && DEFAULT_ORDER.indexOf('duckduckgo') > DEFAULT_ORDER.indexOf('exa-free'))
ok('a keyed engine names the credential it reads', ENGINES.filter((e) => e.access === 'key').every((e) => e.refs.length > 0 && e.home !== undefined))

console.log('— keyed engines: request and mapping')
let f = fake({ body: { web: { results: [{ url: 'https://a.example/', title: 'A', description: 'da', page_age: '2026-01-01' }] } } })
let r = await run('brave-api', f, { keymap: { BRAVE_API_KEY: 'bk-123456789' }, count: 30 })
ok('brave-api: GET with the subscription token, count capped at 20', f.calls[0].url.startsWith('https://api.search.brave.com/res/v1/web/search?') && f.calls[0].url.includes('count=20') && header(f.calls[0], 'x-subscription-token') === 'bk-123456789')
eq('brave-api: maps title, url, description, age', r[0], { url: 'https://a.example/', title: 'A', snippet: 'da', publishedAt: '2026-01-01' })

f = fake({ body: { results: [{ url: 'https://t.example/', title: 'T', content: 'ct', published_date: '2026-02-02' }] } })
r = await run('tavily', f, { keymap: { TAVILY_API_KEY: 'tvly-123456789' } })
const tb = JSON.parse(f.calls[0].body)
ok('tavily: POST api.tavily.com/search with a Bearer, no generated answer asked for', f.calls[0].method === 'POST' && f.calls[0].url === 'https://api.tavily.com/search' && header(f.calls[0], 'authorization') === 'Bearer tvly-123456789' && tb.include_answer === false && tb.max_results === 5)
eq('tavily: maps content to snippet', r[0].snippet, 'ct')

f = fake({ body: { organic: [{ link: 'https://s2.example/', title: 'Two', snippet: 's2', position: 2 }, { link: 'https://s1.example/', title: 'One', snippet: 's1', position: 1 }] } })
r = await run('serper', f, { keymap: { SERPER_API_KEY: 'sp-123456789' } })
ok('serper: X-API-KEY and {q, num}', header(f.calls[0], 'x-api-key') === 'sp-123456789' && JSON.parse(f.calls[0].body).q === 'kybernos search')
eq('serper: sorted by position', r.map((x) => x.title), ['One', 'Two'])

f = fake({ body: { results: [{ url: 'https://e.example/', title: 'E', highlights: ['h1', 'h2'], publishedDate: '2026-03-03' }, { url: 'https://e2.example/', title: 'E2', text: 'body text' }] } })
r = await run('exa', f, { keymap: { EXA_API_KEY: 'exa-123456789' } })
ok('exa: POST api.exa.ai/search, text capped, key sent', f.calls[0].url === 'https://api.exa.ai/search' && JSON.parse(f.calls[0].body).contents.text.maxCharacters === 500 && header(f.calls[0], 'x-api-key') === 'exa-123456789')
eq('exa: highlights, else text', r.map((x) => x.snippet), ['h1 h2', 'body text'])

f = fake({ body: { data: { search: [{ t: 0, url: 'https://k.example/', title: 'K', snippet: 'ks' }] } } })
r = await run('kagi', f, { keymap: { KAGI_API_KEY: 'kg-123456789' } })
ok('kagi: POST v1 search with a Bearer', f.calls[0].url === 'https://kagi.com/api/v1/search' && header(f.calls[0], 'authorization') === 'Bearer kg-123456789')
eq('kagi: reads data.search', r[0].url, 'https://k.example/')

f = fake({ body: { items: [{ link: 'https://g.example/', title: 'G', snippet: 'gs' }] } })
r = await run('google-pse', f, { keymap: { GOOGLE_PSE_API_KEY: 'gk-123456789' }, opt: { googleCx: 'cx:abc' }, count: 25 })
ok('google-pse: key, cx and num capped at 10 in the query string', /key=gk-123456789/.test(f.calls[0].url) && /cx=cx%3Aabc/.test(f.calls[0].url) && /num=10/.test(f.calls[0].url))
eq('google-pse: reads items', r[0].title, 'G')
let e = await rejects(run('google-pse', fake({ body: {} }), { keymap: { GOOGLE_PSE_API_KEY: 'gk-123456789' } }))
ok('google-pse: without the engine id it is a config error, before any request', e instanceof EngineError && e.kind === 'config')

f = fake({ body: { data: [{ url: 'https://j.example/', title: 'J', description: 'jd' }] } })
r = await run('jina', f, { keymap: { JINA_API_KEY: 'jina_123456789' } })
ok('jina: POST s.jina.ai with a Bearer and images off', f.calls[0].url === 'https://s.jina.ai/' && header(f.calls[0], 'authorization') === 'Bearer jina_123456789' && header(f.calls[0], 'x-retain-images') === 'none')
eq('jina: reads data', r[0].snippet, 'jd')

f = fake({ body: { results: [{ url: 'https://p.example/', title: 'P', snippet: 'ps', date: '2026-04-04' }] } })
r = await run('perplexity', f, { keymap: { PERPLEXITY_API_KEY: 'pplx-123456789' } })
ok('perplexity: POST api.perplexity.ai/search with a Bearer', f.calls[0].url === 'https://api.perplexity.ai/search' && JSON.parse(f.calls[0].body).max_results === 5)
eq('perplexity: maps the date', r[0].publishedAt, '2026-04-04')

const DEEPSEEK = { content: [
  { type: 'text', text: 'ok', citations: [{ url: 'https://d.example/', cited_text: 'cited excerpt' }] },
  { type: 'web_search_tool_result', content: [{ type: 'web_search_result', url: 'https://d.example/', title: 'D', page_age: 'April 1, 2026' }, { type: 'other' }] }
] }
f = fake({ body: DEEPSEEK })
r = await run('deepseek', f, { keymap: { DEEPSEEK_API_KEY: 'sk-123456789' } })
const db = JSON.parse(f.calls[0].body)
ok('deepseek: Messages API with the native web_search tool, key in both headers', f.calls[0].url === 'https://api.deepseek.com/anthropic/v1/messages' && db.tools[0].type === 'web_search_20250305' && header(f.calls[0], 'x-api-key') === 'sk-123456789' && header(f.calls[0], 'anthropic-version') === '2023-06-01')
eq('deepseek: the excerpt comes from the citation of the same URL', r[0], { url: 'https://d.example/', title: 'D', snippet: 'cited excerpt', publishedAt: 'April 1, 2026' })
e = await rejects(run('deepseek', fake({ body: { content: [{ type: 'text', text: 'no search' }] } }), { keymap: { DEEPSEEK_API_KEY: 'sk-123456789' } }))
ok('deepseek: no result block is a parse error, not an empty answer', e instanceof EngineError && e.kind === 'parse')

console.log('— keyed engines: failures')
for (const id of ['brave-api', 'tavily', 'serper', 'exa', 'kagi', 'google-pse', 'jina', 'perplexity', 'deepseek']) {
  const err = await rejects(run(id, fake({ body: {} }), { opt: { googleCx: 'cx' } }))
  ok(id + ': no key is a config error and no request is made', err instanceof EngineError && err.kind === 'config')
}
const status = async (code) => (await rejects(run('tavily', fake({ status: code, body: { error: 'x' } }), { keymap: { TAVILY_API_KEY: 'tvly-123456789' } }))).kind
eq('HTTP 401 and 403 are auth, 429 and 402 quota, 400 config, 503 server', [await status(401), await status(403), await status(429), await status(402), await status(400), await status(503)], ['auth', 'auth', 'quota', 'quota', 'config', 'server'])
e = await rejects(run('tavily', fake({ body: 'not json' }), { keymap: { TAVILY_API_KEY: 'tvly-123456789' } }))
ok('a body that is not JSON is a parse error', e instanceof EngineError && e.kind === 'parse')
e = await rejects(run('tavily', fake({ status: 401, body: { error: 'bad key tvly-123456789' } }), { keymap: { TAVILY_API_KEY: 'tvly-123456789' } }))
ok('the error text never contains the key (it is only ever echoed by a server that reflects it: the 160-char slice is the bound)', e.message.length < 260)

console.log('— engines with an address')
eq('searxng: any spelling of the address is the same /search endpoint', [searxngEndpoint('https://s.example'), searxngEndpoint('https://s.example/'), searxngEndpoint('https://s.example/search?x=1'), searxngEndpoint('http://127.0.0.1:8080/sub/')], ['https://s.example/search', 'https://s.example/search', 'https://s.example/search', 'http://127.0.0.1:8080/sub/search'])
eq('searxng: a non-http address is refused', searxngEndpoint('file:///etc/passwd'), null)
f = fake({ body: { results: [{ url: 'https://lo.example/', title: 'lo', content: 'c', score: 1 }, { url: 'https://hi.example/', title: 'hi', content: 'c', score: 9, publishedDate: '2026-05-05' }] } })
r = await run('searxng', f, { opt: { searxngUrl: 'http://127.0.0.1:8080' } })
ok('searxng: GET /search?format=json on the address', f.calls[0].url.startsWith('http://127.0.0.1:8080/search?') && /format=json/.test(f.calls[0].url))
eq('searxng: best score first', r.map((x) => x.title), ['hi', 'lo'])
e = await rejects(run('searxng', fake({ status: 403, body: 'forbidden' }), { opt: { searxngUrl: 'http://127.0.0.1:8080' } }))
ok('searxng: a 403 says that JSON is not enabled on the instance', e.kind === 'config' && /json/i.test(e.message))
e = await rejects(run('searxng', fake({ body: {} }), {}))
ok('searxng: no address is a config error', e.kind === 'config')
f = fake({ body: [{ link: 'https://c.example/', title: 'C', snippet: 'cs' }] })
r = await run('custom', f, { keymap: { KYBERNOS_WEBSEARCH_CUSTOM_KEY: 'secret-token' }, opt: { customUrl: 'https://search.internal.example/q' } })
ok('custom: the OpenWebUI external-search contract (POST {query,count}, Bearer, [{link,title,snippet}])', f.calls[0].method === 'POST' && JSON.parse(f.calls[0].body).count === 5 && header(f.calls[0], 'authorization') === 'Bearer secret-token' && r[0].url === 'https://c.example/')
f = fake({ body: [] })
await run('custom', f, { opt: { customUrl: 'https://search.internal.example/q' } })
ok('custom: the key is optional (no Authorization header without one)', header(f.calls[0], 'authorization') === undefined)

console.log('— engines that need nothing')
f = fake({ status: 200, body: '<html><title>x - Brave Search</title></html>' })
r = await run('brave-web', f)
ok('brave-web: a browser-like request on the results page, and an empty list when nothing matches', /^https:\/\/search\.brave\.com\/search\?/.test(f.calls[0].url) && /Mozilla/.test(header(f.calls[0], 'user-agent')) && r.length === 0)
e = await rejects(run('brave-web', fake({ status: 200, body: '<html><title>Captcha</title>Please solve the captcha</html>' })))
ok('brave-web: a captcha page is "blocked", not "no result"', e.kind === 'blocked')
e = await rejects(run('brave-web', fake({ status: 200, body: '<html><title>Something else</title></html>' })))
ok('brave-web: a page that is not results at all is a parse error', e.kind === 'parse')
e = await rejects(run('brave-web', fake({ status: 429, body: '' })))
ok('brave-web: HTTP 429 is quota', e.kind === 'quota')

f = fake({ status: 202, body: 'Unfortunately, bots use DuckDuckGo too. Select all squares containing a duck' })
e = await rejects(run('duckduckgo', f))
ok('duckduckgo: the picture challenge is "blocked" after ONE request (Lite shares the limiter)', e.kind === 'blocked' && f.calls.length === 1)
f = fake((url) => (url.includes('html.duckduckgo') ? { status: 200, body: '<html>no results here</html>' } : { status: 200, body: "<a rel=\"nofollow\" href=\"https://l.example/\" class='result-link'>L</a>" }))
r = await run('duckduckgo', f)
ok('duckduckgo: Lite is tried when the HTML page has neither a result nor a challenge', f.calls.length === 2 && r[0].url === 'https://l.example/')

f = fake({ status: 200, body: 'event: message\ndata: ' + JSON.stringify({ result: { content: [{ type: 'text', text: 'Title: T\nURL: https://x.example/\nPublished: N/A\nAuthor: N/A\nHighlights:\nhl' }] } }) + '\n\n' })
r = await run('exa-free', f)
const eb = JSON.parse(f.calls[0].body)
ok('exa-free: MCP tools/call web_search_exa on mcp.exa.ai, no key header', f.calls[0].url === 'https://mcp.exa.ai/mcp' && eb.method === 'tools/call' && eb.params.name === 'web_search_exa' && header(f.calls[0], 'authorization') === undefined && header(f.calls[0], 'x-api-key') === undefined)
eq('exa-free: the text blocks become results', r[0], { url: 'https://x.example/', title: 'T', snippet: 'hl' })
e = await rejects(run('exa-free', fake({ status: 200, body: JSON.stringify({ error: { message: 'Rate limit exceeded' } }) })))
ok('exa-free: a rate-limit message in the MCP error is quota', e.kind === 'quota')
e = await rejects(run('exa-free', fake({ status: 200, body: JSON.stringify({ result: { isError: true, content: [{ type: 'text', text: 'free tier daily limit reached' }] } }) })))
ok('exa-free: isError with a limit text is quota', e.kind === 'quota')

f = fake({ body: { query: { search: [{ title: 'Web API', snippet: 'A <span class="searchmatch">web</span> API', timestamp: '2026-10-02T07:37:35Z' }] } } })
r = await run('wikipedia', f, { opt: { wikiLang: 'fr' } })
ok('wikipedia: the language subdomain, list=search', f.calls[0].url.startsWith('https://fr.wikipedia.org/w/api.php?') && /list=search/.test(f.calls[0].url))
eq('wikipedia: article URL built from the title, snippet stripped of markup', [r[0].url, r[0].snippet], ['https://fr.wikipedia.org/wiki/Web_API', 'A web API'])
f = fake({ body: { query: { search: [] } } })
await run('wikipedia', f, { opt: { wikiLang: 'evil.example/x?' } })
ok('wikipedia: a language that is not a language code falls back to en (no host injection)', f.calls[0].url.startsWith('https://en.wikipedia.org/'))

console.log('\n' + (fail === 0 ? 'ALL CHECKS OK' : fail + ' check(s) FAILED'))
process.exit(fail === 0 ? 0 : 1)

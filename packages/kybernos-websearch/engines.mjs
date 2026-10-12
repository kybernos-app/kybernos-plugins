// kybernos-websearch: the engines. One object per engine, no state, no DSH.
//
// An engine is `{ id, access, refs, run }`:
//   · access 'free' needs nothing, 'key' needs its credential refs, 'url' needs an address the person owns;
//   · `run({ query, count, signal, http, key, opt })` returns [{ url, title, snippet, publishedAt? }] or throws an
//     EngineError whose `kind` the router turns into a pause (auth, quota, blocked, server, network, timeout, parse,
//     config, aborted). `http(url, init)` and `key(ref)` are injected: the tests play every engine with no network.
//
// Which of these were played against the live service is written in README.md, not here.
import {
  cleanText, parseBraveHtml, parseDuckHtml, parseDuckLite, isDuckChallenge, parseExaText, parseMcpBody, safeUrl, stripTags
} from './parse.mjs'

export class EngineError extends Error {
  constructor (kind, message, status) {
    super(message)
    this.name = 'EngineError'
    this.kind = kind
    if (status !== undefined) this.status = status
  }
}

/** What an HTTP status means for the router. */
export const kindOfStatus = (status) => {
  if (status === 401 || status === 403) return 'auth'
  if (status === 402 || status === 429) return 'quota'
  if (status === 400 || status === 404 || status === 422) return 'config'
  if (status >= 500) return 'server'
  return 'server'
}

export const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

const BROWSER_HEADERS = {
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'accept-language': 'en-US,en;q=0.9'
}

const need = (value, what) => {
  if (typeof value !== 'string' || value.trim() === '') throw new EngineError('config', what + ' is not set')
  return value.trim()
}

const jsonOf = (res, label) => {
  if (res.ok !== true) {
    const detail = String(res.text === undefined ? '' : res.text).slice(0, 160).replace(/\s+/g, ' ')
    throw new EngineError(kindOfStatus(res.status), label + ' answered HTTP ' + res.status + (detail !== '' ? ': ' + detail : ''), res.status)
  }
  try { return JSON.parse(res.text) } catch (e) { throw new EngineError('parse', label + ' did not answer JSON') }
}

const row = (url, title, snippet, publishedAt) => {
  const out = { url, title: cleanText(title, 200), snippet: cleanText(snippet, 400) }
  if (typeof publishedAt === 'string' && publishedAt !== '') out.publishedAt = publishedAt
  return out
}

const arr = (v) => (Array.isArray(v) ? v : [])
const str = (v) => (typeof v === 'string' ? v : '')

const json = (body) => ({ 'content-type': 'application/json', accept: 'application/json', ...body })

/** The endpoint of a SearXNG instance: `https://host`, `https://host/`, `https://host/search` all mean the same. */
export const searxngEndpoint = (base) => {
  const u = safeUrl(base)
  if (u === null) return null
  const url = new URL(u)
  url.search = ''
  url.pathname = url.pathname.replace(/\/+$/, '').replace(/\/search$/, '') + '/search'
  return url.href
}

export const ENGINES = [
  // ── an address the person owns ───────────────────────────────────────────────────────────────────
  {
    id: 'searxng',
    access: 'url',
    field: 'searxngUrl',
    refs: [],
    async run ({ query, count, signal, http, opt }) {
      const endpoint = searxngEndpoint(need(opt.searxngUrl, 'The SearXNG address'))
      if (endpoint === null) throw new EngineError('config', 'The SearXNG address is not a valid http(s) URL')
      const url = endpoint + '?' + new URLSearchParams({ q: query, format: 'json', pageno: '1', safesearch: '1', language: 'all' })
      const res = await http(url, { headers: json({ 'user-agent': 'Kybernos-WebSearch/1.0' }), signal })
      if (res.status === 403) throw new EngineError('config', 'This SearXNG instance refuses format=json (add "json" to search.formats in its settings.yml)', 403)
      const body = jsonOf(res, 'SearXNG')
      return arr(body.results)
        .sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0))
        .slice(0, count)
        .map((r) => row(str(r.url), str(r.title), str(r.content), str(r.publishedDate)))
    }
  },
  {
    // The OpenWebUI "external search" contract: POST { query, count } with a Bearer, answer [{ link, title, snippet }].
    id: 'custom',
    access: 'url',
    field: 'customUrl',
    refs: [{ ref: 'KYBERNOS_WEBSEARCH_CUSTOM_KEY', optional: true }],
    async run ({ query, count, signal, http, key, opt }) {
      const target = safeUrl(need(opt.customUrl, 'The custom search address'))
      if (target === null) throw new EngineError('config', 'The custom search address is not a valid http(s) URL')
      const bearer = await key('KYBERNOS_WEBSEARCH_CUSTOM_KEY')
      const res = await http(target, {
        method: 'POST',
        headers: json(bearer ? { authorization: 'Bearer ' + bearer } : {}),
        body: JSON.stringify({ query, count }),
        signal
      })
      const body = jsonOf(res, 'The custom search endpoint')
      const list = Array.isArray(body) ? body : arr(body.results)
      return list.map((r) => row(str(r.link) || str(r.url), str(r.title), str(r.snippet) || str(r.content)))
    }
  },

  // ── with a key ───────────────────────────────────────────────────────────────────────────────────
  {
    id: 'brave-api',
    access: 'key',
    refs: [{ ref: 'BRAVE_API_KEY' }],
    home: 'https://brave.com/search/api/',
    minIntervalMs: 1100,
    async run ({ query, count, signal, http, key }) {
      const k = need(await key('BRAVE_API_KEY'), 'BRAVE_API_KEY')
      const url = 'https://api.search.brave.com/res/v1/web/search?' + new URLSearchParams({ q: query, count: String(Math.min(count, 20)) })
      const res = await http(url, { headers: { accept: 'application/json', 'x-subscription-token': k }, signal })
      const body = jsonOf(res, 'Brave Search API')
      return arr(body.web && body.web.results).map((r) => row(str(r.url), str(r.title), str(r.description), str(r.page_age) || str(r.age)))
    }
  },
  {
    id: 'tavily',
    access: 'key',
    refs: [{ ref: 'TAVILY_API_KEY' }],
    home: 'https://app.tavily.com/',
    async run ({ query, count, signal, http, key }) {
      const k = need(await key('TAVILY_API_KEY'), 'TAVILY_API_KEY')
      const res = await http('https://api.tavily.com/search', {
        method: 'POST',
        headers: json({ authorization: 'Bearer ' + k }),
        body: JSON.stringify({ query, max_results: Math.min(count, 20), search_depth: 'basic', include_answer: false }),
        signal
      })
      const body = jsonOf(res, 'Tavily')
      return arr(body.results).map((r) => row(str(r.url), str(r.title), str(r.content), str(r.published_date)))
    }
  },
  {
    id: 'serper',
    access: 'key',
    refs: [{ ref: 'SERPER_API_KEY' }],
    home: 'https://serper.dev/',
    async run ({ query, count, signal, http, key }) {
      const k = need(await key('SERPER_API_KEY'), 'SERPER_API_KEY')
      const res = await http('https://google.serper.dev/search', {
        method: 'POST',
        headers: json({ 'x-api-key': k }),
        body: JSON.stringify({ q: query, num: Math.min(count, 20) }),
        signal
      })
      const body = jsonOf(res, 'Serper')
      return arr(body.organic)
        .sort((a, b) => (Number(a.position) || 0) - (Number(b.position) || 0))
        .map((r) => row(str(r.link), str(r.title), str(r.snippet), str(r.date)))
    }
  },
  {
    id: 'exa',
    access: 'key',
    refs: [{ ref: 'EXA_API_KEY' }],
    home: 'https://dashboard.exa.ai/',
    async run ({ query, count, signal, http, key }) {
      const k = need(await key('EXA_API_KEY'), 'EXA_API_KEY')
      const res = await http('https://api.exa.ai/search', {
        method: 'POST',
        headers: json({ 'x-api-key': k, authorization: 'Bearer ' + k }),
        body: JSON.stringify({ query, numResults: Math.min(count, 25), type: 'auto', contents: { text: { maxCharacters: 500 } } }),
        signal
      })
      const body = jsonOf(res, 'Exa')
      return arr(body.results).map((r) => row(str(r.url), str(r.title), arr(r.highlights).join(' ') || str(r.text), str(r.publishedDate)))
    }
  },
  {
    id: 'kagi',
    access: 'key',
    refs: [{ ref: 'KAGI_API_KEY' }],
    home: 'https://kagi.com/settings/api',
    async run ({ query, count, signal, http, key }) {
      const k = need(await key('KAGI_API_KEY'), 'KAGI_API_KEY')
      const res = await http('https://kagi.com/api/v1/search', {
        method: 'POST',
        headers: json({ authorization: 'Bearer ' + k }),
        body: JSON.stringify({ query, limit: count }),
        signal
      })
      const body = jsonOf(res, 'Kagi')
      return arr(body.data && body.data.search).map((r) => row(str(r.url), str(r.title), str(r.snippet), str(r.published)))
    }
  },
  {
    id: 'google-pse',
    access: 'key',
    field: 'googleCx',
    refs: [{ ref: 'GOOGLE_PSE_API_KEY' }],
    home: 'https://programmablesearchengine.google.com/',
    async run ({ query, count, signal, http, key, opt }) {
      const k = need(await key('GOOGLE_PSE_API_KEY'), 'GOOGLE_PSE_API_KEY')
      const cx = need(opt.googleCx, 'The Programmable Search Engine id')
      const url = 'https://www.googleapis.com/customsearch/v1?' + new URLSearchParams({ key: k, cx, q: query, num: String(Math.min(count, 10)) })
      const res = await http(url, { headers: { accept: 'application/json' }, signal })
      const body = jsonOf(res, 'Google Programmable Search')
      return arr(body.items).map((r) => row(str(r.link), str(r.title), str(r.snippet)))
    }
  },
  {
    id: 'jina',
    access: 'key',
    refs: [{ ref: 'JINA_API_KEY' }],
    home: 'https://jina.ai/api-dashboard/',
    async run ({ query, count, signal, http, key }) {
      const k = need(await key('JINA_API_KEY'), 'JINA_API_KEY')
      const res = await http('https://s.jina.ai/', {
        method: 'POST',
        headers: json({ authorization: 'Bearer ' + k, 'x-retain-images': 'none' }),
        body: JSON.stringify({ q: query, count: Math.min(count, 10) }),
        signal
      })
      const body = jsonOf(res, 'Jina')
      return arr(body.data).map((r) => row(str(r.url), str(r.title), str(r.description) || str(r.content)))
    }
  },
  {
    id: 'perplexity',
    access: 'key',
    refs: [{ ref: 'PERPLEXITY_API_KEY' }],
    home: 'https://www.perplexity.ai/settings/api',
    async run ({ query, count, signal, http, key }) {
      const k = need(await key('PERPLEXITY_API_KEY'), 'PERPLEXITY_API_KEY')
      const res = await http('https://api.perplexity.ai/search', {
        method: 'POST',
        headers: json({ authorization: 'Bearer ' + k }),
        body: JSON.stringify({ query, max_results: Math.min(count, 20) }),
        signal
      })
      const body = jsonOf(res, 'Perplexity')
      return arr(body.results).map((r) => row(str(r.url), str(r.title), str(r.snippet), str(r.date)))
    }
  },
  {
    // The engine's own default: DeepSeek's native search through the Anthropic-compatible Messages API (one model turn).
    id: 'deepseek',
    access: 'key',
    refs: [{ ref: 'DEEPSEEK_API_KEY' }],
    home: 'https://platform.deepseek.com/api_keys',
    async run ({ query, count, signal, http, key, opt }) {
      const k = need(await key('DEEPSEEK_API_KEY'), 'DEEPSEEK_API_KEY')
      const base = safeUrl(opt.deepseekBase || 'https://api.deepseek.com/anthropic/v1')
      if (base === null) throw new EngineError('config', 'The DeepSeek search endpoint is not a valid http(s) URL')
      const res = await http(base.replace(/\/+$/, '') + '/messages', {
        method: 'POST',
        headers: json({ 'x-api-key': k, authorization: 'Bearer ' + k, 'anthropic-version': '2023-06-01' }),
        body: JSON.stringify({
          model: 'deepseek-v4-flash',
          max_tokens: 4096,
          messages: [{ role: 'user', content: [{ type: 'text', text: 'Perform a web search for the query: ' + query }] }],
          tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }]
        }),
        signal
      })
      const body = jsonOf(res, 'DeepSeek search')
      const blocks = arr(body.content)
      const excerpts = new Map()
      for (const b of blocks) {
        if (b.type !== 'text') continue
        for (const c of arr(b.citations)) if (str(c.url) !== '' && str(c.cited_text) !== '' && !excerpts.has(c.url)) excerpts.set(c.url, c.cited_text)
      }
      const results = blocks.filter((b) => b.type === 'web_search_tool_result')
      if (results.length === 0) throw new EngineError('parse', 'DeepSeek returned no search result block')
      const out = []
      for (const b of results) {
        for (const r of arr(b.content)) if (r.type === 'web_search_result') out.push(row(str(r.url), str(r.title), excerpts.get(r.url) || '', str(r.page_age)))
      }
      return out.slice(0, Math.max(count, 1))
    }
  },

  // ── nothing needed ───────────────────────────────────────────────────────────────────────────────
  {
    // Brave's ordinary results page. Best effort: Brave may ask a script-driven client for a captcha.
    id: 'brave-web',
    access: 'free',
    refs: [],
    minIntervalMs: 1500,
    async run ({ query, signal, http }) {
      const url = 'https://search.brave.com/search?' + new URLSearchParams({ q: query, source: 'web' })
      const res = await http(url, { headers: { ...BROWSER_HEADERS, 'user-agent': BROWSER_UA }, signal })
      if (res.status === 429) throw new EngineError('quota', 'Brave Search slowed this client down (HTTP 429)', 429)
      if (res.status === 403) throw new EngineError('blocked', 'Brave Search refused this client (HTTP 403)', 403)
      if (res.ok !== true) throw new EngineError('server', 'Brave Search answered HTTP ' + res.status, res.status)
      const items = parseBraveHtml(res.text)
      if (items.length === 0 && /captcha|are you a (robot|human)|unusual traffic/i.test(res.text)) throw new EngineError('blocked', 'Brave Search asked for a captcha')
      if (items.length === 0 && !/<title>[^<]*Brave Search/i.test(res.text)) throw new EngineError('parse', 'The Brave Search page did not look like results')
      return items
    }
  },
  {
    // DuckDuckGo's HTML page, then its Lite page when the first one has no result and no challenge.
    id: 'duckduckgo',
    access: 'free',
    refs: [],
    minIntervalMs: 2000,
    async run ({ query, signal, http }) {
      const headers = { ...BROWSER_HEADERS, 'user-agent': BROWSER_UA, 'content-type': 'application/x-www-form-urlencoded', referer: 'https://html.duckduckgo.com/' }
      const body = new URLSearchParams({ q: query, b: '', kl: 'wt-wt' }).toString()
      const first = await http('https://html.duckduckgo.com/html/', { method: 'POST', headers, body, signal })
      if (isDuckChallenge(first.text, first.status)) throw new EngineError('blocked', 'DuckDuckGo asked for a picture challenge (it takes this client for a bot)', first.status)
      if (first.status === 429) throw new EngineError('quota', 'DuckDuckGo slowed this client down (HTTP 429)', 429)
      if (first.ok !== true) throw new EngineError('server', 'DuckDuckGo answered HTTP ' + first.status, first.status)
      const items = parseDuckHtml(first.text)
      if (items.length > 0) return items
      const lite = await http('https://lite.duckduckgo.com/lite/', { method: 'POST', headers: { ...headers, referer: 'https://lite.duckduckgo.com/' }, body, signal })
      if (isDuckChallenge(lite.text, lite.status)) throw new EngineError('blocked', 'DuckDuckGo asked for a picture challenge', lite.status)
      if (lite.ok !== true) throw new EngineError('server', 'DuckDuckGo Lite answered HTTP ' + lite.status, lite.status)
      return parseDuckLite(lite.text)
    }
  },
  {
    // Exa's public MCP endpoint, used without a key (its free quota). The same tool name as the keyed engine's data.
    id: 'exa-free',
    access: 'free',
    refs: [],
    minIntervalMs: 1000,
    async run ({ query, count, signal, http }) {
      const res = await http('https://mcp.exa.ai/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'web_search_exa', arguments: { query, numResults: Math.min(count, 10), objective: 'Find the pages that best answer: ' + query } }
        }),
        signal
      })
      if (res.ok !== true) throw new EngineError(kindOfStatus(res.status), 'Exa answered HTTP ' + res.status, res.status)
      const frame = parseMcpBody(res.text)
      if (frame === null || typeof frame !== 'object') throw new EngineError('parse', 'Exa did not answer an MCP message')
      if (frame.error !== undefined) {
        const message = cleanText(frame.error && frame.error.message, 160)
        throw new EngineError(/rate|limit|quota/i.test(message) ? 'quota' : 'server', 'Exa: ' + message)
      }
      const result = frame.result
      if (result === undefined || result === null) throw new EngineError('parse', 'Exa answered no result')
      const text = arr(result.content).filter((c) => c && c.type === 'text').map((c) => str(c.text)).join('\n---\n')
      if (result.isError === true) throw new EngineError(/rate|limit|quota/i.test(text) ? 'quota' : 'server', 'Exa: ' + cleanText(text, 160))
      return parseExaText(text)
    }
  },
  {
    // Wikipedia only: an encyclopedia, not the web. Off by default, a last resort the person turns on.
    id: 'wikipedia',
    access: 'free',
    field: 'wikiLang',
    refs: [],
    async run ({ query, count, signal, http, opt }) {
      const lang = /^[a-z]{2,3}(-[a-z]+)?$/.test(String(opt.wikiLang || '')) ? opt.wikiLang : 'en'
      const url = 'https://' + lang + '.wikipedia.org/w/api.php?' + new URLSearchParams({
        action: 'query', list: 'search', srsearch: query, srlimit: String(Math.min(count, 20)), format: 'json', formatversion: '2', utf8: '1'
      })
      const res = await http(url, { headers: { accept: 'application/json', 'user-agent': 'Kybernos-WebSearch/1.0' }, signal })
      const body = jsonOf(res, 'Wikipedia')
      return arr(body.query && body.query.search).map((r) => row(
        'https://' + lang + '.wikipedia.org/wiki/' + encodeURIComponent(str(r.title).replace(/ /g, '_')),
        str(r.title),
        stripTags(str(r.snippet)),
        str(r.timestamp)
      ))
    }
  }
]


/** The order a fresh install uses: what the person owns first, then keyed engines, then the free ones, the encyclopedia last. */
export const DEFAULT_ORDER = ['searxng', 'custom', 'brave-api', 'tavily', 'serper', 'exa', 'kagi', 'google-pse', 'jina', 'perplexity', 'deepseek', 'brave-web', 'exa-free', 'duckduckgo', 'wikipedia']

/** Engines that start switched off: the encyclopedia is a different thing from a web search. */
export const OFF_BY_DEFAULT = ['wikipedia']


// kybernos-websearch: text and HTML helpers. Pure: no network, no disk, no DSH.
//
// Everything a search engine sends back is untrusted text. Nothing leaves this module that has not been
// stripped of markup and control characters, cut to a bound, and (for a URL) checked to be a plain
// http(s) address without credentials.

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '-', mdash: '-', hellip: '...', rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"' }

/** Decodes the HTML entities a search page uses (named, decimal, hex). Unknown ones are left as they are. */
export const decodeEntities = (text) => String(text === undefined || text === null ? '' : text)
  .replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
      if (!Number.isFinite(code) || code < 1 || code > 0x10ffff) return ' '
      try { return String.fromCodePoint(code) } catch (e) { return ' ' }
    }
    const key = body.toLowerCase()
    return Object.prototype.hasOwnProperty.call(NAMED, key) ? NAMED[key] : whole
  })

/** Control characters (except tab/newline, which `cleanText` folds into spaces) and bidi overrides. */
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g

/** Plain text of an HTML fragment: scripts and styles dropped, tags removed, entities decoded, spaces folded. */
export const stripTags = (html) => decodeEntities(String(html === undefined || html === null ? '' : html)
  .replace(/<!--[\s\S]*?-->/g, ' ')
  .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
  .replace(/<\/?(?:a|b|i|u|em|strong|span|code|mark|small|sub|sup|font|abbr|cite|q|s|wbr)\b[^>]*>/gi, '')
  .replace(/<[^>]*>/g, ' '))
  .replace(CONTROL, '')
  .replace(/\s+/g, ' ')
  .trim()

/** A snippet or title as the model will see it: no markup, no control characters, bounded. */
export const cleanText = (text, max = 400) => {
  const flat = String(text === undefined || text === null ? '' : text).replace(CONTROL, '').replace(/\s+/g, ' ').trim()
  return flat.length > max ? flat.slice(0, Math.max(0, max - 3)).trimEnd() + '...' : flat
}

/** `href` as an absolute http(s) URL, or null. No credentials, no overlong address, no fragment. */
export const safeUrl = (value, base) => {
  try {
    const raw = String(value === undefined || value === null ? '' : value).trim()
    if (raw === '' || raw.length > 2048) return null
    const u = new URL(raw, base)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    if (u.username !== '' || u.password !== '') return null
    if (u.hostname === '') return null
    u.hash = ''
    return u.href
  } catch (e) { return null }
}

/** Host of a URL without a leading `www.`, lower case; '' when it is not a URL. */
export const hostOf = (value) => {
  try { return new URL(String(value)).hostname.toLowerCase().replace(/^www\./, '') } catch (e) { return '' }
}

const attr = (tag, name) => {
  const m = new RegExp('\\b' + name + '\\s*=\\s*("([^"]*)"|\'([^\']*)\')', 'i').exec(tag)
  return m === null ? null : decodeEntities(m[2] !== undefined ? m[2] : m[3])
}

/** A `<div>` whose class LIST holds exactly this token (so `site-name-content` is not `content`): groups 1 = attrs, 2 = inner. */
const classToken = (token) => new RegExp('<div\\b([^>]*\\bclass="(?:[^"]*\\s)?' + token + '(?:\\s[^"]*)?"[^>]*)>([\\s\\S]*?)<\\/div>', 'i')

// ── Brave Search (HTML page) ────────────────────────────────────────────────────────────────────────
// The page is a Svelte render whose class names carry a hash that changes between releases, so nothing
// here keys on a hashed class. A web result is a block opened by `data-type="web"`; inside it the first
// absolute link is the result, the `title` element names it, and the `content` element says what is on it.

/** Organic results of a Brave Search HTML page. An empty list means "the layout did not match" or "no result". */
export const parseBraveHtml = (html) => {
  const out = []
  const text = String(html === undefined || html === null ? '' : html)
  const starts = []
  const marker = /<div\b[^>]*\bdata-type="web"[^>]*>/gi
  let m
  while ((m = marker.exec(text)) !== null) starts.push(m.index)
  for (let i = 0; i < starts.length; i += 1) {
    const chunk = text.slice(starts[i], i + 1 < starts.length ? starts[i + 1] : text.length)
    const link = /<a\b[^>]*\bhref="(https?:\/\/[^"]+)"[^>]*>/i.exec(chunk)
    if (link === null) continue
    const url = safeUrl(decodeEntities(link[1]))
    if (url === null || hostOf(url).endsWith('search.brave.com')) continue
    // Title: the element whose class list carries "title" (text), else its title attribute.
    let title = ''
    const titleEl = classToken('title').exec(chunk)
    if (titleEl !== null) title = stripTags(titleEl[2]) || attr(titleEl[1], 'title') || ''
    if (title === '') {
      const t = /<[^>]*\btitle="([^"]+)"/i.exec(chunk)
      if (t !== null) title = decodeEntities(t[1])
    }
    const contentEl = classToken('content').exec(chunk)
    const snippet = contentEl === null ? '' : stripTags(contentEl[2])
    out.push({ url, title: cleanText(title, 200), snippet: cleanText(snippet, 400) })
  }
  return out
}

// ── DuckDuckGo (HTML and Lite pages) ────────────────────────────────────────────────────────────────

/** DuckDuckGo answers a client it takes for a bot with a picture challenge (HTTP 202) instead of results. */
export const isDuckChallenge = (html, status) => {
  const text = String(html === undefined || html === null ? '' : html)
  return status === 202 || /bots use DuckDuckGo too|anomaly-modal|challenge-form/i.test(text)
}

/** `//duckduckgo.com/l/?uddg=<encoded>&rut=…` is a redirector: the target is in `uddg`. Direct links pass through. */
export const unwrapDuckUrl = (href) => {
  const raw = decodeEntities(href)
  try {
    const u = new URL(raw.startsWith('//') ? 'https:' + raw : raw, 'https://duckduckgo.com/')
    if (u.hostname.endsWith('duckduckgo.com') && u.pathname.startsWith('/l/')) {
      const target = u.searchParams.get('uddg')
      return target === null ? null : safeUrl(target)
    }
    if (u.hostname.endsWith('duckduckgo.com')) return null // an ad (`/y.js`) or an internal page
    return safeUrl(u.href)
  } catch (e) { return null }
}

/** Results of `html.duckduckgo.com/html`: `result__a` is the title link, `result__snippet` the excerpt. */
export const parseDuckHtml = (html) => {
  const out = []
  const text = String(html === undefined || html === null ? '' : html)
  const blocks = text.split(/<div\b[^>]*\bclass="[^"]*\bresult\b[^"]*"/i).slice(1)
  for (const block of blocks) {
    if (/\bresult--ad\b/.test(block.slice(0, 200))) continue
    const a = /<a\b[^>]*\bclass="[^"]*\bresult__a\b[^"]*"[^>]*>([\s\S]*?)<\/a>/i.exec(block)
    if (a === null) continue
    const tag = /<a\b[^>]*\bclass="[^"]*\bresult__a\b[^"]*"[^>]*>/i.exec(block)[0]
    const url = unwrapDuckUrl(attr(tag, 'href') || '')
    if (url === null) continue
    const s = /<a\b[^>]*\bclass="[^"]*\bresult__snippet\b[^"]*"[^>]*>([\s\S]*?)<\/a>/i.exec(block) ||
      /<div\b[^>]*\bclass="[^"]*\bresult__snippet\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(block)
    out.push({ url, title: cleanText(stripTags(a[1]), 200), snippet: cleanText(s === null ? '' : stripTags(s[1]), 400) })
  }
  return out
}

/** Results of `lite.duckduckgo.com/lite`: a table; `result-link` is the title, `result-snippet` the next cell. */
export const parseDuckLite = (html) => {
  const out = []
  const text = String(html === undefined || html === null ? '' : html)
  const re = /<a\b[^>]*\bclass=['"][^'"]*\bresult-link\b[^'"]*['"][^>]*>[\s\S]*?<\/a>/gi
  const hits = []
  let m
  while ((m = re.exec(text)) !== null) hits.push({ index: m.index, tag: m[0] })
  for (let i = 0; i < hits.length; i += 1) {
    const tag = hits[i].tag
    const url = unwrapDuckUrl(attr(tag, 'href') || '')
    if (url === null) continue
    const rest = text.slice(hits[i].index, i + 1 < hits.length ? hits[i + 1].index : text.length)
    const s = /<td\b[^>]*\bclass=['"][^'"]*\bresult-snippet\b[^'"]*['"][^>]*>([\s\S]*?)<\/td>/i.exec(rest)
    out.push({ url, title: cleanText(stripTags(tag), 200), snippet: cleanText(s === null ? '' : stripTags(s[1]), 400) })
  }
  return out
}

// ── Exa (anonymous MCP endpoint) ────────────────────────────────────────────────────────────────────

/** The body of an MCP `tools/call` answer: plain JSON, or one `event: message` / `data: {json}` frame. */
export const parseMcpBody = (raw) => {
  const text = String(raw === undefined || raw === null ? '' : raw).trim()
  if (text === '') return null
  try { return JSON.parse(text) } catch (e) { /* maybe an event stream */ }
  let last = null
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue
    try { last = JSON.parse(line.slice(5).trim()) } catch (e) { /* a partial frame */ }
  }
  return last
}

/** Exa's text answer is a list of `Title:/URL:/Published:/Highlights:` blocks separated by `---`. */
export const parseExaText = (text) => {
  const out = []
  for (const block of String(text === undefined || text === null ? '' : text).split(/\n\s*---\s*\n/)) {
    const url = /^URL:\s*(\S+)/m.exec(block)
    if (url === null) continue
    const safe = safeUrl(url[1])
    if (safe === null) continue
    const title = /^Title:\s*(.*)$/m.exec(block)
    const published = /^Published:\s*(.*)$/m.exec(block)
    const hl = /^Highlights:\s*\n([\s\S]*)$/m.exec(block)
    const item = { url: safe, title: cleanText(title === null ? '' : title[1], 200), snippet: cleanText(hl === null ? '' : hl[1], 400) }
    if (published !== null && /\d{4}/.test(published[1])) item.publishedAt = cleanText(published[1], 40)
    out.push(item)
  }
  return out
}

// ── result hygiene ──────────────────────────────────────────────────────────────────────────────────

/** Allow/block list in the OpenWebUI syntax: `example.com` allows, `!example.com` blocks, one per comma or line. */
export const parseDomainFilter = (raw) => {
  const allow = []
  const block = []
  for (const part of String(raw === undefined || raw === null ? '' : raw).split(/[\s,;]+/)) {
    let entry = part.trim().toLowerCase()
    if (entry === '') continue
    const blocked = entry.startsWith('!')
    if (blocked) entry = entry.slice(1)
    entry = entry.replace(/^[a-z]+:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '').replace(/^\*\./, '').replace(/^\.+/, '')
    if (!/^[a-z0-9.-]+$/.test(entry) || entry === '') continue
    ;(blocked ? block : allow).push(entry)
  }
  return { allow, block }
}

const hostMatches = (host, entry) => host === entry || host.endsWith('.' + entry)

/** True when the URL passes the filter: never blocked, and allowed when an allow list exists. */
export const passesFilter = (url, filter) => {
  const host = hostOf(url)
  if (host === '') return false
  if (filter.block.some((e) => hostMatches(host, e))) return false
  if (filter.allow.length > 0 && !filter.allow.some((e) => hostMatches(host, e))) return false
  return true
}

const TRACKING = /^(utm_[a-z]+|fbclid|gclid|msclkid|mc_cid|mc_eid|igshid|yclid|_hsenc|_hsmi)$/i

/** The key two URLs share when they are the same page: no scheme, no `www.`, no tracking, no trailing slash. */
export const dedupeKey = (url) => {
  try {
    const u = new URL(url)
    for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k)
    const path = u.pathname.replace(/\/+$/, '')
    return u.hostname.toLowerCase().replace(/^www\./, '') + path + (u.search || '')
  } catch (e) { return String(url) }
}

/** Cleans, filters and de-duplicates what an engine returned. Never throws; never returns an unsafe URL. */
export const tidyResults = (items, { filter = { allow: [], block: [] }, max = 50 } = {}) => {
  const seen = new Set()
  const out = []
  for (const it of Array.isArray(items) ? items : []) {
    if (it === null || typeof it !== 'object') continue
    const url = safeUrl(it.url)
    if (url === null || !passesFilter(url, filter)) continue
    const key = dedupeKey(url)
    if (seen.has(key)) continue
    seen.add(key)
    const row = { url }
    const title = cleanText(it.title, 200)
    const snippet = cleanText(it.snippet, 400)
    if (title !== '') row.title = title
    if (snippet !== '') row.snippet = snippet
    if (typeof it.publishedAt === 'string' && it.publishedAt.trim() !== '') row.publishedAt = cleanText(it.publishedAt, 40)
    out.push(row)
    if (out.length >= max) break
  }
  return out
}

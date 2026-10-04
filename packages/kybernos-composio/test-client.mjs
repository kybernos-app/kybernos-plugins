// ═══════════════════════════════════════════════════════════════════════════
// Tests for kybernos-composio/client.js, outside a browser.
//
//   node test-client.mjs
//
// The client is a file in the DSH module-loader format (`window.__ModuleLoader__.load`).
// We give it a fake loader and a fake `react`, then reach its two PURE parts through
// the `composio` export:
//   - webUrl     : the one URL rule (absolute http(s) only);
//   - carteHtml  : the HTML of a chat card, built from `kybernos-carte` JSON that is
//                  MODEL OUTPUT, so every value in it is untrusted.
// Also covered: the stored authorization link (localStorage is not trusted either)
// and the embedded catalog logos, which are injected as raw HTML.
// ═══════════════════════════════════════════════════════════════════════════

let echecs = 0
const ok = (label, cond, detail) => {
  if (cond) console.log(`✓ ${label}`)
  else { console.error(`✗ ${label}${detail === undefined ? '' : ` — ${detail}`}`); echecs += 1 }
}

// ── load the client with a fake loader ──────────────────────────────────────
let definition = null
globalThis.window = { __ModuleLoader__: { load: (def) => { definition = def } } }
const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)) },
  removeItem: (k) => { store.delete(k) },
}
await import(new URL('./client.js', import.meta.url).href)
ok('the client loads in the module-loader format', definition !== null && definition.id === '@local/kybernos-composio')
const fakeReact = { createElement: () => null }
const plugin = definition.factory((name) => { if (name === 'react') return fakeReact; throw new Error('unexpected require ' + name) })
const { webUrl, carteHtml, getLink, saveLink } = plugin.composio
ok('the pure URL rule and the card renderer are reachable', typeof webUrl === 'function' && typeof carteHtml === 'function')
if (typeof webUrl !== 'function' || typeof carteHtml !== 'function') { console.error('\n✗ cannot continue'); process.exit(1) }

// A card's action is the only `<a class="kbcp-carte-action"`; the optional
// "all connectors" link has its own class and is not part of these checks.
const ACTION_LINK = /<a class="kbcp-carte-action"/
const carte = (actionUrl, extra) => carteHtml(Object.assign({ titre: 'T', actionLabel: 'Open it', actionUrl: actionUrl }, extra || {}))
const hrefOf = (html) => { const m = /<a class="kbcp-carte-action" href="([^"]*)"/.exec(html); return m === null ? null : m[1] }

// ── card action: what must NOT become a link ────────────────────────────────
const refused = [
  ['javascript: URL', 'javascript:alert(1)'],
  ['JAVASCRIPT: in capitals', 'JAVASCRIPT:alert(document.cookie)'],
  ['javascript: after a leading space', '  javascript:alert(1)'],
  ['javascript: with a tab inside the scheme', 'java\tscript:alert(1)'],
  ['javascript: with a newline inside the scheme', 'java\nscript:alert(1)'],
  ['data: URL', 'data:text/html,<script>alert(1)</script>'],
  ['data: URL, base64', 'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=='],
  ['vbscript: URL', 'vbscript:msgbox(1)'],
  ['file: URL', 'file:///etc/passwd'],
  ['blob: URL', 'blob:https://example.com/1234'],
  ['ftp: URL', 'ftp://example.com/x'],
  ['relative path', '/settings/keys'],
  ['relative path without a slash', 'settings/keys'],
  ['protocol-relative URL', '//evil.example/x'],
  ['bare host', 'example.com'],
  ['malformed https URL', 'https://'],
  ['malformed https URL with a bad port', 'https://example.com:notaport/x'],
  ['malformed https URL with a space in the host', 'https://exa mple.com/x'],
  ['scheme only', 'https:'],
  ['upper-case KB: (the click listener matches lowercase only)', 'KB:accept:hello'],
  ['empty string', ''],
  ['a number', 123],
  ['an object', { href: 'https://example.com' }],
  ['an array', ['https://example.com']],
  ['null', null],
  ['undefined', undefined],
]
for (const [label, value] of refused) {
  const html = carte(value)
  ok(`card: ${label} is not an <a>`, ACTION_LINK.test(html) === false && /href="\s*(javascript|data|vbscript):/i.test(html) === false, html.slice(-120))
  ok(`card: ${label} still shows the label as plain text`, html.includes('<span class="kbcp-carte-ghost">Open it</span>'))
}

// ── card action: what must become a link ────────────────────────────────────
{
  const html = carte('https://example.com/connect?a=1&b=2')
  ok('card: an https URL is an <a>', ACTION_LINK.test(html))
  ok('card: the https link keeps the URL (HTML-escaped)', hrefOf(html) === 'https://example.com/connect?a=1&amp;b=2', String(hrefOf(html)))
  ok('card: the https link opens in a new tab with rel="noreferrer noopener"', html.includes('target="_blank" rel="noreferrer noopener"'))
  ok('card: the link text is the label', html.includes('>Open it</a>'))
}
ok('card: an http URL is an <a>', ACTION_LINK.test(carte('http://localhost:3080/x')))
ok('card: an upper-case HTTPS scheme is an <a>', ACTION_LINK.test(carte('HTTPS://example.com/x')))
ok('card: an https URL with surrounding whitespace is an <a>, normalised', hrefOf(carte('  https://example.com/x \n')) === 'https://example.com/x')

// ── card action: internal kb: commands keep working ─────────────────────────
{
  const html = carte('kb:accept:Yes%20please')
  ok('card: kb:accept:<text> stays an <a> (the bundle intercepts it)', ACTION_LINK.test(html) && hrefOf(html) === 'kb:accept:Yes%20please', String(hrefOf(html)))
  ok('card: a kb: action has no target="_blank"', html.includes('target=') === false)
  ok('card: kb:<tab> stays an <a>', hrefOf(carte('kb:composio')) === 'kb:composio')
}

// ── card: everything else stays escaped ─────────────────────────────────────
{
  const html = carte('javascript:alert(1)', { actionLabel: '<img src=x onerror=alert(1)>' })
  ok('card: a hostile label is escaped (refused URL)', html.includes('&lt;img src=x onerror=alert(1)&gt;') && html.includes('<img') === false)
}
{
  const html = carte('https://example.com/x', { actionLabel: '"><img src=x onerror=alert(1)>' })
  ok('card: a hostile label is escaped (allowed URL)', html.includes('<img') === false && html.includes('&quot;&gt;&lt;img'))
}
{
  const html = carte('https://example.com/"><img src=x onerror=alert(1)>')
  ok('card: a URL cannot break out of the href attribute', ACTION_LINK.test(html) && html.includes('<img') === false && hrefOf(html) !== null && hrefOf(html).includes('"') === false, String(hrefOf(html)))
}
{
  const html = carteHtml({ titre: '<b>x</b>', type: '<i>', desc: '<u>', note: '<s>', etatLabel: '<em>', icon: '<svg onload=alert(1)>' })
  ok('card: title, type, description, note, state label and icon are escaped', /<(b|i|u|s|em|svg)[ >]/.test(html) === false, html.slice(0, 160))
}

// ── the URL rule itself ─────────────────────────────────────────────────────
ok('webUrl: https passes', webUrl('https://app.composio.dev/auth?x=1') === 'https://app.composio.dev/auth?x=1')
ok('webUrl: http passes', webUrl('http://127.0.0.1:3080/') === 'http://127.0.0.1:3080/')
ok('webUrl: javascript: is refused', webUrl('javascript:alert(1)') === null)
ok('webUrl: data: is refused', webUrl('data:text/html,x') === null)
ok('webUrl: a relative URL is refused', webUrl('/a/b') === null)
ok('webUrl: a non-string is refused', webUrl(undefined) === null && webUrl(null) === null && webUrl(42) === null)

// ── the stored authorization link ───────────────────────────────────────────
// `connect` opens a redirect URL taken from the MCP server's reply, and a link is
// kept in localStorage for 10 minutes; both end in window.open or an <a href>.
{
  store.clear()
  saveLink('gmail', 'javascript:alert(1)')
  ok('saveLink: a javascript: link is not stored', store.size === 0)
  saveLink('gmail', 'data:text/html,x')
  ok('saveLink: a data: link is not stored', store.size === 0)
  saveLink('gmail', 'https://auth.example/oauth?s=1')
  ok('saveLink: an https link is stored and read back', getLink('gmail') === 'https://auth.example/oauth?s=1')
  store.set('composio.authLinks', JSON.stringify({ slack: { url: 'javascript:alert(1)', at: Date.now() }, notion: 'data:text/html,x' }))
  ok('getLink: a javascript: link already in localStorage is not returned', getLink('slack') === null)
  ok('getLink: a data: link already in localStorage (old string format) is not returned', getLink('notion') === null)
  store.set('composio.authLinks', JSON.stringify({ gmail: { url: 'https://auth.example/old', at: Date.now() - 11 * 60 * 1000 } }))
  ok('getLink: an expired link is still hidden', getLink('gmail') === null)
  store.clear()
}

// ── the embedded catalog logos are injected as raw HTML ─────────────────────
{
  const { CATALOG } = await import(new URL('./catalog.js', import.meta.url).href)
  const logos = CATALOG.filter((a) => typeof a.l === 'string' && a.l.length > 0)
  const active = logos.filter((a) => /<script|<foreignObject|<iframe|<object|<embed|\son\w+\s*=|javascript:/i.test(a.l)).map((a) => a.s)
  ok(`catalog: ${logos.length} logos carry no script, event handler, javascript: or embedded document`, logos.length > 0 && active.length === 0, active.join(','))
}

console.log(echecs === 0 ? '\nClient: all green.' : `\n✗ ${echecs} failure(s)`)
process.exit(echecs === 0 ? 0 : 1)

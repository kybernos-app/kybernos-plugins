#!/usr/bin/env node
// kybernos-websearch: text and HTML helpers. The HTML fixtures below keep the STRUCTURE of the live pages (read on
// 2026-10-12: Brave results page, DuckDuckGo HTML and Lite markup) with made-up content.
import {
  cleanText, decodeEntities, dedupeKey, hostOf, isDuckChallenge, parseBraveHtml, parseDomainFilter, parseDuckHtml, parseDuckLite,
  parseExaText, parseMcpBody, passesFilter, safeUrl, stripTags, tidyResults, unwrapDuckUrl
} from './parse.mjs'

let fail = 0
const ok = (name, cond, detail) => {
  if (cond === true) console.log('  ✓ ' + name)
  else { fail += 1; console.log('  ✗ ' + name + (detail !== undefined ? ' → ' + String(detail).slice(0, 200) : '')) }
}
const eq = (name, a, b) => ok(name, JSON.stringify(a) === JSON.stringify(b), JSON.stringify(a))

// ── text ────────────────────────────────────────────────────────────────────────────────────────────
eq('entities: named, decimal, hex, unknown left alone', decodeEntities('a &amp; b &#39;c&#x27;&nbsp;d &unknown;'), "a & b 'c' d &unknown;")
eq('stripTags drops scripts, styles, comments and tags', stripTags('<p>Hi <b>there</b><script>alert(1)</script><style>x{}</style><!-- c --> &lt;ok&gt;</p>'), 'Hi there <ok>')
eq('cleanText folds spaces and removes control and bidi characters', cleanText('a\u0000‮  b\n\tc'), 'a b c')
ok('cleanText cuts at the bound with an ellipsis', cleanText('x'.repeat(50), 10) === 'xxxxxxx...', cleanText('x'.repeat(50), 10))

// ── URLs ────────────────────────────────────────────────────────────────────────────────────────────
eq('safeUrl keeps http(s) and drops the fragment', safeUrl('https://example.com/a?b=1#frag'), 'https://example.com/a?b=1')
eq('safeUrl refuses javascript:', safeUrl('javascript:alert(1)'), null)
eq('safeUrl refuses data:', safeUrl('data:text/html,<b>x</b>'), null)
eq('safeUrl refuses a URL with credentials', safeUrl('https://user:pw@example.com/'), null)
eq('safeUrl refuses a relative address with no base', safeUrl('/just/a/path'), null)
eq('safeUrl refuses an overlong address', safeUrl('https://example.com/' + 'a'.repeat(2100)), null)
eq('hostOf drops www and lower-cases', hostOf('https://WWW.Example.COM/x'), 'example.com')

// ── Brave ───────────────────────────────────────────────────────────────────────────────────────────
const BRAVE = `<main><section id="mixed-main">
<div class="snippet svelte-aaa" data-pos="0" data-type="web" data-keynav="true"><div class="result-body"><div class="result-wrapper"><div class="result-content">
<a href="https://docs.example.org/guide?utm_source=x" target="_self" class="svelte-xyz l1"><div class="site-name-wrapper"><div class="site-name-content svelte-q"><div class="desktop-small-semibold">Example Docs</div></div></div>
<div class="title search-snippet-title line-clamp-1 svelte-14r" title="Guide &amp; reference">Guide &amp; reference <b>for</b> Example</div></a>
<div class="generic-snippet"><div class="content desktop-default-regular t-primary svelte-1cw"><span class="t-secondary">July 20, 2026 -</span> <strong>Example</strong> is an open <em>thing</em>.</div></div>
</div></div></div></div>
<div class="snippet svelte-aaa" data-pos="1" data-type="news"><a href="https://news.example.net/a" class="l1"><div class="title">A news card</div></a></div>
<div class="snippet svelte-aaa" data-pos="2" data-type="web"><a href="https://search.brave.com/images?q=x" class="l1"><div class="title">Brave's own page</div></a></div>
<div class="snippet svelte-aaa" data-pos="3" data-type="web"><a href="javascript:void(0)" class="l1"><div class="title">Bad scheme</div></a></div>
<div class="snippet svelte-aaa" data-pos="4" data-type="web"><a href="https://blog.example.com/post" class="l1"><div class="title search-snippet-title">Second hit</div></a></div>
</section></main>`
const b = parseBraveHtml(BRAVE)
eq('brave: only organic http(s) results that are not Brave itself', b.map((r) => r.url), ['https://docs.example.org/guide?utm_source=x', 'https://blog.example.com/post'])
eq('brave: the title is the title element, entities decoded, tags gone', b[0].title, 'Guide & reference for Example')
eq('brave: the snippet is the content element, not the site name', b[0].snippet, 'July 20, 2026 - Example is an open thing.')
eq('brave: a result with no content has an empty snippet', b[1].snippet, '')
eq('brave: a page with no result block parses to nothing', parseBraveHtml('<html><title>Brave Search</title><body>nothing</body></html>'), [])

// ── DuckDuckGo ──────────────────────────────────────────────────────────────────────────────────────
const DDG = `<div class="serp__results">
<div class="result results_links results_links_deep web-result"><div class="links_main links_deep result__body">
<h2 class="result__title"><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpage%3Fa%3D1%26b%3D2&amp;rut=abc">Example <b>page</b></a></h2>
<a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpage">A <b>snippet</b> &amp; more</a></div></div>
<div class="result result--ad"><h2 class="result__title"><a class="result__a" href="https://duckduckgo.com/y.js?ad_domain=shop.example&amp;u=1">Sponsored</a></h2></div>
<div class="result results_links"><h2 class="result__title"><a class="result__a" href="https://direct.example.net/x">Direct link</a></h2><a class="result__snippet">Direct snippet</a></div>
</div>`
const d = parseDuckHtml(DDG)
eq('duckduckgo html: redirector unwrapped, ad skipped, direct link kept', d.map((r) => r.url), ['https://example.com/page?a=1&b=2', 'https://direct.example.net/x'])
eq('duckduckgo html: title and snippet are text', [d[0].title, d[0].snippet], ['Example page', 'A snippet & more'])
eq('unwrapDuckUrl: an internal page is not a result', unwrapDuckUrl('https://duckduckgo.com/about'), null)
const LITE = `<table><tr><td valign="top">1.&nbsp;</td><td><a rel="nofollow" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Flite.example.com%2F&amp;rut=z" class='result-link'>Lite title</a></td></tr>
<tr><td>&nbsp;</td><td class='result-snippet'>Lite <b>snippet</b></td></tr>
<tr><td>&nbsp;</td><td><span class='link-text'>lite.example.com</span></td></tr></table>`
const l = parseDuckLite(LITE)
eq('duckduckgo lite: link, title and the snippet cell', l, [{ url: 'https://lite.example.com/', title: 'Lite title', snippet: 'Lite snippet' }])
ok('duckduckgo: the picture challenge is recognised (HTTP 202 and text)', isDuckChallenge('', 202) && isDuckChallenge('Unfortunately, bots use DuckDuckGo too.', 200) && !isDuckChallenge(DDG, 200))

// ── Exa (MCP) ───────────────────────────────────────────────────────────────────────────────────────
const EXA_TEXT = 'Title: First result\nURL: https://one.example.com/a\nPublished: 2026-09-01T00:00:00.000Z\nAuthor: N/A\nHighlights:\nThe first excerpt.\n...\nmore of it\n\n---\n\nTitle: Second\nURL: https://two.example.org/\nPublished: N/A\nAuthor: N/A\nHighlights:\nSecond excerpt'
const ex = parseExaText(EXA_TEXT)
eq('exa: two blocks, URLs and titles', ex.map((r) => [r.url, r.title]), [['https://one.example.com/a', 'First result'], ['https://two.example.org/', 'Second']])
eq('exa: the date is kept when there is one, the excerpt is the highlights', [ex[0].publishedAt, ex[0].snippet, ex[1].publishedAt], ['2026-09-01T00:00:00.000Z', 'The first excerpt. ... more of it', undefined])
const frame = JSON.stringify({ result: { content: [{ type: 'text', text: 'ok' }] } })
eq('mcp body: plain JSON', parseMcpBody(frame).result.content[0].text, 'ok')
eq('mcp body: one event-stream frame', parseMcpBody('event: message\ndata: ' + frame + '\n\n').result.content[0].text, 'ok')
eq('mcp body: junk is null', parseMcpBody('<html>'), null)

// ── filters and hygiene ─────────────────────────────────────────────────────────────────────────────
const f = parseDomainFilter('example.com, !spam.example\nhttps://www.docs.rs/x ; *.mdn.dev bad_domain!')
eq('domain filter: allow, block, scheme/www/path/wildcard stripped, junk dropped', f, { allow: ['example.com', 'docs.rs', 'mdn.dev'], block: ['spam.example'] })
ok('filter: an allow list lets its domains and their subdomains through only', passesFilter('https://a.example.com/x', f) && !passesFilter('https://other.org/', f))
ok('filter: a block beats an allow', !passesFilter('https://spam.example/', parseDomainFilter('spam.example, !spam.example')))
ok('filter: with no allow list everything but the blocked passes', passesFilter('https://any.org/', parseDomainFilter('!bad.org')) && !passesFilter('https://sub.bad.org/', parseDomainFilter('!bad.org')))
eq('dedupeKey: scheme, www, tracking and trailing slash do not make a different page', dedupeKey('http://www.example.com/a/?utm_source=x'), dedupeKey('https://example.com/a'))
const t = tidyResults([
  { url: 'https://example.com/a?utm_source=x', title: ' A  title ', snippet: 'x' },
  { url: 'https://www.example.com/a', title: 'dup' },
  { url: 'javascript:alert(1)', title: 'bad' },
  { url: 'https://spam.example/', title: 'blocked' },
  null,
  { url: 'https://ok.example.net/', title: '', snippet: '<b>s</b>' }
], { filter: parseDomainFilter('!spam.example') })
eq('tidyResults: cleaned, de-duplicated, filtered, no unsafe URL', t, [{ url: 'https://example.com/a?utm_source=x', title: 'A title', snippet: 'x' }, { url: 'https://ok.example.net/', snippet: '<b>s</b>' }])

console.log('\n' + (fail === 0 ? 'ALL CHECKS OK' : fail + ' check(s) FAILED'))
process.exit(fail === 0 ? 0 : 1)

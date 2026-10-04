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
  // structural defects: a logo is raw HTML in the page, so mangled markup is not cosmetic
  const { svgProblems, repairSvg } = await import(new URL('./scripts/svg-check.mjs', import.meta.url).href)
  const broken = logos.map((a) => [a.s, svgProblems(a.l)]).filter(([, p]) => p.length > 0)
  ok(`catalog: ${logos.length} logos are well formed (known elements, no dangling url(#id) or href, no relative image URL)`, broken.length === 0, broken.slice(0, 3).map(([s, p]) => s + ': ' + p[0]).join(' | '))
  const gcal = CATALOG.find((a) => a.s === 'googlecalendar')
  ok('catalog: the Google Calendar logo has its gradients and filter (it had unknown <linearGradientid=...> elements)', gcal !== undefined && typeof gcal.l === 'string' && gcal.l.includes('<linearGradient id="lgb-googlecalendar-') && gcal.l.includes('<feFlood flood-opacity="0"') && gcal.l.includes('<linearGradientid') === false && /id="[^"]*""/.test(gcal.l) === false)
  ok('catalog: an app whose logo cannot be rebuilt has none (the page draws its initial), not a broken one', CATALOG.find((a) => a.s === 'airparser').l === null && CATALOG.every((a) => a.l === null || /href="(?!#|data:)/.test(a.l) === false))

  // the checker itself: each shape of the defects found in the data, and what must stay legal
  const svg = (inner, root) => '<svg viewBox="0 0 10 10"' + (root || '') + '>' + inner + '</svg>'
  const bad = [
    ['a tag name glued to its first attribute', svg('<defs><linearGradientid="a"x1="1"></linearGradientid></defs>')],
    ['an unknown element', svg('<blink/>')],
    ['a script element', svg('<script>alert(1)</script>')],
    ['a foreignObject', svg('<foreignObject><p>x</p></foreignObject>')],
    ['a split tag name', svg('<defs><line arGradient id="a"></line></defs>')],
    ['an attribute without a space before it', svg('<rect width="1"height="2"/>')],
    ['a doubled closing quote on the root', svg('<rect/>', ' id="a"" xmlns="http://www.w3.org/2000/svg"')],
    ['an attribute without a value', svg('<rect fill/>')],
    ['a url(#id) to a missing id', svg('<rect fill="url(#nope)"/>')],
    ['an href to a missing id', svg('<use href="#nope"/>')],
    ['a relative image href', svg('<image href="kyb-x-a-dataimagepng"/>')],
    ['a remote image href', svg('<image href="https://example.com/a.png"/>')],
    ['a javascript: href', svg('<image href="javascript:alert(1)"/>')],
    ['an unclosed element', svg('<g>')],
    ['a closing tag that does not match', svg('<g></defs>')],
    ['two roots', svg('') + svg('')],
    ['text outside the root', 'x' + svg('')],
    ['a repeated id', svg('<g id="a"/><g id="a"/>')],
  ]
  for (const [label, s] of bad) ok(`svg check: ${label} is a defect`, svgProblems(s).length > 0, JSON.stringify(svgProblems(s)))
  const good = [
    ['a plain shape', svg('<path d="M0 0h1z"/>')],
    ['a gradient used by a fill', svg('<defs><linearGradient id="a" x1="0"><stop offset="0"/></linearGradient></defs><rect fill="url(#a)"/>')],
    ['an href to an existing id', svg('<defs><path id="p" d="M0 0"/></defs><use href="#p"/><use xlink:href="#p"/>')],
    ['an inline PNG', svg('<image href="data:image/png;base64,iVBORw0KGgo+/AA=="/>')],
    ['an empty attribute value', svg('<rect fill=""/>')],
    ['single-quoted attributes', svg("<rect fill='#fff'/>")],
    ['a title', svg('<title>Name</title>')],
  ]
  for (const [label, s] of good) ok(`svg check: ${label} passes`, svgProblems(s).length === 0, JSON.stringify(svgProblems(s)))
  // the repair: the shapes found in the data are fixed, and a sound SVG is not touched
  const fixed = repairSvg('<svg viewBox="0 0 10 10" id="a"" xmlns="http://www.w3.org/2000/svg"><defs><linearGradientid="g"x1="1"x2="2" gradientUnits="userSpaceOnUse"><stop offset="0"/></linearGradient><filter id="f"><feFloodflood -opacity="0" result="r"/><feBlendi n="SourceGraphic"in2="r" mode="normal"/><feGaussianBlurresul t="e" stdDeviation="6"/></filter></defs><rect fill="url(#g)" filter="url(#f)"/></svg>')
  ok('svg repair: the mangled gradient, filter and root are repaired into a passing SVG', svgProblems(fixed).length === 0 && fixed.includes('<linearGradient id="g" x1="1" x2="2"') && fixed.includes('<feFlood flood-opacity="0"') && fixed.includes('<feBlend in="SourceGraphic" in2="r"') && fixed.includes('<feGaussianBlur result="e"'), JSON.stringify(svgProblems(fixed)))
  const sound = svg('<g id="a"><path d="M0 0" fill=""/></g><rect fill="url(#a)" id="b"/>')
  ok('svg repair: a sound SVG is returned unchanged (empty attribute values included)', repairSvg(sound) === sound)
  ok('svg repair: it is idempotent', repairSvg(repairSvg(fixed)) === repairSvg(fixed))
  ok('svg repair: what it cannot fix is still reported', svgProblems(repairSvg(svg('<rect fill="url(#nope)"/><image href="x"/>'))).length >= 2)
}

// ── the minimal MCP client (kbCpCall) ───────────────────────────────────────
// It talks to connect.composio.dev with the key kept in localStorage. Everything below runs
// against a stubbed fetch: no network.
{
  const { call, errText, hostState, mcpTimeout, carteAccepter } = plugin.composio
  const appels = []
  const stubFetch = (handler) => {
    appels.length = 0
    globalThis.fetch = async (url, init) => {
      const rec = { url: String(url), headers: Object.assign({}, init.headers), body: JSON.parse(init.body), signal: init.signal }
      appels.push(rec)
      if (rec.url !== 'https://connect.composio.dev/mcp') throw new Error('STUB: unexpected URL ' + rec.url)
      return handler(rec)
    }
  }
  const rep = (obj, status = 200, headers = {}) => ({ ok: status >= 200 && status < 300, status, headers: { get: (k) => (headers[String(k).toLowerCase()] !== undefined ? headers[String(k).toLowerCase()] : null) }, text: async () => JSON.stringify(obj) })
  const init = (sid) => rep({ jsonrpc: '2.0', id: 1, result: {} }, 200, sid === undefined ? {} : { 'mcp-session-id': sid })
  const outil = (texte) => rep({ jsonrpc: '2.0', id: 2, result: { content: [{ type: 'text', text: texte }] } })
  const cle = (k) => { store.set('composio.apiKey', k) }
  const echec = async (p) => { try { await p; return null } catch (e) { return e } }
  const course = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(() => r('TIMEOUT'), ms))])
  const methode = (rec) => rec.body.method
  const nbInit = () => appels.filter((c) => methode(c) === 'initialize').length

  store.clear()
  const e0 = await echec(call('T', {}))
  ok('mcp: a call without a key is refused before any request', e0 !== null && e0.message === 'nokey')

  // a mistyped key (401), then the right one: it must work without reloading the page
  cle('ck_typo')
  stubFetch((r) => (r.headers['x-consumer-api-key'] === 'ck_right' ? (methode(r) === 'initialize' ? init('S-right') : outil('"fine"')) : rep({ error: { message: 'Unauthorized' } }, 401)))
  const e1 = await echec(call('T', {}))
  ok('mcp: a rejected key fails with code 401', e1 !== null && e1.code === '401' && /Unauthorized/.test(e1.message), e1 && e1.message)
  cle('ck_right')
  const r1 = await echec(call('T', {}))
  ok('mcp: after the key is fixed the next call works (the failure was not memoised)', r1 === null, String(r1 && r1.message))
  ok('mcp: ...it initialized again with the right key', appels.filter((c) => methode(c) === 'initialize' && c.headers['x-consumer-api-key'] === 'ck_right').length === 1)

  // a failed initialize with the SAME key is retried by the next call
  cle('ck_retry')
  let n = 0
  stubFetch((r) => { if (methode(r) === 'initialize') { n += 1; return n === 1 ? rep({}, 500) : init('S-retry') } return outil('1') })
  const e2 = await echec(call('T', {}))
  const e3 = await echec(call('T', {}))
  ok('mcp: a failed initialize is retried on the next call (same key)', e2 !== null && e2.code === '500' && e3 === null && n === 2, `${e2 && e2.code} ${e3 && e3.message} n=${n}`)

  // the session belongs to a key
  cle('ck_one')
  stubFetch((r) => { const k = r.headers['x-consumer-api-key']; return methode(r) === 'initialize' ? init('S-' + k) : (r.headers['Mcp-Session-Id'] === 'S-' + k ? outil('1') : rep({}, 404)) })
  await call('T', {})
  cle('ck_two')
  const e4 = await echec(call('T', {}))
  cle('ck_one')
  const e5 = await echec(call('T', {}))
  ok('mcp: the old Mcp-Session-Id is never sent with another key', e4 === null && e5 === null, `${e4 && e4.message} ${e5 && e5.message}`)
  ok('mcp: the first initialize of a new key carries no session id', appels.filter((c) => methode(c) === 'initialize').every((c) => c.headers['Mcp-Session-Id'] === undefined))

  // an expired session (404) is started again, once
  cle('ck_exp')
  let ini = 0
  let expirer = false
  stubFetch((r) => {
    if (methode(r) === 'initialize') { ini += 1; return init('S' + ini) }
    return expirer && r.headers['Mcp-Session-Id'] === 'S1' ? rep({ error: { message: 'session not found' } }, 404) : outil('"ok"')
  })
  await call('T', {})
  expirer = true
  const e6 = await echec(call('T', {}))
  ok('mcp: a 404 (expired session) starts a new session and the call succeeds', e6 === null && ini === 2, `${e6 && e6.message} ini=${ini}`)
  stubFetch((r) => (methode(r) === 'initialize' ? init('S-x') : rep({ error: { message: 'gone' } }, 404)))
  cle('ck_exp2')
  const e7 = await echec(call('T', {}))
  ok('mcp: a 404 that persists is reported after one retry', e7 !== null && e7.code === '404' && nbInit() === 2, `${e7 && e7.code} inits=${nbInit()}`)

  // deadlines: headers and body
  const ms0 = mcpTimeout.ms
  mcpTimeout.ms = 120
  try {
    cle('ck_slow')
    stubFetch(() => new Promise(() => {}))
    const t1 = await course(echec(call('T', {})), 2000)
    ok('mcp: a fetch that never answers is cut by the timeout (code timeout)', t1 !== 'TIMEOUT' && t1 !== null && t1.code === 'timeout', String(t1 && t1.code))
    stubFetch((r) => (methode(r) === 'initialize' ? init('S-slow') : { ok: true, status: 200, headers: { get: () => null }, text: () => new Promise(() => {}) }))
    const t2 = await course(echec(call('T', {})), 2000)
    ok('mcp: a body that never arrives is cut as well', t2 !== 'TIMEOUT' && t2 !== null && t2.code === 'timeout', String(t2 && t2.code))
    stubFetch((r) => (methode(r) === 'initialize' ? init('S-slow2') : outil('1')))
    const t3 = await course(echec(call('T', {})), 2000)
    ok('mcp: ...and the next call is not stuck behind it', t3 === null)
    stubFetch(() => { throw new TypeError('Failed to fetch') })
    cle('ck_off')
    const t4 = await echec(call('T', {}))
    ok('mcp: a network failure has code offline', t4 !== null && t4.code === 'offline', String(t4 && t4.code))
  } finally { mcpTimeout.ms = ms0 }

  // what a failure says
  ok('errText: 401 and 403 say the key was rejected', /401/.test(errText('401')) && errText('403') === errText('401'))
  ok('errText: 429, timeout and offline each have their own sentence', new Set([errText('429'), errText('timeout'), errText('offline'), errText('401')]).size === 4)
  ok('errText: any other code is carried in the sentence', errText('bad-response').includes('bad-response') && errText(undefined).includes('?'))
  // the key panel: what the host says
  ok('hostState: a key on the host and no error is ok', hostState({ ok: true, configured: true, error: null }).level === 'ok')
  ok('hostState: no key on the host is a warning, whatever the browser holds', hostState({ ok: true, configured: false, error: 'no-credential' }).level === 'warn' && hostState({ ok: true, configured: false }).key === 'composio.hostmissing')
  ok('hostState: a key the host has but Composio rejects is bad', hostState({ ok: true, configured: true, error: '401' }).level === 'bad')
  ok('hostState: another failure is a warning, not a green light', hostState({ ok: true, configured: true, error: 'timeout' }).level === 'warn')
  ok('hostState: an unusable reply (plugin not there) is unknown', hostState(null).level === 'unknown' && hostState({ ok: false }).level === 'unknown' && hostState('x').level === 'unknown')

  // C-14: a card action that sends text into the conversation shows it first
  const envoi = []
  const enc = (s) => 'kb:accept:' + encodeURIComponent(s)
  ok('accept: a click that is not an accept action is not handled', carteAccepter('https://x.test/', () => true, (x) => envoi.push(x)) === false && carteAccepter('kb:composio', () => true, (x) => envoi.push(x)) === false && carteAccepter(undefined, () => true, (x) => envoi.push(x)) === false && envoi.length === 0)
  let montre = null
  ok('accept: the confirmation gets the exact decoded text', carteAccepter(enc('Oui, résilie le contrat 42 & envoie-le'), (x) => { montre = x; return false }, (x) => envoi.push(x)) === true && montre === 'Oui, résilie le contrat 42 & envoie-le')
  ok('accept: nothing is sent when the user declines', envoi.length === 0)
  carteAccepter(enc('Send it'), () => true, (x) => envoi.push(x))
  ok('accept: the confirmed text is sent, and only that', envoi.length === 1 && envoi[0] === 'Send it')
  carteAccepter(enc('Maybe'), () => undefined, (x) => envoi.push(x))
  carteAccepter(enc('Maybe'), () => 'yes', (x) => envoi.push(x))
  ok('accept: only a true answer counts as consent', envoi.length === 1)
  let confirme = false
  let refus = null
  const longTexte = 'x'.repeat(2001)
  ok('accept: a text over 2000 characters is handled but refused, never confirmed nor sent', carteAccepter(enc(longTexte), () => { confirme = true; return true }, (x) => envoi.push(x), (x) => { refus = x.length }) === true && confirme === false && envoi.length === 1 && refus === 2001)
  ok('accept: 2000 characters is still allowed', carteAccepter(enc('y'.repeat(2000)), () => true, (x) => envoi.push(x)) === true && envoi.length === 2)
  ok('accept: a malformed %-escape is passed on as it is (and shown as it is)', carteAccepter('kb:accept:100%', (x) => { montre = x; return true }, (x) => envoi.push(x)) === true && montre === '100%')
}

// ── C-16 / C-20: the form, the search, storage that throws, other locales ───
{
  const { joinArgs, match, parse, mode, setMode, has, t } = plugin.composio
  const { splitArgs } = await import(new URL('./index.js', import.meta.url).href)
  // the args field: what the form shows is read back by the host exactly
  ok('joinArgs: plain arguments are joined by a space', joinArgs(['--port', '3000']) === '--port 3000')
  ok('joinArgs: an argument with a space is quoted (a path with a space)', joinArgs(['/Users/me/Jane Doe/server.mjs', '--x']) === '"/Users/me/Jane Doe/server.mjs" --x')
  let seed = 7
  const rand = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n }
  const alphabet = ['a', 'b', '-', '/', ' ', ' ', '"', "'", '\\', '=', '$', '#', 'é', '.', '0']
  let ecarts = []
  for (let i = 0; i < 2000; i += 1) {
    const list = []
    for (let k = rand(4) + 1; k > 0; k -= 1) { let s = ''; for (let m = rand(8) + 1; m > 0; m -= 1) s += alphabet[rand(alphabet.length)]; list.push(s) }
    const wanted = list.filter((s) => s.length > 0)
    const back = splitArgs(joinArgs(wanted))
    if (back.args === undefined || JSON.stringify(back.args) !== JSON.stringify(wanted)) ecarts.push(JSON.stringify(wanted) + ' -> ' + joinArgs(wanted) + ' -> ' + JSON.stringify(back))
  }
  ok('joinArgs/splitArgs: 2000 random argument lists with spaces, quotes and backslashes survive the round trip', ecarts.length === 0, ecarts.slice(0, 2).join(' | '))
  // the search
  const { CATALOG } = await import(new URL('./catalog.js', import.meta.url).href)
  const named = (q) => CATALOG.filter((a) => match(a, q)).map((a) => a.s)
  ok('search: "billing", "invoice" and "facturation" find the accounting and payment apps (the placeholder promises it)', ['billing', 'invoice', 'facturation', 'Facture'].every((q) => ['quickbooks', 'stripe'].every((s) => named(q).includes(s))), JSON.stringify(named('billing')))
  ok('search: ...and not everything', named('billing').length < 10)
  ok('search: the slug without spaces finds the app (googlecalendar, google-calendar, google calendar)', ['googlecalendar', 'google-calendar', 'Google Calendar'].every((q) => named(q).includes('googlecalendar')))
  ok('search: a name still matches, case aside', named('SLACK').includes('slack'))
  ok('search: under 2 characters everything matches', CATALOG.every((a) => match(a, 'a')) && CATALOG.every((a) => match(a, '')))
  ok('search: nonsense matches nothing', named('zzzzqqqq').length === 0)
  ok('search: an alias needs 3 letters (a "bi" is not billing)', named('bi').every((s) => { const a = CATALOG.find((x) => x.s === s); return JSON.stringify(a).toLowerCase().includes('bi') }))
  // a null in the account list used to throw
  let jete = null
  let parsed = null
  try { parsed = parse({ data: { results: { gmail: { status: 'active', accounts: [null, { id: 'ca_1', status: 'ACTIVE' }, 'x', undefined] }, slack: null } } }) } catch (e) { jete = e }
  ok('parse: a null or non-object account does not throw (it is skipped)', jete === null && parsed.gmail.accounts.length === 1 && parsed.gmail.accounts[0].id === 'ca_1', String(jete && jete.message))
  // storage that throws (private window, blocked site data)
  const realStorage = globalThis.localStorage
  globalThis.localStorage = { getItem() { throw new Error('denied') }, setItem() { throw new Error('denied') }, removeItem() { throw new Error('denied') } }
  try {
    let e1 = null
    let m = null
    try { m = mode() } catch (e) { e1 = e }
    ok('storage that throws: reading the mode does not throw (local)', e1 === null && m === 'local')
    let e2 = null
    try { setMode('cloud'); setMode('local') } catch (e) { e2 = e }
    ok('storage that throws: setting the mode does not throw', e2 === null)
    let e3 = null
    let h = null
    try { h = has() } catch (e) { e3 = e }
    ok('storage that throws: has() is false, not an exception', e3 === null && h === false)
  } finally { globalThis.localStorage = realStorage }
  // locales: fr stays French, en English, any other locale English (it used to fall back to French)
  const tin = (lang) => {
    plugin.apply({ get: (n) => (n === 'locale' ? { current: () => lang } : (n === 'slots' ? { inject: () => {}, register: () => {} } : undefined)), effect: () => {} })
    return t('kb.cp.chipall')
  }
  ok('i18n: fr gives French', tin('fr') === 'Toutes')
  ok('i18n: en gives English', tin('en') === 'All')
  ok('i18n: de and es give English, not French', tin('de') === 'All' && tin('es-MX') === 'All' && tin('ja') === 'All')
  ok('i18n: the Kybernos default stays French', tin('kybernos') === 'Toutes')
  ok('i18n: an unknown key is returned as it is', t('no.such.key') === 'no.such.key')
}

// ── the client keeps the catalog out of its bundle (replaces scripts/inject-catalog.mjs) ──
{
  const { readFileSync } = await import('node:fs')
  const src = readFileSync(new URL('./client.js', import.meta.url), 'utf8')
  ok('client.js carries no inline catalog and no generation marker', src.indexOf('const CATALOG = [') < 0 && src.indexOf('CATALOG-START') < 0 && src.indexOf('KBCP-CATALOG-PLACEHOLDER') < 0)
  ok('client.js loads the catalog from the host route', src.indexOf("const CATALOG_URL = '/kybernos/composio/catalog'") >= 0)
}

console.log(echecs === 0 ? '\nClient: all green.' : `\n✗ ${echecs} failure(s)`)
process.exit(echecs === 0 ? 0 : 1)

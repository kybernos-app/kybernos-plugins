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

// ── what the page says: failures, the key, a server's state ────────────────
// The page holds no Composio key and makes no call to Composio: everything goes through the host
// (index.js), whose routes are tested in test-host.mjs, test-key.mjs and test-connecteurs.mjs.
{
  const { errText, carteAccepter, keyState, testErr, statusOf, targetOf } = plugin.composio
  ok('errText: 401 and 403 say the key was rejected', /401/.test(errText('401')) && errText('403') === errText('401'))
  ok('errText: 429, timeout and offline each have their own sentence', new Set([errText('429'), errText('timeout'), errText('offline'), errText('401')]).size === 4)
  ok('errText: a gateway error says it is passing and carries the code', /502/.test(errText('502')) && errText('502') !== errText('500') && errText('503') !== errText('401'))
  ok('errText: any other code is carried in the sentence', errText('bad-response').includes('bad-response') && errText(undefined).includes('?'))

  // the key panel
  ok('keyState: no answer from the host plugin is null', keyState(null, null) === null && keyState({ ok: false }, null) === null && keyState('x', null) === null)
  ok('keyState: no key', (() => { const k = keyState({ ok: true, configured: false }, null); return k.present === false && k.accepted === null && k.agents === null })())
  ok('keyState: a key Composio accepts, held by the agents', (() => { const k = keyState({ ok: true, configured: true, source: 'env-file', agents: 'same' }, { ok: true, configured: true, error: null }); return k.present === true && k.accepted === 'yes' && k.agents === 'same' && k.env === false })())
  ok('keyState: a key Composio rejects', keyState({ ok: true, configured: true, agents: 'none' }, { ok: true, configured: true, error: '401' }).accepted === 'no' && keyState({ ok: true, configured: true }, { ok: true, error: '403' }).accepted === 'no')
  ok('keyState: another failure, or no answer, is "not checked", never a green light', keyState({ ok: true, configured: true }, { ok: true, error: 'timeout' }).accepted === 'unchecked' && keyState({ ok: true, configured: true }, null).accepted === 'unchecked')
  ok('keyState: a key the agents do not hold yet is "later"; one from the launching environment is flagged', keyState({ ok: true, configured: true, agents: 'different' }, { ok: true, error: null }).agents === 'later' && keyState({ ok: true, configured: true, source: 'env', agents: 'same' }, { ok: true, error: null }).env === true)

  // a failed connector test
  ok('testErr: an OAuth challenge says OAuth, not "401"', /OAuth/.test(testErr({ code: '401', hint: 'oauth' })))
  ok('testErr: 401, 403, 404 and 429 each have their own sentence', new Set(['401', '403', '404', '429'].map((c) => testErr({ code: c }))).size === 4)
  ok('testErr: a command that cannot start says why in words', /introuvable|not found/.test(testErr({ code: 'spawn', message: 'ENOENT' })) && !/ENOENT/.test(testErr({ code: 'spawn', message: 'ENOENT' })))
  ok('testErr: a program that stopped carries its exit code', /exit code 3/.test(testErr({ code: 'exited', message: 'exit code 3' })))
  ok('testErr: an MCP error carries the server\'s own words', /boom/.test(testErr({ code: 'rpc-error', message: 'boom' })))
  ok('testErr: an unknown code is carried, none gives ?', /weird/.test(testErr({ code: 'weird' })) && /\?/.test(testErr({})))

  // the state of a server's row
  const live = (o) => Object.assign({ loaded: true, phase: 'active', enabled: true, tools: 3 }, o)
  ok('statusOf: no live state from DSH is "configured", not a claim', statusOf({ live: null }, false).key === 'kb.cp.st.nolive' && statusOf({}, false).key === 'kb.cp.st.nolive')
  ok('statusOf: loaded with tools is ok and counts them', (() => { const r = statusOf({ live: live() }, false); return r.kind === 'ok' && r.key === 'kb.cp.st.active' && r.n === 3 })())
  ok('statusOf: loaded with no tool is a warning with a hint (the server probably did not start)', (() => { const r = statusOf({ live: live({ tools: 0 }) }, false); return r.kind === 'warn' && r.key === 'kb.cp.st.noTools' && r.hint === 'kb.cp.st.hint.noTools' })())
  ok('statusOf: an entry that failed to load is bad', statusOf({ live: live({ phase: 'failed', tools: 0 }) }, false).kind === 'bad')
  ok('statusOf: still loading is a warning', statusOf({ live: live({ phase: 'loading', tools: 0 }) }, false).key === 'kb.cp.st.loading')
  ok('statusOf: not loaded just after a save is "loading"; later it says to restart DSH', statusOf({ live: { loaded: false, tools: 0 } }, true).key === 'kb.cp.st.loading' && statusOf({ live: { loaded: false, tools: 0 } }, false).key === 'kb.cp.st.stale' && statusOf({ live: { loaded: false, tools: 0 } }, false).hint === 'kb.cp.st.hint.stale')
  ok('statusOf: disabled, by the config or by DSH', statusOf({ disabled: true, live: live() }, false).key === 'kb.cp.st.off' && statusOf({ live: live({ enabled: false }) }, false).key === 'kb.cp.st.off')
  const { hostIsOld } = plugin.composio
  ok('hostIsOld: a host that does not say its version (an older one), or says another, is old', hostIsOld({ ok: true }) === true && hostIsOld({ ok: true, api: 1 }) === true && hostIsOld(null) === true && hostIsOld('x') === true)
  ok('hostIsOld: the version this page speaks is not', hostIsOld({ ok: true, api: 2 }) === false)
  ok('targetOf: an address for http, the command line for stdio', targetOf({ transport: 'streamable-http', url: 'https://x.test/mcp' }) === 'https://x.test/mcp' && targetOf({ transport: 'stdio', command: '/bin/node', args: ['a.mjs', '--x'] }) === '/bin/node a.mjs --x')

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
  const max = plugin.composio.carteAcceptMax
  const longTexte = 'x'.repeat(max + 1)
  ok('accept: a text over the limit is handled but refused, never confirmed nor sent', carteAccepter(enc(longTexte), () => { confirme = true; return true }, (x) => envoi.push(x), (x) => { refus = x.length }) === true && confirme === false && envoi.length === 1 && refus === max + 1)
  ok('accept: a text of exactly the limit is still allowed', carteAccepter(enc('y'.repeat(max)), () => true, (x) => envoi.push(x)) === true && envoi.length === 2)
  // The kybernos bundle's kb-accept-text listener drops a longer text without a word: a limit here above
  // its own would let the user confirm a message that is never sent. Drift check; skipped when that
  // bundle is not next to this one (a bundle's test must also run from its own archive).
  {
    const { existsSync, readFileSync } = await import('node:fs')
    const sibling = new URL('../kybernos-plugin/client.js', import.meta.url)
    if (existsSync(sibling)) {
      const src = readFileSync(sibling, 'utf8')
      const at = src.indexOf("addEventListener('kb-accept-text'")
      const m = at >= 0 ? /t\.length > (\d+)\) return/.exec(src.slice(at, at + 1200)) : null
      ok('accept: the card limit is not above the one the kybernos bundle enforces', m !== null && max <= Number(m[1]), m === null ? 'listener not found' : 'card ' + max + ' > listener ' + m[1])
    } else console.log('- accept: drift check skipped (the kybernos bundle is not next to this one)')
  }
  ok('accept: a malformed %-escape is passed on as it is (and shown as it is)', carteAccepter('kb:accept:100%', (x) => { montre = x; return true }, (x) => envoi.push(x)) === true && montre === '100%')
}

// ── C-16 / C-20: the form, the search, storage that throws, other locales ───
{
  const { joinArgs, match, t } = plugin.composio
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
  // ── pasting the JSON a server's documentation gives ──
  const { importParse, importBody, safeName, formOf, bodyOf } = plugin.composio
  ok('safeName: lower case, dashes, a letter first, 31 characters at most, never empty', safeName('My Server_1') === 'my-server-1' && safeName('1password') === 'srv-1password' && safeName('x'.repeat(60)).length <= 31 && safeName('!!!') === 'srv')
  const DOC = JSON.stringify({ mcpServers: {
    github: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], env: { GITHUB_TOKEN: 'ghp_exemple', LOG_LEVEL: 'debug', ALREADY_TOKEN: '$ALREADY_TOKEN' } },
    context7: { url: 'https://mcp.context7.com/mcp', headers: { CONTEXT7_API_KEY: 'ctx7sk-exemple', 'x-client': 'kybernos' } },
    tavily: { url: 'https://mcp.tavily.com/mcp/', headers: { Authorization: 'Bearer tvly-exemple' } },
    old: { url: 'https://x.test/sse', type: 'sse' },
    'My Tool': { command: '/opt/homebrew/bin/node', args: ['s.mjs'] },
    junk: { nothing: true },
  } })
  const parsed = importParse(DOC)
  ok('import: every server with a url or a command is read, the rest is dropped', parsed.servers.map((x) => x.source).join() === 'github,context7,tavily,old,My Tool', JSON.stringify(parsed.servers && parsed.servers.map((x) => x.source)))
  ok('import: a type sse, or an address ending in /sse, is flagged', parsed.servers.find((x) => x.source === 'old').sse === true && parsed.servers.find((x) => x.source === 'github').sse === false)
  ok('import: a name the host would refuse is made acceptable', parsed.servers.find((x) => x.source === 'My Tool').name === 'my-tool')
  ok('import: the "servers" key and a bare map are understood as well', importParse('{"servers":{"a1":{"command":"/bin/x"}}}').servers.length === 1 && importParse('{"a1":{"command":"/bin/x"}}').servers.length === 1)
  ok('import: not JSON, and JSON with nothing to read, say so', importParse('{nope').error === 'json' && importParse('[]').error === 'nomap' && importParse('{"mcpServers":{}}').error === 'nomap' && importParse('{"command":"/bin/x"}').error === 'nomap')
  const gh = importBody(parsed.servers.find((x) => x.source === 'github'), '/opt/homebrew/bin/npx')
  ok('import: a token in an env variable becomes a secret and a $NAME reference', gh.body.secrets.length === 1 && gh.body.secrets[0].name === 'GITHUB_TOKEN' && gh.body.secrets[0].value === 'ghp_exemple' && gh.body.env.find((e) => e.name === 'GITHUB_TOKEN').value === '$GITHUB_TOKEN', JSON.stringify(gh.body))
  ok('import: a variable that is not secret-looking stays as it is, and a reference stays a reference', gh.body.env.find((e) => e.name === 'LOG_LEVEL').value === 'debug' && gh.body.env.find((e) => e.name === 'ALREADY_TOKEN').value === '$ALREADY_TOKEN')
  ok('import: the command the host chose replaces the pasted bare name', gh.body.command === '/opt/homebrew/bin/npx' && gh.body.transport === 'stdio' && gh.body.args.join(' ') === '-y @modelcontextprotocol/server-github')
  ok('import: nothing secret survives in the body outside the secrets list', !JSON.stringify(Object.assign({}, gh.body, { secrets: [] })).includes('ghp_exemple'))
  const c7 = importBody(parsed.servers.find((x) => x.source === 'context7'))
  ok('import: a key in a header becomes a secret named like the header', c7.body.secrets[0].name === 'CONTEXT7_API_KEY' && c7.body.headers.find((x) => x.name === 'CONTEXT7_API_KEY').value === '$CONTEXT7_API_KEY' && c7.body.headers.find((x) => x.name === 'x-client').value === 'kybernos')
  const tv = importBody(parsed.servers.find((x) => x.source === 'tavily'))
  ok('import: a Bearer token keeps its prefix and the secret is named after the server', tv.body.headers[0].value === 'Bearer $TAVILY_API_KEY' && tv.body.secrets[0].name === 'TAVILY_API_KEY' && tv.body.secrets[0].value === 'tvly-exemple' && tv.body.url === 'https://mcp.tavily.com/mcp/' && tv.body.command === undefined)
  ok('import: what was moved is listed for the page to say', tv.notes.length === 1 && tv.notes[0].name === 'TAVILY_API_KEY')

  // ── the form: from a server of the list to the body the host takes ──
  const item = { nom: 'zcode', transport: 'stdio', command: '/opt/homebrew/bin/node', args: ['/path with space/z.mjs', '--v'], cwd: '', env: [{ name: 'T', value: '$ZTOKEN' }], headers: [], secrets: ['OLD_SECRET'], secretsSet: { OLD_SECRET: true, ZTOKEN: false }, toolCallTimeoutMs: 600000, disabled: true, source: 'skill', editable: true }
  const f = formOf(item)
  ok('form: the arguments are shown so that the host reads them back as they were', f.args === '"/path with space/z.mjs" --v')
  ok('form: the secrets are the recorded ones plus the $NAME the rows use, with whether each has a value', f.secrets.map((x) => x.name + ':' + x.set).join() === 'OLD_SECRET:true,ZTOKEN:false')
  ok('form: the tool timeout is shown in seconds', f.timeoutS === '600')
  const body = bodyOf(f, item)
  ok('form: the body keeps the disabled flag and the timeout, and sends no secret value that was not typed', body.disabled === true && body.toolCallTimeoutMs === 600000 && body.secrets.length === 0)
  f.secrets[1].value = 'typed-value'; f.timeoutS = '90'
  const body2 = bodyOf(f, item)
  ok('form: a typed secret is sent with its name, and a new timeout wins', body2.secrets.length === 1 && body2.secrets[0].name === 'ZTOKEN' && body2.secrets[0].value === 'typed-value' && body2.toolCallTimeoutMs === 90000)
  ok('form: a new server starts empty, http', formOf(null).transport === 'streamable-http' && formOf(null).secrets.length === 0 && bodyOf(formOf(null), null).disabled === undefined)

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
  // The page used to keep the key in localStorage and call connect.composio.dev itself, with a copy of the MCP
  // client in this bundle and another in kybernos-plugin. The host does it now, once.
  ok('client.js never talks to Composio itself: no MCP address, no key header', !/connect\.composio\.dev|x-consumer-api-key|mcp-session-id/i.test(src.replace(/https:\/\/dashboard\.composio\.dev/g, '')))
  ok('client.js never stores the key: it only reads (and then forgets) the copy an old version left', !/localStorage\.setItem\(\s*KB_CP_OLD_KEY|setItem\('composio\.apiKey'/.test(src))
  // The panel used to offer a "Cloud" mode that stored a flag nothing read, and promised that connectors
  // would work from cloud agents. Composio's For You and Platform are separate projects (a ck_ key's
  // accounts do not exist on Platform), so nothing here could keep that promise.
  ok('client.js has no Cloud mode left (no flag, no event, no strings)', !/'composio\.mode'|kbcp-mode|KB_CP_MODE|modecloud|modelocal|modelier/.test(src))
  // Both rules were measured on the real page (dark theme): the brand colour is near white, so a
  // fixed white label on it is invisible; and a banner built from kb7-err is painted by the kybernos
  // bundle's sheet of the same name with the same red for fill and text.
  const css = src.slice(src.indexOf('const CSS = `'), src.indexOf('// ── Key config'))
  const onRules = css.split('\n').filter((l) => /\.on\{/.test(l) && /background:var\(--dsw-alias-brand-primary\)/.test(l))
  ok('the "on" states that use the brand colour take the theme\'s foreground token, not a fixed white', onRules.length >= 2 && onRules.every((l) => /color:var\(--dsw-alias-label-primary-foreground/.test(l)), onRules.join(' | '))
  ok('the page does not use a class that the kybernos bundle also styles for its error banner', src.indexOf("className: 'kb7-err'") < 0 && src.indexOf("className: 'kbcp-err'") >= 0)
}

// ── AGENTS.md rule 2: apply() cannot stop DSH from starting ─────────────────
{
  const errors = console.error
  console.error = () => {}
  let thrown = null
  try { plugin.apply({}); plugin.apply({ get: () => { throw new Error('no such service') }, effect: () => { throw new Error('boom') } }) } catch (e) { thrown = e } finally { console.error = errors }
  ok('client apply(): a missing service or a throwing host context does not throw', thrown === null, String(thrown && thrown.message))
}

console.log(echecs === 0 ? '\nClient: all green.' : `\n✗ ${echecs} failure(s)`)
process.exit(echecs === 0 ? 0 : 1)

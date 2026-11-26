// kybernos-mobile, host half: the stylesheet row, the route, and the stylesheet's own promises.
//   node packages/kybernos-mobile/test-host.mjs
import { mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
// The remote half is not started here (it has its own tests): this file is about the layout and the routes' fences.
process.env.KYBERNOS_MOBILE_REMOTE = '0'
const { CSS_FILE, NOTICES_ROUTE, PHONE_PROMPT_NAME, PHONE_PROMPT_ORDER, PHONE_RUNTIME_PROMPT, ROUTE, SHEET_ID, REMOTE_PREFIX, REMOTE_ROUTES, apply, onPhoneHost, resetCache, serveRemote, serveSheet, sheetCss, sheetRows } = await import('./index.js')
const REMOTE_COUNT = Object.keys(REMOTE_ROUTES).length
// The web-app layer's own routes (the manifest and the icons) sit between the stylesheet's route and the remote half's (test-pwa.mjs covers them).
const { FILES: PWA_FILES, PWA_PREFIX } = await import('./pwa.mjs')
const PWA_COUNT = PWA_FILES.length
// Kaby mode's stylesheet route sits right after the layout's (test-kaby-mode.mjs covers it), then the display choice's (test-mode.mjs covers it): two more routes on a computer and on the phone.
const { KABY_ROUTE } = await import('./kaby-mode.mjs')
const { MODE_ROUTE } = await import('./mode.mjs')
const KABY_COUNT = 2

let failed = 0
const check = (name, ok, detail) => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok || detail === undefined ? '' : '  — ' + JSON.stringify(detail)))
  if (!ok) failed += 1
}
const res = () => { const r = { status: 0, headers: null, body: null, writeHead (s, h) { r.status = s; r.headers = h || {} }, end (b) { r.body = b === undefined ? '' : String(b) } }; return r }
const req = (method = 'GET', headers = {}, port) => ({ method, headers, socket: port === undefined ? undefined : { localPort: port } })
const dir = mkdtempSync(join(tmpdir(), 'kb-mobile-'))

console.log('the row')
{
  resetCache()
  const rows = sheetRows()
  check('one head row per index render', rows.length === 1 && rows[0].kind === 'html' && rows[0].placement === 'head', rows.length)
  check('it is the stylesheet, with the id the browser half looks for', rows[0].html.startsWith('<style id="' + SHEET_ID + '">') && rows[0].html.endsWith('</style>') && SHEET_ID === 'kbmob-sheet')
  check('and carries the whole file', rows[0].html.includes(readFileSync(CSS_FILE, 'utf8')))
  resetCache()
  const bad = join(dir, 'bad.css'); writeFileSync(bad, 'a{color:red}</style><script>alert(1)</script>')
  check('a file that would close the element early is refused', sheetRows(bad).length === 0)
  resetCache()
  const realError = console.error; console.error = () => {}
  const none = sheetRows(join(dir, 'missing.css'))
  console.error = realError
  check('an unreadable file adds nothing and does not throw', none.length === 0)
  resetCache()
}

console.log('the stylesheet')
{
  const css = readFileSync(CSS_FILE, 'utf8')
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '')
  // Every rule that is not the button's own default lives under a media query: nothing applies on a desktop.
  const topLevel = withoutComments.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '')
  check('the only rules outside a media query are the hidden buttons, the sheet, the drawer\'s dock and the where pill', topLevel.replace(/\s+/g, ' ').trim() === '.kbmob-menu { display: none; } .kbmob-sheet-mask, .kbmob-sheet, .kbmob-dock, .kbmob-where { display: none; }', topLevel.trim())
  // a phone: at most 700 px wide, or lying down (at most 500 px high with a coarse pointer); a very narrow phone is a phone
  const phoneQuery = (q) => /max-width:\s*(700|600)px/.test(q) || (/max-height:\s*500px\)\s*and\s*\(pointer:\s*coarse/.test(q)) || /^\(max-width:\s*360px\)\s*$/.test(q.trim())
  check('every media query is a phone one', [...withoutComments.matchAll(/@media\s*([^{]+)\{/g)].every((m) => phoneQuery(m[1])))
  check('a touch device lying down is a phone too (a phone in landscape is wider than 700 px)', /@media\s*\(max-width:\s*700px\),\s*\(max-height:\s*500px\)\s*and\s*\(pointer:\s*coarse\)/.test(withoutComments))
  check('the composer is one row: the "/" button and the artifact button are parked, not deleted', /conversation\.input\.right"\] > \*/.test(withoutComments) && /conversation\.input\.left"\] > :not\(/.test(withoutComments) && /flex-wrap:\s*nowrap/.test(withoutComments) && /opacity:\s*0 !important/.test(withoutComments))
  check('the header actions are parked (rendered, invisible, one pixel) so the "..." sheet can click them', /\[data-team-action\],[\s\S]{0,600}position:\s*fixed !important[\s\S]{0,300}opacity:\s*0 !important/.test(withoutComments))
  check('the tab row is parked while the first tab (Chat) is shown, and comes back on the other views', /\[role="tablist"\]\[data-conversation-tabs\]:has\(> \[role="tab"\]:first-child\[aria-selected="true"\]\)/.test(withoutComments))
  check('the rating card is the five flat stars in the answer\'s action line, without its question', /\.kbq-rating \.kbq-rating-question \{\s*display: none !important/.test(withoutComments) && !/data-kbmob-open/.test(withoutComments))
  check('the sheet is styled with DSH tokens', /\.kbmob-sheet \{[^}]*var\(--dsw-alias-bg-layer-1/.test(withoutComments))
  check('the model name is shown (DSH hides it in its compact variant)', /conversation\.input\.model"\] button(?::not\(\[role="menu"\] \*\))? > span \{\s*display:\s*inline !important/.test(withoutComments))
  check('the stats strip under the card is hidden on a phone', /\[data-composer-dock\]\s*\{\s*display:\s*none !important/.test(withoutComments))
  check('the right bar covers the screen in DSH\'s own full-screen state (left alone it is 0 px high under the chat)', /\[data-rightbar-fullscreen\] > \[data-rightbar-col\]/.test(withoutComments))
  check('the drawer and the menu button respect the safe areas', /env\(safe-area-inset-top/.test(withoutComments) && /env\(safe-area-inset-bottom/.test(withoutComments))
  // Measured on an iPhone 18 Pro simulator (installed copy, 2026-10-24): the account card at the foot of the drawer touched the bottom edge, under the home indicator.
  check('the drawer itself pads both the notch and the home indicator', (() => {
    const at = withoutComments.indexOf('translateX(-105%)')
    if (at < 0) return false
    const open = withoutComments.lastIndexOf('{', at)
    const body = withoutComments.slice(open, withoutComments.indexOf('}', at))
    return /padding-top:\s*(?:var\(--kb-sat,\s*)?env\(safe-area-inset-top,\s*0px\)/.test(body) && /padding-bottom:\s*(?:var\(--kb-sab,\s*)?env\(safe-area-inset-bottom,\s*0px\)/.test(body)
  })())
  check('no text scaling on a phone: the sizes of the layer are real px (the 118 % on <html> lost to the engine\'s own `text-size-adjust: 100%` since rc.5, so `--kbmob-tsa` is 1), and never zoom', !/text-size-adjust:\s*118%/.test(withoutComments) && /--kbmob-tsa:\s*1;/.test(withoutComments) && !/\bzoom\s*:/.test(withoutComments))
  check('the drawer leaves part of the chat to tap (never the full width)', /width:\s*min\(84vw,\s*330px\)/.test(withoutComments))
  check('what the browser half marks as too wide has its rule: a grid, a wrapping toolbar, tabs that slide, a squeezed item, a setting', ['grid', 'wrap', 'scroll', 'keep', 'stack'].every((k) => new RegExp('\\[data-kbmob-fit~="' + k + '"\\]').test(withoutComments)))
  check('a labelled button is never given a min-width (a flex row would squeeze it under the next one)', !/\[data-slot="main"\] button,\s*\[data-slot="main"\] \[role="button"\],\s*\[data-slot="main"\] \[role="tab"\]\s*\{[^}]*min-width/.test(withoutComments))
  check('Settings is a list of pages, then a page under a back bar: not a column beside it', /\[data-shortcut-modal="settings"\]\s*\{\s*flex-direction:\s*column !important/.test(withoutComments) && /data-kbmob-page/.test(withoutComments))
  check('DSH 0.2.2 draws Settings flat (strip, nav, header, page): the list gives the page box away and the back bar is the strip, by position only', /\[data-shortcut-modal="settings"\]:not\(\[data-kbmob-page\]\) > nav \+ div \+ div\s*\{\s*display:\s*none !important/.test(withoutComments) && /:has\(> div:first-child \+ nav\)/.test(withoutComments) && /\[data-kbmob-page\] > div:first-child::before/.test(withoutComments))
  check('no :has() is nested in another (the whole rule would be dropped by the browser)', !/:has\((?:[^()]|\([^()]*\))*:has\(/.test(withoutComments))
  // The one exception: a name the engine's CSS modules give to a box that has no stable hook (`data-slot`, `role`, `aria-*`), matched by its suffix only,
  // `[class*="_rowActions"]` (the hash before the `_` changes with every build, the module's own name after it does not). Engine 0.2.1, the Android app's,
  // marks a chat row's « … » with nothing else (found on the real phone, round 5). A new name goes into this list, on purpose.
  check('no hashed class name is used (they change with every build); only the engine\'s module names _rowActions, _rowQuickActions, _time and _endInfo are matched, by suffix',
    !/\[class[\^$|~]=/.test(withoutComments)
    && !/\[class\*=(?!["']_(?:rowActions|rowQuickActions|time|endInfo)["']\])/.test(withoutComments)
    && !/\._[A-Za-z0-9]{4,}_/.test(withoutComments))
  check('it is keyed on the hooks DSH keeps', ['data-slot="root"', 'data-shell-overlay', 'data-sidebar-collapsed', 'data-rightbar-collapsed', 'data-rightbar-col', 'data-shortcut-modal="settings"'].every((h) => withoutComments.includes(h)))
  check('the iOS no-zoom field size is on a coarse pointer only', /\(pointer:\s*coarse\)\s*\{[^}]*\{[^}]*\}[\s\S]*font-size:\s*16px/.test(withoutComments))
  check('colours come from DSH tokens with a fallback', [...withoutComments.matchAll(/var\(--dsw-[a-z0-9-]+,\s*[^)]+\)/g)].length >= 3)
  check('no hard-coded colour outside a token fallback or the mask', [...withoutComments.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].every((m) => /var\([^)]*#/.test(withoutComments.slice(Math.max(0, m.index - 70), m.index + 10))))
}

console.log('the stylesheet follows the file')
{
  const dir = mkdtempSync(join(tmpdir(), 'kbmob-css-'))
  const f = join(dir, 'm.css')
  writeFileSync(f, '.a{color:red}')
  resetCache()
  const first = sheetCss(f)
  check('the first read is the file', first === '.a{color:red}')
  writeFileSync(f, '.a{color:blue}')
  const t = new Date(Date.now() + 5000)
  utimesSync(f, t, t)
  check('an edit on disk reaches the next read, with no restart', sheetCss(f) === '.a{color:blue}')
  rmSync(f)
  check('a file that went away keeps the last good copy', sheetCss(f) === '.a{color:blue}')
  rmSync(dir, { recursive: true, force: true })
  resetCache()
}

console.log('the route')
{
  resetCache()
  let r = res(); serveSheet(req('GET', { host: '127.0.0.1:3080' }, 3080), r)
  check('GET answers the stylesheet', r.status === 200 && /^text\/css/.test(r.headers['content-type']) && r.body === readFileSync(CSS_FILE, 'utf8'))
  check('it is revalidated, never pinned', r.headers['cache-control'] === 'no-cache' && r.headers['x-content-type-options'] === 'nosniff')
  r = res(); serveSheet(req('POST', { host: '127.0.0.1:3080' }, 3080), r)
  check('POST is 405', r.status === 405)
  r = res(); serveSheet(req('GET', { host: 'attacker.example:3080' }, 3080), r)
  check('a page that rebinds its own name to this machine is refused (403)', r.status === 403)
  r = res(); serveSheet(req('GET', { host: '127.0.0.1:3080', origin: 'https://evil.example' }, 3080), r)
  check('a page of another origin is refused (403)', r.status === 403)
  r = res(); serveSheet(req('GET', { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080' }, 3080), r)
  check('the page\'s own origin is served', r.status === 200)
  r = res(); serveSheet(req('GET', { host: 'attacker.example' }), r)
  check('a request with no socket (a test) is not judged', r.status === 200)
}

console.log('mounting')
{
  resetCache()
  const handlers = new Map(); const routes = []; const effects = []
  const svc = { register: (route) => { routes.push(route); return () => {} } }
  const ctx = {
    effect: (fn, label) => { effects.push(label); return fn() },
    on: (event, fn) => { handlers.set(event, fn); return () => {} },
    get: (n) => (n === 'webServer' ? svc : undefined),
    inject: () => { throw new Error('should not wait: the service is there') }
  }
  let threw = null
  try { apply(ctx) } catch (e) { threw = e }
  check('apply does not throw', threw === null)
  check('it listens to index-inject and mounts the stylesheet route first', handlers.has('webserver/index-inject') && routes.length >= 1 && routes[0].path === ROUTE && routes[0].kind === 'exact', routes)
  check('then Kaby mode\'s stylesheet route', routes[1] !== undefined && routes[1].path === KABY_ROUTE && routes[1].kind === 'exact', routes.map((r) => r.path))
  check('then the display choice\'s route', routes[2] !== undefined && routes[2].path === MODE_ROUTE && routes[2].kind === 'exact', routes.map((r) => r.path))
  check('then the web-app layer\'s routes, all exact', routes.slice(1 + KABY_COUNT, 1 + KABY_COUNT + PWA_COUNT).length === PWA_COUNT && routes.slice(1 + KABY_COUNT, 1 + KABY_COUNT + PWA_COUNT).every((r) => r.kind === 'exact' && r.path.startsWith(PWA_PREFIX)), routes.map((r) => r.path))
  check('and the remote half\'s routes after them, all exact', routes.length === 1 + KABY_COUNT + PWA_COUNT + REMOTE_COUNT && routes.slice(1 + KABY_COUNT + PWA_COUNT).every((r) => r.kind === 'exact' && r.path.startsWith(REMOTE_PREFIX)), routes.map((r) => r.path))
  const table = []
  handlers.get('webserver/index-inject')(table)
  check('the handler adds the web-app tags, then the stylesheet row, then the loading card, then the display mode\'s two (sheet rules, resolver), then Kaby mode\'s two (rules, early class)', table.length === 7 && table[0].html.includes('rel="manifest"') && table[1].html.includes('@media (max-width: 700px)') && table[2].html.startsWith('<style id="kbmob-boot">') && table[3].html.startsWith('<style id="kbmob-mode">') && table[4].html.startsWith('<script>') && table[4].html.includes('kb-simple') && table[5].html.startsWith('<style id="kbmob-kaby">') && table[6].html.startsWith('<script>'), table.map((r) => r.html.slice(0, 40)))
  const throwingTable = { push: () => { throw new Error('table closed') } }
  const realError = console.error; console.error = () => {}
  let escaped = null
  try { handlers.get('webserver/index-inject')(throwingTable) } catch (e) { escaped = e }
  console.error = realError
  check('a table that refuses the row does not stop the page', escaped === null)

  // the web server arrives later
  const late = []
  const lateCtx = { effect: (fn) => fn(), on: () => () => {}, get: () => undefined, inject: (names, fn) => { late.push(names); fn({ webServer: svc }) } }
  apply(lateCtx)
  check('without the service yet it waits for it, then mounts the route', JSON.stringify(late) === JSON.stringify([['webServer']]) && routes.length === 2 * (1 + KABY_COUNT + PWA_COUNT + REMOTE_COUNT))
  // a DSH without ctx.on (or whose effect throws) must still start
  const broken = { effect: () => { throw new Error('no effect') }, on: () => () => {}, get: () => undefined, inject: () => { throw new Error('no inject') } }
  console.error = () => {}
  let brokenThrew = null
  try { apply(broken) } catch (e) { brokenThrew = e }
  console.error = realError
  check('a context that refuses everything still lets DSH start', brokenThrew === null)
}

console.log('inside the phone app (the embedded engine reports ios or android)')
{
  check('the phone app is told by the platform of the engine', onPhoneHost('ios') && onPhoneHost('android') && !onPhoneHost('darwin') && !onPhoneHost('linux') && !onPhoneHost('win32'))
  const mountOn = (platform, { latePrompt = false, brokenPrompt = false, noPrompt = false } = {}) => {
    const routes = []; const effects = []; const handlers = new Map(); const prompts = []; const injects = []
    const svc = { register: (route) => { routes.push(route); return () => {} } }
    const sp = brokenPrompt ? { context: () => { throw new Error('prompt unavailable') } } : { context: (entry) => { prompts.push(entry); return () => {} } }
    const ctx = {
      effect: (fn, label) => { effects.push(label); return fn() },
      on: (ev, fn) => { handlers.set(ev, fn); return () => {} },
      get: (n) => (n === 'webServer' ? svc : (n === 'systemPrompt' && !latePrompt && !noPrompt ? sp : undefined)),
      inject: (names, fn) => { injects.push(names); if (names.includes('systemPrompt') && latePrompt && !noPrompt) fn({ systemPrompt: sp }) }
    }
    let threw = null
    try { apply(ctx, { platform }) } catch (e) { threw = e }
    return { routes, effects, handlers, prompts, injects, threw }
  }
  // the whole point of the test is the link, so the switch that turns it off elsewhere must be off here
  const saved = process.env.KYBERNOS_MOBILE_REMOTE; delete process.env.KYBERNOS_MOBILE_REMOTE
  const realError = console.error; console.error = () => {}
  const desktop = mountOn('darwin')
  const linux = mountOn('linux')
  const phone = mountOn('ios')
  const android = mountOn('android')
  const phoneLate = mountOn('ios', { latePrompt: true })
  const phoneNoSp = mountOn('ios', { noPrompt: true })
  const phoneBrokenSp = mountOn('android', { brokenPrompt: true })
  console.error = realError
  if (saved !== undefined) process.env.KYBERNOS_MOBILE_REMOTE = saved; else process.env.KYBERNOS_MOBILE_REMOTE = '0'
  check('on a computer the link is mounted as before: its routes and its relay link', desktop.routes.length === 1 + KABY_COUNT + PWA_COUNT + REMOTE_COUNT && desktop.effects.includes('kybernos-mobile: remote link'), desktop.effects)
  check('on the phone the layout is untouched: the stylesheet row, its route, Kaby mode\'s, the display choice\'s and the notices route', phone.threw === null && phone.handlers.has('webserver/index-inject') && phone.routes.length === 4 && phone.routes[0].path === ROUTE && phone.routes[1].path === KABY_ROUTE && phone.routes[2].path === MODE_ROUTE && phone.routes[3].path === NOTICES_ROUTE, phone.routes.map((r) => r.path))
  check('and no link routes (a phone never links phones), nor the relay', phone.routes.every((r) => !r.path.startsWith(REMOTE_PREFIX)) && !phone.effects.includes('kybernos-mobile: remote link'), phone.effects)
  check('Android is the same', android.threw === null && android.routes.length === 4 && !android.effects.includes('kybernos-mobile: remote link'))
  check('on desktop (darwin/linux) no phone runtime prompt is registered', desktop.prompts.length === 0 && linux.prompts.length === 0 && desktop.injects.length === 0 && linux.injects.length === 0)
  check('on ios and android the phone runtime prompt is registered via systemPrompt.context', phone.prompts.length === 1 && android.prompts.length === 1 && phone.prompts[0].name === PHONE_PROMPT_NAME && phone.prompts[0].order === PHONE_PROMPT_ORDER && phone.prompts[0].text() === PHONE_RUNTIME_PROMPT && android.prompts[0].text() === PHONE_RUNTIME_PROMPT)
  check('when systemPrompt arrives later via ctx.inject, the phone runtime prompt is still mounted', phoneLate.prompts.length === 1 && phoneLate.prompts[0].text() === PHONE_RUNTIME_PROMPT && phoneLate.injects.some((n) => n.includes('systemPrompt')))
  check('when systemPrompt is absent or throws, the phone engine still boots cleanly', phoneNoSp.threw === null && phoneNoSp.prompts.length === 0 && phoneNoSp.routes.length === 4 && phoneBrokenSp.threw === null && phoneBrokenSp.routes.length === 4)
  check('the phone runtime prompt names the phone environment, forbids Node/external CLIs, points to a remote or cloud Kybernos computer, and never promises automatic routing',
    /phone/i.test(PHONE_RUNTIME_PROMPT) && /Node/.test(PHONE_RUNTIME_PROMPT) && /external programs|subprocesses/i.test(PHONE_RUNTIME_PROMPT) && /remote or cloud Kybernos computer/i.test(PHONE_RUNTIME_PROMPT) && /Never claim or promise.*automatically/i.test(PHONE_RUNTIME_PROMPT), PHONE_RUNTIME_PROMPT)
}

console.log('the remote routes\' fences')
{
  const good = { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080' }
  const go = (name, method, headers, port = 3080) => { const r = res(); serveRemote(name, req(method, headers, port), r); return r }
  // a fence refusal answers synchronously; a request that passes goes on to the lazily loaded half (here: not running -> 503)
  check('a page that rebinds its own name is refused', go('status', 'GET', { host: 'attacker.example:3080', origin: 'http://attacker.example:3080' }).status === 403)
  check('a request with no Origin and no Referer is refused (reads too)', go('status', 'GET', { host: '127.0.0.1:3080' }).status === 403)
  check('a foreign Origin is refused', go('pair', 'POST', { host: '127.0.0.1:3080', origin: 'https://evil.example' }).status === 403)
  check('a foreign Referer is refused', go('status', 'GET', { host: '127.0.0.1:3080', referer: 'https://evil.example/x' }).status === 403)
  check('a request that came through the phone link is refused, whatever its Origin', go('devices/revoke', 'POST', { ...good, 'x-kybernos-tunnel': '1' }).status === 403)
  check('the wrong method is 405', go('status', 'POST', good).status === 405 && go('pair', 'GET', good).status === 405)
  check('an unknown route is 404', go('nope', 'GET', good).status === 404)
  const ok = go('status', 'GET', { host: '127.0.0.1:3080', referer: 'http://127.0.0.1:3080/#/settings' })
  await new Promise((r) => setTimeout(r, 200))
  check('the page itself gets through to the remote half', ok.status === 503 || ok.status === 200, ok.status)
}

rmSync(dir, { recursive: true, force: true })
console.log(failed === 0 ? '\nOK' : `\n${failed} failure(s)`)
process.exit(failed === 0 ? 0 : 1)

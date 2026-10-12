// kybernos-mobile, host half: the stylesheet row, the route, and the stylesheet's own promises.
//   node packages/kybernos-mobile/test-host.mjs
import { mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
// The remote half is not started here (it has its own tests): this file is about the layout and the routes' fences.
process.env.KYBERNOS_MOBILE_REMOTE = '0'
const { CSS_FILE, ROUTE, SHEET_ID, REMOTE_PREFIX, REMOTE_ROUTES, apply, resetCache, serveRemote, serveSheet, sheetCss, sheetRows } = await import('./index.js')
const REMOTE_COUNT = Object.keys(REMOTE_ROUTES).length

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
  check('the only rules outside a media query are the hidden buttons and sheet', topLevel.replace(/\s+/g, ' ').trim() === '.kbmob-menu { display: none; } .kbmob-sheet-mask, .kbmob-sheet { display: none; }', topLevel.trim())
  // a phone: at most 700 px wide, or lying down (at most 500 px high with a coarse pointer); a very narrow phone is a phone
  const phoneQuery = (q) => /max-width:\s*700px/.test(q) || (/max-height:\s*500px\)\s*and\s*\(pointer:\s*coarse/.test(q)) || /^\(max-width:\s*360px\)\s*$/.test(q.trim())
  check('every media query is a phone one', [...withoutComments.matchAll(/@media\s*([^{]+)\{/g)].every((m) => phoneQuery(m[1])))
  check('a touch device lying down is a phone too (a phone in landscape is wider than 700 px)', /@media\s*\(max-width:\s*700px\),\s*\(max-height:\s*500px\)\s*and\s*\(pointer:\s*coarse\)/.test(withoutComments))
  check('the composer is one row: the "/" button and the artifact button are parked, not deleted', /conversation\.input\.right"\] > \*/.test(withoutComments) && /conversation\.input\.left"\] > :not\(/.test(withoutComments) && /flex-wrap:\s*nowrap/.test(withoutComments) && /opacity:\s*0 !important/.test(withoutComments))
  check('the header actions are parked (rendered, invisible, one pixel) so the "..." sheet can click them', /\[data-team-action\],[\s\S]{0,400}position:\s*fixed !important[\s\S]{0,300}opacity:\s*0 !important/.test(withoutComments))
  check('the tab row is parked while the first tab (Chat) is shown, and comes back on the other views', /\[role="tablist"\]\[data-conversation-tabs\]:has\(> \[role="tab"\]:first-child\[aria-selected="true"\]\)/.test(withoutComments))
  check('the rating card is one star until a tap opens it', /\.kbq-rating:not\(\[data-kbmob-open\]\)/.test(withoutComments) && /\.kbq-rating\[data-kbmob-open\] \.kbq-rating-question/.test(withoutComments))
  check('the sheet is styled with DSH tokens', /\.kbmob-sheet \{[^}]*var\(--dsw-alias-bg-layer-1/.test(withoutComments))
  check('the model name is shown (DSH hides it in its compact variant)', /conversation\.input\.model"\] button > span \{\s*display:\s*inline !important/.test(withoutComments))
  check('the stats strip under the card is hidden on a phone', /\[data-composer-dock\]\s*\{\s*display:\s*none !important/.test(withoutComments))
  check('the right bar covers the screen in DSH\'s own full-screen state (left alone it is 0 px high under the chat)', /\[data-rightbar-fullscreen\] > \[data-rightbar-col\]/.test(withoutComments))
  check('the drawer and the menu button respect the safe areas', /env\(safe-area-inset-top/.test(withoutComments) && /env\(safe-area-inset-bottom/.test(withoutComments))
  check('no hashed class name is used (they change with every build)', !/\[class[\^*$|~]?=/.test(withoutComments) && !/\._[A-Za-z0-9]{4,}_/.test(withoutComments))
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
  check('and the remote half\'s routes after it, all exact', routes.length === 1 + REMOTE_COUNT && routes.slice(1).every((r) => r.kind === 'exact' && r.path.startsWith(REMOTE_PREFIX)), routes.map((r) => r.path))
  const table = []
  handlers.get('webserver/index-inject')(table)
  check('the handler adds the row', table.length === 1 && table[0].html.includes('@media (max-width: 700px)'))
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
  check('without the service yet it waits for it, then mounts the route', JSON.stringify(late) === JSON.stringify([['webServer']]) && routes.length === 2 * (1 + REMOTE_COUNT))
  // a DSH without ctx.on (or whose effect throws) must still start
  const broken = { effect: () => { throw new Error('no effect') }, on: () => () => {}, get: () => undefined, inject: () => { throw new Error('no inject') } }
  console.error = () => {}
  let brokenThrew = null
  try { apply(broken) } catch (e) { brokenThrew = e }
  console.error = realError
  check('a context that refuses everything still lets DSH start', brokenThrew === null)
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

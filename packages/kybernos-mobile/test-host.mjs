// kybernos-mobile, host half: the stylesheet row, the route, and the stylesheet's own promises.
//   node packages/kybernos-mobile/test-host.mjs
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CSS_FILE, ROUTE, SHEET_ID, apply, resetCache, serveSheet, sheetRows } from './index.js'

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
  check('the only rule outside a media query is the hidden button', topLevel.replace(/\s+/g, ' ').trim() === '.kbmob-menu { display: none; }', topLevel.trim())
  check('every media query is a phone one', [...withoutComments.matchAll(/@media\s*([^{]+)\{/g)].every((m) => /max-width:\s*700px/.test(m[1])))
  check('no hashed class name is used (they change with every build)', !/\[class[\^*$|~]?=/.test(withoutComments) && !/\._[A-Za-z0-9]{4,}_/.test(withoutComments))
  check('it is keyed on the hooks DSH keeps', ['data-slot="root"', 'data-shell-overlay', 'data-sidebar-collapsed', 'data-rightbar-collapsed', 'data-rightbar-col', 'data-shortcut-modal="settings"'].every((h) => withoutComments.includes(h)))
  check('the iOS no-zoom field size is on a coarse pointer only', /\(pointer:\s*coarse\)\s*\{[^}]*\{[^}]*\}[\s\S]*font-size:\s*16px/.test(withoutComments))
  check('colours come from DSH tokens with a fallback', [...withoutComments.matchAll(/var\(--dsw-[a-z0-9-]+,\s*[^)]+\)/g)].length >= 3)
  check('no hard-coded colour outside a token fallback or the mask', [...withoutComments.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].every((m) => /var\([^)]*#/.test(withoutComments.slice(Math.max(0, m.index - 70), m.index + 10))))
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
  check('it listens to index-inject and mounts one route', handlers.has('webserver/index-inject') && routes.length === 1 && routes[0].path === ROUTE && routes[0].kind === 'exact', routes)
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
  check('without the service yet it waits for it, then mounts the route', JSON.stringify(late) === JSON.stringify([['webServer']]) && routes.length === 2)
  // a DSH without ctx.on (or whose effect throws) must still start
  const broken = { effect: () => { throw new Error('no effect') }, on: () => () => {}, get: () => undefined, inject: () => { throw new Error('no inject') } }
  console.error = () => {}
  let brokenThrew = null
  try { apply(broken) } catch (e) { brokenThrew = e }
  console.error = realError
  check('a context that refuses everything still lets DSH start', brokenThrew === null)
}

rmSync(dir, { recursive: true, force: true })
console.log(failed === 0 ? '\nOK' : `\n${failed} failure(s)`)
process.exit(failed === 0 ? 0 : 1)

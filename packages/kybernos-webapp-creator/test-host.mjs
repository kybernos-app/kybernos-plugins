// test-host.mjs — slug rules, discovery, scaffolding, and the route table of the host half.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { discoverApps, readWebappJson, scaffoldApp, validateSlug } from './lib/apps.mjs'
import { apply } from './index.js'

let echecs = 0
const check = (libelle, ok, detail) => {
  if (ok === true) { console.log('  \u2713 ' + libelle); return }
  echecs++
  console.log('  \u2717 ' + libelle + (detail !== undefined ? ' \u2014 ' + JSON.stringify(detail) : ''))
}

console.log('slugs')
check('a plain slug passes', validateSlug('rdv-cabinet').ok === true)
check('32 characters pass', validateSlug('a'.repeat(32)).ok === true)
for (const mauvais of ['', 'Rdv', 'rdv cabinet', 'rdv_cabinet', '-rdv', 'rdv-', 'a'.repeat(33), 'www', 'api', 'kaby', 'rdv.cabinet', 'unï']) {
  check('refused: ' + JSON.stringify(mauvais), validateSlug(mauvais).ok === false)
}

const root = mkdtempSync(join(tmpdir(), 'kb-webapps-'))
try {
  console.log('discovery')
  mkdirSync(join(root, 'good-app'))
  writeFileSync(join(root, 'good-app', 'webapp.json'), JSON.stringify({ version: 1, nom: 'Good', slug: 'good-app' }))
  mkdirSync(join(root, 'broken'))
  writeFileSync(join(root, 'broken', 'webapp.json'), '{pas json')
  mkdirSync(join(root, 'no-brief'))
  writeFileSync(join(root, 'no-brief', 'readme.txt'), 'x')
  const { apps, problemes } = discoverApps(root)
  check('one readable app', apps.length === 1 && apps[0].slug === 'good-app', apps)
  check('a broken brief is a problem, not a crash', problemes.length === 1, problemes)
  check('a folder without a brief is not an app', readWebappJson(join(root, 'no-brief')).ok === false)

  console.log('scaffolding')
  const r = scaffoldApp(root, { nom: 'New one', slug: 'new-one' })
  check('scaffold writes the brief', r.ok === true && readFileSync(join(root, 'new-one', 'webapp.json'), 'utf8').includes('"slug": "new-one"'))
  check('scaffold refuses an existing slug', scaffoldApp(root, { nom: 'x', slug: 'new-one' }).ok === false)
  check('scaffold refuses a bad slug', scaffoldApp(root, { nom: 'x', slug: 'Bad Slug' }).ok === false)
  check('defaults are conservative (cle + personnel)', (() => {
    const a = readWebappJson(join(root, 'new-one')).app
    return a.acces === 'cle' && a.donnees === 'personnel'
  })())

  console.log('routes')
  const routes = []
  const ctx = {
    get: (k) => (k === 'webServer' ? { register: (r) => { routes.push(r); return () => {} } } : undefined),
    inject: () => {},
    effect: () => {},
  }
  apply(ctx)
  check('five routes mounted', routes.length === 5, routes.map((r) => r.path))
  check('every route is under our prefix', routes.every((r) => r.path.startsWith('/kybernos-webapp-creator/')), routes.map((r) => r.path))

  const reqSansCookie = {
    method: 'POST',
    url: '/kybernos-webapp-creator/create',
    headers: { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080', 'content-type': 'application/json' },
    socket: { localPort: 3080 },
    on: (ev, cb) => { if (ev === 'end') setImmediate(cb) },
  }
  const res = { headersSent: false, code: null, corps: '', writeHead (c) { this.code = c }, end (b) { this.corps = b ?? ''; this.headersSent = true }, setHeader () {}, destroy () {} }
  const routeCreate = routes.find((r) => r.path.endsWith('/create'))
  await routeCreate.handler(reqSansCookie, res)
  check('a write without the signed session is refused', res.code >= 400 && JSON.parse(res.corps).ok === false, res.code)
} finally {
  rmSync(root, { recursive: true, force: true })
}

if (echecs > 0) { console.log('test-host: ' + echecs + ' failure(s)'); process.exit(1) }
console.log('test-host: all green')

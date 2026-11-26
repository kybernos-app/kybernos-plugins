#!/usr/bin/env node
// The bundle freeze really is invisible on a running sandbox: every host route of a bundle marked « off » in docs/tests/soft-takeoff/plugins.json answers 404 (the bundle is
// not loaded), while the `/state` route of the bundles marked « on » answers (so a 404 means « not loaded », not « this route never existed »).
//
//   node scripts/soft-takeoff-freeze.mjs --profile <sandbox profile>; scripts/sandbox/stop.sh; scripts/sandbox/start.sh
//   source scripts/sandbox/env.sh && node scripts/check-freeze-live.mjs
//
//   --boot-only     just the first check: the hub answers and the boot guard sees a normal boot
//   --plan <file>   another plugins.json (a negative control: mark a bundle that IS loaded as off and this must go red)
// Read-only: GET requests only, signed with the sandbox's own session cookie. Refuses :3080. Exit 0 all good, 1 a check failed, 3 not run (no GUI or no cookie).
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cookieDeSession } from './cdp-lib.mjs'
import { profilePatch } from './dsh-home.mjs'
import { enableOn } from './soft-takeoff-freeze.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const HOST = process.env.KB_HOST || ''
if (!HOST || /:3080$/.test(HOST)) { console.error('✗ KB_HOST must be a sandbox (source scripts/sandbox/env.sh); the real DSH (:3080) is refused'); process.exit(3) }
const cookie = cookieDeSession(HOST)
if (cookie === null) { console.error('○ not run: the sandbox session secret is unreadable'); process.exit(3) }
const planArg = process.argv.indexOf('--plan')
const plan = JSON.parse(readFileSync(planArg > 0 ? resolve(process.argv[planArg + 1]) : join(REPO, 'docs/tests/soft-takeoff/plugins.json'), 'utf8'))
const get = async (path) => {
  try { return (await fetch('http://' + HOST + path, { headers: { cookie: cookie.nom + '=' + cookie.valeur } })).status } catch (e) { return null }
}
const hubRes = await fetch('http://' + HOST + '/kybernos-hub/state', { headers: { cookie: cookie.nom + '=' + cookie.valeur } }).catch(() => null)
if (!hubRes || hubRes.status !== 200) { console.error('○ not run: the sandbox does not answer /kybernos-hub/state'); process.exit(3) }
const hub = await hubRes.json()

let pass = 0
let fail = 0
const check = (name, ok, detail) => { if (ok) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail).slice(0, 300))) } }
const routesOf = (dir) => {
  // every route string the bundle's own files mention (its host half and the paths its page calls); parameterised routes are left out
  const found = new Set(['/' + dir + '/state'])
  let files = []
  try { files = readdirSync(join(REPO, 'packages', dir)).filter((f) => /\.(m?js)$/.test(f) && !/^test/.test(f)) } catch (e) { return [] }
  for (const f of files) {
    let text = ''
    try { text = readFileSync(join(REPO, 'packages', dir, f), 'utf8') } catch (e) { continue }
    for (const m of text.matchAll(new RegExp('[\'"`](/' + dir + '/[a-z0-9/_-]+)[\'"`]', 'g'))) if (!m[1].includes(':')) found.add(m[1])
  }
  return [...found]
}

// a bundle that is on and has a host half literally registers `/<dir>/state` in its index.js
const hostStateRoute = (dir) => { try { return readFileSync(join(REPO, 'packages', dir, 'index.js'), 'utf8').includes('/' + dir + '/state') } catch (e) { return false } }
check('the hub answers and the boot guard recommends normal mode, safe mode off', hub.ok === true && hub.recommendation && hub.recommendation.mode === 'normal' && hub.safe && hub.safe.active === false, { recommendation: hub.recommendation, safe: hub.safe })
if (process.argv.includes('--boot-only')) { console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail === 0 ? 0 : 1) }

const on = Object.entries(plan.bundles).filter(([, e]) => e.state === 'on').map(([d]) => d)
const off = Object.entries(plan.bundles).filter(([, e]) => e.state === 'off').map(([d]) => d)

const controls = on.filter((d) => hostStateRoute(d))
const answers = await Promise.all(controls.map(async (d) => [d, await get('/' + d + '/state')]))
const dead = answers.filter(([, s]) => s === 404 || s === null).map(([d]) => d)
check(`the /state route of the ${controls.length} bundles that are on answers (a 404 there would make the next checks meaningless)`, controls.length >= 3 && dead.length === 0, { dead })

// A bundle marked on that the profile's patch carries as « disabled: true » never loads, and a bundle with no host route cannot tell (the freeze once left five of them off).
const patch = profilePatch()
if (patch === null) check('the profile patch can be read', false)
else check('no bundle marked on is disabled in the profile patch', enableOn(patch, plan).enabled.length === 0, enableOn(patch, plan).enabled)

let swept = 0
for (const dir of off) {
  const routes = routesOf(dir)
  swept += routes.length
    const codes = await Promise.all(routes.map(async (r) => [r, await get(r)]))
  const alive = codes.filter(([, s]) => s !== 404)
  check(`${dir} is off: its ${routes.length} host route(s) answer 404`, alive.length === 0, alive)
}
check('the sweep looked at routes at all', swept > 0)
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)

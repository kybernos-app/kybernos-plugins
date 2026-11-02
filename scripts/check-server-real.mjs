#!/usr/bin/env node
// Smoke test of the open server route against the REAL host (127.0.0.1:3080 by default). READ-ONLY.
//
//   node scripts/check-server-real.mjs
//
// It calls GET /kybernos-cloud/server, the route that names the active server and every server of the registry. It prints counts and statuses, never an id, a
// name or a token. Exit 0 all green, 1 a check failed, 3 inconclusive (host down).
//
// What it proves that the unit tests cannot: the host that is RUNNING has the route (a restart happened after the merge). (It was check-relay-real.mjs, which also
// read the Team console relay; that route went with the read-only account frame: docs/dev/frame-removal.md.)
const AUTHORITY = process.env.KB_HOST || '127.0.0.1:3080'
const BASE = 'http://' + AUTHORITY
let pass = 0; let fail = 0
const check = (name, ok, detail) => { if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail).slice(0, 200))) } }

let status = null
try { status = await (await fetch(BASE + '/kybernos-cloud/status')).json() } catch (e) { console.error('○ inconclusive: the host does not answer at ' + BASE); process.exit(3) }
if (status === null) { console.error('○ inconclusive: the host answered nothing readable at ' + BASE); process.exit(3) }

console.log('the open route of the active server')
{
  const s = await (await fetch(BASE + '/kybernos-cloud/server')).json()
  check('GET /kybernos-cloud/server answers with the active server and its address', s.ok === true && typeof s.server.id === 'string' && /^https?:\/\//.test(s.server.api), Object.keys(s))
  check('every listed server says whether it is signed in', Array.isArray(s.servers) && s.servers.length >= 1 && s.servers.every((x) => typeof x.connected === 'boolean' && typeof x.api === 'string'))
  check('the active one is listed once', s.servers.filter((x) => x.active).length === 1)
  check('no token travels in it', JSON.stringify(s).indexOf('kys-') < 0)
}

console.log('\n' + (fail === 0 ? 'all ' + pass + ' checks passed' : fail + ' check(s) failed, ' + pass + ' passed'))
process.exit(fail === 0 ? 0 : 1)

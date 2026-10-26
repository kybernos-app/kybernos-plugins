// « Open Kybernos »: start if needed, wait for the routes, open the browser signed in. A fake server, a fake clock, a fake supervisor.
//   node scripts/test-kybernos-open.mjs   (0 = all green)
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { adresseDuJournal, ouvrir } from './kybernos-open.mjs'

let total = 0
const echecs = []
const ok = (nom, cond, detail = '') => { total++; if (!cond) echecs.push(nom + (detail ? ' — ' + detail : '')) }
const ICI = dirname(fileURLToPath(import.meta.url))

const TOKEN_URL = 'http://127.0.0.1:3080/?token=abcDEF_123-xyz'
ok('the last address of the log is the one used', adresseDuJournal('dsh web: http://127.0.0.1:3080/?token=old\nnoise\ndsh web: ' + TOKEN_URL + '\n') === TOKEN_URL)
ok('a log with no address gives null', adresseDuJournal('nothing here') === null && adresseDuJournal('') === null && adresseDuJournal(undefined) === null)
ok('an address on another host is never used', adresseDuJournal('dsh web: http://evil.example/?token=abc') === null)
ok('an address without a token is never used', adresseDuJournal('dsh web: http://127.0.0.1:3080/') === null)

// A scripted world: `etat` says what the port does at each poll; the clock advances by the pause.
const monde = ({ ecoute = true, pretApres = 0, service = false, tokenValide = true, journal = 'dsh web: ' + TOKEN_URL, delaiMs = 60_000, demarrerLeve = false } = {}) => {
  const w = { t: 0, polls: 0, demarres: [], ouverts: [], dits: [], appels: [] }
  const reponse = (status, ok2) => ({ status, ok: ok2 })
  const d = {
    port: 3080, delaiMs, pas: 500,
    maintenant: () => w.t,
    attendre: async (ms) => { w.t += ms },
    dire: (m) => w.dits.push(m),
    journal: () => journal,
    fetch: async (url) => {
      w.appels.push(url)
      if (url.endsWith('/kybernos-hub/state')) { w.polls++; if (!ecoute && w.demarres.length === 0) throw new Error('ECONNREFUSED'); return w.polls > pretApres ? reponse(200, true) : reponse(404, false) }
      if (url.includes('token=')) return tokenValide ? reponse(303, false) : reponse(401, false)
      if (!ecoute && w.demarres.length === 0) throw new Error('ECONNREFUSED')
      return reponse(401, false)
    },
    demarrerService: async () => { w.demarres.push('service'); return service },
    demarrerDetache: async () => { if (demarrerLeve) throw new Error('`dsh` was not found'); w.demarres.push('detache') },
    navigateur: async (u) => { w.ouverts.push(u) },
  }
  return { w, d }
}

{ // running and ready
  const { w, d } = monde()
  const r = await ouvrir(d)
  ok('running: nothing is started, the browser opens signed in', r.ok && !r.demarre && r.signe && w.demarres.length === 0 && w.ouverts[0] === TOKEN_URL)
  ok('running: nothing said that would carry the token', w.dits.every((m) => !m.includes('token')))
}
{ // an old log line: the server says 401 to its token
  const { w, d } = monde({ tokenValide: false })
  const r = await ouvrir(d)
  ok('stale token: the bare address is opened', r.ok && !r.signe && w.ouverts[0] === 'http://127.0.0.1:3080/')
}
{ // no log at all
  const { w, d } = monde({ journal: '' })
  ok('no log: the bare address is opened', (await ouvrir(d)).ok && w.ouverts[0] === 'http://127.0.0.1:3080/')
}
{ // not running, a supervisor owns it
  const { w, d } = monde({ ecoute: false, pretApres: 3, service: true })
  const r = await ouvrir(d)
  ok('stopped, supervised: the supervisor is asked, no second DSH is started', r.ok && r.demarre && w.demarres.join() === 'service')
  ok('stopped: it waits for the routes before opening anything', w.polls > 3 && w.ouverts.length === 1)
}
{ // not running, nothing supervises it
  const { w, d } = monde({ ecoute: false, pretApres: 2, service: false })
  const r = await ouvrir(d)
  ok('stopped, unsupervised: a detached DSH is started', r.ok && w.demarres.join() === 'service,detache')
}
{ // listening but the routes are not mounted yet (the ~15 s after a start)
  const { w, d } = monde({ ecoute: true, pretApres: 5 })
  const r = await ouvrir(d)
  ok('starting by itself: nothing is started, it waits, the browser opens once ready', r.ok && w.demarres.length === 0 && w.ouverts.length === 1 && w.polls > 5)
}
{ // never ready
  const { w, d } = monde({ ecoute: true, pretApres: 1e9, delaiMs: 5000 })
  const r = await ouvrir(d)
  ok('never ready: gives up on time and opens NOTHING (no error card for the person)', r.ok === false && r.raison === 'timeout' && w.ouverts.length === 0 && w.t >= 5000 && w.t < 7000)
}
{ // dsh missing
  const { d } = monde({ ecoute: false, demarrerLeve: true })
  let msg = null
  try { await ouvrir(d) } catch (e) { msg = e.message }
  ok('dsh not installed: the error says so', msg !== null && msg.includes('dsh'))
}

// The real command against a real (fake) server: ready → exit 0, nothing started, nothing printed that carries a token.
const srv = createServer((req, res) => {
  if (req.url === '/kybernos-hub/state') { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{}'); return }
  res.writeHead(401); res.end('no')
})
await new Promise((r) => srv.listen(0, '127.0.0.1', r))
const port = srv.address().port
const sortie = await new Promise((resolve) => {
  import('node:child_process').then(({ execFile }) => execFile(process.execPath, [join(ICI, 'kybernos-open.mjs'), '--port', String(port), '--no-browser', '--timeout', '5'], { env: { ...process.env, HOME: '/nonexistent-kb-open-test', DSH_HOME: '/nonexistent-kb-open-test/.dsh' } }, (e, out) => resolve({ code: e ? (e.code ?? 1) : 0, out })))
})
srv.close()
ok('the command: a ready server → exit 0', sortie.code === 0, String(sortie.code))
ok('the command: says it is running, prints no address', /Kybernos is running\./.test(sortie.out) && !sortie.out.includes('http'))

console.log('OPEN KYBERNOS — ' + total + ' assertions, ' + echecs.length + ' failure(s)')
for (const e of echecs) console.log('  ✗ ' + e)
process.exit(echecs.length === 0 ? 0 : 1)

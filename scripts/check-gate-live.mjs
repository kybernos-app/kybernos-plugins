// Real-engine check of the gate: a gate in front of a REAL `dsh web`, signed in with the password only.
// It proves what the unit tests cannot: that DSH accepts the session cookie the gate mints, for the page, its
// assets and its /api, and that without the gate's cookie nothing reaches DSH.
//
//   node scripts/check-gate-live.mjs --dsh-port 3097 --dsh-home <HOME of that dsh>/.dsh
//
// Use an ISOLATED dsh (scripts/sandbox, own HOME and DSH_HOME), never the instance a person is working in:
// the gate reads that dsh's session secret from `<dsh-home>/.credentials.yaml`.
import http from 'node:http'
import { randomBytes } from 'node:crypto'
import { loadConfig } from '../packages/kybernos-gate/core/config.mjs'
import { createGate } from '../packages/kybernos-gate/core/server.mjs'
import { mintDshCookie, readDshSecret } from '../packages/kybernos-gate/core/dsh-session.mjs'

const arg = (name) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined }
const dshPort = Number(arg('--dsh-port'))
const dshHome = arg('--dsh-home')
if (!Number.isInteger(dshPort) || dshPort <= 0 || !dshHome) { console.error('usage: node scripts/check-gate-live.mjs --dsh-port <port> --dsh-home <dsh home>'); process.exit(2) }
if (dshPort === 3080) { console.error('refusing port 3080: that is the instance a person works in'); process.exit(2) }

const PASSWORD = 'live check password'
let failures = 0
const check = (name, ok, detail = '') => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  (' + detail + ')' : ''}`); if (!ok) failures += 1 }

const get = (port, path, headers = {}) => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port, path, headers }, (res) => {
    const chunks = []
    res.on('data', (c) => chunks.push(c))
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }))
  }).on('error', reject)
})
const postJson = (port, path, payload) => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port, method: 'POST', path, headers: { origin: `http://127.0.0.1:${port}`, 'content-type': 'application/json' } }, (res) => {
    const chunks = []
    res.on('data', (c) => chunks.push(c))
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }))
  })
  req.on('error', reject)
  req.end(JSON.stringify(payload))
})

console.log(`gate -> real dsh on 127.0.0.1:${dshPort}`)
const direct = await get(dshPort, '/')
check('control: DSH alone answers 401 without its own cookie', direct.status === 401, 'got ' + direct.status)

const config = await loadConfig({
  DSH_HOME: dshHome, KYBERNOS_GATE_PASSWORD: PASSWORD, KYBERNOS_GATE_PORT: '0', KYBERNOS_GATE_UPSTREAM: `http://127.0.0.1:${dshPort}`,
  // the gate's own session secret must not be written into the dsh home under test
  KYBERNOS_GATE_SECRET: randomBytes(32).toString('hex')
}, { warn: (m) => console.log('  note: ' + m) })
const gate = createGate(config, { log: () => {} })
const { port } = await gate.listen()
try {
  const nav = await get(port, '/', { accept: 'text/html' })
  check('without a session the gate redirects to its sign-in page', nav.status === 303 && nav.headers.location.startsWith('/__gate/login'))

  const bad = await postJson(port, '/__gate/login', { user: 'kybernos', password: 'wrong wrong' })
  check('a wrong password is refused', bad.status === 401)
  const good = await postJson(port, '/__gate/login', { user: 'kybernos', password: PASSWORD })
  check('the right password is accepted', good.status === 200)
  const cookies = [].concat(good.headers['set-cookie'] ?? []).map((c) => c.split(';')[0])
  check('the gate hands over its cookie AND a DSH cookie', cookies.some((c) => c.startsWith('kybernos_gate=')) && cookies.some((c) => c.startsWith('dsh-auth-')), cookies.map((c) => c.split('=')[0]).join(', '))
  const jar = cookies.join('; ')

  const index = await get(port, '/', { accept: 'text/html', cookie: jar })
  check('the page opens through the gate with NO DSH sign-in page', index.status === 200 && /<html|<!doctype/i.test(index.text), 'status ' + index.status)
  const asset = /(?:src|href)="(\.?\/?[^"]+\.(?:js|css))"/i.exec(index.text)
  if (asset) {
    const url = asset[1].startsWith('/') ? asset[1] : '/' + asset[1].replace(/^\.\//, '')
    const a = await get(port, url, { cookie: jar })
    check('an asset of the page loads through the gate', a.status === 200, `${url} -> ${a.status}`)
  } else check('the page references an asset to fetch', false)

  const cookieOnly = cookies.find((c) => c.startsWith('dsh-auth-'))
  const viaGateWithoutGateCookie = await get(port, '/', { accept: 'text/html', cookie: cookieOnly })
  check('DSH\'s cookie alone does not open the gate', viaGateWithoutGateCookie.status === 303)

  // The page talks to DSH over HTTP on /api (DSH has no browser WebSocket; its WebSocket route serves paired
  // remote devices and is authenticated by pairing, not by this cookie).
  const rpc = (target, headers) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: target, method: 'POST', path: '/api', headers: { origin: `http://127.0.0.1:${target}`, 'content-type': 'application/json', ...headers } }, (res) => {
      res.resume(); res.on('end', () => resolve(res.statusCode))
    })
    req.on('error', reject); req.end('{}')
  })
  const directNoCookie = await rpc(dshPort, {})
  check('control: DSH\'s /api refuses a call without its cookie', directNoCookie === 401 || directNoCookie === 403, 'status ' + directNoCookie)
  const gateNoSession = await rpc(port, {})
  check('through the gate, a call without a session is refused before DSH', gateNoSession === 401, 'status ' + gateNoSession)
  const gateSession = await rpc(port, { cookie: jar })
  check('through the gate, a call with the session reaches DSH\'s /api and is not an auth refusal', gateSession !== 401 && gateSession !== 403 && gateSession !== 502, 'status ' + gateSession)
  // The same call straight to DSH with a cookie valid for ITS authority: the gate must answer exactly as the engine does.
  const own = mintDshCookie({ secret: readDshSecret(dshHome), hostHeader: `127.0.0.1:${dshPort}`, ttlMs: 3600000 })
  const directWithCookie = await rpc(dshPort, { cookie: own.header.split(';')[0] })
  check('the engine answers a signed-in /api call the same way directly and through the gate', directWithCookie === gateSession && directWithCookie !== directNoCookie, `direct ${directWithCookie}, gate ${gateSession}, without cookie ${directNoCookie}`)

  const out = await new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/__gate/logout', headers: { origin: `http://127.0.0.1:${port}`, host: `127.0.0.1:${port}` } }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)) })
    req.on('error', reject); req.end()
  })
  check('logout answers 200', out === 200)
} finally {
  await gate.close()
}
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)

// scripts/lib-egress-spy.mjs in isolation: it refuses what leaves the machine, writes down where it went and what it carried, and lets loopback through.
// The phone-model check (check-phone-model-chat.mjs) relies on it to say « the person's words are in nothing the engine tried to send away », so this proves the spy
// would SEE such a leak (a canary word in a fetch body, in an http body, in a plain socket's destination) and does not cry wolf on the machine's own traffic.
//   node scripts/test-egress-spy.mjs
import http from 'node:http'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

let pass = 0
let fail = 0
const ok = (name, cond, detail) => { if (cond === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail !== undefined ? ' — ' + detail : '')) } }

const HERE = dirname(fileURLToPath(import.meta.url))
const SPY = pathToFileURL(join(HERE, 'lib-egress-spy.mjs')).href
const CANARY = 'zorblax' + Math.random().toString(16).slice(2, 8)

const server = http.createServer((req, res) => { let raw = ''; req.on('data', (c) => { raw += c }); req.on('end', () => { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('local:' + raw) }) })
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const PORT = server.address().port

const dir = mkdtempSync(join(tmpdir(), 'kb-egress-spy-'))
// asynchronous on purpose: the local server below lives in THIS process, and a blocking spawn would starve it while the child waits for its answer
const run = (name, code, logName = name) => new Promise((resolve) => {
  const log = join(dir, logName + '.jsonl')
  const child = spawn(process.execPath, ['--import', SPY, '--input-type=module', '-e', code], { env: { ...process.env, KB_EGRESS_LOG: log, NODE_OPTIONS: '' }, stdio: ['ignore', 'pipe', 'pipe'] })
  let out = ''
  let err = ''
  child.stdout.on('data', (d) => { out += d }); child.stderr.on('data', (d) => { err += d })
  const timer = setTimeout(() => { try { child.kill('SIGKILL') } catch (e) { /* gone */ } }, 20000)
  child.on('close', (status) => {
    clearTimeout(timer)
    const lines = existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter((l) => l !== '').map((l) => JSON.parse(l)) : []
    resolve({ out: out.trim(), err: err.trim(), lines, status })
  })
})

console.log('a fetch off the machine')
{
  const r = await run('fetch', `try { await fetch('https://api.example.invalid/v1/messages', { method: 'POST', body: JSON.stringify({ messages: [{ role: 'user', content: 'Donne-moi une recette ${CANARY}' }] }) }); console.log('went') } catch (e) { console.log('refused') }`)
  ok('is refused: the call fails, nothing reaches anyone', r.out === 'refused', r.out + ' ' + r.err.slice(0, 200))
  ok('is written down with its destination and its body, so the canary word is found in it', r.lines.length === 1 && r.lines[0].kind === 'fetch' && r.lines[0].host === 'api.example.invalid' && r.lines[0].method === 'POST' && JSON.stringify(r.lines[0]).includes(CANARY), JSON.stringify(r.lines))
}
console.log('an http / https request off the machine')
{
  const r = await run('https', `import https from 'node:https'
    const req = https.request({ host: 'api.example.invalid', path: '/v1/chat/completions', method: 'POST' }, () => console.log('went'))
    req.on('error', () => console.log('refused'))
    req.write('{"text":"${CANARY}"}'); req.end()`)
  ok('https.request is refused and its body is written down', r.out === 'refused' && r.lines.some((l) => l.kind === 'https' && l.host === 'api.example.invalid' && JSON.stringify(l).includes(CANARY)), r.out + ' ' + JSON.stringify(r.lines).slice(0, 300))
  const h = await run('http', `import http from 'node:http'
    const req = http.request('http://plain.example.invalid/x', { method: 'POST' }, () => console.log('went'))
    req.on('error', () => console.log('refused'))
    req.end('${CANARY}')`)
  ok('http.request given a URL is refused and its body is written down', h.out === 'refused' && h.lines.some((l) => l.kind === 'http' && l.host === 'plain.example.invalid' && JSON.stringify(l).includes(CANARY)), h.out + ' ' + JSON.stringify(h.lines).slice(0, 300))
}
console.log('a bare socket off the machine')
{
  const r = await run('socket', `import net from 'node:net'
    const s = net.connect({ host: 'raw.example.invalid', port: 443 })
    s.on('error', () => console.log('refused')); s.on('connect', () => console.log('went'))`)
  ok('is refused and its destination written down (a socket shows no body)', r.out === 'refused' && r.lines.some((l) => l.kind === 'socket' && l.host === 'raw.example.invalid' && l.port === 443), r.out + ' ' + JSON.stringify(r.lines))
}
console.log('the machine\'s own traffic')
{
  const r = await run('loopback', `
    const a = await (await fetch('http://127.0.0.1:${PORT}/x', { method: 'POST', body: 'hello' })).text()
    const b = await (await fetch('http://localhost:${PORT}/y', { method: 'POST', body: 'again' })).text()
    console.log(a + '|' + b)`)
  ok('loopback passes (127.0.0.1 and localhost) and is not written down', r.out === 'local:hello|local:again' && r.lines.length === 0, r.out + ' ' + r.err.slice(0, 200) + ' ' + JSON.stringify(r.lines))
}
console.log('without a log file')
{
  const log = join(dir, 'none.jsonl')
  const r = await new Promise((resolve) => {
    const child = spawn(process.execPath, ['--import', SPY, '--input-type=module', '-e', `try { await fetch('https://api.example.invalid/'); console.log('went') } catch (e) { console.log('refused') }`], { env: { ...process.env, KB_EGRESS_LOG: '', NODE_OPTIONS: '' }, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    child.stdout.on('data', (d) => { out += d }); child.stderr.on('data', (d) => { err += d })
    child.on('close', (status) => resolve({ out: out.trim(), err, status }))
  })
  ok('still refuses, and never throws about the missing file', r.out === 'refused' && r.status === 0 && !existsSync(log), r.out + r.err.slice(0, 200))
}

server.close()
try { rmSync(dir, { recursive: true, force: true }) } catch (e) { /* left in the temporary folder */ }
console.log('\n' + (fail === 0 ? 'all ' + pass + ' passed' : pass + ' passed, ' + fail + ' FAILED'))
process.exit(fail === 0 ? 0 : 1)

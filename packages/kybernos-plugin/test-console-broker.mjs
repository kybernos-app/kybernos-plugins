// Tests of the broker in the DSH page that stands between the Team settings console (an iframe of another origin) and the
// local relay route.   node packages/kybernos-plugin/test-console-broker.mjs
//
// The broker is a few lines inside the page component (KbWsConsole in client.js). The test cuts that exact code out of the
// source and runs it against stubs, so what is proven is the shipped code, not a copy: who is heard, what is forwarded,
// where the answer goes.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

let failed = 0
const check = (name, ok, detail) => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok || detail === undefined ? '' : '  — ' + detail))
  if (!ok) failed += 1
}

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'client.js'), 'utf8')
const from = source.indexOf('const repondre = (fr, message) => {')
const to = source.indexOf("window.addEventListener('message', sur)", from)
check('the broker code is where the test expects it', from > 0 && to > from)
const snippet = source.slice(from, to)

const CONSOLE_ORIGIN = 'https://console.example'
const harness = () => {
  const posted = []
  const fetched = []
  let keyAsked = 0
  const iframeWindow = { postMessage: (message, origin) => posted.push({ message, origin }) }
  const iframe = { contentWindow: iframeWindow }
  const doc = { querySelector: (sel) => (sel === '.kbwsif iframe' ? iframe : null) }
  const answers = { json: { ok: true, status: 200, body: { shared_remaining: 12.5 } }, fail: false }
  const fetchStub = (url, opts) => {
    fetched.push({ url, opts })
    return answers.fail ? Promise.reject(new Error('offline')) : Promise.resolve({ json: () => Promise.resolve(answers.json) })
  }
  const sur = new Function('kbWsOrigin', 'envoyerCle', 'document', 'fetch', snippet + '\nreturn sur')(() => CONSOLE_ORIGIN, () => { keyAsked += 1 }, doc, fetchStub)
  return { sur, posted, fetched, iframeWindow, answers, get keyAsked () { return keyAsked } }
}
const settle = () => new Promise((r) => setTimeout(r, 5))

console.log('who is heard')
{
  const h = harness()
  h.sur({ source: { other: true }, origin: CONSOLE_ORIGIN, data: { kbApi: { id: '1', method: 'GET', path: '/v1/me' } } })
  await settle()
  check('a message from another frame is ignored', h.fetched.length === 0 && h.posted.length === 0)
  h.sur({ source: h.iframeWindow, origin: 'https://evil.example', data: { kbApi: { id: '1', method: 'GET', path: '/v1/me' } } })
  await settle()
  check('a message from the console\'s window but another origin is ignored', h.fetched.length === 0 && h.posted.length === 0)
  h.sur({ source: h.iframeWindow, origin: CONSOLE_ORIGIN, data: 'not an object' })
  h.sur({ source: h.iframeWindow, origin: CONSOLE_ORIGIN, data: null })
  await settle()
  check('a message that is not an object is ignored', h.fetched.length === 0 && h.posted.length === 0)
}

console.log('what it forwards')
{
  const h = harness()
  h.sur({ source: h.iframeWindow, origin: CONSOLE_ORIGIN, data: { kbConsoleReady: true } })
  await settle()
  check('the console\'s ready signal triggers the key hand-off and announces the broker, to its exact origin', h.keyAsked === 1 && h.posted.length === 1 && h.posted[0].message.kbApiReady === true && h.posted[0].origin === CONSOLE_ORIGIN)
  h.posted.length = 0
  h.sur({ source: h.iframeWindow, origin: CONSOLE_ORIGIN, data: { kbApi: { id: 'r1', method: 'GET', path: '/v1/workspaces/w/llm/budget' } } })
  await settle()
  check('a GET is sent to the local relay route with the path URL-encoded, same-origin credentials only', h.fetched.length === 1 && h.fetched[0].url === '/kybernos-cloud/relay?p=' + encodeURIComponent('/v1/workspaces/w/llm/budget') && h.fetched[0].opts.credentials === 'same-origin' && h.fetched[0].opts.method === undefined)
  check('the answer goes back with the same id, to the console\'s exact origin, never *', h.posted.length === 1 && h.posted[0].origin === CONSOLE_ORIGIN && h.posted[0].message.kbApiReply.id === 'r1' && h.posted[0].message.kbApiReply.ok === true && h.posted[0].message.kbApiReply.status === 200 && h.posted[0].message.kbApiReply.body.shared_remaining === 12.5)
  for (const [label, request] of [['a POST', { id: 'x', method: 'POST', path: '/v1/me' }], ['a missing id', { method: 'GET', path: '/v1/me' }], ['a missing path', { id: 'x', method: 'GET' }], ['a very long path', { id: 'x', method: 'GET', path: '/' + 'a'.repeat(400) }], ['an object id', { id: { a: 1 }, method: 'GET', path: '/v1/me' }]]) {
    const g = harness()
    g.sur({ source: g.iframeWindow, origin: CONSOLE_ORIGIN, data: { kbApi: request } })
    await settle()
    check(label + ' is refused with no call to the host', g.fetched.length === 0 && g.posted.length === 1 && g.posted[0].message.kbApiReply.ok === false && g.posted[0].origin === CONSOLE_ORIGIN)
  }
}

console.log('when the host does not answer')
{
  const h = harness()
  h.answers.fail = true
  h.sur({ source: h.iframeWindow, origin: CONSOLE_ORIGIN, data: { kbApi: { id: 'r2', method: 'GET', path: '/v1/me' } } })
  await settle()
  const reply = h.posted[0] && h.posted[0].message.kbApiReply
  check('an unreachable host is an ok:false, status 0 answer, not a hang or a crash', reply !== undefined && reply.ok === false && reply.status === 0 && reply.id === 'r2' && reply.error === 'relais injoignable')
}

console.log('the shipped code')
check('the broker never posts to *', !/kbApiReply[^\n]*postMessage\([^)]*'\*'/.test(snippet) && !/postMessage\(message, '\*'\)/.test(snippet))
check('it relays only GET and only to the local relay route', snippet.indexOf("demande.method !== 'GET'") > 0 && snippet.indexOf("'/kybernos-cloud/relay?p='") > 0)

console.log('\n' + (failed === 0 ? 'all checks OK' : failed + ' check(s) failed'))
process.exit(failed === 0 ? 0 : 1)

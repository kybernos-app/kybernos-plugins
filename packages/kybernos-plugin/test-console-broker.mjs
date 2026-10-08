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
  const events = []
  const kbServer = { workspace: 'w-before' }
  const win = { dispatchEvent: (e) => { events.push(e.type); return true } }
  class EventStub { constructor (type) { this.type = type } }
  const sur = new Function('kbWsOrigin', 'envoyerCle', 'document', 'fetch', 'kbServer', 'window', 'Event', snippet + '\nreturn sur')(() => CONSOLE_ORIGIN, () => { keyAsked += 1 }, doc, fetchStub, kbServer, win, EventStub)
  return { sur, posted, fetched, iframeWindow, answers, events, kbServer, get keyAsked () { return keyAsked } }
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

console.log('changing the active space from the console')
{
  const h = harness()
  h.answers.json = { ok: true, state: { active_workspace_id: 'w-new' } }
  h.sur({ source: h.iframeWindow, origin: CONSOLE_ORIGIN, data: { kbSwitchSpace: { id: 'w-new' } } })
  await settle()
  check('a switch is sent to the local active-space route, same-origin, with the id only', h.fetched.length === 1 && h.fetched[0].url === '/kybernos-cloud/space/active' && h.fetched[0].opts.method === 'POST' && h.fetched[0].opts.credentials === 'same-origin' && h.fetched[0].opts.body === JSON.stringify({ workspace_id: 'w-new' }), JSON.stringify(h.fetched))
  check('the page remembers the new space and tells the Cloud card to reload', h.kbServer.workspace === 'w-new' && h.events.length === 1 && h.events[0] === 'kybernos-cloud:space-changed', JSON.stringify({ ws: h.kbServer.workspace, ev: h.events }))
  check('the console is told it worked, at its exact origin', h.posted.length === 1 && h.posted[0].origin === CONSOLE_ORIGIN && h.posted[0].message.kbSpaceReply.ok === true && h.posted[0].message.kbSpaceReply.id === 'w-new')

  const r = harness()
  r.answers.json = { ok: false, error: 'espace_inconnu' }
  r.sur({ source: r.iframeWindow, origin: CONSOLE_ORIGIN, data: { kbSwitchSpace: { id: 'w-gone' } } })
  await settle()
  check('a space the host refuses changes nothing and the console is told why', r.kbServer.workspace === 'w-before' && r.events.length === 0 && r.posted[0].message.kbSpaceReply.ok === false && r.posted[0].message.kbSpaceReply.error === 'espace_inconnu')

  for (const [label, id] of [['an empty id', ''], ['a path in the id', '../x'], ['an id with a space', 'a b'], ['a number', 7], ['a very long id', 'x'.repeat(81)]]) {
    const g = harness()
    g.sur({ source: g.iframeWindow, origin: CONSOLE_ORIGIN, data: { kbSwitchSpace: { id } } })
    await settle()
    check(label + ' is refused with no call to the host', g.fetched.length === 0 && g.events.length === 0 && g.posted.length === 1 && g.posted[0].message.kbSpaceReply.ok === false)
  }

  const f = harness()
  f.sur({ source: { other: true }, origin: CONSOLE_ORIGIN, data: { kbSwitchSpace: { id: 'w-new' } } })
  f.sur({ source: f.iframeWindow, origin: 'https://evil.example', data: { kbSwitchSpace: { id: 'w-new' } } })
  await settle()
  check('another frame or another origin cannot switch the space', f.fetched.length === 0 && f.events.length === 0)

  const d = harness()
  d.answers.fail = true
  d.sur({ source: d.iframeWindow, origin: CONSOLE_ORIGIN, data: { kbSwitchSpace: { id: 'w-new' } } })
  await settle()
  check('an unreachable host is an ok:false answer, nothing changes', d.kbServer.workspace === 'w-before' && d.posted[0].message.kbSpaceReply.ok === false && d.posted[0].message.kbSpaceReply.error === 'hote_injoignable')
}

console.log('creating a team from the console')
{
  const h = harness()
  h.answers.json = { ok: true, state: { active_workspace_id: 'w-made' } }
  h.sur({ source: h.iframeWindow, origin: CONSOLE_ORIGIN, data: { kbNewSpace: { name: '  Acme Studio  ' } } })
  await settle()
  check('the name goes to the host\'s create route, trimmed', h.fetched.length === 1 && h.fetched[0].url === '/kybernos-cloud/space/create' && h.fetched[0].opts.body === JSON.stringify({ name: 'Acme Studio' }), JSON.stringify(h.fetched))
  check('the new space becomes the active one and the card is told', h.kbServer.workspace === 'w-made' && h.events[0] === 'kybernos-cloud:space-changed')
  check('the console learns the new id', h.posted[0].message.kbSpaceReply.ok === true && h.posted[0].message.kbSpaceReply.created === true && h.posted[0].message.kbSpaceReply.id === 'w-made')

  const r = harness()
  r.answers.json = { ok: false, error: 'creation_refusee', status: 402 }
  r.sur({ source: r.iframeWindow, origin: CONSOLE_ORIGIN, data: { kbNewSpace: { name: 'Acme' } } })
  await settle()
  check('a refusal creates nothing here: the active space stays, the console is told', r.kbServer.workspace === 'w-before' && r.events.length === 0 && r.posted[0].message.kbSpaceReply.ok === false && r.posted[0].message.kbSpaceReply.error === 'creation_refusee')

  for (const [label, name] of [['an empty name', '   '], ['a missing name', undefined], ['a number', 5]]) {
    const g = harness()
    g.sur({ source: g.iframeWindow, origin: CONSOLE_ORIGIN, data: { kbNewSpace: { name } } })
    await settle()
    check(label + ' is refused with no call to the host', g.fetched.length === 0 && g.posted[0].message.kbSpaceReply.ok === false && g.posted[0].message.kbSpaceReply.error === 'nom_absent')
  }

  const l = harness()
  l.answers.json = { ok: true, state: { active_workspace_id: 'w-made' } }
  l.sur({ source: l.iframeWindow, origin: CONSOLE_ORIGIN, data: { kbNewSpace: { name: 'x'.repeat(200) } } })
  await settle()
  check('a very long name is cut to 60 characters before it leaves the page', JSON.parse(l.fetched[0].opts.body).name.length === 60)
}

console.log('the shipped code')
check('the broker never posts to *', !/kbApiReply[^\n]*postMessage\([^)]*'\*'/.test(snippet) && !/postMessage\(message, '\*'\)/.test(snippet))
check('it relays only GET and only to the local relay route', snippet.indexOf("demande.method !== 'GET'") > 0 && snippet.indexOf("'/kybernos-cloud/relay?p='") > 0)

console.log('\n' + (failed === 0 ? 'all checks OK' : failed + ' check(s) failed'))
process.exit(failed === 0 ? 0 : 1)

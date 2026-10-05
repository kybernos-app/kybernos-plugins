// Tests of the key hand-off to the Team settings console (ws-console-key.mjs) and of how the host and the page use it.
//   node packages/kybernos-plugin/test-ws-console-key.mjs
//
// The admin key is a secret: what matters is who can get it (only this server's own pages), what the answer carries
// (the key and nothing else), and where it goes next (the console's origin, never a URL).
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { wsConsoleKeyReply, WS_CONSOLE_KEY_PATH, MAX_KEY_LENGTH } from './ws-console-key.mjs'

let failed = 0
const check = (name, ok, detail) => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok || detail === undefined ? '' : '  — ' + detail))
  if (!ok) failed += 1
}

const get = { method: 'GET' }
const SECRET = 'sk-admin-test-0123456789'
const deps = (over) => {
  const calls = { read: 0 }
  const d = Object.assign({
    sameOriginStrict: () => true,
    readSettings: async () => { calls.read += 1; return { wsAdminKey: SECRET, pairingToken: 'kya-should-never-leave', gatewayBase: 'https://x.test' } },
  }, over || {})
  return { d, calls }
}

console.log('the answer')
{
  const { d } = deps()
  const r = await wsConsoleKeyReply(get, d)
  check('a same-origin GET gets 200 and the key', r.status === 200 && r.body.ok === true && r.body.key === SECRET, JSON.stringify(r))
  check('the body carries { ok, key } and nothing else (no token, no base URL)', Object.keys(r.body).sort().join() === 'key,ok' && JSON.stringify(r).indexOf('kya-') < 0)
  const padded = await wsConsoleKeyReply(get, deps({ readSettings: async () => ({ wsAdminKey: '  ' + SECRET + '\n' }) }).d)
  check('a key saved with spaces or a newline is trimmed', padded.body.key === SECRET)
  check('the route path is the one the page calls', WS_CONSOLE_KEY_PATH === '/kybernos/ws-console-key')
}

console.log('no key')
{
  for (const [label, settings] of [['absent field', {}], ['empty string', { wsAdminKey: '' }], ['only spaces', { wsAdminKey: '   ' }], ['a number', { wsAdminKey: 42 }], ['null settings', null]]) {
    const r = await wsConsoleKeyReply(get, deps({ readSettings: async () => settings }).d)
    check(label + ' → 200 with key null (the console then asks for it itself)', r.status === 200 && r.body.ok === true && r.body.key === null, JSON.stringify(r))
  }
  const huge = await wsConsoleKeyReply(get, deps({ readSettings: async () => ({ wsAdminKey: 'k'.repeat(MAX_KEY_LENGTH + 1) }) }).d)
  check('a corrupted, oversized value is not echoed', huge.body.key === null)
  const boom = await wsConsoleKeyReply(get, deps({ readSettings: async () => { throw new Error('disk gone') } }).d)
  check('an unreadable settings file never throws and never leaks the error', boom.status === 200 && boom.body.key === null && JSON.stringify(boom).indexOf('disk') < 0)
}

console.log('who may ask')
{
  const { d, calls } = deps({ sameOriginStrict: () => false })
  const r = await wsConsoleKeyReply(get, d)
  check('a request that is not from this server gets 403', r.status === 403 && r.body.ok === false && !('key' in r.body))
  check('and the settings file is NOT even read (the secret never enters the request)', calls.read === 0)
  for (const method of ['POST', 'PUT', 'DELETE', 'HEAD', undefined]) {
    const { d: dd, calls: c } = deps()
    const m = await wsConsoleKeyReply({ method }, dd)
    check((method || 'no method') + ' → 405, nothing read', m.status === 405 && c.read === 0)
  }
  check('a missing request object is refused, not a crash', (await wsConsoleKeyReply(null, deps().d)).status === 405)
}

console.log('the wiring (drift tests)')
{
  const here = dirname(fileURLToPath(import.meta.url))
  const host = readFileSync(join(here, 'index.js'), 'utf8')
  const page = readFileSync(join(here, 'client.js'), 'utf8')
  check('the host registers the route through the tested helper', /path: '\/kybernos\/ws-console-key'[\s\S]{0,400}wsConsoleKeyReply\(req, \{ sameOriginStrict: sameOriginStrict/.test(host))
  check('the host no longer reads the secret field itself (one door: the helper)', (host.match(/\.wsAdminKey/g) || []).length === 0)
  check('the helper is imported from the module next to it', host.indexOf("from './ws-console-key.mjs'") > 0)
  check('the page posts the key to the console\'s exact origin, not to *', page.indexOf('postMessage({ kbConsoleKey: keyRef.current }, kbWsOrigin())') > 0 && !/kbConsoleKey[^\n]{0,80}'\*'/.test(page))
  check('the page only accepts the console\'s ready signal from its own iframe', page.indexOf('ev.source !== fr.contentWindow') > 0)
  const urlLine = page.slice(page.indexOf("const KB_WS_CONSOLE = "), page.indexOf("const kbWsOrigin"))
  check('the console URL carries the gateway and no key', urlLine.indexOf('?gw=') > 0 && !/[?&]key=/.test(urlLine))
  check('the page asks the route with same-origin credentials only', page.indexOf("fetch('/kybernos/ws-console-key', { credentials: 'same-origin' })") > 0)
}

console.log('\n' + (failed === 0 ? 'all checks OK' : failed + ' check(s) failed'))
process.exit(failed === 0 ? 0 : 1)

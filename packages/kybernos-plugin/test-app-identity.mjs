// The outbound identity: what leaves this machine must carry the product's name, not the engine's,
// and the rewrite must never touch a header it does not own.
//
//   node packages/kybernos-plugin/test-app-identity.mjs
//
// The last block is the one that matters: it boots a local HTTP endpoint and lets the SAME SDKs the
// engine's pi-ai adapter builds per request (`openai`, `@anthropic-ai/sdk` — read in the engine's
// node_modules) send a real request through the installed wrapper. What the endpoint receives is what
// a provider logs. It SKIPS (counted, not silently green) on a machine without the engine.
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import {
  APP_IDENTITY, desiredUserAgent, installAppIdentity, isEngineAttribution, logOutboundIdentity,
  resetOutboundLog, rewriteArgs, userAgentOf, versionOf, withAppIdentity,
} from './app-identity.mjs'

let failed = 0
const check = (name, ok, detail) => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok || detail === undefined ? '' : '  — ' + detail))
  if (!ok) failed += 1
}
const here = dirname(fileURLToPath(import.meta.url))
const ENGINE_UA = 'deepseek-harness/0.2.1-rc.2 (+https://github.com/deepseek-ai/deepseek-harness)'
const OURS = 'kybernos/0.1.1 (+https://kybernos.app)'

console.log('the value we send')
{
  check('userAgentOf renders product/version (+url)', userAgentOf(APP_IDENTITY, '1.2.3') === 'kybernos/1.2.3 (+https://kybernos.app)')
  check('the product is kybernos, the site is kybernos.app', APP_IDENTITY.product === 'kybernos' && APP_IDENTITY.url === 'https://kybernos.app')
  check('KYBERNOS_VERSION wins when it is a semver', versionOf(here, { KYBERNOS_VERSION: '9.8.7' }) === '9.8.7')
  check('a non-semver KYBERNOS_VERSION is ignored', versionOf(here, { KYBERNOS_VERSION: 'latest' }) === readFileSync(join(here, '..', '..', 'VERSION'), 'utf8').trim())
  check('no version anywhere → 0.0.0 (never an empty token)', versionOf('/nonexistent/dir', {}) === '0.0.0')
  check('KYBERNOS_USER_AGENT is taken as a full header value', desiredUserAgent({ KYBERNOS_USER_AGENT: 'custom/1 (+https://x)' }, here) === 'custom/1 (+https://x)')
  check('blank KYBERNOS_USER_AGENT falls back to the identity', desiredUserAgent({ KYBERNOS_USER_AGENT: '  ' }, here) === userAgentOf(APP_IDENTITY, versionOf(here, {})))
}

console.log('what counts as the engine\'s attribution')
{
  check('the engine value is recognised', isEngineAttribution(ENGINE_UA) === true)
  check('leading space is tolerated', isEngineAttribution(' ' + ENGINE_UA) === true)
  check('the SDK value is NOT ours to rewrite', isEngineAttribution('pi-ai/1.3.0') === false)
  check('an upstream contract value is NOT ours', isEngineAttribution('opencode/1.18.31') === false)
  check('an OAuth claude-cli value is NOT ours', isEngineAttribution('claude-cli/2.1.0') === false)
  check('empty and non-strings are NOT ours', isEngineAttribution('') === false && isEngineAttribution(undefined) === false && isEngineAttribution(42) === false)
}

console.log('the headers, in every shape fetch accepts')
{
  const fromObject = withAppIdentity({ 'user-agent': ENGINE_UA, accept: 'application/json' }, OURS)
  check('a plain object keeps its other fields', fromObject !== null && fromObject.get('accept') === 'application/json')
  check('a plain object gets the new value', fromObject.get('user-agent') === OURS)
  const fromHeaders = withAppIdentity(new Headers({ 'User-Agent': ENGINE_UA }), OURS)
  check('a Headers instance (the deepseek adapter path) is rewritten', fromHeaders.get('user-agent') === OURS)
  const fromPairs = withAppIdentity([['User-Agent', ENGINE_UA]], OURS)
  check('an array of pairs is rewritten', fromPairs.get('user-agent') === OURS)
  check('a foreign value is left alone (null: caller keeps its request)', withAppIdentity({ 'user-agent': 'pi-ai/1.3.0' }, OURS) === null)
  check('no user-agent at all is left alone', withAppIdentity({ accept: 'application/json' }, OURS) === null)
  check('an authorization header is never touched', withAppIdentity({ 'user-agent': ENGINE_UA, authorization: 'Bearer k' }, OURS).get('authorization') === 'Bearer k')
}

console.log('the arguments handed to fetch')
{
  const noted = []
  const [input, init] = rewriteArgs('https://api.example/v1/chat', { method: 'POST', headers: { 'user-agent': ENGINE_UA }, body: '{}' }, OURS, (h) => noted.push(h))
  check('the init headers carry the identity', new Headers(init.headers).get('user-agent') === OURS)
  check('the method and body survive the rewrite', init.method === 'POST' && init.body === '{}')
  check('the url is untouched', input === 'https://api.example/v1/chat')
  check('the host is reported for the proof log', noted.length === 1 && noted[0] === 'api.example', JSON.stringify(noted))

  const request = new Request('https://api.example/v1/chat', { method: 'POST', body: '{}', headers: { 'user-agent': ENGINE_UA } })
  const [rebuilt, noInit] = rewriteArgs(request, undefined, OURS, () => {})
  check('a Request carrying the value is rebuilt, not mutated', rebuilt instanceof Request && rebuilt.headers.get('user-agent') === OURS)
  check('the rebuilt Request keeps its method and url', rebuilt.method === 'POST' && rebuilt.url === 'https://api.example/v1/chat')
  check('no init is emitted for the rebuilt Request', noInit === undefined)
  check('the caller\'s Request still holds its own value (no mutation)', request.headers.get('user-agent') === ENGINE_UA)

  const [same, sameInit] = rewriteArgs('https://api.example/v1', { headers: { 'user-agent': 'opencode/1.18.31' } }, OURS, () => {})
  check('a request that is not ours comes back identical', same === 'https://api.example/v1' && sameInit.headers['user-agent'] === 'opencode/1.18.31')
  const [bare, bareInit] = rewriteArgs('https://api.example/v1', undefined, OURS, () => {})
  check('a request with no init passes through untouched', bare === 'https://api.example/v1' && bareInit === undefined)
}

console.log('the proof log')
{
  const dir = mkdtempSync(join(tmpdir(), 'kb-ua-'))
  const file = join(dir, 'app-identity.log')
  resetOutboundLog()
  const first = logOutboundIdentity('api.provider.test', OURS, { env: { KYBERNOS_UA_LOG: file } })
  logOutboundIdentity('api.provider.test', OURS, { env: { KYBERNOS_UA_LOG: file } })
  logOutboundIdentity('other.provider.test', OURS, { env: { KYBERNOS_UA_LOG: file } })
  const lines = readFileSync(file, 'utf8').trim().split('\n')
  check('one line per host, not per request', lines.length === 2, String(lines.length))
  check('the line carries the host and the value really sent', lines[0].includes('api.provider.test') && lines[0].includes(OURS), lines[0])
  check('the path is returned for the boot message', first === file)
  check('KYBERNOS_UA_LOG=off writes nothing', logOutboundIdentity('x.test', OURS, { env: { KYBERNOS_UA_LOG: 'off' } }) === null)
  const unwritable = logOutboundIdentity('x.test', OURS, { env: { KYBERNOS_UA_LOG: join(dir, 'missing', '\u0000bad') } })
  check('an unwritable path returns null instead of throwing', unwritable === null)
  check('the default path lives under the DSH home', logOutboundIdentity('d.test', OURS, { env: { DSH_HOME: dir } }) === join(dir, 'logs', 'app-identity.log'))
  rmSync(dir, { recursive: true, force: true })
}

console.log('installing it (no network)')
{
  const calls = []
  const fake = (input, init) => { calls.push([input, init]); return Promise.resolve('reply') }
  const holder = { fetch: fake }
  const install = installAppIdentity({ holder, userAgent: OURS, env: {}, log: () => {} })
  check('the install reports the value it will send', install.installed === true && install.ua === OURS)
  await holder.fetch('https://api.example/v1', { headers: { 'user-agent': ENGINE_UA } })
  check('the wrapped fetch rewrote the header on the wire', new Headers(calls[0][1].headers).get('user-agent') === OURS)
  await holder.fetch('https://api.example/v1', { headers: { 'user-agent': 'opencode/1.18.31' } })
  check('a foreign header reaches the transport unchanged', calls[1][1].headers['user-agent'] === 'opencode/1.18.31')
  check('the wrapped fetch returns the transport\'s promise as-is', typeof holder.fetch('https://api.example/v1').then === 'function')
  const again = installAppIdentity({ holder, userAgent: 'kybernos/9.9.9 (+https://kybernos.app)', env: {}, log: () => {} })
  check('a second install reuses the first wrapper (no stacking)', again.reused === true && again.ua === OURS)
  install.restore()
  check('restore puts the original fetch back', holder.fetch === fake)
  check('a holder without fetch is reported, not thrown', installAppIdentity({ holder: {}, env: {} }).installed === false)
  check('KYBERNOS_APP_IDENTITY=off installs nothing', installAppIdentity({ holder: { fetch: fake }, env: { KYBERNOS_APP_IDENTITY: 'off' } }).installed === false)
  const hooked = { fetch: () => Promise.resolve('x') }
  const hookedInstall = installAppIdentity({ holder: hooked, userAgent: OURS, env: {}, log: () => {} })
  // A header object that blows up while being read: the call must still go out, unchanged.
  const explosive = new Proxy({}, { get () { throw new Error('boom') }, ownKeys () { throw new Error('boom') }, getOwnPropertyDescriptor () { throw new Error('boom') } })
  check('a throwing header object does not break the call', await hooked.fetch('https://api.example/v1', { headers: explosive }).then(() => true, () => false))
  hookedInstall.restore()
}

console.log('what a provider endpoint really receives (engine SDKs, local server)')
{
  const engineModules = findEngineModules()
  if (engineModules === null) {
    console.log('SKIPPED: engine node_modules not found (set KYBERNOS_ENGINE_MODULES to the dsh install\'s node_modules)')
  } else {
    const seen = []
    const server = createServer((req, res) => {
      seen.push({ path: req.url, ua: req.headers['user-agent'] })
      res.writeHead(200, { 'content-type': 'application/json' })
      if (req.url.includes('/messages')) {
        res.end(JSON.stringify({ id: 'msg_1', type: 'message', role: 'assistant', model: 'stub', content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }))
      } else {
        res.end(JSON.stringify({ id: 'x', object: 'chat.completion', created: 0, model: 'stub', choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }))
      }
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const base = 'http://127.0.0.1:' + server.address().port
    const install = installAppIdentity({ env: {}, userAgent: OURS, log: () => {} })
    check('the identity is installed on the real global fetch', install.installed === true && globalThis.fetch[Symbol.for('kybernos.app-identity.wrapper')] === OURS)
    try {
      // openai: pi-ai's openAICompletionsApi builds `new OpenAI({ fetch })` per request.
      const OpenAI = (await import(pathToFileURL(join(engineModules, 'openai', 'index.js')).href)).default
      const openai = new OpenAI({ apiKey: 'sk-test', baseURL: base + '/v1', defaultHeaders: { 'User-Agent': ENGINE_UA } })
      await openai.chat.completions.create({ model: 'stub', messages: [{ role: 'user', content: 'hello' }] })
      check('the openai SDK (pi-ai openai-completions) sends kybernos, not deepseek-harness', seen[0]?.ua === OURS, String(seen[0]?.ua))

      // @anthropic-ai/sdk: pi-ai's anthropicMessagesApi builds `new Anthropic({ fetch })` per request.
      const Anthropic = (await import(pathToFileURL(join(engineModules, '@anthropic-ai', 'sdk', 'index.js')).href)).default
      const anthropic = new Anthropic({ apiKey: 'sk-test', baseURL: base + '/v1', defaultHeaders: { 'User-Agent': ENGINE_UA } })
      await anthropic.messages.create({ model: 'stub', max_tokens: 16, messages: [{ role: 'user', content: 'hello' }] })
      check('the anthropic SDK (pi-ai anthropic-messages) sends kybernos too', seen[1]?.ua === OURS, String(seen[1]?.ua))

      // The other direction: a vendor contract value must reach the provider untouched.
      const vendor = new OpenAI({ apiKey: 'sk-test', baseURL: base + '/v1', defaultHeaders: { 'User-Agent': 'opencode/1.18.31' } })
      await vendor.chat.completions.create({ model: 'stub', messages: [{ role: 'user', content: 'hello' }] })
      check('an upstream contract User-Agent is not ours to rewrite', seen[2]?.ua === 'opencode/1.18.31', String(seen[2]?.ua))
    } finally {
      install.restore()
      server.close()
    }
    check('restore leaves the global fetch as it was', String(globalThis.fetch).includes('kybernos.app-identity.wrapper') === false)
  }
}

console.log(failed === 0 ? '\nOK' : `\n${failed} failure(s)`)
process.exit(failed === 0 ? 0 : 1)

/** The engine's node_modules, where the very SDK copies pi-ai uses live. `null` when not found. */
function findEngineModules () {
  const candidates = []
  const declared = String(process.env.KYBERNOS_ENGINE_MODULES ?? '').trim()
  if (declared !== '') candidates.push(declared)
  const engineRoot = join(homedir(), '.dsh', 'kybernos', 'moteur')
  try {
    for (const version of readdirSyncSafe(engineRoot)) {
      const modules = join(engineRoot, version, 'node_modules')
      if (existsSync(join(modules, 'openai', 'package.json'))) candidates.push(modules)
    }
  } catch (e) { /* no local engine */ }
  try {
    for (const profile of readdirSyncSafe(join(homedir(), '.dsh', 'profiles'))) {
      const modules = join(homedir(), '.dsh', 'profiles', profile, 'node_modules')
      if (existsSync(join(modules, 'openai', 'package.json'))) candidates.push(modules)
    }
  } catch (e) { /* no profiles */ }
  for (const modules of candidates) {
    if (existsSync(join(modules, 'openai', 'package.json')) && existsSync(join(modules, '@anthropic-ai', 'sdk', 'package.json'))) return modules
  }
  return null
}

function readdirSyncSafe (dir) {
  try { return readdirSync(dir) } catch (e) { return [] }
}

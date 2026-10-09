// Tests of the server profile and the registry (the open half of Select server).   node packages/kybernos-cloud/test-server-profile.mjs
// Pure: no network, no DSH. What matters is what is REFUSED (a typo must never fall back to another server's address) and
// what each server is allowed to be (an LLM service of its own, or none at all).
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BUILTIN_API, DEFAULT_PROFILE, DEFAULT_SERVER_ID, activeServer, connectionsEndpoint, deriveWeb, llmBase, normalizeProfile, publicProfile, readRegistry, stateFileName } from './server-profile.mjs'
import { readFileSync } from 'node:fs'

let failed = 0
const check = (name, ok, detail) => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok || detail === undefined ? '' : '  — ' + detail))
  if (!ok) failed += 1
}
const dir = mkdtempSync(join(tmpdir(), 'kb-servers-'))
const file = join(dir, 'servers.json')
const write = (value) => writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value))

console.log('a profile')
{
  const p = normalizeProfile({ id: 'acme', name: 'Acme', api: 'https://kb.acme.example/' })
  check('only `api` is required; web and console are derived from it', p.ok === true && p.profile.web === 'https://kb.acme.example' && p.profile.console === 'https://kb.acme.example/workspace-console' && p.profile.name === 'Acme', JSON.stringify(p))
  const k = normalizeProfile({ id: 'kb2', api: 'https://api.kybernos.example' })
  // The old rule (api.x → x) pointed a server at ANOTHER host (the legacy web app); a server serves its own pages (account, activation, console).
  check('a server\'s pages live on its OWN host: the « api. » prefix is not stripped', k.ok === true && k.profile.web === 'https://api.kybernos.example' && k.profile.console === 'https://api.kybernos.example/workspace-console' && deriveWeb('https://api.kybernos.app') === 'https://api.kybernos.app', JSON.stringify(k))
  check('the console of a server that names none is <api>/workspace-console, never a host derived from it', deriveWeb('https://api.kybernos.app/') + '/workspace-console' === 'https://api.kybernos.app/workspace-console' && normalizeProfile({ id: 'kb3', api: 'https://api.kybernos.app' }).profile.console === 'https://api.kybernos.app/workspace-console')
  check('the name falls back to the id', k.profile.name === 'kb2')
  const full = normalizeProfile({ id: 'big', api: 'https://a.example', web: 'https://w.example/app/', console: 'https://w.example/app/console', services: { llm: 'https://llm.example/', gateway: 'https://gw.example' } })
  check('explicit web, console and services are kept (trailing slashes cut)', full.ok === true && full.profile.web === 'https://w.example/app' && full.profile.console === 'https://w.example/app/console' && full.profile.services.llm === 'https://llm.example' && full.profile.services.gateway === 'https://gw.example', JSON.stringify(full))
  check('http is accepted for a loopback address only', normalizeProfile({ id: 'l', api: 'http://127.0.0.1:8080' }).ok === true && normalizeProfile({ id: 'l', api: 'http://localhost:8080' }).ok === true && normalizeProfile({ id: 'l', api: 'http://kb.corp.example' }).ok === false)
  const bad = (label, raw, why) => { const r = normalizeProfile(raw); check('refused: ' + label, r.ok === false && r.error === why, JSON.stringify(r)) }
  bad('no api', { id: 'x' }, 'bad_api')
  bad('an api that is not a URL', { id: 'x', api: 'kb.acme.example' }, 'bad_api')
  bad('credentials in the URL', { id: 'x', api: 'https://u:p@kb.example' }, 'bad_api')
  bad('a query in the URL', { id: 'x', api: 'https://kb.example/?a=1' }, 'bad_api')
  bad('a fragment in the URL', { id: 'x', api: 'https://kb.example/#a' }, 'bad_api')
  bad('a javascript: URL', { id: 'x', api: 'javascript:alert(1)' }, 'bad_api')
  bad('a very long URL', { id: 'x', api: 'https://kb.example/' + 'a'.repeat(400) }, 'bad_api')
  bad('an id with a slash (it becomes a file name)', { id: '../x', api: 'https://kb.example' }, 'bad_id')
  bad('an upper-case id', { id: 'Acme', api: 'https://kb.example' }, 'bad_id')
  bad('no id', { api: 'https://kb.example' }, 'bad_id')
  bad('the built-in id (it cannot be redefined)', { id: DEFAULT_SERVER_ID, api: 'https://kb.example' }, 'reserved_id')
  bad('a web that is present and invalid (no silent fallback)', { id: 'x', api: 'https://kb.example', web: 'oops' }, 'bad_web')
  bad('a console that is present and invalid', { id: 'x', api: 'https://kb.example', console: 'ftp://x' }, 'bad_console')
  bad('an llm that is present and invalid', { id: 'x', api: 'https://kb.example', services: { llm: 'nope' } }, 'bad_llm')
  bad('a gateway that is present and invalid', { id: 'x', api: 'https://kb.example', services: { gateway: 'nope' } }, 'bad_gateway')
  bad('not an object', 'text', 'not_an_object')
  check('a profile is frozen', Object.isFrozen(p.profile) && Object.isFrozen(p.profile.services))
}

console.log('the LLM of a server')
{
  const llm = (services) => { const r = normalizeProfile({ id: 'x', api: 'https://a.example', services }); return r.ok === true ? llmBase(r.profile) : 'REFUSED' }
  check('no services: chat goes to the api host, as today', llm(undefined) === 'https://a.example/v1' && llm({}) === 'https://a.example/v1' && llm({ llm: null }) === 'https://a.example/v1')
  check('a separate LLM service: chat goes there, never to a host deduced from the account address', llm({ llm: 'https://llm.example' }) === 'https://llm.example/v1')
  check('a server with no Kybernos LLM has no chat base at all', llm({ llm: false }) === null)
  check('the built-in server routes chat to its own api host', llmBase(DEFAULT_PROFILE) === BUILTIN_API + '/v1')
  check('publicProfile says « none », « api » or the URL', publicProfile(normalizeProfile({ id: 'x', api: 'https://a.example', services: { llm: false } }).profile).llm === 'none' && publicProfile(DEFAULT_PROFILE).llm === 'api' && publicProfile(normalizeProfile({ id: 'x', api: 'https://a.example', services: { llm: 'https://l.example' } }).profile).llm === 'https://l.example')
}

console.log('the connected apps of a server')
{
  const conn = (services) => { const r = normalizeProfile({ id: 'x', api: 'https://a.example', services }); return r.ok === true ? connectionsEndpoint(r.profile) : 'REFUSED' }
  check('absent means NOT OFFERED (unlike the LLM, where absent means the api host)', conn(undefined) === null && conn({}) === null && conn({ llm: 'https://llm.example' }) === null && conn({ connections: null }) === null)
  check('false is not offered either', conn({ connections: false }) === null)
  check('an address is kept as the endpoint, trailing slash cut', conn({ connections: 'https://a.example/v1/mcp/connections/' }) === 'https://a.example/v1/mcp/connections')
  const local = (api, connections) => { const r = normalizeProfile({ id: 'x', api, services: { connections } }); return r.ok === true ? connectionsEndpoint(r.profile) : 'REFUSED' }
  check('http is accepted for a loopback address only', local('http://127.0.0.1:8080', 'http://127.0.0.1:8080/v1/mcp/connections') === 'http://127.0.0.1:8080/v1/mcp/connections' && local('http://a.example', 'http://a.example/v1/mcp/connections') === 'REFUSED')
  const bad = (label, services) => { const r = normalizeProfile({ id: 'x', api: 'https://a.example', services }); check('refused: ' + label, r.ok === false && r.error === 'bad_connections', JSON.stringify(r)) }
  bad('a value that is present and not an address (no silent fallback)', { connections: 'nope' })
  bad('true (it is an address or false)', { connections: 'true' })
  bad('a query in the address', { connections: 'https://a.example/v1/mcp/connections?x=1' })
  bad('another host than the server (the token must not leave the server that issued it)', { connections: 'https://elsewhere.example/v1/mcp/connections' })
  bad('another port is another origin', { connections: 'https://a.example:8443/v1/mcp/connections' })
  {
    const dir = mkdtempSync(join(tmpdir(), 'kb-conn-'))
    const file = join(dir, 'servers.json')
    writeFileSync(file, JSON.stringify({ active: 'x', servers: [{ id: 'x', api: 'https://a.example', services: { connections: 'https://a.example/v1/mcp/connections' } }] }))
    const own = activeServer({ env: {}, registryFile: file })
    const overridden = activeServer({ env: { KYBERNOS_CLOUD_API: 'http://127.0.0.1:9' }, registryFile: file })
    check('the registry server offers its endpoint', connectionsEndpoint(own.profile) === 'https://a.example/v1/mcp/connections', JSON.stringify(own.profile.services))
    check('an environment override of api leaves the endpoint behind: no token for the old host', connectionsEndpoint(overridden.profile) === null && publicProfile(overridden.profile).connections === false)
    check('the server list says which servers offer them', own.servers.find((x) => x.id === 'x').connections === true && own.servers[0].connections === true)
    rmSync(dir, { recursive: true, force: true })
  }
  check('the built-in server (the new one) offers them, on its own origin', connectionsEndpoint(DEFAULT_PROFILE) === BUILTIN_API + '/v1/mcp/connections' && publicProfile(DEFAULT_PROFILE).connections === true)
  check('publicProfile says whether connections are offered, never the address', publicProfile(normalizeProfile({ id: 'x', api: 'https://a.example', services: { connections: 'https://a.example/v1/mcp/connections' } }).profile).connections === true)
  check('the profile stays frozen with the new field', Object.isFrozen(normalizeProfile({ id: 'x', api: 'https://a.example', services: { connections: false } }).profile.services))
  check('connectionsEndpoint never throws on a missing or odd profile', connectionsEndpoint(null) === null && connectionsEndpoint({}) === null && connectionsEndpoint({ services: {} }) === null)
}

console.log('the built-in server is the NEW one')
{
  const OLD = /(^|[./])dev2?\.kybernos\.app|api\.dev2?\.kybernos|kybernos-proxy|\bkybernos\.app\b/
  check('one place names it: BUILTIN_API is an https address', /^https:\/\/[a-z0-9.-]+$/.test(BUILTIN_API) && DEFAULT_PROFILE.api === BUILTIN_API, BUILTIN_API)
  check('nothing of the old stack is left in the built-in profile (hosts of dev.kybernos.app, api.dev, api.dev2, the proxy)', OLD.test(JSON.stringify(DEFAULT_PROFILE)) === false, JSON.stringify(DEFAULT_PROFILE))
  check('its web and its console are its OWN host (the server serves its pages and its console)', DEFAULT_PROFILE.web === BUILTIN_API && DEFAULT_PROFILE.console === BUILTIN_API + '/workspace-console')
  check('it has no gateway (the relay replaced it) and no separate LLM service (same host)', DEFAULT_PROFILE.services.gateway === null && DEFAULT_PROFILE.services.llm === null && publicProfile(DEFAULT_PROFILE).gateway === null && publicProfile(DEFAULT_PROFILE).llm === 'api')
  check('the built-in profile is frozen', Object.isFrozen(DEFAULT_PROFILE) && Object.isFrozen(DEFAULT_PROFILE.services))
  const bare = activeServer({ env: {}, registryFile: join(dir, 'nope.json') })
  check('with no registry and no environment, DSH talks to the new server and to nothing else', bare.profile.api === BUILTIN_API && bare.source === 'default' && bare.servers.length === 1 && bare.servers[0].api === BUILTIN_API)
  // The environment override (tests, developers, the sandbox) re-points the BUILT-IN server: everything it derives follows.
  const over = activeServer({ env: { KYBERNOS_CLOUD_API: 'http://127.0.0.1:9100/' }, registryFile: join(dir, 'nope.json') })
  check('an override of api moves the built-in server\'s web, console and connections with it', over.profile.api === 'http://127.0.0.1:9100' && over.profile.web === 'http://127.0.0.1:9100' && over.profile.console === 'http://127.0.0.1:9100/workspace-console' && connectionsEndpoint(over.profile) === 'http://127.0.0.1:9100/v1/mcp/connections' && over.profile.services.gateway === null, JSON.stringify(over.profile))
  check('and leaves nothing of the deployed server behind', JSON.stringify(over.profile).includes(new URL(BUILTIN_API).host) === false)
}

console.log('the old stack, kept as an explicit opt-in')
{
  // docs/dev/servers.md documents ONE servers.json entry for the old stack; the test reads THAT text, so the doc cannot drift from what DSH accepts.
  const doc = readFileSync(new URL('../../docs/dev/servers.md', import.meta.url), 'utf8')
  const block = doc.match(/<!-- legacy-entry -->\s*```json\s*([\s\S]*?)```/)
  check('docs/dev/servers.md carries the entry', block !== null)
  const registry = block === null ? null : JSON.parse(block[1])
  const entry = registry === null ? null : registry.servers[0]
  const norm = entry === null ? { ok: false } : normalizeProfile(entry)
  check('the documented entry is a valid profile with its own id (never the built-in one)', norm.ok === true && norm.profile.id !== DEFAULT_SERVER_ID, JSON.stringify(norm))
  if (norm.ok === true) {
    const legacyFile = join(dir, 'legacy.json')
    writeFileSync(legacyFile, JSON.stringify(registry))
    check('the file in the doc names that entry as active', registry.active === norm.profile.id)
    const a = activeServer({ env: {}, registryFile: legacyFile })
    check('selecting it points DSH at the old stack (api, web, console, gateway) and nowhere else', a.source === 'registry' && a.profile.api !== BUILTIN_API && a.profile.web !== a.profile.api && a.profile.console.endsWith('/workspace-console') && typeof a.profile.services.gateway === 'string', JSON.stringify(a.profile))
    check('it keeps its own connection file, so the new server\'s token never reaches it', stateFileName(a.profile) === 'kybernos-cloud-' + norm.profile.id + '.json')
    check('and it does not offer the connections the old stack does not have', connectionsEndpoint(a.profile) === null)
    check('leaving it (no registry) brings back the new server', activeServer({ env: {}, registryFile: join(dir, 'nope.json') }).profile.api === BUILTIN_API)
  }
}

console.log('the registry')
{
  check('no file: no registry, no crash', readRegistry(join(dir, 'nope.json')).servers.length === 0)
  write('{ not json')
  check('a malformed file is no registry', readRegistry(file).servers.length === 0 && readRegistry(file).active === null)
  write([1, 2])
  check('an array is no registry', readRegistry(file).servers.length === 0)
  write({ active: 'b', servers: [{ id: 'a', api: 'https://a.example' }, { id: 'a', api: 'https://dup.example' }, { id: 'b', api: 'oops' }, { id: DEFAULT_SERVER_ID, api: 'https://x.example' }, { id: 'c', api: 'https://c.example' }, 7] })
  const r = readRegistry(file)
  check('valid entries are kept, once each', r.servers.map((s) => s.id).join() === 'a,c', JSON.stringify(r.servers.map((s) => s.id)))
  check('invalid, duplicate and reserved entries are dropped and listed', r.rejected.length === 4 && r.rejected.some((x) => x.error === 'duplicate_id') && r.rejected.some((x) => x.error === 'bad_api') && r.rejected.some((x) => x.error === 'reserved_id'), JSON.stringify(r.rejected))
}

console.log('which server is active')
{
  write({ active: 'acme', servers: [{ id: 'acme', name: 'Acme', api: 'https://kb.acme.example' }, { id: 'other', api: 'https://o.example' }] })
  let a = activeServer({ env: {}, registryFile: file })
  check('the registry\'s choice', a.profile.id === 'acme' && a.source === 'registry' && a.error === undefined)
  check('the list always starts with the built-in server and marks nothing itself', a.servers.map((s) => s.id).join() === 'kybernos-cloud,acme,other')
  check('each entry carries its api and what its LLM is, so a screen can list servers without a second call', a.servers.every((s) => typeof s.api === 'string' && ['api', 'none'].concat([]).concat(typeof s.llm === 'string' && s.llm.startsWith('https') ? [s.llm] : []).includes(s.llm)) && a.servers[0].api === BUILTIN_API)
  a = activeServer({ env: {}, registryFile: join(dir, 'nope.json') })
  check('no registry: the built-in Kybernos Cloud', a.profile.id === DEFAULT_SERVER_ID && a.source === 'default')
  write({ active: DEFAULT_SERVER_ID, servers: [{ id: 'acme', api: 'https://kb.acme.example' }] })
  check('« active » set to the built-in id: the built-in server', activeServer({ env: {}, registryFile: file }).profile.id === DEFAULT_SERVER_ID)
  write({ active: 'ghost', servers: [{ id: 'acme', api: 'https://kb.acme.example' }] })
  a = activeServer({ env: {}, registryFile: file })
  check('an unknown « active » falls back to the built-in server and SAYS so', a.profile.id === DEFAULT_SERVER_ID && a.error === 'active_unknown', JSON.stringify([a.profile.id, a.error]))
  write({ active: 'acme', servers: [{ id: 'acme', api: 'https://kb.acme.example' }] })
  a = activeServer({ env: { KYBERNOS_CLOUD_API: 'http://127.0.0.1:9999/' }, registryFile: file })
  check('the environment override wins (tests, developers) and carries the other fields of the active server', a.source === 'env' && a.profile.api === 'http://127.0.0.1:9999' && a.profile.web === 'http://127.0.0.1:9999' && a.profile.id === 'acme', JSON.stringify(a.profile))
  a = activeServer({ env: { KYBERNOS_CLOUD_API: 'not a url' }, registryFile: file })
  check('an invalid override is ignored, not obeyed', a.source === 'registry' && a.profile.id === 'acme')
}

console.log('where a server keeps its connection')
{
  check('the built-in server keeps today\'s file name (nobody is signed out by this change)', stateFileName(DEFAULT_PROFILE) === 'kybernos-cloud.json')
  check('another server has its own file: switching never mixes two tokens', stateFileName({ id: 'acme' }) === 'kybernos-cloud-acme.json')
}

rmSync(dir, { recursive: true, force: true })
console.log('\n' + (failed === 0 ? 'all checks OK' : failed + ' check(s) failed'))
process.exit(failed === 0 ? 0 : 1)

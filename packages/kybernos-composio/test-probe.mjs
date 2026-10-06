// ═════════════════════════════════════════════════════════════════════
// Tests for mcp-probe.mjs: the connector "Test" button's engine, against small fake MCP servers
// (one over HTTP, one over stdio) that can misbehave in the ways real ones do.
//
//   node test-probe.mjs
// ═════════════════════════════════════════════════════════════════════
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { probeHttp, probeStdio, redact, childEnv, PROBE_LIMITS } from './mcp-probe.mjs'
import { suite, fakeHttpMcp, fakeStdioScript } from './lib-test.mjs'

const { ok, done } = suite()

// ── a fake streamable-http MCP server (lib-test.mjs) ─────────────────────────
const fh = await fakeHttpMcp()
const seen = fh.state.seen
const url = fh.url

{
  fh.state.mode = 'normal'; seen.length = 0
  const r = await probeHttp({ url, headers: { authorization: 'Bearer good', 'x-extra': '1' }, secrets: ['good'] })
  ok('http: a healthy server answers ok with its tools', r.ok === true && r.tools.length === 2 && r.tools[0].name === 'search' && r.tools[0].description === 'Searches', JSON.stringify(r).slice(0, 120))
  ok('http: the server info is returned', r.server.name === 'fake-http' && r.server.version === '9.9')
  ok('http: initialize, initialized, tools/list and the session end, in that order', seen.map((s) => s.method + ':' + (s.body ? JSON.parse(s.body).method : '')).join(' ') === 'POST:initialize POST:notifications/initialized POST:tools/list DELETE:', seen.map((s) => s.method).join(','))
  ok('http: the session id is sent back', seen[2].headers['mcp-session-id'] === 'sess-1' && seen[3].headers['mcp-session-id'] === 'sess-1')
  ok('http: the connector\'s headers are sent', seen[0].headers.authorization === 'Bearer good' && seen[0].headers['x-extra'] === '1')
  ok('http: content-type and accept are the protocol\'s, whatever the headers say', /application\/json/.test(seen[0].headers['content-type']) && /text\/event-stream/.test(seen[0].headers.accept))
}
{
  fh.state.mode = 'sse'
  const r = await probeHttp({ url, headers: {} })
  ok('http: an event-stream answer is read like a JSON one', r.ok === true && r.tools.length === 2)
}
{
  fh.state.mode = 'paged'
  const r = await probeHttp({ url, headers: {} })
  ok('http: a paginated tools/list is followed', r.ok === true && r.tools.map((t) => t.name).join() === 'a,b', JSON.stringify(r.tools))
}
{
  fh.state.mode = 'auth'
  const r = await probeHttp({ url, headers: { authorization: 'Bearer wrong' }, secrets: ['wrong'] })
  ok('http: a refused key is 401, not a vague failure', r.ok === false && r.code === '401' && r.hint === undefined, JSON.stringify(r))
}
{
  fh.state.mode = 'oauth'
  const r = await probeHttp({ url, headers: {} })
  ok('http: an OAuth challenge is flagged (a header alone cannot satisfy it)', r.ok === false && r.code === '401' && r.hint === 'oauth', JSON.stringify(r))
}
{
  fh.state.mode = 'down'
  const r = await probeHttp({ url, headers: {} })
  ok('http: a server error keeps its status', r.ok === false && r.code === '503', JSON.stringify(r))
}
{
  fh.state.mode = 'html'
  const r = await probeHttp({ url, headers: {} })
  ok('http: an HTML page is bad-response (a captive portal, a wrong address)', r.ok === false && r.code === 'bad-response', JSON.stringify(r))
}
{
  fh.state.mode = 'rpcerr'
  const r = await probeHttp({ url, headers: {}, secrets: ['secret-abc-123'] })
  ok('http: a JSON-RPC error is rpc-error, and its text is redacted of the secrets', r.ok === false && r.code === 'rpc-error' && r.message.includes('secret-abc-123') === false && r.message.includes('***'), JSON.stringify(r))
}
{
  fh.state.mode = 'slow'
  const t = Date.now()
  const r = await probeHttp({ url, headers: {}, timeoutMs: 400 })
  ok('http: a server that never answers times out on time', r.ok === false && r.code === 'timeout' && Date.now() - t < 2500, `${Date.now() - t} ms ${JSON.stringify(r)}`)
}
{
  const r = await probeHttp({ url: 'http://127.0.0.1:1/mcp', headers: {}, timeoutMs: 3000 })
  ok('http: nothing listening is offline', r.ok === false && r.code === 'offline', JSON.stringify(r))
}
fh.close()

// ── a fake stdio MCP server, written to a temp folder ───────────────────────
const dir = mkdtempSync(join(tmpdir(), 'kb-probe-'))
const fake = fakeStdioScript(dir)
const NODE = process.execPath
process.env.SOME_TOKEN = 'parent-token-value'
process.env.DSH_HOME_PROBE = 'x'
{
  const r = await probeStdio({ command: NODE, args: [fake], cwd: dir, env: { EXPLICIT: 'yes' }, timeoutMs: 8000 })
  ok('stdio: a healthy server answers ok with its tools', r.ok === true && r.server.name === 'fake-stdio' && r.tools.length === 6, JSON.stringify(r).slice(0, 160))
  const names = r.tools.map((t) => t.name)
  ok('stdio: the working directory is honoured', names.includes('cwd:' + dir.split('/').pop()), names.join())
  ok('stdio: a credential-shaped name of the parent is NOT forwarded (the real start does not forward it)', names.includes('secret_in_env:false'), names.join())
  ok('stdio: the connector\'s own env is forwarded, even a credential-shaped one is allowed to be explicit', names.includes('explicit:yes'))
  ok('stdio: PATH survives the scrub', names.includes('path:true'))
}
{
  const r = await probeStdio({ command: NODE, args: [fake], env: { FAKE_MODE: 'noise' }, timeoutMs: 8000 })
  ok('stdio: lines that are not protocol are counted, and the test still passes', r.ok === true && r.noise === 1, JSON.stringify(r).slice(0, 100))
}
{
  const r = await probeStdio({ command: NODE, args: [fake], env: { FAKE_MODE: 'exit' }, timeoutMs: 8000 })
  ok('stdio: a server that stops at boot is "exited", with its last words', r.ok === false && r.code === 'exited' && /3/.test(r.message) && /missing config/.test(r.stderr), JSON.stringify(r))
}
{
  const t = Date.now()
  const r = await probeStdio({ command: NODE, args: [fake], env: { FAKE_MODE: 'silent' }, timeoutMs: 500 })
  ok('stdio: a server that never answers times out and is killed', r.ok === false && r.code === 'timeout' && Date.now() - t < 3000, `${Date.now() - t} ms`)
}
{
  const r = await probeStdio({ command: '/usr/bin/does-not-exist-xyz', args: [], timeoutMs: 3000 })
  ok('stdio: a command that cannot start is "spawn" with the system code', r.ok === false && r.code === 'spawn' && r.message === 'ENOENT', JSON.stringify(r))
}
{
  const r = await probeStdio({ command: NODE, args: [fake], env: { FAKE_MODE: 'leak', MY_API_KEY: 'k-supersecret-1' }, secrets: ['k-supersecret-1'], timeoutMs: 400 })
  ok('stdio: what the server wrote on stderr is redacted of the secrets', r.ok === false && String(r.stderr).includes('k-supersecret-1') === false, JSON.stringify(r))
}

// ── helpers ─────────────────────────────────────────────────────────────────
ok('redact: replaces every secret, cuts the text, ignores short ones', redact('a key-123 and key-123 and xy', ['key-123', 'xy'], 100) === 'a *** and *** and xy' && redact('abcdef', [], 3) === 'abc…')
ok('redact: strips terminal colours', redact('\u001b[31mred\u001b[0m', [], 50) === 'red')
ok('childEnv: drops KEY/TOKEN/SECRET/PASSWORD and DSH_*, keeps the rest, adds the explicit env', (() => { const e = childEnv({ PATH: '/bin', MY_KEY: 'x', db_password: 'p', DSH_HOME: '/h', dsh_x: '1', HOME: '/home' }, { TOKEN_EXPLICIT: 'ok' }); return e.PATH === '/bin' && e.HOME === '/home' && e.MY_KEY === undefined && e.db_password === undefined && e.DSH_HOME === undefined && e.dsh_x === undefined && e.TOKEN_EXPLICIT === 'ok' })())
ok('limits: the budgets are the documented ones', PROBE_LIMITS.httpMs === 12000 && PROBE_LIMITS.stdioMs === 20000)

rmSync(dir, { recursive: true, force: true })
done('Probe')

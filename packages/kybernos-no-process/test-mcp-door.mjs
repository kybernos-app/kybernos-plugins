import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDoor } from './mcp-door.mjs'
// A stdio MCP server of our own (two tools, newline-delimited JSON-RPC): the test never runs code from the person's DSH home.
const fixtureDir = mkdtempSync(join(tmpdir(), 'kb-mcp-door-'))
process.on('exit', () => { try { rmSync(fixtureDir, { recursive: true, force: true }) } catch (e) { /* gone */ } })
const HORLOGE = join(fixtureDir, 'horloge-mcp-server.mjs')
writeFileSync(HORLOGE, [
  "const send = (m) => process.stdout.write(JSON.stringify(m) + '\\n')",
  "const TOOLS = [{ name: 'now', description: 'now', inputSchema: { type: 'object', properties: {} } }, { name: 'secret_probe', description: 'probe', inputSchema: { type: 'object', properties: {} } }]",
  "const handle = (m) => {",
  "  if (m.id === undefined) return",
  "  if (m.method === 'initialize') return send({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: (m.params && m.params.protocolVersion) || '2025-06-18', capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'horloge', version: '0.1.0' } } })",
  "  if (m.method === 'ping') return send({ jsonrpc: '2.0', id: m.id, result: {} })",
  "  if (m.method === 'tools/list') return send({ jsonrpc: '2.0', id: m.id, result: { tools: TOOLS } })",
  "  if (m.method === 'tools/call') return send({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: new Date().toISOString() }] } })",
  "  send({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'method not found' } })",
  "}",
  "let buf = ''",
  "process.stdin.setEncoding('utf8')",
  "process.stdin.on('data', (c) => { buf += c; for (let nl = buf.indexOf('\\n'); nl !== -1; nl = buf.indexOf('\\n')) { const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1); if (line !== '') { try { handle(JSON.parse(line)) } catch (e) { /* unreadable line */ } } } })",
  "process.stdin.on('end', () => process.exit(0))",
].join('\n') + '\n')
const door = await createDoor({ port: 0, token: 'tok', servers: { horloge: { file: HORLOGE } } })
const base = 'http://127.0.0.1:' + door.port + '/mcp/horloge'
const post = (body, headers = {}) => fetch(base, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers }, body: JSON.stringify(body) })
assert.equal((await post({ jsonrpc: '2.0', id: 1, method: 'ping' })).status, 401, 'no token = refused')
assert.equal((await post({ jsonrpc: '2.0', id: 1, method: 'ping' }, { authorization: 'Bearer wrong' })).status, 401)
assert.equal((await post({ jsonrpc: '2.0', id: 1, method: 'ping' }, { authorization: 'Bearer tok', origin: 'https://evil.example' })).status, 403, 'browser origin refused')
assert.equal((await fetch(base, { method: 'GET', headers: { authorization: 'Bearer tok' } })).status, 405)
assert.equal((await fetch(base.replace('horloge', 'nope'), { method: 'POST', headers: { authorization: 'Bearer tok' }, body: '{}' })).status, 404)
const A = { authorization: 'Bearer tok' }
let r = await post({ jsonrpc: '2.0', id: 'a', method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } } }, A)
let j = await r.json(); assert.equal(j.id, 'a'); assert.equal(j.result.serverInfo.name, 'horloge')
r = await post({ jsonrpc: '2.0', method: 'notifications/initialized' }, A); assert.equal(r.status, 202)
j = await (await post({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, A)).json(); assert.deepEqual(j.result.tools.map((t) => t.name), ['now', 'secret_probe'])
j = await (await post({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'now', arguments: {} } }, A)).json(); assert.match(j.result.content[0].text, /^\d{4}-\d\d-\d\dT/)
console.log('door: raw protocol ok; tool answered', JSON.stringify(j.result.content[0].text).slice(0, 50))
// the engine's own client SDK, over the same URL: KYBERNOS_ENGINE_MODULES, else the newest engine installed under ~/.dsh/kybernos/moteur (never a fixed version)
const engineClient = (() => {
  const declared = String(process.env.KYBERNOS_ENGINE_MODULES ?? '').trim()
  const roots = declared !== '' ? [declared] : []
  try {
    const moteur = join(homedir(), '.dsh', 'kybernos', 'moteur')
    for (const v of readdirSync(moteur).sort((a, b) => b.localeCompare(a, 'en', { numeric: true }))) roots.push(join(moteur, v, 'node_modules'))
  } catch (e) { /* no local engine */ }
  const found = roots.map((r) => join(r, '@deepseek-ai', 'dsh-mcp-client', 'package.json')).find((f) => existsSync(f))
  return found === undefined ? null : found
})()
if (engineClient === null) {
  door.close()
  console.log("SKIPPED: the engine's MCP client SDK half of test-mcp-door (no DSH engine here; set KYBERNOS_ENGINE_MODULES to the dsh install's node_modules)")
  process.exit(0)
}
const req = createRequire(engineClient)
const sdk = await import(req.resolve('@modelcontextprotocol/client'))
const client = new sdk.Client({ name: 'engine-like', version: '0' })
await client.connect(new sdk.StreamableHTTPClientTransport(new URL(base), { requestInit: { headers: A } }))
const tools = await client.listTools(); assert.deepEqual(tools.tools.map((t) => t.name), ['now', 'secret_probe'])
const call = await client.callTool({ name: 'now', arguments: {} }); assert.match(call.content[0].text, /^\d{4}/)
await client.close(); door.close()
console.log('door: the engine MCP client SDK connected, listed 2 tools and called one')

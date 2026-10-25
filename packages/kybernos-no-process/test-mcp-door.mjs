import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createDoor } from './mcp-door.mjs'
const HORLOGE = process.env.HOME + '/.dsh/mcp/horloge-mcp-server.mjs'
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
// the engine's own client SDK, over the same URL
const req = createRequire(process.env.HOME + '/.dsh/kybernos/moteur/0.2.1-rc.2/node_modules/@deepseek-ai/dsh-mcp-client/package.json')
const sdk = await import(req.resolve('@modelcontextprotocol/client'))
const client = new sdk.Client({ name: 'engine-like', version: '0' })
await client.connect(new sdk.StreamableHTTPClientTransport(new URL(base), { requestInit: { headers: A } }))
const tools = await client.listTools(); assert.deepEqual(tools.tools.map((t) => t.name), ['now', 'secret_probe'])
const call = await client.callTool({ name: 'now', arguments: {} }); assert.match(call.content[0].text, /^\d{4}/)
await client.close(); door.close()
console.log('door: the engine MCP client SDK connected, listed 2 tools and called one')

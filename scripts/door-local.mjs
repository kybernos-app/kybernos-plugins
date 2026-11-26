#!/usr/bin/env node
// Set up and check the local door (packages/kybernos-door): the MCP door that lets Claude Code on this computer give Kaby a task.
//
//   node scripts/door-local.mjs                  print the command that connects Claude Code to the door (the token is in it: keep it to yourself)
//   node scripts/door-local.mjs --port 3080      the port of the running Kybernos (default 3080)
//   node scripts/door-local.mjs --rotate         make a new token: the old one stops working at once; then connect again
//   node scripts/door-local.mjs --check          ask the running door for its tools (initialize + tools/list), print nothing secret
//
// The token is the file `<DSH_HOME>/kybernos/door/token`, made by the plugin when it starts; this script only reads it (and replaces it with --rotate).
import { join } from 'node:path'
import { createToken } from '../packages/kybernos-door/token.mjs'
import { dshHome, doorDir, ROUTE } from '../packages/kybernos-door/index.js'

const args = process.argv.slice(2)
const flag = (name) => args.indexOf(name) >= 0
const value = (name, fallback) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback }
const port = Number(value('--port', '3080'))
if (!Number.isInteger(port) || port < 1 || port > 65535) { console.error('--port must be a port number'); process.exit(2) }
const url = 'http://127.0.0.1:' + port + ROUTE
const store = createToken({ file: () => join(doorDir(dshHome()), 'token') })

if (flag('--rotate')) {
  store.rotate()
  console.log('A new token was made; the old one no longer works. Connect again with:\n')
}

const token = store.current()
if (token === '') {
  console.error('No token yet: switch the "Kaby MCP" plugin on and restart Kybernos, then run this again.')
  process.exit(1)
}

if (flag('--check')) {
  const post = async (body, headers = {}) => {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers }, body: JSON.stringify(body) })
    return { status: res.status, json: await res.json().catch(() => null) }
  }
  try {
    const noAuth = await post({ jsonrpc: '2.0', id: 1, method: 'ping' })
    const auth = { authorization: 'Bearer ' + token, 'x-kaby-check': '1' } // a check is not an assistant connecting: the Settings page does not count it as a call
    const init = await post({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'door-local-check', version: '1' } } }, auth)
    const list = await post({ jsonrpc: '2.0', id: 3, method: 'tools/list' }, auth)
    const names = list.json && list.json.result && Array.isArray(list.json.result.tools) ? list.json.result.tools.map((t) => t.name) : []
    console.log('without the token : ' + noAuth.status + (noAuth.status === 401 ? ' (refused, as it should)' : ' (UNEXPECTED: it must be 401)'))
    console.log('initialize        : ' + init.status + (init.json && init.json.result ? ' (' + init.json.result.serverInfo.name + ')' : ''))
    console.log('tools             : ' + (names.length > 0 ? names.join(', ') : 'none'))
    process.exit(noAuth.status === 401 && init.status === 200 && names.length > 0 ? 0 : 1)
  } catch (e) {
    console.error('Could not reach ' + url + ': ' + String(e && e.message ? e.message : e))
    process.exit(1)
  }
}

console.log('claude mcp add --scope user --transport http kaby ' + url + ' --header "Authorization: Bearer ' + token + '"')

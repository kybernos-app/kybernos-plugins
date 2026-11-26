#!/usr/bin/env node
// Live check of the local door (packages/kybernos-door) against a RUNNING Kybernos: not a unit test (a `check-*` name: CI has no running DSH).
//
//   source scripts/sandbox/env.sh && node scripts/check-door-live.mjs        the sandbox instance (port 3098), its own profile
//   node scripts/check-door-live.mjs --port 3080 --real                      the real one: only with the owner's go
//
// It speaks MCP over HTTP the way Claude Code does: initialize, tools/list, then `kaby_do` with a harmless task, and `list_tasks`. It prints the shape of
// every answer and never the token. The task it gives is « answer with the word ok »: it reads nothing of the person's and asks for no tool.
import { join } from 'node:path'
import { createToken } from '../packages/kybernos-door/token.mjs'
import { dshHome, doorDir, ROUTE } from '../packages/kybernos-door/index.js'

const args = process.argv.slice(2)
const value = (name, fallback) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback }
const port = Number(value('--port', process.env.KB_SANDBOX_PORT || '3098'))
const real = args.indexOf('--real') >= 0
if (port === 3080 && !real) { console.error('Port 3080 is the real Kybernos: pass --real only with the owner\'s go.'); process.exit(2) }
const wait = Number(value('--wait', '40'))
const task = value('--task', 'Answer with exactly one word: ok. Do not use any tool.')

const token = createToken({ file: () => join(doorDir(dshHome()), 'token') }).current()
if (token === '') { console.error('No token in ' + doorDir(dshHome()) + ': the plugin has not started in this profile.'); process.exit(1) }
const url = 'http://127.0.0.1:' + port + ROUTE
let fail = 0
const ok = (name, cond, extra = '') => { if (!cond) fail += 1; console.log((cond ? '  ok   ' : '  FAIL ') + name + (extra === '' ? '' : ' — ' + extra)) }
const post = async (body, headers = {}) => {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers }, body: JSON.stringify(body) })
  return { status: res.status, json: await res.json().catch(() => null) }
}
const auth = { authorization: 'Bearer ' + token, 'x-kaby-check': '1' } // a check is not an assistant connecting: the Settings page does not count it as a call
const rpc = (id, method, params) => post({ jsonrpc: '2.0', id, method, params }, auth)

console.log('Kaby MCP at ' + url)
ok('refuses a call without the token (401)', (await post({ jsonrpc: '2.0', id: 1, method: 'ping' })).status === 401)
ok('refuses a browser origin (403)', (await post({ jsonrpc: '2.0', id: 1, method: 'ping' }, { ...auth, origin: 'http://evil.example' })).status === 403)
const init = await rpc(2, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'check-door-live', version: '1' } })
ok('initialize', init.status === 200 && init.json?.result?.serverInfo?.name === 'kaby-mcp')
const list = await rpc(3, 'tools/list')
ok('tools/list: kaby_do, list_tasks and kaby_stop', (list.json?.result?.tools ?? []).map((t) => t.name).join() === 'kaby_do,list_tasks,kaby_stop')
const started = await rpc(4, 'tools/call', { name: 'kaby_do', arguments: { task, wait_seconds: wait } })
const out = started.json?.result?.structuredContent ?? {}
console.log('  kaby_do -> status=' + out.status + (out.reason ? ' reason=' + out.reason : '') + (out.tools_used !== undefined ? ' tools_used=' + out.tools_used : '') + (out.answer ? ' answer=' + JSON.stringify(String(out.answer).slice(0, 120)) : ''))
ok('kaby_do started a task and said where it stands', started.status === 200 && typeof out.task_id === 'string' && ['done', 'failed', 'running', 'waiting_approval', 'waiting_answer'].indexOf(out.status) >= 0)
if (typeof out.task_id === 'string') {
  const again = await rpc(5, 'tools/call', { name: 'kaby_do', arguments: { task_id: out.task_id, wait_seconds: 0 } })
  ok('asking again by task_id answers for the same task', again.json?.result?.structuredContent?.task_id === out.task_id)
  const tasks = await rpc(6, 'tools/call', { name: 'list_tasks', arguments: {} })
  ok('list_tasks lists it', (tasks.json?.result?.structuredContent?.tasks ?? []).some((t) => t.task_id === out.task_id))
}
console.log(fail === 0 ? 'LIVE CHECK OK' : fail + ' FAILED')
process.exit(fail === 0 ? 0 : 1)

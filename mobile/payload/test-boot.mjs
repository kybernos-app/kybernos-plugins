#!/usr/bin/env node
// Boots the REAL engine from a built payload the way the phone app does (bootstrap.mjs, embedded-Node arguments, process creation refused), with a stub model, creates a one-off
// automation through the interface route, and checks that it fires and that the model's answer lands in the chat. About two minutes on a Mac; not part of the default CI (it needs
// the payload, 54 MB packed, built by build-payload.mjs).
//   KB_PAYLOAD_DIR=<payload dir> node mobile/payload/test-boot.mjs
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const payload = process.env.KB_PAYLOAD_DIR
if (!payload || !existsSync(join(payload, 'payload.kbpack'))) { console.log('SKIPPED: set KB_PAYLOAD_DIR to a payload built by mobile/payload/build-payload.mjs'); process.exit(0) }
const ANSWER = 'Canberra'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const until = async (what, fn, ms, every = 1000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error('timed out waiting for ' + what); await sleep(every) } }

// a stand-in model: an OpenAI-compatible endpoint that always answers with ANSWER
const chunk = (delta, finish) => 'data: ' + JSON.stringify({ id: 'c', object: 'chat.completion.chunk', created: 1, model: 'stub-1', choices: [{ index: 0, delta, finish_reason: finish }] }) + '\n\n'
const stub = createServer((req, res) => {
  let body = ''; req.on('data', (d) => { body += d }); req.on('end', () => {
    if (!String(req.url).includes('/chat/completions')) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ data: [{ id: 'stub-1', object: 'model' }] })) }
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.write(chunk({ role: 'assistant', content: ANSWER }, null)); res.write(chunk({}, 'stop')); res.end('data: [DONE]\n\n')
  })
})
await new Promise((r) => stub.listen(0, '127.0.0.1', r))
const stubPort = stub.address().port

const work = mkdtempSync(join(tmpdir(), 'kb-boot-'))
const home = join(work, 'home')
const profile = join(home, '.dsh', 'profiles', 'web'); mkdirSync(profile, { recursive: true })
// the user layer the app would keep: the stub provider (bootstrap.mjs seeds this file only when it is missing)
writeFileSync(join(profile, 'cordis.patch.yml'), `- id: agent-default-model
  config: { provider: stub, model: stub-1 }
- id: llm-pi-ai
  config:
    providers:
      stub:
        displayName: Stub
        api: openai-completions
        baseURL: http://127.0.0.1:${stubPort}/v1
        apiKeyEnv: STUB_KEY
        models: [{ id: stub-1, name: stub-1, contextWindow: 128000, maxTokens: 1024, input: [text] }]
`)
const env = { ...process.env, KB_PAYLOAD: join(payload, 'payload.kbpack'), KB_MANIFEST: join(payload, 'payload.json'), KB_ROOT: join(work, 'runtime'), KB_HOME: home, KB_WORKSPACE: join(work, 'ws'), KB_PORT: '0',
  KYBERNOS_DENY_SPAWN: '1', STUB_KEY: 'x', KYBERNOS_AUTOMATION_LOAD_GUARD: 'off' } // the load cap is not what this test is about
delete env.ANTHROPIC_API_KEY
const child = spawn(process.execPath, ['--expose-internals', join(payload, 'bootstrap.mjs')], { env, stdio: ['ignore', 'pipe', 'pipe'] })
let out = ''; child.stdout.on('data', (d) => { out += d }); child.stderr.on('data', (d) => { out += d })
let ok = false
const T0 = Date.now(); const stamp = (m) => console.log('[' + ((Date.now() - T0) / 1000).toFixed(1).padStart(6) + 's] ' + m)
try {
  const url = await until('the engine to print its sign-in address', () => { const m = /dsh web: (http:\/\/127\.0\.0\.1:\d+\/\?token=\S+)/.exec(out); return m ? m[1] : null }, 180000, 500)
  const base = new URL(url).origin
  stamp('engine up (first unpack included) on ' + base)
  const r = await fetch(url, { redirect: 'manual' })
  const cookie = (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')
  assert.ok(/dsh-auth/.test(cookie), 'the sign-in address sets the session cookie')
  const post = async (path, body) => (await fetch(base + path, { method: 'POST', headers: { cookie, origin: base, 'content-type': 'application/json' }, body: JSON.stringify(body) })).json()
  const get = async (path) => (await fetch(base + path, { headers: { cookie, origin: base } })).json()
  const at = new Date(Date.now() + 60000).toISOString().slice(0, 16)
  const created = await post('/kybernos/tasks', { action: 'create', task: { name: 'boot-test', prompt: 'What is the capital of Australia? Reply with the single word.', schedule: { mode: 'once', at, tz: 'UTC' }, approvals: 'ask' } })
  assert.equal(created.ok, true, 'task created through the interface route: ' + JSON.stringify(created).slice(0, 200))
  const id = created.task.id; stamp('automation created, due ' + at + ' UTC')
  const fired = await until('the automation to fire', async () => { const t = (await post('/kybernos/tasks', { action: 'list' })).tasks.find((x) => x.id === id); return t && t.history.length > 0 ? t.history[t.history.length - 1] : null }, 150000, 3000)
  assert.equal(fired.status, 'fired', 'the automation fired: ' + JSON.stringify(fired).slice(0, 200)); stamp('fired')
  const hits = await until('the answer to reach the chat', async () => { const j = await get('/kybernos/search-content?q=' + ANSWER + '&sessionId=' + encodeURIComponent(fired.sessionId)); return JSON.stringify(j).toLowerCase().includes(ANSWER.toLowerCase()) ? j : null }, 60000, 2000)
  assert.ok(hits, 'the model answer is in the session'); stamp('the answer is in the chat')
  assert.ok(!/spawn \S+ EPERM[^\n]*\n[^\n]*unhandled/i.test(out), 'no unhandled process-creation error')
  ok = true
  console.log('payload boot test: PASS (engine up, automation created and fired, answer in the chat, processes refused)')
} catch (e) {
  console.error('payload boot test: FAIL: ' + e.message); console.error(out.split('\n').filter((l) => !/^\s+at /.test(l)).slice(-12).join('\n'))
} finally {
  child.kill('SIGTERM'); await sleep(1500); child.kill('SIGKILL'); stub.close(); rmSync(work, { recursive: true, force: true })
  process.exit(ok ? 0 : 1)
}

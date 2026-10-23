// A process that boots the Kybernos plugin must be able to end by itself. `dsh headless "task"` answers one task and exits when nothing keeps the process
// alive; a timer the plugin leaves "referenced" (the scheduler's 30 s tick used to be one) keeps it alive for ever: the answer is printed at once and the
// process never ends (measured 2026-10-23 with a real `dsh headless`, killed by a watchdog at 25 s and at 120 s). In `dsh web` the server keeps the process
// alive anyway, so a timer of the plugin must never be what does it.
//
// Here the plugin boots in a child process with a fake context in a temporary DSH_HOME and then does nothing: the child must end by itself, with no
// `process.exit`, well before the watchdog. Nothing outside the temporary folder is read or written.
// Usage: node scripts/test-plugin-exits.mjs   (exit 0 = everything passes)
import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
let fails = 0
const eq = (label, got, want) => { const ok = got === want; if (!ok) { fails++; console.log('FAIL', label, '| got', got, '| want', want) } else console.log('ok  ', label) }

// What the child does: boot the plugin, give the scheduler time to arm its timers (it arms them at once), then return and let the event loop drain.
const child = (pluginFile) => `
  const mod = await import(${JSON.stringify(pluginFile)})
  const services = {
    fs: {}, webServer: { register: () => () => {} }, workspaceRegistry: { list: () => [] }, sessions: { get: () => undefined },
    sessionController: { async create() { return { ok: true, value: { sessionId: 'sess-1' } } }, async prompt() { return { ok: true } }, async selectModel() { return { ok: true } } },
  }
  console.log = () => {}; console.error = () => {}
  mod.apply({ get: (n) => services[n], inject: () => {}, effect: (fn) => { try { return fn() } catch (e) { return undefined } }, on: () => () => {}, scope: {} })
  process.stdout.write('booted\\n')
`

const runChild = (watchdogMs) => new Promise((resolve) => {
  const home = mkdtempSync(join(tmpdir(), 'kb-plugin-exits-'))
  mkdirSync(join(home, 'kybernos'), { recursive: true })
  const env = Object.assign({}, process.env, { HOME: home, DSH_HOME: home, KYBERNOS_AUTOMATION_LOAD_GUARD: 'off' })
  const p = spawn(process.execPath, ['--input-type=module', '-e', child(join(root, 'packages/kybernos-plugin/index.js'))], { env, stdio: ['ignore', 'pipe', 'pipe'] })
  let out = ''
  p.stdout.on('data', (d) => { out += d })
  p.stderr.on('data', () => {})
  const started = Date.now()
  const timer = setTimeout(() => { p.kill('SIGKILL') }, watchdogMs)
  p.on('exit', (code, signal) => { clearTimeout(timer); resolve({ code, signal, ms: Date.now() - started, booted: out.indexOf('booted') >= 0 }) })
})

const r = await runChild(20000)
eq('the plugin boots in the child', r.booted, true)
eq('the child ends by itself (no watchdog kill)', r.signal, null)
eq('...with exit code 0', r.code, 0)
// 3 s: the plugin used to hold an 8 s timer for the translation jobs' resume and the speech cache trim, which would have made a one-shot wait 8 s to end.
eq('...at once, not after a timer of 8 s or 30 s (' + r.ms + ' ms)', r.ms < 3000, true)

console.log(fails === 0 ? '\nALL PASS' : '\n' + fails + ' FAILURES')
process.exit(fails === 0 ? 0 : 1)
